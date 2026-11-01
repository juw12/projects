"""Hermetic tests for Beacon's Bark (iPhone) and Gotify channels.

Starts Beacon against a fake bark-server and a fake Gotify server on loopback,
so nothing leaves the machine.

  python apps/beacon/tests/verify_bark_gotify.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))
sys.path.insert(0, str(HERE))

from verify_channels import Api, free_port, wait_sent  # noqa: E402

FAILURES: list[str] = []
PASSED = 0
BARK_KEY = "ynJ5Ft4atkMkWeo2PAvFhF"
BAD_BARK_KEY = "unknownDeviceKey99"
GOTIFY_TOKEN = "AbCdEf.gHiJkL1"


def check(condition, label):
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


class Recorder:
    """Tiny JSON endpoint: `respond(record) -> (status, body_dict)` decides the reply."""

    def __init__(self, respond):
        self.received: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                record = {
                    "path": self.path,
                    "type": self.headers.get("Content-Type", ""),
                    "gotify_key": self.headers.get("X-Gotify-Key", ""),
                    "json": json.loads(raw or b"{}"),
                }
                outer.received.append(record)
                status, reply = respond(record)
                data = json.dumps(reply).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


def bark_reply(record):
    """bark-server answers HTTP 200 + {"code": 200}; unknown keys get code 400 in the body."""
    if record["json"].get("device_key") == BAD_BARK_KEY:
        return 200, {"code": 400, "message": "failed to get device token"}
    return 200, {"code": 200, "message": "success", "timestamp": int(time.time())}


def gotify_reply(record):
    if record["gotify_key"] != GOTIFY_TOKEN:
        return 401, {"error": "Unauthorized", "errorCode": 401}
    return 200, {"id": len(record), "message": record["json"].get("message", "")}


def unit_tests() -> None:
    import channels
    from channels import ChannelError

    print("Unit: Bark")
    for name in ("BEACON_BARK_HOSTS", "BEACON_GOTIFY_HOSTS"):
        os.environ.pop(name, None)
    check(channels.validate_bark(BARK_KEY) == f"https://api.day.app/{BARK_KEY}", "bare device key -> api.day.app URL")
    check(channels.validate_bark(f"https://api.day.app/{BARK_KEY}/") == f"https://api.day.app/{BARK_KEY}",
          "trailing slash trimmed")
    for bad, label in ((f"http://api.day.app/{BARK_KEY}", "plain http rejected"),
                       (f"https://evil.example/{BARK_KEY}", "foreign Bark host rejected"),
                       (f"https://api.day.app/{BARK_KEY}?sound=x", "query string rejected"),
                       ("https://api.day.app/short", "too-short device key rejected")):
        try:
            channels.validate_bark(bad)
            check(False, label)
        except ChannelError:
            check(True, label)
    os.environ["BEACON_BARK_HOSTS"] = "bark.example.com"
    check(channels.validate_bark(f"https://bark.example.com/{BARK_KEY}") == f"https://bark.example.com/{BARK_KEY}",
          "BEACON_BARK_HOSTS allows a self-hosted bark-server")
    os.environ.pop("BEACON_BARK_HOSTS")

    message = channels.bark_message(BARK_KEY, {"title": "Hi", "body": "There", "url": "https://x.io/a",
                                               "icon": "/rel.png", "tag": "deploys"}, "high")
    check(message == {"device_key": BARK_KEY, "title": "Hi", "body": "There", "level": "timeSensitive",
                      "isArchive": "1", "url": "https://x.io/a", "group": "deploys"},
          "Bark JSON mapping (high -> timeSensitive, relative icon dropped)")
    check(channels.bark_message(BARK_KEY, {"title": "Only"}, "low")["body"] == "Only"
          and channels.bark_message(BARK_KEY, {"title": "Only"}, "low")["level"] == "passive",
          "empty body falls back to title; low -> passive")
    preview = channels.mask_address("bark", f"https://api.day.app/{BARK_KEY}")
    check(BARK_KEY not in preview and preview.endswith(BARK_KEY[-4:]), "Bark device key masked in previews")

    print("Unit: Gotify")
    try:
        channels.validate_gotify("https://push.example.com", GOTIFY_TOKEN)
        check(False, "Gotify refused until BEACON_GOTIFY_HOSTS is set")
    except ChannelError as exc:
        check("BEACON_GOTIFY_HOSTS" in str(exc), "Gotify refused until BEACON_GOTIFY_HOSTS is set")
    check(channels.capabilities()["gotify"]["available"] is False, "capabilities: Gotify unavailable without hosts")
    os.environ["BEACON_GOTIFY_HOSTS"] = "push.example.com"
    try:
        channels.validate_gotify("https://push.example.com", "")
        check(False, "Gotify needs an app token")
    except ChannelError:
        check(True, "Gotify needs an app token")
    first = channels.validate_gotify("https://push.example.com/message", GOTIFY_TOKEN)
    second = channels.validate_gotify("https://push.example.com/", "OtherApp.Token9")
    check(first.startswith("https://push.example.com#k") and GOTIFY_TOKEN not in first,
          "/message suffix stripped, token only as fingerprint")
    check(first != second and first == channels.validate_gotify("https://push.example.com", GOTIFY_TOKEN),
          "one contact per app token on the same server")
    check(channels.mask_address("gotify", first) == "https://push.example.com", "Gotify preview shows the server only")
    check(channels.capabilities()["gotify"] == {"available": True, "hosts": ["push.example.com"]},
          "capabilities: Gotify hosts reported")
    os.environ.pop("BEACON_GOTIFY_HOSTS")
    payload = {"title": "Deploy", "body": "", "url": "https://x.io/d", "image": "https://x.io/i.png"}
    check(channels.gotify_message(payload, "high") == {
        "title": "Deploy", "message": "Deploy", "priority": 8,
        "extras": {"client::display": {"contentType": "text/plain"},
                   "client::notification": {"click": {"url": "https://x.io/d"}, "bigImageUrl": "https://x.io/i.png"}},
    }, "Gotify JSON mapping (priority 8, click URL, big image, plain text)")
    check([channels.gotify_message({"title": "t"}, u)["priority"] for u in ("very-low", "low", "normal")] == [1, 3, 5],
          "Gotify priorities for very-low/low/normal")


def http_tests() -> None:
    work = Path(tempfile.mkdtemp(prefix="beacon-bark-gotify-"))
    bark = Recorder(bark_reply)
    gotify = Recorder(gotify_reply)
    env = dict(os.environ)
    env.update({
        "BEACON_QUIET": "1",
        "BEACON_TEST_HOSTS": "127.0.0.1",
        "BEACON_PROXY": "none",
        "BEACON_GOTIFY_HOSTS": "push.example.com",
        "PYTHONIOENCODING": "utf-8",
    })
    port = free_port()
    admin = "adm_bark_gotify_test"
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
        check(status == 200 and caps.get("bark", {}).get("hosts") == ["api.day.app"]
              and caps.get("gotify", {}).get("available") is True, "/v1/apps reports Bark and Gotify")
        _, created = api.call("POST", "/v1/apps", {"name": "Ops"}, token=admin)
        secret = created["secret_key"]
        app_id = created["app"]["id"]

        bark_base = f"http://127.0.0.1:{bark.port}"
        gotify_base = f"http://127.0.0.1:{gotify.port}"
        status, phone = api.call("POST", "/v1/contacts", {"channel": "bark", "address": f"{bark_base}/{BARK_KEY}/",
                                                          "tags": ["team"], "label": "iphone"}, token=secret)
        check(status == 201 and phone["channel"] == "bark" and BARK_KEY not in json.dumps(phone),
              "Bark device registered, key not echoed")
        status, data = api.call("POST", "/v1/contacts", {"channel": "bark", "address": f"https://evil.example/{BARK_KEY}"},
                                token=secret)
        check(status == 400 and "not allowed" in data.get("error", ""), "foreign Bark host refused")
        status, data = api.call("POST", "/v1/contacts", {"channel": "gotify", "address": gotify_base}, token=secret)
        check(status == 400 and "token" in data.get("error", ""), "Gotify without app token refused")
        status, server = api.call("POST", "/v1/contacts", {"channel": "gotify", "address": gotify_base,
                                                           "secret": GOTIFY_TOKEN, "tags": ["team"]}, token=secret)
        check(status == 201 and server["address_preview"] == gotify_base, "Gotify app registered (server shown)")
        status, again = api.call("POST", "/v1/contacts", {"channel": "gotify", "address": gotify_base + "/",
                                                          "secret": GOTIFY_TOKEN, "tags": ["team"]}, token=secret)
        check(again.get("id") == server["id"], "re-registering the same Gotify app updates, not duplicates")
        status, data = api.call("POST", "/v1/contacts", {"channel": "gotify", "address": "https://gotify.evil.example",
                                                         "secret": GOTIFY_TOKEN}, token=secret)
        check(status == 400 and "BEACON_GOTIFY_HOSTS" in data.get("error", ""), "un-listed Gotify host refused")
        api.call("POST", "/v1/contacts", {"channel": "bark", "address": f"{bark_base}/{BAD_BARK_KEY}",
                                          "tags": ["stale"]}, token=secret)
        api.call("POST", "/v1/contacts", {"channel": "gotify", "address": gotify_base, "secret": "Wrong.Token00",
                                          "tags": ["revoked"]}, token=secret)
        _, subs = api.call("GET", f"/v1/apps/{app_id}/subscribers", token=admin)
        listing = json.dumps(subs)
        check(len(subs["subscribers"]) == 4 and BARK_KEY not in listing and GOTIFY_TOKEN not in listing,
              "subscriber list hides Bark keys and Gotify tokens")

        print("HTTP: delivery")
        status, sent = api.call("POST", "/v1/send", {"title": "Deploy finished ✅", "body": "v2.4 is live",
                                                     "url": "https://status.example.com", "urgency": "high",
                                                     "tag": "deploys", "target": {"tags": ["team"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("targeted") == 2 and message.get("delivered") == 2, "default channels reach Bark + Gotify")
        pushes = [r for r in bark.received if r["json"].get("device_key") == BARK_KEY]
        push = pushes[-1] if pushes else {"json": {}}
        check(push.get("path") == "/push" and push.get("type", "").startswith("application/json"),
              "Bark JSON POST to <server>/push")
        check(push["json"].get("title") == "Deploy finished ✅" and push["json"].get("body") == "v2.4 is live"
              and push["json"].get("level") == "timeSensitive" and push["json"].get("url") == "https://status.example.com"
              and push["json"].get("group") == "deploys", "Bark fields (UTF-8 title, level, url, group)")
        posts = [r for r in gotify.received if r["gotify_key"] == GOTIFY_TOKEN]
        post = posts[-1] if posts else {"json": {}}
        check(post.get("path") == "/message" and post["json"].get("priority") == 8
              and post["json"].get("extras", {}).get("client::notification", {}).get("click", {}).get("url")
              == "https://status.example.com", "Gotify POST /message with X-Gotify-Key, priority, click URL")

        status, sent = api.call("POST", "/v1/send", {"title": "Only iPhone", "channels": ["bark"],
                                                     "target": {"tags": ["team"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("targeted") == 1 and message.get("delivered") == 1, "channels filter: bark only")

        status, sent = api.call("POST", "/v1/send", {"title": "Stale", "target": {"tags": ["stale"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("failed") == 1 and "bark returned HTTP 400" in message.get("error", ""),
              "Bark error code in a 200 body counts as failed")
        status, sent = api.call("POST", "/v1/send", {"title": "Revoked", "target": {"tags": ["revoked"]}}, token=secret)
        message = wait_sent(api, sent["message"]["id"], secret)
        check(message.get("failed") == 1 and "gotify returned HTTP 401" in message.get("error", ""),
              "revoked Gotify token counts as failed")

        status, data = api.call("POST", "/v1/send", {"title": "Invoice", "channels": ["inapp"],
                                                     "fallback": {"after": 60, "unless": "clicked",
                                                                  "channels": ["bark", "gotify"]}}, token=secret)
        check(status == 202 and data["message"]["fallback"]["channels"] == ["bark", "gotify"],
              "fallback can escalate to Bark/Gotify")
        status, data = api.call("GET", "/v1/channels", token=secret)
        check(status == 200 and {"bark", "gotify"} <= set(data.get("channels", {})), "/v1/channels lists Bark/Gotify")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        bark.server.shutdown()
        gotify.server.shutdown()
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    unit_tests()
    http_tests()
    print(f"\n{PASSED} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
