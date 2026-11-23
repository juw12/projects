; HouseOfArticles for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\HouseOfArticles> /DOutputDir=<dist> /DIconFile=<build\houseofarticles.ico> houseofarticles.iss
; Installs to %LOCALAPPDATA%\Programs\HouseOfArticles, adds HouseOfArticles to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\HouseOfArticles, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\HouseOfArticles"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\houseofarticles.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=HouseOfArticles
AppVersion={#AppVersion}
AppVerName=HouseOfArticles {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/house-of-articles/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\HouseOfArticles
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=HouseOfArticles-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\HouseOfArticles.exe
UninstallDisplayName=HouseOfArticles
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
Name: "{userprograms}\HouseOfArticles"; Filename: "{app}\HouseOfArticles.exe"; Comment: "Athlete-moment sneaker news plus a live resale market feed"
Name: "{userdesktop}\HouseOfArticles"; Filename: "{app}\HouseOfArticles.exe"; Comment: "Athlete-moment sneaker news plus a live resale market feed"; Tasks: desktopicon

[Run]
Filename: "{app}\HouseOfArticles.exe"; Description: "{cm:LaunchProgram,HouseOfArticles}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\HouseOfArticles.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopHouseOfArticles"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open HouseOfArticles window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\HouseOfArticles.exe')) then
    Exec(ExpandConstant('{app}\HouseOfArticles.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
