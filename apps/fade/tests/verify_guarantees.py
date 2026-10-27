"""Fade 3.3: the server no longer has to trust the uploader's app or the push provider.

  * server-side classifier (numpy port of the apps' NSFWJS model) re-checks every upload; uploads are held
    until it ran; a clean claim from the app that the server finds explicit flags the account
  * external checker hook (--scan-hook): allow / review / block, child-abuse labels suspend the account and
    keep evidence, an unreachable checker keeps uploads hidden and is retried by the sweeper
  * operator hash list (--hash-list)
  * content-free pushes by default (ntfy keeps message text ~12 h even after a recall)
  * ffmpeg for 32-bit ARM / i686 Linux (pinned tar.xz) + install hint elsewhere
  * numpy parity with the browser model (test/e2e/report_scanparity.json from test/net/run_scan_parity.sh)

Run: python3 tests/verify_guarantees.py
  FADE_TEST_FFMPEG=/path/to/ffmpeg  also runs the real classifier through the server
  FADE_TEST_DOWNLOAD=1              also pip-installs numpy into a temp folder with the system python
"""
import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_safety as vs  # noqa: E402

check, register, wait_for, NtfyStub = vs.check, vs.register, vs.wait_for, vs.NtfyStub
APP_DIR = Path(__file__).resolve().parents[1]
ROOT = APP_DIR.parents[2]
REAL_FFMPEG = os.environ.get("FADE_TEST_FFMPEG") or shutil.which("ffmpeg")
MODEL = "nsfwjs-mobilenetv2"


def upload(client, caption, payload, scan="ok", content_type="image/png"):
    meta = {"caption": caption, "category": "Cut reveal", "tags": [], "duration": 3, "optimized": True}
    if scan == "ok":
        meta["scan"] = {"nsfw": 0.02, "sexy": 0.01, "model": MODEL, "frames": 1}
    header = base64.b64encode(json.dumps(meta).encode()).decode()
    return client.call("POST", "/api/shorts", raw=payload, headers={"Content-Type": content_type, "X-Fade-Meta": header})


class FakeScanner:
    """Stands in for nsfw_scan.ServerScanner: verdict chosen by a marker inside the uploaded bytes."""
    model = object()
    status = "ready (test)"
    gate = threading.Event()

    def scan_file(self, ffmpeg, path, kind):
        data = Path(path).read_bytes()
        if b"SLOW" in data:
            FakeScanner.gate.wait(10)
        if b"EXPLICIT" in data:
            return {"nsfw": 0.97, "sexy": 0.02, "frames": 1, "model": MODEL}
        if b"SUGGESTIVE" in data:
            return {"nsfw": 0.1, "sexy": 0.95, "frames": 1, "model": MODEL}
        return {"nsfw": 0.01, "sexy": 0.01, "frames": 1, "model": MODEL}


