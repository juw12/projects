@echo off
rem PegaTokenBenchmark - weekday MaaS token benchmark (Task Scheduler, Mon-Fri 09:00)
rem Uses the full Python path so a wiped user PATH cannot break it.
setlocal
cd /d "%~dp0"
set "PY=C:\Users\juwen_lie\AppData\Local\Programs\Python\Python313\python.exe"
set PYTHONIOENCODING=utf-8
if not exist "%PY%" (
  >> "%~dp0logs\scheduler.log" echo [%date% %time%] FATAL python not found at %PY%
  exit /b 1
)
echo [%date% %time%] START>> "%~dp0logs\scheduler.log"
"%PY%" "%~dp0benchmark.py" %* >> "%~dp0logs\scheduler.log" 2>&1
set RC=%ERRORLEVEL%
>> "%~dp0logs\scheduler.log" echo [%date% %time%] END exit=%RC%
exit /b %RC%
