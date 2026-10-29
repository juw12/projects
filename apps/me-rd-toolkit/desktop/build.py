#!/usr/bin/env python3
"""Build ME R&D Toolkit for Windows (and macOS) on the system this runs on.

    python -m pip install pyinstaller pillow pywebview
    python apps/me-rd-toolkit/desktop/build.py [--require-installer]

Output in apps/me-rd-toolkit/desktop/dist/ (the names the "me-rd-toolkit" GitHub release uses):
  Windows  ME-RD-Toolkit-Windows-Setup.exe      per-user installer, no admin rights (needs Inno Setup 6)
           ME-RD-Toolkit-Windows-Portable.zip   unzip and run ME-RD-Toolkit.exe
  macOS    ME-RD-Toolkit-macOS-AppleSilicon.dmg or ME-RD-Toolkit-macOS-Intel.dmg (the chip of this Mac)
"""

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import zipfile

DESKTOP = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(DESKTOP)
BUILD = os.path.join(DESKTOP, "build")
DIST = os.path.join(DESKTOP, "dist")

WINDOWS_VERSION_INFO = """VSVersionInfo(
  ffi=FixedFileInfo(filevers={numbers}, prodvers={numbers}, mask=0x3f, flags=0x0, OS=0x40004,
                    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'Juwen Lie'),
      StringStruct('FileDescription', 'ME R&D Toolkit - mechanical R&D workspace'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'ME-RD-Toolkit'),
      StringStruct('LegalCopyright', 'Open source - github.com/juw12/projects'),
      StringStruct('OriginalFilename', 'ME-RD-Toolkit.exe'),
      StringStruct('ProductName', 'ME R&D Toolkit'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""


def read_version():
    """The desktop app's version: the one web/desktop.json announces (merd_app.py must say the same)."""
    with open(os.path.join(APP, "web", "desktop.json"), encoding="utf-8") as handle:
        version = json.load(handle)["desktop"]["version"]
    with open(os.path.join(DESKTOP, "merd_app.py"), encoding="utf-8") as handle:
        match = re.search(r'^VERSION = "([^"]+)"', handle.read(), re.M)
    if not match or match.group(1) != version:
        raise SystemExit("web/desktop.json says %s but merd_app.py says %s" % (version, match and match.group(1)))
    return version


def draw_icon(size=1024):
    """The toolkit's "ME" badge drawn with Pillow: white letters on an indigo tile (the app's #4f46e5 theme colour).
    Opaque, so it reads on light and dark taskbars."""
    from PIL import Image, ImageDraw

    unit = size / 512.0
    tile = Image.new("RGBA", (size, size))
    pixels = tile.load()
    top, bottom = (0x63, 0x5B, 0xF0), (0x37, 0x30, 0xA3)  # indigo, top left -> bottom right
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * (size - 1))
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=round(112 * unit), fill=255)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(tile, (0, 0), mask)

    ink = (255, 255, 255, 255)
    pen = ImageDraw.Draw(icon)
    stroke = 46 * unit
    top_y, bottom_y = 150 * unit, 362 * unit
    # M: two legs and a V meeting at the middle
    left, right = 70 * unit, 262 * unit
    pen.rectangle([left, top_y, left + stroke, bottom_y], fill=ink)
    pen.rectangle([right - stroke, top_y, right, bottom_y], fill=ink)
    middle_x, middle_y = (left + right) / 2, 300 * unit
    diagonal = round(stroke * 0.82)
    pen.line([(left + stroke * 0.5, top_y + stroke * 0.3), (middle_x, middle_y)], fill=ink, width=diagonal)
    pen.line([(right - stroke * 0.5, top_y + stroke * 0.3), (middle_x, middle_y)], fill=ink, width=diagonal)
    pen.ellipse([middle_x - diagonal / 2, middle_y - diagonal / 2, middle_x + diagonal / 2, middle_y + diagonal / 2], fill=ink)
    pen.rectangle([left, top_y, left + stroke, top_y + stroke * 0.6], fill=ink)
    pen.rectangle([right - stroke, top_y, right, top_y + stroke * 0.6], fill=ink)
    # E: spine and three arms
    e_left, e_right = 298 * unit, 442 * unit
    pen.rectangle([e_left, top_y, e_left + stroke, bottom_y], fill=ink)
    pen.rectangle([e_left, top_y, e_right, top_y + stroke * 0.9], fill=ink)
    pen.rectangle([e_left, (top_y + bottom_y) / 2 - stroke * 0.42, e_right - 18 * unit, (top_y + bottom_y) / 2 + stroke * 0.42], fill=ink)
    pen.rectangle([e_left, bottom_y - stroke * 0.9, e_right, bottom_y], fill=ink)
    # underline: the toolkit's "R&D" accent
    pen.rounded_rectangle([70 * unit, 392 * unit, 442 * unit, 410 * unit], radius=round(9 * unit), fill=(0xC7, 0xD2, 0xFE, 255))
    return icon


