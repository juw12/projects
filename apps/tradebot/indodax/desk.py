#!/usr/bin/env python3
"""TradeBot's Indodax desk: one window for the sender and everything it does.

It starts and stops the sender (bridge.py, in this folder) as a hidden child process, so no
console window is needed, and shows in one place: real or practice, the free rupiah, what is
held, the market, what the strategy needs before it buys or sells, the history, the result and
the sender's own log. Two buttons pause and resume buying, the same switch as /indodax pause.

    pythonw desk.py            open the window and start the sender
    pythonw desk.py --no-start open the window only
    pythonw desk.py --demo     made-up numbers, for a look around: no sender, no network

TradeBot.exe is this file as one program (built on GitHub, no Python needed): the window, and
the sender and the study as hidden children of it (TradeBot.exe --sender, TradeBot.exe --study).

Standard library only. It never places an order itself and never reads the Indodax API key:
orders are made by bridge.py alone. It talks to TradeBot with the sender's key from .env.
"""

from __future__ import annotations

import argparse
import json
import queue
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import bridge

VERSION = "0.13.1"  # the same number as apps/tradebot/package.json
FROZEN = bridge.FROZEN  # True inside TradeBot.exe
HERE = bridge.HERE
APP_NAME = "tradebot.exe"
UPDATE_WORDS = "close this window while no coin is held, then run update-desk.cmd in its folder." if bridge.FROZEN else "copy the new files from GitHub while no coin is held."
REFRESH_SECONDS = 30
EMPTY_NOTE_Y = 27  # just under a table's heading row
FRESH_SECONDS = 150  # the sender writes its report file once a minute; older means it is not running
RESTART_SECONDS = 60
LOG_LINES = 800
LOG_FILE_BYTES = 1_000_000
ONE_WINDOW_PORT = 47631  # held on 127.0.0.1 while the window is open, so a second one cannot start
NO_WINDOW = 0x08000000  # CREATE_NO_WINDOW


# ---------------------------------------------------------------- the parts without a window


def age_text(seconds) -> str:
    """How long ago, in plain words."""
    if seconds is None:
        return "never"
    seconds = max(0, int(seconds))
    if seconds < 90:
        return "just now"
    if seconds < 5400:
        return f"{round(seconds / 60)} minutes ago"
    if seconds < 172800:
        return f"{round(seconds / 3600)} hours ago"
    return f"{round(seconds / 86400)} days ago"


def read_local(path) -> dict | None:
    """The report file the sender writes each cycle: {at (ms), report}. None when missing or broken."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("report"), dict):
        return None
    return data


def local_is_fresh(local, now_ms) -> bool:
    """True when a sender wrote the report file within the last few cycles."""
    if not local:
        return False
    at = bridge.number(local.get("at"))
    return 0 <= now_ms - at < FRESH_SECONDS * 1000


def start_choice(outside_pids, report_is_fresh) -> str:
    """What to do when this window wants a sender: 'start', 'wait' or 'blocked'.

    A sender process outside this window blocks: two must never run together. A fresh report file with
    no process behind it is only the trace of a sender closed a moment ago (the window was reopened
    quickly): wait until that file is old, then start, so the PC is never left without a sender.
    """
    if outside_pids:
        return "blocked"
    return "wait" if report_is_fresh else "start"


def sender_candidates(rows, own_pid=None) -> list:
    """Process ids that look like a sender started outside this window.

    rows = [{"ProcessId": 1, "CommandLine": "python.exe bridge.py"}]. A line that only shows,
    checks or clears is not a running sender, and neither is the MT5 or the twin's bridge.
    """
    found = []
    for row in rows or []:
        line = str(row.get("CommandLine") or "").lower().replace("/", "\\")
        pid = row.get("ProcessId")
        # bridge.py under Python, or the one-file app asked to be the sender (it runs as two processes).
        if not ("bridge.py" in line or (APP_NAME in line and "--sender" in line)) or pid == own_pid:
            continue
        if any(flag in line for flag in ("--show", "--once", "--check", "--clear")):
            continue
        if "\\mt5\\" in line or "\\twin\\" in line:
            continue
        found.append(pid)
    return found


def list_python_processes() -> list:
    """Every python and TradeBot.exe process with its command line (Windows). An empty list when it cannot be read."""
    command = [
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name like 'python%' or Name = 'TradeBot.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ]
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=20, creationflags=NO_WINDOW if sys.platform == "win32" else 0)
        data = json.loads(done.stdout or "[]")
    except (OSError, ValueError, subprocess.SubprocessError):
        return []
    return [data] if isinstance(data, dict) else list(data or [])


def tiles(view, local, now_ms) -> dict:
    """The five numbers at the top of the window, as short text.

    view = the answer of GET /v1/indodax/view (or None when TradeBot cannot be reached);
    local = the sender's own report file. The server's copy wins; the file fills in offline.
    """
    report = (view or {}).get("report") or (local or {}).get("report") or {}
    real = report.get("mode") == "real"
    kind = "real" if real else "practice"
    cash = report.get("cash")
    positions = report.get("positions") or []
    held = [item for item in positions if not real or item.get("real") is not False]
    worth = sum(bridge.number(item.get("value")) for item in held)
    names = ", ".join(str(item.get("symbol") or "").replace("USDT", "") for item in held)
    result = bridge.number((report.get("result") or {}).get(kind))
    today = report.get("today") or {}
    if view and view.get("at"):
        heard = age_text((bridge.number(view.get("now")) - bridge.number(view.get("at"))) / 1000)
    elif local:
        heard = age_text((now_ms - bridge.number(local.get("at"))) / 1000)
    else:
        heard = "never"
    return {
        "mode": ("REAL MONEY" if real else "practice (pretend money)") if report else "no report yet",
        "real": real,
        "cash": bridge.rp(cash) if isinstance(cash, (int, float)) else "not reported",
        "holding": f"{names} · worth {bridge.rp(worth)}" if held else "no coin",
        "result": bridge.signed_rp(result),
        "today": f"{bridge.signed_rp(bridge.number(today.get(kind)))} · {int(bridge.number(today.get('buys')))} buys",
        "heard": heard,
        "paused": bool((view or {}).get("paused") or report.get("paused")),
    }


def local_text(local, now_ms) -> str:
    """A short report from the sender's own file, shown when TradeBot cannot be reached."""
    if not local:
        return "No report yet. Start the sender and wait one minute."
    report = local["report"]
    lines = [f"From the sender's own file ({age_text((now_ms - bridge.number(local.get('at'))) / 1000)}). TradeBot's server could not be reached, so the signals are not shown.", ""]
    positions = report.get("positions") or []
    lines.append("Holding now")
    for item in positions:
        lines.append(f"  {item.get('symbol')}: paid {bridge.rp(item.get('spent'))}, worth {bridge.rp(item.get('value'))} now")
    if not positions:
        lines.append("  No coin.")
    market = report.get("market") or []
    if market:
        lines += ["", "Market at Indodax"]
        lines += [f"  {str(row.get('coin')).upper()}: buyers pay {bridge.rp(row.get('bid'))}, sellers ask {bridge.rp(row.get('ask'))}" for row in market]
    notes = report.get("notes") or []
    if notes:
        lines += ["", "Notes"] + [f"  {note}" for note in notes]
    return "\n".join(lines)


class Server:
    """The two calls this window makes to TradeBot, with the sender's key from .env."""

    def __init__(self, env_path):
        self.env_path = env_path

    def _api(self):
        settings = bridge.reachable(bridge.load_settings(self.env_path))
        if not settings.key:
            raise bridge.ApiError("INDODAX_BRIDGE_KEY is empty in .env")
        return bridge.Api(settings)

    def view(self) -> dict:
        return self._api()._call("/v1/indodax/view")

    def pause(self, paused: bool) -> dict:
        return self._api()._call("/v1/indodax/pause", {"paused": bool(paused)})


def sender_command(python=None) -> list:
    """How the sender is started: bridge.py with Python, or the one-file app asked to be the sender."""
    return [sys.executable, "--sender"] if FROZEN else [python or child_python(), "-u", "bridge.py"]


def end_tree(pid, run=subprocess.run) -> None:
    """End a process and what it started. The one-file app runs as two processes: both must go."""
    run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW if sys.platform == "win32" else 0)


