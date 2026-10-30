# AIRIZ Console — Windows desktop edition

This is a standalone Electron desktop application, **not** a browser shortcut.
The complete shared AIRIZ interface, command library, macros, sounds and icons are
bundled with the executable and loaded from a private local application origin.
No web server, Python installation, Chrome/Edge installation or internet connection
is required to use the installed app or its hardware-free demo.

## Downloads

Windows x64 releases are published under the app-specific tag
`airiz-desktop-v1.11.17` in this repository's Releases section.

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

### 1.1.2 install while connected

From 1.1.2, **Install and restart** no longer requires a manual disconnect. If a device
is connected and idle, the confirmation offers **Disconnect, install and restart**,
closes the serial port safely and installs. Running macros, recordings and capture
sessions still block installation. Reconnect the device after AIRIZ reopens. This
applies to updates installed *from* 1.1.2 or later; 1.1.0 and 1.1.1 still require a
manual disconnect once.

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
External navigation is limited to the project website/repository and the two exact Microsoft
Teams/workflow-help URLs shown in Owner setup. Webhook posts reject redirects. The clipboard
bridge returns only validated Teams workflow endpoints, never unrelated clipboard contents.

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


## 1.2.0: no manual disconnect

**Updating while connected.** Install from the Updates panel while the device is
connected. The app closes the serial port itself, installs silently into the same
folder, restarts and reopens the same remembered device at the same baud rate.
Reconnect is attempted once, within 15 minutes, and only for a port the user
explicitly chose before; if the device is unplugged or ambiguous, the app says so
and leaves Connect device to the user. Only work a restart would interrupt waits:
a running macro, camera recording/session or device audio transfer. In that case
the app offers to install automatically when the work finishes, which can be
cancelled. Closing the port does not stop a finite move already sent.

**Bluetooth check while connected.** Bluetooth check (next to Bluetooth on) sends
the documented `diag ble on` through the existing USB connection, scans with this
PC's Bluetooth radio, lets you choose the AIRIZ device, connects and looks for a
Nordic UART or HM-10-style command service, then sends only `diag ver sw` and
reports whether a framed firmware reply came back. Results can be exported.
No pairing is accepted without confirmation and no motor command is sent.
Another program on the PC still cannot open COM4 while this app holds it: that is
a Windows serial-port rule, which is why the check runs inside the app.

## 1.11.17: Real device facts instead of decoration

* Audit outcome: the FW strip showed the command list's firmware, the header said LOCAL SESSION, the clock counted page
  time, the sidebar wave was static, Bluetooth on only sent a command, and the siren was the AIRIZ test recording.
* `web/console-ui.js`: `runDeviceCommand` (send + collect until `#INFO#...#END#` or the shell prompt). Firmware query
  on connect (`diag ver sw`, quiet, 3 tries; Bluetooth transports use the firmware they already know), Bluetooth
  self-test parsing (code + controller address), link activity from `onOutput` / `onCommandSent` (bytes/s, last reply,
  connected-for), camera move check around each jog (grey 96 px frames, noise-adaptive threshold, idle noise sampled
  once a second), and the read-only *Hardware check* dialog with a saved report.
* `web/ptz-core.js`: `frameDifference`, `frameContrast`, `estimateShift` (pyramid block matching), `motionStopTime`,
  `sirenWave`. Unit tests in `tests/ptz-core.test.cjs`.
* `web/ptz.js`: *Measure automatically* for aim and timing; siren choices `tone` (default, generated) / `testwav` /
  `custom`; a stored `builtin` becomes `tone`. The tone and files go out through `AirizVoice` and fall back to the test
  WAV if the voice link fails.
* `web/app.js`: demo answer for `diag ble on`.
* Test: `node tests/device-facts-e2e.cjs` (demo device, fake webcam, 17 checks).

## 1.11.16: Camera always reaches the other PC

* Field problem: one PC shared with Remote by code, the other typed the code, controlled the motor, but never saw
  the camera. Cause: the camera was registered under the code only if the preview already ran at the moment sharing
  started (`shareWithCode` returned `false` otherwise and nothing retried), a stopped or restarted preview ended the
  camera share for good, and the viewer gave up after its first failed attempt.
* `web/camera-relay.js`: the camera is registered under the code for the whole share, with or without a preview.
  Viewers that connect before the preview runs get `{type: 'waiting'}` and are called as soon as it starts (older
  viewers ignore the message and are simply called later). A restarted preview is swapped into running calls with
  `RTCRtpSender.replaceTrack`. PeerJS registration problems (`unavailable-id`, network) retry with back-off while
  the AIRIZ relay keeps serving. The viewer keeps reconnecting while it is connected by code. The Camera-tab
  *Phone viewer* card is gone; the module keeps its video / picture elements off-screen for `quick-connect.js`.
* `web/quick-connect.js`: the camera share follows `AirizRemoteControl.hostCode` (also after a restored share or a new
  own code); *Share control* shows "Camera: shared with code ... · N watching: ..." or a *Start camera preview* button.
