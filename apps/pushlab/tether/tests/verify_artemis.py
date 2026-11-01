"""Hermetic tests for Tether's ARTEMIS engine (google/artemis) against a fake ARTEMIS daemon.

  python apps/pushlab/tether/tests/verify_artemis.py

The fake daemon speaks the HTTP protocol of the official artemis-client SDK:
POST /api/run, GET /api/sessions/{id} (404 while queued), GET /api/status,
POST /api/stop, GET /api/devices.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

PASSES = 0
FAILURES: list[str] = []
TOKEN = "artemis-test-token"
FLAGS = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0


def check(condition, label):
    global PASSES
    if condition:
        PASSES += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


class FakeArtemis:
    """Tasks are 404 in /api/sessions until their 2nd poll (visible only in /api/status), then finish."""

    def __init__(self):
        self.runs: list[dict] = []
        self.auth: list[str] = []
        self.stops: list[str] = []
        self.tasks: dict[str, dict] = {}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, payload):
                body = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                outer.auth.append(self.headers.get("Authorization", ""))
                if self.path == "/api/devices":
                    self.reply(200, {"devices": [{"serial": "emulator-5554", "state": "device"}]})
                elif self.path == "/api/status":
                    queue = [{"session_id": tid, "status": "running"} for tid, t in outer.tasks.items()
                             if t["polls"] < 2]
                    self.reply(200, {"queue": queue, "active_tasks": []})
                elif self.path.startswith("/api/sessions/"):
                    task = outer.tasks.get(self.path.rsplit("/", 1)[-1])
                    if task is None:
                        self.reply(404, {"error": "unknown"})
                        return
                    task["polls"] += 1
                    if task["polls"] < 2 or task["mode"] == "slow":
                        self.reply(404, {"error": "not stored yet"})
                        return
                    self.reply(200, task["final"])
                else:
                    self.reply(404, {})

            def do_POST(self):
                outer.auth.append(self.headers.get("Authorization", ""))
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                if self.path == "/api/stop":
                    outer.stops.append(body.get("session_id"))
                    self.reply(200, {"status": "stopped"})
                    return
                if self.path != "/api/run":
                    self.reply(404, {})
                    return
                outer.runs.append(body)
                goal = body["goal"]
                if "REJECT" in goal:
                    self.reply(200, {"status": "rejected", "tasks": [], "error": "device busy"})
                    return
                task_id = body["session_id"]
                mode = "slow" if "SLOW" in goal else "normal"
                if "BROKEN" in goal:
                    final = {"session_id": task_id, "status": "failed", "error": "app crashed on launch"}
                elif "Check whether this is true" in goal:
                    verdict = "PASS: the balance 12.50 EUR is shown" if "balance" in goal else \
                        "FAIL: there is no such text on screen"
                    final = {"session_id": task_id, "status": "completed", "output": verdict, "turns": 1}
                else:
                    final = {"session_id": task_id, "status": "completed", "summary": "Signed in; dashboard visible",
                             "current_turn": 4, "profile": body["profile"]}
                outer.tasks[task_id] = {"polls": 0, "mode": mode, "final": final}
                self.reply(200, {"status": "queued", "tasks": [{"session_id": task_id, "status": "queued"}]})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    fake = FakeArtemis()
    with tempfile.TemporaryDirectory(prefix="tether-artemis-") as tmp_name:
        tmp = Path(tmp_name)
        os.environ.update({
            "TETHER_ADB": str(HERE / "fake_adb.py"),
            "TETHER_FAKE_LOG": str(tmp / "adb.log"),
            "TETHER_FAKE_STATE": str(tmp / "state.txt"),
            "ARTEMIS_BASE_URL": fake.url,
            "ARTEMIS_TOKEN": TOKEN,
        })
        os.environ.pop("TETHER_AI_ENGINE", None)

        import artemis
        from adb import Adb
        from flows import FlowError, run_flow, validate_flow

        adb = Adb()
        serial = "emulator-5554"

        print("client protocol")
        client = artemis.ArtemisClient()
        check(client.devices()[0]["serial"] == serial, "GET /api/devices")
        result = client.run("Open Settings", poll_s=0.05, profile="pro", device_serial=serial,
                            locked_app_package="com.android.settings")
        sent = fake.runs[-1]
        check(sent["goal"] == "Open Settings" and sent["profile"] == "pro" and sent["ingress"] == "tether"
              and sent["device_serial"] == serial and sent["locked_app_package"] == "com.android.settings"
              and str(uuid.UUID(sent["session_id"])) == sent["session_id"],
              "POST /api/run carries goal, profile, uuid session_id, device and locked package")
        check(all(a == f"Bearer {TOKEN}" for a in fake.auth), "ARTEMIS_TOKEN sent as Bearer on every call")
        check(result["succeeded"] and result["output"] == "Signed in; dashboard visible" and result["turns"] == 4,
              "waits through 404 + /api/status queue to the terminal state; summary/current_turn mapped")
        try:
            client.submit("x", profile="ultra")
            check(False, "bad profile rejected before sending")
        except artemis.ArtemisError:
            check(True, "bad profile rejected before sending")

        print("flow steps (engine: artemis)")
        report = run_flow(adb, serial, {"steps": [
            {"action": "ai", "engine": "artemis", "goal": "Sign in as qa@example.com", "profile": "flash",
             "app": "com.demo.app"}]})
        step = report["steps"][0]
        check(report["passed"] and step["ai"]["engine"] == "artemis" and step["ai"]["task_id"]
              and fake.runs[-1]["locked_app_package"] == "com.demo.app", "ai step runs on ARTEMIS and passes")
        report = run_flow(adb, serial, {"steps": [{"action": "ai", "engine": "artemis", "goal": "BROKEN app"}]})
        check(not report["passed"] and "app crashed on launch" in report["steps"][0]["error"],
              "failed ARTEMIS task fails the step with its error")
        report = run_flow(adb, serial, {"steps": [{"action": "ai", "engine": "artemis", "goal": "REJECT me"}]})
        check(not report["passed"] and "rejected" in report["steps"][0]["error"]
              and "device busy" in report["steps"][0]["error"], "rejected task surfaces the reason")
        report = run_flow(adb, serial, {"steps": [{"action": "ai", "engine": "artemis", "goal": "SLOW task",
                                                   "timeout_s": 2}]})
        check(not report["passed"] and "did not finish" in report["steps"][0]["error"]
              and fake.stops, "timeout stops the remote task (POST /api/stop)")

        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "engine": "artemis",
                                                   "condition": "the balance is shown"}]})
        check(report["passed"] and "12.50 EUR" in report["steps"][0]["ai"]["reason"]
              and "Do not tap" in fake.runs[-1]["goal"] and fake.runs[-1].get("enable_outputter") is True,
              "ai_assert: read-only goal + expected output; PASS passes")
        report = run_flow(adb, serial, {"steps": [{"action": "ai_assert", "engine": "artemis",
                                                   "condition": "a missing label is shown"}]})
        check(not report["passed"] and "no such text" in report["steps"][0]["error"], "ai_assert: FAIL fails")

        os.environ["TETHER_AI_ENGINE"] = "artemis"
        before = len(fake.runs)
        report = run_flow(adb, serial, {"steps": [{"action": "ai", "goal": "Open the app"}]})
        check(report["passed"] and len(fake.runs) == before + 1, "TETHER_AI_ENGINE=artemis makes it the default")
        os.environ.pop("TETHER_AI_ENGINE")

        for bad, label in (({"action": "ai", "goal": "x", "engine": "gpt"}, "unknown engine"),
                           ({"action": "ai", "goal": "x", "engine": "artemis", "profile": "max"}, "unknown profile"),
                           ({"action": "ai", "goal": "x", "timeout_s": 0}, "timeout_s 0")):
            try:
                validate_flow({"steps": [bad]})
                check(False, f"validation: {label}")
            except FlowError:
                check(True, f"validation: {label}")

        os.environ["ARTEMIS_BASE_URL"] = "http://127.0.0.1:9"
        report = run_flow(adb, serial, {"steps": [{"action": "ai", "engine": "artemis", "goal": "x"}]})
        check(not report["passed"] and "cannot reach ARTEMIS" in report["steps"][0]["error"],
              "unreachable daemon explains how to start it")
        os.environ["ARTEMIS_BASE_URL"] = fake.url

        print("through Tether's HTTP API + the skills CLI")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        env = dict(os.environ, TETHER_QUIET="1")
        server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port),
                                   "--token", "cli-token", "--no-browser"], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=FLAGS)
        try:
            for _ in range(100):
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                        break
                except OSError:
                    time.sleep(0.1)
            cli = HERE.parent.parent / "plugin" / "skills" / "tether-android-qa" / "scripts" / "pushlab_cli.py"
            cli_env = dict(env, TETHER_URL=f"http://127.0.0.1:{port}", TETHER_TOKEN="cli-token")
            proc = subprocess.run([sys.executable, str(cli), "ai", "Sign in as qa", "--engine", "artemis",
                                   "--profile", "pro"], env=cli_env, capture_output=True, text=True, timeout=120,
                                  creationflags=FLAGS)
            out = json.loads(proc.stdout or "{}")
            check(proc.returncode == 0 and out.get("ai", {}).get("engine") == "artemis"
                  and fake.runs[-1]["profile"] == "pro", "pushlab_cli.py ai --engine artemis --profile pro")
            proc = subprocess.run([sys.executable, str(cli), "ai", "a missing label is shown", "--check",
                                   "--engine", "artemis"], env=cli_env, capture_output=True, text=True, timeout=120,
                                  creationflags=FLAGS)
            check(proc.returncode == 1 and "no such text" in proc.stdout, "pushlab_cli.py ai --check exits 1 on FAIL")
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
    fake.server.shutdown()
    print(f"\n{PASSES} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  - " + failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
