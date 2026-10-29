r"""ME R&D Toolkit for Windows (and macOS): the toolkit in its own window, with your data kept on this PC.

The program carries the toolkit's web app (web/) and its optional file vault (server/vault_server.py), serves
them to a native window from a private loopback address and adds what a desktop app needs around them. The
toolkit's own files are not changed.

  * Tracked projects, checklist results, stars and recent items (the browser's meRd.* storage) are mirrored to
    storage.json in the data folder and put back if the window storage is ever empty, so restarts,
    reinstalls and cleared data lose nothing.
  * The private data pack lives in the data folder: drop pack.js / calcs.js / aliases.js into private\
    (as in the repo layout), or use Data & Backup -> Import data pack - the imported pack is also saved to
    private\pack.json and comes back on every launch.
  * File and folder paths from the data pack get an Open button that opens them in their own program
    (SolidWorks, Excel, PDF reader, Explorer...). Programs and scripts are never launched.
  * File Vault: put a vault_config.json in private\ (see server/vault_config.example.json) and the vault runs
    inside the app - browse and open shared files in the window, while teammates reach the same vault at
    http://<this-pc>:<port>/ with the shared password, exactly as with vault_server.py.

    Windows  %LOCALAPPDATA%\ME-RD-Toolkit\       window: Microsoft Edge WebView2 (via pywebview)
    macOS    ~/Library/Application Support/ME-RD-Toolkit/   window: WKWebView

    ME-RD-Toolkit --version | --stop | --data-folder (open the data folder)
    MERD_WINDOW_TEST=<report.json>   open, run the checks, write a report and close (smoke_test.py)
    MERD_DESKTOP_HOME=<folder>       use another data folder (the checks use a throwaway one)
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
TITLE = "ME R&D Toolkit"
DATA_FOLDER = "ME-RD-Toolkit"
PREFERRED_PORT = 8781  # the vault's default is 8780
START_PAGE = "index.html"
DEFAULT_SIZE = (1360, 880)
MIN_SIZE = (420, 560)
BACKGROUND = "#f5f6fa"
SETTINGS_FILE = "settings.json"
STORAGE_FILE = "storage.json"
CONTROL_FILE = "window.json"
PRIVATE_FOLDER = "private"
PRIVATE_SCRIPTS = ("pack.js", "calcs.js", "aliases.js")
VAULT_CONFIG = "vault_config.json"
STORAGE_PREFIXES = ("meRd",)  # meRd.v2 (current) and meRdToolkit.v1 (legacy)
MAX_BODY_BYTES = 64 * 1024 * 1024
TEST_TIMEOUT = 90
SHELL_INFO_URL = os.environ.get("MERD_DESKTOP_INFO_URL") or "https://juw12.github.io/projects/me-rd-toolkit/desktop.json"
DOWNLOAD_PAGE = "https://github.com/juw12/projects/releases/tag/me-rd-toolkit"
# Opened with their own program; anything that runs code is refused, whatever the data pack says.
BLOCKED_SUFFIXES = {
    ".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".msi", ".msp",
    ".scr", ".pif", ".lnk", ".url", ".hta", ".cpl", ".jar", ".reg", ".dll", ".sys", ".inf", ".appref-ms", ".application",
}
VAULT_ROUTES = ("/api/status", "/api/vault/", "/file")

SHIM_JS = r"""/* ME R&D Toolkit desktop shim: keeps projects and the data pack on this PC and opens files in their programs. */
(function () {
  'use strict';
  var cfg = window.__MERD_DESKTOP || {};
  var PREFIXES = %(prefixes)s;
  var HEADER = 'X-MERD-Desktop';
  var nativeSet = Storage.prototype.setItem;
  var nativeRemove = Storage.prototype.removeItem;
  var nativeClear = Storage.prototype.clear;
  var pendingSet = {};
  var pendingRemove = {};
  var timer = null;
  cfg.flushes = 0;
  cfg.errors = [];
  window.addEventListener('error', function (event) {
    if (cfg.errors.length < 10) cfg.errors.push(String(event.message || event.error || 'error'));
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (cfg.errors.length < 10) cfg.errors.push('unhandled: ' + String(event.reason && event.reason.message || event.reason));
  });

  function ours(key) {
    key = String(key);
    return PREFIXES.some(function (prefix) { return key.indexOf(prefix) === 0; });
  }
  function post(path, body, keepalive) {
    var headers = { 'Content-Type': 'application/json' };
    headers[HEADER] = cfg.token;
    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}), keepalive: !!keepalive });
  }
  cfg.post = function (path, body) {
    return post(path, body).then(function (res) { return res.json(); });
  };
  function toast(text) {
    var box = document.getElementById('toast');
    if (!box) return;
    box.textContent = text;
    box.classList.remove('hidden');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { box.classList.add('hidden'); }, 2600);
  }

  // 1. Put saved projects back before the toolkit reads its storage.
  try {
    var request = new XMLHttpRequest();
    request.open('GET', '/__desktop/storage', false);
    request.setRequestHeader(HEADER, cfg.token);
    request.send();
    cfg.restored = 0;
    if (request.status === 200) {
      var saved = (JSON.parse(request.responseText || '{}') || {}).items || {};
      Object.keys(saved).forEach(function (key) {
        if (ours(key) && localStorage.getItem(key) === null && typeof saved[key] === 'string') {
          nativeSet.call(localStorage, key, saved[key]);
          cfg.restored += 1;
        }
      });
    }
  } catch (err) {
    cfg.restoreError = String(err);
  }

  // 2. Mirror every change the toolkit makes to its own keys.
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
    if (!timer) timer = setTimeout(flush, 600);
  }
  Storage.prototype.setItem = function (key, value) {
    nativeSet.call(this, key, value);
    if (this === window.localStorage && ours(key)) {
      pendingSet[String(key)] = String(value);
      delete pendingRemove[String(key)];
      schedule();
    }
  };
  Storage.prototype.removeItem = function (key) {
    nativeRemove.call(this, key);
    if (this === window.localStorage && ours(key)) {
      pendingRemove[String(key)] = true;
      delete pendingSet[String(key)];
      schedule();
    }
  };
  Storage.prototype.clear = function () {
    if (this === window.localStorage) {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && ours(key)) {
          pendingRemove[key] = true;
          delete pendingSet[key];
        }
      }
      schedule();
    }
    nativeClear.call(this);
  };
  window.addEventListener('pagehide', function () { flush(true); });
  cfg.flush = function () { return flush(false); };

  // 3. An imported data pack (IndexedDB "me-rd-toolkit" / kv / "pack") is also saved to private\pack.json.
  function isPackStore(store) {
    try {
      return store.name === 'kv' && store.transaction.db.name === 'me-rd-toolkit';
    } catch (err) {
      return false;
    }
  }
  var nativePut = IDBObjectStore.prototype.put;
  var nativeDelete = IDBObjectStore.prototype['delete'];
  IDBObjectStore.prototype.put = function (value, key) {
    var result = nativePut.apply(this, arguments);
    if (key === 'pack' && isPackStore(this)) {
      cfg.packSave = post('/__desktop/pack', { pack: value }).then(function (res) { return res.ok; });
    }
    return result;
  };
  IDBObjectStore.prototype['delete'] = function (key) {
    var result = nativeDelete.apply(this, arguments);
    if (key === 'pack' && isPackStore(this)) {
      cfg.packSave = post('/__desktop/pack', { pack: null }).then(function (res) { return res.ok; });
    }
    return result;
  };

  // 4. Open files and folders in their own program; other sites in the browser.
  function open(body, label) {
    return cfg.post('/__desktop/open', body).then(function (answer) {
      if (!answer.ok) toast(answer.reason || ('Can\u2019t open ' + (label || 'that')));
      return answer.ok;
    }).catch(function () {
      toast('Can\u2019t open ' + (label || 'that'));
      return false;
    });
  }
  var PATHLIKE = /^([a-zA-Z]:[\\\/]|\\\\[^\\]|\[[^\]]+\])/;
  function addOpenButtons(root) {
    var buttons = (root || document).querySelectorAll('button.copy[data-copy]');
    for (var i = 0; i < buttons.length; i++) {
      var copy = buttons[i];
      var path = copy.getAttribute('data-copy') || '';
      var next = copy.nextElementSibling;
      if (!PATHLIKE.test(path) || (next && next.hasAttribute('data-open'))) continue;
      var button = document.createElement('button');
      button.className = 'copy';
      button.type = 'button';
      button.setAttribute('data-open', path);
      button.title = 'Open in its program';
      button.textContent = '\u2197';
      copy.parentNode.insertBefore(button, copy.nextSibling);
    }
  }
  document.addEventListener('click', function (event) {
    var target = event.target;
    var opener = target && target.closest ? target.closest('[data-open]') : null;
    if (opener) {
      event.preventDefault();
      event.stopPropagation();
      open({ path: opener.getAttribute('data-open') }, 'this file');
      return;
    }
    var name = target && target.closest ? target.closest('.doc-link .nm') : null;
    if (name && !name.closest('a')) {
      var copy = name.closest('.doc-link').querySelector('button.copy[data-copy]');
      if (copy) {
        event.preventDefault();
        open({ path: copy.getAttribute('data-copy') }, 'this file');
      }
      return;
    }
    var link = target && target.closest ? target.closest('a[href]') : null;
    if (!link || event.defaultPrevented) return;
    var url;
    try {
      url = new URL(link.getAttribute('href'), location.href);
    } catch (err) {
      return;
    }
    if (url.origin === location.origin && url.pathname === '/file' && url.searchParams.get('dl') !== '1') {
      event.preventDefault();
      open({ href: url.pathname + url.search }, 'this file');
    } else if (/^https?:$/.test(url.protocol) && url.origin !== location.origin) {
      event.preventDefault();
      open({ url: url.href }, 'that link');
    }
  }, true);
  new MutationObserver(function () { addOpenButtons(); }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { addOpenButtons(); });
  cfg.ready = true;
})();
"""

TEST_PAGE_SCRIPT = (
    "JSON.stringify({title: document.title, url: location.href, ready: document.readyState,"
    " shim: !!(window.__MERD_DESKTOP && window.__MERD_DESKTOP.ready),"
    " restored: window.__MERD_DESKTOP ? window.__MERD_DESKTOP.restored : null,"
    " booted: !!(window.APP && window.APP.P && document.querySelector('#nav a')),"
    " serverMode: !!(window.APP && window.APP.serverMode),"
    " packSource: window.APP ? window.APP.packSource : null,"
    " packName: (window.APP && window.APP.P && window.APP.P.meta) ? window.APP.P.meta.name : null,"
    " errors: window.__MERD_DESKTOP ? window.__MERD_DESKTOP.errors : [],"
    " width: window.innerWidth, height: window.innerHeight})"
)


# ------------------------------------------------------------------ helpers
def frozen():
    return bool(getattr(sys, "frozen", False))


def data_root():
    override = os.environ.get("MERD_DESKTOP_HOME")
    if override:
        return os.path.abspath(override)
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.join(home, "AppData", "Local"), DATA_FOLDER)
    if sys.platform == "darwin":
        return os.path.join(home, "Library", "Application Support", DATA_FOLDER)
    return os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share"), "me-rd-toolkit")


LOG_STATE = {"path": None}


def log(message):
    line = "%s [me-rd-desktop] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message)
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


def toolkit_folder():
    """The toolkit's app folder (web/ + server/): inside the program when frozen, else this checkout."""
    if frozen():
        return os.path.join(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)), "me-rd-toolkit")
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
        log("port in use; the toolkit will use %d (your projects are restored from storage.json)" % port)
    settings["port"] = port
    write_json(settings_path, settings)
    return port


