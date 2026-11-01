"""Entry point for PTB RDME Widget.

Wires the HTTP server + background scheduler. Launches both as daemon
threads so the main thread can sit and wait for Ctrl+C.

Run:
    python -m server
    python -m server --host 127.0.0.1 --port 8050
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading
from pathlib import Path

from . import db, scheduler, server as http_server

LOG_LEVEL = os.environ.get("PTB_RDME_LOG", "INFO")


def _setup_logging():
    LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = logging.getLogger()
    log.setLevel(getattr(logging, LOG_LEVEL.upper(), logging.INFO))
    for h in list(log.handlers):
        log.removeHandler(h)
    fh = logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(fh)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(sh)


def main():
    ap = argparse.ArgumentParser(prog="ptb-rdme-widget")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8050)
    ap.add_argument(
        "--teams-webhook",
        default="",
        help="default Teams Incoming Webhook for reminders (colleagues can override individually)",
    )
    ap.add_argument(
        "--no-scheduler",
        action="store_true",
        help="don't start the 14:00/15:00 reminder scheduler (test mode)",
    )
    args = ap.parse_args()

    _setup_logging()
    log = logging.getLogger("ptb_rdme")

    DATA_DIR = Path(__file__).resolve().parent.parent / "data"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH = DATA_DIR / "ptb_rdme.sqlite3"
    db.init_db(DB_PATH)

    sched = scheduler.Scheduler(DB_PATH, teams_webhook_default=args.teams_webhook)
    if not args.no_scheduler:
        sched.start()

    srv = http_server.start(host=args.host, port=args.port)
    log.info("PTB RDME Widget running on http://%s:%d", args.host, args.port)
    log.info("Web UI:    http://%s:%d/", args.host, args.port)
    log.info("Logs:      %s", Path(__file__).resolve().parent.parent / "logs" / "app.log")

    stop = threading.Event()

    def _shutdown(*_):
        log.info("shutting down")
        stop.set()
        sched.stop()
        try:
            srv.shutdown()
        except Exception:
            pass

    try:
        signal.signal(signal.SIGINT, _shutdown)
    except Exception:
        pass

    stop.wait()


if __name__ == "__main__":
    main()
