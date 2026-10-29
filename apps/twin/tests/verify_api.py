#!/usr/bin/env python3
"""Hermetic end-to-end test for Twin (stdlib only, no network).

Starts the server on a free port with a temporary data directory, then checks:
health + static files, accounts (signup, login, wrong password, isolation),
Twin Indonesia's server news feed (fake RSS) and per-account wallet sync,
moving practice money between the USD portfolio and the rupiah wallet,
the personality test -> limits mapping, budget recalculation, the cross-site
guard, input validation (NaN/inf/negative amounts, path traversal, bad
Content-Length), and the full demo day-trade flow on the bundled TSLA replay.
It also unit-tests the monthly-return gap handling and the goal simulator
with synthetic data. Exits 0 on success, 1 on failure.
"""
import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
SERVER = APP_DIR / "server.py"
FAILURES = []


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.run_ids = {}
        # Loopback only: never route through an HTTP(S)_PROXY from the environment.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                                  urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(self, path, body=None, headers=None):
        body = dict(body or {})
        if path == "/api/trade" and body.get("step") != "entry":
            body.setdefault("run_id", self.run_ids.get(body.get("mode")))
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body or {}).encode(),
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with self.opener.open(request, timeout=120) as response:
                data = json.loads(response.read())
                if data.get("run_id"):
                    self.run_ids[body.get("mode")] = data["run_id"]
                return response.status, data
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def get(self, path):
        with self.opener.open(self.base + path, timeout=30) as response:
            return response.status, response.read()


