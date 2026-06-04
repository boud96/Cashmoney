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
    "counterparty_note",
    "my_note",
    "other_note",
    "transaction_type",
]

