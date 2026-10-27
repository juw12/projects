"""ME R&D Toolkit – team file vault server (Python 3.8+, standard library only).

Serves the toolkit web app plus read-only access to configured folders, grouped into categories,
behind a shared password (HTTP Basic auth). Every request is logged.

    python vault_server.py                 # uses ../private/vault_config.json
    python vault_server.py my_config.json

Config keys: host, port, user, password, title, roots[{id,name,path}], exclude[...], excludeNames[...],
categories[{name, icon, desc, match[...]}], hideTerms[...] (removed from names shown in the app).
Match/exclude entries are "rootId:relative/posix/prefix". Paths written as "[Root Name]\\rest" resolve to that root.
Only expose this on your internal network. Never port-forward it to the internet.
"""
import base64
import fnmatch
import hmac
import json
import mimetypes
import os
import re
import secrets
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_ROOT = HERE.parent
# Monorepo layout keeps the front-end in web/; the flat layout keeps it next to server/.
WEB_DIR = APP_ROOT / "web" if (APP_ROOT / "web" / "index.html").is_file() else APP_ROOT
PRIVATE_DIR = Path(os.environ.get("ME_PRIVATE_DIR") or APP_ROOT / "private")
CONFIG_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else PRIVATE_DIR / "vault_config.json"
LOG_PATH = PRIVATE_DIR / "vault_access.log"
APP_FILES = {
    "index.html", "app.js", "views.js", "vault.js", "styles.css", "demo-pack.js", "manifest.webmanifest",
    "sw.js", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "private/pack.js", "private/calcs.js",
}
INLINE_TYPES = ("application/pdf", "image/", "video/", "audio/", "text/plain")

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("model/step", ".step")
mimetypes.add_type("model/step", ".stp")


def load_config():
    if not CONFIG_PATH.exists():
        sys.exit(f"Config not found: {CONFIG_PATH}")
    config = json.loads(CONFIG_PATH.read_text(encoding="utf8"))
    if not config.get("password"):
        config["password"] = secrets.token_urlsafe(9)
        CONFIG_PATH.write_text(json.dumps(config, ensure_ascii=False, indent=1), encoding="utf8")
    config.setdefault("host", "0.0.0.0")
    config.setdefault("port", 8780)
    config.setdefault("user", "team")
    config.setdefault("title", "R&D File Vault")
    return config


CONFIG = load_config()
ROOTS = {r["id"]: r for r in CONFIG["roots"]}


def norm(text):
    return text.replace("\\", "/").strip("/").lower()


EXCLUDES = [(e.split(":", 1)[0], norm(e.split(":", 1)[1])) for e in CONFIG.get("exclude", [])]
EXCLUDE_NAMES = [n.lower() for n in CONFIG.get("excludeNames", [])]
CATEGORIES = []
for category in CONFIG.get("categories", []):
    for rule in category["match"]:
        root_id, prefix = rule.split(":", 1)
        CATEGORIES.append((root_id, norm(prefix), category))
CATEGORIES.sort(key=lambda item: -len(item[1]))  # most specific prefix wins
STRICT = bool(CONFIG.get("strict", True))  # only share files that belong to a category


def under(rel_lower, prefix):
    return prefix == "" or rel_lower == prefix or rel_lower.startswith(prefix + "/")


def is_excluded(root_id, rel):
    rel_lower = norm(rel)
    name = rel_lower.rsplit("/", 1)[-1]
    if any(fnmatch.fnmatch(name, pattern) for pattern in EXCLUDE_NAMES):
        return True
    return any(root_id == rid and under(rel_lower, prefix) for rid, prefix in EXCLUDES)


def categorize(root_id, rel):
    rel_lower = norm(rel)
    for rid, prefix, category in CATEGORIES:
        if rid == root_id and under(rel_lower, prefix):
            parts = rel.replace("\\", "/").split("/")
            depth = len(prefix.split("/")) if prefix else 0
            if len(category["match"]) == 1:
                return category["name"], "/".join(parts[depth:])
            label = parts[depth - 1] if depth else ROOTS[root_id]["name"]
            return category["name"], "/".join([label] + parts[depth:])
    return "Other", rel.replace("\\", "/")


# ---------------------------------------------------------------- index
INDEX = {"files": [], "built": None, "building": False, "took": 0}
INDEX_LOCK = threading.Lock()


