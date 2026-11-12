@echo off
title Teller
setlocal
cd /d "%~dp0"

set "RELEASE_EXE=%~dp0desktop\src-tauri\target\release\teller-desktop.exe"
set "TAURI_CMD=%~dp0desktop\node_modules\.bin\tauri.cmd"

echo ========================================================
echo                      Teller
echo        Multi-Voice Audio Storytelling Studio
echo ========================================================
echo.

if /I "%~1"=="--web" goto run_web
if /I "%~1"=="--dev" goto run_dev
if /I "%~1"=="--release" goto run_release
if not "%~1"=="" goto usage

rem A source checkout should launch the current UI, not an older embedded build.
if exist "%TAURI_CMD%" (
    where npm >nul 2>&1
    if not errorlevel 1 (
        where cargo >nul 2>&1
        if not errorlevel 1 goto run_dev
    )
)

rem Fall back to the packaged app on machines without the development toolchain.
goto run_release

:run_release
if not exist "%RELEASE_EXE%" (
    echo [ERROR] Packaged application not found:
    echo         %RELEASE_EXE%
    echo.
    echo Run "start.bat --dev" for the current source, or build a release with:
    echo   cd desktop
    echo   npm run tauri build -- --no-bundle
    pause
    exit /b 1
)

echo [INFO] Starting the packaged Teller Desktop build...
echo [INFO] Use "start.bat --dev" to run the latest source instead.
echo.
taskkill /f /im teller-sidecar-x86_64-pc-windows-msvc.exe >nul 2>&1
taskkill /f /im teller-sidecar.exe >nul 2>&1
start "" "%RELEASE_EXE%"
goto finish

:run_dev
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js 18 or newer.
    pause
    exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Cargo was not found. Install the Rust toolchain.
    pause
    exit /b 1
)
if not exist "%TAURI_CMD%" (
    echo [ERROR] Desktop dependencies are missing.
    echo Run "npm install" inside the desktop folder first.
    pause
    exit /b 1
)
if not exist "desktop\src-tauri\binaries\teller-sidecar-x86_64-pc-windows-msvc.exe" if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Neither the Teller sidecar nor the Python virtualenv was found.
    echo Build the sidecar or create the project virtualenv first.
    pause
    exit /b 1
)

echo [INFO] Starting the latest Teller source with Tauri hot reload...
echo [INFO] Closing any older Teller instance first...
echo.
taskkill /f /im teller-desktop.exe >nul 2>&1
taskkill /f /im teller-sidecar-x86_64-pc-windows-msvc.exe >nul 2>&1
taskkill /f /im teller-sidecar.exe >nul 2>&1

pushd desktop
call npm run tauri dev
set "TAURI_EXIT=%ERRORLEVEL%"
popd
if not "%TAURI_EXIT%"=="0" (
    echo.
    echo [ERROR] Teller exited with error code %TAURI_EXIT%.
    pause
    exit /b %TAURI_EXIT%
)
goto finish

:run_web
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python virtualenv not found in .venv.
    pause
    exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js 18 or newer.
    pause
    exit /b 1
)

echo [INFO] Starting Teller in browser mode...
start "Teller Backend" cmd /k "cd /d %~dp0 && .venv\Scripts\python.exe -m teller.server --port 8000"
pushd desktop
call npm run dev
popd
goto finish

:usage
echo Usage: start.bat [--dev ^| --release ^| --web]
exit /b 2

:finish
endlocal
