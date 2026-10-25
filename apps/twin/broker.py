"""Real-broker bridge for the local Twin server (Alpaca Trading API v2).

Design rules:
  * Runs only inside the user's own Twin server. The public web build never sees keys.
  * Keys are stored per Twin account in the server data folder (file mode 0600) and are
    never sent back to the browser; status shows only a masked key id.
  * The server talks only to Alpaca's fixed paper/live hosts (overridable by environment
    variables for automated tests, never by request input).
  * Paper is the default. Live requires the Twin password plus a typed confirmation phrase.
  * Every order is previewed server-side first; placing needs that single-use preview id.
  * Guard-rails: max dollars per order, daily order cap in live mode, no short selling,
    whole shares for non-market and bracket orders, account must be ACTIVE and unblocked.

Twin does not hold money, route orders itself or give advice; Alpaca is the broker.
"""
import json
import math
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

PAPER_URL = os.environ.get("TWIN_ALPACA_PAPER_URL", "https://paper-api.alpaca.markets").rstrip("/")
LIVE_URL = os.environ.get("TWIN_ALPACA_LIVE_URL", "https://api.alpaca.markets").rstrip("/")
LIVE_PHRASE = "REAL MONEY"
PREVIEW_TTL = 120
ORDER_TYPES = ("market", "limit", "stop", "stop_limit", "trailing_stop")
DEFAULT_MAX_ORDER = {"paper": 25000.0, "live": 1000.0}
LIVE_DEFAULT_DAILY_ORDERS = 3


class BrokerError(Exception):
    pass


def _num(value, name, low=None, high=None):
    if value in (None, "") or isinstance(value, bool):
        raise BrokerError("%s is required" % name)
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise BrokerError("%s must be a number" % name)
    if not math.isfinite(result):
        raise BrokerError("%s must be a real number" % name)
    if low is not None and result <= low:
        raise BrokerError("%s must be above %s" % (name, low))
    if high is not None and result > high:
        raise BrokerError("%s must be at most %s" % (name, high))
    return result


def _price(value, name):
    # Alpaca rejects sub-penny prices at or above $1; round to cents (4 dp below $1).
    raw = _num(value, name, 0, 1e7)
    return round(raw, 2) if raw >= 1 else round(raw, 4)


def _mask(key_id):
    key_id = str(key_id or "")
    return (key_id[:2] + "…" + key_id[-4:]) if len(key_id) > 8 else "set"


