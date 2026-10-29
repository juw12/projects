"""News feed helpers for Twin Indonesia (web/id/), used by indonesia_snapshot.py.

Standard library only. Feeds are RSS 2.0; every item is normalised to:

    {"id", "source", "title", "summary", "link", "time", "market", "tickers"}

`market` is one of US, IDX, CRYPTO, GOLD. `tickers` lists Twin Indonesia symbols
that the headline mentions (IDX codes, US tickers, crypto symbols, XAU for gold).
"""

from __future__ import annotations

import hashlib
import html
import re
import urllib.request
import xml.etree.ElementTree as ElementTree
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

USER_AGENT = "TwinIndonesia/1.11 (+https://github.com/juw12/projects)"

# Feeds verified reachable on 28 Oct 2026. Only Antara sends CORS headers, so the
# browser reads it live; the others are baked into web/id/snapshot.js by
# indonesia_snapshot.py (a static site cannot proxy them).
# Production use needs content licences from each publisher.
FEEDS = [
    {
        "id": "antara-bursa",
        "source": "Antara",
        "url": "https://www.antaranews.com/rss/ekonomi-bursa.xml",
        "market": "IDX",
        "filter": None,
    },
    {
        "id": "cnbc-id-market",
        "source": "CNBC Indonesia",
        "url": "https://www.cnbcindonesia.com/market/rss",
        "market": "IDX",
        "filter": None,
    },
    {
        "id": "coindesk",
        "source": "CoinDesk",
        "url": "https://www.coindesk.com/arc/outboundfeeds/rss/",
        "market": "CRYPTO",
        "filter": None,
    },
    {
        "id": "cointelegraph",
        "source": "Cointelegraph",
        "url": "https://cointelegraph.com/rss",
        "market": "CRYPTO",
        "filter": None,
    },
    {
        "id": "investing-commodities",
        "source": "Investing.com",
        "url": "https://www.investing.com/rss/news_11.rss",
        "market": "GOLD",
        "filter": r"\b(gold|emas|bullion|precious)\b",
    },
]

IDX_CODES = [
    "BBCA", "BBRI", "BMRI", "BBNI", "BRIS", "TLKM", "ASII", "GOTO", "UNVR", "ICBP",
    "INDF", "ADRO", "ANTM", "KLBF", "CPIN", "AMRT", "MDKA", "PGAS", "BUKA",
]

US_TICKERS = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "NFLX", "AMD", "PLTR",
    "KO", "MCD", "JPM", "V", "COST", "DIS", "NKE", "UBER", "SPY", "VOO", "QQQ", "EIDO",
]

US_NAMES = {
    "AAPL": r"\bapple\b",
    "MSFT": r"\bmicrosoft\b",
    "NVDA": r"\bnvidia\b",
    "AMZN": r"\bamazon\b",
    "GOOGL": r"\b(alphabet|google)\b",
    "META": r"\bmeta platforms\b",
    "TSLA": r"\btesla\b",
    "NFLX": r"\bnetflix\b",
    "AMD": r"\bamd\b",
    "PLTR": r"\bpalantir\b",
    "KO": r"\bcoca-cola\b",
    "MCD": r"\bmcdonald'?s\b",
    "JPM": r"\bjpmorgan\b",
    "COST": r"\bcostco\b",
    "DIS": r"\bdisney\b",
    "NKE": r"\bnike\b",
    "UBER": r"\buber\b",
}

CRYPTO_PATTERNS = {
    "BTC": r"\b(bitcoin|btc)\b",
    "ETH": r"\b(ethereum|ether|eth)\b",
    # "Solana" in any case, but the bare ticker only in capitals ("sol" is a word).
    "SOL": r"(?i:\bsolana\b)|\bSOL\b",
    "BNB": r"\b(bnb|binance coin)\b",
    "XRP": r"\b(xrp|ripple)\b",
    "DOGE": r"\b(dogecoin|doge)\b",
}

GOLD_PATTERN = r"\b(gold|emas|bullion|xau)\b"


def fetch_bytes(url: str, timeout: float = 10.0) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def clean_text(raw: str | None, limit: int = 240) -> str:
    if not raw:
        return ""
    without_tags = re.sub(r"<[^>]+>", " ", raw)
    unescaped = html.unescape(without_tags)
    collapsed = re.sub(r"\s+", " ", unescaped).strip()
    if len(collapsed) > limit:
        collapsed = collapsed[: limit - 1].rstrip() + "…"
    return collapsed


