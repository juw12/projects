#!/usr/bin/env python3
"""Hermetic test of Twin's real-broker bridge against a mock Alpaca Trading API v2.

The mock implements the documented endpoints Twin uses (/v2/account, /v2/positions,
/v2/orders GET/POST/DELETE) on separate /paper and /live prefixes, checks the API key
headers and records every request. No real broker, keys or network are involved.
"""
import http.cookiejar
import http.server
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
FAILURES = []
PAPER_KEY = ("PKTESTPAPER123", "papersecretpapersecret1234")
LIVE_KEY = ("AKTESTLIVE9876", "livesecretlivesecretlive9876")


def check(name, condition, detail=""):
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class MockAlpaca(http.server.BaseHTTPRequestHandler):
    state = {"requests": [], "orders": {}, "positions": [
        {"symbol": "AAPL", "qty": "5", "avg_entry_price": "180", "current_price": "200", "market_value": "1000",
         "unrealized_pl": "100", "unrealized_plpc": "0.111", "side": "long"},
    ]}

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
        prefix, _, rest = self.path.lstrip("/").partition("/")
        rest = "/" + rest
        key = (self.headers.get("APCA-API-KEY-ID"), self.headers.get("APCA-API-SECRET-KEY"))
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        self.state["requests"].append({"env": prefix, "method": method, "path": rest, "body": body, "key": key[0]})
        expected = PAPER_KEY if prefix == "paper" else LIVE_KEY
        if key != expected:
            return self.reply(401, {"message": "request is not authorized"})
        if rest == "/v2/account":
            return self.reply(200, {"status": "ACTIVE", "currency": "USD", "cash": "50000", "buying_power": "50000",
                                    "equity": "51000", "last_equity": "50500", "trading_blocked": False,
                                    "account_blocked": False, "pattern_day_trader": False, "daytrade_count": 0,
                                    "account_number": "PA123456789"})
        if rest == "/v2/positions":
            return self.reply(200, self.state["positions"])
        if rest.startswith("/v2/orders") and method == "GET":
            want_open = "status=open" in rest
            rows = [o for o in self.state["orders"].values() if (o["status"] != "canceled") == want_open]
            return self.reply(200, rows)
        if rest == "/v2/orders" and method == "POST":
            order = {**body, "id": str(uuid.uuid4()), "status": "accepted", "submitted_at": "2026-10-26T14:00:00Z",
                     "filled_qty": "0", "order_class": body.get("order_class", "simple"), "legs": None}
            self.state["orders"][order["id"]] = order
            return self.reply(200, order)
        if rest == "/v2/orders" and method == "DELETE":
            out = []
            for order in self.state["orders"].values():
                if order["status"] != "canceled":
                    order["status"] = "canceled"
                    out.append({"id": order["id"], "status": 200})
            return self.reply(207, out)
        if rest.startswith("/v2/orders/") and method == "DELETE":
            order = self.state["orders"].get(rest.split("/")[-1])
            if not order:
                return self.reply(404, {"message": "order not found"})
            order["status"] = "canceled"
            return self.reply(204)
        return self.reply(404, {"message": "not found"})

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


