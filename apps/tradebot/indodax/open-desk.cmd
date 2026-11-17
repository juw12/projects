@echo off
rem Opens TradeBot's Indodax desk: one window that runs the sender and shows what it does.
rem No console window stays open. Close the desk window to stop the sender.
cd /d "%~dp0"
where pyw >nul 2>nul && (start "" pyw desk.py %* & exit /b)
start "" pythonw desk.py %*
