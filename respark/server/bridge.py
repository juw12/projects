"""
Respark Bridge: Industrial Connect inside Respark
==================================================
You (the operator) become the bridge between industrial companies and the
investors, buyers and suppliers who want to work with them.

  * Each client company gets a hosted showcase portal at  /c/<slug>/
    (catalog, 3D product viewer, investor brief, supplier portal).
  * A public hub at  /hub  lists every published company and takes
    "I'm looking for..." requests that only you see.
  * Every inquiry lands in YOUR inbox first (routing = "via_bridge"):
    you screen it, get suggested matches, and introduce it to one or
    more companies. Track status, deal value and your success fee.
  * Company owners log in to  /bridge  and see only the introductions
    you have made to them, plus their portal content and traffic.
  * Respark's outreach pipeline gets a "manufacturer" industry. Closing
    a manufacturer lead creates the client account AND a draft portal.

Stdlib only. Uses the core server's DB, sessions and email.
Wired in from server.py via bridge.attach(module) and bridge.handle(...).

Environment variables (all optional):
    RESPARK_OPERATOR_EMAILS   comma-separated operator logins. If unset, the
                              first registered account is the operator.
    RESPARK_HUB_NAME          public name of your bridge (default "Titian")
    RESPARK_INTRO_TERMS       text a company must accept before it sees a requester's contact
    RESPARK_OPERATOR_WHATSAPP your WhatsApp number (digits, with country code). Via-bridge
                              portals and the hub hand chats to this number.
"""

import html
import json
import os
import statistics
import re
import secrets
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

core = None  # the server module, injected by attach()

HUB_NAME_DEFAULT = "Titian"
INQUIRY_TYPES = ("customer", "investor", "supplier", "general", "listing")
INQUIRY_STATUSES = ("new", "screening", "introduced", "in_talks", "won", "lost", "spam")
INTRO_STATUSES = ("sent", "accepted", "declined", "in_talks", "won", "lost")
COMPANY_STATUSES = ("draft", "published", "archived")
ROUTING_MODES = ("via_bridge", "direct")
SEEKING_OPTIONS = ("customers", "investment", "suppliers", "partners")
BRIDGE_INDUSTRIES = ("manufacturer",)

MAX_BODY_BYTES = 600_000

# Trust layer: what the operator checked before vouching for a company.
VERIFY_CHECKS = (
    ("registration", "Business registration checked"),
    ("site_visit", "Factory visited or video-audited"),
    ("certificates", "Certificates sighted"),
    ("references", "Customer references checked"),
)
VERIFY_REQUIRED = ("registration", "site_visit")
VERIFY_VALID_DAYS = 365

# Track record: public response stats only once there is enough history to be fair.
TRACK_MIN_INTROS = 3
MAX_FIELD_CHARS = 4000
MAX_FIELDS = 40

SCHEMA = """
CREATE TABLE IF NOT EXISTS ic_companies (
  id              TEXT PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,
  owner_user_id   TEXT,
  lead_id         TEXT,
  name            TEXT NOT NULL,
  industry        TEXT,
  country         TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  routing         TEXT NOT NULL DEFAULT 'via_bridge',
  seeking         TEXT NOT NULL DEFAULT '["customers","investment","suppliers"]',
  data_json       TEXT NOT NULL,
  verification_json TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ic_inquiries (
  id              TEXT PRIMARY KEY,
  ref             TEXT UNIQUE NOT NULL,
  company_id      TEXT,
  type            TEXT NOT NULL,
  name            TEXT,
  email           TEXT,
  organisation    TEXT,
  fields_json     TEXT NOT NULL,
  score           INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'new',
  deal_value      REAL,
  fee             REAL,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ic_intros (
  id              TEXT PRIMARY KEY,
  inquiry_id      TEXT NOT NULL,
  company_id      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent',
  note            TEXT,
  share_contact   INTEGER NOT NULL DEFAULT 1,
  via_bridge      INTEGER NOT NULL DEFAULT 1,
  responded_at    TEXT,
  terms_accepted_at TEXT,
  terms_text      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(inquiry_id, company_id)
);

CREATE TABLE IF NOT EXISTS ic_reviews (
  id              TEXT PRIMARY KEY,
  intro_id        TEXT UNIQUE NOT NULL,
  company_id      TEXT NOT NULL,
  token           TEXT UNIQUE NOT NULL,
  rating          INTEGER,
  comment         TEXT,
  reviewer_name   TEXT,
  created_at      TEXT NOT NULL,
  submitted_at    TEXT
);

CREATE TABLE IF NOT EXISTS ic_views (
  company_id      TEXT NOT NULL,
  day             TEXT NOT NULL,
  page            TEXT NOT NULL,
  n               INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day, page)
);

CREATE INDEX IF NOT EXISTS idx_ic_companies_status ON ic_companies(status);
CREATE INDEX IF NOT EXISTS idx_ic_companies_owner ON ic_companies(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_ic_inquiries_company ON ic_inquiries(company_id);
CREATE INDEX IF NOT EXISTS idx_ic_inquiries_status ON ic_inquiries(status);
CREATE INDEX IF NOT EXISTS idx_ic_intros_company ON ic_intros(company_id);
CREATE INDEX IF NOT EXISTS idx_ic_intros_inquiry ON ic_intros(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_ic_reviews_company ON ic_reviews(company_id)
"""

# Outreach templates for prospecting manufacturers (merged into core at attach()).
OUTREACH_TEMPLATES = {
    "manufacturer": {
        "step1": {
            "subject": "Investors and buyers asking about {{industry_label}} suppliers in {{city}}",
            "body": "Hi {{contact_name}},\n\nI'm {{operator_name}}. I run {{hub_name}}, a network that introduces industrial manufacturers to investors, OEM buyers and reliable suppliers.\n\nI put together a draft showcase for companies like {{business_name}} (product catalog, 3D models, investor brief and supplier portal) and every inquiry is screened by us before it reaches you, so you only get qualified introductions.\n\nSee the network: {{demo_link}}\n\nWorth a 15-minute call to see if it fits?\n\n- {{operator_name}}\n{{operator_email}}",
        },
        "step2": {
            "subject": "Re: introductions for {{business_name}}",
            "body": "Hi {{contact_name}},\n\nFollowing up. We set up the portal, list you on the hub and screen every buyer, investor and supplier inquiry. You only pay for the setup and a monthly fee, plus a success fee on deals we introduce.\n\nHappy to build your draft portal for free so you can see it first.\n\n15 minutes this week?\n\n- {{operator_name}}",
        },
        "step3": {
            "subject": "Closing the loop",
            "body": "Hi {{contact_name}},\n\nLast note from me. Should I keep {{business_name}} in mind when matching buyers and investors, or take you off my list?\n\nEither way is fine.\n\n- {{operator_name}}",
        },
    }
}
INDUSTRY_LABELS = {"manufacturer": "manufacturing / industrial"}

_rate_lock = threading.Lock()
_rate_hits = {}


# --------------------------------------------------------------------- wiring

def attach(core_module):
    """Called once by server.py after its globals exist."""
    global core
    core = core_module
    core.OUTREACH_TEMPLATES.update(OUTREACH_TEMPLATES)
    core.INDUSTRY_LABELS.update(INDUSTRY_LABELS)
    if hasattr(core, "OUTREACH_INDUSTRIES"):
        for key in OUTREACH_TEMPLATES:
            if key not in core.OUTREACH_INDUSTRIES:
                core.OUTREACH_INDUSTRIES.append(key)


def migrate(conn):
    """Add columns introduced after the first release to existing databases."""
    columns = {r[1] for r in conn.execute("PRAGMA table_info(ic_companies)").fetchall()}
    if "verification_json" not in columns:
        conn.execute("ALTER TABLE ic_companies ADD COLUMN verification_json TEXT NOT NULL DEFAULT '{}'")
    intro_columns = {r[1] for r in conn.execute("PRAGMA table_info(ic_intros)").fetchall()}
    if "via_bridge" not in intro_columns:
        conn.execute("ALTER TABLE ic_intros ADD COLUMN via_bridge INTEGER NOT NULL DEFAULT 1")
    if "responded_at" not in intro_columns:
        conn.execute("ALTER TABLE ic_intros ADD COLUMN responded_at TEXT")
    if "terms_text" not in intro_columns:
        conn.execute("ALTER TABLE ic_intros ADD COLUMN terms_text TEXT")
    if "terms_accepted_at" not in intro_columns:
        conn.execute("ALTER TABLE ic_intros ADD COLUMN terms_accepted_at TEXT")
        conn.execute("UPDATE ic_intros SET terms_accepted_at = created_at")


def hub_name():
    return os.environ.get("RESPARK_HUB_NAME", HUB_NAME_DEFAULT)


