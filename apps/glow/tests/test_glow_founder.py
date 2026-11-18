"""GlowFounder checks: the Glow app that tests a business idea on a panel of simulated buyers.

GlowFounder lives in apps/glow/web/founder/. The page there hosts the studio (./studio/, the 3D market
square with its buyers, pricing and unit economics), follows what the studio reports and turns each
finished panel into one next step. The studio works out its numbers with Python running in the browser.

Static checks read the files. Browser checks open the page and look at what a person would see: a panel
that really runs, the result and its next step, the saved panels, an idea sent from Glow home, both
themes, phone widths, the four languages, and AI buyers answered by a made-up model. Nothing outside the
test's own server is ever reached.

Run from the repo root:  python -X utf8 apps/glow/tests/test_glow_founder.py
"""

import json
import re
import sys
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS))

from test_glow_offline import HAVE_PLAYWRIGHT, GlowPagesServer, launch_browser  # noqa: E402

if HAVE_PLAYWRIGHT:
    from playwright.sync_api import sync_playwright

APP = TESTS.parent
WEB = APP / "web"
FOUNDER = WEB / "founder"
STUDIO = FOUNDER / "studio"
SHARED = WEB / "shared"
REPO = APP.parent.parent

PAGE_ADDRESS = "https://juw12.github.io/projects/glow/founder/"
PAGE_SCRIPTS = ["../shared/glow-locale.js", "../shared/glow-apps.js", "./founder.js"]
STUDIO_SCRIPTS = ["js/embed.js", "../../shared/glow-harness-kit.js", "js/browser-backend.js", "js/app.js"]
OFFLINE_ASSETS = [
    "./founder/",
    "./founder/founder.css",
    "./founder/founder.js",
    "./founder/studio/index.html",
    "./founder/studio/styles.css",
    "./founder/studio/js/embed.js",
    "./founder/studio/js/app.js",
    "./founder/studio/js/arena.js",
    "./founder/studio/js/engine.js",
    "./founder/studio/js/review.js",
    "./founder/studio/js/browser-backend.js",
]
STUDIO_FILES = [
    "index.html", "styles.css", "bundle.json", "LICENSE",
    "js/app.js", "js/arena.js", "js/engine.js", "js/review.js", "js/browser-backend.js", "js/embed.js",
    "vendor/three.module.min.js",
    "pyodide/pyodide.mjs", "pyodide/pyodide.asm.js", "pyodide/pyodide.asm.wasm", "pyodide/python_stdlib.zip",
    "pyodide/pyodide-lock.json", "pyodide/NOTICE.md",
    "fonts/LICENSE.md", "licenses/founder-skill-LICENSE", "licenses/be-ambitious-LICENSE",
]
BUNDLED = ["server.py", "tools/panel.py", "tools/van_westendorp.py", "tools/unit_economics.py", "tools/compile.py"]
# The free models AI buyers are answered by: the same three as the rest of Glow, and nobody else.
FREE_MODEL_HOSTS = ["https://text.pollinations.ai", "https://api.llm7.io", "https://oai.endpoints.kepler.ai.cloud.ovh.net"]
# Each page's whole Content-Security-Policy, rule by rule. Loosening any part has to be done here on purpose.
PAGE_CSP = {
    "default-src": "'self'",
    "script-src": "'self'",
    "worker-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data:",
    "connect-src": "'self'",
}
STUDIO_CSP = {
    "default-src": "'self'",
    "script-src": "'self' 'wasm-unsafe-eval'",  # Python in the browser is WebAssembly
    "worker-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "font-src": "'self'",
    "connect-src": "'self' " + " ".join(FREE_MODEL_HOSTS),
}
MARKUP_WRITERS = ("innerHTML", "outerHTML", "insertAdjacentHTML", "createContextualFragment", "DOMParser", "srcdoc")
OTHER_STORES = ("sessionStorage", "document.cookie", "indexedDB", "caches.")
HOME_KEYS = {"apps.founder", "home.tile.founder", "home.pill.founder"}
MAX_SITE_MB = 20  # the whole app, Python runtime included, as it is published

DESKTOP = {"width": 1280, "height": 900}
PHONE = {"width": 390, "height": 844}
PHONE_NARROW = 320
TAP_SIZE = 44  # the smallest a control may be on a phone, each way, in CSS pixels
READY_MS = 120000  # the studio loads about 14 MB of Python before it is ready
RUN_MS = 120000
EXAMPLE = "Moss Matcha Bar"
PANEL = 20
HISTORY_KEY = "glow.founder.results.v1"
IDEA = "Night owl bike repair"
IDEA_SLUG = "night-owl-bike-repair"

