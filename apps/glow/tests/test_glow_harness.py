"""GlowHarness (1.31.0): static checks with the standard library, the engine's own checks when Node is
installed, and a real-browser run when Playwright is installed.

GlowHarness is the agent harness Glow built from scratch: a loop that lets a language model use tools,
behind a permission gate, leaving a trace that can be replayed. These checks cover the page (CSP, no inline
script, local refs, translations), its place in the Glow family (menu, home, service worker, sitemap,
version), the engine's rules (no eval, no third-party code, a size budget), and the honesty rule: the static
page carries no figures, every number is rendered from bench.json, and bench.json has to agree with the
files and the saved model runs it describes. The browser run also visits the home page once, cuts the
network, and opens the harness from the copy the service worker saved; and at phone width it checks that
the floating Glow assistant button lets a tap through to Run and still opens from the keyboard.
No test here calls a real model provider.
Run from the repo root:  python -X utf8 apps/glow/tests/test_glow_harness.py
"""
import datetime
import json
import math
import re
import shutil
import subprocess
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
HARNESS = WEB / "harness"
SHARED = WEB / "shared"
REPO = APP.parent.parent
RESULTS = APP / "harness" / "results"
ENGINE = SHARED / "glow-harness.js"
KIT = SHARED / "glow-harness-kit.js"
ENGINE_BUDGET_BYTES = 60_000
PROVIDER_ORIGINS = (
    "https://text.pollinations.ai",
    "https://api.llm7.io",
    "https://oai.endpoints.kepler.ai.cloud.ovh.net",
)
PAGE_SCRIPTS = [
    "../shared/glow-locale.js",
    "../shared/glow-apps.js",
    "../shared/glow-offline-library.js",
    "../shared/glow-harness.js",
    "../shared/glow-harness-kit.js",
    "./suite.js",
    "./checks.js",
    "./harness.js",
]
OUR_SOURCES = (ENGINE, KIT, HARNESS / "suite.js", HARNESS / "checks.js", HARNESS / "harness.js")
OFFLINE_ASSETS = (
    "./harness/",
    "./harness/harness.css",
    "./harness/harness.js",
    "./harness/suite.js",
    "./harness/checks.js",
    "./harness/bench.json",
    "./shared/glow-offline-library.js",
    "./shared/glow-harness.js",
    "./shared/glow-harness-kit.js",
)
FILLED_FROM_BENCH = (
    "stats", "bars", "paired-note", "bars-note", "suite-table", "suite-lede", "method-list", "bench-note", "refs-date", "harness-meta",
)
# One saved reply quotes this line back. We never wrote it, so the provider put it in front of the question.
DATE_LINE = "Today Date"
DATE_LINE_RUN = "model-run.ovh.json"
# How a reply claims to have stored a note. A model alone has no tools, so the claim cannot be true.
NOTE_CLAIM = re.compile(r"note (?:has been|was|is) saved|saved (?:the|your|a|that) note|note saved", re.I)
SUM_TASK = "What is (1234 + 5678) * 91 - 4321?"
SUM_ANSWER = "624671"

LOAD_TIMEOUT_MS = 120_000
RUN_TIMEOUT_MS = 120_000
SELFTEST_TIMEOUT_MS = 300_000
HOME_WORKER_WAIT_S = 120
# Predicates are passed as functions: string expressions are polled with eval, which the page's CSP forbids.
BENCH_LOADED = "() => !!document.documentElement.dataset.bench"
SELFTEST_ENDED = "() => ['pass', 'fail'].includes(document.documentElement.dataset.selftest)"
RUN_SETTLED = "() => { const state = document.documentElement.dataset.run; return !!state && state !== 'running'; }"
REPLAY_ENDED = "() => !!document.documentElement.dataset.replay"
PAGE_STATE = "() => Object.assign({}, document.documentElement.dataset)"
OPEN_PROMPT = ".ask-box:not(.settled):not([data-answered-by-test])"
PROVIDER_REQUESTS = re.compile("^(" + "|".join(re.escape(origin) for origin in PROVIDER_ORIGINS) + ")/")
# Resolves with the state of the service worker for this scope, as soon as it is 'activated' or when time is up.
HOME_WORKER_STATE = """
async ([scope, seconds]) => {
  const deadline = Date.now() + seconds * 1000;
  let state = 'none';
  while (Date.now() < deadline) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const home = registrations.find((registration) => new URL(registration.scope).pathname === scope);
    state = home && home.active ? home.active.state : 'none';
    if (state === 'activated') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return state;
}
"""

