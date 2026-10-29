"""Twin for Windows and macOS: the real Twin server and app in one program.

The public website only offers practice money. Real trading needs a Twin server running on your own computer
(it keeps your broker connection and talks to Alpaca or Interactive Brokers). This program is that server plus
its window, so nobody has to install Python or open a terminal:

    1. It copies the Twin code it ships with to a per-user folder (once, and again when a newer Twin comes
       with the app). In-app updates (Me -> Update Twin) install over that copy, like any local Twin.
    2. It starts Twin's own server.py on a private loopback port, with accounts and broker connections in
       a per-user data folder:
           Windows  %LOCALAPPDATA%\\Twin\\app and %LOCALAPPDATA%\\Twin\\data
           macOS    ~/Library/Application Support/Twin/app and .../Twin/data
    3. It shows the app in a native window (Edge WebView2 on Windows, WKWebView on macOS, via pywebview)
       and stops the server when the window closes.

Money never goes to Twin: deposits are made at the broker (Invest -> Real -> Add money walks you through it)
and Twin shows when they arrive.

The frozen program doubles as the Python that runs Twin: server.py starts its tools as
`[sys.executable, tool.py, ...]` and restarts itself after an update as `[sys.executable, server.py, ...]`,
so `Twin.exe some_script.py args` runs that script (see run_script).

    Twin --version | --stop | --selftest-tools
    TWIN_WINDOW_TEST=<report.json>  open, check the window and the server (accounts, a tool, Add money),
                                    write a report and close - with a throwaway data folder
"""

import hmac
import json
import os
import re
import runpy
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.request
import webbrowser

VERSION = "1.0.0"
TITLE = "Twin"
PREFERRED_PORT = 8799  # the command-line Twin uses 8765, so both can run side by side
DEFAULT_SIZE = (1280, 860)
MIN_SIZE = (400, 560)
LIGHT_BACKGROUND = "#f6f7fb"
DARK_BACKGROUND = "#0d1117"
SETTINGS_FILE = "settings.json"
CONTROL_FILE = "window.json"
PID_FILE = "server.pid"
SERVER_START_TIMEOUT = 60
TEST_TIMEOUT = 90
SHELL_INFO_URL = os.environ.get("TWIN_DESKTOP_INFO_URL") or "https://juw12.github.io/projects/twin/desktop.json"
DOWNLOAD_PAGE = "https://github.com/juw12/projects/releases/tag/twin"
TOOL_SCRIPTS = [
    "vendor/day-trader-skill/trader-scanner/scan.py",
    "vendor/day-trader-skill/trader-news/news.py",
    "vendor/day-trader-skill/trader-entry/entry.py",
    "vendor/day-trader-skill/trader-exit/exit.py",
    "vendor/day-trader-skill/trader-timemachine/timemachine.py",
    "vendor/day-trader-skill/trader-budget/size.py",
    "vendor/day-trader-skill/trader-risk/check.py",
    "vendor/day-trader-skill/trader-broker/ticket.py",
    "vendor/day-trader-skill/trader-alerts/alerts.py",
    "vendor/day-trader-skill/trader-analyst/facts.py",
    "vendor/trader-skill/trader-copycat/edgar13f.py",
]
PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, ready: document.readyState,"
    " addMoney: typeof fundingCard === 'function' && typeof openAddMoney === 'function',"
    " bridge: !!(window.pywebview && window.pywebview.api),"
    " demo: typeof DEMO !== 'undefined' ? DEMO : null,"
    " server: typeof SERVER_RUNTIME !== 'undefined' ? SERVER_RUNTIME : null,"
    " width: window.innerWidth, height: window.innerHeight})"
)
LOADING_PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%%;margin:0;font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
background:%(background)s;color:%(text)s;display:flex;align-items:center;justify-content:center}
.box{text-align:center;max-width:460px;padding:24px}.dot{width:44px;height:44px;border-radius:50%%;
margin:0 auto 18px;border:4px solid rgba(127,127,127,.25);border-top-color:#3b82f6;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}h1{font-size:20px;margin:0 0 6px}p{opacity:.75;margin:0}
pre{text-align:left;white-space:pre-wrap;font-size:12px;opacity:.8;max-height:240px;overflow:auto}
</style></head><body><div class="box">%(body)s</div></body></html>"""


# ------------------------------------------------------------------ helpers
def frozen():
    return bool(getattr(sys, "frozen", False))


def data_root():
    """Per-user folder for Twin's code copy, accounts, logs and window settings."""
    override = os.environ.get("TWIN_DESKTOP_HOME")
    if override:
        return os.path.abspath(override)
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), "Twin")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Twin")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "twin")


