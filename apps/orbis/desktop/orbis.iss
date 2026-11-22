; Orbis for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Orbis> /DOutputDir=<dist> /DIconFile=<build\orbis.ico> orbis.iss
; Installs to %LOCALAPPDATA%\Programs\Orbis, adds Orbis to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Orbis, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Orbis"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\orbis.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Orbis
AppVersion={#AppVersion}
AppVerName=Orbis {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/orbis/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\Orbis
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Orbis-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Orbis.exe
UninstallDisplayName=Orbis
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
Name: "{userprograms}\Orbis"; Filename: "{app}\Orbis.exe"; Comment: "Communication, identity and protection in one app"
Name: "{userdesktop}\Orbis"; Filename: "{app}\Orbis.exe"; Comment: "Communication, identity and protection in one app"; Tasks: desktopicon

[Run]
Filename: "{app}\Orbis.exe"; Description: "{cm:LaunchProgram,Orbis}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Orbis.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopOrbis"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Orbis window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Orbis.exe')) then
    Exec(ExpandConstant('{app}\Orbis.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
