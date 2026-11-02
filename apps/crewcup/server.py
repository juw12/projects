"""CrewCup app server — Python standard library only.

Run:  python server.py                 (then open http://localhost:8787)
      python server.py --reset         fresh demo data
      python server.py --lan           also reachable from phones on the same Wi-Fi
"""

import argparse
import csv
import io
import json
import mimetypes
import re
import socket
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from crewcup import auth as A
from crewcup import config as C
from crewcup import engine as E
from crewcup import payments as P
from crewcup import qr as Q
from crewcup import seed
from crewcup import loyalty as L
from crewcup import rewards as R
from crewcup import social as SOC
from crewcup.social_seed import build_social
from crewcup.store import Store

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
DATA_DIR = ROOT / "data"
MAX_BODY = 256 * 1024
APP_VERSION = "0.7.0"
SESSION_HEADER = "X-CrewCup-Session"
PAYMENT_TTL_SECONDS = 15 * 60

LOCK = threading.Lock()
CHANGED = threading.Condition(LOCK)
STATE = {}
STORE = None
SECRET = b""
GATEWAY = None
SERVER = None
STOP = threading.Event()


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def open_store():
    global STORE, SECRET, GATEWAY
    if STORE is not None:
        STORE.close()
    STORE = Store(DATA_DIR / "crewcup.db")
    SECRET = STORE.secret()
    GATEWAY = P.SimulatedGateway(P.derive_token(SECRET, "gateway-callback"))


def load_state(reset=False):
    global STATE
    if STORE is None:
        open_store()
    saved = None if reset else STORE.get("state")
    legacy = DATA_DIR / "state.json"
    if saved is None and not reset and legacy.exists():
        saved = json.loads(legacy.read_text(encoding="utf-8"))  # migrate v0.2 JSON file once
        legacy.replace(legacy.with_suffix(".json.migrated"))
    if saved is not None:
        STATE = saved
        saved_sim = STATE["clock"].get("saved_sim", STATE["clock"]["anchor_sim"])
        STATE["clock"]["anchor_sim"] = saved_sim
        STATE["clock"]["anchor_real"] = time.time()
        STATE["countries"] = C.COUNTRIES
    else:
        STATE = seed.build_state(real_now=time.time())
        if reset:
            STORE.clear_audit()
    STATE.setdefault("payments", {})
    if "social" not in STATE:  # migrate pre-0.4 data: add the cross-company network
        STATE["social"] = build_social(STATE, int(E.sim_now(STATE, time.time())))
    R.ensure(STATE)  # migrate pre-0.5 data: company rewards
    L.ensure(STATE)  # migrate pre-0.6 data: loyalty
    save_state()


def save_state():
    STATE["clock"]["saved_sim"] = E.sim_now(STATE, time.time())
    STORE.put("state", STATE)


def current_now():
    return int(E.sim_now(STATE, time.time()))


def ticker():
    """Advance time-based state (cutoffs, firing, ready…) once a second and wake SSE clients."""
    while not STOP.wait(1.0):
        with LOCK:
            try:
                if E.tick(STATE, current_now()):
                    save_state()
                    CHANGED.notify_all()
            except Exception:  # keep the clock alive no matter what
                traceback.print_exc()


def start_ticker():
    thread = threading.Thread(target=ticker, name="crewcup-ticker", daemon=True)
    thread.start()
    return thread


# ---------------------------------------------------------------------------
# Read-only helpers
# ---------------------------------------------------------------------------

def preview_line(state, now, emp_id, cafe_id, spec, slot, coupon=None):
    emp = state["employees"][emp_id]
    cafe = state["cafes"][cafe_id]
    result = {"ok": True}
    try:
        normalized = E.normalize_spec(cafe, spec, emp["profile"])
        E.validate_spec(cafe, normalized, emp["profile"])
    except E.DemoError as error:
        return {"ok": False, "error": error.to_dict()}
    slot = int(slot) if slot else E.slot_ceil(now + 10 * 60, cafe["slot_min"])
    price = E.price_line(cafe, normalized, state["company"]["id"], slot)
    if coupon:
        try:
            L.apply_coupon(state, now, emp_id, coupon, cafe, normalized, price, slot)
        except E.DemoError as error:
            result["coupon_error"] = error.to_dict()
    allowance = E.allowance_status(state, emp, now, cafe)
    covered = min(allowance["remaining"], price["gross"])
    gift = min(E.gift_available(emp), price["gross"] - covered)
    result.update({
        "spec": normalized,
        "price": price,
        "allergens": E.line_allergens(cafe, normalized),
        "summary": E.describe_spec(cafe, normalized),
        "summary_id": E.describe_spec(cafe, normalized, "id"),
        "split": {"allowance": covered, "gift": gift, "wallet": price["gross"] - covered - gift},
        "wallet_ok": E.wallet_available(emp) >= price["gross"] - covered - gift,
    })
    return result


