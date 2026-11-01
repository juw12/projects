"""Extra delivery channels: ntfy topics, Bark devices, Gotify apps and Apprise URLs.

ntfy (https://ntfy.sh, Apache-2.0) — zero-dependency: Beacon publishes the
notification as JSON to the topic's server. Anyone with the ntfy app
(Android/iOS/web) subscribed to that topic gets it, no SDK needed.

Bark (https://github.com/Finb/Bark, MIT) — native iPhone pushes through APNs
without an Apple developer account: the Bark app shows a device URL like
https://api.day.app/<device_key>; Beacon POSTs JSON to <server>/push
(bark-server API v2). Self-hosted bark-server works via BEACON_BARK_HOSTS.

Gotify (https://github.com/gotify/server, MIT) — self-hosted push server with
an Android app. Beacon POSTs to <server>/message with the application token in
X-Gotify-Key. Gotify is always self-hosted, so hosts must be allow-listed
(BEACON_GOTIFY_HOSTS); the token is stored like the ntfy secret, never shown.

Apprise (https://github.com/caronc/apprise, BSD-2) — optional
`pip install apprise` unlocks 100+ services (Telegram, Slack, Discord, Teams,
email, Pushover, Gotify, …) via one URL per contact, e.g. tgram://bot/chat.

Both are "contacts": registered by an app's backend (secret key) or an admin,
never by the public subscribe endpoint, so strangers cannot make Beacon post
to arbitrary URLs.
"""

from __future__ import annotations

import hashlib
import http.client
import importlib
import json
import os
import re
import urllib.request
from urllib.parse import urlparse

NTFY_TOPIC_RE = re.compile(r"^[-_A-Za-z0-9]{1,64}$")
NTFY_PRIORITY = {"very-low": 1, "low": 2, "normal": 3, "high": 4}
BARK_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
BARK_LEVEL = {"very-low": "passive", "low": "passive", "normal": "active", "high": "timeSensitive"}
GOTIFY_TOKEN_RE = re.compile(r"^[A-Za-z0-9._-]{8,128}$")
GOTIFY_PRIORITY = {"very-low": 1, "low": 3, "normal": 5, "high": 8}
CONTACT_CHANNELS = ("ntfy", "bark", "gotify", "apprise")
APPRISE_URL_RE = re.compile(r"^[a-z][a-z0-9+.\-]{1,31}://\S+$", re.IGNORECASE)
LOOPBACK = ("127.0.0.1", "localhost", "::1")


class ChannelError(ValueError):
    pass


# ------------------------------------------------------------------ network
def egress_proxy(host: str) -> tuple[str, int] | None:
    """Outbound proxy for push services: BEACON_PROXY, else the system proxy.

    BEACON_PROXY=none disables proxying. Loopback never uses a proxy.
    """
    if host in LOOPBACK:
        return None
    configured = os.environ.get("BEACON_PROXY", "").strip()
    if configured.lower() == "none":
        return None
    if not configured:
        configured = urllib.request.getproxies().get("https", "")
        if not configured or urllib.request.proxy_bypass(host):
            return None
    parsed = urlparse(configured if "://" in configured else "http://" + configured)
    return parsed.hostname, parsed.port or 8080


def http_post(url: str, body: bytes, headers: dict, timeout: int = 15) -> tuple[int, bytes]:
    """POST through the egress proxy (CONNECT tunnel for https)."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    secure = parsed.scheme == "https"
    port = parsed.port or (443 if secure else 80)
    proxy = egress_proxy(host)
    path = (parsed.path or "/") + ("?" + parsed.query if parsed.query else "")
    if proxy and secure:
        connection = http.client.HTTPSConnection(proxy[0], proxy[1], timeout=timeout)
        connection.set_tunnel(host, port)
    elif proxy:
        connection = http.client.HTTPConnection(proxy[0], proxy[1], timeout=timeout)
        path = url  # plain-http proxies take the absolute URL
    elif secure:
        connection = http.client.HTTPSConnection(host, port, timeout=timeout)
    else:
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, response.read(4096)
    finally:
        connection.close()


# --------------------------------------------------------------------- ntfy
def ntfy_hosts() -> set[str]:
    configured = os.environ.get("BEACON_NTFY_HOSTS", "")
    hosts = {h.strip().lower() for h in configured.split(",") if h.strip()}
    return hosts or {"ntfy.sh"}


def validate_ntfy(address: str, test_hosts: tuple[str, ...] = ()) -> str:
    """Normalise a topic URL like https://ntfy.sh/my-topic (or a bare topic name)."""
    address = (address or "").strip()
    if NTFY_TOPIC_RE.match(address):
        address = "https://ntfy.sh/" + address
    parsed = urlparse(address)
    host = (parsed.hostname or "").lower()
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ChannelError("ntfy URL must be plain https://host/topic (pass access tokens as 'secret')")
    loopback_test = host in test_hosts and host in LOOPBACK
    if parsed.scheme != "https" and not (loopback_test and parsed.scheme == "http"):
        raise ChannelError("ntfy URL must use https")
    if host not in ntfy_hosts() and not loopback_test:
        raise ChannelError(f"ntfy host {host!r} is not allowed (BEACON_NTFY_HOSTS={','.join(sorted(ntfy_hosts()))})")
    topic = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    if not NTFY_TOPIC_RE.match(topic):
        raise ChannelError("ntfy topic must be 1-64 letters, digits, - or _")
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}"


