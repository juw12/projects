#!/usr/bin/env python3
"""Fade devnet: a local stand-in for the public services Fade uses online.

One stdlib-only process provides, on a single port:

  * a Nostr relay (NIP-01 subset: EVENT / REQ / CLOSE / EOSE / OK, replaceable and
    parameterized-replaceable events, NIP-09 deletions, tag filters) over WebSocket at /
  * a Blossom media server (PUT /upload, GET/HEAD /<sha256>[.ext] with Range, DELETE)
  * an ntfy-compatible push service (POST /ntfy/<topic>, GET /ntfy/<topic>/sse,
    GET /ntfy/<topic>/json?poll=1, scheduled delivery via the "At" header)

It exists for hermetic tests and offline development. The production app talks to
public relays, Blossom servers and ntfy.sh instead (see web/config.js).

Usage:
    python devnet.py --port 8797
    open "http://127.0.0.1:8797/app/?devnet=1"   # the Fade web app wired to this devnet

Signatures are not verified here; Fade clients verify every event they receive.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import queue
import re
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
EXTRA_DIRS = {}
MAX_BLOB = 80 * 1024 * 1024


# ---------------------------------------------------------------------------
# Relay storage and filter matching
# ---------------------------------------------------------------------------
class RelayStore:
    def __init__(self):
        self.lock = threading.RLock()
        self.events = {}
        self.deleted_ids = set()
        self.deleted_addresses = {}
        self.subscribers = []

    @staticmethod
    def address(event):
        kind = event["kind"]
        if kind in (0, 3) or 10000 <= kind < 20000:
            return f"{kind}:{event['pubkey']}:"
        if 30000 <= kind < 40000:
            d_tag = next((t[1] for t in event["tags"] if len(t) > 1 and t[0] == "d"), "")
            return f"{kind}:{event['pubkey']}:{d_tag}"
        return None

    def add(self, event):
        """Store an event. Returns (accepted, message)."""
        required = ("id", "pubkey", "created_at", "kind", "tags", "content", "sig")
        if not all(key in event for key in required):
            return False, "invalid: missing fields"
        kind = event["kind"]
        with self.lock:
            if event["id"] in self.events or event["id"] in self.deleted_ids:
                return True, "duplicate:"
            if 20000 <= kind < 30000:
                self.broadcast(event)
                return True, ""
            address = self.address(event)
            if address and self.deleted_addresses.get(address, -1) >= event["created_at"]:
                return False, "blocked: deleted"
            if address:
                for other_id, other in list(self.events.items()):
                    if self.address(other) == address:
                        if (other["created_at"], other["id"]) > (event["created_at"], event["id"]):
                            return True, "duplicate: newer version stored"
                        del self.events[other_id]
            if kind == 5:
                self.apply_deletion(event)
            self.events[event["id"]] = event
            self.broadcast(event)
            return True, ""

    def apply_deletion(self, deletion):
        for tag in deletion["tags"]:
            if len(tag) < 2:
                continue
            if tag[0] == "e":
                target = self.events.get(tag[1])
                if target and target["pubkey"] == deletion["pubkey"]:
                    del self.events[tag[1]]
                    self.deleted_ids.add(tag[1])
            if tag[0] == "a":
                parts = tag[1].split(":", 2)
                if len(parts) == 3 and parts[1] == deletion["pubkey"]:
                    self.deleted_addresses[tag[1]] = deletion["created_at"]
                    for other_id, other in list(self.events.items()):
                        if self.address(other) == tag[1] and other["created_at"] <= deletion["created_at"]:
                            del self.events[other_id]

    @staticmethod
    def matches(event, flt):
        if "ids" in flt and event["id"] not in flt["ids"]:
            return False
        if "authors" in flt and event["pubkey"] not in flt["authors"]:
            return False
        if "kinds" in flt and event["kind"] not in flt["kinds"]:
            return False
        if "since" in flt and event["created_at"] < flt["since"]:
            return False
        if "until" in flt and event["created_at"] > flt["until"]:
            return False
        for key, values in flt.items():
            if key.startswith("#") and len(key) == 2:
                letter = key[1]
                if not any(len(t) > 1 and t[0] == letter and t[1] in values for t in event["tags"]):
                    return False
        return True

    def query(self, filters):
        results = {}
        with self.lock:
            for flt in filters:
                matched = [e for e in self.events.values() if self.matches(e, flt)]
                matched.sort(key=lambda e: (-e["created_at"], e["id"]))
                if "limit" in flt:
                    matched = matched[: max(0, int(flt["limit"]))]
                for event in matched:
                    results[event["id"]] = event
        return sorted(results.values(), key=lambda e: (-e["created_at"], e["id"]))

    def subscribe(self, connection):
        with self.lock:
            self.subscribers.append(connection)

    def unsubscribe(self, connection):
        with self.lock:
            if connection in self.subscribers:
                self.subscribers.remove(connection)

    def broadcast(self, event):
        for connection in list(self.subscribers):
            connection.deliver(event)


# ---------------------------------------------------------------------------
# Push (ntfy-compatible) storage
# ---------------------------------------------------------------------------
class PushStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.messages = {}
        self.listeners = {}
        self.counter = 0

    def publish(self, topic, body, headers):
        now = int(time.time())
        at = headers.get("At") or headers.get("X-At") or headers.get("Delay") or headers.get("X-Delay")
        when = now
        if at:
            match = re.fullmatch(r"(\d+)([smhd]?)", at.strip())
            if match and int(match.group(1)) > 10_000_000:
                when = int(match.group(1))
            elif match:
                factor = {"": 1, "s": 1, "m": 60, "h": 3600, "d": 86400}[match.group(2)]
                when = now + int(match.group(1)) * factor
        sequence = headers.get("X-Sequence-ID") or headers.get("Sequence-ID") or headers.get("SID") or ""
        # like ntfy's "Cache: no": hand it to devices listening right now, keep no copy (polls never see it)
        live_only = str(headers.get("Cache") or headers.get("X-Cache") or "").strip().lower() == "no"
        with self.lock:
            self.counter += 1
            message = {
                "id": f"m{self.counter}", "time": when, "event": "message", "topic": topic,
                "message": body, "title": headers.get("Title") or headers.get("X-Title") or "",
                "tags": [t for t in (headers.get("Tags") or headers.get("X-Tags") or "").split(",") if t],
                "click": headers.get("Click") or headers.get("X-Click") or "",
                "scheduled": when > now,
                "sequence_id": sequence or f"m{self.counter}",
            }
            if sequence and not live_only:  # like ntfy: a new message replaces a still-scheduled one with the same sequence id
                self.messages[topic] = [m for m in self.messages.get(topic, [])
                                        if not (m.get("sequence_id") == sequence and m.get("scheduled") and m["time"] > now)]
            if not live_only:
                self.messages.setdefault(topic, []).append(message)
            listeners = list(self.listeners.get(topic, []))
        if not message["scheduled"]:
            for listener in listeners:
                listener.put(message)
        return message

    def sequence_event(self, topic, sequence, event):
        """ntfy message_delete / message_clear: deletes still-scheduled messages, tells clients to drop/clear theirs."""
        now = int(time.time())
        with self.lock:
            self.counter += 1
            if event == "message_delete":
                self.messages[topic] = [m for m in self.messages.get(topic, [])
                                        if not (m.get("sequence_id") == sequence and m.get("scheduled") and m["time"] > now)]
            marker = {"id": f"m{self.counter}", "time": now, "event": event, "topic": topic, "sequence_id": sequence,
                      "title": "", "message": ""}
            self.messages.setdefault(topic, []).append(marker)
            listeners = list(self.listeners.get(topic, []))
        for listener in listeners:
            listener.put(marker)
        return marker

    def listen(self, topic):
        channel = queue.Queue()
        with self.lock:
            self.listeners.setdefault(topic, []).append(channel)
        return channel

    def unlisten(self, topic, channel):
        with self.lock:
            if channel in self.listeners.get(topic, []):
                self.listeners[topic].remove(channel)

    def poll(self, topic):
        with self.lock:
            return list(self.messages.get(topic, []))


RELAY = RelayStore()
PUSH = PushStore()
BLOBS = {}
BLOB_LOCK = threading.Lock()


# ---------------------------------------------------------------------------
# WebSocket connection (RFC 6455 subset: text, ping/pong, close, fragmentation)
# ---------------------------------------------------------------------------
class WebSocketConnection:
    def __init__(self, handler):
        self.rfile = handler.rfile
        self.wfile = handler.wfile
        self.send_lock = threading.Lock()
        self.subscriptions = {}
        self.alive = True

    def read_frame(self):
        header = self.rfile.read(2)
        if len(header) < 2:
            return None, None
        first, second = header
        opcode = first & 0x0F
        fin = bool(first & 0x80)
        length = second & 0x7F
        if length == 126:
            length = struct.unpack(">H", self.rfile.read(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self.rfile.read(8))[0]
        mask = self.rfile.read(4) if second & 0x80 else b"\x00\x00\x00\x00"
        payload = bytearray(self.rfile.read(length))
        for index in range(len(payload)):
            payload[index] ^= mask[index % 4]
        return (opcode, fin), bytes(payload)

    def send_frame(self, opcode, payload: bytes):
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(length)
        elif length < 65536:
            header.append(126)
            header += struct.pack(">H", length)
        else:
            header.append(127)
            header += struct.pack(">Q", length)
        with self.send_lock:
            try:
                self.wfile.write(bytes(header) + payload)
                self.wfile.flush()
            except OSError:
                self.alive = False

    def send_json(self, message):
        self.send_frame(0x1, json.dumps(message, separators=(",", ":")).encode("utf-8"))

    def deliver(self, event):
        for sub_id, filters in list(self.subscriptions.items()):
            if any(RELAY.matches(event, flt) for flt in filters):
                self.send_json(["EVENT", sub_id, event])

    def handle_message(self, text):
        try:
            message = json.loads(text)
        except ValueError:
            self.send_json(["NOTICE", "invalid: bad json"])
            return
        if not isinstance(message, list) or not message:
            return
        verb = message[0]
        if verb == "EVENT" and len(message) > 1 and isinstance(message[1], dict):
            accepted, note = RELAY.add(message[1])
            self.send_json(["OK", message[1].get("id", ""), accepted, note])
        elif verb == "REQ" and len(message) > 2:
            sub_id = str(message[1])
            filters = [f for f in message[2:] if isinstance(f, dict)]
            for event in RELAY.query(filters):
                self.send_json(["EVENT", sub_id, event])
            self.send_json(["EOSE", sub_id])
            self.subscriptions[sub_id] = filters
        elif verb == "CLOSE" and len(message) > 1:
            self.subscriptions.pop(str(message[1]), None)
            self.send_json(["CLOSED", str(message[1]), ""])

    def run(self):
        RELAY.subscribe(self)
        fragments = []
        try:
            while self.alive:
                info, payload = self.read_frame()
                if info is None:
                    break
                opcode, fin = info
                if opcode == 0x8:
                    self.send_frame(0x8, payload[:2])
                    break
                if opcode == 0x9:
                    self.send_frame(0xA, payload)
                    continue
                if opcode in (0x1, 0x0):
                    fragments.append(payload)
                    if fin:
                        self.handle_message(b"".join(fragments).decode("utf-8", "replace"))
                        fragments = []
        except (OSError, ValueError, struct.error):
            pass
        finally:
            self.alive = False
            RELAY.unsubscribe(self)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    quiet = False

    def log_message(self, fmt, *args):
        if not self.quiet:
            super().log_message(fmt, *args)

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Expose-Headers", "*")

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BLOB:
            raise ValueError("too large")
        return self.rfile.read(length) if length else b""

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self.route("GET")

    def do_HEAD(self):
        self.route("HEAD")

    def do_PUT(self):
        self.route("PUT")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        if method == "GET" and self.headers.get("Upgrade", "").lower() == "websocket":
            return self.upgrade()
        if path == "/health":
            return self.send_json(200, {"app": "fade-devnet", "events": len(RELAY.events), "blobs": len(BLOBS)})
        if path in ("/ntfy", "/ntfy/") and method in ("POST", "PUT"):
            return self.ntfy_json()
        if path.startswith("/ntfy/"):
            return self.ntfy(method, path[len("/ntfy/"):], parse_qs(parsed.query))
        if path == "/upload" and method == "PUT":
            return self.blob_upload()
        if path.startswith("/app/") or path == "/app":
            return self.static(path[len("/app"):] or "/")
        for prefix, folder in EXTRA_DIRS.items():
            if path.startswith(prefix + "/"):
                return self.static(path[len(prefix):], folder)
        match = re.fullmatch(r"/([0-9a-f]{64})(\.[a-z0-9]+)?", path)
        if match:
            return self.blob(method, match.group(1))
        if path == "/" and method == "GET":
            return self.send_json(200, {"app": "fade-devnet", "relay": "ws on /", "blossom": "/upload", "ntfy": "/ntfy/<topic>"})
        return self.send_json(404, {"error": "not found"})

    # ----- relay -----
    def upgrade(self):
        key = self.headers.get("Sec-WebSocket-Key", "")
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        WebSocketConnection(self).run()
        self.close_connection = True

    # ----- blossom -----
    def blob_upload(self):
        try:
            data = self.read_body()
        except ValueError:
            return self.send_json(413, {"message": "file too large"})
        if not data:
            return self.send_json(400, {"message": "empty upload"})
        digest = hashlib.sha256(data).hexdigest()
        content_type = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0]
        with BLOB_LOCK:
            BLOBS[digest] = (content_type, data)
        extension = mimetypes.guess_extension(content_type) or ""
        host = self.headers.get("Host") or "127.0.0.1"
        return self.send_json(200, {
            "url": f"http://{host}/{digest}{extension}", "sha256": digest, "size": len(data),
            "type": content_type, "uploaded": int(time.time()),
        })

    def blob(self, method, digest):
        if method == "DELETE":
            with BLOB_LOCK:
                BLOBS.pop(digest, None)
            self.send_response(204)
            self.cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        entry = BLOBS.get(digest)
        if not entry:
            return self.send_json(404, {"message": "blob not found"})
        content_type, data = entry
        start, end = 0, len(data) - 1
        status = 200
        range_header = self.headers.get("Range")
        if range_header:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
            if match:
                if match.group(1):
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else end
                else:
                    start = max(0, len(data) - int(match.group(2)))
                end = min(end, len(data) - 1)
                status = 206
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        self.end_headers()
        if method != "HEAD":
            self.wfile.write(data[start:end + 1])

    # ----- ntfy -----
    def ntfy(self, method, rest, query):
        parts = rest.split("/")
        topic = parts[0]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", topic):
            return self.send_json(400, {"error": "invalid topic"})
        if method in ("POST", "PUT") and len(parts) == 1:
            body = self.read_body().decode("utf-8", "replace")
            message = PUSH.publish(topic, body, self.headers)
            return self.send_json(200, message)
        sequence_ok = len(parts) >= 2 and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", parts[1]) and parts[1] not in ("json", "sse")
        if sequence_ok and len(parts) == 2 and method == "DELETE":
            return self.send_json(200, PUSH.sequence_event(topic, parts[1], "message_delete"))
        if sequence_ok and len(parts) == 3 and parts[2] == "delete" and method == "GET":
            return self.send_json(200, PUSH.sequence_event(topic, parts[1], "message_delete"))
        if sequence_ok and len(parts) == 3 and parts[2] in ("clear", "read") and method in ("PUT", "GET"):
            return self.send_json(200, PUSH.sequence_event(topic, parts[1], "message_clear"))
        if sequence_ok and len(parts) == 2 and method in ("POST", "PUT"):
            body = self.read_body().decode("utf-8", "replace")
            headers = dict(self.headers)
            headers["X-Sequence-ID"] = parts[1]
            return self.send_json(200, PUSH.publish(topic, body, headers))
        if method == "GET" and len(parts) == 2 and parts[1] == "json":
            return self.send_json(200, PUSH.poll(topic))
        if method == "GET" and len(parts) == 2 and parts[1] == "sse":
            return self.ntfy_sse(topic)
        return self.send_json(404, {"error": "not found"})

    def ntfy_json(self):
        try:
            payload = json.loads(self.read_body().decode("utf-8"))
        except ValueError:
            return self.send_json(400, {"error": "invalid json"})
        topic = str(payload.get("topic") or "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", topic):
            return self.send_json(400, {"error": "invalid topic"})
        headers = {
            "Title": payload.get("title") or "",
            "Tags": ",".join(payload.get("tags") or []),
            "Click": payload.get("click") or "",
        }
        if payload.get("delay"):
            headers["At"] = str(payload["delay"])
        if payload.get("sequence_id"):
            headers["X-Sequence-ID"] = str(payload["sequence_id"])[:64]
        cache = self.headers.get("Cache") or self.headers.get("X-Cache")
        if cache:
            headers["Cache"] = cache
        message = PUSH.publish(topic, str(payload.get("message") or ""), headers)
        return self.send_json(200, message)

    def ntfy_sse(self, topic):
        channel = PUSH.listen(topic)
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            opening = {"id": "open", "time": int(time.time()), "event": "open", "topic": topic}
            self.wfile.write(f"data: {json.dumps(opening)}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    message = channel.get(timeout=15)
                    self.wfile.write(f"data: {json.dumps(message)}\n\n".encode())
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except OSError:
            pass
        finally:
            PUSH.unlisten(topic, channel)

    # ----- static app (same origin as the devnet) -----
    def static(self, rel, root=None):
        root = (root or WEB_DIR).resolve()
        rel = rel.lstrip("/") or "index.html"
        target = (root / rel).resolve()
        if root not in target.parents and target != root:
            return self.send_json(403, {"error": "forbidden"})
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            return self.send_json(404, {"error": "not found"})
        data = target.read_bytes()
        self.send_response(200)
        self.cors()
        self.send_header("Content-Type", mimetypes.guess_type(str(target))[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def make_server(host="127.0.0.1", port=8797, quiet=False):
    Handler.quiet = quiet
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description="Fade devnet (local relay + Blossom + ntfy)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8797)
    parser.add_argument("--quiet", action="store_true")
    parser.add_argument("--mount", action="append", default=[], metavar="PREFIX=DIR",
                        help="also serve DIR at /PREFIX/ (e.g. test pages)")
    args = parser.parse_args()
    for item in args.mount:
        prefix, _, folder = item.partition("=")
        EXTRA_DIRS["/" + prefix.strip("/")] = Path(folder).resolve()
    server = make_server(args.host, args.port, args.quiet)
    print(f"Fade devnet on http://{args.host}:{args.port}  (relay ws://{args.host}:{args.port}/)")
    print(f"App wired to it: http://{args.host}:{args.port}/app/?devnet=1")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
