"""Fade 3.4: what 3.3 still left to chance.

  * --review-new N: the first N uploads of every new account wait for a moderator (classifiers miss things;
    a human sees every new account's first post before anyone else does)
  * built-in Sightengine adapter (--scan-hook sightengine): violence, gore, firearms, hate symbols, sexual
    content — checked here against a mock that answers with Sightengine's documented response shapes
  * full push previews are never stored: ntfy gets the content-free push, the text follows as a live-only
    update ("Cache: no", "Firebase: no") with the same sequence id
  * evidence export for moderators (zip: file + SHA-256 + uploader + checks + reports), upload kept from deletion
  * safety checklist in the moderator console + startup banner

Run: python3 tests/verify_review.py
"""
import base64
import hashlib
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_safety as vs  # noqa: E402

check, register, wait_for = vs.check, vs.register, vs.wait_for
APP_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP_DIR / "server"))
import hook_sightengine as se  # noqa: E402


def upload(client, caption, payload, content_type="image/png"):
    meta = {"caption": caption, "category": "Cut reveal", "tags": [], "duration": 3, "optimized": True,
            "scan": {"nsfw": 0.02, "sexy": 0.01, "model": "nsfwjs-mobilenetv2", "frames": 1}}
    header = base64.b64encode(json.dumps(meta).encode()).decode()
    return client.call("POST", "/api/shorts", raw=payload, headers={"Content-Type": content_type, "X-Fade-Meta": header})


def visible_to(client, short_id):
    status, state = client.call("GET", "/api/state")
    return status == 200 and any(s["id"] == short_id for s in state["shorts"])


class HeaderNtfy(BaseHTTPRequestHandler):
    """ntfy stand-in that also records the headers of every publish (Cache / Firebase)."""
    received = []

    def log_message(self, *args):
        pass

    def _reply(self):
        body = b'{"id":"stub"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        payload = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        payload["_headers"] = {key.lower(): value for key, value in self.headers.items()}
        HeaderNtfy.received.append(payload)
        self._reply()

    do_PUT = do_DELETE = _reply


# --- Sightengine mock: documented response shapes, chosen by a marker inside the uploaded file -------------
FRAME_CLEAN = {
    "nudity": {"sexual_activity": 0.01, "sexual_display": 0.01, "erotica": 0.01, "none": 0.97},
    "gore": {"prob": 0.01, "classes": {"very_bloody": 0.01}},
    "violence": {"prob": 0.01},
    "weapon": {"classes": {"firearm": 0.01, "knife": 0.02}},
    "offensive": {"nazi": 0.01, "supremacist": 0.01, "confederate": 0.01, "terrorist": 0.01, "middle_finger": 0.01},
}


def frame_with(**changes):
    frame = json.loads(json.dumps(FRAME_CLEAN))
    for path, value in changes.items():
        field, key = path.split("__")
        frame[field].setdefault("classes", {}) if key == "classes" else None
        if field == "weapon":
            frame["weapon"]["classes"][key] = value
        else:
            frame[field][key] = value
    return frame


SCENARIOS = {
    b"SE-CLEAN": {"status": "success", **FRAME_CLEAN},
    b"SE-SEXUAL": {"status": "success", **frame_with(nudity__sexual_activity=0.93)},
    b"SE-GORE": {"status": "success", **frame_with(gore__prob=0.62)},
    b"SE-GUN": {"status": "success", **frame_with(weapon__firearm=0.97)},
    b"SE-RAZOR": {"status": "success", **frame_with(weapon__knife=0.99)},
    b"SE-HATE": {"status": "success", **frame_with(offensive__nazi=0.72)},
    b"SE-FINGER": {"status": "success", **frame_with(offensive__middle_finger=0.99)},
    b"SE-VIDEO": {"status": "success", "data": {"frames": [
        {"info": {"position": 0}, **FRAME_CLEAN},
        {"info": {"position": 1}, **frame_with(violence__prob=0.91)},
        {"info": {"position": 2}, **FRAME_CLEAN},
    ]}},
    b"SE-ERROR": {"status": "failure", "error": {"type": "usage_limit", "message": "Daily usage limit reached"}},
}


