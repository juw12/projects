# The TradeBot desk, in plain words

This is the small guide that goes with the desk window. It is for reading, not for setting
anything up: the setup is in [README.md](README.md). Nothing here places an order.

## What the window is

One window that runs the Indodax sender (the part that copies TradeBot's coins at Indodax) and
shows everything it does: real or practice, the free rupiah, what is held, the price now, what
the rules need before a buy, the finished trades, the result, and the sender's own lines. It
never orders by itself: orders are placed by the sender, from the rules, and the window only
looks and switches pause on and off.

Open it with `open-desk.cmd` (it uses `TradeBot.exe` when that file is in the folder) or, with
Python installed, `pythonw desk.py`. `pythonw desk.py --demo` opens the same window with made-up
numbers: no account, no network, nothing private. That is the way to look around, or to take a
picture of it.

## The five tabs, in one line each

- **Overview** — what happens next, the three checks per coin, the coins held, the price now,
  the finished trades, and the trading words in plain words.
- **Agents** — the one bot shown as a desk of six roles that look one after the other: research
  analyst, market analyst, strategist, risk manager, execution trader, desk lead. Click a role
  to read its numbers. Beside it: the chart (candles, EMA 20/50/200, SMA 200, RSI 14, the plan's
  three prices, a mark at every buy and sale), the live feed, the trades, and the analysis.
- **Study** — the score from 0 to 10 for how far the rules are proven, and what is still being
  collected.
- **Full report** — the same text as `/report` in Telegram.
- **Sender log** — the sender's own lines, what the console window used to show.

## The desk lead's calls, marked later

The desk lead is the last of the six: one call that follows from the other five. Under its lines
the window keeps a log of those calls, and marks each one later against what the price did:

```
✓ 17 Nov 13:42 WIB
  SELL BTC at 1.232,0 jt
  1h +0,4% · 4h -1,2%
  right: the price fell 1,2% 4 hours later
```

Line by line: when the call was made, what it was (buy, hold, sell or standing aside) and the
price at Indodax at that moment, what the same price did 1, 4 and 24 hours later, and the mark.

The four calls it writes down:

| The desk lead says | Means | Written down as |
|---|---|---|
| Buy BTC at the next check | the checks pass and there is room for a buy | BUY |
| Hold BTC: let it run | a coin is held and still passes | HOLD |
| Sell BTC at the next check | a check failed: it is sold at the next check | SELL |
| Wait: no buy now | the checks are not met: nothing is bought | WAIT |

A stopped sender, a paused buy, a safety stop or "no fresh signal" is about this PC, not about
the price, so it is not a call and is not written down. Repeating the same call does not add a
line; a call that changes inside five minutes is treated as one call, so the log stays readable.

### How a call is marked

- **When:** at the **4-hour mark**, the candle the rules work on. The 1-hour and 24-hour marks
  are shown next to it as what the price did, but the mark itself is the 4-hour one.
- **Against:** the price at Indodax at the moment of the call, against the price at the mark.
- **BUY or HOLD:** right when the price rose by more than **0,6%** (what a round trip at Indodax
  costs, about 0,3% each way), wrong when it fell that far.
- **SELL:** right when the price fell that far, wrong when it rose that far.
- **WAIT:** right when the price did not rise that far (not buying cost nothing), wrong when it
  rose past the cost and the buy was skipped.
- **Flat:** a move smaller than 0,6% is called flat: it is neither a win nor a loss, because the
  fees would have eaten it.
- **Not seen:** if the window was closed at the mark, the log says so instead of pretending it
  saw the price then, and the next mark that was really seen is used instead. Since 0.17.1 a mark
  like that is read out of the candle of that hour on the chart the window already holds, and the
  line says "(from the candle)". A candle longer than the mark is never used for it (a 1-hour mark
  is read from 15-minute or 1-hour candles, never a day), and a mark the window did see is never
  overwritten. Only when no candle reaches that hour does it stay "not seen".
- **Open:** the 4-hour mark has not come yet.

At the top of the list a tally says how the whole log stands, for example "5 calls: 3 right, 1
flat, 1 open." The newest 200 calls are kept, in `decisions.json` in the folder next to the app.

### What it does not do

- It places no order and it changes no rule. The bot buys and sells by its three checks alone,
  exactly as it did before this log existed; the log only writes down what was said and what the
  price did after.
- It is not a win rate and not a promise: a few calls can be luck, and a past move says nothing
  about the next one.
- It only knows the hours the window was open. A laptop that sleeps loses the live look at a mark,
  so the log reads that hour out of the chart's own candle instead and says so; only an hour with
  no candle either stays "not seen".

## If something looks wrong

- A red or yellow line at the top of the window says what needs you: sender stopped, safety
  stop, key not checked, buying paused, the sender silent, too little rupiah for one buy,
  TradeBot not answering.
- `pythonw desk.py --demo` shows the same window with made-up numbers: if the demo looks right
  and the real one does not, the sender's lines (last tab) are the place to look.
- The decision log is a plain JSON file: `decisions.json` in the folder, safe to read, safe to
  delete (an empty log is made again at the next look).
