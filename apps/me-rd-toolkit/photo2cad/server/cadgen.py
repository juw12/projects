"""PRD + reference photos -> CadQuery program (LLM synthesis + extraction).

Stdlib-only. Two responsibilities:

1. Build the OpenAI-compatible chat messages (system prompt + user prompt +
   optional vision content) given a PRD and an ``images`` dict.
2. Call :func:`llm.chat`, then extract the **first** fenced ``python`` code
   block from the model output (falling back to the raw text if none is
   found). The extracted string is the CadQuery program executed downstream.

The system prompt enforces the ``CADGEN_CONTRACT`` from
``docs/photo2cad-spec.md``: only ``import cadquery as cq`` + ``import math``
are allowed, the result must be assigned to ``SHAPE``, and no I/O of any kind.
"""
from __future__ import annotations

import re
from typing import Any

import llm
from config import Config


# ---------------------------------------------------------------------------
# CADGEN_CONTRACT — enforced by the system prompt and re-checked by the sandbox
# ---------------------------------------------------------------------------

CADGEN_CONTRACT = """\
You generate ONLY a single Python program that uses the CadQuery library to \
build a solid CAD model from the user's product requirements (PRD) and (when \
provided) reference photographs of the existing part.

Hard rules (any violation makes the program invalid):

1. Imports: only `import cadquery as cq` and `import math` are permitted. \
Do not import anything else (no `os`, no `cadquery as anything_else`, etc.).
2. The final solid must be assigned to a module-level variable named \
exactly `SHAPE` (a `cq.Workplane` object). Do not name it `result`, \
`final`, `part`, etc.
3. Units: all numeric dimensions are millimetres (mm).
4. No I/O: no `open()`, no `print()`, no network calls, no filesystem \
access, no subprocess. The program is executed in a locked-down child \
process; any I/O will raise immediately.
5. Be parametric: declare named numeric constants (e.g. `L = 40.0`) at the \
top of the file, then build the geometry from those constants. Do not embed \
magic numbers inside chained method calls.
6. Output only the program. Do not write prose around it. Do not include \
Markdown headings or commentary outside a single fenced Python block.
7. Common CadQuery pitfalls — avoid these:
   - `.fillet()` / `.chamfer()` act on the EDGES of a 3D solid. You CANNOT \
fillet a 2D sketch/wire. Build the solid first (e.g. extrude), then fillet its \
edges, e.g. `.rect(L,W).extrude(T).edges("|Z").fillet(3)`.
   - `.hole()` / `.cboreHole()` must run on a workplane located on a face, \
e.g. `.faces(">Z").workplane().hole(6)`.
   - Do not call edge/face selectors before a solid exists.
   - Prefer primitives (`box`, `cylinder`) or a 2D sketch + `.extrude()`; keep \
the result a single connected solid.

When reference photographs are supplied (`use_vision` true) treat them as \
visual reference only — the PRD drives the exact parametric dimensions. \
Never claim to extract precise geometry from the images.
"""


# ---------------------------------------------------------------------------
# Message construction
# ---------------------------------------------------------------------------

USER_TEXT_TEMPLATE = """\
Build the CadQuery program for this PRD:

---PRD START---
{prd}
---PRD END---

Units: {units}.
Vision enabled: {vision}.
Reference images provided: {image_summary}.

Return exactly ONE fenced ```python block containing the program. The fenced \
block must be the only thing in your reply.
"""


def _summarise_images(images: dict[str, str]) -> str:
    if not images:
        return "none"
    views = sorted(k for k, v in images.items() if isinstance(v, str) and v.strip())
    if not views:
        return "none"
    return ", ".join(views) if views else "none"


