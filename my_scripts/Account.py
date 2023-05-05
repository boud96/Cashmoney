import json
import shutil


class AccountManager:
    def __init__(self):
        self.main = "main"
        self.color = "color"
        self.note = "note"
        self.bank_type = "bank_type"
        self.owners = "owners"
        self.account_number = "account_number"
        self.df = "df"
        self.delta = "delta"

        self.json_path = "settings/accounts.json"
        with open(self.json_path, "r") as json_file:
            self.json_data = json.load(json_file)

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

    def get_accounts(self):
        return self.json_data

    def adjust_account_delta(self, account, delta):
        self.json_data[account][self.delta] = delta
        with open(self.json_path, "w") as json_file:
            json.dump(self.json_data, json_file, indent=2)
