"""Long-window sweep: bigger sample size is the only way to separate signal from noise."""
from __future__ import annotations

import backtest as bt

SYMBOLS = ["BTCUSDT", "XRPUSDT", "AVAXUSDT", "DOGEUSDT", "ETHUSDT"]
WINDOWS = [
    ("4h  6mo",  "4h", 6),
    ("4h 12mo",  "4h", 12),
    ("1d 24mo",  "1d", 24),
]


def main() -> None:
    print(f"{'Window':<10} {'Symbol':<10} {'Trades':>7} {'Win%':>7} {'PF':>7} {'PnL%':>9} {'MaxDD%':>9}")
    print("-" * 75)

    summary: dict[str, dict[str, bt.BacktestResult]] = {label: {} for label, _, _ in WINDOWS}

    for label, timeframe, months in WINDOWS:
        for sym in SYMBOLS:
            try:
                r = bt._simulate(sym, timeframe, months, 2.0, 1.5, 30.0, 70.0)
                summary[label][sym] = r
                pf = f"{r.profit_factor:.2f}" if r.profit_factor != float("inf") else "  inf"
                print(f"{label:<10} {sym:<10} {r.n_trades:>7d} {r.win_rate:>6.1f}% {pf:>7} "
                      f"{r.total_pnl_pct:>+8.2f}% {r.max_dd_pct:>+8.2f}%")
            except Exception as e:
                print(f"{label:<10} {sym:<10}  FAILED: {e}")
        print()

    # Cross-window robustness: symbols that are profitable in ALL three windows.
    print("=== Cross-window consistency (PF >= 1.0 in all 3 windows) ===")
    for sym in SYMBOLS:
        windows = [summary[label].get(sym) for label, _, _ in WINDOWS]
        if not all(windows) or any(w.profit_factor < 1.0 for w in windows if w.profit_factor != float("inf")):
            verdict = "INCONSISTENT"
            for label, _, _ in WINDOWS:
                w = summary[label].get(sym)
                if w:
                    pf = f"{w.profit_factor:.2f}" if w.profit_factor != float("inf") else "inf"
                    print(f"  {sym} {label}: PF={pf} P&L={w.total_pnl_pct:+.2f}%")
        else:
            verdict = "ROBUST"
            total_trades = sum(w.n_trades for w in windows)
            weighted_pnl = sum(w.total_pnl_pct * w.n_trades for w in windows) / total_trades
            print(f"  {sym}: PROFITABLE in all 3 windows, weighted P&L={weighted_pnl:+.2f}%, "
                  f"total trades={total_trades}  -> ROBUST")

    print()
    print("=== Per-symbol final verdict ===")
    for sym in SYMBOLS:
        wins = sum(1 for label, _, _ in WINDOWS if summary[label].get(sym) and summary[label][sym].profit_factor >= 1.0)
        if wins == 3:
            print(f"  {sym}: ROBUST (profitable in all windows)")
        elif wins == 2:
            print(f"  {sym}: LIKELY (profitable in 2/3 windows)")
        elif wins == 1:
            print(f"  {sym}: UNLIKELY (profitable in 1/3 windows)")
        else:
            print(f"  {sym}: BROKEN (no profitable window)")


if __name__ == "__main__":
    main()
