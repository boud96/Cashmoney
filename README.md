# Cashmoney

Cashmoney is a local finance dashboard built with Django, React, AG Grid, and
Electron packaging support.

## Download

Latest version: [View release notes](https://github.com/boud96/CashmoneyDjango/releases/latest)

- [Download installer](https://github.com/boud96/CashmoneyDjango/releases/latest/download/Cashmoney-Setup.exe)
- [Download portable app](https://github.com/boud96/CashmoneyDjango/releases/latest/download/Cashmoney-Portable.exe)
- [Checksums](https://github.com/boud96/CashmoneyDjango/releases/latest/download/checksums.txt)

## Launch

For a fresh clone on Windows, bootstrap the local Python and Node dependencies
first:

```powershell
.\setup_dev.bat
```

The setup script creates `.venv`, installs backend dependencies, and installs
frontend/desktop npm dependencies. If npm is not available globally, it downloads
a portable Node.js runtime into `tools\node`.

Then run the app with:

```powershell
.\run_app.bat
```

The launcher also calls `setup_dev.bat`, applies Django migrations, builds the
React frontend when needed, starts the backend, and opens the app. If Electron
has been installed in `desktop\node_modules`, it launches the Electron shell;
otherwise it opens the Django-served frontend in the default browser.

To build the React frontend manually:

```powershell
.\build_frontend.bat
```

The generated React bundle is written to
`backend\finance\static\finance\react\`. This directory is generated build
output and is intentionally not tracked in git.

To install the Electron shell:

```powershell
.\desktop\install_desktop.bat
```

This also calls `setup_dev.bat`, so it works on a fresh clone.

## Backend

The Django backend lives in `backend\`.

Manual setup and launch:

```powershell
cd backend
py -m venv ..\.venv
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

If your shell does not like the spaced path examples above, use:

```powershell
& "..\.venv\Scripts\python.exe" manage.py runserver 127.0.0.1:8000
```

## Django Admin

The app does not create a default admin account or ship hardcoded admin
credentials. To use the Django admin, create a local superuser yourself:

```powershell
.\.venv\Scripts\python.exe .\backend\manage.py createsuperuser
```

Then open `/admin/` from the running app and sign in with the credentials you
created.

## Packaging

To build a Windows package using Electron plus a PyInstaller Django backend:

```powershell
.\build_packaged_app.bat
```

This also calls `setup_dev.bat`, so it creates `.venv` and installs npm
dependencies before building.

This command:

1. Builds the React frontend into Django-served static assets.
2. Builds `backend\dist\cashmoney-backend\cashmoney-backend.exe` with PyInstaller.
3. Packages Electron with that backend executable.

The generated test artifacts are written to:

```text
desktop\dist\
```

Useful outputs:

- `Cashmoney Setup 0.1.0.exe` - installer
- `Cashmoney 0.1.0.exe` - portable executable
- `win-unpacked\Cashmoney.exe` - unpacked app folder for quick local testing

In packaged mode, Electron starts the bundled backend on `127.0.0.1:8765`.
The SQLite database and backend logs are stored in the Electron user data
folder, not inside the installation directory.
