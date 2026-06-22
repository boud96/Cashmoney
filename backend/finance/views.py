import json
import sqlite3
import tempfile
from datetime import date
from decimal import Decimal
from decimal import InvalidOperation
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.http import Http404
from django.http import HttpResponse
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.generic import TemplateView
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from .constants import Direction, WantNeedInvestment
from .models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    ExchangeRate,
    FinanceSettings,
    HEX_COLOR_VALIDATOR,
    Keyword,
    SavedFilter,
    Subcategory,
    Tag,
    Transaction,
)
from .sample_data import (
    SAMPLE_IMPORT_SOURCE,
    SAMPLE_PREFIX,
    delete_sample_data,
    seed_sample_data,
)
from .serializers import (
    serialize_bank_account,
    serialize_category,
    serialize_csv_import,
    serialize_csv_mapping,
    serialize_finance_settings,
    serialize_keyword,
    serialize_saved_filter,
    serialize_subcategory,
    serialize_tag,
    serialize_transaction,
)
from .services import (
    CSVImportService,
    CategorizationService,
    ExchangeRateProviderError,
    available_currency_options,
    build_dashboard_summary,
    detect_csv_columns,
    exchange_rate_status,
    fallback_currency_options,
    normalize_currency_code,
    recategorize_transactions,
    recalculate_transaction_conversions,
    serialize_categorization_result,
    sync_missing_exchange_rates,
)


UNASSIGNED_FILTER_VALUE = "__unassigned__"
NONE_FILTER_VALUE = "__none__"
CONFIRM_DELETE_SAMPLE_DATA = "DELETE SAMPLE DATA"
CONFIRM_DELETE_ALL_TRANSACTIONS = "DELETE ALL TRANSACTIONS"
CONFIRM_DELETE_ALL_FINANCE_DATA = "DELETE ALL FINANCE DATA"
CONFIRM_RESTORE_DATABASE = "RESTORE DATABASE"
REQUIRED_BACKUP_TABLES = {
    "finance_bankaccount",
    "finance_category",
    "finance_csvmapping",
    "finance_exchangerate",
    "finance_financesettings",
    "finance_keyword",
    "finance_savedfilter",
    "finance_subcategory",
    "finance_tag",
    "finance_transaction",
}


class APIValidationError(Exception):
    def __init__(self, message, details=None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


def json_response(data, status=200):
    return JsonResponse(
        data,
        status=status,
        safe=isinstance(data, dict),
        encoder=DjangoJSONEncoder,
    )


def parse_json_body(request):
    if not request.body:
        return {}
    data = json.loads(request.body.decode("utf-8"))
    if not isinstance(data, dict):
        raise APIValidationError("JSON body must be an object")
    return data


def parse_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise APIValidationError("Invalid decimal value", {"value": value}) from exc


def parse_date_value(value, field_name):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise APIValidationError(
            "Invalid date value",
            {"field": field_name, "value": value, "expected": "YYYY-MM-DD"},
        ) from exc


def require_field(data, field_name):
    if field_name not in data or data[field_name] in (None, ""):
        raise APIValidationError("Missing required field", {"field": field_name})
    return data[field_name]


def clean_text(value, field_name, required=False):
    if value in (None, ""):
        if required:
            raise APIValidationError("Missing required field", {"field": field_name})
        return ""
    return str(value).strip()


def clean_currency_code(value, field_name, default="CZK"):
    try:
        return normalize_currency_code(value or default)
    except ValueError as exc:
        raise APIValidationError(
            "Invalid currency",
            {"field": field_name, "expected": "Three-letter currency code"},
        ) from exc


def clean_color(value, field_name="color"):
    color = clean_text(value, field_name).upper()
    if not color:
        return ""
    try:
        HEX_COLOR_VALIDATOR(color)
    except ValidationError as exc:
        raise APIValidationError(
            "Invalid color",
            {"field": field_name, "expected": "#RRGGBB", "messages": exc.messages},
        ) from exc
    return color


def clean_csv_char(value, field_name, default, allow_blank=False):
    text = clean_text(value, field_name)
    if text == r"\t":
        text = "\t"
    if not text:
        if allow_blank:
            return ""
        text = default
    if len(text) != 1:
        raise APIValidationError(
            "CSV setting must be one character",
            {"field": field_name, "value": value},
        )
    return text


def clean_int(value, field_name, default=0, minimum=None):
    if value in (None, ""):
        value = default
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise APIValidationError(
            "Invalid integer value", {"field": field_name}
        ) from exc
    if minimum is not None and parsed < minimum:
        raise APIValidationError(
            "Integer value is too small", {"field": field_name, "minimum": minimum}
        )
    return parsed


def clean_list(value, field_name, default=None):
    if value in (None, ""):
        return [] if default is None else default
    if not isinstance(value, list):
        raise APIValidationError("Expected a list", {"field": field_name})
    return [item for item in value if item not in (None, "")]


def clean_dict(value, field_name, default=None):
    if value in (None, ""):
        return {} if default is None else default
    if not isinstance(value, dict):
        raise APIValidationError("Expected an object", {"field": field_name})
    return value


def clean_choice(value, field_name, choices, allow_blank=True):
    if value in (None, ""):
        if allow_blank:
            return None
        raise APIValidationError("Missing required field", {"field": field_name})
    allowed = {choice[0] for choice in choices}
    if value not in allowed:
        raise APIValidationError(
            "Invalid choice", {"field": field_name, "allowed": sorted(allowed)}
        )
    return value


def optional_object(model, value, field_name):
    if value in (None, ""):
        return None
    try:
        return model.objects.get(id=value)
    except (model.DoesNotExist, ValidationError) as exc:
        raise APIValidationError(
            "Invalid reference", {"field": field_name, "id": str(value)}
        ) from exc


def set_tags(instance, tag_ids):
    tag_ids = clean_list(tag_ids, "tag_ids")
    tags = list(Tag.objects.filter(id__in=tag_ids))
    found_ids = {str(tag.id) for tag in tags}
    missing = [str(tag_id) for tag_id in tag_ids if str(tag_id) not in found_ids]
    if missing:
        raise APIValidationError("Invalid tag references", {"tag_ids": missing})
    instance.tags.set(tags)


def id_list(value):
    if not value:
        return []
    if isinstance(value, list):
        return value
    return [item for item in str(value).split(",") if item]


def filter_values(params, field_name):
    raw_values = (
        params.getlist(field_name)
        if hasattr(params, "getlist")
        else [params.get(field_name)]
    )
    values = []
    for raw_value in raw_values:
        if raw_value in (None, ""):
            continue
        if isinstance(raw_value, (list, tuple)):
            candidates = raw_value
        else:
            candidates = str(raw_value).split(",")
        for candidate in candidates:
            value = str(candidate).strip()
            if value and value not in values:
                values.append(value)
    return values


def filter_has_no_selection(params, field_name):
    return NONE_FILTER_VALUE in filter_values(params, field_name)


def split_unassigned_filter(params, field_name):
    values = [
        value
        for value in filter_values(params, field_name)
        if value != NONE_FILTER_VALUE
    ]
    assigned_values = [value for value in values if value != UNASSIGNED_FILTER_VALUE]
    return assigned_values, UNASSIGNED_FILTER_VALUE in values


class AppShellView(TemplateView):
    template_name = "finance/app.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        manifest_path = (
            Path(__file__).resolve().parent
            / "static"
            / "finance"
            / "react"
            / ".vite"
            / "manifest.json"
        )
        entry = {}
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            entry = manifest.get("index.html", manifest.get("src/main.jsx", {}))
        context["react_entry_js"] = entry.get("file")
        context["react_entry_css"] = entry.get("css", [])
        return context


