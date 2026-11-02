"""Demo data: PT Nusantara Digital, HQ in Jakarta (SCBD) plus offices across SEA.

All companies, people, cafés and prices are fictional.
"""

from datetime import datetime, timezone

from . import config as C
from . import engine as E
from . import loyalty as L
from . import rewards as R
from .social_seed import build_social

# Monday 2 Nov 2026, 08:20 in Jakarta (WIB, UTC+7).
DEMO_START = int(datetime(2026, 11, 2, 1, 20, tzinfo=timezone.utc).timestamp())

PEAK = [["08:40", "09:30"], ["12:00", "13:10"]]


def item(item_id, name, name_id, price, cat="coffee", allergens=None, milk=None, temps=("hot", "iced"),
         sizes=True, sugar=True, halal=True, aliases=()):
    return item_id, {
        "id": item_id,
        "name": name,
        "name_id": name_id,
        "price": price,
        "cat": cat,
        "allergens": list(allergens or []),
        "milk": milk,
        "temps": list(temps),
        "sizes": sizes,
        "sugar": sugar,
        "halal": halal,
        "aliases": list(aliases),
    }


def history(peaks):
    base = {"07:30": 2, "08:00": 4, "08:30": 7, "09:00": 10, "09:30": 7, "10:00": 4, "11:00": 3,
            "12:00": 8, "12:30": 9, "13:00": 6, "14:00": 3, "15:00": 6, "16:00": 4}
    return {key: max(0, round(value * peaks)) for key, value in base.items()}


def make_cafe(cafe_id, name, country, area, walk_min, menu_items, milk_prices, size_l, reusable,
              capacity=8, throughput=1.5, base_prep=2, offpeak=10, perk=5, rating=4.6,
              tax_id="", bank="", history_scale=1.0):
    return {
        "id": cafe_id,
        "name": name,
        "country": country,
        "tz_min": C.COUNTRIES[country]["tz_min"],
        "area": area,
        "walk_min": walk_min,
        "menu": dict(menu_items),
        "milk_prices": milk_prices,
        "size_prices": {"R": 0, "L": size_l},
        "reusable_discount": reusable,
        "capacity_per_slot": capacity,
        "slot_min": 10,
        "throughput_per_min": throughput,
        "base_prep_min": base_prep,
        "peak": PEAK,
        "offpeak_discount_pct": offpeak,
        "company_perk_pct": {"co_nusantara": perk},
        "stock": {},
        "external_load": {},
        "partner": True,
        "rating": rating,
        "tax_id": tax_id,
        "bank": bank,
        "pos": "Moka POS" if country == "ID" else "Square",
        "quality": {"lines": 0, "flagged": 0},
        "history": history(history_scale),
    }


