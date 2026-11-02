"""Environment / configuration resolution for the photo2cad backend.

Stdlib-only. Loaded once at process start by ``server.py`` and ``pipeline.py``.

The LLM **provider**, endpoint, key and model are resolved from environment
variables: generic ``LLM_*`` names first, then the legacy Pegatron ``MAAS_*``
names, then a per-provider default (see :data:`PROVIDER_DEFAULTS`). The
CadQuery sandbox timeout and the on-disk artifact root are unchanged. Full
list of variables: ``docs/photo2cad-spec.md``.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants (documented defaults)
# ---------------------------------------------------------------------------

#: Legacy Pegatron AICC MAAS gateway — the default base URL for the ``maas`` provider.
DEFAULT_BASE_URL = "https://aicc-gateway.pegatroncorp.com/maas/api/v1/llm/v1"
#: Default chat model id for the ``maas`` provider.
DEFAULT_MODEL = "gpt-4o"
#: Hard-coded per-app sandbox child-process timeout in seconds.
DEFAULT_SANDBOX_TIMEOUT = 120
#: Maximum number of reference images accepted in a single request.
DEFAULT_MAX_IMAGES = 6
#: Default units for parametric geometry.
DEFAULT_UNITS = "mm"
#: Path-traversal-safe artifact filename allow-list.
ALLOWED_ARTIFACT_NAMES = {"model.stp", "model.stl", "program.py", "report.json"}

#: Provider -> (default base URL, default model).
#: All but ``anthropic`` speak the OpenAI ``/chat/completions`` API; the
#: ``anthropic`` adapter is implemented in :mod:`llm`. Any OpenAI-compatible
#: base URL can be used through the ``custom`` provider.
PROVIDER_DEFAULTS: dict[str, tuple[str, str]] = {
    "maas": (DEFAULT_BASE_URL, DEFAULT_MODEL),
    "openai": ("https://api.openai.com/v1", "gpt-4o"),
    "anthropic": ("https://api.anthropic.com", "claude-sonnet-4-5"),
    "openrouter": ("https://openrouter.ai/api/v1", "openai/gpt-4o-mini"),
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
    "gemini": ("https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
    "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat"),
    "together": ("https://api.together.xyz/v1", "meta-llama/Llama-3.3-70B-Instruct-Turbo"),
    "ollama": ("http://127.0.0.1:11434/v1", "qwen2.5:7b"),
    "lmstudio": ("http://127.0.0.1:1234/v1", "local-model"),
    "custom": ("", ""),
}

#: Providers that need no API key (a local server on the user's own machine).
NO_KEY_PROVIDERS = {"ollama", "lmstudio"}


def _truthy(value: str | None) -> bool:
    """Parse ``"1"`` / ``"true"`` / ``"yes"`` / ``"on"`` as truthy (case-insensitive)."""
    if value is None:
        return False
    return value.strip().lower() in ("1", "true", "yes", "on")


def _int(value: str | None, default: int = 0) -> int:
    """Parse a non-negative integer env value; fall back to ``default``."""
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed >= 0 else default


def _first(env, *names: str) -> str:
    """Return the first non-empty, stripped environment value among ``names``."""
    for name in names:
        value = env.get(name)
        if value and value.strip():
            return value.strip()
    return ""


def _app_root() -> Path:
    """Root of the photo2cad app (one level above ``server/``)."""
    return Path(__file__).resolve().parent.parent


def default_artifacts_root() -> Path:
    """Resolve the default on-disk artifact root (git-ignored)."""
    env = os.environ.get("PHOTO2CAD_ARTIFACTS")
    if env:
        return Path(env).expanduser().resolve()
    return (_app_root() / ".artifacts").resolve()


def _resolve_provider(env) -> str:
    """Pick the provider: explicit ``LLM_PROVIDER``, else infer, else ``maas``.

    Inference keeps the legacy behaviour: a Pegatron key means ``maas``. With
    no keys at all the result is ``maas`` (which then reads as *not
    configured*, exactly as before) rather than silently pointing at a local
    model the user may not be running.
    """
    explicit = (env.get("LLM_PROVIDER") or "").strip().lower()
    if explicit:
        return explicit
    if env.get("MAAS_API_KEY") or env.get("GATEWAY_API_KEY"):
        return "maas"
    if env.get("OPENAI_API_KEY"):
        return "openai"
    if env.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "maas"


# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Config:
    """Resolved, immutable runtime configuration."""

    provider: str
    api_key: str
    base_url: str
    model: str
    use_vision: bool
    fake_llm: bool
    sandbox_timeout: int
    max_images: int
    artifacts_root: Path
    demo: bool
    disable_generate: bool
    rate_limit_per_ip: int
    rate_limit_global: int
    max_concurrent: int

    @property
    def llm_configured(self) -> bool:
        """True when the endpoint is actually usable.

        Local providers (Ollama / LM Studio) need no key; everything else needs
        a non-empty key and a base URL.
        """
        if not self.base_url:
            return False
        if self.provider in NO_KEY_PROVIDERS:
            return True
        return bool(self.api_key)


def load_config() -> Config:
    """Build a :class:`Config` from environment variables.

    Resolution order per field:

    * provider — ``LLM_PROVIDER``; else inferred (see :func:`_resolve_provider`).
    * base URL — ``LLM_BASE_URL``, ``MAAS_LLM_BASE_URL``, else provider default.
    * model    — ``LLM_MODEL``, ``MAAS_LLM_MODEL``, else provider default.
    * key      — ``LLM_API_KEY``, ``MAAS_API_KEY``, ``GATEWAY_API_KEY``,
                 ``OPENAI_API_KEY``, ``ANTHROPIC_API_KEY``.
    * ``PHOTO2CAD_FAKE_LLM`` (``"1"`` -> canned program, no network).
    * ``PHOTO2CAD_SANDBOX_TIMEOUT`` (default :data:`DEFAULT_SANDBOX_TIMEOUT`).
    * ``PHOTO2CAD_ARTIFACTS`` (default :func:`default_artifacts_root`).
    """
    env = os.environ
    provider = _resolve_provider(env)
    default_base, default_model = PROVIDER_DEFAULTS.get(provider, ("", ""))

    base_url = _first(env, "LLM_BASE_URL", "MAAS_LLM_BASE_URL") or default_base
    model = _first(env, "LLM_MODEL", "MAAS_LLM_MODEL") or default_model
    api_key = _first(
        env,
        "LLM_API_KEY",
        "MAAS_API_KEY",
        "GATEWAY_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
    )

    fake_llm = _truthy(env.get("PHOTO2CAD_FAKE_LLM"))
    try:
        timeout = int(env.get("PHOTO2CAD_SANDBOX_TIMEOUT", str(DEFAULT_SANDBOX_TIMEOUT)))
        if timeout <= 0:
            timeout = DEFAULT_SANDBOX_TIMEOUT
    except ValueError:
        timeout = DEFAULT_SANDBOX_TIMEOUT

    artifacts_root = default_artifacts_root()
    artifacts_root.mkdir(parents=True, exist_ok=True)

    demo = _truthy(env.get("PHOTO2CAD_DEMO"))
    disable_generate = _truthy(env.get("PHOTO2CAD_DISABLE_GENERATE"))
    rate_limit_per_ip = _int(env.get("PHOTO2CAD_RATE_LIMIT_PER_IP"), 0)
    rate_limit_global = _int(env.get("PHOTO2CAD_RATE_LIMIT_GLOBAL"), 0)
    max_concurrent = _int(env.get("PHOTO2CAD_MAX_CONCURRENT"), 0)
    if demo:
        rate_limit_per_ip = rate_limit_per_ip or 3
        rate_limit_global = rate_limit_global or 200
        max_concurrent = max_concurrent or 2

    return Config(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model,
        use_vision=not _truthy(env.get("PHOTO2CAD_NO_VISION")),
        fake_llm=fake_llm,
        sandbox_timeout=timeout,
        max_images=DEFAULT_MAX_IMAGES,
        artifacts_root=artifacts_root,
        demo=demo,
        disable_generate=disable_generate,
        rate_limit_per_ip=rate_limit_per_ip,
        rate_limit_global=rate_limit_global,
        max_concurrent=max_concurrent,
    )


__all__ = [
    "Config",
    "load_config",
    "default_artifacts_root",
    "PROVIDER_DEFAULTS",
    "NO_KEY_PROVIDERS",
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "DEFAULT_SANDBOX_TIMEOUT",
    "DEFAULT_MAX_IMAGES",
    "DEFAULT_UNITS",
    "ALLOWED_ARTIFACT_NAMES",
]
