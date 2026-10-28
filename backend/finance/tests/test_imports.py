"""CSV import: the import service and the imports API."""

from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.utils import timezone

from ..constants import WantNeedInvestment
from ..models import (
    CSVImport,
    CSVMapping,
    Transaction,
)
from ..services import (
    CSVImportService,
    ExchangeRateProviderError,
)
from .base import FinanceTestCase, json_body


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

        self.assertEqual(
            preview["headers"], ["ID", "Date", "Description", "Amount", "Currency"]
        )
        self.assertEqual(preview["loaded"], 1)
        self.assertEqual(preview["summary"]["duplicates"], 1)
        self.assertEqual(preview["rows"][0]["categorization"]["status"], "matched")

    def test_dry_run_does_not_create_transactions(self):
        _csv_import, preview = CSVImportService(self.mapping, self.account).import_file(
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

    def test_row_currencies_are_validated(self):
        csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Amount,Currency\n"
                "tx-1,2026-01-02,Bakery,-40,Kč\n"
                "tx-2,2026-01-02,Hotel,-90,eur\n"
                "tx-3,2026-01-02,Unknown,-10,Koruna\n"
            )
        )

        self.assertEqual(csv_import.created_count, 2)
        self.assertEqual(
            dict(Transaction.objects.values_list("original_id", "currency")),
            {"tx-1": "CZK", "tx-2": "EUR"},
        )
        self.assertEqual(report["skipped"]["errors"][0]["line"], 4)
        self.assertIn("Koruna", report["skipped"]["errors"][0]["error"])

    def test_import_report_describes_skipped_rows(self):
        mapping = CSVMapping.objects.create(
            name="Czech bank",
            date_format="%Y-%m-%d",
            column_map={
                "original_id": "ID",
                "transaction_date": "Datum",
                "description": "Zpráva",
                "amount": "Částka",
            },
        )
        body = (
            "ID,Datum,Zpráva,Částka\n"
            "cz-1,2026-01-02,Pekárna,-40\n"
            "cz-2,2026-02-30,Lékárna,-90\n"
        )
        CSVImportService(mapping, self.account).import_file(self.csv_file(body))

        _csv_import, report = CSVImportService(mapping, self.account).import_file(
            self.csv_file(body)
        )

        self.assertEqual(report["skipped"]["duplicates"][0]["description"], "Pekárna")
        self.assertEqual(report["skipped"]["errors"][0]["description"], "Lékárna")
        self.assertIn("2026-02-30", report["skipped"]["errors"][0]["error"])

    def test_amount_signs_and_missing_amounts(self):
        _csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Amount\n"
                "m-1,2026-01-02,Unicode minus,−120.50\n"
                "m-2,2026-01-02,Trailing minus,80-\n"
                "m-3,2026-01-02,Empty amount,\n"
                "m-4,2026-01-02,Dash only,-\n"
                "m-5,2026-01-02,Not a number,n/a\n"
            )
        )

        self.assertEqual(
            dict(Transaction.objects.values_list("original_id", "amount")),
            {"m-1": Decimal("-120.50"), "m-2": Decimal("-80.00")},
        )
        errors = {
            entry["line"]: entry["error"] for entry in report["skipped"]["errors"]
        }
        self.assertEqual(errors[4], "Amount is missing")
        self.assertEqual(errors[5], "Amount is missing")
        self.assertIn("n/a", errors[6])

    def test_amounts_must_match_the_mappings_decimal_separator(self):
        comma_mapping = CSVMapping.objects.create(
            name="Comma decimals",
            delimiter=";",
            date_format="%Y-%m-%d",
            decimal_separator=",",
            column_map=self.mapping.column_map,
        )

        _csv_import, comma_report = CSVImportService(
            comma_mapping, self.account
        ).import_file(
            self.csv_file(
                "ID;Date;Description;Amount\n"
                "c-1;2026-01-02;Grouped;-1.234,50\n"
                "c-2;2026-01-02;Plain;12,50\n"
                "c-3;2026-01-02;Dot decimal;12.50\n"
                "c-4;2026-01-02;Bad grouping;1.23,00\n"
            )
        )
        _csv_import, dot_report = CSVImportService(
            self.mapping, self.account
        ).import_file(
            self.csv_file(
                "ID,Date,Description,Amount\n"
                'd-1,2026-01-03,Grouped,"1,234.50"\n'
                'd-2,2026-01-03,Comma decimal,"12,50"\n'
                "d-3,2026-01-03,Plain,-7.5\n"
            )
        )

        self.assertEqual(
            dict(Transaction.objects.values_list("original_id", "amount")),
            {
                "c-1": Decimal("-1234.50"),
                "c-2": Decimal("12.50"),
                "d-1": Decimal("1234.50"),
                "d-3": Decimal("-7.50"),
            },
        )
        comma_errors = [entry["error"] for entry in comma_report["skipped"]["errors"]]
        dot_errors = [entry["error"] for entry in dot_report["skipped"]["errors"]]
        self.assertEqual(len(comma_errors), 2)
        self.assertIn("'12.50' doesn't match", comma_errors[0])
        self.assertIn("decimal separator (',')", comma_errors[0])
        self.assertIn("'1.23,00'", comma_errors[1])
        self.assertEqual(len(dot_errors), 1)
        self.assertIn("'12,50' doesn't match", dot_errors[0])

    def test_dash_placeholder_in_debit_column_does_not_hide_the_credit(self):
        mapping = CSVMapping.objects.create(
            name="Split amounts",
            date_format="%Y-%m-%d",
            column_map={
                "original_id": "ID",
                "transaction_date": "Date",
                "description": "Description",
                "debit_amount": "Debit",
                "credit_amount": "Credit",
            },
        )

        CSVImportService(mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Debit,Credit\n"
                "d-1,2026-01-02,Refund,-,50\n"
                "d-2,2026-01-02,Shop,30,\n"
            )
        )

        self.assertEqual(
            dict(Transaction.objects.values_list("original_id", "amount")),
            {"d-1": Decimal("50.00"), "d-2": Decimal("-30.00")},
        )

    def test_import_reports_are_compact(self):
        body = (
            "ID,Date,Description,Amount\n"
            "c-1,2026-01-02,Lunch,-120\n"
            "c-2,2026-01-03,Dinner,-300\n"
            "c-3,not-a-date,Broken,-1\n"
        )
        CSVImportService(self.mapping, self.account).import_file(
            self.csv_file("ID,Date,Description,Amount\nc-1,2026-01-02,Lunch,-120\n")
        )

        csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(body)
        )

        created = Transaction.objects.get(original_id="c-2")
        self.assertEqual(
            report["created"],
            {
                "count": 1,
                "transaction_ids": [str(created.id)],
                "category_overlap_count": 0,
                "uncategorized_count": 1,
            },
        )
        duplicate = report["skipped"]["duplicates"][0]
        self.assertNotIn("row", duplicate)
        self.assertEqual(duplicate["description"], "Lunch")
        self.assertIn("duplicate_transaction", duplicate)
        self.assertEqual(report["skipped"]["errors"][0]["row"]["ID"], "c-3")
        csv_import.refresh_from_db()
        self.assertEqual(csv_import.report, report)

    def test_identical_rows_without_ids_all_import_once(self):
        body = (
            "Date,Description,Amount\n"
            "2026-10-01,Bus ticket,-30\n"
            "2026-10-01,Bus ticket,-30\n"
        )

        _csv_import, first = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(body)
        )
        _csv_import, second = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(body)
        )

        self.assertEqual(first["created"]["count"], 2)
        self.assertEqual(first["skipped"]["duplicates"], [])
        self.assertEqual(second["created"]["count"], 0)
        self.assertEqual(len(second["skipped"]["duplicates"]), 2)
        self.assertEqual(
            {
                duplicate["duplicate_transaction"]["id"]
                for duplicate in second["skipped"]["duplicates"]
            },
            {str(pk) for pk in Transaction.objects.values_list("id", flat=True)},
        )

    def test_overlapping_file_without_ids_adds_only_the_extra_identical_rows(self):
        header = "Date,Description,Amount\n"
        row = "2026-10-01,Bus ticket,-30\n"
        CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(header + row)
        )

        _csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(header + row * 3)
        )

        self.assertEqual(report["created"]["count"], 2)
        self.assertEqual(len(report["skipped"]["duplicates"]), 1)
        self.assertEqual(Transaction.objects.count(), 3)

    def test_same_original_id_twice_in_one_file_imports_once(self):
        _csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Amount\n"
                "tx-1,2026-10-01,Bus ticket,-30\n"
                "tx-1,2026-10-01,Bus ticket,-30\n"
            )
        )

        self.assertEqual(report["created"]["count"], 1)
        self.assertEqual(len(report["skipped"]["duplicates"]), 1)

    def test_preview_flags_identical_rows_like_the_import(self):
        header = "Date,Description,Amount\n"
        row = "2026-10-01,Bus ticket,-30\n"
        empty_db_preview = CSVImportService(self.mapping, self.account).preview_file(
            self.csv_file(header + row * 2)
        )
        CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(header + row)
        )

        preview = CSVImportService(self.mapping, self.account).preview_file(
            self.csv_file(header + row * 2)
        )
        _csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(header + row * 2)
        )

        self.assertEqual(empty_db_preview["summary"]["duplicates"], 0)
        flagged = [entry["line"] for entry in preview["rows"] if entry["duplicate"]]
        skipped = [entry["line"] for entry in report["skipped"]["duplicates"]]
        self.assertEqual(len(flagged), 1)
        self.assertEqual(flagged, skipped)
        self.assertEqual(preview["summary"]["duplicates"], 1)
        self.assertEqual(report["created"]["count"], 1)

    def test_preview_summary_covers_rows_beyond_the_sample(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-10-01",
            description="Bus ticket",
            amount=Decimal("-30.00"),
        )

        preview = CSVImportService(self.mapping, self.account).preview_file(
            self.csv_file(
                "Date,Description,Amount\n"
                "2026-09-30,Lunch,-120\n"
                "2026-10-01,Bus ticket,-30\n"
                "not-a-date,Broken,-1\n"
            ),
            sample_size=1,
        )

        self.assertEqual(preview["loaded"], 3)
        self.assertEqual(len(preview["rows"]), 1)
        self.assertEqual(preview["summary"]["valid"], 2)
        self.assertEqual(preview["summary"]["duplicates"], 1)
        self.assertEqual(preview["summary"]["errors"], 1)


