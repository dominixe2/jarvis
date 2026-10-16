@echo off
setlocal
title Springtrap
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo Python nebyl nalezen. Nainstaluj Python 3.10+ a pri instalaci zaskrtni Add Python to PATH.
    echo https://www.python.org/downloads/windows/
    pause
    exit /b 1
  )
  set "PYTHON_CMD=py"
) else (
  set "PYTHON_CMD=python"
)

if not defined GEMINI_API_KEY (
  echo.
  echo Vloz Gemini API klic. Klic se neulozi do souboru, plati jen pro toto okno.
  set /p "GEMINI_API_KEY=API klic: "
)
if not defined GEMINI_API_KEY (
  echo Chybi API klic. Aplikaci lze otevrit, ale Gemini nebude odpovidat.
)

%PYTHON_CMD% app.py
if errorlevel 1 (
  echo.
  echo Springtrap se nepodarilo spustit. Zkontroluj chybu vyse.
  pause
)
endlocal
