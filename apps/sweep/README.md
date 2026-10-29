# apps/sweep

The **`/sweep`** pipeline — one command, two modes. (Renamed from the old `/update`.)

- **Mode A — `/sweep <app idea>`**: the full **idea → shipped app** pipeline
  (recall memory → brief + Go/No-Go gate → capability matrix → scaffold →
  analyse → build with checkpoints → verify for real → sync GitHub + Obsidian,
  rollback-safe).
- **Mode B — `/sweep` (no idea)**: just **sync** — validate → commit → push →
  Obsidian note; reports **"nothing to sweep"** when the tree is clean and in sync.

Command: [`../../.opencode/command/sweep.md`](../../.opencode/command/sweep.md).
Product plan (PRD + architecture + MVP): [`docs/Sweep-App-Plan.md`](docs/Sweep-App-Plan.md).

## The app (`web/`)

A **static, offline-first** single-page app that walks the pipeline: **local
workspace (login)** → **idea brief** → **generated plan** (capability matrix +
Definition of Done + phases) → **verify** (runnable gates) → **scaffold
generator** → **catalog**, plus an in-app **How-to-use** guide — and an
**Operator** ("Otto"): a local, deterministic agent that drafts your brand kit
(logo, palette, type), a one-page site, per-network social posts (with generated
art), email drafts, customer outreach, a market-research brief, a pitch deck and
a live ledger — all routed through an **approval queue** with a visible **run
log**, a **credits** meter and an **autopilot** toggle. Morning Paper theme,
light/dark. Every Operator artifact is produced **offline — no network, no LLM**
(same "no AI, no network" rule as guided intake), and the workspace stays
encrypted at rest.

- Open it: `apps/sweep/web/index.html` (works from `file://` — no server).
- Live: https://juw12.github.io/projects/sweep/
- Spec: [`docs/BRIEF.md`](docs/BRIEF.md) · PRD: [`docs/Sweep-App-Plan.md`](docs/Sweep-App-Plan.md)
- Zero deps, no network: all state lives in `localStorage`; the workspace gate
  encrypts local data with WebCrypto (PBKDF2 → AES-GCM) when available, otherwise
  it falls back to a clearly labeled unencrypted local profile.

### What's new in v21 — Sweep apps for every device

- **Windows, Mac, Android and iPhone apps** that update themselves. They are thin native shells
  around this site (`desktop/` — pywebview; `mobile/` — Capacitor 8), so every push to `web/`
  reaches them on the next launch. When a shell itself changes, `web/shell.json` carries the new
  version and installed apps show *"Sweep 1.x is available → Update"*. The *Sweep apps* workflow
  (`.github/workflows/sweep-apps.yml`) builds, installs and smoke-tests each platform (Windows
  installer install/run/uninstall, macOS app + dmg checks, Android emulator, iOS simulator) and
  publishes to the `sweep` release with stable links.
- **Native bridge** (`web/native.js`): exports open a real Save dialog on desktop and the share
  sheet on phones (WebViews drop `<a download>`); Android Back closes sheets then returns to the
  catalog; light haptics; external links open in the system browser; offline indicator;
  *What's new* sheet once per release; launch shortcuts (`?action=brief|operator|catalog`, also in
  the PWA manifest); *Settings → Apps & updates*; palette commands.
- **Refreshed look** (`web/refresh.css`): new app icon (ring + check), sentence-case wordmark,
  translucent header, quieter borders, icon-only Sign out and sticky app bar on phones, safe-area
  padding for notched phones and the app shells.
- **Get Sweep page** (`web/app.html`): detects the visitor's device, one-tap download, QR code for
  phones, iPhone *Add to Home Screen* steps, install-from-browser button.
- PNG icons (192/512/maskable/apple-touch) for installs; `mobile/scripts/make-icons.py` regenerates
  every icon and splash from one geometry. Service worker never caches `shell.json`.

## What's new in v20

