from django.db import migrations


def compact_report(report):
    """Reduce a stored import report to the compact format of CSVImportService.

    Created transactions become their IDs plus counts (they are in the
    transactions table anyway), and skipped duplicates lose their raw row. What
    the UI shows, and what finding rows lost to in-file duplicates needs (created
    IDs and each duplicate's matched transaction), is kept. Already compact
    reports come back unchanged.
    """
    if not isinstance(report, dict):
        return report
    created = report.get("created")
    if isinstance(created, dict) and "transactions" in created:
        transactions = created.get("transactions") or []
        report["created"] = {
            "count": created.get("count", len(transactions)),
            "transaction_ids": [
                str(item["id"])
                for item in transactions
                if isinstance(item, dict) and item.get("id")
            ],
            "category_overlap_count": len(created.get("category_overlaps") or []),
            "uncategorized_count": len(created.get("uncategorized") or []),
        }
    skipped = report.get("skipped")
    if isinstance(skipped, dict):
        for entry in skipped.get("duplicates") or []:
            if isinstance(entry, dict):
                entry.pop("row", None)
    return report


def compact_import_reports(apps, schema_editor):
    CSVImport = apps.get_model("finance", "CSVImport")
    for csv_import in CSVImport.objects.only("id", "report").iterator():
        CSVImport.objects.filter(id=csv_import.id).update(
            report=compact_report(csv_import.report)
        )


def reclaim_space(apps, schema_editor):
    # Reports were about half of a typical database; VACUUM gives the space back so
    # the file and its backups shrink. It can't run inside a transaction.
    connection = schema_editor.connection
    if connection.vendor == "sqlite" and not connection.in_atomic_block:
        with connection.cursor() as cursor:
            cursor.execute("VACUUM")


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("finance", "0013_sample_flags"),
    ]

    operations = [
        migrations.RunPython(
            compact_import_reports, migrations.RunPython.noop, atomic=True
        ),
        migrations.RunPython(reclaim_space, migrations.RunPython.noop),
    ]
