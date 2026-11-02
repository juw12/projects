"""Company coffee rewards: recognition from the company itself, not just from colleagues.

- Admins/HR give coffees to a person, a team or a whole office, with a reason and message,
  funded from the office's monthly `rewards` budget. Credit lands as gift credit, usable at any
  partner café (payment order: allowance → gift credit → wallet).
- Optional shout-out on the company-only feed of the Network.
- Automatic rules: welcome coffee for new joiners (SCIM), work-anniversary coffee, and a
  birthday coffee for employees who opted in (birthdays are never shown to others).
- Peer nominations: any employee can nominate a colleague; an admin approves or declines.
- Partner coffees: the company can thank someone at another company on the Network. They get a
  single-use voucher code that any partner café in their city redeems at the counter.
"""

from . import engine as E
from . import social as SOC
from .engine import DemoError

REASONS = {
    "great_work": ("Great work", "Kerja hebat"),
    "team_win": ("Team milestone", "Pencapaian tim"),
    "thank_you": ("Thank you", "Terima kasih"),
    "welcome": ("Welcome to the team", "Selamat bergabung"),
    "anniversary": ("Work anniversary", "Ulang tahun kerja"),
    "birthday": ("Happy birthday", "Selamat ulang tahun"),
    "partner": ("Thanks from our company", "Terima kasih dari perusahaan kami"),
}
MAX_COFFEES_PER_PERSON = 5
MAX_RECIPIENTS = 200
MAX_PENDING_NOMINATIONS = 3
VOUCHER_DAYS = 30
PARTNER_REPLY_MIN = 4


def ensure(state):
    """Add reward structures to older saved states (idempotent)."""
    state.setdefault("rewards", [])
    state.setdefault("nominations", {})
    state.setdefault("vouchers", {})
    state.setdefault("reward_rules", {
        "welcome": {"on": True, "coffees": 1},
        "anniversary": {"on": True, "coffees": 2},
        "birthday": {"on": True, "coffees": 1},
    })
    for office in state["offices"].values():
        office["budgets"].setdefault("rewards", {"limit": office["karma_reward"] * 60, "spent": 0, "held": {}})
    for emp in state["employees"].values():
        emp.setdefault("joined", None)
        emp.setdefault("birthday", None)
        emp.setdefault("reward_log", [])
        emp["profile"].setdefault("birthday_coffee", False)
    return state


def coffee_value(office):
    """One company coffee = the office's standard drink value (same as the karma reward)."""
    return office["karma_reward"]


def reason_text(reason):
    return REASONS.get(reason, REASONS["great_work"])


def _recipients(state, office_id, target_kind, target):
    people = [emp for emp in state["employees"].values() if emp["active"] and emp["office"] == office_id]
    if target_kind == "person":
        chosen = [emp for emp in people if emp["id"] == target]
    elif target_kind == "team":
        chosen = [emp for emp in people if emp["team"] == target]
    elif target_kind == "office":
        chosen = people
    else:
        raise DemoError("BAD_TARGET", "Choose a person, a team or the whole office.", "Pilih orang, tim, atau seluruh kantor.")
    if not chosen:
        raise DemoError("NO_RECIPIENTS", "Nobody matches that choice in this office.", "Tidak ada penerima yang cocok di kantor ini.")
    if len(chosen) > MAX_RECIPIENTS:
        raise DemoError("TOO_MANY", f"Up to {MAX_RECIPIENTS} people per reward.", f"Maksimal {MAX_RECIPIENTS} orang per reward.")
    return sorted(chosen, key=lambda emp: emp["name"])