def build_cafes():
    jakarta_milk = {"fresh": 0, "oat": 8000, "soy": 5000, "almond": 8000}
    cafes = {}
    cafes["c_senja"] = make_cafe(
        "c_senja", "Kopi Senja SCBD", "ID", "SCBD, Jakarta", {"o_jkt": 4},
        [
            item("kopi_aren", "Iced Palm Sugar Milk Coffee", "Es Kopi Susu Gula Aren", 28000, milk="fresh", temps=("iced",),
                 aliases=("kopi susu", "kopi aren", "gula aren", "palm sugar")),
            item("americano", "Americano", "Americano", 25000, aliases=("americano", "long black")),
            item("latte", "Café Latte", "Kafe Latte", 32000, milk="fresh", aliases=("latte",)),
            item("cappuccino", "Cappuccino", "Cappuccino", 32000, milk="fresh", temps=("hot",), aliases=("cappuccino", "capucino", "cappucino")),
            item("pandan_latte", "Pandan Latte", "Pandan Latte", 34000, milk="fresh", aliases=("pandan",)),
            item("kopi_tubruk", "Kopi Tubruk (black)", "Kopi Tubruk", 18000, temps=("hot",), sizes=False, aliases=("tubruk", "kopi hitam", "black coffee")),
            item("matcha", "Matcha Latte", "Matcha Latte", 35000, cat="tea", milk="fresh", aliases=("matcha",)),
            item("teh_manis", "Sweet Tea", "Es Teh Manis", 12000, cat="tea", temps=("iced", "hot"), sizes=False, aliases=("teh manis", "es teh", "sweet tea")),
            item("rum_latte", "Rum Raisin Latte", "Rum Raisin Latte", 38000, milk="fresh", halal=False, aliases=("rum",)),
            item("croissant", "Butter Croissant", "Croissant Mentega", 25000, cat="food", allergens=("gluten", "dairy"), temps=("hot",), sizes=False, sugar=False, aliases=("croissant",)),
            item("pisang_goreng", "Fried Banana", "Pisang Goreng", 15000, cat="food", allergens=("gluten",), temps=("hot",), sizes=False, sugar=False, aliases=("pisang goreng", "fried banana")),
        ],
        jakarta_milk, 6000, 2000, capacity=8, throughput=1.5, offpeak=10, perk=5, rating=4.7,
        tax_id="NPWP 01.234.567.8-011.000", bank="BCA •••• 2201", history_scale=1.0,
    )
    cafes["c_seduh"] = make_cafe(
        "c_seduh", "Ruang Seduh", "ID", "Sudirman, Jakarta", {"o_jkt": 7},
        [
            item("v60", "V60 Pour Over", "Kopi Seduh V60", 35000, temps=("hot", "iced"), sizes=False, sugar=False, aliases=("v60", "pour over", "manual brew", "seduh")),
            item("latte", "Café Latte", "Kafe Latte", 33000, milk="fresh", aliases=("latte",)),
            item("americano", "Americano", "Americano", 27000, aliases=("americano",)),
            item("kopi_aren", "Iced Palm Sugar Milk Coffee", "Es Kopi Susu Gula Aren", 30000, milk="fresh", temps=("iced",), aliases=("kopi susu", "kopi aren", "gula aren")),
            item("cokelat", "Chocolate", "Cokelat", 30000, cat="other", milk="fresh", aliases=("chocolate", "cokelat", "coklat")),
            item("banana_bread", "Banana Bread", "Roti Pisang", 28000, cat="food", allergens=("gluten", "dairy", "nuts"), temps=("hot",), sizes=False, sugar=False, aliases=("banana bread",)),
        ],
        jakarta_milk, 7000, 3000, capacity=6, throughput=1.0, offpeak=15, perk=0, rating=4.8,
        tax_id="NPWP 02.345.678.9-012.000", bank="Mandiri •••• 7781", history_scale=0.7,
    )
    cafes["c_aren"] = make_cafe(
        "c_aren", "Kedai Aren Sudirman", "ID", "Sudirman, Jakarta", {"o_jkt": 10},
        [
            item("kopi_aren", "Iced Palm Sugar Milk Coffee", "Es Kopi Susu Gula Aren", 22000, milk="fresh", temps=("iced",), aliases=("kopi susu", "kopi aren", "gula aren")),
            item("klepon", "Klepon Milk Coffee", "Es Kopi Susu Klepon", 26000, milk="fresh", temps=("iced",), aliases=("klepon",)),
            item("americano", "Americano", "Americano", 20000, aliases=("americano",)),
            item("latte", "Café Latte", "Kafe Latte", 26000, milk="fresh", aliases=("latte",)),
            item("teh_manis", "Sweet Tea", "Es Teh Manis", 10000, cat="tea", temps=("iced", "hot"), sizes=False, aliases=("teh manis", "es teh")),
        ],
        jakarta_milk, 5000, 2000, capacity=10, throughput=2.0, offpeak=5, perk=10, rating=4.4,
        tax_id="NPWP 03.456.789.0-013.000", bank="BRI •••• 4410", history_scale=1.3,
    )
    cafes["c_bsd"] = make_cafe(
        "c_bsd", "Teras Kopi BSD", "ID", "BSD City, Tangerang (near Rizky's home)", {"home:e_rizky": 5},
        [
            item("kopi_aren", "Iced Palm Sugar Milk Coffee", "Es Kopi Susu Gula Aren", 25000, milk="fresh", temps=("iced",), aliases=("kopi susu", "kopi aren", "gula aren")),
            item("latte", "Café Latte", "Kafe Latte", 30000, milk="fresh", aliases=("latte",)),
            item("americano", "Americano", "Americano", 23000, aliases=("americano",)),
        ],
        jakarta_milk, 5000, 2000, capacity=6, throughput=1.2, offpeak=10, perk=5, rating=4.5,
        tax_id="NPWP 04.567.890.1-014.000", bank="BCA •••• 9902", history_scale=0.5,
    )
    cafes["c_sg"] = make_cafe(
        "c_sg", "Tanjong Brew", "SG", "Marina Bay, Singapore", {"o_sg": 5},
        [
            item("flat_white", "Flat White", "Flat White", 650, milk="fresh", temps=("hot",), aliases=("flat white",)),
            item("long_black", "Long Black", "Long Black", 550, aliases=("long black", "americano")),
            item("latte", "Latte", "Latte", 700, milk="fresh", aliases=("latte",)),
            item("kopi_o", "Kopi O", "Kopi O", 220, temps=("hot", "iced"), sizes=False, aliases=("kopi o", "kopi-o")),
            item("teh_tarik", "Teh Tarik", "Teh Tarik", 250, cat="tea", allergens=("dairy",), sizes=False, aliases=("teh tarik",)),
            item("kaya_toast", "Kaya Toast", "Roti Kaya", 350, cat="food", allergens=("gluten", "dairy", "eggs"), temps=("hot",), sizes=False, sugar=False, aliases=("kaya", "toast")),
        ],
        {"fresh": 0, "oat": 80, "soy": 50, "almond": 80}, 100, 30, capacity=10, throughput=2.0,
        tax_id="GST Reg M2-0123456-7", bank="DBS •••• 1180",
    )
    cafes["c_kl"] = make_cafe(
        "c_kl", "Kopi Bangsar", "MY", "Bangsar South, Kuala Lumpur", {"o_kl": 4},
        [
            item("kopi_ais", "Kopi Ais", "Kopi Ais", 550, allergens=("dairy",), temps=("iced",), sizes=False, aliases=("kopi ais", "kopi")),
            item("teh_tarik", "Teh Tarik", "Teh Tarik", 450, cat="tea", allergens=("dairy",), sizes=False, aliases=("teh tarik",)),
            item("latte", "Latte", "Latte", 1200, milk="fresh", aliases=("latte",)),
            item("americano", "Americano", "Americano", 1000, aliases=("americano",)),
            item("nasi_lemak", "Nasi Lemak", "Nasi Lemak", 800, cat="food", allergens=("nuts", "fish"), temps=("hot",), sizes=False, sugar=False, aliases=("nasi lemak",)),
        ],
        {"fresh": 0, "oat": 200, "soy": 150, "almond": 200}, 200, 50,
        tax_id="SST W10-1808-32000123", bank="Maybank •••• 5521",
    )
    cafes["c_bkk"] = make_cafe(
        "c_bkk", "Sukhumvit Roasters", "TH", "Asok, Bangkok", {"o_bkk": 3},
        [
            item("thai_tea", "Thai Iced Tea", "Cha Yen", 6500, cat="tea", allergens=("dairy",), temps=("iced",), sizes=True, aliases=("thai tea", "cha yen")),
            item("oliang", "Oliang", "Oliang", 4500, temps=("iced",), aliases=("oliang",)),
            item("americano", "Americano", "Americano", 7000, aliases=("americano",)),
            item("latte", "Latte", "Latte", 8000, milk="fresh", aliases=("latte",)),
        ],
        {"fresh": 0, "oat": 2000, "soy": 1500, "almond": 2000}, 1500, 500,
        tax_id="VAT 0105561234567", bank="KBank •••• 3390",
    )
    cafes["c_mnl"] = make_cafe(
        "c_mnl", "Makati Grind", "PH", "Ayala, Makati", {"o_mnl": 5},
        [
            item("spanish_latte", "Spanish Latte", "Spanish Latte", 16500, milk="fresh", aliases=("spanish latte",)),
            item("americano", "Americano", "Americano", 12000, aliases=("americano",)),
            item("barako", "Kapeng Barako", "Kapeng Barako", 9000, temps=("hot",), sizes=False, aliases=("barako",)),
            item("ensaymada", "Ensaymada", "Ensaymada", 7500, cat="food", allergens=("gluten", "dairy", "eggs"), temps=("hot",), sizes=False, sugar=False, aliases=("ensaymada",)),
        ],
        {"fresh": 0, "oat": 3000, "soy": 2000, "almond": 3000}, 2500, 1000,
        tax_id="TIN 123-456-789-000", bank="BPI •••• 7720",
    )
    cafes["c_hcm"] = make_cafe(
        "c_hcm", "Saigon Phin", "VN", "District 1, Ho Chi Minh City", {"o_hcm": 4},
        [
            item("ca_phe_sua_da", "Iced Milk Coffee", "Cà phê sữa đá", 29000, allergens=("dairy",), temps=("iced", "hot"), aliases=("ca phe sua da", "sua da", "milk coffee")),
            item("bac_xiu", "Bạc Xỉu", "Bạc xỉu", 35000, allergens=("dairy",), temps=("iced",), aliases=("bac xiu",)),
            item("ca_phe_muoi", "Salt Coffee", "Cà phê muối", 39000, allergens=("dairy",), temps=("iced",), aliases=("salt coffee", "ca phe muoi")),
            item("americano", "Americano", "Americano", 35000, aliases=("americano",)),
            item("banh_mi", "Bánh Mì", "Bánh mì", 30000, cat="food", allergens=("gluten",), temps=("hot",), sizes=False, sugar=False, aliases=("banh mi",)),
        ],
        {"fresh": 0, "oat": 10000, "soy": 8000, "almond": 10000}, 8000, 3000,
        tax_id="MST 0312345678", bank="Vietcombank •••• 6630",
    )
    return cafes


