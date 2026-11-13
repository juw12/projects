# TradeBot

A trading agent you talk to in Telegram. It watches real live crypto prices, decides by fixed
rules, and trades a **practice account** (10,000 USDT of pretend money) on its own, day and night.
It runs on a free Cloudflare Worker, so nothing has to stay open on your PC.

**Practice money only.** Nothing in this build can place a real order or touch real money.
It is not financial advice. See "Real money" at the bottom.

## Set it up (once, about 3 minutes)

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`.
   BotFather answers with a token like `123456789:AA...`.
2. On the PC, from the repository folder, run:

       python apps/tradebot/tools/connect_telegram.py

   It asks for that token and your setup code (the same one GlowBot uses). Both are typed hidden
   and saved nowhere on the PC. It prints a one-time pairing link.
3. Open the pairing link on your phone and tap **Start**. You are now the owner, and the agent
   starts its first round right away.

Only the owner can use the bot. Anyone else gets "This bot is private".
To hand the bot to another Telegram account, run the script again with `--new-pairing`.

## What it does by itself

Every 5 minutes the agent wakes up and:

- checks every open position against its stop at the live price, and sells if the stop is hit;
- once per finished candle, looks at each market on the watchlist and buys or sells by the rules;
- sends you a message for every trade, with the reason;
- sends a summary once a day (07:00 WIB);
- tells you if it cannot read prices for 30 minutes, and again when they are back.

## Commands

| Command | What it does |
|---|---|
| `/status` | Account value, cash, open positions, profit |
| `/signals` | What the agent sees in each market right now, and why it would or would not buy |
| `/buy BTC 500` | Buy 500 USDT of BTC now (without the amount, the agent sizes it) |
| `/sell BTC`, `/sell all` | Sell now |
| `/watch DOGE`, `/unwatch DOGE`, `/watchlist` | Choose the markets (starts with BTC, ETH, SOL) |
| `/auto on`, `/auto off` | Trade alone, or ask you first with Approve / Skip buttons |
| `/pause`, `/resume` | Stop or allow new buys (stops still work while paused) |
| `/risk 1` | Risk per trade, 0.1 to 5 percent of the account |
| `/timeframe 4h` | Candle size: 15m, 1h, 4h or 1d |
| `/backtest BTC` | Try the rules on past prices and compare with just holding |
| `/history` | Closed trades |
| `/reset` | Start over with fresh practice money (asks first) |
| `/help` | The short version of this page |

## The rules

A plain trend-follower. It only buys, never shorts, and uses no borrowed money.

- **Buy** when the price is above the 200-candle average, the 20-candle average is above the
  50-candle average, and RSI(14) is between 50 and 70 (rising, but not overheated).
- **Size** each buy so that hitting the stop loses about 1% of the account, and never more than
  25% of the account in one market.
- **Stop** 3 ATR(14) below the price. The stop follows the price up and never moves down.
- **Sell** when the stop is hit, the 20-candle average falls under the 50, or a candle closes
  under the 200-candle average.
- **Wait** 6 candles after a sale before buying the same market again.
- **Limits**: at most 3 positions at once; no new buys for the rest of the day after the
  account drops 3% in one day.

Every pretend trade pays a 0.10% fee and 0.05% slippage, so the results are not flattering.

## How the rules did on past prices

Real Binance candles, 1% risk per trade, fee and slippage included.
"Worst drop" is the largest fall from a peak along the way.

| Market | Span | Bot | Just holding | Bot worst drop | Holding worst drop | Trades (wins) |
|---|---|---|---|---|---|---|
| BTC 1d | 798 days | +1.4% | +23.1% | -4.3% | -53.0% | 13 (4) |
| BTC 4h | 133 days | +0.2% | +11.5% | -3.5% | -20.9% | 16 (4) |
| BTC 1h | 33 days | -1.8% | -17.4% | -1.8% | -19.7% | 10 (1) |
| ETH 1d | 798 days | +1.2% | -17.7% | -3.2% | -67.6% | 10 (4) |
| ETH 4h | 133 days | +1.7% | +13.2% | -4.7% | -30.3% | 13 (5) |
| ETH 1h | 33 days | -1.4% | -22.9% | -1.5% | -25.6% | 8 (1) |
| SOL 1d | 798 days | +1.5% | -38.9% | -3.9% | -76.3% | 9 (4) |
| SOL 4h | 133 days | +0.4% | -1.4% | -3.5% | -36.8% | 12 (3) |
| SOL 1h | 33 days | -1.1% | -27.6% | -1.1% | -30.7% | 5 (0) |

Read it honestly: these rules keep the account roughly flat with small drops. They protect money
well when the market falls and miss most of the gain when it rises. **They are not a proven way to
make money**, and a handful of trades per test is too few to prove anything either way. Past
prices do not predict future ones. `/backtest` in the bot reruns this on fresh prices any time.

## Where the prices come from

Finished candles from public market-data addresses, no account or key needed: Gate first, then
Kraken, MEXC, OKX and Binance's data mirror. The first one that answers is used, and the one that
answered last is asked first next time. Checked from Cloudflare on 2026-11-13: Gate, Kraken and
MEXC answered, OKX sometimes said "too many requests", and Binance refused Cloudflare (403).
`/v1/probe` shows what answers right now. Prices older than two candles are refused, so the agent
never trades on stale numbers.

## For developers

    cd apps/tradebot
    node --test test/*.test.js     # no network, no installs: a pretend Telegram, prices and clock

| Address | What it answers |
|---|---|
| `GET /v1/status` | alive, which build, whether a bot is connected and the agent is running |
| `GET /v1/probe` | whether the Worker can read live prices from each source |
| `POST /v1/setup` | owner only (setup code): connect a bot token, set the webhook, make a pairing link |
| `POST /v1/telegram` | Telegram's webhook, checked with the secret Telegram sends back |

One Durable Object holds the settings and the practice account; its alarm is the agent's clock.
The bot token lives only inside that Durable Object, never in this repository or in logs.
Pushing to `main` runs `.github/workflows/trade-bot-worker.yml`: tests, bundle, deploy, then a
check that the new build answers and can read prices.

| File | What it holds |
|---|---|
| `src/strategy.js` | the rules |
| `src/paper.js` | the practice account (fees, slippage) |
| `src/backtest.js` | the rules replayed on past candles |
| `src/market.js` | live candles from Gate, Kraken, MEXC, OKX, Binance |
| `src/agent.js` | the 5-minute round, stops, limits, approvals |
| `src/bot.js`, `src/render.js` | commands and message text |
| `src/index.js` | the Worker, the Durable Object, setup and pairing |

## Real money

Not built, on purpose. Going live would need all of these, decided by the owner:

1. an exchange or broker account that allows API trading where you live;
2. an API key that can **trade only**, with withdrawals switched off, stored as a Worker secret;
3. a hard cap on how much the bot may ever hold, and a kill switch;
4. several weeks of the practice account behaving the way you expect.

Until then the practice account is the honest way to see what the agent would have done.
