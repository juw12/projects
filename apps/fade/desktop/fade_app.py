"""Fade for Windows (and macOS): the live Fade app in its own window.

The program carries Fade's web app (web/) and serves it to a native window from a private loopback
address. The app inside is the real, live Fade: accounts, barbers, shops, shorts, bookings, DMs and
payment records go over the Fade Network (public Nostr relays, Blossom media servers and ntfy push,
see web/config.js), exactly as on https://juw12.github.io/projects/fade/ - so people using the Windows
app, the website and phones all see each other. Nothing about Fade's code is changed; this program adds
what a desktop app needs around it:

  * Your account stays signed in. Fade keeps its account key and unsent changes in the window's
    storage; every change is also mirrored to %LOCALAPPDATA%\\Fade\\storage.json and put back if
    that storage is ever empty (new window profile, cleared data, another port), so restarts and
    reinstalls keep you signed in with nothing lost.
  * Booking requests, confirmations, DMs, payments and the 2-hour reminder show up as Windows
    notifications (and the taskbar button flashes) while Fade is open in the background.
  * Payment links (PayPal, Venmo, Cash App, Stripe, Wise...), Lightning invoices and mail links open
    in your browser or wallet app; one Fade window at a time; window size is remembered.

    Windows  %LOCALAPPDATA%\\Fade\\          window: Microsoft Edge WebView2 (via pywebview)
    macOS    ~/Library/Application Support/Fade/   window: WKWebView

    Fade --version | --stop | --devnet (a local test network instead of the public relays)
    FADE_WINDOW_TEST=<report.json>   open, run the checks, write a report and close (smoke_test.py)
    FADE_DESKTOP_HOME=<folder>       use another data folder (the checks use a throwaway one)
    FADE_DESKTOP_RELAYS / _BLOSSOM / _NTFY / _NS   point the app at other Fade Network services
"""

import hmac
import importlib.util
import json
import mimetypes
import os
import posixpath
import secrets
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "1.0.0"
TITLE = "Fade"
PREFERRED_PORT = 8796  # server.py uses 8790 and devnet.py 8797, so all three can run side by side
START_PAGE = "index.html"
DEFAULT_SIZE = (460, 900)  # Fade is a phone-shaped app; at 500 px or less it fills the window edge to edge
MIN_SIZE = (380, 620)
BACKGROUND = "#0b0b0f"
SETTINGS_FILE = "settings.json"
STORAGE_FILE = "storage.json"
CONTROL_FILE = "window.json"
STORAGE_PREFIX = "fade."
MAX_STORAGE_BYTES = 64 * 1024 * 1024
TEST_TIMEOUT = 120
SHELL_INFO_URL = os.environ.get("FADE_DESKTOP_INFO_URL") or "https://juw12.github.io/projects/fade/desktop.json"
DOWNLOAD_PAGE = "https://github.com/juw12/projects/releases/tag/fade"
EXTERNAL_SCHEMES = ("https", "http", "lightning", "bitcoin", "mailto", "tel")
HTML_PAGES = {"/", "/index.html", "/web.html", "/mobile.html"}

