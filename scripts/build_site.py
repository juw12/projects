#!/usr/bin/env python3
"""Build static site from apps/*/web directories for GitHub Pages deployment."""

import argparse
import json
import shutil
from pathlib import Path


def get_repo_name():
    """Get repository name from directory or default."""
    cwd = Path.cwd()
    return cwd.name or "static-site"


def clean_create_site(out_dir):
    """Remove and recreate the output directory."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Created clean output directory: {out_dir}")


def copy_app_web(apps_dir, app_name, out_dir, site_subdir):
    """Copy app's web directory to output, return files copied."""
    src = apps_dir / app_name / "web"
    dst = out_dir / site_subdir

    if not src.exists():
        print(f"  [SKIP] {app_name}/web does not exist")
        return []

    if not src.is_dir():
        print(f"  [SKIP] {app_name}/web is not a directory")
        return []

    shutil.copytree(src, dst)
    copied = list(dst.rglob("*"))
    print(f"  [OK] Copied {app_name}/web -> {site_subdir}/ ({len(copied)} items)")
    return copied


def write_nojekyll(out_dir):
    """Write empty .nojekyll file to disable Jekyll processing."""
    nojekyll = out_dir / ".nojekyll"
    nojekyll.write_text("", encoding="utf-8")
    print(f"Created {nojekyll}")


# Each app lists the entry points the landing page links to (paths are relative
# to the site root). Every product ships three versions — App, Web and Mobile.
#   App    = installable application (installable PWA, or the native desktop app)
#   Web    = desktop browser build
#   Mobile = mobile-optimised build
APPS_FILE = Path(__file__).resolve().parent / "apps.json"


def load_apps():
    """Return the catalog entries from scripts/apps.json, in publish order."""
    data = json.loads(APPS_FILE.read_text(encoding="utf-8"))
    apps = data["apps"] if isinstance(data, dict) else data
    return sorted(apps, key=lambda a: a.get("order", 0))


def build_landing_apps(catalog):
    """Map catalog entries to the {name, desc, links} rows the landing page needs."""
    landing = []
    for app in catalog:
        if app.get("external") or app.get("work") or not app.get("listed", True):
            continue
        links = app["links"]
        landing.append({
            "name": app["name"],
            "desc": app["desc"],
            "links": ([("Windows app", links["app"])] if app.get("native") else
                      [(c["label"], c["path"]) for c in app["card_links"]] if app.get("card_links") else
                      [("App", links["app"]), ("Web", links["web"]), ("Mobile", links["mobile"])]),
        })
    return landing


# Apps that were renamed: old site path -> the app's current id. A tiny redirect
# stub is emitted at the old path so existing links/bookmarks keep working.
# The target may be a sub-app inside an app folder (e.g. "glow/room" for the Glow ecosystem).
REDIRECTS = {
    "ziris-motor": "airiz-motor",
    "mufakat": "glow/chat",
    "virtual-bots": "glow/room",
    # Hookline -> Sped -> Hazel Sped: point straight at the current home (no redirect chains).
    "hookline": "hazel/sped",
    "trade-twin": "twin",
    "sheetmint": "mint",
    # Kitty (shared budgeting) became the Budget half of Mint in Mint 3.0.
    "kitty": "mint/budget",
    # Shortcraft, Sped and the original Hazel became one app, Hazel, with three branches:
    # Hazel Shorts, Hazel Sped and Hazel Long (the original Hazel web studio moved to hazel/long).
    "shortcraft": "hazel/shorts",
    "sped": "hazel/sped",
}

# Pages besides index/app/web/mobile that lived at an old path and still get a stub there
# (only emitted when the page exists at the new path).
REDIRECT_EXTRA_PAGES = {
    "kitty": ["get.html", "demo.html", "tests.html"],
    "shortcraft": ["channel.html"],
}

