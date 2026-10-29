# Sweep for Windows and Mac

A small native window (pywebview: WebView2 on Windows, WKWebView on macOS) around the live app at
<https://juw12.github.io/projects/sweep/>. It loads the site, so every push to `apps/sweep/web` reaches
installed apps on their next launch; only changes to this folder need a new download.

What the window adds (through `web/native.js`, which detects `window.pywebview`):

- **Real files.** Exports (project zip, briefs, runbooks, JSON) open a native **Save** dialog instead of
  being silently dropped by the WebView (`DesktopApi.save_file`).
- **External links** open in the default browser; Sweep stays in its own window.
- **Update prompt.** `web/shell.json` lists the current shell version; an older app shows
  *"Sweep 1.x is available"* with a link to the new installer.
- Remembers its window size, fits it to the screen, follows the system light/dark theme, and
  shows `offline.html` (with *Try again*) when the site cannot load.
- Data lives in `%LOCALAPPDATA%\Sweep` (Windows) or `~/Library/Application Support/Sweep` (macOS).

## Build

```sh
python -m pip install pyinstaller pillow pywebview
python apps/sweep/desktop/build.py            # add --require-installer in CI
python apps/sweep/desktop/smoke_test.py --built --local-site
```

Outputs in `apps/sweep/desktop/dist/`: `Sweep-Windows-Setup.exe` (per-user Inno Setup installer, needs
Inno Setup 6), `Sweep-Windows-Portable.zip`, and on a Mac `Sweep-macOS-AppleSilicon.dmg` or
`Sweep-macOS-Intel.dmg`. The version comes from `web/shell.json` → `desktop.version`
(must equal `VERSION` in `sweep_app.py`; the static test checks it).

`SWEEP_DESKTOP_URL` points the window at another copy of the site (for testing); `SWEEP_WINDOW_TEST=report.json`
makes it write a load report and close itself (used by `smoke_test.py` and CI).

## Releasing a new shell

1. Change files here, bump `VERSION` in `sweep_app.py` and `desktop.version` in `web/shell.json`.
2. Push to `main`. The *Sweep apps* workflow builds, installs and smoke-tests every platform and replaces the
   files on the `sweep` release (links never change). Installed apps see the new `shell.json` and offer it.

The apps are not code-signed: Windows SmartScreen shows *More info → Run anyway*, macOS needs
*Privacy & Security → Open Anyway* the first time.
