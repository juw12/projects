"""Build a single-file .exe of PTB RDME Widget.

Run from the project root:
    python build.py

Output:
    dist/PTB-RDME-Widget.exe  (~14 MB, single file, no Python needed on target)
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main():
    spec = ROOT / "widget.spec"
    if not spec.exists():
        sys.exit(f"missing spec: {spec}")

    print(f"[build] running PyInstaller with {spec}")
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--clean", "-y", str(spec)],
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        sys.exit(f"PyInstaller failed (exit {result.returncode})")

    exe = ROOT / "dist" / "PTB-RDME-Widget.exe"
    if exe.exists():
        size_mb = exe.stat().st_size / 1024 / 1024
        print(f"[build] OK: {exe} ({size_mb:.1f} MB)")
    else:
        sys.exit(f"PyInstaller reported success but {exe} not found")

    data_dir = ROOT / "dist" / "data"
    seed = ROOT / "data" / "ptb_rdme.sqlite3"
    if seed.exists() and not (data_dir / "ptb_rdme.sqlite3").exists():
        data_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(seed, data_dir / "ptb_rdme.sqlite3")
        print(f"[build] copied seed DB to {data_dir}/ptb_rdme.sqlite3")

    print()
    print("Done. To run:")
    print(f"  {exe}")
    print()
    print("Distribute: zip the `dist/` folder (PTB-RDME-Widget.exe + data/)")


if __name__ == "__main__":
    main()
