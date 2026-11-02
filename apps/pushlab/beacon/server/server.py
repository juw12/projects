"""Beacon — self-hosted push notifications for all your apps.

Zero dependencies (Python 3 standard library). One server, many apps:
Web Push for every PWA (Chrome, Edge, Firefox, Safari / iOS 16.4+ home-screen
apps), FCM for native Capacitor Android apps, and in-app messages.

  python apps/pushlab/beacon/server/server.py --public-url https://push.example.com
  python apps/pushlab/beacon/server/server.py --port 8780 --data data/beacon.db

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
from urllib.parse import parse_qs, quote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

import webpush  # noqa: E402
from dispatcher import MAX_PAYLOAD_BYTES, Dispatcher, build_payload, payload_size, test_push_hosts  # noqa: E402
from fcm import FcmError, FcmSender  # noqa: E402
import channels  # noqa: E402
import gatus  # noqa: E402
from tunnel import Tunnel  # noqa: E402
from store import DEFAULT_CHANNELS, Store  # noqa: E402

VERSION = "0.1.0"
WEB_ROOT = (Path(__file__).resolve().parent.parent / "web").resolve()
MAX_BODY = 256 * 1024
CHANNELS = {"webpush", "fcm", "ntfy", "bark", "gotify", "apprise", "inapp"}
URGENCIES = {"very-low", "low", "normal", "high"}
TAG_RE = re.compile(r"^[\w:.\-]{1,64}$")
CATEGORY_RE = re.compile(r"^[a-z0-9][a-z0-9_.:\-]{0,47}$")
TEMPLATE_NAME_RE = re.compile(r"^[a-zA-Z0-9][\w.\-]{0,63}$")
TEMPLATE_VAR_RE = re.compile(r"\{\{\s*([A-Za-z_][\w.]{0,63})\s*\}\}")
MAX_FALLBACK_STEPS = 4  # escalation chain: first message + up to 4 follow-ups


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
    fields = {
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
    if body.get("digest") is not None:
        fields["digest"] = validate_digest(body["digest"])
    if body.get("fallback") is not None:
        fields["fallback"] = validate_fallback(body["fallback"])
    if body.get("category"):
        fields["category"] = validate_category_key(body["category"])
    return fields


def validate_category_key(value, name: str = "category") -> str:
    if not isinstance(value, str) or not CATEGORY_RE.match(value):
        raise ApiError(400, f"{name} must be lowercase letters, digits, _ . : - (max 48), e.g. marketing")
    return value


def validate_channels(value, name: str) -> list[str]:
    if not isinstance(value, list) or not value or not set(value) <= CHANNELS:
        raise ApiError(400, f"{name} must be a non-empty subset of {sorted(CHANNELS)}")
    return sorted(set(value))


def validate_digest(spec) -> dict:
    """{"key": "comments:post42", "window": 600, "title": "{count} new comments"}"""
    if not isinstance(spec, dict):
        raise ApiError(400, "digest must be an object")
    key = _text(spec.get("key"), "digest.key", 128, required=True)
    try:
        window = float(spec.get("window", 300))
    except (TypeError, ValueError):
        raise ApiError(400, "digest.window must be a number of seconds") from None
    if not 1 <= window <= 86400:
        raise ApiError(400, "digest.window must be 1-86400 seconds")
    clean = {"key": key, "window": window}
    if spec.get("title"):
        clean["title"] = _text(spec["title"], "digest.title", 120)
    return clean


def validate_fallback(spec, depth: int = 1) -> dict:
    """{"after": 600, "unless": "clicked", "channels": ["ntfy"], "title"?, "body"?, "urgency"?, "fallback"?}

    A fallback may hold its own `fallback`: a multi-step workflow such as
    web push -> (10 min, not clicked) ntfy -> (30 min, still nothing) Bark, high urgency.
    """
    if not isinstance(spec, dict):
        raise ApiError(400, "fallback must be an object")
    if depth > MAX_FALLBACK_STEPS:
        raise ApiError(400, f"a workflow may escalate at most {MAX_FALLBACK_STEPS} times")
    try:
        after = float(spec.get("after", 600))
    except (TypeError, ValueError):
        raise ApiError(400, "fallback.after must be a number of seconds") from None
    if not 1 <= after <= 7 * 86400:
        raise ApiError(400, "fallback.after must be 1-604800 seconds")
    unless = spec.get("unless", "clicked")
    if unless not in ("clicked", "shown", "delivered"):
        raise ApiError(400, "fallback.unless must be clicked, shown or delivered")
    channels = spec.get("channels")
    if not isinstance(channels, list) or not channels or not set(channels) <= CHANNELS:
        raise ApiError(400, f"fallback.channels must be a non-empty subset of {sorted(CHANNELS)}")
    clean = {"after": after, "unless": unless, "channels": sorted(set(channels))}
    if spec.get("title"):
        clean["title"] = _text(spec["title"], "fallback.title", 120)
    if spec.get("body"):
        clean["body"] = _text(spec["body"], "fallback.body", 600)
    if spec.get("urgency"):
        if spec["urgency"] not in URGENCIES:
            raise ApiError(400, f"fallback.urgency must be one of {sorted(URGENCIES)}")
        clean["urgency"] = spec["urgency"]
    if spec.get("fallback") is not None:
        clean["fallback"] = validate_fallback(spec["fallback"], depth + 1)
    return clean


# ---------------------------------------------------------------- templates
TEMPLATE_FIELDS = ("title", "body", "url", "icon", "image", "tag", "channels", "category", "urgency", "ttl",
                   "target", "data", "fallback", "digest")


def validate_template(name: str, body: dict) -> dict:
    """A template is a message skeleton; {{vars}} are filled in at send time."""
    if not TEMPLATE_NAME_RE.match(name or ""):
        raise ApiError(400, "template name: letters, digits, _ . - (max 64)")
    spec = {k: body[k] for k in TEMPLATE_FIELDS if body.get(k) not in (None, "")}
    if not spec.get("title"):
        raise ApiError(400, "a template needs a title")
    sample: dict = {}
    for var in template_variables(spec):
        node = sample
        parts = var.split(".")
        for part in parts[:-1]:
            child = node.get(part)
            if not isinstance(child, dict):
                child = {}
                node[part] = child
            node = child
        node.setdefault(parts[-1], "x")
    validate_message(render_template(spec, sample))  # same rules as a real message
    return spec


def template_variables(spec) -> list[str]:
    found: list[str] = []

    def walk(value):
        if isinstance(value, str):
            for var in TEMPLATE_VAR_RE.findall(value):
                if var not in found:
                    found.append(var)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(spec)
    return found


def render_template(spec: dict, variables: dict) -> dict:
    """Fill {{var}} (dots reach into nested vars: {{order.id}}); values in URLs are percent-encoded."""
    if not isinstance(variables, dict):
        raise ApiError(400, "vars must be an object")
    if len(json.dumps(variables, default=str)) > 8000:
        raise ApiError(400, "vars are limited to 8000 bytes of JSON")
    missing: list[str] = []

    def lookup(path: str):
        value = variables
        for part in path.split("."):
            if not isinstance(value, dict) or part not in value:
                missing.append(path)
                return ""
            value = value[part]
        if isinstance(value, (dict, list)):
            raise ApiError(400, f"template variable {path} must be text or a number")
        return "" if value is None else str(value)

    def fill(value, key: str = ""):
        if isinstance(value, str):
            is_url = key in ("url", "icon", "image")
            return TEMPLATE_VAR_RE.sub(
                lambda m: quote(lookup(m.group(1)), safe="") if is_url else lookup(m.group(1)), value)
        if isinstance(value, dict):
            return {k: fill(v, k) for k, v in value.items()}
        if isinstance(value, list):
            return [fill(v, key) for v in value]
        return value

    rendered = fill(spec)
    if missing:
        raise ApiError(400, "template variable(s) missing: " + ", ".join(sorted(set(missing))))
    return rendered


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

    def read_raw(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(413, "request body too large")
        return self.rfile.read(length) if length else b""

    def read_json(self) -> dict:
        raw = self.read_raw()
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
        if body.get("template"):
            body = self._from_template(app, body)
        fields = validate_message(body)
        probe = build_payload(self.server.store, app, {"id": 10 ** 9, **fields}, self.server.public_url)
        if payload_size(probe) > MAX_PAYLOAD_BYTES:
            raise ApiError(400, f"notification too large ({payload_size(probe)} > {MAX_PAYLOAD_BYTES} bytes); "
                                "shorten the text or data")
        message, merged = self.server.store.send_or_digest(app["id"], fields)
        self.server.dispatcher.nudge()
        self.send_json({"ok": True, "message": self.message_view(message), "digested": merged}, 202)

    def _from_template(self, app: dict, body: dict) -> dict:
        """Template fields rendered with body.vars; anything else in the body overrides them."""
        template = self.server.store.get_template(app["id"], str(body["template"]))
        if not template:
            raise ApiError(404, f"no template named {body['template']!r}")
        spec = {k: v for k, v in template.items() if k in TEMPLATE_FIELDS}
        merged = render_template(spec, body.get("vars") or {})
        for key, value in body.items():
            if key not in ("template", "vars", "app_id"):
                merged[key] = value
        return merged

    @route("POST", r"/v1/hooks/gatus", "sender")
    def gatus_hook(self):
        """Gatus `custom` alert -> notification (routing via query string, see gatus.py)."""
        app = self.resolve_app()
        try:
            alert = gatus.parse_alert(self.read_raw())
            body, resolved = gatus.to_message(alert, self.query, DEFAULT_CHANNELS)
        except gatus.HookError as exc:
            raise ApiError(400, str(exc)) from exc
        fields = validate_message(body)
        cancelled = self.server.store.cancel_fallbacks_for_tag(app["id"], fields["tag"]) if resolved else 0
        message, merged = self.server.store.send_or_digest(app["id"], fields)
        self.server.dispatcher.nudge()
        self.send_json({"ok": True, "message": self.message_view(message), "digested": merged,
                        "resolved": resolved, "escalations_cancelled": cancelled}, 202)

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
        """Register an ntfy topic, Bark device, Gotify app or Apprise URL (backend/admin only)."""
        body = self.read_json()
        app = self.resolve_app(body)
        channel = body.get("channel")
        address = _text(body.get("address"), "address", 2000, required=True)
        secret = _text(body.get("secret"), "secret", 200)
        try:
            if channel == "ntfy":
                address = channels.validate_ntfy(address, test_push_hosts())
            elif channel == "bark":
                address = channels.validate_bark(address, test_push_hosts())
            elif channel == "gotify":
                address = channels.validate_gotify(address, secret, test_push_hosts())
            elif channel == "apprise":
                address = channels.validate_apprise(address)
            else:
                raise ApiError(400, f"channel must be one of {', '.join(channels.CONTACT_CHANNELS)}")
        except channels.ChannelError as exc:
            raise ApiError(400, str(exc)) from exc
        sub_id, _token = self.server.store.upsert_subscriber(
            app["id"], channel, address,
            auth=secret.strip() if channel in ("ntfy", "gotify") else "",
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

    @route("POST", r"/v1/messages/(\d+)/cancel-fallback", "sender")
    def cancel_fallback(self, message_id):
        message = self._own_message(message_id)
        if not self.server.store.cancel_fallback(message["id"]):
            raise ApiError(409, "this message has no pending fallback")
        self.send_json({"ok": True})

    @route("GET", r"/v1/stats", "sender")
    def stats(self):
        app = self.resolve_app()
        days = max(1, min(int(self.query.get("days", 30)), 365))
        self.send_json({"ok": True, "app_id": app["id"], "stats": self.server.store.stats(app["id"], days)})

    @route("GET", r"/v1/messages/(\d+)/workflow", "sender")
    def message_workflow(self, message_id):
        """Every step of an escalation chain (first message, then each fallback that fired)."""
        message = self._own_message(message_id)
        steps = self.server.store.workflow(message["id"])
        self.send_json({"ok": True, "steps": [self.message_view(s) for s in steps]})

    # ------------------------------------------------- categories + preferences
    @route("GET", r"/v1/categories", "sender")
    def list_categories(self):
        app = self.resolve_app()
        self.send_json({"ok": True, "categories": self.server.store.list_categories(app["id"])})

    @route("POST", r"/v1/categories", "sender")
    def upsert_category(self):
        """{key, name?, description?, critical?, default_enabled?} — critical ones ignore opt-outs."""
        body = self.read_json()
        app = self.resolve_app(body)
        key = validate_category_key(body.get("key"), "key")
        category = self.server.store.upsert_category(
            app["id"], key,
            name=_text(body.get("name"), "name", 80),
            description=_text(body.get("description"), "description", 300),
            critical=bool(body.get("critical")),
            default_enabled=body.get("default_enabled", True) is not False,
        )
        self.send_json({"ok": True, "category": category}, 201)

    @route("POST", r"/v1/categories/([a-z0-9][a-z0-9_.:\-]{0,47})/delete", "sender")
    def delete_category(self, key):
        app = self.resolve_app()
        if not self.server.store.delete_category(app["id"], key):
            raise ApiError(404, "category not found")
        self.send_json({"ok": True})

    def _preference_body(self, body: dict) -> tuple[str, bool | None, list | None]:
        category = body.get("category") or "*"
        if category != "*":
            category = validate_category_key(category)
        if body.get("reset"):
            return category, None, None
        enabled = body.get("enabled")
        if enabled is not None and not isinstance(enabled, bool):
            raise ApiError(400, "enabled must be true or false")
        channels_value = body.get("channels")
        if channels_value is not None and channels_value != []:
            channels_value = validate_channels(channels_value, "channels")
        if enabled is None and channels_value is None:
            raise ApiError(400, "give enabled and/or channels (or reset: true)")
        return category, enabled, channels_value

    def _preference_owner(self, app: dict, source: dict) -> tuple[str, dict | None, str]:
        if source.get("subscriber_id"):
            subscriber = self.server.store.get_subscriber(int(source["subscriber_id"]))
            if not subscriber or subscriber["app_id"] != app["id"]:
                raise ApiError(404, "subscriber not found")
            return f"sub:{subscriber['id']}", subscriber, ""
        user_id = _text(source.get("user_id"), "user_id", 128)
        if not user_id:
            raise ApiError(400, "give user_id or subscriber_id")
        return f"user:{user_id}", None, user_id

    @route("GET", r"/v1/preferences", "sender")
    def get_preferences(self):
        """?user_id= or ?subscriber_id= — effective setting per category, and where it comes from."""
        app = self.resolve_app()
        _owner, subscriber, user_id = self._preference_owner(app, self.query)
        prefs = self.server.store.preferences_for(app["id"], subscriber, user_id)
        self.send_json({"ok": True, **prefs})

    @route("POST", r"/v1/preferences", "sender")
    def set_preferences(self):
        """{user_id | subscriber_id, category ('*' = all), enabled?, channels?, reset?}"""
        body = self.read_json()
        app = self.resolve_app(body)
        owner, subscriber, user_id = self._preference_owner(app, body)
        category, enabled, channels_value = self._preference_body(body)
        self.server.store.set_preference(app["id"], owner, category, enabled, channels_value)
        self.send_json({"ok": True, **self.server.store.preferences_for(app["id"], subscriber, user_id)})

    @route("GET", r"/v1/me/preferences", "public")
    def my_preferences(self):
        """For the subscriber's own device/app (beacon.js): ?app_key=&token="""
        app = self.public_app(self.query.get("app_key", ""))
        subscriber = self.server.store.subscriber_by_token(app["id"], self.query.get("token", ""))
        if not subscriber:
            raise ApiError(404, "unknown subscriber token")
        prefs = self.server.store.preferences_for(app["id"], subscriber)
        self.send_json({"ok": True, **prefs}, extra=self.cors_headers(app))

    @route("POST", r"/v1/me/preferences", "public")
    def set_my_preference(self):
        """{app_key, token, category?, enabled?, channels?, reset?, scope?: user|subscriber}"""
        body = self.read_json()
        app, subscriber = self._subscriber_from_body(body)
        category, enabled, channels_value = self._preference_body(body)
        scope = "subscriber" if body.get("scope") == "subscriber" else "auto"
        self.server.store.set_preference(app["id"], self.server.store.owner_of(subscriber, scope), category,
                                         enabled, channels_value)
        prefs = self.server.store.preferences_for(app["id"], subscriber)
        self.send_json({"ok": True, **prefs}, extra=self.cors_headers(app))

    # ---------------------------------------------------------------- templates
    @route("GET", r"/v1/templates", "sender")
    def list_templates(self):
        app = self.resolve_app()
        templates = self.server.store.list_templates(app["id"])
        for template in templates:
            template["variables"] = template_variables({k: template[k] for k in TEMPLATE_FIELDS if k in template})
        self.send_json({"ok": True, "templates": templates})

    @route("POST", r"/v1/templates", "sender")
    def save_template(self):
        """{name, title, body?, url?, channels?, category?, urgency?, tag?, target?, data?, fallback?, digest?}"""
        body = self.read_json()
        app = self.resolve_app(body)
        name = str(body.get("name") or "")
        spec = validate_template(name, body)
        template = self.server.store.save_template(app["id"], name, spec)
        template["variables"] = template_variables(spec)
        self.send_json({"ok": True, "template": template}, 201)

    @route("GET", r"/v1/templates/([A-Za-z0-9][\w.\-]{0,63})", "sender")
    def get_template(self, name):
        app = self.resolve_app()
        template = self.server.store.get_template(app["id"], name)
        if not template:
            raise ApiError(404, "template not found")
        template["variables"] = template_variables({k: template[k] for k in TEMPLATE_FIELDS if k in template})
        self.send_json({"ok": True, "template": template})

    @route("POST", r"/v1/templates/([A-Za-z0-9][\w.\-]{0,63})/render", "sender")
    def render_template_preview(self, name):
        """Preview: {vars} -> the message that /v1/send would create (nothing is sent)."""
        body = self.read_json()
        app = self.resolve_app(body)
        fields = validate_message(self._from_template(app, {"template": name, "vars": body.get("vars") or {}}))
        fields.pop("send_at", None)
        self.send_json({"ok": True, "message": fields})

    @route("POST", r"/v1/templates/([A-Za-z0-9][\w.\-]{0,63})/delete", "sender")
    def delete_template(self, name):
        app = self.resolve_app()
        if not self.server.store.delete_template(app["id"], name):
            raise ApiError(404, "template not found")
        self.send_json({"ok": True})

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