# The floating Glow assistant button (shared/glow-apps.js) and the page's rule for it (keepCrownClear in harness.js).
PHONE = {"width": 320, "height": 640}
COVER_LIMIT = 0.2  # the button steps aside once it overlaps a control by a fifth of the smaller of the two
BUBBLE_WAIT_S = 10
# The assistant panel loads GlowLead in a frame; a stub keeps that other app out of this test.
LEAD_PAGE = re.compile(r"/lead/(\?|$)")
LEAD_STUB = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GlowLead</title></head><body>GlowLead</body></html>'
# Scrolls Run under the button as far as the page allows and returns the rectangle the two then share.
RUN_UNDER_BUBBLE = """
async () => {
  const bubble = document.querySelector(".glow-widget-bubble");
  const run = document.querySelector("#run-btn");
  const crown = bubble.getBoundingClientRect();
  const box = run.getBoundingClientRect();
  const last = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const wanted = window.scrollY + box.top + box.height / 2 - (crown.top + crown.height / 2);
  window.scrollTo({ top: Math.max(0, Math.min(last, Math.round(wanted))), left: 0, behavior: "instant" });
  for (let frame = 0; frame < 3; frame += 1) await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const now = run.getBoundingClientRect();
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
POINT_IS_ON_RUN = """
([x, y]) => {
  const hit = document.elementFromPoint(x, y);
  return !!hit && document.querySelector("#run-btn").contains(hit);
}
"""
# The same button and an open permission question. There the rule is stricter: the button keeps off the question
# altogether. A taller phone, where the button can be over the question without covering any button by a fifth.
PHONE_TALL = {"width": 390, "height": 844}
NOTE_TASK = "Remember that my locker code is 7291."  # one of the page's own examples; saving a note asks first
PRESSABLE = "button, a[href], input, select, textarea, summary, [role='button']"
OPEN_QUESTION = ".ask-box:not(.settled)"
ANSWERED_QUESTION = ".ask-box.settled"
# Scrolls the question as far under the button as it goes without any control being covered by `limit` or more,
# and returns that place. Which controls are on show is worked out here, not taken from the page's own rule.
QUESTION_ALONE_UNDER_BUBBLE = """
async ([questionSelector, pressable, limit]) => {
  const bubble = document.querySelector(".glow-widget-bubble");
  const question = document.querySelector(questionSelector);
  if (!bubble || !question) return null;
  const crown = bubble.getBoundingClientRect();
  const crownArea = crown.width * crown.height;
  const shared = (box) => {
    const wide = Math.min(box.right, crown.right) - Math.max(box.left, crown.left);
    const high = Math.min(box.bottom, crown.bottom) - Math.max(box.top, crown.top);
    return wide > 0 && high > 0 ? wide * high : 0;
  };
  const folded = (element) => {
    const fold = element.closest("details:not([open])");
    if (!fold) return false;
    const ownSummary = element.tagName === "SUMMARY" && element.parentElement === fold;
    return ownSummary ? !!fold.parentElement && folded(fold.parentElement) : true;
  };
  const worstControl = () => {
    let worst = 0;
    for (const control of document.querySelectorAll(pressable)) {
      if (control === bubble || control.closest(".glow-widget-panel")) continue;
      if (control.getClientRects().length === 0 || getComputedStyle(control).visibility !== "visible" || folded(control)) continue;
      const box = control.getBoundingClientRect();
      const area = box.width * box.height;
      if (area) worst = Math.max(worst, shared(box) / Math.min(area, crownArea));
    }
    return worst;
  };
  const last = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const place = question.getBoundingClientRect();
  const first = Math.max(0, Math.floor(window.scrollY + place.top - crown.bottom));
  const final = Math.min(last, Math.ceil(window.scrollY + place.bottom - crown.top));
  let best = null;
  for (let top = first; top <= final; top += 4) {
    window.scrollTo({ top, left: 0, behavior: "instant" });
    const area = shared(question.getBoundingClientRect());
    if (!area) continue;
    const control = worstControl();
    if (control < limit && (!best || area > best.area)) best = { at: window.scrollY, area, control };
  }
  if (!best) return null;
  window.scrollTo({ top: best.at, left: 0, behavior: "instant" });
  for (let frame = 0; frame < 3; frame += 1) await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  return best;
}
"""


def text_of(path):
    return path.read_text(encoding="utf-8")


def shipped_size(path):
    """Bytes as served: text files are committed with LF endings, whatever the checkout uses."""
    return len(path.read_bytes().replace(b"\r\n", b"\n"))


def container(html, element_id):
    """Inner HTML of the element with this id (the page nests no same-tag element inside these)."""
    match = re.search(rf'<(\w+)[^>]*\bid="{element_id}"[^>]*>(.*?)</\1>', html, re.S)
    assert match, element_id
    return match.group(2)


def passed_in(by_category):
    return sum(part["passed"] for part in by_category.values())


def sign_test(gained, lost):
    """Exact two-sided sign test: how often a fair coin splits the changed tasks at least this unevenly."""
    changed = gained + lost
    if not changed:
        return 1.0
    tail = sum(math.comb(changed, k) for k in range(max(gained, lost), changed + 1))
    return min(1.0, 2 * tail / 2 ** changed)


def suite_prompts(suite_js):
    """Task id -> prompt, read from suite.js, where every prompt is a plain string literal."""
    literal = r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\''
    found = re.findall(r'id: "([A-G]\d)",\s*(?:setup: \[[^\]]*\],\s*)?prompt: (' + literal + ")", suite_js)
    return {task: prompt[1:-1] for task, prompt in found}


def spellings_of(iso_day):
    """The ways a prompt could spell this day, lower case: 2026-11-10, 10 nov, nov 10, 10 november, november 10."""
    day = datetime.date.fromisoformat(iso_day)
    month = day.strftime("%B").lower()
    return [iso_day] + [form.format(d=day.day, m=name) for name in (month, month[:3]) for form in ("{d} {m}", "{m} {d}")]


class GlowHarnessTests(unittest.TestCase):
    def setUp(self):
        self.html = text_of(HARNESS / "index.html")
        self.js = text_of(HARNESS / "harness.js")
        self.locale = text_of(SHARED / "glow-locale.js")
        self.bench = json.loads(text_of(HARNESS / "bench.json"))

    def test_page_follows_glow_rules(self):
        self.assertIn("Content-Security-Policy", self.html)
        self.assertIn("script-src 'self'", self.html)
        self.assertNotIn("unsafe-eval", self.html)
        self.assertIn("connect-src 'self' " + " ".join(PROVIDER_ORIGINS) + '"', self.html, "only the three free model providers can be reached")
        self.assertFalse(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", self.html), "no inline scripts (CSP)")
        refs = re.findall(r'(?:src|href)="([^"]+)"', self.html)
        local = [r for r in refs if not re.match(r"^(https?:|mailto:|#|data:)", r)]
        missing = [r for r in local if not (HARNESS / r.split("#")[0].split("?")[0]).exists()]
        self.assertEqual(missing, [])
        self.assertEqual(re.findall(r'<script[^>]*\bsrc="([^"]+)"', self.html), PAGE_SCRIPTS, "engine, then kit, then suite and checks, then the page")
        used_ids = set(re.findall(r'\$\("([\w-]+)"\)', self.js))
        html_ids = set(re.findall(r'id="([\w-]+)"', self.html))
        self.assertEqual(sorted(used_ids - html_ids), [], "every element harness.js uses exists")

    def test_engine_is_self_contained(self):
        for path in OUR_SOURCES:
            source = text_of(path)
            self.assertNotIn("eval(", source, f"{path.name} never evaluates text as code")
            self.assertNotIn("new Function", source, f"{path.name} never evaluates text as code")
            self.assertFalse(re.search(r"\brequire\(|^\s*import\s", source, re.M), f"{path.name} pulls in no package")
        engine = text_of(ENGINE)
        self.assertLessEqual(shipped_size(ENGINE), ENGINE_BUDGET_BYTES, "the engine stays small enough to read in one sitting")
        for outside_world in ("http://", "https://", "fetch(", "localStorage", "document."):
            self.assertNotIn(outside_world, engine, "the engine is a pure loop: tools and models are handed to it")
        kit_origins = set(re.findall(r"https?://[\w.-]+", text_of(KIT)))
        self.assertEqual(kit_origins, set(PROVIDER_ORIGINS), "the kit names the providers the page's CSP allows, and nothing else")
        for path in (HARNESS / "suite.js", HARNESS / "checks.js", HARNESS / "harness.js"):
            real_hosts = [host for host in re.findall(r"https?://([\w.-]+)", text_of(path)) if not host.endswith(".example")]
            self.assertEqual(real_hosts, [], f"{path.name} names no real outside service")
        self.assertFalse(re.findall(r'<script[^>]*\bsrc="https?:', self.html), "every script is our own")

    def test_translated_in_four_languages(self):
        keys = set(re.findall(r'data-i18n(?:-placeholder)?="([\w.]+)"', self.html))
        keys |= set(re.findall(r'"(harness\.[\w.]+)"', self.js))
        keys |= {"apps.harness", "home.tile.harness", "home.pill.harness"}
        self.assertGreater(len(keys), 200)
        for key in sorted(keys):
            self.assertEqual(self.locale.count(f'"{key}": '), 4, f"{key} in en, id, zh-CN, zh-TW")

    def test_in_glow_apps_menu_and_home(self):
        apps = text_of(SHARED / "glow-apps.js")
        self.assertIn('{ id: "harness", name: "GlowHarness"', apps)
        self.assertIn('if (/\\/harness\\//.test(path)) return "harness";', apps)
        self.assertIn('if (/^harness\\//.test(rest)) return "harness";', apps)
        home = text_of(WEB / "index.html")
        self.assertIn('<a class="app-tile harness" id="open-harness" href="./harness/">', home)
        self.assertIn("<b>GlowHarness</b>", home)
        self.assertIn('id="start-harness"', home, "'Agent' choice under the start box")
        home_js = text_of(WEB / "home.js")
        self.assertIn('target === "harness"', home_js)
        self.assertIn('["chat", "room", "lead", "news", "spark", "harness", "bot"]', home_js)
        self.assertIn(".app-tile.harness", text_of(WEB / "home.css"))
        self.assertIn('query.get("q")', self.js, "home hands the task over as ?q=")

    def test_offline_and_versions(self):
        sw = text_of(WEB / "sw.js")
        for asset in OFFLINE_ASSETS:
            self.assertIn(f"'{asset}'", sw)
            self.assertTrue((WEB / asset[2:] / "index.html").exists() if asset.endswith("/") else (WEB / asset[2:]).exists(), asset)
        self.assertNotIn("glowhome-v18", sw, "cache name bumped with the new assets")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f'const GLOW_VERSION = "{published}";', text_of(SHARED / "glow-apps.js"))
        self.assertIn("https://juw12.github.io/projects/glow/harness/", text_of(WEB / "sitemap.xml"))
        workflow = text_of(REPO / ".github" / "workflows" / "glow.yml")
        self.assertGreaterEqual(workflow.count("apps/glow/tests/test_glow_harness.py"), 2, "runs with the static checks and again with a browser")

    def test_benchmark_file_agrees_with_the_engine_and_suite(self):
        bench = self.bench
        engine = bench["engine"]
        self.assertEqual(engine["bytes"], shipped_size(ENGINE), "engine size in bench.json is the real size")
        self.assertEqual(engine["kit_bytes"], shipped_size(KIT), "kit size in bench.json is the real size")
        self.assertEqual(engine["dependencies"], 0)
        self.assertIn(f'const VERSION = "{engine["version"]}";', text_of(ENGINE))
        self.assertGreater(bench["checks"]["total"], 0)
        self.assertEqual(bench["checks"]["passed"], bench["checks"]["total"], "bench.json is only written when every engine check passes")
        for limit in ("max_steps", "max_repairs", "tool_seconds", "total_seconds"):
            self.assertGreater(bench["limits"][limit], 0, limit)
        suite = bench["suite"]
        sizes = {category["id"]: category["tasks"] for category in suite["categories"]}
        self.assertEqual(sum(sizes.values()), suite["tasks"])
        self.assertTrue(suite["clock_or_memory_tasks"], "the page separates out the tasks that ask for today's date or a saved note")
        self.assertTrue(suite["memory_tasks"])
        self.assertLess(set(suite["memory_tasks"]), set(suite["clock_or_memory_tasks"]), "the memory tasks are some of those, not all")
        rules = bench["rules"]
        self.assertEqual(rules["total"], suite["tasks"])
        self.assertEqual({name: part["total"] for name, part in rules["by_category"].items()}, sizes)
        self.assertEqual(passed_in(rules["by_category"]), rules["passed"])
        self.assertEqual(rules["without_clock_or_memory"]["total"], suite["tasks"] - len(suite["clock_or_memory_tasks"]))
        self.assertLessEqual(rules["without_clock_or_memory"]["passed"], rules["without_clock_or_memory"]["total"])
        self.assertLess(rules["passed"], rules["total"], "the no-model brain is reported with its failures")
        parser = bench["parser"]
        self.assertEqual(parser["recovered"] + len(parser["missed"]), parser["cases"], "every malformed call is either recovered or listed as missed")
        self.assertLess(parser["strict"], parser["recovered"], "the baseline it is compared with is a strict reader")
        self.assertEqual(parser["controls_held"], parser["controls"], "plain text is never mistaken for a tool call")
        injection = bench["injection"]
        self.assertGreater(injection["attacks"], 0)
        self.assertEqual(injection["ran_with_rule"], 0, "no scripted attack gets an action through the untrusted-text rule")
        self.assertEqual(injection["held_with_rule"], injection["attacks"])
        self.assertGreater(injection["ran_without_rule"], 0, "the same attacks do work with the rule switched off, so the check measures something")
        self.assertGreater(bench["replay"]["traces"], 0)
        self.assertEqual(bench["replay"]["identical"], bench["replay"]["traces"], "every suite trace replays to the same result")
        self.assertRegex(bench["built"], r"^\d{4}-\d{2}-\d{2}$")

    def test_model_runs_back_the_comparison(self):
        suite = self.bench["suite"]
        sizes = {category["id"]: category["tasks"] for category in suite["categories"]}
        models = self.bench["models"]
        self.assertGreaterEqual(len(models), 1, "at least one real model was measured, bare and with the harness")
        for model in models:
            name = model["id"]
            rows = model["rows"]
            self.assertEqual(len(rows), suite["tasks"], name)
            self.assertEqual(len({row["id"] for row in rows}), len(rows), f"{name}: each task once")
            self.assertEqual((model["temperature"], model["passes"]), (0, 1), f"{name}: one pass at temperature 0, as the page says")
            for side in ("bare", "harness"):
                block = model[side]
                self.assertEqual(block["total"], suite["tasks"], f"{name} {side}")
                self.assertEqual({key: part["total"] for key, part in block["by_category"].items()}, sizes, f"{name} {side}")
                self.assertEqual(passed_in(block["by_category"]), block["passed"], f"{name} {side}")
                self.assertEqual(sum(1 for row in rows if row[side]), block["passed"], f"{name} {side}: the rows add up to the headline")
                silent = [row for row in rows if side in row["no_reply"].split("+")]
                self.assertEqual(len(silent), block["no_reply"], f"{name} {side}")
                self.assertFalse([row["id"] for row in silent if row[side]], f"{name} {side}: a task with no reply counts as a miss")
            self.assertGreaterEqual(model["harness"]["passed"], model["bare"]["passed"], f"{name}: the page claims a lift")
            special = set(suite["clock_or_memory_tasks"])
            rest = [row for row in rows if row["id"] not in special]
            part = model["without_clock_or_memory"]
            self.assertEqual(part["total"], len(rest), name)
            self.assertEqual(sum(1 for row in rest if row["bare"]), part["bare_passed"], name)
            self.assertEqual(sum(1 for row in rest if row["harness"]), part["harness_passed"], name)
            needing = [row for row in rows if row["id"] in special]
            part = model["clock_or_memory"]
            self.assertEqual(part["total"], len(special), name)
            self.assertEqual(part["bare_passed_ids"], [row["id"] for row in needing if row["bare"]], f"{name}: the ones it got right alone")
            self.assertEqual(part["bare_passed"], len(part["bare_passed_ids"]), name)
            self.assertEqual(part["harness_passed"], sum(1 for row in needing if row["harness"]), name)
            self.assertFalse(set(part["bare_passed_ids"]) & set(suite["memory_tasks"]), f"{name}: the page says no model alone can know a saved note")
            self.assert_paired_matches_rows(model)
            self.assertEqual(model["replay"]["identical"], model["replay"]["traces"], f"{name}: every saved trace replays the same")
            self.assertRegex(model["date"], r"^\d{4}-\d{2}-\d{2}$")
            for saved in (f"model-run.{name}.json", f"model-traces.{name}.json"):
                self.assertTrue((RESULTS / saved).exists(), f"{saved} is committed, so anyone can rebuild the figures")
                self.assertLess((RESULTS / saved).stat().st_size, 1_000_000, saved)
        alone = [model["clock_or_memory"]["bare_passed"] for model in models]
        self.assertTrue(any(alone), "the page says the models got some of the date tasks right alone")

    def assert_paired_matches_rows(self, model):
        """The task-by-task comparison the page prints: who gained, who lost, and how even that split is."""
        name = model["id"]
        rows = model["rows"]
        paired = model["paired"]
        gained = [row["id"] for row in rows if row["harness"] and not row["bare"]]
        lost = [row["id"] for row in rows if row["bare"] and not row["harness"]]
        self.assertEqual((paired["gained_ids"], paired["lost_ids"]), (gained, lost), name)
        self.assertEqual((paired["gained"], paired["lost"]), (len(gained), len(lost)), name)
        self.assertEqual(paired["both_right"], sum(1 for row in rows if row["bare"] and row["harness"]), name)
        self.assertEqual(paired["both_wrong"], sum(1 for row in rows if not row["bare"] and not row["harness"]), name)
        self.assertEqual(paired["gained"] + paired["lost"] + paired["both_right"] + paired["both_wrong"], len(rows), name)
        self.assertEqual(paired["gained"] - paired["lost"], model["harness"]["passed"] - model["bare"]["passed"], f"{name}: the net change is the lift")
        silent = {row["id"]: row["no_reply"].split("+") for row in rows}
        self.assertEqual(paired["gained_after_no_reply"], sum(1 for task in gained if "bare" in silent[task]), name)
        self.assertEqual(paired["lost_to_no_reply"], sum(1 for task in lost if "harness" in silent[task]), name)
        expected = sign_test(len(gained), len(lost))
        self.assertTrue(math.isclose(paired["sign_test_p"], expected, rel_tol=1e-3), f"{name}: sign test {paired['sign_test_p']} vs {expected}")

    def test_a_model_alone_is_sent_only_the_question(self):
        """The page says a model alone was never sent the date, that one reply quotes a date line anyway, that
        the tasks' clock is fixed to the same UTC date the runs were made on (so that line was right), and that
        one pass alone is generous: the task asks to save a note, its checker reads only a count, and the reply
        claims a note was saved."""
        bench_js = text_of(APP / "harness" / "bench.js")
        suite_js = text_of(HARNESS / "suite.js")
        self.assertIn('messages: [{ role: "user", content: S.barePrompt(task) }]', bench_js, "alone, a model gets one message")
        self.assertIn("const barePrompt = (task) => task.prompt + BARE_SUFFIX;", suite_js, "that message is the question and the answer-line request")
        suffix = re.search(r'const BARE_SUFFIX = "((?:[^"\\]|\\.)*)";', suite_js).group(1)
        self.assertFalse(re.search(r"\d|today|date", suffix, re.I), "the answer-line request carries no date")
        suite = self.bench["suite"]
        prompts = suite_prompts(suite_js)
        self.assertEqual(len(prompts), suite["tasks"], "every task's prompt was read from suite.js")
        pinned = re.search(r'iso: "(\d{4}-\d{2}-\d{2})"', suite_js).group(1)
        today = spellings_of(pinned)
        clock_tasks = sorted(set(suite["clock_or_memory_tasks"]) - set(suite["memory_tasks"]))
        for task in clock_tasks:
            said = [spelling for spelling in today if spelling in prompts[task].lower()]
            self.assertEqual(said, [], f"{task} asks about today without saying which day it is")
        for path in (APP / "harness" / "bench.js", HARNESS / "suite.js", ENGINE, KIT):
            self.assertNotIn(DATE_LINE, text_of(path), f"{path.name}: we never wrote a date line")
        run = json.loads(text_of(RESULTS / DATE_LINE_RUN))
        quoting = sorted(task for task, row in run["bare"].items() if DATE_LINE in (row.get("reply") or ""))
        self.assertTrue(quoting, "a saved reply quotes a date line back, so the provider added one")
        generous = []
        for model in self.bench["models"]:
            name = model["id"]
            saved = json.loads(text_of(RESULTS / f"model-run.{name}.json"))
            days = sorted({call["at"][:10] for call in saved["calls"]})
            self.assertEqual(days, [pinned], f"{name}: every call was made on the date the tasks' clock is fixed to (UTC)")
            self.assertEqual(model["date"], pinned, f"{name}: the run date the page prints is that same date")
            for task in clock_tasks:
                row = saved["bare"][task]
                if row["pass"] and NOTE_CLAIM.search(row.get("reply") or ""):
                    generous.append((name, task))
        self.assertEqual(len(generous), 1, f"the page calls one pass alone on a date task generous: {generous}")
        task = generous[0][1]
        self.assertRegex(prompts[task], r"(?i)\bsave a note\b", f"{task} also asks to save a note")
        counted = re.search(rf'id: "{task}",\s*prompt: [^\n]*,\s*rule: int\("\d+"\)', suite_js)
        self.assertTrue(counted, f"{task}: the checker reads only the count, so the false claim does not fail it")

    def test_static_page_claims_no_figures(self):
        for element_id in FILLED_FROM_BENCH:
            self.assertFalse(re.search(r"\d", container(self.html, element_id)), f"#{element_id} is filled from bench.json")
        table = re.search(r'<table class="versus compare">(.*?)</table>', self.html, re.S).group(1)
        self.assertFalse(re.search(r"\d", re.sub(r"<[^>]+>", " ", table)), "no numbers are claimed for other systems")
        for number in range(1, 7):
            self.assertIn(f'"harness.limit{number}"', self.html, "the page says what it cannot do")
        self.assertIn('"harness.versusLede"', self.html, "the page says where other harnesses are better")
        self.assertIn('"./bench.json"', self.js.replace("'", '"'))

    def test_docs_and_portfolio_card(self):
        readme = text_of(APP / "README.md")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f"- **{published}** – ", readme)
        self.assertIn("https://juw12.github.io/projects/glow/harness/", readme)
        self.assertIn("bench.js", text_of(APP / "harness" / "README.md"), "how to rebuild the figures is written down")
        card = next(app for app in json.loads(text_of(REPO / "scripts" / "apps.json"))["apps"] if app["id"] == "glow")
        self.assertIn("GlowHarness", card["tags"])
        self.assertIn({"label": "GlowHarness", "path": "glow/harness/"}, card["card_links"])

    @unittest.skipUnless(shutil.which("node"), "Install Node to run the engine's checks and rebuild bench.json")
    def test_engine_checks_pass_and_figures_rebuild_the_same(self):
        for mode in ("--check", "--verify"):
            done = subprocess.run(
                [shutil.which("node"), "apps/glow/harness/bench.js", mode],
                cwd=REPO, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
            )
            self.assertEqual(done.returncode, 0, f"bench.js {mode}:\n{done.stdout[-1500:]}\n{done.stderr[-1500:]}")


@unittest.skipUnless(HAVE_PLAYWRIGHT, "Install the optional Playwright test dependency to run browser checks")
class GlowHarnessInBrowser(unittest.TestCase):
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

    def open_harness(self, query=""):
        """The page in a fresh profile, with the three model providers unreachable."""
        context = self.browser.new_context()
        self.addCleanup(context.close)
        context.route(PROVIDER_REQUESTS, lambda route: route.abort())
        page = context.new_page()
        self.page_errors = []
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))
        page.goto(self.pages.base + "harness/" + query)
        return page

    def wait_for_run(self, page):
        """Wait for the run to end, saying 'once' to each permission prompt. Returns the final state."""
        while True:
            page.wait_for_function(RUN_SETTLED, timeout=RUN_TIMEOUT_MS)
            state = page.evaluate(PAGE_STATE).get("run", "")
            if state != "asking":
                return state
            prompt = page.query_selector(OPEN_PROMPT)
            if prompt is None:
                page.wait_for_timeout(100)
                continue
            prompt.evaluate("(node) => { node.dataset.answeredByTest = '1'; }")
            prompt.query_selector('button[data-answer="once"]').click()
            page.wait_for_timeout(60)

    def test_engine_checks_pass_in_a_real_browser(self):
        page = self.open_harness("?selftest=1")
        page.wait_for_function(SELFTEST_ENDED, timeout=SELFTEST_TIMEOUT_MS)
        state = page.evaluate(PAGE_STATE)
        self.assertEqual(state.get("selftest"), "pass", page.inner_text("#selftest-result"))
        counted = self.checks_in_bench()
        self.assertEqual((int(state["selftestPassed"]), int(state["selftestTotal"])), (counted, counted), "the same checks bench.json counts")
        self.assertEqual(self.page_errors, [])

    def test_no_model_brain_answers_a_task_and_the_trace_replays(self):
        page = self.open_harness()
        page.wait_for_function(BENCH_LOADED, timeout=LOAD_TIMEOUT_MS)
        self.assertEqual(page.evaluate(PAGE_STATE).get("bench"), "ready", "bench.json loaded, so the figures are on the page")
        page.click('#brain-seg button[data-brain="rules"]')
        page.click(f'#example-chips .chip[title="{SUM_TASK}"]')
        self.assertEqual(self.wait_for_run(page), "done")
        answer = page.inner_text("#answer-text")
        self.assertIn(SUM_ANSWER, re.sub(r"\D", "", answer), f"the calculator tool did the sum: {answer!r}")
        page.click("#replay-btn")
        page.wait_for_function(REPLAY_ENDED, timeout=RUN_TIMEOUT_MS)
        self.assertEqual(page.evaluate(PAGE_STATE).get("replay"), "same", page.inner_text("#replay-result"))
        self.assertEqual(self.page_errors, [])

    def test_opens_with_no_network_after_one_visit_to_glow(self):
        """Home once with a network, then none at all: the page comes from the copy the service worker saved,
        the figures are on it, and the no-model brain still finishes a task."""
        context = self.browser.new_context()
        self.addCleanup(context.close)
        page_errors = []
        provider_calls = []
        context.on("request", lambda request: provider_calls.append(request.url) if PROVIDER_REQUESTS.match(request.url) else None)
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(self.pages.base)
        worker = page.evaluate(HOME_WORKER_STATE, [urlsplit(self.pages.base).path, HOME_WORKER_WAIT_S])
        self.assertEqual(worker, "activated", "the home page's service worker saved Glow's files")
        context.set_offline(True)
        page.goto(self.pages.base + "harness/")
        page.wait_for_function(BENCH_LOADED, timeout=LOAD_TIMEOUT_MS)
        self.assertEqual(page.evaluate(PAGE_STATE).get("bench"), "ready", "bench.json came from the saved copy")
        page.click('#brain-seg button[data-brain="rules"]')
        page.click(f'#example-chips .chip[title="{SUM_TASK}"]')
        self.assertEqual(self.wait_for_run(page), "done")
        answer = page.inner_text("#answer-text")
        self.assertIn(SUM_ANSWER, re.sub(r"\D", "", answer), f"the calculator tool did the sum with no network: {answer!r}")
        self.assertEqual(page_errors, [])
        self.assertEqual(provider_calls, [], "the no-model brain never reaches for a provider")

    def expect_bubble(self, page, message, **wanted):
        """Poll until the assistant button is in this state (its fade takes a moment), then insist on it."""
        deadline = time.monotonic() + BUBBLE_WAIT_S
        while True:
            state = page.evaluate(BUBBLE_STATE)
            if all(state[key] == value for key, value in wanted.items()) or time.monotonic() >= deadline:
                break
            page.wait_for_timeout(50)
        self.assertEqual({key: state[key] for key in wanted}, wanted, f"{message}: {state}")

    def test_assistant_button_steps_aside_for_run_and_still_answers_the_keyboard(self):
        """At phone width the floating Glow assistant button can sit on Run. There it turns see-through, so the
        tap reaches Run. It is never removed: Tab still finds it, focus shows it, Enter opens it, Space closes it."""
        context = self.browser.new_context(viewport=PHONE, service_workers="block")
        self.addCleanup(context.close)
        context.route(PROVIDER_REQUESTS, lambda route: route.abort())
        context.route(LEAD_PAGE, lambda route: route.fulfill(status=200, content_type="text/html", body=LEAD_STUB))
        page_errors = []
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(self.pages.base + "harness/")
        page.wait_for_function(BENCH_LOADED, timeout=LOAD_TIMEOUT_MS)
        page.wait_for_selector(".glow-widget-bubble", state="attached", timeout=LOAD_TIMEOUT_MS)

        shared = page.evaluate(RUN_UNDER_BUBBLE)
        self.assertGreaterEqual(shared["share"], COVER_LIMIT, f"at this width the button can sit on Run: {shared}")
        self.expect_bubble(page, "over Run the button steps aside", aside=True, seeThrough=True)

        before = page.evaluate(FOCUS_BEFORE_BUBBLE)
        self.assertTrue(before, "some control comes before the assistant button in the tab order")
        page.keyboard.press("Tab")
        page.evaluate(RUN_UNDER_BUBBLE)
        self.expect_bubble(page, f"Tab from {before} lands on it, and focus shows it even over Run", aside=True, focused=True, shown=True)
        page.keyboard.press("Enter")
        self.expect_bubble(page, "Enter opens the assistant", open=True, shown=True)
        page.keyboard.press("Space")
        self.expect_bubble(page, "Space closes it again", open=False, focused=True, shown=True)
        page.evaluate(DROP_FOCUS)
        self.expect_bubble(page, "once focus has left, it steps aside again", aside=True, seeThrough=True)

        page.click('#brain-seg button[data-brain="rules"]')
        page.fill("#task-box", SUM_TASK)
        shared = page.evaluate(RUN_UNDER_BUBBLE)
        self.expect_bubble(page, "over Run the button steps aside", aside=True, seeThrough=True)
        self.assertTrue(page.evaluate(POINT_IS_ON_RUN, [shared["x"], shared["y"]]), f"a tap inside the button's own outline reaches Run: {shared}")
        page.mouse.click(shared["x"], shared["y"])
        self.expect_bubble(page, "the tap went to Run, not to the assistant", open=False)
        self.assertEqual(self.wait_for_run(page), "done")
        answer = page.inner_text("#answer-text")
        self.assertIn(SUM_ANSWER, re.sub(r"\D", "", answer), f"the run that tap started did the sum: {answer!r}")
        self.assertEqual(page_errors, [])

    def test_assistant_button_never_sits_on_an_open_permission_question(self):
        """While a permission question is open the assistant button keeps off it altogether, its text included,
        also where it covers no button by a fifth. Once the question is answered the button may sit there again."""
        context = self.browser.new_context(viewport=PHONE_TALL, service_workers="block")
        self.addCleanup(context.close)
        context.route(PROVIDER_REQUESTS, lambda route: route.abort())
        page_errors = []
        page = context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.goto(self.pages.base + "harness/")
        page.wait_for_function(BENCH_LOADED, timeout=LOAD_TIMEOUT_MS)
        page.wait_for_selector(".glow-widget-bubble", state="attached", timeout=LOAD_TIMEOUT_MS)

        page.click('#brain-seg button[data-brain="rules"]')
        page.fill("#task-box", NOTE_TASK)
        page.click("#run-btn")
        page.wait_for_selector(OPEN_QUESTION, state="attached", timeout=RUN_TIMEOUT_MS)

        under = page.evaluate(QUESTION_ALONE_UNDER_BUBBLE, [OPEN_QUESTION, PRESSABLE, COVER_LIMIT])
        self.assertIsNotNone(under, "at this size the button can be over the open question without covering a button by a fifth")
        self.assertGreater(under["area"], 0, under)
        self.assertLess(under["control"], COVER_LIMIT, under)
        self.expect_bubble(page, f"over the open question the button steps aside: {under}", aside=True, seeThrough=True)

        self.assertEqual(self.wait_for_run(page), "done")
        after = page.evaluate(QUESTION_ALONE_UNDER_BUBBLE, [ANSWERED_QUESTION, PRESSABLE, COVER_LIMIT])
        self.assertIsNotNone(after, "the answered question can be scrolled under the button too")
        self.assertGreater(after["area"], 0, after)
        self.expect_bubble(page, f"over an answered question the button is back: {after}", aside=False, shown=True)
        self.assertEqual(page_errors, [])

    @staticmethod
    def checks_in_bench():
        return json.loads(text_of(HARNESS / "bench.json"))["checks"]["total"]


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
