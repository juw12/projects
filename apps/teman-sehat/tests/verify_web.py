#!/usr/bin/env python3
"""Teman Sehat web/PWA checks (stdlib only, exits 0/1).

1. Every file the page, manifest and service worker reference exists, and the
   manifest icons are real PNGs of the declared size.
2. Every element id the script looks up exists in the markup, and every tab /
   sub-tab button points at a real panel.
3. The script is structurally sound (balanced brackets, even backticks) and the
   demo mode uses its own storage prefix so it can never touch real data.
4. Served over HTTP on a free port, every app-shell file returns 200 with a
   sensible content type (what the browser needs to install the PWA).
5. The Capacitor config points at ../web and the desktop launcher serves ../web.
"""

import functools
import http.server
import json
import os
import re
import socket
import struct
import threading
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.normpath(os.path.join(HERE, ".."))
WEB = os.path.join(APP_ROOT, "web")
FAILURES = []


def check(condition, label):
    print(("  ok   " if condition else "  FAIL ") + label)
    if not condition:
        FAILURES.append(label)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as handle:
        return handle.read()


def png_size(path):
    with open(path, "rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", header[16:24])


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def check_files_and_manifest(html):
    print("Files and manifest")
    for required in ("index.html", "manifest.webmanifest", "sw.js"):
        check(os.path.isfile(os.path.join(WEB, required)), f"web/{required} exists")

    local_refs = re.findall(r'(?:href|src)="([^"#:]+)"', html)
    for ref in sorted(set(local_refs)):
        check(os.path.isfile(os.path.join(WEB, ref)), f"index.html reference {ref} exists")

    manifest = json.loads(read(WEB, "manifest.webmanifest"))
    check(manifest.get("display") == "standalone", "manifest display is standalone")
    check(manifest.get("start_url") == "./", "manifest start_url is relative (works under /projects/teman-sehat/)")
    sizes_seen = set()
    for icon in manifest.get("icons", []):
        path = os.path.join(WEB, icon["src"])
        declared = tuple(int(n) for n in icon["sizes"].split("x"))
        actual = png_size(path) if os.path.isfile(path) else None
        check(actual == declared, f"icon {icon['src']} is a {icon['sizes']} PNG")
        sizes_seen.add(declared)
    check((192, 192) in sizes_seen and (512, 512) in sizes_seen, "manifest has 192 and 512 icons")
    check(any(i.get("purpose") == "maskable" for i in manifest.get("icons", [])), "manifest has a maskable icon")

    shell = re.search(r"APP_SHELL\s*=\s*\[(.*?)\]", read(WEB, "sw.js"), re.S)
    check(shell is not None, "sw.js declares APP_SHELL")
    if shell:
        for entry in re.findall(r'"([^"]+)"', shell.group(1)):
            target = os.path.join(WEB, entry[2:] or "index.html")
            check(os.path.isfile(target), f"service worker caches existing file {entry}")


def check_markup_and_script(html):
    print("Markup and script")
    markup, script = html.split("<script>", 1)
    defined = set(re.findall(r'id="([^"]+)"', markup))
    used = set(re.findall(r'\$\("#([A-Za-z0-9_-]+)"\)', script))
    missing = sorted(used - defined)
    check(not missing, f"all {len(used)} element ids used by the script exist" + (f" (missing: {missing})" if missing else ""))

    for tab in re.findall(r'data-tab="([^"]+)"', markup):
        check(f"tab-{tab}" in defined, f"tab button '{tab}' has a panel")
    for sub in re.findall(r'data-sub="([^"]+)"', markup):
        check(sub in defined, f"sub-tab button '{sub}' has a panel")

    for opener, closer in ("{}", "()", "[]"):
        check(script.count(opener) == script.count(closer), f"script has balanced {opener}{closer}")
    check(script.count("`") % 2 == 0, "script has an even number of backticks")
    check('DEMO ? "temanSehatDemo_" : "temanGerd_"' in script, "demo mode uses a separate storage prefix")
    check("registerServiceWorker()" in script, "service worker is registered")
    check("LocalNotifications" in script, "native reminders are wired for the Capacitor apps")


def check_served():
    print("Served over HTTP")
    handler = functools.partial(QuietHandler, directory=WEB)
    port = free_port()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    expected = {
        "/": "text/html",
        "/manifest.webmanifest": "manifest+json",
        "/sw.js": "javascript",
        "/icons/icon-192.png": "image/png",
        "/icons/icon-512.png": "image/png",
    }
    try:
        for path, content_type in expected.items():
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=10) as response:
                    ok = response.status == 200 and content_type in (response.headers.get("Content-Type") or "")
            except Exception:  # noqa: BLE001 - any failure is a test failure
                ok = False
            check(ok, f"GET {path} -> 200 {content_type}")
    finally:
        server.shutdown()
        server.server_close()


def check_wrappers():
    print("Mobile and desktop wrappers")
    config = json.loads(read(APP_ROOT, "mobile", "capacitor.config.json"))
    check(config.get("webDir") == "../web", "Capacitor webDir is ../web")
    package = json.loads(read(APP_ROOT, "mobile", "package.json"))
    check("@capacitor/local-notifications" in package.get("dependencies", {}), "mobile app depends on local notifications")
    launcher = read(APP_ROOT, "desktop", "Buka-Aplikasi-Desktop.cmd")
    check("..\\web" in launcher and "http.server" in launcher, "desktop launcher serves ../web locally")


def main():
    html = read(WEB, "index.html")
    check_files_and_manifest(html)
    check_markup_and_script(html)
    check_served()
    check_wrappers()
    if FAILURES:
        print(f"\nFAILED: {len(FAILURES)} check(s)")
        raise SystemExit(1)
    print("\nAll Teman Sehat checks passed")


if __name__ == "__main__":
    main()
