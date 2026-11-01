# Tether

**Stream and drive Android phones and emulators from your browser — record QA flows, replay them in CI, and let AI agents test your apps.**

A Windows-friendly, zero-dependency take on the idea behind
[TapFlow](https://github.com/jo-duchan/tapflow) (which streams iOS/Android
simulators from a Mac). Tether needs only **Python 3 + adb**, so it runs on the
same Windows PC you build your Capacitor apps on (Vitals, Glow, Airiz, Guangyao…).

![Flow tab](docs/screenshot-flow.png)

| | |
| --- | --- |
| **Live screen** | Click = tap, hold = long-press, drag = swipe, wheel = scroll, type straight into the device, hardware keys, screenshot download |
| **Flows** | Record what you do → JSON flow → replay on any phone (coordinates are normalised). Add `tap_element` / `assert_text` steps from the inspector — they survive layout changes |
| **Inspect** | Reads the live UI tree (uiautomator), draws element boxes over the screen, one-click tap / +step / +assert |
| **Apps** | Drag-drop an APK anywhere to install; launch / stop / clear data |
| **Logs** | logcat, optionally only from one app's process, with highlight (e.g. `FATAL`) and live refresh |
| **Team sharing** | `--lan` lets teammates on your network open the same device (token-protected) |
| **AI agents (MCP)** | `mcp_server.py` gives Claude / Cursor / VS Code / OpenCode agents `screenshot`, `ui_elements`, `tap_element`, `type_text`, `logcat`, `run_flow`, … |
| **CI** | `flows.py run flow.json` → exit 0/1, `report.json` + screenshots |

## Quick start

```bash
python apps/tether/server/server.py          # opens http://127.0.0.1:8765/#token=…
python apps/tether/server/server.py --lan    # share with your team on the LAN
```

- **No adb?** Tether shows **Install it for me**: a one-time ~7 MB download of Google's Platform-Tools into `apps/tether/tools/`. It works through corporate proxies and doesn't need admin rights or PATH changes. (Command-line equivalent: `python apps/tether/server/adb_setup.py`.)
- **Phone:** *Settings → About → tap Build number 7×*, then *Developer options → USB debugging*. Plug it in and accept the prompt.
- **No cable:** click **📶 Wi-Fi** and type the pairing address and 6-digit code from *Developer options → Wireless debugging → Pair device with pairing code* (Android 11+).
- **With Beacon:** use `apps/pushlab/start-push-lab.bat` instead. It starts both apps already linked (see [../README.md](../README.md)).

## Flows

```json
{
  "name": "login smoke",
  "steps": [
    {"action": "clear_data", "package": "com.example.app"},
    {"action": "launch", "package": "com.example.app"},
    {"action": "wait_for", "text": "Sign in", "timeout_ms": 10000},
    {"action": "tap_element", "resource_id": "email"},
    {"action": "text", "text": "qa@example.com"},
    {"action": "tap_element", "text": "Sign in"},
    {"action": "assert_text", "text": "Dashboard"},
    {"action": "screenshot", "name": "dashboard"}
  ]
}
```

Actions: `launch`, `stop`, `clear_data`, `tap`, `long_press`, `swipe`, `text`, `key`,
`tap_element`, `wait_for`, `assert_text`, `assert_gone`, `wait`, `screenshot`.
`tap`/`swipe` use normalised `x`,`y` (0–1). Element steps match `text`, `resource_id`
(full or short) or `desc`.

```bash
python apps/tether/server/flows.py run apps/tether/examples/smoke.tether.json --out reports/
```

## Maestro flows