def parse_time(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        parsed = None
    if parsed is None:
        for pattern in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                parsed = datetime.strptime(raw, pattern)
                break
            except ValueError:
                continue
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def tag_tickers(text: str, market: str) -> list[str]:
    """Return Twin Indonesia symbols mentioned in a headline/summary."""
    found: list[str] = []

    def add(symbol: str) -> None:
        if symbol not in found:
            found.append(symbol)

    for code in IDX_CODES:
        if re.search(rf"\b{code}\b", text):
            add(code)
    for ticker in US_TICKERS:
        # Single-letter / short tickers are only trusted in $CASHTAG or (TICKER) form.
        if len(ticker) <= 2:
            if re.search(rf"(\${ticker}\b|\({ticker}\))", text):
                add(ticker)
        elif re.search(rf"(\$|\b){ticker}\b", text):
            add(ticker)
    for ticker, pattern in US_NAMES.items():
        if re.search(pattern, text, flags=re.IGNORECASE):
            add(ticker)
    for symbol, pattern in CRYPTO_PATTERNS.items():
        flags = 0 if symbol == "SOL" else re.IGNORECASE
        if re.search(pattern, text, flags=flags):
            add(symbol)
    if market == "GOLD" or re.search(GOLD_PATTERN, text, flags=re.IGNORECASE):
        if market in ("GOLD", "IDX"):
            add("XAU")
    return found


def item_id(feed_id: str, link: str, title: str) -> str:
    digest = hashlib.sha1(f"{feed_id}|{link}|{title}".encode("utf-8")).hexdigest()[:16]
    return f"{feed_id}:{digest}"


def parse_rss(payload: bytes, feed: dict, limit: int = 12) -> list[dict]:
    root = ElementTree.fromstring(payload)
    items = []
    for node in root.findall(".//item"):
        title = clean_text(node.findtext("title"), limit=200)
        link = (node.findtext("link") or "").strip()
        if not title or not link.startswith(("http://", "https://")):
            continue
        summary = clean_text(node.findtext("description"))
        if feed.get("filter") and not re.search(
            feed["filter"], f"{title} {summary}", flags=re.IGNORECASE
        ):
            continue
        market = feed["market"]
        items.append(
            {
                "id": item_id(feed["id"], link, title),
                "source": feed["source"],
                "title": title,
                "summary": summary,
                "link": link,
                "time": parse_time(node.findtext("pubDate")),
                "market": market,
                "tickers": tag_tickers(f"{title} {summary}", market),
            }
        )
        if len(items) >= limit:
            break
    return items


def from_twin_news(payload: dict, limit: int = 12) -> list[dict]:
    """Convert Twin's demo news.json (US headlines) to Twin Indonesia news items."""
    items = []
    for raw in payload.get("items", []):
        link = str(raw.get("link") or "")
        title = clean_text(raw.get("title"), limit=200)
        if not title or not link.startswith(("http://", "https://")):
            continue
        tickers = [t for t in raw.get("touches") or [raw.get("ticker")] if t in US_TICKERS]
        items.append(
            {
                "id": f"twin:{hashlib.sha1(link.encode('utf-8')).hexdigest()[:16]}",
                "source": raw.get("source") or "Yahoo Finance",
                "title": title,
                "summary": clean_text(raw.get("summary")),
                "link": link,
                "time": parse_time(raw.get("time")) or raw.get("time"),
                "market": "US",
                "tickers": tickers,
            }
        )
        if len(items) >= limit:
            break
    return items


def collect(feeds: list[dict] | None = None, fetch=fetch_bytes, limit_per_feed: int = 10):
    """Fetch every feed; return (items sorted newest first, per-feed status)."""
    feeds = feeds or FEEDS
    all_items: list[dict] = []
    status = {}
    for feed in feeds:
        try:
            items = parse_rss(fetch(feed["url"]), feed, limit=limit_per_feed)
            all_items.extend(items)
            status[feed["id"]] = {"ok": True, "items": len(items)}
        except Exception as error:  # network/parse errors are reported, not raised
            status[feed["id"]] = {"ok": False, "error": type(error).__name__}
    all_items.sort(key=lambda item: item.get("time") or "", reverse=True)
    return all_items, status
