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
  * moderation: reports (auto-hide at 3 reporters), moderator console (--admin EMAIL),
    bans, verification, blocked-word filter, comments
  * push: in-app notifications + ntfy pushes to each user's private topic, 2 h reminders
  * video transcoding with ffmpeg when installed (720p H.264, faststart, poster)

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
import platform
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import threading
import time
import unicodedata
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nsfw_scan  # noqa: E402  (server-side copy of the apps' safety classifier)

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover - Python < 3.9
    ZoneInfo = None

APP_NAME = "fade"
APP_VERSION = "3.3.0"

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
# ---------------------------------------------------------------------------
# Moderation, automatic scanning, push notifications and video transcoding
# ---------------------------------------------------------------------------
REPORT_REASONS = ("spam", "nudity", "violence", "harassment", "hate", "impersonation", "not-haircut", "other")
AUTO_HIDE_REPORTS = 3
BLOCKED_WORDS = ("nigger", "faggot", "kill yourself", "kys", "child porn", "cp link")  # same list as web/net.js
REMINDER_LEAD_HOURS = 2
SWEEP_SECONDS = 60
TRANSCODE_TIMEOUT_S = 300
TRANSCODE_MAX_SECONDS = 60
TRANSCODE_MAX_W, TRANSCODE_MAX_H = 720, 1280
MOD_ACTIONS = ("hide", "unhide", "keep", "ban", "unban", "verify", "unverify", "dismiss", "scan")

# Automatic scanning. Uploads are classified on the uploader's device (web/scan.js, NSFW MobileNetV2);
# the server enforces the verdict, re-checks unscanned uploads from a moderator's browser and blocks
# re-uploads of removed media by perceptual hash (needs ffmpeg, which the server fetches itself).
SCAN_BLOCK = 0.85          # porn + hentai probability: refuse the upload
SCAN_REVIEW = 0.5          # hide until a moderator looks at it
SCAN_REVIEW_SEXY = 0.9     # "sexy" class alone: hide for review
PHASH_MATCH_BITS = 10      # Hamming distance (of 64) that counts as the same picture
SCAN_MISMATCH_MARGIN = 0.3  # server says explicit, uploader's app said clean by at least this much -> flag the account
HOOK_TIMEOUT_S = 30
HOOK_ALERT_AFTER = 3       # failed external checks before moderators are told (the upload stays held)
HOOK_ACTIONS = ("allow", "review", "block")
HOOK_SEVERE_LABELS = ("csam", "child", "minor")  # external checker says child abuse: hide, ban, keep evidence
# Pushes are content-free unless the person opts in: ntfy keeps message text in its cache (~12 h on ntfy.sh)
# even after a recall, so by default nothing personal ever goes through it.
PRIVATE_PUSH_LABELS = {
    "bk": "Booking update", "rm": "Appointment reminder", "dm": "New message", "cm": "New comment",
    "comment": "New comment", "rp": "New report to review", "report": "New report to review",
    "hd": "Update on your upload", "short": "New tag request", "booking": "Booking update",
}
LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "i"})
URL_RE = re.compile(r"(https?://|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|xyz|ru|top|link|click|info|biz|me|co|ly)\b)", re.I)
NEW_ACCOUNT_LINK_HOURS = 24
DUPLICATE_WINDOW_S, DUPLICATE_LIMIT = 600, 3
RATE_LIMITS = {  # action: (max events, window seconds)
    "comment": (10, 60), "message": (30, 60), "upload": (20, 3600), "report": (30, 3600),
}

# Static ffmpeg builds (BSD-2 imageio-ffmpeg wheels on PyPI), pinned by SHA-256.
FFMPEG_WHEEL_VERSION = "0.6.0"
_PYPI = "https://files.pythonhosted.org/packages"
FFMPEG_WHEELS = {
    ("darwin", "arm64"): (f"{_PYPI}/40/5c/f3d8a657d362cc93b81aab8feda487317da5b5d31c0e1fdfd5e986e55d17/imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl",
                          "b1ae3173414b5fc5f538a726c4e48ea97edc0d2cdc11f103afee655c463fa742"),
    ("darwin", "x86_64"): (f"{_PYPI}/da/58/87ef68ac83f4c7690961bce288fd8e382bc5f1513860fc7f90a9c1c1c6bf/imageio_ffmpeg-0.6.0-py3-none-macosx_10_9_intel.macosx_10_9_x86_64.whl",
                           "9d2baaf867088508d4a3458e61eeb30e945c4ad8016025545f66c4b5aaef0a61"),
    ("linux", "x86_64"): (f"{_PYPI}/a0/2d/43c8522a2038e9d0e7dbdf3a61195ecc31ca576fb1527a528c877e87d973/imageio_ffmpeg-0.6.0-py3-none-manylinux2014_x86_64.whl",
                          "c7e46fcec401dd990405049d2e2f475e2b397779df2519b544b8aab515195282"),
    ("linux", "aarch64"): (f"{_PYPI}/33/e7/1925bfbc563c39c1d2e82501d8372734a5c725e53ac3b31b4c2d081e895b/imageio_ffmpeg-0.6.0-py3-none-manylinux2014_aarch64.whl",
                           "1d47bebd83d2c5fc770720d211855f208af8a596c82d17730aa51e815cdee6dc"),
    ("win32", "amd64"): (f"{_PYPI}/2c/c6/fa760e12a2483469e2bf5058c5faff664acf66cadb4df2ad6205b016a73d/imageio_ffmpeg-0.6.0-py3-none-win_amd64.whl",
                         "02fa47c83703c37df6bfe4896aab339013f62bf02c5ebf2dce6da56af04ffc0a"),
    ("win32", "x86"): (f"{_PYPI}/a0/13/59da54728351883c3c1d9fca1710ab8eee82c7beba585df8f25ca925f08f/imageio_ffmpeg-0.6.0-py3-none-win32.whl",
                       "196faa79366b4a82f95c0f4053191d2013f4714a715780f0ad2a68ff37483cc2"),
}

# Linux CPUs without an imageio wheel (Raspberry Pi OS 32-bit, old ARM boards, 32-bit PCs): John Van Sickle's
# static builds (GPLv3), pinned to the immutable 6.0.1 files in his old-releases archive by SHA-256.
_JVS = "https://johnvansickle.com/ffmpeg/old-releases"
_ARMHF = (f"{_JVS}/ffmpeg-6.0.1-armhf-static.tar.xz", "241cbf509222420033486ea82a7cf3cf4fb534437fa00d79df8abebd0184d7e6")
_ARMEL = (f"{_JVS}/ffmpeg-6.0.1-armel-static.tar.xz", "1c2dd0795990796c29d0da8b0842e0bb13daf35eee062087a78cd70131301d58")
_I686 = (f"{_JVS}/ffmpeg-6.0.1-i686-static.tar.xz", "4a50bf739ea2291f9d3b34642e8fe38bc03de80490f342dfb411749eaa7b67a5")
FFMPEG_WHEELS.update({
    ("linux", "armv7l"): _ARMHF, ("linux", "armv8l"): _ARMHF, ("linux", "armhf"): _ARMHF,
    ("linux", "armv6l"): _ARMEL, ("linux", "armv5tel"): _ARMEL,
    ("linux", "x86"): _I686,
})


def ffmpeg_install_hint():
    """The one command that installs ffmpeg where Fade has no verified download."""
    if sys.platform.startswith("freebsd"):
        return "pkg install ffmpeg"
    if sys.platform.startswith("openbsd"):
        return "pkg_add ffmpeg"
    if sys.platform.startswith("netbsd"):
        return "pkgin install ffmpeg"
    if sys.platform.startswith("linux"):
        return "sudo apt install ffmpeg (Debian/Ubuntu) · sudo dnf install ffmpeg (Fedora) · apk add ffmpeg (Alpine)"
    if sys.platform == "darwin":
        return "brew install ffmpeg"
    if sys.platform == "win32":
        return "winget install ffmpeg"
    return "install ffmpeg from https://ffmpeg.org/download.html"


def platform_key():
    machine = platform.machine().lower()
    machine = {"amd64": "x86_64", "x64": "x86_64", "arm64": "arm64", "aarch64": "aarch64", "i386": "x86", "i686": "x86"}.get(machine, machine)
    if sys.platform == "darwin":
        return ("darwin", "arm64" if machine in ("arm64", "aarch64") else "x86_64")
    if sys.platform.startswith("linux"):
        return ("linux", "aarch64" if machine in ("arm64", "aarch64") else machine)
    if sys.platform == "win32":
        return ("win32", "amd64" if machine == "x86_64" else machine)
    return (sys.platform, machine)


