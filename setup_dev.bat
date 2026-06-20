@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "DESKTOP=%ROOT%desktop"
set "PY=%ROOT%.venv\Scripts\python.exe"

if not exist "%PY%" (
    echo Creating Python virtual environment...
    py -m venv "%ROOT%.venv"
    if errorlevel 1 exit /b 1
)

echo Installing Python dependencies...
"%PY%" -m pip install -r "%BACKEND%\requirements.txt"
if errorlevel 1 exit /b 1

call :ensure_npm
if errorlevel 1 exit /b 1

if exist "%FRONTEND%\package.json" (
    if not exist "%FRONTEND%\node_modules" (
        echo Installing frontend dependencies...
        pushd "%FRONTEND%"
        call "%NPM%" install
        if errorlevel 1 (
            popd
            exit /b 1
        )
        popd
    )
)

if exist "%DESKTOP%\package.json" (
    if not exist "%DESKTOP%\node_modules" (
        echo Installing desktop dependencies...
        pushd "%DESKTOP%"
        call "%NPM%" install
        if errorlevel 1 (
            popd
            exit /b 1
        )
        popd
    )
)

echo Development setup complete.
exit /b 0

:ensure_npm
set "LOCAL_NODE_DIR=%ROOT%tools\node"
set "LOCAL_NPM=%LOCAL_NODE_DIR%\npm.cmd"

if exist "%LOCAL_NPM%" (
    set "PATH=%LOCAL_NODE_DIR%;%PATH%"
    set "NPM=%LOCAL_NPM%"
    exit /b 0
)

where npm.cmd >nul 2>nul
if not errorlevel 1 (
    for /f "delims=" %%I in ('where npm.cmd') do (
        if not defined NPM set "NPM=%%I"
    )
    exit /b 0
)

echo npm is not available. Downloading portable Node.js...
call :download_node
if errorlevel 1 exit /b 1

if not exist "%LOCAL_NPM%" (
    echo Portable npm setup failed. Expected npm at %LOCAL_NPM%.
    exit /b 1
)

set "PATH=%LOCAL_NODE_DIR%;%PATH%"
set "NPM=%LOCAL_NPM%"
exit /b 0

:download_node
set "NODE_VERSION=24.14.0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $version='%NODE_VERSION%'; $root='%ROOT%'; $tools=Join-Path $root 'tools'; $target=Join-Path $tools 'node'; $zip=Join-Path $tools ('node-v' + $version + '-win-x64.zip'); $url='https://nodejs.org/dist/v' + $version + '/node-v' + $version + '-win-x64.zip'; New-Item -ItemType Directory -Force -Path $tools | Out-Null; if (!(Test-Path -LiteralPath $zip)) { Invoke-WebRequest -Uri $url -OutFile $zip }; $tmp=Join-Path $tools ('node-extract-' + [guid]::NewGuid().ToString()); Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force; $extracted=Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1; if ($null -eq $extracted) { throw 'Node archive did not contain a directory.' }; if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }; Move-Item -LiteralPath $extracted.FullName -Destination $target; Remove-Item -LiteralPath $tmp -Recurse -Force"
exit /b %ERRORLEVEL%