* Test: `node tests/camera-share-e2e.cjs` (two browser profiles, fake webcam, real PeerJS + relay). 1.11.15 fails it
  (no picture after 60 s); 1.11.16 passes, also with a 1.11.15 viewer
  (`node tests/camera-share-e2e.cjs ../web <old web folder>`).

## 1.11.15: Notification when someone asks to join

* `web/remote-control.js` (`hostNotifyJoin`): a new request on the sharing PC plays a two-note chime (Web Audio) and,
  when the console is not in front, shows a Windows notification "<device> asks to join the AIRIZ"
  (`requireInteraction`, closed once allowed / denied / gone). Click → `airizDesktop.showWindow()` (new IPC
  `airiz:show-window`: restore + show + focus) and the Allow prompt. Remembered devices let in automatically get a
  non-sticky "<device> joined the AIRIZ" notification. Setting `airiz-share-join-notify` (default on) and a *Test*
  button in Share control. Notification permission is asked on *Start sharing*; Electron already allows it.
* Tested: `tools/test_join_notify.py` (20 checks, PC + two phones over the real relay, recorded notifications/chime).

## 1.11.14: Full-screen camera on iPhone and Android

* New `web/phone-fullscreen.js` (`AirizFullscreen.attach`) used by `watch.html`, the quick-connect camera window
  (⛶ button). Order: Fullscreen API on
  the camera box + `screen.orientation.lock('landscape')` for a landscape picture; else `video.webkitEnterFullscreen()`
  (iPhone, WebRTC video); else a fixed fill-the-screen mode (iPhone, relay JPEG frames). Double-tap, Esc and a
  *✕ Exit full screen* button leave it. The old watch-page button did nothing on iPhone for relay pictures.
* Tested: `tools/test_phone_fullscreen.py` (7 checks; iPhone emulated without the Fullscreen API, Android with it).

## 1.11.13: View motion pictures without saving them

* The *Photo* / *Clip* links in the Smart detection event list were `<a download>` links, so clicking saved a file.
  They are replaced by *View* and *Play clip* buttons (and a clickable thumbnail) that open `#ptz-viewer`, a modal
  `<dialog>` showing the full-size photo (the in-memory blob) or the clip. *Older* / *Newer* and the arrow keys step
  through events; Escape or a click outside closes it. *Save photo* / *Save clip* in the viewer download as before.
* Tested: `tools/test_event_viewer.py` (6 checks, English and Traditional Chinese): no download on View, thumbnail or
  Play clip; stepping and arrow keys; exactly one `.jpg` on Save photo.

## 1.11.12: Co-admins listed by name on every PC

* Membership is local to each PC (the invite is stored in `airiz.team.v1`), so the owner's app could only show
  a generic *Co-admins* row. `ziris-team.js` now reads `team-roster.json` from
  `https://juw12.github.io/projects/airiz-motor/` (then the bundled copy, then the last good list in
  `airiz.team.roster.v1`) and renders each co-admin under *Co-admins on the team*. A co-admin signed in on this PC
  who is not published yet is still shown (marked *YOU*).
* The desktop CSP `connect-src` allows `https://juw12.github.io` for this read (the mobile build too).
* Tested: `tools/test_team_roster.py` (6 checks, English and Traditional Chinese): owner PC lists Luar Handoyo, a
  new website entry appears after a refresh without reload, offline falls back to the saved / bundled list.

## 1.11.11: Start / stop smart detection with one click

* The *Motion detection* checkbox (`#ptz-detect-arm`) is replaced by a *Start smart detection* button
  (`#ptz-detect-toggle`), and a second one (`#ptz-detect-quick`) sits in the camera toolbar next to *Snapshot*.
  Both carry `data-detect-toggle`; `setArmed()` keeps their text, `aria-pressed` and colour (red while armed)
  in sync and shows the *Smart detection on* badge (`#ptz-detect-badge`) on the picture.
* Tested: `tools/test_detect_toggle.py` (6 checks, English and Traditional Chinese): start from the toolbar,
  both buttons and the badge update, motion is detected while on, stop from the panel ends events.

## 1.11.10: Choose the clip length and spotlight time

* *Smart detection*: the clip length (`detect.clipSeconds`, 3-60 s, default 10) and the spotlight time
  (`detect.spotSeconds`, 5-600 s, default 30) are number fields next to their checkboxes, clamped and saved in
  `airiz.ptz.v1`. Clips stay in memory (up to 40 events), which is why they are capped at 60 s.
* The Smart detection guide entry now has a current Chinese translation (it was keyed to the pre-1.11.8 text).
* Tested: `tools/test_detect_durations.py` (8 checks, English and Traditional Chinese): spotlight off after the set
  time, clip ready after the set length, range clamping and persistence over a reload.

## 1.11.9: Full rise and full down buttons

* **Full rise / Full down** on *Motor control* (next to the jog pad): one click sends
  `diag motor rising forward|reverse <Rising speed> 1100` - the whole rising travel. The step count is one constant
  (`FULL_TRAVEL_STEPS` in `web/console-ui.js`); speed comes from the Rising slider; *Steps per jog* is untouched.
