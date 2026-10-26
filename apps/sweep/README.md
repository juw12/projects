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
  in the language they were written in. Exposes `window.SweepI18n`.
- **AI assist** — "✨ Sharpen with AI" on the Spec Score card (per-field diff to
  review before applying) and "✨ Improve with AI" on spec files (marked
  AI-edited, revertible). Providers: free (Pollinations, no key, shared and
  rate-limited), OpenRouter, OpenAI, Anthropic, Groq, or any OpenAI-compatible
  endpoint with your own key. Keys stay in this browser (session-only unless
  "remember" is ticked); requests go straight from the browser to the provider.
- **Sync** — end-to-end encrypted (PBKDF2-SHA256 → AES-GCM, passphrase never
  leaves the device) to a private GitHub Gist (`sweep-sync.json`) using a
  fine-grained token with Gists read/write. Merges per project, newest edit wins;
  deletions sync as tombstones. Auto-syncs after edits and on focus.

Remove the `i18n.js` / `pro.js` / `pro.css` tags to disable; Studio and the core
app fall back to English and offline-only behaviour.

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
- **Generate** — auto-opens a file, line numbers, file-type badges, arrow-key nav.

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
