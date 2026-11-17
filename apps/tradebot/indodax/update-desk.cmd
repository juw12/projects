@echo off
rem Puts the newest TradeBot.exe from GitHub in this folder, then opens it.
rem Run it while no coin is held and the TradeBot window is closed. The old app is kept as
rem TradeBot.old.exe. Your .env and the sender's files are not touched.
setlocal
cd /d "%~dp0"
set "FROM=https://github.com/juw12/projects/releases/download/tradebot-desk/TradeBot.exe"

tasklist /fi "imagename eq TradeBot.exe" 2>nul | find /i "TradeBot.exe" >nul
if not errorlevel 1 (
    echo TradeBot is still open. Close its window first, then run this again.
    pause
    exit /b 1
)

rem The proxy of the sender, when .env names one.
if not defined HTTPS_PROXY for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /i "HTTPS_PROXY=" ".env" 2^>nul`) do set "HTTPS_PROXY=%%b"

echo Downloading the newest TradeBot.exe ...
curl.exe -fL --retry 3 --retry-delay 2 -o "TradeBot.new.exe" "%FROM%"
if errorlevel 1 (
    del "TradeBot.new.exe" 2>nul
    echo The download did not work. Nothing was changed.
    pause
    exit /b 1
)
for %%f in ("TradeBot.new.exe") do if %%~zf LSS 3000000 (
    del "TradeBot.new.exe" 2>nul
    echo The downloaded file is too small to be the app. Nothing was changed.
    pause
    exit /b 1
)

if exist "TradeBot.exe" move /y "TradeBot.exe" "TradeBot.old.exe" >nul
move /y "TradeBot.new.exe" "TradeBot.exe" >nul
echo Done. Opening TradeBot.
start "" "%~dp0TradeBot.exe"
