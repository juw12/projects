#!/usr/bin/env python3
"""Static checks for Mint Budget (apps/mint/web/budget) and how it joins Mint Templates. Stdlib only.

- required files exist and every local <script>/<link> reference resolves
- the shared Mint manifest is valid, opens on Budget and covers Templates too
- redirect pages point at files that exist
- JS never uses root-absolute string literals ("/path"), which break on GitHub Pages
- no external runtime dependencies (no CDN scripts)
- Budget and Templates link to each other and share one theme and one language
- budgets saved by older versions move to the mint.budget.* keys before anything reads them
- the first visit asks for a language and a region (js/locale.js); the region picks the currency
- old addresses, invites and installs from before Mint 3.0 land on Mint Budget (scripts/build_site.py)
- the Windows/Mac app and the Android app are wired to the live site and the download page
"""

import importlib.util
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
MINT_WEB = APP_DIR / "web"
WEB = MINT_WEB / "budget"
REPO = APP_DIR.parents[1]

REQUIRED = [
    "index.html",
    "web.html",
    "mobile.html",
    "demo.html",
    "tests.html",
    "styles.css",
    "sw.js",
    "get.html",
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


def read(path):
    return Path(path).read_text(encoding="utf-8")


def js_regex(source, name):
    """Return the JS regex literal assigned to `const NAME = /.../;` as a Python pattern."""
    match = re.search(r"const %s = /(.+?)/;" % name, source)
    return re.compile(match.group(1)) if match else None


class BudgetWebTests(unittest.TestCase):
    def test_required_files_exist(self):
        missing = [name for name in REQUIRED if not (WEB / name).is_file()]
        self.assertEqual(missing, [], "missing files: %s" % missing)

    def test_html_references_resolve(self):
        broken = []
        for html in WEB.glob("*.html"):
            for ref in REF_RE.findall(read(html)):
                if re.match(r"^(https?:|mailto:|data:|javascript:|//)", ref) or not ref.strip():
                    continue
                if not (html.parent / ref).resolve().exists():
                    broken.append("%s -> %s" % (html.name, ref))
        self.assertEqual(broken, [])

    def test_redirect_pages_point_to_real_files(self):
        for name in ("web.html", "mobile.html", "demo.html"):
            text = read(WEB / name)
            targets = REDIRECT_RE.findall(text)
            self.assertTrue(targets, "%s has no redirect target" % name)
            for target in targets:
                self.assertTrue((WEB / target).exists(), "%s -> %s" % (name, target))

    def test_one_manifest_for_all_of_mint(self):
        manifest = json.loads(read(MINT_WEB / "manifest.webmanifest"))
        self.assertTrue(manifest.get("name", "").startswith("Mint"))
        self.assertEqual(manifest.get("short_name"), "Mint")
        # Same install identity as the Mint (Templates) PWA people already installed: id resolves to /projects/mint/app.html.
        self.assertEqual(manifest.get("id"), "projects/mint/app.html")
        self.assertEqual(manifest.get("scope"), "./", "one scope covers Budget (budget/) and Templates (app.html)")
        start = manifest["start_url"]
        self.assertFalse(start.startswith("/"), "start_url must be relative for GitHub Pages")
        self.assertTrue((MINT_WEB / start / "index.html").is_file(), "Mint opens on Budget: %s" % start)
        for icon in manifest["icons"]:
            self.assertTrue((MINT_WEB / icon["src"]).exists(), icon["src"])
        sizes = {icon.get("sizes") for icon in manifest["icons"] if icon.get("type") == "image/png"}
        self.assertIn("192x192", sizes, "installable PWAs need a 192px PNG icon")
        self.assertIn("512x512", sizes, "installable PWAs need a 512px PNG icon")
        for shortcut in manifest.get("shortcuts", []):
            url = shortcut["url"]
            self.assertFalse(url.startswith("/"), "shortcut urls must be relative")
            self.assertTrue((MINT_WEB / url.split("?")[0].split("#")[0]).is_file(), url)
        for page in ("index.html", "get.html"):
            self.assertIn('href="../manifest.webmanifest"', read(WEB / page), "%s links the shared manifest" % page)

    def test_no_root_absolute_literals_in_js(self):
        offenders = []
        for js in list(WEB.glob("js/*.js")) + [WEB / "sw.js"]:
            for lineno, line in enumerate(read(js).splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("//") or stripped.startswith("*"):
                    continue
                # regex literals and closing tags are fine; only flag quoted strings
                for match in ROOT_LITERAL_RE.finditer(line):
                    offenders.append("%s:%d %s" % (js.name, lineno, match.group(0)))
        self.assertEqual(offenders, [])

    def test_no_external_scripts(self):
        for html in WEB.glob("*.html"):
            self.assertIsNone(
                re.search(r"<script[^>]+src=[\"']https?://", read(html), re.I),
                "%s loads a remote script" % html.name,
            )

    def test_index_loads_scripts_in_dependency_order(self):
        order = re.findall(r"js/([\w-]+)\.js", read(WEB / "index.html"))
        for earlier, later in (("core", "sync"), ("core", "app"), ("ui-kit", "app"), ("quiz", "app")):
            self.assertLess(order.index(earlier), order.index(later), "%s must load before %s" % (earlier, later))

    def test_dark_theme_overrides_every_color_token(self):
        css = read(WEB / "styles.css")
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

    def test_mint_green_brand(self):
        css = read(WEB / "styles.css")
        light_block = re.search(r":root\s*\{(.*?)\}", css, re.S).group(1)
        self.assertIn("--accent: #0b8564;", light_block)
        self.assertNotRegex(css, r"#4f46e5|#8f7bff|108,\s*92,\s*231", "no leftovers of the old indigo theme")

    def test_theme_switch_is_one_tap_on_every_screen(self):
        app = read(WEB / "js" / "app.js")
        buttons = re.findall(r"<button class=\"([^\"]*theme-btn[^\"]*)\" data-act=\"(theme(?:-welcome)?)\"", app)
        self.assertEqual(sorted(set(act for _, act in buttons)), ["theme", "theme-welcome"], buttons)
        for classes, _ in buttons:
            self.assertNotIn("hide-sm", classes, "the theme button must stay visible on phones")
        self.assertIn("appearanceCard() +", app, "Settings shows the Appearance picker")
        more = app[app.index("function openMore()") : app.index("function openShortcuts()")]
        self.assertIn("set-theme", more, "the phone More sheet offers Light / Dark / System")

    def test_templates_reachable_from_budget(self):
        app = read(WEB / "js" / "app.js")
        self.assertIn("const MARKET_PAGE = '../app.html';", app)
        self.assertTrue((WEB / "../app.html").resolve().is_file(), "the template store page exists next door")
        self.assertIn("{ id: 'market', label: 'Marketplace'", app, "Marketplace is a tab in Mint")
        self.assertIn("keep.set('embed', '1')", app, "the store is embedded, not a separate app")
        more = app[app.index("function openMore()") : app.index("function openShortcuts()")]
        self.assertIn("market", more, "phone More sheet links to the Marketplace")
        welcome = app[app.index("function renderWelcome(") : app.index("function welcomeMock()")]
        self.assertGreaterEqual(welcome.count("view=market"), 2, "welcome page points first-time visitors to the Marketplace")

    def test_budget_reachable_from_templates(self):
        for page in ("app.html", "web.html", "mobile.html"):
            html = read(MINT_WEB / page)
            nav = html[html.index('<nav class="nav"') : html.index("</nav>")]
            tabbar = html[html.index('<nav class="tabbar"') :]
            tabbar = tabbar[: tabbar.index("</nav>")]
            self.assertIn('href="budget/"', nav, "%s desktop nav links to Budget" % page)
            self.assertIn('href="budget/"', tabbar, "%s phone tab bar links to Budget" % page)

    def test_root_page_opens_budget_and_keeps_template_links(self):
        root = read(MINT_WEB / "index.html")
        self.assertIn("location.replace", root)
        self.assertIn("'budget/'", root)
        self.assertIn("out.set('view', 'market')", root, "template links open the Marketplace tab")
        self.assertIn("/^#\\//.test(hash)", root, "#/market, #/item/... still reach the template store")
        self.assertIn("ref|coupon", root, "affiliate and coupon links still reach the template store")

    def test_one_theme_and_one_language_for_both_halves(self):
        app = read(WEB / "js" / "app.js")
        boot = read(WEB / "index.html")
        budget_i18n = read(WEB / "js" / "i18n.js")
        templates_app = read(MINT_WEB / "js" / "app.js")
        templates_i18n = read(MINT_WEB / "js" / "i18n.js")
        self.assertIn("const SHARED_THEME = 'mint.theme';", app)
        self.assertIn("localStorage.setItem(SHARED_THEME, next)", app, "Budget saves the shared theme")
        self.assertIn("localStorage.getItem('mint.theme')", boot, "Budget paints the shared theme before first render")
        self.assertIn('var SHARED_THEME_KEY = "mint.theme";', templates_app)
        self.assertIn("localStorage.setItem(SHARED_THEME_KEY, next)", templates_app, "Templates saves the shared theme")
        for page in ("app.html", "web.html", "mobile.html"):
            self.assertIn("localStorage.getItem('mint.theme')", read(MINT_WEB / page), "%s paints the shared theme early" % page)
        self.assertIn("const STORE_KEY = 'mint.lang';", budget_i18n)
        self.assertIn('var KEY = "mint.lang";', templates_i18n)
        self.assertNotIn("kitty", budget_i18n + templates_i18n)

    def test_saved_budgets_move_to_the_mint_keys_first(self):
        app = read(WEB / "js" / "app.js")
        sync = read(WEB / "js" / "sync.js")
        locale = read(MINT_WEB / "js" / "locale.js")
        for key in ("'mint.budget.profile'", "'mint.budget.books'", "'mint.budget.book.'", "'mint.budget.activity.'",
                    "'mint.budget.lastVersion'", "'mint.budget.resume'", "'mint.budget.current'"):
            self.assertIn(key, app)
        self.assertIn("'mint.budget.sync.'", sync)
        self.assertIn("return 'mint-' + this.bookId;", sync)
        # The one-time move runs in locale.js, which every Budget page loads before anything reads storage.
        self.assertIn("var LEGACY_PREFIX = 'kitty.';", locale)
        self.assertIn("'mint.budget.' + key.slice(LEGACY_PREFIX.length)", locale)
        boot = read(WEB / "index.html")
        self.assertLess(boot.index('src="../js/locale.js"'), boot.index("mint.budget.profile"), "move the keys before the boot script reads them")
        self.assertLess(boot.index('src="../js/locale.js"'), boot.index('src="js/core.js"'))

    def test_the_old_name_is_gone(self):
        offenders = []
        paths = [p for p in WEB.rglob("*") if p.is_file() and p.suffix in (".html", ".js", ".css", ".json")]
        paths += [p for p in MINT_WEB.glob("*.html")] + list((MINT_WEB / "js").glob("*.js"))
        paths += [APP_DIR / "README.md", APP_DIR / "docs" / "mint.md", APP_DIR / "mobile" / "README.md",
                  APP_DIR / "budget" / "i18n" / "strings.txt", APP_DIR / "budget" / "server" / "relay.py"]
        for path in paths:
            for lineno, line in enumerate(read(path).splitlines(), 1):
                if re.search(r"kitty", line, re.I):
                    # Allowed: the migration that reads old keys, and the worker that clears old caches.
                    if "LEGACY_PREFIX" in line or "LEGACY_LANG" in line or "OWN_CACHE" in line:
                        continue
                    offenders.append("%s:%d %s" % (path.relative_to(APP_DIR), lineno, line.strip()[:120]))
        self.assertEqual(offenders, [])

    def test_language_and_region_are_asked_first(self):
        locale = read(MINT_WEB / "js" / "locale.js")
        core = read(WEB / "js" / "core.js")
        regions = re.findall(r"\['([A-Z]{2})', '([A-Z]{3})'\]", locale)
        self.assertGreaterEqual(len(regions), 25)
        currencies = set(re.findall(r"^\s+([A-Z]{3}): \{ locale:", core, re.M))
        for region, currency in regions:
            self.assertIn(currency, currencies, "region %s uses %s, which Budget can't format" % (region, currency))
        for lang in ("en", "id", "zh", "es"):
            self.assertIn("code: '%s'" % lang, locale)
            self.assertRegex(locale, r"\n    %s: \{\n      title:" % lang, "gate text in %s" % lang)
        self.assertIn("params.get('demo') === '1'", locale, "the demo never stops at the question")
        for page in ("app.html", "web.html", "mobile.html"):
            html = read(MINT_WEB / page)
            self.assertLess(html.index('src="js/locale.js"'), html.index('src="js/core.js"'), page)
        budget_app = read(WEB / "js" / "app.js")
        self.assertIn("data-act-change=\"set-region\"", budget_app, "Settings can change the region later")
        self.assertIn("window.MintLocale.current()", budget_app, "new budgets use the chosen currency")
        templates_app = read(MINT_WEB / "js" / "app.js")
        self.assertIn("Core.generate(prompt, { currency: regionCurrency() })", templates_app)
        for worker, entry in ((WEB / "sw.js", "'../js/locale.js'"), (MINT_WEB / "sw.js", '"js/locale.js"')):
            self.assertIn(entry, read(worker), "%s caches locale.js for offline use" % worker.name)

    def test_apps_for_every_device(self):
        get = read(WEB / "get.html")
        for asset in ("Mint-Windows-Setup.exe", "Mint-macOS-AppleSilicon.dmg", "Mint-macOS-Intel.dmg", "Mint-Android.apk"):
            self.assertIn("releases/download/mint/" + asset, get)
        workflow = read(REPO / ".github" / "workflows" / "mint-apps.yml")
        for asset in ("Mint-Windows-Setup.exe", "Mint-Windows-Portable.zip", "Mint-macOS-AppleSilicon.dmg", "Mint-macOS-Intel.dmg", "Mint-Android.apk"):
            self.assertIn(asset, workflow)
        desktop = read(APP_DIR / "desktop" / "mint_app.py")
        self.assertIn('"https://juw12.github.io/projects/mint/"', desktop)
        self.assertIn('webview.settings["ALLOW_DOWNLOADS"] = True', desktop, "exports must be able to save files")
        self.assertIn("private_mode=False", desktop, "budgets must survive a restart")
        version = json.loads(read(WEB / "version.json"))["version"]
        self.assertIn('VERSION = "%s"' % version, desktop)
        capacitor = json.loads(read(APP_DIR / "mobile" / "capacitor.config.json"))
        self.assertEqual(capacitor["server"]["url"], "https://juw12.github.io/projects/mint/")
        package = json.loads(read(APP_DIR / "mobile" / "package.json"))
        for plugin in ("@capacitor/app", "@capacitor/haptics", "@capacitor/filesystem", "@capacitor/share"):
            self.assertIn(plugin, package["dependencies"])
        budget_app = read(WEB / "js" / "app.js")
        self.assertIn("nativeCall('Filesystem', 'writeFile'", budget_app, "exports work inside the Android app")

    def test_release_manifest_matches_app(self):
        release = json.loads(read(WEB / "version.json"))
        version = re.search(r"K\.VERSION\s*=\s*['\"]([\d.]+)['\"]", read(WEB / "js" / "core.js")).group(1)
        self.assertEqual(release["version"], version, "bump web/budget/version.json together with K.VERSION")
        self.assertRegex(release.get("released", ""), r"^\d{4}-\d{2}-\d{2}$")
        notes = release["notes"]
        self.assertEqual(sorted(notes), ["en", "es", "id", "zh"])
        counts = {lang: len(items) for lang, items in notes.items()}
        self.assertEqual(len(set(counts.values())), 1, "every language needs the same notes: %s" % counts)
        for lang, items in notes.items():
            self.assertTrue(items and all(isinstance(n, str) and n.strip() for n in items), lang)

    def test_service_worker_never_caches_the_release_manifest(self):
        sw = read(WEB / "sw.js")
        shell = sw.split("const SHELL", 1)[1].split("];", 1)[0]
        self.assertNotIn("version.json", shell)
        self.assertIn("version.json", sw, "the fetch handler must let version.json through to the network")

    def test_service_workers_leave_each_others_caches_alone(self):
        budget = js_regex(read(WEB / "sw.js"), "OWN_CACHE")
        self.assertIsNotNone(budget, "budget/sw.js declares the caches it owns")
        templates_sw = read(MINT_WEB / "sw.js")
        templates = re.compile(re.search(r"return /(.+?)/\.test\(k\)", templates_sw).group(1))
        budget_cache = re.search(r"const CACHE = '([^']+)'", read(WEB / "sw.js")).group(1)
        templates_cache = re.search(r'var CACHE = "([^"]+)"', templates_sw).group(1)
        self.assertTrue(budget.search("kitty-v7"), "Budget clears the caches versions before 3.0 left behind")
        self.assertFalse(budget.search(templates_cache), "Budget must not delete the Templates cache")
        self.assertFalse(templates.search(budget_cache), "Templates must not delete the Budget cache")
        for other_app in ("glow-v3", "twin-shell-v2", "sync-v1", "crewroom-1"):
            self.assertFalse(budget.search(other_app), "Budget must not delete %s (same origin)" % other_app)
            self.assertFalse(templates.search(other_app), "Templates must not delete %s (same origin)" % other_app)

    def test_relay_server_is_stdlib_only(self):
        source = read(APP_DIR / "budget" / "server" / "relay.py")
        imports = set(re.findall(r"^\s*(?:from|import)\s+([\w.]+)", source, re.M))
        allowed = {"argparse", "json", "os", "re", "secrets", "threading", "time", "http.server", "urllib.parse"}
        self.assertTrue(imports <= allowed, "unexpected imports: %s" % (imports - allowed))


class OldAddressTests(unittest.TestCase):
    """The Pages build leaves stubs at the address Budget used before Mint 3.0, so old links, invites and installs land on Mint Budget."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("build_site", REPO / "scripts" / "build_site.py")
        cls.build_site = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.build_site)
        cls.tmp = Path(tempfile.mkdtemp(prefix="mint-site-"))
        shutil.copytree(MINT_WEB, cls.tmp / "mint")
        cls.build_site.write_redirects(cls.tmp, [{"id": "mint"}])
        cls.old = cls.tmp / "kitty"

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_every_old_page_redirects_into_budget(self):
        for page, target in (
            ("index.html", "../mint/budget/"),
            ("web.html", "../mint/budget/web.html"),
            ("mobile.html", "../mint/budget/mobile.html"),
            ("get.html", "../mint/budget/get.html"),
            ("demo.html", "../mint/budget/demo.html"),
            ("tests.html", "../mint/budget/tests.html"),
        ):
            stub = (self.old / page).read_text(encoding="utf-8")
            self.assertIn('data-target="%s"' % target, stub, page)
            resolved = (self.old / target).resolve()
            self.assertTrue(resolved.exists(), "%s -> %s" % (page, resolved))

    def test_redirect_keeps_invite_fragment_and_query(self):
        script = (self.old / "redirect.js").read_text(encoding="utf-8")
        self.assertIn("destination.hash = location.hash", script, "#join=<book>.<key> invites must survive")
        self.assertIn("destination.search = location.search", script)

    def test_open_old_tabs_see_the_new_version(self):
        old_release = json.loads((self.old / "version.json").read_text(encoding="utf-8"))
        new_release = json.loads((WEB / "version.json").read_text(encoding="utf-8"))
        self.assertEqual(old_release["version"], new_release["version"])

    def test_old_worker_retires_only_its_own_caches(self):
        worker = (self.old / "sw.js").read_text(encoding="utf-8")
        self.assertIn("name.startsWith('kitty-')", worker)
        self.assertIn("self.registration.unregister()", worker)
        self.assertNotIn("mint-", worker)


if __name__ == "__main__":
    unittest.main(verbosity=2)
