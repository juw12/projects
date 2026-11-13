# TradeBot's twin on freqtrade (dry run)

[freqtrade](https://github.com/freqtrade/freqtrade) is the most used open-source crypto bot (about
57k stars). This folder runs **TradeBot's exact rules** on it, in **dry run**: pretend money, real
prices, real order books. It is the path to real money later, because freqtrade has years of
battle-testing on live exchanges. TradeBot on Cloudflare stays the main bot; this twin is the
second opinion on the engine side.

| | TradeBot (Cloudflare) | Twin (freqtrade) |
|---|---|---|
| Runs on | Cloudflare, free, always on | your PC or a small server, must stay on |
| Money | practice only, no code path to real orders | dry run now; real orders only if you add exchange keys and turn dry run off |
| Rules | `src/strategy.js` | `user_data/strategies/TradeBotTrend.py`, the same rules |
| Telegram | its own bot | needs a **second** bot from @BotFather |
| Extras | the desk (Bull, Bear, Risk) | FreqUI web page, its own backtester |

## The rules (same as TradeBot)

Buy when the close is above its 200-candle average, the 20-candle average is above the 50-candle
average and RSI(14) is 50 to 70. Sell when momentum or the uptrend is lost, or at the stop: 3 ATR
under the close, trailing up. Each trade is sized so the stop costs about 1% of the account, at most
25% in one coin, at most 3 coins. 6 candles of rest after a sale. 4-hour candles, BTC, ETH, SOL.

Differences: freqtrade fills at the order book price (TradeBot's backtest adds 0.05% slippage), and
TradeBot's "no new buys after a 3% day" limit is not ported.

## Start it

With Docker:

```
copy .env.example .env      (fill in the second bot's token, your chat id, a FreqUI password)
docker compose up -d
```

Without Docker (Python 3.11 to 3.13):

```
py -m venv .venv
.venv\Scripts\pip install freqtrade
.venv\Scripts\freqtrade trade --config config.json --userdir user_data
```

FreqUI: http://127.0.0.1:8080 (user `tradebot`). The Telegram bot answers `/status`, `/profit`,
`/balance`, `/daily`, `/stop`.

## Check the rules on past prices

```
freqtrade download-data --config config.json --userdir user_data --timerange 20231114- -t 4h
freqtrade backtesting  --config config.json --userdir user_data --timerange 20240101-
```

## Real money (not done, on purpose)

Only after weeks of dry run that you are happy with: an exchange account, an API key with **trade
only, no withdrawals, locked to your IP**, `"dry_run": false`, and start with a small wallet.
