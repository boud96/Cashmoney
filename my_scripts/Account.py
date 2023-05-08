import json
import shutil
import os


class AccountManager:
    def __init__(self):
        self.main = "main"
        self.color = "color"
        self.note = "note"
        self.bank_type = "bank_type"
        self.owners = "owners"
        self.account_number = "account_number"
        self.df = "df"
        self.balance = "balance"
        self.delta = "delta"

        self.json_path = "settings/accounts.json"
        with open(self.json_path, "r") as json_file:
            self.json_data = json.load(json_file)

    def checks(self):
        is_main = []
        account_number_list = []
        for acc in self.get_accounts().values():
            is_main.append(acc.get("main"))
            account_number_list.append(acc.get("account_number"))

        main_exists = False
        if True in is_main:
            main_exists = True

        return main_exists, account_number_list

    def add_account(self, new_data):
        self.json_data.update(new_data)
        with open(self.json_path, "w") as json_file:
            json.dump(self.json_data, json_file, indent=2)
            acc_path = r"data/" + list(new_data.keys())[0] + ".csv"
            template_path = r"data/examples/template_account.csv"
            shutil.copy(template_path, acc_path)

    def del_account(self, del_select):
        del self.json_data[del_select]
        with open(self.json_path, "w") as json_file:
            json.dump(self.json_data, json_file, indent=2)
            acc_path = r"data/" + del_select + ".csv"
            os.remove(acc_path)

    def get_accounts(self):
        return self.json_data

    def adjust_account_delta(self, account, delta):
        self.json_data[account][self.delta] = delta
        with open(self.json_path, "w") as json_file:
            json.dump(self.json_data, json_file, indent=2)

    def update_balance(self, account, new_balance):
        self.json_data[account][self.balance] = int(new_balance)
        self.json_data[account][self.df] = ""
        with open(self.json_path, "w") as json_file:
            json.dump(self.json_data, json_file, indent=2)
