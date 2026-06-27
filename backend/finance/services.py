import csv
import io
import json
import re
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.db import IntegrityError, transaction
from django.db.models import Max, Min, Q
from django.utils import timezone

from .constants import DEFAULT_CATEGORIZATION_FIELDS
from .models import (
    BankAccount,
    CSVImport,
    ExchangeRate,
    FinanceSettings,
    InternalTransferMatch,
    Keyword,
    Transaction,
)
from .serializers import (
    model_ref,
    money,
    serialize_tag,
    serialize_transaction,
    transaction_converted_amount,
    transaction_display_amount,
)

ENCODING_CANDIDATES = ["utf-8-sig", "utf-8", "cp1250", "windows-1250", "latin-1"]
DELIMITER_CANDIDATES = [",", ";", "\t", "|"]
DATE_FORMAT_CANDIDATES = ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y"]
CANONICAL_RATE_BASE_CURRENCY = "EUR"
FRANKFURTER_SOURCE = ExchangeRate.SOURCE_FRANKFURTER
MONEY_QUANT = Decimal("0.01")
RATE_QUANT = Decimal("0.0000000001")
COMMON_CURRENCY_OPTIONS = [
    {"code": "CZK", "name": "Czech Koruna"},
    {"code": "EUR", "name": "Euro"},
    {"code": "USD", "name": "United States Dollar"},
    {"code": "GBP", "name": "British Pound"},
    {"code": "PLN", "name": "Polish Zloty"},
    {"code": "HUF", "name": "Hungarian Forint"},
    {"code": "CHF", "name": "Swiss Franc"},
]
UNCATEGORIZED_SUGGESTION_SAMPLE_SIZE = 5
UNCATEGORIZED_SUGGESTION_COUNT_WEIGHT = Decimal("25.00")
RECATEGORIZABLE_TRANSACTION_FIELDS = (
    "description",
    "counterparty_account_number",
    "counterparty_name",
    "transaction_type",
    "variable_symbol",
    "specific_symbol",
    "constant_symbol",
    "counterparty_note",
    "my_note",
    "other_note",
)
INTERNAL_TRANSFER_SYMBOL_FIELDS = (
    "variable_symbol",
    "specific_symbol",
    "constant_symbol",
)
INTERNAL_TRANSFER_SYMBOL_LABELS = {
    "constant_symbol": "Constant symbol match",
    "specific_symbol": "Specific symbol match",
    "variable_symbol": "Variable symbol match",
}
INTERNAL_TRANSFER_TEXT_FIELDS = (
    "counterparty_account_number",
    "description",
    "counterparty_name",
    "transaction_type",
    "variable_symbol",
    "specific_symbol",
    "constant_symbol",
    "counterparty_note",
    "my_note",
    "other_note",
)


def normalize_text(value):
    return re.sub(r"\s+", "", str(value or "")).casefold()


def clean_account_number(value):
    return re.sub(r"[^0-9a-z]+", "", str(value or "").casefold())


def clean_account_number_variants(value):
    raw_value = str(value or "")
    variants = {clean_account_number(raw_value)}
    if "/" in raw_value:
        account_without_bank_code = raw_value.rsplit("/", 1)[0]
        variants.add(clean_account_number(account_without_bank_code))
    return {variant for variant in variants if variant}


def coerce_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if item not in (None, "")]
    if isinstance(value, str):
        return [value] if value else []
    return [value]


def normalize_currency_code(value, default="CZK"):
    currency = re.sub(r"[^A-Za-z]", "", str(value or default)).upper()[:3]
    if len(currency) != 3:
        raise ValueError("Currency must be a three-letter code.")
    return currency


class ExchangeRateProviderError(Exception):
    pass


class FrankfurterExchangeRateProvider:
    api_base_url = "https://api.frankfurter.dev/v2"
    user_agent = "Cashmoney"

    def fetch_rates(self, base_currency, quote_currencies, start_date, end_date):
        quotes = sorted(
            {
                normalize_currency_code(currency)
                for currency in quote_currencies
                if currency and currency != base_currency
            }
        )
        if not quotes or not start_date or not end_date:
            return []

        params = {
            "from": start_date.isoformat(),
            "to": end_date.isoformat(),
            "base": normalize_currency_code(base_currency),
            "quotes": ",".join(quotes),
        }
        url = f"{self.api_base_url}/rates?{urlencode(params)}"
        payload = self._fetch_json(url)
        return self._parse_rates_payload(payload, params["base"])

    def fetch_currencies(self):
        payload = self._fetch_json(f"{self.api_base_url}/currencies")
        return self._parse_currencies_payload(payload)

    def _fetch_json(self, url):
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": self.user_agent,
            },
        )
        try:
            with urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            message = self._error_message(exc)
            raise ExchangeRateProviderError(
                f"Could not fetch Frankfurter data: {message}"
            ) from exc
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise ExchangeRateProviderError(
                f"Could not fetch Frankfurter data: {exc}"
            ) from exc
        return payload

    def _error_message(self, exc):
        try:
            raw = exc.read().decode("utf-8")
        except Exception:
            raw = ""
        if raw:
            try:
                payload = json.loads(raw)
                if isinstance(payload, dict) and payload.get("message"):
                    return f"{exc.code} {payload['message']}"
            except json.JSONDecodeError:
                pass
        return f"{exc.code} {exc.reason}"

    def _parse_rates_payload(self, payload, fallback_base):
        if isinstance(payload, list):
            return [self._normalize_rate_row(row, fallback_base) for row in payload]

        if not isinstance(payload, dict):
            raise ExchangeRateProviderError("Exchange-rate response was not JSON data.")

        rates = payload.get("rates")
        if isinstance(rates, dict):
            rows = []
            for date_key, date_rates in rates.items():
                if not isinstance(date_rates, dict):
                    continue
                for quote, rate in date_rates.items():
                    rows.append(
                        {
                            "date": date_key,
                            "base": payload.get("base", fallback_base),
                            "quote": quote,
                            "rate": rate,
                        }
                    )
            return [self._normalize_rate_row(row, fallback_base) for row in rows]

        if {"date", "base", "quote", "rate"} <= set(payload.keys()):
            return [self._normalize_rate_row(payload, fallback_base)]

        raise ExchangeRateProviderError("Exchange-rate response had an unknown shape.")

    def _parse_currencies_payload(self, payload):
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict):
            rows = [{"iso_code": code, "name": name} for code, name in payload.items()]
        else:
            raise ExchangeRateProviderError("Currency response had an unknown shape.")

        currencies = []
        seen = set()
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                code = normalize_currency_code(
                    row.get("iso_code") or row.get("code") or row.get("currency")
                )
            except ValueError:
                continue
            if code in seen:
                continue
            seen.add(code)
            currencies.append(
                {
                    "code": code,
                    "name": str(row.get("name") or code),
                }
            )
        return sorted(currencies, key=lambda item: item["code"])

    def _normalize_rate_row(self, row, fallback_base):
        try:
            return {
                "date": datetime.strptime(str(row["date"]), "%Y-%m-%d").date(),
                "base_currency": normalize_currency_code(
                    row.get("base", fallback_base)
                ),
                "quote_currency": normalize_currency_code(row["quote"]),
                "rate": Decimal(str(row["rate"])),
                "source": FRANKFURTER_SOURCE,
            }
        except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
            raise ExchangeRateProviderError(
                "Exchange-rate response included an invalid row."
            ) from exc


