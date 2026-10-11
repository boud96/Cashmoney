"""Data migrations."""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import (
    TransactionTestCase,
)

from ..models import (
    CSVImport,
    Category,
)


class SampleFlagMigrationTests(TransactionTestCase):
    before = [("finance", "0012_internaltransfermatch_previous_values")]
    after = [("finance", "0013_sample_flags")]

    def tearDown(self):
        # Leave the schema at the latest migration for the other tests.
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_sample_data_is_flagged(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        old_apps = executor.loader.project_state(self.before).apps
        old_category = old_apps.get_model("finance", "Category")
        old_category.objects.create(name="Sample - Food", description="Sample data")
        old_category.objects.create(name="Sample - Mine", description="My own")
        old_import = old_apps.get_model("finance", "CSVImport")
        old_import.objects.create(source_filename="Sample - initial demo data")
        old_import.objects.create(source_filename="statement.csv")

        executor = MigrationExecutor(connection)
        executor.migrate(self.after)

        self.assertEqual(
            dict(Category.objects.values_list("name", "is_sample")),
            {"Sample - Food": True, "Sample - Mine": False},
        )
        self.assertEqual(
            dict(CSVImport.objects.values_list("source_filename", "is_sample")),
            {"Sample - initial demo data": True, "statement.csv": False},
        )


class CompactImportReportMigrationTests(TransactionTestCase):
    before = [("finance", "0013_sample_flags")]
    after = [("finance", "0014_compact_import_reports")]

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_reports_are_compacted(self):
        executor = MigrationExecutor(connection)
        executor.migrate(self.before)
        old_import = executor.loader.project_state(self.before).apps.get_model(
            "finance", "CSVImport"
        )
        legacy = old_import.objects.create(
            source_filename="old.csv",
            report={
                "loaded": 3,
                "created": {
                    "count": 2,
                    "transactions": [{"id": "a", "raw_data": {"x": 1}}, {"id": "b"}],
                    "category_overlaps": [{"id": "a"}],
                    "uncategorized": [{"id": "a"}, {"id": "b"}],
                },
                "skipped": {
                    "duplicates": [
                        {
                            "line": 4,
                            "row": {"x": 1},
                            "duplicate_transaction": {"id": "z"},
                        }
                    ],
                    "errors": [{"line": 5, "error": "bad", "row": {"x": 2}}],
                },
            },
        )

        executor = MigrationExecutor(connection)
        executor.migrate(self.after)

        self.assertEqual(
            CSVImport.objects.get(id=legacy.id).report,
            {
                "loaded": 3,
                "created": {
                    "count": 2,
                    "transaction_ids": ["a", "b"],
                    "category_overlap_count": 1,
                    "uncategorized_count": 2,
                },
                "skipped": {
                    "duplicates": [{"line": 4, "duplicate_transaction": {"id": "z"}}],
                    "errors": [{"line": 5, "error": "bad", "row": {"x": 2}}],
                },
            },
        )
