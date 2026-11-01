"""Tether ↔ Beacon link: send a push through Beacon, then verify it on a device.

Configure with environment variables (or server.py --beacon-url / --beacon-key):

  BEACON_URL   e.g. https://push.example.com
  BEACON_KEY   the app's secret key (sk_…) — or the admin token plus BEACON_APP_ID

Standard library only.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

_LOOPBACK = {"127.0.0.1", "localhost", "::1"}
_DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class BeaconError(RuntimeError):
    pass


class BeaconLink:
    def __init__(self, url: str, key: str, app_id: int | None = None, timeout: float = 20):
        if not url or not key:
            raise BeaconError("Beacon is not configured (set BEACON_URL and BEACON_KEY, or start "
                              "Tether with --beacon-url and --beacon-key)")
        self.url = url.rstrip("/")
        self.key = key
        self.app_id = app_id
        self.timeout = timeout

    @classmethod
    def from_env(cls) -> "BeaconLink":
        app_id = os.environ.get("BEACON_APP_ID")
        return cls(os.environ.get("BEACON_URL", ""), os.environ.get("BEACON_KEY", ""),
                   int(app_id) if app_id else None)

    @staticmethod
    def configured() -> bool:
        return bool(os.environ.get("BEACON_URL") and os.environ.get("BEACON_KEY"))

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        request = urllib.request.Request(
            self.url + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
        )
        host = urllib.parse.urlparse(self.url).hostname or ""
        opener = _DIRECT if host in _LOOPBACK else urllib.request.build_opener()
        try:
            with opener.open(request, timeout=self.timeout) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            try:
                message = json.loads(exc.read()).get("error", exc.reason)
            except ValueError:
                message = exc.reason
            raise BeaconError(f"Beacon {exc.code}: {message}") from exc
        except urllib.error.URLError as exc:
            raise BeaconError(f"cannot reach Beacon at {self.url}: {exc.reason}") from exc

    def send(self, fields: dict) -> dict:
        body = dict(fields)
        if self.app_id and "app_id" not in body:
            body["app_id"] = self.app_id
        return self._call("POST", "/v1/send", body)["message"]

    def app_info(self) -> dict:
        path = "/v1/app" + (f"?app_id={self.app_id}" if self.app_id else "")
        return self._call("GET", path)["app"]

    def stats(self) -> dict:
        path = "/v1/stats" + (f"?app_id={self.app_id}" if self.app_id else "")
        return self._call("GET", path)["stats"]

    def message(self, message_id: int) -> dict:
        return self._call("GET", f"/v1/messages/{int(message_id)}")["message"]

    def send_and_wait(self, fields: dict, timeout: float = 30) -> dict:
        """Send now and wait until Beacon has finished delivering. Raises if nobody got it."""
        fields = {k: v for k, v in fields.items() if k not in ("send_at", "delay_seconds")}
        message = self.send(fields)
        deadline = time.monotonic() + timeout
        while message["status"] in ("queued", "sending") and time.monotonic() < deadline:
            time.sleep(0.3)
            message = self.message(message["id"])
        if message["status"] != "sent":
            raise BeaconError(f"Beacon message {message['id']} is still {message['status']} after {timeout:.0f}s")
        if message["targeted"] and not message["delivered"]:
            raise BeaconError(
                f"Beacon delivered to 0 of {message['targeted']} subscriber(s) "
                f"(failed {message['failed']}, pruned {message['pruned']}){': ' + message['error'] if message['error'] else ''}"
            )
        if not message["targeted"] and "inapp" not in message["channels"]:
            raise BeaconError("no Beacon subscriber matched the target — is the device subscribed with that tag/user?")
        return message
