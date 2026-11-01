"""
E — E-coder gitignore-aware context builder (M3, the "hard part").

Feeding a model a *compact* view of a repo that fits its context window. Reading
every file blows the budget fast, so this module (1) skips what .gitignore says to
skip, and (2) ranks the remaining files by how relevant they are to the task, then
includes the most relevant ones up to a character budget.

Stdlib only. We implement a small .gitignore matcher by hand (no `pathspec`).
M3 reads only the *root* .gitignore; nested .gitignore files are a known TODO
(see _compile note below).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass

from tools import SKIP_DIRS

# --- .gitignore parsing + matching --------------------------------------------
@dataclass
class _CompiledPattern:
    """One gitignore pattern, pre-parsed for fast matching."""

    negated: bool      # leading "!" (un-ignore)
    dir_only: bool     # trailing "/" (matches directories only)
    anchored: bool     # anchored to repo root (leading "/" or contains "/")
    regex: "re.Pattern[str]"


def parse_gitignore(path: str) -> list[str]:
    """Return the raw gitignore patterns in `path` (comments/blanks stripped).

    Trailing whitespace is stripped from each line. Returns [] if the file is
    missing or unreadable.
    """
    if not os.path.isfile(path):
        return []
    patterns: list[str] = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip()
            if not line or line.startswith("#"):
                continue
            patterns.append(line)
    return patterns


def _glob_to_regex(s: str) -> str:
    """Translate a gitignore glob to a regex *string*.

    `*` matches within a path segment, `?` one non-slash char, `**` across `/`.
    (`**` is best-effort: it crosses slashes, but the zero-directory edge like
    `a/**/b` matching `a/b` is a known simplification.)
    """
    out: list[str] = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "*":
            if i + 1 < n and s[i + 1] == "*":
                out.append(".*")      # '**' crosses '/'
                i += 2
            else:
                out.append("[^/]*")   # '*' stays inside a segment
                i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return "".join(out)


def _compile(patterns: list[str]) -> list[_CompiledPattern]:
    """Compile raw gitignore patterns. TODO: also read nested .gitignore files."""
    compiled: list[_CompiledPattern] = []
    for raw in patterns:
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        negated = s.startswith("!")
        if negated:
            s = s[1:].lstrip()
        dir_only = s.endswith("/")
        if dir_only:
            s = s[:-1]
        if not s:
            continue
        # A pattern with a slash (other than a stripped trailing one) is anchored
        # to the repo root; a leading "/" also anchors it.
        anchored = s.startswith("/") or "/" in s
        if s.startswith("/"):
            s = s.lstrip("/")
        compiled.append(_CompiledPattern(negated, dir_only, anchored, re.compile(_glob_to_regex(s))))
    return compiled


def _path_ignored(relpath: str, treat_as_dir: bool, compiled: list[_CompiledPattern]) -> bool:
    """Does `relpath` match any compiled pattern? The last match wins (negation)."""
    matched: bool | None = None
    base = relpath.rsplit("/", 1)[-1]
    for cp in compiled:
        if cp.dir_only and not treat_as_dir:
            continue
        # Anchored patterns match the full path; unanchored match the basename.
        target = relpath if cp.anchored else base
        if cp.regex.fullmatch(target):
            matched = not cp.negated
    return bool(matched)


def _is_ignored_core(relpath: str, is_dir: bool, compiled: list[_CompiledPattern]) -> bool:
    """Core ignore check on a repo-relative POSIX path (compiled patterns in)."""
    if not relpath:
        return False
    parts = relpath.split("/")
    if any(p in SKIP_DIRS for p in parts):
        return True
    if parts[-1] == ".gitignore":
        return True
    if is_dir:
        return _path_ignored(relpath, True, compiled)
    if _path_ignored(relpath, False, compiled):
        return True
    # A file is ignored if any ancestor directory is ignored (prunes the subtree).
    for i in range(1, len(parts)):
        if _path_ignored("/".join(parts[:i]), True, compiled):
            return True
    return False


def is_ignored(relpath: str, is_dir: bool, patterns: list[str]) -> bool:
    """Public check: is repo-relative `relpath` (POSIX slashes) ignored?"""
    return _is_ignored_core(relpath, is_dir, _compile(patterns))


# --- Walk + tree --------------------------------------------------------------
def walk(root: str, *, respect_gitignore: bool = True, max_files: int = 2000) -> list[str]:
    """Return non-ignored file paths (repo-relative, forward slashes) under `root`.

    Ignored directories are pruned so `os.walk` never descends into them.
    """
    root_abs = os.path.realpath(root)
    compiled = _compile(parse_gitignore(os.path.join(root_abs, ".gitignore"))) if respect_gitignore else []
    files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root_abs):
        rel_dir = os.path.relpath(dirpath, root_abs)
        if rel_dir == os.curdir:
            rel_dir = ""
        rel_dir = rel_dir.replace(os.sep, "/")
        keep: list[str] = []
        for d in sorted(dirnames):
            rel = f"{rel_dir}/{d}" if rel_dir else d
            if _is_ignored_core(rel, True, compiled):
                continue
            keep.append(d)
        dirnames[:] = keep
        for fn in sorted(filenames):
            rel = f"{rel_dir}/{fn}" if rel_dir else fn
            if _is_ignored_core(rel, False, compiled):
                continue
            files.append(rel)
            if len(files) >= max_files:
                return files
    return files


def build_tree(root: str, *, respect_gitignore: bool = True, max_entries: int = 500) -> str:
    """An indented text tree of the non-ignored files under `root` (dirs end "/").

    Built from the file list, so a directory whose contents are all ignored
    (e.g. `logs/` holding only `*.log`) does not appear — like `git ls-files`.
    """
    files = walk(root, respect_gitignore=respect_gitignore, max_files=100000)
    node: dict = {}
    for f in files:
        cur = node
        parts = f.split("/")
        for i, part in enumerate(parts):
            is_last = i == len(parts) - 1
            if part not in cur:
                cur[part] = None if is_last else {}
            cur = cur[part]
    lines: list[str] = []
    truncated = False

    def render(cur: dict, depth: int) -> None:
        nonlocal truncated
        for name in sorted(k for k, v in cur.items() if v is not None):
            if truncated:
                return
            lines.append("  " * depth + name + "/")
            if len(lines) >= max_entries:
                truncated = True
                return
            render(cur[name], depth + 1)
        for name in sorted(k for k, v in cur.items() if v is None):
            if truncated:
                return
            lines.append("  " * depth + name)
            if len(lines) >= max_entries:
                truncated = True
                return

    render(node, 0)
    out = "\n".join(lines)
    if truncated:
        out += "\n... (truncated)"
    return out


# --- Context builder ----------------------------------------------------------
_STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "for", "with", "from", "into", "onto",
    "this", "that", "these", "those", "is", "are", "was", "were", "be", "been",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should",
    "can", "could", "may", "might", "must", "to", "of", "in", "on", "at", "by",
    "as", "it", "its", "my", "your", "our", "their", "we", "you", "he", "she",
    "they", "i", "what", "when", "where", "which", "who", "how", "why", "please",
}


def _task_tokens(task: str) -> list[str]:
    """Lowercase the task into searchable words (len>=3, stopwords dropped)."""
    seen: set[str] = set()
    tokens: list[str] = []
    for raw in task.lower().split():
        tok = raw.strip(".,;:()[]{}<>\"'`/")
        if len(tok) < 3 or tok in _STOPWORDS:
            continue
        if not re.fullmatch(r"[a-z0-9_.\-]+", tok):
            continue
        if tok in seen:
            continue
        seen.add(tok)
        tokens.append(tok)
    return tokens


def build_context(
    root: str,
    task: str,
    *,
    budget_chars: int = 20000,
    per_file_chars: int = 8000,
    respect_gitignore: bool = True,
) -> str:
    """Assemble a compact, task-relevant context string under `budget_chars`.

    A short header + the gitignore-aware tree, then the most relevant files
    (path matches weigh more than content matches; smaller files win ties),
    each capped at `per_file_chars`, until the budget is reached.
    """
    root_abs = os.path.realpath(root)
    tree = build_tree(root, respect_gitignore=respect_gitignore)
    header = f"## Repository tree\n{tree}\n"
    if len(header) > budget_chars:
        return header[:budget_chars]

    parts: list[str] = [header]
    total = len(header)
    tokens = _task_tokens(task)
    if tokens:
        files = walk(root, respect_gitignore=respect_gitignore, max_files=2000)
        scored: list[tuple[int, int, str]] = []
        for rel in files:
            full = os.path.join(root_abs, rel)
            if not os.path.isfile(full):
                continue
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            path_l = rel.lower()
            score = sum(5 * path_l.count(t) for t in tokens)
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    content_l = f.read(40000).lower()
            except OSError:
                content_l = ""
            score += sum(min(content_l.count(t), 20) for t in tokens)
            if score > 0:
                scored.append((score, size, rel))
        scored.sort(key=lambda x: (-x[0], x[1]))  # relevance desc, then smaller first
        for _score, _size, rel in scored:
            full = os.path.join(root_abs, rel)
            try:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    body = f.read(per_file_chars)
            except OSError:
                continue
            chunk = f"\n### {rel}\n{body}\n"
            if total + len(chunk) > budget_chars:
                parts.append(f"\n... (context budget {budget_chars} chars reached; more files omitted)\n")
                break
            parts.append(chunk)
            total += len(chunk)
            if total >= budget_chars:
                parts.append(f"\n... (context budget {budget_chars} chars reached)\n")
                break

    result = "".join(parts)
    if len(result) > budget_chars:
        result = result[:budget_chars]
    return result
