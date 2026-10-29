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
| `Vitals` (double-click) | Starts the agent in the background if it isn't running, opens `http://127.0.0.1:8765/` in your browser, exits. Opening it again just shows the dashboard. |
| `Vitals --background` | Runs the agent without opening anything. This is the sign-in item. |
| `Vitals --stop` | Asks a running agent to exit (the Windows installer uses it before updating or uninstalling). |
| `Vitals --remove-login-item` | Stops starting Vitals at sign-in (and remembers that choice). |

Other options (`--port`, `--data`, `--home`, `--lan`, ...) go to the agent. Output goes to
`~/.vitals/agent.log` when there is no terminal. Sign-in: the Windows installer adds a Startup
shortcut (a checkbox); on macOS the app adds a LaunchAgent the first time it is opened from
Applications; on Linux it adds an autostart entry (and an app-menu entry for the `.tar.gz`). These
use the same names as the one-line installers, so the two kinds of install replace each other.

## Build

```sh
python -m pip install pyinstaller pillow
python apps/vitals/desktop/build.py            # add --require-installer on Windows CI
python apps/vitals/desktop/smoke_test.py --built
```

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
- `vitals.spec` — PyInstaller recipe (folder build; `Vitals.app` without a Dock icon on macOS)
- `build.py` — stages the dashboard from `web/files.txt`, runs PyInstaller, packages per OS
- `vitals.iss` — Inno Setup script for the Windows installer
- `smoke_test.py` — opens a build (or the launcher from source) and checks start, dashboard, reuse and stop
