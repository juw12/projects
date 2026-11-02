"""CrewCup loyalty: points, star tiers, coupons, café promotions, achievements and referrals.

Earning (only from real, completed activity):
- paid drink, reusable cup, joining a group run, doing a coffee run, sending a gift,
  a coffee chat with another company, joining a meetup, successful referrals, achievements.
- Activity points are multiplied by the member's star tier.

Spending:
- Points buy coupons in the rewards store (CrewCup-funded: the café is still paid in full).
- Cafés publish promotions that members claim as coupons (café-funded: the café accepts less).
- A coupon is applied to one of your own drinks when you order; it is released again if the
  line is removed before the café starts.
"""

from . import engine as E
from .engine import DemoError

TIERS = [
    # key, label, lifetime points needed, activity multiplier, stars
    ("bronze", "Bronze", 0, 1.0, 1),
    ("silver", "Silver", 500, 1.1, 2),
    ("gold", "Gold", 1500, 1.25, 3),
    ("platinum", "Platinum", 4000, 1.5, 4),
]

EARN = {
    "drink": 10,
    "reusable": 5,
    "group_run": 5,
    "runner_base": 20,
    "runner_per_cup": 2,
    "gift": 5,
    "chat": 15,
    "meetup": 10,
    "referral_company": 500,
    "referral_cafe": 300,
}

COUPON_DAYS = 30
PROMO_COUPON_DAYS = 7
REFERRAL_CONTACT_MIN = 3
REFERRAL_SIGNUP_MIN = 10
MAX_PENDING_REFERRALS = 5

# Coupon templates. Values are relative to one standard coffee in the member's country (V).
COUPON_TYPES = {
    "pct10": {"title": "10% off a drink", "kind": "percent", "pct": 10, "cap_coffees": 1.0},
    "pct20_offpeak": {"title": "20% off an off-peak drink", "kind": "percent", "pct": 20, "cap_coffees": 1.0, "offpeak_only": True},
    "amount": {"title": "{amount} off a drink", "kind": "amount", "coffees": 1 / 3},
    "upgrade": {"title": "Free size upgrade", "kind": "upgrade"},
    "free_drink": {"title": "Free drink (up to {amount})", "kind": "percent", "pct": 100, "cap_coffees": 1.0},
}

STORE = [
    {"id": "pct10", "points": 150},
    {"id": "upgrade", "points": 120},
    {"id": "amount", "points": 250},
    {"id": "free_drink", "points": 500},
    {"id": "donate_meal", "points": 300, "title": "Donate a meal through our charity partner"},
]

ACHIEVEMENTS = [
    # id, title, description, counter, target, reward
    ("first_cup", "First cup", "Place your first order through CrewCup", "drinks", 1, {"points": 50}),
    ("regular", "Regular", "Order 10 drinks", "drinks", 10, {"points": 100, "coupon": "pct10"}),
    ("connoisseur", "Connoisseur", "Order 50 drinks", "drinks", 50, {"points": 300, "coupon": "free_drink"}),
    ("own_cup", "Bring your own cup", "5 drinks in a reusable cup", "reusable", 5, {"points": 100, "coupon": "upgrade"}),
    ("explorer", "Café explorer", "Order from 3 different partner cafés", "cafes", 3, {"points": 100, "coupon": "amount"}),
    ("runner", "Team runner", "Do 3 coffee runs for your team", "runs", 3, {"points": 150, "coupon": "free_drink"}),
    ("early_bird", "Early bird", "3 orders for slots before 08:30", "early", 3, {"points": 80, "coupon": "pct20_offpeak"}),
    ("off_peak", "Off-peak pro", "3 orders in off-peak slots", "offpeak", 3, {"points": 80}),
    ("team_player", "Team player", "Join 5 group runs", "group_runs", 5, {"points": 100}),
    ("generous", "Generous", "Send 3 coffees to colleagues", "gifts", 3, {"points": 60}),
    ("connector", "Connector", "Have a coffee chat with someone from another company", "chats", 1, {"points": 50}),
    ("ambassador", "Ambassador", "Make one successful referral", "referrals", 1, {"points": 200, "coupon": "free_drink"}),
]

