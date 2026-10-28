"""Storage scanner: safety-graded junk categories, large files, duplicates and
folder-growth snapshots. Standard library only.

Design rules (these are the product, not implementation details):
  * Scanning never modifies anything.
  * Every category carries a safety grade (safe / review) and a plain-language
    "why" plus "what happens after" so the user is never asked to trust a score.
  * Only paths found by a scan can be cleaned later; the client never sends raw
    paths for deletion (see vault.py), so a hostile page cannot ask the agent to
    delete ~/Documents.
  * Every walk is time-boxed; partial results are labelled as partial.
"""

import hashlib
import os
import stat
import threading
import time
import uuid

from metrics import IS_LINUX, IS_MAC, IS_WIN

DAY = 86400
INSTALLER_EXTENSIONS = {".dmg", ".pkg", ".exe", ".msi", ".msix", ".appimage", ".deb", ".rpm", ".apk", ".iso"}
ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".xz"}
DUPLICATE_MIN_BYTES = 1 * 1024 * 1024
LARGE_FILE_MIN_BYTES = 200 * 1024 * 1024
PROJECT_ROOT_NAMES = ("Projects", "projects", "Developer", "dev", "code", "Code", "src", "repos",
                      "GitHub", "git", "workspace", "Documents", "Desktop")
SKIP_DIR_NAMES = {".git", ".Trash", "Library", "AppData", "node_modules", ".cache", "$Recycle.Bin",
                  "System Volume Information", ".vitals"}


def allocated_size(st):
    """Bytes actually used on disk (sparse/compressed files count less)."""
    blocks = getattr(st, "st_blocks", None)
    if blocks is not None:
        return blocks * 512
    return st.st_size


def walk_size(root, deadline, max_entries=2_000_000):
    """Return (bytes, files, newest_mtime, complete) for a directory tree.

    Never follows symlinks. Stops early at ``deadline`` (time.monotonic()).
    """
    total = 0
    files = 0
    newest = 0.0
    stack = [root]
    seen = 0
    while stack:
        if time.monotonic() > deadline or seen > max_entries:
            return total, files, newest, False
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    seen += 1
                    try:
                        st = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if stat.S_ISLNK(st.st_mode):
                        continue
                    if stat.S_ISDIR(st.st_mode):
                        stack.append(entry.path)
                    elif stat.S_ISREG(st.st_mode):
                        total += allocated_size(st)
                        files += 1
                        if st.st_mtime > newest:
                            newest = st.st_mtime
        except OSError:
            continue
    return total, files, newest, True


def _children(path):
    try:
        with os.scandir(path) as entries:
            return [e.path for e in entries if not e.is_symlink()]
    except OSError:
        return []


# ------------------------------------------------------------------ categories
#
# Each category resolves to a list of "targets": concrete files or folders that
# would be moved to the Undo Vault. Folders like ~/Library/Caches are cleaned
# by their *children*, never by removing the folder itself (apps expect it).