@method_decorator(csrf_exempt, name="dispatch")
class JsonView(View):
    def dispatch(self, request, *args, **kwargs):
        try:
            return super().dispatch(request, *args, **kwargs)
        except json.JSONDecodeError:
            return json_response({"error": "Invalid JSON body"}, status=400)
        except APIValidationError as exc:
            return json_response(
                {"error": exc.message, "details": exc.details}, status=400
            )
        except KeyError as exc:
            return json_response(
                {
                    "error": "Missing required field",
                    "details": {"field": exc.args[0]},
                },
                status=400,
            )
        except Http404 as exc:
            return json_response({"error": str(exc), "details": {}}, status=404)
        except (ObjectDoesNotExist, ValidationError) as exc:
            return json_response({"error": str(exc), "details": {}}, status=400)
        except (UnicodeError, ValueError) as exc:
            return json_response({"error": str(exc), "details": {}}, status=400)
        except IntegrityError as exc:
            return json_response({"error": str(exc), "details": {}}, status=409)

    def options(self, request, *args, **kwargs):
        return json_response({})


class HealthView(JsonView):
    def get(self, request):
        return json_response({"status": "ok"})


class FinanceSettingsView(JsonView):
    def get(self, request):
        return json_response(serialize_finance_settings(FinanceSettings.load()))

    def patch(self, request):
        data = parse_json_body(request)
        settings_obj = FinanceSettings.load()
        old_default_currency = settings_obj.default_currency
        if "default_currency" in data:
            settings_obj.default_currency = clean_currency_code(
                data["default_currency"], "default_currency"
            )
        if "ignore_internal_account_references" in data:
            settings_obj.ignore_internal_account_references = parse_bool(
                data["ignore_internal_account_references"]
            )
        if "internal_transfer_subcategory_id" in data:
            settings_obj.internal_transfer_subcategory = optional_object(
                Subcategory,
                data.get("internal_transfer_subcategory_id"),
                "internal_transfer_subcategory_id",
            )
        settings_obj.save()
        if settings_obj.default_currency != old_default_currency:
            recalculate_transaction_conversions(
                default_currency=settings_obj.default_currency
            )
        return json_response(serialize_finance_settings(settings_obj))


class ExchangeRateStatusView(JsonView):
    def get(self, request):
        return json_response(exchange_rate_status())


class ExchangeRateCurrenciesView(JsonView):
    def get(self, request):
        try:
            return json_response(available_currency_options())
        except ExchangeRateProviderError as exc:
            return json_response(fallback_currency_options(exc))


class ExchangeRateSyncView(JsonView):
    def post(self, request):
        try:
            return json_response(sync_missing_exchange_rates())
        except ExchangeRateProviderError as exc:
            return json_response(
                {"error": str(exc), "details": {"source": "frankfurter"}},
                status=502,
            )


class SavedFilterCollectionView(JsonView):
    def get(self, request):
        return json_response(
            [
                serialize_saved_filter(saved_filter)
                for saved_filter in SavedFilter.objects.all()
            ]
        )

    def post(self, request):
        data = parse_json_body(request)
        name = clean_text(require_field(data, "name"), "name", required=True)
        filters = clean_dict(data.get("filters"), "filters")
        saved_filter = SavedFilter.objects.filter(name__iexact=name).first()
        status = 200
        if saved_filter:
            saved_filter.name = name
            saved_filter.filters = filters
            saved_filter.save()
        else:
            saved_filter = SavedFilter.objects.create(name=name, filters=filters)
            status = 201
        return json_response(serialize_saved_filter(saved_filter), status=status)


class SavedFilterDetailView(JsonView):
    def patch(self, request, pk):
        saved_filter = get_object_or_404(SavedFilter, id=pk)
        data = parse_json_body(request)
        if "name" in data:
            saved_filter.name = clean_text(data["name"], "name", required=True)
        if "filters" in data:
            saved_filter.filters = clean_dict(data["filters"], "filters")
        saved_filter.save()
        return json_response(serialize_saved_filter(saved_filter))

    def delete(self, request, pk):
        get_object_or_404(SavedFilter, id=pk).delete()
        return json_response({"deleted": True})


