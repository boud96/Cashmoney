import uuid
from django.core.validators import RegexValidator
from django.db import models
from django.db.models import Q

from .constants import DEFAULT_CATEGORIZATION_FIELDS, Direction, WantNeedInvestment


HEX_COLOR_VALIDATOR = RegexValidator(
    regex=r"^#[0-9A-Fa-f]{6}$",
    message="Color must be a hex value like #1A2B3C.",
)


def empty_dict():
    return {}


def empty_list():
    return []


def default_categorization_fields():
    return list(DEFAULT_CATEGORIZATION_FIELDS)


def generate_hex_color():
    return f"#{uuid.uuid4().hex[:6].upper()}"


def normalize_hex_color(value):
    return str(value or "").strip().upper()


def prepare_hex_color(value):
    color = normalize_hex_color(value)
    if not color:
        color = generate_hex_color()
    HEX_COLOR_VALIDATOR(color)
    return color


class TimestampedModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class FinanceSettings(TimestampedModel):
    singleton_key = models.PositiveSmallIntegerField(
        default=1, unique=True, editable=False
    )
    ignore_internal_account_references = models.BooleanField(
        default=True,
        help_text=(
            "Automatically ignore transactions whose categorization text mentions "
            "another configured bank account number."
        ),
    )
    internal_transfer_subcategory = models.ForeignKey(
        "Subcategory",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
        help_text=(
            "Optional subcategory assigned when a transaction mentions another "
            "configured bank account number."
        ),
    )

    class Meta:
        verbose_name_plural = "finance settings"

    def __str__(self):
        return "Finance settings"

    @classmethod
    def load(cls):
        settings, _created = cls.objects.select_related(
            "internal_transfer_subcategory"
        ).get_or_create(singleton_key=1)
        return settings