def demo_path(industry):
    """Link used in outreach emails: manufacturers see the hub, others the Respark landing."""
    return "/hub" if industry in BRIDGE_INDUSTRIES else "/"


def web_dir():
    return os.path.join(core.ROOT, "web")


def now():
    return core.utcnow()


# --------------------------------------------------------------------- auth / roles

def operator_emails():
    raw = os.environ.get("RESPARK_OPERATOR_EMAILS", "")
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def is_operator(uid):
    if not uid:
        return False
    with core._db_lock, core.db() as conn:
        row = conn.execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone()
        if not row:
            return False
        emails = operator_emails()
        if emails:
            return (row["email"] or "").lower() in emails
        first = conn.execute("SELECT id FROM users ORDER BY rowid ASC LIMIT 1").fetchone()
    return bool(first) and first["id"] == uid


def owned_company_ids(conn, uid):
    rows = conn.execute("SELECT id FROM ic_companies WHERE owner_user_id=?", (uid,)).fetchall()
    return [r["id"] for r in rows]


# --------------------------------------------------------------------- helpers

def slugify(text):
    slug = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return slug[:48] or "company"


def unique_slug(conn, name):
    base = slugify(name)
    slug = base
    n = 2
    while conn.execute("SELECT 1 FROM ic_companies WHERE slug=?", (slug,)).fetchone():
        slug = f"{base}-{n}"
        n += 1
    return slug