def category_definitions(home):
    """Platform-specific category list, rooted at ``home``."""
    j = os.path.join
    local = os.environ.get("LOCALAPPDATA") or j(home, "AppData", "Local")
    temp = os.environ.get("TEMP") or j(local, "Temp")
    cats = []

    def add(cid, name, group, safety, why, after, roots, mode="children", rebuild=True):
        cats.append({"id": cid, "name": name, "group": group, "safety": safety, "why": why,
                     "after": after, "roots": roots, "mode": mode, "rebuilds": rebuild})

    if IS_MAC:
        add("app-caches", "App caches", "System junk", "safe",
            "Temporary data apps keep to load faster. Every app recreates it on demand.",
            "Apps may open a little slower the first time, then return to normal.",
            [j(home, "Library", "Caches")])
        add("logs", "Logs & crash reports", "System junk", "safe",
            "Diagnostic text files written by apps and macOS. Only useful when debugging.",
            "Nothing visible changes. New logs are written as needed.",
            [j(home, "Library", "Logs")])
        add("xcode-derived", "Xcode build data", "Developer", "safe",
            "Intermediate build products (DerivedData). Xcode rebuilds them on the next build.",
            "The next build of each project takes longer once.",
            [j(home, "Library", "Developer", "Xcode", "DerivedData")])
        add("ios-device-support", "Old iOS device symbols", "Developer", "review",
            "Debug symbols copied for every iOS version you ever plugged in.",
            "Xcode copies them again the next time that iPhone is connected.",
            [j(home, "Library", "Developer", "Xcode", "iOS DeviceSupport")])
        add("simulator-caches", "Simulator caches", "Developer", "safe",
            "Cache files for iOS simulators.", "Simulators rebuild caches on launch.",
            [j(home, "Library", "Developer", "CoreSimulator", "Caches")])
        add("iphone-backups", "iPhone / iPad backups", "Backups", "review",
            "Local device backups made by Finder. Often the single biggest hidden item.",
            "That backup is gone — make sure the device is backed up to iCloud or elsewhere.",
            [j(home, "Library", "Application Support", "MobileSync", "Backup")], rebuild=False)
        add("mail-downloads", "Mail attachment copies", "System junk", "safe",
            "Copies Mail saves when you open an attachment. The original stays in the email.",
            "Opening the attachment again re-downloads it.",
            [j(home, "Library", "Containers", "com.apple.mail", "Data", "Library", "Mail Downloads")])
        add("trash", "Trash", "System junk", "review",
            "Files you already deleted but are still taking space.",
            "They move into the Undo Vault instead of disappearing (unless you purge).",
            [j(home, ".Trash")], rebuild=False)
    elif IS_WIN:
        add("temp", "Temporary files", "System junk", "safe",
            "Files apps and installers leave in %TEMP%. Files in use are skipped automatically.",
            "Nothing visible changes.", [temp])
        add("browser-caches", "Browser caches", "System junk", "safe",
            "Chrome and Edge cached web content (not passwords, history or cookies).",
            "Sites load a little slower the first time.",
            [j(local, "Google", "Chrome", "User Data", "Default", "Cache"),
             j(local, "Google", "Chrome", "User Data", "Default", "Code Cache"),
             j(local, "Microsoft", "Edge", "User Data", "Default", "Cache"),
             j(local, "Microsoft", "Edge", "User Data", "Default", "Code Cache")])
        add("inet-cache", "Windows web cache", "System junk", "safe",
            "Cached content from Windows components and older apps.", "Nothing visible changes.",
            [j(local, "Microsoft", "Windows", "INetCache")])
        add("crash-dumps", "Crash dumps", "System junk", "safe",
            "Memory snapshots written when apps crash.", "Nothing visible changes.",
            [j(local, "CrashDumps")])
        add("thumb-cache", "Thumbnail cache", "System junk", "safe",
            "Explorer picture previews.", "Thumbnails are regenerated as you browse.",
            [j(local, "Microsoft", "Windows", "Explorer")], mode="thumbcache")
    else:
        add("user-cache", "App caches", "System junk", "safe",
            "~/.cache holds data apps recreate on demand.", "Apps rebuild caches as needed.",
            [j(home, ".cache")])
        add("trash", "Trash", "System junk", "review",
            "Files you already deleted.", "They move into the Undo Vault first.",
            [j(home, ".local", "share", "Trash", "files")], rebuild=False)
        add("thumbnails", "Thumbnail cache", "System junk", "safe",
            "Picture previews.", "Regenerated as you browse.", [j(home, ".cache", "thumbnails")])

    # Developer caches are almost identical everywhere.
    add("package-caches", "Package manager caches", "Developer", "safe",
        "Downloaded copies of packages (npm, pip, Yarn, Gradle, Cargo, Go, Homebrew).",
        "The next install downloads what it needs again.",
        [p for p in [
            j(home, ".npm", "_cacache"),
            j(local, "npm-cache") if IS_WIN else None,
            j(home, "Library", "Caches", "pip") if IS_MAC else j(local, "pip", "Cache") if IS_WIN else j(home, ".cache", "pip"),
            j(home, "Library", "Caches", "Yarn") if IS_MAC else j(local, "Yarn", "Cache") if IS_WIN else j(home, ".cache", "yarn"),
            j(home, ".gradle", "caches"),
            j(home, ".cargo", "registry", "cache"),
            j(home, "go", "pkg", "mod", "cache"),
            j(home, "Library", "Caches", "Homebrew") if IS_MAC else None,
        ] if p], mode="whole")
    add("stale-node-modules", "node_modules in idle projects", "Developer", "review",
        "Dependency folders of JavaScript projects you have not touched in 60+ days.",
        "Run npm install (or pnpm/yarn) in that project to get them back.",
        [j(home, name) for name in PROJECT_ROOT_NAMES], mode="node_modules")
    add("old-installers", "Installers & archives in Downloads", "Downloads", "review",
        "Disk images, installers and archives you already used (older than 14 days).",
        "Re-download from the vendor if you ever need them again.",
        [j(home, "Downloads")], mode="installers", rebuild=False)
    add("old-downloads", "Downloads untouched for 90 days", "Downloads", "review",
        "Everything else in Downloads you have not opened or changed in three months.",
        "Look through the list first — this can contain things you meant to keep.",
        [j(home, "Downloads")], mode="stale", rebuild=False)
    return cats


