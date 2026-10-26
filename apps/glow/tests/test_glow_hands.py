"""Glow Hands companion tests: a real local browser, a real local form, no external network.

Optional development dependency: playwright==1.55.0 with Chromium installed.
Run: python -X utf8 apps/glow/tests/test_glow_hands.py
"""
import functools
import http.client
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

try:
    import playwright  # noqa: F401
    HAVE_PLAYWRIGHT = True
except ImportError:
    HAVE_PLAYWRIGHT = False

APP = Path(__file__).resolve().parents[1]
COMPANION = APP / "hands" / "glow_hands.py"
TOKEN = "test-token-0123456789abcdef"
FORM_PAGE = """<!doctype html><title>Test shop</title>
<h1>Checkout</h1>
<form action="/done.html" method="get">
  <label for="name">Full name</label><input id="name" name="name">
  <label for="size">Size</label><select id="size" name="size"><option>Small</option><option>Large</option></select>
  <label for="pw">Password</label><input id="pw" type="password" name="pw">
  <label for="card">Card</label><input id="card" name="card" autocomplete="cc-number">
  <button type="button" id="more" onclick="document.getElementById('extra').hidden=false">Show details</button>
  <p id="extra" hidden>Delivery in 2 days</p>
  <button type="submit">Place order</button>
</form>"""
DONE_PAGE = "<!doctype html><title>Done</title><h1>Order received</h1>"


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class SiteHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        body = (DONE_PAGE if self.path.startswith("/done.html") else FORM_PAGE).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def start_companion(port, profile, *extra):
    env = os.environ.copy()
    process = subprocess.Popen(
        [sys.executable, str(COMPANION), "--port", str(port), "--profile", profile, "--headless", "--token", TOKEN,
         *(tuple(arg for arg in extra if arg != "--phone") if "--phone" in extra else ("--no-phone", *extra))],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return process
        except OSError:
            time.sleep(0.1)
    process.kill()
    raise RuntimeError("Glow Hands did not start: " + process.stderr.read()[-800:])


def stop_companion(process):
    process.terminate()
    process.wait(timeout=10)
    process.stdout.close()
    process.stderr.close()


def call(port, method, path, body=None, token=TOKEN, origin=None, host=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=40)
    headers = {"Host": host or f"127.0.0.1:{port}", "Content-Type": "application/json"}
    if token:
        headers["X-Glow-Token"] = token
    if origin:
        headers["Origin"] = origin
    connection.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    headers_out = dict(response.getheaders())
    connection.close()
    try:
        data = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        data = {}
    return response.status, data, headers_out


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class GlowHandsCompanionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        threading.Thread(target=cls.site.serve_forever, daemon=True).start()
        cls.site_url = f"http://127.0.0.1:{cls.site.server_port}"
        cls.profile = tempfile.mkdtemp(prefix="glow-hands-test-")
        cls.port = free_port()
        cls.process = start_companion(cls.port, cls.profile, "--allow-private")

    @classmethod
    def tearDownClass(cls):
        try:
            call(cls.port, "POST", "/close", {})
        finally:
            stop_companion(cls.process)
            cls.site.shutdown()
            cls.site.server_close()

    def act(self, action, approved=False):
        return call(self.port, "POST", "/act", {"action": action, "approved": approved})

    def ref(self, name):
        status, view, _ = call(self.port, "GET", "/observe")
        self.assertEqual(status, 200, view)
        for element in view["elements"]:
            if element["name"] == name:
                return element["ref"]
        self.fail(f"No element named {name!r} in {[e['name'] for e in view['elements']]}")

    def test_status_is_public_but_actions_need_token(self):
        status, data, _ = call(self.port, "GET", "/status", token=None)
        self.assertEqual((status, data["app"], data["paired"]), (200, "glow-hands", False))
        self.assertTrue(call(self.port, "GET", "/status")[1]["paired"])
        self.assertEqual(call(self.port, "GET", "/observe", token=None)[0], 401)
        self.assertEqual(call(self.port, "GET", "/observe", token="wrong-token")[0], 401)
        self.assertEqual(call(self.port, "POST", "/act", {"action": {"action": "back"}}, token=None)[0], 401)

    def test_origin_and_host_checks(self):
        self.assertEqual(call(self.port, "GET", "/status", origin="https://evil.example")[0], 403)
        self.assertEqual(call(self.port, "GET", "/status", host="attacker.example:80")[0], 403)
        status, _, headers = call(self.port, "GET", "/status", origin="https://juw12.github.io")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://juw12.github.io")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        connection.request("OPTIONS", "/act", headers={
            "Host": f"127.0.0.1:{self.port}", "Origin": "https://juw12.github.io",
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-glow-token",
            "Access-Control-Request-Private-Network": "true"})
        response = connection.getresponse()
        response.read()
        self.assertEqual(response.status, 204)
        self.assertEqual(response.getheader("Access-Control-Allow-Private-Network"), "true")
        self.assertIn("X-Glow-Token", response.getheader("Access-Control-Allow-Headers"))
        connection.close()

    def test_fill_form_and_require_approval_to_submit(self):
        status, data, _ = self.act({"action": "goto", "url": self.site_url + "/form.html"})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["title"], "Test shop")
        status, view, _ = call(self.port, "GET", "/observe")
        names = [element["name"] for element in view["elements"]]
        for expected in ("Full name", "Size", "Show details", "Place order"):
            self.assertIn(expected, names)
        self.assertTrue(view["hasPassword"])
        self.assertEqual(self.act({"action": "type", "ref": self.ref("Full name"), "text": "Juwen Lie"})[0], 200)
        self.assertEqual(self.act({"action": "select", "ref": self.ref("Size"), "text": "Large"})[0], 200)
        self.assertEqual(self.act({"action": "click", "ref": self.ref("Show details")})[0], 200)
        self.assertIn("Delivery in 2 days", call(self.port, "GET", "/observe")[1]["text"])
        status, data, _ = self.act({"action": "click", "ref": self.ref("Place order")})
        self.assertEqual(status, 409)
        self.assertTrue(data["needsApproval"])
        self.assertEqual(call(self.port, "GET", "/observe")[1]["title"], "Test shop", "Nothing was submitted")
        status, data, _ = self.act({"action": "click", "ref": self.ref("Place order")}, approved=True)
        self.assertEqual(status, 200, data)
        self.assertEqual(data["title"], "Done")
        self.assertIn("name=Juwen+Lie", data["url"])
        self.assertIn("size=Large", data["url"])

    def test_enter_in_form_needs_approval(self):
        self.act({"action": "goto", "url": self.site_url + "/form.html"})
        self.act({"action": "type", "ref": self.ref("Full name"), "text": "x"})
        status, data, _ = self.act({"action": "press", "key": "Enter"})
        self.assertEqual(status, 409)
        self.assertTrue(data["needsApproval"])

    def test_never_types_passwords_or_card_numbers(self):
        self.act({"action": "goto", "url": self.site_url + "/form.html"})
        for name in ("Password", "Card"):
            status, data, _ = self.act({"action": "type", "ref": self.ref(name), "text": "secret"})
            self.assertEqual(status, 403, name)
            self.assertTrue(data["secret"])
        _, view, _ = call(self.port, "GET", "/observe")
        secret = [element for element in view["elements"] if element["secret"]]
        self.assertEqual(len(secret), 2)

    def test_rejects_bad_actions_and_schemes(self):
        for action in ({"action": "goto", "url": "file:///C:/Windows/win.ini"}, {"action": "goto", "url": "javascript:alert(1)"},
                       {"action": "goto", "url": "https://user:pass@example.com"}, {"action": "press", "key": "Control+W"},
                       {"action": "launch_rockets"}, {"action": "click", "ref": "not-a-number"}):
            status, data, _ = self.act(action)
            self.assertEqual(status, 400, (action, data))
        self.act({"action": "goto", "url": self.site_url + "/form.html"})
        self.assertEqual(self.act({"action": "click", "ref": 999})[0], 409)

    def test_private_network_blocked_without_flag(self):
        port = free_port()
        process = start_companion(port, tempfile.mkdtemp(prefix="glow-hands-strict-"))
        try:
            status, data, _ = call(port, "POST", "/act", {"action": {"action": "goto", "url": self.site_url + "/form.html"}})
            self.assertEqual(status, 400)
            self.assertIn("Private network", data["error"])
            status, data, _ = call(port, "POST", "/act", {"action": {"action": "goto", "url": "http://localhost:9/"}})
            self.assertEqual(status, 400)
        finally:
            stop_companion(process)


