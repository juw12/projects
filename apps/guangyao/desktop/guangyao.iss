; GuangYao for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\GuangYao> /DOutputDir=<dist> /DIconFile=<build\guangyao.ico> guangyao.iss
; Installs to %LOCALAPPDATA%\Programs\GuangYao, adds GuangYao to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (your lessons, reviews and streak) in %LOCALAPPDATA%\GuangYao, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\GuangYao"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\guangyao.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=GuangYao
AppVersion={#AppVersion}
AppVerName=GuangYao {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/guangyao/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\GuangYao
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=GuangYao-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\GuangYao.exe
UninstallDisplayName=GuangYao
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
Name: "{userprograms}\GuangYao"; Filename: "{app}\GuangYao.exe"; Comment: "An unofficial Traditional Chinese learning app"
Name: "{userdesktop}\GuangYao"; Filename: "{app}\GuangYao.exe"; Comment: "An unofficial Traditional Chinese learning app"; Tasks: desktopicon

[Run]
Filename: "{app}\GuangYao.exe"; Description: "{cm:LaunchProgram,GuangYao}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\GuangYao.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopGuangYao"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open GuangYao window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\GuangYao.exe')) then
    Exec(ExpandConstant('{app}\GuangYao.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
