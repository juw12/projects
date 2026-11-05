"""Game Library: catalog <-> files integrity and the "runs offline" promise.

index.html carries the catalog as inline JSON-like entries. Every entry must open a real page,
every page must be reachable from the catalog, and no page may pull anything from the network.
Known issues found when these tests were written are listed explicitly so new ones still fail.
"""

import re
import unittest
from collections import Counter
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"
ENTRY_RE = re.compile(
    r'\{"title":\s*"(?P<title>[^"]+)",\s*"href":\s*"(?P<href>[^"]+)",\s*"emoji":\s*"[^"]*",'
    r'\s*"category":\s*"(?P<category>[^"]+)"'
)
LOCAL_REF_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"'#?]+)""", re.I)
EXTERNAL_REF_RE = re.compile(r"""(?:src|href)\s*=\s*["'](?:https?:)?//""", re.I)
SKIP_REF_RE = re.compile(r"^(data:|mailto:|javascript:|blob:)|[{}+$]")

# Two catalog titles are each used by two different pages (an older and a newer build).
KNOWN_DUPLICATE_TITLES = {"Mahjong Solitaire", "Simon Says"}
# Pages that render in quirks mode (no <!DOCTYPE html>); adding one may change their layout.
KNOWN_QUIRKS_PAGES = 19


def catalog():
    return [match.groupdict() for match in ENTRY_RE.finditer((WEB / "index.html").read_text(encoding="utf-8"))]


def game_pages():
    return sorted(path for path in WEB.rglob("*.html") if path != WEB / "index.html")


class CatalogTests(unittest.TestCase):
    def test_catalog_is_complete_and_points_at_real_pages(self):
        entries = catalog()
        hrefs = {entry["href"] for entry in entries}
        pages = {path.relative_to(WEB).as_posix() for path in game_pages()}
        self.assertEqual(len(hrefs), len(entries), "duplicate href in catalog")
        self.assertEqual(hrefs - pages, set(), "catalog links to missing pages")
        self.assertEqual(pages - hrefs, set(), "pages nobody can reach from the catalog")

    def test_every_entry_has_a_known_category(self):
        categories = Counter(entry["category"] for entry in catalog())
        self.assertGreaterEqual(len(categories), 10)
        self.assertTrue(all(count >= 5 for count in categories.values()), categories)

    def test_no_new_duplicate_titles(self):
        counts = Counter(entry["title"] for entry in catalog())
        duplicates = {title for title, count in counts.items() if count > 1}
        self.assertEqual(duplicates - KNOWN_DUPLICATE_TITLES, set())


class PageTests(unittest.TestCase):
    def test_every_local_reference_resolves(self):
        broken = []
        for page in game_pages() + [WEB / "index.html"]:
            for ref in LOCAL_REF_RE.findall(page.read_text(encoding="utf-8", errors="replace")):
                if ref.startswith(("http:", "https:", "//", "/")) or SKIP_REF_RE.search(ref):
                    continue
                if not (page.parent / ref).exists():
                    broken.append(f"{page.relative_to(WEB)} -> {ref}")
        self.assertEqual(broken, [])

    def test_runs_offline_no_network_assets(self):
        online = [
            page.relative_to(WEB).as_posix()
            for page in game_pages() + [WEB / "index.html"]
            if EXTERNAL_REF_RE.search(page.read_text(encoding="utf-8", errors="replace"))
        ]
        self.assertEqual(online, [], "pages that load assets from the network")

    def test_every_page_has_title_and_mobile_viewport(self):
        for page in game_pages():
            content = page.read_text(encoding="utf-8", errors="replace")
            with self.subTest(page=page.name):
                self.assertRegex(content, r"<title>[^<]+</title>")
                self.assertIn('name="viewport"', content)

    def test_quirks_mode_pages_do_not_grow(self):
        quirks = [
            page.name
            for page in game_pages()
            if not page.read_text(encoding="utf-8", errors="replace").lstrip().lower().startswith("<!doctype html")
        ]
        self.assertLessEqual(len(quirks), KNOWN_QUIRKS_PAGES, quirks)


if __name__ == "__main__":
    unittest.main()