E2E_ENGINE_STUB = r"""
window.__prompts = [];
window.__calls = [];
window.CrewEngine = {
  BOTS: {},
  tools: {
    chat: async (options) => {
      const config = window.__config || {};
      const content = options.messages[0].content;
      const kind = options.system.startsWith("You are Glow Hands") ? "browser"
        : options.system.startsWith("You are GlowLead, the lead of a team") ? "plan"
        : options.system.includes("CHECK:") ? "review" : "work";
      window.__calls.push({ kind, system: options.system, content });
      if (kind === "plan") return JSON.stringify(config.plan);
      if (kind === "review") return 'Report.\nCHECK: {"met":[true,true],"missing":""}';
      if (kind === "work") return "Written summary.";
      window.__prompts.push(content);
      const next = (config.script || [])[window.__prompts.length - 1] || { action: "done", summary: "Ran out of script" };
      const action = { ...next };
      if (action.name) {
        const match = content.match(new RegExp("\\[(\\d+)\\] [^\\n]*\"" + action.name + "\""));
        action.ref = match ? Number(match[1]) : 9999;
        delete action.name;
      }
      return JSON.stringify(action);
    }
  },
  start: () => ({ id: "none", status: "done", final: "", steps: [] }),
  getRun: () => null,
  stop: () => {},
  on: () => {},
  openSettings: () => {},
  glow: { status: () => ({ signedIn: false }), signIn: async () => {} }
};
"""

