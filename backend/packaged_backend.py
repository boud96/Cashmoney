"""PyInstaller entry point for the local Django backend."""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Log files would otherwise grow for the life of the install.
LOG_MAX_BYTES = 1_000_000
LOG_BACKUP_COUNT = 3


def rotate_if_large(path, max_bytes=LOG_MAX_BYTES):
    """Start a fresh file once it has grown past max_bytes; the previous one stays as .1."""
    path = Path(path)
    try:
        if path.stat().st_size > max_bytes:
            path.replace(path.with_name(f"{path.name}.1"))
    except OSError:
        pass  # no file yet, or in use: keep appending


def default_data_dir():
    base = os.environ.get("CASHMONEY_DATA_DIR")
    if base:
        return Path(base)

    appdata = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
    if appdata:
        return Path(appdata) / "Cashmoney"

    return Path.home() / "AppData" / "Roaming" / "Cashmoney"


def configure_environment():
    data_dir = default_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("CASHMONEY_DATA_DIR", str(data_dir))
    os.environ.setdefault("CASHMONEY_DEBUG", "0")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cashmoney_backend.settings")

    if sys.stdout is None:
        rotate_if_large(data_dir / "backend.stdout.log")
        sys.stdout = open(data_dir / "backend.stdout.log", "a", encoding="utf-8")
    if sys.stderr is None:
        rotate_if_large(data_dir / "backend.stderr.log")
        sys.stderr = open(data_dir / "backend.stderr.log", "a", encoding="utf-8")

    logging.basicConfig(
        handlers=[
            RotatingFileHandler(
                data_dir / "backend.log",
                maxBytes=LOG_MAX_BYTES,
                backupCount=LOG_BACKUP_COUNT,
                encoding="utf-8",
            )
        ],
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logging.info("Starting Cashmoney backend with data dir %s", data_dir)


def main():
    configure_environment()
    port = os.environ.get("CASHMONEY_PORT", "8000")

    import django
    from django.core.management import call_command

    django.setup()
    call_command("migrate", interactive=False, verbosity=0)
    call_command("seed_sample_data", "--if-empty", "--skip-admin", verbosity=0)

    # A production WSGI server instead of Django's development server (runserver).
    from waitress import serve

    from cashmoney_backend.wsgi import application

    logging.info("Serving on 127.0.0.1:%s", port)
    serve(application, host="127.0.0.1", port=int(port), threads=8)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Cashmoney backend failed")
        raise
