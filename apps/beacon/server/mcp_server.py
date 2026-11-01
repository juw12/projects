"""Beacon MCP server — manage push notifications from Claude, Cursor, VS Code, OpenCode…

Talks to a running Beacon server over its HTTP API (stdio JSON-RPC 2.0,
standard library only).

  {
    "mcpServers": {
      "beacon": {
        "command": "python",
        "args": ["C:/path/to/apps/beacon/server/mcp_server.py"],
        "env": {"BEACON_URL": "https://push.example.com", "BEACON_ADMIN_TOKEN": "adm_…"}
      }
    }
  }
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

SERVER_INFO = {"name": "beacon", "version": "0.1.0"}
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")


_LOOPBACK = {"127.0.0.1", "localhost", "::1"}
_DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def open_url(request, timeout):
    """urlopen that never routes loopback traffic through a system/corporate proxy."""
    host = urllib.parse.urlparse(request.full_url).hostname or ""
    if host in _LOOPBACK:
        return _DIRECT_OPENER.open(request, timeout=timeout)
    return urllib.request.urlopen(request, timeout=timeout)

TARGET_SCHEMA = {
    "type": "object",
    "description": "Who receives it. Omit for everyone.",
    "properties": {
        "all": {"type": "boolean"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "match": {"type": "string", "enum": ["any", "all"]},
        "user_ids": {"type": "array", "items": {"type": "string"}},
        "exclude_tags": {"type": "array", "items": {"type": "string"}},
    },
}

TOOLS = [
    {
        "name": "list_apps",
        "description": "List Beacon apps with ids, public keys and subscriber counts per channel.",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "create_app",
        "description": "Create a new app (one per product). Returns the public key for the web snippet and the secret key (shown once).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "subject": {"type": "string", "description": "VAPID contact, mailto:… or https://…"},
                "origins": {"type": "string", "description": "Comma-separated allowed web origins (optional)"},
            },
            "required": ["name"],
            "additionalProperties": False,
        },
    },
    {
        "name": "app_stats",
        "description": "Subscribers and delivery / click stats for an app over the last N days.",
        "inputSchema": {
            "type": "object",
            "properties": {"app_id": {"type": "integer"}, "days": {"type": "integer", "default": 30}},
            "required": ["app_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "send_notification",
        "description": (
            "Send (or schedule) a push notification. Channels: webpush (browsers/PWAs), fcm (native "
            "Android), ntfy (ntfy app topics), bark (iPhone Bark app), gotify (self-hosted Gotify), "
            "apprise (Telegram/Slack/Discord/email… contacts), inapp "
            "(banner inside the app). Default: all push channels. Give send_at (ISO 8601 with offset) to schedule, "
            "digest to batch bursts, fallback to escalate unread messages to another channel."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "integer"},
                "title": {"type": "string", "maxLength": 120},
                "body": {"type": "string", "maxLength": 600},
                "url": {"type": "string", "description": "Page to open on tap"},
                "image": {"type": "string"},
                "target": TARGET_SCHEMA,
                "channels": {"type": "array", "items": {"type": "string", "enum": ["webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"]}},
                "urgency": {"type": "string", "enum": ["very-low", "low", "normal", "high"]},
                "ttl": {"type": "integer", "description": "Seconds the push service keeps trying (default 86400)"},
                "send_at": {"type": "string", "description": "ISO 8601 with timezone, e.g. 2026-11-03T09:00:00+07:00"},
                "data": {"type": "object"},
                "digest": {
                    "type": "object",
                    "description": "Batch messages with the same key arriving within `window` seconds into one "
                                   "notification, e.g. {\"key\": \"comments:post42\", \"window\": 600, "
                                   "\"title\": \"{count} new comments\"}",
                    "properties": {"key": {"type": "string"}, "window": {"type": "number"}, "title": {"type": "string"}},
                    "required": ["key"],
                },
                "fallback": {
                    "type": "object",
                    "description": "Escalate if nobody clicked (or it was not shown/delivered) `after` seconds after "
                                   "sending, on other channels, e.g. {\"after\": 3600, \"unless\": \"clicked\", "
                                   "\"channels\": [\"ntfy\"], \"title\": \"Reminder: ...\"}",
                    "properties": {
                        "after": {"type": "number"},
                        "unless": {"type": "string", "enum": ["clicked", "shown", "delivered"]},
                        "channels": {"type": "array", "items": {"type": "string", "enum": ["webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"]}},
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                    },
                    "required": ["channels"],
                },
            },
            "required": ["app_id", "title"],
            "additionalProperties": False,
        },
    },
    {
        "name": "add_contact",
        "description": (
            "Add an ntfy topic (e.g. https://ntfy.sh/team-alerts — anyone with the ntfy app subscribed gets it), "
            "a Bark device URL (https://api.day.app/<device_key> from the iPhone Bark app), a Gotify server "
            "(https://push.example.com + the app token as secret; host must be in BEACON_GOTIFY_HOSTS) "
            "or an Apprise URL (tgram://bot/chat, slack://…, discord://…, mailto://… — needs pip install apprise "
            "on the Beacon server) as a subscriber of an app. Tags/user_id work like any subscriber."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "integer"},
                "channel": {"type": "string", "enum": ["ntfy", "bark", "gotify", "apprise"]},
                "address": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "user_id": {"type": "string"},
                "secret": {"type": "string", "description": "ntfy access token (optional) or Gotify app token (required)"},
                "label": {"type": "string"},
            },
            "required": ["app_id", "channel", "address"],
            "additionalProperties": False,
        },
    },
    {
        "name": "list_messages",
        "description": "Recent notifications for an app with status and stats (targeted, delivered, failed, pruned, shown, clicked).",
        "inputSchema": {
            "type": "object",
            "properties": {"app_id": {"type": "integer"}, "limit": {"type": "integer", "default": 20}},
            "required": ["app_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "cancel_message",
        "description": "Cancel a scheduled (still queued) notification.",
        "inputSchema": {
            "type": "object",
            "properties": {"message_id": {"type": "integer"}},
            "required": ["message_id"],
            "additionalProperties": False,
        },
    },
    {
        "name": "integration_snippet",
        "description": "Code to add Beacon to a web app (page snippet + service-worker line) and a curl example for sending.",
        "inputSchema": {
            "type": "object",
            "properties": {"app_id": {"type": "integer"}},
            "required": ["app_id"],
            "additionalProperties": False,
        },
    },
]


class BeaconClient:
    def __init__(self, base_url: str, token: str):
        self.base = base_url.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        if not self.token:
            raise RuntimeError("BEACON_ADMIN_TOKEN is not set for the MCP server")
        request = urllib.request.Request(
            self.base + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with open_url(request, 30) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read()).get("error", exc.reason)
            except ValueError:
                message = exc.reason
            raise RuntimeError(f"Beacon {exc.code}: {message}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"cannot reach Beacon at {self.base}: {exc.reason}") from exc


def run_tool(client: BeaconClient, name: str, args: dict):
    if name == "list_apps":
        apps = client.call("GET", "/v1/apps")["apps"]
        return [
            {"id": a["id"], "name": a["name"], "app_key": a["app_key"],
             "subscribers": a.get("subscribers", {}), "fcm_configured": a["fcm_configured"]}
            for a in apps
        ]
    if name == "create_app":
        result = client.call("POST", "/v1/apps", args)
        return {
            "app_id": result["app"]["id"],
            "app_key": result["app"]["app_key"],
            "secret_key": result["secret_key"],
            "note": "Store the secret key now; it is not shown again.",
        }
    if name == "app_stats":
        days = int(args.get("days", 30))
        return client.call("GET", f"/v1/stats?app_id={int(args['app_id'])}&days={days}")["stats"]
    if name == "send_notification":
        message = client.call("POST", "/v1/send", args)["message"]
        return {
            "message_id": message["id"],
            "status": message["status"],
            "send_at": message["send_at_iso"],
            "target": message["target"],
            "channels": message["channels"],
        }
    if name == "add_contact":
        return client.call("POST", "/v1/contacts", args)
    if name == "list_messages":
        limit = int(args.get("limit", 20))
        messages = client.call("GET", f"/v1/messages?app_id={int(args['app_id'])}&limit={limit}")["messages"]
        keys = ("id", "title", "status", "send_at_iso", "targeted", "delivered", "failed",
                "pruned", "shown", "clicked", "error")
        return [{k: m[k] for k in keys} for m in messages]
    if name == "cancel_message":
        client.call("POST", f"/v1/messages/{int(args['message_id'])}/cancel", {})
        return {"cancelled": int(args["message_id"])}
    if name == "integration_snippet":
        app = client.call("GET", f"/v1/apps/{int(args['app_id'])}")["app"]
        base = client.base
        return (
            f"<!-- page -->\n<script src=\"{base}/beacon.js\"></script>\n<script>\n"
            f"  Beacon.init({{ server: \"{base}\", appKey: \"{app['app_key']}\" }});\n"
            "  enableButton.onclick = () => Beacon.subscribe({ userId, tags: [] });\n"
            "  Beacon.inApp();\n</script>\n\n"
            "// first line of your sw.js (copy beacon-sw.js next to it)\nimportScripts('beacon-sw.js');\n\n"
            f"# send from a backend\ncurl -X POST {base}/v1/send -H 'Authorization: Bearer sk_…' "
            "-H 'Content-Type: application/json' -d '{\"title\":\"Hi\",\"body\":\"…\"}'"
        )
    raise KeyError(name)


def handle(client: BeaconClient, message: dict) -> dict | None:
    msg_id = message.get("id")
    method = message.get("method")
    params = message.get("params") or {}
    if msg_id is None:
        return None
    if method == "initialize":
        requested = params.get("protocolVersion")
        return {"jsonrpc": "2.0", "id": msg_id, "result": {
            "protocolVersion": requested if requested in SUPPORTED_PROTOCOLS else SUPPORTED_PROTOCOLS[0],
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": "Beacon sends push notifications for the user's apps. Call list_apps first to get app ids.",
        }}
    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        name = params.get("name")
        if name not in {t["name"] for t in TOOLS}:
            return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32602, "message": f"unknown tool {name}"}}
        try:
            result = run_tool(client, name, params.get("arguments") or {})
            text = result if isinstance(result, str) else json.dumps(result, indent=1)
            return {"jsonrpc": "2.0", "id": msg_id,
                    "result": {"content": [{"type": "text", "text": text}], "isError": False}}
        except (RuntimeError, KeyError, ValueError, TypeError) as exc:
            return {"jsonrpc": "2.0", "id": msg_id,
                    "result": {"content": [{"type": "text", "text": f"error: {exc}"}], "isError": True}}
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": f"method not found: {method}"}}


def main() -> int:
    client = BeaconClient(
        os.environ.get("BEACON_URL", "http://127.0.0.1:8780"),
        os.environ.get("BEACON_ADMIN_TOKEN", ""),
    )
    for raw in sys.stdin.buffer:
        raw = raw.strip()
        if not raw:
            continue
        try:
            response = handle(client, json.loads(raw))
        except json.JSONDecodeError:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if response is not None:
            sys.stdout.buffer.write(json.dumps(response).encode() + b"\n")
            sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
