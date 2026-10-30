# Airiz Motor Test Console

Owner: **Juwen Lie** · Team: **Ziris PTB** (co-admins and testers)

## Ziris PTB team: Teams auto-post (members only)

When a Ziris PTB member shares with **Remote by code** or **Share control**, the 6-digit code
(motor + camera) is posted automatically to the *Ziris PTB* Microsoft Teams group chat, once per
code (adaptive card with the code, member name, PC name and an *Open AIRIZ console* button).
Since 1.7.2 there is no separate camera share button: the camera rides on the same code.

- Only PCs with a **team pass** (`ZPTB1-…`, issued by the owner in *Ziris PTB team → Owner setup*)
  ever send anything. Without a pass the app stays silent.
- The pass holds the member name/role and the private address of the Teams workflow
  *Send webhook alerts to a chat* added to the Ziris PTB chat. The address is never in this repo.
- Revoke: delete the workflow, create a new one, hand out new passes.
- Desktop app posts from the main process (`airiz:teams-post`, Power Automate/Teams hosts only);
  browsers post directly (Power Automate answers CORS with `*`).
- In-app **Guide & history** page: user guide for every feature and the history of the console.

## Windows desktop app

A downloadable Windows x64 desktop edition now bundles this entire console locally.
It is not a website shortcut and does not require Chrome, Edge, Node or Python to run.
Installer and portable preview builds are available at:

https://github.com/juw12/projects/releases/tag/airiz-desktop-v1.11.18

The initial binaries are unsigned. The packaged app was tested with demo/synthetic
hardware; real-device bench validation is still required. Browser and mobile-web
editions remain available. Desktop macros/preferences use a separate local profile
and are not automatically copied from a browser.

**Remote control by code (1.3.0):** on the PC with the AIRIZ, *Share control* gives a
6-digit code; on a phone or another PC, *Connect by code* controls the motor and every
console function through the internet after the PC operator allows it (no Bluetooth).

**Several phones, remembered devices, sleep-proof sharing (1.9.0):** several phones or PCs can
control at the same time; *Allow & remember* lets a device in by itself next time (the operator
can switch that off or *Forget* a device). While sharing, the Windows app keeps the PC and its
screen awake; after sleep or a network drop the PC keeps the same code and phones reconnect by
themselves. A dropped USB link to the AIRIZ reconnects automatically instead of leaving a dead
"Connected" console.

**Lid-proof sharing, phones never give up, more phones (1.9.1):** while sharing, the Windows app
also sets the PC's sleep timers to Never (plugged in and on battery) and lets the lid close without
sleeping, then puts the owner's power settings back when sharing stops, the app closes or, after a
crash, at the next start. Phones keep reconnecting until the PC stops sharing (no 30-minute limit),
also after the phone page reloads or the console restarts for an update, with the same code. Up to
20 phones can control through the relay (was 4).

**Talk & listen (1.10.0):** a new card on Motor control. *Hold to talk* on the PC, or on a phone that
controls the AIRIZ by code, records up to 15 s; the message is sent over the existing USB serial link
(8 kHz IMA ADPCM text, checked with MD5) and plays on the AIRIZ speaker a few seconds later. *Listen*
streams the AIRIZ microphone back in 2-second clips, about 4 s behind live. Phones go through the PC
that has the AIRIZ on USB. Stop motor still works and also interrupts a message being sent. Tested
against a simulated AIRIZ shell (busybox), not yet on real AIRIZ hardware; the sound format and the
record/play commands can be changed under *Voice settings*.

**Owner-set code, no Bluetooth, one share button (1.11.18):** sharing never generates a random code: the owner sets a 6-digit code once in *Remote by code* (header) and it is used every time (`remote-session.js` own-code store; easy codes such as 123456 are refused). Without a code, sharing does not start. A share resumed after a restart continues only with the owner code. Phones (iPhone Safari/Chrome, Android Chrome) connect with the code, no app or Bluetooth. Removed: *Connect Bluetooth*, *iPhone: open in Bluefy*, *Phone remote* (Bluetooth bridge installer), and the duplicates *Share control*, *Connect by code* and the Camera-page *Left/right* switch; `iphone.html` now just opens the console. *Bluetooth test* stays (AIRIZ hardware self-test). Checked in Chromium with the demo device and an iPhone Chrome user agent.

