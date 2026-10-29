"""v0.4 regression checks: sign-in, guest mode, guided tour and theme (stdlib only)."""
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web" / "chat"
REPO = APP.parent.parent
PAGES = ("index.html", "app.html", "mobile.html")


class V04Tests(unittest.TestCase):
    def setUp(self):
        self.script = (WEB / "app.js").read_text(encoding="utf-8")

    def test_pages_have_login_tour_and_theme_controls(self):
        for name in PAGES:
            page = (WEB / name).read_text(encoding="utf-8")
            for element_id in ("welcome-screen", "signin-btn", "guest-btn", "tour", "tour-next", "tour-skip",
                               "theme-toggle", "help-btn", "account-box", "set-theme", "set-sync", "toast", "rate-notice", "rate-text", "rate-close"):
                self.assertIn(f'id="{element_id}"', page, f"{name} is missing #{element_id}")

    def test_csp_allows_only_the_puter_sdk_as_external_script(self):
        for name in PAGES:
            page = (WEB / name).read_text(encoding="utf-8")
            csp = re.search(r'Content-Security-Policy" content="([^"]+)"', page).group(1)
            script_src = re.search(r"script-src ([^;]+)", csp).group(1).split()
            # 'wasm-unsafe-eval' (1.22) only lets Glow Offline compile WebAssembly; JavaScript eval stays blocked.
            self.assertEqual(script_src, ["'self'", "'wasm-unsafe-eval'", "https://js.puter.com"])
            self.assertNotIn("'unsafe-eval'", csp)
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
        self.assertIn("const CACHE_NAME = 'glowchat-v17';", worker)

    def test_guests_get_keyless_free_ai(self):
        self.assertIn('const FREE_AI_URL = "https://text.pollinations.ai/openai";', self.script)
        self.assertIn('if (provider === "free") return { base: FREE_AI_URL, key: "" };', self.script)
        self.assertIn("list.push(FREE_MODEL);", self.script)

    def test_catalog_version(self):
        apps = json.loads((REPO / "scripts/apps.json").read_text(encoding="utf-8"))["apps"]
        glow = next(app for app in apps if app["id"] == "glow")
        # The portfolio card shows the published Glow version, so keep it in step with web/version.json.
        published = json.loads((APP / "web" / "version.json").read_text(encoding="utf-8"))["version"]
        self.assertEqual(glow["version"], published)
        self.assertEqual(glow["name"], "Glow")



class GlowV05FeatureTests(unittest.TestCase):
    """v0.5: model picker, personas, checklists, fuse, improve, voice and share."""

    def setUp(self):
        self.web = Path(__file__).resolve().parents[1] / "web" / "chat"
        self.html = (self.web / "index.html").read_text(encoding="utf-8")
        self.js = (self.web / "app.js").read_text(encoding="utf-8")

    def test_new_controls_exist_in_every_page(self):
        ids = [
            "model-picker-btn", "model-menu", "model-search", "model-list",
            "persona-select", "share-btn", "improve-btn", "mic-btn",
            "jump-btn", "set-instructions", "set-followups",
        ]
        for page in ("index.html", "app.html", "mobile.html"):
            html = (self.web / page).read_text(encoding="utf-8")
            for element_id in ids:
                self.assertIn(f'id="{element_id}"', html, f"{element_id} missing in {page}")

    def test_feature_functions_present(self):
        for name in ("fuseRound", "splitFollowUps", "withInstructions",
                     "importSharedFromHash", "applyChecks", "togglePin"):
            self.assertIn(name, self.js)

    def test_follow_ups_follow_user_language(self):
        self.assertIn("same language as the user's last message", self.js)


class GlowCrewroomLinkTests(unittest.TestCase):
    """v0.5.1: Glow and Crewroom are connected both ways."""

    def setUp(self):
        self.web = Path(__file__).resolve().parents[1] / "web" / "chat"
        self.js = (self.web / "app.js").read_text(encoding="utf-8")

    def test_every_page_links_to_crewroom(self):
        for page in ("index.html", "app.html", "mobile.html"):
            html = (self.web / page).read_text(encoding="utf-8")
            self.assertIn('id="crewroom-link"', html, page)
            self.assertIn('href="../room/', html, page)

    def test_shared_inbox_key_matches_crewroom(self):
        crew = (self.web.parent / "room" / "crew-engine.js").read_text(encoding="utf-8")
        self.assertIn("'glow.inbox'", crew)
        self.assertIn('const CREWROOM_INBOX_KEY = "glow.inbox";', self.js)

    def test_glow_sends_missions_and_labels_results(self):
        for needle in ("function askCrew", "Ask GlowRoom", 'searchParams.set("goal"', '"glowlead" : "crewroom"', "🏢 GlowRoom"):
            self.assertIn(needle, self.js)

if __name__ == "__main__":
    unittest.main()
