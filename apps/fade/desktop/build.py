#!/usr/bin/env python3
"""Build Fade for Windows (and macOS) on the system this runs on.

    python -m pip install pyinstaller pillow pywebview
    python apps/fade/desktop/build.py [--require-installer]

Output in apps/fade/desktop/dist/ (the names the "fade" GitHub release uses):
  Windows  Fade-Windows-Setup.exe      per-user installer, no admin rights (needs Inno Setup 6)
           Fade-Windows-Portable.zip   unzip and run Fade.exe
  macOS    Fade-macOS-AppleSilicon.dmg or Fade-macOS-Intel.dmg (the chip of this Mac)
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
      StringStruct('FileDescription', 'Fade - barbers and haircut shorts'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'Fade'),
      StringStruct('LegalCopyright', 'Open source - github.com/juw12/projects'),
      StringStruct('OriginalFilename', 'Fade.exe'),
      StringStruct('ProductName', 'Fade'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""


def read_version():
    """The desktop app's version: the one web/desktop.json announces (fade_app.py must say the same)."""
    with open(os.path.join(APP, "web", "desktop.json"), encoding="utf-8") as handle:
        version = json.load(handle)["desktop"]["version"]
    with open(os.path.join(DESKTOP, "fade_app.py"), encoding="utf-8") as handle:
        match = re.search(r'^VERSION = "([^"]+)"', handle.read(), re.M)
    if not match or match.group(1) != version:
        raise SystemExit("web/desktop.json says %s but fade_app.py says %s" % (version, match and match.group(1)))
    return version


def draw_icon(size=1024):
    """Fade's mark drawn with Pillow: the "fade." wordmark's f and lime dot on a night tile with a violet glow
    (the app's --bg #0b0b0f, --acc2 #7c5cff and --acc #c8ff3d). Opaque, so it reads on light and dark taskbars."""
    from PIL import Image, ImageDraw, ImageFilter

    unit = size / 512.0
    tile = Image.new("RGBA", (size, size))
    pixels = tile.load()
    top, bottom = (0x2A, 0x1F, 0x5C), (0x0B, 0x0B, 0x0F)  # violet-tinted night, top left -> bottom right
    for y in range(size):
        for x in range(size):
            t = min(1.0, (x * 0.35 + y * 0.65) / (size - 1))
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,)
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([-120 * unit, -140 * unit, 330 * unit, 300 * unit], fill=(0x7C, 0x5C, 0xFF, 120))
    tile = Image.alpha_composite(tile, glow.filter(ImageFilter.GaussianBlur(70 * unit)))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=round(112 * unit), fill=255)
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(tile, (0, 0), mask)

    # A heavy lower-case f: stem, hooked top and crossbar, in Fade's text white.
    ink = (0xF4, 0xF4, 0xF6, 255)
    letter = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pen = ImageDraw.Draw(letter)
    stem_left, stem_right = 168 * unit, 238 * unit
    pen.rectangle([stem_left, 196 * unit, stem_right, 410 * unit], fill=ink)                       # stem
    pen.pieslice([stem_left, 96 * unit, 366 * unit, 294 * unit], 180, 270, fill=ink)               # outer hook
    pen.rectangle([267 * unit, 96 * unit, 334 * unit, 162 * unit], fill=ink)                        # hook end
    pen.pieslice([stem_right, 162 * unit, 300 * unit, 230 * unit], 180, 270, fill=(0, 0, 0, 0))     # inner curve
    pen.rectangle([stem_right, 162 * unit, 334 * unit, 196 * unit], fill=(0, 0, 0, 0))
    pen.rectangle([stem_right, 162 * unit, 267 * unit, 196 * unit], fill=(0, 0, 0, 0))
    pen.rounded_rectangle([120 * unit, 214 * unit, 318 * unit, 270 * unit], radius=round(10 * unit), fill=ink)  # crossbar
    icon = Image.alpha_composite(icon, letter)

    dot = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(dot).ellipse([300 * unit, 340 * unit, 376 * unit, 416 * unit], fill=(0xC8, 0xFF, 0x3D, 255))
    return Image.alpha_composite(icon, dot)


