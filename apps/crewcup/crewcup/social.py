"""CrewCup Network: a professional, cross-company layer on top of ordering.

People can see the other companies in their building and city, follow them, read and write short
posts, request a coffee chat with someone at another company, join cross-company meetups at
partner cafés and compare reusable-cup rates in a building challenge.

Privacy model (enforced server-side by `view_for`, never just hidden in the UI):
- Company visibility: "network" (listed to CrewCup companies in the same city), "building" (only
  companies in the same building) or "private" (not listed; its people cannot post outside).
- Company admins can switch the whole network off for their employees, choose whether aggregate
  stats are shared, block a company, and moderate posts written by their own employees.
- Employee profile visibility: "network" | "company" | "hidden"; coffee-chat requests from
  "anyone" | "building" | "nobody". Posting beyond the own company needs a network profile.
- Post audience: "network" (city), "building" or "company". Reported posts disappear for the
  reporter immediately and for everyone after REPORT_HIDE_THRESHOLD independent reports.
- Only aggregates are shared about companies (cups, reusable-cup rate) and meetups show
  attendee counts per company, not names.
"""

from . import engine as E
from .engine import DemoError

HOME_COMPANY = "co_nusantara"

AUDIENCES = ("network", "building", "company")
PROFILE_VISIBILITY = ("network", "company", "hidden")
CHAT_PREFS = ("anyone", "building", "nobody")
COMPANY_VISIBILITY = ("network", "building", "private")
OPEN_TO = ("coffee_chat", "mentoring", "hiring", "partnerships")

MAX_POST_LEN = 500
MAX_COMMENT_LEN = 280
POSTS_PER_HOUR = 5
REPORT_HIDE_THRESHOLD = 3
CHAT_REPLY_MIN = 3
CHAT_MIN_LEAD_MIN = 10
CHAT_MAX_DAYS = 14
FEED_LIMIT = 60

OFFICE_CITY = {
    "o_jkt": "Jakarta",
    "o_sg": "Singapore",
    "o_kl": "Kuala Lumpur",
    "o_bkk": "Bangkok",
    "o_mnl": "Manila",
    "o_hcm": "Ho Chi Minh City",
}
CAFE_CITY = {
    "c_senja": "Jakarta",
    "c_seduh": "Jakarta",
    "c_aren": "Jakarta",
    "c_bsd": "Jakarta",
    "c_sg": "Singapore",
    "c_kl": "Kuala Lumpur",
    "c_bkk": "Bangkok",
    "c_mnl": "Manila",
    "c_hcm": "Ho Chi Minh City",
}


# ---------------------------------------------------------------------------
# Basic accessors
# ---------------------------------------------------------------------------

def default_profile():
    return {
        "visibility": "network",
        "chat_pref": "anyone",
        "headline": "",
        "interests": [],
        "open_to": ["coffee_chat"],
        "follows": [],
        "hidden_posts": [],
    }


def emp_social(emp):
    data = emp.setdefault("social", default_profile())
    for key, value in default_profile().items():
        data.setdefault(key, value if not isinstance(value, list) else list(value))
    return data


def home(state):
    return state["social"]["companies"][HOME_COMPANY]


def network_enabled(state):
    return bool(home(state).get("participation", True))


def _employee(state, emp_id):
    emp = state["employees"].get(emp_id)
    if not emp or not emp.get("active", True):
        raise DemoError("NOT_FOUND", "Unknown employee.", "Karyawan tidak dikenal.")
    return emp


def emp_site(state, emp):
    office = state["offices"][emp["office"]]
    return {"building": office["building"], "city": OFFICE_CITY.get(office["id"], "")}


def viewer(state, persona):
    """Who is looking: company, buildings and cities that scope what they may see."""
    kind, _, ident = (persona or "").partition(":")
    if kind == "emp" and ident in state["employees"]:
        site = emp_site(state, state["employees"][ident])
        return {"kind": "emp", "id": ident, "persona": persona, "company": HOME_COMPANY,
                "buildings": {site["building"]}, "cities": {site["city"]}, "site": site}
    if kind == "admin":
        sites = home(state)["sites"]
        return {"kind": "admin", "id": ident, "persona": persona, "company": HOME_COMPANY,
                "buildings": {site["building"] for site in sites}, "cities": {site["city"] for site in sites},
                "site": None}
    if kind == "cafe" and ident in state["cafes"]:
        city = CAFE_CITY.get(ident, "")
        return {"kind": "cafe", "id": ident, "persona": persona, "company": None,
                "buildings": set(), "cities": {city}, "site": {"building": "", "city": city}}
    return {"kind": "guest", "id": None, "persona": persona, "company": None,
            "buildings": set(), "cities": set(), "site": None}


def author_company(state, author):
    kind, _, ident = author.partition(":")
    if kind == "emp":
        return HOME_COMPANY
    if kind == "member":
        member = state["social"]["members"].get(ident)
        return member["company"] if member else None
    if kind == "company":
        return ident
    return None


