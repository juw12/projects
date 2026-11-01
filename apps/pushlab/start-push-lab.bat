@echo off
rem Push Lab: Beacon + Tether, linked, in one double-click. Ctrl+C (or close) stops both.
cd /d "%~dp0"
python pushlab.py %*
pause
