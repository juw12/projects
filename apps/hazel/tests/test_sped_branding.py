"""Regression checks for the Hookline -> Sped rename (stdlib only)."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
REPO = APP.parent.parent
WEB = APP / "web"

spec = importlib.util.spec_from_file_location("sped_site_builder", REPO / "scripts/build_site.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class RenameTests(unittest.TestCase):
    def test_catalog_has_one_sped_and_no_old_entry(self):
        apps = json.loads((REPO / "scripts/apps.json").read_text())["apps"]
        self.assertEqual(sum(app["id"] == "sped" for app in apps), 1)
        self.assertFalse(any(app["id"] == "hookline" for app in apps))
        sped = next(app for app in apps if app["id"] == "sped")
        self.assertEqual(sped["name"], "Sped")
        self.assertTrue(all(link.startswith("sped/") for link in sped["links"].values()))

    def test_user_facing_files_are_branded_sped(self):
        for path in sorted(WEB.rglob("*")):
            if path.suffix in {".html", ".js", ".css", ".webmanifest"}:
                text = path.read_text()
                # The only allowed mention is the legacy recipe format name.
                stripped = text.replace("'hookline-project'", "")
                self.assertNotIn("Hookline", stripped, path.name)
                self.assertNotIn("hookline", stripped, path.name)
        manifest = json.loads((WEB / "manifest.webmanifest").read_text())
        self.assertEqual(manifest["short_name"], "Sped")
        self.assertIn("sped-v", (WEB / "sw.js").read_text())

    def test_recipes_saved_under_the_old_name_still_load(self):
        recipes = (WEB / "recipes.js").read_text()
        self.assertIn("'hookline-project'", recipes)
        self.assertIn("format: 'sped-project'", recipes)

    def test_old_links_redirect_and_old_worker_is_retired(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "sped"
            target.mkdir()
            for name in ("index.html", "web.html", "mobile.html"):
                (target / name).write_text("Sped")
            (target / "manifest.webmanifest").write_text((WEB / "manifest.webmanifest").read_text())
            builder.write_redirects(root, [{"id": "sped"}])
            for page, destination in (
                ("index.html", "../sped/"),
                ("web.html", "../sped/web.html"),
                ("mobile.html", "../sped/mobile.html"),
            ):
                stub = (root / "hookline" / page).read_text()
                self.assertIn(f'data-target="{destination}"', stub)
            worker = (root / "hookline/sw.js").read_text()
            # Deletes only Hookline's caches (named hookline-v1.x.x), never other apps'.
            self.assertIn("name.startsWith('hookline-v')", worker)
            self.assertIn("self.skipWaiting()", worker)
            self.assertIn("self.registration.unregister()", worker)
            self.assertNotIn("clients.navigate", worker)
            manifest = json.loads((root / "hookline/manifest.webmanifest").read_text())
            self.assertEqual(manifest["short_name"], "Sped")
            self.assertEqual(manifest["start_url"], "../sped/")
            self.assertEqual(manifest["scope"], "../sped/")

    def test_legacy_source_path_points_to_new_folder(self):
        stub = (REPO / "apps/hookline/README.md").read_text()
        self.assertIn("Hookline is now Sped", stub)
        self.assertFalse((REPO / "apps/hookline/web").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