* Same rules as the jog pad: only when connected and unlocked, paused during macros, locked by the jog switch.
* Chinese: 升到頂 / 降到底; the jog pad's LOWER is now 下降 (was 下限, "lower limit").
* Tested: `tools/test_full_travel.py` (10 checks, English and Traditional Chinese, demo device).

## 1.11.8: Smart detection alerts, own siren sound, simpler calibration

* **Alerts while minimized:** detection skipped every frame while the page was hidden, so a minimized console never
  raised alerts. It now runs on a worker clock (`ptz-clock.js`), and the Windows app turns background throttling off
  while detection is armed (`airiz:background-work`, combined with the sharing flag).
* **Alerts report back:** every event lists *Desktop: shown / blocked ...* and *Ziris PTB chat: sent / skipped (2-minute
  pause) / join Ziris PTB first / error*. *Send a test alert* tries both without waiting for motion. The Windows app
  also flashes its taskbar button on an alert while it is not in front.
* **Own siren sound:** *Siren sound: My sound file* decodes any audio file in the browser (mono 16 kHz, first 15 s,
  normalised), sends it once like a voice message (`/tmp/airiz/talk.wav`) and repeats it with `diag audio play`.
* **Plain words:** *Lower to bottom & reset height*, *Is the camera at the bottom?* (Yes / No), and a numbered
  *Calibration (once per camera)* guide with *Advanced numbers* and *Reset calibration to defaults*.
* Tested: a new 15-check run (`tools/test_ptz_alerts.py`, English and Traditional Chinese) with stand-ins for the
  Windows notification and the Teams member, plus the PTZ, hold, zones, remote-home, camera-window and i18n suites.

## 1.11.7: Camera arrows answer at once

* **No wait on press:** the PTZ hold arrows used to wait until the time model said the previous move (click-to-center,
  tracking, a jog) was over before moving; now a running move is stopped and the hold move is sent at once.
* **Stop on every release:** the stop was only sent while the time model still thought the motor was moving. The
  model is an estimate (uncalibrated by default), so a slower real motor kept running to the end of the long hold
  move (up to 3000 steps) after the arrow was released. Quick taps could leave such a move running too. Every release
  of a sent hold move now sends the stop; letting go before the move is written cancels it.
* Tested: a new 6-check run (`tools/test_ptz_hold.py`) that fails 0/6 on 1.11.6 and passes 6/6 now (press to motor
  command 2 ms, release to stop 1 ms in demo), plus the PTZ, zones, remote-home, camera-window and i18n suites.

## 1.11.6: Camera in its own window

* **Camera window:** *Camera > Open in new window* (and *New window* on the PTZ toolbar) opens
  `camera-view.html` in its own window (1280×760, resizable) with only the live picture, the picture size, *Fill/Fit*,
  *Always on top* (picture-in-picture) and *Full screen* (also double-click); the tools hide while the mouse rests.
* **One camera:** the window shows the console's own MediaStream, so the camera is not opened twice and recording,
  snapshots and detection keep working in the console. Stopping or restarting the preview is followed within half a
  second; *Start preview in the console* starts it again from the window. Clicking the button again brings the same
  window to the front, and the window closes with the console.
* **On its own:** opened without the console, the page offers *Use the camera here* (the camera the console used
  last).
* **Desktop app:** only `airiz://app/camera-view.html` may open as a new window (sandboxed, no further windows or
  navigation away from the app); every other link still goes to the browser.
* Tested: a 17-check browser run in English and Traditional Chinese with Chromium's fake camera (same stream object as
  the console, stop/start follow, Fill/Fit, window reuse, standalone camera), plus the camera-modes, PTZ, zones, i18n
  and remote suites.

## 1.11.5: Only camera modes the camera can do

* **No 4K choice:** 3840×2160 @ 30 is gone from the camera *Mode* list.
* **Per-camera list:** after a camera's first preview, its reported maximum (width, height, frame rate) is
  remembered; modes above it are hidden whenever that camera is selected, and a hidden selection goes back to
  *Auto*. Other cameras keep their own lists.
* Tested: a 7-check browser run in English and Traditional Chinese with Chromium's fake camera pinned to
  1920×1080 @ 30 (2560×1440, 1080p60 and 720p60 hidden; 1080p30, 720p30, 480p30 and Auto kept; still trimmed after
  a reload), plus the PTZ, zones, i18n and remote suites.

## 1.11.4: Allow prompt, remembered devices and your own code

* **The Allow buttons cannot be missed:** a phone asking to control opens a prompt on top of the page with
  *Allow & remember*, *Allow once* and *Deny* (before, with Share control closed it was only a toast). The tab
  title shows "(!)" and the Windows app flashes its taskbar button while someone waits.
* **Same device, no asking:** *Remember every device I allow* (on by default) makes *Allow & remember* the main
  button; a remembered phone is let in by itself next time, also after the code changes. *Allow once* and
  *Forget* are still there; a device whose browser keeps no data says it cannot be remembered.