def make_office(office_id, name, building, country, lobby_point, courier_upstairs, floors, rooms, pantry,
                allowance, meeting, kudos, roulette, catering_threshold, karma_reward, iftar_hm):
    return {
        "id": office_id,
        "name": name,
        "building": building,
        "country": country,
        "tz_min": C.COUNTRIES[country]["tz_min"],
        "lobby_point": lobby_point,
        "courier_upstairs": courier_upstairs,
        "floors": floors,
        "rooms": rooms,
        "pantry": pantry,
        "allowance_daily": allowance,
        "budgets": {
            "meeting": {"limit": meeting, "spent": 0, "held": {}},
            "kudos": {"limit": kudos, "spent": 0, "held": {}},
            "roulette": {"limit": roulette, "spent": 0, "held": {}},
        },
        "catering_threshold": catering_threshold,
        "karma_reward": karma_reward,
        "iftar_hm": iftar_hm,
    }


def build_offices():
    return {
        "o_jkt": make_office("o_jkt", "Jakarta HQ", "Menara Sudirman, SCBD", "ID",
                             "Lobby B courier drop counter (couriers can't go upstairs)", False,
                             ["18F", "19F"], ["Ruang Merapi (18F)", "Ruang Bromo (19F)"], "18F pantry shelf",
                             25000, 3000000, 1000000, 1000000, 1500000, 30000, "17:50"),
        "o_sg": make_office("o_sg", "Singapore", "Marina One East Tower", "SG", "Level 1 concierge", True,
                            ["L21"], ["Merlion Room (L21)"], "L21 pantry", 600, 50000, 20000, 20000, 30000, 600, "19:05"),
        "o_kl": make_office("o_kl", "Kuala Lumpur", "The Vertical, Bangsar South", "MY", "Ground floor guardhouse", False,
                            ["12F"], ["Bilik Langkawi (12F)"], "12F pantry", 800, 60000, 20000, 20000, 40000, 800, "19:20"),
        "o_bkk": make_office("o_bkk", "Bangkok", "Asok Tower, Sukhumvit", "TH", "Lobby reception", True,
                             ["25F"], ["Chao Phraya Room (25F)"], "25F pantry", 8000, 600000, 200000, 200000, 400000, 8000, "18:05"),
        "o_mnl": make_office("o_mnl", "Manila", "Ayala Triangle Tower, Makati", "PH", "Lobby security desk", False,
                             ["30F"], ["Boracay Room (30F)"], "30F pantry", 15000, 1000000, 300000, 300000, 600000, 15000, "17:40"),
        "o_hcm": make_office("o_hcm", "Ho Chi Minh City", "Bitexco, District 1", "VN", "Ground floor reception", False,
                             ["40F"], ["Mekong Room (40F)"], "40F pantry", 40000, 3000000, 1000000, 1000000, 2000000, 35000, "17:40"),
    }


