"""The version button in every Glow app's header, in real Chromium with no network beyond a local server.

It must never push a header off screen (Linux CI fonts are wider than Windows ones, so a wide font is
forced on every page), it must stay findable when an update is ready, and when a header is too crowded
it first shrinks to its icon and then steps aside for the orange dot on the Glow apps button.
"""
import functools
import http.server
import json
import socketserver
import threading
import unittest
from pathlib import Path
from urllib.parse import urlparse

WEB = Path(__file__).resolve().parents[1] / "web"
PREFIX = "/projects/glow"
PAGES = ["", "chat/", "lead/", "room/", "room/mobile.html", "account/", "download/", "setup/"]
WIDE_FONT = "*{font-family:Verdana,'DejaVu Sans',sans-serif!important}"

MEASURE = """() => {
  const chip = document.querySelector('[data-glow-version-chip]');
  const root = document.documentElement;
  const overflow = () => Math.max(0, root.scrollWidth - root.clientWidth);
  const shown = overflow();
  let hidden = shown;
  let chipInfo = null;
  if (chip) {
    chipInfo = {cls: chip.className, text: chip.innerText.trim(), width: chip.offsetWidth};
    chip.style.setProperty('display', 'none', 'important');
    hidden = overflow();
    chip.style.removeProperty('display');
  }
  return {shown, hidden, chip: chipInfo};
}"""

SETTLE = "() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))"


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    """Serve apps/glow/web under /projects/glow/ like GitHub Pages."""

    def translate_path(self, path):
        if path.startswith(PREFIX):
            path = path[len(PREFIX):] or "/"
        return super().translate_path(path)

    def log_message(self, *args):
        pass


