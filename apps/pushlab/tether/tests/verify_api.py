"""Hermetic end-to-end tests for Tether. Exit 0 = pass, 1 = fail.

Uses tests/fake_adb.py instead of a real device, a free port and temp files.
  python apps/pushlab/tether/tests/verify_api.py
"""

from __future__ import annotations

import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # bypass corporate proxies
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent
SERVER_DIR = APP / "server"
sys.path.insert(0, str(SERVER_DIR))

import adb as adb_module  # noqa: E402

TOKEN = "test-token-123"
FAILURES: list[str] = []
PASSES = 0


def check(condition: bool, label: str) -> None:
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


class Client:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"

    def request(self, method, path, body=None, raw=None, token=TOKEN, host=None):
        headers = {}
        data = None
        if token is not None:
            headers["X-Tether-Token"] = token
        if host:
            headers["Host"] = host
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        if raw is not None:
            data = raw
            headers["Content-Type"] = "application/vnd.android.package-archive"
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with DIRECT.open(req, timeout=30) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as err:
            return err.code, dict(err.headers), err.read()

    def json(self, method, path, body=None, **kw):
        status, headers, payload = self.request(method, path, body=body, **kw)
        try:
            return status, json.loads(payload or b"{}")
        except json.JSONDecodeError:
            return status, {"raw": payload[:200]}


