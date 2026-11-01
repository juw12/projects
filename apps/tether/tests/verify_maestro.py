"""Hermetic tests for Maestro YAML import/export (maestro.py) and the new flow steps.

  python apps/tether/tests/verify_maestro.py
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

import flows  # noqa: E402
import maestro  # noqa: E402

DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
TOKEN = "maestro-test-token"
FAILURES: list[str] = []
PASSES = 0

SAMPLE = '''# Login smoke test written for Maestro
appId: com.example.vitals
name: Login smoke
tags:
  - smoke
---
- launchApp:
    clearState: true
- tapOn: "Sign in"            # by text
- tapOn:
    id: "com.example.vitals:id/email"
- inputText: "qa+{run}@example.com # not a comment"
- tapOn: { id: "password", index: 0 }
- inputText: 'it''s secret'
- hideKeyboard
- pressKey: Enter
- extendedWaitUntil:
    visible: "Welcome.*"
    timeout: 15000
- assertNotVisible: "Error"
- swipe:
    direction: UP
- swipe:
    start: "90%, 50%"
    end: "10%, 50%"
    duration: 500
- scrollUntilVisible:
    element:
      text: "Settings"
    direction: DOWN
- tapOn:
    point: "50%,92%"
- tapOn:
    text: "Maybe later"
    optional: true
- longPressOn: "Report"
- eraseText: 5
- takeScreenshot: home
- openLink: https://example.com/deep?x=1
- waitForAnimationToEnd
- back
- runFlow: other.yaml
- tapOn:
    point: "100,200"
- stopApp
'''

DEVICE_FLOW = '''appId: com.demo.app
---
- launchApp:
    stopApp: false
- assertVisible: "Welcome to Demo"
- tapOn:
    id: "com.demo.app:id/email"
- inputText: "qa@example.com"
- eraseText: 3
- scrollUntilVisible:
    element: "Sign in"
- longPressOn: "Sign in"
- tapOn:
    text: "Not on this screen"
    optional: true
- tapOn: "Sign in"
- takeScreenshot: after-login
- openLink: "https://example.com/promo"
'''


def check(condition: bool, label: str) -> None:
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def raises(func, *args) -> str:
    try:
        func(*args)
    except (maestro.MaestroError, flows.FlowError) as exc:
        return str(exc) or "error"
    return ""


def yaml_tests() -> None:
    print("yaml subset")
    docs = maestro.load_documents("a: 1\nb: [x, 'y z', \"q#r\"]\nc: {k: v, n: 2}\nd:\n  - e\n  - f: g\n    h: true\n")
    check(docs == [{"a": 1, "b": ["x", "y z", "q#r"], "c": {"k": "v", "n": 2}, "d": ["e", {"f": "g", "h": True}]}],
          "maps, flow lists/maps, nested list items")
    check(maestro.load_documents("x: \"a # b\"  # real comment\n") == [{"x": "a # b"}], "# inside quotes kept")
    check(maestro.load_documents("x: |\n  line one\n  line two\ny: 1\n") == [{"x": "line one\nline two", "y": 1}],
          "literal block scalar")
    check(maestro.load_documents("appId: a\n---\n- back\n") == [{"appId": "a"}, ["back"]], "two documents")
    check(maestro.load_documents("k:\n- a\n- b\n") == [{"k": ["a", "b"]}], "list at the key's indent")
    check(maestro.parse_scalar("'it''s'") == "it's" and maestro.parse_scalar("\"\\u00e9\"") == "é", "quoted scalars")
    check(maestro.parse_scalar("3.5") == 3.5 and maestro.parse_scalar("null") is None, "numbers and null")
    check(bool(raises(maestro.load_documents, "a:\n\tb: 1\n")), "tabs rejected")
    check(bool(raises(maestro.load_documents, "a: 1\n    b: 2\n")), "bad indentation rejected")
    check(bool(raises(maestro.load_documents, "x: \"open\n")), "unterminated string rejected")


def conversion_tests() -> None:
    print("maestro -> tether")
    flow, warnings = maestro.maestro_to_flow(SAMPLE)
    steps = flow["steps"]
    actions = [s["action"] for s in steps]
    check(flow["name"] == "Login smoke" and flow["app_id"] == "com.example.vitals" and flow["tags"] == ["smoke"],
          "header: name, appId, tags")
    check(actions[:2] == ["clear_data", "launch"], "launchApp clearState → clear_data + launch")
    check(steps[2] == {"action": "tap_element", "text": "Sign in"}, "tapOn text")
    check(steps[3] == {"action": "tap_element", "resource_id": "com.example.vitals:id/email"}, "tapOn id")
    check(steps[4]["text"] == "qa+{run}@example.com # not a comment", "quoted # is not a comment; {run} kept")
    check(steps[6]["text"] == "it's secret", "single-quoted escape")
    check(steps[7] == {"action": "key", "key": "escape"} and steps[8] == {"action": "key", "key": "enter"},
          "hideKeyboard / pressKey Enter")
    check(steps[9] == {"action": "wait_for", "text": "Welcome", "timeout_ms": 15000}, "extendedWaitUntil + regex .* stripped")
    check(steps[11]["y"] == 0.8 and steps[11]["y2"] == 0.2, "swipe UP preset")
    check((steps[12]["x"], steps[12]["x2"], steps[12]["duration_ms"]) == (0.9, 0.1, 500), "swipe start/end percentages")
    check(steps[13] == {"action": "scroll_until_visible", "text": "Settings", "direction": "down", "timeout_ms": 20000},
          "scrollUntilVisible")
    check(steps[14] == {"action": "tap", "x": 0.5, "y": 0.92}, "tapOn point %")
    check(steps[15].get("optional") is True, "optional preserved")
    check(steps[16] == {"action": "long_press", "text": "Report"}, "longPressOn → element long_press")
    check(steps[17] == {"action": "key", "key": "delete", "times": 5}, "eraseText → delete ×5")
    check(steps[19] == {"action": "open_url", "url": "https://example.com/deep?x=1"}, "openLink")
    check(actions[-1] == "stop" and steps[-1]["package"] == "com.example.vitals", "stopApp uses header appId")
    check(any("runFlow" in w for w in warnings), "runFlow reported as unsupported")
    check(any("absolute point" in w for w in warnings), "absolute point reported, not guessed")
    check(any("index" in w for w in warnings), "unsupported selector option reported")
    check(not raises(flows.validate_flow, flow), "imported flow passes Tether validation")

    print("tether -> maestro")
    original = json.loads(json.dumps(flow))
    text, export_warnings = maestro.flow_to_maestro(flow)
    check(flow == original, "export does not mutate the flow")
    check(text.startswith("appId: com.example.vitals\n") and "\n---\n" in text, "header + document separator")
    again, re_warnings = maestro.maestro_to_flow(text)
    check(again["steps"] == flow["steps"] and not re_warnings, "round trip is lossless")
    check(any("waitForAnimationToEnd" in w for w in export_warnings), "fixed wait export is flagged")

    tether_only = {"name": "Push QA", "steps": [
        {"action": "launch", "package": "com.demo.app"},
        {"action": "push", "title": "Hi {run}"},
        {"action": "wait_notification", "title": "Hi {run}"},
        {"action": "assert_text", "text": "Done", "optional": True},
        {"action": "key", "key": "back", "times": 2},
    ]}
    text, warnings = maestro.flow_to_maestro(tether_only)
    check("stopApp: false" in text, "plain launch exported with stopApp: false")
    check('# tether: {"action": "push"' in text and len([w for w in warnings if "Tether-only" in w]) == 2,
          "push steps kept as comments + warned")
    check('text: "Done"' in text and "optional: true" in text, "optional scalar selector expanded")
    check(text.count("- back") == 2, "key times → repeated command")
    back, _ = maestro.maestro_to_flow(text)
    check([s["action"] for s in back["steps"]] == ["launch", "assert_text", "key", "key"],
          "comments ignored on re-import")
    check(bool(raises(maestro.maestro_to_flow, "appId: x\n---\nfoo: bar\n")), "non-list commands rejected")
    check(bool(raises(maestro.maestro_to_flow, "- launchApp\n")), "launchApp without appId rejected")

    print("flow validation for new steps")
    check(bool(raises(flows.validate_flow, {"steps": [{"action": "open_url", "url": "javascript:alert(1)"}]})),
          "javascript: URL rejected")
    check(not raises(flows.validate_flow, {"steps": [{"action": "open_url", "url": "myapp://deep/link"}]}),
          "custom-scheme deep link allowed")
    check(bool(raises(flows.validate_flow, {"steps": [{"action": "key", "key": "back", "times": 999}]})),
          "key times capped")
    check(bool(raises(flows.validate_flow, {"steps": [{"action": "scroll_until_visible", "text": "x",
                                                        "direction": "sideways"}]})), "bad scroll direction rejected")
    check(bool(raises(flows.validate_flow, {"steps": [{"action": "long_press"}]})), "long_press needs point or element")


def read_log(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def cli_tests(env: dict, tmp: Path) -> None:
    print("cli (fake device)")
    log_path = Path(env["TETHER_FAKE_LOG"])
    flow_file = tmp / "demo.yaml"
    flow_file.write_text(DEVICE_FLOW, encoding="utf-8")
    out_dir = tmp / "report"
    result = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "run", str(flow_file), "--out", str(out_dir)],
                            env=env, capture_output=True, text=True, timeout=120)
    check(result.returncode == 0, f"Maestro YAML runs and passes (exit {result.returncode})")
    if result.returncode != 0:
        print(result.stdout[-1500:], result.stderr[-1500:])
    check("[WARN]" in result.stdout, "optional failure shown as WARN")
    report = json.loads((out_dir / "report.json").read_text(encoding="utf-8")) if (out_dir / "report.json").exists() else {}
    check(report.get("passed") is True and any(s.get("optional_failed") for s in report.get("steps", [])),
          "report: passed with an optional failure recorded")
    check(any(p.name.endswith("after-login.png") for p in out_dir.glob("*.png")), "takeScreenshot saved")
    log = "\n".join(read_log(log_path))
    check(log.count("input keyevent 67") == 3, "eraseText 3 → three DEL key events")
    check("input text qa@example.com" in log, "inputText reached the device")
    check("open https://example.com/promo" in log, "openLink → am start VIEW reached the device")
    check("input swipe" in log, "element long-press sent as a stationary swipe")

    failing = tmp / "fail.yaml"
    failing.write_text("appId: com.demo.app\n---\n- assertVisible: \"Nope\"\n- back\n", encoding="utf-8")
    result = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "run", str(failing)], env=env,
                            capture_output=True, text=True, timeout=120)
    check(result.returncode == 1 and "skipped" in result.stdout, "failing YAML flow exits 1 and skips the rest")

    converted = tmp / "demo.json"
    result = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "convert", str(flow_file), str(converted)],
                            env=env, capture_output=True, text=True, timeout=60)
    check(result.returncode == 0 and json.loads(converted.read_text(encoding="utf-8"))["steps"][0]["action"] == "launch",
          "convert yaml → json")
    back = tmp / "back.yaml"
    result = subprocess.run([sys.executable, str(SERVER_DIR / "flows.py"), "convert", str(converted), str(back)],
                            env=env, capture_output=True, text=True, timeout=60)
    check(result.returncode == 0 and back.read_text(encoding="utf-8").startswith("appId: com.demo.app"),
          "convert json → yaml")


def http_tests(env: dict) -> None:
    print("http")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--token", TOKEN,
                               "--no-browser"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def post(path, body):
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(),
                                         headers={"X-Tether-Token": TOKEN, "Content-Type": "application/json"},
                                         method="POST")
        try:
            with DIRECT.open(request, timeout=20) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)
        status, data = post("/api/flow/maestro/import", {"yaml": SAMPLE})
        check(status == 200 and len(data["flow"]["steps"]) == 23 and data["warnings"], "POST import → flow + warnings")
        status, exported = post("/api/flow/maestro/export", {"flow": data["flow"]})
        check(status == 200 and exported["yaml"].startswith("appId:"), "POST export → yaml")
        status, data = post("/api/flow/maestro/import", {"yaml": "a:\n\tb: 1"})
        check(status == 400 and "tabs" in data.get("error", ""), "bad YAML → 400 with reason")
        status, data = post("/api/flow/maestro/export", {"flow": {"steps": [{"action": "nope"}]}})
        check(status == 400, "invalid flow → 400")
    finally:
        server.terminate()
        server.wait(timeout=5)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    yaml_tests()
    conversion_tests()
    with tempfile.TemporaryDirectory(prefix="tether-maestro-") as tmp_name:
        tmp = Path(tmp_name)
        env = dict(os.environ)
        env.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(tmp / "input.log"),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "TETHER_QUIET": "1",
            "PYTHONIOENCODING": "utf-8",
        })
        cli_tests(env, tmp)
        http_tests(env)
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print(f"  - {failure}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
