# ME R&D Toolkit for Windows

The toolkit in its own window - NPI flow, checklists, issue log, project report, calculators and the file vault -
with your data kept on this PC instead of only in a browser. The toolkit's own files are unchanged: the program
serves the shipped `web/` (and, when configured, `server/vault_server.py`) to a Microsoft Edge WebView2 window.

| | |
| --- | --- |
| **Projects stay put** | Tracked projects, checklist results, stars and recent items are mirrored to `%LOCALAPPDATA%\ME-RD-Toolkit\storage.json` and restored if the window storage is ever empty - restarts, reinstalls and cleared data lose nothing. |
| **Private data pack** | Put `pack.js`, `calcs.js` or `aliases.js` in `%LOCALAPPDATA%\ME-RD-Toolkit\private\` (the repo's `private/` layout), or use *Data & Backup -> Import data pack*: the imported pack is also saved to `private\pack.json` and loads on every launch. `ME-RD-Toolkit.exe --data-folder` opens the folder. |
| **Open real files** | File and folder paths from the data pack get an **↗ Open** button (clicking a file name works too) that opens them in their own program - SolidWorks, Excel, a PDF reader, or Explorer for folders. Programs and scripts (`.exe`, `.bat`, `.ps1`, `.lnk`, ...) are never launched. |
| **File Vault built in** | Copy `server/vault_config.example.json` to `private\vault_config.json` and set your roots and categories. The vault then runs inside the app: browse, search and open shared files in the window (opened from disk, respecting the vault's exclusions), while teammates use the same vault at `http://<this-pc>:<port>/` with the shared password, read-only and logged - exactly as `vault_server.py`. |
| **Desktop basics** | One window at a time (`--stop` closes it), window size remembered, CSV/backup downloads, printing, update notice from `web/desktop.json`. |

Keep the vault on your internal network: HTTP Basic auth is not encrypted (see the toolkit README). Windows
Firewall asks once when the vault first shares on the network.

## Build

```bash
python -m pip install pyinstaller pillow pywebview
python apps/me-rd-toolkit/desktop/build.py           # dist/ME-RD-Toolkit-Windows-Portable.zip (+ Setup.exe with Inno Setup 6)
python apps/me-rd-toolkit/desktop/smoke_test.py --built
```

`smoke_test.py` builds a throwaway data folder with a vault over a small shared folder (one hidden folder) and
opens the app twice. Run 1: the toolkit starts with the vault on; a project change reaches `storage.json`; a data
pack imported the way *Data & Backup* does is saved to `private\pack.json`; the in-app vault searches, hides the
excluded folder and opens a shared file; a data-pack path gets an Open button that opens the file, while a program
and a missing path are refused; and teammates' access is checked from outside (401 without the password, 200 with
it). Run 2, with a fresh window profile, must find the project change and the data pack again. `--source` runs
`merd_app.py` without building.

`.github/workflows/me-rd-toolkit-apps.yml` runs the toolkit's tests, builds, smoke-tests, installs and uninstalls
the app on Windows and publishes `ME-RD-Toolkit-Windows-Setup.exe` and `ME-RD-Toolkit-Windows-Portable.zip` to the
`me-rd-toolkit` release.

## Limits

- Not code-signed yet: Windows SmartScreen asks once (*More info -> Run anyway*).
- Needs the WebView2 runtime (built into Windows 10/11); without it the toolkit opens in your default browser.
- Paths written as `[Root Name]\...` open when an `aliases.js` or the vault config maps that root.
