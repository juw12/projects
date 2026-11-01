"""SQLite layer for PTB RDME Widget.

Owns the schema for OT tracking (colleagues + ot_proposals + reminder_log) and
email drafts (email_drafts). All stdlib — no SQLAlchemy. Use `connect()` to get
a connection; pass through to `init_db()` once on first run.

Schema is the same as the prior overtime-pulse schema, plus an `email_drafts`
table that the per-PC local mode reads from.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

_LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS colleagues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    employee_id TEXT,
    department TEXT,
    supervisor TEXT,
    is_consolidator INTEGER NOT NULL DEFAULT 0,
    teams_webhook_override TEXT
);

CREATE TABLE IF NOT EXISTS ot_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colleague_id TEXT NOT NULL,
    ot_date TEXT NOT NULL,
    day_of_week TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    total_hours REAL NOT NULL,
    reason TEXT,
    project_code TEXT,
    submitted_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed',
    includes_saturday_ot INTEGER NOT NULL DEFAULT 0,
    saturday_start_time TEXT,
    saturday_end_time TEXT,
    saturday_total_hours REAL,
    saturday_reason TEXT,
    saturday_project_code TEXT,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS reminder_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    colleague_id TEXT NOT NULL,
    ot_date TEXT NOT NULL,
    reminder_slot TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    channel TEXT NOT NULL,
    status_after TEXT,
    message TEXT
);

CREATE TABLE IF NOT EXISTS email_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    sender TEXT,
    to_addr TEXT,
    cc_addr TEXT,
    body_preview TEXT,
    outlook_entry_id TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ot_colleague_date ON ot_proposals(colleague_id, ot_date);
CREATE INDEX IF NOT EXISTS idx_reminder_colleague_date ON reminder_log(colleague_id, ot_date);
CREATE INDEX IF NOT EXISTS idx_email_status ON email_drafts(status);
"""


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(db_path), isolation_level=None)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db(db_path: Path) -> None:
    with _LOCK:
        con = _connect(db_path)
        try:
            con.executescript(SCHEMA)
        finally:
            con.close()


@contextmanager
def connect(db_path: Path):
    con = _connect(db_path)
    try:
        yield con
    finally:
        con.close()


# ---------- Colleagues ----------


def upsert_colleague(
    db_path: Path,
    colleague_id: str,
    name: str,
    email: str = "",
    employee_id: str = "",
    department: str = "PTB RD ME",
    supervisor: str = "",
    is_consolidator: bool = False,
    teams_webhook_override: str | None = None,
) -> None:
    with connect(db_path) as con:
        con.execute(
            """INSERT INTO colleagues (id, name, email, employee_id, department, supervisor, is_consolidator, teams_webhook_override)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name,
                 email=COALESCE(excluded.email, colleagues.email),
                 employee_id=COALESCE(excluded.employee_id, colleagues.employee_id),
                 department=COALESCE(excluded.department, colleagues.department),
                 supervisor=COALESCE(excluded.supervisor, colleagues.supervisor),
                 is_consolidator=excluded.is_consolidator,
                 teams_webhook_override=COALESCE(excluded.teams_webhook_override, colleagues.teams_webhook_override)""",
            (
                colleague_id,
                name,
                email,
                employee_id,
                department,
                supervisor,
                1 if is_consolidator else 0,
                teams_webhook_override,
            ),
        )


def list_colleagues(db_path: Path) -> list[dict]:
    with connect(db_path) as con:
        rows = con.execute(
            "SELECT * FROM colleagues ORDER BY is_consolidator DESC, name ASC"
        ).fetchall()
    return [dict(r) for r in rows]


# ---------- OT proposals ----------


