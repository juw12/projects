@echo off
rem Starts Glow Hands with Microsoft Edge, so no extra browser download is needed.
cd /d "%~dp0"
python -m pip show playwright >nul 2>&1 || python -m pip install --user playwright
python glow_hands.py --channel msedge %*
pause
