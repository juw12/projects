"""
Respark Bridge - hermetic end-to-end verification.

Boots the server on a temp DB and a free port, then walks the whole bridge flow:
operator onboarding, portals, hub, inquiries, matching, introductions,
owner isolation, deal tracking, outreach integration.

Usage:
    RESPARK_SECRET=test python tests/verify_bridge.py
"""

import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

TMP = tempfile.mkdtemp(prefix="respark-bridge-test-")
os.environ.setdefault("RESPARK_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("RESPARK_BASE_URL", "http://localhost")
os.environ.setdefault("RESPARK_ALLOW_SIGNUP", "1")
os.environ["RESPARK_SMTP_HOST"] = ""
os.environ.pop("RESPARK_OPERATOR_EMAILS", None)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "server")))

import server  # noqa: E402

# Talk to 127.0.0.1 directly even when a corporate HTTP(S)_PROXY is configured.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = {}

    def request(self, method, path, body=None, expect_status=None, follow=True):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if self.cookies:
            req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in self.cookies.items()))
        opener = OPENER if follow else urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect())
        try:
            with opener.open(req, timeout=15) as r:
                status, headers, raw = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            status, headers, raw = e.code, e.headers, e.read()
        for h in (headers.get_all("Set-Cookie") or []) if headers else []:
            kv = h.split(";")[0]
            if "=" in kv:
                k, v = kv.split("=", 1)
                if v == "" or "Max-Age=0" in h:
                    self.cookies.pop(k, None)
                else:
                    self.cookies[k] = v
        ctype = headers.get("Content-Type", "") if headers else ""
        if ctype.startswith("application/json"):
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        else:
            payload = raw.decode("utf-8", errors="replace")
        if expect_status is not None:
            assert status == expect_status, f"{method} {path} -> {status} (expected {expect_status}): {str(payload)[:300]}"
        return status, payload, headers


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run():
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server.DB_PATH = os.path.join(TMP, "data.db")
    server.LOG_FILE = os.path.join(TMP, "outbox.log")
    server.APP_LOG = os.path.join(TMP, "app.log")
    server.init_db()
    server.load_web()

    httpd = server.ThreadedServer(("127.0.0.1", port), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)

    failures = []

    def check(label, cond, detail=""):
        print(("  OK   " if cond else "  FAIL ") + label + ("" if cond else f"  {detail}"))
        if not cond:
            failures.append(label)

    try:
        op = Client(base)
        anon = Client(base)

        # --- operator + public pages
        op.request("POST", "/api/auth/signup", {"email": "me@bridge.test", "password": "operator-pass-1"}, expect_status=200)
        s, me, _ = op.request("GET", "/api/ic/me", expect_status=200)
        check("first account is the operator", me.get("is_operator") is True)

        s, html, _ = anon.request("GET", "/hub", expect_status=200)
        check("hub page serves", "We introduce investors" in html)
        s, css, h = anon.request("GET", "/ic/styles.css", expect_status=200)
        check("portal assets served", "text/css" in h.get("Content-Type", "") and ".topbar" in css)
        s, d, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        check("directory starts empty", d["companies"] == [] and d["hub"] == "Titian")
        s, _, _ = anon.request("GET", "/bridge", follow=False)
        check("dashboard requires login (redirect)", s in (301, 302))

        # --- onboard company A from the dashboard (creates owner account)
        s, a, _ = op.request("POST", "/api/ic/companies",
                             {"name": "Delta Gearworks", "owner_email": "owner@delta.test", "country": "Surabaya"},
                             expect_status=200)
        check("company created as draft with slug", a.get("slug") == "delta-gearworks")
        check("owner account created with temp password", bool(a.get("temp_password")))
        a_id = a["company_id"]

        s, _, _ = anon.request("GET", "/c/delta-gearworks/")
        check("draft portal hidden from public", s == 404)
        s, page, _ = op.request("GET", "/c/delta-gearworks/", expect_status=200)
        check("operator can preview draft portal", '<div id="app"' not in page and 'id="app"' in page)
        s, js, _ = op.request("GET", "/c/delta-gearworks/data.js", expect_status=200)
        check("portal data.js injects hosted config", "window.IC_CONFIG" in js and '"slug": "delta-gearworks"' in js)

        # customise A: gears only, sources packaging (so supplier matching prefers company B)
        s, full, _ = op.request("GET", f"/api/ic/companies/{a_id}", expect_status=200)
        data_a = full["data"]
        data_a["company"]["name"] = "Delta Gearworks"
        data_a["products"] = [p for p in data_a["products"] if p["model"] in ("gear", "shaft")]
        data_a["suppliers"]["categories"] = [{"name": "Export packaging", "detail": "Wooden crates", "volume": "Ongoing"}]
        op.request("POST", f"/api/ic/companies/{a_id}/update",
                   {"data": data_a, "seeking": ["customers", "investment"]}, expect_status=200)
        s, _, _ = op.request("POST", f"/api/ic/companies/{a_id}/update", {"data": {"products": []}})
        check("invalid portal data rejected", s == 400)
        op.request("POST", f"/api/ic/companies/{a_id}/update", {"status": "published"}, expect_status=200)
        s, d, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        check("published company appears on hub", [c["slug"] for c in d["companies"]] == ["delta-gearworks"])
        check("directory exposes no internal ids", "id" not in d["companies"][0] and "owner_user_id" not in d["companies"][0])
        s, _, h = anon.request("GET", "/c/delta-gearworks", follow=False)
        check("portal path redirects to trailing slash", s == 301 and h.get("Location") == "/c/delta-gearworks/")
        anon.request("GET", "/c/delta-gearworks/", expect_status=200)

        # --- company B through Respark's outreach pipeline (manufacturer industry)
        csv_text = "business_name,contact_name,email,industry,city\nNordic Castings,Ana Berg,ana@nordic.test,manufacturer,Gothenburg\n"
        s, imp, _ = op.request("POST", "/api/outreach/leads/import", {"csv": csv_text}, expect_status=200)
        check("manufacturer lead imported", imp.get("imported") == 1)
        with server._db_lock, server.db() as conn:
            body = conn.execute("SELECT body FROM outreach_emails ORDER BY sequence_num LIMIT 1").fetchone()["body"]
        check("manufacturer outreach email links to the hub", "/hub" in body and "{{" not in body)
        s, leads, _ = op.request("GET", "/api/outreach/leads", expect_status=200)
        lead_id = leads["leads"][0]["id"]
        s, closed, _ = op.request("POST", f"/api/outreach/leads/{lead_id}/close",
                                  {"client_email": "ana@nordic.test", "industry": "manufacturer"}, expect_status=200)
        check("closing manufacturer lead creates a draft portal", bool(closed.get("portal")) and closed.get("campaign_id") is None)
        s, comps, _ = op.request("GET", "/api/ic/companies", expect_status=200)
        b = [c for c in comps["companies"] if c["slug"] == "nordic-castings"][0]
        op.request("POST", f"/api/ic/companies/{b['id']}/update", {"status": "published", "seeking": ["suppliers"]}, expect_status=200)

        # --- public inquiries
        s, r1, _ = anon.request("POST", "/api/ic/inquiries", {
            "company": "delta-gearworks", "type": "customer",
            "fields": {"name": "Erik", "company": "Mining Drives AB", "email": "erik@drives.test", "volume": "500 – 5,000 pcs/yr",
                       "timeline": "1 – 3 months", "items": ["HG-200 Spur & Helical Gears × 400"], "message": "Need 400 helical gears module 4, 42CrMo4, ground DIN 6."}},
            expect_status=200)
        check("portal inquiry accepted with reference", r1.get("ref", "").startswith("IC-"))
        s, r2, _ = anon.request("POST", "/api/ic/inquiries", {
            "company": None, "type": "supplier",
            "fields": {"name": "Ravi", "company": "Steelworks Ltd", "email": "ravi@steel.test", "categories": ["steel bar", "forgings"],
                       "certifications": ["ISO 9001"], "message": "We supply 42CrMo4 steel bar and closed-die forgings."}},
            expect_status=200)
        check("hub request accepted", r2.get("ok") is True)
        s, _, _ = anon.request("POST", "/api/ic/inquiries", {"type": "customer", "fields": {"email": "not-an-email"}})
        check("invalid email rejected", s == 400)
        s, _, _ = anon.request("POST", "/api/ic/inquiries", {"company": "nope", "type": "customer", "fields": {"email": "a@b.co"}})
        check("unknown company rejected", s == 404)
        s, hp, _ = anon.request("POST", "/api/ic/inquiries", {"type": "general", "hp": "bot", "fields": {"email": "bot@spam.test"}}, expect_status=200)
        s, listing, _ = anon.request("POST", "/api/ic/inquiries", {
            "type": "listing", "fields": {"company": "Prima Plastics", "email": "info@prima.test"}}, expect_status=200)

        s, inq, _ = op.request("GET", "/api/ic/inquiries", expect_status=200)
        items = inq["inquiries"]
        check("operator sees all real inquiries (honeypot dropped)", len(items) == 3, str(len(items)))
        portal_q = [q for q in items if q["type"] == "customer"][0]
        hub_q = [q for q in items if q["type"] == "supplier"][0]
        # 1 item (10) + 500-5,000 pcs/yr (25) + 1-3 months (15) = 50, same rules as the portal
        check("server-side lead scoring matches portal rules", portal_q["score"] == 50, str(portal_q["score"]))
        check("via_bridge: portal inquiry waits for screening", portal_q["status"] == "new" and portal_q["intros"] == [])
        with server._db_lock, server.db() as conn:
            hub_lead = conn.execute("SELECT * FROM leads WHERE source='hub'").fetchone()
        check("listing request lands in outreach pipeline", hub_lead is not None and hub_lead["industry"] == "manufacturer")

        # --- owner isolation before introduction
        owner = Client(base)
        owner.request("POST", "/api/auth/login", {"email": "owner@delta.test", "password": a["temp_password"]}, expect_status=200)
        s, mine, _ = owner.request("GET", "/api/ic/inquiries", expect_status=200)
        check("owner sees nothing until the bridge introduces", mine["inquiries"] == [] and mine["is_operator"] is False)
        s, _, _ = owner.request("GET", "/api/outreach/leads")
        check("client cannot access operator outreach API", s == 403)
        s, _, _ = owner.request("POST", f"/api/ic/companies/{a_id}/update", {"status": "archived"})
        check("client cannot publish/unpublish", s == 403)
        s, _, _ = owner.request("GET", f"/api/ic/companies/{b['id']}")
        check("client cannot read another company", s == 404)
        s, _, _ = owner.request("GET", f"/api/ic/inquiries/{hub_q['id']}/matches")
        check("client cannot run matching", s == 403)

        # --- matching + introductions
        s, m, _ = op.request("GET", f"/api/ic/inquiries/{hub_q['id']}/matches", expect_status=200)
        check("supplier request matched to the company sourcing steel first",
              bool(m["matches"]) and m["matches"][0]["slug"] == "nordic-castings", json.dumps(m["matches"])[:300])
        s, m2, _ = op.request("GET", f"/api/ic/inquiries/{portal_q['id']}/matches", expect_status=200)
        check("portal inquiry suggests its own company first", m2["matches"][0]["slug"] == "delta-gearworks")

        s, intro_a, _ = op.request("POST", f"/api/ic/inquiries/{portal_q['id']}/introduce",
                                   {"company_id": a_id, "note": "Strong fit for your DIN 6 line", "notify_requester": True}, expect_status=200)
        check("introduction created and emailed", intro_a.get("emailed") is True)
        s, _, _ = op.request("POST", f"/api/ic/inquiries/{portal_q['id']}/introduce", {"company_id": a_id})
        check("duplicate introduction rejected", s == 409)
        op.request("POST", f"/api/ic/inquiries/{hub_q['id']}/introduce",
                   {"company_id": b["id"], "share_contact": False}, expect_status=200)

        s, mine, _ = owner.request("GET", "/api/ic/inquiries", expect_status=200)
        check("owner now sees exactly their introduction", len(mine["inquiries"]) == 1 and mine["inquiries"][0]["ref"] == r1["ref"])
        first = mine["inquiries"][0]
        check("contact locked until the company accepts the terms",
              first["intro_note"].startswith("Strong fit") and first["email"] is None
              and first["needs_acceptance"] is True and "success fee" in first["terms"])
        s, _, _ = owner.request("POST", f"/api/ic/intros/{first['intro_id']}/patch", {"status": "in_talks"})
        check("company cannot progress an intro without accepting", s == 409)
        s, _, _ = anon.request("POST", f"/api/ic/intros/{first['intro_id']}/accept", {})
        check("only the company owner can accept", s == 401)
        owner.request("POST", f"/api/ic/intros/{first['intro_id']}/accept", {}, expect_status=200)
        s, mine, _ = owner.request("GET", "/api/ic/inquiries", expect_status=200)
        check("accepting unlocks the contact and records the terms",
              mine["inquiries"][0]["email"] == "erik@drives.test" and mine["inquiries"][0]["intro_status"] == "accepted")
        with server._db_lock, server.db() as conn:
            accepted = conn.execute("SELECT terms_accepted_at, terms_text, responded_at FROM ic_intros WHERE id=?",
                                    (first["intro_id"],)).fetchone()
        check("acceptance audit trail stored", bool(accepted["terms_accepted_at"] and accepted["terms_text"] and accepted["responded_at"]))

        owner_b = Client(base)
        owner_b.request("POST", "/api/auth/login", {"email": "ana@nordic.test", "password": closed["client_password"]}, expect_status=200)
        s, mine_b, _ = owner_b.request("GET", "/api/ic/inquiries", expect_status=200)
        qb = mine_b["inquiries"][0]
        check("contact hidden when operator withholds it", qb["email"] is None and "email" not in qb["fields"])

        owner.request("POST", f"/api/ic/intros/{mine['inquiries'][0]['intro_id']}/patch", {"status": "in_talks"}, expect_status=200)
        s, inq, _ = op.request("GET", "/api/ic/inquiries?type=customer", expect_status=200)
        check("owner progress flows back to the operator", inq["inquiries"][0]["status"] == "in_talks")

        # --- deal tracking
        op.request("POST", f"/api/ic/inquiries/{portal_q['id']}/patch",
                   {"status": "won", "deal_value": 120000, "fee": 3600, "notes": "3% success fee"}, expect_status=200)
        s, st, _ = op.request("GET", "/api/ic/stats", expect_status=200)
        check("stats track won deals and fees", st["won"] == 1 and st["fees_won"] == 3600 and st["deal_value_won"] == 120000)
        check("stats count introductions", st["intros"] == 2)

        # --- traffic + routing=direct
        anon.request("POST", "/api/ic/track", {"company": "delta-gearworks", "page": "product:hg-200"}, expect_status=200)
        s, ost, _ = owner.request("GET", "/api/ic/stats", expect_status=200)
        check("owner sees portal traffic", ost["views_30d"] >= 1)
        op.request("POST", f"/api/ic/companies/{a_id}/update", {"routing": "direct"}, expect_status=200)
        anon.request("POST", "/api/ic/inquiries", {"company": "delta-gearworks", "type": "investor",
                                                    "fields": {"name": "Maya", "firm": "Harbor PE", "email": "maya@harbor.test",
                                                               "ticket": "USD 5–15M", "investorType": "Private equity", "nda": "yes"}},
                     expect_status=200)
        s, mine, _ = owner.request("GET", "/api/ic/inquiries", expect_status=200)
        check("routing=direct delivers portal inquiries straight to the owner", len(mine["inquiries"]) == 2)

        # --- trust layer: operator-issued verification badge
        os.environ["RESPARK_OPERATOR_WHATSAPP"] = "+62 812-3456-7890"
        s, _, _ = owner.request("POST", f"/api/ic/companies/{a_id}/verify",
                                {"checks": {"registration": True, "site_visit": True}})
        check("owner cannot verify their own company", s == 403)
        s, full, _ = owner.request("GET", f"/api/ic/companies/{a_id}", expect_status=200)
        sneaky = full["data"]
        sneaky["verification"] = {"verified": True}
        sneaky["contact"]["whatsapp"] = "+62 811 000 111"
        sneaky["products"][0]["name"] = "Gear </script><script>alert(1)</script>"
        owner.request("POST", f"/api/ic/companies/{a_id}/update", {"data": sneaky}, expect_status=200)
        s, d, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        delta = [c for c in d["companies"] if c["slug"] == "delta-gearworks"][0]
        check("badge cannot be faked through portal content", delta["verification"]["verified"] is False)

        s, _, _ = op.request("POST", f"/api/ic/companies/{b['id']}/verify", {"checks": {}})
        check("verification needs at least one check", s == 400)
        op.request("POST", f"/api/ic/companies/{b['id']}/verify",
                   {"checks": {"registration": True, "site_visit": True, "certificates": True},
                    "registration_no": "NIB 9120001234567", "note": "Visited plant 12 Oct, met QA lead"}, expect_status=200)
        op.request("POST", f"/api/ic/companies/{a_id}/verify", {"checks": {"certificates": True}}, expect_status=200)
        s, d, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        by_slug = {c["slug"]: c for c in d["companies"]}
        check("registration + site visit earns the public badge", by_slug["nordic-castings"]["verification"]["verified"] is True)
        check("certificates alone is only partial", by_slug["delta-gearworks"]["verification"]["status"] == "partial")
        check("verified companies listed first on the hub", d["companies"][0]["slug"] == "nordic-castings")
        check("private verification note never public", "Visited plant" not in json.dumps(d))
        s, js_b, _ = anon.request("GET", "/c/nordic-castings/data.js", expect_status=200)
        check("portal receives the badge server-side", '"verified": true' in js_b and "NIB 9120001234567" in js_b and "Visited plant" not in js_b)

        with server._db_lock, server.db() as conn:
            raw = json.loads(conn.execute("SELECT verification_json FROM ic_companies WHERE id=?", (b["id"],)).fetchone()[0])
            raw["verified_at"] = "2020-01-01T00:00:00+00:00"
            conn.execute("UPDATE ic_companies SET verification_json=? WHERE id=?", (json.dumps(raw), b["id"]))
        s, d, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        nordic = [c for c in d["companies"] if c["slug"] == "nordic-castings"][0]
        check("badge expires after 12 months", nordic["verification"]["status"] == "expired" and nordic["verification"]["verified"] is False)
        op.request("POST", f"/api/ic/companies/{b['id']}/verify",
                   {"checks": {"registration": True, "site_visit": True}}, expect_status=200)

        # --- WhatsApp handoff keeps brokered chats with the operator
        check("hub hands chats to the operator number", d.get("whatsapp") == "6281234567890")
        check("via-bridge portal chats go to the operator", '"whatsapp": "6281234567890"' in js_b)
        s, js_a, _ = anon.request("GET", "/c/delta-gearworks/data.js", expect_status=200)
        check("direct-routing portal chats go to the company", '"whatsapp": "62811000111"' in js_a)

        # --- SEO: real HTML for crawlers and link previews
        s, page_b, _ = anon.request("GET", "/c/nordic-castings/", expect_status=200)
        check("portal page has company title and description", "<title>Nordic Castings" in page_b and '<meta name="description"' in page_b)
        check("portal page has schema.org JSON-LD and canonical",
              'application/ld+json' in page_b and '"@type": "Organization"' in page_b and 'rel="canonical"' in page_b)
        check("portal page has crawlable product list", "<noscript>" in page_b and "<li><b>" in page_b and "noindex" not in page_b)
        s, page_a, _ = anon.request("GET", "/c/delta-gearworks/", expect_status=200)
        check("product names cannot break out of JSON-LD/HTML", "</script><script>alert(1)" not in page_a and "alert(1)" in page_a)
        s, draft, _ = op.request("POST", "/api/ic/companies", {"name": "Hidden Draft Co"}, expect_status=200)
        s, draft_page, _ = op.request("GET", "/c/hidden-draft-co/", expect_status=200)
        check("draft previews are noindex", "noindex" in draft_page)
        s, sm, h = anon.request("GET", "/sitemap.xml", expect_status=200)
        check("sitemap lists hub and published portals only",
              "xml" in h.get("Content-Type", "") and "/hub</loc>" in sm and "/c/nordic-castings/" in sm
              and "/c/delta-gearworks/" in sm and "hidden-draft-co" not in sm)
        s, rb, _ = anon.request("GET", "/robots.txt", expect_status=200)
        check("robots.txt hides private areas and points to sitemap", "Disallow: /api/" in rb and "Disallow: /bridge" in rb and "Sitemap:" in rb)
        os.environ.pop("RESPARK_OPERATOR_WHATSAPP", None)

        # --- verified reviews: only the requester of a won introduction can rate
        with server._db_lock, server.db() as conn:
            review = conn.execute("SELECT r.token, i.status FROM ic_reviews r JOIN ic_intros i ON i.id = r.intro_id").fetchone()
        check("closing the deal creates one review request", review is not None and review["status"] == "won")
        with open(server.LOG_FILE, "r", encoding="utf-8") as f:
            check("buyer emailed a private review link", "/r/" + review["token"] in f.read())
        s, form_page, _ = anon.request("GET", "/r/" + review["token"], expect_status=200)
        check("review page names the company", "How was Delta Gearworks" in form_page)
        s, _, _ = anon.request("GET", "/r/" + "x" * 24)
        check("unknown review link rejected", s == 404)
        bad = urllib.request.Request(base + "/r/" + review["token"], data=b"rating=9", method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        try:
            status_bad = OPENER.open(bad).status
        except urllib.error.HTTPError as err:
            status_bad = err.code
        check("out-of-range rating rejected", status_bad == 400)
        for body in (b"rating=5&comment=On+time%2C+DIN+6+as+promised&reviewer_name=Erik+%28Mining+Drives%29", b"rating=1"):
            OPENER.open(urllib.request.Request(base + "/r/" + review["token"], data=body, method="POST",
                                                        headers={"Content-Type": "application/x-www-form-urlencoded"}))
        s, js_rev, _ = anon.request("GET", "/c/delta-gearworks/data.js", expect_status=200)
        check("review published once and cannot be overwritten",
              '"rating": 5' in js_rev and "DIN 6 as promised" in js_rev and '"rating": 1' not in js_rev)

        # --- track record: earned through real introductions
        s, extra, _ = anon.request("POST", "/api/ic/inquiries", {
            "type": "customer", "fields": {"name": "Lena", "company": "Kiln Works", "email": "lena@kiln.test",
                                           "message": "Helical gears and shafts for kiln drives"}}, expect_status=200)
        s, inq, _ = op.request("GET", "/api/ic/inquiries?type=customer", expect_status=200)
        extra_q = [q for q in inq["inquiries"] if q["email"] == "lena@kiln.test"][0]
        s, m3, _ = op.request("GET", f"/api/ic/inquiries/{extra_q['id']}/matches", expect_status=200)
        delta_match = [m for m in m3["matches"] if m["slug"] == "delta-gearworks"]
        check("matching ranks proven companies using outcomes",
              bool(delta_match) and any("deal(s) won here" in r for r in delta_match[0]["reasons"])
              and any("rated 5.0/5" in r for r in delta_match[0]["reasons"]), json.dumps(m3["matches"])[:300])
        s, d_before, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        t_before = [c for c in d_before["companies"] if c["slug"] == "delta-gearworks"][0]["track"]
        check("response stats hidden until enough history", t_before["introductions"] == 2 and t_before["response_rate"] is None)
        s, intro_x, _ = op.request("POST", f"/api/ic/inquiries/{extra_q['id']}/introduce", {"company_id": a_id}, expect_status=200)
        owner.request("POST", f"/api/ic/intros/{intro_x['intro_id']}/accept", {}, expect_status=200)
        s, d_after, _ = anon.request("GET", "/api/ic/directory", expect_status=200)
        t = [c for c in d_after["companies"] if c["slug"] == "delta-gearworks"][0]["track"]
        check("track record public after 3 introductions",
              t["introductions"] == 3 and t["response_rate"] == 67 and t["median_response_hours"] is not None
              and t["deals_won"] == 1 and t["rating"] == 5.0 and t["reviews"] == 1, json.dumps(t))

        # --- emails written to the outbox (no SMTP in tests)
        with open(server.LOG_FILE, "r", encoding="utf-8") as f:
            outbox = f.read()
        check("operator notified of new inquiries", "me@bridge.test" in outbox and "New customer inquiry" in outbox)
        check("company emailed the introduction", "owner@delta.test" in outbox and "Introduction: customer" in outbox)
        check("requester told about the introduction", "erik@drives.test" in outbox)
        emails = [block for block in outbox.split("\n--- ") if block.strip()]
        to_b = [e for e in emails if "To: ana@nordic.test" in e and "Introduction" in e]
        check("company B received its introduction", len(to_b) == 1)
        check("withheld contact not leaked to company B", bool(to_b) and "ravi@steel.test" not in to_b[0] and "Reply to this email" in to_b[0])
        to_a = [e for e in emails if "To: owner@delta.test" in e and "Introduction: customer" in e]
        check("intro email withholds contact until terms accepted",
              bool(to_a) and "erik@drives.test" not in to_a[0] and "Accept the introduction" in to_a[0])

    finally:
        httpd.shutdown()
        httpd.server_close()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("All bridge checks passed.")


if __name__ == "__main__":
    run()
