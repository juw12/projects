"""
Hermetic tests for the E-coder M3 gitignore-aware context builder (repo.py).

A tiny temp repo (with a .gitignore) is built, and the matcher, walk, tree, and
context builder are exercised. No network, no model. Run directly:

    python agents-lab/E-coder/tests/test_repo.py      # from the repo root
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

# repo.py lives one directory up from this test file; make it importable both
# when run directly and via unittest.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import repo  # noqa: E402


def _make_repo(base: str) -> None:
    (Path(base) / "src").mkdir()
    (Path(base) / "logs").mkdir()
    (Path(base) / "build").mkdir()
    (Path(base) / "README.md").write_text("# Project\n\nA demo project.\n", encoding="utf-8")
    (Path(base) / "src" / "a.py").write_text("def alpha():\n    return 1\n", encoding="utf-8")
    (Path(base) / "src" / "b.py").write_text("def beta():\n    return 2\n", encoding="utf-8")
    (Path(base) / "logs" / "x.log").write_text("log line\n", encoding="utf-8")
    (Path(base) / "build" / "out.bin").write_bytes(b"\x00\x01")
    (Path(base) / "keep.log").write_text("important\n", encoding="utf-8")
    (Path(base) / "root_only.txt").write_text("root\n", encoding="utf-8")
    (Path(base) / ".gitignore").write_text(
        "# ignore logs\n"
        "*.log\n"
        "!keep.log\n"
        "\n"
        "build/\n"
        "/root_only.txt\n",
        encoding="utf-8",
    )


class Base(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        _make_repo(self.tmp)
        self.gitignore = repo.parse_gitignore(os.path.join(self.tmp, ".gitignore"))


class ParseGitignoreTests(Base):
    def test_strips_comments_and_blanks(self) -> None:
        self.assertEqual(self.gitignore, ["*.log", "!keep.log", "build/", "/root_only.txt"])


class IsIgnoredTests(Base):
    def test_log_file_ignored(self) -> None:
        self.assertTrue(repo.is_ignored("logs/x.log", False, self.gitignore))

    def test_negation_unignores_keep_log(self) -> None:
        self.assertFalse(repo.is_ignored("keep.log", False, self.gitignore))

    def test_build_subtree_ignored(self) -> None:
        self.assertTrue(repo.is_ignored("build/out.bin", False, self.gitignore))

    def test_root_anchored_pattern_ignores(self) -> None:
        self.assertTrue(repo.is_ignored("root_only.txt", False, self.gitignore))

    def test_src_file_not_ignored(self) -> None:
        self.assertFalse(repo.is_ignored("src/a.py", False, self.gitignore))


class WalkTests(Base):
    def test_walk_excludes_ignored(self) -> None:
        files = set(repo.walk(self.tmp))
        self.assertIn("README.md", files)
        self.assertIn("src/a.py", files)
        self.assertIn("src/b.py", files)
        self.assertIn("keep.log", files)
        self.assertNotIn("logs/x.log", files)
        self.assertNotIn("build/out.bin", files)
        self.assertNotIn("root_only.txt", files)
        self.assertNotIn(".gitignore", files)

    def test_walk_never_enters_build(self) -> None:
        self.assertFalse(any(f.startswith("build/") for f in repo.walk(self.tmp)))


class BuildTreeTests(Base):
    def test_tree_contains_src_excludes_ignored_dirs(self) -> None:
        tree = repo.build_tree(self.tmp)
        self.assertIn("src/", tree)
        self.assertIn("a.py", tree)
        self.assertNotIn("build", tree)
        self.assertNotIn("logs", tree)


class BuildContextTests(Base):
    def test_includes_relevant_file(self) -> None:
        ctx = repo.build_context(self.tmp, "explain b.py", budget_chars=20000)
        self.assertIn("### src/b.py", ctx)
        self.assertLessEqual(len(ctx), 20000)

    def test_budget_respected(self) -> None:
        ctx = repo.build_context(self.tmp, "explain b.py alpha", budget_chars=500)
        self.assertLessEqual(len(ctx), 500)

    def test_tiny_budget_still_returns_tree(self) -> None:
        tiny = 50
        ctx = repo.build_context(self.tmp, "explain b.py", budget_chars=tiny)
        self.assertLessEqual(len(ctx), tiny)
        self.assertGreater(len(ctx), 0)
        self.assertIn("src", ctx)  # the (truncated) tree is what's returned


if __name__ == "__main__":
    unittest.main()
