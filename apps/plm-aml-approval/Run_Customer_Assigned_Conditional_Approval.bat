@echo off
chcp 65001 >nul
title PLM - Customer Assigned Conditional Approval Submission
cd /d "%~dp0"

rem ---- find Python 3 (py launcher first, then python on PATH) ----
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
    where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo Python 3 was not found. Please install Python 3 ^(tick "Add python.exe to PATH"^) and run again.
    pause
    exit /b 1
)

rem ---- first run: install playwright if missing (uses your installed Edge, no browser download) ----
%PY% -c "import playwright" >nul 2>&1
if errorlevel 1 (
    echo Installing playwright for the first run...
    %PY% -m pip install --user playwright
)

%PY% "%~dp0plm_aml_final_approval.py" --mode customer-assigned --approval conditional %*
echo.
pause