Tether reads and writes [Maestro](https://github.com/mobile-dev-inc/maestro) (Apache-2.0) YAML, so existing
`maestro test` suites run in the browser and Tether flows can go back to Maestro:

- Flow tab → **Import** accepts `.yaml`; **Export Maestro** downloads one.
- `python server/flows.py run login.yaml` runs a Maestro file directly (exit code 0/1 for CI).
- `python server/flows.py convert login.yaml login.json` (or the other way round).
- MCP `run_flow` accepts `maestro_yaml`.

Supported: `launchApp` (clearState/stopApp), `stopApp`, `clearState`, `tapOn` / `longPressOn` / `doubleTapOn`
(text, id, `point` in %), `inputText`, `eraseText`, `pressKey`, `back`, `hideKeyboard`, `assertVisible`,
`assertNotVisible`, `extendedWaitUntil`, `swipe` (direction or start/end %), `scroll`, `scrollUntilVisible`,
`takeScreenshot`, `openLink`, `waitForAnimationToEnd`, `optional: true`. Anything else (`runFlow`, `repeat`,
`evalScript`, absolute pixel points, relative selectors…) is reported as a warning, never silently dropped.
Tether-only steps (Beacon push, notifications) export as `# tether:` comments.

## HD mode (scrcpy)

The **HD** button under the screen switches from PNG screenshots (~2-8 fps) to a 30 fps H.264 stream from
[scrcpy](https://github.com/Genymobile/scrcpy)'s device server (Apache-2.0, v5.0.1, downloaded once, SHA-256
checked, 734 KB). The browser decodes it with WebCodecs (Chrome/Edge, Firefox 130+), and taps, swipes, keys and
text go through scrcpy's control socket instead of `adb shell input` — milliseconds instead of a few hundred.
Turning HD off (or any error) falls back to screenshots and adb input. API: `/api/hd/start`, `/api/hd/stop`,
`/api/hd/status`, `/api/hd/stream`.

## CI on an emulator

[`examples/ci/android-emulator.yml`](examples/ci/android-emulator.yml) is a GitHub Actions template that boots an
emulator with [ReactiveCircus/android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner)
and runs your flows (JSON or Maestro YAML) with `flows.py run`, uploading screenshots and reports.

## AI agents (MCP)

Add to your MCP client config (Claude Desktop, Cursor, VS Code, OpenCode…):

```json
{
  "mcpServers": {
    "tether": {
      "command": "python",
      "args": ["C:/Users/you/projects/apps/tether/server/mcp_server.py"]
    }
  }
}
```

Then ask: *"Install app-debug.apk, open it, sign in as qa@example.com and tell me if anything crashes in logcat."*
Screenshots are downscaled on the host (~1024 px) to keep agent context small; `tap`
coordinates default to the screenshot's pixel space.

## Push QA with Beacon

Tether and [Beacon](../beacon) work together: Beacon **sends** the notification, Tether **proves it arrived** on a real phone, taps it and checks where it leads. They stay separate servers on purpose. Beacon is public and always on behind HTTPS. Tether controls USB devices and should stay on your machine.

```bash
python apps/tether/server/server.py --beacon-url https://push.example.com --beacon-key sk_…
# or locally: apps/pushlab/start-push-lab.bat sk_…
```

1. In the **Push** tab, click **📲 Connect this phone to Beacon** (or put a `beacon_subscribe` step first in your flow). To test your own PWA instead, subscribe from it with `Beacon.subscribe({ tags: ["qa:device"] })`.
2. In Tether's **Push** tab, click **Send now** to see the delivery and arrival check, or click **+ full push QA steps**.
3. Save the flow and run it in CI: `python apps/tether/server/flows.py run apps/tether/examples/push-qa.tether.json`.

| Step | |
| --- | --- |
| `push` | send through Beacon. Fails if no subscriber matched or Beacon delivered to 0 |
| `wait_notification` | the notification must appear on the device (`dumpsys notification`), optionally from a given `package` |
| `tap_notification` | open the shade and tap it |
| `close_notifications` | collapse the shade |
| `beacon_subscribe` | open Beacon's subscribe page on the phone and tap *Enable* + *Allow*. A local Beacon is reached through `adb reverse`, so no HTTPS is needed |

`{run}` in any step becomes a fresh id per run, so a test never passes because of yesterday's notification. AI agents get the same tools through Tether's MCP server: `send_push`, `list_notifications` and `tap_notification`.

![Push tab](docs/screenshot-push.png)

## Security

- Every `/api` call needs the access token (printed at start-up, passed in the URL `#fragment`).
- Local mode binds `127.0.0.1` and rejects foreign `Host` headers (DNS-rebinding protection).
- `--lan` binds all interfaces: **anyone with the link controls the device** — share it like a password.
- Package names are validated; text input is shell-escaped; uploads must be real APKs.

## Limits

- Frames are PNG screencaps (~3–8 fps on USB, slower over Wi-Fi adb). Great for QA and agents, not for games or video.
- `input text` is ASCII only (Android limitation); for other scripts, paste via the device keyboard.
- No audio, no multi-touch gestures (pinch).
- Android only — iOS simulators need a Mac (that's TapFlow's niche).

## Layout

```
apps/tether/
  server/adb.py         adb wrapper (shared by everything)
  server/server.py      HTTP API + frame hub + static web UI
  server/flows.py       flow runner + CLI
  server/mcp_server.py  MCP stdio server for AI agents
  web/                  static UI (no build step)
  tests/                hermetic tests with a fake adb
  examples/             sample flows
```

## Tests

```bash
python apps/tether/tests/verify_api.py            # 56 checks, no device needed
python apps/tether/tests/verify_beacon_link.py    # 22 checks: real Beacon → encrypted push → fake phone → tap
```
