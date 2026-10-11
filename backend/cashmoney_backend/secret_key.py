"""A per-install SECRET_KEY, kept in a file next to the database."""

import secrets
from pathlib import Path

KEY_FILENAME = "secret_key.txt"


def load_or_create_secret_key(data_dir):
    """Return the key stored in data_dir, creating it on first use.

    Each install (and each development checkout) gets its own random key instead of
    one shared key from the repository. If the file can't be written, a random key
    for this run is used; the only effect is that admin sessions don't survive a
    restart.
    """
    path = Path(data_dir) / KEY_FILENAME
    try:
        key = path.read_text(encoding="utf-8").strip()
        if key:
            return key
    except OSError:
        pass
    key = secrets.token_urlsafe(50)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(key, encoding="utf-8")
    except OSError:
        pass
    return key
