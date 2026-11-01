"""Yahoo Finance public REST — no API key required, works through most proxies.

Returns list[dict] with the same shape Binance did, so strategy/paper code is unchanged.
"""
from __future__ import annotations

import time
from typing import Any

import requests

YAHOO_BASE = "https://query1.finance.yahoo.com"

# Binance-style symbol -> Yahoo symbol. If a symbol is not here, we pass it through as-is.
SYMBOL_MAP: dict[str, str] = {
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
    "SOLUSDT": "SOL-USD",
    "BNBUSDT": "BNB-USD",
    "XRPUSDT": "XRP-USD",
    "ADAUSDT": "ADA-USD",
    "DOGEUSDT": "DOGE-USD",
    "AVAXUSDT": "AVAX-USD",
    "MATICUSDT": "MATIC-USD",
    "LINKUSDT": "LINK-USD",
    "DOTUSDT": "DOT-USD",
    "LTCUSDT": "LTC-USD",
    "NEARUSDT": "NEAR-USD",
    "ATOMUSDT": "ATOM-USD",
    "OPUSDT": "OP-USD",
    "ARBUSDT": "ARB-USD",
}

# Binance-style interval -> Yahoo interval. Aggregated bars (2h/4h/6h/12h) start as 1h and are merged.
INTERVAL_MAP: dict[str, str] = {
    "15m": "15m",
    "30m": "30m",
    "1h": "60m",
    "2h": "60m",
    "4h": "60m",
    "6h": "60m",
    "12h": "60m",
    "1d": "1d",
    "1w": "1wk",
}

AGGREGATE_FACTOR: dict[str, int] = {
    "15m": 1, "30m": 1,
    "1h": 1, "2h": 2, "4h": 4, "6h": 6, "12h": 12,
    "1d": 1, "1w": 1,
}

_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}


def _to_yahoo(symbol: str) -> str:
    return SYMBOL_MAP.get(symbol.upper(), symbol.upper())


def _range_for(days: int) -> str:
    """Smallest Yahoo range that covers `days`."""
    if days <= 5:
        return "5d"
    if days <= 30:
        return "1mo"
    if days <= 90:
        return "3mo"
    if days <= 180:
        return "6mo"
    if days <= 365:
        return "1y"
    if days <= 730:
        return "2y"
    if days <= 1825:
        return "5y"
    return "10y"


def _fetch_chart(symbol: str, interval: str, range_: str) -> list[dict[str, Any]]:
    url = f"{YAHOO_BASE}/v8/finance/chart/{symbol}"
    params = {"interval": interval, "range": range_}
    r = requests.get(url, params=params, timeout=20, headers=_HEADERS)
    r.raise_for_status()
    payload = r.json()
    err = payload.get("chart", {}).get("error")
    if err:
        raise RuntimeError(f"yahoo error: {err}")
    result = payload["chart"]["result"][0]
    timestamps = result["timestamp"]
    quote = result["indicators"]["quote"][0]
    opens = quote["open"]
    highs = quote["high"]
    lows = quote["low"]
    closes = quote["close"]
    volumes = quote["volume"]
    bars: list[dict[str, Any]] = []
    for i, ts in enumerate(timestamps):
        o, h, l, c = opens[i], highs[i], lows[i], closes[i]
        if any(v is None for v in (o, h, l, c)):
            continue
        bars.append({
            "time": int(ts) * 1000,  # Yahoo uses seconds; convert to ms for consistency
            "open": float(o),
            "high": float(h),
            "low": float(l),
            "close": float(c),
            "volume": float(volumes[i]) if volumes[i] is not None else 0.0,
        })
    return bars


def _aggregate(bars: list[dict[str, Any]], factor: int) -> list[dict[str, Any]]:
    """Merge every N bars into one (e.g. 4 hourly bars -> 1 4-hourly bar)."""
    if factor <= 1:
        return bars
    out: list[dict[str, Any]] = []
    for i in range(0, len(bars) - (len(bars) % factor), factor):
        chunk = bars[i : i + factor]
        out.append({
            "time": chunk[0]["time"],
            "open": chunk[0]["open"],
            "high": max(b["high"] for b in chunk),
            "low": min(b["low"] for b in chunk),
            "close": chunk[-1]["close"],
            "volume": sum(b["volume"] for b in chunk),
        })
    return out


def fetch_klines(symbol: str, timeframe: str = "4h", limit: int = 250) -> list[dict[str, Any]]:
    """Latest `limit` bars for `symbol` at `timeframe`. Aggregates 1h bars for 2h/4h/6h/12h."""
    yahoo_sym = _to_yahoo(symbol)
    yahoo_interval = INTERVAL_MAP.get(timeframe, "1d")
    factor = AGGREGATE_FACTOR.get(timeframe, 1)
    hourly_needed = limit * factor
    days = max(7, hourly_needed // 24 + 7)
    range_ = _range_for(days)
    bars = _fetch_chart(yahoo_sym, yahoo_interval, range_)
    bars = _aggregate(bars, factor)
    return bars[-limit:]


def fetch_klines_range(
    symbol: str, timeframe: str, start_ms: int, end_ms: int | None = None
) -> list[dict[str, Any]]:
    """All bars of `symbol` between `start_ms` and `end_ms` at `timeframe`."""
    end_ms = end_ms or int(time.time() * 1000)
    days = max(1, (end_ms - start_ms) // (24 * 60 * 60 * 1000))
    yahoo_sym = _to_yahoo(symbol)
    yahoo_interval = INTERVAL_MAP.get(timeframe, "1d")
    factor = AGGREGATE_FACTOR.get(timeframe, 1)
    range_ = _range_for(days)
    bars = _fetch_chart(yahoo_sym, yahoo_interval, range_)
    bars = _aggregate(bars, factor)
    return [b for b in bars if start_ms <= b["time"] <= end_ms]