def merge_currency_options(*option_lists):
    options_by_code = {}
    for option_list in option_lists:
        for option in option_list:
            try:
                code = normalize_currency_code(option.get("code"))
            except ValueError:
                continue
            name = str(option.get("name") or code)
            options_by_code.setdefault(code, {"code": code, "name": name})
    return [options_by_code[code] for code in sorted(options_by_code)]


def configured_currency_options():
    settings = FinanceSettings.load()
    currencies = {settings.default_currency}
    currencies.update(
        currency
        for currency in Transaction.objects.exclude(currency="").values_list(
            "currency", flat=True
        )
        if currency
    )
    currencies.update(
        currency
        for currency in BankAccount.objects.exclude(currency="").values_list(
            "currency", flat=True
        )
        if currency
    )
    return [
        {
            "code": normalize_currency_code(currency),
            "name": normalize_currency_code(currency),
        }
        for currency in currencies
    ]


def available_currency_options(provider=None):
    provider = provider or FrankfurterExchangeRateProvider()
    currencies = provider.fetch_currencies()
    return {
        "source": FRANKFURTER_SOURCE,
        "fallback": False,
        "currencies": merge_currency_options(currencies, configured_currency_options()),
    }


def fallback_currency_options(error=None):
    return {
        "source": FRANKFURTER_SOURCE,
        "fallback": True,
        "error": str(error) if error else "",
        "currencies": merge_currency_options(
            COMMON_CURRENCY_OPTIONS,
            configured_currency_options(),
        ),
    }


def transaction_date_range(queryset=None):
    if queryset is None:
        queryset = Transaction.objects.all()
    return queryset.aggregate(
        start_date=Min("transaction_date"),
        end_date=Max("transaction_date"),
    )


def transaction_currencies(queryset=None, default_currency=None):
    if queryset is None:
        queryset = Transaction.objects.all()
    currencies = {
        normalize_currency_code(currency)
        for currency in queryset.exclude(currency="").values_list("currency", flat=True)
        if currency
    }
    currencies.add(
        normalize_currency_code(
            default_currency or FinanceSettings.load().default_currency
        )
    )
    return sorted(currencies)


def required_rate_quote_currencies(queryset=None, default_currency=None):
    default_currency = normalize_currency_code(
        default_currency or FinanceSettings.load().default_currency
    )
    if queryset is None:
        queryset = Transaction.objects.all()
    foreign_currencies = {
        normalize_currency_code(currency)
        for currency in queryset.exclude(currency="")
        .exclude(currency=default_currency)
        .values_list("currency", flat=True)
        if currency
    }
    if not foreign_currencies:
        return []

    currencies = set(foreign_currencies)
    currencies.add(default_currency)
    return sorted(
        currency for currency in currencies if currency != CANONICAL_RATE_BASE_CURRENCY
    )


def chunk_date_range(start_date, end_date, max_days=370):
    cursor = start_date
    while cursor <= end_date:
        chunk_end = min(cursor + timedelta(days=max_days - 1), end_date)
        yield cursor, chunk_end
        cursor = chunk_end + timedelta(days=1)


def cache_exchange_rate_rows(rows):
    rates = [
        ExchangeRate(
            date=row["date"],
            base_currency=normalize_currency_code(row["base_currency"]),
            quote_currency=normalize_currency_code(row["quote_currency"]),
            rate=Decimal(str(row["rate"])).quantize(RATE_QUANT),
            source=str(row.get("source") or FRANKFURTER_SOURCE).lower(),
        )
        for row in rows
        if row.get("base_currency") != row.get("quote_currency")
    ]
    if not rates:
        return 0

    before = ExchangeRate.objects.count()
    ExchangeRate.objects.bulk_create(rates, ignore_conflicts=True)
    return ExchangeRate.objects.count() - before


def build_rate_lookup(currencies, end_date):
    quote_currencies = [
        currency for currency in currencies if currency != CANONICAL_RATE_BASE_CURRENCY
    ]
    lookup = {}
    if not quote_currencies or not end_date:
        return lookup

    rates = (
        ExchangeRate.objects.filter(
            source=FRANKFURTER_SOURCE,
            base_currency=CANONICAL_RATE_BASE_CURRENCY,
            quote_currency__in=quote_currencies,
            date__lte=end_date,
        )
        .order_by("quote_currency", "date")
        .values_list("quote_currency", "date", "rate")
    )
    for quote_currency, rate_date, rate in rates:
        bucket = lookup.setdefault(quote_currency, {"dates": [], "rates": []})
        bucket["dates"].append(rate_date)
        bucket["rates"].append(rate)
    return lookup


def rate_on_or_before(lookup, currency, target_date):
    currency = normalize_currency_code(currency)
    if currency == CANONICAL_RATE_BASE_CURRENCY:
        return Decimal("1"), target_date
    bucket = lookup.get(currency)
    if not bucket:
        return None, None
    index = bisect_right(bucket["dates"], target_date) - 1
    if index < 0:
        return None, None
    return bucket["rates"][index], bucket["dates"][index]


def calculate_converted_amount(
    amount, source_currency, target_currency, target_date, lookup
):
    source_currency = normalize_currency_code(source_currency)
    target_currency = normalize_currency_code(target_currency)
    if source_currency == target_currency:
        return {
            "amount": amount.quantize(MONEY_QUANT),
            "rate": Decimal("1").quantize(RATE_QUANT),
            "rate_date": target_date,
            "status": Transaction.CONVERSION_STATUS_NATIVE,
        }

    source_rate, source_rate_date = rate_on_or_before(
        lookup, source_currency, target_date
    )
    target_rate, target_rate_date = rate_on_or_before(
        lookup, target_currency, target_date
    )
    if source_rate is None or target_rate is None:
        return {
            "amount": None,
            "rate": None,
            "rate_date": None,
            "status": Transaction.CONVERSION_STATUS_MISSING_RATE,
        }

    conversion_rate = (target_rate / source_rate).quantize(RATE_QUANT)
    rate_dates = []
    if source_currency != CANONICAL_RATE_BASE_CURRENCY:
        rate_dates.append(source_rate_date)
    if target_currency != CANONICAL_RATE_BASE_CURRENCY:
        rate_dates.append(target_rate_date)
    return {
        "amount": (amount * conversion_rate).quantize(MONEY_QUANT),
        "rate": conversion_rate,
        "rate_date": max(rate_dates) if rate_dates else target_date,
        "status": Transaction.CONVERSION_STATUS_CONVERTED,
    }


