#!/usr/bin/env python3
"""Fade 3.2: the four former limits, verified on the self-hosted server.

1. Push notifications can be updated and recalled (ntfy sequence ids, DELETE / PUT .../clear).
2. Server transcoding no longer needs a pre-installed ffmpeg (verified download into <data>/bin).
3. Automatic scanning: on-device scan verdicts enforced, unscanned uploads queued for a moderator
   scan, re-uploads of removed media blocked by perceptual hash, obfuscated slurs, link spam,
   copy-paste floods and bursts refused.
4. (Offline reports reaching moderators is covered by test/e2e/limits.html.)

Standard library only. Uses a local ntfy stub. Real ffmpeg (FADE_TEST_FFMPEG or PATH) enables the
perceptual-hash and download-backlog checks; FADE_TEST_DOWNLOAD=1 also downloads the real static build.
Exit code 0 on success, 1 on failure.
"""

import base64
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import verify_safety as vs  # noqa: E402  (shared helpers: Client, register, NtfyStub, wait_for, check)

check, register, wait_for, NtfyStub = vs.check, vs.register, vs.wait_for, vs.NtfyStub
REAL_FFMPEG = os.environ.get("FADE_TEST_FFMPEG") or shutil.which("ffmpeg")


def upload(client, caption, payload, content_type="image/png", scan="ok", phash=None):
    meta = {"caption": caption, "category": "Cut reveal", "tags": [], "duration": 3, "optimized": True}
    if scan == "ok":
        meta["scan"] = {"nsfw": 0.01, "sexy": 0.02, "model": "nsfwjs-mobilenetv2", "frames": 3}
    elif isinstance(scan, dict):
        meta["scan"] = scan
    if phash:
        meta["phash"] = phash
    header = base64.b64encode(json.dumps(meta).encode()).decode()
    return client.call("POST", "/api/shorts", raw=payload, headers={"Content-Type": content_type, "X-Fade-Meta": header})


def actions_for(topic, method=None):
    return [a for a in NtfyStub.actions if f"/{topic}/" in a[1] and (method is None or a[0] == method)]


def make_image(path, source, extra_filter=None):
    command = [REAL_FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source, "-frames:v", "1"]
    if extra_filter:
        command += ["-vf", extra_filter]
    subprocess.run(command + [str(path)], check=True, capture_output=True, timeout=60)
    return Path(path).read_bytes()


def fake_wheel(tmp):
    """A wheel-shaped zip holding a tiny 'ffmpeg' that answers -version (for the download test)."""
    script = "#!/bin/sh\necho 'ffmpeg version 7.1-fake'\n"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as wheel:
        wheel.writestr("imageio_ffmpeg/__init__.py", "")
        wheel.writestr("imageio_ffmpeg/binaries/README.md", "x")
        wheel.writestr("imageio_ffmpeg/binaries/ffmpeg-test-v7.1", script)
    data = buffer.getvalue()
    path = Path(tmp) / "fake.whl"
    path.write_bytes(data)
    return path, hashlib.sha256(data).hexdigest()


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


