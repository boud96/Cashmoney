class Direction:
    INCOME = "income"
    EXPENSE = "expense"

    CHOICES = [
        (INCOME, "Income"),
        (EXPENSE, "Expense"),
    ]


class WantNeedInvestment:
    WANT = "want"
    NEED = "need"
    INVESTMENT = "investment"

    CHOICES = [
        (WANT, "Want"),
        (NEED, "Need"),
        (INVESTMENT, "Investment"),
    ]


DEFAULT_CATEGORIZATION_FIELDS = [
    "description",
    "counterparty_name",
    "counterparty_account_number",
    "transaction_type",
    "variable_symbol",
    "specific_symbol",
    "constant_symbol",
    "counterparty_note",
    "my_note",
    "other_note",
]


class ImportFileFormat:
    CSV = "csv"
    CAMT053 = "camt053"

    CHOICES = [
        (CSV, "CSV"),
        (CAMT053, "camt.053 XML (ISO 20022)"),
    ]


# Statement parsers emit rows keyed by logical transaction fields, so non-CSV
# mappings use this fixed identity column map instead of user-mapped columns.
CAMT053_COLUMN_MAP = {
    field: field
    for field in [
        "original_id",
        "transaction_date",
        "posted_date",
        "description",
        "amount",
        "currency",
        "counterparty_account_number",
        "counterparty_name",
        "transaction_type",
        "variable_symbol",
        "specific_symbol",
        "constant_symbol",
        "counterparty_note",
    ]
}
