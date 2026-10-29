# Twin desktop app (Windows and macOS)

The public Twin website only offers practice money. Real trading needs a Twin server on your own computer,
because that server keeps your broker connection and talks to Alpaca or Interactive Brokers. This folder
turns that server and the app into one normal program, so nobody has to install Python or use a terminal.

| Download (release `twin`) | |
| --- | --- |
| [Twin-Windows-Setup.exe](https://github.com/juw12/projects/releases/download/twin/Twin-Windows-Setup.exe) | Windows 10/11, per-user install, no admin rights |
| [Twin-Windows-Portable.zip](https://github.com/juw12/projects/releases/download/twin/Twin-Windows-Portable.zip) | unzip and run `Twin.exe` |
| [Twin-macOS-AppleSilicon.dmg](https://github.com/juw12/projects/releases/download/twin/Twin-macOS-AppleSilicon.dmg) | M1 and newer |
| [Twin-macOS-Intel.dmg](https://github.com/juw12/projects/releases/download/twin/Twin-macOS-Intel.dmg) | Intel Macs |

The apps are not code-signed yet: Windows SmartScreen asks you to confirm (**More info → Run anyway**) and
macOS needs **right-click → Open** the first time.

## What it does

1. Copies the Twin code it ships with to your user folder (`%LOCALAPPDATA%\Twin\app` or
   `~/Library/Application Support/Twin/app`) — once, and again only when the app brings a newer Twin.
   **Me → Update Twin** installs new Twin versions over that copy, like any Twin you run yourself.
2. Starts Twin's own `server.py` on a private loopback port (8799 unless taken; it stays the same between
   launches so the app keeps its saved settings). Accounts, practice portfolios and broker connections live
   in `...\Twin\data`; daily backups go to `...\Twin\data\backups`. Logs: `...\Twin\logs`.
3. Shows Twin in its own window (Microsoft Edge WebView2 on Windows, WKWebView on macOS, via
   [pywebview](https://pywebview.flowrl.com/)). Broker sites (deposits, account opening) open in your
   normal browser. Opening Twin again brings the window to the front; closing it stops the server.
   Without WebView2, Twin opens in your default browser instead.

The program is also the Python that runs Twin: `server.py` starts its tools as
`[sys.executable, tool.py, ...]` and restarts itself after an update the same way, so `Twin.exe tool.py`
runs that script. The build bundles the full Python standard library for this.

## Real money

Connect **Me → Real trading → Alpaca** (API keys) or **Interactive Brokers** (Client Portal Gateway on the
same computer), exactly as described in the [Twin README](../README.md#real-trading-optional-local-server-only).
**Invest → Real → Add money** shows your broker cash and buying power, walks you through a deposit at the
broker and tells you when it arrives. Twin never holds or moves your money: deposits go from your bank to
your own regulated brokerage account, and orders are placed in that account.

## Build

```bash
python -m pip install pyinstaller pillow pywebview
python apps/twin/desktop/build.py              # Windows: also Twin-Windows-Setup.exe if Inno Setup 6 is installed
python apps/twin/desktop/smoke_test.py --built --tools
```

`smoke_test.py` opens the built app with `TWIN_WINDOW_TEST` (a throwaway Twin home next to its report): the
window must load the app from its own server (not the web demo), and the server must create an account, run
a Twin tool through the program, answer Add money and the update check. `--tools` first runs every Twin tool
through the program (`Twin --selftest-tools`).

CI: [`.github/workflows/twin-apps.yml`](../../../.github/workflows/twin-apps.yml) builds and tests on
Windows, macOS Apple Silicon and macOS Intel, and publishes the files above to the `twin` release.
The desktop app's own version is in `twin_app.py` and `web/desktop.json` (the app offers its download page
once when a newer one is published); Twin itself updates in the app.

Other commands: `Twin --version`, `Twin --stop` (closes an open window and its server; the installer uses it).
