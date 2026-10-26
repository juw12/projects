"""GlowLead's "instant cloud browser" end to end: a phone-sized GlowLead starts a session on the real Glow cloud
service code (apps/glow/cloud, run locally on Node with a real Chromium in place of Cloudflare's browser) and runs a
browser mission with approval before submitting.
"""
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import unittest
from pathlib import Path

import test_glow_hands as base

CLOUD = base.APP / "cloud"


def playwright_driver():
    """Node and playwright-core bundled with the Python Playwright package."""
    try:
        import playwright
    except ImportError:
        return None, None
    driver = Path(playwright.__file__).parent / "driver"
    node = driver / ("node.exe" if sys.platform == "win32" else "node")
    core = driver / "package"
    if node.exists() and core.exists():
        return node, core
    return None, None


NODE, CORE = playwright_driver()


@unittest.skipUnless(base.HAVE_PLAYWRIGHT and NODE, "Install the optional Playwright test dependency to run this check")
class InstantCloudEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        class QuietStatic(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        cls.web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietStatic, directory=str(base.APP / "web")))
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        cls.web_url = f"http://127.0.0.1:{cls.web.server_port}"

        env = dict(os.environ, GLOW_PLAYWRIGHT_CORE=str(CORE), ALLOWED_ORIGINS=cls.web_url)
        cls.service = subprocess.Popen(
            [str(NODE), str(CLOUD / "test" / "local-server.mjs")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env,
        )
        line = cls.service.stdout.readline()
        if not line.startswith("READY "):
            cls.service.kill()
            raise RuntimeError("Cloud service did not start: " + line + cls.service.stderr.read())
        cls.service_url = "http://127.0.0.1:" + line.split()[1]

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.service.stdin.close()
        try:
            cls.service.wait(timeout=15)
        except subprocess.TimeoutExpired:
            cls.service.kill()
        cls.web.shutdown()
        cls.web.server_close()

    def phone(self, script, service_url=None):
        context = self.browser.new_context(**self.playwright.devices["iPhone 13"])
        self.addCleanup(context.close)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=base.E2E_ENGINE_STUB))
        page = context.new_page()
        page.add_init_script("window.GLOW_CLOUD_SERVICE_URL = " + json.dumps(service_url or self.service_url) + ";")
        page.add_init_script("window.__config = " + json.dumps({"plan": base.BROWSER_PLAN, "script": script}) + ";")
        page.goto(self.web_url + "/lead/")
        return page

    def observe(self, page):
        return page.evaluate("GlowLead.hands.call('observe')")

    def test_one_tap_cloud_browser_runs_a_mission_with_approval(self):
        script = [
            {"action": "goto", "url": "http://shop.test/form.html"},
            {"action": "type", "name": "Full name", "text": "Instant User"},
            {"action": "select", "name": "Size", "text": "Large"},
            {"action": "click", "name": "Place order"},
            {"action": "done", "summary": "Ordered from the instant cloud browser."},
        ]
        page = self.phone(script)
        page.click("#hands-btn")
        self.assertTrue(page.locator("#instant-box").is_visible(), "Instant cloud browser is offered first")
        self.assertFalse(page.locator("#cloud-token").is_visible(), "No GitHub token needed")
        page.click("#instant-start")
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=60000)
        self.assertEqual(page.locator("#hands-status").inner_text(), "CONNECTED · CLOUD")
        saved = json.loads(page.evaluate("localStorage.getItem('glowlead.hands.v1')"))
        self.assertEqual(saved["mode"], "service")
        page.click("#hands-cancel")

        page.evaluate("GlowLead.start('Order with the instant cloud browser', false, { allowHands: true })")
        page.wait_for_selector("#approve-action", timeout=60000)
        self.assertEqual(self.observe(page)["title"], "Test shop", "Nothing submitted before approval")
        page.click("#approve-action")
        page.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=60000)
        done = self.observe(page)
        self.assertEqual(done["title"], "Done")
        self.assertIn("name=Instant+User", done["url"])
        self.assertIn("size=Large", done["url"])

        page.click("#hands-btn")
        page.click("#instant-stop")
        page.wait_for_function("document.getElementById('instant-note').textContent.includes('stopped')", timeout=20000)
        self.assertIsNone(page.evaluate("localStorage.getItem('glowlead.hands.v1')"))
        ended = page.evaluate(
            "(args) => fetch(args.url + '/v1/sessions/' + args.session + '/call', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path: 'status'})}).then((r) => r.status)",
            {"url": self.service_url, "session": saved["session"]},
        )
        self.assertEqual(ended, 410, "Stopping really closes the cloud browser")

    def test_private_addresses_and_unreachable_service_are_explained(self):
        page = self.phone([])
        page.click("#hands-btn")
        page.click("#instant-start")
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=60000)
        blocked = page.evaluate("GlowLead.hands.call('act', { action: { action: 'goto', url: 'http://192.168.1.1/' } })")
        self.assertEqual(blocked["status"], 400)
        page.click("#instant-stop")

        offline = self.phone([], service_url="http://127.0.0.1:9")
        offline.click("#hands-btn")
        offline.click("#instant-start")
        offline.wait_for_function("document.getElementById('instant-note').textContent.includes(\"Can't reach\")", timeout=20000)
        self.assertNotEqual(offline.locator("#hands-status").inner_text(), "CONNECTED · CLOUD")

    def test_without_a_service_the_instant_option_is_hidden(self):
        context = self.browser.new_context(**self.playwright.devices["iPhone 13"])
        self.addCleanup(context.close)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=base.E2E_ENGINE_STUB))
        page = context.new_page()
        page.goto(self.web_url + "/lead/")
        page.click("#hands-btn")
        lead_source = (base.APP / "web" / "lead" / "lead.js").read_text(encoding="utf-8")
        service_configured = 'CLOUD_SERVICE_URL = ""' not in lead_source
        self.assertEqual(page.locator("#instant-box").is_visible(), service_configured)


if __name__ == "__main__":
    unittest.main(verbosity=2)
