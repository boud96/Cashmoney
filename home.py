import streamlit as st
from django.conf import settings

from app import app_launcher
from constants import URLConstants
from widgets.edit import (
    edit_tab_widget,
    delete_keyword_tab_widget,
    create_category_tab_widget,
    delete_category_tab_widget,
    create_subcategory_tab_widget,
    delete_subcategory_tab_widget,
    create_bank_account_tab_widget,
    delete_bank_account_tab_widget,
    create_csv_mapping_tab_widget,
    delete_csv_mapping_tab_widget,
    create_tag_tab_widget,
    delete_tag_tab_widget,
)

from widgets.recategorize import recategorize_tab_widget
from widgets.csv_import import import_form_widget
from widgets.filters.bank_account import BankAccountFilter
from widgets.filters.by_owners import RecalculateAmountsByOwnersFilter
from widgets.filters.category import CategoryFilter
from widgets.filters.date import DateFilter
from widgets.filters.tag import TagFilter
from widgets.filters.ignored import ShowIgnoredFilter
from widgets.filters.manager import FilterManager
from widgets.stats.bar_chart import BarChartWidget
from widgets.stats.dataframe import DataFrameWidget
from widgets.stats.category_sunburst import TransactionSunburstWidget
from widgets.stats.wni_sunburst import TransactionWNIWidget
from widgets.stats.overview_stats import OverviewStatsWidget


# TODO: Figure out the reruns for the whole app but keep the tabs etc.
@st.fragment
def manage_keywords_section():
    edit_tab_widget()
    delete_keyword_tab_widget()


@st.fragment
def manage_categories_section():
    create_category_tab_widget()
    delete_category_tab_widget()
    create_subcategory_tab_widget()
    delete_subcategory_tab_widget()


@st.fragment
def manage_bank_accounts_section():
    create_bank_account_tab_widget()
    delete_bank_account_tab_widget()


@st.fragment
def manage_csv_mappings_section():
    create_csv_mapping_tab_widget()
    delete_csv_mapping_tab_widget()


@st.fragment
def manage_tags_section():
    create_tag_tab_widget()
    delete_tag_tab_widget()


def main():
    models = app_launcher.get_models()
    Transaction = models[
        "Transaction"
    ]  # TODO: Refactor as models_transaction introduce in the app object
    Category = models["Category"]
    Subcategory = models["Subcategory"]
    BankAccount = models["BankAccount"]
    Tag = models["Tag"]

    st.set_page_config(page_title="Cashmoney", layout="wide", page_icon="")

    # Initialize the FilterManager
    filter_manager = FilterManager()

    # Add DateFilter
    date_filter = DateFilter()
    filter_manager.add_filter("date", date_filter)

    # Add CategoryFilter
    category_filter = CategoryFilter(Category, label="Select Categories")
    filter_manager.add_filter("category", category_filter)

    # Add SubcategoryFilter
    subcategory_filter = CategoryFilter(Subcategory, label="Select Subcategories")
    filter_manager.add_filter("subcategory", subcategory_filter)

    # Add ShowIgnoredFilter
    show_ignored_filter = ShowIgnoredFilter()
    filter_manager.add_filter("show_ignored", show_ignored_filter)

    # Add RecalculateAmountsByOwnersFilter
    recalculate_by_owners_filter = RecalculateAmountsByOwnersFilter()
    filter_manager.add_filter("recalculate_by_owners", recalculate_by_owners_filter)

    # Add BankAccountFilter
    bank_account_filter = BankAccountFilter(BankAccount, label="Select Bank Accounts")
    filter_manager.add_filter("bank_account", bank_account_filter)

    tag_filter = TagFilter(Tag, label="Select Tags")
    filter_manager.add_filter("tag", tag_filter)

    # Place all widgets in the sidebar
    filter_manager.place_widgets(sidebar=True)

    # Get combined filter params
    filter_params = filter_manager.get_combined_params()
    if settings.DEBUG:
        st.info("Combined Filter Parameters:")
        st.json(filter_params, expanded=False)

    if settings.DEMO_MODE:
        st.warning(
            "This is a read-only demo. "
            f"Check out the full project on [GitHub]({URLConstants.REPO_URL})."
        )
    transactions = Transaction.get_transactions_from_db(filter_params)

    home_tab, recategorize_tab, import_tab, edit_tab = st.tabs(
        ["Home", "Recategorize", "Import", "Edit"]
    )
    with home_tab:
        with st.expander("Overview", expanded=True):
            # Overview Stats
            overview_stats = OverviewStatsWidget(transactions, filter_params)
            overview_stats.place_widget()

        with st.expander("Bar Chart", expanded=True):
            # Bar Chart
            bar_chart = BarChartWidget(transactions, filter_params)
            bar_chart.place_widget()

        with st.expander("Pie Charts", expanded=True):
            # Sun Bursts
            transaction_sunburst = TransactionSunburstWidget(transactions)
            transaction_sunburst.place_widget()

            widget = TransactionWNIWidget(transactions)
            widget.place_widget()

    with recategorize_tab:
        recategorize_tab_widget(transactions)

    with import_tab:
        import_form_widget()

    with edit_tab:
        with st.expander("CSV Mappings"):
            manage_csv_mappings_section()

        with st.expander("Bank Accounts"):
            manage_bank_accounts_section()

        with st.expander("Categories"):
            manage_categories_section()

        with st.expander("Tags"):
            manage_tags_section()

        with st.expander("Keywords"):
            manage_keywords_section()

    with st.expander("Transactions", expanded=True):
        # DataFrame
        transactions_dataframe = DataFrameWidget(transactions)
        transactions_dataframe.place_widget()


if __name__ == "__main__":
    main()
