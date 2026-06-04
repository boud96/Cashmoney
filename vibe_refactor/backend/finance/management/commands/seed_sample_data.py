from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from finance.constants import WantNeedInvestment
from finance.models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
)
from finance.services import CSVImportService


class Command(BaseCommand):
    help = "Seed the local Vibe Refactor database with admin and sample finance data."

    def add_arguments(self, parser):
        parser.add_argument("--admin-username", default="admin")
        parser.add_argument("--admin-password", default="CashmoneyDemo2026!")
        parser.add_argument("--admin-email", default="admin@example.local")
        parser.add_argument(
            "--reset-sample",
            action="store_true",
            help="Delete existing sample data before seeding.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset_sample"]:
            self._reset_sample_data()

        admin = self._create_admin(
            username=options["admin_username"],
            password=options["admin_password"],
            email=options["admin_email"],
        )
        mapping = self._create_csv_mapping()
        accounts = self._create_bank_accounts(mapping)
        categories = self._create_categories()
        subcategories = self._create_subcategories(categories)
        tags = self._create_tags()
        self._create_keywords(subcategories, tags)
        created_count = self._create_sample_transactions(mapping, accounts)

        self.stdout.write(self.style.SUCCESS("Sample database is ready."))
        self.stdout.write(f"Admin username: {admin.username}")
        self.stdout.write(f"Admin password: {options['admin_password']}")
        self.stdout.write(f"Sample transactions created this run: {created_count}")

    def _reset_sample_data(self):
        sample_imports = CSVImport.objects.filter(source_filename="sample_statement.csv")
        Transaction.objects.filter(import_batch__in=sample_imports).delete()
        sample_imports.delete()

        Keyword.objects.filter(name__startswith="Sample - ").delete()
        BankAccount.objects.filter(name__startswith="Sample ").delete()
        CSVMapping.objects.filter(name__startswith="Sample ").delete()
        Tag.objects.filter(name__startswith="Sample ").delete()
        Subcategory.objects.filter(description="Sample data").delete()
        Category.objects.filter(description="Sample data").delete()

    def _create_admin(self, username, password, email):
        User = get_user_model()
        user, created = User.objects.get_or_create(
            username=username,
            defaults={"email": email, "is_staff": True, "is_superuser": True},
        )
        user.email = email
        user.is_staff = True
        user.is_superuser = True
        user.set_password(password)
        user.save()

        action = "Created" if created else "Updated"
        self.stdout.write(f"{action} admin user '{username}'.")
        return user

    def _create_csv_mapping(self):
        mapping, _ = CSVMapping.objects.update_or_create(
            name="Sample Universal CSV",
            defaults={
                "description": "Sample mapping for demo statements.",
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
                    "counterparty_note": "Counterparty Note",
                    "my_note": "My Note",
                    "other_note": "Other Note",
                },
                "categorization_fields": [
                    "description",
                    "counterparty_name",
                    "counterparty_note",
                    "my_note",
                    "other_note",
                    "transaction_type",
                ],
            },
        )
        return mapping

    def _create_bank_accounts(self, mapping):
        account_specs = [
            {
                "name": "Sample Main Checking",
                "account_number": "1111111111/0100",
                "bank_name": "Demo Bank",
                "currency": "CZK",
                "owners": 1,
            },
            {
                "name": "Sample Shared Household",
                "account_number": "2222222222/0100",
                "bank_name": "Demo Bank",
                "currency": "CZK",
                "owners": 2,
            },
            {
                "name": "Sample Investment Account",
                "account_number": "3333333333/0100",
                "bank_name": "Broker Demo",
                "currency": "CZK",
                "owners": 1,
            },
        ]

        accounts = {}
        for spec in account_specs:
            account, _ = BankAccount.objects.update_or_create(
                account_number=spec["account_number"],
                defaults={**spec, "default_csv_mapping": mapping},
            )
            accounts[spec["name"]] = account
        return accounts

    def _create_categories(self):
        specs = [
            ("Income", "#2f9e44"),
            ("Food", "#f08c00"),
            ("Housing", "#1971c2"),
            ("Transport", "#7048e8"),
            ("Shopping", "#c2255c"),
            ("Health", "#0ca678"),
            ("Entertainment", "#e67700"),
            ("Investment", "#087f5b"),
            ("Travel", "#1864ab"),
            ("Fees", "#495057"),
        ]
        categories = {}
        for name, color in specs:
            category, _ = Category.objects.update_or_create(
                name=name,
                defaults={"description": "Sample data", "color": color},
            )
            categories[name] = category
        return categories

    def _create_subcategories(self, categories):
        specs = {
            "Income": ["Salary", "Refunds", "Interest"],
            "Food": ["Groceries", "Restaurants", "Coffee"],
            "Housing": ["Rent", "Utilities", "Internet"],
            "Transport": ["Public Transit", "Fuel", "Ride Share"],
            "Shopping": ["Clothes", "Electronics", "Household"],
            "Health": ["Pharmacy", "Doctor"],
            "Entertainment": ["Streaming", "Cinema", "Books"],
            "Investment": ["ETF Contributions", "Crypto", "Savings"],
            "Travel": ["Hotels", "Flights"],
            "Fees": ["Bank Fees"],
        }

        subcategories = {}
        for category_name, names in specs.items():
            for name in names:
                subcategory, _ = Subcategory.objects.update_or_create(
                    category=categories[category_name],
                    name=name,
                    defaults={"description": "Sample data"},
                )
                subcategories[(category_name, name)] = subcategory
        return subcategories

    def _create_tags(self):
        specs = [
            ("Sample Recurring", "#228be6"),
            ("Sample Family", "#ae3ec9"),
            ("Sample Work", "#2b8a3e"),
            ("Sample Travel", "#1c7ed6"),
            ("Sample Subscription", "#e8590c"),
            ("Sample Imported", "#495057"),
        ]
        tags = {}
        for name, color in specs:
            tag, _ = Tag.objects.update_or_create(
                name=name,
                defaults={"description": "Sample data", "color": color},
            )
            tags[name] = tag
        return tags

    def _create_keywords(self, subcategories, tags):
        imported = tags["Sample Imported"]
        recurring = tags["Sample Recurring"]
        family = tags["Sample Family"]
        work = tags["Sample Work"]
        travel = tags["Sample Travel"]
        subscription = tags["Sample Subscription"]

        specs = [
            ("Salary", ["salary", "payroll"], "Income", "Salary", None, [work]),
            ("Refund", ["refund"], "Income", "Refunds", None, [imported]),
            ("Interest", ["interest"], "Income", "Interest", WantNeedInvestment.INVESTMENT, [imported]),
            ("McDonalds", ["mcdonald"], "Food", "Restaurants", WantNeedInvestment.WANT, [imported]),
            ("McDonnalds typo", ["mcdonnalds"], "Food", "Restaurants", WantNeedInvestment.WANT, [imported]),
            ("Tesco", ["tesco"], "Food", "Groceries", WantNeedInvestment.NEED, [family]),
            ("Albert", ["albert"], "Food", "Groceries", WantNeedInvestment.NEED, [family]),
            ("Coffee", ["starbucks"], "Food", "Coffee", WantNeedInvestment.WANT, [imported]),
            ("Rent", ["rent"], "Housing", "Rent", WantNeedInvestment.NEED, [recurring]),
            ("Electricity", ["electricity"], "Housing", "Utilities", WantNeedInvestment.NEED, [recurring]),
            ("Internet", ["internet"], "Housing", "Internet", WantNeedInvestment.NEED, [recurring]),
            ("Metro", ["metro"], "Transport", "Public Transit", WantNeedInvestment.NEED, [imported]),
            ("Fuel", ["shell"], "Transport", "Fuel", WantNeedInvestment.NEED, [imported]),
            ("Uber", ["uber"], "Transport", "Ride Share", WantNeedInvestment.WANT, [travel]),
            ("Netflix", ["netflix"], "Entertainment", "Streaming", WantNeedInvestment.WANT, [subscription]),
            ("Cinema", ["cinema"], "Entertainment", "Cinema", WantNeedInvestment.WANT, [imported]),
            ("Pharmacy", ["pharmacy"], "Health", "Pharmacy", WantNeedInvestment.NEED, [imported]),
            ("ETF", ["etf", "contribution"], "Investment", "ETF Contributions", WantNeedInvestment.INVESTMENT, [recurring]),
            ("Crypto", ["crypto"], "Investment", "Crypto", WantNeedInvestment.INVESTMENT, [imported]),
            ("Hotel", ["hotel"], "Travel", "Hotels", WantNeedInvestment.WANT, [travel]),
            ("Bank fee", ["bank fee"], "Fees", "Bank Fees", WantNeedInvestment.NEED, [imported]),
        ]

        for priority, (name, include_terms, category_name, subcategory_name, wni, keyword_tags) in enumerate(specs, start=1):
            keyword, _ = Keyword.objects.update_or_create(
                name=f"Sample - {name}",
                defaults={
                    "include_terms": include_terms,
                    "exclude_terms": [],
                    "subcategory": subcategories[(category_name, subcategory_name)],
                    "want_need_investment": wni,
                    "is_ignored": False,
                    "priority": priority,
                    "is_active": True,
                },
            )
            keyword.tags.set([*keyword_tags, imported])

    def _create_sample_transactions(self, mapping, accounts):
        if Transaction.objects.filter(import_batch__source_filename="sample_statement.csv").exists():
            return 0

        rows = [
            ("sample-001", "2026-01-03", "2026-01-03", "Salary January", "85000.00", "Payroll Ltd", "9000000000/0100", "Incoming payment", "Monthly salary", ""),
            ("sample-002", "2026-01-04", "2026-01-04", "Tesco groceries", "-1842.40", "Tesco", "8100000000/0100", "Card payment", "Weekly shop", ""),
            ("sample-003", "2026-01-05", "2026-01-05", "McDonalds lunch", "-249.00", "McDonalds", "8200000000/0100", "Card payment", "", ""),
            ("sample-004", "2026-01-07", "2026-01-07", "Rent January", "-28000.00", "Landlord", "8300000000/0100", "Standing order", "Rent", ""),
            ("sample-005", "2026-01-09", "2026-01-09", "Netflix subscription", "-299.00", "Netflix", "8400000000/0100", "Card payment", "", ""),
            ("sample-006", "2026-01-12", "2026-01-12", "ETF monthly contribution", "-10000.00", "Broker Demo", "9700000000/0100", "Transfer", "ETF", ""),
            ("sample-007", "2026-01-18", "2026-01-18", "Electricity bill", "-2150.00", "Power Company", "8500000000/0100", "Direct debit", "Electricity", ""),
            ("sample-008", "2026-01-21", "2026-01-21", "Starbucks coffee", "-139.00", "Starbucks", "8600000000/0100", "Card payment", "", ""),
            ("sample-009", "2026-02-01", "2026-02-01", "Salary February", "85000.00", "Payroll Ltd", "9000000000/0100", "Incoming payment", "Monthly salary", ""),
            ("sample-010", "2026-02-02", "2026-02-02", "Albert groceries", "-1650.80", "Albert", "8700000000/0100", "Card payment", "Groceries", ""),
            ("sample-011", "2026-02-03", "2026-02-03", "Prague Metro pass", "-550.00", "Metro", "8800000000/0100", "Card payment", "", ""),
            ("sample-012", "2026-02-06", "2026-02-06", "Shell fuel", "-1420.00", "Shell", "8900000000/0100", "Card payment", "", ""),
            ("sample-013", "2026-02-10", "2026-02-10", "Pharmacy vitamins", "-379.00", "Pharmacy", "9100000000/0100", "Card payment", "", ""),
            ("sample-014", "2026-02-15", "2026-02-15", "Bank fee", "-89.00", "Demo Bank", "9800000000/0100", "Fee", "Bank fee", ""),
            ("sample-015", "2026-03-01", "2026-03-01", "Salary March", "85000.00", "Payroll Ltd", "9000000000/0100", "Incoming payment", "Monthly salary", ""),
            ("sample-016", "2026-03-04", "2026-03-04", "Hotel Brno weekend", "-4800.00", "Hotel Brno", "9200000000/0100", "Card payment", "", "Trip"),
            ("sample-017", "2026-03-06", "2026-03-06", "Uber airport", "-690.00", "Uber", "9300000000/0100", "Card payment", "", "Trip"),
            ("sample-018", "2026-03-11", "2026-03-11", "Cinema evening", "-420.00", "Cinema City", "9400000000/0100", "Card payment", "", ""),
            ("sample-019", "2026-03-15", "2026-03-15", "Crypto purchase", "-5000.00", "Crypto Exchange", "9500000000/0100", "Transfer", "Crypto", ""),
            ("sample-020", "2026-03-20", "2026-03-20", "Unknown local shop", "-312.00", "Corner Shop", "9600000000/0100", "Card payment", "", ""),
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
            csv_lines.append(",".join([*row[:5], "CZK", *row[5:]]))

        csv_bytes = "\n".join(csv_lines).encode("utf-8")
        service = CSVImportService(mapping, accounts["Sample Main Checking"])
        csv_import, _ = service.import_file(BytesIO(csv_bytes), "sample_statement.csv")
        return csv_import.created_count
