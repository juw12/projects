#!/usr/bin/env python3
"""Vitals local agent — zero-dependency (Python 3.8+ standard library).

Serves the web app from ../web and a small JSON API that reads real system
metrics, scans storage, cleans through the Undo Vault and remembers history.

    python apps/vitals/server/server.py            # http://127.0.0.1:8765
    python apps/vitals/server/server.py --lan      # also reachable from your phone (pairing code)

Security model
  * Binds to 127.0.0.1 unless --lan is given.
  * Every /api call except /api/health and /api/pair needs a session token.
    The token is handed out by /api/session only to loopback callers from an
    allowed origin, or by /api/pair to a device that types the 6-digit code
    shown in the terminal / desktop app.
  * Host-header check blocks DNS-rebinding; Origin allowlist blocks drive-by
    web pages; cleaning only accepts target ids produced by a scan.
"""

import argparse
import json
import os
import platform
import secrets
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import history as history_mod  # noqa: E402
import metrics  # noqa: E402
import storage  # noqa: E402
import vault as vault_mod  # noqa: E402

VERSION = "1.0.0"
WEB_DIR = os.path.normpath(os.path.join(HERE, "..", "web"))
DEFAULT_ORIGINS = {"https://juw12.github.io"}
MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
}


def lan_addresses():
    addresses = set()
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("10.255.255.255", 1))
        addresses.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    return sorted(a for a in addresses if not a.startswith("127."))


