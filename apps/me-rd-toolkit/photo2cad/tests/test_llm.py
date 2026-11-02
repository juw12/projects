#!/usr/bin/env python3
"""Hermetic tests for the provider-agnostic LLM layer (no network, stdlib only).

Covers environment/provider resolution in :mod:`config` and the message
adapters used by :func:`llm.chat` (OpenAI payload + Anthropic conversion).
Nothing here touches the network or cadquery.

Run with any Python 3.10+:
    python tests/test_llm.py
Exits 0 on success, 1 on failure.
"""
import os
import pathlib
import sys

APP = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "server"))

import config  # noqa: E402
import llm  # noqa: E402

_PREFIXES = ("LLM_", "MAAS_", "GATEWAY_", "OPENAI_", "ANTHROPIC_", "PHOTO2CAD_")


def _cfg(env_extra):
    """Build a Config under a controlled environment, then restore it."""
    saved = dict(os.environ)
    for key in list(os.environ):
        if key.startswith(_PREFIXES):
            del os.environ[key]
    os.environ.update({k: v for k, v in env_extra.items() if v is not None})
    os.environ.setdefault("PHOTO2CAD_ARTIFACTS", str(APP / ".artifacts"))
    try:
        return config.load_config()
    finally:
        os.environ.clear()
        os.environ.update(saved)


def main():
    # 1. No keys -> maas, unconfigured (backward compatible with the old build).
    cfg = _cfg({})
    assert cfg.provider == "maas", cfg.provider
    assert cfg.llm_configured is False, "default must read as not configured"
    assert cfg.base_url == config.DEFAULT_BASE_URL

    # 2. Legacy MAAS key -> maas, configured.
    cfg = _cfg({"MAAS_API_KEY": "k"})
    assert cfg.provider == "maas" and cfg.llm_configured is True

    # 3. Explicit local provider -> no key needed, configured, loopback base.
    cfg = _cfg({"LLM_PROVIDER": "ollama"})
    assert cfg.provider == "ollama" and cfg.llm_configured is True
    assert cfg.base_url.startswith("http://127.0.0.1"), cfg.base_url
    cfg = _cfg({"LLM_PROVIDER": "lmstudio"})
    assert cfg.llm_configured is True

    # 4. OPENAI_API_KEY is inferred as the openai provider.
    cfg = _cfg({"OPENAI_API_KEY": "sk-x"})
    assert cfg.provider == "openai" and cfg.llm_configured is True
    assert "api.openai.com" in cfg.base_url

    # 5. Explicit provider + key; Anthropic endpoint is /v1/messages.
    cfg = _cfg({"LLM_PROVIDER": "anthropic", "LLM_API_KEY": "a"})
    assert cfg.provider == "anthropic"
    assert llm._anthropic_url(cfg).endswith("/v1/messages"), llm._anthropic_url(cfg)

    # 6. custom provider with an explicit base URL.
    cfg = _cfg({"LLM_PROVIDER": "custom",
                "LLM_BASE_URL": "https://example.test/v1",
                "LLM_API_KEY": "z"})
    assert cfg.base_url == "https://example.test/v1"
    assert llm._openai_url(cfg) == "https://example.test/v1/chat/completions"

    # 7. Generic LLM_* names win over legacy names.
    cfg = _cfg({"LLM_PROVIDER": "openai", "LLM_MODEL": "gpt-4o-mini",
                "LLM_BASE_URL": "https://x/v1", "LLM_API_KEY": "k"})
    assert cfg.model == "gpt-4o-mini" and cfg.base_url == "https://x/v1"

    # 8. fake mode: available() True and chat() returns the canned program.
    cfg = _cfg({"PHOTO2CAD_FAKE_LLM": "1"})
    assert llm.available(cfg) is True
    assert llm.chat(cfg, [{"role": "user", "content": "hi"}]) == llm.CANNED_PROGRAM

    # 9. unconfigured chat() fails loudly with a helpful message.
    cfg = _cfg({})
    try:
        llm.chat(cfg, [{"role": "user", "content": "hi"}])
        raise AssertionError("expected RuntimeError when unconfigured")
    except RuntimeError as exc:
        assert "not configured" in str(exc), str(exc)

    # 10. Anthropic conversion: system is split out; text + image become blocks.
    messages = [
        {"role": "system", "content": "SYS"},
        {"role": "user", "content": [
            {"type": "text", "text": "hello"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
        ]},
    ]
    system, converted = llm._to_anthropic_messages(messages)
    assert system == "SYS", system
    assert converted[0]["role"] == "user"
    blocks = converted[0]["content"]
    assert blocks[0] == {"type": "text", "text": "hello"}
    assert blocks[1]["type"] == "image"
    assert blocks[1]["source"]["media_type"] == "image/png"
    assert blocks[1]["source"]["data"] == "AAAA"

    # 11. Anthropic payload includes the required max_tokens and converted content.
    cfg = _cfg({"LLM_PROVIDER": "anthropic", "LLM_API_KEY": "a"})
    payload = llm._anthropic_payload(cfg, [{"role": "user", "content": "hi"}], None, 0)
    assert payload["max_tokens"] == llm.ANTHROPIC_MAX_TOKENS
    assert payload["messages"][0]["content"][0]["text"] == "hi"

    # 12. OpenAI payload shape (model + temperature).
    cfg = _cfg({"LLM_PROVIDER": "openai", "LLM_API_KEY": "k", "LLM_MODEL": "gpt-4o-mini"})
    payload = llm._openai_payload(cfg, [{"role": "user", "content": "hi"}], None, 0.2)
    assert payload["model"] == "gpt-4o-mini" and payload["temperature"] == 0.2

    print("PASS test_llm (12 checks, providers=%s)" % len(config.PROVIDER_DEFAULTS))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - test harness
        print("FAIL test_llm:", exc)
        sys.exit(1)
