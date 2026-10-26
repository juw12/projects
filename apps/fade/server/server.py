#!/usr/bin/env python3
"""Fade backend: real multi-user accounts, bookings, payments ledger, shorts and commissions.

Zero-dependency HTTP server (Python standard library + SQLite). It serves the
static Fade front-end from ../web and exposes a JSON API under /api. The
front-end detects the API automatically when it is served from this server, or
when opened with ?api=https://your-server.example.

Usage:
    python server.py                    # http://127.0.0.1:8790/
    python server.py --port 9000 --host 0.0.0.0
    FADE_DATA=/tmp/fade python server.py   # custom data directory (db + uploaded media)

What is real here:
  * accounts (PBKDF2 password hashing, bearer-token sessions)
  * conflict-safe bookings (one global write lock, server-side slot + overlap checks,
    timezone-aware "no past bookings")
  * pricing, deposits, points, refunds and tips computed on the server
  * shorts: video/image upload, HTTP Range streaming, likes/views/shares, trending
  * follows / followers, DMs and communities
  * creator commissions for featured / sponsored tags (approval, attribution,
    pending -> earned -> paid, self-referral blocked)

What is simulated: the card processor. Cards are stored as brand + last 4 only and
"charged" into a ledger. Plug a real processor (e.g. Stripe Connect) into
`charge()` / `refund()` for production.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None

APP_NAME = "fade"
APP_VERSION = "2.0.0"

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent / "web"
SEED_FILE = WEB_DIR / "data.js"

# ---------------------------------------------------------------------------
# Business rules: keep in sync with web/app.js (verified by tests/verify_api.py)
# ---------------------------------------------------------------------------
TIERS = {"standard": 3, "premium": 6, "luxe": 10}
PLANS = {
    "free": {"price": 0.0, "disc": 0, "mult": 1, "noFee": False, "name": "Free"},
    "club": {"price": 9.99, "disc": 5, "mult": 2, "noFee": True, "name": "Fade Club"},
    "pro": {"price": 24.99, "disc": 10, "mult": 3, "noFee": True, "name": "Fade Club Pro"},
}
BOOKING_FEE = 0.99
DEPOSIT_PCT = 0.2
POINT_VALUE = 0.01
FULL_PAY_BONUS = 50
REVIEW_BONUS = 50
DELIVERY_FEE = 3.0
CANCEL_FREE_HOURS = 24
MAX_TIP = 500.0
BOOKING_WINDOW_DAYS = 30
COMMISSION_RATES = {"featured": 0.05, "sponsored": 0.10}
MIN_WITHDRAW = 1.0
MAX_UPLOAD_BYTES = 60 * 1024 * 1024
MAX_POSTER_CHARS = 300_000
UPLOAD_TYPES = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
SHORT_CATEGORIES = ["Cut reveal", "Before / after", "Tutorial", "Shop tour", "Products", "Behind the chair"]
FIXED_OFFSETS = {
    "Asia/Jakarta": 7,
    "Asia/Tokyo": 9,
    "Africa/Lagos": 1,
    "Europe/London": 0,
    "America/New_York": -5,
}
DEMO_REPLIES = [
    "Yo! Got you 🙌",
    "Send me a pic of what you want and I'll make it happen ✂️",
    "Check my schedule tab — I rotate shops, pick the one closest to you 📍",
    "Bet, see you then 🔥",
    "I can squeeze you in — grab the slot in the app so it's locked.",
]
CHALLENGES = {
    "c_month3": {"goal": 3, "pts": 300},
    "c_new": {"goal": 4, "pts": 250},
    "c_review": {"goal": 5, "pts": 200},
    "c_tip": {"goal": 3, "pts": 150},
    "c_shop": {"goal": 1, "pts": 100},
    "c_comm": {"goal": 4, "pts": 100},
    "c_ref": {"goal": 1, "pts": 500},
}
REDEEM = {
    "r5": {"cost": 500, "credit": 5.0, "title": "$5 cut credit"},
    "r12": {"cost": 1000, "credit": 12.0, "title": "$12 cut credit"},
    "rprio": {"cost": 800, "credit": 0.0, "title": "Priority slot pass"},
    "rdurag": {"cost": 2500, "credit": 0.0, "title": "Limited Fade durag"},
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# ---------------------------------------------------------------------------
# Small helpers (numeric behaviour matches JavaScript)
# ---------------------------------------------------------------------------
def round2(value: float) -> float:
    """Math.round(n * 100) / 100 exactly as JavaScript does it."""
    return math.floor(value * 100 + 0.5) / 100


def js_num(value: float) -> str:
    """Format a number the way JavaScript template strings do (10 -> '10', 10.5 -> '10.5')."""
    if float(value).is_integer():
        return str(int(value))
    return repr(float(value))


def fnv_hash(text: str) -> int:
    """FNV-1a 32-bit, identical to hash() in web/app.js."""
    h = 2166136261
    data = text.encode("utf-16-le")
    for index in range(0, len(data), 2):
        unit = data[index] | (data[index + 1] << 8)
        h = ((h ^ unit) * 16777619) & 0xFFFFFFFF
    return h


def now_ts() -> float:
    return time.time()


def new_id(prefix: str) -> str:
    return prefix + secrets.token_hex(5)


def parse_key(key: str) -> datetime:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", key or ""):
        raise ApiError(400, "date must be YYYY-MM-DD")
    return datetime.strptime(key, "%Y-%m-%d")


def dow_js(key: str) -> int:
    """JavaScript getDay(): Sunday = 0."""
    return (parse_key(key).weekday() + 1) % 7


def tz_for(place: dict):
    name = place.get("tz") or "Asia/Jakarta"
    if ZoneInfo is not None:
        try:
            return ZoneInfo(name)
        except Exception:  # tz database missing
            pass
    return timezone(timedelta(hours=FIXED_OFFSETS.get(name, 0)))


def place_now(place: dict):
    local = datetime.now(tz_for(place))
    return local.strftime("%Y-%m-%d"), local.hour + local.minute / 60


def booking_start_utc(booking: dict, place: dict) -> datetime:
    day = parse_key(booking["date"])
    minutes = round(booking["time"] * 60)
    local = datetime(day.year, day.month, day.day, tzinfo=tz_for(place)) + timedelta(minutes=minutes)
    return local.astimezone(timezone.utc)


def overlaps(a_start: float, a_mins: float, b_start: float, b_mins: float) -> bool:
    return a_start < b_start + b_mins / 60 and b_start < a_start + a_mins / 60


def quote(price, place, plan_id, pay_mode, use_points, points):
    plan = PLANS.get(plan_id, PLANS["free"])
    discount = round2(price * plan["disc"] / 100)
    service = round2(price - discount)
    facility = round2(service * place["fee"] / 100)
    booking_fee = 0 if plan["noFee"] else BOOKING_FEE
    gross = round2(service + facility + booking_fee)
    deposit = round2(booking_fee + facility + service * DEPOSIT_PCT)
    pay_now_base = gross if pay_mode == "full" else deposit
    points_used = min(points, math.floor(pay_now_base / POINT_VALUE)) if use_points else 0
    points_value = round2(points_used * POINT_VALUE)
    total = round2(gross - points_value)
    due_now = round2(pay_now_base - points_value)
    return {
        "price": price, "discount": discount, "service": service, "facility": facility,
        "facilityPct": place["fee"], "bookingFee": booking_fee, "gross": gross, "deposit": deposit,
        "pointsUsed": points_used, "pointsValue": points_value, "total": total, "dueNow": due_now,
        "payLater": round2(total - due_now), "payMode": pay_mode,
        "toBarber": service, "toPlace": facility, "toPlatform": booking_fee,
    }


def points_earned(amount, plan_id, full_pay):
    return math.floor(amount * 10 * PLANS.get(plan_id, PLANS["free"])["mult"]) + (FULL_PAY_BONUS if full_pay else 0)


def hash_password(password: str, salt: bytes = None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return base64.b64encode(salt).decode(), base64.b64encode(digest).decode()


def check_password(password: str, salt_b64: str, digest_b64: str) -> bool:
    _, digest = hash_password(password, base64.b64decode(salt_b64))
    return hmac.compare_digest(digest, digest_b64)


def text_field(body, name, max_len=200, required=True, default=""):
    value = body.get(name, default)
    if value is None:
        value = default
    if not isinstance(value, str):
        raise ApiError(400, f"{name} must be text")
    value = value.strip()
    if required and not value:
        raise ApiError(400, f"{name} is required")
    if len(value) > max_len:
        raise ApiError(400, f"{name} is too long (max {max_len})")
    return value


def number_field(body, name, low, high, required=True, default=None):
    value = body.get(name, default)
    if value is None and not required:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(400, f"{name} must be a number")
    if not (low <= value <= high) or math.isnan(value):
        raise ApiError(400, f"{name} must be between {low} and {high}")
    return float(value)


# ---------------------------------------------------------------------------
# Storage: a small JSON document store on SQLite, guarded by one write lock.
# ---------------------------------------------------------------------------
class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.media_dir = data_dir / "media"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(data_dir / "fade.db"), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS docs (
                kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created REAL NOT NULL,
                PRIMARY KEY (kind, id));
            CREATE TABLE IF NOT EXISTS emails (email TEXT PRIMARY KEY, user_id TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created REAL NOT NULL);
            """
        )
        self.db.commit()
        self.cache = {}
        self._load_cache()
        if not self.cache.get("barber"):
            self.seed()

    def _load_cache(self):
        for kind, doc_id, data in self.db.execute("SELECT kind, id, data FROM docs"):
            self.cache.setdefault(kind, {})[doc_id] = json.loads(data)

    def get(self, kind, doc_id):
        return self.cache.get(kind, {}).get(doc_id)

    def all(self, kind):
        return list(self.cache.get(kind, {}).values())

    def put(self, kind, doc_id, doc):
        self.cache.setdefault(kind, {})[doc_id] = doc
        self.db.execute(
            "INSERT INTO docs(kind, id, data, created) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data",
            (kind, doc_id, json.dumps(doc), now_ts()),
        )

    def delete(self, kind, doc_id):
        self.cache.get(kind, {}).pop(doc_id, None)
        self.db.execute("DELETE FROM docs WHERE kind = ? AND id = ?", (kind, doc_id))

    def commit(self):
        self.db.commit()

    def seed(self):
        raw = SEED_FILE.read_text(encoding="utf-8")
        seed = json.loads(raw[raw.index("window.SEED = ") + len("window.SEED = "):].rstrip().rstrip(";"))
        now = now_ts()
        with self.lock:
            for place in seed["places"]:
                place["ownerId"] = None
                self.put("place", place["id"], place)
            for barber in seed["barbers"]:
                barber["ownerId"] = None
                self.put("barber", barber["id"], barber)
            for product in seed["products"]:
                self.put("product", product["id"], product)
            for creator in seed["creators"]:
                self.put("user", creator["id"], {**creator, "seed": True, "role": "customer"})
            for short in seed["shorts"]:
                doc = {key: value for key, value in short.items() if key != "agoHours"}
                doc["createdAt"] = now - short["agoHours"] * 3600
                doc["likedBy"] = []
                self.put("short", doc["id"], doc)
            for thread in seed["threads"]:
                if thread["type"] != "group":
                    continue
                doc = {key: value for key, value in thread.items() if key not in ("joined", "unread")}
                doc["messages"] = [
                    {"from": message["from"], "name": message["from"], "text": message["text"],
                     "t": (now - message["ago"] * 60) * 1000}
                    for message in thread["messages"]
                ]
                self.put("thread", doc["id"], doc)
            self.put("meta", "boosts", {"values": {}})
            self.put("meta", "info", {"seededAt": now, "version": APP_VERSION})
            self.commit()


