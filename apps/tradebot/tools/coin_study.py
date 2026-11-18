"""Why the Indodax sender trades bitcoin only: the same rules, replayed on other coins.

It reads past prices and orders nothing. For each coin it replays the rules that trade
(plan_backtest.py: signals from Binance's coin/USDT 4-hour candles, every buy and sale copied at
Indodax's coin/IDR price, Rp20.000 per buy, an 8% stop, about 0.9% costs per trade) and prints:

  per coin        trades, wins in 100, rupiah a year, the deepest dip, the worst year, the years up
                  for all the years Indodax has prices, and for the last three years alone
  picked by past  the coin that did best before the last three years, and what it did in them
  one slot        since 2021, one buy at a time: BTC alone, BTC + ETH + SOL, and all ten coins,
                  each mix with its coins in more than one order

Read on 18 November 2026: BTC made about Rp4.600 a year with a deepest dip of Rp10.700, and was up
in the last three years. Six of the ten coins lost money in the last three years. ETH, the best
coin before them, lost in them. SOL made more than BTC but has two years less history. BTC, ETH
and SOL sharing the one slot made more than BTC alone since 2021 (one very good SOL year), but
the figure moves by Rp2.000 a year with only which coin is bought when two signal together, the
dip is deeper in every order, and 2025 and 2026 lost more. So the sender stays on BTC; SOL is
one to watch. What happened in the past is not a promise.

  python tools/coin_study.py                    the ten coins (some minutes: about 15.000 candles a coin, twice)
  python tools/coin_study.py --coins BTC,SOL    only these
  python tools/coin_study.py --out study.json   keep the numbers as JSON too
  HTTPS_PROXY is used when it is set.
"""

import argparse
import datetime
import itertools
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import plan_backtest as plan  # noqa: E402

COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "LINK", "AVAX", "TRX"]
ORDER, STOP, COST, SLIP = 20000.0, 8.0, 0.0035, 0.001
YEAR_MS = 365.25 * 86400e3


def utc_ms(year: int, month: int = 1, day: int = 1) -> int:
    return int(datetime.datetime(year, month, day, tzinfo=datetime.timezone.utc).timestamp() * 1000)


def chunk_for(coin: str):
    """plan_backtest reads BTC; this reads the same two sources for another coin."""

    def chunk(source: str, start: int) -> list:
        if source == "binance":
            url = f"https://data-api.binance.vision/api/v3/klines?symbol={coin}USDT&interval=4h&limit=1000&startTime={start}"
            return [{"t": row[0], "o": float(row[1]), "h": float(row[2]), "l": float(row[3]), "c": float(row[4])} for row in plan.read(url)]
        url = f"https://indodax.com/tradingview/history_v2?from={start // 1000}&to={start // 1000 + 1000 * 14400}&tf=240&symbol={coin}IDR"
        rows = plan.read(url)
        return [
            {"t": int(row["Time"]) * 1000, "o": float(row["Open"]), "h": float(row["High"]), "l": float(row["Low"]), "c": float(row["Close"])}
            for row in (rows if isinstance(rows, list) else [])
        ]

    return chunk


def copies(trades: list, prices: list, start_ms: int) -> list:
    """Like plan.copy_at_indodax, but each copy keeps its times: [(bought, sold, result in rupiah)]."""
    by_start = {bought: (sold, how, ratio) for bought, sold, how, ratio in trades if bought >= start_ms}
    done, copy = [], None
    for row in prices:
        if row["t"] < start_ms:
            continue
        if copy is None and row["t"] in by_start:
            quantity = ORDER * (1 - COST) / (row["o"] * (1 + SLIP))
            copy = {"quantity": quantity, "paid": ORDER / quantity, "ends": by_start[row["t"]], "at": row["t"]}
        if copy is not None:
            sold, how, ratio = copy["ends"]
            hard = copy["paid"] * (1 - STOP / 100)
            price = None
            if sold == row["t"]:
                price = row["o"] if how == "signal" else row["o"] * ratio
                if how == "trail" and price < hard:
                    price = min(row["o"], hard)
            elif row["l"] <= hard:
                price = min(row["o"], hard)
            if price is not None:
                done.append((copy["at"], row["t"], copy["quantity"] * price * (1 - SLIP) * (1 - COST) - ORDER))
                copy = None
    return done


def figures(done: list, start_ms: int, end_ms: int) -> dict:
    if not done:
        return {"trades": 0}
    years = (end_ms - start_ms) / YEAR_MS
    total, peak, dip, by_year = 0.0, 0.0, 0.0, {}
    for _bought, sold, result in sorted(done, key=lambda item: item[1]):
        total += result
        peak = max(peak, total)
        dip = min(dip, total - peak)
        year = datetime.datetime.fromtimestamp(sold / 1000, datetime.timezone.utc).year
        by_year[year] = by_year.get(year, 0.0) + result
    wins = sum(1 for item in done if item[2] > 0)
    return {
        "years": round(years, 1), "trades": len(done), "winsOf100": round(100 * wins / len(done)),
        "total": round(total), "perYear": round(total / years), "deepestDip": round(dip),
        "worstYear": round(min(by_year.values())), "yearsUp": sum(1 for value in by_year.values() if value > 0), "yearsCounted": len(by_year),
        "byYear": {str(year): round(value) for year, value in sorted(by_year.items())},
    }


