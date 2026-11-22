; Pips for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Pips> /DOutputDir=<dist> /DIconFile=<build\pips.ico> pips.iss
; Installs to %LOCALAPPDATA%\Programs\Pips, adds Pips to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Pips, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Pips"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\pips.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Pips
AppVersion={#AppVersion}
AppVerName=Pips {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/pips/web.html
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\Pips
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Pips-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Pips.exe
UninstallDisplayName=Pips
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
Name: "{userprograms}\Pips"; Filename: "{app}\Pips.exe"; Comment: "Pomodoro widget with animated animals, skill battles and minigames"
Name: "{userdesktop}\Pips"; Filename: "{app}\Pips.exe"; Comment: "Pomodoro widget with animated animals, skill battles and minigames"; Tasks: desktopicon

[Run]
Filename: "{app}\Pips.exe"; Description: "{cm:LaunchProgram,Pips}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Pips.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopPips"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Pips window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Pips.exe')) then
    Exec(ExpandConstant('{app}\Pips.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