# ---------------------------------------------------------------------------
# Domain service
# ---------------------------------------------------------------------------
class Fade:
    def __init__(self, store: Store):
        self.s = store
        self.auth_hits = {}

    # ----- lookups -----
    def barber(self, barber_id):
        barber = self.s.get("barber", barber_id)
        if not barber:
            raise ApiError(404, "barber not found")
        return barber

    def place(self, place_id):
        place = self.s.get("place", place_id)
        if not place:
            raise ApiError(404, "place not found")
        return place

    def boosts(self):
        return self.s.get("meta", "boosts")["values"]

    def add_boost(self, target_id, amount):
        doc = self.s.get("meta", "boosts")
        doc["values"][target_id] = doc["values"].get(target_id, 0) + amount
        self.s.put("meta", "boosts", doc)

    def user_by_token(self, token):
        if not token:
            return None
        row = self.s.db.execute("SELECT user_id FROM sessions WHERE token = ?", (token,)).fetchone()
        return self.s.get("user", row[0]) if row else None

    def save_user(self, user):
        self.s.put("user", user["id"], user)

    def txn(self, user, label, amount, method):
        doc = {
            "id": new_id("tx"), "userId": user["id"], "label": label, "amount": round2(amount),
            "method": method, "date": datetime.now(timezone.utc).isoformat(),
        }
        self.s.put("txn", doc["id"], doc)

    def method_label(self, user, method):
        if method == "wallet":
            return "Wallet"
        if method == "apple":
            return "Apple Pay"
        card = next((c for c in user.get("cards", []) if c["id"] == method), None)
        if not card:
            raise ApiError(400, "unknown payment method")
        return f"{card['brand']} •••• {card['last4']}"

    def charge(self, user, amount, method, label):
        """Charge the wallet or the (simulated) card processor. Returns the method label."""
        value = round2(amount)
        label_text = self.method_label(user, method)
        if value <= 0:
            return label_text
        if method == "wallet":
            if user["wallet"] + 1e-9 < value:
                raise ApiError(402, f"Wallet has ${user['wallet']:.2f} — top up or choose a card")
            user["wallet"] = round2(user["wallet"] - value)
        self.txn(user, label, -value, label_text)
        return label_text

    def refund(self, user, amount, method, label):
        value = round2(amount)
        if value <= 0:
            return
        if method == "wallet":
            user["wallet"] = round2(user["wallet"] + value)
        self.txn(user, label, value, "Wallet" if method == "wallet" else self.method_label_safe(user, method))

    def method_label_safe(self, user, method):
        try:
            return self.method_label(user, method)
        except ApiError:
            return "Original card"

    def add_points(self, user, amount):
        user["points"] = user.get("points", 0) + amount
        if amount > 0:
            user["lifetime"] = user.get("lifetime", 0) + amount

    # ----- auth -----
    def rate_limit(self, key):
        window = int(now_ts() // 60)
        hits = self.auth_hits.get((key, window), 0) + 1
        self.auth_hits[(key, window)] = hits
        if hits > 30:
            raise ApiError(429, "Too many attempts, wait a minute")

    def register(self, body, ip):
        self.rate_limit(ip)
        name = text_field(body, "name", 60)
        email = text_field(body, "email", 120).lower()
        password = body.get("password") or ""
        role = body.get("role") or "customer"
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ApiError(400, "Enter a valid email")
        if not isinstance(password, str) or len(password) < 8:
            raise ApiError(400, "Password must be at least 8 characters")
        if role not in ("customer", "barber", "owner"):
            raise ApiError(400, "role must be customer, barber or owner")
        with self.s.lock:
            if self.s.db.execute("SELECT 1 FROM emails WHERE email = ?", (email,)).fetchone():
                raise ApiError(409, "An account with this email already exists")
            user_id = new_id("u_")
            handle = re.sub(r"[^a-z0-9_.]", "", (body.get("handle") or name).lower().replace(" ", "."))[:24] or user_id
            taken = {u.get("handle") for u in self.s.all("user")}
            base_handle = handle
            counter = 1
            while handle in taken:
                counter += 1
                handle = f"{base_handle}{counter}"
            salt, digest = hash_password(password)
            user = {
                "id": user_id, "email": email, "name": name, "handle": handle, "role": role,
                "hue": fnv_hash(email) % 360, "salt": salt, "pw": digest, "wallet": 0.0, "points": 0,
                "lifetime": 0, "plan": "free", "method": "wallet", "cards": [], "following": [],
                "joined": ["g1", "g2"], "claimed": {}, "referrals": 0, "creatorPaid": 0.0,
                "bio": "", "followers": 0, "barberId": None, "placeId": None, "createdAt": now_ts(),
                "location": {"lat": -6.225, "lng": 106.809, "label": "Senopati, Jakarta"},
            }
            if role == "barber":
                user["barberId"] = self.create_barber(user, body.get("barber") or {})
            if role == "owner":
                user["placeId"] = self.create_place(user, body.get("place") or {})
            self.save_user(user)
            self.s.db.execute("INSERT INTO emails(email, user_id) VALUES (?, ?)", (email, user_id))
            token = self.new_session(user_id)
            self.s.commit()
            return {"token": token}

    def create_barber(self, user, info):
        price = number_field(info, "price", 1, 1000, required=False, default=15.0)
        city = text_field(info, "city", 40, required=False, default="Jakarta") or "Jakarta"
        place = next((p for p in self.s.all("place") if p["city"].lower() == city.lower()), self.place("p2"))
        tags = [t.strip()[:24] for t in str(info.get("tags") or "").split(",") if t.strip()][:6]
        barber_id = new_id("b_")
        hue = fnv_hash(barber_id) % 360
        barber = {
            "id": barber_id, "ownerId": user["id"], "name": user["name"], "handle": user["handle"],
            "title": " & ".join(tags[:2]) or "Barber", "city": place["city"], "hue": hue, "verified": False,
            "years": int(number_field(info, "years", 0, 80, required=False, default=0)), "followers": 0,
            "langs": ["EN"], "rating": 5.0, "reviews": 0,
            "bio": text_field(info, "bio", 400, required=False) or "New on Fade — book me!",
            "tags": tags or ["Haircut"],
            "schedule": [{"dow": 6, "placeId": place["id"], "from": 10, "to": 18}],
            "services": [{"id": "s1", "name": text_field(info, "service", 60, required=False) or "Signature Cut",
                          "mins": 45, "price": price}],
            "portfolio": [{"id": "f1", "title": "First cut on Fade", "style": "fade", "hue": hue, "likes": 0}],
            "stats": {period: {"cuts": 0, "tips": 0, "rating": 5, "reviews": 0} for period in ("week", "month", "all")},
        }
        self.s.put("barber", barber_id, barber)
        return barber_id

    def create_place(self, user, info):
        tier = info.get("tier") if info.get("tier") in TIERS else "standard"
        city = text_field(info, "city", 40, required=False, default="Jakarta") or "Jakarta"
        anchor = next((p for p in self.s.all("place") if p["city"].lower() == city.lower()), self.place("p1"))
        name = text_field(info, "name", 60, required=False) or f"{user['name']}'s Barbershop"
        place_id = new_id("p_")
        place = {
            "id": place_id, "ownerId": user["id"], "name": name, "short": name.split(" ")[0][:12],
            "area": text_field(info, "area", 40, required=False) or anchor["area"], "city": anchor["city"],
            "tz": anchor.get("tz", "Asia/Jakarta"), "lat": anchor["lat"] + 0.004, "lng": anchor["lng"] - 0.004,
            "tier": tier, "fee": TIERS[tier], "chairs": 4, "rent": 20, "kitFee": 3, "rating": 5.0, "reviews": 0,
            "hue": fnv_hash(place_id) % 360, "hours": "10:00–21:00", "amenities": ["New on Fade"], "followers": 0,
            "stats": {period: {"visits": 0, "rating": 5} for period in ("week", "month", "all")},
        }
        self.s.put("place", place_id, place)
        return place_id

    def new_session(self, user_id):
        token = secrets.token_urlsafe(32)
        self.s.db.execute("INSERT INTO sessions(token, user_id, created) VALUES (?, ?, ?)", (token, user_id, now_ts()))
        return token

    def login(self, body, ip):
        self.rate_limit(ip)
        email = text_field(body, "email", 120).lower()
        password = body.get("password") or ""
        row = self.s.db.execute("SELECT user_id FROM emails WHERE email = ?", (email,)).fetchone()
        user = self.s.get("user", row[0]) if row else None
        if not user or not check_password(str(password), user["salt"], user["pw"]):
            raise ApiError(401, "Wrong email or password")
        with self.s.lock:
            token = self.new_session(user["id"])
            self.s.commit()
        return {"token": token}

    def logout(self, token):
        with self.s.lock:
            self.s.db.execute("DELETE FROM sessions WHERE token = ?", (token,))
            self.s.commit()
        return {"ok": True}

    # ----- scheduling -----
    def shifts_on(self, barber, key):
        dow = dow_js(key)
        return sorted([s for s in barber["schedule"] if s["dow"] == dow], key=lambda s: s["from"])

    def slots(self, barber, key, mins, exclude_id=None):
        groups = []
        bookings = [b for b in self.s.all("booking")
                    if b["barberId"] == barber["id"] and b["date"] == key and b["status"] == "upcoming"
                    and b["id"] != exclude_id]
        for shift in self.shifts_on(barber, key):
            place = self.place(shift["placeId"])
            today_key, now_h = place_now(place)
            slots = []
            t = shift["from"]
            while t + mins / 60 <= shift["to"] + 1e-9:
                taken = fnv_hash(f"{barber['id']}|{key}|{js_num(t)}") % 100 < 34
                if any(overlaps(b["time"], b["mins"], t, mins) for b in bookings):
                    taken = True
                if key < today_key or (key == today_key and t <= now_h + 0.25):
                    taken = True
                slots.append({"t": t, "taken": taken})
                t += 0.5
            groups.append({"placeId": place["id"], "from": shift["from"], "to": shift["to"], "slots": slots})
        return groups

    def validate_slot(self, user, barber, service, key, t, place_id, exclude_id=None):
        groups = self.slots(barber, key, service["mins"], exclude_id)
        group = next((g for g in groups if g["placeId"] == place_id), None)
        if not group:
            raise ApiError(409, f"{barber['name']} is not working at that place on {key}")
        slot = next((s for s in group["slots"] if abs(s["t"] - t) < 1e-9), None)
        if not slot:
            raise ApiError(409, "That time is outside the barber's shift")
        if slot["taken"]:
            raise ApiError(409, "Sorry — that slot was just taken. Pick another time.")
        place = self.place(place_id)
        today_key, _ = place_now(place)
        last_key = (datetime.strptime(today_key, "%Y-%m-%d") + timedelta(days=BOOKING_WINDOW_DAYS)).strftime("%Y-%m-%d")
        if key > last_key:
            raise ApiError(400, f"Bookings open {BOOKING_WINDOW_DAYS} days ahead")
        for other in self.s.all("booking"):
            if (other["userId"] == user["id"] and other["status"] == "upcoming" and other["date"] == key
                    and other["id"] != exclude_id and overlaps(other["time"], other["mins"], t, service["mins"])):
                raise ApiError(409, "You already have a booking at that time")

    # ----- bookings -----
    def create_booking(self, user, body):
        barber = self.barber(text_field(body, "barberId", 40))
        service = next((s for s in barber["services"] if s["id"] == body.get("serviceId")), None)
        if not service:
            raise ApiError(400, "unknown service")
        if barber.get("ownerId") == user["id"]:
            raise ApiError(400, "You can't book yourself")
        key = text_field(body, "date", 10)
        parse_key(key)
        t = number_field(body, "time", 0, 24)
        place = self.place(text_field(body, "placeId", 40))
        pay_mode = "full" if body.get("payMode") == "full" else "deposit"
        method = text_field(body, "method", 40)
        with self.s.lock:
            user = self.s.get("user", user["id"])
            self.validate_slot(user, barber, service, key, t, place["id"])
            q = quote(service["price"], place, user["plan"], pay_mode, bool(body.get("usePoints")), user["points"])
            method_text = self.charge(user, q["dueNow"], method, f"Booking · {barber['name']}")
            user["points"] -= q["pointsUsed"]
            earned = points_earned(q["dueNow"], user["plan"], pay_mode == "full")
            self.add_points(user, earned)
            ref = body.get("refShortId") or None
            booking = {
                "id": new_id("bk"), "userId": user["id"], "customerName": user["name"], "barberId": barber["id"],
                "placeId": place["id"], "serviceId": service["id"], "serviceName": service["name"],
                "mins": service["mins"], "date": key, "time": t, "status": "upcoming", "quote": q,
                "paidNow": q["dueNow"], "payLater": q["payLater"], "method": method, "methodLabel": method_text,
                "rated": False, "tip": 0, "notes": text_field(body, "notes", 200, required=False),
                "style": text_field(body, "style", 20, required=False) or "fade", "refShortId": ref,
                "createdAt": now_ts(),
            }
            self.s.put("booking", booking["id"], booking)
            self.attribute_booking(user, booking)
            self.add_boost(barber["id"], 10)
            self.add_boost(place["id"], 5)
            self.save_user(user)
            self.s.commit()
            return {"booking": booking, "earned": earned}

    def owned_booking(self, user, booking_id, as_barber=False):
        booking = self.s.get("booking", booking_id)
        if not booking:
            raise ApiError(404, "booking not found")
        if as_barber:
            if booking["barberId"] != user.get("barberId"):
                raise ApiError(403, "Only the barber can do that")
        elif booking["userId"] != user["id"]:
            raise ApiError(403, "Not your booking")
        return booking

    def cancel_booking(self, user, booking_id):
        with self.s.lock:
            user = self.s.get("user", user["id"])
            booking = self.owned_booking(user, booking_id)
            if booking["status"] != "upcoming":
                raise ApiError(400, "Only upcoming bookings can be cancelled")
            place = self.place(booking["placeId"])
            hours_away = (booking_start_utc(booking, place) - datetime.now(timezone.utc)).total_seconds() / 3600
            free = hours_away >= CANCEL_FREE_HOURS or user["plan"] == "pro"
            booking["status"] = "cancelled"
            refunded = 0.0
            if free:
                refunded = booking["paidNow"]
                self.refund(user, refunded, booking["method"], f"Refund · {booking['serviceName']}")
            for commission in self.s.all("commission"):
                if commission["sourceId"] == booking["id"] and commission["status"] == "pending":
                    commission["status"] = "void"
                    self.s.put("commission", commission["id"], commission)
            self.s.put("booking", booking["id"], booking)
            self.save_user(user)
            self.s.commit()
            return {"refunded": refunded, "free": free}

    def reschedule_booking(self, user, booking_id, body):
        with self.s.lock:
            user = self.s.get("user", user["id"])
            booking = self.owned_booking(user, booking_id)
            if booking["status"] != "upcoming":
                raise ApiError(400, "Only upcoming bookings can be moved")
            barber = self.barber(booking["barberId"])
            service = next(s for s in barber["services"] if s["id"] == booking["serviceId"])
            key = text_field(body, "date", 10)
            t = number_field(body, "time", 0, 24)
            place_id = text_field(body, "placeId", 40)
            self.validate_slot(user, barber, service, key, t, place_id, exclude_id=booking["id"])
            booking.update({"date": key, "time": t, "placeId": place_id})
            self.s.put("booking", booking["id"], booking)
            self.s.commit()
            return {"booking": booking}

    def complete(self, booking, in_person_label="Paid at shop (in person)"):
        """Finish a booking: settle the in-person balance and release creator commission."""
        booking["status"] = "completed"
        customer = self.s.get("user", booking["userId"])
        if booking["payLater"] > 0 and customer:
            self.txn(customer, f"{in_person_label} · {booking['serviceName']}", -booking["payLater"], "In person")
            booking["paidNow"] = round2(booking["paidNow"] + booking["payLater"])
            booking["payLater"] = 0
        barber = self.s.get("barber", booking["barberId"])
        if barber:
            for period in ("week", "month", "all"):
                barber["stats"][period]["cuts"] += 1
            self.s.put("barber", barber["id"], barber)
        for commission in self.s.all("commission"):
            if commission["sourceId"] == booking["id"] and commission["status"] == "pending":
                commission["status"] = "earned"
                commission["earnedAt"] = now_ts()
                self.s.put("commission", commission["id"], commission)
        self.s.put("booking", booking["id"], booking)

    def barber_complete(self, user, booking_id):
        with self.s.lock:
            booking = self.owned_booking(user, booking_id, as_barber=True)
            if booking["status"] != "upcoming":
                raise ApiError(400, "Booking is not upcoming")
            self.complete(booking, "Paid at shop")
            self.s.commit()
            return {"booking": booking}

    def auto_complete(self):
        """Bookings whose end time has passed (in the place's timezone) complete automatically."""
        now = datetime.now(timezone.utc)
        changed = False
        with self.s.lock:
            for booking in self.s.all("booking"):
                if booking["status"] != "upcoming":
                    continue
                place = self.s.get("place", booking["placeId"])
                if not place:
                    continue
                end = booking_start_utc(booking, place) + timedelta(minutes=booking["mins"])
                if end < now:
                    self.complete(booking)
                    changed = True
            if changed:
                self.s.commit()

    def rate_booking(self, user, booking_id, body):
        r_barber = int(number_field(body, "rB", 1, 5))
        r_place = int(number_field(body, "rP", 1, 5))
        tip = round2(number_field(body, "tip", 0, MAX_TIP, required=False, default=0.0))
        review = text_field(body, "review", 500, required=False)
        with self.s.lock:
            user = self.s.get("user", user["id"])
            booking = self.owned_booking(user, booking_id)
            if booking["status"] != "completed":
                raise ApiError(400, "You can rate after the appointment")
            if booking["rated"]:
                raise ApiError(400, "Already rated")
            barber = self.barber(booking["barberId"])
            if tip > 0:
                self.charge(user, tip, body.get("method") or user["method"], f"Tip · {barber['name']}")
            booking.update({"rated": True, "rB": r_barber, "rP": r_place, "tip": tip, "review": review})
            earned = REVIEW_BONUS + math.floor(tip * 10)
            self.add_points(user, earned)
            self.add_boost(barber["id"], r_barber * 8 + round(tip * 3))
            self.add_boost(booking["placeId"], r_place * 8)
            for period in ("week", "month", "all"):
                stats = barber["stats"][period]
                stats["tips"] = round2(stats["tips"] + tip)
                stats["reviews"] += 1
            barber["reviews"] = barber.get("reviews", 0) + 1
            barber["rating"] = round2((barber["rating"] * (barber["reviews"] - 1) + r_barber) / barber["reviews"])
            self.s.put("barber", barber["id"], barber)
            self.s.put("booking", booking["id"], booking)
            self.save_user(user)
            self.s.commit()
            return {"earned": earned}

    # ----- wallet / plan / cards -----
    def topup(self, user, body):
        amount = round2(number_field(body, "amount", 1, 1000))
        with self.s.lock:
            user = self.s.get("user", user["id"])
            card_id = body.get("cardId")
            card = next((c for c in user["cards"] if c["id"] == card_id), None)
            if not card:
                raise ApiError(400, "Add a card first")
            user["wallet"] = round2(user["wallet"] + amount)
            self.txn(user, f"Top up from {card['brand']} •••• {card['last4']}", amount, f"{card['brand']} •••• {card['last4']}")
            self.save_user(user)
            self.s.commit()
            return {"wallet": user["wallet"]}

    def add_card(self, user, body):
        brand = body.get("brand")
        last4 = str(body.get("last4") or "")
        exp = str(body.get("exp") or "")
        if brand not in ("Visa", "Mastercard", "Amex", "Discover", "Card"):
            raise ApiError(400, "unknown card brand")
        if not re.fullmatch(r"\d{4}", last4) or not re.fullmatch(r"(0[1-9]|1[0-2])/\d{2}", exp):
            raise ApiError(400, "Send brand, last4 and exp (MM/YY) only — never the full card number")
        with self.s.lock:
            user = self.s.get("user", user["id"])
            card = {"id": new_id("c"), "brand": brand, "last4": last4, "exp": exp}
            user["cards"].append(card)
            if len(user["cards"]) == 1 and user["method"] == "wallet" and user["wallet"] <= 0:
                user["method"] = card["id"]
            self.save_user(user)
            self.s.commit()
            return {"card": card}

    def remove_card(self, user, card_id):
        with self.s.lock:
            user = self.s.get("user", user["id"])
            user["cards"] = [c for c in user["cards"] if c["id"] != card_id]
            if user["method"] == card_id:
                user["method"] = "wallet"
            self.save_user(user)
            self.s.commit()
            return {"ok": True}

    def set_method(self, user, body):
        method = body.get("method")
        with self.s.lock:
            user = self.s.get("user", user["id"])
            self.method_label(user, method)
            user["method"] = method
            self.save_user(user)
            self.s.commit()
            return {"ok": True}

    def set_plan(self, user, body):
        plan_id = body.get("plan")
        if plan_id not in PLANS:
            raise ApiError(400, "unknown plan")
        with self.s.lock:
            user = self.s.get("user", user["id"])
            plan = PLANS[plan_id]
            if plan["price"] > 0:
                method = user["cards"][0]["id"] if user["cards"] else "wallet"
                self.charge(user, plan["price"], method, f"{plan['name']} · monthly")
            user["plan"] = plan_id
            self.save_user(user)
            self.s.commit()
            return {"plan": plan_id}

    # ----- follows -----
    def follow(self, user, body):
        kind = body.get("type")
        target = text_field(body, "id", 40)
        if kind not in ("barber", "place", "user"):
            raise ApiError(400, "type must be barber, place or user")
        if not self.s.get(kind, target):
            raise ApiError(404, f"{kind} not found")
        if kind == "user" and target == user["id"]:
            raise ApiError(400, "You can't follow yourself")
        key = f"{kind}:{target}"
        with self.s.lock:
            user = self.s.get("user", user["id"])
            if key in user["following"]:
                user["following"].remove(key)
                following = False
            else:
                user["following"].append(key)
                following = True
            self.save_user(user)
            self.s.commit()
            return {"following": following}

    def follower_counts(self):
        counts = {}
        for other in self.s.all("user"):
            following = other.get("following", [])
            if not isinstance(following, list):
                continue
            for key in following:
                counts[key] = counts.get(key, 0) + 1
        return counts

    # ----- shorts -----
    def tag_owner(self, tag):
        doc = self.s.get(tag["type"], tag["id"])
        return doc.get("ownerId") if doc else None

    def upload_short(self, user, meta, content_type, data):
        if content_type not in UPLOAD_TYPES:
            raise ApiError(415, "Upload an MP4, WebM, MOV, JPG, PNG or WebP")
        if not data:
            raise ApiError(400, "empty upload")
        caption = text_field(meta, "caption", 300)
        category = meta.get("category")
        if category not in SHORT_CATEGORIES:
            raise ApiError(400, "Pick what the short is about (haircut-related categories only)")
        tags = []
        for raw in (meta.get("tags") or [])[:4]:
            if raw.get("type") not in ("barber", "place") or raw.get("kind") not in COMMISSION_RATES:
                raise ApiError(400, "invalid tag")
            if not self.s.get(raw["type"], raw.get("id")):
                raise ApiError(404, "tagged profile not found")
            if raw["kind"] == "sponsored" and not meta.get("sponsoredAgreement"):
                raise ApiError(400, "Sponsored tags need a confirmed paid partnership")
            owner = self.tag_owner(raw)
            status = "approved" if owner is None or owner == user["id"] else "pending"
            tags.append({"type": raw["type"], "id": raw["id"], "kind": raw["kind"], "status": status})
        poster = meta.get("poster") or None
        if poster and (not isinstance(poster, str) or not poster.startswith("data:image/")
                       or len(poster) > MAX_POSTER_CHARS):
            poster = None
        author_type, author_id = "user", user["id"]
        if meta.get("as") == "barber" and user.get("barberId"):
            author_type, author_id = "barber", user["barberId"]
        if meta.get("as") == "place" and user.get("placeId"):
            author_type, author_id = "place", user["placeId"]
        short_id = new_id("sh")
        file_name = short_id + UPLOAD_TYPES[content_type]
        (self.s.media_dir / file_name).write_bytes(data)
        short = {
            "id": short_id, "authorType": author_type, "authorId": author_id, "userId": user["id"],
            "caption": caption, "category": category, "tags": tags,
            "media": {"kind": "video" if content_type.startswith("video/") else "image",
                      "url": f"/media/{file_name}", "type": content_type, "poster": poster,
                      "duration": meta.get("duration")},
            "likes": 0, "views": 0, "shares": 0, "conversions": 0, "likedBy": [], "createdAt": now_ts(),
        }
        with self.s.lock:
            self.s.put("short", short_id, short)
            self.s.commit()
        return {"short": self.public_short(short, user)}

    def short_action(self, user, short_id, action):
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                raise ApiError(404, "short not found")
            if action == "like":
                if user["id"] in short["likedBy"]:
                    short["likedBy"].remove(user["id"])
                    short["likes"] -= 1
                else:
                    short["likedBy"].append(user["id"])
                    short["likes"] += 1
            elif action == "view":
                short["views"] += 1
            elif action == "share":
                short["shares"] += 1
            self.s.put("short", short_id, short)
            self.s.commit()
            return {"short": self.public_short(short, user)}

    def review_tag(self, user, short_id, index, body):
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short or not (0 <= index < len(short["tags"])):
                raise ApiError(404, "tag not found")
            tag = short["tags"][index]
            if self.tag_owner(tag) != user["id"]:
                raise ApiError(403, "Only the tagged barber or shop can approve")
            tag["status"] = "approved" if body.get("approve") else "declined"
            self.s.put("short", short_id, short)
            self.s.commit()
            return {"tag": tag}

    def delete_short(self, user, short_id):
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short or short.get("userId") != user["id"]:
                raise ApiError(403, "You can only delete your own shorts")
            url = short["media"].get("url", "")
            if url.startswith("/media/"):
                path = self.s.media_dir / Path(url).name
                if path.exists():
                    path.unlink()
            self.s.delete("short", short_id)
            self.s.commit()
            return {"ok": True}

    def public_short(self, short, user):
        doc = {key: value for key, value in short.items() if key != "likedBy"}
        doc["likedByMe"] = bool(user) and user["id"] in short.get("likedBy", [])
        return doc

    def find_tag(self, short, kind, target_id):
        return next((t for t in short.get("tags", [])
                     if t["type"] == kind and t["id"] == target_id and t["status"] == "approved"), None)

    def attribute_booking(self, booker, booking):
        """Create a pending creator commission when a booking came from a tagged short."""
        short = self.s.get("short", booking.get("refShortId") or "")
        if not short or short.get("authorType") != "user" or short.get("userId", short["authorId"]) == booker["id"]:
            return None
        tag = self.find_tag(short, "barber", booking["barberId"]) or self.find_tag(short, "place", booking["placeId"])
        if not tag:
            return None
        rate = COMMISSION_RATES[tag["kind"]]
        base = booking["quote"]["service"]
        commission = {
            "id": new_id("cm"), "creatorId": short.get("userId", short["authorId"]), "shortId": short["id"],
            "sourceType": "booking", "sourceId": booking["id"], "payerType": tag["type"], "payerId": tag["id"],
            "kind": tag["kind"], "rate": rate, "base": base, "amount": round2(base * rate), "status": "pending",
            "createdAt": now_ts(),
        }
        self.s.put("commission", commission["id"], commission)
        short["conversions"] = short.get("conversions", 0) + 1
        self.s.put("short", short["id"], short)
        return commission

    # ----- creator earnings -----
    def creator_summary(self, user):
        mine = [c for c in self.s.all("commission") if c["creatorId"] == user["id"]]
        return {
            "pending": round2(sum(c["amount"] for c in mine if c["status"] == "pending")),
            "available": round2(sum(c["amount"] for c in mine if c["status"] == "earned")),
            "paid": round2(sum(c["amount"] for c in mine if c["status"] == "paid")),
        }

    def withdraw(self, user):
        with self.s.lock:
            user = self.s.get("user", user["id"])
            mine = [c for c in self.s.all("commission") if c["creatorId"] == user["id"] and c["status"] == "earned"]
            amount = round2(sum(c["amount"] for c in mine))
            if amount < MIN_WITHDRAW:
                raise ApiError(400, f"You need at least ${MIN_WITHDRAW:.2f} earned to withdraw")
            for commission in mine:
                commission["status"] = "paid"
                self.s.put("commission", commission["id"], commission)
            user["wallet"] = round2(user["wallet"] + amount)
            self.txn(user, "Creator commission payout", amount, "Wallet")
            self.save_user(user)
            self.s.commit()
            return {"amount": amount}

    # ----- orders -----
    def create_order(self, user, body):
        items = body.get("items") or []
        if not items or len(items) > 30:
            raise ApiError(400, "Your bag is empty")
        delivery = "delivery" if body.get("delivery") == "delivery" else "pickup"
        with self.s.lock:
            user = self.s.get("user", user["id"])
            lines = []
            subtotal = 0.0
            for item in items:
                product = self.s.get("product", item.get("id"))
                qty = int(number_field(item, "qty", 1, 20))
                if not product:
                    raise ApiError(404, "product not found")
                lines.append((product, qty))
                subtotal += product["price"] * qty
            subtotal = round2(subtotal)
            member_disc = round2(subtotal * 0.05) if user["plan"] != "free" else 0
            total = round2(subtotal - member_disc + (DELIVERY_FEE if delivery == "delivery" else 0))
            self.charge(user, total, body.get("method") or user["method"], f"Shop order · {len(lines)} item{'s' if len(lines) > 1 else ''}")
            earned = points_earned(total, user["plan"], False)
            self.add_points(user, earned)
            order = {"id": new_id("o"), "userId": user["id"], "items": [{"id": p["id"], "qty": q} for p, q in lines],
                     "total": total, "delivery": delivery, "date": datetime.now(timezone.utc).isoformat(),
                     "refShortId": body.get("refShortId")}
            self.s.put("order", order["id"], order)
            short = self.s.get("short", body.get("refShortId") or "")
            for product, qty in lines:
                product["sold"] += qty
                self.s.put("product", product["id"], product)
                if short and short.get("authorType") == "user" and short.get("userId", short["authorId"]) != user["id"]:
                    tag = self.find_tag(short, product["sellerType"], product["sellerId"])
                    if tag:
                        base = round2(product["price"] * qty)
                        commission = {
                            "id": new_id("cm"), "creatorId": short.get("userId", short["authorId"]), "shortId": short["id"],
                            "sourceType": "order", "sourceId": order["id"], "payerType": tag["type"],
                            "payerId": tag["id"], "kind": tag["kind"], "rate": COMMISSION_RATES[tag["kind"]],
                            "base": base, "amount": round2(base * COMMISSION_RATES[tag["kind"]]),
                            "status": "earned", "createdAt": now_ts(),
                        }
                        self.s.put("commission", commission["id"], commission)
            self.save_user(user)
            self.s.commit()
            return {"order": order, "earned": earned}

    # ----- chat -----
    def visible_thread(self, user, thread):
        if thread["type"] == "group":
            return True
        return thread.get("userId") == user["id"] or (user.get("barberId") and thread.get("barberId") == user["barberId"])

    def open_dm(self, user, body):
        barber = self.barber(text_field(body, "barberId", 40))
        thread_id = f"dm_{user['id']}_{barber['id']}"
        with self.s.lock:
            if not self.s.get("thread", thread_id):
                self.s.put("thread", thread_id, {
                    "id": thread_id, "type": "dm", "userId": user["id"], "customerName": user["name"],
                    "customerHue": user["hue"], "barberId": barber["id"], "messages": [],
                })
                self.s.commit()
        return {"threadId": thread_id}

    def post_message(self, user, thread_id, body):
        text = text_field(body, "text", 1000)
        with self.s.lock:
            thread = self.s.get("thread", thread_id)
            if not thread or not self.visible_thread(user, thread):
                raise ApiError(404, "conversation not found")
            if thread["type"] == "group" and thread_id not in user.get("joined", []):
                raise ApiError(403, "Join the community to post")
            is_barber_side = thread["type"] == "dm" and thread["barberId"] == user.get("barberId")
            sender = thread["barberId"] if is_barber_side else f"u:{user['id']}"
            thread["messages"].append({"from": sender, "name": user["name"], "text": text, "t": now_ts() * 1000})
            if thread["type"] == "dm" and not is_barber_side:
                barber = self.s.get("barber", thread["barberId"])
                if barber and not barber.get("ownerId"):
                    reply = DEMO_REPLIES[fnv_hash(text + str(len(thread["messages"]))) % len(DEMO_REPLIES)]
                    thread["messages"].append({"from": barber["id"], "name": barber["name"], "text": reply,
                                               "t": now_ts() * 1000 + 1500, "bot": True})
            thread["messages"] = thread["messages"][-300:]
            self.s.put("thread", thread_id, thread)
            self.s.commit()
            return {"ok": True}

    def membership(self, user, thread_id, join):
        with self.s.lock:
            user = self.s.get("user", user["id"])
            thread = self.s.get("thread", thread_id)
            if not thread or thread["type"] != "group":
                raise ApiError(404, "community not found")
            joined = set(user.get("joined", []))
            if join and thread_id not in joined:
                joined.add(thread_id)
                thread["members"] = thread.get("members", 0) + 1
            if not join and thread_id in joined:
                joined.discard(thread_id)
                thread["members"] = max(0, thread.get("members", 1) - 1)
            user["joined"] = sorted(joined)
            self.s.put("thread", thread_id, thread)
            self.save_user(user)
            self.s.commit()
            return {"joined": join}

    def create_group(self, user, body):
        title = text_field(body, "title", 60)
        desc = text_field(body, "desc", 200, required=False)
        with self.s.lock:
            user = self.s.get("user", user["id"])
            thread_id = new_id("g")
            self.s.put("thread", thread_id, {
                "id": thread_id, "type": "group", "title": title, "desc": desc, "hue": fnv_hash(title) % 360,
                "members": 1, "ownerId": user["id"],
                "messages": [{"from": f"u:{user['id']}", "name": user["name"], "text": f"Welcome to {title} 👋", "t": now_ts() * 1000}],
            })
            user["joined"] = sorted(set(user.get("joined", [])) | {thread_id})
            self.save_user(user)
            self.s.commit()
            return {"threadId": thread_id}

    # ----- rewards -----
    def challenge_progress(self, user):
        bookings = [b for b in self.s.all("booking") if b["userId"] == user["id"] and b["status"] != "cancelled"]
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        return {
            "c_month3": len([b for b in bookings if b["date"][:7] == month]),
            "c_new": len({b["barberId"] for b in bookings}),
            "c_review": len([b for b in bookings if b.get("rated")]),
            "c_tip": len([b for b in bookings if b.get("tip", 0) > 0]),
            "c_shop": len([o for o in self.s.all("order") if o["userId"] == user["id"]]),
            "c_comm": len(user.get("joined", [])),
            "c_ref": user.get("referrals", 0),
        }

    def claim(self, user, body):
        challenge_id = body.get("id")
        if challenge_id not in CHALLENGES:
            raise ApiError(400, "unknown challenge")
        with self.s.lock:
            user = self.s.get("user", user["id"])
            if user["claimed"].get(challenge_id):
                raise ApiError(400, "Already claimed")
            if self.challenge_progress(user)[challenge_id] < CHALLENGES[challenge_id]["goal"]:
                raise ApiError(400, "Challenge not finished yet")
            user["claimed"][challenge_id] = True
            self.add_points(user, CHALLENGES[challenge_id]["pts"])
            self.save_user(user)
            self.s.commit()
            return {"points": user["points"]}

    def redeem(self, user, body):
        reward = REDEEM.get(body.get("id"))
        if not reward:
            raise ApiError(400, "unknown reward")
        with self.s.lock:
            user = self.s.get("user", user["id"])
            if user["points"] < reward["cost"]:
                raise ApiError(400, "Not enough points")
            user["points"] -= reward["cost"]
            if reward["credit"]:
                user["wallet"] = round2(user["wallet"] + reward["credit"])
                self.txn(user, f"Redeemed {reward['cost']} pts", reward["credit"], "Points")
            self.save_user(user)
            self.s.commit()
            return {"points": user["points"]}

    # ----- barber studio / owner -----
    def my_barber(self, user):
        if not user.get("barberId"):
            raise ApiError(403, "Create a barber profile first")
        return self.barber(user["barberId"])

    def save_barber(self, user, body):
        with self.s.lock:
            barber = self.my_barber(user)
            if "schedule" in body:
                schedule = []
                for shift in body["schedule"][:21]:
                    dow = int(number_field(shift, "dow", 0, 6))
                    start = number_field(shift, "from", 5, 23.5)
                    end = number_field(shift, "to", 5.5, 24)
                    place = self.place(shift.get("placeId"))
                    if end - start < 1:
                        raise ApiError(400, "Shifts must be at least 1 hour")
                    for other in schedule:
                        if other["dow"] == dow and overlaps(other["from"], (other["to"] - other["from"]) * 60, start, (end - start) * 60):
                            raise ApiError(400, "Shifts overlap on the same day")
                    schedule.append({"dow": dow, "placeId": place["id"], "from": start, "to": end})
                if not schedule:
                    raise ApiError(400, "Keep at least one shift")
                barber["schedule"] = schedule
            if "services" in body:
                services = []
                for service in body["services"][:20]:
                    services.append({
                        "id": text_field(service, "id", 20), "name": text_field(service, "name", 60),
                        "mins": int(number_field(service, "mins", 10, 300)), "price": number_field(service, "price", 1, 1000),
                    })
                if not services:
                    raise ApiError(400, "Keep at least one service")
                barber["services"] = services
            for field, limit in (("bio", 400), ("title", 60)):
                if field in body:
                    barber[field] = text_field(body, field, limit, required=False)
            if "portfolio" in body:
                keep = {item.get("id") for item in body["portfolio"]}
                barber["portfolio"] = [item for item in barber["portfolio"] if item["id"] in keep]
            self.s.put("barber", barber["id"], barber)
            self.s.commit()
            return {"barber": barber}

    def add_portfolio(self, user, content_type, data, title):
        if content_type not in ("image/jpeg", "image/png", "image/webp"):
            raise ApiError(415, "Upload a JPG, PNG or WebP photo")
        with self.s.lock:
            barber = self.my_barber(user)
            item_id = new_id("f")
            file_name = item_id + UPLOAD_TYPES[content_type]
            (self.s.media_dir / file_name).write_bytes(data)
            barber["portfolio"].insert(0, {"id": item_id, "title": title[:60] or "New cut", "style": "fade",
                                           "hue": barber["hue"], "likes": 0, "img": f"/media/{file_name}"})
            self.s.put("barber", barber["id"], barber)
            self.s.commit()
            return {"barber": barber}

    def pay_rent(self, user, body):
        with self.s.lock:
            user = self.s.get("user", user["id"])
            barber = self.my_barber(user)
            place = self.place(body.get("placeId"))
            shifts = [s for s in barber["schedule"] if s["placeId"] == place["id"]]
            if not shifts:
                raise ApiError(400, "You have no shifts at this place")
            amount = len(shifts) * (place["rent"] + place["kitFee"])
            week = datetime.now(timezone.utc).strftime("%G-W%V")
            paid = user.setdefault("rentPaid", {}).setdefault(week, {})
            if paid.get(place["id"]):
                raise ApiError(400, "Rent already paid this week")
            self.charge(user, amount, user["method"], f"Chair rent · {place['name']}")
            paid[place["id"]] = True
            self.save_user(user)
            self.s.commit()
            return {"amount": amount}

    def add_product(self, user, body):
        name = text_field(body, "name", 80)
        price = number_field(body, "price", 1, 5000)
        category = body.get("cat") if body.get("cat") in ("Styling", "Beard", "Care", "Tools", "Merch") else "Styling"
        if user.get("barberId") and body.get("as") != "place":
            seller_type, seller_id = "barber", user["barberId"]
            place_id = self.barber(seller_id)["schedule"][0]["placeId"]
            hue = self.barber(seller_id)["hue"]
        elif user.get("placeId"):
            seller_type, seller_id, place_id = "place", user["placeId"], user["placeId"]
            hue = self.place(place_id)["hue"]
        else:
            raise ApiError(403, "Only barbers and shops can sell")
        emoji = {"Styling": "🫙", "Beard": "🧴", "Care": "🫧", "Tools": "🪮", "Merch": "🧢"}[category]
        with self.s.lock:
            product = {"id": new_id("pr"), "name": name, "price": price, "emoji": emoji, "cat": category,
                       "sellerType": seller_type, "sellerId": seller_id, "placeId": place_id, "rating": 5.0,
                       "sold": 0, "hue": hue, "desc": text_field(body, "desc", 300, required=False) or f"New from {name}."}
            self.s.put("product", product["id"], product)
            self.s.commit()
            return {"product": product}

    def save_place(self, user, body):
        if not user.get("placeId"):
            raise ApiError(403, "Only shop owners can edit a place")
        with self.s.lock:
            place = self.place(user["placeId"])
            if "tier" in body:
                if body["tier"] not in TIERS:
                    raise ApiError(400, "unknown tier")
                place["tier"] = body["tier"]
                place["fee"] = TIERS[body["tier"]]
            if "fee" in body:
                place["fee"] = int(number_field(body, "fee", 0, 15))
            if "rent" in body:
                place["rent"] = number_field(body, "rent", 0, 1000)
            if "kitFee" in body:
                place["kitFee"] = number_field(body, "kitFee", 0, 200)
            if "chairs" in body:
                place["chairs"] = int(number_field(body, "chairs", 1, 60))
            self.s.put("place", place["id"], place)
            self.s.commit()
            return {"place": place}

    # ----- state snapshot -----
    def public_user(self, doc, counts):
        following = doc.get("following", [])
        return {
            "id": doc["id"], "name": doc["name"], "handle": doc.get("handle"), "hue": doc.get("hue", 200),
            "bio": doc.get("bio", ""), "followers": doc.get("followers", 0) + counts.get(f"user:{doc['id']}", 0),
            "following": following if isinstance(following, int) else len(following),
            "seed": bool(doc.get("seed")),
        }

    def state(self, user):
        self.auto_complete()
        user = self.s.get("user", user["id"])
        counts = self.follower_counts()
        my_barber = user.get("barberId")
        my_place = user.get("placeId")
        bookings = [b for b in self.s.all("booking")
                    if b["userId"] == user["id"] or (my_barber and b["barberId"] == my_barber)
                    or (my_place and b["placeId"] == my_place)]
        threads = []
        for thread in self.s.all("thread"):
            if not self.visible_thread(user, thread):
                continue
            copy = dict(thread)
            copy["messages"] = thread["messages"][-80:]
            if thread["type"] == "group":
                copy["joined"] = thread["id"] in user.get("joined", [])
            threads.append(copy)
        shorts = sorted(self.s.all("short"), key=lambda s: -s["createdAt"])[:300]
        barbers = []
        for barber in self.s.all("barber"):
            copy = dict(barber)
            copy["followers"] = barber.get("followers", 0) + counts.get(f"barber:{barber['id']}", 0)
            barbers.append(copy)
        places = []
        for place in self.s.all("place"):
            copy = dict(place)
            copy["followers"] = place.get("followers", 0) + counts.get(f"place:{place['id']}", 0)
            places.append(copy)
        creators = [self.public_user(u, counts) for u in self.s.all("user") if u["id"] != user["id"]]
        owed = [c for c in self.s.all("commission")
                if (c["payerType"] == "barber" and c["payerId"] == my_barber) or (c["payerType"] == "place" and c["payerId"] == my_place)]
        private = {key: value for key, value in user.items() if key not in ("salt", "pw")}
        private["followers"] = user.get("followers", 0) + counts.get(f"user:{user['id']}", 0)
        return {
            "server": {"app": APP_NAME, "version": APP_VERSION, "time": now_ts()},
            "user": private,
            "barbers": sorted(barbers, key=lambda b: b["id"]),
            "places": sorted(places, key=lambda p: p["id"]),
            "products": sorted(self.s.all("product"), key=lambda p: p["id"]),
            "bookings": bookings,
            "txns": sorted([t for t in self.s.all("txn") if t["userId"] == user["id"]], key=lambda t: t["date"], reverse=True)[:100],
            "orders": [o for o in self.s.all("order") if o["userId"] == user["id"]],
            "threads": threads,
            "shorts": [self.public_short(s, user) for s in shorts],
            "creators": creators,
            "commissions": [c for c in self.s.all("commission") if c["creatorId"] == user["id"]],
            "commissionsOwed": owed,
            "creator": self.creator_summary(user),
            "boosts": self.boosts(),
            "progress": self.challenge_progress(user),
            "rentPaidThisWeek": sorted(user.get("rentPaid", {}).get(datetime.now(timezone.utc).strftime("%G-W%V"), {}).keys()),
        }


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------
ROUTES = []


def route(method, pattern, auth=True):
    regex = re.compile("^" + pattern + "$")

    def decorator(func):
        ROUTES.append((method, regex, auth, func))
        return func

    return decorator


@route("GET", r"/api/health", auth=False)
def r_health(app, req, user, m):
    return {"ok": True, "app": APP_NAME, "version": APP_VERSION}


@route("POST", r"/api/auth/register", auth=False)
def r_register(app, req, user, m):
    return app.register(req.json(), req.client_address[0])


@route("POST", r"/api/auth/login", auth=False)
def r_login(app, req, user, m):
    return app.login(req.json(), req.client_address[0])


@route("POST", r"/api/auth/logout")
def r_logout(app, req, user, m):
    return app.logout(req.token())


@route("GET", r"/api/state")
def r_state(app, req, user, m):
    return app.state(user)


@route("GET", r"/api/slots")
def r_slots(app, req, user, m):
    query = req.query()
    barber = app.barber(query.get("barber", ""))
    key = query.get("date", "")
    parse_key(key)
    mins = number_field({"mins": float(query.get("mins", "30"))}, "mins", 10, 300)
    return {"groups": app.slots(barber, key, mins, exclude_id=query.get("exclude"))}


@route("POST", r"/api/bookings")
def r_book(app, req, user, m):
    return app.create_booking(user, req.json())


@route("POST", r"/api/bookings/([\w-]+)/cancel")
def r_cancel(app, req, user, m):
    return app.cancel_booking(user, m.group(1))


@route("POST", r"/api/bookings/([\w-]+)/reschedule")
def r_reschedule(app, req, user, m):
    return app.reschedule_booking(user, m.group(1), req.json())


@route("POST", r"/api/bookings/([\w-]+)/complete")
def r_complete(app, req, user, m):
    return app.barber_complete(user, m.group(1))


@route("POST", r"/api/bookings/([\w-]+)/rate")
def r_rate(app, req, user, m):
    return app.rate_booking(user, m.group(1), req.json())


@route("POST", r"/api/wallet/topup")
def r_topup(app, req, user, m):
    return app.topup(user, req.json())


@route("POST", r"/api/cards")
def r_add_card(app, req, user, m):
    return app.add_card(user, req.json())


@route("DELETE", r"/api/cards/([\w-]+)")
def r_remove_card(app, req, user, m):
    return app.remove_card(user, m.group(1))


@route("POST", r"/api/me/method")
def r_method(app, req, user, m):
    return app.set_method(user, req.json())


@route("POST", r"/api/plan")
def r_plan(app, req, user, m):
    return app.set_plan(user, req.json())


@route("POST", r"/api/follow")
def r_follow(app, req, user, m):
    return app.follow(user, req.json())


@route("POST", r"/api/shorts")
def r_upload(app, req, user, m):
    meta_header = req.headers.get("X-Fade-Meta") or ""
    try:
        meta = json.loads(base64.b64decode(meta_header).decode("utf-8"))
    except Exception:
        raise ApiError(400, "missing or invalid X-Fade-Meta header")
    content_type = (req.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    return app.upload_short(user, meta, content_type, req.raw_body(MAX_UPLOAD_BYTES))


@route("POST", r"/api/shorts/([\w-]+)/(like|view|share)")
def r_short_action(app, req, user, m):
    return app.short_action(user, m.group(1), m.group(2))


@route("POST", r"/api/shorts/([\w-]+)/tags/(\d+)")
def r_tag_review(app, req, user, m):
    return app.review_tag(user, m.group(1), int(m.group(2)), req.json())


@route("DELETE", r"/api/shorts/([\w-]+)")
def r_delete_short(app, req, user, m):
    return app.delete_short(user, m.group(1))


@route("POST", r"/api/dm")
def r_dm(app, req, user, m):
    return app.open_dm(user, req.json())


@route("POST", r"/api/threads")
def r_group(app, req, user, m):
    return app.create_group(user, req.json())


@route("POST", r"/api/threads/([\w-]+)/messages")
def r_message(app, req, user, m):
    return app.post_message(user, m.group(1), req.json())


@route("POST", r"/api/threads/([\w-]+)/(join|leave)")
def r_membership(app, req, user, m):
    return app.membership(user, m.group(1), m.group(2) == "join")


@route("POST", r"/api/orders")
def r_order(app, req, user, m):
    return app.create_order(user, req.json())


@route("POST", r"/api/rewards/claim")
def r_claim(app, req, user, m):
    return app.claim(user, req.json())


@route("POST", r"/api/rewards/redeem")
def r_redeem(app, req, user, m):
    return app.redeem(user, req.json())


@route("POST", r"/api/rewards/referral")
def r_referral(app, req, user, m):
    with app.s.lock:
        fresh = app.s.get("user", user["id"])
        fresh["referrals"] = fresh.get("referrals", 0) + 1
        app.save_user(fresh)
        app.s.commit()
    return {"referrals": fresh["referrals"]}


@route("POST", r"/api/creator/withdraw")
def r_withdraw(app, req, user, m):
    return app.withdraw(user)


@route("PUT", r"/api/studio/barber")
def r_save_barber(app, req, user, m):
    return app.save_barber(user, req.json())


@route("POST", r"/api/studio/portfolio")
def r_portfolio(app, req, user, m):
    content_type = (req.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    return app.add_portfolio(user, content_type, req.raw_body(8 * 1024 * 1024), unquote(req.headers.get("X-Title") or ""))


@route("POST", r"/api/studio/rent")
def r_rent(app, req, user, m):
    return app.pay_rent(user, req.json())


@route("POST", r"/api/products")
def r_product(app, req, user, m):
    return app.add_product(user, req.json())


@route("PUT", r"/api/owner/place")
def r_place(app, req, user, m):
    return app.save_place(user, req.json())


class Handler(BaseHTTPRequestHandler):
    server_version = "Fade/" + APP_VERSION
    app: Fade = None
    quiet = False

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)

    # ----- request helpers -----
    def query(self):
        return {key: values[0] for key, values in parse_qs(urlparse(self.path).query).items()}

    def token(self):
        header = self.headers.get("Authorization") or ""
        return header[7:].strip() if header.startswith("Bearer ") else ""

    def raw_body(self, limit):
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
            raise ApiError(413, f"File too large (max {limit // (1024 * 1024)} MB)")
        return self.rfile.read(length) if length else b""

    def json(self):
        data = self.raw_body(1024 * 1024)
        if not data:
            return {}
        try:
            body = json.loads(data.decode("utf-8"))
        except ValueError:
            raise ApiError(400, "invalid JSON")
        if not isinstance(body, dict):
            raise ApiError(400, "JSON body must be an object")
        return body

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Fade-Meta, X-Title, Range")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")

    # ----- verbs -----
    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self.dispatch("GET")
        if path.startswith("/media/"):
            return self.serve_media(Path(unquote(path)).name)
        return self.serve_static(path)

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def dispatch(self, method):
        path = urlparse(self.path).path
        try:
            for route_method, regex, auth, func in ROUTES:
                match = regex.match(path)
                if not match or route_method != method:
                    continue
                user = self.app.user_by_token(self.token())
                if auth and not user:
                    raise ApiError(401, "Please log in")
                return self.send_json(200, func(self.app, self, user, match))
            raise ApiError(404, "not found")
        except ApiError as err:
            self.send_json(err.status, {"error": err.message})
        except Exception as err:  # pragma: no cover - defensive
            self.send_json(500, {"error": f"server error: {err}"})

    def serve_media(self, name):
        if not re.fullmatch(r"[\w-]+\.(mp4|webm|mov|jpg|png|webp)", name):
            return self.send_json(404, {"error": "not found"})
        path = self.app.s.media_dir / name
        if not path.exists():
            return self.send_json(404, {"error": "not found"})
        size = path.stat().st_size
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        start, end = 0, size - 1
        status = 200
        range_header = self.headers.get("Range")
        if range_header:
            match = re.match(r"bytes=(\d*)-(\d*)", range_header)
            if match:
                if match.group(1):
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else size - 1
                elif match.group(2):
                    start = max(0, size - int(match.group(2)))
                end = min(end, size - 1)
                if start > end:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                status = 206
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "public, max-age=86400")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.cors()
        self.end_headers()
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = handle.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def serve_static(self, path):
        relative = unquote(path).lstrip("/") or "index.html"
        target = (WEB_DIR / relative).resolve()
        if target.is_dir():
            target = target / "index.html"
        if WEB_DIR.resolve() not in target.parents and target != WEB_DIR.resolve() or not target.exists():
            return self.send_json(404, {"error": "not found"})
        data = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix == ".webmanifest":
            content_type = "application/manifest+json"
        if target.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def make_server(host, port, data_dir, quiet=False):
    store = Store(Path(data_dir))
    Handler.app = Fade(store)
    Handler.quiet = quiet
    return ThreadingHTTPServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser(description="Fade backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--data", default=os.environ.get("FADE_DATA") or str(BASE_DIR / "data"))
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    server = make_server(args.host, args.port, args.data, args.quiet)
    print(f"Fade {APP_VERSION} running on http://{args.host}:{args.port}/  (data: {args.data})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
