"""Hermetic tests for Beacon's Gatus alert hook (POST /v1/hooks/gatus).

Builds request bodies exactly the way Gatus' custom provider does (plain
placeholder replacement, quotes escaped only in [RESULT_ERRORS]) and delivers
through a fake ntfy server on loopback.

  python apps/beacon/tests/verify_gatus.py
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))
sys.path.insert(0, str(HERE))

from verify_channels import OPENER, Api, FakeNtfy, free_port, wait_sent  # noqa: E402

FAILURES: list[str] = []
PASSED = 0
EXAMPLE = HERE.parent / "examples" / "gatus" / "config.yaml"


def check(condition, label):
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def gatus_body(template: str, *, status="TRIGGERED", name="api", group="core", url="https://api.example.com/health",
               description="health check failed", errors=(), conditions=()) -> bytes:
    """Mirror of gatus alerting/provider/custom buildHTTPRequest."""
    body = template
    body = body.replace("[ALERT_DESCRIPTION]", description)
    body = body.replace("[ENDPOINT_NAME]", name)
    body = body.replace("[ENDPOINT_GROUP]", group)
    body = body.replace("[ENDPOINT_URL]", url)
    body = body.replace("[RESULT_ERRORS]", ",".join(errors).replace('"', '\\"'))
    formatted = ", ".join(f"{'✅' if ok else '❌'} - `{text}`" for ok, text in conditions)
    body = body.replace("[RESULT_CONDITIONS]", formatted)
    body = body.replace("[ALERT_TRIGGERED_OR_RESOLVED]", status)
    return body.encode()


def example_template() -> str:
    lines = EXAMPLE.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "body: |") + 1
    block = []
    for line in lines[start:]:
        if line.strip() and not line.startswith("      "):
            break
        block.append(line[6:])
    return "\n".join(block).strip()


def unit_tests() -> None:
    import gatus

    print("Unit: parsing")
    template = example_template()
    check(template.startswith("{") and "[ALERT_TRIGGERED_OR_RESOLVED]" in template, "example config body template found")
    alert = gatus.parse_alert(gatus_body(template, errors=['status 503 "Service Unavailable"']))
    check(alert["status"] == "TRIGGERED" and alert["name"] == "api" and alert["group"] == "core"
          and alert["errors"] == 'status 503 "Service Unavailable"', "valid JSON body parsed (escaped errors)")
    nasty = gatus_body(template, name='say "hi" api', description='body said "DOWN"',
                       conditions=[(False, '[BODY].status == "UP"'), (True, "[STATUS] == 200")])
    try:
        json.loads(nasty)
        check(False, "unescaped quotes really break JSON (precondition)")
    except json.JSONDecodeError:
        check(True, "unescaped quotes really break JSON (precondition)")
    alert = gatus.parse_alert(nasty)
    check(alert["name"] == 'say "hi" api' and alert["description"] == 'body said "DOWN"'
          and '[BODY].status == "UP"' in alert["conditions"] and alert["status"] == "TRIGGERED",
          "lenient parser recovers fields from broken JSON")
    alert = gatus.parse_alert(b"RESOLVED: core - api - health check failed")
    check(alert["status"] == "RESOLVED" and "health check failed" in alert["description"], "plain-text body accepted")
    for bad in (b"", b"{ nothing useful }"):
        try:
            gatus.parse_alert(bad)
            check(False, f"rejects {bad!r}")
        except gatus.HookError:
            check(True, f"rejects {bad!r}")

    print("Unit: mapping")
    defaults = ["webpush", "fcm", "ntfy"]
    down = gatus.parse_alert(gatus_body(template, errors=["context deadline exceeded"]))
    body, resolved = gatus.to_message(down, {}, defaults)
    check(not resolved and body["title"] == "🔴 core / api is down" and body["urgency"] == "high"
          and body["target"] == {"all": True} and body["url"] == "https://api.example.com/health"
          and "context deadline exceeded" in body["body"], "TRIGGERED -> high-urgency push to everyone")
    check(body["tag"] == "gatus:core-api" and "fallback" not in body and "channels" not in body,
          "stable per-endpoint tag, no escalation unless asked")
    body, _ = gatus.to_message(down, {"tags": "oncall,sre", "channels": "ntfy", "page": "https://status.example.com",
                                      "escalate_after": "600", "escalate_channels": "bark"}, defaults)
    check(body["target"] == {"tags": ["oncall", "sre"]} and body["channels"] == ["ntfy"]
          and body["url"] == "https://status.example.com", "query routes tags, channels, status page")
    check(body["fallback"] == {"after": 600.0, "unless": "clicked", "channels": ["bark"], "title": "Still down: core / api"},
          "escalate_after builds a fallback")
    body, _ = gatus.to_message(down, {"escalate_after": "60"}, defaults)
    check(body["fallback"]["channels"] == defaults, "escalation defaults to the push channels")
    up = gatus.parse_alert(gatus_body(template, status="operational"))
    body, resolved = gatus.to_message(up, {"resolved": "operational", "escalate_after": "60"}, defaults)
    check(resolved and body["title"] == "✅ core / api is back up" and body["urgency"] == "normal"
          and "fallback" not in body and body["tag"] == "gatus:core-api",
          "custom RESOLVED word -> normal push, same tag, never escalates")
    body, _ = gatus.to_message(down, {"users": "alice", "digest": "120"}, defaults)
    check(body["target"] == {"user_ids": ["alice"]} and body["digest"]["key"] == "gatus:triggered"
          and "{count}" in body["digest"]["title"], "users= and digest= options")
    long_alert = dict(down, name="x" * 300, errors="e" * 2000)
    body, _ = gatus.to_message(long_alert, {}, defaults)
    check(len(body["title"]) <= 120 and len(body["body"]) <= 600 and len(body["tag"]) <= 64,
          "long names/errors clipped to Beacon limits")


def http_tests() -> None:
    work = Path(tempfile.mkdtemp(prefix="beacon-gatus-"))
    ntfy = FakeNtfy()
    env = dict(os.environ, BEACON_QUIET="1", BEACON_TEST_HOSTS="127.0.0.1", BEACON_PROXY="none",
               PYTHONIOENCODING="utf-8")
    port = free_port()
    admin = "adm_gatus_test"
    process = subprocess.Popen(
        [sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--data", str(work / "b.db"),
         "--admin-token", admin],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    api = Api(port)

    def hook(body: bytes, query: str = "", token: str | None = None):
        request = urllib.request.Request(f"{api.base}/v1/hooks/gatus{query}", data=body, method="POST")
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        try:
            with OPENER.open(request, timeout=15) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read() or b"{}")

    try:
        for _ in range(100):
            try:
                if api.call("GET", "/v1/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.1)
        print("HTTP: hook")
        _, created = api.call("POST", "/v1/apps", {"name": "Status"}, token=admin)
        secret = created["secret_key"]
        app_id = created["app"]["id"]
        base = f"http://127.0.0.1:{ntfy.port}"
        api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": f"{base}/oncall", "tags": ["oncall"]}, token=secret)
        api.call("POST", "/v1/contacts", {"channel": "ntfy", "address": f"{base}/everyone", "tags": ["staff"]},
                 token=secret)
        template = example_template()

        check(hook(gatus_body(template))[0] == 401, "hook needs the app secret")
        status, data = hook(gatus_body(template, errors=["status 503"]), "?tags=oncall", secret)
        message = wait_sent(api, data.get("message", {}).get("id", 0), secret)
        check(status == 202 and not data["resolved"] and message.get("delivered") == 1,
              "TRIGGERED alert delivered to tagged subscribers only")
        published = ntfy.for_topic("oncall")
        check(published and published[-1]["json"]["title"] == "🔴 core / api is down"
              and published[-1]["json"]["priority"] == 4 and published[-1]["json"]["tags"] == ["gatus:core-api"]
              and not ntfy.for_topic("everyone"), "ntfy got the down alert (high priority, endpoint tag)")

        nasty = gatus_body(template, name='checkout "v2"', conditions=[(False, '[BODY].status == "UP"')])
        status, data = hook(nasty, "?tags=oncall", secret)
        check(status == 202 and data["message"]["title"] == '🔴 core / checkout "v2" is down',
              "broken-JSON body from Gatus still accepted")

        status, data = hook(gatus_body(template, name="db"), "?tags=oncall&escalate_after=600&escalate_channels=ntfy",
                            secret)
        trigger_id = data["message"]["id"]
        wait_sent(api, trigger_id, secret)
        _, info = api.call("GET", f"/v1/messages/{trigger_id}", token=secret)
        check(info["message"].get("fallback_state") == "pending", "escalation scheduled for the down alert")
        status, data = hook(gatus_body(template, name="db", status="RESOLVED"), "?tags=oncall", secret)
        check(status == 202 and data["resolved"] and data["escalations_cancelled"] == 1,
              "RESOLVED alert cancels the pending escalation")
        _, info = api.call("GET", f"/v1/messages/{trigger_id}", token=secret)
        check(info["message"].get("fallback_state") == "cancelled", "escalation state is cancelled")
        resolved = wait_sent(api, data["message"]["id"], secret)
        check(resolved.get("delivered") == 1 and ntfy.for_topic("oncall")[-1]["json"]["title"] == "✅ core / db is back up",
              "recovery push delivered")

        status, first = hook(gatus_body(template, name="web"), "?digest=30&tags=oncall", secret)
        status, second = hook(gatus_body(template, name="cdn"), "?digest=30&tags=oncall", secret)
        check(second.get("digested") is True and second["message"]["id"] == first["message"]["id"],
              "alert storm batched by digest=")

        status, data = hook(gatus_body(template), f"?app_id={app_id}&tags=staff", admin)
        check(status == 202 and data["message"]["target"] == {"tags": ["staff"], "match": "any"},
              "admin token works with app_id")
        status, data = hook(b"", "", secret)
        check(status == 400 and "alerting.custom.body" in data.get("error", ""), "empty body explains the Gatus setting")
        status, data = hook(gatus_body(template), "?channels=sms", secret)
        check(status == 400, "unknown channel in the hook URL refused")
        status, data = hook(gatus_body(template), "?digest=abc", secret)
        check(status == 400, "bad digest value refused")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
        ntfy.server.shutdown()
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    unit_tests()
    http_tests()
    print(f"\n{PASSED} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
