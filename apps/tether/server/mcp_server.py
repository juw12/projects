"""Tether MCP server — lets AI agents see and drive Android devices.

Speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0)
with the Python standard library only. Register it in your MCP client, e.g.

  {
    "mcpServers": {
      "tether": {
        "command": "python",
        "args": ["C:/path/to/apps/tether/server/mcp_server.py"]
      }
    }
  }

Typical agent loop: screenshot -> ui_elements -> tap_element / tap -> screenshot.

It also serves mobile-mcp compatible tools (mobile_list_elements_on_screen,
mobile_click_on_screen_at_coordinates, ... see mobile_compat.py), so prompts and
skills written for mobile-next/mobile-mcp work unchanged. Pick the tool set with
`--tools tether|mobile|all` or TETHER_MCP_TOOLS (default all; some clients cap
the number of tools).
"""

from __future__ import annotations

import base64
import json
import os
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from adb import KEYCODES, Adb, AdbError, find_element, find_notification  # noqa: E402
from beacon_link import BeaconError, BeaconLink  # noqa: E402
from flows import FlowError, run_flow, subscribe_device  # noqa: E402
import maestro  # noqa: E402
from mobile_compat import MOBILE_TOOLS, MobileMcpTools  # noqa: E402

SERVER_INFO = {"name": "tether", "version": "0.1.0"}
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")

SERIAL_PROP = {
    "serial": {
        "type": "string",
        "description": "Device serial from list_devices. Optional when exactly one device is connected.",
    }
}
SELECTOR_PROPS = {
    "text": {"type": "string", "description": "Visible text (exact or contained, case-insensitive)."},
    "resource_id": {"type": "string", "description": "Android resource id, e.g. com.app:id/login or just login."},
    "desc": {"type": "string", "description": "Content description (accessibility label)."},
}


def _schema(properties: dict, required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": {**SERIAL_PROP, **properties},
        "required": required or [],
        "additionalProperties": False,
    }


