; ECoder for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\ECoder> /DOutputDir=<dist> /DIconFile=<build\ecoder.ico> ecoder.iss
; Installs to %LOCALAPPDATA%\Programs\ECoder, adds ECoder to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\ECoder, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\ECoder"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\ecoder.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=ECoder
AppVersion={#AppVersion}
AppVerName=ECoder {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/e-coder/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\ECoder
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=ECoder-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\ECoder.exe
UninstallDisplayName=ECoder
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
Name: "{userprograms}\ECoder"; Filename: "{app}\ECoder.exe"; Comment: "A stdlib-only coding agent that runs on your own machine"
Name: "{userdesktop}\ECoder"; Filename: "{app}\ECoder.exe"; Comment: "A stdlib-only coding agent that runs on your own machine"; Tasks: desktopicon

[Run]
Filename: "{app}\ECoder.exe"; Description: "{cm:LaunchProgram,ECoder}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\ECoder.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopECoder"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open ECoder window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\ECoder.exe')) then
    Exec(ExpandConstant('{app}\ECoder.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