STUDIO_READY = "() => document.documentElement.dataset.founderStudio === 'ready'"
RUN_DONE = "() => document.documentElement.dataset.founderRun === 'done'"
STATE = """() => {
  const data = document.documentElement.dataset;
  return { studio: data.founderStudio, run: data.founderRun, theme: data.theme };
}"""
WIDTHS = "() => [document.documentElement.scrollWidth, window.innerWidth]"
SAVED = f"() => JSON.parse(localStorage.getItem('{HISTORY_KEY}') || '[]')"
STEPS = """() => Array.from(document.querySelectorAll(".founder-step")).map((step) => ({
  status: step.className.replace("founder-step", "").trim(),
  title: step.querySelector("b").textContent.trim(),
  detail: step.querySelector(".founder-step-text > span").textContent.trim(),
}))"""
CONTROL_SIZES = """() => {
  const pressable = "button, a[href], input, select, textarea, summary, [role='button'], label[for]";
  const sizes = [];
  for (const control of document.querySelectorAll(pressable)) {
    if (control.closest(".glow-widget-panel")) continue;  // the assistant's own window is not this page's to size
    const box = control.getBoundingClientRect();
    if (!box.width || !box.height || getComputedStyle(control).visibility === "hidden") continue;
    const name = control.id ? "#" + control.id : control.tagName.toLowerCase() + "." + control.className;
    sizes.push([name, Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10]);
  }
  return sizes;
}"""
# What a finished panel would look like if another script on the page made it up.
FORGED_RESULT = """() => {
  window.postMessage(
    { type: "founder-studio:result", project: "forged", business: "Forged Co", heading: "Panel A", buys: 20, n: 20, rate: 1, target: 0.25 },
    location.origin
  );
  window.postMessage({ type: "founder-studio:run-start", project: "forged" }, location.origin);
  return new Promise((resolve) => setTimeout(resolve, 300));
}"""
LANGUAGE_CODES = """() => GlowLocale.languages.map((entry) => (typeof entry === "string" ? entry : entry.code))"""
WORDS_ON_PAGE = """() => {
  const words = (selector) => (document.querySelector(selector).textContent || "").trim();
  return {
    lang: document.documentElement.lang,
    lede: words(".founder-head .spark-lede"),
    firstStep: words(".founder-step b"),
    saved: words("#founder-saved-head"),
    limits: words("#limits-title"),
    everything: document.querySelector("main").innerText,
  };
}"""
# One AI buyer's reply, the way a chat-completions service wraps it. This buyer always buys.
BUYER_REPLY = json.dumps({
    "buys": True,
    "reason_code": "quality",
    "reason": "Ceremonial matcha near the office is worth it.",
    "purchases_first_month": 2,
    "price_too_cheap": 20000,
    "price_cheap": 30000,
    "price_expensive": 50000,
    "price_too_expensive": 70000,
})
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}


def text_of(path):
    return path.read_text(encoding="utf-8")


def policy_of(html):
    """The page's Content-Security-Policy as {rule: sources}; fails on a rule written twice."""
    written = re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', html)
    if len(written) != 1:
        raise AssertionError(f"one policy, written once as a meta tag: found {len(written)}")
    policy = {}
    for rule in filter(None, (part.strip() for part in written[0].split(";"))):
        name, _, sources = rule.partition(" ")
        if name in policy:
            raise AssertionError(f"{name} is written twice (a browser obeys only the first)")
        policy[name] = " ".join(sources.split())
    return policy


