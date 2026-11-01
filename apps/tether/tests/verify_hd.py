"""Hermetic tests for Tether HD (scrcpy streaming + control).

  python apps/tether/tests/verify_hd.py            # protocol, session, HTTP
  python apps/tether/tests/verify_hd.py --browser  # + real WebCodecs decode and clicks in headless Edge

Uses fake_adb.py + fake_scrcpy_device.py, which stream a real H.264 clip
(tests/fixtures/demo-360x780.h264pkt) using the scrcpy v5 wire protocol.
"""

from __future__ import annotations

import base64
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
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

import scrcpy  # noqa: E402
from adb import Adb  # noqa: E402

DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
TOKEN = "hd-test-token"
FAILURES: list[str] = []
PASSES = 0
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def control_bytes(log_path: Path) -> bytes:
    if not log_path.exists():
        return b""
    return b"".join(bytes.fromhex(line.split(" ", 1)[1]) for line in log_path.read_text(encoding="utf-8").splitlines()
                    if line.startswith("scrcpy-control "))


def parse_relay(data: bytes) -> list[tuple[int, int, bytes]]:
    messages, offset = [], 0
    while len(data) - offset >= 13:
        kind, pts, size = struct.unpack(">BQI", data[offset:offset + 13])
        if len(data) - offset - 13 < size:
            break
        messages.append((kind, pts, data[offset + 13:offset + 13 + size]))
        offset += 13 + size
    return messages


def unit_tests() -> None:
    print("protocol")
    check(scrcpy.touch_message(0, 0x1234567887654321, 100, 200, 1080, 1920, 1.0, 1, 1)
          == bytes.fromhex("0200123456788765432100000064000000c804380780ffff0000000100000001"),
          "touch event == scrcpy's official test vector")
    check(scrcpy.keycode_message(1, 66, 5, 0x41) == bytes.fromhex("0001000000420000000500000041"),
          "keycode event == official test vector")
    check(scrcpy.text_message("hello, world!") == bytes.fromhex("010000000d") + b"hello, world!",
          "text event == official test vector")
    check(len(scrcpy.text_message("x" * 1000)) == 5 + 300, "text capped at 300 bytes like scrcpy")
    check(scrcpy.touch_message(1, scrcpy.POINTER_FINGER, 0, 0, 1, 1, 0.0)[2:10] == b"\xff" * 7 + b"\xfe",
          "generic finger pointer id (-2)")
    check(scrcpy.back_or_screen_on_message(0) == b"\x04\x00" and scrcpy.COLLAPSE_PANELS == b"\x07",
          "back/collapse messages")

    viewer = scrcpy.Viewer()
    for _ in range(240):
        viewer.push(b"d", scrcpy.KIND_DELTA, [])
    viewer.push(b"overflow", scrcpy.KIND_DELTA, [])
    check(viewer.waiting_for_key and viewer.queue.empty(), "slow viewer is flushed instead of blocking")
    viewer.push(b"late delta", scrcpy.KIND_DELTA, [b"S", b"C", b"K"])
    check(viewer.queue.empty(), "...and skips deltas until a key frame")
    viewer.push(b"K", scrcpy.KIND_KEY, [b"S", b"C", b"K"])
    check([viewer.queue.get_nowait() for _ in range(3)] == [b"S", b"C", b"K"], "...then resyncs with session+config+key")
    viewer.close()
    check(viewer.queue.get_nowait() is None, "close() signals end of stream")


