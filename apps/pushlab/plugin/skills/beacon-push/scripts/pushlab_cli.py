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
  python pushlab_cli.py flow login.yaml            # Tether JSON flow, Maestro or Midscene YAML
  python pushlab_cli.py flow smoke.json --all-devices   # every connected device in parallel
  python pushlab_cli.py trace start --package com.example && ... && python pushlab_cli.py trace stop
  python pushlab_cli.py leaks --max 0               # LeakCanary results (debug builds)
  python pushlab_cli.py push-check --title "Order shipped" --tap
  python pushlab_cli.py push --template order_shipped --var order.id=A17 --var name=Ana
  python pushlab_cli.py prefs --user alice --category marketing --off
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
        converted = tether.call("POST", "/api/flow/maestro/import", {"yaml": text})  # Maestro or Midscene
        flow, warnings = converted["flow"], converted.get("warnings", [])
    else:
        flow = json.loads(text)
    if args.all_devices:
        matrix = tether.call("POST", "/api/flow/run-all", {"flow": flow}, timeout=1800)["matrix"]
        for report in matrix["reports"]:
            report["screenshots"] = [{"step": s["step"], "name": s["name"]} for s in report.get("screenshots", [])]
        matrix["yaml_warnings"] = warnings
        return matrix, (0 if matrix.get("passed") else 1)
    report = tether.call("POST", "/api/flow/run", {"serial": tether.serial, "flow": flow}, timeout=600)["report"]
    report["yaml_warnings"] = warnings
    return report, (0 if report.get("passed") else 1)


def cmd_trace(args, config):
    """Perfetto system trace: start (background) / stop (pull the .pftrace, open in ui.perfetto.dev)."""
    tether = Tether(config, args.serial)
    if args.action == "start":
        body = {"serial": tether.serial, "max_seconds": args.max_seconds}
        if args.package:
            body["package"] = args.package
        return tether.call("POST", "/api/perf/trace/start", body)["trace"]
    trace = tether.call("POST", "/api/perf/trace/stop", {"serial": tether.serial}, timeout=180)["trace"]
    if trace.get("file"):
        payload, _ = tether.call("GET", "/api/perf/trace/file?" + urllib.parse.urlencode({"name": trace["file"]}),
                                 raw=True, timeout=180)
        out = Path(args.out or trace["file"])
        out.write_bytes(payload)
        trace["saved"] = str(out.resolve())
    return trace


def cmd_leaks(args, config):
    """LeakCanary heap-analysis results from logcat; --max N fails (exit 1) above N application leaks."""
    tether = Tether(config, args.serial)
    params = {"since": args.since} if args.since else {}
    leaks = tether.call("GET", "/api/leaks?" + tether.q(**params))["leaks"]
    if args.max is None:
        return leaks
    return leaks, (0 if leaks["application_leaks"] <= args.max else 1)


def cmd_ai(args, config):
    """One AI step on the device: reach a goal, or --check a condition (PASS/FAIL)."""
    tether = Tether(config, args.serial)
    if args.check:
        step = {"action": "ai_assert", "condition": args.text}
    else:
        step = {"action": "ai", "goal": args.text, "max_steps": args.max_steps}
    if args.engine:
        step["engine"] = args.engine
    if args.engine == "artemis":
        step["profile"] = args.profile
        if args.app:
            step["app"] = args.app
    flow = {"name": "ai", "steps": [step]}
    report = tether.call("POST", "/api/flow/run", {"serial": tether.serial, "flow": flow}, timeout=7300)["report"]
    result = report["steps"][0]
    return result, (0 if report.get("passed") else 1)


