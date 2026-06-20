# Cashmoney

Cashmoney is a local finance dashboard built with Django, React, AG Grid, and
Electron packaging support.

## Launch

Run the app from Windows with:

```powershell
.\run_app.bat
```

The launcher applies Django migrations, builds the React frontend when needed,
starts the backend, and opens the app. If Electron has been installed in
`desktop\node_modules`, it launches the Electron shell; otherwise it opens the
Django-served frontend in the default browser.

To build the React frontend manually:

```powershell
.\build_frontend.bat
```

To install the Electron shell:

```powershell
.\desktop\install_desktop.bat
```

This uses the portable npm in `tools\node` when present. Then run
`.\run_app.bat` again.

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

## Packaging

To build a Windows package using Electron plus a PyInstaller Django backend:

```powershell
.\build_packaged_app.bat
```

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