class BankAccountCollectionView(JsonView):
    def get(self, request):
        accounts = BankAccount.objects.select_related("default_csv_mapping").all()
        return json_response([serialize_bank_account(account) for account in accounts])

    def post(self, request):
        data = parse_json_body(request)
        account = BankAccount.objects.create(
            name=clean_text(require_field(data, "name"), "name", required=True),
            account_number=clean_text(
                require_field(data, "account_number"), "account_number", required=True
            ),
            bank_name=clean_text(data.get("bank_name"), "bank_name"),
            currency=clean_text(data.get("currency", "CZK"), "currency")[:3].upper(),
            owners=clean_int(data.get("owners"), "owners", default=1, minimum=1),
            default_csv_mapping=optional_object(
                CSVMapping, data.get("default_csv_mapping_id"), "default_csv_mapping_id"
            ),
        )
        return json_response(serialize_bank_account(account), status=201)


class BankAccountDetailView(JsonView):
    def patch(self, request, pk):
        account = get_object_or_404(BankAccount, id=pk)
        data = parse_json_body(request)
        for field in ["name", "account_number", "bank_name"]:
            if field in data:
                setattr(
                    account, field, clean_text(data[field], field, field != "bank_name")
                )
        if "currency" in data:
            account.currency = clean_text(data["currency"], "currency", required=True)[
                :3
            ].upper()
        if "owners" in data:
            account.owners = clean_int(data["owners"], "owners", minimum=1)
        if "default_csv_mapping_id" in data:
            account.default_csv_mapping = optional_object(
                CSVMapping, data["default_csv_mapping_id"], "default_csv_mapping_id"
            )
        account.save()
        return json_response(serialize_bank_account(account))

    def delete(self, request, pk):
        get_object_or_404(BankAccount, id=pk).delete()
        return json_response({"deleted": True})


class CSVMappingCollectionView(JsonView):
    def get(self, request):
        return json_response(
            [serialize_csv_mapping(mapping) for mapping in CSVMapping.objects.all()]
        )

    def post(self, request):
        data = parse_json_body(request)
        mapping = CSVMapping.objects.create(
            name=clean_text(require_field(data, "name"), "name", required=True),
            description=clean_text(data.get("description"), "description"),
            delimiter=clean_csv_char(data.get("delimiter"), "delimiter", ","),
            quotechar=clean_csv_char(data.get("quotechar"), "quotechar", '"'),
            encoding=clean_text(
                data.get("encoding", "utf-8-sig"), "encoding", required=True
            ),
            header_row=clean_int(
                data.get("header_row"), "header_row", default=0, minimum=0
            ),
            date_format=clean_text(
                data.get("date_format", "%Y-%m-%d"), "date_format", required=True
            ),
            fallback_date_formats=clean_list(
                data.get("fallback_date_formats"), "fallback_date_formats"
            ),
            decimal_separator=clean_csv_char(
                data.get("decimal_separator"), "decimal_separator", "."
            ),
            thousands_separator=clean_csv_char(
                data.get("thousands_separator"),
                "thousands_separator",
                "",
                allow_blank=True,
            ),
            default_currency=clean_text(
                data.get("default_currency", "CZK"), "default_currency", required=True
            )[:3].upper(),
            column_map=clean_dict(data.get("column_map"), "column_map"),
            categorization_fields=clean_list(
                data.get("categorization_fields"), "categorization_fields"
            ),
        )
        return json_response(serialize_csv_mapping(mapping), status=201)


class CSVMappingColumnDetectionView(JsonView):
    def post(self, request):
        csv_file = request.FILES.get("csv_file")
        if not csv_file:
            raise APIValidationError("Missing required field", {"field": "csv_file"})

        use_manual_settings = parse_bool(
            request.POST.get("manual_settings"), default=False
        )
        csv_mapping = CSVMapping(
            name="Column detection",
            delimiter=clean_csv_char(request.POST.get("delimiter"), "delimiter", ","),
            quotechar=clean_csv_char(request.POST.get("quotechar"), "quotechar", '"'),
            encoding=clean_text(
                request.POST.get("encoding", "utf-8-sig"),
                "encoding",
                required=True,
            ),
            header_row=clean_int(
                request.POST.get("header_row"), "header_row", default=0, minimum=0
            ),
            date_format=clean_text(
                request.POST.get("date_format", "%Y-%m-%d"),
                "date_format",
                required=True,
            ),
            decimal_separator=clean_csv_char(
                request.POST.get("decimal_separator"), "decimal_separator", "."
            ),
            thousands_separator=clean_csv_char(
                request.POST.get("thousands_separator"),
                "thousands_separator",
                "",
                allow_blank=True,
            ),
            default_currency=clean_text(
                request.POST.get("default_currency", "CZK"),
                "default_currency",
                required=True,
            )[:3].upper(),
        )
        sample_size = min(
            clean_int(
                request.POST.get("sample_size"), "sample_size", default=5, minimum=1
            ),
            20,
        )
        return json_response(
            detect_csv_columns(
                csv_mapping,
                csv_file,
                sample_size,
                autodetect_settings=not use_manual_settings,
            )
        )


class CSVMappingDetailView(JsonView):
    def patch(self, request, pk):
        mapping = get_object_or_404(CSVMapping, id=pk)
        data = parse_json_body(request)
        for field in [
            "name",
            "description",
            "delimiter",
            "quotechar",
            "encoding",
            "header_row",
            "date_format",
            "fallback_date_formats",
            "decimal_separator",
            "thousands_separator",
            "default_currency",
            "column_map",
            "categorization_fields",
        ]:
            if field in data:
                if field in {"fallback_date_formats", "categorization_fields"}:
                    setattr(mapping, field, clean_list(data[field], field))
                elif field == "column_map":
                    setattr(mapping, field, clean_dict(data[field], field))
                elif field == "header_row":
                    setattr(mapping, field, clean_int(data[field], field, minimum=0))
                elif field in {"delimiter", "quotechar", "decimal_separator"}:
                    defaults = {
                        "delimiter": ",",
                        "quotechar": '"',
                        "decimal_separator": ".",
                    }
                    setattr(
                        mapping,
                        field,
                        clean_csv_char(data[field], field, defaults[field]),
                    )
                elif field == "thousands_separator":
                    setattr(
                        mapping,
                        field,
                        clean_csv_char(data[field], field, "", allow_blank=True),
                    )
                else:
                    setattr(
                        mapping, field, clean_text(data[field], field, field == "name")
                    )
        mapping.save()
        return json_response(serialize_csv_mapping(mapping))

    def delete(self, request, pk):
        get_object_or_404(CSVMapping, id=pk).delete()
        return json_response({"deleted": True})


