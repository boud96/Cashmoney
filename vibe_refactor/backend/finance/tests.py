import json
from io import StringIO
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.test import Client, TestCase, TransactionTestCase, override_settings

from .constants import Direction, WantNeedInvestment
from .models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
    TransactionTag,
)
from .sample_data import SAMPLE_IMPORT_SOURCE, SAMPLE_PREFIX, delete_sample_data
from .services import CSVImportService, CategorizationService


def json_body(response):
    return json.loads(response.content.decode("utf-8"))


class FinanceTestCase(TestCase):
    def setUp(self):
        self.mapping = CSVMapping.objects.create(
            name="Test Bank",
            date_format="%Y-%m-%d",
            fallback_date_formats=["%d.%m.%Y"],
            column_map={
                "original_id": "ID",
                "transaction_date": "Date",
                "description": "Description",
                "amount": "Amount",
                "currency": "Currency",
                "counterparty_name": "Counterparty",
                "counterparty_account_number": "Counterparty Account",
            },
            categorization_fields=["description", "counterparty_name"],
        )
        self.account = BankAccount.objects.create(
            name="Main",
            account_number="123/0100",
            default_csv_mapping=self.mapping,
        )
        self.category = Category.objects.create(name="Food")
        self.subcategory = Subcategory.objects.create(
            name="Restaurant", category=self.category
        )
        self.tag = Tag.objects.create(name="Fast food")

    def csv_file(self, body):
        return SimpleUploadedFile(
            "statement.csv",
            body.encode("utf-8"),
            content_type="text/csv",
        )

    def keyword(self, name, include_terms, **kwargs):
        keyword = Keyword.objects.create(
            name=name,
            include_terms=include_terms,
            subcategory=kwargs.pop("subcategory", self.subcategory),
            want_need_investment=kwargs.pop(
                "want_need_investment", WantNeedInvestment.WANT
            ),
            priority=kwargs.pop("priority", 0),
            is_ignored=kwargs.pop("is_ignored", False),
            exclude_terms=kwargs.pop("exclude_terms", []),
            **kwargs,
        )
        keyword.tags.add(self.tag)
        return keyword


class ModelTests(FinanceTestCase):
    def test_transaction_direction_is_calculated_from_amount(self):
        income = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-01",
            description="Salary",
            amount=Decimal("100.00"),
        )
        expense = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-10.00"),
        )

        self.assertEqual(income.direction, Direction.INCOME)
        self.assertEqual(expense.direction, Direction.EXPENSE)

    def test_subcategory_derives_category_and_unique_tag_constraint(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
        )
        TransactionTag.objects.create(transaction=transaction_obj, tag=self.tag)

        self.assertEqual(transaction_obj.subcategory.category, self.category)
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                TransactionTag.objects.create(transaction=transaction_obj, tag=self.tag)

    def test_category_subcategory_and_tag_colors_are_generated_when_blank(self):
        category = Category.objects.create(name="Generated Category")
        subcategory = Subcategory.objects.create(
            category=category, name="Generated Subcategory"
        )
        tag = Tag.objects.create(name="Generated Tag")

        self.assertRegex(category.color, r"^#[0-9A-F]{6}$")
        self.assertRegex(subcategory.color, r"^#[0-9A-F]{6}$")
        self.assertRegex(tag.color, r"^#[0-9A-F]{6}$")

    def test_category_subcategory_and_tag_colors_accept_only_hex(self):
        with self.assertRaises(ValidationError):
            Category.objects.create(name="Bad Category", color="blue")
        with self.assertRaises(ValidationError):
            Subcategory.objects.create(
                category=self.category, name="Bad Subcategory", color="#12345"
            )
        with self.assertRaises(ValidationError):
            Tag.objects.create(name="Bad Tag", color="123456")


