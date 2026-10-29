#!/usr/bin/env python3
"""Mint relay: a tiny, self-hostable, ntfy-compatible message relay for Mint Budget (stdlib only).

Mint clients encrypt everything in the browser, so this relay only stores and
forwards ciphertext. Unlike the public ntfy.sh relay (12-hour cache), messages
here are kept on disk, so shared budgets sync even when collaborators are never
online at the same time.

Endpoints (the subset of the ntfy API that Mint Budget uses):
  POST /<topic>                         publish; body = message text (<= 64 KB)
  GET  /<topic>/sse?since=all|<id>|<t>  Server-Sent Events stream (backlog, then live)
  GET  /<topic>/json?poll=1&since=...   backlog as JSON lines, then close
  GET  /health                          {"ok": true}

Run:
  python relay.py --port 8787 --data ./relay-data
Then in Mint: Budget -> Share -> Relay -> http(s)://your-host:8787
(MINT_RELAY_DATA / MINT_RELAY_VERBOSE.)
"""

import argparse
import json
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TOPIC_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_BODY = 64 * 1024
KEEPALIVE_SECONDS = 25
DEFAULT_MAX_MESSAGES = 20000
RATE_PER_MINUTE = 240


class TopicStore:
    """Append-only message log per topic, persisted as JSON lines."""

    def __init__(self, data_dir, max_messages=DEFAULT_MAX_MESSAGES):
        self.data_dir = data_dir
        self.max_messages = max_messages
        self.topics = {}
        self.lock = threading.Lock()
        if data_dir:
            os.makedirs(data_dir, exist_ok=True)

    def _path(self, topic):
        return os.path.join(self.data_dir, topic + ".jsonl") if self.data_dir else None

    def _load(self, topic):
        entry = self.topics.get(topic)
        if entry is not None:
            return entry
        messages = []
        path = self._path(topic)
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        messages.append(json.loads(line))
                    except ValueError:
                        continue
        entry = {"messages": messages, "cond": threading.Condition(self.lock)}
        self.topics[topic] = entry
        return entry

    def publish(self, topic, text):
        msg = {
            "id": secrets.token_urlsafe(9),
            "time": int(time.time()),
            "event": "message",
            "topic": topic,
            "message": text,
        }
        with self.lock:
            entry = self._load(topic)
            entry["messages"].append(msg)
            path = self._path(topic)
            if len(entry["messages"]) > self.max_messages:
                entry["messages"] = entry["messages"][-self.max_messages:]
                if path:
                    with open(path, "w", encoding="utf-8") as fh:
                        for m in entry["messages"]:
                            fh.write(json.dumps(m, separators=(",", ":")) + "\n")
            elif path:
                with open(path, "a", encoding="utf-8") as fh:
                    fh.write(json.dumps(msg, separators=(",", ":")) + "\n")
            entry["cond"].notify_all()
        return msg

    def since(self, topic, since):
        """Messages after `since` ('all', a message id, or unix seconds). None -> nothing."""
        with self.lock:
            messages = list(self._load(topic)["messages"])
        if since is None or since == "":
            return [], len(messages)
        if since == "all":
            return messages, len(messages)
        if since.isdigit():
            t = int(since)
            return [m for m in messages if m["time"] >= t], len(messages)
        for index, m in enumerate(messages):
            if m["id"] == since:
                return messages[index + 1:], len(messages)
        return messages, len(messages)

    def wait_new(self, topic, known_count, timeout):
        """Block until the topic has more than known_count messages (or timeout)."""
        with self.lock:
            entry = self._load(topic)
            if len(entry["messages"]) <= known_count:
                entry["cond"].wait(timeout)
            messages = entry["messages"]
            if len(messages) < known_count:
                # log was trimmed; resend nothing old, just resync the cursor
                return [], len(messages)
            return list(messages[known_count:]), len(messages)


