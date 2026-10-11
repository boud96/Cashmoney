"""The sample data command."""

from decimal import Decimal
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import (
    TestCase,
)

from ..models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
)
from ..sample_data import (
    SAMPLE_IMPORT_SOURCE,
    SAMPLE_PREFIX,
    delete_sample_data,
    sample_name,
)


class SampleDataCommandTests(TestCase):
    def seed(self, *args):
        call_command("seed_sample_data", *args, stdout=StringIO(), verbosity=0)

    def sample_counts(self):
        return {
            "accounts": BankAccount.objects.filter(
                name__startswith=SAMPLE_PREFIX
            ).count(),
            "mappings": CSVMapping.objects.filter(
                name__startswith=SAMPLE_PREFIX
            ).count(),
            "categories": Category.objects.filter(
                name__startswith=SAMPLE_PREFIX
            ).count(),
            "subcategories": Subcategory.objects.filter(
                name__startswith=SAMPLE_PREFIX
            ).count(),
            "tags": Tag.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "keywords": Keyword.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "imports": CSVImport.objects.filter(
                source_filename=SAMPLE_IMPORT_SOURCE
            ).count(),
            "transactions": Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).count(),
        }

    def test_if_empty_creates_exact_sample_dataset_without_admin(self):
        self.seed("--if-empty")

        self.assertEqual(
            self.sample_counts(),
            {
                "accounts": 3,
                "mappings": 2,
                "categories": 5,
                "subcategories": 12,
                "tags": 5,
                "keywords": 10,
                "imports": 1,
                "transactions": 20,
            },
        )
        self.assertFalse(get_user_model().objects.exists())
        self.assertTrue(BankAccount.objects.filter(owners=2).exists())

    def test_sample_data_is_prefixed_spans_four_months_and_has_ignored_transfers(self):
        self.seed("--if-empty")

        named_models = [BankAccount, CSVMapping, Category, Subcategory, Tag, Keyword]
        for model in named_models:
            names = model.objects.values_list("name", flat=True)
            self.assertTrue(all(name.startswith(SAMPLE_PREFIX) for name in names))

        descriptions = Transaction.objects.filter(
            import_batch__source_filename=SAMPLE_IMPORT_SOURCE
        ).values_list("description", flat=True)
        self.assertTrue(all(value.startswith(SAMPLE_PREFIX) for value in descriptions))

        months = {
            date.strftime("%Y-%m")
            for date in Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).values_list("transaction_date", flat=True)
        }
        self.assertEqual(months, {"2026-01", "2026-02", "2026-03", "2026-04"})
        self.assertGreaterEqual(
            Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE,
                is_ignored=True,
            ).count(),
            3,
        )

    def test_if_empty_is_idempotent_and_skips_existing_user_data(self):
        self.seed("--if-empty")
        first_counts = self.sample_counts()
        self.seed("--if-empty")
        self.assertEqual(self.sample_counts(), first_counts)

        delete_sample_data()
        Transaction.objects.create(
            transaction_date="2026-01-01",
            description="User transaction",
            amount=Decimal("-1.00"),
        )
        self.seed("--if-empty")
        self.assertEqual(self.sample_counts()["transactions"], 0)

    def test_reset_sample_reseeds_cleanly_and_delete_helper_preserves_non_sample_data(
        self,
    ):
        self.seed()
        self.seed("--reset-sample")
        self.assertEqual(self.sample_counts()["transactions"], 20)

        user_category = Category.objects.create(name="User Category")
        user_transaction = Transaction.objects.create(
            transaction_date="2026-05-01",
            description="User transaction",
            amount=Decimal("-10.00"),
        )

        delete_sample_data()

        self.assertEqual(self.sample_counts()["transactions"], 0)
        self.assertTrue(Category.objects.filter(id=user_category.id).exists())
        self.assertTrue(Transaction.objects.filter(id=user_transaction.id).exists())

    def test_delete_sample_data_keeps_sample_items_the_user_adopted(self):
        self.seed()
        main = BankAccount.objects.get(name=sample_name("Main Checking"))
        groceries = Subcategory.objects.get(name=sample_name("Groceries"))
        recurring = Tag.objects.get(name=sample_name("Recurring"))
        home = Category.objects.get(name=sample_name("Home"))
        own = Transaction.objects.create(
            bank_account=main,
            transaction_date="2026-05-01",
            description="Real groceries",
            amount=Decimal("-300.00"),
            subcategory=groceries,
        )
        own.tags.add(recurring)
        bakery = Subcategory.objects.create(name="Bakery", category=home)
        Tag.objects.filter(name=sample_name("Vacation")).update(name="Holidays")
        lookalike = Category.objects.create(name=sample_name("Mine"))

        result = delete_sample_data()

        kept = {(item["type"], item["name"]): item["reason"] for item in result["kept"]}
        self.assertEqual(
            kept,
            {
                ("bank account", main.name): "it has your transactions",
                (
                    "mapping",
                    sample_name("Standard CSV Mapping"),
                ): "an account uses it as its default mapping",
                ("tag", "Holidays"): "you renamed it",
                ("tag", recurring.name): "your transactions have it",
                ("subcategory", groceries.name): "your transactions use it",
                ("category", sample_name("Food")): "it still has subcategories",
                ("category", home.name): "it still has subcategories",
            },
        )
        self.assertEqual(list(Transaction.objects.all()), [own])
        self.assertEqual(result["counts"]["bank_accounts"], 2)
        self.assertFalse(Keyword.objects.exists())
        self.assertTrue(Subcategory.objects.filter(id=bakery.id).exists())
        # Kept items become the user's own, so nothing is left flagged.
        for model in (BankAccount, CSVMapping, Category, Subcategory, Tag, Keyword):
            self.assertFalse(model.objects.filter(is_sample=True).exists(), model)
        # Only flagged objects count as samples, whatever their name.
        self.assertTrue(Category.objects.filter(id=lookalike.id).exists())
