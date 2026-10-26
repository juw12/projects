#!/usr/bin/env python3
"""Build the web demo's global market snapshot.

Writes web/demo/world.json (universe, indices, quotes with sparklines, FX) plus one chart file per
symbol in web/demo/world/<symbol>.json, loaded only when a stock page opens.

  python apps/twin/scripts/world_snapshot.py          # refresh (keeps the last good data for failures)
  python apps/twin/scripts/world_snapshot.py --check  # validate the files without network access

The GitHub Pages workflow runs this every hour before deploying, so the public demo stays current
without committing data. Source: Yahoo Finance (delayed, unofficial).
"""
import argparse
import json
import os
import re
import socket
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

# Prefer IPv4 when a host has both: urllib tries addresses one by one (no "happy eyeballs"),
# so a network with a broken IPv6 route would otherwise stall every market-data call.
_original_getaddrinfo = socket.getaddrinfo


def _ipv4_first_getaddrinfo(*args, **kwargs):
    infos = _original_getaddrinfo(*args, **kwargs)
    return sorted(infos, key=lambda info: info[0] != socket.AF_INET)


socket.getaddrinfo = _ipv4_first_getaddrinfo

DEMO = Path(__file__).resolve().parent.parent / "web" / "demo"
OUT = DEMO / "world.json"
CHART_DIR = DEMO / "world"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from world_universe import EXTRA, EXTRA_INDICES  # noqa: E402

# symbol, display name, country code, sector, US listing (ADR / US line) if any
UNIVERSE = [
    ("SHEL.L", "Shell", "GB", "Energy", "SHEL"),
    ("AZN.L", "AstraZeneca", "GB", "Health care", "AZN"),
    ("HSBA.L", "HSBC", "GB", "Financials", "HSBC"),
    ("ULVR.L", "Unilever", "GB", "Consumer staples", "UL"),
    ("VOD.L", "Vodafone", "GB", "Telecom", "VOD"),
    ("SAP.DE", "SAP", "DE", "Technology", "SAP"),
    ("SIE.DE", "Siemens", "DE", "Industrials", None),
    ("ALV.DE", "Allianz", "DE", "Financials", None),
    ("MC.PA", "LVMH", "FR", "Consumer discretionary", None),
    ("OR.PA", "L'Oréal", "FR", "Consumer staples", None),
    ("AIR.PA", "Airbus", "FR", "Industrials", None),
    ("TTE.PA", "TotalEnergies", "FR", "Energy", "TTE"),
    ("ASML.AS", "ASML", "NL", "Technology", "ASML"),
    ("NESN.SW", "Nestlé", "CH", "Consumer staples", None),
    ("NOVN.SW", "Novartis", "CH", "Health care", "NVS"),
    ("UBSG.SW", "UBS Group", "CH", "Financials", "UBS"),
    ("NOVO-B.CO", "Novo Nordisk", "DK", "Health care", "NVO"),
    ("SAN.MC", "Banco Santander", "ES", "Financials", "SAN"),
    ("RACE.MI", "Ferrari", "IT", "Consumer discretionary", "RACE"),
    ("VOLV-B.ST", "Volvo", "SE", "Industrials", None),
    ("7203.T", "Toyota Motor", "JP", "Consumer discretionary", "TM"),
    ("6758.T", "Sony Group", "JP", "Technology", "SONY"),
    ("9984.T", "SoftBank Group", "JP", "Telecom", None),
    ("7974.T", "Nintendo", "JP", "Communication", None),
    ("8306.T", "Mitsubishi UFJ", "JP", "Financials", "MUFG"),
    ("0700.HK", "Tencent", "HK", "Communication", None),
    ("9988.HK", "Alibaba", "HK", "Consumer discretionary", "BABA"),
    ("1299.HK", "AIA Group", "HK", "Financials", None),
    ("3690.HK", "Meituan", "HK", "Consumer discretionary", None),
    ("600519.SS", "Kweichow Moutai", "CN", "Consumer staples", None),
    ("300750.SZ", "CATL", "CN", "Industrials", None),
    ("2330.TW", "TSMC", "TW", "Technology", "TSM"),
    ("005930.KS", "Samsung Electronics", "KR", "Technology", None),
    ("000660.KS", "SK hynix", "KR", "Technology", None),
    ("RELIANCE.NS", "Reliance Industries", "IN", "Energy", None),
    ("TCS.NS", "Tata Consultancy", "IN", "Technology", None),
    ("HDFCBANK.NS", "HDFC Bank", "IN", "Financials", "HDB"),
    ("INFY.NS", "Infosys", "IN", "Technology", "INFY"),
    ("BBCA.JK", "Bank Central Asia", "ID", "Financials", None),
    ("BBRI.JK", "Bank Rakyat Indonesia", "ID", "Financials", None),
    ("TLKM.JK", "Telkom Indonesia", "ID", "Telecom", None),
    ("ASII.JK", "Astra International", "ID", "Industrials", None),
    ("GOTO.JK", "GoTo", "ID", "Technology", None),
    ("D05.SI", "DBS Group", "SG", "Financials", None),
    ("1155.KL", "Maybank", "MY", "Financials", None),
    ("PTT.BK", "PTT", "TH", "Energy", None),
    ("BHP.AX", "BHP Group", "AU", "Materials", "BHP"),
    ("CBA.AX", "Commonwealth Bank", "AU", "Financials", None),
    ("SHOP.TO", "Shopify", "CA", "Technology", "SHOP"),
    ("RY.TO", "Royal Bank of Canada", "CA", "Financials", "RY"),
    ("VALE3.SA", "Vale", "BR", "Materials", "VALE"),
    ("PETR4.SA", "Petrobras", "BR", "Energy", "PBR"),
    ("NPN.JO", "Naspers", "ZA", "Communication", None),
    ("2222.SR", "Saudi Aramco", "SA", "Energy", None),
]

