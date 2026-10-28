#!/usr/bin/env python3
"""Run the brain.js unit tests (tests/brain_test.html) in headless Chrome/Chromium.

Skips cleanly (exit 0) when no Chrome is installed, so CI without a browser
still passes the Python suite. Standard library only.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "brain_test.html")
CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def find_chrome():
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    for path in CANDIDATES:
        if os.path.exists(path):
            return path
    return None


def main():
    chrome = find_chrome()
    if not chrome:
        print("SKIP: no Chrome/Chromium found for brain.js tests")
        return 0
    profile = tempfile.mkdtemp(prefix="vitals-chrome-")
    try:
        out = subprocess.run(
            [chrome, "--headless=new", "--disable-gpu", "--no-sandbox", "--allow-file-access-from-files",
             "--user-data-dir=" + profile, "--virtual-time-budget=3000", "--dump-dom",
             "file://" + PAGE.replace(os.sep, "/")],
            capture_output=True, text=True, timeout=60)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    match = re.search(r'<pre id="out">(.*?)</pre>', out.stdout, re.S)
    if not match:
        print("FAIL: could not read test output")
        print(out.stderr[-2000:])
        return 1
    text = match.group(1).replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&").replace("&#39;", "'")
    print(text)
    return 0 if "RESULT PASSED" in text else 1


if __name__ == "__main__":
    sys.exit(main())