def startup_items(home):
    """Read-only list of things that launch at login."""
    items = []
    j = os.path.join
    if metrics.IS_MAC:
        for folder, scope in ((j(home, "Library", "LaunchAgents"), "you"),
                              ("/Library/LaunchAgents", "all users"),
                              ("/Library/LaunchDaemons", "system")):
            try:
                for name in sorted(os.listdir(folder)):
                    if name.endswith(".plist"):
                        items.append({"name": name[:-6], "scope": scope, "path": j(folder, name),
                                      "kind": "background agent" if scope != "system" else "system daemon"})
            except OSError:
                continue
        out = metrics.run(["osascript", "-e",
                           'tell application "System Events" to get the name of every login item'], timeout=4)
        for name in [n.strip() for n in out.split(",") if n.strip()]:
            items.append({"name": name, "scope": "you", "path": None, "kind": "login item"})
    elif metrics.IS_WIN:
        appdata = os.environ.get("APPDATA", "")
        folder = j(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
        try:
            for name in os.listdir(folder):
                items.append({"name": os.path.splitext(name)[0], "scope": "you", "path": j(folder, name),
                              "kind": "startup folder"})
        except OSError:
            pass
        for hive in ("HKCU", "HKLM"):
            out = metrics.run(["reg", "query", hive + r"\Software\Microsoft\Windows\CurrentVersion\Run"])
            for line in out.splitlines():
                parts = line.strip().split(None, 2)
                if len(parts) == 3 and parts[1].startswith("REG_"):
                    items.append({"name": parts[0], "scope": "you" if hive == "HKCU" else "all users",
                                  "path": parts[2], "kind": "registry Run"})
    else:
        folder = j(home, ".config", "autostart")
        try:
            for name in os.listdir(folder):
                if name.endswith(".desktop"):
                    items.append({"name": name[:-8], "scope": "you", "path": j(folder, name), "kind": "autostart"})
        except OSError:
            pass
    return items


class LocalModel:
    """Optional local LLM via Ollama (http://127.0.0.1:11434). Never a cloud call."""

    def __init__(self, url="http://127.0.0.1:11434", model=None):
        self.url = url.rstrip("/")
        self.model = model
        self.checked = 0
        self.available = []

    def models(self):
        if os.environ.get("VITALS_NO_MODEL"):
            return []
        if time.time() - self.checked < 60:
            return self.available
        self.checked = time.time()
        try:
            with urllib.request.urlopen(self.url + "/api/tags", timeout=0.8) as response:
                data = json.loads(response.read().decode("utf-8"))
            self.available = [m["name"] for m in data.get("models", [])]
        except (OSError, ValueError, urllib.error.URLError):
            self.available = []
        return self.available

    def ask(self, question, context):
        names = self.models()
        if not names:
            return None
        model = self.model if self.model in names else names[0]
        system = ("You are Vitals, a careful device-health assistant running locally. Answer in at most "
                  "6 short sentences. Use the JSON device context. Never recommend RAM 'boosters', registry "
                  "cleaners or deleting files outside caches without a backup. If unsure, say so.")
        body = json.dumps({
            "model": model, "stream": False,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": "Device context: %s\n\nQuestion: %s" % (
                             json.dumps(context)[:6000], question[:2000])}],
        }).encode("utf-8")
        request = urllib.request.Request(self.url + "/api/chat", data=body,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.loads(response.read().decode("utf-8"))
            return {"answer": data.get("message", {}).get("content", "").strip(), "model": model}
        except (OSError, ValueError, urllib.error.URLError):
            return None


class Agent:
    def __init__(self, home, data_dir, lan=False, origins=None, sample_interval=30,
                 retention_hours=72, scan_budget=60, sampler=True):
        self.home = os.path.abspath(home)
        self.data_dir = data_dir
        self.lan = lan
        self.origins = set(DEFAULT_ORIGINS) | set(origins or [])
        self.history = history_mod.History(data_dir)
        self.vault = vault_mod.Vault(data_dir, self.home, retention_hours, self.history)
        self.scanner = storage.Scanner(self.home, self.history, budget_seconds=scan_budget)
        self.sampler = history_mod.Sampler(self.history, self.home, self.vault, sample_interval)
        self.model = LocalModel(model=os.environ.get("VITALS_MODEL"))
        self.tokens = {secrets.token_urlsafe(24): {"device": "this computer", "created": time.time()}}
        self.local_token = next(iter(self.tokens))
        self.pair_code = self._new_code()
        self.pair_failures = 0
        self.lock = threading.Lock()
        self.port = None
        self.handler_class = None
        self.lan_servers = []
        self.settings_path = os.path.join(data_dir, "settings.json")
        self.settings = self._load_settings()
        if sampler:
            self.sampler.start()

    # ------------------------------------------------------------ settings
    def _load_settings(self):
        try:
            with open(self.settings_path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return {}

    def _save_settings(self):
        try:
            with open(self.settings_path, "w", encoding="utf-8") as handle:
                json.dump(self.settings, handle)
        except OSError:
            pass

    # ---------------------------------------------------------- phone access
    def set_lan(self, enable, remember=True):
        """Start/stop extra listeners on this computer's Wi-Fi/LAN addresses.

        The loopback listener keeps running, so the desktop dashboard never
        drops. Binding the specific LAN IP (not 0.0.0.0) avoids clashing with
        the loopback socket on the same port.
        """
        with self.lock:
            if remember:
                self.settings["lan"] = bool(enable)
                self._save_settings()
            if not enable:
                for httpd in self.lan_servers:
                    threading.Thread(target=httpd.shutdown, daemon=True).start()
                    httpd.server_close()
                self.lan_servers = []
                self.lan = False
                return {"lan": False, "urls": []}
            if self.lan_servers or self.lan:
                self.lan = True
                return {"lan": True, "error": None}
            errors = []
            for ip in lan_addresses():
                try:
                    httpd = ThreadingHTTPServer((ip, self.port), self.handler_class)
                except OSError as error:
                    errors.append("%s: %s" % (ip, error))
                    continue
                httpd.daemon_threads = True
                threading.Thread(target=httpd.serve_forever, daemon=True).start()
                self.lan_servers.append(httpd)
            self.lan = bool(self.lan_servers)
            if not self.lan:
                return {"lan": False, "error": "No Wi-Fi/LAN connection found" if not errors else "; ".join(errors)}
            return {"lan": True, "error": None}

    @staticmethod
    def _new_code():
        return "%06d" % secrets.randbelow(1_000_000)

    def pair(self, code, device):
        with self.lock:
            if not code or not secrets.compare_digest(str(code), self.pair_code):
                self.pair_failures += 1
                if self.pair_failures >= 5:
                    self.pair_code = self._new_code()
                    self.pair_failures = 0
                    print("Too many wrong codes — new pairing code: %s" % self.pair_code, flush=True)
                return None
            token = secrets.token_urlsafe(24)
            self.tokens[token] = {"device": (device or "phone")[:60], "created": time.time()}
            self.pair_code = self._new_code()  # one code, one device
            self.pair_failures = 0
            print("Paired %s. Next pairing code: %s" % (device or "a device", self.pair_code), flush=True)
            return token

    def current(self):
        if self.sampler.latest and time.time() - self.sampler.latest["time"] < 10:
            return self.sampler.latest
        return self.sampler.tick()


def make_handler(agent):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Vitals/" + VERSION
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # quiet by default
            if os.environ.get("VITALS_DEBUG"):
                sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        # ----------------------------------------------------- plumbing
        def _client_is_loopback(self):
            return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

        def _host_ok(self):
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
            allowed = {"127.0.0.1", "localhost", "::1"}
            if agent.lan:
                allowed |= set(lan_addresses()) | {socket.gethostname().lower(), socket.gethostname().lower() + ".local"}
            return host in allowed

        def _origin(self):
            return self.headers.get("Origin")

        def _origin_ok(self):
            origin = self._origin()
            if not origin:
                return True
            parsed = urlparse(origin)
            if parsed.hostname in ("127.0.0.1", "localhost"):
                return True
            if origin in agent.origins:
                return True
            own = "http://%s" % (self.headers.get("Host") or "")
            return origin == own

        def _cors(self):
            origin = self._origin()
            if origin and self._origin_ok():
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Vitals-Token")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send(self, status, payload):
            body = json.dumps(payload, default=str).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._cors()
            self.end_headers()
            self.wfile.write(body)

        def _body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > 1_000_000:
                raise ValueError("Body too large")
            raw = self.rfile.read(length) if length else b"{}"
            return json.loads(raw.decode("utf-8") or "{}")

        def _authed(self):
            token = self.headers.get("X-Vitals-Token")
            return bool(token) and token in agent.tokens

        def do_OPTIONS(self):
            self.send_response(204 if self._origin_ok() else 403)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_GET(self):
            self._dispatch("GET")

        def do_POST(self):
            self._dispatch("POST")

        def _dispatch(self, method):
            if not self._host_ok():
                return self._send(421, {"error": "Unexpected Host header"})
            url = urlparse(self.path)
            if not url.path.startswith("/api/"):
                if method != "GET":
                    return self._send(405, {"error": "Method not allowed"})
                return self._static(url.path)
            if not self._origin_ok():
                return self._send(403, {"error": "Origin not allowed"})
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            route = url.path[len("/api/"):].strip("/")
            try:
                body = self._body() if method == "POST" else {}
            except ValueError as error:
                return self._send(400, {"error": str(error)})
            public = {("GET", "health"), ("GET", "session"), ("POST", "pair")}
            if (method, route) not in public and not self._authed():
                return self._send(401, {"error": "Pair this device first"})
            handler = ROUTES.get((method, route))
            if not handler:
                return self._send(404, {"error": "Unknown endpoint"})
            try:
                status, payload = handler(self, query, body)
            except vault_mod.VaultError as error:
                status, payload = 400, {"error": str(error)}
            except Exception as error:  # never crash the agent on one bad request
                status, payload = 500, {"error": "%s: %s" % (type(error).__name__, error)}
            self._send(status, payload)

        def _static(self, path):
            if path in ("", "/"):
                path = "/index.html"
            rel = os.path.normpath(path.lstrip("/"))
            full = os.path.join(WEB_DIR, rel)
            if rel.startswith("..") or not os.path.realpath(full).startswith(os.path.realpath(WEB_DIR)):
                return self._send(404, {"error": "Not found"})
            if os.path.isdir(full):
                full = os.path.join(full, "index.html")
            if not os.path.isfile(full):
                return self._send(404, {"error": "Not found"})
            with open(full, "rb") as handle:
                data = handle.read()
            self.send_response(200)
            self.send_header("Content-Type", MIME.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(data)

    # --------------------------------------------------------- routes
    def health(h, q, b):
        return 200, {"ok": True, "app": "vitals", "version": VERSION, "os": platform.system(),
                     "hostname": socket.gethostname(), "lan": agent.lan}

    def session(h, q, b):
        if not h._client_is_loopback():
            return 403, {"error": "Use the pairing code from this computer"}
        return 200, {"token": agent.local_token, "device": "this computer"}

    def pair(h, q, b):
        token = agent.pair(b.get("code"), b.get("device"))
        if not token:
            return 403, {"error": "Wrong or expired code"}
        return 200, {"token": token, "hostname": socket.gethostname()}

    def pairing_info(h, q, b):
        port = agent.port or h.server.server_address[1]
        local = h._client_is_loopback()
        urls = ["http://%s:%d/mobile.html" % (ip, port) for ip in lan_addresses()] if agent.lan else []
        return 200, {"lan": agent.lan, "code": agent.pair_code if local else None,
                     "urls": urls,
                     "pair_urls": [u + "#pair=" + agent.pair_code for u in urls] if local else [],
                     "devices": [{"device": v["device"], "created": v["created"]} for v in agent.tokens.values()]}

    def lan_toggle(h, q, b):
        if not h._client_is_loopback():
            return 403, {"error": "Phone access can only be changed on this computer"}
        result = agent.set_lan(bool(b.get("enable")))
        if result.get("error") and not result.get("lan"):
            return 400, result
        return pairing_info(h, q, b)

    def vitals(h, q, b):
        snap = dict(agent.current())
        snap["vault_bytes"] = agent.vault.held_bytes()
        return 200, snap

    def processes(h, q, b):
        rows = agent.sampler.latest_procs if agent.sampler.latest_procs else metrics.processes(limit=0)
        rows = sorted(rows, key=lambda r: ((r["cpu"] or 0), r["rss"]), reverse=True)
        key = q.get("sort", "cpu")
        if key == "memory":
            rows = sorted(rows, key=lambda r: r["rss"], reverse=True)
        return 200, {"processes": rows[: int(q.get("limit", 25))]}

    def quit_process(h, q, b):
        ok, message = metrics.quit_process(int(b.get("pid", -1)))
        return (200 if ok else 400), {"ok": ok, "message": message}

    def open_settings(h, q, b):
        if not h._client_is_loopback():
            return 403, {"error": "Settings can only be opened from this computer"}
        ok, message = metrics.open_settings(b.get("target", ""))
        return (200 if ok else 400), {"ok": ok, "message": message}

    def scan_start(h, q, b):
        return 200, {"id": agent.scanner.start(deep=b.get("deep", True))}

    def scan_status(h, q, b):
        state = agent.scanner.status()
        if q.get("summary") and state.get("result"):
            result = dict(state["result"])
            result["categories"] = [dict(c, items=c["items"][:20]) for c in result["categories"]]
            state["result"] = result
        return 200, state

    def clean(h, q, b):
        ids = list(b.get("targets") or [])
        if b.get("categories"):
            ids += agent.scanner.ids_for_categories(set(b["categories"]))
        entries = agent.scanner.resolve(ids)
        if not entries:
            return 400, {"error": "Nothing to clean — run a scan first, then pick items from it"}
        manifest = agent.vault.clean(entries, mode=b.get("mode", "vault"), label=b.get("label") or "Cleanup")
        with agent.scanner.lock:
            for entry in entries:
                agent.scanner.targets.pop(entry["id"], None)
        return 200, manifest

    def vault_list(h, q, b):
        return 200, {"batches": agent.vault.batches(), "retention_hours": agent.vault.retention // 3600}

    def vault_restore(h, q, b):
        return 200, agent.vault.restore(b.get("batch", ""))

    def vault_purge(h, q, b):
        return 200, agent.vault.purge(b.get("batch", ""))

    def receipts(h, q, b):
        return 200, {"receipts": agent.history.receipts()}

    def series(h, q, b):
        return 200, {"series": agent.history.series(hours=float(q.get("hours", 24)))}

    def baseline(h, q, b):
        return 200, agent.history.baseline()

    def drain(h, q, b):
        return 200, agent.history.drain(hours=float(q.get("hours", 24)))

    def battery_forecast(h, q, b):
        return 200, agent.history.battery_forecast(agent.current().get("battery") or {})

    def startup(h, q, b):
        return 200, {"items": startup_items(agent.home)}

    def ask(h, q, b):
        context = {"vitals": agent.sampler.latest, "baseline": agent.history.baseline()}
        state = agent.scanner.status()
        if state.get("result"):
            r = state["result"]
            context["scan"] = {"reclaimable": r["reclaimable"],
                               "categories": [(c["name"], c["bytes"], c["safety"]) for c in r["categories"]]}
        answer = agent.model.ask(str(b.get("message", "")), context)
        return 200, answer or {"answer": None, "model": None}

    def shutdown(h, q, b):
        if not h._client_is_loopback():
            return 403, {"error": "Only this computer can stop Vitals"}
        # Reply first, then stop (used by the installer when updating).
        threading.Timer(0.3, lambda: os._exit(0)).start()
        return 200, {"ok": True}

    def model_status(h, q, b):
        return 200, {"models": agent.model.models()}

    ROUTES = {
        ("GET", "health"): health,
        ("GET", "session"): session,
        ("POST", "pair"): pair,
        ("GET", "pairing"): pairing_info,
        ("POST", "lan"): lan_toggle,
        ("GET", "vitals"): vitals,
        ("GET", "processes"): processes,
        ("POST", "process/quit"): quit_process,
        ("POST", "settings/open"): open_settings,
        ("POST", "scan"): scan_start,
        ("GET", "scan"): scan_status,
        ("POST", "clean"): clean,
        ("GET", "vault"): vault_list,
        ("POST", "vault/restore"): vault_restore,
        ("POST", "vault/purge"): vault_purge,
        ("GET", "receipts"): receipts,
        ("GET", "history"): series,
        ("GET", "baseline"): baseline,
        ("GET", "drain"): drain,
        ("GET", "battery/forecast"): battery_forecast,
        ("GET", "startup"): startup,
        ("POST", "ask"): ask,
        ("GET", "model"): model_status,
        ("POST", "shutdown"): shutdown,
    }
    return Handler


def already_running(port):
    """True if a Vitals agent already answers on this port."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=1) as response:
            return json.loads(response.read().decode("utf-8")).get("app") == "vitals"
    except (OSError, ValueError, urllib.error.URLError):
        return False


def default_data_dir():
    return os.environ.get("VITALS_DATA") or os.path.join(os.path.expanduser("~"), ".vitals")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Vitals local agent")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VITALS_PORT", 8765)))
    parser.add_argument("--lan", action="store_true", help="Listen on the local network (phone pairing)")
    parser.add_argument("--home", default=os.path.expanduser("~"), help="Folder to scan (default: your home)")
    parser.add_argument("--data", default=default_data_dir(), help="Where history and the Undo Vault live")
    parser.add_argument("--allow-origin", action="append", default=[], help="Extra web origin allowed to call the API")
    parser.add_argument("--interval", type=int, default=30, help="Seconds between background samples")
    parser.add_argument("--retention", type=int, default=72, help="Hours the Undo Vault keeps cleaned files")
    parser.add_argument("--scan-budget", type=int, default=60, help="Max seconds per storage scan")
    parser.add_argument("--open", action="store_true", help="Open the dashboard in your browser")
    args = parser.parse_args(argv)

    dashboard = "http://127.0.0.1:%d/" % args.port
    if already_running(args.port):
        # Double-clicking the app again should just show the dashboard.
        print("Vitals is already running — opening %s" % dashboard, flush=True)
        if args.open:
            import webbrowser
            webbrowser.open(dashboard)
        return

    agent = Agent(args.home, args.data, lan=args.lan, origins=args.allow_origin,
                  sample_interval=args.interval, retention_hours=args.retention, scan_budget=args.scan_budget)
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    handler = make_handler(agent)
    try:
        httpd = ThreadingHTTPServer((host, args.port), handler)
    except OSError as error:
        print("Port %d is busy (%s). Try --port 8766." % (args.port, error), flush=True)
        sys.exit(1)
    httpd.daemon_threads = True
    port = httpd.server_address[1]
    agent.port = port
    agent.handler_class = handler
    if not args.lan and agent.settings.get("lan"):
        agent.set_lan(True, remember=False)
    print("Vitals %s — dashboard: http://127.0.0.1:%d/" % (VERSION, port), flush=True)
    print("Data (history + Undo Vault): %s" % args.data, flush=True)
    if agent.lan:
        for ip in lan_addresses():
            print("Phone: open http://%s:%d/mobile.html#pair=%s (or scan the QR in Devices)" % (ip, port, agent.pair_code), flush=True)
    if args.open:
        import webbrowser
        webbrowser.open("http://127.0.0.1:%d/" % port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
