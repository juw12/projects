#!/usr/bin/env python3
"""End-to-end test for Orbis Chat (multi-user, real-time).

Standard library only. Starts an isolated server on a free port with a
temporary database, uploads folder and email outbox, then signs up several
users and exercises accounts, direct/group/team chat, live delivery over
Server-Sent Events, read receipts, typing, reactions, edits, attachments,
search, invites, email outbox, password reset and account deletion.

Run:
    python tests/verify_chat.py
"""

from __future__ import annotations

import http.client
import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from email import message_from_bytes
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server" / "server.py"
HOST = os.environ.get("ORBIS_TEST_HOST", "127.0.0.1")

PASSED = 0
FAILED = 0


def check(condition, label):
    global PASSED, FAILED
    if condition:
        PASSED += 1
        print("  ok  - %s" % label)
    else:
        FAILED += 1
        print("  FAIL - %s" % label)


def free_port():
    family = socket.AF_INET6 if ":" in HOST else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.bind((HOST, 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class Client:
    def __init__(self, base):
        self.base = base
        self.token = None
        self.user = None

    def call(self, method, path, body=None, raw=None, headers=None):
        hdrs = dict(headers or {})
        data = None
        if raw is not None:
            data = raw
        elif body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        if self.token:
            hdrs["Authorization"] = "Bearer " + self.token
        req = urllib.request.Request(self.base + "/api/chat/" + path, data=data,
                                     method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                payload = resp.read()
                status = resp.status
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as err:
            payload = err.read()
            status = err.code
            ctype = err.headers.get("Content-Type", "")
        if "json" in ctype:
            return status, json.loads(payload.decode("utf-8"))
        return status, payload


class EventStream:
    """Minimal SSE reader running in a background thread."""

    def __init__(self, host, port, token):
        self.events = queue.Queue()
        self.conn = http.client.HTTPConnection(host, port, timeout=30)
        self.conn.request("GET", "/api/chat/events?token=" + token)
        self.response = self.conn.getresponse()
        self.status = self.response.status
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def _read(self):
        try:
            while True:
                line = self.response.fp.readline()
                if not line:
                    break
                line = line.decode("utf-8").rstrip("\n")
                if line.startswith("data: "):
                    self.events.put(json.loads(line[6:]))
        except Exception:
            pass

    def wait_for(self, predicate, timeout=5.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                event = self.events.get(timeout=max(0.05, deadline - time.time()))
            except queue.Empty:
                break
            if predicate(event):
                return event
        return None

    def close(self):
        try:
            self.conn.sock.shutdown(socket.SHUT_RDWR)
        except Exception:
            pass
        self.conn.close()


def outbox_messages(folder):
    result = []
    if folder.exists():
        for path in sorted(folder.glob("*.eml")):
            result.append(message_from_bytes(path.read_bytes()))
    return result


def wait_for_email(folder, to_address, subject_part, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        for msg in outbox_messages(folder):
            if msg["To"] == to_address and subject_part in msg["Subject"]:
                return msg
        time.sleep(0.1)
    return None


def main():
    tmp = Path(tempfile.mkdtemp(prefix="orbis-chat-test-"))
    outbox = tmp / "outbox"
    port = free_port()
    env = dict(os.environ)
    env.update({
        "ORBIS_DB": str(tmp / "orbis.db"),
        "ORBIS_OUTBOX": str(outbox),
        "ORBIS_UPLOADS": str(tmp / "uploads"),
        "ORBIS_PBKDF2_ITERATIONS": "2000",
        "ORBIS_PUBLIC_URL": "https://orbis.example/",
    })
    for key in ("ORBIS_SMTP_HOST", "ORBIS_ALLOW_SIGNUP"):
        env.pop(key, None)
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--port", str(port), "--host", HOST, "--no-browser"],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    display = "[%s]" % HOST if ":" in HOST else HOST
    base = "http://%s:%d" % (display, port)
    streams = []
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/health", timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)

        anon = Client(base)
        alice, bob, carol, dave = Client(base), Client(base), Client(base), Client(base)

        print("accounts")
        status, cfg = anon.call("GET", "config")
        check(status == 200 and cfg["signupOpen"] is True, "config is public and sign-up is open")
        check(cfg["emailEnabled"] is False, "config reports email in dev-outbox mode")
        for client, name, email in ((alice, "Alice", "alice@example.com"),
                                    (bob, "Bob", "Bob@Example.com"),
                                    (carol, "Carol", "carol@example.com")):
            status, data = client.call("POST", "auth/register",
                                       {"name": name, "email": email, "password": "correct horse"})
            client.token = data.get("token")
            client.user = data.get("user")
            check(status == 200 and client.token, "register %s" % name)
        check(bob.user["email"] == "bob@example.com", "emails are normalised to lower case")
        status, data = anon.call("POST", "auth/register",
                                 {"name": "Dup", "email": "alice@example.com", "password": "12345678"})
        check(status == 409, "duplicate email is rejected (409)")
        status, data = anon.call("POST", "auth/register",
                                 {"name": "Weak", "email": "weak@example.com", "password": "123"})
        check(status == 400, "short password is rejected (400)")
        status, data = anon.call("POST", "auth/login", {"email": "alice@example.com", "password": "nope"})
        check(status == 401, "wrong password is rejected (401)")
        status, data = anon.call("POST", "auth/login",
                                 {"email": "ALICE@example.com", "password": "correct horse"})
        check(status == 200 and data["user"]["id"] == alice.user["id"], "login works (case-insensitive email)")
        status, data = anon.call("GET", "me")
        check(status == 401, "API requires sign-in (401)")
        status, data = alice.call("PATCH", "me", {"status": "Shipping Orbis", "color": "#0D9488"})
        check(status == 200 and data["user"]["status"] == "Shipping Orbis", "profile update")

        print("real-time direct messages")
        alice_stream = EventStream(HOST, port, alice.token)
        streams.append(alice_stream)
        check(alice_stream.status == 200, "alice opens live event stream")
        hello = alice_stream.wait_for(lambda e: e["type"] == "hello")
        check(hello is not None and hello["userId"] == alice.user["id"], "stream says hello")

        status, data = alice.call("POST", "conversations", {"kind": "direct", "email": "bob@example.com"})
        dm = data.get("conversation", {})
        check(status == 200 and dm.get("kind") == "direct" and dm.get("name") == "Bob",
              "alice starts a DM with bob by email")
        status, again = alice.call("POST", "conversations", {"kind": "direct", "userId": bob.user["id"]})
        check(again["conversation"]["id"] == dm["id"], "starting the same DM again reuses it")

        bob_stream = EventStream(HOST, port, bob.token)
        streams.append(bob_stream)
        bob_stream.wait_for(lambda e: e["type"] == "hello")
        presence = alice_stream.wait_for(lambda e: e["type"] == "presence" and e["userId"] == bob.user["id"])
        check(presence is not None and presence["online"] is True, "alice sees bob come online")

        status, data = alice.call("POST", "conversations/%d/messages" % dm["id"],
                                  {"body": "Hi Bob! Orbis is live 🎉", "clientId": "c-1"})
        msg = data.get("message", {})
        check(status == 200 and msg.get("body") == "Hi Bob! Orbis is live 🎉", "alice sends a message")
        live = bob_stream.wait_for(lambda e: e["type"] == "message" and e["message"]["id"] == msg["id"])
        check(live is not None, "bob receives it instantly over the live stream")
        status, retry = alice.call("POST", "conversations/%d/messages" % dm["id"],
                                   {"body": "Hi Bob! Orbis is live 🎉", "clientId": "c-1"})
        check(retry["message"]["id"] == msg["id"], "retried send with same clientId is not duplicated")

        status, data = bob.call("GET", "conversations")
        bob_dm = [c for c in data["conversations"] if c["id"] == dm["id"]]
        check(bob_dm and bob_dm[0]["unread"] == 1 and bob_dm[0]["name"] == "Alice",
              "bob's inbox shows the DM with 1 unread")
        check(bob_dm and bob_dm[0]["peer"]["online"] is True, "presence shows alice online")

        bob.call("POST", "conversations/%d/typing" % dm["id"])
        typing = alice_stream.wait_for(lambda e: e["type"] == "typing")
        check(typing is not None and typing["userId"] == bob.user["id"], "typing indicator relayed")

        status, data = bob.call("POST", "conversations/%d/read" % dm["id"], {"messageId": msg["id"]})
        receipt = alice_stream.wait_for(lambda e: e["type"] == "read" and e["userId"] == bob.user["id"])
        check(receipt is not None and receipt["lastReadId"] >= msg["id"], "alice gets bob's read receipt")

        status, data = bob.call("POST", "conversations/%d/messages" % dm["id"],
                                {"body": "Got it", "replyTo": msg["id"]})
        reply = data.get("message", {})
        check(reply.get("replyTo", {}).get("id") == msg["id"], "bob replies (quoted reply)")
        status, data = alice.call("POST", "messages/%d/reactions" % reply["id"], {"emoji": "👍"})
        check(data["message"]["reactions"].get("👍") == [alice.user["id"]], "alice reacts 👍")
        updated = bob_stream.wait_for(lambda e: e["type"] == "message_updated")
        check(updated is not None, "bob sees the reaction live")
        status, data = alice.call("PATCH", "messages/%d" % reply["id"], {"body": "hacked"})
        check(status == 403, "you cannot edit someone else's message (403)")
        status, data = bob.call("PATCH", "messages/%d" % reply["id"], {"body": "Got it, thanks!"})
        check(status == 200 and data["message"]["editedAt"], "bob edits his message")
        status, data = bob.call("DELETE", "messages/%d" % reply["id"])
        check(status == 200 and data["message"]["deleted"] and data["message"]["body"] == "",
              "bob deletes his message (content wiped)")

        status, data = carol.call("GET", "conversations/%d/messages" % dm["id"])
        check(status == 404, "outsiders cannot read a private DM (404)")

        print("teams, invites and channels")
        status, data = alice.call("POST", "teams", {"name": "Northwind Studio"})
        team = data.get("team", {})
        check(status == 200 and team.get("role") == "owner", "alice creates a team (owner)")
        status, detail = alice.call("GET", "teams/%d" % team["id"])
        general = [c for c in detail["channels"] if c["isDefault"]]
        check(general and general[0]["name"] == "general", "team starts with #general")

        status, data = alice.call("POST", "teams/%d/invites" % team["id"], {"email": "carol@example.com"})
        check(status == 200 and data["emailed"] and "invite=" in data["link"], "invite carol by email")
        invite_mail = wait_for_email(outbox, "carol@example.com", "invited you")
        check(invite_mail is not None and "https://orbis.example/chat.html?invite=" in
              invite_mail.get_payload(decode=True).decode(), "invite email written with public link")
        status, data = carol.call("GET", "teams")
        check(any(t["id"] == team["id"] for t in data["teams"]), "existing user carol is added to the team")

        status, link = alice.call("POST", "teams/%d/invites" % team["id"], {})
        status, info = anon.call("GET", "invites/%s" % link["code"])
        check(status == 200 and info["team"]["name"] == "Northwind Studio", "invite link preview is public")
        status, data = dave.call("POST", "auth/register",
                                 {"name": "Dave", "email": "dave@example.com", "password": "correct horse"})
        dave.token = data["token"]
        dave.user = data["user"]
        status, data = dave.call("POST", "invites/%s/accept" % link["code"])
        check(status == 200 and data["team"]["id"] == team["id"], "dave joins via shareable link")
        status, data = dave.call("GET", "conversations")
        check(any(c["id"] == general[0]["id"] for c in data["conversations"]),
              "new member is auto-added to #general")

        status, data = alice.call("POST", "teams/%d/channels" % team["id"], {"name": "Design Crit", "topic": "Fri"})
        channel = data.get("conversation", {})
        check(status == 200 and channel.get("name") == "design-crit", "create #design-crit (slugified)")
        status, data = bob.call("POST", "conversations/%d/join" % channel["id"])
        check(status == 404, "non-members of the team cannot join its channels")
        status, data = dave.call("POST", "conversations/%d/join" % channel["id"])
        check(status == 200, "team member joins a channel")
        status, data = dave.call("DELETE", "teams/%d/members/%d" % (team["id"], carol.user["id"]))
        check(status == 403, "regular members cannot remove people")
        status, data = alice.call("PATCH", "teams/%d/members/%d" % (team["id"], dave.user["id"]), {"role": "admin"})
        check(status == 200, "owner promotes dave to admin")

        print("groups, attachments, search")
        status, data = alice.call("POST", "conversations",
                                  {"kind": "group", "name": "Launch crew",
                                   "userIds": [bob.user["id"], carol.user["id"]]})
        group = data.get("conversation", {})
        check(status == 200 and len(group.get("members", [])) == 3, "alice creates a 3-person group")
        status, data = alice.call("POST", "conversations/%d/members" % group["id"],
                                  {"emails": ["nobody@example.com"]})
        check(status == 404 and "invite" in data["error"], "adding an unknown email asks to invite them")
        status, data = alice.call("PATCH", "conversations/%d" % group["id"], {"name": "Launch crew 🚀"})
        check(data["conversation"]["name"] == "Launch crew 🚀", "group renamed")

        png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
        status, data = alice.call("POST", "uploads", raw=png,
                                  headers={"Content-Type": "image/png", "X-Filename": "mock%20up.png"})
        upload = data.get("upload", {})
        check(status == 200 and upload.get("inline") is True and upload["name"] == "mock up.png",
              "image upload accepted")
        status, data = alice.call("POST", "conversations/%d/messages" % group["id"],
                                  {"body": "First mock-up for the launch", "attachmentId": upload["id"]})
        check(data["message"]["attachment"]["id"] == upload["id"], "message with attachment")
        status, payload = anon.call("GET", "uploads/%s" % upload["id"])
        check(status == 200 and payload == png, "attachment downloads byte-for-byte")
        offline_mail = wait_for_email(outbox, "carol@example.com", "New message from Alice")
        check(offline_mail is not None, "offline member carol gets an email notification")

        status, data = bob.call("GET", "search?q=mock-up")
        check(status == 200 and any(r["conversationId"] == group["id"] for r in data["results"]),
              "message search finds results in your conversations")
        status, data = dave.call("GET", "search?q=mock-up")
        check(not data["results"], "search never leaks other people's conversations")
        status, data = bob.call("GET", "users?q=dave")
        check(not data["users"], "strangers are not discoverable by partial name")
        status, data = bob.call("GET", "users?q=dave@example.com")
        check(len(data["users"]) == 1, "anyone is reachable by exact email")

        print("security and account lifecycle")
        conn = http.client.HTTPConnection(HOST, port, timeout=5)
        conn.request("OPTIONS", "/api/chat/me")
        resp = conn.getresponse()
        headers_ok = "Authorization" in (resp.getheader("Access-Control-Allow-Headers") or "")
        conn.close()
        check(resp.status == 204 and headers_ok, "CORS preflight allows Authorization (for GitHub Pages / apps)")

        status, data = anon.call("POST", "auth/reset/request", {"email": "bob@example.com"})
        check(status == 200, "password reset requested")
        reset_mail = wait_for_email(outbox, "bob@example.com", "reset code")
        code = None
        if reset_mail is not None:
            text = reset_mail.get_payload(decode=True).decode()
            code = text.split("reset code is: ")[1][:6]
        status, data = anon.call("POST", "auth/reset/confirm",
                                 {"email": "bob@example.com", "code": "000000", "password": "brand new pass"})
        check(status == 400, "wrong reset code is rejected")
        old_token = bob.token
        status, data = anon.call("POST", "auth/reset/confirm",
                                 {"email": "bob@example.com", "code": code, "password": "brand new pass"})
        check(status == 200 and data.get("token"), "reset with emailed code signs bob in")
        probe = Client(base)
        probe.token = old_token
        status, data = probe.call("GET", "me")
        check(status == 401, "old sessions are revoked after reset")

        status, data = dave.call("POST", "auth/logout")
        status, data = dave.call("GET", "me")
        check(status == 401, "logout invalidates the session")

        status, data = carol.call("POST", "me/delete", {"password": "wrong"})
        check(status == 403, "account deletion requires the password")
        status, data = carol.call("POST", "me/delete", {"password": "correct horse"})
        check(status == 200, "carol deletes her account")
        status, data = alice.call("GET", "conversations/%d" % group["id"])
        names = [m["name"] for m in data["conversation"]["members"]]
        check("Carol" not in names, "deleted users leave their groups")

        log = b""
    finally:
        for stream in streams:
            stream.close()
        proc.terminate()
        try:
            log = proc.communicate(timeout=5)[0]
        except subprocess.TimeoutExpired:
            proc.kill()
            log = proc.communicate()[0]
        shutil.rmtree(tmp, ignore_errors=True)

    check(b"token=***" in log or b"/api/chat/events" not in log, "session tokens are redacted from logs")
    leaked = alice.token and alice.token.encode() in log
    check(not leaked, "no raw session token appears in the server log")
    print()
    print("%d passed, %d failed" % (PASSED, FAILED))
    sys.exit(1 if FAILED else 0)


if __name__ == "__main__":
    main()
