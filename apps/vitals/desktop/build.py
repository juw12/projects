#!/usr/bin/env python3
"""Build the downloadable Vitals desktop app for the system this runs on.

    python -m pip install pyinstaller pillow
    python apps/vitals/desktop/build.py [--require-installer]

Output in apps/vitals/desktop/dist/ (the names the "vitals" GitHub release uses):
  Windows  Vitals-Windows-Setup.exe     per-user installer, no admin rights (needs Inno Setup 6)
           Vitals-Windows-Portable.zip  unzip and run Vitals.exe
  macOS    Vitals-macOS-AppleSilicon.dmg or Vitals-macOS-Intel.dmg (the chip of this Mac)
  Linux    Vitals-Linux-x64.deb         Ubuntu, Debian, Mint, Pop!_OS ...
           Vitals-Linux-x64.tar.gz      any distribution with glibc as new as the build machine's
The bundled app runs the same agent and dashboard as the one-line installers, with Python inside.
"""

import argparse
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile

DESKTOP = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(DESKTOP)
BUILD = os.path.join(DESKTOP, "build")
DIST = os.path.join(DESKTOP, "dist")
HOMEPAGE = "https://juw12.github.io/projects/vitals/"

WINDOWS_VERSION_INFO = """VSVersionInfo(
  ffi=FixedFileInfo(filevers={numbers}, prodvers={numbers}, mask=0x3f, flags=0x0, OS=0x40004,
                    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'Juwen Lie'),
      StringStruct('FileDescription', 'Vitals - device health copilot'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'Vitals'),
      StringStruct('LegalCopyright', 'Open source - github.com/juw12/projects'),
      StringStruct('OriginalFilename', 'Vitals.exe'),
      StringStruct('ProductName', 'Vitals'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""

LINUX_README = """Vitals for Linux {version}