BROWSER_PLAN = {"summary": "Order", "criteria": ["Form filled", "Submitted only with approval"],
                "steps": [{"worker": "browser", "title": "Fill the order form", "task": "Order a Large item for Juwen Lie"}]}


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class GlowLeadDrivesGlowHandsEndToEnd(unittest.TestCase):
    """GlowLead's real page controls the real Glow Hands companion, which controls a real browser."""

    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright
        cls.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        threading.Thread(target=cls.site.serve_forever, daemon=True).start()
        cls.site_url = f"http://127.0.0.1:{cls.site.server_port}"

        class QuietStatic(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        cls.web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietStatic, directory=str(APP / "web")))
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        cls.web_url = f"http://127.0.0.1:{cls.web.server_port}"
        cls.port = free_port()
        cls.process = start_companion(cls.port, tempfile.mkdtemp(prefix="glow-hands-e2e-"), "--allow-private")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        try:
            call(cls.port, "POST", "/close", {})
        finally:
            stop_companion(cls.process)
        for server in (cls.site, cls.web):
            server.shutdown()
            server.server_close()

    def open(self, script, plan=BROWSER_PLAN, token=TOKEN):
        context = self.browser.new_context()
        self.addCleanup(context.close)
        self.errors = []
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=E2E_ENGINE_STUB))
        hands = json.dumps({"url": f"http://127.0.0.1:{self.port}", "token": token})
        context.add_init_script("window.__config = " + json.dumps({"plan": plan, "script": script}) + ";"
                                "if (location.protocol === 'http:') localStorage.setItem('glowlead.hands.v1', " + json.dumps(hands) + ");")
        page = context.new_page()
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.goto(self.web_url + "/lead/")
        page.wait_for_function("!!window.GlowLead")
        return page

    def tearDown(self):
        self.assertEqual(getattr(self, "errors", []), [], "No uncaught browser errors")

    def companion_page(self):
        return call(self.port, "GET", "/observe")[1]

    def test_connect_status_enables_permission(self):
        page = self.open([])
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'")
        self.assertTrue(page.locator("#allow-hands").is_enabled())
        bad = self.open([], token="wrong-token-value-000")
        bad.wait_for_function("document.getElementById('hands-status').dataset.state === 'wrong-token'")
        self.assertTrue(bad.locator("#allow-hands").is_disabled())

    def test_fills_real_form_and_submits_only_after_ui_approval(self):
        script = [
            {"action": "goto", "url": self.site_url + "/form.html"},
            {"action": "type", "name": "Full name", "text": "Juwen Lie"},
            {"action": "select", "name": "Size", "text": "Large"},
            {"action": "click", "name": "Place order"},
            {"action": "done", "summary": "Placed the order for Juwen Lie, size Large."},
        ]
        page = self.open(script)
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'")
        page.fill("#lead-input", "Order a Large item for Juwen Lie on the test shop")
        page.uncheck("#lead-approve")
        page.check("#allow-hands")
        page.click("#lead-go")
        page.wait_for_selector("#approve-action", timeout=30000)
        self.assertIn("Place order", page.locator(".action-approval").inner_text())
        before = self.companion_page()
        self.assertEqual(before["title"], "Test shop", "Nothing submitted before approval")
        values = {element["name"]: element["value"] for element in before["elements"]}
        self.assertEqual(values["Full name"], "Juwen Lie")
        page.click("#approve-action")
        page.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=30000)
        after = self.companion_page()
        self.assertEqual(after["title"], "Done")
        self.assertIn("name=Juwen+Lie", after["url"])
        self.assertIn("size=Large", after["url"])
        lead = page.evaluate("GlowLead.leads[0]")
        self.assertEqual(lead["steps"][0]["worker"], "browser")
        self.assertIn("Placed the order", lead["steps"][0]["output"])
        events = " | ".join(event["text"] for event in lead["events"])
        self.assertIn("You approved", events)
        self.assertIn("Glow Hands: Type", events)
        prompt = page.evaluate("__prompts[1]")
        self.assertIn("untrusted", page.evaluate("__calls.find(call => call.kind === 'browser').system"))
        self.assertRegex(prompt, r'\[\d+\] input "Full name"')

    def test_declined_submit_is_never_sent(self):
        script = [
            {"action": "goto", "url": self.site_url + "/form.html"},
            {"action": "click", "name": "Place order"},
            {"action": "done", "summary": "Not submitted because the user declined."},
        ]
        page = self.open(script)
        page.evaluate("GlowLead.start('Try to order', false, { allowHands: true })")
        page.wait_for_selector("#decline-action", timeout=30000)
        page.click("#decline-action")
        page.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=30000)
        self.assertEqual(self.companion_page()["title"], "Test shop")
        self.assertIn("DECLINED", page.evaluate("__prompts[2]"))
        self.assertIn("You declined", " | ".join(e["text"] for e in page.evaluate("GlowLead.leads[0].events")))

    def test_password_typing_is_refused_by_companion(self):
        script = [
            {"action": "goto", "url": self.site_url + "/form.html"},
            {"action": "type", "name": "Password", "text": "hunter2"},
            {"action": "done", "summary": "Could not type the password."},
        ]
        page = self.open(script)
        page.evaluate("GlowLead.start('Log in', false, { allowHands: true })")
        page.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=30000)
        self.assertIn("never types passwords", page.evaluate("__prompts[2]"))

    def test_stop_while_waiting_for_approval(self):
        script = [{"action": "goto", "url": self.site_url + "/form.html"}, {"action": "click", "name": "Place order"}]
        page = self.open(script)
        page.evaluate("GlowLead.start('Order', false, { allowHands: true })")
        page.wait_for_selector("#approve-action", timeout=30000)
        page.click("#stop-btn")
        page.wait_for_function("GlowLead.leads[0].status === 'stopped'")
        self.assertEqual(self.companion_page()["title"], "Test shop")
        self.assertEqual(page.locator("#approve-action").count(), 0)

    def test_browser_worker_is_unavailable_without_permission(self):
        page = self.open([])
        page.evaluate("GlowLead.start('Order', true)")
        page.wait_for_selector("#approve-btn")
        self.assertEqual(page.evaluate("GlowLead.leads[0].steps[0].worker"), "chat")
        self.assertEqual(page.locator("#edit-worker-0 option[value=browser]").count(), 0)
        self.assertNotIn("Glow Hands", page.evaluate("__calls[0].system"))

    def test_action_parser_rejects_malformed_replies(self):
        page = self.open([])
        results = page.evaluate("""() => [
          GlowLead.parseBrowserAction('nonsense'),
          GlowLead.parseBrowserAction('{"action":"rm -rf"}'),
          GlowLead.parseBrowserAction('{"action":"click","ref":"abc"}'),
          GlowLead.parseBrowserAction('```json\\n{"action":"click","ref":"4"}\\n```'),
          GlowLead.parseBrowserAction('{"action":"type","ref":2,"text":"' + 'x'.repeat(900) + '"}').text.length,
        ]""")
        self.assertEqual(results[:3], [None, None, None])
        self.assertEqual(results[3], {"action": "click", "ref": 4})
        self.assertLessEqual(results[4], 500)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class OneClickPairingTests(unittest.TestCase):
    """Pairing without typing a code: the person at the PC answers a prompt (simulated here)."""

    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        class QuietStatic(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        cls.web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietStatic, directory=str(APP / "web")))
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        cls.web_url = f"http://127.0.0.1:{cls.web.server_port}"
        cls.yes_port = free_port()
        cls.yes = start_companion(cls.yes_port, tempfile.mkdtemp(prefix="glow-pair-yes-"), "--pair-test-answer", "yes")
        cls.no_port = free_port()
        cls.no = start_companion(cls.no_port, tempfile.mkdtemp(prefix="glow-pair-no-"), "--pair-test-answer", "no")
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        stop_companion(cls.yes)
        stop_companion(cls.no)
        cls.web.shutdown()
        cls.web.server_close()

    def test_pair_endpoint_rules(self):
        status, data, headers = call(self.yes_port, "POST", "/pair", token=None, origin="https://juw12.github.io")
        self.assertEqual(status, 200)
        self.assertEqual(data["token"], TOKEN)
        self.assertEqual(data["url"], f"http://127.0.0.1:{self.yes_port}")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "https://juw12.github.io")
        self.assertEqual(call(self.yes_port, "POST", "/pair", token=None)[0], 400, "Must come from a browser page")
        self.assertEqual(call(self.yes_port, "POST", "/pair", token=None, origin="https://evil.example")[0], 403)
        self.assertEqual(call(self.yes_port, "POST", "/pair", token=None, origin="https://juw12.github.io", host="evil.example")[0], 403)

    def test_declined_pairing_reveals_nothing_and_cools_down(self):
        port = free_port()
        process = start_companion(port, tempfile.mkdtemp(prefix="glow-pair-cool-"), "--pair-test-answer", "no")
        self.addCleanup(stop_companion, process)
        status, data, _ = call(port, "POST", "/pair", token=None, origin="https://juw12.github.io")
        self.assertEqual(status, 403)
        self.assertNotIn("token", data)
        status, data, _ = call(port, "POST", "/pair", token=None, origin="https://juw12.github.io")
        self.assertEqual(status, 429, "Repeated requests must not spam the person with prompts")
        self.assertNotIn("token", data)

    def open_lead(self, port, hash_part=""):
        context = self.browser.new_context()
        self.addCleanup(context.close)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=E2E_ENGINE_STUB))
        saved = json.dumps({"url": f"http://127.0.0.1:{port}", "token": ""})
        context.add_init_script("if (location.protocol === 'http:' && !localStorage.getItem('glowlead.hands.v1')) "
                                "localStorage.setItem('glowlead.hands.v1', " + json.dumps(saved) + ");")
        page = context.new_page()
        page.goto(self.web_url + "/lead/" + hash_part)
        page.wait_for_function("!!window.GlowLead")
        return page

    def test_one_click_connect_saves_and_persists(self):
        page = self.open_lead(self.yes_port)
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'not-set'")
        page.click("#hands-btn")
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)
        saved = json.loads(page.evaluate("localStorage.getItem('glowlead.hands.v1')"))
        self.assertEqual(saved, {"url": f"http://127.0.0.1:{self.yes_port}", "token": TOKEN})
        self.assertTrue(page.locator("#allow-hands").is_enabled())
        page.reload()
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)

    def test_installer_handoff_connects_without_any_click(self):
        page = self.open_lead(self.yes_port, "#hands-setup")
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)
        self.assertNotIn("hands-setup", page.url)

    def test_declined_connect_stays_disconnected_and_opens_help(self):
        port = free_port()
        process = start_companion(port, tempfile.mkdtemp(prefix="glow-pair-ui-no-"), "--pair-test-answer", "no")
        self.addCleanup(stop_companion, process)
        page = self.open_lead(port)
        page.click("#hands-btn")
        page.wait_for_selector("#hands-dialog[open]", timeout=15000)
        self.assertIn("declined", page.locator("#hands-test-result").inner_text())
        self.assertEqual(page.evaluate("JSON.parse(localStorage.getItem('glowlead.hands.v1')).token"), "")
        self.assertTrue(page.locator("#allow-hands").is_disabled())
        self.assertIn("install-glow-hands.ps1", page.locator("#hands-install-command").inner_text())

    def test_outdated_companion_is_explained(self):
        class OldCompanion(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def reply(self, status, body):
                payload = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "*"))
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def do_GET(self):
                self.reply(200, {"ok": True, "app": "glow-hands", "version": "0.1.0", "paired": False})

            def do_POST(self):
                self.reply(404, {"error": "Not found."})

        old = http.server.ThreadingHTTPServer(("127.0.0.1", 0), OldCompanion)
        threading.Thread(target=old.serve_forever, daemon=True).start()
        self.addCleanup(old.server_close)
        self.addCleanup(old.shutdown)
        page = self.open_lead(old.server_port)
        page.click("#hands-btn")
        page.wait_for_selector("#hands-dialog[open]", timeout=15000)
        self.assertIn("older version", page.locator("#hands-test-result").inner_text())

    def test_not_running_explains_install(self):
        busy = [port for port in range(8765, 8771) if socket.socket().connect_ex(("127.0.0.1", port)) == 0]
        if busy:
            self.skipTest(f"Ports {busy} are in use on this machine, so 'not running' cannot be simulated")
        page = self.open_lead(free_port())
        page.click("#hands-btn")
        page.wait_for_selector("#hands-dialog[open]", timeout=20000)
        self.assertIn("isn't running", page.locator("#hands-test-result").inner_text())


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class InAppPairingDefaultTests(unittest.TestCase):
    def test_connect_needs_no_prompt_by_default(self):
        port = free_port()
        process = start_companion(port, tempfile.mkdtemp(prefix="glow-pair-default-"))
        self.addCleanup(stop_companion, process)
        status, data, _ = call(port, "POST", "/pair", token=None, origin="https://juw12.github.io")
        self.assertEqual((status, data.get("token")), (200, TOKEN))
        self.assertEqual(call(port, "POST", "/pair", token=None, origin="https://evil.example")[0], 403)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class PhoneLinkEndToEnd(unittest.TestCase):
    """A phone-sized browser drives Glow Hands on the PC through the real PeerJS service (WebRTC)."""

    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        class QuietStatic(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        cls.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        threading.Thread(target=cls.site.serve_forever, daemon=True).start()
        cls.site_url = f"http://127.0.0.1:{cls.site.server_port}"
        cls.web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietStatic, directory=str(APP / "web")))
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        cls.web_url = f"http://127.0.0.1:{cls.web.server_port}"
        cls.port = free_port()
        cls.process = start_companion(cls.port, tempfile.mkdtemp(prefix="glow-phone-"), "--allow-private", "--phone",
                                      "--peerjs-url", cls.web_url + "/shared/peerjs.min.js")
        cls.link = None
        deadline = time.time() + 45
        while time.time() < deadline:
            status, data, _ = call(cls.port, "GET", "/phone-link")
            if status == 200 and data.get("bridgeReady"):
                cls.link = data
                break
            time.sleep(1)
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        stop_companion(cls.process)
        for server in (cls.site, cls.web):
            server.shutdown()
            server.server_close()

    def setUp(self):
        if not self.link:
            self.skipTest("The public PeerJS service is unreachable from this network")

    def context(self, phone=False, script=None, plan=BROWSER_PLAN):
        options = self.playwright.devices["iPhone 13"] if phone else {}
        context = self.browser.new_context(**options)
        self.addCleanup(context.close)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=E2E_ENGINE_STUB))
        context.add_init_script("window.__config = " + json.dumps({"plan": plan, "script": script or []}) + ";")
        return context

    def test_phone_link_endpoints_need_the_token(self):
        self.assertEqual(call(self.port, "GET", "/phone-link", token=None)[0], 401)
        self.assertEqual(call(self.port, "POST", "/bridge-heartbeat", {"peerOpen": False}, token=None)[0], 401)
        self.assertEqual(call(self.port, "POST", "/phone-link/reset", {}, token=None)[0], 401)
        self.assertRegex(self.link["peerId"], r"^glowhands-[0-9a-f]{24}$")

    def test_pc_shows_qr_and_phone_runs_a_browser_mission_with_approval(self):
        pc = self.context().new_page()
        saved = json.dumps({"url": f"http://127.0.0.1:{self.port}", "token": TOKEN})
        pc.goto(self.web_url + "/lead/")
        pc.evaluate("value => localStorage.setItem('glowlead.hands.v1', value)", saved)
        pc.reload()
        pc.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)
        pc.click("#hands-btn")
        self.assertTrue(pc.locator("#phone-link-box").is_visible())
        pc.click("#phone-link-btn")
        pc.wait_for_selector("#phone-qr svg", timeout=10000)
        phone_url = pc.locator("#phone-qr").get_attribute("data-url")
        self.assertIn("#phone=" + self.link["peerId"] + ".", phone_url)

        script = [
            {"action": "goto", "url": self.site_url + "/form.html"},
            {"action": "type", "name": "Full name", "text": "Phone User"},
            {"action": "click", "name": "Place order"},
            {"action": "done", "summary": "Ordered from the phone."},
        ]
        phone = self.context(phone=True, script=script).new_page()
        phone.goto(phone_url)
        phone.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=40000)
        self.assertEqual(phone.locator("#hands-status").inner_text(), "CONNECTED · PC")
        self.assertNotIn("#phone=", phone.url, "The secret must be removed from the address bar")
        self.assertEqual(json.loads(phone.evaluate("localStorage.getItem('glowlead.hands.v1')"))["mode"], "remote")
        phone.evaluate("GlowLead.start('Order from my phone', false, { allowHands: true })")
        phone.wait_for_selector("#approve-action", timeout=60000)
        self.assertEqual(call(self.port, "GET", "/observe")[1]["title"], "Test shop", "Nothing submitted before the phone approved")
        phone.click("#approve-action")
        phone.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=60000)
        done = call(self.port, "GET", "/observe")[1]
        self.assertEqual(done["title"], "Done")
        self.assertIn("name=Phone+User", done["url"])

    def test_wrong_secret_is_refused(self):
        phone = self.context(phone=True).new_page()
        phone.goto(self.web_url + "/lead/#phone=" + self.link["peerId"] + "." + "w" * 32)
        phone.wait_for_function("document.getElementById('hands-status').dataset.state === 'offline'", timeout=40000)
        self.assertEqual(phone.locator("#hands-status").inner_text(), "PC OFFLINE")
        self.assertTrue(phone.locator("#allow-hands").is_disabled())

    def test_turning_off_old_links_revokes_them(self):
        old = dict(self.link)
        status, fresh, _ = call(self.port, "POST", "/phone-link/reset", {})
        self.assertEqual(status, 200)
        self.assertNotEqual(fresh["peerId"], old["peerId"])
        deadline = time.time() + 45
        while time.time() < deadline and not call(self.port, "GET", "/phone-link")[1].get("bridgeReady"):
            time.sleep(1)
        type(self).link = call(self.port, "GET", "/phone-link")[1]
        old_phone = self.context(phone=True).new_page()
        old_phone.goto(self.web_url + "/lead/#phone=" + old["peerId"] + "." + old["secret"])
        old_phone.wait_for_function("document.getElementById('hands-status').dataset.state === 'offline'", timeout=40000)
        new_phone = self.context(phone=True).new_page()
        new_phone.goto(self.web_url + "/lead/#phone=" + fresh["peerId"] + "." + fresh["secret"])
        new_phone.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=40000)


