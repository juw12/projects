"""CrewCup core domain logic.

Everything here is pure Python operating on a plain JSON-serialisable ``state`` dict,
so the same functions drive the HTTP server and the unit tests. Time is always passed
in explicitly as UTC epoch seconds (``now``) of the simulated clock.
"""

import hashlib
import math
import random
import re
from datetime import datetime, timedelta, timezone

from . import config as C


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class DemoError(Exception):
    """A business-rule rejection that the UI shows to the user (EN + ID text)."""

    def __init__(self, code, en, id_text=None, data=None):
        super().__init__(en)
        self.code = code
        self.en = en
        self.id_text = id_text or en
        self.data = data or {}

    def to_dict(self):
        return {
            "code": self.code,
            "message": self.en,
            "message_id": self.id_text,
            "data": self.data,
        }


# ---------------------------------------------------------------------------
# Time helpers (each office / café has a fixed UTC offset in minutes)
# ---------------------------------------------------------------------------

def tz_of(obj):
    return timezone(timedelta(minutes=obj["tz_min"]))


def local(ts, obj):
    return datetime.fromtimestamp(ts, tz_of(obj))


def local_date(ts, obj):
    return local(ts, obj).date().isoformat()


def hm(ts, obj):
    return local(ts, obj).strftime("%H:%M")


def at_local_hm(ref_ts, obj, hm_text, day_offset=0):
    hour, minute = (int(part) for part in hm_text.split(":"))
    base = local(ref_ts, obj) + timedelta(days=day_offset)
    return int(base.replace(hour=hour, minute=minute, second=0, microsecond=0).timestamp())


