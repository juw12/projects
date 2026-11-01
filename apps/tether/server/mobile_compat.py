"""mobile-mcp compatible tools for Tether's MCP server (Android only).

mobile-next/mobile-mcp (Apache-2.0) is the most used mobile MCP server; agents,
prompts and skills written for it call tools such as
`mobile_list_elements_on_screen` and `mobile_click_on_screen_at_coordinates`.
Tether exposes the same names and argument shapes (from mobile-mcp's
src/server.ts, Nov 2026) so those prompts work unchanged against Tether, with
plain adb and no Node/WebDriverAgent install.

Differences, by design:
  * Android only (no iOS / remote cloud fleet tools).
  * mobile_get_device_logs returns the newest buffered entries that match
    instead of waiting for new ones (trigger the behaviour first, then call).
  * mobile_set_location works on emulators (adb emu geo fix).
  * mobile_clipboard goes through scrcpy's control channel (installed by the
    HD button / POST /api/setup/scrcpy), since adb cannot reach the clipboard.

Coordinates are device screen pixels, like mobile-mcp.
"""

from __future__ import annotations

import base64
import json
import os
import re
import tempfile
import time
from pathlib import Path

from adb import (AdbError, KEYCODES, ScreenRecorder, log_entry_matches, parse_log_filters)

DEVICE = {
    "type": "string",
    "description": "The device identifier to use. Use mobile_list_available_devices to find which devices are available to you.",
}

BUTTONS = {
    "HOME": KEYCODES["home"],
    "BACK": KEYCODES["back"],
    "VOLUME_UP": KEYCODES["volume_up"],
    "VOLUME_DOWN": KEYCODES["volume_down"],
    "ENTER": KEYCODES["enter"],
    "BACKSPACE": KEYCODES["delete"],
    "APP_SWITCH": KEYCODES["recents"],
    "POWER": KEYCODES["power"],
    "DPAD_CENTER": KEYCODES["dpad_center"],
    "DPAD_UP": KEYCODES["up"],
    "DPAD_DOWN": KEYCODES["down"],
    "DPAD_LEFT": KEYCODES["left"],
    "DPAD_RIGHT": KEYCODES["right"],
}

DEFAULT_SCREENSHOT_MAX_SIZE = 1024
LOG_EXTENSIONS = (".log", ".txt", ".jsonl")


