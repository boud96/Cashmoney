import uuid

import pandas as pd
import plotly.express as px
import numpy as np

from my_scripts.Account import AccountManager
from my_scripts.Categories import Categories


class Cashflow:
    def __init__(self):
        self.path = r"data"
        # Default columns
        self.date = "date"
        self.account_id = "account_id"
        self.account = "account"
        self.value = "value"
        self.id = "ID"
        self.counterparty_account_id = "counterparty_account_id"
        self.sys_note = "sys_note"
        self.acc_note = "acc_note"
        self.note_1 = "note_1"
        self.note_2 = "note_2"
        self.main_category = "main_category"
        self.subcategory = "subcategory"
        self.wni = "wni"
        self.income = "income"
        # Columns created by methods
        self.cumsum = "cumsum"
        # Dfs created by methods
        self.df_cumsum = None
        self.df_inc_exp_net = None
        # Other stuff
        self.stats = None
        # TODO Add default cell values as constants (all caps). E.g. - "account_transfer", "UNASSIGNED",...
        #  Don't forget to change them in the csvs as well.

        # Dependencies - AccountManager and Categories
        acc_manager = AccountManager()
        self.accounts_dict = acc_manager.get_accounts()
        df = pd.DataFrame()
        for account in self.accounts_dict:
            # Read
            df_acc = pd.read_csv(rf"{self.path}/{account}.csv")
            df_acc[self.date] = pd.to_datetime(df_acc[self.date], dayfirst=True)
            # Add to dict
            self.accounts_dict[account][acc_manager.df] = df_acc
            # Calculate balance
            sum_without_account_transfer = df_acc.loc[df_acc[self.main_category] != "account_transfer", "value"].sum()
            acc_manager.update_balance(account, sum_without_account_transfer)
            # Concat
            df = pd.concat([df, df_acc])

        # Sort by date and set date as index
        if len(df) > 0:
            self.df = df.sort_values(by=[self.date], ascending=[False])
            self.df[self.date] = pd.to_datetime(self.df[self.date], dayfirst=True)
            self.df = self.df.set_index(self.date)
            # ID column to str
            self.df[self.id] = self.df[self.id].astype("str")

        # Dependencies - Categories
        categories = Categories()
        self.main_category_list = categories.get_main_categories()
        self.subcategory_list = categories.get_subcategories()
        self.wni_list = categories.get_categories_wni()

    def get_acc_dict(self):
        return self.accounts_dict

    def get_df(self):
        return self.df

    def recalculate_by_owners(self, row):
        if row['account_id'] in self.accounts_dict:
            row['value'] = row['value'] / self.accounts_dict[row['account_id']]['owners']
        return row

    def edit_data(self, df):
        base_df = self.df
        df = df.set_index(self.date)

        # Convert ID to str for safety
        base_df[self.id] = base_df[self.id].astype("str")
        df[self.id] = df[self.id].astype("str")

        # Filter added rows vs edited rows
        df_added = df.loc[df["ID"] == '']
        df_edited = df.loc[df["ID"] != '']

        # Add ID to added rows. Done this way because otherwise streamlit refreshes the whole page
        if len(df_added) > 0:
            uuid_list = []
            for i in range(len(df_added)):
                uuid_list.append(uuid.uuid4())
            df_added = df_added.assign(ID=uuid_list)

        if len(df_edited) > 0:
            # Concatenate base with edited
            base_df = pd.concat([base_df, df_edited])
            # Identify duplicates
            base_df["bool_duplicates"] = base_df[self.id].duplicated(keep=False)
            # Remove duplicates
            base_df = base_df.loc[base_df["bool_duplicates"] == False]
            # Add edited rows back to base
            base_df = pd.concat([base_df, df_edited])

        # Add added rows to base
        if len(df_added) > 0:
            base_df = pd.concat([base_df, df_added])

        df_list = dict(list(base_df.groupby(self.account_id)))
        for acc_name in df_list:
            df_acc = df_list[acc_name]
            if "_selectedRowNodeInfo" in df_acc.columns:
                df_acc.drop(columns=["_selectedRowNodeInfo"])
                df_acc = df_acc.reset_index().set_index(self.date)
                df_acc = df_acc.sort_values(by=[self.date], ascending=[False])
                df_acc.to_csv(f"data/{acc_name}.csv")

    def delete_data(self, df):
        pass

    def create_cumsum(self, resample_freq="MS"):
        """
        Creates a cumsum object resampled by given frequency.
        :param resample_freq:   pandas resample method parameter. Eg.:"d", "m",...
        :return:                df with cumsum column
        """
        self.df_cumsum = self.df[[self.value]]
        self.df_cumsum = self.df_cumsum.resample(resample_freq).sum()
        self.df_cumsum[self.cumsum] = self.df_cumsum[self.value].cumsum()
        return self

    def basic_stats(self, df=None):
        """
        Generates few basic stats for further visualization.
        :return: Dict of
            "stats: self.stats:             Stats of:
                                                Sum of incomes.
                                                Sum of expenses.
                                                Net value.
            "monthly": self.df_inc_exp_net: Df of incomes, expenses and net values by months.
        """
        if df is None:
            df = self.df

        df_first_date = df.index[-1].to_pydatetime().replace(day=1)
        df_last_date = df.index[0].to_pydatetime().replace(day=1)
        date_range = pd.date_range(start=df_first_date, end=df_last_date, freq='MS')
        df_range = pd.DataFrame({'date': date_range}).set_index("date")

        incomes, expenses = self.filter_incomes(df)
        incomes = pd.concat([df_range, incomes])
        expenses = pd.concat([df_range, expenses])

        incomes_sum = int(incomes[self.value].sum())
        expenses_sum = int(-expenses[self.value].sum())
        net_sum = incomes_sum - expenses_sum
        self.stats = {"incomes": incomes_sum, "expenses": expenses_sum, "net": net_sum}

        resample_freq = "MS"
        incomes_resampled = incomes.resample(resample_freq).sum()
        incomes_resampled[self.income] = 1
        expenses_resampled = expenses.resample(resample_freq).sum()
        expenses_resampled[self.income] = 0
        net_resampled = incomes_resampled + expenses_resampled
        net_resampled.fillna(0, inplace=True)
        net_resampled[self.income] = "net"

        self.df_inc_exp_net = pd.concat([incomes_resampled, expenses_resampled])
        self.df_inc_exp_net[self.income] = self.df_inc_exp_net[self.income] > 0
        self.df_inc_exp_net = pd.concat([self.df_inc_exp_net, net_resampled])
        self.df_inc_exp_net = self.df_inc_exp_net.sort_values(by=[self.date])

        return {"stats": self.stats, "monthly": self.df_inc_exp_net}

    def filter_incomes(self, df=None):
        """
        Filters incomes and expenses
        :return: incomes df and expenses df
        """
        if df is None:
            df = self.df

        incomes = df[df[self.income] == True]
        expenses = df[df[self.income] == False]
        return incomes, expenses

    def plot_line(self, df=None, y_axis=None):
        """
        Plots a line chart of the df. Default is value of cashflow.
        :param df:      df to be plotted.
        :param y_axis:  axis to plot.
        :return:        A line chart.
        """
        if df is None:
            df = self.df
        if y_axis is None:
            y_axis = self.value

        fig = px.line(data_frame=df, x=df.index, y=y_axis)
        return fig.show()

    def plot_bars(self, df=None, y_axis=None, plot_vlines=False):
        """
        Plots a bar chart of the df. Default is value of cashflow.
        :param df:              df to be plotted.
        :param y_axis:          axis to plot.
        :param plot_vlines:     plots vlines every year and q.
        :return:                A bar chart.
        """
        if df is None:
            df = self.df
        if y_axis is None:
            y_axis = self.value

        df["color"] = df[self.income].map({True: "green", False: "red", "net": "black"})
        df[y_axis] = df[y_axis].round()

        fig = px.bar(
            data_frame=df,
            x=df.index,
            y=y_axis,
            color="color",
            color_discrete_sequence=df.color.unique(),
            barmode="overlay",
            text_auto=True,
            width=100000,
        )
        fig.update_layout(showlegend=False)

        if plot_vlines:
            df_vlines = df.copy()
            vlines_first = df_vlines.index[0]
            vlines_last = df_vlines.index[-1]
            vlines_y = df_vlines.resample("Y").sum().reset_index()["date"].tolist()
            for year in vlines_y:
                if not (year < vlines_first) and not (year > vlines_last):
                    fig.add_vline(x=year, line_width=1, line_dash="solid", line_color="gray")

            vlines_q = df_vlines.resample("Q").sum().reset_index()["date"].tolist()
            for quarter in vlines_q:
                m, d = quarter.month, quarter.day
                if not (quarter < vlines_first) and not (quarter > vlines_last) and not ((m == 12) and (d == 31)):
                    fig.add_vline(x=quarter, line_width=1, line_dash="dash", line_color="gray")

        return fig

    def plot_last_q(self, df=None):
        """
        Plots a line graph of cumsum for the last 3 months.
        :return:
        """
        if df is None:
            df = self.df

        latest_date = self.df.index[0]
        first_month = latest_date - pd.offsets.MonthBegin(3)

        df = df.loc[:first_month]
        df = df.reset_index()

        # group by date and freq
        df = df.groupby(pd.Grouper(key=self.date, freq="M"))
        # groups to a list of dataframes with list comprehension
        dfs = [group for _, group in df]

        final_df = pd.DataFrame(columns=[self.value, self.income], index=np.arange(31))

        y_axis_names = []
        for df in dfs:
            df = df.set_index(self.date)
            df = df.resample("D").sum().cumsum()
            df = df.reset_index()

            month_name = df[self.date].dt.strftime("%B %Y")[0]
            y_axis_names.append(month_name)

            final_df = final_df.join(df, rsuffix=month_name).rename(
                columns={self.value + month_name: month_name}
            )

        final_df.index = final_df.index + 1
        fig = px.line(data_frame=final_df, x=final_df.index, y=y_axis_names)
        fig.update_layout(yaxis_title="value", xaxis_title="day of month")
        return fig

    def plot_wni_pie(self, df=None, exclude=None):
        """
        Plots a pie of WNI.
        :param df:          Df to be plotted.
        :param exclude:     Exclude either "wants", "needs", "investments", "account_transfers".
        :return:
        """

        if df is None:
            df = self.df

        df = self.df.copy().reset_index()
        df = df[["value", "wni"]]
        df = df.query("wni != 'income' &"
                      "wni != 'UNASSIGNED'").copy()
        df[self.value] = df[self.value] * -1

        if exclude is not None:
            df = df[df[self.wni] != exclude]

        fig = px.pie(df, values=self.value, names="wni", hole=0.4)
        return fig

    def plot_categories_pies(self, df=None, expenses=True):
        """
        Plots a sunburst pie of categories.
        :param df:          Df to be plotted.
        :param expenses     Boolean of expenses or incomes.
        :return:
        """
        if df is None:
            df = self.df

        if expenses is True:
            df_copy = df.copy()
            df_copy = df_copy[df_copy[self.income] != True]
            df_copy.loc[:, self.value] = df_copy[self.value] * -1
            df = df_copy
        else:
            df = df[df[self.income] == True]

        fig = px.sunburst(
            df, path=df.loc[:, ("main_category", "subcategory")], values=self.value
        )
        return fig