class RateLimiter:
    def __init__(self, per_minute):
        self.per_minute = per_minute
        self.hits = {}
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.time()
        with self.lock:
            window = [t for t in self.hits.get(key, []) if now - t < 60]
            if len(window) >= self.per_minute:
                self.hits[key] = window
                return False
            window.append(now)
            self.hits[key] = window
            return True


def make_handler(store, limiter):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MintRelay/1.0"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # keep test output quiet; never log bodies
            if os.environ.get("MINT_RELAY_VERBOSE"):
                super().log_message(fmt, *args)

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "*")

        def _json(self, status, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _route(self):
            parsed = urlparse(self.path)
            parts = [p for p in parsed.path.split("/") if p]
            return parts, parse_qs(parsed.query)

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _reject(self, status, message):
            # The request body was not consumed, so this connection cannot be reused.
            self.close_connection = True
            return self._json(status, {"error": message})

        def do_POST(self):
            parts, _ = self._route()
            if len(parts) != 1 or not TOPIC_RE.match(parts[0]):
                return self._reject(400, "invalid topic")
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                return self._reject(400, "bad Content-Length")
            if length < 0 or length > MAX_BODY:
                return self._reject(413, "message too large")
            if not limiter.allow(self.client_address[0]):
                return self._reject(429, "slow down")
            raw = self.rfile.read(length) if length else b""
            try:
                text = raw.decode("utf-8")
            except UnicodeDecodeError:
                return self._json(400, {"error": "body must be UTF-8 text"})
            msg = store.publish(parts[0], text)
            return self._json(200, msg)

        do_PUT = do_POST

        def do_GET(self):
            parts, query = self._route()
            if parts == ["health"]:
                return self._json(200, {"ok": True})
            if len(parts) != 2 or not TOPIC_RE.match(parts[0]) or parts[1] not in ("sse", "json"):
                return self._json(404, {"error": "not found"})
            topic, kind = parts
            since = (query.get("since") or [None])[0]
            if kind == "json" and (query.get("poll") or ["0"])[0] in ("1", "true"):
                backlog, _ = store.since(topic, since or "all")
                body = "".join(json.dumps(m) + "\n" for m in backlog).encode("utf-8")
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/x-ndjson")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return None
            return self._stream(topic, since, kind)

        def _stream(self, topic, since, kind):
            self.close_connection = True
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/event-stream" if kind == "sse" else "application/x-ndjson")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()

            def emit(obj, event=None):
                data = json.dumps(obj)
                if kind == "sse":
                    chunk = ("event: %s\n" % event if event else "") + "data: " + data + "\n\n"
                else:
                    chunk = data + "\n"
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()

            try:
                emit({"id": secrets.token_urlsafe(9), "time": int(time.time()), "event": "open", "topic": topic}, "open")
                backlog, cursor = store.since(topic, since)
                for m in backlog:
                    emit(m)
                while True:
                    fresh, cursor = store.wait_new(topic, cursor, KEEPALIVE_SECONDS)
                    if fresh:
                        for m in fresh:
                            emit(m)
                    else:
                        emit({"id": secrets.token_urlsafe(9), "time": int(time.time()), "event": "keepalive", "topic": topic}, "keepalive")
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                return None

    return Handler


def serve(host="0.0.0.0", port=8787, data_dir="relay-data", max_messages=DEFAULT_MAX_MESSAGES):
    store = TopicStore(data_dir, max_messages)
    server = ThreadingHTTPServer((host, port), make_handler(store, RateLimiter(RATE_PER_MINUTE)))
    server.daemon_threads = True
    return server


def main():
    parser = argparse.ArgumentParser(description="Mint relay (ntfy-compatible, ciphertext only)")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8787")))
    parser.add_argument("--data", default=os.environ.get("MINT_RELAY_DATA", "relay-data"))
    parser.add_argument("--max-messages", type=int, default=DEFAULT_MAX_MESSAGES)
    args = parser.parse_args()
    server = serve(args.host, args.port, args.data, args.max_messages)
    print("Mint relay listening on http://%s:%d (data: %s)" % (args.host, args.port, os.path.abspath(args.data)))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