**Real device facts instead of decoration (1.11.17):** the dashboard no longer shows invented values. The strip under the
buttons shows the firmware the connected AIRIZ reports (`diag ver sw`, asked once after connecting) next to the firmware
the command list was written for (0.0.0.9), and the last *Bluetooth test* result. *Bluetooth test* (`diag ble on`) now
reads the answer: `#INFO#0` = OK with the controller address from the BlueZ dump, otherwise the error code. The header
pill shows the link and the age of the last reply, *Connected for* replaces the session clock, and the sidebar bars are
the real bytes per second to / from the AIRIZ console. With the camera preview on, each jog compares small grey frames
before and after the move ("the camera picture moved" / "no movement seen"). Calibration gets *Measure automatically*
for the aim (block matching of the picture shift, `ptz-core.js estimateShift`) and for the timing (the move ends when the
picture stops changing). The siren default is a generated wail (650-1500 Hz, 3 s) sent like a voice message; the AIRIZ
test sound stays selectable. *Listen volume* is renamed *PC playback volume*. *Hardware check* (read-only, optional
20-step test move) reads firmware, motor driver sysfs files, accelerometer, buttons, light sensor, kernel, storage and the
camera's zoom / pan / tilt capabilities and saves a text report. Checked in demo mode with a fake webcam
(`desktop/tests/device-facts-e2e.cjs`); the real-AIRIZ answers (accelerometer format, motor status file) still need a
bench run of the hardware check.

**Camera always reaches the other PC (1.11.16):** the Remote by code / Share control code now registers the camera
from the moment sharing starts, also when the camera preview cannot start yet (before, the camera was only shared
if the preview already ran at that instant, and a stopped or restarted preview ended the camera share for good, so
the other PC controlled the motor but never saw a picture). Viewers get the picture as soon as Camera > Start Preview
runs; a restarted preview (new mode or camera) is swapped into the running calls (`replaceTrack`). The device that
connects by code keeps reconnecting until the picture arrives. *Share control* shows the camera state and who is
watching, with *Start camera preview*. The Camera tab's *Phone viewer* card is removed (Remote by code does it all);
`web/camera-relay.js` keeps its viewer elements off-screen for `quick-connect.js`. Checked end to end with two browser
profiles, a fake webcam and the real PeerJS/relay services (`desktop/tests/camera-share-e2e.cjs`), including an
older 1.11.15 viewer against a 1.11.16 PC.

**Join notifications (1.11.15):** while the PC with the USB cable shares *Remote control by code*, a device asking to join
shows a Windows pop-up (Notification API, sticky until decided) and plays a short chime, also when the console is minimized
or behind other windows. Clicking it restores the window (`airizDesktop.showWindow`) with Allow / Deny. Remembered devices
that come in by themselves get a quieter "joined" pop-up. *Share control → Notify me when someone asks to join* turns it
off; *Test* shows a sample.

**Full-screen camera on iPhone and Android (1.11.14):** `web/phone-fullscreen.js` gives the watch page, the phone *Remote by code* camera window
and *Camera → Watch* one Full screen that works on phones: the Fullscreen API (plus a landscape lock) where it exists
(Android, desktop, iPad), the native player for WebRTC video on iPhone, and a fill-the-screen mode for relay pictures on
iPhone. Double-tap toggles it. AIRIZ Mobile 1.0.3 is rebuilt from this console (no Sound FX tab).

**View motion pictures without saving them (1.11.13):** Each Smart detection event has *View* (and a clickable thumbnail) that opens the full photo
in an in-app viewer with *Older* / *Newer* (arrow keys too) and *Play clip*. The event row no longer downloads on click;
*Save photo* / *Save clip* in the viewer are the only way to save.

**Co-admins listed by name on every PC (1.11.12):** Co-admins join on their own PC, so the owner's console never knew about them. The *Ziris PTB
team* card now lists every co-admin by name from `web/team-roster.json` on the website (bundled copy and the last good
list as offline fallback), re-read on start, on focus and every 10 minutes. Add names with
`airiz-release-kit/add_coadmin.py "Name"`; no app release is needed for a new co-admin.

**Start / stop smart detection with one click (1.11.11):** A *Start smart detection* button sits in the camera toolbar (next to *Snapshot*) and at
the top of *Smart detection*, replacing the old *Motion detection* checkbox. Both buttons stay in sync: they turn
red and read *Stop smart detection* while detection is armed, and a *Smart detection on* badge shows on the picture.

