"""Hermetic tests for Tether AI steps (ai, ai_assert) against a fake OpenAI-compatible server.

  python apps/tether/tests/verify_ai.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "server"))

PASSES = 0
FAILURES: list[str] = []


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


class FakeModel:
    """Answers /v1/chat/completions from a queue of scripted replies and records requests."""

    def __init__(self):
        self.replies: list = []
        self.requests: list[dict] = []
        self.headers: list[dict] = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                outer.requests.append(body)
                outer.headers.append(dict(self.headers))
                if self.path != "/v1/chat/completions":
                    self.send_response(404)
                    self.end_headers()
                    return
                reply = outer.replies.pop(0) if outer.replies else {"action": "fail", "reason": "script empty"}
                if isinstance(reply, tuple):  # (status, raw body)
                    status, raw = reply
                    self.send_response(status)
                    self.send_header("Content-Length", str(len(raw)))
                    self.end_headers()
                    self.wfile.write(raw)
                    return
                content = reply if isinstance(reply, str) else json.dumps(reply)
                payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": content}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def user_text(self, index: int) -> str:
        content = self.requests[index]["messages"][1]["content"]
        if isinstance(content, list):
            return " ".join(part.get("text", "") for part in content if part.get("type") == "text")
        return content


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="tether-ai-") as tmp_name:
        tmp = Path(tmp_name)
        log_path = tmp / "input.log"
        os.environ.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(log_path),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
        })
        model = FakeModel()
        os.environ["TETHER_AI_URL"] = model.url
        os.environ["TETHER_AI_MODEL"] = "test-vision-model"
        os.environ["TETHER_AI_KEY"] = "sk-test"
        os.environ.pop("TETHER_AI_VISION", None)

        import ai
        import maestro
        from adb import Adb, AdbError
        from flows import FlowError, run_flow, validate_flow

        adb = Adb()
        serial = "emulator-5554"

        def log_lines():
            return log_path.read_text(encoding="utf-8").splitlines() if log_path.exists() else []

        print("parsing")
        check(ai.parse_json_reply('```json\n{"action": "done"}\n```') == {"action": "done"}, "JSON inside ``` fences")
        check(ai.parse_json_reply('Sure! {"pass": true, "reason": "ok"} hope that helps')["pass"] is True,
              "JSON inside prose")
        try:
            ai.parse_json_reply("I cannot do that")
            check(False, "non-JSON reply rejected")
        except AdbError as exc:
            check("did not answer with JSON" in str(exc), "non-JSON reply rejected with a clear error")

        print("screen description")
        text, table = ai.describe_screen(adb.ui_elements(serial), (1080, 2400))
        check('"Sign in"' in text and "id=login" in text and "label=\"Email\"" in text and len(table) == 3,
              "numbered element list with text, label and id")

        print("ai step: the model logs in")
        model.replies = [
            {"thought": "tap email", "action": "type", "element": 2, "text": "qa@example.com"},
            {"thought": "submit", "action": "tap", "element": 3},
            {"thought": "goal reached", "action": "done", "reason": "Signed in"},
        ]
        before = len(log_lines())
        flow = {"name": "ai login", "steps": [
            {"action": "ai", "goal": "Sign in as qa@example.com", "max_steps": 5},
        ]}
        report = run_flow(adb, serial, flow, settle_ms=0)
        step = report["steps"][0]
        check(report["passed"] and step["ai"]["turns"] == 3 and len(step["ai"]["actions"]) == 2,
              f"ai step passed in 3 turns ({step.get('error') or step['ai']['actions']})")
        check(log_lines()[before:] == ["input tap 540 970", "input text qa@example.com", "input tap 540 1880"],
              "typed into the Email field (tapped first) and tapped Sign in")
        first = model.requests[0]
        check(first["model"] == "test-vision-model" and first["temperature"] == 0
              and first["response_format"] == {"type": "json_object"}, "request: model, temperature 0, JSON mode")
        image_parts = [p for p in first["messages"][1]["content"] if p.get("type") == "image_url"]
        check(image_parts and image_parts[0]["image_url"]["url"].startswith("data:image/png;base64,"),
              "request: screenshot attached as a data URL (vision)")
        check(model.headers[0].get("Authorization") == "Bearer sk-test", "request: API key sent as Bearer token")
        check("Goal: Sign in as qa@example.com" in model.user_text(0) and "(none yet)" in model.user_text(0)
              and 'type "qa@example.com"' in model.user_text(1), "prompt carries the goal and the action history")

        print("ai step failures")
        model.replies = [{"action": "fail", "reason": "No account with that email"}]
        report = run_flow(adb, serial, flow, settle_ms=0)
        check(not report["passed"] and "No account with that email" in report["steps"][0]["error"],
              "model 'fail' fails the step with its reason")
        model.replies = [{"action": "tap", "element": 99}]
        report = run_flow(adb, serial, flow, settle_ms=0)
        check(not report["passed"] and "not on screen" in report["steps"][0]["error"],
              "hallucinated element number fails safely (no tap)")
        model.replies = [{"action": "wait"}] * 3
        report = run_flow(adb, serial, {"steps": [{"action": "ai", "goal": "x", "max_steps": 2}]}, settle_ms=0)
        check(not report["passed"] and "within 2 actions" in report["steps"][0]["error"], "max_steps limit enforced")
        model.replies = ["not json at all"]
        report = run_flow(adb, serial, flow, settle_ms=0)
        check(not report["passed"] and "JSON" in report["steps"][0]["error"], "garbage reply fails the step")
        model.replies = [(500, b"model not loaded")]
        report = run_flow(adb, serial, flow, settle_ms=0)
        check(not report["passed"] and "answered 500" in report["steps"][0]["error"], "HTTP error surfaces")

        print("ai_assert")
        model.replies = [{"pass": True, "reason": "Welcome to Demo is shown"}]
        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "condition": "The welcome screen is shown"}]})
        check(report["passed"] and report["steps"][0]["ai"]["reason"] == "Welcome to Demo is shown", "assert passes")
        model.replies = [{"pass": False, "reason": "No balance is visible"}]
        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "condition": "A balance is shown"}]})
        check(not report["passed"] and "No balance is visible" in report["steps"][0]["error"], "assert fails with reason")
        model.replies = [{"pass": "true", "reason": "ok"}]
        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "condition": "x"}]})
        check(report["passed"], "string 'true' accepted")
        model.replies = [{"pass": False, "reason": "flaky"}]
        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "condition": "x", "optional": True}]})
        check(report["passed"] and report["steps"][0].get("optional_failed"), "optional ai_assert does not fail the flow")

        print("text-only models")
        os.environ["TETHER_AI_VISION"] = "0"
        model.replies = [{"pass": True, "reason": "ok"}]
        run_flow(adb, serial, {"steps": [{"action": "ai_assert", "condition": "x"}]})
        check(isinstance(model.requests[-1]["messages"][1]["content"], str), "TETHER_AI_VISION=0 sends no image")
        os.environ.pop("TETHER_AI_VISION")

        print("validation")
        for bad, label in (({"action": "ai"}, "ai without goal"),
                           ({"action": "ai", "goal": "x", "max_steps": 99}, "max_steps > 40"),
                           ({"action": "ai_assert"}, "ai_assert without condition")):
            try:
                validate_flow({"steps": [bad]})
                check(False, f"rejects {label}")
            except FlowError:
                check(True, f"rejects {label}")

        print("Maestro")
        flow, warnings = maestro.maestro_to_flow(
            "appId: com.demo.app\n---\n- assertWithAI:\n    assertion: \"The cart shows 2 items\"\n"
            "- assertNoDefectsWithAI\n- extractTextWithAI: \"price\"\n")
        check(flow["steps"][0] == {"action": "ai_assert", "condition": "The cart shows 2 items"}
              and flow["steps"][1]["action"] == "ai_assert" and "defects" in flow["steps"][1]["condition"]
              and len(flow["steps"]) == 2 and any("extractTextWithAI" in w or "not supported" in w for w in warnings),
              "assertWithAI / assertNoDefectsWithAI -> ai_assert; extractTextWithAI warned")
        yaml_text, _warnings = maestro.flow_to_maestro(flow)
        check("- assertWithAI:\n    assertion: \"The cart shows 2 items\"" in yaml_text
              and "- assertNoDefectsWithAI" in yaml_text, "ai_assert exports back to Maestro")

        print("unreachable endpoint")
        os.environ["TETHER_AI_URL"] = "http://127.0.0.1:9/v1"
        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "condition": "x"}]})
        check(not report["passed"] and "cannot reach the AI endpoint" in report["steps"][0]["error"],
              "unreachable endpoint explains how to fix it")
        model.server.shutdown()

    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  - " + failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