def working_ffmpeg(path):
    try:
        result = subprocess.run([str(path), "-hide_banner", "-version"], capture_output=True, timeout=20)
        return result.returncode == 0 and b"ffmpeg" in result.stdout.lower()
    except (OSError, subprocess.TimeoutExpired):
        return False


def fetch_ffmpeg(cache_dir: Path, wheels=None, timeout=120):
    """Download a static ffmpeg for this OS/CPU once, verify its SHA-256 and cache it. Returns the path."""
    wheels = wheels or FFMPEG_WHEELS
    key = platform_key()
    if key not in wheels:
        raise RuntimeError(f"no prebuilt ffmpeg for {key[0]}/{key[1]} — run: {ffmpeg_install_hint()} "
                           "(Fade uses it from PATH on the next start, or pass --ffmpeg /path/to/ffmpeg)")
    url, digest = wheels[key]
    cache_dir.mkdir(parents=True, exist_ok=True)
    target = cache_dir / ("ffmpeg.exe" if key[0] == "win32" else "ffmpeg")
    if target.exists() and working_ffmpeg(target):
        return target
    partial = cache_dir / "ffmpeg-download.part"
    sha = hashlib.sha256()
    request = urllib.request.Request(url, headers={"User-Agent": f"Fade/{APP_VERSION}"})
    with urllib.request.urlopen(request, timeout=timeout) as response, open(partial, "wb") as out:
        while True:
            chunk = response.read(1 << 16)
            if not chunk:
                break
            sha.update(chunk)
            out.write(chunk)
    if sha.hexdigest() != digest:
        partial.unlink(missing_ok=True)
        raise RuntimeError("ffmpeg download failed its SHA-256 check — not installed")
    if url.endswith(".tar.xz"):
        with tarfile.open(partial, "r:xz") as archive:
            members = [m for m in archive.getmembers() if m.isfile() and m.name.rsplit("/", 1)[-1] == "ffmpeg"]
            if not members:
                raise RuntimeError("ffmpeg binary missing from the download")
            with archive.extractfile(members[0]) as source, open(target, "wb") as out:
                shutil.copyfileobj(source, out)
    else:
        with zipfile.ZipFile(partial) as wheel:
            members = [n for n in wheel.namelist() if "/binaries/ffmpeg" in n and not n.endswith((".md", ".py"))]
            if not members:
                raise RuntimeError("ffmpeg binary missing from the download")
            with wheel.open(members[0]) as source, open(target, "wb") as out:
                shutil.copyfileobj(source, out)
    partial.unlink(missing_ok=True)
    target.chmod(0o755)
    if not working_ffmpeg(target):
        target.unlink(missing_ok=True)
        raise RuntimeError("downloaded ffmpeg does not run on this machine")
    return target


def normalize_text(value):
    """Lower-case, strip accents and undo leetspeak (k1ll -> kill, $pam -> spam)."""
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()
    return text.translate(LEET)


def _phrase_pattern(phrase):
    """'kys' -> k+ y+ s+ with any separators between letters, not glued to other letters.
    Catches k.y.s, kkyyss, k y s, n1gg3r, niiigger; leaves 'sky', 'skill yourself', 'Niger' alone."""
    letters = phrase.replace(" ", "")
    body = r"[\W_]*".join(re.escape(ch) + "+" for ch in letters)
    tail = r"(?![a-z])" if len(letters) <= 4 else ""
    return re.compile(r"(?:^|[^a-z])" + body + tail)


BLOCKED_PATTERNS = [(phrase, _phrase_pattern(phrase)) for phrase in BLOCKED_WORDS]


def blocked_phrase(value):
    """Return the blocked phrase hidden in the text (spacing, dots, repeats, leetspeak and accents don't help)."""
    raw = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()
    digits_only = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t"})
    variants = {raw.translate(LEET), raw.translate(digits_only), raw.translate(str.maketrans({"1": "l", "|": "l"})).translate(LEET)}
    for phrase, pattern in BLOCKED_PATTERNS:
        if any(pattern.search(text) for text in variants):
            return phrase
    return None


def dhash_bits(gray9x8: bytes):
    """64-bit difference hash from a 9x8 grayscale frame."""
    bits = 0
    for row in range(8):
        line = gray9x8[row * 9:(row + 1) * 9]
        for col in range(8):
            bits = (bits << 1) | (1 if line[col] > line[col + 1] else 0)
    return f"{bits:016x}"


def hamming(a, b):
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except (TypeError, ValueError):
        return 64



def load_hash_list(path):
    """Operator-supplied perceptual hashes to refuse: one 16-hex dHash per line, optional label after it.
    '#' starts a comment. Returns {hash: label}."""
    hashes = {}
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        value, _, label = line.partition(" ")
        value = value.strip().lower()
        if re.fullmatch(r"[0-9a-f]{16}", value):
            hashes[value] = (label.strip() or "operator list")[:60]
    return hashes


def scan_numbers(raw):
    """Validate a client scan result {nsfw, sexy, model}; None if missing or malformed."""
    if not isinstance(raw, dict):
        return None
    out = {}
    for key in ("nsfw", "sexy"):
        value = raw.get(key)
        if not isinstance(value, (int, float)) or not 0 <= value <= 1:
            return None
        out[key] = round(float(value), 4)
    out["model"] = str(raw.get("model") or "nsfwjs")[:40]
    out["frames"] = int(raw.get("frames") or 1) if isinstance(raw.get("frames"), int) else 1
    return out


def scan_verdict(scan):
    if not scan:
        return "unscanned"
    if scan["nsfw"] >= SCAN_BLOCK:
        return "block"
    if scan["nsfw"] >= SCAN_REVIEW or scan["sexy"] >= SCAN_REVIEW_SEXY:
        return "review"
    return "ok"