def unit_tests(data_dir):
    print("unit: monthly returns + goal simulator")
    os.environ["TWIN_DATA"] = data_dir
    sys.path.insert(0, str(APP_DIR))
    import server  # noqa: E402  (imported after TWIN_DATA is set)

    # Quarterly bars must not be mistaken for monthly returns.
    def fake_http_json(url, ttl=60):
        stamps = [1104537600, 1112313600, 1114905600, 1117584000]  # 2005-01, 2005-04, 2005-05, 2005-06
        return {"chart": {"result": [{
            "timestamp": stamps,
            "indicators": {"adjclose": [{"adjclose": [100.0, 130.0, 104.0, 104.0 * 1.01]}]},
        }]}}

    server.http_json = fake_http_json
    series = server.monthly_returns("TEST")
    check("gap between 2005-01 and 2005-04 is skipped", "2005-04" not in series, str(series))
    check("consecutive months kept", abs(series.get("2005-05", 0) - (104 / 130 - 1)) < 1e-9, str(series))

    # Goal simulator on a synthetic steady 0.5 %/month history: every path is identical.
    months = [f"{1990 + i // 12}-{i % 12 + 1:02d}" for i in range(240)]
    server.monthly_returns = lambda symbol: {m: 0.005 for m in months}
    result = server.goal_sim({"FLAT": 1}, years=10, initial=1000, monthly=100, goal=15000, paths=500)
    expected = 1000.0
    for _ in range(120):
        expected = (expected + 100) * 1.005
    check("goal sim matches closed-form compounding", abs(result["median"] - expected) < 0.05,
          f"{result['median']} vs {expected:.2f}")
    check("goal probability is 1 when every path beats the goal", result["p_goal"] == 1.0)
    above = server.goal_sim({"FLAT": 1}, years=10, initial=1000, monthly=100, goal=20000, paths=500)
    check("goal probability is 0 when no path can reach it", above["p_goal"] == 0.0)
    check("20-year history → no short-history warning", result["warnings"] == [])

    level_two = server.limits_for(2, 10000)
    check("risk level 2 → 0.5 % max loss per trade", level_two["max_loss_per_trade_usd"] == 50.0)
    quiz = server.score_quiz({"risk_points": [5, 5, 4, 5], "style_points": [5, 5, 4], "flags": ["no_emergency_fund"]})
    check("no emergency fund caps risk at 2 and blocks the trader type",
          quiz["risk_level"] == 2 and quiz["archetype"] != "trader", str(quiz))

    print("unit: global listings + multi-currency practice")
    fake_charts = {
        "7203.T": {"currency": "JPY", "price": 3200.0, "prev": 3100.0, "exchange": "Tokyo"},
        "VOD.L": {"currency": "GBp", "price": 120.0, "prev": 118.0, "exchange": "LSE"},
    }
    fake_fx = {"JPY": 160.0, "GBP": 0.8}  # USDxxx=X quotes: units of xxx per 1 USD

    def fake_market(url, ttl=60):
        for currency, inverse in fake_fx.items():
            if "USD%s%%3DX" % currency in url:
                return {"chart": {"result": [{"meta": {"regularMarketPrice": inverse}}]}}
        for symbol, info in fake_charts.items():
            if "/chart/%s?" % symbol in url:
                return {"chart": {"result": [{
                    "meta": {"currency": info["currency"], "regularMarketPrice": info["price"],
                             "previousClose": info["prev"], "chartPreviousClose": info["prev"],
                             "fullExchangeName": info["exchange"]},
                    "timestamp": [1, 2],
                    "indicators": {"quote": [{"close": [info["prev"], info["price"]]}]},
                }]}}
        raise server.AppError("no fake data for " + url)

    server.http_json = fake_market
    check("FX from the inverse pair: 1 JPY = 1/160 USD", abs(server.fx_usd("JPY") - 1 / 160) < 1e-12)
    check("USD needs no conversion", server.fx_usd("usd") == 1.0)
    vod = server.quote("VOD.L")
    check("pence quotes become pounds (120 GBp -> 1.20 GBP)",
          vod["currency"] == "GBP" and abs(vod["price"] - 1.2) < 1e-9 and abs(vod["prev"] - 1.18) < 1e-9, str(vod)[:200])
    profile = {"paper": {"cash": 10000.0, "start_cash": 10000.0, "positions": {}, "history": []}}
    fill = server.paper_order(profile, "7203.T", "buy", dollars=1000)
    check("$1,000 of a ¥3,200 stock at 160 JPY/USD buys 50 shares",
          abs(fill["qty"] - 50) < 1e-6 and fill["price"] == 3200.0 and fill["currency"] == "JPY", str(fill))
    check("practice cash is debited in USD", abs(profile["paper"]["cash"] - 9000) < 1e-6)
    server.paper_order(profile, "7203.T", "sell", qty=25)
    state = server.paper_state(profile)
    row = state["positions"][0]
    check("position valued in USD with local price kept",
          abs(row["value"] - 500) < 0.01 and row["local_price"] == 3200.0 and row["currency"] == "JPY", str(row)[:240])
    check("portfolio total unchanged by round trip at the same price", abs(state["value"] - 10000) < 0.01, str(state["value"]))
    server.paper_order(profile, "VOD.L", "buy", dollars=150)
    check("$150 of VOD at £1.20 x 1.25 USD/GBP = 100 shares",
          abs(profile["paper"]["positions"]["VOD.L"]["qty"] - 100) < 1e-6)
    try:
        server.paper_order(profile, "VOD.L", "sell", qty=101)
        check("can't sell more than you hold", False)
    except server.AppError:
        check("can't sell more than you hold", True)

    print("unit: wallet transfers (same rounding as web/id/engine.js)")
    quote = server.quote_transfer("usd_to_idr", 100, 16290)
    check("$100 at 16,290 minus 0.5% = Rp1,620,855 (spread Rp8,145)",
          quote["idr"] == 1620855 and quote["fee"] == 8145 and quote["basis"] == 1629000, str(quote))
    quote = server.quote_transfer("idr_to_usd", 1_000_000, 16290)
    check("Rp1,000,000 at 16,290 minus 0.5% = $61.08 (spread $0.31)",
          quote["usd"] == 61.08 and quote["fee"] == 0.31 and quote["basis"] == 61.39, str(quote))
    check("halves round up like JavaScript's Math.round",
          server.round_half_up(0.5) == 1 and server.round_half_up(2.5) == 3 and server.round_half_up(0.125, 2) == 0.13)
    for direction, amount, label in [("usd_to_idr", 0.99, "under $1"), ("idr_to_usd", 9999, "under Rp10,000"),
                                     ("sideways", 100, "in an unknown direction")]:
        try:
            server.quote_transfer(direction, amount, 16290)
            check("transfer " + label + " refused", False)
        except server.AppError:
            check("transfer " + label + " refused", True)
    try:
        server.quote_transfer("usd_to_idr", 100, 0)
        check("no USD/IDR rate: refused with a plain message", False)
    except server.AppError as error:
        check("no USD/IDR rate: refused with a plain message", "No USD/IDR rate" in str(error), str(error))