def recalculate_transaction_conversions(queryset=None, default_currency=None):
    default_currency = normalize_currency_code(
        default_currency or FinanceSettings.load().default_currency
    )
    if queryset is None:
        queryset = Transaction.objects.all()
    date_range = transaction_date_range(queryset)
    end_date = date_range["end_date"]
    if not end_date:
        return {
            "default_currency": default_currency,
            "processed": 0,
            "updated": 0,
            "missing_rates": 0,
        }

    currencies = transaction_currencies(queryset, default_currency)
    lookup = build_rate_lookup(currencies, end_date)
    processed = 0
    missing_rates = 0
    changed = []

    for transaction_obj in queryset:
        processed += 1
        result = calculate_converted_amount(
            transaction_obj.amount,
            transaction_obj.currency,
            default_currency,
            transaction_obj.transaction_date,
            lookup,
        )
        if result["status"] == Transaction.CONVERSION_STATUS_MISSING_RATE:
            missing_rates += 1
        next_values = {
            "converted_amount": result["amount"],
            "converted_currency": default_currency,
            "conversion_rate": result["rate"],
            "conversion_rate_date": result["rate_date"],
            "conversion_status": result["status"],
        }
        if any(
            getattr(transaction_obj, field) != value
            for field, value in next_values.items()
        ):
            for field, value in next_values.items():
                setattr(transaction_obj, field, value)
            transaction_obj.updated_at = timezone.now()
            changed.append(transaction_obj)

    if changed:
        Transaction.objects.bulk_update(
            changed,
            [
                "converted_amount",
                "converted_currency",
                "conversion_rate",
                "conversion_rate_date",
                "conversion_status",
                "updated_at",
            ],
        )

    return {
        "default_currency": default_currency,
        "processed": processed,
        "updated": len(changed),
        "missing_rates": missing_rates,
    }


def exchange_rate_status(default_currency=None):
    default_currency = normalize_currency_code(
        default_currency or FinanceSettings.load().default_currency
    )
    date_range = transaction_date_range()
    quote_currencies = required_rate_quote_currencies(default_currency=default_currency)
    cached_rates = ExchangeRate.objects.filter(
        source=FRANKFURTER_SOURCE,
        base_currency=CANONICAL_RATE_BASE_CURRENCY,
        quote_currency__in=quote_currencies,
    )
    cache_dates = cached_rates.aggregate(
        earliest_cached_rate_date=Min("date"),
        latest_cached_rate_date=Max("date"),
    )
    converted_filter = Q(converted_amount__isnull=True) | ~Q(
        converted_currency=default_currency
    )
    missing_converted_transactions = (
        Transaction.objects.exclude(currency=default_currency)
        .filter(converted_filter)
        .count()
    )
    return {
        "source": FRANKFURTER_SOURCE,
        "rate_base_currency": CANONICAL_RATE_BASE_CURRENCY,
        "default_currency": default_currency,
        "transaction_currencies": transaction_currencies(
            default_currency=default_currency
        ),
        "required_rate_currencies": quote_currencies,
        "transaction_date_from": date_range["start_date"],
        "transaction_date_to": date_range["end_date"],
        "cached_rate_count": cached_rates.count(),
        "earliest_cached_rate_date": cache_dates["earliest_cached_rate_date"],
        "latest_cached_rate_date": cache_dates["latest_cached_rate_date"],
        "missing_converted_transactions": missing_converted_transactions,
    }


def exchange_rate_fetch_plan(start_date, end_date, quote_currencies):
    plan = defaultdict(list)
    if not start_date or not end_date:
        return plan

    for quote_currency in quote_currencies:
        quote_currency = normalize_currency_code(quote_currency)
        cached_dates = ExchangeRate.objects.filter(
            source=FRANKFURTER_SOURCE,
            base_currency=CANONICAL_RATE_BASE_CURRENCY,
            quote_currency=quote_currency,
        ).aggregate(first_date=Min("date"), last_date=Max("date"))
        first_date = cached_dates["first_date"]
        last_date = cached_dates["last_date"]
        if not first_date or not last_date:
            plan[(start_date, end_date)].append(quote_currency)
            continue
        if first_date > start_date:
            plan[(start_date, first_date - timedelta(days=1))].append(quote_currency)
        if last_date < end_date:
            plan[(last_date + timedelta(days=1), end_date)].append(quote_currency)
    return plan


def sync_missing_exchange_rates(provider=None, default_currency=None):
    default_currency = normalize_currency_code(
        default_currency or FinanceSettings.load().default_currency
    )
    queryset = Transaction.objects.all()
    date_range = transaction_date_range(queryset)
    start_date = date_range["start_date"]
    end_date = date_range["end_date"]
    quotes = required_rate_quote_currencies(queryset, default_currency)
    created_rates = 0
    fetched_rows = 0

    fetch_plan = exchange_rate_fetch_plan(start_date, end_date, quotes)
    if fetch_plan:
        provider = provider or FrankfurterExchangeRateProvider()
        for (range_start, range_end), range_quotes in fetch_plan.items():
            for chunk_start, chunk_end in chunk_date_range(range_start, range_end):
                rows = provider.fetch_rates(
                    CANONICAL_RATE_BASE_CURRENCY,
                    range_quotes,
                    chunk_start,
                    chunk_end,
                )
                fetched_rows += len(rows)
                created_rates += cache_exchange_rate_rows(rows)

    recalculation = recalculate_transaction_conversions(
        queryset, default_currency=default_currency
    )
    return {
        "default_currency": default_currency,
        "fetched_rows": fetched_rows,
        "created_rates": created_rates,
        "recalculation": recalculation,
        "status": exchange_rate_status(default_currency),
    }


def mapped_transaction_values_from_raw_data(transaction_obj, csv_mapping):
    raw_data = transaction_obj.raw_data
    if not isinstance(raw_data, dict) or not raw_data:
        return {}

    extractor = CSVRowExtractor(csv_mapping)
    values = {}
    for field_name in RECATEGORIZABLE_TRANSACTION_FIELDS:
        if coerce_list(csv_mapping.get_column(field_name)):
            values[field_name] = extractor.get_value(raw_data, field_name)
    return values


def read_csv_rows_with_headers(csv_mapping, file_obj):
    raw = file_obj.read()
    if isinstance(raw, str):
        text = raw
    else:
        text = raw.decode(csv_mapping.encoding)
    return read_csv_rows_from_text(csv_mapping, text)


def read_csv_rows_from_text(csv_mapping, text):
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

    headers = [str(header).replace("\xa0", " ").strip() for header in reader.fieldnames]

    rows = []
    for index, row in enumerate(reader, start=csv_mapping.header_row + 2):
        cleaned = {
            str(key).replace("\xa0", " ").strip(): (
                value.replace("\xa0", " ").strip() if isinstance(value, str) else value
            )
            for key, value in row.items()
            if key is not None
        }
        rows.append((index, cleaned))
    return rows, headers


def detect_csv_columns(csv_mapping, file_obj, sample_size=5, autodetect_settings=False):
    warnings = []
    detected_settings = csv_mapping_settings(csv_mapping)
    if autodetect_settings:
        raw = file_obj.read()
        text, detected_settings, warnings = detect_csv_settings(
            raw,
            default_currency=csv_mapping.default_currency,
        )
        csv_mapping.delimiter = detected_settings["delimiter"]
        csv_mapping.quotechar = detected_settings["quotechar"]
        csv_mapping.encoding = detected_settings["encoding"]
        csv_mapping.header_row = detected_settings["header_row"]
        csv_mapping.date_format = detected_settings["date_format"]
        csv_mapping.decimal_separator = detected_settings["decimal_separator"]
        csv_mapping.thousands_separator = detected_settings["thousands_separator"]
        rows, headers = read_csv_rows_from_text(csv_mapping, text)
    else:
        rows, headers = read_csv_rows_with_headers(csv_mapping, file_obj)

    return {
        "detected_settings": detected_settings,
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
        "warnings": warnings,
    }


