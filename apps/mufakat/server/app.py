#!/usr/bin/env python3
"""Mufakat (hosted) - multi-user AI chat with Council mode, logins and Stripe subscriptions.

Standard library only. Configure with environment variables (see .env.example).
Run locally:  python3 app.py   ->  http://localhost:8000
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def env_float(name, default):
    return float(os.environ.get(name, default))


def env_int(name, default):
    return int(os.environ.get(name, default))


# ---------------------------------------------------------------- configuration
APP_NAME = os.environ.get("APP_NAME", "Mufakat")
PORT = env_int("PORT", 8000)
PUBLIC_URL = os.environ.get("PUBLIC_URL", f"http://localhost:{PORT}").rstrip("/")
DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent / "data"))
STATIC_DIR = Path(__file__).resolve().parent / "static"
COOKIE_SECURE = PUBLIC_URL.startswith("https://")

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
LLM_API_KEY = os.environ.get("OPENROUTER_API_KEY", os.environ.get("LLM_API_KEY", ""))

FREE_DAILY_MESSAGES = env_int("FREE_DAILY_MESSAGES", 30)
PRO_DAILY_MESSAGES = env_int("PRO_DAILY_MESSAGES", 500)          # abuse cap
PRO_MONTHLY_BUDGET_USD = env_float("PRO_MONTHLY_BUDGET_USD", 8.0)  # model spend per Pro user / month
PRO_MAX_OUTPUT_PRICE_PER_MTOK = env_float("PRO_MAX_OUTPUT_PRICE_PER_MTOK", 30.0)
PRO_PRICE_LABEL = os.environ.get("PRO_PRICE_LABEL", "$20 / month")
MESSAGES_PER_MINUTE = env_int("MESSAGES_PER_MINUTE", 20)
MAX_OUTPUT_TOKENS_FREE = env_int("MAX_OUTPUT_TOKENS_FREE", 2048)
MAX_OUTPUT_TOKENS_PRO = env_int("MAX_OUTPUT_TOKENS_PRO", 4096)
MAX_CONTEXT_CHARS = env_int("MAX_CONTEXT_CHARS", 48000)
MAX_BODY_BYTES = 1_000_000
ADMIN_EMAILS = {e.strip().lower() for e in os.environ.get("ADMIN_EMAILS", "").split(",") if e.strip()}

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_ID = os.environ.get("STRIPE_PRICE_ID", "")
BILLING_ENABLED = bool(STRIPE_SECRET_KEY and STRIPE_PRICE_ID)

SESSION_DAYS = 30
PBKDF2_ITERATIONS = 310_000
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
CONVERSATION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
SSL_CONTEXT = ssl.create_default_context()


# ---------------------------------------------------------------- database
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "mufakat.sqlite3"


class _Result:
    """Rows materialized while the lock is held, so no cursor outlives it."""

    def __init__(self, rows, lastrowid):
        self._rows = rows
        self.lastrowid = lastrowid

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def fetchall(self):
        return list(self._rows)


class _Database:
    """One shared connection in autocommit mode; every call is serialized.

    Per-thread connections left implicit write transactions open on newer
    Python versions ("database is locked"). Autocommit + a lock means each
    statement is committed immediately and never overlaps another.
    """

    def __init__(self, path):
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, timeout=10, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")

    def execute(self, sql, params=()):
        with self._lock:
            cursor = self._conn.execute(sql, params)
            return _Result(cursor.fetchall(), cursor.lastrowid)

    def executescript(self, script):
        with self._lock:
            self._conn.executescript(script)

    def commit(self):
        pass  # autocommit: every statement is already committed


_database = None
_database_lock = threading.Lock()


def db():
    global _database
    if _database is None:
        with _database_lock:
            if _database is None:
                _database = _Database(DB_PATH)
    return _database


def init_db():
    db().executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            subscription_status TEXT
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            day TEXT NOT NULL,
            messages INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, day)
        );
        CREATE TABLE IF NOT EXISTS conversations (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            id TEXT NOT NULL,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (user_id, id)
        );
        CREATE INDEX IF NOT EXISTS idx_users_customer ON users(stripe_customer_id);
    """)
    db().commit()