class SavedStorage:
    """storage.json: a copy of the toolkit's own localStorage keys (tracked projects, stars, recent, theme)."""

    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.items = {}
        data = read_json(path, {})
        items = data.get("items") if isinstance(data.get("items"), dict) else {}
        self.items = {key: value for key, value in items.items()
                      if isinstance(key, str) and key.startswith(STORAGE_PREFIXES) and isinstance(value, str)}

    def snapshot(self):
        with self.lock:
            return dict(self.items)

    def apply(self, set_items, remove_keys):
        with self.lock:
            changed = False
            for key, value in (set_items or {}).items():
                if isinstance(key, str) and key.startswith(STORAGE_PREFIXES) and isinstance(value, str):
                    if self.items.get(key) != value:
                        self.items[key] = value
                        changed = True
            for key in remove_keys or []:
                if isinstance(key, str) and self.items.pop(key, None) is not None:
                    changed = True
            if changed:
                write_json(self.path, {"version": 1, "saved": int(time.time()), "items": self.items}, indent=None)
            return changed




# ----------------------------------------------------------- the file vault
class VaultHost:
    r"""server/vault_server.py, imported in-process when private\vault_config.json exists.

    Its functions answer the window's /api/vault/* and /file requests on the loopback address (no password:
    only this PC's window can reach it), and its own Handler serves teammates on the configured host/port with
    the shared password, read-only, with the access log - the same as running vault_server.py.
    """

    def __init__(self, private_dir):
        self.private_dir = private_dir
        self.config_path = os.path.join(private_dir, VAULT_CONFIG)
        self.module = None
        self.lan = None
        self.lan_url = None
        self.error = None

    @property
    def enabled(self):
        return self.module is not None

    def start(self, share=True):
        if not os.path.isfile(self.config_path):
            return False
        path = os.path.join(toolkit_folder(), "server", "vault_server.py")
        saved_argv = sys.argv
        os.environ["ME_PRIVATE_DIR"] = self.private_dir
        sys.argv = [path, self.config_path]  # vault_server.py reads its config path from argv at import
        try:
            spec = importlib.util.spec_from_file_location("merd_vault", path)
            module = importlib.util.module_from_spec(spec)
            sys.modules["merd_vault"] = module
            spec.loader.exec_module(module)
        except (Exception, SystemExit) as error:
            self.error = "vault config could not be loaded: %s" % error
            log(self.error)
            return False
        finally:
            sys.argv = saved_argv
        self.module = module
        threading.Thread(target=module.build_index, name="merd-vault-index", daemon=True).start()
        if share:
            config = module.CONFIG
            try:
                self.lan = module.ExclusiveHTTPServer((config["host"], int(config["port"])), module.Handler)
                threading.Thread(target=self.lan.serve_forever, name="merd-vault-lan", daemon=True).start()
                host = config["host"] if config["host"] not in ("0.0.0.0", "") else socket.gethostname()
                self.lan_url = "http://%s:%d/" % (host, int(config["port"]))
                log("file vault shared at %s (user %s)" % (self.lan_url, config["user"]))
            except OSError as error:
                self.error = "port %s is in use - the vault works in this window but teammates can't reach it" % config["port"]
                log(self.error)
        return True

    def stop(self):
        if self.lan:
            self.lan.shutdown()
            self.lan.server_close()
            self.lan = None

    def answer(self, handler, route, query):
        """The vault's read-only API for the window (same routes and JSON as vault_server.py)."""
        vault = self.module
        if route == "/api/status":
            config = vault.CONFIG
            return handler.send_json(200, {
                "server": True, "title": config["title"], "files": len(vault.INDEX["files"]), "built": vault.INDEX["built"],
                "building": vault.INDEX["building"], "hideTerms": config.get("hideTerms", []), "desktop": True,
                "shared": self.lan_url,
            })
        if route == "/api/vault/categories":
            return handler.send_json(200, {"categories": vault.category_summary(), "built": vault.INDEX["built"],
                                           "building": vault.INDEX["building"]})
        if route == "/api/vault/list":
            return handler.send_json(200, vault.list_folder(query.get("cat", ""), query.get("dir", "")))
        if route == "/api/vault/search":
            return handler.send_json(200, {"files": vault.search(query.get("q", ""), query.get("cat", ""))})
        if route == "/api/vault/locate":
            found = vault.locate(query.get("abs", ""))
            return handler.send_json(200 if found else 404, found or {"cat": "", "dir": ""})
        if route == "/api/vault/recent":
            return handler.send_json(200, {"files": sorted(vault.INDEX["files"], key=lambda f: -f["m"])[:60]})
        if route == "/api/vault/reindex":
            threading.Thread(target=vault.build_index, daemon=True).start()
            return handler.send_json(200, {"ok": True})
        if route == "/file":
            full = self.resolve_href(query)
            if not full:
                return handler.send_json(404, {"error": "not found or not shared"})
            return vault.Handler.send_file(handler, full, download=query.get("dl") == "1")
        return handler.send_json(404, {"error": "not found"})

    def resolve_href(self, query):
        vault = self.module
        if "abs" in query:
            return vault.resolve_absolute(query["abs"])
        return vault.resolve(query.get("r", ""), query.get("p", ""))

    def unalias(self, path):
        return self.module.unalias(path) if self.module else path


