; SyncLive for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\SyncLive> /DOutputDir=<dist> /DIconFile=<build\sync.ico> sync.iss
; Installs to %LOCALAPPDATA%\Programs\SyncLive, adds SyncLive to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (your name, your rooms and your settings) in %LOCALAPPDATA%\SyncLive, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\SyncLive"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\sync.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=SyncLive
AppVersion={#AppVersion}
AppVerName=SyncLive {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/sync/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\SyncLive
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=SyncLive-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\SyncLive.exe
UninstallDisplayName=SyncLive
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
Name: "{userprograms}\SyncLive"; Filename: "{app}\SyncLive.exe"; Comment: "Listen to music together, live"
Name: "{userdesktop}\SyncLive"; Filename: "{app}\SyncLive.exe"; Comment: "Listen to music together, live"; Tasks: desktopicon

[Run]
Filename: "{app}\SyncLive.exe"; Description: "{cm:LaunchProgram,SyncLive}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\SyncLive.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopSyncLive"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open SyncLive window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\SyncLive.exe')) then
    Exec(ExpandConstant('{app}\SyncLive.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