def read_log(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


# ---------------------------------------------------------------- unit tests
def unit_tests() -> None:
    print("unit")
    check(adb_module.escape_input_text("hi there") == "hi%sthere", "space escaping")
    check(adb_module.escape_input_text("a&b's") == "a\\&b\\'s", "shell metachar escaping")
    try:
        adb_module.escape_input_text("héllo")
        check(False, "non-ASCII text rejected")
    except adb_module.AdbError:
        check(True, "non-ASCII text rejected")

    width, height = 1080, 2400
    raw = struct.pack("<IIII", width, height, 1, 0) + b"\x10\x20\x30\xff" * (width * height)
    t0 = time.monotonic()
    png, dw, dh, iw, ih, factor = adb_module.downscale_raw_rgba(raw, 1024)
    elapsed = time.monotonic() - t0
    check((dw, dh, factor) == (1080, 2400, 3), "raw downscale factor")
    check(adb_module.png_size(png) == (iw, ih) == (360, 800), "downscaled PNG size 360x800")
    check(elapsed < 3.0, f"downscale fast enough ({elapsed:.2f}s)")

    xml = (HERE / "fake_adb.py").read_text(encoding="utf-8").split('LOGIN_UI = """')[1].split('"""')[0]
    elements = adb_module.parse_ui_xml(xml)
    check(len(elements) == 4, "UI XML parsed into 4 elements")
    button = adb_module.find_element(elements, text="sign")
    check(button is not None and button["center"] == [540, 1880], "find_element by partial text")
    by_id = adb_module.find_element(elements, resource_id="email")
    check(by_id is not None and by_id["desc"] == "Email", "find_element by short resource id")
    check(adb_module.find_element(elements, text="missing") is None, "find_element miss returns None")


# ---------------------------------------------------------------- HTTP tests
def http_tests(env: dict, log_path: Path, state_path: Path) -> None:
    print("http")
    port = free_port()
    server = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port),
         "--token", TOKEN, "--no-browser", "--max-fps", "20"],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    client = Client(port)
    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)

        status, _, page = client.request("GET", "/", token=None)
        check(status == 200 and b"Tether" in page, "index page served without token")
        status, _, _ = client.request("GET", "/../server/server.py", token=None)
        check(status == 404, "path traversal blocked")

        status, data = client.json("GET", "/api/devices", token=None)
        check(status == 401, "API rejects missing token")
        status, data = client.json("GET", "/api/devices", token="wrong")
        check(status == 401, "API rejects wrong token")
        status, data = client.json("GET", "/api/devices", host="evil.example:80")
        check(status == 421, "foreign Host header rejected (DNS rebinding)")

        status, data = client.json("GET", "/api/health")
        check(status == 200 and data["adb_version"].startswith("Android Debug Bridge"), "health reports adb")

        status, data = client.json("GET", "/api/devices")
        states = {d["serial"]: d["state"] for d in data.get("devices", [])}
        check(states == {"emulator-5554": "device", "R58N12ABCDE": "unauthorized"}, "devices listed with states")
        check(data["devices"][0]["label"] == "Pixel 7", "device label from model")

        status, headers, frame = client.request("GET", "/api/frame?serial=emulator-5554&after=0")
        check(status == 200 and frame[:4] == b"\x89PNG", "frame streamed as PNG")
        check(headers.get("X-Frame-Width") == "1080" and headers.get("X-Frame-Height") == "2400", "frame size headers")
        frame_id = int(headers.get("X-Frame-Id", "0"))
        status, headers, _ = client.request("GET", f"/api/frame?serial=emulator-5554&after={frame_id}")
        check(status == 200 and int(headers["X-Frame-Id"]) > frame_id, "long-poll returns next frame")

        status, data = client.json("GET", "/api/frame?serial=nope&after=0")
        check(status == 502 and "not found" in data.get("error", ""), "unknown device frame error")

        log_path.write_text("", encoding="utf-8")
        client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "tap", "x": 0.5, "y": 0.5})
        client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "swipe",
                                           "x": 0.5, "y": 0.8, "x2": 0.5, "y2": 0.2, "duration_ms": 250})
        client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "text", "text": "hi there"})
        client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "key", "key": "back"})
        client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "long_press", "x": 0, "y": 1})
        lines = read_log(log_path)
        check(lines == [
            "input tap 540 1200",
            "input swipe 540 1919 540 480 250",
            "input text hi%sthere",
            "input keyevent 4",
            "input swipe 0 2399 0 2399 700",
        ], "input mapped to device pixels")
        status, data = client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "tap", "x": 2, "y": 0})
        check(status == 400, "out-of-range coordinates rejected")
        status, data = client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "key", "key": "warp"})
        check(status == 502 and "unknown key" in data["error"], "unknown key rejected")

        status, data = client.json("GET", "/api/ui?serial=emulator-5554")
        check(status == 200 and data["size"] == [1080, 2400] and len(data["elements"]) == 4, "UI elements endpoint")

        log_path.write_text("", encoding="utf-8")
        status, data = client.json("POST", "/api/tap_element", {"serial": "emulator-5554", "text": "Sign in"})
        check(status == 200 and read_log(log_path) == ["input tap 540 1880"], "tap_element taps element centre")
        status, data = client.json("POST", "/api/tap_element", {"serial": "emulator-5554", "text": "Nope"})
        check(status == 404, "tap_element miss is 404")

        status, data = client.json("GET", "/api/packages?serial=emulator-5554")
        check(data.get("packages") == ["com.demo.app", "com.juw12.vitals"], "packages listed")
        check(data.get("foreground") == "com.demo.app/com.demo.app.MainActivity", "foreground activity")

        log_path.write_text("", encoding="utf-8")
        client.json("POST", "/api/launch", {"serial": "emulator-5554", "package": "com.demo.app"})
        client.json("POST", "/api/stop", {"serial": "emulator-5554", "package": "com.demo.app"})
        status, data = client.json("POST", "/api/launch", {"serial": "emulator-5554", "package": "x; rm -rf /"})
        check(status == 502 and "invalid package" in data["error"], "package name injection rejected")
        check(read_log(log_path) == ["launch com.demo.app", "stop com.demo.app"], "launch / stop reach device")

        status, data = client.json("POST", "/api/install?serial=emulator-5554", raw=b"PK\x03\x04fake-apk")
        check(status == 200 and "Success" in data.get("output", ""), "APK upload installs")
        status, data = client.json("POST", "/api/install?serial=emulator-5554", raw=b"not an apk")
        check(status == 400, "non-APK upload rejected")

        status, data = client.json("GET", "/api/logcat?serial=emulator-5554&lines=50")
        check("FATAL EXCEPTION" in data.get("log", ""), "logcat returned")
        status, data = client.json("GET", "/api/logcat?serial=emulator-5554&package=com.demo.app")
        check("only demo lines" in data.get("log", ""), "logcat filtered by package pid")

        status, headers, shot = client.request("GET", "/api/screenshot?serial=emulator-5554")
        check(status == 200 and "attachment" in headers.get("Content-Disposition", ""), "screenshot download")

        flow = {
            "name": "login smoke",
            "steps": [
                {"action": "launch", "package": "com.demo.app"},
                {"action": "assert_text", "text": "Welcome", "timeout_ms": 2000},
                {"action": "tap_element", "resource_id": "email"},
                {"action": "text", "text": "me@example.com"},
                {"action": "tap", "x": 0.5, "y": 0.25},
                {"action": "tap_element", "text": "Sign in"},
                {"action": "screenshot", "name": "after-login"},
            ],
        }
        log_path.write_text("", encoding="utf-8")
        status, data = client.json("POST", "/api/flow/run", {"serial": "emulator-5554", "flow": flow})
        report = data.get("report", {})
        check(status == 200 and report.get("passed") is True, "flow passes")
        check(len(report.get("screenshots", [])) == 1, "flow screenshot captured")
        check(read_log(log_path) == [
            "launch com.demo.app",
            "input tap 540 970",
            "input text me@example.com",
            "input tap 540 600",
            "input tap 540 1880",
        ], "flow steps reached device in order")

        failing = {"steps": [
            {"action": "assert_text", "text": "Not on screen", "timeout_ms": 300},
            {"action": "key", "key": "home"},
        ]}
        status, data = client.json("POST", "/api/flow/run", {"serial": "emulator-5554", "flow": failing})
        report = data.get("report", {})
        check(report.get("passed") is False, "failing assertion fails the flow")
        check(report["steps"][1].get("skipped") is True, "steps after failure skipped")

        status, data = client.json("POST", "/api/flow/run", {"serial": "emulator-5554",
                                                              "flow": {"steps": [{"action": "fly"}]}})
        check(status == 400 and "unknown action" in data["error"], "invalid flow rejected")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()