**Choose the clip length and spotlight time (1.11.10):** In *Smart detection*, *Record a clip of N s* (3-60 s, default 10) and *Spotlight on for
N s* (5-600 s, default 30) are now editable and saved with the other detection settings. Each new motion event
still restarts the spotlight timer.

**Full rise and full down buttons (1.11.9):** *Motor control* has *Full rise* and *Full down* next to the jog pad. One click sends
`diag motor rising forward|reverse <Rising speed> 1100`, i.e. the whole rising travel in one finite move. They
use the same jog lock as the pad and do not change *Steps per jog*.

**Smart detection alerts, own siren sound, simpler calibration (1.11.8):** Smart detection keeps watching while
the window is minimized (a worker clock instead of page timers; the Windows app keeps a minimized window awake while
detection is armed). Each motion event lists its alerts (*Desktop: shown*, *Ziris PTB chat: sent*, or why not), and
*Send a test alert* tries both at once. *Night vision & siren > Siren sound* plays your own WAV/MP3/M4A/OGG (first 15 s;
sent to the AIRIZ once, then repeated from there). The height buttons are now *Lower to bottom & reset height* and
*Is the camera at the bottom?* with an explanation, and *Calibration* is a numbered guide (speed, aim, timing, travel)
with the raw numbers under *Advanced numbers* and a reset.

**Camera arrows answer at once (1.11.7):** the hold arrows on the PTZ live view react like the Motor control
jog pad. A press starts the move at once (a move still running, such as click-to-center, tracking or a jog, is
stopped first instead of waited for), and every release sends the motor stop, also when the time model thinks the
move is already over, so a camera slower than the model no longer runs on after you let go.

**Camera in its own window (1.11.6):** *Camera > Open in new window* (or *New window* on the PTZ toolbar) shows
only the camera picture in a separate window that can go to another screen, full screen (button or double-click)
or stay on top (picture-in-picture). It shows the console's own live stream, so the camera is opened once and
recording, snapshots and detection keep working in the console; if the console preview stops, the window offers
*Start preview in the console*. Opened on its own (`camera-view.html`), it offers *Use the camera here*.

**Only camera modes the camera can do (1.11.5):** the camera *Mode* list no longer offers 3840×2160. Once a
preview has run, modes above what the selected camera reports (resolution or frame rate) are hidden for that
camera, remembered for next time, and a hidden selection falls back to *Auto*.

**Allow prompt, remembered devices and your own code (1.11.4):** when a phone asks to control, the PC
shows a prompt on top of the page with *Allow & remember*, *Allow once* and *Deny*, also when Share control is
closed (the Windows app flashes in the taskbar). *Remember every device I allow* is on by default, so the same
phone gets in by itself next time, also with a new code. *Share control > Your code* keeps one 6-digit code of
your own (like a password; easy codes such as 123456 are refused); changing it moves sharing to the new code at
once, phones on the old code are told and stop retrying. The code stays 6 digits because it is also the address
phones look the PC up by. If another console starts sharing the same code, the older one stops and says so.

**Zones you can delete and cancel (1.11.3):** detection zones decide where Smart detection looks: only
motion inside a zone triggers the photo, clip, auto-track, spotlight, siren and alerts; no zones = the whole
picture. *Draw zones* now says so, numbers each zone and puts an × on it to delete it (also as *Zone N* buttons
under Smart detection). Esc or right-click cancels the box being drawn, *Cancel* brings back the zones from
before *Draw zones*, *Done* keeps them. A fifth zone is refused with a message instead of silently replacing
the oldest. Zones are parts of the picture, not of the room.

**Listen clips of any length (1.11.2):** the listen clip length under *Voice settings* takes any
whole number of seconds from 1 to 3600 (it was limited to 1-4 s). Each clip is heard after it has been
recorded, so the sound is about one clip length plus 2 s behind live, with a short gap between clips.
Before each clip the AIRIZ checks that its /tmp has room for it (about 63 kB per second); if not, Listen
stops with a clear message. Stop also ends the sending of a long clip at once, and Listen pressed again
while the AIRIZ still records the last clip waits for it instead of failing. Tested against the simulated
AIRIZ shell (busybox) and in demo mode, not yet on real AIRIZ hardware.