def absolute(url: str) -> str:
    return url if url.startswith(("https://", "http://")) else ""


def ntfy_message(topic: str, payload: dict, urgency: str) -> dict:
    message = {
        "topic": topic,
        "title": payload.get("title", ""),
        "message": payload.get("body") or payload.get("title", ""),
        "priority": NTFY_PRIORITY.get(urgency, 3),
    }
    if absolute(payload.get("url", "")):
        message["click"] = payload["url"]
    if absolute(payload.get("icon", "")):
        message["icon"] = payload["icon"]
    if absolute(payload.get("image", "")):
        message["attach"] = payload["image"]
    if payload.get("tag"):
        message["tags"] = [payload["tag"]]
    return message


def send_ntfy(address: str, secret: str, payload: dict, urgency: str, timeout: int = 15) -> int:
    """Publish as JSON to the server root (ntfy's documented JSON publishing)."""
    base, topic = address.rsplit("/", 1)
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    body = json.dumps(ntfy_message(topic, payload, urgency)).encode()
    status, _ = http_post(base + "/", body, headers, timeout)
    return status


# --------------------------------------------------------------------- bark
def bark_hosts() -> set[str]:
    configured = os.environ.get("BEACON_BARK_HOSTS", "")
    hosts = {h.strip().lower() for h in configured.split(",") if h.strip()}
    return hosts or {"api.day.app"}


def _plain_https(parsed, kind: str, test_hosts: tuple[str, ...], allowed: set[str], env: str) -> None:
    """Shared URL rules: https, no credentials/query/fragment, allow-listed host."""
    host = (parsed.hostname or "").lower()
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ChannelError(f"{kind} URL must be a plain https://host/… URL")
    loopback_test = host in test_hosts and host in LOOPBACK
    if parsed.scheme != "https" and not (loopback_test and parsed.scheme == "http"):
        raise ChannelError(f"{kind} URL must use https")
    if host not in allowed and not loopback_test:
        listed = ",".join(sorted(allowed)) or "(empty)"
        raise ChannelError(f"{kind} host {host!r} is not allowed ({env}={listed})")


def validate_bark(address: str, test_hosts: tuple[str, ...] = ()) -> str:
    """Normalise the Bark device URL (https://api.day.app/<device_key>) or a bare device key."""
    address = (address or "").strip()
    if BARK_KEY_RE.match(address):
        address = "https://api.day.app/" + address
    parsed = urlparse(address)
    _plain_https(parsed, "Bark", test_hosts, bark_hosts(), "BEACON_BARK_HOSTS")
    path = parsed.path.rstrip("/")
    key = path.rsplit("/", 1)[-1]
    if not BARK_KEY_RE.match(key):
        raise ChannelError("Bark address must end with the device key, e.g. https://api.day.app/<device_key>")
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def bark_message(device_key: str, payload: dict, urgency: str) -> dict:
    message = {
        "device_key": device_key,
        "title": payload.get("title", ""),
        "body": payload.get("body") or payload.get("title", ""),
        "level": BARK_LEVEL.get(urgency, "active"),
        "isArchive": "1",
    }
    if absolute(payload.get("url", "")):
        message["url"] = payload["url"]
    if absolute(payload.get("icon", "")):
        message["icon"] = payload["icon"]
    if payload.get("tag"):
        message["group"] = payload["tag"]
    return message


def send_bark(address: str, payload: dict, urgency: str, timeout: int = 15) -> int:
    """POST <server>/push (bark-server API v2). Bark also reports errors in a JSON `code`."""
    base, device_key = address.rsplit("/", 1)
    body = json.dumps(bark_message(device_key, payload, urgency)).encode()
    status, raw = http_post(base + "/push", body, {"Content-Type": "application/json; charset=utf-8"}, timeout)
    if status == 200:
        try:
            code = int(json.loads(raw or b"{}").get("code", 200))
        except (ValueError, TypeError, AttributeError):
            code = 200
        return code if code >= 300 else status
    return status


