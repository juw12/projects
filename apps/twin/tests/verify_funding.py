#!/usr/bin/env python3
"""Hermetic test of "Add money": balances, deposit history and deposit confirmation.

Twin never moves money. People deposit in their own brokerage account (Alpaca dashboard →
Banking, IBKR portal → Transfer & Pay); Twin reads balances and confirms when the deposit lands.
Mock Alpaca (/v2/account, /v2/account/activities) and mock IBKR gateway (auth, accounts, summary,
ledger) servers stand in for the brokers, so no network, keys or money are involved.
"""
import http.cookiejar
import http.server
import json
import os
import shutil
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
PAPER_KEY = ("PKTESTPAPER123", "papersecretpapersecret1234")
LIVE_KEY = ("AKTESTLIVE9876", "livesecretlivesecretlive9876")
IBKR_ACCOUNT = "U7654321"
PASSWORD = "correct-horse-1"


def check(name, condition, detail=""):
    print(f"  [{'PASS' if condition else 'FAIL'}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class MockBrokers(http.server.BaseHTTPRequestHandler):
    """Alpaca under /paper and /live, the IBKR gateway under /v1/api."""

    state = {
        "requests": [],
        "alpaca_cash": {"paper": 100000.0, "live": 250.0},
        "activities": [
            {"id": "20261001000000000::old-deposit", "activity_type": "CSD", "net_amount": "500", "date": "2026-10-01",
             "status": "executed"},
            {"id": "20261005000000000::old-withdrawal", "activity_type": "CSW", "net_amount": "-250", "date": "2026-10-05",
             "status": "executed"},
        ],
        "ibkr_cash": 1000.0,
    }

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
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        self.state["requests"].append((method, self.path))
        if self.path.startswith("/v1/api/"):
            return self.ibkr(method, self.path[len("/v1/api"):])
        prefix, _, rest = self.path.lstrip("/").partition("/")
        rest = "/" + rest
        key = (self.headers.get("APCA-API-KEY-ID"), self.headers.get("APCA-API-SECRET-KEY"))
        if key != (PAPER_KEY if prefix == "paper" else LIVE_KEY):
            return self.reply(401, {"message": "request is not authorized"})
        cash = self.state["alpaca_cash"][prefix]
        if rest == "/v2/account":
            return self.reply(200, {"status": "ACTIVE", "currency": "USD", "cash": str(cash), "buying_power": str(cash),
                                    "equity": str(cash + 1000), "last_equity": str(cash + 900), "trading_blocked": False,
                                    "account_blocked": False, "account_number": "123456789"})
        if rest.startswith("/v2/account/activities"):
            query = urllib.parse.parse_qs(urllib.parse.urlparse(rest).query)
            types = set(",".join(query.get("activity_types", [""])).split(","))
            if prefix == "paper":
                return self.reply(200, [])
            return self.reply(200, [a for a in self.state["activities"] if a["activity_type"] in types])
        return self.reply(404, {"message": "not found"})

    def ibkr(self, method, path):
        if path == "/iserver/auth/status":
            return self.reply(200, {"authenticated": True, "connected": True})
        if path == "/tickle":
            return self.reply(200, {})
        if path == "/iserver/accounts":
            return self.reply(200, {"accounts": [IBKR_ACCOUNT], "selectedAccount": IBKR_ACCOUNT, "isPaper": False})
        if path == "/portfolio/%s/summary" % IBKR_ACCOUNT:
            cash = self.state["ibkr_cash"]
            return self.reply(200, {"netliquidation": {"amount": cash + 5000, "currency": "USD"},
                                    "availablefunds": {"amount": cash, "currency": "USD"},
                                    "buyingpower": {"amount": cash * 2, "currency": "USD"}})
        if path == "/portfolio/%s/ledger" % IBKR_ACCOUNT:
            cash = self.state["ibkr_cash"]
            return self.reply(200, {
                "USD": {"currency": "USD", "cashbalance": cash - 100, "settledcash": cash - 100},
                "EUR": {"currency": "EUR", "cashbalance": 92.5, "settledcash": 92.5},
                "BASE": {"currency": "BASE", "cashbalance": cash, "settledcash": cash},
            })
        return self.reply(404, {"error": "not found"})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")


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
    mock = http.server.ThreadingHTTPServer(("127.0.0.1", mock_port), MockBrokers)
    threading.Thread(target=mock.serve_forever, daemon=True).start()
    data_dir = tempfile.mkdtemp(prefix="twin-funding-")
    port = free_port()
    env = dict(os.environ, TWIN_DATA=data_dir,
               TWIN_ALPACA_PAPER_URL=f"http://127.0.0.1:{mock_port}/paper",
               TWIN_ALPACA_LIVE_URL=f"http://127.0.0.1:{mock_port}/live",
               TWIN_IBKR_URL=f"http://127.0.0.1:{mock_port}/v1/api")
    proc = subprocess.Popen([sys.executable, str(APP_DIR / "server.py"), "--port", str(port), "--no-browser",
                             "--no-self-update"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        c = Client(base)
        c.post("/api/signup", {"username": "saver1", "password": PASSWORD, "name": "Sam"})

        print("Before connecting")
        r = c.post("/api/broker/funding")
        f = r.get("funding") or {}
        check("not connected → links to open an account at a real broker",
              r.get("ok") and f.get("connected") is False and "alpaca" in f.get("open_account_urls", {})
              and "ibkr" in f.get("open_account_urls", {}), str(r)[:300])
        r = c.post("/api/broker/funding/watch", {"amount": 100})
        check("can't wait for a deposit without a broker", not r.get("ok") and "Connect" in r.get("error", ""), str(r))

        print("Alpaca paper")
        r = c.post("/api/broker/connect", {"key_id": PAPER_KEY[0], "secret": PAPER_KEY[1], "mode": "paper"})
        check("paper connect", r.get("ok"), str(r)[:200])
        r = c.post("/api/broker/funding")
        f = r.get("funding") or {}
        check("paper shows simulated cash and cannot take real money",
              r.get("ok") and f.get("cash") == 100000.0 and f.get("can_deposit") is False and f.get("mode") == "paper", str(r)[:300])
        r = c.post("/api/broker/funding/watch", {"amount": 100})
        check("paper refuses a deposit watch with a clear reason", not r.get("ok") and "paper" in r.get("error", "").lower(), str(r))
        c.post("/api/broker/disconnect")

        print("Alpaca live")
        r = c.post("/api/broker/connect", {"key_id": LIVE_KEY[0], "secret": LIVE_KEY[1], "mode": "live",
                                           "acknowledge_rules": True, "phrase": "REAL MONEY", "password": PASSWORD})
        check("live connect (password + REAL MONEY)", r.get("ok") and r["broker"]["mode"] == "live", str(r)[:300])
        r = c.post("/api/broker/funding")
        f = r.get("funding") or {}
        transfers = f.get("transfers") or []
        check("live: real cash, deposits allowed, Alpaca dashboard link",
              f.get("cash") == 250.0 and f.get("can_deposit") is True and f.get("fund_url", "").startswith("https://app.alpaca.markets"),
              str(f)[:300])
        check("deposit history from CSD/CSW activities (signed amounts → type + positive amount)",
              [(t["type"], t["amount"]) for t in transfers] == [("deposit", 500.0), ("withdrawal", 250.0)], str(transfers))
        activity_calls = [p for m, p in MockBrokers.state["requests"] if "/v2/account/activities" in p]
        check("asks Alpaca only for cash deposits/withdrawals", activity_calls and "activity_types=CSD,CSW" in activity_calls[-1],
              str(activity_calls[-1:]))
        r = c.post("/api/broker/funding/watch", {"amount": "abc"})
        check("bad amount rejected", not r.get("ok"), str(r))
        r = c.post("/api/broker/funding/watch", {"amount": 1000})
        f = r.get("funding") or {}
        check("watch starts waiting with baseline", r.get("ok") and (f.get("watch") or {}).get("state") == "waiting"
              and f["watch"]["expected_amount"] == 1000.0 and f["watch"]["baseline_cash"] == 250.0, str(r)[:300])
        r = c.post("/api/broker/funding")
        check("old deposits don't count as the new one", (r["funding"]["watch"] or {}).get("state") == "waiting")
        MockBrokers.state["activities"].insert(0, {"id": "20261028000000000::new-deposit", "activity_type": "CSD",
                                                   "net_amount": "1000", "date": "2026-10-28", "status": "executed"})
        MockBrokers.state["alpaca_cash"]["live"] = 1250.0
        r = c.post("/api/broker/funding")
        watch = r["funding"]["watch"] or {}
        check("new Alpaca deposit detected", watch.get("state") == "arrived" and watch["arrived"][0]["amount"] == 1000.0
              and r["funding"]["cash"] == 1250.0, str(watch))
        r = c.post("/api/broker/funding")
        check("arrival is remembered until dismissed", (r["funding"]["watch"] or {}).get("state") == "arrived")
        r = c.post("/api/broker/funding/watch", {"action": "stop"})
        check("dismiss clears the watch", r.get("ok") and r["funding"]["watch"] is None, str(r)[:200])
        dumped = json.dumps(r)
        check("keys never returned", LIVE_KEY[1] not in dumped and LIVE_KEY[0] not in dumped)
        c.post("/api/broker/disconnect")

        print("Interactive Brokers live")
        r = c.post("/api/broker/connect", {"provider": "ibkr", "mode": "live", "acknowledge_rules": True,
                                           "phrase": "REAL MONEY", "password": PASSWORD})
        check("IBKR live connect", r.get("ok") and r["broker"]["provider"] == "ibkr", str(r)[:300])
        r = c.post("/api/broker/funding")
        f = r.get("funding") or {}
        check("IBKR: base cash, per-currency balances, IBKR portal link",
              f.get("cash") == 1000.0 and {b["currency"] for b in f.get("balances", [])} == {"USD", "EUR"}
              and f.get("fund_url", "").startswith("https://www.interactivebrokers.com/") and f.get("can_deposit") is True,
              str(f)[:400])
        r = c.post("/api/broker/funding/watch", {"amount": 2000})
        check("IBKR watch starts", (r.get("funding") or {}).get("watch", {}).get("state") == "waiting", str(r)[:300])
        MockBrokers.state["ibkr_cash"] = 1400.0
        r = c.post("/api/broker/funding")
        check("small cash change (< half the expected deposit) is not reported as the deposit",
              r["funding"]["watch"]["state"] == "waiting", str(r["funding"]["watch"]))
        MockBrokers.state["ibkr_cash"] = 3000.0
        r = c.post("/api/broker/funding")
        watch = r["funding"]["watch"]
        check("IBKR deposit detected from the cash increase", watch["state"] == "arrived"
              and watch["arrived"][0]["amount"] == 2000.0 and watch["arrived"][0].get("estimated") is True, str(watch))

        print("Safety")
        guest = urllib.request.Request(base + "/api/broker/funding", data=b"{}", headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(guest, timeout=10)
            check("signed-out funding requests rejected", False)
        except urllib.error.HTTPError as err:
            check("signed-out funding requests rejected", err.code == 401)
        posts = [p for m, p in MockBrokers.state["requests"] if m == "POST" and not p.startswith("/v1/api/")]
        check("Twin never sent a money-moving request to Alpaca", not posts, str(posts))
    finally:
        proc.terminate()
        proc.wait(timeout=10)
        mock.shutdown()
        mock.server_close()
        shutil.rmtree(data_dir, ignore_errors=True)
    print("\n%s: %d failure(s)" % ("FAILED" if FAILURES else "PASSED", len(FAILURES)))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
