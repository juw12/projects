"""Gatus alerts in, Beacon notifications out.

Gatus (https://github.com/TwiN/gatus, Apache-2.0) is a status page / uptime
checker. Its `custom` alerting provider POSTs a templated body to any URL; point
it at Beacon's POST /v1/hooks/gatus (with the app secret as a Bearer header) and
every TRIGGERED / RESOLVED alert becomes a push on all of Beacon's channels —
with targeting, digests for alert storms and escalation if nobody reacts.

Gatus fills placeholders by plain string replacement and only escapes quotes in
[RESULT_ERRORS], so an endpoint name, description or condition containing `"`
produces invalid JSON. parse_alert() therefore falls back to a lenient key scan.

Routing comes from the hook URL's query string (static in the Gatus config):
  tags=oncall,ops      only subscribers with these tags (default: everyone)
  users=alice,bob      only these user_ids
  channels=bark,ntfy   limit channels (default: all push channels)
  page=https://…       link opened on tap (default: the endpoint URL)
  escalate_after=600   re-send if the TRIGGERED push isn't clicked in time …
  escalate_channels=bark,gotify   … on these channels (default: same channels)
  digest=120           batch alerts arriving within 120 s into one push
  resolved=operational extra word(s) that mean RESOLVED (custom placeholders)
"""

from __future__ import annotations

import json
import re

KEYS = ("status", "name", "group", "url", "description", "errors", "conditions")
RESOLVED_WORDS = {"resolved", "ok", "up", "operational", "recovered", "healthy"}
TAG_SAFE = re.compile(r"[^\w:.\-]+")


class HookError(ValueError):
    pass


def _lenient(raw: str) -> dict:
    """Pull "key": "value" pairs out of almost-JSON, splitting on the known keys."""
    marker = re.compile(r'"(%s)"\s*:\s*"' % "|".join(KEYS))
    matches = list(marker.finditer(raw))
    found: dict[str, str] = {}
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(raw)
        chunk = raw[match.end():end].rstrip()
        chunk = re.sub(r'"\s*,?\s*}?\s*$', "", chunk) if index + 1 == len(matches) else re.sub(r'"\s*,\s*$', "", chunk)
        found[match.group(1)] = chunk.replace('\\"', '"')
    return found


def parse_alert(body: bytes) -> dict:
    """Gatus custom-alert body -> {status, name, group, url, description, errors, conditions}."""
    raw = body.decode("utf-8", "replace").strip()
    if not raw:
        raise HookError("empty body — configure alerting.custom.body in Gatus (see Beacon README)")
    alert: dict = {}
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            alert = {k: str(v) for k, v in parsed.items() if k in KEYS and v is not None}
    except json.JSONDecodeError:
        alert = _lenient(raw)
    if not alert:
        if raw.startswith("{"):
            raise HookError("could not read the Gatus alert body")
        upper = raw.upper()
        alert = {"status": "RESOLVED" if "RESOLVED" in upper else "TRIGGERED", "description": raw}
    return {key: alert.get(key, "").strip() for key in KEYS}


def is_resolved(status: str, extra_words: str = "") -> bool:
    words = RESOLVED_WORDS | {w.strip().lower() for w in extra_words.split(",") if w.strip()}
    return status.strip().lower() in words


def alert_tag(alert: dict) -> str:
    key = f"{alert['group']}-{alert['name']}".strip("-") or "endpoint"
    return ("gatus:" + TAG_SAFE.sub("-", key.lower()))[:64]


def _split(value: str) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


def _clip(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


def to_message(alert: dict, query: dict, default_channels: list[str]) -> tuple[dict, bool]:
    """Build a /v1/send body. Returns (body, resolved)."""
    resolved = is_resolved(alert["status"], query.get("resolved", ""))
    label = " / ".join(part for part in (alert["group"], alert["name"]) if part) or "Endpoint"
    if resolved:
        title = f"✅ {label} is back up"
        details = [alert["description"]]
    else:
        title = f"🔴 {label} is down"
        details = [alert["description"], alert["errors"]]
    body = {
        "title": _clip(title, 120),
        "body": _clip(" · ".join(d for d in details if d), 600),
        "urgency": "normal" if resolved else "high",
        "tag": alert_tag(alert),
        "data": {"source": "gatus", "status": "resolved" if resolved else "triggered",
                 "endpoint": _clip(label, 200)},
    }
    link = query.get("page") or alert["url"]
    if link.startswith(("https://", "http://")):
        body["url"] = link
    users, tags = _split(query.get("users", "")), _split(query.get("tags", ""))
    if users:
        body["target"] = {"user_ids": users}
    elif tags:
        body["target"] = {"tags": tags}
    else:
        body["target"] = {"all": True}
    channels = _split(query.get("channels", ""))
    if channels:
        body["channels"] = channels
    if query.get("digest"):
        body["digest"] = {"key": "gatus:" + ("resolved" if resolved else "triggered"),
                          "window": float(query["digest"]),
                          "title": "✅ {count} endpoints back up" if resolved else "🔴 {count} endpoints down"}
    if query.get("escalate_after") and not resolved:
        body["fallback"] = {"after": float(query["escalate_after"]), "unless": "clicked",
                            "channels": _split(query.get("escalate_channels", "")) or channels
                            or list(default_channels),
                            "title": _clip(f"Still down: {label}", 120)}
    return body, resolved
