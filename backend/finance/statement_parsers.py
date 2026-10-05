"""Parsers for bank statement formats other than CSV.

Each parser returns rows keyed by logical transaction fields (see
``CAMT053_COLUMN_MAP``) so the regular import pipeline can extract, deduplicate
and categorize them exactly like mapped CSV rows.
"""

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

CAMT053_HEADERS = [
    "original_id",
    "transaction_date",
    "posted_date",
    "description",
    "amount",
    "currency",
    "counterparty_name",
    "counterparty_account_number",
    "transaction_type",
    "variable_symbol",
    "specific_symbol",
    "constant_symbol",
    "counterparty_note",
    "instructed_amount",
    "instructed_currency",
    "exchange_rate",
    "is_reversal",
]

BOOKED_STATUS = "BOOK"
OPENING_BALANCE_CODES = ("OPBD", "PRCD")
CLOSING_BALANCE_CODE = "CLBD"
SYMBOL_PREFIXES = {
    "VS": "variable_symbol",
    "SS": "specific_symbol",
    "KS": "constant_symbol",
}
CZECH_IBAN_RE = re.compile(r"^(CZ|SK)\d{2}(\d{4})(\d{6})(\d{10})$")
LOCAL_ACCOUNT_RE = re.compile(r"^(?:([^-/]*)-)?([^-/]+)/([^/]+)$")
MISSING_ACCOUNT_PARTS = {"", "null", "none"}


@dataclass
class StatementSummary:
    statement_id: str = ""
    account_iban: str = ""
    account_number: str = ""
    currency: str = ""
    from_date: str = ""
    to_date: str = ""
    opening_balance: Decimal | None = None
    closing_balance: Decimal | None = None
    entry_count: int = 0
    declared_entry_count: int | None = None
    booked_total: Decimal = Decimal("0.00")
    skipped_unbooked: int = 0

    def warnings(self):
        warnings = []
        label = self.statement_id or self.account_iban or "Statement"
        if (
            self.declared_entry_count is not None
            and self.declared_entry_count != self.entry_count
        ):
            warnings.append(
                f"{label}: statement declares {self.declared_entry_count} entries "
                f"but {self.entry_count} were found."
            )
        if self.opening_balance is not None and self.closing_balance is not None:
            expected = self.opening_balance + self.booked_total
            if expected != self.closing_balance and not self.skipped_unbooked:
                warnings.append(
                    f"{label}: opening balance {self.opening_balance} plus entries "
                    f"{self.booked_total} does not equal closing balance "
                    f"{self.closing_balance}."
                )
        if self.skipped_unbooked:
            warnings.append(
                f"{label}: skipped {self.skipped_unbooked} entries that are not booked yet."
            )
        return warnings

    def as_dict(self):
        def money(value):
            return None if value is None else str(value)

        return {
            "statement_id": self.statement_id,
            "account_iban": self.account_iban,
            "account_number": self.account_number,
            "currency": self.currency,
            "from_date": self.from_date,
            "to_date": self.to_date,
            "opening_balance": money(self.opening_balance),
            "closing_balance": money(self.closing_balance),
            "entry_count": self.entry_count,
            "declared_entry_count": self.declared_entry_count,
            "booked_total": money(self.booked_total),
            "skipped_unbooked": self.skipped_unbooked,
        }


@dataclass
class StatementParseResult:
    rows: list = field(default_factory=list)
    headers: list = field(default_factory=list)
    statements: list = field(default_factory=list)

    def warnings(self):
        return [
            warning for statement in self.statements for warning in statement.warnings()
        ]


def local_name(element):
    return element.tag.rsplit("}", 1)[-1]


def child(element, *path):
    """Follow child elements by local name, ignoring the camt.053 version namespace."""
    current = element
    for name in path:
        if current is None:
            return None
        current = next((item for item in current if local_name(item) == name), None)
    return current


def children(element, name):
    if element is None:
        return []
    return [item for item in element if local_name(item) == name]


def text(element, *path):
    node = child(element, *path) if path else element
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def parse_decimal(value, label):
    try:
        return Decimal(str(value).strip()).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(f"Could not parse {label} '{value}'") from exc


def signed_amount(amount_text, indicator, label="amount"):
    amount = parse_decimal(amount_text, label)
    if indicator == "DBIT":
        return -amount
    if indicator == "CRDT":
        return amount
    raise ValueError(f"Unknown credit/debit indicator '{indicator}'")


def date_value(element):
    """Return an ISO date from a camt date choice (Dt or DtTm)."""
    value = text(element, "Dt") or text(element, "DtTm")
    return value[:10]


def normalize_account(value):
    """Convert IBANs and local account strings to Cashmoney's prefix-number/bank form."""
    raw = re.sub(r"\s+", "", str(value or ""))
    if not raw:
        return ""

    iban_match = CZECH_IBAN_RE.match(raw.upper())
    if iban_match:
        _country, bank_code, prefix, number = iban_match.groups()
        return format_local_account(prefix, number, bank_code)

    local_match = LOCAL_ACCOUNT_RE.match(raw)
    if local_match:
        prefix, number, bank_code = local_match.groups()
        return format_local_account(prefix, number, bank_code)

    if raw.casefold() in MISSING_ACCOUNT_PARTS:
        return ""
    return raw


def format_local_account(prefix, number, bank_code):
    prefix = clean_account_part(prefix)
    number = clean_account_part(number)
    bank_code = clean_account_part(bank_code, strip_zeros=False)
    if not number:
        return ""
    account = f"{prefix}-{number}" if prefix else number
    return f"{account}/{bank_code}" if bank_code else account


