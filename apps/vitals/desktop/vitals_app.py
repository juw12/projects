#!/usr/bin/env python3
"""Vitals desktop app: the entry point of the downloadable Windows, macOS and Linux builds.

Opening the app makes sure the Vitals agent is running quietly in the background, opens the
dashboard in your browser and exits. The agent is this same program started with --background,
which is also what runs when you sign in. Python is bundled, so nothing else needs installing.

    Vitals                      open the dashboard (starts the agent first if needed)
    Vitals --background         run the agent without opening anything (the sign-in item)
    Vitals --stop               ask a running agent to exit (used by the installer)
    Vitals --remove-login-item  stop starting Vitals when you sign in

Other options (--port, --data, --home, --lan, --retention, ...) are passed on to the agent.
From a checkout:  python apps/vitals/desktop/vitals_app.py
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from xml.sax.saxutils import escape

FROZEN = getattr(sys, "frozen", False)
HERE = os.path.dirname(os.path.abspath(__file__))
if FROZEN:
    # PyInstaller unpacks the agent modules and the dashboard next to this program.
    WEB_DIR = os.path.join(getattr(sys, "_MEIPASS", HERE), "web")
else:
    sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "server")))
    WEB_DIR = os.path.normpath(os.path.join(HERE, "..", "web"))

# The agent only ever talks to this computer: never send loopback requests through a proxy.
_LOOPBACK = "127.0.0.1,localhost,::1"
for _key in ("no_proxy", "NO_PROXY"):
    os.environ[_key] = ",".join(part for part in (os.environ.get(_key), _LOOPBACK) if part)

if FROZEN and sys.platform.startswith("linux"):
    # Programs we start (browser, notify-send) must use the system libraries, not the bundled ones.
    if "LD_LIBRARY_PATH_ORIG" in os.environ:
        os.environ["LD_LIBRARY_PATH"] = os.environ["LD_LIBRARY_PATH_ORIG"]
    else:
        os.environ.pop("LD_LIBRARY_PATH", None)

import server  # noqa: E402  (the agent: apps/vitals/server/server.py)

server.WEB_DIR = WEB_DIR

LABEL = "io.github.juw12.vitals"
BUNDLE_ID = LABEL + ".app"
STARTUP_SHORTCUT = "Vitals (background).lnk"
LOG_LIMIT = 1_000_000
START_TIMEOUT = 30
OWN_SWITCHES = {"--background": "background", "--stop": "stop", "--remove-login-item": "remove-login-item"}


# ---------------------------------------------------------------- arguments
def split_args(argv):
    """Return (mode, agent_args): the launcher's own switch and everything meant for the agent."""
    mode = "open"
    rest = []
    for arg in argv:
        if arg.startswith("-psn_"):  # process serial number some macOS versions add
            continue
        if arg in OWN_SWITCHES:
            mode = OWN_SWITCHES[arg]
        else:
            rest.append(arg)
    return mode, rest


def agent_settings(rest):
    """The port and data folder the agent will use, read from its own options."""
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--port", type=int, default=int(os.environ.get("VITALS_PORT", 8765)))
    parser.add_argument("--data", default=server.default_data_dir())
    known, _unknown = parser.parse_known_args(rest)
    return known.port, os.path.abspath(os.path.expanduser(known.data))


# ------------------------------------------------------------------ helpers
def has_terminal():
    """True when output is shown in a real terminal window (not a pipe, a file or NUL)."""
    stream = sys.stdout
    if stream is None:
        return False
    try:
        if not stream.isatty():
            return False
        if os.name == "nt":
            # Windows reports the NUL device as a tty; only a console accepts GetConsoleMode.
            import ctypes
            import msvcrt

            mode = ctypes.c_ulong()
            handle = msvcrt.get_osfhandle(stream.fileno())
            return bool(ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)))
        return True
    except (AttributeError, ValueError, OSError):
        return False


