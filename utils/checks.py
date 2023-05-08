from my_scripts.Account import AccountManager
from my_scripts.Bank import BankManager
from my_scripts.Categories import Categories


def general_checks():
    ctgs = Categories().get_categories()
    accs = AccountManager().get_accounts()
    banks = BankManager().get_banks()

    ctgs_exist = len(ctgs) > 0
    accs_exist = len(accs) > 0
    banks_exist = len(banks) > 0

    return ctgs_exist, accs_exist, banks_exist


