from django.contrib import admin

from .models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    ExchangeRate,
    FinanceSettings,
    InternalTransferMatch,
    Keyword,
    SavedFilter,
    Subcategory,
    Tag,
    Transaction,
    TransactionTag,
)
from .services import unmatch_internal_transfer


class TransactionTagInline(admin.TabularInline):
    model = TransactionTag
    extra = 0


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        "transaction_date",
        "description",
        "amount",
        "currency",
        "direction",
        "bank_account",
        "category_name",
        "subcategory",
        "want_need_investment",
        "is_ignored",
        "is_categorization_locked",
    )
    list_filter = (
        "direction",
        "want_need_investment",
        "is_ignored",
        "is_categorization_locked",
        "bank_account",
        "subcategory__category",
        "subcategory",
        "tags",
    )
    search_fields = (
        "description",
        "counterparty_name",
        "counterparty_account_number",
        "original_id",
    )
    date_hierarchy = "transaction_date"
    inlines = [TransactionTagInline]
    # Each row shows its account and its subcategory with the category's name; without
    # this, the list ran about three queries per row (CR-51).
    list_select_related = ("bank_account", "subcategory__category")

    @admin.display(description="Category")
    def category_name(self, obj):
        return obj.subcategory.category.name if obj.subcategory else ""


@admin.register(InternalTransferMatch)
class InternalTransferMatchAdmin(admin.ModelAdmin):
    list_display = (
        "outgoing_transaction",
        "incoming_transaction",
        "confidence_score",
        "date_delta_days",
        "created_at",
    )
    search_fields = (
        "outgoing_transaction__description",
        "incoming_transaction__description",
    )
    readonly_fields = ("match_reasons",)
    list_select_related = ("outgoing_transaction", "incoming_transaction")

    # Deleting a match must undo what applying it changed, like Unmatch in the app. A
    # plain delete left both transactions ignored and locked (CR-51).
    def delete_model(self, request, obj):
        unmatch_internal_transfer(obj)

    def delete_queryset(self, request, queryset):
        for match in queryset.select_related(
            "outgoing_transaction", "incoming_transaction"
        ):
            unmatch_internal_transfer(match)


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ("name", "account_number", "bank_name", "currency", "owners")
    search_fields = ("name", "account_number", "bank_name")


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "description")
    search_fields = ("name",)


@admin.register(Subcategory)
class SubcategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "description")
    list_filter = ("category",)
    search_fields = ("name", "category__name")
    list_select_related = ("category",)


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "description")
    search_fields = ("name",)


@admin.register(Keyword)
class KeywordAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "category_name",
        "subcategory",
        "want_need_investment",
        "priority",
        "is_active",
        "is_ignored",
    )
    list_filter = (
        "is_active",
        "is_ignored",
        "want_need_investment",
        "subcategory__category",
        "subcategory",
    )
    search_fields = ("name",)
    filter_horizontal = ("tags",)
    list_select_related = ("subcategory__category",)

    @admin.display(description="Category")
    def category_name(self, obj):
        return obj.subcategory.category.name if obj.subcategory else ""


@admin.register(CSVMapping)
class CSVMappingAdmin(admin.ModelAdmin):
    list_display = ("name", "delimiter", "encoding", "header_row", "default_currency")
    search_fields = ("name",)


@admin.register(CSVImport)
class CSVImportAdmin(admin.ModelAdmin):
    list_display = (
        "source_filename",
        "bank_account",
        "csv_mapping",
        "status",
        "created_count",
        "skipped_count",
        "error_count",
        "created_at",
    )
    list_filter = ("status", "bank_account", "csv_mapping")
    list_select_related = ("bank_account", "csv_mapping")


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = (
        "date",
        "base_currency",
        "quote_currency",
        "rate",
        "source",
        "fetched_at",
    )
    list_filter = ("source", "base_currency", "quote_currency")
    search_fields = ("base_currency", "quote_currency", "source")
    date_hierarchy = "date"


@admin.register(FinanceSettings)
class FinanceSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "default_currency",
        "ignore_internal_account_references",
        "internal_transfer_subcategory",
        "updated_at",
    )


@admin.register(SavedFilter)
class SavedFilterAdmin(admin.ModelAdmin):
    list_display = ("name", "updated_at")
    search_fields = ("name",)