def one_slot(lists: dict, order: list) -> list:
    """One buy at a time across coins: a signal is taken only when nothing is held.

    When two coins signal on the same candle, the one earlier in `order` is bought. That choice
    changes the result a lot, so mixes() below tries more than one order.
    """
    rank = {coin: place for place, coin in enumerate(order)}
    signals = sorted(
        ((coin, *item) for coin in order for item in lists.get(coin, [])),
        key=lambda item: (item[1], rank[item[0]]),
    )
    taken, free_at = [], 0
    for _coin, bought, sold, result in signals:
        if bought >= free_at:
            taken.append((bought, sold, result))
            free_at = sold
    return taken


def orders(coins: list) -> list:
    """The orders tried for a mix: all of them up to four coins, else the list's own and 49 shuffled ones."""
    if len(coins) <= 4:
        return [list(order) for order in itertools.permutations(coins)]
    shuffle = random.Random(1)  # the same 49 every run
    return [list(coins)] + [shuffle.sample(coins, len(coins)) for _ in range(49)]


def mix(lists: dict, coins: list, start_ms: int, end_ms: int) -> dict:
    """A mix in the one slot: the figures with the coins in the list's order, and the range over the other orders."""
    tried = [figures(one_slot(lists, order), start_ms, end_ms) for order in orders(coins)]
    row = dict(tried[0])
    if len(tried) > 1 and row.get("trades"):
        row["ordersTried"] = len(tried)
        for key in ("perYear", "deepestDip", "worstYear"):
            row[key + "Range"] = [min(item[key] for item in tried), max(item[key] for item in tried)]
    return row


def rp(value) -> str:
    return ("-" if value < 0 else "+") + "Rp" + f"{abs(round(value)):,}".replace(",", ".")


def line(name: str, row: dict) -> str:
    if not row.get("trades"):
        return f"  {name:<14} no trade"
    return (
        f"  {name:<14} {row['trades']:>4} trades  {row['winsOf100']:>3} of 100 won  {rp(row['perYear']):>10} a year"
        f"  deepest dip {rp(row['deepestDip']):>10}  worst year {rp(row['worstYear']):>10}  up in {row['yearsUp']} of {row['yearsCounted']} years"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="The Indodax sender's rules on other coins. Reads prices, orders nothing.")
    parser.add_argument("--coins", default=",".join(COINS), help="coins to replay, with commas (default: ten big ones)")
    parser.add_argument("--out", default="", help="also write the numbers to this JSON file")
    args = parser.parse_args()
    coins = [coin.strip().upper() for coin in args.coins.split(",") if coin.strip()]

    warm, end = utc_ms(2020), int(time.time() * 1000)
    today = datetime.datetime.fromtimestamp(end / 1000, datetime.timezone.utc)
    recent = utc_ms(today.year - 3, today.month, min(today.day, 28))
    out = {"at": today.strftime("%Y-%m-%d %H:%M UTC"), "coins": {}, "errors": {}}
    lists = {}
    for coin in coins:
        try:
            plan.chunk = chunk_for(coin)
            signals = plan.candles("binance", warm, end)
            prices = plan.candles("indodax", warm, end)
            first = max(signals[0]["t"], prices[0]["t"])
            start = max(first + 60 * 86400 * 1000, utc_ms(2020, 3))  # 60 days for the slow averages to settle
            done = copies(plan.strategy_trades(signals), prices, start)
        except Exception as problem:  # one coin that cannot be read does not end the study
            out["errors"][coin] = f"{type(problem).__name__}: {problem}"[:200]
            continue
        lists[coin] = done
        out["coins"][coin] = {
            "from": datetime.datetime.fromtimestamp(start / 1000, datetime.timezone.utc).strftime("%Y-%m-%d"),
            "all": figures(done, start, end),
            "before": figures([item for item in done if item[0] < recent], start, recent),
            "last3years": figures([item for item in done if item[0] >= recent], recent, end),
        }

    print(f"The rules that trade, Rp{ORDER:,.0f} per buy, replayed on {len(lists)} coins. Past prices: not a promise.".replace(",", "."))
    for title, key in (("All the years Indodax has prices", "all"), ("The last three years alone", "last3years")):
        print(f"\n{title}")
        for coin in lists:
            print(line(coin + (f" ({out['coins'][coin]['from'][:4]})" if key == "all" else ""), out["coins"][coin][key]))
    judged = {coin: row for coin, row in out["coins"].items() if row["before"].get("trades") and row["last3years"].get("trades")}
    if len(judged) > 1:
        best = max(judged, key=lambda coin: judged[coin]["before"]["total"])
        out["pickedByPast"] = {"coin": best, "before": judged[best]["before"]["total"], "after": judged[best]["last3years"]["total"]}
        print(f"\nPicked by the past: {best} made the most before the last three years ({rp(judged[best]['before']['total'])}); in them it made {rp(judged[best]['last3years']['total'])}.")
    common = utc_ms(2021)
    since = {coin: [item for item in items if item[0] >= common] for coin, items in lists.items()}
    slots = {"BTC": ["BTC"], "BTC+ETH+SOL": ["BTC", "ETH", "SOL"], "all": list(lists)}
    out["oneSlotSince2021"] = {
        name: mix(since, wanted, common, end)
        for name, wanted in slots.items()
        if set(wanted) <= set(lists)
    }
    print("\nOne buy at a time, since 2021 (two coins signal together: the first in the list is bought)")
    for name, row in out["oneSlotSince2021"].items():
        print(line(name, row))
        if row.get("ordersTried"):
            low, high = row["perYearRange"]
            deep, shallow = row["deepestDipRange"]
            print(f"  {'':<14} with the coins in another order ({row['ordersTried']} tried): {rp(low)} to {rp(high)} a year, deepest dip {rp(deep)} to {rp(shallow)}")
    for coin, problem in out["errors"].items():
        print(f"\n{coin} could not be read: {problem}")
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
