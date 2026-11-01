"""
Hermetic tests for the E-coder M0 model adapter (llm.py).

No real network is used: `urllib.request.urlopen` is mocked to return canned
Ollama / OpenAI JSON payloads, so these run offline and fast. Run directly:

    python agents-lab/E-coder/tests/test_llm.py      # from the repo root

or:  python -m unittest agents-lab/E-coder/tests/test_llm.py
"""
from __future__ import annotations

import io
import json
import os
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

# llm.py lives one directory up from this test file; make it importable when we
# run this file directly (python tests/test_llm.py) as well as via unittest.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import llm  # noqa: E402


class _FakeResp:
    """Minimal stand-in for the object `urlopen` returns (a context manager)."""

    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def __enter__(self) -> "_FakeResp":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def read(self) -> bytes:
        return self._payload


def _resp(payload: dict) -> _FakeResp:
    """Wrap a dict as a fake HTTP response carrying its JSON body."""
    return _FakeResp(json.dumps(payload).encode("utf-8"))


class OllamaTests(unittest.TestCase):
    """provider='ollama' -> POST {OLLAMA_HOST}/api/chat."""

    def test_text_only(self) -> None:
        with mock.patch("urllib.request.urlopen", return_value=_resp({"message": {"content": "hello"}})) as m:
            reply = llm.chat([{"role": "user", "content": "hi"}], provider="ollama")
        self.assertEqual(reply.text, "hello")
        self.assertEqual(reply.tool_calls, [])
        self.assertEqual(m.call_count, 1)
        self.assertIn("hello", json.dumps(reply.raw))

    def test_tool_calls_normalized(self) -> None:
        payload = {
            "message": {
                "role": "assistant",
                "content": "Let me calculate that.",
                "tool_calls": [
                    {"function": {"name": "calculator", "arguments": {"expression": "23*47"}}}
                ],
            }
        }
        with mock.patch("urllib.request.urlopen", return_value=_resp(payload)):
            reply = llm.chat([{"role": "user", "content": "23*47?"}], provider="ollama")
        self.assertEqual(reply.text, "Let me calculate that.")
        self.assertEqual(len(reply.tool_calls), 1)
        tc = reply.tool_calls[0]
        self.assertEqual(tc.name, "calculator")
        self.assertEqual(tc.arguments, {"expression": "23*47"})
        self.assertIsNone(tc.id)  # Ollama tool calls carry no id


class OpenAITests(unittest.TestCase):
    """provider='openai' -> POST {ECODER_BASE_URL}/chat/completions."""

    def setUp(self) -> None:
        # openai provider needs a base URL; set it via the env for each test.
        self._env = mock.patch.dict(os.environ, {"ECODER_BASE_URL": "https://api.example.com/v1"})
        self._env.start()
        self.addCleanup(self._env.stop)

    def test_text_only(self) -> None:
        payload = {"choices": [{"message": {"role": "assistant", "content": "hi there"}}]}
        with mock.patch("urllib.request.urlopen", return_value=_resp(payload)):
            reply = llm.chat([{"role": "user", "content": "hello"}], provider="openai")
        self.assertEqual(reply.text, "hi there")
        self.assertEqual(reply.tool_calls, [])

    def test_tool_calls_json_string_parsed(self) -> None:
        payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "Let me calculate that.",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "function": {
                                    "name": "calculator",
                                    "arguments": '{"expression": "23*47"}',
                                },
                            }
                        ],
                    }
                }
            ]
        }
        with mock.patch("urllib.request.urlopen", return_value=_resp(payload)):
            reply = llm.chat([{"role": "user", "content": "23*47?"}], provider="openai")
        self.assertEqual(reply.text, "Let me calculate that.")
        tc = reply.tool_calls[0]
        self.assertEqual(tc.id, "call_1")
        self.assertEqual(tc.name, "calculator")
        # The JSON *string* must be decoded into a dict.
        self.assertEqual(tc.arguments, {"expression": "23*47"})
        self.assertIsInstance(tc.arguments, dict)

    def test_malformed_arguments_falls_back_to_empty_dict(self) -> None:
        payload = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,  # missing text -> ""
                        "tool_calls": [
                            {
                                "id": "call_2",
                                "function": {"name": "foo", "arguments": "{not valid json"},
                            }
                        ],
                    }
                }
            ]
        }
        with mock.patch("urllib.request.urlopen", return_value=_resp(payload)):
            reply = llm.chat([{"role": "user", "content": "x"}], provider="openai")
        self.assertEqual(reply.text, "")
        self.assertEqual(reply.tool_calls[0].arguments, {})


class ErrorTests(unittest.TestCase):
    """Failures must raise LLMError with a helpful, non-generic message."""

    def test_http_non_200_raises(self) -> None:
        url = "http://127.0.0.1:11434/api/chat"
        err = urllib.error.HTTPError(url, 500, "boom", {}, io.BytesIO(b"internal server exploded"))
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(llm.LLMError) as ctx:
                llm.chat([{"role": "user", "content": "hi"}], provider="ollama")
        msg = str(ctx.exception)
        self.assertIn("ollama", msg)
        self.assertIn("11434", msg)
        self.assertIn("500", msg)
        self.assertIn("internal server exploded", msg)

    def test_unreachable_server_raises(self) -> None:
        err = urllib.error.URLError("connection refused")
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(llm.LLMError) as ctx:
                llm.chat([{"role": "user", "content": "hi"}], provider="ollama")
        self.assertIn("ollama", str(ctx.exception))

    def test_unparseable_json_raises(self) -> None:
        with mock.patch("urllib.request.urlopen", return_value=_FakeResp(b"this is not json")):
            with self.assertRaises(llm.LLMError):
                llm.chat([{"role": "user", "content": "hi"}], provider="ollama")


if __name__ == "__main__":
    unittest.main()
