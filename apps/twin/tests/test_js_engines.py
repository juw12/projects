#!/usr/bin/env python3
"""Run the Node unit tests for TwinAgent and Strategy Lab (deterministic, no network).

Skips (exit 0) with a clear message when Node.js is not installed, like test_pro_engine.py.
"""
import shutil
import subprocess
import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parent
SUITES = ("twinagent.test.js", "strategy_lab.test.js")


def main():
    node = shutil.which("node")
    if not node:
        print("SKIPPED: Node.js not installed; TwinAgent and Strategy Lab engine tests were not run.")
        return 0
    result = subprocess.run([node, "--test", *(str(TESTS / suite) for suite in SUITES)],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=50)
    sys.stdout.write(result.stdout[-6000:])
    sys.stderr.write(result.stderr[-3000:])
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
