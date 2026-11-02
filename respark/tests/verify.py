"""
Respark - hermetic end-to-end verification.

Boots the server in a temp directory on a free port, runs the full happy path,
asserts each step, exits 0/1.

Usage:
    RESPARK_SECRET=test python tests/verify.py
"""

import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

TMP = tempfile.mkdtemp(prefix="respark-test-")
os.environ.setdefault("RESPARK_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("RESPARK_BASE_URL", "http://localhost")
os.environ.setdefault("RESPARK_ALLOW_SIGNUP", "1")
os.environ.setdefault("RESPARK_SMTP_HOST", "")

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER_DIR = os.path.normpath(os.path.join(HERE, "..", "server"))
sys.path.insert(0, SERVER_DIR)

import server  # noqa: E402


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = {}

    def request(self, method, path, body=None, expect_status=None):
        url = self.base + path
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if self.cookies:
            req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in self.cookies.items()))
        status = 0
        ctype = ""
        raw = b""
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                status = r.status
                ctype = r.headers.get("Content-Type", "")
                raw = r.read()
                for h in r.headers.get_all("Set-Cookie") or []:
                    kv = h.split(";")[0]
                    if "=" in kv:
                        k, v = kv.split("=", 1)
                        if v == "" or "Max-Age=0" in h:
                            self.cookies.pop(k, None)
                        else:
                            self.cookies[k] = v
        except urllib.error.HTTPError as e:
            status = e.code
            ctype = e.headers.get("Content-Type", "") if e.headers else ""
            raw = e.read()
        if ctype and not ctype.startswith("application/json") and not ctype.startswith("text/"):
            payload = raw
        else:
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                payload = raw.decode("utf-8", errors="replace")
        if expect_status is not None:
            assert status == expect_status, f"{method} {path} -> {status} (expected {expect_status}); body={payload[:200] if isinstance(payload, (bytes, str)) else payload}"
        return status, payload


