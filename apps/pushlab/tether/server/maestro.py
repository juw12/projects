"""Maestro (https://maestro.dev, Apache-2.0) flow import/export for Tether.

Maestro flows are YAML: an optional header (appId, name, tags…), `---`, then
a list of commands. This module converts the commonly used command set to
Tether's JSON flow steps and back, so teams can bring existing Maestro tests
to Tether (run them from the browser, add Beacon push steps) and hand Tether
flows back to `maestro test`.

Zero dependencies: a small YAML-subset parser that covers what Maestro files
use (block maps/lists, flow [..] / {..}, quoted scalars, comments, `---`).
Anything not convertible is reported as a warning — never silently dropped.
"""

from __future__ import annotations

import json
import re

DEFAULT_TIMEOUT_MS = 8000


class MaestroError(ValueError):
    pass


# ======================================================================= YAML
def _strip_comment(line: str) -> str:
    quote = None
    for index, char in enumerate(line):
        if quote:
            if char == quote and (quote == "'" or line[index - 1] != "\\"):
                quote = None
        elif char in "\"'" and (index == 0 or line[index - 1] in " \t:[{,-"):
            quote = char
        elif char == "#" and (index == 0 or line[index - 1] in " \t"):
            return line[:index].rstrip()
    return line.rstrip()


def _split_flow(text: str) -> list[str]:
    """Split the inside of [..] or {..} on top-level commas."""
    parts, depth, quote, current = [], 0, None, ""
    for index, char in enumerate(text):
        if quote:
            current += char
            if char == quote and (quote == "'" or text[index - 1] != "\\"):
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(current.strip())
            current = ""
            continue
        current += char
    if current.strip():
        parts.append(current.strip())
    return parts


def _split_key(text: str) -> tuple[str, str] | None:
    """'key: value' → (key, value); None when the text is not a mapping entry."""
    quote = None
    for index, char in enumerate(text):
        if quote:
            if char == quote:
                quote = None
        elif char in "\"'" and index == 0:
            quote = char
        elif char == ":" and (index + 1 == len(text) or text[index + 1] in " \t"):
            key = text[:index].strip()
            if key.startswith(("\"", "'")):
                key = key[1:-1]
            return key, text[index + 1:].strip()
        elif char in "{[" and index == 0:
            return None
    return None


def parse_scalar(text: str):
    text = text.strip()
    if text == "" or text in ("~", "null", "Null", "NULL"):
        return None
    if text.startswith("\""):
        if not text.endswith("\"") or len(text) == 1:
            raise MaestroError(f"unterminated string: {text}")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text[1:-1]
    if text.startswith("'"):
        if not text.endswith("'") or len(text) == 1:
            raise MaestroError(f"unterminated string: {text}")
        return text[1:-1].replace("''", "'")
    if text.startswith("[") and text.endswith("]"):
        return [parse_scalar(part) for part in _split_flow(text[1:-1])]
    if text.startswith("{") and text.endswith("}"):
        result = {}
        for part in _split_flow(text[1:-1]):
            pair = _split_key(part)
            if pair is None:
                raise MaestroError(f"bad flow mapping entry: {part}")
            result[pair[0]] = parse_scalar(pair[1])
        return result
    if text in ("true", "True", "TRUE"):
        return True
    if text in ("false", "False", "FALSE"):
        return False
    if re.fullmatch(r"[-+]?\d+", text):
        return int(text)
    if re.fullmatch(r"[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?", text):
        return float(text)
    return text


class _Lines:
    def __init__(self, text: str):
        self.items: list[tuple[int, str, int]] = []
        for number, raw in enumerate(text.splitlines(), start=1):
            if "\t" in raw[: len(raw) - len(raw.lstrip())]:
                raise MaestroError(f"line {number}: tabs are not allowed for indentation")
            line = _strip_comment(raw)
            if line.strip():
                self.items.append((len(line) - len(line.lstrip()), line.strip(), number))
        self.pos = 0

    def peek(self):
        return self.items[self.pos] if self.pos < len(self.items) else None


def _parse_block(lines: _Lines, indent: int):
    first = lines.peek()
    if first is None or first[0] < indent:
        return None
    if first[1] == "-" or first[1].startswith("- "):
        return _parse_list(lines, first[0])
    return _parse_map(lines, first[0])


