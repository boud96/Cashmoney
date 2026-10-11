"""Settings, the secret key, the packaged backend's entry point."""

import logging
import os
import tempfile
from logging.handlers import RotatingFileHandler
from pathlib import Path
from unittest.mock import patch

from django.db import connection
from django.test import (
    SimpleTestCase,
    TestCase,
)

from cashmoney_backend.secret_key import load_or_create_secret_key
from packaged_backend import configure_environment, rotate_if_large


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
        root = logging.getLogger()
        handlers = list(root.handlers)
        self.addCleanup(root.setLevel, root.level)
        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                for handler in handlers:
                    root.removeHandler(handler)
                with patch.dict(os.environ, {"CASHMONEY_DATA_DIR": temp_dir}):
                    configure_environment()
                rotating = [
                    handler
                    for handler in root.handlers
                    if isinstance(handler, RotatingFileHandler)
                ]
                self.assertEqual(len(rotating), 1)
                self.assertEqual(rotating[0].maxBytes, 1_000_000)
            finally:
                for handler in list(root.handlers):
                    root.removeHandler(handler)
                    handler.close()
                for handler in handlers:
                    root.addHandler(handler)


class DatabaseSettingsTests(TestCase):
    def test_writes_wait_for_the_write_lock(self):
        # With deferred transactions, a write that had already read failed at once
        # while another request held the write lock (CR-39). The scripted check is
        # .claude/tools/analysis/lock_check.py.
        options = connection.settings_dict["OPTIONS"]

        self.assertEqual(options["transaction_mode"], "IMMEDIATE")
        self.assertGreaterEqual(options["timeout"], 20)
