"""HD screen streaming + instant input via scrcpy's device server.

scrcpy (https://github.com/Genymobile/scrcpy, Apache-2.0) ships a small Java
server that runs on the phone (`app_process`), encodes the screen with the
hardware H.264 encoder and accepts input events over a socket. Tether pushes
that server, reads the stream and relays it to the browser, which decodes it
with WebCodecs — 30-60 fps instead of ~2 fps PNG screencaps, and taps land in
a few milliseconds instead of a `adb shell input` round-trip.

Wire protocol (scrcpy v5.0.1, verified against its Streamer / DesktopConnection
/ ControlMessageReader sources):
  * sockets, in order: video, control (audio disabled); with tunnel_forward
    the first socket receives a dummy byte, then (after all sockets connect)
    a 64-byte device name
  * video: u32 codec id ('h264'), then 12-byte headers: session packets have
    bit 63 set (u32 flags, u32 width, u32 height); media packets are
    u64 pts|flags (bit 62 config, bit 61 key frame) + u32 size + payload
  * control: big-endian messages, type byte first (see *_message functions)
"""

from __future__ import annotations

import hashlib
import os
import queue
import secrets
import socket
import struct
import subprocess
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path

SCRCPY_VERSION = "5.0.1"
SERVER_URL = (f"https://github.com/Genymobile/scrcpy/releases/download/v{SCRCPY_VERSION}/"
              f"scrcpy-server-v{SCRCPY_VERSION}")
SERVER_SHA256 = "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536"
DEVICE_PATH = "/data/local/tmp/tether-scrcpy-server.jar"
CODEC_H264 = 0x68323634

FLAG_SESSION = 1 << 63
FLAG_CONFIG = 1 << 62
FLAG_KEY_FRAME = 1 << 61
PTS_MASK = FLAG_KEY_FRAME - 1

# messages relayed to the browser: u8 kind, u64 pts (µs), u32 size, payload
KIND_SESSION, KIND_CONFIG, KIND_KEY, KIND_DELTA = 1, 2, 3, 4
RELAY_HEADER = struct.Struct(">BQI")

# Android constants
ACTION_DOWN, ACTION_UP, ACTION_MOVE = 0, 1, 2
POINTER_FINGER = 0xFFFFFFFFFFFFFFFE  # scrcpy's POINTER_ID_GENERIC_FINGER (-2)
BUTTON_PRIMARY = 1
KEYCODES = {
    "home": 3, "back": 4, "up": 19, "down": 20, "left": 21, "right": 22, "volume_up": 24, "volume_down": 25,
    "power": 26, "tab": 61, "enter": 66, "delete": 67, "menu": 82, "escape": 111, "forward_delete": 112,
    "recents": 187, "app_switch": 187, "sleep": 223, "wake": 224,
}
GOP_LIMIT_FRAMES = 900
GOP_LIMIT_BYTES = 24 * 1024 * 1024


class ScrcpyError(RuntimeError):
    pass


# ---------------------------------------------------------------- the jar
def tools_dir() -> Path:
    configured = os.environ.get("TETHER_TOOLS_DIR")
    return Path(configured) if configured else Path(__file__).resolve().parent.parent / "tools"


def server_path() -> Path | None:
    override = os.environ.get("TETHER_SCRCPY_SERVER")
    if override:
        return Path(override) if Path(override).is_file() else None
    bundled = tools_dir() / f"scrcpy-server-v{SCRCPY_VERSION}"
    return bundled if bundled.is_file() else None


def install_server() -> Path:
    """Download the official scrcpy-server (734 KB) and check its SHA-256."""
    url = os.environ.get("TETHER_SCRCPY_URL") or SERVER_URL
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
    except OSError as exc:
        raise ScrcpyError(f"could not download scrcpy-server from {url}: {exc}") from exc
    if not os.environ.get("TETHER_SCRCPY_URL") and hashlib.sha256(data).hexdigest() != SERVER_SHA256:
        raise ScrcpyError("scrcpy-server checksum mismatch — download corrupted or tampered with")
    target = tools_dir() / f"scrcpy-server-v{SCRCPY_VERSION}"
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".part")
    temp.write_bytes(data)
    os.replace(temp, target)
    return target


# ------------------------------------------------------- control messages
def _u16_fixed(value: float) -> int:
    """scrcpy sc_float_to_u16fp: [0, 1] → u16 (1.0 → 0xffff)."""
    value = min(max(value, 0.0), 1.0)
    return min(int(value * 65536), 0xFFFF)


def _i16_fixed(value: float) -> int:
    """scrcpy sc_float_to_i16fp: [-1, 1] → i16."""
    value = min(max(value, -1.0), 1.0)
    return max(-0x8000, min(int(value * 32768), 0x7FFF))


