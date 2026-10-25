# Twin — design notes

* **Backend**: `server.py`, stdlib only. Wraps the vendored skill CLIs as subprocesses, one
  workspace per user and mode (`data/users/<id>/{demo,live}/trader/`), so the skills' own
  `trader/*.json` hand-offs (entry → plan → orders → risk verdicts) keep working unchanged.
  The user's limits are written into each workspace's `config.json`; paper trading, no options,
  no margin and no shorting are forced on every write.
* **Personality → limits** (`score_quiz`, `limits_for`): risk level 1–5 maps to 0.25 / 0.5 / 0.75 /
  1 / 1 % max loss per trade, 1–4 trades a day, minimum reward:risk 2 / 2 / 1.5 / 1.5 / 1 and the
  matching default target. These are app conventions (in the spirit of the common "1 % rule"),
  not advice. The same rules are mirrored in `web/demo.js` for the browser demo.
* **Monthly history**: requested with explicit `period1/period2` — `range=max` makes Yahoo return
  quarterly bars for long histories — and returns are only taken between consecutive months.
* **Goal planner**: 12-month block bootstrap, 10,000 paths, fixed seed (19) so a run is repeatable.
* **Frontend**: one mobile-first file (`web/index.html`), relative paths only (served under
  `/projects/twin/` on Pages), canvas charts, bottom tab bar, bottom sheets, PWA manifest +
  service worker. `web.html` frames it for desktop; `mobile.html` forwards to it.
