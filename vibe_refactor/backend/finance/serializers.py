from decimal import Decimal


def money(value):
    if isinstance(value, Decimal):
        return float(value)
    return value


def iso(value):
    if value is None:
        return None
    return value.isoformat()


def model_ref(obj):
    if not obj:
        return None
    return {"id": str(obj.id), "name": str(obj)}


def transaction_display_amount(transaction, split_by_owners=False):
    amount = transaction.amount
    if not split_by_owners:
        return amount
    owners = getattr(transaction.bank_account, "owners", 1) or 1
    owners = max(int(owners), 1)
    return amount / Decimal(owners)


def serialize_bank_account(account):
    return {
        "id": str(account.id),
        "name": account.name,
        "account_number": account.account_number,
        "bank_name": account.bank_name,
        "currency": account.currency,
        "owners": account.owners,
        "default_csv_mapping": model_ref(account.default_csv_mapping),
        "created_at": iso(account.created_at),
        "updated_at": iso(account.updated_at),
    }


def serialize_csv_mapping(mapping):
    return {
        "id": str(mapping.id),
        "name": mapping.name,
        "description": mapping.description,
        "delimiter": mapping.delimiter,
        "quotechar": mapping.quotechar,
        "encoding": mapping.encoding,
        "header_row": mapping.header_row,
        "date_format": mapping.date_format,
        "fallback_date_formats": mapping.fallback_date_formats,
        "decimal_separator": mapping.decimal_separator,
        "thousands_separator": mapping.thousands_separator,
        "default_currency": mapping.default_currency,
        "column_map": mapping.column_map,
        "categorization_fields": mapping.categorization_fields,
        "created_at": iso(mapping.created_at),
        "updated_at": iso(mapping.updated_at),
    }


def serialize_category(category):
    return {
        "id": str(category.id),
        "name": category.name,
        "description": category.description,
        "color": category.color,
        "created_at": iso(category.created_at),
        "updated_at": iso(category.updated_at),
    }


def serialize_subcategory(subcategory):
    return {
        "id": str(subcategory.id),
        "name": subcategory.name,
        "description": subcategory.description,
        "color": subcategory.color,
        "category": model_ref(subcategory.category),
        "created_at": iso(subcategory.created_at),
        "updated_at": iso(subcategory.updated_at),
    }


def serialize_tag(tag):
    return {
        "id": str(tag.id),
        "name": tag.name,
        "description": tag.description,
        "color": tag.color,
        "created_at": iso(tag.created_at),
        "updated_at": iso(tag.updated_at),
    }


def serialize_keyword(keyword):
    category = keyword.subcategory.category if keyword.subcategory else None
    return {
        "id": str(keyword.id),
        "name": keyword.name,
        "include_terms": keyword.include_terms,
        "exclude_terms": keyword.exclude_terms,
        "category": model_ref(category),
        "subcategory": model_ref(keyword.subcategory),
        "tags": [serialize_tag(tag) for tag in keyword.tags.all()],
        "want_need_investment": keyword.want_need_investment,
        "is_ignored": keyword.is_ignored,
        "priority": keyword.priority,
        "is_active": keyword.is_active,
        "created_at": iso(keyword.created_at),
        "updated_at": iso(keyword.updated_at),
    }


def serialize_transaction(transaction, split_by_owners=False):
    category = transaction.subcategory.category if transaction.subcategory else None
    return {
        "id": str(transaction.id),
        "original_id": transaction.original_id,
        "transaction_date": iso(transaction.transaction_date),
        "posted_date": iso(transaction.posted_date),
        "description": transaction.description,
        "amount": money(transaction_display_amount(transaction, split_by_owners)),
        "currency": transaction.currency,
        "direction": transaction.direction,
        "bank_account": model_ref(transaction.bank_account),
        "counterparty_account_number": transaction.counterparty_account_number,
        "counterparty_name": transaction.counterparty_name,
        "transaction_type": transaction.transaction_type,
        "category": model_ref(category),
        "subcategory": model_ref(transaction.subcategory),
        "tags": [serialize_tag(tag) for tag in transaction.tags.all()],
        "want_need_investment": transaction.want_need_investment,
        "is_ignored": transaction.is_ignored,
        "raw_data": transaction.raw_data,
        "created_at": iso(transaction.created_at),
        "updated_at": iso(transaction.updated_at),
    }


def serialize_csv_import(csv_import):
    return {
        "id": str(csv_import.id),
        "source_filename": csv_import.source_filename,
        "bank_account": model_ref(csv_import.bank_account),
        "csv_mapping": model_ref(csv_import.csv_mapping),
        "status": csv_import.status,
        "loaded_count": csv_import.loaded_count,
        "created_count": csv_import.created_count,
        "skipped_count": csv_import.skipped_count,
        "error_count": csv_import.error_count,
        "report": csv_import.report,
        "created_at": iso(csv_import.created_at),
        "updated_at": iso(csv_import.updated_at),
    }
