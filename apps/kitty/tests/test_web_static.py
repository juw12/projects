#!/usr/bin/env python3
"""Static checks for the Kitty web app (apps/kitty/web). Stdlib only.

- required files exist and every local <script>/<link> reference resolves
- the web manifest is valid JSON with icons that exist
- redirect pages point at files that exist
- JS never uses root-absolute string literals ("/path"), which break on GitHub Pages
- no external runtime dependencies (no CDN scripts)
"""

import json
import re
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
WEB = APP_DIR / "web"

REQUIRED = [
    "index.html",
    "web.html",
    "mobile.html",
    "demo.html",
    "tests.html",
    "styles.css",
    "manifest.webmanifest",
    "icon.svg",
    "sw.js",
    "get.html",
    "apple-touch-icon.png",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "js/core.js",
    "js/sync.js",
    "js/ui-kit.js",
    "js/quiz.js",
    "js/app.js",
    "js/i18n.js",
    "js/lang/id.js",
    "js/lang/zh.js",
    "js/lang/es.js",
    "version.json",
]

REF_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"'#?]+)""", re.I)
REDIRECT_RE = re.compile(r"""(?:url=|location\.replace\(\s*["'])([^"'#?)\s;]+)""", re.I)
ROOT_LITERAL_RE = re.compile(r"""(?<![\w\\])(['"`])/[A-Za-z_][\w./-]*\1""")


