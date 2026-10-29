"""The Vitals app window: the dashboard in its own native window instead of a browser tab.

    Windows  Microsoft Edge WebView2 (part of Windows 10 and 11), through pywebview
    macOS    the system WebKit (WKWebView), through pywebview
    Linux    WebKitGTK, through the system Python (python3-gi + gir1.2-webkit2-4.1; see linux_window.py)

When none of these is available the dashboard opens in a Chromium-based browser's app mode (a plain
window without tabs or address bar), and as a last resort in the default browser.

Opening Vitals while its window is already open brings that window to the front, and `Vitals --stop`
closes it. Both talk to the window over a loopback socket described in <data>/window.json.

For automated checks, VITALS_WINDOW_TEST=<file.json> makes the window write a report once the
dashboard is live and close itself (after VITALS_WINDOW_TEST_HOLD seconds); in that mode no browser
is ever opened as a fallback.
"""

import hmac
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser

TITLE = "Vitals"
DEFAULT_SIZE = (1280, 860)
MIN_SIZE = (420, 560)
DARK_BACKGROUND = "#0a0e13"  # the dashboard's own background colours (web/styles.css)
LIGHT_BACKGROUND = "#f4f6f8"
CONTROL_FILE = "window.json"
SIZE_FILE = "window-size.json"
LIVE_SCRIPT = "(document.querySelector('.mode-pill') || {}).textContent || ''"
PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, userAgent: navigator.userAgent,"
    " bridge: !!window.pywebview, width: window.innerWidth, height: window.innerHeight})"
)
TEST_TIMEOUT = 60


def log(message):
    if sys.stdout is not None:
        print("[window] " + message, flush=True)


# ----------------------------------------------------------- small helpers
def here():
    """Folder with this program's own files (the PyInstaller bundle, or this checkout)."""
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def app_support_dir():
    """Per-user folder for the window's browser data (cookies, local storage, cache)."""
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), "Vitals")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Vitals")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "vitals")


def system_prefers_dark():
    """The window's background before the page paints: match the system so it doesn't flash."""
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
        result = subprocess.run(["gsettings", "get", "org.gnome.desktop.interface", "color-scheme"],
                                capture_output=True, text=True, timeout=5)
        return "dark" in result.stdout.lower()
    except (OSError, ValueError, subprocess.SubprocessError):
        return True  # the dashboard's own default is the dark theme


def background_colour():
    return DARK_BACKGROUND if system_prefers_dark() else LIGHT_BACKGROUND


def fit_size(size, work_area):
    """Clamp a window size to the screen's work area (minus a margin) and the minimum size."""
    width, height = size
    if work_area:
        width = min(width, work_area[0] - 40)
        height = min(height, work_area[1] - 40)
    return max(width, MIN_SIZE[0]), max(height, MIN_SIZE[1])


def saved_size(data_dir):
    try:
        with open(os.path.join(data_dir, SIZE_FILE), encoding="utf-8") as handle:
            data = json.load(handle)
        width, height = int(data["width"]), int(data["height"])
    except (OSError, ValueError, KeyError, TypeError):
        return DEFAULT_SIZE
    if MIN_SIZE[0] <= width <= 8000 and MIN_SIZE[1] <= height <= 8000:
        return width, height
    return DEFAULT_SIZE


def save_size(data_dir, width, height):
    try:
        width, height = int(width), int(height)
        if width < MIN_SIZE[0] or height < MIN_SIZE[1]:
            return
        os.makedirs(data_dir, exist_ok=True)
        with open(os.path.join(data_dir, SIZE_FILE), "w", encoding="utf-8") as handle:
            json.dump({"width": width, "height": height}, handle)
    except (OSError, ValueError, TypeError):
        pass


