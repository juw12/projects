#!/usr/bin/env python3
"""Open the built Peers desktop app twice and check it really works and keeps its data.

    python apps/peers/desktop/smoke_test.py --built             the app in dist/ (after build.py)
    python apps/peers/desktop/smoke_test.py PATH/TO/Peers.exe    an installed copy

Each run uses PEERS_WINDOW_TEST: the app writes a report once the page has loaded and closes itself.
Run 1 saves a marker through the app's own saveState() and checks it reached the SQLite database.
Run 2 shares only that data folder (a fresh browser profile) and checks the app opened with the marker -
so reviews survive restarts, reinstalls and cleared browser data.
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

DESKTOP = os.path.dirname(os.path.abspath(__file__))


def built_app():
    if sys.platform == "win32":
        return os.path.join(DESKTOP, "dist", "Peers", "Peers.exe")
    return os.path.join(DESKTOP, "dist", "Peers.app", "Contents", "MacOS", "Peers")


def run(app, home, expect=None):
    folder = tempfile.mkdtemp(prefix="peers-smoke-")
    report = os.path.join(folder, "report.json")
    env = dict(os.environ, PEERS_WINDOW_TEST=report, PEERS_DESKTOP_HOME=home)
    if expect:
        env["PEERS_EXPECT_MARK"] = expect
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
    return result


def problems_in(result):
    page = result.get("page") or {}
    checks = result.get("checks") or {}
    problems = []
    if result.get("method") != "window":
        problems.append("no native window (%s)" % (result.get("error") or result.get("method")))
    if "Peers" not in str(page.get("title") or ""):
        problems.append("page title is %r" % page.get("title"))
    if not str(page.get("url") or "").startswith(str(result.get("server_url") or "-")):
        problems.append("the window is on %r, not its own server" % page.get("url"))
    if not page.get("app") or not page.get("me"):
        problems.append("the Peers app did not start")
    if not page.get("stored"):
        problems.append("the app has no saved state")
    if (checks.get("health") or {}).get("app") != "peers":
        problems.append("the Peers server did not answer")
    if not checks.get("database_file"):
        problems.append("no database file in the data folder")
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("app", nargs="?", help="the Peers program to open")
    parser.add_argument("--built", action="store_true", help="open the app in dist/")
    args = parser.parse_args()
    app = built_app() if args.built or not args.app else args.app
    if not os.path.isfile(app):
        raise SystemExit("Not found: %s" % app)
    home = tempfile.mkdtemp(prefix="peers-home-")
    started = time.time()

    print("Run 1: open %s and save through the app" % app, flush=True)
    first = run(app, home)
    problems = problems_in(first)
    if not (first.get("checks") or {}).get("saved_to_database"):
        problems.append("a change made in the app did not reach the database")
    if problems:
        raise SystemExit("FAILED (run 1): " + "; ".join(problems))

    print("Run 2: reopen with a fresh browser profile", flush=True)
    second = run(app, home, expect=first["checks"]["mark"])
    problems = problems_in(second)
    if not (second.get("checks") or {}).get("restored_from_database"):
        problems.append("the change was not there after reopening")
    if problems:
        raise SystemExit("FAILED (run 2): " + "; ".join(problems))
    print("OK: Peers ran in its own window (%s), saved to %s and kept it across restarts (%.0f s)"
          % (first.get("toolkit"), os.path.basename(first.get("database") or "peers.db"), time.time() - started))


if __name__ == "__main__":
    main()
