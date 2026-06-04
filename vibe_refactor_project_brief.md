# Vibe Refactor Project Brief

## Purpose

Rebuild the current finance app from the ground up as a new desktop-first application. The existing app should be used only as a reference for behavior, data modeling ideas, categorization rules, and chart concepts.

The primary user workflow is:

1. Load a bank statement in CSV format.
2. Parse the CSV using a user-defined mapping.
3. Save each parsed row as a transaction.
4. Automatically categorize each transaction using user-defined keyword rules.
5. Review, filter, and analyze transactions through dashboard charts and tables.

## Project Rules

- All new work must live inside a subfolder named `vibe_refactor`.
- Do not modify the original application code.
- The current app may be inspected as a reference, especially:
  - `models.py`
  - existing categorization rules
  - the existing Sunburst-style category/subcategory chart implementation
- The rebuild may make large architectural, UI, and implementation changes.
- This document is a planning reference, not an implementation task.

## Architecture

- Backend: Django
- Database: SQLite
- Desktop shell: Electron, targeting simple Windows desktop use
- Frontend: open choice, selected based on best fit for the new app

The application should be practical to run locally on a Windows machine without requiring the user to manage a complex deployment setup.

## Core Domain Concepts

### Transaction

Represents one parsed bank statement row saved to the database.

Expected transaction data may include:

- Date
- Description / merchant / counterparty text
- Amount
- Income or expense direction
- Bank account
- Category
- Subcategory
- Tags
- Want / Need / Investment classification
- Source CSV import metadata where useful

Only relevant columns should be shown in the main dashboard transaction table.

### CSVMapping

Defines how a specific bank CSV format maps columns into the transaction model.

The user should be able to define and manage mappings for different banks or statement formats.

### BankAccount

Represents one user-defined bank account.

The app should support multiple bank accounts and allow transactions to be associated with a selected account during import.

### Category And Subcategory

Users can define custom categories and subcategories.

Transactions may have:

- One category
- One subcategory
- No category or subcategory if uncategorized

Category and subcategory structures should support dashboard breakdowns for income and expense analysis.

### Tags

Users can define custom tags.

Transactions may have:

- Multiple tags
- No tags

### Keywords

Users can define keyword-based categorization rules.

Example:

- If transaction text contains `McDonnalds`, assign:
  - Category: `Food`
  - Subcategory: `Restaurant`

Keyword rules should also be able to assign a Want / Need / Investment value.

### Want / Need / Investment

Each transaction should support classification as one of:

- Want
- Need
- Investment

This classification should be assigned automatically from keyword rules where possible, and should be filterable in the dashboard.

## Required Features

### CSV Import

- User can select or upload a CSV bank statement.
- User selects the BankAccount associated with the import.
- User selects or defines a CSVMapping for the file format.
- App parses the CSV.
- Parsed transactions are saved to the Transaction table.
- Categorization keywords are applied automatically during import.

### Automatic Categorization

- Match transaction text against user-defined keyword strings.
- Assign matching category and subcategory.
- Assign matching Want / Need / Investment classification.
- Support uncategorized transactions when no keyword matches.

### Management Pages

The app should provide interfaces for defining and editing:

- BankAccounts
- CSVMappings
- Categories
- Subcategories
- Tags
- Keywords

## Layout And Pages

The app should have multiple pages or tabs. Exact implementation is open.

### Dashboard Page

The main page should include:

- Monthly bar chart
- Pie chart for incomes
- Pie chart for expenses
- Pie chart for Want / Need / Investment distribution
- Transaction table with relevant columns
- Filters

Income and expense charts should use category slices, with subcategory breakdowns inspired by the former app's Sunburst implementation.

Dashboard filters should include:

- Date range
- Categories
- Subcategories
- Want / Need / Investment classification
- Bank accounts
- Tags

### CSV Import Page

Page for importing CSV files and selecting the relevant account and mapping.

### Definitions / Settings Page

Page for defining and maintaining:

- BankAccounts
- CSVMappings
- Categories
- Subcategories
- Tags
- Keywords

## Future Implementation Notes

- Start future implementation in `vibe_refactor`.
- Treat the existing app as read-only reference material.
- Before designing final models, inspect the old app's model and categorization implementation.
- Before designing charts, inspect the old Sunburst implementation for useful behavior and data-shaping ideas.
- Prefer a clean, maintainable rewrite over preserving old implementation details.
