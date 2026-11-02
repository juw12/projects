"""
ScopeGuard server - drop-in guard for any AI assistant. Standard library only.

    python server.py --policy policy_cad_assistant.json --port 8787

Environment (all optional):
    SCOPEGUARD_API_KEY       bearer key required on /v1/*  (your app -> ScopeGuard)
    SCOPEGUARD_ADMIN_KEY     bearer key required on /api/* (dashboard; open it as /#key=...)
    SCOPEGUARD_UPSTREAM      OpenAI-compatible base URL, e.g. https://api.openai.com/v1
    SCOPEGUARD_UPSTREAM_KEY  key for the upstream LLM
    SCOPEGUARD_JUDGE_MODEL   model name -> enables the LLM judge for low-confidence messages
"""

import argparse
import hmac
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from engine import LABELS, Engine, load_policy, make_openai_judge, open_url
from store import Store

MAX_BODY_BYTES = 64 * 1024
HERE = Path(__file__).resolve().parent


class ScopeGuardApp:
    def __init__(self, policy_path: Path, db_path: Path, env: dict | None = None):
        env = dict(os.environ if env is None else env)
        self.api_key = env.get("SCOPEGUARD_API_KEY", "")
        self.admin_key = env.get("SCOPEGUARD_ADMIN_KEY", "")
        self.upstream = env.get("SCOPEGUARD_UPSTREAM", "").rstrip("/")
        self.upstream_key = env.get("SCOPEGUARD_UPSTREAM_KEY", "")
        judge = None
        if self.upstream and env.get("SCOPEGUARD_JUDGE_MODEL"):
            judge = make_openai_judge(self.upstream, self.upstream_key, env["SCOPEGUARD_JUDGE_MODEL"])
        self.store = Store(db_path)
        self.engine = Engine(load_policy(policy_path), self.store.learned_examples(), llm_judge=judge)
        self.dashboard_html = (HERE / "dashboard.html").read_bytes()

    def guard(self, user: str, message: str) -> tuple[int, object]:
        decision = self.engine.check(user, message)
        event_id = self.store.log(user, message, decision)
        return event_id, decision

    def feedback(self, event_id: int, label: str) -> None:
        self.store.add_feedback(event_id, label)
        self.engine.rebuild(self.store.learned_examples())


def decision_payload(event_id: int, decision) -> dict:
    return {
        "event_id": event_id,
        "action": decision.action,
        "allowed": decision.action in ("ALLOW", "ADJACENT"),
        "label": decision.label,
        "uncertain": decision.uncertain,
        "reason": decision.reason,
        "scores": decision.scores,
        "reply": decision.reply,
    }


def last_user_text(messages: list) -> str:
    for message in reversed(messages):
        if isinstance(message, dict) and message.get("role") == "user":
            content = message.get("content", "")
            if isinstance(content, list):
                return " ".join(part.get("text", "") for part in content if isinstance(part, dict))
            return str(content)
    return ""


def completion_response(model: str, text: str, guard_info: dict) -> dict:
    return {
        "id": "chatcmpl-sg-" + uuid.uuid4().hex[:12],
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": text},
            "finish_reason": "stop",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        "scopeguard": guard_info,
    }


