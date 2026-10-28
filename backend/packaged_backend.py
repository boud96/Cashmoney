"""PyInstaller entry point for the local Django backend."""

import logging
import os
import sys
import threading
import time
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


def default_data_dir(platform=sys.platform):
    base = os.environ.get("CASHMONEY_DATA_DIR")
    if base:
        return Path(base)

    if platform == "win32":
        appdata = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
        if appdata:
            return Path(appdata) / "Cashmoney"
        return Path.home() / "AppData" / "Roaming" / "Cashmoney"

    # Electron's userData folder on Linux. Electron names it after desktop/package.json's
    # "name", as there is no top-level productName.
    config_home = os.environ.get("XDG_CONFIG_HOME")
    if config_home:
        return Path(config_home) / "cashmoney-desktop"
    return Path.home() / ".config" / "cashmoney-desktop"


def make_private(path):
    """Keep the data folder (finances, backups, secret key) to its owner on Linux."""
    if os.name == "posix":
        try:
            os.chmod(path, 0o700)
        except OSError:
            logging.warning("Could not make %s private", path, exc_info=True)


def stop_backend():
    logging.info("The Cashmoney app is gone; stopping the backend.")
    os._exit(0)


def watch_parent(parent_pid, *, interval=1.0, get_ppid=os.getppid, on_gone=None):
    """Wait until parent_pid is no longer this process's parent, then call on_gone.

    If the app that started the backend dies without quitting (a crash, kill -9,
    logout), the backend gets a new parent; without this it would keep port 8765 busy
    for the next start. On Windows the app ends a leftover backend instead.
    """
    while get_ppid() == parent_pid:
        time.sleep(interval)
    (on_gone or stop_backend)()


def app_pid_to_watch(environ, os_name=os.name):
    """The PID of the desktop app that started this backend, on Linux; else None.

    The app passes it (CASHMONEY_APP_PID) instead of the backend reading its parent
    at startup: if the app died during the start, that parent would already be
    someone else.
    """
    app_pid = environ.get("CASHMONEY_APP_PID")
    if os_name != "posix" or not app_pid:
        return None
    try:
        return int(app_pid)
    except ValueError:
        logging.warning("Ignoring CASHMONEY_APP_PID=%r: not a process id", app_pid)
        return None


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
    make_private(data_dir)
    logging.info("Starting Cashmoney backend with data dir %s", data_dir)


def main():
    configure_environment()
    app_pid = app_pid_to_watch(os.environ)
    if app_pid:
        # Started by the desktop app: stop when it's gone.
        threading.Thread(target=watch_parent, args=(app_pid,), daemon=True).start()
    port = os.environ.get("CASHMONEY_PORT", "8000")

    import django
    from django.core.management import call_command

    django.setup()
    call_command("migrate", interactive=False, verbosity=0)
    call_command("seed_sample_data", "--if-empty", verbosity=0)

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
