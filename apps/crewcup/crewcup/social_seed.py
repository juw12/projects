"""Demo data for the CrewCup Network. Every company, person and event is fictional."""

from . import engine as E
from .social import CAFE_CITY, HOME_COMPANY, OFFICE_CITY, emp_social

MENARA = "Menara Sudirman, SCBD"


def _site(building, city, floors=""):
    return {"building": building, "city": city, "floors": floors}


def build_companies(state):
    home_sites = [_site(office["building"], OFFICE_CITY[office_id], ", ".join(office["floors"]))
                  for office_id, office in state["offices"].items()]
    return {
        HOME_COMPANY: {
            "id": HOME_COMPANY,
            "name": state["company"]["name"],
            "industry": "Software & digital products",
            "about": "Product engineering company building payments and logistics platforms for Southeast Asia.",
            "headcount": "200–500",
            "verified": "nusantara.co.id",
            "sites": home_sites,
            "visibility": "network",
            "participation": True,
            "share_stats": True,
            "blocked": [],
            "fav_cafes": ["c_senja", "c_seduh"],
            "stats": {"cups": 236, "reusable": 64},
        },
        "co_mandala": {
            "id": "co_mandala",
            "name": "Bank Mandala",
            "industry": "Banking & financial services",
            "about": "Digital-first bank. The API banking and platform teams sit on 22F–27F.",
            "headcount": "1,000+",
            "verified": "bankmandala.co.id",
            "sites": [_site(MENARA, "Jakarta", "22F–27F")],
            "visibility": "network",
            "share_stats": True,
            "fav_cafes": ["c_senja", "c_aren"],
            "stats": {"cups": 412, "reusable": 95},
            "followers_external": 38,
        },
        "co_arunika": {
            "id": "co_arunika",
            "name": "Arunika Health",
            "industry": "Healthtech",
            "about": "Telemedicine and clinic software for 300+ clinics across Indonesia.",
            "headcount": "50–200",
            "verified": "arunika.health",
            "sites": [_site(MENARA, "Jakarta", "12F")],
            "visibility": "building",
            "share_stats": True,
            "fav_cafes": ["c_senja"],
            "stats": {"cups": 96, "reusable": 41},
            "followers_external": 12,
        },
        "co_lumbung": {
            "id": "co_lumbung",
            "name": "Lumbung Logistik",
            "industry": "Logistics & supply chain",
            "about": "Same-day B2B delivery network for Greater Jakarta.",
            "headcount": "200–500",
            "verified": "lumbung.id",
            "sites": [_site("Treasury Tower, SCBD", "Jakarta", "30F")],
            "visibility": "network",
            "share_stats": True,
            "fav_cafes": ["c_aren"],
            "stats": {"cups": 188, "reusable": 56},
            "followers_external": 21,
        },
        "co_kawan": {
            "id": "co_kawan",
            "name": "Kawan Studio",
            "industry": "Brand & design agency",
            "about": "Independent brand and product design studio.",
            "headcount": "10–50",
            "verified": "kawan.studio",
            "sites": [_site("Sudirman Plaza", "Jakarta", "8F")],
            "visibility": "network",
            "share_stats": False,
            "fav_cafes": ["c_seduh"],
            "stats": {"cups": 64, "reusable": 30},
            "followers_external": 9,
        },
        "co_samudra": {
            "id": "co_samudra",
            "name": "Samudra Energi",
            "industry": "Energy",
            "about": "",
            "headcount": "500–1,000",
            "verified": "samudraenergi.co.id",
            "sites": [_site(MENARA, "Jakarta", "30F–33F")],
            "visibility": "private",
            "share_stats": False,
            "fav_cafes": [],
            "stats": {"cups": 150, "reusable": 20},
        },
        "co_straits": {
            "id": "co_straits",
            "name": "Straits Analytics",
            "industry": "Data & AI consulting",
            "about": "Analytics consultancy for banks and insurers in Singapore and Malaysia.",
            "headcount": "50–200",
            "verified": "straitsanalytics.sg",
            "sites": [_site("Marina One East Tower", "Singapore", "L18")],
            "visibility": "network",
            "share_stats": True,
            "fav_cafes": ["c_sg"],
            "stats": {"cups": 140, "reusable": 63},
            "followers_external": 17,
        },
        "co_tropika": {
            "id": "co_tropika",
            "name": "Tropika Games",
            "industry": "Games",
            "about": "Mobile game studio in Bangsar South.",
            "headcount": "50–200",
            "verified": "tropika.games",
            "sites": [_site("The Vertical, Bangsar South", "Kuala Lumpur", "9F")],
            "visibility": "network",
            "share_stats": True,
            "fav_cafes": ["c_kl"],
            "stats": {"cups": 120, "reusable": 22},
            "followers_external": 6,
        },
    }


