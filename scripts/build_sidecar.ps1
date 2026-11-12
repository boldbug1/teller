# Build script for Teller Python sidecar using PyInstaller
$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path "$PSScriptRoot\.."
$OutputDir = "$RootDir\desktop\src-tauri\binaries"

if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
}

$VenvPython = "$RootDir\.venv\Scripts\python.exe"
$VenvPyInstaller = "$RootDir\.venv\Scripts\pyinstaller.exe"

if (!(Test-Path $VenvPyInstaller)) {
    Write-Error "PyInstaller not found in .venv. Run: pip install pyinstaller"
}

Write-Host "Building Teller Python sidecar..." -ForegroundColor Cyan

# Target name conforms to Tauri externalBin: teller-sidecar-<target-triple>.exe
$TargetName = "teller-sidecar-x86_64-pc-windows-msvc"

& $VenvPyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --name $TargetName `
    --distpath $OutputDir `
    --workpath "$RootDir\build\pyinstaller" `
    --specpath "$RootDir\build" `
    --paths "$RootDir\src" `
    --collect-all "teller" `
    --collect-all "kokoro_onnx" `
    --collect-all "espeakng_loader" `
    --collect-all "phonemizer" `
    --hidden-import "uvicorn" `
    --hidden-import "fastapi" `
    --hidden-import "starlette" `
    "$RootDir\src\teller\server.py"

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
}

Write-Host "Sidecar successfully built at $OutputDir\$TargetName.exe" -ForegroundColor Green
