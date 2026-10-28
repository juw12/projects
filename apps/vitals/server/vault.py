"""Undo Vault: every cleanup is a move, not a delete, until the user says so.

Files are renamed into ``<data>/vault/<batch>/`` (instant on the same volume),
with a manifest recording where each one came from. A batch can be restored in
one click, purged early to actually free the space, or expires automatically
after the retention window. Each action writes a *receipt* with the disk space
measured before and after — proof of what happened, not a claim.
"""

import json
import os
import shutil
import threading
import time
import uuid

from metrics import IS_WIN

PROTECTED_NAMES = {
    "Desktop", "Documents", "Downloads", "Pictures", "Movies", "Music", "Library", "Applications",
    "AppData", "Local", "Roaming", "OneDrive", "iCloud Drive", "Videos", "Public", ".ssh", ".gnupg",
}


class VaultError(Exception):
    pass


def _disk_free(path):
    try:
        return shutil.disk_usage(path).free
    except OSError:
        return None


def _tree_size(path):
    if os.path.islink(path) or not os.path.isdir(path):
        try:
            st = os.lstat(path)
        except OSError:
            return 0
        return getattr(st, "st_blocks", 0) * 512 or st.st_size
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                st = os.lstat(os.path.join(root, name))
            except OSError:
                continue
            total += getattr(st, "st_blocks", 0) * 512 or st.st_size
    return total


def _remove(path):
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path, ignore_errors=True)
    else:
        try:
            os.remove(path)
        except OSError:
            pass


