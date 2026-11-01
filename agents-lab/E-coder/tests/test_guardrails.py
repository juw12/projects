"""
Hermetic tests for the E-coder M2 guardrails (guardrails.py).

No subprocess is launched; we exercise the string-based checks and the confirm
gate (with `input` mocked) directly. Run directly:

    python agents-lab/E-coder/tests/test_guardrails.py      # from the repo root
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

# guardrails.py lives one directory up from this test file; make it importable
# both when run directly and via unittest.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from guardrails import GuardrailError, check_command, confirm  # noqa: E402


class CheckCommandDenyTests(unittest.TestCase):
    def _denied(self, command: str) -> None:
        with self.assertRaises(GuardrailError):
            check_command(command)

    def test_empty_is_denied(self) -> None:
        self._denied("")
        self._denied("   ")

    def test_destructive_rm_is_denied(self) -> None:
        self._denied("rm -rf /")
        self._denied("rm -fr /tmp/x")

    def test_git_push_is_denied(self) -> None:
        self._denied("git push origin main")

    def test_network_is_denied(self) -> None:
        self._denied("curl http://x")
        self._denied("wget http://x")

    def test_shell_operators_are_denied(self) -> None:
        self._denied("ls; rm -rf /")             # ;
        self._denied("ls && reboot")             # &  (covers &&)
        self._denied("ls | sh")                  # |
        self._denied("echo x > /etc/passwd")     # >
        self._denied("echo $(reboot)")           # $(

    def test_bypass_via_operator_is_blocked(self) -> None:
        # A benign first token can't hide a destructive one after an operator.
        self._denied("true && rm -rf /")


class CheckCommandAllowTests(unittest.TestCase):
    def test_unittest_discover_is_allowed(self) -> None:
        check_command("python -m unittest discover")  # must not raise

    def test_python_oneliner_with_parens_is_allowed(self) -> None:
        # print(42) has parens but no shell operators -> allowed.
        check_command('python -c "print(42)"')


class ConfirmTests(unittest.TestCase):
    def test_non_interactive_never_approves(self) -> None:
        self.assertFalse(confirm("write", "detail", interactive=False))

    def test_interactive_yes(self) -> None:
        with mock.patch("builtins.input", return_value="y"):
            self.assertTrue(confirm("write", "detail", interactive=True))

    def test_interactive_yes_full_word(self) -> None:
        with mock.patch("builtins.input", return_value="YES"):
            self.assertTrue(confirm("write", "detail", interactive=True))

    def test_interactive_no(self) -> None:
        with mock.patch("builtins.input", return_value="n"):
            self.assertFalse(confirm("write", "detail", interactive=True))

    def test_interactive_empty_declines(self) -> None:
        with mock.patch("builtins.input", return_value=""):
            self.assertFalse(confirm("write", "detail", interactive=True))

    def test_interactive_eof_declines(self) -> None:
        with mock.patch("builtins.input", side_effect=EOFError):
            self.assertFalse(confirm("write", "detail", interactive=True))


if __name__ == "__main__":
    unittest.main()
