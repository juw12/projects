@echo off
REM Stops the background CrewCup server started by CrewCup.vbs
powershell -NoProfile -Command "[System.Net.WebRequest]::DefaultWebProxy = $null; try { Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/shutdown -Body '{}' -ContentType 'application/json' | Out-Null; 'CrewCup stopped.' } catch { 'CrewCup was not running.' }"
