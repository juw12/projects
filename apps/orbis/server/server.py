#!/usr/bin/env python3
"""Orbis prototype backend.

Zero-dependency HTTP server (Python standard library only) that serves the
static Orbis front-end and exposes a small JSON persistence API backed by
SQLite.

Usage:
    python server.py                 # http://127.0.0.1:8765/ (opens browser)
    python server.py --port 9000     # custom port
    python server.py --no-browser    # do not open a browser

The same API is reachable from a page opened directly via file:// because all
responses carry permissive CORS headers.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sqlite3
import threading
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from chat import ChatRouter, ChatService

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent
WEB_DIR = BASE_DIR.parent / "web"
APP_NAME = "orbis"
APP_VERSION = "1.0"

# Collection order defines the shape of GET /api/state.
COLLECTIONS = [
    "queue",
    "commitments",
    "summaries",
    "drafts",
    "aura",
    "culture",
    "growth",
    "sources",
    "audit",
    "settings",
    "work",
    "discover",
]

# The database location can be overridden with the ORBIS_DB environment
# variable (used by the test suite for isolation). The default is the file
# documented for the prototype.
DB_PATH = Path(os.environ.get("ORBIS_DB") or (BASE_DIR / "data" / "orbis.db"))

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
}

_DB_LOCK = threading.Lock()

# Multi-user chat (accounts, teams, real-time messaging). Created in main()
# or lazily on first use so the database path honours ORBIS_DB.
_CHAT_ROUTER = None
_CHAT_LOCK = threading.Lock()


def chat_router() -> ChatRouter:
    global _CHAT_ROUTER
    with _CHAT_LOCK:
        if _CHAT_ROUTER is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _CHAT_ROUTER = ChatRouter(ChatService(DB_PATH))
        return _CHAT_ROUTER

# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------


def _seed_audit() -> list:
    # Stored oldest-first so appended events land at the end; GET reverses.
    return [
        {"actor": "you", "action": "enabled quiet hours", "object": "settings",
         "time": "2026-10-08T22:00:00+00:00"},
        {"actor": "system", "action": "deleted expired refs", "object": "47 items",
         "time": "2026-10-10T03:00:00+00:00"},
        {"actor": "you", "action": "updated Aura", "object": "profile",
         "time": "2026-10-12T16:45:00+00:00"},
        {"actor": "you", "action": "connected source", "object": "Gmail",
         "time": "2026-10-15T09:15:00+00:00"},
        {"actor": "you", "action": "exported data", "object": "growth-data.json",
         "time": "2026-10-18T14:32:00+00:00"},
    ]


def build_seeds() -> dict:
    """Return the full first-run seed document for every collection."""
    return {
        "queue": [
            {"id": 1, "type": "reply", "subject": "Re: Revised quote timeline",
             "reason": "Client asked for the revised quote. You said you would send it Friday.",
             "source": 'Gmail - thread "Quote for Northwind" - Oct 15',
             "confidence": "Suggested - inferred", "committed": False,
             "snoozed": False, "dismissed": False, "hasDate": True},
            {"id": 2, "type": "reply", "subject": "Design system kickoff",
             "reason": "Meeting invite needs RSVP.",
             "source": "Slack - #design-system - Oct 16",
             "confidence": "Suggested - explicit", "committed": False,
             "snoozed": False, "dismissed": False, "hasDate": False},
            {"id": 3, "type": "commitment", "subject": "Send invoice reminder",
             "reason": "Stated commitment with deadline.",
             "source": "Email - Oct 10",
             "confidence": "Committed - stated", "committed": False,
             "snoozed": False, "dismissed": False, "hasDate": True},
            {"id": 4, "type": "reply", "subject": "Re: Portfolio review feedback",
             "reason": "Direct question requiring response.",
             "source": "Gmail - Oct 17",
             "confidence": "Suggested - inferred", "committed": False,
             "snoozed": False, "dismissed": False, "hasDate": False},
            {"id": 5, "type": "commitment", "subject": "Share sprint retrospective notes",
             "reason": "Team expectation from standup.",
             "source": "Slack - #team - Oct 18",
             "confidence": "Committed - stated", "committed": False,
             "snoozed": False, "dismissed": False, "hasDate": True},
        ],
        "commitments": [
            {"id": 1, "text": "Send revised quote to Northwind",
             "with": "Northwind Studio", "date": "2025-10-20", "status": "open",
             "confidence": "established", "source": "Email - Oct 15"},
            {"id": 2, "text": "Intro Alex to Maria re: design system",
             "with": "Alex Chen, Maria Santos", "date": "\u2014 not stated",
             "status": "open", "confidence": "proposed", "source": "Slack - Oct 16"},
            {"id": 3, "text": "Review Q4 roadmap draft", "with": "Product team",
             "date": "2025-10-18", "status": "done", "confidence": "established",
             "source": "Email - Oct 14"},
            {"id": 4, "text": "Follow up on invoice #2847", "with": "Finance",
             "date": "2025-10-17", "status": "overdue", "confidence": "established",
             "source": "Email - Oct 10"},
            {"id": 5, "text": "Prepare studio visit presentation", "with": "Client",
             "date": "2025-10-25", "status": "open", "confidence": "validation",
             "source": "WhatsApp - Oct 12"},
        ],
        "aura": {
            "workStyle": "Collaborative",
            "strengths": ["Strategic thinking", "Clear communication"],
            "growthEdges": "Delegating earlier when workload increases",
            "archetype": "Indigo",
            "portfolio": [
                {"title": "Senior Product Designer at Northwind Studio",
                 "link": "https://northwind.example", "shared": True},
            ],
            # Self-chosen AI response preferences. Stored but not yet applied:
            # the prototype has no live model (see docs).
            "aiPreferences": {
                "length": "short",
                "tone": "direct",
                "format": "bullets",
                "askClarifying": True,
            },
        },
        "culture": {
            "workspace": "Northwind Studio",
            "role": "member",
            "rules": [
                {"id": 1, "title": "Working hours",
                 "text": "Core hours are 10:00-16:00. Flexible outside these hours.",
                 "why": "Ensures overlap for collaboration while respecting individual schedules."},
                {"id": 2, "title": "Tone of messages",
                 "text": "Direct but kind. Assume positive intent.",
                 "why": "Reduces ambiguity while maintaining psychological safety."},
                {"id": 3, "title": "Approval steps",
                 "text": "Design decisions need 2 approvals. Code needs 1.",
                 "why": "Balances quality with velocity."},
                {"id": 4, "title": "Quiet-hour defaults",
                 "text": "No notifications 22:00-08:00 unless marked urgent.",
                 "why": "Protects focus time and work-life boundaries."},
            ],
        },
        "growth": {
            "curriculum": [
                {"title": "Product Strategy",
                 "desc": "Market analysis, positioning, roadmap planning",
                 "status": "in progress"},
                {"title": "Leadership Communication",
                 "desc": "Stakeholder management, difficult conversations",
                 "status": "in progress"},
                {"title": "Advanced Data Visualization",
                 "desc": "D3.js, interactive dashboards", "status": "not now"},
            ],
            "keyResults": [
                {"title": "Ship 4 major features this quarter",
                 "baseline": 0, "target": 4, "current": 3},
                {"title": "Reduce meeting time by 30%",
                 "baseline": "20 hrs/wk", "target": "14 hrs", "current": "15.6 hrs"},
            ],
            "sessions": [
                {"id": 1, "date": "2026-10-19", "minutes": 45,
                 "category": "Product Strategy", "output": "Drafted positioning statement",
                 "reflection": "Good focus, lost 10 min on Slack"},
            ],
            "review": {"output": "", "blockers": "", "energy": ""},
            "metrics": [
                {"metric": "Planning time", "baseline": "60 min",
                 "current": "25 min", "change": "-58%"},
                {"metric": "Time to start", "baseline": "3 days",
                 "current": "1 day", "change": "-66%"},
                {"metric": "Completion rate", "baseline": "40%",
                 "current": "75%", "change": "+35 pts"},
                {"metric": "Consistency", "baseline": "2/wk",
                 "current": "4/wk", "change": "+2"},
            ],
        },
        "summaries": [
            {
                "id": 1,
                "title": "Q4 Roadmap Discussion",
                "participants": "Product Team",
                "date": "Oct 14, 2025",
                "mainTopic": "Prioritization of features for Q4 release cycle.",
                "decisions": ["Feature A moved to Q1 2026", "Feature B fast-tracked for November", "Design review scheduled for Oct 22"],
                "openQuestions": ["Resource allocation for Feature B", "Timeline for user testing"],
                "facts": ["Q4 release planned for December 15", "Team capacity at 85%", "Feature A depends on API v2"],
                "guesses": ["Client may request timeline change", "Budget approval might slip"],
                "source": "Slack thread \u00b7 #product-strategy \u00b7 Oct 14",
            },
            {
                "id": 2,
                "title": "Northwind Quote Revision",
                "participants": "You, Maria Santos (Northwind)",
                "date": "Oct 15, 2025",
                "mainTopic": "Revised pricing for the design system project.",
                "decisions": ["10% discount applied for annual contract", "Payment terms: Net 30", "Kickoff call scheduled"],
                "openQuestions": ["Final deliverable format", "Number of revision rounds included"],
                "facts": ["Original quote: $45,000", "Revised quote: $40,500", "Annual contract committed"],
                "guesses": ["Client comparing with other vendors", "May request additional services"],
                "source": "Gmail thread \u00b7 \"Quote for Northwind\" \u00b7 Oct 15",
            },
        ],
        "drafts": [
            {
                "id": 1,
                "recipient": "Maria Santos",
                "subject": "Re: Revised quote timeline",
                "text": "Hi Maria,\n\nThanks for your patience. I've attached the revised quote with the 10% annual discount applied.\n\nKey changes:\n- Total: $40,500 (was $45,000)\n- Payment terms: Net 30\n- Includes 3 revision rounds\n\nLet me know if you have any questions. Ready to kick off whenever you are.\n\nBest,\nAlex",
                "reason": "Responding to quote request with revised pricing.",
                "source": "Gmail \u00b7 thread \"Quote for Northwind\"",
            },
            {
                "id": 2,
                "recipient": "Team",
                "subject": "Re: Design system kickoff",
                "text": "Hey team,\n\nCount me in for the design system kickoff. I've reviewed the initial docs and have a few thoughts:\n\n1. Should we align with Material Design tokens?\n2. Can we schedule weekly syncs?\n3. I can own the documentation piece.\n\nSee you Thursday!\n\n\u2014 Alex",
                "reason": "RSVP to meeting with added context.",
                "source": "Slack \u00b7 #design-system \u00b7 Oct 16",
            },
        ],
        "sources": {"gmail": True, "whatsapp": False, "slack": False},
        "audit": _seed_audit(),
        "settings": {"quietHours": True, "aiPaused": False, "theme": "light"},
        "work": {
            "roles": [
                {"id": 1, "title": "Barista", "company": "Kopi Nusantara", "location": "Jakarta Selatan", "type": "Full-time", "category": "F&B", "salary": "Rp3-4 jt/bln", "match": 92, "verified": True, "tags": ["No experience", "High school", "THR + bonus"], "about": "Make coffee, serve customers and keep the bar area clean.", "posted": "2 days ago"},
                {"id": 2, "title": "Cashier (Part-time)", "company": "Kopi Nusantara", "location": "Jakarta Selatan", "type": "Part-time", "category": "F&B", "salary": "Rp2-2.6 jt/bln", "match": 85, "verified": True, "tags": ["0-1 year", "Night shift", "Meal allowance"], "about": "Handle payments and prepare daily transaction reports.", "posted": "1 day ago"},
                {"id": 3, "title": "Motorbike Courier", "company": "PT Kirim Cepat", "location": "Tangerang", "type": "Full-time", "category": "Logistics", "salary": "Rp3.5-5 jt/bln", "match": 78, "verified": True, "tags": ["No experience", "Owns a motorbike", "SIM C"], "about": "Deliver packages to customers following the app route.", "posted": "3 days ago"},
                {"id": 4, "title": "Sales Associate", "company": "Elektronik Jaya", "location": "Bandung", "type": "Full-time", "category": "Retail", "salary": "Rp2.8-3.2 jt/bln", "match": 70, "verified": False, "tags": ["0-1 year", "Good communicator"], "about": "Maintain the product display and assist shoppers.", "posted": "5 days ago"},
                {"id": 5, "title": "Restaurant Server", "company": "Sate Pak Kumis", "location": "Yogyakarta", "type": "Full-time", "category": "F&B", "salary": "Rp2.5-3 jt/bln", "match": 88, "verified": True, "tags": ["No experience", "2 meals provided"], "about": "Serve orders and attend to guests.", "posted": "4 days ago"},
                {"id": 6, "title": "Warehouse Admin", "company": "PT Kirim Cepat", "location": "Tangerang", "type": "Full-time", "category": "Logistics", "salary": "Rp4-4.8 jt/bln", "match": 65, "verified": True, "tags": ["1-3 years", "Diploma/Bachelor", "Microsoft Excel"], "about": "Record incoming/outgoing stock and prepare reports.", "posted": "6 days ago"}
            ],
            "employers": [
                {"id": 1, "name": "Kopi Nusantara", "industry": "F&B", "size": "50-100 employees", "funding": "Family business", "rating": 4.6, "verified": True},
                {"id": 2, "name": "Elektronik Jaya", "industry": "Retail", "size": "1-10 employees", "funding": "Family business", "rating": 3.9, "verified": False},
                {"id": 3, "name": "PT Kirim Cepat", "industry": "Logistics", "size": "500+ employees", "funding": "Series A funded", "rating": 4.2, "verified": True},
                {"id": 4, "name": "Sate Pak Kumis", "industry": "F&B", "size": "10-50 employees", "funding": "Family business", "rating": 4.8, "verified": True}
            ],
            "candidates": [
                {"id": 1, "name": "Dina Kusuma", "headline": "Experienced barista", "location": "Jakarta Selatan", "match": 94, "skills": ["Barista", "Customer Service"], "expectedSalary": "Rp3.5 jt"},
                {"id": 2, "name": "Rudi Hartono", "headline": "Motorbike courier", "location": "Tangerang", "match": 88, "skills": ["SIM C", "Navigation"], "expectedSalary": "Rp4 jt"},
                {"id": 3, "name": "Siti Nurhaliza", "headline": "Cashier & admin", "location": "Bandung", "match": 82, "skills": ["Cashier", "Microsoft Excel"], "expectedSalary": "Rp3 jt"},
                {"id": 4, "name": "Ahmad Fauzi", "headline": "Restaurant server", "location": "Yogyakarta", "match": 79, "skills": ["Service", "Communication"], "expectedSalary": "Rp2.8 jt"},
                {"id": 5, "name": "Maya Sari", "headline": "Sales & marketing", "location": "Jakarta", "match": 75, "skills": ["Sales", "Communication"], "expectedSalary": "Rp5 jt"}
            ],
            "interests": [],
            "applications": [],
        },
        # Public product discovery. Nothing in this collection is derived from
        # private messages, commitments or Work data. Seed listings are clearly
        # labeled mock examples; there are no seeded reviews, ratings or
        # testimonials. Submissions and reviews stay "pending" until a human
        # reviewer approves them.
        "discover": {
            "categories": [
                "Productivity", "Developer tools", "Learning",
                "Community", "Finance", "Wellness",
            ],
            "listings": [
                {
                    "id": "mock-nimbus-notes",
                    "title": "Nimbus Notes",
                    "tagline": "Turn meeting notes into decisions and follow-ups.",
                    "category": "Productivity",
                    "description": "A sample listing used to show the Discover layout. The product is fictional. It would capture decisions and open questions from a meeting and turn them into a short follow-up list.",
                    "maker": {"name": "Northwind Studio (sample maker)",
                              "url": "https://example.com/northwind"},
                    "productUrl": "https://example.com/nimbus-notes",
                    "claims": [
                        {"text": "Works offline.", "verified": False},
                        {"text": "Exports to Markdown.", "verified": False},
                    ],
                    "mock": True,
                    "status": "published",
                    "publishedAt": "2026-10-20",
                },
                {
                    "id": "mock-signal-stack",
                    "title": "Signal Stack",
                    "tagline": "A review queue for small product teams.",
                    "category": "Developer tools",
                    "description": "A sample listing used to show the Discover layout. The product is fictional. It would collect change proposals in one queue so a team can review them in a consistent order.",
                    "maker": {"name": "Sample Maker Collective (fictional)",
                              "url": "https://example.com/sample-collective"},
                    "productUrl": "https://example.com/signal-stack",
                    "claims": [
                        {"text": "Integrates with common version control hosts.", "verified": False},
                    ],
                    "mock": True,
                    "status": "published",
                    "publishedAt": "2026-10-19",
                },
                {
                    "id": "mock-orbit-learn",
                    "title": "Orbit Learn",
                    "tagline": "Short, practical courses with a visible syllabus.",
                    "category": "Learning",
                    "description": "A sample listing used to show the Discover layout. The product is fictional. Each course would state its outcomes, time estimate and what is not covered before anyone enrols.",
                    "maker": {"name": "Sample Learning Lab (fictional)",
                              "url": "https://example.com/sample-learning"},
                    "productUrl": "https://example.com/orbit-learn",
                    "claims": [
                        {"text": "Every course lists its prerequisites.", "verified": False},
                        {"text": "No subscription required.", "verified": False},
                    ],
                    "mock": True,
                    "status": "published",
                    "publishedAt": "2026-10-18",
                },
                {
                    "id": "mock-kopi-club",
                    "title": "Kopi Club",
                    "tagline": "A local noticeboard for coffee meetups.",
                    "category": "Community",
                    "description": "A sample listing used to show the Discover layout. The product is fictional. It would let a neighbourhood post small, in-person meetups with a clear host and capacity.",
                    "maker": {"name": "Sample Neighbourhood Group (fictional)",
                              "url": "https://example.com/sample-neighbourhood"},
                    "productUrl": "https://example.com/kopi-club",
                    "claims": [
                        {"text": "Events are moderated before publishing.", "verified": False},
                    ],
                    "mock": True,
                    "status": "published",
                    "publishedAt": "2026-10-17",
                },
                {
                    "id": "mock-groundwork",
                    "title": "Groundwork",
                    "tagline": "A simple budget for irregular income.",
                    "category": "Finance",
                    "description": "A sample listing used to show the Discover layout. The product is fictional. It would help a freelancer plan around uneven monthly income without connecting a bank account.",
                    "maker": {"name": "Sample Finance Studio (fictional)",
                              "url": "https://example.com/sample-finance"},
                    "productUrl": "https://example.com/groundwork",
                    "claims": [
                        {"text": "No bank connection needed.", "verified": False},
                        {"text": "Data stays on the device.", "verified": False},
                    ],
                    "mock": True,
                    "status": "published",
                    "publishedAt": "2026-10-16",
                },
                {
                    "id": "mock-still",
                    "title": "Still",
                    "tagline": "A focus timer that protects rest breaks.",
                    "category": "Wellness",
                    "description": "A sample listing used to show the Discover layout. The product is fictional. It would schedule focus blocks and treat breaks as part of the plan rather than an interruption.",
                    "maker": {"name": "Sample Wellness Co-op (fictional)",
                              "url": "https://example.com/sample-wellness"},
                    "productUrl": "https://example.com/still",
                    "claims": [
                        {"text": "No account required.", "verified": False},
                    ],
                    "mock": True,
                    "status": "published",
                    "publishedAt": "2026-10-15",
                },
            ],
            "submissions": [],
            "reviews": [],
            "reviewCriteria": [
                {"id": "clarity", "label": "Clarity of problem",
                 "hint": "Does the listing explain who the product is for and what it changes?"},
                {"id": "usefulness", "label": "Usefulness",
                 "hint": "Did it help with the job described, in your own use?"},
                {"id": "claims", "label": "Reliability of claims",
                 "hint": "Did the listing's claims hold up when you checked?"},
            ],
        },
    }


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    return sqlite3.connect(str(DB_PATH), timeout=10)


def init_db() -> None:
    """Create the table and seed it on first run."""
    with _DB_LOCK:
        conn = _connect()
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS store ("
                "collection TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            conn.commit()
            existing = {row[0] for row in conn.execute("SELECT collection FROM store").fetchall()}
        finally:
            conn.close()
    missing = [name for name in COLLECTIONS if name not in existing]
    if missing:
        seed_missing(missing)


def seed_all() -> None:
    seeds = build_seeds()
    with _DB_LOCK:
        conn = _connect()
        try:
            for name in COLLECTIONS:
                conn.execute(
                    "INSERT OR REPLACE INTO store(collection, value) VALUES(?, ?)",
                    (name, json.dumps(seeds[name], ensure_ascii=False)),
                )
            conn.commit()
        finally:
            conn.close()


def seed_missing(names) -> None:
    """Insert seed rows only for collections not yet present.

    Lets a database created by an older version gain new collections without
    wiping existing data.
    """
    seeds = build_seeds()
    with _DB_LOCK:
        conn = _connect()
        try:
            for name in names:
                conn.execute(
                    "INSERT OR REPLACE INTO store(collection, value) VALUES(?, ?)",
                    (name, json.dumps(seeds[name], ensure_ascii=False)),
                )
            conn.commit()
        finally:
            conn.close()


def reset_db() -> None:
    with _DB_LOCK:
        conn = _connect()
        try:
            conn.execute("DELETE FROM store")
            conn.commit()
        finally:
            conn.close()
    seed_all()


def get_value(name: str):
    with _DB_LOCK:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT value FROM store WHERE collection = ?", (name,)
            ).fetchone()
        finally:
            conn.close()
    return json.loads(row[0]) if row else None


def set_value(name: str, value) -> None:
    payload = json.dumps(value, ensure_ascii=False)
    with _DB_LOCK:
        conn = _connect()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO store(collection, value) VALUES(?, ?)",
                (name, payload),
            )
            conn.commit()
        finally:
            conn.close()


def get_all() -> dict:
    with _DB_LOCK:
        conn = _connect()
        try:
            rows = conn.execute("SELECT collection, value FROM store").fetchall()
        finally:
            conn.close()
    data = {}
    for name, raw in rows:
        data[name] = json.loads(raw)
    return data


def append_audit(actor: str, action: str, obj: str) -> dict:
    event = {
        "actor": actor,
        "action": action,
        "object": obj,
        "time": now_iso(),
    }
    with _DB_LOCK:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT value FROM store WHERE collection = 'audit'"
            ).fetchone()
            events = json.loads(row[0]) if row else []
            if not isinstance(events, list):
                events = []
            events.append(event)
            conn.execute(
                "INSERT OR REPLACE INTO store(collection, value) VALUES('audit', ?)",
                (json.dumps(events, ensure_ascii=False),),
            )
            conn.commit()
        finally:
            conn.close()
    return event


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def build_state() -> dict:
    data = get_all()
    return {name: data.get(name) for name in COLLECTIONS}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class OrbisHandler(BaseHTTPRequestHandler):
    server_version = "Orbis/" + APP_VERSION
    protocol_version = "HTTP/1.1"

    # -- low level helpers --------------------------------------------------

    def _send_bytes(self, status, body: bytes, content_type, extra=None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def send_json(self, status, obj, extra=None) -> None:
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        headers = {"Cache-Control": "no-store"}
        if extra:
            headers.update(extra)
        self._send_bytes(status, body, "application/json; charset=utf-8", headers)

    def send_error_json(self, status, message) -> None:
        self.send_json(status, {"error": message})

    def _read_body(self):
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        try:
            size = int(length)
        except (TypeError, ValueError):
            return b""
        if size <= 0:
            return b""
        return self.rfile.read(size)

    def _parse_body_json(self):
        """Return (ok, value_or_error). Malformed JSON -> (False, message)."""
        raw = self._read_body()
        if not raw:
            return False, "request body is empty"
        try:
            return True, json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False, "malformed JSON body"

    # -- routing ------------------------------------------------------------

    def do_OPTIONS(self):
        is_chat = urlparse(self.path).path.startswith("/api/chat")
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, PUT, POST, PATCH, DELETE, OPTIONS" if is_chat
            else "GET, PUT, POST, DELETE, OPTIONS",
        )
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Filename" if is_chat else "Content-Type",
        )
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self._route("GET")

    def do_GET(self):
        self._route("GET")

    def do_PUT(self):
        self._route("PUT")

    def do_POST(self):
        self._route("POST")

    def do_DELETE(self):
        self._route("DELETE")

    def do_PATCH(self):
        self._route("PATCH")

    def _route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/chat" or path.startswith("/api/chat/"):
            chat_router().handle(self, method, path, parsed.query)
            return
        if method in ("DELETE", "PATCH"):
            self.send_error_json(404, "not found")
            return
        if path.startswith("/api/"):
            self._handle_api(method, path[len("/api/"):])
        elif path == "/api":
            self.send_error_json(404, "not found")
        else:
            self._serve_static(path, method)

    # -- API ----------------------------------------------------------------

    def _handle_api(self, method, rest):
        segments = [seg for seg in rest.split("/") if seg]
        if not segments:
            self.send_error_json(404, "not found")
            return
        name = segments[0]

        if method == "GET":
            self._api_get(name)
        elif method == "PUT":
            self._api_put(name)
        elif method == "POST":
            self._api_post(name)
        else:
            self.send_error_json(404, "not found")

    def _api_get(self, name):
        if name == "health":
            self.send_json(200, {"status": "ok", "app": APP_NAME,
                                 "version": APP_VERSION, "chat": True})
            return
        if name == "state":
            self.send_json(200, build_state())
            return
        if name == "export":
            self.send_json(
                200,
                build_state(),
                {"Content-Disposition": 'attachment; filename="orbis-export.json"'},
            )
            return
        if name == "audit":
            events = get_value("audit")
            if not isinstance(events, list):
                events = []
            self.send_json(200, list(reversed(events)))
            return
        if name in COLLECTIONS:
            self.send_json(200, get_value(name))
            return
        self.send_error_json(404, "unknown collection: %s" % name)

    def _api_put(self, name):
        if name not in COLLECTIONS:
            self.send_error_json(404, "unknown collection: %s" % name)
            return
        ok, value = self._parse_body_json()
        if not ok:
            self.send_error_json(400, value)
            return
        set_value(name, value)
        append_audit("you", "update", name)
        self.send_json(200, {"ok": True, "collection": name, "value": value})

    def _api_post(self, name):
        if name == "audit":
            ok, body = self._parse_body_json()
            if not ok:
                self.send_error_json(400, body)
                return
            if not isinstance(body, dict):
                self.send_error_json(400, "audit body must be a JSON object")
                return
            actor = body.get("actor", "you")
            action = body.get("action", "event")
            obj = body.get("object", "")
            event = append_audit(actor, action, obj)
            self.send_json(200, event)
            return
        if name == "reset":
            reset_db()
            self.send_json(200, {"ok": True})
            return
        self.send_error_json(404, "not found")

    # -- static -------------------------------------------------------------

    def _serve_static(self, path, method):
        if path in ("", "/"):
            rel = "index.html"
        else:
            rel = unquote(path).lstrip("/")

        first = rel.replace("\\", "/").split("/", 1)[0]
        if first == "data":
            self.send_error_json(404, "not found")
            return

        try:
            target = (WEB_DIR / rel).resolve()
            target.relative_to(WEB_DIR)
        except ValueError:
            self.send_error_json(404, "not found")
            return

        if not target.is_file():
            self.send_error_json(404, "not found")
            return

        content_type = CONTENT_TYPES.get(
            target.suffix.lower(), "application/octet-stream"
        )
        body = target.read_bytes()
        self._send_bytes(200, body, content_type, {"Cache-Control": "no-cache"})

    # -- logging ------------------------------------------------------------

    def log_message(self, fmt, *args):  # keep the console tidy but informative
        line = fmt % args
        # Never write session tokens (EventSource sends them in the query) to logs.
        line = re.sub(r"token=[^&\s\"]+", "token=***", line)
        print("[orbis] %s - %s" % (self.address_string(), line))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def _lan_addresses():
    """Best-effort list of this machine's LAN IPv4 addresses."""
    found = []
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 1))
        found.append(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    return [ip for ip in found if not ip.startswith("127.")]


def main() -> None:
    parser = argparse.ArgumentParser(description="Orbis prototype server")
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("PORT", "8765")),
                        help="port to listen on (default 8765, or $PORT)")
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                        help="host to bind (default 127.0.0.1, or $HOST); "
                             "use 0.0.0.0 so phones on your Wi-Fi can connect")
    parser.add_argument("--no-browser", action="store_true",
                        help="do not open a browser window on start")
    args = parser.parse_args()

    init_db()
    chat_router()

    class OrbisServer(ThreadingHTTPServer):
        # ThreadingHTTPServer defaults to AF_INET; honour an IPv6 --host.
        address_family = socket.AF_INET6 if ":" in args.host else socket.AF_INET

    httpd = OrbisServer((args.host, args.port), OrbisHandler)
    httpd.daemon_threads = True
    display_host = "[%s]" % args.host if ":" in args.host else args.host
    url = "http://%s:%d/" % (display_host, args.port)

    print("Orbis prototype server")
    print("  serving: %s" % WEB_DIR)
    print("  database: %s" % DB_PATH)
    print("  url: %s" % url)
    print("  chat: %schat.html" % url)
    if args.host in ("0.0.0.0", "::"):
        for lan_ip in _lan_addresses():
            print("  on your Wi-Fi (phones): http://%s:%d/chat.html" % (lan_ip, args.port))
    email_mode = "SMTP " + os.environ["ORBIS_SMTP_HOST"] if os.environ.get("ORBIS_SMTP_HOST") \
        else "dev outbox (set ORBIS_SMTP_HOST to send real email)"
    print("  email: %s" % email_mode)
    print("  press Ctrl+C to stop")

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[orbis] shutting down")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
