"""Parameter sweep — finds best (RR, ATR_mult, RSI band) per symbol via grid search."""
from __future__ import annotations

import csv
from itertools import product

import backtest as bt

SYMBOLS = ["AVAXUSDT", "BTCUSDT", "SOLUSDT"]
TIMEFRAME = "4h"
MONTHS = 6

RR_GRID = [1.5, 2.0, 2.5, 3.0]
ATR_GRID = [1.0, 1.5, 2.0]
RSI_GRID = [(25, 75), (30, 70), (35, 65)]

FIELDS = ["symbol", "rsi_os", "rsi_ob", "rr", "atr_mult", "trades", "win_rate", "profit_factor", "total_pnl_pct", "max_dd_pct", "verdict"]


def _verdict(pf: float, n: int) -> str:
    if n < 5:
        return "LOW_SAMPLE"
    if pf >= 1.5:
        return "STRONG"
    if pf >= 1.2:
        return "PROFITABLE"
    if pf >= 1.0:
        return "MARGINAL"
    return "UNPROFITABLE"


def main() -> None:
    rows: list[dict] = []
    total_combos = len(SYMBOLS) * len(RSI_GRID) * len(RR_GRID) * len(ATR_GRID)
    done = 0

    print(f"Grid sweep: {len(SYMBOLS)} symbols x {len(RSI_GRID)} RSI x {len(RR_GRID)} RR x {len(ATR_GRID)} ATR = {total_combos} backtests\n")

    for symbol in SYMBOLS:
        print(f"=== {symbol} ===")
        for (rsi_os, rsi_ob), rr, atr_mult in product(RSI_GRID, RR_GRID, ATR_GRID):
            r = bt._simulate(symbol, TIMEFRAME, MONTHS, rr, atr_mult, rsi_os, rsi_ob)
            verdict = _verdict(r.profit_factor, r.n_trades)
            rows.append({
                "symbol": symbol, "rsi_os": rsi_os, "rsi_ob": rsi_ob,
                "rr": rr, "atr_mult": atr_mult,
                "trades": r.n_trades, "win_rate": round(r.win_rate, 1),
                "profit_factor": round(r.profit_factor, 2) if r.profit_factor != float("inf") else "inf",
                "total_pnl_pct": round(r.total_pnl_pct, 2),
                "max_dd_pct": round(r.max_dd_pct, 2),
                "verdict": verdict,
            })
            done += 1
            pf = f"{r.profit_factor:.2f}" if r.profit_factor != float("inf") else " inf"
            print(f"  rsi={rsi_os}/{rsi_ob} rr={rr} atr={atr_mult} | trades={r.n_trades:>3} PF={pf:>5} win%={r.win_rate:>5.1f} P&L={r.total_pnl_pct:>+7.2f}% DD={r.max_dd_pct:>+5.2f}% {verdict}")
        print()

    # Best per symbol
    print("=== Best per symbol (max PF, tie-broken by P&L) ===")
    best_per_symbol: dict[str, dict] = {}
    for sym in SYMBOLS:
        profitable = [row for row in rows if row["symbol"] == sym and isinstance(row["profit_factor"], (int, float)) and row["profit_factor"] >= 1.0 and row["trades"] >= 5]
        if not profitable:
            print(f"  {sym}: no profitable config")
            continue
        best = max(profitable, key=lambda r: (r["profit_factor"], r["total_pnl_pct"]))
        best_per_symbol[sym] = best
        print(f"  {sym}: rsi={best['rsi_os']}/{best['rsi_ob']} rr={best['rr']} atr={best['atr_mult']} -> PF={best['profit_factor']:.2f} P&L={best['total_pnl_pct']:+.2f}% trades={best['trades']}")

    # Cross-symbol robustness: configs that work on 2+ symbols
    print("\n=== Cross-symbol robust configs (PF >= 1.0 on 2+ symbols) ===")
    configs: dict[tuple, list] = {}
    for row in rows:
        key = (row["rsi_os"], row["rsi_ob"], row["rr"], row["atr_mult"])
        if isinstance(row["profit_factor"], (int, float)) and row["profit_factor"] >= 1.0 and row["trades"] >= 5:
            configs.setdefault(key, []).append(row)
    robust = sorted(
        [(k, v) for k, v in configs.items() if len(v) >= 2],
        key=lambda kv: sum(r["profit_factor"] for r in kv[1]) / len(kv[1]),
        reverse=True,
    )
    for key, sym_rows in robust[:5]:
        rsi_os, rsi_ob, rr, atr_mult = key
        syms = ", ".join(r["symbol"].replace("USDT", "") for r in sym_rows)
        avg_pf = sum(r["profit_factor"] for r in sym_rows) / len(sym_rows)
        avg_pnl = sum(r["total_pnl_pct"] for r in sym_rows) / len(sym_rows)
        avg_dd = sum(r["max_dd_pct"] for r in sym_rows) / len(sym_rows)
        print(f"  rsi={rsi_os}/{rsi_ob} rr={rr} atr={atr_mult} | {syms} | avgPF={avg_pf:.2f} avgP&L={avg_pnl:+.2f}% avgDD={avg_dd:+.2f}%")

    # Persist
    with open("tune_results.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"\nWrote tune_results.csv ({len(rows)} rows, {done}/{total_combos} backtests)")


if __name__ == "__main__":
    main()
