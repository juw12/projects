#!/usr/bin/env python3
"""Sync tests (stdlib only).

1. Static checks: every entry page loads the scripts in order, refs are
   relative (GitHub Pages sub-path safe), the service worker caches files that
   exist and only clears its own caches, the manifest icons exist, and no
   secrets are committed in config.js.
2. Core tests: runs tests/core.test.js (room state machine, clock offset, drift
   correction, link parsing, cross-service matching) under Node or macOS
   JavaScriptCore; reports them as skipped when neither is available.

The live two-browser test (real WebRTC through PeerJS) is tools/browser_smoke.py;
it needs Chrome and internet, so it is not part of CI.
"""

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc")
SCRIPTS = [
    "config.js",
    "vendor/peerjs.min.js",
    "core.js",
    "catalog.js",
    "players.js",
    "room.js",
    "voice.js",
    "app.js",
]

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


def static_checks():
    for page in ("index.html", "web.html", "mobile.html"):
        html = (WEB / page).read_text(encoding="utf-8")
        positions = [html.find(f'src="{script}"') for script in SCRIPTS]
        check(all(p >= 0 for p in positions), f"{page} does not load every script")
        check(positions == sorted(positions), f"{page} loads scripts out of order")
        for ref in re.findall(r'(?:href|src)="([^"]+)"', html):
            check(not ref.startswith("/"), f"{page}: absolute ref {ref}")
            if not ref.startswith(("http", "#", "mailto:")):
                check((WEB / ref).exists(), f"{page}: missing {ref}")
    layouts = {
        "index.html": "layout-app",
        "web.html": "layout-web",
        "mobile.html": "layout-mobile",
    }
    for page, layout in layouts.items():
        check(f'class="{layout}"' in (WEB / page).read_text(encoding="utf-8"), f"{page} should use {layout}")

    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    shell = sw.split("const SHELL = [", 1)[1].split("];", 1)[0]
    for entry in re.findall(r"'([^']+)'", shell):
        if entry != "./":
            check((WEB / entry).exists(), f"sw.js caches missing file {entry}")
    for script in SCRIPTS:
        check(f"'{script}'" in shell, f"sw.js does not cache {script}")
    check("key.startsWith('sync-v')" in sw, "service worker must not delete other apps' caches")
    check("ignoreSearch: true" in sw, "?room= invite links must resolve to the cached shell")
    check("ACTIVATE_UPDATE" in sw, "updates need explicit activation")

    manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
    check(manifest["start_url"].startswith("./"), "manifest start_url must be relative")
    for icon in manifest["icons"]:
        check((WEB / icon["src"]).exists(), f"manifest icon missing {icon['src']}")

    config = (WEB / "config.js").read_text(encoding="utf-8")
    check("appleDeveloperToken: ''" in config, "do not commit an Apple developer token")
    check("youtubeApiKey: ''" in config, "do not commit a YouTube API key")

    for name in ("app.js", "room.js", "players.js", "voice.js", "catalog.js", "core.js"):
        source = (WEB / name).read_text(encoding="utf-8")
        # Same rule as scripts/check_site.py: a quoted literal that is a root-absolute path.
        literals = [m for m in re.findall(r"""["'](/[A-Za-z0-9_./~%+-]+)["']""", source) if not m.startswith("//")]
        check(not literals, f"{name} has absolute-root path literals {literals}")
        check("innerHTML = msg" not in source, f"{name} must not inject raw chat HTML")

    peer = (WEB / "vendor" / "peerjs.min.js").read_text(encoding="utf-8")
    check(peer.startswith("/*! PeerJS 1.5.5"), "vendored PeerJS header missing")
    check("sourceMappingURL" not in peer, "vendored PeerJS must not reference a missing source map")
    check((WEB / "vendor" / "PEERJS-LICENSE.txt").exists(), "PeerJS license must ship with the vendored file")

    catalog = json.loads((APP.parent.parent / "scripts" / "apps.json").read_text(encoding="utf-8"))
    entry = next((a for a in catalog["apps"] if a["id"] == "sync"), None)
    check(entry is not None, "Sync must be registered in scripts/apps.json")
    if entry:
        check(entry["links"] == {"app": "sync/", "web": "sync/web.html", "mobile": "sync/mobile.html"},
              "apps.json links must point at the three entry pages")


def js_runner():
    node = shutil.which("node")
    if node:
        return [node]
    if JSC.exists():
        return [str(JSC)]
    return None


def core_tests():
    runner = js_runner()
    if not runner:
        print("core.test.js: SKIPPED (no node or jsc available)")
        return
    source = (WEB / "core.js").read_text(encoding="utf-8") + "\n" + \
        (APP / "tests" / "core.test.js").read_text(encoding="utf-8")
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as handle:
        handle.write(source)
        bundle = handle.name
    try:
        result = subprocess.run(runner + [bundle], capture_output=True, text=True, timeout=60)
    finally:
        Path(bundle).unlink(missing_ok=True)
    output = (result.stdout + result.stderr).strip()
    print(output)
    check(result.returncode == 0 and " 0 failed" in output, "core.test.js failed")


def main():
    static_checks()
    core_tests()
    if failures:
        print("FAILED:")
        for failure in failures:
            print("  -", failure)
        sys.exit(1)
    print("Sync tests: PASS")
    sys.exit(0)


if __name__ == "__main__":
    main()
