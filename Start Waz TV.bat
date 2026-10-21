@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
    echo Waz TV isn't set up yet. Double-click Setup.bat first.
    pause
    exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" -m waztv
