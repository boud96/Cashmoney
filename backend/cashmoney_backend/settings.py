"""Settings for the Cashmoney Django backend."""

import os
from pathlib import Path

from .secret_key import load_or_create_secret_key


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("CASHMONEY_DATA_DIR", BASE_DIR))

# Each install gets its own key (DATA_DIR/secret_key.txt); CASHMONEY_SECRET_KEY overrides.
SECRET_KEY = os.environ.get("CASHMONEY_SECRET_KEY") or load_or_create_secret_key(
    DATA_DIR
)
# On for development; the packaged app sets CASHMONEY_DEBUG=0 (packaged_backend.py).
DEBUG = os.environ.get("CASHMONEY_DEBUG", "1") == "1"

ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
CSRF_TRUSTED_ORIGINS = [
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]
CSRF_FAILURE_VIEW = "finance.views.csrf_failure"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "finance",
]

MIDDLEWARE = [
    "finance.middleware.LocalApiCorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # Serves the React bundle and admin assets when DEBUG is off (the packaged app).
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cashmoney_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "cashmoney_backend.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": DATA_DIR / "db.sqlite3",
        # Writes start with BEGIN IMMEDIATE and wait up to 20 s for the write lock.
        # With the default deferred transactions, a write that had already read
        # failed at once with "database is locked" whenever another request was
        # writing, e.g. a row edit during an import (the server is multi-threaded).
        "OPTIONS": {"timeout": 20, "transaction_mode": "IMMEDIATE"},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Europe/Prague"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# Serve straight from the app static folders (no collectstatic step); pick up rebuilt
# frontend files without a restart in development.
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = DEBUG

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
