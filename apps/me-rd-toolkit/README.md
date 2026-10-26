# ME R&D Toolkit

Offline-first workspace for mechanical R&D: NPI task flow, review checklists, issue log,
project report, engineering calculators and an optional LAN file vault. It runs from a
static web folder with no build step and no third-party dependencies.

The public build ships with **generic demo content only**. Real checklists, rules, limits and
file indexes live in a private *data pack* that is loaded at runtime and never committed.

## Features

- **NPI flow**: phase timeline, per-task status, owner, remarks, milestone dates and overdue warnings
- **Checklists**: OK / NG / NA per item with remarks, category filters, CSV export and print
- **Issue log and one-page project report** (NG items, failed checks, open issues)
- **Calculators**: Cpk / gap-step, button gap (x̄ − 3σ), screw torque window, tolerance stack-up
  (worst case + RSS), snap-fit cantilever, thermal pad compression, cable bend radius,
  enclosure openings (IEC), colour ΔE, test margin and unit conversion. Limits are editable and
  can be preset from the data pack.
- **File Vault** (optional): browse shared folders by category, search, open or download files
- Bookmarks, recent items, dark mode, built-in "How to use" guide; installable PWA that works offline

## Layout

```
apps/me-rd-toolkit/
  web/       static front-end (deployed to GitHub Pages)
  server/    optional stdlib-only vault server + example config
  tests/     hermetic stdlib-only tests
```

## Run

- **Static:** open `web/index.html`, or use the deployed page. Project status is stored in the
  browser (`localStorage`); use **Data & Backup** to export or import it.
- **With a data pack:** **Data & Backup → Import data pack** (JSON). The pack stays in the
  browser's IndexedDB and is never uploaded.
- **Vault server:** copy `server/vault_config.example.json` to `private/vault_config.json`,
  set `roots`, `categories`, `exclude` and `excludeNames`, then run
  `python server/vault_server.py`. A password is generated on first run (user `team`).

Private files are looked up in `apps/me-rd-toolkit/private/` (or `ME_PRIVATE_DIR`) and are
ignored by git: `pack.js` (data pack), `calcs.js` (extra calculators registered through
`APP.addCalcs`) and `aliases.js` (local path aliases).

## Security notes

The vault uses HTTP Basic auth, read-only access, path-traversal checks, a strict
category whitelist, exclusion rules and an access log. Basic auth is not encrypted: keep the
server on a trusted internal network and never expose it to the internet.

## Tests

```
python apps/me-rd-toolkit/tests/test_me_rd_toolkit.py
```