def _obj(properties: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": False}


def _device_only(description_suffix: str = "") -> dict:
    return _obj({"device": DEVICE}, ["device"])


XY_REF = {
    "device": DEVICE,
    "x": {"type": "number", "minimum": 0, "description": "X in screen pixels. Required unless ref is given"},
    "y": {"type": "number", "minimum": 0, "description": "Y in screen pixels. Required unless ref is given"},
    "ref": {"type": "string", "description": "Element ref from mobile_list_elements_on_screen, e.g. \"@e5\". Takes precedence over x,y"},
}

MOBILE_TOOLS = [
    {
        "name": "mobile_list_available_devices",
        "description": "List all available Android devices and emulators connected to this machine (mobile-mcp compatible).",
        "inputSchema": _obj({}, []),
    },
    {
        "name": "mobile_list_apps",
        "description": "List all the installed apps on the device",
        "inputSchema": _device_only(),
    },
    {
        "name": "mobile_get_foreground_app",
        "description": "Get the app currently in the foreground on the device, including the focused activity class.",
        "inputSchema": _device_only(),
    },
    {
        "name": "mobile_launch_app",
        "description": "Launch an app on mobile device. Find the package name with mobile_list_apps.",
        "inputSchema": _obj({
            "device": DEVICE,
            "packageName": {"type": "string", "description": "The package name of the app to launch"},
            "locale": {"type": "string", "description": "Comma-separated BCP 47 locale tags (e.g. fr-FR,en-GB); Android 13+"},
        }, ["device", "packageName"]),
    },
    {
        "name": "mobile_terminate_app",
        "description": "Stop and terminate an app on mobile device",
        "inputSchema": _obj({"device": DEVICE, "packageName": {"type": "string"}}, ["device", "packageName"]),
    },
    {
        "name": "mobile_clear_app_data",
        "description": "Clear an app's data (cache, preferences, databases) and stop it, so the next launch starts fresh. The app stays installed.",
        "inputSchema": _obj({"device": DEVICE, "packageName": {"type": "string"}}, ["device", "packageName"]),
    },
    {
        "name": "mobile_install_app",
        "description": "Install an app on mobile device (path to an .apk on this computer)",
        "inputSchema": _obj({"device": DEVICE, "path": {"type": "string"}}, ["device", "path"]),
    },
    {
        "name": "mobile_uninstall_app",
        "description": "Uninstall an app from mobile device",
        "inputSchema": _obj({"device": DEVICE, "packageName": {"type": "string"}}, ["device", "packageName"]),
    },
    {
        "name": "mobile_get_screen_size",
        "description": "Get the screen size of the mobile device in pixels",
        "inputSchema": _device_only(),
    },
    {
        "name": "mobile_click_on_screen_at_coordinates",
        "description": "Click on the screen, either at x,y coordinates or on an element by its ref (e.g. \"@e5\") from the latest mobile_list_elements_on_screen result. Prefer ref when the element is listed.",
        "inputSchema": _obj(dict(XY_REF), ["device"]),
    },
    {
        "name": "mobile_double_tap_on_screen",
        "description": "Double-tap on the screen at x,y or on an element ref from mobile_list_elements_on_screen.",
        "inputSchema": _obj(dict(XY_REF), ["device"]),
    },
    {
        "name": "mobile_long_press_on_screen_at_coordinates",
        "description": "Long press on the screen at x,y or on an element ref from mobile_list_elements_on_screen.",
        "inputSchema": _obj({**XY_REF, "duration": {"type": "number", "minimum": 1, "maximum": 10000,
                                                   "description": "Press duration in milliseconds (default 700)"}},
                            ["device"]),
    },
    {
        "name": "mobile_list_elements_on_screen",
        "description": (
            "List elements on screen with their ref, coordinates, and display text or accessibility label. "
            "Use the ref with mobile_click_on_screen_at_coordinates, mobile_double_tap_on_screen or "
            "mobile_long_press_on_screen_at_coordinates. Re-list only after navigation or a layout change."
        ),
        "inputSchema": _obj({"device": DEVICE, "format": {"type": "string", "enum": ["text", "json"]}}, ["device"]),
    },
    {
        "name": "mobile_press_button",
        "description": "Press a button on device: " + ", ".join(BUTTONS),
        "inputSchema": _obj({"device": DEVICE, "button": {"type": "string", "description": "Upper case, e.g. HOME"}},
                            ["device", "button"]),
    },
    {
        "name": "mobile_open_url",
        "description": "Open an http:// or https:// URL in the browser on device.",
        "inputSchema": _obj({"device": DEVICE, "url": {"type": "string"}}, ["device", "url"]),
    },
    {
        "name": "mobile_swipe_on_screen",
        "description": "Swipe on the screen (finger moves in the given direction). Starts at x,y or the screen centre.",
        "inputSchema": _obj({
            "device": DEVICE,
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
            "x": {"type": "number", "minimum": 0},
            "y": {"type": "number", "minimum": 0},
            "distance": {"type": "number", "minimum": 1, "description": "Pixels; default 30% of the screen dimension"},
        }, ["device", "direction"]),
    },
    {
        "name": "mobile_type_keys",
        "description": "Type text into the focused element",
        "inputSchema": _obj({
            "device": DEVICE,
            "text": {"type": "string"},
            "submit": {"type": "boolean", "description": "Press Enter afterwards. Defaults to false"},
        }, ["device", "text"]),
    },
    {
        "name": "mobile_take_screenshot",
        "description": (
            "Take a screenshot of the mobile device. Prefer mobile_list_elements_on_screen for tapping. "
            "The reply states how to convert screenshot positions into screen coordinates."
        ),
        "inputSchema": _obj({
            "device": DEVICE,
            "maxSize": {"type": "integer", "minimum": 1, "description": f"Max width/height, default {DEFAULT_SCREENSHOT_MAX_SIZE}"},
            "scale": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
        }, ["device"]),
    },
    {
        "name": "mobile_save_screenshot",
        "description": "Save a screenshot of the mobile device to a .png file",
        "inputSchema": _obj({
            "device": DEVICE,
            "saveTo": {"type": "string"},
            "maxSize": {"type": "integer", "minimum": 1},
            "scale": {"type": "number", "exclusiveMinimum": 0, "maximum": 1},
        }, ["device", "saveTo"]),
    },
    {
        "name": "mobile_set_orientation",
        "description": "Change the screen orientation of the device (turns auto-rotate off)",
        "inputSchema": _obj({"device": DEVICE, "orientation": {"type": "string", "enum": ["portrait", "landscape"]}},
                            ["device", "orientation"]),
    },
    {
        "name": "mobile_get_orientation",
        "description": "Get the current screen orientation of the device",
        "inputSchema": _device_only(),
    },
    {
        "name": "mobile_set_location",
        "description": "Set the GPS location of an Android emulator (adb emu geo fix).",
        "inputSchema": _obj({
            "device": DEVICE,
            "latitude": {"type": "number", "minimum": -90, "maximum": 90},
            "longitude": {"type": "number", "minimum": -180, "maximum": 180},
        }, ["device"]),
    },
    {
        "name": "mobile_clipboard",
        "description": "Read or replace the device clipboard (via scrcpy). Pass text to set it, omit it to read.",
        "inputSchema": _obj({"device": DEVICE, "text": {"type": "string"}}, ["device"]),
    },
    {
        "name": "mobile_get_device_logs",
        "description": (
            "Recent device log entries (logcat) as one JSON object per line, newest last. Filters are ANDed: "
            "key=value includes, key!=value excludes; keys pid, process, tag, level, message. "
            "Example: [\"process=com.demo.app\", \"level=Error\"]. Pass saveTo for large captures."
        ),
        "inputSchema": _obj({
            "device": DEVICE,
            "limit": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 100},
            "filter": {"type": "array", "items": {"type": "string"}, "default": []},
            "saveTo": {"type": "string", "description": "Write to a .log, .txt or .jsonl file instead"},
        }, ["device"]),
    },
    {
        "name": "mobile_start_screen_recording",
        "description": "Start recording the screen (adb screenrecord, max 180 s). Stop with mobile_stop_screen_recording.",
        "inputSchema": _obj({
            "device": DEVICE,
            "output": {"type": "string", "description": "Path ending in .mp4 (default: a temp file)"},
            "timeLimit": {"type": "number", "description": "Seconds, 1-180"},
        }, ["device"]),
    },
    {
        "name": "mobile_stop_screen_recording",
        "description": "Stop the active screen recording; returns the file path, size and approximate duration.",
        "inputSchema": _device_only(),
    },
    {
        "name": "mobile_list_crashes",
        "description": "List crash reports on the device (Java and native crashes from the logcat crash buffer)",
        "inputSchema": _device_only(),
    },
    {
        "name": "mobile_get_crash",
        "description": "Get the full content of a crash report by its ID (from mobile_list_crashes).",
        "inputSchema": _obj({"device": DEVICE, "id": {"type": "string"}}, ["device", "id"]),
    },
    {
        "name": "mobile_batch_commands",
        "description": (
            "Run multiple mobile_* tools in sequence in one call (e.g. click, type, click). The device argument "
            "applies to every step unless a step sets its own. mobile_take_screenshot cannot be batched."
        ),
        "inputSchema": _obj({
            "device": DEVICE,
            "steps": {
                "type": "array",
                "minItems": 1,
                "items": _obj({"name": {"type": "string"}, "arguments": {"type": "object"}}, ["name"]),
            },
            "stopOnError": {"type": "boolean", "description": "Defaults to true"},
            "listElementsAtEnd": {"type": "boolean", "description": "Defaults to false"},
        }, ["device", "steps"]),
    },
]

