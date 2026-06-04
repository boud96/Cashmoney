import json
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import Client, TestCase, override_settings

from .constants import Direction, WantNeedInvestment
from .models import (
    BankAccount,
    CSVMapping,
    Category,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
    TransactionTag,
)
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