def reward_give(state, now, office_id, target_kind, target, coffees=1, reason="great_work", message="",
                announce=False, source="admin", nominated_by=None):
    office = state["offices"].get(office_id)
    if office is None:
        raise DemoError("OFFICE", "Unknown office.", "Kantor tidak dikenal.")
    coffees = int(coffees)
    if not 1 <= coffees <= MAX_COFFEES_PER_PERSON:
        raise DemoError("BAD_AMOUNT", f"Give between 1 and {MAX_COFFEES_PER_PERSON} coffees per person.",
                        f"Berikan 1 sampai {MAX_COFFEES_PER_PERSON} kopi per orang.")
    if reason not in REASONS:
        reason = "great_work"
    message = " ".join(str(message or "").split())[:200]
    people = _recipients(state, office_id, target_kind, target)
    value = coffee_value(office) * coffees
    total = value * len(people)
    budget = office["budgets"]["rewards"]
    if E.budget_available(budget) < total:
        raise DemoError("BUDGET", "The rewards budget for this office is not enough this month.",
                        "Anggaran reward kantor ini tidak cukup bulan ini.",
                        data={"needed": total, "available": E.budget_available(budget)})
    batch = E.new_id(state, "rw")
    en_reason, id_reason = reason_text(reason)
    company = state["company"]["name"]
    for emp in people:
        emp["wallet"]["gift"] += value
        budget["spent"] += value
        E.record_spend(state, now, office_id, "gift_individual", value, emp["id"], f"Company reward: {en_reason}", batch)
        state["rewards"].append({
            "id": E.new_id(state, "rr"),
            "batch": batch,
            "ts": now,
            "office": office_id,
            "emp": emp["id"],
            "coffees": coffees,
            "amount": value,
            "reason": reason,
            "message": message,
            "source": source,
            "nominated_by": nominated_by,
            "target_kind": target_kind,
            "public": bool(announce),
        })
        cups = f"{coffees} coffee{'s' if coffees > 1 else ''}"
        E.notify(state, emp["id"], now,
                 f"{company} sent you {cups} ({E.fmt_money(office['country'], value)}) — {en_reason}" + (f": {message}" if message else "."),
                 f"{company} mengirim {coffees} kopi ({E.fmt_money(office['country'], value)}) — {id_reason}" + (f": {message}" if message else "."),
                 kind="gift", ref=batch)
    if announce:
        _announce(state, now, office, people, coffees, reason, message, target_kind, target)
    return {"batch": batch, "recipients": len(people), "total": total}


def _announce(state, now, office, people, coffees, reason, message, target_kind, target):
    en_reason, _ = reason_text(reason)
    if target_kind == "person":
        who = people[0]["name"]
    elif target_kind == "team":
        who = f"the {target} team"
    else:
        who = f"everyone at {office['name']}"
    text = f"{en_reason}: a coffee from the company for {who}."
    if message:
        text += f" {message}"
    site = {"building": office["building"], "city": SOC.OFFICE_CITY.get(office["id"], "")}
    post = SOC._new_post(state, now, "company:" + SOC.HOME_COMPANY, text, "company", site, kind="recognition")
    post["engaged"] = True
    return post


# -- nominations ----------------------------------------------------------------

def nominate(state, now, emp_id, nominee_id, reason="great_work", message=""):
    emp = state["employees"].get(emp_id)
    nominee = state["employees"].get(nominee_id)
    if not nominee or not nominee["active"]:
        raise DemoError("NOT_FOUND", "That colleague isn't available.", "Rekan itu tidak tersedia.")
    if nominee_id == emp_id:
        raise DemoError("SELF", "You can't nominate yourself.", "Anda tidak bisa menominasikan diri sendiri.")
    message = " ".join(str(message or "").split())
    if len(message) < 10:
        raise DemoError("REASON", "Say briefly what they did (at least 10 characters).",
                        "Tulis singkat apa yang mereka lakukan (minimal 10 karakter).")
    pending = [item for item in state["nominations"].values() if item["by"] == emp_id and item["status"] == "pending"]
    if len(pending) >= MAX_PENDING_NOMINATIONS:
        raise DemoError("LIMIT", f"You have {MAX_PENDING_NOMINATIONS} nominations waiting for review already.",
                        f"Anda sudah punya {MAX_PENDING_NOMINATIONS} nominasi yang menunggu peninjauan.")
    if reason not in ("great_work", "team_win", "thank_you"):
        reason = "great_work"
    nomination_id = E.new_id(state, "nm")
    state["nominations"][nomination_id] = {
        "id": nomination_id,
        "by": emp_id,
        "nominee": nominee_id,
        "office": nominee["office"],
        "reason": reason,
        "message": message[:200],
        "ts": now,
        "status": "pending",
    }
    E.notify(state, "admin", now, f"New reward nomination: {emp['name']} nominated {nominee['name']}.",
             f"Nominasi reward baru: {emp['name']} menominasikan {nominee['name']}.", kind="action", ref=nomination_id)
    return state["nominations"][nomination_id]