def _parse_value(lines: _Lines, rest: str, parent_indent: int, number: int):
    if rest in ("|", ">", "|-", ">-", "|+", ">+"):
        return _parse_block_scalar(lines, parent_indent, folded=rest.startswith(">"))
    if rest:
        return parse_scalar(rest)
    nxt = lines.peek()
    if nxt and nxt[0] > parent_indent:
        return _parse_block(lines, nxt[0])
    if nxt and nxt[0] == parent_indent and (nxt[1] == "-" or nxt[1].startswith("- ")):
        return _parse_list(lines, parent_indent)  # "key:\n- a" (list at same indent)
    return None


def _parse_block_scalar(lines: _Lines, parent_indent: int, folded: bool) -> str:
    collected = []
    while lines.peek() and lines.peek()[0] > parent_indent:
        collected.append(lines.peek()[1])
        lines.pos += 1
    return (" " if folded else "\n").join(collected)


def _parse_map(lines: _Lines, indent: int) -> dict:
    result = {}
    while True:
        item = lines.peek()
        if item is None or item[0] < indent:
            return result
        level, text, number = item
        if level > indent:
            raise MaestroError(f"line {number}: unexpected indentation")
        if text.startswith("- ") or text == "-":
            return result
        pair = _split_key(text)
        if pair is None:
            raise MaestroError(f"line {number}: expected 'key: value', got {text!r}")
        lines.pos += 1
        result[pair[0]] = _parse_value(lines, pair[1], indent, number)


def _parse_list(lines: _Lines, indent: int) -> list:
    result = []
    while True:
        item = lines.peek()
        if item is None or item[0] < indent:
            return result
        level, text, number = item
        if level > indent:
            raise MaestroError(f"line {number}: unexpected indentation")
        if not (text == "-" or text.startswith("- ")):
            return result
        body = text[1:].strip()
        lines.pos += 1
        if not body:
            nxt = lines.peek()
            result.append(_parse_block(lines, nxt[0]) if nxt and nxt[0] > indent else None)
            continue
        pair = _split_key(body)
        if pair is None:
            result.append(parse_scalar(body))
            continue
        # "- key: value" starts a mapping whose other keys sit at indent + 2 (or deeper)
        child_indent = indent + (len(text) - len(body))
        entry = {pair[0]: _parse_value(lines, pair[1], child_indent, number)}
        nxt = lines.peek()
        if nxt and nxt[0] == child_indent and not nxt[1].startswith("- "):
            entry.update(_parse_map(lines, child_indent))
        result.append(entry)


def load_documents(text: str) -> list:
    """Parse a (multi-document) YAML string with the subset Maestro uses."""
    documents, current = [], []
    for raw in text.replace("\r\n", "\n").split("\n"):
        if raw.strip() == "---" or raw.startswith("--- "):
            documents.append("\n".join(current))
            current = []
        else:
            current.append(raw)
    documents.append("\n".join(current))
    parsed = []
    for doc in documents:
        lines = _Lines(doc)
        if lines.peek() is None:
            parsed.append(None)
            continue
        value = _parse_block(lines, lines.peek()[0])
        if lines.peek() is not None:
            raise MaestroError(f"line {lines.peek()[2]}: could not parse {lines.peek()[1]!r}")
        parsed.append(value)
    return parsed


# ============================================================ Maestro → Tether
KEY_TO_TETHER = {
    "enter": "enter", "home": "home", "back": "back", "backspace": "delete", "delete": "delete",
    "volume up": "volume_up", "volume down": "volume_down", "power": "power", "lock": "sleep",
    "tab": "tab", "escape": "escape", "remote dpad up": "up", "remote dpad down": "down",
    "remote dpad left": "left", "remote dpad right": "right", "app switch": "recents",
    "menu": "menu",
}
KEY_TO_MAESTRO = {
    "enter": "Enter", "home": "Home", "delete": "Backspace", "volume_up": "Volume Up",
    "volume_down": "Volume Down", "power": "Power", "sleep": "Lock", "tab": "Tab", "escape": "Escape",
    "up": "Remote Dpad Up", "down": "Remote Dpad Down", "left": "Remote Dpad Left",
    "right": "Remote Dpad Right", "recents": "App Switch", "menu": "Menu",
}
SWIPE_DIRECTIONS = {
    "LEFT": (0.9, 0.5, 0.1, 0.5),
    "RIGHT": (0.1, 0.5, 0.9, 0.5),
    "UP": (0.5, 0.8, 0.5, 0.2),
    "DOWN": (0.5, 0.2, 0.5, 0.8),
}
NO_DEFECTS_CONDITION = ("The screen has no visual defects: no cut-off or overlapping text, no broken or "
                        "misaligned layout, no placeholder or garbled text, no error messages.")
