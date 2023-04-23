import pandas as pd
import numpy as np
import datetime
import json

from my_scripts.Account import AccountManager
from my_scripts.Cashflow import Cashflow
from my_scripts.Bank import BankManager
from my_scripts.Categories import Categories


def category_filter(df, note_columns_list, counterparty_account_id):
    """
    Assigns categories to df based on string values.
    :param df:                          Df to assign categories to.
    :param note_columns_list:           List of column names where to look for strings.
    :param counterparty_account_id:     Counterparty account id to identify as transactions between accounts.
    :return:                            Categorized df.
    """
    # Load accounts dict
    accounts_dict = Cashflow().accounts_dict

    # Load JSON
    c = Categories()
    data = c.get_categories()

    main_category = "main_category"         # Column name to assign category
    subcategory = "subcategory"             # Column name to assign subcategory
    account_transfer = "account_transfer"   # Main category name identifying acc transfers
    wni = "wni"                             # Column name to assign wni
    # counterparty_account_id               # Column name to identify transactions between accounts
    # note_column_list                      # List of columns the algorithm looks for string values
    # sub_key                               # Category to assign. E.g. - streaming
    # sub_value                             # Strings to look for. E.g - spotify
    # account_number                        # Account number to identify as transactions between accounts

    for cat in data:
        main_values = []
        for sub_key, sub_value in data[cat].items():
            all_keys = set().union(*(d.keys() for d in sub_value))
            all_keys = "|".join(all_keys)
            if len(all_keys) > 1:
                for note in note_columns_list:
                    df[subcategory] = np.where(
                        df[note].str.contains(all_keys), sub_key, df[subcategory]
                    )
                    main_values.append(all_keys)

                    for k, v in [(k, v) for x in sub_value for (k, v) in x.items()]:
                        df[wni] = np.where(
                            df[note].str.contains(k), v, df[wni]
                        )

        for value in main_values:
            for note in note_columns_list:
                df[main_category] = np.where(
                    df[note].str.contains(value), cat, df[main_category]
                )

    acc_names = []
    for acc_name, acc_values in accounts_dict.items():
        acc_num = acc_values["account_number"]
        if len(str(acc_num)) > 1:
            acc_names.append(acc_name)
            df[subcategory] = np.where(
                df[counterparty_account_id].astype(str).str.contains(acc_num), acc_name, df[subcategory]
            )
    for num in acc_names:
        df[main_category] = np.where(
            df[subcategory].str.contains(num), account_transfer, df[main_category]
        )

    return df


def df_merger(base_df, insert_df, date_col, id_col):
    """
    Merge two dfs and remove duplicates
    :param base_df:             Df to merge with
    :param insert_df:           Df to merge
    :param date_col:            Date column to use as datetime and sort by.
    :param id_col:              ID column to identify duplicates in.
    :return:                    Merged df.
    """
    cashflow = Cashflow()
    # load base df
    if type(base_df.index) != pd.DatetimeIndex:
        base_df[cashflow.date] = pd.to_datetime(base_df[cashflow.date], dayfirst=True)
        base_df = base_df.set_index(cashflow.date)

    # Create column of origin to split by later
    insert_df_id = "insert_df"
    insert_df["origin"] = insert_df_id
    base_df_id = "base_df"
    base_df["origin"] = base_df_id
    # Concatenate them and identify duplicates
    df_duplicates = pd.concat([base_df, insert_df]).sort_values(
        by=[cashflow.date], ascending=[False]
    )
    # Stringify id_col for safety
    df_duplicates[id_col] = df_duplicates[id_col].astype("str")
    df_duplicates["bool_duplicates"] = df_duplicates[id_col].duplicated(keep=False)
    df_removed_duplicates = df_duplicates.loc[df_duplicates["bool_duplicates"] == False]
    df_removed_duplicates = df_removed_duplicates.loc[
        df_removed_duplicates["origin"] == insert_df_id
    ]
    # Concatenate with df and remove duplicates altogether
    df = (
        pd.concat([base_df, df_removed_duplicates])
        .sort_values(by=[cashflow.date], ascending=[False])
        .drop(columns=["origin", "bool_duplicates"])
    )

    # TODO Check for duplicates when payment goes through and ID changes. Remove them.

    return df


