"""SQLite persistence for Beacon (standard library only)."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time

import webpush
from channels import mask_address

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS apps (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    app_key       TEXT NOT NULL UNIQUE,
    secret_hash   TEXT NOT NULL UNIQUE,
    secret_hint   TEXT NOT NULL,
    vapid_private TEXT NOT NULL,
    vapid_subject TEXT NOT NULL,
    origins       TEXT NOT NULL DEFAULT '',
    icon          TEXT NOT NULL DEFAULT '',
    default_url   TEXT NOT NULL DEFAULT '',
    fcm_account   TEXT NOT NULL DEFAULT '',
    created       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS subscribers (
    id         INTEGER PRIMARY KEY,
    app_id     INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    channel    TEXT NOT NULL,               -- webpush | fcm | ntfy | bark | gotify | apprise
    address    TEXT NOT NULL,               -- push endpoint, FCM token, ntfy topic, Bark device, Gotify server, apprise URL
    p256dh     TEXT NOT NULL DEFAULT '',
    auth       TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL,               -- lets the client manage itself
    user_id    TEXT NOT NULL DEFAULT '',
    tags       TEXT NOT NULL DEFAULT '[]',
    platform   TEXT NOT NULL DEFAULT '',
    locale     TEXT NOT NULL DEFAULT '',
    failures   INTEGER NOT NULL DEFAULT 0,
    created    REAL NOT NULL,
    last_seen  REAL NOT NULL,
    UNIQUE (app_id, address)
);
CREATE INDEX IF NOT EXISTS subscribers_app ON subscribers(app_id, channel);
CREATE INDEX IF NOT EXISTS subscribers_token ON subscribers(token_hash);

CREATE TABLE IF NOT EXISTS messages (
    id        INTEGER PRIMARY KEY,
    app_id    INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    body      TEXT NOT NULL DEFAULT '',
    url       TEXT NOT NULL DEFAULT '',
    icon      TEXT NOT NULL DEFAULT '',
    image     TEXT NOT NULL DEFAULT '',
    tag       TEXT NOT NULL DEFAULT '',
    data      TEXT NOT NULL DEFAULT '{}',
    target    TEXT NOT NULL DEFAULT '{"all": true}',
    channels  TEXT NOT NULL DEFAULT '["webpush","fcm"]',  -- + ntfy, bark, gotify, apprise, inapp
    ttl       INTEGER NOT NULL DEFAULT 86400,
    urgency   TEXT NOT NULL DEFAULT 'normal',
    send_at   REAL NOT NULL,
    status    TEXT NOT NULL DEFAULT 'queued',  -- queued | sending | sent | cancelled | failed
    created   REAL NOT NULL,
    finished  REAL,
    targeted  INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0,
    failed    INTEGER NOT NULL DEFAULT 0,
    pruned    INTEGER NOT NULL DEFAULT 0,
    shown     INTEGER NOT NULL DEFAULT 0,
    clicked   INTEGER NOT NULL DEFAULT 0,
    error     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS messages_due ON messages(status, send_at);
CREATE INDEX IF NOT EXISTS messages_app ON messages(app_id, created);

-- Notification categories and subscriber preferences (the idea Novu calls workflow
-- preferences, implemented natively): a message may carry a category; subscribers or
-- users can switch categories off or limit them to some channels; critical categories
-- (security alerts, password resets, ...) always go out.
CREATE TABLE IF NOT EXISTS categories (
    app_id          INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    name            TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    critical        INTEGER NOT NULL DEFAULT 0,
    default_enabled INTEGER NOT NULL DEFAULT 1,
    created         REAL NOT NULL,
    PRIMARY KEY (app_id, key)
);

CREATE TABLE IF NOT EXISTS preferences (
    app_id   INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    owner    TEXT NOT NULL,                 -- 'user:<user_id>' or 'sub:<subscriber id>'
    category TEXT NOT NULL,                 -- a category key, or '*' for every category
    enabled  INTEGER NOT NULL DEFAULT 1,
    channels TEXT NOT NULL DEFAULT '',      -- JSON list of allowed channels; '' = all
    updated  REAL NOT NULL,
    PRIMARY KEY (app_id, owner, category)
);

-- Reusable message templates with {{variables}} (title, body, url, routing, escalation).
CREATE TABLE IF NOT EXISTS templates (
    app_id  INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    spec    TEXT NOT NULL,                  -- JSON: title, body, url, channels, category, ...
    created REAL NOT NULL,
    updated REAL NOT NULL,
    PRIMARY KEY (app_id, name)
);
"""

