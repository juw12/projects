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

It only reads prices. It has no order code. It never changes the rules or the size of a buy.

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
- Version bump, README, merge, then copy `bridge.py` + `learn.py` to the run folder and restart
  the sender from the desk app (no console window).

If any gate fails: change nothing, keep watching. "Keep the rules" is a good result.

## What must not be done

- No automatic rule or size change, however good a replay looks.
- No shorter candles "to trade more": tested, more trades only paid more fees
  (15 min about -Rp87.000 a year, 1 hour about -Rp14.700, 4 hours about +Rp4.600 at Rp20.000 per buy).
- No removing the stop, no averaging down, no martingale, no leverage.
- No adding versions to the family until one wins: more versions tried means more luck mistaken
  for skill. Widen the family only together with a longer unseen test.
