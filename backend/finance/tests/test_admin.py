"""The Django admin: list query counts, transfer matches, and model validation."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import connection
from django.test.utils import CaptureQueriesContext

from ..models import (
    BankAccount,
    ExchangeRate,
    FinanceSettings,
    InternalTransferMatch,
    Transaction,
)
from .base import FinanceTestCase, json_body


class AdminTests(FinanceTestCase):
    def setUp(self):
        super().setUp()
        self.client.force_login(
            get_user_model().objects.create_superuser(username="admin-tests")
        )

    def add_transactions(self, count):
        return [
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                description=f"Row {index}",
                amount=Decimal("-1.00"),
                subcategory=self.subcategory,
            )
            for index in range(count)
        ]

    def list_queries(self, url):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        return len(queries)

    def test_list_queries_dont_grow_with_rows(self):
        # CR-51: the transaction list ran about three queries per row.
        self.add_transactions(2)
        few = self.list_queries("/admin/finance/transaction/")
        self.add_transactions(10)
        many = self.list_queries("/admin/finance/transaction/")

        rows = self.add_transactions(8)
        for outgoing, incoming in zip(rows[0::2], rows[1::2]):
            InternalTransferMatch.objects.create(
                outgoing_transaction=outgoing, incoming_transaction=incoming
            )
        matches = self.list_queries("/admin/finance/internaltransfermatch/")
        first_three = InternalTransferMatch.objects.values_list("id", flat=True)[:3]
        InternalTransferMatch.objects.filter(id__in=list(first_three)).delete()
        fewer_matches = self.list_queries("/admin/finance/internaltransfermatch/")

        self.assertEqual(few, many)
        self.assertEqual(matches, fewer_matches)

    def assert_unmatched(self, outgoing, incoming):
        outgoing.refresh_from_db()
        incoming.refresh_from_db()
        self.assertFalse(InternalTransferMatch.objects.exists())
        for leg in (outgoing, incoming):
            self.assertFalse(leg.is_ignored)
            self.assertFalse(leg.is_categorization_locked)
            self.assertIsNone(leg.subcategory_id)

    def test_deleting_a_match_in_the_admin_unmatches_it(self):
        # CR-51: a plain delete left both transactions ignored and locked.
        outgoing, incoming, match = self.apply_transfer_pair()
        outgoing.refresh_from_db()
        self.assertTrue(outgoing.is_ignored)

        response = self.client.post(
            f"/admin/finance/internaltransfermatch/{match.id}/delete/", {"post": "yes"}
        )

        self.assertEqual(response.status_code, 302)
        self.assert_unmatched(outgoing, incoming)

    def test_deleting_selected_matches_in_the_admin_unmatches_them(self):
        outgoing, incoming, match = self.apply_transfer_pair()

        response = self.client.post(
            "/admin/finance/internaltransfermatch/",
            {
                "action": "delete_selected",
                "_selected_action": [str(match.id)],
                "post": "yes",
            },
        )

        self.assertEqual(response.status_code, 302)
        self.assert_unmatched(outgoing, incoming)

    def test_models_refuse_bad_currency_codes_instead_of_cutting_them(self):
        # CR-52: "EURO" was saved as "EUR". The admin and scripts reach the models
        # directly, so they check too; lower case is still accepted.
        with self.assertRaises(ValidationError):
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                amount=Decimal("-1.00"),
                currency="EURO",
            )
        with self.assertRaises(ValidationError):
            ExchangeRate.objects.create(
                date="2026-01-02",
                base_currency="EUR",
                quote_currency="CZ1",
                rate=Decimal("25"),
            )
        settings_obj = FinanceSettings.load()
        settings_obj.default_currency = "EU"
        with self.assertRaises(ValidationError):
            settings_obj.save()
        lower_case = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            amount=Decimal("-1.00"),
            currency="eur",
        )
        alias = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            amount=Decimal("-1.00"),
            currency="Kč",
        )

        self.assertEqual(lower_case.currency, "EUR")
        self.assertEqual(alias.currency, "CZK")
        self.assertEqual(Transaction.objects.count(), 2)
        self.assertFalse(ExchangeRate.objects.exists())
        self.assertEqual(FinanceSettings.load().default_currency, "CZK")

    def test_the_admin_form_reports_a_bad_currency_and_no_owners(self):
        response = self.client.post(
            f"/admin/finance/bankaccount/{self.account.id}/change/",
            {
                "name": self.account.name,
                "account_number": self.account.account_number,
                "bank_name": "",
                "currency": "EU",
                "owners": "0",
                "default_csv_mapping": "",
            },
        )
        self.account.refresh_from_db()

        self.assertEqual(response.status_code, 200)  # the form again, with errors
        errors = response.context["adminform"].form.errors
        self.assertIn("three-letter code", errors["currency"][0])
        self.assertIn("at least one owner", errors["owners"][0])
        self.assertEqual(self.account.owners, 1)
        self.assertEqual(self.account.currency, "CZK")

    def test_an_account_with_no_owners_still_counts_in_split_totals(self):
        # Saved with owners = 0 through the admin before CR-52: the SQL owner split
        # divided by zero, and the account's rows counted as missing exchange rates.
        BankAccount.objects.filter(id=self.account.id).update(owners=0)
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            amount=Decimal("-40.00"),
            subcategory=self.subcategory,
        )

        summary = json_body(
            self.client.get("/api/dashboard/summary/", {"split_by_owners": "true"})
        )

        self.assertEqual(summary["missing_conversions"], 0)
        self.assertEqual(summary["monthly"][0]["expense"], "40.00")

    def test_rows_saved_with_old_currency_spellings_can_still_be_edited(self):
        # Before v0.5.1, "Kč" was stored as "KČ". Saving such a row now repairs it
        # instead of failing; anything else odd is a 400 that says why, not a 500.
        legacy, odd = (
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                amount=Decimal("-1.00"),
            )
            for _ in range(2)
        )
        Transaction.objects.filter(id=legacy.id).update(currency="KČ")
        Transaction.objects.filter(id=odd.id).update(currency="US$")

        repaired = self.patch_json(f"/api/transactions/{legacy.id}/", {"my_note": "x"})
        refused = self.patch_json(f"/api/transactions/{odd.id}/", {"my_note": "x"})
        legacy.refresh_from_db()

        self.assertEqual(repaired.status_code, 200)
        self.assertEqual(legacy.currency, "CZK")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(
            json_body(refused)["error"],
            "Currency must be a three-letter code like CZK or EUR.",
        )
