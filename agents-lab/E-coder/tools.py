"""
E — E-coder read-only tools (M1).

Three read-only tools plus a dispatcher, all confined to a repo `root` via a
path sandbox. This is the M1 slice of guardrails: the agent can look around the
repo but cannot reach outside it. `write_file` / `run_command` (and full
guardrails) are M2.

Stdlib only. The tools return *strings* (text the model can read), and raise
`ToolError` for anything that is wrong — the agent loop turns a `ToolError` into
a tool result and feeds it back to the model instead of crashing.
"""
from __future__ import annotations

import inspect
import os
import re

# Directories we never descend into or list (noise + size). Extend as needed.
SKIP_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    ".venv3d",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
}


class ToolError(Exception):
    """Raised when a tool cannot do what it was asked (bad path, missing file, ...).

    The message is meant to be fed back to the model so it can recover.
    """


# --- Path sandbox -------------------------------------------------------------
def _resolve_inside(root: str, path: str) -> str:
    """Resolve `path` against `root` and ensure the result stays inside `root`.

    Returns the resolved absolute path, or raises ToolError if it escapes `root`.

    We use `os.path.realpath` (follows symlinks, collapses `..`) and
    `os.path.commonpath` (compares whole path components, not string prefixes)
    so that `../..`, absolute paths, and symlink tricks all fail closed.
    """
    root_abs = os.path.realpath(root)
    # os.path.join drops root_abs if `path` is absolute — exactly what we want to
    # detect: an absolute path is then checked (and rejected) against root_abs.
    candidate = os.path.realpath(os.path.join(root_abs, path))
    try:
        inside = os.path.commonpath([root_abs, candidate]) == root_abs
    except ValueError:
        # Different drives (Windows) or incompatible paths -> definitely outside.
        inside = False
    if not inside:
        raise ToolError(f"path escapes repo root: {path!r}")
    return candidate


# --- Tools --------------------------------------------------------------------
def list_files(path: str = ".", root: str = ".", max_entries: int = 500) -> str:
    """List the entries in directory `path` (relative to `root`), sorted.

    Directories get a trailing "/". Any entry named in SKIP_DIRS is omitted.
    The listing is capped at `max_entries`.
    """
    target = _resolve_inside(root, path)
    if not os.path.isdir(target):
        raise ToolError(f"not a directory: {path!r}")
    entries: list[str] = []
    truncated = False
    for name in sorted(os.listdir(target)):
        if name in SKIP_DIRS:
            continue
        entries.append(name + "/" if os.path.isdir(os.path.join(target, name)) else name)
        if len(entries) >= max_entries:
            truncated = True
            break
    if not entries:
        return "(empty directory)"
    out = "\n".join(entries)
    if truncated:
        out += f"\n... (truncated at {max_entries} entries)"
    return out


def read_file(path: str, root: str = ".", max_bytes: int = 50000) -> str:
    """Read the file at `path` (relative to `root`) as UTF-8 text.

    Decodes with errors="replace". If the text is longer than `max_bytes`
    characters, returns the first `max_bytes` chars plus a truncation note.
    """
    target = _resolve_inside(root, path)
    if not os.path.isfile(target):
        raise ToolError(f"file not found: {path!r}")
    with open(target, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()
    if len(text) > max_bytes:
        return text[:max_bytes] + f"\n... [truncated: showing first {max_bytes} of {len(text)} chars]"
    return text


def search(pattern: str, path: str = ".", root: str = ".", max_results: int = 100) -> str:
    """Regex-search file contents under `path` (relative to `root`).

    Returns lines of the form `relpath:lineno: line` (paths relative to `path`),
    capped at `max_results`. Directories in SKIP_DIRS are skipped.
    """
    target = _resolve_inside(root, path)
    try:
        rx = re.compile(pattern)
    except re.error as e:
        raise ToolError(f"invalid regex {pattern!r}: {e}") from e
    if not os.path.exists(target):
        raise ToolError(f"path not found: {path!r}")

    results: list[str] = []
    for dirpath, dirnames, filenames in os.walk(target):
        # Prune skipped directories in place so os.walk never descends into them.
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            full = os.path.join(dirpath, fname)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    for lineno, line in enumerate(f, start=1):
                        if rx.search(line):
                            results.append(f"{os.path.relpath(full, target)}:{lineno}: {line.rstrip()}")
                            if len(results) >= max_results:
                                return "\n".join(results) + f"\n... (truncated at {max_results} results)"
            except OSError:
                continue  # unreadable file — skip, keep searching
    return "\n".join(results) if results else "(no matches)"


# --- Dispatch + tool schemas --------------------------------------------------
# Registry: tool name -> callable. Each callable accepts `root` plus its own args.
_TOOLS = {
    "list_files": list_files,
    "read_file": read_file,
    "search": search,
}


def dispatch(name: str, arguments: dict, root: str) -> str:
    """Run tool `name` with `arguments` confined to `root`, returning its string result.

    Only the keys the tool actually accepts are passed through (extra keys are
    dropped); `root` is always set by us, never by the model. Unknown tool names
    raise ToolError.
    """
    fn = _TOOLS.get(name)
    if fn is None:
        raise ToolError(f"unknown tool: {name!r} (available: {', '.join(sorted(_TOOLS))})")
    args = arguments if isinstance(arguments, dict) else {}
    accepted = set(inspect.signature(fn).parameters)
    kwargs = {k: v for k, v in args.items() if k in accepted}
    kwargs["root"] = root
    return fn(**kwargs)


# JSON-schema tool definitions in OpenAI function-calling format. Ollama accepts
# the same `tools` shape, so this one list works for both providers.
TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List the files and subdirectories in a directory, relative to the repo root. "
            "Subdirectories are listed with a trailing slash.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory to list, relative to the repo root. Default '.'.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file, relative to the repo root, and return its contents (size-capped).",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File to read, relative to the repo root.",
                    },
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": "Search file contents under a directory (relative to the repo root) using a regex. "
            "Returns matches as 'relpath:lineno: line'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Regular expression to search for.",
                    },
                    "path": {
                        "type": "string",
                        "description": "Directory to search under, relative to the repo root. Default '.'.",
                    },
                },
                "required": ["pattern"],
            },
        },
    },
]