COUNTERS = ("drinks", "reusable", "early", "offpeak", "group_runs", "runs", "gifts", "chats", "meetups", "referrals")


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

def ensure(state):
    loyalty = state.setdefault("loyalty", {})
    loyalty.setdefault("accounts", {})
    loyalty.setdefault("coupons", {})
    loyalty.setdefault("promos", {})
    loyalty.setdefault("referrals", {})
    loyalty.setdefault("ledger", [])
    loyalty.setdefault("donations", {"meals": 0})
    for emp_id in state["employees"]:
        fresh = emp_id not in loyalty["accounts"]
        account(state, emp_id)
        if fresh:
            mark_existing_achievements(state, 0, emp_id)
    return loyalty


def account(state, emp_id):
    accounts = state["loyalty"]["accounts"]
    if emp_id not in accounts:
        emp = state["employees"][emp_id]
        accounts[emp_id] = {
            "points": 0,
            "lifetime": 0,
            "counters": {key: 0 for key in COUNTERS},
            "cafes": [],
            "achievements": {},
            "code": emp["name"].split()[0].upper()[:6] + "-" + E.short_code("ref" + emp_id, 3),
        }
        accounts[emp_id]["counters"]["runs"] = emp.get("runs_done", 0)
    acc = accounts[emp_id]
    for key in COUNTERS:
        acc["counters"].setdefault(key, 0)
    return acc


def tier_of(lifetime):
    current = TIERS[0]
    for tier in TIERS:
        if lifetime >= tier[2]:
            current = tier
    return current


def next_tier(lifetime):
    for tier in TIERS:
        if lifetime < tier[2]:
            return tier
    return None


def coffee_value(state, emp_id):
    return state["offices"][state["employees"][emp_id]["office"]]["karma_reward"]


def _country(state, emp_id):
    return state["offices"][state["employees"][emp_id]["office"]]["country"]


def award(state, now, emp_id, points, reason, multiply=True):
    """Add points (optionally scaled by tier) and handle tier upgrades. Returns points added."""
    if emp_id not in state["employees"]:
        return 0
    acc = account(state, emp_id)
    before = tier_of(acc["lifetime"])
    if multiply:
        points = int(round(points * before[3]))
    if points <= 0:
        return 0
    acc["points"] += points
    acc["lifetime"] += points
    state["loyalty"]["ledger"].append({"emp": emp_id, "ts": now, "points": points, "reason": reason})
    after = tier_of(acc["lifetime"])
    if after[0] != before[0]:
        issue_coupon(state, now, emp_id, "upgrade", source="tier", note=f"{after[1]} welcome gift")
        E.notify(state, emp_id, now,
                 f"You reached {after[1]} ({after[4]} stars): {after[3]}x points on every order, plus a free size upgrade.",
                 f"Anda mencapai {after[1]} ({after[4]} bintang): {after[3]}x poin setiap pesanan, plus gratis upgrade ukuran.",
                 kind="gift")
    return points


def _bump(state, now, emp_id, counter, amount=1):
    acc = account(state, emp_id)
    acc["counters"][counter] = acc["counters"].get(counter, 0) + amount
    _check_achievements(state, now, emp_id)


def mark_existing_achievements(state, now, emp_id):
    """Record achievements already met (e.g. after migration) without paying rewards again."""
    acc = account(state, emp_id)
    for ach_id, _title, _desc, counter, target, _reward in ACHIEVEMENTS:
        if ach_id not in acc["achievements"] and _counter_value(acc, counter) >= target:
            acc["achievements"][ach_id] = now


def _counter_value(acc, counter):
    if counter == "cafes":
        return len(acc["cafes"])
    return acc["counters"].get(counter, 0)