def screen_work_area():
    """(width, height) of the primary screen's work area in the units the window uses, or None."""
    try:
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            rect = wintypes.RECT()
            if not user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(rect), 0):  # SPI_GETWORKAREA
                return None
            width, height = rect.right - rect.left, rect.bottom - rect.top
            aware = 0
            try:
                user32.GetThreadDpiAwarenessContext.restype = ctypes.c_void_p
                user32.GetAwarenessFromDpiAwarenessContext.argtypes = [ctypes.c_void_p]
                aware = user32.GetAwarenessFromDpiAwarenessContext(user32.GetThreadDpiAwarenessContext())
            except AttributeError:  # Windows before 10 (1607)
                pass
            if aware:
                # A DPI-aware process sees physical pixels; the window size is in logical ones.
                dpi = user32.GetDpiForSystem() if hasattr(user32, "GetDpiForSystem") else 96
                width, height = width * 96 // max(dpi, 96), height * 96 // max(dpi, 96)
            return width, height
        if sys.platform == "darwin":
            from AppKit import NSScreen  # comes with pywebview

            frame = NSScreen.mainScreen().visibleFrame()
            return int(frame.size.width), int(frame.size.height)
    except Exception:  # sizing is cosmetic: never fail the window over it
        return None
    return None


def detached_options():
    """Popen options for a program that should outlive this one."""
    options = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
               "close_fds": True}
    if os.name == "nt":
        options["creationflags"] = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        options["start_new_session"] = True
    return options


class Report:
    """The VITALS_WINDOW_TEST report (a no-op when the variable isn't set)."""

    def __init__(self):
        self.path = os.environ.get("VITALS_WINDOW_TEST") or None
        try:
            self.hold = float(os.environ.get("VITALS_WINDOW_TEST_HOLD") or 0)
        except ValueError:
            self.hold = 0.0

    @property
    def active(self):
        return bool(self.path)

    def write(self, **fields):
        if not self.path:
            return
        fields.setdefault("pid", os.getpid())
        temporary = self.path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(fields, handle, indent=2)
        os.replace(temporary, self.path)


