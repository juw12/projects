; GameLibrary for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\GameLibrary> /DOutputDir=<dist> /DIconFile=<build\gamelib.ico> gamelib.iss
; Installs to %LOCALAPPDATA%\Programs\GameLibrary, adds GameLibrary to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\GameLibrary, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\GameLibrary"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\gamelib.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=GameLibrary
AppVersion={#AppVersion}
AppVerName=GameLibrary {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/gamelib/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\GameLibrary
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=GameLibrary-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\GameLibrary.exe
UninstallDisplayName=GameLibrary
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
Name: "{userprograms}\GameLibrary"; Filename: "{app}\GameLibrary.exe"; Comment: "A searchable collection of browser games by category"
Name: "{userdesktop}\GameLibrary"; Filename: "{app}\GameLibrary.exe"; Comment: "A searchable collection of browser games by category"; Tasks: desktopicon

[Run]
Filename: "{app}\GameLibrary.exe"; Description: "{cm:LaunchProgram,GameLibrary}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\GameLibrary.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopGameLibrary"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open GameLibrary window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\GameLibrary.exe')) then
    Exec(ExpandConstant('{app}\GameLibrary.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
