import csv
import io
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction

from .constants import DEFAULT_CATEGORIZATION_FIELDS
from .models import BankAccount, CSVImport, Keyword, Transaction
from .serializers import model_ref, serialize_tag, serialize_transaction


def normalize_text(value):
    return re.sub(r"\s+", "", str(value or "")).casefold()


def clean_account_number(value):
    return normalize_text(value).replace("/", "")


def coerce_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if item not in (None, "")]
    if isinstance(value, str):
        return [value] if value else []
    return [value]


def read_csv_rows_with_headers(csv_mapping, file_obj):
    raw = file_obj.read()
    if isinstance(raw, str):
        text = raw
    else:
        text = raw.decode(csv_mapping.encoding)

    text = text.replace("\ufeff", "")
    lines = text.splitlines()
    if not lines:
        raise ValueError("CSV file is empty")
    if csv_mapping.header_row >= len(lines):
        raise ValueError("Header row is outside the CSV file")

    lines = lines[csv_mapping.header_row :]

    reader = csv.DictReader(
        io.StringIO("\n".join(lines)),
        delimiter=csv_mapping.delimiter,
        quotechar=csv_mapping.quotechar,
    )
    if not reader.fieldnames:
        raise ValueError("CSV header row is missing")

    headers = [
        str(header).replace("\xa0", " ").strip() for header in reader.fieldnames
    ]

    rows = []
    for index, row in enumerate(reader, start=csv_mapping.header_row + 2):
        cleaned = {
            str(key).replace("\xa0", " ").strip(): (
                value.replace("\xa0", " ").strip()
                if isinstance(value, str)
                else value
            )
            for key, value in row.items()
            if key is not None
        }
        rows.append((index, cleaned))
    return rows, headers


def detect_csv_columns(csv_mapping, file_obj, sample_size=5):
    rows, headers = read_csv_rows_with_headers(csv_mapping, file_obj)
    return {
        "headers": headers,
        "loaded": len(rows),
        "sample_size": min(sample_size, len(rows)),
        "sample_rows": [
            {
                "line": line_number,
                "raw": {header: row.get(header, "") for header in headers},
            }
            for line_number, row in rows[:sample_size]
        ],
    }


@dataclass
class CategorizationResult:
    subcategory: object = None
    want_need_investment: str | None = None
    tags: list = field(default_factory=list)
    is_ignored: bool = False
    is_uncategorized: bool = False
    is_category_overlap: bool = False
    matched_keyword_ids: list[str] = field(default_factory=list)

    def transaction_values(self):
        return {
            "subcategory": self.subcategory,
            "want_need_investment": self.want_need_investment,
            "is_ignored": self.is_ignored,
        }


def serialize_categorization_result(result):
    if result.is_category_overlap:
        status = "conflict"
    elif result.is_ignored:
        status = "ignored"
    elif result.is_uncategorized:
        status = "uncategorized"
    else:
        status = "matched"

    category = result.subcategory.category if result.subcategory else None
    return {
        "status": status,
        "category": model_ref(category),
        "subcategory": model_ref(result.subcategory),
        "want_need_investment": result.want_need_investment,
        "tags": [serialize_tag(tag) for tag in result.tags],
        "is_ignored": result.is_ignored,
        "is_uncategorized": result.is_uncategorized,
        "is_conflict": result.is_category_overlap,
        "matched_keyword_ids": result.matched_keyword_ids,
    }


