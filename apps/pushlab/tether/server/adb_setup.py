"""One-click adb: download Google's Android SDK Platform-Tools next to Tether.

  python apps/pushlab/tether/server/adb_setup.py          # or the "Install adb" button in the UI

Installs into apps/pushlab/tether/tools/platform-tools (git-ignored) and never touches
system folders or PATH. Honours the system / corporate proxy like a browser.
By downloading you accept the Android SDK Platform-Tools terms:
https://developer.android.com/studio/releases/platform-tools
"""

from __future__ import annotations

import io
import os
import shutil
import stat
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

TOOLS_DIR = Path(os.environ.get("TETHER_TOOLS_DIR") or Path(__file__).resolve().parent.parent / "tools")
DOWNLOADS = {
    "win32": "https://dl.google.com/android/repository/platform-tools-latest-windows.zip",
    "darwin": "https://dl.google.com/android/repository/platform-tools-latest-darwin.zip",
    "linux": "https://dl.google.com/android/repository/platform-tools-latest-linux.zip",
}
TERMS_URL = "https://developer.android.com/studio/releases/platform-tools"
MAX_DOWNLOAD = 200 * 1024 * 1024


class SetupError(RuntimeError):
    pass


def bundled_adb() -> Path | None:
    exe = "adb.exe" if os.name == "nt" else "adb"
    candidate = TOOLS_DIR / "platform-tools" / exe
    return candidate if candidate.is_file() else None


def download_url() -> str:
    override = os.environ.get("TETHER_PLATFORM_TOOLS_URL")
    if override:
        return override
    for prefix, url in DOWNLOADS.items():
        if sys.platform.startswith(prefix):
            return url
    raise SetupError(f"no platform-tools download for platform {sys.platform}")


def install(progress=None) -> Path:
    """Download + unpack platform-tools. Returns the adb path. Safe to re-run."""
    url = download_url()
    if progress:
        progress(f"Downloading {url}")
    try:
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read(MAX_DOWNLOAD + 1)
    except OSError as exc:
        raise SetupError(f"download failed: {exc}") from exc
    if len(data) > MAX_DOWNLOAD:
        raise SetupError("download unexpectedly large; aborting")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise SetupError("the download is not a zip file (blocked by a proxy?)") from exc

    TOOLS_DIR.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="platform-tools-", dir=TOOLS_DIR))
    try:
        for member in archive.infolist():
            target = (staging / member.filename).resolve()
            if staging.resolve() not in target.parents and target != staging.resolve():
                raise SetupError(f"unsafe path in archive: {member.filename}")
        archive.extractall(staging)
        unpacked = staging / "platform-tools"
        exe = "adb.exe" if os.name == "nt" else "adb"
        if not (unpacked / exe).is_file():
            raise SetupError("archive does not contain platform-tools/" + exe)
        final = TOOLS_DIR / "platform-tools"
        if final.exists():
            shutil.rmtree(final, ignore_errors=True)
        unpacked.rename(final)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    adb = final / exe
    if os.name != "nt":
        adb.chmod(adb.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    if progress:
        progress(f"Installed {adb}")
    return adb


if __name__ == "__main__":
    print(f"Android SDK Platform-Tools terms: {TERMS_URL}")
    try:
        path = install(progress=print)
    except SetupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
    print(f"adb ready: {path}")