def expenses_csv(state, office_id):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "date", "time", "office", "employee", "cost_center", "cafe", "cafe_tax_id", "item",
        "net", "tax_name", "tax", "gross", "currency", "company_paid", "personal_paid",
        "category", "meeting", "attendees",
    ])
    office = state["offices"][office_id]
    for receipt in state["receipts"]:
        if receipt["office"] != office_id:
            continue
        company = sum(part["amount"] for part in receipt["parts"] if part["src"] in ("allowance", "budget"))
        personal = receipt["gross"] - company
        category = "meeting" if any(part["src"] == "budget" for part in receipt["parts"]) else (
            "staff_allowance" if company else "personal")
        local_dt = E.local(receipt["ts"], office)
        event = state["events"].get(receipt["event"]) if receipt["event"] else None
        writer.writerow([
            local_dt.date().isoformat(), local_dt.strftime("%H:%M"), office["name"], receipt["beneficiary_name"],
            receipt["cost_center"] or "", state["cafes"][receipt["cafe"]]["name"], receipt["cafe_tax_id"],
            receipt["item"], receipt["net"], receipt["tax_name"], receipt["tax"], receipt["gross"], receipt["currency"],
            company, personal, category, event["title"] if event else "", "; ".join(receipt["attendees"]),
        ])
    return buffer.getvalue()


def quick_reorder(state, now, args):
    """One-tap reorder of the usual or the last drink."""
    emp = state["employees"][args["emp"]]
    if args.get("which") == "last" and emp.get("last_spec") and emp.get("last_cafe"):
        cafe_id = emp["last_cafe"]
        spec = dict(emp["last_spec"])
    else:
        usual = emp["profile"].get("usual")
        if not usual:
            raise E.DemoError("NO_USUAL", "Save a usual first (Order tab → Save as my usual).",
                              "Simpan minuman biasa dulu (tab Pesan → Simpan sebagai minuman biasa).")
        cafe_id = usual["cafe"]
        spec = dict(usual["spec"])
    run = E.solo_order(state, now, emp["id"], cafe_id, spec, mode=args.get("mode", "pickup"),
                       confirm_duplicate=bool(args.get("confirm_duplicate")))
    return {"run": run["id"], "code": run["lines"][0]["code"], "slot": run["slot"]}


# ---------------------------------------------------------------------------
# Payments: create a pending charge, settle only via the (signed) webhook
# ---------------------------------------------------------------------------

def create_topup(state, now, args):
    emp = state["employees"][args["emp"]]
    office = state["offices"][emp["office"]]
    country = C.COUNTRIES[office["country"]]
    method = args["method"]
    amount = int(args["amount"])
    if method not in country["payments"]:
        raise E.DemoError("PAYMENT_METHOD", f"{method} is not available in {country['name']}.",
                          f"{method} tidak tersedia di {country['name']}.")
    if amount <= 0 or amount > 100 * office["allowance_daily"] * 10:
        raise E.DemoError("AMOUNT", "Enter a sensible top-up amount.", "Masukkan jumlah isi saldo yang wajar.")
    reference = f"TOPUP-{emp['badge_id']}-{len(state['payments']) + 1:04d}"
    major = str(amount) if country["decimals"] == 0 else f"{amount / 10 ** country['decimals']:.{country['decimals']}f}"
    charge = GATEWAY.create_charge(
        reference, amount, country["currency"], method, display_amount=major,
        merchant_name="CrewCup Wallet", city=office["name"].upper()[:15], country=office["country"],
        currency_numeric=P.CURRENCY_NUMERIC[country["currency"]],
    )
    charge.update({"emp": emp["id"], "created": now, "expires": now + PAYMENT_TTL_SECONDS, "kind": "topup",
                   "gateway": GATEWAY.name})
    state["payments"][charge["id"]] = charge
    return {key: charge[key] for key in ("id", "reference", "amount", "currency", "method", "status", "qr_string", "deeplink", "expires")}


