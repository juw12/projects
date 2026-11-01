"""App performance over adb: startup time, memory, frames/jank and CPU.

The metric set and the "measure a scenario, then judge it against a budget"
workflow follow SoloPi's performance tools (https://github.com/alipay/SoloPi,
Apache-2.0: CPU / memory / FPS / startup-time measurement on real devices).
Tether does it from the host with stock Android commands, so nothing has to be
installed on the phone:

  startup  `am start -W [-S]`                 TotalTime / WaitTime, COLD|WARM|HOT
  memory   `dumpsys meminfo <pkg>`            total PSS, Java and native heap
  frames   `dumpsys gfxinfo <pkg> [reset]`    frames, janky %, 50/90/95/99th pct
  cpu      /proc/stat + /proc/<pid>/stat      app share over a short window

Flow steps (see flows.py): perf_startup, perf_reset, perf_assert.
"""

from __future__ import annotations

import re
import statistics

from adb import Adb, AdbError, _check_package

STARTUP_FIELDS = {"TotalTime": "total_ms", "WaitTime": "wait_ms"}
BUDGET_KEYS = {
    "max_pss_mb": ("memory", "pss_mb"),
    "max_jank_percent": ("frames", "jank_percent"),
    "max_p90_ms": ("frames", "p90_ms"),
    "max_p99_ms": ("frames", "p99_ms"),
    "max_cpu_percent": ("cpu", "percent"),
}


class PerfBudgetError(AdbError):
    """A measurement exceeded its budget (fails the flow step)."""


# ------------------------------------------------------------------ parsing
def parse_am_start(text: str) -> dict:
    if "Error" in text and "Status: ok" not in text:
        lines = text.splitlines()
        line = next((l for l in lines if l.strip().startswith("Error:")),
                    next((l for l in lines if "Error" in l), text.strip()))
        raise AdbError(line.strip()[:300])
    result: dict = {}
    for line in text.splitlines():
        key, _, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if key in STARTUP_FIELDS and value.isdigit():
            result[STARTUP_FIELDS[key]] = int(value)
        elif key == "LaunchState":
            result["launch_state"] = value
        elif key == "Status":
            result["status"] = value
    if "total_ms" not in result and "wait_ms" not in result:
        raise AdbError("am start -W reported no timing (is the activity exported and launchable?)")
    if result.get("status", "ok") != "ok":
        raise AdbError(f"launch status: {result['status']}")
    return result


def parse_meminfo(text: str) -> dict:
    if "No process found" in text:
        raise AdbError("app is not running — launch it before measuring memory")
    match = re.search(r"TOTAL PSS:\s+(\d+)", text) or re.search(r"^\s*TOTAL\s+(\d+)", text, re.M)
    if not match:
        raise AdbError("could not read memory from dumpsys meminfo")
    result = {"pss_mb": round(int(match.group(1)) / 1024, 1)}
    for label, key in (("Java Heap", "java_heap_mb"), ("Native Heap", "native_heap_mb"), ("Graphics", "graphics_mb")):
        found = re.search(label + r":\s+(\d+)", text)
        if found:
            result[key] = round(int(found.group(1)) / 1024, 1)
    rss = re.search(r"TOTAL RSS:\s+(\d+)", text)
    if rss:
        result["rss_mb"] = round(int(rss.group(1)) / 1024, 1)
    return result


def parse_gfxinfo(text: str) -> dict:
    if "No process found" in text:
        raise AdbError("app is not running — launch it before measuring frames")
    total = re.search(r"^\s*Total frames rendered:\s+(\d+)", text, re.M)
    if not total:
        raise AdbError("could not read frame stats from dumpsys gfxinfo")
    result: dict = {"frames": int(total.group(1))}
    janky = re.search(r"^\s*Janky frames:\s+(\d+)\s+\(([\d.]+)%\)", text, re.M)
    if janky:
        result["janky_frames"] = int(janky.group(1))
        result["jank_percent"] = float(janky.group(2))
    for pct in (50, 90, 95, 99):
        found = re.search(rf"^\s*{pct}th percentile:\s+(\d+)ms", text, re.M)
        if found:
            result[f"p{pct}_ms"] = int(found.group(1))
    return result


def _cpu_totals(block: str) -> tuple[int, int, int]:
    """(total jiffies, cores, app jiffies) from `cat /proc/stat /proc/<pid>/stat`."""
    total = cores = app = None
    core_count = 0
    for line in block.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "cpu":
            total = sum(int(v) for v in parts[1:9])
        elif re.fullmatch(r"cpu\d+", parts[0]):
            core_count += 1
        elif ")" in line:
            rest = line[line.rfind(")") + 1:].split()
            app = int(rest[11]) + int(rest[12])  # utime + stime (fields 14, 15)
    cores = max(core_count, 1)
    if total is None or app is None:
        raise AdbError("could not read /proc/stat for CPU usage")
    return total, cores, app


