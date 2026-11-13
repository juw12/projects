@echo off
rem KiniBuka online: runs the real market (no demo data) and shares it on the internet
rem through a free Cloudflare quick tunnel. Keep this window open; close it to go offline.
setlocal
cd /d "%~dp0"

set SEED_DEMO=0
set PORT=8765
set KINIBUKA_DB=%~dp0data\kinibuka-live.db
if not exist "%~dp0data" mkdir "%~dp0data"

rem The admin number (your WhatsApp number) is asked once and remembered in data\admin_phone.txt
if not defined ADMIN_PHONES if exist "%~dp0data\admin_phone.txt" set /p ADMIN_PHONES=<"%~dp0data\admin_phone.txt"
if not defined ADMIN_PHONES (
    set /p ADMIN_PHONES=Your WhatsApp number for the Admin account, e.g. 0812xxxxxxx: 
)
if not defined ADMIN_PHONES (
    echo No admin number given - stopping.
    pause
    exit /b 1
)
>"%~dp0data\admin_phone.txt" echo %ADMIN_PHONES%

where cloudflared >nul 2>nul
if errorlevel 1 (
    echo cloudflared is not installed. Install it once with:
    echo     winget install --id Cloudflare.cloudflared
    echo then run online.bat again.
    pause
    exit /b 1
)

echo Starting the KiniBuka server on port %PORT% ...
start "KiniBuka server" python server.py
timeout /t 3 /nobreak >nul

echo.
echo Opening the tunnel. Share the https://....trycloudflare.com address printed below.
echo Then sign up in the app with %ADMIN_PHONES% - that account gets the Admin tab.
echo The address changes every time you restart this; see README for a permanent one.
echo.
cloudflared tunnel --no-autoupdate --url http://localhost:%PORT%
pause
