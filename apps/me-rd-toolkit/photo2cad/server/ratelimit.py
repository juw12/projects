"""In-memory rate limiting + concurrency guard for the public demo (stdlib only).

Single-process and in-memory: good enough for a one-instance demo, **not** a
distributed limiter. Daily windows reset at 00:00 UTC. Every method is
thread-safe (the server uses a threading HTTP server).

Usage:
    limiter = RateLimiter(per_ip_per_day=3, global_per_day=200, max_concurrent=2)
    decision = limiter.begin(client_ip)      # reserve a slot
    if not decision.allowed: ...             # 429 with decision.retry_after
    try:
        ... do the work ...
    finally:
        limiter.end(generated=did_it_work)   # always release
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class Decision:
    """Result of a :meth:`RateLimiter.begin` call."""

    allowed: bool
    reason: str = ""          # "busy" | "global" | "per_ip" when denied
    retry_after: int = 0      # seconds hint for the Retry-After header


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _seconds_to_utc_midnight() -> int:
    now = datetime.now(timezone.utc)
    tomorrow = now.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return max(1, int((tomorrow - now).total_seconds()))


class RateLimiter:
    """Per-IP + global daily caps and a concurrency ceiling."""

    def __init__(self, per_ip_per_day: int = 0, global_per_day: int = 0,
                 max_concurrent: int = 0):
        self.per_ip_per_day = int(per_ip_per_day or 0)
        self.global_per_day = int(global_per_day or 0)
        self.max_concurrent = int(max_concurrent or 0)
        self._lock = threading.Lock()
        self._day = _today_utc()
        self._per_ip: dict[str, int] = {}
        self._global = 0
        self._active = 0
        self._generated_total = 0

    # -- internal (must hold the lock) -------------------------------------
    def _roll_if_new_day(self) -> None:
        today = _today_utc()
        if today != self._day:
            self._day = today
            self._per_ip.clear()
            self._global = 0

    # -- public API ---------------------------------------------------------
    def begin(self, ip: str) -> Decision:
        """Reserve a slot for ``ip``. Call :meth:`end` when the request finishes."""
        ip = ip or "unknown"
        with self._lock:
            self._roll_if_new_day()
            if self.max_concurrent and self._active >= self.max_concurrent:
                return Decision(False, "busy", retry_after=5)
            if self.global_per_day and self._global >= self.global_per_day:
                return Decision(False, "global", retry_after=_seconds_to_utc_midnight())
            used = self._per_ip.get(ip, 0)
            if self.per_ip_per_day and used >= self.per_ip_per_day:
                return Decision(False, "per_ip", retry_after=_seconds_to_utc_midnight())
            self._active += 1
            self._global += 1
            self._per_ip[ip] = used + 1
            return Decision(True)

    def end(self, generated: bool = False) -> None:
        """Release a reserved slot; ``generated`` records a successful build."""
        with self._lock:
            if self._active > 0:
                self._active -= 1
            if generated:
                self._generated_total += 1

    @property
    def generated_total(self) -> int:
        with self._lock:
            return self._generated_total

    def snapshot(self) -> dict:
        """Counters for ``/api/stats`` — no personal data, just aggregates."""
        with self._lock:
            self._roll_if_new_day()
            return {
                "day": self._day,
                "active": self._active,
                "global_today": self._global,
                "generated_total": self._generated_total,
                "per_ip_per_day": self.per_ip_per_day,
                "global_per_day": self.global_per_day,
                "max_concurrent": self.max_concurrent,
            }


__all__ = ["RateLimiter", "Decision"]