class ImportAPITests(FinanceTestCase):
    def test_import_succeeds_when_rate_sync_rejects_a_currency(self):
        with patch("finance.views.sync_missing_exchange_rates") as sync_rates:
            sync_rates.side_effect = ValueError("Currency 'KČ' must be a code.")
            response = self.client.post(
                "/api/imports/",
                {
                    "bank_account_id": str(self.account.id),
                    "csv_mapping_id": str(self.mapping.id),
                    "csv_file": self.csv_file(
                        "ID,Date,Description,Amount,Currency\n"
                        "api-1,2026-01-02,Lunch,-12.50,CZK\n"
                    ),
                },
            )

        payload = json_body(response)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(payload["report"]["created"]["count"], 1)
        self.assertFalse(payload["exchange_rate_sync"]["synced"])

    def test_import_list_leaves_reports_out(self):
        CSVImportService(self.mapping, self.account).import_file(
            self.csv_file("ID,Date,Description,Amount\nl-1,2026-01-02,Lunch,-120\n")
        )

        imports = json_body(self.client.get("/api/imports/"))
        detail = self.client.get(f"/api/imports/{imports[0]['id']}/")
        missing = self.client.get("/api/imports/00000000-0000-0000-0000-000000000000/")

        self.assertEqual(len(imports), 1)
        self.assertNotIn("report", imports[0])
        self.assertEqual(imports[0]["created_count"], 1)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(json_body(detail)["import"]["id"], imports[0]["id"])
        self.assertEqual(json_body(detail)["report"]["created"]["count"], 1)
        self.assertEqual(missing.status_code, 404)

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

        with patch("finance.views.sync_missing_exchange_rates") as sync_rates:
            sync_rates.return_value = {
                "created_rates": 0,
                "recalculation": {"updated": 1},
            }
            committed = self.client.post(
                "/api/imports/",
                {
                    "bank_account_id": str(self.account.id),
                    "csv_mapping_id": str(self.mapping.id),
                    "csv_file": self.csv_file(body),
                },
            )
        committed_payload = json_body(committed)
        self.assertEqual(committed.status_code, 201)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertTrue(committed_payload["exchange_rate_sync"]["attempted"])
        self.assertTrue(committed_payload["exchange_rate_sync"]["synced"])
        sync_rates.assert_called_once()

    def test_import_commit_does_not_fail_when_exchange_rate_sync_fails(self):
        body = (
            "ID,Date,Description,Amount,Currency\napi-1,2026-01-02,Lunch,-12.50,USD\n"
        )

        with patch("finance.views.sync_missing_exchange_rates") as sync_rates:
            sync_rates.side_effect = ExchangeRateProviderError("provider unavailable")
            committed = self.client.post(
                "/api/imports/",
                {
                    "bank_account_id": str(self.account.id),
                    "csv_mapping_id": str(self.mapping.id),
                    "csv_file": self.csv_file(body),
                },
            )
        payload = json_body(committed)

        self.assertEqual(committed.status_code, 201)
        self.assertEqual(Transaction.objects.count(), 1)
        self.assertTrue(payload["exchange_rate_sync"]["attempted"])
        self.assertFalse(payload["exchange_rate_sync"]["synced"])
        self.assertIn("provider unavailable", payload["exchange_rate_sync"]["error"])

    def test_an_import_where_every_row_fails_is_a_failure_and_is_not_kept(self):
        def post(body):
            return self.client.post(
                "/api/imports/",
                {
                    "bank_account_id": str(self.account.id),
                    "csv_mapping_id": str(self.mapping.id),
                    "csv_file": self.csv_file(body),
                },
            )

        all_failed = post(
            "ID,Date,Description,Amount\n"
            "f-1,02.30.2026,Bad date,-1.00\n"
            "f-2,2026-01-02,Bad amount,n/a\n"
        )
        empty = post("ID,Date,Description,Amount\n")
        payload = json_body(all_failed)

        self.assertEqual(all_failed.status_code, 400)
        self.assertEqual(
            payload["error"],
            "None of the 2 rows could be imported. Check that the bank account's "
            "import mapping fits this file.",
        )
        self.assertEqual(payload["report"]["skipped"]["error_count"], 2)
        self.assertEqual(len(payload["report"]["skipped"]["errors"]), 2)
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(json_body(empty)["error"], "The file has no rows to import.")
        self.assertFalse(CSVImport.objects.exists())
        self.assertFalse(Transaction.objects.exists())

    def test_import_reports_list_at_most_100_failed_rows(self):
        lines = ["ID,Date,Description,Amount", "ok-1,2026-01-02,Lunch,-12.50"]
        lines += [f"bad-{index},2026-01-02,Broken,n/a" for index in range(150)]

        csv_import, report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file("\n".join(lines) + "\n")
        )
        csv_import.refresh_from_db()

        self.assertEqual(csv_import.status, CSVImport.STATUS_COMPLETED)
        self.assertEqual(csv_import.created_count, 1)
        self.assertEqual(csv_import.error_count, 150)
        self.assertEqual(csv_import.report["skipped"]["error_count"], 150)
        self.assertEqual(len(csv_import.report["skipped"]["errors"]), 100)
        self.assertEqual(report["skipped"]["errors"][0]["line"], 3)

    def test_imports_api_lists_recent_imports(self):
        older = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="older.csv",
            loaded_count=3,
            created_count=2,
        )
        latest = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="latest.csv",
            loaded_count=5,
            created_count=4,
            skipped_count=1,
        )
        now = timezone.now()
        CSVImport.objects.filter(id=older.id).update(
            created_at=now - timedelta(minutes=1)
        )
        CSVImport.objects.filter(id=latest.id).update(created_at=now)

        response = self.client.get("/api/imports/", {"limit": "1"})
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]["id"], str(latest.id))
        self.assertEqual(payload[0]["source_filename"], "latest.csv")
        self.assertEqual(payload[0]["created_count"], 4)
        self.assertEqual(payload[0]["skipped_count"], 1)
        self.assertNotEqual(payload[0]["id"], str(older.id))

    def test_imports_api_lists_every_import_when_asked(self):
        for index in range(30):
            CSVImport.objects.create(
                bank_account=self.account,
                csv_mapping=self.mapping,
                source_filename=f"file-{index}.csv",
            )
        default = json_body(self.client.get("/api/imports/"))
        everything = json_body(self.client.get("/api/imports/", {"limit": "1000"}))

        self.assertEqual(len(default), 8)
        self.assertEqual(len(everything), 30)

    def test_deleting_an_import_removes_the_transactions_it_created(self):
        body = "ID,Date,Description,Amount\nimp-1,2026-01-02,Lunch,-120\n"
        old_import, _report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(body)
        )
        new_import, _report = CSVImportService(self.mapping, self.account).import_file(
            self.csv_file(
                "ID,Date,Description,Amount\n"
                "imp-1,2026-01-02,Lunch,-120\n"
                "imp-2,2026-01-03,Dinner,-300\n"
            )
        )

        impact = json_body(
            self.client.get(f"/api/imports/{new_import.id}/delete-impact/")
        )
        response = self.delete_json(f"/api/imports/{new_import.id}/")

        self.assertEqual(
            impact["effects"], ["1 transaction created by this import will be deleted."]
        )
        self.assertEqual(json_body(response), {"deleted": True, "transactions": 1})
        self.assertEqual(
            list(Transaction.objects.values_list("original_id", flat=True)), ["imp-1"]
        )
        self.assertEqual(list(CSVImport.objects.all()), [old_import])
