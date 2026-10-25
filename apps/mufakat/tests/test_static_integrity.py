"""Static integrity test for apps/mufakat/web (stdlib only).

Checks every page's local references resolve, the PWA manifest and service worker
point at real files, there is no inline script (the CSP forbids it), and the
apps.json catalog entry links to pages that exist.
Run from the repo root:  python apps/mufakat/tests/test_static_integrity.py
"""
import json
import re
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
WEB = APP_DIR / "web"
REPO = APP_DIR.parent.parent
PAGES = ["index.html", "app.html", "mobile.html"]
failures = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {name}{'  ' + detail if detail and not ok else ''}")
    if not ok:
        failures.append(name)


for page in PAGES:
    html = (WEB / page).read_text(encoding="utf-8")
    refs = re.findall(r'(?:src|href)="([^"]+)"', html)
    local = [r for r in refs if not re.match(r"^(https?:|mailto:|#|data:)", r)]
    missing = [r for r in local if not (WEB / r.split("#")[0].split("?")[0]).exists()]
    check(f"{page}: local refs resolve", not missing, str(missing))
    check(f"{page}: no absolute-root refs", not any(r.startswith("/") for r in local))
    inline = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", html)
    check(f"{page}: no inline scripts (CSP)", not inline)
    check(f"{page}: has CSP", "Content-Security-Policy" in html)
    for element_id in ["chat-model", "messages", "input", "send-btn", "settings-modal", "new-council-btn", "new-arena-btn", "search", "attach-btn", "export-btn"]:
        if f'id="{element_id}"' not in html:
            check(f"{page}: has #{element_id}", False)

manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
check("manifest: start_url exists", (WEB / manifest["start_url"]).exists())
check("manifest: icons exist", all((WEB / icon["src"]).exists() for icon in manifest["icons"]))
check("manifest: has 192 and 512 PNG", {"192x192", "512x512"} <= {i["sizes"] for i in manifest["icons"]})

sw = (WEB / "sw.js").read_text(encoding="utf-8")
cached = re.findall(r"'(\./[^']+)'", sw)
check("sw.js: cached assets exist", cached and all((WEB / c).exists() for c in cached), str(cached))

app_js = (WEB / "app.js").read_text(encoding="utf-8")
used_ids = set(re.findall(r'\$\("([\w-]+)"\)', app_js))
html_ids = set(re.findall(r'id="([\w-]+)"', (WEB / "index.html").read_text(encoding="utf-8")))
dynamic = {i for i in used_ids if i.startswith(("agent-", "council-preset", "council-agents", "council-topic", "council-rounds", "council-stop", "council-start", "judge-", "arena-", "leaderboard"))}
missing_ids = sorted(used_ids - html_ids - dynamic)
check("app.js: every static element it uses exists", not missing_ids, str(missing_ids))
check("app.js: never uses innerHTML with message content unescaped", "innerHTML = m.content" not in app_js and "innerHTML = text" not in app_js)
check("app.js: keys stay client-side (no third-party analytics)", "google-analytics" not in app_js and "gtag(" not in app_js)

catalog = json.loads((REPO / "scripts" / "apps.json").read_text(encoding="utf-8"))
entry = next((a for a in catalog["apps"] if a["id"] == "mufakat"), None)
check("apps.json: mufakat entry exists", entry is not None)
if entry:
    for key, link in entry["links"].items():
        target = WEB / link.split("/", 1)[1] if "/" in link else WEB
        if link.endswith("/"):
            target = WEB / "index.html"
        check(f"apps.json: {key} link resolves", target.exists(), link)

print(f"\n{'FAILED' if failures else 'PASSED'}: {len(failures)} failure(s)")
sys.exit(1 if failures else 0)
