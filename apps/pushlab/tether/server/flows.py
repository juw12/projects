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
  Both take "engine": "builtin" (default) or "artemis" — Google's ARTEMIS agent daemon
  (see artemis.py; extra keys "profile": flash|pro, "app": lock to a package,
  "expected_output", "timeout_s"). TETHER_AI_ENGINE=artemis makes it the default.

Performance (SoloPi-style, see perf.py — stock adb, nothing installed on the phone)
  perf_startup       {"package", "cold"?: true, "runs"?: 1-10, "max_ms"?}
                     launch time via `am start -W` (median of runs); fails above max_ms
  perf_reset         {"package"}              start a fresh frame window (gfxinfo reset)
  perf_assert        {"package", "max_pss_mb"?, "max_jank_percent"?, "max_p90_ms"?,
                     "max_p99_ms"?, "max_cpu_percent"?, "cpu_window_s"?}
                     measure memory / frames since perf_reset / CPU and fail over budget
  perf_trace_start   {"package"?, "max_seconds"?: 30, "keep"?: "always"|"on_fail"}
                     Perfetto system trace in the background (Android 9+); a trace still running
                     when the flow ends is stopped — pulled if keep=always or the flow failed
  perf_trace_stop    {}                       stop the trace and pull the .pftrace to reports/
                     (open it in https://ui.perfetto.dev). perf_startup also takes "trace": true
  leak_mark          {}                       only LeakCanary results logged after this count
  assert_no_leaks    {"max_leaks"?: 0, "include_library"?: false, "wait_ms"?: 0,
                     "require_analysis"?: false}  fail if LeakCanary (in the app's debug build)
                     reported retained objects — wait_ms gives its heap analysis time to finish

Any step may set "optional": true — a failure is reported but does not fail the flow.

Maestro: `python flows.py run login.yaml` runs a Maestro flow directly; see maestro.py
for the supported commands, and `python flows.py convert a.yaml b.json` (either way).
Midscene: YAML scripts with `tasks:` (aiAct, aiTap, aiInput, aiAssert, aiWaitFor …) are
detected and converted the same way; see midscene.py.

Device farm: `--all` runs the flow on every connected device in parallel (one report each).

Any string may contain {run}: it is replaced by a fresh id per run, so a
wait_notification never matches a notification left over from an earlier run.

CLI
  python flows.py run my_flow.json|my_flow.yaml [--serial SERIAL | --all] [--out reports/]
  python flows.py convert in.yaml out.json   (or in.json out.yaml)
Exit code 0 when every step passes, 1 otherwise — usable in CI.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import secrets
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode, urlparse

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from adb import Adb, AdbError, find_element, find_notification  # noqa: E402
from beacon_link import BeaconError, BeaconLink  # noqa: E402
import ai  # noqa: E402
import artemis  # noqa: E402
import maestro  # noqa: E402
import midscene  # noqa: E402
import perf  # noqa: E402

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
        if action in ("launch", "stop", "clear_data", "perf_startup", "perf_reset", "perf_assert") \
                and not step.get("package"):
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
        if action in ("ai", "ai_assert"):
            if step.get("engine", "builtin") not in AI_ENGINES:
                raise FlowError(f"step {index + 1}: engine must be one of {', '.join(AI_ENGINES)}")
            if step.get("profile", "flash") not in artemis.PROFILES:
                raise FlowError(f"step {index + 1}: profile must be flash or pro")
            if not 1 <= float(step.get("timeout_s", 600)) <= 7200:
                raise FlowError(f"step {index + 1}: `timeout_s` must be 1-7200")
        if action == "perf_startup":
            if not 1 <= int(step.get("runs", 1)) <= 10:
                raise FlowError(f"step {index + 1}: `runs` must be 1-10")
            if "max_ms" in step and not (isinstance(step["max_ms"], (int, float)) and step["max_ms"] > 0):
                raise FlowError(f"step {index + 1}: `max_ms` must be a positive number")
        if action == "perf_assert":
            budgets = {k: v for k, v in step.items() if k in perf.BUDGET_KEYS}
            if not budgets:
                raise FlowError(f"step {index + 1}: perf_assert needs a budget ({', '.join(perf.BUDGET_KEYS)})")
            if not all(isinstance(v, (int, float)) and v >= 0 for v in budgets.values()):
                raise FlowError(f"step {index + 1}: budgets must be non-negative numbers")
            if not 0.2 <= float(step.get("cpu_window_s", 1)) <= 10:
                raise FlowError(f"step {index + 1}: `cpu_window_s` must be 0.2-10")
        if action == "perf_trace_start":
            if not 1 <= float(step.get("max_seconds", 30)) <= 600:
                raise FlowError(f"step {index + 1}: `max_seconds` must be 1-600")
            if step.get("keep", "always") not in ("always", "on_fail"):
                raise FlowError(f"step {index + 1}: `keep` must be always or on_fail")
        if action == "assert_no_leaks":
            if not (isinstance(step.get("max_leaks", 0), int) and step.get("max_leaks", 0) >= 0):
                raise FlowError(f"step {index + 1}: `max_leaks` must be a whole number >= 0")
            if not 0 <= int(step.get("wait_ms", 0)) <= 600000:
                raise FlowError(f"step {index + 1}: `wait_ms` must be 0-600000")
        if action == "ai_assert" and not 0 <= int(step.get("timeout_ms", 0)) <= 600000:
            raise FlowError(f"step {index + 1}: `timeout_ms` must be 0-600000")
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


AI_ENGINES = ("builtin", "artemis")


def _engine(step: dict) -> str:
    import os

    return step.get("engine") or os.environ.get("TETHER_AI_ENGINE", "builtin")


def _ai(adb, serial, step):
    if _engine(step) == "artemis":
        return {"ai": artemis.act(serial, step["goal"], step.get("profile", "flash"), step.get("app"),
                                  step.get("expected_output"), float(step.get("timeout_s", 600)))}
    return {"ai": ai.ai_act(adb, serial, step["goal"], int(step.get("max_steps", 10)))}


def _ai_assert(adb, serial, step):
    """Judge the screen once — or, with timeout_ms, keep asking until it holds (aiWaitFor)."""
    deadline = time.monotonic() + int(step.get("timeout_ms", 0)) / 1000
    while True:
        try:
            if _engine(step) == "artemis":
                return {"ai": artemis.check(serial, step["condition"], step.get("profile", "flash"),
                                            float(step.get("timeout_s", 300)))}
            return {"ai": ai.ai_assert(adb, serial, step["condition"])}
        except AdbError as exc:
            if time.monotonic() >= deadline:
                if step.get("message"):
                    raise AdbError(f"{step['message']} ({exc})") from exc
                raise
        time.sleep(2)


def _perf_startup(adb, serial, step):
    traced = bool(step.get("trace"))
    if traced:
        perf.trace_start(adb, serial, step["package"], max_seconds=60)
    try:
        result = perf.startup(adb, serial, step["package"], cold=step.get("cold", True) is not False,
                              runs=int(step.get("runs", 1)), activity=step.get("activity"))
    finally:
        trace = perf.trace_stop(adb, serial, keep=True, name=f"startup-{step['package']}") if traced else None
    if trace:
        result["trace"] = trace
    if "max_ms" in step and result["total_ms"] > float(step["max_ms"]):
        message = (f"startup {result['total_ms']} ms > budget {step['max_ms']} ms "
                   f"({result['mode']}, samples {result['samples']})")
        if trace:
            message += f"; trace {trace['path']}"
        raise perf.PerfBudgetError(message)
    return {"perf": result}


def _perf_reset(adb, serial, step):
    perf.reset_frames(adb, serial, step["package"])
    return {"perf": {"package": step["package"], "frames": "reset"}}


def _perf_assert(adb, serial, step):
    budgets = {k: v for k, v in step.items() if k in perf.BUDGET_KEYS}
    measured = perf.snapshot(adb, serial, step["package"], float(step.get("cpu_window_s", 1)),
                             include=perf.budget_groups(budgets))
    problems = perf.check_budgets(measured, budgets)
    if problems:
        raise perf.PerfBudgetError("over budget: " + "; ".join(problems))
    return {"perf": measured}


def _perf_trace_start(adb, serial, step):
    started = perf.trace_start(adb, serial, step.get("package"), float(step.get("max_seconds", 30)),
                               keep=step.get("keep", "always"))
    return {"trace": started}


def _perf_trace_stop(adb, serial, step):
    return {"trace": perf.trace_stop(adb, serial, keep=True, name=step.get("name"))}


def _leak_mark(adb, serial, step):
    return {"leaks": {"since": perf.leak_mark(adb, serial)}}


def _assert_no_leaks(adb, serial, step):
    return {"leaks": perf.assert_no_leaks(
        adb, serial, max_leaks=int(step.get("max_leaks", 0)), include_library=bool(step.get("include_library")),
        wait_ms=int(step.get("wait_ms", 0)), require_analysis=bool(step.get("require_analysis")),
        since=step.get("since"))}


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
    "perf_startup": _perf_startup,
    "perf_reset": _perf_reset,
    "perf_assert": _perf_assert,
    "perf_trace_start": _perf_trace_start,
    "perf_trace_stop": _perf_trace_stop,
    "leak_mark": _leak_mark,
    "assert_no_leaks": _assert_no_leaks,
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
    trace_before = (perf.active_trace(serial) or {}).get("pid")
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
            for key in ("beacon", "notification", "ai", "perf", "trace", "leaks"):
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
    report = {
        "name": flow.get("name") or "flow",
        "serial": serial,
        "run_id": run_id,
        "passed": passed,
        "ms": round((time.monotonic() - started) * 1000),
        "steps": results,
        "screenshots": screenshots,
    }
    running = perf.active_trace(serial)
    if running and running.get("pid") and running.get("pid") != trace_before:
        trace = perf.finish_flow_trace(adb, serial, failed=not passed, name=report["name"])
        if trace:
            report["trace"] = trace  # kept as evidence when the flow failed
    return report


def run_flow_matrix(adb: Adb, serials: list[str], flow: dict, on_step=None, **options) -> dict:
    """Run one flow on several devices at once (device-farm style); one report per device."""
    validate_flow(flow)
    serials = list(dict.fromkeys(serials))
    if not serials:
        raise AdbError("no devices to run on")
    started = time.monotonic()

    def run_one(serial: str) -> dict:
        def tagged(result: dict) -> None:
            if on_step:
                on_step(serial, result)

        try:
            return run_flow(adb, serial, flow, on_step=tagged, **options)
        except Exception as exc:  # one broken device must not hide the others' results
            return {"name": flow.get("name") or "flow", "serial": serial, "passed": False, "ms": 0,
                    "steps": [], "screenshots": [], "error": str(exc)}

    workers = max(1, min(len(serials), int(os.environ.get("TETHER_MATRIX_WORKERS", "8"))))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        reports = list(pool.map(run_one, serials))
    passed_count = sum(1 for r in reports if r["passed"])
    return {
        "name": flow.get("name") or "flow",
        "passed": passed_count == len(reports),
        "devices": len(reports),
        "passed_devices": passed_count,
        "failed_devices": [r["serial"] for r in reports if not r["passed"]],
        "ms": round((time.monotonic() - started) * 1000),
        "reports": reports,
    }


def ready_serials(adb: Adb) -> list[str]:
    return [d["serial"] for d in adb.devices() if d["state"] == "device"]


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
        flow, warnings, kind = yaml_to_flow(text)
        for warning in warnings:
            print(f"{kind}: {warning}", file=sys.stderr)
        if kind == "midscene" and flow.get("name") == "midscene":
            flow["name"] = path.stem
        flow.setdefault("name", path.stem)
        return flow
    return json.loads(text)


def yaml_to_flow(text: str) -> tuple[dict, list[str], str]:
    """Maestro or Midscene YAML → (flow, warnings, 'maestro'|'midscene')."""
    if midscene.looks_like_midscene(text):
        flow, warnings = midscene.midscene_to_flow(text)
        return flow, warnings, "midscene"
    flow, warnings = maestro.maestro_to_flow(text)
    return flow, warnings, "maestro"


def convert_file(source: Path, target: Path) -> int:
    try:
        if source.suffix.lower() in (".yaml", ".yml"):
            flow, warnings, _ = yaml_to_flow(source.read_text(encoding="utf-8"))
            validate_flow(flow)
            target.write_text(json.dumps(flow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        else:
            flow = json.loads(source.read_text(encoding="utf-8"))
            validate_flow(flow)
            text, warnings = maestro.flow_to_maestro(flow)
            target.write_text(text, encoding="utf-8")
    except (OSError, json.JSONDecodeError, FlowError, maestro.MaestroError, midscene.MidsceneError) as exc:
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
    run.add_argument("--all", action="store_true", help="run on every connected device in parallel")
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
        validate_flow(flow)
        if args.all:
            serials = ready_serials(adb)
            if not serials:
                raise AdbError("no authorised Android device connected (check `adb devices`)")
            return _main_all(adb, flow, serials, args)
        serial = _pick_serial(adb, args.serial)
    except (AdbError, FlowError, OSError, json.JSONDecodeError, maestro.MaestroError,
            midscene.MidsceneError) as exc:
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

    if report.get("trace", {}).get("path"):
        print(f"Perfetto trace: {report['trace']['path']} (open in {perf.PERFETTO_UI})")
    if args.out:
        _write_report(report, args.out)
        print(f"report written to {args.out / 'report.json'}")
    return 0 if report["passed"] else 1


def _write_report(report: dict, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for shot in report["screenshots"]:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in shot["name"])
        (out / f"{shot['step'] + 1:03d}_{safe}.png").write_bytes(shot["png"])
    summary = report_to_json(report)
    summary["screenshots"] = [{"step": s["step"], "name": s["name"]} for s in summary["screenshots"]]
    (out / "report.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")


def _main_all(adb: Adb, flow: dict, serials: list[str], args) -> int:
    print(f"Tether flow '{flow.get('name', args.flow.stem)}' on {len(serials)} device(s): {', '.join(serials)}")

    def show(serial: str, result: dict) -> None:
        mark = ("WARN" if result.get("optional_failed") else "PASS") if result["ok"] else "FAIL"
        line = f"  [{serial}] [{mark}] {result['index'] + 1:>3} {result['action']:<12} {result['ms']:>5} ms"
        if result.get("error"):
            line += f"  {result['error']}"
        print(line, flush=True)

    matrix = run_flow_matrix(adb, serials, flow, on_step=show, stop_on_failure=not args.keep_going)
    for report in matrix["reports"]:
        state = "PASSED" if report["passed"] else "FAILED"
        extra = f"  ({report['error']})" if report.get("error") else ""
        print(f"  {report['serial']}: {state} in {report['ms']} ms{extra}")
        if args.out:
            safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in report["serial"])
            _write_report(report, args.out / safe)
    print(f"{matrix['passed_devices']}/{matrix['devices']} device(s) passed in {matrix['ms']} ms")
    if args.out:
        summary = {k: v for k, v in matrix.items() if k != "reports"}
        summary["reports"] = [{k: r.get(k) for k in ("serial", "passed", "ms", "error", "run_id")}
                              for r in matrix["reports"]]
        (args.out / "matrix.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        print(f"reports written to {args.out}")
    return 0 if matrix["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