class HookStub(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        HookStub.calls.append({"short": self.headers.get("X-Fade-Short"), "kind": self.headers.get("X-Fade-Kind"),
                               "sha": self.headers.get("X-Fade-Sha256"), "type": self.headers.get("Content-Type"),
                               "ok_sha": hashlib.sha256(data).hexdigest() == self.headers.get("X-Fade-Sha256")})
        if b"HOOK-CSAM" in data:
            answer = {"action": "block", "reason": "hash match", "labels": ["csam"]}
        elif b"HOOK-GORE" in data:
            answer = {"action": "review", "reason": "graphic", "labels": ["violence"]}
        else:
            answer = {"action": "allow"}
        body = json.dumps(answer).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class FileServer(BaseHTTPRequestHandler):
    root = None

    def log_message(self, *args):
        pass

    def do_GET(self):
        target = Path(FileServer.root) / self.path.lstrip("/")
        if not target.exists():
            self.send_response(404)
            self.end_headers()
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def short_doc(app, short_id):
    return app.s.get("short", short_id)


def visible_to(client, short_id):
    status, state = client.call("GET", "/api/state")
    return status == 200 and any(s["id"] == short_id for s in state["shorts"])


def open_reports(app, target):
    return [r for r in app.s.all("report") if r["target"] == target and r["status"] == "open"]


def run(base, server_module, data_dir, tmp):
    app = server_module.Handler.app
    admin = register(base, "Mo Derator", "mod@example.com")
    creator = register(base, "Ana Creator", "ana@example.com")
    viewer = register(base, "Ben Viewer", "ben@example.com")
    quiet = register(base, "Dee Private", "dee@example.com", full_preview=False)

    # ---------- content-free pushes by default ----------
    status, state = quiet.call("GET", "/api/state")
    check("new accounts get private push previews by default", state["user"]["pushPreview"] == "private", state["user"].get("pushPreview"))
    topic = state["user"]["notify"]
    status, up = upload(quiet, "Dee's fade", b"\x89PNG plain image dee")
    dee_short = up["short"]["id"]
    viewer.call("POST", "/api/comments", {"shortId": dee_short, "text": "Ben says the fade on Friday at Jalan Sudirman is clean"})
    pushes = wait_for(lambda: [p for p in NtfyStub.received if p.get("topic") == topic])
    body = json.dumps(pushes)
    check("private push carries only the kind of notification", bool(pushes) and pushes[-1]["title"] == "Fade"
          and pushes[-1]["message"].startswith("New comment"), body[:300])
    check("private push contains no name, text or place", "Ben" not in body and "Friday" not in body and "Sudirman" not in body, body[:300])
    status, settings = quiet.call("PUT", "/api/me/push", {"preview": "full"})
    check("full previews remain an explicit opt-in", settings.get("pushPreview") == "full", settings)
    viewer.call("POST", "/api/comments", {"shortId": dee_short, "text": "second comment"})
    full = wait_for(lambda: [p for p in NtfyStub.received if p.get("topic") == topic and "commented" in p.get("title", "")])
    check("opted-in account gets the full text", bool(full) and "second comment" in full[-1]["message"])

    # ---------- server-side classifier ----------
    fake_ffmpeg = Path(tmp) / "ffmpeg"
    fake_ffmpeg.write_text(vs.FAKE_FFMPEG)
    fake_ffmpeg.chmod(0o755)
    app.ffmpeg = str(fake_ffmpeg)
    app.scanner = FakeScanner()
    app.scan_status = FakeScanner.status
    check("server checks active with ffmpeg + classifier", app.server_checks_active())

    FakeScanner.gate.clear()
    status, up = upload(creator, "Slow clean cut", b"\x89PNG SLOW clean cut")
    slow_id = up["short"]["id"]
    check("upload response says the server is checking", status == 200 and up.get("checking") is True, up)
    check("held upload is invisible to others while checking", not visible_to(viewer, slow_id))
    check("…but the uploader sees it", visible_to(creator, slow_id))
    FakeScanner.gate.set()
    released = wait_for(lambda: not short_doc(app, slow_id)["media"].get("verifying"))
    check("clean upload released after the server check", released and visible_to(viewer, slow_id))
    media = short_doc(app, slow_id)["media"]
    check("server verdict recorded", media.get("scanBy") == "server" and media.get("scanVerdict") == "ok"
          and media.get("serverScan", {}).get("model") == MODEL, media)

    status, up = upload(creator, "Totally a haircut", b"\x89PNG EXPLICIT lying app")
    lie_id = up["short"]["id"]
    check("lying app's upload accepted by the API (its scan said clean)", status == 200, up)
    flagged = wait_for(lambda: open_reports(app, f"short:{lie_id}"))
    check("server finds it explicit and flags it", bool(flagged) and "server check" in flagged[0]["note"], flagged)
    check("…mentions the app's contradicting number", bool(flagged) and "uploader's app reported 2%" in flagged[0]["note"], flagged)
    check("…and it is hidden from everyone", f"short:{lie_id}" in app.mod_doc()["hidden"] and not visible_to(viewer, lie_id))
    creator_id = short_doc(app, lie_id)["userId"]
    user_flags = wait_for(lambda: open_reports(app, f"user:{creator_id}"))
    check("account flagged as a possibly modified app", bool(user_flags) and "modified app" in user_flags[0]["note"], user_flags)
    check("mismatch counter stored", app.s.get("user", creator_id).get("scanMismatches") == 1)

    status, up = upload(creator, "Spicy", b"\x89PNG SUGGESTIVE", scan=None)
    sug_id = up["short"]["id"]
    sug_reports = wait_for(lambda: open_reports(app, f"short:{sug_id}"))
    check("upload without the app's scan still checked by the server", bool(sug_reports) and "without the app's own check" in sug_reports[0]["note"], sug_reports)
    check("no mismatch flag when the app sent no scan", app.s.get("user", creator_id).get("scanMismatches") == 1)

    status, queue = admin.call("GET", "/api/mod")
    check("moderators see the server checks' status", queue.get("serverChecks", {}).get("classifier") == FakeScanner.status, queue.get("serverChecks"))
    status, state = viewer.call("GET", "/api/state")
    check("state reports the server verification", state["server"]["verify"]["active"] is True, state["server"].get("verify"))
    check("hook details never reach clients", all("hook" not in s["media"] for s in state["shorts"]))

    # backlog: uploads that arrived before the classifier was ready get checked later
    app.scanner = None
    status, up = upload(creator, "Before model ready", b"\x89PNG EXPLICIT early")
    early_id = up["short"]["id"]
    wait_for(lambda: short_doc(app, early_id)["media"].get("phash") is not None, 3)
    check("without the classifier the upload isn't held", not short_doc(app, early_id)["media"].get("verifying"))
    app.scanner = FakeScanner()
    app.process_backlog()
    late = wait_for(lambda: open_reports(app, f"short:{early_id}"))
    check("backlog: checked once the classifier is ready", bool(late) and short_doc(app, early_id)["media"].get("scanBy") == "server")

    # ---------- operator hash list ----------
    hash_file = Path(tmp) / "hashes.txt"
    hash_file.write_text("# known bad\n0000000000000000 test-list\nnot-a-hash\n")
    app.external_hashes = server_module.load_hash_list(hash_file)
    check("hash list parsed (comments and junk ignored)", app.external_hashes == {"0000000000000000": "test-list"}, app.external_hashes)
    status, up = upload(creator, "Listed image", b"\x89PNG listed")  # fake ffmpeg -> flat frame -> dHash 0
    listed = wait_for(lambda: open_reports(app, f"short:{up['short']['id']}"))
    check("upload matching the operator's hash list is hidden", bool(listed) and "blocked-media list (hash list: test-list)" in listed[0]["note"], listed)
    app.external_hashes = {}

    # ---------- external checker hook ----------
    hook = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), HookStub)
    threading.Thread(target=hook.serve_forever, daemon=True).start()
    app.scan_hook = f"http://127.0.0.1:{hook.server_port}/check"
    status, up = upload(creator, "Hook clean", b"\x89PNG hook clean")
    clean_id = up["short"]["id"]
    wait_for(lambda: not short_doc(app, clean_id)["media"].get("verifying"))
    check("hook gets the file with its SHA-256", bool(HookStub.calls) and HookStub.calls[-1]["ok_sha"] and HookStub.calls[-1]["short"] == clean_id, HookStub.calls[-1:])
    check("hook 'allow' releases the upload", visible_to(viewer, clean_id) and short_doc(app, clean_id)["media"].get("hook", {}).get("action") == "allow")

    status, up = upload(creator, "Hook gore", b"\x89PNG HOOK-GORE")
    gore_id = up["short"]["id"]
    gore = wait_for(lambda: open_reports(app, f"short:{gore_id}"))
    check("hook 'review' hides it with the checker's labels", bool(gore) and gore[0]["reason"] == "violence" and "graphic" in gore[0]["note"], gore)

    bad = register(base, "Bad Actor", "bad@example.com")
    status, up = upload(bad, "Hook csam", b"\x89PNG HOOK-CSAM")
    csam_id = up["short"]["id"]
    bad_id = short_doc(app, csam_id)["userId"]
    banned = wait_for(lambda: bad_id in app.mod_doc()["banned"])
    check("child-abuse match suspends the account immediately", bool(banned))
    status, _ = bad.call("GET", "/api/state")
    check("…and signs it out everywhere", status == 401, status)
    doc = short_doc(app, csam_id)
    check("…keeps the file as evidence, never shown", doc["media"].get("evidenceHold") is True and not visible_to(viewer, csam_id)
          and (app.s.media_dir / Path(doc["media"]["url"]).name).exists())
    alerts = [r for r in open_reports(app, f"short:{csam_id}")]
    check("…and alerts moderators", bool(alerts))

    # unreachable checker: stays hidden, alerts after 3 tries, retried by the sweeper
    hook_url = app.scan_hook
    app.scan_hook = f"http://127.0.0.1:{vs.free_port()}/down"
    status, up = upload(creator, "Hook down", b"\x89PNG hook down")
    down_id = up["short"]["id"]
    wait_for(lambda: short_doc(app, down_id)["media"].get("hookError"))
    wait_for(lambda: down_id not in app.verifying_now)
    check("unreachable checker keeps the upload hidden", short_doc(app, down_id)["media"].get("verifying") and not visible_to(viewer, down_id))
    for _ in range(2):
        attempts = short_doc(app, down_id)["media"].get("hookAttempts")
        app.retry_held_checks()
        wait_for(lambda: short_doc(app, down_id)["media"].get("hookAttempts", 0) > attempts, 5)
        wait_for(lambda: down_id not in app.verifying_now)
    note = wait_for(lambda: open_reports(app, f"short:{down_id}"))
    check("moderators told after 3 failed checks", bool(note) and "unreachable" in note[0]["note"], note)
    status, queue = admin.call("GET", "/api/mod")
    check("held uploads listed for moderators", any(h["id"] == down_id for h in queue.get("held", [])))
    app.scan_hook = hook_url
    app.sweep()
    released = wait_for(lambda: not short_doc(app, down_id)["media"].get("verifying"))
    check("sweeper retries and releases once the checker answers", released and visible_to(viewer, down_id))
    hook.shutdown()
    app.scan_hook = None

    # ---------- real classifier through the server (needs ffmpeg + numpy) ----------
    try:
        import numpy  # noqa: F401
        have_numpy = True
    except ImportError:
        have_numpy = False
    if REAL_FFMPEG and have_numpy:
        app.ffmpeg = REAL_FFMPEG
        app.scanner = server_module.nsfw_scan.ServerScanner(Path(data_dir) / "pylib", install=False)
        app.scanner.ready()  # what provision_scanner() does at startup
        check("real classifier loads", app.server_scan_ready(), app.scanner.status)
        image = (ROOT / "test/net/fixtures/neutral.png").read_bytes()
        status, up = upload(creator, "Real neutral", image)
        real_id = up["short"]["id"]
        wait_for(lambda: short_doc(app, real_id)["media"].get("scanBy") == "server", 30)
        media = short_doc(app, real_id)["media"]
        check("real classifier: neutral photo passes", media.get("scanVerdict") == "ok"
              and (media.get("serverScan") or {}).get("frames") == 1, media.get("serverScan"))
        clip = (ROOT / "test/e2e/fixtures/clip.mp4").read_bytes()
        meta = {"caption": "Real clip", "category": "Cut reveal", "tags": [], "duration": 3, "optimized": True,
                "scan": {"nsfw": 0.01, "sexy": 0.0, "model": MODEL, "frames": 3}}
        header = base64.b64encode(json.dumps(meta).encode()).decode()
        status, up = creator.call("POST", "/api/shorts", raw=clip, headers={"Content-Type": "video/mp4", "X-Fade-Meta": header})
        clip_id = up["short"]["id"]
        wait_for(lambda: short_doc(app, clip_id)["media"].get("scanBy") == "server", 60)
        frames = (short_doc(app, clip_id)["media"].get("serverScan") or {}).get("frames", 0)
        check("real classifier: video sampled at more frames than the phone (3)", frames > 3, frames)
    else:
        print("  (skipped real classifier: set FADE_TEST_FFMPEG and run with a python that has numpy)")


