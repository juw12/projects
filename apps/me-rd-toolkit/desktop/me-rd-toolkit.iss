; ME R&D Toolkit for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\ME-RD-Toolkit> /DOutputDir=<dist> /DIconFile=<build\me-rd-toolkit.ico> me-rd-toolkit.iss
; Installs to %LOCALAPPDATA%\Programs\ME-RD-Toolkit, adds ME R&D Toolkit to the Start menu (and optionally the desktop)
; and lists it in Settings > Apps. Projects (storage.json), the data pack and vault config (private\) live in
; %LOCALAPPDATA%\ME-RD-Toolkit, which uninstalling leaves in place so a reinstall finds everything again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\ME-RD-Toolkit"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\me-rd-toolkit.ico"
#endif

[Setup]
AppId={{CB251226-EA3A-52DF-9BCB-58BBCD46E883}
AppName=ME R&D Toolkit
AppVersion={#AppVersion}
AppVerName=ME R&D Toolkit {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/me-rd-toolkit/
AppSupportURL=https://github.com/juw12/projects/tree/main/apps/me-rd-toolkit
DefaultDirName={autopf}\ME-RD-Toolkit
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=ME-RD-Toolkit-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\ME-RD-Toolkit.exe
UninstallDisplayName=ME R&D Toolkit
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
Name: "{userprograms}\ME R&D Toolkit"; Filename: "{app}\ME-RD-Toolkit.exe"; Comment: "Mechanical R&D workspace"
Name: "{userdesktop}\ME R&D Toolkit"; Filename: "{app}\ME-RD-Toolkit.exe"; Comment: "Mechanical R&D workspace"; Tasks: desktopicon

[Run]
Filename: "{app}\ME-RD-Toolkit.exe"; Description: "{cm:LaunchProgram,ME R&D Toolkit}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\ME-RD-Toolkit.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopMERDToolkit"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open toolkit window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\ME-RD-Toolkit.exe')) then
    Exec(ExpandConstant('{app}\ME-RD-Toolkit.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