# Served at /__desktop/shim.js and loaded first on every page (Fade's own files stay byte-for-byte as shipped).
SHIM_JS = r"""/* Fade desktop shim: keeps the account in the user folder, shows Windows notifications, opens links outside. */
(function () {
  'use strict';
  var cfg = window.__FADE_DESKTOP || {};
  var PREFIX = %(prefix)s;
  var HEADER = 'X-Fade-Desktop';
  var nativeSet = Storage.prototype.setItem;
  var nativeRemove = Storage.prototype.removeItem;
  var nativeClear = Storage.prototype.clear;
  var pendingSet = {};
  var pendingRemove = {};
  var timer = null;
  cfg.flushes = 0;

  function post(path, body, keepalive) {
    var headers = { 'Content-Type': 'application/json' };
    headers[HEADER] = cfg.token;
    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}), keepalive: !!keepalive });
  }

  // 1. Put the saved account back before Fade's scripts run (they read localStorage at start-up).
  try {
    var request = new XMLHttpRequest();
    request.open('GET', '/__desktop/storage', false);
    request.setRequestHeader(HEADER, cfg.token);
    request.send();
    cfg.restored = 0;
    if (request.status === 200) {
      var saved = (JSON.parse(request.responseText || '{}') || {}).items || {};
      Object.keys(saved).forEach(function (key) {
        if (key.indexOf(PREFIX) === 0 && localStorage.getItem(key) === null && typeof saved[key] === 'string') {
          nativeSet.call(localStorage, key, saved[key]);
          cfg.restored += 1;
        }
      });
    }
  } catch (err) {
    cfg.restoreError = String(err);
  }

  // 2. Mirror every change Fade makes to its own keys (only what changed is sent).
  function flush(keepalive) {
    clearTimeout(timer);
    timer = null;
    var set = pendingSet;
    var remove = Object.keys(pendingRemove);
    if (!Object.keys(set).length && !remove.length) return Promise.resolve(true);
    pendingSet = {};
    pendingRemove = {};
    return post('/__desktop/storage', { set: set, remove: remove }, keepalive).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      cfg.flushes += 1;
      return true;
    }).catch(function () {
      Object.keys(set).forEach(function (key) {
        if (!(key in pendingSet) && !(key in pendingRemove)) pendingSet[key] = set[key];
      });
      remove.forEach(function (key) {
        if (!(key in pendingSet)) pendingRemove[key] = true;
      });
      schedule();
      return false;
    });
  }
  function schedule() {
    if (!timer) timer = setTimeout(flush, 700);
  }
  Storage.prototype.setItem = function (key, value) {
    nativeSet.call(this, key, value);
    if (this === window.localStorage && String(key).indexOf(PREFIX) === 0) {
      pendingSet[String(key)] = String(value);
      delete pendingRemove[String(key)];
      schedule();
    }
  };
  Storage.prototype.removeItem = function (key) {
    nativeRemove.call(this, key);
    if (this === window.localStorage && String(key).indexOf(PREFIX) === 0) {
      pendingRemove[String(key)] = true;
      delete pendingSet[String(key)];
      schedule();
    }
  };
  Storage.prototype.clear = function () {
    if (this === window.localStorage) {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(PREFIX) === 0) {
          pendingRemove[key] = true;
          delete pendingSet[key];
        }
      }
      schedule();
    }
    nativeClear.call(this);
  };
  window.addEventListener('pagehide', function () {
    flush(true);
  });
  window.__fadeDesktopFlush = function () {
    return flush(false);
  };

  // 3. Notifications go to Windows (the app also shows its own in-window toast).
  function notify(title, message, tag) {
    post('/__desktop/notify', { title: String(title || 'Fade'), message: String(message || ''), tag: tag || '' });
  }
  function DesktopNotification(title, options) {
    options = options || {};
    notify(title, options.body, options.tag);
    this.title = title;
    this.close = function () {};
  }
  DesktopNotification.permission = 'granted';
  DesktopNotification.requestPermission = function (callback) {
    if (typeof callback === 'function') callback('granted');
    return Promise.resolve('granted');
  };
  window.Notification = DesktopNotification;
  window.addEventListener('load', function () {
    if (window.FadeNet && typeof window.FadeNet.onNotify === 'function') {
      window.FadeNet.onNotify(function (message) {
        notify(message.title || 'Fade', message.message || '', message.sequence_id || '');
      });
      cfg.notifyHooked = true;
    }
  });

  // 4. Payment links, Lightning invoices, mail and other sites open outside the app.
  function openOutside(url) {
    return post('/__desktop/open', { url: url }).then(function (res) {
      return res.json();
    }).then(function (answer) {
      if (!answer.ok && /^(lightning|bitcoin):/i.test(url)) {
        alert('No Lightning wallet app is set up on this PC. Use "Copy invoice" and pay from your wallet instead.');
      }
      return answer.ok;
    }).catch(function () {
      return false;
    });
  }
  function outside(url) {
    if (/^(lightning|bitcoin|mailto|tel):/i.test(url.href)) return true;
    return /^https?:$/.test(url.protocol) && url.origin !== location.origin;
  }
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link || link.hasAttribute('download') || event.defaultPrevented) return;
    var url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch (err) {
      return;
    }
    if (!outside(url)) return;
    event.preventDefault();
    openOutside(url.href);
  }, true);
  var nativeOpen = window.open;
  window.open = function (target) {
    try {
      var url = new URL(String(target || ''), location.href);
      if (outside(url)) {
        openOutside(url.href);
        return null;
      }
    } catch (err) {
      // fall through to the default behaviour
    }
    return nativeOpen.apply(window, arguments);
  };
  cfg.ready = true;
})();
"""

