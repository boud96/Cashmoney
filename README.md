 <h3 align="center">Cashmoney</h3>

  <p align="center">
    A personal finance app
    <br />
    <a href="https://boud96-cashmoney-home-live-demo-d4hd1j.streamlit.app/">View Demo</a>
  </p>


<!-- ABOUT THE PROJECT -->
## About The Project

![Homepage][home-screenshot]

This is my very first public project. It's a personal finance app that I built to learn Python and programming in general. I started by simply writing a script with pandas that parses bank statements and assign a category to certain transactions. I've been building on top of it since. Give it a try and let me know what you think!
Features:
* Define categories and automatically assign transactions to them based on chosen text values in provided csv bank statement
* Manage multiple accounts
* Plot some charts
* Keep track of wants / needs / investments
* Filter the data and dynamically update the charts

Looking back, some of the older code is full of bad practices that I learned to avoid. Feel free to laugh at my stupidity :)
Later I might rebuild the app from th ground up and for example use a database instead of csv files, but it works just fine for now.


<p align="right">(<a href="#readme-top">back to top</a>)</p>



### Built With

This section should list any major frameworks/libraries used to bootstrap your project. Leave any add-ons/plugins for the acknowledgements section. Here are a few examples.

* Python
  * Streamlit
  * Pandas
  * Plotly

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

### Prerequisites

This is an example of how to list things you need to use the software and how to install them.
* <a href="https://www.python.org/downloads/">Python >= 3.9 </a> 

### Installation

If you have installed Python, you should be able to run the app with the `run.bat` file.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

To use the app, you need to set up at least one account and upload a csv file with transactions. The app will automatically assign categories to transactions based on the text values you provide.
1. Create new bank type under on the accounts page under the Add bank tab (If your bank is not available).
   - The bank type is used to properly parse the bank statement file. You will need to fill in the following form.
2. Create an account in the Add account tab. 
   - You can have multiple accounts of the same bank type. 
   - You can have a shared account, and it's transactions will be recalculated, so you can see how much of your personal money is being spent.
3. Create custom categories in the categories page.
   - Define main categories subcategories, text values to look for in the bank statements. 
   - Also, whether the text value is always a need / want / investment / income / account_transfer (between your defined accounts) / UNASSIGNED. You should only assign the text values that you want to always assign to these categories. Those that are not always the same category, should be assigned manually in edit page.
   - E.g.: A string value "netflix" will probably always be of category "subscriptions", subcategory "entertainment", and is a "want". So you can define it as such.
   - A string value "airport" will probably always be of category "transport", subcategory "flight" for example, but it might sometimes be a "want" when it's for a vacation and a "need" when it's business related. That's up to you.
4. Upload a csv file on the edit page Add data from csv tab, choose an account and click Parse. The data will get categorized.
5. View the data on the home page and evaluate your cash flow. 
6. Optionally reassign the categories for transactions on the edit/edit data manually page.


On first startup you'll see this screen where you can set up the app with examples, so you can get a feel for it first. # TODO (Not done yet) You can always reset the app to this state in the settings page.
![Homepage-startup][home-startup-screenshot]

## Features
![home-filters-screenshot][home-filters-screenshot]
![home-stats-screenshot][home-stats-screenshot]
![home-bar-screenshot][home-bar-screenshot]
![home-line-screenshot][home-line-screenshot]
![home-pie-screenshot][home-pie-screenshot]

<!-- PLANNED -->
## Planned features
- Allow accounts with different currencies and convert them to main account's currency.
- Import / Export settings button.
- Add tags to transactions. For example, you could tag a transaction as "vacation" but it still could be in a category food, restaurant.
- Make Revolut bank type work. (Revolut bank statement doesn't have a date a counterparty account number. It might be impossible to implement.)
- Finish editable table on the Edit data manually tab.

<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[home-screenshot]: img/home.png
[home-startup-screenshot]: img/home_statrup.png
[home-line-screenshot]: img/line.png
[home-bar-screenshot]: img/bar.png
[home-pie-screenshot]: img/pie.png
[home-stats-screenshot]: img/stats.png
[home-filters-screenshot]: img/filters.png
