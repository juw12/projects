#!/usr/bin/env python3
"""Hermetic end-to-end test for Trade Twin (stdlib only, no network).

Starts the server on a free port with a temporary data directory, then checks:
health + static files, accounts (signup, login, wrong password, isolation),
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
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(self, path, body=None, headers=None):
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body or {}).encode(),
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            with self.opener.open(request, timeout=120) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def get(self, path):
        with self.opener.open(self.base + path, timeout=30) as response:
            return response.status, response.read()


def unit_tests(data_dir):
    print("unit: monthly returns + goal simulator")
    os.environ["TRADE_TWIN_DATA"] = data_dir
    sys.path.insert(0, str(APP_DIR))
    import server  # noqa: E402  (imported after TRADE_TWIN_DATA is set)

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


def end_to_end(data_dir):
    print("end-to-end: server")
    port = free_port()
    env = dict(os.environ, TRADE_TWIN_DATA=data_dir)
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--port", str(port), "--no-browser"],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.1)
        alice = Client(base)
        status, body = alice.get("/api/health")
        check("GET /api/health", status == 200 and json.loads(body)["app"] == "trade-twin")
        status, body = alice.get("/")
        check("serves the app at /", status == 200 and b"Trade Twin" in body)
        status, body = alice.get("/demo.js")
        check("serves web/demo.js", status == 200 and b"TradeTwinDemo" in body)

        status, body = alice.post("/api/me")
        check("API requires login", status == 401)
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

        # Guard-rail: a 1R plan is refused for a profile whose minimum reward:risk is 1.5.
        alice.post("/api/trade", {"step": "entry", "mode": "demo", "params": {"symbol": "TSLA"}})
        alice.post("/api/trade", {"step": "exit", "mode": "demo", "params": {"stop_rule": "or-mid", "target_rule": "1R"}})
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

        bob = Client(base)
        bob.post("/api/signup", {"username": "bob", "password": "another-pass-2", "name": "Bob"})
        status, body = bob.post("/api/me")
        check("second user is isolated", body["profile"]["name"] == "Bob" and body["profile"]["quiz"] is None)
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
    print("PASSED: Trade Twin")
    sys.exit(0)


if __name__ == "__main__":
    main()
