#!/usr/bin/env python3
"""Moderation, push notifications and video transcoding on the self-hosted Fade server.

Standard library only. Starts server/server.py on a free port with:
  * a moderator account (--admin),
  * a local ntfy stub that records every push,
  * a stand-in ffmpeg (copies the file) so the transcode pipeline runs everywhere;
    if a real ffmpeg is on PATH (or FADE_TEST_FFMPEG points to one) it also runs a
    real 1080x1920 -> 720x1280 H.264 transcode.
Exit code 0 on success, 1 on failure.
"""

import base64
import importlib.util
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
PASSES, FAILURES = [], []


def check(name, condition, detail=""):
    (PASSES if condition else FAILURES).append(name if condition else f"{name} {detail}")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def load_server():
    spec = importlib.util.spec_from_file_location("fade_server_safety", APP_DIR / "server" / "server.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Client:
    def __init__(self, base, token=None):
        self.base, self.token = base, token

    def call(self, method, path, body=None, raw=None, headers=None):
        all_headers = dict(headers or {})
        data = raw
        if body is not None:
            data = json.dumps(body).encode()
            all_headers["Content-Type"] = "application/json"
        if self.token:
            all_headers["Authorization"] = "Bearer " + self.token
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=all_headers)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                payload = response.read()
                is_json = "json" in response.headers.get("Content-Type", "")
                return response.status, json.loads(payload) if is_json else payload
        except urllib.error.HTTPError as err:
            payload = err.read()
            try:
                payload = json.loads(payload)
            except ValueError:
                pass
            return err.code, payload


def register(base, name, email, role="customer", **extra):
    client = Client(base)
    status, data = client.call("POST", "/api/auth/register", {"name": name, "email": email, "password": "correct horse 1", "role": role, **extra})
    check(f"register {email}", status == 200, str(data))
    client.token = data.get("token")
    return client


def login(base, email):
    client = Client(base)
    status, data = client.call("POST", "/api/auth/login", {"email": email, "password": "correct horse 1"})
    client.token = data.get("token") if status == 200 else None
    return client, status


def upload(client, caption, content_type="video/mp4", payload=None, optimized=False):
    meta = {"caption": caption, "category": "Cut reveal", "tags": [], "duration": 3, "optimized": optimized}
    header = base64.b64encode(json.dumps(meta).encode()).decode()
    return client.call("POST", "/api/shorts", raw=payload or bytes(range(256)) * 40,
                       headers={"Content-Type": content_type, "X-Fade-Meta": header})