def build_index():
    with INDEX_LOCK:
        if INDEX["building"]:
            return
        INDEX["building"] = True
    started = time.time()
    files = []
    for root_id, root in ROOTS.items():
        base = root["path"]
        if not os.path.isdir(base):
            print(f"  ! root not reachable: {root['name']}")
            continue
        for directory, subdirs, names in os.walk(base):
            rel_dir = os.path.relpath(directory, base)
            rel_dir = "" if rel_dir == "." else rel_dir
            subdirs[:] = [d for d in subdirs if not is_excluded(root_id, os.path.join(rel_dir, d))]
            for name in names:
                rel = os.path.join(rel_dir, name) if rel_dir else name
                if is_excluded(root_id, rel):
                    continue
                try:
                    stat = os.stat(os.path.join(directory, name))
                except OSError:
                    continue
                category, tree = categorize(root_id, rel)
                if STRICT and category == "Other":
                    continue
                files.append({
                    "r": root_id, "p": rel.replace("\\", "/"), "n": name, "c": category, "t": tree,
                    "s": stat.st_size, "m": int(stat.st_mtime),
                })
    with INDEX_LOCK:
        INDEX.update(files=files, built=time.strftime("%Y-%m-%d %H:%M"), building=False, took=round(time.time() - started, 1))
    print(f"  index ready: {len(files)} files in {INDEX['took']} s")


def category_summary():
    summary = {}
    for f in INDEX["files"]:
        item = summary.setdefault(f["c"], {"count": 0, "size": 0, "latest": 0})
        item["count"] += 1
        item["size"] += f["s"]
        item["latest"] = max(item["latest"], f["m"])
    result = []
    for category in CONFIG.get("categories", []) + [{"name": "Other", "icon": "folder", "desc": ""}]:
        if category["name"] in summary:
            result.append(dict(summary[category["name"]], name=category["name"], icon=category.get("icon", "folder"), desc=category.get("desc", "")))
    return result


def list_folder(category, folder):
    folder = folder.strip("/")
    prefix = folder + "/" if folder else ""
    dirs = {}
    files = []
    for f in INDEX["files"]:
        if f["c"] != category or not f["t"].startswith(prefix):
            continue
        rest = f["t"][len(prefix):]
        if "/" in rest:
            name = rest.split("/", 1)[0]
            entry = dirs.setdefault(name, {"name": name, "count": 0, "latest": 0})
            entry["count"] += 1
            entry["latest"] = max(entry["latest"], f["m"])
        else:
            files.append(f)
    return {"dirs": sorted(dirs.values(), key=lambda d: d["name"].lower()), "files": sorted(files, key=lambda f: f["n"].lower())}


def search(query, category, limit=300):
    terms = [t for t in query.lower().split() if t]
    hits = []
    for f in INDEX["files"]:
        if category and f["c"] != category:
            continue
        hay = (f["t"] + " " + f["n"]).lower()
        if all(t in hay for t in terms):
            hits.append(f)
            if len(hits) >= limit:
                break
    return hits


def resolve(root_id, rel):
    root = ROOTS.get(root_id)
    if not root or is_excluded(root_id, rel):
        return None
    if STRICT and categorize(root_id, rel)[0] == "Other":
        return None
    base = os.path.realpath(root["path"])
    # Data packs write Windows paths ("a\\b"); accept both separators on every OS.
    full = os.path.realpath(os.path.join(base, rel.replace("\\", "/").replace("/", os.sep)))
    try:
        if os.path.commonpath([base.lower(), full.lower()]) != base.lower():
            return None
    except ValueError:
        return None
    return full if os.path.isfile(full) else None


def unalias(path):
    """Map "[Root Name]\\rest" (as written by private data packs) to the root's real path."""
    match = re.match(r"^\[([^\]]+)\](.*)$", path or "")
    if match:
        for root in ROOTS.values():
            if root["name"].lower() == match.group(1).lower():
                return root["path"].rstrip("\\/") + match.group(2)
    return path


def resolve_absolute(path):
    path = unalias(path)
    lower = path.replace("/", "\\").lower()
    for root_id, root in ROOTS.items():
        base = root["path"].replace("/", "\\").rstrip("\\").lower()
        if lower.startswith(base + "\\"):
            return resolve(root_id, path.replace("/", "\\")[len(base) + 1:])
    return None


