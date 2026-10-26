# AIRIZ controller dashboard: feature comparison

Compared against the published AIRIZ Motor Test Console and repository baseline
`eb2b25ccd724504e5096e79c85159cafcb1181cf` on 2026-10-26.

## Gaps found and restored before replacement

| Feature | Published console | First redesign | Replacement |
| --- | --- | --- | --- |
| Dark / Light / System theme | Available | System omitted | All three restored; System follows OS changes and persists |
| Auto-save recording preference | Available | Hidden below the desktop breakpoint | Visible on desktop, tablet and mobile; saved preference retained |
| Firmware-reference and command-source details | Visible | Hidden metadata; reference version only on dashboard footer | Visible in every workspace, explicitly marked command reference |
| Installation fallback instructions | Startup gate offered instructions | Native browser prompt only | Persistent install/help entry, native prompt when available, keyboard-accessible fallback dialog |
| Shortcut help on mobile | Not applicable | New help was sidebar-only | Dedicated mobile help control |

The replacement intentionally does not force an install overlay on startup. The
same install capability and fallback guidance are available on demand. Demo mode
remains explicitly labeled; an unsupported serial browser never silently becomes
a simulated device.

## Preserved feature inventory

- **53 command definitions in 21 groups**; firmware command templates, parameter
  definitions and existing defaults are unchanged.
- **6 macro templates**, including the original TeraTerm-derived sequences.
  Selection, parameters, repeat, step editor, Save, Save As, Delete, TTL export,
  Run, Pause/Resume and Stop remain available.
- **41 built-in sounds in 6 categories**, with search, category filters, volume,
  playback, Stop all and user sound import.
- Serial connection/disconnection, baud selection, explicit demo, raw commands,
  console logging, log export, autoscroll and recording auto-save.
- Camera selection and resolution/mode controls, exact-mode toggle, fit/fill/
  fullscreen, still capture and photo capabilities, diagnostics, snapshots,
  recording, session folders/logs, camera settings, mirror/rotation and ffmpeg
  helper.
- Camera quick serial actions for IR-cut day/night, IR/spot lights and duty,
  ambient-light queries and daylight-fix sequence.
- PWA manifest and offline shell, now including the additional dashboard assets
  and scope-specific cache management.
- All **118 original HTML IDs** are preserved. Command, macro and sound data are
  unchanged from the source baseline. Local-storage keys for saved macros,
  recording preferences and existing camera settings remain compatible.

## New controller features

- Directional finite-step jog pad with opt-in arrow-key control.
- Native speed/strength sliders, integer step inputs and shared step presets.
- Exact command preview, defaulting the new jog pad to one step per action.
- Explicit hardware-jog confirmation; focus loss, workspace changes, modal
  installation help, macro startup, disconnect and Escape lock manual jogging.
- Command visualization, timestamps, console message filters, dispatch/receive
  line counters, command history and a Send button.
- Responsive workspace navigation and dark/light/system presentation.

## Verification

- The repository's original AIRIZ data-integrity checks.
- Additional standard-library regression tests for preserved UI IDs, asset
  loading/cache coverage, reference metadata, theme and install entry points.
- Browser checks at widths from 360 through 1920 pixels, with no horizontal
  overflow in any workspace.
- Browser tests for jog directions, range validation, keyboard guards,
  serial reconnection, macro workflow, logs, offline reload and saved preferences.
- In-memory Web Serial tests for baud selection, exact CRLF command framing,
  confirmation and manual-control locks. No real serial device was opened.
- Synthetic camera tests for preview, fit/fill, mirror/rotation, still/snapshot,
  recording and session artifacts/log export; file handles were in-memory mocks.
- Browser checks for synthesized sound playback and user-audio import.

## Remaining hardware limitations

This is a browser-tested controller UI, **not a hardware safety validation**.
The illustration acknowledges command dispatch, not measured position or motion
completion. No motor-stop or home command was documented, so none is invented.
Locking/disconnecting the UI does not cancel an already-issued finite move.

The hardware jog lock applies to the new jog pad and keyboard controls only;
raw commands, library buttons, camera serial controls and macros retain their
existing operation. Test the actual mechanism, camera, microphone and recording
transfer on the bench before relying on them.

The inherited “Step sweep 10 → 100%” macro has a speed default of 1070, outside
the command library's documented Rising range. This pre-existing inconsistency
is preserved rather than silently changing device commands; resolve it before
using that macro with hardware.

## Deployment and rollback

The existing GitHub Pages workflow builds the app from the AIRIZ web source to
the same public URL. No other application or deployment workflow is modified.
Existing browser sessions should reload after deployment to receive the updated
shell. Reverting the scoped UI commit restores the previous source; a separate
snapshot of the published assets was also retained locally.


## Follow-up: downloadable Windows application

The browser/PWA install action is now clearly distinguished from the Windows app.
A locally bundled Electron edition adds an installer, portable executable, native
serial-port chooser, restricted local IPC and a guarded close flow. The page and
project catalog link to the actual release executables, not just the website.
The interface and all firmware definitions remain shared with the browser edition.
Desktop packaging details and test boundaries are documented with its source.


## 1.1.0 user-requested revision

The earlier confirmation and focus/tab auto-lock behavior is superseded: connecting
now enables jogs and, by default, arrow-key control. Manual Lock/Escape and normal
connected/busy/input/dialog guards remain. No command is sent automatically on
connection. Explicit keyboard-off preferences persist.

Installed Windows builds now have startup/periodic update checks and a guarded,
user-approved installer flow. Active device, macro, recording and capture sessions
prevent installation; the console atomically rejects new commands while installing.
The original Bluetooth-on command also has a direct connection-bar shortcut.