def build_employees():
    weekdays = [0, 1, 2, 3, 4]
    people = {}

    def add(emp_id, name, team, office_id, floor, desk, badge, wallet, profile=None, office_days=None, role="employee",
            runs=0, karma=0, home_cafe=None):
        emp = E.make_employee(emp_id, name, f"{emp_id[2:]}@nusantara.co.id", team, office_id, floor, desk, badge,
                              office_days if office_days is not None else weekdays, wallet, role=role, profile=profile)
        emp["runs_done"] = runs
        emp["karma"] = karma
        emp["home_cafe"] = home_cafe
        usual = emp["profile"].get("usual")
        if usual:
            emp["last_spec"] = dict(usual["spec"])
            emp["last_cafe"] = usual["cafe"]
        people[emp_id] = emp

    add("e_andi", "Andi Pratama", "Engineering", "o_jkt", "18F", "A-12", "NDG-1001", 150000,
        {"usual": {"cafe": "c_senja", "spec": {"item": "kopi_aren", "size": "L", "sugar": 50}}}, runs=3, karma=40)
    add("e_sari", "Sari Wulandari", "Design", "o_jkt", "18F", "B-03", "NDG-1002", 120000,
        {"allergies": ["dairy"], "halal_only": True, "milk_pref": "oat", "reusable": True, "fallback": "ask",
         "subs": {"oat": ["soy", "almond"], "soy": ["oat", "almond"], "almond": ["oat", "soy"]},
         "usual": {"cafe": "c_senja", "spec": {"item": "latte", "milk": "oat", "temp": "iced", "sugar": 50}}}, runs=1, karma=15)
    add("e_budi", "Budi Santoso", "Engineering", "o_jkt", "18F", "A-15", "NDG-1003", 100000,
        {"fasting": True, "halal_only": True, "usual": {"cafe": "c_senja", "spec": {"item": "americano", "temp": "iced", "sugar": 0}}}, runs=2, karma=25)
    add("e_dewi", "Dewi Lestari", "Operations", "o_jkt", "19F", "C-01", "NDG-1004", 200000,
        {"usual": {"cafe": "c_senja", "spec": {"item": "cappuccino", "sugar": 0}}}, role="admin", runs=1, karma=10)
    add("e_rizky", "Rizky Hidayat", "Engineering", "o_jkt", "18F", "hot desk", "NDG-1005", 80000,
        {"usual": {"cafe": "c_senja", "spec": {"item": "kopi_aren", "sugar": 75}}}, office_days=[1, 3], runs=0, karma=0, home_cafe="c_bsd")
    add("e_putri", "Putri Anggraini", "Marketing", "o_jkt", "19F", "D-07", "NDG-1006", 180000,
        {"usual": {"cafe": "c_seduh", "spec": {"item": "latte", "temp": "hot", "sugar": 50}}}, runs=9, karma=120)
    add("e_fajar", "Fajar Nugroho", "Sales", "o_jkt", "19F", "E-02", "NDG-1007", 20000,
        {"allergies": ["nuts"], "subs": {"oat": ["soy", "fresh"], "fresh": ["oat"]},
         "usual": {"cafe": "c_senja", "spec": {"item": "kopi_aren", "ice": "less", "sugar": 75}}}, runs=0, karma=0)
    add("e_maya", "Maya Siregar", "Finance", "o_jkt", "19F", "F-10", "NDG-1008", 150000,
        {"usual": {"cafe": "c_seduh", "spec": {"item": "americano", "temp": "hot", "sugar": 0}}}, runs=6, karma=70)
    add("e_weiling", "Tan Wei Ling", "Engineering", "o_sg", "L21", "21-08", "NDG-2001", 3000,
        {"milk_pref": "oat", "usual": {"cafe": "c_sg", "spec": {"item": "flat_white", "milk": "oat"}}}, runs=2, karma=20)
    add("e_arjun", "Arjun Menon", "Sales", "o_sg", "L21", "21-14", "NDG-2002", 2500,
        {"usual": {"cafe": "c_sg", "spec": {"item": "kopi_o", "temp": "iced", "sugar": 0}}}, runs=1, karma=10)
    add("e_aisyah", "Nur Aisyah", "Marketing", "o_kl", "12F", "12-03", "NDG-3001", 5000,
        {"halal_only": True, "fasting": True, "usual": {"cafe": "c_kl", "spec": {"item": "teh_tarik", "temp": "iced"}}}, runs=1, karma=10)
    add("e_somchai", "Somchai Rattanakul", "Engineering", "o_bkk", "25F", "25-11", "NDG-4001", 50000,
        {"usual": {"cafe": "c_bkk", "spec": {"item": "thai_tea", "sugar": 50}}}, runs=2, karma=20)
    add("e_paolo", "Paolo Reyes", "Sales", "o_mnl", "30F", "30-02", "NDG-5001", 100000,
        {"usual": {"cafe": "c_mnl", "spec": {"item": "spanish_latte", "temp": "iced"}}}, runs=1, karma=10)
    add("e_linh", "Nguyen Thi Linh", "Design", "o_hcm", "40F", "40-07", "NDG-6001", 300000,
        {"usual": {"cafe": "c_hcm", "spec": {"item": "ca_phe_sua_da", "temp": "iced"}}}, runs=1, karma=10)
    return people


