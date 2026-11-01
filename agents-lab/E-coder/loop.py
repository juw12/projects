"""
E — E-coder agent loop (M1): a minimal ReAct loop.

`run_agent` sends the task to the model, and as long as the model asks for a tool
call it runs that tool (read-only, confined to `root`) and feeds the result back.
It stops when the model answers in plain text (no tool calls) or when `max_steps`
is reached.

The loop threads *provider-native* messages: the assistant turn and the tool
results are appended in the exact shape each provider expects (Ollama vs
OpenAI), so the conversation stays valid across turns.

Stdlib only. A tool failure (ToolError) is caught and fed back to the model as a
tool-result string — it never crashes the loop.
"""
from __future__ import annotations

import json
import os
from typing import Callable

import llm
from prompt import SYSTEM_PROMPT
from tools import TOOL_SCHEMAS, ToolError, dispatch

# on_step is an optional callback for tracing: on_step({"step": n, ...}).
StepCallback = Callable[[dict], None]


def run_agent(
    task: str,
    root: str,
    *,
    max_steps: int = 12,
    provider: str | None = None,
    model: str | None = None,
    on_step: StepCallback | None = None,
) -> str:
    """Run the read-only agent on `task` within repo `root`; return the final text.

    Stops early when the model answers without a tool call, or returns a clear
    "[stopped after N steps ...]" message if `max_steps` is hit first.
    """
    prov = (provider or os.environ.get("ECODER_PROVIDER", "ollama")).lower()
    root = os.path.realpath(root)
    messages: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": task},
    ]

    for step in range(1, max_steps + 1):
        reply = llm.chat(messages, tools=TOOL_SCHEMAS, provider=provider, model=model)

        # Model is done: it answered in plain text with no tool call.
        if not reply.tool_calls:
            if on_step:
                on_step({"step": step, "final": True, "text": reply.text})
            return reply.text

        # Append the assistant turn in the provider's native shape.
        messages.append(_assistant_message(reply, prov))

        # Run each requested tool and append a provider-native tool-result message.
        executed: list[dict] = []
        for tc in reply.tool_calls:
            result = _run_tool(tc, root)
            executed.append({"name": tc.name, "arguments": tc.arguments, "result": result})
            if prov == "openai":
                # OpenAI requires the tool_call_id to match the assistant's call.
                messages.append({"role": "tool", "tool_call_id": tc.id or "", "content": result})
            else:
                # Ollama uses a plain "tool" role message with just the content.
                messages.append({"role": "tool", "content": result})

        if on_step:
            on_step({"step": step, "tool_calls": executed})

    return f"[stopped after {max_steps} steps without a final answer]"


# --- Helpers ------------------------------------------------------------------
def _run_tool(tc: llm.ToolCall, root: str) -> str:
    """Dispatch one tool call, converting any failure into a feed-back string.

    A ToolError becomes "error: ..."; any other exception is caught too so a tool
    bug can never crash the loop.
    """
    try:
        return dispatch(tc.name, tc.arguments, root)
    except ToolError as e:
        return f"error: {e}"
    except Exception as e:  # noqa: BLE001 — last-resort guard: never crash the loop
        return f"error: unexpected {type(e).__name__}: {e}"


def _assistant_message(reply: llm.Reply, prov: str) -> dict:
    """Build the provider-native assistant message to append to the conversation.

    Prefers the model's own message from `reply.raw` (Ollama: raw["message"],
    OpenAI: raw["choices"][0]["message"]). If that is missing (defensive), it
    rebuilds a valid message from the normalized `Reply`.
    """
    raw = reply.raw or {}
    if prov == "openai":
        msg = (raw.get("choices") or [{}])[0].get("message")
        if isinstance(msg, dict):
            return msg
    else:
        msg = raw.get("message")
        if isinstance(msg, dict):
            return msg

    # Fallback: rebuild from the normalized reply, provider-corrected.
    msg = {"role": "assistant", "content": reply.text or ""}
    if reply.tool_calls:
        if prov == "openai":
            msg["tool_calls"] = [
                {"id": tc.id or "", "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)}}
                for tc in reply.tool_calls
            ]
        else:
            msg["tool_calls"] = [
                {"id": tc.id, "function": {"name": tc.name, "arguments": tc.arguments}}
                for tc in reply.tool_calls
            ]
    return msg
