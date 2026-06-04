@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "PY=%ROOT%.venv\Scripts\python.exe"
set "APP_URL=http://127.0.0.1:8000/"
set "LOCAL_NODE_DIR=%ROOT%tools\node"
set "ELECTRON_CMD=%ROOT%desktop\node_modules\.bin\electron.cmd"

if exist "%LOCAL_NODE_DIR%\node.exe" (
    set "PATH=%LOCAL_NODE_DIR%;%PATH%"
)

if not exist "%PY%" (
    py -m venv "%ROOT%.venv"
)

"%PY%" -m pip install -r "%BACKEND%\requirements.txt"
"%PY%" "%BACKEND%\manage.py" migrate

start "Vibe Refactor Backend" /min cmd /c ""%PY%" "%BACKEND%\manage.py" runserver 127.0.0.1:8000 --noreload"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(20); do { try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/health/' | Out-Null; exit 0 } catch { Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $deadline); exit 1"

if exist "%ELECTRON_CMD%" (
    start "Cashmoney" "%ELECTRON_CMD%" "%ROOT%desktop"
) else (
    start "" "%APP_URL%"
)
