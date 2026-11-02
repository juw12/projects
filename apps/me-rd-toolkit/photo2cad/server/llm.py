"""Provider-agnostic LLM client for photo2cad (stdlib only).

One small contract, many providers:

* ``available(cfg)`` -> True when the endpoint is usable.
* ``chat(cfg, messages, model=None, temperature=0, timeout=120)`` -> the
  assistant text (a string). Non-2xx responses raise :class:`RuntimeError`.

Messages are in the OpenAI *chat* shape (``role`` + ``content``, where
``content`` is a string or a list of ``{"type": "text"|"image_url"}`` blocks),
which is what :mod:`cadgen` builds. Most providers speak the OpenAI
``/chat/completions`` API; :mod:`anthropic` and Gemini are handled through the
same shape (Gemini via its OpenAI-compatible endpoint) with a small adapter for
Anthropic's native ``/v1/messages`` API.

The provider, base URL, key and model all come from :class:`config.Config`
(see ``docs/photo2cad-spec.md`` for the environment variables). ``maas``
remains one provider among many; :mod:`maas` is kept as a thin shim.

When ``cfg.fake_llm`` is true, :func:`chat` short-circuits and returns a canned
CadQuery program so tests run offline.
"""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any

from config import Config

# ---------------------------------------------------------------------------
# Provider families
# ---------------------------------------------------------------------------

#: Providers whose HTTP API is the OpenAI ``/chat/completions`` shape.
OPENAI_COMPATIBLE = {
    "maas",
    "openai",
    "openrouter",
    "groq",
    "gemini",
    "deepseek",
    "together",
    "ollama",
    "lmstudio",
    "custom",
}

#: Providers that need no API key (a local server on the user's machine).
NO_KEY_PROVIDERS = {"ollama", "lmstudio"}

#: Fixed Anthropic max output tokens (Anthropic requires this field).
ANTHROPIC_MAX_TOKENS = 4096
#: Anthropic API version header pinned to a known-good value.
ANTHROPIC_VERSION = "2023-06-01"


# ---------------------------------------------------------------------------
# Fake-mode canned program (must satisfy CADGEN_CONTRACT in docs)
# ---------------------------------------------------------------------------

CANNED_PROGRAM = (
    "import cadquery as cq\n"
    "L, W, H = 40.0, 30.0, 20.0\n"
    'SHAPE = cq.Workplane("XY").box(L, W, H).edges("|Z").fillet(3.0)\n'
)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def available(cfg: Config) -> bool:
    """Return True when the LLM endpoint is wired up.

    ``fake_llm`` mode also counts as "available" because the server can still
    serve a synthetic CadQuery program without contacting anyone.
    """
    return bool(cfg.fake_llm) or cfg.llm_configured


def chat(
    cfg: Config,
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0,
    timeout: int = 120,
) -> str:
    """Send ``messages`` to the configured provider and return the reply text.

    Raises :class:`RuntimeError` on a missing configuration, a non-2xx
    response, a connection failure or a malformed body. In ``fake_llm`` mode
    this returns a canned program immediately.
    """
    if cfg.fake_llm:
        return CANNED_PROGRAM

    if not cfg.llm_configured:
        raise RuntimeError(
            "LLM is not configured. Set a provider key and base URL, e.g. "
            "LLM_PROVIDER=ollama (free, local), or OPENAI_API_KEY / "
            "ANTHROPIC_API_KEY / MAAS_API_KEY, or set PHOTO2CAD_FAKE_LLM=1 "
            "for offline tests."
        )

    provider = (cfg.provider or "maas").strip().lower()
    if provider == "anthropic":
        return _chat_anthropic(cfg, messages, model, temperature, timeout)
    # Everything else speaks the OpenAI /chat/completions API.
    return _chat_openai(cfg, messages, model, temperature, timeout)


# ---------------------------------------------------------------------------
# OpenAI-compatible providers
# ---------------------------------------------------------------------------


def _openai_url(cfg: Config) -> str:
    return cfg.base_url.rstrip("/") + "/chat/completions"


def _openai_payload(cfg: Config, messages: list[dict],
                    model: str | None, temperature: float) -> dict:
    return {
        "model": model or cfg.model,
        "messages": messages,
        "temperature": float(temperature),
    }


def _chat_openai(cfg: Config, messages: list[dict], model: str | None,
                 temperature: float, timeout: int) -> str:
    payload = _openai_payload(cfg, messages, model, temperature)
    status, raw = _post_json(
        url=_openai_url(cfg),
        payload=payload,
        headers={"Authorization": "Bearer " + (cfg.api_key or "local")},
        base_url=cfg.base_url,
        timeout=timeout,
        provider=cfg.provider,
    )
    if status >= 300:
        raise RuntimeError("%s HTTP %s: %s" % (cfg.provider, status, raw[:300]))
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise RuntimeError("%s returned non-JSON response: %s"
                           % (cfg.provider, raw[:200])) from exc
    try:
        return str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("%s response missing choices[0].message.content: %r"
                           % (cfg.provider, raw[:200])) from exc


