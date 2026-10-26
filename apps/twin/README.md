# Twin

_Formerly **Trade Twin**. Old `/projects/trade-twin/` links redirect here; saved profiles, guest sessions and the theme choice carry over._

An iPhone-ready investing and day-trading companion that replays 10,000 futures
before you risk a dollar — matched to your personality.

| | |
| --- | --- |
| **App** (installable PWA) | https://juw12.github.io/projects/twin/ |
| **Web** (desktop) | https://juw12.github.io/projects/twin/web.html |
| **Mobile** | https://juw12.github.io/projects/twin/mobile.html |

## Try without signing in

Open the app and choose **Continue as guest**. No account, email or assessment is required.
Guests get a fresh $10,000 practice portfolio and the dated demo snapshot, including research,
goal simulations and the TSLA replay. The optional assessment is in **Me**.

- Guest data uses a separate tab/session store; it never changes a saved profile or server account.
- Reloading the same tab resumes the trial. Browser session restore may also retain it.
- **Me → Reset guest session** or **Leave guest / sign in** erases guest data after confirmation.
- When storage is blocked, a labelled memory-only guest still works; reload then loses those changes.
- Share `…/twin/?guest` to drop a friend straight into a guest session. **Save my progress** turns a
  guest session into a profile, keeping practice trades, alerts, orders, Replay Lab and Academy progress.
- Appearance: **System / Light / Dark** on the welcome page and under **Me → Appearance**.
  It is saved independently of account data. Charts redraw without changing results.

## Stocks from any country

Search by company, ticker or country from the search bar on **Home** or **Invest** — Toyota, ASML,
Bank Central Asia, Samsung, Reliance, Petrobras, Nestlé and so on.

- **Live server:** search reaches any stock, ETF, index or fund Yahoo Finance lists — dozens of
  exchanges (Tokyo `7203.T`, Hong Kong `0700.HK`, Jakarta `BBCA.JK`, London `VOD.L`, Frankfurt `SAP.DE`,
  Mumbai `RELIANCE.NS`, Toronto `RY.TO`, São Paulo `PETR4.SA`, Sydney `BHP.AX` …).
- **Web demo:** a dated snapshot of 54 large stocks on 25+ exchanges plus 18 world indices
  (`web/demo/world.json`, loaded only when needed).
- Every stock page shows the flag, exchange, currency, **open / lunch break / closed** with local time,
  the price in its own currency and ≈ in US dollars, day and 52-week ranges, and its US listing (ADR)
  when there is one.
- **World markets** (Home): market clocks, 18 indices with sparklines, biggest moves and a heatmap.
- **Practice cash stays in USD.** Foreign orders convert at a delayed FX rate: $1,000 of Toyota at
  ¥3,105 with 1 USD ≈ ¥157 buys ≈ 50.5 shares. Pence (GBp), South African cents and agorot are
  converted to pounds, rand and shekels.
- **Home currency** (Me → Currency): see totals ≈ in your own currency (25 currencies, e.g. IDR, EUR, INR, JPY).
- **Portfolio X-ray** adds country and currency exposure.
- Market hours follow each exchange's regular session and lunch break; public holidays are not modelled.

## Features

| Tab | What it does | Inspired by |
| --- | --- | --- |
| Home | global search, world-markets strip, practice-portfolio value (≈ home currency) + chart, next-step coach, watchlist with sparklines, movers, Academy progress | Robinhood, Yahoo Finance, Google Finance |
| Invest | **Practice** (market / limit / stop / stop-limit / trailing orders, brackets, price alerts, portfolio X-ray), **Real** (optional Alpaca account), **goal planner** (10,000 simulated futures), **copy a famous investor's 13F** | Webull / moomoo paper, Acorns / Betterment goals, eToro CopyTrader |
| Trade | entry → exit → **Time Machine** (10,000 replays + every past session) → size → risk → ticket; breakout scanner; **Replay Lab** (trade a hidden past session bar by bar) | day-trader-skill, TradingView replay |
| Learn | **Twin Academy**: 3 levels × 4 interactive lessons, quizzes, points, streak, badges, completion card | Fidelity Learn, Duolingo-style levels |
| News | headlines for watchlist + holdings, movers, tags | moomoo / Public feeds |
| Me | profile, personality result, editable limits, home currency, guide, **Real trading** connection | Fidelity Learn |

**Stock page.** Scrub the chart with a finger to read any day's price and change; SMA / EMA / RSI
overlays; the ticket previews cost, fees, risk and what happens if a stop or target hits.

