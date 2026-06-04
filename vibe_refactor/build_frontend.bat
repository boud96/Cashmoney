@echo off
setlocal

set "ROOT=%~dp0"
set "FRONTEND=%ROOT%frontend"
set "LOCAL_NODE_DIR=%ROOT%tools\node"
set "LOCAL_NPM=%LOCAL_NODE_DIR%\npm.cmd"

if exist "%LOCAL_NODE_DIR%\node.exe" (
    set "PATH=%LOCAL_NODE_DIR%;%PATH%"
)

if not exist "%LOCAL_NPM%" (
    echo Portable npm is missing from tools\node.
    exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
    cd /d "%FRONTEND%"
    "%LOCAL_NPM%" install
    if errorlevel 1 exit /b 1
)

cd /d "%FRONTEND%"
"%LOCAL_NPM%" run build
