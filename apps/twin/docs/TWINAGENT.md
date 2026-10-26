# TwinAgent

TwinAgent is Twin's research team: five analysts, a bull-vs-bear debate, a portfolio manager
and a risk gate driven by your own limits. It runs in the browser (web demo and installed
app) or against live data on your Twin server. It needs no AI subscription, and the same
evidence always produces the same report.

Open it from **Trade → 🤖 TwinAgent**, the **🤖 TwinAgent research report** button on any
stock page, or **Ask TwinAgent's research team** on Home.

## Pipeline

| Step | What it does | Evidence |
| --- | --- | --- |
| Trend analyst (35%) | Price vs ~10-month average, 12-1 month momentum, 3-month momentum, 6-month return vs SPY | Daily closes |
| Fundamentals analyst (25%) | Revenue growth, EPS growth, net margin, operating-margin change vs a year earlier | SEC XBRL company facts, **usable only from each quarter's filing date** |
| Risk analyst (15%) | Annualized volatility, drop from 1-year high | Daily closes |
| News analyst (15%) | Headline tone over 7 days after **relevance screening** (ticker or company name must appear); question headlines count half | Yahoo Finance RSS |
| 13F holdings analyst (10%) | Weight in tracked famous investors' top-10 portfolios and their latest quarter-on-quarter changes | SEC 13F-HR filings (filed date, quarter end) |
| Bull vs bear | Top three positive and negative evidence items, each with a rebuttal from a *different* analyst | The analysts' cited signals |
| Portfolio manager | Weighted score on −1…+1 → Buy / Overweight / Hold / Underweight / Sell; confidence from strength × coverage × agreement | — |
| Risk gate | Your risk level's volatility limit, max loss per trade, position cap and cash buffer size or block the idea | Your profile and practice portfolio |

Each signal maps a measured value to a score with a published rule (shown on hover in the app
and in the copied report). Weights and rules are fixed in advance and identical for every
ticker; nothing is fitted to the stock being analysed.

**Abstention, not guessing.** An analyst whose evidence is missing, stale (filing over 200 days
old, 13F quarter over 200 days old) or too thin (fewer than two relevant headlines) abstains and
its weight is removed. With less than 50% of the evidence weight, or no price evidence, the
manager returns **No call** and the risk gate refuses to size anything.

**Point-in-time.** Every input is filtered to the analysis time before any calculation. Items
published later are dropped without being counted, so even their existence cannot leak into the
report. Tests change future prices, filings, headlines and monthly returns and assert the report
is byte-for-byte unchanged.

**Data quality.** Extreme reported figures (EPS growth above 150%, net margin above 60%,
revenue growth above 100%) usually mean one-off items. They are flagged, earnings signals are
capped and confidence is halved.

**Never trades.** A positive verdict can only open the practice ticket pre-filled with an amount,
stop-loss and take-profit for you to check and confirm. The stop sits 2.5× the average daily move
below the price; the take-profit uses your minimum reward:risk. Gaps can fill worse than a stop.

## Walk-forward scorecard

Only the price evidence can be replayed historically (headlines, filings and 13Fs are not archived
month by month). The same trend and risk rules run on monthly total-return history with
calendar-equivalent windows. At each month end the rating sets the next month's exposure
(Buy 100%, Overweight 75%, Hold 50%, Underweight 25%, Sell 0%), charging 10 bps per unit of
turnover. It is compared with buy-and-hold and with a constant exposure equal to TwinAgent's own
average exposure, so lower risk is not mistaken for skill. The scorecard also splits history into
halves and tests whether bullish months were followed by better returns than bearish months.

Bundled snapshot results (monthly data to 2026-08):