class CategoryCollectionView(JsonView):
    def get(self, request):
        return json_response(
            [serialize_category(category) for category in Category.objects.all()]
        )

    def post(self, request):
        data = parse_json_body(request)
        category = Category.objects.create(
            name=clean_text(require_field(data, "name"), "name", required=True),
            description=clean_text(data.get("description"), "description"),
            color=clean_color(data.get("color")),
        )
        return json_response(serialize_category(category), status=201)


class CategoryDetailView(JsonView):
    def patch(self, request, pk):
        category = get_object_or_404(Category, id=pk)
        data = parse_json_body(request)
        for field in ["name", "description", "color"]:
            if field in data:
                setattr(
                    category,
                    field,
                    clean_color(data[field])
                    if field == "color"
                    else clean_text(data[field], field, field == "name"),
                )
        category.save()
        return json_response(serialize_category(category))

    def delete(self, request, pk):
        get_object_or_404(Category, id=pk).delete()
        return json_response({"deleted": True})


class SubcategoryCollectionView(JsonView):
    def get(self, request):
        queryset = Subcategory.objects.select_related("category")
        category_id = request.GET.get("category")
        if category_id:
            queryset = queryset.filter(category_id=category_id)
        return json_response(
            [serialize_subcategory(subcategory) for subcategory in queryset]
        )

    def post(self, request):
        data = parse_json_body(request)
        category = optional_object(
            Category, require_field(data, "category_id"), "category_id"
        )
        subcategory = Subcategory.objects.create(
            category=category,
            name=clean_text(require_field(data, "name"), "name", required=True),
            description=clean_text(data.get("description"), "description"),
            color=clean_color(data.get("color")),
        )
        return json_response(serialize_subcategory(subcategory), status=201)


class SubcategoryDetailView(JsonView):
    def patch(self, request, pk):
        subcategory = get_object_or_404(Subcategory, id=pk)
        data = parse_json_body(request)
        if "category_id" in data:
            subcategory.category = optional_object(
                Category, data["category_id"], "category_id"
            )
        for field in ["name", "description", "color"]:
            if field in data:
                setattr(
                    subcategory,
                    field,
                    clean_color(data[field])
                    if field == "color"
                    else clean_text(data[field], field, field == "name"),
                )
        subcategory.save()
        return json_response(serialize_subcategory(subcategory))

    def delete(self, request, pk):
        get_object_or_404(Subcategory, id=pk).delete()
        return json_response({"deleted": True})


class TagCollectionView(JsonView):
    def get(self, request):
        return json_response([serialize_tag(tag) for tag in Tag.objects.all()])

    def post(self, request):
        data = parse_json_body(request)
        tag = Tag.objects.create(
            name=clean_text(require_field(data, "name"), "name", required=True),
            description=clean_text(data.get("description"), "description"),
            color=clean_color(data.get("color")),
        )
        return json_response(serialize_tag(tag), status=201)


class TagDetailView(JsonView):
    def patch(self, request, pk):
        tag = get_object_or_404(Tag, id=pk)
        data = parse_json_body(request)
        for field in ["name", "description", "color"]:
            if field in data:
                setattr(
                    tag,
                    field,
                    clean_color(data[field])
                    if field == "color"
                    else clean_text(data[field], field, field == "name"),
                )
        tag.save()
        return json_response(serialize_tag(tag))

    def delete(self, request, pk):
        get_object_or_404(Tag, id=pk).delete()
        return json_response({"deleted": True})


class KeywordCollectionView(JsonView):
    def get(self, request):
        keywords = (
            Keyword.objects.select_related("subcategory", "subcategory__category")
            .prefetch_related("tags")
            .all()
        )
        return json_response([serialize_keyword(keyword) for keyword in keywords])

    def post(self, request):
        data = parse_json_body(request)
        keyword = Keyword.objects.create(
            name=clean_text(require_field(data, "name"), "name", required=True),
            include_terms=clean_list(
                require_field(data, "include_terms"), "include_terms"
            ),
            exclude_terms=clean_list(data.get("exclude_terms"), "exclude_terms"),
            subcategory=optional_object(
                Subcategory, data.get("subcategory_id"), "subcategory_id"
            ),
            want_need_investment=clean_choice(
                data.get("want_need_investment"),
                "want_need_investment",
                WantNeedInvestment.CHOICES,
            ),
            is_ignored=parse_bool(data.get("is_ignored"), default=False),
            priority=clean_int(data.get("priority"), "priority", default=0),
            is_active=parse_bool(data.get("is_active"), default=True),
        )
        if data.get("tag_ids"):
            set_tags(keyword, data["tag_ids"])
        return json_response(serialize_keyword(keyword), status=201)


class KeywordDetailView(JsonView):
    def patch(self, request, pk):
        keyword = get_object_or_404(Keyword, id=pk)
        data = parse_json_body(request)
        for field in [
            "name",
            "include_terms",
            "exclude_terms",
            "want_need_investment",
            "is_ignored",
            "priority",
            "is_active",
        ]:
            if field in data:
                if field in {"include_terms", "exclude_terms"}:
                    setattr(keyword, field, clean_list(data[field], field))
                elif field == "want_need_investment":
                    setattr(
                        keyword,
                        field,
                        clean_choice(data[field], field, WantNeedInvestment.CHOICES),
                    )
                elif field in {"is_ignored", "is_active"}:
                    setattr(keyword, field, parse_bool(data[field]))
                elif field == "priority":
                    setattr(keyword, field, clean_int(data[field], field))
                else:
                    setattr(
                        keyword, field, clean_text(data[field], field, required=True)
                    )
        if "subcategory_id" in data:
            keyword.subcategory = optional_object(
                Subcategory, data["subcategory_id"], "subcategory_id"
            )
        keyword.save()
        if "tag_ids" in data:
            set_tags(keyword, data["tag_ids"])
        return json_response(serialize_keyword(keyword))

    def delete(self, request, pk):
        get_object_or_404(Keyword, id=pk).delete()
        return json_response({"deleted": True})


