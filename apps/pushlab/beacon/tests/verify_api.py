"""Hermetic end-to-end tests for Beacon. Exit 0 = pass, 1 = fail.

Spins up, on free loopback ports:
  * a fake Web Push service that verifies every VAPID JWT and DECRYPTS every
    payload with the subscriber's private key (so encryption is really checked);
  * fake Google OAuth + FCM endpoints that verify the RS256 service-account JWT;
  * the Beacon server itself (temp SQLite database).

  python apps/pushlab/beacon/tests/verify_api.py
"""

from __future__ import annotations

import json
import os
import random
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # bypass corporate proxies
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

import fcm  # noqa: E402
import webpush  # noqa: E402

ADMIN = "adm_test_token"
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


# ------------------------------------------------------------ RSA test key
def _is_probable_prime(n: int) -> bool:
    if n < 2:
        return False
    for p in (2, 3, 5, 7, 11, 13, 17, 19, 23, 29):
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    rng = random.Random(n)
    for _ in range(24):
        a = rng.randrange(2, n - 2)
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _prime(bits: int, rng: random.Random) -> int:
    while True:
        candidate = rng.getrandbits(bits) | (1 << (bits - 1)) | 1
        if _is_probable_prime(candidate) and (candidate - 1) % 65537:
            return candidate


def _der(tag: int, body: bytes) -> bytes:
    length = len(body)
    if length < 128:
        return bytes([tag, length]) + body
    size = (length.bit_length() + 7) // 8
    return bytes([tag, 0x80 | size]) + length.to_bytes(size, "big") + body


