"""Real-time (or labelled) quotes from the user's own data sources, on top of Yahoo.

Yahoo Finance is free but delayed and unofficial. When the user has connected something better,
Twin overlays its price on the Yahoo quote and says exactly where the number came from:

  * Interactive Brokers gateway (any market the account has data for; real-time when the user
    subscribes, otherwise IBKR's own delayed feed - Twin reports which one IBKR says it is).
  * Alpaca market data (US listings, IEX feed, real-time and free with any Alpaca account).
  * Finnhub API key (US listings real-time on the free plan; other markets need a paid plan).

Keys never leave this server. Every quote carries `source`, `realtime` and `source_time`, so the
UI never shows a delayed number as if it were live.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ALPACA_DATA_URL = os.environ.get("TWIN_ALPACA_DATA_URL", "https://data.alpaca.markets")
FINNHUB_URL = os.environ.get("TWIN_FINNHUB_URL", "https://finnhub.io")
CACHE_SECONDS = 5
YAHOO_LABEL = "Yahoo Finance (delayed, unofficial)"


class LiveQuoteError(Exception):
    pass


def is_us_listing(symbol):
    """US stocks/ETFs: no exchange suffix, not an index, not FX/futures."""
    return bool(re.fullmatch(r"[A-Z]{1,5}([.-][A-Z])?", symbol or ""))


def _epoch(stamp):
    """RFC 3339 timestamp (Alpaca: '2026-10-26T19:59:59.123456789Z') -> epoch seconds, or None."""
    from datetime import datetime
    if not isinstance(stamp, str) or "T" not in stamp:
        return None
    base = stamp.replace("Z", "").split(".")[0]
    try:
        return int(datetime.fromisoformat(base + "+00:00").timestamp())
    except ValueError:
        return None


def reconcile(live_price, yahoo_price):
    """Guard against unit or contract mix-ups between sources.

    Returns the live price in Twin's units, or None when it can't be trusted: a live price about
    100x Yahoo's is a pence/cents quote (converted); anything else more than 25% away is dropped."""
    if not yahoo_price or not live_price:
        return live_price
    ratio = live_price / yahoo_price
    if 0.75 <= ratio <= 1.25:
        return live_price
    if 75 <= ratio <= 125:
        return live_price / 100.0
    return None


