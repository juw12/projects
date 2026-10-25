"""Regression checks for the Mufakat -> Glow rename (stdlib only)."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

APP = Path(__file__).resolve().parent.parent
REPO = APP.parent.parent
WEB = APP / "web" / "chat"

spec = importlib.util.spec_from_file_location("glow_site_builder", REPO / "scripts/build_site.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class RenameTests(unittest.TestCase):
    def test_catalog_has_one_glow_and_no_old_app_entry(self):
        apps = json.loads((REPO / "scripts/apps.json").read_text())["apps"]
        self.assertEqual(sum(app["id"] == "glow" for app in apps), 1)
        self.assertFalse(any(app["id"] == "mufakat" for app in apps))

    def test_browser_history_and_keys_keep_original_storage_key(self):
        script = (WEB / "app.js").read_text()
        self.assertIn('TEST_MODE ? "glow.sandbox" : "mufakat.v1"', script)
        self.assertNotIn('removeItem("mufakat.v1")', script)

    def test_cache_cleanup_is_restricted_to_glowchat(self):
        worker = (WEB / "sw.js").read_text()
        self.assertIn("(n.startsWith('glowchat-') || /^glow-v\\d+$/.test(n)) && n !== CACHE_NAME", worker)
        self.assertIn("url.href.startsWith(self.registration.scope)", worker)
        room_worker = (APP / "web" / "room" / "sw.js").read_text()
        self.assertIn("key.indexOf('glowroom-') === 0 || key.indexOf('crewroom-') === 0", room_worker)
        home_worker = (APP / "web" / "sw.js").read_text()
        self.assertIn("/^glow-v\\d+$/.test(name)", home_worker)

    def test_all_pages_and_manifest_are_branded_glow(self):
        for filename in ("index.html", "app.html", "mobile.html"):
            page = (WEB / filename).read_text()
            self.assertIn("GlowChat<span>.</span></div>", page)
            self.assertIn("data-glow-apps", page)
            self.assertNotIn("Mufakat", page)
        manifest = json.loads((WEB / "manifest.webmanifest").read_text())
        self.assertEqual(manifest["short_name"], "GlowChat")
        home = json.loads((APP / "web" / "manifest.webmanifest").read_text())
        self.assertEqual(home["short_name"], "Glow")

    def test_old_web_app_and_mobile_links_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "glow" / "chat"
            target.mkdir(parents=True)
            for name in ("index.html", "app.html", "mobile.html"):
                (target / name).write_text("GlowChat")
            (target / "manifest.webmanifest").write_text((WEB / "manifest.webmanifest").read_text())
            builder.write_redirects(root, [{"id": "glow"}])
            for page, destination in (
                ("index.html", "../glow/chat/"),
                ("app.html", "../glow/chat/app.html"),
                ("mobile.html", "../glow/chat/mobile.html"),
            ):
                stub = (root / "mufakat" / page).read_text()
                self.assertIn(f'data-target="{destination}"', stub)
            script = (root / "mufakat/redirect.js").read_text()
            self.assertIn("destination.hash = location.hash", script)
            self.assertIn("destination.search = location.search", script)
            worker = (root / "mufakat/sw.js").read_text()
            self.assertIn("name.startsWith('mufakat-')", worker)
            self.assertIn("self.registration.unregister()", worker)
            manifest = json.loads((root / "mufakat/manifest.webmanifest").read_text())
            self.assertEqual(manifest["short_name"], "GlowChat")
            self.assertEqual(manifest["start_url"], "../glow/chat/app.html")

    def test_crewroom_links_redirect_to_glowroom(self):
        room_web = APP / "web" / "room"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "glow" / "room"
            target.mkdir(parents=True)
            for name in ("index.html", "app.html", "mobile.html"):
                (target / name).write_text("GlowRoom")
            (target / "manifest.webmanifest").write_text((room_web / "manifest.webmanifest").read_text())
            builder.write_redirects(root, [{"id": "glow"}])
            for page, destination in (
                ("index.html", "../glow/room/"),
                ("app.html", "../glow/room/app.html"),
                ("mobile.html", "../glow/room/mobile.html"),
            ):
                self.assertIn(f'data-target="{destination}"', (root / "virtual-bots" / page).read_text())
            worker = (root / "virtual-bots/sw.js").read_text()
            self.assertIn("name.startsWith('crewroom-')", worker)
            self.assertIn("self.registration.unregister()", worker)
            manifest = json.loads((root / "virtual-bots/manifest.webmanifest").read_text())
            self.assertEqual(manifest["short_name"], "GlowRoom")
            self.assertEqual(manifest["start_url"], "../glow/room/")

    def test_existing_hosted_database_is_selected(self):
        with tempfile.TemporaryDirectory() as temp:
            legacy = Path(temp) / "mufakat.sqlite3"
            legacy.touch()
            script = f"""
import importlib.util
spec = importlib.util.spec_from_file_location("glow_server", {str(APP / "server/app.py")!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
print(module.DB_PATH.name)
"""
            environment = dict(os.environ, DATA_DIR=temp)
            result = subprocess.run(
                [sys.executable, "-c", script],
                env=environment,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(result.stdout.strip(), "mufakat.sqlite3")
            legacy.unlink()
            fresh = subprocess.run(
                [sys.executable, "-c", script],
                env=environment,
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(fresh.stdout.strip(), "glow.sqlite3")


if __name__ == "__main__":
    unittest.main(verbosity=2)
