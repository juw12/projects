@echo off
rem KiniBuka online: runs the real market (no demo data) and shares it on the internet
rem through a free Cloudflare quick tunnel. Keep this window open; close it to go offline.
rem Admin login: user "admin", password "admin" - change it in Account right after the first login.
setlocal
cd /d "%~dp0"

set SEED_DEMO=0
set PORT=8765
set KINIBUKA_DB=%~dp0data\kinibuka-live.db
if not exist "%~dp0data" mkdir "%~dp0data"

rem Find cloudflared: on PATH, the winget/MSI install folders, or the portable copy in tools\
set "CLOUDFLARED="
for %%P in (cloudflared.exe) do if not "%%~$PATH:P"=="" set "CLOUDFLARED=%%~$PATH:P"
if not defined CLOUDFLARED if exist "%~dp0tools\cloudflared.exe" set "CLOUDFLARED=%~dp0tools\cloudflared.exe"
if not defined CLOUDFLARED if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CLOUDFLARED=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CLOUDFLARED=%ProgramFiles%\cloudflared\cloudflared.exe"
if not defined CLOUDFLARED (
    echo cloudflared was not found. Either install it once with
    echo     winget install --id Cloudflare.cloudflared
    echo or download cloudflared-windows-amd64.exe from
    echo     https://github.com/cloudflare/cloudflared/releases/latest
    echo and save it as tools\cloudflared.exe next to this file. Then run online.bat again.
    pause
    exit /b 1
)

set "PYTHON=python"
where python >nul 2>nul || set "PYTHON=py"

echo Starting the KiniBuka server on port %PORT% ...
start "KiniBuka server" /min %PYTHON% server.py
timeout /t 3 /nobreak >nul

echo.
echo Opening the tunnel. Share the https://....trycloudflare.com address printed below
echo (it is also saved in data\tunnel.log).
echo Admin login: user admin, password admin - change the password in Account straight away.
echo The address changes every time you restart this; see README for a permanent one.
echo.
if exist "%~dp0data\tunnel.log" del "%~dp0data\tunnel.log"
"%CLOUDFLARED%" tunnel --no-autoupdate --logfile "%~dp0data\tunnel.log" --url http://localhost:%PORT%
pause
