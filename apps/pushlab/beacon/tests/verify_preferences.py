"""Hermetic tests for Beacon categories + subscriber preferences, templates and multi-step workflows.

These are the ideas Novu (https://novu.co) is known for — preferences per workflow,
reusable templates, multi-step escalation — re-implemented natively in Beacon's
standard-library server (no Novu code).

  python apps/pushlab/beacon/tests/verify_preferences.py

Delivery goes to a fake ntfy server on loopback.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))
sys.path.insert(0, str(HERE))

from verify_channels import Api, FakeNtfy, free_port, wait_sent  # noqa: E402

PASSES = 0
FAILURES: list[str] = []
ADMIN = "adm_preferences_test"
FLAGS = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def wait_until(predicate, timeout: float = 20, step: float = 0.2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    return predicate()


# ------------------------------------------------------------------- store
def unit_tests(tmp: Path) -> None:
    import store as store_module
    from store import Store

    print("store")
    old = tmp / "old.db"
    with sqlite3.connect(old) as db:
        db.executescript(store_module.SCHEMA.split("-- Notification categories")[0])  # pre-preferences schema
        db.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    Store(str(old))
    with sqlite3.connect(old) as db:
        columns = {row[1] for row in db.execute("PRAGMA table_info(messages)")}
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    check({"category", "suppressed"} <= columns and {"categories", "preferences", "templates"} <= tables,
          "existing databases gain categories / preferences / templates")

    db = Store(str(tmp / "unit.db"))
    created = db.create_app("Unit")
    app = created[0] if isinstance(created, tuple) else created
    app_id = app["id"]
    subs = []
    for address, user, channel in (("https://ntfy.example/a1", "alice", "ntfy"), ("https://ntfy.example/a2", "alice", "ntfy"),
                                   ("https://ntfy.example/b1", "bob", "ntfy"), ("https://ntfy.example/x", "", "ntfy")):
        sub_id, _ = db.upsert_subscriber(app_id, channel, address, user_id=user)
        subs.append(db.get_subscriber(sub_id))
    alice1, alice2, bob, anon = subs

    def kept(category="", channel=None):
        result, suppressed = db.apply_preferences(app_id, subs, category, channel)
        return {s["id"] for s in result}, suppressed

    check(kept("marketing") == ({s["id"] for s in subs}, 0), "no preferences → everyone receives")
    db.set_preference(app_id, "user:alice", "marketing", enabled=False)
    ids, suppressed = kept("marketing")
    check(ids == {bob["id"], anon["id"]} and suppressed == 2, "user opt-out covers all of the user's devices")
    check(kept("orders")[1] == 0 and kept("")[1] == 0, "opt-out is per category")
    db.set_preference(app_id, f"sub:{alice2['id']}", "marketing", enabled=True)
    check(kept("marketing")[0] == {alice2["id"], bob["id"], anon["id"]}, "device preference beats the user's")
    db.set_preference(app_id, "user:bob", "*", enabled=False)
    check(bob["id"] not in kept("orders")[0] and bob["id"] not in kept("")[0], "'*' switches every category off")
    db.set_preference(app_id, "user:bob", "orders", enabled=True)
    check(bob["id"] in kept("orders")[0] and bob["id"] not in kept("news")[0], "a specific category beats '*'")
    db.upsert_category(app_id, "security", "Security", critical=True)
    check(kept("security") == ({s["id"] for s in subs}, 0), "critical categories ignore every opt-out")
    db.upsert_category(app_id, "digest", "Weekly digest", default_enabled=False)
    db.set_preference(app_id, f"sub:{anon['id']}", "digest", enabled=True)
    check(kept("digest")[0] == {anon["id"]}, "default_enabled=false: opt-in only")
    db.set_preference(app_id, "user:alice", "promo", channels=["inapp"])
    ids, _ = kept("promo")
    check(alice1["id"] not in ids and alice1["id"] in kept("promo", channel="inapp")[0],
          "channel limit: ntfy dropped, in-app allowed")
    db.set_preference(app_id, "user:alice", "promo")  # no values → reset
    check(alice1["id"] in kept("promo")[0], "reset removes the preference")
    view = db.preferences_for(app_id, alice2)
    by_key = {c["category"]: c for c in view["categories"]}
    check(by_key["marketing"]["enabled"] is True and by_key["marketing"]["source"].startswith("sub:")
          and by_key["security"]["source"] == "critical", "preferences_for explains where each value comes from")
    check(db.owner_of(alice1) == "user:alice" and db.owner_of(anon) == f"sub:{anon['id']}"
          and db.owner_of(alice1, "subscriber") == f"sub:{alice1['id']}", "owner_of: user when known, else device")

    # chain-wide 'unless clicked' + workflow view
    step2 = {"after": 1, "unless": "clicked", "channels": ["ntfy"], "title": "step 3"}
    first = db.create_message(app_id, {"title": "step 1", "category": "orders",
                                       "fallback": {"after": 1, "unless": "clicked", "channels": ["ntfy"],
                                                    "title": "step 2", "urgency": "high", "fallback": step2}})
    db.finish_message(first["id"], "sent")
    follow = db.process_fallbacks(now=time.time() + 5)
    check(len(follow) == 1 and follow[0]["fallback"] == step2 and follow[0]["category"] == "orders"
          and follow[0]["urgency"] == "high", "follow-up carries the next step, category and urgency")
    db.finish_message(follow[0]["id"], "sent")
    db.bump(first["id"], "clicked")  # the user opened the FIRST message late
    check(db.process_fallbacks(now=time.time() + 10) == [], "a click on any earlier step stops the chain")
    check([m["title"] for m in db.workflow(follow[0]["id"])] == ["step 1", "step 2"], "workflow() lists the chain")
    db.db.close()


# -------------------------------------------------------------------- http
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
        wait_until(lambda: _health(api), 20)
        _, created = api.call("POST", "/v1/apps", {"name": "Prefs"}, ADMIN)
        secret = created["secret_key"]
        app_key = created["app"]["app_key"]
        app_id = created["app"]["id"]
        base = f"http://127.0.0.1:{ntfy.port}"
        for topic, user in (("alice", "alice"), ("bob", "bob"), ("carol", "carol")):
            api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": f"{base}/{topic}", "user_id": user}, secret)
        categories_tests(api, secret, ntfy)
        self_service_tests(api, secret, app_key)
        template_tests(api, secret, ntfy)
        workflow_tests(api, secret, ntfy)
        mcp_tests(port, app_id)
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        ntfy.server.shutdown()


def titles(ntfy: FakeNtfy, topic: str) -> list[str]:
    return [r["json"]["title"] for r in ntfy.for_topic(topic)]


def categories_tests(api: Api, secret: str, ntfy: FakeNtfy) -> None:
    print("  categories + preferences")
    status, data = api.call("POST", "/v1/categories", {"key": "security", "name": "Security alerts",
                                                       "critical": True}, secret)
    check(status == 201 and data["category"]["critical"] is True, "POST /v1/categories (critical)")
    api.call("POST", "/v1/categories", {"key": "marketing", "name": "News & offers"}, secret)
    status, _ = api.call("POST", "/v1/categories", {"key": "Bad Key!"}, secret)
    check(status == 400, "category keys validated")
    _, data = api.call("GET", "/v1/categories", token=secret)
    check([c["key"] for c in data["categories"]] == ["marketing", "security"], "GET /v1/categories")

    status, data = api.call("POST", "/v1/preferences", {"user_id": "alice", "category": "marketing",
                                                        "enabled": False}, secret)
    check(status == 200 and {c["category"]: c["enabled"] for c in data["categories"]}["marketing"] is False,
          "POST /v1/preferences: alice opts out of marketing")
    api.call("POST", "/v1/preferences", {"user_id": "carol", "category": "marketing", "channels": ["inapp"]}, secret)
    api.call("POST", "/v1/preferences", {"user_id": "bob", "category": "*", "enabled": False}, secret)
    status, _ = api.call("POST", "/v1/preferences", {"user_id": "bob", "category": "marketing"}, secret)
    check(status == 400, "a preference needs enabled, channels or reset")
    status, _ = api.call("POST", "/v1/preferences", {"category": "marketing", "enabled": False}, secret)
    check(status == 400, "a preference needs user_id or subscriber_id")

    _, data = api.call("POST", "/v1/send", {"title": "Big sale", "channels": ["ntfy"], "category": "marketing"}, secret)
    message = wait_sent(api, data["message"]["id"], secret)
    check(message["category"] == "marketing" and message["targeted"] == 0 and message["suppressed"] == 3,
          "marketing: alice opted out, bob muted everything, carol only in-app → nobody by ntfy")
    _, data = api.call("POST", "/v1/send", {"title": "New login", "channels": ["ntfy"], "category": "security"}, secret)
    message = wait_sent(api, data["message"]["id"], secret)
    check(message["suppressed"] == 0 and message["targeted"] == 3, "critical category reaches everyone")
    _, data = api.call("POST", "/v1/send", {"title": "Plain", "channels": ["ntfy"]}, secret)
    message = wait_sent(api, data["message"]["id"], secret)
    check(message["targeted"] == 2 and message["suppressed"] == 1, "uncategorised messages respect '*' (bob)")
    wait_until(lambda: "New login" in titles(ntfy, "alice") and "Plain" in titles(ntfy, "carol"))
    check("Big sale" not in titles(ntfy, "alice") + titles(ntfy, "bob") + titles(ntfy, "carol")
          and "New login" in titles(ntfy, "bob"), "the fake ntfy saw exactly that")

    _, data = api.call("GET", "/v1/preferences?user_id=carol", token=secret)
    marketing = {c["category"]: c for c in data["categories"]}["marketing"]
    check(marketing["channels"] == ["inapp"] and marketing["source"] == "user:carol/marketing",
          "GET /v1/preferences shows the effective value and its source")
    status, _ = api.call("POST", "/v1/send", {"title": "x", "category": "NOPE"}, secret)
    check(status == 400, "message category validated")
    status, data = api.call("POST", "/v1/preferences", {"user_id": "bob", "category": "*", "reset": True}, secret)
    check(status == 200 and data["all"]["enabled"] is True, "reset: true restores the default")


def self_service_tests(api: Api, secret: str, app_key: str) -> None:
    print("  subscriber self-service (beacon.js)")
    _, device = api.call("POST", "/v1/register-device", {"app_key": app_key, "token": "fcm-token-dave",
                                                         "user_id": "dave"})
    token = device["token"]
    status, data = api.call("GET", f"/v1/me/preferences?app_key={app_key}&token={token}")
    check(status == 200 and any(c["category"] == "security" and c["critical"] for c in data["categories"]),
          "GET /v1/me/preferences with the subscriber token")
    status, data = api.call("POST", "/v1/me/preferences", {"app_key": app_key, "token": token,
                                                           "category": "marketing", "enabled": False})
    check(status == 200, "POST /v1/me/preferences")
    _, data = api.call("GET", "/v1/preferences?user_id=dave", token=secret)
    check({c["category"]: c["enabled"] for c in data["categories"]}["marketing"] is False,
          "a device's choice applies to its user")
    api.call("POST", "/v1/me/preferences", {"app_key": app_key, "token": token, "category": "marketing",
                                            "enabled": True, "scope": "subscriber"})
    _, data = api.call("GET", f"/v1/preferences?subscriber_id={device['id']}", token=secret)
    marketing = {c["category"]: c for c in data["categories"]}["marketing"]
    check(marketing["enabled"] is True and marketing["source"].startswith("sub:"), "scope=subscriber: only this device")
    status, _ = api.call("POST", "/v1/me/preferences", {"app_key": app_key, "token": "st_wrong",
                                                        "category": "marketing", "enabled": False})
    check(status == 404, "unknown subscriber token rejected")
    status, _ = api.call("POST", "/v1/me/preferences", {"app_key": app_key, "token": token,
                                                        "category": "marketing", "enabled": "no"})
    check(status == 400, "enabled must be a boolean")
    status, _ = api.call("POST", "/v1/me/preferences", {"app_key": app_key, "token": token,
                                                        "category": "marketing", "channels": ["sms"]})
    check(status == 400, "channels validated")

    api.call("POST", "/v1/me/preferences", {"app_key": app_key, "token": token, "category": "marketing",
                                            "scope": "subscriber", "reset": True})
    _, data = api.call("POST", "/v1/send", {"title": "In-app promo", "channels": ["inapp"], "category": "marketing"},
                       secret)
    wait_sent(api, data["message"]["id"], secret)
    _, data = api.call("POST", "/v1/send", {"title": "In-app notice", "channels": ["inapp"]}, secret)
    wait_sent(api, data["message"]["id"], secret)
    _, inbox = api.call("GET", f"/v1/inbox?app_key={app_key}&token={token}")
    inbox_titles = [m["title"] for m in inbox["messages"]]
    check("In-app notice" in inbox_titles and "In-app promo" not in inbox_titles,
          "in-app inbox hides categories the user switched off")


def template_tests(api: Api, secret: str, ntfy: FakeNtfy) -> None:
    print("  templates")
    template = {
        "name": "order_shipped",
        "title": "Order {{order.id}} shipped",
        "body": "Hi {{name}}, it arrives {{eta}}.",
        "url": "https://shop.example/track/{{order.id}}?q={{query}}",
        "channels": ["ntfy"],
        "category": "orders",
        "target": {"user_ids": ["{{user}}"]},
    }
    status, data = api.call("POST", "/v1/templates", template, secret)
    check(status == 201 and data["template"]["variables"] == ["order.id", "name", "eta", "query", "user"],
          "POST /v1/templates lists the variables it needs")
    _, data = api.call("GET", "/v1/templates", token=secret)
    check([t["name"] for t in data["templates"]] == ["order_shipped"], "GET /v1/templates")
    vars_ = {"order": {"id": "A-17"}, "name": "Alice", "eta": "tomorrow", "query": "a b&c", "user": "alice"}
    status, data = api.call("POST", "/v1/templates/order_shipped/render", {"vars": vars_}, secret)
    preview = data.get("message", {})
    check(status == 200 and preview["title"] == "Order A-17 shipped"
          and preview["url"] == "https://shop.example/track/A-17?q=a%20b%26c"
          and preview["target"] == {"user_ids": ["alice"]}, "render preview: text filled, URL values percent-encoded")
    status, data = api.call("POST", "/v1/send", {"template": "order_shipped", "vars": vars_}, secret)
    message = wait_sent(api, data["message"]["id"], secret)
    check(status == 202 and message["category"] == "orders" and message["targeted"] == 1,
          "send with template + vars")
    received = wait_until(lambda: [r["json"] for r in ntfy.for_topic("alice") if r["json"]["title"] == "Order A-17 shipped"])
    check(bool(received) and received[0].get("message") == "Hi Alice, it arrives tomorrow."
          and received[0].get("click") == "https://shop.example/track/A-17?q=a%20b%26c", "ntfy got the rendered message")
    status, data = api.call("POST", "/v1/send", {"template": "order_shipped", "vars": {"name": "x"}}, secret)
    check(status == 400 and "order.id" in data.get("error", "") and "eta" in data.get("error", ""),
          "missing variables → 400 naming them")
    status, data = api.call("POST", "/v1/send", {"template": "order_shipped", "vars": vars_,
                                                 "title": "Overridden", "send_at": time.time() + 3600}, secret)
    check(status == 202 and data["message"]["title"] == "Overridden", "fields in the send body override the template")
    api.call("POST", f"/v1/messages/{data['message']['id']}/cancel", {}, secret)
    status, _ = api.call("POST", "/v1/send", {"template": "nope", "vars": {}}, secret)
    check(status == 404, "unknown template → 404")
    for bad, label in (({"name": "t1"}, "title required"),
                       ({"name": "bad name", "title": "x"}, "name validated"),
                       ({"name": "t2", "title": "x", "channels": ["sms"]}, "channels validated"),
                       ({"name": "t3", "title": "x", "url": "javascript:{{x}}"}, "url validated")):
        status, _ = api.call("POST", "/v1/templates", bad, secret)
        check(status == 400, f"template rejected: {label}")
    status, _ = api.call("POST", "/v1/send", {"template": "order_shipped", "vars": {**vars_, "name": {"x": 1}}}, secret)
    check(status == 400, "object values cannot be pasted into text")
    status, _ = api.call("POST", "/v1/templates/order_shipped/delete", {}, secret)
    status2, _ = api.call("GET", "/v1/templates/order_shipped", token=secret)
    check(status == 200 and status2 == 404, "delete template")


def workflow_tests(api: Api, secret: str, ntfy: FakeNtfy) -> None:
    print("  multi-step workflows")
    status, data = api.call("POST", "/v1/send", {
        "title": "Approve the invoice", "channels": ["inapp"], "target": {"user_ids": ["carol"]},
        "fallback": {"after": 1, "channels": ["ntfy"], "title": "Reminder: approve the invoice",
                     "fallback": {"after": 1, "channels": ["ntfy"], "title": "FINAL: approve the invoice",
                                  "urgency": "high"}}}, secret)
    first = data["message"]
    check(status == 202 and first["fallback"]["fallback"]["urgency"] == "high", "nested fallback accepted")
    final = wait_until(lambda: [r for r in ntfy.for_topic("carol") if r["json"]["title"].startswith("FINAL")], 30)
    check(bool(final) and any(t.startswith("Reminder") for t in titles(ntfy, "carol")),
          "in-app → (unclicked) ntfy reminder → (still unclicked) final ntfy")
    _, data = api.call("GET", f"/v1/messages/{first['id']}/workflow", token=secret)
    steps = data.get("steps", [])
    check([s["title"] for s in steps] == ["Approve the invoice", "Reminder: approve the invoice",
                                          "FINAL: approve the invoice"]
          and steps[2]["parent_id"] == steps[1]["id"] and steps[2]["urgency"] == "high",
          "GET /v1/messages/<id>/workflow shows all 3 steps")
    _, again = api.call("GET", f"/v1/messages/{steps[2]['id']}/workflow", token=secret)
    check(len(again.get("steps", [])) == 3, "the workflow can be read from any step")
    nested = {"after": 1, "channels": ["ntfy"]}
    for _ in range(4):
        nested = {"after": 1, "channels": ["ntfy"], "fallback": nested}
    status, data = api.call("POST", "/v1/send", {"title": "x", "fallback": nested}, secret)
    check(status == 400 and "at most" in data.get("error", ""), "workflows are limited to 4 escalations")
    status, _ = api.call("POST", "/v1/send", {"title": "x", "fallback": {"after": 1, "channels": ["ntfy"],
                                                                        "urgency": "panic"}}, secret)
    check(status == 400, "step urgency validated")


def mcp_tests(port: int, app_id: int) -> None:
    import mcp_server

    print("  MCP")
    client = mcp_server.BeaconClient(f"http://127.0.0.1:{port}", ADMIN)
    names = {t["name"] for t in mcp_server.TOOLS}
    check({"save_template", "list_templates", "upsert_category", "set_preference", "get_preferences"} <= names,
          "Beacon MCP lists the new tools")

    def call(name, args):
        reply = mcp_server.handle(client, {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                           "params": {"name": name, "arguments": args}})
        result = reply["result"]
        return result["isError"], result["content"][0]["text"]

    error, text = call("save_template", {"app_id": app_id, "name": "welcome", "title": "Welcome {{name}}",
                                         "channels": ["inapp"]})
    check(not error and json.loads(text)["variables"] == ["name"], "MCP save_template")
    error, text = call("send_notification", {"app_id": app_id, "template": "welcome", "vars": {"name": "Eve"}})
    check(not error and json.loads(text)["status"] == "queued", "MCP send_notification with a template")
    error, text = call("upsert_category", {"app_id": app_id, "key": "tips", "default_enabled": False})
    check(not error and json.loads(text)["default_enabled"] is False, "MCP upsert_category")
    error, text = call("set_preference", {"app_id": app_id, "user_id": "eve", "category": "tips", "enabled": True})
    tips = {c["category"]: c for c in json.loads(text)["categories"]}.get("tips", {}) if not error else {}
    check(tips.get("enabled") is True, "MCP set_preference")
    error, text = call("get_preferences", {"app_id": app_id, "user_id": "eve"})
    check(not error and json.loads(text)["all"]["enabled"] is True, "MCP get_preferences")


def _health(api: Api) -> bool:
    try:
        return api.call("GET", "/v1/health")[0] == 200
    except OSError:
        return False


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    with tempfile.TemporaryDirectory(prefix="beacon-prefs-", ignore_cleanup_errors=True) as tmp_name:
        tmp = Path(tmp_name)
        unit_tests(tmp)
        http_tests(tmp)
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  - " + failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
