"""ASGI config for the Cashmoney backend."""

import os

from django.core.asgi import get_asgi_application


os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cashmoney_backend.settings")

application = get_asgi_application()
