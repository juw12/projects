---
name: tradebot-learn
description: TradeBot's self-study loop for the Indodax real-money rules - read /learn and learn.json, run the study by hand, judge a "review" verdict, and promote a better version of the rules safely (by hand, with tests, never automatically). Use when Juwen asks "what did the bot learn", "improve the win rate", "make the bot smarter", "is the strategy still good", "self-study", "learn", "belajar", "simulation", or when Telegram says "another version has earned a review".
---

# TradeBot self-study (tradebot-learn)

The sender on the PC studies its own rules every 4 hours and after each buy or sale
(`apps/tradebot/indodax/learn.py`, started by `bridge.py`). This skill is what an agent does with
the result: before a trade, after a trade, when idle, and when asked to "make it better".

## The one rule that is never broken

**Do not promise a win rate, and do not chase one.** A share of winning trades near 100% is
reached only by keeping losing trades open (no stop, averaging down, martingale); one of those
ends a Rp50.000 account. The measure here is: **more rupiah after costs, on prices the rules have
not seen, with a dip the account survives.** Say this plainly whenever 100% / 99.9% comes up.
Every figure is a test on past prices: "not a promise".

## What the study does (each run, about 15 seconds)

1. **Replay**: the live rules on every 4-hour candle since March 2020 (signals Binance BTC/USDT,
   buys and sales at Indodax BTC/IDR, costs taken off).
2. **Unseen prices**: 81 nearby versions are replayed. For each half year, the best version of
   the 3 years before is picked and judged only on that half year.
3. **Real cost**: each finished real trade against Indodax's 1-minute price. From 5 real trades
   on, the replay uses the measured cost instead of the assumed 0.9%.
4. **Verdict**: `keep`, `watch` (another version leads; followed on paper from that day) or
   `review` (it stayed ahead 90 days and 8 trades, and picking by the past won on unseen half
   years). Telegram gets one message at `review`.