def parse_csv(data, account_id):
    """
    Parses a kb csv file, assigns categories, merges with kb master file.
    Uses other methods present above.
    :param data:        path to csv file to parse
    :param account_id:  Account ID from accounts.json.
    :param bank:        Bank from banks.json.
    :return:
    """
    # Load account class
    am = AccountManager()
    acc = am.json_data[account_id]
    bank_type = acc["bank_type"]

    # Load bank class
    bm = BankManager()
    bank = bm.json_data[bank_type]

    # Parse variables
    encoding = bank["encoding"]
    delimiter = bank["delimiter"]
    header = bank["header"]
    # Columns
    date = bank["date"]
    value = bank["value"]  # TODO: Make it possible to select multiple columns. Necessary when there's different currencies, accound fees etc.
    transaction_id = bank["transaction_id"]
    counterparty_acc_id = bank["counterparty_acc_id"]
    counterparty_acc_name = bank["counterparty_acc_name"]
    sys_note = bank["sys_note"]
    acc_note = bank["acc_note"]
    notes = bank["notes"]

    # Load Cashflow class
    cashflow = Cashflow()
    cashflow_date = cashflow.date
    cashflow_id = cashflow.id

    # Load dfs master file
    df = pd.read_csv(data, encoding=encoding, header=header, delimiter=delimiter)
    base_path = f"data/{account_id}.csv"
    df_base = pd.read_csv(base_path)

    # Parsing
    # If there's no transaction id, create one from notes
    if transaction_id is None:
        df[cashflow.id] = (
            df[date].astype("str")
            + " "
            + df[counterparty_acc_id].astype("str")
            + " "
            + df[counterparty_acc_name].astype("str")
            + " "
            + df[value].astype("str")
        )
        for note in notes:
            df[cashflow.id] = df[cashflow.id] + " " + df[note].astype("str")

    # Convert [value] ',' to '.' and to float
    df[value] = df[value].str.replace(",", ".").astype("float")
    # Change date to datetime and set as index
    df[date] = pd.to_datetime(df[date], dayfirst=True)
    df = df.set_index(date)

    # Convert to strings for safety and lower
    str_cols = counterparty_acc_name, sys_note, acc_note, *notes
    for col in str_cols:
        df[col] = df[col].astype("str").str.lower()

    # Create attributes for account and categories
    df[cashflow.account_id] = account_id
    df[cashflow.main_category] = "UNASSIGNED"
    df[cashflow.subcategory] = "UNASSIGNED"
    df[cashflow.wni] = "UNASSIGNED"

    # Categorize
    df = category_filter(df, str_cols, counterparty_acc_id)

    df["note_1"] = ""
    for col in notes:
        df["note_1"] = df["note_1"] + " " + df[col]  # TODO Refactor as note

    df["note_2"] = ""  # TODO Refactor as custom note

    # Clean the data for cashflow
    df = df.reset_index().rename(
        columns={
            date: cashflow.date,
            counterparty_acc_name: cashflow.account,
            value: cashflow.value,
            transaction_id: cashflow.id,
            counterparty_acc_id: cashflow.counterparty_account_id,
            sys_note: cashflow.sys_note,
            acc_note: cashflow.acc_note,
            "note_1": cashflow.note_1,  # TODO Refactor as note
            "note_2": cashflow.note_2,  # TODO Refactor as custom note
        },
        inplace=False,
    )
    df = df[
        [
            cashflow.date,
            cashflow.account_id,
            cashflow.counterparty_account_id,
            cashflow.account,
            cashflow.value,
            cashflow.id,
            cashflow.sys_note,
            cashflow.acc_note,
            cashflow.note_1,
            cashflow.note_2,
            cashflow.main_category,
            cashflow.subcategory,
            cashflow.wni,
        ]
    ]
    df = df.set_index(cashflow.date)

    # Create income column
    df[cashflow.income] = df[cashflow.value] > 0

    # Remove duplicates for base file
    df = df_merger(
        base_df=df_base, insert_df=df, date_col=cashflow_date, id_col=cashflow_id
    )
    # Save as a bank file
    df.to_csv(base_path)

    return df