def csv_mapping_settings(csv_mapping):
    return {
        "delimiter": csv_mapping.delimiter,
        "quotechar": csv_mapping.quotechar,
        "encoding": csv_mapping.encoding,
        "header_row": csv_mapping.header_row,
        "date_format": csv_mapping.date_format,
        "decimal_separator": csv_mapping.decimal_separator,
        "thousands_separator": csv_mapping.thousands_separator,
    }


def detect_csv_settings(raw, default_currency="CZK"):
    text, encoding = decode_csv_text(raw)
    text = text.replace("\ufeff", "")
    if not text.strip():
        raise ValueError("CSV file is empty")

    delimiter, quotechar = detect_csv_dialect(text)
    header_row = detect_header_row(text, delimiter, quotechar)
    probe_mapping = type(
        "CSVMappingProbe",
        (),
        {
            "delimiter": delimiter,
            "quotechar": quotechar,
            "encoding": encoding,
            "header_row": header_row,
            "date_format": "%Y-%m-%d",
            "decimal_separator": ".",
            "thousands_separator": "",
            "default_currency": default_currency,
        },
    )()
    rows, headers = read_csv_rows_from_text(probe_mapping, text)
    values = [value for _, row in rows[:50] for value in row.values()]
    date_format, date_warning = detect_date_format(values)
    decimal_separator, thousands_separator, number_warning = detect_number_format(
        values
    )
    warnings = [warning for warning in [date_warning, number_warning] if warning]

    return (
        text,
        {
            "delimiter": delimiter,
            "quotechar": quotechar or '"',
            "encoding": encoding,
            "header_row": header_row,
            "date_format": date_format,
            "decimal_separator": decimal_separator,
            "thousands_separator": thousands_separator,
        },
        warnings,
    )


def decode_csv_text(raw):
    if isinstance(raw, str):
        return raw, "utf-8"

    for encoding in ENCODING_CANDIDATES:
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1"), "latin-1"


def detect_csv_dialect(text):
    sample = "\n".join(line for line in text.splitlines()[:30] if line.strip())
    fallback_delimiter = score_delimiter(text)[0]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters="".join(DELIMITER_CANDIDATES))
        delimiter = (
            dialect.delimiter
            if dialect.delimiter in DELIMITER_CANDIDATES
            else fallback_delimiter
        )
        quotechar = dialect.quotechar if dialect.quotechar else '"'
    except csv.Error:
        delimiter = fallback_delimiter
        quotechar = '"'
    return delimiter, quotechar


def score_delimiter(text):
    best = (",", -1)
    lines = [line for line in text.splitlines()[:40] if line.strip()]
    for delimiter in DELIMITER_CANDIDATES:
        counts = []
        for line in lines:
            try:
                cells = next(csv.reader([line], delimiter=delimiter, quotechar='"'))
            except csv.Error:
                continue
            counts.append(len(cells))
        multi_counts = [count for count in counts if count > 1]
        if not multi_counts:
            score = 0
        else:
            mode_count = max(set(multi_counts), key=multi_counts.count)
            score = (
                len(multi_counts) * 10
                + multi_counts.count(mode_count) * 4
                + mode_count
                - (max(multi_counts) - min(multi_counts))
            )
        if score > best[1]:
            best = (delimiter, score)
    return best


def detect_header_row(text, delimiter, quotechar):
    parsed_rows = []
    for line in text.splitlines()[:20]:
        try:
            parsed_rows.append(
                next(csv.reader([line], delimiter=delimiter, quotechar=quotechar))
            )
        except csv.Error:
            parsed_rows.append([line])

    best_index = 0
    best_score = -1
    for index, row in enumerate(parsed_rows):
        cells = [str(cell).strip() for cell in row if str(cell).strip()]
        if len(cells) < 2:
            continue
        next_row = next(
            (
                candidate
                for candidate in parsed_rows[index + 1 :]
                if len([cell for cell in candidate if str(cell).strip()]) >= 2
            ),
            [],
        )
        score = len(cells)
        if len(next_row) == len(row):
            score += 5
        if len(set(normalize_text(cell) for cell in cells)) == len(cells):
            score += 2
        score += sum(2 for cell in cells if looks_like_header_cell(cell))
        score -= sum(3 for cell in cells if looks_like_data_cell(cell))
        score += sum(1 for cell in next_row if looks_like_data_cell(cell))
        if score > best_score:
            best_index = index
            best_score = score
    return best_index


def looks_like_header_cell(value):
    normalized = normalize_text(value)
    known_terms = [
        "date",
        "datum",
        "amount",
        "castka",
        "popis",
        "description",
        "mena",
        "currency",
        "counterparty",
        "protistrana",
        "typ",
    ]
    return (
        bool(re.search(r"[^\W\d_]", str(value), flags=re.UNICODE))
        and not looks_like_data_cell(value)
        or any(term in normalized for term in known_terms)
    )


def looks_like_data_cell(value):
    text = str(value or "").strip()
    return is_date_like(text) or is_number_like(text)


def is_date_like(value):
    text = str(value or "").strip()
    if not text:
        return False
    if re.fullmatch(r"\d{1,2}[./-]\d{1,2}[./-]\d{2,4}", text):
        return True
    if re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", text):
        return True
    return False


def is_number_like(value):
    text = re.sub(r"[^\d,.\-\s()]", "", str(value or "").strip())
    return bool(re.fullmatch(r"\(?-?\s*\d[\d,.\s]*\)?", text))


def detect_date_format(values):
    scores = defaultdict(int)
    for value in values:
        text = str(value or "").strip()
        if not text or len(text) > 24:
            continue
        for date_format in DATE_FORMAT_CANDIDATES:
            try:
                datetime.strptime(text, date_format)
            except ValueError:
                continue
            scores[date_format] += 1

    if not scores:
        return "%Y-%m-%d", "Could not detect date format; using %Y-%m-%d."
    return max(DATE_FORMAT_CANDIDATES, key=lambda item: scores[item]), ""


