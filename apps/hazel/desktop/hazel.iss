; HazelApp for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\HazelApp> /DOutputDir=<dist> /DIconFile=<build\hazel.ico> hazel.iss
; Installs to %LOCALAPPDATA%\Programs\HazelApp, adds HazelApp to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\HazelApp, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\HazelApp"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\hazel.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=HazelApp
AppVersion={#AppVersion}
AppVerName=HazelApp {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/hazel/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\HazelApp
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=HazelApp-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\HazelApp.exe
UninstallDisplayName=HazelApp
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
Name: "{userprograms}\HazelApp"; Filename: "{app}\HazelApp.exe"; Comment: "One studio for shorts, sped-up edits and long videos"
Name: "{userdesktop}\HazelApp"; Filename: "{app}\HazelApp.exe"; Comment: "One studio for shorts, sped-up edits and long videos"; Tasks: desktopicon

[Run]
Filename: "{app}\HazelApp.exe"; Description: "{cm:LaunchProgram,HazelApp}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\HazelApp.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopHazelApp"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open HazelApp window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\HazelApp.exe')) then
    Exec(ExpandConstant('{app}\HazelApp.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
