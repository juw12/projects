#!/usr/bin/env python3
r"""Open the built ME R&D Toolkit desktop app twice and check it works and keeps your data.

    python apps/me-rd-toolkit/desktop/smoke_test.py --built              the app in dist/ (after build.py)
    python apps/me-rd-toolkit/desktop/smoke_test.py PATH/TO/ME-RD-Toolkit.exe   an installed copy
    python apps/me-rd-toolkit/desktop/smoke_test.py --source             merd_app.py from this checkout

The test makes a throwaway data folder with a file vault (a shared folder with a hidden "Personal" folder,
like tests/test_me_rd_toolkit.py) and runs the app with MERD_WINDOW_TEST: it writes a report once the page
has loaded and closes itself.

Run 1  the toolkit boots in its window with the vault on; a change to the tracked projects reaches storage.json;
       a data pack imported the way Data & Backup does it (IndexedDB) is saved to private\pack.json; the in-app
       vault searches, hides the excluded folder and opens a shared file; data-pack paths get an Open button that
       opens the file, while programs and missing paths are refused. Teammates' access is checked from here:
       the shared vault answers on its LAN port only with the password.
Run 2  a fresh window profile (as after clearing data or reinstalling) sharing only the data folder: the
       tracked-project change and the data pack must be back.
"""

import argparse
import base64
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

DESKTOP = os.path.dirname(os.path.abspath(__file__))
PACK_NAME = "Desktop check pack"
PASSWORD = "desktop-check-password"


def built_app():
    if sys.platform == "win32":
        return os.path.join(DESKTOP, "dist", "ME-RD-Toolkit", "ME-RD-Toolkit.exe")
    return os.path.join(DESKTOP, "dist", "ME-RD-Toolkit.app", "Contents", "MacOS", "ME-RD-Toolkit")


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def make_home():
    """A data folder with a vault config over a small shared folder, plus a local file a data pack points at."""
    base = tempfile.mkdtemp(prefix="merd-smoke-")
    share = os.path.join(base, "share")
    os.makedirs(os.path.join(share, "Guides", "Plastics"))
    os.makedirs(os.path.join(share, "Personal"))
    with open(os.path.join(share, "Guides", "Plastics", "rib design.txt"), "w", encoding="utf-8") as handle:
        handle.write("Rib root 50-70 % of nominal wall")
    with open(os.path.join(share, "Personal", "secret.txt"), "w", encoding="utf-8") as handle:
        handle.write("not for the team")
    spec = os.path.join(base, "Spec sheet.pdf")
    with open(spec, "wb") as handle:
        handle.write(b"%PDF-1.4\n% desktop check\n")
    program = os.path.join(base, "tool.exe")
    with open(program, "wb") as handle:
        handle.write(b"MZ")
    home = os.path.join(base, "home")
    os.makedirs(os.path.join(home, "private"))
    port = free_port()
    config = {
        "title": "Desktop check vault", "host": "127.0.0.1", "port": port, "user": "team", "password": PASSWORD,
        "strict": True, "roots": [{"id": "share", "name": "Docs", "path": share}],
        "exclude": ["share:Personal"], "excludeNames": [],
        "categories": [{"name": "Guides", "icon": "book", "desc": "Design guides", "match": ["share:Guides"]}],
    }
    with open(os.path.join(home, "private", "vault_config.json"), "w", encoding="utf-8") as handle:
        json.dump(config, handle, indent=1)
    return home, port, spec, program


def lan_status(port, password=None):
    request = urllib.request.Request("http://127.0.0.1:%d/api/status" % port)
    if password:
        request.add_header("Authorization", "Basic " + base64.b64encode(("team:" + password).encode()).decode())
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def run(command, home, extra, keep_open_check=None):
    folder = tempfile.mkdtemp(prefix="merd-run-")
    report = os.path.join(folder, "report.json")
    env = dict(os.environ, MERD_WINDOW_TEST=report, MERD_DESKTOP_HOME=home, MERD_TEST_PACK=PACK_NAME, **extra)
    process = subprocess.Popen(command, env=env)
    lan = None
    if keep_open_check:
        lan = keep_open_check(process)
    try:
        process.wait(timeout=180)
    except subprocess.TimeoutExpired:
        process.kill()
        raise SystemExit("The app did not close itself within 180 s")
    if not os.path.isfile(report):
        raise SystemExit("The app exited (code %s) without a report" % process.returncode)
    with open(report, encoding="utf-8") as handle:
        result = json.load(handle)
    print(json.dumps(result, indent=2))
    return result, lan


