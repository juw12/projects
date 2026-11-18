@echo off
rem Opens TradeBot's Indodax desk: one window that runs the sender and shows what it does.
rem No console window stays open. Close the desk window to stop the sender, unless the sender
rem runs without the window (the button "Run without this window" in it).
rem TradeBot.exe (the app from GitHub, no Python needed) is used when it is in this folder.
cd /d "%~dp0"
if exist "%~dp0TradeBot.exe" (start "" "%~dp0TradeBot.exe" %* & exit /b)
where pyw >nul 2>nul && (start "" pyw desk.py %* & exit /b)
start "" pythonw desk.py %*