- **Project flow bar** — every project page (Plan, Studio, Verify, Generate) starts with one
  stepper showing where you are and the live status of each step (plan %, Spec grade,
  gates passed, files). It replaces the plan header's Studio / Verify / Generate buttons,
  which overflowed off the left edge on phones.
- **Phones (`mobile.html`)** — Verify and Generate work (they crashed to a blank screen: the
  page lacked their markup); a bottom tab bar with icons and a contextual **Plan** tab; the bar
  now appears for returning sessions (it was hidden after a reload, leaving no navigation) and
  disappears on sign-out; pinch-zoom is allowed again; all six Operator tabs fit on screen.
- **Back button** — Android back / swipe-back moves between sections (and closes an open dialog
  first) instead of leaving the app.
- **Download project (.zip)** in Generate — every generated file in a `<project-name>/` folder
  plus `docs/MEMORY.md`, ready to unzip; `verify.sh` keeps its executable bit. The JSON bundle
  is still there.
- **Generated scaffolds actually pass their own gates** — names with `'`, `"`, `&`, `<`, `$`
  no longer break `web/app.js` (syntax error) or show up as `&amp;` in Markdown; the memory
  note's YAML front matter is quoted; `server/server.py` serves all of `web/` (CSS/JS were 404)
  from any working directory, blocks path traversal and honours `PORT`; `tests/test_smoke.py`
  now checks files and references and boots the server (`/`, `/health`, assets) instead of
  only importing `http.server`.
- **Data safety** — the unencrypted fallback profile (browsers without WebCrypto, e.g. plain
  http on a LAN address) lost every project on unlock: it now saves where unlock reads, and
  older data is recovered. Encrypted saves run one at a time (a slow save can no longer overwrite
  a newer one), stop storing a second copy of the ciphertext in the workspace record, never fall
  back to plain text while signed out, and report a full browser storage instead of failing
  silently. Unlocking after a guest detour works ("Workspace not found" before), and sign-out
  hides every section (Studio stayed visible under the gate).
- **Copy buttons** fall back to a hidden textarea when the Clipboard API is missing or refused,
  and say so if copying fails.
- `tests/test_static_integrity.py` now also checks the `index.html` ↔ `mobile.html` id contract,
  unique ids, one `?v=` per release matching the `sw.js` cache name, the pre-cache list, zoom,
  and that the core UI files make no network calls.

### Studio (`web/studio.js` + `web/studio.css` + `web/badge.svg`)

Turns a plan into a builder-ready spec — offline, no AI call, no sign-up. Opens
from the plan's Studio strip, the **Studio** nav tab, or the command palette.

- **Spec Score** — 0–100 (Clarity, Testability, Scope, User focus; grade A–D)
  with one-click "Fix" that jumps to the weak field in the brief.
- **Kiro / Spec Kit-compatible specs** — `specs/requirements.md` (EARS
  "WHEN … THEN THE SYSTEM SHALL"), `specs/design.md` (architecture diagram,
  capability decisions, data model), `specs/tasks.md` (dependencies, `[P]`
  parallel markers, complexity, rough hours), plus `AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/sweep.mdc` and `PROMPT.md`. Download all as one zip, or get them
  in Generate.
- **Task board** — To do / Doing / Done kanban (drag or arrows), persisted per
  project; blocked tasks and the next unblocked task are highlighted.
- **Handoff** — Build in Lovable / Open in v0 (prefilled URLs), copy-and-open
  Bolt, Cursor / Claude Code / AGENTS files; editable builder prompt.
- **Share** — remix link (`#share=…`, brief compressed into the URL; never
  progress or Operator data), 1200×630 share-card PNG, "Planned with Sweep"
  README badge. Opening a link shows a preview with "Remix into my workspace".
- **Templates** — six high-scoring starter briefs in the catalog, one-click remix.
  Cards and remixed briefs follow the interface language (English, 中文, Indonesia).
