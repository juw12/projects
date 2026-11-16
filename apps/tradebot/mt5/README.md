# TradeBot's MetaTrader 5 bridge (demo accounts only)

TradeBot's server cannot place a MetaTrader 5 order: MT5 only talks to a program on the same
Windows PC as its terminal. This small program is that link. Once a minute it asks TradeBot which
coins the practice account holds, and holds the same coins in an MT5 **demo** account.

**What it is, plainly**

- **Practice money only.** On a real or contest account it sends no order. That is checked again
  right before every single order, and the tests cover it.
- **Crypto, not forex.** TradeBot's rules run on BTC, ETH and SOL prices. The bridge copies those
  onto the broker's crypto symbols (BTCUSD and so on). It does not trade EURUSD or gold: TradeBot
  has no forex prices or forex rules yet.
- **Not tried on a real terminal yet.** The 42 tests run against a pretend MetaTrader 5. The first
  run on your PC is the first real one: start with `-Show`.
- **No proven edge.** Copying the rules to MT5 does not make them better. A demo account is the
  right place to find out.

## Set it up

Do this on a PC and network where installing a trading terminal is allowed (a home PC, not an
office laptop without permission).

1. Install MetaTrader 5 and open a **demo account** in it (File > Open an Account, pick a broker
   that lists crypto symbols, choose "demo"). Use an account just for this bridge.
2. In the terminal, switch on **Algo Trading** (the button in the toolbar), and check that the
   crypto symbols are in Market Watch.
3. Install Python (64-bit) and the package:

   ```
   py -m venv .venv ; .venv\Scripts\pip install MetaTrader5
   ```
4. Ask TradeBot's server for the bridge key, once (owner only; the setup code is TradeBot's):

   ```
   curl -X POST https://trade-bot.juw12.workers.dev/v1/mt5/setup -H "X-Setup-Code: <setup code>"
   ```

   The answer holds `bridgeKey`, shown once. For a new key later, send
   `-H "Content-Type: application/json" -d "{\"newKey\": true}"` too; the old key stops working.
5. Copy `.env.example` to `.env` and put the key in `MT5_BRIDGE_KEY`.
6. Look first, then run:

   ```
   .\run-windows.ps1 -Show     # what it would do: no orders, no report
   .\run-windows.ps1           # keep copying, one cycle a minute
   ```

`/mt5` in TradeBot's Telegram chat then shows the demo account: balance, the open copies and what
the bridge last said. You can watch the same demo account in the MetaTrader 5 phone app by logging
in to it there.

## What one cycle does

1. Reads the account the terminal is logged in to. Not a demo account: stop, no orders.
2. Asks TradeBot which coins the practice account holds (`GET /v1/mt5/signals`).
3. Closes its own positions in coins the practice account no longer holds.
4. Buys the broker's **smallest lot** of each held coin it has not copied yet.
5. Moves the broker-side stop up to the practice account's stop. A stop is never lowered.
6. Posts what the demo account looks like (`POST /v1/mt5/report`).

When TradeBot's numbers are old or cannot be read, it holds: no orders that minute.

## Settings (`.env`)

| Name | What it does |
|---|---|
| `MT5_BRIDGE_KEY` | the key from the setup. Empty means the bridge is off |
| `MT5_SYMBOLS` | your broker's names, when they differ: `BTCUSDT=Bitcoin,ETHUSDT=Ethereum` |
| `MT5_SYMBOL_SUFFIX` | one ending every symbol carries at your broker, such as `.m` |
| `MT5_MAX_OPEN` | most copies open at once, 1 to 10 (default 3) |
| `MT5_BRIDGE_URL` | TradeBot's server, https only (default is the public one) |

## Good to know

- **It only touches its own positions.** They carry the bridge's own number (magic 20261116).
  Positions you open by hand, or another robot's, are left alone. It only ever buys and closes
  those buys; it never sells short.
- **It never sees your password.** It attaches to a terminal that is already logged in, and sends
  no login number or name to TradeBot.
- **The size is not TradeBot's size.** It buys the broker's smallest lot, whatever the practice
  account bought. The demo account's profit will not match the practice account's.
- **A late start buys late.** If the practice account bought yesterday and the bridge starts today,
  it buys at today's price. The results differ from the practice book.
- **A copy closed on the MT5 side stays closed.** If the broker's stop takes it out, or you close
  it by hand, the bridge does not buy it again until TradeBot gives a new buy signal for that coin.
- **USDT is treated as USD.** TradeBot's stops are in USDT prices; the broker's are in USD. The
  two are close, not equal.
- **Leverage loses faster.** MT5 crypto symbols are contracts with leverage, and they charge an
  overnight fee (swap) that TradeBot's practice account does not have.
- **The PC must be on**, with MetaTrader 5 open, logged in and Algo Trading switched on. While it
  is off, nothing is copied and nothing is closed; `/mt5` says how old its numbers are.
- **Stopping it** (Ctrl+C) leaves the open positions as they are. Close them in MetaTrader 5.
- **At an office, ask first.** The bridge sends the demo account's numbers out by plain HTTPS,
  named `juw12-trade-mt5`, nothing hidden. Whether a trading terminal and that traffic are allowed
  is the network owner's decision. It is off until you fill in the key.

## Test it

```
.\run-windows.ps1 -Test        # or: python -m unittest
```

No MetaTrader 5 and no network are needed. The tests use a pretend terminal, so they show the
bridge's own rules (demo only, own positions only, stops never lowered, hold on old numbers), not
how a real broker answers.

## Real money

Not built, on purpose. This bridge refuses anything that is not a demo account.
