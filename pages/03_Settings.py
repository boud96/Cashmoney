import streamlit as st
import pandas as pd

from my_scripts.Categories import Categories
from my_scripts.Account import AccountManager
from my_scripts.Bank import BankManager
from my_scripts.Cashflow import Cashflow
from settings.constants import NOT_AVAILABLE

# Init categories
c = Categories()
categories = c.categories
categories_wni = c.categories_wni
# Init banks and accounts
cashflow = Cashflow()
account_dict = cashflow.get_acc_dict()
acc_manager = AccountManager()
bm = BankManager()
bank_types = list(bm.json_data)
bank_types.append("cash")

st.title("Settings")

tab_1, tab_2, tab_3, tab_4 = st.tabs(("Categories", "Banks", "Accounts", "Import / Export"))
# New category
with tab_1:
    add_category_expander = st.expander("Add")
    delete_category_expander = st.expander("Delete")
    defined_categories_expander = st.expander("Overview")
    with add_category_expander:
        st.subheader("Add a new category")
        new_cat = st.text_input("New category:")

        new_cat_dict = {new_cat: {}}

        new_cat_add_butt = st.button("ADD", key="cat_add")
        if new_cat_add_butt:
            c.add_category(categories, new_cat_dict)
        st.markdown("---")

        # New subcategory
        st.subheader("Add a new subcategory")
        new_sub = st.text_input("New subcategory")
        cat_select = st.selectbox("To which category?", options=categories)

        new_sub_add_butt = st.button("ADD", key="sub_add")
        if new_sub_add_butt:
            c.add_subcategory(categories, cat_select, new_sub)
        st.markdown("---")

        # Assign string values
        st.subheader("Define text values to categorize with")
        new_str = st.text_input("New string")
        cat_select_str = st.selectbox("To which category?", options=categories, key="cat_select_string")
        sub_select_str = st.selectbox("To which subcategory?", options=categories[cat_select_str])
        wni_select_str = st.selectbox("Is this always a Want / Need / Investment / Icnome / UNNASSIGNED", options=categories_wni)

        new_str_add_butt = st.button("ADD", key="str_add")
        if new_str_add_butt:
            c.add_str(categories, cat_select_str, sub_select_str, new_str, wni_select_str)

    with delete_category_expander:
        st.subheader("Delete a category")

        delete_action = st.selectbox("What do you want to remove?", options=("Category", "Subcategory", "Text value"))
        placeholder = st.empty()
        if delete_action == "Category":
            cat_select_del = st.selectbox("Which category?", options=categories)
        elif delete_action == "Subcategory":
            cat_select_del = st.selectbox("From which category?", options=categories)
            sub_select_del = st.selectbox("Which subcategory?", options=categories[cat_select_del])
        if delete_action == "Text value":
            cat_select_del = st.selectbox("From which category?", options=categories)
            sub_select_del = st.selectbox("Which subcategory?", options=categories[cat_select_del])
            str_select_del = st.selectbox("Which subcategory?", options=categories[cat_select_del][sub_select_del])

        del_butt = st.button("DELETE")
        if del_butt and (delete_action == "Category"):
            c.delete_category(categories, cat_select_del)
        elif del_butt and (delete_action == "Subcategory"):
            c.delete_subcategory(categories, cat_select_del, sub_select_del)
        elif del_butt and (delete_action == "Text value"):
            c.delete_text_value(categories, cat_select_del, sub_select_del, str_select_del)

    with defined_categories_expander:
        st.write(categories)

