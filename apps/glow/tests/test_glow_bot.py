"""GlowBot page checks: the Glow page that explains and connects the Telegram bot.

GlowBot is the Glow AI team inside Telegram. Its page lives in apps/glow/web/bot/
and talks to one small server, the glow-bot Cloudflare Worker. These checks never
touch the real server: every answer is a made-up one handed to the page by the
test, so they run offline and say the same thing every time.

Static checks read the files. Browser checks open the page with a pretend bot
server and look at what a person would see: the way into Telegram, the one-time
setup step, the self-test, what the bot can reach, phone widths, both themes, the
four languages and the floating assistant button.

Run from the repo root:  python -X utf8 apps/glow/tests/test_glow_bot.py
"""

import json
import re
import sys
import time
import unittest
from pathlib import Path
from urllib.parse import urlsplit

TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS))

from test_glow_offline import HAVE_PLAYWRIGHT, GlowPagesServer, launch_browser  # noqa: E402

if HAVE_PLAYWRIGHT:
    from playwright.sync_api import sync_playwright

APP = TESTS.parent
WEB = APP / "web"
BOT = WEB / "bot"
SHARED = WEB / "shared"
REPO = APP.parent.parent
WORKER_DIR = APP / "bot"

WORKER = "https://glow-bot.juw12.workers.dev"
PAGE_ADDRESS = "https://juw12.github.io/projects/glow/bot/"
PAGE_SCRIPTS = ["../shared/glow-locale.js", "../shared/glow-apps.js", "./bot.js"]
OFFLINE_ASSETS = ["./bot/", "./bot/bot.css", "./bot/bot.js"]
OUTSIDE_HOSTS = {"glow-bot.juw12.workers.dev", "juw12.github.io", "t.me"}
# The page's whole Content-Security-Policy, rule by rule. Loosening any part has to be done here on purpose.
CSP = {
    "default-src": "'self'",
    "script-src": "'self'",
    "worker-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data:",
    "connect-src": f"'self' {WORKER}",
}
# Ways to turn text into markup, and places besides localStorage where a value could be left behind.
MARKUP_WRITERS = ("innerHTML", "outerHTML", "insertAdjacentHTML", "createContextualFragment", "DOMParser", "srcdoc")
OTHER_STORES = ("sessionStorage", "document.cookie", "indexedDB", "caches.")
COMMANDS = [
    "lead", "room", "ask", "agents", "chat", "new", "agent", "news", "spark",
    "apps", "daily", "every", "missions", "status", "models", "stop", "lang", "help", "myid",
    "access", "allow", "deny", "users",
]
# Second names for a command that is on the page: the bot answers them, the page lists the first name.
ALIASES = {"harness": "agent", "reset": "new", "search": "room", "mission": "lead"}
# Every line of bot.js that touches the setup code. A new use has to be looked at and added here.
SETUP_CODE_USES = [
    'let setupCode = "";',
    "setupCode = hashMatch[1];",
    'setup: { phase: setupCode ? "form" : "hidden", error: "", errorText: "", detail: "", result: null },',
    'if (!setupCode || state.setup.phase === "sending" || state.setup.phase === "done") return;',
    "body: JSON.stringify({ code: setupCode, token }),",
    'setupCode = ""; // not needed again on this visit',
]

PHONE = {"width": 320, "height": 640}
PHONE_TALL = {"width": 390, "height": 844}
DESKTOP = {"width": 1100, "height": 900}
TABLET = {"width": 740, "height": 700}  # wider than the 720 px up to which the assistant opens over its own button

# Made-up values. The token is put together at run time, so no token-shaped text sits in the repo.
CODE = "test-setup-code-0123456789abcdef"
TOKEN = "123456789:" + "Ab3_" * 9
BOT_NAME = "GlowTest_bot"
SERVER_VERSION = "9.8.7"
BUILD = "abcdef012345"
AT = int(time.time() * 1000) - 5 * 60 * 1000
LONG = "x" * 300
SHOWN_LIMIT = 220  # text that comes from outside is shown cut to this many characters
PLAIN_LINK = f"https://t.me/{BOT_NAME}"
CLAIM_LINK = f"{PLAIN_LINK}?start=claim_0123456789"
HOSTILE_NAME = "<img src=x onerror=alert(1)>"
CHECK_NAMES = ["mission", "room", "chat", "agent", "stop", "languages"]
PROBE_GROUPS = ["keyless", "ai", "search", "read", "pages", "extras"]

FORMAT_SENTENCE = "That does not look like a bot token. It is a number, a colon, then a long run of letters and digits."
NETWORK_SENTENCE = "Could not reach the bot server. Check your connection and try again."

SETTLED = """() => {
  const data = document.documentElement.dataset;
  return [data.botStatus, data.botSelftest, data.botProbe].every((value) => value && value !== "loading");
}"""
STATE = """() => {
  const data = document.documentElement.dataset;
  return { status: data.botStatus, setup: data.botSetup, selftest: data.botSelftest, probe: data.botProbe, theme: data.theme };
}"""
LEFTOVERS = """() => ({
  hash: location.hash,
  href: location.href,
  html: document.documentElement.outerHTML,
  local: JSON.stringify(Object.entries(localStorage)),
  session: JSON.stringify(Object.entries(sessionStorage)),
  cookie: document.cookie,
})"""
WIDTHS = "() => [document.documentElement.scrollWidth, window.innerWidth]"
COLOURS = """() => [
  getComputedStyle(document.documentElement).backgroundColor,
  getComputedStyle(document.body).backgroundColor,
  getComputedStyle(document.body).color,
].join(" | ")"""
LANGUAGE_CODES = """() => GlowLocale.languages.map((entry) => (typeof entry === "string" ? entry : entry.code))"""
WORDS_ON_PAGE = """() => {
  const words = (selector) => (document.querySelector(selector).textContent || "").trim();
  return {
    lang: document.documentElement.lang,
    title: words("#status-title"),
    status: words("#status-text"),
    open: words("#open-telegram"),
    access: words("#status-access"),
    test: words("#test-result"),
    firstCheck: words("#test-list li b"),
    firstGroup: words("#probe-rows .probe-group h3"),
    firstTile: words("#probe-stats .stat span"),
  };
}"""

# The floating Glow assistant button. On a phone the one thing to press it can come to rest on is this fold.
FOLD = "#probe-details > summary"
COVER_LIMIT = 0.2  # the button steps aside once it shares a fifth of the smaller of the two outlines
BUBBLE_WAIT_S = 10
# Scrolls a control under the button as far as the page allows and returns the rectangle the two then share.
UNDER_BUBBLE = """
async (selector) => {
  const bubble = document.querySelector(".glow-widget-bubble");
  const control = document.querySelector(selector);
  const crown = bubble.getBoundingClientRect();
  const box = control.getBoundingClientRect();
  const last = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const wanted = window.scrollY + box.top + box.height / 2 - (crown.top + crown.height / 2);
  window.scrollTo({ top: Math.max(0, Math.min(last, Math.round(wanted))), left: 0, behavior: "instant" });
  for (let frame = 0; frame < 3; frame += 1) await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const now = control.getBoundingClientRect();
  const left = Math.max(now.left, crown.left);
  const right = Math.min(now.right, crown.right);
  const top = Math.max(now.top, crown.top);
  const bottom = Math.min(now.bottom, crown.bottom);
  const wide = Math.max(0, right - left);
  const high = Math.max(0, bottom - top);
  const smaller = Math.min(now.width * now.height, crown.width * crown.height);
  return { x: (left + right) / 2, y: (top + bottom) / 2, share: smaller > 0 ? (wide * high) / smaller : 0 };
}
"""
BACK_TO_TOP = """
async () => {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  for (let frame = 0; frame < 3; frame += 1) await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
"""
BUBBLE_STATE = """
() => {
  const bubble = document.querySelector(".glow-widget-bubble");
  const style = getComputedStyle(bubble);
  return {
    aside: document.documentElement.classList.contains("crown-aside"),
    seeThrough: style.opacity === "0" && style.pointerEvents === "none",
    shown: style.opacity === "1" && style.pointerEvents !== "none",
    focused: document.activeElement === bubble,
    open: bubble.getAttribute("aria-expanded") === "true",
  };
}
"""
# Focuses the control just before the button in the tab order (so that one Tab lands on it) and names it.
FOCUS_BEFORE_BUBBLE = """
() => {
  const bubble = document.querySelector(".glow-widget-bubble");
  const tabbable = Array.from(document.querySelectorAll("a[href], button, input, select, textarea, summary, [tabindex]")).filter(
    (element) =>
      !element.disabled &&
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden"
  );
  const before = tabbable[tabbable.indexOf(bubble) - 1];
  if (!before) return "";
  before.focus();
  return before.tagName.toLowerCase() + (before.id ? "#" + before.id : "");
}
"""
DROP_FOCUS = "() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); }"
POINT_IS_ON = """
([selector, x, y]) => {
  const hit = document.elementFromPoint(x, y);
  return !!hit && document.querySelector(selector).contains(hit);
}
"""
LIST_IS_OPEN = "() => document.querySelector('#probe-details').open"
# A blank page that stands in for GlowLead inside the assistant's frame. GlowLead has its own tests.
ASSISTANT_STUB = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>assistant stand-in</title></head><body></body></html>'
ASSISTANT_LOADED = """
() => {
  const frame = document.querySelector(".glow-widget-panel iframe");
  return !!frame && !!frame.contentDocument && frame.contentDocument.title === "assistant stand-in";
}
"""
# The colour a person sees in the status light beside the page's first line: "green", "amber" or "red".
LIGHT = """
() => {
  const dot = document.querySelector("#bot-meta > span.dot");
  if (!dot || dot.getBoundingClientRect().width === 0) return "missing";
  const parts = (getComputedStyle(dot).backgroundColor.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
  if (parts.length < 3) return "other";
  const [red, green, blue] = parts;
  if (green > red && green > blue) return "green";
  if (red > 2 * green && red > 2 * blue) return "red";
  if (red > green && green > blue) return "amber";
  return "other";
}
"""


