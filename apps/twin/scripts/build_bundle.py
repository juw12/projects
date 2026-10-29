"""Build the bundle a local Twin server downloads when you tap Update in the app.

    python apps/twin/scripts/build_bundle.py --out _site/twin

Writes <out>/download/twin-local-<version>.zip — this Twin folder without tests, data or caches, inside
a top-level twin/ folder, with fixed timestamps so the same files always give the same SHA-256 — and adds
"bundle": {url, sha256, size, files} to <out>/release.json (copied there from web/ by the site build).
The server checks that SHA-256 and the version inside before it installs anything (server.py).
"""
import argparse
import hashlib
import json
import os
import re
import sys
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
SKIP_DIRS = {"tests", "data", "__pycache__", ".git", ".pytest_cache", "node_modules"}
SKIP_SUFFIXES = {".pyc", ".pyo"}
EXECUTABLE_SUFFIXES = {".command", ".sh"}
FIXED_TIME = (2020, 1, 1, 0, 0, 0)


def bundle_files(app_dir):
    """Every file a local install needs, as paths relative to the Twin folder."""
    for path in sorted(app_dir.rglob("*")):
        rel = path.relative_to(app_dir)
        if path.is_file() and not (set(rel.parts) & SKIP_DIRS) and path.suffix not in SKIP_SUFFIXES:
            yield rel


def app_version(app_dir):
    match = re.search(r'^VERSION = "([^"]+)"', (app_dir / "server.py").read_text(encoding="utf-8"), re.M)
    if not match:
        raise SystemExit("No VERSION in %s" % (app_dir / "server.py"))
    return match.group(1)


def is_executable(path):
    if path.suffix in EXECUTABLE_SUFFIXES:
        return True
    return os.name != "nt" and bool(path.stat().st_mode & 0o100)


def build(app_dir, out_dir):
    version = app_version(app_dir)
    release_path = out_dir / "release.json"
    if not release_path.exists():  # building next to a source tree instead of a built site
        release_path.parent.mkdir(parents=True, exist_ok=True)
        release_path.write_text((app_dir / "web" / "release.json").read_text(encoding="utf-8"), encoding="utf-8")
    release = json.loads(release_path.read_text(encoding="utf-8"))
    if release.get("version") != version:
        raise SystemExit("release.json says %s but server.py says %s" % (release.get("version"), version))
    name = "twin-local-%s.zip" % version
    target = out_dir / "download" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    files = list(bundle_files(app_dir))
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel in files:
            source = app_dir / rel
            info = zipfile.ZipInfo("twin/" + rel.as_posix(), date_time=FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (0o755 if is_executable(source) else 0o644) << 16
            archive.writestr(info, source.read_bytes())
    data = target.read_bytes()
    release["bundle"] = {
        "url": "download/" + name,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "files": len(files),
    }
    release_path.write_text(json.dumps(release, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return target, release["bundle"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="Twin's folder in the built site, e.g. _site/twin")
    parser.add_argument("--app", type=Path, default=APP, help="the Twin folder to bundle (default: this one)")
    args = parser.parse_args(argv)
    target, bundle = build(args.app.resolve(), args.out.resolve())
    print("Twin bundle: %s (%d files, %.1f MB, sha256 %s)"
          % (target, bundle["files"], bundle["size"] / 1e6, bundle["sha256"][:16]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
