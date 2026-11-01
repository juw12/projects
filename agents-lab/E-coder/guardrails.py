"""
E — E-coder guardrails (M2): command deny-list + confirmation gate.

The safety layer for a coding agent that can WRITE files and RUN shell commands.
Two parts:

  * `check_command` — a hard, fail-closed deny-list. It rejects destructive /
    network / privilege commands AND any shell control operator (so a
    "harmless && rm -rf /" can't sneak past a naive keyword check). Raises
    `GuardrailError`.
  * `confirm` — an explicit yes/no gate. Also fail-closed: a non-interactive
    caller is NEVER auto-approved; an interactive caller must answer y/yes.

Stdlib only. The tools layer turns a `GuardrailError` into a `ToolError` so the
agent loop feeds it back to the model instead of crashing.

Style notes: same shape as D-langgraph-agent/guardrails.py — plain functions,
readable regex strings, no dependencies.
"""
from __future__ import annotations

import re

# --- Command deny-list --------------------------------------------------------
# Hard patterns, matched case-insensitively (compiled once below). We reject on
# ANY match. Kept as readable raw regex strings. Order doesn't matter.
#
# Note: shell control operators are NOT here — they're blocked separately in
# check_command (step 2) so that no single destructive keyword can hide after an
# operator. This list only covers "even a standalone occurrence is bad" patterns.
_DENY_SOURCES: list[str] = [
    # --- destructive deletes / filesystem wipes ---
    r"\brm\s+(-\w+\s+)*-\w*[fr]",        # rm -rf / rm -fr / rm -r -f ... (any recursive/force rm)
    r"\bdel\s+/[a-z]",                   # del /f /s /q (Windows)
    r"\brmdir\s+/s",                     # rmdir /s (Windows)
    r"\bformat\b",                       # format C:
    r"\bmkfs",                           # mkfs.ext4 ...
    r"\bdd\s+if=",                       # dd if=/dev/zero of=...
    # --- git history / remote destructive ---
    r"\bgit\s+push\b",                   # git push
    r"\bgit\s+reset\s+--hard",           # git reset --hard
    r"\bgit\s+clean\s+(-\w+\s+)*-f",     # git clean -fd / -f
    # --- power / boot ---
    r"\bshutdown\b",
    r"\breboot\b",
    # --- network egress (an agent should not reach out over the network) ---
    r"\bcurl\b",
    r"\bwget\b",
    r"\binvoke-webrequest\b",            # PowerShell
    r"\biwr\b",                          # PowerShell alias
    # --- package installs (mutates the environment / fetches code) ---
    r"\bpip3?\s+install\b",              # pip / pip3 install
    r"\bnpm\s+(install|i)\b",            # npm install / npm i
    # --- permission / device / fork-bomb abuse ---
    r"\bchmod\s+777\b",
    r":\(\)\{",                          # fork bomb  :(){ ...
    r"/dev/[a-z]",                       # write to /dev/sda etc. (a ">" is also blocked)
]

DENY_PATTERNS: list[re.Pattern] = [re.compile(p, re.IGNORECASE) for p in _DENY_SOURCES]

# --- Shell control operators --------------------------------------------------
# Single-character operators that can chain, redirect, or glob-expand a command.
# We reject the whole command if ANY appears. "$(" (command substitution) and the
# backtick are handled in check_command (two-char / needs escaping).
#
# IMPORTANT: a bare "(" or ")" is intentionally NOT blocked — Python one-liners
# like  python -c "print(42)"  must stay runnable. Only the "$(" substitution is
# treated as an operator.
SHELL_METACHARS = ";|&`<>\n"


class GuardrailError(Exception):
    """Raised by check_command when a command is not allowed.

    The message says *why* (which operator or deny pattern matched) so it can be
    fed back to the model and logged.
    """


def check_command(command: str) -> None:
    """Validate a shell command against the deny-list. Raises GuardrailError.

    Order (per the plan): (1) reject empty/whitespace; (2) reject any shell
    control operator (no chaining / redirecting / substituting); (3) reject any
    deny-list pattern. If none match, the command is allowed.
    """
    # (1) empty / whitespace-only.
    if command is None or not command.strip():
        raise GuardrailError("empty command")

    # (2) shell control operators. Single chars in a scan, then the two-char
    # command-substitution "$(". (Bare "(" / ")" are allowed on purpose.)
    for ch in (";", "|", "&", "`", ">", "<", "\n", "\r"):
        if ch in command:
            raise GuardrailError(f"shell operator not allowed: {ch!r}")
    if "$(" in command:
        raise GuardrailError("shell operator not allowed: '$('")

    # (3) deny-list.
    for pattern in DENY_PATTERNS:
        if pattern.search(command):
            raise GuardrailError(f"command matches deny pattern: {pattern.pattern!r}")


def confirm(action: str, detail: str, *, interactive: bool) -> bool:
    """Ask the user to confirm an action. Returns True only on an explicit y/yes.

    Fail-closed: `interactive=False` always returns False (a non-interactive
    caller can never be silently approved). `interactive=True` prints `detail`
    and reads a single line from stdin; Ctrl-C / EOF also decline.
    """
    if not interactive:
        return False
    print(detail)
    try:
        answer = input(f"[guardrail] {action} allowed? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer in {"y", "yes"}
