"""GlowChat's built-in self-test (chat/#selftest) in real Chromium, with no network beyond a local server.

It covers chat, Council, Arena, low power, images and the used-up Puter allowance (the backup answers
quietly, also when the browser storage is full or two requests are on their way at once).
"""
import functools
import http.server
import socketserver
import threading
import unittest
from pathlib import Path
from urllib.parse import urlparse

WEB = Path(__file__).resolve().parents[1] / "web"
PREFIX = "/projects/glow"


class PagesHandler(http.server.SimpleHTTPRequestHandler):
    """Serve apps/glow/web under /projects/glow/ like GitHub Pages."""

    def translate_path(self, path):
        if path.startswith(PREFIX):
            path = path[len(PREFIX):] or "/"
        return super().translate_path(path)

    def log_message(self, *args):
        pass


class GlowChatSelfTest(unittest.TestCase):
    def test_glowchat_selftest_passes(self):
        from playwright.sync_api import sync_playwright

        server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(PagesHandler, directory=str(WEB)))
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        port = server.server_address[1]
        base = f"http://127.0.0.1:{port}{PREFIX}/"

        def only_this_server(route):
            url = urlparse(route.request.url)
            if url.hostname == "127.0.0.1" and url.port == port:
                route.continue_()
            else:
                route.abort()

        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                page = browser.new_page()
                page.route("**/*", only_this_server)
                page.goto(base + "chat/#selftest")
                page.wait_for_selector("#selftest-results", state="attached", timeout=120000)
                lines = page.locator("#selftest-results").inner_text().splitlines()
                browser.close()
        finally:
            server.shutdown()
        failed = [line for line in lines if not line.startswith("PASS")]
        self.assertGreater(len(lines), 100, "the self-test should run its full list of checks")
        self.assertEqual(failed, [], "\n".join(failed))
        self.assertTrue(any("browser storage is full" in line for line in lines))


if __name__ == "__main__":
    unittest.main()
