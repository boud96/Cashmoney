from io import BytesIO

from django.db import transaction

from .constants import WantNeedInvestment
from .models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    FinanceSettings,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
)
from .services import CSVImportService


SAMPLE_PREFIX = "Sample - "
SAMPLE_IMPORT_SOURCE = f"{SAMPLE_PREFIX}initial demo data"
SAMPLE_DESCRIPTION = "Sample data"


def sample_name(value):
    return f"{SAMPLE_PREFIX}{value}"


@transaction.atomic
def delete_sample_data():
    """Delete the first-launch sample data, keeping sample items the user adopted.

    Sample objects are the ones the seeder flagged with is_sample. Sample
    transactions and imports always go. A sample definition is kept when the user
    renamed it or when their own data still uses it, so deleting it can't
    uncategorize or orphan real transactions. Kept items lose the flag and count as
    the user's own from then on.

    Returns {"counts": {...deleted per type}, "kept": [{"type", "name", "reason"}]}.
    """
    counts = {}
    kept = []

    sample_imports = CSVImport.objects.filter(is_sample=True)
    sample_transactions = Transaction.objects.filter(import_batch__in=sample_imports)
    counts["transactions"] = sample_transactions.count()
    sample_transactions.delete()
    counts["imports"] = sample_imports.count()
    sample_imports.delete()

    def delete_unless_used(model, kind, count_key, reason_to_keep):
        deleted = 0
        for obj in model.objects.filter(is_sample=True).order_by("name"):
            if not obj.name.startswith(SAMPLE_PREFIX):
                reason = "you renamed it"
            else:
                reason = reason_to_keep(obj)
            if reason:
                # Adopted: from now on it's the user's own data, not sample data.
                model.objects.filter(pk=obj.pk).update(is_sample=False)
                kept.append({"type": kind, "name": obj.name, "reason": reason})
            else:
                obj.delete()
                deleted += 1
        counts[count_key] = deleted

    def account_reason(account):
        return "it has your transactions" if account.transactions.exists() else ""

    def mapping_reason(mapping):
        if BankAccount.objects.filter(default_csv_mapping=mapping).exists():
            return "an account uses it as its default mapping"
        if CSVImport.objects.filter(csv_mapping=mapping).exists():
            return "your imports used it"
        return ""

    def tag_reason(tag):
        if Transaction.objects.filter(tags=tag).exists():
            return "your transactions have it"
        if tag.keywords.exists():
            return "your keywords add it"
        return ""

    transfer_subcategory_id = FinanceSettings.load().internal_transfer_subcategory_id

    def subcategory_reason(subcategory):
        if subcategory.transactions.exists():
            return "your transactions use it"
        if subcategory.keywords.exists():
            return "your keywords use it"
        if subcategory.id == transfer_subcategory_id:
            return "it is the internal-transfer subcategory"
        return ""

    def category_reason(category):
        return "it still has subcategories" if category.subcategories.exists() else ""

    # Order matters: each step sees only what the earlier steps left behind.
    delete_unless_used(Keyword, "keyword", "keywords", lambda keyword: "")
    delete_unless_used(BankAccount, "bank account", "bank_accounts", account_reason)
    delete_unless_used(CSVMapping, "mapping", "csv_mappings", mapping_reason)
    delete_unless_used(Tag, "tag", "tags", tag_reason)
    delete_unless_used(Subcategory, "subcategory", "subcategories", subcategory_reason)
    delete_unless_used(Category, "category", "categories", category_reason)
    return {"counts": counts, "kept": kept}


@transaction.atomic
def seed_sample_data(*, if_empty=False, reset_sample=False):
    if reset_sample:
        delete_sample_data()

    if if_empty and Transaction.objects.exists():
        return {"skipped": True, "reason": "Database already has transactions"}

    mappings = create_csv_mappings()
    accounts = create_bank_accounts(mappings["standard"])
    categories = create_categories()
    subcategories = create_subcategories(categories)
    tags = create_tags()
    create_keywords(subcategories, tags)
    created_count = create_sample_transactions(mappings["standard"], accounts)

    return {
        "created_transactions": created_count,
        "skipped": False,
    }


