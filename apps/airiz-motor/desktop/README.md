# AIRIZ Console — Windows desktop edition

This is a standalone Electron desktop application, **not** a browser shortcut.
The complete shared AIRIZ interface, command library, macros, sounds and icons are
bundled with the executable and loaded from a private local application origin.
No web server, Python installation, Chrome/Edge installation or internet connection
is required to use the installed app or its hardware-free demo.

## Downloads

The first Windows x64 release is published under the app-specific tag
`airiz-desktop-v1.0.0` in this repository's Releases section.

- **Installer**: assisted, per-user installation with Start-menu/desktop shortcuts
  and an uninstaller. The wizard lets the user choose the installation directory.
- **Portable executable**: no installation required. It still uses a separate
  per-user application-data profile by default; it is not a browser profile.
- **SHA-256 checksums** accompany the release artifacts.

The initial release is **unsigned**. Windows can show an unknown-publisher or
SmartScreen warning. A signing certificate is required to ship a signed build;
no certificate or verified-publisher status is implied.

## Working features

- Local controller dashboard, command preview and finite-step jog controls.
- Explicit native serial-port selection, including hotplug changes while choosing.
  Ports are never selected automatically and Chromium's blocklist stays enabled.
- Existing command library, macro editing/running/export, log export and sounds.
- Camera selection/preview, capture, recording and session-folder functionality,
  subject to the device's capabilities, Windows permissions and installed drivers.
- Local persistent macros/preferences, three-way themes and offline demo.
- Native application menus, zoom/fullscreen and guarded closing when a physical
  device connection, macro, recording or session is active.

Browser and desktop storage are separate. Existing custom browser macros are not
automatically copied from Chrome/Edge. The six bundled macro templates are present
in both editions. This first release uses manual downloads for app updates; it does
not silently replace itself or add a background updater.

## Device safety

No physical motor, serial adapter, camera or microphone was validated during the
packaging tests. Tests use simulated serial responses and a synthetic camera.
The native chooser was opened and cancelled without connecting physical hardware.

There is no documented motor-stop command. Closing the app, disconnecting, locking
jog controls or pressing Escape does **not** stop a finite move already sent to the
device. The jog lock does not gate raw commands, library buttons or macros. Review
commands and keep the mechanism safe before enabling hardware control.

The existing Step sweep macro's speed default of 1070 remains outside the library's
documented Rising range; resolve that inherited inconsistency before hardware use.

## Security boundaries

The renderer has Node integration disabled, context isolation and sandboxing
enabled, a restricted content-security policy and only a small validated IPC bridge.
Only the bundled application origin can request serial/media/file permissions.
The app does not grant arbitrary devices or disable serial security blocklists.
Restricted filesystem locations require the user to choose another folder.
External navigation is limited to the project website and repository.

## Building and testing

Use Node 24 on Windows x64. Install the pinned dependencies, run the Node tests,
then run the Windows distribution build. A packaged smoke-test script starts the
built executable with a disposable local profile, checks native IPC and offline
operation, and exercises demo/synthetic-camera behavior. The dedicated GitHub
Actions workflow repeats the Windows build and tests and uploads the artifacts.

Normal development commands from this directory:

```powershell
npm ci
npm test
npm run dist:win
npm run test:packaged
```

To put a disposable or managed profile in an explicitly chosen location, launch
with the `--airiz-data-dir=<absolute directory>` argument. This is also how the
verification scripts avoid modifying the operator's normal desktop workspace.

Release packaging intentionally does not include development dependencies, test
profiles, source-repository credentials or the rest of the monorepo.