def slot_floor(ts, slot_min=10):
    size = slot_min * 60
    return int(ts // size * size)


def slot_ceil(ts, slot_min=10):
    size = slot_min * 60
    return int(math.ceil(ts / size) * size)


# ---------------------------------------------------------------------------
# Simulated clock
# ---------------------------------------------------------------------------

def sim_now(state, real_now):
    clock = state["clock"]
    if clock["paused"]:
        return clock["anchor_sim"]
    return clock["anchor_sim"] + (real_now - clock["anchor_real"]) * clock["speed"]


def clock_rebase(state, real_now):
    clock = state["clock"]
    clock["anchor_sim"] = sim_now(state, real_now)
    clock["anchor_real"] = real_now


def clock_advance(state, real_now, minutes):
    clock_rebase(state, real_now)
    state["clock"]["anchor_sim"] += minutes * 60


def clock_configure(state, real_now, speed=None, paused=None):
    clock_rebase(state, real_now)
    if speed is not None:
        state["clock"]["speed"] = max(0.0, float(speed))
    if paused is not None:
        state["clock"]["paused"] = bool(paused)


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def new_id(state, prefix):
    state["seq"] += 1
    return f"{prefix}{state['seq']}"


def short_code(seed, length):
    digest = hashlib.sha1(seed.encode("utf-8")).digest()
    return "".join(CODE_ALPHABET[byte % len(CODE_ALPHABET)] for byte in digest[:length])


def notify(state, to, now, en, id_text=None, kind="info", ref=None):
    state["notifications"].append({
        "id": new_id(state, "n"),
        "to": to,
        "ts": now,
        "en": en,
        "id_text": id_text or en,
        "kind": kind,
        "ref": ref,
    })


def round_to(amount, step):
    return int(math.floor(amount / step + 0.5)) * step


CURRENCY_FORMAT = {
    "IDR": ("Rp", "", "."),
    "SGD": ("S$", "", ","),
    "MYR": ("RM", "", ","),
    "THB": ("฿", "", ","),
    "PHP": ("₱", "", ","),
    "VND": ("", " ₫", "."),
}


def fmt_money(country_code, amount):
    country = C.COUNTRIES[country_code]
    prefix, suffix, thousands = CURRENCY_FORMAT[country["currency"]]
    sign = "-" if amount < 0 else ""
    amount = abs(amount)
    if country["decimals"] == 0:
        body = f"{amount:,}".replace(",", thousands)
    else:
        whole = amount // 100
        cents = amount % 100
        body = f"{whole:,}.{cents:02d}"
    return f"{sign}{prefix}{body}{suffix}"


def person_name(state, who):
    if who is None:
        return "?"
    if who.startswith("guest:"):
        return who.split(":", 1)[1] + " (guest)"
    return state["employees"][who]["name"]


def initials(name):
    words = [word for word in re.split(r"\s+", name.strip()) if word]
    letters = "".join(word[0] for word in words[:2]).upper()
    return (letters or "XX").ljust(2, "X")


def office_of(state, emp):
    return state["offices"][emp["office"]]


def in_office(emp, ts, office):
    date_key = local_date(ts, office)
    override = emp["office_override"].get(date_key)
    if override is not None:
        return bool(override)
    return local(ts, office).weekday() in emp["office_days"]


# ---------------------------------------------------------------------------
# Menu, specs, allergens, pricing
# ---------------------------------------------------------------------------

def in_stock(cafe, key):
    return cafe["stock"].get(key, True)


def line_allergens(cafe, spec):
    item = cafe["menu"][spec["item"]]
    allergens = set(item["allergens"])
    if item["milk"] and spec.get("milk"):
        allergens.update(C.MILK_ALLERGENS.get(spec["milk"], []))
    return sorted(allergens)


def normalize_spec(cafe, spec, profile=None):
    profile = profile or {}
    if spec.get("item") not in cafe["menu"]:
        raise DemoError("UNKNOWN_ITEM", "That item is not on this café's menu.", "Menu itu tidak ada di kafe ini.")
    item = cafe["menu"][spec["item"]]
    temps = item["temps"]
    temp = spec.get("temp") or (profile.get("temp_pref") if profile.get("temp_pref") in temps else temps[0])
    if temp not in temps:
        temp = temps[0]
    milk = None
    if item["milk"]:
        milk = spec.get("milk") or profile.get("milk_pref") or item["milk"]
        if milk not in cafe["milk_prices"]:
            milk = item["milk"]
    sugar = None
    if item["sugar"]:
        sugar = spec.get("sugar")
        if sugar is None:
            sugar = profile.get("sugar", 100)
        sugar = int(sugar)
        if sugar not in C.SUGAR_LEVELS:
            sugar = 100
    ice = None
    if temp == "iced":
        ice = spec.get("ice") or profile.get("ice", "normal")
        if ice not in C.ICE_LEVELS:
            ice = "normal"
    size = spec.get("size") or "R"
    if not item["sizes"]:
        size = "R"
    reusable = spec.get("reusable")
    if reusable is None:
        reusable = bool(profile.get("reusable", False))
    return {
        "item": spec["item"],
        "size": size if size in ("R", "L") else "R",
        "temp": temp,
        "milk": milk,
        "sugar": sugar,
        "ice": ice,
        "reusable": bool(reusable),
        "note": (spec.get("note") or "")[:80],
    }


def validate_spec(cafe, spec, profile=None):
    item = cafe["menu"][spec["item"]]
    if not in_stock(cafe, "item:" + spec["item"]):
        raise DemoError(
            "OUT_OF_STOCK",
            f"{item['name']} is sold out right now.",
            f"{item['name_id']} sedang habis.",
        )
    if spec.get("milk") and not in_stock(cafe, "milk:" + spec["milk"]):
        raise DemoError(
            "OUT_OF_STOCK",
            f"{spec['milk'].title()} milk is out of stock.",
            f"Susu {spec['milk']} sedang habis.",
        )
    if not profile:
        return
    if profile.get("halal_only") and not item["halal"]:
        raise DemoError(
            "NOT_HALAL",
            f"{item['name']} is not halal-certified and your profile is set to halal only.",
            f"{item['name_id']} tidak bersertifikat halal, profil Anda diatur halal saja.",
        )
    conflicts = sorted(set(line_allergens(cafe, spec)) & set(profile.get("allergies", [])))
    if conflicts:
        safe_milks = []
        if item["milk"]:
            for milk in cafe["milk_prices"]:
                milk_allergens = set(item["allergens"]) | set(C.MILK_ALLERGENS.get(milk, []))
                if not milk_allergens & set(profile.get("allergies", [])) and in_stock(cafe, "milk:" + milk):
                    safe_milks.append(milk)
        raise DemoError(
            "ALLERGEN",
            f"Contains {', '.join(conflicts)} which is in your allergy profile.",
            f"Mengandung {', '.join(conflicts)} yang ada di profil alergi Anda.",
            {"conflicts": conflicts, "safe_milks": safe_milks},
        )


def is_peak(cafe, slot_ts):
    time_text = hm(slot_ts, cafe)
    return any(start <= time_text < end for start, end in cafe["peak"])


def price_line(cafe, spec, company_id, slot_ts):
    country = C.COUNTRIES[cafe["country"]]
    item = cafe["menu"][spec["item"]]
    list_price = item["price"]
    if item["sizes"] and spec.get("size") == "L":
        list_price += cafe["size_prices"]["L"]
    if item["milk"] and spec.get("milk"):
        list_price += cafe["milk_prices"].get(spec["milk"], 0)
    step = country["round_to"]
    offpeak_pct = 0 if is_peak(cafe, slot_ts) else cafe["offpeak_discount_pct"]
    offpeak = round_to(list_price * offpeak_pct / 100, step)
    perk_pct = cafe["company_perk_pct"].get(company_id, 0)
    perk = round_to((list_price - offpeak) * perk_pct / 100, step)
    reusable = cafe["reusable_discount"] if spec.get("reusable") else 0
    price = max(0, list_price - offpeak - perk - reusable)
    rate = country["tax"]["rate"]
    if country["tax"]["inclusive"]:
        gross = price
        tax = round_to(gross - gross / (1 + rate), 1)
        net = gross - tax
    else:
        net = price
        tax = round_to(net * rate, 1)
        gross = net + tax
    return {
        "list": list_price,
        "offpeak": offpeak,
        "offpeak_pct": offpeak_pct,
        "perk": perk,
        "perk_pct": perk_pct,
        "reusable": reusable,
        "net": net,
        "tax": tax,
        "gross": gross,
        "tax_name": country["tax"]["name"],
        "tax_rate": rate,
        "tax_inclusive": country["tax"]["inclusive"],
        "currency": country["currency"],
        "in_store_price": list_price,
        "markup": 0,
        "absorbed": 0,
    }


def describe_spec(cafe, spec, lang="en"):
    item = cafe["menu"][spec["item"]]
    parts = [item["name_id"] if lang == "id" else item["name"]]
    if spec.get("size") == "L":
        parts.append("L")
    if len(item["temps"]) > 1:
        parts.append({"hot": "hot", "iced": "iced"}[spec["temp"]] if lang == "en" else {"hot": "panas", "iced": "es"}[spec["temp"]])
    if spec.get("milk") and spec["milk"] != item["milk"]:
        parts.append(f"{spec['milk']} milk" if lang == "en" else f"susu {spec['milk']}")
    if spec.get("sugar") is not None and spec["sugar"] != 100:
        parts.append(f"sugar {spec['sugar']}%" if lang == "en" else f"gula {spec['sugar']}%")
    if spec.get("ice") and spec["ice"] != "normal":
        parts.append(f"{spec['ice']} ice" if lang == "en" else f"es {spec['ice']}")
    if spec.get("reusable"):
        parts.append("own cup" if lang == "en" else "gelas sendiri")
    return ", ".join(parts)


# ---------------------------------------------------------------------------
# Capacity slots (enforced across ALL accounts, so back-to-back orders cannot bypass)
# ---------------------------------------------------------------------------

def prep_minutes(cafe, cups):
    return int(math.ceil(cafe["base_prep_min"] + cups / cafe["throughput_per_min"]))


def slot_load(state, cafe_id, slot_ts):
    cafe = state["cafes"][cafe_id]
    load = cafe["external_load"].get(str(int(slot_ts)), 0)
    for run in state["runs"].values():
        if run["cafe"] != cafe_id or run["slot"] != slot_ts or run["priority"]:
            continue
        if run["status"] in ("cancelled",):
            continue
        load += sum(1 for line in run["lines"] if line["status"] == "active")
    return load


def slot_table(state, cafe_id, from_ts, count=12):
    cafe = state["cafes"][cafe_id]
    start = slot_ceil(from_ts, cafe["slot_min"])
    rows = []
    for index in range(count):
        slot = start + index * cafe["slot_min"] * 60
        load = slot_load(state, cafe_id, slot)
        peak = is_peak(cafe, slot)
        rows.append({
            "slot": slot,
            "hm": hm(slot, cafe),
            "load": load,
            "capacity": cafe["capacity_per_slot"],
            "free": max(0, cafe["capacity_per_slot"] - load),
            "peak": peak,
            "discount_pct": 0 if peak else cafe["offpeak_discount_pct"],
        })
    return rows


def next_free_slots(state, cafe_id, after_ts, need=1, limit=3):
    suggestions = []
    for row in slot_table(state, cafe_id, after_ts, count=24):
        if row["free"] >= need:
            suggestions.append(row)
        if len(suggestions) >= limit:
            break
    return suggestions


def check_capacity(state, cafe_id, slot_ts, add=1):
    cafe = state["cafes"][cafe_id]
    load = slot_load(state, cafe_id, slot_ts)
    if load + add > cafe["capacity_per_slot"]:
        suggestions = next_free_slots(state, cafe_id, slot_ts, need=add)
        raise DemoError(
            "SLOT_FULL",
            f"{cafe['name']} is at capacity for {hm(slot_ts, cafe)} ({load}/{cafe['capacity_per_slot']} cups across all companies).",
            f"{cafe['name']} penuh untuk slot {hm(slot_ts, cafe)} ({load}/{cafe['capacity_per_slot']} gelas dari semua perusahaan).",
            {"suggestions": suggestions},
        )


# ---------------------------------------------------------------------------
# Wallets, allowance, budgets: hold at join, capture at cutoff, release/refund
# ---------------------------------------------------------------------------

def _reset_allowance_if_new_day(emp, office, now):
    today = local_date(now, office)
    if emp["allowance"]["date"] != today:
        emp["allowance"] = {"date": today, "used": 0, "held": {}}


def allowance_status(state, emp, now, cafe=None):
    office = office_of(state, emp)
    _reset_allowance_if_new_day(emp, office, now)
    policy = state["company"]["policy"]
    allowance = emp["allowance"]
    daily = office["allowance_daily"]
    office_today = in_office(emp, now, office)
    eligible = emp["active"]
    reason = "ok"
    if policy["allowance_office_days_only"] and not office_today:
        eligible = False
        reason = "office_days_only"
    if cafe is not None and cafe["country"] != office["country"]:
        eligible = False
        reason = "other_country"
    remaining = daily - allowance["used"] - sum(allowance["held"].values())
    return {
        "daily": daily,
        "used": allowance["used"],
        "held": sum(allowance["held"].values()),
        "remaining": max(0, remaining) if eligible else 0,
        "eligible": eligible,
        "in_office": office_today,
        "reason": reason,
    }


def wallet_available(emp):
    return emp["wallet"]["balance"] - sum(emp["wallet"]["holds"].values())


def gift_available(emp):
    return emp["wallet"]["gift"] - sum(emp["wallet"]["gift_holds"].values())


def budget_available(budget):
    return budget["limit"] - budget["spent"] - sum(budget["held"].values())


def fund_amount(state, now, amount, payer, cafe, own_line, guest_method=None, budget_key=None, office_id=None):
    """Place holds for ``amount``. Returns payment parts. Raises if funds are short."""
    parts = []
    if payer == "budget":
        office = state["offices"][office_id]
        budget = office["budgets"][budget_key]
        if budget_available(budget) < amount:
            raise DemoError(
                "BUDGET",
                f"The {budget_key} budget does not have enough left for this.",
                f"Anggaran {budget_key} tidak cukup.",
            )
        hold_id = new_id(state, "h")
        budget["held"][hold_id] = amount
        parts.append({"src": "budget", "budget": budget_key, "office": office_id, "amount": amount, "hold": hold_id, "captured": False})
        return parts
    if payer == "guest":
        if not guest_method:
            raise DemoError("PAYMENT_METHOD", "Choose how the guest pays (e.g. QRIS).", "Pilih metode bayar tamu (mis. QRIS).")
        parts.append({"src": "guest", "method": guest_method, "amount": amount, "hold": None, "captured": True})
        return parts

    emp = state["employees"][payer]
    remaining = amount
    if own_line:
        allowance = allowance_status(state, emp, now, cafe)
        take = min(allowance["remaining"], remaining)
        if take > 0:
            hold_id = new_id(state, "h")
            emp["allowance"]["held"][hold_id] = take
            parts.append({"src": "allowance", "emp": payer, "amount": take, "hold": hold_id, "captured": False, "date": emp["allowance"]["date"]})
            remaining -= take
    take = min(gift_available(emp), remaining)
    if take > 0:
        hold_id = new_id(state, "h")
        emp["wallet"]["gift_holds"][hold_id] = take
        parts.append({"src": "gift", "emp": payer, "amount": take, "hold": hold_id, "captured": False})
        remaining -= take
    if remaining > 0:
        if wallet_available(emp) < remaining:
            release_parts(state, parts)
            shortfall = remaining - wallet_available(emp)
            country = office_of(state, emp)["country"]
            raise DemoError(
                "INSUFFICIENT",
                f"{emp['name']} needs {fmt_money(country, shortfall)} more in the CrewCup wallet. Top up via QRIS or e-wallet.",
                f"Saldo CrewCup {emp['name']} kurang {fmt_money(country, shortfall)}. Isi ulang via QRIS atau e-wallet.",
                {"shortfall": shortfall, "payer": payer},
            )
        hold_id = new_id(state, "h")
        emp["wallet"]["holds"][hold_id] = remaining
        parts.append({"src": "wallet", "emp": payer, "amount": remaining, "hold": hold_id, "captured": False})
    return parts


def release_parts(state, parts):
    for part in parts:
        if part["captured"] or not part.get("hold"):
            continue
        if part["src"] == "allowance":
            state["employees"][part["emp"]]["allowance"]["held"].pop(part["hold"], None)
        elif part["src"] == "gift":
            state["employees"][part["emp"]]["wallet"]["gift_holds"].pop(part["hold"], None)
        elif part["src"] == "wallet":
            state["employees"][part["emp"]]["wallet"]["holds"].pop(part["hold"], None)
        elif part["src"] == "budget":
            state["offices"][part["office"]]["budgets"][part["budget"]]["held"].pop(part["hold"], None)
        part["hold"] = None


def record_spend(state, now, office_id, category, amount, emp_id, desc, ref):
    state["spend"].append({
        "ts": now,
        "office": office_id,
        "category": category,
        "amount": amount,
        "emp": emp_id,
        "desc": desc,
        "ref": ref,
    })


def capture_parts(state, now, parts, desc, ref):
    for part in parts:
        if part["captured"]:
            continue
        amount = part["amount"]
        if part["src"] == "allowance":
            emp = state["employees"][part["emp"]]
            emp["allowance"]["held"].pop(part["hold"], None)
            emp["allowance"]["used"] += amount
            record_spend(state, now, emp["office"], "staff_allowance", amount, part["emp"], desc, ref)
        elif part["src"] == "gift":
            emp = state["employees"][part["emp"]]
            emp["wallet"]["gift_holds"].pop(part["hold"], None)
            emp["wallet"]["gift"] -= amount
        elif part["src"] == "wallet":
            emp = state["employees"][part["emp"]]
            emp["wallet"]["holds"].pop(part["hold"], None)
            emp["wallet"]["balance"] -= amount
        elif part["src"] == "budget":
            budget = state["offices"][part["office"]]["budgets"][part["budget"]]
            budget["held"].pop(part["hold"], None)
            budget["spent"] += amount
            record_spend(state, now, part["office"], "meeting", amount, None, desc, ref)
        part["captured"] = True
        part["hold"] = None


def refund_parts(state, now, parts, amount=None, desc="refund", ref=None):
    """Refund captured parts, newest-first. Returns the amount refunded."""
    to_refund = sum(part["amount"] for part in parts if part["captured"]) if amount is None else amount
    refunded = 0
    for part in reversed(parts):
        if to_refund <= 0:
            break
        if not part["captured"] or part["amount"] <= 0:
            continue
        take = min(part["amount"], to_refund)
        if part["src"] == "allowance":
            emp = state["employees"][part["emp"]]
            office = office_of(state, emp)
            _reset_allowance_if_new_day(emp, office, now)
            if emp["allowance"]["date"] == part.get("date"):
                emp["allowance"]["used"] -= take
            else:
                emp["wallet"]["balance"] += take
            record_spend(state, now, emp["office"], "staff_allowance", -take, part["emp"], desc, ref)
        elif part["src"] == "gift":
            state["employees"][part["emp"]]["wallet"]["gift"] += take
        elif part["src"] == "wallet":
            state["employees"][part["emp"]]["wallet"]["balance"] += take
        elif part["src"] == "budget":
            state["offices"][part["office"]]["budgets"][part["budget"]]["spent"] -= take
            record_spend(state, now, part["office"], "meeting", -take, None, desc, ref)
        elif part["src"] == "guest":
            state["guest_refunds"].append({"ts": now, "method": part["method"], "amount": take, "ref": ref})
        part["amount"] -= take
        to_refund -= take
        refunded += take
    return refunded


def reduce_holds(state, parts, amount):
    """Shrink uncaptured holds (newest first) when a pre-cutoff line gets cheaper."""
    for part in reversed(parts):
        if amount <= 0:
            break
        if part["captured"] or not part.get("hold"):
            continue
        take = min(part["amount"], amount)
        part["amount"] -= take
        amount -= take
        if part["src"] == "allowance":
            holds = state["employees"][part["emp"]]["allowance"]["held"]
        elif part["src"] == "gift":
            holds = state["employees"][part["emp"]]["wallet"]["gift_holds"]
        elif part["src"] == "wallet":
            holds = state["employees"][part["emp"]]["wallet"]["holds"]
        else:
            holds = state["offices"][part["office"]]["budgets"][part["budget"]]["held"]
        holds[part["hold"]] = part["amount"]


# ---------------------------------------------------------------------------
# Runs (one model for solo orders, group runs, meeting orders and remakes)
# ---------------------------------------------------------------------------

OPEN_STATES = ("open",)
PRE_FIRE_STATES = ("queued", "needs_ack")


def courier_minutes(cafe, office_id):
    walk = cafe["walk_min"].get(office_id, 10)
    return max(5, int(math.ceil(walk * 0.5))) + 3


def walk_minutes(cafe, office_id):
    return cafe["walk_min"].get(office_id, 10)


def suggest_cutoff(state, cafe_id, office_id, slot_ts, expected_cups=6, mode="pickup"):
    cafe = state["cafes"][cafe_id]
    prep = prep_minutes(cafe, expected_cups)
    travel = courier_minutes(cafe, office_id) if mode == "delivery" else walk_minutes(cafe, office_id)
    cutoff = slot_ts - (prep + travel + 5) * 60
    return int(cutoff // 300 * 300)


def active_lines(run):
    return [line for line in run["lines"] if line["status"] == "active"]


def people_in(run):
    seen = []
    for line in active_lines(run):
        if line["who"] not in seen:
            seen.append(line["who"])
    return seen


def run_create(state, now, host_id, cafe_id, slot_ts, cutoff_ts=None, kind="group", mode="pickup",
               pay_mode="each", title=None, deliver_to=None, event_id=None):
    host = state["employees"][host_id]
    if not host["active"]:
        raise DemoError("INACTIVE", "This account is deactivated.", "Akun ini sudah dinonaktifkan.")
    office = office_of(state, host)
    cafe = state["cafes"].get(cafe_id)
    if cafe is None or not cafe["partner"]:
        raise DemoError("CAFE", "Unknown café.", "Kafe tidak dikenal.")
    if cafe["country"] != office["country"]:
        raise DemoError("CAFE_COUNTRY", "That café is in another country.", "Kafe itu di negara lain.")
    if pay_mode not in ("each", "host", "company", "rotation"):
        raise DemoError("PAY_MODE", "Unknown payment mode.", "Mode pembayaran tidak dikenal.")
    if pay_mode == "company" and kind != "meeting":
        raise DemoError("PAY_MODE", "Company-paid runs are created from a calendar meeting.", "Pesanan dibayar kantor dibuat dari jadwal meeting.")
    if mode == "delivery" and kind == "solo" and not deliver_to:
        deliver_to = f"{host['floor']} — desk {host['desk']}"
    slot_ts = slot_floor(slot_ts, cafe["slot_min"])
    if slot_ts <= now and kind != "remake":
        raise DemoError("SLOT_PAST", "Pick a future pickup slot.", "Pilih slot waktu yang akan datang.")
    if cutoff_ts is None:
        cutoff_ts = now if kind == "solo" else suggest_cutoff(state, cafe_id, office["id"], slot_ts, mode=mode)
    if kind not in ("solo", "remake"):
        if cutoff_ts <= now:
            raise DemoError("CUTOFF_PAST", "Cutoff must be in the future.", "Batas waktu harus di masa depan.")
        if cutoff_ts > slot_ts:
            raise DemoError("CUTOFF_AFTER_SLOT", "Cutoff must be before the pickup slot.", "Batas waktu harus sebelum slot ambil.")
    run_id = new_id(state, "r")
    payer = None
    if pay_mode == "host":
        payer = host_id
    elif pay_mode == "rotation":
        payer = suggest_treat_payer(state, office["id"], team=host["team"])
    run = {
        "id": run_id,
        "code": short_code(run_id + str(now), 5),
        "kind": kind,
        "mode": mode,
        "pay_mode": pay_mode,
        "payer": payer,
        "host": host_id,
        "runner": host_id if mode == "pickup" else None,
        "co_runners": [],
        "cafe": cafe_id,
        "office": office["id"],
        "slot": slot_ts,
        "cutoff": cutoff_ts,
        "title": title or ("Solo order" if kind == "solo" else f"{host['name'].split()[0]}'s coffee run"),
        "deliver_to": deliver_to or (office["lobby_point"] if mode == "delivery" and not office["courier_upstairs"] else deliver_to),
        "event": event_id,
        "status": "open",
        "lines": [],
        "created": now,
        "locked_at": None,
        "needs_ack": False,
        "acked_at": None,
        "departed_at": None,
        "eta_min": None,
        "fired_at": None,
        "ready_at": None,
        "picked_at": None,
        "done_at": None,
        "lobby_at": None,
        "scanned": [],
        "carriers": 1,
        "prep_min": None,
        "visitor_pass": None,
        "courier": None,
        "reminded": False,
        "priority": kind == "remake",
        "freshness_min": None,
        "badge_verified": None,
        "remake_of": None,
        "ack_notified": False,
    }
    state["runs"][run_id] = run
    return run


def cup_code(state, run, line_id, name):
    used = {
        line["code"]
        for other in state["runs"].values()
        for line in other["lines"]
        if line["status"] == "active"
    }
    salt = 0
    while True:
        code = f"{initials(name)}-{short_code(run['id'] + line_id + str(salt), 3)}"
        if code not in used:
            return code
        salt += 1


def run_join(state, now, run_id, who, spec, guest_name=None, guest_method=None, _system=False, coupon=None):
    run = state["runs"].get(run_id)
    if run is None:
        raise DemoError("RUN", "Run not found.", "Pesanan grup tidak ditemukan.")
    cafe = state["cafes"][run["cafe"]]
    late = False
    if run["status"] in PRE_FIRE_STATES and run["kind"] != "solo":
        late = True
    elif run["status"] != "open":
        raise DemoError("RUN_CLOSED", "This run is closed — the café already started making it.", "Pesanan ini sudah ditutup, kafe sudah mulai membuat.")
    if who:
        emp = state["employees"][who]
        if not emp["active"]:
            raise DemoError("INACTIVE", "This account is deactivated.", "Akun ini sudah dinonaktifkan.")
        if office_of(state, emp)["country"] != cafe["country"]:
            raise DemoError("CAFE_COUNTRY", "That café is in another country.", "Kafe itu di negara lain.")
        profile = emp["profile"]
        name = emp["name"]
        owner_allergies = list(profile.get("allergies", []))
    else:
        if not guest_name:
            raise DemoError("GUEST_NAME", "Guest name is required.", "Nama tamu wajib diisi.")
        profile = {}
        name = guest_name.strip()[:30]
        owner_allergies = []
    if run["pay_mode"] == "company" and run["event"] and not _system:
        event = state["events"][run["event"]]
        if who not in event["attendees"] and who != event["organizer"]:
            raise DemoError("NOT_ATTENDEE", "Only meeting attendees can add to a company-paid meeting order.", "Hanya peserta meeting yang bisa menambah pesanan ini.")
    spec = normalize_spec(cafe, spec, profile)
    validate_spec(cafe, spec, profile)
    if not run["priority"]:
        check_capacity(state, run["cafe"], run["slot"], 1)
    price = price_line(cafe, spec, state["company"]["id"], run["slot"])
    if coupon:
        if not who or run["pay_mode"] != "each":
            raise DemoError("COUPON_PAYER", "Coupons apply when you pay for your own drink.",
                            "Kupon berlaku jika Anda membayar minuman sendiri.")
        from . import loyalty as _loyalty
        _loyalty.apply_coupon(state, now, who, coupon, cafe, spec, price, run["slot"])
    line_id = new_id(state, "l")
    who_key = who or f"guest:{name}"
    if run["pay_mode"] == "each":
        if who:
            parts = fund_amount(state, now, price["gross"], who, cafe, own_line=True)
        else:
            parts = fund_amount(state, now, price["gross"], "guest", cafe, own_line=False, guest_method=guest_method)
    elif run["pay_mode"] in ("host", "rotation"):
        payer = run["payer"]
        parts = fund_amount(state, now, price["gross"], payer, cafe, own_line=(who == payer))
    else:
        parts = fund_amount(state, now, price["gross"], "budget", cafe, own_line=False, budget_key="meeting", office_id=run["office"])
    line = {
        "id": line_id,
        "who": who_key,
        "name": name,
        "spec": spec,
        "price": price,
        "pay": parts,
        "code": cup_code(state, run, line_id, name),
        "status": "active",
        "allergens": line_allergens(cafe, spec),
        "owner_allergies": owner_allergies,
        "halal": cafe["menu"][spec["item"]]["halal"],
        "added": now,
        "late": late,
        "needs_choice": False,
        "substitution": None,
        "orig_milk": spec.get("milk"),
        "flag": None,
    }
    run["lines"].append(line)
    if coupon:
        from . import loyalty as _loyalty
        _loyalty.consume_coupon(state, now, coupon, run["id"], line_id)
    if who and who != "guest":
        state["employees"][who]["last_spec"] = {key: spec[key] for key in ("item", "size", "temp", "milk", "sugar", "ice", "reusable")}
        state["employees"][who]["last_cafe"] = run["cafe"]
    if late:
        _capture_line(state, now, run, line)
        _plan_after_lock(state, run)
        if line["owner_allergies"]:
            run["needs_ack"] = True
            run["acked_at"] = None
        notify(state, f"cafe:{run['cafe']}", now,
               f"Late add to {run['code']}: {describe_spec(cafe, spec)} for {name} (cup {line['code']}).",
               f"Tambahan susulan {run['code']}: {describe_spec(cafe, spec, 'id')} untuk {name} (gelas {line['code']}).",
               ref=run["id"])
    if run["host"] and who != run["host"] and run["kind"] == "group":
        notify(state, run["host"], now,
               f"{name} joined your run {run['code']} ({describe_spec(cafe, spec)}).",
               f"{name} ikut pesanan {run['code']} ({describe_spec(cafe, spec, 'id')}).",
               ref=run["id"])
    return line


def _capture_line(state, now, run, line):
    cafe = state["cafes"][run["cafe"]]
    desc = f"{cafe['name']} — {describe_spec(cafe, line['spec'])} for {line['name']}"
    capture_parts(state, now, line["pay"], desc, run["id"])
    country = cafe["country"]
    from . import loyalty as _loyalty
    subsidy = _loyalty.cafe_subsidy(line)
    cafe_gross = line["price"]["gross"] + subsidy
    commission = round_to(cafe_gross * C.CAFE_COMMISSION_PCT / 100, C.COUNTRIES[country]["round_to"] if C.COUNTRIES[country]["decimals"] == 0 else 1)
    state["payouts"].append({
        "ts": now,
        "cafe": run["cafe"],
        "run": run["id"],
        "line": line["id"],
        "gross": cafe_gross,
        "subsidy": subsidy,
        "commission": commission,
        "net": cafe_gross - commission,
        "status": "paid_instant",
        "note": "Instant payout — platform carries the company invoice (no net-30 wait).",
    })
    attendees = []
    if run["event"]:
        event = state["events"][run["event"]]
        attendees = [state["employees"][emp_id]["name"] for emp_id, rsvp in event["attendees"].items() if rsvp == "yes"]
    payer_emp = None
    for part in line["pay"]:
        if part.get("emp"):
            payer_emp = part["emp"]
    cost_center = None
    if payer_emp:
        cost_center = state["employees"][payer_emp]["cost_center"]
    elif line["who"] in state["employees"]:
        cost_center = state["employees"][line["who"]]["cost_center"]
    state["receipts"].append({
        "id": new_id(state, "rc"),
        "ts": now,
        "run": run["id"],
        "line": line["id"],
        "cafe": run["cafe"],
        "cafe_tax_id": cafe["tax_id"],
        "beneficiary": line["who"],
        "beneficiary_name": line["name"],
        "item": describe_spec(cafe, line["spec"]),
        "net": line["price"]["net"],
        "tax": line["price"]["tax"],
        "gross": line["price"]["gross"],
        "tax_name": line["price"]["tax_name"],
        "currency": line["price"]["currency"],
        "parts": [{"src": part["src"], "amount": part["amount"], "method": part.get("method"), "emp": part.get("emp")} for part in line["pay"]],
        "cost_center": cost_center,
        "attendees": attendees,
        "event": run["event"],
        "office": run["office"],
    })
    cafe["quality"]["lines"] += 1
    if line["who"] in state["employees"]:
        _loyalty.on_purchase(state, now, line["who"], run, line)


def _reverse_line_payment(state, now, run, line, reason, amount=None):
    refunded = refund_parts(state, now, line["pay"], amount=amount, desc=reason, ref=run["id"])
    if refunded:
        cafe = state["cafes"][run["cafe"]]
        country = C.COUNTRIES[cafe["country"]]
        commission = round_to(refunded * C.CAFE_COMMISSION_PCT / 100, country["round_to"] if country["decimals"] == 0 else 1)
        state["payouts"].append({
            "ts": now,
            "cafe": run["cafe"],
            "run": run["id"],
            "line": line["id"],
            "gross": -refunded,
            "commission": -commission,
            "net": -(refunded - commission),
            "status": "reversal",
            "note": reason,
        })
    return refunded


def line_remove(state, now, run_id, line_id, by=None, reason="removed"):
    run = state["runs"][run_id]
    line = next((item for item in run["lines"] if item["id"] == line_id), None)
    if line is None or line["status"] != "active":
        raise DemoError("LINE", "Order line not found.", "Item pesanan tidak ditemukan.")
    if by and by not in (line["who"], run["host"]):
        raise DemoError("FORBIDDEN", "Only the person or the host can remove this.", "Hanya pemesan atau host yang bisa menghapus.")
    if run["status"] == "open":
        release_parts(state, line["pay"])
        if line["pay"] and line["pay"][0]["src"] == "guest":
            _reverse_line_payment(state, now, run, line, reason)
    elif run["status"] in PRE_FIRE_STATES:
        _reverse_line_payment(state, now, run, line, reason)
    else:
        raise DemoError("TOO_LATE", "The café already started making this order.", "Kafe sudah mulai membuat pesanan ini.")
    line["status"] = "removed"
    from . import loyalty as _loyalty
    _loyalty.release_coupon(state, line)
    if run["event"] and line["who"] in state["employees"]:
        run.setdefault("opted_out", []).append(line["who"])
    if run["status"] in PRE_FIRE_STATES:
        if not active_lines(run):
            run["status"] = "cancelled"
        else:
            _plan_after_lock(state, run)
    return line


def _plan_after_lock(state, run):
    cafe = state["cafes"][run["cafe"]]
    cups = len(active_lines(run))
    run["prep_min"] = prep_minutes(cafe, max(1, cups))
    if run["mode"] == "pickup" and run["kind"] == "group":
        plan = carry_plan(cups)
        run["carriers"] = plan["carriers"]
        needed = plan["carriers"] - 1
        if needed > len(run["co_runners"]):
            exclude = [run["runner"]] + run["co_runners"]
            candidates = [who for who in people_in(run) if who in state["employees"] and who not in exclude]
            candidates.sort(key=lambda emp_id: _fairness_key(state, emp_id))
            for emp_id in candidates[: needed - len(run["co_runners"])]:
                run["co_runners"].append(emp_id)
    else:
        run["carriers"] = 1


def carry_plan(cups):
    per_carrier = C.CUPS_PER_TRAY * C.TRAYS_PER_CARRIER
    carriers = max(1, int(math.ceil(cups / per_carrier)))
    trays = int(math.ceil(cups / C.CUPS_PER_TRAY)) if cups else 0
    return {"cups": cups, "trays": trays, "carriers": carriers, "per_carrier": per_carrier}


def lock_run(state, run, at):
    cafe = state["cafes"][run["cafe"]]
    for line in active_lines(run):
        if line["needs_choice"]:
            release_parts(state, line["pay"])
            _reverse_line_payment(state, at, run, line, "no substitute chosen")
            line["status"] = "removed"
            notify(state, line["who"], at,
                   f"{line['name']}: your item was unavailable and no substitute was chosen — refunded.",
                   f"{line['name']}: menu tidak tersedia dan tidak ada pengganti — dana dikembalikan.",
                   ref=run["id"])
    lines = active_lines(run)
    run["locked_at"] = at
    if not lines:
        run["status"] = "cancelled"
        if run["host"]:
            notify(state, run["host"], at, f"Run {run['code']} closed with no orders.", f"Pesanan {run['code']} ditutup tanpa pesanan.", ref=run["id"])
        return
    for line in lines:
        _capture_line(state, at, run, line)
    _plan_after_lock(state, run)
    run["needs_ack"] = any(line["owner_allergies"] for line in lines)
    office = state["offices"][run["office"]]
    if run["mode"] == "delivery":
        country = C.COUNTRIES[cafe["country"]]
        run["courier"] = country["couriers"][0]
        if office["courier_upstairs"]:
            run["visitor_pass"] = "VP-" + short_code(run["id"] + "pass", 4)
    run["status"] = "queued"
    if run["pay_mode"] in ("host", "rotation") and run["payer"]:
        payer = state["employees"][run["payer"]]
        for line in lines:
            if line["who"] != run["payer"]:
                payer["treat_balance"] += line["price"]["gross"]
                if line["who"] in state["employees"]:
                    state["employees"][line["who"]]["treat_balance"] -= line["price"]["gross"]
    for who in people_in(run):
        mine = [line for line in lines if line["who"] == who]
        codes = ", ".join(line["code"] for line in mine)
        if who in state["employees"]:
            notify(state, who, at,
                   f"Order {run['code']} confirmed at {cafe['name']} for {hm(run['slot'], cafe)}. Your cup code: {codes}.",
                   f"Pesanan {run['code']} dikonfirmasi di {cafe['name']} untuk {hm(run['slot'], cafe)}. Kode gelas: {codes}.",
                   ref=run["id"])
    notify(state, f"cafe:{run['cafe']}", at,
           f"New ticket {run['code']}: {len(lines)} cups for {hm(run['slot'], cafe)}" + (" — ALLERGY ACK REQUIRED" if run["needs_ack"] else ""),
           f"Tiket baru {run['code']}: {len(lines)} gelas untuk {hm(run['slot'], cafe)}" + (" — PERLU KONFIRMASI ALERGI" if run["needs_ack"] else ""),
           kind="cafe", ref=run["id"])
    if run["co_runners"]:
        for emp_id in run["co_runners"]:
            notify(state, emp_id, at,
                   f"Run {run['code']} has {len(lines)} cups — too many for one person. Can you help carry? (fair rotation picked you)",
                   f"Pesanan {run['code']} ada {len(lines)} gelas — terlalu banyak untuk satu orang. Bisa bantu bawa? (dipilih rotasi adil)",
                   kind="action", ref=run["id"])


def fire_plan(state, run):
    """Return (fire_due_ts, runner_arrival_ts) for a locked run."""
    cafe = state["cafes"][run["cafe"]]
    prep = run["prep_min"] or prep_minutes(cafe, max(1, len(active_lines(run))))
    locked = run["locked_at"] or run["created"]
    if run["priority"]:
        return locked, None
    if run["mode"] == "delivery":
        due = run["slot"] - (prep + courier_minutes(cafe, run["office"])) * 60
        return max(locked, due), None
    if run["departed_at"] is not None:
        arrival = run["departed_at"] + run["eta_min"] * 60
        due = arrival - (prep + C.FIRE_BUFFER_MIN) * 60
        return max(locked, run["departed_at"], due), arrival
    due = run["slot"] - prep * 60
    return max(locked, due), None


def solo_order(state, now, emp_id, cafe_id, spec, slot_ts=None, mode="pickup", confirm_duplicate=False, deliver_to=None,
               coupon=None):
    emp = state["employees"][emp_id]
    cafe = state["cafes"][cafe_id]
    if emp["at_cafe"] == cafe_id and not confirm_duplicate:
        raise DemoError(
            "AT_CAFE",
            f"You're already at {cafe['name']}. Order at the counter, or confirm to place an app order anyway.",
            f"Anda sudah di {cafe['name']}. Pesan di kasir, atau konfirmasi untuk tetap pesan lewat aplikasi.",
        )
    if slot_ts is None:
        earliest = now + (prep_minutes(cafe, 1) + 3) * 60
        free = next_free_slots(state, cafe_id, earliest, need=1, limit=1)
        if not free:
            raise DemoError("SLOT_FULL", "No free slots soon.", "Tidak ada slot kosong dalam waktu dekat.")
        slot_ts = free[0]["slot"]
    run = run_create(state, now, emp_id, cafe_id, slot_ts, cutoff_ts=now, kind="solo", mode=mode, pay_mode="each", deliver_to=deliver_to)
    try:
        run_join(state, now, run["id"], emp_id, spec, coupon=coupon)
    except DemoError:
        del state["runs"][run["id"]]
        raise
    lock_run(state, run, now)
    return run


# ---------------------------------------------------------------------------
# Runner, café and pickup actions
# ---------------------------------------------------------------------------

def _require_runner(run, by):
    allowed = {run["runner"], *run["co_runners"]}
    if run["kind"] == "solo":
        allowed.add(run["host"])
    if by not in allowed:
        raise DemoError("NOT_RUNNER", "Only the runner can do this.", "Hanya runner yang bisa melakukan ini.")


def runner_depart(state, now, run_id, by, eta_min):
    run = state["runs"][run_id]
    _require_runner(run, by)
    if run["mode"] != "pickup":
        raise DemoError("MODE", "This order is delivered by courier.", "Pesanan ini diantar kurir.")
    if run["status"] in ("picked", "done", "cancelled", "released"):
        raise DemoError("STATE", "This run is already finished.", "Pesanan ini sudah selesai.")
    eta_min = max(0, int(eta_min))
    run["departed_at"] = now
    run["eta_min"] = eta_min
    cafe = state["cafes"][run["cafe"]]
    if run["locked_at"]:
        due, arrival = fire_plan(state, run)
        message_en = f"{person_name(state, by)} is on the way (ETA {eta_min} min). Café will start your drinks at {hm(due, cafe)} so they're fresh."
        message_id = f"{person_name(state, by)} sedang jalan (ETA {eta_min} mnt). Kafe mulai membuat jam {hm(due, cafe)} supaya tetap segar."
        if run["status"] not in PRE_FIRE_STATES:
            message_en = f"{person_name(state, by)} is on the way (ETA {eta_min} min)."
            message_id = f"{person_name(state, by)} sedang jalan (ETA {eta_min} mnt)."
        notify(state, f"cafe:{run['cafe']}", now, f"Runner for {run['code']} approaching, ETA {eta_min} min.", f"Runner {run['code']} menuju kafe, ETA {eta_min} mnt.", kind="cafe", ref=run_id)
        for who in people_in(run):
            if who in state["employees"] and who != by:
                notify(state, who, now, message_en, message_id, ref=run_id)
        return {"fire_at": due, "arrival": arrival}
    return {"fire_at": None, "arrival": now + eta_min * 60}


def cafe_ack(state, now, run_id):
    run = state["runs"][run_id]
    if not run["needs_ack"]:
        return run
    run["acked_at"] = now
    run["needs_ack"] = False
    for line in active_lines(run):
        if line["owner_allergies"] and line["who"] in state["employees"]:
            notify(state, line["who"], now,
                   f"Café confirmed your allergy note ({', '.join(line['owner_allergies'])}) for cup {line['code']}.",
                   f"Kafe mengonfirmasi catatan alergi Anda ({', '.join(line['owner_allergies'])}) untuk gelas {line['code']}.",
                   ref=run_id)
    return run


def cafe_fire(state, now, run_id):
    run = state["runs"][run_id]
    if run["status"] not in PRE_FIRE_STATES:
        raise DemoError("STATE", "Ticket is not waiting.", "Tiket tidak dalam antrean.")
    if run["needs_ack"]:
        raise DemoError("ACK", "Confirm the allergy notes first.", "Konfirmasi catatan alergi dulu.")
    run["status"] = "making"
    run["fired_at"] = now
    return run


def cafe_ready(state, now, run_id):
    run = state["runs"][run_id]
    if run["status"] != "making":
        raise DemoError("STATE", "Ticket is not being made.", "Tiket belum dibuat.")
    _mark_ready(state, run, now)
    return run


def _mark_ready(state, run, at):
    cafe = state["cafes"][run["cafe"]]
    run["ready_at"] = at
    if run["mode"] == "delivery":
        run["status"] = "courier"
        notify(state, run["host"], at,
               f"{run['code']} is ready and with the courier ({run['courier']}).",
               f"{run['code']} siap dan sudah dibawa kurir ({run['courier']}).",
               ref=run["id"])
        return
    run["status"] = "ready"
    runners = [run["runner"], *run["co_runners"]] if run["runner"] else [run["host"]]
    for emp_id in runners:
        notify(state, emp_id, at,
               f"{run['code']} is ready at {cafe['name']}. Scan each cup code when you collect.",
               f"{run['code']} siap di {cafe['name']}. Scan kode setiap gelas saat mengambil.",
               kind="action", ref=run["id"])


def pickup_scan(state, now, run_id, code, by=None):
    run = state["runs"][run_id]
    code = (code or "").strip().upper()
    if run["status"] != "ready":
        return {"ok": False, "code": "NOT_READY", "message": "Not ready yet.", "message_id": "Belum siap."}
    for line in active_lines(run):
        if line["code"] == code:
            if code in run["scanned"]:
                return {"ok": True, "code": "ALREADY", "message": f"{code} already scanned.", "message_id": f"{code} sudah discan.", "remaining": _remaining_codes(run)}
            run["scanned"].append(code)
            return {
                "ok": True,
                "code": "OK",
                "message": f"{code} — {line['name']}: OK",
                "message_id": f"{code} — {line['name']}: OK",
                "remaining": _remaining_codes(run),
            }
    for other in state["runs"].values():
        if other["id"] == run_id or other["cafe"] != run["cafe"]:
            continue
        for line in active_lines(other):
            if line["code"] == code:
                return {
                    "ok": False,
                    "code": "WRONG_RUN",
                    "message": f"Stop — {code} belongs to {line['name']} (order {other['code']}). Put it back.",
                    "message_id": f"Stop — {code} milik {line['name']} (pesanan {other['code']}). Kembalikan.",
                    "remaining": _remaining_codes(run),
                }
    return {"ok": False, "code": "UNKNOWN", "message": f"{code} is not a CrewCup cup here.", "message_id": f"{code} bukan gelas CrewCup di sini.", "remaining": _remaining_codes(run)}


def _remaining_codes(run):
    return [line["code"] for line in active_lines(run) if line["code"] not in run["scanned"]]


def pickup_complete(state, now, run_id, by, report_missing=False):
    run = state["runs"][run_id]
    _require_runner(run, by)
    if run["status"] != "ready":
        raise DemoError("STATE", "The order is not ready for pickup.", "Pesanan belum siap diambil.")
    missing = _remaining_codes(run)
    if missing and not report_missing:
        raise DemoError(
            "MISSING",
            f"Missing {len(missing)} cup(s): {', '.join(missing)}. Ask the barista before leaving.",
            f"Kurang {len(missing)} gelas: {', '.join(missing)}. Tanyakan barista sebelum pergi.",
            {"missing": missing},
        )
    cafe = state["cafes"][run["cafe"]]
    if missing:
        missing_lines = [line for line in active_lines(run) if line["code"] in missing]
        cafe["quality"]["flagged"] += len(missing_lines)
        _create_remake(state, now, run, missing_lines, by, reason="missing at pickup")
        for line in missing_lines:
            line["status"] = "missing"
    run["status"] = "picked"
    run["picked_at"] = now
    run["freshness_min"] = round((now - run["ready_at"]) / 60, 1) if run["ready_at"] else None
    cups = len(active_lines(run))
    for emp_id in [run["runner"], *run["co_runners"]]:
        if emp_id and emp_id in state["employees"] and run["kind"] not in ("solo", "remake"):
            emp = state["employees"][emp_id]
            emp["runs_done"] += 1
            emp["last_run"] = now
            emp["karma"] += 10 + cups
            from . import loyalty as _loyalty
            _loyalty.on_run_done(state, now, emp_id, cups)
    people = len(people_in(run))
    state["esg"]["trips_saved"] += max(0, people - run["carriers"])
    state["esg"]["reusable_cups"] += sum(1 for line in active_lines(run) if line["spec"]["reusable"])
    state["esg"]["cups"] += cups
    if run["kind"] == "solo":
        run["status"] = "done"
        run["done_at"] = now
    return run


def badge_tap(state, now, cafe_id, badge_id):
    emp = next((item for item in state["employees"].values() if item["badge_id"] == badge_id.strip().upper()), None)
    if emp is None or not emp["active"]:
        return {"ok": False, "message": "Badge not recognised.", "message_id": "Badge tidak dikenali."}
    matches = []
    for run in state["runs"].values():
        if run["cafe"] != cafe_id or run["status"] not in ("ready", "making", "queued", "needs_ack"):
            continue
        holders = {run["runner"], *run["co_runners"]}
        if run["kind"] == "solo":
            holders.add(run["host"])
        if emp["id"] in holders:
            run["badge_verified"] = emp["id"]
            matches.append({"run": run["id"], "code": run["code"], "status": run["status"], "cups": len(active_lines(run))})
    return {
        "ok": True,
        "employee": {"id": emp["id"], "name": emp["name"], "team": emp["team"], "company": state["company"]["name"]},
        "runs": matches,
        "message": f"Verified {emp['name']} ({state['company']['name']}).",
        "message_id": f"Terverifikasi {emp['name']} ({state['company']['name']}).",
    }


def lobby_handoff(state, now, run_id, by):
    run = state["runs"][run_id]
    if run["status"] != "at_lobby":
        raise DemoError("STATE", "The courier is not at the lobby yet.", "Kurir belum sampai di lobi.")
    if by not in people_in(run) and by != run["host"]:
        raise DemoError("FORBIDDEN", "Only people on this order can collect it.", "Hanya pemesan yang bisa mengambil.")
    run["status"] = "done"
    run["done_at"] = now
    run["picked_at"] = now
    run["freshness_min"] = round((now - run["lobby_at"]) / 60, 1)
    state["esg"]["trips_saved"] += max(0, len(people_in(run)) - 1)
    state["esg"]["cups"] += len(active_lines(run))
    state["esg"]["reusable_cups"] += sum(1 for line in active_lines(run) if line["spec"]["reusable"])
    for who in people_in(run):
        if who in state["employees"] and who != by:
            notify(state, who, now,
                   f"{person_name(state, by)} collected {run['code']} from the lobby. Coffee is on its way up!",
                   f"{person_name(state, by)} sudah ambil {run['code']} dari lobi. Kopi segera naik!",
                   ref=run_id)
    return run


def cafe_release(state, now, run_id):
    run = state["runs"][run_id]
    if run["status"] not in ("ready", "at_lobby"):
        raise DemoError("STATE", "Only unclaimed ready orders can be released.", "Hanya pesanan siap yang tidak diambil yang bisa dilepas.")
    base = run["lobby_at"] if run["status"] == "at_lobby" else run["ready_at"]
    release_at = base + C.UNCLAIMED_RELEASE_MIN * 60
    if now < release_at:
        minutes = int(math.ceil((release_at - now) / 60))
        raise DemoError("TOO_EARLY", f"Wait {minutes} more min before releasing.", f"Tunggu {minutes} menit lagi sebelum melepas.")
    run["status"] = "released"
    run["done_at"] = now
    for who in people_in(run):
        if who in state["employees"]:
            notify(state, who, now,
                   f"{run['code']} was unclaimed for {C.UNCLAIMED_RELEASE_MIN} min and has been released by the café (payment kept).",
                   f"{run['code']} tidak diambil {C.UNCLAIMED_RELEASE_MIN} menit dan dilepas oleh kafe (pembayaran tidak dikembalikan).",
                   ref=run_id)
    return run


def _create_remake(state, now, src_run, lines, owner_id, reason):
    owner = state["employees"].get(owner_id) or state["employees"][src_run["host"]]
    run = run_create(state, now, owner["id"], src_run["cafe"], slot_floor(now), cutoff_ts=now, kind="remake",
                     mode=src_run["mode"], pay_mode="each", title=f"Remake for {src_run['code']}",
                     deliver_to=src_run["deliver_to"])
    run["remake_of"] = src_run["id"]
    run["runner"] = owner["id"] if src_run["mode"] == "pickup" else None
    for line in lines:
        copy_line = dict(line)
        copy_line["id"] = new_id(state, "l")
        copy_line["pay"] = []
        copy_line["status"] = "active"
        copy_line["code"] = cup_code(state, run, copy_line["id"], line["name"])
        copy_line["flag"] = None
        run["lines"].append(copy_line)
    run["locked_at"] = now
    run["status"] = "queued"
    run["prep_min"] = prep_minutes(state["cafes"][run["cafe"]], len(lines))
    notify(state, f"cafe:{run['cafe']}", now,
           f"PRIORITY remake {run['code']} ({reason}): {len(lines)} cup(s). Café covers the cost.",
           f"Buat ulang PRIORITAS {run['code']} ({reason}): {len(lines)} gelas. Biaya ditanggung kafe.",
           kind="cafe", ref=run["id"])
    return run


def flag_line(state, now, run_id, line_id, by, remedy, reason=""):
    run = state["runs"][run_id]
    line = next((item for item in run["lines"] if item["id"] == line_id), None)
    if line is None:
        raise DemoError("LINE", "Order line not found.", "Item pesanan tidak ditemukan.")
    if by not in (line["who"], run["host"]):
        raise DemoError("FORBIDDEN", "Only the drink owner can report it.", "Hanya pemilik minuman yang bisa melapor.")
    if run["status"] not in ("picked", "done"):
        raise DemoError("STATE", "You can report a drink after you receive it.", "Laporan bisa dibuat setelah minuman diterima.")
    if line["flag"]:
        raise DemoError("ALREADY", "Already reported.", "Sudah dilaporkan.")
    cafe = state["cafes"][run["cafe"]]
    cafe["quality"]["flagged"] += 1
    line["flag"] = {"ts": now, "remedy": remedy, "reason": reason}
    if remedy == "credit":
        refunded = _reverse_line_payment(state, now, run, line, f"quality credit: {reason}")
        notify(state, by, now,
               f"Sorry about that! {fmt_money(cafe['country'], refunded)} credited instantly.",
               f"Maaf! {fmt_money(cafe['country'], refunded)} langsung dikembalikan.",
               ref=run_id)
        return {"refunded": refunded}
    remake = _create_remake(state, now, run, [line], by, reason=f"quality: {reason}")
    notify(state, by, now,
           f"Remake {remake['code']} is being made now — priority, free of charge.",
           f"Buat ulang {remake['code']} sedang dibuat — prioritas, gratis.",
           ref=remake["id"])
    return {"remake": remake["id"]}


# ---------------------------------------------------------------------------
# Stock sync and personal substitution rules
# ---------------------------------------------------------------------------

def cafe_stock_set(state, now, cafe_id, key, available):
    cafe = state["cafes"][cafe_id]
    cafe["stock"][key] = bool(available)
    changes = []
    if available:
        return changes
    for run in state["runs"].values():
        if run["cafe"] != cafe_id or run["status"] not in ("open", *PRE_FIRE_STATES):
            continue
        for line in active_lines(run):
            spec = line["spec"]
            affected = (key == "milk:" + str(spec.get("milk"))) or (key == "item:" + spec["item"])
            if affected:
                changes.append(_substitute(state, now, run, line, key))
    return changes


def _substitute(state, now, run, line, key):
    cafe = state["cafes"][run["cafe"]]
    emp = state["employees"].get(line["who"])
    profile = emp["profile"] if emp else {}
    candidates = []
    if key.startswith("milk:"):
        old_milk = key.split(":", 1)[1]
        # Always follow the person's rule for what they ORIGINALLY ordered,
        # so a second outage doesn't chain into a milk they never approved.
        original = line.get("orig_milk") or old_milk
        for milk in profile.get("subs", {}).get(original, []):
            if milk != old_milk:
                candidates.append(dict(line["spec"], milk=milk))
    else:
        old_item = key.split(":", 1)[1]
        for item_id in profile.get("item_subs", {}).get(old_item, []):
            if item_id in cafe["menu"]:
                candidates.append(normalize_spec(cafe, dict(line["spec"], item=item_id), profile))
    for candidate in candidates:
        try:
            validate_spec(cafe, candidate, profile)
        except DemoError:
            continue
        old_spec_text = describe_spec(cafe, line["spec"])
        new_price = price_line(cafe, candidate, state["company"]["id"], run["slot"])
        old_gross = line["price"]["gross"]
        if new_price["gross"] < old_gross:
            diff = old_gross - new_price["gross"]
            already_paid = run["status"] != "open" or (line["pay"] and line["pay"][0]["src"] == "guest")
            if already_paid:
                _reverse_line_payment(state, now, run, line, "substitution price difference", amount=diff)
            else:
                reduce_holds(state, line["pay"], diff)
            line["price"] = new_price
        else:
            new_price["absorbed"] = new_price["gross"] - old_gross
            new_price["gross"] = old_gross
            line["price"] = new_price
        line["spec"] = candidate
        line["allergens"] = line_allergens(cafe, candidate)
        line["substitution"] = {"from": old_spec_text, "to": describe_spec(cafe, candidate), "ts": now}
        if emp:
            notify(state, emp["id"], now,
                   f"{key.split(':', 1)[1].title()} ran out at {cafe['name']}. Switched cup {line['code']} to: {describe_spec(cafe, candidate)} (your rule). You're never charged more.",
                   f"{key.split(':', 1)[1].title()} habis di {cafe['name']}. Gelas {line['code']} diganti: {describe_spec(cafe, candidate, 'id')} (aturan Anda). Tidak ada biaya tambahan.",
                   ref=run["id"])
        return {"line": line["id"], "result": "substituted", "to": describe_spec(cafe, candidate)}
    fallback = profile.get("fallback", "refund")
    if fallback == "ask" and run["status"] == "open":
        line["needs_choice"] = True
        if emp:
            notify(state, emp["id"], now,
                   f"{key.split(':', 1)[1].title()} ran out at {cafe['name']} — choose a replacement for {line['code']} before cutoff or it will be refunded.",
                   f"{key.split(':', 1)[1].title()} habis di {cafe['name']} — pilih pengganti untuk {line['code']} sebelum batas waktu atau dana dikembalikan.",
                   kind="action", ref=run["id"])
        return {"line": line["id"], "result": "ask"}
    if run["status"] == "open":
        release_parts(state, line["pay"])
        if line["pay"] and line["pay"][0]["src"] == "guest":
            _reverse_line_payment(state, now, run, line, "out of stock")
    else:
        _reverse_line_payment(state, now, run, line, "out of stock")
    line["status"] = "removed"
    from . import loyalty as _loyalty
    _loyalty.release_coupon(state, line)
    if emp:
        notify(state, emp["id"], now,
               f"{key.split(':', 1)[1].title()} ran out at {cafe['name']} and no safe substitute matched your rules — cup {line['code']} refunded.",
               f"{key.split(':', 1)[1].title()} habis di {cafe['name']} dan tidak ada pengganti yang aman — gelas {line['code']} dikembalikan.",
               ref=run["id"])
    if run["status"] in PRE_FIRE_STATES and not active_lines(run):
        run["status"] = "cancelled"
    return {"line": line["id"], "result": "refunded"}


# ---------------------------------------------------------------------------
# Fairness, rotation and karma
# ---------------------------------------------------------------------------

def _fairness_key(state, emp_id):
    emp = state["employees"][emp_id]
    return (emp["runs_done"], emp["last_run"] or 0, -emp["karma"], emp_id)


def suggest_runner(state, run_id):
    run = state["runs"][run_id]
    candidates = [who for who in people_in(run) if who in state["employees"] and state["employees"][who]["active"]]
    if run["host"] not in candidates:
        candidates.append(run["host"])
    candidates.sort(key=lambda emp_id: _fairness_key(state, emp_id))
    return candidates[0]


def set_runner(state, now, run_id, emp_id):
    run = state["runs"][run_id]
    if run["mode"] != "pickup":
        raise DemoError("MODE", "Delivery orders have no runner.", "Pesanan antar tidak punya runner.")
    if run["status"] not in ("open", *PRE_FIRE_STATES):
        raise DemoError("STATE", "Too late to change the runner.", "Terlambat untuk ganti runner.")
    run["runner"] = emp_id
    run["co_runners"] = [item for item in run["co_runners"] if item != emp_id]
    notify(state, emp_id, now,
           f"You're the runner for {run['code']} (fair rotation). Thanks! +karma when done.",
           f"Anda runner untuk {run['code']} (rotasi adil). Terima kasih! +karma setelah selesai.",
           kind="action", ref=run_id)
    return run


def suggest_treat_payer(state, office_id, team=None):
    candidates = [
        emp for emp in state["employees"].values()
        if emp["office"] == office_id and emp["active"] and (team is None or emp["team"] == team)
    ]
    candidates.sort(key=lambda emp: (emp["treat_balance"], emp["id"]))
    return candidates[0]["id"]


def fairness_stats(state, office_id):
    people = [emp for emp in state["employees"].values() if emp["office"] == office_id and emp["active"]]
    runs = [emp["runs_done"] for emp in people]
    total = sum(runs)
    if total == 0 or not runs:
        return {"people": len(people), "total_runs": 0, "jain": 1.0, "top_share": 0.0, "distribution": []}
    jain = total ** 2 / (len(runs) * sum(value ** 2 for value in runs))
    ordered = sorted(runs, reverse=True)
    return {
        "people": len(people),
        "total_runs": total,
        "jain": round(jain, 3),
        "top_share": round(ordered[0] / total, 3),
        "distribution": ordered,
    }


def karma_redeem(state, now, emp_id):
    emp = state["employees"][emp_id]
    office = office_of(state, emp)
    if emp["karma"] < 100:
        raise DemoError("KARMA", "You need 100 karma to redeem a free drink.", "Butuh 100 karma untuk minuman gratis.")
    budget = office["budgets"]["kudos"]
    reward = office["karma_reward"]
    if budget_available(budget) < reward:
        raise DemoError("BUDGET", "Kudos budget is empty this month.", "Anggaran kudos bulan ini habis.")
    emp["karma"] -= 100
    budget["spent"] += reward
    emp["wallet"]["gift"] += reward
    record_spend(state, now, office["id"], "gift_individual", reward, emp_id, "Runner karma reward", None)
    notify(state, emp_id, now,
           f"Karma redeemed: {fmt_money(office['country'], reward)} drink credit added.",
           f"Karma ditukar: kredit minuman {fmt_money(office['country'], reward)} ditambahkan.")
    return emp


# ---------------------------------------------------------------------------
# Wallet top-up, gifts, roulette, profile, desk booking, SCIM
# ---------------------------------------------------------------------------

def wallet_topup(state, now, emp_id, amount, method):
    emp = state["employees"][emp_id]
    country_code = office_of(state, emp)["country"]
    country = C.COUNTRIES[country_code]
    if method not in country["payments"]:
        raise DemoError("PAYMENT_METHOD", f"{method} is not available in {country['name']}.", f"{method} tidak tersedia di {country['name']}.")
    amount = int(amount)
    if amount <= 0:
        raise DemoError("AMOUNT", "Enter a positive amount.", "Masukkan jumlah yang valid.")
    emp["wallet"]["balance"] += amount
    state["topups"].append({
        "ts": now,
        "emp": emp_id,
        "amount": amount,
        "method": method,
        "gateway": country["gateways"][0],
        "ref": "PAY-" + short_code(emp_id + str(now) + str(amount), 8),
    })
    return emp


def gift_send(state, now, from_id, to_id, amount, source="personal", message=""):
    sender = state["employees"][from_id]
    receiver = state["employees"].get(to_id)
    if receiver is None or not receiver["active"]:
        raise DemoError("RECIPIENT", "Recipient not found.", "Penerima tidak ditemukan.")
    sender_country = office_of(state, sender)["country"]
    if office_of(state, receiver)["country"] != sender_country:
        raise DemoError("CURRENCY", "Cross-border gifts are not in this demo yet.", "Hadiah lintas negara belum ada di demo ini.")
    amount = int(amount)
    if amount <= 0:
        raise DemoError("AMOUNT", "Enter a positive amount.", "Masukkan jumlah yang valid.")
    if source == "personal":
        if wallet_available(sender) < amount:
            raise DemoError("INSUFFICIENT", "Not enough wallet balance.", "Saldo tidak cukup.")
        sender["wallet"]["balance"] -= amount
    elif source == "kudos":
        budget = office_of(state, sender)["budgets"]["kudos"]
        if budget_available(budget) < amount:
            raise DemoError("BUDGET", "Team kudos budget is not enough.", "Anggaran kudos tim tidak cukup.")
        budget["spent"] += amount
        record_spend(state, now, sender["office"], "gift_individual", amount, to_id, f"Kudos from {sender['name']}", None)
    else:
        raise DemoError("SOURCE", "Unknown gift source.", "Sumber hadiah tidak dikenal.")
    receiver["wallet"]["gift"] += amount
    gift = {"id": new_id(state, "g"), "ts": now, "from": from_id, "to": to_id, "amount": amount, "source": source, "message": message[:140]}
    state["gifts"].append(gift)
    from . import loyalty as _loyalty
    _loyalty.on_gift(state, now, from_id)
    where = "any partner café — at the office or near home"
    notify(state, to_id, now,
           f"{sender['name']} sent you a coffee ({fmt_money(sender_country, amount)}): \"{message}\". Use it at {where}.",
           f"{sender['name']} mengirim kopi ({fmt_money(sender_country, amount)}): \"{message}\". Pakai di kafe partner mana pun — kantor atau dekat rumah.",
           kind="gift")
    return gift


def roulette_run(state, now, office_id):
    office = state["offices"][office_id]
    people = sorted(emp["id"] for emp in state["employees"].values() if emp["office"] == office_id and emp["active"])
    if len(people) < 2:
        raise DemoError("ROULETTE", "Need at least two people.", "Butuh minimal dua orang.")
    rng = random.Random(local_date(now, office) + office_id + str(len(state["roulette"])))
    rng.shuffle(people)
    groups = [people[index:index + 2] for index in range(0, len(people), 2)]
    if len(groups[-1]) == 1 and len(groups) > 1:
        groups[-2].extend(groups.pop())
    voucher = office["karma_reward"]
    budget = office["budgets"]["roulette"]
    if budget_available(budget) < voucher * len(people):
        raise DemoError("BUDGET", "Roulette budget is not enough.", "Anggaran roulette tidak cukup.")
    for group in groups:
        for emp_id in group:
            others = [state["employees"][other]["name"] for other in group if other != emp_id]
            state["employees"][emp_id]["wallet"]["gift"] += voucher
            budget["spent"] += voucher
            record_spend(state, now, office_id, "gift_individual", voucher, emp_id, "Coffee roulette", None)
            notify(state, emp_id, now,
                   f"Coffee roulette: you're paired with {', '.join(others)}! A {fmt_money(office['country'], voucher)} coffee is on the company.",
                   f"Coffee roulette: Anda dipasangkan dengan {', '.join(others)}! Kopi {fmt_money(office['country'], voucher)} ditanggung kantor.",
                   kind="gift")
    entry = {"ts": now, "office": office_id, "groups": groups}
    state["roulette"].append(entry)
    return entry


PROFILE_FIELDS = ("allergies", "halal_only", "sugar", "ice", "milk_pref", "temp_pref", "subs", "item_subs", "fallback", "reusable", "fasting", "usual", "lang")


def profile_update(state, now, emp_id, fields):
    emp = state["employees"][emp_id]
    for key, value in fields.items():
        if key in PROFILE_FIELDS:
            emp["profile"][key] = value
        elif key == "office_days":
            emp["office_days"] = sorted({int(day) for day in value if 0 <= int(day) <= 6})
    return emp


def set_office_today(state, now, emp_id, in_office_flag):
    emp = state["employees"][emp_id]
    office = office_of(state, emp)
    emp["office_override"][local_date(now, office)] = bool(in_office_flag)
    return emp


def set_at_cafe(state, now, emp_id, cafe_id):
    state["employees"][emp_id]["at_cafe"] = cafe_id or None
    return state["employees"][emp_id]


def scim_add(state, now, office_id, name, team, email):
    emp_id = "e_" + re.sub(r"[^a-z]", "", name.lower())[:10] + str(state["seq"] + 1)
    office = state["offices"][office_id]
    state["employees"][emp_id] = make_employee(
        emp_id, name, email, team, office_id, office["floors"][0], "new", "EMP-" + short_code(emp_id, 5),
        office_days=[0, 1, 2, 3, 4], wallet_balance=0,
    )
    state["employees"][emp_id]["source"] = "SCIM"
    notify(state, emp_id, now, f"Welcome to CrewCup, {name}! Your daily coffee allowance is ready.", f"Selamat datang di CrewCup, {name}! Jatah kopi harian Anda sudah siap.")
    return state["employees"][emp_id]


def scim_deactivate(state, now, emp_id):
    emp = state["employees"][emp_id]
    emp["active"] = False
    for run in state["runs"].values():
        if run["status"] != "open":
            continue
        for line in active_lines(run):
            if line["who"] == emp_id:
                release_parts(state, line["pay"])
                line["status"] = "removed"
    return emp


def make_employee(emp_id, name, email, team, office_id, floor, desk, badge_id, office_days, wallet_balance,
                  role="employee", profile=None, cost_center=None):
    base_profile = {
        "allergies": [],
        "halal_only": False,
        "sugar": 100,
        "ice": "normal",
        "milk_pref": None,
        "temp_pref": None,
        "subs": {"oat": ["soy", "almond", "fresh"], "soy": ["oat", "fresh"], "almond": ["oat", "soy"], "fresh": ["oat"]},
        "item_subs": {},
        "fallback": "refund",
        "reusable": False,
        "fasting": False,
        "usual": None,
        "lang": None,
        "birthday_coffee": False,
    }
    base_profile.update(profile or {})
    return {
        "id": emp_id,
        "name": name,
        "email": email,
        "team": team,
        "cost_center": cost_center or f"CC-{team[:3].upper()}",
        "office": office_id,
        "floor": floor,
        "desk": desk,
        "badge_id": badge_id,
        "role": role,
        "active": True,
        "source": "SSO",
        "wallet": {"balance": wallet_balance, "holds": {}, "gift": 0, "gift_holds": {}},
        "allowance": {"date": None, "used": 0, "held": {}},
        "profile": base_profile,
        "office_days": office_days,
        "office_override": {},
        "home_cafe": None,
        "at_cafe": None,
        "runs_done": 0,
        "last_run": None,
        "karma": 0,
        "treat_balance": 0,
        "last_spec": None,
        "last_cafe": None,
        "joined": None,
        "birthday": None,
        "reward_log": [],
    }


# ---------------------------------------------------------------------------
# Meetings (calendar + RSVP sync) and recurring orders
# ---------------------------------------------------------------------------

def meeting_order_create(state, now, event_id, cafe_id, by):
    event = state["events"][event_id]
    if by != event["organizer"]:
        raise DemoError("FORBIDDEN", "Only the organizer can order for this meeting.", "Hanya penyelenggara yang bisa memesan untuk meeting ini.")
    if event.get("run") and state["runs"][event["run"]]["status"] != "cancelled":
        raise DemoError("EXISTS", "This meeting already has an order.", "Meeting ini sudah punya pesanan.")
    cafe = state["cafes"][cafe_id]
    slot = slot_floor(event["start"], cafe["slot_min"])
    cutoff = suggest_cutoff(state, cafe_id, event["office"], slot, expected_cups=len(event["attendees"]), mode="delivery")
    if cutoff <= now:
        raise DemoError("CUTOFF_PAST", "Too close to the meeting start to order delivery.", "Terlalu dekat dengan jam meeting untuk pesan antar.")
    run = run_create(state, now, by, cafe_id, slot, cutoff_ts=cutoff, kind="meeting", mode="delivery",
                     pay_mode="company", title=f"{event['title']}", deliver_to=event["room"], event_id=event_id)
    event["run"] = run["id"]
    sync_meeting(state, now, run)
    return run


def sync_meeting(state, now, run):
    if run["status"] != "open" or not run["event"]:
        return []
    event = state["events"][run["event"]]
    cafe = state["cafes"][run["cafe"]]
    ramadan = state["company"]["policy"]["ramadan_mode"]
    changes = []
    for emp_id, rsvp in event["attendees"].items():
        emp = state["employees"][emp_id]
        mine = [line for line in active_lines(run) if line["who"] == emp_id]
        excluded = rsvp != "yes" or not emp["active"] or (ramadan and emp["profile"]["fasting"])
        if excluded and mine:
            for line in mine:
                release_parts(state, line["pay"])
                line["status"] = "removed"
            changes.append((emp_id, "removed"))
            notify(state, event["organizer"], now,
                   f"{emp['name']} {'is fasting' if ramadan and emp['profile']['fasting'] else 'declined'} — removed from {event['title']} order.",
                   f"{emp['name']} {'sedang puasa' if ramadan and emp['profile']['fasting'] else 'tidak hadir'} — dihapus dari pesanan {event['title']}.",
                   ref=run["id"])
        elif not excluded and not mine and emp_id not in run.setdefault("opted_out", []):
            usual = emp["profile"].get("usual")
            if not usual or usual.get("cafe") != run["cafe"]:
                usual_spec = _default_spec_for(cafe, emp)
            else:
                usual_spec = usual["spec"]
            try:
                run_join(state, now, run["id"], emp_id, usual_spec, _system=True)
                changes.append((emp_id, "added"))
                notify(state, emp_id, now,
                       f"Your usual is in the {event['title']} order (company-paid). Change it before {hm(run['cutoff'], cafe)}.",
                       f"Minuman biasa Anda masuk pesanan {event['title']} (dibayar kantor). Ubah sebelum {hm(run['cutoff'], cafe)}.",
                       ref=run["id"])
            except DemoError as error:
                run["opted_out"].append(emp_id)
                notify(state, emp_id, now,
                       f"Couldn't auto-add your drink to {event['title']}: {error.en} Add one manually.",
                       f"Minuman Anda tidak bisa otomatis ditambahkan ke {event['title']}: {error.id_text} Tambahkan manual.",
                       kind="action", ref=run["id"])
    return changes


def _default_spec_for(cafe, emp):
    usual = emp["profile"].get("usual")
    if usual and usual.get("cafe") == cafe["id"]:
        return usual["spec"]
    for item_id, item in cafe["menu"].items():
        if item["cat"] in ("coffee", "tea"):
            return {"item": item_id}
    return {"item": next(iter(cafe["menu"]))}


def event_rsvp(state, now, event_id, emp_id, rsvp):
    event = state["events"][event_id]
    if emp_id not in event["attendees"]:
        raise DemoError("FORBIDDEN", "Not invited.", "Tidak diundang.")
    event["attendees"][emp_id] = rsvp
    if event.get("run"):
        run = state["runs"][event["run"]]
        if rsvp == "yes" and emp_id in run.get("opted_out", []):
            run["opted_out"].remove(emp_id)
        sync_meeting(state, now, run)
    return event


def _process_recurring(state, now):
    changed = False
    for rec in state["recurring"].values():
        owner = state["employees"][rec["owner"]]
        office = office_of(state, owner)
        today = local_date(now, office)
        if rec["last_date"] == today or local(now, office).weekday() not in rec["days"]:
            continue
        slot = at_local_hm(now, office, rec["slot_hm"])
        trigger = slot - rec["lead_min"] * 60
        if now < trigger:
            continue
        rec["last_date"] = today
        changed = True
        cafe = state["cafes"][rec["cafe"]]
        ramadan = state["company"]["policy"]["ramadan_mode"]
        if rec["kind"] == "solo":
            if not in_office(owner, now, office):
                home = state["cafes"].get(owner["home_cafe"]) if owner["home_cafe"] else None
                notify(state, owner["id"], trigger,
                       f"Skipped your {rec['slot_hm']} usual — you're WFH today (desk booking). Your allowance works at {home['name'] if home else 'any partner café'} too.",
                       f"Pesanan rutin {rec['slot_hm']} dilewati — Anda WFH hari ini. Jatah kopi tetap bisa dipakai di {home['name'] if home else 'kafe partner mana pun'}.",
                       ref=rec["id"])
                continue
            if ramadan and owner["profile"]["fasting"]:
                notify(state, owner["id"], trigger, "Ramadan mode: morning usual paused. Selamat berpuasa!", "Mode Ramadan: pesanan pagi dijeda. Selamat berpuasa!")
                continue
            if now >= slot:
                continue
            try:
                solo_order(state, trigger, owner["id"], rec["cafe"], rec["spec"], slot_ts=slot)
            except DemoError as error:
                notify(state, owner["id"], trigger, f"Recurring order failed: {error.en}", f"Pesanan rutin gagal: {error.id_text}", kind="action")
            continue
        cutoff = slot - rec["cutoff_before_min"] * 60
        if now >= cutoff:
            continue
        try:
            run = run_create(state, trigger, owner["id"], rec["cafe"], slot, cutoff_ts=cutoff, kind="group",
                             mode="pickup", pay_mode=rec.get("pay_mode", "each"), title=rec["title"])
        except DemoError as error:
            notify(state, owner["id"], trigger, f"Recurring run failed: {error.en}", f"Pesanan grup rutin gagal: {error.id_text}", kind="action")
            continue
        run["recurring"] = rec["id"]
        for member_id in rec["members"]:
            member = state["employees"][member_id]
            if not member["active"]:
                continue
            if not in_office(member, now, office):
                notify(state, member_id, trigger,
                       f"'{rec['title']}' skipped you — WFH today.",
                       f"'{rec['title']}' melewati Anda — WFH hari ini.", ref=run["id"])
                continue
            if ramadan and member["profile"]["fasting"]:
                continue
            spec = _default_spec_for(cafe, member)
            try:
                run_join(state, trigger, run["id"], member_id, spec)
                notify(state, member_id, trigger,
                       f"'{rec['title']}' opened — you're in with your usual. Change or drop out before {hm(cutoff, cafe)}.",
                       f"'{rec['title']}' dibuka — Anda otomatis ikut dengan minuman biasa. Ubah atau keluar sebelum {hm(cutoff, cafe)}.",
                       ref=run["id"])
            except DemoError as error:
                notify(state, member_id, trigger,
                       f"Couldn't auto-join '{rec['title']}': {error.en}",
                       f"Gagal ikut otomatis '{rec['title']}': {error.id_text}", kind="action", ref=run["id"])
    return changed


# ---------------------------------------------------------------------------
# Catering / bulk orders with approval
# ---------------------------------------------------------------------------

def catering_request(state, now, by, cafe_id, desc, headcount, when_ts):
    emp = state["employees"][by]
    request = {
        "id": new_id(state, "cat"),
        "ts": now,
        "by": by,
        "office": emp["office"],
        "cafe": cafe_id,
        "desc": desc[:200],
        "headcount": int(headcount),
        "when": int(when_ts),
        "status": "requested",
        "quote": None,
    }
    state["catering"][request["id"]] = request
    notify(state, f"cafe:{cafe_id}", now,
           f"Catering request from {state['company']['name']}: {desc} ({headcount} pax). Please quote.",
           f"Permintaan katering dari {state['company']['name']}: {desc} ({headcount} orang). Mohon beri penawaran.",
           kind="cafe", ref=request["id"])
    return request


def cafe_quote(state, now, request_id, amount):
    request = state["catering"][request_id]
    if request["status"] != "requested":
        raise DemoError("STATE", "Already quoted.", "Sudah diberi penawaran.")
    request["quote"] = int(amount)
    office = state["offices"][request["office"]]
    if request["quote"] > office["catering_threshold"]:
        request["status"] = "pending_approval"
        notify(state, "admin", now,
               f"Approval needed: catering {fmt_money(office['country'], request['quote'])} — {request['desc']}.",
               f"Perlu persetujuan: katering {fmt_money(office['country'], request['quote'])} — {request['desc']}.",
               kind="action", ref=request_id)
        return request
    return catering_approve(state, now, request_id, True, auto=True)


def catering_approve(state, now, request_id, approve, auto=False):
    request = state["catering"][request_id]
    office = state["offices"][request["office"]]
    if request["status"] not in ("pending_approval", "requested") and not auto:
        raise DemoError("STATE", "Nothing to approve.", "Tidak ada yang perlu disetujui.")
    if not approve:
        request["status"] = "declined"
        notify(state, request["by"], now, "Catering request declined by admin.", "Permintaan katering ditolak admin.", ref=request_id)
        return request
    budget = office["budgets"]["meeting"]
    if budget_available(budget) < request["quote"]:
        raise DemoError("BUDGET", "Meeting budget is not enough.", "Anggaran meeting tidak cukup.")
    budget["spent"] += request["quote"]
    record_spend(state, now, office["id"], "meeting", request["quote"], request["by"], f"Catering: {request['desc']}", request_id)
    country = C.COUNTRIES[office["country"]]
    commission = round_to(request["quote"] * C.CAFE_COMMISSION_PCT / 100, country["round_to"] if country["decimals"] == 0 else 1)
    state["payouts"].append({
        "ts": now, "cafe": request["cafe"], "run": request_id, "line": None, "gross": request["quote"],
        "commission": commission, "net": request["quote"] - commission, "status": "paid_instant",
        "note": "Catering — instant payout",
    })
    request["status"] = "approved"
    notify(state, request["by"], now,
           f"Catering approved{' automatically (under threshold)' if auto else ''}: {fmt_money(office['country'], request['quote'])}.",
           f"Katering disetujui{' otomatis (di bawah batas)' if auto else ''}: {fmt_money(office['country'], request['quote'])}.",
           ref=request_id)
    notify(state, f"cafe:{request['cafe']}", now, f"Catering {request['desc']} confirmed and paid.", f"Katering {request['desc']} dikonfirmasi dan dibayar.", kind="cafe", ref=request_id)
    return request


# ---------------------------------------------------------------------------
# Natural-language ordering (English + Bahasa Indonesia)
# ---------------------------------------------------------------------------

NL_MILK = [
    (r"\b(oat|oatmilk|susu oat)\b", "oat"),
    (r"\b(soy|soya|kedelai)\b", "soy"),
    (r"\b(almond)\b", "almond"),
    (r"\b(fresh milk|susu segar|regular milk)\b", "fresh"),
]
NL_SUGAR = [
    (r"(no sugar|tanpa gula|gak pake gula|ga pake gula|unsweetened|kosong)", 0),
    (r"(less sugar|kurang manis|half sugar|sedikit gula|gula sedikit|less sweet)", 50),
    (r"(extra sweet|lebih manis|extra sugar)", 100),
]
NL_ICE = [
    (r"(less ice|sedikit es|es sedikit|little ice)", "less"),
    (r"(extra ice|banyak es|es banyak)", "extra"),
]


def nl_parse(state, now, emp_id, cafe_id, text):
    emp = state["employees"][emp_id]
    cafe = state["cafes"][cafe_id]
    lowered = " " + text.lower().strip() + " "
    spec = None
    source = None
    if re.search(r"(same as yesterday|like yesterday|sama (kayak|kaya|seperti) kemarin|seperti kemarin|yang kemarin)", lowered):
        if emp["last_spec"] and emp["last_spec"]["item"] in cafe["menu"]:
            spec = dict(emp["last_spec"])
            source = "yesterday"
    if spec is None and re.search(r"\b(usual|the usual|biasa|yang biasa|kayak biasa)\b", lowered):
        usual = emp["profile"].get("usual")
        if usual and usual.get("cafe") == cafe_id:
            spec = dict(usual["spec"])
            source = "usual"
    best_item = None
    best_score = 0
    for item_id, item in cafe["menu"].items():
        for alias in [item["name"].lower(), item["name_id"].lower(), *item["aliases"]]:
            if alias and alias in lowered and len(alias) > best_score:
                best_item = item_id
                best_score = len(alias)
    if best_item:
        base = spec or {}
        spec = {key: value for key, value in base.items() if key != "item"}
        if base.get("item") != best_item:
            spec = {"reusable": base.get("reusable")} if base else {}
        spec["item"] = best_item
        source = source or "matched"
    if spec is None:
        raise DemoError("NL_NO_ITEM", "I couldn't find a drink in that. Try e.g. 'iced latte large oat less sugar'.",
                        "Minuman tidak ditemukan. Coba mis. 'es kopi susu aren besar susu oat kurang manis'.")
    for pattern, milk in NL_MILK:
        if re.search(pattern, lowered):
            spec["milk"] = milk
            break
    for pattern, sugar in NL_SUGAR:
        if re.search(pattern, lowered):
            spec["sugar"] = sugar
            break
    for pattern, ice in NL_ICE:
        if re.search(pattern, lowered):
            spec["ice"] = ice
            spec["temp"] = "iced"
            break
    if re.search(r"\b(iced|ice|es|dingin|cold)\b", lowered):
        spec["temp"] = "iced"
    if re.search(r"\b(hot|panas|anget|hangat)\b", lowered):
        spec["temp"] = "hot"
    if re.search(r"\b(large|besar|grande|venti)\b", lowered) or re.search(r"\s(l|size l)\s", lowered):
        spec["size"] = "L"
    elif re.search(r"\b(regular|small|kecil|sedang|medium)\b", lowered):
        spec["size"] = "R"
    if re.search(r"(my cup|own cup|tumbler|bawa gelas|gelas sendiri|reusable)", lowered):
        spec["reusable"] = True
    normalized = normalize_spec(cafe, spec, emp["profile"])
    return {
        "spec": normalized,
        "source": source,
        "summary": describe_spec(cafe, normalized),
        "summary_id": describe_spec(cafe, normalized, "id"),
        "price": price_line(cafe, normalized, state["company"]["id"], slot_ceil(now + 10 * 60, cafe["slot_min"])),
    }


# ---------------------------------------------------------------------------
# Tick: advance all time-based state machines to ``now``
# ---------------------------------------------------------------------------

def tick(state, now):
    changed = _process_recurring(state, now)
    for _ in range(12):
        step_changed = False
        for run in sorted(state["runs"].values(), key=lambda item: (item["slot"], item["id"])):
            if _advance_run(state, run, now):
                step_changed = True
        if not step_changed:
            break
        changed = True
    from . import social as _social  # local import: social builds on engine
    if _social.tick(state, now):
        changed = True
    from . import rewards as _rewards
    if _rewards.tick(state, now):
        changed = True
    from . import loyalty as _loyalty
    if _loyalty.tick(state, now):
        changed = True
    if changed:
        state["rev"] += 1
    return changed


def _advance_run(state, run, now):
    cafe = state["cafes"][run["cafe"]]
    status = run["status"]
    if status == "open":
        if run["event"]:
            sync_meeting(state, min(now, run["cutoff"]), run)
        if now >= run["cutoff"]:
            lock_run(state, run, run["cutoff"])
            return True
        return False
    if status == "queued":
        due, _ = fire_plan(state, run)
        if now >= due:
            if run["needs_ack"]:
                run["status"] = "needs_ack"
                if not run["ack_notified"]:
                    run["ack_notified"] = True
                    notify(state, f"cafe:{run['cafe']}", due,
                           f"{run['code']} is due to start but has allergy notes — confirm to fire.",
                           f"{run['code']} harus mulai dibuat tapi ada catatan alergi — konfirmasi dulu.",
                           kind="cafe", ref=run["id"])
                return True
            run["status"] = "making"
            run["fired_at"] = due
            return True
        return False
    if status == "needs_ack":
        if not run["needs_ack"]:
            due, _ = fire_plan(state, run)
            run["status"] = "making"
            run["fired_at"] = max(due, run["acked_at"] or due)
            return True
        return False
    if status == "making":
        ready_at = run["fired_at"] + run["prep_min"] * 60
        if now >= ready_at:
            _mark_ready(state, run, ready_at)
            return True
        return False
    if status == "courier":
        arrive = run["ready_at"] + courier_minutes(cafe, run["office"]) * 60
        if now >= arrive:
            office = state["offices"][run["office"]]
            if office["courier_upstairs"]:
                run["status"] = "done"
                run["done_at"] = arrive
                run["picked_at"] = arrive
                run["freshness_min"] = round((arrive - run["ready_at"]) / 60, 1)
                state["esg"]["cups"] += len(active_lines(run))
                for who in people_in(run):
                    if who in state["employees"]:
                        notify(state, who, arrive,
                               f"Delivered to {run['deliver_to']} (visitor pass {run['visitor_pass']} pre-registered).",
                               f"Sudah diantar ke {run['deliver_to']} (visitor pass {run['visitor_pass']} sudah terdaftar).",
                               ref=run["id"])
            else:
                run["status"] = "at_lobby"
                run["lobby_at"] = arrive
                for who in people_in(run):
                    if who in state["employees"]:
                        notify(state, who, arrive,
                               f"Courier is at {office['lobby_point']} with {run['code']}. One person can collect for everyone.",
                               f"Kurir sudah di {office['lobby_point']} membawa {run['code']}. Satu orang bisa ambil untuk semua.",
                               kind="action", ref=run["id"])
            return True
        return False
    if status in ("ready", "at_lobby"):
        base = run["lobby_at"] if status == "at_lobby" else run["ready_at"]
        if not run["reminded"] and now >= base + C.UNCLAIMED_REMIND_MIN * 60:
            run["reminded"] = True
            targets = [run["runner"], *run["co_runners"]] if status == "ready" and run["runner"] else people_in(run)
            for who in targets:
                if who and who in state["employees"]:
                    notify(state, who, base + C.UNCLAIMED_REMIND_MIN * 60,
                           f"{run['code']} has been waiting {C.UNCLAIMED_REMIND_MIN} min. Café may release it after {C.UNCLAIMED_RELEASE_MIN} min.",
                           f"{run['code']} sudah menunggu {C.UNCLAIMED_REMIND_MIN} menit. Kafe bisa melepasnya setelah {C.UNCLAIMED_RELEASE_MIN} menit.",
                           kind="action", ref=run["id"])
            return True
        return False
    if status == "picked":
        back = run["picked_at"] + walk_minutes(cafe, run["office"]) * 60
        if now >= back:
            run["status"] = "done"
            run["done_at"] = back
            office = state["offices"][run["office"]]
            for who in people_in(run):
                if who in state["employees"] and who not in (run["runner"], *run["co_runners"]):
                    notify(state, who, back,
                           f"Coffee's here! {run['code']} arrived at {office['pantry']}. Look for your cup code.",
                           f"Kopi sudah datang! {run['code']} ada di {office['pantry']}. Cari kode gelas Anda.",
                           ref=run["id"])
            return True
        return False
    return False


# ---------------------------------------------------------------------------
# Derived views for the UI
# ---------------------------------------------------------------------------

def run_view(state, run, now):
    cafe = state["cafes"][run["cafe"]]
    lines = active_lines(run)
    view = {
        "cups": len(lines),
        "people": len(people_in(run)),
        "carry": carry_plan(len(lines)),
        "slot_hm": hm(run["slot"], cafe),
        "cutoff_hm": hm(run["cutoff"], cafe),
        "minutes_to_cutoff": round((run["cutoff"] - now) / 60, 1),
        "total": sum(line["price"]["gross"] for line in lines),
        "fire_due": None,
        "fire_due_hm": None,
        "arrival": None,
        "arrival_hm": None,
        "remaining_codes": _remaining_codes(run),
        "suggested_runner": suggest_runner(state, run["id"]) if lines and run["mode"] == "pickup" else None,
        "batch": batch_summary(state, run),
        "release_allowed_at": None,
    }
    if run["locked_at"] or run["status"] == "open":
        prep = run["prep_min"] or prep_minutes(cafe, max(1, len(lines)))
        saved = run["prep_min"]
        run["prep_min"] = prep
        due, arrival = fire_plan(state, dict(run, locked_at=run["locked_at"] or run["cutoff"]))
        run["prep_min"] = saved
        view["fire_due"] = due
        view["fire_due_hm"] = hm(due, cafe)
        view["prep_min"] = prep
        if arrival:
            view["arrival"] = arrival
            view["arrival_hm"] = hm(arrival, cafe)
    if run["status"] in ("ready", "at_lobby"):
        base = run["lobby_at"] if run["status"] == "at_lobby" else run["ready_at"]
        view["release_allowed_at"] = base + C.UNCLAIMED_RELEASE_MIN * 60
    return view


def batch_summary(state, run):
    cafe = state["cafes"][run["cafe"]]
    groups = {}
    for line in active_lines(run):
        key = describe_spec(cafe, line["spec"])
        groups.setdefault(key, {"desc": key, "count": 0, "codes": [], "allergy": False})
        groups[key]["count"] += 1
        groups[key]["codes"].append(line["code"])
        if line["owner_allergies"]:
            groups[key]["allergy"] = True
    return sorted(groups.values(), key=lambda group: -group["count"])


def forecast_tomorrow(state, now, cafe_id):
    cafe = state["cafes"][cafe_id]
    tomorrow = now + 86400
    nearby_offices = [office_id for office_id in cafe["walk_min"] if office_id in state["offices"]]
    planned = 0
    headcount = 0
    for emp in state["employees"].values():
        if emp["office"] in nearby_offices and emp["active"]:
            headcount += 1
            if in_office(emp, tomorrow, state["offices"][emp["office"]]):
                planned += 1
    ratio = planned / headcount if headcount else 1.0
    weekday = local(tomorrow, cafe).weekday()
    recurring_extra = {}
    for rec in state["recurring"].values():
        if rec["cafe"] != cafe_id or weekday not in rec["days"]:
            continue
        members = rec["members"] if rec["kind"] == "group" else [rec["owner"]]
        count = sum(1 for member in members if in_office(state["employees"][member], tomorrow, state["offices"][state["employees"][member]["office"]]))
        recurring_extra[rec["slot_hm"]] = recurring_extra.get(rec["slot_hm"], 0) + count
    rows = []
    for slot_hm, baseline in sorted(cafe["history"].items()):
        expected = round(baseline * (0.5 + 0.5 * ratio)) + recurring_extra.get(slot_hm, 0)
        rows.append({"hm": slot_hm, "baseline": baseline, "expected": expected})
    return {"attendance_ratio": round(ratio, 2), "planned_in_office": planned, "headcount": headcount, "slots": rows,
            "milk_litres": round(sum(row["expected"] for row in rows) * 0.18, 1)}


def recommendations(state, now, emp_id):
    emp = state["employees"][emp_id]
    office = office_of(state, emp)
    working_from_home = not in_office(emp, now, office)
    rows = []
    for cafe in state["cafes"].values():
        if cafe["country"] != office["country"] or not cafe["partner"]:
            continue
        if working_from_home:
            walk = cafe["walk_min"].get("home:" + emp_id)
        else:
            walk = cafe["walk_min"].get(office["id"])
        if walk is None:
            continue
        slots = slot_table(state, cafe["id"], now + 5 * 60, count=6)
        next_free = next((row for row in slots if row["free"] > 0), None)
        load = sum(row["load"] for row in slots[:3]) / max(1, 3 * cafe["capacity_per_slot"])
        quality = cafe["quality"]
        quality_score = 1 - quality["flagged"] / quality["lines"] if quality["lines"] else 1.0
        score = cafe["rating"] * 2 - walk * 0.15 - load * 2 + (0.5 if next_free and next_free["discount_pct"] else 0)
        rows.append({
            "cafe": cafe["id"],
            "walk": walk,
            "next_free": next_free,
            "load_pct": round(load * 100),
            "rating": cafe["rating"],
            "quality": round(quality_score, 3),
            "score": round(score, 2),
            "near": "home" if working_from_home else "office",
        })
    rows.sort(key=lambda row: -row["score"])
    return {"wfh": working_from_home, "cafes": rows}


def spend_summary(state, office_id):
    office = state["offices"][office_id]
    country = C.COUNTRIES[office["country"]]
    totals = {}
    for entry in state["spend"]:
        if entry["office"] != office_id:
            continue
        totals[entry["category"]] = totals.get(entry["category"], 0) + entry["amount"]
    return {
        "totals": totals,
        "notes": country["perk_tax"],
        "invoice_total": sum(totals.values()),
        "budgets": {key: {"limit": value["limit"], "spent": value["spent"], "held": sum(value["held"].values())}
                    for key, value in office["budgets"].items()},
    }


def derived(state, now):
    runs = {run_id: run_view(state, run, now) for run_id, run in state["runs"].items()
            if run["status"] not in ("cancelled",) or now - run["created"] < 3600}
    employees = {}
    for emp_id, emp in state["employees"].items():
        office = office_of(state, emp)
        employees[emp_id] = {
            "allowance": allowance_status(state, emp, now),
            "wallet_available": wallet_available(emp),
            "gift_available": gift_available(emp),
            "in_office_today": in_office(emp, now, office),
            "local_time": hm(now, office),
            "local_date": local_date(now, office),
            "weekday": local(now, office).weekday(),
            "recommendations": recommendations(state, now, emp_id),
        }
    cafes = {}
    for cafe_id, cafe in state["cafes"].items():
        payouts = [entry for entry in state["payouts"] if entry["cafe"] == cafe_id]
        quality = cafe["quality"]
        cafes[cafe_id] = {
            "slots": slot_table(state, cafe_id, now - cafe["slot_min"] * 60, count=12),
            "forecast": forecast_tomorrow(state, now, cafe_id),
            "payout_total": sum(entry["net"] for entry in payouts),
            "gross_total": sum(entry["gross"] for entry in payouts),
            "commission_total": sum(entry["commission"] for entry in payouts),
            "quality_score": round(1 - quality["flagged"] / quality["lines"], 3) if quality["lines"] else 1.0,
            "local_time": hm(now, cafe),
        }
    offices = {}
    for office_id, office in state["offices"].items():
        iftar = at_local_hm(now, office, office["iftar_hm"])
        offices[office_id] = {
            "fairness": fairness_stats(state, office_id),
            "spend": spend_summary(state, office_id),
            "local_time": hm(now, office),
            "iftar_slot": slot_floor(iftar - 10 * 60),
            "headcount": sum(1 for emp in state["employees"].values() if emp["office"] == office_id and emp["active"]),
            "in_office_today": sum(1 for emp in state["employees"].values()
                                   if emp["office"] == office_id and emp["active"] and in_office(emp, now, office)),
        }
    return {"runs": runs, "employees": employees, "cafes": cafes, "offices": offices}
