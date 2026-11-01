@echo off
rem Start Tether and open it in the browser. Add --lan to share on your network.
cd /d "%~dp0"
python server\server.py %*
pause
