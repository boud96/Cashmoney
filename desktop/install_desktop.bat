@echo off
setlocal

set "LOCAL_NODE_DIR=%~dp0..\tools\node"
set "LOCAL_NPM=%~dp0..\tools\node\npm.cmd"

if exist "%LOCAL_NPM%" (
    set "PATH=%LOCAL_NODE_DIR%;%PATH%"
    set "NPM=%LOCAL_NPM%"
) else (
    where npm >nul 2>nul
    if errorlevel 1 (
        echo npm is not available. Install Node.js or run the portable npm setup first.
        exit /b 1
    )
    set "NPM=npm"
)

cd /d "%~dp0"
"%NPM%" install

if exist "node_modules\electron\install.js" (
    node "node_modules\electron\install.js"
)

if exist "node_modules\.bin\electron.cmd" (
    call "node_modules\.bin\electron.cmd" --version
)
