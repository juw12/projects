"""Tether flows: small JSON QA scripts that replay on any Android device.

A flow is {"name": "...", "steps": [ ... ]}. Coordinates are normalised
(0..1 of the current screen), so a flow recorded on one phone replays on
another. Prefer element steps (tap_element / wait_for / assert_text) over raw
taps — they survive layout changes.

Step actions
  launch        {"package"}                      start an app
  stop          {"package"}                      force-stop an app
  clear_data    {"package"}                      wipe app data (fresh install state)
  tap           {"x", "y"}                       normalised tap
  long_press    {"x", "y", "duration_ms"?} or {"text"|"resource_id"|"desc", ...}
  swipe         {"x", "y", "x2", "y2", "duration_ms"?}
  text          {"text"}                         type ASCII text
  key           {"key", "times"?}                home, back, enter, delete, recents, ...
  open_url      {"url"}                          open a link / deep link (Android picks the app)
  scroll_until_visible {"text"|"resource_id"|"desc", "direction"?, "timeout_ms"?}
                                                 swipe (default: down) until the element shows
  tap_element   {"text"|"resource_id"|"desc", "timeout_ms"?}
  wait_for      {"text"|"resource_id"|"desc", "timeout_ms"?}
  assert_text   {"text"|"resource_id"|"desc", "timeout_ms"?}  (alias of wait_for)
  assert_gone   {"text"|"resource_id"|"desc", "timeout_ms"?}
  wait          {"ms"}
  screenshot    {"name"?}                        saved by the CLI / returned to the UI

Push QA (with Beacon — set BEACON_URL + BEACON_KEY)
  push               {"title", "body"?, "url"?, "target"?, "channels"?, "data"?}
                     send through Beacon and fail unless Beacon delivered it
  wait_notification  {"title"|"text", "package"?, "timeout_ms"?}  it must appear on the device
  tap_notification   {"title"|"text", "timeout_ms"?}  open the shade and tap it
  close_notifications {}                       collapse the notification shade
  beacon_subscribe   {"tags"?, "user"?}         open Beacon's subscribe page on the phone, tap
                     Enable + Allow (local Beacon is reached via `adb reverse`)

AI steps (optional; any OpenAI-compatible endpoint such as a local Ollama — see ai.py)
  ai                 {"goal", "max_steps"?}      the model looks at the screen and acts until done
  ai_assert          {"condition"}               the model judges the screen; fails with its reason

Any step may set "optional": true — a failure is reported but does not fail the flow.

Maestro: `python flows.py run login.yaml` runs a Maestro flow directly; see maestro.py
for the supported commands, and `python flows.py convert a.yaml b.json` (either way).

Any string may contain {run}: it is replaced by a fresh id per run, so a
wait_notification never matches a notification left over from an earlier run.

CLI
  python flows.py run my_flow.json|my_flow.yaml [--serial SERIAL] [--out reports/]
  python flows.py convert in.yaml out.json   (or in.json out.yaml)
Exit code 0 when every step passes, 1 otherwise — usable in CI.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import secrets
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from adb import Adb, AdbError, find_element, find_notification  # noqa: E402
from beacon_link import BeaconError, BeaconLink  # noqa: E402
import ai  # noqa: E402
import maestro  # noqa: E402

ELEMENT_KEYS = ("text", "resource_id", "desc")
URL_RE = re.compile(r"^[a-zA-Z][\w+.\-]*:\S{1,2000}$")
SCROLL_SWIPES = {  # finger movement that reveals content in that direction
    "down": (0.5, 0.7, 0.5, 0.3),
    "up": (0.5, 0.3, 0.5, 0.7),
    "right": (0.8, 0.5, 0.2, 0.5),
    "left": (0.2, 0.5, 0.8, 0.5),
}
DEFAULT_TIMEOUT_MS = 8000
MAX_STEPS = 500


class FlowError(ValueError):
    """Invalid flow definition."""


def validate_flow(flow: dict) -> list[dict]:
    if not isinstance(flow, dict) or not isinstance(flow.get("steps"), list):
        raise FlowError("a flow is an object with a `steps` list")
    steps = flow["steps"]
    if len(steps) > MAX_STEPS:
        raise FlowError(f"flows are limited to {MAX_STEPS} steps")
    for index, step in enumerate(steps):
        if not isinstance(step, dict) or "action" not in step:
            raise FlowError(f"step {index + 1}: each step needs an `action`")
        action = step["action"]
        if action not in STEP_HANDLERS:
            raise FlowError(f"step {index + 1}: unknown action {action!r}")
        if action == "long_press" and "x" not in step and any(step.get(key) for key in ELEMENT_KEYS):
            pass  # element long-press
        elif action in ("tap", "long_press", "swipe"):
            for key in ("x", "y") + (("x2", "y2") if action == "swipe" else ()):
                value = step.get(key)
                if not isinstance(value, (int, float)) or not 0 <= value <= 1:
                    raise FlowError(f"step {index + 1}: `{key}` must be a number between 0 and 1")
        if action in ("tap_element", "wait_for", "assert_text", "assert_gone", "scroll_until_visible"):
            if not any(step.get(key) for key in ELEMENT_KEYS):
                raise FlowError(f"step {index + 1}: give text, resource_id or desc")
        if action in ("launch", "stop", "clear_data") and not step.get("package"):
            raise FlowError(f"step {index + 1}: `package` is required")
        if action == "text" and not isinstance(step.get("text"), str):
            raise FlowError(f"step {index + 1}: `text` is required")
        if action == "key" and not step.get("key"):
            raise FlowError(f"step {index + 1}: `key` is required")
        if action == "key" and not 1 <= int(step.get("times", 1)) <= 200:
            raise FlowError(f"step {index + 1}: `times` must be 1-200")
        if action == "open_url":
            url = step.get("url")
            if not isinstance(url, str) or not URL_RE.match(url) or url.lower().startswith(("javascript:", "file:")):
                raise FlowError(f"step {index + 1}: `url` must be a link like https://… or myapp://…")
        if action == "scroll_until_visible" and step.get("direction", "down") not in SCROLL_SWIPES:
            raise FlowError(f"step {index + 1}: direction must be one of {', '.join(SCROLL_SWIPES)}")
        if action == "push" and not step.get("title"):
            raise FlowError(f"step {index + 1}: push needs a `title`")
        if action in ("wait_notification", "tap_notification") and not (step.get("title") or step.get("text")):
            raise FlowError(f"step {index + 1}: give the notification `title` or `text`")
        if action == "ai" and not (isinstance(step.get("goal"), str) and step["goal"].strip()):
            raise FlowError(f"step {index + 1}: ai needs a `goal`")
        if action == "ai" and not 1 <= int(step.get("max_steps", 10)) <= 40:
            raise FlowError(f"step {index + 1}: `max_steps` must be 1-40")
        if action == "ai_assert" and not (isinstance(step.get("condition"), str) and step["condition"].strip()):
            raise FlowError(f"step {index + 1}: ai_assert needs a `condition`")
    return steps


def to_pixels(adb: Adb, serial: str, x: float, y: float) -> tuple[int, int]:
    width, height = adb.display_size(serial)
    return round(x * (width - 1)), round(y * (height - 1))


def _selector(step: dict) -> dict:
    return {key: step[key] for key in ELEMENT_KEYS if step.get(key)}


def wait_for_element(adb: Adb, serial: str, selector: dict,
                     timeout_ms: int = DEFAULT_TIMEOUT_MS, gone: bool = False) -> dict | None:
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    last_error = None
    while True:
        try:
            element = find_element(adb.ui_elements(serial), **selector)
            last_error = None
            if gone and element is None:
                return None
            if not gone and element is not None:
                return element
        except AdbError as exc:
            last_error = exc
        if time.monotonic() >= deadline:
            break
        time.sleep(0.4)
    described = ", ".join(f"{k}={v!r}" for k, v in selector.items())
    if last_error is not None:
        raise AdbError(f"UI dump failed while waiting for {described}: {last_error}")
    if gone:
        raise AdbError(f"still on screen after {timeout_ms} ms: {described}")
    raise AdbError(f"not found within {timeout_ms} ms: {described}")


# ------------------------------------------------------------------ handlers
def _launch(adb, serial, step):
    adb.launch(serial, step["package"])


def _stop(adb, serial, step):
    adb.stop(serial, step["package"])


def _clear(adb, serial, step):
    adb.clear_data(serial, step["package"])


def _tap(adb, serial, step):
    adb.tap(serial, *to_pixels(adb, serial, step["x"], step["y"]))


def _long_press(adb, serial, step):
    if "x" in step:
        x, y = to_pixels(adb, serial, step["x"], step["y"])
        extra = None
    else:
        element = wait_for_element(adb, serial, _selector(step), int(step.get("timeout_ms", DEFAULT_TIMEOUT_MS)))
        x, y = element["center"]
        extra = {"element": element}
    adb.long_press(serial, x, y, int(step.get("duration_ms", 700)))
    return extra


def _swipe(adb, serial, step):
    x1, y1 = to_pixels(adb, serial, step["x"], step["y"])
    x2, y2 = to_pixels(adb, serial, step["x2"], step["y2"])
    adb.swipe(serial, x1, y1, x2, y2, int(step.get("duration_ms", 300)))


def _text(adb, serial, step):
    adb.text(serial, step["text"])


def _key(adb, serial, step):
    for _ in range(int(step.get("times", 1))):
        adb.key(serial, step["key"])


def _open_url(adb, serial, step):
    adb.open_url(serial, step["url"])


def _scroll_until_visible(adb, serial, step):
    selector = _selector(step)
    x1, y1, x2, y2 = SCROLL_SWIPES[step.get("direction", "down")]
    deadline = time.monotonic() + int(step.get("timeout_ms", 20000)) / 1000
    swipes = 0
    while True:
        element = find_element(adb.ui_elements(serial), **selector)
        if element is not None:
            return {"element": element}
        if time.monotonic() >= deadline or swipes >= 40:
            described = ", ".join(f"{k}={v!r}" for k, v in selector.items())
            raise AdbError(f"not visible after {swipes} swipe(s): {described}")
        px1, py1 = to_pixels(adb, serial, x1, y1)
        px2, py2 = to_pixels(adb, serial, x2, y2)
        adb.swipe(serial, px1, py1, px2, py2, 350)
        swipes += 1
        time.sleep(0.5)


def _tap_element(adb, serial, step):
    element = wait_for_element(
        adb, serial, _selector(step), int(step.get("timeout_ms", DEFAULT_TIMEOUT_MS))
    )
    adb.tap(serial, *element["center"])
    return {"element": element}


def _wait_for(adb, serial, step):
    element = wait_for_element(
        adb, serial, _selector(step), int(step.get("timeout_ms", DEFAULT_TIMEOUT_MS))
    )
    return {"element": element}


def _assert_gone(adb, serial, step):
    wait_for_element(
        adb, serial, _selector(step), int(step.get("timeout_ms", DEFAULT_TIMEOUT_MS)), gone=True
    )


def _wait(adb, serial, step):
    time.sleep(min(max(int(step.get("ms", 500)), 0), 60000) / 1000)


def _screenshot(adb, serial, step):
    png = adb.screencap_png(serial)
    return {"png": png, "name": step.get("name") or "screenshot"}


def wait_for_notification(adb: Adb, serial: str, title=None, text=None, package=None,
                          timeout_ms: int = 15000) -> dict:
    deadline = time.monotonic() + max(0, timeout_ms) / 1000
    while True:
        found = find_notification(adb.notifications(serial), title=title, text=text, package=package)
        if found:
            return found
        if time.monotonic() >= deadline:
            wanted = ", ".join(f"{k}={v!r}" for k, v in (("title", title), ("text", text), ("package", package)) if v)
            raise AdbError(f"no notification with {wanted} within {timeout_ms} ms")
        time.sleep(0.5)


def _push(adb, serial, step):
    fields = {k: step[k] for k in ("title", "body", "url", "image", "tag", "target", "channels", "data",
                                   "urgency", "ttl") if k in step}
    try:
        message = BeaconLink.from_env().send_and_wait(fields, timeout=float(step.get("timeout_ms", 30000)) / 1000)
    except BeaconError as exc:
        raise AdbError(str(exc)) from exc
    return {"beacon": {"message_id": message["id"], "delivered": message["delivered"],
                       "targeted": message["targeted"]}}


def _wait_notification(adb, serial, step):
    found = wait_for_notification(adb, serial, step.get("title"), step.get("text"), step.get("package"),
                                  int(step.get("timeout_ms", 15000)))
    return {"notification": found}


def _tap_notification(adb, serial, step):
    found = wait_for_notification(adb, serial, step.get("title"), step.get("text"), step.get("package"),
                                  int(step.get("timeout_ms", 15000)))
    adb.expand_notifications(serial)
    time.sleep(0.6)
    label = found["title"] or found["text"]
    element = wait_for_element(adb, serial, {"text": label}, 5000)
    adb.tap(serial, *element["center"])
    return {"notification": found, "element": element}


def _close_notifications(adb, serial, step):
    adb.collapse_notifications(serial)


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
ALLOW_LABELS = {"allow", "allow notifications", "allow all the time"}


def subscribe_device(adb: Adb, serial: str, tags=None, user_id: str | None = None,
                     timeout_ms: int = 30000) -> dict:
    """Subscribe the phone's Chrome to the linked Beacon app, hands-free.

    Local Beacon (localhost) is forwarded with `adb reverse`, so the phone opens
    http://localhost:<port> — a secure context, so Web Push works without HTTPS.
    """
    tags = list(tags or ["qa:device"])
    try:
        link = BeaconLink.from_env()
        app = link.app_info()
    except BeaconError as exc:
        raise AdbError(str(exc)) from exc
    parsed = urlparse(link.url)
    if parsed.hostname in LOOPBACK_HOSTS:
        port = parsed.port or 80
        adb.reverse(serial, port)
        base = f"http://localhost:{port}"
    elif parsed.scheme == "https":
        base = link.url
    else:
        raise AdbError("phones only allow push from https:// or localhost — use an https Beacon URL, "
                       "or run Beacon on this computer (Tether forwards it with adb reverse)")
    query = {"app": app["app_key"], "tags": ",".join(tags)}
    if user_id:
        query["user"] = user_id
    url = f"{base}/try/?{urlencode(query)}"
    try:
        adb.open_url(serial, url, package="com.android.chrome")
    except AdbError:
        adb.open_url(serial, url)  # Chrome missing: let Android pick the browser

    button = wait_for_element(adb, serial, {"text": "Enable notifications"}, timeout_ms)
    adb.tap(serial, *button["center"])

    allowed = False
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        elements = adb.ui_elements(serial)
        if any("subscribed" in e["text"].lower() for e in elements):
            break
        allow = next((e for e in elements if e["text"].strip().lower() in ALLOW_LABELS and e["clickable"]), None)
        if allow and not allowed:
            adb.tap(serial, *allow["center"])
            allowed = True
        time.sleep(0.5)
    done = wait_for_element(adb, serial, {"text": "subscribed"}, timeout_ms)
    try:
        subscribers = link.stats().get("subscribers", {})
    except BeaconError:
        subscribers = {}
    return {"url": url, "tapped_allow": allowed, "confirmation": done["text"], "subscribers": subscribers,
            "app": app["name"], "tags": tags}


def _beacon_subscribe(adb, serial, step):
    result = subscribe_device(adb, serial, step.get("tags"), step.get("user"), int(step.get("timeout_ms", 30000)))
    return {"beacon": result}


def _ai(adb, serial, step):
    return {"ai": ai.ai_act(adb, serial, step["goal"], int(step.get("max_steps", 10)))}


def _ai_assert(adb, serial, step):
    return {"ai": ai.ai_assert(adb, serial, step["condition"])}


STEP_HANDLERS = {
    "launch": _launch,
    "stop": _stop,
    "clear_data": _clear,
    "tap": _tap,
    "long_press": _long_press,
    "swipe": _swipe,
    "text": _text,
    "key": _key,
    "tap_element": _tap_element,
    "wait_for": _wait_for,
    "assert_text": _wait_for,
    "assert_gone": _assert_gone,
    "wait": _wait,
    "screenshot": _screenshot,
    "open_url": _open_url,
    "scroll_until_visible": _scroll_until_visible,
    "push": _push,
    "wait_notification": _wait_notification,
    "tap_notification": _tap_notification,
    "close_notifications": _close_notifications,
    "beacon_subscribe": _beacon_subscribe,
    "ai": _ai,
    "ai_assert": _ai_assert,
}


def _fill_run_id(value, run_id: str):
    if isinstance(value, str):
        return value.replace("{run}", run_id)
    if isinstance(value, list):
        return [_fill_run_id(v, run_id) for v in value]
    if isinstance(value, dict):
        return {k: _fill_run_id(v, run_id) for k, v in value.items()}
    return value


def run_flow(adb: Adb, serial: str, flow: dict, settle_ms: int = 250,
             stop_on_failure: bool = True, on_step=None) -> dict:
    """Run a flow and return a report. Never raises for step failures."""
    run_id = secrets.token_hex(3)
    steps = _fill_run_id(validate_flow(flow), run_id)
    started = time.monotonic()
    results = []
    screenshots = []
    passed = True
    for index, step in enumerate(steps):
        t0 = time.monotonic()
        result = {"index": index, "action": step["action"], "ok": True}
        try:
            extra = STEP_HANDLERS[step["action"]](adb, serial, step) or {}
            if "png" in extra:
                screenshots.append({"step": index, "name": extra["name"], "png": extra["png"]})
            for key in ("beacon", "notification", "ai"):
                if key in extra:
                    result[key] = extra[key]
            if "element" in extra:
                element = extra["element"]
                result["matched"] = {
                    "text": element["text"],
                    "resource_id": element["resource_id"],
                    "center": element["center"],
                }
            if step["action"] in ("tap", "long_press", "swipe", "text", "key", "tap_element", "launch",
                                  "tap_notification", "open_url"):
                time.sleep(settle_ms / 1000)
        except AdbError as exc:
            result["error"] = str(exc)
            if step.get("optional"):
                result["optional_failed"] = True  # reported, but the flow carries on
            else:
                result["ok"] = False
                passed = False
        result["ms"] = round((time.monotonic() - t0) * 1000)
        results.append(result)
        if on_step:
            on_step(result)
        if not result["ok"] and stop_on_failure:
            for skipped_index in range(index + 1, len(steps)):
                results.append({
                    "index": skipped_index,
                    "action": steps[skipped_index]["action"],
                    "ok": None,
                    "skipped": True,
                })
            break
    return {
        "name": flow.get("name") or "flow",
        "serial": serial,
        "run_id": run_id,
        "passed": passed,
        "ms": round((time.monotonic() - started) * 1000),
        "steps": results,
        "screenshots": screenshots,
    }


def report_to_json(report: dict) -> dict:
    """JSON-safe copy of a report (screenshots as base64)."""
    copy = dict(report)
    copy["screenshots"] = [
        {
            "step": shot["step"],
            "name": shot["name"],
            "png_base64": base64.b64encode(shot["png"]).decode("ascii"),
        }
        for shot in report["screenshots"]
    ]
    return copy


def load_flow_file(path: Path) -> dict:
    """Tether JSON, or a Maestro YAML flow (converted on the fly; warnings to stderr)."""
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".yaml", ".yml"):
        flow, warnings = maestro.maestro_to_flow(text)
        for warning in warnings:
            print(f"maestro: {warning}", file=sys.stderr)
        flow.setdefault("name", path.stem)
        return flow
    return json.loads(text)


def convert_file(source: Path, target: Path) -> int:
    try:
        if source.suffix.lower() in (".yaml", ".yml"):
            flow, warnings = maestro.maestro_to_flow(source.read_text(encoding="utf-8"))
            validate_flow(flow)
            target.write_text(json.dumps(flow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        else:
            flow = json.loads(source.read_text(encoding="utf-8"))
            validate_flow(flow)
            text, warnings = maestro.flow_to_maestro(flow)
            target.write_text(text, encoding="utf-8")
    except (OSError, json.JSONDecodeError, FlowError, maestro.MaestroError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    for warning in warnings:
        print(f"warning: {warning}", file=sys.stderr)
    print(f"wrote {target} ({len(flow['steps'])} steps)")
    return 0


def _pick_serial(adb: Adb, wanted: str | None) -> str:
    ready = [d["serial"] for d in adb.devices() if d["state"] == "device"]
    if wanted:
        if wanted not in ready:
            raise AdbError(f"device {wanted!r} is not connected and authorised")
        return wanted
    if not ready:
        raise AdbError("no authorised Android device connected (check `adb devices`)")
    if len(ready) > 1:
        raise AdbError(f"several devices connected, pass --serial (one of {', '.join(ready)})")
    return ready[0]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a Tether flow against an Android device.")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="run a flow JSON file")
    run.add_argument("flow", type=Path)
    run.add_argument("--serial")
    run.add_argument("--out", type=Path, help="folder for report.json and screenshots")
    run.add_argument("--keep-going", action="store_true", help="continue after a failed step")
    convert = sub.add_parser("convert", help="convert between Maestro YAML and Tether JSON")
    convert.add_argument("source", type=Path)
    convert.add_argument("target", type=Path)
    args = parser.parse_args(argv)

    if args.command == "convert":
        return convert_file(args.source, args.target)

    adb = Adb()
    try:
        flow = load_flow_file(args.flow)
        serial = _pick_serial(adb, args.serial)
        validate_flow(flow)
    except (AdbError, FlowError, OSError, json.JSONDecodeError, maestro.MaestroError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    def show(result: dict) -> None:
        mark = ("WARN" if result.get("optional_failed") else "PASS") if result["ok"] else "FAIL"
        line = f"  [{mark}] {result['index'] + 1:>3} {result['action']:<12} {result['ms']:>5} ms"
        if result.get("error"):
            line += f"  {result['error']}"
        print(line)

    print(f"Tether flow '{flow.get('name', args.flow.stem)}' on {serial}")
    report = run_flow(adb, serial, flow, stop_on_failure=not args.keep_going, on_step=show)
    skipped = sum(1 for r in report["steps"] if r.get("skipped"))
    if skipped:
        print(f"  ({skipped} step(s) skipped after failure)")
    print(f"{'PASSED' if report['passed'] else 'FAILED'} in {report['ms']} ms")

    if args.out:
        args.out.mkdir(parents=True, exist_ok=True)
        for shot in report["screenshots"]:
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in shot["name"])
            (args.out / f"{shot['step'] + 1:03d}_{safe}.png").write_bytes(shot["png"])
        summary = report_to_json(report)
        summary["screenshots"] = [
            {"step": s["step"], "name": s["name"]} for s in summary["screenshots"]
        ]
        (args.out / "report.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"report written to {args.out / 'report.json'}")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
