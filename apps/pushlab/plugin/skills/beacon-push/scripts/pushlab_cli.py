#!/usr/bin/env python3
"""pushlab_cli — drive Tether (Android devices) and Beacon (push) from any agent shell.

Zero dependencies (Python 3.9+ standard library). Output is JSON on stdout;
exit code 0 = success, 1 = check failed, 2 = usage/connection error.

Configuration (first match wins):
  1. Environment: TETHER_URL, TETHER_TOKEN, BEACON_URL, BEACON_KEY
  2. PUSHLAB_CONFIG=path/to/lab.json, or apps/pushlab/.pushlab/lab.json found by
     walking up from the current folder (written by `python apps/pushlab/pushlab.py`)
  3. Defaults: Tether http://127.0.0.1:8765, Beacon http://127.0.0.1:8780

Examples:
  python pushlab_cli.py status
  python pushlab_cli.py screenshot --out screen.png
  python pushlab_cli.py ui
  python pushlab_cli.py tap-text "Sign in"
  python pushlab_cli.py flow login.yaml            # Tether JSON flow or Maestro YAML
  python pushlab_cli.py push-check --title "Order shipped" --tap
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VERSION = "0.1.0"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


# ------------------------------------------------------------------ config
def find_lab_config() -> Path | None:
    explicit = os.environ.get("PUSHLAB_CONFIG")
    if explicit:
        return Path(explicit) if Path(explicit).is_file() else None
    here = Path.cwd().resolve()
    for folder in [here, *here.parents]:
        for candidate in (folder / "apps" / "pushlab" / ".pushlab" / "lab.json",
                          folder / ".pushlab" / "lab.json"):
            if candidate.is_file():
                return candidate
    return None


def load_config() -> dict:
    lab = {}
    path = find_lab_config()
    if path:
        try:
            lab = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            lab = {}
    return {
        "tether_url": (os.environ.get("TETHER_URL") or lab.get("tether_url") or "http://127.0.0.1:8765").rstrip("/"),
        "tether_token": os.environ.get("TETHER_TOKEN") or lab.get("tether_token") or "",
        "beacon_url": (os.environ.get("BEACON_URL") or lab.get("beacon_url") or "http://127.0.0.1:8780").rstrip("/"),
        "beacon_key": os.environ.get("BEACON_KEY") or lab.get("secret") or "",
        "lab_config": str(path) if path else None,
    }


# ------------------------------------------------------------------- http
class ApiError(RuntimeError):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def _opener(url: str):
    host = urllib.parse.urlparse(url).hostname or ""
    if host in LOCAL_HOSTS:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))  # never send localhost via a proxy
    return urllib.request.build_opener()


def request(url: str, method: str = "GET", body=None, headers: dict | None = None,
            raw: bool = False, timeout: float = 60):
    data = json.dumps(body).encode() if body is not None else None
    all_headers = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(url, data=data, method=method, headers=all_headers)
    try:
        with _opener(url).open(req, timeout=timeout) as response:
            payload = response.read()
            if raw:
                return payload, dict(response.headers)
            return json.loads(payload or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            detail = json.loads(exc.read() or b"{}").get("error") or exc.reason
        except ValueError:
            detail = exc.reason
        raise ApiError(f"{method} {url} -> {exc.code}: {detail}", exc.code) from None
    except OSError as exc:
        raise ApiError(f"cannot reach {url}: {exc}. Is it running? (python apps/pushlab/pushlab.py)") from None


class Tether:
    def __init__(self, config: dict, serial: str | None = None):
        self.base = config["tether_url"]
        self.token = config["tether_token"]
        self._serial = serial

    def call(self, method: str, path: str, body=None, raw: bool = False, timeout: float = 60):
        return request(self.base + path, method, body, {"X-Tether-Token": self.token}, raw, timeout)

    @property
    def serial(self) -> str:
        if self._serial:
            return self._serial
        ready = [d["serial"] for d in self.call("GET", "/api/devices")["devices"] if d["state"] == "device"]
        if len(ready) != 1:
            raise ApiError("no authorised device connected" if not ready
                           else f"several devices; pass --serial (one of {', '.join(ready)})")
        self._serial = ready[0]
        return self._serial

    def q(self, **params) -> str:
        return urllib.parse.urlencode({"serial": self.serial, **params})


class Beacon:
    def __init__(self, config: dict):
        self.base = config["beacon_url"]
        self.key = config["beacon_key"]

    def call(self, method: str, path: str, body=None):
        if not self.key:
            raise ApiError("BEACON_KEY (the app secret sk_...) is not set and no Push Lab lab.json was found")
        return request(self.base + path, method, body, {"Authorization": f"Bearer {self.key}"})


# --------------------------------------------------------------- commands
def cmd_status(args, config):
    result = {"cli": VERSION, "lab_config": config["lab_config"],
              "tether": {"url": config["tether_url"]}, "beacon": {"url": config["beacon_url"]}}
    try:
        result["tether"].update(request(config["tether_url"] + "/api/health", headers={"X-Tether-Token": config["tether_token"]}))
        result["tether"]["devices"] = Tether(config).call("GET", "/api/devices")["devices"]
    except ApiError as exc:
        result["tether"]["error"] = str(exc)
    try:
        result["beacon"]["health"] = request(config["beacon_url"] + "/v1/health")
        if config["beacon_key"]:
            result["beacon"]["app"] = Beacon(config).call("GET", "/v1/app")["app"]
    except ApiError as exc:
        result["beacon"]["error"] = str(exc)
    return result


def cmd_devices(args, config):
    return Tether(config).call("GET", "/api/devices")["devices"]


def cmd_screenshot(args, config):
    tether = Tether(config, args.serial)
    png, _headers = tether.call("GET", "/api/screenshot?" + tether.q(), raw=True)
    out = Path(args.out).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    return {"saved": str(out.resolve()), "bytes": len(png)}


def cmd_ui(args, config):
    tether = Tether(config, args.serial)
    data = tether.call("GET", "/api/ui?" + tether.q())
    elements = data["elements"]
    if not args.all:
        elements = [e for e in elements if e.get("text") or e.get("desc") or e.get("clickable")]
    keep = ("index", "text", "resource_id", "desc", "class", "clickable", "bounds", "center")
    return {"size": data["size"], "elements": [{k: e[k] for k in keep if e.get(k) not in (None, "", False)}
                                               for e in elements]}


def _tap_element(args, config, **selector):
    tether = Tether(config, args.serial)
    return tether.call("POST", "/api/tap_element", {"serial": tether.serial, **selector})


def cmd_tap_text(args, config):
    return _tap_element(args, config, text=args.text)


def cmd_tap_id(args, config):
    return _tap_element(args, config, resource_id=args.resource_id)


def cmd_tap_desc(args, config):
    return _tap_element(args, config, desc=args.desc)


def _input(args, config, **body):
    tether = Tether(config, args.serial)
    return tether.call("POST", "/api/input", {"serial": tether.serial, **body})


def cmd_tap(args, config):
    return _input(args, config, action="long_press" if args.long else "tap", x=args.x, y=args.y)


SWIPES = {"up": (0.5, 0.7, 0.5, 0.3), "down": (0.5, 0.3, 0.5, 0.7),
          "left": (0.8, 0.5, 0.2, 0.5), "right": (0.2, 0.5, 0.8, 0.5)}


def cmd_swipe(args, config):
    x, y, x2, y2 = SWIPES[args.direction]
    return _input(args, config, action="swipe", x=x, y=y, x2=x2, y2=y2, duration_ms=350)


def cmd_type(args, config):
    return _input(args, config, action="text", text=args.text)


def cmd_key(args, config):
    return _input(args, config, action="key", key=args.key)


def cmd_apps(args, config):
    tether = Tether(config, args.serial)
    return tether.call("GET", "/api/packages?" + tether.q())


def _package(endpoint):
    def run(args, config):
        tether = Tether(config, args.serial)
        return tether.call("POST", endpoint, {"serial": tether.serial, "package": args.package})
    return run


def cmd_logcat(args, config):
    tether = Tether(config, args.serial)
    params = {"lines": args.lines}
    if args.package:
        params["package"] = args.package
    return {"log": tether.call("GET", "/api/logcat?" + tether.q(**params))["log"]}


def cmd_flow(args, config):
    tether = Tether(config, args.serial)
    path = Path(args.file)
    text = path.read_text(encoding="utf-8")
    warnings = []
    if path.suffix.lower() in (".yaml", ".yml"):
        converted = tether.call("POST", "/api/flow/maestro/import", {"yaml": text})
        flow, warnings = converted["flow"], converted.get("warnings", [])
    else:
        flow = json.loads(text)
    report = tether.call("POST", "/api/flow/run", {"serial": tether.serial, "flow": flow}, timeout=600)["report"]
    report["maestro_warnings"] = warnings
    return report, (0 if report.get("passed") else 1)


def cmd_record(args, config):
    tether = Tether(config, args.serial)
    if args.action == "start":
        return tether.call("POST", "/api/record/start", {"serial": tether.serial, "time_limit": args.time_limit})
    result = tether.call("POST", "/api/record/stop", {"serial": tether.serial})
    video, _headers = tether.call("GET", result["url"], raw=True, timeout=180)
    out = Path(args.out or result["name"]).expanduser()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(video)
    return {"saved": str(out.resolve()), "bytes": len(video), "duration": result["duration"]}


def cmd_notifications(args, config):
    tether = Tether(config, args.serial)
    return tether.call("GET", "/api/notifications?" + tether.q())["notifications"]


def cmd_push(args, config):
    """Send through Beacon directly and wait until it is delivered (no device involved)."""
    beacon = Beacon(config)
    body = {"title": args.title}
    if args.body:
        body["body"] = args.body
    if args.url:
        body["url"] = args.url
    if args.tag:
        body["target"] = {"tags": args.tag}
    if args.channel:
        body["channels"] = args.channel
    if args.digest_key:
        body["digest"] = {"key": args.digest_key, "window": args.digest_window}
    if args.fallback_channel:
        body["fallback"] = {"after": args.fallback_after, "unless": args.fallback_unless,
                            "channels": args.fallback_channel}
    sent = beacon.call("POST", "/v1/send", body)
    message = sent["message"]
    if body.get("digest"):
        return {"message": message, "digested": sent.get("digested", False),
                "note": "held until the digest window ends"}, 0
    deadline = time.time() + args.timeout
    while message["status"] in ("queued", "sending") and time.time() < deadline:
        time.sleep(0.5)
        message = beacon.call("GET", f"/v1/messages/{message['id']}")["message"]
    return message, (0 if message["status"] == "sent" and message.get("delivered", 0) > 0 else 1)


def cmd_push_check(args, config):
    """End-to-end: Tether asks Beacon to send, then waits for the notification on the phone."""
    tether = Tether(config, args.serial)
    body = {"title": args.title}
    if args.body:
        body["body"] = args.body
    body["target"] = {"tags": args.tag or ["qa:device"]}
    started = time.time()
    sent = tether.call("POST", "/api/push", body, timeout=120)["message"]
    found = None
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        notifications = tether.call("GET", "/api/notifications?" + tether.q())["notifications"]
        found = next((n for n in notifications if args.title.lower() in (n.get("title") or "").lower()), None)
        if found:
            break
        time.sleep(1)
    result = {"message": sent, "on_device": found, "seconds": round(time.time() - started, 1)}
    if found and args.tap:
        result["tapped"] = tether.call("POST", "/api/notifications/tap",
                                       {"serial": tether.serial, "title": found["title"]})["ok"]
    return result, (0 if found else 1)


def cmd_beacon_messages(args, config):
    return Beacon(config).call("GET", f"/v1/messages?limit={args.limit}")["messages"]


def cmd_beacon_stats(args, config):
    return Beacon(config).call("GET", f"/v1/stats?days={args.days}")["stats"]


# -------------------------------------------------------------------- cli
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="pushlab_cli", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--serial", help="device serial (needed only with several devices)")
    sub = parser.add_subparsers(dest="command", required=True)

    def add(name, func, help_text):
        p = sub.add_parser(name, help=help_text)
        p.set_defaults(func=func)
        return p

    add("status", cmd_status, "Tether + Beacon reachability, devices, Beacon app")
    add("devices", cmd_devices, "connected devices")
    add("screenshot", cmd_screenshot, "save a PNG of the screen").add_argument("--out", default="screen.png")
    add("ui", cmd_ui, "on-screen elements (text, id, desc, bounds)").add_argument("--all", action="store_true")
    add("tap-text", cmd_tap_text, "tap the element with this text").add_argument("text")
    add("tap-id", cmd_tap_id, "tap the element with this resource id").add_argument("resource_id")
    add("tap-desc", cmd_tap_desc, "tap the element with this content description").add_argument("desc")
    p = add("tap", cmd_tap, "tap at normalised x y (0..1)")
    p.add_argument("x", type=float)
    p.add_argument("y", type=float)
    p.add_argument("--long", action="store_true")
    add("swipe", cmd_swipe, "swipe the finger up/down/left/right").add_argument(
        "direction", choices=sorted(SWIPES))
    add("type", cmd_type, "type into the focused field").add_argument("text")
    add("key", cmd_key, "press a key: back, home, enter, recents, ...").add_argument("key")
    add("apps", cmd_apps, "installed third-party packages + foreground app")
    for name, endpoint in (("launch", "/api/launch"), ("stop", "/api/stop"), ("clear", "/api/clear")):
        add(name, _package(endpoint), f"{name} an app").add_argument("package")
    p = add("logcat", cmd_logcat, "recent device log")
    p.add_argument("--package")
    p.add_argument("--lines", type=int, default=300)
    add("flow", cmd_flow, "run a Tether JSON flow or Maestro YAML; exit 1 if it fails").add_argument("file")
    p = add("record", cmd_record, "screen recording (adb screenrecord, max 180 s)")
    p.add_argument("action", choices=["start", "stop"])
    p.add_argument("--out", help="MP4 path for stop")
    p.add_argument("--time-limit", type=int, default=180)
    add("notifications", cmd_notifications, "notifications currently on the device")
    p = add("push", cmd_push, "send a push via Beacon and wait for delivery")
    p.add_argument("--title", required=True)
    p.add_argument("--body")
    p.add_argument("--url")
    p.add_argument("--tag", action="append", help="target subscribers with this tag (repeatable)")
    p.add_argument("--channel", action="append", choices=["webpush", "fcm", "ntfy", "apprise", "inapp"])
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--digest-key", help="batch sends with this key into one notification")
    p.add_argument("--digest-window", type=float, default=300, help="seconds to collect (default 300)")
    p.add_argument("--fallback-channel", action="append", choices=["webpush", "fcm", "ntfy", "apprise", "inapp"],
                   help="escalate on this channel if the push is not clicked in time (repeatable)")
    p.add_argument("--fallback-after", type=float, default=3600, help="seconds before escalating (default 3600)")
    p.add_argument("--fallback-unless", choices=["clicked", "shown", "delivered"], default="clicked")
    p = add("push-check", cmd_push_check, "send via Beacon and assert it shows up on the phone")
    p.add_argument("--title", required=True)
    p.add_argument("--body")
    p.add_argument("--tag", action="append")
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--tap", action="store_true", help="tap the notification once it arrives")
    add("beacon-messages", cmd_beacon_messages, "recent Beacon messages").add_argument("--limit", type=int, default=20)
    add("beacon-stats", cmd_beacon_stats, "Beacon delivery stats").add_argument("--days", type=int, default=7)
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    args = build_parser().parse_args(argv)
    config = load_config()
    try:
        result = args.func(args, config)
    except ApiError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=1))
        return 2
    code = 0
    if isinstance(result, tuple):
        result, code = result
    print(json.dumps(result, indent=1, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