class GlowFounderStaticTests(unittest.TestCase):
    def setUp(self):
        self.html = text_of(FOUNDER / "index.html")
        self.js = text_of(FOUNDER / "founder.js")
        self.studio = text_of(STUDIO / "index.html")
        self.locale = text_of(SHARED / "glow-locale.js")

    def page_keys(self):
        keys = set(re.findall(r'data-i18n(?:-placeholder|-title)?="([\w.]+)"', self.html))
        keys |= set(re.findall(r'"(founder\.[\w.]+)"', self.js))
        return keys

    def test_page_follows_glow_rules(self):
        governed = re.search(r"<(?:link|script|style|img|iframe)\b", self.html)
        self.assertLess(self.html.index("Content-Security-Policy"), governed.start(), "the policy comes before everything it governs")
        self.assertEqual(policy_of(self.html), PAGE_CSP, "the host page runs its own scripts and reaches nobody")
        self.assertFalse(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", self.html), "no inline scripts (CSP)")
        self.assertFalse(re.findall(r"<[^>]*\son[a-z]+=", self.html), "no inline event handlers (CSP)")
        refs = re.findall(r'(?:src|href)="([^"]+)"', self.html)
        local = [ref for ref in refs if not re.match(r"^(https?:|mailto:|#|data:)", ref)]
        missing = [ref for ref in local if not (FOUNDER / ref.split("#")[0].split("?")[0]).exists()]
        self.assertEqual(missing, [])
        self.assertEqual(re.findall(r'<script[^>]*\bsrc="([^"]+)"', self.html), PAGE_SCRIPTS, "words, then the apps menu, then the page")
        used_ids = set(re.findall(r'\$\("([\w-]+)"\)', self.js))
        html_ids = set(re.findall(r'id="([\w-]+)"', self.html))
        self.assertEqual(sorted(used_ids - html_ids), [], "every element founder.js uses exists")
        self.assertIn('<iframe id="founder-frame" src="./studio/index.html?project=demo-matcha"', self.html, "the studio opens on the example")

    def test_page_is_self_contained(self):
        for evaluates in ("eval(", "new Function", "document.write"):
            self.assertNotIn(evaluates, self.js, "founder.js never runs text as code")
        for writer in MARKUP_WRITERS:
            self.assertNotIn(writer, self.js, "what the studio reports is shown as text, never as markup")
        for store in OTHER_STORES:
            self.assertNotIn(store, self.js, "the last panels are kept in localStorage and nowhere else")
        self.assertFalse(re.search(r"\brequire\(|^\s*import\s", self.js, re.M), "founder.js pulls in no package")
        self.assertNotIn("fetch(\"http", self.js)
        self.assertEqual(set(re.findall(r"https?://([\w.-]+)", self.js)), set(), "founder.js names no outside address")
        self.assertEqual(
            set(re.findall(r"https?://([\w.-]+)", self.html)),
            {"juw12.github.io", "github.com"},
            "Glow's own address and the link to the source, nothing else",
        )
        self.assertIn(
            "if (event.origin !== location.origin || event.source !== frame.contentWindow) return;",
            self.js,
            "only the studio in this page's own frame is listened to",
        )
        self.assertIn("frame.contentWindow.postMessage({ type, ...detail }, location.origin);", self.js, "and only it is spoken to")

    def test_studio_is_whole_and_locked_down(self):
        for name in STUDIO_FILES:
            self.assertTrue((STUDIO / name).is_file(), f"studio/{name}")
        self.assertEqual(policy_of(self.studio), STUDIO_CSP, "the studio reaches itself and Glow's three free models, nothing else")
        governed = re.search(r"<(?:link|script|style|img|iframe)\b", self.studio)
        self.assertLess(self.studio.index("Content-Security-Policy"), governed.start(), "the policy comes before everything it governs")
        self.assertFalse(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", self.studio), "no inline scripts (CSP)")
        self.assertFalse(re.findall(r"<[^>]*\son[a-z]+=", self.studio), "no inline event handlers (CSP)")
        self.assertEqual(re.findall(r'<script[^>]*\bsrc="([^"]+)"', self.studio), STUDIO_SCRIPTS)
        refs = re.findall(r'(?:src|href)="([^"]+)"', self.studio)
        local = [ref for ref in refs if not re.match(r"^(https?:|mailto:|#|data:)", ref)]
        missing = [ref for ref in local if not (STUDIO / ref.split("#")[0].split("?")[0]).exists()]
        self.assertEqual(missing, [])
        self.assertIn('<html lang="en" data-backend="browser">', self.studio, "on a Glow page the studio computes in the browser")
        self.assertIn('<meta name="robots" content="noindex">', self.studio, "search engines list the Glow page, not the frame inside it")

        kit = text_of(SHARED / "glow-harness-kit.js")
        hosts = sorted(set(re.findall(r'url: "(https://[\w.-]+)/', kit)))
        self.assertEqual(hosts, sorted(FREE_MODEL_HOSTS), "the policy lets through exactly the free models Glow's kit calls")
        backend = text_of(STUDIO / "js" / "browser-backend.js")
        self.assertIn("window.GlowHarnessKit", backend, "AI buyers use Glow's own free-model kit")
        self.assertIn('const PROJECTS_DIR = "/glow-founder";', backend)
        self.assertIn("pyodide.FS.filesystems.IDBFS", backend, "projects are kept in this browser")
        studio_app = text_of(STUDIO / "js" / "app.js")
        self.assertIn("if (event.origin !== location.origin || event.source !== window.parent) return;", studio_app)
        self.assertEqual(studio_app.count("postMessage("), studio_app.count("}, location.origin);"), "the studio speaks to its own site only")
        for sent in ("founder-studio:project", "founder-studio:run-start", "founder-studio:run-stopped", "founder-studio:result"):
            self.assertIn(f'"{sent}"', studio_app)
            self.assertIn(f'"{sent}"', self.js)
        for received in ("founder-studio:new", "founder-studio:edit"):
            self.assertIn(f'"{received}"', studio_app)
            self.assertIn(f'"{received}"', self.js)

        # Only the files the browser loads are kept from the Pyodide package. Its package.json lists build tools
        # that are never installed here, and a dependency scanner would report them as this repo's own.
        self.assertFalse((STUDIO / "pyodide" / "package.json").exists(), "no package.json among the published files")
        self.assertEqual(list(FOUNDER.rglob("package.json")) + list(FOUNDER.rglob("package-lock.json")), [])

        bundle = json.loads(text_of(STUDIO / "bundle.json"))
        for name in BUNDLED:
            self.assertIn(name, bundle["files"], f"{name} is what works the numbers out")
        self.assertTrue(any(name.startswith("projects/demo-matcha/") for name in bundle["files"]), "the example project comes with it")
        size = sum(path.stat().st_size for path in FOUNDER.rglob("*") if path.is_file())
        self.assertLess(size, MAX_SITE_MB * 1024 * 1024, "the app stays a download a phone can take")

    def test_translated_in_four_languages(self):
        keys = self.page_keys() | HOME_KEYS
        self.assertGreater(len(keys), 50)
        for key in sorted(keys):
            self.assertEqual(self.locale.count(f'"{key}": '), 4, f"{key} in en, id, zh-CN, zh-TW")
        written = set(re.findall(r'"(founder\.[\w.]+)": ', self.locale))
        self.assertEqual(sorted(written - keys), [], "no GlowFounder words are kept that the page never shows")
        for key in ("founder.result.figure", "founder.result.vs", "founder.ask.chatPrompt", "founder.ask.leadPrompt"):
            english, *others = re.findall(rf'"{re.escape(key)}": "((?:[^"\\]|\\.)*)"', self.locale)
            blanks = sorted(re.findall(r"\{(\w+)\}", english))
            self.assertTrue(blanks, key)
            for sentence in others:
                self.assertEqual(sorted(re.findall(r"\{(\w+)\}", sentence)), blanks, f"{key}: every language fills the same blanks")

    def test_in_glow_apps_menu_and_home(self):
        apps = text_of(SHARED / "glow-apps.js")
        self.assertIn('{ id: "founder", name: "GlowFounder", icon: "🏪"', apps)
        self.assertIn('if (/\\/founder\\//.test(path)) return "founder";', apps)
        self.assertIn('if (/^founder\\//.test(rest)) return "founder";', apps)
        home = text_of(WEB / "index.html")
        self.assertIn('<a class="app-tile founder" id="open-founder" href="./founder/">', home)
        self.assertIn("<b>GlowFounder</b>", home)
        self.assertIn('id="start-founder"', home, "'Test an idea' choice under the start box")
        home_js = text_of(WEB / "home.js")
        self.assertIn('target === "founder"', home_js)
        self.assertIn('["chat", "room", "lead", "news", "spark", "harness", "bot", "founder"]', home_js)
        self.assertIn(".app-tile.founder", text_of(WEB / "home.css"))
        self.assertIn('{ icon: "🏪", name: "GlowFounder", page: "founder/" }', text_of(APP / "bot" / "src" / "chat.js"), "the Telegram bot lists it under /apps")

    def test_hand_offs_are_understood_by_the_other_apps(self):
        self.assertIn('url.searchParams.set("send", "1");', self.js)
        self.assertIn('url.searchParams.set("go", "1");', self.js)
        chat = text_of(WEB / "chat" / "app.js")
        self.assertIn('params.get("send") === "1"', chat, "GlowChat sends a question that arrives with send=1")
        self.assertTrue((WEB / "chat" / "mobile.html").is_file(), "phones are sent to GlowChat's phone page")
        lead = text_of(WEB / "lead" / "lead.js")
        self.assertIn('params.get("goal")', lead)
        self.assertIn('params.get("go") === "1"', lead, "GlowLead starts a goal that arrives with go=1")

    def test_offline_and_versions(self):
        sw = text_of(WEB / "sw.js")
        for asset in OFFLINE_ASSETS:
            self.assertIn(f"'{asset}'", sw)
            on_disk = WEB / asset[2:] / "index.html" if asset.endswith("/") else WEB / asset[2:]
            self.assertTrue(on_disk.exists(), asset)
        self.assertNotIn("'./founder/studio/pyodide", sw, "the 13 MB Python runtime is saved on first use, not with Glow home")
        self.assertNotIn("glowhome-v24", sw, "cache name bumped with the new assets")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f'const GLOW_VERSION = "{published}";', text_of(SHARED / "glow-apps.js"))
        self.assertIn(PAGE_ADDRESS, text_of(WEB / "sitemap.xml"))
        workflow = text_of(REPO / ".github" / "workflows" / "glow.yml")
        self.assertGreaterEqual(workflow.count("apps/glow/tests/test_glow_founder.py"), 2, "runs with the static checks and again with a browser")

    def test_docs_and_portfolio_card(self):
        readme = text_of(APP / "README.md")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f"- **{published}** – ", readme)
        self.assertIn(PAGE_ADDRESS, readme)
        self.assertIn("| **GlowFounder** 🏪 |", readme)
        card = next(app for app in json.loads(text_of(REPO / "scripts" / "apps.json"))["apps"] if app.get("id") == "glow")
        self.assertIn("GlowFounder", card["tags"])
        self.assertIn({"label": "GlowFounder", "path": "glow/founder/"}, card["card_links"])
        self.assertIn("GlowFounder", card["description"])

    def test_honest_about_what_it_is(self):
        for key in ("founder.limits.sim", "founder.limits.quick", "founder.limits.ai", "founder.limits.saved", "founder.limits.size", "founder.limits.english"):
            self.assertIn(f'data-i18n="{key}"', self.html)
        self.assertIn("Simulated buyers are not customers.", self.html)
        self.assertIn("upper bound", self.html)
        self.assertIn("Simulated buyers are not customers", self.studio)


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run browser checks")
class GlowFounderBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = GlowPagesServer()
        cls.playwright = sync_playwright().start()
        # Everything comes from this machine, so a proxy set on it must not be asked.
        cls.browser = launch_browser(cls.playwright, args=["--no-proxy-server"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.pages.close()

    def setUp(self):
        self.page_errors = []
        self.outside = []
        self.dialogs = []

    def open_founder(self, suffix="", viewport=DESKTOP, color_scheme="light", models=None):
        """The page in a fresh profile. Requests that leave this machine are refused and noted, unless
        `models` is given: then it answers them in place of the free AI models."""
        context = self.browser.new_context(viewport=viewport, service_workers="block", color_scheme=color_scheme, locale="en-US")
        self.addCleanup(context.close)
        base = self.pages.base

        def is_outside(url):
            return url.startswith("http") and not url.startswith(base)

        def refuse(route):
            self.outside.append(route.request.url)
            route.abort()

        def note_dialog(dialog):
            self.dialogs.append(dialog.message)
            dialog.dismiss()

        context.route(is_outside, models or refuse)
        page = context.new_page()
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        page.on("dialog", note_dialog)
        page.goto(base + "founder/" + suffix)
        return page

    def studio(self, page):
        return page.frame_locator("#founder-frame")

    def studio_frame(self, page):
        return page.query_selector("#founder-frame").content_frame()

    def wait_ready(self, page):
        page.wait_for_function(STUDIO_READY, timeout=READY_MS)

    def run_panel(self, page):
        """Press Run panel in the studio, skip the walk across the square, wait for the result."""
        self.studio(page).locator("#runBtn").click()
        self.studio(page).locator("#skipBtn").click()
        page.wait_for_function(RUN_DONE, timeout=RUN_MS)

    def text(self, page, selector):
        return (page.text_content(selector) or "").strip()

    def assert_clean(self):
        self.assertEqual(self.page_errors, [], "no script errors")
        self.assertEqual(self.outside, [], "the page asked nobody but itself")
        self.assertEqual(self.dialogs, [], "nothing popped up")

    def test_a_panel_runs_and_gives_one_next_step(self):
        page = self.open_founder()
        self.assertEqual(page.title(), "GlowFounder — test a business idea on simulated buyers")
        self.assertTrue(page.is_visible("#founder-loading"), "while Python loads the page says what it is waiting for")
        self.assertEqual(self.text(page, "#founder-saved"), "Your last panels" + page.evaluate("() => GlowLocale.t('founder.saved.empty')"))
        self.wait_ready(page)
        self.assertEqual(page.evaluate(STATE), {"studio": "ready", "run": "idle", "theme": "light"})
        self.assertFalse(page.is_visible("#founder-loading"))
        steps = page.evaluate(STEPS)
        self.assertEqual([step["title"] for step in steps], ["Describe the idea", "Run the panel", "Take the next step"])
        self.assertEqual([step["status"] for step in steps], ["done", "current", "todo"])
        self.assertEqual(steps[0]["detail"], f"{EXAMPLE} · write your own", "the example idea is loaded and can be swapped")
        self.assertEqual(page.locator(".founder-strip").count(), 0, "no result is shown before a panel has run")

        self.run_panel(page)
        figure = self.text(page, ".founder-figure")
        match = re.fullmatch(rf"(\d+) of {PANEL} would buy \((\d+)% vs (\d+)% target\)", figure)
        self.assertIsNotNone(match, figure)
        buys, rate, target = (int(part) for part in match.groups())
        self.assertEqual(rate, round(buys / PANEL * 100), "the share is the count, as a percentage")
        met = rate >= target
        self.assertIn("good" if met else "bad", page.get_attribute(".founder-strip", "class").split())
        self.assertIn(EXAMPLE, self.text(page, ".founder-meta"))
        self.assertIn("Panel A", self.text(page, ".founder-meta"))
        self.assertTrue(self.text(page, ".founder-next").startswith("Next: "), "one concrete next move")
        steps = page.evaluate(STEPS)
        self.assertEqual([step["status"] for step in steps], ["done", "done", "current"])
        self.assertEqual(steps[1]["detail"], f"{buys} of {PANEL} would buy")
        self.assertIn(f"{buys} of {PANEL} would buy", self.studio(page).locator("#ticker").inner_text(), "the page shows what the studio counted")

        chat = urlsplit(page.get_attribute("#founder-ask-chat", "href"))
        self.assertEqual(chat.path, "/projects/glow/chat/")
        question = parse_qs(chat.query)
        self.assertEqual(question["send"], ["1"])
        self.assertIn(EXAMPLE, question["q"][0])
        self.assertIn(f"{buys} of {PANEL} would buy", question["q"][0])
        self.assertLessEqual(len(question["q"][0]), 2000)
        lead = urlsplit(page.get_attribute("#founder-ask-lead", "href"))
        self.assertEqual(lead.path, "/projects/glow/lead/")
        goal = parse_qs(lead.query)
        self.assertEqual(goal["go"], ["1"])
        self.assertIn(EXAMPLE, goal["goal"][0])
        first = page.locator(".founder-actions a").first.get_attribute("id")
        self.assertEqual(first, "founder-ask-lead" if met else "founder-ask-chat", "the step that fits the result comes first")

        saved = page.evaluate(SAVED)
        self.assertEqual(len(saved), 1)
        self.assertEqual((saved[0]["buys"], saved[0]["n"]), (buys, PANEL))
        self.assertNotIn("pitch", saved[0], "the pitch itself is not kept with the short history")
        self.assertEqual(page.locator(".founder-saved-item").count(), 1)
        self.assertIn(f"{rate}%", self.text(page, ".founder-saved-item"))

        # "Edit pitch" opens the studio's third setup step, "write your own" its first.
        page.click(".founder-next .founder-link")
        self.studio(page).locator("#pitch").wait_for(state="visible")
        opened = "() => ['productSection', 'buyersSection', 'pitchSection'].filter((id) => document.getElementById(id).open)"
        self.assertEqual(self.studio_frame(page).evaluate(opened), ["pitchSection"])
        page.click(".founder-step .founder-link")
        self.studio(page).locator("#business").wait_for(state="visible")
        self.assertEqual(self.studio_frame(page).evaluate(opened), ["productSection"])

        # A reload: the short history is still there, and so is the panel inside the studio's own storage.
        page.reload()
        self.wait_ready(page)
        self.assertEqual(page.evaluate(STATE)["run"], "idle")
        self.assertEqual(page.locator(".founder-saved-item").count(), 1, "the last panels are kept in this browser")
        kept = self.studio_frame(page).evaluate(
            "() => fetch('/api/project?name=demo-matcha&variant=panel-quick').then((reply) => reply.json()).then((data) => (data.answers || []).length)"
        )
        self.assertEqual(kept, PANEL, "the studio kept the panel's answers in this browser")

        # A made-up result from the page itself (not from the studio's frame) changes nothing.
        page.evaluate(FORGED_RESULT)
        self.assertEqual(page.evaluate(STATE)["run"], "idle")
        self.assertEqual(page.locator(".founder-strip").count(), 0)
        self.assertEqual(len(page.evaluate(SAVED)), 1)
        self.assertNotIn("Forged", page.inner_text("main"))

        page.click("#founder-saved-clear")
        self.assertEqual(page.evaluate(SAVED), [])
        self.assertEqual(page.locator(".founder-saved-item").count(), 0)
        self.assert_clean()

    def test_an_idea_from_glow_home_becomes_a_project(self):
        page = self.open_founder("?q=" + IDEA.replace(" ", "%20"))
        self.wait_ready(page)
        page.wait_for_function(
            "(name) => document.querySelector('.founder-step-text > span').textContent.includes(name)",
            arg=IDEA,
            timeout=10000,
        )
        self.assertEqual(page.evaluate("() => location.search"), "", "the idea is taken out of the address once it is in the studio")
        self.assertEqual(self.studio(page).locator("#projectSelect").input_value(), IDEA_SLUG)
        self.assertEqual(self.studio(page).locator("#business").input_value(), IDEA)
        options = self.studio_frame(page).evaluate("() => Array.from(document.querySelectorAll('#projectSelect option')).map((option) => option.value)")
        self.assertIn("demo-matcha", options, "the example is left as it was")
        self.assertEqual(page.locator(".founder-strip").count(), 0)
        self.assert_clean()

    def test_both_themes_and_the_studio_follows(self):
        page = self.open_founder(color_scheme="dark")
        self.assertEqual(page.evaluate(STATE)["theme"], "dark", "follows the device on a first visit")
        self.assertEqual(page.get_attribute('meta[name="theme-color"]', "content"), "#262624")
        inside = "() => document.documentElement.dataset.theme"
        frame = self.studio_frame(page)
        frame.wait_for_function("() => document.documentElement.classList.contains('embedded')", timeout=30000)
        self.assertEqual(frame.evaluate(inside), "dark")
        dark = page.evaluate("() => getComputedStyle(document.body).backgroundColor")
        dark_inside = frame.evaluate("() => getComputedStyle(document.body).backgroundColor")

        page.click("#theme-btn")
        self.assertEqual(page.evaluate(STATE)["theme"], "light")
        self.assertEqual(page.get_attribute('meta[name="theme-color"]', "content"), "#faf9f5")
        self.assertEqual(page.evaluate("() => localStorage.getItem('glow.home.theme')"), "light", "the same choice as Glow home")
        frame.wait_for_function("() => document.documentElement.dataset.theme === 'light'", timeout=5000)
        self.assertNotEqual(page.evaluate("() => getComputedStyle(document.body).backgroundColor"), dark)
        self.assertNotEqual(frame.evaluate("() => getComputedStyle(document.body).backgroundColor"), dark_inside, "the studio changed colour too")

        page.reload()
        self.assertEqual(page.evaluate(STATE)["theme"], "light", "the choice is remembered")
        self.assertEqual(self.page_errors, [])
        self.assertEqual(self.outside, [])

    def test_fits_a_phone_and_every_control_is_big_enough_for_a_thumb(self):
        page = self.open_founder(viewport=PHONE)
        self.wait_ready(page)
        self.run_panel(page)
        chat = urlsplit(page.get_attribute("#founder-ask-chat", "href"))
        self.assertEqual(chat.path, "/projects/glow/chat/mobile.html", "a phone is sent to GlowChat's phone page")
        codes = page.evaluate(LANGUAGE_CODES)
        self.assertEqual(len(codes), 4)
        for width in (PHONE["width"], PHONE_NARROW):
            page.set_viewport_size({"width": width, "height": PHONE["height"]})
            for code in codes:
                page.evaluate("(code) => GlowLocale.save(code, GlowLocale.get().region)", code)
                page.wait_for_function("() => document.querySelector('.founder-step b').textContent.trim() === GlowLocale.t('founder.step1.title')", timeout=10000)
                wide, screen = page.evaluate(WIDTHS)
                self.assertLessEqual(wide, screen, f"{width} px, {code}: nothing is wider than the screen")
                small = [control for control in page.evaluate(CONTROL_SIZES) if control[1] < TAP_SIZE or control[2] < TAP_SIZE]
                self.assertEqual(small, [], f"{width} px, {code}: every control is at least {TAP_SIZE} px each way")
            inner_wide, inner_screen = self.studio_frame(page).evaluate(WIDTHS)
            self.assertLessEqual(inner_wide, inner_screen, f"{width} px: the studio fits its frame")
        self.assert_clean()

    def test_speaks_four_languages(self):
        page = self.open_founder()
        codes = page.evaluate(LANGUAGE_CODES)
        self.assertEqual(len(codes), 4)
        seen = {}
        for code in codes:
            page.evaluate("(code) => GlowLocale.save(code, GlowLocale.get().region)", code)
            page.wait_for_function("() => document.querySelector('.founder-head .spark-lede').textContent.trim() === GlowLocale.t('founder.lede')", timeout=10000)
            words = page.evaluate(WORDS_ON_PAGE)
            self.assertEqual(words["firstStep"], page.evaluate("() => GlowLocale.t('founder.step1.title')"), code)
            self.assertEqual(words["saved"], page.evaluate("() => GlowLocale.t('founder.saved.title')"), code)
            self.assertFalse(re.findall(r"\bfounder\.[a-z]\w*", words["everything"]), f"{code}: no untranslated key is shown")
            self.assertEqual(page.get_attribute("#founder-frame", "title"), page.evaluate("() => GlowLocale.t('founder.frameTitle')"), code)
            seen[code] = (words["lede"], words["firstStep"], words["saved"], words["limits"])
        self.assertEqual(len(set(seen.values())), 4, "each language has its own words")
        for position in range(4):
            self.assertEqual(len({words[position] for words in seen.values()}), 4, "no sentence is left in another language")
        self.assertEqual(self.page_errors, [])
        self.assertEqual(self.outside, [])

    def test_ai_buyers_are_answered_by_the_free_models_with_failover(self):
        calls = {}

        def models(route):
            request = route.request
            host = urlsplit(request.url).netloc
            if request.method == "OPTIONS":
                route.fulfill(status=204, headers=CORS)
                return
            calls.setdefault(host, []).append(json.loads(request.post_data or "{}"))
            if host == "text.pollinations.ai":
                # Up, but not answering the question: the next service has to be asked.
                reply = {"choices": [{"message": {"role": "assistant", "content": "I would rather talk about tea."}}]}
            elif host == "oai.endpoints.kepler.ai.cloud.ovh.net":
                reply = {"choices": [{"message": {"role": "assistant", "content": "Here you go:\n" + BUYER_REPLY}}]}
            else:
                self.outside.append(request.url)
                route.abort()
                return
            route.fulfill(status=200, headers=CORS, content_type="application/json", body=json.dumps(reply))

        page = self.open_founder(models=models)
        self.wait_ready(page)
        self.studio(page).locator('[data-mode="ai"]').click()
        self.run_panel(page)
        self.assertEqual(self.text(page, ".founder-figure b"), f"{PANEL} of {PANEL} would buy", "every made-up buyer said yes")
        self.assertIn("good", page.get_attribute(".founder-strip", "class").split())
        self.assertIn("AI", self.text(page, ".founder-meta"), "the result says the buyers were AI")
        self.assertIn("It meets your target.", self.text(page, ".founder-next"))
        self.assertEqual(page.locator(".founder-actions a").first.get_attribute("id"), "founder-ask-lead")

        answered = calls.get("oai.endpoints.kepler.ai.cloud.ovh.net", [])
        self.assertEqual(len(answered), PANEL, "one question for each buyer")
        skipped = calls.get("text.pollinations.ai", [])
        self.assertGreaterEqual(len(skipped), 1, "the first service was asked, and its useless reply was passed over")
        self.assertLess(len(skipped), PANEL, "after that the service that answers is asked first")
        for body in answered:
            self.assertEqual([message["role"] for message in body["messages"]], ["system", "user"])
            self.assertIn("simulated buyer", body["messages"][0]["content"])
        briefs = {body["messages"][1]["content"] for body in answered}
        self.assertEqual(len(briefs), PANEL, "each buyer gets a brief of their own")
        self.assertEqual(sorted(set(calls) - {"text.pollinations.ai", "oai.endpoints.kepler.ai.cloud.ovh.net"}), [])
        self.assert_clean()


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
