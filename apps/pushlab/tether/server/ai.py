"""AI steps for Tether flows: plain-language goals and assertions (optional).

  {"action": "ai", "goal": "Log in as qa@example.com with password hunter2", "max_steps": 10}
  {"action": "ai_assert", "condition": "The dashboard shows a balance in euros"}

Works with any OpenAI-compatible chat-completions endpoint, local or hosted:

  TETHER_AI_URL    base URL, default http://127.0.0.1:11434/v1 (Ollama)
                   e.g. http://127.0.0.1:1234/v1 (LM Studio), https://api.openai.com/v1
  TETHER_AI_MODEL  model name, default qwen2.5vl:7b (a vision model in Ollama)
  TETHER_AI_KEY    API key, if the endpoint needs one
  TETHER_AI_VISION 1 (default) sends a downscaled screenshot with each request;
                   0 sends only the UI element list (for text-only models)

The model sees a numbered list of on-screen elements (from uiautomator) and,
with vision, the screenshot. It answers with one JSON action at a time; Tether
executes it and loops until the model says done/fail or max_steps is reached.
Nothing is sent anywhere unless a flow contains an ai/ai_assert step.
"""

from __future__ import annotations

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from adb import Adb, AdbError

DEFAULT_URL = "http://127.0.0.1:11434/v1"
DEFAULT_MODEL = "qwen2.5vl:7b"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
MAX_ELEMENTS = 80
SCREENSHOT_SIDE = 768

ACT_PROMPT = """You operate an Android phone to reach a goal. Each turn you get the goal, the
actions taken so far, and the current screen as a numbered element list (and a
screenshot when available). Reply with ONE JSON object and nothing else:

{"thought": "<short reasoning>", "action": "<tap|long_press|type|swipe|key|wait|done|fail>",
 "element": <number from the list, for tap/long_press/type>,
 "text": "<text to type, for type>",
 "direction": "<up|down|left|right: finger movement, for swipe>",
 "key": "<back|home|enter|recents, for key>",
 "reason": "<for done/fail: why>"}

Rules: tap a field before typing into it (or give element with type and it is
tapped for you). Use "done" only when the goal is visibly achieved on screen.
Use "fail" when the goal is impossible (error shown, missing feature).
Never invent element numbers that are not in the list."""

ASSERT_PROMPT = """You check a condition against the current Android screen (element list and,
when available, a screenshot). Reply with ONE JSON object and nothing else:
{"pass": true|false, "reason": "<one sentence citing what you see>"}"""


class AiConfig:
    def __init__(self, url: str | None = None, model: str | None = None, key: str | None = None,
                 vision: bool | None = None, timeout: float = 120.0):
        self.url = (url or os.environ.get("TETHER_AI_URL") or DEFAULT_URL).rstrip("/")
        self.model = model or os.environ.get("TETHER_AI_MODEL") or DEFAULT_MODEL
        self.key = key if key is not None else os.environ.get("TETHER_AI_KEY", "")
        if vision is None:
            vision = os.environ.get("TETHER_AI_VISION", "1") not in ("0", "false", "no")
        self.vision = vision
        self.timeout = timeout


def _opener(url: str):
    host = urllib.parse.urlparse(url).hostname or ""
    if host in LOCAL_HOSTS:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()


def parse_json_reply(content: str) -> dict:
    """Models wrap JSON in prose or ``` fences now and then; take the first object."""
    content = (content or "").strip()
    try:
        value = json.loads(content)
        if isinstance(value, dict):
            return value
    except ValueError:
        pass
    match = re.search(r"\{.*\}", content, re.S)
    if match:
        try:
            value = json.loads(match.group(0))
            if isinstance(value, dict):
                return value
        except ValueError:
            pass
    raise AdbError(f"the model did not answer with JSON: {content[:200]!r}")


