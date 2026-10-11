"""How the API treats requests: errors, CSRF, origins, limits, the app shell, health."""

import hashlib
import hmac
import json
import os
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import (
    Client,
)

from ..models import (
    Transaction,
)
from .base import FinanceTestCase, json_body


class APIRequestTests(FinanceTestCase):
    def test_validation_error_shape(self):
        response = self.post_json("/api/bank-accounts/", {"name": ""})

        self.assertEqual(response.status_code, 400)
        payload = json_body(response)
        self.assertEqual(payload["error"], "Missing required field")
        self.assertEqual(payload["details"]["field"], "name")

    def test_unexpected_errors_return_json_and_are_logged(self):
        with patch(
            "finance.views.maintenance_counts", side_effect=RuntimeError("boom")
        ):
            with self.assertLogs("finance.views", level="ERROR") as logs:
                response = self.client.get("/api/maintenance/summary/")

        self.assertEqual(response.status_code, 500)
        self.assertIn("Something went wrong", json_body(response)["error"])
        self.assertIn("boom", "\n".join(logs.output))

    def test_app_shell_sets_csrf_cookie(self):
        csrf_client = Client(enforce_csrf_checks=True)

        response = csrf_client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", csrf_client.cookies)

    def test_app_shell_sets_a_content_security_policy(self):
        page = self.client.get("/").content.decode()

        self.assertIn('http-equiv="Content-Security-Policy"', page)
        self.assertIn("script-src 'self';", page)
        self.assertIn("object-src 'none'", page)

    def test_json_mutation_requires_csrf_token(self):
        csrf_client = Client(enforce_csrf_checks=True)

        response = csrf_client.post(
            "/api/bank-accounts/",
            data=json.dumps({"name": "CSRF Test", "currency": "CZK", "owners": 1}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(json_body(response)["error"], "CSRF verification failed")

    def test_json_mutation_accepts_valid_csrf_token(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.get("/")
        token = csrf_client.cookies["csrftoken"].value

        response = csrf_client.post(
            "/api/bank-accounts/",
            data=json.dumps({"name": "CSRF Test", "currency": "CZK", "owners": 1}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN="http://127.0.0.1:8000",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(json_body(response)["name"], "CSRF Test")

    def test_unsafe_request_rejects_untrusted_origin(self):
        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.get("/")
        token = csrf_client.cookies["csrftoken"].value

        response = csrf_client.post(
            "/api/bank-accounts/",
            data=json.dumps({"name": "Origin Test", "currency": "CZK", "owners": 1}),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
            HTTP_ORIGIN="https://example.com",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(json_body(response)["error"], "Origin is not allowed")

    def test_trusted_origin_receives_cors_headers(self):
        response = self.client.get(
            "/api/health/",
            HTTP_ORIGIN="http://127.0.0.1:8765",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Access-Control-Allow-Origin"],
            "http://127.0.0.1:8765",
        )
        self.assertEqual(response["Access-Control-Allow-Credentials"], "true")

    def test_untrusted_read_origin_receives_no_cors_headers(self):
        response = self.client.get(
            "/api/health/",
            HTTP_ORIGIN="https://example.com",
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Access-Control-Allow-Origin", response)

    def test_health_proves_the_desktop_apps_launch_token(self):
        nonce = "4f1c2a"
        with patch.dict(os.environ, {"CASHMONEY_INSTANCE_TOKEN": "launch-token"}):
            proven = json_body(self.client.get("/api/health/", {"nonce": nonce}))
            no_nonce = json_body(self.client.get("/api/health/"))
        without_token = json_body(self.client.get("/api/health/", {"nonce": nonce}))

        expected = hmac.new(b"launch-token", nonce.encode(), hashlib.sha256)
        self.assertEqual(proven["proof"], expected.hexdigest())
        self.assertNotIn("proof", no_nonce)
        self.assertNotIn("proof", without_token)

    def test_untrusted_unsafe_preflight_is_rejected(self):
        # :5173 was the Vite dev server's port, which the app no longer uses (BP#16).
        for origin in ("https://example.com", "http://127.0.0.1:5173"):
            response = self.client.options(
                "/api/bank-accounts/",
                HTTP_ORIGIN=origin,
                HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            )

            self.assertEqual(response.status_code, 403, origin)
            self.assertEqual(json_body(response)["error"], "Origin is not allowed")

    def test_trusted_unsafe_preflight_is_allowed(self):
        response = self.client.options(
            "/api/bank-accounts/",
            HTTP_ORIGIN="http://127.0.0.1:8765",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Access-Control-Allow-Origin"],
            "http://127.0.0.1:8765",
        )

    def test_multipart_mutation_requires_csrf_token(self):
        csrf_client = Client(enforce_csrf_checks=True)

        response = csrf_client.post(
            "/api/imports/preview/",
            data={
                "bank_account_id": str(self.account.id),
                "csv_file": self.csv_file(
                    "ID,Date,Description,Amount,Currency\n1,2026-01-01,Lunch,-10.00,CZK"
                ),
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(json_body(response)["error"], "CSRF verification failed")

    def test_json_body_rejects_non_json_content_type(self):
        response = self.client.post(
            "/api/bank-accounts/",
            data=json.dumps({"name": "Wrong Content Type"}),
            content_type="text/plain",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(json_body(response)["error"], "Unsupported content type")

    def test_uploads_over_the_size_limit_are_refused(self):
        body = "ID,Date,Description,Amount\napi-1,2026-01-02,McDonalds,-12.50\n"
        with (
            patch("finance.views.MAX_IMPORT_FILE_BYTES", 20),
            patch("finance.views.MAX_BACKUP_FILE_BYTES", 5),
        ):
            responses = [
                self.client.post(
                    "/api/csv-mappings/detect-columns/",
                    {"default_currency": "CZK", "csv_file": self.csv_file(body)},
                ),
                self.client.post(
                    "/api/imports/preview/",
                    {
                        "bank_account_id": str(self.account.id),
                        "csv_mapping_id": str(self.mapping.id),
                        "csv_file": self.csv_file(body),
                    },
                ),
                self.client.post(
                    "/api/imports/",
                    {
                        "bank_account_id": str(self.account.id),
                        "csv_mapping_id": str(self.mapping.id),
                        "csv_file": self.csv_file(body),
                    },
                ),
                self.client.post(
                    "/api/maintenance/database-restore/",
                    {
                        "confirmation": "RESTORE DATABASE",
                        "backup_file": SimpleUploadedFile(
                            "backup.sqlite3",
                            b"too big for the limit",
                            content_type="application/x-sqlite3",
                        ),
                    },
                ),
            ]

        for response in responses:
            self.assertEqual(response.status_code, 400)
            self.assertIn("The file is too large", json_body(response)["error"])
        self.assertFalse(Transaction.objects.exists())
