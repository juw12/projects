"""iPhone widget feed check for the Haru web app (web/app/), run in headless Chromium.

Haru may only talk to the widget relay when a widget code is paired, the snapshot must hold exactly
the agreed fields (no diary text, photos or place names), and pairing has to work from Settings and
from the setup page link. The relay (ntfy.sh) and the weather service are intercepted, so nothing
leaves this computer.

The relay script is shared with PocketDex and lives in that repo. Pass a local copy with --sync;
without it the published one is downloaded.

Usage: python tools/test_widget_feed.py [--sync path/to/pocketdex/widget/sync.js]
"""
import argparse
import datetime
import functools
import http.server
import json
import re
import sys
import threading
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
SYNC_URL = "https://juw12.github.io/pocketdex/widget/sync.js"
CODE = "jw-0123456789abcdef0123456789abcdef"
OTHER_CODE = "jw-fedcba9876543210fedcba9876543210"
FIELDS = {"day", "scene", "weather", "tempC", "time", "season", "moments", "days", "walkKm", "inbox", "sample"}
WEATHER = {"current": {"temperature_2m": 18.4, "weather_code": 3}, "daily": {"sunrise": [], "sunset": []}}
failures = []


def check(condition, label):
    print(("ok   " if condition else "FAIL ") + label, flush=True)
    if not condition:
        failures.append(label)


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def new_context(browser, sync_source, relay_log, script_log, paired_code=None):
    """A phone-sized browser with sample days. `sync_source` None means the relay script cannot be reached."""
    context = browser.new_context(viewport={"width": 390, "height": 844}, locale="en-US", service_workers="block")
    setup = (
        "localStorage.setItem('diary.sample','1');"
        "localStorage.setItem('onboarding.done','1');"
        "localStorage.setItem('ui.languageMode','english');"
    )
    if paired_code:
        setup += f"if (!sessionStorage.getItem('seeded')) localStorage.setItem('juw12.widget.code','{paired_code}');"
    setup += "sessionStorage.setItem('seeded','1');"
    context.add_init_script(setup)

    def relay(route):
        request = route.request
        relay_log.append({"method": request.method, "url": request.url, "body": request.post_data})
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body="{}")

    def relay_script(route):
        script_log.append(route.request.url)
        if sync_source is None:
            route.abort()
        else:
            route.fulfill(status=200, content_type="text/javascript", body=sync_source)

    def weather(route):
        route.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"}, body=json.dumps(WEATHER))

    context.route("https://ntfy.sh/**", relay)
    context.route(SYNC_URL, relay_script)
    context.route("https://api.open-meteo.com/**", weather)
    return context


def posts(relay_log):
    return [entry for entry in relay_log if entry["method"] == "POST"]