def clean_account_part(value, strip_zeros=True):
    value = str(value or "").strip()
    if value.casefold() in MISSING_ACCOUNT_PARTS:
        return ""
    if strip_zeros and value.isdigit():
        return value.lstrip("0")
    return value


def account_id(account_element):
    identifier = child(account_element, "Id")
    return text(identifier, "IBAN") or text(identifier, "Othr", "Id")


def reject_document_type_declarations(raw):
    head = raw[:4096] if isinstance(raw, bytes) else raw[:4096].encode("utf-8")
    if b"<!DOCTYPE" in head.upper() or b"<!ENTITY" in head.upper():
        raise ValueError(
            "XML statements with DOCTYPE or ENTITY declarations are not supported"
        )


def parse_camt053(raw):
    if not raw or not raw.strip():
        raise ValueError("Statement file is empty")
    reject_document_type_declarations(raw)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError(f"Could not read XML statement: {exc}") from exc

    report = child(root, "BkToCstmrStmt")
    if local_name(root) != "Document" or report is None:
        raise ValueError("File is not a camt.053 bank-to-customer statement")

    result = StatementParseResult(headers=list(CAMT053_HEADERS))
    entry_number = 0
    for statement_element in children(report, "Stmt"):
        summary = parse_statement_summary(statement_element)
        for entry in children(statement_element, "Ntry"):
            entry_number += 1
            summary.entry_count += 1
            if text(entry, "Sts") not in ("", BOOKED_STATUS):
                summary.skipped_unbooked += 1
                continue
            try:
                row = parse_entry(entry)
            except ValueError as exc:
                raise ValueError(f"Entry {entry_number}: {exc}") from exc
            summary.booked_total += Decimal(row["amount"])
            result.rows.append((entry_number, row))
        result.statements.append(summary)

    if not result.statements:
        raise ValueError("The XML file contains no statements")
    return result


def parse_statement_summary(statement_element):
    account = child(statement_element, "Acct")
    iban = account_id(account)
    summary = StatementSummary(
        statement_id=text(statement_element, "Id"),
        account_iban=iban,
        account_number=normalize_account(iban),
        currency=text(account, "Ccy"),
        from_date=text(statement_element, "FrToDt", "FrDtTm")[:10],
        to_date=text(statement_element, "FrToDt", "ToDtTm")[:10],
    )
    declared = text(statement_element, "TxsSummry", "TtlNtries", "NbOfNtries")
    if declared.isdigit():
        summary.declared_entry_count = int(declared)

    for balance in children(statement_element, "Bal"):
        code = text(balance, "Tp", "CdOrPrtry", "Cd")
        amount = signed_amount(
            text(balance, "Amt"), text(balance, "CdtDbtInd"), "balance"
        )
        if code in OPENING_BALANCE_CODES and summary.opening_balance is None:
            summary.opening_balance = amount
        elif code == CLOSING_BALANCE_CODE:
            summary.closing_balance = amount
    return summary


def parse_entry(entry):
    indicator = text(entry, "CdtDbtInd")
    amount_element = child(entry, "Amt")
    amount = signed_amount(text(amount_element), indicator)
    details = child(entry, "NtryDtls", "TxDtls")
    parties = child(details, "RltdPties")

    # The counterparty is the creditor for outgoing payments and the debtor for
    # incoming ones.
    party_role, account_role = (
        ("Cdtr", "CdtrAcct") if indicator == "DBIT" else ("Dbtr", "DbtrAcct")
    )
    counterparty_name = text(parties, party_role, "Nm")
    counterparty_account = normalize_account(account_id(child(parties, account_role)))
    proprietary_party = text(parties, "Prtry", "Pty", "Nm")
    if proprietary_party and not counterparty_account:
        # Card payments are settled through an internal clearing account; the
        # merchant is only carried in the proprietary party.
        counterparty_name = proprietary_party

    messages = [
        text(item) for item in children(child(details, "RmtInf"), "Ustrd") if text(item)
    ]
    row = {
        "original_id": text(details, "Refs", "AcctSvcrRef") or text(entry, "NtryRef"),
        "transaction_date": date_value(child(entry, "BookgDt")),
        "posted_date": date_value(child(entry, "ValDt")),
        "description": " ".join(messages) or counterparty_name,
        "amount": str(amount),
        "currency": (amount_element.get("Ccy") if amount_element is not None else "")
        or "",
        "counterparty_name": counterparty_name,
        "counterparty_account_number": counterparty_account,
        "transaction_type": text(entry, "BkTxCd", "Prtry", "Cd")
        or text(entry, "BkTxCd", "Domn", "Cd"),
        "variable_symbol": "",
        "specific_symbol": "",
        "constant_symbol": "",
        "counterparty_note": " ".join(messages),
        "is_reversal": "true" if text(entry, "RvslInd") == "true" else "",
    }
    if messages and counterparty_name and counterparty_name not in row["description"]:
        row["description"] = f"{row['description']} {counterparty_name}"

    for structured in children(child(details, "RmtInf"), "Strd"):
        reference = text(structured, "CdtrRefInf", "Ref")
        prefix, _separator, value = reference.partition(":")
        field_name = SYMBOL_PREFIXES.get(prefix.strip().upper())
        if field_name and value.strip():
            row[field_name] = value.strip()

    instructed = child(details, "AmtDtls", "InstdAmt", "Amt")
    if (
        instructed is not None
        and instructed.get("Ccy")
        and instructed.get("Ccy") != row["currency"]
    ):
        row["instructed_amount"] = text(instructed)
        row["instructed_currency"] = instructed.get("Ccy")
        row["exchange_rate"] = text(
            details, "AmtDtls", "InstdAmt", "CcyXchg", "XchgRate"
        )

    if not row["transaction_date"]:
        raise ValueError(f"Entry {row['original_id'] or ''} has no booking date")
    return row
