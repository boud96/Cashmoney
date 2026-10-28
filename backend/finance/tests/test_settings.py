"""Settings, the secret key, the packaged backend's entry point and its build check."""

import io
import logging
import os
import stat
import tempfile
from contextlib import contextmanager, redirect_stdout
from logging.handlers import RotatingFileHandler
from pathlib import Path
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.db import connection
from django.test import (
    SimpleTestCase,
    TestCase,
)

import packaged_backend
from cashmoney_backend.secret_key import load_or_create_secret_key
from check_bundle import find_databases, is_database_name
from check_bundle import main as check_bundle
from packaged_backend import configure_environment, rotate_if_large


@contextmanager
def fresh_root_logging():
    """Let configure_environment() set up logging without leaking its handlers."""
    root = logging.getLogger()
    handlers = list(root.handlers)
    level = root.level
    for handler in handlers:
        root.removeHandler(handler)
    try:
        yield
    finally:
        for handler in list(root.handlers):
            root.removeHandler(handler)
            handler.close()
        for handler in handlers:
            root.addHandler(handler)
        root.setLevel(level)


class SecretKeyTests(TestCase):
    def test_each_data_dir_gets_its_own_lasting_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            first = load_or_create_secret_key(temp_dir)
            again = load_or_create_secret_key(temp_dir)
            other = load_or_create_secret_key(Path(temp_dir) / "other-install")

        self.assertEqual(first, again)
        self.assertGreaterEqual(len(first), 50)
        self.assertNotEqual(first, other)


class PackagedBackendTests(SimpleTestCase):
    def test_a_large_log_starts_fresh_and_keeps_one_old_copy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            log = Path(temp_dir) / "backend.stdout.log"
            log.write_bytes(b"x" * 2000)
            (Path(temp_dir) / "backend.stdout.log.1").write_bytes(b"older")

            rotate_if_large(log, max_bytes=1000)
            rotated = (Path(temp_dir) / "backend.stdout.log.1").read_bytes()
            log.write_bytes(b"small")
            rotate_if_large(log, max_bytes=1000)

            self.assertEqual(len(rotated), 2000)
            self.assertEqual(log.read_bytes(), b"small")

    def test_the_backend_log_rotates(self):
        with tempfile.TemporaryDirectory() as temp_dir, fresh_root_logging():
            with patch.dict(os.environ, {"CASHMONEY_DATA_DIR": temp_dir}):
                configure_environment()
            rotating = [
                handler
                for handler in logging.getLogger().handlers
                if isinstance(handler, RotatingFileHandler)
            ]
            self.assertEqual(len(rotating), 1)
            self.assertEqual(rotating[0].maxBytes, 1_000_000)

    def test_the_data_dir_follows_electron_on_linux(self):
        # Electron's userData on Linux, where the desktop app keeps the database. Electron
        # names it after desktop/package.json's "name" (there is no top-level productName).
        with patch.dict(os.environ, {"XDG_CONFIG_HOME": "/home/u/.cfg"}):
            os.environ.pop("CASHMONEY_DATA_DIR", None)
            self.assertEqual(
                packaged_backend.default_data_dir("linux"),
                Path("/home/u/.cfg/cashmoney-desktop"),
            )
        with (
            patch.dict(os.environ),
            patch.object(packaged_backend.Path, "home", return_value=Path("/home/u")),
        ):
            os.environ.pop("CASHMONEY_DATA_DIR", None)
            os.environ.pop("XDG_CONFIG_HOME", None)
            self.assertEqual(
                packaged_backend.default_data_dir("linux"),
                Path("/home/u/.config/cashmoney-desktop"),
            )

    def test_the_data_dir_stays_in_appdata_on_windows(self):
        with patch.dict(os.environ, {"APPDATA": r"C:\Users\u\AppData\Roaming"}):
            os.environ.pop("CASHMONEY_DATA_DIR", None)
            self.assertEqual(
                packaged_backend.default_data_dir("win32"),
                Path(r"C:\Users\u\AppData\Roaming") / "Cashmoney",
            )

    def test_cashmoney_data_dir_wins_everywhere(self):
        environ = {
            "CASHMONEY_DATA_DIR": "/data/cm",
            "XDG_CONFIG_HOME": "/x",
            "APPDATA": "/y",
        }
        with patch.dict(os.environ, environ):
            for platform in ["linux", "win32"]:
                with self.subTest(platform=platform):
                    self.assertEqual(
                        packaged_backend.default_data_dir(platform), Path("/data/cm")
                    )

    @skipUnless(os.name == "posix", "file modes are POSIX-only")
    def test_the_data_dir_is_private(self):
        # The folder holds the finances, backups and secret key: other accounts on the
        # same Linux PC must not read it.
        with tempfile.TemporaryDirectory() as temp_dir, fresh_root_logging():
            data_dir = Path(temp_dir) / "Cashmoney"
            data_dir.mkdir()
            data_dir.chmod(0o755)
            with patch.dict(os.environ, {"CASHMONEY_DATA_DIR": str(data_dir)}):
                configure_environment()

            self.assertEqual(stat.S_IMODE(data_dir.stat().st_mode), 0o700)

    def test_the_backend_stops_when_the_app_is_gone(self):
        # Once the desktop app that started it is gone (a crash, kill -9), the backend
        # sees a new parent and exits, so it can't hold port 8765 for the next start.
        ppids = iter([4242, 4242, 1])
        on_gone = Mock()

        packaged_backend.watch_parent(
            4242, interval=0, get_ppid=lambda: next(ppids), on_gone=on_gone
        )

        on_gone.assert_called_once_with()
        self.assertIsNone(next(ppids, None))

    def test_the_backend_watches_the_app_that_started_it(self):
        # The app passes its own PID, so a backend whose app died while it was still
        # starting (already reparented) stops at once instead of watching its new parent.
        started_by_app = {"CASHMONEY_APP_PID": "4242"}

        self.assertEqual(
            packaged_backend.app_pid_to_watch(started_by_app, "posix"), 4242
        )
        self.assertIsNone(packaged_backend.app_pid_to_watch({}, "posix"))
        self.assertIsNone(packaged_backend.app_pid_to_watch(started_by_app, "nt"))

    def test_a_garbled_app_pid_doesnt_stop_the_start(self):
        # Only a hand-set variable can be garbled; the backend then runs without the watch.
        with self.assertLogs(level="WARNING") as logs:
            pid = packaged_backend.app_pid_to_watch(
                {"CASHMONEY_APP_PID": "abc"}, "posix"
            )

        self.assertIsNone(pid)
        self.assertIn("CASHMONEY_APP_PID", logs.output[0])


