; OutlookArchiver for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.0.0 /DSourceDir=<dist\OutlookArchiver> /DOutputDir=<dist> /DIconFile=<build\outlookarchiver.ico> outlookarchiver.iss
; Installs to %LOCALAPPDATA%\Programs\OutlookArchiver, adds OutlookArchiver to the Start menu (and optionally the desktop) and lists it
; in Settings > Apps. The window keeps its data (what you saved in it) in %LOCALAPPDATA%\OutlookArchiver, which
; uninstalling leaves in place so a reinstall finds it again.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\OutlookArchiver"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif
#ifndef IconFile
  #define IconFile "build\outlookarchiver.ico"
#endif

[Setup]
AppId={{E81247BA-698B-569E-A6DE-E1E1C366EEFB}
AppName=OutlookArchiver
AppVersion={#AppVersion}
AppVerName=OutlookArchiver {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/outlook-archiver/
AppSupportURL=https://github.com/juw12/projects
DefaultDirName={autopf}\OutlookArchiver
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=OutlookArchiver-Windows-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\OutlookArchiver.exe
UninstallDisplayName=OutlookArchiver
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
Name: "{userprograms}\OutlookArchiver"; Filename: "{app}\OutlookArchiver.exe"; Comment: "A small Windows daemon that archives every Outlook message"
Name: "{userdesktop}\OutlookArchiver"; Filename: "{app}\OutlookArchiver.exe"; Comment: "A small Windows daemon that archives every Outlook message"; Tasks: desktopicon

[Run]
Filename: "{app}\OutlookArchiver.exe"; Description: "{cm:LaunchProgram,OutlookArchiver}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\OutlookArchiver.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopOutlookArchiver"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: close an open OutlookArchiver window first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\OutlookArchiver.exe')) then
    Exec(ExpandConstant('{app}\OutlookArchiver.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
