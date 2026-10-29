#!/usr/bin/env python3
"""Hermetic end-to-end test for the Vitals agent (stdlib only, exits 0/1).

Builds a fake home folder with caches, logs, an old installer, a stale
node_modules and duplicate files, starts the real server on a free port with a
temporary data dir, then exercises: auth, vitals, scan, clean-to-vault,
restore, clean again + purge, receipts, path-safety and origin checks.
Nothing outside the temp folders is read for cleaning or modified.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "server", "server.py")
sys.path.insert(0, os.path.join(HERE, "..", "server"))

import metrics  # noqa: E402

FAILURES = []


def check(condition, label):
    print(("  ok   " if condition else "  FAIL ") + label)
    if not condition:
        FAILURES.append(label)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def write(path, size=1024, content=None, age_days=0):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(content if content is not None else os.urandom(size))
    if age_days:
        stamp = time.time() - age_days * 86400
        os.utime(path, (stamp, stamp))


def build_home(home):
    j = os.path.join
    if metrics.IS_MAC:
        write(j(home, "Library", "Caches", "com.example.app", "blob.bin"), 300_000)
        write(j(home, "Library", "Logs", "example.log"), 50_000)
        cache_probe = j(home, "Library", "Caches", "com.example.app")
    elif metrics.IS_WIN:
        os.environ["LOCALAPPDATA"] = j(home, "AppData", "Local")
        os.environ["TEMP"] = j(home, "AppData", "Local", "Temp")
        write(j(home, "AppData", "Local", "Temp", "setup123", "junk.tmp"), 300_000)
        write(j(home, "AppData", "Local", "CrashDumps", "app.dmp"), 50_000)
        cache_probe = j(home, "AppData", "Local", "Temp", "setup123")
    else:
        write(j(home, ".cache", "someapp", "blob.bin"), 300_000)
        cache_probe = j(home, ".cache", "someapp")
    write(j(home, ".npm", "_cacache", "index", "x"), 120_000)
    write(j(home, "Downloads", "OldInstaller.dmg"), 200_000, age_days=40)
    write(j(home, "Downloads", "fresh.zip"), 10_000)  # too new to be suggested
    project = j(home, "Projects", "old-site")
    write(j(project, "package.json"), content=b"{}", age_days=120)
    write(j(project, "node_modules", "left-pad", "index.js"), 80_000, age_days=120)
    os.utime(project, (time.time() - 120 * 86400,) * 2)
    payload = os.urandom(1_500_000)
    write(j(home, "Documents", "report.pdf"), content=payload, age_days=10)
    write(j(home, "Desktop", "report copy.pdf"), content=payload)
    write(j(home, "Documents", "keep-me.txt"), content=b"important")
    return cache_probe


def request(base, method, path, body=None, token=None, origin=None, host=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("X-Vitals-Token", token)
    if origin:
        req.add_header("Origin", origin)
    if host:
        req.add_header("Host", host)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.status, json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode("utf-8") or "{}")
        except ValueError:
            return error.code, {}


def main():
    root = tempfile.mkdtemp(prefix="vitals-test-")
    home = os.path.join(root, "home")
    data = os.path.join(root, "data")
    cache_probe = build_home(home)
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    env = dict(os.environ, VITALS_NO_MODEL="1", VITALS_NO_NOTIFY="1")  # hermetic: no LLM, no pop-ups
    proc = subprocess.Popen(
        [sys.executable, SERVER, "--port", str(port), "--home", home, "--data", data,
         "--interval", "3600", "--scan-budget", "20"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    try:
        for _ in range(100):
            try:
                status, health = request(base, "GET", "/api/health")
                if status == 200:
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise SystemExit("server did not start")
        print("Vitals agent on %s" % base)
        check(health.get("app") == "vitals", "health endpoint answers")

        status, _ = request(base, "GET", "/api/vitals")
        check(status == 401, "API refuses calls without a token")
        status, _ = request(base, "GET", "/api/session", origin="https://evil.example")
        check(status == 403, "foreign web origin cannot obtain a session")
        status, _ = request(base, "GET", "/api/health", host="attacker.example")
        check(status == 421, "DNS-rebinding Host header rejected")
        status, sess = request(base, "GET", "/api/session")
        token = sess.get("token")
        check(status == 200 and token, "loopback client gets a session token")
        status, _ = request(base, "GET", "/api/session", origin="https://juw12.github.io")
        check(status == 200, "hosted app origin is allowed")

        status, pair = request(base, "POST", "/api/pair", {"code": "000000x"})
        check(status == 403, "wrong pairing code rejected")

        status, vit = request(base, "GET", "/api/vitals", token=token)
        check(status == 200 and "cpu" in vit and "memory" in vit and "battery" in vit, "vitals snapshot shape")
        check(vit["disk"] and vit["disk"]["total"] > 0, "disk usage measured")
        status, procs = request(base, "GET", "/api/processes?limit=5", token=token)
        check(status == 200 and len(procs["processes"]) > 0, "process list returned")

        status, started = request(base, "POST", "/api/scan", {"deep": True}, token=token)
        check(status == 200 and started.get("id"), "scan started")
        for _ in range(300):
            status, state = request(base, "GET", "/api/scan", token=token)
            if state.get("status") in ("done", "error"):
                break
            time.sleep(0.1)
        check(state.get("status") == "done", "scan finished")
        result = state["result"]
        cats = {c["id"]: c for c in result["categories"]}
        check(result["reclaimable"] > 0, "reclaimable space found")
        check(cats.get("package-caches", {}).get("bytes", 0) > 0, "package-manager cache detected")
        check(cats.get("old-installers", {}).get("count") == 1, "only the old installer is suggested")
        check(cats.get("stale-node-modules", {}).get("count") == 1, "stale node_modules detected")
        check(all(c["why"] and c["after"] and c["safety"] in ("safe", "review") for c in result["categories"]),
              "every category explains why and what happens after")
        check(len(result["duplicates"]) == 1 and result["duplicates"][0]["keep"].endswith("report.pdf"),
              "exact duplicate found, oldest kept")
        all_paths = json.dumps(result)
        check("keep-me.txt" not in all_paths, "personal documents never offered for cleaning")

        safe_ids = [c["id"] for c in result["categories"] if c["safety"] == "safe" and c["bytes"] > 0]
        status, batch = request(base, "POST", "/api/clean",
                                {"categories": safe_ids, "mode": "vault", "label": "Safe junk"}, token=token)
        check(status == 200 and batch["items"], "safe categories moved to the Undo Vault")
        check(not os.path.exists(cache_probe), "cache item left its original place")
        check(batch["receipt"]["disk_free_before"] is not None, "receipt records measured disk space")

        status, again = request(base, "POST", "/api/clean", {"targets": ["deadbeef"], "mode": "free"}, token=token)
        check(status == 400, "unknown target ids are refused (no raw paths accepted)")

        status, vlist = request(base, "GET", "/api/vault", token=token)
        check(status == 200 and len(vlist["batches"]) == 1, "vault lists the batch")
        status, restored = request(base, "POST", "/api/vault/restore", {"batch": batch["id"]}, token=token)
        check(status == 200 and restored["restored"] == len(batch["items"]), "restore brings every item back")
        check(os.path.exists(cache_probe), "cache item is back where it was")

        # Re-scan, clean the duplicate copy, then purge for real.
        request(base, "POST", "/api/scan", {"deep": True}, token=token)
        for _ in range(300):
            status, state = request(base, "GET", "/api/scan", token=token)
            if state.get("status") == "done":
                break
            time.sleep(0.1)
        dup_ids = state["result"]["duplicates"][0]["copy_ids"]
        status, batch2 = request(base, "POST", "/api/clean", {"targets": dup_ids, "label": "Duplicates"}, token=token)
        check(status == 200 and len(batch2["items"]) == 1, "duplicate copy moved to vault")
        check(os.path.exists(os.path.join(home, "Documents", "report.pdf")), "original of the duplicate kept")
        status, purge = request(base, "POST", "/api/vault/purge", {"batch": batch2["id"]}, token=token)
        check(status == 200 and purge["kind"] == "purge", "purge deletes the batch for good")
        check(not os.listdir(os.path.join(data, "vault")), "vault is empty after purge")

        status, rec = request(base, "GET", "/api/receipts", token=token)
        kinds = [r["kind"] for r in rec["receipts"]]
        check({"clean", "restore", "purge"} <= set(kinds), "receipts kept for clean, restore and purge")

        for path in ("/api/baseline", "/api/drain", "/api/battery/forecast", "/api/startup", "/api/history",
                     "/api/pairing"):
            status, _ = request(base, "GET", path, token=token)
            check(status == 200, "GET %s" % path)
        status, ask = request(base, "POST", "/api/ask", {"message": "why is my laptop hot"}, token=token)
        check(status == 200 and "answer" in ask, "ask endpoint answers (local model optional)")

        status, _ = request(base, "GET", "/../server/server.py")
        check(status == 404, "static server blocks path traversal")
        status, page = request(base, "GET", "/api/process/quit", token=token)
        check(status == 404, "mutations are POST-only")
        status, q = request(base, "POST", "/api/process/quit", {"pid": 1}, token=token)
        check(status == 400, "system processes are protected from quitting")

        # Simple-mode "Fix everything" and opt-in automatic care.
        status, settings = request(base, "GET", "/api/settings", token=token)
        check(status == 200 and settings["auto_care"] is False, "automatic care is off until the user opts in")
        status, settings = request(base, "POST", "/api/settings", {"auto_care": True}, token=token)
        check(status == 200 and settings["auto_care"] and settings["next_auto_care"], "automatic care can be switched on")
        write(cache_probe + "-again" if os.path.isdir(os.path.dirname(cache_probe)) else cache_probe, 200_000)
        status, care = request(base, "POST", "/api/care", {"label": "Fix everything"}, token=token)
        check(status == 200 and "bytes" in care, "Fix everything runs a scan and cleans safe items")
        status, vlist = request(base, "GET", "/api/vault", token=token)
        check(any(b["label"] == "Fix everything" for b in vlist["batches"]) or care.get("bytes") == 0,
              "Fix everything lands in the Undo Vault")
        check(os.path.isfile(os.path.join(home, "Documents", "keep-me.txt")), "Fix everything never touches personal files")
        status, settings = request(base, "POST", "/api/settings", {"auto_care": False}, token=token)
        check(status == 200 and not settings["auto_care"], "automatic care can be switched off")

        # Phone access can be switched on/off at runtime from this computer.
        status, lan = request(base, "POST", "/api/lan", {"enable": True}, token=token)
        if status == 200 and lan.get("lan"):
            check(lan["pair_urls"] and lan["pair_urls"][0].endswith("#pair=" + lan["code"]), "phone access on: one-scan pairing link")
            status, off = request(base, "POST", "/api/lan", {"enable": False}, token=token)
            check(status == 200 and not off["lan"], "phone access can be turned off again")
        else:
            check(status == 400 and lan.get("error"), "no network: phone access explains why it can't start")
        status, pairing = request(base, "GET", "/api/pairing", token=token)
        check(status == 200 and "code" in pairing and "pair_urls" in pairing, "pairing info available")

        # Pairing with the shown code works once, then the code rotates.
        code = pairing["code"]
        status, paired = request(base, "POST", "/api/pair", {"code": code, "device": "test phone"})
        check(status == 200 and paired.get("token"), "pairing with the shown code succeeds")
        status, _ = request(base, "POST", "/api/pair", {"code": code, "device": "replay"})
        check(status == 403, "a pairing code cannot be reused")
        status, _ = request(base, "GET", "/api/vitals", token=paired.get("token"))
        check(status == 200, "paired device can read vitals")

        # Launching again while running just reports it (no second server, no error).
        second = subprocess.run([sys.executable, SERVER, "--port", str(port), "--home", home, "--data", data],
                                capture_output=True, text=True, timeout=20, env=env)
        check(second.returncode == 0 and "already running" in second.stdout, "second launch defers to the running agent")

        # Scheduler: weekly care only when opted in; low-storage alert at most once a day.
        os.environ["VITALS_NO_NOTIFY"] = "1"
        import server as server_mod
        import metrics as metrics_mod
        sched = server_mod.Agent(home, os.path.join(root, "sched"), sampler=False, scan_budget=10)
        check(sched.care_tick() in ([], ["low-disk-alert"]), "scheduler does nothing automatic until opted in")
        sched.update_settings({"auto_care": True})
        check("care" not in sched.care_tick(), "first automatic care waits about an hour after opting in")
        sched.settings["last_auto_care"] = time.time() - 8 * 86400
        check("care" in sched.care_tick(), "automatic care runs once a week")
        check("care" not in sched.care_tick(), "and not again right after")
        sched.settings["last_low_alert"] = 0  # the real disk may already have triggered it above
        real_disk = metrics_mod.disk
        metrics_mod.disk = lambda path: {"total": 100, "free": 2, "used": 98, "percent": 98}
        try:
            first = sched.care_tick()
            second = sched.care_tick()
        finally:
            metrics_mod.disk = real_disk
        check("low-disk-alert" in first and "low-disk-alert" not in second, "low-storage alert fires once per day, not repeatedly")

        # Direct unit checks of the vault guard.
        import vault as vault_mod
        guard = vault_mod.Vault(os.path.join(root, "guard"), home)
        for bad in (home, os.path.join(home, "Documents"), "/etc/hosts", os.path.join(root, "outside.txt")):
            try:
                guard.check_path(bad)
                check(False, "vault guard refuses %s" % bad)
            except vault_mod.VaultError:
                check(True, "vault guard refuses %s" % os.path.relpath(bad, root) if bad.startswith(root) else bad)
        status, _ = request(base, "POST", "/api/shutdown", {}, token=token)
        check(status == 200, "installer can stop the agent for updates")
        try:
            proc.wait(timeout=5)
            check(True, "agent exits after shutdown request")
        except subprocess.TimeoutExpired:
            check(False, "agent exits after shutdown request")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(root, ignore_errors=True)

    if FAILURES:
        print("\n%d check(s) failed" % len(FAILURES))
        sys.exit(1)
    print("\nAll checks passed")


if __name__ == "__main__":
    main()
