# apps/vitals

**Vitals: a device-health copilot for laptops and phones.** It cleans storage you
can take back, explains every number it shows, predicts battery wear, catches apps
that drain power while you're away, and has a chat that diagnoses problems from
plain words ("my laptop is slow", "free 10 GB without touching downloads").

- **Live (browser mode + demo):** https://juw12.github.io/projects/vitals/ · add `#demo` to explore every feature with simulated data
- **App / Web / Mobile:** `web/app.html` · `web/index.html` · `web/mobile.html`
- **Download the app (Windows, Mac, Linux, Android, iPhone):** https://github.com/juw12/projects/releases/tag/vitals · see [Download](#download)
- **Install (one copy-paste, see below):** real scans, Undo Vault, live vitals, app icon, starts at login

Zero dependencies. The agent runs on the Python 3.8+ standard library (`psutil` is
used if it happens to be installed, but nothing needs it), and the front-end is a
static offline PWA. It works on macOS, Windows and Linux. On phones it runs as a
PWA with built-in guides, and it can pair with your laptop's agent.

## What it does

| Area | Features |
| --- | --- |
| **Home (Simple mode, default)** | One status in plain words ("A few things to tidy up"), one big **Fix everything safely** button, and a short "What I found" list where each item has its own one-tap fix. No scores or jargon unless you open **Detailed view**. The first launch runs a checkup automatically. |
| **Fix everything safely** | Shows exactly what will be cleared (only categories that rebuild themselves), then lets you pick *keep a 3-day backup* (default) or *free the space now* (suggested when the disk is under 5% free). The result card has **Undo** and **Free it now** buttons. In chat, "just fix it" or "make it faster" does the same thing. |
| **Automatic care** | One switch: weekly safe cleanup into the Undo Vault, and a desktop notification (macOS, Linux and Windows toast) if storage drops under 5%. Off until you turn it on. |
| **Overview** | Health score that starts at 100 and lists every penalty with its measured cause ("Storage almost full −30: 1.1 GB free"). Four-ring vital-signs orb, live CPU/memory sparklines, fixes ranked by impact with one-click actions. |
| **Clean** | Read-only, time-boxed scan with safety-graded categories (**Safe** = rebuilds itself / **Review** = your call). Each category explains *why* and *what happens after*. Covers caches, logs, Xcode data, package-manager caches, `node_modules` in idle projects, old installers, stale downloads, device backups, Trash, exact duplicates (content-hashed) and large files. |
| **Goal planner** | "Free 10 GB without touching downloads" → lowest-risk mix: Safe first, then duplicates, then Review, with your exclusions honored. If the goal can't be reached, it says so. |
| **Undo Vault** | Cleanups are *moves*, not deletes: one-click restore for 72 h, then automatic purge. "Free now" mode is available, opt-in, and clearly labelled. |
| **Proof receipts** | Every clean/restore/purge records free disk space measured before and after. |
| **Growth radar** | Folder-size snapshots on each scan show *what grew since last time* (Docker images, Xcode, Downloads…). |
| **Performance** | 24 h history, **your normal** (CPU by hour of day from local history), anomaly flags ("unusual for you" at z > 2.5), top apps with a polite Quit (system processes locked), read-only startup items, browser **throttle check** (same workload ×6, detects thermal throttling). |
| **Battery** | Health % from design vs full-charge capacity, cycles, **wear forecast** (trend once a week of data exists, cycle-based estimate before that), measured drain %/h, **Drain Detective** (CPU time by app on battery) and **idle drainers** (busy while you were away), plus charge coaching. |
| **Chat** | Deterministic intent engine (works offline) that reads your live data and answers with actions you can run. Unrecognized questions go to a **local** Ollama model if one is installed — never to the cloud. |
| **Devices** | "Connect my phone" shows a QR code; scan it and the phone pairs automatically (single-use codes, switch off anytime). |
| **Guides** | Checklists for iPhone, Android, Mac and Windows using the built-in tools that actually work, with exact settings paths. Progress is saved locally. |

## Why it's different

The main complaints about cleaner/optimizer apps: subscription nags, scare-score
upsells, deleting things people needed, "RAM boosters" that make things slower,
background bloat, and data collection. Vitals is designed against each one.
[`docs/COMPETITIVE.md`](docs/COMPETITIVE.md) covers the comparison and which parts
are hard to copy.

