"""Browser checks and timings for GlowSpark, run in headless Chromium against a local static server.

    python browser_check.py check      every flow, language, width and the offline reload -> browser_check.json
    python browser_check.py measure    median cold start and writing speed             -> browser.json

Timings are taken with the files served from this same machine, so they leave out network download time.
"""
import argparse
import functools
import json
import os
import re
import statistics
import sys
import threading
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

for proxy_name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(proxy_name, None)
os.environ["NO_PROXY"] = "localhost,127.0.0.1"
os.environ.setdefault("PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS", "1")

from playwright.sync_api import sync_playwright  # noqa: E402

HERE = Path(__file__).resolve().parent
LANGUAGES = ["en", "id", "zh-CN", "zh-TW"]
WIDTHS = [320, 390, 768, 1024, 1440]
READY_TIMEOUT = 180_000
WRITE_TIMEOUT = 600_000

# Predicates are passed as functions: string expressions are polled with eval, which the page's CSP forbids.
STOP_AFTER_A_FEW_WORDS_JS = """
() => {
  const count = () => document.querySelectorAll("#tale-text .w").length;
  document.getElementById("again-btn").click();
  let cleared = false;
  const started = Date.now();
  const timer = setInterval(() => {
    if (!cleared && count() < 12) cleared = true;
    if ((cleared && count() >= 12) || Date.now() - started > 60000) {
      clearInterval(timer);
      document.getElementById("stop-btn").click();
    }
  }, 10);
}
"""

OVERFLOW_JS = """
() => {
  const width = document.documentElement.clientWidth;
  const over = document.documentElement.scrollWidth - width;
  const offenders = [];
  if (over > 1) {
    for (const element of document.querySelectorAll("body *")) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.right > width + 1) {
        const name = element.id ? "#" + element.id : element.tagName.toLowerCase() + "." + String(element.className);
        offenders.push(name + " right=" + Math.round(box.right));
        if (offenders.length >= 4) break;
      }
    }
  }
  return { over, offenders };
}
"""

NUMBERS_JS = """
(bench) => {
  const megabytes = (bytes) => (bytes / 1e6).toFixed(1) + " MB";
  const text = (id) => (document.getElementById(id) || {}).textContent || "";
  const problems = [];
  const need = (where, value) => {
    if (!text(where).includes(value)) problems.push(where + " lacks " + value);
  };
  if (bench.download) {
    need("stats", megabytes(bench.download.total_bytes));
    need("versus-download", megabytes(bench.download.total_bytes));
  } else {
    problems.push("bench.json has no download block");
  }
  need("stats", (bench.parameters / 1e6).toFixed(1) + "M");
  need("stats", String(bench.train.books));
  need("stats", megabytes(bench.train.bytes));
  if (bench.training && bench.training.minutes) need("stats", Math.round(bench.training.minutes) + " min");
  else problems.push("bench.json has no training minutes");
  need("stats", bench.held_out.perplexity_per_token.toFixed(1));
  const expected = Object.values(bench.bits_per_byte || {})
    .filter((value) => typeof value === "number")
    .map((value) => value.toFixed(3));
  const shown = Array.from(document.querySelectorAll("#bars b")).map((cell) => cell.textContent);
  if (!shown.length) problems.push("no bars rendered");
  for (const value of shown) {
    if (!expected.includes(value)) problems.push("bar " + value + " is not in bench.json");
  }
  need("bars-lede", String(bench.held_out.books));
  need("bars-lede", megabytes(bench.held_out.bytes));
  if (bench.browser) {
    need("bench-note", (bench.browser.cold_start_ms / 1000).toFixed(1));
    need("bench-note", String(Math.round(bench.browser.words_per_second)));
    need("bench-note", bench.browser.hardware);
  } else {
    problems.push("bench.json has no browser block");
  }
  if (bench.built && text("refs-date") !== bench.built) problems.push("refs-date is not " + bench.built);
  return { problems, bars: shown, stats: text("stats") };
}
"""


class QuietHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".bin": "application/octet-stream",
        ".svg": "image/svg+xml",
        ".css": "text/css",
        ".html": "text/html",
    }

    def log_message(self, *args):
        pass


def start_server(web_root):
    handler = functools.partial(QuietHandler, directory=str(web_root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def say(*parts):
    print(*parts, flush=True)


def launch_browser(playwright):
    """Playwright's own Chromium first; the installed Edge (same engine) when that build is missing."""
    try:
        return playwright.chromium.launch(args=["--no-proxy-server"]), "headless Chromium"
    except Exception as error:
        say("bundled Chromium did not start:", str(error).splitlines()[0])
        return playwright.chromium.launch(channel="msedge", args=["--no-proxy-server"]), "headless Microsoft Edge"


class Run:
    def __init__(self, base):
        self.base = base
        self.results = []
        self.phase = "start"
        self.console_errors = []
        self.page_errors = []
        self.foreign_requests = []
        self.handoff_requests = []
        self.handoff_console = []
        self.info = {}

    def check(self, name, ok, detail=""):
        self.results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:600]})
        say("PASS" if ok else "FAIL", name, "-", str(detail)[:300])

    def section(self, name, function):
        self.phase = name
        try:
            function()
        except Exception as error:  # a broken flow is a failed check, not a crashed run
            self.check(name + " (ran to the end)", False, f"{type(error).__name__}: {error}")
            traceback.print_exc()
            sys.stderr.flush()

    def watch_context(self, context):
        def on_request(request):
            url = request.url
            if url.startswith(self.base) or url.split(":", 1)[0] in ("data", "blob", "about"):
                return
            try:
                origin_page = request.frame.url
            except Exception:  # service-worker requests have no frame
                origin_page = ""
            record = {"phase": self.phase, "url": url, "from": origin_page}
            if "/chat/" in origin_page:
                # GlowChat is a separate, online app; its own calls after the handoff
                # are listed apart and do not count against the Spark page.
                self.handoff_requests.append(record)
                return
            self.foreign_requests.append(record)

        context.on("request", on_request)

    def watch_page(self, page):
        def on_console(message):
            if message.type == "error":
                record = {"phase": self.phase, "text": message.text[:300], "from": page.url}
                if "/chat/" in page.url:
                    self.handoff_console.append(record)
                    return
                self.console_errors.append(record)

        def on_page_error(error):
            self.page_errors.append({"phase": self.phase, "text": str(error)[:300]})

        page.on("console", on_console)
        page.on("pageerror", on_page_error)


def spark_state(page):
    return page.evaluate("document.documentElement.dataset.sparkState || ''")


def wait_ready(page, timeout=READY_TIMEOUT):
    page.wait_for_function("() => document.documentElement.dataset.sparkState === 'ready'", timeout=timeout)


def word_count(page):
    return page.locator("#tale-text .w").count()


def wait_tale(page, more_than=0, timeout=WRITE_TIMEOUT):
    page.wait_for_function(
        "(least) => document.documentElement.dataset.sparkState === 'ready'"
        " && document.querySelectorAll('#tale-text .w').length > least",
        arg=more_than,
        timeout=timeout,
    )
    return word_count(page)


def overflow(page):
    return page.evaluate(OVERFLOW_JS)


def new_page(run, context, path, width=1280, height=900):
    page = context.new_page()
    page.set_viewport_size({"width": width, "height": height})
    run.watch_page(page)
    page.goto(run.base + path, wait_until="load")
    return page


def set_language(page, language):
    page.evaluate("(language) => window.GlowLocale.save(language, window.GlowLocale.get().region)", language)
    page.wait_for_timeout(700)
    page.wait_for_load_state("load")
    wait_ready(page)
    page.wait_for_timeout(300)


