"""
Hermetic tests for the E-coder M1 agent loop (loop.py).

No model is available in tests, so `llm.chat` is mocked with a scripted sequence
of `Reply` objects. We assert the loop runs the tool, feeds results back, returns
the final answer, and stops cleanly at `max_steps`. Run directly:

    python agents-lab/E-coder/tests/test_loop.py      # from the repo root
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

# loop.py lives one directory up from this test file; make it importable both
# when run directly and via unittest.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from llm import Reply, ToolCall  # noqa: E402
from loop import run_agent  # noqa: E402


def _ollama_reply(text: str, tool_calls: list[ToolCall]) -> Reply:
    """Build a Reply whose raw is an Ollama-shaped response (the default provider)."""
    raw_tcs = [
        {"function": {"name": tc.name, "arguments": tc.arguments}}
        for tc in tool_calls
    ]
    message = {"role": "assistant", "content": text}
    if raw_tcs:
        message["tool_calls"] = raw_tcs
    return Reply(text=text, tool_calls=tool_calls, raw={"message": message})


class LoopTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        (Path(self.tmp) / "hello.txt").write_text("hello world\n", encoding="utf-8")

    def test_runs_tool_then_returns_final_answer(self) -> None:
        first = _ollama_reply("", [ToolCall(name="list_files", arguments={}, id=None)])
        second = _ollama_reply("done.", [])

        steps: list[dict] = []
        with mock.patch("llm.chat", side_effect=[first, second]) as m:
            out = run_agent("list the files", self.tmp, on_step=steps.append)

        self.assertEqual(out, "done.")
        self.assertEqual(m.call_count, 2)

        # The tool actually ran: step 1's result is a real listing containing hello.txt.
        tool_steps = [s for s in steps if "tool_calls" in s]
        self.assertEqual(len(tool_steps), 1)
        self.assertTrue(any("hello.txt" in tc["result"] for tc in tool_steps[0]["tool_calls"]))
        # And a final step was recorded.
        self.assertTrue(any(s.get("final") for s in steps))

    def test_tool_error_is_fed_back_not_raised(self) -> None:
        # Model asks to read a file that doesn't exist; then answers.
        first = _ollama_reply("", [ToolCall(name="read_file", arguments={"path": "nope.txt"}, id=None)])
        second = _ollama_reply("the file is missing.", [])

        steps: list[dict] = []
        with mock.patch("llm.chat", side_effect=[first, second]):
            out = run_agent("read a file", self.tmp, on_step=steps.append)

        self.assertEqual(out, "the file is missing.")
        tool_steps = [s for s in steps if "tool_calls" in s]
        result = tool_steps[0]["tool_calls"][0]["result"]
        self.assertTrue(result.startswith("error:"))  # ToolError surfaced as text, not a crash


class MaxStepsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        (Path(self.tmp) / "hello.txt").write_text("hi\n", encoding="utf-8")

    def test_stops_at_max_steps(self) -> None:
        # The model always requests a tool call and never gives a final answer.
        looping = _ollama_reply("", [ToolCall(name="list_files", arguments={}, id=None)])
        with mock.patch("llm.chat", return_value=looping) as m:
            out = run_agent("loop forever", self.tmp, max_steps=3)
        self.assertIn("stopped", out)
        self.assertIn("3", out)
        self.assertEqual(m.call_count, 3)  # exactly max_steps model calls, no runaway


if __name__ == "__main__":
    unittest.main()
