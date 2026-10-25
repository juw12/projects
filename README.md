# apps/

A monorepo for product projects, each promoted from prototype to a real,
runnable, deployable project.

| Project | What it is | Stack |
| --- | --- | --- |
| [`apps/orbis`](apps/orbis) | Communication, identity, protection — and hiring (Orbis Work) — in one app | Zero-dependency Python stdlib server + SQLite + static PWA |
| [`apps/guangyao`](apps/guangyao) | 光耀同行 — unofficial learning/community concept with local course progression, activities, rewards and transparent-giving demonstrations | Responsive installable PWA; real backend integrations remain pending |
| [`apps/peers`](apps/peers) | Verified reviews across category **modes** (food, travel, market, AI tools, health, finance, …) — every category shares one interface | Single-file web app + optional stdlib persistence backend |
| [`apps/house-of-articles`](apps/house-of-articles) | Athlete-moment sneaker news + live market feed | Static prototype + versioned data spine |
| [`apps/hazel`](apps/hazel) | Desktop studio for creators — auto-cut, repurpose to every platform, publish, measure traffic | Electron + bundled ffmpeg + local Whisper (offline) |
| [`apps/sweep`](apps/sweep) | The `/sweep` pipeline — validate, then sync the repo to GitHub and mirror a note to Obsidian | PowerShell helper + OpenCode slash command |
| [`apps/trade-twin`](apps/trade-twin) | Invest and day-trade with a twin that replays 10,000 futures — personality test, paper trading, goal planner, copy a 13F, news | Zero-dependency Python stdlib server + installable PWA (offline web demo) |
| [`apps/shortcraft`](apps/shortcraft) | Faceless 9:16 explainer shorts in the browser — scenes, captions, generated music, MP4 export (EN/ID), channel kit, YouTube upload + opt-in autoposter | Static web app (Canvas + Web Audio + MediaRecorder) + optional Python pipeline |
| [`apps/hookline`](apps/hookline) | Private short-form remix studio with tempo/pitch controls, full-track crossfades, portable recipes and an unvalidated edit checklist | Zero-dependency browser DSP + Web Workers + offline PWA |

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
python apps/trade-twin/server.py --lan
```

Each server serves both its API and its `web/` front-end.

## Tests

```bash
python apps/orbis/tests/verify_api.py
python apps/peers/tests/verify_api.py
python apps/house-of-articles/tests/verify_api.py
python apps/trade-twin/tests/verify_api.py
```

All tests are hermetic (temp database, free port) and exit `0` / `1`. You can
also run every test at once:

```bash
python scripts/run_all_tests.py
```

## Live site

`.github/workflows/pages.yml` builds a static site from the three `web/`
directories (`scripts/build_site.py`) and deploys it with GitHub Pages. A
`scripts/check_site.py` validator blocks the two failures that pass locally but
break on Pages: **absolute paths** and filename **case** mismatches.

## License

See [LICENSE](LICENSE).
