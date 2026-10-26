# AIRIZ Console — Windows desktop edition

This is a standalone Electron desktop application, **not** a browser shortcut.
The complete shared AIRIZ interface, command library, macros, sounds and icons are
bundled with the executable and loaded from a private local application origin.
No web server, Python installation, Chrome/Edge installation or internet connection
is required to use the installed app or its hardware-free demo.

## Downloads

Windows x64 releases are published under the app-specific tag
`airiz-desktop-v1.1.1` in this repository's Releases section.

- **Installer**: assisted, per-user installation with Start-menu/desktop shortcuts
  and an uninstaller. The wizard lets the user choose the installation directory.
- **Portable executable**: no installation required. It still uses a separate
  per-user application-data profile by default; it is not a browser profile.
- **SHA-256 checksums** accompany the release artifacts.

This preview release is **unsigned**. Windows can show an unknown-publisher or
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
in both editions. Starting with 1.1.0, the installed edition checks the dedicated AIRIZ release
channel on startup and every six hours. Use Updates or Help → Check for updates
for a manual check. Downloads require a click; installation requires confirmation
and an idle console. Updates never install merely because the app quits.

Version 1.0.0 has no updater and needs a one-time manual installation of the latest release.

### 1.1.1 update-channel migration

The repository moved from `juwpegatron` to `juw12`. Version 1.1.1 checks
`https://juw12.github.io/projects/airiz-motor/updates/windows/` and downloads from
`juw12/projects` releases. Installed 1.1.0 builds still check the former
`juwpegatron.github.io` address, so a compatibility feed there offers 1.1.1 using
the former release-download address, which GitHub redirects to `juw12/projects`.
The installer binary and SHA-512 hash are identical in both feeds.

Keep the compatibility feed until existing 1.1.0 installations have updated, and
never create a new `juwpegatron/projects` repository: that would break the
release-download redirect required by 1.1.0. Version 1.1.1 makes no other
functional changes.
Portable builds can check for newer versions and open the correct portable download,
but replacement is manual. The installer updater does not overwrite a portable app.

The channel uses HTTPS and SHA-512 verification; existing signature verification
is left enabled. These unsigned builds have no configured publisher certificate.
The private per-app feed avoids selecting another application's release from this
multi-app repository. Publishing a new numeric AIRIZ desktop version triggers the
release-feed workflow, which verifies artifact hashes, prevents feed downgrades,
updates the download links and dispatches the Pages deployment.

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


## Fast control policy in 1.1.0

Connecting enables finite jogs immediately and enables keyboard jogging by default.
An explicit keyboard-off preference is remembered. No motion is sent merely by
connecting or unlocking. Changing workspace, losing focus, opening help, or running
a macro does not change the enabled setting. Macro activity temporarily prevents
manual command interleaving and controls resume afterwards.

Arrow keys work only in the focused Motor control view, outside input fields and
modal dialogs; held-key repeat is ignored. Manual Lock and Escape still block new
jogs. The switch or Keyboard on restores access with one click. There is still no
hardware emergency-stop command.

The direct Bluetooth on button reuses the documented `diag ble on` command and
reports dispatch, not a confirmed Bluetooth connection. It initializes the NXP
IW612/BlueZ controller through the existing serial link. A phone-control BLE GATT
service/characteristic protocol is not documented by this command and is not invented.