def wait_for(fn, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        value = fn()
        if value:
            return value
        time.sleep(0.1)
    return fn()


class NtfyStub(BaseHTTPRequestHandler):
    received = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        NtfyStub.received.append(json.loads(self.rfile.read(length) or b"{}"))
        body = b'{"id":"stub"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def pushes_to(topic, title_part=""):
    return [p for p in NtfyStub.received if p.get("topic") == topic and title_part in p.get("title", "")]


FAKE_FFMPEG = r'''#!/usr/bin/env python3
import shutil, sys
args = sys.argv[1:]
source = args[args.index("-i") + 1]
target = args[-1]
if target.endswith(".jpg"):
    open(target, "wb").write(b"\xff\xd8\xff\xe0fakejpeg\xff\xd9")
else:
    shutil.copyfile(source, target)
'''


def run(base, server_module, data_dir):
    app = server_module.Handler.app

    def place_local_now():
        return datetime.now(server_module.tz_for(app.place("p1")))

    admin = register(base, "Mo Derator", "mod@example.com")
    creator = register(base, "Ana Creator", "ana@example.com")
    customer = register(base, "Ben Client", "ben@example.com")
    r1 = register(base, "Rae One", "rae1@example.com")
    r2 = register(base, "Rae Two", "rae2@example.com")
    barber = register(base, "Cara Blade", "cara@example.com", role="barber", barber={"price": 20, "city": "Jakarta"})

    # ---------------- push notifications ----------------
    _, ben_state = customer.call("GET", "/api/state")
    _, cara_state = barber.call("GET", "/api/state")
    ben_topic, cara_topic = ben_state["user"].get("notify"), cara_state["user"].get("notify")
    check("every account gets a private ntfy topic", bool(ben_topic) and ben_topic.startswith("fade-") and ben_topic != cara_topic)
    check("state reports push enabled", ben_state["server"]["push"] is True)
    cara_id = cara_state["user"]["barberId"]
    status, _ = barber.call("PUT", "/api/studio/barber", {"schedule": [
        {"dow": d, "placeId": "p1", "from": 9, "to": 21} for d in range(7)]})
    check("barber sets shifts", status == 200)
    slot = None
    for offset in range(1, 10):
        key = (place_local_now().date() + timedelta(days=offset)).isoformat()
        _, slots = customer.call("GET", f"/api/slots?barber={cara_id}&date={key}&mins=45")
        free = [s for g in slots.get("groups", []) for s in g["slots"] if not s["taken"]]
        if free:
            slot = (key, free[0]["t"])
            break
    check("found a free slot", slot is not None)
    _, card = customer.call("POST", "/api/cards", {"brand": "Visa", "last4": "4242", "exp": "12/30"})
    customer.call("POST", "/api/wallet/topup", {"amount": 100, "cardId": card["card"]["id"]})
    status, booked = customer.call("POST", "/api/bookings", {"barberId": cara_id, "serviceId": "s1", "date": slot[0], "time": slot[1],
                                                           "placeId": "p1", "payMode": "full", "method": "wallet"})
    check("customer books the real barber", status == 200, str(booked))
    booking_id = booked["booking"]["id"]
    check("customer gets a booking push", bool(wait_for(lambda: pushes_to(ben_topic, "booked"))))
    check("barber gets a new-booking push", bool(wait_for(lambda: pushes_to(cara_topic, "New booking"))))
    _, ben_state = customer.call("GET", "/api/state")
    check("in-app notification feed", any("booked" in n["title"] for n in ben_state["notifications"]))
    customer.call("POST", "/api/notifications/read")
    _, ben_state = customer.call("GET", "/api/state")
    check("notifications marked read", all(n["read"] for n in ben_state["notifications"]))

    status, dm = customer.call("POST", "/api/dm", {"barberId": cara_id})
    customer.call("POST", f"/api/threads/{dm['threadId']}/messages", {"text": "Can I bring a reference photo?"})
    check("DM pushes the barber", bool(wait_for(lambda: pushes_to(cara_topic, "Message from Ben"))))

    # 2 h reminder: move the booking to start in 90 minutes (place time) and run the sweeper
    with app.s.lock:
        doc = app.s.get("booking", booking_id)
        soon = place_local_now() + timedelta(minutes=90)
        doc["date"], doc["time"] = soon.date().isoformat(), soon.hour + soon.minute / 60
        app.s.put("booking", booking_id, doc)
        app.s.commit()
    check("sweeper sends exactly one due reminder", app.sweep() == 1)
    check("reminder push reached the client", bool(wait_for(lambda: pushes_to(ben_topic, "in 2 hours"))))
    check("barber also reminded", bool(wait_for(lambda: pushes_to(cara_topic, "Client in 2 hours"))))
    check("reminder is not sent twice", app.sweep() == 0)

    status, _ = customer.call("PUT", "/api/me/push", {"rotate": True})
    _, ben_state = customer.call("GET", "/api/state")
    check("topic can be rotated", status == 200 and ben_state["user"]["notify"] != ben_topic)
    check("push failures never break requests (no ntfy errors)", all(p["status"] == 200 for p in app.push_log), str(app.push_log[-3:]))

    # ---------------- comments + blocked words ----------------
    status, up = upload(creator, "Fresh taper #taper")
    check("creator uploads a short", status == 200, str(up))
    short_id = up["short"]["id"]
    _, ana_state = creator.call("GET", "/api/state")
    ana_topic, ana_id = ana_state["user"]["notify"], ana_state["user"]["id"]
    status, comment = customer.call("POST", "/api/comments", {"shortId": short_id, "text": "Clean blend 🔥"})
    check("comment posted", status == 200, str(comment))
    check("short owner pushed about the comment", bool(wait_for(lambda: pushes_to(ana_topic, "commented"))))
    status, _ = customer.call("POST", "/api/comments", {"shortId": short_id, "text": "kys loser"})
    check("blocked words rejected in comments", status == 400)
    status, _ = upload(customer, "kill yourself lol")
    check("blocked words rejected in captions", status == 400)
    _, ben_state = customer.call("GET", "/api/state")
    short_doc = next(s for s in ben_state["shorts"] if s["id"] == short_id)
    check("comment count + list in state", short_doc["comments"] == 1 and any(c["id"] == comment["comment"]["id"] for c in ben_state["comments"]))
    status, _ = r1.call("DELETE", f"/api/comments/{comment['comment']['id']}")
    check("strangers can't delete comments", status == 403)
    status, _ = creator.call("DELETE", f"/api/comments/{comment['comment']['id']}")
    check("short owner can delete comments on their short", status == 200)

    # ---------------- moderation ----------------
    status, _ = r1.call("POST", "/api/report", {"target": short_id, "reason": "bogus"})
    check("report needs a valid reason", status == 400)
    status, _ = creator.call("POST", "/api/report", {"target": short_id, "reason": "spam"})
    check("can't report your own content", status == 400)
    status, rep = r1.call("POST", "/api/report", {"target": short_id, "reason": "spam", "note": "ad"})
    check("first report accepted", status == 200 and rep["reports"] == 1 and not rep["hidden"], str(rep))
    status, rep = r1.call("POST", "/api/report", {"target": f"short:{short_id}", "reason": "spam"})
    check("duplicate report from same person is ignored", status == 200 and rep.get("duplicate"))
    r2.call("POST", "/api/report", {"target": short_id, "reason": "not-haircut"})
    status, rep = customer.call("POST", "/api/report", {"target": short_id, "reason": "spam"})
    check("3 distinct reporters auto-hide the short", status == 200 and rep["hidden"] is True, str(rep))
    _, r1_state = r1.call("GET", "/api/state")
    check("hidden short disappears for others", all(s["id"] != short_id for s in r1_state["shorts"]))
    _, ana_state = creator.call("GET", "/api/state")
    own = next((s for s in ana_state["shorts"] if s["id"] == short_id), None)
    check("author still sees it, flagged hidden", own is not None and own.get("hidden") is True)
    check("author notified about the hide", bool(wait_for(lambda: pushes_to(ana_topic, "hidden"))))
    status, _ = r1.call("GET", "/api/mod")
    check("non-moderators can't open the queue", status == 403)
    _, admin_state = admin.call("GET", "/api/state")
    check("moderator flag + open-report count in state", admin_state["user"]["admin"] and admin_state["moderation"]["openReports"] == 3)
    check("moderator pushed about new reports", bool(wait_for(lambda: pushes_to(admin_state["user"]["notify"], "New report"))))
    status, queue = admin.call("GET", "/api/mod")
    item = next((q for q in queue.get("queue", []) if q["target"] == f"short:{short_id}"), None)
    check("queue groups reports per target", status == 200 and item and item["reporters"] == 3 and item["hidden"], str(queue)[:200])
    status, _ = admin.call("POST", "/api/mod", {"action": "keep", "target": f"short:{short_id}"})
    _, r1_state = r1.call("GET", "/api/state")
    check("moderator 'keep' restores the short", status == 200 and any(s["id"] == short_id for s in r1_state["shorts"]))
    status, queue = admin.call("GET", "/api/mod")
    check("kept reports leave the queue", all(q["target"] != f"short:{short_id}" for q in queue["queue"]))
    for client in (r1, r2):
        client.call("POST", "/api/report", {"target": short_id, "reason": "spam"})
    status, rep = Client(base, register(base, "Rae Three", "rae3@example.com").token).call("POST", "/api/report", {"target": short_id, "reason": "spam"})
    check("kept content isn't auto-hidden again", rep.get("hidden") is False, str(rep))
    status, _ = admin.call("POST", "/api/mod", {"action": "hide", "target": short_id})
    _, r1_state = r1.call("GET", "/api/state")
    check("moderator can hide directly", status == 200 and all(s["id"] != short_id for s in r1_state["shorts"]))
    admin.call("POST", "/api/mod", {"action": "unhide", "target": f"short:{short_id}"})

    status, _ = admin.call("POST", "/api/mod", {"action": "verify", "target": cara_id})
    _, ben_state = customer.call("GET", "/api/state")
    check("moderator verifies a barber", status == 200 and next(b for b in ben_state["barbers"] if b["id"] == cara_id).get("verified") is True)
    r1.call("POST", "/api/report", {"target": f"user:{ana_id}", "reason": "impersonation"})
    status, queue = admin.call("GET", "/api/mod")
    profile_item = next(q for q in queue["queue"] if q["target"] == f"user:{ana_id}")
    status, _ = admin.call("POST", "/api/mod", {"action": "dismiss", "target": profile_item["reports"][0]["id"]})
    status2, queue = admin.call("GET", "/api/mod")
    check("moderator dismisses a report", status == 200 and all(q["target"] != f"user:{ana_id}" for q in queue["queue"]))

    status, _ = admin.call("POST", "/api/mod", {"action": "ban", "target": f"user:{ana_id}"})
    check("moderator bans an account", status == 200)
    status, _ = creator.call("GET", "/api/state")
    check("ban signs the account out everywhere", status == 401)
    creator, status = login(base, "ana@example.com")
    _, ana_state = creator.call("GET", "/api/state")
    status, _ = upload(creator, "back again")
    check("banned account is read-only (403 on posts)", status == 403 and ana_state["user"]["suspended"] is True)
    status, _ = creator.call("POST", "/api/comments", {"shortId": short_id, "text": "hi"})
    check("banned account can't comment", status == 403)
    _, r1_state = r1.call("GET", "/api/state")
    check("banned account's shorts are hidden from others", all(s.get("userId") != ana_id for s in r1_state["shorts"]))
    admin.call("POST", "/api/mod", {"action": "unban", "target": ana_id})
    status, _ = upload(creator, "Unbanned taper")
    check("unban restores posting", status == 200)
    status, _ = admin.call("POST", "/api/mod", {"action": "ban", "target": admin_state["user"]["id"]})
    check("moderators can't ban themselves", status == 400)

    # ---------------- transcoding ----------------
    fake = Path(data_dir) / "fake-ffmpeg"
    fake.write_text(FAKE_FFMPEG)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    app.ffmpeg = str(fake)
    status, up = upload(customer, "Mid fade transformation", content_type="video/webm")
    vid = up["short"]["id"]
    check("video upload accepted while transcoding", status == 200 and up["short"]["media"].get("processing") is True)

    def transcoded():
        _, st = customer.call("GET", "/api/state")
        doc = next((s for s in st["shorts"] if s["id"] == vid), None)
        return doc if doc and doc["media"].get("transcoded") else None

    doc = wait_for(transcoded)
    check("server transcodes to /media/<id>_720.mp4", bool(doc) and doc["media"]["url"].endswith("_720.mp4") and doc["media"]["type"] == "video/mp4", str(doc and doc["media"]))
    check("poster frame extracted", bool(doc) and str(doc["media"].get("poster", "")).endswith(".jpg"))
    if doc:
        status, body = Client(base).call("GET", doc["media"]["url"], headers={"Range": "bytes=0-99"})
        check("transcoded file streams with Range", status == 206 and len(body) == 100)
        check("original upload removed after transcode", not list(Path(data_dir, "media").glob(f"{vid}.webm")))
    status, up = upload(customer, "Already optimised in the browser", optimized=True)
    check("browser-optimised uploads skip server transcoding", status == 200 and not up["short"]["media"].get("processing"))

    real = os.environ.get("FADE_TEST_FFMPEG") or shutil.which("ffmpeg")
    if real:
        source = Path(data_dir) / "tall.mp4"
        subprocess.run([real, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=30", "-t", "2",
                        "-pix_fmt", "yuv420p", str(source)], check=True, timeout=120)
        app.ffmpeg = real
        status, up = upload(customer, "Real ffmpeg check", payload=source.read_bytes())
        vid = up["short"]["id"]
        doc = wait_for(transcoded, timeout=120)
        check("real ffmpeg transcode finished", bool(doc), "timed out")
        if doc:
            out = Path(data_dir, "media", Path(doc["media"]["url"]).name)
            info = subprocess.run([real, "-hide_banner", "-i", str(out)], capture_output=True, text=True).stderr
            check("real output is H.264 720x1280", "h264" in info and "720x1280" in info, info[-300:])
            check("real output is smaller than the source", out.stat().st_size < source.stat().st_size)
        print(f"(real ffmpeg: {real})")
    else:
        print("(real ffmpeg not found: ran the pipeline with a stand-in ffmpeg)")


def main():
    server_module = load_server()
    ntfy_port = free_port()
    ntfy = ThreadingHTTPServer(("127.0.0.1", ntfy_port), NtfyStub)
    threading.Thread(target=ntfy.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory() as data_dir:
        port = free_port()
        server = server_module.make_server("127.0.0.1", port, data_dir, quiet=True, admins=["mod@example.com"],
                                           ntfy=f"http://127.0.0.1:{ntfy_port}/")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            run(f"http://127.0.0.1:{port}", server_module, data_dir)
        except Exception as err:
            import traceback
            traceback.print_exc()
            FAILURES.append(f"crash: {err}")
        finally:
            server.shutdown()
            server.server_close()
            ntfy.shutdown()
    print(f"fade safety: {len(PASSES)} checks passed, {len(FAILURES)} failed")
    for failure in FAILURES:
        print("  FAIL", failure)
    return 1 if FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
