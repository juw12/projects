#!/usr/bin/env python3
"""Hermetic test for the pipeline self-repair loop (no network, no LLM).

The first LLM attempt returns a program that fails to execute; the repair
attempt returns a valid one. Asserts the pipeline recovers on attempt 2.

Run with the cadquery venv:
    & "..\\..\\.venv3d\\Scripts\\python.exe" tests/test_repair.py
"""
import pathlib
import sys
import tempfile

APP = pathlib.Path(__file__).resolve().parents[1]

try:
    import cadquery  # noqa: F401
except Exception:  # noqa: BLE001 - optional dependency
    print("SKIP test_repair (cadquery not installed; run with the .venv3d python)")
    sys.exit(0)

sys.path.insert(0, str(APP / "server"))

import cadgen  # noqa: E402
import config  # noqa: E402
import pipeline  # noqa: E402

BAD = "import cadquery as cq\nSHAPE = cq.Workplane('XY').rect(40, 30).vertices().fillet(3)\n"
GOOD = "import cadquery as cq\nSHAPE = cq.Workplane('XY').box(40, 30, 20).edges('|Z').fillet(3)\n"


def main():
    cfg = config.load_config()
    calls = {"n": 0}

    def fake_build(*_a, **_k):
        calls["n"] += 1
        return BAD

    def fake_repair(*_a, **_k):
        calls["n"] += 1
        return GOOD

    cadgen.build_program = fake_build
    cadgen.repair_program = fake_repair

    with tempfile.TemporaryDirectory() as workdir:
        result = pipeline.generate(cfg, "a test bracket", {}, workdir, use_vision=False)

    assert result.get("ok") is True, "pipeline did not recover: %s" % result
    assert result.get("attempts") == 2, "expected 2 attempts, got %s" % result.get("attempts")
    assert result["report"]["valid"] and result["report"]["solids"] == 1, result["report"]
    assert calls["n"] == 2, "expected 2 LLM calls, got %s" % calls["n"]
    print("PASS test_repair (recovered on attempt 2)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - test harness
        print("FAIL test_repair:", exc)
        sys.exit(1)
