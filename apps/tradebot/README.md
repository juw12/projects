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
- sends you a message for every trade, with the reason and what it can lose in dollars;
- sends a summary once a day (07:00 WIB): what it bought and sold and why, which offers you
  approved or skipped, what it holds, what each coin is waiting for, and any time it could not
  check prices;
- tells you in plain words if it cannot read prices for 30 minutes (stops are not checked
  then), and again when they are back.

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
| `/desk`, `/desk off` | The second opinion (Bull, Bear, Risk) and how its calls turned out |
| `/reset` | Start over with fresh practice money (asks first) |
| `/help` | The short version of this page |

## Talking to it

- After pairing, a welcome message says what the bot is, that the money is pretend, and what
  to try first.
- A misspelled command that only shows something is simply run, with a note:
  `/stauts` shows the status. One that would change the account is only offered:
  `/sel DOGE` answers "Did you mean `/sell DOGE`? Nothing was done."
- A few everyday sentences work for looking ("how is it going?" shows the status).
  Nothing is ever bought or sold from a sentence.
- With `/auto off`, each offer shows the amount, the stop, the dollar loss if the stop is
  hit, and a "Tap by" time (the close of the current candle). No answer means no buy. An
  offer you skip or let lapse is not repeated until the signal goes away and comes back.
- When something fails, the answer says what happened and what to do next. Raw exchange
  errors never reach the chat.

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

## The desk: a second opinion (Bull, Bear, Risk)

Borrowed from [TradingAgents](https://github.com/TauricResearch/TradingAgents), the most-starred
LLM trading project: before every buy the rules want, three voices look at the same numbers and
argue it out in one call to Workers AI (Llama 3.3 70B; if Cloudflare refuses a model for the account it falls back to Llama 3.1 8B, then Gemma 3 12B - free plan):

- **Bull**: the best honest case for buying now;
- **Bear**: the best honest case against;
- **Risk**: what could go wrong, and whether the stop distance is sensible;

then one verdict, "take it" or "pass on it", with how sure they are (1 to 5). It shows under every
Bought message and every offer.

**The desk never decides.** The 3 checks buy, size and sell exactly as before; with the desk off,
slow or down, the bot trades the same, to the cent (there is a test for that). The desk only sees
numbers, never the coin's name or the date, so the model cannot "remember" how that day went.
`/desk` shows its record: how the trades it said "take it" to did against the ones it said "pass
on it" to. `/desk off` stops asking it.

Whether it helps is measured, not assumed: `tools/desk_eval.mjs` replays the rules over past
prices and asks the same model about a spread-out sample of the buys. The GitHub check
"TradeBot desk check" runs it whenever the desk changes, and the result is in its summary (it needs
the Cloudflare API token to have the **Workers AI: Read** permission; without it the check says so
and skips). `GET /v1/desk` asks the live desk one sample question, to show it answers. Only if
"take it" beats "pass on it" clearly, over many trades, would it be worth letting the desk veto.

## Merged from the old signals bot

`juw12/signals` (RSI + MACD alerts on XRP, DOGE and AVAX, run on the PC) is folded in here. Both
rule sets were replayed on the same 3 years of Binance 4h candles (Nov 2023 to Nov 2026, fees and
slippage included, 1% risk per trade):

| coin | TradeBot's rules | signals' rules | just holding |
|---|---|---|---|
| BTC | +14.8% (worst drop 5.5%) | +5.4% | +64% |
| ETH | +8.4% | -0.4% | -13% |
| SOL | +16.4% | +2.8% | +9% |
| XRP | +6.6% | -6.2% | +66% |
| DOGE | +14.7% | -3.8% | -32% |
| AVAX | -13.2% | -0.4% | -80% |

TradeBot's rules did better on 5 of 6 coins, so they stay. The coins signals called "robust" (XRP,
DOGE) lost money on its own rules over 3 years. XRP and DOGE work with these rules and can be
added any time with `/watch XRP` and `/watch DOGE`; AVAX lost money either way. In the most recent
18 months every rule set was roughly flat while holding fell 25 to 72%: the rules mostly protect,
they have not shown an edge.

## The freqtrade twin

`freqtrade/` runs the same rules on [freqtrade](https://github.com/freqtrade/freqtrade), the most
used open-source crypto bot, in dry run. It is the path to real money later. See
`freqtrade/README.md`. The GitHub check "TradeBot twin" backtests it with freqtrade's own engine.

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
    node tools/transcript.js --out chat.md   # four scripted days of chat, as the owner sees it

`tools/transcript.js` drives the real Worker through a fixed script (setup, trades, typos, an
outage, a reset) with scripted prices, and writes every message as Markdown.
`test/transcript.test.js` checks that chat on every run: every command gets an answer, the
HTML is valid and short enough for Telegram, no raw error, exchange pair name or cut-off text
appears, every trade message says "practice", and no secret is printed.

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
| `src/bot.js`, `src/render.js` | commands, typo handling and message text |
| `src/index.js` | the Worker, the Durable Object, setup and pairing |
| `tools/transcript.js` | the scripted chat used to review and test the wording |

## Real money

Not built, on purpose. Going live would need all of these, decided by the owner:

1. an exchange or broker account that allows API trading where you live;
2. an API key that can **trade only**, with withdrawals switched off, stored as a Worker secret;
3. a hard cap on how much the bot may ever hold, and a kill switch;
4. several weeks of the practice account behaving the way you expect.

Until then the practice account is the honest way to see what the agent would have done.