* **Your own code:** *Share control > Your code* keeps one 6-digit code (like a password) instead of a new
  random one each time; easy codes (111111, 123456, 121212, 123321...) are refused. *Change code* while
  sharing moves to the new code at once: phones on the old code are disconnected, told the code changed and
  stop retrying. *Use random codes* goes back to random codes from the next share.
* **One code, one PC:** a second console that starts sharing the same own code takes it over; the first one
  stops and says why instead of taking turns with it on the relay.
* Tested: remote-session unit tests, a 24-check browser run (two phones over the real PeerJS server and relay)
  in English and Traditional Chinese, and the existing several-phones run (48 checks).

## 1.11.3: Zones you can delete and cancel

* **What zones do, on screen:** *Draw zones* and the Smart detection panel explain that only motion inside a
  zone counts (photo, clip, auto-track, spotlight, siren, alerts) and that no zones = the whole picture.
* **Delete one zone:** zones are numbered 1-4 on the live view; the red × in a zone's corner deletes it, and so
  do the *Zone N* buttons under Smart detection (the others are renumbered). *Clear zones* still deletes all.
* **Cancel:** Esc or right-click while dragging drops that box. *Cancel* (next to *Draw zones*) restores the
  zones from before *Draw zones* was opened; *Done* keeps the changes.
* **At most 4 zones, no surprise:** a fifth zone is refused with a message; before, the oldest zone was
  silently dropped.
* Tested: zone unit tests (add / hit test / delete / mask) and a 21-check browser run in English and
  Traditional Chinese with the demo AIRIZ and a fake camera.

## 1.11.2: Listen clips of any length

* **Any clip length:** *Voice settings > Listen clip length* takes 1 to 3600 s (was 1-4 s; the AIRIZ side
  allowed at most 5 s). The AIRIZ records `diag audio record -t <seconds>` clips back to back and sends
  each one after it has been recorded: the sound is about clip length + 2 s behind live.
* **Long clips are not dropped:** a clip arrives as a burst after it has been recorded; the player now
  accepts as much sound ahead as the longest clip (before, more than 5 s ahead was dropped).
* **Memory check:** before each clip listen.sh checks the free space of the recorder's folder
  (`df -Pk`, about 63 kB per second of 16 kHz stereo plus 1 MB). If a clip does not fit, Listen stops
  with "The AIRIZ has only N MB free ... Choose a shorter listen clip length."
* **Stop and Listen again with long clips:** Stop also ends the encoder of the clip being sent (no
  minutes of leftover text on the console). A new listen run takes over from an older one (pid file):
  the old one stops encoding at once and ends after its current recording; the new one waits for that
  ("The AIRIZ is finishing its previous clip first...") instead of failing.
* Tested with the BusyBox fake AIRIZ (10 s clips, Stop, Listen again, low memory) and demo mode;
  long `diag audio record -t` values are not yet tested on a real AIRIZ.

## 1.11.1: Go home from a phone

* **One camera position for every controller:** the console with the AIRIZ cable counts every move -
  its own and those of every device that controls through it by code - and now sends that camera state
  (position, Home, soft limits, the move in flight with its remaining time, its last PTZ message) to
  those devices (`ptz-state`, link protocol 4). Their PTZ view shows the real camera.
* **Go home from a phone brings the real camera home:** *Go home*, *Set home*, soft limits, *Find rising
  home* and *Read rising switch* on a controller are sent to the console with the cable (`ptz-action`)
  and run there; its status shows which device asked and the controller shows the answer. Before, the
  phone planned Go home from its own moves only, so a move made on the PC or by another phone was never
  undone. A phone on an older PC console keeps the old behaviour and asks to update the PC.
* **Bottom switch confirms Home:** when Home is fully down, Go home reads the bottom switch and, if the
  camera is still higher than counted (an interrupted move, a move made outside this console), lowers it
  in 60-step chunks until the switch is pressed (at most 1800 steps).
* **Return after auto-tracking while minimized:** the return home after auto-tracking is checked on its
  own timer, so it also happens while the window is hidden (no frames are analysed then).

## 1.11.0: Phone instead of PC

* **An Android phone is the USB host:** with the AIRIZ on its charger, the FT232R console cable plugs
  into the phone through a USB-OTG adapter. In Chrome, *Connect* opens it over WebUSB (new
  `web/usb-serial.js`: FTDI FT232R driver with reset, DTR/RTS on, no flow control, 115200 baud, 8N1 and
  purge, 2 status bytes stripped from every 64-byte packet; a CDC-ACM driver for the AIRIZ USB port in
  CDC mode). The port behaves like a PC serial port: auto-reconnect after unplug/replug, Talk & listen
  and *Share control* by code, with the screen kept on while sharing. Windows keeps Web Serial.
* **Advice instead of silence:** an iPhone or iPad (no USB serial in iOS) and the AIRIZ Android app's
  WebView (no WebUSB) explain what to use instead; the advice and the phone's connect note also show as
  a notice, so they are translated (the console itself never is).