def _member(member_id, name, title, company, building, city, interests, open_to, visibility="network",
            chat_pref="anyone", accepts=True, usual_cafe=None, decline_reason=None, decline_reason_id=None):
    member = {
        "id": member_id,
        "name": name,
        "title": title,
        "company": company,
        "building": building,
        "city": city,
        "interests": interests,
        "open_to": open_to,
        "visibility": visibility,
        "chat_pref": chat_pref,
        "accepts": accepts,
        "usual_cafe": usual_cafe,
    }
    if decline_reason:
        member["decline_reason"] = decline_reason
        member["decline_reason_id"] = decline_reason_id or decline_reason
    return member


def build_members():
    members = [
        _member("m_rina", "Rina Kartika", "Head of Digital Banking", "co_mandala", MENARA, "Jakarta",
                ["Open banking", "Product strategy"], ["coffee_chat", "partnerships"], usual_cafe="c_senja"),
        _member("m_hendra", "Hendra Wijaya", "Engineering Manager, Platform", "co_mandala", MENARA, "Jakarta",
                ["Go", "Platform engineering"], ["coffee_chat", "hiring", "mentoring"], usual_cafe="c_senja"),
        _member("m_laras", "Laras Putri", "Lead Product Designer", "co_arunika", MENARA, "Jakarta",
                ["Design systems", "Accessibility"], ["coffee_chat", "mentoring"], visibility="building", usual_cafe="c_senja"),
        _member("m_yoga", "Yoga Pratama", "Head of Partnerships", "co_arunika", MENARA, "Jakarta",
                ["Health insurance", "B2B sales"], ["partnerships"], visibility="building", chat_pref="building"),
        _member("m_dimas", "Dimas Prakoso", "Operations Lead", "co_lumbung", "Treasury Tower, SCBD", "Jakarta",
                ["Supply chain", "Data"], ["partnerships"], chat_pref="building", usual_cafe="c_aren"),
        _member("m_sinta", "Sinta Maharani", "Data Analyst", "co_lumbung", "Treasury Tower, SCBD", "Jakarta",
                ["SQL", "Forecasting"], ["coffee_chat", "mentoring"], usual_cafe="c_aren"),
        _member("m_nadia", "Nadia Rahman", "Creative Director", "co_kawan", "Sudirman Plaza", "Jakarta",
                ["Branding", "Illustration"], ["coffee_chat"], accepts=False, usual_cafe="c_seduh",
                decline_reason="Fully booked with client work this week — try next week.",
                decline_reason_id="Sedang padat dengan pekerjaan klien minggu ini — coba minggu depan."),
        _member("m_kevin", "Kevin Tan", "Principal Data Scientist", "co_straits", "Marina One East Tower", "Singapore",
                ["Machine learning", "Risk models"], ["coffee_chat", "hiring"], usual_cafe="c_sg"),
        _member("m_farah", "Farah Aziz", "Studio Producer", "co_tropika", "The Vertical, Bangsar South", "Kuala Lumpur",
                ["Game production", "Live ops"], ["coffee_chat"], usual_cafe="c_kl"),
    ]
    return {member["id"]: member for member in members}


def _post(post_id, author, text, ts, audience, building, city, kind="update", cafe=None, likes=(), comments=()):
    return {
        "id": post_id,
        "author": author,
        "kind": kind,
        "text": text,
        "ts": ts,
        "audience": audience,
        "building": building,
        "city": city,
        "cafe": cafe,
        "likes": list(likes),
        "comments": list(comments),
        "hidden_by": [],
        "engaged": True,
    }


