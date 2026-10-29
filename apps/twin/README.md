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
- **Web demo:** about 280 large stocks and ETFs on 35+ exchanges plus 34 world indices, **refreshed
  hourly** by GitHub Actions (`web/demo/world.json` + one chart file per symbol in `web/demo/world/`,
  loaded only when needed). If a refresh fails, the last good data stays and its time is shown.
- Every stock page shows the flag, exchange, currency, **open / lunch break / closed** with local time,
  the price in its own currency and ≈ in US dollars, day and 52-week ranges, and its US listing (ADR)
  when there is one.
- **World markets** (Home): market clocks, 34 indices with sparklines, biggest moves and a heatmap.
- **Practice cash stays in USD.** Foreign orders convert at the FX rate shown with its "as of" time
  (re-fetched every 60 s on your own server, hourly in the web demo): $1,000 of Toyota at
  ¥3,105 with 1 USD ≈ ¥157 buys ≈ 50.5 shares. Pence (GBp), South African cents and agorot are
  converted to pounds, rand and shekels.
- **Home currency** (Me → Currency): see totals ≈ in your own currency (25 currencies, e.g. IDR, EUR, INR, JPY).
- **Portfolio X-ray** adds country and currency exposure.
- **Real exchange calendars:** open / lunch / closed, public holidays, early closes and late opens come
  from [`exchange_calendars`](https://github.com/gerrymanoim/exchange_calendars) (38 exchanges,
  `web/demo/calendars.json`, rebuilt by `scripts/market_calendars.py`). Stock pages list the next
  market holidays. Qatar and Abu Dhabi use hand-curated calendars (`CURATED` in the script); their Eid dates are
  estimates (shown as “est.”) until the exchanges confirm them;
  Shanghai/Shenzhen and India are covered through 2026 until the package publishes later years.

## Twin Indonesia (1.11, account sync in 1.12)

The rupiah side of Twin, merged from the *Satu* prototype: https://juw12.github.io/projects/twin/id/.
Open it from the teal **Twin Indonesia** card on Home, **Me → Twin Indonesia**, or **Trade … in rupiah
lots** on any Jakarta (`.JK`) stock page; the **Twin** logo in its top bar comes back.

- **Four markets, one rupiah practice wallet.** The same 19 IDX stocks Twin lists, traded in 100-share
  lots with IDX price steps and broker fees shown before you confirm; US stocks at the shown USD/IDR
  rate; crypto and gold priced in rupiah (gold per gram).
- **Community with Scam Shield.** Market rooms plus subscriber rooms; posts promising fixed returns
  ("pasti cuan"), private signal groups or unlicensed platforms are blocked and explained.
- **Analyst Desk.** Only licensed advisers may publish ideas, and every idea is scored against real
  prices, losses included. The demo analysts are fictional.
- **Academy and plans.** Nine interactive lessons in three levels (fees and break-even, lots and price
  steps, spotting *investasi bodong*, position sizing…) and Free / Plus / Pro plan concepts.
- **Your rupiah wallet on Home and Me (1.12).** Twin's Home card and Me screen show its value, return,
  positions and cash. It stays separate from the USD portfolio.
- **Account sync on your own server (1.12).** Signed in to Twin on `python server.py`, the wallet is kept in
  your account (`data/users/<id>/indonesia.json`) and follows you to other browsers. Each save names the
  revision it builds on, so a stale tab can't overwrite newer trades: the account copy wins and the replaced
  local copy is kept as a backup. On GitHub Pages it stays in the browser.
- **Headlines.** On the local server every feed (Antara, CNBC Indonesia, CoinDesk, Cointelegraph, Investing.com
  gold) comes through `POST /api/indonesia/news`, cached for 10 minutes. On GitHub Pages the hourly job
  refreshes the headlines inside `web/id/snapshot.js`, which the service worker fetches network-first.
  Prices come from Twin's own hourly snapshot (same origin) and CoinGecko, with the bundled snapshot as
  fallback.

Guide, architecture and the path to a licensed product in Indonesia: [docs/INDONESIA.md](docs/INDONESIA.md).
Refresh its offline data with `python apps/twin/scripts/indonesia_snapshot.py`, then
`python apps/twin/scripts/indonesia_ideas.py`; `--news-only` refreshes just the headlines (the hourly job).

## Features

