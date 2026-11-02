"""Hermetic tests for Tether's deeper QA tools.

  * Perfetto system traces (perf.trace_start / trace_stop, flow steps, auto-keep on failure)
  * LeakCanary results from logcat (parser, assert_no_leaks, leak_mark)
  * Device-farm runs: one flow on many devices in parallel (flows.run_flow_matrix, --all,
    POST /api/flow/run-all, MCP all_devices)
  * Midscene YAML import (midscene.py, flows CLI, HTTP import)

Everything runs against the fake adb (tests/fake_adb.py) — no phone needed.

  python apps/pushlab/tether/tests/verify_deep.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

PASSES = 0
FAILURES: list[str] = []
TOKEN = "deep-test-token"
SERIAL = "emulator-5554"
EXTRA = ["emulator-5556", "emulator-5558"]
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

LEAK_LOG = """\
11-01 08:10:00.000  4242  4300 D LeakCanary: ====================================
11-01 08:10:00.000  4242  4300 D LeakCanary: HEAP ANALYSIS RESULT
11-01 08:10:00.000  4242  4300 D LeakCanary: ====================================
11-01 08:10:00.000  4242  4300 D LeakCanary: 1 APPLICATION LEAKS
11-01 08:10:00.000  4242  4300 D LeakCanary: 
11-01 08:10:00.000  4242  4300 D LeakCanary: References underlined with "~~~" are likely causes.
11-01 08:10:00.000  4242  4300 D LeakCanary: Learn more at https://squ.re/leaks.
11-01 08:10:00.000  4242  4300 D LeakCanary: 
11-01 08:10:00.000  4242  4300 D LeakCanary: 51128 bytes retained by leaking objects
11-01 08:10:00.000  4242  4300 D LeakCanary: Signature: 9e3f1c2b7d0a4e55c1f2
11-01 08:10:00.000  4242  4300 D LeakCanary: \u252c\u2500\u2500\u2500
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2502 GC Root: System class
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2502
11-01 08:10:00.000  4242  4300 D LeakCanary: \u251c\u2500 com.demo.app.SessionManager class
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2502    Leaking: NO (a class is never leaking)
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2502    \u2193 static SessionManager.listener
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2502                            ~~~~~~~~
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2570\u2192 com.demo.app.LoginActivity instance
11-01 08:10:00.000  4242  4300 D LeakCanary: \u200b     Leaking: YES (ObjectWatcher was watching this because com.demo.app.LoginActivity received Activity#onDestroy() callback)
11-01 08:10:00.000  4242  4300 D LeakCanary: ====================================
11-01 08:10:00.000  4242  4300 D LeakCanary: 1 LIBRARY LEAKS
11-01 08:10:00.000  4242  4300 D LeakCanary: 
11-01 08:10:00.000  4242  4300 D LeakCanary: Leak pattern: instance field android.view.inputmethod.InputMethodManager#mNextServedView
11-01 08:10:00.000  4242  4300 D LeakCanary: 2048 bytes retained by leaking objects
11-01 08:10:00.000  4242  4300 D LeakCanary: \u252c\u2500\u2500\u2500
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2502 GC Root: Global variable in native code
11-01 08:10:00.000  4242  4300 D LeakCanary: \u2570\u2192 com.demo.app.SearchActivity instance
11-01 08:10:00.000  4242  4300 D LeakCanary: \u200b     Leaking: YES (Activity#mDestroyed is true)
11-01 08:10:00.000  4242  4300 D LeakCanary: ====================================
11-01 08:10:00.000  4242  4300 D LeakCanary: 0 UNREACHABLE OBJECTS
11-01 08:10:00.000  4242  4300 D LeakCanary: ====================================
11-01 08:10:00.000  4242  4300 D LeakCanary: METADATA
11-01 08:10:00.000  4242  4300 D LeakCanary: Build.VERSION.SDK_INT: 34
"""

MIDSCENE_SCRIPT = """\
# Midscene.js script (https://midscenejs.com) — Android target
android:
  deviceId: s4ey59ytbitot4yp
  launch: com.demo.app

agent:
  testId: login-smoke

tasks:
  - name: sign in
    flow:
      - aiAct: open the sign-in form
      - aiTap: the Sign in button
      - aiInput: the email field
        value: qa@example.com
      - aiInput: hunter2
        locate: the password field
      - aiKeyboardPress: the password field
        keyName: Enter
      - aiWaitFor: the dashboard is visible
        timeout: 20000
      - aiAssert: the header says Dashboard
        errorMessage: login did not reach the dashboard
      - sleep: 1500
  - name: browse
    continueOnError: true
    flow:
      - aiScroll:
        scrollType: singleAction
        direction: down
      - aiScroll: the results list
        scrollType: scrollToBottom
      - aiHover: the avatar
      - aiQuery: "string[], titles of the cards"
      - runAdbShell: pm clear com.demo.app
      - recordToReport: after browsing
      - terminate: com.demo.app
"""

SIMPLE_MIDSCENE = """\
android:
  launch: com.demo.app
tasks:
  - name: smoke
    flow:
      - sleep: 100
      - aiKeyboardPress: Enter
      - aiScroll:
        direction: up
      - recordToReport: home
"""


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def raises(func, *args, contains: str = "", **kwargs) -> bool:
    from adb import AdbError

    try:
        func(*args, **kwargs)
    except (AdbError, ValueError) as exc:
        return contains.lower() in str(exc).lower()
    return False


def fake_log(tmp: Path) -> str:
    path = tmp / "input.log"
    return path.read_text(encoding="utf-8") if path.exists() else ""


def reset_log(tmp: Path) -> None:
    (tmp / "input.log").write_text("", encoding="utf-8")


def set_perf(tmp: Path, **values) -> None:
    (tmp / "fake-perf.json").write_text(json.dumps(values), encoding="utf-8")


# ----------------------------------------------------------------- LeakCanary
def leak_parser_tests() -> None:
    import perf

    print("LeakCanary parser")
    messages = [line.split("LeakCanary: ", 1)[1] for line in LEAK_LOG.splitlines()]
    result = perf.parse_leakcanary(messages)
    check(result["analyses"] == 1 and result["application_leaks"] == 1 and result["library_leaks"] == 1,
          "1 application + 1 library leak counted")
    check(result["retained_bytes"] == 51128 + 2048, "retained bytes summed across leak groups")
    check(result["leaks"] == [{"class": "com.demo.app.LoginActivity", "kind": "application"},
                              {"class": "com.demo.app.SearchActivity", "kind": "library"}],
          "leaking objects (\u2570\u2192 lines) attributed to their section")
    check("SessionManager" not in json.dumps(result), "non-leaking path nodes are not reported")
    empty = perf.parse_leakcanary(["some other line"])
    check(empty["analyses"] == 0 and empty["application_leaks"] == 0, "no analysis → zero counts")
    failed = perf.parse_leakcanary(["HEAP ANALYSIS FAILED", "java.lang.OutOfMemoryError"])
    check(failed["failed_analyses"] == 1 and failed["application_leaks"] == 0, "failed analysis counted")
    twice = perf.parse_leakcanary(messages + messages)
    check(twice["analyses"] == 2 and twice["application_leaks"] == 2 and len(twice["leaks"]) == 2,
          "repeated analyses add up, classes de-duplicated")
    clean = perf.parse_leakcanary(["HEAP ANALYSIS RESULT", "0 APPLICATION LEAKS", "0 LIBRARY LEAKS"])
    check(clean["analyses"] == 1 and clean["application_leaks"] == 0, "clean analysis recognised")


def leak_device_tests(tmp: Path) -> None:
    import perf
    from adb import Adb
    from flows import run_flow

    print("LeakCanary on the device")
    adb = Adb()
    leaks_file = tmp / "fake-leaks.txt"
    if leaks_file.exists():
        leaks_file.unlink()
    reset_log(tmp)
    result = perf.assert_no_leaks(adb, SERIAL)
    check(result["analyses"] == 0 and result["counted"] == 0, "no LeakCanary output → passes")
    check(raises(perf.assert_no_leaks, adb, SERIAL, require_analysis=True, contains="no heap analysis"),
          "require_analysis fails when LeakCanary logged nothing")
    check("logcat leakcanary since -" in fake_log(tmp), "reads `logcat -s LeakCanary:*` (whole buffer, no mark)")

    mark = perf.leak_mark(adb, SERIAL)
    check(mark == "1730419200.000", "leak_mark uses the device clock (date +%s)")
    leaks_file.write_bytes(LEAK_LOG.encode("utf-8"))
    reset_log(tmp)
    check(raises(perf.assert_no_leaks, adb, SERIAL, contains="LoginActivity"),
          "application leak fails with the leaking class")
    check("logcat leakcanary since 1730419200.000" in fake_log(tmp), "after leak_mark only newer lines are read (-T)")
    ok = perf.assert_no_leaks(adb, SERIAL, max_leaks=1)
    check(ok["counted"] == 1, "max_leaks=1 tolerates one application leak")
    check(raises(perf.assert_no_leaks, adb, SERIAL, max_leaks=1, include_library=True, contains="2 leak"),
          "include_library counts library leaks too")
    report = perf.leaks(adb, SERIAL, "1730419200.000")
    check(report["application_leaks"] == 1 and report["retained_bytes"] == 53176, "perf.leaks summary")
    check(raises(perf.leaks, adb, SERIAL, "yesterday; rm -rf /", contains="epoch"), "since is validated")

    flow = {"name": "leaks", "steps": [
        {"action": "launch", "package": "com.demo.app"},
        {"action": "leak_mark"},
        {"action": "assert_no_leaks", "wait_ms": 0},
    ]}
    flow_report = run_flow(adb, SERIAL, flow, settle_ms=0)
    last = flow_report["steps"][-1]
    check(not flow_report["passed"] and "LoginActivity" in last.get("error", ""), "assert_no_leaks step fails the flow")
    check(flow_report["steps"][1].get("leaks", {}).get("since") == "1730419200.000", "leak_mark step reports its mark")
    leaks_file.unlink()
    perf._leak_marks.clear()
    clean_report = run_flow(adb, SERIAL, flow, settle_ms=0)
    check(clean_report["passed"] and clean_report["steps"][-1]["leaks"]["counted"] == 0,
          "flow passes once the leak is gone")


# ------------------------------------------------------------------- Perfetto
def trace_tests(tmp: Path) -> None:
    import perf
    from adb import Adb
    from flows import run_flow

    print("Perfetto traces")
    adb = Adb()
    reports = Path(os.environ["TETHER_REPORTS_DIR"])
    reset_log(tmp)
    result = perf.trace(adb, SERIAL, 1, "com.demo.app")
    log = fake_log(tmp)
    check(Path(result["path"]).is_file() and result["bytes"] == Path(result["path"]).stat().st_size > 0,
          "trace pulled to the reports folder")
    check(Path(result["path"]).parent == reports and result["path"].endswith(".pftrace"), "named .pftrace in reports/")
    check(result["open"] == "https://ui.perfetto.dev", "points at the Perfetto UI")
    check("perfetto --background -o /data/misc/perfetto-traces/tether-" in log, "perfetto runs in the background")
    check(" -a com.demo.app " in log and " sched " in log and " gfx " in log and " -t 31s " in log,
          "app atrace, categories and duration passed")
    check("perfetto stop 31337" in log and "pull /data/misc/perfetto-traces/" in log
          and "rm /data/misc/perfetto-traces/" in log, "stopped with SIGTERM, pulled, removed from the phone")

    perf.trace_start(adb, SERIAL)
    check(raises(perf.trace_start, adb, SERIAL, contains="already recording"), "one trace per device at a time")
    discarded = perf.trace_stop(adb, SERIAL, keep=False)
    check(discarded.get("discarded") and "path" not in discarded, "trace can be discarded without pulling")
    check(raises(perf.trace_stop, adb, SERIAL, contains="no perfetto trace"), "stop without a trace explained")
    check(raises(perf.trace_start, adb, SERIAL, keep="sometimes", contains="keep"), "keep option validated")
    check(raises(perf.trace_start, adb, SERIAL, "bad pkg;", contains=""), "package validated")
    check(perf.active_trace(SERIAL) is None, "failed starts leave no stale trace")

    set_perf(tmp, no_perfetto=True)
    check(raises(perf.trace_start, adb, SERIAL, contains="Android 9+"), "missing perfetto binary explained")
    check(perf.active_trace(SERIAL) is None, "no stale trace after perfetto is missing")
    set_perf(tmp)

    before = set(reports.glob("*.pftrace"))
    passing = {"name": "trace-ok", "steps": [
        {"action": "perf_trace_start", "package": "com.demo.app", "keep": "on_fail"},
        {"action": "launch", "package": "com.demo.app"},
    ]}
    report = run_flow(adb, SERIAL, passing, settle_ms=0)
    check(report["passed"] and report.get("trace", {}).get("discarded"), "keep=on_fail: passing flow discards the trace")
    check(set(reports.glob("*.pftrace")) == before, "nothing written for a passing on_fail flow")
    check(perf.active_trace(SERIAL) is None, "flow end stops the trace it started")

    failing = {"name": "trace-fail", "steps": [
        {"action": "perf_trace_start", "keep": "on_fail"},
        {"action": "tap_element", "text": "No such button", "timeout_ms": 300},
    ]}
    report = run_flow(adb, SERIAL, failing, settle_ms=0)
    kept = report.get("trace", {})
    check(not report["passed"] and Path(kept.get("path", "")).is_file(), "failing flow keeps the trace as evidence")
    check(Path(kept.get("path", "x")).name.startswith("trace-fail-emulator-5554-"), "trace file named after flow + device")

    explicit = {"name": "trace-steps", "steps": [
        {"action": "perf_trace_start", "max_seconds": 5},
        {"action": "launch", "package": "com.demo.app"},
        {"action": "perf_trace_stop", "name": "launch"},
    ]}
    report = run_flow(adb, SERIAL, explicit, settle_ms=0)
    stopped = report["steps"][2].get("trace", {})
    check(report["passed"] and Path(stopped.get("path", "")).is_file() and "trace" not in report,
          "perf_trace_stop step returns the pulled trace")
    check(report["steps"][0]["trace"]["max_seconds"] == 5, "perf_trace_start reports its settings")

    startup = {"name": "startup-trace", "steps": [
        {"action": "perf_startup", "package": "com.demo.app", "trace": True, "max_ms": 100},
    ]}
    report = run_flow(adb, SERIAL, startup, settle_ms=0)
    error = report["steps"][0].get("error", "")
    check(not report["passed"] and "budget" in error and ".pftrace" in error,
          "perf_startup trace=true: an over-budget launch points at its trace")
    check(perf.active_trace(SERIAL) is None, "startup trace stopped even when the budget fails")

    # A trace started outside the flow is left alone
    perf.trace_start(adb, SERIAL)
    report = run_flow(adb, SERIAL, {"steps": [{"action": "launch", "package": "com.demo.app"}]}, settle_ms=0)
    check(perf.active_trace(SERIAL) is not None and "trace" not in report, "a trace started outside the flow keeps running")
    perf.trace_stop(adb, SERIAL, keep=False)


def validation_tests() -> None:
    from flows import FlowError, validate_flow

    print("Validation")
    good = {"steps": [
        {"action": "perf_trace_start", "max_seconds": 60, "keep": "always"},
        {"action": "perf_trace_stop"},
        {"action": "leak_mark"},
        {"action": "assert_no_leaks", "max_leaks": 0, "wait_ms": 10000, "include_library": True},
        {"action": "ai_assert", "condition": "x", "timeout_ms": 5000},
    ]}
    check(len(validate_flow(good)) == 5, "new steps validate")
    for bad, label in (
        ({"action": "perf_trace_start", "keep": "never"}, "keep must be always/on_fail"),
        ({"action": "perf_trace_start", "max_seconds": 0}, "max_seconds lower bound"),
        ({"action": "perf_trace_start", "max_seconds": 900}, "max_seconds upper bound"),
        ({"action": "assert_no_leaks", "max_leaks": -1}, "negative max_leaks"),
        ({"action": "assert_no_leaks", "max_leaks": 1.5}, "fractional max_leaks"),
        ({"action": "assert_no_leaks", "wait_ms": 700000}, "wait_ms upper bound"),
        ({"action": "ai_assert", "condition": "x", "timeout_ms": 999999}, "ai_assert timeout_ms bound"),
    ):
        try:
            validate_flow({"steps": [bad]})
            check(False, f"rejected: {label}")
        except FlowError:
            check(True, f"rejected: {label}")


# --------------------------------------------------------------- device farm
def matrix_tests(tmp: Path) -> None:
    from adb import Adb
    from flows import ready_serials, run_flow_matrix
    from mcp_server import TetherTools

    print("Multi-device runs")
    os.environ["TETHER_FAKE_EXTRA_DEVICES"] = ",".join(EXTRA)
    (tmp / "state.txt").write_text("", encoding="utf-8")
    try:
        adb = Adb()
        serials = ready_serials(adb)
        check(serials == [SERIAL] + EXTRA, "all ready devices found (unauthorised one skipped)")
        flow = {"name": "farm", "steps": [
            {"action": "launch", "package": "com.demo.app"},
            {"action": "wait_for", "text": "Welcome to Demo", "timeout_ms": 2000},
            {"action": "screenshot", "name": "login"},
        ]}
        seen: list[str] = []
        reset_log(tmp)
        matrix = run_flow_matrix(adb, serials, flow, on_step=lambda serial, result: seen.append(serial),
                                 settle_ms=0)
        check(matrix["passed"] and matrix["devices"] == 3 and matrix["passed_devices"] == 3, "flow passes on 3 devices")
        check([r["serial"] for r in matrix["reports"]] == serials, "one report per device, in order")
        check(all(len(r["screenshots"]) == 1 for r in matrix["reports"]), "each device has its own screenshot")
        check(sorted(set(seen)) == sorted(serials) and len(seen) == 9, "progress callback tagged with the serial")
        log = fake_log(tmp)
        check(all(f"[{s}] shell monkey" in log for s in EXTRA) and "launch com.demo.app" in log,
              "commands reached every device")

        mixed = run_flow_matrix(adb, [SERIAL, "ghost-device"], flow, settle_ms=0)
        ghost = mixed["reports"][1]
        check(not mixed["passed"] and mixed["passed_devices"] == 1 and mixed["failed_devices"] == ["ghost-device"],
              "a missing device fails alone; the others still pass")
        check(not ghost["passed"] and ghost["steps"] and "not found" in ghost["steps"][0].get("error", ""),
              "the missing device's report says why")
        check(raises(run_flow_matrix, adb, [], flow, contains="no devices"), "empty device list rejected")
        deduped = run_flow_matrix(adb, [SERIAL, SERIAL], flow, settle_ms=0)
        check(deduped["devices"] == 1, "duplicate serials run once")

        out = tmp / "farm-out"
        flow_file = tmp / "farm.json"
        flow_file.write_text(json.dumps(flow), encoding="utf-8")
        proc = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "run", str(flow_file), "--all",
                               "--out", str(out)], capture_output=True, text=True, env=os.environ.copy(), timeout=120)
        check(proc.returncode == 0 and "3/3 device(s) passed" in proc.stdout, "flows.py run --all passes on 3 devices")
        summary = json.loads((out / "matrix.json").read_text(encoding="utf-8")) if (out / "matrix.json").exists() else {}
        check(summary.get("devices") == 3 and all((out / s / "report.json").exists() for s in serials),
              "--out writes matrix.json + a folder per device")
        check(all((out / s / "003_login.png").exists() for s in serials), "per-device screenshots saved")
        check(f"[{EXTRA[0]}] [PASS]" in proc.stdout, "live output is prefixed with the serial")

        tools = TetherTools(adb)
        data = json.loads(tools.call("run_flow", {"flow": flow, "all_devices": True})[0]["text"])
        check(data["devices"] == 3 and data["passed"] and "screenshots" not in data["reports"][0],
              "MCP run_flow all_devices=true")
        api_matrix_tests(flow)
    finally:
        os.environ.pop("TETHER_FAKE_EXTRA_DEVICES", None)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def start_server():
    port = free_port()
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port),
                               "--token", TOKEN, "--no-browser"], env=os.environ.copy(),
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def call(method, path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method,
                                         headers={"X-Tether-Token": TOKEN, "Content-Type": "application/json"})
        try:
            with OPENER.open(request, timeout=60) as response:
                payload = response.read()
                return response.status, (payload if raw else json.loads(payload))
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    for _ in range(100):
        try:
            if call("GET", "/api/health")[0] == 200:
                break
        except OSError:
            time.sleep(0.1)
    return server, call


def api_matrix_tests(flow: dict) -> None:
    server, call = start_server()
    try:
        status, data = call("POST", "/api/flow/run-all", {"flow": flow})
        matrix = data.get("matrix", {})
        check(status == 200 and matrix.get("devices") == 3 and matrix.get("passed"), "POST /api/flow/run-all (all devices)")
        shots = matrix.get("reports", [{}])[0].get("screenshots", [])
        check(bool(shots) and "png_base64" in shots[0], "run-all reports carry base64 screenshots")
        status, data = call("POST", "/api/flow/run-all", {"flow": flow, "serials": [EXTRA[1]]})
        check(status == 200 and data["matrix"]["devices"] == 1 and data["matrix"]["reports"][0]["serial"] == EXTRA[1],
              "run-all with an explicit serial list")
        status, data = call("POST", "/api/flow/run-all", {"yaml": SIMPLE_MIDSCENE, "serials": [SERIAL]})
        check(status == 200 and data["matrix"]["passed"], "run-all accepts Midscene YAML")
        status, data = call("POST", "/api/flow/run-all", {"flow": {"steps": [{"action": "nope"}]}})
        check(status == 400, "run-all validates the flow")
    finally:
        server.terminate()
        server.wait(timeout=10)


# ------------------------------------------------------------------ Midscene
def midscene_tests(tmp: Path) -> None:
    import flows
    import midscene
    from adb import AdbError

    print("Midscene import")
    check(midscene.looks_like_midscene(MIDSCENE_SCRIPT), "Midscene script detected")
    check(not midscene.looks_like_midscene("appId: com.demo.app\n---\n- launchApp\n"), "Maestro flow not mistaken")
    flow, warnings = midscene.midscene_to_flow(MIDSCENE_SCRIPT)
    steps = flow["steps"]
    actions = [s["action"] for s in steps]
    check(steps[0] == {"action": "launch", "package": "com.demo.app"}, "android.launch → launch step")
    check(steps[1] == {"action": "ai", "goal": "open the sign-in form"}, "aiAct → ai goal")
    check(steps[2]["goal"] == "Tap the Sign in button", "aiTap → ai 'Tap …'")
    check(steps[3]["goal"] == "Type 'qa@example.com' into the email field", "aiInput (locate + value) → typed goal")
    check(steps[4]["goal"] == "Type 'hunter2' into the password field", "aiInput (value + locate, older form)")
    check(steps[5] == {"action": "key", "key": "enter"}, "aiKeyboardPress keyName Enter → key enter")
    check(steps[6] == {"action": "ai_assert", "condition": "the dashboard is visible", "timeout_ms": 20000},
          "aiWaitFor → ai_assert retried until timeout_ms")
    check(steps[7]["message"] == "login did not reach the dashboard", "aiAssert errorMessage kept")
    check(steps[8] == {"action": "wait", "ms": 1500}, "sleep → wait")
    swipes = [s for s in steps if s["action"] == "swipe"]
    check(len(swipes) == 1 + midscene.EDGE_SWIPES and swipes[0]["y"] > swipes[0]["y2"],
          "aiScroll singleAction + scrollToBottom → swipes up the screen")
    check(all(s.get("optional") for s in steps[9:]), "continueOnError task → optional steps")
    check(actions[-2:] == ["screenshot", "stop"] and steps[-2]["name"] == "after browsing",
          "recordToReport → screenshot, terminate → stop")
    joined = " | ".join(warnings)
    for needle in ("deviceId", "agent", "aiHover", "aiQuery", "runAdbShell not executed", "screen centre"):
        check(needle in joined, f"warning mentions {needle}")
    check("pm clear" not in json.dumps(steps), "runAdbShell never becomes a step")
    flows.validate_flow(flow)
    check(True, "converted flow validates")

    web, web_warnings = midscene.midscene_to_flow(
        "web:\n  url: https://example.com\n  viewportWidth: 1280\ntasks:\n  - name: w\n    flow:\n      - aiTap: Login\n")
    check(web["steps"][0] == {"action": "open_url", "url": "https://example.com"} and web["name"] == "w",
          "web.url → open_url in the phone browser")
    check(any("browser" in w for w in web_warnings), "web target warns about the browser")
    link, _ = midscene.midscene_to_flow("tasks:\n  - name: l\n    flow:\n      - launch: myapp://home\n")
    check(link["steps"] == [{"action": "open_url", "url": "myapp://home"}], "launch: link → open_url")
    space, _ = midscene.midscene_to_flow("tasks:\n  - name: k\n    flow:\n      - aiKeyboardPress: Space\n"
                                         "      - aiKeyboardPress: ArrowDown\n      - aiKeyboardPress: x\n")
    check([s.get("key") or s.get("text") for s in space["steps"]] == [" ", "down", "x"],
          "Space/arrow/single-character keys mapped")

    for bad, label in (
        ("android:\n  launch: a.b\n", "no tasks"),
        ("tasks:\n  - name: x\n", "task without flow"),
        ("tasks:\n  - name: x\n    flow:\n      - sleep: soon\n", "sleep must be ms"),
        ("tasks:\n  - name: x\n    flow:\n      - aiWaitFor: ok\n        timeout: -5\n", "bad timeout"),
        ("tasks:\n  - name: x\n    flow:\n      - aiAssert:\n", "aiAssert without condition"),
        ("tasks:\n  - name: x\n    flow:\n      - aiHover: a\n", "nothing runnable"),
    ):
        check(raises(midscene.midscene_to_flow, bad), f"rejected: {label}")

    # flows CLI: .yaml with tasks: is run/converted as Midscene
    script = tmp / "smoke.yaml"
    script.write_text(SIMPLE_MIDSCENE, encoding="utf-8")
    loaded = flows.load_flow_file(script)
    check(loaded["name"] == "smoke" and loaded["steps"][0]["action"] == "launch", "load_flow_file reads Midscene YAML")
    out_json = tmp / "smoke.json"
    proc = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "convert", str(script), str(out_json)],
                          capture_output=True, text=True, env=os.environ.copy(), timeout=60)
    check(proc.returncode == 0 and json.loads(out_json.read_text(encoding="utf-8"))["steps"][1]["action"] == "wait",
          "flows.py convert midscene.yaml out.json")
    proc = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "run", str(script), "--serial", SERIAL],
                          capture_output=True, text=True, env=os.environ.copy(), timeout=60)
    check(proc.returncode == 0 and "PASSED" in proc.stdout, "flows.py run midscene.yaml on the device")

    # aiWaitFor semantics: ai_assert retries until timeout_ms
    calls = {"n": 0}
    original = flows.ai.ai_assert

    def flaky(adb, serial, condition, config=None):
        calls["n"] += 1
        if calls["n"] < 2:
            raise AdbError("AI assertion failed: still loading")
        return {"passed": True, "reason": "dashboard shown"}

    def never(adb, serial, condition, config=None):
        calls["n"] += 1
        raise AdbError("AI assertion failed: spinner")

    from adb import Adb

    try:
        flows.ai.ai_assert = flaky
        report = flows.run_flow(Adb(), SERIAL, {"steps": [
            {"action": "ai_assert", "condition": "dashboard", "timeout_ms": 5000}]}, settle_ms=0)
        check(report["passed"] and calls["n"] == 2, "ai_assert with timeout_ms retries until it holds")
        calls["n"] = 0
        flows.ai.ai_assert = never
        report = flows.run_flow(Adb(), SERIAL, {"steps": [
            {"action": "ai_assert", "condition": "dashboard", "timeout_ms": 0, "message": "no dashboard"}]}, settle_ms=0)
        error = report["steps"][0].get("error", "")
        check(not report["passed"] and calls["n"] == 1 and error.startswith("no dashboard (AI assertion failed"),
              "without timeout_ms it asks once; errorMessage prefixes the failure")
    finally:
        flows.ai.ai_assert = original


def api_tests(tmp: Path) -> None:
    print("HTTP API + MCP")
    leaks_file = tmp / "fake-leaks.txt"
    leaks_file.write_bytes(LEAK_LOG.encode("utf-8"))
    server, call = start_server()
    try:
        status, data = call("POST", "/api/perf/trace/start", {"serial": SERIAL, "package": "com.demo.app",
                                                             "max_seconds": 20})
        check(status == 200 and data["trace"]["pid"] == 31337, "POST /api/perf/trace/start")
        status, data = call("POST", "/api/perf/trace/start", {"serial": SERIAL})
        check(status == 502 and "already" in data.get("error", ""), "second start refused")
        status, data = call("POST", "/api/perf/trace/stop", {"serial": SERIAL})
        name = data.get("trace", {}).get("file", "")
        check(status == 200 and name.endswith(".pftrace"), "POST /api/perf/trace/stop returns the file")
        status, payload = call("GET", f"/api/perf/trace/file?name={name}", raw=True)
        check(status == 200 and isinstance(payload, bytes) and payload.startswith(b"\x0a\x0cfake-perfetto"),
              "GET /api/perf/trace/file downloads it")
        status, _ = call("GET", "/api/perf/trace/file?name=..%2F..%2Fsecret.pftrace")
        check(status == 400, "trace download refuses paths")
        status, data = call("GET", f"/api/leaks?serial={SERIAL}")
        check(status == 200 and data["leaks"]["application_leaks"] == 1, "GET /api/leaks")
        status, data = call("POST", "/api/flow/midscene/import", {"yaml": MIDSCENE_SCRIPT})
        check(status == 200 and data["format"] == "midscene" and data["flow"]["steps"][0]["action"] == "launch"
              and data["warnings"], "POST /api/flow/midscene/import")
        status, data = call("POST", "/api/flow/maestro/import", {"yaml": SIMPLE_MIDSCENE})
        check(status == 200 and data["format"] == "midscene", "Maestro import endpoint auto-detects Midscene")
        status, data = call("POST", "/api/flow/maestro/import", {"yaml": "appId: com.demo.app\n---\n- launchApp\n"})
        check(status == 200 and data["format"] == "maestro", "…and still converts Maestro")
        status, data = call("POST", "/api/flow/midscene/import", {"yaml": "tasks: []\n"})
        check(status == 400, "bad Midscene script → 400")
    finally:
        server.terminate()
        server.wait(timeout=10)

    from mcp_server import TetherTools, tool_list

    names = {tool["name"] for tool in tool_list("tether")}
    check({"perf_trace", "leak_report"} <= names, "MCP lists perf_trace and leak_report")
    tools = TetherTools()
    trace = json.loads(tools.call("perf_trace", {"seconds": 1})[0]["text"])
    check(Path(trace["path"]).is_file(), "MCP perf_trace pulls a trace")
    leaks = json.loads(tools.call("leak_report", {})[0]["text"])
    check(leaks["leaks"][0]["class"] == "com.demo.app.LoginActivity", "MCP leak_report")
    content = tools.call("run_flow", {"yaml": SIMPLE_MIDSCENE})
    report = json.loads(content[0]["text"])
    check(report["passed"] and report["steps"][0]["action"] == "launch", "MCP run_flow takes Midscene YAML")
    leaks_file.unlink()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    with tempfile.TemporaryDirectory(prefix="tether-deep-") as tmp_name:
        tmp = Path(tmp_name)
        os.environ.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(tmp / "input.log"),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "TETHER_REPORTS_DIR": str(tmp / "reports"),
            "TETHER_QUIET": "1",
        })
        os.environ.pop("TETHER_FAKE_EXTRA_DEVICES", None)
        leak_parser_tests()
        leak_device_tests(tmp)
        trace_tests(tmp)
        validation_tests()
        matrix_tests(tmp)
        midscene_tests(tmp)
        api_tests(tmp)
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