class CategorizationService:
    def __init__(self):
        self.keywords = list(
            Keyword.objects.filter(is_active=True)
            .select_related("subcategory", "subcategory__category")
            .prefetch_related("tags")
            .order_by("-priority", "name")
        )
        self.prepared_keywords = []
        for keyword in self.keywords:
            self.prepared_keywords.append(
                {
                    "keyword": keyword,
                    "include": [normalize_text(term) for term in keyword.include_terms if term],
                    "exclude": [normalize_text(term) for term in keyword.exclude_terms if term],
                }
            )

        self.own_account_numbers = {
            clean_account_number(value)
            for value in BankAccount.objects.values_list("account_number", flat=True)
            if value
        }

    def build_categorization_text(self, transaction_data, csv_mapping=None):
        if csv_mapping:
            fields = csv_mapping.get_categorization_fields()
        else:
            fields = DEFAULT_CATEGORIZATION_FIELDS

        parts = []
        for field_name in fields:
            value = transaction_data.get(field_name)
            if value not in (None, ""):
                parts.append(str(value))

        if not parts and transaction_data.get("description"):
            parts.append(str(transaction_data["description"]))

        return " | ".join(parts)

    def apply(self, categorization_text, transaction_data=None):
        result = CategorizationResult()
        transaction_data = transaction_data or {}

        counterparty_account = transaction_data.get("counterparty_account_number")
        if counterparty_account:
            if clean_account_number(counterparty_account) in self.own_account_numbers:
                result.is_ignored = True
                return result

        normalized_text = normalize_text(categorization_text)
        matched = []
        for prepared in self.prepared_keywords:
            include_terms = prepared["include"]
            exclude_terms = prepared["exclude"]

            if not include_terms:
                continue
            if not all(term in normalized_text for term in include_terms):
                continue
            if any(term in normalized_text for term in exclude_terms):
                continue

            matched.append(prepared["keyword"])

        if not matched:
            result.is_uncategorized = True
            return result

        highest_priority = matched[0].priority
        top_matches = [keyword for keyword in matched if keyword.priority == highest_priority]
        signatures = {
            (
                keyword.subcategory_id,
                keyword.want_need_investment,
                keyword.is_ignored,
            )
            for keyword in top_matches
        }

        if len(signatures) > 1:
            result.is_category_overlap = True
            result.matched_keyword_ids = [str(keyword.id) for keyword in top_matches]
            return result

        first = top_matches[0]
        result.subcategory = first.subcategory
        result.want_need_investment = first.want_need_investment
        result.is_ignored = first.is_ignored
        result.tags = sorted(
            {tag for keyword in top_matches for tag in keyword.tags.all()},
            key=lambda tag: tag.name.casefold(),
        )
        result.matched_keyword_ids = [str(keyword.id) for keyword in top_matches]
        return result


class CSVRowExtractor:
    def __init__(self, csv_mapping):
        self.csv_mapping = csv_mapping

    def get_value(self, row, logical_field, default=""):
        columns = coerce_list(self.csv_mapping.get_column(logical_field))
        if not columns:
            return default

        values = []
        for column in columns:
            value = row.get(str(column), "")
            if value not in (None, ""):
                values.append(str(value).strip())

        if not values:
            return default
        return " ".join(values).strip()

    def parse_date(self, value, required=False):
        value = str(value or "").strip()
        if not value:
            if required:
                raise ValueError("Transaction date is missing")
            return None

        formats = [self.csv_mapping.date_format]
        formats.extend(self.csv_mapping.fallback_date_formats or [])
        formats.extend(["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y"])

        for date_format in dict.fromkeys(formats):
            try:
                return datetime.strptime(value, date_format).date()
            except ValueError:
                continue

        try:
            return datetime.fromisoformat(value).date()
        except ValueError as exc:
            raise ValueError(f"Could not parse date '{value}'") from exc

    def parse_money(self, value):
        raw = str(value or "").replace("\xa0", " ").strip()
        if not raw:
            return Decimal("0.00")

        is_negative = raw.startswith("(") and raw.endswith(")")
        raw = raw.strip("()")
        raw = re.sub(r"[^\d,.\-]", "", raw)

        if self.csv_mapping.thousands_separator:
            raw = raw.replace(self.csv_mapping.thousands_separator, "")
        raw = raw.replace(" ", "")

        if self.csv_mapping.decimal_separator == ",":
            raw = raw.replace(".", "")
            raw = raw.replace(",", ".")
        else:
            raw = raw.replace(",", "")

        if not raw or raw == "-":
            return Decimal("0.00")

        try:
            amount = Decimal(raw).quantize(Decimal("0.01"))
        except InvalidOperation as exc:
            raise ValueError(f"Could not parse amount '{value}'") from exc

        return -amount if is_negative else amount

    def extract(self, row):
        amount = self.get_value(row, "amount", None)
        if amount in (None, ""):
            debit = self.get_value(row, "debit_amount", "")
            credit = self.get_value(row, "credit_amount", "")
            if debit:
                amount = -abs(self.parse_money(debit))
            elif credit:
                amount = abs(self.parse_money(credit))
            else:
                amount = Decimal("0.00")
        else:
            amount = self.parse_money(amount)

        transaction_date = self.parse_date(
            self.get_value(row, "transaction_date"), required=True
        )
        posted_date = self.parse_date(self.get_value(row, "posted_date"))

        currency = self.get_value(row, "currency", self.csv_mapping.default_currency)
        return {
            "original_id": self.get_value(row, "original_id"),
            "transaction_date": transaction_date,
            "posted_date": posted_date,
            "description": self.get_value(row, "description"),
            "amount": amount,
            "currency": (currency or self.csv_mapping.default_currency).upper()[:3],
            "counterparty_account_number": self.get_value(
                row, "counterparty_account_number"
            ),
            "counterparty_name": self.get_value(row, "counterparty_name"),
            "transaction_type": self.get_value(row, "transaction_type"),
            "variable_symbol": self.get_value(row, "variable_symbol"),
            "specific_symbol": self.get_value(row, "specific_symbol"),
            "constant_symbol": self.get_value(row, "constant_symbol"),
            "counterparty_note": self.get_value(row, "counterparty_note"),
            "my_note": self.get_value(row, "my_note"),
            "other_note": self.get_value(row, "other_note"),
        }


