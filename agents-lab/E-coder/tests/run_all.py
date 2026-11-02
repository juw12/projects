"""
E — E-coder: run every test in one command.

Discovers and runs all ``test_*.py`` files in this ``tests/`` directory using
``unittest`` discovery, prints a clear summary, and exits ``0`` if everything
passes or ``1`` otherwise. Stdlib only.

Mirrors the intent of the monorepo's ``scripts/run_all_tests.py`` (clear per-test
output + a PASSED/FAILED summary line), but runs in-process via unittest and is
scoped to E-coder's tests.

Run from anywhere:

    python agents-lab/E-coder/tests/run_all.py
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

# Make the E-coder code (llm, tools, repo, ...) AND the test modules importable
# regardless of the current working directory. The E-coder root is one directory
# up from this file; the tests live here.
ECODER_DIR = Path(__file__).resolve().parent.parent
TESTS_DIR = Path(__file__).resolve().parent
for _d in (str(ECODER_DIR), str(TESTS_DIR)):
    if _d not in sys.path:
        sys.path.insert(0, _d)


def main() -> None:
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(TESTS_DIR), pattern="test_*.py")
    total = suite.countTestCases()

    if total == 0:
        print(f"ERROR: no tests discovered under {TESTS_DIR}")
        sys.exit(1)

    print(f"E-coder test suite — {total} tests\n")
    sys.stdout.flush()
    result = unittest.TextTestRunner(verbosity=2).run(suite)

    print("\n" + "=" * 60)
    skipped = len(result.skipped)
    tail = f", {skipped} skipped" if skipped else ""
    print(
        f"Ran {result.testsRun} tests: "
        f"{len(result.failures)} failed, {len(result.errors)} errors{tail}"
    )
    if result.wasSuccessful():
        print("PASSED")
        sys.exit(0)
    print("FAILED")
    sys.exit(1)


if __name__ == "__main__":
    main()
