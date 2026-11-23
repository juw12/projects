; PushLab for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\PushLab> /DOutputDir=<dist> /DIconFile=<build\pushlab.ico> pushlab.iss
; Installs to %LOCALAPPDATA%\Programs\PushLab, adds PushLab to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\PushLab, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\PushLab"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\pushlab.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=PushLab
AppVersion={#AppVersion}
AppVerName=PushLab {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/pushlab/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\PushLab
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=PushLab-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\PushLab.exe
UninstallDisplayName=PushLab
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
Name: "{userprograms}\PushLab"; Filename: "{app}\PushLab.exe"; Comment: "Send push from your own server, and prove it works on a real phone"
Name: "{userdesktop}\PushLab"; Filename: "{app}\PushLab.exe"; Comment: "Send push from your own server, and prove it works on a real phone"; Tasks: desktopicon

[Run]
Filename: "{app}\PushLab.exe"; Description: "{cm:LaunchProgram,PushLab}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\PushLab.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopPushLab"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open PushLab window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\PushLab.exe')) then
    Exec(ExpandConstant('{app}\PushLab.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