def detect_number_format(values):
    decimal_scores = defaultdict(int)
    thousands_scores = defaultdict(int)
    for value in values:
        text = str(value or "").replace("\xa0", " ").strip()
        if not text or is_date_like(text):
            continue
        cleaned = re.sub(r"[^\d,.\-\s()]", "", text)
        if not re.search(r"\d", cleaned):
            continue
        comma = cleaned.rfind(",")
        dot = cleaned.rfind(".")
        if comma == -1 and dot == -1:
            if re.search(r"\d\s+\d{3}(\D|$)", cleaned):
                thousands_scores[" "] += 1
            continue

        decimal = None
        if comma != -1 and dot != -1:
            decimal = "," if comma > dot else "."
            thousands_scores["." if decimal == "," else ","] += 2
        else:
            separator = "," if comma != -1 else "."
            parts = cleaned.split(separator)
            tail = re.sub(r"\D", "", parts[-1])
            if len(tail) in {1, 2}:
                decimal = separator
            elif all(len(re.sub(r"\D", "", part)) == 3 for part in parts[1:]):
                thousands_scores[separator] += 1

        if decimal:
            decimal_scores[decimal] += 1
            integer_part = cleaned[: cleaned.rfind(decimal)]
            if re.search(r"\d\s+\d{3}(\D|$)", integer_part):
                thousands_scores[" "] += 2
            other_separator = "." if decimal == "," else ","
            if other_separator in integer_part:
                thousands_scores[other_separator] += 1

    if not decimal_scores:
        return ".", "", "Could not detect decimal separator; using dot."

    decimal_separator = "," if decimal_scores[","] > decimal_scores["."] else "."
    thousands_separator = ""
    if thousands_scores:
        thousands_separator = max(
            [" ", ".", ","], key=lambda item: thousands_scores[item]
        )
        if (
            thousands_separator == decimal_separator
            or thousands_scores[thousands_separator] == 0
        ):
            thousands_separator = ""
    return decimal_separator, thousands_separator, ""


@dataclass
class CategorizationResult:
    subcategory: object = None
    want_need_investment: str | None = None
    tags: list = field(default_factory=list)
    is_ignored: bool = False
    is_uncategorized: bool = False
    is_category_overlap: bool = False
    matched_keyword_ids: list[str] = field(default_factory=list)
    matched_keywords: list = field(default_factory=list)
    top_matched_keywords: list = field(default_factory=list)
    conflict_reason: str = ""

    def transaction_values(self):
        return {
            "subcategory": self.subcategory,
            "want_need_investment": self.want_need_investment,
            "is_ignored": self.is_ignored,
        }


def serialize_keyword_match(keyword, is_top_priority=False):
    category = keyword.subcategory.category if keyword.subcategory else None
    return {
        "id": str(keyword.id),
        "name": keyword.name,
        "priority": keyword.priority,
        "include_terms": keyword.include_terms,
        "exclude_terms": keyword.exclude_terms,
        "category": model_ref(category),
        "subcategory": model_ref(keyword.subcategory),
        "want_need_investment": keyword.want_need_investment,
        "is_ignored": keyword.is_ignored,
        "tags": [serialize_tag(tag) for tag in keyword.tags.all()],
        "is_top_priority": is_top_priority,
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
    top_keyword_ids = {keyword.id for keyword in result.top_matched_keywords}
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
        "matched_keywords": [
            serialize_keyword_match(keyword, keyword.id in top_keyword_ids)
            for keyword in result.matched_keywords
        ],
        "top_matched_keywords": [
            serialize_keyword_match(keyword, True)
            for keyword in result.top_matched_keywords
        ],
        "conflict_reason": result.conflict_reason,
    }


class CategorizationService:
    def __init__(self):
        self.settings = FinanceSettings.load()
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
                    "include": [
                        normalize_text(term) for term in keyword.include_terms if term
                    ],
                    "exclude": [
                        normalize_text(term) for term in keyword.exclude_terms if term
                    ],
                }
            )

        self.own_account_numbers = [
            {
                "id": account_id,
                "numbers": clean_account_number_variants(account_number),
            }
            for account_id, account_number in BankAccount.objects.values_list(
                "id", "account_number"
            )
            if account_number
        ]

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

        if self.has_internal_account_reference(categorization_text, transaction_data):
            if (
                self.settings.ignore_internal_account_references
                or self.settings.internal_transfer_subcategory_id
            ):
                result.is_ignored = self.settings.ignore_internal_account_references
                result.subcategory = self.settings.internal_transfer_subcategory
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

        result.matched_keywords = matched
        highest_priority = matched[0].priority
        top_matches = [
            keyword for keyword in matched if keyword.priority == highest_priority
        ]
        result.top_matched_keywords = top_matches
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
            result.conflict_reason = (
                f"{len(top_matches)} top-priority keywords assign different results."
            )
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

    def has_internal_account_reference(self, categorization_text, transaction_data):
        current_account = transaction_data.get("bank_account")
        current_account_id = getattr(current_account, "id", None)
        current_account_number = transaction_data.get("bank_account_account_number")
        if current_account and getattr(current_account, "account_number", None):
            current_account_number = current_account.account_number
        current_account_numbers = clean_account_number_variants(current_account_number)

        account_numbers = set()
        for account in self.own_account_numbers:
            if current_account_id and account["id"] == current_account_id:
                continue
            account_numbers.update(account["numbers"])
        if not current_account_id:
            account_numbers.difference_update(current_account_numbers)
        if not account_numbers:
            return False

        counterparty_accounts = clean_account_number_variants(
            transaction_data.get("counterparty_account_number")
        )
        if counterparty_accounts.intersection(account_numbers):
            return True

        normalized_text = clean_account_number(categorization_text)
        return any(
            account_number in normalized_text for account_number in account_numbers
        )


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


def strict_categorization_text(transaction_data, csv_mapping):
    parts = []
    for field_name in csv_mapping.get_categorization_fields():
        value = transaction_data.get(field_name)
        if value not in (None, ""):
            parts.append(str(value))
    return " | ".join(parts)


def uncategorized_suggestion_text(transaction_obj):
    csv_mapping = (
        transaction_obj.bank_account.default_csv_mapping
        if transaction_obj.bank_account
        else None
    )
    if not csv_mapping:
        return ""

    mapped_values = mapped_transaction_values_from_raw_data(
        transaction_obj, csv_mapping
    )
    data = {}
    for field_name in RECATEGORIZABLE_TRANSACTION_FIELDS:
        data[field_name] = mapped_values.get(
            field_name, getattr(transaction_obj, field_name)
        )
    return strict_categorization_text(data, csv_mapping)


def normalized_uncategorized_group_key(text):
    normalized = re.sub(r"[^\w]+", " ", str(text).casefold())
    normalized = normalized.replace("_", " ")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def transaction_suggestion_label(categorization_text):
    label = categorization_text or "No categorization text"
    return re.sub(r"\s+", " ", str(label)).strip() or "No description"


def group_suggestion_label(categorization_texts):
    labels = [transaction_suggestion_label(text) for text in categorization_texts]
    return sorted(labels, key=lambda label: (label.casefold(), label))[0]


def transaction_priority_amount(transaction_obj, default_currency):
    converted_amount = transaction_converted_amount(transaction_obj, default_currency)
    return converted_amount if converted_amount is not None else transaction_obj.amount


def suggested_keyword_name(label):
    clean_label = str(label or "Uncategorized").strip() or "Uncategorized"
    name = f"Categorize {clean_label}"
    return name[:128]


