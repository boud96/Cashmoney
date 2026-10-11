"""Maintenance: summary, admin users, deletes, backups, restore."""

import json
import sqlite3
import tempfile
from decimal import Decimal
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import (
    Client,
    TransactionTestCase,
    override_settings,
)

from ..models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    Keyword,
    Subcategory,
    Tag,
    Transaction,
)
from ..sample_data import (
    SAMPLE_IMPORT_SOURCE,
)
from ..views import create_safety_backup
from .base import FinanceTestCase, json_body


@override_settings(ALLOWED_HOSTS=["testserver", "127.0.0.1", "localhost"])
class MaintenanceRestoreTests(TransactionTestCase):
    def setUp(self):
        # Restores write pre-restore backups under DATA_DIR; keep them out of the
        # developer's real backups folder.
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        data_dir_override = self.settings(DATA_DIR=Path(temp_dir.name))
        data_dir_override.enable()
        self.addCleanup(data_dir_override.disable)

        self.client = Client()
        self.mapping = CSVMapping.objects.create(
            name="Restore Mapping",
            date_format="%Y-%m-%d",
            column_map={
                "transaction_date": "Date",
                "description": "Description",
                "amount": "Amount",
            },
        )
        self.account = BankAccount.objects.create(
            name="Restore Account",
            account_number="restore/0100",
            default_csv_mapping=self.mapping,
        )

    def test_database_restore_replaces_current_database_and_saves_pre_restore_backup(
        self,
    ):
        restored_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Restored transaction",
            amount=Decimal("-12.50"),
        )
        connection.ensure_connection()
        backup_bytes = connection.connection.serialize()

        Transaction.objects.filter(id=restored_transaction.id).delete()
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-02-02",
            description="Current transaction",
            amount=Decimal("-8.00"),
        )

        response = self.client.post(
            "/api/maintenance/database-restore/",
            {
                "confirmation": "RESTORE DATABASE",
                "backup_file": SimpleUploadedFile(
                    "cashmoney-backup.sqlite3",
                    backup_bytes,
                    content_type="application/x-sqlite3",
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["restored"])
        self.assertTrue(payload["pre_restore_backup"].endswith(".sqlite3"))
        self.assertTrue(
            Transaction.objects.filter(description="Restored transaction").exists()
        )
        self.assertFalse(
            Transaction.objects.filter(description="Current transaction").exists()
        )

    def test_database_restore_refuses_a_backup_from_a_newer_version(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Still here",
            amount=Decimal("-12.50"),
        )
        connection.ensure_connection()
        with tempfile.TemporaryDirectory() as temp_dir:
            newer_path = Path(temp_dir) / "newer.sqlite3"
            newer_path.write_bytes(connection.connection.serialize())
            newer = sqlite3.connect(str(newer_path))
            newer.execute(
                "INSERT INTO django_migrations (app, name, applied) "
                "VALUES ('finance', '0099_from_a_newer_version', '2027-01-01')"
            )
            newer.commit()
            newer.close()
            backup_bytes = newer_path.read_bytes()

        response = self.client.post(
            "/api/maintenance/database-restore/",
            {
                "confirmation": "RESTORE DATABASE",
                "backup_file": SimpleUploadedFile(
                    "newer.sqlite3", backup_bytes, content_type="application/x-sqlite3"
                ),
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 400)
        self.assertIn("newer version of Cashmoney", payload["error"])
        self.assertEqual(
            payload["details"]["unknown_migrations"],
            ["finance.0099_from_a_newer_version"],
        )
        self.assertTrue(Transaction.objects.filter(description="Still here").exists())
        self.assertFalse((Path(settings.DATA_DIR) / "backups").exists())

    def test_database_restore_migrates_backup_without_internal_transfer_table(self):
        restored_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Legacy restored transaction",
            amount=Decimal("-12.50"),
        )
        connection.ensure_connection()
        backup_bytes = connection.connection.serialize()

        legacy_backup_path = None
        legacy_connection = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as backup:
                legacy_backup_path = Path(backup.name)
                backup.write(backup_bytes)
            legacy_connection = sqlite3.connect(str(legacy_backup_path))
            legacy_connection.execute(
                "DROP TABLE IF EXISTS finance_internaltransfermatch"
            )
            # A real pre-0010 backup has no record of 0010 or any later migration.
            legacy_connection.execute(
                "DELETE FROM django_migrations WHERE app = ? AND name >= ?",
                ("finance", "0010_internal_transfer_match"),
            )
            legacy_connection.commit()
            legacy_backup_bytes = legacy_backup_path.read_bytes()
        finally:
            if legacy_connection is not None:
                legacy_connection.close()
            if legacy_backup_path and legacy_backup_path.exists():
                legacy_backup_path.unlink()

        Transaction.objects.filter(id=restored_transaction.id).delete()
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-02-02",
            description="Current legacy restore transaction",
            amount=Decimal("-8.00"),
        )

        response = self.client.post(
            "/api/maintenance/database-restore/",
            {
                "confirmation": "RESTORE DATABASE",
                "backup_file": SimpleUploadedFile(
                    "legacy-cashmoney-backup.sqlite3",
                    legacy_backup_bytes,
                    content_type="application/x-sqlite3",
                ),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            Transaction.objects.filter(
                description="Legacy restored transaction"
            ).exists()
        )
        self.assertIn(
            "finance_internaltransfermatch",
            connection.introspection.table_names(),
        )

    def test_saved_backup_restore_replaces_current_database_and_keeps_backup_visible(
        self,
    ):
        restored_transaction = Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Restored saved backup transaction",
            amount=Decimal("-12.50"),
        )
        connection.ensure_connection()
        backup_bytes = connection.connection.serialize()

        Transaction.objects.filter(id=restored_transaction.id).delete()
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-02-02",
            description="Current saved backup transaction",
            amount=Decimal("-8.00"),
        )

        with (
            tempfile.TemporaryDirectory() as temp_dir,
            self.settings(DATA_DIR=Path(temp_dir)),
        ):
            backup_dir = Path(temp_dir) / "backups"
            backup_dir.mkdir()
            backup_path = backup_dir / "saved-restore.sqlite3"
            backup_path.write_bytes(backup_bytes)

            response = self.client.post(
                "/api/maintenance/backups/saved-restore.sqlite3/restore/",
                data=json.dumps({"confirmation": "RESTORE DATABASE"}),
                content_type="application/json",
            )
            payload = json_body(response)

            self.assertEqual(response.status_code, 200)
            self.assertTrue(payload["restored"])
            self.assertTrue(payload["pre_restore_backup"].endswith(".sqlite3"))
            self.assertTrue(backup_path.exists())
            self.assertGreaterEqual(len(payload["backups"]), 2)
            self.assertTrue(
                Transaction.objects.filter(
                    description="Restored saved backup transaction"
                ).exists()
            )
            self.assertFalse(
                Transaction.objects.filter(
                    description="Current saved backup transaction"
                ).exists()
            )


