"""Background delivery: picks up due messages and fans them out to every channel."""

from __future__ import annotations

import json
import os
import re
import sys
import http.client
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import channels
import webpush
from channels import ChannelError, egress_proxy  # noqa: F401 (re-exported)
from fcm import DEAD_TOKEN_ERRORS, FcmError, FcmSender
from store import Store

MAX_PAYLOAD_BYTES = 3000  # Web Push allows ~3993 after encryption overhead; FCM 4096
RETRYABLE = {429, 500, 502, 503, 504}
OK_STATUSES = {200, 201, 202, 204}


def test_push_hosts() -> tuple[str, ...]:
    """Extra push hosts (loopback only) for hermetic tests."""
    hosts = os.environ.get("BEACON_TEST_HOSTS", "")
    return tuple(h.strip() for h in hosts.split(",") if h.strip() in ("127.0.0.1", "localhost"))


def send_webpush(vapid: webpush.Vapid, endpoint: str, ua_public: bytes, auth_secret: bytes, payload: bytes,
                 ttl: int, urgency: str, topic: str | None, timeout: int = 15) -> int:
    """Same request as webpush.send(), but able to tunnel through an HTTPS proxy."""
    parsed = urlparse(endpoint)
    proxy = egress_proxy(parsed.hostname or "") if parsed.scheme == "https" else None
    if proxy is None:
        return webpush.send(vapid, endpoint, ua_public, auth_secret, payload,
                            ttl=ttl, urgency=urgency, topic=topic, timeout=timeout)
    headers = {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": str(ttl),
        "Urgency": urgency,
        "Authorization": vapid.authorization(endpoint),
    }
    if topic:
        headers["Topic"] = topic
    connection = http.client.HTTPSConnection(proxy[0], proxy[1], timeout=timeout)
    connection.set_tunnel(parsed.hostname, parsed.port or 443)
    try:
        path = (parsed.path or "/") + ("?" + parsed.query if parsed.query else "")
        connection.request("POST", path, body=webpush.encrypt(payload, ua_public, auth_secret), headers=headers)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def build_payload(store: Store, app: dict, message: dict, public_url: str) -> dict:
    payload = {
        "id": message["id"],
        "title": message["title"],
        "body": message["body"],
        "url": message["url"] or app.get("default_url") or "",
        "icon": message["icon"] or app.get("icon") or "",
        "image": message["image"],
        "tag": message["tag"],
        "data": message["data"],
        "beacon": public_url,
        "sig": store.track_signature(message["id"]),
    }
    return {k: v for k, v in payload.items() if v not in ("", None, {})}


def push_topic(tag: str) -> str | None:
    """RFC 8030 Topic: at most 32 URL-safe base64 characters."""
    topic = re.sub(r"[^A-Za-z0-9_-]", "", tag or "")[:32]
    return topic or None


def payload_size(payload: dict) -> int:
    return len(json.dumps(payload, separators=(",", ":")).encode())