def text_of(path):
    return path.read_text(encoding="utf-8")


def status_answer(**changes):
    body = {
        "ok": True,
        "service": "glow-bot",
        "version": SERVER_VERSION,
        "build": BUILD,
        "stage": "bot",
        "configured": True,
        "bot": {"username": BOT_NAME, "name": "Glow Test"},
        "access": "private",
        "claimed": True,
        "ai": True,
        "colo": "SIN",
    }
    body.update(changes)
    return 200, body


def selftest_answer(failed=(), error="", detail=""):
    checks = []
    for name in CHECK_NAMES:
        bad = name in failed
        checks.append({"name": name, "ok": not bad, "detail": (detail or f"{name} went wrong") if bad else ""})
    result = {
        "ok": not failed and not error,
        "kind": "logic",
        "note": "scripted models",
        "checks": [] if error else checks,
        "at": AT,
        "ms": 1234,
        "version": SERVER_VERSION,
        "build": BUILD,
    }
    if error:
        result["error"] = error
    return 200, {"running": False, "result": result}


def probe_answer():
    """Twelve tests in six groups: eight worked, four did not. Two rows carry text with no place to break."""
    result = {
        "at": AT,
        "ms": 42000,
        "version": SERVER_VERSION,
        "build": BUILD,
        "providers": [
            {"id": "ovh", "model": "Meta-Llama-3_3-70B-Instruct", "ok": True, "status": 200, "ms": 444, "sample": "pong", "error": ""},
            {"id": "llm7", "model": "gpt-4.1-nano", "ok": False, "status": 429, "ms": 300, "sample": "", "error": "HTTP 429 " + LONG},
        ],
        "ai": [
            {"id": "ai-gpt-oss-120b", "model": "@cf/openai/gpt-oss-120b", "ok": True, "ms": 1182, "sample": "pong", "error": ""},
        ],
        "web": [
            {"id": "search:bing-rss", "ok": True, "status": 200, "ms": 410, "detail": "8 results"},
            {"id": "search:wikipedia", "ok": True, "status": 200, "ms": 220, "detail": "5 results"},
            {"id": "search:duckduckgo-direct", "ok": False, "status": 522, "ms": 9000, "detail": "HTTP 522"},
            {"id": "read:direct", "ok": True, "status": 200, "ms": 130, "detail": "1256 characters"},
            {"id": "read:jina", "ok": False, "status": 429, "ms": 66, "detail": "HTTP 429"},
        ],
        "news": {"ok": True, "stories": 60, "error": ""},
        "spark": {"ok": True, "loadMs": 180, "tokens": 63, "sample": "Once upon a time", "error": ""},
        "pages": [
            {"url": "https://example.com/", "ok": True, "via": "direct", "chars": 1256, "ms": 300},
            {"url": "https://shop.example/" + LONG, "ok": False, "ms": 800, "error": "HTTP 403"},
        ],
    }
    return 200, {"running": False, "result": result}


def setup_answer(claimed=False, link=CLAIM_LINK, warnings=(), username=BOT_NAME):
    body = {
        "ok": True,
        "bot": {"username": username, "name": "Glow Test"},
        "link": link,
        "claimed": claimed,
        "warnings": list(warnings),
    }
    return 200, body


class FakeWorker:
    """A pretend bot server. Each address has one answer, and a test can swap it at any time.

    An answer is (HTTP status, body). A dict body is sent as JSON, a text body as a web page
    (what Cloudflare itself sends when a Worker is down). None means the server cannot be reached.
    """

    def __init__(self):
        self.answers = {
            "/v1/status": status_answer(),
            "/v1/selftest": selftest_answer(),
            "/v1/probe": probe_answer(),
            "/setup": setup_answer(),
        }
        self.requests = []

    def handle(self, route):
        request = route.request
        path = urlsplit(request.url).path
        self.requests.append({"method": request.method, "url": request.url, "path": path, "body": request.post_data})
        if request.method == "OPTIONS":
            route.fulfill(
                status=204,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
            )
            return
        answer = self.answers.get(path)
        if answer is None:
            route.abort()
            return
        status, body = answer
        if isinstance(body, str):
            route.fulfill(status=status, content_type="text/html", headers={"Access-Control-Allow-Origin": "*"}, body=body)
            return
        route.fulfill(
            status=status,
            content_type="application/json",
            headers={"Access-Control-Allow-Origin": "*"},
            body=json.dumps(body),
        )

    def sent(self, path, method="GET"):
        return [request for request in self.requests if request["path"] == path and request["method"] == method]