TOOLS = [
    {
        "name": "list_devices",
        "description": "List connected Android devices and emulators with their state.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "screenshot",
        "description": (
            "Capture the device screen as a PNG (downscaled for you). The reply states the "
            "image size; tap/swipe x,y default to this image's pixel space."
        ),
        "inputSchema": _schema({
            "max_side": {"type": "integer", "minimum": 200, "maximum": 2400, "default": 1024},
        }),
    },
    {
        "name": "ui_elements",
        "description": (
            "List on-screen UI elements (text, resource id, description, clickable, bounds in "
            "device pixels). Prefer tap_element over coordinates when an element has text or an id."
        ),
        "inputSchema": _schema({
            "only_interesting": {
                "type": "boolean",
                "default": True,
                "description": "Skip unlabeled, non-clickable layout containers.",
            },
        }),
    },
    {
        "name": "tap",
        "description": "Tap a point. Coordinates are in the last screenshot's pixels unless space='device'.",
        "inputSchema": _schema({
            "x": {"type": "number"},
            "y": {"type": "number"},
            "space": {"type": "string", "enum": ["screenshot", "device"], "default": "screenshot"},
            "long_press": {"type": "boolean", "default": False},
        }, ["x", "y"]),
    },
    {
        "name": "swipe",
        "description": "Swipe/drag between two points (same coordinate rules as tap). Use for scrolling.",
        "inputSchema": _schema({
            "x1": {"type": "number"},
            "y1": {"type": "number"},
            "x2": {"type": "number"},
            "y2": {"type": "number"},
            "duration_ms": {"type": "integer", "default": 300},
            "space": {"type": "string", "enum": ["screenshot", "device"], "default": "screenshot"},
        }, ["x1", "y1", "x2", "y2"]),
    },
    {
        "name": "tap_element",
        "description": "Find an element by text / resource_id / desc and tap its centre.",
        "inputSchema": _schema(dict(SELECTOR_PROPS)),
    },
    {
        "name": "type_text",
        "description": "Type ASCII text into the focused field (tap the field first). Newlines press Enter.",
        "inputSchema": _schema({"text": {"type": "string"}}, ["text"]),
    },
    {
        "name": "press_key",
        "description": "Press a hardware/navigation key.",
        "inputSchema": _schema({"key": {"type": "string", "enum": sorted(KEYCODES)}}, ["key"]),
    },
    {
        "name": "list_apps",
        "description": "List installed third-party packages and the app currently in the foreground.",
        "inputSchema": _schema({}),
    },
    {
        "name": "launch_app",
        "description": "Launch an app by package name.",
        "inputSchema": _schema({"package": {"type": "string"}}, ["package"]),
    },
    {
        "name": "stop_app",
        "description": "Force-stop an app by package name.",
        "inputSchema": _schema({"package": {"type": "string"}}, ["package"]),
    },
    {
        "name": "install_apk",
        "description": "Install (or update) an APK from a path on this computer.",
        "inputSchema": _schema({"path": {"type": "string"}}, ["path"]),
    },
    {
        "name": "logcat",
        "description": "Recent device log lines, optionally only from one app's process. Use to diagnose crashes.",
        "inputSchema": _schema({
            "lines": {"type": "integer", "default": 200},
            "package": {"type": "string"},
        }),
    },
    {
        "name": "list_notifications",
        "description": "Notifications currently on the device (package, title, text). Use after send_push to verify delivery.",
        "inputSchema": _schema({}),
    },
    {
        "name": "tap_notification",
        "description": "Open the notification shade and tap the notification whose title or text matches.",
        "inputSchema": _schema({
            "title": {"type": "string"},
            "text": {"type": "string"},
        }),
    },
    {
        "name": "send_push",
        "description": (
            "Send a push notification through the linked Beacon server and wait until Beacon has delivered it. "
            "Then call list_notifications to check it reached this device. Needs BEACON_URL + BEACON_KEY."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string"},
                "url": {"type": "string"},
                "target": {"type": "object", "description": "e.g. {\"tags\": [\"qa:device\"]} or {\"user_ids\": [\"u1\"]}"},
                "channels": {"type": "array", "items": {"type": "string", "enum": ["webpush", "fcm", "ntfy", "apprise", "inapp"]}},
            },
            "required": ["title"],
            "additionalProperties": False,
        },
    },
    {
        "name": "subscribe_device_to_beacon",
        "description": (
            "Subscribe this phone's browser to the linked Beacon app (opens Beacon's subscribe page, taps "
            "Enable and Allow). Do this once before send_push tests. Local Beacon works via adb reverse."
        ),
        "inputSchema": _schema({
            "tags": {"type": "array", "items": {"type": "string"}, "default": ["qa:device"]},
            "user": {"type": "string"},
        }),
    },
    {
        "name": "run_flow",
        "description": (
            "Run a Tether flow (JSON QA script: launch, tap_element, wait_for, assert_text, swipe, "
            "text, key, open_url, scroll_until_visible, ...; tap/swipe coordinates normalised 0..1) "
            "or a Maestro YAML flow (maestro_yaml). Returns a pass/fail report."
        ),
        "inputSchema": _schema({
            "flow": {"type": "object"},
            "maestro_yaml": {"type": "string", "description": "A Maestro flow (appId header, ---, commands)"},
        }, []),
    },
]