def problems_in(result):
    page = result.get("page") or {}
    problems = []
    if result.get("method") != "window":
        problems.append("no native window (%s)" % (result.get("error") or result.get("method")))
    if "R&D Toolkit" not in str(page.get("title") or ""):
        problems.append("page title is %r" % page.get("title"))
    if not page.get("shim"):
        problems.append("the desktop shim did not load")
    if not page.get("booted"):
        problems.append("the toolkit did not start")
    if not result.get("vault") or not page.get("serverMode"):
        problems.append("the file vault is not on in the window (%s)" % result.get("vault_error"))
    if (result.get("checks") or {}).get("error"):
        problems.append(result["checks"]["error"])
    return problems


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("app", nargs="?", help="the program to open")
    parser.add_argument("--built", action="store_true", help="open the app in dist/")
    parser.add_argument("--source", action="store_true", help="run merd_app.py from this checkout")
    args = parser.parse_args()
    if args.source:
        command = [sys.executable, os.path.join(DESKTOP, "merd_app.py")]
    else:
        app = built_app() if args.built or not args.app else args.app
        if not os.path.isfile(app):
            raise SystemExit("Not found: %s" % app)
        command = [app]
    home, vault_port, spec, program = make_home()
    started = time.time()

    def teammate_access(process):
        """While run 1 is open, reach the shared vault the way a teammate's browser does."""
        deadline = time.time() + 30
        while time.time() < deadline and process.poll() is None:
            if lan_status(vault_port, PASSWORD) == 200:
                return {"without_password": lan_status(vault_port), "with_password": 200}
            time.sleep(0.3)
        return {"without_password": None, "with_password": None}

    print("Run 1: open %s with a file vault" % command[-1], flush=True)
    first, lan = run(command, home, {"MERD_TEST_FILE": spec, "MERD_TEST_PROGRAM": program}, teammate_access)
    problems = problems_in(first)
    checks = first.get("checks") or {}
    if not checks.get("state_saved"):
        problems.append("a change to the tracked projects did not reach storage.json")
    if not (checks.get("pack_import") or {}).get("saved") or not checks.get("pack_saved"):
        problems.append("the imported data pack was not saved to private\\pack.json")
    if checks.get("vault_search") != ["rib design.txt"]:
        problems.append("vault search returned %r" % checks.get("vault_search"))
    if checks.get("vault_hidden") != 0 or checks.get("vault_blocked_file") != 404:
        problems.append("the excluded vault folder is visible")
    if not (checks.get("vault_open") or {}).get("ok"):
        problems.append("a shared vault file did not open: %r" % checks.get("vault_open"))
    if not (checks.get("open_button") or {}).get("button"):
        problems.append("data-pack paths got no Open button")
    opened = [os.path.normcase(path) for path in checks.get("opened") or []]
    if os.path.normcase(os.path.normpath(spec)) not in opened:
        problems.append("the Open button did not open the file (%r)" % opened)
    if not any(path.endswith(os.path.normcase(os.path.join("plastics", "rib design.txt"))) for path in opened):
        problems.append("the vault file was not opened from disk")
    if (checks.get("refused_program") or {}).get("ok") is not False:
        problems.append("a program path was not refused")
    if (checks.get("missing_path") or {}).get("ok") is not False:
        problems.append("a missing path was not reported")
    if (lan or {}).get("with_password") != 200 or (lan or {}).get("without_password") != 401:
        problems.append("teammates' vault access is wrong: %r" % lan)
    if problems:
        raise SystemExit("FAILED (run 1): " + "; ".join(problems))

    print("Run 2: reopen with a fresh window profile", flush=True)
    second, _ = run(command, home, {"MERD_EXPECT_MARK": checks["mark"]})
    problems = problems_in(second)
    page = second.get("page") or {}
    if not (second.get("checks") or {}).get("mark_restored"):
        problems.append("the tracked-project change was not there after reopening")
    if page.get("packName") != PACK_NAME:
        problems.append("the data pack did not come back (%r, %r)" % (page.get("packSource"), page.get("packName")))
    if problems:
        raise SystemExit("FAILED (run 2): " + "; ".join(problems))
    print("OK: the toolkit ran in its own window (%s) with its file vault, kept projects and the data pack across a "
          "restart with a fresh profile, and opened files in their programs (%.0f s)" % (first.get("toolkit"), time.time() - started))


if __name__ == "__main__":
    main()
