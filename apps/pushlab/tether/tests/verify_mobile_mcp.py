"""Hermetic tests for Tether's mobile-mcp compatible MCP tools, screen recording and clipboard.

  python apps/pushlab/tether/tests/verify_mobile_mcp.py

Talks MCP over stdio to server/mcp_server.py and HTTP to server/server.py, both
driving tests/fake_adb.py (+ fake_scrcpy_device.py for the clipboard).
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

import adb as adb_module  # noqa: E402

DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
TOKEN = "mobile-test-token"
DEVICE = "emulator-5554"
FAILURES: list[str] = []
PASSES = 0
FLAGS = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def fake_log(log_path: Path) -> list[str]:
    return log_path.read_text(encoding="utf-8").splitlines() if log_path.exists() else []


class Mcp:
    def __init__(self, env: dict, *args: str):
        self.proc = subprocess.Popen([sys.executable, str(SERVER_DIR / "mcp_server.py"), *args],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     env=env, creationflags=FLAGS)
        self.next_id = 0

    def rpc(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        message = {"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}}
        self.proc.stdin.write(json.dumps(message).encode() + b"\n")
        self.proc.stdin.flush()
        return json.loads(self.proc.stdout.readline())

    def call(self, name: str, **arguments) -> tuple[bool, str, list]:
        reply = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if "error" in reply:
            return False, reply["error"]["message"], []
        result = reply["result"]
        text = "\n".join(part["text"] for part in result["content"] if part["type"] == "text")
        return not result["isError"], text, result["content"]

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def unit_tests() -> None:
    print("parsers")
    entries = adb_module.parse_threadtime(
        "11-01 08:00:00.100  4242  4242 D DemoApp : onCreate\n"
        "--------- beginning of main\n"
        "11-01 08:00:01.000  4242  4243 E AndroidRuntime: FATAL EXCEPTION: main\n"
    )
    check(len(entries) == 2 and entries[0]["tag"] == "DemoApp" and entries[1]["level"] == "Error"
          and entries[1]["tid"] == 4243, "threadtime lines parsed (tag, level, tid)")
    filters = adb_module.parse_log_filters(["level=E", "tag!=DemoApp"])
    check([e["tag"] for e in entries if adb_module.log_entry_matches(e, filters)] == ["AndroidRuntime"],
          "filters: level=E AND tag!=DemoApp")
    check(adb_module.log_entry_matches(entries[0], adb_module.parse_log_filters(["process=com.demo.app"]),
                                       {"com.demo.app": {4242}}), "process filter resolves through pids")
    try:
        adb_module.parse_log_filters(["colour=red"])
        check(False, "unknown filter key rejected")
    except adb_module.AdbError:
        check(True, "unknown filter key rejected")
    sys.path.insert(0, str(HERE))
    import fake_adb  # noqa: E402

    crashes = adb_module.parse_crashes(fake_adb.CRASH_LOG)
    check(len(crashes) == 3, f"crash buffer grouped into 3 reports (got {len(crashes)})")
    java = crashes[0] if crashes else {}
    check(java.get("process") == "com.demo.app" and "IllegalStateException" in java.get("summary", "")
          and java.get("type") == "java", "java crash: process + exception summary")
    native = [c for c in crashes if c.get("process") == "com.demo.native"]
    check(bool(native) and native[0]["type"] == "native" and "SIGSEGV" in native[0]["summary"],
          "native tombstone: process + signal")


def mcp_tests(env: dict, log_path: Path, tmp: Path) -> None:
    print("mcp: mobile-mcp compatible tools")
    mcp = Mcp(env)
    try:
        mcp.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}})
        names = {t["name"] for t in mcp.rpc("tools/list")["result"]["tools"]}
        expected = {"mobile_list_available_devices", "mobile_list_elements_on_screen",
                    "mobile_click_on_screen_at_coordinates", "mobile_batch_commands", "mobile_take_screenshot",
                    "mobile_start_screen_recording", "mobile_get_crash", "screenshot", "run_flow"}
        check(expected <= names, f"tools/list has Tether + mobile_* tools ({len(names)})")

        ok, text, _ = mcp.call("mobile_list_available_devices")
        devices = json.loads(text)["devices"] if ok else []
        check(len(devices) == 2 and devices[0]["id"] == DEVICE and devices[0]["type"] == "emulator"
              and devices[0]["version"] == "15" and devices[1]["state"] == "unauthorized",
              "list_available_devices: id/type/version/state")

        ok, text, _ = mcp.call("mobile_list_apps", device=DEVICE)
        check(ok and "com.demo.app" in text, "list_apps")
        ok, text, _ = mcp.call("mobile_get_foreground_app", device=DEVICE)
        check(ok and json.loads(text) == {"packageName": "com.demo.app", "activity": "com.demo.app.MainActivity"},
              "get_foreground_app: package + activity")
        ok, text, _ = mcp.call("mobile_get_screen_size", device=DEVICE)
        check(ok and "1080x2400" in text, "get_screen_size")

        ok, text, _ = mcp.call("mobile_list_elements_on_screen", device=DEVICE)
        check(ok and text.splitlines()[0].startswith("@e1 ") and "@e3 Button \"Sign in\" id=login" in text,
              "list_elements (text): @eN refs with type, text, id")
        ok, text, _ = mcp.call("mobile_list_elements_on_screen", device=DEVICE, format="json")
        rows = json.loads(text) if ok else []
        sign_in = [r for r in rows if r.get("text") == "Sign in"]
        check(bool(sign_in) and sign_in[0]["rect"] == {"x": 100, "y": 1800, "width": 880, "height": 160}
              and sign_in[0]["identifier"] == "com.demo.app:id/login", "list_elements (json): rect + identifier")

        before = len(fake_log(log_path))
        ok, text, _ = mcp.call("mobile_click_on_screen_at_coordinates", device=DEVICE, ref="@e3")
        check(ok and fake_log(log_path)[before:] == ["input tap 540 1880"], "click by ref taps the element centre")
        ok, text, _ = mcp.call("mobile_click_on_screen_at_coordinates", device=DEVICE, ref="@e99")
        check(not ok and "unknown ref" in text, "unknown ref is an error, not a stray tap")
        ok, text, _ = mcp.call("mobile_click_on_screen_at_coordinates", device=DEVICE, x=10)
        check(not ok and "ref or both x and y" in text, "x without y rejected")
        before = len(fake_log(log_path))
        mcp.call("mobile_click_on_screen_at_coordinates", device=DEVICE, x=200, y=300)
        mcp.call("mobile_double_tap_on_screen", device=DEVICE, x=50, y=60)
        mcp.call("mobile_long_press_on_screen_at_coordinates", device=DEVICE, ref="e1", duration=900)
        check(fake_log(log_path)[before:] == ["input tap 200 300", "input tap 50 60", "input tap 50 60",
                                              "input swipe 540 360 540 360 900"],
              "click xy, double tap (one shell line), long press by ref")

        before = len(fake_log(log_path))
        mcp.call("mobile_swipe_on_screen", device=DEVICE, direction="up")
        mcp.call("mobile_swipe_on_screen", device=DEVICE, direction="left", x=900, y=1000, distance=500)
        check(fake_log(log_path)[before:] == ["input swipe 540 1200 540 480 400", "input swipe 900 1000 400 1000 400"],
              "swipe: centre + 30% default, explicit start + distance")

        before = len(fake_log(log_path))
        mcp.call("mobile_type_keys", device=DEVICE, text="hi there", submit=True)
        mcp.call("mobile_press_button", device=DEVICE, button="BACKSPACE")
        mcp.call("mobile_press_button", device=DEVICE, button="APP_SWITCH")
        ok, text, _ = mcp.call("mobile_press_button", device=DEVICE, button="SELFDESTRUCT")
        check(fake_log(log_path)[before:] == ["input text hi%sthere", "input keyevent 66", "input keyevent 67",
                                              "input keyevent 187"] and not ok,
              "type_keys + submit, press_button mapping, unknown button rejected")

        before = len(fake_log(log_path))
        mcp.call("mobile_launch_app", device=DEVICE, packageName="com.demo.app", locale="fr-FR")
        mcp.call("mobile_terminate_app", device=DEVICE, packageName="com.demo.app")
        ok_clear, _t, _ = mcp.call("mobile_clear_app_data", device=DEVICE, packageName="com.demo.app")
        ok_un, _t, _ = mcp.call("mobile_uninstall_app", device=DEVICE, packageName="com.demo.app")
        ok_bad, _t, _ = mcp.call("mobile_uninstall_app", device=DEVICE, packageName="com.not.installed")
        check(fake_log(log_path)[before:] == ["locale com.demo.app fr-FR", "launch com.demo.app", "stop com.demo.app",
                                              "clear com.demo.app", "uninstall com.demo.app"]
              and ok_clear and ok_un and not ok_bad,
              "launch with locale, terminate, clear data, uninstall (+ failure surfaces)")
        apk = tmp / "demo.apk"
        apk.write_bytes(b"PK fake apk")
        ok, text, _ = mcp.call("mobile_install_app", device=DEVICE, path=str(apk))
        ok_missing, _t, _ = mcp.call("mobile_install_app", device=DEVICE, path=str(tmp / "missing.apk"))
        check(ok and "install demo.apk" in fake_log(log_path) and not ok_missing, "install_app (+ missing file)")

        before = len(fake_log(log_path))
        ok, text, _ = mcp.call("mobile_open_url", device=DEVICE, url="https://example.com/x")
        ok_bad, _t, _ = mcp.call("mobile_open_url", device=DEVICE, url="intent://evil")
        check(ok and fake_log(log_path)[before:] == ["open https://example.com/x"] and not ok_bad,
              "open_url: https only")

        ok, text, _ = mcp.call("mobile_get_orientation", device=DEVICE)
        check(ok and text.endswith("portrait"), "get_orientation: portrait")
        mcp.call("mobile_set_orientation", device=DEVICE, orientation="landscape")
        ok, text, _ = mcp.call("mobile_get_orientation", device=DEVICE)
        _ok, size_text, _ = mcp.call("mobile_get_screen_size", device=DEVICE)
        check(text.endswith("landscape") and "2400x1080" in size_text
              and "settings accelerometer_rotation=0" in fake_log(log_path),
              "set_orientation landscape (auto-rotate off) -> size swaps")
        mcp.call("mobile_set_orientation", device=DEVICE, orientation="portrait")

        ok, text, _ = mcp.call("mobile_set_location", device=DEVICE, latitude=52.37, longitude=4.89)
        check(ok and "geo fix 4.890000 52.370000" in fake_log(log_path), "set_location: emu geo fix lon lat")
        ok, text, _ = mcp.call("mobile_set_location", device=DEVICE, latitude=91, longitude=0)
        check(not ok, "set_location: out-of-range latitude rejected")

        ok, text, content = mcp.call("mobile_take_screenshot", device=DEVICE)
        images = [c for c in content if c["type"] == "image"]
        check(ok and images and "screen is 1080x2400" in text and "Multiply" in text,
              "take_screenshot: image + coordinate mapping")
        shot = tmp / "shots" / "s.png"
        ok, text, _ = mcp.call("mobile_save_screenshot", device=DEVICE, saveTo=str(shot), maxSize=600)
        check(ok and shot.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n" and adb_module.png_size(shot.read_bytes())[1] <= 600,
              "save_screenshot: PNG on disk, maxSize respected")
        ok, text, _ = mcp.call("mobile_save_screenshot", device=DEVICE, saveTo=str(tmp / "s.jpg"))
        check(not ok and "png" in text, "save_screenshot: jpg refused like mobile-mcp")

        ok, text, _ = mcp.call("mobile_get_device_logs", device=DEVICE, limit=10, filter=["level=Error"])
        lines = [json.loads(line) for line in text.splitlines()] if ok else []
        check(len(lines) == 1 and lines[0]["tag"] == "AndroidRuntime", "device logs: JSON lines + level filter")
        ok, text, _ = mcp.call("mobile_get_device_logs", device=DEVICE, filter=["process=com.demo.app"], limit=2)
        lines = [json.loads(line) for line in text.splitlines()] if ok else []
        check(len(lines) == 2 and all(e["pid"] == 4242 for e in lines), "device logs: process filter + limit")
        saved = tmp / "logs.jsonl"
        ok, text, _ = mcp.call("mobile_get_device_logs", device=DEVICE, saveTo=str(saved))
        check(ok and "Saved 5" in text and len(saved.read_text().splitlines()) == 5, "device logs: saveTo")

        ok, text, _ = mcp.call("mobile_list_crashes", device=DEVICE)
        crashes = json.loads(text) if ok else []
        check(len(crashes) == 3 and crashes[0]["process"] == "com.demo.app", "list_crashes")
        ok, text, _ = mcp.call("mobile_get_crash", device=DEVICE, id=crashes[0]["id"] if crashes else "x")
        check(ok and "LoginActivity.kt:42" in text, "get_crash: full stack")

        ok, text, _ = mcp.call("mobile_batch_commands", device=DEVICE, steps=[
            {"name": "mobile_click_on_screen_at_coordinates", "arguments": {"x": 1, "y": 2}},
            {"name": "mobile_type_keys", "arguments": {"text": "abc"}},
            {"name": "mobile_take_screenshot", "arguments": {}},
            {"name": "mobile_press_button", "arguments": {"button": "HOME"}},
        ], listElementsAtEnd=True)
        check(ok and "Step 1 (mobile_click_on_screen_at_coordinates): Clicked" in text
              and "Step 3 (mobile_take_screenshot) failed" in text and "Step 4" not in text and "@e1" in text,
              "batch: runs in order, stops on error, lists elements at end")
        ok, text, _ = mcp.call("mobile_batch_commands", device=DEVICE, stopOnError=False, steps=[
            {"name": "mobile_nope"}, {"name": "mobile_press_button", "arguments": {"button": "HOME"}}])
        check("Step 1 (mobile_nope) failed" in text and "Step 2 (mobile_press_button): Pressed" in text,
              "batch: stopOnError=false continues")

        video = tmp / "rec" / "demo.mp4"
        ok, text, _ = mcp.call("mobile_start_screen_recording", device=DEVICE, output=str(video), timeLimit=30)
        ok_twice, _t, _ = mcp.call("mobile_start_screen_recording", device=DEVICE, output=str(video))
        time.sleep(0.6)
        ok_stop, stop_text, _ = mcp.call("mobile_stop_screen_recording", device=DEVICE)
        check(ok and not ok_twice and ok_stop and video.is_file() and video.read_bytes()[4:8] == b"ftyp"
              and "size:" in stop_text, "screen recording: start, refuses double start, stop pulls an MP4")
        recorded = [line for line in fake_log(log_path) if line.startswith("screenrecord --")]
        check(recorded and "--time-limit 30" in recorded[-1] and "screenrecord stop" in fake_log(log_path)
              and any(line.startswith("rm /sdcard/tether-rec-") for line in fake_log(log_path)),
              "screen recording: time limit passed, SIGINT stop, device file removed")
        ok, text, _ = mcp.call("mobile_stop_screen_recording", device=DEVICE)
        check(not ok and "no active recording" in text, "stop without recording is an error")

        ok, text, _ = mcp.call("mobile_clipboard", device=DEVICE, text="copied from agent")
        check(ok and text == "Clipboard updated" and "scrcpy-clipboard-set copied from agent" in fake_log(log_path),
              "clipboard set via scrcpy SET_CLIPBOARD (acked)")
        ok, text, _ = mcp.call("mobile_clipboard", device=DEVICE)
        check(ok and text == "copied from agent", "clipboard get via scrcpy GET_CLIPBOARD")

        ok, text, _ = mcp.call("mobile_launch_app", device=DEVICE)
        check(not ok and "missing argument" in text, "missing argument -> tool error, not 'unknown tool'")
        ok, text, _ = mcp.call("tap", device=DEVICE, x=10, y=10, space="device")
        check(ok, "Tether tools accept mobile-mcp's device= as well as serial=")
    finally:
        mcp.close()

    mcp = Mcp(env, "--tools", "mobile")
    try:
        names = {t["name"] for t in mcp.rpc("tools/list")["result"]["tools"]}
        reply = mcp.rpc("tools/call", {"name": "screenshot", "arguments": {}})
        check(all(n.startswith("mobile_") for n in names) and "error" in reply,
              "--tools mobile exposes (and allows) only mobile_* tools")
    finally:
        mcp.close()


def http_tests(env: dict, log_path: Path, tmp: Path) -> None:
    print("http: record + clipboard")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server_env = dict(env, TETHER_RECORDINGS_DIR=str(tmp / "recordings"))
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--token", TOKEN,
                               "--no-browser"], env=server_env, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, creationflags=FLAGS)

    def call(method, path, body=None, raw=False):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method,
                                         headers={"X-Tether-Token": TOKEN, "Content-Type": "application/json"})
        try:
            with DIRECT.open(request, timeout=30) as response:
                payload = response.read()
                return response.status, (payload if raw else json.loads(payload or b"{}")), response.headers
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}"), exc.headers

    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)
        status, data, _ = call("POST", "/api/record/start", {"serial": DEVICE, "time_limit": 999})
        check(status == 200 and data["time_limit"] == 180 and data["name"].endswith(".mp4"),
              "POST /api/record/start (limit capped at 180 s)")
        status, data, _ = call("GET", f"/api/record/status?serial={DEVICE}")
        check(status == 200 and data["recording"], "GET /api/record/status")
        time.sleep(0.5)
        status, data, _ = call("POST", "/api/record/stop", {"serial": DEVICE})
        check(status == 200 and data["size"] > 0 and data["url"].startswith("/api/record/file?name="),
              "POST /api/record/stop returns a download URL")
        status, body, headers = call("GET", data.get("url", "/api/record/file?name=x.mp4"), raw=True)
        check(status == 200 and body[4:8] == b"ftyp" and headers.get("Content-Type") == "video/mp4"
              and "attachment" in headers.get("Content-Disposition", ""), "GET /api/record/file serves the MP4")
        status, _body, _ = call("GET", "/api/record/file?name=..%5Csecret.mp4")
        check(status == 400, "recording download rejects path tricks")
        status, data, _ = call("POST", "/api/record/stop", {"serial": DEVICE})
        check(status == 502, "stop without a recording -> 502")
        status, data, _ = call("POST", "/api/clipboard", {"serial": DEVICE, "text": "from the web"})
        status2, data2, _ = call("GET", f"/api/clipboard?serial={DEVICE}")
        check(status == 200 and status2 == 200 and data2["text"] == "from the web", "POST/GET /api/clipboard")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


def main() -> int:
    unit_tests()
    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        log_path = tmp / "fake.log"
        jar = tmp / "scrcpy-server.jar"
        jar.write_bytes(b"fake jar")
        env = dict(os.environ)
        env.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(log_path),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "TETHER_SCRCPY_SERVER": str(jar),
            "TETHER_QUIET": "1",
        })
        env.pop("BEACON_URL", None)
        mcp_tests(env, log_path, tmp)
        http_tests(env, log_path, tmp)
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  - " + failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