TEST_PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, ready: document.readyState,"
    " shim: !!(window.__FADE_DESKTOP && window.__FADE_DESKTOP.ready),"
    " restored: window.__FADE_DESKTOP ? window.__FADE_DESKTOP.restored : null,"
    " notifyHooked: !!(window.__FADE_DESKTOP && window.__FADE_DESKTOP.notifyHooked),"
    " booted: !!(window.__fade && window.__fade.API && window.__fade.state),"
    " network: !!(window.__fade && window.__fade.API && window.__fade.API.net),"
    " relays: (window.FadeNet && window.FadeNet.status) ? window.FadeNet.status().connected : 0,"
    " ns: (window.FadeNet && window.FadeNet.config) ? window.FadeNet.config.ns : null,"
    " pubkey: (window.FadeNet && window.FadeNet.hasKey && window.FadeNet.hasKey()) ? window.FadeNet.pubkey() : null,"
    " width: window.innerWidth, height: window.innerHeight})"
)


# ------------------------------------------------------------------ helpers
def frozen():
    return bool(getattr(sys, "frozen", False))


def data_root():
    override = os.environ.get("FADE_DESKTOP_HOME")
    if override:
        return os.path.abspath(override)
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), "Fade")
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", "Fade")
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "fade")


LOG_STATE = {"path": None}


def log(message):
    line = "%s [fade-desktop] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
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


def write_json(path, value, indent=2):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temporary = path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=indent)
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


def fade_folder():
    """Fade's app folder (web/ + server/): inside the program when frozen, else this checkout."""
    if frozen():
        return os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)), "fade")
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


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
    """Keep one port so the window's own storage (tied to the address) stays put; storage.json covers a move."""
    if fixed:
        return fixed
    settings = read_json(settings_path, {})
    port = int(settings.get("port") or PREFERRED_PORT)
    if not port_free(port):
        port = PREFERRED_PORT if port != PREFERRED_PORT and port_free(PREFERRED_PORT) else free_port()
        log("port in use; Fade will use %d (your account is restored from storage.json)" % port)
    settings["port"] = port
    write_json(settings_path, settings)
    return port


def network_overrides():
    """Query string that points the app at other Fade Network services (tests, --devnet, own relays)."""
    params = {}
    for name, key in (("RELAYS", "relays"), ("BLOSSOM", "blossom"), ("NTFY", "ntfy"), ("NS", "ns")):
        value = os.environ.get("FADE_DESKTOP_" + name)
        if value:
            params[key] = value
    return urllib.parse.urlencode(params, safe=":/,")