def run():
    port = free_port()
    base = f"http://127.0.0.1:{port}"

    server.DB_PATH = os.path.join(TMP, "data.db")
    server.LOG_FILE = os.path.join(TMP, "outbox.log")
    server.APP_LOG = os.path.join(TMP, "app.log")
    server.WEB_DIR = os.path.join(TMP, "web")
    os.makedirs(server.WEB_DIR, exist_ok=True)

    real_web = os.path.join(os.path.dirname(HERE), "web")
    for fname in ("index.html", "app.html", "outreach.html", "style.css", "app.js"):
        src = os.path.join(real_web, fname)
        if os.path.exists(src):
            with open(src, "rb") as f:
                with open(os.path.join(server.WEB_DIR, fname), "wb") as g:
                    g.write(f.read())

    server.init_db()
    server.load_web()
    server.start_scheduler_once()

    httpd = server.ThreadedServer(("127.0.0.1", port), server.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    time.sleep(0.3)

    failures = []

    def check(label, cond, detail=""):
        if cond:
            print(f"  OK   {label}")
        else:
            print(f"  FAIL {label}  {detail}")
            failures.append(label)

    try:
        c = Client(base)

        s, body = c.request("GET", "/", expect_status=200)
        check("landing page serves", isinstance(body, str) and "Respark" in body)

        s, data = c.request("POST", "/api/auth/signup",
                             {"email": "alice@example.com", "password": "correcthorse",
                              "business_name": "Alice Plumbing", "industry": "plumber"},
                             expect_status=200)
        check("signup succeeds", data.get("ok"))
        check("session cookie set", "session" in c.cookies)

        s, data = c.request("GET", "/api/me", expect_status=200)
        check("/api/me returns user", data.get("email") == "alice@example.com")
        check("/api/me returns industry", data.get("industry") == "plumber")

        s, data = c.request("POST", "/api/campaigns",
                             {"name": "Test Reactivation", "industry": "plumber"},
                             expect_status=200)
        cid = data.get("id")
        check("campaign created", bool(cid))

        csv = "first_name,last_name,email,phone,last_service\nBob,Smith,bob@example.com,555-1,Leak fix\nCarol,Lee,carol@example.com,555-2,Drain clean\n"
        s, data = c.request("POST", f"/api/campaigns/{cid}/customers",
                             {"csv": csv}, expect_status=200)
        check("csv imported 2 rows", data.get("imported") == 2, str(data))

        s, data = c.request("POST", f"/api/campaigns/{cid}/generate", {}, expect_status=200)
        check("generated 10 messages (2 customers x 5)", data.get("generated") == 10, str(data))

        s, data = c.request("GET", f"/api/campaigns/{cid}", expect_status=200)
        msgs = data.get("messages", [])
        check("messages present", len(msgs) == 10)
        sample = msgs[0]
        check("personalization filled (no {{first_name}} left)",
              "{{first_name}}" not in (sample.get("body") or ""))
        check("bizname filled", "Alice Plumbing" in (sample.get("body") or ""))

        s, data = c.request("POST", f"/api/campaigns/{cid}/launch", {}, expect_status=200)
        check("launch succeeds", data.get("ok"))

        s, data = c.request("GET", f"/api/campaigns/{cid}", expect_status=200)
        check("campaign active after launch", data["campaign"]["status"] == "active")

        s, data = c.request("GET", f"/api/campaigns/{cid}/stats", expect_status=200)
        check("stats returns data", "stats" in data and data["stats"]["total"] == 10)

        msg_id = msgs[0]["id"]
        s, body = c.request("GET", f"/track/open/{msg_id}", expect_status=200)
        is_png = isinstance(body, bytes) and body.startswith(b"\x89PNG") or (
            isinstance(body, str) and body.startswith("\x89PNG")
        )
        check("tracking pixel returns PNG", is_png)

        s, data = c.request("GET", "/api/campaigns", expect_status=200)
        check("list campaigns returns 1", len(data.get("campaigns", [])) == 1)

        s, _ = c.request("POST", "/api/auth/logout", {}, expect_status=200)
        check("logout clears cookie", "session" not in c.cookies)

        s, data = c.request("GET", "/api/me")
        check("me after logout = 401", s == 401)

        c2 = Client(base)
        s, data = c2.request("GET", "/api/campaigns")
        check("list campaigns without auth = 401", s == 401)

        c.request("POST", "/api/auth/login",
                  {"email": "alice@example.com", "password": "correcthorse"},
                  expect_status=200)
        s, data = c.request("GET", f"/api/campaigns/{cid}", expect_status=200)
        with server._db_lock, server.db() as conn:
            row = conn.execute("SELECT unsubscribe_token FROM messages WHERE id=?",
                               (data["messages"][0]["id"],)).fetchone()
        token = row["unsubscribe_token"]
        s, body = c.request("GET", f"/u/{token}", expect_status=200)
        check("unsubscribe endpoint reachable", "unsubscribed" in (body if isinstance(body, str) else "").lower())

        c3 = Client(base)
        s, data = c3.request("POST", "/api/auth/signup",
                             {"email": "x@y.com", "password": "short"},
                             expect_status=400)
        check("short password rejected", "8 characters" in (data.get("error") or ""))

        s, data = c.request("GET", "/api/stripe/config", expect_status=200)
        check("stripe config reports unconfigured", data.get("configured") is False)

        s, data = c.request("POST", "/api/checkout", {"plan": "growth"})
        check("checkout blocked when Stripe not configured", s == 503)

        s, data = c.request("GET", "/api/billing/status", expect_status=200)
        check("billing status null when no sub", data.get("subscription") is None)

        s, data = c.request("POST", "/webhooks/stripe", {"type": "checkout.session.completed"})
        check("webhook rejects unsigned request", s == 400)

        import hashlib as _hl, hmac as _hm
        wh_secret = "test-webhook-secret"
        os.environ["RESPARK_STRIPE_WEBHOOK_SECRET"] = wh_secret
        server.STRIPE_WEBHOOK_SECRET = wh_secret
        s, me = c.request("GET", "/api/me", expect_status=200)
        real_user_id = me["id"]
        payload_obj = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "client_reference_id": real_user_id,
                "customer": "cus_test",
                "subscription": None,
                "amount_total": 49700,
            }},
        }
        body = json.dumps(payload_obj).encode("utf-8")
        ts = "1700000000"
        signed = f"{ts}.{body.decode('utf-8')}"
        sig = _hm.new(wh_secret.encode("utf-8"), signed.encode("utf-8"), _hl.sha256).hexdigest()
        req = urllib.request.Request(base + "/webhooks/stripe", data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Stripe-Signature", f"t={ts},v1={sig}")
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                webhook_status = r.status
                webhook_body = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            webhook_status = e.code
            webhook_body = {}
        check("webhook accepts valid signature", webhook_status == 200 and webhook_body.get("received") is True)
        s, data = c.request("GET", "/api/billing/status", expect_status=200)
        check("subscription created from webhook", (data.get("subscription") or {}).get("status") == "active")
        os.environ.pop("RESPARK_STRIPE_WEBHOOK_SECRET", None)
        server.STRIPE_WEBHOOK_SECRET = ""

        csv_out = ("business_name,contact_name,email,industry,city\n"
                   "Joe's Plumbing,Joe Smith,joe@joesplumbing.com,plumber,Austin\n"
                   "Bright Smile,Sarah Chen,sarah@brightsmile.com,dentist,Austin\n")
        s, data = c.request("POST", "/api/outreach/leads/import", {"csv": csv_out}, expect_status=200)
        check("outreach imported 2 leads", data.get("imported") == 2)
        check("outreach scheduled 6 emails (2 leads x 3 steps)", data.get("queued") == 6)

        s, data = c.request("GET", "/api/outreach/leads", expect_status=200)
        leads = data.get("leads") or []
        check("outreach list returns 2 leads", len(leads) == 2)
        check("lead status starts as 'new'", all(l["status"] == "new" for l in leads))

        s, data = c.request("GET", "/api/outreach/settings", expect_status=200)
        check("settings has operator_name", "operator_name" in data)
        s, _ = c.request("POST", "/api/outreach/settings",
                         {"operator_name": "Respark", "operator_email": "respark@local.test",
                          "daily_send_limit": 25, "followup_after_days": 3}, expect_status=200)
        s, data = c.request("GET", "/api/outreach/settings", expect_status=200)
        check("settings update persisted",
              data.get("daily_send_limit") == 25 and data.get("operator_name") == "Respark")

        s, data = c.request("GET", "/api/outreach/stats", expect_status=200)
        # The live scheduler may already have sent step 1 to a lead (one per tick), so count new + sent.
        by_status = data.get("by_status") or {}
        check("outreach stats has by_status", "by_status" in data
              and by_status.get("new", 0) + by_status.get("sent", 0) == 2)

        first_lead = leads[0]
        s, data = c.request("POST", f"/api/outreach/leads/{first_lead['id']}/send", {}, expect_status=200)
        check("outreach send now returns sent flag", "sent" in data)

        s, _ = c.request("POST", f"/api/outreach/leads/{first_lead['id']}/patch",
                         {"status": "interested"}, expect_status=200)
        s, data = c.request("GET", "/api/outreach/leads?status=interested", expect_status=200)
        check("lead marked interested", len(data.get("leads") or []) == 1)

        s, data = c.request("POST", f"/api/outreach/leads/{first_lead['id']}/close",
                            {"client_email": "joe@joesplumbing.com", "industry": "plumber"},
                            expect_status=200)
        check("close-won returned user_id", bool(data.get("user_id")))
        check("close-won returned campaign_id", bool(data.get("campaign_id")))
        check("close-won returned temp password", bool(data.get("client_password")))
        s, data = c.request("GET", "/api/outreach/leads?status=closed_won", expect_status=200)
        check("lead status updated to closed_won", len(data.get("leads") or []) == 1)
        with server._db_lock, server.db() as conn:
            row = conn.execute("SELECT id FROM users WHERE email=?", ("joe@joesplumbing.com",)).fetchone()
        check("client user account auto-created on close-won", row is not None)

        with server._db_lock, server.db() as conn:
            tok_row = conn.execute("SELECT tracking_token FROM outreach_emails LIMIT 1").fetchone()
        if tok_row:
            token = tok_row["tracking_token"]
            s, body = c.request("GET", f"/track/outreach/{token}", expect_status=200)
            check("outreach tracking pixel returns PNG",
                  isinstance(body, bytes) and body.startswith(b"\x89PNG"))
            s, body = c.request("GET", f"/u/outreach/{token}", expect_status=200)
            body_str = body if isinstance(body, str) else body.decode("utf-8", errors="replace")
            check("outreach unsubscribe reachable", "unsubscribed" in body_str.lower())

    finally:
        httpd.shutdown()
        httpd.server_close()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("All checks passed.")


if __name__ == "__main__":
    run()
