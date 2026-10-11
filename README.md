# Cashmoney

Cashmoney is a local-first personal finance app for Windows. You import your bank
statements, rules sort the transactions into categories, and a dashboard shows where
the money went.

Everything runs on your own computer: a Django + SQLite backend and a React frontend
in an Electron window. There are no accounts and no cloud services. The only outside
request is for exchange rates (the public [Frankfurter](https://frankfurter.dev) API),
used when transactions are in a currency other than your default one.

## What it does

- **Import** bank statements as CSV, described by an import mapping (columns, date and
  amount formats, encoding; the app detects most of it), or as camt.053 XML. Imports
  show a preview first, skip duplicates, list rows that failed, and can be undone.
- **Categorize** with keyword rules: include and exclude terms, priorities, and what a
  match sets (subcategory, tags, want/need/investment, ignore). Recategorize applies
  changed rules to existing transactions; edited rows are locked so rules don't
  overwrite them.
- **Review** on the dashboard: filters (dates, accounts, categories, tags, search),
  monthly flow and category charts, and an editable transaction table with bulk
  assignment. Transfers between your own accounts can be matched and excluded, and
  shared accounts can be split by their number of owners.
- **Keep the data safe** with backups: download or restore the database, and an
  automatic backup is made before restores and other destructive actions.

## Download

Latest version: [release notes](https://github.com/boud96/Cashmoney/releases/latest)

- [Installer](https://github.com/boud96/Cashmoney/releases/latest/download/Cashmoney-Setup.exe)
- [Portable app](https://github.com/boud96/Cashmoney/releases/latest/download/Cashmoney-Portable.exe)
- [Checksums](https://github.com/boud96/Cashmoney/releases/latest/download/checksums.txt) (SHA-256)

The app keeps its database and logs in Electron's user data folder under `%APPDATA%`,
not in the installation folder. A new install starts with a small set of sample data,
which Maintenance can remove.

## Development

For a fresh clone on Windows, install the Python and Node dependencies first:

```powershell
.\setup_dev.bat
```

It creates `.venv`, installs the backend requirements, and installs the frontend and
desktop npm packages from their lockfiles. If npm isn't available, it downloads a
portable Node.js into `tools\node` and checks it against its published SHA-256.

Then run the app:

```powershell
.\run_app.bat
```

The launcher runs the setup, applies migrations, builds the frontend, starts the
Django development server on `127.0.0.1:8000`, and opens the Electron shell (or the
default browser if Electron isn't installed). To install the Electron
shell, run `.\desktop\install_desktop.bat`.

The frontend has no separate dev server: build it, and Django serves it.

```powershell
.\build_frontend.bat --skip-setup
```

The bundle goes to `backend\finance\static\finance\react\`, which is generated and not
tracked in git.

### Tests and lint

```powershell
cd backend
..\.venv\Scripts\python.exe manage.py test finance

cd ..\frontend
npm run lint
npm test
```

Python formatting and lint run through pre-commit (ruff). CI runs the backend tests and
the frontend lint and tests before every build.

### Backend by hand

```powershell
cd backend
py -m venv ..\.venv
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

The database is `backend\db.sqlite3` unless `CASHMONEY_DATA_DIR` points somewhere
else.

## Django admin

The app has no default admin account and no built-in admin credentials. To create or
reset a local admin user, open Maintenance → Danger Zone in the app. Once an admin
user exists, the same card has an Open Admin button for `/admin/`.

For development you can also create one from the command line:

```powershell
.\.venv\Scripts\python.exe .\backend\manage.py createsuperuser
```

## Packaging

To build the Windows app (Electron plus a PyInstaller build of the backend):

```powershell
.\build_packaged_app.bat
```

It runs the setup, builds the frontend, builds
`backend\dist\cashmoney-backend\cashmoney-backend.exe` (PyInstaller is pinned in
`backend\requirements-build.txt`), and packages Electron into `desktop\dist\`:

- `Cashmoney Setup <version>.exe`: installer
- `Cashmoney <version>.exe`: portable app
- `win-unpacked\Cashmoney.exe`: unpacked app, for quick local testing

The packaged backend runs on `127.0.0.1:8765` with waitress, `DEBUG` off, and a
secret key generated per install.

## Releases

GitHub Actions builds every pull request into `main` (and manual runs). Pushing a
`vX.Y.Z` tag builds again and publishes `Cashmoney-Setup.exe`,
`Cashmoney-Portable.exe` and `checksums.txt` to a GitHub release; the download links
above depend on those names. The product version comes from `desktop/package.json`.

An optional repository variable, `VITE_CASHMONEY_DONATION_URL`, adds a donation link
(a public payment link) to Help → About. Without it, the panel is hidden.