# ------------------------------------------------- the user's saved storage
class SavedStorage:
    """storage.json: a copy of Fade's own localStorage keys (account key, unsent changes, settings)."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.items = {}
        data = read_json(path, {})
        items = data.get("items") if isinstance(data.get("items"), dict) else {}
        self.items = {key: value for key, value in items.items()
                      if isinstance(key, str) and key.startswith(STORAGE_PREFIX) and isinstance(value, str)}

    def snapshot(self):
        with self.lock:
            return dict(self.items)

    def apply(self, set_items, remove_keys):
        with self.lock:
            changed = False
            for key, value in (set_items or {}).items():
                if isinstance(key, str) and key.startswith(STORAGE_PREFIX) and isinstance(value, str):
                    if self.items.get(key) != value:
                        self.items[key] = value
                        changed = True
            for key in remove_keys or []:
                if isinstance(key, str) and self.items.pop(key, None) is not None:
                    changed = True
            if changed:
                write_json(self.path, {"version": 1, "saved": int(time.time()), "items": self.items}, indent=None)
            return changed


# ----------------------------------------------------- the loopback server
class DesktopHandler(BaseHTTPRequestHandler):
    """Serves web/ and the few /__desktop/ endpoints the shim uses. Loopback only, token-protected."""

    server_version = "FadeDesktop/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002 (BaseHTTPRequestHandler's signature)
        return

    # -- guards
    def host_ok(self):
        host = (self.headers.get("Host") or "").lower()
        port = self.server.server_address[1]
        return host in ("127.0.0.1:%d" % port, "localhost:%d" % port)

    def token_ok(self):
        given = self.headers.get("X-Fade-Desktop") or ""
        return hmac.compare_digest(given, self.server.app.token)

    def send_bytes(self, status, body, content_type, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, value):
        self.send_bytes(status, json.dumps(value).encode("utf-8"), "application/json; charset=utf-8")

    def read_body(self, limit=MAX_STORAGE_BYTES):
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > limit:
            raise ValueError("body too large")
        raw = self.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8") or "{}")
        if not isinstance(value, dict):
            raise ValueError("expected an object")
        return value

    # -- verbs
    def do_GET(self):  # noqa: N802 (http.server naming)
        if not self.host_ok():
            return self.send_json(403, {"error": "forbidden"})
        path = urllib.parse.urlparse(self.path).path
        app = self.server.app
        if path == "/__desktop/shim.js":
            body = (SHIM_JS % {"prefix": json.dumps(STORAGE_PREFIX)}).encode("utf-8")
            return self.send_bytes(200, body, "text/javascript; charset=utf-8")
        if path == "/__desktop/storage":
            if not self.token_ok():
                return self.send_json(403, {"error": "forbidden"})
            return self.send_json(200, {"items": app.storage.snapshot()})
        if path == "/__desktop/info":
            return self.send_json(200, {"shell": "desktop", "app": "fade", "version": VERSION})
        return self.serve_file(path)

    do_HEAD = do_GET

    def do_POST(self):  # noqa: N802
        if not self.host_ok() or not self.token_ok():
            return self.send_json(403, {"error": "forbidden"})
        path = urllib.parse.urlparse(self.path).path
        app = self.server.app
        try:
            body = self.read_body()
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        if path == "/__desktop/storage":
            set_items = body.get("set") if isinstance(body.get("set"), dict) else {}
            remove_keys = body.get("remove") if isinstance(body.get("remove"), list) else []
            changed = app.storage.apply(set_items, remove_keys)
            return self.send_json(200, {"ok": True, "changed": changed})
        if path == "/__desktop/notify":
            shown = app.notify(str(body.get("title") or "Fade")[:120], str(body.get("message") or "")[:400],
                               str(body.get("tag") or "")[:80])
            return self.send_json(200, {"ok": True, "shown": shown})
        if path == "/__desktop/open":
            return self.send_json(200, {"ok": app.open_external(str(body.get("url") or ""))})
        return self.send_json(404, {"error": "not found"})

    def serve_file(self, path):
        web = self.server.app.web_dir
        if path in ("", "/"):
            path = "/" + START_PAGE
        relative = posixpath.normpath(urllib.parse.unquote(path)).lstrip("/")
        if relative.startswith("..") or "\\" in relative or "\x00" in relative:
            return self.send_json(404, {"error": "not found"})
        full = os.path.join(web, *relative.split("/"))
        if not os.path.isfile(full):
            return self.send_json(404, {"error": "not found"})
        with open(full, "rb") as handle:
            body = handle.read()
        content_type = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if full.endswith(".webmanifest"):
            content_type = "application/manifest+json"
        elif full.endswith((".js", ".mjs")):
            content_type = "text/javascript"
        if content_type.startswith("text/") or content_type.endswith(("json", "javascript")):
            content_type += "; charset=utf-8"
        if "/" + relative in HTML_PAGES:
            body = self.server.app.inject(body)
        return self.send_bytes(200, body, content_type)


class DesktopServer:
    def __init__(self, root, web_dir, test_mode=False):
        self.root = root
        self.web_dir = web_dir
        self.token = secrets.token_urlsafe(24)
        self.storage = SavedStorage(os.path.join(root, STORAGE_FILE))
        self.test_mode = test_mode
        self.httpd = None
        self.port = None
        self.window = None
        self.notified = []
        self.opened = []
        self._recent = {}
        self._tray = None

    def inject(self, html):
        boot = ('<script>window.__FADE_DESKTOP={token:%s,version:%s,platform:%s};</script>'
                '<script src="/__desktop/shim.js?v=%s"></script>'
                % (json.dumps(self.token), json.dumps(VERSION), json.dumps(sys.platform), VERSION))
        text = html.decode("utf-8")
        marker = text.lower().find("<head>")
        if marker < 0:
            return (boot + text).encode("utf-8")
        marker += len("<head>")
        return (text[:marker] + boot + text[marker:]).encode("utf-8")

    def start(self, port):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), DesktopHandler)
        self.httpd.daemon_threads = True
        self.httpd.app = self
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, name="fade-desktop-server", daemon=True).start()
        log("Fade on http://127.0.0.1:%d/ (data folder %s)" % (self.port, self.root))

    def url(self, page=START_PAGE):
        query = network_overrides()
        return "http://127.0.0.1:%d/%s%s" % (self.port, page, ("?" + query) if query else "")

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        self.remove_tray_icon()

    # -- links
    def open_external(self, url):
        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme not in EXTERNAL_SCHEMES or any(ch in url for ch in "\r\n\x00") or len(url) > 8192:
            log("refused to open %r" % url[:80])
            return False
        if self.test_mode:
            self.opened.append(url)
            return True
        try:
            if scheme in ("http", "https"):
                return bool(webbrowser.open(url))
            if sys.platform == "win32":
                os.startfile(url)  # the registered wallet / mail / phone app
            elif sys.platform == "darwin":
                subprocess.run(["open", url], check=True, timeout=15)
            else:
                subprocess.run(["xdg-open", url], check=True, timeout=15)
            return True
        except (OSError, subprocess.SubprocessError) as error:
            log("no app opened %s: %s" % (scheme, error))
            return False

    # -- notifications
    def window_in_front(self):
        if sys.platform != "win32" or self.window is None:
            return False
        try:
            import ctypes

            user32 = ctypes.windll.user32
            hwnd = int(self.window.native.Handle.ToInt64())
            return user32.GetForegroundWindow() == hwnd and not user32.IsIconic(hwnd)
        except Exception:
            return False

    def notify(self, title, message, tag=""):
        """A Windows notification while Fade is in the background (the app shows its own toast in front)."""
        key = (title, message)
        now = time.time()
        self._recent = {k: t for k, t in self._recent.items() if now - t < 8}
        if key in self._recent:
            return False  # the same push arrives through the app and the network hook
        self._recent[key] = now
        self.notified.append({"title": title, "message": message, "tag": tag})
        if self.test_mode or self.window_in_front():
            return False
        self.flash_taskbar()
        return self.show_balloon(title, message)

    def flash_taskbar(self):
        if sys.platform != "win32" or self.window is None:
            return
        try:
            import ctypes
            from ctypes import wintypes

            class FLASHWINFO(ctypes.Structure):
                _fields_ = [("cbSize", wintypes.UINT), ("hwnd", wintypes.HWND), ("dwFlags", wintypes.DWORD),
                            ("uCount", wintypes.UINT), ("dwTimeout", wintypes.DWORD)]

            hwnd = int(self.window.native.Handle.ToInt64())
            info = FLASHWINFO(ctypes.sizeof(FLASHWINFO), hwnd, 0x3 | 0xC, 0, 0)  # FLASHW_ALL | FLASHW_TIMERNOFG
            ctypes.windll.user32.FlashWindowEx(ctypes.byref(info))
        except Exception as error:
            log("taskbar flash failed: %s" % error)

    def show_balloon(self, title, message):
        if sys.platform == "darwin" and self.window is not None:
            try:
                script = 'display notification %s with title %s' % (json.dumps(message), json.dumps(title))
                subprocess.Popen(["osascript", "-e", script])
                return True
            except OSError:
                return False
        if sys.platform != "win32" or self.window is None:
            return False
        try:
            import clr  # pythonnet, which pywebview's Windows window already uses

            clr.AddReference("System.Windows.Forms")
            clr.AddReference("System.Drawing")
            from System import Action
            from System.Drawing import Icon, SystemIcons
            from System.Windows.Forms import NotifyIcon, ToolTipIcon

            def show():
                if self._tray is None:
                    tray = NotifyIcon()
                    try:
                        tray.Icon = Icon.ExtractAssociatedIcon(sys.executable)
                    except Exception:
                        tray.Icon = SystemIcons.Application
                    tray.Text = "Fade"
                    tray.BalloonTipClicked += lambda sender, args: bring_to_front(self.window)
                    tray.MouseClick += lambda sender, args: bring_to_front(self.window)
                    tray.Visible = True
                    self._tray = tray
                self._tray.ShowBalloonTip(8000, title or "Fade", message or " ", ToolTipIcon.Info)

            self.window.native.Invoke(Action(show))
            return True
        except Exception as error:
            log("notification failed: %s" % error)
            return False

    def remove_tray_icon(self):
        tray, self._tray = self._tray, None
        if tray is None:
            return
        try:
            tray.Visible = False
            tray.Dispose()
        except Exception:
            pass


# ------------------------------------------------------ local test network
def start_devnet():
    """server/devnet.py (relay + Blossom + ntfy in one stdlib process) on a free loopback port, in-process."""
    path = os.path.join(fade_folder(), "server", "devnet.py")
    spec = importlib.util.spec_from_file_location("fade_devnet", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["fade_devnet"] = module
    spec.loader.exec_module(module)
    port = free_port()
    server = module.make_server("127.0.0.1", port, True)
    threading.Thread(target=server.serve_forever, name="fade-devnet", daemon=True).start()
    base = "127.0.0.1:%d" % port
    os.environ["FADE_DESKTOP_RELAYS"] = "ws://%s/" % base
    os.environ["FADE_DESKTOP_BLOSSOM"] = "http://%s" % base
    os.environ["FADE_DESKTOP_NTFY"] = "http://%s/ntfy" % base
    os.environ.setdefault("FADE_DESKTOP_NS", "fade3dev")
    log("local test network on ws://%s/ (not the public Fade Network)" % base)
    return server


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
        threading.Thread(target=self._serve, name="fade-window-control", daemon=True).start()

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
    """Ask an open Fade window to 'show' itself or 'quit'. True if one answered."""
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
    if window is None:
        return
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


def check_shell_update(window, settings_path):
    """Offer the download page once per version when a newer Fade desktop app is published."""
    try:
        request = urllib.request.Request(SHELL_INFO_URL, headers={"User-Agent": "FadeDesktop/" + VERSION})
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
    question = ("Fade for Windows %s is available (you have %s). Your account stays signed in."
                "\n\nOpen the download page?" % (latest, VERSION))
    try:
        if window.create_confirmation_dialog("Update Fade", question):
            webbrowser.open(page_url)
    except Exception as error:
        log("update dialog failed: %s" % error)


def write_report(path, **fields):
    fields.setdefault("pid", os.getpid())
    fields.setdefault("version", VERSION)
    write_json(path, fields)


def evaluate(window, script, default=None):
    try:
        value = window.evaluate_js(script)
    except Exception as error:
        log("evaluate failed: %s" % error)
        return default
    return default if value is None else value


def page_state(window):
    try:
        return json.loads(evaluate(window, TEST_PAGE_SCRIPT, "{}"))
    except ValueError:
        return {}


def live_checks(window, server):
    """Smoke-test checks against whichever Fade Network the window is on (smoke_test.py runs a local one).

    Run 1 creates a real account through Fade's own API (it is published to the relay) and checks the
    account key reached storage.json. Run 2 (FADE_EXPECT_PUBKEY, a fresh window profile) checks the app
    came back signed in to that account and loaded its profile from the network.
    """
    expected = os.environ.get("FADE_EXPECT_PUBKEY")
    result = {}
    if not expected:
        email = "desktop-%s@example.com" % secrets.token_hex(5)
        password = "Fade-" + secrets.token_urlsafe(12)
        name = os.environ.get("FADE_TEST_NAME") or "Desktop Check"
        script = (
            "(async () => { try { await window.__fade.API.req('POST', '/api/auth/register', %s);"
            " window.__desktopTest = {ok: true, pubkey: window.FadeNet.pubkey()}; }"
            " catch (err) { window.__desktopTest = {ok: false, error: String(err && err.message || err)}; } })(); true"
            % json.dumps({"name": name, "email": email, "password": password, "role": "customer"})
        )
        evaluate(window, script)
        outcome = {}
        deadline = time.time() + 45
        while time.time() < deadline:
            outcome = json.loads(evaluate(window, "JSON.stringify(window.__desktopTest || null)", "null") or "null") or {}
            if outcome:
                break
            time.sleep(0.5)
        result["registered"] = bool(outcome.get("ok"))
        result["register_error"] = outcome.get("error")
        result["pubkey"] = outcome.get("pubkey")
        result["name"] = name
        evaluate(window, "window.__fadeDesktopFlush && window.__fadeDesktopFlush(); true")
        deadline = time.time() + 10
        saved = False
        while time.time() < deadline and result["pubkey"]:
            saved = any(key.startswith("fade.netkey.") for key in server.storage.snapshot())
            if saved:
                break
            time.sleep(0.25)
        result["key_saved"] = saved
    else:
        result["pubkey"] = page_state(window).get("pubkey")
        result["restored_account"] = result["pubkey"] == expected
        profile = {}
        deadline = time.time() + 30
        while time.time() < deadline:
            evaluate(window, "(async () => { try { const s = await window.__fade.API.req('GET', '/api/state');"
                             " window.__desktopProfile = {name: s && s.user ? s.user.name : null}; }"
                             " catch (err) { window.__desktopProfile = {error: String(err && err.message || err)}; } })(); true")
            time.sleep(1.0)
            profile = json.loads(evaluate(window, "JSON.stringify(window.__desktopProfile || null)", "null") or "null") or {}
            if profile.get("name"):
                break
        result["profile_name"] = profile.get("name")
        result["profile_error"] = profile.get("error")
    # Windows notifications and outside links go through the shim's endpoints.
    evaluate(window, "new Notification('Fade', {body: 'Desktop notification check'}); true")
    evaluate(window, "(() => { const a = document.createElement('a'); a.href = 'https://www.paypal.me/fade/5';"
                     " document.body.appendChild(a); a.click(); a.remove();"
                     " const b = document.createElement('a'); b.href = 'javascript:void(0)'; document.body.appendChild(b);"
                     " b.click(); b.remove(); })(); true")
    time.sleep(1.5)
    result["notified"] = any(item["message"] == "Desktop notification check" for item in server.notified)
    result["opened_outside"] = list(server.opened)
    result["refused_unsafe"] = server.open_external("javascript:alert(1)") is False
    return result


# ------------------------------------------------------------ the window
def run_window(root, report_path, use_devnet=False):
    settings_path = os.path.join(root, SETTINGS_FILE)
    settings = read_json(settings_path, {})
    devnet = start_devnet() if use_devnet else None
    web_dir = os.path.join(fade_folder(), "web")
    server = DesktopServer(root, web_dir, test_mode=bool(report_path))
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
        # No native window here (no WebView2): Fade still works in the default browser.
        if report_path:
            write_report(report_path, method="none", error="no native window on this system")
            server.stop()
            return 1
        webbrowser.open(start_url)
        log("no native window; Fade is open in the browser at %s - close this program to stop it" % start_url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        server.stop()
        return 0

    webview.settings["ALLOW_DOWNLOADS"] = True  # Account & privacy -> Export my data saves a JSON file
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    width, height = fit_size(saved_size(settings), screen_work_area())
    window = webview.create_window(
        TITLE,
        start_url,
        width=width,
        height=height,
        min_size=MIN_SIZE,
        background_color=BACKGROUND,
        text_select=True,
        zoomable=True,
        focus=not report_path,
    )
    server.window = window
    control = None if report_path else WindowControl(root, on_show=lambda: bring_to_front(window),
                                                     on_quit=window.destroy)
    state = {"tested": False}

    def on_closing():
        # No evaluate_js here: this runs on the window's thread while it closes. The shim has already saved
        # every change (0.7 s after it happens, and again with a keepalive request when the page goes away).
        try:
            current = read_json(settings_path, {})
            if window.width >= MIN_SIZE[0] and window.height >= MIN_SIZE[1] and not report_path:
                current.update(width=int(window.width), height=int(window.height))
                write_json(settings_path, current)
        except Exception:
            pass

    def self_test():
        deadline = time.time() + TEST_TIMEOUT
        info = {}
        settled = 0
        while time.time() < deadline:
            info = page_state(window)
            ready = info.get("ready") == "complete" and info.get("booted") and info.get("network") and info.get("relays")
            settled = settled + 1 if ready else 0
            if settled >= 3:
                break
            time.sleep(0.5)
        checks = live_checks(window, server) if settled >= 3 else {"error": "the app did not connect to the network"}
        renderer = gui
        if sys.platform == "win32":
            renderer = getattr(sys.modules.get("webview.platforms.winforms"), "renderer", gui)
        write_report(report_path, method="window", toolkit=renderer, runtime=runtime, server_url=start_url,
                     data_folder=root, storage_file=server.storage.path, frozen=frozen(), page=info,
                     final_page=page_state(window), checks=checks)
        window.destroy()

    def on_loaded():
        if report_path and not state["tested"]:
            state["tested"] = True
            threading.Thread(target=self_test, name="fade-window-test", daemon=True).start()

    def after_start():
        if not report_path:
            threading.Timer(20, check_shell_update, args=(window, settings_path)).start()

    window.events.closing += on_closing
    window.events.loaded += on_loaded
    storage = None
    if sys.platform == "win32":
        # Checks use a throwaway browser profile next to their report, so only storage.json carries the account.
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
        if devnet is not None:
            devnet.shutdown()
    return 0


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if "--version" in args:
        print("Fade desktop %s" % VERSION)
        return 0
    report_path = os.environ.get("FADE_WINDOW_TEST") or None
    if report_path:
        report_path = os.path.abspath(report_path)
        os.environ.setdefault("FADE_DESKTOP_HOME", os.path.join(os.path.dirname(report_path), "fade-home"))
    root = data_root()
    os.makedirs(root, exist_ok=True)
    LOG_STATE["path"] = os.path.join(root, "desktop.log")
    if "--stop" in args:
        send_to_window(root, "quit")
        return 0
    if not report_path and send_to_window(root, "show"):
        return 0  # already open: brought to the front
    return run_window(root, report_path, use_devnet="--devnet" in args)


if __name__ == "__main__":
    sys.exit(main())
