"""Mint for Windows and macOS: the Mint web app (Budget + Templates) in its own window.

    Windows  Microsoft Edge WebView2 (part of Windows 10 and 11), through pywebview
    macOS    the system WebKit (WKWebView), through pywebview

The window opens https://juw12.github.io/projects/mint/ and keeps its browser data (budgets, language,
region, sign-in) in a per-user folder, so everything is still there the next time Mint opens. Downloads
(.xlsx, CSV, backups, result cards) are allowed and land in the usual Downloads folder; links to other
sites open in the default browser. Without WebView2 Mint opens in the default browser instead.

Opening Mint while its window is open brings that window to the front; `Mint --stop` closes it.

Automated checks: MINT_WINDOW_TEST=<report.json> makes the window write a report once the page has
loaded and then close itself; MINT_DESKTOP_URL overrides the address.
"""

import hmac
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser

VERSION = "3.1.0"
TITLE = "Mint"
APP_URL = os.environ.get("MINT_DESKTOP_URL") or "https://juw12.github.io/projects/mint/"
DEFAULT_SIZE = (1280, 860)
MIN_SIZE = (400, 560)
LIGHT_BACKGROUND = "#f6f7f5"
DARK_BACKGROUND = "#0b0d0c"
CONTROL_FILE = "window.json"
SIZE_FILE = "window-size.json"
TEST_TIMEOUT = 60
PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, userAgent: navigator.userAgent,"
    " locale: !!window.MintLocale, gate: !!document.querySelector('.mint-locale'),"
    " storage: (function () { try { localStorage.setItem('mint.desktop.check', '1');"
    " return localStorage.getItem('mint.desktop.check') === '1'; } catch (e) { return false; } })(),"
    " ready: document.readyState, width: window.innerWidth, height: window.innerHeight})"
)


def log(message):
    if sys.stdout is not None:
        print("[mint] " + message, flush=True)


def here():
    """Folder with this program's own files (the PyInstaller bundle, or this checkout)."""
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def data_dir():
    """Per-user folder for the window's browser data and its own small settings."""
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), "Mint")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Mint")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "mint")


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


def saved_size(folder):
    try:
        with open(os.path.join(folder, SIZE_FILE), encoding="utf-8") as handle:
            data = json.load(handle)
        width, height = int(data["width"]), int(data["height"])
    except (OSError, ValueError, KeyError, TypeError):
        return DEFAULT_SIZE
    if MIN_SIZE[0] <= width <= 8000 and MIN_SIZE[1] <= height <= 8000:
        return width, height
    return DEFAULT_SIZE


def save_size(folder, width, height):
    try:
        width, height = int(width), int(height)
        if width < MIN_SIZE[0] or height < MIN_SIZE[1]:
            return
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, SIZE_FILE), "w", encoding="utf-8") as handle:
            json.dump({"width": width, "height": height}, handle)
    except (OSError, ValueError, TypeError):
        pass


def screen_work_area():
    """(width, height) of the primary screen's work area in window units, or None."""
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


def online(url, timeout=6):
    """True when the Mint site answers (the window then loads it; otherwise the offline page)."""
    try:
        request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "MintDesktop/" + VERSION})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status < 500
    except Exception:
        return False