**Twin Academy.** Lessons are hands-on: a compounding slider, risk/return and diversification
simulators, a fee drag calculator, an order-type sorter, a live SPY chart-reading exercise, DCA vs
lump sum, a portfolio builder, an order sandbox, position sizing, expectancy and a readiness check.
Each lesson ends with a short quiz with explanations (+50 points; +100 per level badge). Levels unlock
in order. The completion card is a personal progress image, not an accredited certificate.

**Personality test.** Ten questions score risk tolerance (1–5) and investor-vs-trader
style, choose a type (Steady Builder, Balanced Grower, Opportunity Hunter, Active Trader)
and set guard-rails: max loss per trade = 0.25–1 % of budget, a daily stop at 3× that,
trades per day, minimum reward:risk and the default target. No emergency fund or money
needed within 3 years caps the risk level at 2.

**Goal planner.** Block bootstrap (random 12-month runs of real monthly total returns,
rebalanced monthly) over 10,000 paths. Reports the chance of reaching the goal, the 5 / 50 / 95 %
outcomes, the chance of ending below what you put in and the worst drop along the way.
Warns when the shared history is shorter than 20 years. Drawdowns use time-weighted unit value, excluding deposits. Values are nominal and omit inflation, tax, transaction costs and slippage.

## TwinAgent research team (1.5)