def build_posts(start):
    minute = 60
    hour = 3600
    posts = [
        _post("p_mandala_api", "company:co_mandala",
              "Open session for Menara Sudirman tenants: building on our API banking sandbox. Thursday 16:00, "
              "Ruang Serbaguna 3F. Engineers and product managers from any company are welcome.",
              start - 2 * hour, "building", MENARA, "Jakarta", kind="announcement",
              likes=["member:m_laras", "emp:e_budi", "member:m_yoga"]),
        _post("p_senja_gayo", "cafe:c_senja",
              "New this week: single-origin Gayo pour-over. Orders placed before 08:40 skip the 09:00 rush — "
              "live slot capacity is on the order screen.",
              start - 50 * minute, "network", "", "Jakarta", kind="announcement", cafe="c_senja",
              likes=["member:m_rina", "emp:e_sari", "member:m_sinta", "emp:e_fajar"]),
        _post("p_laras_ds", "member:m_laras",
              "Looking for two or three designers in the building to compare notes on design systems over coffee. "
              "Kopi Senja, Wednesday morning? Reply here or send a coffee-chat request.",
              start - 25 * minute, "building", MENARA, "Jakarta", kind="question", cafe="c_senja",
              likes=["emp:e_sari"],
              comments=[{"id": "pc_seed1", "by": "member:m_hendra", "text": "Our platform UI team would join — I'll pass it on.",
                         "ts": start - 18 * minute}]),
        _post("p_hendra_hiring", "member:m_hendra",
              "Bank Mandala is hiring two backend engineers (Go, PostgreSQL) for the payments platform. "
              "Happy to talk over coffee with anyone curious about banking infrastructure.",
              start - 3 * hour, "network", MENARA, "Jakarta", kind="hiring",
              likes=["member:m_sinta", "emp:e_rizky"]),
        _post("p_putri_seduh", "emp:e_putri",
              "Our marketing team runs a group order from Ruang Seduh most mornings at 08:50. The V60 is worth the walk.",
              start - 22 * hour, "network", MENARA, "Jakarta", kind="recommendation", cafe="c_seduh",
              likes=["member:m_nadia", "member:m_rina"]),
        _post("p_dimas_reusable", "member:m_dimas",
              "Lumbung Logistik moved its office to reusable cups this month — 30% of orders so far. "
              "Interested in how other teams got their rate higher.",
              start - 4 * hour, "network", "Treasury Tower, SCBD", "Jakarta",
              likes=["emp:e_sari", "member:m_laras"],
              comments=[{"id": "pc_seed2", "by": "emp:e_sari", "text": "Making it the default in everyone's profile helped us most.",
                         "ts": start - 3 * hour}]),
        _post("p_dewi_townhall", "emp:e_dewi",
              "Reminder: town hall on Thursday at 15:00. Coffee for everyone is pre-ordered from Kopi Senja — "
              "update your usual in Profile if you want something different.",
              start - 2 * hour, "company", MENARA, "Jakarta", kind="update", likes=["emp:e_andi", "emp:e_maya"]),
        _post("p_aren_rain", "cafe:c_aren",
              "Rain expected after 15:00. Delivery to Menara Sudirman and Treasury Tower lobbies is free for orders of 5+ cups this afternoon.",
              start + 25 * minute, "network", "", "Jakarta", kind="announcement", cafe="c_aren",
              likes=["member:m_dimas"]),
        _post("p_rina_breakfast", "member:m_rina",
              "Thank you to everyone who came to the fintech breakfast last week. We're running it again on Thursday — "
              "QRIS and real-time payments, 07:45 at Kopi Senja.",
              start + 70 * minute, "network", MENARA, "Jakarta", kind="update"),
        _post("p_arunika_wellness", "company:co_arunika",
              "Free health check stand in the Menara Sudirman lobby on Friday 10:00–14:00, open to all tenants.",
              start + 2 * hour, "building", MENARA, "Jakarta", kind="announcement"),
        _post("p_kevin_sg", "member:m_kevin",
              "Marina One tenants: anyone interested in a small data meetup at Tanjong Brew next Tuesday morning?",
              start - 1 * hour, "network", "Marina One East Tower", "Singapore", kind="question", cafe="c_sg"),
        _post("p_farah_kl", "member:m_farah",
              "Kopi Bangsar's new kopi ais is excellent. We're testing a team order every Friday — happy to share how it works.",
              start - 5 * hour, "network", "The Vertical, Bangsar South", "Kuala Lumpur", kind="recommendation", cafe="c_kl"),
    ]
    return {post["id"]: post for post in posts}