- **Spec language** — EN / 中文 / ID switch on the Spec tab. English stays the
  canonical spec; "Translate this file / all files" uses AI assist and keeps headings,
  ids, code, paths and the EARS keywords (WHEN … THEN THE SYSTEM SHALL) intact.
  Translations are cached per file with a hash of the English source, flagged as
  outdated when the brief changes, and ride along in the spec pack under `i18n/<lang>/`.
  **Quality checks:** every answer is validated (headings, code blocks, ids such as
  R1/T3, EARS keywords and checkboxes kept; prose really in the target language; not
  cut off). A failing answer is retried once on a different free service with the
  problems listed; if it still fails, the file shows "⚠ Check this translation" with
  the issues on hover. A per-project **Glossary** ("streak = 连续打卡天数") is sent with
  every request (on top of built-in defaults), and **Edit translation** lets you fix
  wording by hand ("Edited by you").
  **Meaning check:** when the structure checks pass, the translation is translated back into
  English and compared with the original by shared content words, overall and per section.
  Calibrated on real free-AI round trips (faithful 0.56–0.67, unrelated text ≤ 0.25; threshold
  0.42): the file shows "✓ Meaning check passed" or names the sections that may say
  something different.
- **Time tracking** — moving a task to Doing starts a timer (pause/resume on the
  card, 6 h cap per session, "Log time" for manual hours). Done cards show actual
  hours, a Time tracking table compares estimate vs actual, and after ≥2 tracked
  tasks (or ≥3 across projects) the Build estimate shows your calibrated pace.
  `tasks.md` includes actual hours.

Remove the two tags from `index.html` / `mobile.html` to disable; the core app
does not depend on it.

### Languages, AI assist, sync (`web/i18n.js` + `web/pro.js` + `web/pro.css`)

All optional and opened from the gear icon in the header (**Settings**).

- **Language** — English, 简体中文, Bahasa Indonesia. Auto-detected from the
  browser, saved in `localStorage` (`sweep_lang_v1`). `i18n.js` translates the
  interface only (text, placeholders, aria-labels); briefs, plans and specs stay
  in the language they were written in. Covers every view (Operator, guide, verify,
  palette, dialogs); paragraphs with inline markup are translated whole, and dates
  follow the chosen language. "Suggest a better wording" (Settings → Language) opens a
  prefilled GitHub issue so native speakers can fix awkward phrasing. Exposes
  `window.SweepI18n`.
- **AI assist** — "✨ Sharpen with AI" on the Spec Score card (per-field diff to
  review before applying) and "✨ Improve with AI" on spec files (marked
  AI-edited, revertible). Providers: free (no key), OpenRouter, OpenAI, Anthropic,
  Groq, or any OpenAI-compatible endpoint with your own key. The free tier falls back
  across keyless services (Pollinations → LLM7) when one is busy, rate-limited (402/429)
  or stalls (60 s per service), skips a rate-limited service for 30 s, queues free
  requests one at a time and caches identical answers for 24 h. The keyless Pollinations model is a
  reasoning model with a ~1500-token reply cap, so Sweep asks it for low reasoning effort, and any
  reply a provider cuts off at its length cap is continued automatically (up to 3 follow-ups, with
  repeated overlap removed) so long spec files come back whole. Keys stay in this browser (session-only unless
  "remember" is ticked); requests go straight from the browser to the provider.
  A running request can be cancelled from the same button.
- **Sync** — end-to-end encrypted (PBKDF2-SHA256 → AES-GCM, passphrase never
  leaves the device) to a private GitHub Gist (`sweep-sync.json`) using a
  fine-grained token with Gists read/write (the "create" link pre-fills a Gists-only
  token; "Generate" makes a strong passphrase). **Three-way merge:** each device keeps
  the last synced workspace as the common ancestor, so edits to different fields, list
  items or board tasks on two devices are all kept; only a field changed differently on
  both sides is a clash — the newer edit wins and a "Review" banner lets you pick the
  other version field by field. Without an ancestor (first sync after updating) both
  versions are kept as "… (conflict copy)". Deletions sync as tombstones. Auto-syncs
  after edits and on focus.