def wait_for_posts(page, relay_log, count, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline and len(posts(relay_log)) < count:
        page.wait_for_timeout(250)
    return posts(relay_log)


def open_app(page, base, path="index.html#/today?sheet=settings"):
    page.goto(f"{base}/web/app/{path}")
    page.wait_for_selector("[data-ready]", timeout=20000)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sync", type=Path, help="local copy of pocketdex/widget/sync.js")
    args = parser.parse_args()
    if args.sync:
        sync_source = args.sync.read_text(encoding="utf-8")
    else:
        sync_source = urllib.request.urlopen(SYNC_URL, timeout=30).read().decode("utf-8")

    server = serve(ROOT)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=CHROME if Path(CHROME).exists() else None,
            args=["--no-proxy-server"],
        )

        # 1. not paired: neither the relay script nor the relay is ever requested
        relay_log, script_log, errors = [], [], []
        context = new_context(browser, sync_source, relay_log, script_log)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        open_app(page, base)
        page.wait_for_timeout(3500)
        check(script_log == [], "unpaired: the relay script is not downloaded")
        check(relay_log == [], "unpaired: no request reaches the relay")
        check(page.input_value("#widget-code") == "", "unpaired: the Settings code box is empty")
        check(page.inner_text("#widget-status") == "Not paired", "unpaired: Settings says Not paired")
        check(page.locator("[data-action=widget-clear]").count() == 0, "unpaired: no Unpair button")
        setup_link = page.get_attribute(".sheet a[href*='pocketdex/widget'], #sheet a[href*='pocketdex/widget']", "href")
        check(setup_link == "https://juw12.github.io/pocketdex/widget/", "Settings links to the widget setup page")

        # 2. a wrong code is refused and still sends nothing
        page.fill("#widget-code", "hello")
        page.click("[data-action=widget-save]")
        page.wait_for_function("document.querySelector('#widget-status').textContent.includes('not a widget code')", timeout=10000)
        page.wait_for_timeout(2500)
        check(relay_log == [], "wrong code: nothing is sent")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") is None, "wrong code: nothing is saved")

        # 3. pairing from Settings sends one snapshot with exactly the agreed fields
        page.fill("#widget-code", CODE)
        page.click("[data-action=widget-save]")
        page.wait_for_function("document.querySelector('#widget-status').textContent === 'Paired on this device'", timeout=10000)
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") == CODE, "paired: the code is saved in this browser")
        check(page.input_value("#widget-code") == CODE, "paired: Settings shows the code")
        check(page.locator("[data-action=widget-clear]").count() == 1, "paired: an Unpair button appears")
        sent = wait_for_posts(page, relay_log, 1, 8)
        check(len(sent) == 1, "paired: one snapshot is sent")
        if sent:
            check(sent[0]["url"] == f"https://ntfy.sh/{CODE}", "paired: it goes to the private topic for this code")
            message = json.loads(sent[0]["body"])
            snapshot = message.get("d", {})
            print("     snapshot:", json.dumps(snapshot), flush=True)
            check(message.get("v") == 1 and message.get("app") == "haru", "snapshot: marked as Haru, format 1")
            check(set(snapshot) == FIELDS, "snapshot: exactly the agreed fields")
            check(snapshot.get("day") == datetime.date.today().isoformat(), "snapshot: dated today")
            check(snapshot.get("weather") == "cloudy" and snapshot.get("tempC") == 18.4, "snapshot: carries the current weather")
            scene = str(snapshot.get("scene"))
            check(bool(re.fullmatch(r"[a-z_]+", scene)), "snapshot: the scene name is a plain picture name")
            check((ROOT / "web" / "app" / "scenes" / f"{scene}.jpg").exists(), "snapshot: the scene picture exists")
            check(scene == f"cloudy__{snapshot.get('time')}__{snapshot.get('season')}", "snapshot: time of day and season match the scene")
            check(isinstance(snapshot.get("moments"), int) and snapshot["moments"] >= 0, "snapshot: today's moment count")
            check(isinstance(snapshot.get("days"), int) and snapshot["days"] > 0, "snapshot: number of days kept")
            check(isinstance(snapshot.get("walkKm"), (int, float)) and snapshot["walkKm"] > 0, "snapshot: distance walked")
            check(isinstance(snapshot.get("inbox"), int) and snapshot["inbox"] >= 0, "snapshot: screenshots waiting")
            check(snapshot.get("sample") is True, "snapshot: flagged as sample days")
            check("Yanaka" not in sent[0]["body"] and "Tokyo" not in sent[0]["body"], "snapshot: no place name")
            check(len(sent[0]["body"].encode("utf-8")) < 600, "snapshot: small")

        # 4. opening the app again while paired loads the relay script but does not repeat an unchanged snapshot
        script_log.clear()
        page.reload()
        page.wait_for_selector("[data-ready]", timeout=20000)
        page.wait_for_function("Boolean(window.Juw12Widget)", timeout=10000)
        page.wait_for_timeout(4000)
        check(len(script_log) == 1, "paired reload: the relay script is loaded at start")
        check(page.input_value("#widget-code") == CODE, "paired reload: Settings still shows the code")
        check(page.locator("[data-action=widget-clear]").count() == 1, "paired reload: the Unpair button is still there")
        check(len(posts(relay_log)) == 1, "paired reload: an unchanged snapshot is not sent again")

        # 5. unpairing stops the feed
        open_app(page, base)
        page.click("[data-action=widget-clear]")
        page.wait_for_function("document.querySelector('#widget-status').textContent === 'Not paired'", timeout=10000)
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") is None, "unpaired again: the code is removed")
        open_app(page, base, "index.html#/memories")
        page.wait_for_timeout(3500)
        check(len(posts(relay_log)) == 1, "unpaired again: nothing more is sent")
        check(errors == [], f"no page errors ({errors[:2]})")
        context.close()

        # 6. the setup page link (?widget=code) pairs this browser and starts the feed
        relay_log, script_log, errors = [], [], []
        context = new_context(browser, sync_source, relay_log, script_log)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        open_app(page, base, f"index.html?widget={OTHER_CODE}#/today")
        sent = wait_for_posts(page, relay_log, 1, 10)
        check(len(sent) == 1 and sent[0]["url"] == f"https://ntfy.sh/{OTHER_CODE}", "link pairing: a snapshot goes to the linked code")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") == OTHER_CODE, "link pairing: the code is saved")
        check("widget=" not in page.url and page.url.endswith("#/today"), "link pairing: the code is removed from the address")
        check(errors == [], f"link pairing: no page errors ({errors[:2]})")
        context.close()

        # 7. when the relay script cannot be reached, the diary still opens and Settings says so
        relay_log, script_log, errors = [], [], []
        context = new_context(browser, None, relay_log, script_log, paired_code=CODE)
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(str(error)))
        open_app(page, base)
        page.wait_for_timeout(1500)
        check(len(script_log) >= 1 and relay_log == [], "relay script unreachable: nothing is sent")
        check(page.locator(".sheet-open #widget-code").count() == 1, "relay script unreachable: Settings still opens")
        page.fill("#widget-code", OTHER_CODE)
        page.click("[data-action=widget-save]")
        page.wait_for_function("document.querySelector('#widget-status').textContent.includes('Could not reach')", timeout=10000)
        check(True, "relay script unreachable: Settings explains that it could not be reached")
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") == CODE, "relay script unreachable: the saved code is kept")
        page.click("[data-action=widget-clear]")
        page.wait_for_function("document.querySelector('#widget-status').textContent === 'Not paired'", timeout=10000)
        check(page.evaluate("localStorage.getItem('juw12.widget.code')") is None, "relay script unreachable: Unpair still works")
        check(errors == [], f"relay script unreachable: no page errors ({errors[:2]})")
        context.close()

        browser.close()
    server.shutdown()
    print("PASS" if not failures else f"FAIL ({len(failures)})")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
