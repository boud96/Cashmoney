from st_aggrid import AgGrid, JsCode, GridOptionsBuilder, ColumnsAutoSizeMode


def highlight_accounts(accounts_dict):
    code = """
    function (params) {
        if (params.value == 'pleasedontnameanaccountthisstringiamlazytofixthis') {
            return {
                'backgroundColor': '#fff',
            }"""
    suffix = """}
    };
    """

    for account in accounts_dict:
        code = code + f"""
        }} else if (params.value == \'{account}\') {{
              return {{
                  'backgroundColor': \'{accounts_dict[account]['color']}\',
              }}"""
    code = code + suffix
    return JsCode(code)


def get_string_to_add_row(date):
    return JsCode(f"\n\n function(e) {{ \n \
    let api = e.api; \n \
    let rowIndex = e.rowIndex + 1; \n \
    api.applyTransaction({{addIndex: rowIndex, add: [{{"
                               f"'date': '{date}',"
                               f"'main_category': 'UNASSIGNED',"
                               f"'subcategory': 'UNASSIGNED',"
                               f"'wni': 'UNASSIGNED',"
                               f"'ID': '',"
                               f" }}]}}); \n \
        }}; \n \n")


cell_button_add = JsCode('''
    class BtnAddCellRenderer {
        init(params) {
            this.params = params;
            this.eGui = document.createElement('div');
            this.eGui.innerHTML = `
             <span>
                <style>
                .btn_add {
                  background-color: limegreen;
                  border: none;
                  color: white;
                  text-align: center;
                  text-decoration: none;
                  display: inline-block;
                  font-size: 10px;
                  font-weight: bold;
                  height: 2.5em;
                  width: 3em;
                  cursor: pointer;
                }

                .btn_add :hover {
                  background-color: #05d588;
                }
                </style>
                <button id='click-button' 
                    class="btn_add" 
                    >+</button>
             </span>
          `;
        }

        getGui() {
            return this.eGui;
        }

    };
    ''')

unassigned_highlight = JsCode("""
function(params) {
    if (params.value == 'UNASSIGNED') {
        return {
            'color': 'red',
        }
    }
};
""")

income_highlight = JsCode("""
function(params) {
    if (params.value < 0) {
        return {
            'color': 'red',
        }
    } else {
        return {
            'color': 'green',
        }
    }
};
""")

grey_out = JsCode("function a() {return {'color': 'grey'}}")

cell_button_delete = JsCode('''
    class BtnCellRenderer {
        init(params) {
            console.log(params.api.getSelectedRows());
            this.params = params;
            this.eGui = document.createElement('div');
            this.eGui.innerHTML = `
             <span>
                <style>
                .btn {
                  background-color: #F94721;
                  border: none;
                  color: white;
                  font-size: 10px;
                  font-weight: bold;
                  height: 2.5em;
                  width: 8em;
                  cursor: pointer;
                }

                .btn:hover {
                  background-color: #FB6747;
                }
                </style>
                <button id='click-button'
                    class="btn"
                    >-</button>
             </span>
          `;
        }

        getGui() {
            return this.eGui;
        }

    };
    ''')

string_to_delete = JsCode(
    """
    function(e) {
        let api = e.api;
        let sel = api.getSelectedRows();
        debugger;
        console.log(sel);
        sel.forEach(obj => {
            obj.acc_note = "ahoj";
        });
        console.log("sel");
        console.log(sel);
        console.log("api.getSelectedRows()");
        console.log(api.getSelectedRows());
        return api.getSelectedRows();
    }
    """
)