def create_csv_mappings():
    common_fields = [
        "description",
        "counterparty_name",
        "my_note",
        "other_note",
        "transaction_type",
    ]
    standard, _created = CSVMapping.objects.update_or_create(
        name=sample_name("Standard CSV Mapping"),
        defaults={
            "is_sample": True,
            "description": SAMPLE_DESCRIPTION,
            "delimiter": ",",
            "quotechar": '"',
            "encoding": "utf-8-sig",
            "header_row": 0,
            "date_format": "%Y-%m-%d",
            "decimal_separator": ".",
            "thousands_separator": "",
            "default_currency": "CZK",
            "column_map": {
                "original_id": "ID",
                "transaction_date": "Date",
                "posted_date": "Posted",
                "description": "Description",
                "amount": "Amount",
                "currency": "Currency",
                "counterparty_name": "Counterparty",
                "counterparty_account_number": "Counterparty Account",
                "transaction_type": "Type",
                "my_note": "My Note",
                "other_note": "Other Note",
            },
            "categorization_fields": common_fields,
        },
    )
    airbank, _created = CSVMapping.objects.update_or_create(
        name=sample_name("Airbank Style CSV Mapping"),
        defaults={
            "is_sample": True,
            "description": SAMPLE_DESCRIPTION,
            "delimiter": ";",
            "quotechar": '"',
            "encoding": "utf-8-sig",
            "header_row": 0,
            "date_format": "%d.%m.%Y",
            "decimal_separator": ",",
            "thousands_separator": " ",
            "default_currency": "CZK",
            "column_map": {
                "original_id": "Identifikace transakce",
                "transaction_date": "Datum zauctovani",
                "posted_date": "Datum provedeni",
                "description": "Popis",
                "amount": "Castka",
                "currency": "Mena",
                "counterparty_name": "Nazev protiuctu",
                "counterparty_account_number": "Cislo protiuctu",
                "transaction_type": "Typ transakce",
                "my_note": "Poznamka",
            },
            "categorization_fields": [
                "description",
                "counterparty_name",
                "my_note",
                "transaction_type",
            ],
        },
    )
    return {"standard": standard, "airbank": airbank}


def create_bank_accounts(default_mapping):
    specs = [
        ("Main Checking", "1111111111/0100", "Demo Bank", 1),
        ("Shared Household", "2222222222/0100", "Demo Bank", 2),
        ("Savings", "3333333333/0100", "Demo Bank", 1),
    ]
    accounts = {}
    for label, account_number, bank_name, owners in specs:
        account, _created = BankAccount.objects.update_or_create(
            account_number=account_number,
            defaults={
                "is_sample": True,
                "name": sample_name(label),
                "bank_name": bank_name,
                "currency": "CZK",
                "owners": owners,
                "default_csv_mapping": default_mapping,
            },
        )
        accounts[label] = account
    return accounts


def create_categories():
    specs = [
        ("Income", "#2F8F65"),
        ("Food", "#C96E26"),
        ("Home", "#2F6F9F"),
        ("Lifestyle", "#7655A6"),
        ("Savings", "#B1842F"),
    ]
    categories = {}
    for label, color in specs:
        category, _created = Category.objects.update_or_create(
            name=sample_name(label),
            defaults={
                "is_sample": True,
                "description": SAMPLE_DESCRIPTION,
                "color": color,
            },
        )
        categories[label] = category
    return categories


def create_subcategories(categories):
    specs = {
        "Income": ["Salary", "Refund"],
        "Food": ["Groceries", "Restaurants", "Coffee"],
        "Home": ["Rent", "Utilities"],
        "Lifestyle": ["Entertainment", "Travel", "Shopping"],
        "Savings": ["Emergency Fund", "Investment"],
    }
    subcategories = {}
    for category_label, labels in specs.items():
        for label in labels:
            subcategory, _created = Subcategory.objects.update_or_create(
                category=categories[category_label],
                name=sample_name(label),
                defaults={"is_sample": True, "description": SAMPLE_DESCRIPTION},
            )
            subcategories[(category_label, label)] = subcategory
    return subcategories


