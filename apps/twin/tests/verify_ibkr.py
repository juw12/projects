#!/usr/bin/env python3
"""Hermetic test of Twin's Interactive Brokers bridge against a mock Client Portal Gateway.

The mock implements the Client Portal Web API endpoints Twin uses (auth status, accounts,
summary, positions, contract search, what-if, orders with a reply/confirm step, cancel).
Quotes come from a fixed TWIN_FAKE_QUOTES file, so no network, broker or keys are involved.
"""
import http.cookiejar
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
FAILURES = []
ACCOUNT = "DU1234567"


def check(name, condition, detail=""):
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


SEARCH = {
    "7203": [{"conid": "14052", "companyHeader": "TOYOTA MOTOR CORP - TSEJ", "companyName": "TOYOTA MOTOR CORP",
              "symbol": "7203", "description": "TSEJ", "secType": "STK"}],
    "VOD": [
        {"conid": "2", "companyHeader": "VODAFONE GROUP-SP ADR - NASDAQ", "companyName": "VODAFONE GROUP-SP ADR",
         "symbol": "VOD", "description": "NASDAQ", "secType": "STK"},
        {"conid": "1", "companyHeader": "VODAFONE GROUP PLC - LSE", "companyName": "VODAFONE GROUP PLC",
         "symbol": "VOD", "description": "LSE", "secType": "STK"},
    ],
    "AMBIG": [
        {"conid": "31", "companyHeader": "AMBIG CORP - XYZA", "symbol": "AMBIG", "secType": "STK"},
        {"conid": "32", "companyHeader": "AMBIG CORP - XYZB", "symbol": "AMBIG", "secType": "STK"},
    ],
}


