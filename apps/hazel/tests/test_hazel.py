#!/usr/bin/env python3
"""Hazel: one app, three branches (Hazel Shorts, Hazel Sped, Hazel Long). Stdlib only.

Checks the pieces that hold the unified app together:
  1. Hazel home pages exist and every link on them resolves.
  2. Every branch entry page carries the shared Hazel switcher, and the switcher's
     stylesheet/script copies are byte-identical to the hub's source copy.
  3. Each branch is branded "Hazel <Branch>" in titles and manifests.
  4. Browser storage names were kept, so existing projects keep loading.
  5. Offline workers only ever delete their own caches.
  6. The catalog lists one Hazel entry whose card links resolve, and the old ids are gone.
  7. Old addresses (/shortcraft/, /sped/, /hookline/) build into redirect stubs to the new branches.
"""

import importlib.util
import json
import re
import sys
import tempfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent      # apps/hazel
REPO = APP.parent.parent
WEB = APP / "web"
BRANCHES = {
    "shorts": {"name": "Hazel Shorts", "pages": ["index.html", "app.html", "channel.html"]},
    "sped": {"name": "Hazel Sped", "pages": ["index.html", "web.html", "mobile.html"]},
    "long": {"name": "Hazel Long", "pages": ["index.html", "mobile.html", "app.html"]},
}

failures = []


def check(ok, message):
    print(("ok - " if ok else "FAIL - ") + message)
    if not ok:
        failures.append(message)


def read(path):
    return Path(path).read_text(encoding="utf-8")


def local_refs(html):
    for ref in re.findall(r'(?:href|src)\s*=\s*"([^"]+)"', html):
        if ref.startswith(("http:", "https:", "#", "mailto:", "data:", "javascript:")):
            continue
        yield ref


def resolves(page, ref):
    path = ref.split("#", 1)[0].split("?", 1)[0]
    target = (page.parent / path).resolve() if path else page.resolve()
    if target.is_dir():
        target = target / "index.html"
    return target.exists()


def hub_checks():
    for name in ("index.html", "mobile.html", "app.html", "manifest.webmanifest", "sw.js", "hub.css", "hub.js",
                 "hazel-switch.css", "hazel-switch.js", "icons/hazel.svg", "icons/hazel-256.png"):
        check((WEB / name).is_file(), f"hub ships {name}")
    for name in ("index.html", "mobile.html", "app.html"):
        page = WEB / name
        html = read(page)
        broken = [ref for ref in local_refs(html) if not ref.startswith("../") and not resolves(page, ref)]
        check(not broken, f"hub {name}: every local link resolves {broken or ''}")
        check('class="hz-switch"' in html and 'src="hazel-switch.js"' in html, f"hub {name}: has the Hazel switcher")
    index = read(WEB / "index.html")
    for branch, info in BRANCHES.items():
        check(info["name"] in index, f"Hazel home presents {info['name']}")
    manifest = json.loads(read(WEB / "manifest.webmanifest"))
    check(manifest["name"] == "Hazel" and not manifest["start_url"].startswith("/"), "hub manifest is Hazel with a relative start_url")
    shortcuts = [s["url"] for s in manifest.get("shortcuts", [])]
    check(len(shortcuts) == 3 and all(resolves(WEB / "manifest.webmanifest", url) for url in shortcuts),
          "hub manifest has resolving shortcuts into all three branches")