class CSVMapping(TimestampedModel):
    name = models.CharField(max_length=128, unique=True)
    description = models.TextField(blank=True)
    delimiter = models.CharField(max_length=8, default=",")
    quotechar = models.CharField(max_length=1, default='"')
    encoding = models.CharField(max_length=64, default="utf-8-sig")
    header_row = models.PositiveIntegerField(default=0)
    date_format = models.CharField(max_length=64, default="%Y-%m-%d")
    fallback_date_formats = models.JSONField(default=empty_list, blank=True)
    decimal_separator = models.CharField(max_length=1, default=".")
    thousands_separator = models.CharField(max_length=4, blank=True, default="")
    default_currency = models.CharField(max_length=3, default="CZK")
    column_map = models.JSONField(default=empty_dict, blank=True)
    categorization_fields = models.JSONField(
        default=default_categorization_fields,
        blank=True,
        help_text="Logical transaction fields used to build the keyword matching text.",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def get_column(self, logical_field):
        return self.column_map.get(logical_field)

    def get_categorization_fields(self):
        if isinstance(self.categorization_fields, list):
            return self.categorization_fields
        return default_categorization_fields()


class BankAccount(TimestampedModel):
    name = models.CharField(max_length=128)
    account_number = models.CharField(max_length=128, unique=True)
    bank_name = models.CharField(max_length=128, blank=True)
    currency = models.CharField(max_length=3, default="CZK")
    owners = models.PositiveIntegerField(default=1)
    default_csv_mapping = models.ForeignKey(
        CSVMapping,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="bank_accounts",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Category(TimestampedModel):
    name = models.CharField(max_length=128, unique=True)
    description = models.TextField(blank=True)
    color = models.CharField(
        max_length=7,
        blank=True,
        validators=[HEX_COLOR_VALIDATOR],
        help_text="Hex color in #RRGGBB format. Generated automatically if blank.",
    )

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.color = prepare_hex_color(self.color)
        super().save(*args, **kwargs)


class Subcategory(TimestampedModel):
    category = models.ForeignKey(
        Category, on_delete=models.CASCADE, related_name="subcategories"
    )
    name = models.CharField(max_length=128)
    description = models.TextField(blank=True)
    color = models.CharField(
        max_length=7,
        blank=True,
        validators=[HEX_COLOR_VALIDATOR],
        help_text="Hex color in #RRGGBB format. Generated automatically if blank.",
    )

    class Meta:
        ordering = ["category__name", "name"]
        verbose_name_plural = "subcategories"
        constraints = [
            models.UniqueConstraint(
                fields=["category", "name"], name="unique_subcategory_per_category"
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.category.name})"

    def save(self, *args, **kwargs):
        self.color = prepare_hex_color(self.color)
        super().save(*args, **kwargs)


class Tag(TimestampedModel):
    name = models.CharField(max_length=128, unique=True)
    description = models.TextField(blank=True)
    color = models.CharField(
        max_length=7,
        blank=True,
        validators=[HEX_COLOR_VALIDATOR],
        help_text="Hex color in #RRGGBB format. Generated automatically if blank.",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.color = prepare_hex_color(self.color)
        super().save(*args, **kwargs)


class SavedFilter(TimestampedModel):
    name = models.CharField(max_length=128, unique=True)
    filters = models.JSONField(default=empty_dict, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CSVImport(TimestampedModel):
    STATUS_STARTED = "started"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = [
        (STATUS_STARTED, "Started"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_FAILED, "Failed"),
    ]

    source_filename = models.CharField(max_length=255, blank=True)
    bank_account = models.ForeignKey(
        BankAccount, on_delete=models.SET_NULL, null=True, blank=True
    )
    csv_mapping = models.ForeignKey(
        CSVMapping, on_delete=models.SET_NULL, null=True, blank=True
    )
    status = models.CharField(
        max_length=32, choices=STATUS_CHOICES, default=STATUS_STARTED
    )
    loaded_count = models.PositiveIntegerField(default=0)
    created_count = models.PositiveIntegerField(default=0)
    skipped_count = models.PositiveIntegerField(default=0)
    error_count = models.PositiveIntegerField(default=0)
    report = models.JSONField(default=empty_dict, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.source_filename or str(self.id)


class Transaction(TimestampedModel):
    original_id = models.CharField(max_length=128, blank=True)
    import_batch = models.ForeignKey(
        CSVImport,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    bank_account = models.ForeignKey(
        BankAccount,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    transaction_date = models.DateField()
    posted_date = models.DateField(null=True, blank=True)
    description = models.TextField(blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    currency = models.CharField(max_length=3, default="CZK")
    direction = models.CharField(
        max_length=16, choices=Direction.CHOICES, editable=False
    )
    counterparty_account_number = models.CharField(max_length=128, blank=True)
    counterparty_name = models.CharField(max_length=255, blank=True)
    transaction_type = models.CharField(max_length=128, blank=True)
    variable_symbol = models.CharField(max_length=128, blank=True)
    specific_symbol = models.CharField(max_length=128, blank=True)
    constant_symbol = models.CharField(max_length=128, blank=True)
    counterparty_note = models.TextField(blank=True)
    my_note = models.TextField(blank=True)
    other_note = models.TextField(blank=True)
    subcategory = models.ForeignKey(
        Subcategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transactions",
    )
    tags = models.ManyToManyField(Tag, through="TransactionTag", blank=True)
    want_need_investment = models.CharField(
        max_length=32, choices=WantNeedInvestment.CHOICES, null=True, blank=True
    )
    is_ignored = models.BooleanField(default=False)
    raw_data = models.JSONField(default=empty_dict, blank=True)

    class Meta:
        ordering = ["-transaction_date", "-created_at"]
        indexes = [
            models.Index(fields=["transaction_date"]),
            models.Index(fields=["direction"]),
            models.Index(fields=["amount"]),
            models.Index(fields=["bank_account", "transaction_date"]),
            models.Index(fields=["subcategory"]),
            models.Index(fields=["want_need_investment"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["bank_account", "original_id"],
                condition=Q(original_id__isnull=False) & ~Q(original_id=""),
                name="unique_original_transaction_per_account",
            )
        ]

    def save(self, *args, **kwargs):
        self.direction = Direction.INCOME if self.amount >= 0 else Direction.EXPENSE
        super().save(*args, **kwargs)

    def __str__(self):
        return (
            f"{self.transaction_date} {self.amount} {self.currency} {self.description}"
        )


class TransactionTag(TimestampedModel):
    transaction = models.ForeignKey(Transaction, on_delete=models.CASCADE)
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["transaction", "tag"], name="unique_tag_per_transaction"
            )
        ]

    def __str__(self):
        return f"{self.transaction} - {self.tag}"


class Keyword(TimestampedModel):
    name = models.CharField(max_length=128)
    include_terms = models.JSONField(default=empty_list, blank=True)
    exclude_terms = models.JSONField(default=empty_list, blank=True)
    subcategory = models.ForeignKey(
        Subcategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="keywords",
    )
    tags = models.ManyToManyField(Tag, blank=True, related_name="keywords")
    want_need_investment = models.CharField(
        max_length=32, choices=WantNeedInvestment.CHOICES, null=True, blank=True
    )
    is_ignored = models.BooleanField(default=False)
    priority = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-priority", "name"]

    def __str__(self):
        return self.name
