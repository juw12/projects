; Lingua for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\Lingua> /DOutputDir=<dist> /DIconFile=<build\lingua.ico> lingua.iss
; Installs to %LOCALAPPDATA%\Programs\Lingua, adds Lingua to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\Lingua, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Lingua"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\lingua.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=Lingua
AppVersion={#AppVersion}
AppVerName=Lingua {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/lingua/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\Lingua
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Lingua-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Lingua.exe
UninstallDisplayName=Lingua
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
Name: "{userprograms}\Lingua"; Filename: "{app}\Lingua.exe"; Comment: "Translate live Teams captions"
Name: "{userdesktop}\Lingua"; Filename: "{app}\Lingua.exe"; Comment: "Translate live Teams captions"; Tasks: desktopicon

[Run]
Filename: "{app}\Lingua.exe"; Description: "{cm:LaunchProgram,Lingua}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Lingua.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopLingua"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Lingua window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Lingua.exe')) then
    Exec(ExpandConstant('{app}\Lingua.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