class TetherTools(MobileMcpTools):
    def __init__(self, adb: Adb | None = None):
        self.adb = adb or Adb()
        self.scale: dict[str, int] = {}

    def _serial(self, args: dict) -> str:
        if args.get("serial") or args.get("device"):
            return args.get("serial") or args["device"]
        ready = [d["serial"] for d in self.adb.devices() if d["state"] == "device"]
        if len(ready) == 1:
            return ready[0]
        if not ready:
            raise AdbError("no authorised device connected — plug one in (USB debugging on) or start an emulator")
        raise AdbError(f"several devices connected; pass serial (one of: {', '.join(ready)})")

    def _to_device(self, serial: str, args: dict, x: float, y: float) -> tuple[int, int]:
        if args.get("space") == "device":
            return round(x), round(y)
        factor = self.scale.get(serial, 1)
        return round(x * factor), round(y * factor)

    def call(self, name: str, args: dict) -> list[dict]:
        handler = getattr(self, "tool_" + str(name), None)
        if handler is None:
            raise KeyError(name)
        try:
            return handler(args)
        except KeyError as exc:
            raise ValueError(f"missing argument {exc}") from None

    @staticmethod
    def _text(payload) -> list[dict]:
        if not isinstance(payload, str):
            payload = json.dumps(payload, indent=1)
        return [{"type": "text", "text": payload}]

    # ------------------------------------------------------------------ tools
    def tool_list_devices(self, args):
        return self._text(self.adb.devices())

    def tool_screenshot(self, args):
        serial = self._serial(args)
        shot = self.adb.screenshot_scaled(serial, int(args.get("max_side", 1024)))
        self.scale[serial] = shot["factor"]
        img_w, img_h = shot["image_size"]
        dev_w, dev_h = shot["device_size"]
        note = (
            f"{serial}: image {img_w}x{img_h} px (device {dev_w}x{dev_h}, scale x{shot['factor']}). "
            "tap/swipe use these image pixels by default."
        )
        return [
            {"type": "image", "data": base64.b64encode(shot["png"]).decode("ascii"), "mimeType": "image/png"},
            {"type": "text", "text": note},
        ]

    def tool_ui_elements(self, args):
        serial = self._serial(args)
        elements = self.adb.ui_elements(serial)
        if args.get("only_interesting", True):
            elements = [
                e for e in elements
                if e["text"] or e["desc"] or e["clickable"] or e["focused"]
            ]
        slim = []
        for e in elements:
            item = {"i": e["index"], "bounds": e["bounds"]}
            for key in ("text", "resource_id", "desc"):
                if e[key]:
                    item[key] = e[key]
            item["class"] = e["class"].rsplit(".", 1)[-1]
            if e["clickable"]:
                item["clickable"] = True
            if e["focused"]:
                item["focused"] = True
            if not e["enabled"]:
                item["enabled"] = False
            slim.append(item)
        return self._text({"serial": serial, "bounds_space": "device", "elements": slim})

    def tool_tap(self, args):
        serial = self._serial(args)
        x, y = self._to_device(serial, args, float(args["x"]), float(args["y"]))
        if args.get("long_press"):
            self.adb.long_press(serial, x, y)
        else:
            self.adb.tap(serial, x, y)
        return self._text(f"tapped device pixel ({x}, {y})")

    def tool_swipe(self, args):
        serial = self._serial(args)
        x1, y1 = self._to_device(serial, args, float(args["x1"]), float(args["y1"]))
        x2, y2 = self._to_device(serial, args, float(args["x2"]), float(args["y2"]))
        self.adb.swipe(serial, x1, y1, x2, y2, int(args.get("duration_ms", 300)))
        return self._text(f"swiped ({x1}, {y1}) -> ({x2}, {y2})")

    def tool_tap_element(self, args):
        serial = self._serial(args)
        selector = {k: args[k] for k in ("text", "resource_id", "desc") if args.get(k)}
        element = find_element(self.adb.ui_elements(serial), **selector)
        if element is None:
            raise AdbError(f"no element matches {selector}; call ui_elements to see what is on screen")
        self.adb.tap(serial, *element["center"])
        label = element["text"] or element["desc"] or element["resource_id"] or element["class"]
        return self._text(f"tapped '{label}' at {element['center']}")

    def tool_type_text(self, args):
        serial = self._serial(args)
        self.adb.text(serial, args["text"])
        return self._text(f"typed {len(args['text'])} characters")

    def tool_press_key(self, args):
        serial = self._serial(args)
        self.adb.key(serial, args["key"])
        return self._text(f"pressed {args['key']}")

    def tool_list_apps(self, args):
        serial = self._serial(args)
        return self._text({
            "foreground": self.adb.foreground(serial),
            "packages": self.adb.packages(serial),
        })

    def tool_launch_app(self, args):
        serial = self._serial(args)
        self.adb.launch(serial, args["package"])
        return self._text(f"launched {args['package']}")

    def tool_stop_app(self, args):
        serial = self._serial(args)
        self.adb.stop(serial, args["package"])
        return self._text(f"stopped {args['package']}")

    def tool_install_apk(self, args):
        serial = self._serial(args)
        path = Path(args["path"]).expanduser()
        if not path.is_file():
            raise AdbError(f"APK not found: {path}")
        return self._text(self.adb.install(serial, str(path)))

    def tool_logcat(self, args):
        serial = self._serial(args)
        return self._text(self.adb.logcat(serial, int(args.get("lines", 200)), args.get("package")))

    def tool_list_notifications(self, args):
        serial = self._serial(args)
        return self._text(self.adb.notifications(serial))

    def tool_tap_notification(self, args):
        serial = self._serial(args)
        found = find_notification(self.adb.notifications(serial), title=args.get("title"), text=args.get("text"))
        if found is None:
            raise AdbError("no matching notification; call list_notifications to see what is there")
        self.adb.expand_notifications(serial)
        time.sleep(0.6)
        element = find_element(self.adb.ui_elements(serial), text=found["title"] or found["text"])
        if element is None:
            raise AdbError("the shade opened but the notification is not visible (try scrolling the shade)")
        self.adb.tap(serial, *element["center"])
        return self._text(f"tapped notification '{found['title']}' from {found['package']}")

    def tool_send_push(self, args):
        try:
            message = BeaconLink.from_env().send_and_wait(args)
        except BeaconError as exc:
            raise AdbError(str(exc)) from exc
        return self._text({k: message[k] for k in ("id", "status", "targeted", "delivered", "failed", "pruned")})

    def tool_subscribe_device_to_beacon(self, args):
        serial = self._serial(args)
        return self._text(subscribe_device(self.adb, serial, args.get("tags"), args.get("user")))

    def tool_run_flow(self, args):
        serial = self._serial(args)
        warnings = []
        if args.get("maestro_yaml"):
            flow, warnings = maestro.maestro_to_flow(args["maestro_yaml"])
        elif args.get("flow"):
            flow = args["flow"]
        else:
            raise FlowError("give flow (Tether JSON) or maestro_yaml")
        report = run_flow(self.adb, serial, flow)
        if warnings:
            report["maestro_warnings"] = warnings
        content = [{"type": "text", "text": json.dumps(
            {k: v for k, v in report.items() if k != "screenshots"}, indent=1
        )}]
        for shot in report["screenshots"][:4]:
            content.append({
                "type": "image",
                "data": base64.b64encode(shot["png"]).decode("ascii"),
                "mimeType": "image/png",
            })
        return content