def offline_page():
    path = os.path.join(here(), "offline.html")
    return "file:///" + path.replace("\\", "/").lstrip("/") if os.path.isfile(path) else None


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
        os.makedirs(folder, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump({"pid": os.getpid(), "port": self.server.getsockname()[1], "token": self.token}, handle)
        threading.Thread(target=self._serve, name="mint-window-control", daemon=True).start()

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
        try:
            with open(self.path, encoding="utf-8") as handle:
                mine = json.load(handle).get("token") == self.token
            if mine:
                os.remove(self.path)
        except (OSError, ValueError):
            pass


def send_to_window(folder, command, timeout=2.0):
    """Ask an open Mint window to 'show' itself or 'quit'. True if one answered."""
    try:
        with open(os.path.join(folder, CONTROL_FILE), encoding="utf-8") as handle:
            info = json.load(handle)
        port, token, pid = int(info["port"]), str(info["token"]), int(info.get("pid") or 0)
    except (OSError, ValueError, KeyError, TypeError):
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
        deadline = time.time() + 15
        while time.time() < deadline and process_alive(pid):
            time.sleep(0.2)
    return reply == "ok"


def process_alive(pid):
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


# ------------------------------------------------------------ the window
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


def write_report(path, **fields):
    fields.setdefault("pid", os.getpid())
    fields.setdefault("version", VERSION)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(fields, handle, indent=2)
    os.replace(temporary, path)


def run_window(url, folder, report_path):
    """Show Mint in a native window until it is closed. Returns False when this system can't."""
    if sys.platform == "win32":
        runtime = webview2_runtime()
        if not runtime:
            log("Microsoft Edge WebView2 runtime not found")
            return False
        gui = "edgechromium"
    elif sys.platform == "darwin":
        runtime = None
        gui = "cocoa"
    else:
        return False
    try:
        import webview
    except ImportError as error:
        log("pywebview is not available: %s" % error)
        return False

    # Let the page save files (.xlsx, CSV, backups) and send other sites to the default browser.
    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True

    start_url = url if (report_path or online(url)) else (offline_page() or url)
    width, height = fit_size(saved_size(folder), screen_work_area())
    window = webview.create_window(
        TITLE,
        start_url,
        width=width,
        height=height,
        min_size=MIN_SIZE,
        background_color=DARK_BACKGROUND if system_prefers_dark() else LIGHT_BACKGROUND,
        text_select=True,
        zoomable=True,
        focus=not report_path,
    )
    control = WindowControl(folder, on_show=lambda: bring_to_front(window), on_quit=window.destroy)
    state = {"tested": False}

    def remember_size():
        try:
            save_size(folder, window.width, window.height)
        except Exception:
            pass

    def self_test():
        deadline = time.time() + TEST_TIMEOUT
        page = {}
        settled = 0
        while time.time() < deadline:
            try:
                page = json.loads(window.evaluate_js(PAGE_SCRIPT) or "{}")
            except Exception as error:
                page = {"error": str(error)}
            # The front door redirects into Budget: wait until a fully loaded page stays put for a moment.
            settled = settled + 1 if page.get("locale") and page.get("ready") == "complete" else 0
            if settled >= 3:
                break
            time.sleep(0.5)
        renderer = gui
        if sys.platform == "win32":
            renderer = getattr(sys.modules.get("webview.platforms.winforms"), "renderer", gui)
        write_report(report_path, method="window", toolkit=renderer, runtime=runtime, **page)
        window.destroy()

    def on_loaded():
        if report_path and not state["tested"]:
            state["tested"] = True
            threading.Thread(target=self_test, name="mint-window-test", daemon=True).start()

    window.events.closing += remember_size
    window.events.loaded += on_loaded
    storage = None
    if sys.platform == "win32":
        # Automated checks use a throwaway profile so they never touch a person's budgets.
        base = os.path.dirname(os.path.abspath(report_path)) if report_path else folder
        storage = os.path.join(base, "WebView2")
    try:
        webview.start(gui=gui, private_mode=False, storage_path=storage)
    except Exception as error:
        log("the window failed: %s" % error)
        return False
    finally:
        control.close()
    return True


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    folder = data_dir()
    if "--version" in args:
        print("Mint %s" % VERSION)
        return 0
    if "--stop" in args:
        send_to_window(folder, "quit")
        return 0
    report_path = os.environ.get("MINT_WINDOW_TEST") or None
    if not report_path and send_to_window(folder, "show"):
        return 0  # already open: brought to the front
    if run_window(APP_URL, folder, report_path):
        return 0
    if report_path:
        write_report(report_path, method="none", error="no native window on this system")
        return 1
    webbrowser.open(APP_URL)
    return 0


if __name__ == "__main__":
    sys.exit(main())
