"""Signed session tokens + per-action authorization.

Tokens are stateless: base64(persona|issued_at) + "." + HMAC-SHA256. In this demo any persona may
sign in (it stands in for Google / Microsoft SSO); in production the persona comes from the verified
SSO assertion and café/admin roles from the company directory (SCIM).
"""

import base64
import hashlib
import hmac
import time

from .engine import DemoError

TOKEN_TTL_SECONDS = 12 * 3600

# Actions an employee performs as themselves: the named argument must be their own id.
EMPLOYEE_ACTOR_FIELD = {
    "payment.create_topup": "emp",
    "profile.update": "emp",
    "office.today": "emp",
    "cafe.at": "emp",
    "run.create": "host",
    "run.join": "who",
    "run.remove_line": "by",
    "run.lock_now": "by",
    "run.depart": "by",
    "solo.order": "emp",
    "solo.reorder": "emp",
    "nl.parse": "emp",
    "pickup.scan": "by",
    "pickup.complete": "by",
    "lobby.handoff": "by",
    "line.flag": "by",
    "gift.send": "from",
    "karma.redeem": "emp",
    "meeting.order": "by",
    "event.rsvp": "emp",
    "catering.request": "by",
    "social.post": "emp",
    "social.delete": "emp",
    "social.react": "emp",
    "social.comment": "emp",
    "social.report": "emp",
    "social.hide": "emp",
    "social.follow": "emp",
    "social.profile": "emp",
    "social.chat_request": "emp",
    "social.chat_respond": "emp",
    "social.chat_cancel": "emp",
    "social.meetup_rsvp": "emp",
    "social.meetup_create": "emp",
    "rewards.nominate": "emp",
    "rewards.birthday": "emp",
    "loyalty.redeem": "emp",
    "loyalty.claim": "emp",
    "loyalty.refer": "emp",
}

CAFE_RUN_ACTIONS = {"cafe.ack", "cafe.fire", "cafe.ready", "cafe.release"}
CAFE_OWN_ACTIONS = {"cafe.stock", "cafe.settings", "cafe.badge", "social.cafe_post", "social.cafe_meetup", "rewards.redeem",
                    "loyalty.promo_create", "loyalty.promo_end"}
ADMIN_ACTIONS = {"policy.update", "office.update", "scim.add", "scim.deactivate", "roulette.run", "catering.approve",
                 "social.company_settings", "social.block", "social.moderate",
                 "rewards.give", "rewards.decide", "rewards.rules", "rewards.partner"}
DEMO_ACTIONS = {"clock.advance", "clock.config"}


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def issue_token(secret: bytes, persona: str, now=None) -> str:
    issued = int(now or time.time())
    body = _b64(f"{persona}|{issued}".encode())
    signature = _b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def read_token(secret: bytes, token: str, now=None):
    """Return the persona for a valid, unexpired token, else None."""
    if not token or "." not in token:
        return None
    body, signature = token.rsplit(".", 1)
    expected = _b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        persona, issued = _unb64(body).decode().rsplit("|", 1)
        issued = int(issued)
    except (ValueError, UnicodeDecodeError):
        return None
    if (now or time.time()) - issued > TOKEN_TTL_SECONDS:
        return None
    return persona


def valid_persona(state, persona):
    kind, _, ident = (persona or "").partition(":")
    if kind == "emp":
        return ident in state["employees"] and state["employees"][ident]["active"]
    if kind == "cafe":
        return ident in state["cafes"]
    return kind in ("admin", "guest")


def is_admin(state, persona):
    kind, _, ident = (persona or "").partition(":")
    if kind == "admin":
        return True
    return kind == "emp" and state["employees"].get(ident, {}).get("role") == "admin"


def _deny(en, id_text):
    raise DemoError("FORBIDDEN", en, id_text)


def authorize(state, persona, action, args):
    """Raise DemoError('FORBIDDEN') unless `persona` may perform `action` with `args`."""
    if not persona:
        raise DemoError("UNAUTHENTICATED", "Please sign in first.", "Silakan masuk dulu.")
    kind, _, ident = persona.partition(":")
    if action in DEMO_ACTIONS:
        return
    if action in ADMIN_ACTIONS:
        if not is_admin(state, persona):
            _deny("Only company admins can do this.", "Hanya admin perusahaan yang bisa melakukan ini.")
        return
    if action == "catering.request" and is_admin(state, persona):
        return
    if action in CAFE_RUN_ACTIONS:
        run = state["runs"].get(args.get("run"))
        if kind != "cafe" or not run or run["cafe"] != ident:
            _deny("Only the café making this order can do this.", "Hanya kafe pembuat pesanan ini yang bisa melakukan ini.")
        return
    if action in CAFE_OWN_ACTIONS:
        if kind != "cafe" or args.get("cafe") != ident:
            _deny("Only that café's staff can do this.", "Hanya staf kafe tersebut yang bisa melakukan ini.")
        return
    if action == "cafe.quote":
        request = state["catering"].get(args.get("request"))
        if kind != "cafe" or not request or request["cafe"] != ident:
            _deny("Only the requested café can quote.", "Hanya kafe yang diminta yang bisa memberi penawaran.")
        return
    if action == "run.join" and args.get("who") is None:
        if kind not in ("guest", "emp"):
            _deny("Sign in or use a guest link to join.", "Masuk atau gunakan tautan tamu untuk ikut.")
        return
    if action == "run.set_runner":
        run = state["runs"].get(args.get("run"))
        if kind != "emp" or not run or run["host"] != ident:
            _deny("Only the host can choose the runner.", "Hanya host yang bisa memilih runner.")
        return
    if action == "payment.simulate_paid":
        payment = state.get("payments", {}).get(args.get("payment"))
        if kind != "emp" or not payment or payment["emp"] != ident:
            _deny("That payment isn't yours.", "Pembayaran itu bukan milik Anda.")
        return
    field = EMPLOYEE_ACTOR_FIELD.get(action)
    if field is None:
        _deny("Action not allowed.", "Aksi tidak diizinkan.")
    if kind != "emp" or args.get(field) != ident:
        _deny("You can only do this for your own account.", "Anda hanya bisa melakukan ini untuk akun sendiri.")
