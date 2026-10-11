"""URL configuration for the Cashmoney backend."""

from django.contrib import admin
from django.urls import include, path

from finance.views import AppShellView


urlpatterns = [
    path("", AppShellView.as_view(), name="app-shell"),
    path("admin/", admin.site.urls),
    path("api/", include("finance.urls")),
]

# JSON errors for /api/ when DEBUG is off; Django's pages elsewhere.
handler400 = "finance.views.handler400"
handler500 = "finance.views.handler500"
