"""Peers for Windows and macOS: the Peers app with its own local server, in one program.

The program ships Peers' web app (web/index.html, the single-file desktop build) and its zero-dependency
server (server/server.py). It runs that server inside this process on a private loopback port, with the
SQLite database in a per-user folder, and shows the app in a native window:

    Windows  %LOCALAPPDATA%\\Peers\\peers.db   window: Microsoft Edge WebView2 (via pywebview)
    macOS    ~/Library/Application Support/Peers/peers.db   window: WKWebView

Because the server injects its persistence shim when it serves index.html (the files on disk stay
byte-pristine), every change in the app - reviews, votes, categories, the market, settings - is saved to
peers.db as well as to the window's own storage, so it survives clearing the browser data, reinstalling
the app or moving to a new window profile. Settings -> Your data still exports and imports JSON.
Everything works offline; links to other sites open in the default browser.

    Peers --version | --stop
    PEERS_WINDOW_TEST=<report.json>   open, check the window and the database, write a report and close
    PEERS_DESKTOP_HOME=<folder>       use another data folder (the checks use a throwaway one)
"""

import hmac
import importlib.util
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser

VERSION = "1.0.0"
TITLE = "Peers"
PREFERRED_PORT = 8798  # the command-line server uses 8788, so both can run side by side
START_PAGE = "index.html"
LS_KEY = "peers_demo_v3"
DEFAULT_SIZE = (1280, 860)
MIN_SIZE = (400, 560)
BACKGROUND = "#FAF6EF"
SETTINGS_FILE = "settings.json"
CONTROL_FILE = "window.json"
DB_FILE = "peers.db"
TEST_TIMEOUT = 90
SHELL_INFO_URL = os.environ.get("PEERS_DESKTOP_INFO_URL") or "https://juw12.github.io/projects/peers/desktop.json"
DOWNLOAD_PAGE = "https://github.com/juw12/projects/releases/tag/peers"
PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, ready: document.readyState,"
    " app: typeof state === 'object' && !!state && typeof saveState === 'function',"
    " me: (typeof state === 'object' && state) ? state.meId || null : null,"
    " stored: !!localStorage.getItem(%s),"
    " bridge: !!(window.pywebview && window.pywebview.api),"
    " width: window.innerWidth, height: window.innerHeight})" % json.dumps(LS_KEY)
)


# ------------------------------------------------------------------ helpers
def frozen():
    return bool(getattr(sys, "frozen", False))


def data_root():
    override = os.environ.get("PEERS_DESKTOP_HOME")
    if override:
        return os.path.abspath(override)
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), "Peers")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Peers")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "peers")


LOG_STATE = {"path": None}


def log(message):
    line = "%s [peers-desktop] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
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
    parts = str(value or "").strip().split(".")
    if len(parts) != 3 or not all(part.isdigit() for part in parts):
        return None
    return tuple(int(part) for part in parts)


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


