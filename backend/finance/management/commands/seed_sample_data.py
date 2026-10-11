from django.core.management.base import BaseCommand

from finance.sample_data import delete_sample_data, seed_sample_data


class Command(BaseCommand):
    help = "Seed the local Cashmoney database with sample finance data."

    def add_arguments(self, parser):
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

    def handle(self, *args, **options):
        result = seed_sample_data(
            if_empty=options["if_empty"],
            reset_sample=options["reset_sample"],
        )

        if result["skipped"]:
            self.stdout.write(f"Sample database skipped: {result['reason']}")
            return

        self.stdout.write(self.style.SUCCESS("Sample database is ready."))
        self.stdout.write(
            f"Sample transactions created this run: {result['created_transactions']}"
        )


def reset_sample_data():
    return delete_sample_data()
