#!/usr/bin/env python3
"""Hermetic test for Twin's in-app updates (stdlib only, no network).

1. Release notes, service worker, both apps and the server agree on the version; the worker waits for
   the page's Update tap (TWIN_SKIP_WAITING), tells pages its version (TWIN_VERSION) and never caches
   release.json.
2. scripts/build_bundle.py builds the local-install bundle deterministically, without tests or data.
3. Server helpers: version parsing, zip-slip refusal, and the status rules (newer, same, offline,
   git clone, switched off, no download).
4. End to end in a throwaway copy of Twin: the server finds a newer published release (file:// URL),
   refuses a tampered download without changing anything, then installs the real one for a signed-in
   user: it backs up the whole folder, copies the new files, keeps accounts and restarts as the new version.
Exits 0 on success, 1 on failure.
"""
import hashlib
import http.cookiejar
import importlib.util
import io
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
WEB = APP_DIR / "web"
FAILURES = []
NEW_VERSION = "9.9.9"


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"  [{status}] {name}" + (f" — {detail}" if detail and not condition else ""))
    if not condition:
        FAILURES.append(name)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        # Loopback only: never route through an HTTP(S)_PROXY from the environment.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                                  urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(self, path, body=None):
        request = urllib.request.Request(self.base + path, data=json.dumps(body or {}).encode(),
                                         headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=60) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read() or b"{}")

    def get(self, path):
        with self.opener.open(self.base + path, timeout=10) as response:
            return response.status, response.read()


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_version(app_dir):
    return re.search(r'^VERSION = "([^"]+)"', (app_dir / "server.py").read_text(encoding="utf-8"), re.M).group(1)


def static_checks():
    print("static: versions and the update handshake")
    version = source_version(APP_DIR)
    release = json.loads((WEB / "release.json").read_text(encoding="utf-8"))
    worker = (WEB / "sw.js").read_text(encoding="utf-8")
    index = (WEB / "index.html").read_text(encoding="utf-8")
    id_index = (WEB / "id" / "index.html").read_text(encoding="utf-8")
    id_app = (WEB / "id" / "app.js").read_text(encoding="utf-8")
    update_js = (WEB / "update.js").read_text(encoding="utf-8")
    check("release.json has the server's version", release.get("version") == version, f"{release.get('version')} vs {version}")
    check("release.json has a title and notes", bool(release.get("title")) and isinstance(release.get("notes"), list) and release["notes"])
    check("service worker has the same version", f'const VERSION = "{version}";' in worker)
    check("Twin and Twin Indonesia report the same version",
          f'const APP_VERSION = "{version}"' in index and f"const VERSION = '{version}'" in id_app)
    check("both apps load update.js at this version",
          f'src="update.js?v={version}"' in index and f'src="../update.js?v={version}"' in id_index)
    check("worker keeps update.js for offline use", f'"update.js?v={version}"' in worker)
    check("worker never caches release.json (notes always fresh)", "release.json" not in worker)
    check("worker waits for the Update tap",
          'type === "TWIN_SKIP_WAITING"' in worker and ".then(() => self.skipWaiting())" not in worker)
    check("worker tells pages its version", 'type === "TWIN_VERSION"' in worker and "postMessage({ version: VERSION })" in worker)
    check("older pages still update by themselves once", 'const PROMPT_SINCE = "1.14.0";' in worker)
    check("update.js sends the tap and asks versions", "TWIN_SKIP_WAITING" in update_js and "TWIN_VERSION" in update_js)
    catalog_path = APP_DIR.parent.parent / "scripts" / "apps.json"
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        apps = catalog if isinstance(catalog, list) else catalog.get("apps", [])
        twin = next((entry for entry in apps if entry.get("id") == "twin"), {})
        check("catalog lists this version", twin.get("version") == version and twin.get("links", {}).get("app") == f"twin/?v={version}")


def bundle_checks(work, builder):
    print("bundle: scripts/build_bundle.py")
    site = work / "site-current"
    target, first = builder.build(APP_DIR, site)
    _, again = builder.build(APP_DIR, site)
    check("same files give the same checksum", first["sha256"] == again["sha256"])
    data = target.read_bytes()
    check("release.json records the bundle's checksum and size",
          hashlib.sha256(data).hexdigest() == again["sha256"] and len(data) == again["size"])
    with zipfile.ZipFile(target) as archive:
        names = archive.namelist()
    check("bundle holds the server, the updater and the web app",
          {"twin/server.py", "twin/scripts/update_local.py", "twin/web/update.js", "twin/web/sw.js"} <= set(names))
    check("bundle leaves out tests, data and caches",
          not any(name.startswith(("twin/tests/", "twin/data/")) or "__pycache__" in name for name in names))


