"""Tether — stream and drive Android devices from a browser.

Zero dependencies: Python 3 standard library + adb.

  python apps/tether/server/server.py                 # http://127.0.0.1:8765, opens browser
  python apps/tether/server/server.py --lan           # share with teammates on your network
  python apps/tether/server/server.py --port 9000 --no-browser

Every /api request needs the access token (header X-Tether-Token). The
launch URL carries it in the #fragment, so it never lands in server logs.
"""

from __future__ import annotations

import argparse
import hmac
import json
import mimetypes
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adb import Adb, AdbError, ScreenRecorder, find_element, find_notification, png_size  # noqa: E402
from beacon_link import BeaconError, BeaconLink  # noqa: E402
from flows import FlowError, report_to_json, run_flow, subscribe_device, validate_flow  # noqa: E402
import maestro  # noqa: E402
import scrcpy  # noqa: E402
import adb_setup  # noqa: E402

VERSION = "0.1.0"
WEB_ROOT = (Path(__file__).resolve().parent.parent / "web").resolve()
MAX_APK_BYTES = 1024 * 1024 * 1024
MAX_JSON_BYTES = 2 * 1024 * 1024
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}


class FrameHub:
    """One capture loop per device, shared by every viewer.

    A loop runs only while someone has asked for frames recently, so idle
    devices are not hammered with screencaps.
    """

    def __init__(self, adb: Adb, max_fps: float = 8.0, idle_seconds: float = 6.0):
        self.adb = adb
        self.min_interval = 1.0 / max(0.5, max_fps)
        self.idle_seconds = idle_seconds
        self._lock = threading.Lock()
        self._streams: dict[str, dict] = {}

    def _stream(self, serial: str) -> dict:
        with self._lock:
            stream = self._streams.get(serial)
            if stream is None:
                stream = {
                    "cond": threading.Condition(),
                    "id": 0,
                    "png": None,
                    "size": None,
                    "error": None,
                    "wanted": time.monotonic(),
                    "thread": None,
                    "kick": threading.Event(),
                }
                self._streams[serial] = stream
            stream["wanted"] = time.monotonic()
            thread = stream["thread"]
            if thread is None or not thread.is_alive():
                thread = threading.Thread(target=self._loop, args=(serial, stream), daemon=True)
                stream["thread"] = thread
                thread.start()
            return stream

    def _loop(self, serial: str, stream: dict) -> None:
        while time.monotonic() - stream["wanted"] < self.idle_seconds:
            started = time.monotonic()
            try:
                png = self.adb.screencap_png(serial)
                size = png_size(png)
                error = None
            except AdbError as exc:
                png, size, error = None, None, str(exc)
            with stream["cond"]:
                if png is not None:
                    stream["png"] = png
                    stream["size"] = size
                    self.adb._remember_size(serial, size)
                stream["error"] = error
                stream["id"] += 1
                stream["cond"].notify_all()
            elapsed = time.monotonic() - started
            delay = self.min_interval - elapsed
            if error:
                delay = max(delay, 1.0)
            if delay > 0:
                stream["kick"].wait(delay)
            stream["kick"].clear()

    def kick(self, serial: str) -> None:
        """Capture again right away (after input) instead of waiting."""
        with self._lock:
            stream = self._streams.get(serial)
        if stream:
            stream["kick"].set()

    def latest(self, serial: str, after: int, timeout: float = 10.0) -> dict:
        stream = self._stream(serial)
        deadline = time.monotonic() + timeout
        with stream["cond"]:
            while stream["id"] <= after:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                stream["cond"].wait(remaining)
                stream["wanted"] = time.monotonic()
            return {
                "id": stream["id"],
                "png": stream["png"],
                "size": stream["size"],
                "error": stream["error"],
                "fresh": stream["id"] > after,
            }


class TetherServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, adb: Adb, token: str, lan: bool, max_fps: float):
        super().__init__(address, Handler)
        self.adb = adb
        self.token = token
        self.lan = lan
        self.hub = FrameHub(adb, max_fps=max_fps)
        self.flow_lock = threading.Lock()
        self.hd = scrcpy.SessionManager(adb)
        self.recorder = ScreenRecorder(adb)
        self.recordings_dir = Path(os.environ.get("TETHER_RECORDINGS_DIR")
                                   or Path(tempfile.gettempdir()) / "tether-recordings")


