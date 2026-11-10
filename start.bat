@echo off
title Teller
cd /d "%~dp0"

echo ========================================================
echo                  Starting Teller Desktop...
echo ========================================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python environment not found in .venv.
    echo Please ensure the project virtualenv is present.
    pause
    exit /b 1
)

cd desktop
call npm run tauri dev
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Teller exited with error code %ERRORLEVEL%.
    pause
)