def build_uncategorized_suggestions(queryset, default_currency, limit=8):
    groups = defaultdict(lambda: {"texts": [], "transactions": []})
    for transaction_obj in queryset:
        categorization_text = uncategorized_suggestion_text(transaction_obj)
        group_key = normalized_uncategorized_group_key(categorization_text)
        if not group_key:
            continue
        groups[group_key]["texts"].append(categorization_text)
        groups[group_key]["transactions"].append(transaction_obj)

    suggestions = []
    for group_key, group in groups.items():
        transactions = group["transactions"]
        sorted_transactions = sorted(
            transactions,
            key=lambda item: (
                abs(transaction_priority_amount(item, default_currency)),
                item.transaction_date,
            ),
            reverse=True,
        )
        label = group_suggestion_label(group["texts"])
        amount_values = [
            transaction_priority_amount(transaction_obj, default_currency)
            for transaction_obj in transactions
        ]
        total_amount = sum(amount_values, Decimal("0.00"))
        absolute_total_amount = sum(
            (abs(amount) for amount in amount_values),
            Decimal("0.00"),
        )
        transaction_count = len(transactions)
        reason = (
            "Repeated categorization text"
            if transaction_count > 1
            else "Large uncategorized transaction"
        )
        score = absolute_total_amount + (
            Decimal(transaction_count) * UNCATEGORIZED_SUGGESTION_COUNT_WEIGHT
        )
        date_values = [
            transaction_obj.transaction_date for transaction_obj in transactions
        ]
        transaction_ids = [str(transaction_obj.id) for transaction_obj in transactions]
        suggestions.append(
            {
                "id": group_key,
                "reason": reason,
                "score": money(score),
                "transaction_count": transaction_count,
                "total_amount": money(total_amount),
                "absolute_total_amount": money(absolute_total_amount),
                "currency": default_currency,
                "sample_description": label,
                "date_from": min(date_values).isoformat(),
                "date_to": max(date_values).isoformat(),
                "transaction_ids": transaction_ids,
                "suggested_keyword": {
                    "name": suggested_keyword_name(label),
                    "include_terms": [label],
                    "exclude_terms": [],
                    "priority": 0,
                    "is_ignored": False,
                },
                "sample_transactions": [
                    serialize_transaction(
                        transaction_obj,
                        default_currency=default_currency,
                    )
                    for transaction_obj in sorted_transactions[
                        :UNCATEGORIZED_SUGGESTION_SAMPLE_SIZE
                    ]
                ],
            }
        )

    suggestions.sort(
        key=lambda item: (
            item["score"],
            item["transaction_count"],
            item["absolute_total_amount"],
        ),
        reverse=True,
    )
    return {
        "count": len(suggestions),
        "transaction_count": sum(
            len(group["transactions"]) for group in groups.values()
        ),
        "suggestions": suggestions[:limit],
    }


def internal_transfer_transaction_summary(transaction_obj):
    return {
        "id": str(transaction_obj.id),
        "transaction_date": transaction_obj.transaction_date.isoformat(),
        "description": transaction_obj.description,
        "amount": money(transaction_obj.amount),
        "currency": transaction_obj.currency,
        "bank_account": model_ref(transaction_obj.bank_account),
        "counterparty_account_number": transaction_obj.counterparty_account_number,
        "counterparty_name": transaction_obj.counterparty_name,
        "variable_symbol": transaction_obj.variable_symbol,
        "specific_symbol": transaction_obj.specific_symbol,
        "constant_symbol": transaction_obj.constant_symbol,
        "is_ignored": transaction_obj.is_ignored,
        "is_categorization_locked": transaction_obj.is_categorization_locked,
    }


def transaction_mentions_account(transaction_obj, account):
    if not transaction_obj or not account or not account.account_number:
        return False
    variants = {
        variant
        for variant in clean_account_number_variants(account.account_number)
        if variant
    }
    if not variants:
        return False
    for field_name in INTERNAL_TRANSFER_TEXT_FIELDS:
        normalized_value = clean_account_number(
            getattr(transaction_obj, field_name, "")
        )
        if normalized_value and any(
            variant in normalized_value for variant in variants
        ):
            return True
    return False


def shared_transfer_symbols(outgoing_transaction, incoming_transaction):
    matches = []
    for field_name in INTERNAL_TRANSFER_SYMBOL_FIELDS:
        outgoing_value = str(
            getattr(outgoing_transaction, field_name, "") or ""
        ).strip()
        incoming_value = str(
            getattr(incoming_transaction, field_name, "") or ""
        ).strip()
        if outgoing_value and incoming_value and outgoing_value == incoming_value:
            matches.append(field_name)
    return matches


def internal_transfer_confidence_label(score):
    if score >= 110:
        return "high"
    if score >= 85:
        return "medium"
    return "possible"


def internal_transfer_reason(label, tone="positive"):
    return {"label": label, "tone": tone}


def score_internal_transfer_candidate(
    outgoing_transaction,
    incoming_transaction,
    date_delta_days,
):
    score = 75
    reasons = [internal_transfer_reason("Same amount")]
    if (
        str(outgoing_transaction.currency or "").upper()
        != str(incoming_transaction.currency or "").upper()
    ):
        reasons.append(internal_transfer_reason("Different currency", "negative"))
    if date_delta_days == 0:
        score += 25
        reasons.append(internal_transfer_reason("Same day"))
    else:
        score += max(10, 22 - (date_delta_days * 3))
        reasons.append(
            internal_transfer_reason(
                f"{date_delta_days} day{'' if date_delta_days == 1 else 's'} apart",
                "negative",
            )
        )

    if transaction_mentions_account(
        outgoing_transaction, incoming_transaction.bank_account
    ):
        score += 35
        reasons.append(internal_transfer_reason("Outgoing account match"))
    if transaction_mentions_account(
        incoming_transaction, outgoing_transaction.bank_account
    ):
        score += 35
        reasons.append(internal_transfer_reason("Incoming account match"))

    symbol_matches = shared_transfer_symbols(outgoing_transaction, incoming_transaction)
    if symbol_matches:
        score += min(20, len(symbol_matches) * 10)
        reasons.extend(
            internal_transfer_reason(
                INTERNAL_TRANSFER_SYMBOL_LABELS.get(field_name, "Payment symbol match")
            )
            for field_name in symbol_matches
        )

    return score, reasons