def _der_int(value: int) -> bytes:
    raw = value.to_bytes(max(1, (value.bit_length() + 8) // 8), "big")
    return _der(0x02, raw)


def make_rsa_pem(bits: int = 1024) -> tuple[str, int, int]:
    rng = random.Random(20261101)
    e = 65537
    p = _prime(bits // 2, rng)
    q = _prime(bits // 2, rng)
    n = p * q
    d = pow(e, -1, (p - 1) * (q - 1))
    rsa_private = _der(0x30, b"".join(_der_int(v) for v in (
        0, n, e, d, p, q, d % (p - 1), d % (q - 1), pow(q, -1, p),
    )))
    algorithm = _der(0x30, bytes.fromhex("06092a864886f70d0101010500"))
    pkcs8 = _der(0x30, _der_int(0) + algorithm + _der(0x04, rsa_private))
    body = b64encode(pkcs8).decode()
    pem = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(body[i:i + 64] for i in range(0, len(body), 64))
    return pem + "\n-----END PRIVATE KEY-----\n", n, e


# --------------------------------------------------------- fake services
class FakePushService:
    """Plays Chrome/Firefox push servers. Decrypts with the browser's private key."""

    def __init__(self):
        self.port = free_port()
        self.browsers: dict[str, dict] = {}   # name -> {private, public, auth}
        self.received: dict[str, list[dict]] = {}
        self.flaky_calls = 0
        self.errors: list[str] = []
        self.vapid_keys: set[str] = set()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                name = self.path.rsplit("/", 1)[-1]
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                status = outer.handle(name, self.headers, body)
                self.send_response(status)
                self.send_header("Content-Length", "0")
                self.end_headers()

        self.server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def new_browser(self, name: str) -> dict:
        private = webpush.generate_private_key()
        auth = os.urandom(16)
        self.browsers[name] = {"private": private, "auth": auth}
        return {
            "endpoint": f"http://127.0.0.1:{self.port}/push/{name}",
            "keys": {
                "p256dh": webpush.b64url_encode(webpush.public_key(private)),
                "auth": webpush.b64url_encode(auth),
            },
        }

    def handle(self, name: str, headers, body: bytes) -> int:
        if name.startswith("gone"):
            return 410
        if name.startswith("flaky"):
            self.flaky_calls += 1
            if self.flaky_calls == 1:
                return 503
        try:
            match = re.match(r"vapid t=([^,]+), k=(.+)", headers.get("Authorization", ""))
            token, key = match.group(1), match.group(2)
            head, claims, signature = token.split(".")
            if not webpush.ecdsa_verify(webpush.b64url_decode(key), f"{head}.{claims}".encode(),
                                        webpush.b64url_decode(signature)):
                raise ValueError("VAPID signature invalid")
            claim_data = json.loads(webpush.b64url_decode(claims))
            if claim_data["aud"] != f"http://127.0.0.1:{self.port}":
                raise ValueError(f"wrong audience {claim_data['aud']}")
            if headers.get("Content-Encoding") != "aes128gcm" or not headers.get("TTL"):
                raise ValueError("missing RFC 8030/8291 headers")
            self.vapid_keys.add(key)
            browser = self.browsers[name]
            plaintext = webpush.decrypt(body, browser["private"], browser["auth"])
            self.received.setdefault(name, []).append({
                "payload": json.loads(plaintext),
                "urgency": headers.get("Urgency"),
                "topic": headers.get("Topic"),
                "ttl": headers.get("TTL"),
            })
            return 201
        except Exception as exc:  # recorded and reported by the tests
            self.errors.append(f"{name}: {exc}")
            return 400


class FakeGoogle:
    """OAuth token endpoint + FCM HTTP v1 endpoint."""

    def __init__(self, n: int, e: int, client_email: str):
        self.port = free_port()
        self.n, self.e, self.client_email = n, e, client_email
        self.messages: list[dict] = []
        self.token_requests = 0
        self.errors: list[str] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, payload):
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if self.path == "/token":
                    self.reply(*outer.token(body))
                else:
                    self.reply(*outer.send(self.path, self.headers, body))

        self.server = ThreadingHTTPServer(("127.0.0.1", self.port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def token(self, body: bytes):
        self.token_requests += 1
        form = urllib.parse.parse_qs(body.decode())
        assertion = form["assertion"][0]
        head, claims, signature = assertion.split(".")
        ok = fcm.verify_rs256(self.n, self.e, f"{head}.{claims}".encode(), webpush.b64url_decode(signature))
        claim_data = json.loads(webpush.b64url_decode(claims))
        if not ok or claim_data["iss"] != self.client_email or "firebase.messaging" not in claim_data["scope"]:
            self.errors.append("bad service-account assertion")
            return 400, {"error": "invalid_grant"}
        return 200, {"access_token": "ya29.test-access", "expires_in": 3600}

    def send(self, path: str, headers, body: bytes):
        if headers.get("Authorization") != "Bearer ya29.test-access":
            return 401, {"error": {"status": "UNAUTHENTICATED"}}
        if path != "/v1/projects/beacon-test/messages:send":
            return 404, {"error": {"status": "NOT_FOUND"}}
        message = json.loads(body)["message"]
        if message["token"] == "dead-token":
            return 404, {"error": {"status": "NOT_FOUND",
                                   "details": [{"errorCode": "UNREGISTERED"}]}}
        self.messages.append(message)
        return 200, {"name": "projects/beacon-test/messages/1"}


# ------------------------------------------------------------- HTTP client
class Api:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"

    def call(self, method, path, body=None, token=None, headers=None):
        all_headers = dict(headers or {})
        if token:
            all_headers["Authorization"] = f"Bearer {token}"
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            all_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, headers=all_headers, method=method)
        try:
            with DIRECT.open(request, timeout=30) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw[:1] in (b"{", b"[") else raw), dict(response.headers)
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                return exc.code, json.loads(raw), dict(exc.headers)
            except ValueError:
                return exc.code, raw, dict(exc.headers)


def wait_message(api, message_id, token, status="sent", timeout=20):
    deadline = time.time() + timeout
    message = None
    while time.time() < deadline:
        _, data, _ = api.call("GET", f"/v1/messages/{message_id}", token=token)
        message = data.get("message")
        if message and message["status"] == status:
            return message
        time.sleep(0.2)
    return message


def start_beacon(port, db, env):
    process = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--data", str(db),
         "--admin-token", ADMIN, "--public-url", f"http://127.0.0.1:{port}"],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return process
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("Beacon did not start: " + process.stdout.read().decode(errors="replace"))


# ------------------------------------------------------------------ tests
def main() -> int:
    print("crypto known-answer tests (shared with Orbis)")
    kat = subprocess.run([sys.executable, str(HERE / "verify_webpush.py")], capture_output=True, text=True)
    check(kat.returncode == 0, "RFC 8291 / RFC 6979 / FIPS-197 / NIST GCM vectors pass on vendored webpush.py")

    print("RSA / FCM signing")
    pem, n, e = make_rsa_pem()
    key = fcm.RsaKey.from_pem(pem)
    check(key.n == n and key.e == e, "PKCS#8 private key parsed")
    signature = key.sign_sha256(b"hello")
    check(fcm.verify_rs256(n, e, b"hello", signature), "RS256 signature verifies")
    check(not fcm.verify_rs256(n, e, b"hellO", signature), "RS256 rejects altered message")

    print("egress proxy selection")
    import dispatcher
    saved_proxy = os.environ.get("BEACON_PROXY")
    os.environ["BEACON_PROXY"] = "http://proxy.corp:3128"
    check(dispatcher.egress_proxy("fcm.googleapis.com") == ("proxy.corp", 3128), "BEACON_PROXY used for push hosts")
    check(dispatcher.egress_proxy("127.0.0.1") is None, "loopback never proxied")
    os.environ["BEACON_PROXY"] = "none"
    check(dispatcher.egress_proxy("fcm.googleapis.com") is None, "BEACON_PROXY=none disables proxying")
    if saved_proxy is None:
        os.environ.pop("BEACON_PROXY")
    else:
        os.environ["BEACON_PROXY"] = saved_proxy

    push = FakePushService()
    service_account = {
        "type": "service_account",
        "project_id": "beacon-test",
        "client_email": "beacon@beacon-test.iam.gserviceaccount.com",
        "private_key": pem,
    }
    google = FakeGoogle(n, e, service_account["client_email"])
    service_account["token_uri"] = f"http://127.0.0.1:{google.port}/token"

    with tempfile.TemporaryDirectory(prefix="beacon-test-") as tmp:
        env = dict(os.environ)
        env.update({
            "BEACON_TEST_HOSTS": "127.0.0.1",
            "BEACON_FCM_API_BASE": f"http://127.0.0.1:{google.port}",
            "BEACON_QUIET": "1",
            "BEACON_RATE_PER_MINUTE": "10000",
        })
        port = free_port()
        db = Path(tmp) / "beacon.db"
        server = start_beacon(port, db, env)
        api = Api(port)
        try:
            run_http_tests(api, push, google, service_account)
            run_mcp_tests(api, env)
        finally:
            server.terminate()
            server.wait(timeout=5)

        print("persistence")
        server = start_beacon(port, db, env)
        try:
            status, data, _ = api.call("GET", "/v1/apps", token=ADMIN)
            check(status == 200 and len(data["apps"]) >= 1, "apps survive a restart")
            first = data["apps"][0]
            check(first["subscribers"].get("webpush", 0) >= 1, "subscribers survive a restart")
        finally:
            server.terminate()
            server.wait(timeout=5)

    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print(f"  - {failure}")
    return 1 if FAILURES else 0


def run_http_tests(api: Api, push: FakePushService, google: FakeGoogle, service_account: dict):
    print("server basics")
    status, data, _ = api.call("GET", "/v1/health")
    check(status == 200 and data["ok"], "health")
    status, page, _ = api.call("GET", "/")
    check(status == 200 and b"Beacon" in page, "console page served")
    status, sdk, headers = api.call("GET", "/beacon.js")
    check(status == 200 and b"Beacon" in sdk and headers.get("Access-Control-Allow-Origin") == "*",
          "beacon.js served with CORS")
    status, _, _ = api.call("GET", "/../server/store.py")
    check(status == 404, "static path traversal blocked")
    check(api.call("GET", "/v1/apps")[0] == 401, "admin API needs a token")
    check(api.call("GET", "/v1/apps", token="adm_wrong")[0] == 401, "wrong admin token rejected")

    print("apps")
    status, data, _ = api.call("POST", "/v1/apps", {"name": "Vitals", "subject": "mailto:juwen@example.com"}, ADMIN)
    check(status == 201 and data["secret_key"].startswith("sk_"), "create app returns secret once")
    app, secret = data["app"], data["secret_key"]
    check("vapid_private" not in app and "secret_hash" not in app, "app view hides private key material")
    status, data, headers = api.call("GET", f"/v1/client/{app['app_key']}")
    check(data["vapid_public_key"] == app["vapid_public_key"], "client config exposes VAPID public key")
    check(api.call("GET", "/v1/client/pk_nope")[0] == 404, "unknown app key 404")
    status, other, _ = api.call("POST", "/v1/apps", {"name": "Glow"}, ADMIN)
    other_app, other_secret = other["app"], other["secret_key"]

    print("subscriptions")
    subs = {}
    for name, user, tags in (
        ("alice", "u1", ["lang:id", "plan:pro"]),
        ("bob", "u2", ["lang:en"]),
        ("gone1", "u3", ["lang:id"]),
    ):
        status, data, headers = api.call("POST", "/v1/subscribe", {
            "app_key": app["app_key"], "subscription": push.new_browser(name), "user_id": user, "tags": tags,
        }, headers={"Origin": "https://vitals.example"})
        subs[name] = data
    check(all(s.get("token", "").startswith("st_") for s in subs.values()), "three browsers subscribed")
    check(headers.get("Access-Control-Allow-Origin") == "*", "public API sends CORS headers")
    bad_endpoint = {"endpoint": "https://evil.example.com/steal", "keys": push.new_browser("x")["keys"]}
    check(api.call("POST", "/v1/subscribe", {"app_key": app["app_key"], "subscription": bad_endpoint})[0] == 400,
          "non-push-service endpoint rejected (SSRF guard)")
    bad_key = push.new_browser("y")
    bad_key["keys"]["p256dh"] = webpush.b64url_encode(b"\x04" + bytes(64))
    check(api.call("POST", "/v1/subscribe", {"app_key": app["app_key"], "subscription": bad_key})[0] == 400,
          "off-curve p256dh rejected")
    check(api.call("POST", "/v1/subscribe", {"app_key": app["app_key"], "subscription": push.new_browser("z"),
                                             "tags": ["bad tag!"]})[0] == 400, "invalid tag rejected")
    status, dev_a, _ = api.call("POST", "/v1/register-device", {
        "app_key": app["app_key"], "token": "good-token-1", "user_id": "u1", "tags": ["lang:id"]})
    api.call("POST", "/v1/register-device", {"app_key": app["app_key"], "token": "dead-token", "tags": ["lang:id"]})
    check(status == 200 and dev_a["token"].startswith("st_"), "native devices registered")

    print("FCM configuration")
    bad = dict(service_account, private_key="not a key")
    check(api.call("POST", f"/v1/apps/{app['id']}", {"fcm_service_account": bad}, ADMIN)[0] == 400,
          "broken service account rejected")
    status, data, _ = api.call("POST", f"/v1/apps/{app['id']}", {"fcm_service_account": service_account}, ADMIN)
    check(status == 200 and data["app"]["fcm_configured"], "service account saved")

    print("send: tags across Web Push + FCM, pruning dead subscriptions")
    status, data, _ = api.call("POST", "/v1/send", {
        "title": "Your weekly report", "body": "Tap to see it", "url": "/report",
        "target": {"tags": ["lang:id"]}, "urgency": "high", "tag": "weekly report!",
        "data": {"week": 44},
    }, token=secret)
    check(status == 202 and data["message"]["status"] == "queued", "send accepted with app secret")
    message = wait_message(api, data["message"]["id"], secret)
    check(message and message["status"] == "sent", "message delivered by dispatcher")
    check((message["targeted"], message["delivered"], message["pruned"], message["failed"]) == (4, 2, 2, 0),
          f"targeted 4 / delivered 2 / pruned 2 / failed 0 (got {message and (message['targeted'], message['delivered'], message['pruned'], message['failed'])})")
    alice = push.received.get("alice", [{}])[-1]
    payload = alice.get("payload", {})
    check(payload.get("title") == "Your weekly report" and payload.get("data") == {"week": 44},
          "alice's browser decrypted the exact payload (RFC 8291)")
    check(alice.get("urgency") == "high" and alice.get("topic") == "weeklyreport", "Urgency + sanitized Topic headers")
    check(push.vapid_keys == {app["vapid_public_key"]}, "VAPID JWT signed with the app's key")
    check("bob" not in push.received, "bob (lang:en) not targeted")
    check(not push.errors, f"push service saw no protocol errors {push.errors}")
    fcm_message = google.messages[-1] if google.messages else {}
    check(fcm_message.get("token") == "good-token-1" and fcm_message["notification"]["title"] == "Your weekly report",
          "FCM v1 message delivered with notification")
    check(json.loads(fcm_message["data"]["beacon"])["url"] == "/report" and fcm_message["android"]["priority"] == "high",
          "FCM data + Android priority set")
    check(google.token_requests == 1 and not google.errors, "OAuth via RS256 service-account JWT")
    _, stats, _ = api.call("GET", "/v1/stats", token=secret)
    check(stats["stats"]["subscribers"] == {"webpush": 2, "fcm": 1}, "dead endpoint + UNREGISTERED token pruned")

    print("targeting by user, retries, tracking")
    status, data, _ = api.call("POST", "/v1/send", {"title": "Hi Bob", "target": {"user_ids": ["u2"]}}, token=secret)
    message = wait_message(api, data["message"]["id"], secret)
    check(message["delivered"] == 1 and push.received.get("bob", [{}])[-1].get("payload", {}).get("title") == "Hi Bob",
          "user_ids targeting reaches only that user")
    api.call("POST", "/v1/subscribe", {"app_key": app["app_key"], "subscription": push.new_browser("flaky1"),
                                        "tags": ["beta"]})
    status, data, _ = api.call("POST", "/v1/send", {"title": "Retry me", "target": {"tags": ["beta"]},
                                                    "channels": ["webpush"]}, token=secret)
    message = wait_message(api, data["message"]["id"], secret)
    check(message["delivered"] == 1 and push.flaky_calls == 2, "503 from push service retried, then delivered")
    sig = payload.get("sig")
    status, _, _ = api.call("POST", "/v1/track", {"id": payload["id"], "sig": sig, "event": "clicked"})
    check(status == 200, "click tracked with payload signature")
    check(api.call("POST", "/v1/track", {"id": payload["id"], "sig": "0" * 16, "event": "clicked"})[0] == 403,
          "forged tracking rejected")
    _, data, _ = api.call("GET", f"/v1/messages/{payload['id']}", token=secret)
    check(data["message"]["clicked"] == 1, "click counted on the message")

    print("scheduling + cancel")
    status, data, _ = api.call("POST", "/v1/send", {"title": "Later", "delay_seconds": 1.5, "target": {"user_ids": ["u1"]}},
                               token=secret)
    check(data["message"]["status"] == "queued", "scheduled message waits")
    message = wait_message(api, data["message"]["id"], secret, timeout=10)
    check(message["status"] == "sent", "scheduled message sent when due")
    status, data, _ = api.call("POST", "/v1/send", {"title": "Never", "send_at": "2099-01-01T09:00:00+07:00"}, token=secret)
    message_id = data["message"]["id"]
    check(api.call("POST", f"/v1/messages/{message_id}/cancel", {}, token=secret)[0] == 200, "scheduled message cancelled")
    check(api.call("POST", f"/v1/messages/{message_id}/cancel", {}, token=secret)[0] == 409, "cannot cancel twice")

    print("in-app messages")
    api.call("POST", "/v1/send", {"title": "Maintenance tonight", "channels": ["inapp"]}, token=secret)
    status, data, _ = api.call("POST", "/v1/send", {"title": "Only for Alice", "channels": ["inapp"],
                                                    "target": {"user_ids": ["u1"]}}, token=secret)
    wait_message(api, data["message"]["id"], secret)
    _, anonymous, _ = api.call("GET", f"/v1/inbox?app_key={app['app_key']}")
    _, for_alice, _ = api.call("GET", f"/v1/inbox?app_key={app['app_key']}&token={subs['alice']['token']}")
    anon_titles = [m["title"] for m in anonymous["messages"]]
    alice_titles = [m["title"] for m in for_alice["messages"]]
    check("Maintenance tonight" in anon_titles and "Only for Alice" not in anon_titles,
          "anonymous inbox only sees broadcast messages")
    check({"Maintenance tonight", "Only for Alice"} <= set(alice_titles), "subscriber inbox sees targeted messages")

    print("validation + isolation")
    check(api.call("POST", "/v1/send", {"body": "no title"}, token=secret)[0] == 400, "title required")
    check(api.call("POST", "/v1/send", {"title": "x", "channels": ["sms"]}, token=secret)[0] == 400, "unknown channel rejected")
    check(api.call("POST", "/v1/send", {"title": "x", "send_at": "2026-12-01T09:00:00"}, token=secret)[0] == 400,
          "send_at without timezone rejected")
    status, data, _ = api.call("POST", "/v1/send", {"title": "x", "data": {"blob": "a" * 1400}, "body": "b" * 600,
                                                    "image": "https://x/" + "c" * 900, "url": "https://y/" + "d" * 900},
                               token=secret)
    check(status == 400 and "too large" in data["error"], "oversized payload rejected before queueing")
    check(api.call("GET", f"/v1/messages/{message_id}", token=other_secret)[0] == 404,
          "another app's secret cannot read this app's messages")
    check(api.call("POST", "/v1/apps", {"name": "x"}, token=secret)[0] == 401, "app secret cannot use admin API")
    status, data, _ = api.call("POST", f"/v1/apps/{app['id']}/rotate-secret", {}, ADMIN)
    check(api.call("GET", "/v1/stats", token=secret)[0] == 401, "rotated secret invalidates the old one")
    secret = data["secret_key"]
    check(api.call("GET", "/v1/stats", token=secret)[0] == 200, "new secret works")

    print("subscriber self-service + origins")
    check(api.call("POST", "/v1/update", {"app_key": app["app_key"], "token": subs["bob"]["token"],
                                          "user_id": "u2", "tags": ["lang:id"]})[0] == 200, "update tags via token")
    check(api.call("POST", "/v1/unsubscribe", {"app_key": app["app_key"], "token": subs["bob"]["token"]})[0] == 200,
          "unsubscribe via token")
    check(api.call("POST", "/v1/unsubscribe", {"app_key": app["app_key"], "token": subs["bob"]["token"]})[0] == 404,
          "token is gone after unsubscribe")
    api.call("POST", f"/v1/apps/{other_app['id']}", {"origins": "https://glow.example"}, ADMIN)
    status, _, _ = api.call("POST", "/v1/subscribe", {"app_key": other_app["app_key"], "subscription": push.new_browser("o1")},
                            headers={"Origin": "https://evil.example"})
    check(status == 403, "origin not on the allow-list is refused")
    status, _, headers = api.call("POST", "/v1/subscribe", {"app_key": other_app["app_key"],
                                                            "subscription": push.new_browser("o2")},
                                  headers={"Origin": "https://glow.example"})
    check(status == 200 and headers.get("Access-Control-Allow-Origin") == "https://glow.example",
          "allowed origin echoed in CORS")


def run_mcp_tests(api: Api, env: dict):
    print("MCP")
    mcp_env = dict(env, BEACON_URL=api.base, BEACON_ADMIN_TOKEN=ADMIN)
    process = subprocess.Popen([sys.executable, str(SERVER_DIR / "mcp_server.py")], env=mcp_env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def rpc(msg_id, method, params=None):
        message = {"jsonrpc": "2.0", "id": msg_id, "method": method}
        if params is not None:
            message["params"] = params
        process.stdin.write(json.dumps(message).encode() + b"\n")
        process.stdin.flush()
        return json.loads(process.stdout.readline())

    def tool(msg_id, name, arguments):
        result = rpc(msg_id, "tools/call", {"name": name, "arguments": arguments})["result"]
        return result, result["content"][0]["text"]

    try:
        init = rpc(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
        check(init["result"]["serverInfo"]["name"] == "beacon", "MCP initialize")
        names = {t["name"] for t in rpc(2, "tools/list")["result"]["tools"]}
        check({"list_apps", "send_notification", "app_stats", "create_app", "add_contact"} <= names, "MCP tools listed")
        _, text = tool(3, "list_apps", {})
        apps = json.loads(text)
        vitals = next(a for a in apps if a["name"] == "Vitals")
        check(vitals["subscribers"].get("webpush") == 2, "MCP list_apps shows subscriber counts")
        result, text = tool(4, "send_notification", {"app_id": vitals["id"], "title": "From an agent",
                                                     "target": {"user_ids": ["u1"]}})
        sent = json.loads(text)
        check(not result["isError"] and sent["status"] == "queued", "MCP send_notification queues a message")
        time.sleep(1.5)
        _, text = tool(5, "list_messages", {"app_id": vitals["id"], "limit": 1})
        check(json.loads(text)[0]["title"] == "From an agent", "MCP list_messages")
        result, text = tool(6, "send_notification", {"app_id": vitals["id"], "title": ""})
        check(result["isError"] and "title" in text, "MCP surfaces validation errors")
        _, text = tool(7, "integration_snippet", {"app_id": vitals["id"]})
        check(vitals["app_key"] in text and "importScripts" in text, "MCP integration_snippet")
        result, text = tool(8, "add_contact", {"app_id": vitals["id"], "channel": "ntfy",
                                               "address": "http://127.0.0.1:9/mcp-topic", "tags": ["mcp"]})
        check(not result["isError"] and json.loads(text)["channel"] == "ntfy", "MCP add_contact (ntfy)")
        result, text = tool(9, "add_contact", {"app_id": vitals["id"], "channel": "ntfy",
                                               "address": "https://evil.example/x"})
        check(result["isError"] and "not allowed" in text, "MCP add_contact rejects foreign hosts")
    finally:
        process.stdin.close()
        process.terminate()
        process.wait(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
