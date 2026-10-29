# Twin Indonesia: product, user and launch guide

Twin Indonesia is the rupiah side of Twin (merged in Twin 1.11 from the prototype
codenamed *Satu*). It puts US stocks, Indonesian stocks, crypto and gold in one
rupiah practice wallet, with news, community rooms, licensed-analyst ideas that
are scored in public, and interactive lessons.

Open it from Twin's **Home** (the teal *Twin Indonesia* card), **Me → Twin Indonesia**,
or the *Trade … in rupiah lots* button on any Jakarta (`.JK`) stock page. The web
address is `…/projects/twin/id/`; the **Twin** logo in its top bar returns to Twin.

This guide covers:

1. [Status and a reality check](#1-status-and-a-reality-check)
2. [Using the app](#2-using-the-app)
3. [How the numbers work](#3-how-the-numbers-work)
4. [Architecture](#4-architecture)
5. [From prototype to a real product in Indonesia](#5-from-prototype-to-a-real-product-in-indonesia)
6. [Business model](#6-business-model)
7. [How Twin Indonesia can beat the incumbents](#7-how-twin-indonesia-can-beat-the-incumbents)
8. [What it shares with Twin, and what to merge next](#8-what-it-shares-with-twin-and-what-to-merge-next)
9. [Roadmap](#9-roadmap)
10. [Known limitations](#10-known-limitations)

---

## 1. Status and a reality check

**This is a working prototype, not a licensed financial service.** Trades use
practice money at real, delayed prices. Nothing connects to a broker,
exchange, bank or wallet. The analysts, their ideas and the plan prices are
demo content. Real money needs the licensed partners described in
[section 5](#5-from-prototype-to-a-real-product-in-indonesia).

**No app can promise weekly income.** Even a steady 5% a year on Rp100,000
earns about Rp96 a week:

$$
\frac{\text{Rp}100{,}000 \times 0.05}{52} \approx \text{Rp}96
$$

Anything that promises fixed daily or weekly profit is the pattern OJK warns
about, and Twin Indonesia's Scam Shield blocks exactly that language. The app is built
to teach people to compare real costs and real track records instead.

---

## 2. Using the app

### 2.1 Start

- **Start as guest:** no account, email or money. Your rupiah practice account
  lives in this browser, separate from Twin's US-dollar practice portfolio.
- **Explore a demo account** (`?demo`): a filled-in portfolio with six
  positions, an open limit order, posts and lesson progress.

### 2.2 Pick markets and set your risk profile

Choose any of the four markets (US stocks first, then IDX, crypto, gold), then
answer five questions: goal, time horizon, reaction to a 20% fall,
experience, and whether you have an emergency fund. The score sets your
guard-rails:

| Profile | Score | Max in one asset | Max in crypto |
| --- | --- | --- | --- |
| Conservative | 0–3 | 10% | 5% |
| Balanced | 4–6 | 15% | 10% |
| Growth | 7–9 | 25% | 20% |
| Aggressive | 10–12 | 35% | 30% |

Without 3–6 months of emergency savings the profile is capped at Balanced.
Guard-rails warn before a trade breaks them; you can still go ahead, and the
warning is part of the lesson. Retake the quiz any time in **Me**.

### 2.3 Home

Portfolio value with today's change and allocation by market, a **Next step**
coach (the next lesson or mission), your watchlist, the day's movers in your
markets, headlines, and community highlights. Posts hidden by Scam Shield
never appear here.

### 2.4 Markets and asset pages

- **Markets** has a tab per market with its trading status (open, lunch break,
  closed and when it reopens), the fee line and break-even move, search, and
  a star to watch each asset.
- **Asset page:** price and change, a chart (1D, 1W, 1M, 1Y, 5Y), Buy and
  Sell, your position with P/L after fees, key facts (day range, 52-week
  range, fees, volume), the licensed analysts' ideas on that asset, and the
  room discussion that mentions it.

### 2.5 Placing a practice order

The ticket shows what the trade really costs before you confirm:

- **IDX:** whole lots (1 lot = 100 shares); limit prices must sit on an IDX
  price step and **Snap to step** fixes them.
- **US, crypto, gold:** enter a rupiah amount or a quantity; US shares are
  fractional from $1 and converted at the shown USD/IDR rate.
- **Market or limit.** A marketable limit fills immediately; other limits wait
  in **Open orders** with cash reserved.
- **Closed market:** a market order queues and fills at the first price after
  the open, holding 5% extra cash in case the price moves.
- **Preview:** quantity, price, value, every fee line, what you pay or
  receive, the break-even move, and any guard-rail warnings.

Links can open the ticket directly: `?ticket=BBCA` or `?ticket=AAPL&side=sell`.

### 2.6 Portfolio

Total value against the Rp10,000,000 practice start, cash available, cash held
for orders, unrealised and realised P/L, value by market, positions, open
orders (cancel any time) and full history. **Portfolio X-ray** (Plus) shows
your US-dollar exposure (and what a 10% rupiah move does to your total), your
largest position against your limit, and your crypto share against your cap.

### 2.7 News

Headlines from Antara, CNBC Indonesia, CoinDesk, Cointelegraph and
Investing.com (gold) plus US market news, each tagged with the tickers it
mentions so asset pages show their own news. On Twin's local server every
feed arrives through `POST /api/indonesia/news` (fetched in parallel, cached for
10 minutes, failures reported per feed). Without the server the browser reads
Twin's `news.json` (US) and Antara (IDX) live, and the other feeds come from the
bundled snapshot, whose headlines the GitHub Pages job refreshes every hour
(`apps/twin/scripts/indonesia_snapshot.py --news-only`).

### 2.8 Community and Scam Shield

Five free rooms (Lobby for beginners, US stocks, Saham Indonesia, Crypto,
Gold) and three members' rooms on Plus (IDX Dividend Club, US Earnings Club,
Crypto Risk Desk). Posts support `$TICKER` links, a sentiment tag, a
**holder** badge when you own the asset, likes and reporting.

Scam Shield checks every post as you type and before it is shown:

| Rule | Action |
| --- | --- |
| Promises guaranteed or risk-free profit ("pasti cuan", "dijamin untung") | Hide |
| Promises a fixed return per day, week or month | Hide |
| Moves the conversation to a private chat or phone number | Hide |
| Sells signals or VIP groups outside the platform | Hide |
| Asks for money to be sent | Hide |
| Mentions a platform or scheme declared illegal in Indonesia | Hide |
| Hype language | Warn |

Hidden posts show why they were hidden; readers can still open them. Rooms are
for discussion; specific paid recommendations come only from licensed
analysts on the Analyst Desk.

### 2.9 Analyst Desk

- Only licensed investment advisers can publish ideas (demo profiles here).
- Each idea records direction, entry, target, stop, horizon and reasoning,
  and can never be edited or deleted.
- Every idea is scored automatically against a benchmark (IHSG for IDX, S&P 500
  for US, Bitcoin for other crypto); scorecards show ideas, win rate, average
  result and average result versus the benchmark.
- **Proof is free:** track records and closed ideas are public. **Pro** pays
  for timeliness: live (open) ideas and **Send to ticket**, which pre-fills a
  practice order that you still review and confirm yourself. Idea alerts are
  planned.

The demo analysts (Rina, Arif, Maya) are fictional and their 15 ideas were
picked with hindsight from real price history to demonstrate scoring. They
are not a real track record.

### 2.10 Academy

Nine interactive lessons in three levels. Each has short cards, a hands-on
widget and a quiz:

| Level | Lesson | Widget |
| --- | --- | --- |
| 1 Foundations | Four markets, one wallet | Match assets to markets |
| 1 | Fees and the break-even move | Round-trip fee calculator |
| 1 | IDX lots and price steps | Lot and price-step calculator |
| 1 | Scam Shield: spot investasi bodong | Scam-or-not sorter |
| 2 Building a portfolio | Compounding versus "weekly income" | Compounding slider |
| 2 | Diversifying across four markets | Allocation mixer with portfolio volatility |
| 2 | Position sizing and stop rules | Position-size calculator |
| 3 Going global | US stocks and the rupiah | FX return calculator |
| 3 | How to judge an analyst | Scorecard reader using live Analyst Desk data |

Missions are checked automatically from your practice account: set a risk
profile, place a first trade, place a limit order, buy in every market you
picked, finish the Scam Shield lesson, and post in Community. XP: 50 per
lesson, 10 per correct answer, plus mission XP; streaks count active days.

### 2.11 Plans

| Plan | Placeholder price | What it adds |
| --- | --- | --- |
| Free | Rp0 | Practice in all four markets, delayed prices and news, public rooms, every lesson, Scam Shield, analyst track records |
| Plus | Rp49,000 / month | Members' rooms, weekly live Q&A with licensed analysts, Portfolio X-ray, no ads |
| Pro | Rp149,000 / month | Analyst Desk live ideas, idea alerts, Send to ticket |

Checkout is simulated; nothing is charged. The weekly Q&A and idea alerts are
services for launch and do not work in the prototype.

### 2.12 Me and settings

Profile and markets, risk quiz, **data mode** (live delayed prices, or a
simulated market that moves every few seconds so you can practise when
markets are closed), **respect market hours**, and export, import or reset of
your practice account. The wallet lives in your browser. On Twin's local server,
signed in to a Twin account, it is also kept in that account and follows you to
other browsers (see 4.1); Settings shows when it last synced. Twin's Home card
and Me screen show the wallet's value, return, positions and cash.

---

## 3. How the numbers work

### 3.1 Fees and the break-even move

| Market | Buy | Sell | Source |
| --- | --- | --- | --- |
| IDX | 0.15% | 0.25% (0.15% fee + 0.1% final tax) | Stockbit's published retail fees |
| US | 0.5% FX spread | 0.5% FX spread | Assumption (0% commission) |
| Crypto | 0.2% | 0.3% | Assumption |
| Gold | 1% spread | 1% spread | Assumption |

Replace every assumption with the licensed partner's published schedule
before launch. With buy fee $b$ and sell fee $s$, the price must rise by

$$
\text{break-even} = \frac{1+b}{1-s} - 1
$$

before selling covers both fees:

| Market | Break-even |
| --- | --- |
| IDX | $\frac{1.0015}{0.9975} - 1 \approx 0.40\%$ |
| Crypto | $\frac{1.002}{0.997} - 1 \approx 0.50\%$ |
| US | $\frac{1.005}{0.995} - 1 \approx 1.01\%$ |
| Gold | $\frac{1.01}{0.99} - 1 \approx 2.02\%$ |

### 3.2 Market rules

- **IDX:** 1 lot = 100 shares. Price steps: Rp1 below Rp200, Rp2 to Rp500,
  Rp5 to Rp2,000, Rp10 to Rp5,000 and Rp25 above. Sessions (WIB):
  Mon–Thu 09:00–12:00 and 13:30–15:50; Fri 09:00–11:30 and 14:00–15:50.
- **US:** 09:30–16:00 New York time, Monday to Friday; fractional shares to 6
  decimals; minimum order $1.
- **Crypto and gold:** 24/7, minimum order Rp10,000; gold is priced per gram
  from the tether-gold (XAUT) price divided by 31.1035 g per troy ounce.
- Public holidays, pre-opening and pre-closing auctions are not modelled.

### 3.3 Idea scoring

For direction $d$ ($+1$ buy, $-1$ sell), entry price $P_0$, exit price $P_1$
(target or stop when hit, otherwise the latest price) and benchmark levels
$B_0$, $B_1$ over the same dates:

$$
r = d\,\frac{P_1 - P_0}{P_0}, \qquad
r_b = \frac{B_1 - B_0}{B_0}, \qquad
\text{excess} = r - r_b
$$

Win rate counts ideas with $r > 0$, including open ideas at the latest price.
The "How to judge an analyst" lesson shows why average excess return matters
more than win rate. With daily data, hit dates are approximate.

---

## 4. Architecture

```
apps/twin/web/id/   (static module inside Twin, no build step, no dependencies)
  index.html   loads Twin's theme.js, manifest and icons from ../
  engine.js    pure logic: markets, fees, hours, orders, valuation, risk,
               Scam Shield, idea scoring, missions   <- unit-tested
  app.js       views, order ticket, community, Analyst Desk, Academy,
               settings, ?selftest smoke test
  feeds.js     live data:  Twin's own ../demo/world.json, world/<chart>.json and
                           news.json (same origin, hourly), else the published copy
                           CoinGecko (crypto, gold via XAUT), Antara RSS (CORS)
                           Twin's server, when present: all news + account sync
               fallback:   snapshot.js (bundled, works offline, headlines hourly)
  content.js   analysts, rooms, seed posts, plans, lessons, guide
  storage      localStorage twin_id_state_v1 / twin_id_demo_v1 (wallet, per browser)
               twin_id_summary_v1 (read by Twin's Home and Me), twin_id_sync_v1
               (account + revision last synced), twin_id_state_backup_v1

apps/twin/web/sw.js          Twin's one service worker caches id/ with the rest of Twin;
                             id/snapshot.js is network-first so hourly headlines arrive
apps/twin/server.py          serves /id/; POST /api/indonesia/news (public),
                             /api/indonesia/wallet and /wallet/save (signed in)
apps/twin/scripts/
  indonesia_snapshot.py      rebuild web/id/snapshot.js from web/demo + CoinGecko + RSS;
                             --news-only swaps in fresh headlines (hourly Pages job)
  indonesia_ideas.py         rescore the demo Analyst Desk against that history
  indonesia_news.py          RSS parsing, UTC timestamps, ticker tagging, merging
apps/twin/tests/
  verify_indonesia.py        engine checks + app self-test in headless Chrome/Edge
  indonesia_engine_checks.html, indonesia_frame.html (phone-width screenshots)
  test_indonesia_news.py     offline parser, tagging, merge and refresh tests
  verify_api.py              server news feed (fake RSS) and wallet sync, per account
```

### 4.1 Account sync (Twin's local server)

The server keeps one copy per Twin account in `data/users/<id>/indonesia.json`
with a revision number. `POST /api/indonesia/wallet` returns the copy, its
revision and an opaque account tag; `POST /api/indonesia/wallet/save` takes
`{state, rev}` and only writes when `rev` is still the current revision,
otherwise it answers `conflict` with the newer copy. In the browser, the pure
`syncAction()` in engine.js decides what happens after each fetch:

| Situation | Action |
| --- | --- |
| The account copy changed since this browser last synced, or the browser was never linked | Load the account copy (the local one is kept in `twin_id_state_backup_v1`) |
| Same revision, but this browser has newer changes | Upload them |
| The account has no wallet yet | Upload this browser's wallet, unless it was linked to a different account, in which case start fresh |

The browser fetches when the page opens and whenever the tab becomes visible;
hidden tabs never upload, so a forgotten tab cannot overwrite trades made
elsewhere. Saves are capped at 500 KB. The demo (`?demo`) and the self-test
never sync.

Design choices: the engine is pure so the same functions can later run on a
server that talks to real partners; every view re-renders from state, so prices
can tick without breaking the ticket; all paths are relative so the module works
from a file, Twin's local server or the GitHub Pages sub-path. Internal names
(`SatuEngine`, `SATU_SNAPSHOT`, …) keep the codename so the prototype's history
stays readable; everything a user sees says Twin Indonesia.

---

## 5. From prototype to a real product in Indonesia

Twin Indonesia should be the **app layer** on top of licensed partners. It should not
hold client money or execute trades itself until it holds the relevant
licences. Checked in October 2026; regulations change, so confirm each point
with OJK, Bappebti and a licensed lawyer before launch.

### 5.1 What each market needs

| Market | Who must be licensed | Regulator | How Twin Indonesia plugs in |
| --- | --- | --- | --- |
| IDX stocks | A securities company licensed as a broker-dealer and IDX exchange member; client funds sit in a bank RDN account | OJK (capital markets), IDX, KSEI | Partner broker's API for accounts, e-KYC, orders and positions, or acquire a licensed broker |
| US stocks | Depends on the structure. Indonesian apps commonly offer derivative contracts with US-stock underlying through a licensed futures broker (for example, Pluang via PT PG Berjangka). Supervision of financial derivatives with securities underlying moved to OJK (POJK 1/2025) | OJK | Partner with a licensed provider; confirm the structure with OJK |
| Crypto | An OJK-licensed digital financial asset trader (PAKD) under POJK 27/2024, amended by POJK 23/2025. OJK took over crypto supervision from Bappebti on 10 January 2025, and the two closed the transition period in 2026 | OJK | Partner with a licensed PAKD; list only assets the exchange may trade |
| Digital gold | Physical gold traded on digital platforms through a futures exchange stays under Bappebti (Perba 3/2025). Bullion services by financial institutions fall under OJK (POJK 17/2024) | Bappebti or OJK, depending on structure | Partner with a registered gold provider |

### 5.2 Paid communities and "recommended moves"

- Paid advice on specific securities requires an OJK **investment adviser**
  (Penasihat Investasi) licence, for the adviser or the company publishing it.
  OJK tightened rules for financial influencers in 2026 and has fined
  social-media promoters, so unlicensed paid signal groups are a direct
  regulatory risk.
- Twin Indonesia's answer is built into the product: only verified licensed advisers
  publish ideas, every idea is scored in public, rooms are discussion-only,
  and Scam Shield removes paid-signal and guaranteed-profit posts.
- Before launch: verify every adviser's licence against OJK's register, keep
  an audit log of ideas, and get legal advice on revenue sharing with
  advisers and on any crypto "signals" (crypto falls under a different
  OJK framework).

### 5.3 Other obligations

- **e-KYC, AML and suitability:** done by the licensed partner; Twin Indonesia's risk
  quiz can feed the partner's suitability test.
- **Personal data:** Law 27/2022 on Personal Data Protection (in full effect
  since October 2024): consent, purpose limits, breach notification, and a
  data-protection officer when processing at scale.
- **Payments:** subscriptions sold inside mobile apps generally go through the
  app store's billing, which takes a commission; on the web, use a licensed
  payment gateway.
- **Data and content licences:** real-time and delayed IDX data for commercial
  display needs a licence (via IDX or a licensed vendor); US data comes
  through the partner or a vendor; news needs agreements with each publisher.
  The prototype's sources (Yahoo via Twin, CoinGecko's free API, RSS) are fine
  for a demo, not for a commercial product.
- **Consumer protection:** clear fee disclosure (the ticket already shows it),
  complaint handling, and no promises of returns in marketing.

### 5.4 Integration plan

1. Keep `engine.js` as the single source of rules; move order handling behind
   a server that calls partner APIs.
2. Replace the practice fill with partner order routing; keep the same ticket
   and preview so users see identical numbers in practice and for real.
3. Read positions and balances from the partner; derive **holder** badges
   from verified positions.
4. Keep practice mode forever: it is the onboarding path and the learning lab.

---

## 6. Business model

| Revenue line | How |
| --- | --- |
| Subscriptions | Plus and Pro (prices above are placeholders to test) |
| Partner revenue | Share of commissions or spreads from licensed partners once real trading is live, under written agreements |
| Analyst marketplace | Pro revenue shared with licensed advisers, weighted by subscribers and by scored performance |

Illustration with assumed numbers, not a forecast: with 100,000 monthly
users, 3% on Plus and 0.5% on Pro,

$$
100{,}000 \times 0.03 \times \text{Rp}49{,}000 + 100{,}000 \times 0.005 \times \text{Rp}149{,}000 = \text{Rp}221.5\ \text{million per month}
$$

before app-store commission, adviser revenue share, data and news licences,
partner fees, moderation and support.

---

## 7. How Twin Indonesia can beat the incumbents

### 7.1 The field (October 2026, verify before quoting)

| App | Strength | Gap Twin Indonesia targets |
| --- | --- | --- |
| Stockbit | IDX trading plus the largest stock community | Community claims are unverified; little US/crypto/gold in one place |
| Pluang | Already multi-asset: US stocks (derivatives), IDX, crypto, gold, mutual funds | Thin community and no public, scored analyst records |
| Ajaib | Large user base, IDX and other products | Same trust gap in social content |
| Gotrade | Simple fractional US shares from $1 | US-only |
| Bibit | Mutual funds and robo-advice | Not for active learning or community |
| Reku, Nanovest | Crypto and US stocks | Narrow market coverage |

Being multi-asset alone does not win (Pluang already is). Twin Indonesia should win on
**trust and learning**.

### 7.2 Differentiators

| # | Idea | Why it wins | In the prototype |
| --- | --- | --- | --- |
| 1 | **Receipts, not screenshots.** Every recommendation is timestamped, scored against a benchmark and never deletable | Kills "pom-pom" and cherry-picked wins; users pay for timeliness, not hope | Yes (Analyst Desk) |
| 2 | **Licensed-only paid advice** with licence badges checked against OJK's register; adviser payouts weighted by scored results, not follower counts | Turns 2026's stricter influencer rules into a moat | Demo badges |
| 3 | **Scam Shield in Bahasa slang** ("pasti cuan", "profit 5% per hari", DM/Telegram, transfer requests, illegal platforms) | Protects beginners where scams recruit them | Yes |
| 4 | **True-cost ticket:** every fee, FX spread and the break-even move before you tap | Builds trust and cuts complaints | Yes |
| 5 | **Guard-rails from your risk profile:** concentration and crypto caps as warnings, not blocks | Fewer blow-ups means users stay longer | Yes |
| 6 | **Practice-first graduation:** everyone starts with practice money; real trading unlocks after core lessons and a few practice trades | Better-prepared users for partners; a natural suitability step | Practice yes; gate planned |
| 7 | **One rupiah wallet across four markets** with a cross-market X-ray (USD exposure, concentration, crypto share) | Answers "what do I actually own?" in one screen | Yes (practice) |
| 8 | **Learn by doing:** lessons with calculators and quizzes, missions checked from your own account | Learning that changes behaviour, not videos | Yes; spaced repetition planned |
| 9 | **Honest goal planner:** thousands of simulated futures show the odds of reaching a goal (from Twin) | Replaces "cuan" promises with probabilities | Planned |
| 10 | **Bahasa-first, sharia filter, IDX dividend and corporate-action calendar** | Fits the core Indonesian retail audience | Planned |
| 11 | **Verified holder voices:** holder badges from real positions; members' rooms for subscribers | Raises the quality of discussion | Demo |
| 12 | **Light PWA:** works offline from a snapshot, fast on low-end Android | Reaches users outside big cities | Yes |

### 7.3 What Twin Indonesia should refuse to do

Sell unlicensed signals, auto-copy trades for beginners, offer leverage to new
users, market "weekly income", or hide losing calls. Each of these grows
faster in the short run and destroys the trust that is Twin Indonesia's whole edge.

### 7.4 Go-to-market wedge

Start with practice mode, Scam Shield and the Academy (no licence needed for
education and practice), seed rooms with licensed advisers whose records are
public from day one, run campus and first-job programmes, and reward learning
milestones rather than deposits in referrals. Add real trading market by
market as partner agreements close.

---

## 8. What it shares with Twin, and what to merge next

| Area | Shared since 1.11 | Merge next |
| --- | --- | --- |
| Market data | Twin's hourly `world.json` (US + the same 19 Jakarta stocks, USD/IDR), chart files and `news.json`, read same-origin | One price service for both wallets |
| Shell | Twin's theme switch, icons, manifest and service worker (one offline cache) | Shared tab bar and search |
| Entry points | Home card, Me card, *Trade in rupiah lots* on `.JK` stock pages | Deep links back from Twin Indonesia asset pages to Twin research |
| Accounts | Since 1.12 a Twin account on the local server keeps the rupiah wallet; Home and Me show its summary | One ledger for the rupiah and USD wallets |
| Research | Analyst Desk scoring, Scam Shield and community rooms (Twin Indonesia only) | TwinAgent reports, Strategy Lab and the 10,000-futures goal planner on IDX, crypto and gold |
| Real orders | None (practice only) | Twin's Alpaca/IBKR adapters as the template for licensed Indonesian partners |

Other juw12 apps worth porting: guangyao (SM-2 spaced repetition for lesson
review), peers (moderation queue, subscriber rooms) and house-of-articles
(article pages and the market feed).

---

## 9. Roadmap

| Phase | Scope |
| --- | --- |
| 0. Prototype (now) | Twin Indonesia inside Twin 1.12: practice trading in four markets, news, rooms, Analyst Desk, Academy, plans; account sync on Twin's own server |
| 1. Beta (0–3 months) | Bahasa Indonesia UI, accounts and cloud sync, price and idea alerts, Twin's goal planner, SM-2 reviews, sharia filter, closed beta with practice money; engage counsel and shortlist partners |
| 2. Partners (3–9 months) | IDX broker, crypto PAKD, gold provider and a US structure; partner e-KYC; real orders through the same ticket; data and news licences |
| 3. Marketplace | Verified licensed advisers, Pro launch, holder badges from real positions, moderation team and complaint handling |
| 4. Scale | Dividend and corporate-action calendars, tax reports, family and goal accounts, more markets |

---

## 10. Known limitations

- Practice only: fills at the last price, no slippage or partial fills, no
  holidays or auctions.
- Data is delayed and unofficial (Yahoo Finance via Twin, CoinGecko's free
  API); gold is derived from XAUT; US, crypto and gold fees are assumptions.
- Community posts are stored locally; there is no multi-user backend, login or
  moderation team yet.
- Without Twin's server (GitHub Pages), CNBC Indonesia, CoinDesk, Cointelegraph and
  Investing.com headlines are at most an hour old (snapshot refresh), not live.
- The rupiah wallet is separate from Twin's USD portfolio. Account sync needs
  Twin's local server and a Twin login; on GitHub Pages the wallet stays in the
  browser. Edits made at the same moment on two visible devices resolve to the
  account copy (the other is kept as a local backup, not merged).
- English UI only; no security audit has been done.
- Demo analysts are fictional and their ideas were picked with hindsight.