class Handler(BaseHTTPRequestHandler):
    server: TetherServer
    protocol_version = "HTTP/1.1"
    server_version = f"Tether/{VERSION}"

    # --------------------------------------------------------------- plumbing
    def log_message(self, fmt, *args):
        if os.environ.get("TETHER_QUIET"):
            return
        sys.stderr.write("[tether] %s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, payload, status: int = 200):
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def _error(self, status: int, message: str):
        self._json({"ok": False, "error": message}, status)

    def _body_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_JSON_BYTES:
            raise ValueError("request body too large")
        raw = self.rfile.read(length) if length else b"{}"
        data = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(data, dict):
            raise ValueError("expected a JSON object")
        return data

    def _host_ok(self) -> bool:
        if self.server.lan:
            return True
        host = (self.headers.get("Host") or "").strip()
        if host.startswith("["):
            hostname = host.split("]")[0] + "]"
        else:
            hostname = host.rsplit(":", 1)[0]
        return hostname in LOCAL_HOSTS

    def _authorised(self) -> bool:
        supplied = self.headers.get("X-Tether-Token", "")
        return hmac.compare_digest(supplied.encode(), self.server.token.encode())

    def _serial(self, query: dict, body: dict | None = None) -> str:
        serial = (body or {}).get("serial") or (query.get("serial") or [""])[0]
        if not serial:
            raise ValueError("serial is required")
        return serial

    # ---------------------------------------------------------------- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method: str):
        if not self._host_ok():
            self._error(HTTPStatus.MISDIRECTED_REQUEST, "unexpected Host header")
            return
        url = urlparse(self.path)
        if not url.path.startswith("/api/"):
            if method in ("GET", "HEAD"):
                self._static(url.path)
            else:
                self._error(405, "method not allowed")
            return
        if not self._authorised():
            self._error(401, "missing or wrong access token")
            return
        route = ROUTES.get((method, url.path))
        if route is None:
            self._error(404, "unknown endpoint")
            return
        query = parse_qs(url.query)
        try:
            route(self, query)
        except (AdbError, BeaconError) as exc:
            self._error(502, str(exc))
        except (ValueError, FlowError, json.JSONDecodeError) as exc:
            self._error(400, str(exc))
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"
        target = (WEB_ROOT / path.lstrip("/")).resolve()
        if WEB_ROOT not in target.parents and target != WEB_ROOT or not target.is_file():
            self._error(404, "not found")
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith("javascript"):
            content_type += "; charset=utf-8"
        extra = {
            "Content-Security-Policy": (
                "default-src 'self'; img-src 'self' blob: data:; "
                "style-src 'self' 'unsafe-inline'; connect-src 'self'"
            )
        }
        self._send(200, target.read_bytes(), content_type, extra)

    # -------------------------------------------------------------- endpoints
    def api_health(self, query):
        adb = self.server.adb
        version = None
        if adb.available:
            try:
                version = adb.version()
            except AdbError:
                version = None
        self._json({
            "ok": True,
            "tether": VERSION,
            "adb": " ".join(adb.argv) if adb.argv else None,
            "adb_version": version,
            "lan": self.server.lan,
            "beacon": os.environ.get("BEACON_URL") if BeaconLink.configured() else None,
        })

    def api_devices(self, query):
        self._json({"ok": True, "devices": self.server.adb.devices()})

    def api_frame(self, query):
        serial = self._serial(query)
        after = int((query.get("after") or ["0"])[0])
        frame = self.server.hub.latest(serial, after, timeout=10.0)
        if frame["png"] is None:
            if frame["error"]:
                self._error(502, frame["error"])
            else:
                self._send(204, b"", "text/plain")
            return
        if not frame["fresh"] and not frame["error"]:
            self._send(204, b"", "text/plain", {"X-Frame-Id": str(frame["id"])})
            return
        width, height = frame["size"]
        self._send(200, frame["png"], "image/png", {
            "X-Frame-Id": str(frame["id"]),
            "X-Frame-Width": str(width),
            "X-Frame-Height": str(height),
            "X-Frame-Error": (frame["error"] or "")[:200],
        })

    def api_screenshot(self, query):
        serial = self._serial(query)
        png = self.server.adb.screencap_png(serial)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        safe_serial = "".join(c if c.isalnum() else "_" for c in serial)
        self._send(200, png, "image/png", {
            "Content-Disposition": f'attachment; filename="tether-{safe_serial}-{stamp}.png"'
        })

    def api_input(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        session = self.server.hd.get(serial)
        if session is not None:
            try:
                self._hd_input(session, body)
                self._json({"ok": True, "via": "scrcpy"})
                return
            except scrcpy.ScrcpyError:
                pass  # fall back to adb input below
        adb = self.server.adb
        action = body.get("action")
        width, height = adb.display_size(serial)

        def px(name_x: str, name_y: str) -> tuple[int, int]:
            x = float(body[name_x])
            y = float(body[name_y])
            if not (0 <= x <= 1 and 0 <= y <= 1):
                raise ValueError("coordinates are normalised: 0..1")
            return round(x * (width - 1)), round(y * (height - 1))

        if action == "tap":
            adb.tap(serial, *px("x", "y"))
        elif action == "long_press":
            adb.long_press(serial, *px("x", "y"), int(body.get("duration_ms", 700)))
        elif action == "swipe":
            x1, y1 = px("x", "y")
            x2, y2 = px("x2", "y2")
            adb.swipe(serial, x1, y1, x2, y2, int(body.get("duration_ms", 300)))
        elif action == "text":
            adb.text(serial, str(body.get("text", "")))
        elif action == "key":
            adb.key(serial, body.get("key"))
        else:
            raise ValueError(f"unknown input action {action!r}")
        self.server.hub.kick(serial)
        self._json({"ok": True})

    @staticmethod
    def _norm(body: dict, name: str) -> float:
        value = float(body[name])
        if not 0 <= value <= 1:
            raise ValueError("coordinates are normalised: 0..1")
        return value

    def _hd_input(self, session, body: dict) -> None:
        """Same actions as adb input, delivered through scrcpy's control socket (milliseconds)."""
        action = body.get("action")
        if action == "tap":
            session.tap(self._norm(body, "x"), self._norm(body, "y"))
        elif action == "long_press":
            session.tap(self._norm(body, "x"), self._norm(body, "y"),
                        hold_ms=max(300, min(int(body.get("duration_ms", 700)), 5000)))
        elif action == "swipe":
            session.swipe(self._norm(body, "x"), self._norm(body, "y"), self._norm(body, "x2"),
                          self._norm(body, "y2"), max(50, min(int(body.get("duration_ms", 300)), 5000)))
        elif action == "text":
            session.text(str(body.get("text", "")))
        elif action == "key":
            session.key(body.get("key"))
        elif action == "scroll":
            session.scroll(self._norm(body, "x"), self._norm(body, "y"), float(body.get("dy", 0)),
                           float(body.get("dx", 0)))
        else:
            raise ValueError(f"unknown input action {action!r}")

    # ------------------------------------------------------------ HD (scrcpy)
    def api_hd_status(self, query):
        self._json({"ok": True, "hd": self.server.hd.status(self._serial(query))})

    def api_hd_setup(self, query):
        if scrcpy.server_path():
            self._json({"ok": True, "installed": False, "path": str(scrcpy.server_path())})
            return
        try:
            path = scrcpy.install_server()
        except scrcpy.ScrcpyError as exc:
            self._error(502, str(exc))
            return
        self._json({"ok": True, "installed": True, "path": str(path)})

    def api_hd_start(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        options = {key: int(body[key]) for key in ("max_size", "max_fps", "bit_rate") if body.get(key)}
        try:
            status = self.server.hd.start(serial, **options)
        except scrcpy.ScrcpyError as exc:
            self.server.hd.stop(serial)
            self._error(502, str(exc))
            return
        self._json({"ok": True, "hd": status})

    def api_hd_stop(self, query):
        body = self._body_json()
        self.server.hd.stop(self._serial(query, body))
        self._json({"ok": True})

    def api_hd_stream(self, query):
        """Long-lived binary stream: [u8 kind][u64 pts][u32 size][payload]… (see scrcpy.py)."""
        serial = self._serial(query)
        session = self.server.hd.get(serial)
        if session is None:
            self._error(409, "HD is not running for this device")
            return
        viewer = session.subscribe()
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            while True:
                try:
                    message = viewer.queue.get(timeout=15)
                except scrcpy.queue.Empty:
                    if not session.running:
                        break
                    continue
                if message is None:
                    break
                self.wfile.write(message)
                if viewer.queue.empty():
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            session.unsubscribe(viewer)

    # ------------------------------------------------- recording + clipboard
    def api_record_start(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in serial)
        name = f"tether-{safe}-{time.strftime('%Y%m%d-%H%M%S')}.mp4"
        output = self.server.recordings_dir / name
        status = self.server.recorder.start(serial, str(output), int(body.get("time_limit") or 180))
        self._json({"ok": True, "name": name, "time_limit": status["time_limit"]})

    def api_record_status(self, query):
        self._json({"ok": True, **self.server.recorder.status(self._serial(query))})

    def api_record_stop(self, query):
        body = self._body_json()
        result = self.server.recorder.stop(self._serial(query, body))
        name = Path(result["path"]).name
        self._json({"ok": True, "name": name, "size": result["size"], "duration": result["duration"],
                    "url": f"/api/record/file?name={name}"})

    def api_record_file(self, query):
        name = (query.get("name") or [""])[0]
        if not name or Path(name).name != name or not name.endswith(".mp4"):
            raise ValueError("bad recording name")
        target = self.server.recordings_dir / name
        if not target.is_file():
            self._error(404, "recording not found")
            return
        self._send(200, target.read_bytes(), "video/mp4",
                   {"Content-Disposition": f'attachment; filename="{name}"'})

    def api_clipboard_get(self, query):
        serial = self._serial(query)
        try:
            text = scrcpy.clipboard(self.server.adb, serial, None, self.server.hd)
        except scrcpy.ScrcpyError as exc:
            self._error(502, str(exc))
            return
        self._json({"ok": True, "text": text})

    def api_clipboard_set(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        if not isinstance(body.get("text"), str):
            raise ValueError("text is required")
        try:
            scrcpy.clipboard(self.server.adb, serial, body["text"], self.server.hd)
        except scrcpy.ScrcpyError as exc:
            self._error(502, str(exc))
            return
        self._json({"ok": True})

    def api_ui(self, query):
        serial = self._serial(query)
        elements = self.server.adb.ui_elements(serial)
        width, height = self.server.adb.display_size(serial)
        self._json({"ok": True, "size": [width, height], "elements": elements})

    def api_tap_element(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        adb = self.server.adb
        selector = {k: body[k] for k in ("text", "resource_id", "desc") if body.get(k)}
        element = find_element(adb.ui_elements(serial), **selector)
        if element is None:
            self._error(404, "no matching element on screen")
            return
        adb.tap(serial, *element["center"])
        self.server.hub.kick(serial)
        self._json({"ok": True, "element": element})

    def api_packages(self, query):
        serial = self._serial(query)
        third_party = (query.get("all") or ["0"])[0] != "1"
        adb = self.server.adb
        packages = adb.packages(serial, third_party=third_party)
        try:
            foreground = adb.foreground(serial)
        except AdbError:
            foreground = None
        self._json({"ok": True, "packages": packages, "foreground": foreground})

    def _package_action(self, query, method_name: str):
        body = self._body_json()
        serial = self._serial(query, body)
        output = getattr(self.server.adb, method_name)(serial, str(body.get("package", "")))
        self.server.hub.kick(serial)
        self._json({"ok": True, "output": output})

    def api_launch(self, query):
        self._package_action(query, "launch")

    def api_stop(self, query):
        self._package_action(query, "stop")

    def api_clear(self, query):
        self._package_action(query, "clear_data")

    def api_install(self, query):
        serial = self._serial(query)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            raise ValueError("upload the APK as the request body")
        if length > MAX_APK_BYTES:
            raise ValueError("APK larger than 1 GB")
        handle, temp_path = tempfile.mkstemp(prefix="tether-", suffix=".apk")
        try:
            with os.fdopen(handle, "wb") as out:
                remaining = length
                while remaining:
                    chunk = self.rfile.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise ValueError("upload interrupted")
                    out.write(chunk)
                    remaining -= len(chunk)
            with open(temp_path, "rb") as check:
                if check.read(2) != b"PK":
                    raise ValueError("that file is not an APK")
            output = self.server.adb.install(serial, temp_path)
        finally:
            try:
                os.remove(temp_path)
            except OSError:
                pass
        self._json({"ok": True, "output": output})

    def api_logcat(self, query):
        serial = self._serial(query)
        lines = int((query.get("lines") or ["300"])[0])
        package = (query.get("package") or [""])[0] or None
        text = self.server.adb.logcat(serial, lines=lines, package=package)
        self._json({"ok": True, "log": text})

    def api_flow_run(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        flow = body.get("flow")
        if not self.server.flow_lock.acquire(blocking=False):
            self._error(409, "another flow is already running")
            return
        try:
            report = run_flow(self.server.adb, serial, flow)
        finally:
            self.server.flow_lock.release()
        self.server.hub.kick(serial)
        self._json({"ok": True, "report": report_to_json(report)})


    def api_maestro_import(self, query):
        body = self._body_json()
        text = body.get("yaml")
        if not isinstance(text, str) or not text.strip():
            raise ValueError("send the Maestro YAML as `yaml`")
        flow, warnings = maestro.maestro_to_flow(text)
        validate_flow(flow)
        self._json({"ok": True, "flow": flow, "warnings": warnings})

    def api_maestro_export(self, query):
        flow = self._body_json().get("flow")
        validate_flow(flow)
        text, warnings = maestro.flow_to_maestro(flow)
        self._json({"ok": True, "yaml": text, "warnings": warnings})

    def api_notifications(self, query):
        serial = self._serial(query)
        self._json({"ok": True, "notifications": self.server.adb.notifications(serial)})

    def api_notification_tap(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        adb = self.server.adb
        found = find_notification(adb.notifications(serial), title=body.get("title"), text=body.get("text"))
        if found is None:
            self._error(404, "no such notification on the device")
            return
        adb.expand_notifications(serial)
        time.sleep(0.6)
        element = find_element(adb.ui_elements(serial), text=found["title"] or found["text"])
        if element is None:
            self._error(404, "notification shade opened but the notification was not on screen")
            return
        adb.tap(serial, *element["center"])
        self.server.hub.kick(serial)
        self._json({"ok": True, "notification": found})

    def api_notification_close(self, query):
        body = self._body_json()
        self.server.adb.collapse_notifications(self._serial(query, body))
        self._json({"ok": True})

    def api_push(self, query):
        body = self._body_json()
        fields = {k: body[k] for k in ("title", "body", "url", "target", "channels", "data") if k in body}
        if not fields.get("title"):
            raise ValueError("title is required")
        message = BeaconLink.from_env().send_and_wait(fields)
        self._json({"ok": True, "message": {k: message[k] for k in
                                            ("id", "status", "targeted", "delivered", "failed", "pruned")}})


    def api_setup_adb(self, query):
        if self.server.adb.available:
            self._json({"ok": True, "adb": " ".join(self.server.adb.argv), "installed": False})
            return
        try:
            path = adb_setup.install()
        except adb_setup.SetupError as exc:
            self._error(502, str(exc))
            return
        self.server.adb.refresh()
        try:
            version = self.server.adb.version()
        except AdbError:
            version = None
        self._json({"ok": True, "adb": str(path), "installed": True, "version": version})

    def api_pair(self, query):
        body = self._body_json()
        output = self.server.adb.pair(str(body.get("host_port", "")), str(body.get("code", "")))
        self._json({"ok": True, "output": output})

    def api_connect(self, query):
        body = self._body_json()
        self._json({"ok": True, "output": self.server.adb.connect(str(body.get("host_port", "")))})

    def api_subscribe_device(self, query):
        body = self._body_json()
        serial = self._serial(query, body)
        tags = body.get("tags") or ["qa:device"]
        if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
            raise ValueError("tags must be a list of strings")
        result = subscribe_device(self.server.adb, serial, tags, body.get("user") or None)
        self.server.hub.kick(serial)
        self._json({"ok": True, "result": result})


ROUTES = {
    ("GET", "/api/health"): Handler.api_health,
    ("GET", "/api/devices"): Handler.api_devices,
    ("GET", "/api/frame"): Handler.api_frame,
    ("GET", "/api/screenshot"): Handler.api_screenshot,
    ("POST", "/api/input"): Handler.api_input,
    ("GET", "/api/ui"): Handler.api_ui,
    ("POST", "/api/tap_element"): Handler.api_tap_element,
    ("GET", "/api/packages"): Handler.api_packages,
    ("POST", "/api/launch"): Handler.api_launch,
    ("POST", "/api/stop"): Handler.api_stop,
    ("POST", "/api/clear"): Handler.api_clear,
    ("POST", "/api/install"): Handler.api_install,
    ("GET", "/api/logcat"): Handler.api_logcat,
    ("POST", "/api/flow/run"): Handler.api_flow_run,
    ("POST", "/api/flow/maestro/import"): Handler.api_maestro_import,
    ("GET", "/api/hd/status"): Handler.api_hd_status,
    ("POST", "/api/setup/scrcpy"): Handler.api_hd_setup,
    ("POST", "/api/hd/start"): Handler.api_hd_start,
    ("POST", "/api/hd/stop"): Handler.api_hd_stop,
    ("GET", "/api/hd/stream"): Handler.api_hd_stream,
    ("POST", "/api/flow/maestro/export"): Handler.api_maestro_export,
    ("GET", "/api/notifications"): Handler.api_notifications,
    ("POST", "/api/notifications/tap"): Handler.api_notification_tap,
    ("POST", "/api/notifications/close"): Handler.api_notification_close,
    ("POST", "/api/push"): Handler.api_push,
    ("POST", "/api/setup/adb"): Handler.api_setup_adb,
    ("POST", "/api/pair"): Handler.api_pair,
    ("POST", "/api/connect"): Handler.api_connect,
    ("POST", "/api/beacon/subscribe-device"): Handler.api_subscribe_device,
    ("POST", "/api/record/start"): Handler.api_record_start,
    ("GET", "/api/record/status"): Handler.api_record_status,
    ("POST", "/api/record/stop"): Handler.api_record_stop,
    ("GET", "/api/record/file"): Handler.api_record_file,
    ("GET", "/api/clipboard"): Handler.api_clipboard_get,
    ("POST", "/api/clipboard"): Handler.api_clipboard_set,
}


def lan_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))
            return probe.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Tether — Android devices in your browser.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("TETHER_PORT", 8765)))
    parser.add_argument("--lan", action="store_true", help="listen on all interfaces")
    parser.add_argument("--token", default=os.environ.get("TETHER_TOKEN"),
                        help="access token (random by default)")
    parser.add_argument("--max-fps", type=float, default=8.0)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--beacon-url", help="Beacon server for push QA (or BEACON_URL)")
    parser.add_argument("--beacon-key", help="Beacon app secret sk_… (or BEACON_KEY)")
    parser.add_argument("--beacon-app-id", type=int, help="only when --beacon-key is the admin token")
    args = parser.parse_args(argv)

    if args.beacon_url:
        os.environ["BEACON_URL"] = args.beacon_url
    if args.beacon_key:
        os.environ["BEACON_KEY"] = args.beacon_key
    if args.beacon_app_id:
        os.environ["BEACON_APP_ID"] = str(args.beacon_app_id)
    token = args.token or secrets.token_urlsafe(18)
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    adb = Adb()
    server = TetherServer((host, args.port), adb, token, args.lan, args.max_fps)
    port = server.server_address[1]

    public_host = lan_address() if args.lan else "127.0.0.1"
    url = f"http://{public_host}:{port}/#token={token}"
    print(f"Tether {VERSION}")
    print(f"  adb: {' '.join(adb.argv) if adb.argv else 'NOT FOUND — install Android platform-tools'}")
    print(f"  open: {url}")
    print(f"  beacon: {os.environ.get('BEACON_URL') if BeaconLink.configured() else 'not linked (push QA off)'}")
    if args.lan:
        print("  LAN mode: anyone with this link can control your devices. Share it carefully.")
    sys.stdout.flush()
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(f"http://127.0.0.1:{port}/#token={token}")).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.hd.stop_all()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