def logs_dir(root):
    folder = os.path.join(root, "logs")
    os.makedirs(folder, exist_ok=True)
    return folder


LOG_STATE = {"path": None}


def log(message):
    line = "%s [twin-desktop] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
    if sys.stdout is not None:
        try:
            sys.stdout.write(line)
            sys.stdout.flush()
        except (OSError, ValueError):
            pass
    if LOG_STATE["path"]:
        try:
            with open(LOG_STATE["path"], "a", encoding="utf-8") as handle:
                handle.write(line)
        except OSError:
            pass


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
        return value if isinstance(value, type(default)) else default
    except (OSError, ValueError):
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2)
    os.replace(temporary, path)


def version_tuple(value):
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", str(value or "").strip())
    return tuple(int(part) for part in match.groups()) if match else None


def twin_version(app_dir):
    """VERSION from a Twin folder's server.py, or None."""
    try:
        with open(os.path.join(app_dir, "server.py"), encoding="utf-8") as handle:
            match = re.search(r'^VERSION = "([^"]+)"', handle.read(), re.M)
    except OSError:
        return None
    return match.group(1) if match else None


def process_alive(pid):
    if not pid or pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) != 0
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def kill_process(pid):
    if not process_alive(pid):
        return
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x0001 | 0x00100000, False, pid)  # PROCESS_TERMINATE | SYNCHRONIZE
        if handle:
            try:
                kernel32.TerminateProcess(handle, 0)
                kernel32.WaitForSingleObject(handle, 5000)
            finally:
                kernel32.CloseHandle(handle)
        return
    import signal

    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    deadline = time.time() + 5
    while time.time() < deadline and process_alive(pid):
        time.sleep(0.1)
    if process_alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass


# ------------------------------------------------- frozen program as Python
def attach_streams(name):
    """A windowed program has no console: give print() and logging somewhere to go."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    try:
        stream = open(os.path.join(logs_dir(data_root()), name), "a", encoding="utf-8", buffering=1)
    except OSError:
        stream = open(os.devnull, "w", encoding="utf-8")
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


def run_script(argv):
    """`Twin some_script.py args`: run that script as __main__, the way `python some_script.py args` would."""
    script = os.path.abspath(argv[0])
    sys.argv = [script] + list(argv[1:])
    sys.path.insert(0, os.path.dirname(script))
    attach_streams("server.log" if os.path.basename(script) == "server.py" else "tools.log")
    try:
        runpy.run_path(script, run_name="__main__")
    except SystemExit:
        raise
    except KeyboardInterrupt:
        return 130
    except BaseException:
        traceback.print_exc()
        return 1
    return 0


# ------------------------------------------------------ Twin code + server
def bundled_code():
    """The Twin folder this program ships with (frozen) or the checkout it runs from."""
    if frozen():
        return os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)), "twin")
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def prepare_code(root):
    """Folder whose server.py runs. Frozen: a per-user copy that in-app updates can write to."""
    source = bundled_code()
    if not frozen():
        return source
    target = os.path.join(root, "app")
    shipped = version_tuple(twin_version(source))
    installed = version_tuple(twin_version(target))
    if installed is None or (shipped and shipped > installed):
        log("installing Twin %s into %s (was %s)" % (twin_version(source), target, twin_version(target)))
        # Copy over the old files (like scripts/update_local.py): never delete, never touch data/.
        shutil.copytree(source, target, dirs_exist_ok=True)
    return target


def port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def health(port, timeout=1.5):
    """Twin's /api/health on this port, or None."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, urllib.error.URLError):
        return None
    return data if isinstance(data, dict) and data.get("app") == "twin" else None


