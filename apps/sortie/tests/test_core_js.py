"""tests/test_core_js.py -- runs core.test.mjs (Sortie's core.js helpers) with Node.

The monorepo test runner only executes Python files, so this wrapper finds `node` (or $NODE)
and runs the JavaScript suite; it skips cleanly when Node is not installed.
"""

import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


class SortieCoreTests(unittest.TestCase):
    def test_core_suite(self):
        node = os.environ.get("NODE") or shutil.which("node")
        if not node:
            self.skipTest("node is not installed")
        result = subprocess.run(
            [node, str(HERE / "core.test.mjs")],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=50,
        )
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        self.assertEqual(result.returncode, 0, "core.test.mjs failed")


if __name__ == "__main__":
    unittest.main(verbosity=1)