MOBILE_TOOL_NAMES = {tool["name"] for tool in MOBILE_TOOLS}


def _check_output_path(path: str, extensions: tuple[str, ...], what: str) -> Path:
    if not path:
        raise ValueError(f"{what}: a file path is required")
    target = Path(path).expanduser()
    if target.suffix.lower() not in extensions:
        raise ValueError(f"{what}: filename must end with {', '.join(extensions)}")
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


class MobileMcpTools:
    """Mixin for TetherTools: needs self.adb, self._serial(args), self._text(), self.scale."""

    hd_manager = None  # a scrcpy.SessionManager when running inside the web server

    # ---------------------------------------------------------------- helpers
    def _mobile_state(self) -> dict:
        if not hasattr(self, "_mobile"):
            self._mobile = {"refs": {}, "recorder": ScreenRecorder(self.adb)}
        return self._mobile

    def _point(self, serial: str, args: dict) -> tuple[int, int, str]:
        ref = args.get("ref")
        if ref:
            key = "@" + str(ref).lstrip("@")
            refs = self._mobile_state()["refs"].get(serial, {})
            if key not in refs:
                raise ValueError(f"unknown ref {ref}; call mobile_list_elements_on_screen again")
            x, y, label = refs[key]
            return x, y, f"element {key}" + (f" ({label})" if label else "")
        if args.get("x") is None or args.get("y") is None:
            raise ValueError("Either ref or both x and y must be provided")
        x, y = round(float(args["x"])), round(float(args["y"]))
        if x < 0 or y < 0:
            raise ValueError("coordinates must be >= 0")
        return x, y, f"coordinates: {x}, {y}"

    # ------------------------------------------------------------------ tools
    def tool_mobile_list_available_devices(self, args):
        devices = []
        for d in self.adb.devices():
            entry = {
                "id": d["serial"],
                "name": d.get("label", d["serial"]),
                "platform": "android",
                "type": "emulator" if d.get("emulator") else "real",
                "state": "online" if d["state"] == "device" else d["state"],
            }
            if d["state"] == "device":
                entry["version"] = self.adb.android_version(d["serial"])
            devices.append(entry)
        return self._text({"devices": devices})

    def tool_mobile_list_apps(self, args):
        serial = self._serial(args)
        packages = self.adb.packages(serial)
        return self._text("Found these apps on device: " + ", ".join(f"{p} ({p})" for p in packages))

    def tool_mobile_get_foreground_app(self, args):
        serial = self._serial(args)
        focus = self.adb.foreground(serial)
        if not focus:
            return self._text({"packageName": None, "activity": None})
        package, _, activity = focus.partition("/")
        if activity.startswith("."):
            activity = package + activity
        return self._text({"packageName": package, "activity": activity or None})

    def tool_mobile_launch_app(self, args):
        serial = self._serial(args)
        package = args["packageName"]
        if args.get("locale"):
            self.adb.set_app_locale(serial, package, args["locale"])
        self.adb.launch(serial, package)
        return self._text(f"Launched app {package}" + (f" with locale {args['locale']}" if args.get("locale") else ""))

    def tool_mobile_terminate_app(self, args):
        serial = self._serial(args)
        self.adb.stop(serial, args["packageName"])
        return self._text(f"Terminated app {args['packageName']}")

    def tool_mobile_clear_app_data(self, args):
        serial = self._serial(args)
        out = self.adb.clear_data(serial, args["packageName"])
        if "Success" not in out:
            raise AdbError(out or "could not clear app data")
        return self._text(f"Cleared app data for {args['packageName']}")

    def tool_mobile_install_app(self, args):
        serial = self._serial(args)
        path = Path(args["path"]).expanduser()
        if not path.is_file() or path.suffix.lower() != ".apk":
            raise AdbError(f"provide an existing .apk file (got {path})")
        self.adb.install(serial, str(path))
        return self._text(f"Installed app from {path}")

    def tool_mobile_uninstall_app(self, args):
        serial = self._serial(args)
        self.adb.uninstall(serial, args["packageName"])
        return self._text(f"Uninstalled app {args['packageName']}")

    def tool_mobile_get_screen_size(self, args):
        serial = self._serial(args)
        width, height = self.adb.display_size(serial, max_age=0)
        return self._text(f"Screen size is {width}x{height} pixels")

    def tool_mobile_click_on_screen_at_coordinates(self, args):
        serial = self._serial(args)
        x, y, label = self._point(serial, args)
        self.adb.tap(serial, x, y)
        return self._text(f"Clicked on {label}")

    def tool_mobile_double_tap_on_screen(self, args):
        serial = self._serial(args)
        x, y, label = self._point(serial, args)
        # one remote shell line keeps both taps inside Android's double-tap window
        self.adb.shell(serial, "input", "tap", str(x), str(y), "&&", "input", "tap", str(x), str(y))
        return self._text(f"Double-tapped on {label}")

    def tool_mobile_long_press_on_screen_at_coordinates(self, args):
        serial = self._serial(args)
        x, y, label = self._point(serial, args)
        self.adb.long_press(serial, x, y, int(args.get("duration") or 700))
        return self._text(f"Long pressed on {label}")

    def tool_mobile_list_elements_on_screen(self, args):
        serial = self._serial(args)
        elements = [
            e for e in self.adb.ui_elements(serial)
            if (e["text"] or e["desc"] or e["clickable"] or e["focused"]) and e["bounds"][2] > e["bounds"][0]
        ]
        refs = {}
        rows = []
        for number, e in enumerate(elements, start=1):
            ref = f"@e{number}"
            left, top, right, bottom = e["bounds"]
            label = e["text"] or e["desc"]
            refs[ref] = (e["center"][0], e["center"][1], label)
            rows.append({
                "ref": ref,
                "type": e["class"].rsplit(".", 1)[-1],
                "text": e["text"] or None,
                "label": e["desc"] or None,
                "identifier": e["resource_id"] or None,
                "rect": {"x": left, "y": top, "width": right - left, "height": bottom - top},
                "clickable": e["clickable"] or None,
                "focused": e["focused"] or None,
            })
        self._mobile_state()["refs"][serial] = refs
        if args.get("format") == "json":
            return self._text([{k: v for k, v in row.items() if v is not None} for row in rows])
        lines = []
        for row in rows:
            parts = [row["ref"], row["type"]]
            if row["text"]:
                parts.append(json.dumps(row["text"], ensure_ascii=False))
            if row["label"] and row["label"] != row["text"]:
                parts.append("label=" + json.dumps(row["label"], ensure_ascii=False))
            if row["identifier"]:
                parts.append("id=" + row["identifier"].split(":id/")[-1])
            r = row["rect"]
            parts.append(f"at ({r['x'] + r['width'] // 2},{r['y'] + r['height'] // 2}) size {r['width']}x{r['height']}")
            if row["focused"]:
                parts.append("focused")
            lines.append(" ".join(parts))
        return self._text("\n".join(lines) if lines else "No elements found on screen")

    def tool_mobile_press_button(self, args):
        serial = self._serial(args)
        button = str(args["button"]).upper()
        if button not in BUTTONS:
            raise ValueError(f"unsupported button {args['button']!r}; use one of {', '.join(BUTTONS)}")
        self.adb.key(serial, BUTTONS[button])
        return self._text(f"Pressed the button: {button}")

    def tool_mobile_open_url(self, args):
        serial = self._serial(args)
        url = args["url"]
        if not re.match(r"https?://", url or ""):
            raise ValueError("only http:// and https:// URLs can be opened")
        self.adb.open_url(serial, url)
        return self._text(f"Opened URL: {url}")

    def tool_mobile_swipe_on_screen(self, args):
        serial = self._serial(args)
        direction = args["direction"]
        if direction not in ("up", "down", "left", "right"):
            raise ValueError("direction must be up, down, left or right")
        if (args.get("x") is None) != (args.get("y") is None):
            raise ValueError("Provide both x and y to start the swipe from a point, or neither")
        width, height = self.adb.display_size(serial)
        x1 = round(float(args["x"])) if args.get("x") is not None else width // 2
        y1 = round(float(args["y"])) if args.get("y") is not None else height // 2
        span = height if direction in ("up", "down") else width
        distance = round(float(args.get("distance") or span * 0.3))
        dx = {"left": -distance, "right": distance}.get(direction, 0)
        dy = {"up": -distance, "down": distance}.get(direction, 0)
        x2 = min(max(x1 + dx, 0), width - 1)
        y2 = min(max(y1 + dy, 0), height - 1)
        self.adb.swipe(serial, x1, y1, x2, y2, 400)
        return self._text(f"Swiped {direction} from ({x1}, {y1}) to ({x2}, {y2})")

    def tool_mobile_type_keys(self, args):
        serial = self._serial(args)
        self.adb.text(serial, args["text"])
        if args.get("submit"):
            self.adb.key(serial, "enter")
        return self._text(f"Typed text: {args['text']}" + (" and submitted" if args.get("submit") else ""))

    def _screenshot_side(self, serial: str, args: dict) -> int | None:
        if args.get("maxSize"):
            return int(args["maxSize"])
        if args.get("scale"):
            scale = float(args["scale"])
            if not 0 < scale <= 1:
                raise ValueError("scale must be in (0, 1]")
            return max(1, round(max(self.adb.display_size(serial)) * scale))
        return None

    def tool_mobile_take_screenshot(self, args):
        serial = self._serial(args)
        side = self._screenshot_side(serial, args) or DEFAULT_SCREENSHOT_MAX_SIZE
        shot = self.adb.screenshot_scaled(serial, max(64, side))
        self.scale[serial] = shot["factor"]
        img_w, img_h = shot["image_size"]
        dev_w, dev_h = shot["device_size"]
        note = (f"Screenshot is {img_w}x{img_h}; the screen is {dev_w}x{dev_h} pixels. Multiply screenshot "
                f"positions by {dev_w / img_w:.3g} to get screen coordinates for tapping.")
        return [
            {"type": "text", "text": note},
            {"type": "image", "data": base64.b64encode(shot["png"]).decode("ascii"), "mimeType": "image/png"},
        ]

    def tool_mobile_save_screenshot(self, args):
        serial = self._serial(args)
        save_to = str(args.get("saveTo") or "")
        if save_to.lower().endswith((".jpg", ".jpeg")):
            raise ValueError("This device only supports png screenshots, save to a .png file instead.")
        target = _check_output_path(save_to, (".png",), "save_screenshot")
        side = self._screenshot_side(serial, args)
        png = self.adb.screenshot_scaled(serial, side)["png"] if side else self.adb.screencap_png(serial)
        target.write_bytes(png)
        return self._text(f"Screenshot saved to: {target}")

    def tool_mobile_set_orientation(self, args):
        serial = self._serial(args)
        self.adb.set_orientation(serial, args["orientation"])
        return self._text(f"Changed device orientation to {args['orientation']}")

    def tool_mobile_get_orientation(self, args):
        serial = self._serial(args)
        return self._text(f"Current device orientation is {self.adb.orientation(serial)}")

    def tool_mobile_set_location(self, args):
        serial = self._serial(args)
        latitude, longitude = args.get("latitude"), args.get("longitude")
        if latitude is None and longitude is None:
            return self._text("Emulators keep the last GPS fix; set a new location instead of clearing it.")
        if latitude is None or longitude is None:
            raise ValueError("give both latitude and longitude (or neither)")
        self.adb.set_location(serial, latitude, longitude)
        return self._text(f"Location set to {float(latitude):.6f}, {float(longitude):.6f}")

    def tool_mobile_clipboard(self, args):
        import scrcpy

        serial = self._serial(args)
        if scrcpy.server_path() is None:
            raise AdbError("the clipboard needs the scrcpy server: click HD once in Tether, or "
                           "POST /api/setup/scrcpy, then try again")
        try:
            value = scrcpy.clipboard(self.adb, serial, args.get("text"), self.hd_manager)
        except scrcpy.ScrcpyError as exc:
            raise AdbError(str(exc)) from exc
        return self._text("Clipboard updated" if "text" in args and args["text"] is not None else value)

    def tool_mobile_get_device_logs(self, args):
        serial = self._serial(args)
        limit = max(1, min(int(args.get("limit") or 100), 5000))
        filters = parse_log_filters(args.get("filter"))
        process_pids = {value: self.adb.pids_of(serial, value) for key, _inc, value in filters if key == "process"}
        entries = self.adb.log_entries(serial, lines=max(2000, limit * 20))
        matched = [e for e in entries if log_entry_matches(e, filters, process_pids)][-limit:]
        lines = "\n".join(json.dumps(e, ensure_ascii=False) for e in matched)
        if args.get("saveTo"):
            target = _check_output_path(args["saveTo"], LOG_EXTENSIONS, "get_device_logs")
            target.write_text(lines + ("\n" if lines else ""), encoding="utf-8")
            return self._text(f"Saved {len(matched)} log entries to: {target}")
        return self._text(lines or "No log entries received")

    def tool_mobile_start_screen_recording(self, args):
        serial = self._serial(args)
        output = args.get("output") or os.path.join(tempfile.gettempdir(), f"tether-recording-{int(time.time())}.mp4")
        _check_output_path(output, (".mp4",), "start_screen_recording")
        limit = args.get("timeLimit")
        self._mobile_state()["recorder"].start(serial, output, int(limit) if limit else None)
        return self._text(f"Screen recording started. Output will be saved to: {output}")

    def tool_mobile_stop_screen_recording(self, args):
        serial = self._serial(args)
        result = self._mobile_state()["recorder"].stop(serial)
        return self._text(f"Recording stopped. File: {result['path']}, size: {result['size']} bytes, "
                          f"duration: ~{result['duration']}s")

    def tool_mobile_list_crashes(self, args):
        serial = self._serial(args)
        crashes = self.adb.crashes(serial)
        slim = [{k: c[k] for k in ("id", "time", "process", "pid", "type", "summary")} for c in crashes]
        return self._text(slim if slim else "No crash reports found")

    def tool_mobile_get_crash(self, args):
        serial = self._serial(args)
        for crash in self.adb.crashes(serial):
            if crash["id"] == args["id"]:
                return self._text(crash["text"])
        raise ValueError(f"no crash with id {args['id']!r}; call mobile_list_crashes")

    def tool_mobile_batch_commands(self, args):
        device = args.get("device")
        steps = args.get("steps") or []
        if not isinstance(steps, list) or not steps:
            raise ValueError("steps must be a non-empty list")
        stop_on_error = args.get("stopOnError", True)
        results = []
        for index, step in enumerate(steps, start=1):
            name = step.get("name") if isinstance(step, dict) else None
            try:
                if name == "mobile_batch_commands":
                    raise ValueError("mobile_batch_commands cannot be nested")
                if name == "mobile_take_screenshot":
                    raise ValueError("mobile_take_screenshot returns an image and cannot be used in a batch, "
                                     "use mobile_save_screenshot instead")
                if name not in MOBILE_TOOL_NAMES:
                    raise ValueError(f"Unknown tool {name!r}")
                step_args = {"device": device, **(step.get("arguments") or {})}
                content = getattr(self, "tool_" + name)(step_args)
                output = " ".join(part.get("text", "") for part in content if part.get("type") == "text")
                results.append(f"Step {index} ({name}): {output}")
            except (AdbError, ValueError, TypeError, KeyError) as exc:
                results.append(f"Step {index} ({name}) failed: {exc}")
                if stop_on_error:
                    break
        if args.get("listElementsAtEnd"):
            content = self.tool_mobile_list_elements_on_screen({"device": device})
            results.append(content[0]["text"])
        return self._text("\n".join(results))
