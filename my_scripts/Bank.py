import json


class BankManager:
    def __init__(self):
        self.encoding = "encoding"
        self.delimiter = "delimiter"
        self.header = "header"
        self.columns = "columns"
        self.date = "date"
        self.value = "value"
        self.transaction_id = "transaction_id"
        self.counterparty_acc_id = "counterparty_acc_id"
        self.counterparty_acc_name = "counterparty_acc_name"
        self.sys_note = "sys_note"
        self.acc_note = "acc_note"
        self.notes = "notes"

        self.json_path = "settings/banks.json"
        with open(self.json_path, "r", encoding="utf-8") as json_file:
            self.json_data = json.load(json_file)

    def add_bank(self, new_data):
        self.json_data.update(new_data)
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(self.json_data, json_file, indent=2)

    def del_bank(self, del_select):
        del self.json_data[del_select]
        with open(self.json_path, "w") as json_file:
            json.dump(self.json_data, json_file, indent=2)

    def get_banks(self):
        return self.json_data