def author_card(state, author):
    """Public identity shown next to a post, comment or chat."""
    kind, _, ident = author.partition(":")
    companies = state["social"]["companies"]
    if kind == "emp":
        emp = state["employees"].get(ident, {})
        profile = emp_social(emp) if emp else default_profile()
        title = profile.get("headline") or emp.get("team", "")
        return {"key": author, "kind": "person", "name": emp.get("name", "Former employee"), "title": title,
                "company": HOME_COMPANY, "company_name": companies[HOME_COMPANY]["name"]}
    if kind == "member":
        member = state["social"]["members"].get(ident, {})
        company = companies.get(member.get("company"), {})
        return {"key": author, "kind": "person", "name": member.get("name", "Unknown"), "title": member.get("title", ""),
                "company": member.get("company"), "company_name": company.get("name", "")}
    if kind == "company":
        company = companies.get(ident, {})
        return {"key": author, "kind": "company", "name": company.get("name", ""), "title": company.get("industry", ""),
                "company": ident, "company_name": company.get("name", "")}
    if kind == "cafe":
        cafe = state["cafes"].get(ident, {})
        return {"key": author, "kind": "cafe", "name": cafe.get("name", ""), "title": "Partner café · " + cafe.get("area", ""),
                "company": None, "company_name": ""}
    return {"key": author, "kind": "unknown", "name": "Unknown", "title": "", "company": None, "company_name": ""}


# ---------------------------------------------------------------------------
# Visibility rules
# ---------------------------------------------------------------------------

def _external_allowed(state, view):
    """Employees and admins of a company that switched the network off see only their own company."""
    if view["company"] == HOME_COMPANY:
        return network_enabled(state)
    return True


def _blocked(state, view, company_id):
    if view["company"] == HOME_COMPANY:
        return company_id in home(state).get("blocked", [])
    return False


def company_visible(state, company, view):
    if company["id"] == view["company"]:
        return True
    if not _external_allowed(state, view) or _blocked(state, view, company["id"]):
        return False
    visibility = company.get("visibility", "network")
    if visibility == "network":
        return any(site["city"] in view["cities"] for site in company["sites"])
    if visibility == "building":
        return any(site["building"] in view["buildings"] for site in company["sites"])
    return False


def _company_ok(state, company_id, view):
    if company_id is None:
        return True
    company = state["social"]["companies"].get(company_id)
    return bool(company) and company_visible(state, company, view)


def person_visible(state, key, view):
    """Can `view` see this person's profile (and send them a chat request)?"""
    kind, _, ident = key.partition(":")
    if kind == "member":
        member = state["social"]["members"].get(ident)
        if not member or not _company_ok(state, member["company"], view):
            return False
        if member.get("visibility") == "building":
            return member["building"] in view["buildings"]
        return member["city"] in view["cities"]
    if kind == "emp":
        emp = state["employees"].get(ident)
        if not emp or not emp.get("active", True):
            return False
        if view["persona"] == key:
            return True
        visibility = emp_social(emp)["visibility"]
        if view["company"] == HOME_COMPANY:
            return visibility in ("network", "company")
        return visibility == "network" and emp_site(state, emp)["city"] in view["cities"]
    return False


def post_visible(state, post, view, now):
    if post["ts"] > now or post.get("deleted"):
        return False
    mine = post["author"] == view["persona"]
    if mine:
        return True
    if post.get("removed"):
        return False
    if view["persona"] in post.get("hidden_by", []):
        return False
    company_id = author_company(state, post["author"])
    same_company = company_id is not None and company_id == view["company"]
    if post.get("report_hidden") and not same_company:
        return False
    if same_company:
        return True
    if post["audience"] == "company":
        return False
    if not _external_allowed(state, view) or not _company_ok(state, company_id, view):
        return False
    if post["audience"] == "building":
        return post.get("building") in view["buildings"]
    return post.get("city") in view["cities"]


def meetup_visible(state, meetup, view, now):
    if meetup.get("cancelled") or meetup["start"] + meetup.get("duration_min", 60) * 60 < now:
        return False
    host_company = author_company(state, meetup["host"])
    if host_company == view["company"] and host_company is not None:
        return True
    if meetup["host"] == view["persona"]:
        return True
    if not _external_allowed(state, view) or not _company_ok(state, host_company, view):
        return False
    if meetup["audience"] == "building":
        return meetup.get("building") in view["buildings"]
    return meetup["city"] in view["cities"]


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

def company_stats(state, company):
    stats = dict(company.get("stats") or {"cups": 0, "reusable": 0})
    if company["id"] == HOME_COMPANY:
        esg = state.get("esg", {})
        stats["cups"] = stats.get("cups", 0) + esg.get("cups", 0)
        stats["reusable"] = stats.get("reusable", 0) + esg.get("reusable_cups", 0)
    cups = stats.get("cups", 0)
    stats["reusable_pct"] = round(100 * stats.get("reusable", 0) / cups, 1) if cups else 0.0
    return stats


def challenge_board(state, view):
    challenge = state["social"]["challenge"]
    rows = []
    hidden = 0
    for company in state["social"]["companies"].values():
        if not any(site["building"] in challenge["buildings"] for site in company["sites"]):
            continue
        if not company_visible(state, company, view):
            hidden += 1
            continue
        if not company.get("share_stats", True):
            hidden += 1
            continue
        stats = company_stats(state, company)
        rows.append({"company": company["id"], "name": company["name"], "cups": stats["cups"],
                     "reusable": stats["reusable"], "reusable_pct": stats["reusable_pct"],
                     "mine": company["id"] == view["company"]})
    rows.sort(key=lambda row: (-row["reusable_pct"], -row["cups"], row["name"]))
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
    return {"title": challenge["title"], "title_id": challenge.get("title_id", challenge["title"]),
            "metric": challenge["metric"], "ends": challenge["ends"], "rows": rows, "not_shown": hidden,
            "visible": bool(view["cities"] & set(challenge["cities"]))}


# ---------------------------------------------------------------------------
# View building (what the server sends to each persona)
# ---------------------------------------------------------------------------

