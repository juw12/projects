"""Environment / configuration resolution for the photo2cad backend.

Stdlib-only. Loaded once at process start by ``server.py`` and ``pipeline.py``.
The MAAS LLM endpoint, the CadQuery sandbox timeout and the on-disk artifact
root all come from environment variables (see ``docs/photo2cad-spec.md``).
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Constants (documented defaults)
# ---------------------------------------------------------------------------

#: Default LLM base URL. Matches the Pegatron AICC MAAS gateway.
DEFAULT_BASE_URL = "https://aicc-gateway.pegatroncorp.com/maas/api/v1/llm/v1"
#: Default chat model id (overridable per request via the ``model`` field).
DEFAULT_MODEL = "gpt-4o"
#: Hard-coded per-app sandbox child-process timeout in seconds.
DEFAULT_SANDBOX_TIMEOUT = 120
#: Maximum number of reference images accepted in a single request.
DEFAULT_MAX_IMAGES = 6
#: Default units for parametric geometry.
DEFAULT_UNITS = "mm"
#: Path-traversal-safe artifact filename allow-list.
ALLOWED_ARTIFACT_NAMES = {"model.stp", "model.stl", "program.py", "report.json"}


def _truthy(value: str | None) -> bool:
    """Parse ``"1"`` / ``"true"`` / ``"yes"`` as truthy (case-insensitive)."""
    if value is None:
        return False
    return value.strip().lower() in ("1", "true", "yes", "on")


def _app_root() -> Path:
    """Root of the photo2cad app (one level above ``server/``)."""
    return Path(__file__).resolve().parent.parent


def default_artifacts_root() -> Path:
    """Resolve the default on-disk artifact root (git-ignored)."""
    env = os.environ.get("PHOTO2CAD_ARTIFACTS")
    if env:
        return Path(env).expanduser().resolve()
    return (_app_root() / ".artifacts").resolve()


# ---------------------------------------------------------------------------
# Config dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Config:
    """Resolved, immutable runtime configuration."""

    api_key: str
    base_url: str
    model: str
    use_vision: bool
    fake_llm: bool
    sandbox_timeout: int
    max_images: int
    artifacts_root: Path

    @property
    def llm_configured(self) -> bool:
        """True when the LLM endpoint is actually usable (key + base URL)."""
        return bool(self.api_key) and bool(self.base_url)


def load_config() -> Config:
    """Build a :class:`Config` from environment variables.

    Order of discovery matches the spec:

    * ``MAAS_API_KEY`` (fallback ``GATEWAY_API_KEY``).
    * ``MAAS_LLM_BASE_URL`` (default :data:`DEFAULT_BASE_URL`).
    * ``MAAS_LLM_MODEL`` (default :data:`DEFAULT_MODEL`).
    * ``PHOTO2CAD_FAKE_LLM`` (``"1"`` -> canned program, no network).
    * ``PHOTO2CAD_SANDBOX_TIMEOUT`` (default :data:`DEFAULT_SANDBOX_TIMEOUT`).
    * ``PHOTO2CAD_ARTIFACTS`` (default :func:`default_artifacts_root`).
    """
    api_key = (
        os.environ.get("MAAS_API_KEY")
        or os.environ.get("GATEWAY_API_KEY")
        or ""
    ).strip()
    base_url = os.environ.get("MAAS_LLM_BASE_URL", DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    model = os.environ.get("MAAS_LLM_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    fake_llm = _truthy(os.environ.get("PHOTO2CAD_FAKE_LLM"))
    try:
        timeout = int(os.environ.get("PHOTO2CAD_SANDBOX_TIMEOUT", str(DEFAULT_SANDBOX_TIMEOUT)))
        if timeout <= 0:
            timeout = DEFAULT_SANDBOX_TIMEOUT
    except ValueError:
        timeout = DEFAULT_SANDBOX_TIMEOUT

    artifacts_root = default_artifacts_root()
    artifacts_root.mkdir(parents=True, exist_ok=True)

    return Config(
        api_key=api_key,
        base_url=base_url,
        model=model,
        use_vision=not _truthy(os.environ.get("PHOTO2CAD_NO_VISION")),
        fake_llm=fake_llm,
        sandbox_timeout=timeout,
        max_images=DEFAULT_MAX_IMAGES,
        artifacts_root=artifacts_root,
    )


__all__ = [
    "Config",
    "load_config",
    "default_artifacts_root",
    "DEFAULT_BASE_URL",
    "DEFAULT_MODEL",
    "DEFAULT_SANDBOX_TIMEOUT",
    "DEFAULT_MAX_IMAGES",
    "DEFAULT_UNITS",
    "ALLOWED_ARTIFACT_NAMES",
]
