@echo off
REM Start PTB RDME Widget.
REM
REM First-time: ensure Outlook is installed (only needed if you want the
REM Email Drafts tab to read your local Outlook Drafts folder).

setlocal
cd /d "%~dp0"

if "%PTB_RDME_PORT%"=="" set PTB_RDME_PORT=8050

echo Starting PTB RDME Widget on http://0.0.0.0:%PTB_RDME_PORT%
echo Web UI:    http://localhost:%PTB_RDME_PORT%/
echo Logs:      logs\app.log
echo.
echo Press Ctrl+C to stop.
echo.

python -m server --port %PTB_RDME_PORT%
