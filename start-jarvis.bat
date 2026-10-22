@echo off
setlocal
cd /d "%~dp0"
title JARVIS Launcher

echo.
echo ==========================================
echo   J.A.R.V.I.S. - Local Assistant Launcher
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not on PATH.
  echo Install Node.js 20 or newer from https://nodejs.org/
  echo Then close and reopen this window.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 20 (
  echo ERROR: Node.js 20 or newer is required. Found:
  node --version
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo Dependencies are missing. Installing them with npm install...
  call npm install
  if errorlevel 1 (
    echo ERROR: Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting JARVIS. Keep this window open while it runs.
echo The app URL will appear below. Press Ctrl+C to stop.
echo.
call npm start
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" echo JARVIS exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