# ---------------------------------------------------------------- auth helpers
def hash_password(password, salt_hex=None):
    salt = bytes.fromhex(salt_hex) if salt_hex else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return digest.hex(), salt.hex()


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + SESSION_DAYS * 86400
    db().execute("INSERT INTO sessions VALUES (?, ?, ?)", (token_hash(token), user_id, expires))
    db().execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
    db().commit()
    return token


def session_cookie(token, max_age):
    cookie = f"sid={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
    return cookie + ("; Secure" if COOKIE_SECURE else "")


_login_attempts = {}
_login_lock = threading.Lock()


def login_allowed(key):
    """Max 10 failed attempts per 15 minutes per (ip, email)."""
    now = time.time()
    with _login_lock:
        attempts = [t for t in _login_attempts.get(key, []) if now - t < 900]
        _login_attempts[key] = attempts
        return len(attempts) < 10


def record_failed_login(key):
    with _login_lock:
        _login_attempts.setdefault(key, []).append(time.time())


_recent_messages = {}
_rate_lock = threading.Lock()


def per_minute_allowed(user_id):
    now = time.time()
    with _rate_lock:
        recent = [t for t in _recent_messages.get(user_id, []) if now - t < 60]
        allowed = len(recent) < MESSAGES_PER_MINUTE
        if allowed:
            recent.append(now)
        _recent_messages[user_id] = recent
        return allowed


# ---------------------------------------------------------------- plans & usage
def is_pro(user):
    if user["email"] in ADMIN_EMAILS:
        return True
    return user["subscription_status"] in ("active", "trialing")


def today():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def usage_summary(user):
    day = today()
    row = db().execute(
        "SELECT messages FROM usage WHERE user_id = ? AND day = ?", (user["id"], day)
    ).fetchone()
    month_cost = db().execute(
        "SELECT COALESCE(SUM(cost_usd), 0) FROM usage WHERE user_id = ? AND day LIKE ?",
        (user["id"], day[:7] + "%"),
    ).fetchone()[0]
    pro = is_pro(user)
    return {
        "todayMessages": row["messages"] if row else 0,
        "dailyLimit": PRO_DAILY_MESSAGES if pro else FREE_DAILY_MESSAGES,
        "monthCostUsd": round(month_cost, 4),
        "monthlyBudgetUsd": PRO_MONTHLY_BUDGET_USD if pro else 0,
    }


def record_usage(user_id, messages=0, cost=0.0):
    db().execute(
        """INSERT INTO usage (user_id, day, messages, cost_usd) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, day) DO UPDATE SET
             messages = messages + excluded.messages,
             cost_usd = cost_usd + excluded.cost_usd""",
        (user_id, today(), messages, cost),
    )
    db().commit()


# ---------------------------------------------------------------- model catalog
_catalog = {"models": [], "fetched": 0}
_catalog_lock = threading.Lock()


def llm_headers():
    headers = {"Content-Type": "application/json", "HTTP-Referer": PUBLIC_URL, "X-Title": APP_NAME}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"
    return headers


def model_catalog():
    """Fetch models from the provider (cached 1 h) and sort them into free / pro tiers."""
    with _catalog_lock:
        if _catalog["models"] and time.time() - _catalog["fetched"] < 3600:
            return _catalog["models"]
        try:
            request = urllib.request.Request(f"{LLM_BASE_URL}/models", headers=llm_headers())
            with urllib.request.urlopen(request, timeout=15, context=SSL_CONTEXT) as response:
                raw = json.load(response).get("data", [])
        except Exception as error:
            print("model catalog fetch failed:", error)
            return _catalog["models"]
        models = []
        for item in raw:
            pricing = item.get("pricing") or {}
            prompt_price = float(pricing.get("prompt") or 0)
            completion_price = float(pricing.get("completion") or 0)
            if prompt_price < 0 or completion_price < 0:
                continue  # dynamic-priced router entries
            free = item["id"].endswith(":free") or (prompt_price == 0 and completion_price == 0)
            if not free and completion_price * 1e6 > PRO_MAX_OUTPUT_PRICE_PER_MTOK:
                continue  # too expensive to offer inside a flat subscription
            models.append({
                "id": item["id"],
                "name": item.get("name") or item["id"],
                "tier": "free" if free else "pro",
                "promptPrice": prompt_price,
                "completionPrice": completion_price,
            })
        models.sort(key=lambda m: (m["tier"] != "free", m["name"].lower()))
        _catalog["models"] = models
        _catalog["fetched"] = time.time()
        return models