# ------------------------------------------------------- one window at a time
class WindowControl:
    """Loopback endpoint of an open window: 'show' brings it to the front, 'quit' closes it."""

    def __init__(self, data_dir, on_show, on_quit):
        self.path = os.path.join(data_dir, CONTROL_FILE)
        self.token = secrets.token_hex(16)
        self.on_show = on_show
        self.on_quit = on_quit
        self.server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server.bind(("127.0.0.1", 0))
        self.server.listen(4)
        os.makedirs(data_dir, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump({"pid": os.getpid(), "port": self.server.getsockname()[1], "token": self.token}, handle)
        threading.Thread(target=self._serve, name="vitals-window-control", daemon=True).start()

    def _serve(self):
        while True:
            try:
                connection, _address = self.server.accept()
            except OSError:
                return  # closed
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
            except Exception as error:  # a broken request must not take the window down
                log("control %s failed: %s" % (command, error))

    def close(self):
        try:
            self.server.close()
        except OSError:
            pass
        try:
            with open(self.path, encoding="utf-8") as handle:
                mine = json.load(handle).get("token") == self.token
            if mine:
                os.remove(self.path)
        except (OSError, ValueError):
            pass


def window_info(data_dir):
    try:
        with open(os.path.join(data_dir, CONTROL_FILE), encoding="utf-8") as handle:
            info = json.load(handle)
        return {"pid": int(info.get("pid") or 0), "port": int(info["port"]), "token": str(info["token"])}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def send_to_window(data_dir, command, timeout=2.0):
    """Ask an open Vitals window to 'show' itself or 'quit'. True if one answered."""
    info = window_info(data_dir)
    if not info:
        return False
    if command == "show" and sys.platform == "win32" and info["pid"]:
        try:
            import ctypes

            # We were just started by the user, so we may hand the foreground to the window.
            ctypes.windll.user32.AllowSetForegroundWindow(info["pid"])
        except (OSError, AttributeError):
            pass
    try:
        with socket.create_connection(("127.0.0.1", info["port"]), timeout=timeout) as connection:
            connection.settimeout(timeout)
            connection.sendall(("%s %s\n" % (info["token"], command)).encode("utf-8"))
            reply = connection.makefile("r", encoding="utf-8").readline().strip()
    except (OSError, UnicodeDecodeError):
        return False
    return reply == "ok"


def wait_for_exit(pid, timeout):
    """True once process `pid` has exited (or never existed), False if it outlives `timeout` seconds."""
    if not pid or pid == os.getpid():
        return True
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return True
        try:
            return kernel32.WaitForSingleObject(handle, int(timeout * 1000)) == 0
        finally:
            kernel32.CloseHandle(handle)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            pass
        time.sleep(0.1)
    return False


def close_window(data_dir, timeout=15.0):
    """Close an open Vitals window (used by --stop, so updates can replace the program files)."""
    info = window_info(data_dir)
    if not info or not send_to_window(data_dir, "quit"):
        return False
    return wait_for_exit(info["pid"], timeout)


# ------------------------------------------------------------ native windows
def webview2_runtime():
    """Version of the installed Microsoft Edge WebView2 runtime (and .NET 4.6.2+), or None.

    The same registry check Microsoft documents and pywebview uses; without it pywebview would
    quietly fall back to the Internet Explorer engine, which can't run the dashboard.
    """
    if sys.platform != "win32":
        return None
    import platform
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full") as key:
            if winreg.QueryValueEx(key, "Release")[0] < 394802:  # .NET Framework 4.6.2
                return None
    except OSError:
        return None
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
            try:
                if tuple(int(part) for part in version.split(".")[:3]) >= (86, 0, 622):
                    return version
            except ValueError:
                continue
    return None


def bring_to_front(window):
    """Show a pywebview window above the others, restoring it if it was minimised."""
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
    elif sys.platform == "darwin":
        window.restore()  # deminiaturize (no-op when not minimised)
    window.show()


def run_pywebview(url, data_dir, report):
    """Windows and macOS: show the dashboard in a native window until it is closed.

    Returns None when this system can't show one (the caller then falls back to a browser).
    """
    if sys.platform == "win32":
        runtime = webview2_runtime()
        if not runtime:
            log("Microsoft Edge WebView2 runtime not found")
            return None
        gui = "edgechromium"
    elif sys.platform == "darwin":
        runtime = None
        gui = "cocoa"
    else:
        return None
    try:
        import webview
    except ImportError as error:
        log("pywebview is not available: %s" % error)
        return None

    width, height = fit_size(saved_size(data_dir), screen_work_area())
    window = webview.create_window(
        TITLE,
        url,
        width=width,
        height=height,
        min_size=MIN_SIZE,
        background_color=background_colour(),
        text_select=True,
        zoomable=True,
        focus=not report.active,  # automated checks must not steal the keyboard
    )
    control = WindowControl(data_dir, on_show=lambda: bring_to_front(window), on_quit=window.destroy)
    state = {"tested": False}

    def remember_size():
        try:
            save_size(data_dir, window.width, window.height)
        except Exception:
            pass

    def self_test():
        deadline = time.time() + TEST_TIMEOUT
        pill = ""
        while time.time() < deadline:
            try:
                pill = window.evaluate_js(LIVE_SCRIPT) or ""
            except Exception:
                pill = ""
            if "Live" in pill:
                break
            time.sleep(0.5)
        try:
            page = json.loads(window.evaluate_js(PAGE_SCRIPT) or "{}")
        except Exception as error:
            page = {"error": str(error)}
        renderer = gui
        if sys.platform == "win32":
            renderer = getattr(sys.modules.get("webview.platforms.winforms"), "renderer", gui)
        report.write(method="window", toolkit=renderer, runtime=runtime, pill=pill.strip(), **page)
        if report.hold:
            time.sleep(report.hold)
        window.destroy()

    def on_loaded():
        if report.active and not state["tested"]:
            state["tested"] = True
            threading.Thread(target=self_test, name="vitals-window-test", daemon=True).start()

    window.events.closing += remember_size
    window.events.loaded += on_loaded
    storage = os.path.join(app_support_dir(), "WebView2") if sys.platform == "win32" else None
    try:
        webview.start(gui=gui, private_mode=False, storage_path=storage)
    except Exception as error:
        log("the window failed: %s" % error)
        return None
    finally:
        control.close()
    return "window"


def linux_python():
    """The system Python, which has the GTK bindings the bundled one lacks."""
    for candidate in ("/usr/bin/python3", shutil.which("python3")):
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def run_linux_window(url, data_dir, report):
    """Linux: start linux_window.py with the system Python. Returns None if GTK/WebKit is missing."""
    python = linux_python()
    script = os.path.join(here(), "linux_window.py")
    if not python or not os.path.isfile(script):
        log("no system Python or linux_window.py")
        return None
    width, height = saved_size(data_dir)
    command = [
        python, script,
        "--url", url,
        "--title", TITLE,
        "--data", data_dir,
        "--storage", os.path.join(app_support_dir(), "webkit"),
        "--size", "%dx%d" % (width, height),
        "--background", background_colour(),
    ]
    icon = os.path.join(here(), "web", "icons", "icon-512.png")
    if os.path.isfile(icon):
        command += ["--icon", icon]
    if report.active:
        command += ["--test", report.path, "--hold", str(report.hold)]
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(("_PYI", "PYTHONHOME", "PYTHONPATH"))}
    # WebKitGTK's DMA-BUF renderer shows a blank window on many GPUs and virtual machines.
    env.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
    try:
        os.makedirs(data_dir, exist_ok=True)
        output = open(os.path.join(data_dir, "window.log"), "a", encoding="utf-8")
    except OSError:
        output = subprocess.DEVNULL
    options = detached_options()
    options.update(stdout=output, stderr=output, env=env)
    try:
        child = subprocess.Popen(command, **options)
    except OSError as error:
        log("could not start the Linux window: %s" % error)
        return None
    if report.active:
        try:
            child.wait(timeout=TEST_TIMEOUT + report.hold + 30)
        except subprocess.TimeoutExpired:
            child.kill()
        return "window" if child.returncode == 0 else None
    # Wait until the window is up (it then owns window.json) or the helper gives up.
    deadline = time.time() + 10
    while time.time() < deadline:
        if child.poll() is not None:
            if child.returncode != 0:
                log("the Linux window exited with status %s (python3-gi / WebKitGTK missing?)" % child.returncode)
                return None
            return "window"
        info = window_info(data_dir)
        if info and info["pid"] == child.pid:
            return "window"
        time.sleep(0.1)
    return "window"