def filtered_transactions(request):
    queryset = (
        Transaction.objects.select_related(
            "bank_account", "subcategory", "subcategory__category"
        )
        .prefetch_related("tags")
        .all()
    )
    params = request.GET

    if not parse_bool(params.get("include_ignored"), default=False):
        queryset = queryset.filter(is_ignored=False)
    if not parse_bool(params.get("include_locked"), default=False):
        queryset = queryset.filter(is_categorization_locked=False)
    if params.get("date_from"):
        queryset = queryset.filter(
            transaction_date__gte=parse_date_value(params["date_from"], "date_from")
        )
    if params.get("date_to"):
        queryset = queryset.filter(
            transaction_date__lte=parse_date_value(params["date_to"], "date_to")
        )
    for field_name in [
        "direction",
        "want_need_investment",
        "bank_account",
        "category",
        "subcategory",
        "tag",
    ]:
        if filter_has_no_selection(params, field_name):
            return queryset.none()

    direction_values = filter_values(params, "direction")
    if direction_values:
        for value in direction_values:
            clean_choice(value, "direction", Direction.CHOICES, allow_blank=False)
        queryset = queryset.filter(direction__in=direction_values)
    wni_values, include_unassigned_wni = split_unassigned_filter(
        params, "want_need_investment"
    )
    if wni_values or include_unassigned_wni:
        wni_query = Q()
        if wni_values:
            for value in wni_values:
                clean_choice(
                    value,
                    "want_need_investment",
                    WantNeedInvestment.CHOICES,
                    allow_blank=False,
                )
            wni_query |= Q(want_need_investment__in=wni_values)
        if include_unassigned_wni:
            wni_query |= Q(want_need_investment__isnull=True) | Q(
                want_need_investment=""
            )
        queryset = queryset.filter(wni_query)

    bank_account_values = filter_values(params, "bank_account")
    if bank_account_values:
        queryset = queryset.filter(bank_account_id__in=bank_account_values)

    category_values, include_unassigned_category = split_unassigned_filter(
        params, "category"
    )
    if category_values or include_unassigned_category:
        category_query = Q()
        if category_values:
            category_query |= Q(subcategory__category_id__in=category_values)
        if include_unassigned_category:
            category_query |= Q(subcategory__isnull=True)
        queryset = queryset.filter(category_query)

    subcategory_values, include_unassigned_subcategory = split_unassigned_filter(
        params, "subcategory"
    )
    if subcategory_values or include_unassigned_subcategory:
        subcategory_query = Q()
        if subcategory_values:
            subcategory_query |= Q(subcategory_id__in=subcategory_values)
        if include_unassigned_subcategory:
            subcategory_query |= Q(subcategory__isnull=True)
        queryset = queryset.filter(subcategory_query)

    tag_values, include_unassigned_tags = split_unassigned_filter(params, "tag")
    if tag_values or include_unassigned_tags:
        tag_query = Q()
        if tag_values:
            tag_query |= Q(tags__id__in=tag_values)
        if include_unassigned_tags:
            tag_query |= Q(tags__isnull=True)
        queryset = queryset.filter(tag_query)
    if params.get("q"):
        query = params["q"]
        queryset = queryset.filter(
            Q(description__icontains=query)
            | Q(counterparty_name__icontains=query)
            | Q(counterparty_account_number__icontains=query)
            | Q(transaction_type__icontains=query)
            | Q(counterparty_note__icontains=query)
            | Q(my_note__icontains=query)
            | Q(other_note__icontains=query)
        )

    return queryset.distinct()


class TransactionCollectionView(JsonView):
    def get(self, request):
        queryset = filtered_transactions(request)
        settings_obj = FinanceSettings.load()
        split_by_owners = parse_bool(request.GET.get("split_by_owners"), default=False)
        limit = min(
            clean_int(request.GET.get("limit"), "limit", default=500, minimum=1), 10000
        )
        offset = clean_int(request.GET.get("offset"), "offset", default=0, minimum=0)
        count = queryset.count()
        items = queryset[offset : offset + limit]
        return json_response(
            {
                "count": count,
                "total_count": Transaction.objects.count(),
                "limit": limit,
                "offset": offset,
                "next_offset": offset + limit if offset + limit < count else None,
                "previous_offset": max(offset - limit, 0) if offset else None,
                "results": [
                    serialize_transaction(
                        transaction,
                        split_by_owners,
                        default_currency=settings_obj.default_currency,
                    )
                    for transaction in items
                ],
            }
        )

    def post(self, request):
        data = parse_json_body(request)
        transaction_obj = Transaction.objects.create(
            original_id=clean_text(data.get("original_id"), "original_id"),
            bank_account=optional_object(
                BankAccount, data.get("bank_account_id"), "bank_account_id"
            ),
            transaction_date=parse_date_value(
                require_field(data, "transaction_date"), "transaction_date"
            ),
            posted_date=parse_date_value(data.get("posted_date"), "posted_date"),
            description=clean_text(data.get("description"), "description"),
            amount=parse_decimal(require_field(data, "amount")),
            currency=clean_currency_code(data.get("currency", "CZK"), "currency"),
            counterparty_account_number=clean_text(
                data.get("counterparty_account_number"), "counterparty_account_number"
            ),
            counterparty_name=clean_text(
                data.get("counterparty_name"), "counterparty_name"
            ),
            transaction_type=clean_text(
                data.get("transaction_type"), "transaction_type"
            ),
            variable_symbol=clean_text(data.get("variable_symbol"), "variable_symbol"),
            specific_symbol=clean_text(data.get("specific_symbol"), "specific_symbol"),
            constant_symbol=clean_text(data.get("constant_symbol"), "constant_symbol"),
            counterparty_note=clean_text(
                data.get("counterparty_note"), "counterparty_note"
            ),
            my_note=clean_text(data.get("my_note"), "my_note"),
            other_note=clean_text(data.get("other_note"), "other_note"),
            subcategory=optional_object(
                Subcategory, data.get("subcategory_id"), "subcategory_id"
            ),
            want_need_investment=clean_choice(
                data.get("want_need_investment"),
                "want_need_investment",
                WantNeedInvestment.CHOICES,
            ),
            is_ignored=parse_bool(data.get("is_ignored"), default=False),
            raw_data=clean_dict(data.get("raw_data"), "raw_data"),
        )
        if "tag_ids" in data:
            set_tags(transaction_obj, data["tag_ids"])
        settings_obj = FinanceSettings.load()
        recalculate_transaction_conversions(
            Transaction.objects.filter(id=transaction_obj.id),
            default_currency=settings_obj.default_currency,
        )
        transaction_obj.refresh_from_db()
        return json_response(
            serialize_transaction(
                transaction_obj,
                default_currency=settings_obj.default_currency,
            ),
            status=201,
        )


