@echo off
REM CrewCup demo launcher - needs only Python 3.10+ (no pip installs)
cd /d "%~dp0"
echo Starting CrewCup demo on http://localhost:8787  (close this window to stop)
start "" http://localhost:8787
python server.py --port 8787 %*