class Broker:
    def __init__(self, data_dir, ssl_ctx, load_json, save_json, quote_fn):
        self.data_dir = data_dir
        self.ssl_ctx = ssl_ctx
        self.load_json = load_json
        self.save_json = save_json
        self.quote_fn = quote_fn
        self.previews = {}
        self.lock = threading.RLock()

    # ------------------------------------------------------------ storage
    def _path(self, uid):
        return self.data_dir / "users" / uid / "broker.json"

    def _config(self, uid):
        cfg = self.load_json(self._path(uid), None)
        if not isinstance(cfg, dict) or not cfg.get("key_id") or not cfg.get("secret"):
            return None
        return cfg

    def _require(self, uid):
        cfg = self._config(uid)
        if not cfg:
            raise BrokerError("No broker connected. Connect Alpaca in Me → Real trading.")
        return cfg

    # --------------------------------------------------------------- HTTP
    def _request(self, cfg, method, path, body=None, base=None):
        base = base or (LIVE_URL if cfg.get("mode") == "live" else PAPER_URL)
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(base + path, data=data, method=method, headers={
            "APCA-API-KEY-ID": cfg["key_id"],
            "APCA-API-SECRET-KEY": cfg["secret"],
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Twin/1.3",
        })
        try:
            with urllib.request.urlopen(request, timeout=15, context=self.ssl_ctx) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as exc:
            message = ""
            try:
                message = json.loads(exc.read().decode("utf-8")).get("message", "")
            except Exception:
                pass
            if exc.code in (401, 403):
                raise BrokerError("Alpaca rejected the keys (%s). Check they match %s mode." % (exc.code, cfg.get("mode", "paper")))
            raise BrokerError("Alpaca: %s" % (message or "HTTP %s" % exc.code))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise BrokerError("Can't reach Alpaca right now (%s)." % getattr(exc, "reason", exc))

    # ------------------------------------------------------------- account
    def status(self, uid):
        cfg = self._config(uid)
        if not cfg:
            return {"connected": False, "live_phrase": LIVE_PHRASE}
        result = {
            "connected": True, "mode": cfg.get("mode", "paper"), "key_hint": _mask(cfg.get("key_id")),
            "max_order_usd": cfg.get("max_order_usd"), "connected_at": cfg.get("connected_at"),
            "live_phrase": LIVE_PHRASE,
        }
        try:
            acct = self._request(cfg, "GET", "/v2/account")
            result["account"] = self._account_summary(acct)
        except BrokerError as exc:
            result["error"] = str(exc)
        return result

    @staticmethod
    def _account_summary(acct):
        def f(key):
            try:
                return round(float(acct.get(key)), 2)
            except (TypeError, ValueError):
                return None
        return {
            "status": acct.get("status"), "currency": acct.get("currency", "USD"),
            "cash": f("cash"), "buying_power": f("buying_power"), "equity": f("equity"),
            "last_equity": f("last_equity"), "trading_blocked": bool(acct.get("trading_blocked")),
            "account_blocked": bool(acct.get("account_blocked")),
            "pattern_day_trader": bool(acct.get("pattern_day_trader")),
            "daytrade_count": acct.get("daytrade_count"),
            "account_number_hint": ("…" + str(acct.get("account_number", ""))[-4:]) if acct.get("account_number") else None,
        }

    def connect(self, uid, key_id, secret, mode, phrase="", max_order_usd=None, password_ok=False):
        key_id = str(key_id or "").strip()
        secret = str(secret or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9]{8,64}", key_id) or not re.fullmatch(r"[A-Za-z0-9/+=_-]{16,128}", secret):
            raise BrokerError("Paste the API key id and secret exactly as Alpaca shows them.")
        if mode not in ("paper", "live"):
            raise BrokerError("mode must be paper or live")
        if mode == "live":
            if not password_ok:
                raise BrokerError("Enter your Twin password to turn on live trading.")
            if str(phrase or "").strip().upper() != LIVE_PHRASE:
                raise BrokerError('Type %s to confirm you understand live orders use real money.' % LIVE_PHRASE)
        cap = DEFAULT_MAX_ORDER[mode] if max_order_usd in (None, "") else _num(max_order_usd, "max order ($)", 0, 1e7)
        cfg = {"key_id": key_id, "secret": secret, "mode": mode, "max_order_usd": round(cap, 2)}
        acct = self._request(cfg, "GET", "/v2/account")
        if mode == "live" and str(acct.get("status", "")).upper() != "ACTIVE":
            raise BrokerError("This Alpaca account is not ACTIVE yet (status %s)." % acct.get("status"))
        cfg["connected_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cfg["orders_today"] = {"date": "", "count": 0}
        with self.lock:
            self.save_json(self._path(uid), cfg)
        return self.status(uid)

    def disconnect(self, uid):
        with self.lock:
            try:
                self._path(uid).unlink()
            except FileNotFoundError:
                pass
            for key in [k for k in self.previews if k[0] == uid]:
                self.previews.pop(key, None)
        return {"connected": False, "live_phrase": LIVE_PHRASE}

    def settings(self, uid, max_order_usd):
        with self.lock:
            cfg = self._require(uid)
            cfg["max_order_usd"] = round(_num(max_order_usd, "max order ($)", 0, 1e7), 2)
            self.save_json(self._path(uid), cfg)
        return self.status(uid)

    def positions(self, uid):
        cfg = self._require(uid)
        rows = self._request(cfg, "GET", "/v2/positions")
        out = []
        for p in rows if isinstance(rows, list) else []:
            def f(key):
                try:
                    return round(float(p.get(key)), 4)
                except (TypeError, ValueError):
                    return None
            out.append({
                "symbol": p.get("symbol"), "qty": f("qty"), "avg_cost": f("avg_entry_price"),
                "price": f("current_price"), "value": f("market_value"), "gain": f("unrealized_pl"),
                "gain_pct": round(f("unrealized_plpc") * 100, 2) if f("unrealized_plpc") is not None else None,
                "side": p.get("side"),
            })
        return out

    def orders(self, uid, which="open"):
        cfg = self._require(uid)
        status = "open" if which == "open" else "closed"
        rows = self._request(cfg, "GET", "/v2/orders?status=%s&limit=50&nested=true" % status)
        return [self._order_summary(o) for o in (rows if isinstance(rows, list) else [])]

    @staticmethod
    def _order_summary(o):
        return {
            "id": o.get("id"), "client_order_id": o.get("client_order_id"), "symbol": o.get("symbol"),
            "side": o.get("side"), "type": o.get("type") or o.get("order_type"), "qty": o.get("qty"),
            "notional": o.get("notional"), "filled_qty": o.get("filled_qty"),
            "filled_avg_price": o.get("filled_avg_price"), "limit_price": o.get("limit_price"),
            "stop_price": o.get("stop_price"), "trail_percent": o.get("trail_percent"),
            "status": o.get("status"), "time_in_force": o.get("time_in_force"),
            "order_class": o.get("order_class"), "submitted_at": o.get("submitted_at"),
            "legs": [Broker._order_summary(leg) for leg in (o.get("legs") or [])],
        }

    # ---------------------------------------------------------------- orders
    def build_order(self, fields):
        symbol = str(fields.get("symbol") or "").strip().upper()
        if not re.fullmatch(r"[A-Z][A-Z.]{0,9}", symbol):
            raise BrokerError("enter a valid US stock or ETF ticker")
        side = fields.get("side")
        if side not in ("buy", "sell"):
            raise BrokerError("side must be buy or sell")
        kind = fields.get("type") or "market"
        if kind == "trailing":
            kind = "trailing_stop"
        if kind not in ORDER_TYPES:
            raise BrokerError("unsupported order type")
        payload = {"symbol": symbol, "side": side, "type": kind,
                   "client_order_id": "twin-" + secrets.token_hex(10)}
        has_qty = fields.get("qty") not in (None, "")
        has_notional = fields.get("notional") not in (None, "") or fields.get("dollars") not in (None, "")
        if has_qty == has_notional:
            raise BrokerError("enter either shares or a dollar amount")
        fractional = False
        if has_notional:
            if kind != "market":
                raise BrokerError("dollar-amount orders must be market orders; enter whole shares for other types")
            notional = round(_num(fields.get("notional") or fields.get("dollars"), "amount", 0, 1e7), 2)
            if notional < 1:
                raise BrokerError("Alpaca's minimum dollar order is $1")
            payload["notional"] = str(notional)
            fractional = True
        else:
            qty = _num(fields.get("qty"), "shares", 0, 1e7)
            if abs(qty - round(qty)) > 1e-9:
                if kind != "market":
                    raise BrokerError("fractional shares only work with market orders")
                fractional = True
                payload["qty"] = str(round(qty, 6))
            else:
                payload["qty"] = str(int(round(qty)))
        if kind in ("limit", "stop_limit"):
            payload["limit_price"] = str(_price(fields.get("limit") or fields.get("limit_price"), "limit price"))
        if kind in ("stop", "stop_limit"):
            payload["stop_price"] = str(_price(fields.get("stop") or fields.get("stop_price"), "stop price"))
        if kind == "trailing_stop":
            payload["trail_percent"] = str(round(_num(fields.get("trail_pct") or fields.get("trail_percent"), "trail %", 0, 50), 2))
        tif = fields.get("time_in_force") or ("day" if kind == "market" or fractional else "gtc")
        if tif not in ("day", "gtc"):
            raise BrokerError("time in force must be day or gtc")
        if fractional and tif != "day":
            raise BrokerError("fractional and dollar orders are day orders")
        payload["time_in_force"] = tif
        tp = fields.get("take_profit")
        sl = fields.get("stop_loss")
        if tp not in (None, "") or sl not in (None, ""):
            if side != "buy":
                raise BrokerError("take-profit / stop-loss brackets attach to buy orders")
            if fractional:
                raise BrokerError("brackets need whole shares (no dollar amounts or fractions)")
            if kind not in ("market", "limit"):
                raise BrokerError("brackets work with market or limit entries")
            if tp not in (None, ""):
                payload["take_profit"] = {"limit_price": str(_price(tp, "take-profit"))}
            if sl not in (None, ""):
                payload["stop_loss"] = {"stop_price": str(_price(sl, "stop-loss"))}
            payload["order_class"] = "bracket" if tp not in (None, "") and sl not in (None, "") else "oto"
        return payload

    def describe(self, payload):
        size = ("%s sh" % payload["qty"]) if "qty" in payload else ("$%s" % payload["notional"])
        detail = {
            "market": "at market",
            "limit": "limit $%s" % payload.get("limit_price"),
            "stop": "stop $%s" % payload.get("stop_price"),
            "stop_limit": "stop $%s → limit $%s" % (payload.get("stop_price"), payload.get("limit_price")),
            "trailing_stop": "trailing %s%%" % payload.get("trail_percent"),
        }[payload["type"]]
        text = "%s %s %s %s, %s" % (payload["side"].upper(), size, payload["symbol"], detail,
                                    "good till cancelled" if payload["time_in_force"] == "gtc" else "today only")
        if payload.get("take_profit"):
            text += " · take-profit $%s" % payload["take_profit"]["limit_price"]
        if payload.get("stop_loss"):
            text += " · stop-loss $%s" % payload["stop_loss"]["stop_price"]
        return text

    def preview(self, uid, fields, limits=None):
        limits = limits or {}
        cfg = self._require(uid)
        payload = self.build_order(fields)
        warnings = []
        try:
            ref = float(self.quote_fn(payload["symbol"])["price"])
        except Exception:
            ref = None
            warnings.append("Could not load a current quote; the estimate uses your prices only.")
        price_basis = float(payload.get("limit_price") or payload.get("stop_price") or ref or 0)
        if "notional" in payload:
            estimate = float(payload["notional"])
        else:
            estimate = float(payload["qty"]) * price_basis if price_basis else None
        acct = self._request(cfg, "GET", "/v2/account")
        summary = self._account_summary(acct)
        if summary["trading_blocked"] or summary["account_blocked"]:
            raise BrokerError("Alpaca says trading is blocked on this account.")
        if cfg.get("mode") == "live" and str(summary["status"]).upper() != "ACTIVE":
            raise BrokerError("The live account is not ACTIVE (status %s)." % summary["status"])
        if payload["side"] == "buy":
            cap = float(cfg.get("max_order_usd") or DEFAULT_MAX_ORDER[cfg.get("mode", "paper")])
            if estimate is None:
                raise BrokerError("Can't estimate the order cost; set a limit price.")
            if estimate > cap + 0.005:
                raise BrokerError("This order (~$%.2f) is above your max per order ($%.2f). Change it in Me → Real trading." % (estimate, cap))
            if summary["buying_power"] is not None and estimate > summary["buying_power"] + 0.005:
                raise BrokerError("Not enough buying power ($%.2f available)." % summary["buying_power"])
        else:
            held = 0.0
            for pos in self.positions(uid):
                if pos["symbol"] == payload["symbol"] and pos.get("side", "long") == "long":
                    held = pos["qty"] or 0.0
            wanted = float(payload["qty"]) if "qty" in payload else (float(payload["notional"]) / ref if ref else None)
            if held <= 0:
                raise BrokerError("You don't hold %s. Twin never opens short positions." % payload["symbol"])
            if wanted is not None and wanted > held + 1e-6:
                raise BrokerError("You hold %s %s; Twin won't sell more than that (no shorting)." % (held, payload["symbol"]))
        if cfg.get("mode") == "live":
            # No saved limits (e.g. quiz skipped) must not mean "unlimited" with real money.
            cap_count = int(limits.get("max_trades_per_day") or LIVE_DEFAULT_DAILY_ORDERS)
            today = datetime.now(timezone.utc).date().isoformat()
            used = cfg.get("orders_today", {}).get("count", 0) if cfg.get("orders_today", {}).get("date") == today else 0
            if cap_count and used >= cap_count:
                raise BrokerError("Daily live order limit reached (%d). Change it in Me → Trading limits." % cap_count)
            if summary.get("pattern_day_trader"):
                warnings.append("Alpaca flags this account as a pattern day trader.")
            cap_loss = limits.get("max_loss_per_trade_usd")
            if payload.get("stop_loss") and cap_loss and "qty" in payload:
                entry = float(payload.get("limit_price") or ref or 0)
                risk = (entry - float(payload["stop_loss"]["stop_price"])) * float(payload["qty"])
                if risk > float(cap_loss):
                    warnings.append("Max loss ≈ $%.2f is above your limit of $%.2f per trade." % (risk, float(cap_loss)))
            warnings.append("LIVE: this uses real money in your Alpaca account.")
        if payload["type"] in ("stop", "trailing_stop"):
            warnings.append("Stops become market orders and can fill worse than the stop price.")
        preview_id = secrets.token_urlsafe(16)
        with self.lock:
            now = time.time()
            for key in [k for k, v in self.previews.items() if now - v["at"] > PREVIEW_TTL]:
                self.previews.pop(key, None)
            self.previews[(uid, preview_id)] = {"at": now, "payload": payload, "mode": cfg.get("mode")}
        return {
            "preview_id": preview_id, "mode": cfg.get("mode"), "summary": self.describe(payload),
            "estimate_usd": round(estimate, 2) if estimate is not None else None,
            "reference_price": round(ref, 2) if ref else None, "warnings": warnings,
            "account": summary, "expires_in": PREVIEW_TTL,
        }

    def place(self, uid, preview_id, confirm):
        if confirm is not True:
            raise BrokerError("Confirm the order to send it.")
        cfg = self._require(uid)
        with self.lock:
            entry = self.previews.pop((uid, str(preview_id or "")), None)
        if not entry or time.time() - entry["at"] > PREVIEW_TTL:
            raise BrokerError("This preview expired or was already used. Review the order again.")
        if entry["mode"] != cfg.get("mode"):
            raise BrokerError("Broker mode changed since the preview. Review the order again.")
        order = self._request(cfg, "POST", "/v2/orders", entry["payload"])
        if cfg.get("mode") == "live":
            with self.lock:
                fresh = self._config(uid) or cfg
                today = datetime.now(timezone.utc).date().isoformat()
                counter = fresh.get("orders_today") or {}
                count = counter.get("count", 0) if counter.get("date") == today else 0
                fresh["orders_today"] = {"date": today, "count": count + 1}
                self.save_json(self._path(uid), fresh)
        return {"order": self._order_summary(order), "summary": self.describe(entry["payload"]), "mode": cfg.get("mode")}

    def cancel(self, uid, order_id):
        cfg = self._require(uid)
        order_id = str(order_id or "")
        if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", order_id):
            raise BrokerError("invalid order id")
        self._request(cfg, "DELETE", "/v2/orders/" + order_id)
        return {"cancelled": order_id}

    def cancel_all(self, uid):
        cfg = self._require(uid)
        result = self._request(cfg, "DELETE", "/v2/orders")
        return {"cancelled": len(result) if isinstance(result, list) else 0}