PUSH_CHANNELS = ("webpush", "fcm", "ntfy", "bark", "gotify", "apprise")  # channels with per-subscriber delivery
DEFAULT_CHANNELS = list(PUSH_CHANNELS)
MESSAGE_COUNTERS = ("targeted", "delivered", "failed", "pruned", "shown", "clicked", "suppressed")
ALL_CATEGORIES = "*"
PRUNE_AFTER_FAILURES = 10
DIGEST_MAX_ITEMS = 8  # kept small: the list travels in the push payload (~4 KB limit)
FALLBACK_COUNTERS = {"clicked": "clicked", "shown": "shown", "delivered": "delivered"}


def render_digest(template: str | None, items: list[dict], count: int) -> tuple[str, str]:
    """Title/body of a digest that has absorbed `count` messages (items keeps the newest)."""
    if template:
        title = template.replace("{count}", str(count))[:120]
    else:
        title = f"{count} new notifications"
    titles = [item["title"] for item in items[-5:]]
    body = "; ".join(reversed(titles))
    if count > len(titles):
        body += f" and {count - len(titles)} more"
    return title, body[:600]


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_token(prefix: str) -> str:
    return prefix + secrets.token_urlsafe(24)


def matches_target(subscriber: dict, target: dict) -> bool:
    """Does a subscriber (dict with user_id, tags list, id) match a target spec?"""
    if not target or target.get("all"):
        selected = True
    else:
        selected = False
        if target.get("subscriber_ids") and subscriber["id"] in target["subscriber_ids"]:
            selected = True
        if target.get("user_ids") and subscriber["user_id"] and subscriber["user_id"] in target["user_ids"]:
            selected = True
        wanted = target.get("tags")
        if wanted:
            have = set(subscriber["tags"])
            if target.get("match") == "all":
                selected = selected or set(wanted) <= have
            else:
                selected = selected or bool(set(wanted) & have)
    excluded = target.get("exclude_tags") if target else None
    if selected and excluded and set(excluded) & set(subscriber["tags"]):
        return False
    return selected