def chat(config: AiConfig, system: str, user_text: str, png: bytes | None = None) -> dict:
    user_content: list[dict] | str = user_text
    if png is not None:
        user_content = [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
        ]
    body = {
        "model": config.model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_content}],
    }
    headers = {"Content-Type": "application/json"}
    if config.key:
        headers["Authorization"] = f"Bearer {config.key}"
    request = urllib.request.Request(config.url + "/chat/completions", data=json.dumps(body).encode(),
                                     headers=headers, method="POST")
    try:
        with _opener(config.url).open(request, timeout=config.timeout) as response:
            reply = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:300].decode("utf-8", "replace")
        raise AdbError(f"AI endpoint {config.url} answered {exc.code}: {detail}") from None
    except OSError as exc:
        raise AdbError(f"cannot reach the AI endpoint {config.url} ({exc}); start Ollama or set TETHER_AI_URL") from None
    try:
        content = reply["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise AdbError(f"unexpected AI response: {str(reply)[:200]}") from None
    return parse_json_reply(content)


def describe_screen(elements: list[dict], size: tuple[int, int]) -> tuple[str, dict[int, dict]]:
    """Numbered, compact element list for the prompt + lookup table."""
    useful = [e for e in elements if e["text"] or e["desc"] or e["clickable"] or e["focused"]]
    useful = [e for e in useful if e["bounds"][2] > e["bounds"][0] and e["bounds"][3] > e["bounds"][1]]
    table: dict[int, dict] = {}
    lines = [f"Screen {size[0]}x{size[1]} px. Elements:"]
    for number, element in enumerate(useful[:MAX_ELEMENTS], start=1):
        table[number] = element
        parts = [f"[{number}]", element["class"].rsplit(".", 1)[-1]]
        if element["text"]:
            parts.append(json.dumps(element["text"][:80], ensure_ascii=False))
        if element["desc"] and element["desc"] != element["text"]:
            parts.append("label=" + json.dumps(element["desc"][:80], ensure_ascii=False))
        if element["resource_id"]:
            parts.append("id=" + element["resource_id"].split(":id/")[-1])
        if element["clickable"]:
            parts.append("clickable")
        if element["focused"]:
            parts.append("focused")
        parts.append(f"at {element['center'][0]},{element['center'][1]}")
        lines.append(" ".join(parts))
    if len(useful) > MAX_ELEMENTS:
        lines.append(f"(+{len(useful) - MAX_ELEMENTS} more not listed; swipe to explore)")
    if not table:
        lines.append("(no labelled elements: rely on the screenshot or swipe)")
    return "\n".join(lines), table


def _observe(adb: Adb, serial: str, config: AiConfig) -> tuple[str, dict[int, dict], bytes | None]:
    elements = adb.ui_elements(serial)
    size = adb.display_size(serial)
    text, table = describe_screen(elements, size)
    png = adb.screenshot_scaled(serial, SCREENSHOT_SIDE)["png"] if config.vision else None
    return text, table, png


SWIPES = {"up": (0.5, 0.7, 0.5, 0.3), "down": (0.5, 0.3, 0.5, 0.7),
          "left": (0.8, 0.5, 0.2, 0.5), "right": (0.2, 0.5, 0.8, 0.5)}


def _element(table: dict[int, dict], decision: dict) -> dict:
    try:
        return table[int(decision.get("element"))]
    except (TypeError, ValueError, KeyError):
        raise AdbError(f"the model chose element {decision.get('element')!r}, which is not on screen") from None


def execute(adb: Adb, serial: str, decision: dict, table: dict[int, dict]) -> str:
    action = str(decision.get("action", "")).lower()
    if action in ("tap", "long_press"):
        element = _element(table, decision)
        if action == "tap":
            adb.tap(serial, *element["center"])
        else:
            adb.long_press(serial, *element["center"])
        return f"{action} [{decision['element']}] {element['text'] or element['desc'] or element['resource_id']}"
    if action == "type":
        if decision.get("element") is not None:
            element = _element(table, decision)
            adb.tap(serial, *element["center"])
            time.sleep(0.3)
        adb.text(serial, str(decision.get("text", "")))
        return f"type {json.dumps(str(decision.get('text', '')))}"
    if action == "swipe":
        direction = str(decision.get("direction", "up")).lower()
        if direction not in SWIPES:
            raise AdbError(f"the model asked for swipe direction {direction!r}")
        width, height = adb.display_size(serial)
        x1, y1, x2, y2 = SWIPES[direction]
        adb.swipe(serial, round(x1 * width), round(y1 * height), round(x2 * width), round(y2 * height), 350)
        return f"swipe {direction}"
    if action == "key":
        adb.key(serial, str(decision.get("key", "back")))
        return f"key {decision.get('key', 'back')}"
    if action == "wait":
        time.sleep(1.0)
        return "wait"
    raise AdbError(f"the model answered with an unknown action {action!r}")


def ai_act(adb: Adb, serial: str, goal: str, max_steps: int = 10, config: AiConfig | None = None,
           settle_s: float = 0.6) -> dict:
    """Loop observe -> ask -> act until the model reports done. Raises AdbError on fail/limit."""
    config = config or AiConfig()
    history: list[str] = []
    for turn in range(1, max(1, min(int(max_steps), 40)) + 1):
        screen, table, png = _observe(adb, serial, config)
        done_so_far = "\n".join(f"{i}. {h}" for i, h in enumerate(history, start=1)) or "(none yet)"
        decision = chat(config, ACT_PROMPT, f"Goal: {goal}\n\nActions so far:\n{done_so_far}\n\n{screen}", png)
        action = str(decision.get("action", "")).lower()
        if action == "done":
            return {"goal": goal, "turns": turn, "actions": history, "reason": decision.get("reason", "")}
        if action == "fail":
            raise AdbError(f"AI could not reach the goal: {decision.get('reason') or decision.get('thought') or 'no reason'}")
        history.append(execute(adb, serial, decision, table))
        time.sleep(settle_s)
    raise AdbError(f"AI did not finish within {max_steps} actions: {'; '.join(history[-4:])}")


def ai_assert(adb: Adb, serial: str, condition: str, config: AiConfig | None = None) -> dict:
    config = config or AiConfig()
    screen, _table, png = _observe(adb, serial, config)
    verdict = chat(config, ASSERT_PROMPT, f"Condition: {condition}\n\n{screen}", png)
    passed = verdict.get("pass")
    if isinstance(passed, str):
        passed = passed.strip().lower() in ("true", "yes", "pass")
    if passed is not True:
        raise AdbError(f"AI assertion failed: {verdict.get('reason') or 'condition not met'}")
    return {"condition": condition, "reason": verdict.get("reason", "")}