**Trade → 🤖 TwinAgent**, or **🤖 TwinAgent research report** on any stock page. Five analysts
(trend, SEC-filed fundamentals, risk, relevance-screened headlines, famous investors' 13Fs) argue
a bull and a bear case from cited, dated evidence. A portfolio manager weighs them into
Buy / Overweight / Hold / Underweight / Sell, and a risk gate built from *your* limits sizes the
idea or blocks it. Analysts without fresh evidence abstain; too little evidence means **No call**.

- **Free and repeatable:** no AI subscription; the same evidence always gives the same report
  (fingerprinted). Copy it as JSON or Markdown.
- **No hindsight:** every input is filtered to the analysis time; filings count only from their
  SEC filing date. Leak tests prove later data cannot change a report.
- **Tested on history:** a walk-forward scorecard replays the price evidence month by month over
  decades against buy-and-hold and an equal-exposure baseline. In the bundled data it cut the worst
  drop for 10 of 12 tickers but beat buy-and-hold growth for only 1, with no statistically reliable
  forecasting edge, so reports call it a risk lens, not a forecast.
- **Never trades:** a positive verdict only pre-fills the practice ticket for you to review.
- **Journal:** calls are saved and later scored against SPY from the first close after the call.

Method, full results and the TradingAgents comparison: [docs/TWINAGENT.md](docs/TWINAGENT.md).


### New in 1.4.1: Strategy Lab

Open a stock page and choose **Strategy Lab · test against buy & hold**. Works in the
offline demo, guest mode and local-server app, with no LLM subscription or API key.

- Compare 10-, 20- and 50-session moving-average rules on the first 60% of daily
  observations after a shared warmup. Freeze the best net-return rule, then test it
  on the remaining 40%; the holdout never selects the period.
- Signals execute at the **following observation's close**, not the close that
  created the signal. The strategy and buy-and-hold benchmark both pay configurable
  fees and adverse slippage on entry and exit.
- See net return, worst drawdown, completed trades, time invested and both equity
  curves. Copy a reproducible report containing the input history, settings and trades.
- Snapshot dates and data limitations are visible. Current exchange-local-date bars
  are excluded in server mode. Insufficient or invalid history is refused, not replaced
  with a fabricated result.

This is an educational **single chronological holdout**, not a multi-window walk-forward
study, AI research team, forecast or proof of profitability. It uses price returns in the
listing currency and omits dividends, tax, cash interest, FX performance, liquidity and
partial fills. Repeatedly selecting tickers/settings after seeing results can overfit.
The lab never submits orders or changes the practice portfolio.

### Run the app

* **Live (your computer + phone).** `python apps/twin/server.py --lan` (or double-click
  `Start Twin (iPhone).command` on a Mac). Open the printed address on your phone (same
  Wi-Fi) → Share → Add to Home Screen. Accounts are salted PBKDF2 hashes with HttpOnly session
  cookies, stored in `apps/twin/data/` (git-ignored). Live delayed quotes (Yahoo Finance),
  SEC EDGAR 13Fs (needs your email as the SEC user agent), news, and the full skill tools.
* **Web demo (GitHub Pages).** When no server answers, `web/demo.js` takes over: the same app runs
  in the browser on a bundled snapshot (`web/demo/`: 16 US tickers' prices and charts, 54 global
  stocks + 18 indices + 25 FX rates in `world.json`, 12 monthly histories, five investors' 13Fs, a news
  snapshot and the TSLA replay). Refresh the global snapshot with
  `python apps/twin/scripts/world_snapshot.py` (`--check` validates it). Accounts and the practice
  portfolio stay in that browser's localStorage.

## Real trading (optional, local server only)

Twin can place **real** orders through your own [Alpaca](https://alpaca.markets) account. This only
works on the live Python server you run yourself; the GitHub Pages demo shows an explainer and never
asks for keys.

1. Create an Alpaca account and API keys (start with **paper** keys — Alpaca's free simulated account).
2. Sign in to Twin on your server → **Me → Real trading** → paste keys, choose Paper or Live.
3. Trade from any ticket with the **Alpaca** account switch, or see equity, positions and open orders
   in **Invest → Real**.

Safeguards: paper is the default; live needs your Twin password and typing `REAL MONEY`; every order
gets a server-side preview with a single-use confirmation (expires after 2 minutes, live adds a
3-second browser pause); per-order cap (paper $25,000, live $1,000 by default, adjustable); live buy
submission attempts per UTC day follow your trade limit (default 3); no-short position checks;
account must be ACTIVE; **cancel all** button.
Keys are stored on your computer in `data/users/<id>/broker.json` (**not encrypted**;
owner-only permissions on POSIX, but Windows ACLs are not configured or verified) and are
never sent back to the browser. Use paper keys on a trusted computer. Use keys you can revoke;
disconnecting deletes them.
Alpaca trades **US-listed** stocks and ETFs only, so Twin blocks real orders for other exchanges and
points to the US listing (ADR) when one exists. To own shares on other exchanges, use a broker that
covers them — for example Interactive Brokers (175 markets in 40 countries, per IBKR) or a local broker —
and practise those stocks in Twin first. Alpaca availability depends on your country. Tested against a mock Alpaca API,
not a funded account — try paper first.

## Test

```bash
python apps/twin/tests/verify_api.py
python apps/twin/tests/verify_broker.py      # real-trading bridge against a mock Alpaca
python apps/twin/tests/test_pro_engine.py    # order types, brackets, indicators, replay (needs node)
python -m unittest discover -s apps/twin/tests -p 'test_*.py'
node --test apps/twin/tests/strategy_lab.test.js apps/twin/tests/twinagent.test.js
python apps/twin/tests/test_twinagent_server.py
python apps/twin/tests/verify_browser.py     # isolated Chrome/Chromium/Edge, including phone-width lab UI
```

Hermetic (temp data dir, free port, no network): health + static files, accounts and isolation,
personality → limits, the cross-site guard, input validation (NaN/∞/negative amounts, path
traversal, malformed Content-Length), the full demo trade flow, and unit tests for the
monthly-return gap handling, the goal simulator, FX conversion, minor-unit quotes (GBp → GBP) and
foreign-currency practice orders. `verify_broker.py` also checks that non-US listings are refused.

### Submission-time safeguards (1.4.1)

Broker confirmation now rechecks the current account block/status, buying power, estimated
order cap, holdings, current profile limits and attached-stop planned risk. An over-limit
live bracket is refused rather than merely warned about. Invalid bracket direction and
nonfinite quote/account values cannot silently bypass the relevant checks.

Live **buy submission attempts** reserve daily capacity before network I/O, serialized within
one server process. Unknown outcomes and rejected submissions conservatively consume capacity;
the error includes the client order ID and asks you to check Alpaca before retrying. The counter
survives reconnect/disconnect and restarts and resets on the next UTC date. Long-position exits
are not blocked by this entry cap. Reconnecting invalidates old previews, even in the same mode.

These are not guaranteed loss or execution limits. Orders without an attached stop explicitly
warn that planned stop-loss risk cannot be checked. Gaps/slippage can exceed a stop estimate;
delayed quotes are not firm execution prices. Daily portfolio loss, aggregate pending-order
exposure, cross-process locking and orders placed outside this Twin user are not covered.
Keep to one server process per data directory and test with paper accounts first.

## Safety

Browser demo profiles are **not cloud accounts or a privacy boundary**: anyone who can inspect this
browser's storage can read them. Use a unique demo password, not a brokerage password. Live-server
accounts are separate and do not sync with GitHub Pages profiles. A LAN HTTP connection is unencrypted;
do not expose this development server to the public internet. Use a properly configured HTTPS host
for untrusted networks. The preferences quiz is educational, not a validated suitability assessment.


Practice money by default. Real orders happen only if you connect your own Alpaca keys on your own server (see above); the public web demo never asks for broker credentials.
Quotes are delayed and unofficial; 13F reports describe quarter-end holdings and are due within 45 days after the quarter; the latest available holdings can be much older and exclude shorts/cash. Simulations resample
history and are not predictions. Not financial advice.

## Changelog

- **1.5.0 — TwinAgent.** Multi-analyst research team with bull/bear debate, portfolio manager and
  profile-driven risk gate; point-in-time evidence (SEC filing dates, timestamped headlines, 13F
  filed dates) with leak tests; relevance-screened headline tone; one-off accounting flags;
  monthly walk-forward scorecard vs buy-and-hold and equal exposure, with stability halves;
  journal scored against SPY; pre-filled practice tickets (never auto-submitted); offline demo
  fundamentals for 11 stocks from SEC filings; `/api/twinagent/evidence` on the local server.

- **1.4.1 — Evidence and submission guards (local upgrade).** Strategy Lab with a
  chronological holdout, next-close execution, cost-aware buy-and-hold comparison and
  reproducible reports; submit-time broker validation, persistent entry-attempt reservations,
  hard planned bracket-risk refusals and reconnect invalidation. Added deterministic engine,
  concurrency, HTTP and real-browser regressions. Broker tests now stub market quotes instead
  of accidentally reaching Yahoo. Windows credential-permission limitations are explicit.
  See [comparison, scope and remaining work](docs/TRADINGAGENTS-COMPARISON.md).

- **1.4.0 — Twin Global.** Stocks from any country: universal search (company, ticker or country),
  stock pages with exchange, currency, market status, ≈ USD, day/52-week ranges and US-listing hints;
  **World markets** (clocks, 18 indices, movers, heatmap); FX-correct practice trading in USD; home
  currency display (25 currencies); country + currency exposure in X-ray; refreshed Home with search
  bar and world strip; real-money orders limited to US listings with guidance for other exchanges;
  server prefers IPv4 so a broken IPv6 route can't stall quotes.
- **1.3.0** — Guest invite link (`?guest`) and **Save my progress**; scrub-to-read stock charts with
  SMA/EMA/RSI; limit, stop, stop-limit and trailing orders with brackets (OCO); price alerts; portfolio
  X-ray; movers; **Replay Lab**; **Twin Academy** (Learn tab, 12 interactive lessons with quizzes,
  points, badges and a completion card); optional **real trading** through your own Alpaca account
  on the local server, with preview/confirm, caps, live-mode password + phrase and cancel-all.

- **1.2.0** — Renamed Trade Twin → **Twin**: new address `/projects/twin/`, app folder `apps/twin/`, home-screen name and launcher. Old links redirect (query and hash kept); the old offline worker and its caches are retired at the old address so installed copies stop showing the old name. Browser storage keys are unchanged, so saved profiles, guest sessions and theme carry over. `TWIN_DATA` replaces `TRADE_TWIN_DATA` (the old variable still works).

- **1.1.0** — No-login, no-email guest trial with optional assessment; isolated session-only practice
  data, reset/exit confirmations and memory-only fallback. Added saved system/light/dark appearance
  on the welcome screen, app settings and desktop wrapper; canvas charts adapt to the palette.
  Improved keyboard focus/dialog closing, reduced-motion support, readable text and touch targets.
  Guest actions cannot switch to fake live trading; trial shortcuts use the supported replay.
  Snapshot copying reports skipped positions and unspent cash rather than claiming a full copy.
  Guest and theme cases are covered by the real-browser regression harness.

- **1.0.2** — Cashflow-neutral drawdowns (deposits cannot hide losses); contiguous-history sampling
  without end-to-start wrap; duplicate tickers and invalid weights rejected; clearer model assumptions.
  Replays respect the plan's flat-by time (the bundled TSLA recordings now end at 15:55).
  Token-bound trade pipelines reject stale/cross-account runs, changed limits and skipped steps;
  UI controls are frozen during a run. Browser credentials now use random-salt PBKDF2 and legacy
  demo profiles upgrade at login; plaintext fallback removed. Browser profile updates serialize
  across tabs via Web Locks where available. Logout clears cached portfolios/news/results.
  Service-worker cleanup only touches Twin's caches, and the whole snapshot is precached.
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
