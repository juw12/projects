"""Midscene YAML scripts → Tether flows.

Midscene.js (https://github.com/web-infra-dev/midscene, MIT) writes automation
as YAML: a target (`android:`, `web:` …) plus `tasks`, each with a `flow` of
natural-language steps (`aiAct`, `aiTap`, `aiInput`, `aiAssert`, `aiWaitFor`,
`aiScroll`, `sleep` …). This module converts those scripts into Tether flows so
they run on any phone Tether can reach, with Tether's own AI steps (`ai`,
`ai_assert` — builtin vision model or ARTEMIS) doing the vision work.

Nothing from Midscene is imported or bundled; only its file format is read.
Commands Tether cannot honour are reported as warnings, never silently dropped.

    android:  {deviceId?, launch?}    launch → launch (package) / open_url (link)
    web:      {url?}                  url → open_url in the phone's browser
    tasks:    [{name, continueOnError?, flow: [...]}]

    ai / aiAct / aiAction: prompt            → ai {goal}
    aiTap / aiDoubleClick / aiLongPress: x   → ai {goal: "Tap x" …}
    aiInput (+ value | locate)               → ai {goal: "Type '…' into …"}
    aiKeyboardPress (+ keyName | locate)     → key
    aiScroll (+ scrollType, direction)       → swipe(s)
    aiAssert (+ errorMessage)                → ai_assert
    aiWaitFor (+ timeout)                    → ai_assert retried until timeout_ms
    sleep: ms                                → wait
    launch: pkg|url / terminate: pkg         → launch / open_url / stop
    recordToReport / logScreenshot           → screenshot
    continueOnError: true                    → the task's steps become optional
"""

from __future__ import annotations

import re

import maestro

KEY_NAMES = {
    "enter": "enter", "return": "enter", "backspace": "delete", "delete": "forward_delete", "tab": "tab",
    "escape": "escape", "esc": "escape", "back": "back", "home": "home",
    "arrowup": "up", "arrowdown": "down", "arrowleft": "left", "arrowright": "right",
}
SCROLL_SWIPES = {  # finger movement that reveals content in that direction (as flows.SCROLL_SWIPES)
    "down": (0.5, 0.7, 0.5, 0.3),
    "up": (0.5, 0.3, 0.5, 0.7),
    "right": (0.8, 0.5, 0.2, 0.5),
    "left": (0.2, 0.5, 0.8, 0.5),
}
SCROLL_TO = {"scrolltobottom": "down", "scrolltotop": "up", "scrolltoright": "right", "scrolltoleft": "left"}
EDGE_SWIPES = 5
AI_ACTIONS = ("aiAct", "aiAction", "ai")
TAP_LIKE = {"aiTap": "Tap", "aiDoubleClick": "Double-tap", "aiLongPress": "Long-press",
            "aiRightClick": "Long-press"}
DATA_QUERIES = ("aiQuery", "aiBoolean", "aiNumber", "aiString", "aiAsk", "aiLocate")
TARGETS = ("android", "web", "ios", "harmony", "computer", "page", "browser")
OPTION_KEYS = {"locate", "value", "keyName", "scrollType", "direction", "distance", "timeout", "errorMessage",
               "name", "cacheable", "deepThink", "xpath", "prompt", "content", "title", "mode", "autoDismissKeyboard",
               "convertHttpImage2Base64", "domIncluded", "screenshotIncluded", "images"}


class MidsceneError(ValueError):
    pass


def looks_like_midscene(text: str) -> bool:
    return (re.search(r"^tasks\s*:", text, re.M) is not None
            and re.search(r"^\s*-?\s*flow\s*:", text, re.M) is not None)


def _is_link(value: str) -> bool:
    return bool(re.match(r"^[a-zA-Z][\w+.\-]*://\S+$", value))


def _launch_step(value: str) -> dict:
    return {"action": "open_url", "url": value} if _is_link(value) else {"action": "launch", "package": value}


