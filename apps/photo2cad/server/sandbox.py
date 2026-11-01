"""AST guard + subprocess sandbox for CadQuery program execution.

Two responsibilities (stdlib only at module level; ``cadquery`` is imported
inside the child-process harness, never at import time):

1. :func:`guard` — parse the user program with :mod:`ast` and reject
   disallowed imports, denied built-in calls, and any dunder attribute
   access. Anything else is the responsibility of the child subprocess
   timeout.

2. :func:`run_program` — write the user program to ``outdir/program.py``,
   drop a small harness next to it, and run the harness with
   ``sys.executable`` (so the harness inherits the active interpreter).
   The harness imports ``cadquery``, execs the program source, exports
   ``SHAPE`` as STEP and STL, and prints ``OK``.

The harness script is shipped as a string constant — no extra files in
``server/`` — so the only thing on disk in the workdir is the harness
itself plus ``program.py`` and the two output files.
"""
from __future__ import annotations

import ast
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable


# ---------------------------------------------------------------------------
# Guard policy
# ---------------------------------------------------------------------------

#: Modules the program is allowed to import.
_ALLOWED_IMPORT_MODULES: frozenset[str] = frozenset({"cadquery", "math"})
#: ``(module, alias)`` pairs the program is allowed to rename to.
_ALLOWED_IMPORT_ALIASES: frozenset[tuple[str, str]] = frozenset({("cadquery", "cq")})
#: Built-in callables whose bare invocation is rejected.
_DENIED_CALL_NAMES: frozenset[str] = frozenset({
    "open", "eval", "exec", "compile", "__import__",
    "input", "globals", "locals", "exit", "quit", "breakpoint",
})


def _walk_callables(tree: ast.AST) -> Iterable[ast.Call]:
    """Yield every :class:`ast.Call` node in ``tree`` (including nested)."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            yield node


def guard(source: str) -> tuple[bool, str]:
    """Allow / deny ``source`` against the CADGEN sandbox policy.

    Returns ``(True, "")`` when the program is acceptable, otherwise
    ``(False, reason)`` with a human-readable explanation suitable for the
    ``stage: "exec"`` error in the API response.
    """
    if not isinstance(source, str):
        return False, "program source is not a string"
    if not source.strip():
        return False, "program source is empty"

    try:
        tree = ast.parse(source, filename="<program>")
    except SyntaxError as exc:
        return False, "syntax error: %s (line %s)" % (exc.msg, exc.lineno)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                mod = alias.name
                if mod not in _ALLOWED_IMPORT_MODULES:
                    return False, "import %r is not allowed (allowed: cadquery, math)" % mod
                if alias.asname:
                    pair = (mod, alias.asname)
                    if pair not in _ALLOWED_IMPORT_ALIASES:
                        return False, (
                            "import %r as %r is not allowed (allowed alias for cadquery: 'cq')"
                            % (mod, alias.asname)
                        )
        elif isinstance(node, ast.ImportFrom):
            return False, "'from ... import ...' is not allowed (%s)" % (node.module or "?")
        elif isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in _DENIED_CALL_NAMES:
                return False, "call to %r() is not allowed" % func.id
            # Catch attribute-based calls to denied names too:
            # e.g. ``os.system('x')`` — the call itself is fine, but the
            # ``os`` module import was already rejected above. Block direct
            # attribute access of denied names to be extra safe.
            if isinstance(func, ast.Attribute) and func.attr in _DENIED_CALL_NAMES:
                return False, "call to %r() via attribute is not allowed" % func.attr
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                return False, "dunder attribute access %r is not allowed" % node.attr

    return True, ""


# ---------------------------------------------------------------------------
# Harness (runs in the child process — uses cadquery there)
# ---------------------------------------------------------------------------

_HARNESS_SOURCE = '''\
"""photo2cad sandbox harness.

Written to ``<workdir>/_harness.py`` by :func:`run_program` and launched
with ``sys.executable``. Imports ``cadquery``, executes the user-supplied
program in an isolated module dict, exports ``SHAPE`` to ``model.stp`` and
``model.stl``, then exits.

