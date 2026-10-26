#!/usr/bin/env python3
"""Sheetmint marketplace backend — Python standard library only.

Serves the static front-end from ../web and a JSON API backed by SQLite:
accounts (PBKDF2 passwords, HttpOnly session cookie), template drafts, listings,
purchases (test-mode checkout or the seller's own payment link), reviews from
buyers only, affiliate links with click + commission tracking, and a seller ledger.

Usage:
    python server.py                       # http://127.0.0.1:8792/
    python server.py --port 9000 --db /tmp/sheetmint.db --no-seed

Environment:
    SHEETMINT_DB            database path (default server/data/sheetmint.db)
    SHEETMINT_FEE_PCT       platform fee percent (default 10)
    SHEETMINT_SECURE_COOKIE set to 1 behind HTTPS
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

APP_NAME = "sheetmint"
APP_VERSION = "1.0.0"
BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent / "web"
SEED_FILE = WEB_DIR / "data" / "seed.json"
SESSION_COOKIE = "sm_session"
SESSION_DAYS = 30
MAX_BODY = 400_000
PBKDF2_ROUNDS = 200_000
CATEGORIES = {"Finance", "Business", "Productivity", "Lifestyle", "Health", "Education", "Creator", "Events", "Other"}
CURRENCIES = {"USD", "IDR", "EUR", "GBP", "SGD", "MYR", "JPY", "CNY"}
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[A-Za-z]{2,24}$")
CODE_RE = re.compile(r"^[A-Za-z0-9_-]{4,40}$")

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    is_system INTEGER NOT NULL DEFAULT 0,
    created REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    spec TEXT NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    template_id TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    tags TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    commission_pct INTEGER NOT NULL,
    payment_url TEXT NOT NULL DEFAULT '',
    spec TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live',
    created REAL NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    platform_fee_cents INTEGER NOT NULL,
    affiliate_code TEXT,
    affiliate_user_id INTEGER,
    commission_cents INTEGER NOT NULL DEFAULT 0,
    seller_net_cents INTEGER NOT NULL,
    created REAL NOT NULL,
    UNIQUE (listing_id, buyer_id)
);
CREATE TABLE IF NOT EXISTS affiliate_links (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    listing_id TEXT NOT NULL REFERENCES listings(id),
    clicks INTEGER NOT NULL DEFAULT 0,
    created REAL NOT NULL,
    UNIQUE (user_id, listing_id)
);
CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id TEXT NOT NULL REFERENCES listings(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    rating INTEGER NOT NULL,
    body TEXT NOT NULL,
    created REAL NOT NULL,
    UNIQUE (listing_id, user_id)
);
"""


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


