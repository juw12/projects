#!/usr/bin/env python3
"""Hermetic end-to-end test for photo2cad.

Runs the stdlib server with PHOTO2CAD_FAKE_LLM=1 (no network), POSTs a tiny PRD,
and asserts a valid STEP file is produced and served.

IMPORTANT: run with a Python that has cadquery installed:
    & "%USERPROFILE%\\Documents\\Default Project\\.venv3d\\Scripts\\python.exe" tests/verify_api.py

Exits 0 on success, 1 on failure.
"""
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import urllib.request

APP = pathlib.Path(__file__).resolve().parents[1]
SERVER = APP / "server" / "server.py"
ARTIFACTS = APP / ".artifacts"


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def post_json(url, obj, timeout=300):
    data = json.dumps(obj).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())


def get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read()


def main():
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    env = dict(os.environ, PHOTO2CAD_FAKE_LLM="1", PHOTO2CAD_ARTIFACTS=str(ARTIFACTS))
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--port", str(port)],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        healthy = False
        for _ in range(80):
            try:
                if get(base + "/api/health", timeout=5)[0] == 200:
                    healthy = True
                    break
            except Exception:
                time.sleep(0.5)
        assert healthy, "server did not become healthy on %s" % base

        st, res = post_json(base + "/api/generate", {
            "prd": "A 40 x 30 x 20 mm bracket with rounded vertical corners.",
            "units": "mm",
        })
        assert st == 200, "generate HTTP status %s" % st
        assert res.get("ok") is True, "generate not ok: %s" % res
        report = res["report"]
        assert report.get("valid") is True, "report not valid: %s" % report
        assert report.get("solids") == 1, "expected 1 solid: %s" % report

        step_bytes = get(base + res["step_url"])[1]
        assert step_bytes.startswith(b"ISO-10303-21;"), "STEP header missing"

        stl_bytes = get(base + res["stl_url"])[1]
        assert len(stl_bytes) > 0, "empty STL"

        print("PASS verify_api:", json.dumps(report))
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()


if __name__ == "__main__":
    try:
        import cadquery  # noqa: F401
    except Exception:  # noqa: BLE001 - optional dependency
        print("SKIP verify_api (cadquery not installed; run with the .venv3d python)")
        sys.exit(0)
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - test harness
        print("FAIL verify_api:", exc)
        sys.exit(1)
