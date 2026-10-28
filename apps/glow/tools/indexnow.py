"""Tell search engines about the Glow pages with IndexNow (Bing, Yandex, Seznam, Naver, Yep).

Bing's index also feeds DuckDuckGo, Yahoo, Ecosia and many AI answer engines. Google doesn't use IndexNow:
it reads web/sitemap.xml once the site is added to Google Search Console.

The key file web/<32 hex>.txt is published under /projects/glow/, so IndexNow accepts URLs below that folder.
Run (the GitHub workflow glow-indexnow.yml does this after each deploy):  python apps/glow/tools/indexnow.py
Add --dry-run to print the request without sending it.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
HOST = "juw12.github.io"
BASE = f"https://{HOST}/projects/glow/"
ENDPOINT = "https://api.indexnow.org/indexnow"


def find_key():
    keys = [p.stem for p in WEB.glob("*.txt") if re.fullmatch(r"[0-9a-f]{32}", p.stem)]
    if len(keys) != 1:
        raise SystemExit(f"Expected exactly one IndexNow key file in {WEB}, found {keys}")
    key = keys[0]
    if (WEB / f"{key}.txt").read_text(encoding="utf-8").strip() != key:
        raise SystemExit("The IndexNow key file must contain only its own key")
    return key


def sitemap_urls():
    xml = (WEB / "sitemap.xml").read_text(encoding="utf-8")
    urls = re.findall(r"<loc>([^<]+)</loc>", xml)
    outside = [u for u in urls if not u.startswith(BASE)]
    if outside:
        raise SystemExit(f"Sitemap URLs outside {BASE}: {outside}")
    return urls


def main():
    key = find_key()
    payload = {
        "host": HOST,
        "key": key,
        "keyLocation": f"{BASE}{key}.txt",
        "urlList": sitemap_urls(),
    }
    print(json.dumps(payload, indent=2))
    if "--dry-run" in sys.argv:
        return 0
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            print(f"IndexNow answered {response.status} (200/202 = accepted)")
            return 0
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", "replace")[:300]
        print(f"IndexNow answered {error.code}: {body}")
        # 403 = key file not reachable yet, 422 = URLs not under the key's folder, 429 = too many requests.
        return 0 if error.code == 429 else 1


if __name__ == "__main__":
    sys.exit(main())
