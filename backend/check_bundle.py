"""Fail a build whose backend bundle contains a database file (CR-60).

PyInstaller's Django hook adds every *.db and db.* file next to manage.py to the
bundle, such as a development database with real data in it. The spec leaves them
out; the build scripts run this check on the finished bundle so none gets through.

    python check_bundle.py <bundle folder>
"""

import sys
from fnmatch import fnmatch
from pathlib import Path

DATABASE_PATTERNS = ("*.db", "*.sqlite3", "*.sqlite3-*", "db.*")
SOURCE_SUFFIXES = (".py", ".pyc")


def is_database_name(name):
    """True for the file names of SQLite databases and their journals."""
    if name.endswith(SOURCE_SUFFIXES):
        return False
    return any(fnmatch(name, pattern) for pattern in DATABASE_PATTERNS)


def find_databases(root):
    """The database files at any depth under root, sorted."""
    return sorted(
        path
        for path in Path(root).rglob("*")
        if path.is_file() and is_database_name(path.name)
    )


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python check_bundle.py <bundle folder>")
        return 2
    if not Path(args[0]).is_dir():
        print(f"No such folder: {args[0]}")
        return 2
    found = find_databases(args[0])
    for path in found:
        print(f"Database file in the bundle: {path}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
