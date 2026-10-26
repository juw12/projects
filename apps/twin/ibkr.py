"""Interactive Brokers bridge for the local Twin server (IBKR Client Portal Web API).

Why IBKR: Alpaca trades US listings only. IBKR's Client Portal Gateway lets a retail account
trade stocks on many exchanges worldwide (which ones depends on the account's country and
market permissions).

How it works:
  * The user runs IBKR's Client Portal Gateway on the same computer and logs in there
    (https://localhost:5000). Twin never sees the IBKR username or password.
  * Twin talks only to that local gateway (loopback hosts only; the URL comes from the
    TWIN_IBKR_URL environment variable, never from browser input).
  * Every order is resolved to an exact IBKR contract (conid on the listing's exchange),
    previewed with IBKR's what-if endpoint, and placed only with a single-use preview id.
  * The same guard-rails as the Alpaca bridge: paper by default, live needs the Twin password
    plus a typed phrase, per-order cap in US dollars, daily live order cap, no short selling,
    whole shares only (IBKR's API takes whole shares for stocks).

Endpoint and field names follow IBKR's Client Portal Web API documentation. Twin is tested
against a mock gateway; try a paper account first.
"""
import json
import math
import os
import re
import secrets
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from broker import BrokerError, DEFAULT_MAX_ORDER, LIVE_DEFAULT_DAILY_ORDERS, LIVE_PHRASE, PREVIEW_TTL, _num

GATEWAY_URL = os.environ.get("TWIN_IBKR_URL", "https://localhost:5000/v1/api").rstrip("/")
LOOPBACK = {"localhost", "127.0.0.1", "::1"}
ORDER_TYPES = {"market": "MKT", "limit": "LMT", "stop": "STP", "stop_limit": "STOP_LIMIT", "trailing_stop": "TRAIL"}
WHOLE_UNIT_CURRENCIES = {"JPY", "KRW", "IDR", "HUF", "CLP", "VND"}
OPEN_STATUSES = {"PreSubmitted", "Submitted", "PendingSubmit", "PendingCancel", "Inactive"}

# Yahoo suffix -> exchange codes IBKR commonly shows in a contract's companyHeader / description.
# Used only to pick the right listing; the user always sees the chosen contract before confirming.
EXCHANGE_HINTS = {
    "": ["NASDAQ", "NYSE", "ARCA", "AMEX", "BATS"], "T": ["TSEJ"], "HK": ["SEHK"], "L": ["LSE"],
    "DE": ["IBIS", "XETRA"], "F": ["FWB"], "PA": ["SBF"], "AS": ["AEB"], "BR": ["EBR", "ENEXT.BE"],
    "MI": ["BVME"], "MC": ["BM"], "SW": ["EBS"], "ST": ["SFB"], "CO": ["CPH"], "HE": ["HEX"],
    "OL": ["OSE"], "TO": ["TSE"], "V": ["VENTURE"], "AX": ["ASX"], "SI": ["SGX"], "NS": ["NSE"],
    "BO": ["BSE"], "MX": ["MEXI"], "JO": ["JSE"], "TA": ["TASE"], "NZ": ["NZE"], "VI": ["VSE"],
    "LS": ["BVL"], "WA": ["WSE"], "IR": ["ISED"], "SS": ["SEHKNTL"], "SZ": ["SEHKSZSE"], "KS": ["KSE"],
}


def _loopback_only(url):
    host = urllib.parse.urlparse(url).hostname or ""
    if host not in LOOPBACK:
        raise BrokerError("Twin only talks to an IBKR gateway on this computer (localhost).")


def _gateway_context():
    # The Client Portal Gateway serves a self-signed certificate on localhost.
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def ibkr_symbol(yahoo_symbol):
    """Yahoo listing symbol -> the ticker IBKR uses on that exchange (7203.T -> 7203, 0700.HK -> 700)."""
    base, _, suffix = yahoo_symbol.partition(".")
    if suffix == "HK":
        base = base.lstrip("0") or "0"
    return base.replace("-", " ").upper(), suffix.upper()