def _post_view(state, post, view, now):
    likes = post.get("likes", [])
    comments = []
    for comment in post.get("comments", []):
        if comment.get("removed"):
            continue
        if not _company_ok(state, author_company(state, comment["by"]), view) and comment["by"] != view["persona"]:
            continue
        comments.append({"id": comment["id"], "by": author_card(state, comment["by"]), "text": comment["text"],
                         "ts": comment["ts"], "mine": comment["by"] == view["persona"]})
    company_id = author_company(state, post["author"])
    return {
        "id": post["id"],
        "author": author_card(state, post["author"]),
        "kind": post.get("kind", "update"),
        "text": post["text"],
        "ts": post["ts"],
        "audience": post["audience"],
        "building": post.get("building"),
        "city": post.get("city"),
        "cafe": post.get("cafe"),
        "likes": len(likes),
        "liked": view["persona"] in likes,
        "comments": comments,
        "mine": post["author"] == view["persona"],
        "same_company": company_id is not None and company_id == view["company"],
        "same_building": post.get("building") in view["buildings"],
        "removed": bool(post.get("removed")),
    }


def _company_view(state, company, view, me_profile):
    stats = company_stats(state, company) if company.get("share_stats", True) or company["id"] == view["company"] else None
    open_people = [
        member_id for member_id, member in state["social"]["members"].items()
        if member["company"] == company["id"] and "coffee_chat" in member.get("open_to", [])
        and person_visible(state, "member:" + member_id, view)
    ]
    followers = sum(1 for emp in state["employees"].values() if company["id"] in emp_social(emp)["follows"])
    followers += company.get("followers_external", 0)
    return {
        "id": company["id"],
        "name": company["name"],
        "industry": company["industry"],
        "about": company.get("about", ""),
        "headcount": company.get("headcount", ""),
        "verified": company.get("verified", ""),
        "sites": [site for site in company["sites"] if site["city"] in view["cities"]] or company["sites"][:1],
        "same_building": any(site["building"] in view["buildings"] for site in company["sites"]),
        "fav_cafes": company.get("fav_cafes", []),
        "stats": stats,
        "share_stats": company.get("share_stats", True),
        "open_people": open_people,
        "followers": followers,
        "following": bool(me_profile) and company["id"] in me_profile["follows"],
        "mine": company["id"] == view["company"],
        "visibility": company.get("visibility", "network") if company["id"] == view["company"] else None,
    }


def _member_view(state, member_id, view):
    member = state["social"]["members"][member_id]
    company = state["social"]["companies"][member["company"]]
    return {
        "key": "member:" + member_id,
        "name": member["name"],
        "title": member["title"],
        "company": member["company"],
        "company_name": company["name"],
        "building": member["building"],
        "city": member["city"],
        "same_building": member["building"] in view["buildings"],
        "interests": member.get("interests", []),
        "open_to": member.get("open_to", []),
        "chat_pref": member.get("chat_pref", "anyone"),
        "can_request": can_request_chat(state, view, "member:" + member_id)[0],
        "usual_cafe": member.get("usual_cafe"),
    }


def _chat_view(state, chat, view):
    other = chat["to"] if chat["from"] == view["persona"] else chat["from"]
    return {
        "id": chat["id"],
        "outgoing": chat["from"] == view["persona"],
        "other": author_card(state, other),
        "cafe": chat["cafe"],
        "slot": chat["slot"],
        "note": chat.get("note", ""),
        "status": chat["status"],
        "created": chat["created"],
        "reason": chat.get("reason"),
    }


def _meetup_view(state, meetup, view):
    by_company = {}
    for company_id in meetup["attendees"].values():
        by_company[company_id] = by_company.get(company_id, 0) + 1
    companies = state["social"]["companies"]
    breakdown = sorted(
        ({"company": company_id, "name": companies.get(company_id, {}).get("name", "Other"), "count": count}
         for company_id, count in by_company.items()),
        key=lambda row: (-row["count"], row["name"]),
    )
    mine_count = by_company.get(view["company"], 0) if view["company"] else 0
    return {
        "id": meetup["id"],
        "title": meetup["title"],
        "description": meetup.get("description", ""),
        "host": author_card(state, meetup["host"]),
        "cafe": meetup["cafe"],
        "start": meetup["start"],
        "duration_min": meetup.get("duration_min", 60),
        "capacity": meetup["capacity"],
        "max_per_company": meetup.get("max_per_company", 0),
        "going": len(meetup["attendees"]),
        "companies": len(by_company),
        "breakdown": breakdown,
        "me_going": view["persona"] in meetup["attendees"],
        "my_company_count": mine_count,
        "audience": meetup["audience"],
        "mine": meetup["host"] == view["persona"],
    }


