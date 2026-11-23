; Sortie for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Sortie> /DOutputDir=<dist> /DIconFile=<build\sortie.ico> sortie.iss
; Installs to %LOCALAPPDATA%\Programs\Sortie, adds Sortie to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Sortie, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Sortie"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\sortie.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Sortie
AppVersion={#AppVersion}
AppVerName=Sortie {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/sortie/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\Sortie
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Sortie-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Sortie.exe
UninstallDisplayName=Sortie
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
Name: "{userprograms}\Sortie"; Filename: "{app}\Sortie.exe"; Comment: "A file organizer that is fun to use"
Name: "{userdesktop}\Sortie"; Filename: "{app}\Sortie.exe"; Comment: "A file organizer that is fun to use"; Tasks: desktopicon

[Run]
Filename: "{app}\Sortie.exe"; Description: "{cm:LaunchProgram,Sortie}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Sortie.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopSortie"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Sortie window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Sortie.exe')) then
    Exec(ExpandConstant('{app}\Sortie.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
