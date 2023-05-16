import streamlit as st

from utils.page_config import default_page_config

# ---PAGE CONFIG---
st.set_page_config(**default_page_config)
st.info("This is a DEMO. Uploading and manipulation of the data is not possible. Get the full version at https://github.com/boud96/Cashmoney")

st.header("About")
st.subheader(
    ":heavy_dollar_sign::heavy_dollar_sign::heavy_dollar_sign: "
    "Cashmoney "
    ":heavy_dollar_sign::heavy_dollar_sign::heavy_dollar_sign:"
)
st.text("A free personal finance app")
st.text("Made by boud96")
st.write("[github.com/boud96](https://github.com/boud96)")

st.divider()
st.write("If you find this app useful, consider buying me a coffee :coffee:")
col_1, col_2, col_3 = st.columns(3)
with col_1:
    st.write("PayPal")
    st.image("img/qr_paypal.png", width=200)
    st.write("[paypal.me/boud96](https:paypal.me/boud96)")
with col_2:
    st.write("BTC")
    st.image("img/qr_btc.png", width=200)
    st.text("bc1qf72t3w7e0wh2qwkwutapynedag7xft2e9rxamh")
with col_3:
    st.write("ETH")
    st.image("img/qr_eth.png", width=200)
    st.text("0xA23ad52cbA0f736007AB713AfF0621F2ED7B6873")
