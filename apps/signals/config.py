"""Manual .env loader — avoids python-dotenv dependency."""
from __future__ import annotations

import os
from pathlib import Path


def _parse_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def load_env(path: str | Path = ".env") -> None:
    env_path = Path(path)
    if not env_path.exists():
        example = Path(str(path) + ".example")
        if example.exists():
            env_path = example
    parsed = _parse_env(env_path)
    for key, value in parsed.items():
        os.environ.setdefault(key, value)


def get(key: str, default: str | None = None) -> str:
    val = os.environ.get(key, default)
    if val is None:
        return ""
    return val


def get_list(key: str, default: list[str] | None = None) -> list[str]:
    raw = get(key, "")
    if not raw:
        return list(default or [])
    return [s.strip().upper() for s in raw.split(",") if s.strip()]


def get_int(key: str, default: int) -> int:
    try:
        return int(get(key, str(default)))
    except ValueError:
        return default


def get_float(key: str, default: float) -> float:
    try:
        return float(get(key, str(default)))
    except ValueError:
        return default