def use_log_file(data_dir):
    """Send output to <data>/agent.log when no terminal shows it (the usual case for an app)."""
    if has_terminal():
        return None
    try:
        os.makedirs(data_dir, exist_ok=True)
        path = os.path.join(data_dir, "agent.log")
        if os.path.exists(path) and os.path.getsize(path) > LOG_LIMIT:
            os.replace(path, path + ".1")
        log = open(path, "a", encoding="utf-8", buffering=1)
    except OSError:
        return None
    sys.stdout = log
    sys.stderr = log
    return path


def tell_user(message):
    """Print the message, and show it in a dialog when the app was opened without a terminal."""
    if sys.stdout is not None:
        print(message, flush=True)
    if not FROZEN or has_terminal() or os.environ.get("VITALS_NO_DIALOG"):
        return
    try:
        if sys.platform == "win32":
            import ctypes

            ctypes.windll.user32.MessageBoxW(None, message, "Vitals", 0x40)
        elif sys.platform == "darwin":
            quoted = '"' + message.replace("\\", "\\\\").replace('"', '\\"') + '"'
            subprocess.run(["osascript", "-e", "display alert \"Vitals\" message " + quoted], timeout=120)
        else:
            for command in (["zenity", "--info", "--title=Vitals", "--text=" + message],
                            ["notify-send", "Vitals", message]):
                if shutil.which(command[0]):
                    subprocess.run(command, timeout=120)
                    break
    except Exception:  # a message box must never crash the app
        pass


def open_dashboard(port):
    if os.environ.get("VITALS_NO_BROWSER"):
        return
    import webbrowser

    webbrowser.open("http://127.0.0.1:%d/" % port)


def agent_command(rest):
    if FROZEN:
        return [sys.executable, "--background"] + rest
    return [sys.executable, os.path.abspath(__file__), "--background"] + rest


