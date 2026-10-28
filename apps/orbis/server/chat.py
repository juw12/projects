"""Orbis Chat: multi-user, real-time messaging backend.

Standard library only (Python 3.9+). Mounted by ``server.py`` under
``/api/chat/``. Provides:

* Accounts: email + password sign-up/sign-in, bearer-token sessions,
  password change, password reset by emailed code, account deletion.
* Teams: create, invite by email or shareable link, roles, channels.
* Conversations: direct messages, group chats and team channels.
* Messages: send, edit, delete, reply, emoji reactions, attachments,
  read receipts, typing indicators, full-text search.
* Real time: Server-Sent Events stream per signed-in device, presence.
* Push: standards-based Web Push (VAPID, RFC 8291/8292) so phones and
  desktops get alerts even when Orbis is fully closed.
* Email: SMTP when configured (invites, password reset, offline message
  notifications for people without push); otherwise a local outbox folder.

Configuration (environment variables, all optional):

    ORBIS_SMTP_HOST, ORBIS_SMTP_PORT (587), ORBIS_SMTP_USER,
    ORBIS_SMTP_PASSWORD, ORBIS_SMTP_FROM, ORBIS_SMTP_SSL=1 (port 465 SSL)
    ORBIS_PUBLIC_URL     public base URL used in emailed links
    ORBIS_ALLOW_SIGNUP   "0" to make the server invite-only
    ORBIS_TRUST_PROXY    "1" to read client IP from X-Forwarded-For
    ORBIS_PBKDF2_ITERATIONS  password hashing cost (default 210000)
    ORBIS_VAPID_PRIVATE_KEY  base64url P-256 key for Web Push (auto-generated
                             and stored in the database when unset)
    ORBIS_VAPID_SUBJECT      contact for push services (mailto: or https:)
    ORBIS_PUSH_EXTRA_HOSTS   extra allowed push endpoint hosts (testing)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import smtplib
import sqlite3
import threading
import time
import traceback
from email.message import EmailMessage
from email.utils import parseaddr
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote

import webpush

# ---------------------------------------------------------------------------
# Limits and constants
# ---------------------------------------------------------------------------

MAX_JSON_BYTES = 256 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_MESSAGE_CHARS = 4000
SESSION_DAYS = 60
INVITE_DAYS = 7
RESET_MINUTES = 30
PAGE_SIZE = 50
HEARTBEAT_SECONDS = 20
EMAIL_NOTIFY_COOLDOWN_MS = 10 * 60 * 1000
TYPING_RELAY_MIN_MS = 1500

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
PALETTE = ["#4F46E5", "#0D9488", "#DB2777", "#EA580C", "#2563EB",
           "#7C3AED", "#059669", "#DC2626", "#0891B2", "#CA8A04"]
ROLES = ("owner", "admin", "member")
INLINE_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#4F46E5',
    email_notify INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE TABLE IF NOT EXISTS chat_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_team_members (
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS chat_invites (
    code TEXT PRIMARY KEY,
    team_id INTEGER,
    email TEXT,
    invited_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_invites_email ON chat_invites(email);
CREATE TABLE IF NOT EXISTS chat_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    team_id INTEGER,
    is_default INTEGER NOT NULL DEFAULT 0,
    direct_key TEXT UNIQUE,
    created_by INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    last_message_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_team ON chat_conversations(team_id);
CREATE TABLE IF NOT EXISTS chat_members (
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    last_read_id INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    body TEXT NOT NULL DEFAULT '',
    reply_to INTEGER,
    attachment TEXT,
    client_id TEXT,
    created_at INTEGER NOT NULL,
    edited_at INTEGER,
    deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, id);
CREATE TABLE IF NOT EXISTS chat_reactions (
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
);
CREATE TABLE IF NOT EXISTS chat_uploads (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_resets (
    email TEXT PRIMARY KEY COLLATE NOCASE,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_hash TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_success INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chat_push_user ON chat_push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS chat_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_email_log (
    user_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    sent_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, conversation_id)
);
"""


class ChatError(Exception):
    """An error that maps directly to an HTTP status and JSON message."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def urlparse_host(url) -> str:
    try:
        from urllib.parse import urlparse
        return urlparse(url).hostname or "?"
    except ValueError:
        return "?"


def now_ms() -> int:
    return int(time.time() * 1000)


def _clean_text(value, field, max_len, required=True, multiline=False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ChatError(400, "%s must be text" % field)
    if multiline:
        value = CONTROL_RE.sub("", value).strip()
    else:
        value = CONTROL_RE.sub("", value).replace("\n", " ").replace("\r", " ").strip()
    if required and not value:
        raise ChatError(400, "%s is required" % field)
    if len(value) > max_len:
        raise ChatError(400, "%s is too long (max %d characters)" % (field, max_len))
    return value


def _clean_email(value) -> str:
    if not isinstance(value, str):
        raise ChatError(400, "email is required")
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        raise ChatError(400, "enter a valid email address")
    return email


def _as_int(value, field) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ChatError(400, "%s must be a number" % field)


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

def _iterations() -> int:
    try:
        return max(1000, int(os.environ.get("ORBIS_PBKDF2_ITERATIONS", "210000")))
    except ValueError:
        return 210000


def hash_password(password: str) -> str:
    iterations = _iterations()
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256$%d$%s$%s" % (
        iterations,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt_b64, digest_b64 = stored.split("$")
        if scheme != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(iterations)
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _check_password_strength(password) -> str:
    if not isinstance(password, str) or len(password) < 8:
        raise ChatError(400, "password must be at least 8 characters")
    if len(password) > 200:
        raise ChatError(400, "password is too long")
    return password


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Rate limiting (in memory, per process)
# ---------------------------------------------------------------------------

class RateLimiter:
    def __init__(self):
        self._hits = {}
        self._lock = threading.Lock()

    def allow(self, key, limit, window_seconds) -> bool:
        now = time.monotonic()
        with self._lock:
            recent = [t for t in self._hits.get(key, []) if now - t < window_seconds]
            if len(recent) >= limit:
                self._hits[key] = recent
                return False
            recent.append(now)
            self._hits[key] = recent
            if len(self._hits) > 20000:
                self._hits.clear()
            return True


# ---------------------------------------------------------------------------
# Real-time event bus (Server-Sent Events fan-out)
# ---------------------------------------------------------------------------

class _Stream:
    """One open live connection (a browser tab or installed app)."""

    __slots__ = ("queue", "client_id", "active")

    def __init__(self, client_id, active):
        self.queue = queue.Queue(maxsize=1000)
        self.client_id = client_id
        self.active = active


class EventBus:
    def __init__(self):
        self._subscribers = {}
        self._lock = threading.Lock()

    def subscribe(self, user_id, client_id="", active=True):
        """Register a stream. Returns (stream, became_online)."""
        stream = _Stream(client_id, active)
        with self._lock:
            streams = self._subscribers.setdefault(user_id, set())
            became_online = not streams
            streams.add(stream)
        return stream, became_online

    def unsubscribe(self, user_id, stream) -> bool:
        """Remove a stream. Returns True when the user has no streams left."""
        with self._lock:
            streams = self._subscribers.get(user_id)
            if not streams:
                return False
            streams.discard(stream)
            if streams:
                return False
            del self._subscribers[user_id]
            return True

    def set_active(self, user_id, client_id, active) -> bool:
        """Mark a device's stream as in the foreground (visible) or not."""
        found = False
        with self._lock:
            for stream in self._subscribers.get(user_id, ()):
                if stream.client_id == client_id:
                    stream.active = bool(active)
                    found = True
        return found

    def has_foreground(self, user_id) -> bool:
        """True while the user is looking at Orbis on at least one device."""
        with self._lock:
            return any(stream.active for stream in self._subscribers.get(user_id, ()))

    def is_online(self, user_id) -> bool:
        with self._lock:
            return bool(self._subscribers.get(user_id))

    def online_ids(self):
        with self._lock:
            return {uid for uid, streams in self._subscribers.items() if streams}

    def publish(self, user_ids, event) -> None:
        with self._lock:
            targets = []
            for uid in set(user_ids):
                targets.extend(self._subscribers.get(uid, ()))
        for stream in targets:
            try:
                stream.queue.put_nowait(event)
            except queue.Full:
                pass

    def disconnect_user(self, user_id) -> None:
        with self._lock:
            targets = list(self._subscribers.get(user_id, ()))
        for stream in targets:
            try:
                stream.queue.put_nowait(None)
            except queue.Full:
                pass


# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

