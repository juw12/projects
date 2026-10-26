#!/usr/bin/env python3
"""ME R&D Toolkit tests - hermetic, standard library only. Exit 0 on success, 1 on failure.

1. Static integrity: required web files exist, are UTF-8 and make no remote fetches.
2. Service-worker shell list points at files that exist.
3. Vault server: auth required, read-only listing/search, traversal and private files blocked,
   excluded folders hidden, downloads served, aliased paths resolve.
"""

import base64
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(BASE, "web")
SERVER = os.path.join(BASE, "server", "vault_server.py")

REQUIRED = [
    "index.html", "app.js", "views.js", "vault.js", "styles.css", "demo-pack.js",
    "manifest.webmanifest", "sw.js", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
]
FAILURES = []


def check(condition, message):
    if not condition:
        FAILURES.append(message)
        print("  FAIL:", message)


def test_static():
    for name in REQUIRED:
        path = os.path.join(WEB, name)
        check(os.path.isfile(path), "missing web/" + name)
        if name.endswith((".html", ".js", ".css", ".webmanifest")) and os.path.isfile(path):
            text = open(path, encoding="utf-8").read()
            check(not re.search(r"""(src|href)\s*=\s*["']https?://""", text), name + " loads a remote resource")
            check("fetch(\"http" not in text and "fetch('http" not in text, name + " fetches a remote URL")
    sw = open(os.path.join(WEB, "sw.js"), encoding="utf-8").read()
    for entry in re.findall(r'"\./([^"]*)"', sw):
        if entry:
            check(os.path.isfile(os.path.join(WEB, entry)), "sw.js shell entry missing: " + entry)


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_vault():
    tmp = tempfile.mkdtemp(prefix="me-rd-test-")
    try:
        docs = os.path.join(tmp, "share")
        os.makedirs(os.path.join(docs, "Guides", "Plastics"))
        os.makedirs(os.path.join(docs, "Personal"))
        with open(os.path.join(docs, "Guides", "Plastics", "rib design.txt"), "w", encoding="utf-8") as handle:
            handle.write("ribs 50-70 % of wall")
        with open(os.path.join(docs, "Personal", "secret.txt"), "w", encoding="utf-8") as handle:
            handle.write("private")
        with open(os.path.join(docs, "Guides", "salary notes.txt"), "w", encoding="utf-8") as handle:
            handle.write("hidden by name")
        private = os.path.join(tmp, "private")
        os.makedirs(private)
        port = free_port()
        config = {
            "title": "Test Vault", "host": "127.0.0.1", "port": port, "user": "team", "password": "pw-123",
            "strict": True,
            "roots": [{"id": "share", "name": "Team Share", "path": docs}],
            "exclude": ["share:Personal"],
            "excludeNames": ["*salary*"],
            "categories": [{"name": "Guides", "icon": "rules", "desc": "", "match": ["share:Guides"]}],
        }
        config_path = os.path.join(private, "vault_config.json")
        with open(config_path, "w", encoding="utf-8") as handle:
            json.dump(config, handle)
        env = dict(os.environ, ME_PRIVATE_DIR=private)
        proc = subprocess.Popen([sys.executable, SERVER, config_path], env=env,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        base_url = "http://127.0.0.1:%d" % port
        token = "Basic " + base64.b64encode(b"team:pw-123").decode()

        def get(path, auth=True):
            request = urllib.request.Request(base_url + path, headers={"Authorization": token} if auth else {})
            try:
                with urllib.request.urlopen(request, timeout=10) as response:
                    return response.status, response.read(), dict(response.headers)
            except urllib.error.HTTPError as error:
                return error.code, b"", {}

        try:
            for _ in range(50):
                try:
                    status = json.loads(get("/api/status")[1])
                    if status.get("files") and not status.get("building"):
                        break
                except Exception:
                    pass
                time.sleep(0.2)
            check(get("/api/status", auth=False)[0] == 401, "status without auth should be 401")
            check(get("/", auth=True)[0] == 200, "index.html should be served")
            check(get("/private/vault_config.json")[0] == 404, "config must not be served")
            check(get("/..%2fprivate%2fvault_config.json")[0] == 404, "traversal must be blocked")
            names = [f["n"] for f in json.loads(get("/api/vault/search?q=txt")[1])["files"]]
            check("rib design.txt" in names, "search should find the guide")
            check("secret.txt" not in names, "excluded folder leaked")
            check("salary notes.txt" not in names, "excluded name leaked")
            listing = json.loads(get("/api/vault/list?cat=Guides&dir=")[1])
            check(any(d["name"] == "Plastics" for d in listing["dirs"]), "folder listing missing")
            rel = urllib.parse.quote("Guides/Plastics/rib design.txt")
            code, body, headers = get("/file?r=share&p=" + rel + "&dl=1")
            check(code == 200 and body.startswith(b"ribs"), "file download failed")
            check("attachment" in headers.get("Content-Disposition", ""), "download should be an attachment")
            alias = urllib.parse.quote("[Team Share]\\Guides\\Plastics\\rib design.txt")
            check(get("/file?abs=" + alias)[0] == 200, "aliased path should resolve")
            secret = urllib.parse.quote(os.path.join(docs, "Personal", "secret.txt"))
            check(get("/file?abs=" + secret)[0] == 404, "excluded absolute path must be blocked")
        finally:
            proc.terminate()
            proc.wait(timeout=10)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    print("static integrity")
    test_static()
    print("vault server")
    test_vault()
    if FAILURES:
        print("FAILED (%d)" % len(FAILURES))
        sys.exit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