def unit_checks(work):
    print("unit: server update helpers")
    os.environ["TWIN_DATA"] = str(work / "unit-data")
    sys.path.insert(0, str(APP_DIR))
    import server  # noqa: E402  (imported after TWIN_DATA is set)

    check("versions compare numerically",
          server.version_tuple("1.10.0") > server.version_tuple("1.9.9") and server.version_tuple("1.2") is None)
    for index, bad in enumerate(("../evil.txt", "/evil.txt", "C:/evil.txt", "twin/../../evil.txt")):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(bad, "x")
        destination = work / f"slip-{index}" / "inner"
        destination.mkdir(parents=True)
        try:
            with zipfile.ZipFile(io.BytesIO(buffer.getvalue())) as archive:
                server.safe_extract(archive, destination)
            refused = False
        except server.AppError:
            refused = True
        check(f"unsafe path refused: {bad}", refused and not (work / f"slip-{index}" / "evil.txt").exists())

    newer = {"version": "99.0.0", "title": "Big one", "notes": ["One"],
             "bundle": {"url": "download/x.zip", "sha256": "0" * 64}}
    original_latest = server.latest_release
    original_git = server.git_checkout
    try:
        server.latest_release = lambda force=False: (newer, None)
        server.git_checkout = lambda: None
        status = server.update_status()
        check("a newer release is offered", status["available"] and status["can_install"]
              and status["latest"] == "99.0.0" and status["notes"] == ["One"], str(status))
        server.git_checkout = lambda: Path("/home/someone/projects")
        status = server.update_status()
        check("git clones are told to git pull", status["available"] and not status["can_install"]
              and "git pull" in (status["reason"] or ""), str(status))
        try:
            server.install_update("99.0.0")
            refused = False
        except server.AppError as error:
            refused = "git" in str(error)
        check("install refused for git clones (nothing downloaded)", refused)
        server.git_checkout = lambda: None
        server.SELF_UPDATE["enabled"] = False
        status = server.update_status()
        check("--no-self-update blocks installs", not status["can_install"] and "turned off" in (status["reason"] or ""))
        server.SELF_UPDATE["enabled"] = True
        server.latest_release = lambda force=False: (dict(newer, version=server.VERSION), None)
        check("the same version is not offered", not server.update_status()["available"])
        server.latest_release = lambda force=False: (None, "Couldn't reach the Twin release page (offline).")
        status = server.update_status()
        check("an offline check says why", not status["available"] and "Couldn't reach" in (status["reason"] or ""))
        server.latest_release = lambda force=False: ({"version": "99.0.0", "notes": []}, None)
        status = server.update_status()
        check("a release without a download is not installable", status["available"] and not status["can_install"])
    finally:
        server.latest_release = original_latest
        server.git_checkout = original_git


def copy_twin(destination, builder):
    for rel in builder.bundle_files(APP_DIR):
        target = destination / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP_DIR / rel, target)


def wait_for_version(client, version, timeout):
    deadline = time.time() + timeout
    seen = None
    while time.time() < deadline:
        try:
            _, body = client.get("/api/health")
            seen = json.loads(body).get("version")
            if seen == version:
                return seen
        except OSError:
            pass
        time.sleep(0.3)
    return seen


def stop_servers(proc, pid_file):
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text(encoding="utf-8").strip())
        except ValueError:
            pid = None
        if pid and pid != proc.pid:
            try:
                os.kill(pid, signal.SIGTERM)  # the restarted server (a new process on Windows)
            except OSError:
                pass


