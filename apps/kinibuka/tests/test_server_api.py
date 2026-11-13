"""tests/test_server_api.py -- end-to-end tests for the KiniBuka HTTP API (stdlib only).

server.py keeps its SQLite file next to itself, so the test copies server.py + static/ into a
temporary folder and starts it there on a free port: the real kinibuka.db is never touched and
automatic WhatsApp stays off (WA_PROVIDER is cleared). Exits 0 on success.

Run:  python apps/kinibuka/tests/test_server_api.py
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
# talk to the local server directly, never through a configured HTTP proxy
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ServerCase(unittest.TestCase):
    """Starts a private copy of the server for each test class (EXTRA_ENV tweaks its settings)."""

    EXTRA_ENV = {}

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)  # Windows may still hold the db
        work = Path(cls._tmp.name)
        shutil.copy2(APP_DIR / "server.py", work / "server.py")
        shutil.copytree(APP_DIR / "static", work / "static")
        cls.port = free_port()
        cls.db_path = work / "kinibuka.db"
        env = dict(
            os.environ, PORT=str(cls.port), WA_PROVIDER="", PYTHONIOENCODING="utf-8",
            KINIBUKA_DB=str(cls.db_path), SEED_DEMO="1", ADMIN_PHONES="", SIGNUPS_PER_HOUR="1000",
        )
        env.update(cls.EXTRA_ENV)
        cls.proc = subprocess.Popen(
            [sys.executable, str(work / "server.py")],
            cwd=work,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        deadline = time.time() + 90
        while time.time() < deadline:
            try:
                OPENER.open(cls.base + "/api/config", timeout=1).read()
                break
            except OSError:
                time.sleep(0.2)
        else:
            cls.proc.kill()
            raise RuntimeError("server did not start")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            cls.proc.kill()
        cls._tmp.cleanup()

    # -- helpers -------------------------------------------------------------

    def call(self, method, path, body=None, token=None, lang=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if lang:
            headers["X-Lang"] = lang
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with OPENER.open(request, timeout=60) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    PASSWORD = "rahasia123"

    def login(self, name, phone):
        """Sign up (or log in if the number already has an account) and return (token, user)."""
        status, data = self.call("POST", "/api/signup", {"name": name, "phone": phone, "password": self.PASSWORD})
        if status == 409:
            status, data = self.call("POST", "/api/login", {"phone": phone, "password": self.PASSWORD})
        self.assertEqual(status, 200, data)
        return data["token"], data["user"]

    def admin(self):
        status, data = self.call("POST", "/api/login", {"phone": "admin", "password": "admin"})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["user"]["is_admin"])
        return data["token"]

    def approve(self, stall_id, **extra):
        return self.call("POST", f"/api/admin/stalls/{stall_id}", {"action": "approve", **extra}, self.admin())

    def verify_owner(self, user_id):
        status, data = self.call("POST", f"/api/admin/users/{user_id}/verify", {}, self.admin())
        self.assertEqual(status, 200, data)


class KiniBukaApiTests(ServerCase):

    def public_ids(self):
        return {s["id"] for s in self.call("GET", "/api/stalls")[1]["stalls"]}

    def make_shop(self, phone, live=True):
        token, user = self.login("Seller " + phone, phone)
        status, stall = self.call("POST", "/api/stalls", {"name": "Warung Test", "category": "Food"}, token)
        self.assertEqual(status, 200, stall)
        self.assertEqual(stall["state"], "pending")
        status, branch = self.call(
            "POST", f"/api/stalls/{stall['id']}/branches",
            {"label": "Pusat", "lat": -6.2, "lng": 106.8, "is_open": True}, token,
        )
        self.assertEqual(status, 200, branch)
        status, item = self.call("POST", f"/api/stalls/{stall['id']}/menu", {"name": "Nasi Goreng", "price": 25000}, token)
        self.assertEqual(status, 200, item)
        if live:
            self.verify_owner(user["id"])
            status, data = self.approve(stall["id"])
            self.assertEqual(status, 200, data)
        return token, stall["id"], branch["id"], item["id"]

    # -- tests ---------------------------------------------------------------

    def test_config_and_seed_data(self):
        status, config = self.call("GET", "/api/config")
        self.assertEqual(status, 200)
        self.assertIn("Food", config["categories"])
        self.assertFalse(config["wa_auto"])
        status, listing = self.call("GET", "/api/stalls")
        self.assertEqual(status, 200)
        self.assertGreater(len(listing["stalls"]), 0)

    def test_signup_and_password_login(self):
        status, data = self.call("POST", "/api/signup", {"name": "A", "phone": "123", "password": self.PASSWORD})
        self.assertEqual((status, data["code"]), (400, "invalid_phone"))
        status, data = self.call("POST", "/api/signup", {"name": "A", "phone": "081200001111", "password": "short"})
        self.assertEqual((status, data["code"]), (400, "password_short"))
        status, first = self.call("POST", "/api/signup", {"name": "Budi", "phone": "0812-0000-1111", "password": self.PASSWORD})
        self.assertEqual(status, 200, first)
        self.assertFalse(first["user"]["is_admin"])
        self.assertEqual(first["user"]["phone"], "081200001111")
        # same number again (written differently) cannot take over the account
        status, data = self.call("POST", "/api/signup", {"name": "Thief", "phone": "+62 812 0000 1111", "password": "other-pass"})
        self.assertEqual((status, data["code"]), (409, "phone_taken"))
        status, data = self.call("POST", "/api/login", {"phone": "081200001111", "password": "wrong-pass"})
        self.assertEqual((status, data["code"]), (401, "wrong_login"))
        status, data = self.call("POST", "/api/login", {"phone": "6281200001111", "password": self.PASSWORD})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["user"]["id"], first["user"]["id"])
        # change password rotates the token: the old session stops working
        token = data["token"]
        status, changed = self.call("POST", "/api/password", {"old": self.PASSWORD, "new": "baru-12345"}, token)
        self.assertEqual(status, 200, changed)
        self.assertEqual(self.call("GET", "/api/me", token=token)[1]["user"], None)
        self.assertEqual(self.call("GET", "/api/me", token=changed["token"])[1]["user"]["name"], "Budi")
        status, data = self.call("POST", "/api/login", {"phone": "081200001111", "password": "baru-12345"})
        self.assertEqual(status, 200, data)
        self.assertEqual(self.call("POST", "/api/logout", {}, data["token"])[0], 200)
        self.assertEqual(self.call("GET", "/api/me", token=data["token"])[1]["user"], None)

    def test_wrong_passwords_are_rate_limited(self):
        self.login("Rate", "081377770000")
        for _ in range(10):
            status, data = self.call("POST", "/api/login", {"phone": "081377770000", "password": "nope-nope"})
            self.assertEqual(status, 401)
        status, data = self.call("POST", "/api/login", {"phone": "081377770000", "password": self.PASSWORD})
        self.assertEqual((status, data["code"]), (429, "too_many_attempts"))

    def test_new_stall_waits_for_admin_then_goes_public(self):
        seller, stall_id, branch_id, item_id = self.make_shop("081355550000", live=False)
        stranger, _ = self.login("Stranger", "081355551111")
        self.assertNotIn(stall_id, self.public_ids())
        self.assertEqual(self.call("GET", f"/api/stalls/{stall_id}", token=stranger)[0], 404)
        self.assertEqual(self.call("GET", f"/api/stalls/{stall_id}", token=seller)[1]["state"], "pending")
        mine = self.call("GET", "/api/my/stalls", token=seller)[1]["stalls"]
        self.assertEqual([(s["id"], s["state"]) for s in mine], [(stall_id, "pending")])
        feed = self.call("GET", "/api/feed")[1]["items"]
        self.assertFalse([i for i in feed if i["stall_id"] == stall_id])
        status, data = self.call("POST", "/api/orders", {"branch_id": branch_id, "items": [{"menu_id": item_id, "qty": 1}]}, stranger)
        self.assertEqual((status, data["code"]), (400, "stall_not_live"))
        # only admins may approve
        status, data = self.call("POST", f"/api/admin/stalls/{stall_id}", {"action": "approve"}, seller)
        self.assertEqual((status, data["code"]), (403, "admin_only"))
        self.assertEqual(self.call("GET", "/api/admin/overview", token=seller)[0], 403)
        overview = self.call("GET", "/api/admin/overview", token=self.admin())[1]
        self.assertIn(stall_id, [s["id"] for s in overview["stalls"] if s["state"] == "pending"])
        # the seller's WhatsApp number must be verified first
        status, data = self.approve(stall_id)
        self.assertEqual((status, data["code"]), (400, "owner_unverified"))
        status, sent = self.call("POST", "/api/verify/send", {}, seller)
        self.assertEqual((status, sent["mode"]), (200, "manual"), sent)
        overview = self.call("GET", "/api/admin/overview", token=self.admin())[1]
        card = next(s for s in overview["stalls"] if s["id"] == stall_id)
        self.assertEqual(card["owner_code"], sent["code"])  # the admin matches the code the seller sent on WhatsApp
        self.assertEqual(self.call("POST", "/api/verify", {"code": sent["code"]}, seller)[0], 400)  # cannot self-verify
        self.verify_owner(card["owner_id"])
        status, data = self.approve(stall_id, until="2001-01-01")
        self.assertEqual((status, data["code"]), (400, "bad_date"))
        status, data = self.approve(stall_id)
        self.assertEqual((status, data["state"]), (200, "live"), data)
        self.assertIn(stall_id, self.public_ids())
        feed = self.call("GET", "/api/feed")[1]["items"]
        self.assertIn("new_stall", [i["type"] for i in feed if i["stall_id"] == stall_id])
        status, data = self.call("POST", "/api/orders", {"branch_id": branch_id, "items": [{"menu_id": item_id, "qty": 1}]}, stranger)
        self.assertEqual(status, 200, data)
        # suspend hides it again
        status, data = self.call("POST", f"/api/admin/stalls/{stall_id}", {"action": "suspend", "note": "Tutup sementara"}, self.admin())
        self.assertEqual((status, data["state"]), (200, "suspended"))
        self.assertNotIn(stall_id, self.public_ids())
        self.assertEqual(self.call("GET", f"/api/stalls/{stall_id}", token=seller)[1]["review_note"], "Tutup sementara")

    def test_slot_end_date_hides_the_stall(self):
        _, stall_id, _, _ = self.make_shop("081366660000")
        self.assertIn(stall_id, self.public_ids())
        with sqlite3.connect(self.db_path) as db:
            db.execute("UPDATE stalls SET slot_until='2000-01-01' WHERE id=?", (stall_id,))
        self.assertNotIn(stall_id, self.public_ids())
        overview = self.call("GET", "/api/admin/overview", token=self.admin())[1]
        self.assertEqual([s["state"] for s in overview["stalls"] if s["id"] == stall_id], ["expired"])
        status, data = self.call("POST", f"/api/admin/stalls/{stall_id}", {"action": "extend"}, self.admin())
        self.assertEqual((status, data["state"]), (200, "live"), data)
        self.assertIn(stall_id, self.public_ids())

    def test_market_capacity_limits_approvals(self):
        admin = self.admin()
        _, stall_id, _, _ = self.make_shop("081388880000", live=False)
        owner = next(s for s in self.call("GET", "/api/admin/overview", token=admin)[1]["stalls"] if s["id"] == stall_id)
        self.verify_owner(owner["owner_id"])
        live_now = self.call("GET", "/api/admin/overview", token=admin)[1]["live_count"]
        try:
            status, data = self.call("POST", "/api/admin/settings", {"capacity": live_now, "slot_days": 30}, admin)
            self.assertEqual(status, 200, data)
            status, data = self.approve(stall_id)
            self.assertEqual((status, data["code"]), (409, "no_free_slot"))
            self.assertNotIn(stall_id, self.public_ids())
        finally:
            self.call("POST", "/api/admin/settings", {"capacity": 50, "slot_days": 30}, admin)
        self.assertEqual(self.approve(stall_id)[0], 200)

    def test_builtin_admin_login(self):
        status, data = self.call("POST", "/api/login", {"phone": "ADMIN", "password": "admin"})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["user"]["is_admin"])
        overview = self.call("GET", "/api/admin/overview", token=data["token"])[1]
        self.assertTrue(overview["default_password"])  # the Admin tab nags until it is changed
        status, data = self.call("POST", "/api/signup", {"name": "Fake", "phone": "admin", "password": "whatever123"})
        self.assertEqual((status, data["code"]), (400, "invalid_phone"))
        status, data = self.call("POST", "/api/login", {"phone": "admin", "password": "wrong"})
        self.assertEqual((status, data["code"]), (401, "wrong_login"))

    def test_pending_stalls_are_capped(self):
        token, _ = self.login("Spam", "081366661234")
        for i in range(3):
            status, data = self.call("POST", "/api/stalls", {"name": f"Spam {i}", "category": "Food"}, token)
            self.assertEqual(status, 200, data)
        status, data = self.call("POST", "/api/stalls", {"name": "Spam 4", "category": "Food"}, token)
        self.assertEqual((status, data["code"]), (429, "too_many_pending"))

    def test_market_whatsapp_setting(self):
        admin = self.admin()
        status, data = self.call("POST", "/api/admin/settings",
                                 {"capacity": 50, "slot_days": 30, "market_whatsapp": "+62 811-2233-4455"}, admin)
        self.assertEqual((status, data["market_whatsapp"]), (200, "081122334455"))
        self.assertEqual(self.call("GET", "/api/config")[1]["market_whatsapp"], "081122334455")
        token, _ = self.login("Verifier", "081377778888")
        sent = self.call("POST", "/api/verify/send", {}, token)[1]
        self.assertEqual(sent["market_whatsapp"], "081122334455")

    def test_admin_can_reset_a_forgotten_password(self):
        token, _ = self.login("Lupa", "081399990000")
        status, data = self.call("POST", "/api/admin/password", {"phone": "081399990000", "password": "sementara1"}, self.admin())
        self.assertEqual(status, 200, data)
        self.assertEqual(self.call("GET", "/api/me", token=token)[1]["user"], None)
        status, data = self.call("POST", "/api/login", {"phone": "081399990000", "password": "sementara1"})
        self.assertEqual(status, 200, data)

    def test_writes_need_login_and_ownership(self):
        status, data = self.call("POST", "/api/stalls", {"name": "X", "category": "Food"})
        self.assertEqual((status, data["code"]), (401, "login_required"))
        _, stall_id, _, _ = self.make_shop("081300002222")
        other, _ = self.login("Other", "081300003333")
        status, data = self.call("POST", f"/api/stalls/{stall_id}/menu", {"name": "Hack", "price": 1}, other)
        self.assertEqual((status, data["code"]), (403, "not_your_stall"))

    def test_input_validation(self):
        token, user = self.login("Val", "081300004444")
        status, data = self.call("POST", "/api/stalls", {"name": "X", "category": "Weapons"}, token)
        self.assertEqual((status, data["code"]), (400, "unknown_category"))
        _, stall_id, _, _ = self.make_shop("081300005555")
        seller_token, _ = self.login("again", "081300005555")
        status, data = self.call("POST", f"/api/stalls/{stall_id}/menu", {"name": "Free", "price": -5}, seller_token)
        self.assertEqual((status, data["code"]), (400, "field_range"))
        status, data = self.call("POST", "/api/login", raw=b"{not json")
        self.assertEqual((status, data["code"]), (400, "invalid_json"))
        status, data = self.call("GET", "/api/nope")
        self.assertEqual(status, 404)

    def test_errors_are_translated(self):
        status, data = self.call("POST", "/api/stalls", {"name": "X"}, lang="en")
        self.assertEqual(data["error"], "Please log in first")
        status, data = self.call("POST", "/api/stalls", {"name": "X"}, lang="id")
        self.assertEqual(data["error"], "Silakan masuk dulu")

    def test_order_total_is_computed_by_server(self):
        _, _, branch_id, item_id = self.make_shop("081300006666")
        buyer, _ = self.login("Buyer", "081300007777")
        status, data = self.call(
            "POST", "/api/orders",
            {"branch_id": branch_id, "items": [{"menu_id": item_id, "qty": 2, "price": 1}]}, buyer,
        )
        self.assertEqual(status, 200, data)
        self.assertEqual(data["order"]["total"], 50000)
        status, data = self.call("POST", "/api/orders", {"branch_id": branch_id, "items": [{"menu_id": item_id, "qty": 0}]}, buyer)
        self.assertEqual((status, data["code"]), (400, "order_empty"))

    def test_order_status_flow(self):
        seller, _, branch_id, item_id = self.make_shop("081300008888")
        buyer, _ = self.login("Buyer2", "081300009999")
        _, data = self.call("POST", "/api/orders", {"branch_id": branch_id, "items": [{"menu_id": item_id, "qty": 1}]}, buyer)
        order_id = data["order"]["id"]
        stranger, _ = self.login("Stranger", "081311110000")

        def move(token, status_name):
            return self.call("POST", f"/api/orders/{order_id}/status", {"status": status_name}, token)

        self.assertEqual(move(stranger, "accepted")[1]["code"], "not_your_order")
        self.assertEqual(move(buyer, "accepted")[1]["code"], "bad_transition")  # buyers can only cancel
        self.assertEqual(move(seller, "accepted")[0], 200)
        self.assertEqual(move(buyer, "cancelled")[1]["code"], "bad_transition")  # too late to cancel
        self.assertEqual(move(seller, "done")[1]["code"], "bad_transition")  # must be ready first
        self.assertEqual(move(seller, "ready")[0], 200)
        self.assertEqual(move(seller, "done")[0], 200)
        _, incoming = self.call("GET", "/api/orders/incoming", token=seller)
        self.assertEqual([o["status"] for o in incoming["orders"] if o["id"] == order_id], ["done"])

    def test_closed_branch_takes_no_orders(self):
        seller, _, branch_id, item_id = self.make_shop("081322220000")
        self.assertEqual(self.call("POST", f"/api/branches/{branch_id}/status", {"is_open": False}, seller)[0], 200)
        buyer, _ = self.login("Late", "081322221111")
        status, data = self.call("POST", "/api/orders", {"branch_id": branch_id, "items": [{"menu_id": item_id, "qty": 1}]}, buyer)
        self.assertEqual((status, data["code"]), (400, "branch_closed"))

    def test_static_files_cannot_escape_static_folder(self):
        for path in ("/../server.py", "/%2e%2e/server.py", "/..%2fserver.py"):
            with OPENER.open(self.base + path, timeout=60) as response:
                body = response.read().decode("utf-8", "replace")
            self.assertNotIn("def place_order", body, path)

    def test_stall_list_carries_the_orderable_menu(self):
        seller, stall_id, _, item_id = self.make_shop("081344445555")
        status, sold_out = self.call("POST", f"/api/stalls/{stall_id}/menu", {"name": "Es Teh", "price": 5000}, seller)
        self.assertEqual(status, 200, sold_out)
        self.assertEqual(self.call("POST", f"/api/menu/{sold_out['id']}", {"available": False}, seller)[0], 200)
        _, data = self.call("GET", "/api/stalls")
        stall = next(s for s in data["stalls"] if s["id"] == stall_id)
        self.assertEqual(stall["menu"], [{"id": item_id, "name": "Nasi Goreng", "price": 25000}])
        self.assertEqual(stall["menu_count"], 1)

    def test_3d_market_assets_are_served_as_javascript(self):
        for path in ("/world.js", "/vendor/three.module.min.js"):
            with OPENER.open(self.base + path, timeout=60) as response:
                self.assertEqual(response.status, 200, path)
                self.assertIn("javascript", response.headers.get("Content-Type", ""), path)
                self.assertGreater(len(response.read()), 1000, path)


class WhatsAppGatewayTests(ServerCase):
    """With a WhatsApp gateway the code goes to the seller's phone and is typed back (OTP)."""

    EXTRA_ENV = {"WA_PROVIDER": "fonnte", "FONNTE_TOKEN": "test-token", "SIGNUPS_PER_HOUR": "3"}

    def stored_code(self, user_id):
        with sqlite3.connect(self.db_path) as db:
            return db.execute("SELECT verify_code FROM users WHERE id=?", (user_id,)).fetchone()[0]

    def test_code_is_sent_and_typed_back(self):
        token, user = self.login("Otp", "081355556666")
        self.assertFalse(user["phone_verified"])
        status, sent = self.call("POST", "/api/verify/send", {}, token)
        self.assertEqual((status, sent["mode"]), (200, "auto"))
        self.assertNotIn("code", sent)  # never shown in the app, only sent by WhatsApp
        status, data = self.call("POST", "/api/verify/send", {}, token)
        self.assertEqual((status, data["code"]), (429, "code_wait"))
        status, data = self.call("POST", "/api/verify", {"code": "000000"}, token)
        self.assertEqual((status, data["code"]), (400, "wrong_code"))
        status, data = self.call("POST", "/api/verify", {"code": self.stored_code(user["id"])}, token)
        self.assertEqual((status, data["verified"]), (200, True))
        self.assertTrue(self.call("GET", "/api/me", token=token)[1]["user"]["phone_verified"])

    def test_signups_per_connection_are_limited(self):
        # SIGNUPS_PER_HOUR=3 here; test_code_is_sent_and_typed_back may have used one already
        results = [self.call("POST", "/api/signup", {"name": "Bot", "phone": f"08139990000{i}", "password": "rahasia123"})[0]
                   for i in range(4)]
        self.assertIn(429, results)


if __name__ == "__main__":
    unittest.main(verbosity=1)
