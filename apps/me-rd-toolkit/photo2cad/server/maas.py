"""Backward-compatibility shim.

The LLM client is now **provider-agnostic** and lives in :mod:`llm`. This module
is kept only so existing imports (``import maas``) and the legacy ``maas``
provider name keep working; new code should import :mod:`llm` directly.
"""
from __future__ import annotations

from llm import CANNED_PROGRAM, available, chat

__all__ = ["available", "chat", "CANNED_PROGRAM"]
