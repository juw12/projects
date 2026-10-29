#!/usr/bin/env python3
"""Open the built Mint desktop app and check its window really shows Mint.

    python apps/mint/desktop/smoke_test.py --built            the app in dist/ (after build.py)
    python apps/mint/desktop/smoke_test.py PATH/TO/Mint.exe   an installed copy
    add --local-site to serve this checkout's site (scripts/build_site.py) instead of the live one

The app runs with MINT_WINDOW_TEST set, so it writes a report once the page has loaded and closes
itself. Passes when the page is Mint, the language & region screen script is loaded (a fresh profile
shows the first-visit question) and the page can store data.
"""

import argparse
import functools
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time

DESKTOP = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(DESKTOP)))
LIVE_URL = "https://juw12.github.io/projects/mint/"


def built_app():
    if sys.platform == "win32":
        return os.path.join(DESKTOP, "dist", "Mint", "Mint.exe")
    return os.path.join(DESKTOP, "dist", "Mint.app", "Contents", "MacOS", "Mint")


def serve_site():
    """Build the Pages site from this checkout and serve it on a free loopback port."""
    subprocess.run([sys.executable, os.path.join(REPO, "scripts", "build_site.py")], check=True, cwd=REPO)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(REPO, "_site"))
    handler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return "http://127.0.0.1:%d/mint/" % server.server_address[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("app", nargs="?", help="the Mint program to open")
    parser.add_argument("--built", action="store_true", help="open the app in dist/")
    parser.add_argument("--local-site", action="store_true", help="serve this checkout's site instead of the live one")
    args = parser.parse_args()
    app = built_app() if args.built or not args.app else args.app
    if not os.path.isfile(app):
        raise SystemExit("Not found: %s" % app)

    url = serve_site() if args.local_site else LIVE_URL
    folder = tempfile.mkdtemp(prefix="mint-smoke-")
    report = os.path.join(folder, "report.json")
    env = dict(os.environ, MINT_WINDOW_TEST=report, MINT_DESKTOP_URL=url)
    print("Opening %s on %s" % (app, url), flush=True)
    started = time.time()
    process = subprocess.Popen([app], env=env)
    try:
        process.wait(timeout=180)
    except subprocess.TimeoutExpired:
        process.kill()
        raise SystemExit("The app did not close itself within 180 s")
    if not os.path.isfile(report):
        raise SystemExit("The app exited (code %s) without a report" % process.returncode)
    with open(report, encoding="utf-8") as handle:
        result = json.load(handle)
    print(json.dumps(result, indent=2))

    problems = []
    if result.get("method") != "window":
        problems.append("no native window (%s)" % result.get("error") or result.get("method"))
    if "Mint" not in str(result.get("title") or ""):
        problems.append("page title is %r" % result.get("title"))
    if not str(result.get("url") or "").startswith(url):
        problems.append("the window is on %r" % result.get("url"))
    if not result.get("locale"):
        problems.append("the language & region script did not load")
    if not result.get("storage"):
        problems.append("the page cannot store data")
    if args.local_site and not result.get("gate"):
        problems.append("a fresh profile did not get the language & region question")
    if problems:
        raise SystemExit("FAILED: " + "; ".join(problems))
    print("OK: Mint opened in its own window (%s) in %.0f s" % (result.get("toolkit"), time.time() - started))


if __name__ == "__main__":
    main()
