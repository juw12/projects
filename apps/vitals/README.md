# apps/vitals

**Vitals: a device-health copilot for laptops and phones.** It cleans storage you
can take back, explains every number it shows, predicts battery wear, catches apps
that drain power while you're away, and has a chat that diagnoses problems from
plain words ("my laptop is slow", "free 10 GB without touching downloads").

- **Live (browser mode + demo):** https://juw12.github.io/projects/vitals/ · add `#demo` to explore every feature with simulated data
- **App / Web / Mobile:** `web/app.html` · `web/index.html` · `web/mobile.html`
- **Local agent (real scans, Undo Vault, live vitals):** `python apps/vitals/server/server.py --open`

Zero dependencies. The agent runs on the Python 3.8+ standard library (`psutil` is
used if it happens to be installed, but nothing needs it), and the front-end is a
static offline PWA. It works on macOS, Windows and Linux. On phones it runs as a
PWA with built-in guides, and it can pair with your laptop's agent.

## What it does

| Area | Features |
| --- | --- |
| **Overview** | Health score that starts at 100 and lists every penalty with its measured cause ("Storage almost full −30: 1.1 GB free"). Four-ring vital-signs orb, live CPU/memory sparklines, fixes ranked by impact with one-click actions. |
| **Clean** | Read-only, time-boxed scan with safety-graded categories (**Safe** = rebuilds itself / **Review** = your call). Each category explains *why* and *what happens after*. Covers caches, logs, Xcode data, package-manager caches, `node_modules` in idle projects, old installers, stale downloads, device backups, Trash, exact duplicates (content-hashed) and large files. |
| **Goal planner** | "Free 10 GB without touching downloads" → lowest-risk mix: Safe first, then duplicates, then Review, with your exclusions honored. If the goal can't be reached, it says so. |
| **Undo Vault** | Cleanups are *moves*, not deletes: one-click restore for 72 h, then automatic purge. "Free now" mode is available, opt-in, and clearly labelled. |
| **Proof receipts** | Every clean/restore/purge records free disk space measured before and after. |
| **Growth radar** | Folder-size snapshots on each scan show *what grew since last time* (Docker images, Xcode, Downloads…). |
| **Performance** | 24 h history, **your normal** (CPU by hour of day from local history), anomaly flags ("unusual for you" at z > 2.5), top apps with a polite Quit (system processes locked), read-only startup items, browser **throttle check** (same workload ×6, detects thermal throttling). |
| **Battery** | Health % from design vs full-charge capacity, cycles, **wear forecast** (trend once a week of data exists, cycle-based estimate before that), measured drain %/h, **Drain Detective** (CPU time by app on battery) and **idle drainers** (busy while you were away), plus charge coaching. |
| **Chat** | Deterministic intent engine (works offline) that reads your live data and answers with actions you can run. Unrecognized questions go to a **local** Ollama model if one is installed — never to the cloud. |
| **Devices** | Run `--lan` and pair a phone with a one-time 6-digit code to see and act on your laptop from the phone. |
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

## Run it

```bash
python apps/vitals/server/server.py --open        # dashboard at http://127.0.0.1:8765/
python apps/vitals/server/server.py --lan         # also pair a phone on the same Wi-Fi
```

Options: `--home DIR` (what to scan), `--data DIR` (history + vault, default `~/.vitals`),
`--retention HOURS` (vault, default 72), `--interval SEC` (sampling, default 30),
`--scan-budget SEC` (default 60). Set `VITALS_MODEL` to choose an Ollama model, or
`VITALS_NO_MODEL=1` to disable the local AI fallback.

The hosted page can also talk to a locally running agent (it tries
`http://127.0.0.1:8765`). Chrome/Edge/Firefox allow that. Safari may block it, so use
the agent's own URL there.

## Security model

- Binds to loopback unless `--lan`. Host-header check (DNS rebinding) and Origin allowlist (drive-by pages).
- Every API call except `health`/`pair` needs a session token. Only loopback callers get one automatically; phones need the one-time pairing code (5 wrong tries rotates it).
- Cleaning accepts **only target ids produced by a scan**, never raw paths. The vault also refuses anything outside your home folder, the home root, and standard folders like `~/Documents`, and it never follows symlinks.
- Process quit is limited to processes you own that aren't on the protected list, and it sends a normal SIGTERM/taskkill (never force).

## Tests

```bash
python apps/vitals/tests/verify_api.py     # hermetic agent e2e: auth, scan, vault, restore, purge, safety (≈7 s)
python apps/vitals/tests/verify_brain.py   # 50 brain.js checks in headless Chrome (skips if no Chrome)
```

## Layout

```
apps/vitals/
  server/   server.py (HTTP + auth), metrics.py, storage.py, vault.py, history.py
  web/      index.html · app.html · mobile.html, app.js (UI), brain.js (score, planner, chat), styles.css, sw.js
  tests/    verify_api.py, verify_brain.py + brain_test.html
  docs/     COMPETITIVE.md
```

## Known limits

- Windows and Linux readers are written against documented APIs, but so far they have only been exercised on macOS. Windows battery wear needs WMI (`root\wmi`), which some OEMs don't populate.
- The browser can't read disk, processes or (in Safari) battery. Browser mode is intentionally partial.
- Vitals reads startup items but doesn't disable them. It opens the system settings page instead.
- Vault moves are instant on the same volume. Space is released when a batch expires or you purge it.
