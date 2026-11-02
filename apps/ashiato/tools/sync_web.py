#!/usr/bin/env python3
"""Copy the runnable web prototype (prototypes/cozy3d) into web/ for GitHub Pages.

The juw12/projects monorepo publishes apps/<id>/web/ to https://juw12.github.io/projects/<id>/.
Only the files the browser needs are copied (no render/shoot helpers, checks or exports).

    python tools/sync_web.py
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "prototypes" / "cozy3d"
DST = ROOT / "web"

FILES = ["index.html", "tidy.html", "diorama.js", "i18n.js"]
DIRS = ["assets", "vendor"]


def main():
    if DST.exists():
        shutil.rmtree(DST)
    DST.mkdir(parents=True)
    for name in FILES:
        shutil.copy2(SRC / name, DST / name)
    for name in DIRS:
        shutil.copytree(SRC / name, DST / name)
    count = sum(1 for p in DST.rglob("*") if p.is_file())
    print(f"web/: {count} files copied from {SRC.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
