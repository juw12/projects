"""
E — E-coder tools (M1 read-only + M2 write/run + M3 repo tree).

Six tools plus a dispatcher, all confined to a repo `root` via a path sandbox:

  M1 (read-only): list_files, read_file, search
  M2 (careful):   write_file, run_command
  M3 (read-only): repo_tree  (a gitignore-aware tree, built by repo.py)

`write_file` and `run_command` are SAFE BY DEFAULT: they only act when the
caller passes a `ToolContext` with `yolo=True`, or when an interactive user
confirms. A non-interactive context always declines. `run_command` additionally
passes `guardrails.check_command` (a hard command deny-list) before doing
anything.

Stdlib only. The tools return *strings* (text the model can read), and raise
`ToolError` for anything that is wrong — the agent loop turns a `ToolError` into
a tool result and feeds it back to the model instead of crashing.
"""
from __future__ import annotations

import difflib
import inspect
import os
import re
import subprocess
from dataclasses import dataclass

import guardrails

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


# --- Tool context -------------------------------------------------------------
@dataclass
class ToolContext:
    """Per-run policy for the mutating tools (`write_file` / `run_command`).

    SAFE BY DEFAULT: `yolo=False` + `interactive=False` means nothing mutating is
    ever approved. `yolo=True` skips confirmation (an explicit opt-in);
    `interactive=True` asks the user and requires an explicit y/yes.
    """

    root: str
    yolo: bool = False
    interactive: bool = True


def _effective_ctx(ctx: ToolContext | None, root: str) -> ToolContext:
    """Return `ctx`, or a safe read-only default (never auto-approves) if None."""
    if ctx is not None:
        return ctx
    return ToolContext(root=root, yolo=False, interactive=False)


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


def repo_tree(path: str = ".", root: str = ".", max_entries: int = 500) -> str:
    """A gitignore-aware tree of `path` (relative to `root`), confined to `root`.

    The `repo` import is local to avoid a circular import (repo.py imports
    SKIP_DIRS from this module).
    """
    from repo import build_tree

    target = _resolve_inside(root, path)
    if not os.path.isdir(target):
        raise ToolError(f"not a directory: {path!r}")
    return build_tree(target, max_entries=max_entries)


# --- Mutating tools (M2) ------------------------------------------------------
def write_file(
    path: str,
    content: str,
    root: str = ".",
    *,
    ctx: ToolContext | None = None,
    max_bytes: int = 200000,
) -> str:
    """Create or overwrite the file at `path` (relative to `root`) with `content`.

    SAFE BY DEFAULT: unless `ctx.yolo` is True, this requires user confirmation;
    a non-interactive context always declines (raises ToolError).
    """
    ctx = _effective_ctx(ctx, root)
    target = _resolve_inside(ctx.root, path)
    if len(content) > max_bytes:
        raise ToolError(f"content too large ({len(content)} > {max_bytes} chars)")

    # Read current contents ("" for a new file) so we can show a unified diff.
    is_new = not os.path.isfile(target)
    old = ""
    if not is_new:
        with open(target, "r", encoding="utf-8", errors="replace") as f:
            old = f.read()

    diff = "\n".join(
        difflib.unified_diff(
            old.splitlines(),
            content.splitlines(),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
        )
    )

    if not ctx.yolo:
        detail = f"write {path}\n" + (diff if diff.strip() else "(empty diff)")
        if not guardrails.confirm("write", detail, interactive=ctx.interactive):
            raise ToolError("write declined by user")

    parent = os.path.dirname(target)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(target, "w", encoding="utf-8") as f:
        f.write(content)

    note = " (new file)" if is_new else ""
    return f"wrote {len(content)} chars to {path}{note}\n" + (diff if diff.strip() else "(no changes)")


def run_command(
    command: str,
    root: str = ".",
    *,
    ctx: ToolContext | None = None,
    timeout: int = 60,
    max_output: int = 20000,
) -> str:
    """Run a shell command inside `ctx.root` and return its (truncated) output.

    SAFE BY DEFAULT: the command must first pass `guardrails.check_command` (a
    hard deny-list); then, unless `ctx.yolo` is True, it requires confirmation.
    Returns "exit=<code>\\n<stdout>\\n<stderr>".
    """
    ctx = _effective_ctx(ctx, root)
    # Hard deny-list first: a GuardrailError surfaces as a ToolError.
    try:
        guardrails.check_command(command)
    except guardrails.GuardrailError as e:
        raise ToolError(f"blocked command: {e}") from e
    # Confirmation gate (skipped under --yolo).
    if not ctx.yolo:
        if not guardrails.confirm("run", command, interactive=ctx.interactive):
            raise ToolError("command declined by user")
    # Run it (shell=True, but only AFTER check_command passed).
    try:
        proc = subprocess.run(
            command,
            shell=True,
            cwd=ctx.root,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as e:
        raise ToolError(f"command timed out after {timeout}s") from e
    out = f"exit={proc.returncode}\n{proc.stdout}\n{proc.stderr}"
    if len(out) > max_output:
        out = out[:max_output] + f"\n... [truncated at {max_output} chars]"
    return out


# --- Dispatch + tool schemas --------------------------------------------------
# Registry: tool name -> callable. Each callable accepts `root` plus its own args.
_TOOLS = {
    "list_files": list_files,
    "read_file": read_file,
    "search": search,
    "repo_tree": repo_tree,
    "write_file": write_file,
    "run_command": run_command,
}


def dispatch(name: str, arguments: dict, root: str, *, ctx: ToolContext | None = None) -> str:
    """Run tool `name` with `arguments`, returning its string result.

    The 3-argument call (name, arguments, root) still works, as in M1. A `ToolContext`
    may be passed for the mutating tools; if omitted, a SAFE read-only default is
    built (yolo=False, interactive=False) so write/run are declined by default.
    Only the keys a tool accepts are passed through; `root` and `ctx` are forced
    by us, never by the model. Unknown tool names raise ToolError.
    """
    fn = _TOOLS.get(name)
    if fn is None:
        raise ToolError(f"unknown tool: {name!r} (available: {', '.join(sorted(_TOOLS))})")
    context = _effective_ctx(ctx, root)
    args = arguments if isinstance(arguments, dict) else {}
    accepted = set(inspect.signature(fn).parameters)
    kwargs = {k: v for k, v in args.items() if k in accepted}
    kwargs["root"] = context.root
    if "ctx" in accepted:  # only the mutating tools take a context
        kwargs["ctx"] = context
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
    {
        "type": "function",
        "function": {
            "name": "repo_tree",
            "description": "Show a gitignore-aware tree of a directory, relative to the repo root. "
            "Directories are listed with a trailing slash; ignored entries are omitted.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory to show, relative to the repo root. Default '.'.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a file, relative to the repo root. "
            "Requires user confirmation unless the agent runs with --yolo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File to write, relative to the repo root.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Full new contents of the file.",
                    },
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Run a shell command inside the repo root. Blocked by a command "
            "deny-list; requires user confirmation unless the agent runs with --yolo.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "A single shell command (no chaining/redirects).",
                    },
                },
                "required": ["command"],
            },
        },
    },
]
