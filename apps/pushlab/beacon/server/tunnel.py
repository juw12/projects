"""One-click public HTTPS for Beacon with Cloudflare quick tunnels.

Uses cloudflared (https://github.com/cloudflare/cloudflared, Apache-2.0):
`cloudflared tunnel --url http://127.0.0.1:PORT` prints a random
https://<words>.trycloudflare.com address that forwards to this machine — no
account, no DNS, no router setup. Phones anywhere can then open the /try/
page and subscribe (Web Push needs https), and senders can reach /v1/send.

Quick tunnels are for testing (no uptime guarantee). For production use a
named tunnel or a real deployment (docs/DEPLOY.md).

cloudflared is downloaded on demand into apps/pushlab/beacon/tools (BEACON_TOOLS_DIR),
or taken from BEACON_CLOUDFLARED / PATH.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.request
from collections import deque
from pathlib import Path

RELEASE_BASE = "https://github.com/cloudflare/cloudflared/releases/latest/download/"
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
READY_MARKERS = ("Registered tunnel connection", "Connection registered")
MIN_BINARY_BYTES = 5 * 1024 * 1024


class TunnelError(RuntimeError):
    pass


def tools_dir() -> Path:
    configured = os.environ.get("BEACON_TOOLS_DIR")
    return Path(configured) if configured else Path(__file__).resolve().parent.parent / "tools"


def binary_name() -> str:
    return "cloudflared.exe" if os.name == "nt" else "cloudflared"


def find_cloudflared() -> str | None:
    """BEACON_CLOUDFLARED (may be a .py fake for tests), then tools/, then PATH."""
    override = os.environ.get("BEACON_CLOUDFLARED")
    if override:
        return override if Path(override).exists() else None
    bundled = tools_dir() / binary_name()
    if bundled.exists():
        return str(bundled)
    return shutil.which("cloudflared")


def asset_name() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64",
            "armv7l": "arm", "i386": "386", "i686": "386", "x86": "386"}.get(machine, "amd64")
    if system == "windows":
        return f"cloudflared-windows-{'386' if arch == '386' else 'amd64'}.exe"
    if system == "darwin":
        return f"cloudflared-darwin-{'arm64' if arch == 'arm64' else 'amd64'}.tgz"
    return f"cloudflared-linux-{arch}"


def install(progress=None) -> Path:
    """Download cloudflared into tools/ (honours the system / env proxy)."""
    url = os.environ.get("BEACON_CLOUDFLARED_URL") or RELEASE_BASE + asset_name()
    target_dir = tools_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / binary_name()
    handle, temp_name = tempfile.mkstemp(prefix="cloudflared-", dir=target_dir)
    os.close(handle)
    temp = Path(temp_name)
    try:
        try:
            with urllib.request.urlopen(url, timeout=60) as response, open(temp, "wb") as out:
                total = int(response.headers.get("Content-Length") or 0)
                done = 0
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    done += len(chunk)
                    if progress:
                        progress(done, total)
        except OSError as exc:
            raise TunnelError(f"could not download cloudflared from {url}: {exc}") from exc
        if url.endswith(".tgz"):
            with tarfile.open(temp) as archive:
                member = next((m for m in archive.getmembers() if m.name.endswith("cloudflared")), None)
                if member is None:
                    raise TunnelError("cloudflared archive did not contain the binary")
                extracted = archive.extractfile(member)
                temp.write_bytes(extracted.read())
        if temp.stat().st_size < MIN_BINARY_BYTES and not os.environ.get("BEACON_CLOUDFLARED_URL"):
            raise TunnelError("downloaded cloudflared looks truncated — try again")
        os.replace(temp, target)
        target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        return target
    finally:
        if temp.exists():
            temp.unlink()


def diagnose(log: list[str]) -> str:
    """Turn cloudflared's log into a human explanation."""
    text = "\n".join(log)
    if "failed to request quick Tunnel" in text or "api.trycloudflare.com" in text and "forcibly closed" in text:
        return ("This network blocks direct connections to Cloudflare (typical behind a corporate firewall or "
                "proxy — quick tunnels cannot use an HTTP proxy). Try from another network, or deploy Beacon "
                "(see docs/DEPLOY.md).")
    if "429" in text or "Too Many Requests" in text:
        return "Cloudflare rate-limited quick tunnel creation — wait a minute and try again."
    if "failed to dial" in text or "edge" in text.lower() and "unreachable" in text.lower():
        return "cloudflared got a URL but cannot reach Cloudflare's edge (ports 7844 TCP/UDP blocked?)."
    tail = [line for line in log if " ERR " in line or "error" in line.lower()]
    return (tail[-1] if tail else (log[-1] if log else "cloudflared exited")).strip()[:300]


