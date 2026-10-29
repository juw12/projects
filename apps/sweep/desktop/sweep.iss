; Sweep for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Sweep> /DOutputDir=<dist> /DIconFile=<build\sweep.ico> sweep.iss
; Installs to %LOCALAPPDATA%\Programs\Sweep, adds Sweep to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (projects, ideas, settings) in %LOCALAPPDATA%\Sweep, which
; uninstalling leaves in place so a reinstall finds every project again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Sweep"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\sweep.ico"
#endif

[Setup]
AppId={{26670F26-CFFE-5CDB-A893-B27139AE5959}
AppName=Sweep
AppVersion={#AppVersion}
AppVerName=Sweep {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/sweep/
AppSupportURL=https://github.com/juw12/projects/tree/main/apps/sweep
DefaultDirName={autopf}\Sweep
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Sweep-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Sweep.exe
UninstallDisplayName=Sweep
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
Name: "{userprograms}\Sweep"; Filename: "{app}\Sweep.exe"; Comment: "From idea to checkable plan"
Name: "{userdesktop}\Sweep"; Filename: "{app}\Sweep.exe"; Comment: "From idea to checkable plan"; Tasks: desktopicon

[Run]
Filename: "{app}\Sweep.exe"; Description: "{cm:LaunchProgram,Sweep}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Sweep.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopSweep"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Sweep window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Sweep.exe')) then
    Exec(ExpandConstant('{app}\Sweep.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