# ------------------------------------------------------------- fallbacks
def browser_candidates():
    """Chromium-based browsers that can show a page as an app window (--app)."""
    if sys.platform == "win32":
        roots = [os.environ.get(name) for name in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
        programs = [
            ("Microsoft", "Edge", "Application", "msedge.exe"),
            ("Google", "Chrome", "Application", "chrome.exe"),
            ("BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        ]
        return [os.path.join(root, *program) for program in programs for root in roots if root]
    if sys.platform == "darwin":
        names = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium", "Vivaldi"]
        folders = ["/Applications", os.path.expanduser("~/Applications")]
        return [os.path.join(folder, name + ".app", "Contents", "MacOS", name) for name in names for folder in folders]
    commands = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
                "microsoft-edge", "microsoft-edge-stable", "brave-browser", "vivaldi"]
    return [path for path in (shutil.which(command) for command in commands) if path]


def open_app_mode(url, data_dir):
    """Open the dashboard as a browser 'app' window (no tabs or address bar). Returns the browser."""
    width, height = fit_size(saved_size(data_dir), screen_work_area())
    for path in browser_candidates():
        if not os.path.isfile(path):
            continue
        command = [path, "--app=" + url, "--window-size=%d,%d" % (width, height),
                   "--no-first-run", "--no-default-browser-check"]
        try:
            subprocess.Popen(command, **detached_options())
        except OSError:
            continue
        return path
    return None


def show_dashboard(url, data_dir, browser=False):
    """Show the dashboard: the open window, else a new native window, else a browser window.

    Returns how: "focused", "window", "app-mode", "browser" or (in tests) "unavailable".
    Blocks while a Windows or Mac window is open.
    """
    report = Report()
    if not browser:
        if send_to_window(data_dir, "show"):
            report.write(method="focused")
            return "focused"
        runner = run_linux_window if sys.platform.startswith("linux") else run_pywebview
        method = runner(url, data_dir, report)
        if method:
            return method
        if report.active:
            report.write(method="unavailable", platform=sys.platform)
            return "unavailable"
        browser_path = open_app_mode(url, data_dir)
        if browser_path:
            log("opened in %s app mode" % os.path.basename(browser_path))
            return "app-mode"
    elif report.active:
        report.write(method="browser")
        return "browser"
    webbrowser.open(url)
    return "browser"
