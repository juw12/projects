"""v0.4 regression checks: sign-in, guest mode, guided tour and theme (stdlib only)."""
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
REPO = APP.parent.parent
PAGES = ("index.html", "app.html", "mobile.html")


class V04Tests(unittest.TestCase):
    def setUp(self):
        self.script = (WEB / "app.js").read_text(encoding="utf-8")

    def test_pages_have_login_tour_and_theme_controls(self):
        for name in PAGES:
            page = (WEB / name).read_text(encoding="utf-8")
            for element_id in ("welcome-screen", "signin-btn", "guest-btn", "tour", "tour-next", "tour-skip",
                               "theme-toggle", "help-btn", "account-box", "set-theme", "set-sync", "toast"):
                self.assertIn(f'id="{element_id}"', page, f"{name} is missing #{element_id}")

    def test_csp_allows_only_the_puter_sdk_as_external_script(self):
        for name in PAGES:
            page = (WEB / name).read_text(encoding="utf-8")
            csp = re.search(r'Content-Security-Policy" content="([^"]+)"', page).group(1)
            script_src = re.search(r"script-src ([^;]+)", csp).group(1).split()
            self.assertEqual(script_src, ["'self'", "https://js.puter.com"])
            self.assertNotIn("unsafe-eval", csp)
            self.assertNotIn("js.puter.com", page.split("Content-Security-Policy")[1].split(">", 1)[1],
                             "Puter must load lazily from app.js, not as a static script tag")

    def test_sdk_is_lazy_and_never_loaded_in_sandboxed_demos(self):
        self.assertIn('const PUTER_SDK_URL = "https://js.puter.com/v2/";', self.script)
        self.assertIn('if (TEST_MODE) return Promise.reject(new Error("Puter is disabled in sandboxed demos."));', self.script)

    def test_api_keys_are_never_synced(self):
        body = re.search(r"function cloudBody\(conversations\) \{([^}]+)\}", self.script).group(1)
        self.assertNotIn("settings", body)
        self.assertNotIn("Key", body)

    def test_sync_chunks_fit_puter_value_limit(self):
        chunk = int(re.search(r"const CLOUD_CHUNK_CHARS = (\d+);", self.script).group(1))
        # Worst case 3 bytes per UTF-16 code unit in UTF-8; Puter allows 400 KB per value.
        self.assertLessEqual(chunk * 3, 400 * 1000)

    def test_theme_defaults_to_device_and_storage_key_unchanged(self):
        self.assertIn('theme: "system",', self.script)
        self.assertIn('TEST_MODE ? "glow.sandbox" : "mufakat.v1"', self.script)

    def test_offline_cache_bumped_for_new_assets(self):
        worker = (WEB / "sw.js").read_text(encoding="utf-8")
        self.assertIn("const CACHE_NAME = 'glow-v2';", worker)

    def test_catalog_version(self):
        apps = json.loads((REPO / "scripts/apps.json").read_text(encoding="utf-8"))["apps"]
        glow = next(app for app in apps if app["id"] == "glow")
        self.assertEqual(glow["version"], "0.4.0")
        self.assertEqual(glow["name"], "Glow")


if __name__ == "__main__":
    unittest.main()
