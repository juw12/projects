"""Thin, dependency-free wrapper around the Android Debug Bridge (adb).

Everything Tether does to a device goes through this module, so the web
server, the flow runner and the MCP server all behave identically.

adb is located in this order:
  1. TETHER_ADB environment variable (a .py path is run with this Python,
     which is how the hermetic tests plug in a fake adb)
  2. adb on PATH
  3. ANDROID_HOME / ANDROID_SDK_ROOT / default SDK locations
"""

from __future__ import annotations

import math
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

KEYCODES = {
    "home": 3,
    "back": 4,
    "up": 19,
    "down": 20,
    "left": 21,
    "right": 22,
    "volume_up": 24,
    "volume_down": 25,
    "power": 26,
    "tab": 61,
    "enter": 66,
    "delete": 67,
    "menu": 82,
    "escape": 111,
    "forward_delete": 112,
    "recents": 187,
    "sleep": 223,
    "wake": 224,
}

# Characters the remote `sh` would interpret inside `input text`.
_SHELL_SPECIAL = set("\\'\"()&<>;|*~`$!?#[]{}^")

_BOUNDS_RE = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")
_CUR_SIZE_RE = re.compile(r"\bcur=(\d+)x(\d+)")
_WM_SIZE_RE = re.compile(r"(Physical|Override) size:\s*(\d+)x(\d+)")
_FOCUS_RE = re.compile(r"mCurrentFocus=Window\{[^ ]+ [^ ]+ ([^}\s]+)\}")
_EXTRA_RE = {
    "title": re.compile(r"^\s*android\.title=\w+ \((.*)\)\s*$", re.M),
    "text": re.compile(r"^\s*android\.text=\w+ \((.*)\)\s*$", re.M),
    "big_text": re.compile(r"^\s*android\.bigText=\w+ \((.*)\)\s*$", re.M),
    "sub_text": re.compile(r"^\s*android\.subText=\w+ \((.*)\)\s*$", re.M),
}

UI_DUMP_PATH = "/sdcard/tether_ui.xml"


class AdbError(RuntimeError):
    """Raised when adb is missing or a command fails."""


def find_adb() -> list[str] | None:
    """Return the argv prefix used to invoke adb, or None if not found."""
    override = os.environ.get("TETHER_ADB")
    if override:
        if override.lower().endswith(".py"):
            return [sys.executable, override]
        return [override]

    on_path = shutil.which("adb")
    if on_path:
        return [on_path]

    exe = "adb.exe" if os.name == "nt" else "adb"
    candidates = []
    for var in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        root = os.environ.get(var)
        if root:
            candidates.append(Path(root) / "platform-tools" / exe)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "Android" / "Sdk" / "platform-tools" / exe)
    home = Path.home()
    candidates.append(home / "Library" / "Android" / "sdk" / "platform-tools" / exe)
    candidates.append(home / "Android" / "Sdk" / "platform-tools" / exe)
    for candidate in candidates:
        if candidate.is_file():
            return [str(candidate)]
    from adb_setup import bundled_adb  # installed by the "Install adb" button

    bundled = bundled_adb()
    return [str(bundled)] if bundled else None


def escape_input_text(text: str) -> str:
    """Escape a string for `adb shell input text` (ASCII only)."""
    out = []
    for ch in text:
        if ord(ch) > 126 or (ord(ch) < 32 and ch != "\t"):
            raise AdbError(
                "adb `input text` only supports printable ASCII; "
                f"unsupported character {ch!r}"
            )
        if ch == " ":
            out.append("%s")
        elif ch == "\t":
            out.append("%s")
        elif ch in _SHELL_SPECIAL:
            out.append("\\" + ch)
        else:
            out.append(ch)
    return "".join(out)


def png_size(png: bytes) -> tuple[int, int]:
    """Read width/height from a PNG IHDR chunk."""
    if len(png) < 24 or png[:8] != b"\x89PNG\r\n\x1a\n":
        raise AdbError("device returned an invalid PNG frame")
    width, height = struct.unpack(">II", png[16:24])
    return width, height