def nomination_decide(state, now, nomination_id, approve, coffees=1, announce=True):
    item = state["nominations"].get(nomination_id)
    if not item or item["status"] != "pending":
        raise DemoError("NOT_FOUND", "That nomination is no longer pending.", "Nominasi itu sudah tidak menunggu.")
    nominator = state["employees"][item["by"]]
    nominee = state["employees"][item["nominee"]]
    if approve:
        reward_give(state, now, item["office"], "person", item["nominee"], coffees, item["reason"],
                    f"Nominated by {nominator['name']}: {item['message']}", announce=announce,
                    source="nomination", nominated_by=item["by"])
        item["status"] = "approved"
        E.notify(state, item["by"], now, f"Your nomination for {nominee['name']} was approved — they received a company coffee.",
                 f"Nominasi Anda untuk {nominee['name']} disetujui — mereka menerima kopi dari perusahaan.", kind="ok")
    else:
        item["status"] = "declined"
        E.notify(state, item["by"], now, f"Your nomination for {nominee['name']} wasn't approved this time.",
                 f"Nominasi Anda untuk {nominee['name']} belum disetujui kali ini.")
    item["decided"] = now
    return item


# -- automatic rules ---------------------------------------------------------------

def rules_update(state, now, rules):
    current = state["reward_rules"]
    for key, value in (rules or {}).items():
        if key not in current:
            continue
        if "on" in value:
            current[key]["on"] = bool(value["on"])
        if "coffees" in value:
            current[key]["coffees"] = max(1, min(MAX_COFFEES_PER_PERSON, int(value["coffees"])))
    return current


def birthday_optin(state, now, emp_id, on, birthday=None):
    emp = state["employees"][emp_id]
    if on:
        birthday = str(birthday or emp.get("birthday") or "").strip()
        parts = birthday.split("-")
        if len(parts) != 2 or not all(part.isdigit() for part in parts) or not (1 <= int(parts[0]) <= 12 and 1 <= int(parts[1]) <= 31):
            raise DemoError("BAD_DATE", "Enter your birthday as MM-DD (no year needed).", "Masukkan tanggal lahir format BB-HH (tanpa tahun).")
        emp["birthday"] = f"{int(parts[0]):02d}-{int(parts[1]):02d}"
    emp["profile"]["birthday_coffee"] = bool(on)
    return {"on": emp["profile"]["birthday_coffee"], "birthday": emp["birthday"] if on else None}


def on_join(state, now, emp_id):
    rule = state["reward_rules"]["welcome"]
    emp = state["employees"][emp_id]
    emp["joined"] = E.local_date(now, state["offices"][emp["office"]])
    if not rule["on"]:
        return None
    return _rule_reward(state, now, emp, "welcome", rule["coffees"], "welcome", "Enjoy your first coffee on us.")


def _rule_reward(state, now, emp, key, coffees, reason, message):
    if key in emp["reward_log"]:
        return None
    emp["reward_log"].append(key)
    try:
        return reward_give(state, now, emp["office"], "person", emp["id"], coffees, reason, message, source="rule")
    except DemoError as error:
        if error.code == "BUDGET":
            E.notify(state, "admin", now, f"Automatic {reason} reward for {emp['name']} skipped: rewards budget is empty.",
                     f"Reward otomatis untuk {emp['name']} dilewati: anggaran reward habis.", kind="warn")
            return None
        raise