INDICES = [
    ("^GSPC", "S&P 500", "US"),
    ("^IXIC", "Nasdaq", "US"),
    ("^GSPTSE", "TSX", "CA"),
    ("^BVSP", "Bovespa", "BR"),
    ("^FTSE", "FTSE 100", "GB"),
    ("^GDAXI", "DAX", "DE"),
    ("^FCHI", "CAC 40", "FR"),
    ("^STOXX50E", "Euro Stoxx 50", "EU"),
    ("^N225", "Nikkei 225", "JP"),
    ("^HSI", "Hang Seng", "HK"),
    ("000001.SS", "Shanghai", "CN"),
    ("^KS11", "KOSPI", "KR"),
    ("^TWII", "Taiwan", "TW"),
    ("^NSEI", "Nifty 50", "IN"),
    ("^JKSE", "Jakarta", "ID"),
    ("^STI", "Straits Times", "SG"),
    ("^AXJO", "ASX 200", "AU"),
    ("^TASI.SR", "Tadawul", "SA"),
]

# 3M is left out; the demo falls back to 1Y. Charts live in one small file per symbol.
STOCK_SPANS = {
    "1D": ("1d", "5m"),
    "1W": ("5d", "30m"),
    "1M": ("1mo", "1d"),
    "1Y": ("1y", "1d"),
    "5Y": ("5y", "1wk"),
}
INDEX_SPANS = {"1D": ("1d", "5m"), "1M": ("1mo", "1d"), "1Y": ("1y", "1d")}
MINOR_UNITS = {"GBp": ("GBP", 100), "GBX": ("GBP", 100), "ZAc": ("ZAR", 100), "ILA": ("ILS", 100)}

def ssl_context():
    """Use certifi or SSL_CERT_FILE when present; on macOS fall back to exporting the system roots
    (python.org builds often ship without a CA bundle)."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    if os.environ.get("SSL_CERT_FILE"):
        return ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])
    if sys.platform == "darwin":
        pem = subprocess.run(
            ["security", "find-certificate", "-a", "-p",
             "/System/Library/Keychains/SystemRootCertificates.keychain", "/Library/Keychains/System.keychain"],
            capture_output=True, text=True,
        ).stdout
        if "BEGIN CERTIFICATE" in pem:
            context = ssl.create_default_context()
            context.load_verify_locations(cadata=pem)
            return context
    return ssl.create_default_context()


SSL_CTX = ssl_context()


def fetch(url, attempts=2):
    last = None
    for attempt in range(attempts):
        for host in ("query2", "query1"):
            request = urllib.request.Request(url.replace("query2.", host + "."), headers={"User-Agent": "Mozilla/5.0 (Twin)"})
            try:
                with urllib.request.urlopen(request, timeout=15, context=SSL_CTX) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                if exc.code == 404:  # unknown symbol: retrying will not help
                    raise RuntimeError("%s: not found" % url)
                last = exc
            except Exception as exc:  # retry on network errors and throttling
                last = exc
        time.sleep(1 + attempt)
    raise RuntimeError("%s: %s" % (url, last))


def price_round(value):
    if value is None:
        return None
    magnitude = abs(value)
    digits = 4 if magnitude < 10 else 3 if magnitude < 1000 else 2 if magnitude < 100000 else 0
    return round(value, digits)


def chart(symbol, span, rng, interval):
    url = "https://query2.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=%s&includePrePost=false" % (
        urllib.parse.quote(symbol), rng, interval)
    result = fetch(url)["chart"]["result"][0]
    meta = result.get("meta", {})
    currency = meta.get("currency") or "USD"
    major, divisor = MINOR_UNITS.get(currency, (currency, 1))
    stamps = result.get("timestamp") or []
    closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    points = [[t, price_round(c / divisor)] for t, c in zip(stamps, closes) if c is not None]
    price = meta.get("regularMarketPrice")
    price = price / divisor if price is not None else None
    if span == "1D":
        prev = meta.get("previousClose") or meta.get("chartPreviousClose")
        prev = prev / divisor if prev else None
    else:
        prev = points[0][1] if points else None
    high52 = meta.get("fiftyTwoWeekHigh")
    low52 = meta.get("fiftyTwoWeekLow")
    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "price": price_round(price),
        "prev": price_round(prev),
        "change": price_round(price - prev) if price is not None and prev else None,
        "change_pct": round((price / prev - 1) * 100, 3) if price is not None and prev else None,
        "currency": major,
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "timezone": meta.get("exchangeTimezoneName"),
        "time": meta.get("regularMarketTime"),
        "day_high": price_round(meta["regularMarketDayHigh"] / divisor) if meta.get("regularMarketDayHigh") else None,
        "day_low": price_round(meta["regularMarketDayLow"] / divisor) if meta.get("regularMarketDayLow") else None,
        "high52": price_round(high52 / divisor) if high52 else None,
        "low52": price_round(low52 / divisor) if low52 else None,
        "volume": meta.get("regularMarketVolume"),
        "span": span,
        "points": points,
    }


def chart_file(symbol):
    """File name for a symbol's chart; must match chartFile() in web/demo.js."""
    return re.sub(r"[^A-Za-z0-9.\-]", "_", symbol) + ".json"