class TwinServer:
    """Twin's own server.py, started with this program as its Python."""

    def __init__(self, root, app_dir, data_dir):
        self.root = root
        self.app_dir = app_dir
        self.data_dir = data_dir
        self.pid_file = os.path.join(root, PID_FILE)
        self.settings_path = os.path.join(root, SETTINGS_FILE)
        self.process = None
        self.port = None
        self.log_path = os.path.join(logs_dir(root), "server.log")

    def _stop_leftover(self, port):
        """A Twin server left behind by an earlier window (crash, forced quit) on our port."""
        try:
            with open(self.pid_file, encoding="utf-8") as handle:
                pid = int(handle.read().strip() or 0)
        except (OSError, ValueError):
            return
        if pid and process_alive(pid) and health(port):
            log("stopping the Twin server left running by an earlier window (pid %d)" % pid)
            kill_process(pid)
            deadline = time.time() + 10
            while time.time() < deadline and not port_free(port):
                time.sleep(0.2)

    def choose_port(self, fixed=None):
        """Keep one port so the page's origin (and its saved settings) stays the same between launches."""
        if fixed:
            return fixed
        settings = read_json(self.settings_path, {})
        port = int(settings.get("port") or PREFERRED_PORT)
        self._stop_leftover(port)
        if not port_free(port):
            port = PREFERRED_PORT if port != PREFERRED_PORT and port_free(PREFERRED_PORT) else free_port()
            log("port in use; Twin will use %d" % port)
        settings["port"] = port
        write_json(self.settings_path, settings)
        return port

    def command(self):
        server = os.path.join(self.app_dir, "server.py")
        return [sys.executable, server, "--port", str(self.port), "--no-browser"]

    def start(self, port):
        self.port = port
        os.makedirs(self.data_dir, exist_ok=True)
        env = dict(os.environ, TWIN_DATA=self.data_dir, TWIN_PID_FILE=self.pid_file, PYTHONUNBUFFERED="1")
        env.pop("TWIN_RESTARTED", None)
        env.pop("TWIN_WINDOW_TEST", None)
        flags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW
        log_handle = open(self.log_path, "a", encoding="utf-8")
        log_handle.write("\n--- %s Twin desktop %s starting %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), VERSION,
                                                                    " ".join(self.command())))
        log_handle.flush()
        self.process = subprocess.Popen(
            self.command(),
            cwd=self.app_dir,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            creationflags=flags,
        )
        log_handle.close()
        log("server started (pid %d) on port %d" % (self.process.pid, port))

    def wait_ready(self, timeout=SERVER_START_TIMEOUT):
        deadline = time.time() + timeout
        while time.time() < deadline:
            info = health(self.port)
            if info:
                return info
            if self.process and self.process.poll() is not None and not self._pid_from_file_alive():
                return None
            time.sleep(0.25)
        return None

    def _pid_from_file_alive(self):
        try:
            with open(self.pid_file, encoding="utf-8") as handle:
                return process_alive(int(handle.read().strip() or 0))
        except (OSError, ValueError):
            return False

    def log_tail(self, lines=25):
        try:
            with open(self.log_path, encoding="utf-8", errors="replace") as handle:
                return "".join(handle.readlines()[-lines:])
        except OSError:
            return ""

    def stop(self):
        """Stop the server, including one that restarted itself after an in-app update."""
        pids = set()
        if self.process and self.process.poll() is None:
            pids.add(self.process.pid)
        try:
            with open(self.pid_file, encoding="utf-8") as handle:
                pids.add(int(handle.read().strip() or 0))
        except (OSError, ValueError):
            pass
        for pid in pids:
            if pid and pid != os.getpid():
                kill_process(pid)
        try:
            os.remove(self.pid_file)
        except OSError:
            pass