| Ticker | Period | TwinAgent CAGR | Buy & hold CAGR | Same-exposure CAGR | TwinAgent worst drop | Buy & hold worst drop | Return/risk (TA / B&H) | Bull−bear t |
|---|---|---|---|---|---|---|---|---|
| SPY | 1994-02–2026-08 | 9.3% | 10.9% | 8.7% | -28% | -51% | 0.89 / 0.77 | 0.59 |
| QQQ | 2000-04–2026-08 | 9.8% | 8.8% | 7.0% | -30% | -80% | 0.76 / 0.49 | 1.78 |
| VTI | 2002-07–2026-08 | 9.1% | 11.4% | 8.9% | -18% | -51% | 0.93 / 0.79 | 0.08 |
| AGG | 2004-10–2026-08 | 1.9% | 2.8% | 1.8% | -11% | -17% | 0.68 / 0.65 | — |
| GLD | 2005-12–2026-08 | 8.0% | 10.1% | 7.6% | -33% | -43% | 0.62 / 0.64 | -0.61 |
| AAPL | 1986-02–2026-08 | 15.3% | 22.6% | 16.9% | -81% | -80% | 0.63 / 0.71 | -0.04 |
| MSFT | 1987-04–2026-08 | 16.1% | 21.8% | 16.8% | -61% | -67% | 0.75 / 0.79 | -0.21 |
| NVDA | 2000-02–2026-08 | 30.4% | 32.8% | 25.4% | -52% | -87% | 0.88 / 0.78 | 0.98 |
| TSLA | 2011-07–2026-08 | 23.3% | 41.3% | 28.0% | -53% | -68% | 0.63 / 0.84 | -0.41 |
| AMZN | 1998-06–2026-08 | 19.8% | 22.4% | 17.5% | -57% | -93% | 0.71 / 0.66 | 0.38 |
| KO | 1986-02–2026-08 | 8.3% | 12.4% | 9.3% | -57% | -50% | 0.60 / 0.69 | -0.63 |
| JPM | 1986-02–2026-08 | 6.7% | 11.7% | 8.9% | -65% | -73% | 0.44 / 0.51 | -1.06 |

**What this shows:** a smaller worst drop than buy-and-hold for 10 of 12 tickers and higher
return per unit of risk for 6 of 12, but higher growth for only 1 of 12. No ticker showed a
statistically reliable difference between bullish and bearish months (|t| < 2 everywhere).
TwinAgent therefore presents the price evidence as a **risk lens, not a forecast**, and says so
in every report. The 12 tickers are the ones bundled with the demo, not a random sample, and
past results do not predict future ones.

## Journal and track record

Every call is saved on the device with its evidence fingerprint (once per distinct evidence set).
The journal later scores each directional call against SPY from the first close **after** the
call over 21 sessions (provisional before that; pending with fewer than 5 sessions). Hold and
No call are not scored. The hit rate shows its sample size and warns below 20 calls.

## TwinAgent vs TradingAgents

[TradingAgents](https://github.com/TauricResearch/TradingAgents) is an open-source LLM framework
with specialist analysts, a bull/bear debate, a trader, a risk team and a portfolio manager.

| | TwinAgent | TradingAgents |
| --- | --- | --- |
| Cost per run | Free, runs in the browser | LLM API usage per run |
| Same input → same answer | Yes, fingerprinted and tested | No (model sampling) |
| Every number cites a dated source | Yes | Prose reports |
| Future data blocked | Every input filtered by as-of time; leak tests | Point-in-time controls added in recent releases |
| Historical test | Decades of monthly walk-forward per ticker in milliseconds | Ticker/date grid; one LLM run per cell |
| Your limits enforced | Deterministic gate sizes or blocks | LLM risk discussion and manager decision |
| Reads full articles, nuance, sarcasm | No (transparent word list on headlines) | Yes (LLM) |
| Fundamentals depth | Headline growth and margins from filings | Broader LLM-read statements and reports |
| Where it runs | Phone PWA, offline demo, practice account | Python CLI / package |

TwinAgent is stronger on cost, repeatability, verifiability, historical evaluation and enforced
risk; TradingAgents is stronger at reading unstructured text and broad qualitative reasoning.
Neither has demonstrated reliably market-beating returns.

## Files and tests

- `web/twinagent.js` (engine, pure and deterministic), `web/twinagent-ui.js` (screens)
- `server.py` → `POST /api/twinagent/evidence` (each source fails independently and is reported)
- `web/demo.js` → offline evidence from the dated snapshot; `web/demo/fundamentals.json` from
  `scripts/twinagent_snapshot.py` (`--check` validates filing dates)
- `tests/twinagent.test.js` (engine), `tests/test_twinagent_server.py` (endpoint),
  `tests/test_js_engines.py` (runs the Node suites in CI), `tests/browser_checks.html` (real UI)

Research and education only. Not investment advice.