def parse_cpu_window(text: str) -> dict:
    before, sep, after = text.partition("===TETHER===")
    if not sep:
        raise AdbError("could not sample CPU usage")
    total_a, cores, app_a = _cpu_totals(before)
    total_b, _, app_b = _cpu_totals(after)
    elapsed = max(total_b - total_a, 1)
    device_share = max(app_b - app_a, 0) / elapsed * 100
    return {
        "percent": round(device_share, 1),  # share of the whole device (0-100)
        "core_percent": round(device_share * cores, 1),  # top-style, 100 = one full core
        "cores": cores,
    }


# -------------------------------------------------------------- measuring
def launcher_component(adb: Adb, serial: str, package: str) -> str:
    _check_package(package)
    out = adb.shell(serial, "cmd", "package", "resolve-activity", "--brief",
                    "-c", "android.intent.category.LAUNCHER", package)
    lines = [line.strip() for line in out.splitlines() if "/" in line]
    if not lines:
        raise AdbError(f"{package} has no launcher activity")
    return lines[-1]


def startup(adb: Adb, serial: str, package: str, cold: bool = True, runs: int = 1,
            activity: str | None = None) -> dict:
    """Launch time like SoloPi's startup tool; cold = process killed first (`am start -S`)."""
    runs = max(1, min(int(runs), 10))
    component = activity or launcher_component(adb, serial, package)
    if not re.fullmatch(r"[\w.]+/[\w.$]+", component):
        raise AdbError(f"invalid activity {component!r}")
    samples = []
    for _ in range(runs):
        if not cold:
            adb.key(serial, "home")
        args = ["am", "start", "-W"] + (["-S"] if cold else []) + ["-n", component]
        samples.append(parse_am_start(adb.shell(serial, *args, timeout=60)))
    totals = [s.get("total_ms", s.get("wait_ms", 0)) for s in samples]
    return {
        "package": package,
        "component": component,
        "mode": "cold" if cold else "warm",
        "launch_state": samples[-1].get("launch_state", ""),
        "runs": len(samples),
        "total_ms": round(statistics.median(totals)),
        "min_ms": min(totals),
        "max_ms": max(totals),
        "samples": totals,
    }


def memory(adb: Adb, serial: str, package: str) -> dict:
    _check_package(package)
    return parse_meminfo(adb.shell(serial, "dumpsys", "meminfo", package, timeout=30))


def frames(adb: Adb, serial: str, package: str) -> dict:
    _check_package(package)
    return parse_gfxinfo(adb.shell(serial, "dumpsys", "gfxinfo", package, timeout=30))


def reset_frames(adb: Adb, serial: str, package: str) -> None:
    """Start a fresh frame window: later frames() calls cover only what happened since."""
    _check_package(package)
    adb.shell(serial, "dumpsys", "gfxinfo", package, "reset", timeout=30)


def cpu(adb: Adb, serial: str, package: str, window_s: float = 1.0) -> dict:
    _check_package(package)
    pids = sorted(adb.pids_of(serial, package))
    if not pids:
        raise AdbError("app is not running — launch it before measuring CPU")
    window = max(0.2, min(float(window_s), 10.0))
    pid = pids[0]
    script = (f"cat /proc/stat /proc/{pid}/stat; echo ===TETHER===; sleep {window:g}; "
              f"cat /proc/stat /proc/{pid}/stat")
    result = parse_cpu_window(adb.shell(serial, script, timeout=window + 20))
    result["window_s"] = window
    result["pid"] = pid
    return result


def snapshot(adb: Adb, serial: str, package: str, cpu_window_s: float = 1.0,
             include: tuple[str, ...] = ("memory", "frames", "cpu")) -> dict:
    result: dict = {"package": package}
    if "memory" in include:
        result["memory"] = memory(adb, serial, package)
    if "frames" in include:
        result["frames"] = frames(adb, serial, package)
    if "cpu" in include:
        result["cpu"] = cpu(adb, serial, package, cpu_window_s)
    return result


def check_budgets(measured: dict, budgets: dict) -> list[str]:
    """Human-readable list of exceeded budgets (empty = within budget)."""
    problems = []
    for key, limit in budgets.items():
        if key not in BUDGET_KEYS or limit is None:
            continue
        group, field = BUDGET_KEYS[key]
        value = measured.get(group, {}).get(field)
        if value is None:
            problems.append(f"{field} not available on this device (budget {key}={limit})")
        elif value > float(limit):
            problems.append(f"{field} {value} > {limit}")
    return problems


def budget_groups(budgets: dict) -> tuple[str, ...]:
    return tuple(sorted({BUDGET_KEYS[k][0] for k in budgets if k in BUDGET_KEYS}))
