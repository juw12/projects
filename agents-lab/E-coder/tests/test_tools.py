"""
Hermetic tests for the E-coder M1 read-only tools (tools.py).

A temp directory is built as a tiny fake repo (including a node_modules/ dir and
a large file) so we can assert listing, reading, searching, dispatch, the path
sandbox, and the tool schemas — all offline. Run directly:

    python agents-lab/E-coder/tests/test_tools.py      # from the repo root
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

# tools.py lives one directory up from this test file; make it importable when we
# run this file directly as well as via unittest.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools import (  # noqa: E402
    SKIP_DIRS,
    TOOL_SCHEMAS,
    ToolError,
    dispatch,
    list_files,
    read_file,
    search,
)


def _make_repo(tmp: str) -> None:
    """Lay out a tiny fake repo inside `tmp`."""
    (Path(tmp) / "a.txt").write_text("alpha\nbeta\n", encoding="utf-8")
    (Path(tmp) / "sub").mkdir()
    (Path(tmp) / "sub" / "b.py").write_text("def foo():\n    return 'needle'\n", encoding="utf-8")
    (Path(tmp) / "node_modules").mkdir()
    (Path(tmp) / "node_modules" / "junk.txt").write_text("skip me\n", encoding="utf-8")
    (Path(tmp) / "big.txt").write_text("x" * 200, encoding="utf-8")


class ListFilesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        _make_repo(self.tmp)

    def test_lists_files_and_dirs(self) -> None:
        out = list_files(".", root=self.tmp)
        self.assertIn("a.txt", out)
        self.assertIn("sub/", out)  # directories get a trailing slash

    def test_skips_skip_dirs(self) -> None:
        out = list_files(".", root=self.tmp)
        self.assertNotIn("node_modules", out)

    def test_truncates_at_cap(self) -> None:
        out = list_files(".", root=self.tmp, max_entries=2)
        self.assertIn("truncated", out)

    def test_not_a_dir_raises(self) -> None:
        with self.assertRaises(ToolError):
            list_files("a.txt", root=self.tmp)


class ReadFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        _make_repo(self.tmp)

    def test_reads_content(self) -> None:
        out = read_file("a.txt", root=self.tmp)
        self.assertIn("alpha", out)
        self.assertIn("beta", out)

    def test_truncates_large_file(self) -> None:
        out = read_file("big.txt", root=self.tmp, max_bytes=10)
        self.assertIn("truncated", out)
        self.assertTrue(out.startswith("x" * 10))  # shows exactly the first 10 chars
        self.assertLess(len(out), 200)  # not the whole file

    def test_missing_file_raises(self) -> None:
        with self.assertRaises(ToolError):
            read_file("nope.txt", root=self.tmp)


class SearchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        _make_repo(self.tmp)

    def test_finds_pattern(self) -> None:
        out = search("needle", root=self.tmp)
        self.assertIn("b.py", out)
        self.assertIn("needle", out)
        self.assertIn(":", out)  # relpath:lineno: line format

    def test_skips_skip_dirs(self) -> None:
        # "skip me" only exists under node_modules/, which must be skipped.
        self.assertEqual(search("skip me", root=self.tmp), "(no matches)")

    def test_no_matches(self) -> None:
        self.assertEqual(search("zzz-not-present-zzz", root=self.tmp), "(no matches)")

    def test_invalid_regex_raises(self) -> None:
        with self.assertRaises(ToolError):
            search("([unclosed", root=self.tmp)


class ConfinementTests(unittest.TestCase):
    """The path sandbox: nothing may read outside `root`."""

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        (Path(self.tmp) / "inside.txt").write_text("here\n", encoding="utf-8")
        self.outside = tempfile.mkdtemp()
        (Path(self.outside) / "secret.txt").write_text("top secret\n", encoding="utf-8")

    def test_inside_is_ok(self) -> None:
        self.assertIn("here", read_file("inside.txt", root=self.tmp))

    def test_dotdot_escape_raises(self) -> None:
        # A relative path that climbs out of the repo root must be rejected.
        rel = os.path.relpath(self.outside, self.tmp)
        with self.assertRaises(ToolError):
            read_file(rel, root=self.tmp)

    def test_dotdot_escape_in_search_raises(self) -> None:
        rel = os.path.relpath(self.outside, self.tmp)
        with self.assertRaises(ToolError):
            search("secret", path=rel, root=self.tmp)


class DispatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.outside = tempfile.mkdtemp()  # a path outside the repo root
        _make_repo(self.tmp)

    def test_dispatch_runs_tool(self) -> None:
        out = dispatch("read_file", {"path": "a.txt"}, self.tmp)
        self.assertIn("alpha", out)

    def test_extraneous_args_are_ignored(self) -> None:
        out = dispatch("read_file", {"path": "a.txt", "bogus": 123}, self.tmp)
        self.assertIn("alpha", out)

    def test_unknown_tool_raises(self) -> None:
        with self.assertRaises(ToolError):
            dispatch("nope", {}, self.tmp)

    def test_root_is_forced_not_model_controlled(self) -> None:
        # Even if the model passes a root, the caller's root wins.
        out = dispatch("read_file", {"path": "a.txt", "root": self.outside}, self.tmp)
        self.assertIn("alpha", out)


class SchemaTests(unittest.TestCase):
    def test_schema_names_and_shape(self) -> None:
        names = {s["function"]["name"] for s in TOOL_SCHEMAS}
        self.assertEqual(names, {"list_files", "read_file", "search"})
        for s in TOOL_SCHEMAS:
            self.assertEqual(s["type"], "function")
            self.assertIn("parameters", s["function"])

    def test_skip_dirs_includes_common_noise(self) -> None:
        self.assertIn("node_modules", SKIP_DIRS)
        self.assertIn(".git", SKIP_DIRS)


if __name__ == "__main__":
    unittest.main()
