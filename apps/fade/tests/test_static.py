#!/usr/bin/env python3
"""Fade web bundle integrity check (stdlib only, no browser).

Checks that the pages reference existing assets (including the 3.0 Fade Network client),
the manifest and service worker are valid, the seed data parses, there is no mojibake,
the moderator config is real, no secret keys ship, and the version strings agree.
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


    # ---- Fade Network (3.0) ----
    network_scripts = [
        "vendor/nostr.bundle.js", "vendor/qrcode.js", "config.js", "net.js", "transcode.js", "netui.js",
    ]
    for page in ("index.html", "web.html", "mobile.html"):
        html = (WEB / page).read_text(encoding="utf-8")
        scripts = [s.split("?")[0] for s in re.findall(r'<script src="([^"]+)"', html)]
        for name in network_scripts:
            check(name in scripts, f"{page} loads {name}")
        if "app.js" in scripts and all(name in scripts for name in network_scripts):
            check(max(scripts.index(n) for n in network_scripts) < scripts.index("app.js"), f"{page} loads the network client before app.js")
        versions = set(re.findall(r'\?v=([\d.]+)', html))
        check(versions == {version}, f"{page} cache-busts every asset with ?v={version} (found {sorted(versions)})")
    if shell_match:
        shell_names = [e.split("?")[0].lstrip("./") for e in re.findall(r"['\"]([^'\"]+)['\"]", shell_match.group(1))]
        for name in network_scripts:
            check(name in shell_names, f"sw SHELL caches {name}")
    check(f"fade-v{version}" in sw, f"sw cache name is fade-v{version}")
    check(f"VERSION = '{version}'" in app_js, f"app.js VERSION is {version}")

    config_js = (WEB / "config.js").read_text(encoding="utf-8")
    admins = re.findall(r"admins:\s*\[([^\]]*)\]", config_js)
    admin_keys = re.findall(r"'([0-9a-f]{64})'", admins[0]) if admins else []
    check(len(admin_keys) >= 1 and "__ADMIN_PUBKEY__" not in config_js, "config.js names at least one real moderator pubkey")
    check("wss://" in config_js and "ntfy" in config_js and "blossom" in config_js.lower(), "config.js lists relays, Blossom and ntfy")

    for path in sorted(WEB.rglob("*")):
        if path.suffix not in (".js", ".html", ".css", ".webmanifest") or "vendor" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(WEB)
        check(not re.search(r"â€|Ã[\x80-\xbf]|ðŸ", text), f"{rel} has no mojibake")
        check(not re.search(r"nsec1[02-9ac-hj-np-z]{58}", text), f"{rel} ships no secret key")

    net_js = (WEB / "net.js").read_text(encoding="utf-8")
    for needle, label in [
        ("nip44", "net.js encrypts private records (NIP-44)"),
        ("nip17", "net.js sends DMs as NIP-17 gift wraps"),
        ("1984", "net.js files reports as NIP-56 (kind 1984)"),
        ("pbkdf2", "net.js derives account keys with PBKDF2"),
    ]:
        check(needle in net_js.lower(), label)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        sys.exit(1)
    print("PASSED")


if __name__ == "__main__":
    main()