# Renamed installable apps whose old service worker must be retired at the old path.
# Each entry lists the cache-name prefixes that belonged to that old worker only
# ("{scope}" is replaced by the old registration scope at runtime) and the page the
# old home-screen icon should open now.
LEGACY_WORKERS = {
    "mufakat": {"cache_prefixes": ["mufakat-"], "start": "app.html", "reload_clients": False},
    "hookline": {"cache_prefixes": ["hookline-v"], "start": "", "reload_clients": False},
    # Sped 1.4 cached as sped-v1.4.0; Hazel Sped uses hazel-sped-v…, which this prefix never matches.
    "sped": {"cache_prefixes": ["sped-v"], "start": "", "reload_clients": False},
    "virtual-bots": {"cache_prefixes": ["crewroom-"], "start": "", "reload_clients": True},
    "trade-twin": {
        "cache_prefixes": ["trade-twin:{scope}", "tt-shell-v"],
        "start": "",
        "reload_clients": True,
    },
    "sheetmint": {"cache_prefixes": ["sheetmint-"], "start": "app.html", "reload_clients": True},
    # "copy": files from the new path that open copies of the old app still poll. Kitty 1.5 reads
    # version.json next to itself; seeing the new version it updates in place, lands on the redirect
    # stub and opens Mint Budget with the same budgets, page and month.
    "kitty": {"cache_prefixes": ["kitty-"], "start": "", "reload_clients": True, "copy": ["version.json"]},
}


def write_redirects(out_dir, catalog):
    """Emit redirect stubs for renamed apps (old path -> current path)."""
    ids = {app["id"] for app in catalog}
    for old_id, new_id in REDIRECTS.items():
        if new_id.split("/")[0] not in ids:
            continue
        targets = [
            ("index.html", f"../{new_id}/", out_dir / new_id),
            ("app.html", f"../{new_id}/app.html", out_dir / new_id / "app.html"),
            ("web.html", f"../{new_id}/web.html", out_dir / new_id / "web.html"),
            ("mobile.html", f"../{new_id}/mobile.html", out_dir / new_id / "mobile.html"),
        ]
        targets += [
            (page, f"../{new_id}/{page}", out_dir / new_id / page)
            for page in REDIRECT_EXTRA_PAGES.get(old_id, [])
        ]
        for page, target, target_path in targets:
            if not target_path.exists():
                continue
            dst = out_dir / old_id / page
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(
                '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
                '<meta charset="UTF-8">\n'
                f'<noscript><meta http-equiv="refresh" content="0; url={target}"></noscript>\n'
                f'<script src="./redirect.js" data-target="{target}"></script>\n'
                f'<link rel="canonical" href="{target}">\n'
                '<title>Moved</title>\n</head>\n<body>\n'
                f'<p>This page moved to <a href="{target}">{new_id}</a>.</p>\n'
                '</body>\n</html>\n',
                encoding="utf-8")
        (out_dir / old_id).mkdir(parents=True, exist_ok=True)
        (out_dir / old_id / "redirect.js").write_text(
            '"use strict";\n'
            'const destination = new URL(document.currentScript.dataset.target, location.href);\n'
            'destination.search = location.search;\n'
            'destination.hash = location.hash;\n'
            'location.replace(destination.href);\n',
            encoding="utf-8",
        )
        legacy = LEGACY_WORKERS.get(old_id)
        if legacy:
            # Retire only this app's former worker/cache, not other Pages apps.
            checks = []
            for prefix in legacy["cache_prefixes"]:
                if "{scope}" in prefix:
                    checks.append(f"name.startsWith('{prefix.replace('{scope}', '')}' + self.registration.scope)")
                else:
                    checks.append(f"name.startsWith('{prefix}')")
            condition = " || ".join(checks)
            reload_clients = (
                "      .then(() => self.clients.matchAll({ type: 'window' }))\n"
                "      .then((clients) => Promise.all(clients.map((client) => client.navigate(client.url))))\n"
                if legacy["reload_clients"] else ""
            )
            (out_dir / old_id / "sw.js").write_text(
                "self.addEventListener('install', () => self.skipWaiting());\n"
                "self.addEventListener('activate', (event) => {\n"
                "  event.waitUntil(caches.keys().then((names) => Promise.all(\n"
                f"    names.filter((name) => {condition})\n"
                "      .map((name) => caches.delete(name))\n"
                "  )).then(() => self.registration.unregister())\n"
                f"{reload_clients}"
                "  );\n"
                "});\n",
                encoding="utf-8",
            )
            for name in legacy.get("copy", []):
                source = out_dir / new_id / name
                if source.exists():
                    shutil.copyfile(source, out_dir / old_id / name)
            target_manifest = out_dir / new_id / "manifest.webmanifest"
            if target_manifest.exists():
                legacy_manifest = json.loads(target_manifest.read_text())
                legacy_manifest["start_url"] = f"../{new_id}/" + legacy["start"]
                legacy_manifest["scope"] = f"../{new_id}/"
                for icon in legacy_manifest["icons"]:
                    icon["src"] = f"../{new_id}/" + icon["src"].removeprefix("./")
                (out_dir / old_id / "manifest.webmanifest").write_text(
                    json.dumps(legacy_manifest, indent=2) + "\n", encoding="utf-8"
                )
        print(f"  [redirect] {old_id}/ -> {new_id}/")