def make_icon():
    """The app icon: .ico on Windows, a 1024 px PNG on macOS."""
    os.makedirs(BUILD, exist_ok=True)
    icon = draw_icon()
    if sys.platform != "win32":
        target = os.path.join(BUILD, "me-rd-toolkit.png")
        icon.save(target)
        return target
    target = os.path.join(BUILD, "me-rd-toolkit.ico")
    icon.save(target, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return target


def run_pyinstaller(version, icon):
    env = dict(os.environ, MERD_SHELL_VERSION=version, MERD_ICON=icon)
    if sys.platform == "win32":
        numbers = tuple(int(part) for part in (version.split(".") + ["0", "0", "0"])[:4])
        version_file = os.path.join(BUILD, "version_info.txt")
        with open(version_file, "w", encoding="utf-8") as handle:
            handle.write(WINDOWS_VERSION_INFO.format(numbers=numbers, version=version))
        env["MERD_VERSION_FILE"] = version_file
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--distpath", DIST,
            "--workpath", os.path.join(BUILD, "pyinstaller"),
            os.path.join(DESKTOP, "me-rd-toolkit.spec"),
        ],
        check=True,
        env=env,
    )


def zip_folder(folder, archive, root_name):
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        for current, _dirs, files in os.walk(folder):
            for name in files:
                full = os.path.join(current, name)
                bundle.write(full, os.path.join(root_name, os.path.relpath(full, folder)))


def find_iscc():
    candidates = [
        shutil.which("iscc"),
        os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Inno Setup 6", "ISCC.exe"),
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Inno Setup 6", "ISCC.exe"),
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Inno Setup 6", "ISCC.exe"),
    ]
    return next((path for path in candidates if path and os.path.isfile(path)), None)


def package_windows(version, icon, require_installer):
    folder = os.path.join(DIST, "ME-RD-Toolkit")
    portable = os.path.join(DIST, "ME-RD-Toolkit-Windows-Portable.zip")
    zip_folder(folder, portable, "ME-RD-Toolkit")
    made = [portable]
    iscc = find_iscc()
    if not iscc:
        if require_installer:
            raise SystemExit("Inno Setup 6 (ISCC.exe) was not found - install it to build ME-RD-Toolkit-Windows-Setup.exe")
        print("Inno Setup 6 not found: skipped ME-RD-Toolkit-Windows-Setup.exe (the portable zip was built)")
        return made
    subprocess.run(
        [iscc, "/Qp", "/DAppVersion=" + version, "/DSourceDir=" + folder, "/DOutputDir=" + DIST,
         "/DIconFile=" + icon, os.path.join(DESKTOP, "me-rd-toolkit.iss")],
        check=True,
    )
    return [os.path.join(DIST, "ME-RD-Toolkit-Windows-Setup.exe")] + made


def package_macos():
    app = os.path.join(DIST, "ME-RD-Toolkit.app")
    chip = "AppleSilicon" if platform.machine() == "arm64" else "Intel"
    image = os.path.join(DIST, "ME-RD-Toolkit-macOS-%s.dmg" % chip)
    stage = os.path.join(BUILD, "dmg")
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    subprocess.run(["ditto", app, os.path.join(stage, "ME-RD-Toolkit.app")], check=True)  # keeps links and signature
    os.symlink("/Applications", os.path.join(stage, "Applications"))
    command = ["hdiutil", "create", "-volname", "ME R&D Toolkit", "-srcfolder", stage, "-ov", "-format", "UDZO", image]
    # hdiutil sometimes fails with "Resource busy" while macOS scans the new volume (common on CI runners).
    for attempt in range(1, 6):
        if os.path.exists(image):
            os.remove(image)
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode == 0:
            return [image]
        message = (result.stderr or result.stdout).strip() or "exit code %d" % result.returncode
        if attempt == 5:
            raise SystemExit("hdiutil create failed: %s" % message)
        print("hdiutil create failed (%s); trying again in %d s" % (message, 10 * attempt))
        time.sleep(10 * attempt)
    return [image]


def main():
    parser = argparse.ArgumentParser(description="Build the ME R&D Toolkit desktop app for this system")
    parser.add_argument("--require-installer", action="store_true",
                        help="Windows: fail if Inno Setup is missing instead of building only the portable zip")
    args = parser.parse_args()
    if sys.platform not in ("win32", "darwin"):
        raise SystemExit("ME R&D Toolkit desktop builds are made on Windows and macOS")
    try:
        import webview  # noqa: F401  (bundled by me-rd-toolkit.spec)
    except ImportError:
        raise SystemExit("The toolkit window needs pywebview: python -m pip install pywebview")

    version = read_version()
    os.makedirs(BUILD, exist_ok=True)
    for leftover in ("ME-RD-Toolkit", "ME-RD-Toolkit.app"):
        shutil.rmtree(os.path.join(DIST, leftover), ignore_errors=True)
    print("Building ME R&D Toolkit desktop %s for %s %s" % (version, platform.system(), platform.machine()))
    icon = make_icon()
    run_pyinstaller(version, icon)
    made = package_windows(version, icon, args.require_installer) if sys.platform == "win32" else package_macos()
    print("\nBuilt:")
    for path in made:
        print("  %s (%.1f MB)" % (path, os.path.getsize(path) / 1e6))


if __name__ == "__main__":
    main()
