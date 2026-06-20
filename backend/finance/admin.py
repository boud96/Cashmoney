from django.contrib import admin

from .models import (
    BankAccount,
    CSVImport,
    CSVMapping,
    Category,
    FinanceSettings,
    Keyword,
    SavedFilter,
    Subcategory,
    Tag,
    Transaction,
    TransactionTag,
)


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
    )
    list_filter = (
        "direction",
        "want_need_investment",
        "is_ignored",
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

    @admin.display(description="Category")
    def category_name(self, obj):
        return obj.subcategory.category.name if obj.subcategory else ""


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


@admin.register(FinanceSettings)
class FinanceSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "ignore_internal_account_references",
        "internal_transfer_subcategory",
        "updated_at",
    )


@admin.register(SavedFilter)
class SavedFilterAdmin(admin.ModelAdmin):
    list_display = ("name", "updated_at")
    search_fields = ("name",)