def cmd_perf(args, config):
    """App performance (SoloPi-style): snapshot, --startup time, or --reset the frame window.
    Any --max-* budget turns it into a pass/fail check (exit 1 when over budget)."""
    tether = Tether(config, args.serial)
    budgets = {key: value for key, value in (
        ("max_pss_mb", args.max_pss_mb), ("max_jank_percent", args.max_jank),
        ("max_p90_ms", args.max_p90_ms), ("max_cpu_percent", args.max_cpu),
    ) if value is not None}
    if args.startup:
        step = {"action": "perf_startup", "package": args.package, "cold": not args.warm, "runs": args.runs}
        if args.max_ms is not None:
            step["max_ms"] = args.max_ms
    elif args.reset:
        step = {"action": "perf_reset", "package": args.package}
    elif budgets:
        step = {"action": "perf_assert", "package": args.package, **budgets}
    else:
        return tether.call("GET", "/api/perf?" + tether.q(package=args.package))["perf"]
    report = tether.call("POST", "/api/flow/run", {"serial": tether.serial, "flow": {"name": "perf", "steps": [step]}},
                         timeout=600)["report"]
    return report["steps"][0], (0 if report.get("passed") else 1)


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


def _vars(pairs: list[str] | None) -> dict:
    """--var order.id=A17 --var name=Ana -> {"order": {"id": "A17"}, "name": "Ana"}"""
    result: dict = {}
    for pair in pairs or []:
        key, sep, value = pair.partition("=")
        if not sep or not key:
            raise ApiError(f"--var needs key=value, got {pair!r}")
        node = result
        parts = key.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return result


def cmd_push(args, config):
    """Send through Beacon directly and wait until it is delivered (no device involved)."""
    beacon = Beacon(config)
    if not args.title and not args.template:
        raise ApiError("give --title or --template")
    body = {"title": args.title} if args.title else {}
    if args.template:
        body["template"] = args.template
        body["vars"] = _vars(args.var)
    if args.category:
        body["category"] = args.category
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


def cmd_prefs(args, config):
    """Show or change a user's notification preferences (categories, channels)."""
    beacon = Beacon(config)
    if not (args.on or args.off or args.channel or args.reset):
        return {k: v for k, v in beacon.call("GET", "/v1/preferences?" + urllib.parse.urlencode(
            {"user_id": args.user})).items() if k in ("all", "categories")}
    body = {"user_id": args.user, "category": args.category or "*"}
    if args.reset:
        body["reset"] = True
    if args.on or args.off:
        body["enabled"] = bool(args.on)
    if args.channel:
        body["channels"] = args.channel
    result = beacon.call("POST", "/v1/preferences", body)
    return {k: result[k] for k in ("all", "categories")}