def all_stocks():
    """(symbol, name, country, sector, us_listing, check_word) for the whole universe."""
    rows = [(s, n, c, sec, adr, None) for s, n, c, sec, adr in UNIVERSE]
    seen = {r[0] for r in rows}
    for symbol, name, country, sector, check_word in EXTRA:
        if symbol not in seen:
            rows.append((symbol, name, country, sector, None, check_word))
            seen.add(symbol)
    return rows


def all_indices():
    seen, rows = set(), []
    for row in INDICES + EXTRA_INDICES:
        if row[0] not in seen:
            rows.append(row)
            seen.add(row[0])
    return rows


def load_previous():
    """Last good world.json and chart files, used for anything a refresh fails to fetch."""
    try:
        data = json.loads(OUT.read_text())
    except (OSError, ValueError):
        return {}, {}
    charts = dict(data.pop("charts", {}) or {})  # 1.4 kept charts inline
    return data, charts


def previous_chart(symbol, inline):
    if symbol in inline:
        return inline[symbol]
    try:
        return json.loads((CHART_DIR / chart_file(symbol)).read_text())
    except (OSError, ValueError):
        return None


def build(workers=10):
    stocks, indices_def = all_stocks(), all_indices()
    jobs = []
    for symbol, *_ in stocks:
        jobs += [(symbol, span, rng, interval) for span, (rng, interval) in STOCK_SPANS.items()]
    for symbol, *_ in indices_def:
        jobs += [(symbol, span, rng, interval) for span, (rng, interval) in INDEX_SPANS.items()]
    results, failures = {}, []

    def run(job):
        try:
            return job, chart(*job)
        except Exception as exc:  # keep going; report at the end
            return job, exc

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for job, data in pool.map(run, jobs):
            if isinstance(data, Exception):
                failures.append("%s %s: %s" % (job[0], job[1], data))
            else:
                results.setdefault(job[0], {})[job[1]] = data

    previous, inline_charts = load_previous()
    prev_quotes = previous.get("quotes", {})
    prev_fx = previous.get("fx_usd", {})

    currencies = sorted({spans["1D"]["currency"] for spans in results.values() if "1D" in spans} - {"USD"})
    currencies = sorted(set(currencies) | {"EUR", "GBP", "JPY", "CNY", "HKD", "INR", "IDR", "SGD", "AUD", "CAD", "KRW",
                                           "BRL", "CHF", "MYR", "THB", "PHP", "VND", "TWD", "ZAR", "SAR", "AED", "MXN"})
    fx, fx_times = {"USD": 1.0}, []
    for currency in currencies:
        try:
            # USDxxx=X keeps full precision (e.g. 16,500 IDR); xxxUSD=X is rounded to 4 decimals by Yahoo.
            meta = fetch("https://query2.finance.yahoo.com/v8/finance/chart/USD%s%%3DX?range=1d&interval=1d" % currency)["chart"]["result"][0]["meta"]
            fx[currency] = 1 / meta["regularMarketPrice"]
            if meta.get("regularMarketTime"):
                fx_times.append(meta["regularMarketTime"])
        except Exception as exc:
            if currency in prev_fx:
                fx[currency] = prev_fx[currency]
            failures.append("FX %s: %s" % (currency, exc))

    quotes, charts, universe, indices, rejected = {}, {}, [], [], []
    stale = 0
    for symbol, name, country, sector, adr, check_word in stocks:
        spans = results.get(symbol)
        if spans and "1D" in spans:
            yahoo_name = (spans["1D"].get("name") or "").lower()
            if check_word and check_word.lower() not in yahoo_name:
                rejected.append("%s: Yahoo name %r lacks %r" % (symbol, spans["1D"].get("name"), check_word))
                continue
            day = dict(spans["1D"])
            day["spark"] = [p[1] for p in day.pop("points")][::3]
            day["name"] = name
            day["fx_usd"] = fx.get(day["currency"])
            quotes[symbol] = day
            charts[symbol] = {}
            for span, data in spans.items():
                compact = dict(data, name=name, fx_usd=fx.get(data["currency"]))
                if span == "5Y":
                    compact["points"] = compact["points"][::2]  # fortnightly is plenty for a 5-year line
                charts[symbol][span] = compact
        elif symbol in prev_quotes:
            quotes[symbol] = dict(prev_quotes[symbol], stale=True)
            old = previous_chart(symbol, inline_charts)
            if old:
                charts[symbol] = old
            stale += 1
        else:
            continue
        universe.append({"symbol": symbol, "name": name, "country": country, "sector": sector,
                         "us_listing": adr, "currency": quotes[symbol].get("currency", "USD")})
    for symbol, name, country in indices_def:
        spans = results.get(symbol)
        if spans and "1D" in spans:
            day = dict(spans["1D"])
            day["spark"] = [p[1] for p in day.pop("points")][::2]
            day["name"] = name
            quotes[symbol] = day
            charts[symbol] = {span: dict(data, name=name) for span, data in spans.items()}
        elif symbol in prev_quotes:
            quotes[symbol] = dict(prev_quotes[symbol], stale=True)
            old = previous_chart(symbol, inline_charts)
            if old:
                charts[symbol] = old
            stale += 1
        else:
            continue
        indices.append({"symbol": symbol, "name": name, "country": country})
    data = {
        "snapshot_taken": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "fx_as_of": max(fx_times) if fx_times else None,
        "source": "Yahoo Finance (delayed, unofficial)",
        "refresh": "hourly on GitHub Pages",
        "universe": universe,
        "indices": indices,
        "fx_usd": fx,
        "quotes": quotes,
        "stale_count": stale,
    }
    return data, charts, failures + rejected


