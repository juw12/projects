; KiniBuka for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\KiniBuka> /DOutputDir=<dist> /DIconFile=<build\kinibuka.ico> kinibuka.iss
; Installs to %LOCALAPPDATA%\Programs\KiniBuka, adds KiniBuka to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\KiniBuka, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\KiniBuka"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\kinibuka.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=KiniBuka
AppVersion={#AppVersion}
AppVerName=KiniBuka {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/kinibuka/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\KiniBuka
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=KiniBuka-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\KiniBuka.exe
UninstallDisplayName=KiniBuka
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
Name: "{userprograms}\KiniBuka"; Filename: "{app}\KiniBuka.exe"; Comment: "Find small stalls that are open right now"
Name: "{userdesktop}\KiniBuka"; Filename: "{app}\KiniBuka.exe"; Comment: "Find small stalls that are open right now"; Tasks: desktopicon

[Run]
Filename: "{app}\KiniBuka.exe"; Description: "{cm:LaunchProgram,KiniBuka}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\KiniBuka.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopKiniBuka"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open KiniBuka window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\KiniBuka.exe')) then
    Exec(ExpandConstant('{app}\KiniBuka.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