UNSUPPORTED = {
    "runFlow", "runScript", "evalScript", "repeat", "retry", "assertTrue", "copyTextFrom", "pasteText",
    "setLocation", "travel", "addMedia", "startRecording", "stopRecording", "extractTextWithAI", "inputRandomText", "inputRandomNumber",
    "inputRandomEmail", "inputRandomPersonName", "setAirplaneMode", "toggleAirplaneMode", "setOrientation",
}
IGNORED_KEYS = {"label", "optional", "waitToSettleTimeoutMs", "retryTapIfNoChange", "repeat", "delay",
                "waitUntilVisible", "enabled", "checked", "focused", "selected"}


def _percent_point(value) -> tuple[float, float] | None:
    """'50%,30%' → (0.5, 0.3); absolute pixel points return None."""
    if not isinstance(value, str):
        return None
    parts = [p.strip() for p in value.split(",")]
    if len(parts) != 2 or not all(p.endswith("%") for p in parts):
        return None
    try:
        x, y = (float(p[:-1]) / 100 for p in parts)
    except ValueError:
        return None
    if not (0 <= x <= 1 and 0 <= y <= 1):
        return None
    return round(x, 4), round(y, 4)


def _clean_text(pattern: str, warnings: list, where: str) -> str:
    """Maestro text selectors are regexes; Tether matches substrings."""
    text = pattern
    if text.startswith(".*"):
        text = text[2:]
    if text.endswith(".*"):
        text = text[:-2]
    if re.search(r"(?<!\\)[\[\]()|+?^$*]", text):
        warnings.append(f"{where}: regex {pattern!r} matched as plain text")
    return re.sub(r"\\(.)", r"\1", text)


def _selector(value, warnings: list, where: str) -> dict:
    if isinstance(value, str):
        return {"text": _clean_text(value, warnings, where)}
    if not isinstance(value, dict):
        raise MaestroError(f"{where}: expected a selector")
    selector = {}
    if value.get("text") is not None:
        selector["text"] = _clean_text(str(value["text"]), warnings, where)
    if value.get("id") is not None:
        selector["resource_id"] = _clean_text(str(value["id"]), warnings, where)
    for key in ("index", "below", "above", "leftOf", "rightOf", "childOf", "containsChild",
                "containsDescendants", "traits", "width", "height", "tolerance"):
        if key in value:
            warnings.append(f"{where}: selector option {key!r} is not supported and was ignored")
    return selector


def _command(item) -> tuple[str, object]:
    if isinstance(item, str):
        return item, None
    if isinstance(item, dict) and len(item) >= 1:
        name = next(iter(item))
        return name, item[name]
    raise MaestroError(f"cannot read command {item!r}")


