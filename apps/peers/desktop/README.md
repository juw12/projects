# Peers desktop app (Windows)

Peers as a normal Windows program: the full Peers app (the single-file desktop build in `web/index.html`)
together with its own backend (`server/server.py`), running offline in its own window.

| Download (release `peers`) | |
| --- | --- |
| [Peers-Windows-Setup.exe](https://github.com/juw12/projects/releases/download/peers/Peers-Windows-Setup.exe) | Windows 10/11, per-user install, no admin rights |
| [Peers-Windows-Portable.zip](https://github.com/juw12/projects/releases/download/peers/Peers-Windows-Portable.zip) | unzip and run `Peers.exe` |

The app isn't code-signed yet: Windows SmartScreen asks you to confirm (**More info → Run anyway**).

## What it does

- Runs Peers' server inside the program on a private loopback port (8798 unless taken) and opens
  `index.html` from it in a native window (Microsoft Edge WebView2, via [pywebview](https://pywebview.flowrl.com/)).
- Keeps everything in a real database: `%LOCALAPPDATA%\Peers\peers.db` (SQLite). The server's serve-time shim
  saves every change the app makes - reviews, votes, categories, the market, settings - so your data survives
  restarts, reinstalls and cleared browser data. The web files stay byte-pristine, exactly as the server README
  describes. **Settings → Your data** still exports and imports JSON (exports open a Save dialog).
- Works fully offline. Links to other sites open in your default browser. Opening Peers again brings the window to
  the front; `Peers --stop` closes it (the installer uses that before updating). Without WebView2 Peers opens in
  your default browser instead.
- Once per new version it offers the download page, announced in `web/desktop.json`.

## Build

```bash
python -m pip install pyinstaller pillow pywebview
python apps/peers/desktop/build.py            # also Peers-Windows-Setup.exe if Inno Setup 6 is installed
python apps/peers/desktop/smoke_test.py --built
```

`smoke_test.py` opens the built app twice with `PEERS_WINDOW_TEST` and a throwaway data folder: the first run saves
a change through the app's own `saveState()` and checks it reached `peers.db`; the second run uses a fresh browser
profile and checks the change is still there. The app icon is drawn from `web/icons/app-icon.svg` at build time.

CI: [`.github/workflows/peers-apps.yml`](../../../.github/workflows/peers-apps.yml) builds, runs Peers' own tests and
the smoke test, installs and uninstalls the setup, and publishes the files above to the `peers` release.
The same code builds a macOS app (`build.py` on a Mac); it isn't part of CI yet.
