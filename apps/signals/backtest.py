"""Historical backtest — runs the same strategy over N months and prints stats."""
from __future__ import annotations

import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import data
import strategy


@dataclass
class BacktestResult:
    symbol: str
    timeframe: str
    months: int
    n_trades: int
    win_rate: float
    avg_win_pct: float
    avg_loss_pct: float
    profit_factor: float
    total_pnl_pct: float
    max_dd_pct: float
    trades: list[dict]


def _simulate(
    symbol: str,
    timeframe: str,
    months: int,
    rr: float,
    atr_mult: float,
    rsi_os: float = 30.0,
    rsi_ob: float = 70.0,
) -> BacktestResult:
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - months * 30 * 24 * 60 * 60 * 1000
    bars = data.fetch_klines_range(symbol, timeframe, start_ms, end_ms)
    if len(bars) < 200:
        return BacktestResult(symbol, timeframe, months, 0, 0, 0, 0, 0, 0, 0, [])

    opens = [b["open"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    closes = [b["close"] for b in bars]
    bar_times = [b["time"] for b in bars]

    trades: list[dict] = []
    open_pos: dict | None = None

    for i in range(60, len(bars)):
        if open_pos:
            if open_pos["side"] == "LONG":
                hit_sl = lows[i] <= open_pos["stop"]
                hit_tp = highs[i] >= open_pos["target"]
            else:
                hit_sl = highs[i] >= open_pos["stop"]
                hit_tp = lows[i] <= open_pos["target"]
            if hit_sl or hit_tp:
                if hit_sl and hit_tp:
                    exit_price = open_pos["stop"]; result = "SL"
                elif hit_sl:
                    exit_price = open_pos["stop"]; result = "SL"
                else:
                    exit_price = open_pos["target"]; result = "TP"
                pnl_pct = ((exit_price - open_pos["entry"]) / open_pos["entry"]) * (1 if open_pos["side"] == "LONG" else -1) * 100
                trades.append({**open_pos, "exit": exit_price, "result": result, "pnl_pct": pnl_pct, "bar_time": bar_times[i]})
                open_pos = None
                continue

        sig = strategy.generate_signal(
            symbol, timeframe,
            opens[: i + 1], highs[: i + 1], lows[: i + 1], closes[: i + 1], bar_times[: i + 1],
            rsi_os=rsi_os, rsi_ob=rsi_ob,
            atr_mult_sl=atr_mult, rr=rr,
        )
        if sig.side and not open_pos:
            open_pos = {
                "side": sig.side, "entry": sig.entry, "stop": sig.stop,
                "target": sig.target, "opened_at": bar_times[i],
            }

    if open_pos:
        exit_price = closes[-1]
        pnl_pct = ((exit_price - open_pos["entry"]) / open_pos["entry"]) * (1 if open_pos["side"] == "LONG" else -1) * 100
        trades.append({**open_pos, "exit": exit_price, "result": "OPEN_AT_END", "pnl_pct": pnl_pct, "bar_time": bar_times[-1]})

    total = len(trades)
    wins = [t for t in trades if t["pnl_pct"] > 0]
    losses = [t for t in trades if t["pnl_pct"] <= 0]
    win_rate = (len(wins) / total * 100) if total else 0.0
    avg_win = (sum(t["pnl_pct"] for t in wins) / len(wins)) if wins else 0.0
    avg_loss = (sum(t["pnl_pct"] for t in losses) / len(losses)) if losses else 0.0
    pf = (sum(t["pnl_pct"] for t in wins) / abs(sum(t["pnl_pct"] for t in losses))) if losses else float("inf")
    total_pnl = sum(t["pnl_pct"] for t in trades)

    cum = 0.0; peak = 0.0; max_dd = 0.0
    for t in trades:
        cum += t["pnl_pct"]
        peak = max(peak, cum)
        max_dd = min(max_dd, cum - peak)

    return BacktestResult(symbol, timeframe, months, total, win_rate, avg_win, avg_loss, pf, total_pnl, max_dd, trades)


def print_report(r: BacktestResult) -> None:
    print(f"\n=== {r.symbol} {r.timeframe} {r.months}mo ===")
    print(f"Trades:       {r.n_trades}")
    print(f"Win rate:     {r.win_rate:.1f}%")
    print(f"Avg win:      {r.avg_win_pct:+.2f}%")
    print(f"Avg loss:     {r.avg_loss_pct:+.2f}%")
    print(f"Profit factor:{r.profit_factor:.2f}")
    print(f"Total pnl:    {r.total_pnl_pct:+.2f}%")
    print(f"Max drawdown: {r.max_dd_pct:.2f}%")
    print("\nLast 5 trades:")
    for t in r.trades[-5:]:
        print(f"  {datetime.fromtimestamp(t['bar_time']/1000, tz=timezone.utc).date()}  "
              f"{t['side']:5s}  entry={t['entry']:.2f}  exit={t['exit']:.2f}  "
              f"{t['result']:12s}  {t['pnl_pct']:+.2f}%")


def run(symbol: str, timeframe: str, months: int, rr: float = 2.0, atr_mult: float = 1.5) -> BacktestResult:
    r = _simulate(symbol, timeframe, months, rr, atr_mult)
    print_report(r)
    return r


if __name__ == "__main__":
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    timeframe = sys.argv[2] if len(sys.argv) > 2 else "4h"
    months = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    run(symbol, timeframe, months)
