"""Keyword categorization and account references."""

from django.test import (
    override_settings,
)

from ..constants import WantNeedInvestment
from ..models import (
    BankAccount,
    Category,
    FinanceSettings,
    Keyword,
    Subcategory,
    Transaction,
)
from ..services import (
    CategorizationService,
    transaction_mentions_account,
)
from .base import FinanceTestCase


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

    def test_keyword_matching_ignores_accents(self):
        self.keyword("Ceska lekarna", ["ceska lekarna"])
        self.keyword("Nájem", ["Nájem"])
        self.keyword("Kavárna", ["kavarna"], exclude_terms=["záloha"])

        categorizer = CategorizationService()

        def matched(text):
            return [
                keyword.name for keyword in categorizer.apply(text).matched_keywords
            ]

        self.assertEqual(
            matched("ČESKÁ LÉKÁRNA HOLDING, a.s. DR. MAX"), ["Ceska lekarna"]
        )
        self.assertEqual(matched("NAJEM BYT 2/2026"), ["Nájem"])
        self.assertEqual(matched("Kavárna Praha"), ["Kavárna"])
        self.assertEqual(matched("KAVARNA ZALOHA"), [])

    def test_internal_account_reference_ignore_setting(self):
        BankAccount.objects.create(name="Savings", account_number="456-789/0100")

        categorizer = CategorizationService()
        other_account = categorizer.apply(
            "Transfer to 4567890100",
            {"bank_account": self.account},
        )
        other_account_without_bank_code = categorizer.apply(
            "Transfer",
            {
                "bank_account": self.account,
                "counterparty_account_number": "456789",
            },
        )
        text_without_bank_code = categorizer.apply(
            "Transfer to 456789",
            {"bank_account": self.account},
        )
        current_account = categorizer.apply(
            "Statement mentions 123/0100",
            {"bank_account": self.account},
        )

        self.assertTrue(other_account.is_ignored)
        self.assertTrue(other_account_without_bank_code.is_ignored)
        self.assertTrue(text_without_bank_code.is_ignored)
        self.assertFalse(current_account.is_ignored)

        settings_obj = FinanceSettings.load()
        settings_obj.ignore_internal_account_references = False
        settings_obj.save()
        disabled = CategorizationService().apply(
            "Transfer to 4567890100",
            {"bank_account": self.account},
        )

        self.assertFalse(disabled.is_ignored)
        self.assertIsNone(disabled.subcategory)

        settings_obj.internal_transfer_subcategory = self.subcategory
        settings_obj.save()
        categorized = CategorizationService().apply(
            "Transfer to 4567890100",
            {"bank_account": self.account},
        )

        self.assertFalse(categorized.is_ignored)
        self.assertEqual(categorized.subcategory, self.subcategory)


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class AccountReferenceTests(FinanceTestCase):
    def setUp(self):
        super().setUp()
        self.savings = BankAccount.objects.create(
            name="Savings", account_number="1234567890/0800"
        )

    def test_auto_ignore_needs_a_whole_account_number(self):
        categorizer = CategorizationService()

        def ignored(text, **data):
            return categorizer.apply(
                text, {"bank_account": self.account, **data}
            ).is_ignored

        # Digits glued from neighbouring fields or buried in longer numbers don't count.
        self.assertFalse(ignored("VS 12345 | 67890"))
        self.assertFalse(ignored("Ref 991234567890"))
        self.assertFalse(ignored("Card 1234567890123456"))
        # Written-out forms of the account do.
        self.assertTrue(ignored("To 1234567890/0800"))
        self.assertTrue(ignored("To 000000-1234567890/0800"))
        self.assertTrue(ignored("To CZ65 0800 0000 0012 3456 7890"))
        self.assertTrue(
            ignored("Transfer", counterparty_account_number="0000001234567890/0800")
        )

    def test_transfer_scoring_needs_a_whole_account_number(self):
        def mentions(description):
            transaction_obj = Transaction(description=description)
            return transaction_mentions_account(transaction_obj, self.savings)

        self.assertFalse(mentions("Ref 991234567890"))
        self.assertTrue(mentions("Transfer to 1234567890/0800"))