def load_template():
    with open(os.path.join(web_dir(), "ic", "template.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def default_company_data(name, contact_email="", city="", industry=""):
    data = load_template()
    data["company"]["name"] = name
    data["company"]["legalName"] = name
    data["company"]["hq"] = city or data["company"].get("hq", "")
    data["company"]["tagline"] = f"{name}: products and partnership opportunities"
    if contact_email:
        data["contact"]["email"] = contact_email
        data["contact"]["investorEmail"] = contact_email
        data["contact"]["procurementEmail"] = contact_email
    data.setdefault("settings", {})["formEndpoint"] = ""
    data["settings"].pop("adminPin", None)
    data["_draftNote"] = "Template content. Replace products, figures and certifications with verified company data before publishing."
    return data


def validate_company_data(data):
    if not isinstance(data, dict):
        return "data must be an object"
    if not isinstance(data.get("company"), dict) or not data["company"].get("name"):
        return "data.company.name is required"
    if not isinstance(data.get("products"), list):
        return "data.products must be a list"
    for key in ("contact", "audiences", "investors", "suppliers"):
        if key in data and not isinstance(data[key], dict):
            return f"data.{key} must be an object"
    if len(json.dumps(data)) > MAX_BODY_BYTES:
        return "data too large"
    return None


def clean_fields(raw):
    """Keep inquiry fields small and string-only."""
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, value in list(raw.items())[:MAX_FIELDS]:
        key = re.sub(r"[^A-Za-z0-9_]", "", str(key))[:40]
        if not key or key.startswith("_"):
            continue
        if isinstance(value, list):
            out[key] = [str(v)[:MAX_FIELD_CHARS] for v in value[:30]]
        elif value is None:
            continue
        else:
            out[key] = str(value)[:MAX_FIELD_CHARS]
    return out


def as_list(value):
    if not value:
        return []
    return value if isinstance(value, list) else [value]


def valid_email(email):
    return bool(re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email or ""))


def rate_limited(ip, limit=20, window=600):
    t = time.time()
    with _rate_lock:
        hits = [h for h in _rate_hits.get(ip, []) if t - h < window]
        if len(hits) >= limit:
            _rate_hits[ip] = hits
            return True
        hits.append(t)
        _rate_hits[ip] = hits
    return False


def score_inquiry(kind, f):
    """Same transparent 0-100 scoring as the portal, enforced server-side."""
    score = 0
    if kind == "investor":
        score += {"< USD 1M": 10, "USD 1–5M": 25, "USD 5–15M": 40, "> USD 15M": 35}.get(f.get("ticket"), 0)
        score += {"Private equity": 20, "Strategic / corporate": 20, "Venture / growth fund": 15,
                  "Family office": 15, "Bank / debt": 10, "Angel": 5}.get(f.get("investorType"), 0)
        score += 20 if f.get("nda") else 0
        score += 10 if (f.get("firm") or f.get("company")) else 0
        score += 10 if len(f.get("message") or "") > 40 else 0
    elif kind == "customer":
        score += min(len(as_list(f.get("items"))) * 10, 30)
        score += {"Prototype / one-off": 5, "< 500 pcs/yr": 15, "500 – 5,000 pcs/yr": 25,
                  "> 5,000 pcs/yr": 35}.get(f.get("volume"), 0)
        score += {"Within 1 month": 20, "1 – 3 months": 15, "3 – 6 months": 8,
                  "Just budgeting": 2}.get(f.get("timeline"), 0)
        score += 10 if f.get("attachment") else 0
        score += 5 if f.get("phone") else 0
    elif kind == "supplier":
        score += min(len(as_list(f.get("categories"))) * 10, 30)
        score += min(len(as_list(f.get("certifications"))) * 15, 45)
        score += 10 if f.get("website") else 0
        score += 10 if f.get("capacity") else 0
        score += 5 if f.get("attachment") else 0
    elif kind == "listing":
        score = 50 + (20 if f.get("website") else 0) + (20 if len(f.get("message") or "") > 40 else 0)
    else:
        score = 30 + (20 if len(f.get("message") or "") > 80 else 0)
    return min(100, score)


def score_label(score):
    if score >= 70:
        return "hot"
    if score >= 40:
        return "warm"
    return "cold"


def raw_verification(row):
    if "verification_json" not in row.keys():
        return {}
    try:
        value = json.loads(row["verification_json"] or "{}")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def verification_public(row, include_private=False):
    """Operator-issued trust badge. Stored outside data_json so owners cannot self-verify."""
    raw = raw_verification(row)
    checks = raw.get("checks") or {}
    items = [{"key": key, "label": label, "ok": bool(checks.get(key))} for key, label in VERIFY_CHECKS]
    verified_at = raw.get("verified_at") or ""
    expires_at = ""
    expired = False
    if verified_at:
        try:
            issued = datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
            expiry = issued + timedelta(days=VERIFY_VALID_DAYS)
            expires_at = expiry.isoformat()
            expired = expiry < datetime.now(timezone.utc)
        except ValueError:
            expired = True
    complete = all(checks.get(key) for key in VERIFY_REQUIRED)
    if not verified_at:
        status = "none"
    elif expired:
        status = "expired"
    elif complete:
        status = "verified"
    else:
        status = "partial"
    out = {
        "verified": status == "verified",
        "status": status,
        "checks": items,
        "verified_at": verified_at,
        "expires_at": expires_at,
        "registration_no": raw.get("registration_no", ""),
        "issuer": hub_name(),
    }
    if include_private:
        out["note"] = raw.get("note", "")
        out["verified_by"] = raw.get("verified_by", "")
    return out


def digits(value):
    return re.sub(r"\D", "", str(value or ""))[:16]


def operator_whatsapp():
    return digits(os.environ.get("RESPARK_OPERATOR_WHATSAPP", ""))


def portal_whatsapp(row, data):
    """Via-bridge portals route chat to the operator so introductions stay brokered."""
    if row["routing"] == "direct":
        return digits((data.get("contact") or {}).get("whatsapp")) or operator_whatsapp()
    return operator_whatsapp()


def intro_terms():
    default = (f"Deals that result from this introduction are covered by your {hub_name()} "
               "service agreement, including the agreed success fee.")
    return os.environ.get("RESPARK_INTRO_TERMS", default)


def parse_time(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def track_record(conn, company_id):
    """Outcome history earned through real introductions. A copycat starts at zero."""
    intros = conn.execute("SELECT status, created_at, responded_at FROM ic_intros WHERE company_id=?",
                          (company_id,)).fetchall()
    hours = []
    for i in intros:
        start, end = parse_time(i["created_at"]), parse_time(i["responded_at"]) if i["responded_at"] else None
        if start and end:
            hours.append(max(0.0, (end - start).total_seconds() / 3600))
    ratings = [r["rating"] for r in conn.execute(
        "SELECT rating FROM ic_reviews WHERE company_id=? AND submitted_at IS NOT NULL", (company_id,)).fetchall()]
    total = len(intros)
    enough = total >= TRACK_MIN_INTROS
    return {
        "introductions": total,
        "enough_data": enough,
        "response_rate": round(100 * len(hours) / total) if enough else None,
        "median_response_hours": round(statistics.median(hours), 1) if enough and hours else None,
        "deals_won": sum(1 for i in intros if i["status"] == "won"),
        "reviews": len(ratings),
        "rating": round(sum(ratings) / len(ratings), 1) if ratings else None,
        "member_since": min((i["created_at"] for i in intros), default=""),
    }


def public_reviews(conn, company_id, limit=10):
    rows = conn.execute("""SELECT r.rating, r.comment, r.reviewer_name, r.submitted_at, q.type
                           FROM ic_reviews r
                           JOIN ic_intros i ON i.id = r.intro_id
                           JOIN ic_inquiries q ON q.id = i.inquiry_id
                           WHERE r.company_id=? AND r.submitted_at IS NOT NULL
                           ORDER BY r.submitted_at DESC LIMIT ?""", (company_id, limit)).fetchall()
    return [{
        "rating": r["rating"],
        "comment": r["comment"] or "",
        "reviewer": r["reviewer_name"] or f"Verified {r['type']}",
        "type": r["type"],
        "date": (r["submitted_at"] or "")[:10],
    } for r in rows]


def request_review(conn, intro_id):
    """Create a one-time review link for the requester of a won introduction."""
    if conn.execute("SELECT 1 FROM ic_reviews WHERE intro_id=?", (intro_id,)).fetchone():
        return None
    row = conn.execute("""SELECT i.company_id, q.email, q.name, c.name AS company_name
                          FROM ic_intros i JOIN ic_inquiries q ON q.id = i.inquiry_id
                          JOIN ic_companies c ON c.id = i.company_id WHERE i.id=?""", (intro_id,)).fetchone()
    if not row or not row["email"]:
        return None
    token = secrets.token_urlsafe(18)
    conn.execute("INSERT INTO ic_reviews(id, intro_id, company_id, token, created_at) VALUES (?,?,?,?,?)",
                 (core.new_id(), intro_id, row["company_id"], token, now()))
    link = f"{core.BASE_URL}/r/{token}"
    body = (f"Hello {row['name'] or ''},\n\nYour deal with {row['company_name']} was recorded as closed. "
            f"Would you rate how it went? It takes 30 seconds and helps other buyers:\n\n{link}\n\n"
            f"Only buyers introduced by {hub_name()} can leave a review.\n\n- {hub_name()}")
    return row["email"], f"[{hub_name()}] How was {row['company_name']}?", body


def company_summary(row, include_private=False):
    data = json.loads(row["data_json"])
    company = data.get("company", {})
    products = data.get("products", [])
    out = {
        "slug": row["slug"],
        "name": row["name"],
        "industry": row["industry"] or "",
        "country": row["country"] or company.get("hq", ""),
        "tagline": company.get("tagline", ""),
        "about": company.get("about", ""),
        "seeking": json.loads(row["seeking"] or "[]"),
        "categories": sorted({p.get("category", "") for p in products if p.get("category")}),
        "products": [p.get("name", "") for p in products[:4]],
        "product_count": len(products),
        "certifications": company.get("certifications", [])[:4],
        "stats": company.get("stats", [])[:2],
        "portal_url": f"/c/{row['slug']}/",
        "verification": verification_public(row, include_private),
    }
    if include_private:
        out.update({
            "id": row["id"],
            "status": row["status"],
            "routing": row["routing"],
            "owner_user_id": row["owner_user_id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        })
    return out


# --------------------------------------------------------------------- matching

STOPWORDS = set("""
the and for with from that this your you our are was were have has had not but all any can
will would into over under per pcs year years month months need needs looking want wants
company companies product products please about more than less other also just very
""".split())


def tokens(text):
    words = re.findall(r"[a-z0-9][a-z0-9\-\.]{2,}", (text or "").lower())
    return {w.strip(".-") for w in words if w not in STOPWORDS and not w.isdigit()}


def company_corpus(data):
    company = data.get("company", {})
    parts = [company.get("name", ""), company.get("tagline", ""), company.get("about", "")]
    product_parts = []
    for p in data.get("products", []):
        product_parts += [p.get("name", ""), p.get("category", ""), p.get("summary", ""), p.get("description", "")]
        product_parts += list((p.get("specs") or {}).values())
        product_parts += p.get("applications") or []
    capability_parts = [c.get("title", "") + " " + c.get("detail", "") for c in data.get("capabilities", [])]
    supplier_parts = [c.get("name", "") + " " + c.get("detail", "") for c in data.get("suppliers", {}).get("categories", [])]
    return {
        "general": tokens(" ".join(parts + capability_parts)),
        "products": tokens(" ".join(str(x) for x in product_parts)),
        "sourcing": tokens(" ".join(supplier_parts)),
    }


def suggest_matches(conn, inquiry, limit=5):
    fields = json.loads(inquiry["fields_json"])
    text = " ".join(" ".join(as_list(v)) for v in fields.values())
    want = tokens(text)
    already = {r["company_id"] for r in conn.execute(
        "SELECT company_id FROM ic_intros WHERE inquiry_id=?", (inquiry["id"],)).fetchall()}
    rows = conn.execute("SELECT * FROM ic_companies WHERE status != 'archived'").fetchall()
    results = []
    for row in rows:
        if row["id"] in already:
            continue
        data = json.loads(row["data_json"])
        corpus = company_corpus(data)
        seeking = set(json.loads(row["seeking"] or "[]"))
        kind = inquiry["type"]
        hits_products = want & corpus["products"]
        hits_sourcing = want & corpus["sourcing"]
        hits_general = want & corpus["general"]
        score = len(hits_general)
        reasons = []
        if kind == "customer":
            score += 2 * len(hits_products)
            if "customers" in seeking:
                score += 2
                reasons.append("seeking customers")
        elif kind == "supplier":
            score += 3 * len(hits_sourcing)
            if "suppliers" in seeking:
                score += 2
                reasons.append("seeking suppliers")
        elif kind == "investor":
            score += len(hits_products)
            if "investment" in seeking:
                score += 6
                reasons.append("raising investment")
        else:
            score += len(hits_products) + len(hits_sourcing)
        keywords = sorted(hits_products | hits_sourcing | hits_general)[:8]
        if keywords:
            reasons.append("matches: " + ", ".join(keywords))
        if row["id"] == inquiry["company_id"]:
            score += 10
            reasons.insert(0, "inquired via this portal")
        if score > 0:
            # relevance first; then prefer companies with a proven record on this network
            if verification_public(row)["verified"]:
                score += 3
                reasons.append("verified")
            record = track_record(conn, row["id"])
            if record["deals_won"]:
                score += min(2 * record["deals_won"], 6)
                reasons.append(f"{record['deals_won']} deal(s) won here")
            if record["rating"] is not None:
                score += round(record["rating"] - 3)
                reasons.append(f"rated {record['rating']}/5")
            if record["enough_data"] and (record["response_rate"] or 0) >= 80:
                score += 2
                reasons.append(f"answers {record['response_rate']}% of intros")
            results.append({
                "company_id": row["id"],
                "name": row["name"],
                "slug": row["slug"],
                "status": row["status"],
                "score": score,
                "reasons": reasons,
            })
    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]


# --------------------------------------------------------------------- notifications

def format_fields(fields, hide_contact=False):
    hidden = {"email", "phone"} if hide_contact else set()
    lines = []
    for key, value in fields.items():
        if key in hidden:
            continue
        lines.append(f"  {key}: {', '.join(as_list(value))}")
    return "\n".join(lines)


def notify_operators(inquiry_row, company_name):
    emails = operator_emails()
    if not emails:
        settings = core.get_outreach_settings()
        if settings.get("operator_email"):
            emails = {settings["operator_email"]}
    if not emails:
        with core._db_lock, core.db() as conn:
            first = conn.execute("SELECT email FROM users ORDER BY rowid ASC LIMIT 1").fetchone()
        if first:
            emails = {first["email"]}
    fields = json.loads(inquiry_row["fields_json"])
    subject = (f"[{hub_name()}] New {inquiry_row['type']} inquiry {inquiry_row['ref']} "
               f"- {company_name or 'hub request'} ({score_label(inquiry_row['score'])} {inquiry_row['score']})")
    body = (f"A new inquiry arrived{' for ' + company_name if company_name else ' on the hub'}.\n\n"
            f"{format_fields(fields)}\n\nScreen and introduce it: {core.BASE_URL}/bridge")
    for email in emails:
        core.send_email(email, subject, body)


def send_intro_email(conn, intro_id):
    row = conn.execute("""
        SELECT i.*, q.ref, q.type, q.name AS q_name, q.email AS q_email, q.organisation,
               q.fields_json, c.name AS company_name, c.slug, c.owner_user_id, c.data_json
        FROM ic_intros i
        JOIN ic_inquiries q ON q.id = i.inquiry_id
        JOIN ic_companies c ON c.id = i.company_id
        WHERE i.id=?""", (intro_id,)).fetchone()
    if not row:
        return None
    recipient = ""
    if row["owner_user_id"]:
        owner = conn.execute("SELECT email FROM users WHERE id=?", (row["owner_user_id"],)).fetchone()
        recipient = owner["email"] if owner else ""
    if not recipient:
        recipient = json.loads(row["data_json"]).get("contact", {}).get("email", "")
    fields = json.loads(row["fields_json"])
    hide = not row["share_contact"]
    gated = bool(row["via_bridge"]) and not row["terms_accepted_at"]
    who = row["organisation"] or row["q_name"] or "a contact"
    subject = f"[{hub_name()}] Introduction: {row['type']} - {who} ({row['ref']})"
    if hide:
        next_step = "Reply to this email and we will arrange the meeting.\n\n"
    elif gated:
        next_step = (f"Accept the introduction in your dashboard to unlock the contact details "
                     f"(terms: {intro_terms()})\n\n")
    else:
        next_step = f"Contact: {row['q_name'] or ''} <{row['q_email'] or ''}>\n\n"
    body = (f"Hi {row['company_name']} team,\n\n{hub_name()} has a screened {row['type']} introduction for you.\n\n"
            f"{format_fields(fields, hide_contact=hide or gated)}\n\n"
            + (f"Note from {hub_name()}: {row['note']}\n\n" if row["note"] else "")
            + next_step
            + f"Track this introduction: {core.BASE_URL}/bridge")
    return recipient, subject, body, row["q_email"], row["company_name"], row["slug"]


# --------------------------------------------------------------------- client onboarding (used by outreach close)

def create_company(conn, name, owner_user_id=None, lead_id=None, contact_email="",
                   city="", industry="manufacturer", data=None):
    slug = unique_slug(conn, name)
    cid = core.new_id()
    payload = data or default_company_data(name, contact_email, city, industry)
    conn.execute("""INSERT INTO ic_companies(id, slug, owner_user_id, lead_id, name, industry, country,
                    status, routing, data_json, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?, 'draft', 'via_bridge', ?,?,?)""",
                 (cid, slug, owner_user_id, lead_id, name, industry, city,
                  json.dumps(payload), now(), now()))
    return {"company_id": cid, "slug": slug, "portal_url": f"{core.BASE_URL}/c/{slug}/"}


def create_company_for_lead(conn, lead, user_id, client_email):
    return create_company(conn, lead["business_name"], owner_user_id=user_id, lead_id=lead["id"],
                          contact_email=client_email, city=lead["city"] or "")


# --------------------------------------------------------------------- HTTP

STATIC_IC = {
    "app.js": "application/javascript; charset=utf-8",
    "viewer.js": "application/javascript; charset=utf-8",
    "styles.css": "text/css; charset=utf-8",
    "data.js": "application/javascript; charset=utf-8",
    "index.html": "text/html; charset=utf-8",
}
PAGES = {
    "/hub": ("hub.html", "text/html; charset=utf-8"),
    "/bridge": ("bridge.html", "text/html; charset=utf-8"),
    "/static/bridge.js": ("bridge.js", "application/javascript; charset=utf-8"),
}


def send_file(handler, path, content_type):
    if not os.path.isfile(path):
        handler.send_error(404)
        return
    with open(path, "rb") as f:
        body = f.read()
    send_bytes(handler, body, content_type)


def send_bytes(handler, body, content_type, status=200):
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.end_headers()
    handler.wfile.write(body)


def preload_body(handler):
    """Read the request body up front so early 401/403 replies never leave unread bytes
    on the socket (Windows resets such connections and the client sees an error)."""
    if hasattr(handler, "_bridge_body"):
        return
    length = int(handler.headers.get("Content-Length") or 0)
    handler._bridge_body_too_large = length > MAX_BODY_BYTES
    handler._bridge_body = handler.rfile.read(length) if 0 < length <= MAX_BODY_BYTES else b""


def body_json(handler):
    preload_body(handler)
    if handler._bridge_body_too_large:
        return None, "request too large"
    try:
        return json.loads(handler._bridge_body.decode("utf-8")), None
    except ValueError:
        return None, None


def handle(handler, method, path, url):
    """Return True if the request was handled here."""
    # Respark's outreach tools are for the operator only (clients can log in now).
    if path in ("/outreach", "/outreach.html") or path.startswith("/api/outreach/"):
        uid = core.require_auth(handler)
        if uid and not is_operator(uid):
            if path.startswith("/api/"):
                core.json_response(handler, 403, {"error": "operator only"})
            else:
                core.redirect(handler, "/bridge")
            return True
        return False

    if method == "GET":
        if path in PAGES:
            name, ctype = PAGES[path]
            if path == "/bridge" and not core.require_auth(handler):
                core.redirect(handler, "/?next=/bridge")
                return True
            send_file(handler, os.path.join(web_dir(), name), ctype)
            return True
        if path.startswith("/ic/"):
            name = path[len("/ic/"):] or "index.html"
            if name in STATIC_IC:
                send_file(handler, os.path.join(web_dir(), "ic", name), STATIC_IC[name])
            else:
                handler.send_error(404)
            return True
        if path.startswith("/c/"):
            return portal_get(handler, path)
        if path == "/sitemap.xml":
            return sitemap(handler)
        if path == "/robots.txt":
            return robots(handler)
        m = re.match(r"^/r/([A-Za-z0-9_\-]{16,64})$", path)
        if m:
            return review_page(handler, m.group(1))
        if path == "/api/ic/directory":
            return api_directory(handler)
        if path == "/api/ic/me":
            return api_me(handler)
        if path == "/api/ic/companies":
            return api_companies(handler)
        m = re.match(r"^/api/ic/companies/([a-f0-9]{32})$", path)
        if m:
            return api_company_get(handler, m.group(1))
        if path == "/api/ic/inquiries":
            return api_inquiries(handler, url)
        m = re.match(r"^/api/ic/inquiries/([a-f0-9]{32})/matches$", path)
        if m:
            return api_matches(handler, m.group(1))
        if path == "/api/ic/stats":
            return api_stats(handler)
        return False

    if method == "POST":
        if path.startswith("/api/ic/") or path.startswith("/r/"):
            preload_body(handler)
        if path == "/api/ic/inquiries":
            return api_submit_inquiry(handler)
        if path == "/api/ic/track":
            return api_track(handler)
        if path == "/api/ic/companies":
            return api_create_company(handler)
        m = re.match(r"^/api/ic/companies/([a-f0-9]{32})/update$", path)
        if m:
            return api_update_company(handler, m.group(1))
        m = re.match(r"^/api/ic/companies/([a-f0-9]{32})/verify$", path)
        if m:
            return api_verify_company(handler, m.group(1))
        m = re.match(r"^/api/ic/inquiries/([a-f0-9]{32})/patch$", path)
        if m:
            return api_patch_inquiry(handler, m.group(1))
        m = re.match(r"^/api/ic/inquiries/([a-f0-9]{32})/introduce$", path)
        if m:
            return api_introduce(handler, m.group(1))
        m = re.match(r"^/api/ic/intros/([a-f0-9]{32})/patch$", path)
        if m:
            return api_patch_intro(handler, m.group(1))
        m = re.match(r"^/api/ic/intros/([a-f0-9]{32})/accept$", path)
        if m:
            return api_accept_intro(handler, m.group(1))
        m = re.match(r"^/r/([A-Za-z0-9_\-]{16,64})$", path)
        if m:
            return review_submit(handler, m.group(1))
        return False

    return False


# ----- public: portals, directory, inquiries

def portal_get(handler, path):
    m = re.match(r"^/c/([a-z0-9\-]{1,60})(/.*)?$", path)
    if not m:
        handler.send_error(404)
        return True
    slug, rest = m.group(1), m.group(2)
    if rest is None:
        core.redirect(handler, f"/c/{slug}/", status=301)
        return True
    with core._db_lock, core.db() as conn:
        row = conn.execute("SELECT * FROM ic_companies WHERE slug=?", (slug,)).fetchone()
    if not row or row["status"] == "archived":
        handler.send_error(404)
        return True
    if row["status"] != "published":
        uid = core.require_auth(handler)
        if not (uid and (uid == row["owner_user_id"] or is_operator(uid))):
            handler.send_error(404)
            return True
    name = rest.lstrip("/") or "index.html"
    if name == "data.js":
        data = json.loads(row["data_json"])
        config = {
            "hosted": True,
            "slug": slug,
            "status": row["status"],
            "api": "/api/ic/inquiries",
            "track": "/api/ic/track",
            "hubName": hub_name(),
            "hubUrl": "/hub",
            "dashboard": "/bridge",
            "routing": row["routing"],
            "verification": verification_public(row),
            "whatsapp": portal_whatsapp(row, data),
        }
        with core._db_lock, core.db() as conn:
            config["track"] = track_record(conn, row["id"])
            config["reviews"] = public_reviews(conn, row["id"])
        js = ("window.COMPANY_DATA = " + json.dumps(data, ensure_ascii=False) + ";\n"
              "window.IC_CONFIG = " + json.dumps(config) + ";\n")
        send_bytes(handler, js.encode("utf-8"), STATIC_IC["data.js"])
        return True
    if name == "index.html":
        send_bytes(handler, render_portal_index(row).encode("utf-8"), STATIC_IC["index.html"])
        return True
    if name in STATIC_IC:
        send_file(handler, os.path.join(web_dir(), "ic", name), STATIC_IC[name])
        return True
    handler.send_error(404)
    return True


# ----- SEO: crawlers and link previews get real content, not an empty SPA shell

def absolute(path):
    return core.BASE_URL.rstrip("/") + path


def json_ld(obj):
    # "</" inside a <script> block would end it early.
    return json.dumps(obj, ensure_ascii=False).replace("</", "<\\/")


def render_portal_index(row):
    data = json.loads(row["data_json"])
    company = data.get("company", {})
    products = data.get("products", [])
    url = absolute(f"/c/{row['slug']}/")
    title = company.get("name", row["name"])
    if company.get("tagline"):
        title += " | " + company["tagline"]
    description = (company.get("about") or company.get("tagline") or "")[:160]
    verification = verification_public(row)

    organization = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": company.get("name", row["name"]),
        "legalName": company.get("legalName", ""),
        "url": url,
        "description": company.get("about", ""),
        "address": company.get("hq", ""),
        "makesOffer": [
            {
                "@type": "Offer",
                "itemOffered": {
                    "@type": "Product",
                    "name": p.get("name", ""),
                    "category": p.get("category", ""),
                    "description": p.get("summary", ""),
                    "url": url + "#/product/" + str(p.get("id", "")),
                },
            }
            for p in products[:50]
        ],
    }
    if company.get("certifications"):
        organization["hasCredential"] = [
            {"@type": "EducationalOccupationalCredential", "name": c} for c in company["certifications"][:10]
        ]

    e = html.escape
    head = [
        f"<title>{e(title)}</title>",
        f'<meta name="description" content="{e(description)}">',
        f'<link rel="canonical" href="{e(url)}">',
        '<meta property="og:type" content="website">',
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(description)}">',
        f'<meta property="og:url" content="{e(url)}">',
        f'<meta property="og:site_name" content="{e(hub_name())}">',
        f'<script type="application/ld+json">{json_ld(organization)}</script>',
    ]
    if row["status"] != "published":
        head.append('<meta name="robots" content="noindex, nofollow">')

    fallback = [f"<h1>{e(company.get('name', row['name']))}</h1>"]
    if verification["verified"]:
        fallback.append(f"<p>Verified by {e(hub_name())}</p>")
    if company.get("about"):
        fallback.append(f"<p>{e(company['about'])}</p>")
    if products:
        fallback.append("<h2>Products</h2><ul>")
        for p in products[:50]:
            fallback.append(f"<li><b>{e(p.get('name', ''))}</b> ({e(p.get('category', ''))}): {e(p.get('summary', ''))}</li>")
        fallback.append("</ul>")
    noscript = '<noscript><div class="wrap" style="padding:32px 0">' + "".join(fallback) + "</div></noscript>"

    with open(os.path.join(web_dir(), "ic", "index.html"), "r", encoding="utf-8") as f:
        page = f.read()
    page = re.sub(r"<title>.*?</title>\s*", "", page, count=1, flags=re.S)
    page = re.sub(r'<meta name="description"[^>]*>\s*', "", page, count=1)
    page = page.replace("</head>", "  " + "\n  ".join(head) + "\n</head>", 1)
    page = page.replace('<main id="app" tabindex="-1"></main>', '<main id="app" tabindex="-1">' + noscript + "</main>", 1)
    return page


def sitemap(handler):
    with core._db_lock, core.db() as conn:
        rows = conn.execute("SELECT slug, updated_at FROM ic_companies WHERE status='published' ORDER BY slug").fetchall()
    urls = [f"<url><loc>{html.escape(absolute('/hub'))}</loc></url>"]
    for r in rows:
        lastmod = (r["updated_at"] or "")[:10]
        urls.append(f"<url><loc>{html.escape(absolute('/c/' + r['slug'] + '/'))}</loc><lastmod>{lastmod}</lastmod></url>")
    body = ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + "".join(urls) + "</urlset>\n")
    send_bytes(handler, body.encode("utf-8"), "application/xml; charset=utf-8")
    return True


def robots(handler):
    body = ("User-agent: *\n"
            "Disallow: /api/\n"
            "Disallow: /bridge\n"
            "Disallow: /outreach\n"
            "Disallow: /app\n"
            f"Sitemap: {absolute('/sitemap.xml')}\n")
    send_bytes(handler, body.encode("utf-8"), "text/plain; charset=utf-8")
    return True


def api_directory(handler):
    with core._db_lock, core.db() as conn:
        rows = conn.execute("SELECT * FROM ic_companies WHERE status='published' ORDER BY name").fetchall()
        companies = []
        for r in rows:
            item = company_summary(r)
            item["track"] = track_record(conn, r["id"])
            companies.append(item)
    companies.sort(key=lambda c: (not c["verification"]["verified"], c["name"].lower()))
    core.json_response(handler, 200, {
        "hub": hub_name(),
        "whatsapp": operator_whatsapp(),
        "companies": companies,
    })
    return True


def api_submit_inquiry(handler):
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": error or "invalid JSON"})
        return True
    if payload.get("hp"):
        # honeypot filled: pretend success, store nothing
        core.json_response(handler, 200, {"ok": True, "ref": "IC-" + secrets.token_hex(4).upper()})
        return True
    ip = handler.client_address[0] if handler.client_address else "?"
    if rate_limited(ip):
        core.json_response(handler, 429, {"error": "too many requests, try again later"})
        return True
    kind = payload.get("type")
    if kind not in INQUIRY_TYPES:
        core.json_response(handler, 400, {"error": "unknown inquiry type"})
        return True
    fields = clean_fields(payload.get("fields"))
    email = (fields.get("email") or "").strip().lower()
    if not valid_email(email):
        core.json_response(handler, 400, {"error": "a valid email is required"})
        return True

    slug = payload.get("company")
    company = None
    with core._db_lock, core.db() as conn:
        if slug:
            company = conn.execute(
                "SELECT * FROM ic_companies WHERE slug=? AND status != 'archived'", (slug,)).fetchone()
            if not company:
                core.json_response(handler, 404, {"error": "company not found"})
                return True
        qid = core.new_id()
        ref = "IC-" + datetime.now(timezone.utc).strftime("%y%m%d") + "-" + secrets.token_hex(3).upper()
        score = score_inquiry(kind, fields)
        organisation = fields.get("company") or fields.get("firm") or fields.get("organisation") or ""
        conn.execute("""INSERT INTO ic_inquiries(id, ref, company_id, type, name, email, organisation,
                        fields_json, score, status, created_at, updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?, 'new', ?,?)""",
                     (qid, ref, company["id"] if company else None, kind, fields.get("name", "")[:200],
                      email, organisation[:200], json.dumps(fields), score, now(), now()))
        intro_mail = None
        if company and company["routing"] == "direct":
            intro_id = core.new_id()
            conn.execute("""INSERT INTO ic_intros(id, inquiry_id, company_id, status, note, share_contact,
                            via_bridge, terms_accepted_at, created_at, updated_at)
                            VALUES (?,?,?, 'sent', 'Direct portal inquiry', 1, 0, ?, ?,?)""",
                         (intro_id, qid, company["id"], now(), now(), now()))
            conn.execute("UPDATE ic_inquiries SET status='introduced' WHERE id=?", (qid,))
            intro_mail = send_intro_email(conn, intro_id)
        if kind == "listing":
            # A manufacturer asked to join the network: drop it into Respark's outreach pipeline.
            conn.execute("""INSERT INTO leads(id, business_name, contact_name, email, phone, website,
                            industry, city, source, status, notes, created_at, last_action_at)
                            VALUES (?,?,?,?,?,?, 'manufacturer', ?, 'hub', 'interested', ?, ?, ?)""",
                         (core.new_id(), organisation or email, fields.get("name", ""), email,
                          fields.get("phone", ""), fields.get("website", ""), fields.get("country", ""),
                          fields.get("message", "")[:1000], now(), now()))
        row = conn.execute("SELECT * FROM ic_inquiries WHERE id=?", (qid,)).fetchone()

    try:
        notify_operators(row, company["name"] if company else "")
        if intro_mail and intro_mail[0]:
            core.send_email(intro_mail[0], intro_mail[1], intro_mail[2])
    except Exception as e:  # never lose the inquiry because email failed
        core.log.error("bridge notify failed for %s: %s", ref, e)
    core.json_response(handler, 200, {"ok": True, "ref": ref})
    return True


def api_track(handler):
    payload, _ = body_json(handler)
    if not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": "invalid"})
        return True
    slug = str(payload.get("company") or "")[:60]
    page = re.sub(r"[^a-z0-9:\-]", "", str(payload.get("page") or "home").lower())[:60] or "home"
    day = datetime.now(timezone.utc).date().isoformat()
    with core._db_lock, core.db() as conn:
        row = conn.execute("SELECT id FROM ic_companies WHERE slug=? AND status='published'", (slug,)).fetchone()
        if row:
            conn.execute("""INSERT INTO ic_views(company_id, day, page, n) VALUES (?,?,?,1)
                            ON CONFLICT(company_id, day, page) DO UPDATE SET n = n + 1""",
                         (row["id"], day, page))
    core.json_response(handler, 200, {"ok": True})
    return True


# ----- authenticated: dashboard APIs

def require_user(handler):
    uid = core.require_auth(handler)
    if not uid:
        core.json_response(handler, 401, {"error": "unauthorized"})
        return None, False
    return uid, is_operator(uid)


def api_me(handler):
    uid, operator = require_user(handler)
    if not uid:
        return True
    with core._db_lock, core.db() as conn:
        user = conn.execute("SELECT email, business_name FROM users WHERE id=?", (uid,)).fetchone()
        rows = conn.execute("SELECT * FROM ic_companies WHERE owner_user_id=?", (uid,)).fetchall()
    core.json_response(handler, 200, {
        "email": user["email"] if user else "",
        "is_operator": operator,
        "hub": hub_name(),
        "companies": [company_summary(r, include_private=True) for r in rows],
    })
    return True


def api_companies(handler):
    uid, operator = require_user(handler)
    if not uid:
        return True
    with core._db_lock, core.db() as conn:
        if operator:
            rows = conn.execute("SELECT * FROM ic_companies ORDER BY created_at DESC").fetchall()
        else:
            rows = conn.execute("SELECT * FROM ic_companies WHERE owner_user_id=? ORDER BY created_at DESC",
                                (uid,)).fetchall()
        since = (datetime.now(timezone.utc).date() - timedelta(days=30)).isoformat()
        out = []
        for r in rows:
            item = company_summary(r, include_private=True)
            item["views_30d"] = conn.execute(
                "SELECT COALESCE(SUM(n),0) AS n FROM ic_views WHERE company_id=? AND day>=?",
                (r["id"], since)).fetchone()["n"]
            item["intros"] = conn.execute(
                "SELECT COUNT(*) AS n FROM ic_intros WHERE company_id=?", (r["id"],)).fetchone()["n"]
            item["portal_inquiries"] = conn.execute(
                "SELECT COUNT(*) AS n FROM ic_inquiries WHERE company_id=?", (r["id"],)).fetchone()["n"]
            if r["owner_user_id"]:
                owner = conn.execute("SELECT email FROM users WHERE id=?", (r["owner_user_id"],)).fetchone()
                item["owner_email"] = owner["email"] if owner else ""
            out.append(item)
    core.json_response(handler, 200, {"companies": out, "is_operator": operator})
    return True


def load_company_for(conn, cid, uid, operator):
    row = conn.execute("SELECT * FROM ic_companies WHERE id=?", (cid,)).fetchone()
    if not row:
        return None
    if not operator and row["owner_user_id"] != uid:
        return None
    return row


def api_company_get(handler, cid):
    uid, operator = require_user(handler)
    if not uid:
        return True
    with core._db_lock, core.db() as conn:
        row = load_company_for(conn, cid, uid, operator)
    if not row:
        core.json_response(handler, 404, {"error": "not found"})
        return True
    item = company_summary(row, include_private=True)
    item["data"] = json.loads(row["data_json"])
    core.json_response(handler, 200, item)
    return True


def api_create_company(handler):
    uid, operator = require_user(handler)
    if not uid:
        return True
    if not operator:
        core.json_response(handler, 403, {"error": "operator only"})
        return True
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": error or "invalid JSON"})
        return True
    name = (payload.get("name") or "").strip()
    if not name:
        core.json_response(handler, 400, {"error": "name is required"})
        return True
    owner_email = (payload.get("owner_email") or "").strip().lower()
    if owner_email and not valid_email(owner_email):
        core.json_response(handler, 400, {"error": "invalid owner_email"})
        return True
    data = payload.get("data")
    if data is not None:
        problem = validate_company_data(data)
        if problem:
            core.json_response(handler, 400, {"error": problem})
            return True
    temp_password = None
    with core._db_lock, core.db() as conn:
        owner_id = None
        if owner_email:
            user = conn.execute("SELECT id FROM users WHERE email=?", (owner_email,)).fetchone()
            if user:
                owner_id = user["id"]
            else:
                temp_password = secrets.token_urlsafe(10)
                h, salt = core.hash_password(temp_password)
                owner_id = core.new_id()
                conn.execute("""INSERT INTO users(id, email, password_hash, password_salt, business_name,
                                industry, created_at) VALUES (?,?,?,?,?, 'manufacturer', ?)""",
                             (owner_id, owner_email, h, salt, name, now()))
        result = create_company(conn, name, owner_user_id=owner_id, contact_email=owner_email,
                                city=(payload.get("country") or "").strip(),
                                industry=(payload.get("industry") or "manufacturer").strip(), data=data)
    result.update({"ok": True, "owner_email": owner_email or None, "temp_password": temp_password})
    core.json_response(handler, 200, result)
    return True


def api_update_company(handler, cid):
    uid, operator = require_user(handler)
    if not uid:
        return True
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": error or "invalid JSON"})
        return True
    with core._db_lock, core.db() as conn:
        row = load_company_for(conn, cid, uid, operator)
        if not row:
            core.json_response(handler, 404, {"error": "not found"})
            return True
        updates = {}
        if "data" in payload:
            problem = validate_company_data(payload["data"])
            if problem:
                core.json_response(handler, 400, {"error": problem})
                return True
            updates["data_json"] = json.dumps(payload["data"])
            updates["name"] = payload["data"]["company"]["name"][:200]
        if "seeking" in payload:
            seeking = [s for s in as_list(payload["seeking"]) if s in SEEKING_OPTIONS]
            updates["seeking"] = json.dumps(seeking)
        for key in ("industry", "country"):
            if key in payload:
                updates[key] = str(payload[key] or "")[:120]
        # Publishing and routing are the bridge's call.
        if "status" in payload or "routing" in payload:
            if not operator:
                core.json_response(handler, 403, {"error": "only the operator can publish or change routing"})
                return True
            if "status" in payload:
                if payload["status"] not in COMPANY_STATUSES:
                    core.json_response(handler, 400, {"error": "invalid status"})
                    return True
                updates["status"] = payload["status"]
            if "routing" in payload:
                if payload["routing"] not in ROUTING_MODES:
                    core.json_response(handler, 400, {"error": "invalid routing"})
                    return True
                updates["routing"] = payload["routing"]
        if not updates:
            core.json_response(handler, 400, {"error": "nothing to update"})
            return True
        updates["updated_at"] = now()
        assignments = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE ic_companies SET {assignments} WHERE id=?", (*updates.values(), cid))
        row = conn.execute("SELECT * FROM ic_companies WHERE id=?", (cid,)).fetchone()
    core.json_response(handler, 200, {"ok": True, "company": company_summary(row, include_private=True)})
    return True


def api_verify_company(handler, cid):
    """Operator records what was checked. Owners can never set their own badge."""
    uid, operator = require_user(handler)
    if not uid:
        return True
    if not operator:
        core.json_response(handler, 403, {"error": "only the operator can verify companies"})
        return True
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": error or "invalid JSON"})
        return True
    with core._db_lock, core.db() as conn:
        row = conn.execute("SELECT * FROM ic_companies WHERE id=?", (cid,)).fetchone()
        if not row:
            core.json_response(handler, 404, {"error": "not found"})
            return True
        if payload.get("revoke"):
            record = {}
        else:
            raw_checks = payload.get("checks") if isinstance(payload.get("checks"), dict) else {}
            checks = {key: bool(raw_checks.get(key)) for key, _ in VERIFY_CHECKS}
            if not any(checks.values()):
                core.json_response(handler, 400, {"error": "tick at least one check, or revoke"})
                return True
            user = conn.execute("SELECT email FROM users WHERE id=?", (uid,)).fetchone()
            record = {
                "checks": checks,
                "registration_no": str(payload.get("registration_no") or "")[:80],
                "note": str(payload.get("note") or "")[:1000],
                "verified_at": now(),
                "verified_by": user["email"] if user else "",
            }
        conn.execute("UPDATE ic_companies SET verification_json=?, updated_at=? WHERE id=?",
                     (json.dumps(record), now(), cid))
        row = conn.execute("SELECT * FROM ic_companies WHERE id=?", (cid,)).fetchone()
    core.json_response(handler, 200, {"ok": True, "company": company_summary(row, include_private=True)})
    return True


def inquiry_dict(conn, row, operator, viewer_company_ids=None):
    item = {
        "id": row["id"],
        "ref": row["ref"],
        "type": row["type"],
        "name": row["name"],
        "email": row["email"],
        "organisation": row["organisation"],
        "fields": json.loads(row["fields_json"]),
        "score": row["score"],
        "label": score_label(row["score"]),
        "created_at": row["created_at"],
    }
    intros = conn.execute("""SELECT i.*, c.name AS company_name, c.slug FROM ic_intros i
                             JOIN ic_companies c ON c.id = i.company_id
                             WHERE i.inquiry_id=? ORDER BY i.created_at""", (row["id"],)).fetchall()
    if operator:
        company = conn.execute("SELECT name, slug FROM ic_companies WHERE id=?",
                               (row["company_id"],)).fetchone() if row["company_id"] else None
        item.update({
            "status": row["status"],
            "deal_value": row["deal_value"],
            "fee": row["fee"],
            "notes": row["notes"],
            "source": company["name"] if company else "Hub",
            "source_slug": company["slug"] if company else None,
            "intros": [{"id": i["id"], "company_id": i["company_id"], "company_name": i["company_name"],
                        "status": i["status"], "created_at": i["created_at"]} for i in intros],
        })
    else:
        mine = [i for i in intros if i["company_id"] in (viewer_company_ids or [])]
        intro = mine[0]
        item.update({
            "intro_id": intro["id"],
            "intro_status": intro["status"],
            "intro_note": intro["note"],
            "company_name": intro["company_name"],
            "introduced_at": intro["created_at"],
        })
        gated = bool(intro["via_bridge"]) and not intro["terms_accepted_at"]
        item["needs_acceptance"] = gated
        if gated:
            item["terms"] = intro_terms()
        if gated or not intro["share_contact"]:
            item["email"] = None
            item["fields"].pop("email", None)
            item["fields"].pop("phone", None)
    return item


def api_inquiries(handler, url):
    uid, operator = require_user(handler)
    if not uid:
        return True
    from urllib.parse import parse_qs
    q = parse_qs(url.query)
    status = (q.get("status") or [""])[0]
    kind = (q.get("type") or [""])[0]
    with core._db_lock, core.db() as conn:
        if operator:
            sql = "SELECT * FROM ic_inquiries WHERE 1=1"
            args = []
            if status:
                sql += " AND status=?"
                args.append(status)
            if kind:
                sql += " AND type=?"
                args.append(kind)
            rows = conn.execute(sql + " ORDER BY created_at DESC LIMIT 500", args).fetchall()
            items = [inquiry_dict(conn, r, True) for r in rows]
        else:
            company_ids = owned_company_ids(conn, uid)
            if not company_ids:
                items = []
            else:
                marks = ",".join("?" * len(company_ids))
                rows = conn.execute(f"""SELECT DISTINCT q.* FROM ic_inquiries q
                                        JOIN ic_intros i ON i.inquiry_id = q.id
                                        WHERE i.company_id IN ({marks})
                                        ORDER BY q.created_at DESC LIMIT 500""", company_ids).fetchall()
                items = [inquiry_dict(conn, r, False, company_ids) for r in rows]
    core.json_response(handler, 200, {"inquiries": items, "is_operator": operator})
    return True


def api_matches(handler, qid):
    uid, operator = require_user(handler)
    if not uid:
        return True
    if not operator:
        core.json_response(handler, 403, {"error": "operator only"})
        return True
    with core._db_lock, core.db() as conn:
        row = conn.execute("SELECT * FROM ic_inquiries WHERE id=?", (qid,)).fetchone()
        if not row:
            core.json_response(handler, 404, {"error": "not found"})
            return True
        matches = suggest_matches(conn, row)
    core.json_response(handler, 200, {"matches": matches})
    return True


def api_patch_inquiry(handler, qid):
    uid, operator = require_user(handler)
    if not uid:
        return True
    if not operator:
        core.json_response(handler, 403, {"error": "operator only"})
        return True
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": error or "invalid JSON"})
        return True
    updates = {}
    if "status" in payload:
        if payload["status"] not in INQUIRY_STATUSES:
            core.json_response(handler, 400, {"error": "invalid status"})
            return True
        updates["status"] = payload["status"]
    for key in ("deal_value", "fee"):
        if key in payload:
            try:
                updates[key] = None if payload[key] in (None, "") else float(payload[key])
            except (TypeError, ValueError):
                core.json_response(handler, 400, {"error": f"{key} must be a number"})
                return True
    if "notes" in payload:
        updates["notes"] = str(payload["notes"] or "")[:4000]
    if not updates:
        core.json_response(handler, 400, {"error": "nothing to update"})
        return True
    updates["updated_at"] = now()
    with core._db_lock, core.db() as conn:
        if not conn.execute("SELECT 1 FROM ic_inquiries WHERE id=?", (qid,)).fetchone():
            core.json_response(handler, 404, {"error": "not found"})
            return True
        assignments = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE ic_inquiries SET {assignments} WHERE id=?", (*updates.values(), qid))
        review_mails = []
        if updates.get("status") == "won":
            active = conn.execute("""SELECT id FROM ic_intros WHERE inquiry_id=?
                                     AND status IN ('accepted', 'in_talks', 'won')""", (qid,)).fetchall()
            if len(active) == 1:
                conn.execute("UPDATE ic_intros SET status='won', updated_at=? WHERE id=?", (now(), active[0]["id"]))
                review_mails.append(request_review(conn, active[0]["id"]))
    for mail in review_mails:
        if mail:
            core.send_email(*mail)
    core.json_response(handler, 200, {"ok": True})
    return True


def api_introduce(handler, qid):
    uid, operator = require_user(handler)
    if not uid:
        return True
    if not operator:
        core.json_response(handler, 403, {"error": "operator only"})
        return True
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict):
        core.json_response(handler, 400, {"error": error or "invalid JSON"})
        return True
    company_id = payload.get("company_id") or ""
    note = str(payload.get("note") or "")[:2000]
    share_contact = 0 if payload.get("share_contact") is False else 1
    with core._db_lock, core.db() as conn:
        inquiry = conn.execute("SELECT * FROM ic_inquiries WHERE id=?", (qid,)).fetchone()
        company = conn.execute("SELECT * FROM ic_companies WHERE id=? AND status != 'archived'",
                               (company_id,)).fetchone()
        if not inquiry or not company:
            core.json_response(handler, 404, {"error": "inquiry or company not found"})
            return True
        if conn.execute("SELECT 1 FROM ic_intros WHERE inquiry_id=? AND company_id=?",
                        (qid, company_id)).fetchone():
            core.json_response(handler, 409, {"error": "already introduced to this company"})
            return True
        intro_id = core.new_id()
        conn.execute("""INSERT INTO ic_intros(id, inquiry_id, company_id, status, note, share_contact,
                        created_at, updated_at) VALUES (?,?,?, 'sent', ?,?,?,?)""",
                     (intro_id, qid, company_id, note, share_contact, now(), now()))
        if inquiry["status"] in ("new", "screening"):
            conn.execute("UPDATE ic_inquiries SET status='introduced', updated_at=? WHERE id=?", (now(), qid))
        mail = send_intro_email(conn, intro_id)

    emailed = False
    if mail and mail[0]:
        emailed = core.send_email(mail[0], mail[1], mail[2])
        if payload.get("notify_requester") and mail[3]:
            core.send_email(
                mail[3],
                f"[{hub_name()}] We have introduced you to {mail[4]}",
                f"Hello,\n\nThanks for your request. {hub_name()} has introduced you to {mail[4]}.\n"
                f"Their showcase: {core.BASE_URL}/c/{mail[5]}/\n\nThey will be in touch shortly.\n\n- {hub_name()}",
            )
    core.json_response(handler, 200, {"ok": True, "intro_id": intro_id, "emailed": bool(emailed)})
    return True