def settle_payment(state, now, body):
    """Apply a verified provider callback. Idempotent: replays never double-credit."""
    payment = state["payments"].get(body.get("id"))
    if payment is None:
        return 404, {"ok": False, "error": "unknown payment"}
    if payment["status"] == P.PAID:
        return 200, {"ok": True, "duplicate": True}
    if int(body.get("amount", -1)) != payment["amount"] or body.get("currency") != payment["currency"]:
        return 400, {"ok": False, "error": "amount mismatch"}
    if body.get("status") != P.PAID:
        return 200, {"ok": True, "ignored": body.get("status")}
    if now > payment["expires"]:
        payment["status"] = P.EXPIRED
        return 409, {"ok": False, "error": "payment expired"}
    payment["status"] = P.PAID
    payment["paid_at"] = now
    E.wallet_topup(state, now, payment["emp"], payment["amount"], payment["method"])
    country = state["offices"][state["employees"][payment["emp"]]["office"]]["country"]
    E.notify(state, payment["emp"], now,
             f"Top-up received: {E.fmt_money(country, payment['amount'])} via {payment['method']} (ref {payment['reference']}).",
             f"Isi saldo diterima: {E.fmt_money(country, payment['amount'])} via {payment['method']} (ref {payment['reference']}).",
             kind="gift")
    return 200, {"ok": True}


def simulate_paid(state, now, args):
    payment = state["payments"][args["payment"]]
    callback = GATEWAY.simulate_paid_callback(payment)
    if not GATEWAY.verify_callback(callback["headers"]["x-callback-token"]):
        raise E.DemoError("WEBHOOK", "Webhook signature rejected.", "Tanda tangan webhook ditolak.")
    status, payload = settle_payment(state, now, callback["body"])
    if status != 200:
        raise E.DemoError("PAYMENT", f"Payment not applied: {payload.get('error')}", f"Pembayaran gagal: {payload.get('error')}")
    return {"status": state["payments"][args["payment"]]["status"], **payload}


def loyalty_view(state, persona, now):
    """Points and coupons are personal; cafés see their promotions; admins see aggregates."""
    kind, _, ident = (persona or "").partition(":")
    if kind == "emp" and ident in state["employees"]:
        return L.employee_view(state, ident, now)
    if kind == "cafe" and ident in state["cafes"]:
        return L.cafe_view(state, ident, now)
    if A.is_admin(state, persona):
        return L.admin_view(state)
    return None


def rewards_view(state, persona):
    """Rewards are private: employees see their own + the public wall, admins see everything."""
    kind, _, ident = (persona or "").partition(":")
    if kind == "emp" and ident in state["employees"]:
        return R.employee_view(state, ident)
    if A.is_admin(state, persona):
        return R.admin_view(state)
    return None


def qr_svg_for(params):
    if params.get("emv"):
        amount = str(params.get("amount") or "0")
        if not re.fullmatch(r"\d{1,10}(\.\d{1,2})?", amount):
            raise ValueError("amount must be a decimal number")
        data = P.emv_qr_payload(
            (params.get("merchant") or "CREWCUP DEMO")[:25], (params.get("city") or "JAKARTA")[:15],
            amount, (params.get("ref") or "DEMO")[:25],
            country=(params.get("country") or "ID")[:2],
            currency_numeric=P.CURRENCY_NUMERIC.get(params.get("currency") or "IDR", "360"),
        )
    else:
        data = params.get("data") or ""
    if not data or len(data) > 1200:
        raise ValueError("data missing or too long")
    ecl = params.get("ecl") if params.get("ecl") in ("L", "M", "Q", "H") else "M"
    scale = max(1, min(12, int(params.get("scale") or 4)))
    return Q.to_svg(Q.encode(data, ecl=ecl), scale=scale)


# ---------------------------------------------------------------------------
# Action dispatch
# ---------------------------------------------------------------------------

def _run_lock_now(state, now, args):
    run = state["runs"][args["run"]]
    if args.get("by") != run["host"]:
        raise E.DemoError("FORBIDDEN", "Only the host can close the run early.", "Hanya host yang bisa menutup lebih awal.")
    if run["status"] != "open":
        raise E.DemoError("STATE", "Run is not open.", "Pesanan tidak terbuka.")
    run["cutoff"] = now
    E.lock_run(state, run, now)
    return {"status": run["status"]}


def _cafe_settings(state, now, args):
    cafe = state["cafes"][args["cafe"]]
    if "capacity" in args:
        cafe["capacity_per_slot"] = max(1, int(args["capacity"]))
    if "offpeak" in args:
        cafe["offpeak_discount_pct"] = max(0, min(50, int(args["offpeak"])))
    return {"capacity": cafe["capacity_per_slot"], "offpeak": cafe["offpeak_discount_pct"]}