# --------------------------------------------------------------------- storage
class Store:
    def __init__(self, path, fee_pct):
        self.path = str(path)
        self.fee_pct = fee_pct
        self.lock = threading.Lock()
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.executescript(SCHEMA)
        self.db.commit()

    def query(self, sql, params=()):
        with self.lock:
            return self.db.execute(sql, params).fetchall()

    def one(self, sql, params=()):
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def run(self, sql, params=()):
        with self.lock:
            cur = self.db.execute(sql, params)
            self.db.commit()
            return cur

    # ---- users & sessions
    @staticmethod
    def hash_password(password, salt):
        return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), PBKDF2_ROUNDS).hex()

    def create_user(self, email, name, password, is_system=False):
        salt = secrets.token_hex(16)
        pw_hash = self.hash_password(password, salt) if password else "!"
        try:
            cur = self.run(
                "INSERT INTO users (email, name, pw_hash, salt, is_system, created) VALUES (?, ?, ?, ?, ?, ?)",
                (email.lower(), name, pw_hash, salt, 1 if is_system else 0, time.time()),
            )
        except sqlite3.IntegrityError:
            raise ApiError(409, "An account with this email already exists")
        return self.one("SELECT * FROM users WHERE id = ?", (cur.lastrowid,))

    def verify_user(self, email, password):
        user = self.one("SELECT * FROM users WHERE email = ?", (email.lower(),))
        if not user or user["pw_hash"] == "!":
            # Equalise timing for unknown accounts.
            self.hash_password(password, "00" * 16)
            return None
        candidate = self.hash_password(password, user["salt"])
        return user if hmac.compare_digest(candidate, user["pw_hash"]) else None

    def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        self.run(
            "INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), user_id, time.time() + SESSION_DAYS * 86400),
        )
        return token

    def user_for_token(self, token):
        if not token:
            return None
        row = self.one(
            "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
            "WHERE sessions.token_hash = ? AND sessions.expires > ?",
            (hashlib.sha256(token.encode()).hexdigest(), time.time()),
        )
        return row

    def end_session(self, token):
        if token:
            self.run("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))

    # ---- seed
    def seed(self, seed_file):
        if self.one("SELECT 1 FROM listings LIMIT 1") or not Path(seed_file).exists():
            return 0
        data = json.loads(Path(seed_file).read_text(encoding="utf-8"))
        studio = self.one("SELECT * FROM users WHERE email = ?", ("studio@sheetmint.local",))
        if not studio:
            studio = self.create_user("studio@sheetmint.local", "Sheetmint Studio", None, is_system=True)
        count = 0
        for item in data.get("listings", []):
            now = time.time()
            self.run(
                "INSERT INTO listings (id, seller_id, template_id, title, description, category, tags, price_cents, "
                "currency, commission_pct, payment_url, spec, status, created, updated) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, '', ?, 'live', ?, ?)",
                (
                    item["id"], studio["id"], item["title"], item["description"], item["category"],
                    json.dumps(item.get("tags", [])), int(round(item["price"] * 100)), item["currency"],
                    int(item.get("commissionPct", 25)), json.dumps(item["spec"]), now - count, now - count,
                ),
            )
            count += 1
        return count


# --------------------------------------------------------------------- validation
def clean_text(value, max_len, field, required=True):
    text = str(value if value is not None else "").strip()
    if required and not text:
        raise ApiError(400, f"{field} is required")
    return text[:max_len]


def clean_spec(raw):
    if not isinstance(raw, dict):
        raise ApiError(400, "Template spec must be an object")
    sheet = raw.get("sheet")
    if not isinstance(sheet, dict) or not isinstance(sheet.get("columns"), list):
        raise ApiError(400, "Template spec needs sheet.columns")
    if not 1 <= len(sheet["columns"]) <= 30:
        raise ApiError(400, "Templates need 1–30 columns")
    if not isinstance(sheet.get("rows", []), list) or len(sheet.get("rows", [])) > 500:
        raise ApiError(400, "Templates can include up to 500 rows")
    for column in sheet["columns"]:
        if not isinstance(column, dict) or not str(column.get("name", "")).strip():
            raise ApiError(400, "Every column needs a name")
    encoded = json.dumps(raw)
    if len(encoded) > 250_000:
        raise ApiError(413, "Template is too large")
    return encoded


def money_to_cents(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        raise ApiError(400, "Price must be a number")
    if amount < 0 or amount > 100_000_000:
        raise ApiError(400, "Price is out of range")
    return int(round(amount * 100))


def listing_summary(row, store):
    stats = store.one(
        "SELECT COUNT(*) AS sales FROM purchases WHERE listing_id = ?", (row["id"],)
    )
    rating = store.one(
        "SELECT COUNT(*) AS n, AVG(rating) AS avg FROM reviews WHERE listing_id = ?", (row["id"],)
    )
    seller = store.one("SELECT name FROM users WHERE id = ?", (row["seller_id"],))
    spec = json.loads(row["spec"])
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "category": row["category"],
        "tags": json.loads(row["tags"]),
        "price": row["price_cents"] / 100,
        "currency": row["currency"],
        "commissionPct": row["commission_pct"],
        "paymentUrl": row["payment_url"],
        "status": row["status"],
        "sellerId": row["seller_id"],
        "sellerName": seller["name"] if seller else "Unknown",
        "sales": stats["sales"],
        "ratingCount": rating["n"],
        "rating": round(rating["avg"], 2) if rating["avg"] else None,
        "theme": spec.get("theme", "mint"),
        "columns": [c.get("name") for c in spec.get("sheet", {}).get("columns", [])][:8],
        "created": row["created"],
    }


# --------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "Sheetmint/" + APP_VERSION
    store: Store = None  # set in make_server
    login_attempts: dict = {}
    secure_cookie = False

    def log_message(self, fmt, *args):  # quiet
        return

    # ---- plumbing
    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise ApiError(415, "Send JSON (Content-Type: application/json)")
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "Request too large")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            raise ApiError(400, "Invalid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "JSON body must be an object")
        return data

    def cookie_token(self):
        cookie = self.headers.get("Cookie", "")
        for part in cookie.split(";"):
            name, _, value = part.strip().partition("=")
            if name == SESSION_COOKIE:
                return value
        return None

    def current_user(self, required=True):
        user = self.store.user_for_token(self.cookie_token())
        if required and not user:
            raise ApiError(401, "Please log in")
        return user

    def session_cookie(self, token, max_age):
        parts = [f"{SESSION_COOKIE}={token}", "Path=/", "HttpOnly", "SameSite=Lax", f"Max-Age={max_age}"]
        if self.secure_cookie:
            parts.append("Secure")
        return "; ".join(parts)

    # ---- routing
    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/"):
            if method != "GET":
                return self.send_json(405, {"error": "Method not allowed"})
            return self.serve_static(path)
        try:
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            parts = [p for p in path[len("/api/"):].split("/") if p]
            result = self.route(method, parts, query)
            if isinstance(result, tuple):
                status, payload, headers = result
                self.send_json(status, payload, headers)
            else:
                self.send_json(200, result)
        except ApiError as err:
            self.send_json(err.status, {"error": err.message})
        except Exception as err:  # noqa: BLE001
            self.send_json(500, {"error": "Server error: " + type(err).__name__})

    def route(self, method, parts, query):
        head = parts[0] if parts else ""
        if head == "health" and method == "GET":
            return {"ok": True, "app": APP_NAME, "version": APP_VERSION, "mode": "server", "platformFeePct": self.store.fee_pct}
        if head == "auth":
            return self.route_auth(method, parts[1:] if len(parts) > 1 else [])
        if head == "me" and method == "GET":
            user = self.current_user(required=False)
            return {"user": self.public_user(user) if user else None}
        if head == "templates":
            return self.route_templates(method, parts[1:])
        if head == "listings":
            return self.route_listings(method, parts[1:], query)
        if head == "library" and method == "GET":
            return self.library()
        if head == "affiliate":
            return self.route_affiliate(method, parts[1:])
        if head == "seller" and method == "GET":
            return self.seller_stats()
        raise ApiError(404, "Not found")

    @staticmethod
    def public_user(user):
        return {"id": user["id"], "email": user["email"], "name": user["name"]}

    # ---- auth
    def route_auth(self, method, parts):
        action = parts[0] if parts else ""
        if method != "POST":
            raise ApiError(405, "Method not allowed")
        if action == "register":
            data = self.read_json()
            email = clean_text(data.get("email"), 254, "Email").lower()
            name = clean_text(data.get("name"), 60, "Name")
            password = str(data.get("password") or "")
            if not EMAIL_RE.match(email):
                raise ApiError(400, "Enter a valid email")
            if len(password) < 8:
                raise ApiError(400, "Password must be at least 8 characters")
            user = self.store.create_user(email, name, password)
            token = self.store.new_session(user["id"])
            return 201, {"user": self.public_user(user)}, {"Set-Cookie": self.session_cookie(token, SESSION_DAYS * 86400)}
        if action == "login":
            data = self.read_json()
            ip = self.client_address[0]
            window = [t for t in self.login_attempts.get(ip, []) if t > time.time() - 60]
            if len(window) >= 8:
                raise ApiError(429, "Too many attempts — wait a minute")
            user = self.store.verify_user(str(data.get("email") or ""), str(data.get("password") or ""))
            if not user:
                window.append(time.time())
                self.login_attempts[ip] = window
                raise ApiError(401, "Wrong email or password")
            token = self.store.new_session(user["id"])
            return 200, {"user": self.public_user(user)}, {"Set-Cookie": self.session_cookie(token, SESSION_DAYS * 86400)}
        if action == "logout":
            self.store.end_session(self.cookie_token())
            return 200, {"ok": True}, {"Set-Cookie": self.session_cookie("", 0)}
        raise ApiError(404, "Not found")

    # ---- templates (drafts)
    def route_templates(self, method, parts):
        user = self.current_user()
        if method == "GET" and not parts:
            rows = self.store.query("SELECT * FROM templates WHERE owner_id = ? ORDER BY updated DESC", (user["id"],))
            return {"templates": [{"id": r["id"], "title": r["title"], "updated": r["updated"], "spec": json.loads(r["spec"])} for r in rows]}
        if method == "POST" and not parts:
            data = self.read_json()
            spec = clean_spec(data.get("spec"))
            title = clean_text(data.get("title") or json.loads(spec).get("title"), 70, "Title")
            template_id = str(data.get("id") or "")
            existing = self.store.one("SELECT * FROM templates WHERE id = ?", (template_id,)) if template_id else None
            if existing and existing["owner_id"] != user["id"]:
                raise ApiError(403, "Not your template")
            if not existing:
                template_id = "t_" + secrets.token_urlsafe(9)
                self.store.run(
                    "INSERT INTO templates (id, owner_id, title, spec, updated) VALUES (?, ?, ?, ?, ?)",
                    (template_id, user["id"], title, spec, time.time()),
                )
            else:
                self.store.run(
                    "UPDATE templates SET title = ?, spec = ?, updated = ? WHERE id = ?",
                    (title, spec, time.time(), template_id),
                )
            return {"template": {"id": template_id, "title": title, "spec": json.loads(spec)}}
        if method == "DELETE" and len(parts) == 1:
            row = self.store.one("SELECT * FROM templates WHERE id = ?", (parts[0],))
            if not row or row["owner_id"] != user["id"]:
                raise ApiError(404, "Template not found")
            self.store.run("DELETE FROM templates WHERE id = ?", (parts[0],))
            return {"ok": True}
        raise ApiError(404, "Not found")

    # ---- listings
    def route_listings(self, method, parts, query):
        if method == "GET" and not parts:
            return self.browse(query)
        if method == "POST" and not parts:
            return self.publish()
        if not parts:
            raise ApiError(404, "Not found")
        listing = self.store.one("SELECT * FROM listings WHERE id = ?", (parts[0],))
        if not listing:
            raise ApiError(404, "Listing not found")
        if method == "GET" and len(parts) == 1:
            return self.listing_detail(listing)
        if method == "POST" and len(parts) == 2 and parts[1] == "buy":
            return self.buy(listing)
        if method == "POST" and len(parts) == 2 and parts[1] == "reviews":
            return self.review(listing)
        if method == "POST" and len(parts) == 2 and parts[1] in ("unpublish", "republish"):
            user = self.current_user()
            if listing["seller_id"] != user["id"]:
                raise ApiError(403, "Not your listing")
            status = "hidden" if parts[1] == "unpublish" else "live"
            self.store.run("UPDATE listings SET status = ?, updated = ? WHERE id = ?", (status, time.time(), listing["id"]))
            return {"ok": True, "status": status}
        raise ApiError(404, "Not found")

    def browse(self, query):
        sql = "SELECT * FROM listings WHERE status = 'live'"
        params = []
        if query.get("category") and query["category"] in CATEGORIES:
            sql += " AND category = ?"
            params.append(query["category"])
        if query.get("q"):
            like = "%" + query["q"].strip().lower()[:60] + "%"
            sql += " AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?)"
            params += [like, like, like]
        if query.get("seller"):
            sql += " AND seller_id = ?"
            params.append(int(query["seller"]) if query["seller"].isdigit() else -1)
        if query.get("free") == "1":
            sql += " AND price_cents = 0"
        rows = self.store.query(sql, params)
        items = [listing_summary(r, self.store) for r in rows]
        sort = query.get("sort", "new")
        if sort == "popular":
            items.sort(key=lambda x: (-x["sales"], -x["created"]))
        elif sort == "price_asc":
            items.sort(key=lambda x: x["price"])
        elif sort == "price_desc":
            items.sort(key=lambda x: -x["price"])
        elif sort == "rating":
            items.sort(key=lambda x: (-(x["rating"] or 0), -x["ratingCount"]))
        else:
            items.sort(key=lambda x: -x["created"])
        return {"listings": items[:200]}

    def listing_detail(self, listing):
        user = self.current_user(required=False)
        if listing["status"] != "live" and (not user or user["id"] != listing["seller_id"]):
            raise ApiError(404, "Listing not found")
        summary = listing_summary(listing, self.store)
        owned = False
        if user:
            owned = bool(self.store.one("SELECT 1 FROM purchases WHERE listing_id = ? AND buyer_id = ?", (listing["id"], user["id"])))
        reviews = self.store.query(
            "SELECT reviews.rating, reviews.body, reviews.created, users.name FROM reviews JOIN users ON users.id = reviews.user_id "
            "WHERE listing_id = ? ORDER BY reviews.created DESC LIMIT 50",
            (listing["id"],),
        )
        summary["spec"] = json.loads(listing["spec"])
        summary["owned"] = owned
        summary["isSeller"] = bool(user and user["id"] == listing["seller_id"])
        summary["reviews"] = [{"rating": r["rating"], "body": r["body"], "name": r["name"], "created": r["created"]} for r in reviews]
        return {"listing": summary}

    def publish(self):
        user = self.current_user()
        data = self.read_json()
        spec = clean_spec(data.get("spec"))
        title = clean_text(data.get("title"), 70, "Title")
        description = clean_text(data.get("description"), 1200, "Description")
        category = data.get("category") if data.get("category") in CATEGORIES else "Other"
        currency = data.get("currency") if data.get("currency") in CURRENCIES else "USD"
        price_cents = money_to_cents(data.get("price", 0))
        try:
            commission = int(data.get("commissionPct", 20))
        except (TypeError, ValueError):
            raise ApiError(400, "Commission must be a whole number")
        if not 0 <= commission <= 50:
            raise ApiError(400, "Affiliate commission must be 0–50%")
        payment_url = str(data.get("paymentUrl") or "").strip()[:300]
        if payment_url and not payment_url.startswith("https://"):
            raise ApiError(400, "Payment link must start with https://")
        tags = [clean_text(t, 24, "Tag") for t in (data.get("tags") or []) if str(t).strip()][:8]
        listing_id = "l_" + secrets.token_urlsafe(9)
        now = time.time()
        self.store.run(
            "INSERT INTO listings (id, seller_id, template_id, title, description, category, tags, price_cents, currency, "
            "commission_pct, payment_url, spec, status, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)",
            (listing_id, user["id"], str(data.get("templateId") or "")[:40] or None, title, description, category,
             json.dumps(tags), price_cents, currency, commission, payment_url, spec, now, now),
        )
        row = self.store.one("SELECT * FROM listings WHERE id = ?", (listing_id,))
        return 201, {"listing": listing_summary(row, self.store)}, {}

    def buy(self, listing):
        user = self.current_user()
        if listing["status"] != "live":
            raise ApiError(404, "Listing not found")
        if listing["seller_id"] == user["id"]:
            raise ApiError(400, "You can’t buy your own template")
        existing = self.store.one("SELECT * FROM purchases WHERE listing_id = ? AND buyer_id = ?", (listing["id"], user["id"]))
        if existing:
            return {"purchase": dict(existing), "alreadyOwned": True}
        data = self.read_json()
        price = listing["price_cents"]
        fee = int(round(price * self.store.fee_pct / 100))
        code = str(data.get("ref") or "").strip()
        affiliate = None
        if code and CODE_RE.match(code):
            link = self.store.one("SELECT * FROM affiliate_links WHERE code = ? AND listing_id = ?", (code, listing["id"]))
            if link and link["user_id"] not in (user["id"], listing["seller_id"]):
                affiliate = link
        commission = int(round(price * listing["commission_pct"] / 100)) if affiliate and price > 0 else 0
        net = price - fee - commission
        self.store.run(
            "INSERT INTO purchases (listing_id, buyer_id, price_cents, currency, platform_fee_cents, affiliate_code, "
            "affiliate_user_id, commission_cents, seller_net_cents, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (listing["id"], user["id"], price, listing["currency"], fee, affiliate["code"] if affiliate else None,
             affiliate["user_id"] if affiliate else None, commission, net, time.time()),
        )
        purchase = self.store.one("SELECT * FROM purchases WHERE listing_id = ? AND buyer_id = ?", (listing["id"], user["id"]))
        return 201, {"purchase": dict(purchase), "alreadyOwned": False, "mode": "test"}, {}

    def review(self, listing):
        user = self.current_user()
        if not self.store.one("SELECT 1 FROM purchases WHERE listing_id = ? AND buyer_id = ?", (listing["id"], user["id"])):
            raise ApiError(403, "Only buyers can review")
        data = self.read_json()
        try:
            rating = int(data.get("rating"))
        except (TypeError, ValueError):
            raise ApiError(400, "Rating must be 1–5")
        if not 1 <= rating <= 5:
            raise ApiError(400, "Rating must be 1–5")
        body = clean_text(data.get("body"), 800, "Review", required=False)
        self.store.run(
            "INSERT INTO reviews (listing_id, user_id, rating, body, created) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(listing_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, created = excluded.created",
            (listing["id"], user["id"], rating, body, time.time()),
        )
        return {"ok": True}

    def library(self):
        user = self.current_user()
        rows = self.store.query(
            "SELECT purchases.*, listings.title, listings.spec, listings.seller_id FROM purchases JOIN listings ON listings.id = purchases.listing_id "
            "WHERE buyer_id = ? ORDER BY purchases.created DESC",
            (user["id"],),
        )
        return {"items": [{
            "listingId": r["listing_id"], "title": r["title"], "price": r["price_cents"] / 100, "currency": r["currency"],
            "purchased": r["created"], "spec": json.loads(r["spec"]),
        } for r in rows]}

    # ---- affiliate
    def route_affiliate(self, method, parts):
        if method == "POST" and parts == ["click"]:
            data = self.read_json()
            code = str(data.get("code") or "")
            if CODE_RE.match(code):
                self.store.run("UPDATE affiliate_links SET clicks = clicks + 1 WHERE code = ?", (code,))
            return {"ok": True}
        user = self.current_user()
        if method == "POST" and parts == ["links"]:
            data = self.read_json()
            listing = self.store.one("SELECT * FROM listings WHERE id = ? AND status = 'live'", (str(data.get("listingId") or ""),))
            if not listing:
                raise ApiError(404, "Listing not found")
            if listing["commission_pct"] <= 0:
                raise ApiError(400, "This seller doesn’t offer affiliate commission")
            existing = self.store.one("SELECT * FROM affiliate_links WHERE user_id = ? AND listing_id = ?", (user["id"], listing["id"]))
            if existing:
                return {"link": {"code": existing["code"], "listingId": listing["id"]}}
            base = re.sub(r"[^a-z0-9]", "", user["name"].lower())[:10] or "partner"
            code = f"{base}-{secrets.token_hex(3)}"
            self.store.run(
                "INSERT INTO affiliate_links (code, user_id, listing_id, clicks, created) VALUES (?, ?, ?, 0, ?)",
                (code, user["id"], listing["id"], time.time()),
            )
            return 201, {"link": {"code": code, "listingId": listing["id"]}}, {}
        if method == "GET" and not parts:
            rows = self.store.query(
                "SELECT affiliate_links.*, listings.title, listings.currency, listings.commission_pct, listings.price_cents FROM affiliate_links "
                "JOIN listings ON listings.id = affiliate_links.listing_id WHERE affiliate_links.user_id = ? ORDER BY affiliate_links.created DESC",
                (user["id"],),
            )
            links = []
            for r in rows:
                sales = self.store.one(
                    "SELECT COUNT(*) AS n, COALESCE(SUM(commission_cents), 0) AS earned FROM purchases WHERE affiliate_code = ?",
                    (r["code"],),
                )
                links.append({
                    "code": r["code"], "listingId": r["listing_id"], "title": r["title"], "clicks": r["clicks"],
                    "sales": sales["n"], "earnings": sales["earned"] / 100, "currency": r["currency"],
                    "commissionPct": r["commission_pct"], "price": r["price_cents"] / 100,
                })
            return {"links": links}
        raise ApiError(404, "Not found")

    # ---- seller
    def seller_stats(self):
        user = self.current_user()
        rows = self.store.query("SELECT * FROM listings WHERE seller_id = ? ORDER BY created DESC", (user["id"],))
        listings = []
        for r in rows:
            agg = self.store.one(
                "SELECT COUNT(*) AS n, COALESCE(SUM(price_cents),0) AS gross, COALESCE(SUM(platform_fee_cents),0) AS fees, "
                "COALESCE(SUM(commission_cents),0) AS commissions, COALESCE(SUM(seller_net_cents),0) AS net FROM purchases WHERE listing_id = ?",
                (r["id"],),
            )
            item = listing_summary(r, self.store)
            item.update({
                "gross": agg["gross"] / 100, "fees": agg["fees"] / 100,
                "commissions": agg["commissions"] / 100, "net": agg["net"] / 100,
            })
            listings.append(item)
        recent = self.store.query(
            "SELECT purchases.created, purchases.price_cents, purchases.currency, purchases.commission_cents, purchases.affiliate_code, "
            "listings.title FROM purchases JOIN listings ON listings.id = purchases.listing_id WHERE listings.seller_id = ? "
            "ORDER BY purchases.created DESC LIMIT 20",
            (user["id"],),
        )
        return {
            "platformFeePct": self.store.fee_pct,
            "listings": listings,
            "recent": [{
                "title": r["title"], "price": r["price_cents"] / 100, "currency": r["currency"], "created": r["created"],
                "viaAffiliate": bool(r["affiliate_code"]), "commission": r["commission_cents"] / 100,
            } for r in recent],
        }

    # ---- static
    def serve_static(self, path):
        rel = unquote(path).lstrip("/") or "index.html"
        if rel.endswith("/"):
            rel += "index.html"
        target = (WEB_DIR / rel).resolve()
        if WEB_DIR.resolve() not in target.parents and target != WEB_DIR.resolve():
            return self.send_json(404, {"error": "Not found"})
        if not target.is_file():
            return self.send_json(404, {"error": "Not found"})
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)


def make_server(host, port, db_path, fee_pct=10, seed=True):
    store = Store(db_path, fee_pct)
    if seed:
        store.seed(SEED_FILE)
    handler = type("SheetmintHandler", (Handler,), {
        "store": store,
        "login_attempts": {},
        "secure_cookie": os.environ.get("SHEETMINT_SECURE_COOKIE") == "1",
    })
    return ThreadingHTTPServer((host, port), handler), store


def main():
    parser = argparse.ArgumentParser(description="Sheetmint marketplace server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8792)
    parser.add_argument("--db", default=os.environ.get("SHEETMINT_DB") or str(BASE_DIR / "data" / "sheetmint.db"))
    parser.add_argument("--no-seed", action="store_true")
    args = parser.parse_args()
    fee = int(os.environ.get("SHEETMINT_FEE_PCT", "10"))
    httpd, _ = make_server(args.host, args.port, args.db, fee_pct=fee, seed=not args.no_seed)
    print(f"Sheetmint {APP_VERSION} on http://{args.host}:{args.port}/  (db: {args.db}, platform fee {fee}%)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