def _targets_for(category, deadline):
    """Yield (path, bytes, files, mtime, complete) for one category."""
    now = time.time()
    mode = category["mode"]
    seen_roots = set()
    for root in category["roots"]:
        if not os.path.isdir(root):
            continue
        try:
            root_stat = os.stat(root)
        except OSError:
            continue
        # Case-insensitive volumes (macOS, Windows) make "Projects" and
        # "projects" the same folder; count each physical folder once.
        root_key = (root_stat.st_dev, root_stat.st_ino)
        if root_key in seen_roots:
            continue
        seen_roots.add(root_key)
        if mode == "whole":
            size, files, newest, done = walk_size(root, deadline)
            if size:
                yield root, size, files, newest, done
        elif mode == "children":
            for child in _children(root):
                if os.path.isdir(child):
                    size, files, newest, done = walk_size(child, deadline)
                else:
                    try:
                        st = os.lstat(child)
                    except OSError:
                        continue
                    size, files, newest, done = allocated_size(st), 1, st.st_mtime, True
                if size:
                    yield child, size, files, newest, done
                if time.monotonic() > deadline:
                    return
        elif mode == "thumbcache":
            for child in _children(root):
                name = os.path.basename(child).lower()
                if name.startswith(("thumbcache_", "iconcache_")) and name.endswith(".db"):
                    try:
                        st = os.lstat(child)
                    except OSError:
                        continue
                    yield child, allocated_size(st), 1, st.st_mtime, True
        elif mode in ("installers", "stale"):
            for child in _children(root):
                try:
                    st = os.lstat(child)
                except OSError:
                    continue
                age = now - max(st.st_mtime, getattr(st, "st_atime", 0) if mode == "stale" else 0)
                ext = os.path.splitext(child)[1].lower()
                is_installer = ext in INSTALLER_EXTENSIONS or ext in ARCHIVE_EXTENSIONS
                if mode == "installers" and not (is_installer and age > 14 * DAY):
                    continue
                if mode == "stale" and (is_installer or age < 90 * DAY):
                    continue
                if stat.S_ISDIR(st.st_mode):
                    size, files, newest, done = walk_size(child, deadline)
                else:
                    size, files, newest, done = allocated_size(st), 1, st.st_mtime, True
                if size:
                    yield child, size, files, newest, done
        elif mode == "node_modules":
            yield from _stale_node_modules(root, deadline, now)


def _stale_node_modules(root, deadline, now, max_depth=5):
    stack = [(root, 0)]
    while stack:
        if time.monotonic() > deadline:
            return
        current, depth = stack.pop()
        try:
            entries = list(os.scandir(current))
        except OSError:
            continue
        names = {e.name for e in entries}
        if "node_modules" in names and "package.json" in names:
            project_mtime = _project_activity(current, entries)
            if now - project_mtime > 60 * DAY:
                nm = os.path.join(current, "node_modules")
                size, files, newest, done = walk_size(nm, deadline)
                if size:
                    yield nm, size, files, project_mtime, done
            continue  # never descend into a project's own tree for nested modules
        if depth >= max_depth:
            continue
        for entry in entries:
            if entry.is_dir(follow_symlinks=False) and entry.name not in SKIP_DIR_NAMES \
                    and not entry.name.startswith("."):
                stack.append((entry.path, depth + 1))


def _project_activity(project, entries):
    """Most recent change among a project's top-level files (excluding node_modules)."""
    newest = 0.0
    for entry in entries:
        if entry.name == "node_modules":
            continue
        try:
            newest = max(newest, entry.stat(follow_symlinks=False).st_mtime)
        except OSError:
            continue
    return newest or os.path.getmtime(project)


# ------------------------------------------------------------- large / dupes

