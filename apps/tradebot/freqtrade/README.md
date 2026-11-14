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
| Telegram | its own bot | a **second** bot from @BotFather: freqtrade's own, or answered by TradeBot's server (below) |
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

Without Docker, on Windows (Python 3.11 to 3.13; works without admin rights):

```
py -m venv .venv
.venv\Scripts\pip install freqtrade
.\run-windows.ps1 backtest      (download 4h candles and test the rules)
.\run-windows.ps1               (dry run; keep the window open)
```

`run-windows.ps1` reads `.env`, uses Gate.io prices by default (Binance is blocked on some
Indonesian networks; `-Exchange binance` where it works) and takes `-Proxy http://host:port` behind a
company proxy. Checked on the owner's laptop: 294 trades since 2024-01-01, +41.3% against +5.2% for
the market, worst drop 16.4%.

FreqUI: http://127.0.0.1:8080 (user `tradebot`). The Telegram bot answers `/status`, `/profit`,
`/balance`, `/daily`, `/stop`. Money is shown in **rupiah**: trades are in USDT and freqtrade converts
with CoinGecko's rate (`fiat_display_currency` in `config.json`; any currency freqtrade lists works).

Telegram on Windows, the first time: put only the token in `.env`, send any message to the second
bot, then start `run-windows.ps1`. It finds your chat id and saves it in `.env`. If Telegram cannot
be reached (some office networks block it) the twin says so and runs without Telegram; start it
again on a network that allows Telegram. A click in the window no longer pauses the twin, and
everything it prints is also kept in `user_data/logs/freqtrade.log`.

## Telegram through TradeBot's server

freqtrade's own Telegram bot only works while this PC is on, on a network that reaches Telegram.
The other way: TradeBot's server (the Cloudflare Worker) answers the twin's bot, and this PC only
reports its numbers there.

1. Connect the twin's bot to the server, once (owner only; the setup code is TradeBot's):

   ```
   curl -X POST https://trade-bot.juw12.workers.dev/v1/twin/setup \
        -H "X-Setup-Code: <setup code>" -H "Content-Type: application/json" \
        -d "{\"token\": \"<the second bot's token>\"}"
   ```

   The answer holds `reportKey`, shown once. From now on the bot answers `/start`, `/status`,
   `/profit`, `/trades` and `/help` to TradeBot's owner only. Until the first report it says it has
   not heard from the twin yet.
2. Switch reports on: put `TWIN_REPORT_KEY=<reportKey>` in `.env` and start `run-windows.ps1`
   again. It starts `twin_report.py` next to freqtrade and stops it with freqtrade.

`python twin_report.py --show` prints exactly what would be sent, and sends nothing: the account
value, the profit, open and closed trades, the strategy name. No keys, no passwords, no logs.

Good to know:

- **It only shows.** Nothing travels back to this PC, so the bot cannot buy, sell or stop the twin.
- **Fresh only while the PC is on.** After 5 quiet minutes the bot says how old its numbers are.
- **One reader per bot.** Once the server owns the bot, freqtrade's own Telegram cannot use the same
  bot, so `run-windows.ps1` keeps it off while `TWIN_REPORT_KEY` is set. To go back: empty
  `TWIN_REPORT_KEY` and remove the webhook (`deleteWebhook` in Telegram's Bot API).
- **At an office, ask first.** If the network blocks Telegram on purpose, reports send the twin's
  numbers out another way (plain HTTPS to the server, named `juw12-trade-twin`, nothing hidden).
  Whether that is allowed is the network owner's decision, not this script's. It is off until you
  fill in the key, and it works the same from a home network.

## Check the rules on past prices

```
freqtrade download-data --config config.json --userdir user_data --timerange 20231114- -t 4h
freqtrade backtesting  --config config.json --userdir user_data --timerange 20240101-
```

## Real money (not done, on purpose)

Only after weeks of dry run that you are happy with: an exchange account, an API key with **trade
only, no withdrawals, locked to your IP**, `"dry_run": false`, and start with a small wallet.
