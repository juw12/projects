"""Pegatron MAAS LLM client (OpenAI-compatible, stdlib only).

Uses :mod:`urllib.request` so the HTTP server itself stays stdlib-only; the
``requests`` dependency (required by the Docker image and the local venv) is
kept available for the rest of the codebase but is not used here.

The contract (see ``docs/photo2cad-spec.md``) is:

* ``available(cfg)`` -> True when a non-empty API key and base URL are set.
* ``chat(cfg, messages, model=None, temperature=0, timeout=120)`` -> the
  ``choices[0].message.content`` string. Non-2xx responses raise
  :class:`RuntimeError`.

When ``cfg.fake_llm`` is true, :func:`chat` short-circuits and returns a canned
CadQuery program so tests run offline.
"""
from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.request
from typing import Any

from config import Config


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
    """Return True when the LLM endpoint is wired up (key + base URL).

    ``fake_llm`` mode also counts as "available" because the server can still
    serve a synthetic CadQuery program without ever contacting the gateway.
    """
    return bool(cfg.fake_llm) or cfg.llm_configured


def chat(
    cfg: Config,
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0,
    timeout: int = 120,
) -> str:
    """POST ``messages`` to ``{base_url}/chat/completions`` and return content.

    Raises :class:`RuntimeError` on non-2xx or malformed responses. In
    ``fake_llm`` mode this returns a canned program immediately (model +
    temperature + timeout are ignored).
    """
    if cfg.fake_llm:
        return CANNED_PROGRAM

    if not cfg.llm_configured:
        raise RuntimeError(
            "MAAS LLM is not configured (set MAAS_API_KEY and "
            "MAAS_LLM_BASE_URL, or set PHOTO2CAD_FAKE_LLM=1 for offline tests)"
        )

    payload: dict[str, Any] = {
        "model": model or cfg.model,
        "messages": messages,
        "temperature": float(temperature),
    }
    body = json.dumps(payload).encode("utf-8")
    url = cfg.base_url.rstrip("/") + "/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.api_key,
        "Accept": "application/json",
    }
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")

    ctx = ssl.create_default_context()
    # The internal gateway uses a private CA; tests only ever exercise fake
    # mode but we keep this as a one-line knob if real calls need it.
    if str(cfg.base_url).startswith("https://aicc-gateway"):
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    deadline = time.time() + max(1, int(timeout))
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ctx) as resp:
            status = getattr(resp, "status", None) or 200
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if hasattr(exc, "read") else str(exc)
        raise RuntimeError("MAAS HTTP %s: %s" % (exc.code, body[:300])) from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("MAAS connection error: %s" % exc.reason) from exc
    except TimeoutError:
        raise RuntimeError("MAAS request timed out after %ss" % timeout)

    if status >= 300:
        raise RuntimeError("MAAS HTTP %s: %s" % (status, raw[:300]))

    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise RuntimeError("MAAS returned non-JSON response: %s" % raw[:200]) from exc

    try:
        return str(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("MAAS response missing choices[0].message.content: %r"
                           % raw[:200]) from exc


__all__ = ["available", "chat", "CANNED_PROGRAM"]