- **Link another device** — shows a QR code + link and a one-time 10-character code.
  The token, passphrase and gist id inside the link are encrypted with that code
  (PBKDF2 + AES-GCM) and expire after 15 minutes; open the link (or scan on a phone),
  type the code, and sync is on. `web/qr.js` is a small dependency-free QR encoder.
  The encrypted secret is parked on the backup relay (below), so the link is only ~62
  characters (QR version 4, big modules); if the relay is unreachable Sweep falls back to a
  self-contained link (~313 characters). "Show bigger QR" enlarges any code.
- **No GitHub account?** Three options with the same encryption and three-way merge:
  - **Direct sync** — "Sync with another device now" shows a QR + link; open it on the
    other device and both end up with the merged workspace (clashes go to Review).
    Two independent paths race: WebRTC (vendored PeerJS 1.5.4, MIT, in `web/vendor/`,
    loaded only when used; PeerJS's STUN/TURN servers included) and the **backup relay**.
    If WebRTC is blocked or the PeerJS broker is down, the guest switches to the relay
    automatically ("Trying the backup relay…"); a host that cannot reach the broker waits
    on the relay alone. Both devices must be online; the offer expires after 10 minutes.
  - **Send — pick up later** — encrypts the workspace, uploads it to the relay and shows a
    QR + link (~84 characters). The other device can open it any time within 3 hours, even
    if this device is off by then; it merges and leaves its own merged result on the relay,
    which this device picks up the next time Sweep opens (so both end up with everything).
  - **Sync file** — "Download sync file" saves an encrypted `sweep-sync-YYYY-MM-DD.sweep`
    (passphrase ≥ 6 characters); open it on the other device with the same passphrase to
    merge. Move it by AirDrop, USB, email or any cloud drive.
  - **Paste a link** — any Sweep sync link received in a chat or email can be pasted on the
    Sync tab instead of scanning.
- **Backup relay** — [ntfy.sh](https://ntfy.sh) (free, open source, open CORS) used as an
  encrypted mailbox. Only ciphertext is stored (AES-GCM with a key from the one-time code
  in the link fragment, which the relay never sees; payloads are gzip-compressed first);
  files expire after 3 hours. Direct-sync topics are derived from a SHA-256 of the host key.
  Set `window.SWEEP_RELAY_URL` to point at a self-hosted ntfy server.
- **QR robustness (tested)** — simulated phone photos (tilt, rotation, distance, blur,
  screen moiré, glare, noise, JPEG) of the pairing QR at 1×/2×/3× screens, decoded with
  Apple Vision (via Chrome's BarcodeDetector on macOS), jsQR and ZXing: "normal" photos
  decode 10/10 with Vision and 7–10/10 with jsQR/ZXing; Vision still reads 6–10/10 of the
  "hard" set. `qr.js` prefers the checkerboard mask (any mask is valid): ZXing-based scanners
  missed 10–20% of codes with other masks even on perfect images. Matrices stay bit-identical to
  the Python `qrcode` library for the same mask. Not yet confirmed on a physical phone camera.
- **Offline + updates** — the main app registers `web/sw.js` (same-origin files only;
  GitHub/AI calls always hit the network) and shows "A new version is ready — Reload"
  when a deploy lands while the app is open. Dialogs keep keyboard focus inside.

Remove the `i18n.js` / `qr.js` / `pro.js` / `pro.css` tags to disable; Studio and the core
app fall back to English and offline-only behaviour.

### Earning from Sweep (`web/plus.js`)

Everything Sweep already did stays free. **Sweep Plus** adds new tools on top, and the ★
button in the header opens the Plus panel:

- **Export tasks** to Jira (CSV import columns, estimates in seconds), Linear (CSV), GitHub
  Issues (a `gh` script that creates labels and one issue per open task) or plain CSV.
- **Client time report**: tracked hours per task as CSV or Markdown, with an optional hourly
  rate and currency (for example IDR), and a total. Ready for an invoice.
- **Share card in your colours**: hides the Sweep logo and "Planned with Sweep" and uses
  your own accent colour.

**How payment works (no server):** sell "Sweep Plus" on [Lemon Squeezy](https://lemonsqueezy.com)
with license keys turned on. Buyers paste their key into the Plus panel; Sweep checks it with
Lemon Squeezy's public License API (`/v1/licenses/activate`, `/validate`, `/deactivate`,
open CORS) and re-checks every 3 days. If the device is offline, Plus keeps working for
up to 14 days after the last successful check. Keys can be limited to your store/product
IDs, and "Remove from this device" frees an activation. This is an honour system that
makes paying easy, not DRM (the app runs entirely in the browser).

**Until you fill in a checkout link, Plus is "free during the beta"**: there is no paywall and
the tools work for everyone.

Setup (about 15 minutes):

1. Create a Lemon Squeezy store and add a product "Sweep Plus" with variants, for example
   Monthly $3, Yearly $24 and Lifetime $49 (any prices you like). Turn on **Generate license
   keys** (activation limit 3 is a good default).
2. In `web/plus.js` → `DEFAULT_CONFIG`, paste each variant's checkout link into
   `checkout.monthly / yearly / lifetime`, adjust `prices`, and set `storeId` /
   `productIds` (shown in the Lemon Squeezy dashboard) so only your keys are accepted.
3. Optional tips: put your `trakteer.id/…` and `saweria.co/…` pages (Indonesia: GoPay, OVO,
   DANA, QRIS, bank; 5% fee) and/or Ko-fi / GitHub Sponsors (worldwide) in `tips`.
   Optionally add `teamEmail` for team enquiries.
4. Bump the `?v=` query in `index.html` / `mobile.html` and the `sw.js` cache name, then
   push.

Lemon Squeezy is the merchant of record: it handles cards, PayPal, VAT/sales tax and
payouts (bank or PayPal). Check that your country and payout method are supported when
you sign up.

### Visual theme (`web/theme.css`)

"Editorial" skin loaded last, on top of `styles.css` and `enhance.css`: system-sans UI with serif headlines, softer radii and shadows, glassy sticky masthead with pill navigation, gradient primary buttons, custom animated checkboxes, numbered verify gates with a terminal-style command block, a landing hero on the workspace gate, a tuned Night palette, and a compact one-row phone header. Delete the `<link>` to revert to the original look — no markup depends on it.

### Interaction layer (`web/enhance.js` + `web/enhance.css`)

Loaded after `app.js` on `index.html` and `mobile.html`; it wraps the app's
global render functions instead of rewriting them.

- **Plan progress** — ring + Build / Verify / Grow / Earn bars (sticky), "Next up"
  jump, clickable M0–M3 phase stepper; Definition-of-Done, Grow, Earn ticks and
  Verify gates now persist with the project.
- **Edit brief** in place (keeps ticks across reordered success checks);
  "Copy to my projects" for the demo.
- **Catalog** — stats, search, status filters, sort, JSON import, per-card
  progress and edit / duplicate / export / delete (with Undo).
- **Brief** — example ideas, readiness meter, autosaved draft (localStorage for
  guests, sessionStorage for encrypted workspaces), smarter name/user drafting.
- **Command palette** (Ctrl/⌘ K) and shortcuts (`/`, `N`, `G`+letter, `E`, `T`, `?`).
- **Generate** — auto-opens a file, line numbers, file-type badges, arrow-key nav;
  **Download project (.zip)** (Studio) puts every file in a folder, ready to run.
- **Flow bar, phone tab bar, back button** (v20) — see *What's new in v20* above.

## Mode B — sync (what the script does)

1. **Validates first** (never push a failing state): `scripts/build_site.py`,
   `scripts/check_site.py`, and `scripts/run_all_tests.py` (whichever exist) must
   exit `0`.
2. Stages everything (`git add -A`).
3. Commits with a message (yours, or a timestamped default).
4. Pushes to `origin` (`github.com/juw12/projects`).
5. Writes a note to the Obsidian vault (`Update Log/<date> <repo>.md`).
6. Prints a JSON report: repo, branch, commit, changed count, push status, note path.

## Mode A — idea → app (the pipeline)

Driven by the command file, not the script:

1. **Recall memory** — read the Obsidian project notes + latest `Update Log` + the
   repo `docs/`/`README` so nothing is duplicated.
2. **Brief + Go/No-Go gate** — write `docs/BRIEF.md` (problem, user, job-to-be-done,
   non-goals, 2–4 concrete success checks, overlap vs existing `apps/*`) and ask up
   to 2 sharp questions if anything is ambiguous.
3. **Capability matrix** — derive scope per idea instead of defaulting every feature
   on. **Auth defaults OFF** (only ships with a scrypt/session threat model), and
   `server/` presence drives the deploy target (static → Pages; server → a host).
4. **Scaffold + build with checkpoints** — create `apps/<kebab-name>/` in the
   monorepo shape, analyse (`/rea` only when the idea references an existing
   artifact), and commit a checkpoint after each major piece.
5. **Register** the app on the projects site (`scripts/build_site.py`).
6. **Verify for real** (the commit gate, not exit-0): server smoke (`/` + `/health`
   → 200), Playwright screenshots at desktop + mobile widths, an acceptance test of
   the primary flow, the repo checks, and a secret/endpoint scan. Any failure
   **stops the commit**.
7. **Sync rollback-safe** — `sweep.ps1` (commit + push + Obsidian note), a fixed
   memory schema (`id, app, type, status, date, tags, links`), and a `git revert`
   recipe if the push is bad.

## Use it in chat

```
/sweep                              # Mode B — sync only
/sweep fix: tidy the build_site validator   # Mode B — sync with your message
/sweep a habit tracker with streaks  # Mode A — build the whole app from the idea
```

In **Mode B**, whatever follows `/sweep` becomes the commit message (with no
argument the script uses `sweep: sync projects (<timestamp>)`). In **Mode A**,
whatever follows is treated as the app idea and runs the full pipeline.

## Use the script directly

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/sweep/sweep.ps1 -Message "your message"
```

Flags:

| Flag | Effect |
| --- | --- |
| `-Message "<msg>"` | Commit message (default: timestamped). |
| `-NoPush` | Commit locally, skip the push. |
| `-DryRun` | Preview only — no commit, no push, no note. |
| `-VaultPath <dir>` | Override the Obsidian vault (default: `~/Documents/Obsidian Vault` or `$env:HAZEL_OBSIDIAN_VAULT`). |
| `-NoteFolder <name>` | Folder inside the vault (default: `Update Log`). |

## Global install

`/sweep` is also installed **globally**, so it works from any git repo on this machine:

- Command: `~/.config/opencode/command/sweep.md`
- Script:  `~/.config/opencode/tools/sweep/sweep.ps1` (a mirror of this file)

The script always syncs the **current working directory's** repo. The project-scoped
command uses `apps/sweep/sweep.ps1`; the global command uses the mirrored copy —
keep the two in sync when you change one.

## Notes

- **git is not on PATH** on this machine — the script resolves it from
  `%LOCALAPPDATA%\Programs\Git\cmd\git.exe` (and other known locations).
- The push uses the repo's stored credential (`credential.helper = manager`).
  If credentials are missing the script fails loudly with the exact error
  rather than hanging (`GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=Never`).
- The Obsidian note is written as plain Markdown files, so it works with or
  without the Local REST API plugin running.