def build_state(start=DEMO_START, real_now=0.0):
    state = {
        "version": 1,
        "seq": 100,
        "rev": 1,
        "clock": {"anchor_real": real_now, "anchor_sim": start, "speed": 1.0, "paused": False},
        "company": {
            "id": "co_nusantara",
            "name": "PT Nusantara Digital",
            "sso": "Google Workspace (SAML) + SCIM",
            "policy": {
                "allowance_office_days_only": False,
                "ramadan_mode": False,
                "privacy_aggregate_only": True,
            },
        },
        "offices": build_offices(),
        "cafes": build_cafes(),
        "employees": build_employees(),
        "runs": {},
        "events": {},
        "recurring": {},
        "notifications": [],
        "receipts": [],
        "payouts": [],
        "spend": [],
        "gifts": [],
        "topups": [],
        "roulette": [],
        "catering": {},
        "guest_refunds": [],
        "esg": {"cups": 0, "reusable_cups": 0, "trips_saved": 0},
        "countries": C.COUNTRIES,
        "config": {
            "cups_per_tray": C.CUPS_PER_TRAY,
            "trays_per_carrier": C.TRAYS_PER_CARRIER,
            "unclaimed_remind_min": C.UNCLAIMED_REMIND_MIN,
            "unclaimed_release_min": C.UNCLAIMED_RELEASE_MIN,
            "commission_pct": C.CAFE_COMMISSION_PCT,
            "milk_allergens": {key: value for key, value in C.MILK_ALLERGENS.items() if key},
        },
    }
    jakarta = state["offices"]["o_jkt"]

    # Other companies' bookings at nearby cafés make rush-hour capacity realistic.
    external = {
        "c_senja": {"08:50": 4, "09:00": 6, "09:10": 7, "09:20": 5, "09:30": 3, "12:00": 5, "12:10": 6, "12:20": 4},
        "c_seduh": {"09:00": 3, "09:10": 4, "12:10": 3},
        "c_aren": {"09:00": 5, "09:10": 4, "12:00": 6},
    }
    for cafe_id, slots in external.items():
        cafe = state["cafes"][cafe_id]
        for slot_hm, load in slots.items():
            cafe["external_load"][str(E.at_local_hm(start, cafe, slot_hm))] = load

    state["events"]["ev_sprint"] = {
        "id": "ev_sprint",
        "title": "Sprint Planning",
        "office": "o_jkt",
        "room": "Ruang Merapi (18F)",
        "start": E.at_local_hm(start, jakarta, "10:00"),
        "organizer": "e_dewi",
        "attendees": {"e_dewi": "yes", "e_andi": "yes", "e_budi": "yes", "e_sari": "yes", "e_fajar": "maybe", "e_putri": "no"},
        "run": None,
        "source": "Google Calendar",
    }
    state["events"]["ev_pitch"] = {
        "id": "ev_pitch",
        "title": "Client pitch — Bank Mandala",
        "office": "o_jkt",
        "room": "Ruang Bromo (19F)",
        "start": E.at_local_hm(start, jakarta, "14:00"),
        "organizer": "e_putri",
        "attendees": {"e_putri": "yes", "e_fajar": "yes", "e_maya": "yes"},
        "run": None,
        "source": "Microsoft Outlook",
    }
    singapore = state["offices"]["o_sg"]
    state["events"]["ev_sg_sync"] = {
        "id": "ev_sg_sync",
        "title": "Regional sync",
        "office": "o_sg",
        "room": "Merlion Room (L21)",
        "start": E.at_local_hm(start, singapore, "11:00"),
        "organizer": "e_weiling",
        "attendees": {"e_weiling": "yes", "e_arjun": "yes"},
        "run": None,
        "source": "Microsoft Outlook",
    }

    state["recurring"]["rec_rizky"] = {
        "id": "rec_rizky",
        "owner": "e_rizky",
        "kind": "solo",
        "title": "Rizky's morning usual",
        "days": [0, 1, 2, 3, 4],
        "slot_hm": "08:50",
        "lead_min": 20,
        "cafe": "c_senja",
        "spec": {"item": "kopi_aren", "sugar": 75},
        "members": [],
        "last_date": None,
    }
    state["recurring"]["rec_standup"] = {
        "id": "rec_standup",
        "owner": "e_andi",
        "kind": "group",
        "title": "Squad standup coffee",
        "days": [0, 2],
        "slot_hm": "09:40",
        "lead_min": 30,
        "cutoff_before_min": 15,
        "cafe": "c_senja",
        "pay_mode": "each",
        "members": ["e_andi", "e_budi", "e_sari", "e_fajar", "e_rizky"],
        "last_date": None,
    }

    # Last week's spend so the finance views are not empty.
    for days_ago, amount in ((7, 410000), (6, 385000), (5, 362000), (4, 455000), (3, 398000)):
        state["spend"].append({"ts": start - days_ago * 86400, "office": "o_jkt", "category": "staff_allowance",
                               "amount": amount, "emp": None, "desc": "Daily allowances (history)", "ref": None})
    state["spend"].append({"ts": start - 4 * 86400, "office": "o_jkt", "category": "meeting", "amount": 640000,
                           "emp": None, "desc": "Town hall coffee (history)", "ref": None})

    # An open run already collecting orders, so the demo has something to join.
    run = E.run_create(state, start, "e_putri", "c_seduh", E.at_local_hm(start, jakarta, "08:50"),
                       cutoff_ts=E.at_local_hm(start, jakarta, "08:40"), title="Marketing morning run")
    E.run_join(state, start, run["id"], "e_putri", {"item": "latte", "temp": "hot", "sugar": 50})
    E.run_join(state, start, run["id"], "e_maya", {"item": "americano", "temp": "hot", "sugar": 0})

    E.notify(state, "e_andi", start,
             "Welcome! Signed in with Google Workspace. Your badge NDG-1001 is linked.",
             "Selamat datang! Masuk dengan Google Workspace. Badge NDG-1001 sudah terhubung.")
    state["notifications"] = [note for note in state["notifications"] if note["to"] != "e_putri"]
    state["social"] = build_social(state, start)
    seed_rewards(state, start)
    seed_loyalty(state, start)
    return state


