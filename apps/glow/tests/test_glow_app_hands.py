"""GlowLead driving "this phone's browser" (the Glow Android app's built-in browser) through the shared core.

The GlowBrowser plugin is emulated with the same contract as the Android plugin: open/evaluate/back/state/show/close,
where evaluate returns the JSON encoding of the script's result (like WebView.evaluateJavascript).
"""
import functools
import http.server
import json
import threading
import unittest

import test_glow_hands as base

PLUGIN_SHIM = """
window.__glowBrowserTest = true;
window.__gbCalls = [];
(() => {
  let frame = null;
  const ensure = () => {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.id = "built-in-browser";
    frame.style.cssText = "position:fixed;left:-2000px;top:0;width:1280px;height:800px";
    document.body.appendChild(frame);
    return frame;
  };
  const loaded = (target) => new Promise((resolve) => target.addEventListener("load", () => resolve(), { once: true }));
  const state = () => {
    const f = ensure();
    let url = "about:blank";
    let title = "";
    try {
      url = f.contentWindow.location.href;
      title = f.contentDocument.title;
    } catch (error) {}
    return { url, title, loading: false };
  };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: { GlowBrowser: {
      open: async ({ url }) => {
        window.__gbCalls.push(["open", url]);
        const f = ensure();
        const wait = loaded(f);
        f.src = url;
        await wait;
        return state();
      },
      // Same contract as Android WebView.evaluateJavascript: the JSON encoding of the script's result.
      evaluate: async ({ script }) => ({ value: JSON.stringify(ensure().contentWindow.eval(script)) }),
      back: async () => {
        const f = ensure();
        const wait = loaded(f);
        f.contentWindow.history.back();
        await wait;
        return state();
      },
      state: async () => state(),
      show: async () => ({}),
      hide: async () => ({}),
      close: async () => {
        window.__gbCalls.push(["close", ""]);
        return {};
      },
    } },
  };
})();
"""


class BuiltIn:
    """Reads the emulated built-in browser (the iframe)."""

    def __init__(self, page):
        self.page = page

    def frame(self):
        return next(f for f in self.page.frames if f.name == "" and f != self.page.main_frame and "/lead/" not in f.url)

    def title(self):
        return self.page.evaluate("document.getElementById('built-in-browser').contentDocument.title")

    @property
    def url(self):
        return self.page.evaluate("document.getElementById('built-in-browser').contentWindow.location.href")

    def value(self, selector):
        return self.page.evaluate("(s) => document.getElementById('built-in-browser').contentDocument.querySelector(s).value", selector)

    def goto(self, url):
        self.page.evaluate("(u) => window.Capacitor.Plugins.GlowBrowser.open({ url: u })", url)