def api_patch_intro(handler, intro_id):
    uid, operator = require_user(handler)
    if not uid:
        return True
    payload, error = body_json(handler)
    if error or not isinstance(payload, dict) or payload.get("status") not in INTRO_STATUSES:
        core.json_response(handler, 400, {"error": "status must be one of " + ", ".join(INTRO_STATUSES)})
        return True
    with core._db_lock, core.db() as conn:
        intro = conn.execute("""SELECT i.*, c.owner_user_id FROM ic_intros i
                                JOIN ic_companies c ON c.id = i.company_id WHERE i.id=?""",
                             (intro_id,)).fetchone()
        if not intro or (not operator and intro["owner_user_id"] != uid):
            core.json_response(handler, 404, {"error": "not found"})
            return True
        if not operator and intro["via_bridge"] and not intro["terms_accepted_at"]:
            core.json_response(handler, 409, {"error": "accept the introduction terms first"})
            return True
        conn.execute("UPDATE ic_intros SET status=?, updated_at=? WHERE id=?",
                     (payload["status"], now(), intro_id))
        if payload["status"] != "sent":
            conn.execute("UPDATE ic_intros SET responded_at=? WHERE id=? AND responded_at IS NULL", (now(), intro_id))
        review_mail = request_review(conn, intro_id) if payload["status"] == "won" else None
        # keep the bridge-level status in step with the furthest-along introduction
        if payload["status"] in ("in_talks", "won"):
            conn.execute("""UPDATE ic_inquiries SET status=?, updated_at=?
                            WHERE id=? AND status NOT IN ('won')""",
                         (payload["status"], now(), intro["inquiry_id"]))
    if review_mail:
        core.send_email(*review_mail)
    core.json_response(handler, 200, {"ok": True})
    return True


