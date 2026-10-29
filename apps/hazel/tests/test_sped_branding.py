"""Regression checks for Hookline -> Sped -> Hazel Sped (stdlib only)."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent          # apps/hazel
REPO = APP.parent.parent
WEB = APP / "web" / "sped"

spec = importlib.util.spec_from_file_location("hazel_site_builder", REPO / "scripts/build_site.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class SpedBrandingTests(unittest.TestCase):
    def test_catalog_has_no_old_entries(self):
        apps = json.loads((REPO / "scripts/apps.json").read_text(encoding="utf-8"))["apps"]
        ids = [app["id"] for app in apps]
        for old in ("hookline", "sped", "shortcraft"):
            self.assertNotIn(old, ids)
        self.assertEqual(ids.count("hazel"), 1)

    def test_user_facing_files_are_branded_hazel_sped(self):
        for path in sorted(WEB.rglob("*")):
            if path.suffix in {".html", ".js", ".css", ".webmanifest"}:
                text = path.read_text(encoding="utf-8")
                # The only allowed mention is the legacy recipe format name.
                stripped = text.replace("'hookline-project'", "")
                self.assertNotIn("Hookline", stripped, path.name)
                self.assertNotIn("hookline", stripped, path.name)
        manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["short_name"], "Hazel Sped")
        for page in ("index.html", "web.html", "mobile.html"):
            self.assertIn("<title>Hazel Sped", (WEB / page).read_text(encoding="utf-8"), page)
        self.assertIn("<h1>Hazel Sped</h1>", (WEB / "app.js").read_text(encoding="utf-8"))
        self.assertIn("'hazel-sped-v", (WEB / "sw.js").read_text(encoding="utf-8"))

    def test_recipes_saved_under_old_names_still_load(self):
        recipes = (WEB / "recipes.js").read_text(encoding="utf-8")
        self.assertIn("'hookline-project'", recipes)
        self.assertIn("format: 'sped-project'", recipes)

    def test_saved_look_key_is_unchanged(self):
        self.assertIn("const LOOK_KEY = 'sped-look';", (WEB / "app.js").read_text(encoding="utf-8"))

    def test_old_links_redirect_and_old_workers_are_retired(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "hazel" / "sped"
            target.mkdir(parents=True)
            for name in ("index.html", "web.html", "mobile.html"):
                (target / name).write_text("Hazel Sped", encoding="utf-8")
            (target / "manifest.webmanifest").write_text((WEB / "manifest.webmanifest").read_text(encoding="utf-8"), encoding="utf-8")
            builder.write_redirects(root, [{"id": "hazel"}])
            for old in ("hookline", "sped"):
                for page, destination in (
                    ("index.html", "../hazel/sped/"),
                    ("web.html", "../hazel/sped/web.html"),
                    ("mobile.html", "../hazel/sped/mobile.html"),
                ):
                    stub = (root / old / page).read_text(encoding="utf-8")
                    self.assertIn(f'data-target="{destination}"', stub, f"{old}/{page}")
                manifest = json.loads((root / old / "manifest.webmanifest").read_text(encoding="utf-8"))
                self.assertEqual(manifest["short_name"], "Hazel Sped")
                self.assertEqual(manifest["start_url"], "../hazel/sped/")
                self.assertEqual(manifest["scope"], "../hazel/sped/")
            hookline = (root / "hookline/sw.js").read_text(encoding="utf-8")
            self.assertIn("name.startsWith('hookline-v')", hookline)
            sped = (root / "sped/sw.js").read_text(encoding="utf-8")
            # Deletes only Sped 1.x caches (sped-v1.x.x) -- never Hazel Sped's hazel-sped-v... or other apps'.
            self.assertIn("name.startsWith('sped-v')", sped)
            self.assertFalse("hazel-sped-v1.5.0".startswith("sped-v"))
            for worker in (hookline, sped):
                self.assertIn("self.skipWaiting()", worker)
                self.assertIn("self.registration.unregister()", worker)
                self.assertNotIn("clients.navigate", worker)

    def test_legacy_source_paths_point_to_hazel(self):
        for old in ("hookline", "sped"):
            stub = (REPO / f"apps/{old}/README.md").read_text(encoding="utf-8")
            self.assertIn("Hazel Sped", stub)
            self.assertIn("apps/hazel", stub.replace("../hazel", "apps/hazel"))
            self.assertFalse((REPO / f"apps/{old}/web").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