def tool_list(tool_set: str = "all") -> list[dict]:
    if tool_set == "tether":
        return TOOLS
    if tool_set == "mobile":
        return MOBILE_TOOLS
    return TOOLS + MOBILE_TOOLS


def handle(tools: TetherTools, message: dict, tool_set: str = "all") -> dict | None:
    method = message.get("method")
    msg_id = message.get("id")
    params = message.get("params") or {}

    def reply(result):
        return {"jsonrpc": "2.0", "id": msg_id, "result": result}

    def error(code, text):
        return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": text}}

    if msg_id is None:
        return None  # notification (e.g. notifications/initialized)
    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_PROTOCOLS else SUPPORTED_PROTOCOLS[0]
        return reply({
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": (
                "Tether drives real Android devices over adb. Start with list_devices, then "
                "screenshot and ui_elements to see the screen. Prefer tap_element; take a new "
                "screenshot after each action to confirm the result. mobile_* tools follow "
                "mobile-mcp conventions: mobile_list_elements_on_screen returns @eN refs to tap, "
                "coordinates are screen pixels, and mobile_batch_commands groups known sequences."
            ),
        })
    if method == "ping":
        return reply({})
    if method == "tools/list":
        return reply({"tools": tool_list(tool_set)})
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if name not in {tool["name"] for tool in tool_list(tool_set)}:
            return error(-32602, f"unknown tool {name!r}")
        try:
            content = tools.call(name, arguments)
            return reply({"content": content, "isError": False})
        except KeyError:
            return error(-32602, f"unknown tool {name!r}")
        except (AdbError, FlowError, ValueError, TypeError) as exc:
            return reply({"content": [{"type": "text", "text": f"error: {exc}"}], "isError": True})
    return error(-32601, f"method not found: {method}")


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Tether MCP server (stdio)")
    parser.add_argument("--tools", choices=["all", "tether", "mobile"],
                        default=os.environ.get("TETHER_MCP_TOOLS", "all"),
                        help="tool set to expose (mobile = mobile-mcp compatible names only)")
    tool_set = parser.parse_args(argv).tools
    tools = TetherTools()
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    for raw in stdin:
        raw = raw.strip()
        if not raw:
            continue
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        else:
            try:
                response = handle(tools, message, tool_set)
            except Exception as exc:  # keep the server alive for the client
                traceback.print_exc(file=sys.stderr)
                response = {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {"code": -32603, "message": f"internal error: {exc}"},
                }
        if response is not None:
            stdout.write(json.dumps(response).encode("utf-8") + b"\n")
            stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
