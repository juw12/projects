"""Build web/id/snapshot.js: the offline data Twin Indonesia falls back to.

Standard library only. Sources:
  * US + IDX stocks, FX and charts: Twin's own demo snapshot in web/demo, refreshed
    hourly by world_snapshot.py (Yahoo Finance, delayed and unofficial).
  * Crypto and gold: CoinGecko public API (gold = tether-gold / XAUT, per gram).
  * Headlines: Twin's news.json (US) plus the RSS feeds in indonesia_news.py.

Usage:
    python apps/twin/scripts/indonesia_snapshot.py            # write web/id/snapshot.js
    python apps/twin/scripts/indonesia_snapshot.py --check    # fetch and validate, do not write
    python apps/twin/scripts/indonesia_snapshot.py --remote   # read Twin data from the published site

Run indonesia_ideas.py afterwards: the demo Analyst Desk is scored against this history.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
DEMO_DIR = APP_DIR / "web" / "demo"
sys.path.insert(0, str(Path(__file__).resolve().parent))

import indonesia_news  # noqa: E402

TWIN_REMOTE = "https://juw12.github.io/projects/twin/demo"
COINGECKO = "https://api.coingecko.com/api/v3"
GRAMS_PER_TROY_OUNCE = 31.1034768

US_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "NFLX", "AMD", "PLTR",
    "KO", "MCD", "JPM", "V", "COST", "DIS", "NKE", "UBER", "SPY", "VOO", "QQQ", "EIDO",
]
IDX_SYMBOLS = indonesia_news.IDX_CODES
CRYPTO = [
    ("BTC", "bitcoin", "Bitcoin"),
    ("ETH", "ethereum", "Ethereum"),
    ("SOL", "solana", "Solana"),
    ("BNB", "binancecoin", "BNB"),
    ("XRP", "ripple", "XRP"),
    ("DOGE", "dogecoin", "Dogecoin"),
]
GOLD = ("XAU", "tether-gold", "Gold · per gram")
BENCHMARKS = {"^JKSE": "IHSG · Jakarta Composite", "^GSPC": "S&P 500"}


def get_json(url: str, retries: int = 4):
    """GET JSON, backing off on rate limits (CoinGecko's free tier answers 429)."""
    for attempt in range(retries + 1):
        try:
            return json.loads(indonesia_news.fetch_bytes(url, timeout=20))
        except urllib.error.HTTPError as error:
            if attempt == retries or error.code not in (429, 500, 502, 503, 504):
                raise
            retry_after = error.headers.get("Retry-After") if error.headers else None
            wait = int(retry_after) if retry_after and retry_after.isdigit() else 20 * (attempt + 1)
            print(f"HTTP {error.code} for {url.split('?')[0]}; retrying in {min(wait, 65)} s", file=sys.stderr)
            time.sleep(min(wait, 65))
        except Exception:
            if attempt == retries:
                raise
            time.sleep(6 * (attempt + 1))


def local_twin_json(path: str):
    """One of Twin's demo data files from this checkout (web/demo/<path>)."""
    return json.loads((DEMO_DIR / path).read_text(encoding="utf-8"))


def remote_twin_json(path: str):
    """The same file from the published GitHub Pages copy."""
    return get_json(f"{TWIN_REMOTE}/{path}")


def downsample(points: list, target: int) -> list:
    if len(points) <= target:
        return points
    step = len(points) / target
    picked = [points[int(i * step)] for i in range(target)]
    if picked[-1] != points[-1]:
        picked.append(points[-1])
    return picked


def rounded(value: float, reference: float) -> float:
    """Round prices sensibly for their magnitude."""
    if reference >= 1000:
        return round(value, 2)
    if reference >= 1:
        return round(value, 4)
    return round(value, 8)


def twin_chart_name(symbol: str) -> str:
    return symbol.replace("^", "_") + ".json"


def stock_instrument(quote: dict, market: str, chart: dict | None) -> dict:
    symbol = quote["symbol"].removesuffix(".JK")
    hist = {}
    if chart:
        for key, target in (("1M", 60), ("1Y", 120)):
            points = (chart.get(key) or {}).get("points") or []
            hist[key] = [[int(t), float(p)] for t, p in downsample(points, target)]
    return {
        "symbol": symbol,
        "market": market,
        "name": quote.get("name") or symbol,
        "currency": quote.get("currency") or ("IDR" if market == "IDX" else "USD"),
        "exchange": quote.get("exchange") or ("IDX" if market == "IDX" else "US"),
        "twin": quote["symbol"],
        "price": quote["price"],
        "prev": quote.get("prev") or quote["price"],
        "changePct": round(quote.get("change_pct") or 0.0, 3),
        "dayHigh": quote.get("day_high"),
        "dayLow": quote.get("day_low"),
        "high52": quote.get("high52"),
        "low52": quote.get("low52"),
        "volume": quote.get("volume"),
        "time": quote.get("time"),
        "spark": quote.get("spark") or [],
        "hist": hist,
    }


def coingecko_history(coin_id: str, days: int, scale: float) -> list:
    payload = get_json(
        f"{COINGECKO}/coins/{coin_id}/market_chart?vs_currency=idr&days={days}"
        + ("&interval=daily" if days > 90 else "")
    )
    points = []
    for millis, price in payload.get("prices", []):
        value = price / scale
        points.append([int(millis // 1000), rounded(value, value)])
    return points


def build(twin_json=local_twin_json) -> dict:
    world = twin_json("world.json")
    quotes = world["quotes"]
    usd_per_idr = world["fx_usd"]["IDR"]

    wanted = [(s, "US") for s in US_SYMBOLS] + [(s + ".JK", "IDX") for s in IDX_SYMBOLS]
    missing = [s for s, _ in wanted if s not in quotes]
    if missing:
        raise SystemExit(f"Twin snapshot is missing: {missing}")

    chart_symbols = [s for s, _ in wanted] + list(BENCHMARKS)
    with ThreadPoolExecutor(max_workers=8) as pool:
        charts = dict(
            zip(
                chart_symbols,
                pool.map(
                    lambda s: twin_json(f"world/{twin_chart_name(s)}"),
                    chart_symbols,
                ),
            )
        )

    instruments = [stock_instrument(quotes[s], market, charts.get(s)) for s, market in wanted]

    # One batched call gives price, 24 h change and a 7-day hourly sparkline for
    # every coin; then one daily 1-year history call per coin.
    coin_ids = [cid for _, cid, _ in CRYPTO] + [GOLD[1]]
    markets = get_json(
        f"{COINGECKO}/coins/markets?vs_currency=idr&ids={','.join(coin_ids)}"
        "&sparkline=true&price_change_percentage=24h"
    )
    by_id = {row["id"]: row for row in markets}
    fx_rate = 1 / usd_per_idr
    for symbol, coin_id, name in CRYPTO + [GOLD]:
        is_gold = symbol == "XAU"
        scale = GRAMS_PER_TROY_OUNCE if is_gold else 1.0
        row = by_id[coin_id]
        price = row["current_price"] / scale
        change = row.get("price_change_percentage_24h") or 0.0
        week_prices = [p / scale for p in (row.get("sparkline_in_7d") or {}).get("price", [])]
        week_end = int(datetime.now(timezone.utc).timestamp())
        week = [
            [week_end - (len(week_prices) - 1 - index) * 3600, rounded(value, value)]
            for index, value in enumerate(week_prices)
        ]
        time.sleep(6)
        year = coingecko_history(coin_id, 365, scale)
        last_day = [value for value in week_prices[-24:]] or [price]
        updated = row.get("last_updated")
        instruments.append(
            {
                "symbol": symbol,
                "market": "GOLD" if is_gold else "CRYPTO",
                "name": name,
                "currency": "IDR",
                "exchange": "Reference price" if is_gold else "Crypto",
                "cg": coin_id,
                "unit": "gram" if is_gold else "coin",
                "price": rounded(price, price),
                "prev": rounded(price / (1 + change / 100), price),
                "changePct": round(change, 3),
                "usd": round(price / fx_rate, 6),
                "high52": rounded(max(p for _, p in year), price) if year else None,
                "low52": rounded(min(p for _, p in year), price) if year else None,
                "time": int(datetime.fromisoformat(updated.replace("Z", "+00:00")).timestamp()) if updated else None,
                "spark": [rounded(p, p) for p in downsample(last_day, 15)],
                "hist": {"1W": downsample(week, 60), "1M": year[-31:], "1Y": downsample(year, 120)},
            }
        )

    benchmarks = {}
    for symbol, name in BENCHMARKS.items():
        quote = quotes[symbol]
        year_points = (charts[symbol].get("1Y") or {}).get("points") or []
        benchmarks[symbol] = {
            "name": name,
            "price": quote["price"],
            "prev": quote.get("prev"),
            "time": quote.get("time"),
            "hist": {"1Y": [[int(t), float(p)] for t, p in downsample(year_points, 120)]},
        }

    news_items = []
    try:
        news_items.extend(indonesia_news.from_twin_news(twin_json("news.json"), limit=8))
    except Exception as error:
        print(f"twin news failed: {error!r}", file=sys.stderr)
    feed_items, feed_status = indonesia_news.collect(limit_per_feed=8)
    news_items.extend(feed_items)
    news_items.sort(key=lambda item: item.get("time") or "", reverse=True)

    return {
        "takenAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "stocks": f"Yahoo Finance via Twin demo snapshot ({world.get('snapshot_taken')}, delayed, unofficial)",
            "crypto": "CoinGecko public API",
            "gold": "CoinGecko tether-gold (XAUT) price ÷ 31.1035 g per troy ounce",
            "news": feed_status,
        },
        "fx": {
            "USDIDR": round(1 / usd_per_idr, 2),
            "asOf": datetime.fromtimestamp(world["fx_as_of"], timezone.utc).isoformat(timespec="seconds"),
        },
        "instruments": instruments,
        "benchmarks": benchmarks,
        "news": news_items[:48],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without writing")
    parser.add_argument("--remote", action="store_true", help="read Twin data from the published site")
    args = parser.parse_args()

    snapshot = build(remote_twin_json if args.remote else local_twin_json)
    counts = {}
    for instrument in snapshot["instruments"]:
        counts[instrument["market"]] = counts.get(instrument["market"], 0) + 1
        if not instrument["price"] or instrument["price"] <= 0:
            raise SystemExit(f"bad price for {instrument['symbol']}")
    print(json.dumps({"counts": counts, "news": len(snapshot["news"]), "fx": snapshot["fx"]}))
    if args.check:
        return 0

    target = APP_DIR / "web" / "id" / "snapshot.js"
    body = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(
            "/* Generated by apps/twin/scripts/indonesia_snapshot.py — do not edit by hand. */\n"
            f"window.SATU_SNAPSHOT = {body};\n"
        )
    print(f"wrote {target} ({target.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
