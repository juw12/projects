"""Multi-symbol backtest sweep. Runs backtest for several symbols and prints a comparison."""
from __future__ import annotations

import backtest as bt

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT"]
TIMEFRAME = "4h"
MONTHS = 6


def main() -> None:
    print(f"Sweeping {len(SYMBOLS)} symbols at {TIMEFRAME} over {MONTHS} months (Yahoo Finance)...\n")
    header = f"{'Symbol':<10} {'Trades':>7} {'Win%':>7} {'PF':>7} {'AvgWin':>9} {'AvgLoss':>9} {'PnL%':>9} {'MaxDD%':>9}"
    print(header)
    print("-" * len(header))

    results: list[bt.BacktestResult] = []
    for sym in SYMBOLS:
        try:
            r = bt._simulate(sym, TIMEFRAME, MONTHS, 2.0, 1.5)
            results.append(r)
            pf = f"{r.profit_factor:.2f}" if r.profit_factor != float("inf") else "  inf"
            print(f"{r.symbol:<10} {r.n_trades:>7d} {r.win_rate:>6.1f}% {pf:>7} "
                  f"{r.avg_win_pct:>+8.2f}% {r.avg_loss_pct:>+8.2f}% "
                  f"{r.total_pnl_pct:>+8.2f}% {r.max_dd_pct:>+8.2f}%")
        except Exception as e:
            print(f"{sym:<10}  FAILED: {e}")

    print()
    print("Ranked by Profit Factor (best first):")
    ranked = sorted(results, key=lambda r: r.profit_factor if r.profit_factor != float("inf") else 999, reverse=True)
    for r in ranked:
        pf = f"{r.profit_factor:.2f}" if r.profit_factor != float("inf") else "inf"
        verdict = "PROFITABLE" if r.profit_factor >= 1.2 and r.win_rate >= 40 else (
                  "MARGINAL  " if r.profit_factor >= 1.0 else "UNPROFITABLE")
        print(f"  {r.symbol:<10} PF={pf:>6}  Win%={r.win_rate:>5.1f}  Trades={r.n_trades:>3}  {verdict}")


if __name__ == "__main__":
    main()
