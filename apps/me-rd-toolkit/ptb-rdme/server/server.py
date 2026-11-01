"""HTTP server for PTB RDME Widget.

Flask-free stdlib server bound to 0.0.0.0:8050 so the whole LAN can reach
the OT widget. Routes:

  GET  /                       -> web UI
  GET  /static/<file>          -> static assets
  GET  /api/colleagues         -> list of PTB RD ME colleagues
  POST /api/colleagues         -> upsert colleague (admin)
  GET  /api/ot/today           -> today's proposals
  GET  /api/ot/range?start=&end=  -> range query
  POST /api/ot                 -> submit a new proposal
  POST /api/ot/<id>/status     -> update proposal status (consolidator)
  GET  /api/ot/export?date=    -> .xlsx export for a single date
  GET  /api/email/drafts        -> local Outlook drafts (works only on local PC)
  GET  /api/email/inbox-unread -> local unread count
  GET  /api/status             -> {running, db_ok, scheduler_alive, local_outlook}

The OT side is shared across the LAN. The email-drafts side only works
when the server is running on a PC with Outlook desktop installed.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import re
import threading
import urllib.parse
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import db, email_drafts, excel_writer, helpers

log = logging.getLogger("ptb_rdme.http")

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "ptb_rdme.sqlite3"

MIME = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
}


def _serve_file(handler, path: Path, default_mime: str = "application/octet-stream"):
    if not path.exists() or not path.is_file():
        handler.send_error(404)
        return
    mime = MIME.get(path.suffix.lower(), default_mime)
    if mime.startswith("text/") or mime in (
        "application/javascript",
        "application/json",
        "application/manifest+json",
    ):
        body = path.read_text(encoding="utf-8", errors="replace").encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", mime + "; charset=utf-8")
        handler.send_header("Cache-Control", "no-cache")
        handler.end_headers()
        handler.wfile.write(body)
    else:
        body = path.read_bytes()
        handler.send_response(200)
        handler.send_header("Content-Type", mime)
        handler.send_header("Content-Length", str(len(body)))
        handler.end_headers()
        handler.wfile.write(body)


def _send_json(handler, obj, status: int = 200):
    body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _read_body(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    if n == 0:
        return {}
    try:
        return json.loads(handler.rfile.read(n).decode("utf-8"))
    except Exception:
        return {}


def _init_db_on_start():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        db.init_db(DB_PATH)
    except OSError:
        # Read-only import (frozen _MEIPASS): the embedded host re-points DB_PATH at a writable
        # folder and initialises the schema before calling start().
        pass


_init_db_on_start()


def _status() -> dict:
    return {
        "running": True,
        "db_ok": DB_PATH.exists(),
        "today": helpers.get_today_local().isoformat(),
        "weekday": helpers.day_of_week_label(helpers.get_today_local()),
    }


def _colleagues():
    return db.list_colleagues(DB_PATH)


def _ot_today():
    today = helpers.get_today_local().isoformat()
    rows = db.list_ot_for_date(DB_PATH, today)
    colleagues = {c["id"]: c["name"] for c in _colleagues()}
    for r in rows:
        r["name"] = colleagues.get(r["colleague_id"], r["colleague_id"])
    return {"date": today, "rows": rows, "submitted_ids": [r["colleague_id"] for r in rows]}


def _ot_range(start: str, end: str):
    rows = db.list_ot_in_range(DB_PATH, start, end)
    colleagues = {c["id"]: c["name"] for c in _colleagues()}
    for r in rows:
        r["name"] = colleagues.get(r["colleague_id"], r["colleague_id"])
    return {"start": start, "end": end, "rows": rows}


def _ot_submit(payload: dict):
    required = ("colleague_id", "ot_date", "start_time", "end_time", "total_hours", "reason", "project_code")
    missing = [k for k in required if not payload.get(k)]
    if missing:
        return {"ok": False, "error": f"missing: {', '.join(missing)}"}, 400
    try:
        d = helpers.parse_iso(payload["ot_date"])
        if not d:
            return {"ok": False, "error": "invalid ot_date"}, 400
        ot_id = db.submit_ot(
            DB_PATH,
            colleague_id=payload["colleague_id"],
            ot_date=payload["ot_date"],
            day_of_week=helpers.day_of_week_label(d),
            start_time=payload["start_time"],
            end_time=payload["end_time"],
            total_hours=float(payload["total_hours"]),
            reason=payload["reason"],
            project_code=payload["project_code"],
            submitted_at=datetime.now().isoformat(timespec="seconds"),
            includes_saturday_ot=bool(payload.get("includes_saturday_ot")),
            saturday_start_time=payload.get("saturday_start_time"),
            saturday_end_time=payload.get("saturday_end_time"),
            saturday_total_hours=payload.get("saturday_total_hours"),
            saturday_reason=payload.get("saturday_reason"),
            saturday_project_code=payload.get("saturday_project_code"),
            notes=payload.get("notes"),
        )
        return {"ok": True, "id": ot_id}, 200
    except Exception as e:
        return {"ok": False, "error": str(e)}, 400


def _ot_export(date_str: str):
    d = helpers.parse_iso(date_str)
    if not d:
        return None
    rows = db.list_ot_for_date(DB_PATH, date_str)
    colleagues = {c["id"]: c["name"] for c in _colleagues()}
    for r in rows:
        r["name"] = colleagues.get(r["colleague_id"], r["colleague_id"])
    data = excel_writer.write_ot_application_bytes(rows)
    return data


CID_PATTERN = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
EID_PATTERN = re.compile(r"^[A-Za-z0-9+/=.-]+$")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        log.debug(fmt % args)

    def send_response(self, code, message=None):
        # Runs on every response — JSON, static files, the .xlsx export, and the
        # send_error 404/500 pages — so the origin header reaches all paths from one
        # spot. Don't re-add it in the per-route helpers (would duplicate).
        super().send_response(code, message)
        self.send_header("Access-Control-Allow-Origin", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path
            q = urllib.parse.parse_qs(parsed.query)

            if path == "/" or path == "/index.html":
                _serve_file(self, WEB / "index.html", "text/html")
                return
            if path.startswith("/static/"):
                rel = path[len("/static/"):]
                if ".." in rel:
                    self.send_error(403); return
                _serve_file(self, WEB / rel)
                return
            if path == "/manifest.webmanifest":
                _serve_file(self, WEB / "manifest.webmanifest")
                return
            if path == "/sw.js":
                _serve_file(self, WEB / "sw.js", "application/javascript")
                return
            if path == "/api/status":
                _send_json(self, _status()); return
            if path == "/api/colleagues":
                _send_json(self, _colleagues()); return
            if path == "/api/ot/today":
                _send_json(self, _ot_today()); return
            if path == "/api/ot/range":
                start = (q.get("start") or [helpers.get_today_local().isoformat()])[0]
                end = (q.get("end") or [start])[0]
                _send_json(self, _ot_range(start, end)); return
            if path == "/api/ot/export":
                date_str = (q.get("date") or [helpers.get_today_local().isoformat()])[0]
                data = _ot_export(date_str)
                if data is None:
                    _send_json(self, {"ok": False, "error": "invalid date"}, 400); return
                self.send_response(200)
                self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
                self.send_header("Content-Disposition", f'attachment; filename="ot_{date_str}.xlsx"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
            if path == "/api/email/drafts":
                _send_json(self, email_drafts.list_recent_drafts(20)); return
            if path == "/api/email/inbox-unread":
                _send_json(self, {"unread": email_drafts.get_inbox_unread_count()}); return
            self.send_error(404)
        except Exception:
            log.exception("GET handler error")
            self.send_error(500)

    def do_POST(self):
        try:
            parsed = urllib.parse.urlparse(self.path)
            path = parsed.path

            if path == "/api/ot":
                payload = _read_body(self)
                body, status = _ot_submit(payload)
                _send_json(self, body, status); return
            if path.startswith("/api/ot/"):
                parts = path[len("/api/ot/"):].split("/")
                if len(parts) == 2 and parts[1] == "status":
                    ot_id = int(parts[0])
                    payload = _read_body(self)
                    status = (payload.get("status") or "").strip()
                    if status not in ("proposed", "submitted", "approved", "rejected"):
                        _send_json(self, {"ok": False, "error": "invalid status"}, 400); return
                    db.update_ot_status(DB_PATH, ot_id, status)
                    _send_json(self, {"ok": True}); return
            if path == "/api/colleagues":
                payload = _read_body(self)
                required = ("id", "name")
                if not all(payload.get(k) for k in required):
                    _send_json(self, {"ok": False, "error": "id and name required"}, 400); return
                if not CID_PATTERN.match(payload["id"]):
                    _send_json(self, {"ok": False, "error": "invalid id"}, 400); return
                db.upsert_colleague(
                    DB_PATH,
                    colleague_id=payload["id"],
                    name=payload["name"],
                    email=payload.get("email", ""),
                    employee_id=payload.get("employee_id", ""),
                    department=payload.get("department", "PTB RD ME"),
                    supervisor=payload.get("supervisor", ""),
                    is_consolidator=bool(payload.get("is_consolidator")),
                    teams_webhook_override=payload.get("teams_webhook_override"),
                )
                _send_json(self, {"ok": True}); return
            self.send_error(404)
        except Exception:
            log.exception("POST handler error")
            self.send_error(500)


def start(host: str = "0.0.0.0", port: int = 8050) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=server.serve_forever, name="http", daemon=True)
    thread.start()
    log.info("HTTP server listening on http://%s:%d", host, port)
    return server
