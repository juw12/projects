; Vitals for Windows - per-user installer (no admin rights). build.py compiles it with:
;   iscc /DAppVersion=1.1.0 /DSourceDir=<dist\Vitals> /DOutputDir=<dist> vitals.iss
; Installs to %LOCALAPPDATA%\Programs\Vitals, adds Vitals to the Start menu (and optionally the
; desktop and sign-in), and lists it in Settings > Apps. History and the Undo Vault stay in
; %USERPROFILE%\.vitals, shared with the one-line installer, and are kept on uninstall.

#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\Vitals"
#endif
#ifndef OutputDir
  #define OutputDir "dist"
#endif

[Setup]
AppId={{5B0C6C1E-8F7A-4D2B-9E31-6A4F2C9D7B10}
AppName=Vitals
AppVersion={#AppVersion}
AppVerName=Vitals {#AppVersion}
AppPublisher=Juwen Lie
AppPublisherURL=https://juw12.github.io/projects/vitals/
AppSupportURL=https://github.com/juw12/projects/tree/main/apps/vitals
DefaultDirName={autopf}\Vitals
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir={#OutputDir}
OutputBaseFilename=Vitals-Windows-Setup
SetupIconFile=..\web\icons\icon.ico
UninstallDisplayIcon={app}\Vitals.exe
UninstallDisplayName=Vitals
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
Name: "startup"; Description: "Start Vitals quietly when I sign in (keeps the dashboard live)"; GroupDescription: "Options:"
Name: "desktopicon"; Description: "Add a desktop icon"; GroupDescription: "Options:"

[InstallDelete]
; Replaces a copy set up by the one-line PowerShell installer: same shortcut names, same data folder.
Type: filesandordirs; Name: "{localappdata}\Vitals\app"
Type: files; Name: "{userstartup}\Vitals (background).lnk"
Type: files; Name: "{userdesktop}\Vitals.lnk"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Vitals"; Filename: "{app}\Vitals.exe"; Comment: "Device health copilot"
Name: "{userdesktop}\Vitals"; Filename: "{app}\Vitals.exe"; Comment: "Device health copilot"; Tasks: desktopicon
Name: "{userstartup}\Vitals (background)"; Filename: "{app}\Vitals.exe"; Parameters: "--background"; Tasks: startup

[Run]
; An older Vitals agent may still be running: stop it so the new version takes over.
Filename: "{app}\Vitals.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated
Filename: "{app}\Vitals.exe"; Description: "Open Vitals"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\Vitals.exe"; Parameters: "--stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopVitals"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  { Updating: stop the running agent first so its files can be replaced. }
  if FileExists(ExpandConstant('{app}\Vitals.exe')) then
    Exec(ExpandConstant('{app}\Vitals.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