def build_messages(
    cfg: Config,
    prd: str,
    images: dict[str, str] | None,
    use_vision: bool,
) -> list[dict]:
    """Construct the OpenAI-compatible messages list for the chat call."""
    image_dict = images or {}
    image_summary = _summarise_images(image_dict)
    user_text = USER_TEXT_TEMPLATE.format(
        prd=(prd or "").strip(),
        units="mm",
        vision=bool(use_vision),
        image_summary=image_summary,
    )

    content: list[dict[str, Any]] = [{"type": "text", "text": user_text}]
    if use_vision:
        for view, data_url in image_dict.items():
            if not isinstance(data_url, str) or not data_url.strip():
                continue
            content.append({
                "type": "image_url",
                "image_url": {"url": data_url},
            })
            # Remind the model which view it is (cheaper than labelling each image).
            content.append({"type": "text", "text": "(%s view)" % view})

    return [
        {"role": "system", "content": CADGEN_CONTRACT},
        {"role": "user", "content": content if len(content) > 1 else user_text},
    ]


# ---------------------------------------------------------------------------
# Code extraction
# ---------------------------------------------------------------------------

# Matches the FIRST fenced ```python ... ``` block (greedy across lines).
_FENCED_RE = re.compile(
    r"```(?:python|py)?\s*\n(?P<code>.*?)(?:\n)?```",
    re.DOTALL | re.IGNORECASE,
)


def _extract_code(text: str) -> str:
    """Pull the first fenced Python block from ``text``.

    Falls back to the raw text (stripped) if no fence is present. Lines that
    are obviously not Python (Markdown headings, ``# Title`` style) are still
    passed through — the AST guard in :mod:`sandbox` will reject anything
    that imports something disallowed.
    """
    if not isinstance(text, str):
        return ""
    match = _FENCED_RE.search(text)
    if match:
        return match.group("code").strip("\n")
    stripped = text.strip()
    if "```" in stripped:
        # There was a fence but it wasn't tagged `python`. Strip every fence
        # marker and return what is between them.
        lines = [ln for ln in stripped.splitlines() if not ln.strip().startswith("```")]
        return "\n".join(lines).strip()
    return stripped


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_program(
    cfg: Config,
    prd: str,
    images: dict[str, str] | None,
    use_vision: bool = True,
    model: str | None = None,
) -> str:
    """Synthesize a CadQuery program from a PRD (+ optional images).

    Returns the program source string. Raises whatever :func:`llm.chat`
    raises when the upstream call fails.
    """
    messages = build_messages(cfg, prd, images, use_vision)
    raw = llm.chat(
        cfg,
        messages,
        model=model,
        temperature=0,
        timeout=max(300, cfg.sandbox_timeout),
    )
    code = _extract_code(raw)
    if not code:
        raise RuntimeError("LLM returned an empty program (no fenced code block).")
    return code


REPAIR_TEMPLATE = """\
The CadQuery program below FAILED when it was executed. Fix it and return a
corrected program that builds the same part, following the same rules.

---FAILED PROGRAM---
{program}
---END PROGRAM---

---ERROR---
{error}
---END ERROR---

Common CadQuery pitfalls to check:
- `.fillet()` / `.chamfer()` need the EDGES of a 3D solid; you cannot fillet a
  2D sketch/wire. Extrude first, then fillet edges
  (e.g. `.rect(L,W).extrude(T).edges("|Z").fillet(3)`).
- `.hole()` / `.pushPoints()` must run on a workplane located on a face.
- Keep `import cadquery as cq` and `import math` only; assign the final solid
  to `SHAPE`.

Return exactly ONE fenced ```python block containing only the corrected program.
"""


def build_repair_messages(prd: str, program: str, error: str) -> list[dict]:
    """Messages asking the model to fix a program that failed to execute."""
    return [
        {"role": "system", "content": CADGEN_CONTRACT},
        {"role": "user", "content": REPAIR_TEMPLATE.format(program=program, error=error)},
    ]


def repair_program(
    cfg: Config,
    prd: str,
    program: str,
    error: str,
    model: str | None = None,
) -> str:
    """Ask the LLM to repair ``program`` given the execution ``error``."""
    messages = build_repair_messages(prd, program, error)
    raw = llm.chat(
        cfg,
        messages,
        model=model,
        temperature=0,
        timeout=max(300, cfg.sandbox_timeout),
    )
    code = _extract_code(raw)
    if not code:
        raise RuntimeError("repair: LLM returned an empty program")
    return code


__all__ = [
    "CADGEN_CONTRACT",
    "build_messages",
    "build_program",
    "build_repair_messages",
    "repair_program",
    "_extract_code",
]
