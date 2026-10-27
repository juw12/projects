"""Static checks: Glow versions with in-app updates, and GlowRoom kept inside the app."""
import json
import re
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
WEB = APP / "web"


class GlowInAppTests(unittest.TestCase):
    def setUp(self):
        self.switcher = (WEB / "shared" / "glow-apps.js").read_text(encoding="utf-8")

    def test_version_matches_release_file(self):
        release = json.loads((WEB / "version.json").read_text(encoding="utf-8"))
        built_in = re.search(r'const GLOW_VERSION = "([^"]+)";', self.switcher).group(1)
        self.assertEqual(release["version"], built_in, "bump version.json and GLOW_VERSION together")
        package = json.loads((APP / "mobile" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["version"], built_in, "the Android app carries the same Glow version")
        self.assertTrue(release["notes"], "version.json needs release notes for the update bar")
        self.assertIn("releases/download/glow-android/Glow-android.apk", release["android"])

    def test_update_flow(self):
        for needle in ("function checkForUpdate", "function applyUpdate", 'cache: "no-store"', 'cache: "reload"',
                       "caches.delete", "registration.update()", "Update now", "Download update",
                       "glow-apps-version", "data-glow-version", "LIVE_ROOT + \"version.json\""):
            self.assertIn(needle, self.switcher)

    def test_glowroom_opens_inside_the_app(self):
        for needle in ("function openRoomPanel", "function openApp", "window.open = function",
                       '"glow-room-goal"', "glow-room-panel", "glow-embedded"):
            self.assertIn(needle, self.switcher)
        self.assertIn("'glow-room-goal'", (WEB / "room" / "cinema.js").read_text(encoding="utf-8"))
        self.assertIn("'glow-room-goal'", (WEB / "room" / "mobile.html").read_text(encoding="utf-8"))
        for page in ("index.html", "app.html", "mobile.html"):
            html = (WEB / "chat" / page).read_text(encoding="utf-8")
            self.assertIn("frame-src 'self'", html, f"GlowChat {page} must allow the GlowRoom panel")

    def test_every_app_loads_the_switcher(self):
        for page in ("index.html", "chat/index.html", "chat/app.html", "chat/mobile.html", "lead/index.html",
                     "room/index.html", "room/mobile.html", "setup/index.html"):
            self.assertIn("shared/glow-apps.js", (WEB / page).read_text(encoding="utf-8"), page)


if __name__ == "__main__":
    unittest.main()
