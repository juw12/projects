"""Tether × Beacon integration test (hermetic). Exit 0 = pass, 1 = fail.

The real Beacon server sends a real VAPID-signed, aes128gcm-encrypted Web Push
to a fake push service. The fake service decrypts it with the "phone's" key and
posts it to the fake device's notification list; Tether then has to find it
with `dumpsys notification`, open the shade and tap it.

  python apps/tether/tests/verify_beacon_link.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
TETHER_SERVER = HERE.parent / "server"
BEACON_SERVER = HERE.parent.parent / "beacon" / "server"
sys.path.insert(0, str(TETHER_SERVER))
sys.path.append(str(BEACON_SERVER))  # only for webpush.py (the crypto)

import adb as adb_module  # noqa: E402
import webpush  # noqa: E402

DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ADMIN = "adm_link_test"
TOKEN = "tether-link-token"
PASSES = 0
FAILURES: list[str] = []


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def call(base, method, path, body=None, headers=None):
    request = urllib.request.Request(
        base + path, method=method, headers={"Content-Type": "application/json", **(headers or {})},
        data=json.dumps(body).encode() if body is not None else None,
    )
    try:
        with DIRECT.open(request, timeout=60) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def wait_port(port):
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f"nothing listening on {port}")


class PhonePushService:
    """Fake push service that hands decrypted pushes to the fake phone."""

    def __init__(self, notifications_file: Path):
        self.port = free_port()
        self.file = notifications_file
        self.file.write_text("[]", encoding="utf-8")
        self.browsers = {}
        self.lock = threading.Lock()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                name = self.path.rsplit("/", 1)[-1]
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                status = outer.deliver(name, body)
                self.send_response(status)
                self.send_header("Content-Length", "0")
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def subscription(self, name):
        private = webpush.generate_private_key()
        auth = os.urandom(16)
        self.browsers[name] = (private, auth)
        return {
            "endpoint": f"http://127.0.0.1:{self.port}/push/{name}",
            "keys": {"p256dh": webpush.b64url_encode(webpush.public_key(private)),
                     "auth": webpush.b64url_encode(auth)},
        }

    def deliver(self, name, body):
        if name.startswith("gone"):
            return 410
        private, auth = self.browsers[name]
        payload = json.loads(webpush.decrypt(body, private, auth))   # the real decryption
        with self.lock:
            items = json.loads(self.file.read_text(encoding="utf-8"))
            items.append({"package": "com.android.chrome", "title": payload["title"],
                          "text": payload.get("body", "")})
            self.file.write_text(json.dumps(items), encoding="utf-8")
        return 201


def main() -> int:
    print("notification parsing")
    sample = (
        "  Notification List:\n"
        "    NotificationRecord(0x1: pkg=com.juw12.vitals user=UserHandle{0} id=7 tag=null importance=4 "
        "key=0|com.juw12.vitals|7|null|10233: Notification(channel=alerts pri=1))\n"
        "      extras={\n"
        "        android.title=String (Battery at 15%)\n"
        "        android.text=SpannableString (Plug in soon (charging slow))\n"
        "      }\n"
        "    NotificationRecord(0x2: pkg=com.android.chrome user=UserHandle{0} id=9 tag=x importance=4 "
        "key=0|com.android.chrome|9|x|10150: Notification(channel=sites))\n"
        "      extras={\n"
        "        android.title=String (Order shipped)\n"
        "        android.bigText=String (Your order 42 is on its way)\n"
        "      }\n"
    )
    items = adb_module.parse_notifications(sample)
    check(len(items) == 2 and items[0]["package"] == "com.juw12.vitals", "two NotificationRecords parsed")
    check(items[0]["text"] == "Plug in soon (charging slow)", "text with parentheses / SpannableString kept")
    check(adb_module.find_notification(items, text="order 42")["title"] == "Order shipped", "bigText searchable")
    check(adb_module.find_notification(items, title="battery", package="com.android.chrome") is None,
          "package filter respected")

    with tempfile.TemporaryDirectory(prefix="tether-beacon-") as tmp:
        tmp = Path(tmp)
        notifications_file = tmp / "notifications.json"
        input_log = tmp / "input.log"
        phone = PhonePushService(notifications_file)

        env = dict(os.environ)
        env.update({
            "BEACON_TEST_HOSTS": "127.0.0.1",
            "BEACON_QUIET": "1",
            "BEACON_PROXY": "none",
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(input_log),
            "TETHER_FAKE_NOTIFS": str(notifications_file),
            "TETHER_FAKE_SHADE": str(tmp / "shade.flag"),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "TETHER_QUIET": "1",
        })
        for key in ("BEACON_URL", "BEACON_KEY", "BEACON_APP_ID"):
            env.pop(key, None)

        beacon_port = free_port()
        beacon = subprocess.Popen(
            [sys.executable, str(BEACON_SERVER / "server.py"), "--port", str(beacon_port),
             "--data", str(tmp / "beacon.db"), "--admin-token", ADMIN],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        )
        wait_port(beacon_port)
        beacon_base = f"http://127.0.0.1:{beacon_port}"
        tether = None
        try:
            print("Beacon side")
            status, data = call(beacon_base, "POST", "/v1/apps", {"name": "Vitals QA"},
                                {"Authorization": f"Bearer {ADMIN}"})
            app, secret = data["app"], data["secret_key"]
            for name, tags in (("phone", ["qa:device"]), ("gone1", ["qa:dead"])):
                status, _ = call(beacon_base, "POST", "/v1/subscribe", {
                    "app_key": app["app_key"], "subscription": phone.subscription(name), "tags": tags})
            check(status == 200, "fake phone subscribed to Beacon (tag qa:device)")

            print("Tether linked to Beacon")
            tether_port = free_port()
            tether = subprocess.Popen(
                [sys.executable, str(TETHER_SERVER / "server.py"), "--port", str(tether_port),
                 "--token", TOKEN, "--no-browser", "--beacon-url", beacon_base, "--beacon-key", secret],
                env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
            )
            wait_port(tether_port)
            tether_base = f"http://127.0.0.1:{tether_port}"
            auth = {"X-Tether-Token": TOKEN}
            serial = "emulator-5554"

            status, health = call(tether_base, "GET", "/api/health", headers=auth)
            check(health.get("beacon") == beacon_base, "Tether health shows the Beacon link")

            print("phone onboarding (Connect this phone to Beacon)")
            status, info = call(beacon_base, "GET", "/v1/app", headers={"Authorization": f"Bearer {secret}"})
            check(status == 200 and info["app"]["app_key"] == app["app_key"], "Beacon /v1/app identifies the app")
            page = DIRECT.open(beacon_base + "/try/?app=" + app["app_key"], timeout=10).read()
            check(b"Enable notifications" in page, "Beacon serves the /try/ subscribe page")
            sw_headers = DIRECT.open(beacon_base + "/try-sw.js", timeout=10).headers
            check(sw_headers.get("Service-Worker-Allowed") == "/", "try-sw.js allowed to control /try/")

            input_log.write_text("", encoding="utf-8")
            (tmp / "state.txt").write_text("", encoding="utf-8")
            status, data = call(tether_base, "POST", "/api/beacon/subscribe-device",
                                {"serial": serial, "tags": ["qa:device", "lang:id"]}, auth)
            log_lines = input_log.read_text(encoding="utf-8").splitlines()
            check(status == 200 and data["result"]["tapped_allow"] is True,
                  f"subscribe-device succeeded ({data.get('error') or data['result']['confirmation']})")
            check(f"reverse tcp:{beacon_port} tcp:{beacon_port}" in log_lines,
                  "local Beacon forwarded to the phone with adb reverse")
            opened = next((line for line in log_lines if line.startswith("open ")), "")
            check(opened.startswith(f"open http://localhost:{beacon_port}/try/?app={app['app_key']}&tags=qa%3Adevice%2Clang%3Aid")
                  and opened.endswith("in com.android.chrome"), "subscribe page opened in Chrome via localhost")
            check(log_lines[-2:] == ["input tap 540 1570", "input tap 780 2050"],
                  f"tapped Enable, then Allow ({log_lines[-2:]})")

            (tmp / "state.txt").write_text("", encoding="utf-8")
            flow_sub = {"steps": [{"action": "beacon_subscribe", "tags": ["qa:device"]}]}
            status, data = call(tether_base, "POST", "/api/flow/run", {"serial": serial, "flow": flow_sub}, auth)
            check(data["report"]["passed"] is True, "beacon_subscribe works as a flow step")
            (tmp / "state.txt").write_text("", encoding="utf-8")

            status, data = call(tether_base, "POST", "/api/push",
                                {"title": "Hello QA", "body": "from the Push tab", "target": {"tags": ["qa:device"]}},
                                auth)
            check(status == 200 and data["message"]["delivered"] == 1, "Push tab: Beacon delivered 1/1")
            status, data = call(tether_base, "GET", f"/api/notifications?serial={serial}", headers=auth)
            titles = [n["title"] for n in data.get("notifications", [])]
            check("Hello QA" in titles, "notification visible through `dumpsys notification`")

            input_log.write_text("", encoding="utf-8")
            status, data = call(tether_base, "POST", "/api/notifications/tap",
                                {"serial": serial, "title": "Hello QA"}, auth)
            log_lines = input_log.read_text(encoding="utf-8").splitlines()
            check(status == 200 and log_lines[:2] == ["shade open", "input tap 530 360"],
                  f"tap via API opens the shade and taps the row ({log_lines[:2]})")

            print("push QA flow")
            flow = {"name": "push smoke", "steps": [
                {"action": "close_notifications"},
                {"action": "push", "title": "Order shipped {run}", "body": "Tap to track",
                 "url": "/orders/42", "target": {"tags": ["qa:device"]}},
                {"action": "wait_notification", "title": "Order shipped {run}", "package": "com.android.chrome",
                 "timeout_ms": 10000},
                {"action": "tap_notification", "title": "Order shipped {run}"},
                {"action": "close_notifications"},
            ]}
            input_log.write_text("", encoding="utf-8")
            status, data = call(tether_base, "POST", "/api/flow/run", {"serial": serial, "flow": flow}, auth)
            report = data.get("report", {})
            check(status == 200 and report.get("passed") is True,
                  f"push → wait → tap flow passes ({[s.get('error') for s in report.get('steps', []) if not s.get('ok')]})")
            run_id = report.get("run_id", "")
            steps = report.get("steps", [])
            check(steps[1].get("beacon", {}).get("delivered") == 1, "push step reports Beacon delivery")
            check(steps[2].get("notification", {}).get("title") == f"Order shipped {run_id}",
                  "{run} made the notification unique to this run")
            row = [n["title"] for n in json.loads(notifications_file.read_text())].index(f"Order shipped {run_id}")
            expected_tap = f"input tap 530 {300 + row * 220 + 60}"
            check(expected_tap in input_log.read_text(encoding="utf-8").splitlines(),
                  f"tapped the right notification row ({expected_tap})")

            print("failure modes")
            bad_flows = {
                "no subscriber": {"steps": [{"action": "push", "title": "x", "target": {"tags": ["qa:nobody"]}}]},
                "dead subscription": {"steps": [{"action": "push", "title": "y", "target": {"tags": ["qa:dead"]}}]},
                "never arrives": {"steps": [{"action": "wait_notification", "title": "never", "timeout_ms": 600}]},
            }
            expected_errors = {"no subscriber": "no Beacon subscriber matched",
                               "dead subscription": "delivered to 0 of 1",
                               "never arrives": "no notification"}
            for label, bad in bad_flows.items():
                status, data = call(tether_base, "POST", "/api/flow/run", {"serial": serial, "flow": bad}, auth)
                error = data["report"]["steps"][0].get("error", "")
                check(data["report"]["passed"] is False and expected_errors[label] in error,
                      f"flow fails clearly: {label} ({error[:60]})")

            print("CLI + MCP")
            cli_env = dict(env, BEACON_URL=beacon_base, BEACON_KEY=secret)
            flow_file = tmp / "push.json"
            flow_file.write_text(json.dumps(flow), encoding="utf-8")
            cli = subprocess.run([sys.executable, str(TETHER_SERVER / "flows.py"), "run", str(flow_file),
                                  "--serial", serial], env=cli_env, capture_output=True, text=True, timeout=90)
            check(cli.returncode == 0 and "PASSED" in cli.stdout, "flows.py CLI runs the push QA flow (CI-ready)")

            mcp = subprocess.Popen([sys.executable, str(TETHER_SERVER / "mcp_server.py")], env=cli_env,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

            def rpc(msg_id, method, params=None):
                mcp.stdin.write(json.dumps({"jsonrpc": "2.0", "id": msg_id, "method": method,
                                            "params": params or {}}).encode() + b"\n")
                mcp.stdin.flush()
                return json.loads(mcp.stdout.readline())

            try:
                rpc(1, "initialize", {"protocolVersion": "2025-06-18"})
                names = {t["name"] for t in rpc(2, "tools/list")["result"]["tools"]}
                check({"send_push", "list_notifications", "tap_notification"} <= names, "MCP exposes push QA tools")
                sent = rpc(3, "tools/call", {"name": "send_push", "arguments": {
                    "title": "Agent ping", "target": {"tags": ["qa:device"]}}})["result"]
                check(not sent["isError"] and '"delivered": 1' in sent["content"][0]["text"], "MCP send_push delivered")
                listed = rpc(4, "tools/call", {"name": "list_notifications", "arguments": {}})["result"]
                check("Agent ping" in listed["content"][0]["text"], "MCP list_notifications sees it on the device")
                tapped = rpc(5, "tools/call", {"name": "tap_notification", "arguments": {"title": "Agent ping"}})["result"]
                check(not tapped["isError"], "MCP tap_notification")
            finally:
                mcp.stdin.close()
                mcp.terminate()
                mcp.wait(timeout=5)

            unlinked = subprocess.run([sys.executable, str(TETHER_SERVER / "flows.py"), "run", str(flow_file),
                                       "--serial", serial], env=env, capture_output=True, text=True, timeout=60)
            check(unlinked.returncode == 1 and "Beacon is not configured" in unlinked.stdout,
                  "without BEACON_URL/KEY the push step explains what to set")
        finally:
            if tether:
                tether.terminate()
                tether.wait(timeout=5)
            beacon.terminate()
            beacon.wait(timeout=5)

    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print(f"  - {failure}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
