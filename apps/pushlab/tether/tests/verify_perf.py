"""Hermetic tests for Tether performance tools (perf.py, SoloPi-style).

Parsers are checked against realistic dumpsys / am output; flows, the HTTP API
and MCP tools run against the fake adb (tests/fake_adb.py).

  python apps/pushlab/tether/tests/verify_perf.py
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
TOKEN = "perf-test-token"
SERIAL = "emulator-5554"
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


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


def parser_tests() -> None:
    import perf

    print("Parsers")
    started = perf.parse_am_start("Starting: Intent { cmp=a.b/.Main }\nStatus: ok\nLaunchState: COLD\n"
                                  "Activity: a.b/.Main\nTotalTime: 812\nWaitTime: 830\nComplete\n")
    check(started == {"status": "ok", "launch_state": "COLD", "total_ms": 812, "wait_ms": 830}, "am start -W parsed")
    old = perf.parse_am_start("Status: ok\nActivity: a.b/.Main\nThisTime: 400\nTotalTime: 420\nWaitTime: 450\n")
    check(old["total_ms"] == 420 and "launch_state" not in old, "older Android output (no LaunchState) parsed")
    check(raises(perf.parse_am_start, "Error type 3\nError: Activity class {a.b/.X} does not exist.\n",
                 contains="does not exist"), "am start error surfaced")
    check(raises(perf.parse_am_start, "Status: timeout\nTotalTime: 10000\n", contains="timeout"),
          "non-ok launch status rejected")

    meminfo = ("** MEMINFO in pid 1 [a.b] **\n        TOTAL    95000    60000\n App Summary\n"
               "           Java Heap:    12288                          30000\n"
               "         Native Heap:    20480                          21000\n"
               "           TOTAL PSS:    97280            TOTAL RSS:   180000\n")
    memory = perf.parse_meminfo(meminfo)
    check(memory == {"pss_mb": 95.0, "java_heap_mb": 12.0, "native_heap_mb": 20.0, "rss_mb": 175.8},
          "meminfo: TOTAL PSS preferred, heaps + RSS in MB")
    check(perf.parse_meminfo("** MEMINFO **\n        TOTAL    51200    100\n")["pss_mb"] == 50.0,
          "meminfo: older TOTAL row fallback")
    check(raises(perf.parse_meminfo, "No process found for: a.b\n", contains="not running"),
          "meminfo: app not running explained")

    gfx = ("Total frames rendered: 1200\nJanky frames: 36 (3.00%)\nJanky frames (legacy): 50 (4.16%)\n"
           "50th percentile: 7ms\n90th percentile: 12ms\n95th percentile: 16ms\n99th percentile: 32ms\n")
    check(perf.parse_gfxinfo(gfx) == {"frames": 1200, "janky_frames": 36, "jank_percent": 3.0, "p50_ms": 7,
                                      "p90_ms": 12, "p95_ms": 16, "p99_ms": 32},
          "gfxinfo parsed (modern janky line, not legacy)")
    check(raises(perf.parse_gfxinfo, "Applications Graphics Acceleration Info:\n", contains="frame stats"),
          "gfxinfo without stats rejected")

    stat_a = "cpu  1000 0 500 8000 100 0 0 0 0 0\ncpu0 1 0 0 0\ncpu1 1 0 0 0\n" \
             "77 (my app (x)) S 1 77 0 0 -1 0 0 0 0 0 100 50 0 0\n"
    stat_b = "cpu  1300 0 600 8600 100 0 0 0 0 0\ncpu0 1 0 0 0\ncpu1 1 0 0 0\n" \
             "77 (my app (x)) S 1 77 0 0 -1 0 0 0 0 0 200 100 0 0\n"
    cpu = perf.parse_cpu_window(stat_a + "===TETHER===\n" + stat_b)
    check(cpu == {"percent": 15.0, "core_percent": 30.0, "cores": 2},
          "CPU share from /proc deltas (process name with spaces and parentheses)")

    measured = {"memory": {"pss_mb": 120.0}, "frames": {"jank_percent": 3.0, "p90_ms": 12}, "cpu": {"percent": 20.0}}
    check(perf.check_budgets(measured, {"max_pss_mb": 150, "max_jank_percent": 5, "max_cpu_percent": 30}) == [],
          "within budget -> no problems")
    problems = perf.check_budgets(measured, {"max_pss_mb": 100, "max_p90_ms": 10, "max_p99_ms": 50})
    check(problems == ["pss_mb 120.0 > 100", "p90_ms 12 > 10", "p99_ms not available on this device (budget max_p99_ms=50)"],
          "over budget and missing metrics both reported")
    check(perf.budget_groups({"max_pss_mb": 1, "max_p90_ms": 1}) == ("frames", "memory"),
          "only the needed metric groups are measured")


def device_tests(tmp: Path) -> None:
    from adb import Adb
    from flows import FlowError, run_flow, validate_flow
    import perf

    print("Fake device")
    adb = Adb()
    log_path = tmp / "input.log"
    started = perf.startup(adb, SERIAL, "com.demo.app", cold=True, runs=3)
    check(started["component"] == "com.demo.app/.MainActivity" and started["total_ms"] == 812
          and started["runs"] == 3 and started["launch_state"] == "COLD", "cold startup: launcher resolved, median of 3")
    check(log_path.read_text().count("startup cold com.demo.app/.MainActivity") == 3, "am start -W -S used for cold runs")
    warm = perf.startup(adb, SERIAL, "com.demo.app", cold=False)
    check(warm["mode"] == "warm" and warm["launch_state"] == "WARM" and warm["total_ms"] == 270
          and "keyevent" in log_path.read_text(), "warm startup goes home first, no -S")
    check(raises(perf.startup, adb, SERIAL, "com.other.app", contains="no launcher activity"),
          "app without launcher activity explained")
    check(raises(perf.startup, adb, SERIAL, "com.demo.app", activity="com.demo.app/.Missing",
                 contains="does not exist"), "missing activity reported")
    check(raises(perf.startup, adb, SERIAL, "com.demo.app", activity="x; reboot", contains="invalid activity"),
          "activity string validated (no shell injection)")
    snap = perf.snapshot(adb, SERIAL, "com.demo.app", 0.2)
    check(snap["memory"]["pss_mb"] == 95.0 and snap["frames"]["jank_percent"] == 3.0
          and snap["cpu"]["percent"] == 20.0 and snap["cpu"]["core_percent"] == 160.0 and snap["cpu"]["cores"] == 8,
          "snapshot: memory, frames and CPU from the fake device")
    check(raises(perf.memory, adb, SERIAL, "com.not.running", contains="not running")
          and raises(perf.cpu, adb, SERIAL, "com.not.running", contains="not running"),
          "not-running app explained for memory and CPU")
    check(raises(perf.memory, adb, SERIAL, "bad;pkg", contains="invalid package"), "package names validated")

    print("Flows")
    flow = {"name": "perf", "steps": [
        {"action": "perf_startup", "package": "com.demo.app", "max_ms": 1500},
        {"action": "perf_assert", "package": "com.demo.app", "max_pss_mb": 150, "max_jank_percent": 5,
         "max_cpu_percent": 50, "cpu_window_s": 0.2},
        {"action": "perf_reset", "package": "com.demo.app"},
        {"action": "perf_assert", "package": "com.demo.app", "max_jank_percent": 10, "optional": True},
        {"action": "perf_assert", "package": "com.demo.app", "max_pss_mb": 150},
    ]}
    report = run_flow(adb, SERIAL, flow, settle_ms=0)
    steps = report["steps"]
    check(steps[0]["ok"] and steps[0]["perf"]["total_ms"] == 812, "perf_startup passes within max_ms")
    check(steps[1]["ok"] and steps[1]["perf"]["memory"]["pss_mb"] == 95.0 and "cpu" in steps[1]["perf"],
          "perf_assert passes and reports measurements")
    check(steps[2]["ok"] and "gfxinfo reset com.demo.app" in log_path.read_text(), "perf_reset resets the frame window")
    check(steps[3].get("optional_failed") and "jank_percent 20.0 > 10" in steps[3]["error"],
          "frames after reset judged on their own (janky scenario caught)")
    check(steps[4]["ok"] and set(steps[4]["perf"]) == {"package", "memory"} and report["passed"],
          "only budgeted metrics measured; flow passes")
    (tmp / "fake-perf.json").write_text(json.dumps({"startup_ms": 2400}))
    report = run_flow(adb, SERIAL, {"steps": [{"action": "perf_startup", "package": "com.demo.app", "max_ms": 1500},
                                              {"action": "launch", "package": "com.demo.app"}]}, settle_ms=0)
    check(not report["passed"] and "2400 ms > budget 1500" in report["steps"][0]["error"]
          and report["steps"][1].get("skipped"), "slow startup fails the flow and stops it")
    (tmp / "fake-perf.json").unlink()
    for bad, label in (
        ({"action": "perf_assert", "package": "com.demo.app"}, "perf_assert without budget"),
        ({"action": "perf_assert", "package": "com.demo.app", "max_pss_mb": "big"}, "non-numeric budget"),
        ({"action": "perf_startup", "package": "com.demo.app", "runs": 50}, "runs out of range"),
        ({"action": "perf_reset"}, "perf step without package"),
    ):
        try:
            validate_flow({"steps": [bad]})
            check(False, f"rejected: {label}")
        except FlowError:
            check(True, f"rejected: {label}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def api_tests() -> None:
    print("HTTP API + MCP")
    port = free_port()
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port),
                               "--token", TOKEN, "--no-browser"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def call(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method,
                                         headers={"X-Tether-Token": TOKEN, "Content-Type": "application/json"})
        try:
            with OPENER.open(request, timeout=30) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    try:
        for _ in range(100):
            try:
                if call("GET", "/api/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        status, data = call("GET", f"/api/perf?serial={SERIAL}&package=com.demo.app&cpu_window=0.2")
        check(status == 200 and data["perf"]["memory"]["pss_mb"] == 95.0 and data["perf"]["cpu"]["percent"] == 20.0,
              "GET /api/perf snapshot")
        status, data = call("GET", f"/api/perf?serial={SERIAL}&package=com.demo.app&only=memory")
        check(status == 200 and set(data["perf"]) == {"package", "memory"}, "GET /api/perf?only=memory")
        status, data = call("POST", "/api/perf/startup", {"serial": SERIAL, "package": "com.demo.app", "runs": 2})
        check(status == 200 and data["startup"]["total_ms"] == 812 and data["startup"]["runs"] == 2,
              "POST /api/perf/startup")
        status, data = call("POST", "/api/perf/reset", {"serial": SERIAL, "package": "com.demo.app"})
        check(status == 200 and data["ok"], "POST /api/perf/reset")
        status, data = call("GET", f"/api/perf?serial={SERIAL}&package=com.not.running")
        check(status >= 400 and "not running" in data.get("error", ""), "API explains a stopped app")
    finally:
        server.terminate()
        server.wait(timeout=10)

    from mcp_server import TetherTools, tool_list

    names = {tool["name"] for tool in tool_list("tether")}
    check({"perf_snapshot", "perf_startup"} <= names, "MCP lists perf_snapshot and perf_startup")
    tools = TetherTools()
    snap = json.loads(tools.call("perf_snapshot", {"package": "com.demo.app", "cpu_window_s": 0.2})[0]["text"])
    reset = json.loads(tools.call("perf_snapshot", {"package": "com.demo.app", "reset_frames": True})[0]["text"])
    startup = json.loads(tools.call("perf_startup", {"package": "com.demo.app", "cold": False})[0]["text"])
    check(snap["frames"]["frames"] >= 1 and reset["frames"] == "reset" and startup["mode"] == "warm",
          "MCP perf tools run against the device")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    with tempfile.TemporaryDirectory(prefix="tether-perf-") as tmp_name:
        tmp = Path(tmp_name)
        os.environ.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(tmp / "input.log"),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
        })
        parser_tests()
        device_tests(tmp)
        api_tests()
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