def _round_price(value, currency):
    raw = _num(value, "price", 0, 1e9)
    if currency in WHOLE_UNIT_CURRENCIES:
        return float(round(raw))
    return round(raw, 2) if raw >= 1 else round(raw, 4)


def _f(row, *keys):
    for key in keys:
        value = row.get(key)
        if isinstance(value, dict):
            value = value.get("amount")
        try:
            if value not in (None, ""):
                return float(str(value).replace(",", ""))
        except ValueError:
            continue
    return None


class IbkrBroker:
    provider = "ibkr"

    def __init__(self, data_dir, load_json, save_json, quote_fn, fx_fn):
        self.data_dir = data_dir
        self.load_json = load_json
        self.save_json = save_json
        self.quote_fn = quote_fn
        self.fx_fn = fx_fn
        self.previews = {}
        self.replies = {}
        self.lock = threading.RLock()
        try:
            _loopback_only(GATEWAY_URL)
            self.url_error = None
        except BrokerError as exc:
            self.url_error = str(exc)
        self.ctx = _gateway_context()

    # ------------------------------------------------------------ storage
    def _path(self, uid):
        return self.data_dir / "users" / uid / "broker.json"

    def _config(self, uid):
        cfg = self.load_json(self._path(uid), None)
        return cfg if isinstance(cfg, dict) and cfg.get("provider") == "ibkr" else None

    def _require(self, uid):
        cfg = self._config(uid)
        if not cfg:
            raise BrokerError("No broker connected. Connect Interactive Brokers in Me → Real trading.")
        return cfg

    # --------------------------------------------------------------- HTTP
    def _request(self, method, path, body=None):
        if self.url_error:
            raise BrokerError(self.url_error)
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(GATEWAY_URL + path, data=data, method=method, headers={
            "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Twin/1.5",
        })
        try:
            with urllib.request.urlopen(request, timeout=20, context=self.ctx) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as exc:
            message = ""
            try:
                payload = json.loads(exc.read().decode("utf-8"))
                message = payload.get("error") or payload.get("message") or ""
            except Exception:
                pass
            if exc.code == 401:
                raise BrokerError("The IBKR gateway is not logged in. Open https://localhost:5000 and sign in, then try again.")
            raise BrokerError("IBKR: %s" % (message or "HTTP %s" % exc.code))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise BrokerError("Can't reach the IBKR gateway at %s (%s). Is the Client Portal Gateway running?"
                              % (GATEWAY_URL.rsplit("/v1", 1)[0], getattr(exc, "reason", exc)))

    def _session(self):
        auth = self._request("POST", "/iserver/auth/status")
        if not auth.get("authenticated"):
            raise BrokerError("The IBKR gateway is running but not logged in. Sign in at https://localhost:5000.")
        accounts = self._request("GET", "/iserver/accounts")
        ids = accounts.get("accounts") or []
        if not ids:
            raise BrokerError("IBKR returned no tradable accounts for this login.")
        account = accounts.get("selectedAccount") or ids[0]
        return account, bool(accounts.get("isPaper"))

    def _summary(self, account):
        raw = self._request("GET", "/portfolio/%s/summary" % urllib.parse.quote(account))
        lower = {str(k).lower(): v for k, v in raw.items()} if isinstance(raw, dict) else {}
        currency = None
        for key in ("netliquidation", "availablefunds", "buyingpower"):
            if isinstance(lower.get(key), dict) and lower[key].get("currency"):
                currency = lower[key]["currency"]
                break
        return {
            "currency": currency or "USD",
            "equity": _f(lower, "netliquidation"),
            "cash": _f(lower, "availablefunds", "totalcashvalue"),
            "buying_power": _f(lower, "buyingpower"),
        }

    def _usd(self, amount, currency):
        if amount is None:
            return None
        if not currency or currency == "USD":
            return amount
        try:
            return amount * self.fx_fn(currency)
        except Exception:
            return None

    # ------------------------------------------------------------- account
    def status(self, uid):
        cfg = self._config(uid)
        if not cfg:
            return {"connected": False, "live_phrase": LIVE_PHRASE}
        result = {
            "connected": True, "provider": "ibkr", "mode": cfg.get("mode", "paper"),
            "key_hint": "gateway", "account_hint": "…" + str(cfg.get("account", ""))[-4:],
            "max_order_usd": cfg.get("max_order_usd"), "connected_at": cfg.get("connected_at"),
            "live_phrase": LIVE_PHRASE, "gateway": GATEWAY_URL.rsplit("/v1", 1)[0],
        }
        try:
            self._request("POST", "/tickle")
            account, is_paper = self._session()
            if account != cfg.get("account"):
                result["error"] = "The gateway is logged in to a different IBKR account. Reconnect in Me → Real trading."
            summary = self._summary(account)
            result["account"] = {**summary, "account_number_hint": "…" + str(account)[-4:], "status": "ACTIVE",
                                 "paper": is_paper}
        except BrokerError as exc:
            result["error"] = str(exc)
        return result

    def connect(self, uid, mode, phrase="", max_order_usd=None, password_ok=False):
        if mode not in ("paper", "live"):
            raise BrokerError("mode must be paper or live")
        account, is_paper = self._session()
        if mode == "paper" and not is_paper:
            raise BrokerError("The IBKR gateway is logged in to a LIVE account. Log in with your paper account, "
                              "or choose Live and confirm.")
        if mode == "live":
            if is_paper:
                raise BrokerError("The IBKR gateway is logged in to a paper account; choose Paper.")
            if not password_ok:
                raise BrokerError("Enter your Twin password to turn on live trading.")
            if str(phrase or "").strip().upper() != LIVE_PHRASE:
                raise BrokerError("Type %s to confirm you understand live orders use real money." % LIVE_PHRASE)
        cap = DEFAULT_MAX_ORDER[mode] if max_order_usd in (None, "") else _num(max_order_usd, "max order ($)", 0, 1e7)
        cfg = {
            "provider": "ibkr", "mode": mode, "account": account, "max_order_usd": round(cap, 2),
            "connected_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "orders_today": {"date": "", "count": 0},
        }
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
        rows = self._request("GET", "/portfolio/%s/positions/0" % urllib.parse.quote(cfg["account"]))
        known = cfg.get("symbols") or {}
        out = []
        for p in rows if isinstance(rows, list) else []:
            qty = _f(p, "position")
            if not qty:
                continue
            avg_cost = _f(p, "avgPrice", "avgCost")
            gain = _f(p, "unrealizedPnl")
            basis = abs(qty) * avg_cost if avg_cost else None
            out.append({
                "symbol": p.get("ticker") or p.get("contractDesc"), "conid": p.get("conid"),
                # Yahoo-style symbol Twin used when it placed the order, so the app can open the stock page.
                "twin_symbol": known.get(str(p.get("conid"))),
                "qty": qty, "avg_cost": avg_cost, "price": _f(p, "mktPrice"),
                "value": _f(p, "mktValue"), "gain": gain, "currency": p.get("currency"),
                "gain_pct": round(gain / basis * 100, 2) if gain is not None and basis else None,
                "exchange": p.get("listingExchange"), "side": "long" if qty > 0 else "short",
            })
        return out

    def orders(self, uid, which="open"):
        cfg = self._require(uid)
        self._session()
        data = self._request("GET", "/iserver/account/orders")
        rows = data.get("orders") if isinstance(data, dict) else data
        out = []
        for o in rows or []:
            if o.get("acct") and o.get("acct") != cfg["account"]:
                continue
            is_open = o.get("status") in OPEN_STATUSES
            if (which == "open") != is_open:
                continue
            out.append({
                "id": str(o.get("orderId")), "symbol": o.get("ticker"), "side": str(o.get("side", "")).lower(),
                "type": o.get("orderType"), "qty": o.get("totalSize"), "filled_qty": o.get("filledQuantity"),
                "filled_avg_price": o.get("avgPrice"), "limit_price": o.get("price"), "status": o.get("status"),
                "exchange": o.get("listingExchange"), "description": o.get("orderDesc"), "currency": o.get("cashCcy"),
            })
        return out

    # ---------------------------------------------------------------- orders
    def resolve_contract(self, yahoo_symbol, conid=None):
        """Find the IBKR stock contract for a Yahoo listing. Returns (contract, candidates)."""
        ticker, suffix = ibkr_symbol(yahoo_symbol)
        found = self._request("GET", "/iserver/secdef/search?" + urllib.parse.urlencode({"symbol": ticker, "secType": "STK"}))
        candidates = []
        for row in found if isinstance(found, list) else []:
            if row.get("conid") in (None, "", "-1"):
                continue
            if row.get("secType") not in (None, "STK"):
                continue
            header = " ".join(str(row.get(k) or "") for k in ("companyHeader", "companyName", "description"))
            candidates.append({"conid": str(row["conid"]), "header": row.get("companyHeader") or row.get("companyName") or ticker,
                               "symbol": row.get("symbol") or ticker, "text": header.upper()})
        if not candidates:
            raise BrokerError("IBKR has no stock contract for %s (searched %r). Check your market permissions." % (yahoo_symbol, ticker))
        if conid:
            match = [c for c in candidates if c["conid"] == str(conid)]
            if not match:
                raise BrokerError("That IBKR contract is not one of the matches for %s." % yahoo_symbol)
            return match[0], candidates
        hints = EXCHANGE_HINTS.get(suffix, [])
        preferred = [c for c in candidates if any(re.search(r"\b%s\b" % re.escape(h), c["text"]) for h in hints)]
        if len(preferred) == 1:
            return preferred[0], candidates
        if len(candidates) == 1:
            return candidates[0], candidates
        return None, candidates

    def build_order(self, fields, quote):
        symbol = str(fields.get("symbol") or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,15}", symbol) or symbol.startswith("^"):
            raise BrokerError("enter a valid stock symbol, e.g. 7203.T or VOD.L")
        side = fields.get("side")
        if side not in ("buy", "sell"):
            raise BrokerError("side must be buy or sell")
        kind = fields.get("type") or "market"
        if kind == "trailing":
            kind = "trailing_stop"
        if kind not in ORDER_TYPES:
            raise BrokerError("unsupported order type")
        currency = quote.get("currency") or "USD"
        price = float(quote.get("price") or 0)
        fx = float(quote.get("fx_usd") or (1.0 if currency == "USD" else 0)) or None
        has_qty = fields.get("qty") not in (None, "")
        has_dollars = fields.get("dollars") not in (None, "") or fields.get("notional") not in (None, "")
        if has_qty == has_dollars:
            raise BrokerError("enter either shares or a dollar amount")
        if has_dollars:
            dollars = _num(fields.get("dollars") or fields.get("notional"), "amount", 0, 1e7)
            if not (price and fx):
                raise BrokerError("No current price for %s; enter whole shares instead." % symbol)
            qty = math.floor(dollars / (price * fx))
            if qty < 1:
                raise BrokerError("$%.2f buys less than one share of %s (≈ $%.2f each). IBKR orders here are whole shares."
                                  % (dollars, symbol, price * fx))
        else:
            qty = _num(fields.get("qty"), "shares", 0, 1e7)
            if abs(qty - round(qty)) > 1e-9:
                raise BrokerError("IBKR orders through Twin use whole shares")
            qty = int(round(qty))
        tif = (fields.get("time_in_force") or ("day" if kind == "market" else "gtc")).upper()
        if tif not in ("DAY", "GTC"):
            raise BrokerError("time in force must be day or gtc")
        order = {"orderType": ORDER_TYPES[kind], "side": side.upper(), "quantity": qty, "tif": tif,
                 "cOID": "twin-" + secrets.token_hex(8)}
        if kind == "limit":
            order["price"] = _round_price(fields.get("limit") or fields.get("limit_price"), currency)
        elif kind == "stop":
            order["price"] = _round_price(fields.get("stop") or fields.get("stop_price"), currency)
        elif kind == "stop_limit":
            order["price"] = _round_price(fields.get("limit") or fields.get("limit_price"), currency)
            order["auxPrice"] = _round_price(fields.get("stop") or fields.get("stop_price"), currency)
        elif kind == "trailing_stop":
            pct = _num(fields.get("trail_pct") or fields.get("trail_percent"), "trail %", 0, 50)
            if not price:
                raise BrokerError("No current price to anchor the trailing stop.")
            order["trailingType"] = "%"
            order["trailingAmt"] = round(pct, 2)
            direction = -1 if side == "sell" else 1
            order["price"] = _round_price(price * (1 + direction * pct / 100), currency)
        children = []
        tp, sl = fields.get("take_profit"), fields.get("stop_loss")
        if tp not in (None, "") or sl not in (None, ""):
            if side != "buy" or kind not in ("market", "limit"):
                raise BrokerError("take-profit / stop-loss brackets attach to market or limit buy orders")
            if tp not in (None, ""):
                children.append({"orderType": "LMT", "side": "SELL", "quantity": qty, "tif": "GTC",
                                 "price": _round_price(tp, currency), "parentId": order["cOID"]})
            if sl not in (None, ""):
                children.append({"orderType": "STP", "side": "SELL", "quantity": qty, "tif": "GTC",
                                 "price": _round_price(sl, currency), "parentId": order["cOID"]})
        return {"symbol": symbol, "currency": currency, "fx_usd": fx, "reference": price or None,
                "order": order, "children": children, "kind": kind}

    @staticmethod
    def describe(built, contract):
        o = built["order"]
        cur = built["currency"]
        detail = {
            "MKT": "at market", "LMT": "limit %s %s" % (o.get("price"), cur), "STP": "stop %s %s" % (o.get("price"), cur),
            "STOP_LIMIT": "stop %s → limit %s %s" % (o.get("auxPrice"), o.get("price"), cur),
            "TRAIL": "trailing %s%%" % o.get("trailingAmt"),
        }[o["orderType"]]
        text = "%s %s sh %s (%s) %s, %s" % (o["side"], o["quantity"], built["symbol"], contract["header"], detail,
                                            "good till cancelled" if o["tif"] == "GTC" else "today only")
        for child in built["children"]:
            text += " · %s %s %s" % ("take-profit" if child["orderType"] == "LMT" else "stop-loss", child["price"], cur)
        return text

    def _validate(self, uid, cfg, account, built, contract, symbol, limits):
        """Checks run at preview AND again immediately before submission (same rules as Alpaca).

        This is an estimate gate, not a guaranteed fill or stop-loss price.
        Returns (estimate_local, estimate_usd, account summary, warnings).
        """
        warnings = []
        o = built["order"]
        basis = float(o.get("price") or built["reference"] or 0)
        estimate_local = o["quantity"] * basis if basis else None
        estimate_usd = estimate_local * built["fx_usd"] if estimate_local is not None and built["fx_usd"] else None
        summary = self._summary(account)
        stop_child = next((c for c in built["children"] if c["orderType"] == "STP"), None)
        profit_child = next((c for c in built["children"] if c["orderType"] == "LMT"), None)
        if built["children"]:
            entry = float(o.get("price") or built["reference"] or 0)
            if entry <= 0:
                raise BrokerError("Can't validate bracket prices; set an entry limit price.")
            if stop_child and float(stop_child["price"]) >= entry:
                raise BrokerError("The stop-loss must be below the buy entry price.")
            if profit_child and float(profit_child["price"]) <= entry:
                raise BrokerError("The take-profit must be above the buy entry price.")
        if o["side"] == "BUY":
            cap = float(cfg.get("max_order_usd") or DEFAULT_MAX_ORDER[cfg.get("mode", "paper")])
            if estimate_usd is None:
                raise BrokerError("Can't estimate the order cost; set a limit price.")
            if estimate_usd > cap + 0.005:
                raise BrokerError("This order (~$%.2f) is above your max per order ($%.2f). Change it in Me → Real trading."
                                  % (estimate_usd, cap))
            bp_usd = self._usd(summary.get("buying_power"), summary.get("currency"))
            if bp_usd is None or bp_usd < 0:
                raise BrokerError("IBKR did not return valid buying power; order blocked.")
            if estimate_usd > bp_usd + 0.005:
                raise BrokerError("Not enough buying power (≈ $%.2f available)." % bp_usd)
        else:
            held = sum(p["qty"] for p in self.positions(uid) if str(p.get("conid")) == str(contract["conid"]) and p["qty"] > 0)
            if held <= 0:
                raise BrokerError("You don't hold %s at IBKR. Twin never opens short positions." % symbol)
            if o["quantity"] > held + 1e-6:
                raise BrokerError("You hold %s %s; Twin won't sell more than that (no shorting)." % (held, symbol))
        if cfg.get("mode") == "live":
            # No saved limits (e.g. quiz skipped) must not mean "unlimited" with real money.
            cap_count = int(limits.get("max_trades_per_day") or LIVE_DEFAULT_DAILY_ORDERS)
            # Never block a long-position exit just because the entry cap was reached.
            if o["side"] == "BUY" and cap_count and self._daily_used(cfg) >= cap_count:
                raise BrokerError("Daily live order limit reached (%d). Change it in Me → Trading limits." % cap_count)
            cap_loss = limits.get("max_loss_per_trade_usd")
            if stop_child and cap_loss not in (None, "") and built["fx_usd"]:
                entry = float(o.get("price") or built["reference"] or 0)
                risk_usd = (entry - float(stop_child["price"])) * o["quantity"] * built["fx_usd"]
                if risk_usd > float(cap_loss):
                    raise BrokerError("Planned stop-loss risk $%.2f exceeds your per-trade limit $%.2f." % (risk_usd, float(cap_loss)))
            if o["side"] == "BUY" and not stop_child:
                warnings.append("No attached stop-loss: the per-trade loss limit cannot be checked for this order.")
            warnings.append("LIVE: this uses real money in your IBKR account.")
        if stop_child:
            warnings.append("Planned stop-loss risk is not a maximum loss: gaps and slippage can exceed it.")
        if o["orderType"] in ("STP", "TRAIL"):
            warnings.append("Stops become market orders and can fill worse than the stop price.")
        return estimate_local, estimate_usd, summary, warnings

    @staticmethod
    def _daily_used(cfg):
        today = datetime.now(timezone.utc).date().isoformat()
        counter = cfg.get("orders_today") or {}
        return counter.get("count", 0) if counter.get("date") == today else 0

    def preview(self, uid, fields, limits=None):
        limits = limits or {}
        cfg = self._require(uid)
        account, is_paper = self._session()
        if account != cfg["account"]:
            raise BrokerError("The gateway is logged in to a different IBKR account. Reconnect in Me → Real trading.")
        if (cfg.get("mode") == "live") == is_paper:
            raise BrokerError("The gateway account type changed since you connected. Reconnect in Me → Real trading.")
        symbol = str(fields.get("symbol") or "").strip().upper()
        warnings = []
        try:
            quote = self.quote_fn(symbol)
        except Exception:
            quote = {}
            warnings.append("Could not load a current quote; the estimate uses your prices only.")
        built = self.build_order(fields, quote)
        contract, candidates = self.resolve_contract(symbol, fields.get("conid"))
        if contract is None:
            return {
                "needs_contract": True, "symbol": symbol,
                "candidates": [{"conid": c["conid"], "header": c["header"]} for c in candidates[:8]],
                "message": "IBKR lists %s on more than one exchange. Pick the listing you mean." % symbol,
            }
        estimate_local, estimate_usd, summary, checks = self._validate(uid, cfg, account, built, contract, symbol, limits)
        warnings += checks
        o = built["order"]
        ticket = dict(o, acctId=account, conid=int(contract["conid"]))
        whatif = {}
        try:
            whatif = self._request("POST", "/iserver/account/%s/orders/whatif" % urllib.parse.quote(account),
                                   {"orders": [ticket]}) or {}
        except BrokerError as exc:
            warnings.append("IBKR what-if check unavailable (%s)." % exc)
        if isinstance(whatif, dict):
            if whatif.get("error"):
                raise BrokerError("IBKR: %s" % whatif["error"])
            if whatif.get("warn"):
                warnings.append("IBKR: %s" % whatif["warn"])
        if built["currency"] != "USD":
            warnings.append("IBKR settles this trade in %s; your account may convert currency (fees can apply)." % built["currency"])
        preview_id = secrets.token_urlsafe(16)
        with self.lock:
            now = time.time()
            for key in [k for k, v in self.previews.items() if now - v["at"] > PREVIEW_TTL]:
                self.previews.pop(key, None)
            self.previews[(uid, preview_id)] = {
                "at": now, "mode": cfg.get("mode"), "account": account,
                "orders": [ticket] + [dict(c, acctId=account, conid=int(contract["conid"])) for c in built["children"]],
                "summary": self.describe(built, contract),
                "symbol": symbol, "conid": str(contract["conid"]),
                "built": built, "contract": contract, "limits": dict(limits),
            }
        amount = whatif.get("amount") if isinstance(whatif, dict) else None
        return {
            "preview_id": preview_id, "mode": cfg.get("mode"), "provider": "ibkr", "summary": self.describe(built, contract),
            "contract": {"conid": contract["conid"], "header": contract["header"]},
            "currency": built["currency"], "estimate_local": round(estimate_local, 2) if estimate_local is not None else None,
            "estimate_usd": round(estimate_usd, 2) if estimate_usd is not None else None,
            "reference_price": built["reference"], "commission": (amount or {}).get("commission"),
            "warnings": warnings, "account": summary, "expires_in": PREVIEW_TTL,
        }

    def place(self, uid, preview_id, confirm, limits=None):
        if confirm is not True:
            raise BrokerError("Confirm the order to send it.")
        with self.lock:
            cfg = self._require(uid)
            entry = self.previews.pop((uid, str(preview_id or "")), None)
            if not entry or time.time() - entry["at"] > PREVIEW_TTL:
                raise BrokerError("This preview expired or was already used. Review the order again.")
            if entry["mode"] != cfg.get("mode") or entry["account"] != cfg.get("account"):
                raise BrokerError("Broker settings changed since the preview. Review the order again.")
            account, is_paper = self._session()
            if account != entry["account"] or (cfg.get("mode") == "live") == is_paper:
                raise BrokerError("The gateway account changed since the preview. Review the order again.")
            current_limits = entry["limits"] if limits is None else dict(limits)
            # Same checks again, right before submission: cap, buying power, holdings, daily limit, risk.
            self._validate(uid, cfg, account, entry["built"], entry["contract"], entry["symbol"], current_limits)
            if cfg.get("mode") == "live" and entry["built"]["order"]["side"] == "BUY":
                # Reserve BEFORE network I/O. A timeout may mean IBKR accepted it, so failed, unknown
                # or declined submissions deliberately consume capacity; Twin never auto-retries.
                today = datetime.now(timezone.utc).date().isoformat()
                cfg["orders_today"] = {"date": today, "count": self._daily_used(cfg) + 1}
                self.save_json(self._path(uid), cfg)
        try:
            result = self._request("POST", "/iserver/account/%s/orders" % urllib.parse.quote(entry["account"]),
                                   {"orders": entry["orders"]})
        except BrokerError as exc:
            raise BrokerError("%s Check your IBKR orders before trying again (order ref %s)."
                              % (exc, entry["orders"][0].get("cOID"))) from exc
        return self._settle(uid, cfg, entry, result)

    def _settle(self, uid, cfg, entry, result):
        """Finish a placement, or hand IBKR's precautionary question back to the user.

        IBKR can answer an order with a question (e.g. "price is far from the market — are you sure?").
        Twin never answers it automatically: the user sees the exact message and decides.
        """
        if isinstance(result, list) and result and result[0].get("id") and result[0].get("message"):
            token = secrets.token_urlsafe(16)
            with self.lock:
                self.replies[(uid, token)] = {"at": time.time(), "reply_id": str(result[0]["id"]), "entry": entry}
            return {"needs_confirmation": True, "reply_token": token, "provider": "ibkr", "mode": cfg.get("mode"),
                    "messages": [str(m) for m in result[0].get("message") or []], "summary": entry["summary"]}
        placed = result if isinstance(result, list) else [result]
        if not placed or not any(r.get("order_id") for r in placed if isinstance(r, dict)):
            raise BrokerError("IBKR did not accept the order: %s" % json.dumps(result)[:200])
        with self.lock:
            fresh = self._config(uid) or cfg
            symbols = fresh.setdefault("symbols", {})
            symbols[entry["conid"]] = entry["symbol"]
            if len(symbols) > 500:
                symbols.pop(next(iter(symbols)))
            self.save_json(self._path(uid), fresh)
        first = next(r for r in placed if isinstance(r, dict) and r.get("order_id"))
        return {"order": {"id": str(first["order_id"]), "status": first.get("order_status")},
                "summary": entry["summary"], "mode": cfg.get("mode"), "provider": "ibkr"}

    def reply(self, uid, token, confirm, limits=None):
        """The user's answer to an IBKR question. confirm=False drops the order (nothing is sent)."""
        cfg = self._require(uid)
        with self.lock:
            pending = self.replies.pop((uid, str(token or "")), None)
        if not pending or time.time() - pending["at"] > PREVIEW_TTL:
            raise BrokerError("This IBKR question expired. Review the order again.")
        if pending["entry"]["mode"] != cfg.get("mode") or pending["entry"]["account"] != cfg.get("account"):
            raise BrokerError("Broker settings changed. Review the order again.")
        if confirm is not True:
            try:
                self._request("POST", "/iserver/reply/%s" % urllib.parse.quote(pending["reply_id"]), {"confirmed": False})
            except BrokerError:
                pass
            return {"cancelled": True, "provider": "ibkr"}
        result = self._request("POST", "/iserver/reply/%s" % urllib.parse.quote(pending["reply_id"]), {"confirmed": True})
        return self._settle(uid, cfg, pending["entry"], result)

    def cancel(self, uid, order_id):
        cfg = self._require(uid)
        order_id = str(order_id or "")
        if not re.fullmatch(r"\d{1,20}", order_id):
            raise BrokerError("invalid order id")
        self._session()
        self._request("DELETE", "/iserver/account/%s/order/%s" % (urllib.parse.quote(cfg["account"]), order_id))
        return {"cancelled": order_id}

    def cancel_all(self, uid):
        cancelled = 0
        for order in self.orders(uid, "open"):
            try:
                self.cancel(uid, order["id"])
                cancelled += 1
            except BrokerError:
                continue
        return {"cancelled": cancelled}
