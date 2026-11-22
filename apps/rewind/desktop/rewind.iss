; RewindApp for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\RewindApp> /DOutputDir=<dist> /DIconFile=<build\rewind.ico> rewind.iss
; Installs to %LOCALAPPDATA%\Programs\RewindApp, adds RewindApp to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\RewindApp, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\RewindApp"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\rewind.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=RewindApp
AppVersion={#AppVersion}
AppVerName=RewindApp {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/rewind/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\RewindApp
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=RewindApp-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\RewindApp.exe
UninstallDisplayName=RewindApp
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\RewindApp"; Filename: "{app}\RewindApp.exe"; Comment: "Remember and share memories of old TV series that arent on todays"
Name: "{userdesktop}\RewindApp"; Filename: "{app}\RewindApp.exe"; Comment: "Remember and share memories of old TV series that arent on todays"; Tasks: desktopicon

[Run]
Filename: "{app}\RewindApp.exe"; Description: "{cm:LaunchProgram,RewindApp}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\RewindApp.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopRewindApp"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open RewindApp window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\RewindApp.exe')) then
    Exec(ExpandConstant('{app}\RewindApp.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
