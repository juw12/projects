#!/usr/bin/env python3
"""End-to-end API test for the Sheetmint server. Hermetic: temp database, free port.
Standard library only. Exit 0 on success, 1 on failure."""

import http.cookiejar
import json
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))
import server as sm  # noqa: E402

failures = []


def check(cond, msg):
    print(("ok - " if cond else "FAIL - ") + msg)
    if not cond:
        failures.append(msg)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, method, path, body=None, content_type="application/json"):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", content_type)
        try:
            with self.opener.open(req, timeout=10) as res:
                return res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")


SPEC = {
    "title": "Test budget",
    "theme": "mint",
    "currency": "USD",
    "sheet": {"name": "Data", "columns": [{"id": "c1", "name": "Item", "type": "text"}, {"id": "c2", "name": "Cost", "type": "currency"}],
              "rows": [{"id": "r1", "c1": "Rent", "c2": 100}]},
    "summary": [{"label": "Total", "fn": "SUM", "column": "Cost"}],
    "rules": [],
}


def main():
    tmp = tempfile.TemporaryDirectory()
    port = free_port()
    httpd, store = sm.make_server("127.0.0.1", port, Path(tmp.name) / "t.db", fee_pct=10, seed=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}/api"
    try:
        anon = Client(base)
        status, body = anon.call("GET", "/health")
        check(status == 200 and body.get("mode") == "server", "health endpoint")
        status, body = anon.call("GET", "/listings")
        seeded = body.get("listings", [])
        check(status == 200 and len(seeded) >= 10, f"seed catalogue loaded ({len(seeded)} listings)")
        status, _ = anon.call("POST", "/templates", {"spec": SPEC})
        check(status == 401, "templates require login")

        seller, buyer, partner = Client(base), Client(base), Client(base)
        check(seller.call("POST", "/auth/register", {"email": "sell@x.io", "name": "Sella", "password": "short"})[0] == 400, "short password rejected")
        check(seller.call("POST", "/auth/register", {"email": "sell@x.io", "name": "Sella", "password": "correct-horse"})[0] == 201, "seller registers")
        check(seller.call("POST", "/auth/register", {"email": "SELL@x.io", "name": "Dup", "password": "correct-horse"})[0] == 409, "duplicate email rejected (case-insensitive)")
        check(buyer.call("POST", "/auth/register", {"email": "buy@x.io", "name": "Bayu", "password": "correct-horse"})[0] == 201, "buyer registers")
        check(partner.call("POST", "/auth/register", {"email": "aff@x.io", "name": "Affi Partner", "password": "correct-horse"})[0] == 201, "affiliate registers")

        status, body = seller.call("POST", "/templates", {"spec": SPEC})
        check(status == 200 and body["template"]["id"].startswith("t_"), "seller saves a draft template")
        template_id = body["template"]["id"]
        status, body = buyer.call("POST", "/templates", {"id": template_id, "spec": SPEC})
        check(status == 403, "cannot overwrite someone else’s template")
        check(seller.call("POST", "/templates", {"spec": {"sheet": {"columns": []}}})[0] == 400, "invalid spec rejected")

        status, body = seller.call("POST", "/listings", {"templateId": template_id, "title": "Budget Pro", "description": "Nice budget", "category": "Finance",
                                                          "price": 10, "currency": "USD", "commissionPct": 30, "tags": ["budget"], "spec": SPEC})
        check(status == 201, "seller publishes a listing")
        listing_id = body["listing"]["id"]
        check(seller.call("POST", "/listings", {"title": "X", "description": "Y", "price": 1, "commissionPct": 80, "spec": SPEC})[0] == 400, "commission over 50% rejected")
        check(seller.call("POST", "/listings", {"title": "X", "description": "Y", "price": 1, "paymentUrl": "http://evil", "spec": SPEC})[0] == 400, "non-https payment link rejected")

        status, body = anon.call("GET", "/listings?q=budget%20pro")
        check(any(l["id"] == listing_id for l in body.get("listings", [])), "search finds the new listing")
        status, body = anon.call("GET", f"/listings/{listing_id}")
        check(status == 200 and body["listing"]["spec"]["title"] == "Test budget" and body["listing"]["owned"] is False, "public detail includes spec preview")

        status, body = partner.call("POST", "/affiliate/links", {"listingId": listing_id})
        check(status == 201, "affiliate link created")
        code = body["link"]["code"]
        status, body = partner.call("POST", "/affiliate/links", {"listingId": listing_id})
        check(body["link"]["code"] == code, "affiliate link is idempotent")
        for _ in range(3):
            anon.call("POST", "/affiliate/click", {"code": code})

        check(seller.call("POST", f"/listings/{listing_id}/buy", {})[0] == 400, "seller cannot buy own listing")
        check(buyer.call("POST", f"/listings/{listing_id}/reviews", {"rating": 5})[0] == 403, "non-buyer cannot review")
        status, body = buyer.call("POST", f"/listings/{listing_id}/buy", {"ref": code})
        check(status == 201, "buyer purchases via affiliate link")
        purchase = body.get("purchase", {})
        check(purchase.get("price_cents") == 1000 and purchase.get("platform_fee_cents") == 100, "price 10.00, platform fee 10% = 1.00")
        check(purchase.get("commission_cents") == 300 and purchase.get("seller_net_cents") == 600, "affiliate 30% = 3.00, seller net = 6.00")
        status, body = buyer.call("POST", f"/listings/{listing_id}/buy", {"ref": code})
        check(status == 200 and body.get("alreadyOwned") is True, "second purchase is idempotent")

        status, body = partner.call("POST", f"/listings/{listing_id}/buy", {"ref": code})
        check(status == 201 and body["purchase"]["commission_cents"] == 0, "self-referral earns no commission")

        status, body = buyer.call("GET", "/library")
        check(status == 200 and any(i["listingId"] == listing_id and i["spec"]["sheet"]["columns"] for i in body["items"]), "library returns the purchased template")
        check(buyer.call("POST", f"/listings/{listing_id}/reviews", {"rating": 5, "body": "Saved me hours"})[0] == 200, "buyer reviews")
        check(buyer.call("POST", f"/listings/{listing_id}/reviews", {"rating": 9})[0] == 400, "rating range enforced")

        status, body = partner.call("GET", "/affiliate")
        link = next((l for l in body.get("links", []) if l["code"] == code), {})
        check(link.get("clicks") == 3 and link.get("sales") == 1 and abs(link.get("earnings", 0) - 3.0) < 1e-9, "affiliate dashboard: 3 clicks, 1 attributed sale (self-referral excluded), earned 3.00")

        status, body = seller.call("GET", "/seller")
        row = next((l for l in body.get("listings", []) if l["id"] == listing_id), {})
        check(row.get("sales") == 2 and abs(row.get("gross", 0) - 20) < 1e-9 and abs(row.get("net", 0) - 15) < 1e-9, "seller ledger: 2 sales, gross 20.00, net 15.00")
        check(row.get("rating") == 5 and row.get("ratingCount") == 1, "rating aggregated")

        free = next(l for l in seeded if l["price"] == 0)
        status, body = buyer.call("POST", f"/listings/{free['id']}/buy", {})
        check(status == 201 and body["purchase"]["price_cents"] == 0, "free template can be claimed")

        check(seller.call("POST", f"/listings/{listing_id}/unpublish", {})[0] == 200, "seller unpublishes")
        status, body = anon.call("GET", "/listings?q=budget%20pro")
        check(not any(l["id"] == listing_id for l in body.get("listings", [])), "hidden listing leaves the market")
        check(anon.call("GET", f"/listings/{listing_id}")[0] == 404, "hidden listing not public")
        status, body = buyer.call("GET", "/library")
        check(any(i["listingId"] == listing_id for i in body["items"]), "buyers keep access after unpublish")

        check(buyer.call("POST", "/auth/logout", {})[0] == 200, "logout")
        status, body = buyer.call("GET", "/me")
        check(body.get("user") is None, "session cleared after logout")
        check(buyer.call("POST", "/auth/login", {"email": "buy@x.io", "password": "wrong-pass"})[0] == 401, "wrong password rejected")
        check(buyer.call("POST", "/auth/login", {"email": "buy@x.io", "password": "correct-horse"})[0] == 200, "login works")
        check(buyer.call("POST", "/auth/login", {"email": "buy@x.io"}, content_type="text/plain")[0] == 415, "non-JSON POST rejected (CSRF guard)")

        req = urllib.request.Request(f"http://127.0.0.1:{port}/../server/server.py")
        try:
            urllib.request.urlopen(req, timeout=5)
            check(False, "path traversal blocked")
        except urllib.error.HTTPError as err:
            check(err.code == 404, "path traversal blocked")
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/app.html", timeout=5) as res:
            check(res.status == 200 and b"Sheetmint" in res.read(), "static front-end served")
    finally:
        httpd.shutdown()
        store.db.close()
        tmp.cleanup()

    print("\n" + ("SUMMARY: ALL TESTS PASSED" if not failures else f"SUMMARY: {len(failures)} FAILED"))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