class Vault:
    def __init__(self, data_dir, home, retention_hours=72, history=None):
        self.root = os.path.join(data_dir, "vault")
        self.home = os.path.realpath(home)
        self.retention = retention_hours * 3600
        self.history = history
        self.lock = threading.Lock()
        os.makedirs(self.root, exist_ok=True)
        extra = []
        if IS_WIN:
            for var in ("TEMP", "LOCALAPPDATA"):
                if os.environ.get(var):
                    extra.append(os.path.realpath(os.environ[var]))
        self.allowed_roots = [self.home] + extra

    # ------------------------------------------------------------ safety
    def check_path(self, path):
        """Raise VaultError unless ``path`` is a safe, specific item inside home."""
        if not path or not os.path.isabs(path):
            raise VaultError("Not an absolute path")
        if os.path.islink(path):
            real_parent = os.path.realpath(os.path.dirname(path))
            real = os.path.join(real_parent, os.path.basename(path))
        else:
            real = os.path.realpath(path)
        if not any(real == r or real.startswith(r.rstrip(os.sep) + os.sep) for r in self.allowed_roots):
            raise VaultError("Outside your user folder: %s" % path)
        if real in self.allowed_roots:
            raise VaultError("Refusing to touch a root folder")
        rel = os.path.relpath(real, self.home)
        parts = rel.split(os.sep)
        if len(parts) == 1 and parts[0] in PROTECTED_NAMES:
            raise VaultError("Refusing to remove a standard folder: %s" % parts[0])
        if real.startswith(os.path.realpath(self.root)):
            raise VaultError("That item is already in the vault")
        if not os.path.lexists(path):
            raise VaultError("Already gone")
        return real

    # ----------------------------------------------------------- actions
    def clean(self, entries, mode="vault", label="Cleanup"):
        """Move (mode='vault') or delete (mode='free') resolved scan entries."""
        if mode not in ("vault", "free"):
            raise VaultError("Unknown mode")
        batch_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
        batch_dir = os.path.join(self.root, batch_id)
        free_before = _disk_free(self.home)
        moved, skipped = [], []
        with self.lock:
            if mode == "vault":
                os.makedirs(batch_dir, exist_ok=True)
            for index, entry in enumerate(entries):
                path = entry["path"]
                try:
                    self.check_path(path)
                    size = entry.get("bytes") or _tree_size(path)
                    if mode == "vault":
                        dest = os.path.join(batch_dir, "%04d" % index, os.path.basename(path))
                        os.makedirs(os.path.dirname(dest), exist_ok=True)
                        try:
                            os.rename(path, dest)
                        except OSError:
                            shutil.move(path, dest)
                        moved.append({"original": path, "stored": dest, "bytes": size,
                                      "category": entry.get("category")})
                    else:
                        _remove(path)
                        if os.path.lexists(path):
                            raise VaultError("In use or protected")
                        moved.append({"original": path, "stored": None, "bytes": size,
                                      "category": entry.get("category")})
                except (VaultError, OSError, shutil.Error) as error:
                    skipped.append({"path": path, "reason": str(error)})
            free_after = _disk_free(self.home)
            manifest = {
                "id": batch_id, "label": label, "mode": mode, "created": time.time(),
                "expires": time.time() + self.retention if mode == "vault" else None,
                "items": moved, "skipped": skipped, "status": "held" if mode == "vault" else "freed",
                "bytes": sum(m["bytes"] for m in moved),
            }
            if mode == "vault":
                if moved:
                    with open(os.path.join(batch_dir, "manifest.json"), "w", encoding="utf-8") as handle:
                        json.dump(manifest, handle, indent=1)
                else:
                    shutil.rmtree(batch_dir, ignore_errors=True)
        receipt = self._receipt(
            "clean", label, manifest, free_before, free_after,
            note=("Held in the Undo Vault for %d h — space is released when the batch expires or you purge it."
                  % (self.retention // 3600)) if mode == "vault" else "Deleted immediately (no undo).")
        manifest["receipt"] = receipt
        return manifest

    def batches(self):
        out = []
        for name in sorted(os.listdir(self.root), reverse=True):
            manifest = self._load(name)
            if manifest:
                manifest = dict(manifest)
                manifest["count"] = len(manifest["items"])
                manifest["items"] = manifest["items"][:50]
                out.append(manifest)
        return out

    def restore(self, batch_id):
        with self.lock:
            manifest = self._load(batch_id)
            if not manifest:
                raise VaultError("No such batch")
            restored, conflicts = 0, []
            for item in manifest["items"]:
                stored, original = item["stored"], item["original"]
                if not stored or not os.path.lexists(stored):
                    continue
                target = original
                if os.path.lexists(target):
                    base, ext = os.path.splitext(original)
                    target = "%s (restored)%s" % (base, ext)
                    conflicts.append(target)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                try:
                    os.rename(stored, target)
                except OSError:
                    shutil.move(stored, target)
                restored += 1
            shutil.rmtree(os.path.join(self.root, batch_id), ignore_errors=True)
        receipt = self._receipt("restore", manifest["label"], manifest, None, None,
                                note="Restored %d item(s) to where they were." % restored)
        return {"restored": restored, "renamed": conflicts, "receipt": receipt}

    def purge(self, batch_id):
        with self.lock:
            manifest = self._load(batch_id)
            if not manifest:
                raise VaultError("No such batch")
            before = _disk_free(self.home)
            shutil.rmtree(os.path.join(self.root, batch_id), ignore_errors=True)
            after = _disk_free(self.home)
        return self._receipt("purge", manifest["label"], manifest, before, after,
                             note="Vault batch deleted for good; the space is now free.")

    def expire(self):
        """Purge batches past their retention window. Returns ids purged."""
        purged = []
        now = time.time()
        for name in os.listdir(self.root):
            manifest = self._load(name)
            if manifest and manifest.get("expires") and manifest["expires"] < now:
                self.purge(name)
                purged.append(name)
        return purged

    def held_bytes(self):
        return sum(b["bytes"] for b in self.batches())

    # ----------------------------------------------------------- helpers
    def _load(self, batch_id):
        if not batch_id or os.sep in batch_id or batch_id.startswith("."):
            return None
        path = os.path.join(self.root, batch_id, "manifest.json")
        try:
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return None

    def _receipt(self, kind, label, manifest, before, after, note):
        receipt = {
            "id": uuid.uuid4().hex[:10], "time": time.time(), "kind": kind, "label": label,
            "batch": manifest["id"], "items": len(manifest["items"]), "bytes": manifest["bytes"],
            "skipped": len(manifest.get("skipped", [])),
            "disk_free_before": before, "disk_free_after": after,
            "measured_freed": (after - before) if (before is not None and after is not None) else None,
            "note": note,
        }
        if self.history:
            self.history.add_receipt(receipt)
        return receipt
