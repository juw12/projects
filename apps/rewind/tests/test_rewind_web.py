"""Hermetic checks for the Rewind static app (stdlib only, no browser).

The full browser suite lives in ui-tests/ (headless Edge). This file checks the
things that break a Pages deploy: missing files, absolute paths, a service worker
that caches files that don't exist, an invalid manifest, or committed Supabase keys.
"""

import json
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
failures = []


def check(condition, message):
    if not condition:
        failures.append(message)


index_html = (WEB / "index.html").read_text(encoding="utf-8")

# Every local asset referenced by index.html exists and is relative (Pages serves /projects/rewind/).
for ref in re.findall(r'(?:src|href)="([^"#]+)"', index_html):
    if ref.startswith(("http://", "https://")):
        continue
    check(not ref.startswith("/"), f"absolute path in index.html: {ref}")
    check((WEB / ref).is_file(), f"index.html references missing file: {ref}")

# Scripts load in dependency order.
script_order = re.findall(r'<script src="([^"]+)"', index_html)
expected_order = ["config.js", "store.js", "settings.js", "app.js"]
check(
    [s for s in script_order if s in expected_order] == expected_order,
    f"unexpected script order: {script_order}",
)

# Manifest is valid, relative, and its icons exist.
manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
check(manifest.get("start_url") == "./", "manifest start_url should be ./")
check(manifest.get("scope") == "./", "manifest scope should be ./")
for icon in manifest.get("icons", []):
    check((WEB / icon["src"]).is_file(), f"manifest icon missing: {icon['src']}")

# Service worker caches only files that exist.
sw = (WEB / "sw.js").read_text(encoding="utf-8")
shell_block = re.search(r"SHELL_FILES\s*=\s*\[(.*?)\]", sw, re.S)
check(shell_block is not None, "SHELL_FILES list not found in sw.js")
if shell_block:
    for name in re.findall(r'"([^"]+)"', shell_block.group(1)):
        if name == "./":
            continue
        check((WEB / name).is_file(), f"sw.js caches missing file: {name}")

# The published demo runs in local mode: no Supabase keys committed.
config = (WEB / "config.js").read_text(encoding="utf-8")
for value in re.findall(r'(?:url|anonKey|key)\s*:\s*"([^"]*)"', config, re.I):
    check(value == "", "web/config.js must ship with empty Supabase settings")
check("eyJ" not in config, "web/config.js appears to contain a JWT key")

# Storage keys are namespaced (the Pages origin is shared with other apps).
for name in ("store.js", "settings.js"):
    source = (WEB / name).read_text(encoding="utf-8")
    for key in re.findall(r'(?:storageKey|SETTINGS_KEY)\s*=\s*"([^"]+)"', source):
        check(key.startswith("rewind-"), f"{name}: storage key not namespaced: {key}")

if failures:
    print("FAIL rewind web checks:")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)
print("OK rewind web checks")
