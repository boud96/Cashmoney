 <h3 align="center">Cashmoney</h3>

  <p align="center">
    A personal finance app
    <br />
    <a href="#">View Demo (Not yet available)</a>
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
* Python >= 3.9

### Installation

If you have installed Python, you should be able to run the app with the `run.bat` file.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

To use the app, you need to set up at least one account and upload a csv file with transactions. The app will automatically assign categories to transactions based on the text values you provide.
1. Create new bank type under on the accounts page under the Add bank tab (If your bank is not available).
   - The bank type is used to properly parse the bank statement file. You will need to fill in the following form.
   - The app will search for the text values you provide in categories page in some of the columns you specify.
2. Create an account in the Add account tab.
3. Create custom categories in the categories page.
   - Define main categories subcategories, text values to look for in the bank statements and whether the text value is always a need / want / investment / income / account_transfer / UNASSIGNED. You should only assign the text values that you want to always assign to these categories. Those that change, should be assigned manually in edit page.
4. Upload a csv file on the edit page Add data from csv tab.
5. You should now see the home page with stats, charts and a table.

On first startup you'll see this screen where you can set up the app with examples so you can get a feel for it first. # TODO (Not done yet) You can always reset the app to this state in the settings page.
![Homepage-startup][home-startup-screenshot]



<p align="right">(<a href="#readme-top">back to top</a>)</p>



<!-- MARKDOWN LINKS & IMAGES -->
<!-- https://www.markdownguide.org/basic-syntax/#reference-style-links -->
[contributors-shield]: https://img.shields.io/github/contributors/othneildrew/Best-README-Template.svg?style=for-the-badge
[contributors-url]: https://github.com/othneildrew/Best-README-Template/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/othneildrew/Best-README-Template.svg?style=for-the-badge
[forks-url]: https://github.com/othneildrew/Best-README-Template/network/members
[stars-shield]: https://img.shields.io/github/stars/othneildrew/Best-README-Template.svg?style=for-the-badge
[stars-url]: https://github.com/othneildrew/Best-README-Template/stargazers
[issues-shield]: https://img.shields.io/github/issues/othneildrew/Best-README-Template.svg?style=for-the-badge
[issues-url]: https://github.com/othneildrew/Best-README-Template/issues
[license-shield]: https://img.shields.io/github/license/othneildrew/Best-README-Template.svg?style=for-the-badge
[license-url]: https://github.com/othneildrew/Best-README-Template/blob/master/LICENSE.txt
[linkedin-shield]: https://img.shields.io/badge/-LinkedIn-black.svg?style=for-the-badge&logo=linkedin&colorB=555
[linkedin-url]: https://linkedin.com/in/othneildrew
[home-screenshot]: img/home.png
[home-startup-screenshot]: img/home_statrup.png
[Next.js]: https://img.shields.io/badge/next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[Next-url]: https://nextjs.org/
[React.js]: https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://reactjs.org/
[Vue.js]: https://img.shields.io/badge/Vue.js-35495E?style=for-the-badge&logo=vuedotjs&logoColor=4FC08D
[Vue-url]: https://vuejs.org/
[Angular.io]: https://img.shields.io/badge/Angular-DD0031?style=for-the-badge&logo=angular&logoColor=white
[Angular-url]: https://angular.io/
[Svelte.dev]: https://img.shields.io/badge/Svelte-4A4A55?style=for-the-badge&logo=svelte&logoColor=FF3E00
[Svelte-url]: https://svelte.dev/
[Laravel.com]: https://img.shields.io/badge/Laravel-FF2D20?style=for-the-badge&logo=laravel&logoColor=white
[Laravel-url]: https://laravel.com
[Bootstrap.com]: https://img.shields.io/badge/Bootstrap-563D7C?style=for-the-badge&logo=bootstrap&logoColor=white
[Bootstrap-url]: https://getbootstrap.com
[JQuery.com]: https://img.shields.io/badge/jQuery-0769AD?style=for-the-badge&logo=jquery&logoColor=white
[JQuery-url]: https://jquery.com 
