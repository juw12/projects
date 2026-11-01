"""Date / time / OT validation helpers for PTB RDME Widget.

Pure stdlib, no import-time side effects. Safe to import anywhere.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Optional

_WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def parse_iso(s: str) -> Optional[dt.date]:
    try:
        return dt.date.fromisoformat(s)
    except Exception:
        return None


def hours_between(start: str, end: str) -> float:
    """Return hours between HH:MM strings. Handles overnight (end < start → +24h)."""
    s = _to_minutes(start)
    e = _to_minutes(end)
    if s is None or e is None:
        raise ValueError(f"bad time format: {start!r} / {end!r}")
    if e < s:
        e += 24 * 60
    return round((e - s) / 60.0, 2)


def _to_minutes(t: str) -> Optional[int]:
    m = re.match(r"^(\d{1,2}):(\d{2})$", (t or "").strip())
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def is_weekday(d: dt.date) -> bool:
    return d.weekday() < 5


def get_today_local() -> dt.date:
    return dt.date.today()


def day_of_week_label(d: dt.date) -> str:
    return _WEEKDAY_LABELS[d.weekday()]


def week_range(d: dt.date) -> tuple[dt.date, dt.date]:
    start = d - dt.timedelta(days=d.weekday())
    return start, start + dt.timedelta(days=6)


def month_bounds(d: dt.date) -> tuple[dt.date, dt.date]:
    start = d.replace(day=1)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1, day=1) - dt.timedelta(days=1)
    else:
        end = start.replace(month=start.month + 1, day=1) - dt.timedelta(days=1)
    return start, end


def payroll_close_date(d: dt.date) -> dt.date:
    """PTB payroll closes on the 5th of the month following. Approximate: 25th of current month."""
    return d.replace(day=25)


def is_period_closed(d: dt.date) -> bool:
    """True if the OT period for date `d` is already closed for payroll."""
    return d < payroll_close_date(get_today_local())


def period_status(d: dt.date) -> str:
    if is_period_closed(d):
        return "closed"
    today = get_today_local()
    if d < today:
        return "pending-export"
    if d == today:
        return "open-today"
    return "future"
