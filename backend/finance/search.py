"""Transaction text search that ignores case, accents, spaces and punctuation.

fold_search_text folds text the same way as normalizeName in
frontend/src/shared.js, which the filter panels use to search their options.
"""

import re
import unicodedata

from django.db.models import TextField, Transform

SEARCH_FIELDS = (
    "description",
    "counterparty_name",
    "counterparty_account_number",
    "transaction_type",
    "counterparty_note",
    "my_note",
    "other_note",
)


def fold_search_text(value):
    decomposed = unicodedata.normalize("NFD", str(value or ""))
    without_accents = "".join(
        char for char in decomposed if not unicodedata.combining(char)
    )
    return re.sub(r"[^a-z0-9]", "", without_accents.lower())


class SearchFold(Transform):
    """`field__searchfold__contains=...`, backed by a SQLite function."""

    lookup_name = "searchfold"
    function = "cashmoney_fold"
    output_field = TextField()


def register_sqlite_search(sender, connection, **kwargs):
    if connection.vendor == "sqlite":
        connection.connection.create_function(
            "cashmoney_fold", 1, fold_search_text, deterministic=True
        )