def switcher_checks():
    css = read(WEB / "hazel-switch.css")
    js = read(WEB / "hazel-switch.js")
    for branch, info in BRANCHES.items():
        folder = WEB / branch
        check(read(folder / "hazel-switch.css") == css, f"{branch}: hazel-switch.css matches the hub copy")
        check(read(folder / "hazel-switch.js") == js, f"{branch}: hazel-switch.js matches the hub copy")
        for name in info["pages"]:
            page = folder / name
            html = read(page)
            check(f'data-hazel-branch="{branch}"' in html, f"{branch}/{name}: tagged data-hazel-branch")
            check('href="hazel-switch.css"' in html and 'src="hazel-switch.js"' in html,
                  f"{branch}/{name}: loads the switcher files")
            if branch == "sped":
                continue  # Hazel Sped renders its header (and switcher) in app.js
            check('class="hz-switch"' in html, f"{branch}/{name}: shows the Hazel switcher")
            menu = re.search(r'<nav class="hz-menu"[\s\S]*?</nav>', html)
            links = re.findall(r'href="([^"]+)"', menu.group(0)) if menu else []
            check(len(links) == 4 and all(resolves(page, ref) for ref in links),
                  f"{branch}/{name}: switcher links to home + 3 branches and all resolve")
            check('aria-current="page"' in (menu.group(0) if menu else ""), f"{branch}/{name}: switcher marks the current app")
    app_js = read(WEB / "sped" / "app.js")
    check("function hazelSwitch()" in app_js and "hazelSwitch() +" in app_js, "sped: app.js renders the switcher in its header")
    for ref in ("../", "../shorts/", "../sped/", "../long/"):
        check(f"'{ref}" in app_js, f"sped: switcher links to {ref}")
    sw = read(WEB / "sped" / "sw.js")
    check("'hazel-switch.css'" in sw and "'hazel-switch.js'" in sw, "sped: offline cache includes the switcher files")
    long_sw = read(WEB / "long" / "sw.js")
    check("./hazel-switch.css" in long_sw and "./hazel-switch.js" in long_sw, "long: offline cache includes the switcher files")


def branding_checks():
    for branch, info in BRANCHES.items():
        for name in info["pages"]:
            html = read(WEB / branch / name)
            title = re.search(r"<title>([^<]*)</title>", html)
            check(bool(title) and title.group(1).startswith(info["name"]), f"{branch}/{name}: title starts with {info['name']}")
        manifest = json.loads(read(WEB / branch / "manifest.webmanifest"))
        check(manifest["short_name"] == info["name"], f"{branch}: manifest short_name is {info['name']}")
    shorts_visible = "".join(read(WEB / "shorts" / p) for p in ("index.html", "app.html", "channel.html", "mobile.html"))
    leftover = [m for m in re.findall(r"[^\n]{0,40}\bShortcraft\b[^\n]{0,20}", shorts_visible) if "formerly Shortcraft" not in m]
    check(not leftover, f"shorts pages no longer call themselves Shortcraft {leftover[:2] or ''}")
    desktop = read(APP / "long" / "src" / "index.html")
    check("<title>Hazel Long</title>" in desktop, "long desktop window is titled Hazel Long")


def storage_checks():
    ui = read(WEB / "shorts" / "js" / "ui.js")
    check('var STORAGE_KEY = "shortcraft.project.v1";' in ui, "shorts keeps its project storage key")
    check('var DB_NAME = "shortcraft";' in ui, "shorts keeps its voice-clip database name")
    check('"shortcraft.channelKit.v1"' in read(WEB / "shorts" / "js" / "channel.js"), "shorts keeps its Channel Kit prefs key")
    check("const LOOK_KEY = 'sped-look';" in read(WEB / "sped" / "app.js"), "sped keeps its saved-look key")
    check("const STORAGE_KEY = 'hazel-studio-v1';" in read(WEB / "long" / "index.html"), "long keeps its web studio key")
    check("const STORAGE_KEY = 'hazel-studio-mobile-v1';" in read(WEB / "long" / "mobile.html"), "long keeps its mobile studio key")
    pkg = json.loads(read(APP / "long" / "package.json"))
    check(pkg["name"] == "hazel" and pkg["productName"] == "Hazel", "desktop app keeps its name (same userData folder)")


def worker_checks():
    hub = read(WEB / "sw.js")
    check("name.startsWith('hazel-app-')" in hub and "registration.unregister()" in hub and "'fetch'" not in hub,
          "hub sw.js only retires the pre-Hazel worker (deletes hazel-app-* caches, no fetch handler)")
    long_sw = read(WEB / "long" / "sw.js")
    check("name.startsWith(CACHE_PREFIX)" in long_sw and "CACHE_PREFIX = 'hazel-long-v'" in long_sw,
          "long sw.js deletes only older hazel-long caches")
    check("request.url.startsWith(self.registration.scope)" in long_sw, "long sw.js scope check compares full URLs")
    sped = read(WEB / "sped" / "sw.js")
    check("key.startsWith('hazel-sped-v')" in sped, "sped sw.js deletes only older hazel-sped caches")
    for prefix in ("hazel-long-v", "hazel-sped-v"):
        check(not prefix.startswith(("sped-v", "hookline-v", "hazel-app-")), f"{prefix} never matches a retired worker's prefix")


