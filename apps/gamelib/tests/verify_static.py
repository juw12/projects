"""Verify the imported library is deployed without publishing showcase cards."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "apps" / "gamelib" / "web"


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GameLibraryMigrationTests(unittest.TestCase):
    def test_all_games_and_entry_page_are_present(self):
        self.assertTrue((WEB / "index.html").is_file())
        self.assertEqual(len(list(WEB.rglob("*.html"))), 335)

    def test_library_is_deployed_but_not_listed(self):
        catalog = json.loads((ROOT / "scripts/apps.json").read_text(encoding="utf-8"))["apps"]
        game = next(app for app in catalog if app["id"] == "gamelib")
        self.assertFalse(game["listed"])
        self.assertFalse(game.get("external", False))
        self.assertFalse(game.get("work", False))
        builder = load_module("migration_builder", "build_site.py")
        self.assertNotIn("Game Library", [card["name"] for card in builder.build_landing_apps(catalog)])
        publisher = load_module("migration_publisher", "publish_portfolio.py")
        self.assertNotIn("Game Library", publisher.render_block(catalog))


if __name__ == "__main__":
    unittest.main()
