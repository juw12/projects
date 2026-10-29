#!/usr/bin/env python3
"""Installer checks (stdlib only, exits 0/1).

1. web/files.txt lists exactly the agent files the installers must download.
2. install.sh runs end to end in a throwaway HOME (copying from this checkout
   instead of the network), produces a working app, and uninstalls cleanly.
   No login item is registered and nothing is launched outside the sandbox.
3. install.ps1 passes structural sanity checks (no PowerShell needed).
"""

import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.normpath(os.path.join(HERE, ".."))
WEB = os.path.join(APP_ROOT, "web")
FAILURES = []
EXCLUDED = {"install.sh", "install.ps1", "files.txt"}


def check(condition, label):
    print(("  ok   " if condition else "  FAIL ") + label)
    if not condition:
        FAILURES.append(label)


def manifest():
    with open(os.path.join(WEB, "files.txt"), encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip() and not line.startswith("#")]


def actual_files():
    found = []
    for folder in ("server", "web"):
        for root, _dirs, files in os.walk(os.path.join(APP_ROOT, folder)):
            if "__pycache__" in root:
                continue
            for name in files:
                if name in EXCLUDED or name.endswith(".pyc") or name.startswith("."):
                    continue
                found.append(os.path.relpath(os.path.join(root, name), APP_ROOT).replace(os.sep, "/"))
    return sorted(found)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    listed = manifest()
    check(sorted(listed) == actual_files(), "files.txt matches the agent files on disk")
    check("server/server.py" in listed and "web/index.html" in listed, "manifest includes server and dashboard")

    ps1 = open(os.path.join(WEB, "install.ps1"), encoding="utf-8").read()
    check(ps1.count("{") == ps1.count("}"), "install.ps1 braces balance")
    check("web/files.txt" in ps1 and "VITALS_UNINSTALL" in ps1 and "winget install" in ps1, "install.ps1 uses the manifest, supports uninstall and installs Python")
    check("Read-Host" in ps1, "install.ps1 keeps errors on screen")

    if platform.system() == "Windows":
        print("SKIP: install.sh sandbox run (POSIX only)")
    else:
        sandbox = tempfile.mkdtemp(prefix="vitals-install-")
        env = dict(os.environ, HOME=sandbox, VITALS_SOURCE=APP_ROOT, VITALS_NO_AUTOSTART="1", VITALS_NO_START="1")
        try:
            result = subprocess.run(["sh", os.path.join(WEB, "install.sh")], env=env,
                                    capture_output=True, text=True, timeout=120)
            print("    " + result.stdout.strip().replace("\n", "\n    "))
            check(result.returncode == 0, "install.sh finishes successfully")
            app = os.path.join(sandbox, ".vitals", "app")
            check(all(os.path.isfile(os.path.join(app, p)) for p in listed), "every listed file is installed")
            if platform.system() == "Darwin":
                launcher = os.path.join(sandbox, "Applications", "Vitals.app", "Contents", "MacOS", "Vitals")
                check(os.access(launcher, os.X_OK), "macOS: Vitals.app launcher is executable")
                plist = open(os.path.join(sandbox, "Applications", "Vitals.app", "Contents", "Info.plist")).read()
                check("<key>CFBundleExecutable</key><string>Vitals</string>" in plist, "macOS: app bundle Info.plist is valid")
                check(not os.path.exists(os.path.join(sandbox, "Library", "LaunchAgents")), "login item skipped in test mode")
            else:
                check(os.path.isfile(os.path.join(sandbox, ".local", "share", "applications", "vitals.desktop")), "Linux: app menu entry created")

            # The installed copy really runs.
            port = free_port()
            proc = subprocess.Popen([sys.executable, os.path.join(app, "server", "server.py"), "--port", str(port),
                                     "--data", os.path.join(sandbox, "data"), "--home", sandbox],
                                    env=dict(env, VITALS_NO_MODEL="1"), stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
            healthy = False
            for _ in range(50):
                try:
                    with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=1) as response:
                        healthy = json.loads(response.read().decode()).get("app") == "vitals"
                        break
                except OSError:
                    time.sleep(0.1)
            proc.terminate()
            proc.wait(timeout=5)
            check(healthy, "installed Vitals starts and answers")

            again = subprocess.run(["sh", os.path.join(WEB, "install.sh")], env=env, capture_output=True, text=True, timeout=120)
            check(again.returncode == 0 and os.path.isfile(os.path.join(app, "server", "server.py")), "re-running updates in place")

            os.makedirs(os.path.join(sandbox, ".vitals", "vault", "keepme"))
            gone = subprocess.run(["sh", os.path.join(WEB, "install.sh"), "--uninstall"], env=env,
                                  capture_output=True, text=True, timeout=60)
            check(gone.returncode == 0 and not os.path.exists(app), "uninstall removes the app")
            check(os.path.isdir(os.path.join(sandbox, ".vitals", "vault", "keepme")), "uninstall keeps the Undo Vault and history")
        finally:
            shutil.rmtree(sandbox, ignore_errors=True)

    if FAILURES:
        print("\n%d check(s) failed" % len(FAILURES))
        sys.exit(1)
    print("\nAll installer checks passed")


if __name__ == "__main__":
    main()