@unittest.skipUnless(base.HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run Glow Hands checks")
class AppBrowserEndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        class QuietStatic(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

        class WebAndShop(QuietStatic):
            """GlowLead and the test shop on one origin, so the iframe plays the app's built-in browser."""
            def do_GET(self):
                if self.path.startswith(("/form.html", "/done.html")):
                    base.SiteHandler.do_GET(self)
                else:
                    super().do_GET()

        cls.web = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(WebAndShop, directory=str(base.APP / "web")))
        threading.Thread(target=cls.web.serve_forever, daemon=True).start()
        cls.web_url = f"http://127.0.0.1:{cls.web.server_port}"
        cls.site_url = cls.web_url
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.web.shutdown()
        cls.web.server_close()

    def app(self, script):
        """A phone-sized GlowLead plus a second page that plays the app's built-in browser."""
        context = self.browser.new_context(**self.playwright.devices["Pixel 7"])
        self.addCleanup(context.close)
        page = context.new_page()
        page.add_init_script(PLUGIN_SHIM)
        context.route("**/crew-engine.js", lambda route: route.fulfill(content_type="application/javascript", body=base.E2E_ENGINE_STUB))
        page.add_init_script("window.__config = " + json.dumps({"plan": base.BROWSER_PLAN, "script": script}) + ";")
        page.goto(self.web_url + "/lead/")
        return page, BuiltIn(page)

    def test_app_is_connected_by_default_and_runs_a_mission_with_approval(self):
        script = [
            {"action": "goto", "url": self.site_url + "/form.html"},
            {"action": "type", "name": "Full name", "text": "App User"},
            {"action": "select", "name": "Size", "text": "Large"},
            {"action": "click", "name": "Place order"},
            {"action": "done", "summary": "Ordered in the app's browser."},
        ]
        page, built_in = self.app(script)
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)
        self.assertEqual(page.locator("#hands-status").inner_text(), "CONNECTED · THIS PHONE")
        page.evaluate("GlowLead.start('Order in the app', false, { allowHands: true })")
        page.wait_for_selector("#approve-action", timeout=60000)
        self.assertEqual(built_in.title(), "Test shop", "Nothing is submitted before approval")
        self.assertEqual(built_in.value("#name"), "App User")
        self.assertEqual(built_in.value("#size"), "Large")
        page.click("#approve-action")
        page.wait_for_function("GlowLead.leads[0] && GlowLead.leads[0].status === 'done'", timeout=60000)
        self.assertEqual(built_in.title(), "Done")
        self.assertIn("name=App+User", built_in.url)
        self.assertIn("size=Large", built_in.url)
        self.assertTrue(any(call[0] == "open" for call in page.evaluate("window.__gbCalls")))

    def test_dialog_shows_this_phone_first_and_hides_pc_steps(self):
        page, _ = self.app([])
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)
        page.click("#hands-btn")
        page.wait_for_selector("#hands-dialog[open]")
        self.assertTrue(page.locator("#app-box").is_visible())
        self.assertFalse(page.locator("#hands-auto").is_visible())
        self.assertFalse(page.locator("#android-app-link").is_visible(), "No download link inside the app")
        self.assertFalse(page.locator("#cloud-box").is_visible(), "GitHub cloud is tucked under Advanced")

    def test_core_refuses_secrets_and_private_addresses(self):
        page, built_in = self.app([])
        page.wait_for_function("document.getElementById('hands-status').dataset.state === 'paired'", timeout=15000)
        built_in.goto(self.site_url + "/form.html")
        result = page.evaluate("""async () => {
          if (!window.GlowHandsCore) await new Promise((resolve) => {
            const s = document.createElement('script'); s.src = '../shared/hands-core.js'; s.onload = resolve; document.head.appendChild(s);
          });
          const core = window.GlowHandsCore;
          return {
            privateHosts: ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.1.1', '[::1]', 'printer.local', '0x7f000001']
              .map((h) => core.hostIsPrivate(h)),
            publicHosts: ['example.com', '8.8.8.8', '172.32.0.1', 'github.io'].map((h) => core.hostIsPrivate(h)),
          };
        }""")
        self.assertTrue(all(result["privateHosts"]), result)
        self.assertFalse(any(result["publicHosts"]), result)
        # Drive the real transport: password field refused, card field refused, file: scheme refused.
        outcome = page.evaluate("""async () => {
          const core = window.GlowHandsCore;
          const plugin = window.Capacitor.Plugins.GlowBrowser;
          const wrap = (s, a) => "JSON.stringify((" + s + ")(" + JSON.stringify(a) + "))";
          const hands = core.createHandsCore({
            evaluate: async (s, a) => JSON.parse(JSON.parse((await plugin.evaluate({ script: wrap(s, a) })).value)),
            goto: async (url) => plugin.open({ url }), back: async () => plugin.back(),
            info: async () => plugin.state(), settle: async () => {},
          });
          const seen = await hands.handle('observe');
          const ref = (label) => seen.elements.find((e) => e.name === label).ref;
          return {
            password: await hands.handle('act', { action: { action: 'type', ref: ref('Password'), text: 'x' } }),
            card: await hands.handle('act', { action: { action: 'type', ref: ref('Card'), text: '4111' } }),
            fileUrl: await hands.handle('act', { action: { action: 'goto', url: 'file:///etc/passwd' } }),
            privateUrl: await hands.handle('act', { action: { action: 'goto', url: 'http://192.168.0.1/' } }),
            stale: await hands.handle('act', { action: { action: 'click', ref: 999 } }),
            enter: await (async () => {
              await hands.handle('act', { action: { action: 'click', ref: ref('Full name') } });
              return hands.handle('act', { action: { action: 'press', key: 'Enter' } });
            })(),
          };
        }""")
        self.assertEqual((outcome["password"]["status"], outcome["password"].get("secret")), (403, True))
        self.assertEqual((outcome["card"]["status"], outcome["card"].get("secret")), (403, True))
        self.assertEqual(outcome["fileUrl"]["status"], 400)
        self.assertEqual(outcome["privateUrl"]["status"], 400)
        self.assertEqual((outcome["stale"]["status"], outcome["stale"].get("stale")), (409, True))
        self.assertEqual((outcome["enter"]["status"], outcome["enter"].get("needsApproval")), (409, True))
        self.assertEqual(built_in.title(), "Test shop", "Refused actions changed nothing")


if __name__ == "__main__":
    unittest.main(verbosity=2)
