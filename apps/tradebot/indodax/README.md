# TradeBot's Indodax sender (practice by default)

Indodax turns away requests that come from TradeBot's server, so an order for Indodax has to leave
from a PC. This small program is that PC side. Once a minute it asks TradeBot which coins the
practice account holds, and holds a small copy of the same coins on Indodax's rupiah markets.

**What it is, plainly**

- **Practice is the default.** Fills are worked out from Indodax's real prices and fee, with
  pretend money. In practice mode no order is sent and the private API is not touched at all.
- **Real money is off until you switch it on yourself**, with three things together (see
  [Real money](#real-money)). Nobody else can do that for you, and the tests cover the gate.
- **No real order has been sent yet.** The 123 tests run against a pretend exchange. Against the
  real Indodax, the public prices and one balance read with a real key (Trade API 2.0) have
  worked. Placing an order, looking it up and reading its trades have not run for real: the first
  real order is the first true test of those. Start with `-Show`, and keep the first order small.
- **No proven edge, and no promised win rate.** Copying TradeBot's rules to Indodax does not make
  them better. Some copies will lose. Practice mode is the right place to find out how many.

## Set it up

1. Install Python 3.9 or newer. Nothing else to install: the sender uses only what comes with it.
2. Ask TradeBot's server for the sender's key, once (owner only; the setup code is TradeBot's):

   ```
   curl -X POST https://trade-bot.juw12.workers.dev/v1/indodax/setup -H "X-Setup-Code: <setup code>"
   ```

   The answer holds `bridgeKey`, shown once. For a new key later, send
   `-H "Content-Type: application/json" -d "{\"newKey\": true}"` too; the old key stops working.
3. Copy `.env.example` to `.env` and put the key in `INDODAX_BRIDGE_KEY`.
4. Look first, then run:

   ```
   .\run-windows.ps1 -Show     # what it would do: no orders, no report
   .\run-windows.ps1           # keep copying in practice, one cycle a minute
   ```

`/indodax` in TradeBot's Telegram chat then shows the copies: what is open, what was closed, the
result so far, and what the sender last said. Practice and real money are always labelled. The
same chat can pause the buying, see [Control from Telegram](#control-from-telegram).

## Control from Telegram

| You send | What happens |
|---|---|
| `/indodax` | the copies, the mode, whether buying is paused, and how old the numbers are |
| `/indodax pause` | no new buys, in practice and with real money |
| `/indodax resume` | buys are allowed again |

- **Pause only stops buying.** Open copies are still sold when TradeBot sells or when the
  sender's own stop is reached. Pause is not "sell everything".
- **It takes up to a minute.** The sender reads the pause on its next cycle, so it only works
  while the sender is running and can reach TradeBot.
- **Only the exact command counts.** A misspelling, or the words without the slash, is answered
  with "did you mean" and nothing is changed.
- **Telegram cannot switch real money on,** change the order size, or sell a copy by hand. Those
  stay in `.env` on the PC and at Indodax.

**When the sender goes quiet.** With real money in play (real mode, or a real copy still open),
TradeBot sends one Telegram message when the sender has not reported for about 10 to 15 minutes,
because the stop is not watching while the PC is off. It sends one more when the sender is back.
In practice mode nothing is sent; `/indodax` shows how old the numbers are. The check runs with
TradeBot's own five-minute round, so it is not to the minute.

## What one cycle does

1. Asks TradeBot which coins the practice account holds (`GET /v1/indodax/signals`).
2. Reads Indodax's pair list and prices (public data, no key).
3. Sells its own copies that TradeBot no longer holds, or that fell to the sender's own stop.
4. Buys one copy, of the fixed rupiah size, of each held coin it has not copied yet.
5. Posts what the copies look like (`POST /v1/indodax/report`).

When TradeBot's numbers are old or cannot be read, nothing is bought that minute. Open copies are
still watched by the sender's own stop.

It does not buy when: the coin has no rupiah market at Indodax, the market is in maintenance, the
buyers and sellers are more than 0.5% apart, the order size is under twice Indodax's smallest
order, the most copies allowed are open, ten buys were made that day, or the day's loss has
reached one order's size. The day starts again at 07:00 Jakarta time.

## Settings (`.env`)

| Name | What it does |
|---|---|
| `INDODAX_BRIDGE_KEY` | the key from the setup. Empty means the sender is off |
| `INDODAX_ORDER_IDR` | one order in whole rupiah, 20000 to 500000 (default 50000) |
| `INDODAX_MAX_OPEN` | most copies open at once, 1 to 3 (default 2) |
| `INDODAX_STOP_PERCENT` | the sender's own stop, 1 to 20 percent below the price paid (default 8) |
| `INDODAX_COINS` | only copy these coins, such as `btc,eth` (default: all that Indodax trades in rupiah) |
| `INDODAX_BRIDGE_URL` | TradeBot's server, https only (default is the public one) |
| `HTTPS_PROXY` | a proxy for the calls to TradeBot and Indodax. If the PC also has its own `HTTPS_PROXY`, that one is used first and this one is the spare: when the first is down the sender, the window and the study change to the other by themselves |
| `INDODAX_API_KEY`, `INDODAX_API_SECRET` | your Indodax API key. Not needed for practice |
| `INDODAX_API_VERSION` | `2` (default) for keys made now, `1` for a key made for the older Trade API |
| `INDODAX_MODE` | `practice` (default) or `real` |
| `INDODAX_REAL_CONFIRM` | the confirm sentence for real money, see below |

A money setting outside its range stops the sender with a message. It is never quietly changed.

## Good to know

- **It only sells what it bought.** A sale is never larger than the copy, and never larger than
  what is free in the account.
- **It keeps only balances.** Indodax's answer to "what do I hold" also carries your name, email,
  user id and deposit addresses. They are dropped at once: never stored, printed or sent. Your
  rupiah balance is not sent to TradeBot either; only `-Check` prints it, on your own screen.
- **The size is not TradeBot's size.** Every copy is the fixed rupiah amount, whatever the practice
  account bought. The results will not match the practice book.
- **A late start buys late.** If the practice account bought yesterday and the sender starts today,
  it buys at today's price.
- **One buy per signal.** After a copy is closed (by the stop, or by hand), the coin is not bought
  again until TradeBot gives a new buy signal for it.
- **Fees are counted, tax and other charges are not.** Practice results use the taker fee from
  Indodax's pair list (0.3% when the list names none, an assumption). Indonesian crypto tax and
  any other charge on a real trade are not modelled, so real results will be a little worse.
- **Stopping it** (Ctrl+C) leaves the copies as they are.
- **At an office, ask first.** The sender talks to TradeBot and Indodax by plain HTTPS, named
  `juw12-trade-indodax`, nothing hidden. Whether that traffic is allowed is the network owner's
  decision.

## The study: it checks its own rules, and changes nothing

The sender starts `learn.py` by itself, hidden and at low priority: every four hours (one new
4-hour candle) and right after each buy or sale. `python learn.py` runs one study by hand, and
`python learn.py --offline` uses the candles already saved. Each study:

1. **Replay.** The rules that trade the money, on every 4-hour candle since March 2020 (signals
   from Binance BTC/USDT, buys and sales at Indodax BTC/IDR prices, costs taken off).
2. **Unseen prices.** 81 nearby versions of the rules are replayed too. For each half year the
   best version of the three years before is picked and judged on that half year only. A rule
   that only fits the past fails here.
3. **Real cost.** Each finished real trade is compared with Indodax's price in the same minute,
   so the cost of a buy and a sale is measured. From five real trades on, the replay uses the
   measured cost instead of the assumed 0.9%.
4. **Verdict.** `keep`: the rules that trade are also the best of the last three years.
   `watch`: another version did better lately; it is followed on paper from that day.
   `review`: that version stayed ahead for 90 days and 8 trades, and picking by the past also
   won on the unseen half years. TradeBot then sends one message.

5. **Score.** One number from 0 to 10 for how far the rules are proven. It is not a win rate
   and not a forecast. Four measured parts add up to it:

   | Part | Points | Full marks for |
   | --- | --- | --- |
   | Unseen prices | 3 | a year's gain on prices the rules had not seen of 30% of one buy |
   | Steady years | 2 | 90 of 100 twelve-month spans ending with a gain (50 of 100 gives nothing) |
   | Dips | 2 | a year's gain of twice the deepest dip |
   | Real money | 3 | 30 finished real trades (half the points) and an average of +0.5% a trade after costs (the other half) |

   New rules with no real trade start near 2 or 3: nothing is proven on real money yet. The scale
   is frozen as `SCORE_VERSION`; a change of the scale starts a new curve, so the score never
   rises because the ruler changed.
6. **Curve.** One point a day is kept (the day's last score, 400 days). The desk's Study tab draws
   it on a fixed scale from 0 to 10, `/learn` says where it started and where it is now.

What it is not:

- **It cannot order.** It has no code for it. It reads only public prices and the sender's own
  list of finished trades; the Indodax API key is never used or sent anywhere by it.
- **It never changes the rules or the size of a buy.** A review is a reason to look; the change
  is made by hand, with tests (`../skills/tradebot-learn/SKILL.md`).
- **It does not aim at winning every trade.** Rules that almost never lose do it by keeping
  losing trades open, and one of those ends the account. It aims at more rupiah after costs on
  prices the rules have not seen. A past result is not a promise.

The result is `learn.json` next to the sender's state; the candles are kept in
`learn_candles.json` (about 2 MB, only the newest are read again). The sender adds the short form
to its report: `/learn` in Telegram (the score first), four lines in `/report`, the phone page
and the desk's Study tab. A
study that fails (no network) is tried again half an hour later and never stops the sender.

## Test it

```
.\run-windows.ps1 -Test        # or: python -m unittest
```

No Indodax account and no network are needed. The tests use a pretend exchange, so they show the
sender's own rules (the real-money gate, the limits, nothing bought or sold twice, nothing private
kept), not how the real Indodax answers. `test_learn.py` tests the study on made-up candles.

## Real money

Off by default, and meant to stay off until practice mode has run for a while and you have read
this whole section. Trading can lose all of the money you put in. There is no win-rate promise.

**The API key.** Log in to Indodax yourself and create an API key with **view** and **trade**
only. Leave **withdraw off**: the sender never withdraws, and a key that cannot withdraw cannot be
used to move your money out if it ever leaks. Put the key and secret in `.env`, stop the sender if
it is running, and check them. Keys made now are for Indodax's Trade API 2.0, which the sender
speaks by default; for a key made for the older Trade API, add `INDODAX_API_VERSION=1`. The check
says so when the key and the setting do not match, and it refuses a key that may not trade:

```
.\run-windows.ps1 -Check       # prints your free rupiah, orders nothing
```

**The check is required before any real buy.** A key that has not passed `-Check` on this PC
buys nothing: real mode still starts, so open copies can be sold, but every buy is refused and
`/indodax` says "This API key has not passed the check on the PC". A new or changed key needs a
new check. Run the check with the sender stopped, or the running sender writes over the result.

**Switching it on needs three things together** in `.env`, and the check above:

1. `INDODAX_API_KEY` and `INDODAX_API_SECRET`
2. `INDODAX_MODE=real`
3. `INDODAX_REAL_CONFIRM=I accept real money on Indodax` (typed exactly)

With one of them missing, the sender stops with a message or stays in practice. Every real order
passes one gate that checks all three again, the order size and the open count.

**What you must know before you do**

- **There is no stop at the exchange.** The 8% stop is the sender's own: it sells at market when
  it sees the price. While the PC is off, asleep or offline, nothing is watched and nothing is
  sold. In a fast fall the sale can be well below the stop.
- **Orders are market orders**, filled at whatever the book offers. That is why wide markets are
  skipped and the size is small.
- **Do not trade the same coins by hand on that account while it runs.** The sender tells its own
  coins from yours only by amounts. Selling its coin by hand closes the copy without a result;
  buying more of it by hand can confuse a check after a lost answer.
- **A copy bought for real is sold for real,** even after you switch back to practice, as long as
  the API key is still in `.env`. Take the key out and the copy is left alone: sell it by hand.
- **The most at risk** is the order size times the copies allowed. With the defaults that is
  Rp100.000. The hard ceilings are Rp500.000 an order and three copies.
- **Not verified against a real account:** the whole private API. In particular the names of the
  fields in Indodax's answer to a market sale, the fields of its record of one order (state, side
  and amounts), and the wording of its "order name already used" refusal, come from reading the
  documentation. When an answer is unclear the sender falls back on your balance, and stops
  (below) rather than guess.

**When an answer is lost.** Every order carries its own name. If Indodax's answer to an order does
not arrive, the sender asks Indodax what became of the order with that name. That call only reads.

- **A clear record settles it without a guess.** A buy shown as filled is recorded as a copy, but
  only when the coin also shows in your balance. A buy Indodax cancelled before anything was
  bought is dropped, and that signal is not bought again. A sale shown as sold closes the copy
  with the exact rupiah from the record, not an estimate. A sale cancelled before any of it was
  sold is sent again under a new name.
- **Still open at Indodax:** nothing new is sent. The safety stop goes on and tells you to look at
  your open orders. Cancel a sale that stays open by hand.
- **Partly sold, then cancelled:** the sale is never sent again under a new name, so your own coins
  in the same account are not sold by mistake. The copy is closed with an estimate, the safety
  stop goes on, and what is left stays in your account for you to sell by hand.
- **No clear record** (the lookup fails, or shows a state, a side or amounts the sender does not
  expect): exactly as before the lookup existed. Your balance decides, and the safety stop goes
  on.

**The safety stop.** Anything unclear stops new real buys: a lost answer, a refusal, a coin that
did not arrive, a sale that could not be confirmed. Sales of open copies go on. `/indodax` shows
the reason. Look at your orders and balance at Indodax, then:

```
.\run-windows.ps1 -Clear
```

**Start small.** The first real run is the first test against a real account. Use the smallest
order size, one coin (`INDODAX_COINS=btc`), `INDODAX_MAX_OPEN=1`, and watch the first buy and the
first sale at Indodax yourself.

## The desk: one window instead of a console

`open-desk.cmd` (or `pythonw desk.py`) opens one window that runs the sender itself, hidden, and
shows what it does: real or practice, the free rupiah, what is held, the market, what the strategy
needs before it buys or sells, the history, the result, and the sender's own log.

What is where:

- **Top:** REAL MONEY or practice, whether the sender is running, and a red or yellow line for
  anything that needs you (sender stopped, safety stop, key not checked, buying paused, the
  sender silent, too little rupiah for one buy, TradeBot not answering). No line means all is fine.
- **Four numbers:** free rupiah, coins you hold, result so far, today.
- **Overview tab:** on the left what happens next and, per coin, the three checks with a tick or
  a cross; on the right the coins you hold (with the price under which each is sold), the price
  at Indodax, the finished trades, and the trading words in plain words.
- **Study tab:** the score from 0 to 10 for how far the rules are proven, its four parts, the
  curve of the score day by day, what is still being collected (real trades, the measured cost,
  the trial setting) and when the next study comes.
- **Full report tab:** the same text as `/report` in Telegram.
- **Sender log tab:** the sender's own lines (what the console window used to show). The line
  above the tabs counts the network misses since the window opened.

`pythonw desk.py --demo` opens the window with made-up numbers: no sender, no network, nothing
private. Good for a look around or a screenshot.

### TradeBot.exe: the desk as an app, no Python needed

Every version is also built as one file for Windows:
<https://github.com/juw12/projects/releases/download/tradebot-desk/TradeBot.exe> (always the
newest; each version is kept as release `tradebot-desk-v<version>`).

- Put `TradeBot.exe` in the folder that holds your `.env` and open it (or `open-desk.cmd`, which
  uses the app when it is there). It is the window, the sender inside it (`TradeBot.exe --sender`)
  and the study (`TradeBot.exe --study`) in one file. No console window opens.
- The title shows the version. When TradeBot's server runs a newer one, the line at the bottom of
  the window says so.
- To update: close the window while no coin is held, then run `update-desk.cmd`. It downloads the
  newest app, keeps the old one as `TradeBot.old.exe` and opens the new one. `.env` and the
  sender's files are not touched.
- The file is not signed, so Windows may ask once before it opens. It holds no key and no secret.
- It starts about three seconds slower than `pythonw desk.py`: one file unpacks itself first.
- Built by `.github/workflows/trade-bot-desk.yml` with PyInstaller, after the tests, and tried
  there before it is published (the window, the sender's words through a pipe, the study).

- **Start the sender / Stop the sender.** The sender is a child of the window: closing the window
  stops it (it asks first). A sender that ends by itself is started again a minute later.
- **Never two senders.** If a sender is already running in a console window, the desk does not
  start a second one; "Take it over here" stops that one and runs it in the desk. When that one
  is gone, the desk starts its own, so an open window always ends up with a running sender.
- **Closed and opened again quickly.** The window sees the last sender's fresh report and waits
  until it is three minutes old, then starts a sender by itself. You do not need to press anything.
- **Pause buying / Allow buying again.** The same switch as `/indodax pause` in Telegram.
- It never places an order and never reads the Indodax API key. It asks TradeBot with the
  sender's key from `.env` (`GET /v1/indodax/view`, `POST /v1/indodax/pause`), and when TradeBot
  cannot be reached it shows the sender's own last report (`bridge_report.json`).
- The sender's lines are also kept in `desk_sender.log` (rolled over at 1 MB).
- `INDODAX_REPORT_CASH=yes` in `.env` adds the free rupiah (real mode only).

On the phone: send `/phone` to TradeBot in Telegram. It answers with a private link to a page that
reloads every minute. It opens with the same glance as the desk (real or practice, the sender,
warnings, the four numbers, what happens next), then the full report and the trading words in
plain words. The page only shows. `/phone` again makes a new link and switches the old one off.

In real mode TradeBot's Telegram messages are about Indodax only: the practice account's own
messages are not sent, the 07:00 WIB message is the full Indodax report, and `/report`,
`/holding`, `/analysis`, `/trades` or a plain question answer from it.
