@echo off
setlocal

cd /d "%~dp0"

call setup_dev.bat
if errorlevel 1 exit /b 1

call build_frontend.bat --skip-setup
if errorlevel 1 exit /b 1

rem Build tools are pinned in requirements-build.txt (PyInstaller).
".venv\Scripts\python.exe" -m pip install -r backend\requirements-build.txt
if errorlevel 1 exit /b 1

pushd backend
"..\.venv\Scripts\python.exe" -m PyInstaller cashmoney-backend.spec --noconfirm --clean
if errorlevel 1 (
  popd
  exit /b 1
)
rem PyInstaller's Django hook would bundle a database next to manage.py (CR-60).
"..\.venv\Scripts\python.exe" check_bundle.py dist\cashmoney-backend
if errorlevel 2 (
  echo Could not check the backend bundle ^(see above^).
  popd
  exit /b 1
)
if errorlevel 1 (
  echo The backend bundle contains a database file ^(listed above^).
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
rem A clean install from the lockfile, so the package never uses stale or newer modules.
call "%NPM%" ci
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
