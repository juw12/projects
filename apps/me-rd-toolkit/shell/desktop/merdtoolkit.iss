; DatumBench for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\DatumBench> /DOutputDir=<dist> /DIconFile=<build\merdtoolkit.ico> merdtoolkit.iss
; Installs to %LOCALAPPDATA%\Programs\DatumBench, adds DatumBench to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\DatumBench, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\DatumBench"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\merdtoolkit.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=DatumBench
AppVersion={#AppVersion}
AppVerName=DatumBench {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/me-rd-toolkit/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\DatumBench
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=DatumBench-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\DatumBench.exe
UninstallDisplayName=DatumBench
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
Name: "{userprograms}\DatumBench"; Filename: "{app}\DatumBench.exe"; Comment: "Mechanical RandD checklists"
Name: "{userdesktop}\DatumBench"; Filename: "{app}\DatumBench.exe"; Comment: "Mechanical RandD checklists"; Tasks: desktopicon

[Run]
Filename: "{app}\DatumBench.exe"; Description: "{cm:LaunchProgram,DatumBench}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\DatumBench.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopDatumBench"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open DatumBench window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\DatumBench.exe')) then
    Exec(ExpandConstant('{app}\DatumBench.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
