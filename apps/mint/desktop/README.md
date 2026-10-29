# Mint for Windows and Mac

The desktop app is Mint (Budget and Templates) in its own window instead of a browser tab:
[`mint_app.py`](mint_app.py) opens <https://juw12.github.io/projects/mint/> with the system web engine
(Microsoft Edge WebView2 on Windows 10/11, WebKit on macOS) through [pywebview](https://pywebview.flowrl.com/).

- Budgets, language, region and sign-in are kept between launches (Windows: `%LOCALAPPDATA%\Mint`,
  macOS: the app's WebKit data store). Uninstalling keeps them, so a reinstall finds every budget again.
- Exports (.xlsx, CSV, JSON backups, result cards) save to the Downloads folder; links to other sites
  open in the default browser.
- Opening Mint again brings the open window to the front; `Mint --stop` closes it.
- The first time it opens without internet it shows an offline page with **Try again**; after that the
  site's own offline cache keeps budgets available offline.
- Updates to Mint itself arrive through the website, so the desktop app rarely needs reinstalling.

## Build

```sh
python -m pip install pyinstaller pillow pywebview
python apps/mint/desktop/build.py --require-installer   # Windows: needs Inno Setup 6
python apps/mint/desktop/smoke_test.py --built --local-site
```

Output in `apps/mint/desktop/dist/`: `Mint-Windows-Setup.exe` (per-user, no admin) and
`Mint-Windows-Portable.zip` on Windows; `Mint-macOS-AppleSilicon.dmg` or `Mint-macOS-Intel.dmg` on a Mac.
The [`mint-apps`](../../../.github/workflows/mint-apps.yml) workflow builds all of them plus the Android
APK, opens each one on its own OS and publishes them to the
[`mint` release](https://github.com/juw12/projects/releases/tag/mint).

The builds are not code-signed: Windows SmartScreen asks **More info → Run anyway** once, and macOS asks
**System Settings → Privacy & Security → Open Anyway** once.
