; Fade for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Fade> /DOutputDir=<dist> /DIconFile=<build\fade.ico> fade.iss
; Installs to %LOCALAPPDATA%\Programs\Fade, adds Fade to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Fade, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Fade"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\fade.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Fade
AppVersion={#AppVersion}
AppVerName=Fade {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/fade/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\Fade
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Fade-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Fade.exe
UninstallDisplayName=Fade
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
Name: "{userprograms}\Fade"; Filename: "{app}\Fade.exe"; Comment: "Book barbers anywhere, watch haircut shorts and earn creator"
Name: "{userdesktop}\Fade"; Filename: "{app}\Fade.exe"; Comment: "Book barbers anywhere, watch haircut shorts and earn creator"; Tasks: desktopicon

[Run]
Filename: "{app}\Fade.exe"; Description: "{cm:LaunchProgram,Fade}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Fade.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopFade"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Fade window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Fade.exe')) then
    Exec(ExpandConstant('{app}\Fade.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