class Sender:
    """bridge.py as a hidden child process. Its output lines go to on_line (from a thread)."""

    def __init__(self, folder, on_line, python=None, popen=subprocess.Popen, end=end_tree):
        self.folder = Path(folder)
        self.on_line = on_line
        self.python = python or child_python()
        self.popen = popen
        self.end = end
        self.process = None
        self.wanted = False  # the user wants it running: a child that ends is started again

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        if self.running():
            return
        self.wanted = True
        self.process = self.popen(
            sender_command(self.python),
            cwd=str(self.folder),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=NO_WINDOW if sys.platform == "win32" else 0,
        )
        threading.Thread(target=self._read, args=(self.process,), daemon=True).start()

    def _read(self, process) -> None:
        for line in process.stdout:
            self.on_line(line.rstrip("\n"))
        code = process.wait()
        self.on_line(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] the sender ended (exit {code}).")

    def stop(self) -> None:
        self.wanted = False
        if self.running():
            if FROZEN:
                self.end(self.process.pid)
            else:
                self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def exit_code(self):
        return None if self.process is None else self.process.poll()


def child_python() -> str:
    """python.exe for the child, also when this window runs under pythonw.exe."""
    path = Path(sys.executable)
    if path.name.lower() == "pythonw.exe" and path.with_name("python.exe").exists():
        return str(path.with_name("python.exe"))
    return str(path)


def append_log(path, line) -> None:
    """Keep the sender's lines in a file too, so a stop in the night can be read later."""
    try:
        target = Path(path)
        if target.exists() and target.stat().st_size > LOG_FILE_BYTES:
            target.replace(target.with_suffix(".old.log"))
        with target.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


def hold_one_window():
    """A socket that only one window can hold. None when another window already has it."""
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        holder.bind(("127.0.0.1", ONE_WINDOW_PORT))
        holder.listen(1)
    except OSError:
        holder.close()
        return None
    return holder


# ---------------------------------------------------------------- what the window shows (no window needed)

WIB = 7 * 3600  # Batam and Jakarta time, the same clock TradeBot's messages use
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def clock_wib(ms) -> str:
    """A moment in milliseconds as '17 Nov 12:54' (WIB). Empty for nothing."""
    ms = bridge.number(ms)
    if ms <= 0:
        return ""
    moment = time.gmtime(ms / 1000 + WIB)
    return f"{moment.tm_mday} {MONTHS[moment.tm_mon - 1]} {moment.tm_hour:02d}:{moment.tm_min:02d}"


def coin_name(symbol) -> str:
    return str(symbol or "").upper().replace("USDT", "")


def percent(part, whole) -> str:
    whole = bridge.number(whole)
    if whole <= 0:
        return ""
    change = (bridge.number(part) / whole - 1) * 100
    return f"{'+' if change >= 0 else '−'}{abs(change):.1f}%".replace(".", ",")


def report_of(view, local) -> dict:
    return (view or {}).get("report") or (local or {}).get("report") or {}


def alerts(view, local, sender_state, error, now_ms) -> list:
    """The warnings above the numbers, worst first: [(level, text)], level 'bad' or 'warn'.

    sender_state = 'here' (running in this window), 'outside' (running elsewhere), 'waiting' (starts by itself
    in a moment) or 'stopped'.
    Nothing is returned when all is fine, so a warning always means something.
    """
    report = report_of(view, local)
    real = report.get("mode") == "real"
    found = []
    if sender_state == "stopped":
        found.append(("bad", "The sender is stopped. Nothing is bought or sold, and a falling price is not acted on. Press Start the sender."))
    if sender_state == "waiting":
        found.append(("warn", "The sender starts by itself within three minutes: the last one was closed a moment ago, and two must never run together."))
    if report.get("tripped"):
        why = str(report.get("trippedWhy") or "").strip()
        found.append(("bad", f"Safety stop: real buying is blocked until you have looked at Indodax.{' ' + why if why else ''}"))
    if real and report and not report.get("checked"):
        found.append(("bad", "Real mode is on, but the API key has not passed its check on this PC, so nothing is bought."))
    if sender_state not in ("stopped", "waiting") and local and not local_is_fresh(local, now_ms):
        age = age_text((now_ms - bridge.number(local.get("at"))) / 1000)
        found.append(("warn", f"The sender's last finished cycle was {age}. It may be waiting for the network; the Sender log tab shows why."))
    if (view or {}).get("stale") and sender_state != "stopped":
        found.append(("warn", "TradeBot's server has not heard from the sender for more than five minutes."))
    if (view or {}).get("paused") or report.get("paused"):
        found.append(("warn", "Buying is paused. Coins you hold are still sold when the strategy or the stop says so."))
    cash, order = report.get("cash"), bridge.number(report.get("orderIdr"))
    if real and isinstance(cash, (int, float)) and order > 0 and cash < order and not report.get("positions"):
        found.append(("warn", f"Free rupiah ({bridge.rp(cash)}) is less than one buy ({bridge.rp(order)}). Top up at Indodax or nothing can be bought."))
    if error:
        found.append(("warn", f"TradeBot's server did not answer ({error}). The numbers below are the sender's own, and the signals are not shown."))
    return found


ACTION_WORDS = {
    "BUY": "BUY: all checks pass",
    "HOLD": "HOLD: keep it",
    "SELL": "SELL: a check failed",
    "WAIT": "WAIT: not yet",
}


def signal_rows(view) -> list:
    """One row per coin the strategy watches: {coin, action, label, checks: [(ok, name, text)], why, change}."""
    rows = []
    for item in (view or {}).get("signals") or []:
        coin = coin_name(item.get("coin"))
        if item.get("error"):
            rows.append({"coin": coin, "action": "?", "label": "no fresh price", "checks": [], "why": "It tries again at its next 5-minute check.", "change": ""})
            continue
        action = str(item.get("action") or "WAIT").upper()
        change = item.get("change24h")
        rows.append({
            "coin": coin,
            "action": action,
            "label": ACTION_WORDS.get(action, action),
            "checks": [(bool(check.get("ok")), str(check.get("name") or ""), str(check.get("text") or "")) for check in item.get("checks") or []],
            "why": str(item.get("why") or ""),
            "change": f"{'+' if change >= 0 else '−'}{abs(change):.1f}% in 24 hours".replace(".", ",") if isinstance(change, (int, float)) else "",
        })
    return rows


def holding_rows(report) -> list:
    """(coin, bought, paid, worth now, change, sold if price under) for each coin held."""
    rows = []
    stop = bridge.number(report.get("stopPercent"))
    for item in report.get("positions") or []:
        price = bridge.number(item.get("price"))
        rows.append((
            coin_name(item.get("symbol")) + ("" if item.get("real") is not False else " (practice)"),
            clock_wib(item.get("openedAt")),
            bridge.rp(item.get("spent")),
            bridge.rp(item.get("value")),
            percent(item.get("value"), item.get("spent")),
            bridge.rp(price * (1 - stop / 100)) if price > 0 and stop > 0 else "",
        ))
    return rows


def watched_only(row) -> str:
    """The one quiet line for a coin the strategy watches but this PC does not trade."""
    marks = "  ".join(f"{'✓' if ok else '✗'} {name}" for ok, name, _ in row.get("checks") or [])
    return "watched only, not traded for you" + (f" · {marks}" if marks else "")


GAP_WORDS = ("Gap", "how far the price to buy is above the price when selling. A coin starts this much behind when it is bought.")


def plain_words(view) -> list:
    """What the checks mean, for someone who has never traded: [(word, meaning)] from TradeBot."""
    found = []
    for entry in (view or {}).get("words") or []:
        if isinstance(entry, dict) and entry.get("word") and entry.get("means"):
            found.append((str(entry["word"]), str(entry["means"])))
    if found:
        found.append(GAP_WORDS)
    return found


HOW_WORDS = {"gone": "no longer in the account", "left": "too small to sell"}


def history_rows(report, real_only: bool) -> list:
    """(coin, bought, paid, sold, received, result), newest first."""
    rows = []
    for item in reversed(report.get("closed") or []):
        if real_only and item.get("real") is False:
            continue
        how = item.get("how")
        sold = how == "sold"
        about = "about " if item.get("estimated") else ""
        rows.append((
            coin_name(item.get("symbol")) + ("" if item.get("real") is not False else " (practice)"),
            clock_wib(item.get("boughtAt")),
            bridge.rp(item.get("spent")),
            clock_wib(item.get("at")) if sold else HOW_WORDS.get(how, str(how or "")),
            about + bridge.rp(item.get("received")) if sold else "",
            about + bridge.signed_rp(bridge.number(item.get("received")) - bridge.number(item.get("spent"))) if sold else "no result",
        ))
    return rows