def _policy_update(state, now, args):
    policy = state["company"]["policy"]
    for key in ("allowance_office_days_only", "ramadan_mode", "privacy_aggregate_only"):
        if key in args:
            policy[key] = bool(args[key])
    return policy


def _office_update(state, now, args):
    office = state["offices"][args["office"]]
    if "allowance_daily" in args:
        office["allowance_daily"] = max(0, int(args["allowance_daily"]))
    if "catering_threshold" in args:
        office["catering_threshold"] = max(0, int(args["catering_threshold"]))
    for key, value in (args.get("budgets") or {}).items():
        if key in office["budgets"]:
            office["budgets"][key]["limit"] = max(0, int(value))
    return {"ok": True}


def _promo_end(state, now, args):
    promo = state["loyalty"]["promos"].get(args.get("promo"))
    if not promo or promo["cafe"] != args["cafe"]:
        raise E.DemoError("NOT_FOUND", "Promotion not found.", "Promo tidak ditemukan.")
    promo["active"] = False
    return {"ok": True}


def _scim_add(state, now, args):
    emp = E.scim_add(state, now, args["office"], args["name"], args["team"], args.get("email", ""))
    R.on_join(state, now, emp["id"])  # welcome coffee rule
    return emp["id"]


ACTIONS = {
    "clock.advance": lambda s, n, a: E.clock_advance(s, time.time(), float(a["minutes"])),
    "clock.config": lambda s, n, a: E.clock_configure(s, time.time(), a.get("speed"), a.get("paused")),
    "payment.create_topup": create_topup,
    "payment.simulate_paid": simulate_paid,
    "profile.update": lambda s, n, a: E.profile_update(s, n, a["emp"], a["fields"])["profile"],
    "office.today": lambda s, n, a: E.set_office_today(s, n, a["emp"], a["in_office"])["id"],
    "cafe.at": lambda s, n, a: E.set_at_cafe(s, n, a["emp"], a.get("cafe"))["at_cafe"],
    "run.create": lambda s, n, a: E.run_create(
        s, n, a["host"], a["cafe"], int(a["slot"]), cutoff_ts=int(a["cutoff"]) if a.get("cutoff") else None,
        kind="group", mode=a.get("mode", "pickup"), pay_mode=a.get("pay_mode", "each"),
        title=a.get("title") or None, deliver_to=a.get("deliver_to") or None)["id"],
    "run.join": lambda s, n, a: E.run_join(s, n, a["run"], a.get("who"), a["spec"], guest_name=a.get("guest_name"),
                                           guest_method=a.get("guest_method"), coupon=a.get("coupon") or None)["code"],
    "run.remove_line": lambda s, n, a: E.line_remove(s, n, a["run"], a["line"], by=a.get("by"))["id"],
    "run.lock_now": _run_lock_now,
    "run.set_runner": lambda s, n, a: E.set_runner(s, n, a["run"], a["emp"])["runner"],
    "run.depart": lambda s, n, a: E.runner_depart(s, n, a["run"], a["by"], a["eta"]),
    "solo.order": lambda s, n, a: E.solo_order(
        s, n, a["emp"], a["cafe"], a["spec"], slot_ts=int(a["slot"]) if a.get("slot") else None,
        mode=a.get("mode", "pickup"), confirm_duplicate=bool(a.get("confirm_duplicate")),
        deliver_to=a.get("deliver_to"), coupon=a.get("coupon") or None)["id"],
    "solo.reorder": quick_reorder,
    "nl.parse": lambda s, n, a: E.nl_parse(s, n, a["emp"], a["cafe"], a["text"]),
    "cafe.ack": lambda s, n, a: E.cafe_ack(s, n, a["run"])["id"],
    "cafe.fire": lambda s, n, a: E.cafe_fire(s, n, a["run"])["id"],
    "cafe.ready": lambda s, n, a: E.cafe_ready(s, n, a["run"])["id"],
    "cafe.release": lambda s, n, a: E.cafe_release(s, n, a["run"])["id"],
    "cafe.stock": lambda s, n, a: E.cafe_stock_set(s, n, a["cafe"], a["key"], a["available"]),
    "cafe.settings": _cafe_settings,
    "cafe.badge": lambda s, n, a: E.badge_tap(s, n, a["cafe"], a["badge"]),
    "cafe.quote": lambda s, n, a: E.cafe_quote(s, n, a["request"], a["amount"])["status"],
    "pickup.scan": lambda s, n, a: E.pickup_scan(s, n, a["run"], a["code"], a.get("by")),
    "pickup.complete": lambda s, n, a: E.pickup_complete(s, n, a["run"], a["by"], bool(a.get("report_missing")))["status"],
    "lobby.handoff": lambda s, n, a: E.lobby_handoff(s, n, a["run"], a["by"])["status"],
    "line.flag": lambda s, n, a: E.flag_line(s, n, a["run"], a["line"], a["by"], a["remedy"], a.get("reason", "")),
    "gift.send": lambda s, n, a: E.gift_send(s, n, a["from"], a["to"], a["amount"], a.get("source", "personal"), a.get("message", ""))["id"],
    "karma.redeem": lambda s, n, a: E.karma_redeem(s, n, a["emp"])["karma"],
    "roulette.run": lambda s, n, a: E.roulette_run(s, n, a["office"]),
    "meeting.order": lambda s, n, a: E.meeting_order_create(s, n, a["event"], a["cafe"], a["by"])["id"],
    "event.rsvp": lambda s, n, a: E.event_rsvp(s, n, a["event"], a["emp"], a["rsvp"])["id"],
    "catering.request": lambda s, n, a: E.catering_request(s, n, a["by"], a["cafe"], a["desc"], a["headcount"], int(a["when"]))["id"],
    "catering.approve": lambda s, n, a: E.catering_approve(s, n, a["request"], bool(a["approve"]))["status"],
    "policy.update": _policy_update,
    "office.update": _office_update,
    "scim.add": _scim_add,
    "scim.deactivate": lambda s, n, a: E.scim_deactivate(s, n, a["emp"])["id"],
    # CrewCup Network (cross-company)
    "social.post": lambda s, n, a: SOC.post_create(s, n, a["emp"], a["text"], a.get("audience", "network"),
                                                   cafe=a.get("cafe"), kind=a.get("kind", "update"))["id"],
    "social.delete": lambda s, n, a: SOC.post_delete(s, n, a["emp"], a["post"]),
    "social.react": lambda s, n, a: SOC.react(s, n, a["emp"], a["post"]),
    "social.comment": lambda s, n, a: SOC.comment(s, n, a["emp"], a["post"], a["text"])["id"],
    "social.report": lambda s, n, a: SOC.report(s, n, a["emp"], a["post"], a.get("reason", "other")),
    "social.hide": lambda s, n, a: SOC.hide_post(s, n, a["emp"], a["post"]),
    "social.follow": lambda s, n, a: SOC.follow(s, n, a["emp"], a["company"], bool(a.get("on", True))),
    "social.profile": lambda s, n, a: SOC.profile_update(s, n, a["emp"], a["fields"]),
    "social.chat_request": lambda s, n, a: SOC.chat_request(s, n, a["emp"], a["to"], a["cafe"], int(a["slot"]),
                                                            a.get("note", ""))["id"],
    "social.chat_respond": lambda s, n, a: SOC.chat_respond(s, n, a["emp"], a["chat"], bool(a["accept"])),
    "social.chat_cancel": lambda s, n, a: SOC.chat_cancel(s, n, a["emp"], a["chat"]),
    "social.meetup_rsvp": lambda s, n, a: SOC.meetup_rsvp(s, n, a["emp"], a["meetup"], bool(a.get("going", True))),
    "social.meetup_create": lambda s, n, a: SOC.meetup_create(
        s, n, "emp:" + a["emp"], a["cafe"], a["title"], int(a["start"]), capacity=int(a.get("capacity", 12)),
        max_per_company=int(a.get("max_per_company", 4)), audience=a.get("audience", "network"),
        description=a.get("description", ""))["id"],
    "social.cafe_post": lambda s, n, a: SOC.cafe_post(s, n, a["cafe"], a["text"])["id"],
    "social.cafe_meetup": lambda s, n, a: SOC.meetup_create(
        s, n, "cafe:" + a["cafe"], a["cafe"], a["title"], int(a["start"]), capacity=int(a.get("capacity", 30)),
        max_per_company=int(a.get("max_per_company", 0)), audience="network", description=a.get("description", ""))["id"],
    "social.company_settings": lambda s, n, a: SOC.company_settings(s, n, a.get("fields") or {}),
    "social.block": lambda s, n, a: SOC.company_block(s, n, a["company"], bool(a.get("on", True))),
    "social.moderate": lambda s, n, a: SOC.moderate(s, n, a["post"], a["decision"]),
    # Company coffee rewards
    "rewards.give": lambda s, n, a: R.reward_give(
        s, n, a["office"], a["target_kind"], a.get("target"), int(a.get("coffees", 1)), a.get("reason", "great_work"),
        a.get("message", ""), announce=bool(a.get("announce"))),
    "rewards.decide": lambda s, n, a: R.nomination_decide(s, n, a["nomination"], bool(a["approve"]),
                                                          int(a.get("coffees", 1)), bool(a.get("announce", True)))["status"],
    "rewards.rules": lambda s, n, a: R.rules_update(s, n, a.get("rules") or {}),
    "rewards.partner": lambda s, n, a: R.partner_send(s, n, a["office"], a["to"], int(a.get("coffees", 1)),
                                                      a.get("message", ""))["code"],
    "rewards.nominate": lambda s, n, a: R.nominate(s, n, a["emp"], a["nominee"], a.get("reason", "great_work"),
                                                   a.get("message", ""))["id"],
    "rewards.birthday": lambda s, n, a: R.birthday_optin(s, n, a["emp"], bool(a["on"]), a.get("birthday")),
    "rewards.redeem": lambda s, n, a: R.voucher_redeem(s, n, a["cafe"], a["code"]),
    # Loyalty: points, coupons, promotions, referrals
    "loyalty.redeem": lambda s, n, a: L.redeem(s, n, a["emp"], a["item"]),
    "loyalty.claim": lambda s, n, a: L.promo_claim(s, n, a["emp"], a["promo"])["title"],
    "loyalty.refer": lambda s, n, a: L.refer(s, n, a["emp"], a["kind"], a.get("name", ""), a.get("contact", ""))["id"],
    "loyalty.promo_create": lambda s, n, a: L.promo_create(
        s, n, a["cafe"], a.get("title", ""), a.get("kind", "percent"), a.get("value", 10),
        offpeak_only=bool(a.get("offpeak_only")), max_claims=int(a.get("max_claims", 50)), days=int(a.get("days", 7)))["id"],
    "loyalty.promo_end": _promo_end,
}