def numpy_parity():
    report = ROOT / "test/e2e/report_scanparity.json"
    parity_dir = ROOT / "test/net/fixtures/parity"
    try:
        import numpy as np
    except ImportError:
        print("  (skipped numpy parity: no numpy in this python)")
        return
    if not report.exists():
        print("  (skipped numpy parity: run test/net/run_scan_parity.sh first)")
        return
    sys.path.insert(0, str(APP_DIR / "server"))
    import nsfw_scan
    browser = json.loads(report.read_text())["raw"]
    model = nsfw_scan.NsfwModel.load(np)
    worst = 0.0
    for name, expected in browser.items():
        rgb = np.frombuffer((parity_dir / f"{name}.rgb").read_bytes(), dtype=np.uint8).reshape(448, 448, 3)
        got = model.classify(rgb)
        worst = max(worst, max(abs(got[k] - expected[k]) for k in nsfw_scan.CLASSES))
    check(f"numpy model matches the browser model on {len(browser)} frames (max |Δ| {worst:.1e})", len(browser) >= 8 and worst < 1e-3)


def ffmpeg_platforms(server_module, tmp):
    original_machine = server_module.platform.machine
    original_platform = server_module.sys.platform
    try:
        server_module.sys.platform = "linux"
        for machine, url_part in (("armv7l", "armhf"), ("armv6l", "armel"), ("i686", "i686"), ("aarch64", "manylinux2014_aarch64")):
            server_module.platform.machine = lambda m=machine: m
            key = server_module.platform_key()
            entry = server_module.FFMPEG_WHEELS.get(key)
            check(f"ffmpeg download pinned for linux/{machine}", bool(entry) and url_part in entry[0] and len(entry[1]) == 64, (key, entry))
        server_module.sys.platform = "freebsd14"
        server_module.platform.machine = lambda: "amd64"
        try:
            server_module.fetch_ffmpeg(Path(tmp) / "bsd")
            hint = ""
        except RuntimeError as err:
            hint = str(err)
        check("unsupported OS gets the exact install command", "pkg install ffmpeg" in hint, hint)
    finally:
        server_module.platform.machine = original_machine
        server_module.sys.platform = original_platform

    # tar.xz path (the 32-bit Linux builds) with a fake archive served locally
    root = Path(tmp) / "files"
    root.mkdir()
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:xz") as archive:
        script = b"#!/bin/sh\necho 'ffmpeg version 6.0.1-static'\n"
        info = tarfile.TarInfo("ffmpeg-6.0.1-test-static/ffmpeg")
        info.size = len(script)
        info.mode = 0o755
        archive.addfile(info, io.BytesIO(script))
        readme = tarfile.TarInfo("ffmpeg-6.0.1-test-static/readme.txt")
        readme.size = 2
        archive.addfile(readme, io.BytesIO(b"hi"))
    (root / "ff.tar.xz").write_bytes(buffer.getvalue())
    digest = hashlib.sha256(buffer.getvalue()).hexdigest()
    FileServer.root = root
    files = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), FileServer)
    threading.Thread(target=files.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{files.server_port}/ff.tar.xz"
    key = server_module.platform_key()
    path = server_module.fetch_ffmpeg(Path(tmp) / "bin-xz", {key: (url, digest)})
    check("tar.xz build extracted, verified and runnable", server_module.working_ffmpeg(path))
    try:
        server_module.fetch_ffmpeg(Path(tmp) / "bin-bad", {key: (url, "0" * 64)})
        rejected = False
    except RuntimeError:
        rejected = True
    check("tampered tar.xz rejected", rejected and not (Path(tmp) / "bin-bad" / "ffmpeg").exists())
    files.shutdown()


def numpy_download(tmp):
    if os.environ.get("FADE_TEST_DOWNLOAD") != "1":
        print("  (skipped numpy auto-install: set FADE_TEST_DOWNLOAD=1)")
        return
    pylib = Path(tmp) / "pylib"
    code = ("import sys; sys.path.insert(0, %r); import nsfw_scan, time; t = time.time(); "
            "np, source = nsfw_scan.ensure_numpy(__import__('pathlib').Path(%r)); "
            "m = nsfw_scan.NsfwModel.load(np); import numpy; "
            "print(source, np.__version__, round(time.time() - t, 1), numpy.__file__)") % (str(APP_DIR / "server"), str(pylib))
    started = time.time()
    result = subprocess.run(["/usr/bin/python3", "-c", code], capture_output=True, text=True, timeout=600)
    output = (result.stdout + result.stderr).strip()
    check(f"system python without numpy fetches it into <data>/pylib ({time.time() - started:.0f} s)",
          result.returncode == 0 and output.startswith("downloaded") and str(pylib) in output, output[-300:])


def main():
    server_module = vs.load_server()
    ntfy = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), NtfyStub)
    threading.Thread(target=ntfy.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory() as data_dir, tempfile.TemporaryDirectory() as tmp:
        port = vs.free_port()
        server = server_module.make_server("127.0.0.1", port, data_dir, quiet=True, admins=["mod@example.com"],
                                           ntfy=f"http://127.0.0.1:{ntfy.server_port}/")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            run(f"http://127.0.0.1:{port}", server_module, data_dir, tmp)
            ffmpeg_platforms(server_module, tmp)
            numpy_parity()
            numpy_download(tmp)
        except Exception as err:
            import traceback
            traceback.print_exc()
            vs.FAILURES.append(f"crash: {err}")
        finally:
            server.shutdown()
            server.server_close()
            ntfy.shutdown()
    print(f"fade guarantees: {len(vs.PASSES)} checks passed, {len(vs.FAILURES)} failed")
    for failure in vs.FAILURES:
        print("  FAIL", failure)
    return 1 if vs.FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
