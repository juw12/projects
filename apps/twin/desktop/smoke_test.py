#!/usr/bin/env python3
"""Open the built Twin desktop app and check that it really runs Twin.

    python apps/twin/desktop/smoke_test.py --built           the app in dist/ (after build.py)
    python apps/twin/desktop/smoke_test.py PATH/TO/Twin.exe   an installed copy
    add --tools to also run every Twin tool through the program (Twin --selftest-tools)

The app runs with TWIN_WINDOW_TEST set: it uses a throwaway Twin home next to the report, starts its own
server, loads the app in its window, then uses the server like the app does (creates an account, runs a
Twin tool through the program, opens Add money, asks for updates), writes a report and closes itself.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

DESKTOP = os.path.dirname(os.path.abspath(__file__))
TWIN = os.path.dirname(DESKTOP)


def built_app():
    if sys.platform == "win32":
        return os.path.join(DESKTOP, "dist", "Twin", "Twin.exe")
    return os.path.join(DESKTOP, "dist", "Twin.app", "Contents", "MacOS", "Twin")


def twin_version():
    with open(os.path.join(TWIN, "server.py"), encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("VERSION = "):
                return line.split('"')[1]
    return None


def check_tools(app):
    print("Running every Twin tool through %s" % app, flush=True)
    result = subprocess.run([app, "--selftest-tools"], capture_output=True, text=True, timeout=600)
    print(result.stdout + result.stderr)
    if result.returncode != 0 or "OK: every Twin tool runs" not in result.stdout:
        raise SystemExit("FAILED: the Twin tools do not all run through the program (exit %s)" % result.returncode)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("app", nargs="?", help="the Twin program to open")
    parser.add_argument("--built", action="store_true", help="open the app in dist/")
    parser.add_argument("--tools", action="store_true", help="also run every Twin tool through the program")
    args = parser.parse_args()
    app = built_app() if args.built or not args.app else args.app
    if not os.path.isfile(app):
        raise SystemExit("Not found: %s" % app)
    if args.tools:
        check_tools(app)

    folder = tempfile.mkdtemp(prefix="twin-smoke-")
    report = os.path.join(folder, "report.json")
    env = dict(os.environ, TWIN_WINDOW_TEST=report)
    print("Opening %s" % app, flush=True)
    started = time.time()
    process = subprocess.Popen([app], env=env)
    try:
        process.wait(timeout=240)
    except subprocess.TimeoutExpired:
        process.kill()
        raise SystemExit("The app did not close itself within 240 s")
    if not os.path.isfile(report):
        raise SystemExit("The app exited (code %s) without a report" % process.returncode)
    with open(report, encoding="utf-8") as handle:
        result = json.load(handle)
    print(json.dumps(result, indent=2))

    expected = twin_version()
    page = result.get("page") or {}
    checks = result.get("checks") or {}
    health = result.get("health") or {}
    problems = []
    if result.get("method") != "window":
        problems.append("no native window (%s)" % (result.get("error") or result.get("method")))
    if health.get("app") != "twin":
        problems.append("the Twin server did not answer")
    elif expected and health.get("version") != expected:
        problems.append("the server runs Twin %s, not %s" % (health.get("version"), expected))
    if "Twin" not in str(page.get("title") or ""):
        problems.append("page title is %r" % page.get("title"))
    if not str(page.get("url") or "").startswith(str(result.get("server_url") or "-")):
        problems.append("the window is on %r, not its own server" % page.get("url"))
    if page.get("demo") or not page.get("server"):
        problems.append("the app did not use its own server (web demo mode)")
    if not page.get("addMoney"):
        problems.append("the Add money screens did not load")
    if not page.get("bridge"):
        problems.append("the desktop bridge (window.pywebview.api) is missing")
    for name, label in (("signup", "creating an account"), ("tool", "running a Twin tool"),
                        ("funding", "Add money (/api/broker/funding)"), ("update_status", "the update check")):
        if not checks.get(name):
            problems.append("%s failed" % label)
    if problems:
        raise SystemExit("FAILED: " + "; ".join(problems))
    print("OK: Twin %s ran in its own window (%s) with its own server in %.0f s"
          % (health.get("version"), result.get("toolkit"), time.time() - started))


if __name__ == "__main__":
    main()