def start_agent(rest):
    """Start the agent as its own background process that outlives this launcher."""
    # PyInstaller: run the child as an independent copy of the app, not as a helper of this one.
    env = dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT="1")
    options = {
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "env": env,
        "cwd": os.path.expanduser("~"),
        "close_fds": True,
    }
    if os.name == "nt":
        options["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True
    return subprocess.Popen(agent_command(rest), **options)


def stop_agent(port):
    """Ask the agent on this port to exit. True if one was running and has stopped."""
    base = "http://127.0.0.1:%d" % port
    try:
        with urllib.request.urlopen(base + "/api/session", timeout=2) as response:
            token = json.loads(response.read().decode("utf-8")).get("token")
    except (OSError, ValueError):
        return False
    if not token:
        return False
    request = urllib.request.Request(
        base + "/api/shutdown",
        data=b"{}",
        method="POST",
        headers={"X-Vitals-Token": token, "Content-Type": "application/json"},
    )
    try:
        urllib.request.urlopen(request, timeout=3).close()
    except OSError:
        pass
    for _ in range(100):
        if not server.already_running(port):
            return True
        time.sleep(0.1)
    return False


# --------------------------------------------------------------- login item
def desktop_entry_quote(path):
    """Quote a path for the Exec= line of a freedesktop .desktop file."""
    for char in ("\\", '"', "`", "$"):
        path = path.replace(char, "\\" + char)
    return '"' + path + '"'


def desktop_entry(exe, background=False, icon=None):
    """A freedesktop entry that opens Vitals (app menu) or starts its agent (autostart)."""
    lines = [
        "[Desktop Entry]",
        "Type=Application",
        "Name=Vitals" + (" (background)" if background else ""),
        "Comment=Device health copilot",
        "Exec=" + desktop_entry_quote(exe) + (" --background" if background else ""),
        "TryExec=" + exe,
        "Icon=" + (icon or "vitals"),
        "Terminal=false",
        "Categories=System;Utility;",
    ]
    if background:
        lines += ["NoDisplay=true", "X-GNOME-Autostart-enabled=true"]
    return "\n".join(lines) + "\n"


def launch_agent_plist(exe):
    """A macOS LaunchAgent that starts the Vitals agent when you log in."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>\n'
        "  <key>Label</key><string>%s</string>\n"
        "  <key>ProgramArguments</key><array><string>%s</string><string>--background</string></array>\n"
        "  <key>AssociatedBundleIdentifiers</key><array><string>%s</string></array>\n"
        "  <key>RunAtLoad</key><true/>\n"
        "  <key>ProcessType</key><string>Background</string>\n"
        "  <key>LowPriorityIO</key><true/>\n"
        "  <key>Nice</key><integer>10</integer>\n"
        "</dict></plist>\n"
    ) % (LABEL, escape(exe), BUNDLE_ID)


def login_item_paths():
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        return [os.path.join(home, "Library", "LaunchAgents", LABEL + ".plist")]
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA", os.path.join(home, "AppData", "Roaming"))
        return [os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", STARTUP_SHORTCUT)]
    config = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
    return [os.path.join(config, "autostart", "vitals.desktop")]


def write_if_changed(path, content):
    try:
        with open(path, encoding="utf-8") as handle:
            if handle.read() == content:
                return
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(content)


def ensure_login_item(data_dir):
    """macOS and Linux: start the agent at login, like the one-line installers do.

    Windows gets this (and its Start menu entry) from the Setup program instead. Skipped when you
    opted out (--remove-login-item) and while the Mac app still runs from the disk image.
    """
    if not FROZEN or sys.platform == "win32" or os.environ.get("VITALS_NO_AUTOSTART"):
        return
    if os.path.exists(os.path.join(data_dir, "no-login-item")):
        return
    exe = os.path.realpath(sys.executable)
    try:
        if sys.platform == "darwin":
            if "/Applications/" not in exe:
                return
            write_if_changed(login_item_paths()[0], launch_agent_plist(exe))
            return
        write_if_changed(login_item_paths()[0], desktop_entry(exe, background=True))
        if not os.path.exists("/usr/share/applications/vitals.desktop"):
            # The .tar.gz build: add Vitals to the app menu too (the .deb ships its own entry).
            icon = os.path.join(data_dir, "vitals.png")
            if not os.path.exists(icon):
                os.makedirs(data_dir, exist_ok=True)
                shutil.copyfile(os.path.join(WEB_DIR, "icons", "icon-512.png"), icon)
            data_home = os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share")
            write_if_changed(os.path.join(data_home, "applications", "vitals.desktop"), desktop_entry(exe, icon=icon))
    except OSError as error:
        print("Could not set up the login item: %s" % error, flush=True)


def remove_login_item(data_dir):
    removed = []
    for path in login_item_paths():
        if os.path.exists(path):
            os.remove(path)
            removed.append(path)
    os.makedirs(data_dir, exist_ok=True)
    with open(os.path.join(data_dir, "no-login-item"), "w", encoding="utf-8") as handle:
        handle.write("Vitals does not start at login. Delete this file to allow it again.\n")
    return removed


# --------------------------------------------------------------------- main
def open_app(rest, port, data_dir):
    """Double-click: make sure the agent runs, then show the dashboard."""
    ensure_login_item(data_dir)
    if server.already_running(port):
        open_dashboard(port)
        return 0
    child = start_agent(rest)
    deadline = time.time() + START_TIMEOUT
    while time.time() < deadline:
        if server.already_running(port):
            open_dashboard(port)
            return 0
        if child.poll() is not None and not server.already_running(port):
            break
        time.sleep(0.25)
    tell_user(
        "Vitals could not start on port %d. Another program may be using it.\n\nDetails: %s"
        % (port, os.path.join(data_dir, "agent.log"))
    )
    return 1


def main(argv=None):
    mode, rest = split_args(sys.argv[1:] if argv is None else argv)
    port, data_dir = agent_settings(rest)
    if mode == "background":
        use_log_file(data_dir)
        server.main(rest)
        return 0
    if mode == "stop":
        print("Stopped Vitals." if stop_agent(port) else "Vitals was not running.", flush=True)
        return 0
    if mode == "remove-login-item":
        removed = remove_login_item(data_dir)
        print("Vitals will no longer start at login." + ("" if removed else " (No login item was set.)"), flush=True)
        return 0
    return open_app(rest, port, data_dir)


if __name__ == "__main__":
    sys.exit(main())