class SampleDataCommandTests(TestCase):
    def seed(self, *args):
        call_command("seed_sample_data", *args, stdout=StringIO(), verbosity=0)

    def sample_counts(self):
        return {
            "accounts": BankAccount.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "mappings": CSVMapping.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "categories": Category.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "subcategories": Subcategory.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "tags": Tag.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "keywords": Keyword.objects.filter(name__startswith=SAMPLE_PREFIX).count(),
            "imports": CSVImport.objects.filter(source_filename=SAMPLE_IMPORT_SOURCE).count(),
            "transactions": Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).count(),
        }

    def test_if_empty_skip_admin_creates_exact_sample_dataset(self):
        self.seed("--if-empty", "--skip-admin")

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
        self.seed("--if-empty", "--skip-admin")

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
        self.seed("--if-empty", "--skip-admin")
        first_counts = self.sample_counts()
        self.seed("--if-empty", "--skip-admin")
        self.assertEqual(self.sample_counts(), first_counts)

        delete_sample_data()
        Transaction.objects.create(
            transaction_date="2026-01-01",
            description="User transaction",
            amount=Decimal("-1.00"),
        )
        self.seed("--if-empty", "--skip-admin")
        self.assertEqual(self.sample_counts()["transactions"], 0)

    def test_reset_sample_reseeds_cleanly_and_delete_helper_preserves_non_sample_data(self):
        self.seed("--skip-admin")
        self.seed("--reset-sample", "--skip-admin")
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


class CSVImportServiceTests(FinanceTestCase):
    def test_imports_and_categorizes_transactions(self):
        keyword = self.keyword("McDonalds", ["McDonalds"])
        keyword.tags.add(self.tag)

        csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Amount,Currency\n"
                "tx-1,2026-01-02,McDonalds Prague,-12.50,CZK\n"
            )
        )

        transaction_obj = Transaction.objects.get()
        self.assertEqual(csv_import.created_count, 1)
        self.assertEqual(report["created"]["count"], 1)
        self.assertEqual(transaction_obj.subcategory, self.subcategory)
        self.assertEqual(transaction_obj.subcategory.category, self.category)
        self.assertEqual(transaction_obj.want_need_investment, WantNeedInvestment.WANT)
        self.assertIn(self.tag, transaction_obj.tags.all())

    def test_preview_reports_headers_parsed_rows_and_duplicates(self):
        self.keyword("McDonalds", ["mcdonald"])
        Transaction.objects.create(
            original_id="tx-1",
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
        )

        preview = CSVImportService(self.mapping, self.account).preview_file(
            self.csv_file(
                "ID,Date,Description,Amount,Currency\n"
                "tx-1,2026-01-02,McDonalds Prague,-12.50,CZK\n"
            )
        )

        self.assertEqual(preview["headers"], ["ID", "Date", "Description", "Amount", "Currency"])
        self.assertEqual(preview["loaded"], 1)
        self.assertEqual(preview["summary"]["duplicates"], 1)
        self.assertEqual(preview["rows"][0]["categorization"]["status"], "matched")

    def test_dry_run_does_not_create_transactions(self):
        _csv_import, preview = CSVImportService(
            self.mapping, self.account
        ).import_file(
            self.csv_file(
                "ID,Date,Description,Amount,Currency\n"
                "tx-1,2026-01-02,Unknown,-12.50,CZK\n"
            ),
            dry_run=True,
        )

        self.assertEqual(preview["loaded"], 1)
        self.assertFalse(Transaction.objects.exists())

    def test_bad_rows_are_reported_without_stopping_import(self):
        csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Amount,Currency\n"
                "tx-1,not-a-date,Unknown,-12.50,CZK\n"
                "tx-2,2026-01-02,Valid,-10.00,CZK\n"
            )
        )

        self.assertEqual(csv_import.created_count, 1)
        self.assertEqual(csv_import.error_count, 1)
        self.assertEqual(report["skipped"]["errors"][0]["line"], 2)