def market_rows(report) -> list:
    """(coin, price to buy, price when selling, gap between the two)."""
    rows = []
    for item in report.get("market") or []:
        bid, ask = bridge.number(item.get("bid")), bridge.number(item.get("ask"))
        gap = f"{(ask - bid) / ask * 100:.2f}%".replace(".", ",") if ask > 0 else ""
        rows.append((coin_name(item.get("coin")), bridge.rp(ask), bridge.rp(bid), gap))
    return rows


def next_line(view) -> str:
    """The 'Next: ...' sentence of TradeBot's report, when there is one."""
    for line in str((view or {}).get("text") or "").split("\n"):
        if line.startswith("Next: "):
            return line[6:]
    return ""


def failed_cycles(lines) -> int:
    """How many of the sender's log lines say a cycle failed or TradeBot or Indodax could not be reached."""
    return sum(1 for line in lines if "cycle failed" in line or "could not be reached" in line or "could not be read" in line)


# ---------------------------------------------------------------- the Study tab (no window needed)

# The score of the sender's own study (learn.py): its four parts and the most each can give.
SCORE_PARTS = [("unseen", "Unseen prices", 3), ("steady", "Steady years", 2), ("dips", "Dips", 2), ("real", "Real money", 3)]
STUDY_EVERY_MS = bridge.LEARN_EVERY_SECONDS * 1000
STUDY_OLD_MS = 12 * 3600 * 1000  # three missed studies: the PC was off or the prices could not be read
REAL_TRADES_GOAL, COST_TRADES_GOAL, WATCH_DAYS_GOAL, WATCH_TRADES_GOAL = 30, 5, 90, 8  # as in learn.py
CHART_DAYS = 14  # the chart is at least this wide, so the first days do not look like a jump
DAY_MS = 24 * 3600 * 1000


def points_text(value) -> str:
    """A score as it is said: '2,3', '1,28', '0', '10'."""
    return f"{bridge.number(value):.2f}".rstrip("0").rstrip(".").replace(".", ",")


def day_wib(ms) -> str:
    """A moment as '17 Nov' (WIB)."""
    return clock_wib(ms).rsplit(" ", 1)[0]


def study_of(view, local):
    """The study inside the report, or None when none has arrived."""
    learn = report_of(view, local).get("learn")
    return learn if isinstance(learn, dict) and bridge.number(learn.get("at")) > 0 else None


def study_shown(learn, now_ms):
    """Everything the Study tab says, as plain values. None when there is no study or no score yet.

    {total, total_text, gap, parts: [{title, got, most, text, means}], curve: [(at, score)], curve_text,
     progress: [{label, done, goal, count, text}], verdict, when, old, trend: {text, way: 1 up, 0 flat, -1 down}}
    """
    if not isinstance(learn, dict) or not isinstance(learn.get("score"), dict):
        return None
    score = learn["score"]
    given = score.get("parts") if isinstance(score.get("parts"), dict) else {}
    unseen = learn.get("unseen") if isinstance(learn.get("unseen"), dict) else {}
    cost = learn.get("cost") if isinstance(learn.get("cost"), dict) else {}
    other = learn.get("challenger") if isinstance(learn.get("challenger"), dict) else None
    trades = int(bridge.number(score.get("realTrades")))
    year_up = learn.get("yearUp")
    means = {
        "unseen": f"{bridge.signed_rp(bridge.number(unseen.get('live')))} over {bridge.number(unseen.get('windows')) / 2:g} years of prices the rules had not seen. Full marks: a year's gain of 30% of one buy.",
        "steady": f"A year ended with a gain in {int(bridge.number(year_up))} of 100 starts. 50 gives nothing, 90 gives full marks." if isinstance(year_up, (int, float)) else "Too few years of prices to say.",
        "dips": f"About {bridge.signed_rp(bridge.number(learn.get('perYear')))} a year against a deepest dip of {bridge.signed_rp(bridge.number(learn.get('dip')))}. Full marks: a year's gain of twice the dip.",
        "real": f"{trades} of {REAL_TRADES_GOAL} real trades finished. Half for the count, half for a gain after costs.",
    }
    parts = []
    for name, title, most in SCORE_PARTS:
        got = min(most, max(0.0, bridge.number(given.get(name))))
        parts.append({"name": name, "title": title, "got": got, "most": most, "text": f"{points_text(got)} of {most}", "means": means[name]})
    total = min(10.0, max(0.0, bridge.number(score.get("total"))))
    widest = max(parts, key=lambda part: part["most"] - part["got"])
    missing = widest["most"] - widest["got"]
    gap = (
        "Every part has full marks."
        if missing <= 0
        else f"The biggest gap is {widest['title'].lower()}: {points_text(missing)} of its {widest['most']} points are not earned yet."
        + (" They come only from finished real trades, so this part grows slowly." if widest["name"] == "real" else "")
    )

    curve = sorted(
        (bridge.number(point.get("at")), min(10.0, max(0.0, bridge.number(point.get("score")))))
        for point in learn.get("curve") or []
        if isinstance(point, dict) and bridge.number(point.get("at")) > 0
    )
    if len(curve) < 2:
        curve_text = "The curve starts today. One point is added each day the sender runs."
        trend = {"text": "first day on the curve", "way": 0}
    else:
        change = round(total - curve[0][1], 1)
        moved = "no change" if change == 0 else f"{'+' if change > 0 else '−'}{points_text(abs(change))}"
        curve_text = f"{points_text(curve[0][1])} on {day_wib(curve[0][0])} → {points_text(total)} now: {moved} over {len(curve)} days with a study."
        trend = {"text": f"{'▲' if change > 0 else '▼' if change < 0 else '●'} {moved} since {day_wib(curve[0][0])}", "way": (change > 0) - (change < 0)}

    def step(label, done, goal, text):
        done = int(min(goal, max(0, bridge.number(done))))
        return {"label": label, "done": done, "goal": goal, "count": f"{done} of {goal}", "text": text}

    progress = [
        step("Real trades finished", trades, REAL_TRADES_GOAL, "for the real-money points"),
        step("Real cost measured", cost.get("trades"), COST_TRADES_GOAL, "then it replaces the assumed cost"),
    ]
    if other:
        progress.append(step("Trial setting: days watched", other.get("days"), WATCH_DAYS_GOAL, "before a review"))
        progress.append(step("Trial setting: pretend trades", other.get("trades"), WATCH_TRADES_GOAL, "before a review"))
    # The trial setting's own numbers (averages, RSI, ATR) stay in /learn: here only what it means.
    verdict = {
        "review": "The trial setting has earned a review. Nothing changes by itself: the rules are changed by hand, after a look.",
        "watch": "Keep the rules. A second setting of the same rules is tried on paper: pretend trades, no money. It is reviewed after 90 days and 8 pretend trades.",
    }.get(learn.get("verdict") if other else "keep", "Keep the rules. They are also the best setting of the last three years.")

    at = bridge.number(learn.get("at"))
    old = now_ms - at > STUDY_OLD_MS
    following = at + STUDY_EVERY_MS
    when = f"Last study {age_text((now_ms - at) / 1000)}. " + (
        "That is old: the PC was off or the prices could not be read."
        if old
        else f"Next one about {clock_wib(following).rsplit(' ', 1)[-1]} WIB, and after each buy or sale."
        if following > now_ms
        else "The next one starts at the sender's next cycle."
    )
    return {"total": total, "total_text": points_text(total), "gap": gap, "parts": parts, "curve": curve, "curve_text": curve_text, "progress": progress, "verdict": verdict, "when": when, "old": old, "trend": trend}


def chart_points(curve, width, height, left=30, right=16, top=10, bottom=22) -> list:
    """Where each point of the curve sits on a chart of this size: [(x, y)].

    The scale is always 0 (bottom) to 10 (top), so a small rise never looks like a big one, and the
    chart is at least CHART_DAYS wide, so the first days start at the left and grow to the right.
    """
    if not curve:
        return []
    first = curve[0][0]
    span = max(curve[-1][0] - first, CHART_DAYS * DAY_MS)
    inner_width, inner_height = max(1, width - left - right), max(1, height - top - bottom)
    return [(round(left + inner_width * (at - first) / span, 1), round(top + inner_height * (1 - score / 10), 1)) for at, score in curve]


def newer_version(view) -> str:
    """The version TradeBot's server runs when it is newer than this window, else ''."""
    theirs = str((view or {}).get("version") or "")

    def numbers(text):
        return tuple(int(part) for part in text.split(".")) if text and all(part.isdigit() for part in text.split(".")) else ()

    return theirs if numbers(theirs) > numbers(VERSION) else ""


