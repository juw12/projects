# Optional: adds CrewCup to the Windows Start menu (not the Desktop). Run once:
#   powershell -ExecutionPolicy Bypass -File add-start-menu-shortcut.ps1
$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $startMenu "CrewCup.lnk"))
$link.TargetPath = "wscript.exe"
$link.Arguments = '"' + (Join-Path $appDir "CrewCup.vbs") + '"'
$link.WorkingDirectory = $appDir
$link.IconLocation = (Join-Path $appDir "static\favicon.ico")
$link.Description = "CrewCup - office coffee"
$link.Save()
"Start menu shortcut created: $startMenu\CrewCup.lnk"