def view_for(state, persona, now):
    """Everything the Network UI needs, filtered to what `persona` may see."""
    social = state["social"]
    view = viewer(state, persona)
    me_profile = None
    if view["kind"] == "emp":
        me_profile = emp_social(state["employees"][view["id"]])
    enabled = _external_allowed(state, view)
    posts = [post for post in social["posts"].values() if post_visible(state, post, view, now)]
    posts.sort(key=lambda post: (-post["ts"], post["id"]))
    companies = [company for company in social["companies"].values() if company_visible(state, company, view)]
    hidden_in_building = sum(
        1 for company in social["companies"].values()
        if company["id"] != view["company"] and not company_visible(state, company, view)
        and any(site["building"] in view["buildings"] for site in company["sites"])
    )
    people = [member_id for member_id in social["members"] if person_visible(state, "member:" + member_id, view)]
    chats = [chat for chat in social["chats"].values() if view["persona"] in (chat["from"], chat["to"])]
    chats.sort(key=lambda chat: (-chat["created"], chat["id"]))
    meetups = [meetup for meetup in social["meetups"].values() if meetup_visible(state, meetup, view, now)]
    meetups.sort(key=lambda meetup: meetup["start"])
    trending = []
    for cafe_id, info in social.get("trending", {}).items():
        if CAFE_CITY.get(cafe_id) in view["cities"]:
            trending.append({"cafe": cafe_id, **info})
    result = {
        "enabled": enabled,
        "viewer": {"kind": view["kind"], "company": view["company"], "site": view["site"]},
        "me": me_profile,
        "feed": [_post_view(state, post, view, now) for post in posts[:FEED_LIMIT]],
        "companies": sorted((_company_view(state, company, view, me_profile) for company in companies),
                            key=lambda row: (not row["mine"], not row["same_building"], row["name"])),
        "private_in_building": hidden_in_building,
        "people": [_member_view(state, member_id, view) for member_id in people],
        "chats": [_chat_view(state, chat, view) for chat in chats[:30]],
        "meetups": [_meetup_view(state, meetup, view) for meetup in meetups],
        "challenge": challenge_board(state, view),
        "trending": trending,
        "limits": {"post": MAX_POST_LEN, "comment": MAX_COMMENT_LEN, "per_hour": POSTS_PER_HOUR},
    }
    if view["kind"] == "admin":
        result["admin"] = admin_view(state, now)
    return result


def admin_view(state, now):
    social = state["social"]
    company = home(state)
    queue = []
    for report in sorted(social["reports"], key=lambda item: -item["ts"]):
        post = social["posts"].get(report["post"])
        if not post:
            continue
        own_author = author_company(state, post["author"]) == HOME_COMPANY
        own_reporter = report["by"].startswith("emp:")
        if not (own_author or own_reporter):
            continue
        queue.append({
            "id": report["id"],
            "post": report["post"],
            "text": post["text"],
            "author": author_card(state, post["author"]),
            "reporter": author_card(state, report["by"]),
            "reason": report["reason"],
            "ts": report["ts"],
            "status": report["status"],
            "can_moderate": own_author,
            "removed": bool(post.get("removed")),
        })
    week = now - 7 * 86400
    employee_posts = [post for post in social["posts"].values()
                      if post["author"].startswith("emp:") and post["ts"] >= week and not post.get("deleted")]
    accepted = [chat for chat in social["chats"].values() if chat["status"] == "accepted"]
    profiles = [emp_social(emp)["visibility"] for emp in state["employees"].values() if emp.get("active", True)]
    others = [other for other in social["companies"].values() if other["id"] != HOME_COMPANY]
    return {
        "settings": {
            "visibility": company.get("visibility", "network"),
            "participation": company.get("participation", True),
            "share_stats": company.get("share_stats", True),
            "about": company.get("about", ""),
            "blocked": list(company.get("blocked", [])),
        },
        "queue": queue,
        "stats": {
            "posts_week": len(employee_posts),
            "chats_accepted": len(accepted),
            "profiles_network": profiles.count("network"),
            "profiles_company": profiles.count("company"),
            "profiles_hidden": profiles.count("hidden"),
        },
        "all_companies": [{"id": other["id"], "name": other["name"], "industry": other["industry"],
                           "city": other["sites"][0]["city"], "blocked": other["id"] in company.get("blocked", [])}
                          for other in sorted(others, key=lambda item: item["name"])],
    }


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

def _clean_text(text, limit, what="Post"):
    lines = [" ".join(line.split()) for line in str(text or "").strip().splitlines()]
    text = "\n".join(lines)
    while "\n\n\n" in text:
        text = text.replace("\n\n\n", "\n\n")
    if not text:
        raise DemoError("EMPTY", f"{what} can't be empty.", f"{'Postingan' if what == 'Post' else 'Komentar'} tidak boleh kosong.")
    if len(text) > limit:
        raise DemoError("TOO_LONG", f"{what} is too long (max {limit} characters).",
                        f"Terlalu panjang (maks {limit} karakter).")
    return text


def _get_post(state, post_id):
    post = state["social"]["posts"].get(post_id)
    if not post or post.get("deleted"):
        raise DemoError("NOT_FOUND", "That post is no longer available.", "Postingan itu sudah tidak tersedia.")
    return post


def _require_visible_post(state, persona, post_id, now):
    post = _get_post(state, post_id)
    if not post_visible(state, post, viewer(state, persona), now):
        raise DemoError("NOT_FOUND", "That post is no longer available.", "Postingan itu sudah tidak tersedia.")
    return post


def _rate_limit(state, author, now):
    recent = [post for post in state["social"]["posts"].values()
              if post["author"] == author and now - 3600 < post["ts"] <= now and not post.get("deleted")]
    if len(recent) >= POSTS_PER_HOUR:
        raise DemoError("RATE_LIMIT", f"You can post up to {POSTS_PER_HOUR} times an hour.",
                        f"Anda bisa memposting maksimal {POSTS_PER_HOUR} kali per jam.")


def _new_post(state, now, author, text, audience, site, kind="update", cafe=None):
    post_id = E.new_id(state, "p")
    post = {
        "id": post_id,
        "author": author,
        "kind": kind,
        "text": text,
        "ts": now,
        "audience": audience,
        "building": site.get("building") if site else None,
        "city": site.get("city") if site else None,
        "cafe": cafe,
        "likes": [],
        "comments": [],
        "hidden_by": [],
        "engaged": False,
    }
    state["social"]["posts"][post_id] = post
    return post