def api_accept_intro(handler, intro_id):
    """Company accepts the bridge's terms; only then is the requester's contact released."""
    uid, operator = require_user(handler)
    if not uid:
        return True
    with core._db_lock, core.db() as conn:
        intro = conn.execute("""SELECT i.*, c.owner_user_id FROM ic_intros i
                                JOIN ic_companies c ON c.id = i.company_id WHERE i.id=?""",
                             (intro_id,)).fetchone()
        if not intro or intro["owner_user_id"] != uid:
            core.json_response(handler, 404, {"error": "not found"})
            return True
        if not intro["terms_accepted_at"]:
            conn.execute("""UPDATE ic_intros SET terms_accepted_at=?, terms_text=?, responded_at=COALESCE(responded_at, ?),
                            status=CASE WHEN status='sent' THEN 'accepted' ELSE status END, updated_at=?
                            WHERE id=?""", (now(), intro_terms(), now(), now(), intro_id))
    core.json_response(handler, 200, {"ok": True})
    return True


# ----- verified reviews: only requesters of won introductions can leave one

def review_row(conn, token):
    return conn.execute("""SELECT r.*, c.name AS company_name, c.slug FROM ic_reviews r
                           JOIN ic_companies c ON c.id = r.company_id WHERE r.token=?""", (token,)).fetchone()


