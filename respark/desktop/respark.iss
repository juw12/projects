; Titian for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Titian> /DOutputDir=<dist> /DIconFile=<build\respark.ico> respark.iss
; Installs to %LOCALAPPDATA%\Programs\Titian, adds Titian to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Titian, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Titian"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\respark.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Titian
AppVersion={#AppVersion}
AppVerName=Titian {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/titian/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\Titian
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Titian-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Titian.exe
UninstallDisplayName=Titian
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
Name: "{userprograms}\Titian"; Filename: "{app}\Titian.exe"; Comment: "A broker-run B2B bridge for industrial manufacturers in Southeast Asia"
Name: "{userdesktop}\Titian"; Filename: "{app}\Titian.exe"; Comment: "A broker-run B2B bridge for industrial manufacturers in Southeast Asia"; Tasks: desktopicon

[Run]
Filename: "{app}\Titian.exe"; Description: "{cm:LaunchProgram,Titian}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Titian.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopTitian"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Titian window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Titian.exe')) then
    Exec(ExpandConstant('{app}\Titian.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