**Go home from a phone (1.11.1):** the console that holds the AIRIZ cable (PC, or phone since 1.11.0)
shares the camera position it tracks with every device that controls by code (link protocol 4): their
PTZ view shows where the real camera is, and *Go home*, *Set home*, soft limits, *Find rising home* and
*Read rising switch* run on the console with the cable, which knows every move. Before, a phone counted
only its own moves, so its Go home missed moves made on the PC or by another phone. When Home is fully
down, Go home now checks the bottom switch and keeps lowering in 60-step chunks until it is pressed.
The return home after auto-tracking also runs while the console window is minimized. A phone on an
older PC console keeps the old behaviour and asks to update the PC.

**Phone instead of PC (1.11.0):** an Android phone can be the AIRIZ console without a PC. Power the
AIRIZ from its charger, plug the FT232R console cable into the phone with a USB-OTG adapter, open the
console in Chrome and press *Connect*: the phone drives the cable itself over WebUSB (FTDI FT232R
driver, 115200 8N1, DTR/RTS on; a CDC-ACM driver covers the AIRIZ USB port in CDC mode). Commands,
motor, Stop motor, Talk & listen and *Share control* by code work as on a PC, and the page keeps the
phone screen on while sharing. iPhones cannot do this (iOS has no USB serial for browsers or apps),
and the AIRIZ Android app's WebView has no WebUSB, so use Chrome. Stop motor now waits for a command
that is still being written instead of being dropped, and the Share control window has its own Stop
motor button. Tested with a simulated FT232R and AIRIZ (fake WebUSB device + busybox shell) and the
real relay, not yet on a real phone with a real AIRIZ. The AIRIZ firmware still cannot start anything
by itself after power-up (read-only root filesystem), so a USB host, PC or phone, must stay connected.

A complete, production-quality, dependency-free browser app that replaces the TeraTerm/CWD serial workflow for AIRIZ device motor testing.

## Features

- **Command Library**: Browse all diagnostic commands by category, with live parameter inputs
- **Serial Console**: Dark terminal with scrollback, log saving, and raw command input
- **Macro Notepad**: Visual step editor for creating and running test macros
- **Device Audio Auto-Save**: after each DMIC record, the console pulls the WAV off the device over serial and saves it to a folder
- **PWA Support**: Installable app with offline caching via service worker
- **Demo Mode**: Test the full UI without hardware connected

## Files

```
apps/airiz-motor/web/
  index.html           # Main application page
  styles.css           # All styles (CSS custom properties, responsive)
  app.js               # Application logic (Web Serial, macro runner)
  manifest.webmanifest # PWA manifest
  sw.js                # Service worker (cache-first strategy)
  icons/
    app-icon.svg       # Application icon
  data/
    commands.js        # Command library (read-only)
    macros.js          # Macro definitions (read-only)
```

## Running the App

The Web Serial API only works in a **secure context** — `http://localhost` counts, `file://` does not. So the app must be *served*, not opened as a file. Use the bundled stdlib server (no dependencies, no build):

```bash
python server/serve.py                 # serve web/ on a free port and open the browser
python server/serve.py --port 8777     # pin the port
python server/serve.py --no-browser    # don't auto-open
python server/serve.py --audio-dir "D:\recordings"   # where device audio is saved
```

It prints the URL (e.g. `http://127.0.0.1:8777/`). Open it in **Chrome or Edge** (the only browsers with Web Serial). Any other static server also works as long as it serves over `http://localhost` or `https://`.

### Device audio auto-save

After a `diag audio record …` command completes, the console (with **Auto-save recording** ticked) pulls `/tmp/dmic_record_output.wav` from the device over the serial link as base64, decodes it, and `POST`s it to the local server, which writes it into the audio folder (default `E:\Work\RD ME\Project\1-Juwen Project\ARLO\ZIRIS\Console\Audio`, override with `--audio-dir`). Files are named `dmic_<YYYYMMDD-HHMMSS>_<seconds>s_<gain>.wav`. This needs the app served by `server/serve.py` — a plain static server exposes no `/api/audio` endpoint.

> This app is intentionally **not** wired into the public GitHub Pages build
> (`scripts/build_site.py`) because it exposes internal device commands.

## Tests