# ------------------------------------------------------- Peers' own server
def peers_folder():
    """The Peers app folder (web/ + server/): inside the program when frozen, else this checkout."""
    if frozen():
        return os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)), "peers")
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_server_module(db_path):
    """Import server/server.py with its database in the user folder (it reads PEERS_DB at import)."""
    os.environ["PEERS_DB"] = db_path
    path = os.path.join(peers_folder(), "server", "server.py")
    spec = importlib.util.spec_from_file_location("peers_server", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["peers_server"] = module
    spec.loader.exec_module(module)
    return module


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


def choose_port(settings_path, fixed=None):
    """Keep one port, so the window's own storage (tied to the address) stays the same between launches."""
    if fixed:
        return fixed
    settings = read_json(settings_path, {})
    port = int(settings.get("port") or PREFERRED_PORT)
    if not port_free(port):
        port = PREFERRED_PORT if port != PREFERRED_PORT and port_free(PREFERRED_PORT) else free_port()
        log("port in use; Peers will use %d" % port)
    settings["port"] = port
    write_json(settings_path, settings)
    return port


class PeersServer:
    """server.py's PeersHandler on a loopback port, in a background thread of this program."""

    def __init__(self, db_path):
        self.db_path = db_path
        self.module = load_server_module(db_path)
        self.module.init_db()
        self.httpd = None
        self.port = None

    def start(self, port):
        self.httpd = self.module.ThreadingHTTPServer(("127.0.0.1", port), self.module.PeersHandler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, name="peers-server", daemon=True).start()
        log("Peers server on http://127.0.0.1:%d/ (database %s)" % (self.port, self.db_path))

    def url(self, page=START_PAGE):
        return "http://127.0.0.1:%d/%s" % (self.port, page)

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None


def http_json(url, body=None, method=None, timeout=10):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method or ("GET" if body is None else "POST"),
                                     headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # loopback only
    with opener.open(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


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
        threading.Thread(target=self._serve, name="peers-window-control", daemon=True).start()

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
    """Ask an open Peers window to 'show' itself or 'quit'. True if one answered."""
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
    """Exposed to the page as window.pywebview.api."""

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


def check_shell_update(window, settings_path):
    """Offer the download page once per version when a newer Peers desktop app is published."""
    try:
        request = urllib.request.Request(SHELL_INFO_URL, headers={"User-Agent": "PeersDesktop/" + VERSION})
        with urllib.request.urlopen(request, timeout=15) as response:
            desktop = (json.loads(response.read(64 * 1024).decode("utf-8")) or {}).get("desktop") or {}
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
    question = ("Peers desktop %s is available (you have %s). Your reviews and settings stay as they are."
                "\n\nOpen the download page?" % (latest, VERSION))
    try:
        if window.create_confirmation_dialog("Update Peers", question):
            webbrowser.open(page_url)
    except Exception as error:
        log("update dialog failed: %s" % error)


def write_report(path, **fields):
    fields.setdefault("pid", os.getpid())
    fields.setdefault("version", VERSION)
    write_json(path, fields)


def database_checks(window, server):
    """Save through the app's own saveState() and read it back from the server's database."""
    expected = os.environ.get("PEERS_EXPECT_MARK")  # set by the second run of smoke_test.py
    mark = expected or "desktop-check-" + secrets.token_hex(6)
    result = {"mark": mark}
    try:
        before = window.evaluate_js("(typeof state === 'object' && state) ? (state.desktopCheck || null) : null")
    except Exception as error:
        before = None
        result["error"] = str(error)
    result["mark_on_open"] = before
    if not expected:
        try:
            window.evaluate_js("state.desktopCheck = %s; saveState(state); true" % json.dumps(mark))
        except Exception as error:
            result["error"] = str(error)
        deadline = time.time() + 10
        saved = None
        while time.time() < deadline:
            try:
                saved = http_json(server.url("api/state")).get("desktopCheck")
            except (OSError, ValueError, urllib.error.URLError):
                saved = None
            if saved == mark:
                break
            time.sleep(0.25)
        result["saved_to_database"] = saved == mark
    else:
        result["restored_from_database"] = before == mark
    try:
        result["health"] = http_json(server.url("api/health"))
    except (OSError, ValueError, urllib.error.URLError) as error:
        result["health"] = {"error": str(error)}
    result["database_file"] = os.path.isfile(server.db_path)
    return result


# ------------------------------------------------------------ the window
def run_window(root, report_path):
    settings_path = os.path.join(root, SETTINGS_FILE)
    settings = read_json(settings_path, {})
    server = PeersServer(os.path.join(root, DB_FILE))
    server.start(choose_port(settings_path, free_port() if report_path else None))
    start_url = server.url()

    if sys.platform == "win32":
        runtime = webview2_runtime()
        gui = "edgechromium" if runtime else None
    elif sys.platform == "darwin":
        runtime = None
        gui = "cocoa"
    else:
        runtime = None
        gui = None
    try:
        import webview
    except ImportError as error:
        webview = None
        log("pywebview is not available: %s" % error)
    if webview is None or gui is None:
        # No native window here (no WebView2): Peers still works in the default browser.
        if report_path:
            write_report(report_path, method="none", error="no native window on this system")
            server.stop()
            return 1
        webbrowser.open(start_url)
        log("no native window; Peers is open in the browser at %s - close this program to stop it" % start_url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        server.stop()
        return 0

    webview.settings["ALLOW_DOWNLOADS"] = True  # Settings -> Your data -> Export saves a JSON file
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    width, height = fit_size(saved_size(settings), screen_work_area())
    api = DesktopApi()
    window = webview.create_window(
        TITLE,
        start_url,
        js_api=api,
        width=width,
        height=height,
        min_size=MIN_SIZE,
        background_color=BACKGROUND,
        text_select=True,
        zoomable=True,
        focus=not report_path,
    )
    api._window = window
    control = None if report_path else WindowControl(root, on_show=lambda: bring_to_front(window),
                                                     on_quit=window.destroy)
    state = {"tested": False}

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
            ready = page_info.get("ready") == "complete" and page_info.get("app") and page_info.get("me")
            settled = settled + 1 if ready else 0
            if settled >= 3:
                break
            time.sleep(0.5)
        checks = database_checks(window, server)
        renderer = gui
        if sys.platform == "win32":
            renderer = getattr(sys.modules.get("webview.platforms.winforms"), "renderer", gui)
        write_report(report_path, method="window", toolkit=renderer, runtime=runtime, server_url=start_url,
                     database=server.db_path, frozen=frozen(), page=page_info, checks=checks)
        window.destroy()

    def on_loaded():
        if report_path and not state["tested"]:
            state["tested"] = True
            threading.Thread(target=self_test, name="peers-window-test", daemon=True).start()

    def after_start():
        if not report_path:
            threading.Timer(20, check_shell_update, args=(window, settings_path)).start()

    window.events.closing += remember_size
    window.events.loaded += on_loaded
    storage = None
    if sys.platform == "win32":
        # Checks use a throwaway browser profile next to their report, so only the database carries data over.
        storage = os.path.join(os.path.dirname(report_path), "WebView2") if report_path else os.path.join(root, "WebView2")
    try:
        webview.start(after_start, gui=gui, private_mode=False, storage_path=storage)
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
    if "--version" in args:
        print("Peers desktop %s" % VERSION)
        return 0
    report_path = os.environ.get("PEERS_WINDOW_TEST") or None
    if report_path:
        report_path = os.path.abspath(report_path)
        os.environ.setdefault("PEERS_DESKTOP_HOME", os.path.join(os.path.dirname(report_path), "peers-home"))
    root = data_root()
    os.makedirs(root, exist_ok=True)
    LOG_STATE["path"] = os.path.join(root, "desktop.log")
    if "--stop" in args:
        send_to_window(root, "quit")
        return 0
    if not report_path and send_to_window(root, "show"):
        return 0  # already open: brought to the front
    return run_window(root, report_path)


if __name__ == "__main__":
    sys.exit(main())
