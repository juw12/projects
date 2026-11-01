"""Firebase Cloud Messaging (HTTP v1) for native Android / Capacitor apps.

Standard library only: the service-account JWT is signed with RS256
(RSASSA-PKCS1-v1_5 + SHA-256) implemented with Python's big integers, the
access token comes from Google's OAuth endpoint, and messages go to
https://fcm.googleapis.com/v1/projects/<project>/messages:send.

Web browsers do NOT need this — they use Web Push (webpush.py). FCM is for
apps built with @capacitor/push-notifications (Android; iOS too if your
Firebase project has an APNs key uploaded).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"
FCM_API_BASE = "https://fcm.googleapis.com"
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")

# Errors meaning the token is dead: remove the device.
DEAD_TOKEN_ERRORS = {"UNREGISTERED", "INVALID_ARGUMENT", "SENDER_ID_MISMATCH"}


_LOOPBACK = {"127.0.0.1", "localhost", "::1"}
_DIRECT_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def open_url(request, timeout):
    """urlopen that never routes loopback traffic through a system/corporate proxy."""
    host = urllib.parse.urlparse(request.full_url).hostname or ""
    if host in _LOOPBACK:
        return _DIRECT_OPENER.open(request, timeout=timeout)
    return urllib.request.urlopen(request, timeout=timeout)


class FcmError(RuntimeError):
    pass


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# ----------------------------------------------------------------- DER / RSA
def _der_read(data: bytes, offset: int):
    """Return (tag, value_bytes, next_offset) for one DER TLV."""
    tag = data[offset]
    length = data[offset + 1]
    offset += 2
    if length & 0x80:
        count = length & 0x7F
        length = int.from_bytes(data[offset:offset + count], "big")
        offset += count
    value = data[offset:offset + length]
    if len(value) != length:
        raise FcmError("truncated DER structure in private key")
    return tag, value, offset + length


def _der_sequence(data: bytes) -> list[tuple[int, bytes]]:
    items = []
    offset = 0
    while offset < len(data):
        tag, value, offset = _der_read(data, offset)
        items.append((tag, value))
    return items


class RsaKey:
    def __init__(self, n, e, d, p, q, dp, dq, qinv):
        self.n, self.e, self.d = n, e, d
        self.p, self.q, self.dp, self.dq, self.qinv = p, q, dp, dq, qinv
        self.size = (n.bit_length() + 7) // 8

    @classmethod
    def from_pem(cls, pem: str) -> "RsaKey":
        match = re.search(r"-----BEGIN (RSA )?PRIVATE KEY-----(.+?)-----END (RSA )?PRIVATE KEY-----", pem, re.S)
        if not match:
            raise FcmError("service account private_key is not a PEM private key")
        der = base64.b64decode("".join(match.group(2).split()))
        tag, body, _ = _der_read(der, 0)
        if tag != 0x30:
            raise FcmError("private key is not a DER SEQUENCE")
        items = _der_sequence(body)
        if not match.group(1):
            # PKCS#8 PrivateKeyInfo: version, algorithm, OCTET STRING(RSAPrivateKey)
            if len(items) < 3 or items[2][0] != 0x04:
                raise FcmError("unsupported PKCS#8 key layout")
            tag, body, _ = _der_read(items[2][1], 0)
            items = _der_sequence(body)
        numbers = [int.from_bytes(value, "big") for tag, value in items if tag == 0x02]
        if len(numbers) < 9:
            raise FcmError("RSA private key is missing CRT parameters")
        return cls(*numbers[1:9])

    def sign_sha256(self, message: bytes) -> bytes:
        """RSASSA-PKCS1-v1_5 with SHA-256 (RFC 8017 §8.2), using CRT."""
        digest_info = SHA256_DIGEST_INFO + hashlib.sha256(message).digest()
        padding = self.size - len(digest_info) - 3
        if padding < 8:
            raise FcmError("RSA key too small")
        encoded = b"\x00\x01" + b"\xff" * padding + b"\x00" + digest_info
        m = int.from_bytes(encoded, "big")
        s1 = pow(m, self.dp, self.p)
        s2 = pow(m, self.dq, self.q)
        h = (self.qinv * (s1 - s2)) % self.p
        signature = s2 + h * self.q
        if pow(signature, self.e, self.n) != m:  # fault check
            raise FcmError("RSA signature self-check failed")
        return signature.to_bytes(self.size, "big")


def verify_rs256(n: int, e: int, message: bytes, signature: bytes) -> bool:
    """Verifier used by the tests (and handy for debugging)."""
    size = (n.bit_length() + 7) // 8
    digest_info = SHA256_DIGEST_INFO + hashlib.sha256(message).digest()
    expected = b"\x00\x01" + b"\xff" * (size - len(digest_info) - 3) + b"\x00" + digest_info
    return pow(int.from_bytes(signature, "big"), e, n).to_bytes(size, "big") == expected


# ---------------------------------------------------------------- the sender
def _test_hosts_allowed() -> bool:
    return bool(os.environ.get("BEACON_TEST_HOSTS"))


class FcmSender:
    """One per Beacon app (one Firebase project)."""

    def __init__(self, service_account: dict, api_base: str | None = None, timeout: float = 15):
        for key in ("project_id", "client_email", "private_key"):
            if not service_account.get(key):
                raise FcmError(f"service account JSON is missing {key}")
        self.project_id = service_account["project_id"]
        self.client_email = service_account["client_email"]
        self.key = RsaKey.from_pem(service_account["private_key"])
        self.token_uri = service_account.get("token_uri") or GOOGLE_TOKEN_URI
        self.api_base = (api_base or os.environ.get("BEACON_FCM_API_BASE") or FCM_API_BASE).rstrip("/")
        if not _test_hosts_allowed():
            # Never send credentials anywhere but Google.
            self.token_uri = GOOGLE_TOKEN_URI
            self.api_base = FCM_API_BASE
        self.timeout = timeout
        self._token = None
        self._token_expiry = 0.0
        self._lock = threading.Lock()

    def _assertion(self) -> str:
        now = int(time.time())
        header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}, separators=(",", ":")).encode())
        claims = _b64url(json.dumps({
            "iss": self.client_email,
            "scope": FCM_SCOPE,
            "aud": self.token_uri,
            "iat": now,
            "exp": now + 3600,
        }, separators=(",", ":")).encode())
        signing_input = f"{header}.{claims}".encode("ascii")
        return f"{header}.{claims}.{_b64url(self.key.sign_sha256(signing_input))}"

    def access_token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._token_expiry - 120:
                return self._token
            body = urllib.parse.urlencode({
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": self._assertion(),
            }).encode()
            request = urllib.request.Request(
                self.token_uri,
                data=body,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            try:
                with open_url(request, self.timeout) as response:
                    data = json.loads(response.read())
            except urllib.error.HTTPError as exc:
                raise FcmError(f"Google OAuth rejected the service account: {exc.read()[:300]!r}") from exc
            self._token = data["access_token"]
            self._token_expiry = time.time() + int(data.get("expires_in", 3600))
            return self._token

    @staticmethod
    def build_message(device_token: str, payload: dict, ttl: int, urgency: str) -> dict:
        data = {"beacon": json.dumps(payload, separators=(",", ":"))}
        if payload.get("url"):
            data["url"] = payload["url"]
        notification = {"title": payload.get("title") or "", "body": payload.get("body") or ""}
        if payload.get("image"):
            notification["image"] = payload["image"]
        android_notification = {}
        if payload.get("tag"):
            android_notification["tag"] = payload["tag"]
        if payload.get("icon_name"):
            android_notification["icon"] = payload["icon_name"]
        return {
            "message": {
                "token": device_token,
                "notification": notification,
                "data": data,
                "android": {
                    "priority": "high" if urgency in ("high", "normal") else "normal",
                    "ttl": f"{max(0, int(ttl))}s",
                    "notification": android_notification,
                },
                "apns": {"headers": {"apns-priority": "10" if urgency == "high" else "5"}},
            }
        }

    def send(self, device_token: str, payload: dict, ttl: int = 86400, urgency: str = "high") -> tuple[int, str]:
        """Returns (http_status, fcm_error_code or '')."""
        message = self.build_message(device_token, payload, ttl, urgency)
        url = f"{self.api_base}/v1/projects/{urllib.parse.quote(self.project_id)}/messages:send"
        request = urllib.request.Request(
            url,
            data=json.dumps(message).encode(),
            headers={
                "Authorization": f"Bearer {self.access_token()}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        try:
            with open_url(request, self.timeout) as response:
                response.read()
                return response.status, ""
        except urllib.error.HTTPError as exc:
            code = ""
            try:
                error = json.loads(exc.read()).get("error", {})
                code = error.get("status", "")
                for detail in error.get("details", []):
                    code = detail.get("errorCode", code)
            except (ValueError, AttributeError):
                pass
            if exc.code == 401:
                with self._lock:
                    self._token = None
            return exc.code, code
