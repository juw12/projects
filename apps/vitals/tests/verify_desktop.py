#!/usr/bin/env python3
"""Desktop app checks (stdlib only, exits 0/1).

1. The launcher from this checkout (desktop/vitals_app.py) starts the background agent, serves the
   dashboard, reuses a running agent and stops on --stop (the same checks CI runs on every build).
2. The sign-in items it writes (macOS LaunchAgent, Linux autostart entry) are well formed.
3. The app window's plumbing (app_window.py): one window at a time (show/quit over loopback),
   sizes that fit the screen, test mode never opening a browser, the Linux helper bowing out
   cleanly without GTK. (The window itself is opened by smoke_test.py --window in CI.)
4. Agent start-up: no reverse-DNS stall when the agent binds its port, the launcher gives up at
   once if the agent dies but waits for a slow one, and a hung start-up gets logged.
5. Every download link in app.js, README.md and scripts/apps.json names a file that the release
   workflow (.github/workflows/vitals-apps.yml) publishes.
"""

import faulthandler
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.normpath(os.path.join(HERE, ".."))
DESKTOP = os.path.join(APP_ROOT, "desktop")
REPO = os.path.normpath(os.path.join(APP_ROOT, "..", ".."))
sys.path.insert(0, DESKTOP)

import app_window  # noqa: E402
import smoke_test  # noqa: E402
import vitals_app  # noqa: E402

FAILURES = []
ASSET = re.compile(r"Vitals-[A-Za-z0-9-]+\.(?:exe|zip|dmg|deb|tar\.gz|apk|ipa)")


def check(condition, label):
    print(("  ok   " if condition else "  FAIL ") + label)
    if not condition:
        FAILURES.append(label)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as handle:
        return handle.read()


class FakeAgent:
    """Stands in for the agent process in the launcher checks."""

    pid = 4242

    def __init__(self, exit_code):
        self.exit_code = exit_code

    def poll(self):
        return self.exit_code


def check_agent_startup():
    real_getfqdn = socket.getfqdn

    def no_dns(*_args):
        raise AssertionError("reverse DNS lookup")

    socket.getfqdn = no_dns
    try:
        httpd = vitals_app.server.LocalHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
        bound = True
    except AssertionError:
        httpd = None
        bound = False
    finally:
        socket.getfqdn = real_getfqdn
    check(bound and httpd.server_name == "127.0.0.1",
          "the agent opens its port without a reverse-DNS lookup (it stalls 30-70 s on some Macs)")
    if httpd:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        loopback = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            loopback.open("http://127.0.0.1:%d/" % httpd.server_address[1], timeout=5)
            status = 200
        except urllib.error.HTTPError as error:
            status = error.code  # 501: the bare handler has no GET, but the server answered
        except OSError:
            status = None
        httpd.shutdown()
        httpd.server_close()
        check(status is not None, "that server still answers requests")

    messages = []
    saved = (vitals_app.start_agent, vitals_app.server.already_running, vitals_app.tell_user,
             vitals_app.use_log_file, vitals_app.ensure_login_item, vitals_app.START_TIMEOUT)
    vitals_app.server.already_running = lambda port: False
    vitals_app.tell_user = messages.append
    vitals_app.use_log_file = lambda *args, **kwargs: None
    vitals_app.ensure_login_item = lambda data_dir: None
    vitals_app.START_TIMEOUT = 1.5
    folder = tempfile.mkdtemp(prefix="vitals-launch-check-")
    try:
        vitals_app.start_agent = lambda rest: FakeAgent(exit_code=1)
        started = time.time()
        result = vitals_app.open_app([], 9, folder)
        check(result == 1 and time.time() - started < 1 and "could not start" in (messages or [""])[-1],
              "the launcher reports a failed start at once when the agent exits")
        vitals_app.start_agent = lambda rest: FakeAgent(exit_code=None)
        started = time.time()
        result = vitals_app.open_app([], 9, folder)
        waited = time.time() - started
        check(result == 1 and waited >= 1.4 and "taking unusually long" in (messages or [""])[-1],
              "the launcher keeps waiting while a slow agent is still starting (then says so)")
    finally:
        (vitals_app.start_agent, vitals_app.server.already_running, vitals_app.tell_user,
         vitals_app.use_log_file, vitals_app.ensure_login_item, vitals_app.START_TIMEOUT) = saved
    check(vitals_app.START_TIMEOUT >= 60, "a first start may take up to %d s before the launcher gives up"
          % vitals_app.START_TIMEOUT)

    armed = vitals_app.watch_startup(3600)
    faulthandler.cancel_dump_traceback_later()
    real_stderr = sys.stderr
    sys.stderr = None
    try:
        unarmed = vitals_app.watch_startup(3600)
    finally:
        sys.stderr = real_stderr
    check(armed and not unarmed, "a hung agent start-up dumps its stacks to the log (and never crashes without one)")


