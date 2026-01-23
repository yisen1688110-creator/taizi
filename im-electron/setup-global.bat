@echo off
setlocal
echo ==========================================
echo GQ Agent Desktop Setup V6.1 (Global)
echo ==========================================

echo Select Mode:
echo [1] Full Install (Build .exe installer)
echo [2] Run Directly (No install, for testing)
set /p mode="Enter 1 or 2: "

echo.
echo [1/3] Configuring environment (Global Mode)...
REM clear mirrors to use default
set ELECTRON_MIRROR=
set ELECTRON_BUILDER_BINARIES_MIRROR=
set NPM_CONFIG_REGISTRY=
set ELECTRON_BUILDER_CACHE=%cd%\builder-cache

if exist node_modules (
    echo node_modules exists, skipping clean install...
) else (
    echo [2/3] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Install failed.
        pause
        exit /b %errorlevel%
    )
)

if "%mode%"=="2" (
    echo [3/3] Starting App...
    call npm start
    if %errorlevel% neq 0 (
        echo [ERROR] App exited with code %errorlevel%.
    )
    pause
    goto :EOF
)

echo [3/3] Building Installer...
call npm run dist
if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    echo Try restarting this script and choosing Option 2 to run it directly.
    pause
    exit /b %errorlevel%
)

echo.
echo ==========================================
echo Build SUCCESS! 
echo Installer is in: %cd%\dist
echo ==========================================
pause