class TransactionFilterMetadataView(JsonView):
    def get(self, request):
        oldest_date = (
            Transaction.objects.order_by("transaction_date")
            .values_list("transaction_date", flat=True)
            .first()
        )
        return json_response(
            {
                "oldest_transaction_date": oldest_date.isoformat()
                if oldest_date
                else None,
                "today": timezone.localdate().isoformat(),
            }
        )


class TransactionDetailView(JsonView):
    def patch(self, request, pk):
        transaction = get_object_or_404(
            Transaction.objects.select_related(
                "subcategory", "subcategory__category"
            ).prefetch_related("tags"),
            id=pk,
        )
        data = parse_json_body(request)
        lock_trigger_fields = {
            "subcategory_id",
            "want_need_investment",
            "tag_ids",
            "is_ignored",
        }
        should_lock_categorization = bool(lock_trigger_fields & data.keys())
        for field in [
            "description",
            "transaction_date",
            "posted_date",
            "counterparty_account_number",
            "counterparty_name",
            "transaction_type",
            "variable_symbol",
            "specific_symbol",
            "constant_symbol",
            "counterparty_note",
            "my_note",
            "other_note",
            "currency",
            "want_need_investment",
            "is_ignored",
        ]:
            if field in data:
                if field in {"transaction_date", "posted_date"}:
                    setattr(transaction, field, parse_date_value(data[field], field))
                elif field == "want_need_investment":
                    setattr(
                        transaction,
                        field,
                        clean_choice(data[field], field, WantNeedInvestment.CHOICES),
                    )
                elif field == "is_ignored":
                    setattr(transaction, field, parse_bool(data[field]))
                elif field == "currency":
                    setattr(
                        transaction,
                        field,
                        clean_currency_code(data[field], field),
                    )
                else:
                    setattr(transaction, field, clean_text(data[field], field))
        if "amount" in data:
            transaction.amount = parse_decimal(data["amount"])
        if "bank_account_id" in data:
            transaction.bank_account = optional_object(
                BankAccount, data["bank_account_id"], "bank_account_id"
            )
        if "subcategory_id" in data:
            transaction.subcategory = optional_object(
                Subcategory, data["subcategory_id"], "subcategory_id"
            )
        if "is_categorization_locked" in data:
            transaction.is_categorization_locked = parse_bool(
                data["is_categorization_locked"]
            )
        if should_lock_categorization:
            transaction.is_categorization_locked = True
        transaction.save()
        if "tag_ids" in data:
            set_tags(transaction, data["tag_ids"])
        settings_obj = FinanceSettings.load()
        recalculate_transaction_conversions(
            Transaction.objects.filter(id=transaction.id),
            default_currency=settings_obj.default_currency,
        )
        transaction.refresh_from_db()
        return json_response(
            serialize_transaction(
                transaction,
                default_currency=settings_obj.default_currency,
            )
        )

    def delete(self, request, pk):
        get_object_or_404(Transaction, id=pk).delete()
        return json_response({"deleted": True})


class RecategorizeTransactionsView(JsonView):
    def post(self, request):
        data = parse_json_body(request)
        transaction_ids = clean_list(data.get("transaction_ids"), "transaction_ids")
        include_locked = parse_bool(data.get("include_locked"), default=False)
        queryset = filtered_transactions(request)
        if transaction_ids:
            queryset = queryset.filter(id__in=transaction_ids)
        return json_response(
            recategorize_transactions(queryset, include_locked=include_locked)
        )


class BulkAssignTransactionsView(JsonView):
    def post(self, request):
        data = parse_json_body(request)
        assignment_type = clean_text(
            require_field(data, "assignment_type"), "assignment_type", required=True
        )
        queryset = filtered_transactions(request)
        transaction_ids = list(queryset.values_list("id", flat=True))
        updated_count = len(transaction_ids)

        if assignment_type == "subcategory":
            subcategory = optional_object(
                Subcategory, require_field(data, "subcategory_id"), "subcategory_id"
            )
            Transaction.objects.filter(id__in=transaction_ids).update(
                subcategory=subcategory,
                is_categorization_locked=True,
                updated_at=timezone.now(),
            )
            label = (
                f"{subcategory.category.name} / {subcategory.name}"
                if subcategory
                else "Unassigned"
            )
        elif assignment_type == "tag":
            tag = optional_object(Tag, require_field(data, "tag_id"), "tag_id")
            Transaction.objects.filter(id__in=transaction_ids).update(
                is_categorization_locked=True,
                updated_at=timezone.now(),
            )
            through_model = Transaction.tags.through
            through_model.objects.bulk_create(
                [
                    through_model(transaction_id=transaction_id, tag_id=tag.id)
                    for transaction_id in transaction_ids
                ],
                ignore_conflicts=True,
            )
            label = tag.name
        elif assignment_type == "want_need_investment":
            want_need_investment = clean_choice(
                require_field(data, "want_need_investment"),
                "want_need_investment",
                WantNeedInvestment.CHOICES,
                allow_blank=False,
            )
            Transaction.objects.filter(id__in=transaction_ids).update(
                want_need_investment=want_need_investment,
                is_categorization_locked=True,
                updated_at=timezone.now(),
            )
            label = dict(WantNeedInvestment.CHOICES)[want_need_investment]
        else:
            raise APIValidationError(
                "Invalid assignment type",
                {
                    "field": "assignment_type",
                    "allowed": ["subcategory", "tag", "want_need_investment"],
                },
            )

        return json_response(
            {
                "updated": updated_count,
                "assignment_type": assignment_type,
                "label": label,
            }
        )