def _check_achievements(state, now, emp_id):
    acc = account(state, emp_id)
    unlocked = []
    for ach_id, title, _desc, counter, target, reward in ACHIEVEMENTS:
        if ach_id in acc["achievements"] or _counter_value(acc, counter) < target:
            continue
        acc["achievements"][ach_id] = now
        award(state, now, emp_id, reward.get("points", 0), f"Achievement: {title}", multiply=False)
        coupon_text = ""
        if reward.get("coupon"):
            coupon = issue_coupon(state, now, emp_id, reward["coupon"], source="achievement", note=title)
            coupon_text = f" and a coupon: {coupon['title']}"
        E.notify(state, emp_id, now,
                 f"Achievement unlocked: {title}. +{reward.get('points', 0)} points{coupon_text}.",
                 f"Pencapaian terbuka: {title}. +{reward.get('points', 0)} poin" + (" dan kupon." if coupon_text else "."),
                 kind="gift")
        unlocked.append(ach_id)
    return unlocked


# ---------------------------------------------------------------------------
# Earning hooks (called from engine / social)
# ---------------------------------------------------------------------------

def on_purchase(state, now, emp_id, run, line):
    if "loyalty" not in state or emp_id not in state["employees"]:
        return
    cafe = state["cafes"][run["cafe"]]
    acc = account(state, emp_id)
    points = EARN["drink"]
    reasons = ["drink"]
    if line["spec"].get("reusable"):
        points += EARN["reusable"]
        reasons.append("reusable cup")
        acc["counters"]["reusable"] += 1
    if run["kind"] == "group":
        points += EARN["group_run"]
        reasons.append("group run")
        acc["counters"]["group_runs"] += 1
    if line["price"].get("offpeak_pct"):
        acc["counters"]["offpeak"] += 1
    if E.hm(run["slot"], cafe) < "08:30":
        acc["counters"]["early"] += 1
    if run["cafe"] not in acc["cafes"]:
        acc["cafes"].append(run["cafe"])
    acc["counters"]["drinks"] += 1
    award(state, now, emp_id, points, "Order at " + cafe["name"] + " (" + ", ".join(reasons) + ")")
    _check_achievements(state, now, emp_id)


def on_run_done(state, now, emp_id, cups):
    if "loyalty" not in state:
        return
    award(state, now, emp_id, EARN["runner_base"] + EARN["runner_per_cup"] * cups, f"Coffee run ({cups} cups)")
    _bump(state, now, emp_id, "runs")


def on_gift(state, now, emp_id):
    if "loyalty" not in state:
        return
    award(state, now, emp_id, EARN["gift"], "Sent a coffee to a colleague")
    _bump(state, now, emp_id, "gifts")


def on_chat(state, now, emp_id):
    if "loyalty" not in state or emp_id not in state["employees"]:
        return
    award(state, now, emp_id, EARN["chat"], "Coffee chat with another company")
    _bump(state, now, emp_id, "chats")


def on_meetup(state, now, emp_id):
    if "loyalty" not in state:
        return
    award(state, now, emp_id, EARN["meetup"], "Joined a meetup")
    _bump(state, now, emp_id, "meetups")


# ---------------------------------------------------------------------------
# Coupons
# ---------------------------------------------------------------------------

def issue_coupon(state, now, emp_id, type_key, source="points", note="", cafe=None, funder="crewcup",
                 pct=None, amount=None, days=COUPON_DAYS, title=None, offpeak_only=None):
    template = COUPON_TYPES.get(type_key, {"kind": "percent", "pct": pct or 10})
    country = _country(state, emp_id)
    value = coffee_value(state, emp_id)
    kind = template["kind"]
    coupon = {
        "id": E.new_id(state, "cp"),
        "emp": emp_id,
        "type": type_key,
        "kind": kind,
        "pct": pct if pct is not None else template.get("pct"),
        "cap": int(value * template.get("cap_coffees", 1.0)) if kind == "percent" else None,
        "amount": None,
        "offpeak_only": bool(template.get("offpeak_only") if offpeak_only is None else offpeak_only),
        "cafe": cafe,
        "country": country,
        "source": source,
        "funder": funder,
        "note": note,
        "status": "active",
        "issued": now,
        "expires": now + days * 86400,
    }
    if kind == "amount":
        step = state["countries"][country]["round_to"]
        coupon["amount"] = amount if amount is not None else max(step, E.round_to(value * template.get("coffees", 1 / 3), step))
    shown = E.fmt_money(country, coupon["amount"] if kind == "amount" else (coupon["cap"] or value))
    coupon["title"] = title or template.get("title", "Discount").format(amount=shown)
    state["loyalty"]["coupons"][coupon["id"]] = coupon
    return coupon