def post_create(state, now, emp_id, text, audience="network", cafe=None, kind="update"):
    emp = _employee(state, emp_id)
    profile = emp_social(emp)
    if audience not in AUDIENCES:
        raise DemoError("BAD_AUDIENCE", "Choose who can see this post.", "Pilih siapa yang bisa melihat postingan ini.")
    if audience != "company":
        if not network_enabled(state):
            raise DemoError("NETWORK_OFF", "Your company has turned off the cross-company network.",
                            "Perusahaan Anda menonaktifkan jaringan lintas perusahaan.")
        if home(state).get("visibility") == "private":
            raise DemoError("COMPANY_PRIVATE", "Your company profile is private, so posts stay inside the company.",
                            "Profil perusahaan Anda privat, jadi postingan hanya untuk internal.")
        if profile["visibility"] != "network":
            raise DemoError("PROFILE_PRIVATE", "Make your profile visible to the network to post outside your company.",
                            "Tampilkan profil Anda ke jaringan untuk memposting ke luar perusahaan.")
    if kind not in ("update", "recommendation", "hiring", "question"):
        kind = "update"
    if cafe and cafe not in state["cafes"]:
        cafe = None
    text = _clean_text(text, MAX_POST_LEN)
    author = "emp:" + emp_id
    _rate_limit(state, author, now)
    return _new_post(state, now, author, text, audience, emp_site(state, emp), kind=kind, cafe=cafe)


def cafe_post(state, now, cafe_id, text):
    if cafe_id not in state["cafes"]:
        raise DemoError("NOT_FOUND", "Unknown café.", "Kafe tidak dikenal.")
    text = _clean_text(text, MAX_POST_LEN)
    author = "cafe:" + cafe_id
    _rate_limit(state, author, now)
    site = {"building": "", "city": CAFE_CITY.get(cafe_id, "")}
    return _new_post(state, now, author, text, "network", site, kind="announcement", cafe=cafe_id)


def post_delete(state, now, emp_id, post_id):
    post = _get_post(state, post_id)
    if post["author"] != "emp:" + emp_id:
        raise DemoError("FORBIDDEN", "You can only delete your own posts.", "Anda hanya bisa menghapus postingan sendiri.")
    post["deleted"] = True
    return {"ok": True}


def react(state, now, emp_id, post_id):
    persona = "emp:" + emp_id
    post = _require_visible_post(state, persona, post_id, now)
    likes = post.setdefault("likes", [])
    if persona in likes:
        likes.remove(persona)
        return {"liked": False, "likes": len(likes)}
    likes.append(persona)
    if post["author"].startswith("emp:") and post["author"] != persona:
        E.notify(state, post["author"][4:], now, f"{state['employees'][emp_id]['name']} liked your post.",
                 f"{state['employees'][emp_id]['name']} menyukai postingan Anda.", ref=post_id)
    return {"liked": True, "likes": len(likes)}


def comment(state, now, emp_id, post_id, text):
    persona = "emp:" + emp_id
    post = _require_visible_post(state, persona, post_id, now)
    if post.get("audience") != "company" and not network_enabled(state) and not post["author"].startswith("emp:"):
        raise DemoError("NETWORK_OFF", "Your company has turned off the cross-company network.",
                        "Perusahaan Anda menonaktifkan jaringan lintas perusahaan.")
    text = _clean_text(text, MAX_COMMENT_LEN, what="Comment")
    entry = {"id": E.new_id(state, "pc"), "by": persona, "text": text, "ts": now}
    post.setdefault("comments", []).append(entry)
    if post["author"].startswith("emp:") and post["author"] != persona:
        E.notify(state, post["author"][4:], now, f"{state['employees'][emp_id]['name']} commented on your post.",
                 f"{state['employees'][emp_id]['name']} mengomentari postingan Anda.", ref=post_id)
    return entry


def report(state, now, emp_id, post_id, reason="other"):
    persona = "emp:" + emp_id
    post = _require_visible_post(state, persona, post_id, now)
    if post["author"] == persona:
        raise DemoError("OWN_POST", "You can't report your own post.", "Anda tidak bisa melaporkan postingan sendiri.")
    if reason not in ("spam", "inappropriate", "confidential", "other"):
        reason = "other"
    social = state["social"]
    already = any(item["post"] == post_id and item["by"] == persona for item in social["reports"])
    if not already:
        social["reports"].append({"id": E.new_id(state, "rp"), "post": post_id, "by": persona, "reason": reason,
                                  "ts": now, "status": "open"})
    post.setdefault("hidden_by", [])
    if persona not in post["hidden_by"]:
        post["hidden_by"].append(persona)
    reporters = {item["by"] for item in social["reports"] if item["post"] == post_id}
    if len(reporters) >= REPORT_HIDE_THRESHOLD:
        post["report_hidden"] = True
    if author_company(state, post["author"]) == HOME_COMPANY:
        E.notify(state, "admin", now, "A post by one of your employees was reported and is waiting for review.",
                 "Postingan salah satu karyawan Anda dilaporkan dan menunggu peninjauan.", kind="warn", ref=post_id)
    return {"hidden": True, "reports": len(reporters)}


def hide_post(state, now, emp_id, post_id):
    persona = "emp:" + emp_id
    post = _require_visible_post(state, persona, post_id, now)
    post.setdefault("hidden_by", [])
    if persona not in post["hidden_by"]:
        post["hidden_by"].append(persona)
    return {"hidden": True}


