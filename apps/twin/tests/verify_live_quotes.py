"""Twin 1.7: real-time quote sources (Finnhub, Alpaca) on top of Yahoo, and daily data backups.

Runs against a local mock of the Finnhub and Alpaca market-data APIs; no network, no real keys.
"""
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, urlparse

APP_DIR = Path(__file__).resolve().parent.parent
FAILURES = []


def check(name, condition, detail=""):
    print("  [%s] %s" % ("PASS" if condition else "FAIL", name))
    if not condition:
        FAILURES.append(name)
        if detail:
            print("        " + str(detail)[:400])


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class MockData(http.server.BaseHTTPRequestHandler):
    state = {"finnhub_fail": False, "calls": []}

    def log_message(self, *args):
        pass

    def reply(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        MockData.state["calls"].append(url.path)
        if url.path == "/api/v1/quote":
            if query.get("token", [""])[0] != "finnhubkey123456":
                return self.reply(401, {"error": "Invalid API key"})
            if MockData.state["finnhub_fail"]:
                return self.reply(500, {"error": "boom"})
            symbol = query.get("symbol", [""])[0]
            if symbol == "AAPL":
                return self.reply(200, {"c": 231.5, "pc": 230.0, "h": 232.0, "l": 229.0, "t": 1793030000})
            return self.reply(200, {"c": 0, "pc": 0, "t": 0})
        if url.path.startswith("/v2/stocks/") and url.path.endswith("/trades/latest"):
            if self.headers.get("APCA-API-KEY-ID") != "PKALPACA12345678":
                return self.reply(403, {"message": "forbidden"})
            symbol = url.path.split("/")[3]
            prices = {"MSFT": 512.25, "BRK.B": 480.0}
            if symbol not in prices:
                return self.reply(404, {"message": "not found"})
            return self.reply(200, {"symbol": symbol, "trade": {"p": prices[symbol], "t": "2026-10-26T19:59:58.123456789Z"}})
        return self.reply(404, {"error": "not found"})


def main():
    port = free_port()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), MockData)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    os.environ["TWIN_FINNHUB_URL"] = "http://127.0.0.1:%d" % port
    os.environ["TWIN_ALPACA_DATA_URL"] = "http://127.0.0.1:%d" % port
    sys.path.insert(0, str(APP_DIR))
    import ssl
    import live_quotes

    data = Path(tempfile.mkdtemp(prefix="twin-live-"))

    def load_json(path, default):
        try:
            return json.loads(path.read_text())
        except (OSError, ValueError):
            return default

    def save_json(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    class NoBroker:
        ibkr = None

    live = live_quotes.LiveQuotes(data, ssl.create_default_context(), load_json, save_json, NoBroker())
    yahoo_aapl = {"symbol": "AAPL", "price": 229.0, "prev": 230.0, "currency": "USD"}

    print("No sources")
    q = live.overlay("u1", yahoo_aapl)
    check("without a source the Yahoo quote is labelled delayed", q["price"] == 229.0 and q["realtime"] is False
          and "delayed" in q["source"], q)
    check("status lists no sources and names the fallback", live.status("u1")["sources"] == [] and "Yahoo" in live.status("u1")["fallback"])

    print("Finnhub")
    try:
        live.set_finnhub("u1", "wrongkey000000000")
        check("bad Finnhub key refused", False)
    except live_quotes.LiveQuoteError as exc:
        check("bad Finnhub key refused (and not saved)", not (data / "users" / "u1" / "market_data.json").exists(), exc)
    status = live.set_finnhub("u1", "finnhubkey123456")
    check("good Finnhub key saved, shown only as a hint", status["finnhub"] and status["finnhub_hint"] == "fi…456"
          and "finnhubkey123456" not in json.dumps(status), status)
    live._cache.clear()
    q = live.overlay("u1", yahoo_aapl)
    check("Finnhub price replaces the delayed one", q["price"] == 231.5 and q["realtime"] is True and q["source"] == "Finnhub (real-time)"
          and q["yahoo_price"] == 229.0, q)
    check("change recomputed from the source's previous close", abs(q["change"] - 1.5) < 1e-9 and abs(q["change_pct"] - (231.5 / 230 - 1) * 100) < 1e-9, q)
    q = live.overlay("u1", {"symbol": "7203.T", "price": 3200.0, "currency": "JPY"})
    check("non-US listing stays on Yahoo with the free Finnhub plan", q["price"] == 3200.0 and q["realtime"] is False, q)
    q = live.overlay("u1", {"symbol": "^GSPC", "price": 6000.0})
    check("indices are not overlaid", q["price"] == 6000.0 and q["realtime"] is False)
    MockData.state["finnhub_fail"] = True
    live._cache.clear()
    q = live.overlay("u1", yahoo_aapl)
    check("a failing source falls back to Yahoo and records why", q["price"] == 229.0 and q["realtime"] is False
          and any("finnhub" in e for e in q.get("source_errors", [])), q)
    MockData.state["finnhub_fail"] = False

    print("Alpaca keys take priority for US listings")
    save_json(data / "users" / "u1" / "broker.json", {"provider": "alpaca", "key_id": "PKALPACA12345678",
                                                    "secret": "alpacasecretalpacasecret", "mode": "paper"})
    live._cache.clear()
    q = live.overlay("u1", {"symbol": "MSFT", "price": 510.0, "prev": 505.0, "currency": "USD"})
    check("Alpaca IEX price used before Finnhub", q["price"] == 512.25 and q["source"] == "Alpaca IEX (real-time)"
          and q["source_time"] == 1793044798, q)
    q = live.overlay("u1", {"symbol": "BRK-B", "price": 479.0, "prev": 478.0, "currency": "USD"})
    check("Yahoo BRK-B maps to Alpaca BRK.B", q["price"] == 480.0, q)
    check("status lists Alpaca and Finnhub", [s["id"] for s in live.status("u1")["sources"]] == ["alpaca", "finnhub"], live.status("u1"))

    print("Unit and mismatch guard")
    check("pence quote converted to pounds", live_quotes.reconcile(120.0, 1.20) == 1.20)
    check("close prices pass through", live_quotes.reconcile(101.0, 100.0) == 101.0)
    check("wildly different price rejected", live_quotes.reconcile(5.0, 0.72) is None)

    print("Removing the Finnhub key")
    status = live.set_finnhub("u1", "")
    check("empty key removes Finnhub", not status["finnhub"] and "finnhub" not in [s["id"] for s in status["sources"]], status)

    print("Daily data backup")
    backup_data = Path(tempfile.mkdtemp(prefix="twin-backup-"))
    (backup_data / "users" / "alice").mkdir(parents=True)
    (backup_data / "users" / "alice" / "profile.json").write_text('{"paper": {"cash": 9000}}')
    (backup_data / "cacert.pem").write_text("certs")
    script = (
        "import sys; sys.argv=['server.py']; sys.path.insert(0, %r); import server; "
        "p = server.backup_data(); p2 = server.backup_data(); print(p, p == p2)" % str(APP_DIR)
    )
    # Use the system CA bundle so the dummy cacert.pem in the data dir isn't loaded as certificates.
    env = dict(os.environ, TWIN_DATA=str(backup_data), SSL_CERT_FILE="/etc/ssl/cert.pem")
    result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, timeout=60)
    zips = sorted((backup_data / "backups").glob("twin-data-*.zip"))
    names = zipfile.ZipFile(zips[0]).namelist() if zips else []
    check("backup zip created once per day", len(zips) == 1 and result.stdout.strip().endswith("True"), result.stdout + result.stderr[-300:])
    check("backup holds accounts/portfolios, skips the cert bundle", "users/alice/profile.json" in names and "cacert.pem" not in names, names)
    check("backup file is private (0600)", zips and (zips[0].stat().st_mode & 0o777) == 0o600)

    server.shutdown()
    print("\n%s: %d failure(s)" % ("FAILED" if FAILURES else "PASSED", len(FAILURES)))
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