def locate(path):
    path = unalias(path)
    lower = path.replace("/", "\\").rstrip("\\").lower()
    for root_id, root in ROOTS.items():
        base = root["path"].replace("/", "\\").rstrip("\\").lower()
        if lower == base or lower.startswith(base + "\\"):
            rel = path.replace("/", "\\").rstrip("\\")[len(base) + 1:]
            if is_excluded(root_id, rel):
                return None
            category, tree = categorize(root_id, rel + "\\x")
            if STRICT and category == "Other":
                return None
            return {"cat": category, "dir": tree.rsplit("/", 1)[0]}
    return None


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "VaultServer/1.0"

    def log_message(self, fmt, *args):
        pass

    def audit(self, status):
        line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}\t{self.client_address[0]}\t{status}\t{urllib.parse.unquote(self.path)}\n"
        try:
            with open(LOG_PATH, "a", encoding="utf8") as handle:
                handle.write(line)
        except OSError:
            pass

    def authorized(self):
        if CONFIG.get("localNoAuth") and self.client_address[0] in ("127.0.0.1", "::1"):
            return True  # testing convenience only, off by default
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            user, _, password = base64.b64decode(header[6:]).decode("utf8").partition(":")
        except Exception:
            return False
        return hmac.compare_digest(user, CONFIG["user"]) and hmac.compare_digest(password, CONFIG["password"])

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, full, download=False, app_asset=False):
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        start, end = 0, size - 1
        range_header = self.headers.get("Range")
        match = re.match(r"bytes=(\d*)-(\d*)", range_header or "")
        if match and size:
            if match.group(1):
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else size - 1
            else:
                start = max(0, size - int(match.group(2)))
            end = min(end, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        name = os.path.basename(full)
        inline = not download and ctype.startswith(INLINE_TYPES)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(end - start + 1 if size else 0))
        self.send_header("Accept-Ranges", "bytes")
        if app_asset:
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Content-Disposition", ("inline" if inline else "attachment") + "; filename*=UTF-8''" + urllib.parse.quote(name))
            self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        with open(full, "rb") as handle:
            handle.seek(start)
            remaining = end - start + 1 if size else 0
            while remaining > 0:
                chunk = handle.read(min(1 << 16, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)

    def do_GET(self):
        if not self.authorized():
            self.send_response(401)
            self.send_header("WWW-Authenticate", f'Basic realm="{CONFIG["title"]}", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            self.audit(401)
            return
        url = urllib.parse.urlparse(self.path)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(url.query).items()}
        route = url.path.rstrip("/") or "/"
        try:
            if route == "/api/status":
                self.send_json({
                    "server": True, "title": CONFIG["title"], "files": len(INDEX["files"]),
                    "built": INDEX["built"], "building": INDEX["building"], "hideTerms": CONFIG.get("hideTerms", []),
                })
            elif route == "/api/vault/categories":
                self.send_json({"categories": category_summary(), "built": INDEX["built"], "building": INDEX["building"]})
            elif route == "/api/vault/list":
                self.send_json(list_folder(query.get("cat", ""), query.get("dir", "")))
            elif route == "/api/vault/search":
                self.send_json({"files": search(query.get("q", ""), query.get("cat", ""))})
            elif route == "/api/vault/locate":
                found = locate(query.get("abs", ""))
                self.send_json(found or {"cat": "", "dir": ""}, 200 if found else 404)
            elif route == "/api/vault/recent":
                self.send_json({"files": sorted(INDEX["files"], key=lambda f: -f["m"])[:60]})
            elif route == "/api/vault/reindex":
                threading.Thread(target=build_index, daemon=True).start()
                self.send_json({"ok": True})
            elif route == "/file":
                full = resolve_absolute(query["abs"]) if "abs" in query else resolve(query.get("r", ""), query.get("p", ""))
                if not full:
                    self.send_json({"error": "not found or not shared"}, 404)
                    self.audit(404)
                    return
                self.send_file(full, download=query.get("dl") == "1")
            else:
                rel = urllib.parse.unquote(route.lstrip("/")) or "index.html"
                asset = PRIVATE_DIR / rel[len("private/"):] if rel.startswith("private/") else WEB_DIR / rel
                if rel not in APP_FILES or not asset.is_file():
                    self.send_json({"error": "not found"}, 404)
                    self.audit(404)
                    return
                self.send_file(str(asset), app_asset=True)
            self.audit(200)
        except (BrokenPipeError, ConnectionResetError):
            pass


def lan_addresses():
    addresses = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("10.255.255.255", 1))
            addresses.add(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(info[4][0])
    except OSError:
        pass
    return sorted(a for a in addresses if not a.startswith("127."))


class ExclusiveHTTPServer(ThreadingHTTPServer):
    """Fail loudly if the port is taken (on Windows, SO_REUSEADDR would let two servers share it)."""

    allow_reuse_address = os.name != "nt"
    daemon_threads = True

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def main():
    print(f"\n  {CONFIG['title']}")
    print(f"  user: {CONFIG['user']}    password: {CONFIG['password']}")
    try:
        server = ExclusiveHTTPServer((CONFIG["host"], CONFIG["port"]), Handler)
    except OSError as error:
        sys.exit(f"  Port {CONFIG['port']} is already in use ({error}). Change \"port\" in {CONFIG_PATH}.")
    threading.Thread(target=build_index, daemon=True).start()
    print(f"  local:   http://localhost:{CONFIG['port']}/")
    if CONFIG["host"] in ("0.0.0.0", ""):
        for address in lan_addresses():
            print(f"  network: http://{address}:{CONFIG['port']}/")
    print(f"  access log: {LOG_PATH}\n  Ctrl+C to stop.\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("  stopped")


if __name__ == "__main__":
    main()
