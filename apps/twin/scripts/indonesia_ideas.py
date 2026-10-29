"""Build web/id/ideas.js: Twin Indonesia's demo "Analyst Desk", scored against real prices.

The analysts are fictional. Each idea's entry is the real historical close on its
date (from web/id/snapshot.js); target/stop outcomes are found by walking the real
price path after entry, so the demo track records are computed, not invented.
Daily (and, before the last month, ~3-day) resolution means hit dates are
approximate and intraday touches can be missed.

Honesty note: the symbols and dates below were chosen *with hindsight* to show a
mix of wins, losses and open ideas. That is fine for demonstrating the scoring UI
but it is exactly the cherry-picking a real Analyst Desk must make impossible
(ideas must be published and timestamped before the move, and never deleted).

Usage:
    python apps/twin/scripts/indonesia_ideas.py
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]

# (id, analyst, symbol, direction, entry date, target %, stop %, horizon days, rationale)
SPECS = [
    ("rk-1", "rina", "BBRI", "BUY", "2026-10-16", 10, 7, 45,
     "Buy after a sharp pullback; 10% target, 7% stop, sized so the stop costs about 1% of the portfolio."),
    ("rk-2", "rina", "TLKM", "BUY", "2026-10-02", 12, 8, 60,
     "Defensive telco on a dip. Stop at 8% because the downtrend had not yet turned."),
    ("rk-3", "rina", "ASII", "BUY", "2026-10-16", 15, 6, 45,
     "Ahead of quarterly results; tight 6% stop because results can gap the price either way."),
    ("rk-4", "rina", "ICBP", "BUY", "2026-09-11", 10, 7, 60,
     "Consumer staple with steady demand; idea invalidated if the price breaks the 7% stop."),
    ("rk-5", "rina", "BBCA", "BUY", "2026-10-16", 10, 7, 60,
     "Quality bank near its 52-week low; patient 60-day horizon."),
    ("as-1", "arif", "MSFT", "BUY", "2026-09-10", 10, 6, 60,
     "Large-cap compounder; 10% target with a 6% stop."),
    ("as-2", "arif", "COST", "BUY", "2026-10-02", 10, 5, 45,
     "Defensive retailer after consolidation; 2:1 reward-to-risk."),
    ("as-3", "arif", "NVDA", "BUY", "2026-10-02", 12, 7, 45,
     "Momentum leader; wide swings, so position size is half of normal."),
    ("as-4", "arif", "VOO", "BUY", "2026-09-10", 8, 5, 90,
     "Core S&P 500 ETF position for beginners; long horizon, small target."),
    ("as-5", "arif", "PLTR", "BUY", "2026-10-15", 15, 8, 60,
     "High-volatility growth name; only for the Growth or Aggressive risk profiles."),
    ("ml-1", "maya", "BTC", "BUY", "2026-09-11", 12, 8, 60,
     "Bitcoin after a quiet range; crypto exposure capped at the profile's crypto limit."),
    ("ml-2", "maya", "ETH", "BUY", "2026-10-03", 15, 8, 45,
     "Ethereum breakout attempt; stop below the range."),
    ("ml-3", "maya", "XAU", "BUY", "2026-10-03", 6, 4, 90,
     "Gold as a portfolio hedge; note the ~2% round-trip spread eats into short-term moves."),
    ("ml-4", "maya", "DOGE", "SELL", "2026-10-03", 12, 8, 30,
     "Take profit / avoid: meme-coin rally looked stretched. Scored as if sold at entry."),
    ("ml-5", "maya", "SOL", "BUY", "2026-09-11", 20, 10, 60,
     "Higher-risk altcoin idea with a wide stop and a small position."),
]

BENCHMARK_FOR = {"IDX": "^JKSE", "US": "^GSPC", "CRYPTO": "BTC", "GOLD": None}


def idx_tick(price: float) -> int:
    if price < 200:
        return 1
    if price < 500:
        return 2
    if price < 2000:
        return 5
    if price < 5000:
        return 10
    return 25


def tidy(market: str, price: float) -> float:
    if market == "IDX":
        tick = idx_tick(price)
        return round(price / tick) * tick
    if price >= 1000:
        return round(price)
    return round(price, 2)


def load_snapshot() -> dict:
    raw = (APP_DIR / "web" / "id" / "snapshot.js").read_text(encoding="utf-8")
    return json.loads(raw.split("window.SATU_SNAPSHOT = ", 1)[1].rstrip().rstrip(";"))


def merged_history(instrument: dict) -> list:
    month = instrument["hist"].get("1M") or []
    year = instrument["hist"].get("1Y") or []
    start = month[0][0] if month else float("inf")
    return [p for p in year if p[0] < start] + month


def price_at(points: list, timestamp: float) -> tuple:
    chosen = points[0]
    for point in points:
        if point[0] <= timestamp:
            chosen = point
    return chosen


def main() -> int:
    snapshot = load_snapshot()
    instruments = {item["symbol"]: item for item in snapshot["instruments"]}
    bench_history = {name: data["hist"]["1Y"] for name, data in snapshot["benchmarks"].items()}
    bench_history["BTC"] = merged_history(instruments["BTC"])

    ideas = []
    for idea_id, analyst, symbol, direction, date, target_pct, stop_pct, horizon, rationale in SPECS:
        instrument = instruments[symbol]
        market = instrument["market"]
        history = merged_history(instrument)
        end_of_day = datetime.fromisoformat(date).replace(tzinfo=timezone.utc).timestamp() + 86399
        entry_time, entry_price = price_at(history, end_of_day)
        sign = 1 if direction == "BUY" else -1
        target = tidy(market, entry_price * (1 + sign * target_pct / 100))
        stop = tidy(market, entry_price * (1 - sign * stop_pct / 100))

        bench_name = BENCHMARK_FOR[market] if symbol != "BTC" else None
        bench_points = bench_history.get(bench_name) if bench_name else None
        bench_entry = price_at(bench_points, entry_time)[1] if bench_points else None

        closed = None
        for point_time, point_price in history:
            if point_time <= entry_time:
                continue
            if point_time > entry_time + horizon * 86400:
                break
            hit_target = point_price >= target if sign == 1 else point_price <= target
            hit_stop = point_price <= stop if sign == 1 else point_price >= stop
            if hit_target or hit_stop:
                closed = {
                    "at": datetime.fromtimestamp(point_time, timezone.utc).isoformat(timespec="seconds"),
                    "price": target if hit_target else stop,
                    "reason": "Target hit" if hit_target else "Stopped out",
                    "benchPrice": price_at(bench_points, point_time)[1] if bench_points else None,
                }
                break

        ideas.append(
            {
                "id": idea_id,
                "analyst": analyst,
                "symbol": symbol,
                "market": market,
                "direction": direction,
                "createdAt": datetime.fromtimestamp(entry_time, timezone.utc).isoformat(timespec="seconds"),
                "entry": entry_price,
                "target": target,
                "stop": stop,
                "horizonDays": horizon,
                "benchmark": bench_name,
                "benchEntry": bench_entry,
                "closed": closed,
                "rationale": rationale,
            }
        )

    target_file = APP_DIR / "web" / "id" / "ideas.js"
    with open(target_file, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(
            "/* Generated by apps/twin/scripts/indonesia_ideas.py from real price history. Analysts are fictional. */\n"
            f"window.SATU_IDEAS = {json.dumps(ideas, ensure_ascii=False, indent=1)};\n"
        )
    for idea in ideas:
        outcome = idea["closed"]["reason"] if idea["closed"] else "Open"
        print(f"{idea['id']:5} {idea['symbol']:5} {idea['direction']:4} entry {idea['entry']:>16,.2f} -> {outcome}")
    print(f"wrote {target_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
