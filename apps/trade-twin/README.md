# Trade Twin

An iPhone-ready investing and day-trading companion that replays 10,000 futures
before you risk a dollar — matched to your personality.

| | |
| --- | --- |
| **App** (installable PWA) | https://juwpegatron.github.io/projects/trade-twin/ |
| **Web** (desktop) | https://juwpegatron.github.io/projects/trade-twin/web.html |
| **Mobile** | https://juwpegatron.github.io/projects/trade-twin/mobile.html |

## Features

| Tab | What it does | Inspired by |
| --- | --- | --- |
| Home | practice-portfolio value + chart, next-step coach, watchlist with sparklines | Robinhood |
| Invest | paper trading (fractional), **goal planner** (10,000 simulated futures), **copy a famous investor's 13F** | Webull / moomoo paper, Acorns / Betterment goals, eToro CopyTrader |
| Trade | entry → exit → **Time Machine** (10,000 replays + every past session) → size → risk → ticket; breakout scanner | day-trader-skill |
| News | headlines for watchlist + holdings, movers, tags | moomoo / Public feeds |
| Me | profile, personality result, editable limits, 10-article guide | Fidelity Learn |

**Personality test.** Ten questions score risk tolerance (1–5) and investor-vs-trader
style, choose a type (Steady Builder, Balanced Grower, Opportunity Hunter, Active Trader)
and set guard-rails: max loss per trade = 0.25–1 % of budget, a daily stop at 3× that,
trades per day, minimum reward:risk and the default target. No emergency fund or money
needed within 3 years caps the risk level at 2.

**Goal planner.** Block bootstrap (random 12-month runs of real monthly total returns,
rebalanced monthly) over 10,000 paths. Reports the chance of reaching the goal, the 5 / 50 / 95 %
outcomes, the chance of ending below what you put in and the worst drop along the way.
Warns when the shared history is shorter than 20 years. Drawdowns use time-weighted unit value, excluding deposits. Values are nominal and omit inflation, tax, transaction costs and slippage.

## Two ways to run

* **Live (your computer + phone).** `python apps/trade-twin/server.py --lan` (or double-click
  `Start Trade Twin (iPhone).command` on a Mac). Open the printed address on your phone (same
  Wi-Fi) → Share → Add to Home Screen. Accounts are salted PBKDF2 hashes with HttpOnly session
  cookies, stored in `apps/trade-twin/data/` (git-ignored). Live delayed quotes (Yahoo Finance),
  SEC EDGAR 13Fs (needs your email as the SEC user agent), news, and the full skill tools.
* **Web demo (GitHub Pages).** When no server answers, `web/demo.js` takes over: the same app runs
  in the browser on a bundled snapshot (`web/demo/`: 16 tickers' prices and charts, 12 monthly
  histories, five investors' 13Fs, a news snapshot and the TSLA replay). Accounts and the practice
  portfolio stay in that browser's localStorage.

## Test

```bash
python apps/trade-twin/tests/verify_api.py
```

Hermetic (temp data dir, free port, no network): health + static files, accounts and isolation,
personality → limits, the cross-site guard, input validation (NaN/∞/negative amounts, path
traversal, malformed Content-Length), the full demo trade flow, and unit tests for the
monthly-return gap handling and the goal simulator.

## Safety

Browser demo profiles are **not cloud accounts or a privacy boundary**: anyone who can inspect this
browser's storage can read them. Use a unique demo password, not a brokerage password. Live-server
accounts are separate and do not sync with GitHub Pages profiles. A LAN HTTP connection is unencrypted;
do not expose this development server to the public internet. Use a properly configured HTTPS host
for untrusted networks. The preferences quiz is educational, not a validated suitability assessment.


Practice money only — Trade Twin never places a real order and never asks for broker credentials.
Quotes are delayed and unofficial; 13F reports describe quarter-end holdings and are due within 45 days after the quarter; the latest available holdings can be much older and exclude shorts/cash. Simulations resample
history and are not predictions. Not financial advice.

## Changelog

- **1.0.2** — Cashflow-neutral drawdowns (deposits cannot hide losses); contiguous-history sampling
  without end-to-start wrap; duplicate tickers and invalid weights rejected; clearer model assumptions.
  Replays respect the plan's flat-by time (the bundled TSLA recordings now end at 15:55).
  Token-bound trade pipelines reject stale/cross-account runs, changed limits and skipped steps;
  UI controls are frozen during a run. Browser credentials now use random-salt PBKDF2 and legacy
  demo profiles upgrade at login; plaintext fallback removed. Browser profile updates serialize
  across tabs via Web Locks where available. Logout clears cached portfolios/news/results.
  Service-worker cleanup only touches Trade Twin's caches, and the whole snapshot is precached.
  A disconnected live server no longer silently switches users to demo data.
  See [audit and regression evidence](docs/AUDIT-1.0.2.md).

- **1.0.1** — Hardening pass: every numeric input (orders, copy amount, budget, limits, practice cash,
  goal planner) is validated as a finite number within sane bounds, on the server and in the web demo
  (a `NaN` order could previously corrupt paper cash); profile/paper updates are serialized so
  double taps can't lose a trade, and the slow goal simulation no longer overwrites trades made
  meanwhile; stricter static-file containment check; malformed `Content-Length` returns 413; the
  service worker only caches successful same-origin responses; demo wording fixed ("stays in this
  browser"). 10 new regression checks.
- **1.0.0** — First release.

## Credits

`vendor/` holds Jake Schincariol's MIT-licensed
[day-trader-skill](https://github.com/Jakeschincariol/day-trader-skill) and
[trader-skill](https://github.com/Jakeschincariol/trader-skill), unmodified (see `vendor/README.md`).