DEMO_TRADED = ("BTC", "ETH")  # the demo trades two of its three coins


def demo_view(now_ms, trouble=False) -> dict:
    """Made-up numbers for --demo: screenshots and a look around, with no account behind them.

    trouble=True shows the warnings instead: buying paused and a sender that went silent.
    """
    hour = 3600 * 1000
    report = {
        "mode": "real", "keys": True, "checked": True, "paused": False, "tripped": False, "trippedWhy": "",
        "orderIdr": 20000, "maxOpen": 1, "stopPercent": 8, "cash": 30450,
        "positions": [{"symbol": "BTCUSDT", "pair": "btc_idr", "real": True, "quantity": 0.00001672, "spent": 20000, "price": 1193900000, "now": 1214500000, "value": 20306, "openedAt": now_ms - 5 * hour}],
        "closed": [  # oldest first, as the sender keeps them
            {"symbol": "BTCUSDT", "real": True, "spent": 20000, "received": 19310, "boughtAt": now_ms - 140 * hour, "at": now_ms - 120 * hour, "quantity": 0.0000171, "how": "sold", "estimated": False},
            {"symbol": "BTCUSDT", "real": True, "spent": 20000, "received": 20730, "boughtAt": now_ms - 80 * hour, "at": now_ms - 52 * hour, "quantity": 0.0000169, "how": "sold", "estimated": False},
        ],
        "market": [{"coin": "btc", "bid": 1214500000, "ask": 1214900000}],
        "result": {"practice": 0, "real": 40}, "today": {"practice": 0, "real": 0, "buys": 1}, "notes": [],
    }
    day = 24 * hour
    studied = now_ms - (15 * hour if trouble else 1 * hour)
    climb = [2.3, 2.3, 2.3, 2.4, 2.4, 2.4, 2.5, 2.4, 2.5, 2.6, 2.6, 2.6, 2.7, 2.7, 2.6, 2.7, 2.8, 2.8]
    report["learn"] = {
        "at": studied, "candles": 14820, "versions": 81, "order": 20000, "trades": 215, "wins": 30, "perYear": 4700, "dip": -11900, "yearUp": 64, "monthUp": 39,
        "unseen": {"windows": 8, "up": 2, "live": 9600, "picked": 12900},
        "cost": {"assumed": 0.9, "measured": 1.0, "trades": 2, "used": "assumed"},
        "challenger": {"rules": "averages 30/80/300, RSI 50 to 70, stop 4 ATR", "days": 18, "trades": 2, "lead": 310},
        "verdict": "watch",
        "score": {"total": 2.8, "parts": {"unseen": 1.2, "steady": 0.7, "dips": 0.39, "real": 0.51}, "realTrades": 2},
        "curve": [{"at": studied - (len(climb) - 1 - index) * day, "score": value} for index, value in enumerate(climb)],
    }
    checks_up = [
        {"name": "Trend", "ok": True, "text": "price above the 200-candle average"},
        {"name": "Momentum", "ok": True, "text": "20-candle average above the 50-candle average"},
        {"name": "RSI", "ok": True, "text": "61 (rising, not overheated)"},
    ]
    checks_down = [
        {"name": "Trend", "ok": True, "text": "price above the 200-candle average"},
        {"name": "Momentum", "ok": False, "text": "20-candle average below the 50-candle average"},
        {"name": "RSI", "ok": False, "text": "44 (weak: under 50)"},
    ]
    words = [
        {"word": "Candle", "means": "the price during one 4h slice of time. I judge a coin once per candle."},
        {"word": "Trend", "means": "the price is above its average of the last 200 candles, so the long direction is up."},
        {"word": "Momentum", "means": "the average of the last 20 candles is above the average of the last 50, so it has been rising lately."},
        {"word": "RSI", "means": "a 0 to 100 gauge of how fast the price rose lately. I want 50 to 70: rising, but not overheated."},
    ]
    return {
        "configured": True, "now": now_ms, "at": now_ms - (12 * 60000 if trouble else 20000), "stale": trouble, "paused": trouble, "report": report, "words": words,
        "signals": [
            {"coin": "BTC", "action": "HOLD", "why": "holding: trend and momentum are still up", "checks": checks_up, "change24h": 1.8},
            {"coin": "ETH", "action": "WAIT", "why": "waiting for momentum and RSI", "checks": checks_down, "change24h": -0.6},
            {"coin": "SOL", "action": "WAIT", "why": "waiting for momentum and RSI", "checks": checks_down, "change24h": -2.1},
        ],
        "text": "Indodax report (demo numbers)\nNext: I judge each coin when the 4h candle closes at 15:00 WIB; if all 3 checks pass, I buy it and tell you.\n\nThis is the demo: no account is behind these numbers.",
    }


# ---------------------------------------------------------------- the window

INK, MUTED, PAPER, CARD, LINE = "#1f2328", "#5b6470", "#f3f4f6", "#ffffff", "#d9dce1"
GOOD, BAD, WARN = "#1b7f3b", "#b3261e", "#8a5200"
ACCENT, TRACK = "#2457c5", "#e6e9ee"  # the bars and the curve of the Study tab, and what is still empty
BANNER = {"bad": ("#fde7e5", BAD), "warn": ("#fff1cc", WARN)}
ACTION_COLOURS = {"BUY": GOOD, "HOLD": GOOD, "SELL": BAD, "WAIT": MUTED, "?": WARN}
FONT = "Segoe UI"