| Tab | What it does | Inspired by |
| --- | --- | --- |
| Home | global search, world-markets strip, practice-portfolio value (≈ home currency) + chart, next-step coach, watchlist with sparklines, movers, Academy progress | Robinhood, Yahoo Finance, Google Finance |
| Invest | **Practice** (market / limit / stop / stop-limit / trailing orders, brackets, price alerts, portfolio X-ray), **Real** (optional Alpaca or Interactive Brokers account), **goal planner** (10,000 simulated futures), **copy a famous investor's 13F** | Webull / moomoo paper, Acorns / Betterment goals, eToro CopyTrader |
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
  in the browser on bundled data (`web/demo/`: 16 US tickers' prices and charts, ~280 global stocks/ETFs
  + 34 indices + 30 FX rates in `world.json` with per-symbol charts in `world/`, exchange calendars,
  12 monthly histories, five investors' 13Fs, a news snapshot and the TSLA replay). The Pages workflow
  re-runs `scripts/world_snapshot.py` and `scripts/market_calendars.py` every hour (best effort — if
  Yahoo throttles, the committed data is kept). Run them yourself with `--check` to validate. Accounts
  and the practice portfolio stay in that browser's localStorage.

## Real-time prices (optional, local server only)

Out of the box Twin uses Yahoo Finance: free, but **delayed and unofficial**. On your own server you can
add better sources in **Me → Market data**; each stock page then says exactly where its price came from
(“● Real-time · Alpaca IEX” or “Delayed · Yahoo Finance”):

| Source | Markets | Cost | How |
| --- | --- | --- | --- |
| Interactive Brokers gateway | Every market your IBKR data subscriptions cover | IBKR market-data fees | Connect IBKR in Me → Real trading |
| Alpaca | US stocks & ETFs, real-time (IEX) | Free with an Alpaca account | Connect Alpaca in Me → Real trading |
| Finnhub | US stocks real-time (free plan); other markets on paid plans | Free key at finnhub.io | Paste the key in Me → Market data |

Order: IBKR → Alpaca → Finnhub → Yahoo. A live price that disagrees with Yahoo by more than 25% is not
shown (except an exact ×100 pence/cents quote, which is converted), so a wrong contract or unit can't slip
through. Keys stay in `data/` on your computer (0600) and are never sent to the browser.

**IBKR self-test:** Me → Real trading → Interactive Brokers → *Test my gateway* runs read-only checks
against your real gateway — reachable, logged in, account, contract lookup, market data (and whether
it's real-time or delayed), and an IBKR *what-if* that prices a 1-share order without sending it.

## Your data: daily backups and safe updates

* The server zips `data/` (accounts, practice portfolios, settings, broker connections) once a day into
  `data/backups/twin-data-YYYYMMDD.zip` and keeps the last 14.
* To update an existing install, don't copy folders over it — run
  `python3 apps/twin/scripts/update_local.py /path/to/your/twin`. It backs up the whole install first,
  copies the new version over the old files and never deletes anything (unused old files are listed).

## Real trading (optional, local server only)

Twin can place **real** orders through your own brokerage account — **Alpaca** (US stocks and ETFs) or
**Interactive Brokers** (listings on most world exchanges). This only works on the live Python server
you run yourself; the GitHub Pages demo shows an explainer and never asks for keys or logins.
One broker is connected at a time.

**Alpaca (US):**
1. Create an Alpaca account and API keys (start with **paper** keys — Alpaca's free simulated account).
2. Sign in to Twin on your server → **Me → Real trading → Alpaca** → paste keys, choose Paper or Live.

**Interactive Brokers (global):**
1. Download IBKR's [Client Portal Gateway](https://www.interactivebrokers.com/en/trading/ib-api.php)
   (needs Java) and start it on the same computer: `bin/run.sh root/conf.yaml`.
2. Open `https://localhost:5000` and log in (paper username first). Twin never sees your IBKR password.
3. In Twin → **Me → Real trading → Interactive Brokers**, choose Paper or Live and press Connect.
   Twin checks the gateway's account type matches (a paper login can't be connected as live and vice versa).
4. Gateway sessions time out; when Twin says so, log in at `https://localhost:5000` again.
   Use `TWIN_IBKR_URL` if your gateway runs on another local port (only loopback addresses are accepted).

Then trade from any stock's ticket with the account switch (Practice / Alpaca or IBKR), or see equity,
positions and open orders in **Invest → Real**.

IBKR specifics: Twin maps the Yahoo symbol to IBKR's listing (`7203.T` → Toyota on TSEJ, `BBCA.JK` →
IDX, `VOD.L` → LSE …) and asks you to pick when there are several; orders are **whole shares** in the
listing's currency (a dollar amount rounds down to whole shares); market, limit, stop, stop-limit,
trailing (%) and take-profit/stop-loss brackets; IBKR's what-if check (commission, warnings) is shown in
the preview, and if IBKR asks a precautionary question (e.g. price far from the market) you answer it yourself — Twin never confirms it for you and nothing is placed until you do. Which markets you can trade
depends on your country of residence and the market-data / trading permissions on your IBKR account.

Safeguards: paper is the default; live needs your Twin password and typing `REAL MONEY`; every order
gets a server-side preview with a single-use confirmation (expires after 2 minutes, live adds a
3-second browser pause); per-order cap (paper $25,000, live $1,000 by default, adjustable, in US dollars
for both brokers — foreign orders are converted at the current rate); live buy submission attempts per
UTC day follow your trade limit (default 3); no-short position checks; account must be ACTIVE;
**cancel all** button. Checks run at preview **and** again immediately before submission.
Alpaca keys are stored on your computer in `data/users/<id>/broker.json` (**not encrypted**;
owner-only permissions on POSIX, but Windows ACLs are not configured or verified) and are
never sent back to the browser. Use paper keys on a trusted computer. Use keys you can revoke;
disconnecting deletes them. IBKR logins stay in IBKR's gateway; Twin stores only the account id.
Alpaca trades **US-listed** stocks and ETFs only, so with Alpaca Twin blocks real orders for other
exchanges and points to the US listing (ADR) or to IBKR. Broker availability depends on your country —
Twin can't change who a broker accepts or which markets your account may trade. Both bridges are tested
against mock APIs (`verify_broker.py`, `verify_ibkr.py`), not funded accounts — try paper first.

## Test

```bash
python apps/twin/tests/verify_api.py
python apps/twin/tests/verify_broker.py      # real-trading bridge against a mock Alpaca
python apps/twin/tests/verify_ibkr.py        # Interactive Brokers bridge against a mock Client Portal Gateway
python apps/twin/tests/test_pro_engine.py    # order types, brackets, indicators, replay (needs node)
python -m unittest discover -s apps/twin/tests -p 'test_*.py'
node --test apps/twin/tests/strategy_lab.test.js apps/twin/tests/twinagent.test.js
python apps/twin/tests/test_twinagent_server.py
python apps/twin/tests/verify_browser.py     # isolated Chrome/Chromium/Edge, including phone-width lab UI
python apps/twin/tests/verify_indonesia.py   # Twin Indonesia: engine checks + app self-test in Chrome/Edge
```

Hermetic (temp data dir, free port, no network): health + static files, accounts and isolation,
personality → limits, the cross-site guard, input validation (NaN/∞/negative amounts, path
traversal, malformed Content-Length), the full demo trade flow, and unit tests for the
monthly-return gap handling, the goal simulator, FX conversion, minor-unit quotes (GBp → GBP) and
foreign-currency practice orders. `verify_broker.py` also checks that non-US listings are refused with Alpaca; `verify_ibkr.py`
covers gateway login checks, contract resolution and ambiguity, whole-share sizing, JPY tick rounding,
caps and buying power in USD, brackets, what-if errors, IBKR questions answered (or declined) by the user, and cancel.

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


Practice money by default. Real orders happen only if you connect your own Alpaca keys or IBKR gateway on your own server (see above); the public web demo never asks for broker credentials.
Quotes are delayed and unofficial; 13F reports describe quarter-end holdings and are due within 45 days after the quarter; the latest available holdings can be much older and exclude shorts/cash. Simulations resample
history and are not predictions. Not financial advice.

## Changelog

- **1.12.0 — Twin Indonesia wallet and news everywhere.** Home's Twin Indonesia card and the Me screen now
  show your rupiah practice wallet (value, return, positions, cash). On your own server, a signed-in Twin
  account keeps the wallet (`/api/indonesia/wallet`, `/api/indonesia/wallet/save`) with revision checks, so
  two devices or a forgotten tab can't silently overwrite each other; hidden tabs never upload. Every
  Indonesian, crypto and gold feed now reaches the browser through the server (`/api/indonesia/news`,
  10-minute cache, failures reported per feed), and on GitHub Pages the hourly job refreshes the headlines
  in `id/snapshot.js`, which the service worker now fetches network-first. Feeds are fetched in parallel.
- **1.11.0 — Twin Indonesia.** The *Satu* prototype joins Twin as its rupiah side at `id/`: IDX stocks
  in 100-share lots with price steps and fees, US stocks at the shown USD/IDR rate, crypto and gold in
  rupiah, community rooms with Scam Shield, an Analyst Desk scored against real prices and nine
  interactive lessons, all with a separate rupiah practice wallet. Open it from a new Home card, Me, or
  any Jakarta stock page. It reads Twin's hourly snapshot on the same origin and shares Twin's theme
  and service worker (Satu's own worker, which would have cleared other apps' caches on the shared
  GitHub Pages origin, was dropped). The local server now opens folder URLs such as `/id/`.
- **1.10.1 — Premium landing.** The welcome screen is new: a big "Invest smarter. Practice first." headline,
  a glowing practice-balance card with a live sparkline, three feature tiles, a gradient "Continue as guest"
  button and the sign-in form in its own card. The desktop page (web.html) gets the same dark premium look
  with stats, feature cards and the app in a glowing phone frame.
- **1.10.0 — Premium everywhere.** Every tab now matches the new Home: Invest opens with a glowing
  portfolio card (big value, gain chip, glass Cash / Invested / Started-with tiles); Learn gets a gradient
  academy card and colourful course tiles with gradient progress bars; Trade and News use the same rounded
  cards and soft brand glow; Me starts with a large avatar, your name and account type. The "Guest
  snapshot" note is now a small chip. Works in dark and light; features and flows unchanged.
- **1.9.0 — Premium.** The look you picked from three concepts (Revolut-style): dark by default, a glowing
  gradient hero on Home with one big balance (smaller cents), a gain chip and a mini chart; round quick
  actions (Buy, Portfolio, Ask AI, Goal); swipeable promo cards for TwinAgent, Replay Lab, the day-trade
  drill and investor holdings; a stock page with a logo header, large price and a Buy/Sell dock that stays
  at the bottom. Light theme gets a rounded indigo hero. Also: a slow Home load from an earlier session can
  no longer write into a fresh guest session. Features and flows unchanged; contrast stays WCAG AA.
- **1.8.0 — New look.** A redesign in the style of today's most-loved finance apps: big bold numbers and
  large titles, soft borderless cards, pill buttons and chips, one indigo brand gradient (green/red only for
  money), coloured ticker badges, a floating glass tab bar with a sliding indicator, a header that frosts
  as you scroll, charts that draw themselves in with a glowing end dot, a count-up on your portfolio value,
  shimmer loading cards, springy sheets you can swipe down to close and light haptics on Android. All
  features, ids and flows unchanged; contrast stays WCAG AA in light and dark; motion respects
  "reduce motion".
- **1.7.0 — Real-time where you have it, safer data.** Real-time prices from your own sources (IBKR,
  Alpaca IEX, Finnhub) with the source and time on every stock page and Yahoo as the labelled fallback;
  unit/contract guard (pence ×100 converted, >25% mismatches dropped). Read-only **IBKR gateway self-test**.
  **Qatar and Abu Dhabi calendars** (Eid dates marked as estimates). Live trading now asks you to confirm
  you may trade those markets from your country. **Daily data backups** (14 kept) and a safe
  `update_local.py` that backs up first and never deletes. Fixed a race where a background order check
  could undo a cancel you made while prices were loading (or carry orders into a fresh guest session).
- **1.6.0 — Limits fixed.** Web demo now ~280 stocks/ETFs on 35+ exchanges + 34 indices, refreshed
  **hourly** by GitHub Actions with a per-symbol chart for every listing (last good data kept on
  failures); **real exchange calendars** (holidays, early closes, late opens for 38 exchanges, "next
  market holidays" on stock pages); FX re-fetched every **60 s** on the server with an "as of" time on
  stock pages and the currency card; **Interactive Brokers** bridge (Client Portal Gateway) for real
  orders on world exchanges — listing picker, whole shares, local-currency prices, what-if preview,
  USD caps, no shorting, the same submission-time guards as Alpaca, and IBKR's precautionary questions answered by you, never automatically. Live server quotes up to 80 global stocks per
  World view (rest from the snapshot, marked).
- **1.5.2 — Updates show immediately.** The app page is fetched fresh when online (offline copy
  still used without a connection), and the app reloads itself once when a new release takes over —
  never while an order ticket or other sheet is open.
- **1.5.1 — Design refresh.** New design system (`web/design.css`): calmer dark/light palettes,
  consistent type scale, buttons, inputs, chips and left-accent notices; a single line-icon set
  (`web/icons.js`) replaces emoji across the app; icon tab bar with accent indicator; Home quick
  actions as tiles; TwinAgent report rebuilt around a verdict card, metric grid, research pipeline
  and clearer risk-gate/debate/analyst sections. No engine or data changes.
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
