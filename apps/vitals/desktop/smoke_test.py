#!/usr/bin/env python3
"""Start a Vitals desktop build (or the launcher from this checkout) and check that it works.

    python apps/vitals/desktop/smoke_test.py --built          # the build in apps/vitals/desktop/dist
    python apps/vitals/desktop/smoke_test.py PATH/TO/Vitals   # an installed copy
    python apps/vitals/desktop/smoke_test.py --source         # vitals_app.py from this checkout
    add --window to also open the app window (needs a desktop session; on Linux e.g. xvfb-run)

Opening the app must start the background agent and return; the dashboard and the API must answer
from the bundled files; opening it again must reuse the running agent; --stop must shut it down.
With --window: the app must show the live dashboard in its own window (not a browser), a second
launch must bring that window back instead of opening another, and --stop must close it.
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
NO_CONSOLE = {"creationflags": 0x08000000} if os.name == "nt" else {}  # CREATE_NO_WINDOW


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


def agent_processes(port):
    """PIDs of agents started for this port (macOS/Linux; [] elsewhere)."""
    if os.name == "nt" or not shutil.which("pgrep"):
        return []
    found = subprocess.run(["pgrep", "-f", "--", "--background.*--port %d( |$)" % port], capture_output=True, text=True)
    return [int(pid) for pid in found.stdout.split() if pid.isdigit() and int(pid) != os.getpid()]


def describe_stuck_agents(port):
    """Print agents that run but never answered, with where they are stuck (macOS), then end them."""
    for pid in agent_processes(port):
        ps = subprocess.run(["ps", "-o", "pid,stat,etime,command", "-p", str(pid)], capture_output=True, text=True)
        print("--- agent process that never answered ---\n%s" % ps.stdout.strip())
        if sys.platform == "darwin" and shutil.which("sample"):
            report = os.path.join(tempfile.gettempdir(), "vitals-agent-%d.sample.txt" % pid)
            subprocess.run(["sample", str(pid), "2", "-file", report], capture_output=True, timeout=90)
            try:
                with open(report, encoding="utf-8", errors="replace") as handle:
                    lines = handle.read().splitlines()
                start = next((i for i, line in enumerate(lines) if line.startswith("Call graph:")), 0)
                print("--- where it is (sample, main thread first) ---\n" + "\n".join(lines[start:start + 70]))
            except OSError:
                pass
        try:
            os.kill(pid, 9)
        except OSError:
            pass


def read_report(path, seconds, process=None):
    """Wait for a VITALS_WINDOW_TEST report; {} if it doesn't come (or the process ends first)."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            pass
        if process is not None and process.poll() is not None:
            time.sleep(0.5)
            try:
                with open(path, encoding="utf-8") as handle:
                    return json.load(handle)
            except (OSError, ValueError):
                return {}
        time.sleep(0.3)
    return {}


def run_window_checks(command, options, env, data, sandbox, check):
    """The app window: live dashboard in a native window, reused by a second launch, closed by --stop."""
    first_report = os.path.join(sandbox, "window-first.json")
    second_report = os.path.join(sandbox, "window-second.json")
    window_env = {key: value for key, value in env.items() if key != "VITALS_NO_BROWSER"}
    started = time.time()
    first = subprocess.Popen(
        command + options,
        env=dict(window_env, VITALS_WINDOW_TEST=first_report, VITALS_WINDOW_TEST_HOLD="120"),
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **NO_CONSOLE,
    )
    try:
        info = read_report(first_report, 120, first)
        check(info.get("method") == "window",
              "opening the app shows its own window, not a browser (%s %s)"
              % (info.get("method"), info.get("toolkit") or info.get("platform") or ""))
        check("Live" in info.get("pill", ""),
              "the window shows the live dashboard (\"%s\" after %.1f s)" % (info.get("pill", ""), time.time() - started))
        check(str(info.get("title", "")).startswith("Vitals") and str(info.get("url", "")).startswith("http://127.0.0.1:"),
              "the window loads the dashboard from the agent (%s)" % info.get("url"))
        if info.get("method") != "window":
            return
        again = subprocess.run(
            command + options,
            env=dict(window_env, VITALS_WINDOW_TEST=second_report, VITALS_WINDOW_TEST_HOLD="0"),
            timeout=90, capture_output=True, text=True, **NO_CONSOLE,
        )
        second = read_report(second_report, 5)
        check(again.returncode == 0 and second.get("method") == "focused" and first.poll() is None,
              "opening it again brings the open window to the front (%s)" % second.get("method"))
        stop = subprocess.run(command + ["--stop"] + options, env=env, timeout=90, capture_output=True,
                              text=True, **NO_CONSOLE)
        try:
            first.wait(timeout=30)
        except subprocess.TimeoutExpired:
            pass
        check(stop.returncode == 0 and first.poll() is not None and not os.path.exists(os.path.join(data, "window.json")),
              "--stop closes the window")
    finally:
        if first.poll() is None:
            first.kill()


def run_smoke(command, label, window=False):
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
        first = subprocess.run(command + options, env=env, timeout=120, capture_output=True, text=True, **NO_CONSOLE)
        first_seconds = time.time() - started
        info = health(port)
        check(first.returncode == 0, "opening the app returns (exit %s after %.1f s)" % (first.returncode, first_seconds))
        check(bool(info) and info.get("app") == "vitals",
              "the background agent answers on port %d (Vitals %s on %s)" % (port, (info or {}).get("version"), (info or {}).get("os")))
        if info and first_seconds > 15:
            print("  note: the first start took %.0f s; agent.log:\n%s" % (first_seconds, tail(os.path.join(data, "agent.log"))))
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
            again = subprocess.run(command + options, env=env, timeout=60, capture_output=True, text=True, **NO_CONSOLE)
            check(again.returncode == 0 and health(port) is not None, "opening it again reuses the running agent")
            if window:
                run_window_checks(command, options, env, data, sandbox, check)
        stop = subprocess.run(command + ["--stop"] + options, env=env, timeout=60, capture_output=True, text=True,
                              **NO_CONSOLE)
        check(stop.returncode == 0 and wait_until(lambda: health(port) is None, 15), "--stop shuts the agent down")
        log = os.path.join(data, "agent.log")
        check(os.path.isfile(log), "the agent keeps its log in the data folder")
        if failures:
            for name, result in (("first launch", first), ("--stop", stop)):
                print("--- %s output ---\n%s%s" % (name, result.stdout, result.stderr))
            describe_stuck_agents(port)
            for name in ("agent.log", "app.log", "window.log"):
                path = os.path.join(data, name)
                if os.path.isfile(path):
                    print("--- %s ---\n%s" % (name, tail(path)))
    finally:
        if health(port):
            subprocess.run(command + ["--stop"] + options, env=env, timeout=60, capture_output=True, **NO_CONSOLE)
        wait_until(lambda: health(port) is None, 10)
        for pid in agent_processes(port):  # never leave a stuck agent behind
            try:
                os.kill(pid, 9)
            except OSError:
                pass
        shutil.rmtree(sandbox, ignore_errors=True)
    return failures


def tail(path, size=6000):
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read()[-size:]
    except OSError:
        return "(no %s)" % os.path.basename(path)


def main():
    args = sys.argv[1:]
    window = "--window" in args
    args = [arg for arg in args if arg != "--window"]
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
    failures = run_smoke(command, label, window=window)
    if failures:
        print("\n%d check(s) failed" % len(failures))
        sys.exit(1)
    print("\nAll desktop checks passed")


if __name__ == "__main__":
    main()