def make_handler(app: ScopeGuardApp):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ScopeGuard/0.2"

        def log_message(self, format, *args):
            pass

        # ---------- helpers ----------

        def send_json(self, status: int, payload: dict, headers: dict | None = None) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def read_json(self) -> dict | None:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                self.send_json(413, {"error": "request body too large"})
                return None
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                self.send_json(400, {"error": "invalid JSON"})
                return None
            if not isinstance(data, dict):
                self.send_json(400, {"error": "JSON object expected"})
                return None
            return data

        def authorized(self, required_key: str) -> bool:
            if not required_key:
                return True
            supplied = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
            if hmac.compare_digest(supplied.encode(), required_key.encode()):
                return True
            self.send_json(401, {"error": "missing or invalid bearer key"})
            return False

        # ---------- routes ----------

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in ("/", "/dashboard"):
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'")
                self.send_header("Content-Length", str(len(app.dashboard_html)))
                self.end_headers()
                self.wfile.write(app.dashboard_html)
            elif path == "/health":
                self.send_json(200, {"ok": True, "examples": app.engine.example_count})
            elif path == "/api/stats":
                if self.authorized(app.admin_key):
                    self.send_json(200, app.store.stats(app.engine))
            elif path == "/api/policy":
                if self.authorized(app.admin_key):
                    self.send_json(200, app.engine.policy)
            else:
                self.send_json(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            if path == "/v1/check":
                self.handle_check()
            elif path == "/v1/chat/completions":
                self.handle_chat()
            elif path == "/api/classify":
                self.handle_classify()
            elif path == "/api/feedback":
                self.handle_feedback()
            else:
                self.send_json(404, {"error": "not found"})

        def handle_check(self):
            if not self.authorized(app.api_key):
                return
            data = self.read_json()
            if data is None:
                return
            message = data.get("message")
            if not isinstance(message, str) or not message.strip():
                self.send_json(400, {"error": "'message' (non-empty string) is required"})
                return
            user = str(data.get("user") or "anonymous")[:200]
            event_id, decision = app.guard(user, message)
            self.send_json(200, decision_payload(event_id, decision))

        def handle_chat(self):
            if not self.authorized(app.api_key):
                return
            data = self.read_json()
            if data is None:
                return
            if data.get("stream"):
                self.send_json(400, {"error": "streaming is not supported by ScopeGuard v0.2; send stream=false"})
                return
            messages = data.get("messages")
            if not isinstance(messages, list) or not messages:
                self.send_json(400, {"error": "'messages' list is required"})
                return
            user = str(data.get("user") or self.headers.get("X-User-Id") or "anonymous")[:200]
            event_id, decision = app.guard(user, last_user_text(messages))
            info = decision_payload(event_id, decision)
            headers = {"X-ScopeGuard-Action": decision.action}
            model = str(data.get("model", "scopeguard"))

            if not info["allowed"]:
                self.send_json(200, completion_response(model, decision.reply, info), headers)
                return

            if decision.action == "ADJACENT":
                data["messages"] = [{"role": "system", "content": decision.reply}] + messages

            if not app.upstream:
                mock = f"[mock LLM - set SCOPEGUARD_UPSTREAM to forward] Would answer: {last_user_text(messages)[:200]}"
                self.send_json(200, completion_response(model, mock, info), headers)
                return

            request = urllib.request.Request(
                app.upstream + "/chat/completions",
                data=json.dumps(data).encode("utf-8"),
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {app.upstream_key}"},
            )
            try:
                with open_url(request, 120) as response:
                    upstream_payload = json.loads(response.read())
            except urllib.error.HTTPError as error:
                self.send_json(502, {"error": f"upstream HTTP {error.code}", "scopeguard": info}, headers)
                return
            except Exception as error:
                self.send_json(502, {"error": f"upstream unreachable: {error}", "scopeguard": info}, headers)
                return
            upstream_payload["scopeguard"] = info
            self.send_json(200, upstream_payload, headers)

        def handle_classify(self):
            """Playground: classify without logging or touching user sessions."""
            if not self.authorized(app.admin_key):
                return
            data = self.read_json()
            if data is None:
                return
            message = str(data.get("message", ""))
            if app.engine.is_abuse(message):
                self.send_json(200, {"label": "abuse", "action": "BLOCK", "scores": {}, "uncertain": False,
                                     "reason": "jailbreak / prompt-injection pattern"})
                return
            result = app.engine.classify(message)
            action = {"in_scope": "ALLOW", "adjacent": "ADJACENT", "out_of_scope": "REDIRECT"}[result.label]
            self.send_json(200, {"label": result.label, "action": action, "scores": result.scores,
                                 "uncertain": result.uncertain, "reason": result.reason,
                                 "nearest_example": result.nearest_example})

        def handle_feedback(self):
            if not self.authorized(app.admin_key):
                return
            data = self.read_json()
            if data is None:
                return
            label = data.get("label")
            if label not in LABELS:
                self.send_json(400, {"error": f"'label' must be one of {list(LABELS)}"})
                return
            try:
                app.feedback(int(data.get("event_id")), label)
            except (KeyError, TypeError, ValueError):
                self.send_json(404, {"error": "unknown event_id"})
                return
            self.send_json(200, {"ok": True, "learned_examples": len(app.store.learned_examples())})

    return Handler


def create_server(app: ScopeGuardApp, host: str = "127.0.0.1", port: int = 8787) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(app))


def main():
    parser = argparse.ArgumentParser(description="ScopeGuard - keep business AI on-mission")
    parser.add_argument("--policy", default=str(HERE / "policy_cad_assistant.json"))
    parser.add_argument("--db", default=str(HERE / "scopeguard.db"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    app = ScopeGuardApp(Path(args.policy), Path(args.db))
    server = create_server(app, args.host, args.port)
    print(f"ScopeGuard running: http://{args.host}:{args.port}/  (policy: {app.engine.policy['name']})")
    print("  POST /v1/check  |  POST /v1/chat/completions  |  dashboard at /")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.store.close()


if __name__ == "__main__":
    main()