def session_tests(env: dict, log_path: Path) -> None:
    print("session (fake device)")
    os.environ.update(env)
    adb = Adb([sys.executable, str(HERE / "fake_adb.py")])
    session = scrcpy.ScrcpySession(adb, "emulator-5554", max_size=1024, max_fps=30)
    status = session.start(timeout=20)
    try:
        check(status["running"] and status["device_name"] == "Fake Pixel 7", "connects (dummy byte, device meta)")
        log = log_path.read_text(encoding="utf-8")
        check("push scrcpy-server-v5.0.1 /data/local/tmp/tether-scrcpy-server.jar" in log
              or "push " in log and scrcpy.DEVICE_PATH in log, "server jar pushed")
        check(f"localabstract:scrcpy_{session.scid:08x}" in log, "adb forward to scrcpy_<scid>")
        server_line = next((l for l in log.splitlines() if l.startswith("scrcpy-server ")), "")
        check(server_line.startswith("scrcpy-server 5.0.1 ") and "tunnel_forward=true" in server_line
              and "audio=false" in server_line and "max_size=1024" in server_line
              and f"scid={session.scid:08x}" in server_line, "server started with version + options")
        viewer = session.subscribe()
        deadline = time.time() + 10
        kinds = []
        while time.time() < deadline and len(kinds) < 40:
            try:
                message = viewer.queue.get(timeout=2)
            except scrcpy.queue.Empty:
                continue
            kinds.append(message[0])
        check(session.size == (360, 780), "session packet → video size 360x780")
        check(kinds[:3] == [scrcpy.KIND_SESSION, scrcpy.KIND_CONFIG, scrcpy.KIND_KEY], "viewer gets session, config, key")
        check(kinds.count(scrcpy.KIND_DELTA) >= 30, f"live deltas stream ({kinds.count(scrcpy.KIND_DELTA)})")
        late = session.subscribe()
        first = [late.queue.get(timeout=2)[0] for _ in range(3)]
        check(first == [scrcpy.KIND_SESSION, scrcpy.KIND_CONFIG, scrcpy.KIND_KEY], "late viewer starts from the cached GOP")
        session.unsubscribe(late)

        session.tap(0.5, 0.5)
        session.key("back")
        session.text("hi")
        time.sleep(0.5)
        sent = control_bytes(log_path)
        down = scrcpy.touch_message(scrcpy.ACTION_DOWN, scrcpy.POINTER_FINGER, 180, 390, 360, 780, 1.0)
        up = scrcpy.touch_message(scrcpy.ACTION_UP, scrcpy.POINTER_FINGER, 180, 390, 360, 780, 0.0)
        check(down in sent and up in sent, "tap → DOWN/UP at (180, 390) in video coordinates")
        check(scrcpy.keycode_message(0, 4) + scrcpy.keycode_message(1, 4) in sent, "back key → keycode 4 down/up")
        check(scrcpy.text_message("hi") in sent, "text injected")
        count_before = len(sent)
        session.swipe(0.2, 0.8, 0.2, 0.2, 160)
        time.sleep(0.4)
        swipe = control_bytes(log_path)[count_before:]
        check(len(swipe) % 32 == 0 and len(swipe) // 32 >= 5 and swipe[1] == 0 and swipe[-31] == 1,
              f"swipe → DOWN, {len(swipe) // 32 - 2} MOVEs, UP")
    finally:
        session.stop()
    time.sleep(0.5)
    check("forward --remove tcp:" in log_path.read_text(encoding="utf-8"), "stop removes the adb forward")
    check(not session.running, "session stopped")

    os.environ["FAKE_SCRCPY_MODE"] = "nocapture"
    try:
        broken = scrcpy.ScrcpySession(adb, "emulator-5554")
        broken.start(timeout=20)
        check(False, "capture failure reported")
    except scrcpy.ScrcpyError as exc:
        check("could not start screen capture" in str(exc), "capture failure reported")
    finally:
        os.environ.pop("FAKE_SCRCPY_MODE", None)


class Client:
    def __init__(self, port: int):
        self.base = f"http://127.0.0.1:{port}"

    def json(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method,
                                         headers={"X-Tether-Token": TOKEN, "Content-Type": "application/json"})
        try:
            with DIRECT.open(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")


def start_server(env: dict) -> tuple[subprocess.Popen, int]:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--token", TOKEN,
                               "--no-browser"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=flags)
    for _ in range(100):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    return server, port


def http_tests(env: dict, log_path: Path) -> None:
    print("http")
    server, port = start_server(env)
    client = Client(port)
    try:
        status, data = client.json("GET", "/api/hd/status?serial=emulator-5554")
        check(status == 200 and data["hd"]["installed"] and not data["hd"]["running"], "status: installed, not running")
        status, data = client.json("POST", "/api/hd/start", {"serial": "emulator-5554", "max_size": 1280})
        check(status == 200 and data["hd"]["running"] and data["hd"]["width"] in (0, 360), "POST /api/hd/start")
        request = urllib.request.Request(f"http://127.0.0.1:{port}/api/hd/stream?serial=emulator-5554",
                                         headers={"X-Tether-Token": TOKEN})
        with DIRECT.open(request, timeout=20) as response:
            check(response.headers.get("Content-Type") == "application/octet-stream", "stream content type")
            data = b""
            deadline = time.time() + 8
            while time.time() < deadline and len(parse_relay(data)) < 25:
                data += response.read1(65536)
        messages = parse_relay(data)
        check(messages and messages[0][0] == 1 and struct.unpack(">II", messages[0][2]) == (360, 780),
              "stream starts with the session (360x780)")
        check(messages[1][0] == 2 and messages[1][2][:5] == b"\x00\x00\x00\x01\x67", "then the SPS/PPS config")
        check(messages[2][0] == 3 and sum(1 for m in messages if m[0] == 4) >= 15, "then key + delta frames")
        before = len(control_bytes(log_path))
        status, data = client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "tap", "x": 0.25, "y": 0.75})
        time.sleep(0.3)
        sent = control_bytes(log_path)[before:]
        expected = scrcpy.touch_message(0, scrcpy.POINTER_FINGER, round(0.25 * 359), round(0.75 * 779), 360, 780, 1.0)
        check(status == 200 and data.get("via") == "scrcpy" and expected in sent, "/api/input tap goes through scrcpy")
        status, data = client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "scroll",
                                                          "x": 0.5, "y": 0.5, "dy": -1})
        check(status == 200 and data.get("via") == "scrcpy", "scroll via scrcpy")
        status, _ = client.json("POST", "/api/hd/stop", {"serial": "emulator-5554"})
        check(status == 200, "POST /api/hd/stop")
        status, data = client.json("POST", "/api/input", {"serial": "emulator-5554", "action": "tap", "x": 0.5, "y": 0.5})
        check(status == 200 and data.get("via") != "scrcpy" and "input tap" in log_path.read_text(encoding="utf-8"),
              "after stop, input falls back to adb")
        status, data = client.json("GET", "/api/hd/stream?serial=emulator-5554")
        check(status == 409, "stream refused when HD is off")
    finally:
        server.terminate()
        server.wait(timeout=5)