class Store:
    def __init__(self, path: str):
        self.path = path
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.db.executescript(SCHEMA)
            self._migrate()
        self.server_secret = self._setting("server_secret") or self._set_setting(
            "server_secret", secrets.token_hex(32)
        )

    WORKFLOW_COLUMNS = (
        ("digest_key", "TEXT NOT NULL DEFAULT ''"),
        ("digest_count", "INTEGER NOT NULL DEFAULT 0"),
        ("fallback", "TEXT NOT NULL DEFAULT ''"),          # JSON spec, '' = none
        ("fallback_state", "TEXT NOT NULL DEFAULT ''"),    # '' | pending | skipped | sent
        ("fallback_id", "INTEGER"),                        # the follow-up message
        ("parent_id", "INTEGER"),                          # set on a follow-up
        ("category", "TEXT NOT NULL DEFAULT ''"),          # preference category ('' = none)
        ("suppressed", "INTEGER NOT NULL DEFAULT 0"),      # recipients skipped by their preferences
    )

    def _migrate(self) -> None:
        have = {row[1] for row in self.db.execute("PRAGMA table_info(messages)").fetchall()}
        for name, decl in self.WORKFLOW_COLUMNS:
            if name not in have:
                self.db.execute(f"ALTER TABLE messages ADD COLUMN {name} {decl}")
        self.db.execute("CREATE INDEX IF NOT EXISTS messages_digest ON messages(app_id, digest_key, status)")

    # ---------------------------------------------------------------- helpers
    def q(self, sql: str, args: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.db.execute(sql, args).fetchall()

    def x(self, sql: str, args: tuple = ()) -> sqlite3.Cursor:
        with self.lock:
            return self.db.execute(sql, args)

    def _setting(self, key: str) -> str | None:
        rows = self.q("SELECT value FROM settings WHERE key = ?", (key,))
        return rows[0]["value"] if rows else None

    def _set_setting(self, key: str, value: str) -> str:
        self.x("INSERT INTO settings(key, value) VALUES(?, ?) "
               "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, value))
        return value

    # ------------------------------------------------------------------ admin
    def ensure_admin_token(self, explicit: str | None = None, reset: bool = False) -> str | None:
        """Returns a newly created token (to print once) or None if one exists."""
        if explicit:
            self._set_setting("admin_hash", sha256_hex(explicit))
            return None
        if self._setting("admin_hash") and not reset:
            return None
        token = new_token("adm_")
        self._set_setting("admin_hash", sha256_hex(token))
        return token

    def check_admin(self, token: str) -> bool:
        stored = self._setting("admin_hash")
        return bool(stored and token) and hmac.compare_digest(stored, sha256_hex(token))

    # ------------------------------------------------------------------- apps
    def create_app(self, name: str, subject: str = "", origins: str = "", icon: str = "",
                   default_url: str = "") -> tuple[dict, str]:
        secret = new_token("sk_")
        private = webpush.generate_private_key()
        cursor = self.x(
            "INSERT INTO apps(name, app_key, secret_hash, secret_hint, vapid_private, vapid_subject,"
            " origins, icon, default_url, created) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (
                name.strip()[:80],
                "pk_" + secrets.token_urlsafe(12),
                sha256_hex(secret),
                secret[:7] + "…" + secret[-4:],
                format(private, "064x"),
                subject or "mailto:admin@example.com",
                origins,
                icon,
                default_url,
                time.time(),
            ),
        )
        return self.get_app(cursor.lastrowid), secret

    def rotate_secret(self, app_id: int) -> str:
        secret = new_token("sk_")
        self.x("UPDATE apps SET secret_hash = ?, secret_hint = ? WHERE id = ?",
               (sha256_hex(secret), secret[:7] + "…" + secret[-4:], app_id))
        return secret

    def update_app(self, app_id: int, fields: dict) -> dict:
        allowed = {"name", "vapid_subject", "origins", "icon", "default_url", "fcm_account"}
        for key, value in fields.items():
            if key in allowed:
                self.x(f"UPDATE apps SET {key} = ? WHERE id = ?", (str(value), app_id))
        return self.get_app(app_id)

    def delete_app(self, app_id: int) -> None:
        self.x("DELETE FROM apps WHERE id = ?", (app_id,))

    def _app_row(self, row) -> dict | None:
        if row is None:
            return None
        app = dict(row)
        app["vapid_public_key"] = webpush.b64url_encode(webpush.public_key(int(app["vapid_private"], 16)))
        app["fcm_configured"] = bool(app["fcm_account"])
        return app

    def get_app(self, app_id: int) -> dict | None:
        rows = self.q("SELECT * FROM apps WHERE id = ?", (app_id,))
        return self._app_row(rows[0] if rows else None)

    def app_by_key(self, app_key: str) -> dict | None:
        rows = self.q("SELECT * FROM apps WHERE app_key = ?", (app_key or "",))
        return self._app_row(rows[0] if rows else None)

    def app_by_secret(self, secret: str) -> dict | None:
        if not secret:
            return None
        rows = self.q("SELECT * FROM apps WHERE secret_hash = ?", (sha256_hex(secret),))
        return self._app_row(rows[0] if rows else None)

    def list_apps(self) -> list[dict]:
        apps = []
        for row in self.q("SELECT * FROM apps ORDER BY id"):
            app = self._app_row(row)
            counts = self.q(
                "SELECT channel, COUNT(*) AS n FROM subscribers WHERE app_id = ? GROUP BY channel",
                (app["id"],),
            )
            app["subscribers"] = {r["channel"]: r["n"] for r in counts}
            apps.append(app)
        return apps

    @staticmethod
    def public_app(app: dict) -> dict:
        """Safe view of an app (never the VAPID private key or secret hash)."""
        hidden = {"vapid_private", "secret_hash", "fcm_account"}
        return {k: v for k, v in app.items() if k not in hidden}

    # ------------------------------------------------------------ subscribers
    def upsert_subscriber(self, app_id: int, channel: str, address: str, p256dh: str = "",
                          auth: str = "", user_id: str = "", tags: list | None = None,
                          platform: str = "", locale: str = "") -> tuple[int, str]:
        token = new_token("st_")
        now = time.time()
        with self.lock:
            existing = self.q("SELECT id FROM subscribers WHERE app_id = ? AND address = ?", (app_id, address))
            if existing:
                sub_id = existing[0]["id"]
                self.x(
                    "UPDATE subscribers SET p256dh=?, auth=?, token_hash=?, user_id=?, tags=?, platform=?,"
                    " locale=?, failures=0, last_seen=? WHERE id=?",
                    (p256dh, auth, sha256_hex(token), user_id, json.dumps(tags or []), platform, locale,
                     now, sub_id),
                )
            else:
                cursor = self.x(
                    "INSERT INTO subscribers(app_id, channel, address, p256dh, auth, token_hash, user_id,"
                    " tags, platform, locale, created, last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (app_id, channel, address, p256dh, auth, sha256_hex(token), user_id,
                     json.dumps(tags or []), platform, locale, now, now),
                )
                sub_id = cursor.lastrowid
        return sub_id, token

    def subscriber_by_token(self, app_id: int, token: str) -> dict | None:
        rows = self.q("SELECT * FROM subscribers WHERE app_id = ? AND token_hash = ?",
                      (app_id, sha256_hex(token or "")))
        return self._sub_row(rows[0]) if rows else None

    @staticmethod
    def _sub_row(row) -> dict:
        sub = dict(row)
        sub["tags"] = json.loads(sub["tags"] or "[]")
        return sub

    def update_subscriber(self, sub_id: int, user_id: str | None, tags: list | None) -> None:
        if user_id is not None:
            self.x("UPDATE subscribers SET user_id = ? WHERE id = ?", (user_id, sub_id))
        if tags is not None:
            self.x("UPDATE subscribers SET tags = ? WHERE id = ?", (json.dumps(tags), sub_id))
        self.x("UPDATE subscribers SET last_seen = ? WHERE id = ?", (time.time(), sub_id))

    def delete_subscriber(self, sub_id: int) -> None:
        self.x("DELETE FROM subscribers WHERE id = ?", (sub_id,))

    def record_failure(self, sub_id: int) -> bool:
        """Count a delivery failure; returns True when the subscriber was pruned."""
        self.x("UPDATE subscribers SET failures = failures + 1 WHERE id = ?", (sub_id,))
        rows = self.q("SELECT failures FROM subscribers WHERE id = ?", (sub_id,))
        if rows and rows[0]["failures"] >= PRUNE_AFTER_FAILURES:
            self.delete_subscriber(sub_id)
            return True
        return False

    def record_success(self, sub_id: int) -> None:
        self.x("UPDATE subscribers SET failures = 0 WHERE id = ? AND failures != 0", (sub_id,))

    def list_subscribers(self, app_id: int, limit: int = 200) -> list[dict]:
        rows = self.q(
            "SELECT id, channel, user_id, tags, platform, locale, failures, created, last_seen,"
            " address FROM subscribers WHERE app_id = ?"
            " ORDER BY id DESC LIMIT ?",
            (app_id, max(1, min(limit, 5000))),
        )
        subscribers = []
        for row in rows:
            sub = self._sub_row(row)
            sub["address_preview"] = mask_address(sub["channel"], sub.pop("address"))
            subscribers.append(sub)
        return subscribers

    def get_subscriber(self, sub_id: int) -> dict | None:
        rows = self.q("SELECT * FROM subscribers WHERE id = ?", (sub_id,))
        return self._sub_row(rows[0]) if rows else None

    def targets(self, app_id: int, target: dict, channels: list[str]) -> list[dict]:
        wanted_channels = [c for c in channels if c in PUSH_CHANNELS]
        if not wanted_channels:
            return []
        marks = ",".join("?" for _ in wanted_channels)
        rows = self.q(
            f"SELECT * FROM subscribers WHERE app_id = ? AND channel IN ({marks})",
            (app_id, *wanted_channels),
        )
        return [s for s in (self._sub_row(r) for r in rows) if matches_target(s, target)]

    # --------------------------------------------------------------- messages
    def create_message(self, app_id: int, fields: dict) -> dict:
        now = time.time()
        digest = fields.get("digest") or {}
        fallback = fields.get("fallback") or None
        cursor = self.x(
            "INSERT INTO messages(app_id, title, body, url, icon, image, tag, data, target, channels,"
            " ttl, urgency, send_at, status, created, digest_key, digest_count, fallback, fallback_state,"
            " parent_id, category) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                app_id,
                fields["title"],
                fields.get("body", ""),
                fields.get("url", ""),
                fields.get("icon", ""),
                fields.get("image", ""),
                fields.get("tag", ""),
                json.dumps(fields.get("data") or {}),
                json.dumps(fields.get("target") or {"all": True}),
                json.dumps(fields.get("channels") or DEFAULT_CHANNELS),
                int(fields.get("ttl", 86400)),
                fields.get("urgency", "normal"),
                float(fields.get("send_at") or now),
                "queued",
                now,
                digest.get("key", ""),
                1 if digest else 0,
                json.dumps(fallback) if fallback else "",
                "pending" if fallback else "",
                fields.get("parent_id"),
                fields.get("category", ""),
            ),
        )
        return self.get_message(cursor.lastrowid)

    # ------------------------------------------------------- digest (batching)
    def send_or_digest(self, app_id: int, fields: dict) -> tuple[dict, bool]:
        """Create a message, or fold it into a queued digest with the same key.

        The first message of a digest key waits `window` seconds; every message
        with that key arriving meanwhile is added to it instead of sending its own
        notification. Returns (message, merged).
        """
        digest = fields.get("digest")
        if not digest:
            return self.create_message(app_id, fields), False
        item = {"title": fields["title"][:120], "url": fields.get("url", "")}
        with self.lock:
            rows = self.q("SELECT * FROM messages WHERE app_id = ? AND digest_key = ? AND status = 'queued'"
                          " ORDER BY id LIMIT 1", (app_id, digest["key"]))
            if not rows:
                first = dict(fields)
                first["send_at"] = max(float(fields.get("send_at") or 0), time.time() + digest["window"])
                first["data"] = {**(fields.get("data") or {}), "digest": [item]}
                return self.create_message(app_id, first), False
            message = self._message_row(rows[0])
            items = (message["data"].get("digest") or [])
            items = (items + [item])[-DIGEST_MAX_ITEMS:]
            count = message["digest_count"] + 1
            title, body = render_digest(digest.get("title"), items, count)
            data = {**message["data"], "digest": items}
            self.x("UPDATE messages SET digest_count = ?, title = ?, body = ?, url = ?, data = ? WHERE id = ?",
                   (count, title, body, item["url"] or message["url"], json.dumps(data), message["id"]))
            return self.get_message(message["id"]), True

    # ------------------------------------------------- fallback (escalation)
    def process_fallbacks(self, now: float | None = None) -> list[dict]:
        """Send each due follow-up whose condition was not met; returns the follow-ups created."""
        now = now or time.time()
        created = []
        with self.lock:
            rows = self.q("SELECT * FROM messages WHERE fallback_state = 'pending' AND status IN ('sent', 'failed')"
                          " AND finished IS NOT NULL")
            for row in rows:
                message = self._message_row(row)
                spec = message["fallback"]
                if message["finished"] + spec["after"] > now:
                    continue
                if self._chain_counter(message, FALLBACK_COUNTERS[spec.get("unless", "clicked")]) > 0:
                    self.x("UPDATE messages SET fallback_state = 'skipped' WHERE id = ?", (message["id"],))
                    continue
                follow_up = self.create_message(message["app_id"], {
                    "title": spec.get("title") or message["title"],
                    "body": spec.get("body") or message["body"],
                    "url": message["url"],
                    "icon": message["icon"],
                    "tag": message["tag"],
                    "data": {**message["data"], "fallback_of": message["id"]},
                    "target": message["target"],
                    "channels": spec["channels"],
                    "ttl": message["ttl"],
                    "urgency": spec.get("urgency") or message["urgency"],
                    "parent_id": message["id"],
                    "category": message.get("category", ""),
                    "fallback": spec.get("fallback"),  # next step of a multi-step workflow
                })
                self.x("UPDATE messages SET fallback_state = 'sent', fallback_id = ? WHERE id = ?",
                       (follow_up["id"], message["id"]))
                created.append(follow_up)
        return created

    def _chain_counter(self, message: dict, counter: str) -> int:
        """Counter summed over the message and the earlier steps it escalated from."""
        total, current, seen = 0, message, set()
        while current and current["id"] not in seen:
            seen.add(current["id"])
            total += current.get(counter) or 0
            current = self.get_message(current["parent_id"]) if current.get("parent_id") else None
        return total

    def workflow(self, message_id: int) -> list[dict]:
        """Every step of the escalation chain this message belongs to, first step first."""
        message = self.get_message(message_id)
        seen = set()
        while message and message.get("parent_id") and message["id"] not in seen:
            seen.add(message["id"])
            message = self.get_message(message["parent_id"])
        steps = []
        while message and message["id"] not in {s["id"] for s in steps}:
            steps.append(message)
            message = self.get_message(message["fallback_id"]) if message.get("fallback_id") else None
        return steps

    def cancel_fallbacks_for_tag(self, app_id: int, tag: str) -> int:
        """Stop pending escalations of earlier messages with this tag (e.g. an alert that resolved)."""
        return self.x("UPDATE messages SET fallback_state = 'cancelled' WHERE app_id = ? AND tag = ?"
                      " AND fallback_state = 'pending'", (app_id, tag)).rowcount

    def cancel_fallback(self, message_id: int) -> bool:
        return bool(self.x("UPDATE messages SET fallback_state = 'cancelled' WHERE id = ? AND fallback_state = 'pending'",
                           (message_id,)).rowcount)

    @staticmethod
    def _message_row(row) -> dict:
        message = dict(row)
        for key in ("data", "target", "channels"):
            message[key] = json.loads(message[key])
        message["fallback"] = json.loads(message["fallback"]) if message.get("fallback") else None
        return message

    def get_message(self, message_id: int) -> dict | None:
        rows = self.q("SELECT * FROM messages WHERE id = ?", (message_id,))
        return self._message_row(rows[0]) if rows else None

    def list_messages(self, app_id: int | None = None, limit: int = 50) -> list[dict]:
        limit = max(1, min(int(limit), 500))
        if app_id:
            rows = self.q("SELECT * FROM messages WHERE app_id = ? ORDER BY id DESC LIMIT ?", (app_id, limit))
        else:
            rows = self.q("SELECT * FROM messages ORDER BY id DESC LIMIT ?", (limit,))
        return [self._message_row(r) for r in rows]

    def claim_due(self, now: float | None = None) -> list[dict]:
        now = now or time.time()
        claimed = []
        with self.lock:
            rows = self.q("SELECT id FROM messages WHERE status = 'queued' AND send_at <= ? ORDER BY send_at",
                          (now,))
            for row in rows:
                cursor = self.x("UPDATE messages SET status = 'sending' WHERE id = ? AND status = 'queued'",
                                (row["id"],))
                if cursor.rowcount:
                    claimed.append(self.get_message(row["id"]))
        return claimed

    def requeue_interrupted(self) -> int:
        """Messages left 'sending' by a crash go back to the queue on start-up."""
        return self.x("UPDATE messages SET status = 'queued' WHERE status = 'sending'").rowcount

    def cancel_message(self, message_id: int) -> bool:
        return bool(self.x("UPDATE messages SET status = 'cancelled' WHERE id = ? AND status = 'queued'",
                           (message_id,)).rowcount)

    def bump(self, message_id: int, counter: str, amount: int = 1) -> None:
        if counter not in MESSAGE_COUNTERS:
            raise ValueError(counter)
        self.x(f"UPDATE messages SET {counter} = {counter} + ? WHERE id = ?", (amount, message_id))

    def finish_message(self, message_id: int, status: str, error: str = "") -> None:
        self.x("UPDATE messages SET status = ?, finished = ?, error = ? WHERE id = ?",
               (status, time.time(), error[:500], message_id))

    def inbox(self, app_id: int, subscriber: dict | None, since: float = 0, limit: int = 30) -> list[dict]:
        rows = self.q(
            "SELECT * FROM messages WHERE app_id = ? AND status = 'sent' AND channels LIKE '%inapp%'"
            " AND created > ? ORDER BY id DESC LIMIT 200",
            (app_id, max(since, time.time() - 30 * 86400)),
        )
        out = []
        for message in (self._message_row(r) for r in rows):
            target = message["target"]
            if subscriber is None:
                if not target or target.get("all"):
                    out.append(message)
            elif matches_target(subscriber, target):
                kept, _ = self.apply_preferences(app_id, [subscriber], message.get("category", ""), channel="inapp")
                if kept:
                    out.append(message)
            if len(out) >= limit:
                break
        return out

    def stats(self, app_id: int, days: int = 30) -> dict:
        since = time.time() - days * 86400
        totals = self.q(
            "SELECT COUNT(*) AS messages, COALESCE(SUM(targeted),0) AS targeted,"
            " COALESCE(SUM(delivered),0) AS delivered, COALESCE(SUM(failed),0) AS failed,"
            " COALESCE(SUM(pruned),0) AS pruned, COALESCE(SUM(shown),0) AS shown,"
            " COALESCE(SUM(clicked),0) AS clicked FROM messages WHERE app_id = ? AND created > ?",
            (app_id, since),
        )[0]
        subs = self.q(
            "SELECT channel, COUNT(*) AS n FROM subscribers WHERE app_id = ? GROUP BY channel", (app_id,)
        )
        result = dict(totals)
        result["subscribers"] = {r["channel"]: r["n"] for r in subs}
        result["click_rate"] = round(result["clicked"] / result["delivered"], 4) if result["delivered"] else 0
        result["days"] = days
        return result

    # ------------------------------------------------- categories + preferences
    def upsert_category(self, app_id: int, key: str, name: str = "", description: str = "",
                        critical: bool = False, default_enabled: bool = True) -> dict:
        self.x("INSERT INTO categories(app_id, key, name, description, critical, default_enabled, created)"
               " VALUES(?,?,?,?,?,?,?) ON CONFLICT(app_id, key) DO UPDATE SET name = excluded.name,"
               " description = excluded.description, critical = excluded.critical,"
               " default_enabled = excluded.default_enabled",
               (app_id, key, name, description, int(bool(critical)), int(bool(default_enabled)), time.time()))
        return self.get_category(app_id, key)

    @staticmethod
    def _category_row(row) -> dict:
        category = dict(row)
        category["critical"] = bool(category["critical"])
        category["default_enabled"] = bool(category["default_enabled"])
        category.pop("app_id", None)
        return category

    def get_category(self, app_id: int, key: str) -> dict | None:
        rows = self.q("SELECT * FROM categories WHERE app_id = ? AND key = ?", (app_id, key))
        return self._category_row(rows[0]) if rows else None

    def list_categories(self, app_id: int) -> list[dict]:
        return [self._category_row(r) for r in self.q("SELECT * FROM categories WHERE app_id = ? ORDER BY key",
                                                       (app_id,))]

    def delete_category(self, app_id: int, key: str) -> bool:
        return bool(self.x("DELETE FROM categories WHERE app_id = ? AND key = ?", (app_id, key)).rowcount)

    @staticmethod
    def owner_of(subscriber: dict, scope: str = "auto") -> str:
        """Preferences set from a device apply to its user (all their devices) when it has one."""
        if scope == "subscriber" or not subscriber.get("user_id"):
            return f"sub:{subscriber['id']}"
        return f"user:{subscriber['user_id']}"

    def set_preference(self, app_id: int, owner: str, category: str, enabled: bool | None = None,
                       channels: list[str] | None = None) -> None:
        """Upsert one preference; enabled=None and channels=None removes it (back to the default)."""
        if enabled is None and channels is None:
            self.x("DELETE FROM preferences WHERE app_id = ? AND owner = ? AND category = ?",
                   (app_id, owner, category))
            return
        rows = self.q("SELECT enabled, channels FROM preferences WHERE app_id = ? AND owner = ? AND category = ?",
                      (app_id, owner, category))
        current_enabled = bool(rows[0]["enabled"]) if rows else True
        current_channels = rows[0]["channels"] if rows else ""
        self.x("INSERT INTO preferences(app_id, owner, category, enabled, channels, updated) VALUES(?,?,?,?,?,?)"
               " ON CONFLICT(app_id, owner, category) DO UPDATE SET enabled = excluded.enabled,"
               " channels = excluded.channels, updated = excluded.updated",
               (app_id, owner, category, int(current_enabled if enabled is None else bool(enabled)),
                current_channels if channels is None else (json.dumps(sorted(set(channels))) if channels else ""),
                time.time()))

    def _preference_map(self, app_id: int, owners: set[str]) -> dict:
        if not owners:
            return {}
        owners = sorted(owners)
        prefs = {}
        for start in range(0, len(owners), 500):
            chunk = owners[start:start + 500]
            marks = ",".join("?" for _ in chunk)
            for row in self.q(f"SELECT owner, category, enabled, channels FROM preferences WHERE app_id = ?"
                              f" AND owner IN ({marks})", (app_id, *chunk)):
                prefs[(row["owner"], row["category"])] = {
                    "enabled": bool(row["enabled"]),
                    "channels": json.loads(row["channels"]) if row["channels"] else None,
                }
        return prefs

    @staticmethod
    def _resolve(prefs: dict, owners: list[str], category: str, default_enabled: bool) -> tuple[dict, str]:
        """Most specific wins: subscriber+category, user+category, subscriber '*', user '*', default."""
        keys = [(owner, category) for owner in owners if category] + [(owner, ALL_CATEGORIES) for owner in owners]
        for key in keys:
            if key in prefs:
                return prefs[key], f"{key[0]}/{key[1]}"
        return {"enabled": default_enabled, "channels": None}, "default"

    @staticmethod
    def _owners(subscriber: dict) -> list[str]:
        owners = [f"sub:{subscriber['id']}"]
        if subscriber.get("user_id"):
            owners.append(f"user:{subscriber['user_id']}")
        return owners

    def apply_preferences(self, app_id: int, subscribers: list[dict], category: str = "",
                          channel: str | None = None) -> tuple[list[dict], int]:
        """Drop subscribers who opted out of this category (or of their channel for it).

        Returns (kept, suppressed_count). Critical categories are never filtered.
        `channel` overrides the subscriber's own channel (used for the in-app inbox).
        """
        if not subscribers:
            return subscribers, 0
        registered = self.get_category(app_id, category) if category else None
        if registered and registered["critical"]:
            return subscribers, 0
        default_enabled = registered["default_enabled"] if registered else True
        owners = {owner for sub in subscribers for owner in self._owners(sub)}
        prefs = self._preference_map(app_id, owners)
        if not prefs and default_enabled:
            return subscribers, 0
        kept = []
        for subscriber in subscribers:
            pref, _source = self._resolve(prefs, self._owners(subscriber), category, default_enabled)
            used_channel = channel or subscriber["channel"]
            if pref["enabled"] and (not pref["channels"] or used_channel in pref["channels"]):
                kept.append(subscriber)
        return kept, len(subscribers) - len(kept)

    def preferences_for(self, app_id: int, subscriber: dict | None = None, user_id: str = "") -> dict:
        """Effective settings per category for a subscriber (device) or a user, plus the raw rows."""
        if subscriber is not None:
            owners = self._owners(subscriber)
        else:
            owners = [f"user:{user_id}"]
        prefs = self._preference_map(app_id, set(owners))
        categories = self.list_categories(app_id)
        known = {c["key"] for c in categories}
        extra = sorted({category for (_owner, category) in prefs if category not in known and category != "*"})
        effective = []
        for category in categories + [{"key": key, "name": "", "description": "", "critical": False,
                                        "default_enabled": True} for key in extra]:
            pref, source = self._resolve(prefs, owners, category["key"], category["default_enabled"])
            effective.append({
                "category": category["key"],
                "name": category.get("name", ""),
                "description": category.get("description", ""),
                "critical": category["critical"],
                "enabled": True if category["critical"] else pref["enabled"],
                "channels": None if category["critical"] else pref["channels"],
                "source": "critical" if category["critical"] else source,
            })
        overall, source = self._resolve(prefs, owners, "", True)
        return {
            "all": {"enabled": overall["enabled"], "channels": overall["channels"], "source": source},
            "categories": effective,
            "raw": [{"owner": owner, "category": category, **value} for (owner, category), value in sorted(prefs.items())],
        }

    # ----------------------------------------------------------------- templates
    def save_template(self, app_id: int, name: str, spec: dict) -> dict:
        now = time.time()
        self.x("INSERT INTO templates(app_id, name, spec, created, updated) VALUES(?,?,?,?,?)"
               " ON CONFLICT(app_id, name) DO UPDATE SET spec = excluded.spec, updated = excluded.updated",
               (app_id, name, json.dumps(spec), now, now))
        return self.get_template(app_id, name)

    def get_template(self, app_id: int, name: str) -> dict | None:
        rows = self.q("SELECT * FROM templates WHERE app_id = ? AND name = ?", (app_id, name))
        if not rows:
            return None
        row = dict(rows[0])
        return {"name": row["name"], **json.loads(row["spec"]), "created": row["created"], "updated": row["updated"]}

    def list_templates(self, app_id: int) -> list[dict]:
        names = [r["name"] for r in self.q("SELECT name FROM templates WHERE app_id = ? ORDER BY name", (app_id,))]
        return [self.get_template(app_id, name) for name in names]

    def delete_template(self, app_id: int, name: str) -> bool:
        return bool(self.x("DELETE FROM templates WHERE app_id = ? AND name = ?", (app_id, name)).rowcount)

    # --------------------------------------------------------------- tracking
    def track_signature(self, message_id: int) -> str:
        mac = hmac.new(self.server_secret.encode(), f"msg:{message_id}".encode(), hashlib.sha256)
        return mac.hexdigest()[:16]

    def check_track_signature(self, message_id: int, signature: str) -> bool:
        return hmac.compare_digest(self.track_signature(message_id), signature or "")
