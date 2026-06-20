@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Python virtual environment not found at .venv
  exit /b 1
)

call build_frontend.bat
if errorlevel 1 exit /b 1

".venv\Scripts\python.exe" -m pip show pyinstaller >nul 2>nul
if errorlevel 1 (
  echo Installing PyInstaller...
  ".venv\Scripts\python.exe" -m pip install pyinstaller
  if errorlevel 1 exit /b 1
)

pushd backend
"..\.venv\Scripts\python.exe" -m PyInstaller cashmoney-backend.spec --noconfirm --clean
if errorlevel 1 (
  popd
  exit /b 1
)
popd

pushd desktop
if exist "..\tools\node\node.exe" (
  set "PATH=%CD%\..\tools\node;%PATH%"
)
call npm install
if errorlevel 1 (
  popd
  exit /b 1
)
call npm run dist
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo.
echo Packaged app created in desktop\dist