class GlowBotStaticTests(unittest.TestCase):
    def setUp(self):
        self.html = text_of(BOT / "index.html")
        self.js = text_of(BOT / "bot.js")
        self.locale = text_of(SHARED / "glow-locale.js")

    def page_keys(self):
        keys = set(re.findall(r'data-i18n(?:-placeholder|-title)?="([\w.]+)"', self.html))
        keys |= set(re.findall(r'"(bot\.[\w.]+)"', self.js))
        return keys

    def test_page_follows_glow_rules(self):
        self.assertEqual(self.html.count("Content-Security-Policy"), 1, "one policy, written once")
        written = re.findall(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">', self.html)
        self.assertEqual(len(written), 1, "the policy is a meta tag in the page's head")
        governed = re.search(r"<(?:link|script|style|img|iframe)\b", self.html)
        self.assertLess(self.html.index("Content-Security-Policy"), governed.start(), "the policy comes before everything it governs")
        policy = {}
        for rule in filter(None, (part.strip() for part in written[0].split(";"))):
            name, _, sources = rule.partition(" ")
            self.assertNotIn(name, policy, f"{name} is written once (a browser obeys only the first of two)")
            policy[name] = " ".join(sources.split())
        self.assertEqual(policy, CSP, "the page runs its own scripts and reaches its own bot server, and nothing else")
        self.assertFalse(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", self.html), "no inline scripts (CSP)")
        self.assertFalse(re.findall(r"<[^>]*\son[a-z]+=", self.html), "no inline event handlers (CSP)")
        self.assertNotIn("<form", self.html, "no form, so the browser never offers to send or remember the token itself")
        refs = re.findall(r'(?:src|href)="([^"]+)"', self.html)
        local = [ref for ref in refs if not re.match(r"^(https?:|mailto:|#|data:)", ref)]
        missing = [ref for ref in local if not (BOT / ref.split("#")[0].split("?")[0]).exists()]
        self.assertEqual(missing, [])
        self.assertEqual(re.findall(r'<script[^>]*\bsrc="([^"]+)"', self.html), PAGE_SCRIPTS, "words, then the apps menu, then the page")
        used_ids = set(re.findall(r'\$\("([\w-]+)"\)', self.js))
        html_ids = set(re.findall(r'id="([\w-]+)"', self.html))
        self.assertEqual(sorted(used_ids - html_ids), [], "every element bot.js uses exists")

    def test_page_is_self_contained(self):
        for evaluates in ("eval(", "new Function", "document.write"):
            self.assertNotIn(evaluates, self.js, "bot.js never runs text as code")
        for writer in MARKUP_WRITERS:
            self.assertNotIn(writer, self.js, "what the server says is shown as text, never as markup")
        self.assertFalse(re.search(r"\brequire\(|^\s*import\s", self.js, re.M), "bot.js pulls in no package")
        outside = set(re.findall(r"https?://([\w.-]+)", self.html + self.js))
        self.assertEqual(outside, OUTSIDE_HOSTS, "the bot server, Telegram links and Glow's own address, nothing else")
        self.assertEqual(set(re.findall(r"https?://[\w.-]+", self.js)), {WORKER, "https://t.me"})

    def test_translated_in_four_languages(self):
        keys = self.page_keys() | {"apps.bot", "home.tile.bot", "home.pill.bot"}
        self.assertGreater(len(keys), 100)
        for key in sorted(keys):
            self.assertEqual(self.locale.count(f'"{key}": '), 4, f"{key} in en, id, zh-CN, zh-TW")
        written = set(re.findall(r'"(bot\.[\w.]+)": ', self.locale))
        self.assertEqual(sorted(written - keys), [], "no GlowBot words are kept that the page never shows")

    def test_in_glow_apps_menu_and_home(self):
        apps = text_of(SHARED / "glow-apps.js")
        self.assertIn('{ id: "bot", name: "GlowBot"', apps)
        self.assertIn('if (/\\/bot\\//.test(path)) return "bot";', apps)
        self.assertIn('if (/^bot\\//.test(rest)) return "bot";', apps)
        home = text_of(WEB / "index.html")
        self.assertIn('<a class="app-tile bot" id="open-bot" href="./bot/">', home)
        self.assertIn("<b>GlowBot</b>", home)
        self.assertIn('id="start-bot"', home, "'Telegram' choice under the start box")
        home_js = text_of(WEB / "home.js")
        self.assertIn('target === "bot"', home_js)
        self.assertIn('["chat", "room", "lead", "news", "spark", "harness", "bot"]', home_js)
        self.assertIn(".app-tile.bot", text_of(WEB / "home.css"))

    def test_offline_and_versions(self):
        sw = text_of(WEB / "sw.js")
        for asset in OFFLINE_ASSETS:
            self.assertIn(f"'{asset}'", sw)
            on_disk = WEB / asset[2:] / "index.html" if asset.endswith("/") else WEB / asset[2:]
            self.assertTrue(on_disk.exists(), asset)
        self.assertNotIn("glowhome-v19", sw, "cache name bumped with the new assets")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f'const GLOW_VERSION = "{published}";', text_of(SHARED / "glow-apps.js"))
        self.assertIn(PAGE_ADDRESS, text_of(WEB / "sitemap.xml"))
        workflow = text_of(REPO / ".github" / "workflows" / "glow.yml")
        self.assertGreaterEqual(workflow.count("apps/glow/tests/test_glow_bot.py"), 2, "runs with the static checks and again with a browser")

    def test_docs_and_portfolio_card(self):
        readme = text_of(APP / "README.md")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f"- **{published}** – ", readme)
        self.assertIn(PAGE_ADDRESS, readme)
        guide = text_of(WORKER_DIR / "README.md")
        for command in COMMANDS:
            self.assertIn(f"`/{command}`", guide, f"/{command} is explained in the bot's own README")
        self.assertIn("tools/check_live.js", guide, "how a deploy is checked is written down")
        self.assertIn("test_glow_bot.py", guide, "where the page's checks live is written down")
        deploy = text_of(REPO / ".github" / "workflows" / "glow-bot-worker.yml")
        self.assertIn("node tools/check_live.js", deploy, "a deploy only counts when the live bot passes its own self-test")
        card = next(app for app in json.loads(text_of(REPO / "scripts" / "apps.json"))["apps"] if app["id"] == "glow")
        self.assertIn("GlowBot", card["tags"])
        self.assertIn({"label": "GlowBot", "path": "glow/bot/"}, card["card_links"])

    def test_page_lists_exactly_the_commands_the_bot_answers(self):
        self.assertEqual(re.findall(r"<dt><code>/(\w+)</code></dt>", self.html), COMMANDS)
        for command in COMMANDS:
            self.assertIn(f'data-i18n="bot.cmd.{command}"', self.html, f"/{command} is explained in every language")
        chat = text_of(WORKER_DIR / "src" / "chat.js")
        handler = chat.split("async onCommand(", 1)[1].split("\n  async ", 1)[0]
        answered = set(re.findall(r'case "(\w+)":', handler))
        for alias, command in ALIASES.items():
            self.assertIn(alias, answered, f"/{alias} is still answered")
            self.assertIn(command, COMMANDS, f"/{alias} is another name for /{command}, which is on the page")
            self.assertRegex(
                handler,
                rf'case "{alias}":\s*(?:case "\w+":\s*)*case "{command}":|case "{command}":\s*(?:case "\w+":\s*)*case "{alias}":',
                f"/{alias} is answered in the same branch as /{command}",
            )
        self.assertEqual(
            answered - {"start"} - set(ALIASES),
            set(COMMANDS),
            "/start is Telegram's own first message; apart from it and the second names in ALIASES, "
            "every command the bot answers is on the page",
        )

    def test_the_bot_opens_every_app_in_the_glow_menu(self):
        menu_block = text_of(SHARED / "glow-apps.js").split("const APPS = [", 1)[1].split("\n  ];", 1)[0]
        menu = re.findall(r'\{ id: "\w+", name: "([^"]+)", icon: "([^"]+)", desc: "[^"]*", page: ([^}]+?) \}', menu_block)
        self.assertEqual(len(menu), menu_block.count("{ id:"), "every line of the Glow apps menu is read")
        self.assertGreaterEqual(len(menu), 9, "the menu had nine apps when this check was written")
        links_block = text_of(WORKER_DIR / "src" / "chat.js").split("export const APP_LINKS = [", 1)[1].split("\n];", 1)[0]
        links = re.findall(r'\{ icon: "([^"]+)", name: "([^"]+)", page: "([^"]*)" \}', links_block)
        self.assertEqual(len(links), links_block.count("{ icon:"), "every line of the bot's app list is read")
        expected = []
        for name, icon, page in menu:
            pages = re.findall(r'"([^"]*)"', page)
            phone_pages = [candidate for candidate in pages if candidate.endswith("mobile.html")]
            expected.append((icon, name, phone_pages[0] if phone_pages else pages[0]))
        self.assertEqual(
            links,
            expected,
            "/apps in Telegram offers the Glow apps menu, in its order, with the phone page where an app has one: "
            "add the new app to APP_LINKS in apps/glow/bot/src/chat.js",
        )

    def test_setup_code_never_rests_anywhere(self):
        for store in OTHER_STORES:
            self.assertNotIn(store, self.js, "localStorage is the only place this page keeps anything")
        self.assertNotIn("console.", self.js, "nothing is written to the browser log")
        saved = re.findall(r"localStorage\.setItem\(([^,]+),", self.js)
        self.assertEqual(saved, ["HOME_THEME_KEY"], "light or dark is the only thing this page saves")
        mentions = len(re.findall(r"\blocalStorage\b", self.js))
        plain_calls = len(re.findall(r"\blocalStorage\.(?:getItem|setItem)\(", self.js))
        self.assertEqual(mentions, plain_calls, "localStorage is only read with getItem and written with that one setItem")
        uses = [line.strip() for line in self.js.splitlines() if "setupCode" in line]
        self.assertEqual(uses, SETUP_CODE_USES, "read from the link, sent once in the request body, then dropped")
        self.assertIn("history.replaceState", self.js, "the setup code is taken out of the address bar")

    def test_bot_picture_is_a_small_real_jpeg(self):
        picture = (BOT / "logo.jpg").read_bytes()
        self.assertEqual(picture[:3], b"\xff\xd8\xff", "a JPEG, the format Telegram takes for a profile photo")
        self.assertLess(len(picture), 200_000)
        self.assertIn("/bot/logo.jpg", text_of(WORKER_DIR / "src" / "registry.js"), "the bot server hands this picture to Telegram at setup")


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run browser checks")
class GlowBotBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pages = GlowPagesServer()
        cls.playwright = sync_playwright().start()
        cls.browser = launch_browser(cls.playwright)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.pages.close()

    def setUp(self):
        self.page_errors = []
        self.outside = []
        self.dialogs = []
        self.fetched = []

    def open_bot(self, worker, suffix="", viewport=DESKTOP, color_scheme="light", clock=False):
        context = self.browser.new_context(viewport=viewport, service_workers="block", color_scheme=color_scheme, locale="en-US")
        self.addCleanup(context.close)
        base = self.pages.base

        def is_outside(url):
            return url.startswith("http") and not url.startswith(base) and not url.startswith(WORKER + "/")

        def refuse(route):
            self.outside.append(route.request.url)
            route.abort()

        def note_dialog(dialog):
            self.dialogs.append(dialog.message)
            dialog.dismiss()

        context.route(is_outside, refuse)
        context.route(re.compile(r"^https://glow-bot\.juw12\.workers\.dev/"), worker.handle)
        page = context.new_page()
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        page.on("dialog", note_dialog)
        page.on("request", lambda request: self.fetched.append((request.resource_type, request.url)))
        if clock and hasattr(page, "clock"):
            page.clock.install()
        page.goto(base + "bot/" + suffix)
        return page

    def settle(self, page):
        page.wait_for_function(SETTLED, timeout=10000)

    def state(self, page):
        return page.evaluate(STATE)

    def wait_for(self, page, name, value, timeout=10000):
        page.wait_for_function(
            "([name, value]) => document.documentElement.dataset[name] === value",
            arg=[name, value],
            timeout=timeout,
        )

    def wait_text(self, page, selector, fragment, timeout=10000):
        page.wait_for_function(
            "([selector, fragment]) => (document.querySelector(selector).textContent || '').includes(fragment)",
            arg=[selector, fragment],
            timeout=timeout,
        )

    def text(self, page, selector):
        return (page.text_content(selector) or "").strip()

    def words(self, page, key, **values):
        sentence = page.evaluate("(key) => GlowLocale.t(key)", key)
        for name, value in values.items():
            sentence = sentence.replace("{" + name + "}", str(value))
        return sentence

    def assert_cut_short(self, page, selector, message):
        """Text from outside is never shown whole: it is cut to SHOWN_LIMIT characters, the last one an ellipsis."""
        shown = self.text(page, selector)
        self.assertEqual((len(shown), shown[-1:]), (SHOWN_LIMIT, "…"), f"{message}: {len(shown)} characters shown")

    def assert_clean(self):
        self.assertEqual(self.page_errors, [], "no script errors")
        self.assertEqual(self.outside, [], "the page asked nobody but itself and its own bot server")
        self.assertEqual(self.dialogs, [], "nothing popped up")

    def test_a_live_bot_shows_the_way_into_telegram(self):
        worker = FakeWorker()
        page = self.open_bot(worker)
        self.settle(page)
        self.assertEqual(
            self.state(page),
            {"status": "ready", "setup": "hidden", "selftest": "pass", "probe": "ready", "theme": "light"},
        )
        self.assertTrue(page.is_visible("#open-telegram"))
        self.assertEqual(page.get_attribute("#open-telegram", "href"), PLAIN_LINK)
        self.assertEqual(self.text(page, "#open-telegram"), f"Open @{BOT_NAME} in Telegram")
        self.assertEqual(self.text(page, "#bot-meta"), f"Live on Telegram as @{BOT_NAME} · version {SERVER_VERSION}")
        self.assertEqual(page.evaluate(LIGHT), "green", "a live bot shows a green light")
        self.assertEqual(self.text(page, "#status-text"), "The bot is live. Open it, press Start, then type a goal.")
        self.assertEqual(
            self.text(page, "#status-access"),
            "Private: only its owner, and the groups the owner adds it to, can use it.",
        )
        self.assertFalse(page.is_visible("#status-retry"))
        self.assertFalse(page.is_visible("#setup-card"), "the setup step is only for the owner's private link")
        asked = sorted((request["method"], request["path"]) for request in worker.requests)
        self.assertEqual(asked, [("GET", "/v1/probe"), ("GET", "/v1/selftest"), ("GET", "/v1/status")], "it reads three things and sends nothing")
        self.assertTrue(all(request["body"] is None for request in worker.requests))

        worker.answers["/v1/status"] = status_answer(access="public")
        page.reload()
        self.settle(page)
        self.assertEqual(self.text(page, "#status-access"), "Public: anyone can use it, with a daily limit per chat.")
        self.assert_clean()

    def test_no_way_in_is_offered_until_the_bot_is_really_ready(self):
        cases = [
            ("nobody owns it yet", "unclaimed", status_answer(claimed=False)),
            ("no bot connected", "unconfigured", status_answer(configured=False, bot=None, claimed=False)),
            ("a name that is not a Telegram name", "unconfigured", status_answer(bot={"username": HOSTILE_NAME, "name": HOSTILE_NAME}, version=HOSTILE_NAME)),
            ("a name that is too short", "unconfigured", status_answer(bot={"username": "ab", "name": "x"})),
        ]
        for label, expected, answer in cases:
            with self.subTest(label):
                worker = FakeWorker()
                worker.answers["/v1/status"] = answer
                page = self.open_bot(worker)
                self.settle(page)
                self.assertEqual(self.state(page)["status"], expected)
                self.assertFalse(page.is_visible("#open-telegram"))
                self.assertIsNone(page.get_attribute("#open-telegram", "href"))
                self.assertEqual(self.text(page, "#open-telegram"), "")
                self.assertEqual(self.text(page, "#status-access"), "")
                self.assertFalse(page.is_visible("#status-retry"))
                self.assertEqual(self.text(page, "#status-text"), self.words(page, f"bot.status.{expected}"))
                self.assertEqual(page.locator("#bot-meta > span.dot[aria-hidden='true']:empty").count(), 1, "the status light sits beside the words")
                self.assertEqual(page.evaluate(LIGHT), "amber", "not ready yet is amber: neither the green of live nor the red of unreachable")
                self.assertEqual(page.locator("#bot-meta *, #status-text *").count(), 1, "server text is shown as text, never as markup")
                page.close()
        self.assert_clean()

    def test_an_unreachable_server_is_said_plainly_and_can_be_retried(self):
        reads = ("/v1/status", "/v1/selftest", "/v1/probe")
        breakages = [
            ("no connection", None),
            ("the server answers with an error", (500, {"ok": False, "error": "boom"})),
            ("Cloudflare's own error page", (502, "<html><body>Bad gateway</body></html>")),
        ]
        for label, broken in breakages:
            with self.subTest(label):
                worker = FakeWorker()
                for path in reads:
                    worker.answers[path] = broken
                page = self.open_bot(worker)
                self.settle(page)
                state = self.state(page)
                self.assertEqual((state["status"], state["selftest"], state["probe"]), ("offline", "offline", "offline"))
                self.assertEqual(self.text(page, "#bot-meta"), "Cannot reach the bot server right now")
                self.assertEqual(page.evaluate(LIGHT), "red", "an unreachable server shows a red light")
                self.assertEqual(self.text(page, "#status-text"), "Cannot reach the bot server. Check your connection, then try again.")
                self.assertEqual(self.text(page, "#test-result"), "Could not read the result.")
                self.assertEqual(self.text(page, "#probe-result"), "Could not read the results.")
                self.assertTrue(page.is_visible("#status-retry"))
                self.assertFalse(page.is_visible("#open-telegram"))
                self.assertFalse(page.is_visible("#probe-details"))

                healthy = FakeWorker()
                for path in reads:
                    worker.answers[path] = healthy.answers[path]
                before = len(worker.requests)
                page.click("#status-retry")
                self.wait_for(page, "botStatus", "ready")
                self.wait_for(page, "botSelftest", "pass")
                self.wait_for(page, "botProbe", "ready")
                self.assertEqual({request["path"] for request in worker.requests[before:]}, set(reads), "Try again reads all three once more")
                self.assertFalse(page.is_visible("#status-retry"))
                self.assertTrue(page.is_visible("#open-telegram"))
                self.assertEqual(page.evaluate(LIGHT), "green", "and the light turns green once the server answers again")
                page.close()
        self.assert_clean()

    def test_the_self_test_is_shown_check_by_check(self):
        worker = FakeWorker()
        page = self.open_bot(worker)
        self.settle(page)
        self.assertEqual(self.state(page)["selftest"], "pass")
        self.assertIn("pass", page.get_attribute("#test-result", "class") or "")
        self.assertTrue(self.text(page, "#test-result").startswith("All 6 checks passed · "), self.text(page, "#test-result"))
        self.assertEqual(page.locator("#test-list li").count(), 6)
        self.assertEqual(page.locator('#test-list li.pass span.mark[role="img"][aria-label="Passed"]').count(), 6)
        titles = page.locator("#test-list li b").all_text_contents()
        self.assertEqual(titles, [self.words(page, f"bot.test.check.{name}") for name in CHECK_NAMES])
        self.assertEqual(titles[0], "A whole mission: plan, wait for Run, delegate, check, report")

        worker.answers["/v1/selftest"] = selftest_answer(failed=("room", "stop"))
        page.click("#test-again")
        self.wait_for(page, "botSelftest", "fail")
        self.assertIn("fail", page.get_attribute("#test-result", "class") or "")
        self.assertTrue(self.text(page, "#test-result").startswith("2 of 6 checks failed · "), self.text(page, "#test-result"))
        self.assertEqual(page.locator("#test-list li.pass").count(), 4)
        self.assertEqual(page.locator('#test-list li.fail span.mark[role="img"][aria-label="Failed"]').count(), 2)
        self.assertEqual(page.locator("#test-list li.fail small").all_text_contents(), ["room went wrong", "stop went wrong"])

        worker.answers["/v1/selftest"] = selftest_answer(error="the practice chat did not answer")
        page.click("#test-again")
        self.wait_text(page, "#test-result", "could not run")
        self.assertEqual(self.state(page)["selftest"], "fail")
        self.assertTrue(self.text(page, "#test-result").startswith("The self-test could not run · "), self.text(page, "#test-result"))
        self.assertEqual(page.locator("#test-list li").count(), 1)
        self.assertIn("the practice chat did not answer", self.text(page, "#test-list li.fail"))

        def read_again(answer):
            worker.answers["/v1/selftest"] = answer
            page.click("#test-again")
            page.wait_for_function("() => document.documentElement.dataset.botSelftest !== 'loading'", timeout=10000)

        # The page never takes the server's own summary on trust. A failed check, an error, or no checks at all
        # is a failure even when the same answer also says "ok".
        status, body = selftest_answer(failed=("room",), detail="the room stayed silent")
        body["result"]["ok"] = True
        read_again((status, body))
        self.assertEqual(self.state(page)["selftest"], "fail", "one failed check is a failure, whatever the summary says")
        self.assertIn("fail", page.get_attribute("#test-result", "class") or "")
        self.assertTrue(self.text(page, "#test-result").startswith("1 of 6 checks failed · "), self.text(page, "#test-result"))
        self.assertEqual(page.locator("#test-list li.fail small").all_text_contents(), ["the room stayed silent"])

        status, body = selftest_answer()
        body["result"]["error"] = "the run was cut short"
        read_again((status, body))
        self.assertEqual(self.state(page)["selftest"], "fail", "an error is a failure, even beside six passed checks")
        self.assertIn("fail", page.get_attribute("#test-result", "class") or "")
        self.assertTrue(self.text(page, "#test-result").startswith("The self-test could not run · "), self.text(page, "#test-result"))
        self.assertEqual(page.locator("#test-list li.fail").count(), 1)
        self.assertIn("the run was cut short", self.text(page, "#test-list li.fail"))
        self.assertEqual(page.locator("#test-list li.pass").count(), 6)

        status, body = selftest_answer()
        body["result"]["checks"] = []
        read_again((status, body))
        self.assertEqual(self.state(page)["selftest"], "fail", "a self-test that checked nothing has not passed")
        self.assertIn("fail", page.get_attribute("#test-result", "class") or "")
        self.assertTrue(self.text(page, "#test-result").startswith("The self-test could not run · "), self.text(page, "#test-result"))
        self.assertEqual(page.locator("#test-list li").count(), 0)

        status, body = selftest_answer()
        body["result"]["ok"] = False
        read_again((status, body))
        self.assertEqual(self.state(page)["selftest"], "fail", "and the server's own 'not ok' is never shown as a pass")
        self.assertIn("fail", page.get_attribute("#test-result", "class") or "")
        self.assertNotIn("pass", page.get_attribute("#test-result", "class") or "")

        worker.answers["/v1/selftest"] = (200, {"running": False, "result": None})
        page.click("#test-again")
        self.wait_for(page, "botSelftest", "none")
        self.assertEqual(self.text(page, "#test-result"), "No result yet. Try again in a minute.")
        self.assertEqual(page.locator("#test-list li").count(), 0)

        worker.answers["/v1/selftest"] = None
        page.click("#test-again")
        self.wait_for(page, "botSelftest", "offline")
        self.assertEqual(self.text(page, "#test-result"), "Could not read the result.")
        self.assertEqual(len(worker.sent("/v1/selftest")), 9, "each press reads once")
        self.assertEqual(len(worker.sent("/v1/status")), 1, "and leaves the rest alone")
        self.assert_clean()

    def test_what_the_bot_can_reach_is_counted_and_listed(self):
        worker = FakeWorker()
        page = self.open_bot(worker)
        self.settle(page)
        self.assertEqual(self.state(page)["probe"], "ready")
        self.assertTrue(self.text(page, "#probe-result").startswith("Tested "), self.text(page, "#probe-result"))
        self.assertEqual(page.locator("#probe-stats .stat b").all_text_contents(), ["2/3", "2/3", "1/2", "60"])
        labels = page.locator("#probe-stats .stat span").all_text_contents()
        self.assertEqual(labels, [self.words(page, f"bot.probe.stat.{name}") for name in ("models", "search", "pages", "news")])
        self.assertTrue(page.is_visible("#probe-details"))
        headings = page.locator("#probe-rows .probe-group h3").all_text_contents()
        self.assertEqual(headings, [self.words(page, f"bot.probe.group.{name}") for name in PROBE_GROUPS])
        self.assertEqual(page.locator("#probe-rows li").count(), 12)
        self.assertEqual(page.locator("#probe-rows li.ok").count(), 8)
        self.assertEqual(page.locator("#probe-rows li.bad").count(), 4)
        listed = page.locator("#probe-rows li span.what").all_text_contents()
        self.assertIn("bing-rss", listed, "search routes are named without the 'search:' prefix")
        self.assertIn("ovh · Meta-Llama-3_3-70B-Instruct", listed)
        self.assertIn("example.com", listed)
        notes = page.locator("#probe-rows li small").all_text_contents()
        self.assertIn("1,256 characters · via direct", notes)
        self.assertIn("HTTP 522", notes)

        worker.answers["/v1/probe"] = (200, {"running": False, "result": None})
        page.click("#probe-again")
        self.wait_for(page, "botProbe", "none")
        self.assertEqual(self.text(page, "#probe-result"), "No results yet.")
        self.assertFalse(page.is_visible("#probe-details"))
        self.assertEqual(page.locator("#probe-stats .stat").count(), 0)
        self.assertEqual(len(worker.sent("/v1/probe")), 2)
        self.assert_clean()

    def test_a_probe_still_running_is_read_again_by_itself(self):
        worker = FakeWorker()
        worker.answers["/v1/probe"] = (200, {"running": True, "result": None})
        page = self.open_bot(worker, clock=True)
        self.settle(page)
        self.assertEqual(self.state(page)["probe"], "running")
        self.assertEqual(self.text(page, "#probe-result"), "The server is testing its routes now. This takes a minute or two…")
        self.assertEqual(len(worker.sent("/v1/probe")), 1)

        worker.answers["/v1/probe"] = probe_answer()
        if hasattr(page, "clock"):
            page.clock.fast_forward(8000)
        # Without a controllable clock this simply waits out the page's real eight seconds.
        self.wait_for(page, "botProbe", "ready", timeout=15000)
        self.assertEqual(len(worker.sent("/v1/probe")), 2, "one more read, with nobody pressing anything")
        self.assertEqual(page.locator("#probe-rows li").count(), 12)
        self.assert_clean()

    def test_a_probe_that_never_finishes_is_not_read_forever(self):
        """A server stuck on "still testing" is read again every eight seconds, but only twelve more times.
        Then the page shows what it has and stops asking, until somebody presses the button."""

        def still_running(read):
            # Every answer carries its own number, shown in the GlowNews tile, so each read can be told apart.
            return 200, {"running": True, "result": {"at": AT, "news": {"ok": True, "stories": 100 + read}}}

        tile = "#probe-stats .stat b"
        last = 13  # the first read plus twelve more
        worker = FakeWorker()
        worker.answers["/v1/probe"] = still_running(1)
        page = self.open_bot(worker, clock=True)
        self.assertTrue(hasattr(page, "clock"), "this test needs Playwright's clock (1.45 or newer)")
        self.settle(page)
        self.wait_text(page, tile, "101")
        self.assertEqual(self.state(page)["probe"], "running")
        self.assertEqual(len(worker.sent("/v1/probe")), 1)

        for read in range(2, last + 1):
            worker.answers["/v1/probe"] = still_running(read)
            page.clock.fast_forward(8000)
            self.wait_text(page, tile, str(100 + read))
            self.assertEqual(len(worker.sent("/v1/probe")), read)
            self.assertEqual(self.state(page)["probe"], "running" if read < last else "ready", f"after read {read}")
        self.assertTrue(self.text(page, "#probe-result").startswith("Tested "), self.text(page, "#probe-result"))

        for _ in range(3):
            page.clock.fast_forward(8000)
        page.wait_for_timeout(300)
        self.assertEqual(len(worker.sent("/v1/probe")), last, "it has stopped asking")
        self.assertEqual(self.state(page)["probe"], "ready")

        worker.answers["/v1/probe"] = still_running(last + 1)
        page.click("#probe-again")
        self.wait_text(page, tile, str(100 + last + 1))
        self.assertEqual(self.state(page)["probe"], "running", "pressing the button starts the count afresh")
        self.assertEqual(len(worker.sent("/v1/probe")), last + 1)
        self.assert_clean()

    def test_the_setup_step_needs_the_private_link_and_hides_its_code(self):
        for suffix in ("", "#k=short", "#k=" + "!" * 24, "#x=" + CODE, "?k=" + CODE):
            with self.subTest(suffix):
                page = self.open_bot(FakeWorker(), suffix)
                self.settle(page)
                self.assertEqual(self.state(page)["setup"], "hidden")
                self.assertFalse(page.is_visible("#setup-card"))
                page.close()

        self.fetched.clear()
        worker = FakeWorker()
        page = self.open_bot(worker, "#k=" + CODE)
        self.settle(page)
        self.assertEqual(self.state(page)["setup"], "form")
        for shown in ("#setup-card", "#setup-entry", "#setup-token", "#setup-connect"):
            self.assertTrue(page.is_visible(shown), shown)
        self.assertFalse(page.is_visible("#setup-done"))
        self.assertEqual(page.get_attribute("#setup-token", "autocomplete"), "off")
        self.assertEqual(self.text(page, 'label[for="setup-token"]'), "Bot token")
        left = page.evaluate(LEFTOVERS)
        self.assertEqual(left["hash"], "", "the code is taken out of the address bar at once")
        for place in ("href", "html", "local", "session", "cookie"):
            self.assertNotIn(CODE, left[place], f"the setup code is not left in: {place}")
        carried = [url for kind, url in self.fetched if kind != "document" and CODE in url]
        self.assertEqual(carried, [], "no request carries the setup code in its address")
        self.assertEqual(worker.sent("/setup", "POST"), [], "nothing is sent until Connect is pressed")
        self.assert_clean()

    def test_a_wrong_looking_token_is_caught_before_anything_is_sent(self):
        worker = FakeWorker()
        page = self.open_bot(worker, "#k=" + CODE)
        self.settle(page)
        page.click("#setup-connect")
        self.wait_for(page, "botSetup", "error")
        self.assertEqual(self.text(page, "#setup-result"), "Paste the token first.")

        page.fill("#setup-token", "12")
        self.wait_for(page, "botSetup", "form")
        self.assertEqual(self.text(page, "#setup-result"), "", "typing again clears the complaint")

        wrong_tokens = ["not-a-token", "123456789:short", "123456789 " + "A" * 35, "abc:" + "A" * 35, "123456789:" + "A" * 20 + " " + "A" * 20]
        for wrong in wrong_tokens:
            with self.subTest(wrong):
                page.fill("#setup-token", wrong)
                self.wait_for(page, "botSetup", "form")
                page.click("#setup-connect")
                self.wait_for(page, "botSetup", "error")
                self.assertEqual(self.text(page, "#setup-result"), FORMAT_SENTENCE)
                self.assertEqual(page.input_value("#setup-token"), wrong, "what was typed stays, so it can be fixed")

        page.fill("#setup-token", "still wrong")
        self.wait_for(page, "botSetup", "form")
        page.press("#setup-token", "Enter")
        self.wait_for(page, "botSetup", "error")
        self.assertEqual(self.text(page, "#setup-result"), FORMAT_SENTENCE, "Enter does what the button does")
        self.assertEqual([request for request in worker.requests if request["path"] == "/setup"], [], "nothing left the page")
        self.assert_clean()

    def test_connecting_sends_the_token_once_and_hands_over_the_owner_link(self):
        worker = FakeWorker()
        worker.answers["/v1/status"] = status_answer(configured=False, bot=None, claimed=False)
        worker.answers["/setup"] = setup_answer(warnings=["photo: HTTP 404", "commands-id: Bad Request " + LONG])
        page = self.open_bot(worker, "#k=" + CODE)
        self.settle(page)
        self.assertEqual(self.state(page)["status"], "unconfigured")
        status_reads = len(worker.sent("/v1/status"))

        worker.answers["/v1/status"] = status_answer(claimed=False)
        page.fill("#setup-token", "  " + TOKEN + " ")
        page.click("#setup-connect")
        self.wait_for(page, "botSetup", "done")
        posts = [request for request in worker.requests if request["path"] == "/setup" and request["method"] == "POST"]
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]["url"], WORKER + "/setup")
        self.assertEqual(json.loads(posts[0]["body"]), {"code": CODE, "token": TOKEN}, "spaces around a pasted token are dropped")

        self.assertFalse(page.is_visible("#setup-entry"))
        self.assertTrue(page.is_visible("#setup-done"))
        self.assertEqual(self.text(page, "#setup-done-text"), f"Connected as @{BOT_NAME}.")
        link = page.locator("#setup-link")
        self.assertTrue(link.is_visible())
        self.assertEqual(link.get_attribute("href"), CLAIM_LINK)
        self.assertEqual(link.get_attribute("target"), "_blank")
        self.assertIn("noopener", link.get_attribute("rel") or "")
        self.assertEqual(self.text(page, "#setup-link"), "Open Telegram and press Start to become the owner")
        self.assertEqual(self.text(page, "#setup-done-note"), self.words(page, "bot.setup.claimNote"))
        self.assertEqual(page.input_value("#setup-token"), "", "the token is wiped from the field")
        self.assertTrue(page.is_visible("#setup-warnings"))
        warnings = page.locator("#setup-warning-list li").all_text_contents()
        self.assertEqual(len(warnings), 2)
        self.assertEqual(warnings[0], "photo: HTTP 404")

        self.wait_for(page, "botStatus", "unclaimed")
        self.assertGreater(len(worker.sent("/v1/status")), status_reads, "the card below is read again after connecting")
        left = page.evaluate(LEFTOVERS)
        for place in ("href", "html", "local", "session", "cookie"):
            self.assertNotIn(CODE, left[place], f"the setup code is not left in: {place}")
            self.assertNotIn(TOKEN, left[place], f"the token is not left in: {place}")
        self.assert_clean()

    def test_only_a_real_telegram_link_is_ever_offered(self):
        hostile_links = [
            "https://evil.example/steal",
            "javascript:alert(1)",
            "https://t.me.evil.example/GlowTest_bot",
            PLAIN_LINK + "?start=ok&redirect=https://evil.example/",
            "http://t.me/GlowTest_bot",
            "",
        ]
        for hostile in hostile_links:
            with self.subTest(hostile):
                worker = FakeWorker()
                worker.answers["/setup"] = setup_answer(claimed=True, link=hostile)
                page = self.open_bot(worker, "#k=" + CODE)
                self.settle(page)
                page.fill("#setup-token", TOKEN)
                page.press("#setup-token", "Enter")
                self.wait_for(page, "botSetup", "done")
                self.assertEqual(page.get_attribute("#setup-link", "href"), PLAIN_LINK)
                self.assertEqual(self.text(page, "#setup-link"), f"Open @{BOT_NAME} in Telegram")
                self.assertEqual(self.text(page, "#setup-done-note"), "This bot already has its owner, and its chats were kept.")
                self.assertFalse(page.is_visible("#setup-warnings"))
                self.assertEqual(len(worker.sent("/setup", "POST")), 1)
                page.close()

        worker = FakeWorker()
        worker.answers["/setup"] = setup_answer(username=HOSTILE_NAME)
        page = self.open_bot(worker, "#k=" + CODE)
        self.settle(page)
        page.fill("#setup-token", TOKEN)
        page.click("#setup-connect")
        self.wait_for(page, "botSetup", "error")
        self.assertFalse(page.is_visible("#setup-done"), "an answer without a real bot name is not a success")
        self.assertIsNone(page.get_attribute("#setup-link", "href"))
        self.assert_clean()

    def test_every_setup_failure_gets_its_own_plain_sentence(self):
        failures = [
            ((403, {"ok": False, "error": "setup-code"}), "This setup link is no longer valid. Ask for a new one.", ""),
            ((400, {"ok": False, "error": "token-format"}), FORMAT_SENTENCE, ""),
            (
                (400, {"ok": False, "error": "token-rejected", "detail": "Unauthorized"}),
                "Telegram did not accept this token. Copy it again from @BotFather.",
                "Unauthorized",
            ),
            (
                (400, {"ok": False, "error": "webhook-failed", "detail": "Bad Request: bad webhook"}),
                "Telegram took the token but would not connect it to the server. Try again in a minute.",
                "Bad Request: bad webhook",
            ),
            ((400, {"ok": False, "error": "origin"}), "Setup is only allowed from the Glow website.", ""),
            ((500, {"ok": False, "error": "boom happened"}), "Setup did not finish: boom happened", ""),
            ((502, "<html><body>Bad gateway</body></html>"), "Setup did not finish: HTTP 502", ""),
            (None, NETWORK_SENTENCE, ""),
        ]
        worker = FakeWorker()
        page = self.open_bot(worker, "#k=" + CODE)
        self.settle(page)
        for number, (answer, sentence, detail) in enumerate(failures, 1):
            with self.subTest(sentence):
                worker.answers["/setup"] = answer
                page.fill("#setup-token", TOKEN)
                self.wait_for(page, "botSetup", "form")
                page.click("#setup-connect")
                self.wait_for(page, "botSetup", "error")
                self.assertEqual(self.text(page, "#setup-result"), sentence)
                if detail:
                    self.assertTrue(page.is_visible("#setup-detail"))
                    self.assertEqual(self.text(page, "#setup-detail"), detail)
                else:
                    self.assertFalse(page.is_visible("#setup-detail"))
                    self.assertIsNone(
                        page.locator("#setup-detail").bounding_box(),
                        "with no detail the line is taken out, not left as an empty gap",
                    )
                self.assertEqual(len(worker.sent("/setup", "POST")), number, "one press, one try")
                self.assertTrue(page.is_visible("#setup-connect"), "it can be tried again")

        worker.answers["/setup"] = setup_answer()
        page.fill("#setup-token", TOKEN)
        page.click("#setup-connect")
        self.wait_for(page, "botSetup", "done")
        self.assertEqual(page.get_attribute("#setup-link", "href"), CLAIM_LINK, "after any failure a good try still goes through")
        self.assert_clean()

    def test_nothing_spills_off_a_phone_screen(self):
        for viewport in (PHONE, PHONE_TALL):
            with self.subTest(viewport["width"]):
                worker = FakeWorker()
                worker.answers["/v1/selftest"] = selftest_answer(failed=("room",), detail="https://" + LONG)
                worker.answers["/setup"] = (400, {"ok": False, "error": "token-rejected", "detail": LONG})
                page = self.open_bot(worker, "#k=" + CODE, viewport=viewport)
                self.settle(page)
                page.click("#probe-details summary")
                self.assertTrue(page.is_visible("#probe-rows li"), "the long list is open")
                wide, screen = page.evaluate(WIDTHS)
                self.assertLessEqual(wide, screen, "status, self-test and the opened list of every test")
                self.assert_cut_short(page, "#test-list li.fail small", "the reason a check failed")

                page.fill("#setup-token", TOKEN)
                page.click("#setup-connect")
                self.wait_for(page, "botSetup", "error")
                wide, screen = page.evaluate(WIDTHS)
                self.assertLessEqual(wide, screen, "a failed setup with a long reason")
                self.assert_cut_short(page, "#setup-detail", "the reason Telegram gave")

                worker.answers["/setup"] = setup_answer(warnings=["photo: " + LONG])
                page.fill("#setup-token", TOKEN)
                page.click("#setup-connect")
                self.wait_for(page, "botSetup", "done")
                wide, screen = page.evaluate(WIDTHS)
                self.assertLessEqual(wide, screen, "a finished setup with a long warning")
                self.assert_cut_short(page, "#setup-warning-list li", "a warning from the setup")
                controls = ("#setup-link", "#open-telegram", "#test-again", "#probe-again")
                for control in controls:
                    box = page.locator(control).bounding_box()
                    self.assertIsNotNone(box, control)
                    self.assertGreaterEqual(box["x"], 0, control)
                    self.assertLessEqual(box["x"] + box["width"], screen + 0.5, control)

                codes = page.evaluate(LANGUAGE_CODES)
                self.assertEqual(len(codes), 4)
                for code in codes[1:]:
                    page.evaluate("(code) => GlowLocale.save(code, GlowLocale.get().region)", code)
                    page.wait_for_function(
                        '() => document.getElementById("status-text").textContent.trim() === GlowLocale.t("bot.status.ready")',
                        timeout=10000,
                    )
                    wide, screen = page.evaluate(WIDTHS)
                    self.assertLessEqual(wide, screen, f"{code}: the same page with everything open, in this language")
                    for control in controls:
                        box = page.locator(control).bounding_box()
                        self.assertIsNotNone(box, f"{code}: {control}")
                        self.assertGreaterEqual(box["x"], 0, f"{code}: {control}")
                        self.assertLessEqual(box["x"] + box["width"], screen + 0.5, f"{code}: {control}")
                page.close()
        self.assert_clean()

    def test_light_and_dark_follow_the_device_and_then_the_button(self):
        page = self.open_bot(FakeWorker(), color_scheme="dark")
        self.settle(page)
        self.assertEqual(self.state(page)["theme"], "dark")
        self.assertEqual(page.get_attribute('meta[name="theme-color"]', "content"), "#262624")
        dark = page.evaluate(COLOURS)

        page.click("#theme-btn")
        self.wait_for(page, "theme", "light")
        self.assertEqual(page.get_attribute('meta[name="theme-color"]', "content"), "#faf9f5")
        self.assertEqual(page.evaluate("() => localStorage.getItem('glow.home.theme')"), "light")
        light = page.evaluate(COLOURS)
        self.assertNotEqual(dark, light, "the colours really change")

        page.reload()
        self.settle(page)
        self.assertEqual(self.state(page)["theme"], "light", "the choice is kept, even on a dark device")
        page.click("#theme-btn")
        self.wait_for(page, "theme", "dark")
        self.assertEqual(page.evaluate(COLOURS), dark)
        page.close()

        page = self.open_bot(FakeWorker(), color_scheme="light")
        self.settle(page)
        self.assertEqual(self.state(page)["theme"], "light")
        self.assertEqual(page.evaluate(COLOURS), light)
        self.assert_clean()

    def test_every_language_changes_the_words_on_the_page(self):
        static = GlowBotStaticTests("page_keys")
        static.setUp()
        keys = static.page_keys()
        page = self.open_bot(FakeWorker())
        self.settle(page)
        codes = page.evaluate(LANGUAGE_CODES)
        self.assertEqual(len(codes), 4)
        self.assertEqual(codes[0], "en")
        seen = {}
        for code in codes:
            with self.subTest(code):
                page.evaluate("(code) => GlowLocale.save(code, GlowLocale.get().region)", code)
                page.wait_for_function(
                    '() => document.getElementById("status-text").textContent.trim() === GlowLocale.t("bot.status.ready")',
                    timeout=10000,
                )
                shown = page.evaluate(WORDS_ON_PAGE)
                self.assertEqual(shown["title"], self.words(page, "bot.status.title"))
                self.assertEqual(shown["open"], self.words(page, "bot.status.open", name=BOT_NAME))
                self.assertEqual(shown["access"], self.words(page, "bot.status.private"))
                self.assertEqual(shown["firstCheck"], self.words(page, "bot.test.check.mission"))
                self.assertEqual(shown["firstGroup"], self.words(page, "bot.probe.group.keyless"))
                self.assertEqual(shown["firstTile"], self.words(page, "bot.probe.stat.models"))
                self.assertNotIn("{", shown["test"], "every blank in the sentence is filled in")
                visible = page.inner_text("body")
                self.assertEqual([key for key in sorted(keys) if key in visible], [], "no untranslated key shows")
                seen[code] = shown
        english = seen["en"]
        self.assertEqual(english["status"], "The bot is live. Open it, press Start, then type a goal.")
        for code in codes[1:]:
            for part in ("title", "status", "open", "access", "test", "firstCheck", "firstGroup", "firstTile"):
                self.assertNotEqual(seen[code][part], english[part], f"{code}: {part} is translated")
        self.assertEqual(len({shown["lang"] for shown in seen.values()}), 4, "the page tells the browser which language it is in")
        self.assertEqual(len({json.dumps(shown, sort_keys=True) for shown in seen.values()}), 4)
        self.assert_clean()

    def expect_bubble(self, page, message, **wanted):
        """Poll until the assistant button is in this state (its fade takes a moment), then insist on it."""
        deadline = time.monotonic() + BUBBLE_WAIT_S
        while True:
            state = page.evaluate(BUBBLE_STATE)
            if all(state[key] == value for key, value in wanted.items()) or time.monotonic() >= deadline:
                break
            page.wait_for_timeout(50)
        self.assertEqual({key: state[key] for key in wanted}, wanted, f"{message}: {state}")

    def test_the_assistant_button_steps_aside_for_what_is_under_it(self):
        """On a phone the floating Glow assistant button can come to rest on the fold that opens the full list of
        outside tests. There it turns see-through, so the tap reaches the fold. It is never removed: Tab still
        finds it and focus shows it. Where it covers nothing to press, it stays in plain view."""
        worker = FakeWorker()
        page = self.open_bot(worker, viewport=PHONE)
        self.settle(page)
        page.wait_for_selector(".glow-widget-bubble", state="attached", timeout=10000)
        self.expect_bubble(page, "at the top of the page nothing to press is under it", aside=False, shown=True)

        shared = page.evaluate(UNDER_BUBBLE, FOLD)
        self.assertGreaterEqual(shared["share"], COVER_LIMIT, f"at this width the button can sit on the fold: {shared}")
        self.expect_bubble(page, "over the fold the button steps aside", aside=True, seeThrough=True)

        before = page.evaluate(FOCUS_BEFORE_BUBBLE)
        self.assertTrue(before, "some control comes before the assistant button in the tab order")
        page.keyboard.press("Tab")
        page.evaluate(UNDER_BUBBLE, FOLD)
        self.expect_bubble(page, f"Tab from {before} lands on it, and focus shows it even over the fold", aside=True, focused=True, shown=True)
        page.evaluate(DROP_FOCUS)
        self.expect_bubble(page, "once focus has left, it steps aside again", aside=True, seeThrough=True)

        shared = page.evaluate(UNDER_BUBBLE, FOLD)
        self.assertFalse(page.evaluate(LIST_IS_OPEN), "the full list starts folded away")
        self.assertTrue(page.evaluate(POINT_IS_ON, [FOLD, shared["x"], shared["y"]]), f"a tap inside the button's own outline reaches the fold: {shared}")
        page.mouse.click(shared["x"], shared["y"])
        page.wait_for_function(LIST_IS_OPEN, timeout=5000)
        self.expect_bubble(page, "the tap opened the list, not the assistant", open=False)

        page.evaluate(BACK_TO_TOP)
        self.expect_bubble(page, "away from the fold it is back in plain view", aside=False, shown=True)
        self.assert_clean()

    def test_the_assistant_button_stays_put_while_the_assistant_is_open(self):
        """Wider than a phone, the assistant opens beside its button, and the button is what closes it again. So while
        the assistant is open the button stays in plain view, even over the fold where it otherwise steps aside. Once
        the assistant is closed, it steps aside again."""
        worker = FakeWorker()
        page = self.open_bot(worker, viewport=TABLET)
        self.settle(page)
        page.wait_for_selector(".glow-widget-bubble", state="attached", timeout=10000)
        framed = []

        def stand_in(route):
            framed.append(route.request.url)
            route.fulfill(status=200, content_type="text/html", body=ASSISTANT_STUB)

        page.route(re.compile(r"/lead/\?"), stand_in)
        self.expect_bubble(page, "at the top of the page nothing to press is under it", aside=False, open=False, shown=True)

        crown = page.locator(".glow-widget-bubble").bounding_box()
        middle = [crown["x"] + crown["width"] / 2, crown["y"] + crown["height"] / 2]
        page.mouse.click(*middle)
        self.expect_bubble(page, "a tap opens the assistant", open=True, shown=True)
        page.wait_for_function(ASSISTANT_LOADED, timeout=10000)
        self.assertEqual(framed, [self.pages.base + "lead/?widget=1"], "the assistant is GlowLead, asked for once")
        self.assertIsNotNone(page.locator(".glow-widget-panel").bounding_box(), "the assistant is on screen")
        self.assertTrue(
            page.evaluate(POINT_IS_ON, [".glow-widget-bubble", *middle]),
            "at this width the assistant opens beside its button, not over it",
        )

        shared = page.evaluate(UNDER_BUBBLE, FOLD)
        self.assertGreaterEqual(shared["share"], COVER_LIMIT, f"at this width too the button can sit on the fold: {shared}")
        self.expect_bubble(page, "while the assistant is open its button stays, even over the fold", aside=True, open=True, shown=True)
        page.evaluate(DROP_FOCUS)
        self.expect_bubble(page, "the open assistant keeps it there, not focus", aside=True, open=True, focused=False, shown=True)

        self.assertTrue(page.evaluate(POINT_IS_ON, [".glow-widget-bubble", *middle]), "the button is what a tap there reaches")
        page.mouse.click(*middle)
        self.expect_bubble(
            page,
            "a tap on the button closes the assistant, and over the fold it then steps aside",
            aside=True,
            open=False,
            seeThrough=True,
        )

        page.evaluate(BACK_TO_TOP)
        self.expect_bubble(page, "away from the fold it is back in plain view", aside=False, open=False, shown=True)
        self.assert_clean()


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