class CSVImportService:
    def __init__(self, csv_mapping, bank_account):
        self.csv_mapping = csv_mapping
        self.bank_account = bank_account
        self.extractor = CSVRowExtractor(csv_mapping)
        self.categorizer = CategorizationService()

    def import_file(self, file_obj, source_filename="", dry_run=False):
        if dry_run:
            return None, self.preview_file(file_obj, source_filename=source_filename)

        csv_import = CSVImport.objects.create(
            source_filename=source_filename,
            bank_account=self.bank_account,
            csv_mapping=self.csv_mapping,
        )

        report = {
            "loaded": 0,
            "created": {
                "count": 0,
                "transactions": [],
                "category_overlaps": [],
                "uncategorized": [],
            },
            "skipped": {
                "duplicates": [],
                "errors": [],
            },
        }

        try:
            rows = self._read_rows(file_obj)
        except Exception as exc:
            report["skipped"]["errors"].append({"error": str(exc)})
            csv_import.status = CSVImport.STATUS_FAILED
            csv_import.report = report
            csv_import.error_count = 1
            csv_import.save(
                update_fields=["status", "report", "error_count", "updated_at"]
            )
            return csv_import, report

        report["loaded"] = len(rows)

        for line_number, row in rows:
            try:
                created_transaction = self._import_row(row, csv_import)
            except IntegrityError:
                report["skipped"]["duplicates"].append(
                    {"line": line_number, "reason": "Duplicate original id", "row": row}
                )
                continue
            except Exception as exc:
                report["skipped"]["errors"].append(
                    {"line": line_number, "error": str(exc), "row": row}
                )
                continue

            if created_transaction is None:
                report["skipped"]["duplicates"].append(
                    {"line": line_number, "reason": "Possible duplicate", "row": row}
                )
                continue

            if created_transaction[0] is None:
                duplicate = created_transaction[1]
                report["skipped"]["duplicates"].append(
                    {
                        "line": line_number,
                        "reason": "Duplicate transaction",
                        "row": row,
                        "duplicate_transaction": self._duplicate_ref(duplicate),
                    }
                )
                continue

            transaction_obj, categorization = created_transaction
            serialized = serialize_transaction(transaction_obj)
            report["created"]["transactions"].append(serialized)

            if categorization.is_category_overlap:
                report["created"]["category_overlaps"].append(serialized)
            if categorization.is_uncategorized:
                report["created"]["uncategorized"].append(serialized)

        report["created"]["count"] = len(report["created"]["transactions"])
        csv_import.loaded_count = report["loaded"]
        csv_import.created_count = report["created"]["count"]
        csv_import.skipped_count = len(report["skipped"]["duplicates"])
        csv_import.error_count = len(report["skipped"]["errors"])
        csv_import.status = CSVImport.STATUS_COMPLETED
        csv_import.report = report
        csv_import.save()
        return csv_import, report

    def preview_file(self, file_obj, source_filename="", sample_size=10):
        rows, headers = self._read_rows_with_headers(file_obj)
        preview = {
            "source_filename": source_filename,
            "bank_account": model_ref(self.bank_account),
            "csv_mapping": model_ref(self.csv_mapping),
            "headers": headers,
            "loaded": len(rows),
            "sample_size": min(sample_size, len(rows)),
            "rows": [],
            "summary": {
                "valid": 0,
                "errors": 0,
                "duplicates": 0,
                "uncategorized": 0,
                "conflicts": 0,
                "ignored": 0,
            },
        }

        for line_number, row in rows[:sample_size]:
            row_preview = self.preview_row(line_number, row)
            preview["rows"].append(row_preview)
            if row_preview["status"] == "error":
                preview["summary"]["errors"] += 1
                continue

            preview["summary"]["valid"] += 1
            if row_preview["duplicate"]:
                preview["summary"]["duplicates"] += 1
            categorization = row_preview["categorization"]
            if categorization["is_uncategorized"]:
                preview["summary"]["uncategorized"] += 1
            if categorization["is_conflict"]:
                preview["summary"]["conflicts"] += 1
            if categorization["is_ignored"]:
                preview["summary"]["ignored"] += 1

        return preview

    def preview_row(self, line_number, row):
        try:
            data = self.extractor.extract(row)
            categorization_text = self.categorizer.build_categorization_text(
                data, self.csv_mapping
            )
            categorization = self.categorizer.apply(categorization_text, data)
            duplicate = self._find_duplicate(data)
            return {
                "line": line_number,
                "status": "valid",
                "raw": row,
                "parsed": self._serialize_parsed_data(data),
                "duplicate": bool(duplicate),
                "duplicate_transaction": self._duplicate_ref(duplicate),
                "categorization_text": categorization_text,
                "categorization": serialize_categorization_result(categorization),
            }
        except Exception as exc:
            return {
                "line": line_number,
                "status": "error",
                "raw": row,
                "error": str(exc),
            }

    def _read_rows(self, file_obj):
        rows, _headers = self._read_rows_with_headers(file_obj)
        return rows

    def _read_rows_with_headers(self, file_obj):
        return read_csv_rows_with_headers(self.csv_mapping, file_obj)

    def _find_duplicate(self, data):
        if data.get("original_id"):
            return Transaction.objects.filter(
                bank_account=self.bank_account,
                original_id=data["original_id"],
            ).first()

        return Transaction.objects.filter(
            bank_account=self.bank_account,
            transaction_date=data["transaction_date"],
            amount=data["amount"],
            description=data["description"],
            counterparty_account_number=data["counterparty_account_number"],
        ).first()

    def _is_duplicate(self, data):
        return self._find_duplicate(data) is not None

    def _duplicate_ref(self, transaction_obj):
        if not transaction_obj:
            return None
        return {
            "id": str(transaction_obj.id),
            "transaction_date": transaction_obj.transaction_date.isoformat(),
            "description": transaction_obj.description,
            "amount": float(transaction_obj.amount),
        }

    def _serialize_parsed_data(self, data):
        serialized = {}
        for key, value in data.items():
            if hasattr(value, "isoformat"):
                serialized[key] = value.isoformat()
            elif isinstance(value, Decimal):
                serialized[key] = float(value)
            else:
                serialized[key] = value
        return serialized

    @transaction.atomic
    def _import_row(self, row, csv_import):
        data = self.extractor.extract(row)
        duplicate = self._find_duplicate(data)
        if duplicate:
            return None, duplicate

        data["bank_account"] = self.bank_account
        data["import_batch"] = csv_import
        data["raw_data"] = row

        categorization_text = self.categorizer.build_categorization_text(
            data, self.csv_mapping
        )
        categorization = self.categorizer.apply(categorization_text, data)
        data.update(categorization.transaction_values())

        transaction_obj = Transaction.objects.create(**data)
        if categorization.tags:
            transaction_obj.tags.set(categorization.tags)

        return transaction_obj, categorization


