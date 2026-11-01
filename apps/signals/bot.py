"""Long-running signal bot. Polls Yahoo Finance, evaluates strategy, alerts to Telegram, logs paper trades.

Opt-in: set LIVE_TRADING=true in .env to also place real orders on Binance testnet/live.
Default is paper-only.
"""
from __future__ import annotations

import logging
import time
from logging.handlers import RotatingFileHandler

import config
import data
import executor
import paper
import strategy
import telegram

LOG_FILE = "bot.log"
log = logging.getLogger("bot")


def setup_logging() -> None:
    fmt = "%(asctime)s %(levelname)s %(message)s"
    logging.basicConfig(
        level=logging.INFO,
        format=fmt,
        handlers=[
            RotatingFileHandler(LOG_FILE, maxBytes=2_000_000, backupCount=3, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def evaluate_once(symbol: str, timeframe: str, ledger: paper.Ledger, tg_token: str, tg_chat: str) -> None:
    log.info("checking %s %s", symbol, timeframe)
    try:
        bars = data.fetch_klines(symbol, timeframe, limit=250)
    except Exception as e:
        log.warning("fetch error for %s: %s", symbol, e)
        return

    if not bars:
        return
    opens = [b["open"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    bar_times = [b["time"] for b in bars]

    sig = strategy.generate_signal(symbol, timeframe, opens, highs, lows, closes, bar_times)
    atr_now = strategy.atr(highs, lows, closes, 14)[-1]

    closed = ledger.check_exit(symbol, highs[-1], lows[-1])
    if closed:
        msg = (
            f"{'TP' if closed.result == 'TP' else 'SL'} {symbol} closed @ {closed.exit:.4f}\n"
            f"P&L: {closed.pnl_usd:+.2f} USD ({closed.pnl_pct:+.2f}%)\n"
            f"Balance: {ledger.balance:.2f} USD"
        )
        log.info("trade closed: %s", msg)
        telegram.send(tg_token, tg_chat,
                      f"{'TP' if closed.result == 'TP' else 'SL'} <b>{symbol}</b> closed @ "
                      f"<code>{closed.exit:.4f}</code>\nP&amp;L: <code>{closed.pnl_usd:+.2f} USD</code> "
                      f"({closed.pnl_pct:+.2f}%)\nBalance: <code>{ledger.balance:.2f} USD</code>")

    if not sig.side:
        return

    if ledger.has_open(symbol):
        return

    trade = ledger.open_position(sig, atr_now)
    if not trade:
        return

    log.info("signal: %s %s entry=%.4f stop=%.4f target=%.4f",
             sig.side, symbol, sig.entry, sig.stop, sig.target)
    telegram.send(tg_token, tg_chat,
                  telegram.format_signal(sig, atr_now, ledger.balance, ledger.risk_per_trade)
                  + f"\n\nPaper trade opened. Balance: {ledger.balance:.2f} USD")

    live_exec: executor.BinanceExecutor | None = executor.from_env(config)
    if live_exec is not None:
        try:
            usd_notional = ledger.balance * ledger.risk_per_trade
            stop_dist = abs(sig.entry - sig.stop)
            qty = (usd_notional / stop_dist) if stop_dist > 0 else 0.0
            entry_side = "BUY" if sig.side == "LONG" else "SELL"
            order = live_exec.place_market_order(symbol, entry_side, qty)
            log.info("LIVE ORDER FILLED: %s %s qty=%.6f @ %.4f id=%s",
                     entry_side, symbol, order.qty, order.price, order.order_id)
            telegram.send(tg_token, tg_chat,
                          f"LIVE ORDER FILLED: <b>{entry_side} {symbol}</b> "
                          f"qty={order.qty} @ {order.price:.4f} (id {order.order_id})")
        except executor.ExecutorError as e:
            log.warning("LIVE ORDER REJECTED: %s", e)
            telegram.send(tg_token, tg_chat, f"LIVE ORDER REJECTED: {e}")


def main() -> None:
    setup_logging()
    config.load_env()
    symbols = config.get_list("SYMBOLS", ["BTCUSDT", "ETHUSDT"])
    timeframe = config.get("TIMEFRAME", "4h")
    poll_interval = config.get_int("POLL_INTERVAL", 14400)
    tg_token = config.get("TELEGRAM_BOT_TOKEN")
    tg_chat = config.get("TELEGRAM_CHAT_ID")
    starting = config.get_float("PAPER_BALANCE", 1000.0)
    risk = config.get_float("RISK_PER_TRADE", 0.02)
    ledger_path = config.get("LEDGER_FILE", "./paper_trades.csv")

    ledger = paper.Ledger(ledger_path, starting, risk)

    log.info("bot starting | symbols=%s tf=%s poll=%ss balance=$%.2f risk=%.2f%%",
             symbols, timeframe, poll_interval, starting, risk * 100)
    log.info("ledger: %s", ledger_path)
    log.info("telegram: %s", "enabled" if tg_token and tg_chat else "disabled")
    log.info("initial stats: %s", ledger.stats())

    while True:
        for symbol in symbols:
            evaluate_once(symbol, timeframe, ledger, tg_token, tg_chat)
        log.info("sleeping %ss...", poll_interval)
        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
