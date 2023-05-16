# TODO: Make sidebar items collapsible. Maybe even home page items.
# TODO: Fix the session state issue with the date_from.
# TODO: Make an export settings button that exports the accounts, banks, categories. Also import settings.
# TODO: Make reset to factory settings button in the settings.
# TODO: Settings for default currency and for each account. Figure out how to load the conversion rates
#  (for historical transactions they might differ greatly).

from my_scripts.Cashflow import Cashflow
from my_scripts.Account import AccountManager
from my_scripts import aggrid_stuff
from utils.checks import general_checks
from utils.example_setup import example_setup
from settings.constants import ALL_ACCOUNTS_FILTER

import layouts.sidebar as my_sidebar

import streamlit as st
import datetime
from st_aggrid import AgGrid, JsCode, GridOptionsBuilder, ColumnsAutoSizeMode

from utils.page_config import default_page_config


def change_date_sidebar_beginning():
    st.session_state.date_from = first_date
    st.session_state.date_to = datetime.date.today()


def change_date_sidebar_this_month():
    st.session_state.date_from = datetime.date.today().replace(day=1)
    st.session_state.date_to = datetime.date.today()


def change_date_sidebar_this_year():
    st.session_state.date_from = datetime.date.today().replace(day=1, month=1)
    st.session_state.date_to = datetime.date.today()


# ---PAGE CONFIG---
st.set_page_config(**default_page_config)

# ---PAGE BODY---
st.info("This is a DEMO. Uploading and manipulation of the data is not possible. Get the full version at https://github.com/boud96/Cashmoney")
st.title("Cashmoney")
st.markdown("######")

# ---CHECK FOR CORRECT SETUP---
ctgs_check, accs_check, banks_check = general_checks()
if not ctgs_check or not accs_check or not banks_check:
    st.text("Welcome to Cashmoney!")
    st.text("To get started you should set up at least one account, define some categories and at provide a csv bank "
            "statement with at least one transaction.")
    st.text("You can define these in the sidebar on the left, or click this button to set up an example account and "
            "few categories. You can delete/change these later.")

    template_butt = st.button("Set up from templates")
    if template_butt:
        st.write("Creating example account and categories...")
        example_setup()
        st.experimental_rerun()

    if not ctgs_check:
        st.warning("You need to define at least one category to use Cashmoney.")
    if not banks_check:
        st.warning("You need to define at least one bank to use Cashmoney.")
    if not accs_check:
        st.warning("You have no accounts set up yet. Please set up at least one account.")
    st.stop()

# --- INITIALIZE DF AND LOAD ITS FIRST DATE
cashflow = Cashflow()
acc_dict = cashflow.get_acc_dict()
cashflow_df = cashflow.get_df()

account_manager = AccountManager()

first_date = cashflow_df.index[-1].to_pydatetime()

# ---SIDEBAR---
# Account filter
selected_account, account_list = my_sidebar.account_filter(acc_dict)
acc_nums = []
account_transfers_checkbox = False
for acc in acc_dict:
    acc_nums.append(acc_dict[acc]["account_number"])
if selected_account == ALL_ACCOUNTS_FILTER:
    omitted_account_transfers = acc_nums
else:
    account_list = selected_account
    omitted_account_transfers = []
    account_transfers_checkbox = my_sidebar.account_transfers_filter()

owners_checkbox = my_sidebar.recalculate_by_owners()
if owners_checkbox:
    cashflow_df = cashflow.df.apply(cashflow.recalculate_by_owners, axis=1)

# Date filters
date_from, date_to = my_sidebar.date_filter(first_date)
col_1, col_2, col_3 = st.sidebar.columns(3)
with col_1:
    st.button("All", on_click=change_date_sidebar_beginning, key="butt_from_beginning")
with col_2:
    st.button("Month", on_click=change_date_sidebar_this_month, key="butt_this_month")
with col_3:
    st.button("Year", on_click=change_date_sidebar_this_year, key="butt_this_year")

st.sidebar.divider()

# Income filter
check_income, check_expense = my_sidebar.income_filter()

st.sidebar.divider()

# Category filters
main_category, subcategory, wni = my_sidebar.category_filters(include_account_transfer=account_transfers_checkbox)

# ---QUERY AND STUFF---
# Omit unimportant columns
cashflow_df = cashflow_df[
    [
        "account_id",
        "value",
        "main_category",
        "subcategory",
        "wni",
        "note_1",
        "note_2",
        "income",
        "account",
        "counterparty_account_id",
        "sys_note",
        "acc_note",
    ]
]

# Query
cashflow_df = cashflow_df.query(
    "counterparty_account_id != @omitted_account_transfers &"
    "account_id == @account_list & "
    "main_category == @main_category & "
    "subcategory == @subcategory & "
    "wni == @wni & "
    "(income == @check_income |"
    "income != @check_expense )&"
    "date >= @date_from & "
    "date <= @date_to"
)

if len(cashflow_df) == 0:
    st.warning("No transactions found for the selected filters.")
    st.stop()

# ---PAGE BODY--- cont.
# Basic statistics
st.header("Basic stats")
stats = cashflow.basic_stats(cashflow_df)
stats_sums = stats.get("stats")
stats_monthly = stats.get("monthly")

