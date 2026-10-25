#!/usr/bin/env python3
"""Run the Node unit tests for web/pro.js (orders, brackets, replay, analytics).

Skips (exit 0) with a clear message when Node.js is not installed.
"""
import shutil
import subprocess
import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parent


def main():
    node = shutil.which("node")
    if not node:
        print("SKIPPED: Node.js not installed; pro engine tests were not run.")
        return 0
    result = subprocess.run([node, str(TESTS / "pro_engine.test.js")], capture_output=True, text=True, timeout=50)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