* **Stop motor is never dropped:** a command that is still being written (a background query, the
  voice link or a slower phone USB transfer) used to make Stop motor fail with "writer is busy"; every
  command, Stop motor included, now waits up to 1.5 s for the writer. Stop motor is enabled the moment a
  connection opens, and the Share control window has its own Stop motor button (pinned at the bottom),
  because a phone has no Esc key and the window covers the main button.
* **Not verified on real hardware:** tested with a fake FT232R WebUSB device bridged to a simulated
  AIRIZ shell (busybox), an Android phone emulated in Edge, the real relay with a second controller,
  unplug/replug and a deliberately slow USB write; not yet on a real phone with a real AIRIZ. The AIRIZ
  firmware is unchanged, so it still needs a USB host (PC or phone) to run the console.

## 1.10.0: Talk & listen

* **Talk:** the new *Talk & listen* card (Motor control) records up to 15 s while *Hold to talk* is held
  (slide away to cancel). The PC turns it into 8 kHz mono IMA ADPCM (about 4 kB per second of voice),
  sends it to the AIRIZ over the console's USB serial link with `head -c` (falls back to `echo` lines
  when the link drops characters), checks it with `md5sum`, and an awk script on the AIRIZ turns it
  into a WAV (16 kHz stereo like the built-in test WAV by default) that `diag audio play` plays.
  Sending takes roughly half a second per second of voice (the 115,200-baud link limit), then the
  AIRIZ decodes it before playing.
* **Listen:** the AIRIZ records back-to-back 2-second clips (`diag audio record -p -t 2 -v <gain>`), an
  awk encoder turns each clip into text lines that the PC removes from the console and plays, about
  4 s behind live with a short gap between clips. The loop stops by itself 3 minutes after the PC
  stops renewing it, so a PC that goes away does not leave it running.
* **Phones:** a phone that controls the AIRIZ by code talks and listens through the PC (remote
  protocol 3); the PC must run 1.10.0 or later.
* **Safety:** Stop motor interrupts a message being sent (Ctrl-C first, then the motor stop, within
  about 0.4 s in tests); while a voice step owns the console, other commands wait up to 2.5 s. A manual
  `diag audio record` or `diag audio play` is refused while Listen uses the microphone, and voice commands
  never start the DMIC auto-save.
* **Helper scripts:** the first message after the AIRIZ powers up installs `enc.awk`, `talk.awk` and
  `listen.sh` in `/tmp/airiz` (checked by MD5 each time; gone after a restart). Only busybox `sh`, `awk`,
  `head`, `od`, `base64` and `md5sum` are used.
* **Not verified on real hardware:** everything above was tested against a simulated AIRIZ shell
  (busybox-w32 running the same scripts, bit-exact sound), the real relay with a phone, and the
  Windows app; not yet on a real AIRIZ. The AIRIZ CPU speed (awk decode time) is unknown, and the
  sound format and the record/play commands can be changed under *Voice settings* if needed.

## 1.9.1: Lid-proof sharing, phones never give up, more phones

* **Sleep timers and lid while sharing:** the Windows app now also sets *Sleep after* and *Hibernate
  after* to Never and *When I close the lid* to Do nothing (plugged in and on battery) through
  `powercfg`, for the active power plan only. The owner's own values are saved to
  `power-plan-restore.json` in the app data folder **before** anything changes and are put back when
  sharing stops, the window reloads or closes, the app quits, and, if the app was killed, at the next
  start. Settings controlled by IT group policy are left alone and the dialog says so. The new
  *Keep sharing when the lid is closed* option (on by default) can be switched off.
* **Screen:** on Modern Standby PCs the screen stays on while sharing (an idle screen there can end in
  standby; close the lid to turn it off). Classic-sleep PCs may turn the screen off; sharing goes on.
* **Phones never give up:** after 3 s × 3, 8 s × 5 and 20 s × 30 attempts a phone keeps trying once a
  minute for as long as its page is open (was: stop after 30 minutes). Only a *no* from the PC (Stop
  sharing, Deny, Disconnect) or Stop on the phone ends it.
* **Same code after a reload or an update:** a phone page that the browser reloads reconnects to the
  same code by itself (this tab, 12 hours). A PC console that reloads, or restarts to install an
  update, shares again with the **same code** (15 minutes) and lets the devices allowed in that share
  straight back in; phones are told *restarting for an update* and keep trying meanwhile. Closing the
  app or Stop sharing still ends the share on purpose.
* **More phones:** the relay accepts 20 controlling phones per code (was 4) and 20 camera viewers
  (was 10); relay 1.3.0 reports the limits on `/v1/status`.
* **Not changed / limits:** choosing Sleep or pressing the power button still sleeps the PC (phones
  reconnect when it wakes). A physical lid close was not exercised in automated tests.

## 1.9.0: Several phones, remembered devices, sleep-proof sharing

* **Several phones at once:** Share control now lets several phones or PCs control the AIRIZ at
  the same time. Every allowed device sees the device output; commands from all of them reach the
  AIRIZ one at a time. Any device can be disconnected from the PC.
* **Allow or Allow & remember:** each request shows *Allow*, *Allow & remember* and *Deny*.
  A remembered device is let in by itself next time (only a hash of its key is stored). Under
  *Remembered devices* the operator can switch automatic entry off or *Forget* a device.