def _iter_user_files(home, deadline):
    """Walk the user's own folders (skipping app data, dependency and VCS trees)."""
    stack = [home]
    while stack:
        if time.monotonic() > deadline:
            return
        current = stack.pop()
        try:
            with os.scandir(current) as entries:
                for entry in entries:
                    try:
                        st = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    if stat.S_ISDIR(st.st_mode):
                        if entry.name in SKIP_DIR_NAMES or (entry.name.startswith(".") and current == home):
                            continue
                        if entry.name.endswith((".app", ".photoslibrary", ".musiclibrary", ".fcpbundle")):
                            continue  # bundles are opaque units to the user
                        stack.append(entry.path)
                    elif stat.S_ISREG(st.st_mode):
                        yield entry.path, st
        except OSError:
            continue


def _file_hash(path, size, partial):
    digest = hashlib.blake2b(digest_size=20)
    try:
        with open(path, "rb") as handle:
            if partial:
                digest.update(handle.read(64 * 1024))
                if size > 128 * 1024:
                    handle.seek(-64 * 1024, os.SEEK_END)
                    digest.update(handle.read(64 * 1024))
            else:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
    except OSError:
        return None
    return digest.hexdigest()


def find_large_and_duplicates(home, deadline):
    large = []
    by_size = {}
    for path, st in _iter_user_files(home, deadline):
        size = st.st_size
        if size >= LARGE_FILE_MIN_BYTES:
            large.append({"path": path, "bytes": allocated_size(st), "mtime": st.st_mtime,
                          "atime": getattr(st, "st_atime", None)})
        if size >= DUPLICATE_MIN_BYTES:
            by_size.setdefault(size, []).append((path, st.st_mtime))
    large.sort(key=lambda x: x["bytes"], reverse=True)

    groups = []
    for size, items in by_size.items():
        if len(items) < 2 or time.monotonic() > deadline:
            continue
        partial = {}
        for path, mtime in items:
            key = _file_hash(path, size, partial=True)
            if key:
                partial.setdefault(key, []).append((path, mtime))
        for candidates in partial.values():
            if len(candidates) < 2:
                continue
            full = {}
            for path, mtime in candidates:
                key = _file_hash(path, size, partial=False)
                if key:
                    full.setdefault(key, []).append((path, mtime))
            for digest, same in full.items():
                if len(same) > 1:
                    same.sort(key=lambda x: x[1])  # oldest first = the "original"
                    groups.append({"hash": digest, "bytes_each": size,
                                   "keep": same[0][0], "copies": [p for p, _ in same[1:]],
                                   "wasted": size * (len(same) - 1)})
    groups.sort(key=lambda g: g["wasted"], reverse=True)
    return large[:40], groups[:60]


def folder_sizes(home, deadline):
    """Sizes of top-level home folders plus the heavy app-data folders."""
    j = os.path.join
    watched = [p for p in _children(home) if os.path.isdir(p)]
    if IS_MAC:
        for sub in ("Caches", "Application Support", "Containers", "Developer", "Group Containers"):
            watched.extend(p for p in _children(j(home, "Library", sub)) if os.path.isdir(p))
    elif IS_WIN:
        local = os.environ.get("LOCALAPPDATA") or j(home, "AppData", "Local")
        watched.extend(p for p in _children(local) if os.path.isdir(p))
    elif IS_LINUX:
        watched.extend(p for p in _children(j(home, ".cache")) if os.path.isdir(p))
    sizes = {}
    for path in watched:
        if time.monotonic() > deadline:
            break
        if os.path.basename(path) in ("Library", "AppData"):
            continue  # covered by its children above
        per_folder_deadline = min(deadline, time.monotonic() + 6)
        size, _, _, done = walk_size(path, per_folder_deadline)
        sizes[path] = {"bytes": size, "complete": done}
    return sizes


# ----------------------------------------------------------------- scan jobs

