#!/usr/bin/env python3
"""Regression checks for the Trade Twin -> Twin rename (stdlib only)."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
REPO = APP.parent.parent
WEB = APP / "web"

spec = importlib.util.spec_from_file_location("twin_site_builder", REPO / "scripts/build_site.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class RenameTests(unittest.TestCase):
    def test_catalog_has_twin_and_no_trade_twin_entry(self):
        apps = json.loads((REPO / "scripts/apps.json").read_text())["apps"]
        twins = [app for app in apps if app["id"] == "twin"]
        self.assertEqual(len(twins), 1)
        self.assertEqual(twins[0]["name"], "Twin")
        self.assertFalse(any(app["id"] == "trade-twin" for app in apps))
        self.assertTrue(all(link.startswith("twin/") for link in twins[0]["links"].values()))

    def test_visible_name_is_twin_everywhere(self):
        for filename in ("index.html", "web.html", "mobile.html", "demo.js", "sw.js"):
            self.assertNotIn("Trade Twin", (WEB / filename).read_text(), filename)
        manifest = json.loads((WEB / "manifest.webmanifest").read_text())
        self.assertEqual((manifest["name"], manifest["short_name"]), ("Twin", "Twin"))
        self.assertIn("<title>Twin", (WEB / "index.html").read_text())

    def test_storage_keys_keep_pre_rename_values(self):
        # Changing these would silently drop saved profiles, guest sessions and the theme.
        self.assertIn('STORE = "trade-twin-demo-v1"', (WEB / "demo.js").read_text())
        self.assertIn('GUEST_STORE = "trade-twin-guest-v1"', (WEB / "demo.js").read_text())
        self.assertIn('KEY = "trade-twin-theme"', (WEB / "theme.js").read_text())

    def test_new_worker_uses_twin_cache_names(self):
        worker = (WEB / "sw.js").read_text()
        self.assertIn('PREFIX = "twin:" + self.registration.scope', worker)

    def test_client_accepts_renamed_and_legacy_server(self):
        self.assertIn('["twin", "trade-twin"].includes', (WEB / "index.html").read_text())

    def test_old_links_redirect_and_old_worker_is_retired(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "twin"
            target.mkdir()
            for name in ("index.html", "web.html", "mobile.html"):
                (target / name).write_text("Twin")
            (target / "manifest.webmanifest").write_text((WEB / "manifest.webmanifest").read_text())
            builder.write_redirects(root, [{"id": "twin"}])
            for page, destination in (("index.html", "../twin/"), ("web.html", "../twin/web.html"),
                                      ("mobile.html", "../twin/mobile.html")):
                self.assertIn(f'data-target="{destination}"', (root / "trade-twin" / page).read_text())
            script = (root / "trade-twin/redirect.js").read_text()
            self.assertIn("destination.search = location.search", script)
            self.assertIn("destination.hash = location.hash", script)
            worker = (root / "trade-twin/sw.js").read_text()
            self.assertIn("name.startsWith('trade-twin:' + self.registration.scope)", worker)
            self.assertIn("name.startsWith('tt-shell-v')", worker)
            self.assertIn("self.registration.unregister()", worker)
            self.assertIn("client.navigate(client.url)", worker)
            self.assertNotIn("caches.keys().then((names) => Promise.all(names.map", worker)
            manifest = json.loads((root / "trade-twin/manifest.webmanifest").read_text())
            self.assertEqual(manifest["short_name"], "Twin")
            self.assertEqual(manifest["start_url"], "../twin/")
            self.assertEqual(manifest["scope"], "../twin/")

    def test_health_reports_twin_and_legacy_data_variable_still_works(self):
        with tempfile.TemporaryDirectory() as legacy:
            env = {key: value for key, value in os.environ.items() if key != "TWIN_DATA"}
            env["TRADE_TWIN_DATA"] = legacy
            script = (
                "import importlib.util, sys\n"
                f"spec = importlib.util.spec_from_file_location('twin_server', {str(APP / 'server.py')!r})\n"
                "module = importlib.util.module_from_spec(spec)\n"
                "spec.loader.exec_module(module)\n"
                "print(module.DATA)\n"
            )
            result = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, check=True)
            self.assertEqual(Path(result.stdout.strip()), Path(legacy).resolve())
        self.assertIn('"app": "twin"', (APP / "server.py").read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