def end_to_end(work, builder):
    print("end-to-end: update a local install from the app")
    install = work / "install" / "twin"
    newer = work / "newer" / "twin"
    copy_twin(install, builder)
    copy_twin(newer, builder)
    current = source_version(APP_DIR)
    server_file = newer / "server.py"
    server_file.write_text(server_file.read_text(encoding="utf-8").replace(
        f'VERSION = "{current}"', f'VERSION = "{NEW_VERSION}"'), encoding="utf-8")
    release = json.loads((newer / "web" / "release.json").read_text(encoding="utf-8"))
    release.update(version=NEW_VERSION, title="Test release", notes=["Made by verify_update.py"])
    (newer / "web" / "release.json").write_text(json.dumps(release), encoding="utf-8")
    (newer / "web" / "NEW_IN_9.txt").write_text("a file that only the new version has", encoding="utf-8")
    site = work / "site"
    _, bundle = builder.build(newer, site)
    zip_path = site / bundle["url"]

    data_dir = work / "data"
    data_dir.mkdir()
    fake_news = data_dir / "fake-news.json"
    fake_news.write_text("{}", encoding="utf-8")
    fake_quotes = data_dir / "fake-quotes.json"
    fake_quotes.write_text(json.dumps({"quotes": {}, "fx_usd": {"IDR": 1 / 16290}}), encoding="utf-8")
    pid_file = work / "server.pid"
    port = free_port()
    env = dict(os.environ, TWIN_DATA=str(data_dir), TWIN_FAKE_NEWS=str(fake_news), TWIN_FAKE_QUOTES=str(fake_quotes),
               TWIN_UPDATE_URL=(site / "release.json").as_uri(), TWIN_PID_FILE=str(pid_file))
    env.pop("TWIN_SELF_UPDATE", None)
    env.pop("TWIN_RESTARTED", None)
    log = open(work / "server.log", "w", encoding="utf-8")
    proc = subprocess.Popen([sys.executable, str(install / "server.py"), "--port", str(port), "--no-browser"],
                            env=env, stdout=log, stderr=subprocess.STDOUT, cwd=str(work))
    base = f"http://127.0.0.1:{port}"
    client = Client(base)
    try:
        check("the installed copy starts", wait_for_version(client, current, 20) == current)
        _, body = client.get("/release.json")
        check("server serves its own release notes", json.loads(body).get("version") == current)
        _, status = client.post("/api/update/status", {"force": True})
        check("status: a newer release is found", status.get("available") and status.get("latest") == NEW_VERSION
              and status.get("can_install") and status.get("current") == current, str(status))
        check("status: its notes come along", status.get("title") == "Test release" and status.get("notes") == ["Made by verify_update.py"])

        code, body = Client(base).post("/api/update/install", {"version": NEW_VERSION})
        check("installing needs a signed-in user", code == 401 and body.get("auth") is False)
        _, body = client.post("/api/signup", {"username": "updater", "password": "correct-horse-9", "name": "Up Dater"})
        check("signed in", body.get("ok"))

        good = zip_path.read_bytes()
        zip_path.write_bytes(good + b"tampered")
        _, body = client.post("/api/update/install", {"version": NEW_VERSION})
        backups_dir = install / "data" / "backups"
        backups = sorted(backups_dir.glob("pre-update-*.zip")) if backups_dir.exists() else []
        check("a tampered download is refused", not body.get("ok") and "checksum" in (body.get("error") or ""), str(body))
        check("the refused update changed nothing", not backups
              and f'VERSION = "{current}"' in (install / "server.py").read_text(encoding="utf-8")
              and not (install / "web" / "NEW_IN_9.txt").exists())
        zip_path.write_bytes(good)

        _, body = client.post("/api/update/install", {"version": "1.0.0"})
        check("a stale version request is refused", not body.get("ok") and NEW_VERSION in (body.get("error") or ""), str(body))
        _, body = client.post("/api/update/install", {"version": NEW_VERSION})
        check("the update installs", body.get("ok") and body.get("restarting") and body.get("version") == NEW_VERSION, str(body))
        seen = wait_for_version(client, NEW_VERSION, 45)
        check("the server restarts as the new version", seen == NEW_VERSION, f"saw {seen}")
        check("the new files are in place", (install / "web" / "NEW_IN_9.txt").exists()
              and f'VERSION = "{NEW_VERSION}"' in (install / "server.py").read_text(encoding="utf-8"))
        backups = sorted(backups_dir.glob("pre-update-*.zip"))
        old_server = ""
        if backups:
            with zipfile.ZipFile(backups[0]) as archive:
                old_server = archive.read("server.py").decode("utf-8")
        check("the whole folder was backed up first", len(backups) == 1 and f'VERSION = "{current}"' in old_server)
        fresh = Client(base)
        _, body = fresh.post("/api/login", {"username": "updater", "password": "correct-horse-9"})
        check("accounts and data survive the update", body.get("ok"))
        _, status = fresh.post("/api/update/status", {"force": True})
        check("nothing newer is offered afterwards", status.get("current") == NEW_VERSION and not status.get("available"), str(status))
    finally:
        stop_servers(proc, pid_file)
        log.close()


def main():
    work = Path(tempfile.mkdtemp(prefix="twin-update-test-"))
    try:
        builder = load_module("twin_build_bundle", APP_DIR / "scripts" / "build_bundle.py")
        static_checks()
        bundle_checks(work, builder)
        unit_checks(work)
        end_to_end(work, builder)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if FAILURES:
        print(f"\nFAILED: {len(FAILURES)} check(s)")
        return 1
    print("\nPASSED: Twin in-app updates")
    return 0


if __name__ == "__main__":
    sys.exit(main())