def keycode_message(action: int, keycode: int, repeat: int = 0, metastate: int = 0) -> bytes:
    return struct.pack(">BBiii", 0, action, keycode, repeat, metastate)


def text_message(text: str) -> bytes:
    data = text.encode("utf-8")[:300]  # SC_CONTROL_MSG_INJECT_TEXT_MAX_LENGTH
    return struct.pack(">BI", 1, len(data)) + data


def touch_message(action: int, pointer_id: int, x: int, y: int, width: int, height: int,
                  pressure: float = 1.0, action_button: int = 0, buttons: int = 0) -> bytes:
    return struct.pack(">BBQiiHHHii", 2, action, pointer_id & 0xFFFFFFFFFFFFFFFF, x, y, width, height,
                       _u16_fixed(pressure), action_button, buttons)


def scroll_message(x: int, y: int, width: int, height: int, hscroll: float, vscroll: float,
                   buttons: int = 0) -> bytes:
    return struct.pack(">BiiHHhhi", 3, x, y, width, height, _i16_fixed(hscroll / 16), _i16_fixed(vscroll / 16),
                       buttons)


def back_or_screen_on_message(action: int) -> bytes:
    return struct.pack(">BB", 4, action)


EXPAND_NOTIFICATIONS = bytes([5])
EXPAND_SETTINGS = bytes([6])
COLLAPSE_PANELS = bytes([7])


# ----------------------------------------------------------------- stream
def recv_exact(sock: socket.socket, size: int) -> bytes:
    chunks, remaining = [], size
    while remaining:
        chunk = sock.recv(min(remaining, 1 << 20))
        if not chunk:
            raise EOFError("scrcpy socket closed")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def relay(kind: int, pts: int, payload: bytes) -> bytes:
    return RELAY_HEADER.pack(kind, pts, len(payload)) + payload


class Viewer:
    """One browser connection; drops to the next key frame if it falls behind."""

    def __init__(self):
        self.queue: queue.Queue[bytes | None] = queue.Queue(maxsize=240)
        self.waiting_for_key = False

    def push(self, message: bytes, kind: int, resync: list[bytes]) -> None:
        if self.waiting_for_key:
            if kind != KIND_KEY:
                return
            self.waiting_for_key = False
            for item in resync:
                self._put(item)
            return
        if not self._put(message):
            self.waiting_for_key = True  # too slow: flush and restart at the next key frame
            while not self.queue.empty():
                try:
                    self.queue.get_nowait()
                except queue.Empty:
                    break

    def close(self) -> None:
        """Signal end of stream without ever blocking the reader thread."""
        while not self._put(None):
            try:
                self.queue.get_nowait()
            except queue.Empty:
                pass

    def _put(self, message: bytes | None) -> bool:
        try:
            self.queue.put_nowait(message)
            return True
        except queue.Full:
            return False


