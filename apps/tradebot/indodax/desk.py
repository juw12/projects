#!/usr/bin/env python3
"""TradeBot's Indodax desk: one window for the sender and everything it does.

It starts and stops the sender (bridge.py, in this folder) as a hidden child process, so no
console window is needed, and shows in one place: real or practice, the free rupiah, what is
held, the market, what the strategy needs before it buys or sells, the history, the result and
the sender's own log. Two buttons pause and resume buying, the same switch as /indodax pause.

    pythonw desk.py            open the window and start the sender
    pythonw desk.py --no-start open the window only

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

HERE = Path(__file__).resolve().parent
REFRESH_SECONDS = 30
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


def sender_candidates(rows, own_pid=None) -> list:
    """Process ids that look like a sender started outside this window.

    rows = [{"ProcessId": 1, "CommandLine": "python.exe bridge.py"}]. A line that only shows,
    checks or clears is not a running sender, and neither is the MT5 or the twin's bridge.
    """
    found = []
    for row in rows or []:
        line = str(row.get("CommandLine") or "").lower().replace("/", "\\")
        pid = row.get("ProcessId")
        if "bridge.py" not in line or pid == own_pid:
            continue
        if any(flag in line for flag in ("--show", "--once", "--check", "--clear")):
            continue
        if "\\mt5\\" in line or "\\twin\\" in line:
            continue
        found.append(pid)
    return found


def list_python_processes() -> list:
    """Every python process with its command line (Windows). An empty list when it cannot be read."""
    command = [
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
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
        settings = bridge.load_settings(self.env_path)
        if not settings.key:
            raise bridge.ApiError("INDODAX_BRIDGE_KEY is empty in .env")
        return bridge.Api(settings)

    def view(self) -> dict:
        return self._api()._call("/v1/indodax/view")

    def pause(self, paused: bool) -> dict:
        return self._api()._call("/v1/indodax/pause", {"paused": bool(paused)})


class Sender:
    """bridge.py as a hidden child process. Its output lines go to on_line (from a thread)."""

    def __init__(self, folder, on_line, python=None, popen=subprocess.Popen):
        self.folder = Path(folder)
        self.on_line = on_line
        self.python = python or child_python()
        self.popen = popen
        self.process = None
        self.wanted = False  # the user wants it running: a child that ends is started again

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def start(self) -> None:
        if self.running():
            return
        self.wanted = True
        self.process = self.popen(
            [self.python, "-u", "bridge.py"],
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


# ---------------------------------------------------------------- the window


def open_window(args) -> int:
    import tkinter as tk
    from tkinter import messagebox, ttk
    from tkinter.scrolledtext import ScrolledText

    holder = hold_one_window()
    if holder is None:
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
    seen = {"view": None, "error": "", "outside": [], "restart_at": 0.0, "busy": False}

    root = tk.Tk()
    root.title("TradeBot · Indodax")
    root.geometry("980x720")
    root.minsize(760, 520)
    style = ttk.Style(root)
    if "vista" in style.theme_names():
        style.theme_use("vista")
    style.configure("Tile.TLabel", font=("Segoe UI", 9), foreground="#555555")
    style.configure("Value.TLabel", font=("Segoe UI Semibold", 12))

    top = ttk.Frame(root, padding=(12, 10, 12, 4))
    top.pack(fill="x")
    ttk.Label(top, text="TradeBot · Indodax", font=("Segoe UI Semibold", 15)).pack(side="left")
    mode_label = tk.Label(top, text="…", font=("Segoe UI Semibold", 10), padx=10, pady=3, fg="white", bg="#777777")
    mode_label.pack(side="left", padx=12)
    status_label = ttk.Label(top, text="", font=("Segoe UI", 10))
    status_label.pack(side="right")

    tile_frame = ttk.Frame(root, padding=(12, 4))
    tile_frame.pack(fill="x")
    values = {}
    for column, (name, title) in enumerate([("cash", "Free rupiah"), ("holding", "Holding now"), ("result", "Result so far"), ("today", "Today (from 07:00 WIB)"), ("heard", "Server heard the sender")]):
        box = ttk.Frame(tile_frame, padding=(0, 0, 18, 0))
        box.grid(row=0, column=column, sticky="w")
        ttk.Label(box, text=title, style="Tile.TLabel").pack(anchor="w")
        values[name] = ttk.Label(box, text="…", style="Value.TLabel")
        values[name].pack(anchor="w")

    buttons = ttk.Frame(root, padding=(12, 6))
    buttons.pack(fill="x")
    sender_button = ttk.Button(buttons, width=18)
    sender_button.pack(side="left")
    pause_button = ttk.Button(buttons, width=18)
    pause_button.pack(side="left", padx=8)
    refresh_button = ttk.Button(buttons, text="Refresh now", width=14)
    refresh_button.pack(side="left")
    note_label = ttk.Label(buttons, text="", foreground="#a04000")
    note_label.pack(side="left", padx=12)

    book = ttk.Notebook(root)
    book.pack(fill="both", expand=True, padx=12, pady=(4, 12))
    report_box = ScrolledText(book, wrap="word", font=("Segoe UI", 10), state="disabled", padx=10, pady=8)
    log_box = ScrolledText(book, wrap="none", font=("Consolas", 9), state="disabled", padx=8, pady=6)
    book.add(report_box, text="Report")
    book.add(log_box, text="Sender log")

    def set_text(box, text, end=False):
        box.configure(state="normal")
        box.delete("1.0", "end")
        box.insert("1.0", text)
        box.configure(state="disabled")
        if end:
            box.see("end")

    def add_log(line):
        append_log(log_path, line)
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

    def outside_running():
        now_ms = time.time() * 1000
        return not sender.running() and (bool(seen["outside"]) or local_is_fresh(read_local(report_path), now_ms))

    def paint():
        now_ms = time.time() * 1000
        local = read_local(report_path)
        shown = tiles(seen["view"], local, now_ms)
        for name, label in values.items():
            label.configure(text=shown[name])
        mode_label.configure(text=shown["mode"], bg="#b3261e" if shown["real"] else "#777777")
        if sender.running():
            status_label.configure(text="● Sender is running in this window", foreground="#1b7f3b")
            sender_button.configure(text="Stop the sender")
        elif outside_running():
            status_label.configure(text="● A sender is running outside this window", foreground="#a04000")
            sender_button.configure(text="Take it over here")
        else:
            status_label.configure(text="○ Sender is stopped: nothing is bought or sold", foreground="#b3261e")
            sender_button.configure(text="Start the sender")
        pause_button.configure(text="Allow buying again" if shown["paused"] else "Pause buying")
        note_label.configure(text=("Buying is paused. " if shown["paused"] else "") + (f"TradeBot: {seen['error']}" if seen["error"] else ""))
        if seen["view"] and seen["view"].get("text"):
            set_text(report_box, seen["view"]["text"])
        else:
            set_text(report_box, local_text(local, now_ms))

    def start_sender():
        if outside_running():
            desk_line("not started: another sender is already running. Two senders must never run together.")
            return False
        sender.start()
        desk_line("sender started (hidden, inside this window).")
        return True

    def on_sender_button():
        if sender.running():
            if messagebox.askyesno("Stop the sender", "Stop the sender?\n\nNothing is bought or sold while it is stopped, and a falling price is not acted on. Coins you hold stay in your Indodax account."):
                sender.stop()
                desk_line("sender stopped by you.")
        elif outside_running():
            pids = seen["outside"]
            if not pids:
                messagebox.showinfo("Sender", "A sender wrote its report less than three minutes ago, but I cannot find its process. Close its window, wait three minutes, then press Start.")
                return
            if messagebox.askyesno("Take it over", "A sender is running in another window. Stop that one and run it here instead?"):
                for pid in pids:
                    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW if sys.platform == "win32" else 0)
                seen["outside"] = []
                desk_line("the sender outside this window was stopped.")
                sender.start()
                desk_line("sender started (hidden, inside this window).")
        else:
            start_sender()
        paint()

    def on_pause_button():
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
                    seen["busy"] = False
                    paint()
        except queue.Empty:
            pass
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

    def on_close():
        if sender.running() and not messagebox.askyesno("Close", "Closing this window also stops the sender, so nothing is bought or sold until you open it again.\n\nClose it?"):
            return
        sender.stop()
        holder.close()
        root.destroy()

    sender_button.configure(command=on_sender_button)
    pause_button.configure(command=on_pause_button)
    refresh_button.configure(command=refresh)
    root.protocol("WM_DELETE_WINDOW", on_close)

    desk_line(f"window opened. Folder: {folder}")
    paint()
    if not args.no_start:
        # Look for a sender outside this window first: two must never run together.
        seen["outside"] = sender_candidates(list_python_processes())
        if start_sender():
            pass
        paint()
    tick()
    pump()
    root.mainloop()
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="TradeBot's Indodax desk: the sender and its numbers in one window.")
    parser.add_argument("--no-start", action="store_true", help="open the window without starting the sender")
    parser.add_argument("--folder", default=str(HERE), help="the folder with bridge.py and .env (default: this one)")
    return open_window(parser.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
