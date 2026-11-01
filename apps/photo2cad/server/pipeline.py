"""End-to-end pipeline: ``maas`` (LLM) -> ``cadgen`` (program) -> ``sandbox``
(subprocess) -> ``validate`` (re-import).

Stdlib only at module level. ``cadquery`` is touched only inside the
subprocess spawned by :mod:`sandbox`, so this module is importable on a
plain Python 3.13 even without ``cadquery`` installed.
"""
from __future__ import annotations

import json
import os
import secrets
import time
from pathlib import Path
from typing import Any

import cadgen
import sandbox
import validate
from config import Config

#: Total LLM attempts: 1 initial build + (MAX_ATTEMPTS - 1) self-repair retries.
MAX_ATTEMPTS = 3


# ---------------------------------------------------------------------------
# Job helpers
# ---------------------------------------------------------------------------


def new_job_id() -> str:
    """Return a fresh 8-character hex job id."""
    return secrets.token_hex(4)


def _job_dir(workdir_root: str | os.PathLike, job_id: str) -> Path:
    work = Path(workdir_root).resolve()
    work.mkdir(parents=True, exist_ok=True)
    target = work / job_id
    target.mkdir(parents=True, exist_ok=True)
    return target


def _write_report(job_dir: Path, report: dict) -> str:
    path = job_dir / "report.json"
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return str(path)


def _logs(run_result: dict) -> str:
    """Combine child stdout/stderr into one tail string for the API."""
    parts: list[str] = []
    if run_result.get("stdout"):
        parts.append("[stdout]\n" + str(run_result["stdout"]))
    if run_result.get("stderr"):
        parts.append("[stderr]\n" + str(run_result["stderr"]))
    if run_result.get("error"):
        parts.append("[error]\n" + str(run_result["error"]))
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def generate(
    cfg: Config,
    prd: str,
    images: dict | None,
    workdir_root: str | os.PathLike,
    use_vision: bool = True,
    model: str | None = None,
) -> dict:
    """Run the full pipeline; return the API-contract response dict.

    The dict is always shaped like either the success or the failure example
    in ``docs/photo2cad-spec.md``. The HTTP layer only needs to translate
    ``ok=False`` into a 4xx/5xx when the failure is a bad request (empty
    PRD); everything else goes out as 200 with ``ok=False`` so the browser
    can render the message.
    """
    job_id = new_job_id()
    job_dir = _job_dir(workdir_root, job_id)
    started = time.time()

    program: str | None = None
    run_result: dict | None = None
    last_error = ""
    last_stage = "llm"
    last_logs = ""

    # ---- Input validation --------------------------------------------------
    if not isinstance(prd, str) or not prd.strip():
        return {
            "ok": False,
            "stage": "cadgen",
            "error": "PRD is required (non-empty string).",
            "program": None,
            "logs": "",
        }

    for attempt in range(MAX_ATTEMPTS):
        # ---- LLM: build the program (attempt 0) or repair it (retries) -----
        try:
            if attempt == 0:
                program = cadgen.build_program(
                    cfg,
                    prd=prd,
                    images=images or {},
                    use_vision=bool(use_vision),
                    model=model,
                )
            else:
                program = cadgen.repair_program(
                    cfg, prd=prd, program=program, error=last_error, model=model,
                )
        except Exception as exc:  # maas + cadgen errors both surface here
            return {
                "ok": False,
                "stage": "llm",
                "error": "LLM call failed: %s" % exc,
                "program": program,
                "logs": last_logs,
                "attempts": attempt + 1,
            }

        # Save the latest source for debugging / download.
        (job_dir / "program.py").write_text(program, encoding="utf-8")

        # ---- AST guard -----------------------------------------------------
        allowed, reason = sandbox.guard(program)
        if not allowed:
            last_stage = "exec"
            last_error = "sandbox rejected program: %s" % reason
            last_logs = ""
            continue

        # ---- Subprocess execution -----------------------------------------
        run_result = sandbox.run_program(
            source=program,
            outdir=job_dir,
            timeout=cfg.sandbox_timeout,
        )
        if not run_result.get("ok"):
            last_stage = "exec"
            last_error = run_result.get("error") or "sandbox did not produce STEP+STL"
            last_logs = _logs(run_result)
            continue

        # ---- Validation ---------------------------------------------------
        try:
            report = validate.validate_step(run_result["step_path"])
        except Exception as exc:
            last_stage = "validate"
            last_error = "validate_step raised: %s" % exc
            last_logs = _logs(run_result)
            continue

        if not report.get("valid"):
            last_stage = "validate"
            last_error = (
                "validator rejected model: solids=%s, bbox_mm=%s, warnings=%s"
                % (report.get("solids"), report.get("bbox_mm"), report.get("warnings"))
            )
            last_logs = _logs(run_result)
            continue

        # ---- Success ------------------------------------------------------
        _write_report(job_dir, report)
        return {
            "ok": True,
            "job_id": job_id,
            "step_url": "/api/artifacts/%s/model.stp" % job_id,
            "stl_url": "/api/artifacts/%s/model.stl" % job_id,
            "report": report,
            "program": program,
            "logs": _logs(run_result),
            "seconds": round(time.time() - started, 3),
            "attempts": attempt + 1,
        }

    # ---- All attempts exhausted -------------------------------------------
    return {
        "ok": False,
        "stage": last_stage,
        "error": "failed after %d attempt(s): %s" % (MAX_ATTEMPTS, last_error),
        "program": program,
        "logs": last_logs,
        "attempts": MAX_ATTEMPTS,
    }


__all__ = ["generate", "new_job_id"]
