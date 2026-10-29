; Peers for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Peers> /DOutputDir=<dist> /DIconFile=<build\peers.ico> peers.iss
; Installs to %LOCALAPPDATA%\Programs\Peers, adds Peers to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. Reviews, settings and the database (peers.db) live in %LOCALAPPDATA%\Peers, which
; uninstalling leaves in place so a reinstall finds everything again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Peers"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\peers.ico"
#endif

[Setup]
AppId={{6E7F542B-E243-5061-94F2-B339BE1B3665}
AppName=Peers
AppVersion={#AppVersion}
AppVerName=Peers {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/peers/
AppSupportURL=https://github.com/juw12/projects/tree/main/apps/peers
DefaultDirName={autopf}\Peers
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Peers-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Peers.exe
UninstallDisplayName=Peers
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
Name: "{userprograms}\Peers"; Filename: "{app}\Peers.exe"; Comment: "Verified reviews from real people"
Name: "{userdesktop}\Peers"; Filename: "{app}\Peers.exe"; Comment: "Verified reviews from real people"; Tasks: desktopicon

[Run]
Filename: "{app}\Peers.exe"; Description: "{cm:LaunchProgram,Peers}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Peers.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopPeers"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Peers window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Peers.exe')) then
    Exec(ExpandConstant('{app}\Peers.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