def review_html(title, inner):
    e = html.escape
    page = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<meta name="robots" content="noindex"><title>{e(title)}</title><link rel="stylesheet" href="/ic/styles.css"></head>'
            f'<body><main class="section"><div class="wrap" style="max-width:560px"><div class="card" style="padding:28px">'
            f'<div class="kicker">{e(hub_name())}</div>{inner}</div></div></main></body></html>')
    return page.encode("utf-8")


def review_page(handler, token):
    e = html.escape
    with core._db_lock, core.db() as conn:
        row = review_row(conn, token)
    if not row:
        handler.send_error(404)
        return True
    if row["submitted_at"]:
        send_bytes(handler, review_html("Thank you", "<h2>Thank you</h2><p class=\"muted\">Your review has been recorded.</p>"),
                   "text/html; charset=utf-8")
        return True
    stars = "".join(
        f'<label style="margin-right:12px"><input type="radio" name="rating" value="{n}" required> {n}</label>'
        for n in range(5, 0, -1))
    inner = (f"<h2>How was {e(row['company_name'])}?</h2>"
             f'<p class="muted">Your rating is published on their profile as a verified review.</p>'
             f'<form method="post" class="form" style="grid-template-columns:1fr">'
             f"<div><b>Rating (5 = excellent)</b><br>{stars}</div>"
             f'<label><span>What went well, what could improve?</span><textarea name="comment" maxlength="1000"></textarea></label>'
             f'<label><span>Name to show (leave empty to stay anonymous)</span><input name="reviewer_name" maxlength="80"></label>'
             f'<div><button class="btn btn-primary" type="submit">Submit review</button></div></form>')
    send_bytes(handler, review_html("Rate " + row["company_name"], inner), "text/html; charset=utf-8")
    return True


