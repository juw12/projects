# Crypto Signal Bot

A free, $0-capital crypto signal bot. Sends RSI + MACD confluence alerts to Telegram,
paper-tracks every trade, and ships with a backtester + parameter tuner + (opt-in)
Binance executor.

> **You stay in control of every trade.** This bot alerts by default. It only places
> real orders when you explicitly flip `LIVE_TRADING=true` in `.env`. No exchange API
> keys are required for paper mode.

## What it does

- Pulls OHLCV from **Yahoo Finance** (no API key, works through most corporate proxies)
- Computes RSI(14), MACD(12/26/9), ATR(14), 50 EMA on each closed bar
- **LONG** signal: RSI recovering from oversold AND MACD histogram flips positive AND price above 50-EMA
- **SHORT** signal: RSI rejecting from overbought AND MACD histogram flips negative AND price below 50-EMA
- Stop = 1.5 × ATR, Target = 2:1 reward-to-risk
- Telegram alert on every signal + exit
- Paper ledger in `paper_trades.csv` with running balance + 2% risk per trade
- Multi-symbol sweep + grid parameter tuner
- Opt-in Binance executor (testnet by default, with hard risk caps)

## Quick start

```powershell
cd "%USERPROFILE%\Documents\Default Project\apps\crypto-signal-bot"
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
# Edit .env: paste TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
python backtest.py BTCUSDT 4h 6     # single-symbol backtest
python sweep.py                     # multi-symbol comparison
python sweep_long.py                # 12mo + 24mo cross-window robustness
python tune.py                      # grid search over RR / ATR / RSI
python bot.py                       # live alert loop (foreground)
```

## Auto-run every day (background daemon)

Two ways to keep it running every day on this machine:

### Option A — Startup folder shortcut (already set up)

A shortcut at `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CryptoSignalBot.lnk`
points at `run_bot.bat`, which runs `pythonw.exe bot.py` in a hidden window. The bot
starts automatically at every Windows logon and keeps running until shutdown.

### Option B — Manual start (foreground, blocking)

```powershell
cd "%USERPROFILE%\Documents\Default Project\apps\crypto-signal-bot"
python bot.py
```

Press Ctrl+C to stop. Use this for development; use Option A for daily use.

### Managing the background bot

```powershell
# Is it running?
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.StartTime -gt (Get-Date).AddHours(-24) } | Format-Table Id, StartTime

# Watch the log live
Get-Content "apps\crypto-signal-bot\bot.log" -Tail 30 -Wait

# Stop it
Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.MainModule.FileName -like "*crypto-signal-bot*venv*" } | Stop-Process

# Restart it
Start-Process -FilePath "$PWD\.venv\Scripts\python.exe" -ArgumentList "bot.py" -WorkingDirectory "$PWD" -WindowStyle Hidden

# Remove from Startup (so it stops auto-launching at logon)
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\CryptoSignalBot.lnk"
```

The bot writes structured logs to `bot.log` (rotating, 2 MB × 3 backups). All print
output goes through Python logging so it works with `pythonw.exe` (no console window).

## Files

| File | Purpose |
|---|---|
| `config.py`   | `.env` loader (no `python-dotenv` dep); falls back to `.env.example` |
| `strategy.py` | RSI / MACD / ATR / EMA math + signal logic |
| `data.py`     | Yahoo Finance fetcher (aggregates 1h→4h/6h/12h) |
| `telegram.py` | Direct HTTP to Telegram Bot API |
| `paper.py`    | CSV-backed paper ledger with stats |
| `bot.py`      | Long-running loop, polls + alerts + (opt-in) executes |
| `backtest.py` | Single-symbol backtest, prints win rate, PF, max DD |
| `sweep.py`    | Multi-symbol comparison + verdict |
| `sweep_long.py` | 12mo + 24mo cross-window robustness check |
| `tune.py`     | Grid search over RR, ATR multiplier, RSI bands |
| `executor.py` | Opt-in Binance testnet/live order placement with risk caps |
| `run_bot.bat` | Wrapper for the Startup shortcut (activates venv, runs pythonw) |
| `.env.example` | Config template (live-trading vars commented out) |
| `requirements.txt` | One dependency: `requests` |

## Configuration (.env)

| Key | Default | Notes |
|---|---|---|
| `SYMBOLS` | `XRPUSDT,DOGEUSDT,AVAXUSDT` | Default = symbols ROBUST across all 3 windows |
| `TIMEFRAME` | `4h` | `1h`, `4h`, `1d`, etc. |
| `POLL_INTERVAL` | `14400` | Seconds between checks (14400 = 4h) |
| `PAPER_BALANCE` | `1000` | Starting USD balance for the paper ledger |
| `RISK_PER_TRADE` | `0.02` | 2% of balance risked per signal |
| `LEDGER_FILE` | `./paper_trades.csv` | Where paper trades are persisted |

If `.env` doesn't exist, `config.py` falls back to `.env.example` so the bot runs
out-of-the-box with sensible defaults. As soon as you create a real `.env`, that
takes precedence.

## Opt-in live trading (executor.py)

Add these to `.env` only after you've validated the strategy with paper trades:

```
LIVE_TRADING=true            # MUST be true or executor is a no-op
USE_TESTNET=true             # true = Binance testnet (https://testnet.binance.vision)
BINANCE_API_KEY=...
BINANCE_API_SECRET=...
MAX_POSITION_USD=200         # refuses any order above this notional
MAX_DAILY_LOSS_USD=50        # refuses new orders once realized day's losses exceed this
EXECUTOR_KILL_SWITCH=false   # true = refuse every order without making an API call
```

Get testnet keys free at https://testnet.binance.vision/ (no KYC, fake funds).
Get live keys at https://www.binance.com/en/my/settings/api-management — restrict
them to **IP + trade only**, no withdrawal permission, ever.

## Honest assessment (the part that matters)

**Backtest results vary wildly run-to-run.** With only 5-12 trades per symbol over a
6-month window, you cannot reliably distinguish a real edge from noise. The way out
is `sweep_long.py`: it tests each symbol across multiple timeframes and windows
(4h 6mo, 4h 12mo, 1d 24mo) and labels symbols ROBUST / LIKELY / UNLIKELY / BROKEN
based on consistency. Current verdict on the default universe:

- **XRP, DOGE**: ROBUST (profitable in all 3 windows, ~+9.5% weighted across 37 trades)
- **AVAX**: LIKELY (profitable in 2/3 windows)
- **BTC, ETH**: BROKEN on the 4h timeframe — dropped from defaults

What this means in practice:

1. **Do not trade real money based on backtest numbers alone.**
2. **Let it paper-trade for at least 30-60 days.** That's your out-of-sample test.
3. **Even after paper confirms**, start live trading with `MAX_POSITION_USD=20`
   and `MAX_DAILY_LOSS_USD=10`. Treat real money as a separate, smaller experiment.
4. **Past performance is not forward-looking.** Edges decay. Strategies get crowded.

The bot is honest about this on purpose. A trading bot that doesn't tell you
"this might not work" is lying.

## Going further

- `python sweep_long.py` — the most important diagnostic, run weekly.
- `python tune.py` — grid search; includes a "cross-symbol robust configs" section.
- `sweep_results.csv` and `tune_results.csv` are overwritten each run; commit
  them to git if you want to track how the picture evolves over time.
- Add Bollinger Bands, multi-timeframe confirmation, or volume filters in
  `strategy.py` — each is a ~20-line addition.