class MaintenanceAPITests(FinanceTestCase):
    def test_maintenance_summary_returns_counts(self):
        csv_import = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="api-maintenance.csv",
        )
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Maintenance test",
            amount=Decimal("-12.50"),
        )

        response = self.client.get("/api/maintenance/summary/")
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["transactions"], 1)
        self.assertEqual(payload["internal_transfer_matches"], 0)
        self.assertEqual(payload["imports"], 1)
        self.assertEqual(payload["bank_accounts"], 1)
        self.assertEqual(payload["csv_mappings"], 1)
        self.assertEqual(payload["categories"], 1)
        self.assertEqual(payload["subcategories"], 1)
        self.assertEqual(payload["tags"], 1)
        self.assertEqual(payload["keywords"], 0)
        self.assertEqual(payload["sample_transactions"], 0)
        self.assertFalse(payload["has_admin_user"])
        self.assertEqual(payload["admin_user_count"], 0)

    def test_maintenance_summary_reports_existing_admin_users(self):
        get_user_model().objects.create_superuser(
            username="local-admin",
            email="",
            password="River-Account-7429!",
        )

        response = self.client.get("/api/maintenance/summary/")
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["has_admin_user"])
        self.assertEqual(payload["admin_user_count"], 1)

    def test_maintenance_admin_user_rejects_wrong_confirmation(self):
        response = self.post_json(
            "/api/maintenance/admin-user/",
            {
                "confirmation": "wrong",
                "mode": "create",
                "password": "River-Account-7429!",
                "password_confirmation": "River-Account-7429!",
                "username": "local-admin",
            },
        )

        self.assertEqual(response.status_code, 400)
        payload = json_body(response)
        self.assertEqual(payload["error"], "Confirmation text does not match")
        self.assertEqual(payload["details"]["expected"], "CREATE ADMIN USER")

    def test_maintenance_admin_user_creates_superuser(self):
        response = self.post_json(
            "/api/maintenance/admin-user/",
            {
                "confirmation": "CREATE ADMIN USER",
                "mode": "create",
                "password": "River-Account-7429!",
                "password_confirmation": "River-Account-7429!",
                "username": "local-admin",
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 201)
        user = get_user_model().objects.get(username="local-admin")
        self.assertTrue(user.is_active)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertEqual(user.email, "")
        self.assertTrue(user.check_password("River-Account-7429!"))
        self.assertTrue(payload["summary"]["has_admin_user"])
        self.assertEqual(payload["summary"]["admin_user_count"], 1)

    def test_maintenance_admin_user_resets_and_promotes_existing_user(self):
        user = get_user_model().objects.create_user(
            username="local-admin",
            email="old@example.local",
            password="Old-Password-7429!",
        )

        response = self.post_json(
            "/api/maintenance/admin-user/",
            {
                "confirmation": "RESET ADMIN PASSWORD",
                "mode": "reset",
                "password": "New-River-Account-7429!",
                "password_confirmation": "New-River-Account-7429!",
                "username": "local-admin",
            },
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertEqual(user.email, "old@example.local")
        self.assertTrue(user.check_password("New-River-Account-7429!"))
        self.assertFalse(payload["admin"]["created"])
        self.assertEqual(payload["summary"]["admin_user_count"], 1)

    def test_maintenance_admin_user_rejects_password_mismatch(self):
        response = self.post_json(
            "/api/maintenance/admin-user/",
            {
                "confirmation": "CREATE ADMIN USER",
                "mode": "create",
                "password": "River-Account-7429!",
                "password_confirmation": "Different-Account-7429!",
                "username": "local-admin",
            },
        )

        self.assertEqual(response.status_code, 400)
        payload = json_body(response)
        self.assertEqual(payload["error"], "Password confirmation does not match")

    def test_maintenance_admin_user_checks_the_mode_and_existing_users(self):
        User = get_user_model()
        User.objects.create_user(username="taken", password="Old-Password-7429!")
        passwords = {
            "password": "River-Account-7429!",
            "password_confirmation": "River-Account-7429!",
        }

        def post(**fields):
            return self.post_json(
                "/api/maintenance/admin-user/", {**passwords, **fields}
            )

        no_mode = post(confirmation="CREATE ADMIN USER", username="new-admin")
        create_taken = post(
            mode="create", confirmation="CREATE ADMIN USER", username="taken"
        )
        reset_missing = post(
            mode="reset", confirmation="RESET ADMIN PASSWORD", username="nobody"
        )

        self.assertEqual(no_mode.status_code, 400)
        self.assertEqual(json_body(no_mode)["error"], "Unknown mode")
        self.assertEqual(create_taken.status_code, 409)
        self.assertEqual(
            json_body(create_taken)["error"], "A user named taken already exists."
        )
        taken = User.objects.get(username="taken")
        self.assertTrue(taken.check_password("Old-Password-7429!"))
        self.assertFalse(taken.is_superuser)
        self.assertEqual(reset_missing.status_code, 404)
        self.assertEqual(
            json_body(reset_missing)["error"], "There is no user named nobody."
        )
        self.assertFalse(
            User.objects.filter(username__in=["new-admin", "nobody"]).exists()
        )

    def test_maintenance_admin_user_keeps_spaces_in_passwords(self):
        password = "  River-Account-7429!  "

        response = self.post_json(
            "/api/maintenance/admin-user/",
            {
                "confirmation": "CREATE ADMIN USER",
                "mode": "create",
                "password": password,
                "password_confirmation": password,
                "username": "local-admin",
            },
        )
        user = get_user_model().objects.get(username="local-admin")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(user.check_password(password))
        self.assertFalse(user.check_password(password.strip()))

    def test_maintenance_delete_rejects_wrong_confirmation(self):
        response = self.delete_json(
            "/api/maintenance/transactions/",
            {"confirmation": "wrong"},
        )

        self.assertEqual(response.status_code, 400)
        payload = json_body(response)
        self.assertEqual(payload["error"], "Confirmation text does not match")
        self.assertEqual(payload["details"]["expected"], "DELETE ALL TRANSACTIONS")

    def test_maintenance_delete_sample_data_preserves_user_data(self):
        call_command("seed_sample_data", "--skip-admin", stdout=StringIO(), verbosity=0)
        user_category = Category.objects.create(name="User Category")
        user_transaction = Transaction.objects.create(
            transaction_date="2026-05-01",
            description="User transaction",
            amount=Decimal("-10.00"),
        )

        response = self.delete_json(
            "/api/maintenance/sample-data/",
            {"confirmation": "DELETE SAMPLE DATA"},
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["counts"]["transactions"], 20)
        self.assertFalse(
            Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).exists()
        )
        self.assertTrue(Transaction.objects.filter(id=user_transaction.id).exists())
        self.assertTrue(Category.objects.filter(id=user_category.id).exists())

    def test_maintenance_recreate_sample_data_preserves_user_data(self):
        user_transaction = Transaction.objects.create(
            transaction_date="2026-05-01",
            description="User transaction",
            amount=Decimal("-10.00"),
        )

        first_response = self.post_json("/api/maintenance/sample-data/recreate/", {})
        second_response = self.post_json("/api/maintenance/sample-data/recreate/", {})

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 201)
        self.assertTrue(Transaction.objects.filter(id=user_transaction.id).exists())
        self.assertEqual(
            Transaction.objects.filter(
                import_batch__source_filename=SAMPLE_IMPORT_SOURCE
            ).count(),
            20,
        )
        self.assertEqual(
            CSVImport.objects.filter(source_filename=SAMPLE_IMPORT_SOURCE).count(),
            1,
        )
        self.assertFalse(get_user_model().objects.exists())

    def test_maintenance_delete_transactions_removes_imports_and_preserves_definitions(
        self,
    ):
        csv_import = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="api-maintenance.csv",
        )
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Maintenance test",
            amount=Decimal("-12.50"),
        )

        response = self.delete_json(
            "/api/maintenance/transactions/",
            {"confirmation": "DELETE ALL TRANSACTIONS"},
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["counts"]["transactions"], 1)
        self.assertEqual(payload["counts"]["imports"], 1)
        self.assertFalse(Transaction.objects.exists())
        self.assertFalse(CSVImport.objects.exists())
        self.assertTrue(BankAccount.objects.filter(id=self.account.id).exists())
        self.assertTrue(CSVMapping.objects.filter(id=self.mapping.id).exists())
        self.assertTrue(Category.objects.filter(id=self.category.id).exists())
        self.assertTrue(Subcategory.objects.filter(id=self.subcategory.id).exists())
        self.assertTrue(Tag.objects.filter(id=self.tag.id).exists())

    def test_maintenance_deletes_save_a_safety_backup_first(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Keep me in the backup",
            amount=Decimal("-12.50"),
        )

        backup_names = []
        for endpoint, phrase in [
            ("/api/maintenance/transactions/", "DELETE ALL TRANSACTIONS"),
            ("/api/maintenance/finance-data/", "DELETE ALL FINANCE DATA"),
        ]:
            response = self.delete_json(endpoint, {"confirmation": phrase})
            payload = json_body(response)

            self.assertEqual(response.status_code, 200)
            self.assertTrue(payload["safety_backup"].startswith("pre-delete-"))
            listed = {backup["filename"]: backup for backup in payload["backups"]}
            self.assertEqual(listed[payload["safety_backup"]]["label"], "Pre-delete")
            backup_names.append(payload["safety_backup"])

        # Both deletes ran within a second; the second backup must not overwrite the first.
        self.assertEqual(len(set(backup_names)), 2)
        backup = sqlite3.connect(self.backup_dir() / backup_names[0])
        try:
            descriptions = [
                row[0]
                for row in backup.execute("SELECT description FROM finance_transaction")
            ]
        finally:
            backup.close()
        self.assertEqual(descriptions, ["Keep me in the backup"])

    def test_old_safety_backups_are_pruned_per_kind(self):
        young = [
            self.saved_backup("pre-delete-20260901-120000.sqlite3", 10),
            self.saved_backup("pre-delete-20260902-120000.sqlite3", 20),
        ]
        # 101 to 110 days old, newest first.
        old = [
            self.saved_backup(
                f"pre-delete-2025{month:02d}01-120000.sqlite3", 100 + month
            )
            for month in range(1, 11)
        ]
        other_kind = [
            self.saved_backup(f"pre-restore-2024{month:02d}01-120000.sqlite3", 200)
            for month in range(1, 13)
        ]
        not_made_by_the_app = [
            self.saved_backup("cashmoney-backup-20240101-120000.sqlite3", 300),
            self.saved_backup("my copy.sqlite3", 300),
            self.saved_backup("pre-delete-before-cleanup.sqlite3", 300),
        ]

        response = self.delete_json(
            "/api/maintenance/transactions/",
            {"confirmation": "DELETE ALL TRANSACTIONS"},
        )
        payload = json_body(response)

        # The new backup, the two young ones and the 7 newest old ones are the 10
        # kept; the 3 oldest are past both limits. Other files stay.
        self.assertEqual(response.status_code, 200)
        kept = young + old[:7] + other_kind + not_made_by_the_app
        self.assertEqual([path for path in old[7:] if path.exists()], [])
        self.assertEqual([path for path in kept if not path.exists()], [])
        self.assertEqual(
            {backup["filename"] for backup in payload["backups"]},
            {path.name for path in kept} | {payload["safety_backup"]},
        )

    def test_safety_backups_from_the_last_90_days_are_kept(self):
        recent = [
            self.saved_backup(f"pre-restore-202610{day:02d}-120000.sqlite3", day)
            for day in range(1, 13)
        ]

        new_backup = create_safety_backup("pre-restore")

        self.assertTrue(new_backup.exists())
        self.assertEqual([path for path in recent if not path.exists()], [])

    def test_save_backup_keeps_a_manual_backup_that_is_never_pruned(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="In the manual backup",
            amount=Decimal("-12.50"),
        )
        older = [
            self.saved_backup(f"cashmoney-backup-2025{month:02d}01-120000.sqlite3", 200)
            for month in range(1, 13)
        ]

        response = self.client.post("/api/maintenance/backups/")
        payload = json_body(response)
        create_safety_backup("pre-delete")

        self.assertEqual(response.status_code, 201)
        self.assertTrue(payload["saved"].startswith("cashmoney-backup-"))
        listed = {backup["filename"]: backup["label"] for backup in payload["backups"]}
        self.assertEqual(listed[payload["saved"]], "Manual")
        self.assertEqual([path for path in older if not path.exists()], [])
        backup = sqlite3.connect(self.backup_dir() / payload["saved"])
        try:
            descriptions = [
                row[0]
                for row in backup.execute("SELECT description FROM finance_transaction")
            ]
        finally:
            backup.close()
        self.assertEqual(descriptions, ["In the manual backup"])

    def test_maintenance_delete_finance_data_preserves_auth_users(self):
        user = get_user_model().objects.create_user(
            username="local-admin",
            password="secret",
        )
        csv_import = CSVImport.objects.create(
            bank_account=self.account,
            csv_mapping=self.mapping,
            source_filename="api-maintenance.csv",
        )
        keyword = self.keyword("Maintenance keyword", ["maintenance"])
        Transaction.objects.create(
            bank_account=self.account,
            import_batch=csv_import,
            transaction_date="2026-01-02",
            description="Maintenance test",
            amount=Decimal("-12.50"),
            subcategory=self.subcategory,
        )

        response = self.delete_json(
            "/api/maintenance/finance-data/",
            {"confirmation": "DELETE ALL FINANCE DATA"},
        )
        payload = json_body(response)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["deleted"])
        self.assertEqual(payload["counts"]["transactions"], 1)
        self.assertEqual(payload["counts"]["keywords"], 1)
        self.assertTrue(get_user_model().objects.filter(id=user.id).exists())
        self.assertFalse(Transaction.objects.exists())
        self.assertFalse(CSVImport.objects.exists())
        self.assertFalse(Keyword.objects.filter(id=keyword.id).exists())
        self.assertFalse(BankAccount.objects.exists())
        self.assertFalse(CSVMapping.objects.exists())
        self.assertFalse(Tag.objects.exists())
        self.assertFalse(Subcategory.objects.exists())
        self.assertFalse(Category.objects.exists())

    def test_maintenance_database_backup_returns_sqlite_attachment(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Maintenance backup test",
            amount=Decimal("-12.50"),
        )

        response = self.client.get("/api/maintenance/database-backup/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/x-sqlite3")
        self.assertIn("cashmoney-backup-", response["Content-Disposition"])
        temporary_path = response.temporary_path
        self.assertTrue(temporary_path.exists())
        # Reading the stream to the end closes the response, which deletes the file.
        content = b"".join(response.streaming_content)
        self.assertTrue(content.startswith(b"SQLite format 3"))
        self.assertFalse(temporary_path.exists())

    def test_maintenance_saved_backups_can_be_listed_exported_and_deleted(self):
        Transaction.objects.create(
            bank_account=self.account,
            transaction_date="2026-01-02",
            description="Saved backup test",
            amount=Decimal("-12.50"),
        )
        connection.ensure_connection()

        with (
            tempfile.TemporaryDirectory() as temp_dir,
            self.settings(DATA_DIR=Path(temp_dir)),
        ):
            backup_dir = Path(temp_dir) / "backups"
            backup_dir.mkdir()
            backup_path = backup_dir / "pre-restore-20260102-030405.sqlite3"
            backup_path.write_bytes(connection.connection.serialize())

            list_response = self.client.get("/api/maintenance/backups/")
            list_payload = json_body(list_response)

            self.assertEqual(list_response.status_code, 200)
            self.assertEqual(len(list_payload["backups"]), 1)
            self.assertEqual(
                list_payload["backups"][0]["filename"],
                "pre-restore-20260102-030405.sqlite3",
            )
            self.assertEqual(list_payload["backups"][0]["label"], "Pre-restore")

            export_response = self.client.get(
                "/api/maintenance/backups/pre-restore-20260102-030405.sqlite3/export/"
            )

            self.assertEqual(export_response.status_code, 200)
            self.assertEqual(export_response["Content-Type"], "application/x-sqlite3")
            self.assertIn(
                "pre-restore-20260102-030405.sqlite3",
                export_response["Content-Disposition"],
            )
            self.assertTrue(
                b"".join(export_response.streaming_content).startswith(
                    b"SQLite format 3"
                )
            )

            delete_response = self.delete_json(
                "/api/maintenance/backups/pre-restore-20260102-030405.sqlite3/",
                {"confirmation": "DELETE BACKUP"},
            )
            delete_payload = json_body(delete_response)

            self.assertEqual(delete_response.status_code, 200)
            self.assertTrue(delete_payload["deleted"])
            self.assertFalse(backup_path.exists())
            self.assertEqual(delete_payload["backups"], [])

    def test_maintenance_database_restore_rejects_invalid_upload(self):
        response = self.client.post(
            "/api/maintenance/database-restore/",
            {
                "confirmation": "RESTORE DATABASE",
                "backup_file": SimpleUploadedFile(
                    "not-a-backup.sqlite3",
                    b"not sqlite",
                    content_type="application/x-sqlite3",
                ),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            json_body(response)["error"],
            "Uploaded file is not a valid SQLite database",
        )