def review_submit(handler, token):
    preload_body(handler)
    if handler._bridge_body_too_large or len(handler._bridge_body) > 20_000:
        handler.send_error(413)
        return True
    form = urllib.parse.parse_qs(handler._bridge_body.decode("utf-8", "replace"))
    try:
        rating = int((form.get("rating") or ["0"])[0])
    except ValueError:
        rating = 0
    if not 1 <= rating <= 5:
        send_bytes(handler, review_html("Rating needed", "<h2>Please choose a rating from 1 to 5.</h2>"),
                   "text/html; charset=utf-8", status=400)
        return True
    comment = (form.get("comment") or [""])[0].strip()[:1000]
    reviewer = (form.get("reviewer_name") or [""])[0].strip()[:80]
    with core._db_lock, core.db() as conn:
        row = review_row(conn, token)
        if not row:
            handler.send_error(404)
            return True
        if not row["submitted_at"]:
            conn.execute("UPDATE ic_reviews SET rating=?, comment=?, reviewer_name=?, submitted_at=? WHERE id=?",
                         (rating, comment, reviewer, now(), row["id"]))
    send_bytes(handler, review_html("Thank you", "<h2>Thank you</h2><p class=\"muted\">Your review has been recorded.</p>"),
               "text/html; charset=utf-8")
    return True


