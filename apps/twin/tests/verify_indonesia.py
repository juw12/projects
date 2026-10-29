#!/usr/bin/env python3
"""Twin Indonesia (web/id/) in a real headless browser; skips if none is installed.

1. tests/indonesia_engine_checks.html - unit checks for web/id/engine.js (fees, lots,
                                        ticks, hours, orders, risk, Scam Shield, scoring)
2. web/id/index.html?selftest         - smoke test of every route: lot orders, posts and
                                        Scam Shield, plans, lessons, simulation, reset

Pages load straight from disk, so no server or network is needed, and every run uses a
throwaway browser profile that never touches your own browser data.

    python apps/twin/tests/verify_indonesia.py
    python apps/twin/tests/verify_indonesia.py --screenshots DIR   # also save PNGs to DIR
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

from verify_browser import BrowserProfile

APP = Path(__file__).resolve().parent.parent
TESTS = APP / "tests"
MODULE = APP / "web" / "id"

# (file name, suffix for web/id/index.html, layout, height in px). Headless Chromium will
# not lay a top-level page out narrower than ~500 px, so phone shots go through a frame.
PHONE_WIDTH = 390
SCREENSHOTS = [
    ("01-welcome", "", "phone", 900),
    ("02-home", "?demo&offline#home", "phone", 1400),
    ("03-markets-idx", "?demo&offline#markets/IDX", "phone", 1200),
    ("04-asset-bbca", "?demo&offline#asset/BBCA", "phone", 1700),
    ("05-order-ticket", "?demo&offline&ticket=BBCA#asset/BBCA", "phone", 1000),
    ("06-portfolio", "?demo&offline#portfolio", "phone", 1700),
    ("07-community", "?demo&offline#community/crypto", "phone", 1300),
    ("08-analyst-desk", "?demo&offline#desk", "desktop", 1500),
    ("09-lesson-fees", "?demo&offline#lesson/fees", "phone", 1500),
    ("10-plans", "?demo&offline#plans", "desktop", 900),
    ("11-home-desktop", "?demo&offline#home", "desktop", 1100),
]


def find_browser():
    candidates = [
        os.environ.get("TWIN_TEST_BROWSER"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("microsoft-edge"),
        str(Path(os.environ.get("PROGRAMFILES", "")) / "Google/Chrome/Application/chrome.exe"),
        str(Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Microsoft/Edge/Application/msedge.exe"),
        str(Path(os.environ.get("PROGRAMFILES", "")) / "Microsoft/Edge/Application/msedge.exe"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


def stop_tree(process):
    """End the isolated test browser and its helpers (never a normal profile)."""
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    process.kill()
    process.wait()


def run_browser(browser, url, extra, budget_ms=15000, timeout=50):
    """Load one page headless and return whatever it printed (the DOM for --dump-dom)."""
    with BrowserProfile(prefix="twin-id-browser-") as profile:
        command = [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-background-networking",
            "--user-data-dir=" + profile,
            "--virtual-time-budget=%d" % budget_ms,
            *extra,
            url,
        ]
        if os.environ.get("CI") or (hasattr(os, "geteuid") and os.geteuid() == 0):
            command.insert(1, "--no-sandbox")
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            output, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop_tree(process)
            output = b""
        finally:
            stop_tree(process)
        return output.decode("utf-8", errors="replace")


def report_from(dom, element_id):
    match = re.search(r'<pre id="%s">(.*?)</pre>' % element_id, dom, flags=re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(html.unescape(match.group(1)))
    except ValueError:
        return None


def take_screenshots(browser, target):
    target.mkdir(parents=True, exist_ok=True)
    index_uri = (MODULE / "index.html").as_uri()
    frame_uri = (TESTS / "indonesia_frame.html").as_uri()
    for name, suffix, layout, height in SCREENSHOTS:
        path = target / (name + ".png")
        if layout == "phone":
            url = "%s?w=%d#%s" % (frame_uri, PHONE_WIDTH, quote(suffix, safe=""))
            width = PHONE_WIDTH + 130
            height += 32
        else:
            url = index_uri + suffix
            width = 1280
        run_browser(browser, url, ["--screenshot=" + str(path), "--window-size=%d,%d" % (width, height),
                                   "--hide-scrollbars"], budget_ms=6000)
        print("screenshot %s: %s" % (path.name, "ok" if path.exists() else "missing"))


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--screenshots", type=Path, metavar="DIR", help="also save screenshots to DIR")
    args = parser.parse_args()
    # Failure details can contain rupiah signs or ellipses; never crash a cp1252 console on them.
    sys.stdout.reconfigure(errors="replace")

    browser = find_browser()
    if not browser:
        print("SKIPPED: Chrome/Chromium/Edge not installed; Twin Indonesia browser checks were not run.")
        return 0

    failures = 0
    engine = report_from(run_browser(browser, (TESTS / "indonesia_engine_checks.html").as_uri(), ["--dump-dom"]),
                         "results")
    if engine is None:
        print("FAIL engine checks did not report (browser crashed or timed out)")
        failures += 1
    else:
        print("engine checks: %d/%d passed" % (engine["total"] - len(engine["failed"]), engine["total"]))
        for item in engine["failed"]:
            print("  FAIL %s: %s" % (item["name"], item["error"]))
        failures += len(engine["failed"])

    selftest = report_from(run_browser(browser, (MODULE / "index.html").as_uri() + "?selftest", ["--dump-dom"]),
                           "selftest")
    if selftest is None:
        print("FAIL app self-test did not report (browser crashed or timed out)")
        failures += 1
    else:
        failed_steps = selftest["failed"]
        print("app self-test: %d/%d steps passed" % (selftest["steps"] - len(failed_steps), selftest["steps"]))
        for item in failed_steps:
            print("  FAIL %s: %s" % (item["name"], str(item.get("error", ""))[:400]))
        for error in selftest["errors"]:
            if not any(error.startswith(step["name"]) for step in failed_steps):
                print("  ERROR " + error)
        if not selftest["ok"]:
            failures += max(1, len(failed_steps))

    if args.screenshots:
        take_screenshots(browser, args.screenshots)

    if failures:
        print("FAILED: %d Twin Indonesia check(s)" % failures)
        return 1
    print("PASSED: Twin Indonesia engine checks and app self-test")
    return 0


if __name__ == "__main__":
    sys.exit(main())