with tab_2:
    add_bank_expander = st.expander("Add")
    delete_bank_expander = st.expander("Delete")
    defined_banks_expander = st.expander("Overview")
    with add_bank_expander:

        b_encoding = st.text_input("Encoding:", value="utf-8", help="Encoding of the csv file.")
        b_delimiter = st.text_input("delimiter:", value=";", help="Delimiter of the csv file.")
        b_header = st.number_input("header:", min_value=0, max_value=100, value=0,
                                   help="Sometimes the csv contains few rows that need to be skipped."
                                        "Open the csv file and count rows before column names.")

        b_file = st.file_uploader("Upload csv to load column names:", type="csv")

        b_columns = []
        b_columns_optional = []
        if b_file:
            df = pd.read_csv(b_file, encoding=b_encoding, delimiter=b_delimiter, header=b_header)
            b_columns = list(df.columns)
            b_columns_optional = b_columns.copy()
            b_columns_optional.insert(0, NOT_AVAILABLE)

        b_name = st.text_input("Bank name:", help="Name of the bank.")
        b_date = st.selectbox("Date:", b_columns, help="Date of the transaction.")
        b_value = st.selectbox("Value:", b_columns, help="Value of the transaction.")
        b_transaction_id = st.selectbox("Transaction ID:", b_columns_optional,
                                        help="Unique ID for each transaction. If not available, "
                                             "the ID will be created automatically but may cause problems with duplicates. "
                                             "For example when you make a transaction in one day to "
                                             "the same account with same value.")
        b_counterparty_acc_id = st.selectbox("Counterparty account ID:", b_columns,
                                             help="Account number of the counterparty.")
        b_counterparty_acc_name = st.selectbox("Counterparty account name:", b_columns,
                                               help="Name of the counterparty account.")
        b_sys_note = st.selectbox("System note:", b_columns,
                                  help="System note from the bank. Will be removed in the future.")
        b_acc_note = st.selectbox("Account note:", b_columns,
                                  help="Account note from the bank. Will be removed in the future.")
        b_notes = st.multiselect("Other notes:", b_columns,
                                 help="All columns that contain text that will be used for automatic categorization.")

        if b_transaction_id == NOT_AVAILABLE:  # TODO This is a quick fix, find a better solution.
            b_transaction_id = None

        b_new_data = {
            b_name: {
                bm.encoding: b_encoding,
                bm.delimiter: b_delimiter,
                bm.header: b_header,
                bm.date: b_date,
                bm.value: b_value,
                bm.transaction_id: b_transaction_id,
                bm.counterparty_acc_id: b_counterparty_acc_id,
                bm.counterparty_acc_name: b_counterparty_acc_name,
                bm.sys_note: b_sys_note,
                bm.acc_note: b_acc_note,
                bm.notes: b_notes,
            }
        }

        b_add_butt = st.button("Add", key="add_butt_banks")
        if b_add_butt:
            if b_name in bm.json_data:
                st.error(
                    f"""
                    Bank name: '{b_name}' already exists!  
                    Delete it first or choose a different name.
                    """
                )
            elif len(b_name) < 1:
                st.error(f"The 'Name' must be filled out")
            else:
                bm.add_bank(b_new_data)
                st.success(f"Bank {b_name} was added!")

        st.markdown("---")

    with delete_bank_expander:
        # Delete a bank
        b_del_select = st.selectbox("Bank to delete:", bank_types)
        b_del_button = st.button("Delete", key="del_butt_banks")

        if b_del_button:
            bm.del_bank(b_del_select)

        st.markdown("---")

    with defined_banks_expander:
        # Show the banks
        for bank in bm.json_data:
            b_name_formatted = f":red[{bank}]"
            st.subheader(b_name_formatted)
            st.write(f"**Encoding:** {bm.json_data[bank][bm.encoding]}")
            st.write(f"**Delimiter:** {bm.json_data[bank][bm.delimiter]}")
            st.write(f"**Header:** {bm.json_data[bank][bm.header]}")
            st.write(f"**Columns:**")
            st.caption(f"Date: {bm.json_data[bank][bm.date]}")
            st.caption(f"Value:: {bm.json_data[bank][bm.value]}")
            st.caption(f"Transaction ID: {bm.json_data[bank][bm.transaction_id]}")
            st.caption(f"Counterparty account ID: {bm.json_data[bank][bm.counterparty_acc_id]}")
            st.caption(f"Counterparty account name: {bm.json_data[bank][bm.counterparty_acc_name]}")
            st.caption(f"System note: {bm.json_data[bank][bm.sys_note]}")
            st.caption(f"Account note: {bm.json_data[bank][bm.acc_note]}")
            st.caption(f"Other notes: {bm.json_data[bank][bm.notes]}")