Exit codes:
    0  success (both files written)
    2  cannot read program.py
    3  user program raised during exec
    4  user program did not assign SHAPE
    5  cadquery export failed
"""
import os
import sys
import traceback

import cadquery as cq

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
PROG = os.path.join(OUT_DIR, "program.py")


def _die(code, msg):
    sys.stderr.write(msg + "\\n")
    sys.stderr.flush()
    sys.exit(code)


def main():
    try:
        with open(PROG, "r", encoding="utf-8") as fh:
            source = fh.read()
    except OSError as exc:
        _die(2, "ERROR reading program.py: %s" % exc)

    g = {"__name__": "__photo2cad_sandbox__", "__file__": PROG}
    try:
        exec(compile(source, PROG, "exec"), g)
    except BaseException:
        traceback.print_exc()
        sys.exit(3)

    if "SHAPE" not in g:
        _die(4, "ERROR: program did not assign a module-level 'SHAPE'")

    shape = g["SHAPE"]
    step_path = os.path.join(OUT_DIR, "model.stp")
    stl_path = os.path.join(OUT_DIR, "model.stl")
    try:
        cq.exporters.export(shape, step_path, exportType="STEP")
        cq.exporters.export(shape, stl_path, exportType="STL")
    except Exception:
        traceback.print_exc()
        sys.exit(5)

    print("OK")


if __name__ == "__main__":
    main()
'''


# ---------------------------------------------------------------------------
# Output truncation helpers
# ---------------------------------------------------------------------------

_LOG_TAIL_BYTES = 8000


def _tail(text: str | bytes | None) -> str:
    """Coerce subprocess output to ``str`` and keep only the tail."""
    if text is None:
        return ""
    if isinstance(text, bytes):
        try:
            text = text.decode("utf-8")
        except UnicodeDecodeError:
            text = text.decode("utf-8", errors="replace")
    if len(text) > _LOG_TAIL_BYTES:
        text = "...[truncated]..." + text[-_LOG_TAIL_BYTES:]
    return text


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_program(source: str, outdir: str | os.PathLike, timeout: int = 120) -> dict:
    """Run ``source`` in a sandboxed child process; produce STEP + STL.

    Returns a dict with keys: ``ok``, ``step_path``, ``stl_path``, ``stdout``,
    ``stderr``, ``error``, ``seconds``. ``ok`` is True only when the child
    exited 0 AND both files were written.
    """
    work = Path(outdir).resolve()
    work.mkdir(parents=True, exist_ok=True)

    program_path = work / "program.py"
    harness_path = work / "_harness.py"
    program_path.write_text(source, encoding="utf-8")
    harness_path.write_text(_HARNESS_SOURCE, encoding="utf-8")

    step_path = work / "model.stp"
    stl_path = work / "model.stl"

    started = time.time()
    try:
        # Runs the LLM-generated program in a separate process. The argv is fixed
        # (sys.executable + an internal, non-user-controlled harness path); there is
        # no shell and no user-controlled command, so this is not injection-prone.
        completed = subprocess.run(  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            [sys.executable, str(harness_path)],
            cwd=str(work),
            capture_output=True,
            text=True,
            timeout=max(1, int(timeout)),
            check=False,
        )
        seconds = time.time() - started
        stdout = _tail(completed.stdout)
        stderr = _tail(completed.stderr)
        return {
            "ok": completed.returncode == 0 and step_path.is_file() and stl_path.is_file(),
            "step_path": str(step_path),
            "stl_path": str(stl_path),
            "stdout": stdout,
            "stderr": stderr,
            "error": ""
                if completed.returncode == 0
                else "child exited %s" % completed.returncode,
            "seconds": round(seconds, 3),
        }
    except subprocess.TimeoutExpired as exc:
        seconds = time.time() - started
        return {
            "ok": False,
            "step_path": str(step_path),
            "stl_path": str(stl_path),
            "stdout": _tail(getattr(exc, "stdout", "")),
            "stderr": _tail(getattr(exc, "stderr", "")),
            "error": "sandbox timeout after %ss" % timeout,
            "seconds": round(seconds, 3),
        }


__all__ = ["guard", "run_program"]