def create_tags():
    specs = [
        ("Recurring", "#228BE6"),
        ("Family", "#AE3EC9"),
        ("Vacation", "#1C7ED6"),
        ("Subscription", "#E8590C"),
        ("Demo Import", "#495057"),
    ]
    tags = {}
    for label, color in specs:
        tag, _created = Tag.objects.update_or_create(
            name=sample_name(label),
            defaults={
                "is_sample": True,
                "description": SAMPLE_DESCRIPTION,
                "color": color,
            },
        )
        tags[label] = tag
    return tags


def create_keywords(subcategories, tags):
    specs = [
        (
            "Salary",
            ["salary", "payroll"],
            "Income",
            "Salary",
            None,
            False,
            ["Recurring"],
        ),
        ("Refund", ["refund"], "Income", "Refund", None, False, ["Demo Import"]),
        (
            "Groceries",
            ["groceries", "tesco"],
            "Food",
            "Groceries",
            WantNeedInvestment.NEED,
            False,
            ["Family"],
        ),
        (
            "Restaurants",
            ["restaurant", "bistro"],
            "Food",
            "Restaurants",
            WantNeedInvestment.WANT,
            False,
            ["Demo Import"],
        ),
        (
            "Coffee",
            ["coffee"],
            "Food",
            "Coffee",
            WantNeedInvestment.WANT,
            False,
            ["Demo Import"],
        ),
        (
            "Rent",
            ["rent"],
            "Home",
            "Rent",
            WantNeedInvestment.NEED,
            False,
            ["Recurring"],
        ),
        (
            "Utilities",
            ["electricity", "internet"],
            "Home",
            "Utilities",
            WantNeedInvestment.NEED,
            False,
            ["Recurring"],
        ),
        (
            "Travel",
            ["hotel", "flight"],
            "Lifestyle",
            "Travel",
            WantNeedInvestment.WANT,
            False,
            ["Vacation"],
        ),
        (
            "Investment",
            ["investment", "etf"],
            "Savings",
            "Investment",
            WantNeedInvestment.INVESTMENT,
            False,
            ["Recurring"],
        ),
        (
            "Internal Transfer",
            ["transfer", "savings"],
            None,
            None,
            None,
            True,
            ["Demo Import"],
        ),
    ]

    for priority, spec in enumerate(specs, start=1):
        label, terms, category_label, subcategory_label, wni, is_ignored, tag_labels = (
            spec
        )
        subcategory = None
        if category_label and subcategory_label:
            subcategory = subcategories[(category_label, subcategory_label)]
        keyword, _created = Keyword.objects.update_or_create(
            name=sample_name(label),
            defaults={
                "is_sample": True,
                "include_terms": terms,
                "exclude_terms": [],
                "subcategory": subcategory,
                "want_need_investment": wni,
                "is_ignored": is_ignored,
                "priority": 100 - priority,
                "is_active": True,
            },
        )
        keyword.tags.set([tags[label] for label in tag_labels])