with tab_3:
    add_account_expander = st.expander("Add")
    delete_account_expander = st.expander("Delete")
    defined_accounts_expander = st.expander("Overview")
    # Add an account
    with add_account_expander:
        name_val = st.text_input("Name:")
        color_val = st.color_picker("Color:", "#FFF")
        main_val = st.checkbox("Main account")
        bank_type_val = st.selectbox("Select a bank type:", bank_types)
        note_val = st.text_input("Note:", help="A custom note")
        owners_val = st.slider("How many people share this account?", 1, 10, 1,
                               help="The values get recalculated for your spending on the main page. "
                                    "Eg.: if you have 2 people sharing an account and you spend 1000, "
                                    "the value on the main page will show 500.")
        account_number_val = st.text_input("Account number:",
                                           help="The account number of the bank account. "
                                                "Needed for filtering and identifying transactions "
                                                "between provided accounts. "
                                                "Transactions between accounts with the same account number "
                                                "will be omitted on the main page.")

        name = "name"
        new_data = {
            name_val: {
                acc_manager.main: main_val,
                acc_manager.color: color_val,
                acc_manager.bank_type: bank_type_val,
                acc_manager.note: note_val,
                acc_manager.owners: owners_val,
                acc_manager.account_number: account_number_val,
                acc_manager.df: None,
                acc_manager.balance: 0,
                acc_manager.delta: 0,
            }
        }

        add_butt = st.button("Add", key="add_butt_accounts")
        if add_butt:
            if name_val in acc_manager.json_data:
                st.error(
                    f"""
                Account name: '{name_val}' already exists!  
                Delete it first or choose a different name.
                """
                )
            elif len(name_val) < 1:
                st.error(f"The 'Name' must be filled out")
            elif len(acc_manager.json_data) > 0 and main_val is True:
                st.error(f"There already is a Main account!")
            else:
                acc_manager.add_account(new_data)
                st.success(f"An account {name_val} was added! You may adjust current balance in the "
                           f"Defined accounts expander if the current balance from the home page is off.")

        st.markdown("---")

    with delete_account_expander:
        # Delete an account
        del_select = st.selectbox("Account to delete:", acc_manager.json_data)
        del_button = st.button("Delete")

        if del_button:
            acc_manager.del_account(del_select)

        st.markdown("---")

    with defined_accounts_expander:
        # Show the accounts
        for account in acc_manager.json_data:
            account_name_formatted = f":red[{account}]"
            st.subheader(account_name_formatted)
            st.write(f"{acc_manager.json_data[account][acc_manager.note]}")
            if acc_manager.json_data[account][acc_manager.main]:
                st.write("**MAIN ACCOUNT**")
            st.write(f"**Owners:** {acc_manager.json_data[account][acc_manager.bank_type]}")
            st.write(f"**Owners:** {acc_manager.json_data[account][acc_manager.owners]}")
            st.write(f"**Account number:** {acc_manager.json_data[account][acc_manager.account_number]}")
            st.write(f"**Color:** {acc_manager.json_data[account][acc_manager.color]}")

            acc_balance = acc_manager.json_data[account][acc_manager.balance]
            acc_delta = acc_manager.json_data[account][acc_manager.delta]
            acc_actual_balance = acc_balance + acc_delta
            current_balance = st.number_input("Current balance:",
                                              value=acc_actual_balance,
                                              step=100,
                                              key=account + " current_balance",
                                              help="When the available balance value is off due to accumulated errors, "
                                                   "you can adjust it here.")
            current_balance_save_butt = st.button("Save", key=account + " current_balance_save_butt")
            if current_balance_save_butt:
                new_delta = int(current_balance - acc_balance)
                acc_manager.adjust_account_delta(account, new_delta)
                st.success(f"Available balance for {account} was adjusted.")

    with tab_4:
        st.info("Work in progress. Here you will be able to import and export the settings.")