def _timeout(value, default=DEFAULT_TIMEOUT_MS) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def maestro_to_flow(text: str) -> tuple[dict, list[str]]:
    """Convert Maestro YAML to a Tether flow. Returns (flow, warnings)."""
    documents = load_documents(text)
    if len(documents) == 1:
        header, commands = {}, documents[0]
    else:
        header, commands = documents[0] or {}, documents[1]
    if not isinstance(header, dict):
        raise MaestroError("the first document must be the header (appId: …)")
    if not isinstance(commands, list):
        raise MaestroError("expected a list of commands after ---")
    app_id = header.get("appId") or ""
    warnings: list[str] = []
    steps: list[dict] = []

    def package_of(value) -> str:
        if isinstance(value, dict):
            return value.get("appId") or app_id
        if isinstance(value, str) and value:
            return value
        return app_id

    for number, item in enumerate(commands, start=1):
        name, value = _command(item)
        where = f"command {number} ({name})"
        optional = isinstance(value, dict) and value.get("optional") is True
        start = len(steps)
        if name == "launchApp":
            package = package_of(value)
            if not package:
                raise MaestroError(f"{where}: no appId in the header or the command")
            options = value if isinstance(value, dict) else {}
            if options.get("clearState"):
                steps.append({"action": "clear_data", "package": package})
            if options.get("stopApp", True) and not options.get("clearState"):
                steps.append({"action": "stop", "package": package})
            steps.append({"action": "launch", "package": package})
            for key in ("arguments", "permissions", "clearKeychain"):
                if key in options:
                    warnings.append(f"{where}: {key} is not supported and was ignored")
        elif name in ("stopApp", "killApp"):
            steps.append({"action": "stop", "package": package_of(value)})
        elif name == "clearState":
            steps.append({"action": "clear_data", "package": package_of(value)})
        elif name in ("tapOn", "doubleTapOn", "longPressOn"):
            action = "long_press" if name == "longPressOn" else "tap"
            point = _percent_point(value.get("point")) if isinstance(value, dict) else None
            if isinstance(value, dict) and "point" in value and point is None:
                warnings.append(f"{where}: absolute point {value['point']!r} skipped (use percentages)")
                continue
            if point:
                step = {"action": action, "x": point[0], "y": point[1]}
            else:
                selector = _selector(value, warnings, where)
                if not selector:
                    warnings.append(f"{where}: no text/id/point — skipped")
                    continue
                step = {"action": "tap_element" if action == "tap" else "long_press", **selector}
            steps.append(step)
            if name == "doubleTapOn":
                steps.append(dict(step))
                warnings.append(f"{where}: double tap approximated by two taps")
        elif name == "inputText":
            steps.append({"action": "text", "text": str(value if not isinstance(value, dict) else value.get("text", ""))})
        elif name == "eraseText":
            count = value.get("charactersToErase", 50) if isinstance(value, dict) else (value or 50)
            steps.append({"action": "key", "key": "delete", "times": min(int(count), 200)})
        elif name in ("assertVisible", "assertNotVisible"):
            selector = _selector(value, warnings, where)
            steps.append({"action": "assert_text" if name == "assertVisible" else "assert_gone", **selector})
        elif name == "extendedWaitUntil":
            options = value if isinstance(value, dict) else {}
            timeout = _timeout(options.get("timeout"))
            if "visible" in options:
                steps.append({"action": "wait_for", **_selector(options["visible"], warnings, where),
                              "timeout_ms": timeout})
            elif "notVisible" in options:
                steps.append({"action": "assert_gone", **_selector(options["notVisible"], warnings, where),
                              "timeout_ms": timeout})
            else:
                warnings.append(f"{where}: needs visible or notVisible — skipped")
        elif name == "pressKey":
            key = KEY_TO_TETHER.get(str(value).strip().lower())
            if key is None:
                warnings.append(f"{where}: key {value!r} is not supported — skipped")
                continue
            steps.append({"action": "key", "key": key})
        elif name == "back":
            steps.append({"action": "key", "key": "back"})
        elif name == "hideKeyboard":
            steps.append({"action": "key", "key": "escape"})
        elif name == "swipe":
            options = value if isinstance(value, dict) else {}
            duration = _timeout(options.get("duration"), 400)
            if "direction" in options:
                coords = SWIPE_DIRECTIONS.get(str(options["direction"]).upper())
                if coords is None:
                    warnings.append(f"{where}: unknown direction {options['direction']!r} — skipped")
                    continue
            elif "start" in options and "end" in options:
                start_point, end_point = _percent_point(options["start"]), _percent_point(options["end"])
                if not (start_point and end_point):
                    warnings.append(f"{where}: absolute swipe coordinates skipped (use percentages)")
                    continue
                coords = (*start_point, *end_point)
            else:
                warnings.append(f"{where}: needs direction or start/end — skipped")
                continue
            if "from" in options:
                warnings.append(f"{where}: 'from' element swipes use screen coordinates instead")
            steps.append({"action": "swipe", "x": coords[0], "y": coords[1], "x2": coords[2], "y2": coords[3],
                          "duration_ms": duration})
        elif name == "scroll":
            steps.append({"action": "swipe", "x": 0.5, "y": 0.7, "x2": 0.5, "y2": 0.3, "duration_ms": 400})
        elif name == "scrollUntilVisible":
            options = value if isinstance(value, dict) else {"element": value}
            selector = _selector(options.get("element"), warnings, where)
            steps.append({"action": "scroll_until_visible", **selector,
                          "direction": str(options.get("direction", "DOWN")).lower(),
                          "timeout_ms": _timeout(options.get("timeout"), 20000)})
        elif name == "takeScreenshot":
            label = value.get("path") if isinstance(value, dict) else value
            steps.append({"action": "screenshot", "name": str(label or "screenshot")})
        elif name == "waitForAnimationToEnd":
            timeout = _timeout(value.get("timeout") if isinstance(value, dict) else None, 1000)
            steps.append({"action": "wait", "ms": min(timeout, 5000)})
        elif name == "assertWithAI":
            assertion = value.get("assertion") if isinstance(value, dict) else value
            if not assertion:
                warnings.append(f"{where}: assertWithAI without an assertion — skipped")
                continue
            steps.append({"action": "ai_assert", "condition": str(assertion)})
        elif name == "assertNoDefectsWithAI":
            steps.append({"action": "ai_assert", "condition": NO_DEFECTS_CONDITION})
        elif name == "openLink":
            link = value.get("link") if isinstance(value, dict) else value
            steps.append({"action": "open_url", "url": str(link)})
        elif name in UNSUPPORTED:
            warnings.append(f"{where}: not supported by Tether — skipped")
            continue
        else:
            warnings.append(f"{where}: unknown command — skipped")
            continue
        if optional:
            for step in steps[start:]:
                step["optional"] = True
        if isinstance(value, dict):
            for key in value:
                if key in IGNORED_KEYS - {"optional", "label"}:
                    warnings.append(f"{where}: option {key!r} ignored")
    flow = {"name": header.get("name") or (f"Maestro: {app_id}" if app_id else "Maestro flow"), "steps": steps}
    if app_id:
        flow["app_id"] = app_id
    if header.get("tags"):
        flow["tags"] = header["tags"]
    return flow, warnings