def _due_rewards(state, now):
    rules = state["reward_rules"]
    given = False
    for emp in sorted(state["employees"].values(), key=lambda item: item["id"]):
        if not emp["active"]:
            continue
        office = state["offices"][emp["office"]]
        today = E.local_date(now, office)  # "YYYY-MM-DD"
        year, month_day = today[:4], today[5:]
        joined = emp.get("joined")
        if rules["anniversary"]["on"] and joined and joined[5:] == month_day and joined[:4] < year:
            years = int(year) - int(joined[:4])
            if _rule_reward(state, now, emp, f"anniversary:{year}", rules["anniversary"]["coffees"], "anniversary",
                            f"{years} year{'s' if years > 1 else ''} with {state['company']['name']}. Thank you!"):
                given = True
        if rules["birthday"]["on"] and emp["profile"].get("birthday_coffee") and emp.get("birthday") == month_day:
            if _rule_reward(state, now, emp, f"birthday:{year}", rules["birthday"]["coffees"], "birthday",
                            "Have a great day!"):
                given = True
    return given


# -- partner coffees (other companies) ------------------------------------------------

def partner_send(state, now, office_id, member_key, coffees=1, message=""):
    office = state["offices"].get(office_id)
    if office is None:
        raise DemoError("OFFICE", "Unknown office.", "Kantor tidak dikenal.")
    view = SOC.viewer(state, "admin:co")
    if not member_key.startswith("member:") or not SOC.person_visible(state, member_key, view):
        raise DemoError("NOT_FOUND", "That person isn't in your network.", "Orang itu tidak ada di jaringan Anda.")
    member = state["social"]["members"][member_key[7:]]
    city = SOC.OFFICE_CITY.get(office_id)
    if member["city"] != city:
        raise DemoError("CITY", f"Send from your {member['city']} office so the voucher is in local currency.",
                        f"Kirim dari kantor {member['city']} agar voucher dalam mata uang lokal.")
    coffees = int(coffees)
    if not 1 <= coffees <= MAX_COFFEES_PER_PERSON:
        raise DemoError("BAD_AMOUNT", f"Send between 1 and {MAX_COFFEES_PER_PERSON} coffees.",
                        f"Kirim 1 sampai {MAX_COFFEES_PER_PERSON} kopi.")
    amount = coffee_value(office) * coffees
    budget = office["budgets"]["rewards"]
    if E.budget_available(budget) < amount:
        raise DemoError("BUDGET", "The rewards budget for this office is not enough this month.",
                        "Anggaran reward kantor ini tidak cukup bulan ini.")
    voucher_id = E.new_id(state, "vc")
    code = "CC-" + E.short_code(voucher_id + member_key + str(now), 6)
    budget["spent"] += amount
    E.record_spend(state, now, office_id, "client_gift", amount, None,
                   f"Partner coffee for {member['name']} ({state['social']['companies'][member['company']]['name']})", voucher_id)
    state["vouchers"][voucher_id] = {
        "id": voucher_id,
        "code": code,
        "office": office_id,
        "country": office["country"],
        "city": city,
        "to": member_key,
        "to_name": member["name"],
        "to_company": member["company"],
        "coffees": coffees,
        "amount": amount,
        "message": " ".join(str(message or "").split())[:200],
        "issued": now,
        "expires": now + VOUCHER_DAYS * 86400,
        "status": "issued",
        "thanks": None,
    }
    return state["vouchers"][voucher_id]