def run(base, server_module, data_dir, ntfy_url):
    app = server_module.Handler.app
    admin = register(base, "Mo Derator", "mod@example.com")
    creator = register(base, "Ana Creator", "ana@example.com")
    customer = register(base, "Ben Client", "ben@example.com")
    barber = register(base, "Cara Blade", "cara@example.com", role="barber", barber={"price": 20, "city": "Jakarta"})
    _, ben = customer.call("GET", "/api/state")
    _, cara = barber.call("GET", "/api/state")
    _, ana = creator.call("GET", "/api/state")
    ben_topic, cara_topic, ana_topic = ben["user"]["notify"], cara["user"]["notify"], ana["user"]["notify"]
    check("state advertises push recall", ben["server"].get("recall") is True)

    # ======================= 1. pushes can be updated and recalled =======================
    cara_id = cara["user"]["barberId"]
    barber.call("PUT", "/api/studio/barber", {"schedule": [{"dow": d, "placeId": "p1", "from": 9, "to": 21} for d in range(7)]})
    local_now = server_module.datetime.now(server_module.tz_for(app.place("p1")))
    slot = None
    for offset in range(2, 12):
        key = (local_now.date() + timedelta(days=offset)).isoformat()
        _, slots = customer.call("GET", f"/api/slots?barber={cara_id}&date={key}&mins=45")
        free = [s for g in slots.get("groups", []) for s in g["slots"] if not s["taken"]]
        if free:
            slot = (key, free[0]["t"])
            break
    _, card = customer.call("POST", "/api/cards", {"brand": "Visa", "last4": "4242", "exp": "12/30"})
    customer.call("POST", "/api/wallet/topup", {"amount": 100, "cardId": card["card"]["id"]})
    status, booked = customer.call("POST", "/api/bookings", {"barberId": cara_id, "serviceId": "s1", "date": slot[0], "time": slot[1],
                                                           "placeId": "p1", "payMode": "full", "method": "wallet"})
    booking_id = booked["booking"]["id"]
    barber_push = wait_for(lambda: vs.pushes_to(cara_topic, "New booking"))
    check("booking push carries an ntfy sequence id", bool(barber_push) and barber_push[0].get("sequence_id") == f"bk-{booking_id}-b",
          str(barber_push))
    wait_for(lambda: vs.pushes_to(ben_topic, "booked"))
    # reminder already delivered, then the customer cancels
    with app.s.lock:
        doc = app.s.get("booking", booking_id)
        app.s.put("booking", booking_id, doc)
        app.s.commit()
    app.notify(booked["booking"]["userId"], "Your cut is in 2 hours ✂️", "test reminder", "/bookings",
               seq=f"rm-{booking_id}-c", ref=f"booking:{booking_id}")
    status, _ = customer.call("POST", f"/api/bookings/{booking_id}/cancel")
    check("customer cancels", status == 200)
    deleted = wait_for(lambda: {a[1] for a in actions_for(ben_topic, "DELETE")} >= {
        f"/{ben_topic}/bk-{booking_id}-c", f"/{ben_topic}/rm-{booking_id}-c"})
    check("cancel recalls the customer's booking + reminder pushes from their phone", bool(deleted), str(NtfyStub.actions))
    cancelled = wait_for(lambda: vs.pushes_to(cara_topic, "cancelled"))
    check("barber's 'New booking' push is replaced in place by 'cancelled' (same sequence id)",
          bool(cancelled) and cancelled[-1].get("sequence_id") == f"bk-{booking_id}-b")
    _, cara_state = barber.call("GET", "/api/state")
    check("in-app feed shows one entry per sequence (updated, not stacked)",
          sum(1 for n in cara_state["notifications"] if n.get("seq") == f"bk-{booking_id}-b") == 1)

    # comment push recalled when the comment is deleted
    status, up = upload(creator, "Fresh skin fade", b"\x89PNG fake-image-bytes" * 50)
    short_id = up["short"]["id"]
    status, com = customer.call("POST", "/api/comments", {"shortId": short_id, "text": "Clean lines, who did this?"})
    comment_id = com["comment"]["id"]
    check("comment pushes the creator", bool(wait_for(lambda: vs.pushes_to(ana_topic, "commented"))))
    customer.call("DELETE", f"/api/comments/{comment_id}")
    _, ana_state = creator.call("GET", "/api/state")
    seqs = [n["seq"] for n in app.s.all("notif") if n.get("ref") == f"comment:{comment_id}"]
    check("deleted comment's notification leaves the in-app feed", not seqs and not any("commented" in n["title"] for n in ana_state["notifications"]))
    check("deleted comment's push is recalled (DELETE)", bool(wait_for(lambda: actions_for(ana_topic, "DELETE"))))

    # read in app = cleared from the drawer
    before = len(actions_for(cara_topic, "PUT"))
    barber.call("POST", "/api/notifications/read")
    check("reading in the app clears pushes from the phone's drawer (PUT …/clear)",
          bool(wait_for(lambda: len([a for a in actions_for(cara_topic, "PUT") if a[1].endswith("/clear")]) > before)))

    # private previews
    customer.call("PUT", "/api/me/push", {"preview": "private"})
    status, dm = barber.call("POST", "/api/dm", {"barberId": cara_id}) if False else customer.call("POST", "/api/dm", {"barberId": cara_id})
    barber.call("PUT", "/api/me/push", {"preview": "private"})
    customer.call("POST", f"/api/threads/{dm['threadId']}/messages", {"text": "See you Friday at 3"})
    private_push = wait_for(lambda: [p for p in NtfyStub.received if p.get("topic") == cara_topic and p.get("title") == "Fade"])
    check("private previews: push shows no sender or text", bool(private_push) and "Friday" not in json.dumps(private_push))
    _, cara_state = barber.call("GET", "/api/state")
    check("…while the in-app feed still has the full message", any("Message from Ben" in n["title"] for n in cara_state["notifications"]))

    # 'remove from my devices'
    status, result = barber.call("POST", "/api/notifications/recall")
    check("'remove Fade notifications from my devices' recalls every push", status == 200 and result.get("recalled", 0) >= 1, str(result))

    # rotating the topic deletes what was sent to the old one
    old_topic = ben_topic
    app.notify(booked["booking"]["userId"], "Ping", "x", seq="ping-1")
    status, rotated = customer.call("PUT", "/api/me/push", {"rotate": True})
    check("rotating the topic recalls pushes sent to the old topic",
          rotated["notify"] != old_topic and bool(wait_for(lambda: (("DELETE", f"/{old_topic}/ping-1") in NtfyStub.actions))))
    ben_topic = rotated["notify"]

    # ======================= 3. automatic scanning =======================
    status, blocked = upload(creator, "totally normal", b"\x89PNG explicit" * 50, scan={"nsfw": 0.93, "sexy": 0.05})
    files_before = len(list(app.s.media_dir.iterdir()))
    check("explicit upload (on-device verdict) is refused", status == 422, str(blocked))
    status, held = upload(creator, "borderline", b"\x89PNG borderline" * 50, scan={"nsfw": 0.62, "sexy": 0.3})
    held_id = held["short"]["id"]
    check("borderline upload is accepted but held", status == 200 and held.get("scan") == "review")
    _, queue = admin.call("GET", "/api/mod")
    item = next((q for q in queue["queue"] if q["target"] == f"short:{held_id}"), None)
    check("held upload is hidden and queued as an automatic flag", bool(item) and item["hidden"] and item["auto"] == ["nudity"], str(item))
    _, ben_state = customer.call("GET", "/api/state")
    check("held upload is invisible to others", all(s["id"] != held_id for s in ben_state["shorts"]))
    check("owner is told it's held for review", bool(wait_for(lambda: vs.pushes_to(ana_topic, "held for review"))))
    admin.call("POST", "/api/mod", {"action": "keep", "target": f"short:{held_id}"})
    _, ben_state = customer.call("GET", "/api/state")
    check("moderator 'keep' publishes it", any(s["id"] == held_id for s in ben_state["shorts"]))

    status, unscanned = upload(creator, "no scan from a modified client", b"\x89PNG unscanned" * 50, scan=None)
    unscanned_id = unscanned["short"]["id"]
    _, queue = admin.call("GET", "/api/mod")
    check("uploads without an on-device scan are listed for a moderator-device scan",
          any(u["id"] == unscanned_id for u in queue["unscanned"]))
    status, scanned = admin.call("POST", "/api/mod", {"action": "scan", "target": unscanned_id, "scan": {"nsfw": 0.91, "sexy": 0.1}})
    _, ben_state = customer.call("GET", "/api/state")
    check("moderator-device scan hides an explicit unscanned upload",
          scanned.get("verdict") == "block" and all(s["id"] != unscanned_id for s in ben_state["shorts"]), str(scanned))
    status, _ = customer.call("POST", "/api/mod", {"action": "scan", "target": unscanned_id, "scan": {"nsfw": 0, "sexy": 0}})
    check("only moderators can submit scans", status == 403)

    # text: obfuscated slurs, link spam, floods, bursts
    for text in ("k.y.s", "n1gg3r", "kiiill yourself", "K Y S !!"):
        status, _ = customer.call("POST", "/api/comments", {"shortId": short_id, "text": text})
        check(f"obfuscated blocked phrase refused: {text!r}", status == 400)
    for text in ("skill yourself up with this fade", "the sky is clean", "Niger delta trip next week"):
        status, _ = customer.call("POST", "/api/comments", {"shortId": short_id, "text": text})
        check(f"normal text allowed: {text!r}", status == 200)
    status, err = customer.call("POST", "/api/comments", {"shortId": short_id, "text": "cheap cuts at www.scam-fades.xyz"})
    check("brand-new accounts can't post links", status == 400 and "links" in err.get("error", ""), str(err))
    status, err = admin.call("POST", "/api/comments", {"shortId": short_id, "text": "cuts.com fades.net blades.org shop.xyz"})
    check("link floods refused even for trusted accounts", status == 400)
    statuses = [customer.call("POST", "/api/comments", {"shortId": short_id, "text": "FOLLOW ME FOR FREE CUTS"})[0] for _ in range(3)]
    check("copy-paste flood: 3rd identical comment refused", statuses[:2] == [200, 200] and statuses[2] == 400, str(statuses))
    statuses = [customer.call("POST", "/api/comments", {"shortId": short_id, "text": f"nice one #{i}"})[0] for i in range(12)]
    check("comment burst is rate limited (429)", 429 in statuses, str(statuses))

    # ban recalls the pushes the banned account caused
    actor_before = [n for n in app.s.all("notif") if n.get("actor") == ben["user"]["id"]]
    admin.call("POST", "/api/mod", {"action": "ban", "target": ben["user"]["id"]})
    check("ban recalls the banned account's pushes from other people's phones",
          bool(actor_before) and not [n for n in app.s.all("notif") if n.get("actor") == ben["user"]["id"]])

    # perceptual hash: re-uploads of removed media are blocked (needs real ffmpeg)
    if REAL_FFMPEG:
        app.ffmpeg = REAL_FFMPEG
        tmp = Path(data_dir) / "imgs"
        tmp.mkdir()
        original = make_image(tmp / "a.png", "testsrc2=size=480x640:rate=1")
        altered = make_image(tmp / "a2.jpg", "testsrc2=size=480x640:rate=1", "scale=420:560,eq=brightness=0.04")
        different = make_image(tmp / "b.png", "mandelbrot=size=480x640:rate=1")
        status, first = upload(creator, "original upload", original)
        first_id = first["short"]["id"]
        check("media gets a perceptual hash", bool(wait_for(lambda: (app.s.get("short", first_id)["media"].get("phash")))))
        admin.call("POST", "/api/mod", {"action": "hide", "target": f"short:{first_id}"})
        _, queue = admin.call("GET", "/api/mod")
        check("hiding blocks its hash", queue["blockedHashes"] >= 1)
        status, again = upload(creator, "same picture, resized + brightened", altered, content_type="image/jpeg")
        again_id = again["short"]["id"]
        check("re-upload of removed media is hidden automatically",
              bool(wait_for(lambda: app.is_hidden("short", again_id))), str(app.s.get("short", again_id)["media"]))
        status, other = upload(creator, "a different picture", different)
        other_id = other["short"]["id"]
        wait_for(lambda: app.s.get("short", other_id)["media"].get("phash"))
        check("different media is not affected", not app.is_hidden("short", other_id))
    else:
        print("(no real ffmpeg: perceptual-hash checks skipped)")

    # ======================= 2. ffmpeg without pre-installing it =======================
    with tempfile.TemporaryDirectory() as tmp:
        wheel_path, digest = fake_wheel(tmp)
        FileServer.root = tmp
        file_server = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), FileServer)
        threading.Thread(target=file_server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{file_server.server_port}/{wheel_path.name}"
        key = server_module.platform_key()
        cache = Path(tmp) / "bin"
        got = server_module.fetch_ffmpeg(cache, {key: (url, digest)})
        check("ffmpeg is downloaded, SHA-256 verified and cached when missing", got.exists() and server_module.working_ffmpeg(got))
        bad_cache = Path(tmp) / "bad"
        try:
            server_module.fetch_ffmpeg(bad_cache, {key: (url, "0" * 64)})
            check("tampered download is rejected", False)
        except RuntimeError as err:
            check("tampered download is rejected", "SHA-256" in str(err) and not (bad_cache / "ffmpeg").exists())
        file_server.shutdown()
        check("pinned builds exist for macOS, Linux and Windows",
              {("darwin", "arm64"), ("darwin", "x86_64"), ("linux", "x86_64"), ("linux", "aarch64"), ("win32", "amd64")}
              <= set(server_module.FFMPEG_WHEELS))

    if REAL_FFMPEG:
        # backlog: a video uploaded while ffmpeg was still downloading gets transcoded once it arrives
        app.ffmpeg = None
        source = Path(data_dir) / "clip.mp4"
        subprocess.run([REAL_FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=24",
                        "-t", "2", "-pix_fmt", "yuv420p", str(source)], check=True, capture_output=True, timeout=120)
        meta = {"caption": "uploaded before ffmpeg", "category": "Cut reveal", "tags": [], "duration": 2,
                "scan": {"nsfw": 0.01, "sexy": 0.01}}
        header = base64.b64encode(json.dumps(meta).encode()).decode()
        status, up = creator.call("POST", "/api/shorts", raw=source.read_bytes(), headers={"Content-Type": "video/mp4", "X-Fade-Meta": header})
        pending_id = up["short"]["id"]
        cache = Path(data_dir) / "bin"
        cache.mkdir(exist_ok=True)
        shutil.copy(REAL_FFMPEG, cache / "ffmpeg")
        app.provision_ffmpeg()  # finds the cached binary and processes the backlog
        done = wait_for(lambda: app.s.get("short", pending_id)["media"].get("transcoded"), timeout=90)
        check("backlog: videos uploaded before ffmpeg arrived are transcoded afterwards", bool(done))

    if os.environ.get("FADE_TEST_DOWNLOAD") == "1":
        with tempfile.TemporaryDirectory() as tmp:
            started = time.time()
            got = server_module.fetch_ffmpeg(Path(tmp))
            version = subprocess.run([str(got), "-version"], capture_output=True, text=True).stdout.splitlines()[0]
            check("real pinned static ffmpeg downloads and runs", "ffmpeg version" in version, version)
            print(f"(downloaded {version} in {time.time() - started:.0f} s)")


def main():
    server_module = vs.load_server()
    ntfy = ThreadingHTTPServer(("127.0.0.1", vs.free_port()), NtfyStub)
    threading.Thread(target=ntfy.serve_forever, daemon=True).start()
    ntfy_url = f"http://127.0.0.1:{ntfy.server_port}/"
    with tempfile.TemporaryDirectory() as data_dir:
        port = vs.free_port()
        server = server_module.make_server("127.0.0.1", port, data_dir, quiet=True, admins=["mod@example.com"], ntfy=ntfy_url)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            run(f"http://127.0.0.1:{port}", server_module, data_dir, ntfy_url)
        except Exception as err:
            import traceback
            traceback.print_exc()
            vs.FAILURES.append(f"crash: {err}")
        finally:
            server.shutdown()
            server.server_close()
            ntfy.shutdown()
    print(f"fade limits: {len(vs.PASSES)} checks passed, {len(vs.FAILURES)} failed")
    for failure in vs.FAILURES:
        print("  FAIL", failure)
    return 1 if vs.FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
