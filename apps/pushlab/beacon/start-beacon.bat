@echo off
rem Start Beacon locally (console at http://127.0.0.1:8780). The first start prints the admin token.
cd /d "%~dp0"
python server\server.py %*
pause
