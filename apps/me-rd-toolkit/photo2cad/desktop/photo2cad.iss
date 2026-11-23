; DatumCAD for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\DatumCAD> /DOutputDir=<dist> /DIconFile=<build\photo2cad.ico> photo2cad.iss
; Installs to %LOCALAPPDATA%\Programs\DatumCAD, adds DatumCAD to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\DatumCAD, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\DatumCAD"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\photo2cad.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=DatumCAD
AppVersion={#AppVersion}
AppVerName=DatumCAD {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/datum-cad/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\DatumCAD
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=DatumCAD-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\DatumCAD.exe
UninstallDisplayName=DatumCAD
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
Name: "{userprograms}\DatumCAD"; Filename: "{app}\DatumCAD.exe"; Comment: "An idea becomes a real CAD file"
Name: "{userdesktop}\DatumCAD"; Filename: "{app}\DatumCAD.exe"; Comment: "An idea becomes a real CAD file"; Tasks: desktopicon

[Run]
Filename: "{app}\DatumCAD.exe"; Description: "{cm:LaunchProgram,DatumCAD}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\DatumCAD.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopDatumCAD"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open DatumCAD window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\DatumCAD.exe')) then
    Exec(ExpandConstant('{app}\DatumCAD.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