* **Sleep-proof sharing:** while sharing, the Windows app keeps the PC and its screen awake. If the
  PC still sleeps (lid closed) or the network drops, it keeps the **same code**, phones reconnect by
  themselves (Stop on the phone cancels), and devices allowed earlier come straight back in.
* **USB reconnect:** a dropped AIRIZ USB link (sleep, USB power saving, replug) now shows
  *Reconnecting…* and reopens the same port by itself; sharing stays on meanwhile.
* **Unchanged safety:** the PC operator decides who may control; a phone that drops right after a
  motor command still triggers a motor stop; Stop sharing ends every connection without retries.

## 1.8.3: Sound FX removed

* **Sound FX tab removed:** the in-browser sound board (synthesised effects, search, volume and
  "Add sounds…") did not work and is gone, together with its sound library.
* **Play test WAV goes to the device again:** Commands & macros → Audio → Play test WAV has a
  single **Send** button that sends `diag audio play /audio/16K_16bit_Stereo_Loud.wav` to the
  AIRIZ speaker instead of previewing a browser sound.
* **Unchanged:** Set volume, DMIC recording with auto-save and the PTZ siren still use the device
  audio path. Guide section 9 is now "Device audio".

## 1.8.2: One-click owner setup

* **Ziris PTB team → Finish owner setup:** one action uses the saved, pasted or explicitly copied
  workflow address, submits one shared Co-admin invite, sets up Juwen Lie's local Owner profile,
  enables auto-post and copies the invite link. The invite doubles as the connection test; the
  private Owner pass is never shared.
* **Remembered on this PC:** restart/reload does not repost the invite, read the clipboard or turn
  a deliberately paused auto-post switch back on. Re-enabling the same destination reuses the
  saved invite. Browser and desktop profiles remain separate.
* **Clear recovery:** failed setup keeps the previous profile. Ambiguous timeouts are not retried
  automatically; check Teams before retrying. Storage/clipboard failures have explicit recovery
  messages. Advanced personal invites and manual resend remain available.
* **One-time Microsoft step:** the owner must create/authorize the workflow in Teams once. This
  integration uses an Anyone trigger only where organizational policy permits private bearer
  webhooks; tenant-only OAuth triggers are not supported. HTTP acceptance is not delivery
  confirmation: check the chat or flow run history. The local Owner label grants no Microsoft rights.
* **Checked in English, Traditional Chinese and packaged Windows:** unit, browser and native
  preload/IPC tests cover setup, restore, duplicate prevention and failure paths. Teams endpoints
  and clipboard contents are stubbed; no real Teams delivery is claimed. Addresses are masked,
  clipboard access is URL-filtered and webhook posts reject redirects. Keep invites inside Ziris PTB.

## 1.8.1: Camera position follows the real camera
* New **camera position view** in the PTZ card: a side view shows how far the camera is raised
  (fully down / halfway / fully up, in steps of the 1100-step stroke) and a top view shows the pan angle
  from Home (4800 steps = 360°, forward = counter-clockwise). It animates with the real move timing.
* Rising height is now absolute from the bottom switch: the console reads `diag button get rising-det`
  on connect and after every move that should end fully down; "Pressed" sets the height to 0.
* Moves past an end stop (e.g. 2000 steps up) saturate at 0 / full travel like the real motor stalling,
  and console moves never ask for more than the travel.
* Fix: the switch answer `#INFO#0:Pressed#END#` (firmware command list) was not understood, so Find rising
  home and Privacy failed on real devices. Text and number answers are both accepted now.
* Calibration: *Rising full travel* (default 1100) and *Pan steps per turn* (default 4800) are editable.

## 1.8.0: PTZ live view & smart camera
* New **PTZ live view & smart camera** card on the Camera page (works in this app and on the website).
* **Click the picture** to center that spot; **hold an arrow** to move, release sends the motor stop;
  wheel/buttons for digital zoom (drag to look around when zoomed); snapshot of the current view.
* **Home, soft limits and up to 12 saved positions** with Go/Delete; **Auto scan** visits them with a dwell time.
  Positions are counted from the motor commands the console sends (the motors have no encoder); after an
  interrupted move the position is marked *estimated*.
* **Privacy**: lowers the camera to the rising switch, turns the IR and spot LEDs off and pauses detection;
  **Find rising home** lowers in 60-step chunks until `diag button get rising-det` reports pressed.
* **Smart detection** on the preview (zones, sensitivity, active hours): each event saves a thumbnail, photo
  and 10 s clip and can auto-track, switch the spotlight on, sound the siren (`diag audio play`), show a desktop
  notification or alert the Ziris PTB chat (2 min cooldown). Runs only while the console is open.
* **Automatic night vision** from `diag als value` with hysteresis (IR-cut + IR LED).
* **Calibration**: speeds, 2-click steps-per-picture calibration and a timing test so moves land on target.
* The desktop app now allows web notifications for the console page.

