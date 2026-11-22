; TogetherApp for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\TogetherApp> /DOutputDir=<dist> /DIconFile=<build\together.ico> together.iss
; Installs to %LOCALAPPDATA%\Programs\TogetherApp, adds TogetherApp to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\TogetherApp, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\TogetherApp"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\together.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=TogetherApp
AppVersion={#AppVersion}
AppVerName=TogetherApp {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/together/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\TogetherApp
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=TogetherApp-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\TogetherApp.exe
UninstallDisplayName=TogetherApp
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
Name: "{userprograms}\TogetherApp"; Filename: "{app}\TogetherApp.exe"; Comment: "Plan your whole life together: roadmap, goals"
Name: "{userdesktop}\TogetherApp"; Filename: "{app}\TogetherApp.exe"; Comment: "Plan your whole life together: roadmap, goals"; Tasks: desktopicon

[Run]
Filename: "{app}\TogetherApp.exe"; Description: "{cm:LaunchProgram,TogetherApp}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\TogetherApp.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopTogetherApp"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open TogetherApp window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\TogetherApp.exe')) then
    Exec(ExpandConstant('{app}\TogetherApp.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
