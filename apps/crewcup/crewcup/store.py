"""SQLite persistence: state snapshot, append-only audit log, server secret. Standard library only."""

import json
import secrets
import sqlite3
import time
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    real_ts REAL NOT NULL,
    sim_ts INTEGER,
    actor TEXT,
    action TEXT NOT NULL,
    target TEXT,
    ok INTEGER NOT NULL,
    code TEXT,
    detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_action ON audit(action);
"""

# Fields never written to the audit log in clear text.
REDACT_KEYS = {"token", "x-callback-token", "secret", "password"}


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.executescript(SCHEMA)

    # -- key/value -------------------------------------------------------------

    def get(self, key):
        row = self.db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key, value):
        self.db.execute(
            "INSERT INTO kv(key, value, updated) VALUES(?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
            (key, json.dumps(value, ensure_ascii=False), time.time()),
        )

    def secret(self):
        value = self.get("server_secret")
        if not value:
            value = secrets.token_hex(32)
            self.put("server_secret", value)
        return bytes.fromhex(value)

    # -- audit -------------------------------------------------------------------

    def audit(self, actor, action, ok, sim_ts=None, target=None, code=None, detail=None):
        if isinstance(detail, dict):
            detail = {key: ("***" if key.lower() in REDACT_KEYS else value) for key, value in detail.items()}
        self.db.execute(
            "INSERT INTO audit(real_ts, sim_ts, actor, action, target, ok, code, detail) VALUES(?,?,?,?,?,?,?,?)",
            (time.time(), sim_ts, actor, action, target, 1 if ok else 0, code,
             json.dumps(detail, ensure_ascii=False)[:2000] if detail is not None else None),
        )

    def audit_rows(self, limit=100, action=None):
        query = "SELECT id, real_ts, sim_ts, actor, action, target, ok, code, detail FROM audit"
        params = []
        if action:
            query += " WHERE action = ?"
            params.append(action)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(int(limit))
        columns = ["id", "real_ts", "sim_ts", "actor", "action", "target", "ok", "code", "detail"]
        return [dict(zip(columns, row)) for row in self.db.execute(query, params).fetchall()]

    def clear_audit(self):
        self.db.execute("DELETE FROM audit")

    def close(self):
        self.db.close()
