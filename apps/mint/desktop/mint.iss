; Mint for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=3.1.0 /DSourceDir=<dist\Mint> /DOutputDir=<dist> /DIconFile=<build\mint.ico> mint.iss
; Installs to %LOCALAPPDATA%\Programs\Mint, adds Mint to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (budgets, language, region, sign-in) in %LOCALAPPDATA%\Mint, which
; uninstalling leaves in place so a reinstall finds every budget again.

#ifndef AppVersion
  #define AppVersion "3.1.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Mint"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\mint.ico"
#endif

[Setup]
AppId={{8E3A4F1C-2B7D-4C59-9A61-5D0E7F3B2C84}
AppName=Mint
AppVersion={#AppVersion}
AppVerName=Mint {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/mint/
AppSupportURL=https://github.com/juw12/projects/tree/main/apps/mint
DefaultDirName={autopf}\Mint
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Mint-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Mint.exe
UninstallDisplayName=Mint
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Mint"; Filename: "{app}\Mint.exe"; Comment: "Shared budgets and spreadsheet templates"
Name: "{userdesktop}\Mint"; Filename: "{app}\Mint.exe"; Comment: "Shared budgets and spreadsheet templates"; Tasks: desktopicon

[Run]
Filename: "{app}\Mint.exe"; Description: "{cm:LaunchProgram,Mint}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Mint.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopMint"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open Mint window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Mint.exe')) then
    Exec(ExpandConstant('{app}\Mint.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
