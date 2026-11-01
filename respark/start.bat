@echo off
REM Respark - one-click local launcher (Windows)

cd /d "%~dp0"

if not exist .env (
    echo [setup] .env not found, creating from .env.example...
    copy .env.example .env >nul
    powershell -NoProfile -Command "$rand = -join ((33..126) | Get-Random -Count 48 | ForEach-Object {[char]$_}); (Get-Content .env) -replace '^RESPARK_SECRET=.*','RESPARK_SECRET=' + $rand | Set-Content .env"
    echo [setup] .env created with random RESPARK_SECRET.
    echo.
    echo [next] Edit .env to set RESPARK_SMTP_* and RESPARK_STRIPE_* when ready.
    echo        The server works without them (logs emails to logs\outbox.log,
    echo        shows "Stripe not configured" on checkout buttons).
    echo.
)

echo [start] Launching Respark on http://localhost:8000 ...
echo        Press Ctrl+C to stop.
echo.

python server\server.py
