@echo off
setlocal
cd /d "%~dp0"
title Clearstream setup
echo.
echo  Clearstream setup
echo  =================
echo.

rem --- 1. Python ---------------------------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto :nopython
%PY% -c "import sys,struct; sys.exit(0 if sys.version_info>=(3,10) and struct.calcsize('P')==8 else 1)" >nul 2>nul
if errorlevel 1 goto :nopython
echo  [ok] Python found.

rem --- 2. VLC -----------------------------------------------------------------
if exist "%ProgramFiles%\VideoLAN\VLC\libvlc.dll" (
    echo  [ok] VLC 64-bit found.
) else (
    echo  [!!] 64-bit VLC was not found in "%ProgramFiles%\VideoLAN\VLC".
    echo       Install it from https://www.videolan.org  then run Setup again.
    echo.
    pause
    exit /b 1
)

rem --- 3. Private Python environment with the one pinned package --------------
if not exist ".venv\Scripts\python.exe" (
    echo  Creating a private Python environment for Clearstream...
    %PY% -m venv .venv || goto :failed
)
echo  Installing python-vlc (hash-checked, from the official Python Package Index)...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check --quiet --no-deps --only-binary :all: --require-hashes -r requirements.txt || goto :failed
echo  [ok] python-vlc installed.

rem --- 4. Desktop shortcut ----------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Clearstream.lnk');" ^
  "$s.TargetPath='%~dp0.venv\Scripts\pythonw.exe'; $s.Arguments='-m clearstream'; $s.WorkingDirectory='%~dp0';" ^
  "$s.IconLocation='%ProgramFiles%\VideoLAN\VLC\vlc.exe,0'; $s.Description='Clearstream'; $s.Save()" >nul 2>nul
if errorlevel 1 (
    echo  [--] Could not create a desktop shortcut. Use "Start Clearstream.bat" instead.
) else (
    echo  [ok] Desktop shortcut "Clearstream" created.
)

echo.
echo  All done. Start Clearstream from the desktop shortcut or "Start Clearstream.bat".
echo.
pause
exit /b 0

:nopython
echo  [!!] 64-bit Python 3.10 or newer was not found.
echo       Install it from https://www.python.org/downloads/windows/
echo       (tick "Add python.exe to PATH" on the first installer screen), then run Setup again.
echo.
pause
exit /b 1

:failed
echo.
echo  [!!] Setup failed. Check your internet connection and run Setup again.
echo.
pause
exit /b 1