class WebStaticTests(unittest.TestCase):
    def test_required_files_exist(self):
        missing = [name for name in REQUIRED if not (WEB / name).is_file()]
        self.assertEqual(missing, [], "missing files: %s" % missing)

    def test_html_references_resolve(self):
        broken = []
        for html in WEB.glob("*.html"):
            for ref in REF_RE.findall(html.read_text(encoding="utf-8")):
                if re.match(r"^(https?:|mailto:|data:|javascript:|//)", ref) or not ref.strip():
                    continue
                if not (html.parent / ref).resolve().exists():
                    broken.append("%s -> %s" % (html.name, ref))
        self.assertEqual(broken, [])

    def test_redirect_pages_point_to_real_files(self):
        for name in ("web.html", "mobile.html", "demo.html"):
            text = (WEB / name).read_text(encoding="utf-8")
            targets = REDIRECT_RE.findall(text)
            self.assertTrue(targets, "%s has no redirect target" % name)
            for target in targets:
                self.assertTrue((WEB / target).exists(), "%s -> %s" % (name, target))

    def test_manifest_is_valid(self):
        manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertTrue(manifest.get("name", "").startswith("Kitty"))
        self.assertTrue(manifest.get("start_url"))
        self.assertFalse(manifest["start_url"].startswith("/"), "start_url must be relative for GitHub Pages")
        self.assertTrue(manifest.get("icons"))
        for icon in manifest["icons"]:
            self.assertTrue((WEB / icon["src"]).exists(), icon["src"])
        sizes = {icon.get("sizes") for icon in manifest["icons"] if icon.get("type") == "image/png"}
        self.assertIn("192x192", sizes, "installable PWAs need a 192px PNG icon")
        self.assertIn("512x512", sizes, "installable PWAs need a 512px PNG icon")
        for shortcut in manifest.get("shortcuts", []):
            self.assertFalse(shortcut["url"].startswith("/"), "shortcut urls must be relative")

    def test_no_root_absolute_literals_in_js(self):
        offenders = []
        for js in list(WEB.glob("js/*.js")) + [WEB / "sw.js"]:
            for lineno, line in enumerate(js.read_text(encoding="utf-8").splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                # regex literals and closing tags are fine; only flag quoted strings
                for match in ROOT_LITERAL_RE.finditer(line):
                    offenders.append("%s:%d %s" % (js.name, lineno, match.group(0)))
        self.assertEqual(offenders, [])

    def test_no_external_scripts(self):
        for html in WEB.glob("*.html"):
            text = html.read_text(encoding="utf-8")
            self.assertIsNone(
                re.search(r"<script[^>]+src=[\"']https?://", text, re.I),
                "%s loads a remote script" % html.name,
            )

    def test_index_loads_scripts_in_dependency_order(self):
        text = (WEB / "index.html").read_text(encoding="utf-8")
        order = [m for m in re.findall(r"js/([\w-]+)\.js", text)]
        for earlier, later in (("core", "sync"), ("core", "app"), ("ui-kit", "app"), ("quiz", "app")):
            self.assertLess(order.index(earlier), order.index(later), "%s must load before %s" % (earlier, later))

    def test_dark_theme_overrides_every_color_token(self):
        css = (WEB / "styles.css").read_text(encoding="utf-8")
        light_block = re.search(r":root\s*\{(.*?)\}", css, re.S).group(1)
        dark_block = re.search(r"\[data-theme=\"dark\"\]\s*\{(.*?)\}", css, re.S).group(1)
        light = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", light_block))
        dark = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", dark_block))
        color = re.compile(r"#[0-9a-f]{3,8}\b|rgba?\(", re.I)
        same_in_both = {"--accent-2", "--accent-ink"}
        missing = sorted(
            name for name, value in light.items() if color.search(value) and name not in dark and name not in same_in_both
        )
        self.assertEqual(missing, [], "dark theme does not override: %s" % missing)

    def test_theme_switch_is_one_tap_on_every_screen(self):
        app = (WEB / "js" / "app.js").read_text(encoding="utf-8")
        buttons = re.findall(r"<button class=\"([^\"]*theme-btn[^\"]*)\" data-act=\"(theme(?:-welcome)?)\"", app)
        self.assertEqual(sorted(act for _, act in buttons), ["theme", "theme-welcome"], buttons)
        for classes, _ in buttons:
            self.assertNotIn("hide-sm", classes, "the theme button must stay visible on phones")
        self.assertIn("appearanceCard() +", app, "Settings shows the Appearance picker")
        more = app[app.index("function openMore()") : app.index("function openShortcuts()")]
        self.assertIn("set-theme", more, "the phone More sheet offers Light / Dark / System")

    def test_release_manifest_matches_app(self):
        release = json.loads((WEB / "version.json").read_text(encoding="utf-8"))
        core = (WEB / "js" / "core.js").read_text(encoding="utf-8")
        version = re.search(r"K\.VERSION\s*=\s*['\"]([\d.]+)['\"]", core).group(1)
        self.assertEqual(release["version"], version, "bump web/version.json together with K.VERSION")
        self.assertRegex(release.get("released", ""), r"^\d{4}-\d{2}-\d{2}$")
        notes = release["notes"]
        self.assertEqual(sorted(notes), ["en", "es", "id", "zh"])
        counts = {lang: len(items) for lang, items in notes.items()}
        self.assertEqual(len(set(counts.values())), 1, "every language needs the same notes: %s" % counts)
        for lang, items in notes.items():
            self.assertTrue(items and all(isinstance(n, str) and n.strip() for n in items), lang)

    def test_service_worker_never_caches_the_release_manifest(self):
        sw = (WEB / "sw.js").read_text(encoding="utf-8")
        shell = sw.split("const SHELL", 1)[1].split("];", 1)[0]
        self.assertNotIn("version.json", shell)
        self.assertIn("version.json", sw, "the fetch handler must let version.json through to the network")

    def test_relay_server_is_stdlib_only(self):
        source = (APP_DIR / "server" / "relay.py").read_text(encoding="utf-8")
        imports = set(re.findall(r"^\s*(?:from|import)\s+([\w.]+)", source, re.M))
        allowed = {"argparse", "json", "os", "re", "secrets", "threading", "time", "http.server", "urllib.parse"}
        self.assertTrue(imports <= allowed, "unexpected imports: %s" % (imports - allowed))


if __name__ == "__main__":
    unittest.main(verbosity=2)