class BundleCheckTests(SimpleTestCase):
    # PyInstaller's Django hook bundles any *.db / db.* file next to manage.py, such as
    # the development database (CR-60); the build fails if one gets through.
    def test_database_file_names(self):
        for name in [
            "db.sqlite3",
            "db.sqlite3-journal",
            "db.sqlite3-wal",
            "cashmoney.db",
            "db.json",
        ]:
            with self.subTest(name=name):
                self.assertTrue(is_database_name(name))
        for name in [
            "db.py",
            "db.pyc",
            "base_library.zip",
            "favicon.ico",
            "dbutils.txt",
        ]:
            with self.subTest(name=name):
                self.assertFalse(is_database_name(name))

    def test_finds_databases_anywhere_in_a_bundle(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for relative in [
                "_internal/db.sqlite3",
                "_internal/x/old.db",
                "_internal/finance/static/app.js",
                "cashmoney-backend",
            ]:
                (root / relative).parent.mkdir(parents=True, exist_ok=True)
                (root / relative).write_bytes(b"x")

            found = find_databases(root)

        self.assertEqual(
            found,
            [root / "_internal" / "db.sqlite3", root / "_internal" / "x" / "old.db"],
        )

    def test_the_check_fails_only_when_a_database_is_bundled(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle = Path(temp_dir) / "cashmoney-backend"
            (bundle / "_internal").mkdir(parents=True)
            (bundle / "cashmoney-backend").write_bytes(b"x")
            with redirect_stdout(io.StringIO()):
                clean = check_bundle([str(bundle)])
            (bundle / "_internal" / "db.sqlite3").write_bytes(b"x")
            with redirect_stdout(io.StringIO()) as output:
                leaky = check_bundle([str(bundle)])
            with redirect_stdout(io.StringIO()):
                missing = check_bundle([str(Path(temp_dir) / "missing")])

        self.assertEqual(clean, 0)
        self.assertEqual(leaky, 1)
        self.assertIn("db.sqlite3", output.getvalue())
        self.assertEqual(missing, 2)


class DatabaseSettingsTests(TestCase):
    def test_writes_wait_for_the_write_lock(self):
        # With deferred transactions, a write that had already read failed at once
        # while another request held the write lock (CR-39). The scripted check is
        # .claude/tools/analysis/lock_check.py.
        options = connection.settings_dict["OPTIONS"]

        self.assertEqual(options["transaction_mode"], "IMMEDIATE")
        self.assertGreaterEqual(options["timeout"], 20)