def recategorize_transactions(queryset):
    categorizer = CategorizationService()
    stats = {
        "processed": 0,
        "updated": 0,
        "unchanged": 0,
        "uncategorized": 0,
        "conflicts": 0,
        "category_overlaps": 0,
        "skipped_no_mapping": 0,
        "updated_transaction_ids": [],
        "unchanged_transaction_ids": [],
        "conflict_transaction_ids": [],
        "uncategorized_transaction_ids": [],
        "skipped_transaction_ids": [],
    }

    for transaction_obj in queryset.select_related(
        "bank_account", "bank_account__default_csv_mapping"
    ).prefetch_related("tags"):
        stats["processed"] += 1
        csv_mapping = (
            transaction_obj.bank_account.default_csv_mapping
            if transaction_obj.bank_account
            else None
        )
        if not csv_mapping:
            stats["skipped_no_mapping"] += 1
            stats["skipped_transaction_ids"].append(str(transaction_obj.id))
            continue

        data = {
            "description": transaction_obj.description,
            "counterparty_name": transaction_obj.counterparty_name,
            "counterparty_account_number": transaction_obj.counterparty_account_number,
            "counterparty_note": transaction_obj.counterparty_note,
            "my_note": transaction_obj.my_note,
            "other_note": transaction_obj.other_note,
            "transaction_type": transaction_obj.transaction_type,
        }
        text = categorizer.build_categorization_text(data, csv_mapping)
        result = categorizer.apply(text, data)

        if result.is_uncategorized:
            stats["uncategorized"] += 1
            stats["uncategorized_transaction_ids"].append(str(transaction_obj.id))
        if result.is_category_overlap:
            stats["conflicts"] += 1
            stats["category_overlaps"] += 1
            stats["conflict_transaction_ids"].append(str(transaction_obj.id))
            continue

        scalar_changed = (
            transaction_obj.subcategory_id != getattr(result.subcategory, "id", None)
            or transaction_obj.want_need_investment != result.want_need_investment
            or transaction_obj.is_ignored != result.is_ignored
        )
        desired_tags = list(result.tags)
        desired_tag_ids = {tag.id for tag in desired_tags}
        current_tag_ids = {tag.id for tag in transaction_obj.tags.all()}
        tags_changed = current_tag_ids != desired_tag_ids

        if scalar_changed:
            transaction_obj.subcategory = result.subcategory
            transaction_obj.want_need_investment = result.want_need_investment
            transaction_obj.is_ignored = result.is_ignored
            transaction_obj.save(
                update_fields=[
                    "subcategory",
                    "want_need_investment",
                    "is_ignored",
                    "direction",
                    "updated_at",
                ]
            )
        if tags_changed:
            transaction_obj.tags.set(desired_tags)

        if scalar_changed or tags_changed:
            stats["updated"] += 1
            stats["updated_transaction_ids"].append(str(transaction_obj.id))
        else:
            stats["unchanged"] += 1
            stats["unchanged_transaction_ids"].append(str(transaction_obj.id))

    return stats


