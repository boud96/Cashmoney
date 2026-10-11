"""The Django admin: list query counts, transfer matches, and model validation."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext

from ..models import InternalTransferMatch, Transaction
from .base import FinanceTestCase


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