## 1.7.3: Teams invite joins the Windows app too
* Before, pressing **Join Ziris PTB** in Teams only joined the browser: the Windows app kept its own,
  separate settings and stayed "Not signed in".
* Now, after joining on that web page, press **Open in the AIRIZ Windows app** (allow the browser to open it).
  The app starts (or comes to the front if it is open) and joins Ziris PTB with the same name, no typing.
* The app registers the `airiz-console://` link on start; only `airiz-console://join?team=ZPTB1-…` links are
  accepted and the invite is checked the same way as a pasted one. Pasting the invite link in the app still works.

## 1.7.2: Share codes post to Teams automatically, one camera share
* **Remote by code** and **Share control** codes now go to the Ziris PTB Teams chat by themselves
  (before, only the old camera code did; the control code needed an extra tick that was off).
* One message per code: the card says *motor + camera*; the camera, which uses the same code, is not posted twice.
* The **Share to phone** button on the Camera page is gone. Share with Remote by code or Share control;
  the Camera page only shows the code and who is watching. Phones can still type the code there and press Watch.
* Team page: one switch, *Auto-send share codes*, on by default. The Teams status and **Send to Teams**
  retry button are in the Share control window.

## 1.7.1: One role: Co-admin, join with one click
* There is only one team role now: **Co-admin** (the separate Tester role is gone).
* **Owner:** Ziris PTB team → Owner setup: paste the workflow address, leave the member name empty,
  **Create invite**, then **Post invite to Ziris PTB chat**. One link works for every co-admin.
* **Co-admins:** press **Join Ziris PTB** on the invite card in the Teams chat, type your name once,
  press Join. In the Windows app, paste the invite link in Ziris PTB team instead.
* Older personal passes keep working; Tester passes now show as Co-admin.

## 1.7.0: One button: Remote by code
* **Remote by code** opens every time the console starts (after the language box on a first
  start) and stays as a large button in the header. One code connects everything.
* **PC with the AIRIZ on USB:** *Share this AIRIZ* connects the USB device if needed, shares motor
  control, starts the camera preview and shares the camera under the **same** 6-digit code, then
  shows the code. *Share control* from Device connection now shares the camera with the same code too.
* **Phone / other PC:** type the code; it connects by itself at the 6th digit. Motor, LEDs,
  commands and macros work, and the live AIRIZ camera opens by itself in a floating window
  (bigger/smaller, hide). The PC still presses **Allow** for every controller.
* Stopping the share on the PC also stops the camera share.

## 1.6.0: Type the code straight into the console
* **Control by code box** at the top of the console: type the 6-digit code from *Share control*
  on the AIRIZ PC and it connects by itself as soon as the 6th digit is in. No dialog, no
  Bluetooth. The same box shows *Connected* and has a *Disconnect* button. The PC still presses
  **Allow**, exactly as before.
* **Phones:** the box is the first thing on the screen. The Bluetooth app card, the Windows
  download card and the Bluetooth buttons are folded behind *Other ways (Bluetooth, Windows app)*.
* The PC share dialog now tells the other side to type the code into *Control by code*.
  The box hides itself on the PC that has the AIRIZ on USB.

## 1.5.1: Phone links connect again
* **Fix:** opening a *Share control* link on a phone (`index.html#control=123456`, e.g. from
  Teams) on a phone that never used the console showed the first-run language box and the
  *Connect by code* box on top of each other, so the phone could not connect. Links now skip
  the language box (language and site are guessed from the phone and can be changed with 🌐).
* **Links connect by themselves:** the code from the link is filled in and *Connect* is pressed
  automatically; the PC still has to press **Allow**.
* The first-run language box now waits until no other dialog is open.

## 1.5.0: Language & region, new logo
* **Language & region** chosen on first start (English / 繁體中文 / 简体中文; Taiwan, China,
  Indonesia – Batam, Other). Changeable any time from the 🌐 button in the header.
* **New app icon**: flat green tile with a bird inside a game controller (window, taskbar,
  shortcuts, installer). The installer refreshes the Windows icon cache on install and on
  every auto-update (`assets/installer.nsh`), so pinned taskbar icons switch too.

## 1.4.0: Ziris PTB team, Teams auto-post, user guide
* **Teams auto-post (members only):** when a Ziris PTB member presses Camera &rarr; Share to
  phone, the 6-digit code is posted to the *Ziris PTB* Teams group chat (card with code,
  member, PC and a Watch on phone button). Optional: the Share control code too.
* Only PCs with a personal **team pass** issued by the owner (Ziris PTB team &rarr; Owner setup)
  post anything. The desktop app posts from the main process (`airiz:teams-post`) and only to
  Power Automate / Teams webhook hosts.
* **Owner Juwen Lie** shown in the sidebar, the team page and the guide.
* **Guide & history** page: how to use every feature, troubleshooting, and the app's history.

## 1.3.0: Remote control by code (no Bluetooth)

* **Share control** (PC with the AIRIZ on USB, or in demo): shows a 6-digit code and a link
  (`index.html#control=CODE`). Start sharing, then **Allow** or **Deny** each request.