class LiveQuotes:
    def __init__(self, data_dir, ssl_ctx, load_json, save_json, broker_router):
        self.data_dir = data_dir
        self.ctx = ssl_ctx
        self.load_json = load_json
        self.save_json = save_json
        self.router = broker_router
        self._cache = {}
        self._conids = {}
        self._lock = threading.Lock()

    # ----------------------------------------------------------- settings
    def _path(self, uid):
        return self.data_dir / "users" / uid / "market_data.json"

    def _settings(self, uid):
        cfg = self.load_json(self._path(uid), {})
        return cfg if isinstance(cfg, dict) else {}

    def _http(self, url, headers=None, timeout=8):
        request = urllib.request.Request(url, headers=dict({"User-Agent": "Twin/1.7"}, **(headers or {})))
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=self.ctx) as resp:
                return json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            raise LiveQuoteError("HTTP %s" % exc.code)
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            raise LiveQuoteError(str(getattr(exc, "reason", exc)))

    def set_finnhub(self, uid, key):
        """Save (or with an empty key, remove) the user's Finnhub key after a test call."""
        key = str(key or "").strip()
        cfg = self._settings(uid)
        if not key:
            cfg.pop("finnhub_key", None)
            self.save_json(self._path(uid), cfg)
            return self.status(uid)
        if not re.fullmatch(r"[A-Za-z0-9]{10,64}", key):
            raise LiveQuoteError("Paste the API key exactly as Finnhub shows it.")
        probe = self._finnhub_raw(key, "AAPL")
        if not probe.get("c"):
            raise LiveQuoteError("Finnhub did not return a price with that key.")
        cfg["finnhub_key"] = key
        self.save_json(self._path(uid), cfg)
        return self.status(uid)

    def status(self, uid):
        cfg = self._settings(uid)
        broker = self._broker_cfg(uid)
        sources = []
        if broker.get("provider") == "ibkr":
            sources.append({"id": "ibkr", "label": "Interactive Brokers", "markets": "markets your IBKR data subscriptions cover"})
        if broker.get("provider", "alpaca") == "alpaca" and broker.get("key_id"):
            sources.append({"id": "alpaca", "label": "Alpaca (IEX)", "markets": "US stocks and ETFs, real-time"})
        if cfg.get("finnhub_key"):
            sources.append({"id": "finnhub", "label": "Finnhub", "markets": "US stocks real-time (free plan)"})
        key = cfg.get("finnhub_key") or ""
        return {"sources": sources, "finnhub": bool(key), "finnhub_hint": (key[:2] + "…" + key[-3:]) if key else None,
                "fallback": YAHOO_LABEL}

    def _broker_cfg(self, uid):
        cfg = self.load_json(self.data_dir / "users" / uid / "broker.json", {})
        return cfg if isinstance(cfg, dict) else {}

    # ----------------------------------------------------------- providers
    def _finnhub_raw(self, key, symbol):
        url = "%s/api/v1/quote?%s" % (FINNHUB_URL, urllib.parse.urlencode({"symbol": symbol, "token": key}))
        return self._http(url)

    def _from_finnhub(self, uid, symbol):
        key = self._settings(uid).get("finnhub_key")
        if not key or not is_us_listing(symbol):
            return None
        doc = self._finnhub_raw(key, symbol.replace("-", "."))
        price = doc.get("c")
        if not price:
            return None
        return {"price": float(price), "prev": doc.get("pc"), "day_high": doc.get("h"), "day_low": doc.get("l"),
                "source": "Finnhub (real-time)", "realtime": True, "source_time": doc.get("t")}

    def _from_alpaca(self, uid, symbol):
        cfg = self._broker_cfg(uid)
        if cfg.get("provider", "alpaca") != "alpaca" or not cfg.get("key_id") or not is_us_listing(symbol):
            return None
        alpaca_symbol = symbol.replace("-", ".")
        url = "%s/v2/stocks/%s/trades/latest?feed=iex" % (ALPACA_DATA_URL, urllib.parse.quote(alpaca_symbol))
        doc = self._http(url, headers={"APCA-API-KEY-ID": cfg["key_id"], "APCA-API-SECRET-KEY": cfg["secret"]})
        trade = doc.get("trade") or {}
        if not trade.get("p"):
            return None
        return {"price": float(trade["p"]), "source": "Alpaca IEX (real-time)", "realtime": True,
                "source_time": _epoch(trade.get("t"))}

    def _from_ibkr(self, uid, symbol):
        cfg = self._broker_cfg(uid)
        if cfg.get("provider") != "ibkr":
            return None
        ibkr = self.router.ibkr
        conid = self._conids.get(symbol)
        if not conid:
            contract, _ = ibkr.resolve_contract(symbol)
            if not contract:
                return None  # ambiguous listing: the stock page's broker picker handles that
            conid = self._conids[symbol] = contract["conid"]
        path = "/iserver/marketdata/snapshot?conids=%s&fields=31,7295,7296,6509" % conid
        row = {}
        for attempt in range(3):  # the first snapshot call only subscribes; data follows shortly
            rows = ibkr._request("GET", path)
            row = rows[0] if isinstance(rows, list) and rows else {}
            if row.get("31"):
                break
            time.sleep(0.4)
        raw = str(row.get("31") or "")
        match = re.search(r"-?\d+(\.\d+)?", raw.replace(",", ""))
        if not match:
            return None
        availability = str(row.get("6509") or "")
        realtime = availability.startswith("R")
        label = "Interactive Brokers (%s)" % ("real-time" if realtime else "delayed" if availability.startswith("D") else "last")
        return {"price": float(match.group(0)), "source": label, "realtime": realtime, "source_time": int(time.time()),
                "ibkr_availability": availability or None}

    # ----------------------------------------------------------- overlay
    def overlay(self, uid, quote):
        """Return a copy of a Yahoo quote with the best live price this user has access to."""
        out = dict(quote)
        out.setdefault("source", YAHOO_LABEL)
        out.setdefault("realtime", False)
        symbol = str(quote.get("symbol") or "").upper()
        if not uid or not symbol or symbol.startswith("^"):
            return out
        key = (uid, symbol)
        with self._lock:
            hit = self._cache.get(key)
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            live = hit[1]
        else:
            live, errors = None, []
            for provider in (self._from_ibkr, self._from_alpaca, self._from_finnhub):
                try:
                    live = provider(uid, symbol)
                except Exception as exc:  # a source failing must never break the Yahoo quote
                    errors.append("%s: %s" % (provider.__name__[6:], exc))
                    live = None
                if live:
                    break
            if not live and errors:
                out["source_errors"] = errors
            with self._lock:
                self._cache[key] = (time.time(), live)
        if not live:
            return out
        price = reconcile(live["price"], out.get("price"))
        if price is None:
            out["source_errors"] = ["%s price %.4g did not match %.4g from Yahoo; not used" % (
                live.get("source"), live["price"], out.get("price") or 0)]
            return out
        prev = out.get("prev")
        out.update({k: v for k, v in live.items() if k not in ("price", "prev", "day_high", "day_low") and v is not None})
        out["yahoo_price"] = out.get("price")
        out["price"] = price
        same_units = price == live["price"]
        if live.get("prev") and same_units:
            prev = live["prev"]
            out["prev"] = prev
        for field in ("day_high", "day_low"):
            if live.get(field) and same_units:
                out[field] = live[field]
        if prev:
            out["change"] = price - prev
            out["change_pct"] = (price / prev - 1) * 100
        return out
