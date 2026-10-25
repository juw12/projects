#!/usr/bin/env python3
"""Sped tests (stdlib only).

1. Static checks: every web entry point loads the scripts it needs, refs are
   relative (GitHub Pages sub-path safe), the service worker caches files that
   exist, and the curated Paramore recipe is internally consistent.
2. Engine tests: runs tests/engine.test.js under Node (CI) or macOS
   JavaScriptCore when available; otherwise reports them as skipped.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc")

failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


def static_checks():
    for page in ("index.html", "web.html", "mobile.html"):
        html = (WEB / page).read_text(encoding="utf-8")
        for script in ("engine.js", "demo.js", "rights.js", "recipes.js", "engine-client.js", "app.js"):
            check(f'src="{script}"' in html, f"{page} does not load {script}")
        order = [html.find(f'src="{s}"') for s in ("engine.js", "demo.js", "rights.js", "recipes.js", "engine-client.js", "app.js")]
        check(order == sorted(order), f"{page} loads scripts out of order")
        for ref in re.findall(r'(?:href|src)="([^"]+)"', html):
            check(not ref.startswith("/"), f"{page}: absolute ref {ref}")
            if not ref.startswith(("http", "#", "mailto:")):
                check((WEB / ref).exists(), f"{page}: missing {ref}")
    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    for entry in re.findall(r"'([^']+)'", sw.split("const SHELL = [", 1)[1].split("];", 1)[0]):
        if entry != "./":
            check((WEB / entry).exists(), f"sw.js caches missing file {entry}")
    check("key.startsWith('sped-v')" in sw, "service worker must not delete other apps' caches")
    check("ignoreSearch: true" in sw, "offline demo query must resolve to cached shell")
    check("ACTIVATE_UPDATE" in sw, "updates need explicit activation")
    manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
    for icon in manifest["icons"]:
        check((WEB / icon["src"]).exists(), f"manifest icon missing {icon['src']}")
    recipes = (WEB / "recipes.js").read_text(encoding="utf-8")
    for slot in ("main", "nostalgia1", "nostalgia2"):
        check(f"id: '{slot}'" in recipes, f"Paramore recipe lacks slot {slot}")
        check(f"track: '{slot}'" in recipes, f"Paramore arrangement never uses slot {slot}")
    check("targetBpm: 164" in recipes and "semitones: 4" in recipes, "Paramore recipe tempo/pitch changed")
    worker = (WEB / "worker.js").read_text(encoding="utf-8")
    check("message.payload" in worker, "worker must read the nested payload (request id collision)")


def engine_tests():
    node = shutil.which("node")
    if node:
        command = [node, str(APP / "tests" / "engine.test.js"), str(WEB)]
    elif JSC.exists():
        command = [str(JSC), str(APP / "tests" / "engine.test.js"), "--", str(WEB)]
    else:
        print("SKIP engine tests: neither node nor JavaScriptCore found")
        return
    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    print(result.stdout.strip())
    check(result.returncode == 0 and " 0 failed" in result.stdout, "engine tests failed:\n" + result.stderr[-2000:])


def main():
    static_checks()
    engine_tests()
    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print(" -", failure)
        sys.exit(1)
    print("sped: all checks passed")


if __name__ == "__main__":
    main()