def build_dashboard_summary(queryset):
    summary = {
        "monthly": [],
        "income_categories": [],
        "expense_categories": [],
        "want_need_investment": [],
    }

    monthly = defaultdict(lambda: {"income": Decimal("0"), "expense": Decimal("0")})
    income_categories = defaultdict(lambda: defaultdict(Decimal))
    expense_categories = defaultdict(lambda: defaultdict(Decimal))
    wni = defaultdict(Decimal)

    for transaction_obj in queryset.select_related("subcategory", "subcategory__category"):
        month_key = transaction_obj.transaction_date.strftime("%Y-%m")
        amount = transaction_obj.amount
        category = transaction_obj.subcategory.category if transaction_obj.subcategory else None
        if amount >= 0:
            monthly[month_key]["income"] += amount
            category_name = category.name if category else "Uncategorized"
            subcategory_name = transaction_obj.subcategory.name if transaction_obj.subcategory else "Other"
            income_categories[category_name][subcategory_name] += amount
        else:
            absolute_amount = abs(amount)
            monthly[month_key]["expense"] += absolute_amount
            category_name = category.name if category else "Uncategorized"
            subcategory_name = transaction_obj.subcategory.name if transaction_obj.subcategory else "Other"
            expense_categories[category_name][subcategory_name] += absolute_amount

        if amount < 0:
            wni_key = transaction_obj.want_need_investment or "uncategorized"
            wni[wni_key] += abs(amount)

    for month, values in sorted(monthly.items()):
        summary["monthly"].append(
            {
                "month": month,
                "income": float(values["income"]),
                "expense": float(values["expense"]),
            }
        )

    summary["income_categories"] = _category_tree(income_categories)
    summary["expense_categories"] = _category_tree(expense_categories)
    summary["want_need_investment"] = [
        {"name": name, "amount": float(amount)}
        for name, amount in sorted(wni.items(), key=lambda item: item[0])
    ]
    return summary


def _category_tree(grouped_amounts):
    tree = []
    for category_name, subcategories in sorted(grouped_amounts.items()):
        children = [
            {"name": subcategory_name, "amount": float(amount)}
            for subcategory_name, amount in sorted(subcategories.items())
        ]
        tree.append(
            {
                "name": category_name,
                "amount": float(sum(subcategories.values(), Decimal("0"))),
                "children": children,
            }
        )
    return tree
