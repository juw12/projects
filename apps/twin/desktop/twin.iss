; Twin for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Twin> /DOutputDir=<dist> /DIconFile=<build\twin.ico> twin.iss
; Installs to %LOCALAPPDATA%\Programs\Twin, adds Twin to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. Accounts, broker connections and Twin's own code copy live in %LOCALAPPDATA%\Twin, which
; uninstalling leaves in place so a reinstall finds every account again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Twin"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\twin.ico"
#endif

[Setup]
AppId={{BEC921D2-73CA-534F-B2C8-9D8897668860}
AppName=Twin
AppVersion={#AppVersion}
AppVerName=Twin {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/twin/
AppSupportURL=https://github.com/juw12/projects/tree/main/apps/twin
DefaultDirName={autopf}\Twin
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Twin-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Twin.exe
UninstallDisplayName=Twin
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
Name: "{userprograms}\Twin"; Filename: "{app}\Twin.exe"; Comment: "Invest and trade with your own broker"
Name: "{userdesktop}\Twin"; Filename: "{app}\Twin.exe"; Comment: "Invest and trade with your own broker"; Tasks: desktopicon

[Run]
Filename: "{app}\Twin.exe"; Description: "{cm:LaunchProgram,Twin}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Twin.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopTwin"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Twin window (and its server) first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Twin.exe')) then
    Exec(ExpandConstant('{app}\Twin.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
