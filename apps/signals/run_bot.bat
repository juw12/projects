@echo off
cd /d "~\Documents\Default Project\apps\crypto-signal-bot"
call ".venv\Scripts\activate.bat"
echo [%date% %time%] bot starting >> bot.log
".venv\Scripts\pythonw.exe" bot.py >> bot.log 2>&1
echo [%date% %time%] bot exited with code %ERRORLEVEL% >> bot.log
