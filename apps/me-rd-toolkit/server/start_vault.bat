@echo off
title ME R&D File Vault
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 is required: https://www.python.org/downloads/ & pause & exit /b 1)
python vault_server.py %*
pause