def build_meetups(state, start):
    jakarta = state["offices"]["o_jkt"]
    singapore = state["offices"]["o_sg"]
    meetups = [
        {
            "id": "mu_fintech",
            "title": "SCBD Builders Breakfast: QRIS & real-time payments",
            "description": "Short talks from Bank Mandala's payments team, then open discussion. Breakfast pre-ordered on arrival.",
            "host": "company:co_mandala",
            "cafe": "c_senja",
            "start": E.at_local_hm(start, jakarta, "07:45", day_offset=3),
            "duration_min": 75,
            "capacity": 30,
            "max_per_company": 6,
            "audience": "network",
            "city": "Jakarta",
            "building": MENARA,
            "attendees": {
                "member:m_rina": "co_mandala", "member:m_hendra": "co_mandala", "x:mandala3": "co_mandala",
                "member:m_sinta": "co_lumbung", "x:lumbung2": "co_lumbung", "member:m_laras": "co_arunika",
                "x:kawan1": "co_kawan", "emp:e_maya": HOME_COMPANY,
            },
        },
        {
            "id": "mu_design",
            "title": "Design Systems Coffee",
            "description": "Bring one component you're proud of and one you'd rebuild.",
            "host": "member:m_laras",
            "cafe": "c_senja",
            "start": E.at_local_hm(start, jakarta, "08:00", day_offset=2),
            "duration_min": 45,
            "capacity": 12,
            "max_per_company": 4,
            "audience": "building",
            "city": "Jakarta",
            "building": MENARA,
            "attendees": {"member:m_laras": "co_arunika", "x:arunika2": "co_arunika", "x:mandala4": "co_mandala"},
        },
        {
            "id": "mu_cupday",
            "title": "Reusable Cup Day — Menara Sudirman",
            "description": "Bring your own cup on Friday: Rp5.000 off at every partner café, and it counts toward the building challenge.",
            "host": "cafe:c_senja",
            "cafe": "c_senja",
            "start": E.at_local_hm(start, jakarta, "08:00", day_offset=4),
            "duration_min": 180,
            "capacity": 200,
            "max_per_company": 0,
            "audience": "network",
            "city": "Jakarta",
            "building": MENARA,
            "attendees": {f"x:cup{i}": company for i, company in enumerate(
                ["co_mandala"] * 14 + ["co_arunika"] * 6 + ["co_lumbung"] * 5 + [HOME_COMPANY] * 3)},
        },
        {
            "id": "mu_sg_data",
            "title": "Marina Bay Data Coffee",
            "description": "Informal meetup for data people in Marina One and nearby towers.",
            "host": "member:m_kevin",
            "cafe": "c_sg",
            "start": E.at_local_hm(start, singapore, "08:30", day_offset=8),
            "duration_min": 60,
            "capacity": 15,
            "max_per_company": 4,
            "audience": "network",
            "city": "Singapore",
            "building": "Marina One East Tower",
            "attendees": {"member:m_kevin": "co_straits", "x:straits2": "co_straits"},
        },
    ]
    return {meetup["id"]: meetup for meetup in meetups}


def build_social(state, start):
    social = {
        "companies": build_companies(state),
        "members": build_members(),
        "posts": build_posts(start),
        "chats": {},
        "meetups": build_meetups(state, start),
        "reports": [],
        "challenge": {
            "title": "SCBD Green Cup Challenge — November",
            "title_id": "Tantangan Gelas Hijau SCBD — November",
            "metric": "reusable_pct",
            "buildings": [MENARA, "Treasury Tower, SCBD", "Sudirman Plaza"],
            "cities": ["Jakarta"],
            "ends": E.at_local_hm(start, state["offices"]["o_jkt"], "18:00", day_offset=28),
        },
        "trending": {
            "c_senja": {"companies": 7, "top": [["kopi_aren", 41], ["latte", 18], ["americano", 14]]},
            "c_seduh": {"companies": 4, "top": [["v60", 35], ["latte", 27], ["kopi_aren", 16]]},
            "c_aren": {"companies": 6, "top": [["kopi_aren", 52], ["klepon", 21], ["teh_manis", 12]]},
            "c_sg": {"companies": 5, "top": [["flat_white", 38], ["kopi_o", 25], ["long_black", 17]]},
            "c_kl": {"companies": 3, "top": [["kopi_ais", 44], ["teh_tarik", 31], ["latte", 9]]},
        },
    }
    profiles = {
        "e_andi": {"headline": "Backend engineer, payments", "interests": ["Go", "Payments"], "open_to": ["coffee_chat", "mentoring"],
                   "follows": ["co_mandala"]},
        "e_sari": {"headline": "Product designer", "interests": ["Design systems", "Accessibility"], "open_to": ["coffee_chat"],
                   "follows": ["co_arunika", "co_kawan"]},
        "e_budi": {"headline": "Backend engineer", "open_to": ["coffee_chat"]},
        "e_putri": {"headline": "Marketing lead", "interests": ["Brand", "Events"], "open_to": ["coffee_chat", "partnerships"],
                    "follows": ["co_kawan"]},
        "e_maya": {"headline": "Finance manager", "visibility": "company", "chat_pref": "building"},
        "e_dewi": {"headline": "Operations & workplace", "open_to": ["partnerships"]},
        "e_rizky": {"visibility": "hidden", "chat_pref": "nobody", "open_to": []},
    }
    for emp_id, emp in state["employees"].items():
        profile = emp_social(emp)
        profile.update(profiles.get(emp_id, {}))
    for meetup in social["meetups"].values():
        meetup.setdefault("city", CAFE_CITY.get(meetup["cafe"], ""))
    return social