# ----------------------------------------------------------------- MCP tests
def mcp_tests(env: dict, log_path: Path) -> None:
    print("mcp")
    proc = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "mcp_server.py")],
        env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )

    def rpc(msg_id, method, params=None):
        message = {"jsonrpc": "2.0", "method": method}
        if msg_id is not None:
            message["id"] = msg_id
        if params is not None:
            message["params"] = params
        proc.stdin.write(json.dumps(message).encode() + b"\n")
        proc.stdin.flush()
        if msg_id is None:
            return None
        return json.loads(proc.stdout.readline())

    try:
        init = rpc(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                     "clientInfo": {"name": "test", "version": "1"}})
        check(init["result"]["serverInfo"]["name"] == "tether", "MCP initialize")
        check(init["result"]["protocolVersion"] == "2025-06-18", "MCP protocol negotiated")
        rpc(None, "notifications/initialized")
        tools = rpc(2, "tools/list")["result"]["tools"]
        names = {t["name"] for t in tools}
        check({"screenshot", "tap", "ui_elements", "tap_element", "run_flow"} <= names, "MCP tools listed")

        shot = rpc(3, "tools/call", {"name": "screenshot", "arguments": {}})["result"]
        image = next(c for c in shot["content"] if c["type"] == "image")
        check(image["mimeType"] == "image/png" and len(image["data"]) > 100, "MCP screenshot image")
        check("360x800" in shot["content"][1]["text"], "MCP screenshot downscaled to 360x800")

        log_path.write_text("", encoding="utf-8")
        rpc(4, "tools/call", {"name": "tap", "arguments": {"x": 180, "y": 400}})
        check(read_log(log_path) == ["input tap 540 1200"], "MCP tap scales screenshot coords to device")

        ui = rpc(5, "tools/call", {"name": "ui_elements", "arguments": {}})["result"]
        payload = json.loads(ui["content"][0]["text"])
        check(len(payload["elements"]) == 3, "MCP ui_elements filters layout noise")

        result = rpc(6, "tools/call", {"name": "tap_element", "arguments": {"text": "Missing"}})["result"]
        check(result["isError"] is True, "MCP tool errors are reported, not crashes")

        flow = {"steps": [{"action": "assert_text", "text": "Sign in"}]}
        result = rpc(7, "tools/call", {"name": "run_flow", "arguments": {"flow": flow}})["result"]
        check('"passed": true' in result["content"][0]["text"], "MCP run_flow")

        bad = rpc(8, "nope/method")
        check(bad["error"]["code"] == -32601, "MCP unknown method error")
    finally:
        proc.stdin.close()
        proc.terminate()
        proc.wait(timeout=5)


# ----------------------------------------------------------------- CLI tests
def cli_tests(env: dict, tmp: Path) -> None:
    print("cli")
    flow_path = tmp / "flow.json"
    flow_path.write_text(json.dumps({"name": "cli", "steps": [
        {"action": "wait_for", "text": "Sign in"},
        {"action": "screenshot", "name": "login screen"},
    ]}), encoding="utf-8")
    out_dir = tmp / "report"
    proc = subprocess.run(
        [sys.executable, str(SERVER_DIR / "flows.py"), "run", str(flow_path),
         "--serial", "emulator-5554", "--out", str(out_dir)],
        env=env, capture_output=True, text=True, timeout=60,
    )
    check(proc.returncode == 0 and "PASSED" in proc.stdout, "CLI flow passes (exit 0)")
    check((out_dir / "report.json").exists() and (out_dir / "002_login_screen.png").exists(),
          "CLI writes report and screenshots")

    flow_path.write_text(json.dumps({"steps": [{"action": "assert_text", "text": "x", "timeout_ms": 200}]}),
                         encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(SERVER_DIR / "flows.py"), "run", str(flow_path)],
        env=env, capture_output=True, text=True, timeout=60,
    )
    check(proc.returncode == 1 and "FAILED" in proc.stdout, "CLI flow failure exits 1 (auto-picks only ready device)")


