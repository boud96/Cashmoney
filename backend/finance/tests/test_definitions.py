"""Definitions: bank accounts, import mappings, categories, keywords, settings."""

from decimal import Decimal

from ..constants import WantNeedInvestment
from ..models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    FinanceSettings,
    Keyword,
    Subcategory,
    Transaction,
)
from .base import FinanceTestCase, json_body


class DefinitionAPITests(FinanceTestCase):
    def test_account_and_mapping_currencies_are_validated(self):
        created = self.post_json(
            "/api/bank-accounts/", {"name": "Wallet", "currency": "Kč"}
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(json_body(created)["currency"], "CZK")

        for path, payload in [
            ("/api/bank-accounts/", {"name": "Bad", "currency": "Czech"}),
            ("/api/csv-mappings/", {"name": "Bad", "default_currency": "€uro"}),
        ]:
            response = self.post_json(path, payload)
            self.assertEqual(response.status_code, 400, path)
            self.assertIn("three-letter code", json_body(response)["error"])

        account_patch = self.patch_json(
            f"/api/bank-accounts/{self.account.id}/", {"currency": "K"}
        )
        mapping_patch = self.patch_json(
            f"/api/csv-mappings/{self.mapping.id}/", {"default_currency": "Kčs"}
        )
        self.assertEqual(account_patch.status_code, 400)
        self.assertEqual(mapping_patch.status_code, 400)
        self.account.refresh_from_db()
        self.mapping.refresh_from_db()
        self.assertEqual(self.account.currency, "CZK")
        self.assertEqual(self.mapping.default_currency, "CZK")

    def test_unknown_encodings_are_rejected(self):
        create = self.post_json(
            "/api/csv-mappings/", {"name": "Odd bank", "encoding": "utf-9"}
        )
        patch_response = self.patch_json(
            f"/api/csv-mappings/{self.mapping.id}/", {"encoding": "latin-99"}
        )
        CSVMapping.objects.filter(id=self.mapping.id).update(encoding="bogus")
        preview = self.client.post(
            "/api/imports/preview/",
            {
                "bank_account_id": str(self.account.id),
                "csv_file": self.csv_file("ID,Date,Description,Amount\n"),
            },
        )

        self.assertEqual(create.status_code, 400)
        self.assertIn("Unknown encoding 'utf-9'", json_body(create)["error"])
        self.assertEqual(patch_response.status_code, 400)
        self.assertEqual(preview.status_code, 400)
        self.assertIn("Unknown file encoding 'bogus'", json_body(preview)["error"])

    def test_database_conflicts_get_readable_messages(self):
        duplicate = self.post_json("/api/categories/", {"name": self.category.name})
        missing_category = self.patch_json(
            f"/api/subcategories/{self.subcategory.id}/", {"category_id": None}
        )

        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(
            json_body(duplicate)["error"], "A category with this name already exists."
        )
        self.assertEqual(missing_category.status_code, 400)
        self.assertEqual(json_body(missing_category)["error"], "Category is required.")

    def test_bank_account_api_allows_blank_account_number(self):
        first = self.post_json(
            "/api/bank-accounts/",
            {"name": "Cash Wallet", "currency": "CZK", "owners": 1},
        )
        second = self.post_json(
            "/api/bank-accounts/",
            {
                "name": "Savings Jar",
                "account_number": "",
                "currency": "CZK",
                "owners": 1,
            },
        )
        duplicate = self.post_json(
            "/api/bank-accounts/",
            {
                "name": "Duplicate",
                "account_number": "123/0100",
                "currency": "CZK",
                "owners": 1,
            },
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(json_body(first)["account_number"], "")
        self.assertEqual(json_body(second)["account_number"], "")
        self.assertEqual(duplicate.status_code, 409)

    def test_color_api_generates_when_missing_and_rejects_non_hex_values(self):
        created = self.post_json("/api/categories/", {"name": "Auto Color"})
        invalid = self.post_json("/api/tags/", {"name": "Bad Color", "color": "red"})

        self.assertEqual(created.status_code, 201)
        self.assertRegex(json_body(created)["color"], r"^#[0-9A-F]{6}$")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(json_body(invalid)["error"], "Invalid color")

    def test_settings_api_defaults_to_internal_account_reference_ignore(self):
        default_response = self.client.get("/api/settings/")
        self.assertEqual(default_response.status_code, 200)
        self.assertTrue(
            json_body(default_response)["ignore_internal_account_references"]
        )
        self.assertEqual(json_body(default_response)["default_currency"], "CZK")
        self.assertIsNone(json_body(default_response)["internal_transfer_subcategory"])

        updated = self.patch_json(
            "/api/settings/",
            {
                "default_currency": "eur",
                "ignore_internal_account_references": False,
                "internal_transfer_subcategory_id": str(self.subcategory.id),
            },
        )
        self.assertEqual(updated.status_code, 200)
        payload = json_body(updated)
        self.assertFalse(payload["ignore_internal_account_references"])
        self.assertEqual(payload["default_currency"], "EUR")
        self.assertEqual(
            payload["internal_transfer_subcategory"]["id"], str(self.subcategory.id)
        )

    def test_csv_mapping_column_detection_returns_headers_without_creating_mapping(
        self,
    ):
        existing_count = CSVMapping.objects.count()

        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {
                "default_currency": "CZK",
                "csv_file": self.csv_file(
                    "ID;Datum;Popis;Castka\napi-1;02.01.2026;McDonalds;-12,50\n"
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["headers"], ["ID", "Datum", "Popis", "Castka"])
        self.assertEqual(payload["loaded"], 1)
        self.assertEqual(payload["detected_settings"]["delimiter"], ";")
        self.assertEqual(payload["detected_settings"]["date_format"], "%d.%m.%Y")
        self.assertEqual(payload["detected_settings"]["decimal_separator"], ",")
        self.assertEqual(payload["sample_rows"][0]["raw"]["Popis"], "McDonalds")
        self.assertEqual(CSVMapping.objects.count(), existing_count)

    def test_csv_mapping_list_includes_headers_from_imported_raw_data(self):
        csv_import = CSVImport.objects.create(
            source_filename="statement.csv",
            bank_account=self.account,
            csv_mapping=self.mapping,
        )
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Imported row",
            amount=Decimal("-12.50"),
            raw_data={
                "ID": "tx-1",
                "Date": "2026-01-02",
                "Description": "Imported row",
                "Extra Note": "Visible on edit",
            },
        )

        response = self.client.get("/api/csv-mappings/")
        payload = json_body(response)
        mapping_payload = next(
            item for item in payload if item["id"] == str(self.mapping.id)
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            mapping_payload["available_headers"],
            ["ID", "Date", "Description", "Extra Note"],
        )

    def test_csv_mapping_column_detection_detects_utf8_comma_decimal_dot(self):
        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {
                "csv_file": self.csv_file(
                    "ID,Date,Description,Amount\napi-1,2026-01-02,Salary,1234.56\n"
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["headers"], ["ID", "Date", "Description", "Amount"])
        self.assertEqual(payload["detected_settings"]["delimiter"], ",")
        self.assertIn(payload["detected_settings"]["encoding"], ["utf-8-sig", "utf-8"])
        self.assertEqual(payload["detected_settings"]["header_row"], 0)
        self.assertEqual(payload["detected_settings"]["date_format"], "%Y-%m-%d")
        self.assertEqual(payload["detected_settings"]["decimal_separator"], ".")

    def test_csv_mapping_column_detection_detects_encoding_and_header_row(self):
        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {
                "csv_file": self.encoded_csv_file(
                    "Výpis účtu\n"
                    "Účet;115618804\n"
                    "ID;Datum;Popis;Částka;Měna\n"
                    "api-1;06.01.2025;Kavárna;-1 234,50;CZK\n",
                    "cp1250",
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["headers"], ["ID", "Datum", "Popis", "Částka", "Měna"])
        self.assertIn(
            payload["detected_settings"]["encoding"], ["cp1250", "windows-1250"]
        )
        self.assertEqual(payload["detected_settings"]["delimiter"], ";")
        self.assertEqual(payload["detected_settings"]["header_row"], 2)
        self.assertEqual(payload["detected_settings"]["date_format"], "%d.%m.%Y")
        self.assertEqual(payload["detected_settings"]["decimal_separator"], ",")
        self.assertEqual(payload["detected_settings"]["thousands_separator"], " ")

    def test_csv_mapping_column_detection_requires_file(self):
        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {"delimiter": ","},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json_body(response)["details"]["field"], "csv_file")

    def test_csv_mapping_column_detection_rejects_empty_csv(self):
        response = self.client.post(
            "/api/csv-mappings/detect-columns/",
            {"csv_file": self.csv_file("")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json_body(response)["error"], "CSV file is empty")

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
        self.assertEqual(
            payload["updated_transactions"][0]["id"], str(transaction_obj.id)
        )
        self.assertEqual(
            payload["updated_transactions"][0]["transaction_date"],
            "2026-01-02",
        )
        self.assertEqual(
            payload["updated_transactions"][0]["description"],
            "McDonalds Prague",
        )
        self.assertEqual(payload["updated_transactions"][0]["amount"], "-12.50")

    def test_keyword_preview_and_recategorize_explain_conflicts(self):
        transport = Category.objects.create(name="Transport")
        gas = Subcategory.objects.create(name="Gas", category=transport)
        cash_keyword = self.keyword(
            "Cash withdrawal",
            ["KB ATM"],
            subcategory=self.subcategory,
            priority=100,
        )
        gas_keyword = Keyword.objects.create(
            name="MOL",
            include_terms=["MOL"],
            subcategory=gas,
            want_need_investment=WantNeedInvestment.NEED,
            priority=100,
        )
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="KB ATM Olomouc",
            amount=Decimal("-1000.00"),
        )

        preview = self.post_json("/api/keywords/preview/", {"text": "KB ATM Olomouc"})
        preview_payload = json_body(preview)
        recategorized = self.post_json(
            "/api/transactions/recategorize/",
            {"transaction_ids": [str(transaction_obj.id)]},
        )
        recategorize_payload = json_body(recategorized)

        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview_payload["categorization"]["status"], "conflict")
        self.assertCountEqual(
            preview_payload["categorization"]["matched_keyword_ids"],
            [str(cash_keyword.id), str(gas_keyword.id)],
        )
        self.assertEqual(recategorize_payload["conflicts"], 1)
        self.assertEqual(
            recategorize_payload["conflict_details"][0]["transaction"]["id"],
            str(transaction_obj.id),
        )
        self.assertEqual(
            len(
                recategorize_payload["conflict_details"][0]["categorization"][
                    "top_matched_keywords"
                ]
            ),
            2,
        )

    def test_delete_impact_describes_what_a_category_delete_changes(self):
        self.keyword("Lunch", ["lunch"])
        settings_obj = FinanceSettings.load()
        settings_obj.internal_transfer_subcategory = self.subcategory
        settings_obj.save()
        for locked in (False, True):
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                description="Lunch",
                amount=Decimal("-120.00"),
                subcategory=self.subcategory,
                is_categorization_locked=locked,
            )

        response = self.client.get(f"/api/categories/{self.category.id}/delete-impact/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json_body(response),
            {
                "blocked": "",
                "effects": [
                    "1 subcategory will be deleted too.",
                    "2 transactions will become uncategorized, including 1 locked one.",
                    "1 keyword will lose its subcategory.",
                    "Internal transfers will no longer get a subcategory.",
                ],
            },
        )

    def test_account_with_transactions_cannot_be_deleted(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-120.00"),
        )
        empty_account = BankAccount.objects.create(name="Empty")

        impact = json_body(
            self.client.get(f"/api/bank-accounts/{self.account.id}/delete-impact/")
        )
        blocked = self.delete_json(f"/api/bank-accounts/{self.account.id}/")
        allowed = self.delete_json(f"/api/bank-accounts/{empty_account.id}/")

        self.assertIn("still has 1 transaction", impact["blocked"])
        self.assertEqual(blocked.status_code, 400)
        self.assertIn("still has 1 transaction", json_body(blocked)["error"])
        self.assertTrue(BankAccount.objects.filter(id=self.account.id).exists())
        self.assertEqual(allowed.status_code, 200)
        self.assertFalse(BankAccount.objects.filter(id=empty_account.id).exists())

    def test_delete_impact_for_mappings_and_tags(self):
        self.keyword("Lunch", ["lunch"])
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-120.00"),
        )
        transaction_obj.tags.add(self.tag)

        mapping_impact = json_body(
            self.client.get(f"/api/csv-mappings/{self.mapping.id}/delete-impact/")
        )
        tag_impact = json_body(
            self.client.get(f"/api/tags/{self.tag.id}/delete-impact/")
        )

        self.assertIn("Main will have no default mapping", mapping_impact["effects"][0])
        self.assertEqual(
            tag_impact["effects"],
            [
                "The tag will be removed from 1 transaction.",
                "1 keyword will stop adding it.",
            ],
        )