class SafetyMixin:
    """Reports + moderator console, automatic scanning, ntfy push (updatable and recallable),
    in-app notifications and server-side ffmpeg transcoding."""

    def setup_safety(self, admins=(), ntfy=None, public_url="", ffmpeg="auto", scan="off", scan_hook=None, hash_list=None):
        self.admins = {email.strip().lower() for email in admins if email and email.strip()}
        self.ntfy = (ntfy or "").rstrip("/") or None
        self.public_url = (public_url or "").rstrip("/")
        self.push_log = []  # last pushes, recalls and clears (for tests / diagnostics)
        self.hook_log = []
        self.rate_events = {}
        self.verify_lock = threading.Lock()
        self.verifying_now = set()
        # Server-side checks that don't trust the uploader's app: the same classifier (numpy), an optional
        # external checker (CSAM hash matching, violence, ... run by the operator) and an optional hash list.
        self.scan_hook = (scan_hook or "").strip() or None
        self.external_hashes = load_hash_list(hash_list) if hash_list else {}
        self.scanner = None
        self.scan_status = "off"
        if scan not in (None, "", "off"):
            self.scanner = nsfw_scan.ServerScanner(self.s.media_dir.parent / "pylib", install=scan != "local")
            self.scan_status = "loading"
            threading.Thread(target=self.provision_scanner, daemon=True).start()
        self.ffmpeg = None
        self.ffmpeg_status = "off"
        self.ffmpeg_cache = self.s.media_dir.parent / "bin"
        if ffmpeg in (None, "", "off"):
            return
        if ffmpeg not in ("auto", "fetch"):
            self.ffmpeg = ffmpeg
            self.ffmpeg_status = "custom"
            return
        found = shutil.which("ffmpeg") if ffmpeg == "auto" else None
        cached = self.ffmpeg_cache / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
        if found:
            self.ffmpeg, self.ffmpeg_status = found, "system"
        elif cached.exists() and working_ffmpeg(cached):
            self.ffmpeg, self.ffmpeg_status = str(cached), "downloaded"
        else:
            self.ffmpeg_status = "downloading"
            threading.Thread(target=self.provision_ffmpeg, daemon=True).start()

    def provision_ffmpeg(self, wheels=None):
        """Fetch ffmpeg in the background, then transcode/hash everything that arrived meanwhile."""
        try:
            self.ffmpeg = str(fetch_ffmpeg(self.ffmpeg_cache, wheels))
            self.ffmpeg_status = "downloaded"
        except Exception as err:  # never take the server down for an optional tool
            self.ffmpeg_status = f"unavailable: {err}"[:200]
            return None
        self.process_backlog()
        return self.ffmpeg

    def provision_scanner(self):
        """Load numpy (fetched into <data>/pylib if missing) + the classifier, then check the backlog."""
        try:
            self.scanner.ready()
            self.scan_status = self.scanner.status
        except Exception as err:  # optional: the apps' own checks and moderators still work without it
            self.scan_status = f"unavailable: {err}"[:200]
            return False
        self.process_backlog()
        return True

    def server_scan_ready(self):
        return bool(self.ffmpeg) and self.scanner is not None and getattr(self.scanner, "model", None) is not None

    def server_checks_active(self):
        """True when uploads are held until the server's own checks have run."""
        return self.server_scan_ready() or bool(self.scan_hook)

    def process_backlog(self):
        """Transcode, hash and server-check shorts uploaded before ffmpeg / the classifier were ready."""
        for short in self.s.all("short"):
            media = short.get("media") or {}
            if short.get("seed") or media.get("processing"):
                continue
            needs_transcode = media.get("kind") == "video" and not media.get("transcoded") and not media.get("optimized") \
                and not media.get("transcodeError")
            if needs_transcode:
                with self.s.lock:
                    fresh = self.s.get("short", short["id"])
                    fresh["media"]["processing"] = True
                    self.s.put("short", fresh["id"], fresh)
                    self.s.commit()
                self.queue_transcode(fresh)
            elif media.get("url", "").startswith("/media/") and (
                    not media.get("phash") or (self.server_scan_ready() and not media.get("serverScan"))):
                threading.Thread(target=self.verify_media, args=(short["id"],), daemon=True).start()

    # ----- text rules -----
    @staticmethod
    def ensure_clean(value, label="text"):
        if blocked_phrase(value):
            raise ApiError(400, f"That {label} breaks the community guidelines")

    def throttle(self, user, action):
        if os.environ.get("FADE_RATE_LIMITS") == "off":
            return
        limit, window = RATE_LIMITS[action]
        now = time.time()
        key = (user["id"], action)
        events = [t for t in self.rate_events.get(key, []) if now - t < window]
        if len(events) >= limit:
            wait = int(window - (now - events[0])) + 1
            raise ApiError(429, f"Slow down — try again in {wait} s")
        events.append(now)
        self.rate_events[key] = events

    def spam_check(self, user, text, kind):
        """Links from brand-new accounts, link floods and copy-paste floods are refused automatically."""
        links = len(URL_RE.findall(text or ""))
        age_h = (now_ts() - (user.get("createdAt") or 0)) / 3600
        if links and age_h < NEW_ACCOUNT_LINK_HOURS and not self.is_admin(user):
            raise ApiError(400, "New accounts can't post links yet — try again tomorrow")
        if links > 2:
            raise ApiError(400, "Too many links — that looks like spam")
        norm = " ".join(re.findall(r"[a-z0-9]+", normalize_text(text)))
        if len(norm) < 4:
            return
        now = time.time()
        key = (user["id"], "dup")
        recent = [(t, h) for t, h in self.rate_events.get(key, []) if now - t < DUPLICATE_WINDOW_S]
        digest = hashlib.sha1(norm.encode()).hexdigest()[:16]
        if sum(1 for _, h in recent if h == digest) >= DUPLICATE_LIMIT - 1:
            raise ApiError(400, f"You've posted that {kind} several times — that looks like spam")
        recent.append((now, digest))
        self.rate_events[key] = recent[-50:]

    # ----- moderation state -----
    def mod_doc(self):
        doc = self.s.get("meta", "mod")
        if not doc:
            doc = {}
        for key in ("hidden", "kept", "banned", "phash"):
            doc.setdefault(key, {})
        return doc

    def is_admin(self, user):
        return bool(user) and (user.get("email", "").lower() in self.admins or bool(user.get("admin")))

    def is_banned(self, user_or_id):
        user_id = user_or_id["id"] if isinstance(user_or_id, dict) else user_or_id
        return bool(user_id) and user_id in self.mod_doc()["banned"]

    def ensure_active(self, user):
        if self.is_banned(user):
            raise ApiError(403, "This account is suspended for breaking the community guidelines")

    def resolve_target(self, target):
        """Accepts 'short:ID', 'comment:ID', 'user:ID', 'barber:ID', 'place:ID' or a bare id."""
        target = str(target or "").strip()
        kinds = ("short", "comment", "user", "barber", "place")
        if ":" in target and target.split(":", 1)[0] in kinds:
            kind, doc_id = target.split(":", 1)
            candidates = [(kind, doc_id)]
        else:
            candidates = [(kind, target) for kind in kinds]
        for kind, doc_id in candidates:
            doc = self.s.get(kind, doc_id)
            if not doc:
                continue
            if kind == "short":
                owner, preview = doc.get("userId"), doc.get("caption", "")
            elif kind == "comment":
                owner, preview = doc.get("userId"), doc.get("text", "")
            elif kind == "user":
                owner, preview = doc["id"], doc.get("name", "")
            else:
                owner, preview = doc.get("ownerId"), doc.get("name", "")
            return {"key": f"{kind}:{doc_id}", "kind": kind, "id": doc_id, "doc": doc, "ownerId": owner, "preview": preview[:140]}
        raise ApiError(404, "Nothing to report there")

    def is_hidden(self, kind, doc_id):
        return f"{kind}:{doc_id}" in self.mod_doc()["hidden"]

    def report(self, user, body):
        self.ensure_active(user)
        reason = body.get("reason")
        if reason not in REPORT_REASONS:
            raise ApiError(400, "Pick a reason")
        note = text_field(body, "note", 300, required=False)
        self.throttle(user, "report")
        with self.s.lock:
            info = self.resolve_target(body.get("target"))
            if info["ownerId"] == user["id"]:
                raise ApiError(400, "You can't report your own content")
            reports = [r for r in self.s.all("report") if r["target"] == info["key"] and r["status"] == "open"]
            if any(r["reporterId"] == user["id"] for r in reports):
                return {"ok": True, "duplicate": True, "reports": len(reports)}
            doc = {
                "id": new_id("rp"), "target": info["key"], "targetUserId": info["ownerId"], "reporterId": user["id"],
                "reason": reason, "note": note, "status": "open", "createdAt": now_ts(),
            }
            self.s.put("report", doc["id"], doc)
            reports.append(doc)
            mod = self.mod_doc()
            reporters = {r["reporterId"] for r in reports if not r.get("auto")}
            hidden = False
            if len(reporters) >= AUTO_HIDE_REPORTS and info["key"] not in mod["kept"] and info["key"] not in mod["hidden"]:
                mod["hidden"][info["key"]] = now_ts()
                self.s.put("meta", "mod", mod)
                hidden = True
            self.s.commit()
        if hidden:
            self.after_hide(info["key"])
            if info["ownerId"]:
                self.notify(info["ownerId"], "Content hidden for review",
                            f"Your {info['kind']} was reported by {len(reporters)} people and is hidden until a moderator reviews it.",
                            "/me", seq=f"hd-{info['id']}")
        self.alert_admins(info["key"], f"{reason}: {info['preview'][:80]}", len(reporters))
        return {"ok": True, "reports": len(reporters), "hidden": hidden}

    def alert_admins(self, key, message, count=1):
        # one notification per reported item: later reports update it instead of stacking up
        seq = "rp-" + hashlib.sha1(key.encode()).hexdigest()[:12]
        title = "New report 🛡️" if count <= 1 else f"{count} reports 🛡️"
        for admin in self.admin_users():
            self.notify(admin["id"], title, message, "/admin", seq=seq, ref=f"report:{key}")

    def auto_flag(self, key, owner_id, reason, note, hide):
        """Automatic report from the scanner (counts as a moderator queue item, not as a user reporter)."""
        with self.s.lock:
            for report in self.s.all("report"):
                if report["target"] == key and report.get("auto") and report["status"] == "open" and report["reason"] == reason:
                    break
            else:
                doc = {
                    "id": new_id("rp"), "target": key, "targetUserId": owner_id, "reporterId": "automod", "auto": True,
                    "reason": reason, "note": note[:300], "status": "open", "createdAt": now_ts(),
                }
                self.s.put("report", doc["id"], doc)
            mod = self.mod_doc()
            newly_hidden = hide and key not in mod["hidden"] and key not in mod["kept"]
            if newly_hidden:
                mod["hidden"][key] = now_ts()
                self.s.put("meta", "mod", mod)
            self.s.commit()
        if newly_hidden:
            self.after_hide(key)
            if owner_id:
                self.notify(owner_id, "Upload held for review", "Fade's automatic check flagged your short; a moderator will look at it soon.",
                            "/me", seq=f"hd-{key.split(':', 1)[1]}")
        self.alert_admins(key, f"auto · {reason}: {note[:80]}")

    def admin_users(self):
        return [u for u in self.s.all("user") if self.is_admin(u)]

    def mod_queue(self, user):
        if not self.is_admin(user):
            raise ApiError(403, "Moderators only")
        mod = self.mod_doc()
        grouped = {}
        for report in self.s.all("report"):
            if report["status"] != "open":
                continue
            grouped.setdefault(report["target"], []).append(report)
        queue = []
        for key, reports in grouped.items():
            try:
                info = self.resolve_target(key)
                preview = {"type": info["kind"], "text": info["preview"]}
                if info["kind"] == "short":
                    preview["media"] = info["doc"].get("media")
            except ApiError:
                preview = {"type": key.split(":", 1)[0], "text": "(deleted)"}
                info = {"ownerId": reports[0].get("targetUserId")}
            queue.append({
                "target": key, "reports": sorted(reports, key=lambda r: r["createdAt"]),
                "reporters": len({r["reporterId"] for r in reports if not r.get("auto")}),
                "auto": [r["reason"] for r in reports if r.get("auto")],
                "hidden": key in mod["hidden"], "kept": key in mod["kept"],
                "targetPk": info.get("ownerId"), "banned": bool(info.get("ownerId")) and info["ownerId"] in mod["banned"],
                "preview": preview,
            })
        queue.sort(key=lambda q: (-len(q["auto"]) - q["reporters"], -q["reports"][-1]["createdAt"]))
        unscanned = [
            {"id": s["id"], "caption": s.get("caption", ""), "media": s.get("media"), "userId": s.get("userId")}
            for s in self.s.all("short")
            if not s.get("seed") and (s.get("media") or {}).get("scanVerdict") == "unscanned"
            and f"short:{s['id']}" not in mod["hidden"] and f"short:{s['id']}" not in mod["kept"]
        ]
        held = [{"id": s["id"], "caption": s.get("caption", ""), "error": s["media"].get("hookError")}
                for s in self.s.all("short") if (s.get("media") or {}).get("verifying")]
        return {"queue": queue, "banned": sorted(mod["banned"].keys()), "unscanned": unscanned[:50],
                "blockedHashes": len(mod["phash"]) + len(self.external_hashes), "held": held[:50],
                "serverChecks": {"classifier": self.scan_status, "hook": bool(self.scan_hook), "hashList": len(self.external_hashes)}}

    def moderate(self, user, body):
        if not self.is_admin(user):
            raise ApiError(403, "Moderators only")
        action = body.get("action")
        target = str(body.get("target") or "")
        if action not in MOD_ACTIONS:
            raise ApiError(400, "unknown moderation action")
        if action == "scan":
            return self.moderator_scan(target, body.get("scan"))
        hidden_key = None
        resolved_key = None
        banned_id = None
        with self.s.lock:
            mod = self.mod_doc()
            if action == "dismiss":
                report = self.s.get("report", target)
                if not report:
                    raise ApiError(404, "report not found")
                report["status"] = "dismissed"
                self.s.put("report", report["id"], report)
                if not [r for r in self.s.all("report") if r["target"] == report["target"] and r["status"] == "open"]:
                    resolved_key = report["target"]
            elif action in ("ban", "unban"):
                banned_id = target.split(":", 1)[1] if target.startswith("user:") else target
                if not self.s.get("user", banned_id):
                    raise ApiError(404, "user not found")
                if action == "ban":
                    if banned_id == user["id"]:
                        raise ApiError(400, "You can't ban yourself")
                    mod["banned"][banned_id] = now_ts()
                    self.s.db.execute("DELETE FROM sessions WHERE user_id = ?", (banned_id,))
                    for short in self.s.all("short"):  # their media can't simply be re-uploaded elsewhere
                        if short.get("userId") == banned_id:
                            self.block_hashes(mod, short, f"short:{short['id']}")
                else:
                    mod["banned"].pop(banned_id, None)
                    for value, info in list(mod["phash"].items()):
                        short = self.s.get("short", info.get("target", ":").split(":", 1)[1])
                        if short and short.get("userId") == banned_id and info.get("target") not in mod["hidden"]:
                            mod["phash"].pop(value, None)
            elif action in ("verify", "unverify"):
                info = self.resolve_target(target)
                if info["kind"] not in ("barber", "place"):
                    raise ApiError(400, "Only barbers and shops can be verified")
                info["doc"]["verified"] = action == "verify"
                self.s.put(info["kind"], info["id"], info["doc"])
            else:
                key = self.resolve_target(target)["key"] if action != "unhide" else target
                if action == "hide":
                    mod["hidden"][key] = now_ts()
                    mod["kept"].pop(key, None)
                    hidden_key = key
                    if key.startswith("short:"):
                        short = self.s.get("short", key.split(":", 1)[1])
                        if short:
                            self.block_hashes(mod, short, key)
                elif action in ("unhide", "keep"):
                    mod["hidden"].pop(key, None)
                    for value, info in list(mod["phash"].items()):
                        if info.get("target") == key:
                            mod["phash"].pop(value, None)
                    if action == "keep":
                        mod["kept"][key] = now_ts()
                        if key.startswith("short:"):
                            short = self.s.get("short", key.split(":", 1)[1])
                            if short and short["media"].get("scanVerdict") == "unscanned":
                                short["media"]["scanVerdict"] = "reviewed"
                                self.s.put("short", short["id"], short)
                if action in ("hide", "keep"):
                    resolved_key = key
                    for report in self.s.all("report"):
                        if report["target"] == key and report["status"] == "open":
                            report["status"] = "resolved"
                            report["resolution"] = action
                            self.s.put("report", report["id"], report)
            self.s.put("meta", "mod", mod)
            self.s.commit()
        if hidden_key:
            self.after_hide(hidden_key)
        if resolved_key:  # the admins' "new report" pushes are done: take them off their phones
            self.recall(lambda n: n.get("ref") == f"report:{resolved_key}")
        if action == "ban" and banned_id:
            # pushes the banned account caused (DMs, comments, tags, bookings) disappear from people's phones
            self.recall(lambda n: n.get("actor") == banned_id)
        return {"ok": True}

    def block_hashes(self, mod, short, key):
        for value in (short.get("media") or {}).get("phash") or []:
            mod["phash"][value] = {"target": key, "at": now_ts()}

    def after_hide(self, key):
        """Hidden content: recall the pushes it caused on other people's phones (a hidden comment's push
        to the short's author, a hidden short's tag requests to barbers and shops)."""
        self.recall(lambda n: n.get("ref") == key)

    def moderator_scan(self, short_id, raw_scan):
        """A moderator's browser classified an unscanned upload; apply the same policy as at upload time."""
        short_id = short_id.split(":", 1)[-1]
        scan = scan_numbers(raw_scan)
        if not scan:
            raise ApiError(400, "scan result required")
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                raise ApiError(404, "short not found")
            verdict = scan_verdict(scan)
            short["media"]["scan"] = scan
            short["media"]["scanVerdict"] = verdict
            short["media"]["scanBy"] = "moderator"
            self.s.put("short", short_id, short)
            self.s.commit()
        if verdict in ("block", "review"):
            self.auto_flag(f"short:{short_id}", short.get("userId"), "nudity",
                           f"automatic check (moderator device): {round(scan['nsfw'] * 100)}% explicit", hide=True)
        return {"ok": True, "verdict": verdict}

    # ----- comments -----
    def add_comment(self, user, body):
        self.ensure_active(user)
        short_id = text_field(body, "shortId", 40)
        text = text_field(body, "text", 500)
        self.ensure_clean(text, "comment")
        self.throttle(user, "comment")
        self.spam_check(user, text, "comment")
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short or self.is_hidden("short", short_id):
                raise ApiError(404, "short not found")
            comment = {
                "id": new_id("cm_"), "shortId": short_id, "userId": user["id"], "name": user["name"],
                "hue": user.get("hue", 200), "text": text, "createdAt": now_ts(),
            }
            self.s.put("comment", comment["id"], comment)
            self.s.commit()
        if short.get("userId") and short["userId"] != user["id"]:
            self.notify(short["userId"], f"{user['name']} commented", text[:120], "/user/me",
                        ref=f"comment:{comment['id']}", actor=user["id"])
        return {"comment": comment}

    def delete_comment(self, user, comment_id):
        with self.s.lock:
            comment = self.s.get("comment", comment_id)
            if not comment:
                raise ApiError(404, "comment not found")
            short = self.s.get("short", comment["shortId"]) or {}
            if user["id"] not in (comment["userId"], short.get("userId")) and not self.is_admin(user):
                raise ApiError(403, "You can only delete your own comments or comments on your shorts")
            self.s.delete("comment", comment_id)
            self.s.commit()
        self.recall(lambda n: n.get("ref") == f"comment:{comment_id}")
        return {"ok": True}

    def visible_comments(self, user, short_ids):
        mod = self.mod_doc()
        out = []
        for comment in self.s.all("comment"):
            if comment["shortId"] not in short_ids or f"comment:{comment['id']}" in mod["hidden"] or comment["userId"] in mod["banned"]:
                continue
            out.append({
                "id": comment["id"], "shortId": comment["shortId"], "by": comment["userId"], "name": comment["name"],
                "hue": comment.get("hue", 200), "text": comment["text"], "at": comment["createdAt"],
                "mine": comment["userId"] == user["id"],
            })
        return sorted(out, key=lambda c: c["at"])

    # ----- push notifications -----
    @staticmethod
    def new_topic():
        return f"fade-{secrets.token_hex(10)}"

    def notify(self, user_id, title, message, click="/", tags=None, seq=None, ref=None, actor=None):
        """In-app notification + ntfy push to the user's private topic (non-blocking).

        Every push carries an ntfy sequence id: a later push with the same `seq` replaces it on the phone,
        and recall() deletes it from the phone (ntfy message_delete) when the thing it was about goes away.
        """
        if not user_id:
            return None
        recipient = self.s.get("user", user_id)
        if not recipient or recipient.get("seed"):
            return None
        doc = {
            "id": new_id("nt"), "userId": user_id, "title": title[:120], "message": message[:300],
            "click": click, "createdAt": now_ts(), "read": False,
            "seq": re.sub(r"[^A-Za-z0-9_-]", "", seq or "")[:60] or None, "ref": ref, "actor": actor,
        }
        doc["seq"] = doc["seq"] or doc["id"]
        with self.s.lock:
            for older in self.s.all("notif"):  # same sequence = same notification, updated
                if older["userId"] == user_id and older.get("seq") == doc["seq"]:
                    self.s.delete("notif", older["id"])
            self.s.put("notif", doc["id"], doc)
            self.s.commit()
        topic = recipient.get("notify")
        if self.ntfy and topic and recipient.get("pushOn", True):
            private = recipient.get("pushPreview", "private") != "full"
            payload = {
                "topic": topic, "sequence_id": doc["seq"],
                "title": "Fade" if private else doc["title"],
                "message": f"{self.private_label(doc)} — open Fade to see it" if private else doc["message"],
                "tags": ["scissors"] if private else (tags or ["scissors"]),
            }
            if self.public_url:
                payload["click"] = f"{self.public_url}/#{click}"
            threading.Thread(target=self._send_push, args=(payload,), daemon=True).start()
        return doc

    @staticmethod
    def private_label(doc):
        """What a content-free push says: only the kind of notification, never names, text or places."""
        prefix = (doc.get("seq") or "").split("-", 1)[0]
        ref_kind = (doc.get("ref") or "").split(":", 1)[0]
        return PRIVATE_PUSH_LABELS.get(prefix) or PRIVATE_PUSH_LABELS.get(ref_kind) or "New notification"

    def _ntfy_call(self, method, url, data=None, kind="push", topic="", title=""):
        headers = {"Content-Type": "application/json"} if data is not None else {}
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        status = 0
        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                status = response.status
        except Exception as err:  # network errors must never break the app
            status = getattr(err, "code", -1)
        self.push_log.append({"kind": kind, "topic": topic, "title": title, "status": status, "t": now_ts(), "url": url})
        del self.push_log[:-300]
        return status

    def _send_push(self, payload):
        self._ntfy_call("POST", self.ntfy, json.dumps(payload).encode("utf-8"), "push", payload["topic"], payload["title"])

    def recall(self, predicate, remove=True):
        """Delete matching pushes from every subscribed device (ntfy DELETE /<topic>/<sequence_id>)."""
        targets = []
        with self.s.lock:
            for notif in self.s.all("notif"):
                if not predicate(notif):
                    continue
                recipient = self.s.get("user", notif["userId"]) or {}
                if recipient.get("notify"):
                    targets.append((recipient["notify"], notif.get("seq") or notif["id"]))
                if remove:
                    self.s.delete("notif", notif["id"])
            self.s.commit()
        if self.ntfy and targets:
            threading.Thread(target=self._recall_many, args=(targets, "DELETE", "recall"), daemon=True).start()
        return len(targets)

    def _recall_many(self, targets, method, kind):
        for topic, seq in targets:
            suffix = "/clear" if kind == "clear" else ""
            self._ntfy_call(method, f"{self.ntfy}/{topic}/{seq}{suffix}", None, kind, topic)

    def notifications_for(self, user):
        mine = [n for n in self.s.all("notif") if n["userId"] == user["id"]]
        return sorted(mine, key=lambda n: -n["createdAt"])[:50]

    def mark_read(self, user):
        """Read in the app = cleared from the phone's notification drawer too (ntfy PUT .../clear)."""
        cleared = []
        with self.s.lock:
            for notif in self.s.all("notif"):
                if notif["userId"] == user["id"] and not notif["read"]:
                    notif["read"] = True
                    self.s.put("notif", notif["id"], notif)
                    cleared.append(notif.get("seq") or notif["id"])
            self.s.commit()
        fresh = self.s.get("user", user["id"]) or {}
        if self.ntfy and cleared and fresh.get("notify"):
            targets = [(fresh["notify"], seq) for seq in cleared]
            threading.Thread(target=self._recall_many, args=(targets, "PUT", "clear"), daemon=True).start()
        return {"ok": True, "cleared": len(cleared)}

    def recall_mine(self, user):
        """'Remove Fade notifications from my devices': deletes every recent push (and empties the feed)."""
        count = self.recall(lambda n: n["userId"] == user["id"])
        return {"ok": True, "recalled": count}

    def update_push(self, user, body):
        old_topic = None
        with self.s.lock:
            fresh = self.s.get("user", user["id"])
            if body.get("rotate"):
                old_topic = fresh.get("notify")
                fresh["notify"] = self.new_topic()
            if "pushOn" in body:
                fresh["pushOn"] = bool(body["pushOn"])
            if body.get("preview") in ("full", "private"):
                fresh["pushPreview"] = body["preview"]
            self.save_user(fresh)
            self.s.commit()
        if old_topic and self.ntfy:  # anything sent to the old topic is deleted from devices still subscribed
            seqs = [(old_topic, n.get("seq") or n["id"]) for n in self.notifications_for(fresh)]
            threading.Thread(target=self._recall_many, args=(seqs, "DELETE", "recall"), daemon=True).start()
        return {"notify": fresh["notify"], "pushOn": fresh.get("pushOn", True), "pushPreview": fresh.get("pushPreview", "private")}

    def booking_parties(self, booking):
        barber = self.s.get("barber", booking["barberId"]) or {}
        place = self.s.get("place", booking["placeId"]) or {}
        return barber, place

    def sweep(self):
        """Background duties: 2 h reminders (sent at the right time, so reschedules/cancels stay correct)."""
        now = datetime.now(timezone.utc)
        due = []
        with self.s.lock:
            for booking in self.s.all("booking"):
                if booking.get("status") != "upcoming" or booking.get("reminded"):
                    continue
                place = self.s.get("place", booking["placeId"])
                if not place:
                    continue
                start = booking_start_utc(booking, place)
                if start - timedelta(hours=REMINDER_LEAD_HOURS) <= now < start:
                    booking["reminded"] = True
                    self.s.put("booking", booking["id"], booking)
                    due.append((booking, place))
            if due:
                self.s.commit()
        for booking, place in due:
            barber = self.s.get("barber", booking["barberId"]) or {}
            when = f"{int(booking['time']):02d}:{int(round((booking['time'] % 1) * 60)):02d}"
            self.notify(booking["userId"], "Your cut is in 2 hours ✂️",
                        f"{booking['serviceName']} with {barber.get('name', 'your barber')} at {place.get('name', '')}, {when}", "/bookings",
                        ["alarm_clock"], seq=f"rm-{booking['id']}-c", ref=f"booking:{booking['id']}")
            if barber.get("ownerId"):
                self.notify(barber["ownerId"], "Client in 2 hours", f"{booking['customerName']} · {booking['serviceName']} at {when}", "/pro",
                            ["alarm_clock"], seq=f"rm-{booking['id']}-b", ref=f"booking:{booking['id']}")
        self.retry_held_checks()
        return len(due)

    def start_sweeper(self):
        def loop():
            while True:
                time.sleep(SWEEP_SECONDS)
                try:
                    self.sweep()
                except Exception:  # pragma: no cover - keep the loop alive
                    pass
        threading.Thread(target=loop, daemon=True).start()

    # ----- server-side checks (don't depend on the uploader's app being honest) -----
    def verify_media(self, short_id):
        """Run every server check on a stored upload, then release it (or keep it held)."""
        with self.verify_lock:
            if short_id in self.verifying_now:
                return None
            self.verifying_now.add(short_id)
        hook = None
        try:
            for check in (self.server_scan, self.hook_check, self.hash_and_match):
                try:
                    result = check(short_id)
                except Exception as err:  # one failing check must not leave the upload hidden forever
                    result = "pending" if check == self.hook_check else None
                    self.hook_log.append({"kind": "check-error", "check": check.__name__, "short": short_id,
                                          "error": str(err)[:200], "t": now_ts()})
                if check == self.hook_check:
                    hook = result
            return hook
        finally:
            self.release(short_id, hold=hook == "pending")
            with self.verify_lock:
                self.verifying_now.discard(short_id)

    def release(self, short_id, hold=False):
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                return
            media = short["media"]
            if hold:
                media["verifying"] = True
            else:
                media.pop("verifying", None)
            media["checkedAt"] = now_ts()
            self.s.put("short", short_id, short)
            self.s.commit()

    def server_scan(self, short_id):
        """Classify the stored file with the server's own copy of the model. Its verdict replaces the app's."""
        if not self.server_scan_ready():
            return None
        short = self.s.get("short", short_id)
        if not short:
            return None
        path = self.s.media_dir / Path(short["media"]["url"]).name
        if not path.exists():
            return None
        try:
            result = self.scanner.scan_file(self.ffmpeg, path, short["media"]["kind"])
        except Exception as err:  # a broken file or decoder must not crash the server
            result = None
            self.hook_log.append({"kind": "scan-error", "short": short_id, "error": str(err)[:200], "t": now_ts()})
        if not result:
            return None
        verdict = scan_verdict(result)
        client = short["media"].get("scan")
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                return None
            short["media"]["serverScan"] = result
            short["media"]["scanVerdict"] = verdict
            short["media"]["scanBy"] = "server"
            self.s.put("short", short_id, short)
            self.s.commit()
        mismatch = bool(client) and scan_verdict(client) == "ok" and verdict in ("review", "block") \
            and result["nsfw"] - client["nsfw"] >= SCAN_MISMATCH_MARGIN
        if verdict in ("review", "block"):
            note = (f"server check: {round(result['nsfw'] * 100)}% explicit, {round(result['sexy'] * 100)}% suggestive "
                    f"over {result['frames']} frame{'s' if result['frames'] != 1 else ''}")
            if mismatch:
                note += f" — the uploader's app reported {round(client['nsfw'] * 100)}%"
            elif not client:
                note += " — uploaded without the app's own check"
            self.auto_flag(f"short:{short_id}", short.get("userId"), "nudity", note, hide=True)
        if mismatch:
            self.flag_mismatch(short.get("userId"), short_id)
        return verdict

    def flag_mismatch(self, user_id, short_id):
        """An upload the app called clean that the server finds explicit: likely a modified app. Tell moderators."""
        if not user_id:
            return
        with self.s.lock:
            user = self.s.get("user", user_id)
            if not user:
                return
            user["scanMismatches"] = int(user.get("scanMismatches") or 0) + 1
            count = user["scanMismatches"]
            self.save_user(user)
            self.s.commit()
        self.auto_flag(f"user:{user_id}", user_id, "other",
                       f"{count} upload{'s' if count > 1 else ''} didn't match the app's own safety check "
                       f"(latest: short {short_id}) — possibly a modified app", hide=False)

    def hook_check(self, short_id):
        """POST the stored file to the operator's external checker (--scan-hook).

        Request: the raw file, Content-Type of the upload, headers X-Fade-Short / X-Fade-Kind / X-Fade-Sha256 /
        X-Fade-User. Response JSON: {"action": "allow"|"review"|"block", "reason": "...", "labels": [...]}.
        Unreachable checker -> the upload stays held and is retried every minute ("pending")."""
        if not self.scan_hook:
            return "skip"
        short = self.s.get("short", short_id)
        if not short:
            return "skip"
        path = self.s.media_dir / Path(short["media"]["url"]).name
        if not path.exists():
            return "skip"
        data = path.read_bytes()
        headers = {
            "Content-Type": short["media"].get("type") or "application/octet-stream",
            "X-Fade-Short": short_id, "X-Fade-Kind": short["media"]["kind"],
            "X-Fade-Sha256": hashlib.sha256(data).hexdigest(), "X-Fade-User": short.get("userId") or "",
            "User-Agent": f"Fade/{APP_VERSION}",
        }
        answer = None
        error = None
        try:
            request = urllib.request.Request(self.scan_hook, data=data, method="POST", headers=headers)
            with urllib.request.urlopen(request, timeout=HOOK_TIMEOUT_S) as response:
                answer = json.loads(response.read(65536).decode("utf-8") or "{}")
            if not isinstance(answer, dict) or answer.get("action") not in HOOK_ACTIONS:
                raise ValueError(f"unexpected answer {str(answer)[:80]}")
        except Exception as err:
            error = str(getattr(err, "reason", None) or err)[:200]
        self.hook_log.append({"kind": "hook", "short": short_id, "action": (answer or {}).get("action"), "error": error, "t": now_ts()})
        del self.hook_log[:-300]
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                return "skip"
            media = short["media"]
            if error:
                media["hookAttempts"] = int(media.get("hookAttempts") or 0) + 1
                media["hookError"] = error
                attempts = media["hookAttempts"]
            else:
                labels = [str(label)[:40].lower() for label in (answer.get("labels") or []) if label][:10]
                media["hook"] = {"action": answer["action"], "reason": str(answer.get("reason") or "")[:200], "labels": labels}
                media.pop("hookAttempts", None)
                media.pop("hookError", None)
            self.s.put("short", short_id, short)
            self.s.commit()
        if error:
            if attempts == HOOK_ALERT_AFTER:
                self.auto_flag(f"short:{short_id}", short.get("userId"), "other",
                               f"external safety check unreachable ({error}) — the upload stays hidden until it answers", hide=False)
            return "pending"
        action = answer["action"]
        reason = media["hook"]["reason"]
        labels = media["hook"]["labels"]
        severe = any(word in " ".join(labels + [reason.lower()]) for word in HOOK_SEVERE_LABELS)
        if action in ("review", "block"):
            note = f"external check: {action}" + (f" · {reason}" if reason else "") + (f" · {', '.join(labels)}" if labels else "")
            category = "violence" if "violence" in labels or "gore" in labels else "nudity" if action == "block" or severe else "other"
            self.auto_flag(f"short:{short_id}", short.get("userId"), category, note, hide=True)
        if severe and action == "block":
            self.emergency_ban(short.get("userId"), short_id)
        return action

    def emergency_ban(self, user_id, short_id):
        """External checker matched child-abuse material: suspend the account at once, block the media's hashes
        everywhere, keep the file as evidence for the operator's legal report (it is never shown again)."""
        if not user_id:
            return
        with self.s.lock:
            mod = self.mod_doc()
            mod["banned"][user_id] = now_ts()
            short = self.s.get("short", short_id)
            if short:
                short["media"]["evidenceHold"] = True
                self.s.put("short", short_id, short)
                self.block_hashes(mod, short, f"short:{short_id}")
            self.s.put("meta", "mod", mod)
            self.s.db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self.s.commit()
        self.recall(lambda n: n.get("actor") == user_id)
        self.alert_admins(f"short:{short_id}", "URGENT · external checker matched child-abuse material — account suspended, evidence kept")

    def retry_held_checks(self):
        """Sweeper: re-run the external check for uploads still held because the checker was unreachable."""
        for short in self.s.all("short"):
            media = short.get("media") or {}
            if media.get("verifying") and media.get("hookError") and not media.get("processing"):
                threading.Thread(target=self.verify_media, args=(short["id"],), daemon=True).start()

    # ----- automatic media checks -----
    def screen_upload(self, user, meta):
        """Upload-time policy from the on-device scan (explicit uploads never reach the server's disk)."""
        scan = scan_numbers(meta.get("scan"))
        verdict = scan_verdict(scan)
        if verdict == "block":
            raise ApiError(422, "This looks like nudity or sexual content, which isn't allowed on Fade")
        return scan, verdict

    def media_hashes(self, path, kind):
        """dHash of up to 3 frames (start, middle, end of the first 60 s) via ffmpeg."""
        if not self.ffmpeg:
            return []
        stamps = [None] if kind == "image" else [0.5, 3, 8]
        out = []
        for stamp in stamps:
            command = [self.ffmpeg, "-hide_banner", "-loglevel", "error"]
            if stamp is not None:
                command += ["-ss", str(stamp)]
            command += ["-i", str(path), "-frames:v", "1", "-vf", "scale=9:8:flags=area,format=gray", "-f", "rawvideo", "-"]
            try:
                result = subprocess.run(command, capture_output=True, timeout=60)
            except (OSError, subprocess.TimeoutExpired):
                continue
            if result.returncode == 0 and len(result.stdout) >= 72:
                value = dhash_bits(result.stdout[:72])
                if value not in out:
                    out.append(value)
        return out

    def hash_and_match(self, short_id):
        """Hash the stored media; block it automatically if it matches media moderators removed."""
        short = self.s.get("short", short_id)
        if not short:
            return None
        path = self.s.media_dir / Path(short["media"]["url"]).name
        hashes = self.media_hashes(path, short["media"]["kind"]) if path.exists() else []
        if not hashes and short["media"].get("clientHash"):
            hashes = [short["media"]["clientHash"]]
        match = None
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                return None
            short["media"]["phash"] = hashes
            self.s.put("short", short_id, short)
            mod = self.mod_doc()
            for value in hashes:
                for blocked, info in mod["phash"].items():
                    if info.get("target") != f"short:{short_id}" and hamming(value, blocked) <= PHASH_MATCH_BITS:
                        match = info
                        break
                for blocked, label in self.external_hashes.items():
                    if not match and hamming(value, blocked) <= PHASH_MATCH_BITS:
                        match = {"target": f"hash list: {label}", "external": True}
                if match:
                    break
            self.s.commit()
        if match and match.get("external"):
            self.auto_flag(f"short:{short_id}", short.get("userId"), "other",
                           f"matches the server's blocked-media list ({match['target']})", hide=True)
        elif match:
            self.auto_flag(f"short:{short_id}", short.get("userId"), "spam",
                           f"re-upload of removed content ({match.get('target')})", hide=True)
        return hashes

    # ----- video transcoding (ffmpeg, downloaded automatically when missing) -----
    def queue_transcode(self, short):
        threading.Thread(target=self._transcode, args=(short["id"],), daemon=True).start()

    def _transcode(self, short_id):
        short = self.s.get("short", short_id)
        if not short:
            return
        source = self.s.media_dir / Path(short["media"]["url"]).name
        target = self.s.media_dir / f"{short_id}_720.mp4"
        poster = self.s.media_dir / f"{short_id}.jpg"
        scale = (f"scale='min({TRANSCODE_MAX_W},iw)':'min({TRANSCODE_MAX_H},ih)':force_original_aspect_ratio=decrease,"
                 "scale=trunc(iw/2)*2:trunc(ih/2)*2")
        command = [
            self.ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-i", str(source), "-t", str(TRANSCODE_MAX_SECONDS),
            "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "2500k", "-bufsize", "5000k",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(target),
        ]
        error = None
        try:
            result = subprocess.run(command, capture_output=True, timeout=TRANSCODE_TIMEOUT_S)
            if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
                error = (result.stderr or b"").decode("utf-8", "replace")[-300:] or "ffmpeg failed"
            elif not short["media"].get("poster"):
                subprocess.run([self.ffmpeg, "-y", "-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", str(target),
                                "-frames:v", "1", "-vf", "scale=360:-2", str(poster)], capture_output=True, timeout=60)
        except (OSError, subprocess.TimeoutExpired) as err:
            error = str(err)
        with self.s.lock:
            short = self.s.get("short", short_id)
            if not short:
                return
            media = short["media"]
            media["processing"] = False
            if error:
                media["transcodeError"] = error
                target.unlink(missing_ok=True)
            else:
                if source != target:
                    source.unlink(missing_ok=True)
                media.update({"url": f"/media/{target.name}", "type": "video/mp4", "transcoded": True})
                if not media.get("poster") and poster.exists():
                    media["poster"] = f"/media/{poster.name}"
            self.s.put("short", short_id, short)
            self.s.commit()
        self.verify_media(short_id)