def resolve_import_inputs(request):
    bank_account_id = request.POST.get("bank_account_id")
    csv_mapping_id = request.POST.get("csv_mapping_id")
    csv_file = request.FILES.get("csv_file")

    if not bank_account_id or not csv_file:
        raise APIValidationError(
            "bank_account_id and csv_file are required",
            {"fields": ["bank_account_id", "csv_file"]},
        )

    bank_account = optional_object(BankAccount, bank_account_id, "bank_account_id")
    csv_mapping = (
        optional_object(CSVMapping, csv_mapping_id, "csv_mapping_id")
        if csv_mapping_id
        else bank_account.default_csv_mapping
    )
    if not csv_mapping:
        raise APIValidationError(
            "Select a CSV mapping or set a default on the bank account.",
            {"field": "csv_mapping_id"},
        )

    return bank_account, csv_mapping, csv_file


class ImportPreviewView(JsonView):
    def post(self, request):
        bank_account, csv_mapping, csv_file = resolve_import_inputs(request)
        sample_size = clean_int(
            request.POST.get("sample_size"), "sample_size", default=10, minimum=1
        )
        service = CSVImportService(csv_mapping, bank_account)
        return json_response(
            service.preview_file(
                csv_file,
                source_filename=csv_file.name,
                sample_size=min(sample_size, 100),
            )
        )


class ImportTransactionsView(JsonView):
    def get(self, request):
        limit = min(
            clean_int(request.GET.get("limit"), "limit", default=8, minimum=1), 25
        )
        imports = CSVImport.objects.select_related(
            "bank_account", "csv_mapping"
        ).order_by("-created_at")[:limit]
        return json_response(
            [serialize_csv_import(csv_import) for csv_import in imports]
        )

    def post(self, request):
        bank_account, csv_mapping, csv_file = resolve_import_inputs(request)
        dry_run = parse_bool(request.POST.get("dry_run"), default=False)

        service = CSVImportService(csv_mapping, bank_account)
        csv_import, report = service.import_file(
            csv_file, csv_file.name, dry_run=dry_run
        )
        if dry_run:
            return json_response({"dry_run": True, "preview": report})
        exchange_rate_sync = {"attempted": False}
        if csv_import.status != csv_import.STATUS_FAILED and csv_import.created_count:
            exchange_rate_sync["attempted"] = True
            try:
                exchange_rate_sync.update(sync_missing_exchange_rates())
                exchange_rate_sync["synced"] = True
            except ExchangeRateProviderError as exc:
                exchange_rate_sync.update(
                    {
                        "synced": False,
                        "error": str(exc),
                    }
                )
        return json_response(
            {
                "import": serialize_csv_import(csv_import),
                "report": report,
                "exchange_rate_sync": exchange_rate_sync,
            },
            status=201 if csv_import.status != csv_import.STATUS_FAILED else 400,
        )


class KeywordPreviewView(JsonView):
    def post(self, request):
        data = parse_json_body(request)
        categorizer = CategorizationService()
        transaction_data = clean_dict(data.get("transaction_data"), "transaction_data")
        csv_mapping = optional_object(
            CSVMapping, data.get("csv_mapping_id"), "csv_mapping_id"
        )

        if data.get("text"):
            categorization_text = clean_text(data["text"], "text", required=True)
        else:
            if not transaction_data:
                raise APIValidationError(
                    "Provide text or transaction_data",
                    {"fields": ["text", "transaction_data"]},
                )
            categorization_text = categorizer.build_categorization_text(
                transaction_data, csv_mapping
            )

        result = categorizer.apply(categorization_text, transaction_data)
        return json_response(
            {
                "text": categorization_text,
                "categorization": serialize_categorization_result(result),
            }
        )


class DashboardSummaryView(JsonView):
    def get(self, request):
        split_by_owners = parse_bool(request.GET.get("split_by_owners"), default=False)
        settings_obj = FinanceSettings.load()
        return json_response(
            build_dashboard_summary(
                filtered_transactions(request),
                split_by_owners,
                default_currency=settings_obj.default_currency,
            )
        )


def maintenance_counts():
    return {
        "transactions": Transaction.objects.count(),
        "imports": CSVImport.objects.count(),
        "exchange_rates": ExchangeRate.objects.count(),
        "sample_transactions": Transaction.objects.filter(
            import_batch__source_filename=SAMPLE_IMPORT_SOURCE
        ).count(),
        "sample_imports": CSVImport.objects.filter(
            source_filename=SAMPLE_IMPORT_SOURCE
        ).count(),
        "sample_bank_accounts": BankAccount.objects.filter(
            name__startswith=SAMPLE_PREFIX
        ).count(),
        "sample_csv_mappings": CSVMapping.objects.filter(
            name__startswith=SAMPLE_PREFIX
        ).count(),
        "sample_categories": Category.objects.filter(
            name__startswith=SAMPLE_PREFIX
        ).count(),
        "sample_subcategories": Subcategory.objects.filter(
            name__startswith=SAMPLE_PREFIX
        ).count(),
        "sample_tags": Tag.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
        "sample_keywords": Keyword.objects.filter(
            name__startswith=SAMPLE_PREFIX
        ).count(),
        "bank_accounts": BankAccount.objects.count(),
        "csv_mappings": CSVMapping.objects.count(),
        "categories": Category.objects.count(),
        "subcategories": Subcategory.objects.count(),
        "tags": Tag.objects.count(),
        "keywords": Keyword.objects.count(),
        "saved_filters": SavedFilter.objects.count(),
    }


