import streamlit as st

from my_scripts.Categories import Categories


# Init
c = Categories()
categories = c.categories
categories_wni = c.categories_wni

json_file_path = r"settings\categories.json"

st.title("CATEGORIES")

tab_1, tab_2 = st.tabs(("Add", "Delete"))
# New category
with tab_1:
    st.subheader("Add a new category")
    new_cat = st.text_input("New category:")

    new_cat_dict = {new_cat: {}}

    new_cat_add_butt = st.button("ADD", key="cat_add")
    if new_cat_add_butt:
        c.add_category(categories, new_cat_dict)
    st.markdown("---")

    # New subcategory
    st.subheader("Add a new subcategory")
    new_sub = st.text_input("New sub")
    cat_select = st.selectbox("To which category?", options=categories)

    new_sub_add_butt = st.button("ADD", key="sub_add")
    if new_sub_add_butt:
        c.add_subcategory(categories, cat_select, new_sub)
    st.markdown("---")

    # Assign string values
    st.subheader("Define text values to categorize with")
    new_str = st.text_input("New string")
    cat_select_str = st.selectbox("To which category?", options=categories, key="cat_select_string")
    sub_select_str = st.selectbox("To which subcategory?", options=categories[cat_select_str])
    wni_select_str = st.selectbox("Is this always a Want / Need / Investment / Icnome / UNNASSIGNED", options=categories_wni)

    new_str_add_butt = st.button("ADD", key="str_add")
    if new_str_add_butt:
        c.add_str(categories, cat_select_str, sub_select_str, new_str, wni_select_str)

with tab_2:
    st.subheader("Delete a category")

    delete_action = st.selectbox("What do you want to remove?", options=("Category", "Subcategory", "Text value"))
    placeholder = st.empty()
    if delete_action == "Category":
        cat_select_del = st.selectbox("Which category?", options=categories)
    elif delete_action == "Subcategory":
        cat_select_del = st.selectbox("From which category?", options=categories)
        sub_select_del = st.selectbox("Which subcategory?", options=categories[cat_select_del])
    if delete_action == "Text value":
        cat_select_del = st.selectbox("From which category?", options=categories)
        sub_select_del = st.selectbox("Which subcategory?", options=categories[cat_select_del])
        str_select_del = st.selectbox("Which subcategory?", options=categories[cat_select_del][sub_select_del])

    del_butt = st.button("DELETE")
    if del_butt and (delete_action == "Category"):
        c.delete_category(categories, cat_select_del)
    elif del_butt and (delete_action == "Subcategory"):
        c.delete_subcategory(categories, cat_select_del, sub_select_del)
    elif del_butt and (delete_action == "Text value"):
        c.delete_text_value(categories, cat_select_del, sub_select_del, str_select_del)


st.markdown("---")
st.subheader("Defined categories")
st.write(categories)

