# TradeBot's Indodax sender (practice by default)

Indodax turns away requests that come from TradeBot's server, so an order for Indodax has to leave
from a PC. This small program is that PC side. Once a minute it asks TradeBot which coins the
practice account holds, and holds a small copy of the same coins on Indodax's rupiah markets.

**What it is, plainly**

- **Practice is the default.** Fills are worked out from Indodax's real prices and fee, with
  pretend money. In practice mode no order is sent and the private API is not touched at all.
- **Real money is off until you switch it on yourself**, with three things together (see
  [Real money](#real-money)). Nobody else can do that for you, and the tests cover the gate.
- **Not tried on a real Indodax account yet.** The 77 tests run against a pretend exchange. The
  public prices were read from Indodax for real; the private API (balance, orders) has never run
  with a real key. The first run on your PC is the first real one: start with `-Show`.
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
| `HTTPS_PROXY` | a proxy for the calls to TradeBot and Indodax |
| `INDODAX_API_KEY`, `INDODAX_API_SECRET` | your Indodax API key. Not needed for practice |
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

## Test it

```
.\run-windows.ps1 -Test        # or: python -m unittest
```

No Indodax account and no network are needed. The tests use a pretend exchange, so they show the
sender's own rules (the real-money gate, the limits, nothing bought or sold twice, nothing private
kept), not how the real Indodax answers.

## Real money

Off by default, and meant to stay off until practice mode has run for a while and you have read
this whole section. Trading can lose all of the money you put in. There is no win-rate promise.

**The API key.** Log in to Indodax yourself and create an API key with **view** and **trade**
only. Leave **withdraw off**: the sender never withdraws, and a key that cannot withdraw cannot be
used to move your money out if it ever leaks. Put the key and secret in `.env`, stop the sender if
it is running, and check them:

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
  fields in Indodax's answer to a market sale, and the wording of its "order name already used"
  refusal, come from reading the documentation. When an answer is unclear the sender falls back
  on your balance, and stops (below) rather than guess.

**The safety stop.** Anything unclear stops new real buys: a lost answer, a refusal, a coin that
did not arrive, a sale that could not be confirmed. Sales of open copies go on. `/indodax` shows
the reason. Look at your orders and balance at Indodax, then:

```
.\run-windows.ps1 -Clear
```

**Start small.** The first real run is the first test against a real account. Use the smallest
order size, one coin (`INDODAX_COINS=btc`), `INDODAX_MAX_OPEN=1`, and watch the first buy and the
first sale at Indodax yourself.
