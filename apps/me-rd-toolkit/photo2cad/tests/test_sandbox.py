#!/usr/bin/env python3
"""Unit test for the photo2cad sandbox + validator (no server, no network).

IMPORTANT: run with a Python that has cadquery installed:
    & "%USERPROFILE%\\Documents\\Default Project\\.venv3d\\Scripts\\python.exe" tests/test_sandbox.py

Exits 0 on success, 1 on failure.
"""
import pathlib
import sys
import tempfile

APP = pathlib.Path(__file__).resolve().parents[1]

try:
    import cadquery  # noqa: F401
except Exception:  # noqa: BLE001 - optional dependency
    print("SKIP test_sandbox (cadquery not installed; run with the .venv3d python)")
    sys.exit(0)

sys.path.insert(0, str(APP / "server"))

import sandbox  # noqa: E402
import validate  # noqa: E402

GOOD_PROGRAM = '''import cadquery as cq
L, W, H = 40.0, 30.0, 20.0
SHAPE = cq.Workplane("XY").box(L, W, H).edges("|Z").fillet(3.0)
'''

DANGEROUS_PROGRAMS = [
    "import os\nos.system('echo hi')\n",
    "import subprocess\nsubprocess.run(['ls'])\n",
    "open('/etc/passwd').read()\n",
    "__import__('os').system('id')\n",
    "import socket\n",
]


def main():
    ok, why = sandbox.guard(GOOD_PROGRAM)
    assert ok, "guard rejected a valid program: %s" % why

    for bad in DANGEROUS_PROGRAMS:
        allowed, _ = sandbox.guard(bad)
        assert not allowed, "guard ALLOWED dangerous program: %r" % bad

    with tempfile.TemporaryDirectory() as workdir:
        result = sandbox.run_program(GOOD_PROGRAM, workdir)
        assert result.get("ok"), "run_program failed: %s" % result
        report = validate.validate_step(result["step_path"])
        assert report["valid"] and report["solids"] == 1, "validate failed: %s" % report

    print("PASS test_sandbox")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - test harness
        print("FAIL test_sandbox:", exc)
        sys.exit(1)