def internal_transfer_candidate_records(
    queryset,
    date_tolerance_days=3,
    limit=100,
):
    date_tolerance_days = max(int(date_tolerance_days or 0), 0)
    base_queryset = (
        queryset.select_related("bank_account")
        .filter(bank_account__isnull=False)
        .exclude(outgoing_internal_transfer_match__isnull=False)
        .exclude(incoming_internal_transfer_match__isnull=False)
        .order_by("transaction_date", "created_at")
    )
    income_by_key = defaultdict(list)
    outgoing_transactions = []

    for transaction_obj in base_queryset:
        if transaction_obj.amount < 0:
            outgoing_transactions.append(transaction_obj)
        elif transaction_obj.amount > 0:
            key = (
                str(transaction_obj.currency or "").upper(),
                abs(transaction_obj.amount),
            )
            income_by_key[key].append(transaction_obj)

    records = []
    for outgoing_transaction in outgoing_transactions:
        key = (
            str(outgoing_transaction.currency or "").upper(),
            abs(outgoing_transaction.amount),
        )
        for incoming_transaction in income_by_key.get(key, []):
            if (
                outgoing_transaction.bank_account_id
                == incoming_transaction.bank_account_id
            ):
                continue
            date_delta_days = abs(
                (
                    incoming_transaction.transaction_date
                    - outgoing_transaction.transaction_date
                ).days
            )
            if date_delta_days > date_tolerance_days:
                continue
            score, reasons = score_internal_transfer_candidate(
                outgoing_transaction,
                incoming_transaction,
                date_delta_days,
            )
            records.append(
                {
                    "id": (f"{outgoing_transaction.id}:" f"{incoming_transaction.id}"),
                    "outgoing": outgoing_transaction,
                    "incoming": incoming_transaction,
                    "amount": abs(outgoing_transaction.amount),
                    "currency": str(outgoing_transaction.currency or "").upper(),
                    "date_delta_days": date_delta_days,
                    "confidence_score": score,
                    "match_reasons": reasons,
                }
            )

    outgoing_counts = Counter(record["outgoing"].id for record in records)
    incoming_counts = Counter(record["incoming"].id for record in records)
    for record in records:
        ambiguity_count = max(
            outgoing_counts[record["outgoing"].id],
            incoming_counts[record["incoming"].id],
        )
        record["is_ambiguous"] = ambiguity_count > 1
        record["possible_match_count"] = ambiguity_count
        if record["is_ambiguous"]:
            record["confidence_score"] = max(record["confidence_score"] - 25, 0)
            record["match_reasons"] = [
                *record["match_reasons"],
                internal_transfer_reason(
                    f"Possible {ambiguity_count} matches",
                    "negative",
                ),
            ]

    records.sort(
        key=lambda record: (
            record["confidence_score"],
            -record["date_delta_days"],
            str(record["outgoing"].transaction_date),
            str(record["incoming"].transaction_date),
        ),
        reverse=True,
    )
    return records[:limit]


def serialize_internal_transfer_candidate(record):
    return {
        "id": record["id"],
        "confidence_score": record["confidence_score"],
        "confidence_level": internal_transfer_confidence_label(
            record["confidence_score"]
        ),
        "match_reasons": record["match_reasons"],
        "date_delta_days": record["date_delta_days"],
        "is_ambiguous": record["is_ambiguous"],
        "possible_match_count": record["possible_match_count"],
        "amount": money(record["amount"]),
        "currency": record["currency"],
        "outgoing": internal_transfer_transaction_summary(record["outgoing"]),
        "incoming": internal_transfer_transaction_summary(record["incoming"]),
    }


def build_internal_transfer_candidates(
    queryset,
    date_tolerance_days=3,
    limit=100,
):
    records = internal_transfer_candidate_records(
        queryset,
        date_tolerance_days=date_tolerance_days,
        limit=limit,
    )
    serialized = [serialize_internal_transfer_candidate(record) for record in records]
    return {
        "count": len(serialized),
        "high_confidence_count": sum(
            1 for item in serialized if item["confidence_level"] == "high"
        ),
        "medium_confidence_count": sum(
            1 for item in serialized if item["confidence_level"] == "medium"
        ),
        "ambiguous_count": sum(1 for item in serialized if item["is_ambiguous"]),
        "date_tolerance_days": date_tolerance_days,
        "candidates": serialized,
    }


def serialize_internal_transfer_match(match):
    return {
        "id": str(match.id),
        "confidence_score": match.confidence_score,
        "match_reasons": match.match_reasons,
        "date_delta_days": match.date_delta_days,
        "outgoing": internal_transfer_transaction_summary(match.outgoing_transaction),
        "incoming": internal_transfer_transaction_summary(match.incoming_transaction),
        "created_at": match.created_at.isoformat(),
    }


@transaction.atomic
def apply_internal_transfer_candidates(
    queryset,
    candidate_ids,
    date_tolerance_days=3,
    internal_transfer_subcategory=None,
    subcategory_provided=False,
):
    requested_ids = {
        str(candidate_id) for candidate_id in candidate_ids if candidate_id
    }
    if not requested_ids:
        return {"created": 0, "skipped": 0, "matches": []}

    records = internal_transfer_candidate_records(
        queryset,
        date_tolerance_days=date_tolerance_days,
        limit=max(len(requested_ids) * 4, 100),
    )
    apply_subcategory = internal_transfer_subcategory
    if not subcategory_provided:
        apply_subcategory = FinanceSettings.load().internal_transfer_subcategory
    matched_records = []
    skipped = 0
    used_transaction_ids = set()

    for record in records:
        if record["id"] not in requested_ids:
            continue
        outgoing_transaction = record["outgoing"]
        incoming_transaction = record["incoming"]
        transaction_ids = {outgoing_transaction.id, incoming_transaction.id}
        if used_transaction_ids.intersection(transaction_ids):
            skipped += 1
            continue
        if InternalTransferMatch.objects.filter(
            Q(outgoing_transaction_id__in=transaction_ids)
            | Q(incoming_transaction_id__in=transaction_ids)
        ).exists():
            skipped += 1
            continue

        try:
            match = InternalTransferMatch.objects.create(
                outgoing_transaction=outgoing_transaction,
                incoming_transaction=incoming_transaction,
                confidence_score=record["confidence_score"],
                match_reasons=record["match_reasons"],
                date_delta_days=record["date_delta_days"],
            )
        except IntegrityError:
            skipped += 1
            continue

        update_values = {
            "is_ignored": True,
            "is_categorization_locked": True,
            "updated_at": timezone.now(),
        }
        if subcategory_provided or apply_subcategory:
            update_values["subcategory"] = apply_subcategory
        Transaction.objects.filter(id__in=transaction_ids).update(**update_values)
        used_transaction_ids.update(transaction_ids)
        match.outgoing_transaction.refresh_from_db()
        match.incoming_transaction.refresh_from_db()
        matched_records.append(match)

    return {
        "created": len(matched_records),
        "skipped": skipped,
        "matches": [
            serialize_internal_transfer_match(match) for match in matched_records
        ],
    }