```bash
python tests/test_command_data.py      # data integrity — stdlib only, exit 0/1
python tools/gen_docs.py               # regenerate docs/Commands.md from the data
```

`tests/test_command_data.py` asserts the command library still matches the source Excel (every documented command, the correct motor parameter ranges), that the three TeraTerm macros are preserved, and that the web shell stays sub-path safe and dependency-free.

## Usage

### Connecting to Hardware

1. Click **Connect** in the status bar
2. Select the FT232R USB-serial port
3. Choose baud rate (default: 115200)
4. Device prompt `~ #` should appear

### Demo Mode

If no hardware is available or Web Serial is unsupported:

1. Click **Demo Device** in the status bar
2. All UI features work with simulated responses

### Command Library

- Search commands by name or description
- Commands with parameters show live input controls
- Destructive commands (reboots) require confirmation
- Click **Send** to execute over serial

### Console

- **Clear**: Clear scrollback
- **Save Log**: Download timestamped `.txt` file
- **Autoscroll**: Toggle automatic scroll-to-bottom
- **Raw Input**: Type commands directly (Enter sends, CRLF appended)

### Macro Notepad

1. **Select** a built-in or user macro
2. **Adjust parameters** (speed, steps, pause duration)
3. **Edit steps** visually:
   - Add steps: Blank, Command, Wait, Pause, Note
   - Reorder: ↑ / ↓ buttons
   - Duplicate: ⧉ button
   - Delete: × button
   - Inline edit: Click text fields
4. **Set repeat count**
5. **Run** the macro

#### Macro Step Types

| Type | Description |
|------|-------------|
| `blank` | Send empty line (CRLF), wait for prompt |
| `command` | Send command text, wait for prompt |
| `wait` | Wait for pattern in output (with timeout) |
| `pause` | Wait fixed seconds |
| `note` | Log marker (not sent to device) |

#### Saving Macros

- **Save**: Update current user macro (built-ins prompt "Save As")
- **Save As…**: Create new user macro (stored in localStorage)
- **Delete**: Remove user macro (built-ins cannot be deleted)
- **Export .ttl**: Generate TeraTerm macro code

#### Running Macros

- **Run**: Execute macro steps in sequence
- **Pause**: Suspend execution (resumes with **Resume**)
- **Stop**: Cancel macro immediately
- Progress shows `Current Test Count = n` and `n / repeat`

## Technical Details

### Web Serial API

- `navigator.serial.requestPort()` for device selection
- `port.open({ baudRate, dataBits:8, stopBits:1, parity:'none', flowControl:'none' })`
- Read loop: `port.readable.getReader()` + `TextDecoder`
- Write: `port.writable.getWriter()` + `TextEncoder`
- Clean disconnect with try/catch for all operations

### Demo Device

Simulates device behavior:
- Echoes sent commands
- Returns expected responses from `commands.js`
- Appends `~ #` prompt after each command
- Supports macro `wait` pattern matching

### Storage

- User macros: `localStorage` key `airiz.macros.v1`
- Merged with built-in macros at runtime

### PWA

- **Manifest**: `display:standalone`, `start_url:./index.html`
- **Service Worker**: Cache-first strategy, network fallback
- **Installable**: Add to home screen / desktop

## Browser Support

- **Chrome/Edge**: Full support (Web Serial available)
- **Firefox**: Demo mode only (no Web Serial support)
- **Safari**: Demo mode only (no Web Serial support)

**Note**: Web Serial requires HTTPS or localhost (secure context).

## Command Data Source

- **Firmware version**: 0.0.0.9
- **Source**: the device command list → sheet *Command List*
- **Compiled**: 2026-06-12 (v1.2)

## Macro Data Source

- **Source files**: `test_motor.ttl`, `test_motor2 (no light).ttl`, `test_motor3 (1100).ttl`, `指令.txt`

## License

Part of the PEGAAi OpenCode project.

## Phone control (Bluetooth remote)

1. Connect the device over USB in the console → **Phone remote** → **Start remote** (shows a PIN).
2. iPhone: free **Bluefy** browser → open this site → **Connect Bluetooth** → AIRIZ-BT → PIN.
   Android: AIRIZ Mobile app or Chrome.
3. **Stop motor** (or Esc) halts a move. Repeat step 1 after every power-up (firmware cannot auto-start it).

Details: `bluetooth-bridge/README.md`.
