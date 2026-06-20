"""URL configuration for the Cashmoney backend."""

from django.contrib import admin
from django.urls import include, path

from finance.views import AppShellView


urlpatterns = [
    path("", AppShellView.as_view(), name="app-shell"),
    path("admin/", admin.site.urls),
    path("api/", include("finance.urls")),
]