def seed_loyalty(state, start):
    L.ensure(state)
    profiles = {
        "e_andi": {"lifetime": 1320, "points": 420, "drinks": 9, "reusable": 2, "early": 2, "offpeak": 1,
                   "group_runs": 4, "gifts": 1, "cafes": ["c_senja", "c_seduh"], "done": ["first_cup"]},
        "e_putri": {"lifetime": 1680, "points": 610, "drinks": 48, "reusable": 1, "early": 1, "offpeak": 5,
                    "group_runs": 20, "gifts": 4, "cafes": ["c_seduh", "c_senja", "c_aren"],
                    "done": ["first_cup", "regular", "runner", "explorer", "team_player", "off_peak", "generous"]},
        "e_sari": {"lifetime": 640, "points": 240, "drinks": 14, "reusable": 4, "group_runs": 3,
                   "cafes": ["c_senja"], "done": ["first_cup", "regular"]},
        "e_budi": {"lifetime": 380, "points": 180, "drinks": 6, "group_runs": 2, "cafes": ["c_senja"], "done": ["first_cup"]},
        "e_maya": {"lifetime": 905, "points": 330, "drinks": 22, "group_runs": 9, "runs": 6,
                   "cafes": ["c_seduh", "c_senja"], "done": ["first_cup", "regular", "runner", "team_player"]},
    }
    for emp_id, data in profiles.items():
        acc = L.account(state, emp_id)
        acc["lifetime"] = data["lifetime"]
        acc["points"] = data["points"]
        for key in L.COUNTERS:
            if key in data:
                acc["counters"][key] = data[key]
        acc["cafes"] = list(data["cafes"])
        acc["achievements"] = {ach_id: start - 20 * 86400 for ach_id in data["done"]}
    for emp_id in state["employees"]:
        L.mark_existing_achievements(state, start - 86400, emp_id)
    for days_ago, points, reason in ((6, 15, "Order at Kopi Senja SCBD (drink, reusable cup)"), (5, 26, "Coffee run (3 cups)"),
                                     (3, 11, "Order at Ruang Seduh (drink)"), (1, 16, "Order at Kopi Senja SCBD (drink, group run)")):
        state["loyalty"]["ledger"].append({"emp": "e_andi", "ts": start - days_ago * 86400, "points": points, "reason": reason})
    L.issue_coupon(state, start - 2 * 86400, "e_andi", "amount", source="welcome", note="Welcome to CrewCup")
    senja = L.promo_create(state, start - 86400, "c_senja", "15% off outside rush hours", "percent", 15,
                           offpeak_only=True, max_claims=80, days=10)
    L.promo_create(state, start - 2 * 86400, "c_aren", "Rp5.000 off any order", "amount", 5000, max_claims=150, days=7)
    L.promo_create(state, start - 3 * 3600, "c_seduh", "10% off this week", "percent", 10, max_claims=40, days=6)
    L.promo_create(state, start - 86400, "c_sg", "S$1 off your morning flat white", "amount", 100, max_claims=60, days=10)
    L.promo_claim(state, start - 3600, "e_andi", senja["id"])
    referral = L.refer(state, start - 6 * 60, "e_andi", "company", "Pandan Tech", "hr@pandantech.id")
    referral["status"] = "contacted"


