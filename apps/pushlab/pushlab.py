"""Push Lab — Beacon + Tether, already linked, in one command.

  python apps/pushlab/pushlab.py    (or double-click apps/pushlab/start-push-lab.bat)

First run creates a local Beacon with a "Push Lab" app and remembers its keys
in apps/pushlab/.pushlab/ (git-ignored). Then it starts Tether linked to it and opens
both in your browser, signed in. Plug in a phone (or use Wi-Fi pairing), click
"Connect this phone to Beacon" in Tether's Push tab, and you can test pushes.

Ctrl+C stops both.
"""

from __future__ import annotations

import argparse
import json
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent  # apps/ (beacon/ and tether/ live next to pushlab/)
LAB_DIR = HERE / ".pushlab"
CONFIG = LAB_DIR / "lab.json"
DIRECT = urllib.request.build_opener(urllib.request.ProxyHandler({}))
APP_NAME = "Push Lab"


def call(base: str, method: str, path: str, token: str, body: dict | None = None) -> dict:
    request = urllib.request.Request(
        base + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with DIRECT.open(request, timeout=15) as response:
        return json.loads(response.read())


def wait_ready(url: str, seconds: float = 20) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            DIRECT.open(url, timeout=1).read()
            return
        except urllib.error.HTTPError:
            return  # it answered (401 etc.) — it's up
        except OSError:
            time.sleep(0.25)
    raise RuntimeError(f"{url} did not come up")


def load_config() -> dict:
    if CONFIG.exists():
        return json.loads(CONFIG.read_text(encoding="utf-8"))
    return {}


def save_config(config: dict) -> None:
    LAB_DIR.mkdir(exist_ok=True)
    CONFIG.write_text(json.dumps(config, indent=2), encoding="utf-8")


def ensure_app(beacon: str, config: dict) -> None:
    """Make sure the Push Lab app exists and the stored secret works."""
    admin = config["admin_token"]
    apps = call(beacon, "GET", "/v1/apps", admin)["apps"]
    app = next((a for a in apps if a["id"] == config.get("app_id")), None)
    if app is None:
        created = call(beacon, "POST", "/v1/apps", admin,
                       {"name": APP_NAME, "subject": "mailto:pushlab@localhost"})
        config["app_id"] = created["app"]["id"]
        config["secret"] = created["secret_key"]
        return
    try:
        call(beacon, "GET", "/v1/app", config.get("secret", ""))
    except urllib.error.HTTPError:
        config["secret"] = call(beacon, "POST", f"/v1/apps/{app['id']}/rotate-secret", admin, {})["secret_key"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Start Beacon + Tether, linked.")
    parser.add_argument("--beacon-port", type=int, default=8780)
    parser.add_argument("--tether-port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    config = load_config()
    config.setdefault("admin_token", "adm_" + secrets.token_urlsafe(24))
    config.setdefault("tether_token", secrets.token_urlsafe(18))
    LAB_DIR.mkdir(exist_ok=True)
    (LAB_DIR / ".gitignore").write_text("*\n", encoding="utf-8")

    beacon_url = f"http://127.0.0.1:{args.beacon_port}"
    tether_url = f"http://127.0.0.1:{args.tether_port}"
    processes = []
    try:
        processes.append(subprocess.Popen([
            sys.executable, str(ROOT / "beacon" / "server" / "server.py"),
            "--port", str(args.beacon_port),
            "--data", str(LAB_DIR / "beacon.db"),
            "--admin-token", config["admin_token"],
        ]))
        wait_ready(beacon_url + "/v1/health")
        ensure_app(beacon_url, config)
        config["beacon_url"] = beacon_url
        config["tether_url"] = tether_url  # read by plugin/skills/*/scripts/pushlab_cli.py
        save_config(config)

        processes.append(subprocess.Popen([
            sys.executable, str(ROOT / "tether" / "server" / "server.py"),
            "--port", str(args.tether_port),
            "--token", config["tether_token"],
            "--no-browser",
            "--beacon-url", beacon_url,
            "--beacon-key", config["secret"],
        ]))
        wait_ready(tether_url + "/")

        console = f"{beacon_url}/#token={config['admin_token']}"
        tether = f"{tether_url}/#token={config['tether_token']}"
        print("\n  Push Lab is running")
        print(f"    Beacon console : {beacon_url}   (app '{APP_NAME}', id {config['app_id']})")
        print(f"    Tether         : {tether_url}")
        print("    Next: plug in a phone (or use Wi-Fi in Tether) -> Push tab -> 'Connect this phone to Beacon'")
        print("    Ctrl+C stops both.\n")
        sys.stdout.flush()
        if not args.no_browser:
            webbrowser.open(console)
            webbrowser.open(tether)
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


if __name__ == "__main__":
    sys.exit(main())
