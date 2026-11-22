; TemanSehat for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\TemanSehat> /DOutputDir=<dist> /DIconFile=<build\temansehat.ico> temansehat.iss
; Installs to %LOCALAPPDATA%\Programs\TemanSehat, adds TemanSehat to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\TemanSehat, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\TemanSehat"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\temansehat.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=TemanSehat
AppVersion={#AppVersion}
AppVerName=TemanSehat {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/teman-sehat/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\TemanSehat
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=TemanSehat-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\TemanSehat.exe
UninstallDisplayName=TemanSehat
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
Name: "{userprograms}\TemanSehat"; Filename: "{app}\TemanSehat.exe"; Comment: "Pengingat gaya hidup GERD, diet and fit tanpa puasa"
Name: "{userdesktop}\TemanSehat"; Filename: "{app}\TemanSehat.exe"; Comment: "Pengingat gaya hidup GERD, diet and fit tanpa puasa"; Tasks: desktopicon

[Run]
Filename: "{app}\TemanSehat.exe"; Description: "{cm:LaunchProgram,TemanSehat}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\TemanSehat.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopTemanSehat"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open TemanSehat window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\TemanSehat.exe')) then
    Exec(ExpandConstant('{app}\TemanSehat.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
