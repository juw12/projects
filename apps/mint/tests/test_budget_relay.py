#!/usr/bin/env python3
"""Tests for the self-hostable Mint Budget relay (apps/mint/budget/server/relay.py).

Runs the real server on an ephemeral port in a background thread and talks to it
over HTTP, the same way the browser client does. Stdlib only (Python 3.8+).
"""

import http.client
import importlib.util
import json
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
RELAY_PATH = APP_DIR / "budget" / "server" / "relay.py"


def load_relay():
    spec = importlib.util.spec_from_file_location("mint_relay", str(RELAY_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


relay = load_relay()


class RunningRelay:
    """Context manager: start relay.serve() on 127.0.0.1:<free port>."""

    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.server = None
        self.thread = None

    def __enter__(self):
        self.server = relay.serve("127.0.0.1", 0, self.data_dir)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            conn.close()

    def publish(self, topic, text):
        status, _, body = self.request("POST", "/" + topic, body=text.encode("utf-8"))
        return status, json.loads(body.decode("utf-8"))

    def poll(self, topic, since="all"):
        status, _, body = self.request("GET", "/%s/json?poll=1&since=%s" % (topic, since))
        lines = [line for line in body.decode("utf-8").splitlines() if line.strip()]
        return status, [json.loads(line) for line in lines]


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mint-relay-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_health(self):
        with RunningRelay(self.tmp) as r:
            status, headers, body = r.request("GET", "/health")
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body.decode("utf-8")), {"ok": True})
            self.assertEqual(headers.get("Access-Control-Allow-Origin"), "*")

    def test_cors_preflight(self):
        with RunningRelay(self.tmp) as r:
            status, headers, _ = r.request("OPTIONS", "/mint_topic")
            self.assertEqual(status, 204)
            self.assertIn("POST", headers.get("Access-Control-Allow-Methods", ""))

    def test_publish_and_poll_in_order(self):
        with RunningRelay(self.tmp) as r:
            ids = []
            for i in range(3):
                status, msg = r.publish("mint_abc", "ciphertext-%d" % i)
                self.assertEqual(status, 200)
                self.assertEqual(msg["event"], "message")
                self.assertEqual(msg["topic"], "mint_abc")
                self.assertEqual(msg["message"], "ciphertext-%d" % i)
                self.assertTrue(msg["id"])
                ids.append(msg["id"])
            status, messages = r.poll("mint_abc")
            self.assertEqual(status, 200)
            self.assertEqual([m["message"] for m in messages], ["ciphertext-0", "ciphertext-1", "ciphertext-2"])

            # since=<id> returns only newer messages
            _, newer = r.poll("mint_abc", since=ids[0])
            self.assertEqual([m["message"] for m in newer], ["ciphertext-1", "ciphertext-2"])

            # other topics are isolated
            _, other = r.poll("mint_other")
            self.assertEqual(other, [])

    def test_invalid_topic_rejected(self):
        with RunningRelay(self.tmp) as r:
            status, _, _ = r.request("POST", "/bad.topic!", body=b"x")
            self.assertEqual(status, 400)
            status, _, _ = r.request("POST", "/a/b", body=b"x")
            self.assertEqual(status, 400)
            status, _, _ = r.request("GET", "/../etc/sse")
            self.assertIn(status, (400, 404))

    def test_oversized_message_rejected(self):
        with RunningRelay(self.tmp) as r:
            big = b"x" * (relay.MAX_BODY + 1)
            status, _, _ = r.request("POST", "/mint_big", body=big)
            self.assertEqual(status, 413)
            _, messages = r.poll("mint_big")
            self.assertEqual(messages, [])

    def test_sse_streams_backlog_then_live(self):
        with RunningRelay(self.tmp) as r:
            r.publish("mint_sse", "before")
            conn = http.client.HTTPConnection("127.0.0.1", r.port, timeout=10)
            conn.request("GET", "/mint_sse/sse?since=all")
            response = conn.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn("text/event-stream", response.getheader("Content-Type"))

            def publish_later():
                time.sleep(0.3)
                r.publish("mint_sse", "after")

            threading.Thread(target=publish_later, daemon=True).start()
            received = []
            deadline = time.time() + 8
            while time.time() < deadline and len(received) < 2:
                line = response.fp.readline().decode("utf-8").strip()
                if line.startswith("data: "):
                    event = json.loads(line[len("data: "):])
                    if event.get("event") == "message":
                        received.append(event["message"])
            conn.close()
            self.assertEqual(received, ["before", "after"])

    def test_persistence_across_restart(self):
        with RunningRelay(self.tmp) as r:
            r.publish("mint_persist", "survives")
        with RunningRelay(self.tmp) as r:
            _, messages = r.poll("mint_persist")
            self.assertEqual([m["message"] for m in messages], ["survives"])
        self.assertTrue((Path(self.tmp) / "mint_persist.jsonl").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
