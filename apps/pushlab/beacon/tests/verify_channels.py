"""Hermetic tests for Beacon's ntfy and Apprise channels.

Starts Beacon against a fake ntfy server (loopback) and a stub `apprise`
package on PYTHONPATH, so nothing leaves the machine.

  python apps/pushlab/beacon/tests/verify_channels.py
  python apps/pushlab/beacon/tests/verify_channels.py --real-apprise   # use the installed apprise instead of the stub
"""

from __future__ import annotations

import importlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

FAILURES: list[str] = []
PASSED = 0
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

STUB_APPRISE = '''
import json, os
__version__ = "stub-1.0"
class Apprise:
    def __init__(self):
        self.urls = []
    def add(self, url):
        ok = url.split("://", 1)[0] in ("json", "tgram", "slack", "fake")
        if ok:
            self.urls.append(url)
        return ok
    def notify(self, title="", body=""):
        with open(os.environ["STUB_APPRISE_LOG"], "a", encoding="utf-8") as log:
            for url in self.urls:
                log.write(json.dumps({"url": url, "title": title, "body": body}) + "\\n")
        return not any("fail" in url for url in self.urls)
'''


def check(condition, label):
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class FakeNtfy:
    """Records JSON publishes; topic 'flaky' fails once with 503."""

    def __init__(self):
        self.received: list[dict] = []
        self.flaky_failed = False
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                record = {
                    "path": self.path,
                    "auth": self.headers.get("Authorization", ""),
                    "type": self.headers.get("Content-Type", ""),
                    "json": json.loads(body or b"{}"),
                }
                status = 200
                if record["json"].get("topic") == "flaky" and not outer.flaky_failed:
                    outer.flaky_failed = True
                    status = 503
                outer.received.append(record)
                self.send_response(status)
                self.send_header("Content-Length", "2")
                self.end_headers()
                self.wfile.write(b"{}")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def for_topic(self, topic: str) -> list[dict]:
        return [r for r in self.received if r["json"].get("topic") == topic]


class Api:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"

    def call(self, method, path, body=None, token=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Content-Type", "application/json")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with OPENER.open(request, timeout=15) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")


def wait_sent(api: Api, message_id: int, token: str, timeout: float = 20) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        _, data = api.call("GET", f"/v1/messages/{message_id}", token=token)
        message = data.get("message") or {}
        if message.get("status") in ("sent", "failed"):
            return message
        time.sleep(0.2)
    return message


def unit_tests() -> None:
    print("channels.py unit checks")
    import channels

    os.environ.pop("BEACON_NTFY_HOSTS", None)
    check(channels.validate_ntfy("alerts-1") == "https://ntfy.sh/alerts-1", "bare topic → https://ntfy.sh/topic")
    check(channels.validate_ntfy("https://ntfy.sh/a_b/") == "https://ntfy.sh/a_b", "trailing slash trimmed")
    for bad, label in (
        ("https://evil.example/x", "unknown host rejected"),
        ("http://ntfy.sh/x", "plain http rejected"),
        ("https://u:p@ntfy.sh/x", "credentials in URL rejected"),
        ("https://ntfy.sh/x?auth=1", "query string rejected"),
        ("https://ntfy.sh/bad topic!", "invalid topic rejected"),
        ("http://127.0.0.1:9/x", "loopback http rejected unless a test host"),
    ):
        try:
            channels.validate_ntfy(bad)
            check(False, label)
        except channels.ChannelError:
            check(True, label)
    check(channels.validate_ntfy("http://127.0.0.1:9/x", ("127.0.0.1",)) == "http://127.0.0.1:9/x",
          "loopback http allowed for test hosts")
    os.environ["BEACON_NTFY_HOSTS"] = "ntfy.example.com"
    check(channels.validate_ntfy("https://ntfy.example.com/ops") == "https://ntfy.example.com/ops",
          "BEACON_NTFY_HOSTS allows a self-hosted ntfy")
    try:
        channels.validate_ntfy("https://ntfy.sh/ops")
        check(False, "custom host list replaces the default")
    except channels.ChannelError:
        check(True, "custom host list replaces the default")
    os.environ.pop("BEACON_NTFY_HOSTS")

    message = channels.ntfy_message("ops", {"title": "Hi", "body": "There", "url": "https://x.io/a",
                                            "icon": "/rel.png", "image": "https://x.io/i.png", "tag": "t1"}, "high")
    check(message == {"topic": "ops", "title": "Hi", "message": "There", "priority": 4, "click": "https://x.io/a",
                      "attach": "https://x.io/i.png", "tags": ["t1"]}, "ntfy JSON mapping (relative icon dropped)")
    check(channels.ntfy_message("t", {"title": "Only"}, "very-low")["message"] == "Only", "empty body falls back to title")
    check(channels.mask_address("apprise", "tgram://123456:SECRETTOKEN/987") == "tgram://…/987",
          "apprise addresses are masked")

    saved = sys.modules.get("apprise", "missing")
    sys.modules["apprise"] = None  # simulate "not installed"
    try:
        channels.validate_apprise("tgram://a/b")
        check(False, "apprise missing → clear error")
    except channels.ChannelError as exc:
        check("pip install apprise" in str(exc), "apprise missing → clear error")
    check(channels.capabilities()["apprise"]["available"] is False, "capabilities report apprise missing")
    if saved == "missing":
        del sys.modules["apprise"]
    else:
        sys.modules["apprise"] = saved


