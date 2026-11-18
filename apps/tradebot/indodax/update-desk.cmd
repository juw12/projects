@echo off
rem Puts the newest TradeBot.exe from GitHub in this folder, then opens it.
rem Run it while no coin is held and the TradeBot window is closed. The old app is kept as
rem TradeBot.old.exe. Your .env and the sender's files are not touched.
rem A sender that runs without the window (the Windows task "TradeBot sender") keeps running
rem during the download. It is stopped only for the few seconds of the swap, then started again.
setlocal
cd /d "%~dp0"
set "FROM=https://github.com/juw12/projects/releases/download/tradebot-desk/TradeBot.exe"
set "TASK=TradeBot sender"
set "BACKGROUND="
schtasks /query /tn "%TASK%" >nul 2>nul
if not errorlevel 1 set "BACKGROUND=1"

rem The window must be closed. Without the task, any running TradeBot.exe is the window and its sender.
if defined BACKGROUND (
    tasklist /v /fi "imagename eq TradeBot.exe" /fo csv /nh 2>nul | find /i "Indodax" >nul
) else (
    tasklist /fi "imagename eq TradeBot.exe" 2>nul | find /i "TradeBot.exe" >nul
)
if not errorlevel 1 (
    echo TradeBot is still open. Close its window first, then run this again.
    pause
    exit /b 1
)

rem The proxy of the sender, when .env names one, goes first. When the download fails
rem through it, the PC's own HTTPS_PROXY is tried.
set "PC_PROXY=%HTTPS_PROXY%"
for /f "usebackq tokens=1,* delims==" %%a in (`findstr /b /i "HTTPS_PROXY=" ".env" 2^>nul`) do set "HTTPS_PROXY=%%b"

echo Downloading the newest TradeBot.exe ...
curl.exe -fL --retry 3 --retry-delay 2 -o "TradeBot.new.exe" "%FROM%"
if errorlevel 1 if defined PC_PROXY if not "%PC_PROXY%"=="%HTTPS_PROXY%" (
    echo Trying the other proxy ...
    curl.exe -fL --retry 3 --retry-delay 2 -x "%PC_PROXY%" -o "TradeBot.new.exe" "%FROM%"
)
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

rem The sender without a window is stopped now, for the swap only.
if defined BACKGROUND (
    schtasks /end /tn "%TASK%" >nul 2>nul
    ping -n 4 127.0.0.1 >nul
    tasklist /fi "imagename eq TradeBot.exe" 2>nul | find /i "TradeBot.exe" >nul
    if not errorlevel 1 (
        schtasks /run /tn "%TASK%" >nul 2>nul
        del "TradeBot.new.exe" 2>nul
        echo TradeBot is still open. Close its window first, then run this again. Nothing was changed.
        pause
        exit /b 1
    )
)

if exist "TradeBot.exe" move /y "TradeBot.exe" "TradeBot.old.exe" >nul
move /y "TradeBot.new.exe" "TradeBot.exe" >nul
rem A sender you stopped yourself stays stopped: Windows does not run a task that is switched off.
if defined BACKGROUND schtasks /run /tn "%TASK%" >nul 2>nul
echo Done. Opening TradeBot.
start "" "%~dp0TradeBot.exe"