def _price_after(price, new_gross):
    """Scale net/tax to a new gross keeping the tax treatment consistent."""
    old_gross = price["gross"]
    if old_gross <= 0:
        return
    if price["tax_inclusive"]:
        tax = E.round_to(new_gross - new_gross / (1 + price["tax_rate"]), 1)
        price["net"] = new_gross - tax
        price["tax"] = tax
    else:
        net = int(round(price["net"] * new_gross / old_gross))
        price["net"] = net
        price["tax"] = new_gross - net
    price["gross"] = new_gross


def apply_coupon(state, now, emp_id, coupon_id, cafe, spec, price, slot_ts):
    """Validate a coupon for this drink and discount `price` in place. Does not consume it."""
    coupon = state["loyalty"]["coupons"].get(coupon_id)
    if not coupon or coupon["emp"] != emp_id:
        raise DemoError("COUPON", "That coupon isn't in your wallet.", "Kupon itu tidak ada di dompet Anda.")
    if coupon["status"] != "active":
        raise DemoError("COUPON_USED", "That coupon was already used or has expired.", "Kupon itu sudah dipakai atau kedaluwarsa.")
    if now > coupon["expires"]:
        coupon["status"] = "expired"
        raise DemoError("COUPON_USED", "That coupon has expired.", "Kupon itu sudah kedaluwarsa.")
    if coupon["country"] != cafe["country"]:
        raise DemoError("COUPON_COUNTRY", "This coupon is for another country.", "Kupon ini untuk negara lain.")
    if coupon["cafe"] and coupon["cafe"] != cafe["id"]:
        raise DemoError("COUPON_CAFE", f"This coupon is only valid at {state['cafes'][coupon['cafe']]['name']}.",
                        f"Kupon ini hanya berlaku di {state['cafes'][coupon['cafe']]['name']}.")
    if coupon["offpeak_only"] and E.is_peak(cafe, slot_ts):
        raise DemoError("COUPON_PEAK", "This coupon is for off-peak slots only — pick a quieter time.",
                        "Kupon ini hanya untuk slot sepi — pilih waktu lain.")
    gross = price["gross"]
    if coupon["kind"] == "percent":
        discount = E.round_to(gross * coupon["pct"] / 100, 1)
        if coupon["cap"]:
            discount = min(discount, coupon["cap"])
    elif coupon["kind"] == "amount":
        discount = coupon["amount"]
    else:  # upgrade
        item = cafe["menu"][spec["item"]]
        if not item["sizes"] or spec.get("size") != "L":
            raise DemoError("COUPON_SIZE", "Choose size L to use the free upgrade.", "Pilih ukuran L untuk memakai gratis upgrade.")
        discount = cafe["size_prices"]["L"]
    discount = max(0, min(int(discount), gross))
    _price_after(price, gross - discount)
    price["coupon"] = discount
    price["coupon_id"] = coupon_id
    price["coupon_title"] = coupon["title"]
    price["coupon_funder"] = coupon["funder"]
    return discount


def consume_coupon(state, now, coupon_id, run_id, line_id):
    coupon = state["loyalty"]["coupons"][coupon_id]
    coupon["status"] = "used"
    coupon["used"] = now
    coupon["run"] = run_id
    coupon["line"] = line_id


def release_coupon(state, line):
    coupon_id = line.get("price", {}).get("coupon_id")
    coupon = state.get("loyalty", {}).get("coupons", {}).get(coupon_id) if coupon_id else None
    if coupon and coupon["status"] == "used" and coupon.get("line") == line["id"]:
        coupon["status"] = "active"
        coupon.pop("used", None)


