@echo off
echo ==========================================
echo GQ DEBUG RUNNER
echo ==========================================
echo.
echo [1] Checking for Node.js...
node -v
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is NOT installed or NOT in PATH.
    echo Please download and install Node.js from https://nodejs.org/
    pause
    exit /b
)
echo Node.js found.
echo.

echo [2] Checking for NPM...
call npm -v
if %errorlevel% neq 0 (
    echo [ERROR] NPM is NOT installed.
    pause
    exit /b
)
echo NPM found.
echo.

echo [3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] npm install failed.
    pause
    exit /b
)
echo Dependencies installed.
echo.

echo [4] Starting Electron App...
call npm start
if %errorlevel% neq 0 (
    echo [ERROR] npm start failed.
)
echo.
echo App closed.
pause
