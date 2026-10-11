"""The transactions API: filters, edits, bulk actions, recategorize, transfers."""

import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from ..constants import Direction, ImportFileFormat, WantNeedInvestment
from ..models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    FinanceSettings,
    InternalTransferMatch,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
)
from .base import FinanceTestCase, json_body


class TransactionAPITests(FinanceTestCase):
    def test_explicit_lock_value_wins_in_row_edits(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-120.00"),
        )
        url = f"/api/transactions/{transaction_obj.id}/"

        self.patch_json(
            url,
            {
                "subcategory_id": str(self.subcategory.id),
                "is_categorization_locked": False,
            },
        )
        transaction_obj.refresh_from_db()
        self.assertEqual(transaction_obj.subcategory, self.subcategory)
        self.assertFalse(transaction_obj.is_categorization_locked)

        self.patch_json(url, {"subcategory_id": str(self.subcategory.id)})
        transaction_obj.refresh_from_db()
        self.assertTrue(transaction_obj.is_categorization_locked)

    def test_transfer_apply_counts_pairs_that_are_no_longer_offered(self):
        response = self.post_json(
            "/api/transactions/internal-transfers/apply/",
            {"candidate_ids": ["no-longer-there"]},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["created"], 0)
        self.assertEqual(json_body(response)["skipped"], 1)

    def test_row_edit_reports_whether_the_row_still_matches_the_filters(self):
        other = Subcategory.objects.create(name="Groceries", category=self.category)
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            my_note="dentist visit",
            amount=Decimal("-120.00"),
            subcategory=self.subcategory,
        )
        url = f"/api/transactions/{transaction_obj.id}/"
        # Edits lock the row, so the scope includes locked rows.
        scope = f"?subcategory={self.subcategory.id}&include_locked=true"

        moved = json_body(
            self.patch_json(url + scope, {"subcategory_id": str(other.id)})
        )
        back = json_body(
            self.patch_json(url + scope, {"subcategory_id": str(self.subcategory.id)})
        )
        # Matches only through a note field, which the table never receives.
        searched = json_body(
            self.patch_json(
                url + "?q=dentist&include_locked=true", {"want_need_investment": "need"}
            )
        )

        self.assertFalse(moved["matches_filters"])
        self.assertTrue(back["matches_filters"])
        self.assertTrue(searched["matches_filters"])

    def test_transaction_update_filters_and_pagination(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.WANT,
        )
        transaction_obj.tags.add(self.tag)
        transaction_id = str(transaction_obj.id)
        # Transactions come from imports; the unused create endpoint, which skipped
        # import dedupe and categorization, is gone.
        self.assertEqual(self.post_json("/api/transactions/", {}).status_code, 405)

        patch = self.patch_json(
            f"/api/transactions/{transaction_id}/",
            {"my_note": "Reviewed", "is_ignored": True, "tag_ids": []},
        )
        self.assertEqual(patch.status_code, 200)
        self.assertEqual(json_body(patch)["tags"], [])
        self.assertTrue(json_body(patch)["is_categorization_locked"])

        hidden = self.client.get("/api/transactions/", {"q": "Reviewed"})
        locked_hidden = self.client.get(
            "/api/transactions/",
            {"q": "Reviewed", "include_ignored": "true"},
        )
        visible = self.client.get(
            "/api/transactions/",
            {
                "q": "Reviewed",
                "include_ignored": "true",
                "include_locked": "true",
                "limit": "1",
            },
        )

        self.assertEqual(json_body(hidden)["count"], 0)
        self.assertEqual(json_body(hidden)["total_count"], 1)
        self.assertEqual(json_body(locked_hidden)["count"], 0)
        self.assertEqual(json_body(visible)["count"], 1)
        self.assertEqual(json_body(visible)["total_count"], 1)
        self.assertEqual(json_body(visible)["limit"], 1)

    def test_transaction_list_omits_raw_data_but_exposes_on_demand(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Raw row",
            amount=Decimal("-12.50"),
            raw_data={"Description": "Raw row", "Amount": "-12.50"},
        )

        list_response = self.client.get("/api/transactions/", {"limit": "1"})
        list_payload = json_body(list_response)
        row = list_payload["results"][0]
        raw_data_response = self.client.get(
            f"/api/transactions/{transaction_obj.id}/raw-data/"
        )

        self.assertEqual(list_response.status_code, 200)
        self.assertTrue(row["has_raw_data"])
        self.assertNotIn("raw_data", row)
        self.assertEqual(raw_data_response.status_code, 200)
        self.assertEqual(
            json_body(raw_data_response)["raw_data"],
            {"Description": "Raw row", "Amount": "-12.50"},
        )

    def test_transaction_categorization_edits_lock_and_can_unlock(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Manual edit",
            amount=Decimal("-12.50"),
        )

        subcategory_patch = self.patch_json(
            f"/api/transactions/{transaction_obj.id}/",
            {"subcategory_id": str(self.subcategory.id)},
        )
        transaction_obj.refresh_from_db()

        self.assertEqual(subcategory_patch.status_code, 200)
        self.assertTrue(transaction_obj.is_categorization_locked)
        self.assertTrue(json_body(subcategory_patch)["is_categorization_locked"])

        unlocked = self.patch_json(
            f"/api/transactions/{transaction_obj.id}/",
            {"is_categorization_locked": False},
        )
        transaction_obj.refresh_from_db()

        self.assertEqual(unlocked.status_code, 200)
        self.assertFalse(transaction_obj.is_categorization_locked)
        self.assertFalse(json_body(unlocked)["is_categorization_locked"])

        wni_patch = self.patch_json(
            f"/api/transactions/{transaction_obj.id}/",
            {"want_need_investment": WantNeedInvestment.NEED},
        )
        transaction_obj.refresh_from_db()

        self.assertEqual(wni_patch.status_code, 200)
        self.assertTrue(transaction_obj.is_categorization_locked)

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
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-06",
            description="Salary",
            amount=Decimal("100.00"),
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
        tagged_response = self.client.get(
            "/api/transactions/", {"tag": "__any__", "limit": "10"}
        )
        tagged_or_untagged_response = self.client.get(
            "/api/transactions/", {"tag": "__any__,__unassigned__", "limit": "10"}
        )
        income_response = self.client.get(
            "/api/transactions/",
            {"direction": "income", "limit": "10"},
        )
        expense_response = self.client.get(
            "/api/transactions/",
            {"direction": "expense", "limit": "10"},
        )
        both_direction_response = self.client.get(
            "/api/transactions/?direction=income&direction=expense&limit=10"
        )

        self.assertEqual(json_body(account_response)["count"], 5)
        self.assertEqual(json_body(category_response)["count"], 4)
        self.assertEqual(json_body(tagged_response)["count"], 2)
        self.assertEqual(json_body(tagged_or_untagged_response)["count"], 5)
        self.assertEqual(json_body(subcategory_response)["count"], 3)
        self.assertEqual(json_body(wni_response)["count"], 3)
        self.assertEqual(json_body(tag_response)["count"], 4)
        self.assertEqual(json_body(income_response)["count"], 1)
        self.assertEqual(json_body(expense_response)["count"], 4)
        self.assertEqual(json_body(both_direction_response)["count"], 5)

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

    def test_recategorize_reports_counts_with_sample_rows(self):
        for index in range(5):
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                description=f"Unknown shop {index}",
                amount=Decimal("-1.00"),
            )

        with patch("finance.services.RECATEGORIZE_SAMPLE_SIZE", 2):
            payload = json_body(self.post_json("/api/transactions/recategorize/", {}))

        # The response used to list every processed row in each group.
        self.assertEqual(payload["processed"], 5)
        self.assertEqual(payload["uncategorized"], 5)
        self.assertEqual(payload["unchanged"], 5)
        for group in ("uncategorized", "unchanged"):
            self.assertEqual(len(payload[f"{group}_transaction_ids"]), 2)
            self.assertEqual(len(payload[f"{group}_transactions"]), 2)

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

    def test_recategorize_skips_locked_transactions_unless_requested(self):
        self.keyword("McDonalds", ["mcdonald"])
        locked_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
            is_categorization_locked=True,
        )

        skipped_response = self.post_json(
            "/api/transactions/recategorize/?date_from=2026-01-01&include_locked=true",
            {},
        )
        skipped_payload = json_body(skipped_response)
        locked_transaction.refresh_from_db()

        self.assertEqual(skipped_response.status_code, 200)
        self.assertEqual(skipped_payload["processed"], 1)
        self.assertEqual(skipped_payload["updated"], 0)
        self.assertEqual(skipped_payload["skipped_locked"], 1)
        self.assertEqual(
            skipped_payload["skipped_locked_transaction_ids"],
            [str(locked_transaction.id)],
        )
        self.assertIsNone(locked_transaction.subcategory)
        self.assertTrue(locked_transaction.is_categorization_locked)

        recategorized_response = self.post_json(
            "/api/transactions/recategorize/?date_from=2026-01-01&include_locked=true",
            {"include_locked": True},
        )
        recategorized_payload = json_body(recategorized_response)
        locked_transaction.refresh_from_db()

        self.assertEqual(recategorized_response.status_code, 200)
        self.assertEqual(recategorized_payload["processed"], 1)
        self.assertEqual(recategorized_payload["updated"], 1)
        self.assertEqual(recategorized_payload["skipped_locked"], 0)
        self.assertEqual(locked_transaction.subcategory, self.subcategory)
        self.assertFalse(locked_transaction.is_categorization_locked)

    def test_bulk_assign_handles_more_rows_than_sqlite_parameters(self):
        # SQLite allows 32,766 parameters per statement; every ID used to be one.
        tag = Tag.objects.create(name="Reviewed")
        Transaction.objects.bulk_create(
            [
                Transaction(
                    bank_account=self.account,
                    transaction_date=date(2026, 1, 2),
                    description=f"Row {index}",
                    amount=Decimal("-1.00"),
                )
                for index in range(32_800)
            ],
            batch_size=2000,
        )

        # Assigning a subcategory takes the rows out of the "uncategorized" filter;
        # the tags must still reach all of them.
        response = self.post_json(
            "/api/transactions/bulk-assign/?category=__unassigned__",
            {
                "subcategory_id": str(self.subcategory.id),
                "tag_mode": "add",
                "tag_ids": [str(tag.id)],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["updated"], 32_800)
        self.assertEqual(
            Transaction.objects.filter(subcategory=self.subcategory).count(), 32_800
        )
        self.assertEqual(
            Transaction.tags.through.objects.filter(tag=tag).count(), 32_800
        )

    def test_bulk_assign_transactions_updates_filtered_scope_and_locks(self):
        stale_tag = Tag.objects.create(name="Existing tag")
        assigned_tag = Tag.objects.create(name="Reviewed")
        filtered_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Filtered",
            amount=Decimal("-12.50"),
        )
        filtered_transaction.tags.add(stale_tag)
        outside_filter = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2025-12-31",
            description="Outside",
            amount=Decimal("-9.00"),
        )

        bulk_response = self.post_json(
            "/api/transactions/bulk-assign/?date_from=2026-01-01",
            {
                "subcategory_id": str(self.subcategory.id),
                "tag_mode": "add",
                "tag_ids": [str(assigned_tag.id)],
                "want_need_investment": WantNeedInvestment.NEED,
                "is_ignored": True,
                "is_categorization_locked": False,
            },
        )
        bulk_payload = json_body(bulk_response)
        filtered_transaction.refresh_from_db()
        outside_filter.refresh_from_db()

        self.assertEqual(bulk_response.status_code, 200)
        self.assertEqual(bulk_payload["updated"], 1)
        self.assertEqual(
            [action["field"] for action in bulk_payload["actions"]],
            [
                "subcategory",
                "tags",
                "want_need_investment",
                "is_ignored",
                "is_categorization_locked",
            ],
        )
        self.assertEqual(filtered_transaction.subcategory, self.subcategory)
        self.assertCountEqual(
            list(filtered_transaction.tags.values_list("id", flat=True)),
            [stale_tag.id, assigned_tag.id],
        )
        self.assertEqual(
            filtered_transaction.want_need_investment, WantNeedInvestment.NEED
        )
        self.assertTrue(filtered_transaction.is_ignored)
        self.assertFalse(filtered_transaction.is_categorization_locked)
        self.assertIsNone(outside_filter.subcategory)
        self.assertFalse(outside_filter.is_ignored)
        self.assertFalse(outside_filter.is_categorization_locked)

        # The old single-assignment payload is no longer understood.
        legacy_response = self.post_json(
            "/api/transactions/bulk-assign/?date_from=2026-01-01&include_ignored=true",
            {"assignment_type": "tag", "tag_id": str(assigned_tag.id)},
        )

        self.assertEqual(legacy_response.status_code, 400)

    def test_internal_transfer_preview_and_apply_marks_confirmed_pairs(self):
        transfer_subcategory = Subcategory.objects.create(
            name="Internal Transfer", category=self.category
        )
        settings_obj = FinanceSettings.load()
        settings_obj.internal_transfer_subcategory = transfer_subcategory
        settings_obj.save()
        savings_account = BankAccount.objects.create(
            name="Savings",
            account_number="456/0100",
            default_csv_mapping=self.mapping,
        )
        outgoing = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Transfer to savings",
            amount=Decimal("-100.00"),
            currency="CZK",
            counterparty_account_number="456/0100",
            variable_symbol="202601",
        )
        incoming = Transaction.objects.create(
            bank_account=savings_account,
            transaction_date="2026-01-04",
            description="Transfer from main",
            amount=Decimal("100.00"),
            currency="CZK",
            counterparty_account_number="123/0100",
            variable_symbol="202601",
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Same account movement",
            amount=Decimal("100.00"),
            currency="CZK",
        )

        too_strict_response = self.client.get(
            "/api/transactions/internal-transfers/preview/",
            {"date_tolerance_days": 1},
        )
        preview_response = self.client.get(
            "/api/transactions/internal-transfers/preview/",
            {"date_tolerance_days": 2},
        )
        preview_payload = json_body(preview_response)
        candidate = preview_payload["candidates"][0]

        self.assertEqual(too_strict_response.status_code, 200)
        self.assertEqual(json_body(too_strict_response)["count"], 0)
        self.assertEqual(preview_response.status_code, 200)
        self.assertEqual(preview_payload["count"], 1)
        self.assertEqual(candidate["confidence_level"], "high")
        self.assertEqual(candidate["date_delta_days"], 2)
        self.assertEqual(candidate["outgoing"]["id"], str(outgoing.id))
        self.assertEqual(candidate["incoming"]["id"], str(incoming.id))
        reason_labels = [reason["label"] for reason in candidate["match_reasons"]]
        reason_tones = {
            reason["label"]: reason["tone"] for reason in candidate["match_reasons"]
        }
        self.assertIn("Same amount", reason_labels)
        self.assertIn("2 days apart", reason_labels)
        self.assertIn("Outgoing account match", reason_labels)
        self.assertIn("Incoming account match", reason_labels)
        self.assertIn("Variable symbol match", reason_labels)
        self.assertNotIn("Same currency", reason_labels)
        self.assertNotIn("Opposite directions", reason_labels)
        self.assertEqual(reason_tones["Same amount"], "positive")
        self.assertEqual(reason_tones["2 days apart"], "negative")

        apply_response = self.post_json(
            "/api/transactions/internal-transfers/apply/?date_tolerance_days=2",
            {"candidate_ids": [candidate["id"]]},
        )
        apply_payload = json_body(apply_response)
        outgoing.refresh_from_db()
        incoming.refresh_from_db()

        self.assertEqual(apply_response.status_code, 200)
        self.assertEqual(apply_payload["created"], 1)
        self.assertEqual(InternalTransferMatch.objects.count(), 1)
        self.assertTrue(outgoing.is_ignored)
        self.assertTrue(incoming.is_ignored)
        self.assertTrue(outgoing.is_categorization_locked)
        self.assertTrue(incoming.is_categorization_locked)
        self.assertEqual(outgoing.subcategory, transfer_subcategory)
        self.assertEqual(incoming.subcategory, transfer_subcategory)

        matched_preview = self.client.get(
            "/api/transactions/internal-transfers/preview/",
            {
                "date_tolerance_days": 2,
                "include_ignored": "true",
                "include_locked": "true",
            },
        )

        self.assertEqual(matched_preview.status_code, 200)
        self.assertEqual(json_body(matched_preview)["count"], 0)

        override_subcategory = Subcategory.objects.create(
            name="Transfer Override", category=self.category
        )
        override_outgoing = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-08",
            description="Transfer to savings override",
            amount=Decimal("-250.00"),
            currency="CZK",
        )
        override_incoming = Transaction.objects.create(
            bank_account=savings_account,
            transaction_date="2026-01-08",
            description="Transfer from main override",
            amount=Decimal("250.00"),
            currency="CZK",
        )
        override_preview = self.client.get(
            "/api/transactions/internal-transfers/preview/",
            {"date_tolerance_days": 0},
        )
        override_candidate = json_body(override_preview)["candidates"][0]
        override_apply = self.post_json(
            "/api/transactions/internal-transfers/apply/?date_tolerance_days=0",
            {
                "candidate_ids": [override_candidate["id"]],
                "subcategory_id": str(override_subcategory.id),
            },
        )
        override_outgoing.refresh_from_db()
        override_incoming.refresh_from_db()

        self.assertEqual(override_apply.status_code, 200)
        self.assertEqual(json_body(override_apply)["created"], 1)
        self.assertEqual(override_outgoing.subcategory, override_subcategory)
        self.assertEqual(override_incoming.subcategory, override_subcategory)

    def test_recategorize_with_locked_rows_keeps_matched_transfers_ignored(self):
        self.keyword("Transfers", ["transfer"])
        transfer_subcategory = Subcategory.objects.create(
            name="Internal Transfer", category=self.category
        )
        savings_account = BankAccount.objects.create(
            name="Savings", default_csv_mapping=self.mapping
        )
        legs = [
            Transaction.objects.create(
                bank_account=account,
                transaction_date="2026-01-02",
                description="Transfer",
                amount=Decimal(amount),
                is_ignored=True,
                is_categorization_locked=True,
                subcategory=transfer_subcategory,
            )
            for account, amount in [(self.account, "-100"), (savings_account, "100")]
        ]
        InternalTransferMatch.objects.create(
            outgoing_transaction=legs[0], incoming_transaction=legs[1]
        )

        response = self.post_json(
            "/api/transactions/recategorize/"
            "?date_from=2026-01-01&include_ignored=true&include_locked=true",
            {"include_locked": True},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json_body(response)["skipped_locked"], 2)
        for leg in legs:
            leg.refresh_from_db()
            self.assertTrue(leg.is_ignored)
            self.assertTrue(leg.is_categorization_locked)
            self.assertEqual(leg.subcategory, transfer_subcategory)

    def test_rejected_writes_save_nothing(self):
        missing_tag = "00000000-0000-0000-0000-000000000000"
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-120.00"),
        )

        patch_response = self.patch_json(
            f"/api/transactions/{transaction_obj.id}/",
            {"subcategory_id": str(self.subcategory.id), "tag_ids": [missing_tag]},
        )
        keyword_response = self.post_json(
            "/api/keywords/",
            {"name": "Lunch", "include_terms": ["lunch"], "tag_ids": [missing_tag]},
        )

        self.assertEqual(patch_response.status_code, 400)
        self.assertEqual(keyword_response.status_code, 400)
        transaction_obj.refresh_from_db()
        self.assertIsNone(transaction_obj.subcategory)
        self.assertFalse(transaction_obj.is_categorization_locked)
        self.assertFalse(Keyword.objects.exists())

    def test_bulk_delete_removes_the_filtered_rows_only_when_the_count_matches(self):
        other_account = BankAccount.objects.create(name="Other")
        self.make_transactions(self.account, "-10", "-20", "-30")
        (kept,) = self.make_transactions(other_account, "-40")
        url = f"/api/transactions/bulk-delete/?bank_account={self.account.id}"

        preview = json_body(self.client.get(url))
        stale = self.post_json(url, {"expected_count": 2})
        deleted = self.post_json(url, {"expected_count": 3})

        self.assertEqual(preview, {"count": 3, "effects": []})
        self.assertEqual(stale.status_code, 400)
        self.assertIn("match 3 transactions, not 2", json_body(stale)["error"])
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(json_body(deleted), {"deleted": 3})
        self.assertEqual(list(Transaction.objects.all()), [kept])

    def test_delete_impact_warns_about_locked_rows_and_split_transfers(self):
        savings = BankAccount.objects.create(name="Savings")
        (outgoing,) = self.make_transactions(
            self.account, "-100", is_ignored=True, is_categorization_locked=True
        )
        (incoming,) = self.make_transactions(
            savings, "100", is_ignored=True, is_categorization_locked=True
        )
        InternalTransferMatch.objects.create(
            outgoing_transaction=outgoing, incoming_transaction=incoming
        )

        bulk = json_body(
            self.client.get(
                "/api/transactions/bulk-delete/?include_ignored=true"
                f"&include_locked=true&bank_account={self.account.id}"
            )
        )
        single = json_body(
            self.client.get(f"/api/transactions/{outgoing.id}/delete-impact/")
        )
        response = self.delete_json(f"/api/transactions/{outgoing.id}/")

        self.assertEqual(
            bulk["effects"],
            [
                "1 of them is locked, so manual edits are lost too.",
                "1 matched transfer will lose one half; the other half stays ignored "
                "and locked.",
            ],
        )
        self.assertEqual(
            single["effects"],
            [
                "It is locked, so your manual edits are lost too.",
                "It is half of a matched transfer; the other half stays ignored and "
                "locked.",
            ],
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(InternalTransferMatch.objects.exists())
        incoming.refresh_from_db()
        self.assertTrue(incoming.is_ignored)

    def test_search_ignores_case_accents_and_punctuation(self):
        for description, counterparty in [
            ("ČSOB Praha", ""),
            ("Kavárna U Lípy", ""),
            ("LIDL-Praha 5", ""),
            ("Coffee", "Shop"),
        ]:
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                description=description,
                counterparty_name=counterparty,
                amount=Decimal("-10.00"),
            )

        def found(query):
            payload = json_body(self.client.get("/api/transactions/", {"q": query}))
            return sorted(row["description"] for row in payload["results"])

        self.assertEqual(found("csob"), ["ČSOB Praha"])
        self.assertEqual(found("KAVARNA u lipy"), ["Kavárna U Lípy"])
        self.assertEqual(found("lidl praha"), ["LIDL-Praha 5"])
        self.assertEqual(found("shop"), ["Coffee"])
        # Fields are matched one by one, as in the frontend's filter check.
        self.assertEqual(found("coffeeshop"), [])
        # A query with nothing searchable doesn't filter at all.
        self.assertEqual(len(found("&")), 4)

    def test_unmatching_a_transfer_restores_what_the_match_changed(self):
        outgoing, incoming, match = self.apply_transfer_pair(
            subcategory=self.subcategory
        )
        outgoing.refresh_from_db()
        self.assertTrue(outgoing.is_ignored)
        self.assertNotEqual(outgoing.subcategory, self.subcategory)

        response = self.delete_json(
            f"/api/transactions/internal-transfers/matches/{match.id}/"
        )

        self.assertEqual(json_body(response), {"unmatched": True, "restored": True})
        self.assertFalse(InternalTransferMatch.objects.exists())
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertEqual(outgoing.subcategory, self.subcategory)
        self.assertIsNone(incoming.subcategory)
        for leg in (outgoing, incoming):
            self.assertFalse(leg.is_ignored)
            self.assertFalse(leg.is_categorization_locked)

    def test_unmatching_keeps_edits_made_after_matching(self):
        other = Subcategory.objects.create(name="Gifts", category=self.category)
        outgoing, _incoming, match = self.apply_transfer_pair(
            subcategory=self.subcategory
        )
        Transaction.objects.filter(id=outgoing.id).update(
            subcategory=other, is_categorization_locked=False
        )

        self.delete_json(f"/api/transactions/internal-transfers/matches/{match.id}/")

        outgoing.refresh_from_db()
        self.assertEqual(outgoing.subcategory, other)
        self.assertFalse(outgoing.is_categorization_locked)
        self.assertFalse(outgoing.is_ignored)

    def test_unmatching_an_older_match_recategorizes_both_rows(self):
        self.keyword("Savings transfers", ["savings"])
        savings = BankAccount.objects.create(
            name="Savings", default_csv_mapping=self.mapping
        )
        legs = [
            Transaction.objects.create(
                bank_account=account,
                transaction_date="2026-01-02",
                description=description,
                amount=Decimal(amount),
                is_ignored=True,
                is_categorization_locked=True,
            )
            for account, description, amount in [
                (self.account, "To savings", "-100"),
                (savings, "From main", "100"),
            ]
        ]
        match = InternalTransferMatch.objects.create(
            outgoing_transaction=legs[0], incoming_transaction=legs[1]
        )

        response = self.delete_json(
            f"/api/transactions/internal-transfers/matches/{match.id}/"
        )

        self.assertEqual(json_body(response), {"unmatched": True, "restored": False})
        for leg in legs:
            leg.refresh_from_db()
            self.assertFalse(leg.is_ignored)
            self.assertFalse(leg.is_categorization_locked)
        self.assertEqual(legs[0].subcategory, self.subcategory)
        self.assertIsNone(legs[1].subcategory)

    def test_matched_transfers_are_listed_for_the_current_filters(self):
        _outgoing, _incoming, match = self.apply_transfer_pair()
        scope = "include_ignored=true&include_locked=true"

        listed = json_body(
            self.client.get(f"/api/transactions/internal-transfers/matches/?{scope}")
        )
        later = json_body(
            self.client.get(
                f"/api/transactions/internal-transfers/matches/?{scope}"
                "&date_from=2026-02-01"
            )
        )

        self.assertEqual(listed["count"], 1)
        self.assertEqual(listed["matches"][0]["id"], str(match.id))
        self.assertTrue(listed["matches"][0]["restorable"])
        self.assertEqual(later, {"count": 0, "matches": []})

    def test_recategorize_regenerates_description_from_current_mapping(self):
        self.keyword("McDonalds", ["mcdonald"])
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Original bank text",
            amount=Decimal("-12.50"),
            raw_data={
                "Description": "Original bank text",
                "Details": "McDonalds Prague",
            },
        )
        self.mapping.column_map["description"] = "Details"
        self.mapping.save(update_fields=["column_map", "updated_at"])

        response = self.post_json(
            "/api/transactions/recategorize/",
            {"transaction_ids": [str(transaction_obj.id)]},
        )
        payload = json_body(response)
        transaction_obj.refresh_from_db()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["processed"], 1)
        self.assertEqual(payload["updated"], 1)
        self.assertEqual(transaction_obj.description, "McDonalds Prague")
        self.assertEqual(transaction_obj.subcategory, self.subcategory)

    def test_recategorize_reads_each_row_with_its_import_mapping(self):
        self.keyword("McDonalds", ["mcdonald"])
        xml_mapping = CSVMapping.objects.create(
            name="Statement XML", file_format=ImportFileFormat.CAMT053
        )
        csv_row = Transaction.objects.create(
            bank_account=self.account,
            import_batch=CSVImport.objects.create(
                bank_account=self.account, csv_mapping=self.mapping
            ),
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            counterparty_name="McDonalds",
            amount=Decimal("-12.50"),
            raw_data={"Description": "McDonalds Prague", "Counterparty": "McDonalds"},
        )
        xml_row = Transaction.objects.create(
            bank_account=self.account,
            import_batch=CSVImport.objects.create(
                bank_account=self.account, csv_mapping=xml_mapping
            ),
            transaction_date="2026-02-02",
            description="McDonalds Brno",
            counterparty_name="McDonalds",
            amount=Decimal("-9.90"),
            raw_data={
                "description": "McDonalds Brno",
                "counterparty_name": "McDonalds",
            },
        )

        for default_mapping in [xml_mapping, self.mapping]:
            self.account.default_csv_mapping = default_mapping
            self.account.save()

            response = self.post_json("/api/transactions/recategorize/", {})

            self.assertEqual(response.status_code, 200)
            for row, description in [
                (csv_row, "McDonalds Prague"),
                (xml_row, "McDonalds Brno"),
            ]:
                row.refresh_from_db()
                self.assertEqual(row.description, description)
                self.assertEqual(row.counterparty_name, "McDonalds")
                self.assertEqual(row.subcategory, self.subcategory)

    def test_recategorize_keeps_fields_whose_columns_are_missing_from_raw_data(self):
        self.keyword("McDonalds", ["mcdonald"])
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="McDonalds Prague",
            amount=Decimal("-12.50"),
            raw_data={"Popis": "McDonalds Prague"},
        )

        response = self.post_json(
            "/api/transactions/recategorize/",
            {"transaction_ids": [str(transaction_obj.id)]},
        )
        transaction_obj.refresh_from_db()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(transaction_obj.description, "McDonalds Prague")
        self.assertEqual(transaction_obj.subcategory, self.subcategory)

    def test_uncategorized_suggestions_read_rows_with_their_import_mapping(self):
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=CSVImport.objects.create(
                bank_account=self.account, csv_mapping=self.mapping
            ),
            transaction_date="2026-01-02",
            description="Coffee Shop",
            amount=Decimal("-10.00"),
            raw_data={"Description": "Coffee Shop", "Counterparty": ""},
        )
        self.account.default_csv_mapping = CSVMapping.objects.create(
            name="Statement XML", file_format=ImportFileFormat.CAMT053
        )
        self.account.save()

        payload = json_body(
            self.client.get("/api/transactions/uncategorized-suggestions/")
        )

        self.assertEqual(payload["transaction_count"], 1)
        self.assertEqual(
            payload["suggestions"][0]["suggested_keyword"]["include_terms"],
            ["Coffee Shop"],
        )

    def test_raw_data_endpoint_highlights_columns_of_the_import_mapping(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            import_batch=CSVImport.objects.create(
                bank_account=self.account, csv_mapping=self.mapping
            ),
            transaction_date="2026-01-02",
            description="Coffee Shop",
            amount=Decimal("-10.00"),
            raw_data={
                "Description": "Coffee Shop",
                "Counterparty": "Cafe",
                "Amount": "-10",
            },
        )
        self.account.default_csv_mapping = CSVMapping.objects.create(
            name="Statement XML", file_format=ImportFileFormat.CAMT053
        )
        self.account.save()

        payload = json_body(
            self.client.get(f"/api/transactions/{transaction_obj.id}/raw-data/")
        )
        patched = json_body(
            self.patch_json(
                f"/api/transactions/{transaction_obj.id}/", {"my_note": "checked"}
            )
        )

        self.assertEqual(payload["raw_data"]["Description"], "Coffee Shop")
        self.assertEqual(
            payload["categorization_keys"], ["Description", "Counterparty"]
        )
        self.assertNotIn("raw_data", patched)
        self.assertTrue(patched["has_raw_data"])

    def test_uncategorized_suggestions_group_and_rank_current_filter_scope(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="",
            amount=Decimal("-10.00"),
            raw_data={"Description": "Coffee Shop", "Counterparty": ""},
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-03",
            description="",
            amount=Decimal("-12.00"),
            raw_data={"Description": "coffee   shop", "Counterparty": ""},
        )
        large_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-04",
            description="",
            amount=Decimal("-500.00"),
            raw_data={"Description": "Annual Insurance", "Counterparty": ""},
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-04",
            description="",
            counterparty_name="",
            transaction_type="Odchozí úhrada",
            amount=Decimal("-25.00"),
            raw_data={
                "Description": "",
                "Counterparty": "",
                "Typ transakce": "Odchozí úhrada",
            },
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-05",
            description="Already categorized",
            amount=Decimal("-20.00"),
            subcategory=self.subcategory,
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-06",
            description="Ignored uncategorized",
            amount=Decimal("-200.00"),
            is_ignored=True,
        )
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-07",
            description="Locked uncategorized",
            amount=Decimal("-250.00"),
            is_categorization_locked=True,
        )

        response = self.client.get(
            "/api/transactions/uncategorized-suggestions/?date_from=2026-01-01"
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["transaction_count"], 3)
        self.assertEqual(payload["count"], 2)
        self.assertEqual(
            [suggestion["reason"] for suggestion in payload["suggestions"]],
            ["Large uncategorized transaction", "Repeated categorization text"],
        )
        self.assertEqual(
            payload["suggestions"][0]["transaction_ids"],
            [str(large_transaction.id)],
        )
        repeated = payload["suggestions"][1]
        self.assertEqual(repeated["transaction_count"], 2)
        self.assertEqual(
            repeated["suggested_keyword"]["include_terms"], ["Coffee Shop"]
        )
        self.assertEqual(len(repeated["sample_transactions"]), 2)

    def test_dashboard_checkbox_none_marker_returns_no_transactions(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Visible with default filters",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
        )

        default_response = self.client.get("/api/transactions/")
        none_response = self.client.get(
            "/api/transactions/",
            {"category": "__none__", "limit": "10000"},
        )
        none_summary_response = self.client.get(
            "/api/dashboard/summary/",
            {"category": "__none__"},
        )

        self.assertEqual(default_response.status_code, 200)
        self.assertEqual(json_body(default_response)["count"], 1)
        self.assertEqual(none_response.status_code, 200)
        self.assertEqual(json_body(none_response)["count"], 0)
        self.assertEqual(none_summary_response.status_code, 200)
        self.assertEqual(json_body(none_summary_response)["monthly"], [])

    def test_transaction_patch_respects_split_by_owners_response_amount(self):
        self.account.owners = 2
        self.account.save(update_fields=["owners"])
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Shared lunch",
            amount=Decimal("-90.00"),
            subcategory=self.subcategory,
        )

        response = self.client.patch(
            f"/api/transactions/{transaction_obj.id}/?split_by_owners=true",
            data=json.dumps({"want_need_investment": WantNeedInvestment.NEED}),
            content_type="application/json",
        )
        transaction_obj.refresh_from_db()

        payload = json_body(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["amount"], "-45.00")
        self.assertEqual(payload["want_need_investment"], WantNeedInvestment.NEED)
        self.assertEqual(transaction_obj.amount, Decimal("-90.00"))

    def test_transaction_patch_validates_the_amount(self):
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Lunch",
            amount=Decimal("-90.00"),
        )
        url = f"/api/transactions/{transaction_obj.id}/"

        rejected = {
            value: self.patch_json(url, {"amount": value})
            for value in ["", None, "NaN", "Infinity", "abc", "12.345", "1e15"]
        }
        accepted = self.patch_json(url, {"amount": "15.5"})
        transaction_obj.refresh_from_db()

        for value, response in rejected.items():
            self.assertEqual(response.status_code, 400, value)
        self.assertEqual(json_body(rejected[""])["error"], "Amount must be a number")
        self.assertEqual(
            json_body(rejected["12.345"])["error"],
            "Amount can have at most 2 decimal places",
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(transaction_obj.amount, Decimal("15.50"))
        self.assertEqual(transaction_obj.direction, Direction.INCOME)
