import os
import shutil
import streamlit as st


def example_setup():
    source_path = r"data\examples"
    acc_files = ["Example cash account.csv", "Example shared account.csv", "Example main account.csv"]
    settings_files = ["categories.json", "accounts.json"]

    acc_destination_path = r"data"
    settings_destination_path = r"settings"

    if os.path.exists(source_path):
        for file in acc_files:
            shutil.copy(source_path + r"\\" + file, acc_destination_path)
        for file in settings_files:
            shutil.copy(source_path + r"\\" + file, settings_destination_path)
    else:
        print('Source file not found.')
