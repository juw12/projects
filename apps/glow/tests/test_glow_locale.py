"""Static checks for Glow language & region (stdlib only).

- every translation file in web/shared/i18n is valid and has the same phrases in every language
- the phrase lists in tools/i18n are what the translation files were built from (run tools/build_i18n.py)
- service workers cache glow-locale.js and the translation files, and every page loads glow-locale.js first
- China rules: region CN offers only providers that serve China, consent is required for CN and EU
Run from the repo root:  python apps/glow/tests/test_glow_locale.py
"""
import json
import re
import sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
failures = []


def check(name, ok, detail=""):
    print(f"{'ok  ' if ok else 'FAIL'}  {name}{'  ' + str(detail) if detail and not ok else ''}")
    if not ok:
        failures.append(name)


def load(lang):
    text = (WEB / "shared" / "i18n" / f"ui.{lang}.js").read_text(encoding="utf-8")
    match = re.search(r"registerStrings\((\{.*\})\);\s*$", text, re.S)
    return json.loads(match.group(1)) if match else None


payloads = {lang: load(lang) for lang in ("id", "zh-CN", "zh-TW")}
for lang, payload in payloads.items():
    check(f"ui.{lang}.js parses", payload is not None and payload.get("lang") == lang)
keys = [set(p["phrases"]) for p in payloads.values() if p]
check("same phrases in every language", len(keys) == 3 and keys[0] == keys[1] == keys[2])

source_phrases = set()
for source in (APP / "tools" / "i18n").glob("*.txt"):
    for line in source.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "||" in line and not line.startswith("re:"):
            source_phrases.add(line.split("||")[0].strip())
check("translation files are built from tools/i18n (run tools/build_i18n.py)", keys and source_phrases == keys[0],
      sorted(source_phrases ^ (keys[0] if keys else set()))[:5])
for lang, payload in payloads.items():
    empty = [k for k, v in (payload or {}).get("phrases", {}).items() if not v.strip()]
    check(f"{lang}: no empty translations", not empty, empty[:5])

for sw in ["sw.js", "chat/sw.js", "lead/sw.js", "room/sw.js"]:
    text = (WEB / sw).read_text(encoding="utf-8")
    check(f"{sw}: caches glow-locale.js and translations", "glow-locale.js" in text and all(f"ui.{l}.js" in text for l in payloads))

for page in ["index.html", "account/index.html", "chat/index.html", "chat/app.html", "chat/mobile.html", "lead/index.html", "room/index.html", "room/mobile.html", "setup/index.html"]:
    html = (WEB / page).read_text(encoding="utf-8")
    locale_at = html.find("glow-locale.js")
    apps_at = html.find("glow-apps.js")
    check(f"{page}: loads glow-locale.js before glow-apps.js", 0 <= locale_at < apps_at)

locale = (WEB / "shared" / "glow-locale.js").read_text(encoding="utf-8")
cn_rule = re.search(r"CN: \{[^}]*allow: CHINA_ALLOWED", locale)
check("region CN uses the China allow-list", bool(cn_rule))
check("CN and EU need consent", 'CONSENT_REGIONS = { CN: "pipl", EU: "gdpr" }' in locale)
for family in ["openai", "anthropic", "google"]:
    check(f"Hong Kong hides {family}", re.search(r'HK: \{[^}]*block: \[[^\]]*"' + family + '"', locale) is not None)
check("privacy page has region notes", all(f'id="{a}"' in (WEB / "privacy.html").read_text(encoding="utf-8") for a in ["cn", "eu", "tw", "id", "hk"]))

print(f"\n{'FAILED' if failures else 'PASSED'}: {len(failures)} failure(s)")
sys.exit(1 if failures else 0)