# ----------------------------------------------------- the loopback server
class DesktopHandler(BaseHTTPRequestHandler):
    server_version = "MERDToolkitDesktop/" + VERSION
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):  # noqa: A002 (BaseHTTPRequestHandler's signature)
        return

    def host_ok(self):
        host = (self.headers.get("Host") or "").lower()
        port = self.server.server_address[1]
        return host in ("127.0.0.1:%d" % port, "localhost:%d" % port)

    def token_ok(self):
        return hmac.compare_digest(self.headers.get("X-MERD-Desktop") or "", self.server.app.token)

    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, value):
        self.send_bytes(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("body too large")
        value = json.loads((self.rfile.read(length) if length else b"{}").decode("utf-8") or "{}")
        if not isinstance(value, dict):
            raise ValueError("expected an object")
        return value

    def do_GET(self):  # noqa: N802 (http.server naming)
        if not self.host_ok():
            return self.send_json(403, {"error": "forbidden"})
        app = self.server.app
        url = urllib.parse.urlparse(self.path)
        route = url.path.rstrip("/") or "/"
        query = {key: values[0] for key, values in urllib.parse.parse_qs(url.query).items()}
        if route == "/__desktop/shim.js":
            body = (SHIM_JS % {"prefixes": json.dumps(list(STORAGE_PREFIXES))}).encode("utf-8")
            return self.send_bytes(200, body, "text/javascript; charset=utf-8")
        if route == "/__desktop/storage":
            if not self.token_ok():
                return self.send_json(403, {"error": "forbidden"})
            return self.send_json(200, {"items": app.storage.snapshot()})
        if route == "/__desktop/info":
            return self.send_json(200, {"shell": "desktop", "app": "me-rd-toolkit", "version": VERSION})
        if route.startswith("/private/"):
            return self.serve_private(route[len("/private/"):])
        if route == "/api/status" or route.startswith("/api/vault/") or route == "/file":
            if not app.vault.enabled:
                return self.send_json(404, {"error": "no vault configured"})
            return app.vault.answer(self, route, query)
        return self.serve_web(url.path)

    do_HEAD = do_GET

    def do_POST(self):  # noqa: N802
        if not self.host_ok() or not self.token_ok():
            return self.send_json(403, {"error": "forbidden"})
        app = self.server.app
        route = urllib.parse.urlparse(self.path).path
        try:
            body = self.read_body()
        except ValueError as error:
            return self.send_json(400, {"error": str(error)})
        if route == "/__desktop/storage":
            set_items = body.get("set") if isinstance(body.get("set"), dict) else {}
            remove_keys = body.get("remove") if isinstance(body.get("remove"), list) else []
            return self.send_json(200, {"ok": True, "changed": app.storage.apply(set_items, remove_keys)})
        if route == "/__desktop/pack":
            return self.send_json(200, {"ok": app.save_pack(body.get("pack"))})
        if route == "/__desktop/open":
            ok, reason = app.open_item(body)
            return self.send_json(200, {"ok": ok, "reason": reason})
        return self.send_json(404, {"error": "not found"})

    def serve_private(self, name):
        """private/pack.js, calcs.js and aliases.js from the data folder (index.html loads them if present)."""
        app = self.server.app
        if name not in PRIVATE_SCRIPTS:
            return self.send_json(404, {"error": "not found"})
        path = os.path.join(app.private_dir, name)
        if os.path.isfile(path):
            with open(path, "rb") as handle:
                return self.send_bytes(200, handle.read(), "text/javascript; charset=utf-8")
        saved = os.path.join(app.private_dir, "pack.json")
        if name == "pack.js" and os.path.isfile(saved):
            with open(saved, "rb") as handle:
                pack = handle.read().decode("utf-8")
            return self.send_bytes(200, ("window.ME_PACK = %s;\n" % pack).encode("utf-8"), "text/javascript; charset=utf-8")
        return self.send_json(404, {"error": "not found"})

    def serve_web(self, path):
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
        elif full.endswith(".js"):
            content_type = "text/javascript"
        if content_type.startswith("text/") or content_type.endswith(("json", "javascript")):
            content_type += "; charset=utf-8"
        if relative == START_PAGE:
            body = self.server.app.inject(body)
        return self.send_bytes(200, body, content_type)


class DesktopServer:
    def __init__(self, root, web_dir, test_mode=False):
        self.root = root
        self.web_dir = web_dir
        self.private_dir = os.path.join(root, PRIVATE_FOLDER)
        os.makedirs(self.private_dir, exist_ok=True)
        self.token = secrets.token_urlsafe(24)
        self.storage = SavedStorage(os.path.join(root, STORAGE_FILE))
        self.vault = VaultHost(self.private_dir)
        self.test_mode = test_mode
        self.opened = []
        self.httpd = None
        self.port = None

    def inject(self, html):
        boot = ('<script>window.__MERD_DESKTOP={token:%s,version:%s,platform:%s};</script>'
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
        threading.Thread(target=self.httpd.serve_forever, name="merd-desktop-server", daemon=True).start()
        log("ME R&D Toolkit on http://127.0.0.1:%d/ (data folder %s)" % (self.port, self.root))

    def url(self, page=START_PAGE):
        return "http://127.0.0.1:%d/%s" % (self.port, page)

    def stop(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        self.vault.stop()

    def save_pack(self, pack):
        target = os.path.join(self.private_dir, "pack.json")
        if pack is None:
            if os.path.isfile(target):
                os.remove(target)
            return True
        if not isinstance(pack, dict) or not isinstance(pack.get("checklists"), list):
            return False
        write_json(target, pack, indent=None)
        log("data pack saved to %s" % target)
        return True

    def open_item(self, body):
        """Open a vault file, a data-pack path or a web link. Returns (ok, reason shown to the user)."""
        if body.get("url"):
            url = str(body["url"])
            if urllib.parse.urlparse(url).scheme not in ("http", "https"):
                return False, "Only web links open in the browser"
            if self.test_mode:
                self.opened.append(url)
                return True, ""
            return bool(webbrowser.open(url)), ""
        if body.get("href"):
            if not self.vault.enabled:
                return False, "No file vault is set up"
            href = urllib.parse.urlparse(str(body["href"]))
            query = {key: values[0] for key, values in urllib.parse.parse_qs(href.query).items()}
            path = self.vault.resolve_href(query)
            if not path:
                return False, "That file isn\u2019t shared in the vault"
            return self.launch(path)
        raw = str(body.get("path") or "").strip()
        if not raw:
            return False, "No path"
        return self.launch(self.vault.unalias(raw))

    def launch(self, path):
        path = os.path.normpath(path)
        if not os.path.exists(path):
            return False, "Not found on this PC: %s" % path
        if os.path.isfile(path) and os.path.splitext(path)[1].lower() in BLOCKED_SUFFIXES:
            log("refused to launch %s" % path)
            return False, "Programs and scripts aren\u2019t opened from the toolkit"
        if self.test_mode:
            self.opened.append(path)
            return True, ""
        try:
            if sys.platform == "win32":
                os.startfile(path)  # the file's own program, or Explorer for a folder
            elif sys.platform == "darwin":
                subprocess.run(["open", path], check=True, timeout=15)
            else:
                subprocess.run(["xdg-open", path], check=True, timeout=15)
            return True, ""
        except (OSError, subprocess.SubprocessError) as error:
            return False, "No program opens this file (%s)" % error


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
        threading.Thread(target=self._serve, name="merd-window-control", daemon=True).start()

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
    """Ask an open toolkit window to 'show' itself or 'quit'. True if one answered."""
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
    """Offer the download page once per version when a newer desktop app is published."""
    try:
        request = urllib.request.Request(SHELL_INFO_URL, headers={"User-Agent": "MERDToolkitDesktop/" + VERSION})
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
    question = ("ME R&D Toolkit for Windows %s is available (you have %s). Your projects and data pack stay as they are."
                "\n\nOpen the download page?" % (latest, VERSION))
    try:
        if window.create_confirmation_dialog("Update ME R&D Toolkit", question):
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


def page_json(window, script):
    """Run an async page script that stores its result in window.__desktopTest, then read it back."""
    evaluate(window, "window.__desktopTest = null; (async () => { try { window.__desktopTest = await (async () => { %s })(); }"
                     " catch (err) { window.__desktopTest = {error: String(err && err.message || err)}; } })(); true" % script)
    deadline = time.time() + 20
    while time.time() < deadline:
        value = evaluate(window, "JSON.stringify(window.__desktopTest)", "null")
        if value and value != "null":
            return json.loads(value)
        time.sleep(0.25)
    return {"error": "timed out"}


def desktop_checks(window, server):
    """Smoke-test checks (smoke_test.py sets up a vault folder and reads the report).

    Run 1 saves a marker through localStorage, imports a data pack the way Data & Backup does (IndexedDB),
    uses the in-app vault (search, a hidden folder, opening a shared file) and opens data-pack paths.
    Run 2 (MERD_EXPECT_MARK, fresh window profile) checks the projects and the data pack came back.
    """
    expected = os.environ.get("MERD_EXPECT_MARK")
    pack_name = os.environ.get("MERD_TEST_PACK") or "Desktop check pack"
    result = {}
    if not expected:
        mark = "desktop-check-" + secrets.token_hex(5)
        result["mark"] = mark
        evaluate(window, "(() => { const s = Object.assign({projects: {}, activeId: null, stars: {}, recent: [], theme: null},"
                         " JSON.parse(localStorage.getItem('meRd.v2') || '{}')); s.desktopCheck = %s;"
                         " localStorage.setItem('meRd.v2', JSON.stringify(s)); })(); true" % json.dumps(mark))
        result["pack_import"] = page_json(window, (
            "const pack = Object.assign({}, window.ME_DEMO_PACK, {meta: {name: %s}}); const db = await new Promise((ok, no) => { const r = indexedDB.open('me-rd-toolkit', 1);"
            " r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });"
            " await new Promise((ok, no) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(pack, 'pack');"
            " tx.oncomplete = ok; tx.onerror = () => no(tx.error); });"
            " return {saved: await window.__MERD_DESKTOP.packSave};" % json.dumps(pack_name)))
        evaluate(window, "window.__MERD_DESKTOP.flush(); true")
        deadline = time.time() + 10
        while time.time() < deadline and '"desktopCheck"' not in json.dumps(server.storage.snapshot()):
            time.sleep(0.25)
        result["state_saved"] = mark in server.storage.snapshot().get("meRd.v2", "")
        saved_pack = read_json(os.path.join(server.private_dir, "pack.json"), {})
        result["pack_saved"] = (saved_pack.get("meta") or {}).get("name") == pack_name
        if server.vault.enabled:
            result["vault_search"] = page_json(window, "const r = await fetch('api/vault/search?q=rib'); const d = await r.json(); return d.files.map(f => f.n);")
            result["vault_hidden"] = page_json(window, "const r = await fetch('api/vault/search?q=secret'); const d = await r.json(); return d.files.length;")
            result["vault_blocked_file"] = page_json(window, "const r = await fetch('file?r=share&p=Personal/secret.txt'); return r.status;")
            result["vault_open"] = page_json(window, "return await window.__MERD_DESKTOP.post('/__desktop/open', {href: 'file?r=share&p=Guides/Plastics/rib%20design.txt'});")
        local_file = os.environ.get("MERD_TEST_FILE")
        if local_file:
            result["open_button"] = page_json(window, (
                "const box = document.createElement('div'); box.innerHTML = window.APP.docLink('Spec sheet.pdf', %s, '');"
                " document.querySelector('#view').appendChild(box); await new Promise(r => setTimeout(r, 400));"
                " const button = box.querySelector('[data-open]'); if (!button) return {button: false};"
                " button.click(); await new Promise(r => setTimeout(r, 600)); box.remove(); return {button: true};" % json.dumps(local_file)))
            result["refused_program"] = page_json(window, "return await window.__MERD_DESKTOP.post('/__desktop/open', {path: %s});"
                                                  % json.dumps(os.environ.get("MERD_TEST_PROGRAM") or sys.executable))
            result["missing_path"] = page_json(window, "return await window.__MERD_DESKTOP.post('/__desktop/open', {path: 'Z:\\\\no\\\\such\\\\file.step'});")
    else:
        result["mark_restored"] = page_json(window, "return JSON.parse(localStorage.getItem('meRd.v2') || '{}').desktopCheck || null;") == expected
    result["opened"] = list(server.opened)
    return result


# ------------------------------------------------------------ the window
def run_window(root, report_path):
    settings_path = os.path.join(root, SETTINGS_FILE)
    settings = read_json(settings_path, {})
    server = DesktopServer(root, os.path.join(toolkit_folder(), "web"), test_mode=bool(report_path))
    server.vault.start(share=True)
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
        # No native window here (no WebView2): the toolkit still works in the default browser.
        if report_path:
            write_report(report_path, method="none", error="no native window on this system")
            server.stop()
            return 1
        webbrowser.open(start_url)
        log("no native window; the toolkit is open in the browser at %s - close this program to stop it" % start_url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        server.stop()
        return 0

    webview.settings["ALLOW_DOWNLOADS"] = True  # CSV exports, backups and vault downloads
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
    control = None if report_path else WindowControl(root, on_show=lambda: bring_to_front(window),
                                                     on_quit=window.destroy)
    state = {"tested": False}

    def on_closing():
        # No evaluate_js here (this runs on the closing window's thread); the shim saves 0.6 s after each change.
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
            ready = info.get("ready") == "complete" and info.get("shim") and info.get("booted")
            settled = settled + 1 if ready else 0
            if settled >= 3:
                break
            time.sleep(0.5)
        checks = desktop_checks(window, server) if settled >= 3 else {"error": "the toolkit did not start"}
        renderer = gui
        if sys.platform == "win32":
            renderer = getattr(sys.modules.get("webview.platforms.winforms"), "renderer", gui)
        write_report(report_path, method="window", toolkit=renderer, runtime=runtime, server_url=start_url,
                     data_folder=root, frozen=frozen(), vault=server.vault.enabled, vault_shared=server.vault.lan_url,
                     vault_error=server.vault.error, page=info, checks=checks)
        window.destroy()

    def on_loaded():
        if report_path and not state["tested"]:
            state["tested"] = True
            threading.Thread(target=self_test, name="merd-window-test", daemon=True).start()

    def after_start():
        if not report_path:
            threading.Timer(20, check_shell_update, args=(window, settings_path)).start()

    window.events.closing += on_closing
    window.events.loaded += on_loaded
    storage = None
    if sys.platform == "win32":
        # Checks use a throwaway browser profile next to their report, so only the data folder carries data over.
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


def open_data_folder(root):
    os.makedirs(os.path.join(root, PRIVATE_FOLDER), exist_ok=True)
    if sys.platform == "win32":
        os.startfile(root)
    elif sys.platform == "darwin":
        subprocess.run(["open", root], check=False)
    else:
        subprocess.run(["xdg-open", root], check=False)


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if "--version" in args:
        print("ME R&D Toolkit desktop %s" % VERSION)
        return 0
    report_path = os.environ.get("MERD_WINDOW_TEST") or None
    if report_path:
        report_path = os.path.abspath(report_path)
        os.environ.setdefault("MERD_DESKTOP_HOME", os.path.join(os.path.dirname(report_path), "merd-home"))
    root = data_root()
    os.makedirs(root, exist_ok=True)
    LOG_STATE["path"] = os.path.join(root, "desktop.log")
    if "--data-folder" in args:
        open_data_folder(root)
        return 0
    if "--stop" in args:
        send_to_window(root, "quit")
        return 0
    if not report_path and send_to_window(root, "show"):
        return 0  # already open: brought to the front
    return run_window(root, report_path)


if __name__ == "__main__":
    sys.exit(main())
