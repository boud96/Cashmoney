import datetime

import pandas as pd
import streamlit as st
from st_aggrid import AgGrid, JsCode, GridOptionsBuilder, ColumnsAutoSizeMode

from my_scripts.Cashflow import Cashflow
from my_scripts.parse_csv import parse_csv
from my_scripts.Categories import Categories
from my_scripts.Account import AccountManager
from my_scripts import aggrid_stuff
from settings.constants import CASH
from utils.checks import general_checks
from utils.page_config import default_page_config

cashflow = Cashflow()
df = cashflow.get_df()
acc_dict = cashflow.get_acc_dict()

categories = Categories()
main_categories = categories.get_main_categories()
subcategories = categories.get_subcategories()
wni_categories = categories.get_categories_wni()

display_df = df.copy().reset_index()

display_df = display_df[
    [
        "date",
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
        "ID",
    ]
]


# TODO: Finish
add_data_tab, del_data_tab, edit_data_tab = st.tabs(("Add data", "Delete data", "Edit data"))
with add_data_tab:
    gb = GridOptionsBuilder.from_dataframe(display_df)
    gb.configure_selection(
        selection_mode="multiple",
        use_checkbox=True,
        header_checkbox=True,
        pre_selected_rows=None,
        rowMultiSelectWithClick=False,
        suppressRowDeselection=False,
        suppressRowClickSelection=False,
        groupSelectsChildren=False,
        groupSelectsFiltered=False,
    )

    gb.configure_default_column(editable=False, cellStyle=aggrid_stuff.unassigned_highlight, selectable=True, autosize=True)

    st.write(datetime.datetime.today())

    gb.configure_column('', headerTooltip='Click on Button to add new row', editable=False, filter=False,
                        onCellClicked=aggrid_stuff.get_string_to_add_row('2023-05-20 09:03:50.215411'),
                        cellRenderer=aggrid_stuff.cell_button_add,
                        autoHeight=True, wrapText=True, lockPosition='left', width=60)
    gb.configure_column('Delete', headerTooltip='Click on Button to remove row',
                        editable=False, filter=False,
                        onCellClicked=aggrid_stuff.string_to_delete,
                        cellRenderer=aggrid_stuff.cell_button_delete,
                        autoHeight=True, suppressMovable='true')

    gb.configure_column("date", type=["dateColumnFilter", "customDateTimeFormat"],
                        custom_format_string='dd / MM / yyyy',
                        header_name="Date", width=150)
    gb.configure_column("account_id", cellStyle=aggrid_stuff.highlight_accounts(acc_dict), header_name="Account", editable=True,
                        width=200, cellEditor='agSelectCellEditor')
    gb.configure_column("value", header_name="Value",
                        type=["numericColumn", "numberColumnFilter", "customNumericFormat"],
                        precision=2, width=100, cellStyle=aggrid_stuff.income_highlight, editable=True)
    gb.configure_column("main_category", header_name="Main category", editable=True, cellEditor='agSelectCellEditor',
                        cellEditorParams={'values': main_categories}, width=120)
    gb.configure_column("subcategory", header_name="Subcategory", editable=True, width=120, cellEditor='agSelectCellEditor',
                        cellEditorParams={'values': subcategories})
    gb.configure_column("wni", header_name="Want / Need / Invest", editable=True, cellEditor='agSelectCellEditor',
                        cellEditorParams={'values': wni_categories}, width=120)
    gb.configure_column("note_1", header_name="Note", editable=True)
    gb.configure_column("note_2", header_name="Additional note", editable=True)
    gb.configure_column(cashflow.id, cellStyle=aggrid_stuff.grey_out)
    gb.configure_column("account", header_name="Account", hide=True)
    gb.configure_column("counterparty_account_id", header_name="Counterparty account ID",
                        cellStyle=JsCode("function a() {return {'color': 'grey'}}"), hide=True)
    gb.configure_column("sys_note", header_name="System note", hide=True)
    gb.configure_column("acc_note", header_name="Account note", hide=True)
    gb.configure_column("income", header_name="Income", hide=True)

    gridOptions = gb.build()

    aggrid_height = None
    if len(df) > 10:
        aggrid_height = 500

    grid_response = AgGrid(
        display_df,
        gridOptions=gridOptions,
        width="90%",
        height=aggrid_height,
        fit_columns_on_grid_load=True,
        allow_unsafe_jscode=True,
    )
    selected = pd.DataFrame(grid_response.get("selected_rows"))
    st.dataframe(selected)

# TODO: Now cannot delete last remaining row of account
with del_data_tab:
    gb = GridOptionsBuilder.from_dataframe(display_df)
    gb.configure_selection(
        selection_mode="multiple",
        use_checkbox=True,
        header_checkbox=True,
        pre_selected_rows=None,
        rowMultiSelectWithClick=False,
        suppressRowDeselection=False,
        suppressRowClickSelection=False,
        groupSelectsChildren=False,
        groupSelectsFiltered=False,
    )

    gb.configure_default_column(editable=False, cellStyle=aggrid_stuff.unassigned_highlight, autosize=True)
    gb.configure_column("date", type=["dateColumnFilter", "customDateTimeFormat"],
                        custom_format_string='dd / MM / yyyy',
                        header_name="Date", width=110)
    gb.configure_column("account_id", cellStyle=aggrid_stuff.highlight_accounts(acc_dict), header_name="Account")
    gb.configure_column("value", header_name="Value",
                        type=["numericColumn", "numberColumnFilter", "customNumericFormat"],
                        precision=2, width=100, cellStyle=aggrid_stuff.income_highlight)
    gb.configure_column("main_category", header_name="Main category")
    gb.configure_column("subcategory", header_name="Subcategory")
    gb.configure_column("wni", header_name="Want / Need / Invest")
    gb.configure_column("note_1", header_name="Note")
    gb.configure_column("note_2", header_name="Additional note")
    gb.configure_column(cashflow.id, hide=True)
    gb.configure_column("account", hide=True, header_name="Account")
    gb.configure_column("counterparty_account_id", hide=True, header_name="Counterparty account ID")
    gb.configure_column("sys_note", hide=True, header_name="System note")
    gb.configure_column("acc_note", hide=True, header_name="Account note")
    gb.configure_column("income", hide=True, header_name="Income")

    gridOptions = gb.build()

    aggrid_height = None
    if len(df) > 10:
        aggrid_height = 500

    grid_response = AgGrid(
        display_df,
        gridOptions=gridOptions,
        width="90%",
        height=aggrid_height,
        fit_columns_on_grid_load=True,
        allow_unsafe_jscode=True,
    )
    selected = pd.DataFrame(grid_response.get("selected_rows"))
    st.dataframe(selected)

    if st.button('Delete'):
        selected_ids = list(selected[cashflow.id])
        cashflow.delete_data(selected_ids)
        st.experimental_rerun()