# ---------------------------------------------------------------------------
# Anthropic (native /v1/messages)
# ---------------------------------------------------------------------------


def _anthropic_url(cfg: Config) -> str:
    base = cfg.base_url.rstrip("/")
    # Accept either "https://api.anthropic.com" or a base that already ends
    # with "/v1".
    if base.endswith("/v1"):
        return base + "/messages"
    return base + "/v1/messages"


def _data_url_to_anthropic_block(url: str) -> dict | None:
    """Convert an OpenAI ``data:<mime>;base64,<data>`` URL to an Anthropic image block."""
    if not isinstance(url, str) or not url.startswith("data:"):
        return None
    try:
        head, data = url.split(",", 1)
    except ValueError:
        return None
    meta = head[len("data:"):]
    if "base64" not in meta:
        return None
    media_type = meta.split(";")[0] or "image/png"
    return {"type": "image", "source": {
        "type": "base64", "media_type": media_type, "data": data,
    }}


def _to_anthropic_messages(messages: list[dict]) -> tuple[str, list[dict]]:
    """Split OpenAI messages into (system_text, anthropic_messages)."""
    system_parts: list[str] = []
    out: list[dict] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        content = msg.get("content")
        if role == "system":
            if isinstance(content, str):
                system_parts.append(content)
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        system_parts.append(str(part.get("text", "")))
            continue
        if role not in ("user", "assistant"):
            continue

        blocks: list[dict] = []
        if isinstance(content, str):
            blocks.append({"type": "text", "text": content})
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    blocks.append({"type": "text", "text": str(part.get("text", ""))})
                elif part.get("type") == "image_url":
                    block = _data_url_to_anthropic_block(
                        (part.get("image_url") or {}).get("url", ""))
                    if block:
                        blocks.append(block)
        if blocks:
            out.append({"role": role, "content": blocks})
    return "\n".join(p for p in system_parts if p).strip(), out


def _anthropic_payload(cfg: Config, messages: list[dict],
                       model: str | None, temperature: float) -> dict:
    system, converted = _to_anthropic_messages(messages)
    payload: dict[str, Any] = {
        "model": model or cfg.model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "temperature": float(temperature),
        "messages": converted,
    }
    if system:
        payload["system"] = system
    return payload


def _chat_anthropic(cfg: Config, messages: list[dict], model: str | None,
                    temperature: float, timeout: int) -> str:
    payload = _anthropic_payload(cfg, messages, model, temperature)
    status, raw = _post_json(
        url=_anthropic_url(cfg),
        payload=payload,
        headers={
            "x-api-key": cfg.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
        },
        base_url=cfg.base_url,
        timeout=timeout,
        provider="anthropic",
    )
    if status >= 300:
        raise RuntimeError("anthropic HTTP %s: %s" % (status, raw[:300]))
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise RuntimeError("anthropic returned non-JSON response: %s"
                           % raw[:200]) from exc
    try:
        parts = data["content"]
        return "".join(str(p.get("text", "")) for p in parts
                       if isinstance(p, dict) and p.get("type") == "text")
    except (KeyError, TypeError) as exc:
        raise RuntimeError("anthropic response missing content blocks: %r"
                           % raw[:200]) from exc


# ---------------------------------------------------------------------------
# Shared HTTP POST (stdlib only)
# ---------------------------------------------------------------------------


def _post_json(url: str, payload: dict, headers: dict, base_url: str,
               timeout: int, provider: str) -> tuple[int, str]:
    """POST ``payload`` as JSON; return (status, body_text). Raises on transport errors."""
    body = json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json",
                       "Accept": "application/json"}
    request_headers.update({k: v for k, v in headers.items() if v})
    request = urllib.request.Request(url, data=body, headers=request_headers,
                                     method="POST")

    ctx = ssl.create_default_context()
    # The Pegatron gateway uses a private CA; keep the one-line knob for it.
    if str(base_url).startswith("https://aicc-gateway"):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    # Local Ollama / LM Studio often expose plain HTTP on loopback.
    if str(base_url).startswith("http://"):
        ctx = None  # type: ignore[assignment]

    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ctx) as resp:
            status = getattr(resp, "status", None) or 200
            raw = resp.read().decode("utf-8", errors="replace")
            return int(status), raw
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else str(exc)
        raise RuntimeError("%s HTTP %s: %s" % (provider, exc.code, detail[:300])) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("%s connection error: %s" % (provider, exc.reason)) from exc
    except TimeoutError:
        raise RuntimeError("%s request timed out after %ss" % (provider, timeout))


__all__ = [
    "available",
    "chat",
    "CANNED_PROGRAM",
    "OPENAI_COMPATIBLE",
    "NO_KEY_PROVIDERS",
]