def write(data, charts):
    CHART_DIR.mkdir(parents=True, exist_ok=True)
    keep = set()
    for symbol, spans in charts.items():
        name = chart_file(symbol)
        keep.add(name)
        (CHART_DIR / name).write_text(json.dumps(spans, separators=(",", ":"), ensure_ascii=False))
    for old in CHART_DIR.glob("*.json"):
        if old.name not in keep:
            old.unlink()
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))


def check(data):
    problems = []
    for item in data["universe"] + data["indices"]:
        quote = data["quotes"].get(item["symbol"])
        if not quote or not quote.get("price"):
            problems.append("missing price for %s" % item["symbol"])
        if not (CHART_DIR / chart_file(item["symbol"])).exists():
            problems.append("missing chart file for %s" % item["symbol"])
    for item in data["universe"]:
        if data["fx_usd"].get(item["currency"]) is None:
            problems.append("missing FX for %s" % item["currency"])
    if "charts" in data:
        problems.append("charts must live in world/<symbol>.json, not inline")
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate the existing snapshot without network access")
    parser.add_argument("--min-stocks", type=int, default=50, help="refuse to overwrite with fewer stocks than this")
    args = parser.parse_args()
    if args.check:
        data = json.loads(OUT.read_text())
    else:
        data, charts, failures = build()
        for failure in failures:
            print("warning:", failure, file=sys.stderr)
        if len(data["universe"]) < args.min_stocks:
            print("refusing to write: only %d stocks fetched" % len(data["universe"]), file=sys.stderr)
            return 1
        write(data, charts)
    problems = check(data)
    for problem in problems:
        print("problem:", problem, file=sys.stderr)
    chart_kb = sum(p.stat().st_size for p in CHART_DIR.glob("*.json")) / 1024 if CHART_DIR.exists() else 0
    print("%s: %d stocks, %d indices, %d currencies, %d stale, %.0f KB (+ %.0f KB charts), taken %s" % (
        OUT.name, len(data["universe"]), len(data["indices"]), len(data["fx_usd"]), data.get("stale_count", 0),
        OUT.stat().st_size / 1024, chart_kb, data.get("snapshot_taken")))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