- **Reversible by default.** Undo Vault + receipts, so trust doesn't depend on a score.
- **Explains instead of scaring.** Every point of the score and every category has a measured reason.
- **Learns *your* normal.** Local history makes advice personal, and that history can't be copied.
- **Honest about platforms.** iOS and Android don't let any app clean other apps' data, so Vitals gives exact built-in steps rather than pretending.
- **No account, no telemetry, open source.** The agent listens on `127.0.0.1` only unless you pass `--lan`.

## Download

Ready-made apps, built and tested on every change by
[`.github/workflows/vitals-apps.yml`](../../.github/workflows/vitals-apps.yml) and published to the
[`vitals` release](https://github.com/juw12/projects/releases/tag/vitals). Python is bundled, so there
is nothing else to install.

| Device | Download | Notes |
| --- | --- | --- |
| Windows 10/11 | [Vitals-Windows-Setup.exe](https://github.com/juw12/projects/releases/download/vitals/Vitals-Windows-Setup.exe) | Per-user installer, no admin: Start menu, optional desktop icon, starts at sign-in, remove it in Settings → Apps. Or the [portable zip](https://github.com/juw12/projects/releases/download/vitals/Vitals-Windows-Portable.zip). |
| Mac with Apple chip | [Vitals-macOS-AppleSilicon.dmg](https://github.com/juw12/projects/releases/download/vitals/Vitals-macOS-AppleSilicon.dmg) | Drag Vitals to Applications. It starts at login after the first open. |
| Mac with Intel chip | [Vitals-macOS-Intel.dmg](https://github.com/juw12/projects/releases/download/vitals/Vitals-macOS-Intel.dmg) | Same as above. |
| Ubuntu, Debian, Mint | [Vitals-Linux-x64.deb](https://github.com/juw12/projects/releases/download/vitals/Vitals-Linux-x64.deb) | Open it in your software app, or `sudo apt install ./Vitals-Linux-x64.deb` (also brings the GTK/WebKit libraries its window uses). |
| Other Linux | [Vitals-Linux-x64.tar.gz](https://github.com/juw12/projects/releases/download/vitals/Vitals-Linux-x64.tar.gz) | Extract it and run `Vitals/vitals` (glibc 2.35+: Ubuntu 22.04, Debian 12, Fedora 36 or newer). |
| Android | [Vitals-Android.apk](https://github.com/juw12/projects/releases/download/vitals/Vitals-Android.apk) | Open it on the phone and allow installing from your browser. |
| iPhone | Safari → https://juw12.github.io/projects/vitals/mobile.html → Share → **Add to Home Screen** | For sideloading: [Vitals-iPhone-unsigned.ipa](https://github.com/juw12/projects/releases/download/vitals/Vitals-iPhone-unsigned.ipa) with Sideloadly or AltStore (re-sign every 7 days). |

On a computer, Vitals opens in **its own window** (Edge WebView2 on Windows, WebKit on Mac and
Linux), not a browser tab, and keeps checking quietly in the background after you close it; run
`Vitals --browser` if you'd rather use your browser. The desktop apps aren't code-signed yet: Windows
SmartScreen asks you to choose **More info → Run anyway**, and macOS asks you to allow the app once
in **System Settings → Privacy & Security → Open Anyway**. They run the same agent and dashboard as the one-line installers below, share `~/.vitals`
with them and replace each other cleanly. Phones can't clean other apps' storage, so the phone app
shows your computer's health once paired, plus the phone guides. To build the apps yourself, see
[`desktop/README.md`](desktop/README.md) and [`mobile/README.md`](mobile/README.md).

## Install (one step)

**Mac / Linux:** copy, open Terminal, paste, press Return.

```bash
curl -fsSL https://juw12.github.io/projects/vitals/install.sh | sh
```

**Windows:** press <kbd>Win</kbd>+<kbd>R</kbd>, paste, press Enter.

```text
powershell -ExecutionPolicy Bypass -c "irm https://juw12.github.io/projects/vitals/install.ps1 | iex"
```

That's it. The installer puts Vitals in your user folder (no admin password), installs
Python on Windows via `winget` if it's missing (macOS offers Apple's free developer tools),
adds a **Vitals** app icon (Spotlight / Start menu / Desktop), starts Vitals quietly at
login, and opens the dashboard. If the web page is open while you install, it connects
by itself. Re-run the same line to update.

**Phone:** in Vitals open **Devices → Connect my phone** and point the phone's camera at
the QR code. It pairs automatically (same Wi-Fi). Codes are single-use and phone access
can be switched off at any time. No restart, no typing.

**Uninstall:** add `sh -s -- --uninstall` at the end (Mac/Linux), or put
`$env:VITALS_UNINSTALL=1;` in front of `irm` (Windows). History and the Undo Vault in
`~/.vitals` are kept unless you delete them.

### From a checkout (developers)

```bash
python apps/vitals/server/server.py --open        # dashboard at http://127.0.0.1:8765/
```

Options: `--home DIR` (what to scan), `--data DIR` (history + vault, default `~/.vitals`),
`--retention HOURS` (vault, default 72), `--interval SEC` (sampling, default 30),
`--scan-budget SEC` (default 60), `--lan` (listen on all interfaces). Launching it again
while it's running just opens the dashboard. Set `VITALS_MODEL` to choose an Ollama
model, or `VITALS_NO_MODEL=1` to disable the local AI fallback.

## Security model

- Binds to loopback unless `--lan`. Host-header check (DNS rebinding) and Origin allowlist (drive-by pages).
- Every API call except `health`/`pair` needs a session token. Only loopback callers get one automatically; phones need the one-time pairing code (5 wrong tries rotates it).
- Cleaning accepts **only target ids produced by a scan**, never raw paths. The vault also refuses anything outside your home folder, the home root, and standard folders like `~/Documents`, and it never follows symlinks.
- Process quit is limited to processes you own that aren't on the protected list, and it sends a normal SIGTERM/taskkill (never force).

## Tests

```bash
python apps/vitals/tests/verify_api.py     # hermetic agent e2e: auth, scan, vault, restore, purge, safety, auto-care scheduler (≈8 s)
python apps/vitals/tests/verify_brain.py   # 65 brain.js checks in headless Chrome (skips if no Chrome)
python apps/vitals/tests/verify_install.py # installer: manifest sync, sandboxed install → run → update → uninstall
python apps/vitals/tests/verify_desktop.py # desktop launcher: start → dashboard → reuse → stop, download links
python apps/vitals/desktop/smoke_test.py --built   # the same checks against a PyInstaller build
```

## Layout

```
apps/vitals/
  server/   server.py (HTTP + auth), metrics.py, storage.py, vault.py, history.py
  web/      index.html · app.html · mobile.html, app.js (UI), brain.js (score, planner, chat), qr.js, styles.css, sw.js
            install.sh · install.ps1 (one-step installers) + files.txt (what they download)
  desktop/  vitals_app.py (desktop app launcher), vitals.spec (PyInstaller), build.py, vitals.iss (Windows installer), smoke_test.py
  mobile/   Capacitor 8 Android + iPhone app around the bundled dashboard (scripts/, assets/)
  tests/    verify_api.py, verify_brain.py + brain_test.html, verify_install.py, verify_desktop.py
  docs/     COMPETITIVE.md
```

## Known limits

- The downloadable apps are built and started in CI on Windows, macOS (Apple silicon and Intel) and
  Linux, the APK runs on an Android emulator and the iPhone app in the simulator. They are not
  code-signed or notarized, and pairing from inside the iPhone app hasn't been tried on a device.
- Windows and Linux readers and the Windows installer are written against documented APIs, but so far only macOS has been exercised end to end. Windows battery wear needs WMI (`root\wmi`), which some OEMs don't populate.
- Automatic-care notifications use `osascript` (macOS), `notify-send` (Linux) or a PowerShell toast (Windows). The Windows path hasn't been tested yet. Set `VITALS_NO_NOTIFY=1` to turn them off.
- The browser can't read disk, processes or (in Safari) battery. Browser mode is intentionally partial.
- Vitals reads startup items but doesn't disable them. It opens the system settings page instead.
- Vault moves are instant on the same volume. Space is released when a batch expires or you purge it.