class Dispatcher:
    def __init__(self, store: Store, public_url: str, workers: int = 16, poll_seconds: float = 1.0):
        self.store = store
        self.public_url = public_url.rstrip("/")
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="beacon-send")
        self.poll_seconds = poll_seconds
        self.wake = threading.Event()
        self.stopping = False
        self._vapid_cache: dict[int, webpush.Vapid] = {}
        self._fcm_cache: dict[int, tuple[str, FcmSender]] = {}
        self.last_errors: dict[int, str] = {}
        self.thread = threading.Thread(target=self._loop, name="beacon-dispatcher", daemon=True)

    def start(self) -> "Dispatcher":
        requeued = self.store.requeue_interrupted()
        if requeued:
            print(f"[beacon] re-queued {requeued} interrupted message(s)", file=sys.stderr)
        self.thread.start()
        return self

    def stop(self) -> None:
        self.stopping = True
        self.wake.set()
        self.pool.shutdown(wait=False, cancel_futures=True)

    def nudge(self) -> None:
        self.wake.set()

    # ------------------------------------------------------------------ loop
    def _loop(self) -> None:
        while not self.stopping:
            try:
                self.store.process_fallbacks()
                for message in self.store.claim_due():
                    self._deliver(message)
            except Exception:  # never let the dispatcher die
                traceback.print_exc()
            self.wake.wait(self.poll_seconds)
            self.wake.clear()

    def _vapid(self, app: dict) -> webpush.Vapid:
        cached = self._vapid_cache.get(app["id"])
        if cached is None or cached.subject != app["vapid_subject"]:
            cached = webpush.Vapid(int(app["vapid_private"], 16), app["vapid_subject"])
            self._vapid_cache[app["id"]] = cached
        return cached

    def _fcm(self, app: dict) -> FcmSender | None:
        account = app.get("fcm_account") or ""
        if not account:
            return None
        cached = self._fcm_cache.get(app["id"])
        if cached and cached[0] == account:
            return cached[1]
        sender = FcmSender(json.loads(account))
        self._fcm_cache[app["id"]] = (account, sender)
        return sender

    def _deliver(self, message: dict) -> None:
        app = self.store.get_app(message["app_id"])
        if app is None:
            self.store.finish_message(message["id"], "failed", "app deleted")
            return
        payload = build_payload(self.store, app, message, self.public_url)
        recipients = self.store.targets(app["id"], message["target"], message["channels"])
        self.store.bump(message["id"], "targeted", len(recipients))

        fcm_sender = None
        fcm_error = ""
        if any(s["channel"] == "fcm" for s in recipients):
            try:
                fcm_sender = self._fcm(app)
            except (FcmError, ValueError) as exc:
                fcm_error = f"FCM not usable: {exc}"
            if fcm_sender is None and not fcm_error:
                fcm_error = "FCM devices exist but no service account is configured"

        body = json.dumps(payload, separators=(",", ":")).encode()
        futures = []
        for subscriber in recipients:
            if subscriber["channel"] == "webpush":
                futures.append(self.pool.submit(self._send_webpush, app, message, subscriber, body))
            elif subscriber["channel"] in ("ntfy", "apprise"):
                futures.append(self.pool.submit(self._send_contact, message, subscriber, payload))
            elif fcm_sender is not None:
                futures.append(self.pool.submit(self._send_fcm, fcm_sender, message, subscriber, payload))
            else:
                self.store.bump(message["id"], "failed")
        for future in futures:
            try:
                future.result()
            except Exception:
                traceback.print_exc()
                self.store.bump(message["id"], "failed")
        network_error = self.last_errors.pop(message["id"], "")
        self.store.finish_message(message["id"], "sent", "; ".join(e for e in (fcm_error, network_error) if e))

    # -------------------------------------------------------------- channels
    def _outcome(self, message: dict, subscriber: dict, status: int, dead: bool) -> None:
        if status in OK_STATUSES:
            self.store.bump(message["id"], "delivered")
            self.store.record_success(subscriber["id"])
        elif dead:
            self.store.delete_subscriber(subscriber["id"])
            self.store.bump(message["id"], "pruned")
        else:
            self.store.bump(message["id"], "failed")
            if self.store.record_failure(subscriber["id"]):
                self.store.bump(message["id"], "pruned")

    def _send_webpush(self, app: dict, message: dict, subscriber: dict, body: bytes) -> None:
        endpoint = subscriber["address"]
        if not webpush.endpoint_allowed(endpoint, test_push_hosts()):
            self._outcome(message, subscriber, 0, dead=True)
            return
        status = 0
        last_error = ""
        for attempt in range(3):
            try:
                status = send_webpush(
                    self._vapid(app),
                    endpoint,
                    webpush.b64url_decode(subscriber["p256dh"]),
                    webpush.b64url_decode(subscriber["auth"]),
                    body,
                    ttl=message["ttl"],
                    urgency=message["urgency"],
                    topic=push_topic(message["tag"]),
                )
            except (OSError, ValueError) as exc:
                status = 0
                last_error = f"{type(exc).__name__}: {exc}"[:200]
            if status not in RETRYABLE and status != 0:
                break
            if attempt < 2:
                time.sleep(min(8, 0.5 * (3 ** attempt)))
        if status == 0 and last_error:
            self.last_errors[message["id"]] = last_error
        self._outcome(message, subscriber, status, dead=status in (404, 410))

    def _send_contact(self, message: dict, subscriber: dict, payload: dict) -> None:
        """ntfy topic or Apprise URL (see channels.py)."""
        status = 0
        last_error = ""
        for attempt in range(3):
            try:
                if subscriber["channel"] == "ntfy":
                    status = channels.send_ntfy(subscriber["address"], subscriber["auth"], payload,
                                                message["urgency"])
                else:
                    status = channels.send_apprise(subscriber["address"], payload)
            except ChannelError as exc:  # e.g. apprise uninstalled since registration
                status, last_error = 0, str(exc)[:200]
                break
            except (OSError, ValueError) as exc:
                status, last_error = 0, f"{type(exc).__name__}: {exc}"[:200]
            if status not in RETRYABLE and status != 0:
                break
            if attempt < 2:
                time.sleep(min(8, 0.5 * (3 ** attempt)))
        if status not in OK_STATUSES and not last_error:
            last_error = f"{subscriber['channel']} returned HTTP {status}"
        if last_error:
            self.last_errors[message["id"]] = last_error
        self._outcome(message, subscriber, status, dead=False)

    def _send_fcm(self, sender: FcmSender, message: dict, subscriber: dict, payload: dict) -> None:
        status, code = 0, ""
        for attempt in range(3):
            try:
                status, code = sender.send(subscriber["address"], payload, message["ttl"], message["urgency"])
            except (OSError, FcmError, ValueError) as exc:
                status, code = 0, str(exc)[:60]
            if status not in RETRYABLE and status not in (0, 401):
                break
            if attempt < 2:
                time.sleep(min(8, 0.5 * (3 ** attempt)))
        dead = status == 404 or (status == 400 and code in DEAD_TOKEN_ERRORS) or code == "UNREGISTERED"
        self._outcome(message, subscriber, status, dead=dead)
