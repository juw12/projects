#!/usr/bin/env python3
"""Static integrity tests for the Shortcraft web studio (zero-dep, offline-first).

Hermetic and stdlib-only. Exits 0 on success, 1 on failure — so it participates
in scripts/run_all_tests.py.
"""

import json
import os
import re
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, "web")

REQUIRED = [
    "index.html", "app.html", "mobile.html", "styles.css", "manifest.webmanifest",
    "icons/icon.svg", "js/engine.js", "js/ui.js", "js/samples.js",
]
HTML_FILES = ["index.html", "app.html", "mobile.html"]
JS_FILES = ["js/engine.js", "js/ui.js", "js/samples.js"]


def read(rel):
    with open(os.path.join(WEB_DIR, rel), "r", encoding="utf-8") as handle:
        return handle.read()


def exists_case_exact(rel):
    current = WEB_DIR
    for part in rel.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            current = os.path.dirname(current)
            continue
        if not os.path.isdir(current) or part not in os.listdir(current):
            return False
        current = os.path.join(current, part)
    return True


def run():
    failures = []

    def check(ok, message):
        print(("ok - " if ok else "FAIL - ") + message)
        if not ok:
            failures.append(message)

    # 1. required files
    for rel in REQUIRED:
        path = os.path.join(WEB_DIR, rel)
        check(os.path.isfile(path) and os.path.getsize(path) > 0, f"{rel} exists and is non-empty")
    if failures:
        return 1

    texts = {rel: read(rel) for rel in HTML_FILES + JS_FILES + ["styles.css"]}

    # 2. no absolute-root refs, no <base>, no external resources in HTML
    for rel in HTML_FILES:
        html = texts[rel]
        check(not re.search(r'(src|href)\s*=\s*"/', html), f"{rel}: no absolute-root asset refs")
        check("<base" not in html, f"{rel}: no <base> tag")
        check(not re.search(r'<(?:script|img|link|iframe|source|video)\b[^>]*\b(?:src|href)\s*=\s*"https?://', html),
              f"{rel}: no external resources")

    # 3. local refs exist, case-exact (Linux/Pages safe)
    for rel in HTML_FILES:
        for ref in re.findall(r'(?:src|href|poster)\s*=\s*"([^"]+)"', texts[rel]):
            if ref.startswith(("http", "#", "mailto:", "data:")):
                continue
            path = ref.split("?")[0].split("#")[0]
            if not path or path.startswith("../"):
                continue
            check(exists_case_exact(path), f"{rel}: local ref '{path}' exists (case-exact)")

    # 4. offline-first: no network calls in the shipped JS
    combined_js = "\n".join(texts[rel] for rel in JS_FILES)
    check(not re.search(r"\bfetch\(|XMLHttpRequest|WebSocket", combined_js), "JS makes no network calls")

    # 5. samples parse and are well-formed
    match = re.search(r"window\.SC_SAMPLES\s*=\s*(\[.*\]);\s*/\* SAMPLES:END", texts["js/samples.js"], re.S)
    check(match is not None, "samples.js has a SC_SAMPLES array between markers")
    if match:
        samples = json.loads(match.group(1))
        check(len(samples) >= 4, f"{len(samples)} samples present")
        ids = [s["id"] for s in samples]
        check(len(ids) == len(set(ids)), "sample ids are unique")
        for s in samples:
            check(s["template"] in ("editorial", "teardown"), f"{s['id']}: valid template")
            check(s["lang"] in ("en", "id"), f"{s['id']}: valid language")
            check(4 <= len(s["scenes"]) <= 9, f"{s['id']}: 4-9 scenes")
            check(all(sc.get("narration") for sc in s["scenes"]), f"{s['id']}: every scene has narration")
        langs = {s["lang"] for s in samples}
        check(langs == {"en", "id"}, "samples cover English and Bahasa Indonesia")

    # 6. engine exposes the API the UI relies on
    for name in ("buildTimeline", "renderFrame", "scheduleMusic", "scheduleVoices", "pickMime", "postKit", "checklist"):
        check(name + ":" in texts["js/engine.js"], f"engine exports {name}")

    # 7. every element id the UI looks up exists in app.html
    ids_used = set(re.findall(r'\$\("([a-z0-9-]+)"\)', texts["js/ui.js"]))
    for element_id in sorted(ids_used):
        check(f'id="{element_id}"' in texts["app.html"], f"app.html has #{element_id}")

    # 8. manifest is valid JSON with a relative start_url
    manifest = json.loads(read("manifest.webmanifest"))
    check(not manifest["start_url"].startswith("/"), "manifest start_url is relative")

    # 9. mobile entry redirects to the studio
    check("app.html?view=mobile" in texts["mobile.html"], "mobile.html opens the studio in mobile view")

    print("\n" + "=" * 50)
    if failures:
        print(f"SUMMARY: {len(failures)} TEST(S) FAILED")
        return 1
    print("SUMMARY: ALL TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(run())
