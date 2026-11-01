"""Single-file .exe entry point for PTB RDME Widget.

Starts the HTTP server inside this process, opens the widget in the user's
default browser, and runs a tkinter tray + stop window so the user can
shut it down cleanly.

When packaged with PyInstaller --onefile, this becomes a single .exe that
needs no Python install on the target machine.
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

# Resolve a writable data dir even when frozen by PyInstaller
def _data_dir() -> Path:
    if getattr(sys, "frozen", False):
        # Frozen: place data next to the .exe
        base = Path(sys.executable).resolve().parent
    else:
        # Development: project root
        base = Path(__file__).resolve().parent.parent
    d = base / "data"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _web_dir() -> Path:
    if getattr(sys, "frozen", False):
        # Frozen: PyInstaller unpacks --add-data into sys._MEIPASS
        meip = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
        return meip / "web"
    return Path(__file__).resolve().parent.parent / "web"


def _logs_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "logs"
    return Path(__file__).resolve().parent.parent / "logs"


def _setup_logging():
    LOG_DIR = _logs_dir()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log = logging.getLogger()
    log.setLevel(logging.INFO)
    for h in list(log.handlers):
        log.removeHandler(h)
    fh = logging.FileHandler(LOG_DIR / "widget.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(fh)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(sh)


def _find_free_port(preferred: int = 8050) -> int:
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", preferred))
        return preferred
    except OSError:
        s.close()
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8050)
    ap.add_argument("--no-browser", action="store_true", help="don't auto-open browser")
    ap.add_argument("--host", default="127.0.0.1", help="bind host (default 127.0.0.1 = local only)")
    args = ap.parse_args()

    _setup_logging()
    log = logging.getLogger("widget")

    # Make the bundled web dir importable for the server module
    pkg_root = Path(__file__).resolve().parent
    if str(pkg_root) not in sys.path:
        sys.path.insert(0, str(pkg_root))

    # Redirect the server module's expected paths to the bundle dir
    import server.db as db_mod
    import server.server as srv
    db_mod.DB_PATH = _data_dir() / "ptb_rdme.sqlite3"
    srv.DB_PATH = db_mod.DB_PATH
    srv.WEB = _web_dir()
    db_mod.init_db(srv.DB_PATH)

    port = _find_free_port(args.port)
    httpd = srv.start(host=args.host, port=port)
    log.info("PTB RDME Widget running on http://%s:%d", args.host, port)

    url = f"http://127.0.0.1:{port}/"
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            log.exception("could not open browser")

    # Run a tiny tk control window so the user can stop the widget
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.title("PTB RDME Widget")
        root.geometry("320x180")
        root.resizable(False, False)
        try:
            icon_path = _web_dir() / "icons" / "icon-192.png"
            if icon_path.exists():
                img = tk.PhotoImage(file=str(icon_path))
                root.iconphoto(False, img)
        except Exception:
            pass

        tk.Label(root, text="PTB RDME Widget", font=("Segoe UI", 13, "bold")).pack(pady=(14, 2))
        tk.Label(root, text=f"Running on {url}", font=("Segoe UI", 9)).pack(pady=(0, 8))

        def _stop():
            try:
                httpd.shutdown()
            except Exception:
                pass
            try:
                root.destroy()
            except Exception:
                pass

        def _open():
            webbrowser.open(url)

        btns = tk.Frame(root)
        btns.pack(pady=6)
        tk.Button(btns, text="Open widget", command=_open, width=12).pack(side="left", padx=4)
        tk.Button(btns, text="Stop", command=_stop, width=10).pack(side="left", padx=4)

        root.protocol("WM_DELETE_WINDOW", _stop)
        root.mainloop()
    except Exception:
        # tkinter unavailable (e.g. headless server) — just block
        log.info("no tkinter; running headless. Ctrl+C to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

    try:
        httpd.shutdown()
    except Exception:
        pass


if __name__ == "__main__":
    main()