def check_window_plumbing():
    folder = tempfile.mkdtemp(prefix="vitals-window-check-")
    shown = threading.Event()
    quit_asked = threading.Event()
    control = app_window.WindowControl(folder, on_show=shown.set, on_quit=quit_asked.set)
    info = app_window.window_info(folder)
    check(bool(info) and info["pid"] == os.getpid() and info["port"] > 0, "an open window announces itself in window.json")
    check(app_window.send_to_window(folder, "show") and shown.wait(5),
          "a second launch can bring the open window to the front")
    check(not app_window.send_to_window(folder, "explode", timeout=1), "unknown requests are ignored")
    with open(os.path.join(folder, app_window.CONTROL_FILE), encoding="utf-8") as handle:
        genuine = json.load(handle)
    with open(os.path.join(folder, app_window.CONTROL_FILE), "w", encoding="utf-8") as handle:
        json.dump(dict(genuine, token="0" * 32), handle)
    check(not app_window.send_to_window(folder, "quit", timeout=1) and not quit_asked.is_set(),
          "requests without the window's token are refused")
    with open(os.path.join(folder, app_window.CONTROL_FILE), "w", encoding="utf-8") as handle:
        json.dump(genuine, handle)
    check(app_window.send_to_window(folder, "quit") and quit_asked.wait(5), "--stop can ask the window to close")
    control.close()
    check(not os.path.exists(os.path.join(folder, app_window.CONTROL_FILE)), "a closed window removes window.json")
    with open(os.path.join(folder, app_window.CONTROL_FILE), "w", encoding="utf-8") as handle:
        json.dump({"pid": 999999, "port": smoke_test.free_port(), "token": "x"}, handle)
    started = time.time()
    check(not app_window.send_to_window(folder, "show") and time.time() - started < 3,
          "a stale window.json (crashed window) just opens a new window")
    check(app_window.close_window(folder) is False, "--stop with no window open is a no-op")

    check(app_window.fit_size((1280, 860), (1366, 728)) == (1280, 688),
          "the window fits a small laptop screen (1366x768 with taskbar)")
    check(app_window.fit_size((100, 100), None) == app_window.MIN_SIZE, "the window never gets smaller than its minimum")
    check(app_window.saved_size(folder) == app_window.DEFAULT_SIZE, "first launch uses the default size")
    app_window.save_size(folder, 1000, 700)
    check(app_window.saved_size(folder) == (1000, 700), "the window size is remembered")
    check(all(isinstance(path, str) for path in app_window.browser_candidates()),
          "browser app-mode fallback candidates are listed")

    report = os.path.join(folder, "report.json")
    os.environ["VITALS_WINDOW_TEST"] = report
    try:
        method = app_window.show_dashboard("http://127.0.0.1:9/", folder, browser=True)
    finally:
        del os.environ["VITALS_WINDOW_TEST"]
    with open(report, encoding="utf-8") as handle:
        recorded = json.load(handle).get("method")
    check(method == "browser" and recorded == "browser", "test mode reports instead of opening a browser")

    helper = subprocess.run(
        [sys.executable, os.path.join(DESKTOP, "linux_window.py"), "--url", "http://127.0.0.1:9/",
         "--data", folder, "--storage", os.path.join(folder, "webkit")],
        capture_output=True, text=True, timeout=60,
    )
    try:
        import gi  # noqa: F401
        has_gtk = True
    except ImportError:
        has_gtk = False
    if has_gtk:
        print("SKIP: Linux window without GTK (this Python has GTK bindings)")
    else:
        check(helper.returncode == 3, "without GTK the Linux window exits with status 3, so the app falls back")


def main():
    FAILURES.extend(smoke_test.run_smoke([sys.executable, os.path.join(DESKTOP, "vitals_app.py")],
                                         "launcher from this checkout"))

    print("Sign-in items")
    plist = vitals_app.launch_agent_plist("/Applications/Vitals & Co.app/Contents/MacOS/Vitals")
    check("<string>/Applications/Vitals &amp; Co.app/Contents/MacOS/Vitals</string><string>--background</string>" in plist,
          "macOS LaunchAgent starts the app with --background (path XML-escaped)")
    check("<key>Label</key><string>io.github.juw12.vitals</string>" in plist and "<key>RunAtLoad</key><true/>" in plist
          and "KeepAlive" not in plist,
          "macOS LaunchAgent: same label as the script installer, runs at login, no restart loop if the app is deleted")
    entry = vitals_app.desktop_entry("/home/me/My Apps/Vitals/vitals", background=True)
    check('Exec="/home/me/My Apps/Vitals/vitals" --background' in entry and "TryExec=/home/me/My Apps/Vitals/vitals" in entry,
          "Linux autostart entry quotes the path and is skipped once the app is gone")
    mode, rest = vitals_app.split_args(["--background", "--port", "9", "-psn_0_123"])
    check(mode == "background" and rest == ["--port", "9"], "launcher switches are kept apart from agent options")
    check(vitals_app.split_args(["--browser"])[0] == "browser", "--browser opens the dashboard in the web browser instead")
    menu = vitals_app.desktop_entry("/opt/vitals/vitals", icon="/tmp/vitals.png")
    check("StartupWMClass=vitals" in menu and "NoDisplay" not in menu,
          "Linux menu entry groups the Vitals window under its icon")

    print("Agent start-up")
    check_agent_startup()

    print("App window")
    check_window_plumbing()

    print("Download links")
    workflow_path = os.path.join(REPO, ".github", "workflows", "vitals-apps.yml")
    published = set(ASSET.findall(read(workflow_path))) if os.path.exists(workflow_path) else set()
    check(len(published) >= 8, "the release workflow publishes the desktop and phone downloads (%d files)" % len(published))
    sources = [("web/app.js", os.path.join(APP_ROOT, "web", "app.js")),
               ("README.md", os.path.join(APP_ROOT, "README.md")),
               ("scripts/apps.json", os.path.join(REPO, "scripts", "apps.json"))]
    for label, path in sources:
        if not os.path.exists(path):
            print("SKIP: %s (not in this checkout)" % label)
            continue
        named = set(ASSET.findall(read(path)))
        missing = sorted(named - published)
        check(bool(named) and not missing,
              "%s links only to published downloads%s" % (label, (" - unknown: " + ", ".join(missing)) if missing else ""))

    if FAILURES:
        print("\n%d check(s) failed" % len(FAILURES))
        sys.exit(1)
    print("\nAll desktop checks passed")


if __name__ == "__main__":
    main()