def find_model(model_id):
    return next((m for m in model_catalog() if m["id"] == model_id), None)


# ---------------------------------------------------------------- LLM streaming
def prepare_messages(system, messages):
    """Validate roles, merge consecutive roles, and trim old turns to bound cost."""
    cleaned = []
    for message in messages:
        role = message.get("role")
        content = message.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            continue
        if cleaned and cleaned[-1]["role"] == role:
            cleaned[-1]["content"] += "\n\n" + content
        else:
            cleaned.append({"role": role, "content": content})
    total = 0
    kept = []
    for message in reversed(cleaned):
        total += len(message["content"])
        if total > MAX_CONTEXT_CHARS and kept:
            break
        kept.append(message)
    kept.reverse()
    if kept and kept[0]["role"] != "user":
        kept.insert(0, {"role": "user", "content": "(continue)"})
    system = (system or "")[:4000]
    return ([{"role": "system", "content": system}] if system else []) + kept


def stream_completion(model, messages, max_tokens, usage_out):
    payload = {
        "model": model["id"],
        "messages": messages,
        "stream": True,
        "max_tokens": max_tokens,
        "usage": {"include": True},
        "stream_options": {"include_usage": True},
    }
    request = urllib.request.Request(
        f"{LLM_BASE_URL}/chat/completions",
        data=json.dumps(payload).encode(),
        headers=llm_headers(),
    )
    try:
        response = urllib.request.urlopen(request, timeout=600, context=SSL_CONTEXT)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:500]
        print("LLM error", error.code, detail)
        raise RuntimeError(f"The model provider returned an error ({error.code}). Try another model.")
    in_thinking = False
    with response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            event = json.loads(data)
            if event.get("error"):
                raise RuntimeError(str(event["error"].get("message", "Model error")))
            if event.get("usage"):
                usage_out.update(event["usage"])
            for choice in event.get("choices", []):
                delta = choice.get("delta") or {}
                reasoning = delta.get("reasoning") or delta.get("reasoning_content")
                if reasoning:
                    if not in_thinking:
                        in_thinking = True
                        yield "<think>"
                    yield reasoning
                if delta.get("content"):
                    if in_thinking:
                        in_thinking = False
                        yield "</think>\n\n"
                    yield delta["content"]
    if in_thinking:
        yield "</think>"


def compute_cost(model, usage):
    if usage.get("cost") is not None:
        return float(usage["cost"])
    return (usage.get("prompt_tokens", 0) * model["promptPrice"]
            + usage.get("completion_tokens", 0) * model["completionPrice"])


