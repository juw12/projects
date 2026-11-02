# Projects

A monorepo for product projects, each promoted from prototype to a real,
runnable, deployable project.

| Project | What it is | Stack |
| --- | --- | --- |
| [`apps/orbis`](apps/orbis) | Communication, identity, protection — and hiring (Orbis Work) — in one app, plus **Orbis Chat**: real-time multi-user messaging with accounts, teams, email invites and push notifications on web, iPhone and Android | Zero-dependency Python stdlib server + SQLite + static PWA |
| [`apps/guangyao`](apps/guangyao) | 光耀同行 — unofficial learning/community concept with local course progression, activities, rewards and transparent-giving demonstrations | Responsive installable PWA; real backend integrations remain pending |
| [`apps/peers`](apps/peers) | Verified reviews across category **modes** (food, travel, market, AI tools, health, finance, …) — every category shares one interface | Single-file web app + optional stdlib persistence backend |
| [`apps/house-of-articles`](apps/house-of-articles) | Athlete-moment sneaker news + live market feed | Static prototype + versioned data spine |
| [`apps/hazel`](apps/hazel) | **Hazel** — one creator studio, three apps: **Hazel Shorts** (formerly Shortcraft: faceless 9:16 explainers, captions, generated music, MP4 export EN/ID, channel kit, YouTube upload + opt-in autoposter), **Hazel Sped** (formerly Sped/Hookline: sped-up/slowed/mashup edits, 9:16 editor, offline MP4 export) and **Hazel Long** (the original Hazel: long-form create, cut, repurpose, publish; Windows desktop auto-cut) | Static web apps (Canvas + Web Audio + MediaRecorder, offline PWA) + Electron/ffmpeg/Whisper desktop app + optional Python pipeline |
| [`apps/sweep`](apps/sweep) | The `/sweep` pipeline — validate, then sync the repo to GitHub and mirror a note to Obsidian | PowerShell helper + OpenCode slash command |
| [`apps/twin`](apps/twin) | Invest and day-trade with a twin that replays 10,000 futures — TwinAgent research team, personality test, paper trading, goal planner, copy a 13F, news | Zero-dependency Python stdlib server + installable PWA (offline web demo) |
| [`apps/sync`](apps/sync) | Sync: listen to music together in real time from anywhere, with Spotify, Apple Music, YouTube and shared files in one room, plus voice chat that lowers the music | Static PWA, peer-to-peer WebRTC (PeerJS), no server |
| [`apps/me-rd-toolkit`](apps/me-rd-toolkit) | **Datum Bench** — the free mechanical-R&D workbench (NPI flow, review checklists, issue log, engineering calculators, optional LAN file vault). Flagship app: **Datum CAD** — a PRD + 6 photos → a validated STEP solid | Static offline PWA + optional zero-dependency Python stdlib vault server |
| [`apps/plm-aml-approval`](apps/plm-aml-approval) | PLM AML final / conditional approval submission assistant — fills the Windchill approval workflow form and stops before Submit (v0.1 preliminary) | Python + Playwright driving Microsoft Edge; site settings in a local, git-ignored config |
| [`apps/vitals`](apps/vitals) | Vitals: device health copilot — desktop apps for Windows, Mac and Linux plus Android and iPhone apps that check the phone itself; safety-graded cleaning with a 72 h Undo Vault and measured receipts, goal planner, battery wear forecast, drain detective, personal baseline and a fix-it chat | Zero-dependency Python stdlib agent + offline PWA, PyInstaller desktop apps, Capacitor phone apps with a native phone-check plugin |
| [`apps/signals`](apps/signals) | **Signals** — free, $0-capital crypto signal bot. RSI(14) + MACD(12/26/9) + ATR(14) + 50-EMA confluence alerts to Telegram, paper-trades every signal against a CSV ledger, ships with backtester + cross-window robustness sweep + grid parameter tuner and an opt-in Binance executor with hard risk caps. Standalone repo: [`juw12/signals`](https://github.com/juw12/signals) | Python 3 stdlib + `requests`; one dep total |
| [`apps/vale`](apps/vale) | VALE — a 3D interactive fairy world (Unity 6 + HDRP); first-person explorer that collects five Lumenshards to restore a fading fairy realm, with dialogue, quests, and procedural forest | Unity 6 LTS + HDRP 17.2 + New Input System + Cinemachine 3 (C# / UGUI) |
| [`games/hearthwood`](games/hearthwood) | **Hearthwood** — a medieval low-poly village prototype: 3rd-person character controller, combat, inventory, dialogue, quests, collectibles, NPC AI, favor-token economy. Ships with a self-contained `preview.html` that demonstrates every system without the engine | Unity 6 LTS + URP 17.3 + New Input System + Cinemachine 3 + NavMesh + WebGL (C# / UGUI / TMP) |
| [`apps/pushlab`](apps/pushlab) | **Push Lab** *(WIP)* — send push notifications from your own server and prove they work on a real phone. Two built-in parts, started together and already linked: **Beacon**, the push server (Web Push, FCM, in-app, ntfy, Bark for iPhone, Gotify, Apprise; targeting, digests, escalation, Gatus uptime alerts, console, MCP, one-click Go live), and **Tether**, the device lab (Android phone in the browser with HD scrcpy screen, QA flows and Maestro YAML, AI steps incl. Google ARTEMIS, startup/jank/memory/CPU budgets, CI, MCP). Ships Claude Code / Codex agent skills | Zero-dependency Python stdlib + SQLite + adb; optional apprise, cloudflared, scrcpy-server |
| [`apps/crewcup`](apps/crewcup) | **CrewCup** — office coffee for teams in Indonesia and SEA: one-tap usual, group coffee runs with held payments, company allowance, badge-QR pickup at partner cafés, café order board, HR budgets and audit log, company rewards, loyalty (points, tiers, coupons, achievements) and the CrewCup Network. EN / ID | Zero-dependency Python stdlib server + SQLite + installable PWA |

## Archive

Past projects and experiments. Kept for reference, not actively developed.

| Project | What it is | Status |
| --- | --- | --- |
| `saltbridge` | **Saltbridge** � bilingual EN/?? freelance services for SaaS, e-commerce, and DTC brands. Translation, English product descriptions for Chinese sellers (Amazon/Etsy/Shopify), bilingual EN/?? email copy. Full launch package built: 3 Fiverr gigs, Upwork profile, 3 portfolio samples, cold-outreach system, day-by-day action plan, competitive analysis, 3 gig images, and a deployable portfolio site. $0 capital, 1�2 hr/day. Tagline: *Preserving value across languages.* | **NEW** |
| `saas-content-engine` | Freelance SaaS content writing toolkit — Fiverr/Upwork profiles, 3 portfolio samples, 50-company target list, 10 cold email templates, 4 ready-to-send personalized emails, lead tracker template, 30-day plan, daily action coach, building notes | **NEW** |
| [`respark`](respark) | **Respark** — customer reactivation SaaS for local service businesses (dentists, plumbers, salons, trainers, mechanics, realtors, restaurants). Operator-led sales motion: $497 setup + $97/mo recurring. Built-in cold-outreach pipeline (`/outreach`) imports a CSV, auto-sends a 3-step sequence, tracks opens via pixel, and creates client accounts + draft campaigns automatically when a deal closes. Clients sign up, upload their customer list, and the system sends a 5-message reactivation campaign over 30 days. Stripe handles checkout + subscriptions. Zero-dependency Python stdlib + SQLite. 43 tests passing. `start-with-tunnel.ps1` to launch on laptop; `render.yaml` for one-click Render deploy. | Ready to deploy — pending Stripe + SMTP keys (∜15 min human setup) |
| [`agency-starter`](https://github.com/juw12/loop-zero) | **Handoff** — AI automation agency + SaaS product for SMBs worldwide. Five Next.js apps (portfolio, saas landing with Lemon Squeezy checkout, AI review-responder, AI listing-writer, fake-door niche validator). Cold-outreach copy, 5 globally-scored niches, 14-day validation playbook. All code complete and pushed to [juw12/loop-zero](https://github.com/juw12/loop-zero). $29/mo Pro, $99/mo Team. | Launched — pending Vercel + Lemon Squeezy + LLM keys (∜15 min human setup) |


## Ownership and content

Maintained by [Juwen Lie (@juw12)](https://github.com/juw12).
Existing commit authorship is preserved.

Guang Yao's published lessons, materials and events are stored in
[`content/guangyao`](content/guangyao), inside this repository. The admin console
publishes to that folder; there is no separate content repository to maintain.

Content-admin permissions are repository-wide: only trusted maintainers should
receive write access to `juw12/projects`. GitHub does not restrict a collaborator
to a single folder.

Each project follows the same shape:

```
apps/<name>/
  web/        static front-end (this is what gets deployed to GitHub Pages)
  server/     optional zero-dependency Python backend (stdlib only)
  tests/      hermetic, stdlib-only end-to-end tests
  docs/       product specs and guides
  README.md
```

## Design principles

- **No third-party dependencies.** Backends run on the Python 3 standard library
  only (`http.server`, `sqlite3`, `json`) — nothing to `pip install`, no build step.
- **Offline-first, server-optional.** Every front-end works with **no** backend
  (local storage or inline data) and upgrades to a real API when one is running.
  That is what makes static GitHub Pages hosting viable.
- **Static-first deploys.** The Pages workflow ships the front-ends as static
  sites; backends run locally or on your own host.

## Run a project locally

```bash
python apps/orbis/server/server.py
python apps/peers/server/server.py
python apps/house-of-articles/server/server.py
python apps/twin/server.py --lan
```

Each server serves both its API and its `web/` front-end.

## Tests

```bash
python apps/orbis/tests/verify_api.py
python apps/peers/tests/verify_api.py
python apps/house-of-articles/tests/verify_api.py
python apps/twin/tests/verify_api.py
```

All tests are hermetic (temp database, free port) and exit `0` / `1`. You can
also run every test at once:

```bash
python scripts/run_all_tests.py
```

## Live site

`.github/workflows/pages.yml` builds a static site from the apps' `web/`
directories (`scripts/build_site.py`) and deploys it with GitHub Pages. A
`scripts/check_site.py` validator blocks the two failures that pass locally but
break on Pages: **absolute paths** and filename **case** mismatches.

## License

See [LICENSE](LICENSE).