def cafe_subsidy(line):
    """CrewCup-funded coupons are topped up so the café is paid its full price."""
    price = line["price"]
    return price.get("coupon", 0) if price.get("coupon_funder") == "crewcup" else 0


# ---------------------------------------------------------------------------
# Store, promotions, referrals
# ---------------------------------------------------------------------------

def redeem(state, now, emp_id, item_id):
    item = next((row for row in STORE if row["id"] == item_id), None)
    if item is None:
        raise DemoError("NOT_FOUND", "Unknown reward.", "Hadiah tidak dikenal.")
    acc = account(state, emp_id)
    if acc["points"] < item["points"]:
        raise DemoError("POINTS", f"You need {item['points']} points (you have {acc['points']}).",
                        f"Butuh {item['points']} poin (Anda punya {acc['points']}).")
    acc["points"] -= item["points"]
    state["loyalty"]["ledger"].append({"emp": emp_id, "ts": now, "points": -item["points"], "reason": "Redeemed: " + item_id})
    if item_id == "donate_meal":
        state["loyalty"]["donations"]["meals"] += 1
        E.notify(state, emp_id, now, "Thank you — one meal donated through our charity partner.",
                 "Terima kasih — satu makanan didonasikan melalui mitra amal kami.", kind="ok")
        return {"donated": True, "points": acc["points"]}
    coupon = issue_coupon(state, now, emp_id, item_id, source="points")
    return {"coupon": coupon["id"], "title": coupon["title"], "points": acc["points"]}


def promo_create(state, now, cafe_id, title, kind, value, offpeak_only=False, max_claims=50, days=7):
    cafe = state["cafes"][cafe_id]
    title = " ".join(str(title or "").split())[:60]
    if len(title) < 4:
        raise DemoError("TITLE", "Give the promotion a short title.", "Beri judul singkat untuk promo.")
    if kind not in ("percent", "amount"):
        raise DemoError("KIND", "Choose percent or amount off.", "Pilih persen atau nominal potongan.")
    value = int(value)
    if kind == "percent" and not 5 <= value <= 50:
        raise DemoError("VALUE", "Percent off must be between 5 and 50.", "Persen potongan harus 5 sampai 50.")
    if kind == "amount" and value <= 0:
        raise DemoError("VALUE", "Enter an amount.", "Masukkan nominal.")
    promo_id = E.new_id(state, "pr")
    state["loyalty"]["promos"][promo_id] = {
        "id": promo_id,
        "cafe": cafe_id,
        "country": cafe["country"],
        "title": title,
        "kind": kind,
        "value": value,
        "offpeak_only": bool(offpeak_only),
        "max_claims": max(1, min(1000, int(max_claims))),
        "claims": [],
        "redeemed": 0,
        "created": now,
        "expires": now + max(1, min(60, int(days))) * 86400,
        "active": True,
    }
    return state["loyalty"]["promos"][promo_id]


def promo_claim(state, now, emp_id, promo_id):
    promo = state["loyalty"]["promos"].get(promo_id)
    if not promo or not promo["active"] or now > promo["expires"]:
        raise DemoError("PROMO", "That promotion has ended.", "Promo itu sudah berakhir.")
    if promo["country"] != _country(state, emp_id):
        raise DemoError("PROMO", "That promotion is in another country.", "Promo itu di negara lain.")
    if emp_id in promo["claims"]:
        raise DemoError("CLAIMED", "You already claimed this promotion.", "Anda sudah mengambil promo ini.")
    if len(promo["claims"]) >= promo["max_claims"]:
        raise DemoError("PROMO_FULL", "All coupons for this promotion are taken.", "Semua kupon promo ini sudah habis.")
    promo["claims"].append(emp_id)
    cafe = state["cafes"][promo["cafe"]]
    if promo["kind"] == "percent":
        coupon = issue_coupon(state, now, emp_id, "promo", source="cafe_promo", cafe=promo["cafe"], funder="cafe:" + promo["cafe"],
                              pct=promo["value"], days=PROMO_COUPON_DAYS, title=f"{promo['title']} — {cafe['name']}",
                              offpeak_only=promo["offpeak_only"])
        coupon["kind"] = "percent"
        coupon["cap"] = None
    else:
        coupon = issue_coupon(state, now, emp_id, "amount", source="cafe_promo", cafe=promo["cafe"], funder="cafe:" + promo["cafe"],
                              amount=promo["value"], days=PROMO_COUPON_DAYS, title=f"{promo['title']} — {cafe['name']}",
                              offpeak_only=promo["offpeak_only"])
    coupon["promo"] = promo_id
    return coupon


