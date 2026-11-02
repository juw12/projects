"""
Outreach reply & bounce detection (IMAP, stdlib only)
=====================================================
Every few minutes the scheduler asks this module to look in the operator's inbox
for answers from leads that are still in an active outreach sequence. When a
lead replies, the lead becomes "replied", its remaining follow-ups are cancelled
and the operator gets a short notification e-mail. Bounces (mailer-daemon) mark
the lead "bounced" and stop the sequence too.

Off unless an IMAP mailbox is configured. Defaults reuse the SMTP login, and
smtp.<domain> becomes imap.<domain> (works for Gmail with an app password).

Environment variables (optional):
    RESPARK_IMAP_HOST   e.g. imap.gmail.com (default: derived from RESPARK_SMTP_HOST)
    RESPARK_IMAP_USER   default: RESPARK_SMTP_USER
    RESPARK_IMAP_PASS   default: RESPARK_SMTP_PASS
    RESPARK_IMAP_EVERY  seconds between checks (default 600)
"""

import email
import imaplib
import logging
import os
from datetime import datetime

log = logging.getLogger("respark.inbox")

ACTIVE_STATUSES = ("new", "sent", "opened")
FREE_MAIL = {"gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com",
             "icloud.com", "proton.me", "protonmail.com", "qq.com", "163.com"}


def settings(core):
    host = os.environ.get("RESPARK_IMAP_HOST", "")
    smtp_host = getattr(core, "SMTP_HOST", "") or ""
    if not host and smtp_host.startswith("smtp."):
        host = "imap." + smtp_host[len("smtp."):]
    return {
        "host": host,
        "user": os.environ.get("RESPARK_IMAP_USER") or getattr(core, "SMTP_USER", ""),
        "password": os.environ.get("RESPARK_IMAP_PASS") or getattr(core, "SMTP_PASS", ""),
        "every": int(os.environ.get("RESPARK_IMAP_EVERY", "600") or 600),
    }


def configured(core):
    s = settings(core)
    return bool(s["host"] and s["user"] and s["password"])


def _sender_query(address):
    domain = address.rsplit("@", 1)[-1].lower()
    return address if domain in FREE_MAIL else domain


def _waiting_leads(core):
    placeholders = ",".join("?" for _ in ACTIVE_STATUSES)
    with core._db_lock, core.db() as conn:
        rows = conn.execute(f"""
            SELECT l.id, l.email, l.business_name, MIN(oe.sent_at) AS first_sent
            FROM leads l JOIN outreach_emails oe ON oe.lead_id = l.id
            WHERE oe.sent_at IS NOT NULL AND oe.status = 'sent'
              AND l.status IN ({placeholders}) AND COALESCE(l.email, '') <> ''
            GROUP BY l.id
        """, ACTIVE_STATUSES).fetchall()
    return [dict(r) for r in rows]


def check(core, imap_factory=imaplib.IMAP4_SSL):
    """Scan the inbox once. Returns {"replied": [...names], "bounced": [...names]}."""
    result = {"replied": [], "bounced": []}
    if not configured(core):
        return result
    waiting = _waiting_leads(core)
    if not waiting:
        return result

    s = settings(core)
    own_domain = s["user"].rsplit("@", 1)[-1].lower()
    replied_ids, bounced_ids = [], []
    imap = imap_factory(s["host"])
    try:
        imap.login(s["user"], s["password"])
        imap.select("INBOX", readonly=True)
        for lead in waiting:
            sender = _sender_query(lead["email"])
            if sender == own_domain:
                continue
            since = datetime.fromisoformat(lead["first_sent"][:19]).strftime("%d-%b-%Y")
            status, data = imap.search(None, f'(FROM "{sender}" SINCE {since})')
            if status == "OK" and data and data[0].split():
                replied_ids.append(lead["id"])
                result["replied"].append(lead["business_name"] or lead["email"])

        earliest = min(datetime.fromisoformat(l["first_sent"][:19]) for l in waiting)
        status, data = imap.search(None, f'(FROM "mailer-daemon" SINCE {earliest:%d-%b-%Y})')
        if status == "OK" and data and data[0]:
            bodies = []
            for number in data[0].split()[:200]:
                _, message_data = imap.fetch(number, "(RFC822)")
                if message_data and isinstance(message_data[0], tuple):
                    bodies.append(email.message_from_bytes(message_data[0][1]).as_string().lower())
            for lead in waiting:
                if lead["id"] in replied_ids:
                    continue
                if any(lead["email"].lower() in body for body in bodies):
                    bounced_ids.append(lead["id"])
                    result["bounced"].append(lead["business_name"] or lead["email"])
    finally:
        try:
            imap.logout()
        except Exception:
            pass

    now = core.utcnow()
    with core._db_lock, core.db() as conn:
        for lead_id in replied_ids:
            conn.execute("UPDATE leads SET status='replied', last_action_at=? WHERE id=?", (now, lead_id))
            conn.execute("""UPDATE outreach_emails SET replied_at=? WHERE id = (
                              SELECT id FROM outreach_emails WHERE lead_id=? AND status='sent'
                              ORDER BY sent_at DESC LIMIT 1)""", (now, lead_id))
            core.cancel_scheduled_outreach(conn, lead_id)
        for lead_id in bounced_ids:
            conn.execute("UPDATE leads SET status='bounced', last_action_at=? WHERE id=?", (now, lead_id))
            core.cancel_scheduled_outreach(conn, lead_id)

    if result["replied"]:
        operator = core.get_outreach_settings().get("operator_email") or s["user"]
        core.send_email(operator, "New outreach reply: " + ", ".join(result["replied"]),
                        "These leads replied, so their follow-ups were stopped:\n\n- " +
                        "\n- ".join(result["replied"]) + "\n\nOpen your inbox to answer them.")
    if result["replied"] or result["bounced"]:
        log.info("inbox check: %s replied, %s bounced", len(result["replied"]), len(result["bounced"]))
    return result