Run it:   ./vitals          (from this folder; some file managers don't start programs on double-click)

The first run adds Vitals to your app menu, starts it quietly when you log in, and opens the
dashboard in your browser (http://127.0.0.1:8765/). Open Vitals from the menu any time.

  ./vitals --remove-login-item   stop starting Vitals at login
  ./vitals --stop                stop the background agent

Your history and the Undo Vault live in ~/.vitals. More: {homepage}
"""

DEB_CONTROL = """Package: vitals
Version: {version}
Section: utils
Priority: optional
Architecture: {arch}
Maintainer: Juwen Lie <juw12@users.noreply.github.com>
Homepage: {homepage}
Installed-Size: {size_kb}
Depends: libc6 (>= {glibc})
Description: Device health copilot
 Undoable storage cleaning (72-hour Undo Vault), battery wear forecast, drain
 detective and a chat that diagnoses problems in plain words. Runs only on this
 computer; the dashboard opens in your browser.
"""


def read_version():
    with open(os.path.join(APP, "server", "server.py"), encoding="utf-8") as handle:
        match = re.search(r'^VERSION = "([^"]+)"', handle.read(), re.M)
    return match.group(1)


def stage_web():
    """Copy the dashboard files the installers ship (listed in web/files.txt) into build/web."""
    target = os.path.join(BUILD, "web")
    shutil.rmtree(target, ignore_errors=True)
    with open(os.path.join(APP, "web", "files.txt"), encoding="utf-8") as handle:
        entries = [line.strip() for line in handle if line.strip() and not line.startswith("#")]
    for entry in entries:
        if not entry.startswith("web/"):
            continue
        destination = os.path.join(target, entry[len("web/"):])
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(os.path.join(APP, entry), destination)
    return target


def run_pyinstaller(web, version):
    env = dict(os.environ, VITALS_STAGE_WEB=web, VITALS_VERSION=version)
    if sys.platform == "win32":
        numbers = tuple(int(part) for part in (version.split(".") + ["0", "0", "0"])[:4])
        version_file = os.path.join(BUILD, "version_info.txt")
        with open(version_file, "w", encoding="utf-8") as handle:
            handle.write(WINDOWS_VERSION_INFO.format(numbers=numbers, version=version))
        env["VITALS_VERSION_FILE"] = version_file
    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--distpath", DIST,
            "--workpath", os.path.join(BUILD, "pyinstaller"),
            os.path.join(DESKTOP, "vitals.spec"),
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


def package_windows(version, require_installer):
    folder = os.path.join(DIST, "Vitals")
    portable = os.path.join(DIST, "Vitals-Windows-Portable.zip")
    zip_folder(folder, portable, "Vitals")
    made = [portable]
    iscc = find_iscc()
    if not iscc:
        if require_installer:
            raise SystemExit("Inno Setup 6 (ISCC.exe) was not found - install it to build Vitals-Windows-Setup.exe")
        print("Inno Setup 6 not found: skipped Vitals-Windows-Setup.exe (the portable zip was built)")
        return made
    subprocess.run(
        [iscc, "/Qp", "/DAppVersion=" + version, "/DSourceDir=" + folder, "/DOutputDir=" + DIST,
         os.path.join(DESKTOP, "vitals.iss")],
        check=True,
    )
    return [os.path.join(DIST, "Vitals-Windows-Setup.exe")] + made


def package_macos():
    app = os.path.join(DIST, "Vitals.app")
    chip = "AppleSilicon" if platform.machine() == "arm64" else "Intel"
    image = os.path.join(DIST, "Vitals-macOS-%s.dmg" % chip)
    stage = os.path.join(BUILD, "dmg")
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    subprocess.run(["ditto", app, os.path.join(stage, "Vitals.app")], check=True)  # keeps links and signature
    os.symlink("/Applications", os.path.join(stage, "Applications"))
    create_disk_image(stage, image)
    return [image]


def create_disk_image(stage, image, attempts=5):
    """hdiutil sometimes fails with "Resource busy" while macOS is still scanning the new
    volume (common on CI runners), so try a few times before giving up."""
    command = ["hdiutil", "create", "-volname", "Vitals", "-srcfolder", stage, "-ov", "-format", "UDZO", image]
    for attempt in range(1, attempts + 1):
        if os.path.exists(image):
            os.remove(image)
        result = subprocess.run(command, capture_output=True, text=True)
        if result.stdout.strip():
            print(result.stdout.strip())
        if result.returncode == 0:
            return
        message = (result.stderr or result.stdout).strip() or "exit code %d" % result.returncode
        if attempt == attempts:
            raise SystemExit("hdiutil create failed %d times: %s" % (attempts, message))
        wait = 10 * attempt
        print("hdiutil create failed (%s); trying again in %d s" % (message, wait))
        time.sleep(wait)


def linux_arch():
    machine = platform.machine().lower()
    if machine in ("x86_64", "amd64"):
        return "x64", "amd64"
    if machine in ("aarch64", "arm64"):
        return "arm64", "arm64"
    return machine, machine


def folder_size_kb(folder):
    total = 0
    for current, _dirs, files in os.walk(folder):
        for name in files:
            path = os.path.join(current, name)
            if not os.path.islink(path):
                total += os.path.getsize(path)
    return max(1, total // 1024)


def package_linux(version):
    folder = os.path.join(DIST, "Vitals")
    suffix, deb_arch = linux_arch()
    icon = os.path.join(APP, "web", "icons", "icon-512.png")
    shutil.copy2(icon, os.path.join(folder, "vitals.png"))
    with open(os.path.join(folder, "README.txt"), "w", encoding="utf-8") as handle:
        handle.write(LINUX_README.format(version=version, homepage=HOMEPAGE))

    archive = os.path.join(DIST, "Vitals-Linux-%s.tar.gz" % suffix)
    with tarfile.open(archive, "w:gz") as bundle:
        bundle.add(folder, arcname="Vitals")
    made = [archive]

    if not shutil.which("dpkg-deb"):
        print("dpkg-deb not found: skipped the .deb package")
        return made
    root = os.path.join(BUILD, "deb")
    shutil.rmtree(root, ignore_errors=True)
    shutil.copytree(folder, os.path.join(root, "opt", "vitals"), symlinks=True)
    os.makedirs(os.path.join(root, "usr", "bin"))
    os.symlink("/opt/vitals/vitals", os.path.join(root, "usr", "bin", "vitals"))
    applications = os.path.join(root, "usr", "share", "applications")
    os.makedirs(applications)
    with open(os.path.join(applications, "vitals.desktop"), "w", encoding="utf-8") as handle:
        handle.write(
            "[Desktop Entry]\nType=Application\nName=Vitals\nComment=Device health copilot\n"
            "Exec=/usr/bin/vitals\nTryExec=/usr/bin/vitals\nIcon=vitals\nTerminal=false\n"
            "Categories=System;Utility;\n"
        )
    icons = os.path.join(root, "usr", "share", "icons", "hicolor", "512x512", "apps")
    os.makedirs(icons)
    shutil.copy2(icon, os.path.join(icons, "vitals.png"))
    os.makedirs(os.path.join(root, "DEBIAN"))
    glibc = platform.libc_ver()[1] or "2.31"
    with open(os.path.join(root, "DEBIAN", "control"), "w", encoding="utf-8") as handle:
        handle.write(DEB_CONTROL.format(version=version, arch=deb_arch, homepage=HOMEPAGE,
                                        size_kb=folder_size_kb(root), glibc=glibc))
    package = os.path.join(DIST, "Vitals-Linux-%s.deb" % suffix)
    subprocess.run(["dpkg-deb", "--build", "--root-owner-group", root, package], check=True)
    return [package] + made


def main():
    parser = argparse.ArgumentParser(description="Build the Vitals desktop app for this system")
    parser.add_argument("--require-installer", action="store_true",
                        help="Windows: fail if Inno Setup is missing instead of building only the portable zip")
    args = parser.parse_args()

    version = read_version()
    os.makedirs(BUILD, exist_ok=True)
    for leftover in ("Vitals", "Vitals.app"):
        shutil.rmtree(os.path.join(DIST, leftover), ignore_errors=True)
    print("Building Vitals %s for %s %s" % (version, platform.system(), platform.machine()))
    run_pyinstaller(stage_web(), version)

    if sys.platform == "win32":
        made = package_windows(version, args.require_installer)
    elif sys.platform == "darwin":
        made = package_macos()
    else:
        made = package_linux(version)
    print("\nBuilt:")
    for path in made:
        print("  %s (%.1f MB)" % (path, os.path.getsize(path) / 1e6))


if __name__ == "__main__":
    main()