READ_ONLY_ACTIONS = {"nl.parse", "pickup.scan", "cafe.badge"}


def error_payload(code, message, message_id=None):
    return {"ok": False, "error": {"code": code, "message": message, "message_id": message_id or message}}


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "CrewCup/" + APP_VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, content_type="application/json; charset=utf-8", extra_headers=None):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _json(self, status, payload):
        self._send(status, json.dumps(payload, ensure_ascii=False))

    def _persona(self):
        token = self.headers.get(SESSION_HEADER) or ""
        persona = A.read_token(SECRET, token)
        if persona and A.valid_persona(STATE, persona):
            return persona
        return None

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("JSON object expected")
        return data

    # -- routing ---------------------------------------------------------

    def do_GET(self):
        try:
            self._route_get()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            traceback.print_exc()
            self._json(500, error_payload("SERVER", "Something went wrong on the server.", "Terjadi kesalahan di server."))

    def do_POST(self):
        try:
            self._route_post()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        except Exception:
            traceback.print_exc()
            self._json(500, error_payload("SERVER", "Something went wrong on the server.", "Terjadi kesalahan di server."))

    def _route_get(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self._json(200, {"ok": True, "version": APP_VERSION})
            return
        if parsed.path == "/api/state":
            persona = self._persona()
            with LOCK:
                now = current_now()
                if E.tick(STATE, now):
                    save_state()
                # Network data is filtered per viewer on the server; the raw store never leaves it.
                private_keys = ("social", "rewards", "nominations", "vouchers", "loyalty")
                public_state = {key: value for key, value in STATE.items() if key not in private_keys}
                payload = {"now": now, "real_now": time.time(), "version": APP_VERSION,
                           "state": public_state, "derived": E.derived(STATE, now),
                           "social": SOC.view_for(STATE, persona, now),
                           "rewards": rewards_view(STATE, persona),
                           "loyalty": loyalty_view(STATE, persona, now)}
                body = json.dumps(payload, ensure_ascii=False)
            self._send(200, body)
            return
        if parsed.path == "/api/events":
            self._stream_events()
            return
        if parsed.path == "/api/session":
            self._json(200, {"ok": True, "persona": self._persona()})
            return
        if parsed.path == "/api/qr.svg":
            params = {key: values[0] for key, values in parse_qs(parsed.query).items()}
            try:
                svg = qr_svg_for(params)
            except (ValueError, Q.QrError) as error:
                self._json(400, error_payload("BAD_REQUEST", str(error)))
                return
            self._send(200, svg, "image/svg+xml; charset=utf-8", {"Cache-Control": "public, max-age=3600"})
            return
        if parsed.path == "/api/audit":
            persona = self._persona()
            with LOCK:
                allowed = persona and A.is_admin(STATE, persona)
            if not allowed:
                self._json(403, error_payload("FORBIDDEN", "Admins only", "Khusus admin"))
                return
            limit = int(parse_qs(parsed.query).get("limit", ["100"])[0])
            with LOCK:
                rows = STORE.audit_rows(limit=min(500, max(1, limit)))
            self._json(200, {"ok": True, "rows": rows})
            return
        if parsed.path == "/api/export/expenses.csv":
            office_id = parse_qs(parsed.query).get("office", ["o_jkt"])[0]
            with LOCK:
                if office_id not in STATE["offices"]:
                    self._json(404, error_payload("OFFICE", "Unknown office"))
                    return
                body = expenses_csv(STATE, office_id)
            self._send(200, "\ufeff" + body, "text/csv; charset=utf-8",
                       {"Content-Disposition": f"attachment; filename=crewcup-expenses-{office_id}.csv"})
            return
        self._serve_static(parsed.path)

    def _route_post(self):
        parsed = urlparse(self.path)
        try:
            body = self._read_json()
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, error_payload("BAD_REQUEST", f"Bad request: {error}", f"Permintaan tidak valid: {error}"))
            return
        if parsed.path == "/api/session":
            persona = body.get("persona")
            with LOCK:
                ok = A.valid_persona(STATE, persona)
                STORE.audit(persona, "session.login", ok, sim_ts=current_now(), detail={"via": body.get("via", "demo-sso")})
            if not ok:
                self._json(400, error_payload("PERSONA", "Unknown account", "Akun tidak dikenal"))
                return
            self._json(200, {"ok": True, "persona": persona, "token": A.issue_token(SECRET, persona)})
            return
        if parsed.path == "/api/webhooks/payment":
            token = self.headers.get("x-callback-token")
            with LOCK:
                if not GATEWAY.verify_callback(token):
                    STORE.audit("gateway", "payment.webhook", False, sim_ts=current_now(), code="BAD_TOKEN", target=body.get("id"))
                    self._json(401, {"ok": False, "error": "invalid callback token"})
                    return
                now = current_now()
                status, payload = settle_payment(STATE, now, body)
                STORE.audit("gateway", "payment.webhook", status == 200, sim_ts=now, target=body.get("id"),
                            code=None if status == 200 else str(status), detail=payload)
                if status == 200:
                    STATE["rev"] += 1
                    save_state()
                    CHANGED.notify_all()
            self._json(status, payload)
            return
        if parsed.path == "/api/reset":
            persona = self._persona()
            if not persona:
                self._json(401, error_payload("UNAUTHENTICATED", "Please sign in first.", "Silakan masuk dulu."))
                return
            with LOCK:
                load_state(reset=True)
                STORE.audit(persona, "demo.reset", True)
                CHANGED.notify_all()
            self._json(200, {"ok": True})
            return
        if parsed.path == "/api/shutdown":
            if self.client_address[0] not in ("127.0.0.1", "::1"):
                self._json(403, error_payload("FORBIDDEN", "Local only"))
                return
            self._json(200, {"ok": True})
            threading.Thread(target=shutdown_server, daemon=True).start()
            return
        if parsed.path == "/api/preview":
            persona = self._persona()
            if persona != f"emp:{body.get('emp')}":
                self._json(403, error_payload("FORBIDDEN", "Preview your own order only.", "Hanya untuk pesanan sendiri."))
                return
            with LOCK:
                now = current_now()
                try:
                    result = preview_line(STATE, now, body["emp"], body["cafe"], body["spec"], body.get("slot"), body.get("coupon"))
                except (KeyError, ValueError, TypeError) as error:
                    result = error_payload("BAD_REQUEST", str(error))
            self._json(200, result)
            return
        if parsed.path == "/api/action":
            self._handle_action(body)
            return
        self._json(404, error_payload("NOT_FOUND", "Not found"))

    def _handle_action(self, body):
        action = body.get("action")
        args = body.get("args") or {}
        handler = ACTIONS.get(action)
        if handler is None:
            self._json(404, error_payload("UNKNOWN_ACTION", f"Unknown action {action}", f"Aksi tidak dikenal {action}"))
            return
        if not isinstance(args, dict):
            self._json(400, error_payload("BAD_REQUEST", "args must be an object"))
            return
        persona = self._persona()
        with LOCK:
            now = current_now()
            E.tick(STATE, now)
            target = (args.get("run") or args.get("payment") or args.get("event") or args.get("request")
                      or args.get("post") or args.get("chat") or args.get("meetup") or args.get("company")
                      or args.get("nomination") or args.get("nominee") or args.get("promo") or args.get("item")
                      or args.get("cafe"))
            try:
                A.authorize(STATE, persona, action, args)
            except E.DemoError as error:
                STORE.audit(persona, action, False, sim_ts=now, target=target, code=error.code)
                status = 401 if error.code == "UNAUTHENTICATED" else 403
                self._json(status, {"ok": False, "error": error.to_dict()})
                return
            try:
                result = handler(STATE, now, args)
            except E.DemoError as error:
                STORE.audit(persona, action, False, sim_ts=now, target=target, code=error.code)
                self._json(200, {"ok": False, "error": error.to_dict()})
                return
            except (KeyError, ValueError, TypeError) as error:
                STORE.audit(persona, action, False, sim_ts=now, target=target, code="BAD_REQUEST")
                self._json(400, error_payload("BAD_REQUEST", f"Bad request: {error}", f"Permintaan tidak valid: {error}"))
                return
            if action not in ("nl.parse",):
                STORE.audit(persona, action, True, sim_ts=now, target=target,
                            detail={key: value for key, value in args.items() if key not in ("spec", "fields")})
            E.tick(STATE, current_now())
            if action not in READ_ONLY_ACTIONS or action == "pickup.scan":
                STATE["rev"] += 1
                save_state()
                CHANGED.notify_all()
        self._json(200, {"ok": True, "result": result})

    def _stream_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        last_sent = None
        last_beat = time.time()
        try:
            self.wfile.write(b"retry: 2000\n\n")
            self.wfile.flush()
            while not STOP.is_set():
                with CHANGED:
                    if STATE.get("rev") == last_sent:
                        CHANGED.wait(timeout=15)
                    rev = STATE.get("rev")
                if rev != last_sent:
                    self.wfile.write(f"event: rev\ndata: {rev}\n\n".encode())
                    self.wfile.flush()
                    last_sent = rev
                    last_beat = time.time()
                elif time.time() - last_beat >= 15:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    last_beat = time.time()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            return

    def _serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        target = (STATIC / path.lstrip("/")).resolve()
        if not str(target).startswith(str(STATIC.resolve())) or not target.is_file():
            if "." not in path.rsplit("/", 1)[-1]:
                target = STATIC / "index.html"  # client-side routes fall back to the app shell
            else:
                self._send(404, "Not found", "text/plain; charset=utf-8")
                return
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.name == "manifest.webmanifest":
            content_type = "application/manifest+json"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/manifest+json"):
            content_type += "; charset=utf-8"
        headers = {}
        if target.name == "sw.js":
            headers["Service-Worker-Allowed"] = "/"
        self._send(200, target.read_bytes(), content_type, headers)


