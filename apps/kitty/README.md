# 🐱 Kitty — shared budgeting that gets you

**Live:** https://juw12.github.io/projects/kitty/ · [demo household](https://juw12.github.io/projects/kitty/demo.html) · [self-test](https://juw12.github.io/projects/kitty/tests.html)
· **[Get it for iPhone & Android (free)](https://juw12.github.io/projects/kitty/get.html)**

A *kitty* is a shared pot of money. Kitty is a budgeting app that you can share like a Google Sheet,
but with an interface built only for money. It plans your budget from your income, works out your
money personality, warns you before a limit breaks, and tracks your investments. There is no account
and no backend you have to trust: data lives in your browser, and shared budgets sync end-to-end
encrypted.

## Features

| Area | What it does |
| --- | --- |
| **30-second setup** | Three questions (name, take-home pay, who it is for) and Kitty builds a ready-to-use budget. Currency is guessed from your language and device. A *Getting started* checklist on Home walks through the first expense, the plan, inviting people and the optional quiz, then disappears. |
| **Onboarding quiz** | 14 quick questions on needs, wants and behaviour → 5 traits (spender↔saver, spontaneous↔planner, cautious↔bold, independent↔generous, calm↔avoidant) → one of 6 personas: 🐿️ Squirrel, 🦉 Owl, 🦋 Butterfly, 🦁 Lion, 🐬 Dolphin, 🐢 Turtle. |
| **Plan from income** | Converts take-home pay into needs / wants / savings / investing envelopes tuned to the persona, then adjusts for emergency fund, debt and actual rent (it never budgets housing below what you pay). One click turns the plan into envelopes and goals. |
| **Overview** | "Left to spend" ring, safe daily spend, spending pace vs. budget, category donut, budget bars, warnings, who-spent-what, live activity and goals. Tap Income, Spent, Saved or Safe to open the page behind the number. |
| **Fast entry** | Type the amount and what it was; Kitty picks the category from your own history first, then common words in English, Indonesian, Chinese and Spanish ("coffee", "Grab", "listrik", "午饭", "almuerzo"). Recent descriptions autocomplete. |
| **Sheet** | Spreadsheet-style grid: edit any cell inline, Enter moves down, sort, filter, search as you type, add rows, CSV import and export. Remote edits flash in place. |
| **Budget** | Income sources (monthly/weekly/yearly), left-to-assign, "Kitty's plan vs actual" with *Apply plan*, and editable envelopes by group. |
| **Warnings** | Alert at a configurable threshold (default 80%), when a limit is over, and when the current pace will overspend before month end. Shown as toasts, in the bell and (optionally) as browser notifications, including for edits made by other people. Quick-add shows "this brings Groceries to 86%" before you save. |
| **Tips** | Persona-aware tips: one per day, sometimes after adding a transaction, and on demand. |
| **Goals** | Savings goals with progress rings and the monthly amount needed to reach the target date. |
| **Invest** | Holdings (units × price), allocation vs. a target (presets or custom), drift and the trades needed to rebalance, and a compound-growth projection with sliders. Prices are entered manually. |
| **Look & feel** | Light, Dark or System theme in one tap from the top bar (the new theme grows out of the button), with live previews in **Settings → Appearance**. Motion is calm: rings, bars and figures animate when a page or month opens, never on every edit, and *reduce motion* turns it off. |
| **Phone layout** | One tidy header row and a tab bar with a big **+** in the middle. **More** holds theme, language, Goals, Invest, You, Share and Settings. Dialogs open as bottom sheets you can drag down to close; toasts can be swiped away and never cover an open sheet. |
| **Keyboard** | `N` add · `T` theme · `1`–`8` pages · `/` search the sheet · `?` lists every shortcut. |
| **Languages** | English, Bahasa Indonesia, 简体中文 and Español. Picks your device language on first launch; switch any time from the welcome screen, the phone **More** sheet or **Settings → Preferences**. Dates and month names follow the language. |
| **Share your result** | One tap turns your money animal into a 1080×1350 card in your language (native share sheet on phones, PNG download on desktop) with a link back to the quiz. |
| **Share** | One link invites people to edit live. Shows presence ("2 online"), people and an activity feed. Works offline: edits queue and sync on reconnect. |

## Platforms (all free)

| Platform | How to get it | What you get |
| --- | --- | --- |
| **Web** (any computer or phone) | Open https://juw12.github.io/projects/kitty/ | The full app. Install it from Chrome/Edge's install button for a desktop window. |
| **iPhone / iPad** | Safari → [get.html](https://juw12.github.io/projects/kitty/get.html) → Share → **Add to Home Screen** | Full-screen home-screen app with its own icon, offline shell and app shortcuts. Recommended. |
| iPhone (advanced) | [`Kitty-ios-UNSIGNED.ipa`](https://github.com/juw12/projects/releases/download/kitty-mobile/Kitty-ios-UNSIGNED.ipa) | Native Capacitor build for sideloading with AltStore/Sideloadly and your own Apple ID (free IDs re-sign every 7 days). |
| **Android** | [`Kitty-android.apk`](https://github.com/juw12/projects/releases/download/kitty-mobile/Kitty-android.apk) | Signed native app: haptics on adds and limit warnings, the native share sheet for invites, the Back button (closes sheets → goes home → minimises) and `juw12.github.io/projects/kitty` invite links. |

The native apps live in `mobile/`: a [Capacitor](https://capacitorjs.com) shell that loads the live HTTPS site, so they
update with the web app and keep a secure context (`crypto.subtle`) for end-to-end encrypted sharing. Without a
connection on first launch they show `shell/offline.html` and reconnect automatically. A GitHub Actions
workflow (`mobile/ci/kitty-mobile.yml`, active once copied to `.github/workflows/`) builds the signed APK, runs it on an Android emulator
(`mobile/scripts/android-e2e.py`), builds the unsigned IPA plus an iPhone-simulator smoke test, and publishes both to the
[`kitty-mobile` release](https://github.com/juw12/projects/releases/tag/kitty-mobile). See `mobile/README.md`.

App Store and Play Store listings are not included: they need paid developer accounts (Apple $99/year, Google $25 once).

## Languages

All UI text lives in one table, `apps/kitty/i18n/strings.txt` (`English || Indonesian || Chinese || Spanish`, ~790 rows).
`python3 apps/kitty/i18n/build_i18n.py` validates it (column count, matching `{placeholders}`, duplicates) and writes
`web/js/lang/{id,zh,es}.js`. At runtime `web/js/i18n.js` picks the language (`?lang=` → saved choice → browser),
translates rendered text and attributes in place, and leaves user data (budget names, notes, amounts) untouched.
To add a language, add a column, append its code to `LANGS` in both files and rebuild.

## How sharing works

- **Local-first.** Every budget ("book") is a set of collections (`txns`, `categories`, `incomes`, `goals`, `holdings`, `members`, `meta`) stored in `localStorage`.
- **Cell-level merge.** Each record keeps a per-field Lamport/wall clock (`_f`), and deletions are tombstones. Two people editing different cells of the same row both keep their edits; the same cell resolves last-writer-wins. Merges are commutative and idempotent, so the order messages arrive in does not matter.
- **End-to-end encrypted.** Sharing creates a random 256-bit AES-GCM key. The invite link is `index.html#join=<bookId>.<key>&n=<name>`. The key lives in the URL **fragment**, which browsers never send to any server. Every op is encrypted in the browser before it is published.
- **Transport.** Encrypted ops go to a pub/sub topic derived from the book id, on the free public [ntfy.sh](https://ntfy.sh) relay by default, or on your own relay (below). New joiners receive a compressed, chunked snapshot. Tabs on the same device sync through `BroadcastChannel`.
- **Threat model.** The relay sees only ciphertext, topic names, timing and sizes. Anyone who has the link can read and edit, so treat it like a password. *Stop syncing* removes the key from this device; to revoke someone, create a new share.

### Relay limits

The public ntfy.sh relay is free but best-effort. It caches messages for about 12 hours and rate-limits anonymous clients (roughly a few hundred messages a day per IP; see ntfy's docs for the current numbers). Collaborators who are offline longer than the cache window catch up from the next snapshot one of them publishes. For always-on sync, self-host the relay:

```bash
python apps/kitty/server/relay.py --port 8787 --data ./relay-data
# then: Kitty → Share → Relay server → https://your-host:8787 (put it behind HTTPS)
```

`server/relay.py` is a single stdlib-only file that implements the subset of the ntfy API Kitty uses (`POST /<topic>`, `GET /<topic>/sse?since=…`, `GET /<topic>/json?poll=1`, `GET /health`). It persists messages to JSONL, has CORS, a 64 KB message limit and per-IP rate limiting, and never logs message bodies.

## Run locally

```bash
cd apps/kitty/web
python3 -m http.server 8000
# open http://localhost:8000/  (or /demo.html for a sample household)
```

No build step and no dependencies: plain HTML, CSS and classic scripts.

| File | Role |
| --- | --- |
| `web/js/core.js` | Data model, merge/CRDT, money parsing (`25k`, `1,5jt`, `Rp 25.000`), budget maths, alerts, tips, quiz scoring, planner, portfolio maths, demo data |
| `web/js/sync.js` | AES-GCM crypto, snapshot chunking, relay transport (SSE + POST), outbox, presence |
| `web/js/quiz.js` | Onboarding quiz UI |
| `web/js/ui-kit.js` | Icons, rings, charts, toasts |
| `web/js/app.js` | Views, routing, editing, alerts wiring |
| `web/sw.js` | Network-first service worker (offline shell, registered on HTTPS only) |

## Tests

```bash
python apps/kitty/tests/test_relay.py       # relay: publish/poll/SSE, 400/413, persistence
python apps/kitty/tests/test_web_static.py  # files, refs, manifest, no root-absolute paths, dark theme tokens, theme switch
python apps/kitty/tests/test_mobile_static.py  # Capacitor config, icon sizes, release assets, versions
python apps/kitty/tests/test_i18n.py          # translation table valid, language packs up to date, load order
```

In the browser, open `tests.html` for 99 core tests (merge, crypto, parsing, budgets, alerts, planner, portfolio). Add `?relay=https://ntfy.sh` or your relay URL for a live two-client sync test, which brings the total to 104.

## Caveats

Kitty is a free, working app, but it is not a bank: it never connects to your accounts. Translations were written with AI assistance and have not yet had a native-speaker review. Tips and plans are general guidance, not financial advice. Investment prices are manual. Data is only as durable as your browser storage plus whoever you share with, so use **Settings → Backup** for a JSON export.
