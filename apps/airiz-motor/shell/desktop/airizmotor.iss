; AirizMotor for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\AirizMotor> /DOutputDir=<dist> /DIconFile=<build\airizmotor.ico> airizmotor.iss
; Installs to %LOCALAPPDATA%\Programs\AirizMotor, adds AirizMotor to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\AirizMotor, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\AirizMotor"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\airizmotor.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=AirizMotor
AppVersion={#AppVersion}
AppVerName=AirizMotor {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/airiz-motor/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\AirizMotor
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=AirizMotor-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\AirizMotor.exe
UninstallDisplayName=AirizMotor
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
Name: "{userprograms}\AirizMotor"; Filename: "{app}\AirizMotor.exe"; Comment: "Console for the AIRIZ rig: remote control by code, camera and device checks"
Name: "{userdesktop}\AirizMotor"; Filename: "{app}\AirizMotor.exe"; Comment: "Console for the AIRIZ rig: remote control by code, camera and device checks"; Tasks: desktopicon

[Run]
Filename: "{app}\AirizMotor.exe"; Description: "{cm:LaunchProgram,AirizMotor}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\AirizMotor.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopAirizMotor"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open AirizMotor window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\AirizMotor.exe')) then
    Exec(ExpandConstant('{app}\AirizMotor.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