def follow(state, now, emp_id, company_id, on=True):
    emp = _employee(state, emp_id)
    profile = emp_social(emp)
    company = state["social"]["companies"].get(company_id)
    if not company or company_id == HOME_COMPANY or not company_visible(state, company, viewer(state, "emp:" + emp_id)):
        raise DemoError("NOT_FOUND", "That company isn't in your network.", "Perusahaan itu tidak ada di jaringan Anda.")
    if on and company_id not in profile["follows"]:
        profile["follows"].append(company_id)
    if not on and company_id in profile["follows"]:
        profile["follows"].remove(company_id)
    return {"following": company_id in profile["follows"]}


def profile_update(state, now, emp_id, fields):
    emp = _employee(state, emp_id)
    profile = emp_social(emp)
    if "visibility" in fields:
        if fields["visibility"] not in PROFILE_VISIBILITY:
            raise DemoError("BAD_VALUE", "Unknown visibility.", "Visibilitas tidak dikenal.")
        profile["visibility"] = fields["visibility"]
    if "chat_pref" in fields:
        if fields["chat_pref"] not in CHAT_PREFS:
            raise DemoError("BAD_VALUE", "Unknown chat setting.", "Pengaturan chat tidak dikenal.")
        profile["chat_pref"] = fields["chat_pref"]
    if "headline" in fields:
        headline = " ".join(str(fields["headline"] or "").split())
        if len(headline) > 80:
            raise DemoError("TOO_LONG", "Headline is too long (max 80 characters).", "Judul terlalu panjang (maks 80 karakter).")
        profile["headline"] = headline
    if "interests" in fields:
        raw = fields["interests"]
        items = raw.split(",") if isinstance(raw, str) else list(raw or [])
        profile["interests"] = [" ".join(str(item).split())[:30] for item in items if str(item).strip()][:6]
    if "open_to" in fields:
        profile["open_to"] = [item for item in (fields["open_to"] or []) if item in OPEN_TO]
    return profile


# -- coffee chats -------------------------------------------------------------

def _person_building(state, key):
    kind, _, ident = key.partition(":")
    if kind == "member":
        return state["social"]["members"][ident]["building"]
    if kind == "emp":
        return emp_site(state, state["employees"][ident])["building"]
    return None


def can_request_chat(state, view, to_key):
    if view["kind"] != "emp":
        return False, "employees_only"
    if to_key == view["persona"]:
        return False, "self"
    if not person_visible(state, to_key, view):
        return False, "not_visible"
    kind, _, ident = to_key.partition(":")
    if kind == "member":
        pref = state["social"]["members"][ident].get("chat_pref", "anyone")
    else:
        pref = emp_social(state["employees"][ident])["chat_pref"]
    if pref == "nobody":
        return False, "closed"
    if pref == "building" and _person_building(state, to_key) not in view["buildings"]:
        return False, "building_only"
    return True, None


def chat_request(state, now, emp_id, to_key, cafe_id, slot_ts, note=""):
    _employee(state, emp_id)
    persona = "emp:" + emp_id
    view = viewer(state, persona)
    allowed, reason = can_request_chat(state, view, to_key)
    if not allowed:
        messages = {
            "closed": ("This person isn't taking coffee-chat requests right now.", "Orang ini sedang tidak menerima ajakan ngopi."),
            "building_only": ("This person only accepts requests from people in their building.",
                              "Orang ini hanya menerima ajakan dari orang di gedung yang sama."),
            "self": ("You can't invite yourself.", "Anda tidak bisa mengundang diri sendiri."),
        }
        en, id_text = messages.get(reason, ("That person isn't in your network.", "Orang itu tidak ada di jaringan Anda."))
        raise DemoError("CHAT_NOT_ALLOWED", en, id_text)
    if cafe_id not in state["cafes"] or CAFE_CITY.get(cafe_id) not in view["cities"]:
        raise DemoError("BAD_CAFE", "Pick a partner café in your city.", "Pilih kafe mitra di kota Anda.")
    slot_ts = int(slot_ts)
    if slot_ts < now + CHAT_MIN_LEAD_MIN * 60 or slot_ts > now + CHAT_MAX_DAYS * 86400:
        raise DemoError("BAD_TIME", f"Pick a time at least {CHAT_MIN_LEAD_MIN} minutes from now and within {CHAT_MAX_DAYS} days.",
                        f"Pilih waktu minimal {CHAT_MIN_LEAD_MIN} menit dari sekarang dan dalam {CHAT_MAX_DAYS} hari.")
    for chat in state["social"]["chats"].values():
        if chat["from"] == persona and chat["to"] == to_key and chat["status"] == "pending":
            raise DemoError("DUPLICATE", "You already have a pending request with this person.",
                            "Anda sudah punya ajakan yang menunggu jawaban dari orang ini.")
    note = " ".join(str(note or "").split())[:200]
    chat_id = E.new_id(state, "cc")
    chat = {"id": chat_id, "from": persona, "to": to_key, "cafe": cafe_id, "slot": slot_ts, "note": note,
            "status": "pending", "created": now, "respond_at": None}
    kind, _, ident = to_key.partition(":")
    if kind == "member":
        chat["respond_at"] = now + CHAT_REPLY_MIN * 60
    else:
        requester = state["employees"][emp_id]["name"]
        E.notify(state, ident, now, f"{requester} invited you for a coffee chat at {state['cafes'][cafe_id]['name']}.",
                 f"{requester} mengajak Anda ngopi di {state['cafes'][cafe_id]['name']}.", ref=chat_id)
    state["social"]["chats"][chat_id] = chat
    return chat


