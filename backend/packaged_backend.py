"""PyInstaller entry point for the local Django backend."""

import logging
import os
import sys
from pathlib import Path


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
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cashmoney_backend.settings")

    if sys.stdout is None:
        sys.stdout = open(data_dir / "backend.stdout.log", "a", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(data_dir / "backend.stderr.log", "a", encoding="utf-8")

    logging.basicConfig(
        filename=data_dir / "backend.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    logging.info("Starting Cashmoney backend with data dir %s", data_dir)


def main():
    configure_environment()
    port = os.environ.get("CASHMONEY_PORT", "8000")

    import django
    from django.core.management import call_command, execute_from_command_line

    django.setup()
    call_command("migrate", interactive=False, verbosity=0)
    call_command("seed_sample_data", "--if-empty", "--skip-admin", verbosity=0)
    execute_from_command_line(
        [
            "cashmoney-backend",
            "runserver",
            f"127.0.0.1:{port}",
            "--noreload",
        ]
    )


if __name__ == "__main__":
    try:
        main()
    except Exception:
        logging.exception("Cashmoney backend failed")
        raise
