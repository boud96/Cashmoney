from django.urls import path

from . import views


urlpatterns = [
    path("health/", views.HealthView.as_view(), name="health"),
    path("settings/", views.FinanceSettingsView.as_view(), name="finance-settings"),
    path(
        "exchange-rates/status/",
        views.ExchangeRateStatusView.as_view(),
        name="exchange-rate-status",
    ),
    path(
        "exchange-rates/currencies/",
        views.ExchangeRateCurrenciesView.as_view(),
        name="exchange-rate-currencies",
    ),
    path(
        "exchange-rates/sync/",
        views.ExchangeRateSyncView.as_view(),
        name="exchange-rate-sync",
    ),
    path(
        "saved-filters/",
        views.SavedFilterCollectionView.as_view(),
        name="saved-filters",
    ),
    path(
        "saved-filters/<uuid:pk>/",
        views.SavedFilterDetailView.as_view(),
        name="saved-filter-detail",
    ),
    path(
        "bank-accounts/",
        views.BankAccountCollectionView.as_view(),
        name="bank-accounts",
    ),
    path(
        "bank-accounts/<uuid:pk>/",
        views.BankAccountDetailView.as_view(),
        name="bank-account-detail",
    ),
    path(
        "csv-mappings/", views.CSVMappingCollectionView.as_view(), name="csv-mappings"
    ),
    path(
        "csv-mappings/detect-columns/",
        views.CSVMappingColumnDetectionView.as_view(),
        name="csv-mapping-detect-columns",
    ),
    path(
        "csv-mappings/<uuid:pk>/",
        views.CSVMappingDetailView.as_view(),
        name="csv-mapping-detail",
    ),
    path("categories/", views.CategoryCollectionView.as_view(), name="categories"),
    path(
        "categories/<uuid:pk>/",
        views.CategoryDetailView.as_view(),
        name="category-detail",
    ),
    path(
        "subcategories/",
        views.SubcategoryCollectionView.as_view(),
        name="subcategories",
    ),
    path(
        "subcategories/<uuid:pk>/",
        views.SubcategoryDetailView.as_view(),
        name="subcategory-detail",
    ),
    path("tags/", views.TagCollectionView.as_view(), name="tags"),
    path("tags/<uuid:pk>/", views.TagDetailView.as_view(), name="tag-detail"),
    path("keywords/", views.KeywordCollectionView.as_view(), name="keywords"),
    path(
        "keywords/preview/", views.KeywordPreviewView.as_view(), name="keyword-preview"
    ),
    path(
        "keywords/<uuid:pk>/", views.KeywordDetailView.as_view(), name="keyword-detail"
    ),
    path(
        "transactions/", views.TransactionCollectionView.as_view(), name="transactions"
    ),
    path(
        "transactions/filter-metadata/",
        views.TransactionFilterMetadataView.as_view(),
        name="transaction-filter-metadata",
    ),
    path(
        "transactions/bulk-assign/",
        views.BulkAssignTransactionsView.as_view(),
        name="bulk-assign-transactions",
    ),
    path(
        "transactions/<uuid:pk>/",
        views.TransactionDetailView.as_view(),
        name="transaction-detail",
    ),
    path(
        "transactions/recategorize/",
        views.RecategorizeTransactionsView.as_view(),
        name="recategorize-transactions",
    ),
    path("imports/preview/", views.ImportPreviewView.as_view(), name="import-preview"),
    path(
        "imports/", views.ImportTransactionsView.as_view(), name="import-transactions"
    ),
    path(
        "dashboard/summary/",
        views.DashboardSummaryView.as_view(),
        name="dashboard-summary",
    ),
    path(
        "maintenance/summary/",
        views.MaintenanceSummaryView.as_view(),
        name="maintenance-summary",
    ),
    path(
        "maintenance/sample-data/",
        views.MaintenanceSampleDataView.as_view(),
        name="maintenance-sample-data",
    ),
    path(
        "maintenance/sample-data/recreate/",
        views.MaintenanceRecreateSampleDataView.as_view(),
        name="maintenance-recreate-sample-data",
    ),
    path(
        "maintenance/transactions/",
        views.MaintenanceTransactionsView.as_view(),
        name="maintenance-transactions",
    ),
    path(
        "maintenance/finance-data/",
        views.MaintenanceFinanceDataView.as_view(),
        name="maintenance-finance-data",
    ),
    path(
        "maintenance/database-backup/",
        views.MaintenanceDatabaseBackupView.as_view(),
        name="maintenance-database-backup",
    ),
    path(
        "maintenance/database-restore/",
        views.MaintenanceDatabaseRestoreView.as_view(),
        name="maintenance-database-restore",
    ),
]
