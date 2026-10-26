#!/usr/bin/env python3
"""End-to-end test for the Fade backend. Standard library only.

Starts the server on a free port with a temporary data directory and simulates
several real users (creator, customer, barber, shop owner) through the API:
accounts, conflict-safe bookings, payments, shorts upload + Range streaming,
tag approval, creator commissions (pending -> earned -> paid, self-referral
blocked), follows, chat, communities, orders, studio and owner settings.

Exit code 0 on success, 1 on failure.
"""

import base64
import importlib.util
import json
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
FAILURES = []
PASSES = []


def load_server():
    spec = importlib.util.spec_from_file_location("fade_server", APP_DIR / "server" / "server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.token = None

    def call(self, method, path, body=None, raw=None, headers=None):
        data = None
        all_headers = dict(headers or {})
        if body is not None:
            data = json.dumps(body).encode()
            all_headers["Content-Type"] = "application/json"
        if raw is not None:
            data = raw
        if self.token:
            all_headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=all_headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = response.read()
                kind = response.headers.get("Content-Type", "")
                return response.status, (json.loads(payload) if "json" in kind else payload), response.headers
        except urllib.error.HTTPError as err:
            payload = err.read()
            try:
                payload = json.loads(payload)
            except ValueError:
                pass
            return err.code, payload, err.headers


def check(name, condition, detail=""):
    if condition:
        PASSES.append(name)
    else:
        FAILURES.append(f"{name} {detail}")


def expect(name, result, status):
    check(name, result[0] == status, f"(expected {status}, got {result[0]}: {result[1]})")
    return result[1]


def register(base, name, email, role="customer", **extra):
    client = Client(base)
    body = {"name": name, "email": email, "password": "correct horse 1", "role": role, **extra}
    data = expect(f"register {email}", client.call("POST", "/api/auth/register", body), 200)
    client.token = data.get("token")
    return client


def first_free_slot(client, barber_id, mins, place_id=None, skip=()):
    for offset in range(0, 14):
        key = (date.today() + timedelta(days=offset)).isoformat()
        status, data, _ = client.call("GET", f"/api/slots?barber={barber_id}&date={key}&mins={mins}")
        if status != 200:
            continue
        for group in data["groups"]:
            if place_id and group["placeId"] != place_id:
                continue
            for slot in group["slots"]:
                if not slot["taken"] and (key, slot["t"]) not in skip:
                    return key, slot["t"], group["placeId"]
    return None


def add_card(client):
    data = expect("add card", client.call("POST", "/api/cards", {"brand": "Visa", "last4": "4242", "exp": "12/30"}), 200)
    return data["card"]["id"]


def upload_short(client, caption, tags, category="Cut reveal", agreement=False, content_type="video/mp4"):
    meta = {"caption": caption, "category": category, "tags": tags, "sponsoredAgreement": agreement,
            "poster": "data:image/jpeg;base64,AAAA", "duration": 12.5}
    header = base64.b64encode(json.dumps(meta).encode()).decode()
    payload = bytes(range(256)) * 40
    return client.call("POST", "/api/shorts", raw=payload,
                       headers={"Content-Type": content_type, "X-Fade-Meta": header}), payload


def run(base, server_module):
    anon = Client(base)
    health = expect("health", anon.call("GET", "/api/health"), 200)
    check("health app name", health.get("app") == "fade")
    expect("state needs login", anon.call("GET", "/api/state"), 401)

    # ----- accounts -----
    creator = register(base, "Ana Creator", "ana@example.com")
    customer = register(base, "Ben Client", "ben@example.com")
    barber = register(base, "Cara Blade", "cara@example.com", role="barber",
                      barber={"price": 20, "city": "Jakarta", "tags": "Skin fade, Beard"})
    owner = register(base, "Dian Owner", "dian@example.com", role="owner",
                     place={"name": "Dian Cuts Studio", "city": "Jakarta", "tier": "premium"})
    expect("duplicate email rejected", Client(base).call("POST", "/api/auth/register",
           {"name": "X", "email": "ana@example.com", "password": "another pass 1"}), 409)
    expect("weak password rejected", Client(base).call("POST", "/api/auth/register",
           {"name": "X", "email": "x@example.com", "password": "short"}), 400)
    expect("wrong password rejected", Client(base).call("POST", "/api/auth/login",
           {"email": "ana@example.com", "password": "nope nope nope"}), 401)
    relog = Client(base)
    login = expect("login works", relog.call("POST", "/api/auth/login",
                   {"email": "ben@example.com", "password": "correct horse 1"}), 200)
    check("login returns token", bool(login.get("token")))

    state = expect("state", creator.call("GET", "/api/state"), 200)
    check("catalog barbers", len(state["barbers"]) >= 11)
    check("seeded shorts", len(state["shorts"]) >= 30)
    check("password hash not leaked", "pw" not in state["user"] and "salt" not in state["user"])
    barber_state = expect("barber state", barber.call("GET", "/api/state"), 200)
    cara_barber_id = barber_state["user"]["barberId"]
    check("barber profile created", bool(cara_barber_id))
    owner_state = expect("owner state", owner.call("GET", "/api/state"), 200)
    dian_place_id = owner_state["user"]["placeId"]
    check("owner place created", bool(dian_place_id))

    # ----- cards & payments -----
    expect("full card number refused", creator.call("POST", "/api/cards",
           {"brand": "Visa", "last4": "4242424242424242", "exp": "12/30"}), 400)
    creator_card = add_card(creator)
    customer_card = add_card(customer)
    expect("top up", customer.call("POST", "/api/wallet/topup", {"amount": 50, "cardId": customer_card}), 200)

    # ----- booking + pricing parity with the front-end formula -----
    slot = first_free_slot(customer, "b1", 45, place_id="p1")
    check("found a free slot for Marcus at Kings", slot is not None)
    key, t, place_id = slot
    booking = expect("book Marcus (deposit)", customer.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": key, "time": t, "placeId": place_id,
        "payMode": "deposit", "method": "wallet"}), 200)
    q = booking["booking"]["quote"]
    check("deposit = 0.99 + 2.20 + 4.40", abs(q["dueNow"] - 7.59) < 1e-9, str(q))
    check("total = 25.19", abs(q["total"] - 25.19) < 1e-9, str(q))
    check("points earned 75", booking["earned"] == 75, str(booking["earned"]))
    wallet_after = expect("state after booking", customer.call("GET", "/api/state"), 200)["user"]["wallet"]
    check("wallet charged 7.59", abs(wallet_after - (50 - 7.59)) < 1e-9, str(wallet_after))

    # ----- conflicts -----
    clash = creator.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": key, "time": t, "placeId": place_id,
        "payMode": "full", "method": creator_card})
    expect("double booking blocked", clash, 409)
    other = first_free_slot(customer, "b3", 30)
    if other and other[0] == key:
        pass
    past = (date.today() - timedelta(days=1)).isoformat()
    expect("past booking blocked", customer.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": past, "time": 12, "placeId": "p1",
        "payMode": "deposit", "method": "wallet"}), 409)
    expect("wrong place blocked", customer.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": key, "time": t, "placeId": "p9",
        "payMode": "deposit", "method": "wallet"}), 409)
    poor = register(base, "Eko Broke", "eko@example.com")
    slot2 = first_free_slot(poor, "b1", 45, skip={(key, t)})
    expect("empty wallet refused", poor.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": slot2[0], "time": slot2[1], "placeId": slot2[2],
        "payMode": "deposit", "method": "wallet"}), 402)

    # ----- shorts upload, validation, streaming -----
    (status_bad, _, _), _ = upload_short(creator, "Lunch pics", [], category="Food")
    check("non-haircut category rejected", status_bad == 400)
    (status_sp, _, _), _ = upload_short(creator, "Sponsored no agreement", [{"type": "barber", "id": "b1", "kind": "sponsored"}])
    check("sponsored without agreement rejected", status_sp == 400)
    (status_type, _, _), _ = upload_short(creator, "Wrong type", [], content_type="application/zip")
    check("bad file type rejected", status_type == 415)
    (status_ok, data_ok, _), payload = upload_short(creator, "Fresh fade by @fadebymarcus #fade",
                                                    [{"type": "barber", "id": "b1", "kind": "featured"},
                                                     {"type": "place", "id": "p1", "kind": "sponsored"}], agreement=True)
    check("short uploaded", status_ok == 200, str(data_ok))
    short = data_ok["short"]
    check("demo profiles auto-approve tags", all(tag["status"] == "approved" for tag in short["tags"]))
    media_status, media_body, media_headers = anon.call("GET", short["media"]["url"], headers={"Range": "bytes=10-19"})
    check("media Range 206", media_status == 206, str(media_status))
    check("media Range bytes", media_body == payload[10:20])
    check("media Content-Range", media_headers.get("Content-Range") == f"bytes 10-19/{len(payload)}")
    like = expect("like short", customer.call("POST", f"/api/shorts/{short['id']}/like"), 200)
    check("like counted", like["short"]["likes"] == 1 and like["short"]["likedByMe"])
    unlike = expect("unlike short", customer.call("POST", f"/api/shorts/{short['id']}/like"), 200)
    check("unlike counted", unlike["short"]["likes"] == 0)
    expect("view short", customer.call("POST", f"/api/shorts/{short['id']}/view"), 200)
    expect("delete someone else's short blocked", customer.call("DELETE", f"/api/shorts/{short['id']}"), 403)

    # ----- commission: attributed booking by another user -----
    slot3 = first_free_slot(customer, "b1", 45, skip={(key, t)})
    ref_booking = expect("customer books from creator short", customer.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": slot3[0], "time": slot3[1], "placeId": slot3[2],
        "payMode": "full", "method": customer_card, "refShortId": short["id"]}), 200)
    creator_state = expect("creator state", creator.call("GET", "/api/state"), 200)
    pending = [c for c in creator_state["commissions"] if c["sourceId"] == ref_booking["booking"]["id"]]
    check("pending commission created", len(pending) == 1 and pending[0]["status"] == "pending", str(pending))
    if pending:
        check("featured barber rate 5% of service", abs(pending[0]["amount"] - 1.10) < 1e-9, str(pending[0]))
    slot4 = first_free_slot(creator, "b1", 45, skip={(key, t), (slot3[0], slot3[1])})
    self_booking = expect("creator books own short", creator.call("POST", "/api/bookings", {
        "barberId": "b1", "serviceId": "s1", "date": slot4[0], "time": slot4[1], "placeId": slot4[2],
        "payMode": "full", "method": creator_card, "refShortId": short["id"]}), 200)
    creator_state = expect("creator state 2", creator.call("GET", "/api/state"), 200)
    check("self-referral earns nothing",
          not [c for c in creator_state["commissions"] if c["sourceId"] == self_booking["booking"]["id"]])

    # ----- tag approval by a real barber, completion, payout -----
    (status_c, data_c, _), _ = upload_short(creator, "Cara's beard work", [{"type": "barber", "id": cara_barber_id, "kind": "featured"}],
                                            category="Before / after")
    cara_short = data_c["short"]
    check("real barber tag starts pending", cara_short["tags"][0]["status"] == "pending")
    expect("only the tagged barber can approve", customer.call("POST", f"/api/shorts/{cara_short['id']}/tags/0", {"approve": True}), 403)
    cara_slot = first_free_slot(customer, cara_barber_id, 45)
    check("Cara has open slots", cara_slot is not None)
    unapproved = expect("booking via pending tag", customer.call("POST", "/api/bookings", {
        "barberId": cara_barber_id, "serviceId": "s1", "date": cara_slot[0], "time": cara_slot[1],
        "placeId": cara_slot[2], "payMode": "full", "method": customer_card, "refShortId": cara_short["id"]}), 200)
    creator_state = expect("creator state 3", creator.call("GET", "/api/state"), 200)
    check("no commission while tag pending",
          not [c for c in creator_state["commissions"] if c["sourceId"] == unapproved["booking"]["id"]])
    expect("barber approves tag", barber.call("POST", f"/api/shorts/{cara_short['id']}/tags/0", {"approve": True}), 200)
    cara_slot2 = first_free_slot(customer, cara_barber_id, 45, skip={(cara_slot[0], cara_slot[1])})
    approved_booking = expect("booking via approved tag", customer.call("POST", "/api/bookings", {
        "barberId": cara_barber_id, "serviceId": "s1", "date": cara_slot2[0], "time": cara_slot2[1],
        "placeId": cara_slot2[2], "payMode": "full", "method": customer_card, "refShortId": cara_short["id"]}), 200)
    expect("barber can't book themselves", barber.call("POST", "/api/bookings", {
        "barberId": cara_barber_id, "serviceId": "s1", "date": cara_slot2[0], "time": cara_slot2[1],
        "placeId": cara_slot2[2], "payMode": "full", "method": "wallet"}), 400)
    expect("customer can't complete", customer.call("POST", f"/api/bookings/{approved_booking['booking']['id']}/complete"), 403)
    expect("barber completes", barber.call("POST", f"/api/bookings/{approved_booking['booking']['id']}/complete"), 200)
    barber_view = expect("barber sees owed commission", barber.call("GET", "/api/state"), 200)
    check("commission owed by barber listed", len(barber_view["commissionsOwed"]) == 1)
    creator_state = expect("creator state 4", creator.call("GET", "/api/state"), 200)
    check("commission earned after completion", abs(creator_state["creator"]["available"] - 1.0) < 1e-9,
          str(creator_state["creator"]))
    wallet_before = creator_state["user"]["wallet"]
    payout = expect("withdraw commission", creator.call("POST", "/api/creator/withdraw"), 200)
    creator_state = expect("creator state 5", creator.call("GET", "/api/state"), 200)
    check("payout lands in wallet", abs(creator_state["user"]["wallet"] - wallet_before - payout["amount"]) < 1e-9)
    expect("nothing left to withdraw", creator.call("POST", "/api/creator/withdraw"), 400)

    # ----- rating & tips -----
    rate = expect("rate completed booking with tip", customer.call("POST",
                  f"/api/bookings/{approved_booking['booking']['id']}/rate",
                  {"rB": 5, "rP": 4, "tip": 3, "review": "Clean!", "method": customer_card}), 200)
    check("review points", rate["earned"] == 80)
    expect("rate twice blocked", customer.call("POST", f"/api/bookings/{approved_booking['booking']['id']}/rate",
           {"rB": 5, "rP": 5}), 400)
    expect("rate upcoming blocked", customer.call("POST", f"/api/bookings/{ref_booking['booking']['id']}/rate",
           {"rB": 5, "rP": 5}), 400)

    # ----- cancel voids commission -----
    cancel = expect("cancel attributed booking", customer.call("POST", f"/api/bookings/{ref_booking['booking']['id']}/cancel"), 200)
    creator_state = expect("creator state 6", creator.call("GET", "/api/state"), 200)
    voided = [c for c in creator_state["commissions"] if c["sourceId"] == ref_booking["booking"]["id"]]
    check("commission voided on cancel", voided and voided[0]["status"] == "void")
    check("refund matches policy", (cancel["refunded"] > 0) == cancel["free"])
    expect("cancel twice blocked", customer.call("POST", f"/api/bookings/{ref_booking['booking']['id']}/cancel"), 400)

    # ----- reschedule -----
    move = first_free_slot(customer, "b1", 45, skip={(key, t), (slot3[0], slot3[1]), (slot4[0], slot4[1])})
    moved = expect("reschedule", customer.call("POST", f"/api/bookings/{booking['booking']['id']}/reschedule",
                   {"date": move[0], "time": move[1], "placeId": move[2]}), 200)
    check("reschedule applied", moved["booking"]["date"] == move[0] and moved["booking"]["time"] == move[1])

    # ----- follows -----
    follow = expect("follow barber", creator.call("POST", "/api/follow", {"type": "barber", "id": "b1"}), 200)
    check("following true", follow["following"] is True)
    marcus = next(b for b in expect("state f", creator.call("GET", "/api/state"), 200)["barbers"] if b["id"] == "b1")
    check("followers incremented", marcus["followers"] == 48201, str(marcus["followers"]))
    expect("follow creator", customer.call("POST", "/api/follow", {"type": "user", "id": creator_state["user"]["id"]}), 200)
    check("creator follower counted",
          expect("state g", creator.call("GET", "/api/state"), 200)["user"]["followers"] == 1)
    expect("self-follow blocked", creator.call("POST", "/api/follow", {"type": "user", "id": creator_state["user"]["id"]}), 400)

    # ----- chat -----
    dm = expect("open DM", creator.call("POST", "/api/dm", {"barberId": "b1"}), 200)
    expect("send DM", creator.call("POST", f"/api/threads/{dm['threadId']}/messages", {"text": "Any slots Saturday?"}), 200)
    thread = next(t for t in expect("state dm", creator.call("GET", "/api/state"), 200)["threads"] if t["id"] == dm["threadId"])
    check("demo barber auto-replied", len(thread["messages"]) == 2 and thread["messages"][1].get("bot"))
    customer_threads = expect("state other", customer.call("GET", "/api/state"), 200)["threads"]
    check("DMs are private", all(t["id"] != dm["threadId"] for t in customer_threads))
    real_dm = expect("DM real barber", customer.call("POST", "/api/dm", {"barberId": cara_barber_id}), 200)
    expect("message real barber", customer.call("POST", f"/api/threads/{real_dm['threadId']}/messages", {"text": "Hi Cara"}), 200)
    cara_threads = expect("barber inbox", barber.call("GET", "/api/state"), 200)["threads"]
    check("real barber receives DM", any(t["id"] == real_dm["threadId"] for t in cara_threads))
    expect("barber replies", barber.call("POST", f"/api/threads/{real_dm['threadId']}/messages", {"text": "Hey Ben!"}), 200)
    ben_thread = next(t for t in expect("state reply", customer.call("GET", "/api/state"), 200)["threads"] if t["id"] == real_dm["threadId"])
    check("customer sees barber reply", ben_thread["messages"][-1]["from"] == cara_barber_id)
    expect("post before join blocked", creator.call("POST", "/api/threads/g3/messages", {"text": "hi"}), 403)
    expect("join community", creator.call("POST", "/api/threads/g3/join"), 200)
    expect("post after join", creator.call("POST", "/api/threads/g3/messages", {"text": "hi"}), 200)

    # ----- shop order with attributed commission -----
    order = expect("order from short", customer.call("POST", "/api/orders", {
        "items": [{"id": "pr1", "qty": 2}], "delivery": "delivery", "method": customer_card, "refShortId": short["id"]}), 200)
    check("order total 2x16 + 3", abs(order["order"]["total"] - 35.0) < 1e-9, str(order["order"]["total"]))
    creator_state = expect("creator state 7", creator.call("GET", "/api/state"), 200)
    check("product commission earned", abs(creator_state["creator"]["available"] - 1.60) < 1e-9, str(creator_state["creator"]))

    # ----- rewards -----
    expect("unfinished challenge refused", customer.call("POST", "/api/rewards/claim", {"id": "c_review"}), 400)
    expect("finished challenge claimed", customer.call("POST", "/api/rewards/claim", {"id": "c_shop"}), 200)
    expect("claim twice refused", customer.call("POST", "/api/rewards/claim", {"id": "c_shop"}), 400)

    # ----- studio & owner -----
    overlap = [{"dow": 6, "placeId": "p2", "from": 10, "to": 14}, {"dow": 6, "placeId": "p1", "from": 13, "to": 18}]
    expect("overlapping shifts refused", barber.call("PUT", "/api/studio/barber", {"schedule": overlap}), 400)
    good = [{"dow": 6, "placeId": "p2", "from": 10, "to": 13}, {"dow": 6, "placeId": "p1", "from": 14, "to": 18},
            {"dow": 2, "placeId": dian_place_id, "from": 9, "to": 17}]
    expect("split shifts saved", barber.call("PUT", "/api/studio/barber", {"schedule": good}), 200)
    expect("customer can't edit studio", customer.call("PUT", "/api/studio/barber", {"schedule": good}), 403)
    expect("barber lists product", barber.call("POST", "/api/products", {"name": "Cara Beard Balm", "price": 12, "cat": "Beard"}), 200)
    expect("owner sets luxe tier", owner.call("PUT", "/api/owner/place", {"tier": "luxe", "rent": 40}), 200)
    place = next(p for p in expect("state h", owner.call("GET", "/api/state"), 200)["places"] if p["id"] == dian_place_id)
    check("tier fee applied", place["fee"] == 10 and place["rent"] == 40)
    expect("customer can't edit place", customer.call("PUT", "/api/owner/place", {"tier": "luxe"}), 403)

    # ----- slot hash parity spot-check (same FNV-1a as the browser) -----
    check("fnv known vector", server_module.fnv_hash("a") == 0xE40C292C)
    check("js_num formatting", server_module.js_num(10.0) == "10" and server_module.js_num(10.5) == "10.5")

    expect("logout", customer.call("POST", "/api/auth/logout"), 200)
    expect("token revoked", customer.call("GET", "/api/state"), 401)


def main():
    server_module = load_server()
    with tempfile.TemporaryDirectory() as data_dir:
        port = free_port()
        server = server_module.make_server("127.0.0.1", port, data_dir, quiet=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run(f"http://127.0.0.1:{port}", server_module)
        except Exception as err:  # surface unexpected crashes as failures
            import traceback
            traceback.print_exc()
            FAILURES.append(f"crash: {err}")
        finally:
            server.shutdown()
            server.server_close()
    print(f"fade api: {len(PASSES)} checks passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  FAIL", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