class Mailer:
    """Sends email via SMTP, or writes it to an outbox folder in dev mode."""

    def __init__(self, outbox_dir: Path):
        self.outbox_dir = outbox_dir
        self.host = os.environ.get("ORBIS_SMTP_HOST", "").strip()
        self.port = int(os.environ.get("ORBIS_SMTP_PORT", "587") or 587)
        self.user = os.environ.get("ORBIS_SMTP_USER", "")
        self.password = os.environ.get("ORBIS_SMTP_PASSWORD", "")
        self.sender = os.environ.get("ORBIS_SMTP_FROM", "") or self.user or "orbis@localhost"
        self.use_ssl = os.environ.get("ORBIS_SMTP_SSL", "") == "1"

    @property
    def enabled(self) -> bool:
        return bool(self.host)

    def send(self, to_address: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to_address
        message["Subject"] = subject
        message.set_content(text)
        worker = threading.Thread(target=self._deliver, args=(message,), daemon=True)
        worker.start()

    def _deliver(self, message: EmailMessage) -> None:
        try:
            if self.host:
                if self.use_ssl:
                    client = smtplib.SMTP_SSL(self.host, self.port, timeout=20)
                else:
                    client = smtplib.SMTP(self.host, self.port, timeout=20)
                    client.ehlo()
                    if client.has_extn("starttls"):
                        client.starttls()
                        client.ehlo()
                with client:
                    if self.user:
                        client.login(self.user, self.password)
                    client.send_message(message)
                print("[orbis-chat] email sent to %s: %s" % (message["To"], message["Subject"]))
            else:
                self.outbox_dir.mkdir(parents=True, exist_ok=True)
                name = "%d-%s.eml" % (now_ms(), secrets.token_hex(3))
                (self.outbox_dir / name).write_bytes(bytes(message))
                print("[orbis-chat] (dev outbox, SMTP not configured) email to %s: %s -> %s"
                      % (message["To"], message["Subject"], self.outbox_dir / name))
        except Exception as exc:  # never crash a request because email failed
            print("[orbis-chat] email to %s failed: %s" % (message["To"], exc))


# ---------------------------------------------------------------------------
# Chat service
# ---------------------------------------------------------------------------

class ChatService:
    def __init__(self, db_path: Path):
        data_dir = Path(db_path).parent
        data_dir.mkdir(parents=True, exist_ok=True)
        self.upload_dir = Path(os.environ.get("ORBIS_UPLOADS") or (data_dir / "uploads"))
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        self.mailer = Mailer(Path(os.environ.get("ORBIS_OUTBOX") or (data_dir / "outbox")))
        self.allow_signup = os.environ.get("ORBIS_ALLOW_SIGNUP", "1") != "0"
        self.trust_proxy = os.environ.get("ORBIS_TRUST_PROXY", "0") == "1"
        self.public_url = os.environ.get("ORBIS_PUBLIC_URL", "").strip()
        if self.public_url and not self.public_url.endswith("/"):
            self.public_url += "/"
        self.bus = EventBus()
        self.limiter = RateLimiter()
        self._typing_last = {}
        self._lock = threading.RLock()
        self._db = sqlite3.connect(str(db_path), check_same_thread=False, timeout=10)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA foreign_keys=OFF")
        self._db.executescript(SCHEMA)
        self._db.commit()
        self.vapid = webpush.Vapid(self._load_vapid_key(), self._vapid_subject())
        self.push_extra_hosts = tuple(
            h.strip().lower() for h in os.environ.get("ORBIS_PUSH_EXTRA_HOSTS", "").split(",") if h.strip()
        )
        self._push_queue = queue.Queue(maxsize=10000)
        for _ in range(4):
            threading.Thread(target=self._push_worker, daemon=True).start()

    # -- database helpers ---------------------------------------------------

    def _q(self, sql, params=()):
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    def _one(self, sql, params=()):
        with self._lock:
            return self._db.execute(sql, params).fetchone()

    def _write(self, statements):
        """Run [(sql, params), ...] in one transaction; return last rowid."""
        with self._lock:
            cursor = self._db.cursor()
            try:
                last_id = None
                for sql, params in statements:
                    cursor.execute(sql, params)
                    last_id = cursor.lastrowid
                self._db.commit()
                return last_id
            except Exception:
                self._db.rollback()
                raise

    # -- users and sessions -------------------------------------------------

    def public_user(self, row, include_email=True) -> dict:
        if row is None:
            return None
        data = {
            "id": row["id"],
            "name": row["name"],
            "status": row["status"],
            "color": row["color"],
            "online": self.bus.is_online(row["id"]),
            "lastSeen": row["last_seen"],
            "deleted": bool(row["deleted"]),
        }
        if include_email and not row["deleted"]:
            data["email"] = row["email"]
        return data

    def me_dict(self, row) -> dict:
        data = self.public_user(row)
        data["emailNotify"] = bool(row["email_notify"])
        data["createdAt"] = row["created_at"]
        return data

    def get_user(self, user_id):
        return self._one("SELECT * FROM chat_users WHERE id = ?", (user_id,))

    def _create_session(self, user_id, user_agent="") -> str:
        token = secrets.token_urlsafe(32)
        created = now_ms()
        expires = created + SESSION_DAYS * 86400 * 1000
        self._write([
            ("INSERT INTO chat_sessions (token_hash, user_id, created_at, expires_at, user_agent)"
             " VALUES (?, ?, ?, ?, ?)",
             (_sha256(token), user_id, created, expires, (user_agent or "")[:200])),
        ])
        return token

    def user_for_token(self, token):
        if not token:
            return None
        row = self._one(
            "SELECT u.* FROM chat_sessions s JOIN chat_users u ON u.id = s.user_id"
            " WHERE s.token_hash = ? AND s.expires_at > ? AND u.deleted = 0",
            (_sha256(token), now_ms()),
        )
        return row

    def register(self, body, user_agent, ip):
        if not self.allow_signup and not self._pending_invites_for(body.get("email")):
            raise ChatError(403, "sign-ups are invite-only on this server")
        if not self.limiter.allow(("register", ip), 10, 3600):
            raise ChatError(429, "too many sign-ups from this network, try again later")
        email = _clean_email(body.get("email"))
        name = _clean_text(body.get("name"), "name", 60)
        password = _check_password_strength(body.get("password"))
        if self._one("SELECT id FROM chat_users WHERE email = ?", (email,)):
            raise ChatError(409, "an account with this email already exists")
        color = PALETTE[secrets.randbelow(len(PALETTE))]
        created = now_ms()
        user_id = self._write([
            ("INSERT INTO chat_users (email, name, pw_hash, color, created_at, last_seen)"
             " VALUES (?, ?, ?, ?, ?, ?)",
             (email, name, hash_password(password), color, created, created)),
        ])
        self._apply_pending_invites(user_id, email)
        token = self._create_session(user_id, user_agent)
        if self.mailer.enabled:
            self.mailer.send(email, "Welcome to Orbis",
                             "Hi %s,\n\nYour Orbis account is ready. Open Orbis Chat any time:\n%s\n"
                             % (name, self.link("chat.html")))
        return {"token": token, "user": self.me_dict(self.get_user(user_id))}

    def login(self, body, user_agent, ip):
        email = _clean_email(body.get("email"))
        password = body.get("password") or ""
        if not self.limiter.allow(("login", ip, email), 10, 600):
            raise ChatError(429, "too many sign-in attempts, wait a few minutes")
        row = self._one("SELECT * FROM chat_users WHERE email = ? AND deleted = 0", (email,))
        if row is None or not verify_password(password, row["pw_hash"]):
            raise ChatError(401, "wrong email or password")
        self._apply_pending_invites(row["id"], email)
        token = self._create_session(row["id"], user_agent)
        return {"token": token, "user": self.me_dict(row)}

    def logout(self, token):
        self._write([
            ("DELETE FROM chat_sessions WHERE token_hash = ?", (_sha256(token),)),
            ("DELETE FROM chat_push_subscriptions WHERE session_hash = ?", (_sha256(token),)),
        ])
        return {"ok": True}

    def update_me(self, user, body):
        sets, params = [], []
        if "name" in body:
            sets.append("name = ?")
            params.append(_clean_text(body.get("name"), "name", 60))
        if "status" in body:
            sets.append("status = ?")
            params.append(_clean_text(body.get("status"), "status", 120, required=False))
        if "color" in body:
            color = body.get("color")
            if not isinstance(color, str) or not COLOR_RE.match(color):
                raise ChatError(400, "color must look like #RRGGBB")
            sets.append("color = ?")
            params.append(color)
        if "emailNotify" in body:
            sets.append("email_notify = ?")
            params.append(1 if body.get("emailNotify") else 0)
        if sets:
            params.append(user["id"])
            self._write([("UPDATE chat_users SET %s WHERE id = ?" % ", ".join(sets), params)])
        fresh = self.get_user(user["id"])
        self.bus.publish(self.contact_ids(user["id"]) | {user["id"]},
                         {"type": "user", "user": self.public_user(fresh)})
        return {"user": self.me_dict(fresh)}

    def change_password(self, user, body, token):
        if not verify_password(body.get("currentPassword") or "", user["pw_hash"]):
            raise ChatError(403, "current password is incorrect")
        new_password = _check_password_strength(body.get("newPassword"))
        self._write([
            ("UPDATE chat_users SET pw_hash = ? WHERE id = ?", (hash_password(new_password), user["id"])),
            ("DELETE FROM chat_sessions WHERE user_id = ? AND token_hash != ?",
             (user["id"], _sha256(token))),
        ])
        return {"ok": True}

    def request_reset(self, body, ip):
        email = _clean_email(body.get("email"))
        if not self.limiter.allow(("reset", ip), 5, 900):
            raise ChatError(429, "too many reset requests, try again later")
        row = self._one("SELECT * FROM chat_users WHERE email = ? AND deleted = 0", (email,))
        if row is not None:
            code = "%06d" % secrets.randbelow(1000000)
            self._write([
                ("INSERT OR REPLACE INTO chat_resets (email, code_hash, expires_at, attempts)"
                 " VALUES (?, ?, ?, 0)",
                 (email, _sha256(code), now_ms() + RESET_MINUTES * 60 * 1000)),
            ])
            self.mailer.send(
                email, "Your Orbis password reset code",
                "Hi %s,\n\nYour Orbis reset code is: %s\n\nIt expires in %d minutes. "
                "If you did not ask for this, you can ignore this email.\n"
                % (row["name"], code, RESET_MINUTES),
            )
        # Same answer whether or not the account exists (no account probing).
        return {"ok": True, "emailEnabled": self.mailer.enabled}

    def confirm_reset(self, body, user_agent):
        email = _clean_email(body.get("email"))
        code = str(body.get("code") or "").strip()
        new_password = _check_password_strength(body.get("password"))
        reset = self._one("SELECT * FROM chat_resets WHERE email = ?", (email,))
        if reset is None or reset["expires_at"] < now_ms() or reset["attempts"] >= 5:
            raise ChatError(400, "reset code is invalid or expired")
        if not hmac.compare_digest(reset["code_hash"], _sha256(code)):
            self._write([("UPDATE chat_resets SET attempts = attempts + 1 WHERE email = ?", (email,))])
            raise ChatError(400, "reset code is invalid or expired")
        row = self._one("SELECT * FROM chat_users WHERE email = ? AND deleted = 0", (email,))
        if row is None:
            raise ChatError(400, "reset code is invalid or expired")
        self._write([
            ("UPDATE chat_users SET pw_hash = ? WHERE id = ?", (hash_password(new_password), row["id"])),
            ("DELETE FROM chat_sessions WHERE user_id = ?", (row["id"],)),
            ("DELETE FROM chat_push_subscriptions WHERE user_id = ?", (row["id"],)),
            ("DELETE FROM chat_resets WHERE email = ?", (email,)),
        ])
        self.bus.disconnect_user(row["id"])
        token = self._create_session(row["id"], user_agent)
        return {"token": token, "user": self.me_dict(self.get_user(row["id"]))}

    def delete_account(self, user, body):
        if not verify_password(body.get("password") or "", user["pw_hash"]):
            raise ChatError(403, "password is incorrect")
        uid = user["id"]
        contacts = self.contact_ids(uid)
        owned = self._q("SELECT team_id FROM chat_team_members WHERE user_id = ? AND role = 'owner'", (uid,))
        self._write([
            ("UPDATE chat_users SET name = 'Deleted user', email = ?, pw_hash = '', status = '',"
             " deleted = 1, email_notify = 0 WHERE id = ?",
             ("deleted-%d-%s@deleted.invalid" % (uid, secrets.token_hex(4)), uid)),
            ("DELETE FROM chat_sessions WHERE user_id = ?", (uid,)),
            ("DELETE FROM chat_push_subscriptions WHERE user_id = ?", (uid,)),
            ("DELETE FROM chat_team_members WHERE user_id = ?", (uid,)),
            ("DELETE FROM chat_members WHERE user_id = ? AND conversation_id IN"
             " (SELECT id FROM chat_conversations WHERE kind != 'direct')", (uid,)),
            ("DELETE FROM chat_reactions WHERE user_id = ?", (uid,)),
        ])
        for row in owned:
            self._promote_new_owner(row["team_id"])
        self.bus.disconnect_user(uid)
        self.bus.publish(contacts, {"type": "user", "user": self.public_user(self.get_user(uid))})
        return {"ok": True}

    def search_users(self, user, query):
        text = (query or "").strip().lower()
        if not text:
            rows = self._q(
                "SELECT DISTINCT u.* FROM chat_users u JOIN chat_team_members a ON a.user_id = u.id"
                " JOIN chat_team_members b ON b.team_id = a.team_id AND b.user_id = ?"
                " WHERE u.id != ? AND u.deleted = 0 ORDER BY u.name LIMIT 50",
                (user["id"], user["id"]),
            )
            return {"users": [self.public_user(r) for r in rows]}
        like = "%" + text.replace("%", "").replace("_", "") + "%"
        # Teammates and existing contacts match by name or email; anyone else
        # only by exact email, so the directory cannot be scraped.
        rows = self._q(
            "SELECT * FROM chat_users WHERE deleted = 0 AND id != ? AND ("
            " lower(email) = ? OR ((lower(name) LIKE ? OR lower(email) LIKE ?) AND id IN ("
            "  SELECT a.user_id FROM chat_team_members a JOIN chat_team_members b"
            "   ON b.team_id = a.team_id WHERE b.user_id = ?"
            "  UNION SELECT m2.user_id FROM chat_members m1 JOIN chat_members m2"
            "   ON m2.conversation_id = m1.conversation_id WHERE m1.user_id = ?)))"
            " ORDER BY name LIMIT 20",
            (user["id"], text, like, like, user["id"], user["id"]),
        )
        return {"users": [self.public_user(r) for r in rows]}

    def contact_ids(self, user_id):
        rows = self._q(
            "SELECT m2.user_id AS uid FROM chat_members m1 JOIN chat_members m2"
            " ON m2.conversation_id = m1.conversation_id WHERE m1.user_id = ?"
            " UNION SELECT b.user_id FROM chat_team_members a JOIN chat_team_members b"
            " ON b.team_id = a.team_id WHERE a.user_id = ?",
            (user_id, user_id),
        )
        return {r["uid"] for r in rows if r["uid"] != user_id}

    def set_presence(self, user_id, online):
        stamp = now_ms()
        self._write([("UPDATE chat_users SET last_seen = ? WHERE id = ?", (stamp, user_id))])
        self.bus.publish(self.contact_ids(user_id), {
            "type": "presence", "userId": user_id, "online": online, "lastSeen": stamp,
        })


    # -- web push -------------------------------------------------------------

    def _load_vapid_key(self) -> int:
        configured = os.environ.get("ORBIS_VAPID_PRIVATE_KEY", "").strip()
        if configured:
            return webpush._int(webpush.b64url_decode(configured))
        row = self._one("SELECT value FROM chat_settings WHERE key = 'vapid_private'")
        if row:
            return webpush._int(webpush.b64url_decode(row["value"]))
        private_key = webpush.generate_private_key()
        self._write([("INSERT INTO chat_settings (key, value) VALUES ('vapid_private', ?)",
                      (webpush.b64url_encode(private_key.to_bytes(32, "big")),))])
        return private_key

    def _vapid_subject(self) -> str:
        configured = os.environ.get("ORBIS_VAPID_SUBJECT", "").strip()
        if configured:
            return configured
        if self.public_url.startswith("https://"):
            return self.public_url.rstrip("/")
        address = parseaddr(os.environ.get("ORBIS_SMTP_FROM", "") or os.environ.get("ORBIS_SMTP_USER", ""))[1]
        if "@" in address:
            return "mailto:" + address
        return "mailto:admin@orbis-chat.app"

    def push_subscribe(self, user, body, token, user_agent):
        endpoint = body.get("endpoint")
        keys = body.get("keys") or {}
        if not isinstance(endpoint, str) or len(endpoint) > 2048:
            raise ChatError(400, "invalid push subscription")
        if not webpush.endpoint_allowed(endpoint, self.push_extra_hosts):
            raise ChatError(400, "push endpoint is not a recognised push service")
        try:
            webpush.decode_point(webpush.b64url_decode(keys.get("p256dh") or ""))
            auth = webpush.b64url_decode(keys.get("auth") or "")
        except (ValueError, TypeError):
            raise ChatError(400, "invalid push subscription keys")
        if len(auth) < 16:
            raise ChatError(400, "invalid push subscription keys")
        self._write([
            ("DELETE FROM chat_push_subscriptions WHERE session_hash NOT IN"
             " (SELECT token_hash FROM chat_sessions)", ()),
            ("INSERT OR REPLACE INTO chat_push_subscriptions (endpoint, user_id, session_hash, p256dh, auth,"
             " user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
             (endpoint, user["id"], _sha256(token), keys["p256dh"], keys["auth"],
              (user_agent or "")[:200], now_ms())),
        ])
        return {"ok": True, "devices": len(self._push_subscriptions(user["id"]))}

    def push_unsubscribe(self, user, body):
        endpoint = body.get("endpoint")
        if isinstance(endpoint, str):
            self._write([("DELETE FROM chat_push_subscriptions WHERE endpoint = ? AND user_id = ?",
                          (endpoint, user["id"]))])
        return {"ok": True}

    def push_test(self, user):
        subscriptions = self._push_subscriptions(user["id"])
        payload = {
            "type": "test",
            "title": "Orbis notifications are on",
            "body": "You'll get alerts for new messages, even when Orbis is closed.",
            "tag": "orbis-test",
            "url": "chat.html",
        }
        for subscription in subscriptions:
            self._enqueue_push(subscription, payload, topic="test")
        return {"sent": len(subscriptions)}

    def set_client_state(self, user, body):
        client_id = re.sub(r"[^A-Za-z0-9_\-]", "", str(body.get("client") or ""))[:64]
        found = self.bus.set_active(user["id"], client_id, bool(body.get("active")))
        return {"ok": True, "found": found}

    def _push_subscriptions(self, user_id):
        return self._q(
            "SELECT s.* FROM chat_push_subscriptions s JOIN chat_sessions x ON x.token_hash = s.session_hash"
            " AND x.expires_at > ? WHERE s.user_id = ?",
            (now_ms(), user_id),
        )

    def _unread_total(self, user_id) -> int:
        return self._one(
            "SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_members cm ON cm.conversation_id = m.conversation_id"
            " AND cm.user_id = ? WHERE m.id > cm.last_read_id AND m.user_id != ? AND m.deleted_at IS NULL"
            " AND m.kind = 'text' AND cm.muted = 0",
            (user_id, user_id),
        )["n"]

    def _enqueue_push(self, subscription, payload, topic=None):
        try:
            self._push_queue.put_nowait((
                subscription["endpoint"], subscription["p256dh"], subscription["auth"],
                json.dumps(payload, ensure_ascii=False).encode("utf-8"), topic,
            ))
        except queue.Full:
            print("[orbis-chat] push queue full, dropping notification")

    def _push_worker(self):
        while True:
            endpoint, p256dh, auth, payload, topic = self._push_queue.get()
            host = urlparse_host(endpoint)
            try:
                status = webpush.send(self.vapid, endpoint, webpush.b64url_decode(p256dh),
                                      webpush.b64url_decode(auth), payload, topic=topic)
            except Exception as exc:  # network trouble: keep the subscription
                print("[orbis-chat] push to %s failed: %s" % (host, exc), flush=True)
                continue
            if status in (404, 410):
                # The browser unsubscribed or the app was uninstalled.
                self._write([("DELETE FROM chat_push_subscriptions WHERE endpoint = ?", (endpoint,))])
                print("[orbis-chat] push to %s: device unsubscribed (%d), removed" % (host, status), flush=True)
            elif status >= 400:
                print("[orbis-chat] push service %s answered %d" % (host, status), flush=True)
            else:
                self._write([("UPDATE chat_push_subscriptions SET last_success = ? WHERE endpoint = ?",
                              (now_ms(), endpoint))])
                print("[orbis-chat] push delivered to %s (%d)" % (host, status), flush=True)

    def _message_push_payload(self, sender, conv, message, recipient_id):
        if conv["kind"] == "direct":
            title = sender["name"]
        elif conv["kind"] == "channel":
            title = "%s · #%s" % (sender["name"], conv["name"])
        else:
            title = "%s · %s" % (sender["name"], conv["name"])
        if message["body"]:
            text = message["body"][:180] + ("…" if len(message["body"]) > 180 else "")
        else:
            text = "📎 " + ((message.get("attachment") or {}).get("name") or "Attachment")
        return {
            "type": "message",
            "title": title,
            "body": text,
            "conversationId": conv["id"],
            "messageId": message["id"],
            "tag": "orbis-conv-%d" % conv["id"],
            "badge": self._unread_total(recipient_id),
            "url": "chat.html#c=%d" % conv["id"],
        }

    # -- links and invites ----------------------------------------------------

    def link(self, path, base=None) -> str:
        root = self.public_url or base or "http://localhost:8765/"
        return root + path

    def _pending_invites_for(self, email):
        if not isinstance(email, str) or not email.strip():
            return []
        return self._q(
            "SELECT * FROM chat_invites WHERE email = ? AND expires_at > ?",
            (email.strip().lower(), now_ms()),
        )

    def _apply_pending_invites(self, user_id, email):
        for invite in self._pending_invites_for(email):
            try:
                self._accept_invite_row(user_id, invite)
            except ChatError:
                pass

    def create_invite(self, user, team_id, body, base):
        email = None
        if body.get("email"):
            email = _clean_email(body.get("email"))
        team = None
        if team_id is not None:
            team = self._require_team_member(user["id"], team_id)
        code = secrets.token_urlsafe(9)
        created = now_ms()
        self._write([
            ("INSERT INTO chat_invites (code, team_id, email, invited_by, created_at, expires_at)"
             " VALUES (?, ?, ?, ?, ?, ?)",
             (code, team_id, email, user["id"], created, created + INVITE_DAYS * 86400 * 1000)),
        ])
        link = self.link("chat.html?invite=" + quote(code), base)
        emailed = False
        if email:
            existing = self._one("SELECT * FROM chat_users WHERE email = ? AND deleted = 0", (email,))
            if existing is not None:
                # Already on Orbis: connect them straight away and let them know.
                self._accept_invite_row(existing["id"], self._one(
                    "SELECT * FROM chat_invites WHERE code = ?", (code,)))
            what = ("join the team \"%s\"" % team["name"]) if team else "chat with them"
            self.mailer.send(
                email,
                "%s invited you to Orbis" % user["name"],
                "%s (%s) invited you to %s on Orbis.\n\nOpen this link to accept"
                " (works on web, iPhone and Android):\n%s\n\nThe invite expires in %d days.\n"
                % (user["name"], user["email"], what, link, INVITE_DAYS),
            )
            emailed = True
        return {"code": code, "link": link, "emailed": emailed,
                "emailEnabled": self.mailer.enabled}

    def invite_info(self, code):
        invite = self._one("SELECT * FROM chat_invites WHERE code = ?", (code,))
        if invite is None or invite["expires_at"] < now_ms():
            raise ChatError(404, "this invite is invalid or has expired")
        inviter = self.get_user(invite["invited_by"])
        team = None
        if invite["team_id"] is not None:
            row = self._one("SELECT * FROM chat_teams WHERE id = ?", (invite["team_id"],))
            team = {"id": row["id"], "name": row["name"]} if row else None
        return {"code": code, "team": team,
                "invitedBy": inviter["name"] if inviter else "Someone",
                "email": invite["email"]}

    def accept_invite(self, user, code):
        invite = self._one("SELECT * FROM chat_invites WHERE code = ?", (code,))
        if invite is None or invite["expires_at"] < now_ms():
            raise ChatError(404, "this invite is invalid or has expired")
        return self._accept_invite_row(user["id"], invite)

    def _accept_invite_row(self, user_id, invite):
        result = {"ok": True, "team": None, "conversationId": None}
        if invite["team_id"] is not None:
            team = self._one("SELECT * FROM chat_teams WHERE id = ?", (invite["team_id"],))
            if team is None:
                raise ChatError(404, "this team no longer exists")
            self._add_team_member(team["id"], user_id, "member")
            result["team"] = self.team_summary(team["id"], user_id)
        elif invite["invited_by"] != user_id:
            conv = self._get_or_create_direct(user_id, invite["invited_by"])
            result["conversationId"] = conv
        self._write([("UPDATE chat_invites SET uses = uses + 1 WHERE code = ?", (invite["code"],))])
        return result

    # -- teams ----------------------------------------------------------------

    def _require_team_member(self, user_id, team_id):
        team = self._one(
            "SELECT t.*, m.role AS my_role FROM chat_teams t JOIN chat_team_members m"
            " ON m.team_id = t.id AND m.user_id = ? WHERE t.id = ?",
            (user_id, team_id),
        )
        if team is None:
            raise ChatError(404, "team not found")
        return team

    def team_summary(self, team_id, user_id):
        team = self._require_team_member(user_id, team_id)
        count = self._one("SELECT COUNT(*) AS n FROM chat_team_members WHERE team_id = ?", (team_id,))["n"]
        return {"id": team["id"], "name": team["name"], "role": team["my_role"],
                "memberCount": count, "createdAt": team["created_at"]}

    def list_teams(self, user):
        rows = self._q(
            "SELECT t.id FROM chat_teams t JOIN chat_team_members m ON m.team_id = t.id"
            " WHERE m.user_id = ? ORDER BY t.name COLLATE NOCASE",
            (user["id"],),
        )
        return {"teams": [self.team_summary(r["id"], user["id"]) for r in rows]}

    def create_team(self, user, body):
        name = _clean_text(body.get("name"), "team name", 60)
        created = now_ms()
        team_id = self._write([
            ("INSERT INTO chat_teams (name, owner_id, created_at) VALUES (?, ?, ?)",
             (name, user["id"], created)),
        ])
        self._write([
            ("INSERT INTO chat_team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
             (team_id, user["id"], created)),
        ])
        conv_id = self._write([
            ("INSERT INTO chat_conversations (kind, name, topic, team_id, is_default, created_by,"
             " created_at, last_message_at) VALUES ('channel', 'general', ?, ?, 1, ?, ?, ?)",
             ("Team-wide announcements and chat", team_id, user["id"], created, created)),
        ])
        self._write([
            ("INSERT INTO chat_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)",
             (conv_id, user["id"], created)),
        ])
        self._system_message(conv_id, user["id"], "%s created the team %s" % (user["name"], name))
        return {"team": self.team_summary(team_id, user["id"])}

    def team_detail(self, user, team_id):
        team = self._require_team_member(user["id"], team_id)
        members = self._q(
            "SELECT u.*, m.role AS role, m.joined_at AS joined FROM chat_team_members m"
            " JOIN chat_users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY u.name COLLATE NOCASE",
            (team_id,),
        )
        channels = self._q(
            "SELECT c.*, (SELECT COUNT(*) FROM chat_members x WHERE x.conversation_id = c.id) AS n,"
            " EXISTS(SELECT 1 FROM chat_members y WHERE y.conversation_id = c.id AND y.user_id = ?) AS joined"
            " FROM chat_conversations c WHERE c.team_id = ? AND c.kind = 'channel'"
            " ORDER BY c.is_default DESC, c.name COLLATE NOCASE",
            (user["id"], team_id),
        )
        member_list = []
        for row in members:
            entry = self.public_user(row)
            entry["role"] = row["role"]
            member_list.append(entry)
        return {
            "team": self.team_summary(team_id, user["id"]),
            "members": member_list,
            "channels": [
                {"id": c["id"], "name": c["name"], "topic": c["topic"], "memberCount": c["n"],
                 "joined": bool(c["joined"]), "isDefault": bool(c["is_default"])}
                for c in channels
            ],
            "canManage": team["my_role"] in ("owner", "admin"),
        }

    def rename_team(self, user, team_id, body):
        team = self._require_team_member(user["id"], team_id)
        if team["my_role"] not in ("owner", "admin"):
            raise ChatError(403, "only team owners and admins can rename the team")
        name = _clean_text(body.get("name"), "team name", 60)
        self._write([("UPDATE chat_teams SET name = ? WHERE id = ?", (name, team_id))])
        self._publish_team(team_id, {"type": "team", "teamId": team_id})
        return {"team": self.team_summary(team_id, user["id"])}

    def _team_member_ids(self, team_id):
        return {r["user_id"] for r in self._q(
            "SELECT user_id FROM chat_team_members WHERE team_id = ?", (team_id,))}

    def _publish_team(self, team_id, event, extra_ids=()):
        self.bus.publish(self._team_member_ids(team_id) | set(extra_ids), event)

    def _add_team_member(self, team_id, user_id, role):
        if self._one("SELECT 1 FROM chat_team_members WHERE team_id = ? AND user_id = ?",
                     (team_id, user_id)):
            return False
        stamp = now_ms()
        self._write([
            ("INSERT INTO chat_team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)",
             (team_id, user_id, role, stamp)),
        ])
        user = self.get_user(user_id)
        for channel in self._q(
                "SELECT id FROM chat_conversations WHERE team_id = ? AND kind = 'channel' AND is_default = 1",
                (team_id,)):
            self._add_member(channel["id"], user_id)
            self._system_message(channel["id"], user_id, "%s joined the team" % user["name"])
        self._publish_team(team_id, {"type": "team", "teamId": team_id})
        return True

    def _promote_new_owner(self, team_id):
        if self._one("SELECT 1 FROM chat_team_members WHERE team_id = ? AND role = 'owner'", (team_id,)):
            return
        successor = self._one(
            "SELECT user_id FROM chat_team_members WHERE team_id = ?"
            " ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at LIMIT 1",
            (team_id,),
        )
        if successor:
            self._write([
                ("UPDATE chat_team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?",
                 (team_id, successor["user_id"])),
                ("UPDATE chat_teams SET owner_id = ? WHERE id = ?", (successor["user_id"], team_id)),
            ])

    def _remove_from_team(self, team_id, user_id, actor_name, removed=False):
        user = self.get_user(user_id)
        channel_ids = [r["id"] for r in self._q(
            "SELECT c.id FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id"
            " WHERE c.team_id = ? AND m.user_id = ?", (team_id, user_id))]
        self._write([
            ("DELETE FROM chat_team_members WHERE team_id = ? AND user_id = ?", (team_id, user_id)),
        ])
        for channel_id in channel_ids:
            text = ("%s removed %s" % (actor_name, user["name"])) if removed else ("%s left" % user["name"])
            self._system_message(channel_id, user_id, text)
            self._remove_member(channel_id, user_id)
        self._promote_new_owner(team_id)
        self._publish_team(team_id, {"type": "team", "teamId": team_id})
        self.bus.publish([user_id], {"type": "team_removed", "teamId": team_id})

    def leave_team(self, user, team_id):
        self._require_team_member(user["id"], team_id)
        self._remove_from_team(team_id, user["id"], user["name"])
        return {"ok": True}

    def remove_team_member(self, user, team_id, member_id):
        team = self._require_team_member(user["id"], team_id)
        if team["my_role"] not in ("owner", "admin"):
            raise ChatError(403, "only team owners and admins can remove people")
        target = self._one("SELECT role FROM chat_team_members WHERE team_id = ? AND user_id = ?",
                           (team_id, member_id))
        if target is None:
            raise ChatError(404, "that person is not in this team")
        if target["role"] == "owner":
            raise ChatError(403, "the team owner cannot be removed")
        self._remove_from_team(team_id, member_id, user["name"], removed=True)
        return {"ok": True}

    def set_team_role(self, user, team_id, member_id, body):
        team = self._require_team_member(user["id"], team_id)
        role = body.get("role")
        if team["my_role"] != "owner":
            raise ChatError(403, "only the team owner can change roles")
        if role not in ("admin", "member"):
            raise ChatError(400, "role must be admin or member")
        if member_id == user["id"]:
            raise ChatError(400, "you cannot change your own role")
        self._write([
            ("UPDATE chat_team_members SET role = ? WHERE team_id = ? AND user_id = ?",
             (role, team_id, member_id)),
        ])
        self._publish_team(team_id, {"type": "team", "teamId": team_id})
        return {"ok": True}

    def create_channel(self, user, team_id, body):
        self._require_team_member(user["id"], team_id)
        name = _clean_text(body.get("name"), "channel name", 40).lower().lstrip("#")
        name = re.sub(r"[^a-z0-9\-_ ]", "", name).strip().replace(" ", "-")
        if not name:
            raise ChatError(400, "channel name must contain letters or numbers")
        if self._one("SELECT 1 FROM chat_conversations WHERE team_id = ? AND kind = 'channel' AND name = ?",
                     (team_id, name)):
            raise ChatError(409, "a channel with that name already exists")
        topic = _clean_text(body.get("topic"), "topic", 200, required=False)
        stamp = now_ms()
        conv_id = self._write([
            ("INSERT INTO chat_conversations (kind, name, topic, team_id, created_by, created_at,"
             " last_message_at) VALUES ('channel', ?, ?, ?, ?, ?, ?)",
             (name, topic, team_id, user["id"], stamp, stamp)),
        ])
        self._add_member(conv_id, user["id"])
        self._system_message(conv_id, user["id"], "%s created #%s" % (user["name"], name))
        self._publish_team(team_id, {"type": "team", "teamId": team_id})
        return {"conversation": self.conversation_dict(conv_id, user["id"])}

    # -- conversations --------------------------------------------------------

    def _add_member(self, conv_id, user_id):
        self._write([
            ("INSERT OR IGNORE INTO chat_members (conversation_id, user_id, joined_at, last_read_id)"
             " VALUES (?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE conversation_id = ?))",
             (conv_id, user_id, now_ms(), conv_id)),
        ])

    def _remove_member(self, conv_id, user_id):
        self._write([
            ("DELETE FROM chat_members WHERE conversation_id = ? AND user_id = ?", (conv_id, user_id)),
        ])
        self.bus.publish([user_id], {"type": "conversation_removed", "conversationId": conv_id})
        self._publish_conversation_update(conv_id)

    def member_ids(self, conv_id):
        return {r["user_id"] for r in self._q(
            "SELECT user_id FROM chat_members WHERE conversation_id = ?", (conv_id,))}

    def _require_member(self, user_id, conv_id):
        row = self._one(
            "SELECT c.*, m.last_read_id AS my_last_read, m.muted AS my_muted"
            " FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id AND m.user_id = ?"
            " WHERE c.id = ?",
            (user_id, conv_id),
        )
        if row is None:
            raise ChatError(404, "conversation not found")
        return row

    def conversation_dict(self, conv_id, user_id):
        conv = self._require_member(user_id, conv_id)
        members = self._q(
            "SELECT u.*, m.last_read_id AS last_read FROM chat_members m JOIN chat_users u"
            " ON u.id = m.user_id WHERE m.conversation_id = ? ORDER BY u.name COLLATE NOCASE",
            (conv_id,),
        )
        member_list = []
        for row in members:
            entry = self.public_user(row)
            entry["lastReadId"] = row["last_read"]
            member_list.append(entry)
        name = conv["name"]
        peer = None
        if conv["kind"] == "direct":
            ids = [int(x) for x in conv["direct_key"].split(":")]
            other_id = ids[1] if ids[0] == user_id else ids[0]
            other = self.get_user(other_id)
            peer = self.public_user(other) if other else None
            name = other["name"] if other else "Deleted user"
            if other_id == user_id:
                name = "%s (you)" % name
        team = None
        if conv["team_id"] is not None:
            row = self._one("SELECT id, name FROM chat_teams WHERE id = ?", (conv["team_id"],))
            team = {"id": row["id"], "name": row["name"]} if row else None
        last = self._one(
            "SELECT id FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1",
            (conv_id,),
        )
        unread = self._one(
            "SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id = ? AND id > ?"
            " AND user_id != ? AND deleted_at IS NULL AND kind = 'text'",
            (conv_id, conv["my_last_read"], user_id),
        )["n"]
        return {
            "id": conv["id"],
            "kind": conv["kind"],
            "name": name,
            "topic": conv["topic"],
            "team": team,
            "isDefault": bool(conv["is_default"]),
            "peer": peer,
            "members": member_list,
            "lastMessage": self.message_dicts([last["id"]])[0] if last else None,
            "lastReadId": conv["my_last_read"],
            "unread": unread,
            "muted": bool(conv["my_muted"]),
            "createdAt": conv["created_at"],
            "lastMessageAt": conv["last_message_at"],
        }

    def list_conversations(self, user):
        rows = self._q(
            "SELECT c.id FROM chat_conversations c JOIN chat_members m ON m.conversation_id = c.id"
            " WHERE m.user_id = ? ORDER BY c.last_message_at DESC",
            (user["id"],),
        )
        return {"conversations": [self.conversation_dict(r["id"], user["id"]) for r in rows]}

    def _get_or_create_direct(self, user_id, other_id):
        low, high = sorted([user_id, other_id])
        key = "%d:%d" % (low, high)
        row = self._one("SELECT id FROM chat_conversations WHERE direct_key = ?", (key,))
        if row:
            conv_id = row["id"]
        else:
            stamp = now_ms()
            conv_id = self._write([
                ("INSERT INTO chat_conversations (kind, direct_key, created_by, created_at, last_message_at)"
                 " VALUES ('direct', ?, ?, ?, ?)",
                 (key, user_id, stamp, stamp)),
            ])
        for uid in {user_id, other_id}:
            self._add_member(conv_id, uid)
        self._publish_conversation_update(conv_id)
        return conv_id

    def _resolve_users(self, body):
        ids = set()
        for raw in body.get("userIds") or []:
            ids.add(_as_int(raw, "userIds"))
        missing = []
        for raw in body.get("emails") or []:
            email = _clean_email(raw)
            row = self._one("SELECT id FROM chat_users WHERE email = ? AND deleted = 0", (email,))
            if row:
                ids.add(row["id"])
            else:
                missing.append(email)
        if missing:
            raise ChatError(404, "no Orbis account for: %s (send them an invite)" % ", ".join(missing))
        for uid in ids:
            row = self.get_user(uid)
            if row is None or row["deleted"]:
                raise ChatError(404, "user %d not found" % uid)
        return ids

    def create_conversation(self, user, body):
        kind = body.get("kind") or "direct"
        if kind == "direct":
            if body.get("email"):
                body = {"emails": [body.get("email")]}
            elif body.get("userId") is not None:
                body = {"userIds": [body.get("userId")]}
            ids = self._resolve_users(body)
            if len(ids) != 1:
                raise ChatError(400, "a direct message needs exactly one other person")
            conv_id = self._get_or_create_direct(user["id"], ids.pop())
            return {"conversation": self.conversation_dict(conv_id, user["id"])}
        if kind == "group":
            name = _clean_text(body.get("name"), "group name", 60, required=False) or "New group"
            ids = self._resolve_users(body)
            ids.discard(user["id"])
            if not ids:
                raise ChatError(400, "add at least one other person to the group")
            if len(ids) > 255:
                raise ChatError(400, "groups are limited to 256 people")
            stamp = now_ms()
            conv_id = self._write([
                ("INSERT INTO chat_conversations (kind, name, created_by, created_at, last_message_at)"
                 " VALUES ('group', ?, ?, ?, ?)",
                 (name, user["id"], stamp, stamp)),
            ])
            for uid in ids | {user["id"]}:
                self._add_member(conv_id, uid)
            self._system_message(conv_id, user["id"], "%s created the group \"%s\"" % (user["name"], name))
            return {"conversation": self.conversation_dict(conv_id, user["id"])}
        raise ChatError(400, "kind must be direct or group (create channels inside a team)")

    def update_conversation(self, user, conv_id, body):
        conv = self._require_member(user["id"], conv_id)
        statements = []
        notes = []
        if "muted" in body:
            statements.append((
                "UPDATE chat_members SET muted = ? WHERE conversation_id = ? AND user_id = ?",
                (1 if body.get("muted") else 0, conv_id, user["id"])))
        if "name" in body:
            if conv["kind"] != "group":
                raise ChatError(400, "only group chats can be renamed")
            name = _clean_text(body.get("name"), "group name", 60)
            statements.append(("UPDATE chat_conversations SET name = ? WHERE id = ?", (name, conv_id)))
            notes.append("%s renamed the group to \"%s\"" % (user["name"], name))
        if "topic" in body:
            if conv["kind"] == "direct":
                raise ChatError(400, "direct messages have no topic")
            topic = _clean_text(body.get("topic"), "topic", 200, required=False)
            statements.append(("UPDATE chat_conversations SET topic = ? WHERE id = ?", (topic, conv_id)))
            notes.append("%s set the topic: %s" % (user["name"], topic or "(cleared)"))
        if statements:
            self._write(statements)
        for note in notes:
            self._system_message(conv_id, user["id"], note)
        if notes:
            self._publish_conversation_update(conv_id)
        return {"conversation": self.conversation_dict(conv_id, user["id"])}

    def add_members(self, user, conv_id, body):
        conv = self._require_member(user["id"], conv_id)
        if conv["kind"] != "group":
            raise ChatError(400, "people can only be added to group chats")
        ids = self._resolve_users(body) - self.member_ids(conv_id)
        for uid in ids:
            self._add_member(conv_id, uid)
            added = self.get_user(uid)
            self._system_message(conv_id, user["id"], "%s added %s" % (user["name"], added["name"]))
        self._publish_conversation_update(conv_id)
        return {"conversation": self.conversation_dict(conv_id, user["id"])}

    def join_channel(self, user, conv_id):
        conv = self._one("SELECT * FROM chat_conversations WHERE id = ? AND kind = 'channel'", (conv_id,))
        if conv is None:
            raise ChatError(404, "channel not found")
        self._require_team_member(user["id"], conv["team_id"])
        if user["id"] not in self.member_ids(conv_id):
            self._add_member(conv_id, user["id"])
            self._system_message(conv_id, user["id"], "%s joined #%s" % (user["name"], conv["name"]))
            self._publish_conversation_update(conv_id)
        return {"conversation": self.conversation_dict(conv_id, user["id"])}

    def leave_conversation(self, user, conv_id):
        conv = self._require_member(user["id"], conv_id)
        if conv["kind"] == "direct":
            raise ChatError(400, "you can mute a direct message, but not leave it")
        if conv["is_default"]:
            raise ChatError(400, "everyone in the team stays in #general")
        self._system_message(conv_id, user["id"], "%s left" % user["name"])
        self._remove_member(conv_id, user["id"])
        return {"ok": True}

    def _publish_conversation_update(self, conv_id):
        for uid in self.member_ids(conv_id):
            try:
                self.bus.publish([uid], {"type": "conversation",
                                         "conversation": self.conversation_dict(conv_id, uid)})
            except ChatError:
                pass

    # -- messages -------------------------------------------------------------

    def message_dicts(self, ids):
        ids = [i for i in ids if i is not None]
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        rows = self._q(
            "SELECT m.*, u.name AS author_name, u.color AS author_color FROM chat_messages m"
            " JOIN chat_users u ON u.id = m.user_id WHERE m.id IN (%s) ORDER BY m.id" % marks,
            ids,
        )
        reactions = {}
        for r in self._q("SELECT message_id, emoji, user_id FROM chat_reactions WHERE message_id IN (%s)"
                         " ORDER BY created_at" % marks, ids):
            reactions.setdefault(r["message_id"], {}).setdefault(r["emoji"], []).append(r["user_id"])
        reply_ids = list({r["reply_to"] for r in rows if r["reply_to"]})
        replies = {}
        if reply_ids:
            marks2 = ",".join("?" * len(reply_ids))
            for r in self._q(
                    "SELECT m.id, m.user_id, m.body, m.deleted_at, m.attachment, u.name AS author_name"
                    " FROM chat_messages m JOIN chat_users u ON u.id = m.user_id WHERE m.id IN (%s)" % marks2,
                    reply_ids):
                preview = "" if r["deleted_at"] else (r["body"][:140] or ("[attachment]" if r["attachment"] else ""))
                replies[r["id"]] = {"id": r["id"], "userId": r["user_id"], "authorName": r["author_name"],
                                    "body": preview, "deleted": bool(r["deleted_at"])}
        result = []
        for r in rows:
            deleted = r["deleted_at"] is not None
            result.append({
                "id": r["id"],
                "conversationId": r["conversation_id"],
                "userId": r["user_id"],
                "authorName": r["author_name"],
                "authorColor": r["author_color"],
                "kind": r["kind"],
                "body": "" if deleted else r["body"],
                "replyTo": replies.get(r["reply_to"]) if r["reply_to"] else None,
                "attachment": None if (deleted or not r["attachment"]) else json.loads(r["attachment"]),
                "clientId": r["client_id"],
                "createdAt": r["created_at"],
                "editedAt": r["edited_at"],
                "deleted": deleted,
                "reactions": reactions.get(r["id"], {}),
            })
        return result

    def list_messages(self, user, conv_id, params):
        self._require_member(user["id"], conv_id)
        limit = min(max(_as_int(params.get("limit", PAGE_SIZE), "limit"), 1), 200)
        if params.get("after"):
            rows = self._q(
                "SELECT id FROM chat_messages WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT ?",
                (conv_id, _as_int(params["after"], "after"), limit + 1),
            )
            ids = [r["id"] for r in rows]
            has_more = len(ids) > limit
            return {"messages": self.message_dicts(ids[:limit]), "hasMore": has_more}
        before = _as_int(params.get("before", 0) or 0, "before")
        if before:
            rows = self._q(
                "SELECT id FROM chat_messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
                (conv_id, before, limit + 1),
            )
        else:
            rows = self._q(
                "SELECT id FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?",
                (conv_id, limit + 1),
            )
        ids = [r["id"] for r in rows]
        has_more = len(ids) > limit
        ids = list(reversed(ids[:limit]))
        return {"messages": self.message_dicts(ids), "hasMore": has_more}

    def _system_message(self, conv_id, user_id, text):
        stamp = now_ms()
        with self._lock:
            msg_id = self._write([
                ("INSERT INTO chat_messages (conversation_id, user_id, kind, body, created_at)"
                 " VALUES (?, ?, 'system', ?, ?)", (conv_id, user_id, text[:500], stamp)),
            ])
            self._write([
                ("UPDATE chat_conversations SET last_message_at = ? WHERE id = ?", (stamp, conv_id)),
            ])
        message = self.message_dicts([msg_id])[0]
        self.bus.publish(self.member_ids(conv_id), {"type": "message", "message": message})
        return message

    def send_message(self, user, conv_id, body):
        conv = self._require_member(user["id"], conv_id)
        if not self.limiter.allow(("send", user["id"]), 30, 10):
            raise ChatError(429, "you are sending messages too quickly")
        text = _clean_text(body.get("body"), "message", MAX_MESSAGE_CHARS, required=False, multiline=True)
        attachment = None
        if body.get("attachmentId"):
            upload = self._one("SELECT * FROM chat_uploads WHERE id = ? AND user_id = ?",
                               (str(body.get("attachmentId")), user["id"]))
            if upload is None:
                raise ChatError(400, "attachment not found")
            attachment = {
                "id": upload["id"], "name": upload["filename"], "type": upload["content_type"],
                "size": upload["size"], "url": "api/chat/uploads/%s" % upload["id"],
                "inline": upload["content_type"] in INLINE_IMAGE_TYPES,
            }
        if not text and attachment is None:
            raise ChatError(400, "message is empty")
        client_id = str(body.get("clientId") or "")[:64] or None
        if client_id:
            dup = self._one("SELECT id FROM chat_messages WHERE conversation_id = ? AND user_id = ?"
                            " AND client_id = ?", (conv_id, user["id"], client_id))
            if dup:  # retried request: return the original instead of a duplicate
                return {"message": self.message_dicts([dup["id"]])[0]}
        reply_to = None
        if body.get("replyTo"):
            reply_to = _as_int(body.get("replyTo"), "replyTo")
            if not self._one("SELECT 1 FROM chat_messages WHERE id = ? AND conversation_id = ?",
                             (reply_to, conv_id)):
                raise ChatError(400, "the message you replied to is not in this conversation")
        stamp = now_ms()
        with self._lock:
            msg_id = self._write([
                ("INSERT INTO chat_messages (conversation_id, user_id, kind, body, reply_to, attachment,"
                 " client_id, created_at) VALUES (?, ?, 'text', ?, ?, ?, ?, ?)",
                 (conv_id, user["id"], text, reply_to,
                  json.dumps(attachment) if attachment else None, client_id, stamp)),
            ])
            self._write([
                ("UPDATE chat_conversations SET last_message_at = ? WHERE id = ?", (stamp, conv_id)),
                ("UPDATE chat_members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?",
                 (msg_id, conv_id, user["id"])),
            ])
        message = self.message_dicts([msg_id])[0]
        members = self.member_ids(conv_id)
        self.bus.publish(members, {"type": "message", "message": message})
        self._notify_members(user, conv, members, message)
        return {"message": message}

    def _notify_members(self, sender, conv, members, message):
        """Alert members who are not looking at Orbis right now.

        Devices with push enabled get a Web Push notification (works even when
        the app is closed). People without push who are fully offline get an
        email instead (throttled per conversation).
        """
        stamp = now_ms()
        for uid in members - {sender["id"]}:
            if self.bus.has_foreground(uid):
                continue
            row = self._one(
                "SELECT u.*, m.muted AS muted FROM chat_users u JOIN chat_members m"
                " ON m.user_id = u.id AND m.conversation_id = ? WHERE u.id = ?",
                (conv["id"], uid),
            )
            if row is None or row["deleted"] or row["muted"]:
                continue
            subscriptions = self._push_subscriptions(uid)
            if subscriptions:
                payload = self._message_push_payload(sender, conv, message, uid)
                for subscription in subscriptions:
                    self._enqueue_push(subscription, payload, topic="c%d" % conv["id"])
                continue
            if self.bus.is_online(uid) or not row["email_notify"]:
                continue
            last = self._one("SELECT sent_at FROM chat_email_log WHERE user_id = ? AND conversation_id = ?",
                             (uid, conv["id"]))
            if last and stamp - last["sent_at"] < EMAIL_NOTIFY_COOLDOWN_MS:
                continue
            self._write([
                ("INSERT OR REPLACE INTO chat_email_log (user_id, conversation_id, sent_at) VALUES (?, ?, ?)",
                 (uid, conv["id"], stamp)),
            ])
            where = "a direct message" if conv["kind"] == "direct" else (
                "#%s" % conv["name"] if conv["kind"] == "channel" else "\"%s\"" % conv["name"])
            preview = message["body"][:300] or "[attachment]"
            self.mailer.send(
                row["email"],
                "New message from %s on Orbis" % sender["name"],
                "%s sent you %s:\n\n%s\n\nReply in Orbis: %s\n\n(Turn off email notifications"
                " in Orbis > Profile.)\n" % (sender["name"],
                                              where if conv["kind"] == "direct" else "a message in " + where,
                                              preview, self.link("chat.html#c=%d" % conv["id"])),
            )

    def _require_own_message(self, user, message_id):
        row = self._one("SELECT * FROM chat_messages WHERE id = ?", (message_id,))
        if row is None or row["deleted_at"] is not None:
            raise ChatError(404, "message not found")
        self._require_member(user["id"], row["conversation_id"])
        if row["user_id"] != user["id"] or row["kind"] != "text":
            raise ChatError(403, "you can only change your own messages")
        return row

    def edit_message(self, user, message_id, body):
        row = self._require_own_message(user, message_id)
        text = _clean_text(body.get("body"), "message", MAX_MESSAGE_CHARS, multiline=True)
        self._write([("UPDATE chat_messages SET body = ?, edited_at = ? WHERE id = ?",
                      (text, now_ms(), message_id))])
        message = self.message_dicts([message_id])[0]
        self.bus.publish(self.member_ids(row["conversation_id"]), {"type": "message_updated", "message": message})
        return {"message": message}

    def delete_message(self, user, message_id):
        row = self._require_own_message(user, message_id)
        self._write([
            ("UPDATE chat_messages SET deleted_at = ?, body = '', attachment = NULL WHERE id = ?",
             (now_ms(), message_id)),
            ("DELETE FROM chat_reactions WHERE message_id = ?", (message_id,)),
        ])
        message = self.message_dicts([message_id])[0]
        self.bus.publish(self.member_ids(row["conversation_id"]), {"type": "message_updated", "message": message})
        return {"message": message}

    def toggle_reaction(self, user, message_id, body):
        emoji = body.get("emoji")
        if not isinstance(emoji, str) or not emoji.strip() or len(emoji) > 16:
            raise ChatError(400, "emoji is required")
        row = self._one("SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL", (message_id,))
        if row is None:
            raise ChatError(404, "message not found")
        self._require_member(user["id"], row["conversation_id"])
        existing = self._one("SELECT 1 FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
                             (message_id, user["id"], emoji))
        if existing:
            self._write([("DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?",
                          (message_id, user["id"], emoji))])
        else:
            count = self._one("SELECT COUNT(DISTINCT emoji) AS n FROM chat_reactions WHERE message_id = ?",
                              (message_id,))["n"]
            if count >= 20:
                raise ChatError(400, "too many different reactions on this message")
            self._write([("INSERT INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)",
                          (message_id, user["id"], emoji, now_ms()))])
        message = self.message_dicts([message_id])[0]
        self.bus.publish(self.member_ids(row["conversation_id"]), {"type": "message_updated", "message": message})
        return {"message": message}

    def mark_read(self, user, conv_id, body):
        self._require_member(user["id"], conv_id)
        latest = self._one("SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE conversation_id = ?",
                           (conv_id,))["id"]
        target = latest
        if body.get("messageId"):
            target = min(_as_int(body.get("messageId"), "messageId"), latest)
        self._write([
            ("UPDATE chat_members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?",
             (target, conv_id, user["id"])),
        ])
        current = self._one("SELECT last_read_id FROM chat_members WHERE conversation_id = ? AND user_id = ?",
                            (conv_id, user["id"]))["last_read_id"]
        self.bus.publish(self.member_ids(conv_id), {
            "type": "read", "conversationId": conv_id, "userId": user["id"], "lastReadId": current,
        })
        return {"ok": True, "lastReadId": current}

    def typing(self, user, conv_id):
        self._require_member(user["id"], conv_id)
        key = (user["id"], conv_id)
        stamp = now_ms()
        if stamp - self._typing_last.get(key, 0) >= TYPING_RELAY_MIN_MS:
            self._typing_last[key] = stamp
            self.bus.publish(self.member_ids(conv_id) - {user["id"]}, {
                "type": "typing", "conversationId": conv_id, "userId": user["id"], "name": user["name"],
            })
        return {"ok": True}

    def search_messages(self, user, query):
        text = (query or "").strip()
        if len(text) < 2:
            return {"results": []}
        like = "%" + text.replace("%", "").replace("_", "") + "%"
        rows = self._q(
            "SELECT m.id FROM chat_messages m JOIN chat_members cm ON cm.conversation_id = m.conversation_id"
            " AND cm.user_id = ? WHERE m.deleted_at IS NULL AND m.kind = 'text' AND m.body LIKE ?"
            " ORDER BY m.id DESC LIMIT 50",
            (user["id"], like),
        )
        messages = self.message_dicts([r["id"] for r in rows])
        messages.reverse()
        names = {}
        for message in messages:
            cid = message["conversationId"]
            if cid not in names:
                names[cid] = self.conversation_dict(cid, user["id"])["name"]
            message["conversationName"] = names[cid]
        return {"results": messages}

    # -- uploads --------------------------------------------------------------

    def save_upload(self, user, data: bytes, filename: str, content_type: str):
        if not data:
            raise ChatError(400, "file is empty")
        if len(data) > MAX_UPLOAD_BYTES:
            raise ChatError(413, "files are limited to 10 MB")
        if not self.limiter.allow(("upload", user["id"]), 30, 600):
            raise ChatError(429, "too many uploads, try again later")
        name = CONTROL_RE.sub("", filename or "file").replace("/", "_").replace("\\", "_").strip()[:120] or "file"
        ctype = (content_type or "application/octet-stream").split(";")[0].strip().lower()[:100]
        upload_id = secrets.token_urlsafe(24)
        (self.upload_dir / upload_id).write_bytes(data)
        self._write([
            ("INSERT INTO chat_uploads (id, user_id, filename, content_type, size, created_at)"
             " VALUES (?, ?, ?, ?, ?, ?)",
             (upload_id, user["id"], name, ctype, len(data), now_ms())),
        ])
        return {"id": upload_id, "name": name, "type": ctype, "size": len(data),
                "url": "api/chat/uploads/%s" % upload_id, "inline": ctype in INLINE_IMAGE_TYPES}

    def load_upload(self, upload_id):
        if not re.match(r"^[A-Za-z0-9_\-]{20,64}$", upload_id or ""):
            raise ChatError(404, "file not found")
        row = self._one("SELECT * FROM chat_uploads WHERE id = ?", (upload_id,))
        path = self.upload_dir / upload_id
        if row is None or not path.is_file():
            raise ChatError(404, "file not found")
        return row, path.read_bytes()


# ---------------------------------------------------------------------------
# HTTP routing
# ---------------------------------------------------------------------------

def _match(pattern, parts):
    pieces = pattern.split("/")
    if len(pieces) != len(parts):
        return None
    params = {}
    for piece, part in zip(pieces, parts):
        if piece.startswith(":"):
            params[piece[1:]] = part
        elif piece != part:
            return None
    return params


class ChatRouter:
    """Maps /api/chat/... requests onto ChatService methods."""

    def __init__(self, service: ChatService):
        self.svc = service
        s = service
        # (method, pattern, needs_auth, handler(ctx, params, body))
        self.routes = [
            ("GET", "config", False, lambda c, p, b: {
                "emailEnabled": s.mailer.enabled, "signupOpen": s.allow_signup,
                "maxUploadBytes": MAX_UPLOAD_BYTES, "maxMessageChars": MAX_MESSAGE_CHARS,
                "pushEnabled": True, "vapidPublicKey": s.vapid.public_key_b64}),
            ("GET", "push/key", False, lambda c, p, b: {"publicKey": s.vapid.public_key_b64}),
            ("POST", "push/subscribe", True,
             lambda c, p, b: s.push_subscribe(c["user"], b, c["token"], c["ua"])),
            ("POST", "push/unsubscribe", True, lambda c, p, b: s.push_unsubscribe(c["user"], b)),
            ("POST", "push/test", True, lambda c, p, b: s.push_test(c["user"])),
            ("POST", "presence", True, lambda c, p, b: s.set_client_state(c["user"], b)),
            ("POST", "auth/register", False, lambda c, p, b: s.register(b, c["ua"], c["ip"])),
            ("POST", "auth/login", False, lambda c, p, b: s.login(b, c["ua"], c["ip"])),
            ("POST", "auth/logout", True, lambda c, p, b: s.logout(c["token"])),
            ("POST", "auth/reset/request", False, lambda c, p, b: s.request_reset(b, c["ip"])),
            ("POST", "auth/reset/confirm", False, lambda c, p, b: s.confirm_reset(b, c["ua"])),
            ("GET", "me", True, lambda c, p, b: {"user": s.me_dict(c["user"])}),
            ("PATCH", "me", True, lambda c, p, b: s.update_me(c["user"], b)),
            ("POST", "me/password", True, lambda c, p, b: s.change_password(c["user"], b, c["token"])),
            ("POST", "me/delete", True, lambda c, p, b: s.delete_account(c["user"], b)),
            ("GET", "users", True, lambda c, p, b: s.search_users(c["user"], c["query"].get("q", ""))),
            ("GET", "teams", True, lambda c, p, b: s.list_teams(c["user"])),
            ("POST", "teams", True, lambda c, p, b: s.create_team(c["user"], b)),
            ("GET", "teams/:tid", True, lambda c, p, b: s.team_detail(c["user"], int(p["tid"]))),
            ("PATCH", "teams/:tid", True, lambda c, p, b: s.rename_team(c["user"], int(p["tid"]), b)),
            ("POST", "teams/:tid/invites", True,
             lambda c, p, b: s.create_invite(c["user"], int(p["tid"]), b, c["base"])),
            ("POST", "teams/:tid/channels", True, lambda c, p, b: s.create_channel(c["user"], int(p["tid"]), b)),
            ("POST", "teams/:tid/leave", True, lambda c, p, b: s.leave_team(c["user"], int(p["tid"]))),
            ("DELETE", "teams/:tid/members/:uid", True,
             lambda c, p, b: s.remove_team_member(c["user"], int(p["tid"]), int(p["uid"]))),
            ("PATCH", "teams/:tid/members/:uid", True,
             lambda c, p, b: s.set_team_role(c["user"], int(p["tid"]), int(p["uid"]), b)),
            ("POST", "invites", True, lambda c, p, b: s.create_invite(c["user"], None, b, c["base"])),
            ("GET", "invites/:code", False, lambda c, p, b: s.invite_info(p["code"])),
            ("POST", "invites/:code/accept", True, lambda c, p, b: s.accept_invite(c["user"], p["code"])),
            ("GET", "conversations", True, lambda c, p, b: s.list_conversations(c["user"])),
            ("POST", "conversations", True, lambda c, p, b: s.create_conversation(c["user"], b)),
            ("GET", "conversations/:cid", True,
             lambda c, p, b: {"conversation": s.conversation_dict(int(p["cid"]), c["user"]["id"])}),
            ("PATCH", "conversations/:cid", True,
             lambda c, p, b: s.update_conversation(c["user"], int(p["cid"]), b)),
            ("POST", "conversations/:cid/members", True,
             lambda c, p, b: s.add_members(c["user"], int(p["cid"]), b)),
            ("POST", "conversations/:cid/join", True, lambda c, p, b: s.join_channel(c["user"], int(p["cid"]))),
            ("POST", "conversations/:cid/leave", True,
             lambda c, p, b: s.leave_conversation(c["user"], int(p["cid"]))),
            ("GET", "conversations/:cid/messages", True,
             lambda c, p, b: s.list_messages(c["user"], int(p["cid"]), c["query"])),
            ("POST", "conversations/:cid/messages", True,
             lambda c, p, b: s.send_message(c["user"], int(p["cid"]), b)),
            ("POST", "conversations/:cid/read", True, lambda c, p, b: s.mark_read(c["user"], int(p["cid"]), b)),
            ("POST", "conversations/:cid/typing", True, lambda c, p, b: s.typing(c["user"], int(p["cid"]))),
            ("PATCH", "messages/:mid", True, lambda c, p, b: s.edit_message(c["user"], int(p["mid"]), b)),
            ("DELETE", "messages/:mid", True, lambda c, p, b: s.delete_message(c["user"], int(p["mid"]))),
            ("POST", "messages/:mid/reactions", True,
             lambda c, p, b: s.toggle_reaction(c["user"], int(p["mid"]), b)),
            ("GET", "search", True, lambda c, p, b: s.search_messages(c["user"], c["query"].get("q", ""))),
        ]

    # -- helpers ----------------------------------------------------------------

    def _client_ip(self, handler):
        if self.svc.trust_proxy:
            forwarded = handler.headers.get("X-Forwarded-For", "")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return handler.client_address[0]

    def _base_url(self, handler):
        proto = handler.headers.get("X-Forwarded-Proto", "").split(",")[0].strip() or "http"
        host = (handler.headers.get("X-Forwarded-Host") or handler.headers.get("Host") or "").strip()
        if not host:
            return None
        return "%s://%s/" % (proto, host)

    def _token(self, handler, query):
        auth = handler.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return query.get("token", "")

    def _content_length(self, handler):
        try:
            return int(handler.headers.get("Content-Length") or 0)
        except ValueError:
            raise ChatError(400, "invalid Content-Length")

    def _json_body(self, handler):
        size = self._content_length(handler)
        if size > MAX_JSON_BYTES:
            raise ChatError(413, "request body is too large")
        if size <= 0:
            return {}
        raw = handler.rfile.read(size)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ChatError(400, "malformed JSON body")
        if not isinstance(body, dict):
            raise ChatError(400, "JSON body must be an object")
        return body

    # -- entry point --------------------------------------------------------------

    def handle(self, handler, method, path, query_string):
        parts = [p for p in path.split("/") if p][2:]
        query = {k: v[0] for k, v in parse_qs(query_string or "").items()}
        try:
            self._dispatch(handler, method, parts, query)
        except ChatError as err:
            handler.send_json(err.status, {"error": err.message})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            handler.send_json(500, {"error": "internal server error"})

    def _dispatch(self, handler, method, parts, query):
        if method == "GET" and parts == ["events"]:
            self._stream(handler, query)
            return
        if len(parts) == 2 and parts[0] == "uploads" and method in ("GET", "HEAD"):
            self._serve_upload(handler, parts[1])
            return
        if parts == ["uploads"] and method == "POST":
            user = self._auth(handler, query)
            size = self._content_length(handler)
            if size > MAX_UPLOAD_BYTES:
                raise ChatError(413, "files are limited to 10 MB")
            data = handler.rfile.read(size) if size > 0 else b""
            filename = unquote(handler.headers.get("X-Filename", "file"))
            result = self.svc.save_upload(user, data, filename, handler.headers.get("Content-Type", ""))
            handler.send_json(200, {"upload": result})
            return
        for route_method, pattern, needs_auth, func in self.routes:
            if route_method != method:
                continue
            params = _match(pattern, parts)
            if params is None:
                continue
            for key in ("tid", "uid", "cid", "mid"):
                if key in params and not params[key].isdigit():
                    raise ChatError(404, "not found")
            body = self._json_body(handler) if method in ("POST", "PATCH", "DELETE") else {}
            token = self._token(handler, query)
            context = {"query": query, "ip": self._client_ip(handler), "token": token,
                       "ua": handler.headers.get("User-Agent", ""), "base": self._base_url(handler),
                       "user": None}
            if needs_auth:
                context["user"] = self._auth(handler, query)
            handler.send_json(200, func(context, params, body))
            return
        raise ChatError(404, "not found")

    def _auth(self, handler, query):
        user = self.svc.user_for_token(self._token(handler, query))
        if user is None:
            raise ChatError(401, "please sign in")
        return user

    def _serve_upload(self, handler, upload_id):
        row, data = self.svc.load_upload(upload_id)
        ctype = row["content_type"]
        inline = ctype in INLINE_IMAGE_TYPES
        disposition = "%s; filename*=UTF-8''%s" % ("inline" if inline else "attachment", quote(row["filename"]))
        handler._send_bytes(200, data, ctype if inline else "application/octet-stream", {
            "Content-Disposition": disposition,
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        })

    def _stream(self, handler, query):
        user = self._auth(handler, query)
        uid = user["id"]
        handler.send_response(200)
        handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
        handler.send_header("Cache-Control", "no-cache, no-transform")
        handler.send_header("X-Accel-Buffering", "no")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.end_headers()
        handler.close_connection = True
        client_id = re.sub(r"[^A-Za-z0-9_\-]", "", query.get("client", ""))[:64] or secrets.token_hex(8)
        stream, became_online = self.svc.bus.subscribe(uid, client_id, query.get("active", "1") != "0")
        subscriber = stream.queue
        if became_online:
            self.svc.set_presence(uid, True)
        try:
            online = sorted(self.svc.bus.online_ids() & (self.svc.contact_ids(uid) | {uid}))
            hello = {"type": "hello", "userId": uid, "serverTime": now_ms(), "online": online}
            handler.wfile.write(("retry: 3000\ndata: %s\n\n" % json.dumps(hello)).encode("utf-8"))
            handler.wfile.flush()
            while True:
                try:
                    event = subscriber.get(timeout=HEARTBEAT_SECONDS)
                except queue.Empty:
                    handler.wfile.write(b": ping\n\n")
                    handler.wfile.flush()
                    if self.svc.user_for_token(self._token(handler, query)) is None:
                        break
                    continue
                if event is None:
                    break
                payload = json.dumps(event, ensure_ascii=False)
                handler.wfile.write(("data: %s\n\n" % payload).encode("utf-8"))
                handler.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            if self.svc.bus.unsubscribe(uid, stream):
                self.svc.set_presence(uid, False)