def http_tests(real_apprise: bool) -> None:
    work = Path(tempfile.mkdtemp(prefix="beacon-channels-"))
    ntfy = FakeNtfy()
    log_path = work / "apprise.log"
    env = dict(os.environ)
    env.update({
        "BEACON_QUIET": "1",
        "BEACON_TEST_HOSTS": "127.0.0.1",
        "BEACON_PROXY": "none",
        "STUB_APPRISE_LOG": str(log_path),
        "PYTHONIOENCODING": "utf-8",
    })
    if not real_apprise:
        (work / "stub" / "apprise").mkdir(parents=True)
        (work / "stub" / "apprise" / "__init__.py").write_text(STUB_APPRISE, encoding="utf-8")
        env["PYTHONPATH"] = str(work / "stub")
    port = free_port()
    admin = "adm_channels_test"
    process = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--data", str(work / "b.db"),
         "--admin-token", admin],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    api = Api(port)
    try:
        for _ in range(100):
            try:
                if api.call("GET", "/v1/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        print("HTTP: contacts")
        status, data = api.call("GET", "/v1/apps", token=admin)
        caps = data.get("channels", {})
        check(status == 200 and caps.get("ntfy", {}).get("hosts") == ["ntfy.sh"], "/v1/apps reports ntfy hosts")
        check(caps.get("apprise", {}).get("available") is True, "/v1/apps reports apprise available")
        _, created = api.call("POST", "/v1/apps", {"name": "Ops"}, token=admin)
        secret = created["secret_key"]
        app_id = created["app"]["id"]
        _, other = api.call("POST", "/v1/apps", {"name": "Other"}, token=admin)

        ntfy_url = f"http://127.0.0.1:{ntfy.port}/alerts"
        check(api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": ntfy_url})[0] == 401,
              "contacts need a secret or admin key")
        status, alerts = api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": ntfy_url, "tags": ["team"],
                                                           "secret": "tk_test"}, token=secret)
        check(status == 201 and alerts["channel"] == "ntfy", "app secret registers an ntfy topic")
        status, again = api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": ntfy_url, "tags": ["team"],
                                                          "secret": "tk_test"}, token=secret)
        check(again.get("id") == alerts["id"], "re-registering the same topic updates, not duplicates")
        status, public = api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": "beacon-x1"}, token=secret)
        check(status == 201 and public["address_preview"] == "https://ntfy.sh/beacon-x1", "bare topic normalised")
        status, data = api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": "https://evil.example/x"},
                                token=secret)
        check(status == 400 and "not allowed" in data["error"], "foreign ntfy host refused")
        status, data = api.call("POST", "/v1/contacts", {"channel": "sms", "address": "x"}, token=secret)
        check(status == 400, "unknown contact channel refused")
        status, flaky = api.call("POST", "/v1/contacts", {"app_id": app_id, "channel": "ntfy",
                                                          "address": f"http://127.0.0.1:{ntfy.port}/flaky",
                                                          "tags": ["flaky"]}, token=admin)
        check(status == 201, "admin registers a contact with app_id")

        status, tg = api.call("POST", "/v1/contacts", {"channel": "apprise", "address": "tgram://123456:SECRET/987",
                                                       "tags": ["team"], "label": "telegram"}, token=secret)
        check(status == 201 and "SECRET" not in json.dumps(tg), "apprise contact registered, token not echoed")
        status, data = api.call("POST", "/v1/contacts", {"channel": "apprise", "address": "nonsense"}, token=secret)
        check(status == 400, "malformed apprise URL refused")
        status, data = api.call("POST", "/v1/contacts", {"channel": "apprise", "address": "zzz://host/x"},
                                token=secret)
        check(status == 400 and "recognise" in data["error"], "unsupported apprise service refused")
        status, broken = api.call("POST", "/v1/contacts", {"channel": "apprise", "address": "fake://fail-me",
                                                           "tags": ["broken"]}, token=secret)

        _, subs = api.call("GET", f"/v1/apps/{app_id}/subscribers", token=admin)
        listing = json.dumps(subs)
        check(len(subs["subscribers"]) == 5 and "SECRET" not in listing and "tk_test" not in listing,
              "subscriber list masks contact secrets")
        check(api.call("POST", f"/v1/subscribers/{public['id']}/delete", token=other["secret_key"])[0] == 404,
              "another app cannot delete my contact")
        check(api.call("POST", f"/v1/subscribers/{public['id']}/delete", token=secret)[0] == 200,
              "app deletes its own contact")

        print("HTTP: delivery")
        status, sent = api.call("POST", "/v1/send", {"title": "Deploy finished ✅", "body": "v2.3 is live",
                                                     "url": "https://status.example.com", "urgency": "high",
                                                     "target": {"tags": ["team"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("targeted") == 2 and message.get("delivered") == 2,
              "default channels reach ntfy + apprise contacts")
        got = ntfy.for_topic("alerts")
        publish = got[-1] if got else {}
        check(publish.get("path") == "/" and publish.get("type") == "application/json", "ntfy JSON publish to server root")
        check(publish.get("json", {}).get("title") == "Deploy finished ✅" and publish["json"].get("priority") == 4
              and publish["json"].get("click") == "https://status.example.com", "ntfy fields (UTF-8 title, priority, click)")
        check(publish.get("auth") == "Bearer tk_test", "ntfy access token sent as Bearer")
        lines = [json.loads(l) for l in log_path.read_text(encoding="utf-8").splitlines()] if log_path.exists() else []
        check(any(l["url"].startswith("tgram://") and l["title"] == "Deploy finished ✅"
                  and "https://status.example.com" in l["body"] for l in lines), "apprise notify called with title/body/url")

        status, sent = api.call("POST", "/v1/send", {"title": "Only ntfy", "channels": ["ntfy"],
                                                     "target": {"tags": ["team"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("targeted") == 1 and message.get("delivered") == 1, "channels filter: ntfy only")

        status, sent = api.call("POST", "/v1/send", {"title": "Retry me", "target": {"tags": ["flaky"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("delivered") == 1 and len(ntfy.for_topic("flaky")) == 2, "ntfy 503 retried then delivered")

        status, sent = api.call("POST", "/v1/send", {"title": "Doomed", "target": {"tags": ["broken"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("failed") == 1 and "apprise" in message.get("error", ""), "apprise failure counted with error")

        status, data = api.call("GET", "/v1/channels", token=secret)
        check(status == 200 and "ntfy" in data["channels"], "/v1/channels for senders")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        ntfy.server.shutdown()
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    real_apprise = "--real-apprise" in sys.argv
    unit_tests()
    http_tests(real_apprise)
    print(f"\n{PASSED} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