class GlowVersionChip(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from playwright.sync_api import sync_playwright

        cls.server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(PagesHandler, directory=str(WEB)))
        cls.server.daemon_threads = True
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.port = cls.server.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}{PREFIX}/"
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()

    def open(self, path, width=1440, update_to=None):
        # One page at a time: pages left open in the background get their animation frames throttled.
        context = self.browser.new_context(viewport={"width": width, "height": 900}, service_workers="block")
        # No "reopen where you left off" redirect, and a ready update waits for a click.
        context.add_init_script("try{localStorage.setItem('glow.resume','off');localStorage.setItem('glow.update.auto','off')}catch(e){}")

        def only_this_server(route):
            url = urlparse(route.request.url)
            if url.hostname != "127.0.0.1" or url.port != self.port:
                route.abort()
            elif update_to and url.path.endswith("/version.json"):
                route.fulfill(content_type="application/json", body=json.dumps({"version": update_to, "notes": ["Test note"]}))
            else:
                route.continue_()

        context.route("**/*", only_this_server)
        page = context.new_page()
        page.goto(self.base + path)
        page.wait_for_selector("[data-glow-version-chip]", state="attached", timeout=15000)
        page.add_style_tag(content=WIDE_FONT)
        page.evaluate(SETTLE)
        return page

    def resize(self, page, width):
        page.set_viewport_size({"width": width, "height": 900})
        page.evaluate(SETTLE)
        return page.evaluate(MEASURE)

    def test_button_never_makes_a_header_wider_than_the_window(self):
        for path in PAGES:
            page = self.open(path)
            try:
                for width in (1440, 1024, 901, 820, 768, 700, 600):
                    result = self.resize(page, width)
                    self.assertIsNotNone(result["chip"], f"/{path} has no version button")
                    if width == 1440:
                        # GlowRoom rebuilds its header after Glow is ready: the button must not be left behind.
                        self.assertTrue(page.locator("[data-glow-version-chip]").is_visible(), f"/{path}: version button not visible")
                    self.assertLessEqual(result["shown"], result["hidden"] + 1, f"/{path} at {width}px: {result}")
            finally:
                page.context.close()

    def test_ready_update_stays_visible_and_says_update(self):
        for path in ("lead/", "chat/"):
            page = self.open(path, update_to="9.9.9")
            try:
                page.wait_for_selector("[data-glow-version-chip].ready", timeout=15000)
                wide = self.resize(page, 1440)
                self.assertIn("Update to 9.9.9", wide["chip"]["text"], path)
                self.assertEqual(wide["shown"], 0, path)
                tablet = self.resize(page, 768)
                self.assertLessEqual(tablet["shown"], tablet["hidden"] + 1, f"{path}: {tablet}")
                self.assertNotIn("glow-chip-hidden", tablet["chip"]["cls"], f"{path}: the update must stay visible at 768px")
                self.assertTrue(page.locator("[data-glow-version-chip]").is_visible(), path)
                self.assertNotIn("9.9.9", page.locator("[data-glow-version-chip]").inner_text(), "short label on tablets")
                phone = self.resize(page, 400)
                self.assertFalse(page.locator("[data-glow-version-chip]").is_visible(), path)
                self.assertEqual(phone["shown"], 0, path)
                self.assertTrue(page.locator(".glow-apps-btn.glow-update-ready").first.is_visible(), f"{path}: orange dot on phones")
            finally:
                page.context.close()

    def test_glowroom_shows_the_update_without_crowding_its_menu_bar(self):
        page = self.open("room/", update_to="9.9.9")
        try:
            page.wait_for_selector("[data-glow-version-chip].ready", timeout=15000)
            self.resize(page, 1440)
            chip = page.locator("[data-glow-version-chip]")
            self.assertTrue(chip.is_visible(), "GlowRoom must show the update button")
            self.assertIn("Update to 9.9.9", chip.inner_text())
            squeeze = """() => {
              const left = document.querySelector('.menubar-left');
              const chip = document.querySelector('[data-glow-version-chip]');
              const now = left.scrollWidth - left.clientWidth;
              chip.style.setProperty('display', 'none', 'important');
              const without = left.scrollWidth - left.clientWidth;
              chip.style.removeProperty('display');
              return {now, without};
            }"""
            for width in (1024, 900):
                self.resize(page, width)
                result = page.evaluate(squeeze)
                self.assertTrue(chip.is_visible(), f"{width}px: the update must stay visible")
                if result["now"] > result["without"] + 4:
                    # Too tight for the whole button: it takes no more room than its orange icon.
                    self.assertIn("glow-chip-compact", chip.get_attribute("class"), f"{width}px: {result}")
                    self.assertLessEqual(result["now"] - result["without"], 40, f"{width}px: {result}")
            # Very narrow desktop window: still an orange icon, never pushed off screen.
            narrow = self.resize(page, 768)
            self.assertTrue(chip.is_visible(), "768px: the update must stay visible")
            self.assertLessEqual(narrow["shown"], narrow["hidden"] + 1, narrow)
        finally:
            page.context.close()

    def test_crowded_header_shrinks_then_hides_the_button(self):
        page = self.open("lead/")
        self.resize(page, 1440)
        spacer_for = page.evaluate("""() => {
          const chip = document.querySelector('[data-glow-version-chip]');
          const root = document.documentElement;
          const spacer = document.createElement('span');
          spacer.id = 'test-spacer';
          spacer.style.cssText = 'display:inline-block;flex:none;height:1px';
          chip.before(spacer);
          const fits = (px) => {
            spacer.style.width = px + 'px';
            return root.scrollWidth <= root.clientWidth;
          };
          chip.style.setProperty('display', 'none', 'important');
          let low = 0;
          let high = 3000;
          while (high - low > 1) {
            const mid = (low + high) >> 1;
            if (fits(mid)) low = mid;
            else high = mid;
          }
          chip.style.removeProperty('display');
          spacer.style.width = '0px';
          return {roomWithoutButton: low, fullWidth: chip.offsetWidth};
        }""")
        self.assertGreater(spacer_for["fullWidth"], 45, spacer_for)

        def crowd(px):
            page.evaluate("(px) => { document.getElementById('test-spacer').style.width = px + 'px'; }", px)
            page.evaluate("() => window.dispatchEvent(new Event('resize'))")
            page.evaluate(SETTLE)
            return page.evaluate(MEASURE)

        # Room for the icon (30px + gap) but not for the whole button: icon only.
        compact = crowd(spacer_for["roomWithoutButton"] - 46)
        self.assertIn("glow-chip-compact", compact["chip"]["cls"], compact)
        self.assertEqual(compact["shown"], 0, compact)
        # Not even room for the icon: the button steps aside.
        hidden = crowd(spacer_for["roomWithoutButton"] - 4)
        self.assertIn("glow-chip-hidden", hidden["chip"]["cls"], hidden)
        self.assertEqual(hidden["shown"], 0, hidden)
        # Room again: the whole button comes back.
        roomy = crowd(0)
        self.assertNotIn("glow-chip-compact", roomy["chip"]["cls"], roomy)
        self.assertNotIn("glow-chip-hidden", roomy["chip"]["cls"], roomy)
        self.assertGreater(roomy["chip"]["width"], 45, roomy)
        page.context.close()


if __name__ == "__main__":
    unittest.main()
