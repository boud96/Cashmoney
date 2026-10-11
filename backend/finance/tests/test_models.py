"""Models."""

import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from ..constants import Direction
from ..models import (
    BankAccount,
    Category,
    Subcategory,
    Tag,
    Transaction,
    TransactionTag,
)
from ..services import (
    FrankfurterExchangeRateProvider,
)
from .base import FinanceTestCase


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

    def test_bank_account_number_is_optional_but_unique_when_provided(self):
        first_blank = BankAccount.objects.create(name="Cash Wallet")
        second_blank = BankAccount.objects.create(name="Savings Jar")

        self.assertEqual(first_blank.account_number, "")
        self.assertEqual(second_blank.account_number, "")

        with self.assertRaises(IntegrityError), transaction.atomic():
            BankAccount.objects.create(name="Duplicate", account_number="123/0100")

    def test_frankfurter_provider_sends_json_headers_and_parses_flat_rows(self):
        captured_requests = []

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return json.dumps(
                    [
                        {
                            "date": "2024-01-02",
                            "base": "EUR",
                            "quote": "CZK",
                            "rate": 24.726,
                        }
                    ]
                ).encode("utf-8")

        def fake_urlopen(request, timeout):
            captured_requests.append((request, timeout))
            return FakeResponse()

        provider = FrankfurterExchangeRateProvider()
        with patch("finance.services.urlopen", fake_urlopen):
            rows = provider.fetch_rates(
                "EUR", ["CZK"], date(2024, 1, 2), date(2024, 1, 2)
            )

        request, timeout = captured_requests[0]
        self.assertEqual(timeout, 5)
        self.assertEqual(request.get_header("Accept"), "application/json")
        self.assertEqual(request.get_header("User-agent"), provider.user_agent)
        self.assertEqual(rows[0]["date"], date(2024, 1, 2))
        self.assertEqual(rows[0]["base_currency"], "EUR")
        self.assertEqual(rows[0]["quote_currency"], "CZK")
        self.assertEqual(rows[0]["rate"], Decimal("24.726"))

    def test_frankfurter_provider_parses_currency_rows(self):
        captured_requests = []

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return json.dumps(
                    [
                        {"iso_code": "CZK", "name": "Czech Koruna"},
                        {"iso_code": "EUR", "name": "Euro"},
                    ]
                ).encode("utf-8")

        def fake_urlopen(request, timeout):
            captured_requests.append((request, timeout))
            return FakeResponse()

        provider = FrankfurterExchangeRateProvider()
        with patch("finance.services.urlopen", fake_urlopen):
            currencies = provider.fetch_currencies()

        request, _timeout = captured_requests[0]
        self.assertIn("/v2/currencies", request.full_url)
        self.assertEqual(
            currencies,
            [
                {"code": "CZK", "name": "Czech Koruna"},
                {"code": "EUR", "name": "Euro"},
            ],
        )

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