def recategorize_transactions(queryset, include_locked=False):
    categorizer = CategorizationService()

    def transaction_summary(transaction_obj, data=None):
        return {
            "id": str(transaction_obj.id),
            "transaction_date": transaction_obj.transaction_date.isoformat(),
            "description": (
                data.get("description")
                if data is not None
                else transaction_obj.description
            ),
            "amount": float(transaction_obj.amount),
            "bank_account": model_ref(transaction_obj.bank_account),
        }

    stats = {
        "processed": 0,
        "updated": 0,
        "unchanged": 0,
        "uncategorized": 0,
        "conflicts": 0,
        "category_overlaps": 0,
        "skipped_no_mapping": 0,
        "skipped_locked": 0,
        "updated_transaction_ids": [],
        "unchanged_transaction_ids": [],
        "conflict_transaction_ids": [],
        "uncategorized_transaction_ids": [],
        "skipped_transaction_ids": [],
        "skipped_locked_transaction_ids": [],
        "updated_transactions": [],
        "unchanged_transactions": [],
        "uncategorized_transactions": [],
        "skipped_transactions": [],
        "skipped_locked_transactions": [],
        "conflict_details": [],
    }

    for transaction_obj in queryset.select_related(
        "bank_account", "bank_account__default_csv_mapping"
    ).prefetch_related("tags"):
        stats["processed"] += 1
        if transaction_obj.is_categorization_locked and not include_locked:
            stats["skipped_locked"] += 1
            stats["skipped_locked_transaction_ids"].append(str(transaction_obj.id))
            stats["skipped_locked_transactions"].append(
                transaction_summary(transaction_obj)
            )
            continue

        csv_mapping = (
            transaction_obj.bank_account.default_csv_mapping
            if transaction_obj.bank_account
            else None
        )
        if not csv_mapping:
            stats["skipped_no_mapping"] += 1
            stats["skipped_transaction_ids"].append(str(transaction_obj.id))
            stats["skipped_transactions"].append(transaction_summary(transaction_obj))
            continue

        mapped_values = mapped_transaction_values_from_raw_data(
            transaction_obj, csv_mapping
        )
        refreshed_fields = {
            field_name: value
            for field_name, value in mapped_values.items()
            if getattr(transaction_obj, field_name) != value
        }

        data = {
            "bank_account": transaction_obj.bank_account,
            "bank_account_account_number": (
                transaction_obj.bank_account.account_number
                if transaction_obj.bank_account
                else ""
            ),
        }
        for field_name in RECATEGORIZABLE_TRANSACTION_FIELDS:
            data[field_name] = mapped_values.get(
                field_name, getattr(transaction_obj, field_name)
            )
        text = categorizer.build_categorization_text(data, csv_mapping)
        result = categorizer.apply(text, data)

        if result.is_uncategorized:
            stats["uncategorized"] += 1
            stats["uncategorized_transaction_ids"].append(str(transaction_obj.id))
            stats["uncategorized_transactions"].append(
                transaction_summary(transaction_obj, data)
            )
        if result.is_category_overlap:
            stats["conflicts"] += 1
            stats["category_overlaps"] += 1
            stats["conflict_transaction_ids"].append(str(transaction_obj.id))
            stats["conflict_details"].append(
                {
                    "transaction": transaction_summary(transaction_obj, data),
                    "categorization_text": text,
                    "categorization": serialize_categorization_result(result),
                }
            )
            lock_changed = transaction_obj.is_categorization_locked and include_locked
            if refreshed_fields or lock_changed:
                for field_name, value in refreshed_fields.items():
                    setattr(transaction_obj, field_name, value)
                if lock_changed:
                    transaction_obj.is_categorization_locked = False
                lock_update_fields = (
                    ["is_categorization_locked"] if lock_changed else []
                )
                transaction_obj.save(
                    update_fields=[
                        *refreshed_fields.keys(),
                        *lock_update_fields,
                        "direction",
                        "updated_at",
                    ]
                )
                stats["updated"] += 1
                stats["updated_transaction_ids"].append(str(transaction_obj.id))
                stats["updated_transactions"].append(
                    transaction_summary(transaction_obj, data)
                )
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
        lock_changed = transaction_obj.is_categorization_locked and include_locked

        if scalar_changed or refreshed_fields or lock_changed:
            for field_name, value in refreshed_fields.items():
                setattr(transaction_obj, field_name, value)
            transaction_obj.subcategory = result.subcategory
            transaction_obj.want_need_investment = result.want_need_investment
            transaction_obj.is_ignored = result.is_ignored
            if lock_changed:
                transaction_obj.is_categorization_locked = False
            lock_update_fields = ["is_categorization_locked"] if lock_changed else []
            transaction_obj.save(
                update_fields=[
                    *refreshed_fields.keys(),
                    "subcategory",
                    "want_need_investment",
                    "is_ignored",
                    *lock_update_fields,
                    "direction",
                    "updated_at",
                ]
            )
        if tags_changed:
            transaction_obj.tags.set(desired_tags)

        if scalar_changed or refreshed_fields or tags_changed or lock_changed:
            stats["updated"] += 1
            stats["updated_transaction_ids"].append(str(transaction_obj.id))
            stats["updated_transactions"].append(
                transaction_summary(transaction_obj, data)
            )
        else:
            stats["unchanged"] += 1
            stats["unchanged_transaction_ids"].append(str(transaction_obj.id))
            stats["unchanged_transactions"].append(
                transaction_summary(transaction_obj, data)
            )

    return stats


def build_dashboard_summary(queryset, split_by_owners=False, default_currency=None):
    default_currency = normalize_currency_code(
        default_currency or FinanceSettings.load().default_currency
    )
    summary = {
        "default_currency": default_currency,
        "missing_conversions": 0,
        "monthly": [],
        "income_categories": [],
        "expense_categories": [],
        "want_need_investment": [],
    }

    monthly = defaultdict(lambda: {"income": Decimal("0"), "expense": Decimal("0")})
    income_categories = {}
    expense_categories = {}
    wni = defaultdict(Decimal)

    for transaction_obj in queryset.select_related(
        "bank_account", "subcategory", "subcategory__category"
    ):
        month_key = transaction_obj.transaction_date.strftime("%Y-%m")
        amount = transaction_display_amount(
            transaction_obj,
            split_by_owners,
            default_currency=default_currency,
            converted=True,
        )
        if amount is None:
            summary["missing_conversions"] += 1
            continue
        category = (
            transaction_obj.subcategory.category
            if transaction_obj.subcategory
            else None
        )
        if amount >= 0:
            monthly[month_key]["income"] += amount
            category_name = category.name if category else "Uncategorized"
            subcategory_name = (
                transaction_obj.subcategory.name
                if transaction_obj.subcategory
                else "Other"
            )
            _add_category_amount(
                income_categories,
                category_name,
                subcategory_name,
                amount,
                category.color if category else "",
                transaction_obj.subcategory.color
                if transaction_obj.subcategory
                else "",
            )
        else:
            absolute_amount = abs(amount)
            monthly[month_key]["expense"] += absolute_amount
            category_name = category.name if category else "Uncategorized"
            subcategory_name = (
                transaction_obj.subcategory.name
                if transaction_obj.subcategory
                else "Other"
            )
            _add_category_amount(
                expense_categories,
                category_name,
                subcategory_name,
                absolute_amount,
                category.color if category else "",
                transaction_obj.subcategory.color
                if transaction_obj.subcategory
                else "",
            )

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
    for category_name, category_data in sorted(grouped_amounts.items()):
        subcategories = category_data["children"]
        children = [
            {
                "name": subcategory_name,
                "amount": float(subcategory_data["amount"]),
                "color": subcategory_data["color"],
            }
            for subcategory_name, subcategory_data in sorted(subcategories.items())
        ]
        tree.append(
            {
                "name": category_name,
                "amount": float(category_data["amount"]),
                "color": category_data["color"],
                "children": children,
            }
        )
    return tree


def _add_category_amount(
    grouped_amounts,
    category_name,
    subcategory_name,
    amount,
    category_color,
    subcategory_color,
):
    category_data = grouped_amounts.setdefault(
        category_name,
        {"amount": Decimal("0"), "children": {}, "color": category_color},
    )
    if category_color and not category_data["color"]:
        category_data["color"] = category_color
    category_data["amount"] += amount
    subcategory_data = category_data["children"].setdefault(
        subcategory_name,
        {"amount": Decimal("0"), "color": subcategory_color},
    )
    if subcategory_color and not subcategory_data["color"]:
        subcategory_data["color"] = subcategory_color
    subcategory_data["amount"] += amount