CLOUD_KEY = "cloud-key-for-tests-0123456789abcdef"


def start_cloud_companion(port, profile, nonce, peerjs_url, *extra):
    env = os.environ.copy()
    env.update(GLOW_CLOUD_KEY=CLOUD_KEY, GLOW_CLOUD_NONCE=nonce)
    process = subprocess.Popen(
        [sys.executable, str(COMPANION), "--port", str(port), "--profile", profile, "--headless", "--token", TOKEN,
         "--allow-private", "--peerjs-url", peerjs_url, *extra],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return process
        except OSError:
            time.sleep(0.1)
    process.kill()
    raise RuntimeError("Cloud Glow Hands did not start: " + process.stderr.read()[-800:])


class CloudLinkTests(unittest.TestCase):
    def test_cloud_link_is_deterministic_and_valid(self):
        sys.path.insert(0, str(COMPANION.parent))
        import glow_hands
        first = glow_hands.cloud_link(CLOUD_KEY, "session-abcdefghijkl")
        self.assertEqual(first, glow_hands.cloud_link(CLOUD_KEY, "session-abcdefghijkl"))
        self.assertNotEqual(first, glow_hands.cloud_link(CLOUD_KEY, "session-abcdefghijkm"))
        self.assertNotEqual(first, glow_hands.cloud_link(CLOUD_KEY + "x", "session-abcdefghijkl"))
        self.assertRegex(first["peerId"], r"^glowhands-[0-9a-f]{24}$")
        self.assertRegex(first["secret"], r"^[\w-]{32}$")
        for bad_nonce in ("short", "has space in it 123", "x" * 65, "semi;colon-0123456789"):
            with self.assertRaises(ValueError):
                glow_hands.cloud_link(CLOUD_KEY, bad_nonce)
        with self.assertRaises(ValueError):
            glow_hands.cloud_link("too-short", "session-abcdefghijkl")

    def test_show_phone_link_prints_the_saved_link(self):
        profile = tempfile.mkdtemp(prefix="glow-show-")
        output = subprocess.run([sys.executable, str(COMPANION), "--profile", profile, "--show-phone-link"],
                                capture_output=True, text=True, timeout=30).stdout
        saved = json.loads((Path(profile) / "phone-link.json").read_text(encoding="utf-8"))
        self.assertIn("https://juw12.github.io/projects/glow/lead/#phone=" + saved["peerId"] + "." + saved["secret"], output)

    def test_linux_installer_is_valid_bash(self):
        import shutil
        git = shutil.which("git")
        candidates = [str(Path(git).resolve().parents[1] / "bin" / "bash.exe")] if git and os.name == "nt" else []
        candidates += [r"C:\Program Files\Git\bin\bash.exe", "/bin/bash", "/usr/bin/bash"]
        bash = next((path for path in candidates if os.path.exists(path)), None)
        if not bash:
            self.skipTest("bash is not available")
        script = APP / "hands" / "install-glow-hands-linux.sh"
        self.assertNotIn(b"\r\n", script.read_bytes(), "The Linux installer must use LF line endings")
        result = subprocess.run([bash, "-n", str(script)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class CloudSessionTests(unittest.TestCase):
    def test_cloud_session_is_quiet_fixed_and_stops_by_itself(self):
        port = free_port()
        nonce = "quiet-session-0123456789"
        process = start_cloud_companion(port, tempfile.mkdtemp(prefix="glow-cloud-"), nonce,
                                        "http://127.0.0.1:9/none.js", "--max-minutes", "0.05")
        try:
            sys.path.insert(0, str(COMPANION.parent))
            import glow_hands
            expected = glow_hands.cloud_link(CLOUD_KEY, nonce)
            status, link, _ = call(port, "GET", "/phone-link")
            self.assertEqual((status, link["peerId"], link["secret"]), (200, expected["peerId"], expected["secret"]))
            self.assertEqual(call(port, "POST", "/phone-link/reset", {})[0], 409)
            process.wait(timeout=40)
        finally:
            if process.poll() is None:
                process.kill()
        output = process.stdout.read() + process.stderr.read()
        process.stdout.close()
        process.stderr.close()
        self.assertIn("Time limit", output)
        for secret in (TOKEN, expected["peerId"], expected["secret"], CLOUD_KEY):
            self.assertNotIn(secret, output, "Cloud logs are public; nothing secret may be printed")
        self.assertNotIn("GET /phone-link", output)

    def test_idle_session_stops(self):
        port = free_port()
        process = start_cloud_companion(port, tempfile.mkdtemp(prefix="glow-idle-"), "idle-session-0123456789",
                                        "http://127.0.0.1:9/none.js", "--idle-minutes", "0.05")
        try:
            process.wait(timeout=40)
        finally:
            if process.poll() is None:
                process.kill()
            output = process.stdout.read()
            process.stdout.close()
            process.stderr.close()
        self.assertIn("Not used for", output)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class CloudBrowserEndToEnd(unittest.TestCase):
    """The phone taps Start cloud browser; a (faked) GitHub starts Glow Hands with the phone's session id;
    the phone connects over the real PeerJS service and runs a mission with approval."""

    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        class QuietStatic(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        cls.site = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SiteHandler)
        threading.Thread(target=cls.site.serve_forever, daemon=True).start()
        cls.site_url = f"http://127.0.0.1:{cls.site.server_port}"
        cls.web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietStatic, directory=str(APP / "web")))
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        cls.web_url = f"http://127.0.0.1:{cls.web.server_port}"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()
        cls.processes = []

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        for process in cls.processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
            process.stdout.close()
            process.stderr.close()
        for server in (cls.site, cls.web):
            server.shutdown()
            server.server_close()

    def test_phone_starts_cloud_browser_runs_mission_and_stops(self):
        github = {"dispatch": None, "cancelled": [], "auth": None}
        port = free_port()

        def fake_github(route):
            request = route.request
            github["auth"] = request.headers.get("authorization")
            if request.method == "POST" and request.url.endswith("/actions/workflows/glow-cloud-hands.yml/dispatches"):
                body = json.loads(request.post_data)
                github["dispatch"] = body
                self.assertEqual(body["ref"], "main")
                type(self).processes.append(start_cloud_companion(
                    port, tempfile.mkdtemp(prefix="glow-cloud-e2e-"), body["inputs"]["session"],
                    self.web_url + "/shared/peerjs.min.js"))
                route.fulfill(status=204, body="")
            elif request.method == "GET" and "/actions/workflows/glow-cloud-hands.yml/runs?status=in_progress" in request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"workflow_runs": [{"id": 4242}]}))
            elif request.method == "GET" and "/runs?status=queued" in request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({"workflow_runs": []}))
            elif request.method == "POST" and request.url.endswith("/actions/runs/4242/cancel"):
                github["cancelled"].append(4242)
                route.fulfill(status=202, content_type="application/json", body="{}")
            else:
                route.fulfill(status=404, content_type="application/json", body="{}")

        script = [
            {"action": "goto", "url": self.site_url + "/form.html"},
            {"action": "type", "name": "Full name", "text": "Cloud User"},
            {"action": "click", "name": "Place order"},
            {"action": "done", "summary": "Ordered from the cloud browser."},
        ]
        context = self.browser.new_context(**self.playwright.devices["iPhone 13"])
        self.addCleanup(context.close)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=E2E_ENGINE_STUB))
        context.route("https://api.github.com/**", fake_github)
        context.add_init_script("window.__config = " + json.dumps({"plan": BROWSER_PLAN, "script": script}) + ";")
        phone = context.new_page()

        # Setup link carries the cloud key; the token is pasted once.
        phone.goto(self.web_url + "/lead/#cloud=" + CLOUD_KEY)
        self.assertNotIn(CLOUD_KEY, phone.url, "The key must be removed from the address bar")
        phone.wait_for_selector("#hands-dialog[open]", timeout=10000)
        self.assertEqual(phone.locator("#cloud-key").input_value(), CLOUD_KEY)
        phone.fill("#cloud-token", "github_pat_test_token")
        phone.click("#cloud-start")
        phone.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=120000)
        self.assertEqual(phone.locator("#hands-status").inner_text(), "CONNECTED · CLOUD")
        self.assertEqual(github["auth"], "Bearer github_pat_test_token")
        self.assertRegex(github["dispatch"]["inputs"]["session"], r"^[A-Za-z0-9_-]{16,64}$")
        self.assertEqual(github["dispatch"]["inputs"]["minutes"], "20")
        saved = json.loads(phone.evaluate("localStorage.getItem('glowlead.hands.v1')"))
        self.assertEqual((saved["mode"], saved["host"]), ("remote", "cloud"))
        self.assertNotIn(saved["secret"], json.dumps(github["dispatch"]), "The link secret never goes to GitHub")
        phone.click("#hands-cancel")

        phone.evaluate("GlowLead.start('Order with the cloud browser', false, { allowHands: true })")
        phone.wait_for_selector("#approve-action", timeout=60000)
        self.assertEqual(call(port, "GET", "/observe")[1]["title"], "Test shop", "Nothing submitted before approval")
        phone.click("#approve-action")
        phone.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=60000)
        done = call(port, "GET", "/observe")[1]
        self.assertIn("name=Cloud+User", done["url"])

        phone.click("#hands-btn")
        phone.click("#cloud-stop")
        phone.wait_for_function("document.getElementById('cloud-note').textContent.includes('stopped')", timeout=20000)
        self.assertEqual(github["cancelled"], [4242])
        self.assertIsNone(phone.evaluate("localStorage.getItem('glowlead.hands.v1')"), "No earlier link to restore")

    def test_missing_setup_and_bad_token_are_explained(self):
        context = self.browser.new_context(**self.playwright.devices["iPhone 13"])
        self.addCleanup(context.close)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=E2E_ENGINE_STUB))
        context.route("https://api.github.com/**", lambda route: route.fulfill(status=401, content_type="application/json", body="{}"))
        phone = context.new_page()
        phone.goto(self.web_url + "/lead/")
        phone.click("#hands-btn")
        phone.click("#github-cloud summary")
        phone.click("#cloud-start")
        phone.wait_for_function("document.getElementById('cloud-note').textContent.includes('Set up the cloud browser first')", timeout=10000)
        phone.fill("#cloud-token", "github_pat_wrong")
        phone.fill("#cloud-key", CLOUD_KEY)
        phone.click("#cloud-start")
        phone.wait_for_function("document.getElementById('cloud-note').textContent.includes('didn\\'t accept the token')", timeout=10000)
        self.assertNotEqual(phone.locator("#hands-status").inner_text(), "CONNECTED · CLOUD")


if __name__ == "__main__":
    unittest.main(verbosity=2)