def seed_rewards(state, start):
    R.ensure(state)
    state["offices"]["o_jkt"]["budgets"]["rewards"]["limit"] = 1500000
    joined = {
        "e_andi": "2024-03-11", "e_sari": "2022-06-20", "e_budi": "2023-11-02", "e_dewi": "2019-08-01",
        "e_rizky": "2025-11-03", "e_putri": "2021-01-15", "e_fajar": "2025-02-03", "e_maya": "2020-11-09",
        "e_weiling": "2022-09-05", "e_arjun": "2024-07-01", "e_aisyah": "2023-04-17", "e_somchai": "2021-10-11",
        "e_paolo": "2024-01-08", "e_linh": "2022-12-12",
    }
    for emp_id, date in joined.items():
        state["employees"][emp_id]["joined"] = date
    sari = state["employees"]["e_sari"]
    sari["birthday"] = "11-03"
    sari["profile"]["birthday_coffee"] = True
    R.reward_give(state, start - 3 * 86400, "o_jkt", "person", "e_putri", 3, "great_work",
                  "The Q3 campaign brought in 40 new client leads.", announce=True)
    R.reward_give(state, start - 5 * 86400, "o_jkt", "team", "Engineering", 1, "team_win",
                  "Payments v2 shipped on schedule.", announce=True)
    for row in state["rewards"]:  # last week's reward credit has already been spent
        state["employees"][row["emp"]]["wallet"]["gift"] -= row["amount"]
    nomination = R.nominate(state, start - 2 * 3600, "e_budi", "e_maya", "thank_you",
                            "Closed the October books two days early and helped everyone with expense claims.")
    state["notifications"] = [note for note in state["notifications"]
                              if note["to"] not in ("e_putri",) and note["ts"] >= start - 3600 or note["ref"] == nomination["id"]]