def make_icon():
    """The app icon: .ico on Windows, a 1024 px PNG on macOS."""
    os.makedirs(BUILD, exist_ok=True)
    icon = draw_icon()
    if sys.platform != "win32":
        target = os.path.join(BUILD, "fade.png")
        icon.save(target)
        return target
    target = os.path.join(BUILD, "fade.ico")
    icon.save(target, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return target


def run_pyinstaller(version, icon):
    env = dict(os.environ, FADE_SHELL_VERSION=version, FADE_ICON=icon)
    if sys.platform == "win32":
        numbers = tuple(int(part) for part in (version.split(".") + ["0", "0", "0"])[:4])
        version_file = os.path.join(BUILD, "version_info.txt")
        with open(version_file, "w", encoding="utf-8") as handle:
            handle.write(WINDOWS_VERSION_INFO.format(numbers=numbers, version=version))
        env["FADE_VERSION_FILE"] = version_file
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--distpath", DIST,
            "--workpath", os.path.join(BUILD, "pyinstaller"),
            os.path.join(DESKTOP, "fade.spec"),
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
    folder = os.path.join(DIST, "Fade")
    portable = os.path.join(DIST, "Fade-Windows-Portable.zip")
    zip_folder(folder, portable, "Fade")
    made = [portable]
    iscc = find_iscc()
    if not iscc:
        if require_installer:
            raise SystemExit("Inno Setup 6 (ISCC.exe) was not found - install it to build Fade-Windows-Setup.exe")
        print("Inno Setup 6 not found: skipped Fade-Windows-Setup.exe (the portable zip was built)")
        return made
    subprocess.run(
        [iscc, "/Qp", "/DAppVersion=" + version, "/DSourceDir=" + folder, "/DOutputDir=" + DIST,
         "/DIconFile=" + icon, os.path.join(DESKTOP, "fade.iss")],
        check=True,
    )
    return [os.path.join(DIST, "Fade-Windows-Setup.exe")] + made


def package_macos():
    app = os.path.join(DIST, "Fade.app")
    chip = "AppleSilicon" if platform.machine() == "arm64" else "Intel"
    image = os.path.join(DIST, "Fade-macOS-%s.dmg" % chip)
    stage = os.path.join(BUILD, "dmg")
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    subprocess.run(["ditto", app, os.path.join(stage, "Fade.app")], check=True)  # keeps links and signature
    os.symlink("/Applications", os.path.join(stage, "Applications"))
    command = ["hdiutil", "create", "-volname", "Fade", "-srcfolder", stage, "-ov", "-format", "UDZO", image]
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
    parser = argparse.ArgumentParser(description="Build the Fade desktop app for this system")
    parser.add_argument("--require-installer", action="store_true",
                        help="Windows: fail if Inno Setup is missing instead of building only the portable zip")
    args = parser.parse_args()
    if sys.platform not in ("win32", "darwin"):
        raise SystemExit("Fade desktop builds are made on Windows and macOS")
    try:
        import webview  # noqa: F401  (bundled by fade.spec)
    except ImportError:
        raise SystemExit("The Fade window needs pywebview: python -m pip install pywebview")

    version = read_version()
    os.makedirs(BUILD, exist_ok=True)
    for leftover in ("Fade", "Fade.app"):
        shutil.rmtree(os.path.join(DIST, leftover), ignore_errors=True)
    print("Building Fade desktop %s for %s %s" % (version, platform.system(), platform.machine()))
    icon = make_icon()
    run_pyinstaller(version, icon)
    made = package_windows(version, icon, args.require_installer) if sys.platform == "win32" else package_macos()
    print("\nBuilt:")
    for path in made:
        print("  %s (%.1f MB)" % (path, os.path.getsize(path) / 1e6))


if __name__ == "__main__":
    main()