def catalog_checks():
    apps = json.loads(read(REPO / "scripts" / "apps.json"))["apps"]
    ids = [a["id"] for a in apps]
    check(ids.count("hazel") == 1, "catalog lists Hazel once")
    check("sped" not in ids and "shortcraft" not in ids, "catalog no longer lists Sped or Shortcraft separately")
    hazel = next(a for a in apps if a["id"] == "hazel")
    labels = [c["label"] for c in hazel.get("card_links", [])]
    check(labels[:4] == ["Hazel home", "Hazel Shorts", "Hazel Sped", "Hazel Long"], "Hazel card links home + 3 branches")
    for path in [c["path"] for c in hazel["card_links"]] + list(hazel["links"].values()):
        rel = Path(path.split("?")[0])
        target = WEB / rel.relative_to("hazel") if rel.parts[0] == "hazel" else None
        if target is not None and (target.is_dir() or path.endswith("/")):
            target = target / "index.html"
        check(target is not None and target.exists(), f"catalog link {path} resolves")
    for old in ("shortcraft", "sped"):
        stub = APP.parent / old / "README.md"
        check(stub.is_file() and "apps/hazel" in read(stub).replace("../hazel", "apps/hazel"), f"apps/{old}/README.md points to apps/hazel")
        check(not (APP.parent / old / "web").exists(), f"apps/{old} has no web folder left")


def redirect_checks():
    spec = importlib.util.spec_from_file_location("hazel_site_builder", REPO / "scripts" / "build_site.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    check(builder.REDIRECTS.get("shortcraft") == "hazel/shorts", "build: shortcraft redirects to hazel/shorts")
    check(builder.REDIRECTS.get("sped") == "hazel/sped", "build: sped redirects to hazel/sped")
    check(builder.REDIRECTS.get("hookline") == "hazel/sped", "build: hookline redirects straight to hazel/sped")
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        for branch, pages in (("shorts", ["index.html", "app.html", "mobile.html", "channel.html"]),
                              ("sped", ["index.html", "web.html", "mobile.html"])):
            for page in pages:
                (root / "hazel" / branch).mkdir(parents=True, exist_ok=True)
                (root / "hazel" / branch / page).write_text("x", encoding="utf-8")
        (root / "hazel" / "sped" / "manifest.webmanifest").write_text(read(WEB / "sped" / "manifest.webmanifest"), encoding="utf-8")
        builder.write_redirects(root, [{"id": "hazel"}])
        expected = {
            ("shortcraft", "index.html"): "../hazel/shorts/",
            ("shortcraft", "app.html"): "../hazel/shorts/app.html",
            ("shortcraft", "mobile.html"): "../hazel/shorts/mobile.html",
            ("shortcraft", "channel.html"): "../hazel/shorts/channel.html",
            ("sped", "index.html"): "../hazel/sped/",
            ("sped", "web.html"): "../hazel/sped/web.html",
            ("hookline", "mobile.html"): "../hazel/sped/mobile.html",
        }
        for (old, page), target in expected.items():
            stub = root / old / page
            check(stub.exists() and f'data-target="{target}"' in read(stub), f"/{old}/{page} redirects to {target}")
        check(not (root / "shortcraft" / "sw.js").exists(), "no worker stub for Shortcraft (it never had one)")
        sped_worker = read(root / "sped" / "sw.js")
        check("name.startsWith('sped-v')" in sped_worker and "unregister()" in sped_worker,
              "old /sped/ worker is retired and clears only sped-v caches")


def main():
    hub_checks()
    switcher_checks()
    branding_checks()
    storage_checks()
    worker_checks()
    catalog_checks()
    redirect_checks()
    print("\n" + "=" * 50)
    if failures:
        print(f"SUMMARY: {len(failures)} TEST(S) FAILED")
        return 1
    print("SUMMARY: ALL TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
