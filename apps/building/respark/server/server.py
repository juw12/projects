"""
Respark Server
==============
Zero-dependency Python stdlib + SQLite.
Powers the Respark customer reactivation SaaS.

Run:
    python server/server.py            # start on http://localhost:8000
    python server/server.py --port X   # custom port
    RESPARK_SECRET=test python tests/verify.py   # hermetic verification (40 checks)

Environment variables (see .env.example):
    RESPARK_SECRET           long random string for session signing (REQUIRED in prod)
    RESPARK_BASE_URL         https://yourdomain.com   (used in links)
    RESPARK_SMTP_HOST        smtp.example.com         (optional; logs to file if unset)
    RESPARK_SMTP_PORT        587
    RESPARK_SMTP_USER        ...
    RESPARK_SMTP_PASS        ...
    RESPARK_SMTP_FROM        "Respark <hello@yourdomain.com>"
    RESPARK_OPENAI_API_KEY   sk-...                   (optional; uses templates if unset)
    RESPARK_ALLOW_SIGNUP     1                        (set to 0 to disable public signup)
"""

import argparse
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import secrets
import smtplib
import sqlite3
import ssl
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(ROOT, "web")
LOG_DIR = os.path.join(ROOT, "logs")
DB_PATH = os.path.join(ROOT, "data.db")
LOG_FILE = os.path.join(LOG_DIR, "outbox.log")
APP_LOG = os.path.join(LOG_DIR, "app.log")

os.makedirs(LOG_DIR, exist_ok=True)

