"""Exchange rates: the provider, caching, conversions."""

import json
from datetime import date
from decimal import Decimal
from unittest.mock import patch
from urllib.error import URLError

from ..models import (
    ExchangeRate,
    FinanceSettings,
    Transaction,
)
from .. import services as finance_services
from ..services import (
    CURRENCY_LIST_CACHE_SECONDS,
    ExchangeRateProviderError,
    FrankfurterExchangeRateProvider,
    available_currency_options,
    build_rate_lookup,
    recalculate_transaction_conversions,
    sync_missing_exchange_rates,
)
from .base import FinanceTestCase, json_body


class ExchangeRateTests(FinanceTestCase):
    def test_exchange_rate_currencies_api_returns_provider_options(self):
        with patch("finance.views.available_currency_options") as options:
            options.return_value = {
                "source": "frankfurter",
                "fallback": False,
                "currencies": [
                    {"code": "CZK", "name": "Czech Koruna"},
                    {"code": "EUR", "name": "Euro"},
                ],
            }
            response = self.client.get("/api/exchange-rates/currencies/")

        payload = json_body(response)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["fallback"])
        self.assertEqual(payload["currencies"][0]["code"], "CZK")

    def test_exchange_rate_currencies_api_falls_back_when_provider_fails(self):
        with (
            patch("finance.views.available_currency_options") as options,
            patch("finance.views.fallback_currency_options") as fallback,
        ):
            options.side_effect = ExchangeRateProviderError("provider unavailable")
            fallback.return_value = {
                "source": "frankfurter",
                "fallback": True,
                "error": "provider unavailable",
                "currencies": [{"code": "CZK", "name": "Czech Koruna"}],
            }
            response = self.client.get("/api/exchange-rates/currencies/")

        payload = json_body(response)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["fallback"])
        self.assertEqual(payload["currencies"][0]["code"], "CZK")

    def test_a_network_failure_is_remembered_until_an_explicit_sync(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Hotel",
            amount=Decimal("-80.00"),
            currency="USD",
        )
        calls = []

        def offline_urlopen(request, timeout):
            calls.append(request.full_url)
            raise URLError("network is unreachable")

        provider = FrankfurterExchangeRateProvider()
        with patch("finance.services.urlopen", offline_urlopen):
            with self.assertRaises(ExchangeRateProviderError):
                provider.fetch_currencies()
            with self.assertRaisesMessage(ExchangeRateProviderError, "a few minutes"):
                provider.fetch_rates("EUR", ["USD"], date(2026, 1, 2), date(2026, 1, 2))
            calls_while_remembered = len(calls)
            retry = self.client.post("/api/exchange-rates/sync/")

        self.assertEqual(calls_while_remembered, 1)
        self.assertEqual(len(calls), 2)
        self.assertEqual(retry.status_code, 502)
        self.assertIn("network is unreachable", json_body(retry)["error"])

    def test_the_currency_list_is_fetched_once_a_day(self):
        calls = []

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return json.dumps(
                    [{"iso_code": "CZK", "name": "Czech Koruna"}]
                ).encode()

        def fake_urlopen(request, timeout):
            calls.append(request.full_url)
            return FakeResponse()

        with patch("finance.services.urlopen", fake_urlopen):
            first = available_currency_options()
            second = available_currency_options()
            finance_services._currency_list_cache["fetched_at"] -= (
                CURRENCY_LIST_CACHE_SECONDS + 1
            )
            available_currency_options()

        self.assertEqual(first, second)
        self.assertEqual(first["currencies"][0]["code"], "CZK")
        self.assertEqual(len(calls), 2)

    def test_a_row_recalculation_loads_only_the_rates_it_can_use(self):
        # Every row edit recalculates its row (CR-37). Rates older than the last one on or
        # before the row's date can't apply, and a row in the default currency needs none.
        for day, czk, usd in [
            ("2024-01-01", "25.0", "1.20"),
            ("2024-01-05", "25.5", "1.25"),
            ("2024-01-10", "26.0", "1.30"),
            ("2024-01-20", "27.0", "1.40"),
        ]:
            for quote, rate in (("CZK", czk), ("USD", usd)):
                ExchangeRate.objects.create(
                    date=day,
                    base_currency="EUR",
                    quote_currency=quote,
                    rate=Decimal(rate),
                )
        foreign = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2024-01-12",
            description="Foreign lunch",
            amount=Decimal("-13.00"),
            currency="USD",
        )
        native = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2024-01-12",
            description="Lunch",
            amount=Decimal("-100.00"),
            currency="CZK",
        )

        lookup = build_rate_lookup(
            ["CZK", "USD"], date(2024, 1, 12), start_date=date(2024, 1, 7)
        )
        with patch(
            "finance.services.build_rate_lookup", wraps=build_rate_lookup
        ) as build:
            for row in (native, foreign):
                recalculate_transaction_conversions(
                    Transaction.objects.filter(id=row.id), default_currency="CZK"
                )
        native.refresh_from_db()
        foreign.refresh_from_db()

        self.assertEqual(lookup["USD"]["dates"], [date(2024, 1, 5), date(2024, 1, 10)])
        self.assertEqual(build.call_count, 1)  # for the USD row only
        self.assertEqual(native.conversion_status, Transaction.CONVERSION_STATUS_NATIVE)
        self.assertEqual(native.converted_amount, Decimal("-100.00"))
        # 26.0 / 1.30 = 20 CZK per USD, from the 10 January rates.
        self.assertEqual(foreign.conversion_rate, Decimal("20.0000000000"))
        self.assertEqual(foreign.converted_amount, Decimal("-260.00"))
        self.assertEqual(foreign.conversion_rate_date, date(2024, 1, 10))

    def test_exchange_rate_sync_caches_flat_provider_rows_and_recalculates(self):
        settings_obj = FinanceSettings.load()
        settings_obj.default_currency = "CZK"
        settings_obj.save()
        transaction_obj = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2024-01-02",
            description="Euro lunch",
            amount=Decimal("-10.00"),
            currency="EUR",
            subcategory=self.subcategory,
        )

        class FakeProvider:
            def fetch_rates(
                self, base_currency, quote_currencies, start_date, end_date
            ):
                self.call = (base_currency, quote_currencies, start_date, end_date)
                return [
                    {
                        "date": date(2024, 1, 2),
                        "base_currency": "EUR",
                        "quote_currency": "CZK",
                        "rate": Decimal("25.0000000000"),
                        "source": "frankfurter",
                    }
                ]

        provider = FakeProvider()
        result = sync_missing_exchange_rates(
            provider=provider,
            default_currency="CZK",
        )
        transaction_obj.refresh_from_db()

        self.assertEqual(provider.call[0], "EUR")
        self.assertIn("CZK", provider.call[1])
        self.assertEqual(result["created_rates"], 1)
        self.assertEqual(ExchangeRate.objects.count(), 1)
        self.assertEqual(transaction_obj.converted_amount, Decimal("-250.00"))
        self.assertEqual(
            transaction_obj.conversion_status,
            Transaction.CONVERSION_STATUS_CONVERTED,
        )
