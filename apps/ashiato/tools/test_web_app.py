"""Checks for the cross-platform web app (web/app/), run in headless Chromium.

1. Classifier parity: web/app/js/classifier.js must give the same drawer, score and expiry as
   prototypes/tidy/tidy.py for every case in prototypes/tidy/expected.json (same golden file
   the Swift tests use).
2. Smoke + screenshots (optional, --shots DIR): loads the app with sample days on a phone-sized
   viewport, checks there are no console errors, and saves a screenshot of every screen.

Usage: python tools/test_web_app.py [--shots out_dir]
"""
import argparse
import functools
import http.server
import json
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def serve(directory: Path) -> tuple[http.server.ThreadingHTTPServer, int]:
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


PARITY_JS = """
async () => {
  const { ClipClassifier, findExpiry } = await import('/web/app/js/classifier.js');
  const classifier = await ClipClassifier.load('/web/app/clip_lexicon.json');
  const golden = await (await fetch('/prototypes/tidy/expected.json')).json();
  const [y, m, d] = golden.today.split('-').map(Number);
  const today = new Date(y, m - 1, d);
  const failures = [];
  for (const c of golden.cases) {
    const r = classifier.classify(c.text);
    const e = findExpiry(c.text, today);
    const iso = e ? `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}` : null;
    if (r.drawer !== c.drawer || Math.abs(r.score - c.score) > 0.001 || iso !== (c.expiry ?? null)) {
      failures.push({ text: c.text, want: [c.drawer, c.score, c.expiry], got: [r.drawer, r.score, iso] });
    }
  }
  return { total: golden.cases.length, failures };
}
"""


def parity(page, base: str) -> bool:
    page.goto(f"{base}/web/app/clip_lexicon.json")
    result = page.evaluate(PARITY_JS)
    print(f"classifier parity: {result['total'] - len(result['failures'])}/{result['total']} match")
    for failure in result["failures"][:10]:
        print("  MISMATCH", json.dumps(failure, ensure_ascii=False))
    return not result["failures"]


SCREENS = [
    ("01-today", "#/today", None),
    ("02-days", "#/days", None),
    ("03-days-timeline", "#/days/timeline", None),
    ("04-map", "#/map", None),
    ("05-memories", "#/memories", None),
    ("06-tidy", "#/today?sheet=tidy", None),
    ("07-capture", "#/today?sheet=capture", None),
    ("08-settings", "#/today?sheet=settings", None),
    ("09-today-duo", "#/today", "duo"),
    ("10-onboarding", "#/today?onboarding=1", "english"),
]


def smoke(browser, base: str, shots: Path | None) -> bool:
    ok = True
    context = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="en-US")
    context.add_init_script(
        "localStorage.setItem('diary.sample','1');"
        "localStorage.setItem('onboarding.done','1');"
        "if (!localStorage.getItem('ui.languageMode')) localStorage.setItem('ui.languageMode','english');"
    )
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on("console", lambda message: errors.append(f"console: {message.text}") if message.type == "error" else None)
    for name, route, language in SCREENS:
        if language:
            page.evaluate(f"localStorage.setItem('ui.languageMode','{language}')")
        if "onboarding" in route:
            page.evaluate("localStorage.removeItem('onboarding.done')")
        page.goto(f"{base}/web/app/index.html{route}")
        page.wait_for_selector("[data-ready]", timeout=15000)
        page.wait_for_timeout(1200)
        if shots:
            shots.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(shots / f"{name}.png"))
        if "onboarding" in route:
            page.evaluate("localStorage.setItem('onboarding.done','1')")
        if language:
            page.evaluate("localStorage.setItem('ui.languageMode','english')")
    # Network failures for map tiles / weather are fine offline; anything else is a bug.
    real_errors = [e for e in errors if "Failed to load resource" not in e and "net::" not in e]
    for error in real_errors:
        print("  ", error)
    print(f"smoke: {len(SCREENS)} screens, {len(real_errors)} errors")
    ok = ok and not real_errors
    context.close()
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shots", type=Path)
    args = parser.parse_args()
    server, port = serve(ROOT)
    base = f"http://127.0.0.1:{port}"
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page()
            passed = parity(page, base)
            page.close()
            passed = smoke(browser, base, args.shots) and passed
            browser.close()
    finally:
        server.shutdown()
    print("PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
