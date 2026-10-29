# Vitals desktop app (Windows, macOS, Linux)

The downloadable Vitals app: the same agent (`../server`) and dashboard (`../web`) as the one-line
installers, bundled with Python by [PyInstaller](https://pyinstaller.org), so nothing else needs
installing. Builds are published to the
[`vitals` release](https://github.com/juw12/projects/releases/tag/vitals) by
`.github/workflows/vitals-apps.yml`.

## How it behaves

`vitals_app.py` is the entry point:

| Command | What happens |
| --- | --- |
| `Vitals` (double-click) | Starts the agent in the background if it isn't running and opens the **Vitals window**. Opening it again brings that window to the front; closing it leaves the agent running in the background. |
| `Vitals --browser` | Shows the dashboard in your web browser instead (`http://127.0.0.1:8765/` works in any browser too). |
| `Vitals --background` | Runs the agent without opening anything. This is the sign-in item. |
| `Vitals --stop` | Closes the window and stops the agent (the Windows installer uses it before updating or uninstalling). |
| `Vitals --remove-login-item` | Stops starting Vitals at sign-in (and remembers that choice). |

Other options (`--port`, `--data`, `--home`, `--lan`, ...) go to the agent. Output goes to
`~/.vitals/agent.log` when there is no terminal. Sign-in: the Windows installer adds a Startup
shortcut (a checkbox); on macOS the app adds a LaunchAgent the first time it is opened from
Applications; on Linux it adds an autostart entry (and an app-menu entry for the `.tar.gz`). These
use the same names as the one-line installers, so the two kinds of install replace each other.

## The window

`app_window.py` shows the dashboard in a native window, not a browser tab:

| System | Window | Needs |
| --- | --- | --- |
| Windows 10/11 | Microsoft Edge WebView2 via [pywebview](https://pywebview.flowrl.com) (bundled) | The WebView2 runtime, which Windows 11 and up-to-date Windows 10 already have |
| macOS | WKWebView via pywebview (bundled); a normal Dock app | Nothing |
| Linux | WebKitGTK, run by `linux_window.py` with the system Python | `python3-gi` and `gir1.2-webkit2-4.1` (the `.deb` recommends both, so apt installs them) |

If the window can't be shown (no WebView2 runtime, no GTK bindings), Vitals opens in a
Chromium-based browser's app mode (Edge, Chrome, Brave: a plain window without tabs or address
bar), and failing that in the default browser. Only one window is open at a time: a second launch
asks the open one to come to the front over a loopback socket described in `~/.vitals/window.json`,
and `--stop` asks it to close. Links to other sites open in your normal browser. The window
remembers its size (`~/.vitals/window-size.json`); its page storage lives in
`%LOCALAPPDATA%\Vitals\WebView2`, `~/Library/WebKit` (macOS) or `~/.local/share/vitals/webkit`.

## Build

```sh
python -m pip install pyinstaller pillow pywebview   # pywebview: Windows and macOS only
python apps/vitals/desktop/build.py                  # add --require-installer on Windows CI
python apps/vitals/desktop/smoke_test.py --built --window   # Linux: xvfb-run -a python ...
```

`--window` also opens the app window and checks that it shows the live dashboard, that a second
launch reuses it and that `--stop` closes it (CI runs this on every OS).

| System | Output in `dist/` |
| --- | --- |
| Windows | `Vitals-Windows-Setup.exe` (needs [Inno Setup 6](https://jrsoftware.org/isinfo.php); per-user, no admin, listed in Settings → Apps) and `Vitals-Windows-Portable.zip` |
| macOS | `Vitals-macOS-AppleSilicon.dmg` or `Vitals-macOS-Intel.dmg`, matching the Mac it was built on |
| Linux | `Vitals-Linux-x64.deb` (installs to `/opt/vitals`, `vitals` on the PATH) and `Vitals-Linux-x64.tar.gz` |

The Linux build runs on systems whose glibc is at least as new as the build machine's (CI builds on
Ubuntu 22.04, glibc 2.35).

## Signing

The builds are not code-signed. Windows SmartScreen shows "Windows protected your PC" (**More info →
Run anyway**) and macOS asks you to approve the app once in **System Settings → Privacy & Security →
Open Anyway**. Removing those prompts needs a Windows code-signing certificate and an Apple Developer
ID (notarization) — both paid.

## Files

- `vitals_app.py` — launcher / entry point
- `app_window.py` — the Vitals window (pywebview on Windows/macOS), one-window-at-a-time, fallbacks
- `linux_window.py` — the Linux window (WebKitGTK), run with the system Python
- `vitals.spec` — PyInstaller recipe (folder build; only the window backend each system needs)
- `build.py` — stages the dashboard from `web/files.txt`, runs PyInstaller, packages per OS
- `vitals.iss` — Inno Setup script for the Windows installer
- `smoke_test.py` — opens a build (or the launcher from source) and checks start, dashboard, reuse and stop
  (and with `--window`, the app window)
