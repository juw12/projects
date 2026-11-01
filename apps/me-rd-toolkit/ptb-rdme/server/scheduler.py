"""Background scheduler — runs once on app start, fires Teams reminders
at 14:00 and 15:00 to colleagues who have not yet submitted OT for today.

Pure stdlib. Single thread that sleeps ~30s between checks; when the local
clock hits HH:MM = 14:00 or 15:00, scans `ot_proposals` for today's date,
finds colleagues without a proposal, and posts a Teams reminder per
reminder slot. Logs every send to `reminder_log`.
"""
from __future__ import annotations

import datetime as dt
import logging
import threading
import time
from pathlib import Path

from . import db, helpers, teams_reminder

log = logging.getLogger("ptb_rdme.scheduler")

# Cards fire once per (date, slot) — track in-memory to avoid double-firing.
_FIRED: set[tuple[str, str]] = set()


class Scheduler:
    def __init__(self, db_path: Path, teams_webhook_default: str = ""):
        self.db_path = db_path
        self.teams_webhook_default = teams_webhook_default
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="scheduler", daemon=True)
        self._thread.start()
        log.info("scheduler started")

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception:
                log.exception("scheduler tick failed")
            self._stop.wait(30)  # 30 s polling cadence

    def _tick(self) -> None:
        today = helpers.get_today_local()
        if helpers.day_of_week_label(today) == "Saturday":
            return  # no reminders on Saturday
        now = dt.datetime.now()
        # Slot 1 at 14:00 (within a 60s window), slot 2 at 15:00
        for hour, slot in ((14, "14:00"), (15, "15:00")):
            if now.hour == hour and now.minute < 2:
                key = (today.isoformat(), slot)
                if key not in _FIRED:
                    self._fire_for_today(today, slot)
                    _FIRED.add(key)
        # Reset memory at midnight
        if now.hour == 0 and now.minute < 2:
            _FIRED.clear()

    def _fire_for_today(self, today: dt.date, slot: str) -> None:
        colleagues = db.list_colleagues(self.db_path)
        existing = {row["colleague_id"] for row in db.list_ot_for_date(self.db_path, today.isoformat())}
        sent_at = dt.datetime.now().isoformat(timespec="seconds")
        for c in colleagues:
            cid = c["id"]
            if cid in existing:
                continue
            webhook = c.get("teams_webhook_override") or self.teams_webhook_default
            if not webhook:
                log.info("no webhook for %s — skipping reminder", cid)
                continue
            title = f"Reminder: OT for {today.isoformat()} ({slot})"
            text = (
                f"Hi {c.get('name', cid)}, please submit your daily overtime "
                f"proposal for {today.isoformat()} ({helpers.day_of_week_label(today)}) "
                f"before 16:00. Open the PTB RDME Widget to submit."
            )
            ok = teams_reminder.post_to_teams(webhook, title, text)
            db.log_reminder(
                self.db_path,
                colleague_id=cid,
                ot_date=today.isoformat(),
                reminder_slot=slot,
                sent_at=sent_at,
                channel="teams-webhook",
                status_after="sent" if ok else "failed",
                message=text,
            )
            log.info("reminder %s -> %s ok=%s", slot, cid, ok)