# ============================================================ Tether → Maestro
def _q(value) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def _pct(x: float, y: float) -> str:
    return f"\"{round(x * 100)}%, {round(y * 100)}%\""


def _maestro_selector(step: dict) -> str:
    keys = {k: step[k] for k in ("text", "resource_id", "desc") if step.get(k)}
    if set(keys) == {"text"}:
        return _q(keys["text"])
    parts = []
    if "text" in keys:
        parts.append(f"text: {_q(keys['text'])}")
    if "resource_id" in keys:
        parts.append(f"id: {_q(keys['resource_id'])}")
    if "desc" in keys and "text" not in keys:
        parts.append(f"text: {_q(keys['desc'])}")  # Maestro matches content descriptions via text
    return "{ " + ", ".join(parts) + " }"


SELECTOR_COMMANDS = {"tapOn", "longPressOn", "assertVisible", "assertNotVisible"}


def _mark_optional(out: list[str], warnings: list, where: str) -> list[str]:
    head = out[0]
    if head.endswith(":"):
        return [head, "    optional: true"] + out[1:]
    match = re.match(r"- (\w+)(?:: (.+))?$", head)
    if not match:
        return out
    name, value = match.group(1), match.group(2)
    if value is None:
        return [f"- {name}:", "    optional: true"] + out[1:]
    if value.startswith("{"):
        return [f"- {name}: {{ {value[1:-1].strip()}, optional: true }}"] + out[1:]
    if value.startswith("\"") and name in SELECTOR_COMMANDS:
        return [f"- {name}:", f"    text: {value}", "    optional: true"] + out[1:]
    warnings.append(f"{where}: 'optional' cannot be expressed for {name} and was dropped")
    return out


