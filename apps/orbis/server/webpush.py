"""Standards-based Web Push for Orbis (standard library only).

Implements what a server needs to deliver push notifications to browsers and
installed web apps (Chrome/Android via FCM, Safari/iOS 16.4+ via Apple, Firefox
via Mozilla, Edge via WNS) even when the app is fully closed:

* RFC 8291  Message Encryption for Web Push (aes128gcm, RFC 8188)
* RFC 8292  VAPID (ES256 JWT identifying this server to the push service)
* RFC 8030  Generic Event Delivery Using HTTP Push (TTL, Urgency, Topic)

Primitives (pure Python, checked against published vectors in
tests/verify_webpush.py): NIST P-256 ECDH/ECDSA with RFC 6979 deterministic
nonces, HKDF-SHA-256, AES-128 (FIPS-197) and AES-GCM (SP 800-38D).

Note: big-integer arithmetic in Python is not constant-time. The long-lived
VAPID key is only used to sign one JWT per push service per ~12 hours, on a
background thread, which keeps timing exposure minimal. Content encryption
uses a fresh ephemeral key for every message.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import json
import os
import socket
import struct
import time
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Encoding helpers
# ---------------------------------------------------------------------------


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    text = (text or "").strip().replace("+", "-").replace("/", "_")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _int(data: bytes) -> int:
    return int.from_bytes(data, "big")


def _bytes32(value: int) -> bytes:
    return value.to_bytes(32, "big")


# ---------------------------------------------------------------------------
# NIST P-256 (secp256r1)
# ---------------------------------------------------------------------------

P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
GX = 0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296
GY = 0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5
_INFINITY = (0, 1, 0)  # Jacobian coordinates, Z == 0 means the point at infinity


def _jacobian_double(point):
    x1, y1, z1 = point
    if z1 == 0 or y1 == 0:
        return _INFINITY
    delta = z1 * z1 % P
    gamma = y1 * y1 % P
    beta = x1 * gamma % P
    alpha = 3 * (x1 - delta) * (x1 + delta) % P
    x3 = (alpha * alpha - 8 * beta) % P
    z3 = ((y1 + z1) * (y1 + z1) - gamma - delta) % P
    y3 = (alpha * (4 * beta - x3) - 8 * gamma * gamma) % P
    return (x3, y3, z3)


def _jacobian_add(first, second):
    if first[2] == 0:
        return second
    if second[2] == 0:
        return first
    x1, y1, z1 = first
    x2, y2, z2 = second
    z1z1 = z1 * z1 % P
    z2z2 = z2 * z2 % P
    u1 = x1 * z2z2 % P
    u2 = x2 * z1z1 % P
    s1 = y1 * z2 * z2z2 % P
    s2 = y2 * z1 * z1z1 % P
    if u1 == u2:
        if s1 != s2:
            return _INFINITY
        return _jacobian_double(first)
    h = (u2 - u1) % P
    i = (2 * h) * (2 * h) % P
    j = h * i % P
    r = 2 * (s2 - s1) % P
    v = u1 * i % P
    x3 = (r * r - j - 2 * v) % P
    y3 = (r * (v - x3) - 2 * s1 * j) % P
    z3 = ((z1 + z2) * (z1 + z2) - z1z1 - z2z2) * h % P
    return (x3, y3, z3)


def _to_affine(point):
    x, y, z = point
    if z == 0:
        raise ValueError("point at infinity")
    z_inv = pow(z, -1, P)
    z_inv2 = z_inv * z_inv % P
    return (x * z_inv2 % P, y * z_inv2 * z_inv % P)


def scalar_mult(k: int, point_affine):
    """Montgomery ladder: k * point (uniform sequence of add/double)."""
    if not 0 < k < N:
        raise ValueError("scalar out of range")
    r0 = _INFINITY
    r1 = (point_affine[0], point_affine[1], 1)
    for bit_index in range(255, -1, -1):
        if (k >> bit_index) & 1:
            r0 = _jacobian_add(r0, r1)
            r1 = _jacobian_double(r1)
        else:
            r1 = _jacobian_add(r0, r1)
            r0 = _jacobian_double(r0)
    return _to_affine(r0)


def _double_scalar_mult(k1, point1, k2, point2):
    total = _jacobian_add(
        (*scalar_mult(k1, point1), 1),
        (*scalar_mult(k2, point2), 1),
    )
    return _to_affine(total)


def is_on_curve(point) -> bool:
    x, y = point
    if not (0 <= x < P and 0 <= y < P):
        return False
    return (y * y - (x * x * x + A * x + B)) % P == 0


def encode_point(point) -> bytes:
    return b"\x04" + _bytes32(point[0]) + _bytes32(point[1])


def decode_point(data: bytes):
    if len(data) != 65 or data[0] != 4:
        raise ValueError("expected an uncompressed P-256 public key (65 bytes)")
    point = (_int(data[1:33]), _int(data[33:]))
    if not is_on_curve(point):
        raise ValueError("public key is not on the P-256 curve")
    return point


def generate_private_key() -> int:
    while True:
        candidate = _int(os.urandom(32))
        if 0 < candidate < N:
            return candidate


def public_key(private_key: int) -> bytes:
    return encode_point(scalar_mult(private_key, (GX, GY)))


def ecdh(private_key: int, peer_public: bytes) -> bytes:
    shared = scalar_mult(private_key, decode_point(peer_public))
    return _bytes32(shared[0])


def _rfc6979_nonce(private_key: int, digest: bytes) -> int:
    key_bytes = _bytes32(private_key)
    digest_bytes = _bytes32(_int(digest) % N)
    v = b"\x01" * 32
    k = b"\x00" * 32
    k = hmac.new(k, v + b"\x00" + key_bytes + digest_bytes, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + key_bytes + digest_bytes, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        candidate = _int(v)
        if 0 < candidate < N:
            return candidate
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


def ecdsa_sign(private_key: int, message: bytes) -> bytes:
    """ES256 signature (raw 64-byte r || s) with an RFC 6979 nonce."""
    digest = hashlib.sha256(message).digest()
    e = _int(digest)
    k = _rfc6979_nonce(private_key, digest)
    r = scalar_mult(k, (GX, GY))[0] % N
    s = pow(k, -1, N) * (e + r * private_key) % N
    if r == 0 or s == 0:  # astronomically unlikely; RFC 6979 would continue
        raise ValueError("invalid signature, retry")
    return _bytes32(r) + _bytes32(s)


def ecdsa_verify(public: bytes, message: bytes, signature: bytes) -> bool:
    if len(signature) != 64:
        return False
    r, s = _int(signature[:32]), _int(signature[32:])
    if not (0 < r < N and 0 < s < N):
        return False
    e = _int(hashlib.sha256(message).digest())
    w = pow(s, -1, N)
    try:
        point = _double_scalar_mult(e * w % N, (GX, GY), r * w % N, decode_point(public))
    except ValueError:
        return False
    return point[0] % N == r


# ---------------------------------------------------------------------------
# AES-128 (FIPS-197) and AES-GCM (NIST SP 800-38D)
# ---------------------------------------------------------------------------


def _build_sbox():
    sbox = [0] * 256
    p = q = 1
    while True:
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        rotated = q
        value = q
        for _ in range(4):
            rotated = ((rotated << 1) | (rotated >> 7)) & 0xFF
            value ^= rotated
        sbox[p] = value ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


_SBOX = _build_sbox()


def _xtime(value):
    value <<= 1
    return (value ^ 0x11B) if value & 0x100 else value


def _expand_key(key: bytes):
    if len(key) != 16:
        raise ValueError("AES-128 key must be 16 bytes")
    words = [list(key[i:i + 4]) for i in range(0, 16, 4)]
    rcon = 1
    for index in range(4, 44):
        temp = list(words[index - 1])
        if index % 4 == 0:
            temp = temp[1:] + temp[:1]
            temp = [_SBOX[b] for b in temp]
            temp[0] ^= rcon
            rcon = _xtime(rcon)
        words.append([words[index - 4][j] ^ temp[j] for j in range(4)])
    return [sum(words[r * 4:(r + 1) * 4], []) for r in range(11)]


def _encrypt_block(round_keys, block: bytes) -> bytes:
    state = [block[i] ^ round_keys[0][i] for i in range(16)]
    for round_index in range(1, 11):
        state = [_SBOX[b] for b in state]
        # ShiftRows (state is column-major: index = row + 4 * column)
        state = [state[(r + 4 * ((c + r) % 4))] for c in range(4) for r in range(4)]
        if round_index != 10:
            mixed = []
            for c in range(4):
                a0, a1, a2, a3 = state[4 * c:4 * c + 4]
                total = a0 ^ a1 ^ a2 ^ a3
                mixed += [
                    a0 ^ total ^ _xtime(a0 ^ a1),
                    a1 ^ total ^ _xtime(a1 ^ a2),
                    a2 ^ total ^ _xtime(a2 ^ a3),
                    a3 ^ total ^ _xtime(a3 ^ a0),
                ]
            state = mixed
        key = round_keys[round_index]
        state = [state[i] ^ key[i] for i in range(16)]
    return bytes(state)


def aes128_encrypt_block(key: bytes, block: bytes) -> bytes:
    return _encrypt_block(_expand_key(key), block)


_GCM_R = 0xE1 << 120


def _gf_mult(x: int, y: int) -> int:
    z = 0
    v = y
    for bit_index in range(127, -1, -1):
        if (x >> bit_index) & 1:
            z ^= v
        v = (v >> 1) ^ _GCM_R if v & 1 else v >> 1
    return z


def _ghash(h: int, aad: bytes, ciphertext: bytes) -> int:
    y = 0
    for data in (aad, ciphertext):
        padded = data + b"\x00" * (-len(data) % 16)
        for offset in range(0, len(padded), 16):
            y = _gf_mult(y ^ _int(padded[offset:offset + 16]), h)
    lengths = struct.pack(">QQ", len(aad) * 8, len(ciphertext) * 8)
    return _gf_mult(y ^ _int(lengths), h)


def _gcm_ctr(round_keys, counter_block: bytes, data: bytes) -> bytes:
    prefix = counter_block[:12]
    counter = _int(counter_block[12:])
    output = bytearray()
    for offset in range(0, len(data), 16):
        counter = (counter + 1) & 0xFFFFFFFF
        keystream = _encrypt_block(round_keys, prefix + counter.to_bytes(4, "big"))
        chunk = data[offset:offset + 16]
        output += bytes(a ^ b for a, b in zip(chunk, keystream))
    return bytes(output)


def aes_gcm_encrypt(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes = b"") -> bytes:
    """Returns ciphertext || 16-byte tag."""
    if len(nonce) != 12:
        raise ValueError("GCM nonce must be 12 bytes")
    round_keys = _expand_key(key)
    h = _int(_encrypt_block(round_keys, b"\x00" * 16))
    j0 = nonce + b"\x00\x00\x00\x01"
    ciphertext = _gcm_ctr(round_keys, j0, plaintext)
    tag = _int(_encrypt_block(round_keys, j0)) ^ _ghash(h, aad, ciphertext)
    return ciphertext + tag.to_bytes(16, "big")


def aes_gcm_decrypt(key: bytes, nonce: bytes, data: bytes, aad: bytes = b"") -> bytes:
    if len(data) < 16:
        raise ValueError("ciphertext too short")
    round_keys = _expand_key(key)
    ciphertext, tag = data[:-16], data[-16:]
    h = _int(_encrypt_block(round_keys, b"\x00" * 16))
    j0 = nonce + b"\x00\x00\x00\x01"
    expected = _int(_encrypt_block(round_keys, j0)) ^ _ghash(h, aad, ciphertext)
    if not hmac.compare_digest(expected.to_bytes(16, "big"), tag):
        raise ValueError("authentication tag mismatch")
    return _gcm_ctr(round_keys, j0, ciphertext)


# ---------------------------------------------------------------------------
# RFC 8291 message encryption (aes128gcm)
# ---------------------------------------------------------------------------

RECORD_SIZE = 4096


def _hmac_sha256(key: bytes, data: bytes) -> bytes:
    return hmac.new(key, data, hashlib.sha256).digest()


def _derive_keys(ecdh_secret, auth_secret, ua_public, as_public, salt):
    prk_key = _hmac_sha256(auth_secret, ecdh_secret)
    key_info = b"WebPush: info\x00" + ua_public + as_public
    ikm = _hmac_sha256(prk_key, key_info + b"\x01")
    prk = _hmac_sha256(salt, ikm)
    cek = _hmac_sha256(prk, b"Content-Encoding: aes128gcm\x00\x01")[:16]
    nonce = _hmac_sha256(prk, b"Content-Encoding: nonce\x00\x01")[:12]
    return cek, nonce


def encrypt(plaintext: bytes, ua_public: bytes, auth_secret: bytes,
            _sender_private=None, _salt=None) -> bytes:
    """Encrypt a push message body for one subscription (single record)."""
    if len(plaintext) > RECORD_SIZE - 17 - 86:
        raise ValueError("push payload too large")
    sender_private = _sender_private or generate_private_key()
    as_public = public_key(sender_private)
    salt = _salt or os.urandom(16)
    secret = ecdh(sender_private, ua_public)
    cek, nonce = _derive_keys(secret, auth_secret, ua_public, as_public, salt)
    header = salt + struct.pack(">I", RECORD_SIZE) + bytes([len(as_public)]) + as_public
    return header + aes_gcm_encrypt(cek, nonce, plaintext + b"\x02")


def decrypt(body: bytes, ua_private: int, auth_secret: bytes) -> bytes:
    """Receiver side (what the browser does). Used by the test-suite."""
    salt = body[:16]
    id_length = body[20]
    as_public = body[21:21 + id_length]
    ciphertext = body[21 + id_length:]
    ua_public = public_key(ua_private)
    secret = ecdh(ua_private, as_public)
    cek, nonce = _derive_keys(secret, auth_secret, ua_public, as_public, salt)
    padded = aes_gcm_decrypt(cek, nonce, ciphertext)
    end = padded.rstrip(b"\x00")
    if not end.endswith(b"\x02"):
        raise ValueError("invalid padding delimiter")
    return end[:-1]


# ---------------------------------------------------------------------------
# VAPID (RFC 8292)
# ---------------------------------------------------------------------------


class Vapid:
    def __init__(self, private_key: int, subject: str):
        self.private_key = private_key
        self.public_key = public_key(private_key)
        self.public_key_b64 = b64url_encode(self.public_key)
        self.subject = subject
        self._cache = {}

    def authorization(self, endpoint: str) -> str:
        parsed = urlparse(endpoint)
        audience = "%s://%s" % (parsed.scheme, parsed.netloc)
        now = int(time.time())
        cached = self._cache.get(audience)
        if cached and cached[1] - now > 3600:
            token = cached[0]
        else:
            expires = now + 12 * 3600
            header = b64url_encode(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
            claims = b64url_encode(json.dumps(
                {"aud": audience, "exp": expires, "sub": self.subject}, separators=(",", ":")).encode())
            signing_input = (header + "." + claims).encode("ascii")
            token = header + "." + claims + "." + b64url_encode(ecdsa_sign(self.private_key, signing_input))
            self._cache[audience] = (token, expires)
        return "vapid t=%s, k=%s" % (token, self.public_key_b64)


# ---------------------------------------------------------------------------
# Delivery
# ---------------------------------------------------------------------------

DEFAULT_PUSH_HOSTS = (
    "fcm.googleapis.com",          # Chrome, Edge on Android, Samsung Internet
    "android.googleapis.com",
    "push.services.mozilla.com",   # Firefox
    "push.apple.com",              # Safari macOS / iOS 16.4+ home-screen apps
    "notify.windows.com",          # Edge on Windows
)


def endpoint_allowed(endpoint: str, extra_hosts=()) -> bool:
    """Only POST to real push services (prevents server-side request forgery)."""
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if host in extra_hosts:
        return parsed.scheme in ("http", "https")
    if parsed.scheme != "https":
        return False
    return any(host == suffix or host.endswith("." + suffix) for suffix in DEFAULT_PUSH_HOSTS)


def _connect_fast(address, timeout=None, source_address=None):
    """Open a TCP connection, IPv4 first, with a short per-address timeout.

    Many networks and container hosts publish IPv6 DNS records but cannot
    route IPv6. The standard library tries every address with the full
    timeout, which can delay each push by a minute; this keeps it instant.
    """
    host, port = address
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    infos.sort(key=lambda info: 0 if info[0] == socket.AF_INET else 1)
    last_error = None
    for family, socktype, proto, _name, sockaddr in infos:
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(min(timeout or 4, 4))
        try:
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
            sock.settimeout(timeout)
            return sock
        except OSError as err:
            last_error = err
            sock.close()
    raise last_error or OSError("could not resolve %s" % host)


class _PushHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Python sets this per instance in __init__, so override it afterwards.
        self._create_connection = _connect_fast


class _PushHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = _connect_fast


def send(vapid: Vapid, endpoint: str, ua_public: bytes, auth_secret: bytes, payload: bytes,
         ttl: int = 86400, urgency: str = "high", topic: str = None, timeout: int = 15):
    """POST one encrypted push. Returns the push service's HTTP status code."""
    body = encrypt(payload, ua_public, auth_secret)
    headers = {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        "TTL": str(ttl),
        "Urgency": urgency,
        "Authorization": vapid.authorization(endpoint),
    }
    if topic:
        headers["Topic"] = topic
    parsed = urlparse(endpoint)
    connection_class = _PushHTTPSConnection if parsed.scheme == "https" else _PushHTTPConnection
    connection = connection_class(parsed.hostname, parsed.port, timeout=timeout)
    try:
        path = (parsed.path or "/") + ("?" + parsed.query if parsed.query else "")
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()
