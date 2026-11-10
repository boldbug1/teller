@echo off
title Teller
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "RELEASE_EXE=%~dp0desktop\src-tauri\target\release\teller-desktop.exe"

echo ========================================================
echo                      Teller
echo        Multi-Voice Audio Storytelling Studio
echo ========================================================
echo.

rem If user specifically requested web mode
if "%1"=="--web" goto run_web
if "%1"=="--dev" goto run_dev

rem Check if pre-compiled desktop binary exists
if exist "%RELEASE_EXE%" (
    echo [INFO] Found packaged desktop application.
    echo [INFO] Starting Teller Desktop...
    echo [INFO] Python engine will start automatically in the background.
    echo.
    rem Clean up any orphaned sidecar instances from previous forced exits
    taskkill /f /im teller-sidecar-x86_64-pc-windows-msvc.exe >nul 2>&1
    taskkill /f /im teller-sidecar.exe >nul 2>&1
    start "" "%RELEASE_EXE%"
    goto finish
)

:run_dev
rem Verify Python environment
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python environment not found in .venv.
    echo Please ensure the project virtualenv is present.
    pause
    exit /b 1
)

echo [INFO] Packaged binary not found. Running in Development mode...
echo [INFO] The desktop shell will automatically launch the Python backend
echo        sidecar on a secure local port and hook up the UI.
echo.

cd desktop
call npm run tauri dev
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Teller exited with error code %ERRORLEVEL%.
    pause
)
goto finish

:run_web
echo [INFO] Starting Teller in Web Browser mode...
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python virtualenv not found in .venv.
    pause
    exit /b 1
)

start "Teller Backend" cmd /k "cd /d %~dp0 && .venv\Scripts\python.exe -m teller.server --port 8000"
cd desktop
call npm run dev

:finish
