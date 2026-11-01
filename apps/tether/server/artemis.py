"""ARTEMIS engine for Tether AI steps (optional).

google/artemis (Apache-2.0) turns natural-language goals into Android
automation with a Flash (fast, reactive) and a Pro (plan -> act -> verify)
agent, and reports 99%+ on Google Research's AndroidWorld benchmark. It runs
as its own daemon (`uv run artemis` / start.bat, default http://127.0.0.1:8000)
with its own model keys; Tether only submits tasks to it over HTTP, so Tether
stays dependency-free.

This is a standard-library port of the official `artemis-client` protocol
(packages/artemis-client in the ARTEMIS repo):

  POST /api/run              {goal, profile, session_id, ingress, device_serial, ...}
                             -> {status, tasks: [{session_id, status, ...}]}
  GET  /api/sessions/{id}    -> task state (404 while still queued)
  GET  /api/status           -> scheduler: {queue: [...], active_tasks: [...]}
  POST /api/stop             {session_id}
  GET  /api/devices          -> {devices: [{serial, state, ...}]}

  ARTEMIS_BASE_URL  default http://127.0.0.1:8000
  ARTEMIS_TOKEN     sent as Authorization: Bearer, if the daemon needs one
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from adb import AdbError

TERMINAL = {"completed", "success", "failed", "cancelled", "canceled", "rejected"}
SUCCESS = {"completed", "success"}
PROFILES = ("flash", "pro")
VERIFICATION_LEVELS = ("off", "final", "checkpoints", "strict")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}

ASSERT_GOAL = ("Do not tap, type or navigate: only look at the current screen. Check whether this is true: "
               "{condition}. Finish by answering PASS or FAIL followed by one sentence explaining what you saw.")


class ArtemisError(AdbError):
    """ARTEMIS rejected, failed or could not be reached (an AdbError so flows report it as a step failure)."""


class ArtemisClient:
    def __init__(self, base_url: str | None = None, token: str | None = None, request_timeout: float = 30.0):
        self.base_url = (base_url or os.environ.get("ARTEMIS_BASE_URL") or "http://127.0.0.1:8000").rstrip("/")
        self.token = token if token is not None else os.environ.get("ARTEMIS_TOKEN", "")
        self.request_timeout = request_timeout
        host = urllib.parse.urlparse(self.base_url).hostname or ""
        handlers = [urllib.request.ProxyHandler({})] if host in LOCAL_HOSTS else []
        self.opener = urllib.request.build_opener(*handlers)

    # ------------------------------------------------------------ transport
    def request(self, method: str, path: str, body: dict | None = None):
        headers = {"Accept": "application/json"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=self.request_timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read()[:300].decode("utf-8", "replace")
            if exc.code == 404:
                raise LookupError(path) from None
            raise ArtemisError(f"ARTEMIS {method} {path} answered {exc.code}: {detail}") from None
        except OSError as exc:
            raise ArtemisError(f"cannot reach ARTEMIS at {self.base_url} ({exc}); start it with start.bat / "
                               "`uv run artemis` or set ARTEMIS_BASE_URL") from None
        try:
            return json.loads(raw or b"{}")
        except ValueError:
            raise ArtemisError(f"ARTEMIS {path} did not answer with JSON") from None

    # ----------------------------------------------------------------- API
    def devices(self) -> list[dict]:
        payload = self.request("GET", "/api/devices")
        devices = payload.get("devices", []) if isinstance(payload, dict) else payload
        if not isinstance(devices, list):
            raise ArtemisError("ARTEMIS /api/devices did not return a device list")
        return devices

    def submit(self, goal: str, profile: str = "flash", device_serial: str | None = None,
               expected_output: str | None = None, locked_app_package: str | None = None,
               verification_level: str | None = None) -> str:
        goal = (goal or "").strip()
        if not goal:
            raise ArtemisError("ARTEMIS needs a goal")
        if profile not in PROFILES:
            raise ArtemisError(f"profile must be one of {', '.join(PROFILES)}")
        if verification_level is not None and verification_level not in VERIFICATION_LEVELS:
            raise ArtemisError(f"verification_level must be one of {', '.join(VERIFICATION_LEVELS)}")
        task_id = str(uuid.uuid4())
        body = {"goal": goal, "profile": profile, "session_id": task_id, "ingress": "tether"}
        optional = {
            "device_serial": device_serial,
            "expected_output": expected_output,
            "enable_outputter": True if expected_output else None,
            "locked_app_package": locked_app_package,
            "verification_level": verification_level,
        }
        body.update({key: value for key, value in optional.items() if value is not None})
        response = self.request("POST", "/api/run", body)
        if not isinstance(response, dict):
            raise ArtemisError("ARTEMIS /api/run did not return an object")
        tasks = response.get("tasks")
        if str(response.get("status", "")).lower() == "rejected" or (isinstance(tasks, list) and not tasks):
            raise ArtemisError(f"ARTEMIS rejected the task: {response.get('error') or 'no reason given'}")
        if not isinstance(tasks, list) or not isinstance(tasks[0], dict):
            raise ArtemisError("ARTEMIS /api/run did not admit a task")
        return str(tasks[0].get("session_id") or tasks[0].get("task_id") or task_id)

    def get(self, task_id: str) -> dict:
        try:
            return self.request("GET", f"/api/sessions/{task_id}")
        except LookupError:
            pass
        try:
            scheduler = self.request("GET", "/api/status")
        except LookupError:
            scheduler = {}
        for name in ("queue", "active_tasks"):
            for item in scheduler.get(name) or []:
                if isinstance(item, dict) and str(item.get("task_id") or item.get("session_id")) == task_id:
                    return item
        return {"status": "launching"}

    def stop(self, task_id: str) -> None:
        try:
            self.request("POST", "/api/stop", {"session_id": task_id})
        except (ArtemisError, LookupError):
            pass

    def run(self, goal: str, timeout_s: float = 600, poll_s: float = 1.0, **options) -> dict:
        task_id = self.submit(goal, **options)
        deadline = time.monotonic() + timeout_s
        while True:
            state = self.get(task_id)
            status = str(state.get("status") or "unknown").lower()
            if status in TERMINAL:
                return summarize(task_id, state)
            if time.monotonic() > deadline:
                self.stop(task_id)
                raise ArtemisError(f"ARTEMIS task {task_id} did not finish within {timeout_s:.0f} s (stopped)")
            time.sleep(poll_s)


def summarize(task_id: str, state: dict) -> dict:
    output = state.get("output")
    if output is None:
        output = state.get("result")
    if output is None:
        output = state.get("summary")
    return {
        "engine": "artemis",
        "task_id": task_id,
        "status": str(state.get("status")).lower(),
        "succeeded": str(state.get("status")).lower() in SUCCESS,
        "output": output,
        "error": state.get("error") or state.get("error_message"),
        "turns": state.get("turns") or state.get("current_turn"),
    }


def _output_text(output) -> str:
    return output if isinstance(output, str) else json.dumps(output, ensure_ascii=False) if output is not None else ""


def act(serial: str, goal: str, profile: str = "flash", app: str | None = None,
        expected_output: str | None = None, timeout_s: float = 600, client: ArtemisClient | None = None) -> dict:
    """Flow step `ai` with engine=artemis: ARTEMIS drives the device until the goal is done."""
    result = (client or ArtemisClient()).run(goal, timeout_s=timeout_s, profile=profile, device_serial=serial,
                                             locked_app_package=app, expected_output=expected_output)
    if not result["succeeded"]:
        raise ArtemisError(f"ARTEMIS task {result['status']}: {result['error'] or _output_text(result['output']) or 'no reason'}")
    result["goal"] = goal
    return result


def check(serial: str, condition: str, profile: str = "flash", timeout_s: float = 300,
          client: ArtemisClient | None = None) -> dict:
    """Flow step `ai_assert` with engine=artemis: ARTEMIS looks, answers PASS/FAIL."""
    result = (client or ArtemisClient()).run(ASSERT_GOAL.format(condition=condition), timeout_s=timeout_s,
                                             profile=profile, device_serial=serial,
                                             expected_output="PASS or FAIL, then one sentence of evidence")
    text = _output_text(result["output"]).strip()
    if not result["succeeded"]:
        raise ArtemisError(f"ARTEMIS could not check the screen ({result['status']}): {result['error'] or text}")
    verdict = text.upper()
    if "PASS" in verdict and "FAIL" not in verdict:
        return {"engine": "artemis", "condition": condition, "reason": text, "task_id": result["task_id"]}
    raise ArtemisError(f"AI assertion failed (ARTEMIS): {text or 'no verdict returned'}")
