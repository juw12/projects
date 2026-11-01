"""Hermetic tests for Beacon's "Go live" Cloudflare quick tunnel (tunnel.py + endpoints).

  python apps/pushlab/beacon/tests/verify_tunnel.py
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER_DIR = HERE.parent / "server"
sys.path.insert(0, str(SERVER_DIR))

import tunnel  # noqa: E402

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ADMIN = "adm_tunnel_test"
FAKE_URL = "https://fuzzy-pickle-test-lab.trycloudflare.com"
FAILURES: list[str] = []
PASSED = 0


def check(condition, label):
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ok   {label}")
    else:
        FAILURES.append(label)
        print(f"  FAIL {label}")


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def call(port, method, path, body=None, token=ADMIN, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    try:
        with OPENER.open(request, timeout=15) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def wait_state(port, wanted, timeout=20):
    deadline = time.time() + timeout
    status = {}
    while time.time() < deadline:
        _, data = call(port, "GET", "/v1/tunnel")
        status = data.get("tunnel", {})
        if status.get("state") in wanted:
            return status
        time.sleep(0.2)
    return status


def unit_tests() -> None:
    print("tunnel.py")
    blocked = ['failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": read tcp ... '
               "wsarecv: An existing connection was forcibly closed by the remote host."]
    check("corporate firewall" in tunnel.diagnose(blocked), "blocked network explained in plain words")
    check("rate-limited" in tunnel.diagnose(["ERR 429 Too Many Requests"]), "rate limit explained")
    check(tunnel.URL_RE.search("Visit it at https://a-b-c.trycloudflare.com ").group(0) == "https://a-b-c.trycloudflare.com",
          "public URL parsed from the banner")
    names = {tunnel.asset_name()}
    check(any(n.startswith("cloudflared-") for n in names), f"release asset for this platform ({names.pop()})")

    print("one-click install")
    payload = b"#!fake cloudflared binary\n" * 100

    class Release(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    release = ThreadingHTTPServer(("127.0.0.1", 0), Release)
    threading.Thread(target=release.serve_forever, daemon=True).start()
    tools = Path(tempfile.mkdtemp(prefix="beacon-tools-"))
    saved = {k: os.environ.get(k) for k in ("BEACON_TOOLS_DIR", "BEACON_CLOUDFLARED_URL", "BEACON_CLOUDFLARED")}
    os.environ["BEACON_TOOLS_DIR"] = str(tools)
    os.environ["BEACON_CLOUDFLARED_URL"] = f"http://127.0.0.1:{release.server_address[1]}/cloudflared"
    os.environ.pop("BEACON_CLOUDFLARED", None)
    try:
        seen = []
        path = tunnel.install(progress=lambda done, total: seen.append((done, total)))
        check(path.read_bytes() == payload and path.parent == tools, "downloaded into BEACON_TOOLS_DIR")
        check(seen and seen[-1][0] == len(payload), "progress reported")
        check(tunnel.find_cloudflared() == str(path), "installed binary is found next time")
        check(not list(tools.glob("cloudflared-*")), "no temp files left behind")
        os.environ["BEACON_CLOUDFLARED_URL"] = "http://127.0.0.1:9/nothing"
        try:
            tunnel.install()
            check(False, "download failure raises TunnelError")
        except tunnel.TunnelError as exc:
            check("could not download" in str(exc), "download failure raises TunnelError")
    finally:
        release.shutdown()
        shutil.rmtree(tools, ignore_errors=True)
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def server_tests(mode: str) -> None:
    print(f"server ({mode})")
    work = Path(tempfile.mkdtemp(prefix="beacon-tunnel-"))
    port = free_port()
    env = dict(os.environ, BEACON_QUIET="1", BEACON_CLOUDFLARED=str(HERE / "fake_cloudflared.py"),
               FAKE_CF_MODE=mode, BEACON_RATE_PER_MINUTE="5", PYTHONIOENCODING="utf-8")
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW) if os.name == "nt" else 0
    server = subprocess.Popen([sys.executable, str(SERVER_DIR / "server.py"), "--port", str(port), "--data",
                               str(work / "b.db"), "--admin-token", ADMIN], env=env, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, creationflags=flags)
    try:
        for _ in range(100):
            try:
                call(port, "GET", "/v1/health", token=None)
                break
            except OSError:
                time.sleep(0.1)
        if mode == "blocked":
            call(port, "POST", "/v1/tunnel/start", {})
            status = wait_state(port, {"error"})
            check(status.get("state") == "error" and "corporate firewall" in status.get("error", ""),
                  "blocked network → error state with explanation")
            check(any("failed to request quick Tunnel" in line for line in status.get("log", [])),
                  "cloudflared log kept for the console")
            return

        check(call(port, "GET", "/v1/tunnel", token=None)[0] == 401, "tunnel endpoints are admin-only")
        _, created = call(port, "POST", "/v1/apps", {"name": "Live"})
        sender = created["secret_key"]
        check(call(port, "POST", "/v1/tunnel/start", {}, token=sender)[0] == 401, "app secret cannot open a tunnel")
        check(call(port, "POST", "/v1/tunnel/start", {"protocol": "carrier-pigeon"})[0] == 400, "bad protocol refused")
        status, data = call(port, "POST", "/v1/tunnel/start", {})
        check(status == 202 and data["tunnel"]["state"] in ("starting", "live"), "start → 202 starting")
        live = wait_state(port, {"live", "error"})
        check(live.get("state") == "live" and live.get("url") == FAKE_URL, "goes live with the trycloudflare URL")
        _, apps = call(port, "GET", "/v1/apps")
        check(apps.get("public_url") == FAKE_URL, "public URL switched at runtime")
        _, again = call(port, "POST", "/v1/tunnel/start", {})
        check(again["tunnel"]["state"] == "live", "second start is a no-op while live")

        call(port, "POST", "/v1/send", {"title": "Tunnel inbox", "channels": ["inapp"]}, token=sender)
        time.sleep(1.5)
        _, inbox = call(port, "GET", f"/v1/inbox?app_key={created['app']['app_key']}", token=None,
                        headers={"CF-Connecting-IP": "203.0.113.9"})
        items = inbox.get("messages", [])
        check(items and items[0].get("beacon") == FAKE_URL, "payloads point at the public URL (click tracking)")

        codes_a = [call(port, "GET", "/v1/health", token=None, headers={"CF-Connecting-IP": "198.51.100.1"})[0]
                   for _ in range(6)]
        code_b = call(port, "GET", "/v1/health", token=None, headers={"CF-Connecting-IP": "198.51.100.2"})[0]
        check(codes_a[-1] == 429 and code_b == 200, "rate limit per real visitor IP (CF-Connecting-IP)")

        status, stopped = call(port, "POST", "/v1/tunnel/stop")
        check(stopped["tunnel"]["state"] == "stopped" and stopped["public_url"].startswith("http://127.0.0.1"),
              "stop restores the local URL")
        codes_c = [call(port, "GET", "/v1/health", token=None, headers={"CF-Connecting-IP": f"192.0.2.{n}"})[0]
                   for n in range(7)]
        check(429 in codes_c, "CF-Connecting-IP ignored once the tunnel is down (no spoofing)")
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    unit_tests()
    server_tests("ok")
    server_tests("blocked")
    print(f"\n{PASSED} passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  -", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
