"""Glow AI News (1.28.0): static checks, stdlib only.

The page exists and follows the Glow rules (CSP, no inline script, local refs resolve), it is in the
Glow apps menu and on Glow home, works offline through the home service worker, the committed edition
is valid, the Pages build refreshes it, and every story field shown on the page is escaped.
Run from the repo root:  python apps/glow/tests/test_glow_news.py
"""
import json
import re
import sys
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
NEWS = WEB / "news"
REPO = APP.parent.parent


class GlowNewsTests(unittest.TestCase):
    def setUp(self):
        self.html = (NEWS / "index.html").read_text(encoding="utf-8")
        self.js = (NEWS / "news.js").read_text(encoding="utf-8")

    def test_page_follows_glow_rules(self):
        self.assertIn("Content-Security-Policy", self.html)
        self.assertIn("connect-src 'self'", self.html, "news.json must be same-origin")
        self.assertFalse(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", self.html), "no inline scripts (CSP)")
        refs = re.findall(r'(?:src|href)="([^"]+)"', self.html)
        local = [r for r in refs if not re.match(r"^(https?:|mailto:|#|data:)", r)]
        missing = [r for r in local if not (NEWS / r.split("#")[0].split("?")[0]).exists()]
        self.assertEqual(missing, [])
        for script in ("../shared/glow-locale.js", "../shared/glow-apps.js", "./news.js"):
            self.assertIn(f'src="{script}"', self.html)
        used_ids = set(re.findall(r'\$\("([\w-]+)"\)', self.js))
        html_ids = set(re.findall(r'id="([\w-]+)"', self.html))
        self.assertEqual(sorted(used_ids - html_ids), [], "every element news.js uses exists")

    def test_in_glow_apps_menu_and_home(self):
        apps = (WEB / "shared" / "glow-apps.js").read_text(encoding="utf-8")
        self.assertIn('{ id: "news", name: "AI News"', apps)
        self.assertIn('if (/\\/news\\//.test(path)) return "news";', apps)
        self.assertIn('if (/^news\\//.test(rest)) return "news";', apps)
        locale = (WEB / "shared" / "glow-locale.js").read_text(encoding="utf-8")
        self.assertEqual(locale.count('"apps.news"'), 4, "menu description in en, id, zh-CN, zh-TW")
        for key in re.findall(r'data-i18n(?:-placeholder)?="([\w.]+)"', self.html):
            self.assertEqual(locale.count(f'"{key}"'), 4, f"{key} translated in all 4 languages")
        home = (WEB / "index.html").read_text(encoding="utf-8")
        self.assertIn('id="today-ai"', home)
        self.assertIn('href="./news/"', home)
        self.assertIn("./news/news.json", (WEB / "home.js").read_text(encoding="utf-8"))

    def test_offline_and_versions(self):
        sw = (WEB / "sw.js").read_text(encoding="utf-8")
        for asset in ("./news/", "./news/news.css", "./news/news.js", "./news/news.json"):
            self.assertIn(f"'{asset}'", sw)
        self.assertNotIn("glowhome-v15", sw, "cache name bumped with the new assets")
        published = json.loads((WEB / "version.json").read_text(encoding="utf-8"))["version"]
        self.assertIn(f'const GLOW_VERSION = "{published}";', (WEB / "shared" / "glow-apps.js").read_text(encoding="utf-8"))
        self.assertIn("https://juw12.github.io/projects/glow/news/", (WEB / "sitemap.xml").read_text(encoding="utf-8"))

    def test_committed_edition_is_valid(self):
        edition = json.loads((NEWS / "news.json").read_text(encoding="utf-8"))
        stories = edition["stories"]
        self.assertGreaterEqual(len(stories), 5)
        self.assertEqual(len({s["id"] for s in stories}), len(stories))
        topics = {t["id"] for t in edition["topics"]}
        for story in stories:
            self.assertTrue(story["url"].startswith(("https://", "http://")), story["id"])
            self.assertIn(story["topic"], topics)
            self.assertTrue(story["sources"], story["id"])
            self.assertIsInstance(story["summary_ai"], bool)
        self.assertEqual(edition["refresh_hours"], 12)
        for point in edition["briefing"]["points"]:
            self.assertIn(point["id"], {s["id"] for s in stories})

    def test_pages_build_refreshes_twice_a_day(self):
        pages = (REPO / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
        self.assertIn("apps/glow/tools/ai_news.py --ai --live https://juw12.github.io/projects/glow/news/news.json", pages)
        self.assertIn("git checkout -- apps/glow/web/news/news.json", pages, "a failed refresh deploys the committed edition")
        self.assertLess(pages.index("ai_news.py"), pages.index("python scripts/build_site.py"), "refresh runs before the site is built")
        tool = (APP / "tools" / "ai_news.py").read_text(encoding="utf-8")
        self.assertIn("REFRESH_HOURS = 12", tool)

    def test_feed_text_is_escaped(self):
        # Every story field that reaches innerHTML goes through escapeHtml, and links are http(s) only.
        for field in ("story.title", "story.summary", "story.why", "s.name", "point.text", "story.topic"):
            self.assertIn(f"escapeHtml({field})", self.js, field)
        self.assertIn('url.protocol === "https:" || url.protocol === "http:"', self.js)
        self.assertNotIn("innerHTML = story", self.js)
        self.assertIn('rel="noopener noreferrer"', self.js)

    def test_ask_glow_hands_story_to_chat(self):
        self.assertIn('url.searchParams.set("q"', self.js)
        self.assertIn('url.searchParams.set("send", "1")', self.js)
        self.assertIn("ASK_MAX = 3800", self.js, "stays under GlowChat's 4000-character ?q= limit")


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