def create_sample_transactions(mapping, accounts):
    if CSVImport.objects.filter(is_sample=True).exists():
        return 0

    rows = [
        (
            "sample-001",
            "2026-01-02",
            "Sample - Salary January",
            "82000.00",
            "Sample Payroll",
            "9000000000/0100",
            "Incoming payment",
            "salary",
            "",
        ),
        (
            "sample-002",
            "2026-01-04",
            "Sample - Tesco groceries",
            "-1842.40",
            "Sample Tesco",
            "8100000000/0100",
            "Card payment",
            "groceries",
            "",
        ),
        (
            "sample-003",
            "2026-01-06",
            "Sample - Apartment rent",
            "-28000.00",
            "Sample Landlord",
            "8300000000/0100",
            "Standing order",
            "rent",
            "",
        ),
        (
            "sample-004",
            "2026-01-11",
            "Sample - Coffee with friend",
            "-139.00",
            "Sample Coffee Bar",
            "8600000000/0100",
            "Card payment",
            "coffee",
            "",
        ),
        (
            "sample-005",
            "2026-01-18",
            "Sample - Transfer to savings",
            "-12000.00",
            "Sample Savings",
            "3333333333/0100",
            "Transfer",
            "transfer savings",
            "",
        ),
        (
            "sample-006",
            "2026-02-01",
            "Sample - Salary February",
            "82000.00",
            "Sample Payroll",
            "9000000000/0100",
            "Incoming payment",
            "salary",
            "",
        ),
        (
            "sample-007",
            "2026-02-03",
            "Sample - Electricity bill",
            "-2150.00",
            "Sample Power",
            "8500000000/0100",
            "Direct debit",
            "electricity",
            "",
        ),
        (
            "sample-008",
            "2026-02-07",
            "Sample - Family restaurant",
            "-1620.00",
            "Sample Bistro",
            "8200000000/0100",
            "Card payment",
            "restaurant",
            "",
        ),
        (
            "sample-009",
            "2026-02-12",
            "Sample - Vacation hotel",
            "-5200.00",
            "Sample Hotel",
            "9200000000/0100",
            "Card payment",
            "hotel",
            "Vacation",
        ),
        (
            "sample-010",
            "2026-02-20",
            "Sample - Investment ETF",
            "-9000.00",
            "Sample Broker",
            "9700000000/0100",
            "Transfer",
            "investment etf",
            "",
        ),
        (
            "sample-011",
            "2026-03-01",
            "Sample - Salary March",
            "82000.00",
            "Sample Payroll",
            "9000000000/0100",
            "Incoming payment",
            "salary",
            "",
        ),
        (
            "sample-012",
            "2026-03-02",
            "Sample - Grocery restock",
            "-2210.60",
            "Sample Tesco",
            "8100000000/0100",
            "Card payment",
            "groceries",
            "",
        ),
        (
            "sample-013",
            "2026-03-06",
            "Sample - Internet package",
            "-799.00",
            "Sample Internet",
            "8500000001/0100",
            "Direct debit",
            "internet",
            "",
        ),
        (
            "sample-014",
            "2026-03-10",
            "Sample - Flight refund",
            "1800.00",
            "Sample Airline",
            "9400000000/0100",
            "Incoming payment",
            "refund",
            "Vacation",
        ),
        (
            "sample-015",
            "2026-03-22",
            "Sample - Transfer from savings",
            "6000.00",
            "Sample Savings",
            "3333333333/0100",
            "Transfer",
            "transfer savings",
            "",
        ),
        (
            "sample-016",
            "2026-04-01",
            "Sample - Salary April",
            "82000.00",
            "Sample Payroll",
            "9000000000/0100",
            "Incoming payment",
            "salary",
            "",
        ),
        (
            "sample-017",
            "2026-04-05",
            "Sample - Weekend restaurant",
            "-980.00",
            "Sample Bistro",
            "8200000000/0100",
            "Card payment",
            "restaurant",
            "",
        ),
        (
            "sample-018",
            "2026-04-09",
            "Sample - Clothes shopping",
            "-2450.00",
            "Sample Store",
            "9600000000/0100",
            "Card payment",
            "shopping",
            "",
        ),
        (
            "sample-019",
            "2026-04-14",
            "Sample - Coffee beans",
            "-420.00",
            "Sample Coffee Bar",
            "8600000000/0100",
            "Card payment",
            "coffee",
            "",
        ),
        (
            "sample-020",
            "2026-04-25",
            "Sample - Transfer to shared household",
            "-4500.00",
            "Sample Shared Household",
            "2222222222/0100",
            "Transfer",
            "transfer savings",
            "",
        ),
    ]

    header = [
        "ID",
        "Date",
        "Posted",
        "Description",
        "Amount",
        "Currency",
        "Counterparty",
        "Counterparty Account",
        "Type",
        "My Note",
        "Other Note",
    ]
    csv_lines = [",".join(header)]
    for row in rows:
        (
            original_id,
            date,
            description,
            amount,
            counterparty,
            account,
            kind,
            note,
            other,
        ) = row
        csv_lines.append(
            ",".join(
                [
                    original_id,
                    date,
                    date,
                    description,
                    amount,
                    "CZK",
                    counterparty,
                    account,
                    kind,
                    note,
                    other,
                ]
            )
        )

    service = CSVImportService(mapping, accounts["Main Checking"])
    csv_import, _report = service.import_file(
        BytesIO("\n".join(csv_lines).encode("utf-8")),
        SAMPLE_IMPORT_SOURCE,
    )
    CSVImport.objects.filter(id=csv_import.id).update(is_sample=True)
    return csv_import.created_count
