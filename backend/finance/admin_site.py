"""The Django admin, opened from the app without a password.

The app has no accounts, and anything that can reach the API can already change or
replace every record, so an admin password protected nothing. Maintenance → Advanced
→ "Open database admin" posts to the API (same-origin and CSRF checks, like every
other write), which signs that browser in as the built-in superuser. The sign-in
lasts until the backend stops; in the desktop app, until it closes. There is no
password login: /admin/login/ only says where to open the admin from.
"""

import secrets

from django.contrib import admin
from django.contrib.admin.apps import AdminConfig
from django.contrib.auth import get_user_model, login
from django.contrib.auth.decorators import login_not_required
from django.http import HttpResponseRedirect
from django.template.response import TemplateResponse
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache


BUILT_IN_ADMIN_USERNAME = "cashmoney"
ADMIN_SESSION_KEY = "cashmoney_admin_run"
# New each time the backend starts, so admin sign-ins from earlier runs stop working.
BACKEND_RUN_ID = secrets.token_hex(16)


class CashmoneyAdminSite(admin.AdminSite):
    def has_permission(self, request):
        return (
            super().has_permission(request)
            and request.session.get(ADMIN_SESSION_KEY) == BACKEND_RUN_ID
        )

    @method_decorator(never_cache)
    @login_not_required
    def login(self, request, extra_context=None):
        if self.has_permission(request):
            return HttpResponseRedirect(reverse("admin:index", current_app=self.name))
        request.current_app = self.name
        context = {
            **self.each_context(request),
            "title": "Database admin",
            **(extra_context or {}),
        }
        return TemplateResponse(request, "finance/admin_login.html", context)


class CashmoneyAdminConfig(AdminConfig):
    """Takes the place of django.contrib.admin in INSTALLED_APPS."""

    default_site = "finance.admin_site.CashmoneyAdminSite"


def open_admin_session(request):
    """Sign this browser in to the admin as the built-in superuser."""
    signed_in = (
        request.user.get_username() == BUILT_IN_ADMIN_USERNAME
        and request.session.get(ADMIN_SESSION_KEY) == BACKEND_RUN_ID
    )
    user, _created = get_user_model().objects.get_or_create(
        username=BUILT_IN_ADMIN_USERNAME
    )
    user.is_active = user.is_staff = user.is_superuser = True
    # A password set on it in the admin's user pages would open nothing; drop it.
    password_dropped = user.has_usable_password()
    if password_dropped:
        user.set_unusable_password()
    user.save()
    # Signing in again gives the browser a new CSRF token, which would break admin
    # forms that are already open, so only when needed. A dropped password changes
    # the session hash, so that needs it too.
    if password_dropped or not signed_in:
        login(request, user)
        request.session[ADMIN_SESSION_KEY] = BACKEND_RUN_ID
