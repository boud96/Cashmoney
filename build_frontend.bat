@echo off
setlocal

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"
set "LOCAL_NODE_DIR=%ROOT%tools\node"
set "LOCAL_NPM=%LOCAL_NODE_DIR%\npm.cmd"

if /I not "%~1"=="--skip-setup" (
    call "%ROOT%setup_dev.bat"
    if errorlevel 1 exit /b 1
)

if exist "%LOCAL_NPM%" (
    set "PATH=%LOCAL_NODE_DIR%;%PATH%"
    set "NPM=%LOCAL_NPM%"
) else (
    where npm.cmd >nul 2>nul
    if errorlevel 1 (
        echo npm is not available. Run setup_dev.bat first.
        exit /b 1
    )
    for /f "delims=" %%I in ('where npm.cmd') do (
        if not defined NPM set "NPM=%%I"
    )
)

if not exist "%FRONTEND%\node_modules" (
    cd /d "%FRONTEND%"
    call "%NPM%" install
    if errorlevel 1 exit /b 1
)

cd /d "%FRONTEND%"
call "%NPM%" run build