def _command(item: dict) -> tuple[str, object]:
    keys = [k for k in item if k not in OPTION_KEYS]
    if len(keys) != 1:
        if not keys and "prompt" in item:
            return "aiAct", item["prompt"]
        raise MidsceneError(f"cannot tell which command this is: {sorted(item)}")
    return keys[0], item[keys[0]]


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _convert_item(item, where: str, warnings: list[str]) -> list[dict]:
    if isinstance(item, str):
        item = {item: None}
    if not isinstance(item, dict):
        raise MidsceneError(f"{where}: each flow item is a map like `- aiTap: the login button`")
    command, value = _command(item)
    prompt = _text(value)

    if command in AI_ACTIONS:
        if not prompt:
            raise MidsceneError(f"{where}: {command} needs a prompt")
        return [{"action": "ai", "goal": prompt}]
    if command in TAP_LIKE:
        if command == "aiRightClick":
            warnings.append(f"{where}: aiRightClick has no touch equivalent — done as a long-press")
        return [{"action": "ai", "goal": f"{TAP_LIKE[command]} {prompt}".strip()}]
    if command == "aiHover":
        warnings.append(f"{where}: aiHover skipped (touch screens have no hover)")
        return []
    if command == "aiInput":
        if "value" in item:
            locate, text = prompt, _text(item.get("value"))
        else:
            locate, text = _text(item.get("locate")), prompt
        target = f" into {locate}" if locate else " into the focused field"
        return [{"action": "ai", "goal": f"Type '{text}'{target}"}]
    if command == "aiKeyboardPress":
        key_name = _text(item.get("keyName")) or prompt
        if item.get("keyName") and prompt:
            warnings.append(f"{where}: aiKeyboardPress target '{prompt}' ignored — the key goes to the focused field")
        key = KEY_NAMES.get(key_name.replace(" ", "").lower())
        if key_name.lower() == "space":
            return [{"action": "text", "text": " "}]
        if key is None:
            if len(key_name) == 1:
                return [{"action": "text", "text": key_name}]
            warnings.append(f"{where}: key '{key_name}' has no Android equivalent — skipped")
            return []
        return [{"action": "key", "key": key}]
    if command == "aiScroll":
        scroll_type = _text(item.get("scrollType") or "singleAction").replace(" ", "").lower()
        direction = _text(item.get("direction") or "down").lower()
        if scroll_type in SCROLL_TO:
            direction, count = SCROLL_TO[scroll_type], EDGE_SWIPES
        else:
            count = 1
        if direction not in SCROLL_SWIPES:
            raise MidsceneError(f"{where}: direction must be up, down, left or right")
        if prompt:
            warnings.append(f"{where}: aiScroll inside '{prompt}' is done at the screen centre")
        if item.get("distance"):
            warnings.append(f"{where}: aiScroll distance ignored (one screen swipe per action)")
        x, y, x2, y2 = SCROLL_SWIPES[direction]
        return [{"action": "swipe", "x": x, "y": y, "x2": x2, "y2": y2, "duration_ms": 350} for _ in range(count)]
    if command == "aiAssert":
        if not prompt:
            raise MidsceneError(f"{where}: aiAssert needs a condition")
        step = {"action": "ai_assert", "condition": prompt}
        if item.get("errorMessage"):
            step["message"] = _text(item["errorMessage"])
        return [step]
    if command == "aiWaitFor":
        if not prompt:
            raise MidsceneError(f"{where}: aiWaitFor needs a condition")
        timeout = item.get("timeout", 15000)
        if not isinstance(timeout, (int, float)) or timeout <= 0:
            raise MidsceneError(f"{where}: timeout must be a positive number of milliseconds")
        return [{"action": "ai_assert", "condition": prompt, "timeout_ms": int(min(timeout, 600000))}]
    if command == "sleep":
        if not isinstance(value, (int, float)) or value < 0:
            raise MidsceneError(f"{where}: sleep takes milliseconds")
        return [{"action": "wait", "ms": int(min(value, 60000))}]
    if command == "launch":
        if not prompt:
            raise MidsceneError(f"{where}: launch needs a package or URL")
        return [_launch_step(prompt)]
    if command == "terminate":
        if not prompt:
            raise MidsceneError(f"{where}: terminate needs a package")
        return [{"action": "stop", "package": prompt}]
    if command in ("recordToReport", "logScreenshot"):
        name = _text(item.get("title")) or prompt or "screenshot"
        return [{"action": "screenshot", "name": name[:60]}]
    if command in DATA_QUERIES:
        warnings.append(f"{where}: {command} skipped (data extraction is not a Tether step)")
        return []
    if command in ("runAdbShell", "runWdaRequest", "javascript", "runGherkinScenario"):
        warnings.append(f"{where}: {command} not executed (Tether does not run arbitrary scripts from flows)")
        return []
    warnings.append(f"{where}: unknown Midscene command '{command}' skipped")
    return []


def midscene_to_flow(text: str) -> tuple[dict, list[str]]:
    """Convert a Midscene YAML script to a Tether flow. Returns (flow, warnings)."""
    try:
        documents = [d for d in maestro.load_documents(text) if d is not None]
    except maestro.MaestroError as exc:
        raise MidsceneError(str(exc)) from exc
    if len(documents) != 1 or not isinstance(documents[0], dict):
        raise MidsceneError("a Midscene script is one YAML map with `tasks:`")
    script = documents[0]
    tasks = script.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        raise MidsceneError("`tasks:` must be a non-empty list")
    warnings: list[str] = []
    steps: list[dict] = []

    targets = [key for key in TARGETS if key in script]
    if len(targets) > 1:
        warnings.append(f"several targets ({', '.join(targets)}); using the first")
    target = targets[0] if targets else None
    settings = script.get(target) if target else None
    settings = settings if isinstance(settings, dict) else {}
    if target == "android":
        if settings.get("deviceId"):
            warnings.append(f"deviceId {settings['deviceId']} ignored — pick the device in Tether (--serial)")
        if settings.get("launch"):
            steps.append(_launch_step(_text(settings["launch"])))
    elif target in ("web", "page", "browser"):
        url = _text(settings.get("url"))
        if url:
            steps.append({"action": "open_url", "url": url})
            warnings.append(f"web target: {url} opens in the phone's browser (viewport/cookie options ignored)")
        else:
            warnings.append("web target without url — steps run on whatever the phone shows")
    elif target:
        warnings.append(f"{target} target: Tether drives Android; the steps run on the selected phone")
    if script.get("agent"):
        warnings.append("agent settings ignored (Tether uses its own AI engine — TETHER_AI_ENGINE)")

    for task_index, task in enumerate(tasks):
        if not isinstance(task, dict) or not isinstance(task.get("flow"), list):
            raise MidsceneError(f"task {task_index + 1}: needs a `flow:` list")
        label = _text(task.get("name")) or f"task {task_index + 1}"
        optional = task.get("continueOnError") is True
        for item_index, item in enumerate(task["flow"]):
            where = f"{label} #{item_index + 1}"
            for step in _convert_item(item, where, warnings):
                if optional:
                    step["optional"] = True
                steps.append(step)

    if not steps:
        raise MidsceneError("nothing to run after conversion")
    name = _text(tasks[0].get("name")) if len(tasks) == 1 else ""
    flow = {"name": name or "midscene", "steps": steps}
    return flow, warnings
