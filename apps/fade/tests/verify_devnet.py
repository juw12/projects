#!/usr/bin/env python3
"""Hermetic check of the Fade devnet (stdlib only, no browser).

Starts server/devnet.py on a free port and exercises the three services the
Fade Network client relies on: the Nostr relay (WebSocket), Blossom media and
ntfy push. Signatures are not verified by the devnet, so synthetic events are fine.
"""

import hashlib
import json
import socket
import sys
import threading
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "server"))

import devnet  # noqa: E402
from wsclient import WebSocket  # noqa: E402

failures = []
PK_A = "a" * 64
PK_B = "b" * 64


def check(condition, message):
    status = "ok  " if condition else "FAIL"
    print(f"[{status}] {message}")
    if not condition:
        failures.append(message)


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def event(kind, pubkey, content="", tags=None, created_at=None, salt=""):
    created_at = created_at or int(time.time())
    tags = tags or []
    raw = json.dumps([0, pubkey, created_at, kind, tags, content, salt])
    return {
        "id": hashlib.sha256(raw.encode()).hexdigest(), "pubkey": pubkey, "created_at": created_at,
        "kind": kind, "tags": tags, "content": content, "sig": "0" * 128,
    }


class Relay:
    def __init__(self, url):
        self.ws = WebSocket(url, timeout=5)

    def publish(self, ev):
        self.ws.send(json.dumps(["EVENT", ev]))
        while True:
            message = json.loads(self.ws.recv())
            if message[0] == "OK" and message[1] == ev["id"]:
                return message[2], message[3]

    def query(self, *filters, sub="q"):
        self.ws.send(json.dumps(["REQ", sub, *filters]))
        found = []
        while True:
            message = json.loads(self.ws.recv())
            if message[0] == "EVENT" and message[1] == sub:
                found.append(message[2])
            elif message[0] == "EOSE" and message[1] == sub:
                self.ws.send(json.dumps(["CLOSE", sub]))
                return found


def http(method, url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def main():
    port = free_port()
    server = devnet.make_server("127.0.0.1", port, quiet=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    try:
        status, _, body = http("GET", f"{base}/health")
        check(status == 200 and json.loads(body)["app"] == "fade-devnet", "health endpoint")

        # ---- relay ----
        relay = Relay(f"ws://127.0.0.1:{port}/")
        note = event(1, PK_A, "hello", [["t", "fade3dev"]])
        accepted, _ = relay.publish(note)
        check(accepted, "relay accepts an EVENT (OK true)")
        check([e["id"] for e in relay.query({"authors": [PK_A], "kinds": [1]})] == [note["id"]], "REQ by author returns it + EOSE")
        check(len(relay.query({"#t": ["fade3dev"]})) == 1 and not relay.query({"#t": ["other"]}), "tag filter #t")
        check(relay.publish(note)[1].startswith("duplicate"), "duplicate EVENT is acknowledged, not stored twice")

        d_tag = ["d", "fade3dev:user:me"]
        old = event(30078, PK_A, '{"v":1}', [d_tag], created_at=int(time.time()) - 10)
        new = event(30078, PK_A, '{"v":2}', [d_tag])
        relay.publish(old)
        relay.publish(new)
        docs = relay.query({"kinds": [30078], "authors": [PK_A], "#d": ["fade3dev:user:me"]})
        check([d["content"] for d in docs] == ['{"v":2}'], "parameterized-replaceable: newest version wins")
        check(relay.publish(old)[1].startswith("duplicate"), "older version is rejected after a newer one")

        other = event(30078, PK_B, '{"v":9}', [d_tag])
        relay.publish(other)
        deletion_by_b = event(5, PK_B, "", [["a", f"30078:{PK_A}:fade3dev:user:me"]])
        relay.publish(deletion_by_b)
        check(len(relay.query({"kinds": [30078], "authors": [PK_A]})) == 1, "someone else can't delete my doc")
        deletion = event(5, PK_A, "deleted", [["a", f"30078:{PK_A}:fade3dev:user:me"], ["e", note["id"]]])
        relay.publish(deletion)
        check(not relay.query({"kinds": [30078], "authors": [PK_A]}), "NIP-09 deletion removes the addressable doc")
        check(not relay.query({"ids": [note["id"]]}), "NIP-09 deletion removes the referenced event")
        check(len(relay.query({"kinds": [30078], "authors": [PK_B]})) == 1, "other authors' docs with the same d-tag survive")

        listener = Relay(f"ws://127.0.0.1:{port}/")
        listener.ws.send(json.dumps(["REQ", "live", {"kinds": [1], "authors": [PK_B]}]))
        check(json.loads(listener.ws.recv()) == ["EOSE", "live"], "empty subscription ends with EOSE")
        live = event(1, PK_B, "live")
        relay.publish(live)
        pushed = json.loads(listener.ws.recv())
        check(pushed[:2] == ["EVENT", "live"] and pushed[2]["id"] == live["id"], "open subscription receives new events in real time")

        # ---- blossom ----
        blob = bytes(range(256)) * 40
        status, _, body = http("PUT", f"{base}/upload", blob, {"Content-Type": "video/mp4"})
        info = json.loads(body)
        check(status == 200 and info["sha256"] == hashlib.sha256(blob).hexdigest(), "Blossom PUT /upload returns the sha256 descriptor")
        status, _, body = http("GET", f"{base}/{info['sha256']}.mp4")
        check(status == 200 and body == blob, "Blossom GET returns the full blob")
        status, headers, body = http("GET", f"{base}/{info['sha256']}", headers={"Range": "bytes=100-199"})
        check(status == 206 and len(body) == 100 and body == blob[100:200], "Blossom Range request returns 206 partial content")
        check(headers.get("Content-Range") == f"bytes 100-199/{len(blob)}", "Content-Range header")
        status, _, _ = http("DELETE", f"{base}/{info['sha256']}")
        status_after, _, _ = http("GET", f"{base}/{info['sha256']}")
        check(status == 204 and status_after == 404, "Blossom DELETE removes the blob")

        # ---- ntfy ----
        payload = json.dumps({"topic": "fade-test-topic", "title": "✂️ Booking confirmed", "message": "Tue 10:00", "click": "https://x/#/bookings"})
        status, _, _ = http("POST", f"{base}/ntfy", payload.encode(), {"Content-Type": "application/json"})
        later = json.dumps({"topic": "fade-test-topic", "message": "reminder", "delay": "2h"})
        http("POST", f"{base}/ntfy", later.encode(), {"Content-Type": "application/json"})
        status_poll, _, body = http("GET", f"{base}/ntfy/fade-test-topic/json?poll=1")
        messages = json.loads(body)
        check(status == 200 and status_poll == 200 and messages[0]["title"] == "✂️ Booking confirmed", "ntfy JSON publish keeps emoji titles")
        check(messages[1]["scheduled"] and messages[1]["time"] > time.time() + 3600, "ntfy delay schedules the 2 h reminder")
        status, _, _ = http("POST", f"{base}/ntfy", b'{"topic":"bad topic!"}', {"Content-Type": "application/json"})
        check(status == 400, "ntfy rejects invalid topics")

        # ---- app ----
        status, _, body = http("GET", f"{base}/app/")
        html = body.decode()
        check(status == 200 and "net.js" in html and "nostr.bundle.js" in html, "devnet serves the web app with the network client")
        status, _, _ = http("GET", f"{base}/app/../server/devnet.py")
        check(status in (403, 404), "static server blocks path traversal")
    finally:
        server.shutdown()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        sys.exit(1)
    print("PASSED: devnet relay, Blossom and ntfy behave as the client expects")


if __name__ == "__main__":
    main()
