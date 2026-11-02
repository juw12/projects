' CrewCup desktop app launcher: starts the local server hidden (if needed)
' and opens CrewCup in its own app window (Microsoft Edge app mode).
Option Explicit
Dim shell, fso, appDir, edgePath, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = appDir

If Not ServerUp() Then
    shell.Run "pythonw """ & appDir & "\server.py"" --port 8787", 0, False
    For i = 1 To 60
        WScript.Sleep 250
        If ServerUp() Then Exit For
    Next
End If

edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edgePath) Then
    edgePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe"
End If
If fso.FileExists(edgePath) Then
    shell.Run """" & edgePath & """ --app=http://localhost:8787/?source=desktop --window-size=1280,860", 1, False
Else
    shell.Run "http://localhost:8787/?source=desktop", 1, False
End If

Function ServerUp()
    Dim http
    On Error Resume Next
    Set http = CreateObject("MSXML2.ServerXMLHTTP")
    http.setTimeouts 500, 500, 500, 500
    http.setProxy 1  ' direct connection, ignore any system proxy
    http.Open "GET", "http://127.0.0.1:8787/api/health", False
    http.Send
    ServerUp = (Err.Number = 0)
    If ServerUp Then ServerUp = (http.Status = 200)
    Err.Clear
    On Error GoTo 0
End Function