def run_checks(playwright, web_root, shots):
    server, base = start_server(web_root)
    run = Run(base)
    browser, run.info["browser"] = launch_browser(playwright)
    run.info["chromium"] = browser.version
    context = browser.new_context()
    run.watch_context(context)
    bench_path = web_root / "spark" / "bench.json"
    bench = json.loads(bench_path.read_text(encoding="utf-8")) if bench_path.exists() else None

    def selftest():
        page = new_page(run, context, "/spark/?selftest=1")
        page.wait_for_function(
            "() => ['pass', 'fail'].includes(document.documentElement.dataset.selftest)",
            timeout=READY_TIMEOUT,
        )
        data = page.evaluate("Object.assign({}, document.documentElement.dataset)")
        result_text = page.inner_text("#selftest-result")
        run.info["selftest"] = {"state": data.get("selftest"), "max_abs_diff": data.get("selftestDiff"), "text": result_text}
        run.check("G2 selftest passes in the browser", data.get("selftest") == "pass", f"diff {data.get('selftestDiff')} | {result_text}")
        diff = float(data.get("selftestDiff") or "nan")
        run.check("G2 max abs logit diff < 1e-2", diff < 1e-2, diff)
        page.close()

    def flows():
        page = new_page(run, context, "/spark/")
        wait_ready(page)
        run.info["ready_ms_under_test_load"] = page.evaluate("document.documentElement.dataset.sparkReadyMs")
        chips = page.locator("#starter-chips .chip[data-starter]")
        run.check("starter chips are shown", chips.count() >= 3, chips.count())

        chips.first.click()
        first_words = wait_tale(page)
        first_text = page.inner_text("#tale-text")
        run.info["sample_medium"] = first_text
        run.check("a starter writes a tale", first_words >= 20, f"{first_words} words")
        live = page.locator("#stats .stat.live b").all_inner_texts()
        run.check("live tiles show this device's numbers", len(live) == 2 and "…" not in "".join(live), live)

        page.locator('#length-seg [data-length="320"]').click()
        page.evaluate(STOP_AFTER_A_FEW_WORDS_JS)
        page.wait_for_timeout(1500)
        wait_ready(page, WRITE_TIMEOUT)
        stopped_words = word_count(page)

        page.locator("#again-btn").click()
        page.wait_for_timeout(200)
        full_words = wait_tale(page)
        full_text = page.inner_text("#tale-text")
        run.info["sample_long"] = full_text
        run.check("stop ends the tale early", 12 <= stopped_words < 0.8 * full_words, f"stopped at {stopped_words}, full run {full_words}")
        run.check("another version differs", full_text != first_text, "")

        page.locator("#more-btn").click()
        more_words = wait_tale(page, more_than=full_words)
        run.check("keep writing adds words", more_words > full_words, f"{full_words} -> {more_words}")

        unsure = page.locator("#tale-text .w.unsure")
        run.info["unsure_words"] = unsure.count()
        run.info["tale_words"] = page.locator("#tale-text .w").count()
        target = unsure.first if unsure.count() else page.locator("#tale-text .w").nth(5)
        target.click()
        page.wait_for_function(
            "() => { const pop = document.getElementById('alt-pop');"
            " return !!pop && !pop.hidden && pop.getClientRects().length > 0; }",
            timeout=10_000,
        )
        alternatives = page.locator("#alt-list .alt[data-alt]")
        run.check("tapping a word shows alternatives", alternatives.count() >= 1, alternatives.all_inner_texts())
        alternatives.first.click()
        page.wait_for_function(
            "() => document.documentElement.dataset.sparkState === 'ready'"
            " && document.querySelector('#tale-text .w.chosen') !== null",
            timeout=WRITE_TIMEOUT,
        )
        run.check("choosing an alternative branches the tale", page.locator("#tale-text .w.chosen").count() == 1, page.inner_text("#tale-text")[:200])

        theme_before = page.evaluate("document.documentElement.dataset.theme || ''")
        page.locator("#theme-btn").click()
        theme_after = page.evaluate("document.documentElement.dataset.theme || ''")
        run.check("theme button switches the theme", theme_before != theme_after, f"{theme_before} -> {theme_after}")
        page.locator("#theme-btn").click()

        for width in WIDTHS:
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(200)
            measured = overflow(page)
            run.check(f"no sideways scroll with a tale at {width}px", measured["over"] <= 1, measured)

        if bench:
            numbers = page.evaluate(NUMBERS_JS, bench)
            run.info["rendered_bars"] = numbers["bars"]
            run.info["rendered_stats"] = numbers["stats"]
            run.check("G7 every rendered figure equals bench.json", not numbers["problems"], numbers["problems"])
        else:
            run.check("G7 every rendered figure equals bench.json", False, "bench.json does not exist yet")

        for width, height in ((1440, 900), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(300)
            page.screenshot(path=str(shots / f"spark-{width}-top.png"))
            page.screenshot(path=str(shots / f"spark-{width}.png"), full_page=True)

        page.set_viewport_size({"width": 1280, "height": 900})
        page.locator("#chat-btn").click()
        page.wait_for_timeout(2500)
        run.info["chat_handoff_url"] = page.url.replace(run.base, "")
        run.check("the GlowChat button opens GlowChat", "/chat" in page.url, page.url.replace(run.base, ""))
        page.close()

        page = new_page(run, context, "/spark/?q=The%20little%20fox%20ran")
        words = wait_tale(page)
        run.check("?q= prefills and writes", words >= 10 and "fox" in page.input_value("#prompt-box"), f"{words} words")
        page.close()

    def languages():
        page = new_page(run, context, "/spark/")
        wait_ready(page)
        texts = {}
        for language in LANGUAGES:
            set_language(page, language)
            body = page.inner_text("body")
            texts[language] = body
            leaked = sorted(set(re.findall(r"\bspark\.(?!bin\b|json\b|js\b)[A-Za-z][\w.]*", body)))
            run.check(f"{language}: no untranslated keys on the page", not leaked, leaked[:6])
            html_lang = page.evaluate("document.documentElement.lang")
            run.check(f"{language}: html lang is set", html_lang.lower().startswith(language.lower()[:2]), html_lang)
            for width in WIDTHS:
                page.set_viewport_size({"width": width, "height": 900})
                page.wait_for_timeout(150)
                measured = overflow(page)
                run.check(f"{language}: no sideways scroll at {width}px", measured["over"] <= 1, measured)
            if language != "en":
                page.set_viewport_size({"width": 390, "height": 844})
                page.evaluate("window.scrollTo(0, 0)")
                page.screenshot(path=str(shots / f"spark-390-{language}.png"))
        run.check("the four languages render four different pages", len(set(texts.values())) == 4, "")
        has_cjk = all(re.search(r"[\u4e00-\u9fff]", texts[language]) for language in ("zh-CN", "zh-TW"))
        run.check("the Chinese pages contain Chinese", has_cjk, "")
        set_language(page, "en")
        page.close()

    def home():
        page = new_page(run, context, "/")
        page.wait_for_timeout(1500)
        tiles = page.locator(".app-tile")
        run.check("home shows five app tiles", tiles.count() == 5, tiles.count())
        run.check("home links to GlowSpark", page.locator('a[href*="spark"]').count() >= 1, "")
        for width in (390, 1280):
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(300)
            measured = overflow(page)
            run.check(f"home: no sideways scroll at {width}px", measured["over"] <= 1, measured)
            boxes = [tiles.nth(index).bounding_box() for index in range(tiles.count())]
            run.info[f"home_tiles_{width}"] = [[round(box[key]) for key in ("x", "y", "width", "height")] for box in boxes if box]
            page.screenshot(path=str(shots / f"home-{width}.png"), full_page=True)
        page.close()

    def offline():
        page = new_page(run, context, "/spark/")
        wait_ready(page)
        page.evaluate("navigator.serviceWorker.ready.then(() => true)")
        if not page.evaluate("navigator.serviceWorker.controller !== null"):
            page.reload(wait_until="load")
            wait_ready(page)
        controlled = page.evaluate("navigator.serviceWorker.controller !== null")
        run.check("the service worker controls the page", controlled, "")
        page.wait_for_timeout(5000)
        context.set_offline(True)
        server.shutdown()
        server.server_close()
        page.reload(wait_until="load")
        wait_ready(page, 60_000)
        page.locator("#starter-chips .chip[data-starter]").first.click()
        words = wait_tale(page)
        run.check("G5 offline reload still loads and writes", words >= 20, f"{words} words with the server stopped")
        stats = page.inner_text("#stats")
        run.check("offline reload still shows the benchmark figures", "MB" in stats, stats[:120])
        page.close()

    run.section("selftest", selftest)
    run.section("flows", flows)
    run.section("languages", languages)
    run.section("home", home)
    run.section("offline", offline)

    online_console = [entry for entry in run.console_errors if entry["phase"] != "offline"]
    online_page = [entry for entry in run.page_errors if entry["phase"] != "offline"]
    run.check("G6 no console errors or CSP violations", not online_console, online_console[:5])
    run.check("G6 no uncaught page errors", not online_page and not [e for e in run.page_errors if e["phase"] == "offline"], run.page_errors[:5])
    run.check("G5 no request leaves the origin", not run.foreign_requests, run.foreign_requests[:5])
    run.info["glowchat_handoff_requests"] = run.handoff_requests[:5]
    run.info["glowchat_handoff_console"] = run.handoff_console[:5]
    run.info["offline_console_errors"] = [entry for entry in run.console_errors if entry["phase"] == "offline"][:8]

    failed = [result for result in run.results if not result["ok"]]
    report = {"passed": len(run.results) - len(failed), "failed": len(failed), "results": run.results, "info": run.info}
    (HERE / "browser_check.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    say(f"SUMMARY {report['passed']} passed, {report['failed']} failed")
    return 1 if failed else 0


def run_measure(playwright, web_root, hardware):
    server, base = start_server(web_root)
    browser, browser_label = launch_browser(playwright)
    samples = []
    for _ in range(3):
        context = browser.new_context(service_workers="block")
        page = context.new_page()
        page.set_viewport_size({"width": 1280, "height": 900})
        page.goto(base + "/spark/", wait_until="load")
        wait_ready(page)
        ready_ms = int(page.evaluate("document.documentElement.dataset.sparkReadyMs"))
        page.locator("#starter-chips .chip[data-starter]").first.click()
        wait_tale(page)
        data = page.evaluate("Object.assign({}, document.documentElement.dataset)")
        samples.append(
            {
                "cold_start_ms": ready_ms,
                "tokens_per_second": float(data["sparkTokensPerSecond"]),
                "words_per_second": float(data["sparkWordsPerSecond"]),
            }
        )
        say("sample", samples[-1])
        context.close()
    major = browser.version.split(".")[0]
    result = {
        "hardware": f"{hardware}, {browser_label} {major}",
        "cold_start_ms": statistics.median(sample["cold_start_ms"] for sample in samples),
        "tokens_per_second": statistics.median(sample["tokens_per_second"] for sample in samples),
        "words_per_second": statistics.median(sample["words_per_second"] for sample in samples),
        "note": "",
        "samples": samples,
        "method": "median of 3 fresh browser contexts, service worker blocked, files served from the same machine",
    }
    (HERE / "browser.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8", newline="\n")
    say("MEASURED", json.dumps(result))
    server.shutdown()
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["check", "measure"])
    default_web = HERE.parent / "web" if (HERE.parent / "web" / "spark").exists() else HERE.parent / "repo" / "apps" / "glow" / "web"
    parser.add_argument("--web", default=str(default_web))
    parser.add_argument("--hardware", default="Intel Core Ultra 7 258V laptop")
    arguments = parser.parse_args()
    web_root = Path(arguments.web).resolve()
    shots = HERE / "shots"
    shots.mkdir(exist_ok=True)
    code = 2
    try:
        with sync_playwright() as playwright:
            if arguments.mode == "check":
                code = run_checks(playwright, web_root, shots)
            else:
                code = run_measure(playwright, web_root, arguments.hardware)
    except Exception:
        traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)


if __name__ == "__main__":
    main()