def submit_ot(
    db_path: Path,
    *,
    colleague_id: str,
    ot_date: str,
    day_of_week: str,
    start_time: str,
    end_time: str,
    total_hours: float,
    reason: str,
    project_code: str,
    submitted_at: str,
    includes_saturday_ot: bool = False,
    saturday_start_time: str | None = None,
    saturday_end_time: str | None = None,
    saturday_total_hours: float | None = None,
    saturday_reason: str | None = None,
    saturday_project_code: str | None = None,
    notes: str | None = None,
) -> int:
    with connect(db_path) as con:
        cur = con.execute(
            """INSERT INTO ot_proposals (
                colleague_id, ot_date, day_of_week, start_time, end_time, total_hours,
                reason, project_code, submitted_at, status, includes_saturday_ot,
                saturday_start_time, saturday_end_time, saturday_total_hours,
                saturday_reason, saturday_project_code, notes
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                colleague_id, ot_date, day_of_week, start_time, end_time, total_hours,
                reason, project_code, submitted_at, "proposed", int(bool(includes_saturday_ot)),
                saturday_start_time, saturday_end_time, saturday_total_hours,
                saturday_reason, saturday_project_code, notes,
            ),
        )
        return int(cur.lastrowid)


def list_ot_for_date(db_path: Path, ot_date: str) -> list[dict]:
    with connect(db_path) as con:
        rows = con.execute(
            "SELECT * FROM ot_proposals WHERE ot_date = ? ORDER BY submitted_at", (ot_date,)
        ).fetchall()
    return [dict(r) for r in rows]


def list_ot_in_range(db_path: Path, start_date: str, end_date: str) -> list[dict]:
    with connect(db_path) as con:
        rows = con.execute(
            "SELECT * FROM ot_proposals WHERE ot_date BETWEEN ? AND ? ORDER BY ot_date, colleague_id",
            (start_date, end_date),
        ).fetchall()
    return [dict(r) for r in rows]


def update_ot_status(db_path: Path, ot_id: int, status: str) -> None:
    with connect(db_path) as con:
        con.execute("UPDATE ot_proposals SET status = ? WHERE id = ?", (status, ot_id))


# ---------- Reminder log ----------


def log_reminder(
    db_path: Path,
    colleague_id: str,
    ot_date: str,
    reminder_slot: str,
    sent_at: str,
    channel: str,
    status_after: str,
    message: str,
) -> int:
    with connect(db_path) as con:
        cur = con.execute(
            """INSERT INTO reminder_log (colleague_id, ot_date, reminder_slot, sent_at, channel, status_after, message)
               VALUES (?,?,?,?,?,?,?)""",
            (colleague_id, ot_date, reminder_slot, sent_at, channel, status_after, message),
        )
        return int(cur.lastrowid)


def reminders_for(db_path: Path, colleague_id: str, ot_date: str) -> list[dict]:
    with connect(db_path) as con:
        rows = con.execute(
            "SELECT * FROM reminder_log WHERE colleague_id = ? AND ot_date = ? ORDER BY id",
            (colleague_id, ot_date),
        ).fetchall()
    return [dict(r) for r in rows]


# ---------- Email drafts ----------


def upsert_email_draft(
    db_path: Path,
    *,
    subject: str,
    sender: str,
    to_addr: str,
    cc_addr: str,
    body_preview: str,
    outlook_entry_id: str,
    created_at: str,
    status: str = "pending",
) -> int:
    with connect(db_path) as con:
        cur = con.execute(
            """INSERT INTO email_drafts
                (subject, sender, to_addr, cc_addr, body_preview, outlook_entry_id, created_at, status)
                VALUES (?,?,?,?,?,?,?,?)""",
            (subject, sender, to_addr, cc_addr, body_preview, outlook_entry_id, created_at, status),
        )
        return int(cur.lastrowid)


def list_email_drafts(db_path: Path, status: str | None = None) -> list[dict]:
    with connect(db_path) as con:
        if status:
            rows = con.execute(
                "SELECT * FROM email_drafts WHERE status = ? ORDER BY created_at DESC",
                (status,),
            ).fetchall()
        else:
            rows = con.execute(
                "SELECT * FROM email_drafts ORDER BY created_at DESC"
            ).fetchall()
    return [dict(r) for r in rows]


def set_email_status(db_path: Path, draft_id: int, status: str) -> None:
    with connect(db_path) as con:
        con.execute(
            "UPDATE email_drafts SET status = ?, decided_at = datetime('now') WHERE id = ?",
            (status, draft_id),
        )