class MockGateway(http.server.BaseHTTPRequestHandler):
    state = {"auth": False, "paper": True, "requests": [], "orders": {}, "next_id": 987}

    def log_message(self, *args):
        pass

    def reply(self, code, payload=None):
        body = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_any(self, method):
        url = urllib.parse.urlparse(self.path)
        path = url.path.replace("/v1/api", "", 1)
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}") if length else None
        st = MockGateway.state
        st["requests"].append({"method": method, "path": path, "body": body})
        if path == "/iserver/auth/status":
            return self.reply(200, {"authenticated": st["auth"], "connected": True, "competing": False})
        if path == "/tickle":
            return self.reply(200, {"session": "x"})
        if not st["auth"]:
            return self.reply(401, {"error": "not authenticated"})
        if path == "/iserver/accounts":
            return self.reply(200, {"accounts": [ACCOUNT], "selectedAccount": ACCOUNT, "isPaper": st["paper"]})
        if path == "/portfolio/%s/summary" % ACCOUNT:
            return self.reply(200, {"netliquidation": {"amount": 100000.0, "currency": "USD"},
                                    "availablefunds": {"amount": 80000.0, "currency": "USD"},
                                    "buyingpower": {"amount": 20000.0, "currency": "USD"}})
        if path == "/portfolio/%s/positions/0" % ACCOUNT:
            return self.reply(200, [{"conid": 14052, "ticker": "7203", "position": 100, "avgPrice": 3000,
                                     "mktPrice": 3200, "mktValue": 320000, "unrealizedPnl": 20000, "currency": "JPY",
                                     "listingExchange": "TSEJ"}])
        if path == "/iserver/secdef/search":
            symbol = urllib.parse.parse_qs(url.query).get("symbol", [""])[0]
            return self.reply(200, SEARCH.get(symbol, []))
        if path == "/iserver/account/%s/orders/whatif" % ACCOUNT:
            return self.reply(200, {"amount": {"amount": "x", "commission": "80 JPY", "total": "y"},
                                    "warn": None, "error": None})
        if path == "/iserver/account/%s/orders" % ACCOUNT and method == "POST":
            st["pending"] = body
            return self.reply(200, [{"id": "reply-1", "message": ["The price is far from the market. Are you sure?"],
                                     "isSuppressed": False}])
        if path == "/iserver/reply/reply-1":
            if not (body or {}).get("confirmed"):
                return self.reply(400, {"error": "not confirmed"})
            order_id = str(st["next_id"])
            st["next_id"] += 1
            first = st["pending"]["orders"][0]
            st["orders"][order_id] = {"orderId": int(order_id), "acct": ACCOUNT, "ticker": "7203",
                                      "side": first["side"], "orderType": first["orderType"],
                                      "totalSize": first["quantity"], "status": "Submitted", "listingExchange": "TSEJ"}
            return self.reply(200, [{"order_id": order_id, "order_status": "Submitted"}])
        if path == "/iserver/account/orders":
            return self.reply(200, {"orders": list(st["orders"].values()), "snapshot": True})
        if path.startswith("/iserver/account/%s/order/" % ACCOUNT) and method == "DELETE":
            order_id = path.rsplit("/", 1)[1]
            if order_id in st["orders"]:
                st["orders"][order_id]["status"] = "Cancelled"
            return self.reply(200, {"msg": "Request was submitted", "order_id": order_id})
        return self.reply(404, {"error": "not found: %s %s" % (method, path)})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_DELETE(self):
        self.handle_any("DELETE")


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(self, path, body=None):
        request = urllib.request.Request(self.base + path, data=json.dumps(body or {}).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as err:
            return json.loads(err.read() or b"{}")


def posted_orders():
    return [r for r in MockGateway.state["requests"] if r["method"] == "POST" and r["path"] == "/iserver/account/%s/orders" % ACCOUNT]


def main():
    mock_port = free_port()
    mock = http.server.ThreadingHTTPServer(("127.0.0.1", mock_port), MockGateway)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    data_dir = tempfile.mkdtemp(prefix="twin-ibkr-")
    fake = Path(data_dir) / "fake_quotes.json"
    fake.write_text(json.dumps({
        "quotes": {
            "7203.T": {"price": 3200.0, "currency": "JPY", "fx_usd": 1 / 160, "name": "Toyota Motor"},
            "VOD.L": {"price": 1.20, "currency": "GBP", "fx_usd": 1.25, "name": "Vodafone"},
            "AMBIG.DE": {"price": 10.0, "currency": "EUR", "fx_usd": 1.1, "name": "Ambig"},
        },
        "fx_usd": {"JPY": 1 / 160, "GBP": 1.25, "EUR": 1.1},
    }))
    port = free_port()
    env = dict(os.environ, TWIN_DATA=data_dir, TWIN_FAKE_QUOTES=str(fake),
               TWIN_IBKR_URL="http://127.0.0.1:%d/v1/api" % mock_port)
    proc = subprocess.Popen([sys.executable, str(APP_DIR / "server.py"), "--port", str(port), "--no-browser"],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        c = Client(base)
        c.post("/api/signup", {"username": "globaltrader", "password": "correct-horse-1", "name": "Gita"})
        c.post("/api/quiz", {"answers": {}})

        print("Connect")
        r = c.post("/api/broker/status")
        check("starts disconnected; both brokers offered", r["broker"]["connected"] is False and "ibkr" in r["broker"].get("providers", []), str(r)[:200])
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "paper"})
        check("gateway not logged in → clear message", not r.get("ok") and "not logged in" in r.get("error", ""), r.get("error"))
        check("failed connect stores nothing", not list(Path(data_dir).rglob("broker.json")))
        MockGateway.state["auth"] = True
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "live", "password": "correct-horse-1", "phrase": "REAL MONEY"})
        check("live refused when the gateway account is paper", not r.get("ok") and "paper account" in r.get("error", ""), r.get("error"))
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "paper"})
        broker = r.get("broker", {})
        check("paper connect succeeds", r.get("ok") and broker.get("provider") == "ibkr" and broker.get("mode") == "paper", str(r)[:300])
        check("status shows IBKR equity", (broker.get("account") or {}).get("equity") == 100000.0, str(broker)[:300])
        stored = json.loads(next(Path(data_dir).rglob("broker.json")).read_text())
        check("no IBKR credentials stored (gateway holds the login)", set(stored) >= {"provider", "account"} and "secret" not in stored and "password" not in stored, str(stored))
        r = c.post("/api/broker/connect", {"provider": "alpaca", "key_id": "PKTESTPAPER123", "secret": "papersecretpapersecret1234", "mode": "paper"})
        check("one broker at a time", not r.get("ok") and "Disconnect Interactive Brokers first" in r.get("error", ""), r.get("error"))

        print("Preview + place (Tokyo listing)")
        order = {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 10, "limit": 3150.4}
        r = c.post("/api/broker/preview", {"order": order})
        p = r.get("preview") or {}
        check("preview resolves the Tokyo contract", r.get("ok") and p.get("contract", {}).get("conid") == "14052", str(r)[:300])
        check("estimate in yen and dollars", p.get("estimate_local") == 31500.0 and abs((p.get("estimate_usd") or 0) - 196.88) < 0.01, str(p)[:300])
        check("what-if commission shown", p.get("commission") == "80 JPY")
        check("currency conversion warning", any("settles this trade in JPY" in w for w in p.get("warnings", [])), str(p.get("warnings")))
        check("preview alone sends no order", not posted_orders())
        r = c.post("/api/broker/order", {"preview_id": p.get("preview_id"), "confirm": False})
        check("unconfirmed order refused", not r.get("ok"))
        r = c.post("/api/broker/order", {"preview_id": p.get("preview_id"), "confirm": True})
        check("IBKR question goes back to the user, not auto-confirmed",
              r.get("ok") and r.get("needs_confirmation") and any("far from the market" in m for m in r.get("messages", []))
              and not MockGateway.state["orders"], str(r)[:300])
        token = r.get("reply_token")
        declined = c.post("/api/broker/reply", {"reply_token": token, "confirm": False})
        check("declining IBKR's question sends nothing", declined.get("ok") and declined.get("cancelled") and not MockGateway.state["orders"], str(declined)[:200])
        reused = c.post("/api/broker/reply", {"reply_token": token, "confirm": True})
        check("a declined question can't be confirmed later", not reused.get("ok"), str(reused)[:200])
        p = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 10, "limit": 3150.4}})["preview"]
        r = c.post("/api/broker/order", {"preview_id": p.get("preview_id"), "confirm": True})
        r = c.post("/api/broker/reply", {"reply_token": r.get("reply_token"), "confirm": True})
        check("order placed after the user confirms IBKR's question", r.get("ok") and r["order"]["id"] == "987", str(r)[:300])
        sent = posted_orders()[-1]["body"]["orders"][0]
        check("payload: conid, LMT, whole-yen price, 10 shares, BUY, DAY/GTC",
              sent["conid"] == 14052 and sent["orderType"] == "LMT" and sent["price"] == 3150.0 and sent["quantity"] == 10
              and sent["side"] == "BUY" and sent["tif"] in ("DAY", "GTC") and sent["acctId"] == ACCOUNT, json.dumps(sent))
        r = c.post("/api/broker/order", {"preview_id": p.get("preview_id"), "confirm": True})
        check("preview id is single-use", not r.get("ok") and "expired or was already used" in r.get("error", ""))

        print("Contract choice")
        r = c.post("/api/broker/preview", {"order": {"symbol": "VOD.L", "side": "buy", "type": "limit", "qty": 100, "limit": 1.2}})
        check("VOD.L picks the London line, not the US ADR", r.get("ok") and r["preview"]["contract"]["conid"] == "1", str(r)[:300])
        r = c.post("/api/broker/preview", {"order": {"symbol": "AMBIG.DE", "side": "buy", "type": "limit", "qty": 1, "limit": 10}})
        check("ambiguous listing asks the user to choose", r.get("ok") and r["preview"].get("needs_contract") and len(r["preview"]["candidates"]) == 2, str(r)[:300])
        r = c.post("/api/broker/preview", {"order": {"symbol": "AMBIG.DE", "side": "buy", "type": "limit", "qty": 1, "limit": 10, "conid": "32"}})
        check("chosen contract is used", r.get("ok") and r["preview"]["contract"]["conid"] == "32", str(r)[:300])
        r = c.post("/api/broker/preview", {"order": {"symbol": "AMBIG.DE", "side": "buy", "type": "limit", "qty": 1, "limit": 10, "conid": "999"}})
        check("unknown contract id rejected", not r.get("ok"), r.get("error"))

        print("Sizing + guard-rails")
        r = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "market", "dollars": 1000}})
        check("$1,000 at ¥3,200 and 160 JPY/USD → 50 whole shares", r.get("ok") and "BUY 50 sh" in r["preview"]["summary"], str(r)[:300])
        bad = [
            ({"symbol": "7203.T", "side": "buy", "type": "market", "dollars": 30000}, "above your max per order"),
            ({"symbol": "7203.T", "side": "buy", "type": "market", "qty": 1.5}, "whole shares"),
            ({"symbol": "7203.T", "side": "buy", "type": "market", "dollars": 5}, "less than one share"),
            ({"symbol": "7203.T", "side": "sell", "type": "market", "qty": 150}, "won't sell more"),
            ({"symbol": "VOD.L", "side": "sell", "type": "market", "qty": 1}, "never opens short"),
            ({"symbol": "^N225", "side": "buy", "type": "market", "qty": 1}, "valid stock symbol"),
        ]
        for fields, message in bad:
            r = c.post("/api/broker/preview", {"order": fields})
            check("blocks: " + message, not r.get("ok") and message in r.get("error", ""), r.get("error"))
        r = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "sell", "type": "market", "qty": 50}})
        check("selling shares you hold is allowed", r.get("ok"), r.get("error"))
        r = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 10, "limit": 3100,
                                                     "take_profit": 3500, "stop_loss": 2900}})
        check("bracket preview", r.get("ok"), r.get("error"))
        placed = c.post("/api/broker/order", {"preview_id": r["preview"]["preview_id"], "confirm": True})
        c.post("/api/broker/reply", {"reply_token": placed.get("reply_token"), "confirm": True})
        sent = posted_orders()[-1]["body"]["orders"]
        check("bracket children reference the parent cOID", len(sent) == 3 and sent[1]["parentId"] == sent[0]["cOID"] == sent[2]["parentId"]
              and sent[1]["orderType"] == "LMT" and sent[2]["orderType"] == "STP", json.dumps(sent)[:300])

        print("Portfolio + cancel")
        r = c.post("/api/broker/portfolio")
        check("positions in local currency", r.get("ok") and r["positions"][0]["currency"] == "JPY" and r["positions"][0]["qty"] == 100, str(r)[:300])
        check("position links back to the Yahoo symbol Twin traded", r["positions"][0].get("twin_symbol") == "7203.T"
              and r["positions"][0].get("gain_pct") is not None, str(r["positions"][0])[:300])
        check("open orders listed", len(r.get("orders", [])) >= 2, str(r.get("orders"))[:300])
        r = c.post("/api/broker/cancel", {"id": "../../x"})
        check("order id validated", not r.get("ok"))
        r = c.post("/api/broker/cancel", {"id": "987"})
        check("cancel sends DELETE", r.get("ok") and MockGateway.state["orders"]["987"]["status"] == "Cancelled", str(r))
        r = c.post("/api/broker/cancel_all")
        check("cancel-all", r.get("ok") and r["cancelled"] >= 1, str(r))

        print("Live")
        c.post("/api/broker/disconnect")
        MockGateway.state["paper"] = False
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "paper"})
        check("paper refused when the gateway account is live", not r.get("ok") and "LIVE account" in r.get("error", ""), r.get("error"))
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "live", "phrase": "REAL MONEY"})
        check("live needs the Twin password", not r.get("ok") and "password" in r.get("error", "").lower(), r.get("error"))
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "live", "password": "correct-horse-1"})
        check("live needs the typed phrase", not r.get("ok") and "REAL MONEY" in r.get("error", ""), r.get("error"))
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "live", "password": "correct-horse-1", "phrase": "REAL MONEY"})
        check("live connects with password + phrase", r.get("ok") and r["broker"]["mode"] == "live" and r["broker"]["max_order_usd"] == 1000.0, str(r)[:300])
        r = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 10, "limit": 3100}})
        check("live preview warns about real money", r.get("ok") and any("real money" in w for w in r["preview"]["warnings"]), str(r)[:300])
        r = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 100, "limit": 3100}})
        check("live cap ($1,000) enforced", not r.get("ok") and "max per order" in r.get("error", ""), r.get("error"))
        p = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 20, "limit": 3100}})["preview"]
        c.post("/api/broker/settings", {"max_order_usd": 100})
        orders_before = len(posted_orders())
        r = c.post("/api/broker/order", {"preview_id": p["preview_id"], "confirm": True})
        check("checks run again at submission (cap lowered after preview → refused, nothing sent)",
              not r.get("ok") and "max per order" in r.get("error", "") and len(posted_orders()) == orders_before, str(r)[:300])
        c.post("/api/broker/settings", {"max_order_usd": 1000})
        p = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 10, "limit": 3100}})["preview"]
        r = c.post("/api/broker/order", {"preview_id": p["preview_id"], "confirm": True})
        stored = json.loads(next(Path(data_dir).rglob("broker.json")).read_text())
        check("live daily count reserved before sending (even while IBKR's question is open)",
              r.get("needs_confirmation") and stored.get("orders_today", {}).get("count") == 1, str(stored.get("orders_today")))
        c.post("/api/broker/reply", {"reply_token": r.get("reply_token"), "confirm": False})
        stored = json.loads(next(Path(data_dir).rglob("broker.json")).read_text())
        check("a declined live order still uses its daily slot (no free retries)", stored.get("orders_today", {}).get("count") == 1, str(stored.get("orders_today")))
        r = c.post("/api/broker/preview", {"order": {"symbol": "7203.T", "side": "buy", "type": "limit", "qty": 10, "limit": 3100,
                                                     "stop_loss": 3200}})
        check("bracket stop-loss above entry refused", not r.get("ok") and "below the buy entry" in r.get("error", ""), r.get("error"))
        r = c.post("/api/broker/disconnect")
        check("disconnect deletes the connection", r.get("ok") and not list(Path(data_dir).rglob("broker.json")))
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        mock.shutdown()

    print("Gateway address safety")
    sys.path.insert(0, str(APP_DIR))
    os.environ["TWIN_IBKR_URL"] = "https://gateway.example.com/v1/api"
    import importlib
    import ibkr
    importlib.reload(ibkr)
    broker = ibkr.IbkrBroker(Path(data_dir), lambda p, d=None: d, lambda p, v: None, lambda s: {}, lambda c: 1.0)
    try:
        broker._request("GET", "/iserver/accounts")
        check("non-localhost gateway refused", False)
    except Exception as exc:
        check("non-localhost gateway refused", "localhost" in str(exc), str(exc))
    check("Yahoo → IBKR tickers", ibkr.ibkr_symbol("0700.HK") == ("700", "HK") and ibkr.ibkr_symbol("NOVO-B.CO") == ("NOVO B", "CO"))

    print("\n%s: %d failure(s)" % ("FAILED" if FAILURES else "PASSED", len(FAILURES)))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
