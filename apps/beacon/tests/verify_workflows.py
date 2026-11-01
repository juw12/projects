"""Hermetic tests for Beacon workflows: digest (batching) and fallback (escalation).

  python apps/beacon/tests/verify_workflows.py

Uses a fake ntfy server on loopback as the delivery channel.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))
sys.path.insert(0, str(HERE))

from verify_channels import Api, FakeNtfy, free_port  # noqa: E402

PASSES = 0
FAILURES: list[str] = []
ADMIN = "adm_workflows_test"
FLAGS = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def wait_until(predicate, timeout: float = 15, step: float = 0.2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    return predicate()


def unit_tests(tmp: Path) -> None:
    import store as store_module
    from store import Store, render_digest

    print("store")
    old = tmp / "old.db"
    with sqlite3.connect(old) as db:
        db.executescript(store_module.SCHEMA)  # a database from before workflows existed
    Store(str(old))
    columns = {row[1] for row in sqlite3.connect(old).execute("PRAGMA table_info(messages)")}
    check({"digest_key", "digest_count", "fallback", "fallback_state", "fallback_id", "parent_id"} <= columns,
          "existing databases are migrated in place")

    check(render_digest(None, [{"title": "A"}, {"title": "B"}], 2) == ("2 new notifications", "B; A"),
          "digest text: newest first")
    title, body = render_digest("{count} new comments", [{"title": f"c{i}"} for i in range(5)], 9)
    check(title == "9 new comments" and body.endswith("and 4 more") and body.startswith("c4"),
          "digest text: template + 'and N more'")

    db = Store(str(tmp / "unit.db"))
    created_app = db.create_app("Unit")
    app = created_app[0] if isinstance(created_app, tuple) else created_app
    spec = {"after": 1, "unless": "clicked", "channels": ["ntfy"]}
    clicked = db.create_message(app["id"], {"title": "read it", "fallback": spec})
    ignored = db.create_message(app["id"], {"title": "ignored", "fallback": spec})
    for message in (clicked, ignored):
        db.finish_message(message["id"], "sent")
    db.bump(clicked["id"], "clicked")
    check(db.process_fallbacks(now=time.time()) == [], "nothing happens before `after` has passed")
    created = db.process_fallbacks(now=time.time() + 5)
    check(len(created) == 1 and created[0]["parent_id"] == ignored["id"] and created[0]["channels"] == ["ntfy"],
          "only the unclicked message escalates, on the fallback channels")
    check(db.get_message(clicked["id"])["fallback_state"] == "skipped"
          and db.get_message(ignored["id"])["fallback_state"] == "sent"
          and db.get_message(ignored["id"])["fallback_id"] == created[0]["id"], "states: skipped / sent + link")
    check(db.process_fallbacks(now=time.time() + 60) == [], "a fallback fires once")
    queued = db.create_message(app["id"], {"title": "later", "fallback": spec})
    check(db.cancel_fallback(queued["id"]) and not db.cancel_fallback(queued["id"]), "cancel_fallback")
    db.db.close()


def http_tests(tmp: Path) -> None:
    print("http")
    ntfy = FakeNtfy()
    port = free_port()
    env = dict(os.environ, BEACON_QUIET="1", BEACON_TEST_HOSTS="127.0.0.1", BEACON_PROXY="none")
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port),
                               "--data", str(tmp / "beacon.db"), "--admin-token", ADMIN],
                              env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=FLAGS)
    api = Api(port)
    try:
        wait_until(lambda: _health(api), 15)
        _, created = api.call("POST", "/v1/apps", {"name": "Workflows"}, ADMIN)
        secret = created["secret_key"]
        base = f"http://127.0.0.1:{ntfy.port}"
        for topic, user in (("alice-phone", "alice"), ("ops-room", "ops")):
            status, _ = api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": f"{base}/{topic}",
                                                          "user_id": user}, secret)
        check(status == 201, "two ntfy contacts registered")

        print("  digest")
        ids = set()
        merged_flags = []
        for number in range(1, 4):
            status, data = api.call("POST", "/v1/send", {
                "title": f"Comment {number}", "url": f"https://example.com/c/{number}", "channels": ["ntfy"],
                "target": {"user_ids": ["alice"]},
                "digest": {"key": "post-42", "window": 2, "title": "{count} new comments"}}, secret)
            ids.add(data["message"]["id"])
            merged_flags.append(data.get("digested"))
        check(len(ids) == 1 and merged_flags == [False, True, True], "3 sends with one key -> 1 queued message")
        message_id = ids.pop()
        _, other = api.call("POST", "/v1/send", {"title": "Other post", "channels": ["ntfy"],
                                                 "target": {"user_ids": ["alice"]},
                                                 "digest": {"key": "post-7", "window": 2}}, secret)
        check(other["message"]["id"] != message_id and other["digested"] is False, "another key -> its own digest")
        _, data = api.call("GET", f"/v1/messages/{message_id}", token=secret)
        check(data["message"]["status"] == "queued" and data["message"]["digest_count"] == 3,
              "held during the window (digest_count 3)")
        received = wait_until(lambda: ntfy.for_topic("alice-phone") if len(ntfy.for_topic("alice-phone")) >= 2 else None)
        titles = sorted(r["json"]["title"] for r in received or [])
        post42 = next((r["json"] for r in received or [] if r["json"]["title"] == "3 new comments"), {})
        check(titles == ["3 new comments", "Other post"], f"one notification per digest after the window ({titles})")
        check(post42.get("message") == "Comment 3; Comment 2; Comment 1" and post42.get("click") == "https://example.com/c/3",
              "digest body lists the items, click opens the newest")
        status, _ = api.call("POST", "/v1/send", {"title": "x", "digest": {"key": "k", "window": 0}}, secret)
        check(status == 400, "digest.window validated")

        print("  fallback")
        status, data = api.call("POST", "/v1/send", {
            "title": "Your invoice is ready", "channels": ["inapp"], "target": {"user_ids": ["alice"]},
            "fallback": {"after": 1, "unless": "clicked", "channels": ["ntfy"],
                         "title": "Reminder: your invoice is ready"}}, secret)
        primary = data["message"]
        check(status == 202 and primary["fallback"]["channels"] == ["ntfy"] and primary["fallback_state"] == "pending",
              "message accepted with a fallback")
        escalated = wait_until(lambda: [r for r in ntfy.for_topic("alice-phone")
                                        if r["json"]["title"] == "Reminder: your invoice is ready"])
        check(len(escalated or []) == 1, "not clicked in-app -> follow-up sent on ntfy")
        _, data = api.call("GET", f"/v1/messages/{primary['id']}", token=secret)
        follow_id = data["message"]["fallback_id"]
        _, follow = api.call("GET", f"/v1/messages/{follow_id}", token=secret)
        check(data["message"]["fallback_state"] == "sent" and follow["message"]["parent_id"] == primary["id"]
              and follow["message"]["data"].get("fallback_of") == primary["id"], "follow-up linked both ways")

        before = len(ntfy.for_topic("ops-room"))
        _, data = api.call("POST", "/v1/send", {
            "title": "Deploy finished", "channels": ["ntfy"], "target": {"user_ids": ["ops"]},
            "fallback": {"after": 1, "unless": "delivered", "channels": ["ntfy"], "title": "ESCALATION"}}, secret)
        delivered_id = data["message"]["id"]
        state = wait_until(lambda: _state(api, secret, delivered_id) == "skipped" and "skipped")
        check(state == "skipped" and not [r for r in ntfy.for_topic("ops-room")[before:]
                                          if r["json"]["title"] == "ESCALATION"],
              "unless=delivered: delivered -> no escalation")

        _, data = api.call("POST", "/v1/send", {"title": "Scheduled", "channels": ["ntfy"],
                                                "target": {"user_ids": ["ops"]},
                                                "send_at": time.time() + 3600,
                                                "fallback": {"after": 60, "channels": ["ntfy"]}}, secret)
        status, _ = api.call("POST", f"/v1/messages/{data['message']['id']}/cancel-fallback", {}, secret)
        status2, _ = api.call("POST", f"/v1/messages/{data['message']['id']}/cancel-fallback", {}, secret)
        check(status == 200 and status2 == 409, "POST /v1/messages/<id>/cancel-fallback")
        for bad, label in (({"after": 1, "channels": []}, "empty channels"),
                           ({"after": 1, "channels": ["sms"]}, "unknown channel"),
                           ({"after": 1, "channels": ["ntfy"], "unless": "liked"}, "unknown condition")):
            status, _ = api.call("POST", "/v1/send", {"title": "x", "fallback": bad}, secret)
            check(status == 400, f"fallback validation: {label}")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        ntfy.server.shutdown()


def _health(api: Api) -> bool:
    try:
        return api.call("GET", "/v1/health")[0] == 200
    except OSError:
        return False


def _state(api: Api, secret: str, message_id: int) -> str:
    _, data = api.call("GET", f"/v1/messages/{message_id}", token=secret)
    return data["message"]["fallback_state"]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    with tempfile.TemporaryDirectory(prefix="beacon-workflows-", ignore_cleanup_errors=True) as tmp_name:
        tmp = Path(tmp_name)
        unit_tests(tmp)
        http_tests(tmp)
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  - " + failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