available_balance = 0
# Available balance
if selected_account == ALL_ACCOUNTS_FILTER:
    for acc in acc_dict:
        acc_balance = acc_dict[acc][account_manager.balance]
        acc_balance += acc_dict[acc][account_manager.delta]
        if owners_checkbox:
            acc_balance = acc_balance / acc_dict[acc][account_manager.owners]
        available_balance += acc_balance
else:
    available_balance = acc_dict[selected_account][account_manager.balance] + \
                        acc_dict[selected_account][account_manager.delta]
    if owners_checkbox:
        available_balance = available_balance / acc_dict[selected_account][account_manager.owners]
available_balance = int(available_balance)

# Sums
expenses_sum = stats_sums.get("expenses")
incomes_sum = stats_sums.get("incomes")
net_sum = stats_sums.get("net")

# Monthly averages
cashflow_expenses, cashflow_incomes = cashflow.filter_incomes(cashflow_df)
if len(cashflow_expenses) > 0:
    monthly_avg_expenses = int(cashflow_expenses.resample("MS").sum().mean()[cashflow.value])
else:
    monthly_avg_expenses = 0
if len(cashflow_incomes) > 0:
    monthly_avg_incomes = int(cashflow_incomes.resample("MS").sum().mean()[cashflow.value])
else:
    monthly_avg_incomes = 0
monthly_avg_net = monthly_avg_incomes + monthly_avg_expenses

# Visualize
st.subheader("Available balance")
st.subheader(":black_heart:" + f"{available_balance:,}".replace(",", " "))

col_1, col_2, col_3 = st.columns(3)
with col_1:
    st.subheader("Sum of expenses:")
    st.subheader(":heart:" + f"{expenses_sum:,}".replace(",", " "))
    st.metric(label="Monthly averages:", value="", delta=monthly_avg_expenses)
with col_2:
    st.subheader("Sum of incomes:")
    st.subheader(":green_heart:" + f"{incomes_sum:,}".replace(",", " "))
    st.metric(label="Sum of incomes", value="", delta=monthly_avg_incomes, label_visibility="hidden")
with col_3:
    st.subheader(f"Net value:")
    st.subheader(":blue_heart:" + f"{net_sum:,}".replace(",", " "))
    st.metric(label="Net value", value="", delta=monthly_avg_net, label_visibility="hidden")

# --- Plots ---
tab_1, tab_2 = st.tabs(("Monthly bars", "Cumulative lines"))
# Bar chart
with tab_1:
    st.header(f"Monthly bar chart")
    monthly_expenses_bars = cashflow.plot_bars(df=cashflow.df_inc_exp_net, y_axis=cashflow.value, plot_vlines=True)
    st.plotly_chart(monthly_expenses_bars, use_container_width=True)
# Line chart for last 3 months
with tab_2:
    st.header("Cumulative sums for the past three months")
    last_q_lines = cashflow.plot_last_q(cashflow_df)
    st.plotly_chart(last_q_lines, use_container_width=True)

st.divider()

# Pies
# WNI pie
st.header("WNI Pie")
wni_pie = cashflow.plot_wni_pie(exclude="account_transfer")
st.plotly_chart(wni_pie, use_container_width=True)

st.divider()

# Incomes/Expenses by category pies
st.header("Categories pies")
pie_expenses, pie_incomes = st.columns(2)
with pie_expenses:
    st.subheader("Expenses")
    categories_pie_expenses = cashflow.plot_categories_pies(df=cashflow_df, expenses=True)
    st.plotly_chart(categories_pie_expenses, use_container_width=True)
with pie_incomes:
    st.subheader("Incomes")
    categories_pie_incomes = cashflow.plot_categories_pies(df=cashflow_df, expenses=False)
    st.plotly_chart(categories_pie_incomes, use_container_width=True)

st.divider()

# --- TABLE ---
display_df = cashflow_df.reset_index()
gb = GridOptionsBuilder.from_dataframe(display_df)
gb.configure_default_column(editable=False, cellStyle=aggrid_stuff.unassigned_highlight, autosize=True)
gb.configure_column("date", type=["dateColumnFilter", "customDateTimeFormat"], custom_format_string='dd / MM / yyyy',
                    header_name="Date", width=110)
gb.configure_column("account_id", cellStyle=aggrid_stuff.highlight_accounts(acc_dict), header_name="Account")
gb.configure_column("value", header_name="Value", type=["numericColumn", "numberColumnFilter", "customNumericFormat"],
                    precision=2, width=100, cellStyle=aggrid_stuff.income_highlight)
gb.configure_column("main_category", header_name="Main category")
gb.configure_column("subcategory", header_name="Subcategory")
gb.configure_column("wni", header_name="Want / Need / Invest")
gb.configure_column("note_1", header_name="Note")
gb.configure_column("note_2", header_name="Additional note")
gb.configure_column("ID", hide=True)
gb.configure_column("account", hide=True, header_name="Account")
gb.configure_column("counterparty_account_id", hide=True, header_name="Counterparty account ID")
gb.configure_column("sys_note", hide=True, header_name="System note")
gb.configure_column("acc_note", hide=True, header_name="Account note")
gb.configure_column("income", hide=True, header_name="Income")

gridOptions = gb.build()

aggrid_height = None
if len(cashflow_df) > 10:
    aggrid_height = 500

st.header("The data")
grid_response = AgGrid(
    display_df,
    gridOptions=gridOptions,
    width='100%',
    height=aggrid_height,
    fit_columns_on_grid_load=True,
    allow_unsafe_jscode=True,
)