def api_stats(handler):
    uid, operator = require_user(handler)
    if not uid:
        return True
    since = (datetime.now(timezone.utc).date() - timedelta(days=30)).isoformat()
    with core._db_lock, core.db() as conn:
        if operator:
            by_type = {r["type"]: r["n"] for r in conn.execute(
                "SELECT type, COUNT(*) AS n FROM ic_inquiries GROUP BY type").fetchall()}
            by_status = {r["status"]: r["n"] for r in conn.execute(
                "SELECT status, COUNT(*) AS n FROM ic_inquiries GROUP BY status").fetchall()}
            companies = {r["status"]: r["n"] for r in conn.execute(
                "SELECT status, COUNT(*) AS n FROM ic_companies GROUP BY status").fetchall()}
            money = conn.execute("""SELECT COALESCE(SUM(deal_value),0) AS deal_value, COALESCE(SUM(fee),0) AS fees,
                                    COUNT(*) AS won FROM ic_inquiries WHERE status='won'""").fetchone()
            awaiting = conn.execute("""SELECT COUNT(*) AS n FROM ic_inquiries q
                                       WHERE q.status IN ('new','screening')""").fetchone()["n"]
            intros = conn.execute("SELECT COUNT(*) AS n FROM ic_intros").fetchone()["n"]
            hot = conn.execute("SELECT COUNT(*) AS n FROM ic_inquiries WHERE score>=70 AND status IN ('new','screening')").fetchone()["n"]
            top = conn.execute("""SELECT c.name, c.slug, COALESCE(SUM(v.n),0) AS views FROM ic_companies c
                                  LEFT JOIN ic_views v ON v.company_id=c.id AND v.day>=?
                                  GROUP BY c.id ORDER BY views DESC LIMIT 5""", (since,)).fetchall()
            payload = {
                "is_operator": True,
                "inquiries_by_type": by_type,
                "inquiries_by_status": by_status,
                "companies_by_status": companies,
                "awaiting_screening": awaiting,
                "hot_awaiting": hot,
                "intros": intros,
                "won": money["won"],
                "deal_value_won": money["deal_value"],
                "fees_won": money["fees"],
                "top_companies_30d": [dict(r) for r in top],
            }
        else:
            ids = owned_company_ids(conn, uid)
            marks = ",".join("?" * len(ids)) or "''"
            intro_rows = conn.execute(f"SELECT status, COUNT(*) AS n FROM ic_intros WHERE company_id IN ({marks}) GROUP BY status", ids).fetchall()
            views = conn.execute(f"SELECT page, SUM(n) AS n FROM ic_views WHERE company_id IN ({marks}) AND day>=? GROUP BY page ORDER BY n DESC", (*ids, since)).fetchall()
            payload = {
                "is_operator": False,
                "intros_by_status": {r["status"]: r["n"] for r in intro_rows},
                "views_30d": sum(r["n"] for r in views),
                "views_by_page_30d": [dict(r) for r in views[:10]],
            }
    core.json_response(handler, 200, payload)
    return True