def _chat_confirmed_text(state, chat, other_name):
    cafe = state["cafes"][chat["cafe"]]
    when = E.hm(chat["slot"], cafe)
    return (f"Coffee chat confirmed with {other_name} at {cafe['name']}, {when}.",
            f"Ngopi bareng {other_name} dikonfirmasi di {cafe['name']}, {when}.")


def chat_respond(state, now, emp_id, chat_id, accept):
    chat = state["social"]["chats"].get(chat_id)
    if not chat or chat["to"] != "emp:" + emp_id:
        raise DemoError("NOT_FOUND", "That request isn't addressed to you.", "Ajakan itu bukan untuk Anda.")
    if chat["status"] != "pending":
        raise DemoError("ALREADY", "This request was already answered.", "Ajakan ini sudah dijawab.")
    chat["status"] = "accepted" if accept else "declined"
    chat["responded"] = now
    me_name = state["employees"][emp_id]["name"]
    requester = chat["from"][4:]
    if accept:
        en, id_text = _chat_confirmed_text(state, chat, me_name)
        E.notify(state, requester, now, en, id_text, kind="ok", ref=chat_id)
        from . import loyalty as _loyalty
        _loyalty.on_chat(state, now, requester)
    else:
        E.notify(state, requester, now, f"{me_name} can't make the coffee chat.", f"{me_name} tidak bisa ikut ngopi.", ref=chat_id)
    return {"status": chat["status"]}


def chat_cancel(state, now, emp_id, chat_id):
    chat = state["social"]["chats"].get(chat_id)
    if not chat or chat["from"] != "emp:" + emp_id:
        raise DemoError("NOT_FOUND", "That request isn't yours.", "Ajakan itu bukan milik Anda.")
    if chat["status"] not in ("pending", "accepted"):
        raise DemoError("ALREADY", "This request is already closed.", "Ajakan ini sudah ditutup.")
    chat["status"] = "cancelled"
    if chat["to"].startswith("emp:"):
        name = state["employees"][emp_id]["name"]
        E.notify(state, chat["to"][4:], now, f"{name} cancelled the coffee chat.", f"{name} membatalkan ajakan ngopi.", ref=chat_id)
    return {"status": "cancelled"}


# -- meetups ------------------------------------------------------------------

def meetup_rsvp(state, now, emp_id, meetup_id, going=True):
    persona = "emp:" + emp_id
    meetup = state["social"]["meetups"].get(meetup_id)
    if not meetup or not meetup_visible(state, meetup, viewer(state, persona), now):
        raise DemoError("NOT_FOUND", "That meetup isn't available.", "Meetup itu tidak tersedia.")
    attendees = meetup["attendees"]
    if not going:
        attendees.pop(persona, None)
        return {"going": False, "count": len(attendees)}
    if persona in attendees:
        return {"going": True, "count": len(attendees)}
    if meetup["start"] <= now:
        raise DemoError("STARTED", "This meetup has already started.", "Meetup ini sudah dimulai.")
    if len(attendees) >= meetup["capacity"]:
        raise DemoError("FULL", "This meetup is full.", "Meetup ini sudah penuh.")
    cap = meetup.get("max_per_company", 0)
    if cap and sum(1 for company in attendees.values() if company == HOME_COMPANY) >= cap:
        raise DemoError("COMPANY_CAP", f"Up to {cap} people per company can join, so every company gets a seat.",
                        f"Maksimal {cap} orang per perusahaan, agar setiap perusahaan kebagian tempat.")
    attendees[persona] = HOME_COMPANY
    from . import loyalty as _loyalty
    _loyalty.on_meetup(state, now, emp_id)
    cafe = state["cafes"][meetup["cafe"]]
    E.notify(state, emp_id, now, f"You're going to {meetup['title']} — {cafe['name']}, {E.hm(meetup['start'], cafe)}.",
             f"Anda akan hadir di {meetup['title']} — {cafe['name']}, {E.hm(meetup['start'], cafe)}.", kind="ok", ref=meetup_id)
    return {"going": True, "count": len(attendees)}


def meetup_create(state, now, host, cafe_id, title, start_ts, capacity=12, max_per_company=4, audience="network",
                  description=""):
    if cafe_id not in state["cafes"]:
        raise DemoError("BAD_CAFE", "Pick a partner café.", "Pilih kafe mitra.")
    view = viewer(state, host)
    city = CAFE_CITY.get(cafe_id)
    if view["kind"] == "emp" and city not in view["cities"]:
        raise DemoError("BAD_CAFE", "Pick a partner café in your city.", "Pilih kafe mitra di kota Anda.")
    if view["kind"] == "emp" and not network_enabled(state):
        raise DemoError("NETWORK_OFF", "Your company has turned off the cross-company network.",
                        "Perusahaan Anda menonaktifkan jaringan lintas perusahaan.")
    title = _clean_text(title, 80, what="Title")
    start_ts = int(start_ts)
    if start_ts < now + 30 * 60:
        raise DemoError("BAD_TIME", "Schedule meetups at least 30 minutes ahead.", "Jadwalkan meetup minimal 30 menit sebelumnya.")
    capacity = max(2, min(200, int(capacity)))
    max_per_company = max(0, min(capacity, int(max_per_company)))
    if audience not in ("network", "building"):
        audience = "network"
    meetup_id = E.new_id(state, "mu")
    building = view["site"]["building"] if view.get("site") else ""
    meetup = {"id": meetup_id, "title": title, "description": " ".join(str(description or "").split())[:300],
              "host": host, "cafe": cafe_id, "start": start_ts, "duration_min": 60, "capacity": capacity,
              "max_per_company": max_per_company, "audience": audience, "city": city, "building": building,
              "attendees": {}}
    if view["kind"] == "emp":
        meetup["attendees"][host] = HOME_COMPANY
    state["social"]["meetups"][meetup_id] = meetup
    return meetup