FAKE_ANTARA_RSS = """<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>BBCA naik, IHSG menguat</title><link>https://example.com/id-1</link>
<pubDate>Wed, 28 Oct 2026 09:00:00 +0700</pubDate></item>
</channel></rss>"""


def indonesia_wallet_state(cash=10_000_000, saved_at="2026-10-28T09:00:00.000Z"):
    """A minimal Twin Indonesia state document (engine.js createState, version 1)."""
    return {"version": 1, "savedAt": saved_at, "profile": {"name": "Alice", "onboarded": True},
            "wallet": {"cashIdr": cash, "startingCashIdr": 10_000_000}, "positions": {}, "orders": []}


def end_to_end(data_dir):
    print("end-to-end: server")
    port = free_port()
    # Only the Antara feed answers; every other Indonesia feed fails, as when offline.
    fake_news = Path(data_dir) / "fake-news.json"
    fake_news.write_text(json.dumps({"https://www.antaranews.com/rss/ekonomi-bursa.xml": FAKE_ANTARA_RSS}),
                         encoding="utf-8")
    # A fixed USD/IDR rate (16,290 rupiah per dollar) for wallet transfers; no live quotes needed.
    fake_quotes = Path(data_dir) / "fake-quotes.json"
    fake_quotes.write_text(json.dumps({"quotes": {}, "fx_usd": {"IDR": 1 / 16290}}), encoding="utf-8")
    env = dict(os.environ, TWIN_DATA=data_dir, TWIN_FAKE_NEWS=str(fake_news), TWIN_FAKE_QUOTES=str(fake_quotes))
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--port", str(port), "--no-browser"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(100):
            try:
                direct.open(base + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        alice = Client(base)
        status, body = alice.get("/api/health")
        check("GET /api/health", status == 200 and json.loads(body)["app"] == "twin")
        status, body = alice.get("/")
        check("serves the app at /", status == 200 and b"Twin" in body)
        status, body = alice.get("/demo.js")
        check("serves web/demo.js", status == 200 and b"TwinDemo" in body)
        status, body = alice.get("/id/")
        check("serves Twin Indonesia at /id/", status == 200 and b"Twin Indonesia" in body)
        status, body = alice.get("/id/engine.js?v=1.15.0")
        check("serves the Twin Indonesia engine", status == 200 and b"SatuEngine" in body)
        try:
            status, body = alice.get("/demo/")
        except urllib.error.HTTPError as error:
            status = error.code
        check("folder without an index page is 404", status == 404)

        status, body = alice.post("/api/me")
        check("API requires login", status == 401)

        print("Twin Indonesia: news feed + wallet sync")
        status, news = alice.post("/api/indonesia/news")
        links = [item.get("link") for item in news.get("items", [])]
        check("Indonesia news is public and includes every answering feed",
              status == 200 and news.get("ok") and "https://example.com/id-1" in links, str(news)[:200])
        check("Indonesia news reports failed feeds instead of failing",
              news.get("status", {}).get("antara-bursa", {}).get("ok") is True
              and news.get("status", {}).get("coindesk", {}).get("ok") is False)
        idx_item = next((item for item in news.get("items", []) if item.get("link") == "https://example.com/id-1"), {})
        check("Indonesia news items are tagged", idx_item.get("market") == "IDX" and "BBCA" in idx_item.get("tickers", []))
        status, body = alice.post("/api/indonesia/wallet")
        check("Indonesia wallet requires login", status == 401)
        status, body = alice.post("/api/wallet/transfer", {"direction": "usd_to_idr", "amount": 100, "rev": 0})
        check("wallet transfers require login", status == 401)
        status, body = alice.post("/api/signup", {"username": "alice", "password": "short", "name": "A"})
        check("weak password rejected", not body.get("ok"))
        status, body = alice.post("/api/signup", {"username": "alice", "password": "correct-horse-1", "name": "Alice", "email": "a@example.com"})
        check("signup", body.get("ok") is True)

        status, body = alice.post("/api/quiz", {"answers": {"risk_points": [4, 4, 4, 4, 4, 4], "style_points": [5, 5, 4, 5], "flags": []}, "paper_cash": 20000})
        quiz = body["profile"]["quiz"]
        limits = body["profile"]["limits"]
        check("quiz → Active Trader at risk 4", quiz["archetype"] == "trader" and quiz["risk_level"] == 4, str(quiz))
        check("risk 4 on $5,000 → $50 max loss, 1.5R target",
              limits["max_loss_per_trade_usd"] == 50.0 and limits["default_target"] == "1.5R", str(limits))
        check("paper cash set from onboarding", body["profile"]["paper"]["cash"] == 20000)

        status, body = alice.post("/api/profile", {"budget": 10000})
        check("budget change recalculates limits", body["profile"]["limits"]["max_loss_per_trade_usd"] == 100.0)
        alice.post("/api/profile", {"budget": 5000})

        status, body = alice.post("/api/paper", headers={"Origin": "http://evil.example"})
        check("cross-site request blocked", status == 403)

        status, wallet = alice.post("/api/indonesia/wallet")
        check("new account has no Indonesia wallet yet",
              status == 200 and wallet.get("ok") and wallet.get("wallet") is None and wallet.get("rev") == 0)
        alice_account = wallet.get("account")
        status, saved = alice.post("/api/indonesia/wallet/save", {"state": indonesia_wallet_state(), "rev": 0})
        check("first wallet save", saved.get("ok") is True and saved.get("rev") == 1, str(saved))
        status, wallet = alice.post("/api/indonesia/wallet")
        check("wallet round-trips unchanged",
              wallet.get("wallet") == indonesia_wallet_state() and wallet.get("rev") == 1, str(wallet)[:200])
        newer = indonesia_wallet_state(cash=9_000_000, saved_at="2026-10-28T10:00:00.000Z")
        status, stale = alice.post("/api/indonesia/wallet/save", {"state": newer, "rev": 0})
        check("stale save is refused and returns the newer copy",
              stale.get("ok") is False and stale.get("conflict") is True and stale.get("rev") == 1
              and stale.get("wallet") == indonesia_wallet_state(), str(stale)[:200])
        status, saved = alice.post("/api/indonesia/wallet/save", {"state": newer, "rev": 1})
        check("save on the current revision", saved.get("ok") is True and saved.get("rev") == 2)
        status, body = alice.post("/api/indonesia/wallet/save", {"state": {"version": 2, "wallet": {}}, "rev": 2})
        check("non-wallet documents rejected", body.get("ok") is False and "wallet" in body.get("error", ""))
        status, body = alice.post("/api/indonesia/wallet/save", {"state": newer, "rev": "2"})
        check("text revision rejected", body.get("ok") is False)
        oversized = dict(newer, notes="x" * 600_000)
        status, body = alice.post("/api/indonesia/wallet/save", {"state": oversized, "rev": 2})
        check("oversized wallet rejected", body.get("ok") is False and "too large" in body.get("error", ""))
        status, wallet = alice.post("/api/indonesia/wallet")
        check("rejected saves leave the wallet untouched",
              wallet.get("rev") == 2 and wallet.get("wallet", {}).get("wallet", {}).get("cashIdr") == 9_000_000)
        status, body = alice.post("/api/indonesia/wallet/save", {"state": newer, "rev": 2},
                                  headers={"Origin": "http://evil.example"})
        check("cross-site wallet save blocked", status == 403)

        # 1.13: moving practice money between the USD portfolio and the rupiah wallet.
        status, paper_before = alice.post("/api/paper")
        before = paper_before["paper"]
        check("a new portfolio has no money moved in or out",
              before["contributions"] == 0 and before["basis"] == before["start_cash"], str(before)[:200])
        status, moved = alice.post("/api/wallet/transfer", {"direction": "usd_to_idr", "amount": 100, "rev": 2})
        check("move $100 to rupiah at 16,290 minus 0.5%",
              moved.get("ok") is True and moved["transfer"]["idr"] == 1620855 and moved["transfer"]["fee"] == 8145
              and moved.get("rev") == 3, str(moved)[:300])
        if moved.get("ok"):
            check("USD cash down $100, counted as money moved out, gain unchanged",
                  abs(moved["paper"]["cash"] - (before["cash"] - 100)) < 1e-6 and moved["paper"]["contributions"] == -100.0
                  and abs(moved["paper"]["gain"] - before["gain"]) < 0.01, str(moved["paper"])[:300])
            check("rupiah cash up Rp1,620,855 with Rp1,629,000 counted as money put in",
                  moved["wallet"]["wallet"]["cashIdr"] == 9_000_000 + 1620855
                  and moved["wallet"]["wallet"]["contributionsIdr"] == 1629000
                  and moved["wallet"]["transfers"][0]["id"] == moved["transfer"]["id"], str(moved["wallet"])[:300])
        status, wallet = alice.post("/api/indonesia/wallet")
        check("the account's rupiah wallet keeps the move (rev 3)",
              wallet.get("rev") == 3 and wallet["wallet"]["wallet"]["cashIdr"] == 10_620_855, str(wallet)[:200])
        status, paper_after = alice.post("/api/paper")
        check("the USD portfolio keeps the move",
              abs(paper_after["paper"]["cash"] - (before["cash"] - 100)) < 1e-6
              and paper_after["paper"]["transfers"][0]["id"] == moved.get("transfer", {}).get("id"), str(paper_after)[:200])
        status, stale = alice.post("/api/wallet/transfer", {"direction": "usd_to_idr", "amount": 100, "rev": 2})
        check("a move on a stale wallet revision is refused with the newer copy",
              stale.get("ok") is False and stale.get("conflict") is True and stale.get("rev") == 3, str(stale)[:200])
        status, body = alice.post("/api/wallet/transfer", {"direction": "usd_to_idr", "amount": 1e9, "rev": 3})
        check("can't move more US dollars than the cash", body.get("ok") is False and "Not enough" in body.get("error", ""))
        status, body = alice.post("/api/wallet/transfer", {"direction": "idr_to_usd", "amount": 50_000_000, "rev": 3})
        check("can't move more rupiah than the free cash", body.get("ok") is False and "free" in body.get("error", ""))
        for bad, label in [({"direction": "usd_to_idr", "amount": "NaN", "rev": 3}, "a NaN amount"),
                           ({"direction": "usd_to_idr", "amount": "1e999", "rev": 3}, "an infinite amount"),
                           ({"direction": "sideways", "amount": 100, "rev": 3}, "an unknown direction"),
                           ({"direction": "usd_to_idr", "amount": 0.5, "rev": 3}, "an amount under $1"),
                           ({"direction": "usd_to_idr", "amount": 100, "rev": "3"}, "a text revision")]:
            status, body = alice.post("/api/wallet/transfer", bad)
            check("transfer rejects " + label, body.get("ok") is False, str(body)[:200])
        status, wallet = alice.post("/api/indonesia/wallet")
        status, paper_now = alice.post("/api/paper")
        check("refused moves change neither wallet",
              wallet.get("rev") == 3 and abs(paper_now["paper"]["cash"] - (before["cash"] - 100)) < 1e-6)
        held = dict(wallet["wallet"], savedAt="2026-10-28T11:00:00.000Z",
                    orders=[{"id": "o1", "status": "open", "side": "buy", "symbol": "BBCA", "reservedIdr": 10_000_000}])
        status, saved = alice.post("/api/indonesia/wallet/save", {"state": held, "rev": 3})
        status, body = alice.post("/api/wallet/transfer", {"direction": "idr_to_usd", "amount": 1_000_000, "rev": 4})
        check("rupiah held for open orders can't be moved",
              saved.get("rev") == 4 and body.get("ok") is False and "free" in body.get("error", ""), str(body)[:200])
        status, back = alice.post("/api/wallet/transfer", {"direction": "idr_to_usd", "amount": 500_000, "rev": 4})
        check("move Rp500,000 back: $30.54 at 16,290 minus 0.5%",
              back.get("ok") is True and back["transfer"]["usd"] == 30.54 and back["transfer"]["fee"] == 0.15
              and back.get("rev") == 5, str(back)[:300])
        if back.get("ok"):
            check("both ledgers net the two moves",
                  abs(back["paper"]["cash"] - (before["cash"] - 100 + 30.54)) < 1e-6
                  and back["paper"]["contributions"] == -69.31
                  and back["wallet"]["wallet"]["cashIdr"] == 10_120_855
                  and back["wallet"]["wallet"]["contributionsIdr"] == 1_129_000, str(back)[:300])
        status, body = alice.post("/api/wallet/transfer", {"direction": "usd_to_idr", "amount": 100, "rev": 5},
                                  headers={"Origin": "http://evil.example"})
        check("cross-site transfer blocked", status == 403)
        cash_now = alice.post("/api/paper")[1]["paper"]["cash"]
        alice.post("/api/quiz", {"answers": {"risk_points": [4, 4, 4, 4, 4, 4], "style_points": [5, 5, 4, 5], "flags": []},
                                 "paper_cash": 50000})
        check("retaking the quiz after a move keeps the USD cash",
              abs(alice.post("/api/paper")[1]["paper"]["cash"] - cash_now) < 1e-6)

        # Guard-rail: a 1R plan is refused for a profile whose minimum reward:risk is 1.5.
        alice.post("/api/trade", {"step": "entry", "mode": "demo", "params": {"symbol": "TSLA"}})
        alice.post("/api/trade", {"step": "exit", "mode": "demo", "params": {"stop_rule": "or-mid", "target_rule": "1R"}})
        alice.post("/api/trade", {"step": "timemachine", "mode": "demo", "params": {"replays": 100}})
        status, refused = alice.post("/api/trade", {"step": "budget", "mode": "demo", "params": {}})
        check("1R plan refused under a 1.5 minimum reward:risk",
              not refused.get("ok") and "minimum" in (refused.get("data") or {}).get("sizing", {}).get("refusal", ""))

        steps = {}
        for step, params in (
            ("entry", {"symbol": "TSLA"}),
            ("exit", {"stop_rule": "or-mid", "target_rule": "1.5R"}),
            ("timemachine", {"replays": 2000, "seed": 19}),
            ("budget", {}),
            ("risk", {}),
            ("broker", {}),
        ):
            status, steps[step] = alice.post("/api/trade", {"step": step, "mode": "demo", "params": params})
        check("demo entry triggers on TSLA 10:15", steps["entry"]["data"]["status"] == "triggered")
        check("exit plan at the profile's 1.5R: stop 358.32, target 372.97",
              steps["exit"]["data"]["stop"] == 358.32 and steps["exit"]["data"]["target"] == 372.97)
        machine = steps["timemachine"]["data"]
        check("time machine replays + history", machine["mc"]["replays"] == 2000 and machine["history"]["sessions"] == 59)
        sizing = (steps["budget"].get("data") or {}).get("sizing", {})
        check("sized to the $50 max loss: 8 shares", sizing["qty"] == 8 and sizing["max_loss"] == 46.88, str(sizing.get("qty")))
        risk_results = (steps["risk"].get("data") or {}).get("results") or [{}]
        check("risk check PASS", risk_results[0].get("verdict") == "PASS", steps["risk"].get("stderr", ""))
        tickets = steps["broker"].get("data") or [{}]
        check("ticket READY, paper", bool(tickets[0].get("ready")) and bool(tickets[0].get("paper")))
        status, body = alice.post("/api/trade", {"step": "entry", "mode": "demo", "params": {"symbol": "AAPL"}})
        check("demo refuses non-TSLA tickers", not body.get("ok"))

        print("input validation (no network needed)")
        status, body = alice.post("/api/profile", {"budget": "lots"})
        check("text budget rejected cleanly", status == 200 and not body.get("ok") and "number" in body.get("error", ""), str(body))
        status, body = alice.post("/api/profile", {"budget": "NaN"})
        check("NaN budget rejected", not body.get("ok"), str(body))
        status, body = alice.post("/api/profile", {"limits": {"max_loss_per_trade_usd": -5}})
        check("negative max loss rejected", not body.get("ok"), str(body))
        status, body = alice.post("/api/paper/order", {"symbol": "AAPL", "side": "buy", "dollars": "nan"})
        check("NaN paper order rejected", not body.get("ok"), str(body))
        status, body = alice.post("/api/paper/order", {"symbol": "AAPL", "side": "buy", "dollars": "Infinity"})
        check("infinite paper order rejected", not body.get("ok"), str(body))
        status, body = alice.post("/api/paper/copy", {"amount": "nan", "weights": [{"ticker": "AAPL", "weight": 1}]})
        check("NaN copy amount rejected", not body.get("ok"), str(body))
        status, body = alice.post("/api/paper/reset", {"cash": -50})
        check("negative paper reset rejected", not body.get("ok"), str(body))
        status, body = alice.post("/api/me")
        cash = body["profile"]["paper"]["cash"]
        check("paper cash still a real number", isinstance(cash, (int, float)) and cash == cash and cash > 0, str(cash))

        host, port_text = base.split("//", 1)[1].split(":")
        with socket.create_connection((host, int(port_text)), timeout=10) as raw:
            raw.sendall(b"GET /%2e%2e/server.py HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            reply = raw.recv(4096).decode("latin-1")
        check("path traversal blocked", reply.startswith("HTTP/1.0 404") or reply.startswith("HTTP/1.1 404"), reply[:40])
        with socket.create_connection((host, int(port_text)), timeout=10) as raw:
            raw.sendall(b"POST /api/me HTTP/1.1\r\nHost: x\r\nContent-Length: abc\r\nConnection: close\r\n\r\n")
            reply = raw.recv(4096).decode("latin-1")
        check("bad Content-Length answered with 413", " 413 " in reply.split("\r\n", 1)[0], reply[:40])

        for raw in (b"null", b"[]", b'{"budget":NaN}'):
            request = urllib.request.Request(base + "/api/profile", data=raw,
                                             headers={"Content-Type": "application/json"})
            try:
                response = alice.opener.open(request)
                response.close()
                code = response.status
            except urllib.error.HTTPError as err:
                code = err.code
            check("invalid JSON shape rejected: " + raw.decode(), code == 400)
        status, body = alice.post("/api/profile", {"name": []})
        check("invalid name type rejected", not body.get("ok"))
        status, body = alice.post("/api/profile", {"budget": True})
        check("boolean budget rejected", not body.get("ok"))
        status, body = alice.post("/api/profile", {"limits": {"max_position_pct": 101}})
        check("over-100 percent allocation refused", not body.get("ok"))

        bob = Client(base)
        bob.post("/api/signup", {"username": "bob", "password": "another-pass-2", "name": "Bob"})
        status, body = bob.post("/api/me")
        check("second user is isolated", body["profile"]["name"] == "Bob" and body["profile"]["quiz"] is None)
        status, wallet = bob.post("/api/indonesia/wallet")
        check("second user has their own Indonesia wallet",
              wallet.get("wallet") is None and wallet.get("rev") == 0 and wallet.get("account") != alice_account)
        status, body = bob.post("/api/wallet/transfer", {"direction": "usd_to_idr", "amount": 100, "rev": 0})
        check("no transfer before the rupiah wallet exists", body.get("ok") is False and body.get("code") == "no_wallet")
        status, body = bob.post("/api/login", {"username": "alice", "password": "wrong-password"})
        check("wrong password rejected", not body.get("ok"))

        users = Path(data_dir, "users.json").read_text()
        check("passwords stored hashed", "correct-horse-1" not in users)
    finally:
        proc.terminate()
        proc.wait(timeout=10)


def main():
    with tempfile.TemporaryDirectory() as e2e_dir, tempfile.TemporaryDirectory() as unit_dir:
        end_to_end(e2e_dir)
        unit_tests(unit_dir)
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
        sys.exit(1)
    print("PASSED: Twin")
    sys.exit(0)


if __name__ == "__main__":
    main()