def generate_index(out_dir, repo_name, apps):
    """Generate the main index.html landing page with Desktop/Mobile links."""
    index_html = out_dir / "index.html"

    cards = []
    for app in apps:
        buttons = "\n".join(
            f'          <a class="btn" href="{href}">{label}</a>'
            for label, href in app["links"]
        )
        cards.append(
            f'''      <div class="card">
        <h2>{app["name"]}</h2>
        <p>{app["desc"]}</p>
        <div class="variants">
{buttons}
        </div>
      </div>'''
        )
    cards_html = "\n".join(cards)

    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{repo_name}</title>
  <style>
    :root {{
      --bg: #F7F8FB;
      --surface: #FFFFFF;
      --ink: #101828;
      --muted: #667085;
      --line: #E4E7EC;
      --brand: #4F46E5;
      --brand-600: #4338CA;
      --brand-50: #EEF2FF;
      --radius: 12px;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.06), 0 8px 24px -10px rgba(16, 24, 40, 0.18);
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: var(--font);
      background: var(--bg);
      color: var(--ink);
      line-height: 1.6;
      padding: 48px 24px;
      min-height: 100vh;
    }}
    .container {{
      max-width: 900px;
      margin: 0 auto;
    }}
    h1 {{
      font-size: 2.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      color: var(--ink);
    }}
    .subtitle {{
      font-size: 1.125rem;
      color: var(--muted);
      margin-bottom: 40px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-top: 32px;
    }}
    .card {{
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 24px;
      display: flex;
      flex-direction: column;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }}
    .card:hover {{
      transform: translateY(-2px);
      box-shadow: var(--shadow);
      border-color: var(--brand);
    }}
    .card h2 {{
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--brand-600);
    }}
    .card p {{
      font-size: 0.95rem;
      color: var(--muted);
      margin: 0;
    }}
    .variants {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 20px;
    }}
    .btn {{
      flex: 1;
      text-align: center;
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--brand-600);
      text-decoration: none;
      transition: background 0.15s ease, border-color 0.15s ease;
    }}
    .btn:hover {{
      background: var(--brand-50);
      border-color: var(--brand);
    }}
    footer {{
      margin-top: 64px;
      padding-top: 24px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 0.875rem;
      text-align: center;
    }}
  </style>
</head>
<body>
  <div class="container">
    <h1>{repo_name}</h1>
    <p class="subtitle">Product projects — native desktop apps and web/mobile experiences</p>

    <div class="grid">
{cards_html}
    </div>

    <footer>
      <p>Built with Python stdlib only · Deployed to GitHub Pages</p>
    </footer>
  </div>
</body>
</html>
'''

    index_html.write_text(html_content, encoding="utf-8")
    print(f"Generated {index_html}")


def main():
    parser = argparse.ArgumentParser(description="Build static site from apps/*/web directories")
    parser.add_argument("--out", default="_site", help="Output directory (default: _site)")
    args = parser.parse_args()

    repo_root = Path.cwd()
    out_dir = repo_root / args.out
    apps_dir = repo_root / "apps"

    print(f"Building static site from {apps_dir}")
    print(f"Output directory: {out_dir}")
    print()

    clean_create_site(out_dir)

    catalog = load_apps()

    print("Copying app web directories:")
    for app in catalog:
        if app.get("external") or app.get("work"):
            continue
        copy_app_web(apps_dir, app["id"], out_dir, app["id"])

    print()

    write_redirects(out_dir, catalog)
    write_nojekyll(out_dir)

    repo_name = get_repo_name().replace("-", " ").title()
    generate_index(out_dir, repo_name, build_landing_apps(catalog))

    print()
    print("Build complete!")
    print(f"Output: {out_dir.absolute()}")


if __name__ == "__main__":
    main()