# -- company admin --------------------------------------------------------------

def company_settings(state, now, fields):
    company = home(state)
    if "visibility" in fields:
        if fields["visibility"] not in COMPANY_VISIBILITY:
            raise DemoError("BAD_VALUE", "Unknown visibility.", "Visibilitas tidak dikenal.")
        company["visibility"] = fields["visibility"]
    for key in ("participation", "share_stats"):
        if key in fields:
            company[key] = bool(fields[key])
    if "about" in fields:
        about = " ".join(str(fields["about"] or "").split())
        if len(about) > 300:
            raise DemoError("TOO_LONG", "About text is too long (max 300 characters).", "Deskripsi terlalu panjang (maks 300 karakter).")
        company["about"] = about
    return {key: company.get(key) for key in ("visibility", "participation", "share_stats", "about")}


def company_block(state, now, company_id, on=True):
    if company_id == HOME_COMPANY or company_id not in state["social"]["companies"]:
        raise DemoError("NOT_FOUND", "Unknown company.", "Perusahaan tidak dikenal.")
    blocked = home(state).setdefault("blocked", [])
    if on and company_id not in blocked:
        blocked.append(company_id)
    if not on and company_id in blocked:
        blocked.remove(company_id)
    return {"blocked": company_id in blocked}


def moderate(state, now, post_id, decision):
    post = _get_post(state, post_id)
    if author_company(state, post["author"]) != HOME_COMPANY:
        raise DemoError("FORBIDDEN", "You can only moderate posts by your own employees.",
                        "Anda hanya bisa memoderasi postingan karyawan sendiri.")
    if decision not in ("remove", "keep"):
        raise DemoError("BAD_VALUE", "Choose remove or keep.", "Pilih hapus atau pertahankan.")
    post["removed"] = decision == "remove"
    if decision == "keep":
        post["report_hidden"] = False
        post["hidden_by"] = []
    for item in state["social"]["reports"]:
        if item["post"] == post_id and item["status"] == "open":
            item["status"] = "removed" if decision == "remove" else "kept"
    if decision == "remove" and post["author"].startswith("emp:"):
        E.notify(state, post["author"][4:], now, "Your post was removed by your company admin after a report.",
                 "Postingan Anda dihapus oleh admin perusahaan setelah dilaporkan.", kind="warn", ref=post_id)
    return {"removed": post["removed"]}


# ---------------------------------------------------------------------------
# Simulated activity from people at other companies
# ---------------------------------------------------------------------------

def _visible_members_for(state, post):
    """Members from other companies who could plausibly see this post (deterministic order)."""
    names = []
    for member_id, member in sorted(state["social"]["members"].items()):
        if post["audience"] == "company":
            continue
        if post["audience"] == "building" and member["building"] != post.get("building"):
            continue
        if member["city"] != post.get("city"):
            continue
        company = state["social"]["companies"][member["company"]]
        if company.get("visibility") == "private":
            continue
        names.append(member_id)
    return names


def tick(state, now):
    social = state.get("social")
    if not social:
        return False
    changed = False
    for chat in social["chats"].values():
        if chat["status"] != "pending" or not chat.get("respond_at") or now < chat["respond_at"]:
            continue
        member = social["members"].get(chat["to"].partition(":")[2])
        if not member:
            continue
        requester = chat["from"][4:]
        cafe = state["cafes"][chat["cafe"]]
        local_hour = int(E.hm(chat["slot"], cafe).split(":")[0])
        accept = member.get("accepts", True) and 7 <= local_hour < 18
        chat["status"] = "accepted" if accept else "declined"
        chat["responded"] = now
        if accept:
            en, id_text = _chat_confirmed_text(state, chat, member["name"])
            E.notify(state, requester, now, en, id_text, kind="ok", ref=chat["id"])
            from . import loyalty as _loyalty
            _loyalty.on_chat(state, now, requester)
        else:
            chat["reason"] = member.get("decline_reason", "Busy at that time — suggests another day.")
            E.notify(state, requester, now, f"{member['name']} can't make it: {chat['reason']}",
                     f"{member['name']} tidak bisa: {member.get('decline_reason_id', chat['reason'])}", ref=chat["id"])
        changed = True
    for post in social["posts"].values():
        if post.get("engaged") or not post["author"].startswith("emp:") or post.get("deleted") or post.get("removed"):
            continue
        if now - post["ts"] < 120:
            continue
        post["engaged"] = True
        audience = _visible_members_for(state, post)
        if audience and network_enabled(state) and home(state).get("visibility") != "private":
            seed = sum(ord(char) for char in post["id"])
            for offset in range(min(2, len(audience))):
                key = "member:" + audience[(seed + offset) % len(audience)]
                if key not in post["likes"]:
                    post["likes"].append(key)
            author_id = post["author"][4:]
            E.notify(state, author_id, now, f"Your post is getting views from {len(audience)} people nearby.",
                     f"Postingan Anda dilihat {len(audience)} orang di sekitar.", ref=post["id"])
        changed = True
    return changed