def main():
    mock_port = free_port()
    mock = http.server.ThreadingHTTPServer(("127.0.0.1", mock_port), MockAlpaca)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    requests = MockAlpaca.state["requests"]
    data_dir = tempfile.mkdtemp(prefix="twin-broker-")
    port = free_port()
    env = dict(os.environ, TWIN_DATA=data_dir,
               TWIN_ALPACA_PAPER_URL=f"http://127.0.0.1:{mock_port}/paper",
               TWIN_ALPACA_LIVE_URL=f"http://127.0.0.1:{mock_port}/live")
    # Patch only this isolated test child, not production server behavior. Previously
    # broker previews accidentally fetched live Yahoo quotes despite this suite's contract.
    bootstrap = (
        "import sys\n"
        f"sys.path.insert(0, {str(APP_DIR)!r})\n"
        "import server\n"
        "prices = {'SPY': 500, 'MSFT': 400, 'AAPL': 200, 'TSLA': 250, 'BRK.B': 400}\n"
        "server.quote = lambda symbol: {'price': prices[symbol]}\n"
        "def no_market_network(*args, **kwargs):\n"
        "    raise AssertionError('External market network forbidden in broker tests')\n"
        "server.http_json = no_market_network\n"
        "server.main()\n"
    )
    proc = subprocess.Popen([sys.executable, "-c", bootstrap, "--port", str(port), "--no-browser"],
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
        c.post("/api/signup", {"username": "trader1", "password": "correct-horse-1", "name": "Tess"})
        assessment = c.post("/api/quiz", {"answers": {"risk_points": [3], "style_points": [3], "flags": []}})
        check("valid assessment establishes profile limits", assessment.get("ok"), str(assessment))

        print("Connect")
        r = c.post("/api/broker/status")
        check("starts disconnected", r.get("ok") and r["broker"]["connected"] is False)
        r = c.post("/api/broker/connect", {"key_id": "short", "secret": "x", "mode": "paper"})
        check("malformed keys rejected before any broker call", not r.get("ok") and not requests)
        r = c.post("/api/broker/connect", {"key_id": "PKWRONGKEY123", "secret": "wrongsecretwrongsecret", "mode": "paper"})
        check("wrong keys report Alpaca's rejection", not r.get("ok") and "rejected the keys" in r.get("error", ""), r.get("error"))
        check("failed connect stores nothing", not list(Path(data_dir).rglob("broker.json")))
        r = c.post("/api/broker/connect", {"key_id": PAPER_KEY[0], "secret": PAPER_KEY[1], "mode": "paper"})
        check("paper connect succeeds", r.get("ok") and r["broker"]["connected"] and r["broker"]["mode"] == "paper", str(r)[:200])
        check("paper uses the paper host", requests[-1]["env"] == "paper")
        check("status shows equity", r["broker"]["account"]["equity"] == 51000.0)
        dumped = json.dumps(r)
        check("secret never returned to the browser", PAPER_KEY[1] not in dumped and PAPER_KEY[0] not in dumped)
        stored = next(Path(data_dir).rglob("broker.json"))
        if os.name == "nt":
            print("  [SKIP] POSIX owner-only mode test: Windows ACL security is not verified")
        else:
            check("keys file is owner-only (0600)", stat.S_IMODE(stored.stat().st_mode) == 0o600, oct(stored.stat().st_mode))

        print("Preview + place")
        r = c.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "type": "market", "dollars": 250}})
        check("dollar market buy previews", r.get("ok") and r["preview"]["estimate_usd"] == 250.0, str(r)[:200])
        preview_id = r["preview"]["preview_id"]
        before = len([q for q in requests if q["method"] == "POST"])
        check("preview alone sends no order", before == 0)
        r = c.post("/api/broker/order", {"preview_id": preview_id, "confirm": False})
        check("unconfirmed order refused", not r.get("ok"))
        r = c.post("/api/broker/order", {"preview_id": preview_id, "confirm": True})
        check("confirmed order placed", r.get("ok") and r["order"]["status"] == "accepted", str(r)[:200])
        posted = [q for q in requests if q["method"] == "POST"][-1]["body"]
        check("payload maps to Alpaca fields", posted["notional"] == "250.0" and posted["type"] == "market" and posted["time_in_force"] == "day" and posted["client_order_id"].startswith("twin-"), json.dumps(posted))
        r = c.post("/api/broker/order", {"preview_id": preview_id, "confirm": True})
        check("preview id is single-use (no double orders)", not r.get("ok") and "expired or was already used" in r.get("error", ""))

        r = c.post("/api/broker/preview", {"order": {"symbol": "MSFT", "side": "buy", "type": "limit", "qty": 3, "limit": 400,
                                                      "take_profit": 460, "stop_loss": 380}})
        check("limit + bracket previews", r.get("ok"), r.get("error"))
        c.post("/api/broker/order", {"preview_id": r["preview"]["preview_id"], "confirm": True})
        posted = [q for q in requests if q["method"] == "POST"][-1]["body"]
        check("bracket payload", posted.get("order_class") == "bracket" and posted["take_profit"] == {"limit_price": "460.0"}
              and posted["stop_loss"] == {"stop_price": "380.0"} and posted["qty"] == "3" and posted["time_in_force"] == "gtc", json.dumps(posted))
        r = c.post("/api/broker/preview", {"order": {"symbol": "MSFT", "side": "buy", "type": "limit", "qty": 1, "limit": 400, "stop_loss": 380}})
        c.post("/api/broker/order", {"preview_id": r["preview"]["preview_id"], "confirm": True})
        check("stop-loss alone becomes OTO", [q for q in requests if q["method"] == "POST"][-1]["body"].get("order_class") == "oto")
        r = c.post("/api/broker/preview", {"order": {"symbol": "TSLA", "side": "buy", "type": "trailing", "qty": 2, "trail_pct": 5, "limit": None}})
        trailing_ok = r.get("ok") or "estimate" in r.get("error", "")
        check("trailing maps to trailing_stop (or asks for a price basis offline)", trailing_ok, r.get("error"))

        print("Guard-rails")
        bad = [
            ({"symbol": "SPY", "side": "buy", "type": "limit", "dollars": 100, "limit": 500}, "dollar-amount orders must be market"),
            ({"symbol": "SPY", "side": "buy", "type": "limit", "qty": 1.5, "limit": 500}, "fractional shares only work with market"),
            ({"symbol": "SPY", "side": "buy", "type": "market", "dollars": 100, "take_profit": 900}, "brackets need whole shares"),
            ({"symbol": "SPY", "side": "sell", "type": "market", "qty": 1}, "never opens short"),
            ({"symbol": "AAPL", "side": "sell", "type": "limit", "qty": 9, "limit": 250}, "won't sell more"),
            ({"symbol": "SPY", "side": "buy", "type": "market", "dollars": 30000}, "above your max per order"),
            ({"symbol": "../etc", "side": "buy", "type": "market", "dollars": 10}, "valid US stock"),
            ({"symbol": "SPY", "side": "buy", "type": "trailing", "qty": 1, "trail_pct": 80}, "trail %"),
            ({"symbol": "VOD.L", "side": "buy", "type": "market", "dollars": 50}, "listed outside the US"),
            ({"symbol": "7203.T", "side": "buy", "type": "market", "dollars": 50}, "listed outside the US"),
            ({"symbol": "BBCA.JK", "side": "buy", "type": "market", "dollars": 50}, "listed outside the US"),
        ]
        for order, message in bad:
            r = c.post("/api/broker/preview", {"order": order})
            check("blocks: " + message, not r.get("ok") and message in r.get("error", ""), r.get("error"))
        r = c.post("/api/broker/preview", {"order": {"symbol": "AAPL", "side": "sell", "type": "limit", "qty": 5, "limit": 250}})
        check("selling shares you hold is allowed", r.get("ok"), r.get("error"))
        r = c.post("/api/broker/preview", {"order": {"symbol": "BRK.B", "side": "buy", "type": "market", "dollars": 50}})
        check("US share classes (BRK.B) still allowed", r.get("ok"), r.get("error"))

        print("Orders")
        r = c.post("/api/broker/portfolio")
        check("portfolio lists positions and open orders", r.get("ok") and r["positions"][0]["symbol"] == "AAPL" and len(r["orders"]) == 3, str(r)[:300])
        first = r["orders"][0]["id"]
        r = c.post("/api/broker/cancel", {"id": first})
        check("cancel one order", r.get("ok") and MockAlpaca.state["orders"][first]["status"] == "canceled")
        r = c.post("/api/broker/cancel", {"id": "../../v2/account"})
        check("order id is validated (no path injection)", not r.get("ok"))
        r = c.post("/api/broker/cancel_all")
        check("cancel-all kill switch", r.get("ok") and r["cancelled"] == 2, str(r))

        print("Live mode")
        r = c.post("/api/broker/connect", {"key_id": LIVE_KEY[0], "secret": LIVE_KEY[1], "mode": "live", "phrase": "REAL MONEY"})
        check("live needs the Twin password", not r.get("ok") and "password" in r.get("error", "").lower())
        r = c.post("/api/broker/connect", {"key_id": LIVE_KEY[0], "secret": LIVE_KEY[1], "mode": "live", "password": "correct-horse-1", "phrase": "yes"})
        check("live needs the typed phrase", not r.get("ok") and "REAL MONEY" in r.get("error", ""))
        r = c.post("/api/broker/connect", {"key_id": LIVE_KEY[0], "secret": LIVE_KEY[1], "mode": "live", "password": "wrong-pass", "phrase": "REAL MONEY"})
        check("wrong password blocks live", not r.get("ok"))
        r = c.post("/api/broker/connect", {"key_id": LIVE_KEY[0], "secret": LIVE_KEY[1], "mode": "live", "password": "correct-horse-1", "phrase": "real money"})
        check("live connects with password + phrase", r.get("ok") and r["broker"]["mode"] == "live" and requests[-1]["env"] == "live", str(r)[:200])
        check("live default max order is $1,000", r["broker"]["max_order_usd"] == 1000.0)
        r = c.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "type": "market", "dollars": 1500}})
        check("live cap enforced", not r.get("ok") and "max per order" in r.get("error", ""))
        r = c.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "type": "market", "dollars": 100}})
        check("live preview warns about real money", r.get("ok") and any("real money" in w for w in r["preview"]["warnings"]), str(r)[:300])
        live_preview = r["preview"]["preview_id"]
        c.post("/api/broker/settings", {"max_order_usd": 2000})
        r = c.post("/api/broker/order", {"preview_id": live_preview, "confirm": True})
        check("live order goes to the live host", r.get("ok") and r["mode"] == "live" and [q for q in requests if q["method"] == "POST"][-1]["env"] == "live")
        profile = c.post("/api/me")["profile"]
        cap = int((profile.get("limits") or {}).get("max_trades_per_day") or 3)
        stale = c.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "type": "market", "dollars": 10}})
        # Changed profile limits must be read again by the actual HTTP submit route.
        bracket = c.post("/api/broker/preview", {"order": {
            "symbol": "SPY", "side": "buy", "type": "limit", "qty": 1, "limit": 100, "stop_loss": 90,
        }})
        c.post("/api/profile", {"limits": {"max_loss_per_trade_usd": 5}})
        r = c.post("/api/broker/order", {"preview_id": bracket["preview"]["preview_id"], "confirm": True})
        check("HTTP submit reloads changed profile risk limits", not r.get("ok") and "per-trade limit" in r.get("error", ""), str(r))
        restored = c.post("/api/profile", {"limits": profile["limits"]})
        check("profile limits restored after submission test", restored.get("ok"), str(restored))
        for _ in range(cap - 1):
            p = c.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "type": "market", "dollars": 10}})
            assert p.get("ok"), p
            c.post("/api/broker/order", {"preview_id": p["preview"]["preview_id"], "confirm": True})
        before = len([q for q in requests if q["method"] == "POST"])
        r = c.post("/api/broker/order", {"preview_id": stale["preview"]["preview_id"], "confirm": True})
        check("HTTP stale preview cannot bypass daily entry cap", not r.get("ok") and "Daily live order limit" in r.get("error", ""), str(r))
        check("blocked submit sends no order to broker", len([q for q in requests if q["method"] == "POST"]) == before)
        r = c.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "type": "market", "dollars": 10}})
        check(f"daily live order cap ({cap}) enforced", not r.get("ok") and "Daily live order limit" in r.get("error", ""), r.get("error"))

        print("Isolation + disconnect")
        other = Client(base)
        other.post("/api/signup", {"username": "trader2", "password": "another-pass-2", "name": "Ola"})
        r = other.post("/api/broker/status")
        check("other Twin accounts can't see this broker", r.get("ok") and r["broker"]["connected"] is False)
        r = other.post("/api/broker/preview", {"order": {"symbol": "SPY", "side": "buy", "dollars": 5}})
        check("other accounts can't trade it", not r.get("ok") and "No broker connected" in r.get("error", ""))
        guest = urllib.request.Request(base + "/api/broker/status", data=b"{}", headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(guest, timeout=10)
            check("signed-out requests rejected", False)
        except urllib.error.HTTPError as err:
            check("signed-out requests rejected", err.code == 401)
        r = c.post("/api/broker/disconnect")
        check("disconnect deletes stored keys", r.get("ok") and not list(Path(data_dir).rglob("broker.json")))
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        mock.shutdown()
        mock.server_close()
        shutil.rmtree(data_dir)
    print("\n%s: %d failure(s)" % ("FAILED" if FAILURES else "PASSED", len(FAILURES)))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
