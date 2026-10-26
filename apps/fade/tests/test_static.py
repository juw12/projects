#!/usr/bin/env python3
"""Fade web bundle integrity check (stdlib only, no browser).

Checks that the pages reference existing assets, the manifest and service worker
are valid, the seed data parses and has the 2.0 content, and the version strings agree.
"""

import json
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
failures = []


def check(condition, message):
    status = "ok  " if condition else "FAIL"
    print(f"[{status}] {message}")
    if not condition:
        failures.append(message)


def local_refs(html):
    refs = re.findall(r'(?:src|href)="([^"]+)"', html)
    result = []
    for ref in refs:
        if ref.startswith(("http:", "https:", "#", "data:", "mailto:")):
            continue
        result.append(ref.split("?")[0].split("#")[0])
    return [ref for ref in result if ref]


def main():
    for page in ("index.html", "web.html", "mobile.html"):
        path = WEB / page
        check(path.exists(), f"{page} exists")
        if not path.exists():
            continue
        html = path.read_text(encoding="utf-8")
        check("Fade" in html, f"{page} is branded Fade")
        for ref in local_refs(html):
            check((WEB / ref).exists(), f"{page} -> {ref} exists")

    manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
    check(manifest.get("name", "").startswith("Fade"), "manifest name is Fade")
    for icon in manifest.get("icons", []):
        check((WEB / icon["src"]).exists(), f"manifest icon {icon['src']} exists")

    sw = (WEB / "sw.js").read_text(encoding="utf-8")
    shell_match = re.search(r"SHELL\s*=\s*\[(.*?)\]", sw, re.S)
    check(shell_match is not None, "sw.js declares SHELL")
    if shell_match:
        for entry in re.findall(r"['\"]([^'\"]+)['\"]", shell_match.group(1)):
            name = entry.split("?")[0].lstrip("./")
            if name:
                check((WEB / name).exists(), f"sw SHELL {entry} exists")
    check("/api" in sw and "/media" in sw, "sw bypasses /api and /media")

    data_js = (WEB / "data.js").read_text(encoding="utf-8").strip()
    prefix = "window.SEED = "
    check(prefix in data_js, "data.js assigns window.SEED")
    seed = json.loads(data_js.split(prefix, 1)[1].strip().rstrip(";"))
    check(len(seed.get("shorts", [])) >= 30, "seed has >= 30 shorts")
    check(len(seed.get("creators", [])) >= 4, "seed has creators")
    sponsored = [
        short for short in seed["shorts"]
        if any(tag.get("kind") == "sponsored" for tag in short.get("tags", []))
    ]
    check(len(sponsored) > 0, "seed has sponsored shorts")
    check(all(place.get("tz") for place in seed.get("places", [])), "every place has a time zone")

    app_js = (WEB / "app.js").read_text(encoding="utf-8")
    check("Fadeline" not in app_js.replace("formerly Fadeline", ""), "app.js has no stale Fadeline branding")
    version = seed.get("version")
    check(version is not None and version in sw, f"sw cache matches seed version {version}")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        sys.exit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