def refer(state, now, emp_id, kind, name, contact):
    if kind not in ("company", "cafe"):
        raise DemoError("KIND", "Refer a company or a café.", "Rekomendasikan perusahaan atau kafe.")
    name = " ".join(str(name or "").split())[:60]
    contact = str(contact or "").strip()[:80]
    if len(name) < 3:
        raise DemoError("NAME", "Enter the company or café name.", "Masukkan nama perusahaan atau kafe.")
    if "@" not in contact or "." not in contact.split("@")[-1]:
        raise DemoError("CONTACT", "Enter a work email for the person to contact.", "Masukkan email kerja orang yang dihubungi.")
    referrals = state["loyalty"]["referrals"]
    lowered = name.lower()
    if any(item["name"].lower() == lowered for item in referrals.values()) or \
            any(company["name"].lower() == lowered for company in state.get("social", {}).get("companies", {}).values()) or \
            any(cafe["name"].lower() == lowered for cafe in state["cafes"].values()):
        raise DemoError("DUPLICATE", "That one is already on CrewCup or was already referred.",
                        "Itu sudah ada di CrewCup atau sudah direkomendasikan.")
    pending = [item for item in referrals.values() if item["by"] == emp_id and item["status"] in ("sent", "contacted")]
    if len(pending) >= MAX_PENDING_REFERRALS:
        raise DemoError("LIMIT", f"You have {MAX_PENDING_REFERRALS} referrals in progress already.",
                        f"Anda sudah punya {MAX_PENDING_REFERRALS} rekomendasi yang sedang diproses.")
    ref_id = E.new_id(state, "rf")
    referrals[ref_id] = {"id": ref_id, "by": emp_id, "kind": kind, "name": name, "contact": contact,
                         "status": "sent", "ts": now, "updated": now, "points": 0}
    return referrals[ref_id]


def tick(state, now):
    if "loyalty" not in state:
        return False
    changed = False
    for coupon in state["loyalty"]["coupons"].values():
        if coupon["status"] == "active" and now > coupon["expires"]:
            coupon["status"] = "expired"
            changed = True
    for item in state["loyalty"]["referrals"].values():
        if item["status"] == "sent" and now - item["ts"] >= REFERRAL_CONTACT_MIN * 60:
            item["status"] = "contacted"
            item["updated"] = now
            changed = True
        if item["status"] == "contacted" and now - item["ts"] >= REFERRAL_SIGNUP_MIN * 60:
            item["status"] = "joined"
            item["updated"] = now
            points = EARN["referral_company"] if item["kind"] == "company" else EARN["referral_cafe"]
            item["points"] = award(state, now, item["by"], points, f"Referral joined: {item['name']}", multiply=False)
            E.notify(state, item["by"], now,
                     f"{item['name']} joined CrewCup through your referral. +{item['points']} points.",
                     f"{item['name']} bergabung dengan CrewCup lewat rekomendasi Anda. +{item['points']} poin.", kind="gift")
            _bump(state, now, item["by"], "referrals")
            changed = True
    return changed


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

def _tier_view(lifetime):
    tier = tier_of(lifetime)
    upcoming = next_tier(lifetime)
    return {
        "key": tier[0], "label": tier[1], "multiplier": tier[3], "stars": tier[4],
        "next": None if upcoming is None else {"label": upcoming[1], "needed": upcoming[2] - lifetime, "at": upcoming[2]},
        "floor": tier[2],
    }