# ------------------------------------------------------- one window at a time
class WindowControl:
    """Loopback endpoint of the open window: 'show' brings it to the front, 'quit' closes it."""

    def __init__(self, folder, on_show, on_quit):
        self.path = os.path.join(folder, CONTROL_FILE)
        self.token = secrets.token_hex(16)
        self.on_show = on_show
        self.on_quit = on_quit
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        write_json(self.path, {"pid": os.getpid(), "port": self.server.getsockname()[1], "token": self.token})
        threading.Thread(target=self._serve, name="twin-window-control", daemon=True).start()

    def _serve(self):
        while True:
            try:
                connection, _address = self.server.accept()
            except OSError:
                return
            with connection:
                try:
                    connection.settimeout(2)
                    line = connection.makefile("r", encoding="utf-8").readline().strip()
                except (OSError, UnicodeDecodeError):
                    continue
                token, _space, command = line.partition(" ")
                action = {"show": self.on_show, "quit": self.on_quit}.get(command)
                if not action or not hmac.compare_digest(token, self.token):
                    continue
                try:
                    connection.sendall(b"ok\n")
                except OSError:
                    pass
            try:
                action()
            except Exception as error:
                log("control %s failed: %s" % (command, error))

    def close(self):
        try:
            self.server.close()
        except OSError:
            pass
        if read_json(self.path, {}).get("token") == self.token:
            try:
                os.remove(self.path)
            except OSError:
                pass


def send_to_window(folder, command, timeout=2.0):
    """Ask an open Twin window to 'show' itself or 'quit'. True if one answered."""
    info = read_json(os.path.join(folder, CONTROL_FILE), {})
    try:
        port, token, pid = int(info["port"]), str(info["token"]), int(info.get("pid") or 0)
    except (KeyError, TypeError, ValueError):
        return False
    if command == "show" and sys.platform == "win32" and pid:
        try:
            import ctypes

            ctypes.windll.user32.AllowSetForegroundWindow(pid)
        except (OSError, AttributeError):
            pass
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout) as connection:
            connection.settimeout(timeout)
            connection.sendall(("%s %s\n" % (token, command)).encode("utf-8"))
            reply = connection.makefile("r", encoding="utf-8").readline().strip()
    except (OSError, UnicodeDecodeError):
        return False
    if reply == "ok" and command == "quit" and pid:
        deadline = time.time() + 20
        while time.time() < deadline and process_alive(pid):
            time.sleep(0.2)
    return reply == "ok"


# ------------------------------------------------------------ window bits
def system_prefers_dark():
    try:
        if sys.platform == "win32":
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as key:
                return winreg.QueryValueEx(key, "AppsUseLightTheme")[0] == 0
        if sys.platform == "darwin":
            result = subprocess.run(["defaults", "read", "-g", "AppleInterfaceStyle"],
                                    capture_output=True, text=True, timeout=5)
            return "dark" in result.stdout.lower()
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return False


def page(body, dark):
    return LOADING_PAGE % {
        "background": DARK_BACKGROUND if dark else LIGHT_BACKGROUND,
        "text": "#e6edf3" if dark else "#111827",
        "body": body,
    }


def html_escape(text):
    return str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def saved_size(settings):
    try:
        width, height = int(settings["width"]), int(settings["height"])
    except (KeyError, TypeError, ValueError):
        return DEFAULT_SIZE
    if MIN_SIZE[0] <= width <= 8000 and MIN_SIZE[1] <= height <= 8000:
        return width, height
    return DEFAULT_SIZE


def screen_work_area():
    try:
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes

            rect = wintypes.RECT()
            if ctypes.windll.user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0):  # SPI_GETWORKAREA
                return rect.right - rect.left, rect.bottom - rect.top
        if sys.platform == "darwin":
            from AppKit import NSScreen  # comes with pywebview

            frame = NSScreen.mainScreen().visibleFrame()
            return int(frame.size.width), int(frame.size.height)
    except Exception:  # sizing is cosmetic
        return None
    return None


