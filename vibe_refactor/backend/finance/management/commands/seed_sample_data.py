from django.core.management.base import BaseCommand

from finance.sample_data import delete_sample_data, seed_sample_data


class Command(BaseCommand):
    help = "Seed the local Vibe Refactor database with admin and sample finance data."

    def add_arguments(self, parser):
        parser.add_argument("--admin-username", default="admin")
        parser.add_argument("--admin-password", default="CashmoneyDemo2026!")
        parser.add_argument("--admin-email", default="admin@example.local")
        parser.add_argument(
            "--if-empty",
            action="store_true",
            help="Seed only when the database has no transactions.",
        )
        parser.add_argument(
            "--reset-sample",
            action="store_true",
            help="Delete existing sample data before seeding.",
        )
        parser.add_argument(
            "--skip-admin",
            action="store_true",
            help="Do not create or update the local admin account.",
        )

    def handle(self, *args, **options):
        result = seed_sample_data(
            admin_email=options["admin_email"],
            admin_password=options["admin_password"],
            admin_username=options["admin_username"],
            if_empty=options["if_empty"],
            reset_sample=options["reset_sample"],
            skip_admin=options["skip_admin"],
        )

        if result["skipped"]:
            self.stdout.write(f"Sample database skipped: {result['reason']}")
            return

        self.stdout.write(self.style.SUCCESS("Sample database is ready."))
        if result["admin_username"]:
            self.stdout.write(f"Admin username: {result['admin_username']}")
            self.stdout.write(f"Admin password: {options['admin_password']}")
        self.stdout.write(
            f"Sample transactions created this run: {result['created_transactions']}"
        )


def reset_sample_data():
    return delete_sample_data()