SECRET = os.environ.get("RESPARK_SECRET") or ("dev-only-" + secrets.token_hex(16))
BASE_URL = os.environ.get("RESPARK_BASE_URL", "http://localhost:8000")
SMTP_HOST = os.environ.get("RESPARK_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("RESPARK_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("RESPARK_SMTP_USER", "")
SMTP_PASS = os.environ.get("RESPARK_SMTP_PASS", "")
SMTP_FROM = os.environ.get("RESPARK_SMTP_FROM", "Respark <hello@localhost>")
OPENAI_KEY = os.environ.get("RESPARK_OPENAI_API_KEY", "")
ALLOW_SIGNUP = os.environ.get("RESPARK_ALLOW_SIGNUP", "1") == "1"

STRIPE_SECRET = os.environ.get("RESPARK_STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE = os.environ.get("RESPARK_STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("RESPARK_STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_STARTER = os.environ.get("RESPARK_STRIPE_PRICE_STARTER", "")
STRIPE_PRICE_GROWTH = os.environ.get("RESPARK_STRIPE_PRICE_GROWTH", "")

logging.basicConfig(
    filename=APP_LOG,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("respark")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  password_salt   TEXT NOT NULL,
  business_name   TEXT,
  industry        TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token           TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  name            TEXT NOT NULL,
  industry        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft',
  created_at      TEXT NOT NULL,
  launched_at     TEXT,
  paused_at       TEXT,
  completed_at    TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT,
  phone           TEXT,
  last_service    TEXT,
  last_service_date TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  campaign_id     TEXT NOT NULL,
  customer_id     TEXT NOT NULL,
  channel         TEXT NOT NULL,
  sequence_num    INTEGER NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  sent_at         TEXT,
  opened_at       TEXT,
  replied_at      TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  unsubscribe_token TEXT NOT NULL,
  FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  message_id      TEXT NOT NULL,
  type            TEXT NOT NULL,
  occurred_at     TEXT NOT NULL,
  payload         TEXT,
  FOREIGN KEY(message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT UNIQUE NOT NULL,
  stripe_customer_id  TEXT,
  stripe_subscription_id TEXT,
  plan                TEXT,
  status              TEXT NOT NULL DEFAULT 'inactive',
  current_period_end  TEXT,
  updated_at          TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS leads (
  id              TEXT PRIMARY KEY,
  business_name   TEXT NOT NULL,
  contact_name    TEXT,
  email           TEXT,
  phone           TEXT,
  website         TEXT,
  industry        TEXT,
  city            TEXT,
  review_count    INTEGER DEFAULT 0,
  source          TEXT,
  status          TEXT NOT NULL DEFAULT 'new',
  notes           TEXT,
  created_at      TEXT NOT NULL,
  last_action_at  TEXT
);

CREATE TABLE IF NOT EXISTS outreach_emails (
  id              TEXT PRIMARY KEY,
  lead_id         TEXT NOT NULL,
  sequence_num    INTEGER NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  scheduled_at    TEXT NOT NULL,
  sent_at         TEXT,
  opened_at       TEXT,
  replied_at      TEXT,
  status          TEXT NOT NULL DEFAULT 'scheduled',
  tracking_token  TEXT NOT NULL,
  FOREIGN KEY(lead_id) REFERENCES leads(id)
);

CREATE TABLE IF NOT EXISTS outreach_settings (
  id                      INTEGER PRIMARY KEY CHECK (id = 1),
  daily_send_limit        INTEGER NOT NULL DEFAULT 50,
  delay_between_seconds   INTEGER NOT NULL DEFAULT 60,
  followup_after_days     INTEGER NOT NULL DEFAULT 4,
  max_followups           INTEGER NOT NULL DEFAULT 3,
  operator_email          TEXT,
  operator_name           TEXT,
  updated_at              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_campaign ON customers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_campaign ON messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_messages_customer ON messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_status_scheduled ON messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_events_message ON events(message_id);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_industry ON leads(industry);
CREATE INDEX IF NOT EXISTS idx_outreach_lead ON outreach_emails(lead_id);
CREATE INDEX IF NOT EXISTS idx_outreach_status_scheduled ON outreach_emails(status, scheduled_at);
"""

_db_lock = threading.Lock()


def db():
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with _db_lock, db() as conn:
        for stmt in SCHEMA.strip().split(";"):
            s = stmt.strip()
            if s:
                conn.execute(s)


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return h.hex(), salt


def verify_password(password, hashed, salt):
    h, _ = hash_password(password, salt)
    return hmac.compare_digest(h, hashed)


def sign_session(token):
    sig = hmac.new(SECRET.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    return f"{token}.{sig}"


def verify_session(cookie_value):
    if not cookie_value or "." not in cookie_value:
        return None
    token, sig = cookie_value.rsplit(".", 1)
    expected = hmac.new(SECRET.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        return None
    with _db_lock, db() as conn:
        row = conn.execute("SELECT user_id FROM sessions WHERE token=?", (token,)).fetchone()
    return row["user_id"] if row else None


def create_session(user_id):
    token = secrets.token_urlsafe(32)
    with _db_lock, db() as conn:
        conn.execute("INSERT INTO sessions(token, user_id, created_at) VALUES (?,?,?)",
                    (token, user_id, utcnow()))
    return sign_session(token)


def destroy_session(cookie_value):
    if not cookie_value or "." not in cookie_value:
        return
    token = cookie_value.rsplit(".", 1)[0]
    with _db_lock, db() as conn:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id():
    return uuid.uuid4().hex


def json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def html_response(handler, status, html):
    body = html.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def redirect(handler, location, status=302):
    handler.send_response(status)
    handler.send_header("Location", location)
    handler.send_header("Content-Length", "0")
    handler.end_headers()


def read_json(handler):
    n = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(n) if n else b""
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def require_auth(handler):
    cookie = None
    for h in handler.headers.get_all("Cookie") or []:
        for part in h.split(";"):
            part = part.strip()
            if part.startswith("session="):
                cookie = part[len("session="):]
    user_id = verify_session(cookie) if cookie else None
    return user_id


# Customer-facing campaign templates (3 email + 2 SMS over 30 days)
TEMPLATES = {
    "plumber": [
        {"channel": "email", "day": 1, "subject": "Quick check-in from {{bizname}}",
         "body": "Hi {{first_name}},\n\nIt's been a while since we last serviced your home. Hope everything's still running smoothly — no leaks, no cold showers?\n\nIf it's been over a year since your last visit, your system is due for a quick check. We do a full inspection (worth $89) for free this month.\n\nReply to this email and we'll personally book a time that works.\n\n— The team at {{bizname}}"},
        {"channel": "sms", "day": 5,
         "body": "Hi {{first_name}} — it's {{bizname}}. Still happy with your plumbing? If anything's acting up, text us back and we'll fit you in this week. — Mike"},
        {"channel": "email", "day": 12, "subject": "{{first_name}}, a small offer for you",
         "body": "Hi {{first_name}},\n\nPast customers of ours get a small thank-you: 15% off any service call this month. No catch — just a thank you for trusting us before.\n\nReply with a good time and we'll get you on the schedule.\n\n— {{bizname}}"},
        {"channel": "sms", "day": 21,
         "body": "Last call, {{first_name}} — that 15% offer expires Sunday. Want us to grab you a slot? — {{bizname}}"},
        {"channel": "email", "day": 30, "subject": "Should we close your file?",
         "body": "Hi {{first_name}},\n\nWe don't send a lot of email, so this is the last one for a while. Just wanted to ask: are you still happy with {{bizname}}, or should we take you off our reactivation list?\n\nEither way is fine — just reply YES to stay on, or NO to stop hearing from us.\n\nThanks,\n{{bizname}}"},
    ],
    "dentist": [
        {"channel": "email", "day": 1, "subject": "Time for your checkup, {{first_name}}?",
         "body": "Hi {{first_name}},\n\nIt's been about 6 months since your last cleaning with us — which means you're due.\n\nIf life got in the way (it does), no judgment. Just reply with a preferred day and we'll get you re-booked. We have slots this month.\n\n— The team at {{bizname}}"},
        {"channel": "sms", "day": 4,
         "body": "Hi {{first_name}}, this is {{bizname}}. Your cleaning is overdue — want to grab a slot this week? Reply YES and we'll send times. — Sarah"},
        {"channel": "email", "day": 11, "subject": "Your benefits might reset soon",
         "body": "Hi {{first_name}},\n\nQuick heads-up: most dental insurance plans reset at the start of the year. If you have benefits left over from 2026, now's the time to use them.\n\nBook a cleaning + checkup before December 31st and we'll waive the exam fee ($75 value). Reply with a day that works.\n\n— {{bizname}}"},
        {"channel": "sms", "day": 20,
         "body": "{{first_name}} — that benefit reminder is expiring in 10 days. Want to grab a slot before year-end? Text us back. — {{bizname}}"},
        {"channel": "email", "day": 30, "subject": "One last check-in",
         "body": "Hi {{first_name}},\n\nWe try not to clutter inboxes, so this is the last note for now. Should we keep you on our patient list?\n\nReply YES to stay, NO to opt out. Either way, take care of those teeth.\n\n— {{bizname}}"},
    ],
    "trainer": [
        {"channel": "email", "day": 1, "subject": "Where did we leave off, {{first_name}}?",
         "body": "Hey {{first_name}},\n\nIt's been a minute since we worked together. No sales pitch — I just want to know: are you still training, or did life get in the way?\n\nIf you're still going, awesome. If you stopped and want to start again, I'll hold you a spot this week at your old rate.\n\nJust reply.\n\n— Coach"},
        {"channel": "sms", "day": 5,
         "body": "{{first_name}} — quick nudge from your coach. Want to grab a session this week? We'll work around your schedule. — {{bizname}}"},
        {"channel": "email", "day": 12, "subject": "The 21-day comeback",
         "body": "Hey {{first_name}},\n\nPast clients of mine get a special: 21 days of training for the price of 14. No contract, no commitment — just a chance to get back in rhythm.\n\nStarts any Monday. Reply with the day and we'll send the link.\n\n— {{bizname}}"},
        {"channel": "sms", "day": 22,
         "body": "Last call on the 21-day deal, {{first_name}}. Want us to lock in your spot for Monday? — {{bizname}}"},
        {"channel": "email", "day": 30, "subject": "Should we stop reaching out?",
         "body": "Hey {{first_name}},\n\nQuick check — should we keep you on our client list, or take you off?\n\nReply YES to stay, NO to stop. Either way is cool.\n\n— {{bizname}}"},
    ],
    "salon": [
        {"channel": "email", "day": 1, "subject": "{{first_name}}, you're due",
         "body": "Hi {{first_name}},\n\nIt's been about 8 weeks since your last visit with us. You're officially due.\n\nIf your schedule's gotten crazy, we get it — just reply with a day that works this month and we'll make it happen.\n\nCan't wait to see you.\n\n— The team at {{bizname}}"},
        {"channel": "sms", "day": 4,
         "body": "Hi {{first_name}} — your stylist at {{bizname}} has some openings this week. Want us to grab one? Just text back YES. — Jess"},
        {"channel": "email", "day": 12, "subject": "A little something for our regulars",
         "body": "Hi {{first_name}},\n\nPast clients of {{bizname}} get $20 off any service this month. Bring a friend, they get $20 off too.\n\nReply with a preferred day and we'll handle the rest.\n\n— {{bizname}}"},
        {"channel": "sms", "day": 21,
         "body": "Hey {{first_name}} — that $20-off offer ends Sunday. Want to grab a slot before it's gone? — {{bizname}}"},
        {"channel": "email", "day": 30, "subject": "Stay or go?",
         "body": "Hi {{first_name}},\n\nLast email from us for a while — promise. Just want to check: do you want to stay on our list?\n\nYES to keep hearing from us. NO to opt out. Either way, take care.\n\n— {{bizname}}"},
    ],
    "mechanic": [
        {"channel": "email", "day": 1, "subject": "How's the car running, {{first_name}}?",
         "body": "Hi {{first_name}},\n\nQuick check-in from {{bizname}}. Last time we had your car in, it was running great — hope it still is.\n\nIf you've put more than 3,000 miles on it since your last service, you're due. Reply to this email and we'll get you on the schedule.\n\n— The team at {{bizname}}"},
        {"channel": "sms", "day": 5,
         "body": "Hi {{first_name}}, {{bizname}} here. Car due for an oil change? We have slots this week — just text back YES. — Tony"},
        {"channel": "email", "day": 12, "subject": "Free multi-point inspection",
         "body": "Hi {{first_name}},\n\nPast customers of ours get a free 30-point inspection this month ($69 value). Takes 20 minutes, no appointment needed.\n\nJust reply with a good day — usually we can fit you in same-week.\n\n— {{bizname}}"},
        {"channel": "sms", "day": 21,
         "body": "Heads up {{first_name}} — that free inspection offer ends Sunday. Want us to hold a slot? — {{bizname}}"},
        {"channel": "email", "day": 30, "subject": "One last thing from us",
         "body": "Hi {{first_name}},\n\nLast email from us for now. Just checking: should we keep you on our list?\n\nYES to stay, NO to opt out. Either way, drive safe.\n\n— {{bizname}}"},
    ],
    "realtor": [
        {"channel": "email", "day": 1, "subject": "Quick check-in, {{first_name}}",
         "body": "Hey {{first_name}},\n\nIt's been a while since we last talked about real estate. Just curious — are you still thinking about buying/selling, or has your situation changed?\n\nIf something shifted, we'd love to know. If you're still in the market, we have some new listings we think you'd like.\n\nReply whenever you get a chance.\n\n— {{agent_name}}, {{bizname}}"},
        {"channel": "sms", "day": 5,
         "body": "Hi {{first_name}}, it's {{agent_name}}. Just a quick nudge — anything changed with your real estate plans? Happy to chat whenever. — {{bizname}}"},
        {"channel": "email", "day": 12, "subject": "3 listings I think fit you",
         "body": "Hey {{first_name}},\n\nThree properties came on the market this week that match what you were looking for. Want to see them this weekend?\n\nReply with a good time and we'll set up a tour.\n\n— {{agent_name}}"},
        {"channel": "sms", "day": 22,
         "body": "{{first_name}} — those 3 properties are still available. Want to set up a tour this weekend? Just text back. — {{agent_name}}"},
        {"channel": "email", "day": 30, "subject": "Closing the loop",
         "body": "Hey {{first_name}},\n\nLast email from us for a while. Should we stay in touch, or take you off our list?\n\nYES to stay, NO to stop. No pressure either way.\n\n— {{agent_name}}, {{bizname}}"},
    ],
    "restaurant": [
        {"channel": "email", "day": 1, "subject": "We miss you, {{first_name}}",
         "body": "Hi {{first_name}},\n\nIt's been a while since you dined with us at {{bizname}}. Hope you've been well.\n\nWe just rolled out our new fall menu — and past guests get a complimentary appetizer with any entree this month.\n\nReply with a day that works and we'll save you a table.\n\n— The team at {{bizname}}"},
        {"channel": "sms", "day": 4,
         "body": "Hi {{first_name}}, {{bizname}} here. Want to grab a table this weekend? We're holding a few for our regulars. Just text back YES. — Marco"},
        {"channel": "email", "day": 12, "subject": "A little thank-you",
         "body": "Hi {{first_name}},\n\nPast guests of {{bizname}} get a $25 dining credit this month when they bring a friend. Good through Sunday.\n\nReply with a preferred night — Friday and Saturday fill fast.\n\n— {{bizname}}"},
        {"channel": "sms", "day": 21,
         "body": "Last call, {{first_name}} — that $25 credit ends tomorrow. Want us to save you a table for tonight? — {{bizname}}"},
        {"channel": "email", "day": 30, "subject": "Stay in touch?",
         "body": "Hi {{first_name}},\n\nLast email from us for a while — promise. Should we stay in touch, or take you off our list?\n\nYES to stay. NO to opt out. Either way, thanks for being a guest.\n\n— {{bizname}}"},
    ],
}

INDUSTRIES = list(TEMPLATES.keys())


OUTREACH_TEMPLATES = {
    "plumber": {
        "step1": {
            "subject": "Quick question, {{business_name}}?",
            "body": "Hi {{contact_name}},\n\nI'm {{operator_name}} — I work with {{industry_label}} businesses in {{city}} to help them re-engage past customers without doing any extra work.\n\nMost of the businesses I've worked with see 8–15% of their old customers come back within 30 days — purely from automated email + SMS.\n\nI built a quick sample campaign showing exactly what it would look like for {{business_name}}: {{demo_link}}\n\nWorth a 15-minute conversation?\n\n— {{operator_name}}\n{{operator_email}}",
        },
        "step2": {
            "subject": "Re: Quick question",
            "body": "Hi {{contact_name}},\n\nBumping this up — saw {{business_name}} has solid reviews on Google, which suggests your past customers trust you. Most of them haven't heard from you in months.\n\nI can put together a free 30-day trial of the reactivation system. No charge if you don't see at least 5 reactivated customers.\n\n15 minutes this week?\n\n— {{operator_name}}",
        },
        "step3": {
            "subject": "Closing the loop",
            "body": "Hi {{contact_name}},\n\nLast note from me — promise. Should I leave the door open for a future conversation, or take {{business_name}} off my list?\n\nEither way is fine.\n\n— {{operator_name}}",
        },
    },
    "dentist": {
        "step1": {
            "subject": "{{contact_name}}, 8–15% reactivation — worth 15 min?",
            "body": "Hi {{contact_name}},\n\nI'm {{operator_name}}. I help {{industry_label}} practices bring back past patients with automated, personalized email + SMS.\n\nAverage client: 8–15% of dormant patients rebook within 30 days. No extra work for your front desk.\n\nHere's a free sample campaign for {{business_name}}: {{demo_link}}\n\nWorth 15 minutes?\n\n— {{operator_name}}\n{{operator_email}}",
        },
        "step2": {
            "subject": "Free 30-day trial — no risk",
            "body": "Hi {{contact_name}},\n\nFollowing up. I'm offering the first 3 practices in {{city}} a free 30-day trial — if you don't see at least 5 reactivated patients, you pay nothing.\n\nSetup is on me. You just upload your patient list.\n\n15 minutes this week?\n\n— {{operator_name}}",
        },
        "step3": {
            "subject": "Last note",
            "body": "Hi {{contact_name}},\n\nLast email from me. Should I leave the door open, or take {{business_name}} off my list?\n\nEither way, take care.\n\n— {{operator_name}}",
        },
    },
    "default": {
        "step1": {
            "subject": "Quick question, {{business_name}}?",
            "body": "Hi {{contact_name}},\n\nI'm {{operator_name}} — I help local {{industry_label}} businesses bring back past customers with automated, personalized email + SMS.\n\nAverage result: 8–15% re-engagement within 30 days, no extra work for the owner.\n\nFree sample campaign for {{business_name}}: {{demo_link}}\n\nWorth a 15-minute conversation?\n\n— {{operator_name}}\n{{operator_email}}",
        },
        "step2": {
            "subject": "Re: Quick question",
            "body": "Hi {{contact_name}},\n\nBumping this up. I can run a free 30-day trial for {{business_name}} — no charge if you don't see at least 5 reactivated customers.\n\n15 minutes this week?\n\n— {{operator_name}}",
        },
        "step3": {
            "subject": "Closing the loop",
            "body": "Hi {{contact_name}},\n\nLast note from me — promise. Should I leave the door open, or take {{business_name}} off my list?\n\nEither way is fine.\n\n— {{operator_name}}",
        },
    },
}


INDUSTRY_LABELS = {
    "plumber": "plumbing / HVAC",
    "dentist": "dental",
    "trainer": "fitness / personal training",
    "salon": "hair salon / spa",
    "mechanic": "auto repair",
    "realtor": "real estate",
    "restaurant": "restaurant",
}


OUTREACH_INDUSTRIES = list(OUTREACH_TEMPLATES.keys())


def get_outreach_settings():
    with _db_lock, db() as conn:
        row = conn.execute("SELECT * FROM outreach_settings WHERE id=1").fetchone()
    if not row:
        return {
            "daily_send_limit": 50,
            "delay_between_seconds": 60,
            "followup_after_days": 4,
            "max_followups": 3,
            "operator_email": "",
            "operator_name": "Respark",
            "updated_at": utcnow(),
        }
    return dict(row)


def render_outreach_email(lead, step_key):
    industry = lead.get("industry") or "default"
    templates = OUTREACH_TEMPLATES.get(industry, OUTREACH_TEMPLATES["default"])
    tpl = templates.get(step_key) or templates.get("step1")
    ctx = {
        "business_name": lead.get("business_name") or "your business",
        "contact_name": lead.get("contact_name") or "there",
        "industry_label": INDUSTRY_LABELS.get(industry, "local service"),
        "city": lead.get("city") or "your area",
        "operator_name": lead.get("operator_name") or "Respark",
        "operator_email": lead.get("operator_email") or "",
        "demo_link": BASE_URL + "/",
    }
    subject = tpl["subject"]
    body = tpl["body"]
    for k, v in ctx.items():
        subject = subject.replace("{{" + k + "}}", str(v))
        body = body.replace("{{" + k + "}}", str(v))
    return subject, body


def schedule_outreach_for_lead(lead_id):
    settings = get_outreach_settings()
    with _db_lock, db() as conn:
        lead = conn.execute("SELECT * FROM leads WHERE id=?", (lead_id,)).fetchone()
        if not lead:
            return 0
        existing = conn.execute(
            "SELECT COUNT(*) AS n FROM outreach_emails WHERE lead_id=?", (lead_id,)
        ).fetchone()["n"]
        if existing > 0:
            return 0
        lead_dict = dict(lead)
        lead_dict["operator_name"] = settings.get("operator_name") or "Respark"
        lead_dict["operator_email"] = settings.get("operator_email") or ""
        now = datetime.now(timezone.utc)
        steps = [("step1", 0), ("step2", settings["followup_after_days"]), ("step3", settings["followup_after_days"] * 2)]
        sent = 0
        for i, (key, day_offset) in enumerate(steps):
            subject, body = render_outreach_email(lead_dict, key)
            scheduled = (now + timedelta(days=day_offset)).isoformat(timespec="seconds")
            conn.execute("""INSERT INTO outreach_emails(id, lead_id, sequence_num, subject, body,
                              scheduled_at, status, tracking_token) VALUES (?,?,?,?,?,?, 'scheduled', ?)""",
                         (new_id(), lead_id, i + 1, subject, body, scheduled, secrets.token_urlsafe(16)))
            sent += 1
        conn.execute("UPDATE leads SET last_action_at=? WHERE id=?", (utcnow(), lead_id))
    return sent


def send_outreach_email_now(outreach_id):
    with _db_lock, db() as conn:
        row = conn.execute("""
            SELECT oe.*, l.email AS lead_email, l.business_name, l.contact_name
            FROM outreach_emails oe JOIN leads l ON l.id = oe.lead_id
            WHERE oe.id = ?
        """, (outreach_id,)).fetchone()
        if not row or not row["lead_email"]:
            return False
        subject = row["subject"] or "Quick question"
        body = row["body"]
        tracking_pixel = f'<img src="{BASE_URL}/track/outreach/{row["tracking_token"]}" width="1" height="1" alt="" />'
        unsubscribe_url = f'{BASE_URL}/u/outreach/{row["tracking_token"]}'
        body += f"\n\n--\nIf you'd prefer not to hear from me again: {unsubscribe_url}\n{tracking_pixel}"
        html_body = f'<html><body style="white-space:pre-wrap;font-family:-apple-system,sans-serif;">{body.replace(chr(10), "<br>")}</body></html>'
        ok = send_email(row["lead_email"], subject, body, html=html_body)
        new_status = "sent" if ok else "failed"
        conn.execute("UPDATE outreach_emails SET status=?, sent_at=? WHERE id=?",
                     (new_status, utcnow(), outreach_id))
        if ok:
            cur = conn.execute("SELECT status FROM leads WHERE id=?", (row["lead_id"],)).fetchone()
            if cur and cur["status"] == "new":
                conn.execute("UPDATE leads SET status='sent', last_action_at=? WHERE id=?",
                             (utcnow(), row["lead_id"]))
    return ok


def fill_tokens(text, ctx):
    if not text:
        return ""
    out = text
    for k, v in ctx.items():
        out = out.replace("{{" + k + "}}", str(v) if v else "")
    return out


def render_messages(industry, customer, business_name, agent_name=""):
    tpl = TEMPLATES.get(industry, TEMPLATES["plumber"])
    fn = (customer.get("first_name") or "there").strip()
    ln = (customer.get("last_name") or "").strip()
    last_service = customer.get("last_service") or "your last visit"
    last_date = customer.get("last_service_date") or ""
    days_since = ""
    if last_date:
        try:
            d = datetime.fromisoformat(last_date.replace("Z", "+00:00"))
            days_since = str((datetime.now(timezone.utc) - d).days)
        except Exception:
            pass

    ctx = {
        "first_name": fn,
        "last_name": ln,
        "bizname": business_name or "[Your Business]",
        "agent_name": agent_name or "your agent",
        "last_service": last_service,
        "days_since": days_since,
    }
    out = []
    base = datetime.now(timezone.utc)
    for i, t in enumerate(tpl):
        scheduled = (base + timedelta(days=t["day"])).isoformat(timespec="seconds")
        out.append({
            "channel": t["channel"],
            "sequence_num": i + 1,
            "subject": fill_tokens(t.get("subject", ""), ctx),
            "body": fill_tokens(t["body"], ctx),
            "scheduled_at": scheduled,
        })
    return out


def send_email(to_addr, subject, body, html=None):
    msg = EmailMessage()
    name, addr = parseaddr(SMTP_FROM)
    msg["From"] = formataddr((name or "Respark", addr)) if addr else SMTP_FROM
    msg["To"] = to_addr
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")

    if not SMTP_HOST:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n--- {utcnow()} ---\nTo: {to_addr}\nSubject: {subject}\n\n{body}\n")
        log.info("email queued to %s (no SMTP — logged)", to_addr)
        return True

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.starttls(context=ssl.create_default_context())
            if SMTP_USER:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
        log.info("email sent to %s", to_addr)
        return True
    except Exception as e:
        log.error("smtp send failed: %s", e)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n--- {utcnow()} (SMTP FAIL: {e}) ---\nTo: {to_addr}\nSubject: {subject}\n\n{body}\n")
        return False


def send_sms(to_phone, body):
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(f"\n--- {utcnow()} [SMS stub] ---\nTo: {to_phone}\n\n{body}\n")
    log.info("sms logged (stub) to %s", to_phone)
    return True


# STRIPE (REST API via urllib, no SDK)

def stripe_request(method, path, params=None):
    import urllib.request
    import urllib.parse

    url = "https://api.stripe.com/v1" + path
    body = None
    headers = {"Authorization": f"Bearer {STRIPE_SECRET}"}

    if method == "GET" and params:
        url += "?" + urllib.parse.urlencode(params)
    elif params:
        body = urllib.parse.urlencode(params).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"

    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        log.error("stripe %s %s failed: %s", method, path, err_body)
        raise


def stripe_configured():
    return bool(STRIPE_SECRET)


def create_checkout_session(user_id, plan, success_url, cancel_url):
    if not stripe_configured():
        raise RuntimeError("Stripe not configured")
    with _db_lock, db() as conn:
        user = conn.execute("SELECT email FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        raise RuntimeError("user not found")

    price_id = STRIPE_PRICE_STARTER if plan == "starter" else STRIPE_PRICE_GROWTH
    params = [
        ("mode", "payment" if plan == "starter" else "subscription"),
        ("success_url", success_url),
        ("cancel_url", cancel_url),
        ("client_reference_id", user_id),
        ("customer_email", user["email"]),
    ]
    if price_id:
        params.append(("line_items[0][price]", price_id))
        params.append(("line_items[0][quantity]", "1"))
    else:
        amount = "49700" if plan == "starter" else "9700"
        params.extend([
            ("line_items[0][price_data][currency]", "usd"),
            ("line_items[0][price_data][unit_amount]", amount),
            ("line_items[0][price_data][product_data][name]", "Respark Starter" if plan == "starter" else "Respark Growth (monthly)"),
            ("line_items[0][price_data][recurring][interval]", "month" if plan == "growth" else ""),
            ("line_items[0][price_data][product_data][description]", "One-time setup" if plan == "starter" else "Monthly reactivation engine"),
        ])

    return stripe_request("POST", "/checkout/sessions", params)


def create_billing_portal_session(customer_id, return_url):
    return stripe_request("POST", "/billing_portal/sessions", {
        "customer": customer_id,
        "return_url": return_url,
    })


def verify_stripe_signature(raw_body, sig_header):
    if not STRIPE_WEBHOOK_SECRET or not sig_header:
        return None
    parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
    timestamp = parts.get("t", "")
    expected_sig = parts.get("v1", "")
    if not timestamp or not expected_sig:
        return None
    signed_payload = f"{timestamp}.{raw_body.decode('utf-8') if isinstance(raw_body, bytes) else raw_body}"
    mac = hmac.new(STRIPE_WEBHOOK_SECRET.encode("utf-8"), signed_payload.encode("utf-8"), hashlib.sha256)
    if not hmac.compare_digest(mac.hexdigest(), expected_sig):
        return None
    return json.loads(raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body)


def upsert_subscription(user_id, customer_id, subscription_id, plan, status, period_end):
    with _db_lock, db() as conn:
        existing = conn.execute("SELECT id FROM subscriptions WHERE user_id=?", (user_id,)).fetchone()
        if existing:
            conn.execute("""UPDATE subscriptions SET stripe_customer_id=?, stripe_subscription_id=?,
                            plan=?, status=?, current_period_end=?, updated_at=? WHERE user_id=?""",
                         (customer_id, subscription_id, plan, status, period_end, utcnow(), user_id))
        else:
            conn.execute("""INSERT INTO subscriptions(id, user_id, stripe_customer_id, stripe_subscription_id,
                            plan, status, current_period_end, updated_at) VALUES (?,?,?,?,?,?,?,?)""",
                         (new_id(), user_id, customer_id, subscription_id, plan, status, period_end, utcnow()))


def handle_stripe_event(event):
    etype = event.get("type", "")
    data = event.get("data", {}).get("object", {})

    if etype == "checkout.session.completed":
        user_id = data.get("client_reference_id")
        customer_id = data.get("customer")
        subscription_id = data.get("subscription") or None
        amount = data.get("amount_total", 0)
        plan = "starter" if amount >= 40000 else "growth"
        if user_id and customer_id:
            upsert_subscription(user_id, customer_id, subscription_id, plan, "active", None)
            log.info("checkout completed for user %s plan=%s", user_id, plan)
        return True

    if etype in ("customer.subscription.updated", "customer.subscription.created", "customer.subscription.deleted"):
        customer_id = data.get("customer")
        subscription_id = data.get("id")
        status = data.get("status", "inactive")
        period_end = data.get("current_period_end")
        period_end_iso = datetime.fromtimestamp(period_end, tz=timezone.utc).isoformat(timespec="seconds") if period_end else None
        with _db_lock, db() as conn:
            sub = conn.execute("SELECT user_id, plan FROM subscriptions WHERE stripe_customer_id=?",
                               (customer_id,)).fetchone()
            if sub:
                upsert_subscription(sub["user_id"], customer_id, subscription_id, sub["plan"],
                                    "canceled" if status == "canceled" else status, period_end_iso)
        return True

    return False


_scheduler_started = False
_scheduler_lock = threading.Lock()


def scheduler_loop():
    log.info("scheduler started")
    while True:
        try:
            now_iso = utcnow()
            with _db_lock, db() as conn:
                rows = conn.execute("""
                    SELECT m.*, c.email AS cust_email, c.phone AS cust_phone,
                           cam.user_id AS cam_user_id, cam.industry AS industry
                    FROM messages m
                    JOIN customers c ON c.id = m.customer_id
                    JOIN campaigns cam ON cam.id = m.campaign_id
                    WHERE m.status = 'scheduled' AND m.scheduled_at <= ?
                    LIMIT 200
                """, (now_iso,)).fetchall()

                for r in rows:
                    if r["channel"] == "email" and r["cust_email"]:
                        ok = send_email(r["cust_email"], r["subject"] or "", r["body"])
                    elif r["channel"] == "sms" and r["cust_phone"]:
                        ok = send_sms(r["cust_phone"], r["body"])
                    else:
                        ok = False
                    new_status = "sent" if ok else "failed"
                    conn.execute("UPDATE messages SET status=?, sent_at=? WHERE id=?",
                                 (new_status, utcnow(), r["id"]))

                conn.execute("""
                    UPDATE campaigns SET status='completed', completed_at=?
                    WHERE status='active' AND id NOT IN (
                      SELECT DISTINCT campaign_id FROM messages WHERE status='scheduled'
                    )
                """, (utcnow(),))

                outreach_rows = conn.execute("""
                    SELECT oe.id, oe.lead_id
                    FROM outreach_emails oe
                    WHERE oe.status = 'scheduled' AND oe.scheduled_at <= ?
                    LIMIT 50
                """, (now_iso,)).fetchall()
                for r in outreach_rows:
                    try:
                        send_outreach_email_now(r["id"])
                    except Exception as e:
                        log.error("outreach send failed for %s: %s", r["id"], e)
        except Exception as e:
            log.error("scheduler error: %s", e)
        time.sleep(30)


def start_scheduler_once():
    global _scheduler_started
    with _scheduler_lock:
        if _scheduler_started:
            return
        t = threading.Thread(target=scheduler_loop, daemon=True, name="respark-scheduler")
        t.start()
        _scheduler_started = True


CSV_COL_MAP = {
    "first_name": ["first_name", "firstname", "first name", "fname"],
    "last_name": ["last_name", "lastname", "last name", "lname"],
    "email": ["email", "email_address", "e-mail"],
    "phone": ["phone", "mobile", "cell", "phone_number"],
    "last_service": ["last_service", "service", "last_visit_type"],
    "last_service_date": ["last_service_date", "last_visit", "last_date", "service_date"],
}


def normalize_csv_headers(headers):
    norm = [h.strip().lower() for h in headers]
    out = {}
    for canon, aliases in CSV_COL_MAP.items():
        for i, h in enumerate(norm):
            if h in aliases:
                out[i] = canon
                break
    return out


def parse_csv(text):
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return []
    header_map = normalize_csv_headers(rows[0])
    out = []
    for row in rows[1:]:
        if not any((c or "").strip() for c in row):
            continue
        rec = {}
        for i, canon in header_map.items():
            if i < len(row):
                rec[canon] = row[i].strip()
        if rec.get("email") or rec.get("phone"):
            out.append(rec)
    return out


WEB_FILES = {}


def load_web():
    for name in ("index.html", "app.html", "outreach.html", "style.css", "app.js"):
        path = os.path.join(WEB_DIR, name)
        if os.path.exists(path):
            with open(path, "rb") as f:
                WEB_FILES[name] = f.read()


class Handler(BaseHTTPRequestHandler):
    server_version = "Respark/1.0"

    def log_message(self, fmt, *args):
        log.info("%s - %s", self.address_string(), fmt % args)

    def _serve_web(self, name, content_type):
        body = WEB_FILES.get(name)
        if body is None:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path.startswith("/track/open/"):
            return self._track_open(path[len("/track/open/"):])
        if path.startswith("/track/outreach/"):
            return self._track_outreach(path[len("/track/outreach/"):])

        if path.startswith("/u/outreach/"):
            return self._unsubscribe_outreach(path[len("/u/outreach/"):])
        if path.startswith("/u/"):
            return self._unsubscribe(path[len("/u/"):])

        if path in ("/", "/index.html"):
            return self._serve_web("index.html", "text/html; charset=utf-8")
        if path == "/app" or path == "/app.html":
            user_id = require_auth(self)
            if not user_id:
                return redirect(self, "/")
            return self._serve_web("app.html", "text/html; charset=utf-8")
        if path == "/static/style.css":
            return self._serve_web("style.css", "text/css; charset=utf-8")
        if path == "/static/app.js":
            return self._serve_web("app.js", "application/javascript; charset=utf-8")
        if path == "/outreach" or path == "/outreach.html":
            user_id = require_auth(self)
            if not user_id:
                return redirect(self, "/")
            return self._serve_web("outreach.html", "text/html; charset=utf-8")

        if path == "/api/me":
            return self._api_me()
        if path == "/api/billing/status":
            return self._api_billing_status()
        if path == "/api/stripe/config":
            return self._api_stripe_config()
        if path == "/api/outreach/leads":
            return self._api_outreach_list()
        if path == "/api/outreach/stats":
            return self._api_outreach_stats()
        if path == "/api/outreach/settings":
            return self._api_outreach_settings()
        if path == "/api/campaigns":
            return self._api_list_campaigns()
        if path.startswith("/api/campaigns/") and path.endswith("/stats"):
            return self._api_campaign_stats(path)
        if path.startswith("/api/campaigns/") and path.count("/") == 3:
            return self._api_get_campaign(path)

        self.send_error(404)

    def do_POST(self):
        url = urlparse(self.path)
        path = url.path

        if path == "/api/auth/signup":
            return self._api_signup()
        if path == "/api/auth/login":
            return self._api_login()
        if path == "/api/auth/logout":
            return self._api_logout()
        if path == "/api/campaigns":
            return self._api_create_campaign()
        if path.startswith("/api/campaigns/") and path.endswith("/customers"):
            return self._api_upload_customers(path)
        if path.startswith("/api/campaigns/") and path.endswith("/generate"):
            return self._api_generate(path)
        if path.startswith("/api/campaigns/") and path.endswith("/launch"):
            return self._api_launch(path)
        if path.startswith("/api/campaigns/") and path.endswith("/pause"):
            return self._api_pause(path)
        if path == "/api/checkout":
            return self._api_checkout()
        if path == "/api/billing/portal":
            return self._api_billing_portal()

        if path == "/api/outreach/leads/import":
            return self._api_outreach_import()
        if path.startswith("/api/outreach/leads/") and path.endswith("/patch"):
            return self._api_outreach_patch_lead(path)
        if path.startswith("/api/outreach/leads/") and path.endswith("/close"):
            return self._api_outreach_close_lead(path)
        if path.startswith("/api/outreach/leads/") and path.endswith("/send"):
            return self._api_outreach_send_now(path)
        if path == "/api/outreach/settings":
            return self._api_outreach_settings()

        if path == "/webhooks/stripe":
            return self._webhook_stripe()

        self.send_error(404)

    # auth
    def _api_signup(self):
        if not ALLOW_SIGNUP:
            return json_response(self, 403, {"error": "signup disabled"})
        data = read_json(self) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        business = (data.get("business_name") or "").strip()
        industry = (data.get("industry") or "").strip()
        if "@" not in email or "." not in email:
            return json_response(self, 400, {"error": "invalid email"})
        if len(password) < 8:
            return json_response(self, 400, {"error": "password must be at least 8 characters"})
        if industry and industry not in INDUSTRIES:
            return json_response(self, 400, {"error": "unknown industry"})
        h, salt = hash_password(password)
        uid = new_id()
        try:
            with _db_lock, db() as conn:
                conn.execute("""INSERT INTO users(id, email, password_hash, password_salt,
                              business_name, industry, created_at) VALUES (?,?,?,?,?,?,?)""",
                             (uid, email, h, salt, business, industry, utcnow()))
        except sqlite3.IntegrityError:
            return json_response(self, 409, {"error": "email already registered"})
        cookie = create_session(uid)
        self.send_response(200)
        self.send_header("Set-Cookie", f"session={cookie}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000")
        json_response(self, 200, {"ok": True, "user_id": uid})

    def _api_login(self):
        data = read_json(self) or {}
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        with _db_lock, db() as conn:
            row = conn.execute("SELECT id, password_hash, password_salt FROM users WHERE email=?",
                               (email,)).fetchone()
        if not row or not verify_password(password, row["password_hash"], row["password_salt"]):
            return json_response(self, 401, {"error": "invalid credentials"})
        cookie = create_session(row["id"])
        self.send_response(200)
        self.send_header("Set-Cookie", f"session={cookie}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000")
        json_response(self, 200, {"ok": True, "user_id": row["id"]})

    def _api_logout(self):
        cookie = None
        for h in self.headers.get_all("Cookie") or []:
            for part in h.split(";"):
                if part.strip().startswith("session="):
                    cookie = part.strip()[len("session="):]
        destroy_session(cookie)
        self.send_response(200)
        self.send_header("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0")
        json_response(self, 200, {"ok": True})

    def _api_stripe_config(self):
        return json_response(self, 200, {
            "configured": stripe_configured(),
            "publishable_key": STRIPE_PUBLISHABLE,
            "prices": {"starter": STRIPE_PRICE_STARTER, "growth": STRIPE_PRICE_GROWTH},
        })

    def _api_checkout(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        if not stripe_configured():
            return json_response(self, 503, {"error": "Stripe not configured — set RESPARK_STRIPE_SECRET_KEY"})
        data = read_json(self) or {}
        plan = (data.get("plan") or "").strip().lower()
        if plan not in ("starter", "growth"):
            return json_response(self, 400, {"error": "plan must be 'starter' or 'growth'"})
        try:
            session = create_checkout_session(
                uid, plan,
                BASE_URL + "/app?checkout=success",
                BASE_URL + "/?checkout=cancel",
            )
        except Exception as e:
            return json_response(self, 500, {"error": str(e)})
        return json_response(self, 200, {"url": session.get("url"), "id": session.get("id")})

    def _api_billing_portal(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        if not stripe_configured():
            return json_response(self, 503, {"error": "Stripe not configured"})
        with _db_lock, db() as conn:
            sub = conn.execute("SELECT stripe_customer_id FROM subscriptions WHERE user_id=?",
                               (uid,)).fetchone()
        if not sub or not sub["stripe_customer_id"]:
            return json_response(self, 400, {"error": "no active subscription"})
        try:
            session = create_billing_portal_session(sub["stripe_customer_id"], BASE_URL + "/app")
        except Exception as e:
            return json_response(self, 500, {"error": str(e)})
        return json_response(self, 200, {"url": session.get("url")})

    def _api_billing_status(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        with _db_lock, db() as conn:
            row = conn.execute("""SELECT plan, status, current_period_end, updated_at
                                  FROM subscriptions WHERE user_id=?""", (uid,)).fetchone()
        return json_response(self, 200, {"subscription": dict(row) if row else None})

    def _webhook_stripe(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        sig = self.headers.get("Stripe-Signature", "")
        event = verify_stripe_signature(raw, sig)
        if event is None:
            return json_response(self, 400, {"error": "invalid signature"})
        try:
            handled = handle_stripe_event(event)
        except Exception as e:
            log.error("webhook handler error: %s", e)
            return json_response(self, 500, {"error": str(e)})
        return json_response(self, 200, {"received": True, "handled": handled})

    def _api_create_campaign(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        data = read_json(self) or {}
        name = (data.get("name") or "").strip()
        industry = (data.get("industry") or "").strip()
        if not name:
            return json_response(self, 400, {"error": "name required"})
        if industry not in INDUSTRIES:
            return json_response(self, 400, {"error": "unknown industry"})
        cid = new_id()
        with _db_lock, db() as conn:
            conn.execute("""INSERT INTO campaigns(id, user_id, name, industry, status, created_at)
                            VALUES (?,?,?,?, 'draft', ?)""",
                         (cid, uid, name, industry, utcnow()))
        return json_response(self, 200, {"ok": True, "id": cid})

    def _api_outreach_import(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        data = read_json(self) or {}
        csv_text = (data.get("csv") or "").strip()
        if not csv_text:
            return json_response(self, 400, {"error": "csv required"})
        rows = parse_csv(csv_text)
        if not rows:
            return json_response(self, 400, {"error": "no valid rows"})

        norm = [(h or "").strip().lower() for h in csv_text.splitlines()[0].split(",")]
        outreach_aliases = {
            "business_name": ["business_name", "business", "name", "company"],
            "contact_name": ["contact_name", "contact", "owner"],
            "industry": ["industry", "category"],
            "city": ["city", "location"],
            "phone": ["phone", "tel", "telephone"],
            "website": ["website", "url", "site"],
            "review_count": ["review_count", "reviews", "rating_count"],
            "source": ["source"],
        }
        col_map = {}
        for canon, aliases in outreach_aliases.items():
            for i, h in enumerate(norm):
                if h in aliases:
                    col_map[i] = canon
                    break
        import csv as _csv
        parsed = []
        reader = _csv.reader(csv_text.splitlines())
        raw_rows = list(reader)
        if not raw_rows:
            return json_response(self, 400, {"error": "empty csv"})
        for row in raw_rows[1:]:
            if not any((c or "").strip() for c in row):
                continue
            rec = {}
            for i, canon in col_map.items():
                if i < len(row):
                    rec[canon] = row[i].strip()
            if "email" not in rec:
                for i, h in enumerate(norm):
                    if h in ("email", "email_address", "e-mail") and i < len(row):
                        rec["email"] = row[i].strip()
                        break
            if rec.get("business_name") and rec.get("email"):
                parsed.append(rec)

        lead_ids = []
        with _db_lock, db() as conn:
            for r in parsed:
                lid = new_id()
                conn.execute("""INSERT INTO leads(id, business_name, contact_name, email, phone, website,
                              industry, city, review_count, source, status, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?,?, 'new', ?)""",
                             (lid,
                              r.get("business_name", ""),
                              r.get("contact_name", ""),
                              r.get("email", ""),
                              r.get("phone", ""),
                              r.get("website", ""),
                              r.get("industry", "default"),
                              r.get("city", ""),
                              int(r.get("review_count") or 0),
                              r.get("source", "csv"),
                              utcnow()))
                lead_ids.append(lid)
        for lid in lead_ids:
            schedule_outreach_for_lead(lid)
        return json_response(self, 200, {"imported": len(lead_ids), "queued": len(lead_ids) * 3})

    def _api_outreach_list(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        from urllib.parse import urlparse, parse_qs
        qs = parse_qs(urlparse(self.path).query)
        status = qs.get("status", [None])[0]
        industry = qs.get("industry", [None])[0]
        where = []
        params = []
        if status:
            where.append("status = ?")
            params.append(status)
        if industry:
            where.append("industry = ?")
            params.append(industry)
        sql = "SELECT * FROM leads"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY created_at DESC LIMIT 500"
        with _db_lock, db() as conn:
            rows = conn.execute(sql, params).fetchall()
        return json_response(self, 200, {"leads": [dict(r) for r in rows]})

    def _api_outreach_patch_lead(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        lid = path.split("/")[4]
        data = read_json(self) or {}
        fields = []
        params = []
        for key in ("status", "notes"):
            if key in data:
                fields.append(f"{key} = ?")
                params.append(data[key])
        if not fields:
            return json_response(self, 400, {"error": "no fields to update"})
        fields.append("last_action_at = ?")
        params.append(utcnow())
        params.append(lid)
        with _db_lock, db() as conn:
            conn.execute(f"UPDATE leads SET {', '.join(fields)} WHERE id = ?", params)
        return json_response(self, 200, {"ok": True})

    def _api_outreach_send_now(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        lid = path.split("/")[4]
        with _db_lock, db() as conn:
            row = conn.execute("""SELECT id FROM outreach_emails
                                  WHERE lead_id=? AND status='scheduled'
                                  ORDER BY sequence_num LIMIT 1""", (lid,)).fetchone()
            if not row:
                return json_response(self, 400, {"error": "no scheduled outreach email"})
            target = row["id"]
        ok = send_outreach_email_now(target)
        return json_response(self, 200, {"sent": ok})

    def _api_outreach_close_lead(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        lid = path.split("/")[4]
        data = read_json(self) or {}
        client_email = (data.get("client_email") or "").strip().lower()
        client_password = data.get("client_password") or secrets.token_urlsafe(10)
        industry = data.get("industry") or "default"

        with _db_lock, db() as conn:
            lead = conn.execute("SELECT * FROM leads WHERE id=?", (lid,)).fetchone()
            if not lead:
                return json_response(self, 404, {"error": "lead not found"})
            user = conn.execute("SELECT id FROM users WHERE email=?", (client_email,)).fetchone() if client_email else None
            if user:
                user_id = user["id"]
            else:
                if not client_email:
                    return json_response(self, 400, {"error": "client_email required"})
                h, salt = hash_password(client_password)
                user_id = new_id()
                conn.execute("""INSERT INTO users(id, email, password_hash, password_salt,
                              business_name, industry, created_at) VALUES (?,?,?,?,?,?,?)""",
                             (user_id, client_email, h, salt, lead["business_name"], industry, utcnow()))
            cid = new_id()
            conn.execute("""INSERT INTO campaigns(id, user_id, name, industry, status, created_at)
                            VALUES (?,?,?,?, 'draft', ?)""",
                         (cid, user_id, f"{lead['business_name']} — reactivation", industry, utcnow()))
            conn.execute("UPDATE leads SET status='closed_won', last_action_at=? WHERE id=?",
                         (utcnow(), lid))
        return json_response(self, 200, {
            "ok": True,
            "user_id": user_id,
            "campaign_id": cid,
            "client_email": client_email,
            "client_password": client_password if not user else None,
        })

    def _api_outreach_stats(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        with _db_lock, db() as conn:
            rows = conn.execute("""SELECT status, COUNT(*) AS n FROM leads GROUP BY status""").fetchall()
            stats = {r["status"]: r["n"] for r in rows}
            today = datetime.now(timezone.utc).date().isoformat()
            sent_today = conn.execute(
                "SELECT COUNT(*) AS n FROM outreach_emails WHERE sent_at >= ?", (today,)
            ).fetchone()["n"]
            opens = conn.execute(
                "SELECT COUNT(*) AS n FROM outreach_emails WHERE opened_at IS NOT NULL"
            ).fetchone()["n"]
            sent_total = conn.execute(
                "SELECT COUNT(*) AS n FROM outreach_emails WHERE status='sent'"
            ).fetchone()["n"]
        return json_response(self, 200, {
            "by_status": stats,
            "sent_today": sent_today,
            "opens_total": opens,
            "sent_total": sent_total,
            "open_rate": round(opens / sent_total, 3) if sent_total else 0,
        })

    def _api_outreach_settings(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        if self.command == "POST":
            data = read_json(self) or {}
            fields = []
            params = []
            for k in ("daily_send_limit", "delay_between_seconds", "followup_after_days",
                      "max_followups", "operator_email", "operator_name"):
                if k in data:
                    fields.append(f"{k} = ?")
                    params.append(data[k])
            if not fields:
                return json_response(self, 400, {"error": "no fields"})
            fields.append("updated_at = ?")
            params.append(utcnow())
            with _db_lock, db() as conn:
                conn.execute("INSERT OR IGNORE INTO outreach_settings(id, updated_at) VALUES (1, ?)", (utcnow(),))
                conn.execute(f"UPDATE outreach_settings SET {', '.join(fields)} WHERE id = 1", params)
        return json_response(self, 200, get_outreach_settings())

    def _api_me(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        with _db_lock, db() as conn:
            row = conn.execute("SELECT id, email, business_name, industry FROM users WHERE id=?",
                               (uid,)).fetchone()
        return json_response(self, 200, dict(row))

    def _api_list_campaigns(self):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        with _db_lock, db() as conn:
            rows = conn.execute("""
                SELECT c.id, c.name, c.industry, c.status, c.created_at, c.launched_at,
                       (SELECT COUNT(*) FROM customers WHERE campaign_id=c.id) AS customer_count,
                       (SELECT COUNT(*) FROM messages WHERE campaign_id=c.id) AS message_count,
                       (SELECT COUNT(*) FROM messages WHERE campaign_id=c.id AND status='sent') AS sent_count
                FROM campaigns c WHERE c.user_id=? ORDER BY c.created_at DESC
            """, (uid,)).fetchall()
        return json_response(self, 200, {"campaigns": [dict(r) for r in rows]})

    def _api_get_campaign(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        cid = path.split("/")[3]
        with _db_lock, db() as conn:
            camp = conn.execute("SELECT * FROM campaigns WHERE id=? AND user_id=?",
                                (cid, uid)).fetchone()
            if not camp:
                return json_response(self, 404, {"error": "not found"})
            customers = conn.execute(
                "SELECT id, first_name, last_name, email, phone, last_service, status FROM customers WHERE campaign_id=?",
                (cid,)).fetchall()
            messages = conn.execute("""
                SELECT m.id, m.channel, m.sequence_num, m.subject, m.body, m.scheduled_at,
                       m.status, m.sent_at, m.opened_at, m.replied_at,
                       c.first_name, c.last_name
                FROM messages m JOIN customers c ON c.id=m.customer_id
                WHERE m.campaign_id=? ORDER BY c.last_name, m.sequence_num
            """, (cid,)).fetchall()
        return json_response(self, 200, {
            "campaign": dict(camp),
            "customers": [dict(r) for r in customers],
            "messages": [dict(r) for r in messages],
        })

    def _api_upload_customers(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        cid = path.split("/")[3]
        with _db_lock, db() as conn:
            camp = conn.execute("SELECT id FROM campaigns WHERE id=? AND user_id=?",
                                (cid, uid)).fetchone()
            if not camp:
                return json_response(self, 404, {"error": "not found"})
            if conn.execute("SELECT COUNT(*) AS n FROM messages WHERE campaign_id=?", (cid,)).fetchone()["n"] > 0:
                return json_response(self, 400, {"error": "campaign already has messages — create a new campaign"})

        data = read_json(self) or {}
        csv_text = data.get("csv") or ""
        rows = parse_csv(csv_text)
        if not rows:
            return json_response(self, 400, {"error": "no valid rows found (need at least first_name + email or phone)"})

        with _db_lock, db() as conn:
            for r in rows:
                cid_new = new_id()
                conn.execute("""
                    INSERT INTO customers(id, campaign_id, first_name, last_name, email, phone,
                                          last_service, last_service_date)
                    VALUES (?,?,?,?,?,?,?,?)
                """, (cid_new, cid,
                      r.get("first_name", ""), r.get("last_name", ""),
                      r.get("email", ""), r.get("phone", ""),
                      r.get("last_service", ""), r.get("last_service_date", "")))
        return json_response(self, 200, {"imported": len(rows)})

    def _api_generate(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        cid = path.split("/")[3]
        with _db_lock, db() as conn:
            camp = conn.execute("""SELECT c.*, u.business_name, u.industry AS user_industry
                                   FROM campaigns c JOIN users u ON u.id=c.user_id
                                   WHERE c.id=? AND c.user_id=?""", (cid, uid)).fetchone()
            if not camp:
                return json_response(self, 404, {"error": "not found"})
            if conn.execute("SELECT COUNT(*) AS n FROM messages WHERE campaign_id=?", (cid,)).fetchone()["n"] > 0:
                return json_response(self, 400, {"error": "messages already generated for this campaign"})
            customers = conn.execute("SELECT * FROM customers WHERE campaign_id=?", (cid,)).fetchall()

        bizname = camp["business_name"] or camp["name"]
        count = 0
        with _db_lock, db() as conn:
            for c in customers:
                msgs = render_messages(camp["industry"], dict(c), bizname)
                for m in msgs:
                    mid = new_id()
                    unsub = secrets.token_urlsafe(24)
                    conn.execute("""
                        INSERT INTO messages(id, campaign_id, customer_id, channel, sequence_num,
                                            subject, body, scheduled_at, status, unsubscribe_token)
                        VALUES (?,?,?,?,?,?,?,?, 'scheduled', ?)
                    """, (mid, cid, c["id"], m["channel"], m["sequence_num"],
                          m["subject"], m["body"], m["scheduled_at"], unsub))
                    count += 1
        return json_response(self, 200, {"generated": count})

    def _api_launch(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        cid = path.split("/")[3]
        with _db_lock, db() as conn:
            camp = conn.execute("SELECT id, status FROM campaigns WHERE id=? AND user_id=?",
                                (cid, uid)).fetchone()
            if not camp:
                return json_response(self, 404, {"error": "not found"})
            if camp["status"] != "draft":
                return json_response(self, 400, {"error": "campaign not in draft"})
            n = conn.execute("SELECT COUNT(*) AS n FROM messages WHERE campaign_id=?", (cid,)).fetchone()["n"]
            if n == 0:
                return json_response(self, 400, {"error": "generate messages first"})
            conn.execute("UPDATE campaigns SET status='active', launched_at=? WHERE id=?",
                         (utcnow(), cid))
        return json_response(self, 200, {"ok": True, "messages": n})

    def _api_pause(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        cid = path.split("/")[3]
        with _db_lock, db() as conn:
            conn.execute("UPDATE campaigns SET status='paused', paused_at=? WHERE id=? AND user_id=?",
                         (utcnow(), cid, uid))
        return json_response(self, 200, {"ok": True})

    def _api_campaign_stats(self, path):
        uid = require_auth(self)
        if not uid:
            return json_response(self, 401, {"error": "unauthorized"})
        cid = path.split("/")[3]
        with _db_lock, db() as conn:
            camp = conn.execute("SELECT id, name FROM campaigns WHERE id=? AND user_id=?",
                                (cid, uid)).fetchone()
            if not camp:
                return json_response(self, 404, {"error": "not found"})
            stats = conn.execute("""
                SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
                  SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
                  SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
                  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
                FROM messages WHERE campaign_id=?
            """, (cid,)).fetchone()
            total_customers = conn.execute(
                "SELECT COUNT(*) AS n FROM customers WHERE campaign_id=?", (cid,)).fetchone()["n"]
        return json_response(self, 200, {"stats": dict(stats), "customers": total_customers})

    PIXEL = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )

    def _track_open(self, mid):
        try:
            with _db_lock, db() as conn:
                if conn.execute("SELECT 1 FROM messages WHERE id=? AND opened_at IS NULL",
                                (mid,)).fetchone():
                    conn.execute("UPDATE messages SET opened_at=? WHERE id=?", (utcnow(), mid))
                    conn.execute("INSERT INTO events(id, message_id, type, occurred_at) VALUES (?,?,?,?)",
                                 (new_id(), mid, "open", utcnow()))
        except Exception:
            pass
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(self.PIXEL)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.end_headers()
        self.wfile.write(self.PIXEL)

    def _track_outreach(self, token):
        try:
            with _db_lock, db() as conn:
                row = conn.execute(
                    "SELECT id, lead_id FROM outreach_emails WHERE tracking_token=? AND opened_at IS NULL",
                    (token,)).fetchone()
                if row:
                    conn.execute("UPDATE outreach_emails SET opened_at=? WHERE id=?", (utcnow(), row["id"]))
                    conn.execute("UPDATE leads SET status='opened', last_action_at=? WHERE id=? AND status IN ('new','sent')",
                                 (utcnow(), row["lead_id"]))
        except Exception:
            pass
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(self.PIXEL)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.end_headers()
        self.wfile.write(self.PIXEL)

    def _unsubscribe_outreach(self, token):
        try:
            with _db_lock, db() as conn:
                row = conn.execute("SELECT id, lead_id FROM outreach_emails WHERE tracking_token=?",
                                   (token,)).fetchone()
                if row:
                    conn.execute("UPDATE leads SET status='unsubscribed', last_action_at=? WHERE id=?",
                                 (utcnow(), row["lead_id"]))
                    conn.execute("UPDATE outreach_emails SET status='unsubscribed' WHERE lead_id=? AND status='scheduled'",
                                 (row["lead_id"],))
        except Exception as e:
            log.error("outreach unsubscribe error: %s", e)
        body = b"You've been unsubscribed from our outreach. No further emails will be sent."
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _unsubscribe(self, token):
        try:
            with _db_lock, db() as conn:
                msg = conn.execute("SELECT id, customer_id, campaign_id FROM messages WHERE unsubscribe_token=?",
                                   (token,)).fetchone()
                if msg:
                    conn.execute("UPDATE customers SET status='opted_out' WHERE id=?", (msg["customer_id"],))
                    conn.execute("UPDATE messages SET status='opted_out' WHERE customer_id=? AND status='scheduled'",
                                 (msg["customer_id"],))
                    conn.execute("INSERT INTO events(id, message_id, type, occurred_at, payload) VALUES (?,?,?,?,?)",
                                 (new_id(), msg["id"], "unsubscribe", utcnow(), ""))
        except Exception as e:
            log.error("unsubscribe error: %s", e)
        body = b"You've been unsubscribed. You won't receive further messages."
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ThreadedServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()

    init_db()
    load_web()
    start_scheduler_once()

    server = ThreadedServer((args.host, args.port), Handler)
    log.info("Respark running on http://%s:%s", args.host, args.port)
    print(f"Respark running on http://{args.host}:{args.port}")
    print(f"DB: {DB_PATH}")
    print(f"Log: {APP_LOG}")
    print(f"Outbox (no SMTP): {LOG_FILE}")
    print(f"SMTP configured: {bool(SMTP_HOST)}")
    print(f"OpenAI configured: {bool(OPENAI_KEY)}")
    print(f"Public signup: {ALLOW_SIGNUP}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