def fit_size(size, work_area):
    width, height = size
    if work_area:
        width = min(width, work_area[0] - 40)
        height = min(height, work_area[1] - 40)
    return max(width, MIN_SIZE[0]), max(height, MIN_SIZE[1])


def webview2_runtime():
    """Version of the installed Microsoft Edge WebView2 runtime, or None (Windows only)."""
    if sys.platform != "win32":
        return None
    import platform
    import winreg

    clients = [
        "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",  # WebView2 Runtime
        "{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}",  # Beta
        "{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}",  # Dev
        "{65C35B14-6C1D-4122-AC46-7148CC9D6497}",  # Canary
    ]
    for client in clients:
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            native = hive == winreg.HKEY_CURRENT_USER or platform.machine() == "x86"
            path = r"SOFTWARE\%sMicrosoft\EdgeUpdate\Clients\%s" % ("" if native else "WOW6432Node\\", client)
            try:
                with winreg.OpenKey(hive, path) as key:
                    version = str(winreg.QueryValueEx(key, "pv")[0])
            except OSError:
                continue
            if version and version != "0.0.0.0":
                return version
    return None


def bring_to_front(window):
    if sys.platform == "win32":
        try:
            import ctypes

            user32 = ctypes.windll.user32
            hwnd = int(window.native.Handle.ToInt64())
            if user32.IsIconic(hwnd):
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
            user32.SetForegroundWindow(hwnd)
            return
        except Exception:
            pass
    else:
        window.restore()
    window.show()


class DesktopApi:
    """Exposed to the page as window.pywebview.api (broker-ui.js opens broker sites through it)."""

    def __init__(self):
        self._window = None  # underscore: pywebview does not expose it to the page

    def info(self):
        return {"shell": "desktop", "version": VERSION, "platform": sys.platform}

    def open_external(self, url):
        url = str(url or "")
        if url.startswith("https://") or url.startswith("http://"):
            webbrowser.open(url)
            return True
        return False


# -------------------------------------------------------- updates of the app
def check_shell_update(window, settings_path):
    """Tell the person once per version when a newer desktop app is published (Twin itself updates in-app)."""
    try:
        request = urllib.request.Request(SHELL_INFO_URL, headers={"User-Agent": "TwinDesktop/" + VERSION})
        with urllib.request.urlopen(request, timeout=15) as response:
            info = json.loads(response.read(64 * 1024).decode("utf-8"))
        desktop = info.get("desktop") or {}
        latest = str(desktop.get("version") or "")
    except Exception as error:  # offline: try again next launch
        log("desktop update check skipped: %s" % error)
        return
    if not version_tuple(latest) or version_tuple(latest) <= version_tuple(VERSION):
        return
    settings = read_json(settings_path, {})
    if settings.get("skipped_version") == latest:
        return
    settings["skipped_version"] = latest
    write_json(settings_path, settings)
    page_url = str(desktop.get("page") or DOWNLOAD_PAGE)
    if not page_url.startswith("https://"):
        page_url = DOWNLOAD_PAGE
    question = ("Twin desktop %s is available (you have %s). Your accounts and broker connection stay as they are."
                "\n\nOpen the download page?" % (latest, VERSION))
    try:
        if window.create_confirmation_dialog("Update Twin", question):
            webbrowser.open(page_url)
    except Exception as error:
        log("update dialog failed: %s" % error)