def employee_view(state, emp_id, now):
    acc = account(state, emp_id)
    loyalty = state["loyalty"]
    country = _country(state, emp_id)
    city_cafes = {cafe_id for cafe_id, cafe in state["cafes"].items() if cafe["country"] == country}
    coupons = [coupon for coupon in loyalty["coupons"].values() if coupon["emp"] == emp_id]
    coupons.sort(key=lambda item: (item["status"] != "active", item["expires"]))
    achievements = []
    for ach_id, title, desc, counter, target, reward in ACHIEVEMENTS:
        achievements.append({
            "id": ach_id, "title": title, "desc": desc, "target": target,
            "progress": min(target, _counter_value(acc, counter)), "unlocked": acc["achievements"].get(ach_id),
            "reward": reward,
        })
    promos = [dict(promo, claimed=emp_id in promo["claims"], left=promo["max_claims"] - len(promo["claims"]))
              for promo in loyalty["promos"].values()
              if promo["active"] and promo["cafe"] in city_cafes and now <= promo["expires"]]
    for promo in promos:
        promo.pop("claims", None)
    value = coffee_value(state, emp_id)
    store = []
    for row in STORE:
        template = COUPON_TYPES.get(row["id"], {})
        if row["id"] == "amount":
            step = state["countries"][country]["round_to"]
            title = template["title"].format(amount=E.fmt_money(country, max(step, E.round_to(value / 3, step))))
        elif row["id"] == "free_drink":
            title = template["title"].format(amount=E.fmt_money(country, value))
        else:
            title = row.get("title") or template.get("title", row["id"])
        store.append({"id": row["id"], "points": row["points"], "title": title})
    return {
        "points": acc["points"],
        "lifetime": acc["lifetime"],
        "tier": _tier_view(acc["lifetime"]),
        "tiers": [{"key": tier[0], "label": tier[1], "at": tier[2], "multiplier": tier[3], "stars": tier[4]} for tier in TIERS],
        "coupons": coupons[:30],
        "achievements": achievements,
        "store": store,
        "promos": sorted(promos, key=lambda item: item["expires"]),
        "referrals": sorted((item for item in loyalty["referrals"].values() if item["by"] == emp_id), key=lambda item: -item["ts"]),
        "code": acc["code"],
        "ledger": [row for row in reversed(loyalty["ledger"]) if row["emp"] == emp_id][:15],
        "earn": EARN,
        "donations": loyalty["donations"]["meals"],
    }


def cafe_view(state, cafe_id, now):
    loyalty = state["loyalty"]
    promos = [dict(promo, claimed=len(promo["claims"])) for promo in loyalty["promos"].values() if promo["cafe"] == cafe_id]
    for promo in promos:
        promo.pop("claims", None)
        promo["redeemed"] = sum(1 for coupon in loyalty["coupons"].values()
                                if coupon.get("promo") == promo["id"] and coupon["status"] == "used")
    subsidised = [coupon for coupon in loyalty["coupons"].values()
                  if coupon["status"] == "used" and coupon["funder"] == "crewcup" and coupon.get("run")
                  and state["runs"].get(coupon["run"], {}).get("cafe") == cafe_id]
    return {"promos": sorted(promos, key=lambda item: -item["created"]), "subsidised_coupons": len(subsidised)}


def admin_view(state):
    loyalty = state["loyalty"]
    members = {tier[0]: 0 for tier in TIERS}
    outstanding = 0
    for emp_id, acc in loyalty["accounts"].items():
        if not state["employees"].get(emp_id, {}).get("active", False):
            continue
        members[tier_of(acc["lifetime"])[0]] += 1
        outstanding += acc["points"]
    coupons = list(loyalty["coupons"].values())
    return {
        "members": members,
        "points_outstanding": outstanding,
        "coupons_active": sum(1 for coupon in coupons if coupon["status"] == "active"),
        "coupons_used": sum(1 for coupon in coupons if coupon["status"] == "used"),
        "referrals_joined": sum(1 for item in loyalty["referrals"].values() if item["status"] == "joined"),
        "meals_donated": loyalty["donations"]["meals"],
    }