class ScrcpySession:
    def __init__(self, adb, serial: str, max_size: int = 1280, max_fps: int = 30, bit_rate: int = 8_000_000):
        self.adb = adb
        self.serial = serial
        self.max_size = max(0, min(int(max_size), 4096))
        self.max_fps = max(1, min(int(max_fps), 120))
        self.bit_rate = max(500_000, min(int(bit_rate), 40_000_000))
        self.scid = secrets.randbits(31)
        self.port = 0
        self.process: subprocess.Popen | None = None
        self.video: socket.socket | None = None
        self.control: socket.socket | None = None
        self.control_lock = threading.Lock()
        self.device_name = ""
        self.size = (0, 0)
        self.running = False
        self.error = ""
        self.log: deque[str] = deque(maxlen=60)
        self.viewers: set[Viewer] = set()
        self.viewers_lock = threading.Lock()
        self.session_message: bytes | None = None
        self.gop: list[bytes] = []  # config + key frame + deltas since: lets late viewers start instantly
        self.gop_bytes = 0
        self.frames = 0
        self.started_at = 0.0

    # ------------------------------------------------------------ status
    def status(self) -> dict:
        return {
            "running": self.running,
            "serial": self.serial,
            "device_name": self.device_name,
            "width": self.size[0],
            "height": self.size[1],
            "frames": self.frames,
            "viewers": len(self.viewers),
            "error": self.error,
            "max_size": self.max_size,
            "max_fps": self.max_fps,
            "version": SCRCPY_VERSION,
        }

    # --------------------------------------------------------- lifecycle
    def start(self, timeout: float = 15.0) -> dict:
        jar = server_path()
        if jar is None:
            raise ScrcpyError("scrcpy-server is not installed — use the HD button's one-click install")
        self.adb.run(["push", str(jar), DEVICE_PATH], serial=self.serial, timeout=60)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.adb.run(["forward", f"tcp:{self.port}", f"localabstract:scrcpy_{self.scid:08x}"], serial=self.serial)
        command = list(self.adb.argv) + ["-s", self.serial, "shell", f"CLASSPATH={DEVICE_PATH}", "app_process", "/",
                                         "com.genymobile.scrcpy.Server", SCRCPY_VERSION,
                                         f"scid={self.scid:08x}", "log_level=info", "tunnel_forward=true",
                                         "audio=false", "control=true", "cleanup=true", "video_codec=h264",
                                         f"max_size={self.max_size}", f"max_fps={self.max_fps}",
                                         f"video_bit_rate={self.bit_rate}", "clipboard_autosync=false"]
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        self.process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        stdin=subprocess.DEVNULL, creationflags=flags)
        threading.Thread(target=self._read_log, daemon=True, name=f"scrcpy-log-{self.serial}").start()
        try:
            self._connect(timeout)
        except Exception:
            self.stop()
            raise
        self.running = True
        self.started_at = time.time()
        threading.Thread(target=self._read_video, daemon=True, name=f"scrcpy-video-{self.serial}").start()
        threading.Thread(target=self._drain_control, daemon=True, name=f"scrcpy-ctl-{self.serial}").start()
        return self.status()

    def _read_log(self) -> None:
        for raw in self.process.stdout:
            self.log.append(raw.decode("utf-8", "replace").rstrip())

    def _connect(self, timeout: float) -> None:
        deadline = time.monotonic() + timeout
        while True:
            if self.process.poll() is not None:
                detail = " | ".join(list(self.log)[-4:]) or f"exit code {self.process.returncode}"
                raise ScrcpyError(f"scrcpy server stopped: {detail}")
            sock = socket.create_connection(("127.0.0.1", self.port), timeout=2)
            try:
                if sock.recv(1):  # dummy byte: the device server really accepted us
                    break
            except OSError:
                pass
            sock.close()
            if time.monotonic() > deadline:
                raise ScrcpyError("scrcpy server did not start in time")
            time.sleep(0.15)
        self.video = sock
        self.control = socket.create_connection(("127.0.0.1", self.port), timeout=5)
        self.video.settimeout(10)
        self.device_name = recv_exact(self.video, 64).split(b"\0", 1)[0].decode("utf-8", "replace")
        codec = struct.unpack(">I", recv_exact(self.video, 4))[0]
        if codec in (0, 1):
            raise ScrcpyError("the device could not start screen capture" if codec == 1 else "video disabled")
        if codec != CODEC_H264:
            raise ScrcpyError(f"unexpected codec 0x{codec:08x}")
        self.video.settimeout(None)
        self.control.settimeout(None)

    def _read_video(self) -> None:
        try:
            while self.running:
                header = recv_exact(self.video, 12)
                first = struct.unpack(">Q", header[:8])[0]
                if first & FLAG_SESSION:
                    width, height = struct.unpack(">II", header[4:12])
                    self.size = (width, height)
                    self.session_message = relay(KIND_SESSION, 0, struct.pack(">II", width, height))
                    self.gop = []
                    self.gop_bytes = 0
                    self._broadcast(self.session_message, KIND_SESSION)
                    continue
                size = struct.unpack(">I", header[8:12])[0]
                payload = recv_exact(self.video, size)
                if first & FLAG_CONFIG:
                    message = relay(KIND_CONFIG, 0, payload)
                    self.gop = [message]
                    self.gop_bytes = len(message)
                    self._broadcast(message, KIND_CONFIG)
                    continue
                kind = KIND_KEY if first & FLAG_KEY_FRAME else KIND_DELTA
                message = relay(kind, first & PTS_MASK, payload)
                self.frames += 1
                if kind == KIND_KEY:
                    config = [m for m in self.gop if m[0] == KIND_CONFIG][-1:]
                    self.gop = config + [message]
                    self.gop_bytes = sum(len(m) for m in self.gop)
                elif self.gop:
                    self.gop.append(message)
                    self.gop_bytes += len(message)
                    if len(self.gop) > GOP_LIMIT_FRAMES or self.gop_bytes > GOP_LIMIT_BYTES:
                        self.gop = [m for m in self.gop if m[0] == KIND_CONFIG][-1:]  # too long: wait for next key
                self._broadcast(message, kind)
        except (EOFError, OSError) as exc:
            if self.running:
                self.error = f"stream ended: {exc}"
        finally:
            self.running = False
            self._broadcast(None, 0)

    def _drain_control(self) -> None:
        """The device may send clipboard/ack messages back; we don't use them."""
        try:
            while self.running and self.control.recv(4096):
                pass
        except OSError:
            pass

    def _broadcast(self, message: bytes | None, kind: int) -> None:
        with self.viewers_lock:
            viewers = list(self.viewers)
        for viewer in viewers:
            if message is None:
                viewer.close()
            else:
                resync = ([self.session_message] if self.session_message else []) + self.gop
                viewer.push(message, kind, resync)

    def subscribe(self) -> Viewer:
        viewer = Viewer()
        with self.viewers_lock:
            if self.session_message:
                viewer._put(self.session_message)
            for message in self.gop:
                viewer._put(message)
            self.viewers.add(viewer)
        return viewer

    def unsubscribe(self, viewer: Viewer) -> None:
        with self.viewers_lock:
            self.viewers.discard(viewer)

    def stop(self) -> None:
        self.running = False
        for sock in (self.video, self.control):
            if sock is not None:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                sock.close()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
        if self.port:
            try:
                self.adb.run(["forward", "--remove", f"tcp:{self.port}"], serial=self.serial, check=False)
            except Exception:
                pass
        self._broadcast(None, 0)

    # ------------------------------------------------------------- input
    def _send(self, message: bytes) -> None:
        if not self.running or self.control is None:
            raise ScrcpyError("HD session is not running")
        with self.control_lock:
            self.control.sendall(message)

    def _point(self, nx: float, ny: float) -> tuple[int, int, int, int]:
        width, height = self.size
        if not width or not height:
            raise ScrcpyError("video size unknown yet")
        return round(min(max(nx, 0), 1) * (width - 1)), round(min(max(ny, 0), 1) * (height - 1)), width, height

    def touch(self, action: int, nx: float, ny: float) -> None:
        x, y, width, height = self._point(nx, ny)
        pressure = 0.0 if action == ACTION_UP else 1.0
        self._send(touch_message(action, POINTER_FINGER, x, y, width, height, pressure))

    def tap(self, nx: float, ny: float, hold_ms: int = 40) -> None:
        self.touch(ACTION_DOWN, nx, ny)
        time.sleep(hold_ms / 1000)
        self.touch(ACTION_UP, nx, ny)

    def swipe(self, nx1: float, ny1: float, nx2: float, ny2: float, duration_ms: int = 300) -> None:
        steps = max(2, int(duration_ms / 16))
        self.touch(ACTION_DOWN, nx1, ny1)
        for index in range(1, steps + 1):
            t = index / steps
            time.sleep(duration_ms / 1000 / steps)
            self.touch(ACTION_MOVE, nx1 + (nx2 - nx1) * t, ny1 + (ny2 - ny1) * t)
        self.touch(ACTION_UP, nx2, ny2)

    def key(self, name: str | int) -> None:
        if isinstance(name, int) or str(name).isdigit():
            code = int(name)
        else:
            code = KEYCODES.get(str(name).lower().replace(" ", "_"))
            if code is None:
                raise ScrcpyError(f"unknown key {name!r}")
        self._send(keycode_message(ACTION_DOWN, code) + keycode_message(ACTION_UP, code))

    def text(self, value: str) -> None:
        for start in range(0, len(value), 100):
            self._send(text_message(value[start:start + 100]))

    def scroll(self, nx: float, ny: float, vscroll: float, hscroll: float = 0.0) -> None:
        x, y, width, height = self._point(nx, ny)
        self._send(scroll_message(x, y, width, height, hscroll, vscroll))

    def expand_notifications(self) -> None:
        self._send(EXPAND_NOTIFICATIONS)

    def collapse_panels(self) -> None:
        self._send(COLLAPSE_PANELS)


class SessionManager:
    """At most one HD session per device serial."""

    def __init__(self, adb):
        self.adb = adb
        self.sessions: dict[str, ScrcpySession] = {}
        self.lock = threading.Lock()

    def get(self, serial: str) -> ScrcpySession | None:
        session = self.sessions.get(serial)
        return session if session and session.running else None

    def start(self, serial: str, **options) -> dict:
        with self.lock:
            current = self.sessions.get(serial)
            if current and current.running:
                return current.status()
            session = ScrcpySession(self.adb, serial, **options)
            self.sessions[serial] = session
        return session.start()

    def stop(self, serial: str) -> None:
        with self.lock:
            session = self.sessions.pop(serial, None)
        if session:
            session.stop()

    def stop_all(self) -> None:
        for serial in list(self.sessions):
            self.stop(serial)

    def status(self, serial: str) -> dict:
        session = self.sessions.get(serial)
        base = {"installed": server_path() is not None, "version": SCRCPY_VERSION}
        if session is None:
            return {**base, "running": False}
        return {**base, **session.status(), "log": list(session.log)[-6:]}