# ---------------------------------------------------------------- Stripe
def stripe_request(path, params):
    request = urllib.request.Request(
        f"https://api.stripe.com/v1/{path}",
        data=urllib.parse.urlencode(params).encode(),
        headers={"Authorization": f"Bearer {STRIPE_SECRET_KEY}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20, context=SSL_CONTEXT) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:500]
        print("Stripe error", error.code, detail)
        raise RuntimeError("Billing is temporarily unavailable.")


def verify_stripe_signature(payload, header, tolerance=300):
    try:
        parts = dict(item.split("=", 1) for item in header.split(","))
        timestamp = int(parts["t"])
        signatures = [v for k, v in (item.split("=", 1) for item in header.split(",")) if k == "v1"]
    except Exception:
        return False
    if abs(time.time() - timestamp) > tolerance:
        return False
    expected = hmac.new(
        STRIPE_WEBHOOK_SECRET.encode(),
        f"{timestamp}.".encode() + payload,
        hashlib.sha256,
    ).hexdigest()
    return any(hmac.compare_digest(expected, sig) for sig in signatures)


def handle_stripe_event(event):
    kind = event.get("type", "")
    obj = event.get("data", {}).get("object", {})
    if kind == "checkout.session.completed" and obj.get("mode") == "subscription":
        user_id = obj.get("client_reference_id")
        if user_id and obj.get("payment_status") in ("paid", "no_payment_required"):
            db().execute(
                """UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ?,
                   subscription_status = 'active' WHERE id = ?""",
                (obj.get("customer"), obj.get("subscription"), int(user_id)),
            )
    elif kind.startswith("customer.subscription."):
        status = "canceled" if kind.endswith(".deleted") else obj.get("status")
        db().execute(
            "UPDATE users SET subscription_status = ?, stripe_subscription_id = ? WHERE stripe_customer_id = ?",
            (status, obj.get("id"), obj.get("customer")),
        )
    db().commit()


# ---------------------------------------------------------------- HTTP handler
STATIC_ROUTES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
    "/terms": ("terms.html", "text/html; charset=utf-8"),
    "/privacy": ("privacy.html", "text/html; charset=utf-8"),
}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Mufakat"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} {fmt % args}")

    # ---- response helpers
    def send_headers(self, status, content_type, length=None, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)
        if COOKIE_SECURE:
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        if length is None:
            self.send_header("Transfer-Encoding", "chunked")
        else:
            self.send_header("Content-Length", str(length))
        self.end_headers()

    def send_json(self, payload, status=200, extra=None):
        body = json.dumps(payload).encode()
        self.send_headers(status, "application/json", len(body), extra)
        self.wfile.write(body)

    def error(self, status, message):
        self.send_json({"error": message}, status)

    def write_chunk(self, text):
        data = text.encode("utf-8")
        if data:
            self.wfile.write(f"{len(data):X}\r\n".encode() + data + b"\r\n")
            self.wfile.flush()

    def end_chunks(self):
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()

    # ---- request helpers
    def raw_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            raise ValueError("Request too large")
        return self.rfile.read(length)

    def json_body(self):
        try:
            return json.loads(self.raw_body() or b"{}")
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON")

    def same_origin(self):
        """CSRF guard: state-changing requests must be JSON and come from our own origin."""
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            return False
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host", "")
        return urllib.parse.urlparse(origin).netloc in (host, urllib.parse.urlparse(PUBLIC_URL).netloc)

    def current_user(self):
        cookie = self.headers.get("Cookie") or ""
        match = re.search(r"(?:^|;\s*)sid=([A-Za-z0-9_-]+)", cookie)
        if not match:
            return None
        return db().execute(
            """SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id
               WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
            (token_hash(match.group(1)), int(time.time())),
        ).fetchone()

    def client_ip(self):
        forwarded = self.headers.get("X-Forwarded-For")
        return forwarded.split(",")[0].strip() if forwarded else self.client_address[0]

    # ---- routing
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in STATIC_ROUTES:
            filename, content_type = STATIC_ROUTES[path]
            body = (STATIC_DIR / filename).read_bytes()
            self.send_headers(200, content_type, len(body), {"Cache-Control": "no-cache"})
            self.wfile.write(body)
            return
        if path == "/healthz":
            self.send_json({"ok": True})
            return
        if not path.startswith("/api/"):
            self.error(404, "Not found")
            return
        user = self.current_user()
        if path == "/api/me":
            if not user:
                self.send_json({"user": None, "appName": APP_NAME, "proPrice": PRO_PRICE_LABEL,
                                "freeDaily": FREE_DAILY_MESSAGES})
                return
            self.send_json({
                "appName": APP_NAME,
                "user": {"email": user["email"], "plan": "pro" if is_pro(user) else "free"},
                "usage": usage_summary(user),
                "billingEnabled": BILLING_ENABLED,
                "hasSubscription": bool(user["stripe_customer_id"]),
                "proPrice": PRO_PRICE_LABEL,
                "freeDaily": FREE_DAILY_MESSAGES,
            })
            return
        if not user:
            self.error(401, "Please log in.")
            return
        if path == "/api/models":
            pro = is_pro(user)
            models = [
                {"id": m["id"], "name": m["name"], "tier": m["tier"], "locked": m["tier"] == "pro" and not pro}
                for m in model_catalog()
            ]
            self.send_json({"models": models})
            return
        if path == "/api/conversations":
            rows = db().execute(
                "SELECT data FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 300",
                (user["id"],),
            ).fetchall()
            self.send_json({"conversations": [json.loads(r["data"]) for r in rows]})
            return
        self.error(404, "Not found")

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/stripe/webhook":
                self.stripe_webhook()
                return
            if not self.same_origin():
                self.error(403, "Bad origin")
                return
            if path == "/api/signup":
                self.signup()
            elif path == "/api/login":
                self.login()
            elif path == "/api/logout":
                self.logout()
            else:
                user = self.current_user()
                if not user:
                    self.error(401, "Please log in.")
                elif path == "/api/chat":
                    self.chat(user)
                elif path == "/api/billing/checkout":
                    self.checkout(user)
                elif path == "/api/billing/portal":
                    self.portal(user)
                else:
                    self.error(404, "Not found")
        except ValueError as error:
            self.error(400, str(error))
        except RuntimeError as error:
            self.error(502, str(error))

    def do_PUT(self):
        self.conversation_write("PUT")

    def do_DELETE(self):
        self.conversation_write("DELETE")

    # ---- auth endpoints
    def signup(self):
        body = self.json_body()
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))
        if not EMAIL_RE.match(email):
            raise ValueError("Please enter a valid email address.")
        if len(password) < 8 or len(password) > 200:
            raise ValueError("Password must be at least 8 characters.")
        if not login_allowed(("signup", self.client_ip())):
            self.error(429, "Too many attempts. Try again later.")
            return
        record_failed_login(("signup", self.client_ip()))  # counts signups per IP
        password_hash, salt = hash_password(password)
        try:
            cursor = db().execute(
                "INSERT INTO users (email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?)",
                (email, password_hash, salt, int(time.time())),
            )
            db().commit()
        except sqlite3.IntegrityError:
            raise ValueError("An account with this email already exists. Log in instead.")
        token = create_session(cursor.lastrowid)
        self.send_json({"ok": True}, extra={"Set-Cookie": session_cookie(token, SESSION_DAYS * 86400)})

    def login(self):
        body = self.json_body()
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))
        key = (self.client_ip(), email)
        if not login_allowed(key):
            self.error(429, "Too many attempts. Try again in 15 minutes.")
            return
        user = db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if user:
            candidate, _ = hash_password(password, user["password_salt"])
            ok = hmac.compare_digest(candidate, user["password_hash"])
        else:
            hash_password(password)  # equalize timing
            ok = False
        if not ok:
            record_failed_login(key)
            self.error(401, "Wrong email or password.")
            return
        token = create_session(user["id"])
        self.send_json({"ok": True}, extra={"Set-Cookie": session_cookie(token, SESSION_DAYS * 86400)})

    def logout(self):
        cookie = self.headers.get("Cookie") or ""
        match = re.search(r"(?:^|;\s*)sid=([A-Za-z0-9_-]+)", cookie)
        if match:
            db().execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(match.group(1)),))
            db().commit()
        self.send_json({"ok": True}, extra={"Set-Cookie": session_cookie("", 0)})

    # ---- chat
    def chat(self, user):
        body = self.json_body()
        model = find_model(str(body.get("model", "")))
        if not model:
            self.error(400, "Unknown model. Refresh the page.")
            return
        pro = is_pro(user)
        if model["tier"] == "pro" and not pro:
            self.send_json({"error": "This model is part of Pro.", "upgrade": True}, 402)
            return
        usage = usage_summary(user)
        if usage["todayMessages"] >= usage["dailyLimit"]:
            message = ("You've used today's free messages. Upgrade to Pro or come back tomorrow."
                       if not pro else "Daily safety limit reached. It resets at midnight UTC.")
            self.send_json({"error": message, "upgrade": not pro}, 429)
            return
        if pro and model["tier"] == "pro" and usage["monthCostUsd"] >= PRO_MONTHLY_BUDGET_USD:
            self.send_json({"error": "You've used this month's Pro allowance. Free models are still available."}, 429)
            return
        if not per_minute_allowed(user["id"]):
            self.send_json({"error": "Slow down a little and try again in a minute."}, 429)
            return

        messages = prepare_messages(body.get("system", ""), body.get("messages") or [])
        if not any(m["role"] == "user" for m in messages):
            raise ValueError("Empty message.")
        record_usage(user["id"], messages=1)  # counted up front so Stop can't dodge the limit

        self.send_headers(200, "text/plain; charset=utf-8", None, {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        usage_out = {}
        try:
            max_tokens = MAX_OUTPUT_TOKENS_PRO if pro else MAX_OUTPUT_TOKENS_FREE
            for text in stream_completion(model, messages, max_tokens, usage_out):
                self.write_chunk(text)
            self.end_chunks()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            try:
                self.write_chunk(f"\n\n[error] {error}")
                self.end_chunks()
            except Exception:
                pass
        finally:
            if usage_out and model["tier"] == "pro":
                record_usage(user["id"], cost=compute_cost(model, usage_out))

    # ---- conversations
    def conversation_write(self, method):
        path = urllib.parse.urlparse(self.path).path
        match = re.match(r"^/api/conversations/([^/]+)$", path)
        if not match or not CONVERSATION_ID_RE.match(match.group(1)):
            self.error(404, "Not found")
            return
        if method == "PUT" and not self.same_origin():
            self.error(403, "Bad origin")
            return
        user = self.current_user()
        if not user:
            self.error(401, "Please log in.")
            return
        conversation_id = match.group(1)
        if method == "DELETE":
            db().execute("DELETE FROM conversations WHERE user_id = ? AND id = ?", (user["id"], conversation_id))
        else:
            try:
                data = self.json_body()
            except ValueError as error:
                self.error(400, str(error))
                return
            data["id"] = conversation_id
            db().execute(
                """INSERT INTO conversations (user_id, id, data, updated_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(user_id, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at""",
                (user["id"], conversation_id, json.dumps(data), int(time.time())),
            )
        db().commit()
        self.send_json({"ok": True})

    # ---- billing
    def checkout(self, user):
        if not BILLING_ENABLED:
            self.error(503, "Billing is not configured yet.")
            return
        params = {
            "mode": "subscription",
            "line_items[0][price]": STRIPE_PRICE_ID,
            "line_items[0][quantity]": "1",
            "client_reference_id": str(user["id"]),
            "success_url": f"{PUBLIC_URL}/?upgraded=1",
            "cancel_url": f"{PUBLIC_URL}/",
            "allow_promotion_codes": "true",
        }
        if user["stripe_customer_id"]:
            params["customer"] = user["stripe_customer_id"]
        else:
            params["customer_email"] = user["email"]
        session = stripe_request("checkout/sessions", params)
        self.send_json({"url": session["url"]})

    def portal(self, user):
        if not (BILLING_ENABLED and user["stripe_customer_id"]):
            self.error(400, "No subscription found.")
            return
        session = stripe_request("billing_portal/sessions", {
            "customer": user["stripe_customer_id"],
            "return_url": f"{PUBLIC_URL}/",
        })
        self.send_json({"url": session["url"]})

    def stripe_webhook(self):
        payload = self.raw_body()
        if not STRIPE_WEBHOOK_SECRET or not verify_stripe_signature(payload, self.headers.get("Stripe-Signature", "")):
            self.error(400, "Bad signature")
            return
        handle_stripe_event(json.loads(payload))
        self.send_json({"received": True})


def main():
    init_db()
    if not LLM_API_KEY and "openrouter" in LLM_BASE_URL:
        print("WARNING: OPENROUTER_API_KEY is not set; model calls will fail.")
    if not BILLING_ENABLED:
        print("NOTE: Stripe not configured; the Upgrade button is hidden.")
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.daemon_threads = True
    print(f"{APP_NAME} running on {PUBLIC_URL} (port {PORT})")
    server.serve_forever()


if __name__ == "__main__":
    main()
