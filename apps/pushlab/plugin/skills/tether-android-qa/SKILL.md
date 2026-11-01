---
name: tether-android-qa
description: Drive and test a real Android phone or emulator through Tether (adb in the browser) - read the screen, tap by text or id, type, swipe, launch apps, read logcat, run Tether JSON or Maestro YAML flows and record the screen. Use when asked to test, reproduce a bug, or automate something on an Android device.
---

# Tether Android QA

Tether exposes a connected Android device (USB, Wi-Fi adb or emulator) over a
local HTTP API. `scripts/pushlab_cli.py` (Python 3 standard library only) wraps
it; every command prints JSON and exits 0 on success, 1 when a check fails and
2 when Tether is unreachable or the request was invalid.

## Before you start

1. Run `python scripts/pushlab_cli.py status`.
   - `tether.error` means Tether is not running. Ask the user to start it
     (`python apps/pushlab/pushlab.py` starts Tether + Beacon together, or
     `python apps/tether/server/server.py`) or to set `TETHER_URL` and `TETHER_TOKEN`.
   - `tether.devices` must list a device with `state: "device"`. `unauthorized`
     means the user must accept the USB-debugging prompt on the phone.
2. With more than one device, pass `--serial <serial>` before the command.

## Core loop: look, act, verify

1. **Look** - `ui` lists on-screen elements (text, resource_id, desc, bounds).
   Use `screenshot --out screen.png` and open the image when layout or visuals
   matter (colours, overlap, clipped text).
2. **Act** - prefer selectors over coordinates:
   - `tap-text "Sign in"`, `tap-id login`, `tap-desc "Navigate up"`
   - `type "user@example.com"` types into the focused field (tap it first)
   - `key back|home|enter|recents`, `swipe up|down|left|right`
   - `tap 0.5 0.8` uses normalised coordinates (0..1) only when nothing is labelled
3. **Verify** - call `ui` (or take a screenshot) after every action. Never assume
   a tap worked; check for the expected text or screen.

## Apps and logs

- `apps` lists third-party packages and the foreground activity.
- `launch <package>`, `stop <package>`, `clear <package>` (wipes app data).
- `logcat --package <package> --lines 300` for that app's log; search it for
  `FATAL EXCEPTION`, `ANR` and `E/` lines when something misbehaves.

## Repeatable tests (flows)

Write the steps as a Maestro YAML flow (portable to Maestro CLI and Maestro
Cloud) or a Tether JSON flow, then run `flow login.yaml`. Exit code 1 means a
step failed; the JSON report names the step and the reason. Example:

```yaml
appId: com.example.app
---
- launchApp:
    clearState: true
- tapOn: "Email"
- inputText: "qa@example.com"
- tapOn:
    id: "login"
- assertVisible: "Dashboard"
```

Supported Maestro commands include launchApp (with clearState), tapOn,
doubleTapOn, longPressOn, inputText, eraseText, assertVisible, assertNotVisible,
scroll, scrollUntilVisible, swipe, back, pressKey, hideKeyboard, openLink,
extendedWaitUntil, waitForAnimationToEnd and takeScreenshot; anything else is
skipped and reported in `maestro_warnings`.

## Evidence for bug reports

- `record start` then reproduce, then `record stop --out bug.mp4` (MP4 from
  `adb screenrecord`, max 180 s, no audio).
- Attach the screenshot, the failing flow report and the relevant logcat lines.

## MCP alternative

Tether also ships an MCP server (`apps/tether/server/mcp_server.py`) with
mobile-mcp compatible tools (`mobile_list_elements_on_screen`,
`mobile_click_on_screen_at_coordinates`, ...). If those tools are available in
this session, you may use them instead of the CLI; the workflow is the same.
