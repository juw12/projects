# Fade for Windows

The live Fade app in its own window: book barbers, watch and post haircut shorts, DM, pay barbers directly and
earn creator commissions, on the same **Fade Network** as the website and phones. Accounts made here work
everywhere (and the other way round), and nothing about Fade's own code changes: the program serves the
shipped `web/` to a Microsoft Edge WebView2 window and adds what a desktop app needs around it.

| | |
| --- | --- |
| **Live** | Talks straight to Fade's public Nostr relays, Blossom media servers and ntfy push (`web/config.js`). |
| **Stays signed in** | Fade keeps its account key and unsent changes in the window's storage; each change is also mirrored to `%LOCALAPPDATA%\Fade\storage.json` and restored if that storage is ever empty, so restarts, reinstalls and cleared data keep you signed in. |
| **Notifications** | Booking requests, confirmations, DMs, payments and the 2-hour reminder show as Windows notifications (the taskbar button flashes) while Fade is open in the background. |
| **Links** | PayPal, Venmo, Cash App, Stripe and other payment links open in your browser; Lightning invoices in your wallet app. |
| **One window** | Starting Fade again brings the open window to the front. `Fade.exe --stop` closes it (the installer uses this). |

Data folder: `%LOCALAPPDATA%\Fade` (`storage.json`, `settings.json`, `WebView2\`, `desktop.log`). Uninstalling
keeps it, so a reinstall comes back signed in. `storage.json` holds your account key, like the browser storage
it mirrors: keep it private, or use *Account & privacy -> back up secret key* and delete the folder.

## Build

```bash
python -m pip install pyinstaller pillow pywebview
python apps/fade/desktop/build.py            # dist/Fade-Windows-Portable.zip (+ Fade-Windows-Setup.exe with Inno Setup 6)
python apps/fade/desktop/smoke_test.py --built
```

`smoke_test.py` opens the built app twice against a private copy of the Fade Network (`server/devnet.py`):
run 1 must boot in live network mode, create a real account through Fade's own API, publish its profile to the
relay (read back by the test) and save the key; run 2, with a fresh window profile, must come back signed in to
the same account and load its profile from the network. It also checks notifications reach the desktop app,
payment links open outside and unsafe links are refused. `--source` runs `fade_app.py` without building.

`Fade.exe --devnet` runs the app against a local copy of the network for development. To use other services,
set `FADE_DESKTOP_RELAYS`, `FADE_DESKTOP_BLOSSOM`, `FADE_DESKTOP_NTFY` and `FADE_DESKTOP_NS`.

`.github/workflows/fade-apps.yml` builds, smoke-tests, installs and uninstalls the app on Windows and publishes
`Fade-Windows-Setup.exe` and `Fade-Windows-Portable.zip` to the `fade` release. `web/desktop.json` announces
the current desktop version; the app offers the download page when a newer one is out.

## Limits

- Notifications arrive while Fade is open (minimised is fine). When it's closed, use the free ntfy app with your
  account's topic, as on the web.
- The app isn't code-signed yet: Windows SmartScreen asks once (*More info -> Run anyway*).
- Needs the WebView2 runtime (built into Windows 10/11); without it Fade opens in your default browser.
