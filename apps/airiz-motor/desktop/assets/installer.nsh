; Included automatically by electron-builder (buildResources/installer.nsh).
; Runs on fresh installs and on every auto-update.
!macro customInstall
  ; SHCNE_ASSOCCHANGED: tell Explorer that icons changed (refreshes the icon cache).
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Windows 10/11: rebuild the per-user icon cache used by pinned taskbar items.
  IfFileExists "$SYSDIR\ie4uinit.exe" 0 +2
    nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend
