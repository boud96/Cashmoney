"""Shared test setup: FinanceTestCase (sample definitions, request helpers) and json_body."""

import json
import os
import tempfile
import time
from decimal import Decimal
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import (
    TestCase,
)

from ..constants import WantNeedInvestment
from ..models import (
    BankAccount,
    CSVMapping,
    Category,
    InternalTransferMatch,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
)
from ..services import (
    FrankfurterExchangeRateProvider,
    clear_currency_list_cache,
)


def json_body(response):
    return json.loads(response.content.decode("utf-8"))


class FinanceTestCase(TestCase):
    def setUp(self):
        # Maintenance deletes write safety backups under DATA_DIR; keep them out of
        # the developer's real backups folder.
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        self.data_dir = Path(temp_dir.name)
        data_dir_override = self.settings(DATA_DIR=self.data_dir)
        data_dir_override.enable()
        self.addCleanup(data_dir_override.disable)
        # The rate provider remembers failures and caches currencies per process.
        FrankfurterExchangeRateProvider.forget_failure()
        clear_currency_list_cache()
        self.addCleanup(FrankfurterExchangeRateProvider.forget_failure)
        self.addCleanup(clear_currency_list_cache)

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

    def backup_dir(self):
        return self.data_dir / "backups"

    def saved_backup(self, name, age_days):
        """A placeholder file in the backups folder, last modified age_days ago."""
        self.backup_dir().mkdir(parents=True, exist_ok=True)
        path = self.backup_dir() / name
        path.write_bytes(b"backup")
        modified = time.time() - age_days * 24 * 60 * 60
        os.utime(path, (modified, modified))
        return path

    def csv_file(self, body):
        return SimpleUploadedFile(
            "statement.csv",
            body.encode("utf-8"),
            content_type="text/csv",
        )

    def encoded_csv_file(self, body, encoding):
        return SimpleUploadedFile(
            "statement.csv",
            body.encode(encoding),
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

    def delete_json(self, path, data=None):
        return self.client.delete(
            path,
            data=json.dumps(data or {}),
            content_type="application/json",
        )

    def make_transactions(self, account, *amounts, **fields):
        return [
            Transaction.objects.create(
                bank_account=account,
                transaction_date="2026-01-02",
                description="Payment",
                amount=Decimal(amount),
                **fields,
            )
            for amount in amounts
        ]

    def apply_transfer_pair(self, subcategory=None, **outgoing_fields):
        transfer_subcategory = Subcategory.objects.create(
            name="Internal Transfer", category=self.category
        )
        savings = BankAccount.objects.create(
            name="Savings", account_number="456/0100", default_csv_mapping=self.mapping
        )
        outgoing = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Transfer to savings",
            amount=Decimal("-100.00"),
            counterparty_account_number="456/0100",
            subcategory=subcategory,
            **outgoing_fields,
        )
        incoming = Transaction.objects.create(
            bank_account=savings,
            transaction_date="2026-01-02",
            description="Transfer from main",
            amount=Decimal("100.00"),
            counterparty_account_number="123/0100",
        )
        candidate = json_body(
            self.client.get("/api/transactions/internal-transfers/preview/")
        )["candidates"][0]
        applied = self.post_json(
            "/api/transactions/internal-transfers/apply/",
            {
                "candidate_ids": [candidate["id"]],
                "subcategory_id": str(transfer_subcategory.id),
            },
        )
        self.assertEqual(json_body(applied)["created"], 1)
        return outgoing, incoming, InternalTransferMatch.objects.get()
