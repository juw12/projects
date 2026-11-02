"""API / app-shell tests: start the real HTTP server on a free port with a temporary database."""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import server  # noqa: E402
from crewcup import payments as P  # noqa: E402

# Talk to the local test server directly, never through a system/corporate proxy.
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class ServerTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        server.DATA_DIR = Path(cls.temp_dir.name)
        server.STORE = None
        server.STOP.clear()
        server.load_state(reset=True)
        server.ACTIONS["test.boom"] = lambda s, n, a: 1 / 0
        server.A.DEMO_ACTIONS.add("test.boom")
        cls.httpd = server.make_server("127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        server.start_ticker()
        cls.tokens = {}

    @classmethod
    def tearDownClass(cls):
        server.STOP.set()
        with server.CHANGED:
            server.CHANGED.notify_all()
        cls.httpd.shutdown()
        cls.httpd.server_close()
        server.ACTIONS.pop("test.boom", None)
        server.A.DEMO_ACTIONS.discard("test.boom")
        server.STORE.close()
        server.STORE = None
        cls.temp_dir.cleanup()

    # -- helpers ------------------------------------------------------------------

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def get(self, path, persona=None):
        request = urllib.request.Request(self.url(path), headers=self.headers(persona))
        with OPENER.open(request, timeout=5) as response:
            return response.status, response.headers, response.read()

    def post(self, path, payload=None, raw=None, persona=None, headers=None):
        data = raw if raw is not None else json.dumps(payload or {}).encode()
        all_headers = {"Content-Type": "application/json", **self.headers(persona), **(headers or {})}
        request = urllib.request.Request(self.url(path), data=data, headers=all_headers, method="POST")
        try:
            with OPENER.open(request, timeout=5) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())

    def headers(self, persona):
        if not persona:
            return {}
        if persona not in self.tokens:
            status, payload = self.post("/api/session", {"persona": persona})
            self.assertEqual(status, 200, payload)
            self.tokens[persona] = payload["token"]
        return {server.SESSION_HEADER: self.tokens[persona]}

    def act(self, persona, action, **args):
        return self.post("/api/action", {"action": action, "args": args}, persona=persona)

    # -- app shell ----------------------------------------------------------------

    def test_app_shell_and_pwa_files(self):
        status, headers, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn(b'rel="manifest"', body)
        status, headers, body = self.get("/manifest.webmanifest")
        manifest = json.loads(body)
        self.assertEqual(manifest["display"], "standalone")
        self.assertTrue(any(icon["purpose"] == "maskable" for icon in manifest["icons"]))
        status, headers, body = self.get("/sw.js")
        self.assertEqual(headers["Service-Worker-Allowed"], "/")
        for icon in manifest["icons"]:
            status, headers, body = self.get(icon["src"])
            self.assertEqual(body[:4], b"\x89PNG")

    def test_security_headers_and_spa_fallback(self):
        status, headers, body = self.get("/some/client/route")
        self.assertEqual(status, 200)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["X-Frame-Options"], "SAMEORIGIN")
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/missing.png")

    def test_errors_are_json(self):
        status, payload = self.post("/api/action", {"action": "nope"}, persona="emp:e_andi")
        self.assertEqual(status, 404)
        status, payload = self.post("/api/action", raw=b"{not json")
        self.assertEqual(status, 400)
        status, payload = self.act("emp:e_andi", "test.boom")
        self.assertEqual(status, 500)
        self.assertEqual(payload["error"]["code"], "SERVER")
        status, payload = self.post("/api/action", raw=b"x" * (server.MAX_BODY + 10))
        self.assertEqual(status, 400)

    # -- sessions & authorization -------------------------------------------------

    def test_actions_require_sign_in(self):
        status, payload = self.post("/api/action", {"action": "solo.reorder", "args": {"emp": "e_andi"}})
        self.assertEqual(status, 401)
        status, payload = self.post("/api/action", {"action": "solo.reorder", "args": {"emp": "e_andi"}},
                                    headers={server.SESSION_HEADER: "forged.token"})
        self.assertEqual(status, 401)

    def test_cannot_act_as_someone_else(self):
        status, payload = self.act("emp:e_andi", "solo.reorder", emp="e_maya")
        self.assertEqual(status, 403)
        status, payload = self.act("emp:e_andi", "policy.update", ramadan_mode=True)
        self.assertEqual(status, 403)
        status, payload = self.act("cafe:c_seduh", "cafe.stock", cafe="c_senja", key="milk:oat", available=False)
        self.assertEqual(status, 403)
        status, payload = self.act("emp:e_dewi", "policy.update", ramadan_mode=False)  # Dewi is an admin
        self.assertEqual(status, 200, payload)
        status, payload = self.act("cafe:c_senja", "cafe.stock", cafe="c_senja", key="milk:oat", available=True)
        self.assertEqual(status, 200, payload)

    def test_one_tap_reorder_own_account(self):
        status, payload = self.act("emp:e_andi", "solo.reorder", emp="e_andi", which="usual")
        self.assertTrue(payload["ok"], payload)
        self.act("emp:e_maya", "profile.update", emp="e_maya", fields={"usual": None})
        status, payload = self.act("emp:e_maya", "solo.reorder", emp="e_maya", which="usual")
        self.assertEqual(payload["error"]["code"], "NO_USUAL")

    # -- payments -----------------------------------------------------------------

    def test_topup_only_credited_by_signed_webhook_once(self):
        state = server.STATE
        before = state["employees"]["e_fajar"]["wallet"]["balance"]
        status, payload = self.act("emp:e_fajar", "payment.create_topup", emp="e_fajar", amount=50000, method="QRIS")
        self.assertTrue(payload["ok"], payload)
        charge = payload["result"]
        self.assertTrue(P.verify_emv_crc(charge["qr_string"]))
        self.assertEqual(state["employees"]["e_fajar"]["wallet"]["balance"], before)
        body = {"id": charge["id"], "status": "PAID", "amount": 50000, "currency": "IDR"}
        status, payload = self.post("/api/webhooks/payment", body, headers={"x-callback-token": "wrong"})
        self.assertEqual(status, 401)
        token = server.GATEWAY.callback_token
        status, payload = self.post("/api/webhooks/payment", dict(body, amount=999999), headers={"x-callback-token": token})
        self.assertEqual(status, 400)
        status, payload = self.post("/api/webhooks/payment", body, headers={"x-callback-token": token})
        self.assertEqual(status, 200)
        status, payload = self.post("/api/webhooks/payment", body, headers={"x-callback-token": token})
        self.assertTrue(payload.get("duplicate"))
        self.assertEqual(state["employees"]["e_fajar"]["wallet"]["balance"], before + 50000)
        # someone else cannot trigger the simulated payment for Fajar's charge
        status, payload = self.act("emp:e_fajar", "payment.create_topup", emp="e_fajar", amount=20000, method="GoPay")
        other = payload["result"]["id"]
        status, payload = self.act("emp:e_andi", "payment.simulate_paid", payment=other)
        self.assertEqual(status, 403)
        status, payload = self.act("emp:e_fajar", "payment.simulate_paid", payment=other)
        self.assertTrue(payload["ok"], payload)

    def test_sgd_topup_qr_uses_decimal_amount(self):
        status, payload = self.act("emp:e_weiling", "payment.create_topup", emp="e_weiling", amount=2000, method="PayNow")
        self.assertTrue(payload["ok"], payload)
        qr_string = payload["result"]["qr_string"]
        self.assertIn("540520.00", qr_string)  # tag 54, length 05, value 20.00
        self.assertIn("5303702", qr_string)    # SGD numeric code
        self.assertTrue(P.verify_emv_crc(qr_string))
        status, headers, body = self.get("/api/qr.svg?emv=1&amount=6.50&ref=X&country=SG&currency=SGD")
        self.assertEqual(status, 200)
        with self.assertRaises(urllib.error.HTTPError):
            self.get("/api/qr.svg?emv=1&amount=abc")

    def test_emv_crc_reference_vector(self):
        self.assertEqual(P.crc16_ccitt("123456789"), "29B1")

    # -- QR & audit ---------------------------------------------------------------

    def test_qr_endpoint_returns_scannable_svg(self):
        status, headers, body = self.get("/api/qr.svg?data=" + quote("http://localhost:8787/#join/ABCDE"))
        self.assertIn("image/svg+xml", headers["Content-Type"])
        self.assertIn(b"<svg", body)
        status, headers, body = self.get("/api/qr.svg?emv=1&amount=28000&ref=TEST&merchant=KOPI")
        self.assertIn(b"<path", body)
        try:
            import cv2  # noqa: F401
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("OpenCV not installed; scannability check skipped")
        from crewcup import qr
        code = qr.encode("http://localhost:8787/#join/ABCDE")
        import numpy as np
        scale = 6
        size = (code.size + 8) * scale
        img = np.full((size, size), 255, np.uint8)
        for y, row in enumerate(code.modules):
            for x, dark in enumerate(row):
                if dark:
                    img[(y + 4) * scale:(y + 5) * scale, (x + 4) * scale:(x + 5) * scale] = 0
        import cv2
        self.assertEqual(cv2.QRCodeDetector().detectAndDecode(img)[0], "http://localhost:8787/#join/ABCDE")

    def test_audit_log_is_admin_only_and_records_denials(self):
        self.act("emp:e_andi", "solo.reorder", emp="e_maya")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.get("/api/audit", persona="emp:e_andi")
        self.assertEqual(caught.exception.code, 403)
        status, headers, body = self.get("/api/audit?limit=50", persona="admin:co")
        rows = json.loads(body)["rows"]
        self.assertTrue(any(row["action"] == "solo.reorder" and row["ok"] == 0 and row["code"] == "FORBIDDEN" for row in rows))
        self.assertTrue(any(row["action"] == "session.login" for row in rows))

    def test_live_events_stream_announces_changes(self):
        stream = OPENER.open(self.url("/api/events"), timeout=5)
        try:
            self.assertIn("text/event-stream", stream.headers["Content-Type"])
            first = b""
            while b"data:" not in first:
                first += stream.readline()
            self.act("emp:e_andi", "clock.advance", minutes=1)
            second = b""
            deadline = time.time() + 5
            while b"data:" not in second and time.time() < deadline:
                second += stream.readline()
            self.assertIn(b"event: rev", second)
        finally:
            stream.close()


    # -- CrewCup Network --------------------------------------------------------------

    def test_network_state_is_filtered_per_viewer(self):
        status, headers, body = self.get("/api/state")
        payload = json.loads(body)
        self.assertNotIn("social", payload["state"])          # raw network store never leaves the server
        self.assertEqual(payload["social"]["feed"], [])       # anonymous: nothing
        status, headers, body = self.get("/api/state", persona="emp:e_andi")
        andi = json.loads(body)["social"]
        self.assertIn("p_mandala_api", {post["id"] for post in andi["feed"]})
        self.assertNotIn("co_samudra", {company["id"] for company in andi["companies"]})
        status, headers, body = self.get("/api/state", persona="emp:e_weiling")
        weiling = json.loads(body)["social"]
        self.assertNotIn("p_mandala_api", {post["id"] for post in weiling["feed"]})
        status, headers, body = self.get("/api/state", persona="admin:co")
        self.assertIn("admin", json.loads(body)["social"])

    def test_network_permissions(self):
        status, payload = self.act("emp:e_andi", "social.post", emp="e_sari", text="Not me", audience="company")
        self.assertEqual(status, 403)
        status, payload = self.act("cafe:c_senja", "social.post", emp="e_andi", text="Hi", audience="company")
        self.assertEqual(status, 403)
        status, payload = self.act("emp:e_andi", "social.moderate", post="p_putri_seduh", decision="remove")
        self.assertEqual(status, 403)
        status, payload = self.act("cafe:c_aren", "social.cafe_post", cafe="c_senja", text="Spoofed")
        self.assertEqual(status, 403)
        status, payload = self.act("emp:e_weiling", "social.comment", emp="e_weiling", post="p_mandala_api", text="Hi")
        self.assertEqual(status, 200)
        self.assertFalse(payload["ok"])                       # not visible from Singapore
        self.assertEqual(payload["error"]["code"], "NOT_FOUND")

    def test_network_post_and_cafe_announcement_round_trip(self):
        status, payload = self.act("emp:e_sari", "social.post", emp="e_sari", text="Design critique Friday, all tenants welcome.",
                                   audience="building", kind="update", cafe="c_senja")
        self.assertTrue(payload["ok"], payload)
        post_id = payload["result"]
        status, payload = self.act("cafe:c_senja", "social.cafe_post", cafe="c_senja", text="Oat milk is back in stock.")
        self.assertTrue(payload["ok"], payload)
        status, headers, body = self.get("/api/state", persona="emp:e_andi")
        feed = {post["id"]: post for post in json.loads(body)["social"]["feed"]}
        self.assertIn(post_id, feed)
        self.assertIn(payload["result"], feed)
        status, payload = self.act("emp:e_andi", "social.react", emp="e_andi", post=post_id)
        self.assertTrue(payload["result"]["liked"])


    # -- Company rewards ----------------------------------------------------------------

    def test_rewards_are_private_and_admin_only(self):
        status, headers, body = self.get("/api/state")
        payload = json.loads(body)
        self.assertNotIn("rewards", payload["state"])
        self.assertIsNone(payload["rewards"])
        status, headers, body = self.get("/api/state", persona="emp:e_andi")
        self.assertNotIn("vouchers", json.loads(body)["rewards"])
        status, payload = self.act("emp:e_andi", "rewards.give", office="o_jkt", target_kind="person", target="e_andi", coffees=5)
        self.assertEqual(status, 403)
        status, payload = self.act("emp:e_andi", "rewards.nominate", emp="e_sari", nominee="e_andi", message="Nominating myself via Sari")
        self.assertEqual(status, 403)
        status, payload = self.act("cafe:c_aren", "rewards.redeem", cafe="c_senja", code="CC-XXXXXX")
        self.assertEqual(status, 403)

    def test_reward_round_trip(self):
        status, payload = self.act("admin:co", "rewards.give", office="o_jkt", target_kind="person", target="e_fajar",
                                   coffees=1, reason="thank_you", message="Closed the Bank Mandala deal", announce=True)
        self.assertTrue(payload["ok"], payload)
        status, headers, body = self.get("/api/state", persona="emp:e_fajar")
        self.assertTrue(any(row["message"] == "Closed the Bank Mandala deal" for row in json.loads(body)["rewards"]["mine"]))
        status, payload = self.act("admin:co", "rewards.partner", office="o_jkt", to="member:m_rina", coffees=1)
        self.assertTrue(payload["ok"], payload)
        status, payload = self.act("cafe:c_senja", "rewards.redeem", cafe="c_senja", code=payload["result"])
        self.assertTrue(payload["ok"], payload)


    # -- Loyalty ------------------------------------------------------------------------

    def test_loyalty_is_private_and_permissioned(self):
        status, headers, body = self.get("/api/state")
        payload = json.loads(body)
        self.assertNotIn("loyalty", payload["state"])
        self.assertIsNone(payload["loyalty"])
        status, headers, body = self.get("/api/state", persona="emp:e_sari")
        sari = json.loads(body)["loyalty"]
        self.assertTrue(all(coupon["emp"] == "e_sari" for coupon in sari["coupons"]))
        status, payload = self.act("emp:e_sari", "loyalty.redeem", emp="e_andi", item="pct10")
        self.assertEqual(status, 403)
        status, payload = self.act("cafe:c_aren", "loyalty.promo_create", cafe="c_senja", title="Spoofed promo", kind="percent", value=50)
        self.assertEqual(status, 403)

    def test_coupon_preview_and_order(self):
        status, headers, body = self.get("/api/state", persona="emp:e_putri")
        promo = next(p for p in json.loads(body)["loyalty"]["promos"] if p["cafe"] == "c_seduh")
        status, payload = self.act("emp:e_putri", "loyalty.claim", emp="e_putri", promo=promo["id"])
        self.assertTrue(payload["ok"], payload)
        status, headers, body = self.get("/api/state", persona="emp:e_putri")
        coupon = next(c for c in json.loads(body)["loyalty"]["coupons"] if c.get("promo") == promo["id"])
        status, preview = self.post("/api/preview", {"emp": "e_putri", "cafe": "c_seduh", "spec": {"item": "latte"},
                                                     "coupon": coupon["id"]}, persona="emp:e_putri")
        self.assertGreater(preview["price"]["coupon"], 0)
        status, payload = self.act("emp:e_putri", "solo.order", emp="e_putri", cafe="c_seduh", spec={"item": "latte"},
                                   coupon=coupon["id"])
        self.assertTrue(payload["ok"], payload)


if __name__ == "__main__":
    unittest.main()