def encode_png_rgb(width: int, height: int, rgb_rows: list[bytes], level: int = 6) -> bytes:
    """Encode 8-bit RGB rows (no filter) to PNG with the standard library."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + row for row in rgb_rows)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, level))
        + chunk(b"IEND", b"")
    )


def downscale_raw_rgba(raw: bytes, max_side: int) -> tuple[bytes, int, int, int, int, int]:
    """Convert `screencap` raw RGBA output to a downscaled PNG.

    Returns (png, device_w, device_h, image_w, image_h, factor).
    Nearest-neighbour sampling by an integer factor keeps it fast in pure Python.
    """
    if len(raw) < 12:
        raise AdbError("raw screencap too short")
    width, height = struct.unpack("<II", raw[:8])
    pixel_bytes = width * height * 4
    header = len(raw) - pixel_bytes
    if width <= 0 or height <= 0 or header not in (12, 16):
        raise AdbError("unrecognised raw screencap header")
    factor = max(1, math.ceil(max(width, height) / max(1, max_side)))
    stride = width * 4
    out_w = math.ceil(width / factor)
    rows = []
    step = 4 * factor
    for y in range(0, height, factor):
        start = header + y * stride
        row = raw[start:start + stride]
        sampled = bytearray(out_w * 3)
        sampled[0::3] = row[0::step]
        sampled[1::3] = row[1::step]
        sampled[2::3] = row[2::step]
        rows.append(bytes(sampled))
    png = encode_png_rgb(out_w, len(rows), rows, level=1)
    return png, width, height, out_w, len(rows), factor


def parse_ui_xml(xml_text: str) -> list[dict]:
    """Flatten a uiautomator XML dump into a list of element dicts."""
    start = xml_text.find("<?xml")
    if start < 0:
        start = xml_text.find("<hierarchy")
    end = xml_text.rfind("</hierarchy>")
    if start < 0 or end < 0:
        raise AdbError("could not read the UI hierarchy (is the screen locked or animating?)")
    root = ET.fromstring(xml_text[start:end + len("</hierarchy>")])
    elements = []
    for node in root.iter("node"):
        match = _BOUNDS_RE.match(node.get("bounds", ""))
        if not match:
            continue
        x1, y1, x2, y2 = (int(v) for v in match.groups())
        if x2 <= x1 or y2 <= y1:
            continue
        elements.append({
            "index": len(elements),
            "text": node.get("text", ""),
            "resource_id": node.get("resource-id", ""),
            "desc": node.get("content-desc", ""),
            "class": node.get("class", ""),
            "package": node.get("package", ""),
            "clickable": node.get("clickable") == "true",
            "enabled": node.get("enabled") == "true",
            "focused": node.get("focused") == "true",
            "checked": node.get("checked") == "true",
            "bounds": [x1, y1, x2, y2],
            "center": [(x1 + x2) // 2, (y1 + y2) // 2],
        })
    return elements


def find_element(elements: list[dict], text: str | None = None,
                 resource_id: str | None = None, desc: str | None = None) -> dict | None:
    """Find the best element matching text / resource id / content description.

    Exact matches win over case-insensitive substring matches; among equal
    matches a clickable element wins.
    """
    if not (text or resource_id or desc):
        raise AdbError("give at least one of text, resource_id or desc")

    def score(element: dict) -> int:
        total = 0
        for wanted, have in ((text, element["text"]), (desc, element["desc"])):
            if wanted is None:
                continue
            if have == wanted:
                total += 4
            elif wanted.lower() in have.lower():
                total += 2
            else:
                return -1
        if resource_id is not None:
            rid = element["resource_id"]
            if rid == resource_id or rid.endswith(":id/" + resource_id):
                total += 4
            else:
                return -1
        if element["clickable"]:
            total += 1
        return total

    best = None
    best_score = -1
    for element in elements:
        value = score(element)
        if value > best_score:
            best, best_score = element, value
    return best if best_score >= 0 else None


def parse_notifications(dump: str) -> list[dict]:
    """Active notifications from `dumpsys notification --noredact`.

    Works across Android versions by reading each NotificationRecord block's
    pkg / key and the android.title / android.text extras.
    """
    notifications = []
    seen = set()
    for block in dump.split("NotificationRecord(")[1:]:
        package = re.search(r"\bpkg=(\S+)", block)
        key = re.search(r"\bkey=(\S+?):\s*Notification", block) or re.search(r"\bkey=(\S+)", block)
        item = {
            "package": package.group(1) if package else "",
            "key": key.group(1) if key else "",
        }
        for field, pattern in _EXTRA_RE.items():
            match = pattern.search(block)
            item[field] = match.group(1) if match else ""
        identity = item["key"] or (item["package"], item["title"], item["text"])
        if identity in seen:
            continue
        seen.add(identity)
        notifications.append(item)
    return notifications


def find_notification(notifications: list[dict], title: str | None = None, text: str | None = None,
                      package: str | None = None) -> dict | None:
    """Case-insensitive 'contains' match on title / text (+ exact package)."""
    if not (title or text):
        raise AdbError("give a notification title or text to look for")
    for item in notifications:
        if package and item["package"] != package:
            continue
        if title and title.lower() not in item["title"].lower():
            continue
        body = f"{item['text']} {item['big_text']}".lower()
        if text and text.lower() not in body:
            continue
        return item
    return None


class Adb:
    """adb command runner with small conveniences and short-lived caches."""

    def __init__(self, argv: list[str] | None = None, timeout: float = 20.0):
        self.argv = argv if argv is not None else find_adb()
        self.timeout = timeout
        self._size_cache: dict[str, tuple[float, tuple[int, int]]] = {}
        self._lock = threading.Lock()

    # ---------------------------------------------------------------- basics
    @property
    def available(self) -> bool:
        return bool(self.argv)

    def refresh(self) -> bool:
        """Look for adb again (e.g. right after the one-click install)."""
        self.argv = find_adb()
        return self.available

    def run(self, args: list[str], serial: str | None = None,
            timeout: float | None = None, check: bool = True) -> bytes:
        if not self.argv:
            raise AdbError(
                "adb not found. Install Android platform-tools "
                "(https://developer.android.com/tools/releases/platform-tools) "
                "or set TETHER_ADB to the adb executable."
            )
        cmd = list(self.argv)
        if serial:
            cmd += ["-s", serial]
        cmd += args
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout or self.timeout,
                creationflags=flags,
            )
        except subprocess.TimeoutExpired as exc:
            raise AdbError(f"adb timed out: {' '.join(args)}") from exc
        except OSError as exc:
            raise AdbError(f"could not start adb: {exc}") from exc
        if check and proc.returncode != 0:
            message = (proc.stderr or proc.stdout).decode("utf-8", "replace").strip()
            raise AdbError(message or f"adb exited with code {proc.returncode}")
        return proc.stdout

    def shell(self, serial: str, *args: str, timeout: float | None = None) -> str:
        out = self.run(["shell", *args], serial=serial, timeout=timeout)
        return out.decode("utf-8", "replace")

    def version(self) -> str:
        first = self.run(["version"]).decode("utf-8", "replace").splitlines()
        return first[0] if first else "unknown"

    def devices(self) -> list[dict]:
        out = self.run(["devices", "-l"]).decode("utf-8", "replace")
        devices = []
        for line in out.splitlines():
            line = line.strip()
            if not line or line.startswith("List of devices") or line.startswith("*"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            info = {"serial": parts[0], "state": parts[1]}
            for token in parts[2:]:
                if ":" in token:
                    key, value = token.split(":", 1)
                    info[key] = value
            info["label"] = (info.get("model") or info["serial"]).replace("_", " ")
            info["emulator"] = info["serial"].startswith("emulator-")
            devices.append(info)
        return devices

    # ---------------------------------------------------------------- screen
    def screencap_png(self, serial: str) -> bytes:
        png = self.run(["exec-out", "screencap", "-p"], serial=serial, timeout=15)
        png_size(png)
        return png

    def screenshot_scaled(self, serial: str, max_side: int = 1024) -> dict:
        """Small PNG for LLM agents: raw capture, downscaled on the host."""
        try:
            raw = self.run(["exec-out", "screencap"], serial=serial, timeout=20)
            png, dev_w, dev_h, img_w, img_h, factor = downscale_raw_rgba(raw, max_side)
        except AdbError:
            png = self.screencap_png(serial)
            dev_w, dev_h = png_size(png)
            img_w, img_h, factor = dev_w, dev_h, 1
        self._remember_size(serial, (dev_w, dev_h))
        return {
            "png": png,
            "device_size": [dev_w, dev_h],
            "image_size": [img_w, img_h],
            "factor": factor,
        }

    def _remember_size(self, serial: str, size: tuple[int, int]) -> None:
        with self._lock:
            self._size_cache[serial] = (time.monotonic(), size)

    def display_size(self, serial: str, max_age: float = 2.0) -> tuple[int, int]:
        """Current (rotation-aware) display size in pixels."""
        with self._lock:
            cached = self._size_cache.get(serial)
        if cached and time.monotonic() - cached[0] < max_age:
            return cached[1]
        size = None
        try:
            displays = self.shell(serial, "dumpsys", "window", "displays")
            match = _CUR_SIZE_RE.search(displays)
            if match:
                size = (int(match.group(1)), int(match.group(2)))
        except AdbError:
            size = None
        if size is None:
            size = png_size(self.screencap_png(serial))
        self._remember_size(serial, size)
        return size

    # ----------------------------------------------------------------- input
    def tap(self, serial: str, x: int, y: int) -> None:
        self.shell(serial, "input", "tap", str(int(x)), str(int(y)))

    def swipe(self, serial: str, x1: int, y1: int, x2: int, y2: int, duration_ms: int = 300) -> None:
        self.shell(
            serial, "input", "swipe",
            str(int(x1)), str(int(y1)), str(int(x2)), str(int(y2)),
            str(max(1, int(duration_ms))),
        )

    def long_press(self, serial: str, x: int, y: int, duration_ms: int = 700) -> None:
        self.swipe(serial, x, y, x, y, duration_ms)

    def key(self, serial: str, key: str | int) -> None:
        if isinstance(key, int) or str(key).isdigit():
            code = int(key)
        else:
            name = str(key).lower().replace(" ", "_")
            if name not in KEYCODES:
                raise AdbError(f"unknown key {key!r}; known: {', '.join(sorted(KEYCODES))}")
            code = KEYCODES[name]
        self.shell(serial, "input", "keyevent", str(code))

    def text(self, serial: str, text: str) -> None:
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if line:
                self.shell(serial, "input", "text", escape_input_text(line))
            if i < len(lines) - 1:
                self.key(serial, "enter")

    # -------------------------------------------------------------- UI tree
    def ui_elements(self, serial: str) -> list[dict]:
        self.shell(serial, "uiautomator", "dump", UI_DUMP_PATH, timeout=30)
        xml_bytes = self.run(["exec-out", "cat", UI_DUMP_PATH], serial=serial)
        return parse_ui_xml(xml_bytes.decode("utf-8", "replace"))

    # ------------------------------------------------------------------ apps
    def packages(self, serial: str, third_party: bool = True) -> list[str]:
        args = ["pm", "list", "packages"] + (["-3"] if third_party else [])
        out = self.shell(serial, *args)
        return sorted(
            line.split(":", 1)[1].strip()
            for line in out.splitlines()
            if line.startswith("package:")
        )

    def launch(self, serial: str, package: str) -> str:
        _check_package(package)
        out = self.shell(
            serial, "monkey", "-p", package,
            "-c", "android.intent.category.LAUNCHER", "1",
        )
        if "No activities found" in out or "monkey aborted" in out:
            raise AdbError(f"could not launch {package}: no launcher activity")
        return out.strip()

    def stop(self, serial: str, package: str) -> None:
        _check_package(package)
        self.shell(serial, "am", "force-stop", package)

    def clear_data(self, serial: str, package: str) -> str:
        _check_package(package)
        return self.shell(serial, "pm", "clear", package).strip()

    def install(self, serial: str, apk_path: str) -> str:
        out = self.run(["install", "-r", apk_path], serial=serial, timeout=300)
        text = out.decode("utf-8", "replace").strip()
        if "Success" not in text:
            raise AdbError(text or "install failed")
        return text

    def foreground(self, serial: str) -> str | None:
        out = self.shell(serial, "dumpsys", "window")
        match = _FOCUS_RE.search(out)
        return match.group(1) if match else None

    # --------------------------------------------------------- notifications
    def notifications(self, serial: str) -> list[dict]:
        return parse_notifications(self.shell(serial, "dumpsys", "notification", "--noredact", timeout=20))

    def expand_notifications(self, serial: str) -> None:
        self.shell(serial, "cmd", "statusbar", "expand-notifications")

    def collapse_notifications(self, serial: str) -> None:
        self.shell(serial, "cmd", "statusbar", "collapse")

    # -------------------------------------------------- wireless + networking
    def pair(self, host_port: str, code: str) -> str:
        """Android 11+ wireless debugging: Settings → Developer options → Wireless debugging → Pair."""
        _check_host_port(host_port)
        if not re.fullmatch(r"\d{6}", code or ""):
            raise AdbError("the pairing code is the 6-digit number shown on the phone")
        out = self.run(["pair", host_port, code], timeout=30).decode("utf-8", "replace").strip()
        if "Successfully paired" not in out:
            raise AdbError(out or "pairing failed")
        return out

    def connect(self, host_port: str) -> str:
        _check_host_port(host_port)
        out = self.run(["connect", host_port], timeout=20).decode("utf-8", "replace").strip()
        if "connected to" not in out:
            raise AdbError(out or "connect failed")
        return out

    def reverse(self, serial: str, port: int) -> None:
        """Make the phone's localhost:<port> reach this computer's <port> (USB or Wi-Fi adb)."""
        port = int(port)
        if not 1 <= port <= 65535:
            raise AdbError("invalid port")
        self.run(["reverse", f"tcp:{port}", f"tcp:{port}"], serial=serial)

    def open_url(self, serial: str, url: str, package: str | None = None) -> str:
        if not re.fullmatch(r"https?://[^\s'\"]+", url or ""):
            raise AdbError("only plain http(s) URLs can be opened")
        args = ["am", "start", "-a", "android.intent.action.VIEW", "-d", "'" + url + "'"]
        if package:
            _check_package(package)
            args += ["-p", package]
        out = self.shell(serial, *args)
        if "Error" in out:
            raise AdbError(out.strip())
        return out.strip()

    def logcat(self, serial: str, lines: int = 200, package: str | None = None) -> str:
        args = ["logcat", "-d", "-v", "time", "-t", str(max(1, min(int(lines), 5000)))]
        if package:
            _check_package(package)
            pid = self.shell(serial, "pidof", package).strip().split()
            if not pid:
                return f"({package} is not running)"
            args.insert(1, f"--pid={pid[0]}")
        return self.run(args, serial=serial).decode("utf-8", "replace")


def _check_host_port(host_port: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9.\-]+:\d{2,5}", host_port or ""):
        raise AdbError("use the IP:port shown on the phone, e.g. 192.168.1.23:37155")


def _check_package(package: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+", package or ""):
        raise AdbError(f"invalid package name {package!r}")
