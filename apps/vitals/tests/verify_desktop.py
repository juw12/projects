#!/usr/bin/env python3
"""Desktop app checks (stdlib only, exits 0/1).

1. The launcher from this checkout (desktop/vitals_app.py) starts the background agent, serves the
   dashboard, reuses a running agent and stops on --stop (the same checks CI runs on every build).
2. The sign-in items it writes (macOS LaunchAgent, Linux autostart entry) are well formed.
3. Every download link in app.js, README.md and scripts/apps.json names a file that the release
   workflow (.github/workflows/vitals-apps.yml) publishes.
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP_ROOT = os.path.normpath(os.path.join(HERE, ".."))
DESKTOP = os.path.join(APP_ROOT, "desktop")
REPO = os.path.normpath(os.path.join(APP_ROOT, "..", ".."))
sys.path.insert(0, DESKTOP)

import smoke_test  # noqa: E402
import vitals_app  # noqa: E402

FAILURES = []
ASSET = re.compile(r"Vitals-[A-Za-z0-9-]+\.(?:exe|zip|dmg|deb|tar\.gz|apk|ipa)")


def check(condition, label):
    print(("  ok   " if condition else "  FAIL ") + label)
    if not condition:
        FAILURES.append(label)


def read(*parts):
    with open(os.path.join(*parts), encoding="utf-8") as handle:
        return handle.read()


def main():
    FAILURES.extend(smoke_test.run_smoke([sys.executable, os.path.join(DESKTOP, "vitals_app.py")],
                                         "launcher from this checkout"))

    print("Sign-in items")
    plist = vitals_app.launch_agent_plist("/Applications/Vitals & Co.app/Contents/MacOS/Vitals")
    check("<string>/Applications/Vitals &amp; Co.app/Contents/MacOS/Vitals</string><string>--background</string>" in plist,
          "macOS LaunchAgent starts the app with --background (path XML-escaped)")
    check("<key>Label</key><string>io.github.juw12.vitals</string>" in plist and "<key>RunAtLoad</key><true/>" in plist
          and "KeepAlive" not in plist,
          "macOS LaunchAgent: same label as the script installer, runs at login, no restart loop if the app is deleted")
    entry = vitals_app.desktop_entry("/home/me/My Apps/Vitals/vitals", background=True)
    check('Exec="/home/me/My Apps/Vitals/vitals" --background' in entry and "TryExec=/home/me/My Apps/Vitals/vitals" in entry,
          "Linux autostart entry quotes the path and is skipped once the app is gone")
    mode, rest = vitals_app.split_args(["--background", "--port", "9", "-psn_0_123"])
    check(mode == "background" and rest == ["--port", "9"], "launcher switches are kept apart from agent options")

    print("Download links")
    workflow_path = os.path.join(REPO, ".github", "workflows", "vitals-apps.yml")
    published = set(ASSET.findall(read(workflow_path))) if os.path.exists(workflow_path) else set()
    check(len(published) >= 8, "the release workflow publishes the desktop and phone downloads (%d files)" % len(published))
    sources = [("web/app.js", os.path.join(APP_ROOT, "web", "app.js")),
               ("README.md", os.path.join(APP_ROOT, "README.md")),
               ("scripts/apps.json", os.path.join(REPO, "scripts", "apps.json"))]
    for label, path in sources:
        if not os.path.exists(path):
            print("SKIP: %s (not in this checkout)" % label)
            continue
        named = set(ASSET.findall(read(path)))
        missing = sorted(named - published)
        check(bool(named) and not missing,
              "%s links only to published downloads%s" % (label, (" - unknown: " + ", ".join(missing)) if missing else ""))

    if FAILURES:
        print("\n%d check(s) failed" % len(FAILURES))
        sys.exit(1)
    print("\nAll desktop checks passed")


if __name__ == "__main__":
    main()