def voucher_redeem(state, now, cafe_id, code):
    cafe = state["cafes"].get(cafe_id)
    code = str(code or "").strip().upper()
    voucher = next((item for item in state["vouchers"].values() if item["code"] == code), None)
    if voucher is None:
        raise DemoError("NOT_FOUND", "Voucher code not found.", "Kode voucher tidak ditemukan.")
    if voucher["status"] == "redeemed":
        raise DemoError("USED", "This voucher was already used.", "Voucher ini sudah dipakai.")
    if now > voucher["expires"]:
        voucher["status"] = "expired"
        raise DemoError("EXPIRED", "This voucher has expired.", "Voucher ini sudah kedaluwarsa.")
    if SOC.CAFE_CITY.get(cafe_id) != voucher["city"]:
        raise DemoError("WRONG_CITY", f"This voucher is valid at partner cafés in {voucher['city']}.",
                        f"Voucher ini berlaku di kafe mitra di {voucher['city']}.")
    voucher["status"] = "redeemed"
    voucher["redeemed"] = now
    voucher["cafe"] = cafe_id
    E.notify(state, "cafe:" + cafe_id, now,
             f"Voucher {code} redeemed: {E.fmt_money(voucher['country'], voucher['amount'])} for {voucher['to_name']}. Settled in your weekly payout.",
             f"Voucher {code} dipakai: {E.fmt_money(voucher['country'], voucher['amount'])} untuk {voucher['to_name']}. Dibayar di pencairan mingguan.",
             kind="ok")
    E.notify(state, "admin", now, f"{voucher['to_name']} used your coffee voucher at {cafe['name']}.",
             f"{voucher['to_name']} memakai voucher kopi Anda di {cafe['name']}.")
    return {"amount": voucher["amount"], "to": voucher["to_name"], "coffees": voucher["coffees"]}


# -- views & ticking -----------------------------------------------------------------------

def tick(state, now):
    if "reward_rules" not in state:
        return False
    changed = _due_rewards(state, now)
    for voucher in state["vouchers"].values():
        if voucher["status"] == "issued" and not voucher["thanks"] and now - voucher["issued"] >= PARTNER_REPLY_MIN * 60:
            voucher["thanks"] = "Thank you — that's very kind. See you at the café!"
            E.notify(state, "admin", now, f"{voucher['to_name']} thanked you for the coffee.",
                     f"{voucher['to_name']} berterima kasih atas kopinya.")
            changed = True
        if voucher["status"] == "issued" and now > voucher["expires"]:
            voucher["status"] = "expired"
            changed = True
    return changed


def employee_view(state, emp_id):
    """What an employee may see: their own rewards, the public recognition wall and their nominations."""
    emp = state["employees"][emp_id]
    mine = [item for item in state["rewards"] if item["emp"] == emp_id]
    wall = [item for item in state["rewards"] if item["public"] and state["employees"][item["emp"]]["office"] == emp["office"]]
    nominations = [item for item in state["nominations"].values() if item["by"] == emp_id]
    return {
        "mine": sorted(mine, key=lambda item: -item["ts"])[:20],
        "wall": _collapse(state, sorted(wall, key=lambda item: -item["ts"]))[:12],
        "nominations": sorted(nominations, key=lambda item: -item["ts"]),
        "birthday": {"on": emp["profile"].get("birthday_coffee", False), "date": emp.get("birthday")},
        "rules": state["reward_rules"],
        "coffee_value": coffee_value(state["offices"][emp["office"]]),
    }


def _collapse(state, rows):
    """One wall entry per reward batch (a team reward shows once)."""
    seen = {}
    for row in rows:
        entry = seen.get(row["batch"])
        if entry is None:
            seen[row["batch"]] = entry = dict(row, names=[], count=0)
        entry["names"].append(state["employees"][row["emp"]]["name"])
        entry["count"] += 1
    return list(seen.values())


def admin_view(state):
    pending = [item for item in state["nominations"].values() if item["status"] == "pending"]
    return {
        "recent": _collapse(state, sorted(state["rewards"], key=lambda item: -item["ts"]))[:20],
        "nominations": sorted(pending, key=lambda item: item["ts"]),
        "rules": state["reward_rules"],
        "vouchers": sorted(state["vouchers"].values(), key=lambda item: -item["issued"]),
    }