class Scanner:
    """Runs one scan at a time in a background thread and keeps the last result."""

    def __init__(self, home, history=None, budget_seconds=60):
        self.home = home
        self.history = history
        self.budget = budget_seconds
        self.lock = threading.Lock()
        self.state = {"status": "idle", "progress": 0, "step": "", "result": None, "id": None}
        self.targets = {}  # target_id -> {path, category, bytes}

    def start(self, deep=True):
        with self.lock:
            if self.state["status"] == "running":
                return self.state["id"]
            scan_id = uuid.uuid4().hex[:10]
            self.state = {"status": "running", "progress": 0, "step": "Starting", "result": None,
                          "id": scan_id, "started": time.time()}
        thread = threading.Thread(target=self._run, args=(scan_id, deep), daemon=True)
        thread.start()
        return scan_id

    def status(self):
        with self.lock:
            return dict(self.state)

    def _set(self, **values):
        with self.lock:
            self.state.update(values)

    def _run(self, scan_id, deep):
        try:
            self._scan(scan_id, deep)
        except Exception as error:  # keep the agent alive whatever the disk does
            self._set(status="error", step="Scan failed: %s" % error)

    def _scan(self, scan_id, deep):
        started = time.monotonic()
        deadline = started + self.budget
        cats = category_definitions(self.home)
        targets = {}
        categories = []
        for index, cat in enumerate(cats):
            self._set(step="Checking %s" % cat["name"], progress=int(5 + 55 * index / len(cats)))
            cat_deadline = min(deadline, time.monotonic() + max(4, self.budget / (len(cats) + 3)))
            items = []
            complete = True
            seen_targets = set()
            for path, size, files, mtime, done in _targets_for(cat, cat_deadline):
                try:
                    target_stat = os.lstat(path)
                    target_key = (target_stat.st_dev, target_stat.st_ino)
                except OSError:
                    continue
                if target_key in seen_targets:
                    continue
                seen_targets.add(target_key)
                tid = hashlib.sha1(("%s|%s" % (scan_id, path)).encode("utf-8", "surrogatepass")).hexdigest()[:16]
                targets[tid] = {"path": path, "category": cat["id"], "bytes": size}
                items.append({"id": tid, "path": path, "bytes": size, "files": files, "mtime": mtime})
                complete = complete and done
            if time.monotonic() > cat_deadline:
                complete = False
            items.sort(key=lambda x: x["bytes"], reverse=True)
            categories.append({
                "id": cat["id"], "name": cat["name"], "group": cat["group"], "safety": cat["safety"],
                "why": cat["why"], "after": cat["after"], "rebuilds": cat["rebuilds"],
                "bytes": sum(i["bytes"] for i in items), "count": len(items),
                "items": items[:200], "complete": complete,
            })
        large, duplicates, sizes = [], [], {}
        if deep:
            self._set(step="Looking for large files and exact duplicates", progress=65)
            large, duplicates = find_large_and_duplicates(self.home, min(deadline + 20, time.monotonic() + 25))
            for group in duplicates:
                for copy in group["copies"]:
                    tid = hashlib.sha1(("%s|dup|%s" % (scan_id, copy)).encode("utf-8", "surrogatepass")).hexdigest()[:16]
                    targets[tid] = {"path": copy, "category": "duplicates", "bytes": group["bytes_each"]}
                group["copy_ids"] = [
                    hashlib.sha1(("%s|dup|%s" % (scan_id, c)).encode("utf-8", "surrogatepass")).hexdigest()[:16]
                    for c in group["copies"]
                ]
            for item in large:
                tid = hashlib.sha1(("%s|large|%s" % (scan_id, item["path"])).encode("utf-8", "surrogatepass")).hexdigest()[:16]
                targets[tid] = {"path": item["path"], "category": "large", "bytes": item["bytes"]}
                item["id"] = tid
            self._set(step="Measuring folder growth", progress=85)
            sizes = folder_sizes(self.home, time.monotonic() + 25)
        growth = self.history.record_folder_sizes(sizes) if (self.history and sizes) else []
        result = {
            "id": scan_id,
            "finished": time.time(),
            "seconds": round(time.monotonic() - started, 1),
            "categories": categories,
            "reclaimable": sum(c["bytes"] for c in categories),
            "safe_reclaimable": sum(c["bytes"] for c in categories if c["safety"] == "safe"),
            "large_files": large,
            "duplicates": duplicates,
            "duplicate_waste": sum(g["wasted"] for g in duplicates),
            "growth": growth,
        }
        with self.lock:
            self.targets = targets
            self.state.update(status="done", progress=100, step="Done", result=result)

    def resolve(self, target_ids):
        """Map target ids from the last scan to concrete entries (unknown ids dropped)."""
        with self.lock:
            return [dict(self.targets[t], id=t) for t in target_ids if t in self.targets]

    def ids_for_categories(self, category_ids):
        with self.lock:
            return [tid for tid, t in self.targets.items() if t["category"] in category_ids]
