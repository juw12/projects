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

https://github.com/juw12/projects/releases/tag/airiz-desktop-v1.11.7

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
