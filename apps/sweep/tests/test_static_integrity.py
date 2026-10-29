#!/usr/bin/env python3
"""Static integrity tests for the Sweep web app (offline-first, zero-dep).

Hermetic and stdlib-only. Exits 0 on success, 1 on failure — so it participates
in scripts/run_all_tests.py.
"""

import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, "web")

REQUIRED_FILES = ["index.html", "styles.css", "app.js"]
PAGES = ["index.html", "mobile.html", "app.html"]
# Files that must stay offline-only (the optional AI / sync / licence modules may use the network).
OFFLINE_FILES = ["index.html", "mobile.html", "app.js", "enhance.js"]


def read_web(name):
    with open(os.path.join(WEB_DIR, name), "r", encoding="utf-8") as handle:
        return handle.read()


def local_refs(html):
    refs = []
    for ref in re.findall(r'(?:href|src)\s*=\s*"([^"#][^"]*)"', html):
        if ref.startswith(("http://", "https://", "//", "mailto:", "data:", "tel:", "javascript:")):
            continue
        clean = ref.split("#", 1)[0].split("?", 1)[0]
        if clean:
            refs.append((ref, clean))
    return refs


def run_tests():
    all_passed = True

    # Test 1: required files exist and are non-empty
    for name in REQUIRED_FILES:
        path = os.path.join(WEB_DIR, name)
        if os.path.isfile(path) and os.path.getsize(path) > 0:
            print(f"ok - {name} exists ({os.path.getsize(path):,} bytes)")
        else:
            print(f"FAIL - {name} missing or empty")
            all_passed = False

    if not all_passed:
        print("\n" + "=" * 50)
        print("SUMMARY: SOME TESTS FAILED")
        return 1

    # Test 2: valid UTF-8 for every file
    contents = {}
    for name in REQUIRED_FILES:
        try:
            with open(os.path.join(WEB_DIR, name), "r", encoding="utf-8") as f:
                contents[name] = f.read()
            print(f"ok - {name} is valid UTF-8")
        except UnicodeDecodeError:
            print(f"FAIL - {name} is not valid UTF-8")
            all_passed = False

    html = contents.get("index.html", "")
    js = contents.get("app.js", "")
    css = contents.get("styles.css", "")

    # Test 3: offline-first — no network calls
    combined = html + js
    if "fetch(" not in combined and "XMLHttpRequest" not in combined and "WebSocket" not in combined:
        print("ok - no fetch/XMLHttpRequest/WebSocket (offline-first)")
    else:
        print("FAIL - contains a network call (fetch/XMLHttpRequest/WebSocket)")
        all_passed = False

    # Test 4: no absolute-root asset refs (breaks GitHub Pages subpath deploy)
    if not re.search(r'(src|href)\s*=\s*"/', html):
        print("ok - no absolute-root asset refs")
    else:
        print("FAIL - contains absolute-root asset refs")
        all_passed = False

    # Test 5: no <base> tag
    if "<base" not in html:
        print("ok - no <base> tag")
    else:
        print("FAIL - contains a <base> tag")
        all_passed = False

    # Test 6: no external network resources (fonts/CDN/remote images)
    resource_tags = r'<(?:script|img|link|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*"https?://'
    if not re.search(resource_tags, html):
        print("ok - no external resources in HTML")
    else:
        print("FAIL - HTML loads an external resource")
        all_passed = False

    # Test 7: local href/src references exist on disk (case-exact)
    refs = re.findall(r'(?:href|src)\s*=\s*"([^"#][^"]*)"', html)
    for ref in refs:
        if ref.startswith(("http://", "https://", "//", "mailto:", "data:", "tel:", "javascript:")):
            continue
        clean = ref.split('#', 1)[0].split('?', 1)[0]
        if not clean:
            continue
        target = os.path.join(WEB_DIR, clean)
        if not os.path.isfile(target):
            print(f"FAIL - local ref '{ref}' does not resolve to a file")
            all_passed = False
    if all_passed:
        print("ok - all local href/src refs resolve")

    # Test 8: app persists to localStorage under a `sweep_` key
    if re.search(r"sweep_[a-z0-9_]+", combined):
        print("ok - uses a `sweep_` localStorage key")
    else:
        print("FAIL - no `sweep_` localStorage key found")
        all_passed = False

    # Test 9: Morning Paper theme tokens present in CSS
    if "--color-accent" in css and "#8b1a1a" in css:
        print("ok - Morning Paper theme tokens present")
    else:
        print("FAIL - missing Morning Paper theme tokens")
        all_passed = False

    # Test 10: every page's local href/src references resolve
    for page in PAGES:
        missing = [
            ref for ref, clean in local_refs(read_web(page))
            if not (os.path.isdir if clean.endswith("/") else os.path.isfile)(os.path.join(WEB_DIR, clean))
        ]
        if missing:
            print(f"FAIL - {page}: unresolved local refs {missing}")
            all_passed = False
        else:
            print(f"ok - {page}: all local refs resolve")

    # Test 11: markup contract — every element id app.js looks up in index.html also exists in
    # mobile.html (a missing section made Verify/Generate crash on phones before v20)
    index_ids = re.findall(r'\bid="([^"]+)"', html)
    mobile_html = read_web("mobile.html")
    mobile_ids = re.findall(r'\bid="([^"]+)"', mobile_html)
    looked_up = set(re.findall(r"getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)", js))
    contract = sorted(looked_up & set(index_ids))
    missing_on_mobile = [element_id for element_id in contract if element_id not in mobile_ids]
    if missing_on_mobile:
        print(f"FAIL - mobile.html lacks ids the core app uses: {missing_on_mobile}")
        all_passed = False
    else:
        print(f"ok - mobile.html has all {len(contract)} ids the core app looks up")

    # Test 12: ids are unique per page
    for page, ids in (("index.html", index_ids), ("mobile.html", mobile_ids)):
        duplicates = sorted({element_id for element_id in ids if ids.count(element_id) > 1})
        if duplicates:
            print(f"FAIL - {page}: duplicate ids {duplicates}")
            all_passed = False
        else:
            print(f"ok - {page}: ids are unique")

    # Test 13: one release version — the same ?v= on every page, and the service worker cache
    # name carries it (so a deploy never serves stale assets from an old cache)
    versions = set()
    for page in PAGES:
        versions.update(re.findall(r"\?v=(\d+)", read_web(page)))
    sw = read_web("sw.js")
    cache_match = re.search(r"CACHE_NAME\s*=\s*'([^']+)'", sw)
    cache_name = cache_match.group(1) if cache_match else ""
    if len(versions) == 1 and f"v{next(iter(versions))}" in cache_name:
        print(f"ok - assets use ?v={next(iter(versions))} and sw.js cache '{cache_name}' matches")
    else:
        print(f"FAIL - cache-bust mismatch: ?v={sorted(versions)} vs sw.js cache '{cache_name}'")
        all_passed = False

    # Test 14: every file the service worker pre-caches exists
    precache = re.findall(r"'\./([^']+)'", sw.split("];", 1)[0])
    missing_precache = [name for name in precache if not os.path.isfile(os.path.join(WEB_DIR, name))]
    if precache and not missing_precache:
        print(f"ok - sw.js pre-caches {len(precache)} existing files")
    else:
        print(f"FAIL - sw.js pre-cache list has missing files {missing_precache}")
        all_passed = False

    # Test 15: phones may pinch-zoom (WCAG 1.4.4)
    viewport = re.search(r'<meta name="viewport" content="([^"]+)"', mobile_html)
    viewport_content = viewport.group(1) if viewport else ""
    if "user-scalable=no" in viewport_content or re.search(r"maximum-scale=1(\.0)?\b", viewport_content):
        print("FAIL - mobile.html disables zoom")
        all_passed = False
    else:
        print("ok - mobile.html allows zoom")

    # Test 16: the core UI layers stay offline-only
    offenders = [
        name for name in OFFLINE_FILES
        if any(token in read_web(name) for token in ("fetch(", "XMLHttpRequest", "WebSocket"))
    ]
    if offenders:
        print(f"FAIL - network calls in offline-only files: {offenders}")
        all_passed = False
    else:
        print("ok - " + ", ".join(OFFLINE_FILES) + " make no network calls")

    # Test 17: the native bridge loads last on both app pages (it wraps downloads and the palette)
    for page in ("index.html", "mobile.html"):
        scripts = re.findall(r'<script src="([^"?]+)', read_web(page))
        if scripts and scripts[-1] == "native.js" and "refresh.css" in read_web(page):
            print(f"ok - {page}: native.js loads last, refresh.css present")
        else:
            print(f"FAIL - {page}: native.js must be the last script (got {scripts[-1:]})")
            all_passed = False

    # Test 18: shell.json (what installed apps compare against) matches the shells' own versions
    import json
    app_dir = os.path.dirname(WEB_DIR)
    shell = json.loads(read_web("shell.json"))
    desktop_src = open(os.path.join(app_dir, "desktop", "sweep_app.py"), encoding="utf-8").read()
    desktop_version = re.search(r'^VERSION = "([^"]+)"', desktop_src, re.M)
    mobile_package = json.load(open(os.path.join(app_dir, "mobile", "package.json"), encoding="utf-8"))
    expected = {
        "desktop": desktop_version.group(1) if desktop_version else None,
        "android": mobile_package.get("version"),
        "ios": mobile_package.get("version"),
    }
    actual = {name: (shell.get(name) or {}).get("version") for name in expected}
    if actual == expected:
        print(f"ok - shell.json versions match the desktop and phone shells {actual}")
    else:
        print(f"FAIL - shell.json versions {actual} != shells {expected}")
        all_passed = False

    # Test 19: the update manifest is never served from the service-worker cache
    if "shell.json" in sw and "shell.json" not in sw.split("];", 1)[0]:
        print("ok - sw.js always fetches shell.json from the network")
    else:
        print("FAIL - sw.js must bypass (and not pre-cache) shell.json")
        all_passed = False

    # Test 20: install icons exist (PWA manifest, iOS home screen, desktop builds)
    manifest = json.loads(read_web("manifest.webmanifest"))
    icon_files = [icon["src"] for icon in manifest.get("icons", [])] + ["icons/apple-touch-icon.png", "icons/icon-512.png"]
    missing_icons = [name for name in icon_files if not os.path.isfile(os.path.join(WEB_DIR, name))]
    if not missing_icons and any(icon.get("purpose") == "maskable" for icon in manifest.get("icons", [])):
        print(f"ok - {len(set(icon_files))} app icons present, including a maskable one")
    else:
        print(f"FAIL - missing app icons {missing_icons} or no maskable icon")
        all_passed = False

    # Test 21: the bridge only talks to this site's shell.json
    native = read_web("native.js")
    fetch_targets = re.findall(r"fetch\(\s*'([^']*)'", native)
    if set(fetch_targets) <= {"shell.json"} and "XMLHttpRequest" not in native and "WebSocket" not in native:
        print("ok - native.js only fetches shell.json")
    else:
        print(f"FAIL - native.js makes unexpected requests {fetch_targets}")
        all_passed = False

    print("\n" + "=" * 50)
    if all_passed:
        print("SUMMARY: ALL TESTS PASSED")
        return 0
    print("SUMMARY: SOME TESTS FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(run_tests())
