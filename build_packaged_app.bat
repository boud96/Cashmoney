@echo off
setlocal

cd /d "%~dp0"

call setup_dev.bat
if errorlevel 1 exit /b 1

call build_frontend.bat --skip-setup
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
  set "NPM=..\tools\node\npm.cmd"
  set "NPX=..\tools\node\npx.cmd"
) else (
  for /f "delims=" %%I in ('where npm.cmd') do (
    if not defined NPM set "NPM=%%I"
  )
  for /f "delims=" %%I in ('where npx.cmd') do (
    if not defined NPX set "NPX=%%I"
  )
)
call "%NPM%" install
if errorlevel 1 (
  popd
  exit /b 1
)
call "%NPM%" run dist
if errorlevel 1 (
  popd
  exit /b 1
)
popd

echo.
echo Packaged app created in desktop\dist
