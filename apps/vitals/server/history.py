"""Local time-series memory: samples, personal baseline, drain attribution,
battery-wear forecast, folder growth and receipts. SQLite, stdlib only.

Nothing here leaves the machine. The value compounds with time: after a few
days Vitals knows what "normal" looks like for *this* device, which is what
lets it say "this is unusual for you" instead of quoting generic thresholds.
"""

import json
import math
import os
import sqlite3
import threading
import time

import metrics

RETENTION_DAYS = 30


class History:
    def __init__(self, data_dir):
        os.makedirs(data_dir, exist_ok=True)
        self.path = os.path.join(data_dir, "vitals.db")
        self.lock = threading.Lock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS samples(
                ts REAL PRIMARY KEY, cpu REAL, mem REAL, swap REAL, battery REAL,
                plugged INTEGER, disk_free REAL, idle REAL);
            CREATE TABLE IF NOT EXISTS proc_usage(
                ts REAL, name TEXT, cpu_seconds REAL, on_battery INTEGER, idle INTEGER);
            CREATE INDEX IF NOT EXISTS proc_usage_ts ON proc_usage(ts);
            CREATE TABLE IF NOT EXISTS battery_health(
                day TEXT PRIMARY KEY, health REAL, cycles INTEGER, full_capacity REAL);
            CREATE TABLE IF NOT EXISTS folder_sizes(ts REAL, path TEXT, bytes REAL);
            CREATE INDEX IF NOT EXISTS folder_sizes_path ON folder_sizes(path, ts);
            CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, ts REAL, body TEXT);
        """)
        self.db.commit()
        self._last_proc = {}

    # ---------------------------------------------------------- sampling
    def sample(self, snap, procs):
        """Store one snapshot plus per-process CPU-time deltas since last sample."""
        ts = snap["time"]
        battery = snap.get("battery") or {}
        mem = snap.get("memory") or {}
        on_battery = 1 if (battery.get("present") and battery.get("plugged") is False) else 0
        idle = snap.get("idle_seconds")
        is_idle = 1 if (idle is not None and idle > 300) else 0
        swap_pct = None
        if mem.get("swap_used") is not None and mem.get("total"):
            swap_pct = 100.0 * mem["swap_used"] / mem["total"]
        totals = {}
        for proc in procs:
            totals[proc["name"]] = totals.get(proc["name"], 0.0) + (proc.get("cpu_seconds") or 0.0)
        deltas = []
        for name, total in totals.items():
            previous = self._last_proc.get(name)
            if previous is not None and total >= previous:
                delta = total - previous
                if delta > 0.05:
                    deltas.append((ts, name, round(delta, 2), on_battery, is_idle))
        self._last_proc = totals
        deltas.sort(key=lambda row: row[2], reverse=True)
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?,?,?,?)",
                (ts, (snap.get("cpu") or {}).get("percent"), mem.get("percent"), swap_pct,
                 battery.get("percent"), None if battery.get("plugged") is None else int(bool(battery.get("plugged"))),
                 (snap.get("disk") or {}).get("free"), idle))
            self.db.executemany("INSERT INTO proc_usage VALUES (?,?,?,?,?)", deltas[:20])
            if battery.get("health_percent") is not None:
                day = time.strftime("%Y-%m-%d", time.localtime(ts))
                self.db.execute("INSERT OR REPLACE INTO battery_health VALUES (?,?,?,?)",
                                (day, battery["health_percent"], battery.get("cycles"),
                                 battery.get("full_capacity")))
            cutoff = ts - RETENTION_DAYS * 86400
            self.db.execute("DELETE FROM samples WHERE ts < ?", (cutoff,))
            self.db.execute("DELETE FROM proc_usage WHERE ts < ?", (cutoff,))
            self.db.commit()

    def series(self, hours=24, points=240):
        since = time.time() - hours * 3600
        with self.lock:
            rows = self.db.execute(
                "SELECT ts, cpu, mem, swap, battery, plugged, disk_free FROM samples WHERE ts >= ? ORDER BY ts",
                (since,)).fetchall()
        step = max(1, len(rows) // points)
        keys = ("ts", "cpu", "mem", "swap", "battery", "plugged", "disk_free")
        return [dict(zip(keys, row)) for row in rows[::step]]

    # ---------------------------------------------------------- baseline
    def baseline(self):
        """Compare the last 10 minutes with this device's normal for this hour."""
        now = time.time()
        hour = time.localtime(now).tm_hour
        with self.lock:
            rows = self.db.execute(
                "SELECT ts, cpu, mem FROM samples WHERE ts >= ? AND ts < ?",
                (now - 14 * 86400, now - 1800)).fetchall()
            recent = self.db.execute(
                "SELECT cpu, mem FROM samples WHERE ts >= ?", (now - 600,)).fetchall()
        profile = {"cpu": [[] for _ in range(24)], "mem": [[] for _ in range(24)]}
        for ts, cpu, mem in rows:
            h = time.localtime(ts).tm_hour
            if cpu is not None:
                profile["cpu"][h].append(cpu)
            if mem is not None:
                profile["mem"][h].append(mem)
        result = {"hour": hour, "samples": len(rows), "metrics": {}, "anomalies": []}
        for key in ("cpu", "mem"):
            hourly = [(sum(v) / len(v)) if v else None for v in profile[key]]
            bucket = profile[key][hour]
            values = [r[0 if key == "cpu" else 1] for r in recent if r[0 if key == "cpu" else 1] is not None]
            current = sum(values) / len(values) if values else None
            info = {"hourly": [round(x, 1) if x is not None else None for x in hourly],
                    "current": round(current, 1) if current is not None else None,
                    "learning": len(bucket) < 20}
            if not info["learning"] and current is not None:
                mean = sum(bucket) / len(bucket)
                var = sum((x - mean) ** 2 for x in bucket) / (len(bucket) - 1)
                std = max(math.sqrt(var), 3.0)  # floor so a very flat history is not twitchy
                z = (current - mean) / std
                info.update(mean=round(mean, 1), std=round(std, 1), z=round(z, 2))
                if z > 2.5:
                    result["anomalies"].append({
                        "metric": key, "z": round(z, 1), "current": round(current, 1), "normal": round(mean, 1),
                        "message": "%s is %.0f%% — your normal at %02d:00 is about %.0f%%." % (
                            "CPU" if key == "cpu" else "Memory", current, hour, mean)})
            result["metrics"][key] = info
        return result

    # ------------------------------------------------------------- drain
    def drain(self, hours=24):
        """Which processes burned the most CPU time, split by battery / idle."""
        since = time.time() - hours * 3600
        with self.lock:
            rows = self.db.execute(
                "SELECT name, SUM(cpu_seconds), SUM(cpu_seconds * on_battery), SUM(cpu_seconds * idle) "
                "FROM proc_usage WHERE ts >= ? GROUP BY name ORDER BY 2 DESC LIMIT 40", (since,)).fetchall()
            battery_samples = self.db.execute(
                "SELECT COUNT(*) FROM samples WHERE ts >= ? AND plugged = 0", (since,)).fetchone()[0]
            drain_rows = self.db.execute(
                "SELECT ts, battery FROM samples WHERE ts >= ? AND plugged = 0 AND battery IS NOT NULL ORDER BY ts",
                (since,)).fetchall()
        total = sum(r[1] for r in rows) or 1.0
        on_batt_total = sum(r[2] for r in rows) or 1.0
        processes = [{
            "name": name, "cpu_seconds": round(all_s, 1), "share": round(100 * all_s / total, 1),
            "battery_seconds": round(batt_s, 1), "battery_share": round(100 * batt_s / on_batt_total, 1),
            "idle_seconds": round(idle_s, 1),
        } for name, all_s, batt_s, idle_s in rows]
        idle_drainers = sorted((p for p in processes if p["idle_seconds"] > 30),
                               key=lambda p: p["idle_seconds"], reverse=True)[:6]
        rate = _drain_rate(drain_rows)
        return {"hours": hours, "battery_samples": battery_samples, "processes": processes[:15],
                "idle_drainers": idle_drainers, "percent_per_hour": rate}

    # ----------------------------------------------------------- battery
    def battery_forecast(self, current):
        with self.lock:
            rows = self.db.execute("SELECT day, health, cycles FROM battery_health ORDER BY day").fetchall()
        health = current.get("health_percent")
        cycles = current.get("cycles")
        out = {"health": health, "cycles": cycles, "points": [{"day": d, "health": h, "cycles": c} for d, h, c in rows],
               "method": None, "days_to_80": None, "date_to_80": None, "message": None}
        if health is None:
            out["message"] = "This device does not report battery wear."
            return out
        if health <= 80:
            out["method"] = "threshold"
            out["message"] = ("Holding %.0f%% of its design capacity — below the 80%% point most makers treat as worn. "
                              "Expect noticeably shorter runtime; a replacement restores it." % health)
            return out
        if len(rows) >= 2:
            first, last = rows[0], rows[-1]
            span = (time.mktime(time.strptime(last[0], "%Y-%m-%d")) - time.mktime(time.strptime(first[0], "%Y-%m-%d"))) / 86400
            if span >= 7:
                xs = [(time.mktime(time.strptime(d, "%Y-%m-%d")) - time.mktime(time.strptime(first[0], "%Y-%m-%d"))) / 86400 for d, _, _ in rows]
                ys = [h for _, h, _ in rows]
                slope = _slope(xs, ys)
                if slope < -1e-4:
                    days = (health - 80) / -slope
                    out.update(method="trend", days_to_80=int(days),
                               date_to_80=time.strftime("%Y-%m-%d", time.localtime(time.time() + days * 86400)))
                    out["message"] = "At your measured wear rate (%.2f%% per month) you reach 80%% around %s." % (
                        -slope * 30, out["date_to_80"])
                    return out
        if cycles:
            per_cycle = (100 - health) / max(cycles, 1)
            if per_cycle > 0:
                remaining_cycles = (health - 80) / per_cycle
                out.update(method="cycles")
                out["message"] = ("Estimate: about %d more charge cycles until 80%%, based on wear so far "
                                  "(%.1f%% lost over %d cycles). Vitals refines this as it logs real data." % (
                                      remaining_cycles, 100 - health, cycles))
                return out
        out["message"] = "Collecting data — a forecast appears after a week of logging."
        return out

    # ------------------------------------------------------------ growth
    def record_folder_sizes(self, sizes):
        """Store a folder-size snapshot and return the biggest movers vs the last one."""
        now = time.time()
        growth = []
        with self.lock:
            for path, info in sizes.items():
                previous = self.db.execute(
                    "SELECT ts, bytes FROM folder_sizes WHERE path = ? ORDER BY ts DESC LIMIT 1", (path,)).fetchone()
                if previous and info["complete"]:
                    delta = info["bytes"] - previous[1]
                    growth.append({"path": path, "bytes": info["bytes"], "delta": delta,
                                   "since": previous[0]})
                if info["complete"]:
                    self.db.execute("INSERT INTO folder_sizes VALUES (?,?,?)", (now, path, info["bytes"]))
            self.db.commit()
        if not growth:
            # First scan: show the largest folders so the user still sees something useful.
            return [{"path": p, "bytes": i["bytes"], "delta": None, "since": None}
                    for p, i in sorted(sizes.items(), key=lambda kv: kv[1]["bytes"], reverse=True)[:12]]
        growth.sort(key=lambda g: abs(g["delta"]), reverse=True)
        return growth[:12]

    # ---------------------------------------------------------- receipts
    def add_receipt(self, receipt):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO receipts VALUES (?,?,?)",
                            (receipt["id"], receipt["time"], json.dumps(receipt)))
            self.db.commit()

    def receipts(self, limit=50):
        with self.lock:
            rows = self.db.execute("SELECT body FROM receipts ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
        return [json.loads(r[0]) for r in rows]


def _slope(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den if den else 0.0


def _drain_rate(rows):
    """Average %/hour over continuous on-battery stretches (gaps > 10 min split them)."""
    if len(rows) < 2:
        return None
    used, hours = 0.0, 0.0
    for (t0, b0), (t1, b1) in zip(rows, rows[1:]):
        if t1 - t0 > 600 or b1 > b0:
            continue
        used += b0 - b1
        hours += (t1 - t0) / 3600
    return round(used / hours, 1) if hours > 0.05 else None


class Sampler(threading.Thread):
    """Background loop: sample every ``interval`` seconds and expire vault batches."""

    def __init__(self, history, home, vault=None, interval=30):
        super().__init__(daemon=True)
        self.history = history
        self.home = home
        self.vault = vault
        self.interval = interval
        self.latest = None
        self.latest_procs = []
        self.stop_event = threading.Event()

    def tick(self):
        snap = metrics.snapshot(self.home)
        procs = metrics.processes(limit=0)
        self.latest = snap
        self.latest_procs = procs
        self.history.sample(snap, procs)
        if self.vault:
            self.vault.expire()
        return snap

    def run(self):
        while not self.stop_event.is_set():
            try:
                self.tick()
            except Exception:
                pass
            self.stop_event.wait(self.interval)