5. **Score**: one number, 0 to 10, for how far the rules are proven. Four measured parts:
   unseen prices (3: a year's gain on unseen prices of 30% of one buy is full marks), steady
   years (2: 90 of 100 twelve-month spans with a gain; 50 gives nothing), dips (2: a year's gain
   of twice the deepest dip), real money (3: half for 30 finished real trades, half for an
   average of +0.5% a trade after costs). One point a day is kept as the curve.

6. **Ideas on paper**: sell at 1:3 (fixed stop, sold at the stop or at 3 times the risk),
   top-down (buy only while the daily chart is up too) and both together are replayed next to
   the rules and followed as pretend trades from 17 November 2026. They never trade and never
   touch the verdict. Test of November 2026 at Rp20.000 per buy: rules +Rp4.602 a year, dip
   -Rp11.976, 213 trades; sell at 1:3 +Rp7.378, dip -Rp15.724, 91 trades; top-down +Rp4.355,
   dip -Rp7.862, 148 trades; both +Rp7.067, dip -Rp8.507, 64 trades.

It only reads prices. It has no order code. It never changes the rules or the size of a buy.

## The score: how to say it, and how it may rise

- Say it as "proven X of 10", never as a win rate, a grade of cleverness or a forecast. New rules
  with no finished real trade sit near 2 or 3: that reads "not proven yet", not "bad".
- It rises only by measured things: finished real trades and what they made after costs, a
  longer or better record on unseen prices, a smaller dip. That takes weeks and months.
- **Never raise it by changing the scale.** The weights and full-mark levels are frozen as
  `SCORE_VERSION` in `learn.py`. A real reason to change them means a new version number and a
  new curve, said plainly to Juwen. Do not tune the rules to the score either: that is fitting
  the past. A rule change still goes through "Promoting a version" below.
- Where it shows: the Study tab of the desk app (`TradeBot.exe`), `/learn` in Telegram, the phone
  page and the full report. In `learn.json`: `summary.score` (`total`, `parts`, `realTrades`)
  and `summary.curve` (the newest 60 points); the whole curve is `curve` at the top of the file.

## Daily routine for the agent

| When | Do | Look for |
|---|---|---|
| Before acting on anything | Telegram `/learn`, or read `learn.json` in the run folder | study younger than 12 hours; verdict |
| After a real buy or sale | wait one minute, `/learn` again | "Real cost" line now counts that trade |
| Idle | nothing: the sender studies by itself | `desk_sender.log` shows "Studying the rules" every 4 hours |
| Study is old (over 12 hours) | PC was off or the network blocked it: run it by hand (below) | exit code 0 |
| Verdict `review` | follow "Promoting a version" below | never skip a gate |

Run by hand (run folder: `E:\Projects\tradebot-indodax-run`; it needs the office proxy from `.env`):

```
python learn.py             # reads the newest candles, writes learn.json, prints the summary
python learn.py --offline   # saved candles only, no network
```

Never print or copy `.env`, `bridge_state.json`, keys, the Indodax email or the exact balance.

## Reading `learn.json`

- `summary`: what Telegram shows. `perYear` and `dip` are rupiah at the current buy size;
  `wins`, `yearUp`, `monthUp` are "of 100"; `unseen.live` vs `unseen.picked` is rupiah over all
  unseen half years; `cost.used` says whether the replay ran on the assumed or the measured cost.
- `watched`: the version followed on paper and the day it started.
- `summary.ideas`: one row per idea (`trades`, `wins`, `perYear`, `dip`, `unseen`, and `since`:
  pretend trades and rupiah ahead of the rules from the day it was written down). The desk's
  Agents tab shows them under Research analyst. The Worker does not carry them.
- `windows`: one row per unseen half year (which version was picked, what it and the live rules made).
- `measured`: per real trade, how much worse than Indodax's price the buy and the sale were, in percent.

## Promoting a version (only after `review`, only by hand)

Gates, all of them:

1. Verdict is `review` on a study younger than 12 hours.
2. `unseen.picked` is above `unseen.live`, and the watched version's deepest dip is not deeper
   than the live rules' dip (replay it with `learn.replay` + `learn.copy_trades`).
3. No real position is open (`/holding`). Never change rules under an open trade.
4. Juwen has been told in plain words what changes and what the test gave. Real money: at most
   his Rp50.000, low risk first; the buy size is not raised in the same change.

Then, in a git worktree (never the main checkout), one PR:

- `apps/tradebot/src/strategy.js`: `PARAMS` (the rules the Worker trades by).
- `apps/tradebot/indodax/learn.py`: `LIVE` (must equal `PARAMS`).
- `apps/tradebot/tools/plan_backtest.py`: the same constants; run it and put its new figures
  into `PLAN` in `apps/tradebot/src/indodax.js` (the `/plan` ranges).
- Tests: `npm test` in `apps/tradebot`, `python -m unittest` in `apps/tradebot/indodax`.
- Version bump, README, merge, then update the desk app in the run folder (close it while no coin is
  held, run `update-desk.cmd`; it restarts the sender inside the app, no console window).

If any gate fails: change nothing, keep watching. "Keep the rules" is a good result.

An idea (`summary.ideas`) passes the same gates before it may trade: `since.days` at least 90,
`since.trades` at least 8, `since.lead` above 0, its `unseen` above the rules' `unseen.live`,
and its `dip` not deeper than the rules' `dip`. A fixed 1:3 sale means new sell code in
`src/strategy.js` and `bridge.py` with tests, not a number change: plan it as its own PR.

## What must not be done

- No automatic rule or size change, however good a replay looks.
- No shorter candles "to trade more": tested, more trades only paid more fees
  (15 min about -Rp87.000 a year, 1 hour about -Rp14.700, 4 hours about +Rp4.600 at Rp20.000 per buy).
- No removing the stop, no averaging down, no martingale, no leverage.
- No adding versions to the family until one wins: more versions tried means more luck mistaken
  for skill. Widen the family only together with a longer unseen test.