# ------------------------------------------------------------ adb installer
def installer_tests(tmp: Path) -> None:
    print("one-click adb install")
    import io
    import threading
    import zipfile
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w") as archive:
        archive.writestr("platform-tools/adb.exe", b"fake adb binary")
        archive.writestr("platform-tools/adb", b"fake adb binary")
        archive.writestr("platform-tools/NOTICE.txt", b"Android SDK Platform-Tools")
    zip_bytes = payload.getvalue()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            body = zip_bytes if self.path.endswith(".zip") else b"<html>blocked by proxy</html>"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    tools = tmp / "tools"
    env = dict(os.environ)
    env.pop("TETHER_ADB", None)
    env.update({"TETHER_TOOLS_DIR": str(tools), "TETHER_PLATFORM_TOOLS_URL": base + "/platform-tools.zip",
                "NO_PROXY": "127.0.0.1", "no_proxy": "127.0.0.1"})

    port = free_port()
    process = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--token", TOKEN, "--no-browser"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    client = Client(port)
    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)
        status, health = client.json("GET", "/api/health")
        if health.get("adb"):
            print("  (skipped: a system adb exists on this machine, so the installer path cannot be exercised)")
            return
        check(health.get("adb") is None, "health reports adb missing")
        status, data = client.json("POST", "/api/setup/adb", {})
        exe = "adb.exe" if os.name == "nt" else "adb"
        check(status == 200 and data.get("installed") is True, "Install button downloads platform-tools")
        check((tools / "platform-tools" / exe).is_file(), "adb unpacked into Tether's own tools folder")
        status, health = client.json("GET", "/api/health")
        check(str(tools) in (health.get("adb") or ""), "Tether switches to the bundled adb without restart")

        bad_env = dict(env, TETHER_PLATFORM_TOOLS_URL=base + "/blocked", TETHER_TOOLS_DIR=str(tmp / "tools2"))
        bad = subprocess.run([sys.executable, str(SERVER_DIR / "adb_setup.py")], env=bad_env,
                             capture_output=True, text=True, timeout=60)
        check(bad.returncode == 1 and "not a zip" in bad.stderr, "proxy block page is detected, not installed")
    finally:
        process.terminate()
        process.wait(timeout=5)
        server.shutdown()


def wireless_tests(env: dict) -> None:
    print("Wi-Fi pairing")
    port = free_port()
    process = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--token", TOKEN, "--no-browser"],
        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
    )
    client = Client(port)
    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.1)
        status, data = client.json("POST", "/api/pair", {"host_port": "192.168.1.23:37155", "code": "123456"})
        check(status == 200 and "Successfully paired" in data.get("output", ""), "adb pair with the 6-digit code")
        status, data = client.json("POST", "/api/pair", {"host_port": "192.168.1.23:37155", "code": "000000"})
        check(status == 502 and "Wrong password" in data.get("error", ""), "wrong pairing code reported")
        status, data = client.json("POST", "/api/pair", {"host_port": "evil; rm -rf /", "code": "123456"})
        check(status == 502 and "IP:port" in data.get("error", ""), "pairing address validated")
        status, data = client.json("POST", "/api/connect", {"host_port": "192.168.1.23:41235"})
        check(status == 200 and "connected to" in data.get("output", ""), "adb connect over Wi-Fi")
    finally:
        process.terminate()
        process.wait(timeout=5)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="tether-test-") as tmp_name:
        tmp = Path(tmp_name)
        log_path = tmp / "input.log"
        state_path = tmp / "state.txt"
        env = dict(os.environ)
        env.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(log_path),
            "TETHER_FAKE_STATE": str(state_path),
            "TETHER_QUIET": "1",
        })
        os.environ.update(env)
        unit_tests()
        http_tests(env, log_path, state_path)
        mcp_tests(env, log_path)
        cli_tests(env, tmp)
        wireless_tests(env)
        installer_tests(tmp)

    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print(f"  - {failure}")
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