class Fade(SafetyMixin):
    def __init__(self, store: Store, **safety):
        self.s = store
        self.auth_hits = {}
        self.setup_safety(**safety)

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
        self.ensure_clean(name, "name")
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
                "notify": self.new_topic(), "pushOn": True,
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
        when = f"{key} {int(t):02d}:{int(round((t % 1) * 60)):02d}"
        ref = f"booking:{booking['id']}"
        self.notify(user["id"], "You're booked ✂️", f"{service['name']} with {barber['name']} · {when}", "/bookings",
                    seq=f"bk-{booking['id']}-c", ref=ref)
        if barber.get("ownerId"):
            self.notify(barber["ownerId"], "New booking ✂️", f"{user['name']} · {service['name']} · {when}", "/pro",
                        seq=f"bk-{booking['id']}-b", ref=ref, actor=user["id"])
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
        barber = self.s.get("barber", booking["barberId"]) or {}
        # the customer's own booking/reminder pushes vanish; the barber's "New booking" push becomes "cancelled"
        self.recall(lambda n: n.get("ref") == f"booking:{booking_id}"
                    and (n["userId"] == user["id"] or str(n.get("seq", "")).startswith("rm-")))
        if barber.get("ownerId"):
            self.notify(barber["ownerId"], "Booking cancelled", f"{user['name']} cancelled {booking['serviceName']} on {booking['date']}", "/pro",
                        seq=f"bk-{booking_id}-b", ref=f"booking:{booking_id}", actor=user["id"])
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
            booking.update({"date": key, "time": t, "placeId": place_id, "reminded": False})
            self.s.put("booking", booking["id"], booking)
            self.s.commit()
        # reminders for the old time are taken back; the new time gets fresh ones from the sweeper
        self.recall(lambda n: n.get("ref") == f"booking:{booking_id}" and str(n.get("seq", "")).startswith("rm-"))
        if barber.get("ownerId"):
            self.notify(barber["ownerId"], "Booking moved", f"{user['name']} moved {booking['serviceName']} to {key}", "/pro",
                        seq=f"bk-{booking_id}-b", ref=f"booking:{booking_id}", actor=user["id"])
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
                self.notify(commission["creatorId"], "Commission earned 💸", f"${commission['amount']:.2f} from a booking your short sent", "/creator")
        self.s.put("booking", booking["id"], booking)

    def barber_complete(self, user, booking_id):
        with self.s.lock:
            booking = self.owned_booking(user, booking_id, as_barber=True)
            if booking["status"] != "upcoming":
                raise ApiError(400, "Booking is not upcoming")
            self.complete(booking, "Paid at shop")
            self.s.commit()
        self.recall(lambda n: n.get("ref") == f"booking:{booking_id}" and str(n.get("seq", "")).startswith("rm-"))
        self.notify(booking["userId"], "How was your cut? ⭐", f"Rate {booking['serviceName']} and leave a tip if you like", "/bookings",
                    seq=f"bk-{booking_id}-c", ref=f"booking:{booking_id}")
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
        self.ensure_active(user)
        if content_type not in UPLOAD_TYPES:
            raise ApiError(415, "Upload an MP4, WebM, MOV, JPG, PNG or WebP")
        if not data:
            raise ApiError(400, "empty upload")
        caption = text_field(meta, "caption", 300)
        self.ensure_clean(caption, "caption")
        scan, verdict = self.screen_upload(user, meta)
        self.throttle(user, "upload")
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
                      "duration": meta.get("duration"), "optimized": bool(meta.get("optimized")),
                      "scan": scan, "scanVerdict": verdict,
                      "clientHash": meta["phash"] if re.fullmatch(r"[0-9a-f]{16}", str(meta.get("phash") or "")) else None},
            "likes": 0, "views": 0, "shares": 0, "conversions": 0, "likedBy": [], "createdAt": now_ts(),
        }
        transcode = short["media"]["kind"] == "video" and bool(self.ffmpeg) and not meta.get("optimized")
        if transcode:
            short["media"]["processing"] = True
        held = self.server_checks_active()
        if held:  # nobody else sees it until the server has checked the file itself (a few seconds)
            short["media"]["verifying"] = True
        with self.s.lock:
            self.s.put("short", short_id, short)
            self.s.commit()
        if transcode:
            self.queue_transcode(short)  # verifies the result when done
        else:
            threading.Thread(target=self.verify_media, args=(short_id,), daemon=True).start()
        if verdict == "review":
            self.auto_flag(f"short:{short_id}", user["id"], "nudity",
                           f"automatic check: {round(scan['nsfw'] * 100)}% explicit, {round(scan['sexy'] * 100)}% suggestive", hide=True)
        for tag in tags:
            owner = self.tag_owner(tag)
            if tag["status"] == "pending" and owner:
                self.notify(owner, "You were tagged in a short", f"{user['name']} tagged you ({tag['kind']}) — approve it in Fade", "/pro",
                            ref=f"short:{short_id}", actor=user["id"])
        short = self.s.get("short", short_id) or short
        return {"short": self.public_short(short, user), "scan": verdict, "checking": held}

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
            comment_refs = {f"comment:{c['id']}" for c in self.s.all("comment") if c["shortId"] == short_id}
            self.s.delete("short", short_id)
            self.s.commit()
        self.recall(lambda n: n.get("ref") == f"short:{short_id}" or n.get("ref") in comment_refs)
        return {"ok": True}

    def public_short(self, short, user, comment_counts=None):
        doc = {key: value for key, value in short.items() if key != "likedBy"}
        if isinstance(doc.get("media"), dict):  # perceptual hashes stay on the server
            doc["media"] = {k: v for k, v in doc["media"].items()
                            if k not in ("phash", "clientHash", "hook", "hookError", "hookAttempts", "evidenceHold")}
        doc["likedByMe"] = bool(user) and user["id"] in short.get("likedBy", [])
        doc["ownerPk"] = short.get("userId")
        if comment_counts is not None:
            doc["comments"] = comment_counts.get(short["id"], 0)
        if self.is_hidden("short", short["id"]):
            doc["hidden"] = True
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
        self.notify(commission["creatorId"], "Your short sent a booking 🔥", f"${commission['amount']:.2f} commission pending until the cut is done", "/creator")
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
        self.ensure_active(user)
        text = text_field(body, "text", 1000)
        self.ensure_clean(text, "message")
        self.throttle(user, "message")
        self.spam_check(user, text, "message")
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
        if thread["type"] == "dm":
            barber = self.s.get("barber", thread["barberId"]) or {}
            recipient = thread["userId"] if is_barber_side else barber.get("ownerId")
            if recipient and recipient != user["id"]:
                self.notify(recipient, f"Message from {user['name']}", text[:120], "/chat",
                            seq=f"dm-{thread_id}", ref=f"thread:{thread_id}", actor=user["id"])
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
        mod = self.mod_doc()
        admin = self.is_admin(user)
        if not user.get("notify"):
            with self.s.lock:
                user["notify"] = self.new_topic()
                self.save_user(user)
                self.s.commit()
        shorts = [s for s in self.s.all("short")
                  if s.get("userId") == user["id"] or admin
                  or (f"short:{s['id']}" not in mod["hidden"] and s.get("userId") not in mod["banned"]
                      and not (s.get("media") or {}).get("verifying"))]
        shorts = sorted(shorts, key=lambda s: -s["createdAt"])[:300]
        comments = self.visible_comments(user, {s["id"] for s in shorts})
        comment_counts = {}
        for comment in comments:
            comment_counts[comment["shortId"]] = comment_counts.get(comment["shortId"], 0) + 1
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
        private["admin"] = admin
        private["suspended"] = user["id"] in mod["banned"]
        private.setdefault("pushPreview", "private")
        private["followers"] = user.get("followers", 0) + counts.get(f"user:{user['id']}", 0)
        return {
            "server": {"app": APP_NAME, "version": APP_VERSION, "time": now_ts(), "ntfy": self.ntfy or "",
                       "push": bool(self.ntfy), "recall": bool(self.ntfy), "transcode": bool(self.ffmpeg),
                       "ffmpeg": self.ffmpeg_status, "phash": bool(self.ffmpeg),
                       "scan": {"block": SCAN_BLOCK, "review": SCAN_REVIEW, "reviewSexy": SCAN_REVIEW_SEXY},
                       "verify": {"classifier": self.scan_status, "active": self.server_scan_ready(),
                                  "hook": bool(self.scan_hook), "hashList": len(self.external_hashes)}},
            "user": private,
            "barbers": sorted(barbers, key=lambda b: b["id"]),
            "places": sorted(places, key=lambda p: p["id"]),
            "products": sorted(self.s.all("product"), key=lambda p: p["id"]),
            "bookings": bookings,
            "txns": sorted([t for t in self.s.all("txn") if t["userId"] == user["id"]], key=lambda t: t["date"], reverse=True)[:100],
            "orders": [o for o in self.s.all("order") if o["userId"] == user["id"]],
            "threads": threads,
            "shorts": [self.public_short(s, user, comment_counts) for s in shorts],
            "comments": comments,
            "notifications": self.notifications_for(user),
            "moderation": {"isAdmin": admin, "openReports": sum(1 for r in self.s.all("report") if r["status"] == "open") if admin else 0},
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


@route("POST", r"/api/report")
def r_report(app, req, user, m):
    return app.report(user, req.json())


@route("GET", r"/api/mod")
def r_mod_queue(app, req, user, m):
    return app.mod_queue(user)


@route("POST", r"/api/mod")
def r_moderate(app, req, user, m):
    return app.moderate(user, req.json())


@route("POST", r"/api/comments")
def r_comment(app, req, user, m):
    return app.add_comment(user, req.json())


@route("DELETE", r"/api/comments/([\w-]+)")
def r_delete_comment(app, req, user, m):
    return app.delete_comment(user, m.group(1))


@route("GET", r"/api/notifications")
def r_notifications(app, req, user, m):
    return {"notifications": app.notifications_for(user)}


@route("POST", r"/api/notifications/read")
def r_notifications_read(app, req, user, m):
    return app.mark_read(user)


@route("POST", r"/api/notifications/recall")
def r_notifications_recall(app, req, user, m):
    return app.recall_mine(user)


@route("PUT", r"/api/me/push")
def r_push_settings(app, req, user, m):
    return app.update_push(user, req.json())


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
                if user and method != "GET" and not path.endswith("/auth/logout") and self.app.is_banned(user):
                    raise ApiError(403, "This account is suspended for breaking the community guidelines")
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


def make_server(host, port, data_dir, quiet=False, admins=(), ntfy=None, public_url="", ffmpeg="off", sweeper=False,
                scan="off", scan_hook=None, hash_list=None):
    store = Store(Path(data_dir))
    Handler.app = Fade(store, admins=admins, ntfy=ntfy, public_url=public_url, ffmpeg=ffmpeg,
                       scan=scan, scan_hook=scan_hook, hash_list=hash_list)
    Handler.quiet = quiet
    if sweeper:
        Handler.app.start_sweeper()
    return ThreadingHTTPServer((host, port), Handler)


def main():
    parser = argparse.ArgumentParser(description="Fade backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--data", default=os.environ.get("FADE_DATA") or str(BASE_DIR / "data"))
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--admin", action="append", default=[], metavar="EMAIL",
                        help="moderator account email (repeatable; also FADE_ADMINS=a@x,b@y)")
    parser.add_argument("--ntfy", default=os.environ.get("FADE_NTFY", "https://ntfy.sh"),
                        help="ntfy server for push notifications ('off' to disable)")
    parser.add_argument("--public-url", default=os.environ.get("FADE_PUBLIC_URL", ""),
                        help="public https URL of this server, used for links in push notifications")
    parser.add_argument("--ffmpeg", default=os.environ.get("FADE_FFMPEG", "auto"),
                        help="ffmpeg for transcoding + re-upload blocking: 'auto' = PATH, else download a verified "
                             "static build once into <data>/bin; 'fetch' = always use the download; a path; or 'off'")
    parser.add_argument("--scan", default=os.environ.get("FADE_SCAN", "auto"), choices=("auto", "local", "off"),
                        help="server-side copy of the apps' safety check (needs ffmpeg + numpy): 'auto' fetches numpy into "
                             "<data>/pylib if missing, 'local' only uses an installed numpy, 'off' trusts the apps' checks")
    parser.add_argument("--scan-hook", default=os.environ.get("FADE_SCAN_HOOK", ""), metavar="URL",
                        help="external checker that gets every upload (e.g. a CSAM hash-matching or violence service); "
                             "answers {\"action\": \"allow|review|block\"}; uploads stay hidden while it is unreachable")
    parser.add_argument("--hash-list", default=os.environ.get("FADE_HASH_LIST", ""), metavar="FILE",
                        help="extra blocked media: one 16-hex dHash per line (optional label after it)")
    args = parser.parse_args()
    admins = args.admin + [e for e in os.environ.get("FADE_ADMINS", "").split(",") if e.strip()]
    ntfy = None if args.ntfy.lower() == "off" else args.ntfy
    server = make_server(args.host, args.port, args.data, args.quiet, admins=admins, ntfy=ntfy,
                         public_url=args.public_url, ffmpeg=args.ffmpeg, sweeper=True,
                         scan=args.scan, scan_hook=args.scan_hook or None, hash_list=args.hash_list or None)
    app = Handler.app
    print(f"Fade {APP_VERSION} running on http://{args.host}:{args.port}/  (data: {args.data})")
    print(f"  moderators: {', '.join(sorted(app.admins)) or 'none (add --admin you@example.com)'}")
    ffmpeg_note = {"downloading": "downloading a verified static ffmpeg in the background…", "off": "off"}.get(app.ffmpeg_status, app.ffmpeg or app.ffmpeg_status)
    print(f"  push: {app.ntfy or 'off'} (content-free unless a user opts in · updatable + recallable) · transcoding: {ffmpeg_note}")
    checks = [f"classifier {app.scan_status}"]
    if app.scan_hook:
        checks.append(f"external hook {app.scan_hook}")
    if app.external_hashes:
        checks.append(f"{len(app.external_hashes)} listed hashes")
    print(f"  server checks: {' · '.join(checks)}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
