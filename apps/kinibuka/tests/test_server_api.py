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


class KiniBukaApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)  # Windows may still hold the db
        work = Path(cls._tmp.name)
        shutil.copy2(APP_DIR / "server.py", work / "server.py")
        shutil.copytree(APP_DIR / "static", work / "static")
        cls.port = free_port()
        env = dict(os.environ, PORT=str(cls.port), WA_PROVIDER="", PYTHONIOENCODING="utf-8")
        cls.proc = subprocess.Popen(
            [sys.executable, str(work / "server.py")],
            cwd=work,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.base = f"http://127.0.0.1:{cls.port}"
        deadline = time.time() + 20
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
            with OPENER.open(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def login(self, name, phone):
        status, data = self.call("POST", "/api/login", {"name": name, "phone": phone})
        self.assertEqual(status, 200, data)
        return data["token"], data["user"]

    def make_shop(self, phone):
        token, user = self.login("Seller " + phone, phone)
        status, stall = self.call("POST", "/api/stalls", {"name": "Warung Test", "category": "Food"}, token)
        self.assertEqual(status, 200, stall)
        status, branch = self.call(
            "POST", f"/api/stalls/{stall['id']}/branches",
            {"label": "Pusat", "lat": -6.2, "lng": 106.8, "is_open": True}, token,
        )
        self.assertEqual(status, 200, branch)
        status, item = self.call("POST", f"/api/stalls/{stall['id']}/menu", {"name": "Nasi Goreng", "price": 25000}, token)
        self.assertEqual(status, 200, item)
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

    def test_login_validates_phone_and_is_idempotent(self):
        status, data = self.call("POST", "/api/login", {"name": "A", "phone": "123"})
        self.assertEqual((status, data["code"]), (400, "invalid_phone"))
        token1, user1 = self.login("Budi", "0812-0000-1111")
        token2, user2 = self.login("Budi again", "081200001111")
        self.assertEqual(token1, token2)
        self.assertEqual(user1["id"], user2["id"])

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
            with OPENER.open(self.base + path, timeout=10) as response:
                body = response.read().decode("utf-8", "replace")
            self.assertNotIn("def place_order", body, path)

    def test_3d_market_assets_are_served_as_javascript(self):
        for path in ("/world.js", "/vendor/three.module.min.js"):
            with OPENER.open(self.base + path, timeout=10) as response:
                self.assertEqual(response.status, 200, path)
                self.assertIn("javascript", response.headers.get("Content-Type", ""), path)
                self.assertGreater(len(response.read()), 1000, path)


if __name__ == "__main__":
    unittest.main(verbosity=1)
