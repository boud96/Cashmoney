import json
import streamlit as st


class Categories:
    """
    Use to create an object of categories from a json file.
    Leave json_file parameter as None to use default path.
    """

    def __init__(self):
        self.json_path = "settings/categories.json"
        self.json_path_wni = "settings/categories_wni.json"
        with open(self.json_path, "r", encoding="utf-8") as data:
            self.categories = json.load(data)
            self.main_categories_list = list(self.categories.keys())

            if len(self.main_categories_list) == 0:
                self.subcategories_list = []
            subcategories_list = []
            for i in list(self.categories.values()):
                subcategories_list.append(i.keys())
                self.subcategories_list = [item for sublist in subcategories_list for item in sublist]

        with open(self.json_path_wni, "r", encoding="utf-8") as data_wni:
            self.categories_wni = json.load(data_wni)
            self.categories_wni_list = list(self.categories_wni.keys())

    def add_category(self, json_data, new_cat_name):
        json_data.update(new_cat_name)
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4)

    def add_subcategory(self, json_data, category_to, new_sub_name):
        json_data[category_to].update({new_sub_name: []})
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4)

    def add_str(self, json_data, category_to, subcategory_to, new_str_value, wni):
        subcategory_to_path = json_data[category_to][subcategory_to]
        for str_value in subcategory_to_path:
            if new_str_value in str_value:
                subcategory_to_path.remove(str_value)
        json_data[category_to][subcategory_to].append({new_str_value: wni})
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4)

    def delete_category(self, json_data, cat_to_delete):
        if cat_to_delete == "UNASSIGNED":
            return st.warning("The UNASSIGNED category cannot be deleted.")
        json_data.pop(cat_to_delete)
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4)

    def delete_subcategory(self, json_data, category_from, sub_to_delete):
        if sub_to_delete == "UNASSIGNED":
            return st.warning("The UNASSIGNED subcategory cannot be deleted.")
        json_data[category_from].pop(sub_to_delete)
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4)

    def delete_text_value(self, json_data, category_from, subcategory_from, text_to_delete):
        str_list = json_data[category_from][subcategory_from].copy()
        str_list.remove(text_to_delete)
        json_data[category_from][subcategory_from] = str_list
        with open(self.json_path, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4)

    def get_categories(self):
        return self.categories

    def get_main_categories(self):
        return self.main_categories_list

    def get_subcategories(self):
        return self.subcategories_list

    def get_categories_wni(self):
        return self.categories_wni_list