class SightengineMock(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        SightengineMock.calls.append({"path": self.path, "type": self.headers.get("Content-Type", ""), "body": body})
        answer = next((value for marker, value in SCENARIOS.items() if marker in body), {"status": "success", **FRAME_CLEAN})
        status = 429 if answer.get("status") == "failure" else 200
        data = json.dumps(answer).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def adapter_checks(mock_base):
    kwargs = {"user": "u1", "secret": "s1", "api_base": mock_base}
    clean = se.check_media(b"\x89PNG SE-CLEAN", "image/png", **kwargs)
    check("Sightengine: clean image → allow", clean["action"] == "allow" and not clean["labels"], clean)
    call = SightengineMock.calls[-1]
    check("Sightengine: images go to /check.json as multipart with models + keys + media",
          call["path"].endswith("/check.json") and call["type"].startswith("multipart/form-data")
          and b'name="models"' in call["body"] and b"weapon" in call["body"] and b'name="api_user"' in call["body"]
          and b'name="media"; filename="upload.png"' in call["body"], call["path"])
    sexual = se.check_media(b"SE-SEXUAL", "image/jpeg", **kwargs)
    check("Sightengine: sexual activity 93% → block", sexual["action"] == "block" and sexual["labels"] == ["sexual"], sexual)
    gore = se.check_media(b"SE-GORE", "image/jpeg", **kwargs)
    check("Sightengine: gore 62% → review", gore["action"] == "review" and gore["labels"] == ["gore"], gore)
    gun = se.check_media(b"SE-GUN", "image/jpeg", **kwargs)
    check("Sightengine: firearm 97% → block", gun["action"] == "block" and gun["labels"] == ["firearm"], gun)
    razor = se.check_media(b"SE-RAZOR", "image/jpeg", **kwargs)
    check("Sightengine: knives / razors are not flagged (barbers use them)", razor["action"] == "allow", razor)
    hate = se.check_media(b"SE-HATE", "image/jpeg", **kwargs)
    check("Sightengine: hate symbol 72% → review", hate["action"] == "review" and hate["labels"] == ["hate-symbol"], hate)
    finger = se.check_media(b"SE-FINGER", "image/jpeg", **kwargs)
    check("Sightengine: a middle finger is ignored", finger["action"] == "allow", finger)
    video = se.check_media(b"SE-VIDEO", "video/mp4", **kwargs)
    check("Sightengine: videos go to /video/check-sync.json; the worst frame decides (violence 91% → block)",
          SightengineMock.calls[-1]["path"].endswith("/video/check-sync.json") and video["action"] == "block"
          and video["labels"] == ["violence"], video)
    try:
        se.check_media(b"SE-ERROR", "image/jpeg", **kwargs)
        failed = None
    except RuntimeError as err:
        failed = str(err)
    check("Sightengine: API errors raise (the upload stays held and is retried)", failed == "Daily usage limit reached", failed)
    tolerant = se.decide({"status": "success", "weapon": 0.2, "gore": 0.9, "nudity": {"classes": {"sexual_display": 0.6}}})
    check("Sightengine: tolerant parser (bare numbers, nested classes)", tolerant["action"] == "block"
          and set(tolerant["labels"]) == {"gore", "sexual"}, tolerant)
    saved = {key: os.environ.pop(key, None) for key in ("SIGHTENGINE_USER", "SIGHTENGINE_SECRET")}
    try:
        se.check_media(b"x", "image/png", api_base=mock_base)
        missing = None
    except RuntimeError as err:
        missing = str(err)
    for key, value in saved.items():
        if value is not None:
            os.environ[key] = value
    check("Sightengine: missing keys are a clear error", missing and "SIGHTENGINE_USER" in missing, missing)


def run(base, server_module, mock_base):
    app = server_module.Handler.app
    admin = register(base, "Mo Derator", "mod@example.com")
    newbie = register(base, "Nia New", "nia@example.com")
    viewer = register(base, "Vic Viewer", "vic@example.com")
    quiet = register(base, "Dee Private", "dee@example.com", full_preview=False)

    # ---------- first uploads of new accounts wait for a moderator ----------
    check("review-new is on (1 upload)", app.review_new == 1, app.review_new)
    status, up = upload(newbie, "Nia's first cut", b"\x89PNG nia first")
    first_id = up["short"]["id"]
    check("new account's first upload is accepted", status == 200, up)
    check("…but hidden from everyone else until a moderator looks", not visible_to(viewer, first_id))
    status, queue = admin.call("GET", "/api/mod")
    item = next((q for q in queue.get("queue", []) if q["target"] == f"short:{first_id}"), None)
    check("it waits in the moderator queue with the reason", item is not None
          and any("new account" in (r.get("note") or "") for r in item["reports"]), json.dumps(item)[:300])
    status, _ = admin.call("POST", "/api/mod", {"action": "keep", "target": f"short:{first_id}"})
    check("moderator OK publishes it", status == 200 and wait_for(lambda: visible_to(viewer, first_id)))
    check("the OK counts toward the account's approved uploads", (app.s.get("user", app.user_by_token(newbie.token)["id"]) or {}).get("approvedUploads") == 1)
    admin.call("POST", "/api/mod", {"action": "keep", "target": f"short:{first_id}"})
    check("keeping the same upload twice doesn't count twice", app.s.get("user", app.user_by_token(newbie.token)["id"]).get("approvedUploads") == 1)
    status, up = upload(newbie, "Nia's second cut", b"\x89PNG nia second")
    check("after the first approved upload, the next one goes straight out", status == 200 and visible_to(viewer, up["short"]["id"]))
    status, up = upload(admin, "Moderator's own cut", b"\x89PNG mod own")
    check("moderators' own uploads aren't held", status == 200 and visible_to(viewer, up["short"]["id"]))
    status, up = upload(viewer, "Vic's first", b"\x89PNG vic first")
    vic_first = up["short"]["id"]
    admin.call("POST", "/api/mod", {"action": "hide", "target": f"short:{vic_first}"})
    check("a removed first upload doesn't count as approved", not app.s.get("user", app.user_by_token(viewer.token)["id"]).get("approvedUploads"))

    # ---------- full previews are never stored ----------
    status, state = quiet.call("GET", "/api/state")
    quiet_topic = state["user"]["notify"]
    status, state = newbie.call("GET", "/api/state")
    full_topic = state["user"]["notify"]
    HeaderNtfy.received.clear()
    status, newbie_short = upload(newbie, "Nia's third", b"\x89PNG nia third")
    viewer.call("POST", "/api/comments", {"shortId": newbie_short["short"]["id"], "text": "Vic loves this taper at Kemang"})
    pushes = wait_for(lambda: [p for p in HeaderNtfy.received if p.get("topic") == full_topic] if len(
        [p for p in HeaderNtfy.received if p.get("topic") == full_topic]) >= 2 else None)
    pushes = pushes or [p for p in HeaderNtfy.received if p.get("topic") == full_topic]
    stored = [p for p in pushes if p["_headers"].get("cache") != "no"]
    live = [p for p in pushes if p["_headers"].get("cache") == "no"]
    check("full previews: stored push first, content-free", bool(pushes) and pushes[0] in stored and all(p["title"] == "Fade"
          and "Vic" not in p["message"] and "Kemang" not in p["message"] for p in stored), json.dumps(pushes)[:400])
    check("full previews: the text follows live-only (Cache: no, Firebase: no)", len(live) == 1
          and live[0]["_headers"].get("firebase") == "no" and "Kemang" in live[0]["message"], json.dumps(live)[:300])
    check("live update replaces the stored one on the phone (same sequence id)", bool(stored) and bool(live)
          and live[0].get("sequence_id") == stored[0].get("sequence_id"))
    check("push log marks which sends were live-only", any(entry.get("live") for entry in app.push_log)
          and any(not entry.get("live") for entry in app.push_log))
    status, quiet_short = upload(quiet, "Dee's cut", b"\x89PNG dee cut")
    admin.call("POST", "/api/mod", {"action": "keep", "target": f"short:{quiet_short['short']['id']}"})
    HeaderNtfy.received.clear()
    viewer.call("POST", "/api/comments", {"shortId": quiet_short["short"]["id"], "text": "nice"})
    quiet_pushes = wait_for(lambda: [p for p in HeaderNtfy.received if p.get("topic") == quiet_topic])
    import time
    time.sleep(0.5)
    quiet_pushes = [p for p in HeaderNtfy.received if p.get("topic") == quiet_topic]
    check("private previews: one content-free push, no live text", len(quiet_pushes) == 1
          and quiet_pushes[0]["_headers"].get("cache") != "no", json.dumps(quiet_pushes)[:300])

    # ---------- evidence export ----------
    status, zipped = admin.call("GET", f"/api/mod/evidence/{first_id}")
    archive = zipfile.ZipFile(io.BytesIO(zipped)) if status == 200 and isinstance(zipped, bytes) else None
    names = archive.namelist() if archive else []
    record = json.loads(archive.read("record.json")) if archive and "record.json" in names else {}
    media_name = next((n for n in names if n.startswith("media/")), None)
    media_bytes = archive.read(media_name) if media_name else b""
    check("moderators can export an evidence zip (record.json + the file)", status == 200 and bool(record) and bool(media_bytes), names)
    check("evidence: SHA-256 matches the file, uploader and history included",
          record.get("file", {}).get("sha256") == hashlib.sha256(media_bytes).hexdigest()
          and record.get("uploader", {}).get("email") == "nia@example.com" and record.get("moderation", {}).get("kept")
          and any("new account" in (r.get("note") or "") for r in record.get("reports", [])), json.dumps(record)[:400])
    check("exported uploads are kept from deletion", app.s.get("short", first_id)["media"].get("evidenceHold") is True
          and app.s.get("short", first_id).get("evidenceExports"))
    status, denied = viewer.call("GET", f"/api/mod/evidence/{first_id}")
    check("evidence export is moderators only", status == 403, (status, denied))
    status, missing = admin.call("GET", "/api/mod/evidence/nope")
    check("unknown short → 404", status == 404, status)

    # ---------- safety checklist ----------
    status, queue = admin.call("GET", "/api/mod")
    setup = {item["id"]: item["on"] for item in queue.get("setup", [])}
    check("moderator console lists the safety setup", {"moderators", "classifier", "external", "review-new", "hash-list"} <= set(setup), setup)
    check("checklist reflects this server (moderators + review on, no external checker yet)",
          setup.get("moderators") and setup.get("review-new") and not setup.get("external"), setup)

    # ---------- Sightengine wired into the server ----------
    os.environ["SIGHTENGINE_USER"] = "u1"
    os.environ["SIGHTENGINE_SECRET"] = "s1"
    server_module.hook_sightengine.API_BASE = mock_base
    app.scan_hook = "sightengine"
    app.review_new = 0
    status, queue = admin.call("GET", "/api/mod")
    check("checklist turns the external checker on", any(i["id"] == "external" and i["on"] for i in queue.get("setup", [])))
    status, up = upload(viewer, "Clean fade", b"\x89PNG SE-CLEAN clean fade")
    clean_id = up["short"]["id"]
    check("server + Sightengine: clean upload is released", status == 200
          and wait_for(lambda: visible_to(newbie, clean_id), 10), up)
    status, up = upload(viewer, "Range day", b"\x89PNG SE-GUN range day")
    gun_id = up["short"]["id"]
    hook = wait_for(lambda: (app.s.get("short", gun_id)["media"].get("hook")), 10) or {}
    reports = [r for r in app.s.all("report") if r["target"] == f"short:{gun_id}"]
    check("server + Sightengine: firearm blocked, hidden, filed as violence", hook.get("action") == "block"
          and not visible_to(newbie, gun_id) and any(r.get("category") == "violence" or r.get("reason") == "violence" for r in reports),
          json.dumps({"hook": hook, "reports": reports})[:400])
    status, up = upload(viewer, "Flag", b"\x89PNG SE-HATE flag")
    hate_id = up["short"]["id"]
    wait_for(lambda: app.s.get("short", hate_id)["media"].get("hook"), 10)
    reports = [r for r in app.s.all("report") if r["target"] == f"short:{hate_id}"]
    check("server + Sightengine: hate symbol held for review, filed as hate", not visible_to(newbie, hate_id)
          and any(r.get("category") == "hate" or r.get("reason") == "hate" for r in reports), json.dumps(reports)[:300])
    status, up = upload(viewer, "Over quota", b"\x89PNG SE-ERROR over quota")
    error_id = up["short"]["id"]
    wait_for(lambda: app.s.get("short", error_id)["media"].get("hookAttempts"), 10)
    check("server + Sightengine: API failure keeps the upload hidden and queued for retry",
          not visible_to(newbie, error_id) and app.s.get("short", error_id)["media"].get("hookAttempts") == 1)
    app.scan_hook = None


def banner_checks():
    """The startup banner names every safeguard that isn't set up."""
    with tempfile.TemporaryDirectory() as data_dir:
        port = vs.free_port()
        process = subprocess.Popen(
            [sys.executable, "-u", str(APP_DIR / "server" / "server.py"), "--port", str(port), "--data", data_dir,
             "--ffmpeg", "off", "--scan", "off", "--ntfy", "off"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            env={**os.environ, "FADE_ADMINS": "", "FADE_REVIEW_NEW": "", "PYTHONUNBUFFERED": "1"})
        lines = []
        killer = threading.Timer(15, process.kill)  # never hang the suite on a silent server
        killer.start()
        try:
            for _ in range(12):
                line = process.stdout.readline()
                if not line:
                    break
                lines.append(line.rstrip())
                if "not set up" in line and "hash" in line:
                    break
        finally:
            killer.cancel()
            process.terminate()
            process.wait(5)
    text = "\n".join(lines)
    check("startup banner warns about missing moderators / external checker / review", "not set up: moderator accounts" in text
          and "not set up: external checker" in text and "not set up: moderator approval" in text, text)


def main():
    server_module = vs.load_server()
    ntfy = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), HeaderNtfy)
    mock = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), SightengineMock)
    for server in (ntfy, mock):
        threading.Thread(target=server.serve_forever, daemon=True).start()
    mock_base = f"http://127.0.0.1:{mock.server_port}/1.0"
    with tempfile.TemporaryDirectory() as data_dir:
        port = vs.free_port()
        server = server_module.make_server("127.0.0.1", port, data_dir, quiet=True, admins=["mod@example.com"],
                                           ntfy=f"http://127.0.0.1:{ntfy.server_port}/", review_new=1)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            adapter_checks(mock_base)
            run(f"http://127.0.0.1:{port}", server_module, mock_base)
            banner_checks()
        except Exception as err:
            import traceback
            traceback.print_exc()
            vs.FAILURES.append(f"crash: {err}")
        finally:
            server.shutdown()
            server.server_close()
            ntfy.shutdown()
            mock.shutdown()
    print(f"fade review + previews + evidence: {len(vs.PASSES)} checks passed, {len(vs.FAILURES)} failed")
    for failure in vs.FAILURES:
        print("  FAIL", failure)
    return 1 if vs.FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
