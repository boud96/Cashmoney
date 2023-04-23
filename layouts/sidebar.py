import streamlit as st
import datetime

from my_scripts.Categories import Categories
from settings.constants import ALL_ACCOUNTS_FILTER


def date_filter(first_date):
    st.sidebar.header("Select a Date range:")

    first_date = first_date.date()
    today = datetime.date.today()
    prev_year = today.year - 1
    prev_year_beginning = datetime.date(year=prev_year, month=1, day=1)
    if first_date < prev_year_beginning:
        first_date = prev_year_beginning
    if "date_from" not in st.session_state:
        st.session_state.date_from = first_date
    date_from = st.sidebar.date_input("From", value=st.session_state.date_from, key="date_from")
    date_to = st.sidebar.date_input("To", value=datetime.date.today(), key="date_to")
    return date_from, date_to


def income_filter():
    st.sidebar.header("Include incomes and/or expenses:")
    check_income = st.sidebar.checkbox("Incomes", value=True)
    check_expense = st.sidebar.checkbox("Expenses", value=True)
    return check_income, check_expense


def category_filters():
    c = Categories()
    main_category_list = c.get_categories()
    subcategory_list = c.get_subcategories()
    wni_list = c.get_categories_wni()

    st.sidebar.header("Main category:")
    main_category = st.sidebar.multiselect(
        "Select a category:", key="main_category_multiselect", options=main_category_list, default=main_category_list
    )

    st.sidebar.header("Subcategory:")
    subcategory = st.sidebar.multiselect(
        "Select a category:", key="subcategory_multiselect", options=subcategory_list, default=subcategory_list
    )

    st.sidebar.header("Wants / needs / investments:")
    wni = st.sidebar.multiselect("Select a category:", key="wni_multiselect", options=wni_list, default=wni_list)
    return main_category, subcategory, wni


def account_filter(accounts_dict):
    st.sidebar.header("Account:")
    accounts_list = list(accounts_dict)
    accounts_list.insert(0, ALL_ACCOUNTS_FILTER)
    account = st.sidebar.selectbox(
        "Select an account:",
        options=accounts_list,
    )
    return account, accounts_list


def recalculate_by_owners():
    owners_num_recalc = st.sidebar.checkbox(
        "Recalculate by owners",
        value=True,
        key="recalc_owners",
        help="Divide the transaction values by the number of owners of the account - "
        "Recalculated for personal spending",
    )
    return owners_num_recalc
