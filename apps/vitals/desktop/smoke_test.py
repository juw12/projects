#!/usr/bin/env python3
"""Start a Vitals desktop build (or the launcher from this checkout) and check that it works.

    python apps/vitals/desktop/smoke_test.py --built          # the build in apps/vitals/desktop/dist
    python apps/vitals/desktop/smoke_test.py PATH/TO/Vitals   # an installed copy
    python apps/vitals/desktop/smoke_test.py --source         # vitals_app.py from this checkout

Opening the app must start the background agent and return; the dashboard and the API must answer
from the bundled files; opening it again must reuse the running agent; --stop must shut it down.
Uses a free port and throwaway data/home folders, and never opens a browser, dialog or login item.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

DESKTOP = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(DESKTOP, "dist")
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # loopback: never via a proxy
QUIET = {
    "VITALS_NO_BROWSER": "1",
    "VITALS_NO_DIALOG": "1",
    "VITALS_NO_AUTOSTART": "1",
    "VITALS_NO_MODEL": "1",
    "VITALS_NO_NOTIFY": "1",
}


def built_executable():
    if sys.platform == "win32":
        return os.path.join(DIST, "Vitals", "Vitals.exe")
    if sys.platform == "darwin":
        return os.path.join(DIST, "Vitals.app", "Contents", "MacOS", "Vitals")
    return os.path.join(DIST, "Vitals", "vitals")


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def fetch(url, token=None, timeout=5):
    request = urllib.request.Request(url, headers={"X-Vitals-Token": token} if token else {})
    with OPENER.open(request, timeout=timeout) as response:
        return response.status, response.read()


def health(port):
    try:
        return json.loads(fetch("http://127.0.0.1:%d/api/health" % port, timeout=1)[1].decode("utf-8"))
    except (OSError, ValueError):
        return None


def wait_until(condition, seconds):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.2)
    return condition()


def run_smoke(command, label):
    """Run the checks against `command` (the program, without options). Returns the failures."""
    failures = []

    def check(condition, description):
        print(("  ok   " if condition else "  FAIL ") + description, flush=True)
        if not condition:
            failures.append(description)

    print("Smoke test: %s" % label, flush=True)
    sandbox = tempfile.mkdtemp(prefix="vitals-smoke-")
    data = os.path.join(sandbox, "data")
    home = os.path.join(sandbox, "home")
    os.makedirs(home)
    port = free_port()
    options = ["--port", str(port), "--data", data, "--home", home]
    env = dict(os.environ, **QUIET)
    base = "http://127.0.0.1:%d" % port
    try:
        started = time.time()
        first = subprocess.run(command + options, env=env, timeout=120, capture_output=True, text=True)
        info = health(port)
        check(first.returncode == 0, "opening the app returns (exit %s after %.1f s)" % (first.returncode, time.time() - started))
        check(bool(info) and info.get("app") == "vitals",
              "the background agent answers on port %d (Vitals %s on %s)" % (port, (info or {}).get("version"), (info or {}).get("os")))
        if info:
            status, page = fetch(base + "/")
            check(status == 200 and b"app.js" in page, "the dashboard page is served")
            status, script = fetch(base + "/app.js")
            check(status == 200 and len(script) > 50_000, "the dashboard code is bundled (app.js, %d KB)" % (len(script) // 1024))
            token = json.loads(fetch(base + "/api/session")[1].decode("utf-8")).get("token")
            check(bool(token), "this computer gets a session token")
            status, body = fetch(base + "/api/vitals", token=token, timeout=20)
            vitals = json.loads(body.decode("utf-8"))
            check(status == 200 and isinstance(vitals, dict) and len(vitals) > 0,
                  "live vitals are measured (%s)" % ", ".join(sorted(vitals)[:5]))
            again = subprocess.run(command + options, env=env, timeout=60, capture_output=True, text=True)
            check(again.returncode == 0 and health(port) is not None, "opening it again reuses the running agent")
        stop = subprocess.run(command + ["--stop"] + options, env=env, timeout=60, capture_output=True, text=True)
        check(stop.returncode == 0 and wait_until(lambda: health(port) is None, 15), "--stop shuts the agent down")
        log = os.path.join(data, "agent.log")
        check(os.path.isfile(log), "the agent keeps its log in the data folder")
        if failures:
            for name, result in (("first launch", first), ("--stop", stop)):
                print("--- %s output ---\n%s%s" % (name, result.stdout, result.stderr))
            if os.path.isfile(log):
                with open(log, encoding="utf-8", errors="replace") as handle:
                    print("--- agent.log ---\n" + handle.read()[-4000:])
    finally:
        if health(port):
            subprocess.run(command + ["--stop"] + options, env=env, timeout=60, capture_output=True)
        wait_until(lambda: health(port) is None, 10)
        shutil.rmtree(sandbox, ignore_errors=True)
    return failures


def main():
    args = sys.argv[1:]
    if args == ["--source"] or not args:
        command = [sys.executable, os.path.join(DESKTOP, "vitals_app.py")]
        label = "launcher from this checkout"
    elif args == ["--built"]:
        command = [built_executable()]
        label = command[0]
    else:
        command = [os.path.abspath(args[0])]
        label = command[0]
    if command[0] != sys.executable and not os.path.isfile(command[0]):
        print("Not found: %s" % command[0])
        sys.exit(1)
    failures = run_smoke(command, label)
    if failures:
        print("\n%d check(s) failed" % len(failures))
        sys.exit(1)
    print("\nAll desktop checks passed")


if __name__ == "__main__":
    main()