# ------------------------------------------------------------ self-tests
class ApiClient:
    """Tiny cookie-keeping client for the window test (signup, then real API calls)."""

    def __init__(self, port):
        import http.cookiejar

        self.base = "http://127.0.0.1:%d" % port
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def post(self, path, body=None, timeout=120):
        request = urllib.request.Request(
            self.base + path,
            data=json.dumps(body or {}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return json.loads(error.read().decode("utf-8") or "{}")


def server_checks(port):
    """Use the running server like the app does: an account, a Twin tool, Add money, the update check."""
    client = ApiClient(port)
    results = {}
    signup = client.post("/api/signup", {"username": "desktop_check", "password": secrets.token_hex(8),
                                         "name": "Desktop check"})
    results["signup"] = bool(signup.get("ok"))
    clock = client.post("/api/trade", {"mode": "demo", "step": "clock"})
    data = clock.get("data") if isinstance(clock.get("data"), dict) else {}
    results["tool"] = bool(clock.get("ok") and data)
    results["tool_detail"] = (clock.get("stderr") or clock.get("error") or "")[-400:]
    funding = client.post("/api/broker/funding")
    info = funding.get("funding") if isinstance(funding.get("funding"), dict) else {}
    results["funding"] = bool(funding.get("ok") and "connected" in info)
    results["funding_detail"] = {key: info.get(key) for key in ("connected", "open_account_urls") if key in info}
    update = client.post("/api/update/status")
    results["update_status"] = bool(update.get("ok") and update.get("current"))
    results["update_blocker"] = update.get("reason")
    return results


def selftest_tools(app_dir):
    """Run every Twin tool with --help through this program (what server.py does with sys.executable)."""
    failures = []
    for rel in TOOL_SCRIPTS:
        script = os.path.join(app_dir, *rel.split("/"))
        try:
            result = subprocess.run([sys.executable, script, "--help"], cwd=os.path.dirname(script),
                                    capture_output=True, text=True, timeout=120,
                                    creationflags=0x08000000 if sys.platform == "win32" else 0)
        except (OSError, subprocess.SubprocessError) as error:
            failures.append("%s: %s" % (rel, error))
            continue
        ok = result.returncode == 0 and "usage" in (result.stdout + result.stderr).lower()
        print("%-4s %s" % ("ok" if ok else "FAIL", rel), flush=True)
        if not ok:
            failures.append("%s: exit %s %s" % (rel, result.returncode, (result.stderr or result.stdout)[-300:]))
    return failures


def write_report(path, **fields):
    fields.setdefault("pid", os.getpid())
    fields.setdefault("version", VERSION)
    write_json(path, fields)


# ------------------------------------------------------------ the window
def run_window(root, report_path):
    """Start the server and show Twin until the window closes. Returns an exit code."""
    if sys.platform == "win32":
        runtime = webview2_runtime()
        gui = "edgechromium" if runtime else None
    elif sys.platform == "darwin":
        runtime = None
        gui = "cocoa"
    else:
        runtime = None
        gui = None
    settings_path = os.path.join(root, SETTINGS_FILE)
    settings = read_json(settings_path, {})
    app_dir = prepare_code(root)
    server = TwinServer(root, app_dir, os.path.join(root, "data"))
    server.start(server.choose_port(free_port() if report_path else None))
    url = "http://127.0.0.1:%d/" % server.port

    try:
        import webview
    except ImportError as error:
        webview = None
        log("pywebview is not available: %s" % error)
    if webview is None or gui is None:
        # No native window here (no WebView2): Twin still works in the default browser.
        info = server.wait_ready()
        if report_path:
            write_report(report_path, method="none", error="no native window on this system", health=info)
            server.stop()
            return 1
        if info:
            webbrowser.open(url)
            log("no native window; Twin is open in the browser at %s (close this program's server with --stop)" % url)
            try:
                while server.process.poll() is None or server._pid_from_file_alive():
                    time.sleep(1)
            except KeyboardInterrupt:
                pass
        server.stop()
        return 0 if info else 1

    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    dark = system_prefers_dark()
    width, height = fit_size(saved_size(settings), screen_work_area())
    api = DesktopApi()
    window = webview.create_window(
        TITLE,
        html=page("<div class='dot'></div><h1>Starting Twin…</h1><p>Your own Twin server is starting on this "
                  "computer.</p>", dark),
        js_api=api,
        width=width,
        height=height,
        min_size=MIN_SIZE,
        background_color=DARK_BACKGROUND if dark else LIGHT_BACKGROUND,
        text_select=True,
        zoomable=True,
        focus=not report_path,
    )
    api._window = window
    control = None if report_path else WindowControl(root, on_show=lambda: bring_to_front(window),
                                                     on_quit=window.destroy)
    state = {"health": None, "tested": False}

    def remember_size():
        try:
            current = read_json(settings_path, {})
            if window.width >= MIN_SIZE[0] and window.height >= MIN_SIZE[1]:
                current.update(width=int(window.width), height=int(window.height))
                write_json(settings_path, current)
        except Exception:
            pass

    def self_test():
        deadline = time.time() + TEST_TIMEOUT
        page_info = {}
        settled = 0
        while time.time() < deadline:
            try:
                page_info = json.loads(window.evaluate_js(PAGE_SCRIPT) or "{}")
            except Exception as error:
                page_info = {"error": str(error)}
            ready = page_info.get("ready") == "complete" and page_info.get("addMoney") and page_info.get("server")
            settled = settled + 1 if ready else 0
            if settled >= 3:
                break
            time.sleep(0.5)
        checks = server_checks(server.port)
        renderer = gui
        if sys.platform == "win32":
            renderer = getattr(sys.modules.get("webview.platforms.winforms"), "renderer", gui)
        write_report(report_path, method="window", toolkit=renderer, runtime=runtime, health=state["health"],
                     server_url=url, app_dir=app_dir, frozen=frozen(), checks=checks, page=page_info)
        window.destroy()

    def start_app():
        info = server.wait_ready()
        state["health"] = info
        if not info:
            tail = html_escape(server.log_tail())
            window.load_html(page("<h1>Twin couldn't start</h1><p>Its log is in %s</p><pre>%s</pre>"
                                  % (html_escape(server.log_path), tail), dark))
            if report_path:
                write_report(report_path, method="window", error="server did not start", log=server.log_tail())
                window.destroy()
            return
        log("Twin %s is ready at %s" % (info.get("version"), url))
        window.load_url(url)
        if not report_path:
            threading.Timer(20, check_shell_update, args=(window, settings_path)).start()

    def on_loaded():
        if report_path and state["health"] and not state["tested"]:
            state["tested"] = True
            threading.Thread(target=self_test, name="twin-window-test", daemon=True).start()

    window.events.closing += remember_size
    window.events.loaded += on_loaded
    storage = os.path.join(root, "WebView2") if sys.platform == "win32" else None
    try:
        webview.start(start_app, gui=gui, private_mode=False, storage_path=storage)
    except Exception as error:
        log("the window failed: %s" % error)
        if report_path:
            write_report(report_path, method="none", error="window failed: %s" % error)
        return 1
    finally:
        if control:
            control.close()
        server.stop()
    return 0


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if args and args[0].lower().endswith(".py"):
        return run_script(args)  # server.py or one of its tools, run by server.py
    if "--version" in args:
        print("Twin desktop %s (Twin %s)" % (VERSION, twin_version(bundled_code())))
        return 0
    report_path = os.environ.get("TWIN_WINDOW_TEST") or None
    if report_path:
        report_path = os.path.abspath(report_path)
        # Checks never touch a person's accounts: a throwaway Twin home next to the report.
        os.environ["TWIN_DESKTOP_HOME"] = os.path.join(os.path.dirname(report_path), "twin-home")
    root = data_root()
    os.makedirs(root, exist_ok=True)
    LOG_STATE["path"] = os.path.join(logs_dir(root), "desktop.log")
    if "--stop" in args:
        send_to_window(root, "quit")
        return 0
    if "--selftest-tools" in args:
        attach_streams("selftest.log")
        if frozen():
            os.environ.setdefault("TWIN_DESKTOP_HOME", tempfile.mkdtemp(prefix="twin-selftest-"))
        failures = selftest_tools(prepare_code(data_root()))
        print("FAILED:\n  " + "\n  ".join(failures) if failures else "OK: every Twin tool runs", flush=True)
        return 1 if failures else 0
    if not report_path and send_to_window(root, "show"):
        return 0  # already open: brought to the front
    return run_window(root, report_path)


if __name__ == "__main__":
    sys.exit(main())
