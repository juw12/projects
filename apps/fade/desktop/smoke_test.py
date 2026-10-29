#!/usr/bin/env python3
"""Open the built Fade desktop app twice and check it really works live and keeps you signed in.

    python apps/fade/desktop/smoke_test.py --built             the app in dist/ (after build.py)
    python apps/fade/desktop/smoke_test.py PATH/TO/Fade.exe     an installed copy
    python apps/fade/desktop/smoke_test.py --source            fade_app.py from this checkout

The checks run against a private copy of the Fade Network (server/devnet.py: a Nostr relay, Blossom and
ntfy on one loopback port) so they are hermetic; the app talks to it exactly as it talks to the public
relays. Each run uses FADE_WINDOW_TEST: the app writes a report once the page has loaded and closes itself.

Run 1  the window boots Fade in network mode and connects to the relay, creates a real account through
       Fade's own API, and its key reaches storage.json; Windows notifications and outside links go
       through the desktop shim. This script then reads the account's profile back from the relay
       itself, so it was really published.
Run 2  a fresh window profile (as after clearing data or reinstalling) sharing only the data folder:
       the app must come back signed in to the same account and load its profile from the network.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time

DESKTOP = os.path.dirname(os.path.abspath(__file__))
FADE = os.path.dirname(DESKTOP)
sys.path.insert(0, os.path.join(FADE, "tests"))
from wsclient import WebSocket  # noqa: E402  (Fade's own stdlib WebSocket client)

NAMESPACE = "fade3dev"


def built_app():
    if sys.platform == "win32":
        return os.path.join(DESKTOP, "dist", "Fade", "Fade.exe")
    return os.path.join(DESKTOP, "dist", "Fade.app", "Contents", "MacOS", "Fade")


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def start_devnet():
    port = free_port()
    process = subprocess.Popen([sys.executable, os.path.join(FADE, "server", "devnet.py"), "--port", str(port), "--quiet"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return process, port
        except OSError:
            time.sleep(0.2)
    process.kill()
    raise SystemExit("The local test network did not start")


def relay_profile(port, pubkey):
    """The account's public profile document, read straight from the relay."""
    socket_ = WebSocket("ws://127.0.0.1:%d/" % port)
    socket_.settimeout(10)
    try:
        socket_.send(json.dumps(["REQ", "check", {"kinds": [30078], "authors": [pubkey], "#d": ["%s:user:me" % NAMESPACE]}]))
        while True:
            message = json.loads(socket_.recv())
            if message[0] == "EVENT":
                return message[2]
            if message[0] == "EOSE":
                return None
    finally:
        socket_.close()


def run(command, home, port, expect=None, name=None):
    folder = tempfile.mkdtemp(prefix="fade-smoke-")
    report = os.path.join(folder, "report.json")
    env = dict(
        os.environ,
        FADE_WINDOW_TEST=report,
        FADE_DESKTOP_HOME=home,
        FADE_DESKTOP_RELAYS="ws://127.0.0.1:%d/" % port,
        FADE_DESKTOP_BLOSSOM="http://127.0.0.1:%d" % port,
        FADE_DESKTOP_NTFY="http://127.0.0.1:%d/ntfy" % port,
        FADE_DESKTOP_NS=NAMESPACE,
    )
    if expect:
        env["FADE_EXPECT_PUBKEY"] = expect
    if name:
        env["FADE_TEST_NAME"] = name
    process = subprocess.Popen(command, env=env)
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
    return result


def problems_in(result):
    page = result.get("page") or {}
    checks = result.get("checks") or {}
    problems = []
    if result.get("method") != "window":
        problems.append("no native window (%s)" % (result.get("error") or result.get("method")))
    if "Fade" not in str(page.get("title") or ""):
        problems.append("page title is %r" % page.get("title"))
    if not str(page.get("url") or "").startswith(str(result.get("server_url") or "-").split("?")[0]):
        problems.append("the window is on %r, not its own address" % page.get("url"))
    if not page.get("shim"):
        problems.append("the desktop shim did not load")
    if not page.get("booted") or not page.get("network"):
        problems.append("Fade did not start in live network mode")
    if not page.get("relays"):
        problems.append("Fade did not connect to the relay")
    if page.get("ns") != NAMESPACE:
        problems.append("Fade is on namespace %r, not the test network" % page.get("ns"))
    if not page.get("notifyHooked"):
        problems.append("network notifications are not routed to Windows")
    if checks.get("error"):
        problems.append(checks["error"])
    if not checks.get("notified"):
        problems.append("a notification did not reach the desktop app")
    if not any("paypal.me" in url for url in checks.get("opened_outside") or []):
        problems.append("a payment link did not open outside the app")
    if not checks.get("refused_unsafe"):
        problems.append("an unsafe link was not refused")
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("app", nargs="?", help="the Fade program to open")
    parser.add_argument("--built", action="store_true", help="open the app in dist/")
    parser.add_argument("--source", action="store_true", help="run fade_app.py from this checkout")
    args = parser.parse_args()
    if args.source:
        command = [sys.executable, os.path.join(DESKTOP, "fade_app.py")]
    else:
        app = built_app() if args.built or not args.app else args.app
        if not os.path.isfile(app):
            raise SystemExit("Not found: %s" % app)
        command = [app]
    devnet, port = start_devnet()
    home = tempfile.mkdtemp(prefix="fade-home-")
    started = time.time()
    try:
        name = "Desktop Check %d" % (int(time.time()) % 100000)
        print("Run 1: open %s, go live and create an account" % command[-1], flush=True)
        first = run(command, home, port, name=name)
        problems = problems_in(first)
        checks = first.get("checks") or {}
        if not checks.get("registered"):
            problems.append("creating an account failed: %s" % checks.get("register_error"))
        if not checks.get("key_saved"):
            problems.append("the account key did not reach storage.json")
        pubkey = checks.get("pubkey")
        event = relay_profile(port, pubkey) if pubkey else None
        if not event:
            problems.append("the new account's profile is not on the relay")
        elif name not in event.get("content", ""):
            problems.append("the profile on the relay does not carry the account name")
        if problems:
            raise SystemExit("FAILED (run 1): " + "; ".join(problems))
        print("Relay has the account's profile (event %s...)" % event["id"][:12], flush=True)

        print("Run 2: reopen with a fresh window profile", flush=True)
        second = run(command, home, port, expect=pubkey)
        problems = problems_in(second)
        checks = second.get("checks") or {}
        if not checks.get("restored_account"):
            problems.append("the app did not come back signed in (pubkey %s)" % checks.get("pubkey"))
        if checks.get("profile_name") != name:
            problems.append("the profile was not loaded from the network (%s)"
                            % (checks.get("profile_error") or checks.get("profile_name")))
        if problems:
            raise SystemExit("FAILED (run 2): " + "; ".join(problems))
    finally:
        devnet.kill()
    print("OK: Fade ran live in its own window (%s), published a new account to the relay and came back signed in "
          "after a restart with a fresh profile (%.0f s)" % (first.get("toolkit"), time.time() - started))


if __name__ == "__main__":
    main()
