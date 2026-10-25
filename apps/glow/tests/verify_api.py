"""End-to-end test for the optional subscription server (apps/glow/server/app.py).

Runs it against a mock OpenAI-compatible provider and signed Stripe webhooks,
using a temp database and free ports. Stdlib only.
Run from the repo root:  python apps/glow/tests/verify_api.py
"""
import hashlib
import hmac
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent / "server"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


MOCK_PORT = free_port()
APP_PORT = free_port()
WEBHOOK_SECRET = "whsec_test_secret"


class MockProvider(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):
        pass

    def do_GET(self):
        body = json.dumps({"data": [
            {"id": "test/free-model:free", "name": "Free Model", "pricing": {"prompt": "0", "completion": "0"}},
            {"id": "test/pro-model", "name": "Pro Model", "pricing": {"prompt": "0.000003", "completion": "0.000015"}},
            {"id": "test/huge-model", "name": "Huge Model", "pricing": {"prompt": "0.00002", "completion": "0.0001"}},
        ]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert request["messages"][-1]["role"] == "user"
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        events = [
            {"choices": [{"delta": {"reasoning": "pondering"}}]},
            {"choices": [{"delta": {"content": "Hello"}}]},
            {"choices": [{"delta": {"content": " world"}}]},
            {"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 2, "cost": 0.01}},
        ]
        for event in events:
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


class Client:
    def __init__(self):
        self.cookie = ""

    def request(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("localhost", APP_PORT, timeout=20)
        all_headers = dict(headers or {})
        if self.cookie:
            all_headers["Cookie"] = self.cookie
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            all_headers.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=data, headers=all_headers)
        response = conn.getresponse()
        payload = response.read().decode()
        set_cookie = response.getheader("Set-Cookie")
        if set_cookie:
            self.cookie = set_cookie.split(";")[0]
        conn.close()
        return response.status, payload, response


def stripe_header(payload):
    timestamp = int(time.time())
    signature = hmac.new(WEBHOOK_SECRET.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={signature}"


passed = 0


def check(name, condition, detail=""):
    global passed
    if not condition:
        print(f"FAIL  {name}  {detail}")
        raise SystemExit(1)
    passed += 1
    print(f"ok    {name}")


def main():
    mock = ThreadingHTTPServer(("127.0.0.1", MOCK_PORT), MockProvider)
    threading.Thread(target=mock.serve_forever, daemon=True).start()

    data_dir = tempfile.mkdtemp()
    env = dict(
        os.environ,
        PORT=str(APP_PORT),
        DATA_DIR=data_dir,
        LLM_BASE_URL=f"http://127.0.0.1:{MOCK_PORT}",
        OPENROUTER_API_KEY="test",
        FREE_DAILY_MESSAGES="2",
        PRO_MONTHLY_BUDGET_USD="0.015",
        STRIPE_WEBHOOK_SECRET=WEBHOOK_SECRET,
        STRIPE_SECRET_KEY="sk_test_fake",
        STRIPE_PRICE_ID="price_fake",
    )
    app = subprocess.Popen([sys.executable, str(APP_DIR / "app.py")], env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                http.client.HTTPConnection("localhost", APP_PORT, timeout=1).request("GET", "/healthz")
                break
            except OSError:
                time.sleep(0.1)
        run_tests()
    except BaseException:
        app.terminate()
        print("\n--- server output ---")
        print(app.stdout.read().decode(errors="replace")[-4000:])
        raise
    finally:
        app.terminate()
        mock.shutdown()
    print(f"\nAll {passed} checks passed.")


def run_tests():
    anon = Client()
    status, body, response = anon.request("GET", "/")
    check("landing page served", status == 200 and "Glow" in body)
    check("security headers", "frame-ancestors 'none'" in response.getheader("Content-Security-Policy", ""))
    status, body, _ = anon.request("GET", "/api/me")
    check("anonymous /api/me", status == 200 and json.loads(body)["user"] is None)
    status, _, _ = anon.request("GET", "/api/models")
    check("models require login", status == 401)
    status, _, _ = anon.request("GET", "/../app.py")
    check("no path traversal", status == 404)

    alice = Client()
    status, body, _ = alice.request("POST", "/api/signup", {"email": "bad", "password": "longpassword"})
    check("signup rejects bad email", status == 400)
    status, body, _ = alice.request("POST", "/api/signup", {"email": "alice@example.com", "password": "short"})
    check("signup rejects short password", status == 400)
    status, body, _ = alice.request("POST", "/api/signup", {"email": "Alice@Example.com", "password": "correct horse"})
    check("signup ok + session cookie", status == 200 and alice.cookie.startswith("sid="))
    status, body, _ = Client().request("POST", "/api/signup", {"email": "alice@example.com", "password": "another pw"})
    check("duplicate email rejected", status == 400)

    status, body, _ = alice.request("GET", "/api/me")
    me = json.loads(body)
    check("new user is on free plan", me["user"]["plan"] == "free" and me["billingEnabled"])

    status, body, _ = alice.request("GET", "/api/models")
    models = {m["id"]: m for m in json.loads(body)["models"]}
    check("free model unlocked", models["test/free-model:free"]["locked"] is False)
    check("pro model locked for free user", models["test/pro-model"]["locked"] is True)
    check("over-priced model hidden", "test/huge-model" not in models)

    chat = {"model": "test/pro-model", "messages": [{"role": "user", "content": "hi"}]}
    status, body, _ = alice.request("POST", "/api/chat", chat)
    check("free user blocked from pro model (402)", status == 402 and json.loads(body)["upgrade"])

    chat["model"] = "test/free-model:free"
    status, body, response = alice.request("POST", "/api/chat", chat)
    check("free chat streams (chunked)", status == 200 and response.getheader("Transfer-Encoding") == "chunked")
    check("reasoning + content in stream", body.startswith("<think>pondering</think>") and body.endswith("Hello world"), body)
    status, body, _ = alice.request("POST", "/api/chat", chat)
    check("second free message ok", status == 200)
    status, body, _ = alice.request("POST", "/api/chat", chat)
    check("daily free limit enforced (429)", status == 429 and json.loads(body)["upgrade"])

    status, _, _ = alice.request("POST", "/api/chat", chat, headers={"Origin": "https://evil.example"})
    check("cross-origin POST blocked", status == 403)
    status, _, _ = alice.request("POST", "/api/chat", raw=b"{}", headers={"Content-Type": "text/plain"})
    check("non-JSON POST blocked", status == 403)

    conversation = {"type": "chat", "title": "Test", "messages": [{"role": "user", "content": "hi"}]}
    status, _, _ = alice.request("PUT", "/api/conversations/abc123", conversation)
    check("save conversation", status == 200)
    status, body, _ = alice.request("GET", "/api/conversations")
    saved = json.loads(body)["conversations"]
    check("list conversations", len(saved) == 1 and saved[0]["id"] == "abc123")
    status, _, _ = alice.request("PUT", "/api/conversations/bad..id", conversation)
    check("invalid conversation id rejected", status == 404)

    bob = Client()
    bob.request("POST", "/api/signup", {"email": "bob@example.com", "password": "bob password"})
    status, body, _ = bob.request("GET", "/api/conversations")
    check("users can't see each other's chats", json.loads(body)["conversations"] == [])
    bob.request("DELETE", "/api/conversations/abc123")
    status, body, _ = alice.request("GET", "/api/conversations")
    check("users can't delete each other's chats", len(json.loads(body)["conversations"]) == 1)

    alice.request("DELETE", "/api/conversations/abc123")
    status, body, _ = alice.request("GET", "/api/conversations")
    check("delete conversation", json.loads(body)["conversations"] == [])

    alice.request("POST", "/api/logout", {})
    status, body, _ = alice.request("GET", "/api/me")
    check("logout ends session", json.loads(body)["user"] is None)
    status, _, _ = alice.request("POST", "/api/login", {"email": "alice@example.com", "password": "wrong password"})
    check("wrong password rejected", status == 401)
    status, _, _ = alice.request("POST", "/api/login", {"email": "alice@example.com", "password": "correct horse"})
    check("login ok", status == 200)

    # ---- Stripe webhooks
    event = json.dumps({"type": "checkout.session.completed", "data": {"object": {
        "mode": "subscription", "payment_status": "paid", "client_reference_id": "1",
        "customer": "cus_123", "subscription": "sub_123"}}}).encode()
    status, _, _ = anon.request("POST", "/api/stripe/webhook", raw=event,
                                headers={"Stripe-Signature": "t=1,v1=forged", "Content-Type": "application/json"})
    check("forged webhook rejected", status == 400)
    status, _, _ = anon.request("POST", "/api/stripe/webhook", raw=event,
                                headers={"Stripe-Signature": stripe_header(event), "Content-Type": "application/json"})
    check("signed webhook accepted", status == 200)
    status, body, _ = alice.request("GET", "/api/me")
    me = json.loads(body)
    check("user upgraded to pro", me["user"]["plan"] == "pro" and me["hasSubscription"])

    chat["model"] = "test/pro-model"
    status, body, _ = alice.request("POST", "/api/chat", chat)
    check("pro user can use pro model", status == 200 and body.endswith("Hello world"))
    status, body, _ = alice.request("GET", "/api/me")
    check("model cost recorded", abs(json.loads(body)["usage"]["monthCostUsd"] - 0.01) < 1e-9, body)
    alice.request("POST", "/api/chat", chat)
    status, body, _ = alice.request("POST", "/api/chat", chat)
    check("monthly pro budget enforced", status == 429, body)

    cancel = json.dumps({"type": "customer.subscription.deleted", "data": {"object": {
        "id": "sub_123", "customer": "cus_123", "status": "canceled"}}}).encode()
    anon.request("POST", "/api/stripe/webhook", raw=cancel,
                 headers={"Stripe-Signature": stripe_header(cancel), "Content-Type": "application/json"})
    status, body, _ = alice.request("GET", "/api/me")
    check("cancellation downgrades to free", json.loads(body)["user"]["plan"] == "free")


if __name__ == "__main__":
    main()
