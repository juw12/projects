"""Beacon — self-hosted push notifications for all your apps.

Zero dependencies (Python 3 standard library). One server, many apps:
Web Push for every PWA (Chrome, Edge, Firefox, Safari / iOS 16.4+ home-screen
apps), FCM for native Capacitor Android apps, and in-app messages.

  python apps/beacon/server/server.py --public-url https://push.example.com
  python apps/beacon/server/server.py --port 8780 --data data/beacon.db

On first start an admin token is printed once — keep it; it unlocks the
console (/) and the admin API. Each app gets a public key (pk_…) for its web
client and a secret key (sk_…) for its backend to send with.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import mimetypes
import os
import re
import sys
import threading
import time
from collections import defaultdict, deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

import webpush  # noqa: E402
from dispatcher import MAX_PAYLOAD_BYTES, Dispatcher, build_payload, payload_size, test_push_hosts  # noqa: E402
from fcm import FcmError, FcmSender  # noqa: E402
import channels  # noqa: E402
from tunnel import Tunnel  # noqa: E402
from store import DEFAULT_CHANNELS, Store  # noqa: E402

VERSION = "0.1.0"
WEB_ROOT = (Path(__file__).resolve().parent.parent / "web").resolve()
MAX_BODY = 256 * 1024
CHANNELS = {"webpush", "fcm", "ntfy", "apprise", "inapp"}
URGENCIES = {"very-low", "low", "normal", "high"}
TAG_RE = re.compile(r"^[\w:.\-]{1,64}$")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- validation
def _text(value, name: str, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ApiError(400, f"{name} must be a string")
    value = value.strip()
    if required and not value:
        raise ApiError(400, f"{name} is required")
    if len(value) > limit:
        raise ApiError(400, f"{name} is longer than {limit} characters")
    return value


def _url(value, name: str) -> str:
    value = _text(value, name, 1000)
    if value and not (value.startswith("https://") or value.startswith("http://") or value.startswith("/")):
        raise ApiError(400, f"{name} must be an http(s) URL or a path starting with /")
    return value


def _tags(value, name: str = "tags") -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 30:
        raise ApiError(400, f"{name} must be a list of at most 30 tags")
    tags = []
    for tag in value:
        if not isinstance(tag, str) or not TAG_RE.match(tag):
            raise ApiError(400, f"invalid tag {tag!r} (letters, digits, _ : . - ; max 64)")
        tags.append(tag)
    return sorted(set(tags))


def _send_at(body: dict) -> float:
    now = time.time()
    if body.get("delay_seconds") is not None:
        delay = float(body["delay_seconds"])
        if not 0 <= delay <= 365 * 86400:
            raise ApiError(400, "delay_seconds must be between 0 and one year")
        return now + delay
    value = body.get("send_at")
    if value in (None, ""):
        return now
    if isinstance(value, (int, float)):
        return float(value)
    try:
        parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise ApiError(400, "send_at must be ISO 8601 (e.g. 2026-11-02T09:00:00+07:00) or epoch seconds") from exc
    if parsed.tzinfo is None:
        raise ApiError(400, "send_at needs a timezone offset, e.g. +07:00")
    return parsed.timestamp()


def validate_target(target) -> dict:
    if target in (None, "all", {}):
        return {"all": True}
    if not isinstance(target, dict):
        raise ApiError(400, "target must be an object")
    clean = {}
    if target.get("all"):
        clean["all"] = True
    if target.get("user_ids") is not None:
        ids = target["user_ids"]
        if not isinstance(ids, list) or len(ids) > 10000 or not all(isinstance(i, str) and i for i in ids):
            raise ApiError(400, "target.user_ids must be a list of strings (max 10000)")
        clean["user_ids"] = ids
    if target.get("subscriber_ids") is not None:
        ids = target["subscriber_ids"]
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            raise ApiError(400, "target.subscriber_ids must be a list of integers")
        clean["subscriber_ids"] = ids
    if target.get("tags") is not None:
        clean["tags"] = _tags(target["tags"], "target.tags")
        clean["match"] = "all" if target.get("match") == "all" else "any"
    if target.get("exclude_tags") is not None:
        clean["exclude_tags"] = _tags(target["exclude_tags"], "target.exclude_tags")
    if not any(k in clean for k in ("all", "user_ids", "subscriber_ids", "tags")):
        raise ApiError(400, "target needs all, user_ids, tags or subscriber_ids")
    return clean


def validate_message(body: dict) -> dict:
    channels = body.get("channels") or DEFAULT_CHANNELS
    if not isinstance(channels, list) or not channels or not set(channels) <= CHANNELS:
        raise ApiError(400, f"channels must be a non-empty subset of {sorted(CHANNELS)}")
    data = body.get("data") or {}
    if not isinstance(data, dict) or len(json.dumps(data)) > 1500:
        raise ApiError(400, "data must be an object under 1500 bytes of JSON")
    ttl = int(body.get("ttl", 86400))
    if not 0 <= ttl <= 28 * 86400:
        raise ApiError(400, "ttl must be between 0 and 2419200 seconds (28 days)")
    urgency = body.get("urgency", "normal")
    if urgency not in URGENCIES:
        raise ApiError(400, f"urgency must be one of {sorted(URGENCIES)}")
    return {
        "title": _text(body.get("title"), "title", 120, required=True),
        "body": _text(body.get("body"), "body", 600),
        "url": _url(body.get("url"), "url"),
        "icon": _url(body.get("icon"), "icon"),
        "image": _url(body.get("image"), "image"),
        "tag": _text(body.get("tag"), "tag", 64),
        "data": data,
        "target": validate_target(body.get("target")),
        "channels": sorted(set(channels)),
        "ttl": ttl,
        "urgency": urgency,
        "send_at": _send_at(body),
    }


# ------------------------------------------------------------------- server
class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self.lock:
            bucket = self.hits[key]
            while bucket and now - bucket[0] > 60:
                bucket.popleft()
            if len(bucket) >= self.per_minute:
                return False
            bucket.append(now)
            return True


class BeaconServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, store: Store, dispatcher: Dispatcher, public_url: str, trust_proxy: bool):
        super().__init__(address, Handler)
        self.store = store
        self.dispatcher = dispatcher
        self.public_url = public_url
        self.configured_public_url = public_url
        self.trust_proxy = trust_proxy
        self.limiter = RateLimiter(int(os.environ.get("BEACON_RATE_PER_MINUTE", 120)))
        self.tunnel = Tunnel(on_change=self.use_public_url)

    def use_public_url(self, url: str | None) -> None:
        """Switch the advertised URL when a tunnel goes live / stops (click tracking, snippets)."""
        self.public_url = (url or self.configured_public_url).rstrip("/")
        self.dispatcher.public_url = self.public_url
        print(f"[beacon] public URL is now {self.public_url}", file=sys.stderr)


ROUTES: list[tuple[str, re.Pattern, str, str]] = []


def route(method: str, pattern: str, auth: str):
    """auth: public | sender (app secret or admin) | admin"""

    def register(func):
        ROUTES.append((method, re.compile("^" + pattern + "$"), auth, func.__name__))
        return func

    return register


class Handler(BaseHTTPRequestHandler):
    server: BeaconServer
    protocol_version = "HTTP/1.1"
    server_version = f"Beacon/{VERSION}"

    # ---------------------------------------------------------------- plumbing
    def log_message(self, fmt, *args):
        if not os.environ.get("BEACON_QUIET"):
            sys.stderr.write("[beacon] %s %s\n" % (self.client_ip(), fmt % args))

    def client_ip(self) -> str:
        if (self.server.tunnel.state == "live" and self.client_address[0] in ("127.0.0.1", "::1")
                and self.headers.get("CF-Connecting-IP")):
            return self.headers["CF-Connecting-IP"].strip()  # real visitor behind the Cloudflare tunnel
        if self.server.trust_proxy:
            forwarded = self.headers.get("X-Forwarded-For", "")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return self.client_address[0]

    def cors_headers(self, app: dict | None = None) -> dict:
        origin = self.headers.get("Origin", "")
        allowed = "*"
        if app and app.get("origins"):
            allowed_list = [o.strip().rstrip("/") for o in app["origins"].split(",") if o.strip()]
            allowed = origin if origin.rstrip("/") in allowed_list else "null"
        return {
            "Access-Control-Allow-Origin": allowed,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
            "Vary": "Origin",
        }

    def send_body(self, status: int, body: bytes, content_type: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, payload, status: int = 200, extra: dict | None = None):
        headers = {"Cache-Control": "no-store"}
        headers.update(extra or {})
        self.send_body(status, json.dumps(payload).encode(), "application/json; charset=utf-8", headers)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "request body too large")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ApiError(400, f"invalid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise ApiError(400, "expected a JSON object")
        return data

    def bearer(self) -> str:
        header = self.headers.get("Authorization", "")
        return header[7:].strip() if header.lower().startswith("bearer ") else ""

    # ----------------------------------------------------------------- routing
    def do_OPTIONS(self):
        self.send_response(204)
        for key, value in self.cors_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self.dispatch("GET")

    def do_HEAD(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method: str):
        url = urlparse(self.path)
        self.query = {k: v[0] for k, v in parse_qs(url.query).items()}
        self.cors_app = None
        for route_method, pattern, auth, name in ROUTES:
            if route_method != method:
                continue
            match = pattern.match(url.path)
            if not match:
                continue
            try:
                self.authorise(auth)
                getattr(self, name)(*match.groups())
            except ApiError as exc:
                extra = self.cors_headers(self.cors_app) if auth == "public" else None
                self.send_json({"ok": False, "error": str(exc)}, exc.status, extra)
            except (ValueError, TypeError) as exc:
                extra = self.cors_headers(self.cors_app) if auth == "public" else None
                self.send_json({"ok": False, "error": f"invalid value: {exc}"}, 400, extra)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        if method == "GET" and not url.path.startswith("/v1/"):
            self.static(url.path)
            return
        self.send_json({"ok": False, "error": "not found"}, 404)

    def authorise(self, auth: str):
        self.sender_app = None
        self.is_admin = False
        token = self.bearer()
        if auth == "public":
            if not self.server.limiter.allow(self.client_ip()):
                raise ApiError(429, "too many requests")
            return
        if token and self.server.store.check_admin(token):
            self.is_admin = True
            return
        if auth == "sender":
            app = self.server.store.app_by_secret(token)
            if app:
                self.sender_app = app
                return
        raise ApiError(401, "missing or invalid key (use Authorization: Bearer sk_… or the admin token)")

    def static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"
        elif path.endswith("/"):
            path += "index.html"
        target = (WEB_ROOT / path.lstrip("/")).resolve()
        if WEB_ROOT not in target.parents or not target.is_file():
            self.send_json({"ok": False, "error": "not found"}, 404)
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".js":
            content_type = "text/javascript"
        if content_type.startswith("text/"):
            content_type += "; charset=utf-8"
        extra = {"Cache-Control": "no-cache"}
        if target.name in ("beacon.js", "beacon-sw.js"):
            extra["Access-Control-Allow-Origin"] = "*"
        if target.name.endswith("-sw.js"):
            extra["Service-Worker-Allowed"] = "/"
        if target.name == "index.html":
            extra["Content-Security-Policy"] = (
                "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'"
            )
        self.send_body(200, target.read_bytes(), content_type, extra)

    # -------------------------------------------------------- shared helpers
    def resolve_app(self, body: dict | None = None) -> dict:
        """App for sender/admin calls: the secret's app, or app_id for admins."""
        if self.sender_app:
            return self.sender_app
        app_id = (body or {}).get("app_id") or self.query.get("app_id")
        if not app_id:
            raise ApiError(400, "app_id is required when using the admin token")
        app = self.server.store.get_app(int(app_id))
        if not app:
            raise ApiError(404, "app not found")
        return app

    def public_app(self, app_key: str) -> dict:
        app = self.server.store.app_by_key(app_key or "")
        if not app:
            raise ApiError(404, "unknown app key")
        self.cors_app = app
        origin = self.headers.get("Origin")
        if app["origins"] and origin and self.cors_headers(app)["Access-Control-Allow-Origin"] == "null":
            raise ApiError(403, "this origin is not allowed for the app")
        return app

    def message_view(self, message: dict) -> dict:
        view = dict(message)
        view["send_at_iso"] = dt.datetime.fromtimestamp(message["send_at"], dt.timezone.utc).isoformat()
        return view

    # ------------------------------------------------------------- public API
    @route("GET", r"/v1/health", "public")
    def health(self):
        self.send_json({"ok": True, "beacon": VERSION})

    @route("GET", r"/v1/client/([\w\-]+)", "public")
    def client_config(self, app_key):
        app = self.public_app(app_key)
        self.send_json({
            "ok": True,
            "name": app["name"],
            "vapid_public_key": app["vapid_public_key"],
            "icon": app["icon"],
            "fcm": app["fcm_configured"],
        }, extra=self.cors_headers(app))

    @route("POST", r"/v1/subscribe", "public")
    def subscribe(self):
        body = self.read_json()
        app = self.public_app(body.get("app_key"))
        subscription = body.get("subscription") or {}
        endpoint = subscription.get("endpoint", "")
        keys = subscription.get("keys") or {}
        if not webpush.endpoint_allowed(endpoint, test_push_hosts()):
            raise ApiError(400, "subscription endpoint is not a known push service")
        try:
            webpush.decode_point(webpush.b64url_decode(keys.get("p256dh", "")))
            auth_secret = webpush.b64url_decode(keys.get("auth", ""))
        except (ValueError, TypeError) as exc:
            raise ApiError(400, f"invalid subscription keys: {exc}") from exc
        if len(auth_secret) != 16:
            raise ApiError(400, "subscription auth secret must be 16 bytes")
        sub_id, token = self.server.store.upsert_subscriber(
            app["id"], "webpush", endpoint, keys["p256dh"], keys["auth"],
            user_id=_text(body.get("user_id"), "user_id", 128),
            tags=_tags(body.get("tags")),
            platform=_text(body.get("platform"), "platform", 32),
            locale=_text(body.get("locale"), "locale", 16),
        )
        self.send_json({"ok": True, "id": sub_id, "token": token}, extra=self.cors_headers(app))

    @route("POST", r"/v1/register-device", "public")
    def register_device(self):
        body = self.read_json()
        app = self.public_app(body.get("app_key"))
        device_token = _text(body.get("token"), "token", 4096, required=True)
        sub_id, token = self.server.store.upsert_subscriber(
            app["id"], "fcm", device_token,
            user_id=_text(body.get("user_id"), "user_id", 128),
            tags=_tags(body.get("tags")),
            platform=_text(body.get("platform") or "android", "platform", 32),
            locale=_text(body.get("locale"), "locale", 16),
        )
        self.send_json({"ok": True, "id": sub_id, "token": token}, extra=self.cors_headers(app))

    def _subscriber_from_body(self, body: dict) -> tuple[dict, dict]:
        app = self.public_app(body.get("app_key"))
        subscriber = self.server.store.subscriber_by_token(app["id"], body.get("token", ""))
        if not subscriber:
            raise ApiError(404, "unknown subscriber token")
        return app, subscriber

    @route("POST", r"/v1/update", "public")
    def update_subscriber(self):
        body = self.read_json()
        app, subscriber = self._subscriber_from_body(body)
        user_id = _text(body["user_id"], "user_id", 128) if "user_id" in body else None
        tags = _tags(body["tags"]) if "tags" in body else None
        self.server.store.update_subscriber(subscriber["id"], user_id, tags)
        self.send_json({"ok": True}, extra=self.cors_headers(app))

    @route("POST", r"/v1/unsubscribe", "public")
    def unsubscribe(self):
        body = self.read_json()
        app, subscriber = self._subscriber_from_body(body)
        self.server.store.delete_subscriber(subscriber["id"])
        self.send_json({"ok": True}, extra=self.cors_headers(app))

    @route("GET", r"/v1/inbox", "public")
    def inbox(self):
        app = self.public_app(self.query.get("app_key", ""))
        subscriber = None
        if self.query.get("token"):
            subscriber = self.server.store.subscriber_by_token(app["id"], self.query["token"])
        since = float(self.query.get("since", 0) or 0)
        messages = self.server.store.inbox(app["id"], subscriber, since)
        items = []
        for message in messages:
            item = build_payload(self.server.store, app, message, self.server.public_url)
            item["created"] = message["created"]
            items.append(item)
        self.send_json({"ok": True, "messages": items}, extra=self.cors_headers(app))

    @route("POST", r"/v1/track", "public")
    def track(self):
        body = self.read_json()
        event = body.get("event")
        message_id = int(body.get("id") or 0)
        if event not in ("shown", "clicked"):
            raise ApiError(400, "event must be shown or clicked")
        if not self.server.store.check_track_signature(message_id, str(body.get("sig", ""))):
            raise ApiError(403, "bad signature")
        self.server.store.bump(message_id, event)
        self.send_json({"ok": True}, extra=self.cors_headers())

    # ---------------------------------------------------------- sender API
    @route("POST", r"/v1/send", "sender")
    def send(self):
        body = self.read_json()
        app = self.resolve_app(body)
        fields = validate_message(body)
        probe = build_payload(self.server.store, app, {"id": 10 ** 9, **fields}, self.server.public_url)
        if payload_size(probe) > MAX_PAYLOAD_BYTES:
            raise ApiError(400, f"notification too large ({payload_size(probe)} > {MAX_PAYLOAD_BYTES} bytes); "
                                "shorten the text or data")
        message = self.server.store.create_message(app["id"], fields)
        self.server.dispatcher.nudge()
        self.send_json({"ok": True, "message": self.message_view(message)}, 202)

    @route("GET", r"/v1/app", "sender")
    def whoami(self):
        app = self.resolve_app()
        self.send_json({"ok": True, "app": {
            "id": app["id"],
            "name": app["name"],
            "app_key": app["app_key"],
            "vapid_public_key": app["vapid_public_key"],
            "fcm_configured": app["fcm_configured"],
        }})

    @route("GET", r"/v1/channels", "sender")
    def channel_capabilities(self):
        self.send_json({"ok": True, "channels": channels.capabilities()})

    @route("POST", r"/v1/contacts", "sender")
    def add_contact(self):
        """Register an ntfy topic or Apprise URL as a subscriber (backend/admin only)."""
        body = self.read_json()
        app = self.resolve_app(body)
        channel = body.get("channel")
        address = _text(body.get("address"), "address", 2000, required=True)
        try:
            if channel == "ntfy":
                address = channels.validate_ntfy(address, test_push_hosts())
            elif channel == "apprise":
                address = channels.validate_apprise(address)
            else:
                raise ApiError(400, "channel must be ntfy or apprise")
        except channels.ChannelError as exc:
            raise ApiError(400, str(exc)) from exc
        sub_id, _token = self.server.store.upsert_subscriber(
            app["id"], channel, address,
            auth=_text(body.get("secret"), "secret", 200) if channel == "ntfy" else "",
            user_id=_text(body.get("user_id"), "user_id", 128),
            tags=_tags(body.get("tags")),
            platform=_text(body.get("label") or channel, "label", 32),
        )
        self.send_json({"ok": True, "id": sub_id, "channel": channel,
                        "address_preview": channels.mask_address(channel, address)}, 201)

    @route("POST", r"/v1/subscribers/(\d+)/delete", "sender")
    def remove_subscriber(self, sub_id):
        subscriber = self.server.store.get_subscriber(int(sub_id))
        if not subscriber or (self.sender_app and subscriber["app_id"] != self.sender_app["id"]):
            raise ApiError(404, "subscriber not found")
        self.server.store.delete_subscriber(subscriber["id"])
        self.send_json({"ok": True})

    @route("GET", r"/v1/messages", "sender")
    def list_messages(self):
        app = self.resolve_app()
        limit = int(self.query.get("limit", 50))
        messages = [self.message_view(m) for m in self.server.store.list_messages(app["id"], limit)]
        self.send_json({"ok": True, "messages": messages})

    def _own_message(self, message_id: str) -> dict:
        message = self.server.store.get_message(int(message_id))
        if not message or (self.sender_app and message["app_id"] != self.sender_app["id"]):
            raise ApiError(404, "message not found")
        return message

    @route("GET", r"/v1/messages/(\d+)", "sender")
    def get_message(self, message_id):
        self.send_json({"ok": True, "message": self.message_view(self._own_message(message_id))})

    @route("POST", r"/v1/messages/(\d+)/cancel", "sender")
    def cancel_message(self, message_id):
        message = self._own_message(message_id)
        if not self.server.store.cancel_message(message["id"]):
            raise ApiError(409, f"cannot cancel a message that is {message['status']}")
        self.send_json({"ok": True})

    @route("GET", r"/v1/stats", "sender")
    def stats(self):
        app = self.resolve_app()
        days = max(1, min(int(self.query.get("days", 30)), 365))
        self.send_json({"ok": True, "app_id": app["id"], "stats": self.server.store.stats(app["id"], days)})

    # ------------------------------------------------------------ admin API
    @route("GET", r"/v1/apps", "admin")
    def list_apps(self):
        apps = [self.server.store.public_app(a) for a in self.server.store.list_apps()]
        self.send_json({
            "ok": True,
            "apps": apps,
            "public_url": self.server.public_url,
            "channels": channels.capabilities(),
        })

    @route("POST", r"/v1/apps", "admin")
    def create_app(self):
        body = self.read_json()
        app, secret = self.server.store.create_app(
            _text(body.get("name"), "name", 80, required=True),
            subject=_text(body.get("subject"), "subject", 200) or "mailto:admin@example.com",
            origins=_text(body.get("origins"), "origins", 1000),
            icon=_url(body.get("icon"), "icon"),
            default_url=_url(body.get("default_url"), "default_url"),
        )
        self.send_json({"ok": True, "app": self.server.store.public_app(app), "secret_key": secret}, 201)

    def _admin_app(self, app_id: str) -> dict:
        app = self.server.store.get_app(int(app_id))
        if not app:
            raise ApiError(404, "app not found")
        return app

    @route("GET", r"/v1/apps/(\d+)", "admin")
    def get_app(self, app_id):
        app = self._admin_app(app_id)
        self.send_json({
            "ok": True,
            "app": self.server.store.public_app(app),
            "stats": self.server.store.stats(app["id"]),
        })

    @route("POST", r"/v1/apps/(\d+)", "admin")
    def update_app(self, app_id):
        app = self._admin_app(app_id)
        body = self.read_json()
        fields = {}
        for key, limit in (("name", 80), ("vapid_subject", 200), ("origins", 1000)):
            if key in body:
                fields[key] = _text(body[key], key, limit, required=(key == "name"))
        for key in ("icon", "default_url"):
            if key in body:
                fields[key] = _url(body[key], key)
        if "fcm_service_account" in body:
            account = body["fcm_service_account"]
            if account in (None, "", {}):
                fields["fcm_account"] = ""
            else:
                if isinstance(account, str):
                    try:
                        account = json.loads(account)
                    except json.JSONDecodeError as exc:
                        raise ApiError(400, "fcm_service_account is not valid JSON") from exc
                try:
                    FcmSender(account)  # validates fields and the RSA key
                except (FcmError, ValueError, TypeError) as exc:
                    raise ApiError(400, f"service account rejected: {exc}") from exc
                fields["fcm_account"] = json.dumps(account)
        updated = self.server.store.update_app(app["id"], fields)
        self.send_json({"ok": True, "app": self.server.store.public_app(updated)})

    @route("POST", r"/v1/apps/(\d+)/rotate-secret", "admin")
    def rotate_secret(self, app_id):
        app = self._admin_app(app_id)
        self.send_json({"ok": True, "secret_key": self.server.store.rotate_secret(app["id"])})

    @route("POST", r"/v1/apps/(\d+)/delete", "admin")
    def delete_app(self, app_id):
        app = self._admin_app(app_id)
        self.server.store.delete_app(app["id"])
        self.send_json({"ok": True})

    @route("GET", r"/v1/tunnel", "admin")
    def tunnel_status(self):
        self.send_json({"ok": True, "tunnel": self.server.tunnel.status(), "public_url": self.server.public_url})

    @route("POST", r"/v1/tunnel/start", "admin")
    def tunnel_start(self):
        body = self.read_json()
        protocol = body.get("protocol", "auto")
        if protocol not in ("auto", "http2", "quic"):
            raise ApiError(400, "protocol must be auto, http2 or quic")
        status = self.server.tunnel.start(self.server.server_address[1], install_if_missing=True, protocol=protocol)
        self.send_json({"ok": True, "tunnel": status}, 202)

    @route("POST", r"/v1/tunnel/stop", "admin")
    def tunnel_stop(self):
        self.send_json({"ok": True, "tunnel": self.server.tunnel.stop(), "public_url": self.server.public_url})

    @route("GET", r"/v1/apps/(\d+)/subscribers", "admin")
    def list_subscribers(self, app_id):
        app = self._admin_app(app_id)
        limit = int(self.query.get("limit", 200))
        self.send_json({"ok": True, "subscribers": self.server.store.list_subscribers(app["id"], limit)})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Beacon — self-hosted push notifications.")
    parser.add_argument("--host", default=os.environ.get("BEACON_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("BEACON_PORT", 8780)))
    parser.add_argument("--data", default=os.environ.get("BEACON_DB", "beacon-data/beacon.db"))
    parser.add_argument("--public-url", default=os.environ.get("BEACON_PUBLIC_URL"),
                        help="https URL where browsers reach this server (used for click tracking)")
    parser.add_argument("--admin-token", default=os.environ.get("BEACON_ADMIN_TOKEN"))
    parser.add_argument("--reset-admin-token", action="store_true")
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--trust-proxy", action="store_true", help="use X-Forwarded-For (behind a reverse proxy)")
    parser.add_argument("--tunnel", action="store_true",
                        help="go live at once: public https://….trycloudflare.com URL via cloudflared")
    args = parser.parse_args(argv)

    for variable in ("NO_PROXY", "no_proxy"):  # keep Apprise (requests) off the proxy for loopback targets
        existing = os.environ.get(variable, "")
        if "127.0.0.1" not in existing:
            os.environ[variable] = ",".join(filter(None, [existing, "127.0.0.1,localhost,::1"]))
    Path(args.data).parent.mkdir(parents=True, exist_ok=True)
    store = Store(args.data)
    new_admin = store.ensure_admin_token(args.admin_token, reset=args.reset_admin_token)
    public_url = (args.public_url or f"http://{args.host}:{args.port}").rstrip("/")
    dispatcher = Dispatcher(store, public_url, workers=args.workers).start()
    server = BeaconServer((args.host, args.port), store, dispatcher, public_url, args.trust_proxy)

    print(f"Beacon {VERSION} listening on http://{args.host}:{server.server_address[1]}  (public: {public_url})")
    print(f"  database: {Path(args.data).resolve()}")
    if new_admin:
        print(f"  ADMIN TOKEN (shown once, keep it safe): {new_admin}")
    if not public_url.startswith("https://") and args.host not in ("127.0.0.1", "localhost"):
        print("  warning: browsers only allow push from https origins — put Beacon behind TLS.")
    if args.tunnel:
        server.tunnel.start(server.server_address[1])
        print("  starting a Cloudflare quick tunnel (see the console's Go live panel or GET /v1/tunnel)")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.tunnel.stop()
        dispatcher.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
