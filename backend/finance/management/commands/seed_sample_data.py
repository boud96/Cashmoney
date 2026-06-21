from django.core.management.base import BaseCommand, CommandError

from finance.sample_data import delete_sample_data, seed_sample_data


class Command(BaseCommand):
    help = "Seed the local Cashmoney database with sample finance data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--create-admin",
            action="store_true",
            help="Create or update a local admin account using the provided credentials.",
        )
        parser.add_argument("--admin-username", default="")
        parser.add_argument("--admin-password", default="")
        parser.add_argument("--admin-email", default="")
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
            help="Do not create or update the local admin account. This is the default.",
        )

    def handle(self, *args, **options):
        create_admin = options["create_admin"] and not options["skip_admin"]
        if create_admin and (
            not options["admin_username"] or not options["admin_password"]
        ):
            raise CommandError(
                "--create-admin requires --admin-username and --admin-password."
            )

        result = seed_sample_data(
            admin_email=options["admin_email"],
            admin_password=options["admin_password"],
            admin_username=options["admin_username"],
            if_empty=options["if_empty"],
            reset_sample=options["reset_sample"],
            skip_admin=not create_admin,
        )

        if result["skipped"]:
            self.stdout.write(f"Sample database skipped: {result['reason']}")
            return

        self.stdout.write(self.style.SUCCESS("Sample database is ready."))
        if result["admin_username"]:
            self.stdout.write(f"Admin username: {result['admin_username']}")
        self.stdout.write(
            f"Sample transactions created this run: {result['created_transactions']}"
        )


def reset_sample_data():
    return delete_sample_data()
