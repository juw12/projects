"""
E — stdlib-only coding agent (M0: the model adapter).

One public entry point, `chat()`, that talks to an LLM over HTTP using only the
Python standard library and normalizes two backends into a single `Reply` shape:

    provider="ollama"  -> POST {OLLAMA_HOST}/api/chat        (Ollama native API)
    provider="openai"  -> POST {base_url}/chat/completions   (OpenAI-compatible)

Why stdlib only? E-coder is track E of agents-lab, and the monorepo principle is
"no third-party dependencies" — nothing to `pip install`. `urllib.request` covers
a plain JSON POST, and we deliberately ship non-streaming only (streaming over raw
`urllib` is fiddly and is a later concern).

Config (priority: explicit kwarg > env var > default):
    ECODER_PROVIDER   default "ollama"        ("ollama" or "openai")
    ECODER_MODEL      default "qwen3:8b"
    OLLAMA_HOST       default "http://127.0.0.1:11434"   (provider=ollama)
    ECODER_BASE_URL   default (required)         (provider=openai)
    ECODER_API_KEY    default (optional)         (provider=openai, sent as Bearer)

Run the echo REPL (needs a reachable model server):
    python llm.py
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

# --- Config -------------------------------------------------------------------
# Defaults mirror the config table in docs/PLAN.md. The only overridable-by-
# kwarg values are `provider` and `model`; base URLs and the API key come from
# the environment.
_DEFAULTS = {
    "provider": "ollama",
    "model": "qwen3:8b",
    "ollama_host": "http://127.0.0.1:11434",
}


class LLMError(Exception):
    """Raised on any failure: network, HTTP != 200, or unparseable JSON.

    The message names the provider, the URL, the status code (if any), and the
    first ~500 chars of the response body — helpful, not generic.
    """


# --- Dataclasses --------------------------------------------------------------
@dataclass
class ToolCall:
    """A single tool call requested by the model (normalized across providers)."""

    name: str
    arguments: dict
    id: str | None = None


@dataclass
class Reply:
    """The normalized result of one model call."""

    text: str
    tool_calls: list[ToolCall]
    raw: dict


# --- Public entry point -------------------------------------------------------
def chat(
    messages: list[dict],
    tools: list[dict] | None = None,
    *,
    provider: str | None = None,
    model: str | None = None,
    timeout: float = 120.0,
    **opts: Any,
) -> Reply:
    """Send `messages` to an LLM and return a normalized `Reply`.

    `messages` is a list of `{"role": ..., "content": ...}` dicts (the same
    shape both providers accept). `tools`, when given, is passed through to the
    provider verbatim (M0 has no agent loop, so this is mostly for completeness).
    """
    prov = (provider or os.environ.get("ECODER_PROVIDER", _DEFAULTS["provider"])).lower()
    mdl = model or os.environ.get("ECODER_MODEL", _DEFAULTS["model"])

    if prov == "ollama":
        host = (opts.get("ollama_host") or os.environ.get("OLLAMA_HOST", _DEFAULTS["ollama_host"])).rstrip("/")
        url = f"{host}/api/chat"
        payload: dict[str, Any] = {"model": mdl, "messages": messages, "stream": False}
        if tools:
            payload["tools"] = tools
        headers = {"Content-Type": "application/json"}
        parser = _parse_ollama

    elif prov == "openai":
        base = os.environ.get("ECODER_BASE_URL", "").rstrip("/")
        if not base:
            raise LLMError(
                "[openai] ECODER_BASE_URL is not set. "
                "Point it at an OpenAI-compatible base, e.g. https://api.example.com/v1"
            )
        url = f"{base}/chat/completions"
        payload = {"model": mdl, "messages": messages}
        if tools:
            payload["tools"] = tools
        headers = {"Content-Type": "application/json"}
        api_key = os.environ.get("ECODER_API_KEY")
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        parser = _parse_openai

    else:
        raise LLMError(f"unknown provider {prov!r} (expected 'ollama' or 'openai')")

    body = _post_json(url, payload, headers, timeout, prov)
    data = _load_json(body, url, prov)
    return parser(data)


# --- HTTP + parsing helpers ---------------------------------------------------
def _post_json(url: str, payload: dict, headers: dict, timeout: float, provider: str) -> bytes:
    """POST `payload` as JSON and return the raw response body bytes.

    Any network/HTTP failure becomes an `LLMError` with a descriptive message.
    """
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        # urlopen raises HTTPError for non-2xx; e.code is the status, e.read() the body.
        body = e.read()
        raise LLMError(_err_msg(provider, url, e.code, body, "HTTP error")) from e
    except urllib.error.URLError as e:
        raise LLMError(_err_msg(provider, url, None, b"", f"network error: {e.reason}")) from e
    except OSError as e:
        # Raw socket-level failure (e.g. a connection timeout not wrapped above).
        raise LLMError(_err_msg(provider, url, None, b"", f"connection error: {e}")) from e


def _load_json(body: bytes, url: str, provider: str) -> dict:
    """Parse the response body as JSON, raising LLMError if it is not valid."""
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError) as e:
        raise LLMError(_err_msg(provider, url, None, body, f"unparseable JSON: {e}")) from e


def _err_msg(provider: str, url: str, status: int | None, body: bytes, detail: str) -> str:
    """Build a helpful LLMError message: provider, URL, status, body snippet."""
    status_s = f"status={status}" if status is not None else "status=?"
    snippet = body.decode("utf-8", "replace")[:500] if body else ""
    msg = f"[{provider}] {url} {status_s} {detail}"
    if snippet:
        msg += f"\n  body: {snippet}"
    return msg


# --- Response normalizers -----------------------------------------------------
def _parse_ollama(data: dict) -> Reply:
    """Ollama: text at data["message"]["content"]; tool calls carry a dict args."""
    message = data.get("message") or {}
    text = message.get("content") or ""
    tool_calls = [
        ToolCall(
            name=(tc.get("function") or {}).get("name", ""),
            arguments=_as_dict((tc.get("function") or {}).get("arguments")),
            id=tc.get("id"),
        )
        for tc in (message.get("tool_calls") or [])
    ]
    return Reply(text=text, tool_calls=tool_calls, raw=data)


def _parse_openai(data: dict) -> Reply:
    """OpenAI: text at choices[0].message.content; tool args are a JSON string."""
    choices = data.get("choices") or [{}]
    message = (choices[0] or {}).get("message") or {}
    text = message.get("content") or ""
    tool_calls = [
        ToolCall(
            name=(tc.get("function") or {}).get("name", ""),
            arguments=_json_str_to_dict((tc.get("function") or {}).get("arguments")),
            id=tc.get("id"),
        )
        for tc in (message.get("tool_calls") or [])
    ]
    return Reply(text=text, tool_calls=tool_calls, raw=data)


def _as_dict(value: Any) -> dict:
    """Coerce an Ollama tool-call argument value to a dict (already a dict normally)."""
    return value if isinstance(value, dict) else {}


def _json_str_to_dict(value: Any) -> dict:
    """Parse an OpenAI tool-call argument JSON string into a dict.

    OpenAI sends `arguments` as a *string* of JSON. Guard against malformed JSON
    (or an empty string) by falling back to an empty dict rather than crashing.
    """
    if isinstance(value, dict):  # already parsed (defensive)
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except (ValueError, UnicodeDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


# --- Echo REPL ----------------------------------------------------------------
def main() -> None:
    """Minimal echo REPL: read a line, send it as a user message, print the reply.

    Degrades gracefully: if the model server is unreachable it prints the
    LLMError and keeps going instead of crashing.
    """
    provider = os.environ.get("ECODER_PROVIDER", _DEFAULTS["provider"])
    model = os.environ.get("ECODER_MODEL", _DEFAULTS["model"])
    print(f"E-coder M0 echo REPL  (provider={provider}, model={model})")
    print("Type a line to send as a user message. 'exit' or 'quit' to stop.")
    while True:
        try:
            line = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not line:
            continue
        if line.lower() in {"exit", "quit"}:
            break
        try:
            reply = chat([{"role": "user", "content": line}])
        except LLMError as e:
            print(f"[error] {e}")
            continue
        print(f"agent> {reply.text}")
        for tc in reply.tool_calls:
            print(f"  [tool] {tc.name}({tc.arguments})")


if __name__ == "__main__":
    main()
