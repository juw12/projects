"""Real-broker bridge for the local Twin server (Alpaca Trading API v2).

Design rules:
  * Runs only inside the user's own Twin server. The public web build never sees keys.
  * Keys are stored per Twin account in the server data folder (0600 on POSIX;
    Windows ACLs are not configured or verified). They are never sent back to
    the browser; status shows only a masked key id. Storage is NOT encrypted.
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


# Yahoo-style exchange suffixes for listings outside the US (US share classes use one letter: BRK.B).
NON_US_SUFFIXES = {
    "L", "T", "HK", "SS", "SZ", "NS", "BO", "KS", "KQ", "TW", "TWO", "AX", "TO", "V", "CN", "NE",
    "DE", "F", "PA", "AS", "SW", "MI", "MC", "ST", "CO", "HE", "OL", "IC", "JK", "SI", "KL", "BK",
    "SA", "MX", "JO", "TA", "SR", "QA", "AE", "IS", "NZ", "VI", "BR", "LS", "IR", "WA", "PR", "BD", "AT",
}


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
    rounded = round(raw, 2) if raw >= 1 else round(raw, 4)
    if rounded <= 0:
        raise BrokerError("%s is below the supported price precision" % name)
    return rounded


def _mask(key_id):
    key_id = str(key_id or "")
    return (key_id[:2] + "…" + key_id[-4:]) if len(key_id) > 8 else "set"


class Broker:
    provider = "alpaca"

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

    def _guard_path(self, uid):
        # Deliberately survives disconnect/reconnect and contains no credentials.
        return self.data_dir / "users" / uid / "broker_guard.json"

    def _daily_count(self, uid, cfg):
        today = datetime.now(timezone.utc).date().isoformat()
        path = self._guard_path(uid)
        try:
            guard = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            guard = cfg.get("orders_today") or {}
        except (OSError, ValueError) as exc:
            raise BrokerError("Unreadable live order counter; resolve it before placing orders.") from exc
        if not isinstance(guard, dict):
            raise BrokerError("Unreadable live order counter; resolve it before placing orders.")
        count = guard.get("count", 0) if guard.get("date") == today else 0
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise BrokerError("Invalid live order counter; resolve it before placing orders.")
        return today, count

    def _config(self, uid):
        cfg = self.load_json(self._path(uid), None)
        if not isinstance(cfg, dict) or cfg.get("provider", "alpaca") != "alpaca" or not cfg.get("key_id") or not cfg.get("secret"):
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
            "connected": True, "provider": "alpaca", "mode": cfg.get("mode", "paper"), "key_hint": _mask(cfg.get("key_id")),
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
                value = float(acct.get(key))
                return round(value, 2) if math.isfinite(value) else None
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
        if round(cap, 2) <= 0:
            raise BrokerError("max order ($) must round to at least one cent")
        cfg = {"key_id": key_id, "secret": secret, "mode": mode, "max_order_usd": round(cap, 2)}
        acct = self._request(cfg, "GET", "/v2/account")
        if mode == "live" and str(acct.get("status", "")).upper() != "ACTIVE":
            raise BrokerError("This Alpaca account is not ACTIVE yet (status %s)." % acct.get("status"))
        cfg["connected_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cfg["orders_today"] = {"date": "", "count": 0}
        with self.lock:
            previous = self._config(uid)
            if previous:
                today, count = self._daily_count(uid, previous)
                self.save_json(self._guard_path(uid), {"date": today, "count": count})
            for key in [k for k in self.previews if k[0] == uid]:
                self.previews.pop(key, None)
            self.save_json(self._path(uid), cfg)
        return self.status(uid)

    def disconnect(self, uid):
        with self.lock:
            cfg = self._config(uid)
            if cfg and not self._guard_path(uid).exists():
                self.save_json(self._guard_path(uid), cfg.get("orders_today") or {})
            # Even a corrupt counter must not prevent the user from deleting credentials.
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
            cap = round(_num(max_order_usd, "max order ($)", 0, 1e7), 2)
            if cap <= 0:
                raise BrokerError("max order ($) must round to at least one cent")
            cfg["max_order_usd"] = cap
            self.save_json(self._path(uid), cfg)
        return self.status(uid)

    def positions(self, uid):
        cfg = self._require(uid)
        rows = self._request(cfg, "GET", "/v2/positions")
        out = []
        for p in rows if isinstance(rows, list) else []:
            def f(key):
                try:
                    value = float(p.get(key))
                    return round(value, 4) if math.isfinite(value) else None
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
        suffix = symbol.rsplit(".", 1)[1] if "." in symbol else ""
        if suffix in NON_US_SUFFIXES or re.search(r"\d", symbol):
            raise BrokerError("Alpaca trades US-listed stocks and ETFs only; %s is listed outside the US. "
                              "Use its US listing (ADR) if it has one, or connect Interactive Brokers in Me → Real trading "
                              "to trade it on its home exchange." % symbol)
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

    def _validate_order(self, uid, cfg, payload, limits):
        """Run the same checks at preview AND immediately before submission.

        This is an estimate gate, not a guaranteed fill or stop-loss price.
        Caller holds self.lock so concurrent submits cannot reuse daily capacity.
        """
        warnings = []
        try:
            ref = _num(self.quote_fn(payload["symbol"])["price"], "quote", 0)
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
        if str(summary["status"]).upper() != "ACTIVE":
            raise BrokerError("The broker account is not ACTIVE (status %s)." % summary["status"])
        if payload.get("take_profit") or payload.get("stop_loss"):
            entry_price = float(payload.get("limit_price") or ref or 0)
            if entry_price <= 0:
                raise BrokerError("Can't validate bracket prices; set an entry limit price.")
            if payload.get("stop_loss") and float(payload["stop_loss"]["stop_price"]) >= entry_price:
                raise BrokerError("The stop-loss must be below the buy entry price.")
            if payload.get("take_profit") and float(payload["take_profit"]["limit_price"]) <= entry_price:
                raise BrokerError("The take-profit must be above the buy entry price.")
        if payload["side"] == "buy":
            cap = float(cfg.get("max_order_usd") or DEFAULT_MAX_ORDER[cfg.get("mode", "paper")])
            if estimate is None:
                raise BrokerError("Can't estimate the order cost; set a limit price.")
            if estimate > cap + 0.005:
                raise BrokerError("This order (~$%.2f) is above your max per order ($%.2f). Change it in Me → Real trading." % (estimate, cap))
            if summary["buying_power"] is None or summary["buying_power"] < 0:
                raise BrokerError("Alpaca did not return valid buying power; order blocked.")
            if estimate > summary["buying_power"] + 0.005:
                raise BrokerError("Not enough buying power ($%.2f available)." % summary["buying_power"])
        else:
            held = 0.0
            for pos in self.positions(uid):
                if pos["symbol"] == payload["symbol"] and pos.get("side", "long") == "long":
                    held = pos["qty"] or 0.0
            wanted = float(payload["qty"]) if "qty" in payload else (float(payload["notional"]) / ref if ref else None)
            if held <= 0:
                raise BrokerError("You don't hold %s. Twin never opens short positions." % payload["symbol"])
            if wanted is None:
                raise BrokerError("Can't size a dollar sale without a valid quote; enter shares instead.")
            if wanted > held + 1e-6:
                raise BrokerError("You hold %s %s; Twin won't sell more than that (no shorting)." % (held, payload["symbol"]))
        if cfg.get("mode") == "live":
            # No saved limits (e.g. quiz skipped) must not mean "unlimited" with real money.
            cap_count = int(limits.get("max_trades_per_day") or LIVE_DEFAULT_DAILY_ORDERS)
            used = self._daily_count(uid, cfg)[1] if payload["side"] == "buy" else 0
            # Never prevent a long-position exit just because the entry cap was reached.
            if payload["side"] == "buy" and cap_count and used >= cap_count:
                raise BrokerError("Daily live order limit reached (%d). Change it in Me → Trading limits." % cap_count)
            if summary.get("pattern_day_trader"):
                warnings.append("Alpaca flags this account as a pattern day trader.")
            cap_loss = limits.get("max_loss_per_trade_usd")
            if payload.get("stop_loss") and cap_loss is not None and "qty" in payload:
                cap_loss = _num(cap_loss, "max loss per trade")
                entry = float(payload.get("limit_price") or ref or 0)
                risk = (entry - float(payload["stop_loss"]["stop_price"])) * float(payload["qty"])
                if risk > float(cap_loss):
                    raise BrokerError("Planned stop-loss risk $%.2f exceeds your per-trade limit $%.2f." % (risk, float(cap_loss)))
            if payload["side"] == "buy" and not payload.get("stop_loss"):
                warnings.append("No attached stop-loss: the per-trade loss limit cannot be checked for this order.")
            warnings.append("LIVE: this uses real money in your Alpaca account.")
        if payload.get("stop_loss"):
            warnings.append("Planned stop-loss risk is not a maximum loss: gaps and slippage can exceed it.")
        if payload["type"] in ("stop", "trailing_stop"):
            warnings.append("Stops become market orders and can fill worse than the stop price.")
        return {
            "estimate_usd": round(estimate, 2) if estimate is not None else None,
            "reference_price": round(ref, 2) if ref else None, "warnings": warnings,
            "account": summary,
        }

    def preview(self, uid, fields, limits=None):
        with self.lock:
            cfg = self._require(uid)
            payload = self.build_order(fields)
            limits = dict(limits or {})
            checked = self._validate_order(uid, cfg, payload, limits)
            preview_id = secrets.token_urlsafe(16)
            now = time.time()
            for key in [k for k, v in self.previews.items() if now - v["at"] > PREVIEW_TTL]:
                self.previews.pop(key, None)
            self.previews[(uid, preview_id)] = {
                "at": now, "payload": payload, "mode": cfg.get("mode"), "limits": limits,
            }
        return {
            "preview_id": preview_id, "mode": cfg.get("mode"), "summary": self.describe(payload),
            **checked, "expires_in": PREVIEW_TTL,
        }

    def place(self, uid, preview_id, confirm, limits=None):
        if confirm is not True:
            raise BrokerError("Confirm the order to send it.")
        with self.lock:
            cfg = self._require(uid)
            entry = self.previews.pop((uid, str(preview_id or "")), None)
            if not entry or time.time() - entry["at"] > PREVIEW_TTL:
                raise BrokerError("This preview expired or was already used. Review the order again.")
            if entry["mode"] != cfg.get("mode"):
                raise BrokerError("Broker mode changed since the preview. Review the order again.")
            current_limits = entry["limits"] if limits is None else limits
            self._validate_order(uid, cfg, entry["payload"], current_limits)
            if cfg.get("mode") == "live" and entry["payload"]["side"] == "buy":
                today, count = self._daily_count(uid, cfg)
                # Reserve BEFORE network I/O. A timeout may mean Alpaca accepted it.
                # Failed/unknown submissions deliberately consume capacity; never auto-retry.
                self.save_json(self._guard_path(uid), {"date": today, "count": count + 1})
            try:
                order = self._request(cfg, "POST", "/v2/orders", entry["payload"])
            except BrokerError as exc:
                raise BrokerError(
                    "%s Check Alpaca orders before trying again. Client order id: %s"
                    % (exc, entry["payload"]["client_order_id"])
                ) from exc
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


class BrokerRouter:
    """One broker connection per Twin account: Alpaca (US listings) or Interactive Brokers (global)."""

    PROVIDERS = ("alpaca", "ibkr")

    def __init__(self, data_dir, ssl_ctx, load_json, save_json, quote_fn, fx_fn):
        import ibkr  # local module; imported here so Alpaca-only installs never load it at import time

        self.load_json = load_json
        self.data_dir = data_dir
        self.alpaca = Broker(data_dir, ssl_ctx, load_json, save_json, quote_fn)
        self.ibkr = ibkr.IbkrBroker(data_dir, load_json, save_json, quote_fn, fx_fn)

    def _active(self, uid):
        cfg = self.load_json(self.data_dir / "users" / uid / "broker.json", None)
        return self.ibkr if isinstance(cfg, dict) and cfg.get("provider") == "ibkr" else self.alpaca

    def status(self, uid):
        result = self._active(uid).status(uid)
        result["providers"] = list(self.PROVIDERS)
        return result

    def connect(self, uid, provider="alpaca", key_id=None, secret=None, mode="paper", phrase="", max_order_usd=None,
                password_ok=False):
        if provider not in self.PROVIDERS:
            raise BrokerError("unknown broker")
        current = self._active(uid)
        stored = self.load_json(self.data_dir / "users" / uid / "broker.json", None)
        if isinstance(stored, dict) and current.provider != provider:
            raise BrokerError("Disconnect %s first; Twin connects one broker at a time."
                              % ("Interactive Brokers" if current.provider == "ibkr" else "Alpaca"))
        if provider == "ibkr":
            return self.ibkr.connect(uid, mode, phrase=phrase, max_order_usd=max_order_usd, password_ok=password_ok)
        return self.alpaca.connect(uid, key_id, secret, mode, phrase=phrase, max_order_usd=max_order_usd,
                                   password_ok=password_ok)

    def disconnect(self, uid):
        return self._active(uid).disconnect(uid)

    def settings(self, uid, max_order_usd):
        return self._active(uid).settings(uid, max_order_usd)

    def positions(self, uid):
        return self._active(uid).positions(uid)

    def orders(self, uid, which="open"):
        return self._active(uid).orders(uid, which)

    def preview(self, uid, fields, limits=None):
        return self._active(uid).preview(uid, fields, limits)

    def place(self, uid, preview_id, confirm, limits=None):
        return self._active(uid).place(uid, preview_id, confirm, limits)

    def cancel(self, uid, order_id):
        return self._active(uid).cancel(uid, order_id)

    def cancel_all(self, uid):
        return self._active(uid).cancel_all(uid)

    def reply(self, uid, token, confirm, limits=None):
        active = self._active(uid)
        if not hasattr(active, "reply"):
            raise BrokerError("Nothing to confirm.")
        return active.reply(uid, token, confirm, limits)

    def selftest(self, uid, symbol="AAPL"):
        """Read-only IBKR gateway check (works before connecting in Twin)."""
        return self.ibkr.selftest(uid, symbol)
