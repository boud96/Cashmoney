import pandas as pd
import os

from my_scripts.Categories import Categories
os.chdir(r'C:\Users\boudn\PycharmProjects\cashmoney5')

path = r'C:\Users\boudn\PycharmProjects\cashmoney5\data'
files = ['Airbank_Adam_Dita.csv', 'cash.csv', 'kb_Adam.csv', 'old_cashmoney.csv']

categories = Categories()
main_categories = categories.get_main_categories()
subcategories = categories.get_subcategories()
wni_categories = categories.get_categories_wni()

print("Listed below are found in the csvs but not defined in categories json:")
for file in files:
    df = pd.read_csv(path + '\\' + file)
    print(f"File: {file}")

    unique_main_categories = df["main_category"].unique()
    unique_subcategories = df["subcategory"].unique()
    unique_wni_categories = df["wni"].unique()

    print("MAIN CATEGORIES")
    for cat in unique_main_categories:
        if cat not in main_categories:
            print(f"'{cat}'")
    print("\n")

    print("SUBCATEGORIES")
    for cat in unique_subcategories:
        if cat not in subcategories:
            print(f"'{cat}'")
    print("\n")

    print("WNI")
    for cat in unique_wni_categories:
        if cat not in wni_categories:
            print(f"'{cat}'")
    print("\n")