class CategorizationTests(FinanceTestCase):
    def test_higher_priority_keyword_wins(self):
        transport = Category.objects.create(name="Transport")
        fuel = Subcategory.objects.create(name="Fuel", category=transport)
        self.keyword("General Tesco", ["tesco"], priority=1)
        self.keyword("Tesco Fuel", ["tesco", "fuel"], subcategory=fuel, priority=10)

        result = CategorizationService().apply("Tesco fuel station")

        self.assertEqual(result.subcategory, fuel)

    def test_same_priority_conflict_is_reported(self):
        transport = Category.objects.create(name="Transport")
        fuel = Subcategory.objects.create(name="Fuel", category=transport)
        self.keyword("Food Tesco", ["tesco"], priority=5)
        self.keyword("Fuel Tesco", ["tesco"], subcategory=fuel, priority=5)

        result = CategorizationService().apply("Tesco")

        self.assertTrue(result.is_category_overlap)
        self.assertEqual(len(result.matched_keyword_ids), 2)

    def test_exclude_terms_wni_only_and_own_account_ignore(self):
        self.keyword("McDonalds", ["mcdonald"], exclude_terms=["refund"])
        Keyword.objects.create(
            name="Savings",
            include_terms=["savings"],
            subcategory=None,
            want_need_investment=WantNeedInvestment.INVESTMENT,
            priority=5,
        )

        categorizer = CategorizationService()
        excluded = categorizer.apply("McDonalds refund")
        wni_only = categorizer.apply("Savings transfer")
        own_transfer = categorizer.apply(
            "Internal transfer", {"counterparty_account_number": "123/0100"}
        )

        self.assertTrue(excluded.is_uncategorized)
        self.assertIsNone(wni_only.subcategory)
        self.assertEqual(wni_only.want_need_investment, WantNeedInvestment.INVESTMENT)
        self.assertTrue(own_transfer.is_ignored)


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class APITests(FinanceTestCase):
    def setUp(self):
        super().setUp()
        self.client = Client()

    def post_json(self, path, data):
        return self.client.post(
            path,
            data=json.dumps(data),
            content_type="application/json",
        )

    def patch_json(self, path, data):
        return self.client.patch(
            path,
            data=json.dumps(data),
            content_type="application/json",
        )

    def delete_json(self, path, data=None):
        return self.client.delete(
            path,
            data=json.dumps(data or {}),
            content_type="application/json",
        )

    def test_validation_error_shape(self):
        response = self.post_json("/api/bank-accounts/", {"name": ""})

        self.assertEqual(response.status_code, 400)
        payload = json_body(response)
        self.assertEqual(payload["error"], "Missing required field")
        self.assertEqual(payload["details"]["field"], "name")

    def test_color_api_generates_when_missing_and_rejects_non_hex_values(self):
        created = self.post_json("/api/categories/", {"name": "Auto Color"})
        invalid = self.post_json("/api/tags/", {"name": "Bad Color", "color": "red"})

        self.assertEqual(created.status_code, 201)
        self.assertRegex(json_body(created)["color"], r"^#[0-9A-F]{6}$")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(json_body(invalid)["error"], "Invalid color")

    def test_csv_mapping_column_detection_returns_headers_without_creating_mapping(self):
        existing_count = CSVMapping.objects.count()

        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {
                "delimiter": ";",
                "date_format": "%d.%m.%Y",
                "default_currency": "CZK",
                "csv_file": self.csv_file(
                    "ID;Datum;Popis;Castka\n"
                    "api-1;02.01.2026;McDonalds;-12,50\n"
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["headers"], ["ID", "Datum", "Popis", "Castka"])
        self.assertEqual(payload["loaded"], 1)
        self.assertEqual(payload["sample_rows"][0]["raw"]["Popis"], "McDonalds")
        self.assertEqual(CSVMapping.objects.count(), existing_count)

    def test_csv_mapping_column_detection_requires_file(self):
        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {"delimiter": ","},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json_body(response)["details"]["field"], "csv_file")

    def test_transaction_create_update_filters_and_pagination(self):
        response = self.post_json(
            "/api/transactions/",
            {
                "bank_account_id": str(self.account.id),
                "transaction_date": "2026-01-02",
                "description": "McDonalds Prague",
                "amount": "-12.50",
                "subcategory_id": str(self.subcategory.id),
                "tag_ids": [str(self.tag.id)],
                "want_need_investment": WantNeedInvestment.WANT,
            },
        )
        self.assertEqual(response.status_code, 201)
        transaction_id = json_body(response)["id"]

        patch = self.patch_json(
            f"/api/transactions/{transaction_id}/",
            {"my_note": "Reviewed", "is_ignored": True, "tag_ids": []},
        )
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(json_body(patch)["tags"], [])

        hidden = self.client.get("/api/transactions/", {"q": "Reviewed"})
        visible = self.client.get(
            "/api/transactions/",
            {"q": "Reviewed", "include_ignored": "true", "limit": "1"},
        )

        self.assertEqual(json_body(hidden)["count"], 0)
        self.assertEqual(json_body(visible)["count"], 1)
        self.assertEqual(json_body(visible)["limit"], 1)

    def test_transaction_filters_support_multi_select_and_unassigned_values(self):
        second_account = BankAccount.objects.create(
            name="Second",
            account_number="456/0100",
            default_csv_mapping=self.mapping,
        )
        transport = Category.objects.create(name="Transport")
        fuel = Subcategory.objects.create(name="Fuel", category=transport)
        other_tag = Tag.objects.create(name="Other tag")

        food = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.WANT,
        )
        food.tags.add(self.tag)
        Transaction.objects.create(
            bank_account=second_account,
            transaction_date="2026-01-03",
            description="Fuel",
            amount=Decimal("-30.00"),
            subcategory=fuel,
            want_need_investment=WantNeedInvestment.NEED,
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-04",
            description="Uncategorized",
            amount=Decimal("-3.00"),
        )
        tagged_uncategorized = Transaction.objects.create(
            bank_account=second_account,
            transaction_date="2026-01-05",
            description="Tagged uncategorized",
            amount=Decimal("-4.00"),
            want_need_investment=WantNeedInvestment.INVESTMENT,
        )
        tagged_uncategorized.tags.add(other_tag)

        account_response = self.client.get(
            "/api/transactions/",
            {
                "bank_account": f"{self.account.id},{second_account.id}",
                "limit": "10",
            },
        )
        category_response = self.client.get(
            "/api/transactions/",
            {"category": f"{self.category.id},__unassigned__", "limit": "10"},
        )
        subcategory_response = self.client.get(
            "/api/transactions/",
            {"subcategory": "__unassigned__", "limit": "10"},
        )
        wni_response = self.client.get(
            "/api/transactions/?want_need_investment=want&want_need_investment=__unassigned__&limit=10"
        )
        tag_response = self.client.get(
            "/api/transactions/",
            {"tag": f"{self.tag.id},__unassigned__", "limit": "10"},
        )

        self.assertEqual(json_body(account_response)["count"], 4)
        self.assertEqual(json_body(category_response)["count"], 3)
        self.assertEqual(json_body(subcategory_response)["count"], 2)
        self.assertEqual(json_body(wni_response)["count"], 2)
        self.assertEqual(json_body(tag_response)["count"], 3)

    def test_transaction_filter_metadata_returns_oldest_date_and_today(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-03",
            description="Later",
            amount=Decimal("-3.00"),
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-01",
            description="Earlier",
            amount=Decimal("-1.00"),
        )

        response = self.client.get("/api/transactions/filter-metadata/")
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["oldest_transaction_date"], "2026-01-01")
        self.assertRegex(payload["today"], r"^\d{4}-\d{2}-\d{2}$")

    def test_import_preview_dry_run_and_commit(self):
        self.keyword("McDonalds", ["mcdonald"])
        body = "ID,Date,Description,Amount,Currency\napi-1,2026-01-02,McDonalds,-12.50,CZK\n"

        preview = self.client.post(
            "/api/imports/preview/",
            {
                "bank_account_id": str(self.account.id),
                "csv_mapping_id": str(self.mapping.id),
                "csv_file": self.csv_file(body),
            },
        )
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(json_body(preview)["summary"]["valid"], 1)

        dry_run = self.client.post(
            "/api/imports/",
            {
                "bank_account_id": str(self.account.id),
                "csv_mapping_id": str(self.mapping.id),
                "dry_run": "true",
                "csv_file": self.csv_file(body),
            },
        )
        self.assertEqual(dry_run.status_code, 200)
        self.assertFalse(Transaction.objects.exists())

        committed = self.client.post(
            "/api/imports/",
            {
                "bank_account_id": str(self.account.id),
                "csv_mapping_id": str(self.mapping.id),
                "csv_file": self.csv_file(body),
            },
        )
        self.assertEqual(committed.status_code, 201)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_keyword_preview_and_recategorize_details(self):
        self.keyword("McDonalds", ["mcdonald"])
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
        )

        preview = self.post_json("/api/keywords/preview/", {"text": "McDonalds Prague"})
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(json_body(preview)["categorization"]["status"], "matched")

        recategorized = self.post_json(
            "/api/transactions/recategorize/",
            {"transaction_ids": [str(transaction_obj.id)]},
        )
        payload = json_body(recategorized)

        self.assertEqual(recategorized.status_code, 200)
        self.assertEqual(payload["processed"], 1)
        self.assertEqual(payload["updated"], 1)
        self.assertEqual(payload["updated_transaction_ids"], [str(transaction_obj.id)])

    def test_recategorize_uses_current_filters_and_replaces_tags(self):
        stale_tag = Tag.objects.create(name="Old rule")
        Keyword.objects.create(
            name="McDonalds current",
            include_terms=["mcdonald"],
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.NEED,
            priority=5,
        )
        filtered_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
        )
        filtered_transaction.tags.add(stale_tag)
        outside_filter = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2025-12-31",
            description="McDonalds Prague",
            amount=Decimal("-9.00"),
        )

        response = self.post_json(
            "/api/transactions/recategorize/?date_from=2026-01-01",
            {},
        )
        payload = json_body(response)
        filtered_transaction.refresh_from_db()
        outside_filter.refresh_from_db()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["processed"], 1)
        self.assertEqual(payload["updated"], 1)
        self.assertEqual(filtered_transaction.subcategory, self.subcategory)
        self.assertEqual(
            filtered_transaction.want_need_investment, WantNeedInvestment.NEED
        )
        self.assertEqual(list(filtered_transaction.tags.all()), [])
        self.assertIsNone(outside_filter.subcategory)

    def test_dashboard_summary_uses_derived_categories_and_excludes_ignored(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.WANT,
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-03",
            description="Ignored",
            amount=Decimal("-99.00"),
            subcategory=self.subcategory,
            is_ignored=True,
        )

        response = self.client.get("/api/dashboard/summary/")
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["expense_categories"][0]["name"], "Food")
        self.assertEqual(payload["expense_categories"][0]["amount"], 12.5)
        self.assertEqual(payload["want_need_investment"][0]["name"], "want")

    def test_maintenance_summary_returns_counts(self):
        csv_import = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="api-maintenance.csv",
        )
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Maintenance test",
            amount=Decimal("-12.50"),
        )

        response = self.client.get("/api/maintenance/summary/")
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["transactions"], 1)
        self.assertEqual(payload["imports"], 1)
        self.assertEqual(payload["bank_accounts"], 1)
        self.assertEqual(payload["csv_mappings"], 1)
        self.assertEqual(payload["categories"], 1)
        self.assertEqual(payload["subcategories"], 1)
        self.assertEqual(payload["tags"], 1)
        self.assertEqual(payload["keywords"], 0)
        self.assertEqual(payload["sample_transactions"], 0)

    def test_maintenance_delete_rejects_wrong_confirmation(self):
        response = self.delete_json(
            "/api/maintenance/transactions/",
            {"confirmation": "wrong"},
        )

        self.assertEqual(response.status_code, 400)
        payload = json_body(response)
        self.assertEqual(payload["error"], "Confirmation text does not match")
        self.assertEqual(payload["details"]["expected"], "DELETE ALL TRANSACTIONS")

    def test_maintenance_delete_sample_data_preserves_user_data(self):
        call_command("seed_sample_data", "--skip-admin", stdout=StringIO(), verbosity=0)
        user_category = Category.objects.create(name="User Category")
        user_transaction = Transaction.objects.create(
            transaction_date="2026-05-01",
            description="User transaction",
            amount=Decimal("-10.00"),
        )

        response = self.delete_json(
            "/api/maintenance/sample-data/",
            {"confirmation": "DELETE SAMPLE DATA"},
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["counts"]["transactions"], 20)
        self.assertFalse(
            Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).exists()
        )
        self.assertTrue(Transaction.objects.filter(id=user_transaction.id).exists())
        self.assertTrue(Category.objects.filter(id=user_category.id).exists())

    def test_maintenance_recreate_sample_data_preserves_user_data(self):
        user_transaction = Transaction.objects.create(
            transaction_date="2026-05-01",
            description="User transaction",
            amount=Decimal("-10.00"),
        )

        first_response = self.post_json("/api/maintenance/sample-data/recreate/", {})
        second_response = self.post_json("/api/maintenance/sample-data/recreate/", {})

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 201)
        self.assertTrue(Transaction.objects.filter(id=user_transaction.id).exists())
        self.assertEqual(
            Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).count(),
            20,
        )
        self.assertEqual(
            CSVImport.objects.filter(source_filename=SAMPLE_IMPORT_SOURCE).count(),
            1,
        )
        self.assertFalse(get_user_model().objects.exists())

    def test_maintenance_delete_transactions_removes_imports_and_preserves_definitions(self):
        csv_import = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="api-maintenance.csv",
        )
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Maintenance test",
            amount=Decimal("-12.50"),
        )

        response = self.delete_json(
            "/api/maintenance/transactions/",
            {"confirmation": "DELETE ALL TRANSACTIONS"},
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["counts"]["transactions"], 1)
        self.assertEqual(payload["counts"]["imports"], 1)
        self.assertFalse(Transaction.objects.exists())
        self.assertFalse(CSVImport.objects.exists())
        self.assertTrue(BankAccount.objects.filter(id=self.account.id).exists())
        self.assertTrue(CSVMapping.objects.filter(id=self.mapping.id).exists())
        self.assertTrue(Category.objects.filter(id=self.category.id).exists())
        self.assertTrue(Subcategory.objects.filter(id=self.subcategory.id).exists())
        self.assertTrue(Tag.objects.filter(id=self.tag.id).exists())

    def test_maintenance_delete_finance_data_preserves_auth_users(self):
        user = get_user_model().objects.create_user(
            username="local-admin",
            password="secret",
        )
        csv_import = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="api-maintenance.csv",
        )
        keyword = self.keyword("Maintenance keyword", ["maintenance"])
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Maintenance test",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
        )

        response = self.delete_json(
            "/api/maintenance/finance-data/",
            {"confirmation": "DELETE ALL FINANCE DATA"},
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["counts"]["transactions"], 1)
        self.assertEqual(payload["counts"]["keywords"], 1)
        self.assertTrue(get_user_model().objects.filter(id=user.id).exists())
        self.assertFalse(Transaction.objects.exists())
        self.assertFalse(CSVImport.objects.exists())
        self.assertFalse(Keyword.objects.filter(id=keyword.id).exists())
        self.assertFalse(BankAccount.objects.exists())
        self.assertFalse(CSVMapping.objects.exists())
        self.assertFalse(Tag.objects.exists())
        self.assertFalse(Subcategory.objects.exists())
        self.assertFalse(Category.objects.exists())

    def test_maintenance_database_backup_returns_sqlite_attachment(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Maintenance backup test",
            amount=Decimal("-12.50"),
        )

        response = self.client.get("/api/maintenance/database-backup/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/x-sqlite3")
        self.assertIn("cashmoney-backup-", response["Content-Disposition"])
        self.assertTrue(response.content.startswith(b"SQLite format 3"))

    def test_maintenance_database_restore_rejects_invalid_upload(self):
        response = self.client.post(
            "/api/maintenance/database-restore/",
            {
                "confirmation": "RESTORE DATABASE",
                "backup_file": SimpleUploadedFile(
                    "not-a-backup.sqlite3",
                    b"not sqlite",
                    content_type="application/x-sqlite3",
                ),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            json_body(response)["error"],
            "Uploaded file is not a valid SQLite database",
        )


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class MaintenanceRestoreTests(TransactionTestCase):
    def setUp(self):
        self.client = Client()
        self.mapping = CSVMapping.objects.create(
            name="Restore Mapping",
            date_format="%Y-%m-%d",
            column_map={
                "transaction_date": "Date",
                "description": "Description",
                "amount": "Amount",
            },
        )
        self.account = BankAccount.objects.create(
            name="Restore Account",
            account_number="restore/0100",
            default_csv_mapping=self.mapping,
        )

    def test_database_restore_replaces_current_database_and_saves_pre_restore_backup(self):
        restored_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Restored transaction",
            amount=Decimal("-12.50"),
        )
        connection.ensure_connection()
        backup_bytes = connection.connection.serialize()

        Transaction.objects.filter(id=restored_transaction.id).delete()
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-02-02",
            description="Current transaction",
            amount=Decimal("-8.00"),
        )

        response = self.client.post(
            "/api/maintenance/database-restore/",
            {
                "confirmation": "RESTORE DATABASE",
                "backup_file": SimpleUploadedFile(
                    "cashmoney-backup.sqlite3",
                    backup_bytes,
                    content_type="application/x-sqlite3",
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["restored"])
        self.assertTrue(payload["pre_restore_backup"].endswith(".sqlite3"))
        self.assertTrue(Transaction.objects.filter(description="Restored transaction").exists())
        self.assertFalse(Transaction.objects.filter(description="Current transaction").exists())
