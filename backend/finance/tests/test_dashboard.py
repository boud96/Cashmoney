"""The dashboard summary and saved filters."""

from datetime import date
from decimal import Decimal

from ..constants import WantNeedInvestment
from ..models import (
    ExchangeRate,
    FinanceSettings,
    SavedFilter,
    Subcategory,
    Tag,
    Transaction,
)
from ..services import (
    recalculate_transaction_conversions,
)
from .base import FinanceTestCase, json_body


class DashboardAPITests(FinanceTestCase):
    def test_dashboard_summary_counts_uncategorized_transactions(self):
        for subcategory, ignored in [
            (self.subcategory, False),
            (None, False),
            (None, True),
        ]:
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                description="Payment",
                amount=Decimal("-10.00"),
                subcategory=subcategory,
                is_ignored=ignored,
            )

        default_scope = json_body(self.client.get("/api/dashboard/summary/"))
        with_ignored = json_body(
            self.client.get("/api/dashboard/summary/", {"include_ignored": "true"})
        )

        self.assertEqual(default_scope["uncategorized_count"], 1)
        self.assertEqual(with_ignored["uncategorized_count"], 1)

    def test_saved_filter_api_persists_updates_and_deletes_presets(self):
        created = self.post_json(
            "/api/saved-filters/",
            {
                "name": "Cash withdrawals",
                "filters": {
                    "category": [str(self.category.id)],
                    "direction": ["expense"],
                    "q": "ATM",
                },
            },
        )
        updated = self.post_json(
            "/api/saved-filters/",
            {
                "name": "cash withdrawals",
                "filters": {
                    "category": [str(self.category.id)],
                    "direction": ["income", "expense"],
                    "q": "KB ATM",
                },
            },
        )
        listed = self.client.get("/api/saved-filters/")
        preset_id = json_body(updated)["id"]

        self.assertEqual(created.status_code, 201)
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(SavedFilter.objects.count(), 1)
        self.assertEqual(json_body(updated)["filters"]["q"], "KB ATM")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(json_body(listed)), 1)

        deleted = self.delete_json(f"/api/saved-filters/{preset_id}/")

        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(SavedFilter.objects.exists())

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
        self.assertEqual(payload["expense_categories"][0]["amount"], "12.50")
        self.assertEqual(payload["expense_categories"][0]["color"], self.category.color)
        self.assertEqual(
            payload["expense_categories"][0]["children"][0]["color"],
            self.subcategory.color,
        )
        self.assertEqual(payload["want_need_investment"][0]["name"], "want")

    def test_dashboard_summary_tag_filter_does_not_double_count(self):
        second_tag = Tag.objects.create(name="Dinner")
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Tagged twice",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.NEED,
        )
        transaction_obj.tags.add(self.tag, second_tag)

        for tag_filter in [f"{self.tag.id},{second_tag.id}", "__any__"]:
            response = self.client.get("/api/dashboard/summary/", {"tag": tag_filter})
            payload = json_body(response)
            transactions = json_body(
                self.client.get("/api/transactions/", {"tag": tag_filter})
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(payload["monthly"][0]["expense"], "12.50")
            self.assertEqual(payload["expense_categories"][0]["amount"], "12.50")
            self.assertEqual(payload["want_need_investment"][0]["amount"], "12.50")
            self.assertEqual(transactions["count"], 1)

    def test_dashboard_split_by_owners_adjusts_summary_and_transaction_amounts(self):
        self.account.owners = 2
        self.account.save(update_fields=["owners"])
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Shared lunch",
            amount=Decimal("-90.00"),
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.NEED,
        )

        summary_response = self.client.get(
            "/api/dashboard/summary/", {"split_by_owners": "true"}
        )
        transactions_response = self.client.get(
            "/api/transactions/", {"split_by_owners": "true", "limit": "1"}
        )
        transaction_obj.refresh_from_db()

        summary = json_body(summary_response)
        transactions = json_body(transactions_response)
        self.assertEqual(summary_response.status_code, 200)
        self.assertEqual(transactions_response.status_code, 200)
        self.assertEqual(summary["monthly"][0]["expense"], "45.00")
        self.assertEqual(summary["expense_categories"][0]["amount"], "45.00")
        self.assertEqual(summary["want_need_investment"][0]["amount"], "45.00")
        self.assertEqual(transactions["results"][0]["amount"], "-45.00")
        self.assertEqual(transaction_obj.amount, Decimal("-90.00"))

    def test_dashboard_split_by_owners_keeps_the_cents_of_whole_amounts(self):
        self.account.owners = 2
        self.account.save(update_fields=["owners"])
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Whole amount",
            amount=Decimal("-5.00"),
            subcategory=self.subcategory,
        )

        summary = json_body(
            self.client.get("/api/dashboard/summary/", {"split_by_owners": "true"})
        )

        # SQLite stores -5.00 as the integer -5, and integer division gave 2.
        self.assertEqual(summary["monthly"][0]["expense"], "2.50")
        self.assertEqual(summary["expense_categories"][0]["amount"], "2.50")
        self.assertEqual(summary["want_need_investment"][0]["amount"], "2.50")

    def test_money_is_sent_as_two_place_decimal_strings(self):
        self.account.owners = 3
        self.account.save(update_fields=["owners"])
        coffee = Subcategory.objects.create(name="Coffee", category=self.category)
        for subcategory in (self.subcategory, coffee):
            Transaction.objects.create(
                bank_account=self.account,
                transaction_date="2026-01-02",
                description=f"Split {subcategory.name}",
                amount=Decimal("-10.00"),
                subcategory=subcategory,
            )

        summary = json_body(
            self.client.get("/api/dashboard/summary/", {"split_by_owners": "true"})
        )
        rows = json_body(
            self.client.get("/api/transactions/", {"split_by_owners": "true"})
        )["results"]

        self.assertEqual([row["amount"] for row in rows], ["-3.33", "-3.33"])
        food = summary["expense_categories"][0]
        self.assertEqual(
            [child["amount"] for child in food["children"]], ["3.33", "3.33"]
        )
        # 20 / 3 rounds to 6.67, but the sunburst needs the sum of the children.
        self.assertEqual(food["amount"], "6.66")
        self.assertEqual(summary["monthly"][0]["expense"], "6.67")
        self.assertEqual(summary["monthly"][0]["income"], "0.00")

    def test_dashboard_summary_uses_converted_default_currency_amounts(self):
        settings_obj = FinanceSettings.load()
        settings_obj.default_currency = "CZK"
        settings_obj.save()
        ExchangeRate.objects.create(
            date="2024-01-01",
            base_currency="EUR",
            quote_currency="USD",
            rate=Decimal("1.2500000000"),
        )
        ExchangeRate.objects.create(
            date="2024-01-01",
            base_currency="EUR",
            quote_currency="CZK",
            rate=Decimal("25.0000000000"),
        )
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2024-01-02",
            description="Foreign lunch",
            amount=Decimal("-10.00"),
            currency="USD",
            subcategory=self.subcategory,
            want_need_investment=WantNeedInvestment.WANT,
        )

        result = recalculate_transaction_conversions(default_currency="CZK")
        summary_response = self.client.get("/api/dashboard/summary/")
        transactions_response = self.client.get("/api/transactions/", {"limit": "1"})
        transaction_obj.refresh_from_db()

        summary = json_body(summary_response)
        transactions = json_body(transactions_response)
        self.assertEqual(result["missing_rates"], 0)
        self.assertEqual(transaction_obj.converted_amount, Decimal("-200.00"))
        self.assertEqual(transaction_obj.conversion_rate, Decimal("20.0000000000"))
        self.assertEqual(transaction_obj.conversion_rate_date, date(2024, 1, 1))
        self.assertEqual(summary["default_currency"], "CZK")
        self.assertEqual(summary["monthly"][0]["expense"], "200.00")
        self.assertEqual(summary["expense_categories"][0]["amount"], "200.00")
        self.assertEqual(summary["missing_conversions"], 0)
        self.assertEqual(transactions["results"][0]["amount"], "-10.00")
        self.assertEqual(transactions["results"][0]["currency"], "USD")
        self.assertEqual(transactions["results"][0]["converted_amount"], "-200.00")
        self.assertEqual(transactions["results"][0]["conversion_rate"], "20")
        self.assertEqual(transactions["results"][0]["converted_currency"], "CZK")

    def test_dashboard_summary_reports_missing_exchange_rates(self):
        settings_obj = FinanceSettings.load()
        settings_obj.default_currency = "CZK"
        settings_obj.save()
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2024-01-02",
            description="Foreign lunch",
            amount=Decimal("-10.00"),
            currency="USD",
            subcategory=self.subcategory,
        )

        recalculate_transaction_conversions(default_currency="CZK")
        response = self.client.get("/api/dashboard/summary/")
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["monthly"], [])
        self.assertEqual(payload["missing_conversions"], 1)
