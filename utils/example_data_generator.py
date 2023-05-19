import uuid

import numpy as np
import pandas as pd
from my_scripts.Account import AccountManager
from my_scripts.Categories import Categories
import os

# Set cwd to the root of the project
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEMPLATE_CSV_PATH = r"data/examples/template_account.csv"

c = Categories()
main_categories = c.get_categories()
del main_categories["UNASSIGNED"]

a = AccountManager()


def generate_account(name):

    df = pd.read_csv(TEMPLATE_CSV_PATH)
    df = pd.concat([df, pd.DataFrame(
        {
            "date": pd.date_range(start="2020-01-01", end="2023-04-30", periods=1000),
            "value": np.random.randint(-1000, 1000, 1000),
            "ID": [uuid.uuid4() for _ in range(1000)],
            # Get values for main_category column from main_categories dict
            "main_category": np.random.choice(list(main_categories.keys()), 1000),
            "wni": np.random.choice(["wants", "needs"], 1000),
            "account_id": name
        }
    )])
    df.set_index("date", inplace=True)

    # For each row in dataframe, get value of main_category column and print it
    for index, row in df.iterrows():
        main_cat_row = row["main_category"]
        # get random value from main_categories, where key is main_cat_row
        sub_cat_row = np.random.choice(list(main_categories[main_cat_row].keys()))
        # assign rows "subcategory column to sub_cat_row
        df.loc[index, "subcategory"] = sub_cat_row

    df.loc[df["main_category"] == "food", "wni"] = "needs"
    df.loc[df["subcategory"] == "groceries", "wni"] = "needs"
    df.loc[df["subcategory"] == "restaurants", "wni"] = "wants"
    df.loc[df["subcategory"] == "food_other", "wni"] = "wants"

    df.loc[df["main_category"] == "transport", "wni"] = "needs"
    df.loc[df["subcategory"] == "gas", "wni"] = "needs"
    df.loc[df["subcategory"] == "public_transport", "wni"] = "needs"
    df.loc[df["subcategory"] == "transport_other", "wni"] = "wants"

    df.loc[df["main_category"] == "subscriptions", "wni"] = "wants"
    df.loc[df["subcategory"] == "clouds", "wni"] = "wants"
    df.loc[df["subcategory"] == "streaming", "wni"] = "wants"
    df.loc[df["subcategory"] == "rent", "wni"] = "needs"
    df.loc[df["subcategory"] == "internet_provider", "wni"] = "needs"
    df.loc[df["subcategory"] == "subscriptions_other", "wni"] = "wants"

    df.loc[df["main_category"] == "jobs", "wni"] = "income"

    df.loc[df["main_category"] == "investments", "wni"] = "investments"

    df.loc[df["main_category"] == "other", "wni"] = "wants"

    df.loc[df["main_category"] == "UNASSIGNED", "wni"] = "UNASSIGNED"

    # If value in "wni is "income" make it absolute value
    df.loc[df["wni"] == "income", "value"] = df["value"].abs()
    # If value in "wni is "income" make it negative value
    df.loc[df["wni"] == "wants", "value"] = df["value"].abs() * -1
    df.loc[df["wni"] == "needs", "value"] = df["value"].abs() * -1
    df.loc[df["wni"] == "investments", "value"] = df["value"].abs() * -1
    df.loc[df["wni"] == "UNASSIGNED", "value"] = df["value"].abs() * -1
    # If it's jobs, multiply by 5
    df.loc[df["main_category"] == "jobs", "value"] = df["value"].abs() * 5

    # For each value in "value" column that is positive, assign value of "income" column to TRUE.
    df.loc[df["value"] > 0, "income"] = True
    df.loc[df["value"] < 0, "income"] = False
    df = df[df["value"] != 0]

    # If value in "main_category is "jobs" make it absolute value
    df.loc[df["main_category"] == "jobs", "value"] = df["value"].abs()

    return df


def generate_transfers(acc_1, acc_2):
    acc_1_name = acc_1["account_id"].iloc[0]
    acc_2_name = acc_2["account_id"].iloc[0]

    # get random 25 rows from acc_1
    df = acc_1.sample(n=25)
    df["main_category"] = "account_transfer"
    df["wni"] = "account_transfer"
    df["subcategory"] = acc_2_name
    # replace rows from acc_1 with rows from df, keep other rows
    acc_1.update(df)
    # add rows from df to acc_2
    # values from df, column "value", multiply by -1
    df["value"] = df["value"] * -1
    df.loc[df["value"] > 0, "income"] = True
    df.loc[df["value"] < 0, "income"] = False
    df["account_id"] = acc_2_name
    df["subcategory"] = acc_1_name
    acc_2 = pd.concat([acc_2, df])
    acc_1.to_csv(f"{acc_1_name}.csv")
    acc_2.to_csv(f"{acc_2_name}.csv")


acc_1 = generate_account("Example main account")
acc_2 = generate_account("Example shared account")
generate_transfers(acc_1, acc_2)