class Tunnel:
    """Runs one quick tunnel for a local port and reports its state."""

    def __init__(self, on_change=None):
        self.on_change = on_change  # called with (url | None) when the public URL appears / goes away
        self.process: subprocess.Popen | None = None
        self.state = "stopped"  # stopped | installing | starting | live | error
        self.url: str | None = None
        self.error = ""
        self.started_at: float | None = None
        self.log: deque[str] = deque(maxlen=200)
        self.lock = threading.Lock()

    # ------------------------------------------------------------- status
    def status(self) -> dict:
        return {
            "state": self.state,
            "url": self.url,
            "error": self.error,
            "installed": find_cloudflared() is not None,
            "since": self.started_at,
            "log": list(self.log)[-12:],
        }

    def _set(self, state: str, url: str | None = None, error: str = "") -> None:
        previous_url = self.url
        self.state, self.url, self.error = state, url, error
        if self.on_change and url != previous_url:
            try:
                self.on_change(url)
            except Exception:  # never let a callback kill the tunnel thread
                pass

    # ---------------------------------------------------------- lifecycle
    def start(self, port: int, install_if_missing: bool = True, protocol: str = "auto") -> dict:
        with self.lock:
            if self.state in ("installing", "starting", "live"):
                return self.status()
            self.log.clear()
            self._set("installing" if find_cloudflared() is None else "starting")
            self.started_at = time.time()
        threading.Thread(target=self._run, args=(port, install_if_missing, protocol), daemon=True,
                         name="beacon-tunnel").start()
        return self.status()

    def _command(self, binary: str, port: int, protocol: str) -> list[str]:
        command = [binary, "tunnel", "--no-autoupdate"]
        if protocol in ("http2", "quic"):
            command += ["--protocol", protocol]
        command += ["--url", f"http://127.0.0.1:{port}"]
        if binary.endswith(".py"):
            command.insert(0, sys.executable)
        return command

    def _run(self, port: int, install_if_missing: bool, protocol: str) -> None:
        binary = find_cloudflared()
        if binary is None:
            if not install_if_missing:
                self._set("error", error="cloudflared is not installed")
                return
            try:
                self.log.append("downloading cloudflared …")
                binary = str(install())
                self.log.append(f"installed {binary}")
            except TunnelError as exc:
                self._set("error", error=str(exc))
                return
            self.state = "starting"
        flags = 0
        if os.name == "nt":
            flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
        try:
            process = subprocess.Popen(
                self._command(binary, port, protocol), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL, text=True, encoding="utf-8", errors="replace", creationflags=flags,
            )
        except OSError as exc:
            self._set("error", error=f"could not start cloudflared: {exc}")
            return
        self.process = process
        candidate = None
        for raw in process.stdout:
            line = raw.rstrip()
            self.log.append(line)
            found = URL_RE.search(line)
            if found and found.group(0) != "https://api.trycloudflare.com":
                candidate = found.group(0)
            if candidate and (any(marker in line for marker in READY_MARKERS)) and self.state != "live":
                self._set("live", url=candidate)
        code = process.wait()
        if self.state == "stopped":  # stop() requested
            return
        self._set("error", error=diagnose(list(self.log)) + f" (cloudflared exit {code})")

    def stop(self) -> dict:
        with self.lock:
            process = self.process
            self.process = None
            self._set("stopped")
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        return self.status()