def cmd_template(args, config):
    """Beacon message templates with {{variables}}: list, save, render (preview)."""
    beacon = Beacon(config)
    if args.action == "list":
        return beacon.call("GET", "/v1/templates")["templates"]
    if not args.name:
        raise ApiError("give the template name")
    if args.action == "render":
        return beacon.call("POST", f"/v1/templates/{urllib.parse.quote(args.name)}/render",
                           {"vars": _vars(args.var)})["message"]
    body = {"name": args.name, "title": args.title}
    for key in ("body", "url", "category"):
        if getattr(args, key):
            body[key] = getattr(args, key)
    if args.channel:
        body["channels"] = args.channel
    return beacon.call("POST", "/v1/templates", body)["template"]


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
    p = add("ai", cmd_ai, "AI step: reach a goal in plain language, or --check a condition")
    p.add_argument("text", help="goal, or the condition with --check")
    p.add_argument("--check", action="store_true", help="judge the screen instead of acting (PASS/FAIL)")
    p.add_argument("--engine", choices=["builtin", "artemis"],
                   help="builtin = Tether + any OpenAI-compatible model; artemis = Google's ARTEMIS daemon")
    p.add_argument("--profile", choices=["flash", "pro"], default="flash", help="ARTEMIS profile")
    p.add_argument("--app", help="ARTEMIS: keep the agent inside this package")
    p.add_argument("--max-steps", type=int, default=10, help="builtin engine: action limit")
    p = add("flow", cmd_flow, "run a Tether JSON flow or Maestro / Midscene YAML; exit 1 if it fails")
    p.add_argument("file")
    p.add_argument("--all-devices", action="store_true", help="run on every connected device in parallel")
    p = add("trace", cmd_trace, "Perfetto system trace: start, exercise the app, stop (pulls a .pftrace)")
    p.add_argument("action", choices=["start", "stop"])
    p.add_argument("--package", help="with start: include this app's atrace markers")
    p.add_argument("--max-seconds", type=float, default=60, help="with start: safety limit (default 60)")
    p.add_argument("--out", help="with stop: where to save the .pftrace")
    p = add("leaks", cmd_leaks, "LeakCanary results from logcat (app debug build must include LeakCanary)")
    p.add_argument("--since", help="device epoch seconds, e.g. 1730419200.000")
    p.add_argument("--max", type=int, help="fail (exit 1) above this many application leaks")
    p = add("perf", cmd_perf, "app performance: memory, frames/jank, CPU; --startup time; --max-* budgets")
    p.add_argument("package")
    p.add_argument("--startup", action="store_true", help="measure launch time (am start -W)")
    p.add_argument("--warm", action="store_true", help="with --startup: warm start instead of cold")
    p.add_argument("--runs", type=int, default=3, help="with --startup: runs to take the median of (1-10)")
    p.add_argument("--max-ms", type=float, help="with --startup: fail above this launch time")
    p.add_argument("--reset", action="store_true", help="start a fresh frame window before a scenario")
    p.add_argument("--max-pss-mb", type=float, help="fail if memory (PSS) is above this")
    p.add_argument("--max-jank", type=float, help="fail if janky frames %% is above this")
    p.add_argument("--max-p90-ms", type=float, help="fail if the 90th percentile frame time is above this")
    p.add_argument("--max-cpu", type=float, help="fail if the app's CPU share %% is above this")
    p = add("record", cmd_record, "screen recording (adb screenrecord, max 180 s)")
    p.add_argument("action", choices=["start", "stop"])
    p.add_argument("--out", help="MP4 path for stop")
    p.add_argument("--time-limit", type=int, default=180)
    add("notifications", cmd_notifications, "notifications currently on the device")
    p = add("push", cmd_push, "send a push via Beacon and wait for delivery")
    p.add_argument("--title")
    p.add_argument("--template", help="send a saved Beacon template instead of --title")
    p.add_argument("--var", action="append", help="template variable key=value (dots nest: order.id=A17)")
    p.add_argument("--category", help="preference category, e.g. marketing")
    p.add_argument("--body")
    p.add_argument("--url")
    p.add_argument("--tag", action="append", help="target subscribers with this tag (repeatable)")
    p.add_argument("--channel", action="append", choices=["webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"])
    p.add_argument("--timeout", type=float, default=30)
    p.add_argument("--digest-key", help="batch sends with this key into one notification")
    p.add_argument("--digest-window", type=float, default=300, help="seconds to collect (default 300)")
    p.add_argument("--fallback-channel", action="append", choices=["webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"],
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
    p = add("prefs", cmd_prefs, "show / change a user's Beacon notification preferences")
    p.add_argument("--user", required=True, help="user id")
    p.add_argument("--category", help="category key ('*' or omitted = every non-critical category)")
    p.add_argument("--on", action="store_true")
    p.add_argument("--off", action="store_true")
    p.add_argument("--channel", action="append", choices=["webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"],
                   help="only deliver this category on these channels (repeatable)")
    p.add_argument("--reset", action="store_true", help="back to the default")
    p = add("template", cmd_template, "Beacon message templates: list, save, render")
    p.add_argument("action", choices=["list", "save", "render"])
    p.add_argument("name", nargs="?")
    p.add_argument("--title")
    p.add_argument("--body")
    p.add_argument("--url")
    p.add_argument("--category")
    p.add_argument("--channel", action="append", choices=["webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"])
    p.add_argument("--var", action="append", help="with render: key=value")
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
