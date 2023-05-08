# TODO Functionality to remove a row
# TODO Functionality to Edit data for manual assigning to categories
import streamlit as st
from st_aggrid import AgGrid, JsCode, GridOptionsBuilder, ColumnsAutoSizeMode

from my_scripts.Cashflow import Cashflow
from my_scripts.parse_csv import parse_csv
from my_scripts.Categories import Categories
from my_scripts.Account import AccountManager
from my_scripts import aggrid_stuff
from settings.constants import CASH
from utils.checks import general_checks


ctgs_check, accs_check, banks_check = general_checks()
if not accs_check:
    st.warning("You need to add at least one account in settings first.")
    st.stop()

cashflow = Cashflow()
cashflow_df = cashflow.get_df()

acc_manager = AccountManager()
accs = acc_manager.json_data  # TODO: Remove this and rework below.
acc_dict = cashflow.get_acc_dict()

categories = Categories()

main_cat_selections = categories.main_categories_list
subcat_selections = categories.subcategories_list  # TODO This variable should change based on what is selected in main_category cell next to it
wni_cat_selections = categories.categories_wni_list
acc_selections_add = []
for acc in accs:
    if accs[acc][acc_manager.bank_type] != CASH:
        acc_selections_add.append(acc)
acc_selections_edit = list(accs.keys())

tab_1, tab_2 = st.tabs(("Add data from csv", "Edit data manually"))
with tab_1:
    file = st.file_uploader("Choose a csv file to parse", type="csv")

    acc_names = list(acc_manager.json_data)
    account_select = st.selectbox("Select an account:", acc_selections_add)

    parse_butt = st.button("Parse!")
    if parse_butt:
        added_data = parse_csv(file, account_select)
        st.success(f"{account_select} was updated!")


with tab_2:
    st.info("This is a work in progress and will be replaced. "
            "You should mainly use this for manual category assignment by providing a category name in the "
            "'main_category', 'subcategory' or 'wni' column."
            "You can also add a note in the 'note_1' or note_2 column. "
            "You can also edit the csv files directly in the 'data' folder."
            "Incorrect use might break the app. ")
    cashflow_df = cashflow_df.reset_index()
    editor = st.experimental_data_editor(cashflow_df, key="editor", num_rows="dynamic")

    save_butt = st.button("Save")
    if save_butt:
        for acc in list(acc_dict):
            st.write(acc)

            df_filtered = editor[editor['account_id'] == acc]
            st.dataframe(df_filtered)

            df_filtered.to_csv(f"data/{acc}.csv", index=False)