* **Connect by code** (phone, tablet or another PC, in the app or the website): enter the
  code; after the PC operator allows it, the whole console (motor jogs, LED, commands,
  macros, Stop motor) works as if the AIRIZ were connected locally. The firmware is checked
  with `diag ver sw` before the console unlocks.
* Path: direct WebRTC data channel when the network allows it, the AIRIZ relay
  (`airiz-relay.juw12.workers.dev`) otherwise, so it also works behind company firewalls.
* Safety: one controller at a time, operator must allow, Disconnect at any time, lines are
  limited to 1000 characters and 25 commands/s, the remote Stop motor runs the PC's own
  stop, and the PC sends a motor stop if the controller drops shortly after a motor command.
  Sharing ends when the PC disconnects from the AIRIZ. Camera viewing still uses
  Camera &rarr; Share to phone.

## 1.2.6: See who is connected

* **Camera sharing:** under "N watching" the PC lists every viewer with its device, path
  and time, e.g. "iPhone (Safari) · via AIRIZ relay · 3 min" or "Android (Chrome) · direct
  video · just now". Viewers send only a short device label (no names or addresses).
* **Phone remote:** the dialog shows the devices connected to the AIRIZ over Bluetooth
  (label, PIN ok or not, connected time, Bluetooth address), refreshed every 4 s over USB.
  Needs Bluetooth bridge v3, which is installed automatically by *Start remote*.
* **Connect Bluetooth:** the device picker marks AIRIZ-BT as "In use by …" or "Free" from
  the last list this PC saw. After connecting, the app tells you if another device is also
  connected to the same AIRIZ.
* Bridge v3 adds `hello <label>` and `who` (no PIN needed, labels only); older bridges are
  detected and never sent these commands.

## 1.2.5: Phone camera view works behind company firewalls

* **Share to phone** now also works when the PC's network blocks WebRTC (company Wi-Fi
  such as PEGATRON_OA blocks UDP and TURN). The app sends JPEG snapshots of the preview
  (640 px, about 5 frames/s) over HTTPS to the AIRIZ relay, a Cloudflare Worker in this
  repository (`apps/airiz-motor/relay`). Frames pass through Cloudflare and are not stored.
* Phones and the share link try full-quality WebRTC video and the relay together, and
  switch to WebRTC video as soon as it connects. Snapshots are only encoded while someone
  watches through the relay.
* The viewer count includes relay viewers. If the PeerJS service is unreachable, sharing
  continues through the relay instead of failing.
* The app's network policy adds `wss://airiz-relay.juw12.workers.dev`.

## 1.2.4: Control the AIRIZ from this PC over Bluetooth

* **Connect Bluetooth** now works in the Windows app (it was website/phone only). It
  connects this PC to the AIRIZ-BT remote with the same PIN check as the phones, through
  an in-app device picker (Electron has no browser chooser).
* **Phone remote → Connect this PC by Bluetooth**: after Start remote, one click closes
  the USB session and reconnects over Bluetooth, using the PIN that was just shown.
* **Bluetooth on** is labelled as the firmware radio test (`diag ble on`); it does not
  start the remote. Use Phone remote for that.
* The phone camera viewer sits at the top of the Camera page on phones.

## 1.2.3: Share the AIRIZ camera to phones (live link)

* **Camera → Share to phone**: relays the AIRIZ USB camera to phones and other people.
  Shows a 6-digit code and a view-only link (`watch.html#code`) with **Copy link**.
  Video goes peer-to-peer over WebRTC; the free PeerJS service only introduces the
  peers (and relays via its TURN server when a network blocks direct links).
  Capped at 720p / 1.5 Mbit/s. Sharing stops when the preview stops.
* The app's network policy now allows only the PeerJS signalling server in addition to itself.
* Bundles the latest Bluetooth bridge for **Phone remote**: auto-accepts iPhone pairing
  (fixes iPhones disconnecting after ~30 s), Bluetooth name AIRIZ-BT, acknowledged writes on iOS.

## 1.2.2: Phone remote, PIN, motor stop and real USB ports

* **Fix:** real USB serial ports could not be opened in 1.2.0–1.2.1 ("Failed to open
  serial port"). Electron's permission check reports `device_instance_id`, the grant
  store only knew `deviceInstanceId`. Verified with the AIRIZ on COM4.
* **Phone remote** (USB): installs the Bluetooth bridge in `/data/airiz` on the device,
  starts it and shows a 6-digit PIN. Start it again after each power-up.
* **Stop motor** button and Esc: stops a move in progress (motor driver
  `status` = 0; over Bluetooth the bridge `stop` command). Macro Stop also stops the motor.
* Bluetooth clients must enter the PIN; wrong PINs are rejected, 5 in a row lock for 60 s.

## 1.2.1: Bluetooth check accepts real firmware replies

The Bluetooth check now accepts the device's actual version reply format
(`#INFO#0:0.0.0.3#END#`). With the temporary on-device bridge in
`apps/airiz-motor/bluetooth-bridge/`, the check finds **AIRIZ-BT** and verifies
the command channel. No other behavior changes.
