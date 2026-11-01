' VBScript: silently start PTB RDME Widget with no console window.
' Use this if you want it to keep running in the background.
' To stop: taskkill /im pythonw.exe /f /fi "windowtitle eq PTB*"

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d """ & Replace(CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & """ && pythonw -m server", 0, False