def browser_tests(env: dict, log_path: Path, shots: Path) -> None:
    print("browser (headless Edge, WebCodecs)")
    sys.path.insert(0, str(HERE.parent.parent.parent / "devtools"))
    try:
        import cdp
    except ImportError:
        print("  skip: devtools/cdp.py not available")
        return
    server, port = start_server(env)
    browser = cdp.Edge(Path(tempfile.mkdtemp(prefix="tether-hd-edge-")), port=9347, width=1280, height=900)
    try:
        browser.goto(f"http://127.0.0.1:{port}/#token={TOKEN}", wait=3)
        browser.eval("document.querySelector('#hdBtn').click(); true")
        stats = {}
        for _ in range(40):
            time.sleep(0.5)
            stats = browser.eval("JSON.stringify(window.__tetherHd)")
            stats = json.loads(stats) if stats else {}
            if stats.get("decoded", 0) >= 45:
                break
        check(stats.get("width") == 360 and stats.get("height") == 780, "browser got the session size")
        check(stats.get("codec", "").startswith("avc1.42"), f"codec string from SPS ({stats.get('codec')})")
        check(stats.get("decoded", 0) >= 45 and stats.get("errors", 1) == 0,
              f"WebCodecs decoded real H.264 frames ({stats.get('decoded')} decoded, {stats.get('errors')} errors)")
        pixel = browser.eval("""(() => { const c = document.querySelector('#hdScreen');
            const d = c.getContext('2d').getImageData(180, 120, 1, 1).data; return [c.width, c.height, d[0] + d[1] + d[2]]; })()""")
        check(pixel[0] == 360 and pixel[1] == 780 and pixel[2] > 60, f"canvas shows the video ({pixel})")
        before = len(control_bytes(log_path))
        browser.eval("""(() => { const p = document.querySelector('#phone');
            const r = document.querySelector('#hdScreen').getBoundingClientRect();
            const o = {clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.25, button: 0, pointerId: 1, bubbles: true};
            p.dispatchEvent(new PointerEvent('pointerdown', o)); p.dispatchEvent(new PointerEvent('pointerup', o)); return true; })()""")
        time.sleep(0.8)
        sent = control_bytes(log_path)[before:]
        touches = [sent[i:i + 32] for i in range(0, len(sent) - 31, 32) if sent[i] == 2]
        if touches:
            x, y = struct.unpack(">ii", touches[0][10:18])
        else:
            x = y = -1
        check(len(touches) >= 2 and abs(x - 180) <= 3 and abs(y - 195) <= 4,
              f"click on the canvas → scrcpy touch at ({x}, {y})")
        shots.mkdir(parents=True, exist_ok=True)
        browser.screenshot(shots / "screenshot-hd.png")
        browser.eval("document.querySelector('#hdBtn').click(); true")
        time.sleep(1)
    finally:
        browser.close()
        server.terminate()
        server.wait(timeout=5)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    unit_tests()
    with tempfile.TemporaryDirectory(prefix="tether-hd-") as tmp_name:
        tmp = Path(tmp_name)
        log_path = tmp / "input.log"
        jar = scrcpy.server_path()
        if jar is None:
            jar = tmp / "scrcpy-server-v5.0.1"
            jar.write_bytes(b"PK fake jar")
        env = dict(os.environ)
        env.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(log_path),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "TETHER_SCRCPY_SERVER": str(jar),
            "TETHER_QUIET": "1",
        })
        session_tests(env, log_path)
        http_tests(env, log_path)
        if "--browser" in sys.argv:
            browser_tests(env, log_path, HERE.parent / "docs")
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