def open_window(args) -> int:
    import tkinter as tk
    from tkinter import messagebox, ttk
    from tkinter.scrolledtext import ScrolledText

    demo = bool(args.demo)
    trouble = demo and bool(args.trouble)
    holder = None if demo else hold_one_window()
    if holder is None and not demo:
        root = tk.Tk()
        root.withdraw()
        messagebox.showinfo("TradeBot Indodax", "The TradeBot window is already open. Look for it in the taskbar.")
        return 0

    folder = Path(args.folder).resolve()
    env_path = folder / ".env"
    report_path = folder / "bridge_report.json"
    log_path = folder / "desk_sender.log"
    events = queue.Queue()
    server = Server(env_path)
    sender = Sender(folder, lambda line: events.put(("log", line)))
    seen = {"view": None, "error": "", "outside": [], "restart_at": 0.0, "busy": False, "asked": 0.0, "drawn": None, "lines": [], "banner_height": 0, "resize": None, "start_later": "", "start_check": 0.0, "studied": None}
    try:
        traded = set(DEMO_TRADED) if demo else {coin_name(coin) for coin in bridge.load_settings(env_path).coins}
    except bridge.SettingsError:
        traded = set()

    root = tk.Tk()
    root.title(f"TradeBot · Indodax {VERSION}" + (" (demo numbers)" if demo else ""))
    root.geometry(args.size or "1080x800")
    root.minsize(940, 680)
    root.configure(bg=PAPER)
    style = ttk.Style(root)
    if "vista" in style.theme_names():
        style.theme_use("vista")
    style.configure("Treeview", font=(FONT, 10), rowheight=24)
    style.configure("Treeview.Heading", font=(FONT, 9))
    style.configure("TNotebook.Tab", font=(FONT, 10), padding=(12, 4))
    style.configure("TButton", font=(FONT, 10), padding=(10, 4))

    def label(parent, text="", size=10, colour=INK, bold=False, bg=None, **options):
        return tk.Label(parent, text=text, font=(FONT + (" Semibold" if bold else ""), size), fg=colour, bg=bg or parent["bg"], anchor="w", justify="left", **options)

    # Header: what this is, which money, and whether the sender is alive.
    header = tk.Frame(root, bg=PAPER)
    header.pack(fill="x", padx=16, pady=(12, 6))
    label(header, "TradeBot · Indodax", 16, bold=True).pack(side="left")
    mode_label = tk.Label(header, text="…", font=(FONT + " Semibold", 10), padx=10, pady=3, fg="white", bg=MUTED)
    mode_label.pack(side="left", padx=12)
    status_label = label(header, "", 11, bold=True)
    status_label.pack(side="right")

    banner_frame = tk.Frame(root, bg=PAPER)
    banner_frame.pack(fill="x", padx=16)

    # The four numbers.
    cards = tk.Frame(root, bg=PAPER)
    cards.pack(fill="x", padx=16, pady=(6, 4))
    values, hints = {}, {}
    for column, (name, title) in enumerate([("cash", "Free rupiah at Indodax"), ("holding", "Coins you hold"), ("result", "Result so far"), ("today", "Today, from 07:00 WIB")]):
        cards.grid_columnconfigure(column, weight=1, uniform="card")
        card = tk.Frame(cards, bg=CARD, highlightbackground=LINE, highlightthickness=1)
        card.grid(row=0, column=column, sticky="nsew", padx=(0 if column == 0 else 8, 0))
        label(card, title, 9, MUTED).pack(anchor="w", padx=12, pady=(8, 0))
        values[name] = label(card, "…", 15, bold=True)
        values[name].pack(anchor="w", padx=12)
        hints[name] = label(card, "", 9, MUTED)
        hints[name].pack(anchor="w", padx=12, pady=(0, 8))

    buttons = tk.Frame(root, bg=PAPER)
    buttons.pack(fill="x", padx=16, pady=(6, 6))
    def button(text=""):
        edge = tk.Frame(buttons, bg="#aeb4bd")
        edge.pack(side="left", padx=(0, 8))
        made = tk.Button(edge, text=text, font=(FONT, 10), fg=INK, bg=CARD, activebackground="#e9ecf1", relief="flat", bd=0, padx=16, pady=5, cursor="hand2")
        made.pack(padx=1, pady=1)
        return made

    sender_button = button()
    pause_button = button()
    refresh_button = button("Refresh now")
    fresh_label = label(buttons, "", 9, MUTED)
    fresh_label.pack(side="right")

    footer = label(root, "", 9, MUTED)
    footer.pack(side="bottom", fill="x", padx=16, pady=(0, 8))

    root.bind("<Configure>", lambda event: footer.configure(wraplength=max(400, root.winfo_width() - 40)) if event.widget is root else None, add="+")

    book = ttk.Notebook(root)
    book.pack(fill="both", expand=True, padx=16, pady=(0, 8))
    overview = tk.Frame(book, bg=CARD)
    report_box = ScrolledText(book, wrap="word", font=(FONT, 10), state="disabled", padx=12, pady=10, relief="flat")
    log_box = ScrolledText(book, wrap="none", font=("Consolas", 9), state="disabled", padx=8, pady=6, relief="flat")
    study = tk.Frame(book, bg=CARD)
    book.add(overview, text="Overview")
    book.add(study, text="Study")
    book.add(report_box, text="Full report")
    book.add(log_box, text="Sender log")
    tabs = {"overview": overview, "study": study, "report": report_box, "log": log_box}
    if args.tab in tabs:
        book.select(tabs[args.tab])

    # The Study tab: the score on the left, its curve and what is still being collected on the right.
    # It scrolls as a whole when the window is too low for it, so no line is ever cut off.
    study_scroll = ttk.Scrollbar(study, orient="vertical")
    study_canvas = tk.Canvas(study, bg=CARD, highlightthickness=0, yscrollcommand=study_scroll.set)
    study_scroll.configure(command=study_canvas.yview)
    study_canvas.pack(side="left", fill="both", expand=True)
    study_body = tk.Frame(study_canvas, bg=CARD)
    study_window = study_canvas.create_window(0, 0, window=study_body, anchor="nw")
    study_body.grid_columnconfigure(0, weight=1, uniform="study")
    study_body.grid_columnconfigure(1, weight=1, uniform="study")
    study_body.grid_rowconfigure(0, weight=1)
    study_left = tk.Frame(study_body, bg=CARD)
    study_left.grid(row=0, column=0, sticky="nsew", padx=(16, 12), pady=12)
    study_right = tk.Frame(study_body, bg=CARD)
    study_right.grid(row=0, column=1, sticky="nsew", padx=(12, 16), pady=12)

    def fit_study(_event=None):
        """As tall as the tab when it fits (the chart takes the spare room), taller with a scrollbar when it does not."""
        needed = study_body.winfo_reqheight()
        tall = max(needed, study_canvas.winfo_height())
        study_canvas.itemconfigure(study_window, width=study_canvas.winfo_width(), height=tall)
        study_canvas.configure(scrollregion=(0, 0, 0, tall))
        scrolls = needed > study_canvas.winfo_height() + 2
        if scrolls and not study_scroll.winfo_ismapped():
            study_scroll.pack(side="right", fill="y", before=study_canvas)
        elif not scrolls and study_scroll.winfo_ismapped():
            study_scroll.pack_forget()
            study_canvas.yview_moveto(0)

    study_canvas.bind("<Configure>", fit_study)
    study_body.bind("<Configure>", fit_study)
    study_canvas.bind("<Enter>", lambda _event: study_canvas.bind_all("<MouseWheel>", lambda event: study_canvas.yview_scroll(-1 if event.delta > 0 else 1, "units") if study_scroll.winfo_ismapped() else None))
    study_canvas.bind("<Leave>", lambda _event: study_canvas.unbind_all("<MouseWheel>"))

    def bar(parent, share, colour=ACCENT, height=8, marks=0):
        """A flat bar that fills its row: share (0 to 1) of it is coloured. marks = thin lines that split it."""
        canvas = tk.Canvas(parent, height=height, bg=CARD, highlightthickness=0)

        def draw(_event=None):
            width = canvas.winfo_width()
            canvas.delete("all")
            canvas.create_rectangle(0, 0, width, height, fill=TRACK, outline="")
            if share > 0:
                canvas.create_rectangle(0, 0, max(3, round(width * min(1.0, share))), height, fill=colour, outline="")
            for index in range(1, marks):
                canvas.create_line(round(width * index / marks), 0, round(width * index / marks), height, fill=CARD)

        canvas.bind("<Configure>", draw)
        return canvas

    def draw_chart(canvas, curve):
        width, height = canvas.winfo_width(), canvas.winfo_height()
        canvas.delete("all")
        if width < 80 or height < 60:
            return
        left, right, top, bottom = 30, 16, 10, 22
        for value in (0, 5, 10):
            y = top + (height - top - bottom) * (1 - value / 10)
            canvas.create_line(left, y, width - right, y, fill=TRACK if value else LINE)
            canvas.create_text(left - 8, y, text=str(value), anchor="e", font=(FONT, 8), fill=MUTED)
        spots = chart_points(curve, width, height, left, right, top, bottom)
        if not spots:
            return
        if len(spots) > 1:
            canvas.create_line(*[value for spot in spots for value in spot], fill=ACCENT, width=2, joinstyle="round")
        for x, y in spots[:-1] if len(spots) <= 31 else []:
            canvas.create_oval(x - 2, y - 2, x + 2, y + 2, fill=ACCENT, outline="")
        x, y = spots[-1]
        canvas.create_oval(x - 4, y - 4, x + 4, y + 4, fill=ACCENT, outline=CARD, width=2)
        canvas.create_text(x, y - 12, text=points_text(curve[-1][1]), anchor="s" if x < width - 40 else "se", font=(FONT + " Semibold", 10), fill=INK)
        canvas.create_text(left, height - 4, text=day_wib(curve[0][0]), anchor="sw", font=(FONT, 8), fill=MUTED)
        if x - spots[0][0] > 90:  # the first value too, when it does not sit on top of the last one
            canvas.create_text(spots[0][0], spots[0][1] - 9, text=points_text(curve[0][1]), anchor="sw", font=(FONT, 9), fill=MUTED)
        if x - left > 90:
            canvas.create_text(x, height - 4, text="today" if len(spots) > 1 else "", anchor="s" if x < width - 40 else "se", font=(FONT, 8), fill=MUTED)

    def draw_study(shown):
        for pane in (study_left, study_right):
            for child in pane.winfo_children():
                child.destroy()
        root.update_idletasks()
        room = max(300, (book.winfo_width() - 84) // 2)  # one column: the tab may not be the one on screen
        if not shown:
            label(study_left, "How far the rules are proven", 11, bold=True).pack(anchor="w")
            label(
                study_left,
                "No score yet. The sender studies its own rules by itself every four hours and after each buy or sale; the first study takes a few minutes. Its score, from 0 to 10, and the curve of that score show here.",
                10,
                MUTED,
                wraplength=room,
            ).pack(anchor="w", pady=(4, 0))
            return

        # Left: the score, what holds it back, and its four parts.
        label(study_left, "How far the rules are proven", 11, bold=True).pack(anchor="w")
        big = tk.Frame(study_left, bg=CARD)
        big.pack(fill="x", pady=(2, 4))
        label(big, shown["total_text"], 34, bold=True).pack(side="left")
        label(big, "of 10", 12, MUTED).pack(side="left", anchor="s", padx=(6, 0), pady=(0, 9))
        way = shown["trend"]["way"]
        label(big, shown["trend"]["text"], 11, GOOD if way > 0 else BAD if way < 0 else MUTED, bold=way != 0).pack(side="right", anchor="s", pady=(0, 9))
        bar(study_left, shown["total"] / 10, height=12, marks=10).pack(fill="x", padx=3)
        label(study_left, shown["gap"], 10, INK, wraplength=room).pack(anchor="w", pady=(8, 2))
        label(study_left, "Fixed scale. Only measured things move the score: it cannot be talked up.", 9, MUTED, wraplength=room).pack(anchor="w", pady=(0, 10))
        for part in shown["parts"]:
            head = tk.Frame(study_left, bg=CARD)
            head.pack(fill="x")
            label(head, part["title"], 10, bold=True).pack(side="left")
            label(head, part["text"], 10, INK).pack(side="right")
            bar(study_left, part["got"] / part["most"]).pack(fill="x", padx=3, pady=(2, 2))
            label(study_left, part["means"], 9, MUTED, wraplength=room).pack(anchor="w", pady=(0, 8))

        # Right: the curve, then what is still being collected, the verdict and when the next study comes.
        label(study_right, "The score, day by day", 11, bold=True).pack(anchor="w")
        label(study_right, shown["curve_text"], 9, MUTED, wraplength=room).pack(anchor="w", pady=(0, 4))
        below = tk.Frame(study_right, bg=CARD)
        below.pack(side="bottom", fill="x")
        chart = tk.Canvas(study_right, height=104, bg=CARD, highlightthickness=0)
        chart.pack(fill="both", expand=True)
        chart.bind("<Configure>", lambda _event: draw_chart(chart, shown["curve"]))

        label(below, "Still collecting", 11, bold=True).pack(anchor="w", pady=(6, 4))
        for step in shown["progress"]:
            head = tk.Frame(below, bg=CARD)
            head.pack(fill="x")
            label(head, step["label"], 10, INK).pack(side="left")
            label(head, "· " + step["text"], 9, MUTED).pack(side="left", padx=(4, 0))
            label(head, step["count"], 10, INK).pack(side="right")
            bar(below, step["done"] / step["goal"], colour=GOOD if step["done"] >= step["goal"] else ACCENT, height=6).pack(fill="x", padx=3, pady=(2, 5))
        verdict_box = tk.Frame(below, bg="#eef4ff", highlightbackground="#c9dafc", highlightthickness=1)
        verdict_box.pack(fill="x", pady=(6, 6))
        label(verdict_box, "Verdict of the last study", 9, MUTED).pack(anchor="w", padx=10, pady=(6, 0))
        label(verdict_box, shown["verdict"], 10, INK, wraplength=room - 24).pack(anchor="w", padx=10, pady=(0, 6))
        label(below, ("⚠ " if shown["old"] else "") + shown["when"], 9, BAD if shown["old"] else MUTED, bold=shown["old"], wraplength=room).pack(anchor="w")
        label(below, "The study only reads prices: it cannot order or change the rules. A past result is not a promise.", 9, MUTED, wraplength=room).pack(anchor="w", pady=(2, 0))

    overview.grid_columnconfigure(0, weight=5, uniform="half")
    overview.grid_columnconfigure(1, weight=6, uniform="half")
    overview.grid_rowconfigure(1, weight=1)
    left = tk.Frame(overview, bg=CARD)
    left.grid(row=0, column=0, rowspan=2, sticky="nsew", padx=(14, 8), pady=10)
    right = tk.Frame(overview, bg=CARD)
    right.grid(row=0, column=1, rowspan=2, sticky="nsew", padx=(8, 14), pady=10)

    label(left, "What the bot waits for", 11, bold=True).pack(anchor="w")
    label(left, "It buys a coin only when all three checks pass, and sells when one fails.", 9, MUTED).pack(anchor="w", pady=(0, 6))
    # The coins scroll inside their pane, so a small window or many coins never hides a line.
    signal_scroll = ttk.Scrollbar(left, orient="vertical")
    signal_canvas = tk.Canvas(left, bg=CARD, highlightthickness=0, yscrollcommand=signal_scroll.set)
    signal_scroll.configure(command=signal_canvas.yview)
    signal_canvas.pack(side="left", fill="both", expand=True)
    signal_frame = tk.Frame(signal_canvas, bg=CARD)
    signal_window = signal_canvas.create_window(0, 0, window=signal_frame, anchor="nw")

    def fit_signals(_event=None):
        """Show the scrollbar only when the coins do not fit."""
        signal_canvas.itemconfigure(signal_window, width=signal_canvas.winfo_width())
        signal_canvas.configure(scrollregion=(0, 0, 0, signal_frame.winfo_reqheight()))
        needed = signal_frame.winfo_reqheight() > signal_canvas.winfo_height() + 2
        if needed and not signal_scroll.winfo_ismapped():
            signal_scroll.pack(side="right", fill="y", before=signal_canvas)
        elif not needed and signal_scroll.winfo_ismapped():
            signal_scroll.pack_forget()
            signal_canvas.yview_moveto(0)

    signal_canvas.bind("<Configure>", fit_signals)
    signal_frame.bind("<Configure>", fit_signals)
    signal_canvas.bind("<Enter>", lambda _event: signal_canvas.bind_all("<MouseWheel>", lambda event: signal_canvas.yview_scroll(-1 if event.delta > 0 else 1, "units") if signal_scroll.winfo_ismapped() else None))
    signal_canvas.bind("<Leave>", lambda _event: signal_canvas.unbind_all("<MouseWheel>"))

    def table(parent, title, columns, height):
        label(parent, title, 11, bold=True).pack(anchor="w", pady=(0, 4))
        tree = ttk.Treeview(parent, columns=[name for name, _, _ in columns], show="headings", height=height, selectmode="none")
        for name, width, side in columns:
            tree.heading(name, text=name, anchor=side)
            tree.column(name, width=width, minwidth=40, anchor=side, stretch=True)
        tree.pack(fill="x", pady=(0, 12))
        return tree

    holding_tree = table(right, "Coins you hold", [("Coin", 44, "w"), ("Bought", 84, "w"), ("Paid", 66, "e"), ("Worth now", 72, "e"), ("Change", 54, "e"), ("Sold if price under", 116, "e")], 2)
    market_tree = table(right, "Price at Indodax right now", [("Coin", 44, "w"), ("Price to buy 1 coin", 140, "e"), ("Price when selling", 140, "e"), ("Gap", 60, "e")], 2)
    history_tree = table(right, "Finished trades, newest first", [("Coin", 44, "w"), ("Bought", 84, "w"), ("Paid", 66, "e"), ("Sold", 96, "center"), ("Received", 72, "e"), ("Result", 76, "e")], 4)
    words_frame = tk.Frame(right, bg=CARD)
    words_frame.pack(fill="x")
    history_tree.tag_configure("up", foreground=GOOD)
    history_tree.tag_configure("down", foreground=BAD)

    def set_text(box, text):
        box.configure(state="normal")
        box.delete("1.0", "end")
        box.insert("1.0", text)
        box.configure(state="disabled")

    def add_log(line):
        if not demo:
            append_log(log_path, line)
        seen["lines"] = (seen["lines"] + [line])[-LOG_LINES:]
        log_box.configure(state="normal")
        log_box.insert("end", line + "\n")
        if int(log_box.index("end-1c").split(".")[0]) > LOG_LINES:
            log_box.delete("1.0", "100.0")
        log_box.configure(state="disabled")
        log_box.see("end")

    def desk_line(text):
        add_log(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] {text}")

    def fetch():
        """In a thread: ask TradeBot and look for a sender started outside this window."""
        if demo:
            events.put(("view", demo_view(time.time() * 1000, trouble), "", []))
            return
        try:
            view, error = server.view(), ""
        except (bridge.ApiError, bridge.SettingsError) as problem:
            view, error = None, str(problem)
        own = sender.process.pid if sender.running() else None
        outside = [] if sender.running() else sender_candidates(list_python_processes(), own)
        events.put(("view", view, error, outside))

    def refresh():
        if seen["busy"]:
            return
        seen["busy"] = True
        threading.Thread(target=fetch, daemon=True).start()

    def local_now():
        return None if demo else read_local(report_path)

    def outside_running():
        return not demo and not sender.running() and (bool(seen["outside"]) or local_is_fresh(read_local(report_path), time.time() * 1000))

    def sender_state():
        if trouble:
            return "stopped"
        if demo or sender.running():
            return "here"
        if seen["start_later"] == "wait":
            return "waiting"
        return "outside" if outside_running() else "stopped"

    empty_notes = {}

    def fill(tree, rows, empty, tags=None, most=3):
        # As tall as its rows (up to a few), so an almost empty table does not push the rest away.
        tree.configure(height=max(1, min(len(rows), most)))
        tree.delete(*tree.get_children())
        # An empty table says so in one line across its width; inside the narrow first column it was cut off.
        note = empty_notes.get(tree)
        if note is None:
            note = empty_notes[tree] = tk.Label(tree, font=(FONT, 9), fg=MUTED, bg="white", anchor="w")
        if rows:
            note.place_forget()
        else:
            tree.insert("", "end", values=("",) * len(tree["columns"]))
            note.configure(text=empty)
            note.place(x=5, y=EMPTY_NOTE_Y)
        for index, row in enumerate(rows):
            tree.insert("", "end", values=row, tags=(tags[index],) if tags else ())

    def pane_width():
        root.update_idletasks()
        # Measured on the pane, not the canvas: the scrollbar coming or going must not change the wrapping.
        return max(280, left.winfo_width() - 26)

    def draw_signals(rows, waits, words):
        for child in signal_frame.winfo_children():
            child.destroy()
        width = pane_width()
        if waits:
            # The one sentence that matters most comes first, so it is never pushed off the window.
            next_box = tk.Frame(signal_frame, bg="#eef4ff", highlightbackground="#c9dafc", highlightthickness=1)
            next_box.pack(fill="x", pady=(0, 10))
            label(next_box, "What happens next", 9, MUTED).pack(anchor="w", padx=10, pady=(6, 0))
            label(next_box, waits, 10, INK, wraplength=width - 24).pack(anchor="w", padx=10, pady=(0, 6))
        if not rows:
            label(signal_frame, "The signals are not shown right now: TradeBot's server did not answer.\nThe sender still works from its own copy.", 10, MUTED, wraplength=width).pack(anchor="w")
        for row in rows:
            copied = not traded or row["coin"] in traded
            block = tk.Frame(signal_frame, bg=CARD)
            block.pack(fill="x", pady=(0, 8))
            top = tk.Frame(block, bg=CARD)
            top.pack(fill="x")
            label(top, row["coin"], 12, INK if copied else MUTED, bold=True).pack(side="left")
            if not copied:
                # A coin the strategy watches but this PC does not trade: one quiet line is enough.
                label(top, watched_only(row), 9, MUTED).pack(side="left", padx=8)
                continue
            tk.Label(top, text=row["label"], font=(FONT + " Semibold", 9), fg="white", bg=ACTION_COLOURS.get(row["action"], MUTED), padx=8, pady=1).pack(side="left", padx=8)
            if row["change"]:
                label(top, row["change"], 9, MUTED).pack(side="right")
            for ok, name, text in row["checks"]:
                line = tk.Frame(block, bg=CARD)
                line.pack(fill="x")
                label(line, "✓" if ok else "✗", 11, GOOD if ok else BAD, bold=True, width=2).pack(side="left", anchor="n")
                label(line, f"{name}: {text}" if name and text else name or text, 10, INK, wraplength=width - 30).pack(side="left")
            if row["why"]:
                label(block, "→ " + row["why"], 10, MUTED, wraplength=width - 10).pack(anchor="w", padx=(4, 0))
        # The trading words, said once in plain words, under the tables on the right.
        for child in words_frame.winfo_children():
            child.destroy()
        if words:
            label(words_frame, "In plain words", 11, bold=True).pack(anchor="w", pady=(0, 2))
            room = max(280, right.winfo_width() - 8)
            for word, means in words:
                label(words_frame, f"{word}: {means}", 9, MUTED, wraplength=room).pack(anchor="w", pady=(1, 0))

    def make_room():
        """Grow the window by the height of the warnings (and shrink it back), so nothing below is cut off."""
        root.update_idletasks()
        height = banner_frame.winfo_reqheight() if banner_frame.winfo_children() else 0
        change = height - seen["banner_height"]
        seen["banner_height"] = height
        if change and root.state() == "normal" and root.winfo_height() > 100:
            tall = max(680, min(root.winfo_height() + change, root.winfo_screenheight() - 90))
            root.geometry(f"{root.winfo_width()}x{tall}")

    def paint():
        now_ms = time.time() * 1000
        local = local_now()
        view = seen["view"]
        report = report_of(view, local)
        shown = tiles(view, local, now_ms)
        state = sender_state()
        real = shown["real"]

        mode_label.configure(text=shown["mode"], bg=BAD if real else MUTED)
        words = {"here": ("● Sender is running", GOOD), "outside": ("● A sender runs in another window", WARN), "waiting": ("◌ Sender starts in a moment", WARN), "stopped": ("○ Sender is stopped", BAD)}[state]
        status_label.configure(text=words[0], fg=words[1])
        sender_button.configure(text={"here": "Stop the sender", "outside": "Take it over here", "waiting": "Start the sender", "stopped": "Start the sender"}[state])
        pause_button.configure(text="Allow buying again" if shown["paused"] else "Pause buying")

        order = bridge.number(report.get("orderIdr"))
        cash = report.get("cash")
        values["cash"].configure(text=shown["cash"])
        hints["cash"].configure(text=(f"enough for {int(cash // order)} more {'buy' if int(cash // order) == 1 else 'buys'} of {bridge.rp(order)}" if isinstance(cash, (int, float)) and order > 0 else "switch on INDODAX_REPORT_CASH to see it"))
        held = [item for item in report.get("positions") or [] if not real or item.get("real") is not False]
        worth, paid = sum(bridge.number(item.get("value")) for item in held), sum(bridge.number(item.get("spent")) for item in held)
        values["holding"].configure(text=", ".join(coin_name(item.get("symbol")) for item in held) if held else "No coin")
        hints["holding"].configure(text=f"worth {bridge.rp(worth)} now ({percent(worth, paid)})" if held else "all the money is in rupiah")
        kind = "real" if real else "practice"
        result = bridge.number((report.get("result") or {}).get(kind))
        values["result"].configure(text=shown["result"], fg=GOOD if result > 0 else BAD if result < 0 else INK)
        finished = history_rows(report, real)
        hints["result"].configure(text=f"from {len(finished)} finished {'trade' if len(finished) == 1 else 'trades'}, after fees" if finished else "no trade is finished yet")
        today = report.get("today") or {}
        today_result = bridge.number(today.get(kind))
        buys = int(bridge.number(today.get("buys")))
        values["today"].configure(text=bridge.signed_rp(today_result), fg=GOOD if today_result > 0 else BAD if today_result < 0 else INK)
        hints["today"].configure(text=f"{buys} {'buy' if buys == 1 else 'buys'} today")

        for child in banner_frame.winfo_children():
            child.destroy()
        for level, text in alerts(view, local, state, seen["error"], now_ms):
            back, front = BANNER[level]
            tk.Label(banner_frame, text=("⛔  " if level == "bad" else "⚠  ") + text, font=(FONT, 10), fg=front, bg=back, anchor="w", justify="left", padx=12, pady=6, wraplength=max(400, root.winfo_width() - 60)).pack(fill="x", pady=(0, 4))
        make_room()
        root.update_idletasks()  # the pane widths below must be the real ones, also on the first paint

        # The tables and the signals are redrawn only when their numbers or the pane widths change, so nothing flickers.
        signature = json.dumps([report, (view or {}).get("signals"), (view or {}).get("words"), next_line(view), sorted(traded), left.winfo_width(), right.winfo_width()], sort_keys=True, default=str)
        # The Study tab follows the study, the hour (for "2 hours ago") and the width of the tabs.
        learn = study_of(view, local)
        studied = json.dumps([learn, int(now_ms // 600000), book.winfo_width()], sort_keys=True, default=str)
        if studied != seen["studied"]:
            seen["studied"] = studied
            draw_study(study_shown(learn, now_ms))
        if signature != seen["drawn"]:
            seen["drawn"] = signature
            draw_signals(signal_rows(view), next_line(view), plain_words(view))
            fill(holding_tree, holding_rows(report), "No coin right now")
            fill(market_tree, market_rows(report), "No price yet")
            fill(history_tree, finished, "No trade is finished yet", ["up" if "+" in row[5] else "down" if "-" in row[5] or "−" in row[5] else "" for row in finished], most=5)
            set_text(report_box, (view or {}).get("text") or local_text(local, now_ms))

        heard = f"TradeBot heard the sender {shown['heard']}"
        failed = failed_cycles(seen["lines"])
        asked = f"this window asked {age_text(time.time() - seen['asked'])}" if seen["asked"] else "asking TradeBot…"
        old = bool((view or {}).get("stale")) or (view is None and not local_is_fresh(local, now_ms))
        fresh_label.configure(
            text=("⚠ These numbers are old: " if old else "") + " · ".join([heard, asked] + ([f"{failed} network {'miss' if failed == 1 else 'misses'} since this window opened"] if failed else [])),
            fg=BAD if old else MUTED,
            font=(FONT + (" Semibold" if old else ""), 9),
        )
        rules = f"Each buy {bridge.rp(order)} · at most {int(bridge.number(report.get('maxOpen')))} open · a coin is sold if its price falls {bridge.number(report.get('stopPercent')):g}% under what was paid" if report else ""
        newer = newer_version(view)
        update = f" · TradeBot {newer} is out: {UPDATE_WORDS}" if newer else ""
        footer.configure(text=(rules + " · " if rules else "") + "This window only shows and switches: orders are made by the sender. Not financial advice; a strategy can lose money." + update)

    def start_sender():
        choice = start_choice(seen["outside"], local_is_fresh(read_local(report_path), time.time() * 1000))
        if choice != "start":
            # The wish to run a sender here stands: pump() tries again, and each reason is said once.
            if seen["start_later"] != choice:
                seen["start_later"] = choice
                desk_line(
                    "not started: another sender is already running. Two senders must never run together. One starts here by itself when that one is gone."
                    if choice == "blocked"
                    else "a sender wrote its report a moment ago but none is running now. Starting one here by itself once that report is three minutes old."
                )
            return False
        seen["start_later"] = ""
        sender.start()
        desk_line("sender started (hidden, inside this window). Its first line can take a minute or two on a slow network.")
        return True

    def on_sender_button():
        if demo:
            messagebox.showinfo("Demo", "This is the demo: there is no sender behind it.")
            return
        if sender.running():
            if messagebox.askyesno("Stop the sender", "Stop the sender?\n\nNothing is bought or sold while it is stopped, and a falling price is not acted on. Coins you hold stay in your Indodax account."):
                sender.stop()
                desk_line("sender stopped by you.")
        elif outside_running():
            pids = seen["outside"]
            if not pids:
                start_sender()
                paint()
                messagebox.showinfo("Sender", "The last sender was closed a moment ago. A new one starts here by itself within three minutes; you do not need to press anything.")
                return
            if messagebox.askyesno("Take it over", "A sender is running in another window. Stop that one and run it here instead?"):
                for pid in pids:
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW if sys.platform == "win32" else 0)
                seen["outside"] = []
                seen["start_later"] = ""
                desk_line("the sender outside this window was stopped.")
                sender.start()
                desk_line("sender started (hidden, inside this window).")
        else:
            start_sender()
        paint()

    def on_pause_button():
        if demo:
            messagebox.showinfo("Demo", "This is the demo: nothing is paused.")
            return
        paused = bool(tiles(seen["view"], read_local(report_path), time.time() * 1000)["paused"])
        if paused and not messagebox.askyesno("Allow buying", "Allow the sender to buy again? In real mode the next copy is bought with your own rupiah."):
            return

        def work():
            try:
                server.pause(not paused)
                events.put(("log", f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] buying {'allowed again' if paused else 'paused'}. The sender reads this within a minute."))
            except (bridge.ApiError, bridge.SettingsError) as problem:
                events.put(("log", f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] could not change the pause: {problem}"))
            fetch()

        threading.Thread(target=work, daemon=True).start()

    def pump():
        try:
            while True:
                event = events.get_nowait()
                if event[0] == "log":
                    add_log(event[1])
                else:
                    seen["view"], seen["error"], seen["outside"] = event[1], event[2], event[3]
                    seen["busy"], seen["asked"] = False, time.time()
                    paint()
        except queue.Empty:
            pass
        # A window reopened right after its sender was closed starts one as soon as the old report has aged.
        if seen["start_later"] and not sender.running() and time.time() >= seen["start_check"]:
            seen["start_check"] = time.time() + 5
            before = seen["start_later"]
            if start_sender() or seen["start_later"] != before:
                paint()
        # A sender that ended by itself is started again a minute later, unless its settings are wrong.
        if sender.wanted and not sender.running():
            if sender.exit_code() == 2:
                sender.wanted = False
                desk_line("not restarted: the sender says its settings or its state file are wrong (see the lines above).")
            elif not seen["restart_at"]:
                seen["restart_at"] = time.time() + RESTART_SECONDS
                desk_line(f"the sender ended by itself. Starting it again in {RESTART_SECONDS} seconds.")
            elif time.time() >= seen["restart_at"]:
                seen["restart_at"] = 0.0
                sender.start()
                desk_line("sender started again.")
            paint()
        root.after(500, pump)

    def tick():
        refresh()
        root.after(REFRESH_SECONDS * 1000, tick)

    def repaint():
        paint()
        root.after(5000, repaint)

    def on_resize(event):
        """Wrap the text again a moment after the window stops changing size."""
        if event.widget is root:
            if seen["resize"]:
                root.after_cancel(seen["resize"])
            seen["resize"] = root.after(250, paint)

    def on_close():
        if sender.running() and not messagebox.askyesno("Close", "Closing this window also stops the sender, so nothing is bought or sold until you open it again.\n\nClose it?"):
            return
        sender.stop()
        if holder is not None:
            holder.close()
        root.destroy()

    sender_button.configure(command=on_sender_button)
    pause_button.configure(command=on_pause_button)
    refresh_button.configure(command=refresh)
    root.protocol("WM_DELETE_WINDOW", on_close)

    desk_line("demo numbers: no account and no sender are behind this window." if demo else f"window opened. Folder: {folder}")
    if not demo and not args.no_start:
        # Look for a sender outside this window first: two must never run together.
        seen["outside"] = sender_candidates(list_python_processes())
        start_sender()
    tick()
    pump()
    repaint()
    root.bind("<Configure>", on_resize, add="+")
    if args.shot:
        # For screenshots and the test of the window itself: draw, save nothing, close by itself.
        root.after(int(float(args.shot) * 1000), root.destroy)
    root.mainloop()
    return 0


def output_for_the_window() -> None:
    """Make the sender's lines reach the window that started it, as UTF-8 and one line at a time.

    The one-file app is a program without a console: Python then starts with no stdout at all, even
    when the window gave it a pipe. That pipe is taken up here.
    """
    if sys.stdout is None:
        try:
            sys.stdout = open(1, "w", encoding="utf-8", errors="replace", buffering=1, closefd=False)  # noqa: SIM115 (kept for the life of the process)
        except OSError:
            try:
                import ctypes
                import msvcrt

                handle = ctypes.windll.kernel32.GetStdHandle(-11)
                sys.stdout = open(msvcrt.open_osfhandle(handle, 0), "w", encoding="utf-8", errors="replace", buffering=1)  # noqa: SIM115
            except (OSError, ImportError, AttributeError, ValueError):
                return
    else:
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except (AttributeError, ValueError):
            pass
    if sys.stderr is None:
        sys.stderr = sys.stdout


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # The one-file app is three programs in one: asked this way, it is the sender or the study instead of the window.
    if argv[:1] == ["--sender"]:
        output_for_the_window()
        return bridge.main(argv[1:])
    if argv[:1] == ["--study"]:
        import learn

        return learn.main(argv[1:])
    parser = argparse.ArgumentParser(description="TradeBot's Indodax desk: the sender and its numbers in one window.")
    parser.add_argument("--no-start", action="store_true", help="open the window without starting the sender")
    parser.add_argument("--demo", action="store_true", help="made-up numbers: no sender, no network, nothing private")
    parser.add_argument("--folder", default=str(HERE), help="the folder with bridge.py and .env (default: this one)")
    parser.add_argument("--size", default="", help=argparse.SUPPRESS)
    parser.add_argument("--shot", default="", help=argparse.SUPPRESS)
    parser.add_argument("--trouble", action="store_true", help=argparse.SUPPRESS)  # with --demo: show the warnings
    parser.add_argument("--tab", default="", help=argparse.SUPPRESS)  # the tab shown first: overview, study, report, log
    return open_window(parser.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