def shutdown_server():
    time.sleep(0.2)
    STOP.set()
    with LOCK:
        save_state()
        STORE.audit("local", "server.shutdown", True)
        CHANGED.notify_all()
    if SERVER is not None:
        SERVER.shutdown()


def lan_addresses():
    addresses = set()
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 1))
        addresses.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(info[4][0])
    except OSError:
        pass
    return sorted(address for address in addresses if not address.startswith("127."))


def make_server(host, port):
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("image/svg+xml", ".svg")
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main():
    global SERVER
    parser = argparse.ArgumentParser(description="CrewCup app server")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--lan", action="store_true", help="listen on all interfaces so phones on the same Wi-Fi can connect")
    parser.add_argument("--reset", action="store_true", help="start from fresh seed data")
    options = parser.parse_args()
    host = "0.0.0.0" if options.lan else options.host
    load_state(reset=options.reset)
    SERVER = make_server(host, options.port)
    start_ticker()
    print(f"CrewCup {APP_VERSION} running at http://localhost:{options.port}  (Ctrl+C to stop)")
    if options.lan:
        for address in lan_addresses():
            print(f"  On your phone (same Wi-Fi): http://{address}:{options.port}")
        print("  Note: 'Install app' needs HTTPS on phones; over plain LAN HTTP it runs as a web page.")
    try:
        SERVER.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        STOP.set()
        with LOCK:
            save_state()


if __name__ == "__main__":
    main()