def flow_to_maestro(flow: dict) -> tuple[str, list[str]]:
    """Convert a Tether flow to Maestro YAML. Returns (yaml, warnings)."""
    steps = [dict(step) for step in flow.get("steps") or []]  # never mutate the caller's flow
    warnings: list[str] = []
    app_id = flow.get("app_id") or next((s["package"] for s in steps if s.get("action") == "launch"), "")
    lines = [f"appId: {app_id or 'com.example.app'}"]
    if not app_id:
        warnings.append("no launch step: set appId in the header before running with Maestro")
    if flow.get("name"):
        lines.append(f"name: {_q(flow['name'])}")
    if flow.get("tags"):
        lines.append("tags:")
        lines.extend(f"  - {_q(tag)}" for tag in flow["tags"])
    lines.append("---")
    skip_next_stop = False
    for index, step in enumerate(steps):
        action = step.get("action")
        nxt = steps[index + 1] if index + 1 < len(steps) else {}
        where = f"step {index + 1} ({action})"
        out: list[str] = []
        if action == "stop" and nxt.get("action") == "launch" and nxt.get("package") == step.get("package"):
            skip_next_stop = True  # stop + launch == Maestro's default launchApp
            continue
        if action == "clear_data" and nxt.get("action") == "launch" and nxt.get("package") == step.get("package"):
            out = ["- launchApp:", f"    appId: {_q(step['package'])}", "    clearState: true"]
            steps[index + 1] = {**nxt, "action": "_consumed"}
        elif action == "_consumed":
            continue
        elif action == "launch":
            if skip_next_stop:
                out = ["- launchApp"] if step["package"] == app_id else [f"- launchApp: {_q(step['package'])}"]
            else:
                out = ["- launchApp:", f"    appId: {_q(step['package'])}", "    stopApp: false"]
            skip_next_stop = False
        elif action == "stop":
            out = ["- stopApp"] if step["package"] == app_id else [f"- stopApp: {_q(step['package'])}"]
        elif action == "clear_data":
            out = ["- clearState"] if step["package"] == app_id else [f"- clearState: {_q(step['package'])}"]
        elif action == "tap":
            out = ["- tapOn:", f"    point: {_pct(step['x'], step['y'])}"]
        elif action == "long_press":
            if "x" in step:
                out = ["- longPressOn:", f"    point: {_pct(step['x'], step['y'])}"]
            else:
                out = [f"- longPressOn: {_maestro_selector(step)}"]
        elif action == "swipe":
            out = ["- swipe:", f"    start: {_pct(step['x'], step['y'])}", f"    end: {_pct(step['x2'], step['y2'])}",
                   f"    duration: {int(step.get('duration_ms', 300))}"]
        elif action == "text":
            out = [f"- inputText: {_q(step['text'])}"]
        elif action == "key":
            key = str(step["key"]).lower()
            times = int(step.get("times", 1))
            if key == "delete" and times > 1:
                out = [f"- eraseText: {times}"]
            elif key == "back":
                out = ["- back"] * times
            elif key in KEY_TO_MAESTRO:
                out = [f"- pressKey: {KEY_TO_MAESTRO[key]}"] * times
            else:
                warnings.append(f"{where}: key {step['key']!r} has no Maestro equivalent")
                out = [f"# tether: {json.dumps(step, ensure_ascii=False)}"]
        elif action == "tap_element":
            out = [f"- tapOn: {_maestro_selector(step)}"]
        elif action in ("wait_for", "assert_text"):
            timeout = step.get("timeout_ms")
            if timeout and int(timeout) != DEFAULT_TIMEOUT_MS or action == "wait_for":
                out = ["- extendedWaitUntil:", f"    visible: {_maestro_selector(step)}",
                       f"    timeout: {int(timeout or DEFAULT_TIMEOUT_MS)}"]
            else:
                out = [f"- assertVisible: {_maestro_selector(step)}"]
        elif action == "assert_gone":
            timeout = step.get("timeout_ms")
            if timeout:
                out = ["- extendedWaitUntil:", f"    notVisible: {_maestro_selector(step)}",
                       f"    timeout: {int(timeout)}"]
            else:
                out = [f"- assertNotVisible: {_maestro_selector(step)}"]
        elif action == "wait":
            out = ["- waitForAnimationToEnd:", f"    timeout: {int(step.get('ms', 500))}"]
            warnings.append(f"{where}: Maestro has no fixed sleep; exported as waitForAnimationToEnd")
        elif action == "screenshot":
            out = [f"- takeScreenshot: {_q(step.get('name') or 'screenshot')}"]
        elif action == "ai_assert":
            if step.get("condition") == NO_DEFECTS_CONDITION:
                out = ["- assertNoDefectsWithAI"]
            else:
                out = ["- assertWithAI:", f"    assertion: {_q(step['condition'])}"]
        elif action == "open_url":
            out = [f"- openLink: {_q(step['url'])}"]
        elif action == "scroll_until_visible":
            out = ["- scrollUntilVisible:", f"    element: {_maestro_selector(step)}",
                   f"    direction: {str(step.get('direction', 'down')).upper()}",
                   f"    timeout: {int(step.get('timeout_ms', 20000))}"]
        else:
            warnings.append(f"{where}: Tether-only step kept as a comment")
            out = [f"# tether: {json.dumps(step, ensure_ascii=False)}"]
        if step.get("optional") and out and out[0].startswith("- "):
            out = _mark_optional(out, warnings, where)
        lines.extend(out)
    return "\n".join(lines) + "\n", warnings


def looks_like_maestro(text: str) -> bool:
    stripped = text.lstrip()
    return not stripped.startswith("{") and ("appId:" in text or re.search(r"^\s*-\s+\w+", text, re.M) is not None)
