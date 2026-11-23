; PLMAMLApproval for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\PLMAMLApproval> /DOutputDir=<dist> /DIconFile=<build\plmamlapproval.ico> plmamlapproval.iss
; Installs to %LOCALAPPDATA%\Programs\PLMAMLApproval, adds PLMAMLApproval to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\PLMAMLApproval, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\PLMAMLApproval"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\plmamlapproval.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=PLMAMLApproval
AppVersion={#AppVersion}
AppVerName=PLMAMLApproval {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/plm-aml-approval/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\PLMAMLApproval
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=PLMAMLApproval-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\PLMAMLApproval.exe
UninstallDisplayName=PLMAMLApproval
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
Name: "{userprograms}\PLMAMLApproval"; Filename: "{app}\PLMAMLApproval.exe"; Comment: "Fills a PLM part-approval workflow in Edge and stops before Submit"
Name: "{userdesktop}\PLMAMLApproval"; Filename: "{app}\PLMAMLApproval.exe"; Comment: "Fills a PLM part-approval workflow in Edge and stops before Submit"; Tasks: desktopicon

[Run]
Filename: "{app}\PLMAMLApproval.exe"; Description: "{cm:LaunchProgram,PLMAMLApproval}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\PLMAMLApproval.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopPLMAMLApproval"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open PLMAMLApproval window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\PLMAMLApproval.exe')) then
    Exec(ExpandConstant('{app}\PLMAMLApproval.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