def require_confirmation(request, expected):
    data = parse_json_body(request)
    if data.get("confirmation") != expected:
        raise APIValidationError(
            "Confirmation text does not match",
            {"expected": expected},
        )


def delete_all_transactions():
    counts = {
        "transactions": Transaction.objects.count(),
        "imports": CSVImport.objects.count(),
    }
    with transaction.atomic():
        Transaction.objects.all().delete()
        CSVImport.objects.all().delete()
    return counts


def delete_all_finance_data():
    counts = maintenance_counts()
    with transaction.atomic():
        Transaction.objects.all().delete()
        CSVImport.objects.all().delete()
        Keyword.objects.all().delete()
        SavedFilter.objects.all().delete()
        ExchangeRate.objects.all().delete()
        BankAccount.objects.all().delete()
        CSVMapping.objects.all().delete()
        Tag.objects.all().delete()
        Subcategory.objects.all().delete()
        Category.objects.all().delete()
    return counts


class MaintenanceSummaryView(JsonView):
    def get(self, request):
        return json_response(maintenance_counts())


class MaintenanceSampleDataView(JsonView):
    def delete(self, request):
        require_confirmation(request, CONFIRM_DELETE_SAMPLE_DATA)
        return json_response(
            {
                "deleted": True,
                "counts": delete_sample_data(),
                "summary": maintenance_counts(),
            }
        )


class MaintenanceRecreateSampleDataView(JsonView):
    def post(self, request):
        result = seed_sample_data(reset_sample=True, skip_admin=True)
        return json_response(
            {
                "created": True,
                "result": result,
                "summary": maintenance_counts(),
            },
            status=201,
        )


class MaintenanceTransactionsView(JsonView):
    def delete(self, request):
        require_confirmation(request, CONFIRM_DELETE_ALL_TRANSACTIONS)
        return json_response(
            {
                "deleted": True,
                "counts": delete_all_transactions(),
                "summary": maintenance_counts(),
            }
        )


class MaintenanceFinanceDataView(JsonView):
    def delete(self, request):
        require_confirmation(request, CONFIRM_DELETE_ALL_FINANCE_DATA)
        return json_response(
            {
                "deleted": True,
                "counts": delete_all_finance_data(),
                "summary": maintenance_counts(),
            }
        )


class MaintenanceDatabaseBackupView(JsonView):
    def get(self, request):
        if connection.vendor != "sqlite":
            raise APIValidationError(
                "Database backup is only supported for SQLite",
                {"vendor": connection.vendor},
            )

        connection.ensure_connection()
        content = connection.connection.serialize()

        timestamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
        response = HttpResponse(content, content_type="application/x-sqlite3")
        response["Content-Disposition"] = (
            f'attachment; filename="cashmoney-backup-{timestamp}.sqlite3"'
        )
        return response


def validate_sqlite_backup(backup_path):
    candidate = None
    try:
        candidate = sqlite3.connect(str(backup_path))
        integrity = candidate.execute("PRAGMA integrity_check").fetchone()
        if not integrity or integrity[0] != "ok":
            raise APIValidationError(
                "Backup database failed integrity check",
                {"result": integrity[0] if integrity else None},
            )
        table_rows = candidate.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    except sqlite3.DatabaseError as exc:
        raise APIValidationError(
            "Uploaded file is not a valid SQLite database",
            {"filename": backup_path.name},
        ) from exc
    finally:
        if candidate is not None:
            candidate.close()

    tables = {row[0] for row in table_rows}
    missing = sorted(REQUIRED_BACKUP_TABLES - tables)
    if missing:
        raise APIValidationError(
            "Backup database does not match the Cashmoney schema",
            {"missing_tables": missing},
        )


def create_pre_restore_backup():
    connection.ensure_connection()
    timestamp = timezone.localtime().strftime("%Y%m%d-%H%M%S")
    backup_dir = Path(getattr(settings, "DATA_DIR", Path.cwd())) / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"pre-restore-{timestamp}.sqlite3"
    backup_path.write_bytes(connection.connection.serialize())
    return backup_path


class MaintenanceDatabaseRestoreView(JsonView):
    def post(self, request):
        if connection.vendor != "sqlite":
            raise APIValidationError(
                "Database restore is only supported for SQLite",
                {"vendor": connection.vendor},
            )
        if request.POST.get("confirmation") != CONFIRM_RESTORE_DATABASE:
            raise APIValidationError(
                "Confirmation text does not match",
                {"expected": CONFIRM_RESTORE_DATABASE},
            )
        backup_file = request.FILES.get("backup_file")
        if not backup_file:
            raise APIValidationError("Missing required field", {"field": "backup_file"})

        upload_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as upload:
                upload_path = Path(upload.name)
                for chunk in backup_file.chunks():
                    upload.write(chunk)

            validate_sqlite_backup(upload_path)
            pre_restore_path = create_pre_restore_backup()

            source = None
            try:
                connection.ensure_connection()
                source = sqlite3.connect(str(upload_path))
                source.backup(connection.connection)
            finally:
                if source is not None:
                    source.close()
            connection.close()
        finally:
            if upload_path and upload_path.exists():
                upload_path.unlink()

        return json_response(
            {
                "restored": True,
                "pre_restore_backup": str(pre_restore_path),
                "summary": maintenance_counts(),
            }
        )


def handler400(request, exception=None):
    return json_response({"error": "Bad request"}, status=400)


def handler500(request):
    return json_response({"error": "Server error"}, status=500)