# ------------------------------------------------------------------- gotify
def gotify_hosts() -> set[str]:
    configured = os.environ.get("BEACON_GOTIFY_HOSTS", "")
    return {h.strip().lower() for h in configured.split(",") if h.strip()}


def validate_gotify(address: str, token: str, test_hosts: tuple[str, ...] = ()) -> str:
    """Server root like https://push.example.com; the application token comes separately.

    The stored address gets a short token fingerprint (#k…) so two Gotify apps on
    one server stay two contacts; send_gotify strips it.
    """
    token = (token or "").strip()
    if not GOTIFY_TOKEN_RE.match(token):
        raise ChannelError("Gotify needs the application token as 'secret' (Gotify → Apps → token)")
    parsed = urlparse((address or "").strip())
    _plain_https(parsed, "Gotify", test_hosts, gotify_hosts(), "BEACON_GOTIFY_HOSTS")
    path = parsed.path.rstrip("/")
    if path.endswith("/message"):
        path = path[: -len("/message")]
    fingerprint = hashlib.sha256(token.encode()).hexdigest()[:10]
    return f"{parsed.scheme}://{parsed.netloc}{path}#k{fingerprint}"


def gotify_message(payload: dict, urgency: str) -> dict:
    notification: dict = {}
    if absolute(payload.get("url", "")):
        notification["click"] = {"url": payload["url"]}
    if absolute(payload.get("image", "")):
        notification["bigImageUrl"] = payload["image"]
    extras: dict = {"client::display": {"contentType": "text/plain"}}
    if notification:
        extras["client::notification"] = notification
    return {
        "title": payload.get("title", ""),
        "message": payload.get("body") or payload.get("title", ""),
        "priority": GOTIFY_PRIORITY.get(urgency, 5),
        "extras": extras,
    }


def send_gotify(address: str, token: str, payload: dict, urgency: str, timeout: int = 15) -> int:
    base = address.split("#", 1)[0]
    headers = {"Content-Type": "application/json", "X-Gotify-Key": token}
    body = json.dumps(gotify_message(payload, urgency)).encode()
    status, _ = http_post(base + "/message", body, headers, timeout)
    return status


# ------------------------------------------------------------------ apprise
def apprise_module():
    """The apprise package if installed (pip install apprise), else None."""
    try:
        return importlib.import_module("apprise")
    except ImportError:
        return None


def apprise_version() -> str | None:
    module = apprise_module()
    return getattr(module, "__version__", "installed") if module else None


def validate_apprise(address: str) -> str:
    address = (address or "").strip()
    if not APPRISE_URL_RE.match(address) or len(address) > 2000:
        raise ChannelError("apprise address must be a service URL like tgram://bottoken/chatid")
    module = apprise_module()
    if module is None:
        raise ChannelError("Apprise is not installed on the Beacon server (pip install apprise)")
    if not module.Apprise().add(address):
        raise ChannelError("Apprise does not recognise that URL (see github.com/caronc/apprise/wiki)")
    return address


def send_apprise(address: str, payload: dict) -> int:
    module = apprise_module()
    if module is None:
        raise ChannelError("Apprise is not installed (pip install apprise)")
    notifier = module.Apprise()
    if not notifier.add(address):
        return 400
    body = payload.get("body") or payload.get("title", "")
    if absolute(payload.get("url", "")):
        body = f"{body}\n{payload['url']}"
    return 200 if notifier.notify(title=payload.get("title", ""), body=body) else 502


# ------------------------------------------------------------------- shared
def mask_address(channel: str, address: str) -> str:
    """Contact URLs often embed bot tokens — only show what identifies them."""
    if channel == "apprise":
        scheme = address.split("://", 1)[0]
        return f"{scheme}://…{address[-4:]}" if len(address) > 12 else f"{scheme}://…"
    if channel == "ntfy":
        return address
    if channel == "bark":  # the device key alone lets anyone push to that iPhone
        base, key = address.rsplit("/", 1)
        return f"{base}/…{key[-4:]}"
    if channel == "gotify":
        return address.split("#", 1)[0]
    return address[:60]


def capabilities(test_hosts: tuple[str, ...] = ()) -> dict:
    return {
        "ntfy": {"available": True, "hosts": sorted(ntfy_hosts())},
        "bark": {"available": True, "hosts": sorted(bark_hosts())},
        "gotify": {"available": bool(gotify_hosts()), "hosts": sorted(gotify_hosts())},
        "apprise": {"available": apprise_module() is not None, "version": apprise_version()},
    }
