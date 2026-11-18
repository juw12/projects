#!/usr/bin/env python3
"""TradeBot's Indodax desk: one window for the sender and everything it does.

It starts and stops the sender (bridge.py, in this folder) as a hidden child process, so no
console window is needed, and shows in one place: real or practice, the free rupiah, what is
held, the market, what the strategy needs before it buys or sells, the history, the result and
the sender's own log. Two buttons pause and resume buying, the same switch as /indodax pause.

The Agents tab shows the same bot as six roles at work (agents.py): research analyst, market
analyst, strategist, risk manager, execution trader and desk lead, with a chart of Indodax's
price (candles, EMA 20/50/200, SMA 200, RSI, the plan's entry, stop and 1:3 mark), a live feed,
the trades and the technical reading of four timeframes. Every call the desk lead makes is written
down (decisions.py) with the price at the moment of the call, and marked later against the price
one hour, four hours and a day after: right or wrong, under the desk lead's own lines. Rules, not
AI: every line is measured.

    pythonw desk.py            open the window and start the sender
    pythonw desk.py --no-start open the window only
    pythonw desk.py --demo     made-up numbers, for a look around: no sender, no network

TradeBot.exe is this file as one program (built on GitHub, no Python needed): the window, and
the sender and the study as hidden children of it (TradeBot.exe --sender, TradeBot.exe --study).

The sender can also run with no window at all (the button "Run without this window", or
TradeBot.exe --background on): Windows then starts it when you sign in and starts it again
within five minutes if it ever ends. The window then only shows it; closing the window stops nothing.

Standard library only. It never places an order itself and never reads the Indodax API key:
orders are made by bridge.py alone. It talks to TradeBot with the sender's key from .env.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from xml.sax.saxutils import escape

import agents
import bridge
import decisions

VERSION = "0.18.0"  # the same number as apps/tradebot/package.json
FROZEN = bridge.FROZEN  # True inside TradeBot.exe
HERE = bridge.HERE
APP_NAME = "tradebot.exe"
UPDATE_WORDS = "close this window while no coin is held, then run update-desk.cmd in its folder." if bridge.FROZEN else "copy the new files from GitHub while no coin is held."
REFRESH_SECONDS = 30
EMPTY_NOTE_Y = 27  # just under a table's heading row
FRESH_SECONDS = 150  # the sender writes its report file once a minute; older means it is not running
RESTART_SECONDS = 60
LOG_LINES = 800
LOG_FILE_BYTES = bridge.LOG_FILE_BYTES
LOG_NAME = "desk_sender.log"
EARLIER_LINES = 40  # this many of the last lines in that file are shown when the window opens
TASK_NAME = "TradeBot sender"  # the Windows task that runs the sender with no window
TASK_MINUTES = 5  # Windows looks this often whether that sender still runs, and starts it when it does not
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
    bridge.append_line(path, line)


def log_news(path, seen_bytes) -> tuple:
    """The whole lines added to the log file after seen_bytes: (lines, the new seen_bytes).

    A sender without a window writes its own lines to the file; this is how the window shows them.
    A file smaller than before was set aside and begun again, so it is read from its start.
    """
    try:
        with open(path, "rb") as handle:
            size = handle.seek(0, 2)
            start = seen_bytes if 0 <= seen_bytes <= size else 0
            handle.seek(start)
            data = handle.read(size - start)
    except OSError:
        return [], seen_bytes
    whole = data.rfind(b"\n") + 1  # a line still being written waits for its end
    return data[:whole].decode("utf-8", errors="replace").splitlines(), start + whole


# ---------------------------------------------------------------- the sender with no window (a Windows task)


def background_command(folder, python=None) -> tuple:
    """The program and its arguments for a sender with no window. It writes its lines to the log file itself."""
    log = Path(folder) / LOG_NAME
    if FROZEN:
        return sys.executable, f'--sender --log "{log}"'
    quiet = Path(python or sys.executable).with_name("pythonw.exe")
    return str(quiet), f'-u "{Path(folder) / "bridge.py"}" --log "{log}"'


def task_xml(command, arguments, folder, user) -> str:
    """The Windows task: start at sign-in, look again every few minutes, one at a time, no time limit, on battery too."""
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>TradeBot's Indodax sender, running with no window. Made by the TradeBot window (Run without this window); switch it off there.</Description>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>{escape(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <UserId>{escape(user)}</UserId>
    </LogonTrigger>
    <TimeTrigger>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Repetition>
        <Interval>PT{TASK_MINUTES}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>{escape(str(command))}</Command>
      <Arguments>{escape(arguments)}</Arguments>
      <WorkingDirectory>{escape(str(folder))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def task_call(arguments, run=subprocess.run) -> tuple:
    """One call to Windows' schtasks about the sender's task: (it worked, what Windows said)."""
    if sys.platform != "win32" and run is subprocess.run:
        return False, "This needs Windows."
    try:
        done = run(["schtasks", *arguments], capture_output=True, text=True, timeout=30, creationflags=NO_WINDOW if sys.platform == "win32" else 0)
    except (OSError, subprocess.SubprocessError) as problem:
        return False, f"Windows' task list could not be asked ({type(problem).__name__})."
    worked = done.returncode == 0
    said = (done.stdout or "") if worked else (done.stderr or "").strip() or (done.stdout or "")
    return worked, " ".join(said.split())


def background_state(run=subprocess.run) -> str:
    """'on' (Windows keeps the sender running), 'stopped' (set up, but stopped by you) or 'off' (not set up)."""
    found, said = task_call(["/query", "/tn", TASK_NAME, "/xml"], run)
    if not found:
        return "off"
    settings = re.search(r"<Settings>.*?</Settings>", said, re.S)
    stopped = settings and re.search(r"<Enabled>\s*false\s*</Enabled>", settings.group(0))
    return "stopped" if stopped else "on"


def background_on(folder, run=subprocess.run, user=None) -> str:
    """Hand the sender to Windows and start it. '' when done, else why not."""
    user = user or "\\".join(part for part in (os.environ.get("USERDOMAIN", ""), os.environ.get("USERNAME", "")) if part)
    command, arguments = background_command(folder)
    with tempfile.NamedTemporaryFile("w", suffix=".xml", encoding="utf-16", delete=False) as handle:
        handle.write(task_xml(command, arguments, folder, user))
    try:
        made, said = task_call(["/create", "/tn", TASK_NAME, "/xml", handle.name, "/f"], run)
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass
    if not made:
        return said or "Windows did not take the task."
    started, said = task_call(["/run", "/tn", TASK_NAME], run)
    return "" if started else said or "Windows did not start the task."


def background_off(run=subprocess.run) -> str:
    """End that sender and take the task away. '' when done, else why not."""
    task_call(["/end", "/tn", TASK_NAME], run)
    gone, said = task_call(["/delete", "/tn", TASK_NAME, "/f"], run)
    return "" if gone else said or "Windows did not remove the task."


def background_stop(run=subprocess.run) -> str:
    """Stop that sender and keep it stopped (the task stays, switched off). '' when done, else why not."""
    held, said = task_call(["/change", "/tn", TASK_NAME, "/disable"], run)
    if not held:
        return said or "Windows did not switch the task off."
    task_call(["/end", "/tn", TASK_NAME], run)
    return ""


def background_start(run=subprocess.run) -> str:
    """Switch the task on again and start that sender now. '' when done, else why not."""
    allowed, said = task_call(["/change", "/tn", TASK_NAME, "/enable"], run)
    if not allowed:
        return said or "Windows did not switch the task on."
    started, said = task_call(["/run", "/tn", TASK_NAME], run)
    return "" if started else said or "Windows did not start the task."


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
    in a moment), 'background' (running with no window, kept by Windows), 'starting' (Windows is starting
    that one) or 'stopped'.
    Nothing is returned when all is fine, so a warning always means something.
    """
    report = report_of(view, local)
    real = report.get("mode") == "real"
    found = []
    if sender_state == "stopped":
        found.append(("bad", "The sender is stopped. Nothing is bought or sold, and a falling price is not acted on. Press Start the sender."))
    if sender_state == "waiting":
        found.append(("warn", "The sender starts by itself within three minutes: the last one was closed a moment ago, and two must never run together."))
    if sender_state == "starting":
        found.append(("warn", f"Windows is starting the sender in the background. Its first report can take a minute or two; Windows tries again every {TASK_MINUTES} minutes."))
    if report.get("tripped"):
        why = str(report.get("trippedWhy") or "").strip()
        found.append(("bad", f"Safety stop: real buying is blocked until you have looked at Indodax.{' ' + why if why else ''}"))
    if real and report and not report.get("checked"):
        found.append(("bad", "Real mode is on, but the API key has not passed its check on this PC, so nothing is bought."))
    if sender_state not in ("stopped", "waiting", "starting") and local and not local_is_fresh(local, now_ms):
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
    """One row per coin the strategy watches:
    {coin, action, label, checks: [(ok, name, text)], why, change, soon: [(yes / no / warn / wait, text)]}.

    soon is the heads-up: how near a buy or a sale is. Its first line carries the colour.
    """
    rows = []
    for item in (view or {}).get("signals") or []:
        coin = coin_name(item.get("coin"))
        if item.get("error"):
            rows.append({"coin": coin, "action": "?", "label": "no fresh price", "checks": [], "why": "It tries again at its next 5-minute check.", "change": "", "soon": []})
            continue
        action = str(item.get("action") or "WAIT").upper()
        change = item.get("change24h")
        soon = agents.heads_up(item)
        rows.append({
            "coin": coin,
            "action": action,
            "label": ACTION_WORDS.get(action, action),
            "checks": [(bool(check.get("ok")), str(check.get("name") or ""), str(check.get("text") or "")) for check in item.get("checks") or []],
            "why": str(item.get("why") or ""),
            "change": f"{'+' if change >= 0 else '−'}{abs(change):.1f}% in 24 hours".replace(".", ",") if isinstance(change, (int, float)) else "",
            "soon": [(agents.soon_state(soon) if index == 0 else "wait", line) for index, line in enumerate(soon["lines"])] if soon else [],
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


def value_anchor(x, width, left=30) -> tuple:
    """Where the newest value is written against its dot: (the x to write at, the anchor).

    Above the dot when there is room. Hard against the left edge (the first days) it would run
    into the scale's own numbers, so it is written to the right of the dot (nothing is drawn there:
    the newest dot is the last one); at the right edge it ends at the dot."""
    if x >= width - 40:
        return x, "se"
    if x < left + 20:
        return x + 10, "w"
    return x, "s"


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
            {"coin": "BTC", "action": "HOLD", "why": "holding: trend and momentum are still up", "checks": checks_up, "change24h": 1.8, "soon": {"kind": "sell", "level": "far", "at": now_ms + 2 * hour, "lines": [
                "⚪ Heads-up: no sale in sight. I sell at 15:00 WIB only if the candle closes under Rp 1.171.300.000 (3,6% under the price now), or at any hour if the price falls to the stop at Rp 1.142.800.000 (5,9% under the price now). One usual candle move is 1,3%.",
                "🛡 The sender's own stop (8% under the price paid) is at Rp 1.098.388.000 per coin: the Indodax price is 10.6% above it.",
            ]}},
            {"coin": "ETH", "action": "WAIT", "why": "waiting for momentum and RSI", "checks": checks_down, "change24h": -0.6, "soon": {"kind": "buy", "level": "near", "at": now_ms + 2 * hour, "lines": [
                "🟡 Heads-up: a buy is close. At 15:00 WIB (in 2 h) it needs a close above Rp 58.940.000 (+1,1% from now): less than one usual candle move (1,6%).",
                "Earliest by my estimate: today 15:00 WIB (this candle), and only if the price climbs steadily to about Rp 58.940.000 (+1,1%). A rough estimate, not a forecast.",
            ]}},
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
# The Agents tab. An agent is: yes (green), wait (grey), no (red), warn (amber), off (no data), or looking right now.
STATE_COLOURS = {"yes": GOOD, "no": BAD, "warn": "#b26a00", "wait": MUTED, "off": "#aeb4bd", "think": "#d97706"}
STATE_FILLS = {"yes": "#e3f3e8", "no": "#fde7e5", "warn": "#fff1cc", "wait": "#eef0f3", "off": "#f3f4f6", "think": "#ffe9c2"}
STATE_GLYPHS = {"yes": "✓", "no": "✗", "warn": "!", "wait": "…", "off": "○", "think": "…"}
RSI_COLOUR = "#7a3e9d"
CHART_LINES = [("ema20", "EMA 20", ACCENT, ()), ("ema50", "EMA 50", "#d97706", ()), ("ema200", "EMA 200", "#7c3aed", ()), ("sma200", "SMA 200", "#0f766e", (5, 3))]
CHART_TOGGLES = [(name, title, colour) for name, title, colour, _dash in CHART_LINES] + [("rsi", "RSI", RSI_COLOUR), ("plan", "Plan", INK)]
ROUND_STEP_MS = 320  # how long one agent is shown looking, when the six look one after the other
FEED_LINES = 120
CANDLE_SECONDS = 60  # the charts are read again this often
MOOD_SECONDS = 3600  # the mood of the market comes once a day: asked for once an hour
MOOD_RETRY_SECONDS = 600  # ... and ten minutes after a miss
DEMO_PRICES = {"BTC": 1_214_700_000, "ETH": 51_300_000}


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
    log_path = folder / LOG_NAME
    events = queue.Queue()
    server = Server(env_path)
    sender = Sender(folder, lambda line: events.put(("log", line)))
    seen = {"view": None, "error": "", "outside": [], "restart_at": 0.0, "busy": False, "asked": 0.0, "drawn": None, "lines": [], "banner_height": 0, "resize": None, "start_later": "", "start_check": 0.0, "studied": None}
    # What the Agents tab remembers: the six as worked out (team) and as shown (shown), the feed, the candles and the chart's view.
    seen.update({
        "team": [], "shown": {}, "round": None, "round_news": 0, "agent": "lead", "agent_drawn": None, "feed": [], "plan": None,
        "coin": "", "coin_pick": "", "candles": {}, "readings": {}, "marks": {}, "candle_busy": False, "agents_broken": False, "candle_note": "", "trade_marks": [],
        "log": decisions.load(folder / decisions.JSON_NAME),
        "tf": "4H", "visible": agents.START_VISIBLE, "offset": 0, "toggles": {name: True for name, _title, _colour in CHART_TOGGLES},
        "geometry": None, "hover": None, "drag": None, "chart_job": None, "chart_drawn": None, "trades_drawn": None, "reading_drawn": None,
        "summary": None, "summary_at": None, "mood": None, "mood_at": 0.0, "debate": None, "soon": None,
    })
    # The sender with no window: how Windows holds it, the lines this window wrote itself, and how far the log file was read.
    earlier, log_bytes = ([], 0) if demo else log_news(log_path, -1)
    seen.update({"background": "off", "own": [], "log_bytes": log_bytes, "log_check": 0.0})
    learn_path = folder / "learn.json"
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
    background_button = button()
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
    agents_tab = tk.Frame(book, bg=CARD)
    book.add(overview, text="Overview")
    book.add(agents_tab, text="Agents")
    book.add(study, text="Study")
    book.add(report_box, text="Full report")
    book.add(log_box, text="Sender log")
    tabs = {"overview": overview, "agents": agents_tab, "study": study, "report": report_box, "log": log_box}
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
        value_x, anchor = value_anchor(x, width, left)
        canvas.create_text(value_x, y if anchor == "w" else y - 12, text=points_text(curve[-1][1]), anchor=anchor, font=(FONT + " Semibold", 10), fill=INK)
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

    # ------------------------------------------------------------ the Agents tab
    # Six roles of one rule-based bot, shown at work: the floor with the six on top, the chart with its
    # averages on the left, and on the right the live feed, one agent's own lines, the trades and the reading.
    floor = tk.Canvas(agents_tab, height=104, bg=CARD, highlightthickness=0, cursor="hand2")
    floor.pack(fill="x", padx=10, pady=(8, 0))
    floor_note = label(agents_tab, "The agents look again every 30 seconds. " + agents.NOT_AI, 8, MUTED)
    floor_note.pack(fill="x", padx=14)
    lower = tk.Frame(agents_tab, bg=CARD)
    lower.pack(fill="both", expand=True, padx=10, pady=(2, 8))
    lower.grid_columnconfigure(0, weight=13, uniform="agents")
    lower.grid_columnconfigure(1, weight=8, uniform="agents")
    lower.grid_rowconfigure(0, weight=1)
    chart_pane = tk.Frame(lower, bg=CARD)
    chart_pane.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
    side = ttk.Notebook(lower)
    side.grid(row=0, column=1, sticky="nsew")

    def side_box():
        return ScrolledText(side, wrap="word", font=(FONT, 9), state="disabled", padx=8, pady=6, relief="flat", width=10, height=4, spacing1=1)

    feed_box, agent_box, reading_box = side_box(), side_box(), side_box()
    trades_pane = tk.Frame(side, bg=CARD)
    side.add(feed_box, text="Live feed")
    side.add(agent_box, text="Agent")
    side.add(trades_pane, text="Trades")
    side.add(reading_box, text="Analysis")
    side_tabs = {"feed": feed_box, "agent": agent_box, "trades": trades_pane, "analysis": reading_box}
    if args.side in side_tabs:
        side.select(side_tabs[args.side])
    for box in (feed_box, agent_box, reading_box):
        box.tag_configure("name", font=(FONT + " Semibold", 10), foreground=INK)
        box.tag_configure("muted", foreground=MUTED)
        box.tag_configure("small", font=(FONT, 8), foreground=MUTED)
        box.tag_configure("ok", foreground=GOOD)
        box.tag_configure("bad", foreground=BAD)
        box.tag_configure("indent", lmargin1=2, lmargin2=18)
        for state, colour in STATE_COLOURS.items():
            box.tag_configure(state, foreground=colour, font=(FONT + " Semibold", 9))

    def write_box(box, pieces):
        """Set a text box to these (text, tags) pieces without moving what the reader was looking at."""
        top = box.yview()[0]
        box.configure(state="normal")
        box.delete("1.0", "end")
        for text, tags in pieces:
            box.insert("end", text, tags)
        box.configure(state="disabled")
        box.yview_moveto(top)

    def draw_floor():
        width = floor.winfo_width()
        floor.delete("all")
        if width < 300:
            return
        slot = width / len(agents.ROLES)
        y, radius = 24, 17
        thinking = seen["round"]
        for index, (key, name, short, _role) in enumerate(agents.ROLES):
            x = slot * (index + 0.5)
            member = seen["shown"].get(key)
            state = "think" if thinking == index else member["state"] if member else "off"
            if key == seen["agent"]:
                floor.create_rectangle(x - slot / 2 + 4, 1, x + slot / 2 - 4, 102, fill="#f5f8ff", outline="#c9dafc")
            if index:
                live = thinking == index
                floor.create_line(x - slot + radius + 9, y, x - radius - 9, y, fill=STATE_COLOURS["think"] if live else "#aeb4bd", width=2 if live else 1, arrow="last", arrowshape=(7, 8, 3))
            floor.create_oval(x - radius, y - radius, x + radius, y + radius, fill=STATE_FILLS[state], outline=STATE_COLOURS[state], width=3 if state == "think" else 2)
            floor.create_text(x, y, text=short, font=(FONT + " Semibold", 9), fill=INK if state != "off" else MUTED)
            floor.create_oval(x + radius - 10, y + radius - 10, x + radius + 4, y + radius + 4, fill=STATE_COLOURS[state], outline=CARD, width=2)
            floor.create_text(x + radius - 3, y + radius - 3, text=STATE_GLYPHS[state], font=(FONT + " Semibold", 7), fill="white")
            floor.create_text(x, y + radius + 12, text=name, font=(FONT + " Semibold", 9), fill=INK)
            head = "looking…" if state == "think" else member["head"] if member else "waiting for the first look"
            floor.create_text(x, y + radius + 21, text=head, font=(FONT, 8), fill=STATE_COLOURS[state] if state in ("no", "warn", "think") else MUTED, width=slot - 14, justify="center", anchor="n")

    def draw_feed():
        pieces = []
        for item in seen["feed"]:
            pieces.append(("● ", (item["state"],)))
            pieces.append((item["name"], ("name",)))
            pieces.append((f"   {agents.clock(item['at'], day=False)} WIB\n", ("small",)))
            pieces.append((item["text"] + "\n\n", ("indent",)))
        write_box(feed_box, pieces or [("The agents speak here when something changes: a new reading, a buy, a sale, a stop.\n", ("muted",))])

    def add_feed(key, text, state="wait"):
        name = next(name for found, name, _short, _role in agents.ROLES if found == key)
        if seen["feed"] and (seen["feed"][0]["key"], seen["feed"][0]["text"]) == (key, text):
            return
        seen["feed"] = ([{"at": time.time() * 1000, "key": key, "name": name, "state": state, "text": text}] + seen["feed"])[:FEED_LINES]
        draw_feed()

    def draw_agent():
        member = seen["shown"].get(seen["agent"])
        logged = decisions.rows(seen["log"], 6) if seen["agent"] == "lead" and seen["log"] else []
        line = decisions.summary(seen["log"], time.time() * 1000) if seen["log"] else ""
        signature = json.dumps([member, logged, line], default=str)
        if signature == seen["agent_drawn"]:
            return
        seen["agent_drawn"] = signature
        if not member:
            write_box(agent_box, [("Click an agent on the floor above to read its lines.\n", ("muted",))])
            return
        pieces = [(member["name"] + "\n", ("name",)), (member["role"] + "\n\n", ("muted",)), ("● " + member["head"] + "\n\n", (member["state"],))]
        for mark, text in member["lines"]:
            pieces.append(({"ok": "✓ ", "no": "✗ "}.get(mark, "·  "), ("ok" if mark == "ok" else "bad" if mark == "no" else "muted", "indent")))
            pieces.append((text + "\n", ("indent",)))
        if seen["agent"] == "lead":
            # The call log, under the desk lead: what it said, and what the price did after. Display only.
            pieces.append(("\nThe desk lead's calls, marked later\n", ("name",)))
            pieces.append((line + "\n\n", ("muted",)))
            for row in logged:
                pieces.append((decisions.MARK_GLYPHS.get(row["mark"], "·") + " ", ({"right": "ok", "wrong": "bad"}.get(row["mark"], "muted"),)))
                pieces.append((f"{agents.clock(row['at'])} WIB\n", ("small",)))
                pieces.append((f"{row['kind']} {row['coin']} at {agents.price_text(row['price'])}\n", ("indent", "name")))
                pieces.append((f"{row['did']}\n", ("indent", "small")))
                pieces.append((row["words"] + "\n\n", ("indent", "muted")))
            pieces.append((decisions.GUIDE + "\n\n", ("small",)))
        pieces.append(("\n" + member["hands"] + "\n", ("small",)))
        write_box(agent_box, pieces)

    def on_floor_click(event):
        slot = max(1.0, floor.winfo_width() / len(agents.ROLES))
        seen["agent"] = agents.ROLES[int(max(0, min(len(agents.ROLES) - 1, event.x // slot)))][0]
        draw_floor()
        draw_agent()
        side.select(agent_box)

    floor.bind("<Button-1>", on_floor_click)
    floor.bind("<Configure>", lambda _event: draw_floor())

    def start_round():
        """The six look one after the other. A look with nothing new is still shown: it is how the desk works."""
        if seen["round"] is not None or not seen["team"]:
            return
        seen["round"], seen["round_news"] = 0, 0
        draw_floor()
        root.after(ROUND_STEP_MS, settle_round)

    def settle_round():
        index, team = seen["round"], seen["team"]
        if index is None:
            return
        if index < len(team):
            member = team[index]
            for item in agents.feed_events(seen["shown"], [member], time.time() * 1000):
                seen["round_news"] += 1
                add_feed(item["key"], item["text"], item["state"])
            seen["shown"][member["key"]] = member
            if member["key"] == seen["agent"]:
                draw_agent()
        seen["round"] = index + 1 if index + 1 < len(team) else None
        draw_floor()
        if seen["round"] is None:
            news = seen["round_news"]
            floor_note.configure(text=f"Last look {time.strftime('%H:%M:%S')} · {'nothing changed' if not news else str(news) + (' agent has' if news == 1 else ' agents have') + ' something new'} · " + agents.NOT_AI)
        else:
            root.after(ROUND_STEP_MS, settle_round)

    # The trades: what is held, every buy and sale, and the result.
    position_label = label(trades_pane, "", 9, INK)
    position_label.pack(fill="x", padx=8, pady=(8, 4))
    result_label = label(trades_pane, "", 9, MUTED)
    result_label.pack(side="bottom", fill="x", padx=8, pady=(4, 6))
    style.configure("Trades.Treeview", font=(FONT, 9), rowheight=22)
    trades_tree = ttk.Treeview(trades_pane, columns=["When", "Order", "Rupiah", "1 coin, Rp", "Result"], show="headings", selectmode="none", height=4, style="Trades.Treeview")
    trade_columns = [("When", 82, "w"), ("Order", 62, "w"), ("Rupiah", 62, "e"), ("1 coin, Rp", 70, "e"), ("Result", 58, "e")]
    for name, width, where in trade_columns:
        trades_tree.heading(name, text=name, anchor=where)
        trades_tree.column(name, width=width, minwidth=36, anchor=where, stretch=False)
    trades_tree.pack(fill="both", expand=True, padx=8)

    def fit_trades(event):
        """Share the width the pane really has, so the last column is never cut off."""
        room, asked = max(200, event.width - 6), sum(width for _name, width, _where in trade_columns)
        for name, width, _where in trade_columns:
            trades_tree.column(name, width=int(room * width / asked))

    trades_tree.bind("<Configure>", fit_trades)
    trades_tree.tag_configure("up", foreground=GOOD)
    trades_tree.tag_configure("down", foreground=BAD)
    trades_pane.bind("<Configure>", lambda event: [made.configure(wraplength=max(200, event.width - 20)) for made in (position_label, result_label)])

    def draw_trades(report, real):
        rows = agents.execution_rows(report, real)
        held = agents.position_lines(report, seen["plan"] if seen["plan"] and seen["plan"].get("trail") else None)
        result = agents.result_line(report, real)
        signature = json.dumps([rows, held, result], default=str)
        if signature == seen["trades_drawn"]:
            return
        seen["trades_drawn"] = signature
        position_label.configure(text="\n".join(held) if held else "No coin is held: all the money is in rupiah.")
        result_label.configure(text=result)
        trades_tree.delete(*trades_tree.get_children())
        for row in rows:
            trades_tree.insert("", "end", values=(row["when"], f"{row['side']} {row['coin']}", row["amount"], row["price"], row["result"]), tags=(row["tag"],) if row["tag"] else ())

    def draw_reading():
        coin = seen["coin"]
        readings = seen["readings"].get(coin) or {}
        made = seen["plan"]
        weighed = seen["debate"]
        signature = json.dumps([coin, readings, made, weighed, seen["mood"]], default=str)
        if signature == seen["reading_drawn"]:
            return
        seen["reading_drawn"] = signature
        look = agents.top_down(readings)
        pieces = [(f"{coin}/IDR at Indodax, top-down\n", ("name",)), (look["text"] + "\n\n", ())]
        if weighed and weighed.get("share") is not None:
            pieces.append(("Bull against bear · rating: ", ("name",)))
            pieces.append((f"{weighed['name']}\n", ({"buy": "yes", "lean_buy": "yes", "lean_out": "no", "out": "no"}.get(weighed["rating"], "wait"),)))
            pieces.append((f"{weighed['share']} of 100 by weight are for a buy (a wider chart counts for more). {weighed['text']}\n", ()))
            for title, points, tag in (("For a buy", weighed["pro"], "yes"), ("Against", weighed["con"], "no")):
                pieces.append((f"{title} ({len(points)})\n", (tag,)))
                for point in points or ["nothing"]:
                    pieces.append(("·  ", ("muted", "indent")))
                    pieces.append((point + "\n", ("indent",)))
            if agents.mood_text(seen["mood"]):
                pieces.append((agents.mood_text(seen["mood"]) + "\n", ("small",)))
            pieces.append(("The rating sums up the charts. The bot buys and sells by the rules' checks alone.\n\n", ("small",)))
        for frame in agents.TIMEFRAMES:
            found = readings.get(frame["key"])
            bias = (found or {}).get("bias", "none")
            pieces.append((f"{frame['name']} · {frame['role']} · ", ("name",)))
            pieces.append((f"{agents.BIAS_WORDS[bias]} {agents.BIAS_MARKS[bias]}\n", ({"up": "yes", "down": "no"}.get(bias, "wait"),)))
            for sentence in agents.analysis(found):
                pieces.append(("·  ", ("muted", "indent")))
                pieces.append((sentence + "\n", ("indent",)))
            pieces.append(("\n", ()))
        if made:
            holding = bool(made.get("trail"))
            pieces.append(("The plan of the coin held\n" if holding else "The plan, if it were bought now\n", ("name",)))
            pieces.append((f"·  Entry {bridge.rp(made['entry'])} a coin\n", ("indent",)))
            pieces.append((f"·  Stop {bridge.rp(made['stop'])}: risk {agents.pct(made['riskPercent'])}, about {bridge.rp(made['riskIdr'])} of one buy\n", ("indent",)))
            pieces.append((f"·  1:3 mark {bridge.rp(made['target'])}: three times that risk, about {bridge.signed_rp(made['rewardIdr'])}\n", ("indent",)))
            if holding:
                pieces.append((f"·  Now {agents.signed(made['reached'], 2)} R; the moving stop is about {bridge.rp(made['trail'])}\n", ("indent",)))
            pieces.append(("·  The bot does not sell at the 1:3 mark by itself. It moves the stop up behind the price, so a winner can run further. Selling at 1:3 is followed on paper by the research analyst.\n\n", ("indent",)))
        pieces.append(("EMA: an average that follows the newest prices faster. SMA: the plain average. RSI: a 0 to 100 gauge of how fast the price rose lately. ATR: how far one candle usually moves. R: the risk a coin was bought with. jt: million rupiah.\n", ("small",)))
        pieces.append((agents.NOT_AI + " A reading is not a promise.\n", ("small",)))
        write_box(reading_box, pieces)

    # The chart: candles, the averages of the rules, RSI under it, and the plan's three prices.
    chart_bar = tk.Frame(chart_pane, bg=CARD)
    chart_bar.pack(fill="x", pady=(4, 4))
    coin_label = label(chart_bar, "", 11, bold=True)
    coin_label.pack(side="left")
    frame_labels, toggle_labels = {}, {}

    def pick_frame(key):
        seen["tf"], seen["offset"] = key, 0
        draw_chart_bar()
        draw_candles()

    def flip(name):
        seen["toggles"][name] = not seen["toggles"][name]
        draw_chart_bar()
        draw_candles()

    def next_coin(_event=None):
        names = sorted(traded)
        if len(names) > 1:
            seen["coin_pick"] = names[(names.index(seen["coin"]) + 1) % len(names)] if seen["coin"] in names else names[0]
            paint()

    coin_label.bind("<Button-1>", next_coin)
    for position, frame in enumerate(agents.TIMEFRAMES):
        made = tk.Label(chart_bar, text=frame["key"], font=(FONT + " Semibold", 9), padx=7, pady=2, cursor="hand2")
        made.pack(side="left", padx=(10 if position == 0 else 3, 0))
        made.bind("<Button-1>", lambda _event, key=frame["key"]: pick_frame(key))
        frame_labels[frame["key"]] = made
    legend_bar = tk.Frame(chart_pane, bg=CARD)
    legend_bar.pack(fill="x", pady=(0, 3))
    for name, title, _colour in CHART_TOGGLES:
        made = tk.Label(legend_bar, text=title, font=(FONT, 8), padx=3, bg=CARD, cursor="hand2")
        made.pack(side="left")
        made.bind("<Button-1>", lambda _event, name=name: flip(name))
        toggle_labels[name] = made
    chart_hint = label(chart_pane, "Wheel: zoom · drag: slide · double-click: back to now · click a line's name to hide it", 8, MUTED)
    chart_hint.pack(side="bottom", fill="x")
    chart_note = label(chart_pane, "", 9, INK)
    chart_note.pack(side="bottom", fill="x", pady=(4, 0))
    chart_canvas = tk.Canvas(chart_pane, bg=CARD, highlightthickness=1, highlightbackground=LINE, cursor="crosshair")
    chart_canvas.pack(fill="both", expand=True)
    chart_pane.bind("<Configure>", lambda event: chart_note.configure(wraplength=max(240, event.width - 10)))

    def chart_rows():
        return (seen["candles"].get(seen["coin"]) or {}).get(seen["tf"]) or []

    def draw_chart_bar():
        readings = seen["readings"].get(seen["coin"]) or {}
        coin_label.configure(text=f"{seen['coin'] or '…'}/IDR" + (" ▾" if len(traded) > 1 else ""), cursor="hand2" if len(traded) > 1 else "")
        for key, made in frame_labels.items():
            bias = (readings.get(key) or {}).get("bias", "none")
            chosen = key == seen["tf"]
            made.configure(text=f"{key} {agents.BIAS_MARKS[bias]}", bg=ACCENT if chosen else TRACK, fg="white" if chosen else GOOD if bias == "up" else BAD if bias == "down" else MUTED)
        for name, title, colour in CHART_TOGGLES:
            on = seen["toggles"][name]
            toggle_labels[name].configure(text=("━ " if on else "┄ ") + title, fg=colour if on else "#aeb4bd")
        note = agents.caption(readings.get(seen["tf"]))
        chart_note.configure(text=note + (f"\n{seen['candle_note']}" if seen["candle_note"] and chart_rows() else ""))

    def plan_levels(made):
        if not made:
            return []
        if made.get("trail"):
            return [("paid", made["entry"], INK), ("stop now", made["trail"], BAD), ("1:3 mark", made["target"], GOOD)]
        return [("entry if bought now", made["entry"], INK), ("stop", made["stop"], BAD), ("1:3 mark", made["target"], GOOD)]

    def draw_candles():
        canvas = chart_canvas
        width, height = canvas.winfo_width(), canvas.winfo_height()
        canvas.delete("all")
        seen["geometry"] = None
        rows = chart_rows()
        if width < 160 or height < 90:
            return
        if not rows:
            canvas.create_text(width / 2, height / 2, text=seen["candle_note"] or "Reading the chart from Indodax…", font=(FONT, 10), fill=MUTED, width=width - 40, justify="center")
            return
        key, on = seen["tf"], seen["toggles"]
        drawn = (seen["marks"].get(seen["coin"]) or {}).get(key) or agents.indicators(rows)
        visible, offset = agents.clamp_window(len(rows), seen["visible"], seen["offset"])
        seen["visible"], seen["offset"] = visible, offset
        first, end = agents.shown_span(len(rows), visible, offset)
        left, right, top, bottom = 6, 66, 44, 16
        under = max(46, int(height * 0.2)) if on["rsi"] and height >= 190 else 0
        price_bottom = height - bottom - (under + 8 if under else 0)
        step = (width - left - right) / visible
        levels = plan_levels(seen["plan"]) if on["plan"] else []
        low, high = agents.price_bounds(rows[first:end], [drawn[name][first:end] for name, _title, _colour, _dash in CHART_LINES if on[name]], [value for _title, value, _colour in levels])
        span = high - low

        def y_of(price):
            return top + (price_bottom - top) * (high - price) / span

        def x_of(index):
            return left + step * (index - first + 0.5)

        for value in agents.ticks(low, high, 5):
            canvas.create_line(left, y_of(value), width - right, y_of(value), fill=TRACK)
            canvas.create_text(width - right + 6, y_of(value), text=agents.price_text(value, high), anchor="w", font=(FONT, 8), fill=MUTED)
        canvas.create_line(width - right, top - 4, width - right, height - bottom, fill=LINE)
        body = step * 0.7
        for index in range(first, end):
            row = rows[index]
            x, colour = x_of(index), GOOD if row["c"] >= row["o"] else BAD
            canvas.create_line(x, y_of(row["h"]), x, y_of(row["l"]), fill=colour)
            if body >= 2:
                upper, lower = y_of(max(row["o"], row["c"])), y_of(min(row["o"], row["c"]))
                canvas.create_rectangle(x - body / 2, upper, x + body / 2, max(lower, upper + 1), fill=colour, outline=colour)
        for name, _title, colour, dash in CHART_LINES:
            points = [place for index in range(first, end) if drawn[name][index] is not None for place in (x_of(index), y_of(drawn[name][index]))] if on[name] else []
            if len(points) >= 4:
                canvas.create_line(*points, fill=colour, width=2, **({"dash": dash} if dash else {}))
        shown = [level for level in levels if low <= level[1] <= high]
        spots = agents.label_spots([y_of(value) for _title, value, _colour in shown])
        for (title, value, colour), spot in zip(shown, spots):
            canvas.create_line(left, y_of(value), width - right, y_of(value), fill=colour, dash=(6, 4))
            words = canvas.create_text(left + 4, spot, text=f"{title} {agents.price_text(value, high)}", anchor="w", font=(FONT + " Semibold", 8), fill=colour)
            canvas.tag_lower(canvas.create_rectangle(*canvas.bbox(words), fill=CARD, outline=""), words)
        last = rows[-1]["c"]
        if low <= last <= high:
            canvas.create_line(left, y_of(last), width - right, y_of(last), fill=MUTED, dash=(2, 3))
            canvas.create_rectangle(width - right + 1, y_of(last) - 8, width - 1, y_of(last) + 8, fill=INK, outline="")
            canvas.create_text(width - right + 6, y_of(last), text=agents.price_text(last, high), anchor="w", font=(FONT + " Semibold", 8), fill="white")
        for moment, way, _price in seen["trade_marks"]:
            index = agents.candle_at(rows, moment)
            if first <= index < end:
                x = x_of(index)
                if way == "buy":
                    y = min(price_bottom - 10, y_of(rows[index]["l"]) + 5)
                    canvas.create_polygon(x, y, x - 5, y + 9, x + 5, y + 9, fill=GOOD, outline=CARD)
                else:
                    y = max(top + 10, y_of(rows[index]["h"]) - 5)
                    canvas.create_polygon(x, y, x - 5, y - 9, x + 5, y - 9, fill=BAD, outline=CARD)
        every = max(1, round(visible / max(2, (width - left - right) // 120)))
        for index in range(end - 1 - every // 2, first - 1, -every):
            canvas.create_text(x_of(index), height - bottom + 1, text=agents.time_label(rows[index]["t"], key), anchor="n", font=(FONT, 8), fill=MUTED)
        if high >= 1e7:
            canvas.create_text(width - 4, 3, text="jt = million Rp", anchor="ne", font=(FONT, 7), fill=MUTED)
        if under:
            strength_top, strength_bottom = price_bottom + 8, height - bottom

            def strength_y(value):
                return strength_bottom - (strength_bottom - strength_top) * value / 100

            canvas.create_line(left, strength_top - 4, width - right, strength_top - 4, fill=LINE)
            canvas.create_rectangle(left, strength_y(agents.RSI_TO), width - right, strength_y(agents.RSI_FROM), fill="#f1f6ff", outline="")
            for guide in (30, 50, 70):
                canvas.create_line(left, strength_y(guide), width - right, strength_y(guide), fill=TRACK)
                canvas.create_text(width - right + 6, strength_y(guide), text=str(guide), anchor="w", font=(FONT, 8), fill=MUTED)
            points = [place for index in range(first, end) if drawn["rsi"][index] is not None for place in (x_of(index), strength_y(drawn["rsi"][index]))]
            if len(points) >= 4:
                canvas.create_line(*points, fill=RSI_COLOUR, width=1)
            canvas.create_text(left + 4, strength_top - 2, text="RSI 14 · the rules buy between 50 and 70", anchor="nw", font=(FONT, 7), fill=MUTED)
        seen["geometry"] = {"first": first, "end": end, "step": step, "left": left, "right": right, "top": top, "bottom": bottom, "price_bottom": price_bottom, "low": low, "high": high, "width": width, "height": height, "key": key}
        draw_cross()

    def draw_cross():
        """The readout of one candle: the one under the mouse, or the newest one."""
        canvas, shape, rows = chart_canvas, seen["geometry"], chart_rows()
        canvas.delete("cross")
        if not shape or not rows:
            return
        hover, index = seen["hover"], shape["end"] - 1
        edge = shape["width"] - shape["right"]
        if hover and shape["left"] <= hover[0] <= edge:
            index = min(shape["end"] - 1, max(shape["first"], shape["first"] + int((hover[0] - shape["left"]) / shape["step"])))
            x = shape["left"] + shape["step"] * (index - shape["first"] + 0.5)
            canvas.create_line(x, shape["top"] - 2, x, shape["height"] - shape["bottom"], fill=MUTED, dash=(3, 3), tags="cross")
            if shape["top"] <= hover[1] <= shape["price_bottom"]:
                price = shape["high"] - (shape["high"] - shape["low"]) * (hover[1] - shape["top"]) / (shape["price_bottom"] - shape["top"])
                canvas.create_line(shape["left"], hover[1], edge, hover[1], fill=MUTED, dash=(3, 3), tags="cross")
                canvas.create_rectangle(edge + 1, hover[1] - 8, shape["width"] - 1, hover[1] + 8, fill=ACCENT, outline="", tags="cross")
                canvas.create_text(edge + 6, hover[1], text=agents.price_text(price, shape["high"]), anchor="w", font=(FONT + " Semibold", 8), fill="white", tags="cross")
        else:
            hover = None
        row = rows[index]
        drawn = (seen["marks"].get(seen["coin"]) or {}).get(shape["key"]) or {}

        def short(value):
            return agents.price_text(value, shape["high"]).replace(" jt", "")

        change = (row["c"] / row["o"] - 1) * 100 if row["o"] > 0 else 0.0
        when = agents.time_label(row["t"], shape["key"]) + ("" if shape["key"] == "1D" else " WIB")
        words = f"{'' if hover else 'Newest candle · '}{when}   O {short(row['o'])}   H {short(row['h'])}   L {short(row['l'])}   C {short(row['c'])}   {agents.signed_pct(change, 2)}"
        canvas.create_text(shape["left"] + 2, 3, text=words, anchor="nw", font=(FONT + " Semibold", 8), fill=INK, tags="cross")
        x = shape["left"] + 2
        for name, title, colour in CHART_TOGGLES:
            values = drawn.get(name)
            if name == "plan" or not seen["toggles"][name] or not values or index >= len(values) or values[index] is None:
                continue
            item = canvas.create_text(x, 16, text=f"{title} {round(values[index]) if name == 'rsi' else short(values[index])}", anchor="nw", font=(FONT, 8), fill=colour, tags="cross")
            x = canvas.bbox(item)[2] + 10

    def on_chart_wheel(event):
        shape, rows = seen["geometry"], chart_rows()
        if shape and rows:
            share = (event.x - shape["left"]) / max(1, shape["width"] - shape["left"] - shape["right"])
            seen["visible"], seen["offset"] = agents.zoomed(len(rows), seen["visible"], seen["offset"], 1 if event.delta > 0 else -1, share)
            draw_candles()

    def on_chart_drag(event):
        shape, rows = seen["geometry"], chart_rows()
        if shape and rows and seen["drag"]:
            _visible, offset = agents.panned(len(rows), seen["visible"], seen["drag"][1], round((event.x - seen["drag"][0]) / shape["step"]))
            seen["hover"] = (event.x, event.y)
            if offset != seen["offset"]:
                seen["offset"] = offset
                draw_candles()
            else:
                draw_cross()

    def on_chart_reset(_event=None):
        seen["visible"], seen["offset"] = agents.START_VISIBLE, 0
        draw_candles()

    def on_chart_move(event):
        seen["hover"] = (event.x, event.y)
        draw_cross()

    def on_chart_leave(_event):
        seen["hover"] = None
        draw_cross()

    def chart_resized(_event):
        if seen["chart_job"]:
            root.after_cancel(seen["chart_job"])
        seen["chart_job"] = root.after(60, draw_candles)

    chart_canvas.bind("<Configure>", chart_resized)
    chart_canvas.bind("<Motion>", on_chart_move)
    chart_canvas.bind("<Leave>", on_chart_leave)
    chart_canvas.bind("<MouseWheel>", on_chart_wheel)
    chart_canvas.bind("<ButtonPress-1>", lambda event: seen.update(drag=(event.x, seen["offset"])))
    chart_canvas.bind("<B1-Motion>", on_chart_drag)
    chart_canvas.bind("<ButtonRelease-1>", lambda _event: seen.update(drag=None))
    chart_canvas.bind("<Double-Button-1>", on_chart_reset)

    def load_candles(coin):
        """In a thread: the four charts of one coin, from Indodax's public prices. No key is used."""
        now_ms = time.time() * 1000
        if demo:
            events.put(("candles", coin, {frame["key"]: agents.demo_candles(frame["key"], now_ms, DEMO_PRICES.get(coin, 1_000_000)) for frame in agents.TIMEFRAMES}, ""))
            events.put(("mood", agents.DEMO_MOOD))
            return
        try:
            proxy = bridge.reachable(bridge.load_settings(env_path)).proxy
        except Exception:  # noqa: BLE001 (no settings or no network: the chart is asked for directly)
            proxy = ""
        try:
            found = agents.fetch_candles(agents.reader(proxy), coin, now_ms)
        except Exception:  # noqa: BLE001 (a chart that fails must never leave the window waiting for it for good)
            found = {}
        missing = len(agents.TIMEFRAMES) - len(found)
        note = "" if not missing else "The chart could not be read from Indodax just now. It is asked for again within a minute." if not found else f"{missing} of the four charts could not be read just now. They are asked for again within a minute."
        events.put(("candles", coin, found, note))
        if time.time() - seen["mood_at"] > MOOD_SECONDS:  # after the charts, so a slow answer never holds them up
            events.put(("mood", agents.fetch_mood(agents.reader(proxy), now_ms)))

    def ask_candles():
        if seen["candle_busy"] or not seen["coin"]:
            return
        seen["candle_busy"] = True
        threading.Thread(target=load_candles, args=(seen["coin"],), daemon=True).start()

    def study_summary(report):
        """The newest study in full (learn.json in this folder: it has the ideas followed on paper), else its short form."""
        learned = report.get("learn") if isinstance(report.get("learn"), dict) else None
        if demo:
            return agents.demo_summary(learned) if learned else None
        try:
            changed = learn_path.stat().st_mtime
        except OSError:
            return learned
        if changed != seen["summary_at"]:
            seen["summary_at"], seen["summary"] = changed, agents.read_summary(learn_path)
        return seen["summary"] or learned

    def paint_agents(view, local, report, state, real, now_ms):
        coin = seen["coin_pick"] or agents.focus_coin(report, view, traded)
        if coin != seen["coin"]:
            seen["coin"], seen["offset"], seen["chart_drawn"] = coin, 0, None
            if coin not in seen["candles"]:
                ask_candles()
        candles = seen["candles"].get(coin) or {}
        if local:
            cycle_age = (now_ms - bridge.number(local.get("at"))) / 1000
        elif view and view.get("at"):
            cycle_age = (bridge.number(view.get("now")) - bridge.number(view.get("at"))) / 1000
        else:
            cycle_age = None
        made = agents.desk(view, report, seen["readings"].get(coin) or {}, study_summary(report), state, now_ms, traded, cycle_age, failed_cycles(seen["lines"]), coin, candles.get("4H"), seen["mood"])
        seen["team"], seen["plan"], seen["debate"] = made["team"], made["plan"], made["debate"]
        news = agents.soon_event(seen["soon"], coin, made["soon"])
        seen["soon"] = agents.soon_key(coin, made["soon"])
        if news:
            add_feed("strategy", news[1], news[0])
        # The desk lead's call is written down and the older ones are marked against later prices. Shown only.
        if demo:
            seen["log"] = decisions.demo(now_ms)
        else:
            try:
                seen["log"] = decisions.update(seen["log"], report, made["team"], coin, now_ms, folder / decisions.JSON_NAME, candles)
            except Exception:  # noqa: BLE001 (the log is shown, never used: a fault in it must not stop the window)
                seen["log"] = seen["log"] if isinstance(seen["log"], dict) else decisions.empty()
        seen["trade_marks"] = agents.markers(report, coin, real)
        if seen["round"] is None:
            if agents.feed_events(seen["shown"], made["team"], now_ms):
                start_round()
            else:
                seen["shown"] = {member["key"]: member for member in made["team"]}
                draw_agent()
        draw_trades(report, real)
        draw_reading()
        draw_chart_bar()
        newest = (candles.get(seen["tf"]) or [{}])[-1]
        signature = json.dumps([coin, seen["tf"], len(candles.get(seen["tf"]) or []), newest.get("t"), newest.get("c"), seen["plan"] if seen["toggles"]["plan"] else None, seen["trade_marks"]], default=str)
        if signature != seen["chart_drawn"]:
            seen["chart_drawn"] = signature
            draw_candles()

    draw_feed()

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
        """A line that reached this window (its own, or its child sender's): kept in the file and shown."""
        if not demo:
            append_log(log_path, line)
            seen["own"] = (seen["own"] + [line])[-200:]  # so it is not shown again when the file is read
        show_log(line)

    def show_log(line):
        seen["lines"] = (seen["lines"] + [line])[-LOG_LINES:]
        log_box.configure(state="normal")
        log_box.insert("end", line + "\n")
        if int(log_box.index("end-1c").split(".")[0]) > LOG_LINES:
            log_box.delete("1.0", "100.0")
        log_box.configure(state="disabled")
        log_box.see("end")
        news = agents.log_event(line)
        if news:
            add_feed(news[0], news[1])

    def desk_line(text):
        add_log(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] {text}")

    def fetch():
        """In a thread: ask TradeBot and look for a sender started outside this window."""
        if demo:
            events.put(("view", demo_view(time.time() * 1000, trouble), "", [], "off"))
            return
        try:
            view, error = server.view(), ""
        except (bridge.ApiError, bridge.SettingsError) as problem:
            view, error = None, str(problem)
        own = sender.process.pid if sender.running() else None
        outside = [] if sender.running() else sender_candidates(list_python_processes(), own)
        events.put(("view", view, error, outside, background_state()))

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
        if seen["background"] == "on":
            return "background" if outside_running() else "starting"
        if seen["background"] == "stopped":
            return "stopped"
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
            for state, said in row["soon"]:
                # The heads-up: a coloured dot for how near, then the server's own sentence.
                line = tk.Frame(block, bg=CARD)
                line.pack(fill="x", pady=(2, 0))
                label(line, "●", 9, STATE_COLOURS[state], width=2).pack(side="left", anchor="n")
                label(line, said, 9, INK if state != "wait" else MUTED, wraplength=width - 30).pack(side="left")
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
        words = {"here": ("● Sender is running", GOOD), "outside": ("● A sender runs in another window", WARN), "waiting": ("◌ Sender starts in a moment", WARN), "stopped": ("○ Sender is stopped", BAD),
                 "background": ("● Sender is running in the background", GOOD), "starting": ("◌ Windows is starting the sender", WARN)}[state]
        status_label.configure(text=words[0], fg=words[1])
        sender_button.configure(text={"here": "Stop the sender", "outside": "Take it over here", "waiting": "Start the sender", "stopped": "Start the sender", "background": "Stop the sender", "starting": "Stop the sender"}[state])
        background_button.configure(text="Run without this window" if seen["background"] == "off" else "Run only with this window")
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
        try:
            paint_agents(view, local, report, state, real, now_ms)
        except Exception as problem:  # noqa: BLE001 (the Agents tab only shows; it must never stop the window that runs the sender)
            if not seen["agents_broken"]:
                seen["agents_broken"] = True
                desk_line(f"the Agents tab could not be drawn ({type(problem).__name__}: {problem}). The sender is not affected.")

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
        if seen["background"] == "on":
            if messagebox.askyesno("Stop the sender", "Stop the sender?\n\nIt runs in the background and stays stopped until you press Start here, also after the PC restarts. Nothing is bought or sold while it is stopped, and a falling price is not acted on. Coins you hold stay in your Indodax account."):
                problem = background_stop()
                seen["background"] = background_state()
                desk_line(f"the sender could not be stopped: {problem}" if problem else "sender stopped by you. It stays stopped until you press Start the sender.")
            paint()
            return
        if seen["background"] == "stopped":
            problem = background_start()
            seen["background"] = background_state()
            desk_line(f"the sender could not be started: {problem}" if problem else "sender started in the background. Its first line can take a minute or two.")
            paint()
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

    def on_background_button():
        """Hand the sender to Windows (it then runs with no window), or take it back into this window."""
        if demo:
            messagebox.showinfo("Demo", "This is the demo: there is no sender behind it.")
            return
        if seen["background"] == "off":
            if seen["outside"] and not sender.running():
                messagebox.showinfo("Run without this window", "A sender is running in another window. Close that one first: two must never run together.")
                return
            if not messagebox.askyesno("Run without this window", f"Let Windows keep the sender running?\n\nIt then runs with no window: Windows starts it when you sign in to this PC, and starts it again within {TASK_MINUTES} minutes if it ever ends. Closing this window no longer stops it; Stop the sender does.\n\nThe PC must still be on, awake and signed in."):
                return
            sender.stop()
            seen["start_later"] = ""
            problem = background_on(folder)
            desk_line(f"Windows did not take the sender: {problem}" if problem else "the sender now runs in the background, without this window. Its first line can take a minute or two.")
        else:
            if not messagebox.askyesno("Run only with this window", "Take the sender back into this window?\n\nIt then runs only while this window is open, as before."):
                return
            was_running = seen["background"] == "on"
            problem = background_off()
            desk_line(f"Windows did not let go of the sender: {problem}" if problem else "the sender no longer runs in the background.")
            if not problem and was_running:
                seen["outside"] = []
                start_sender()
        seen["background"] = background_state()
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
                elif event[0] == "candles":
                    _kind, coin, found, note = event
                    seen["candle_busy"], seen["candle_note"] = False, note
                    if found:
                        try:
                            readings = {key: agents.reading(rows, key) for key, rows in found.items()}
                            marks = {key: agents.indicators(rows) for key, rows in found.items()}
                        except (ArithmeticError, LookupError, TypeError, ValueError):
                            found, seen["candle_note"] = {}, "The chart from Indodax could not be worked out just now. It is asked for again within a minute."
                        else:
                            seen["candles"].setdefault(coin, {}).update(found)
                            seen["readings"].setdefault(coin, {}).update(readings)
                            seen["marks"].setdefault(coin, {}).update(marks)
                    seen["chart_drawn"] = None
                    paint()
                    start_round()
                elif event[0] == "mood":
                    if event[1]:
                        seen["mood"], seen["mood_at"] = event[1], time.time()
                    else:  # a miss keeps the last one and asks again sooner
                        seen["mood_at"] = time.time() - MOOD_SECONDS + MOOD_RETRY_SECONDS
                else:
                    seen["view"], seen["error"], seen["outside"], seen["background"] = event[1], event[2], event[3], event[4]
                    seen["busy"], seen["asked"] = False, time.time()
                    paint()
                    start_round()
        except queue.Empty:
            pass
        # What a sender with no window wrote to the log file is shown here; this window's own lines are already there.
        if not demo and time.time() >= seen["log_check"]:
            seen["log_check"] = time.time() + 1
            news, seen["log_bytes"] = log_news(log_path, seen["log_bytes"])
            for line in news:
                if line in seen["own"]:
                    seen["own"].remove(line)
                else:
                    show_log(line)
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
            elif sender.exit_code() == bridge.ALREADY_RUNNING:
                sender.wanted = False
                desk_line("not started here: another sender is already running on this PC.")
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

    def candle_tick():
        ask_candles()
        root.after(CANDLE_SECONDS * 1000, candle_tick)

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
        if not demo:
            kept = " The sender keeps running in the background." if seen["background"] == "on" else ""
            append_log(log_path, f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] window closed by you.{kept}")
        if holder is not None:
            holder.close()
        root.destroy()

    sender_button.configure(command=on_sender_button)
    pause_button.configure(command=on_pause_button)
    refresh_button.configure(command=refresh)
    background_button.configure(command=on_background_button)
    root.protocol("WM_DELETE_WINDOW", on_close)

    for line in earlier[-EARLIER_LINES:]:  # what the sender wrote while no window was open
        show_log(line)
    desk_line("demo numbers: no account and no sender are behind this window." if demo else f"window opened. Folder: {folder}")
    if not demo and not args.no_start:
        # Look for a sender outside this window first: two must never run together.
        seen["outside"] = sender_candidates(list_python_processes())
        seen["background"] = background_state()
        if seen["background"] == "off":
            start_sender()
        elif seen["background"] == "on":
            if not seen["outside"]:
                task_call(["/run", "/tn", TASK_NAME])  # Windows would start it within minutes anyway: this is sooner
            desk_line("the sender runs in the background, kept by Windows. Closing this window does not stop it.")
        else:
            desk_line("the sender was stopped by you and stays stopped. Press Start the sender to run it again.")
    tick()
    pump()
    repaint()
    root.after(1500, candle_tick)
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


def set_background(wish, folder, on=background_on, off=background_off, window=hold_one_window) -> int:
    """TradeBot.exe --background on|off: the window's button "Run without this window", for a script. 0 when done."""

    def say(text):
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  [desk] {text}"
        print(line)
        append_log(Path(folder) / LOG_NAME, line)

    if wish == "off":
        problem = off()
        say(f"Windows did not let go of the sender: {problem}" if problem else "the sender no longer runs in the background. It runs again when the window is opened.")
        return 1 if problem else 0
    holder = window()
    if holder is None:
        say("the background sender was not switched on: the TradeBot window is open. Close it first, or press Run without this window in it.")
        return 1
    holder.close()
    problem = on(folder)
    say(f"Windows did not take the sender: {problem}" if problem else "the sender now runs in the background, with no window. Windows starts it at sign-in and looks after it.")
    return 1 if problem else 0


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
    parser.add_argument("--background", choices=("on", "off"), default="", help="on: Windows keeps the sender running with no window. off: it runs only with the window again. Opens no window")
    parser.add_argument("--size", default="", help=argparse.SUPPRESS)
    parser.add_argument("--shot", default="", help=argparse.SUPPRESS)
    parser.add_argument("--trouble", action="store_true", help=argparse.SUPPRESS)  # with --demo: show the warnings
    parser.add_argument("--tab", default="", help=argparse.SUPPRESS)  # the tab shown first: overview, agents, study, report, log
    parser.add_argument("--side", default="", help=argparse.SUPPRESS)  # in the Agents tab, the side tab shown first: feed, agent, trades, analysis
    args = parser.parse_args(argv)
    if args.background:
        return set_background(args.background, Path(args.folder).resolve())
    return open_window(args)


if __name__ == "__main__":
    sys.exit(main())
