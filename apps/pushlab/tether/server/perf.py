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

Deeper evidence, also from stock tooling:

  trace    Perfetto (https://perfetto.dev, Apache-2.0) system traces via the
           on-device `perfetto` binary (Android 9+), pulled to reports/ as a
           .pftrace you open in https://ui.perfetto.dev
  leaks    LeakCanary (https://square.github.io/leakcanary, Apache-2.0) heap
           analysis results read back from logcat — the app's debug build has
           to include leakcanary-android; Tether only reads what it logs.

Flow steps: perf_trace_start, perf_trace_stop, leak_mark, assert_no_leaks.
"""

from __future__ import annotations

import os
import re
import statistics
import threading
import time
from pathlib import Path

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


# ------------------------------------------------------------ Perfetto trace
TRACE_REMOTE_DIR = "/data/misc/perfetto-traces"
TRACE_CATEGORIES = ("sched", "freq", "idle", "am", "wm", "gfx", "view", "binder_driver", "hal",
                    "dalvik", "input", "res")
PERFETTO_UI = "https://ui.perfetto.dev"
_traces: dict[str, dict] = {}  # serial -> running trace
_traces_lock = threading.Lock()


def reports_dir() -> Path:
    """Where pulled traces go: TETHER_REPORTS_DIR or tether/reports/ (git-ignored)."""
    configured = os.environ.get("TETHER_REPORTS_DIR")
    path = Path(configured) if configured else Path(__file__).resolve().parent.parent / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def active_trace(serial: str) -> dict | None:
    with _traces_lock:
        trace = _traces.get(serial)
        return dict(trace) if trace else None


def trace_start(adb: Adb, serial: str, package: str | None = None, max_seconds: float = 30,
                buffer_mb: int = 32, keep: str = "always") -> dict:
    """Start a background Perfetto trace (atrace categories + sched/freq); stop with trace_stop."""
    if package:
        _check_package(package)
    if keep not in ("always", "on_fail"):
        raise AdbError("keep must be 'always' or 'on_fail'")
    seconds = max(1, min(int(max_seconds), 600))
    buffer_mb = max(4, min(int(buffer_mb), 256))
    with _traces_lock:
        if serial in _traces:
            raise AdbError("a Perfetto trace is already recording on this device")
        _traces[serial] = {"starting": True}
    try:
        remote = f"{TRACE_REMOTE_DIR}/tether-{int(time.time() * 1000)}.pftrace"
        args = ["perfetto", "--background", "-o", remote, "-t", f"{seconds}s", "-b", f"{buffer_mb}mb"]
        if package:
            args += ["-a", package]
        try:
            out = adb.shell(serial, *args, *TRACE_CATEGORIES, timeout=30)
        except AdbError as exc:
            raise AdbError(f"perfetto could not start (Android 9+ needed): {exc}") from exc
        pids = re.findall(r"^\s*(\d+)\s*$", out, re.M)
        if not pids:
            raise AdbError("perfetto did not start (Android 9+ needed): " + (out.strip()[:200] or "no output"))
        trace = {"pid": int(pids[-1]), "remote": remote, "package": package, "max_seconds": seconds,
                 "keep": keep, "started": time.time()}
    except Exception:
        with _traces_lock:
            _traces.pop(serial, None)
        raise
    with _traces_lock:
        _traces[serial] = trace
    return {k: trace[k] for k in ("pid", "remote", "package", "max_seconds", "keep")}


def trace_stop(adb: Adb, serial: str, keep: bool = True, name: str | None = None) -> dict:
    """Stop the running trace; pull it to reports/ (keep=True) or just discard it."""
    with _traces_lock:
        trace = _traces.pop(serial, None)
    if not trace or "pid" not in trace:
        raise AdbError("no Perfetto trace is recording on this device")
    pid = trace["pid"]
    adb.run(["shell", "kill", "-TERM", str(pid)], serial=serial, check=False)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:  # perfetto flushes and writes the file before exiting
        state = adb.shell(serial, f"kill -0 {pid} 2>/dev/null && echo alive || echo gone").strip()
        if state.endswith("gone"):
            break
        time.sleep(0.3)
    result = {"seconds": round(time.time() - trace["started"], 1), "package": trace["package"]}
    try:
        if keep:
            safe_serial = re.sub(r"[^\w.-]", "_", serial)
            safe_name = re.sub(r"[^\w.-]", "_", name or "trace")[:60]
            local = reports_dir() / f"{safe_name}-{safe_serial}-{time.strftime('%Y%m%d-%H%M%S')}.pftrace"
            adb.run(["pull", trace["remote"], str(local)], serial=serial, timeout=120)
            result.update({"path": str(local), "bytes": local.stat().st_size, "open": PERFETTO_UI})
        else:
            result["discarded"] = True
    finally:
        try:
            adb.shell(serial, "rm", "-f", trace["remote"])
        except AdbError:
            pass
    return result


def trace(adb: Adb, serial: str, seconds: float = 10, package: str | None = None) -> dict:
    """Record a trace for a fixed time (foreground) and pull it."""
    seconds = max(1.0, min(float(seconds), 120.0))
    trace_start(adb, serial, package, max_seconds=seconds + 30)
    time.sleep(seconds)
    return trace_stop(adb, serial, keep=True, name=f"trace-{package}" if package else "trace")


def finish_flow_trace(adb: Adb, serial: str, failed: bool, name: str) -> dict | None:
    """Called at the end of a flow: stop a trace the flow left running (kept if asked or on failure)."""
    current = active_trace(serial)
    if not current or "pid" not in current:
        return None
    keep = current.get("keep") == "always" or failed
    try:
        return trace_stop(adb, serial, keep=keep, name=name)
    except AdbError as exc:
        return {"error": str(exc)}


# ------------------------------------------------------------- LeakCanary
LEAKCANARY_TAG = "LeakCanary"
_leak_marks: dict[str, str] = {}


def device_epoch(adb: Adb, serial: str) -> str:
    """Device clock as 'seconds.millis' — the form `logcat -T` accepts."""
    out = adb.shell(serial, "date", "+%s").strip()
    if not out.isdigit():
        raise AdbError(f"could not read the device clock ({out[:80]!r})")
    return f"{out}.000"


def leak_mark(adb: Adb, serial: str) -> str:
    """Only LeakCanary results logged after this point count for assert_no_leaks."""
    mark = device_epoch(adb, serial)
    _leak_marks[serial] = mark
    return mark


def parse_leakcanary(messages: list[str]) -> dict:
    """Summarise LeakCanary's 'HEAP ANALYSIS RESULT' blocks (one log message per line)."""
    analyses: list[dict] = []
    current: dict | None = None
    section = None
    for message in messages:
        text = message.strip().lstrip("\u200b").strip()
        if "HEAP ANALYSIS RESULT" in text or "HEAP ANALYSIS FAILED" in text:
            current = {"application_leaks": 0, "library_leaks": 0, "retained_bytes": 0, "leaks": [],
                       "failed": "FAILED" in text}
            analyses.append(current)
            section = None
            continue
        if current is None:
            continue
        found = re.match(r"^(\d+)\s+(APPLICATION|LIBRARY)\s+LEAKS?\b", text)
        if found:
            section = found.group(2).lower()
            current[f"{section}_leaks"] = int(found.group(1))
            continue
        if re.match(r"^\d+\s+UNREACHABLE OBJECTS?\b", text) or text.startswith("METADATA"):
            section = None
            continue
        found = re.match(r"^(\d+)\s+bytes retained", text)
        if found:
            current["retained_bytes"] += int(found.group(1))
            continue
        found = re.match(r"^\u2570\u2192\s*(\S+)\s+(instance|class|array)", text)
        if found and section:
            current["leaks"].append({"class": found.group(1), "kind": section})
    application = sum(a["application_leaks"] for a in analyses)
    library = sum(a["library_leaks"] for a in analyses)
    classes = []
    for analysis in analyses:
        for leak in analysis["leaks"]:
            if leak not in classes:
                classes.append(leak)
    return {
        "analyses": len(analyses),
        "failed_analyses": sum(1 for a in analyses if a["failed"]),
        "application_leaks": application,
        "library_leaks": library,
        "retained_bytes": sum(a["retained_bytes"] for a in analyses),
        "leaks": classes,
    }


def leaks(adb: Adb, serial: str, since: str | None = None) -> dict:
    """LeakCanary results from logcat (all buffered, or since a leak_mark / epoch 'sss.mmm')."""
    args = ["logcat", "-d", "-v", "threadtime"]
    if since:
        if not re.fullmatch(r"\d{1,12}(\.\d{1,9})?", str(since)):
            raise AdbError("since must be device epoch seconds like 1730419200.000")
        args += ["-T", str(since)]
    args += ["-s", f"{LEAKCANARY_TAG}:*"]
    text = adb.run(args, serial=serial, timeout=30).decode("utf-8", "replace")
    messages = [m.group(1) for m in re.finditer(r"^\d\d-\d\d\s+\S+\s+\d+\s+\d+\s+\w\s+LeakCanary\s*: ?(.*)$",
                                                text, re.M)]
    result = parse_leakcanary(messages)
    result["since"] = since
    return result


def assert_no_leaks(adb: Adb, serial: str, max_leaks: int = 0, include_library: bool = False,
                    wait_ms: int = 0, require_analysis: bool = False, since: str | None = None) -> dict:
    since = since or _leak_marks.get(serial)
    deadline = time.monotonic() + max(0, min(int(wait_ms), 600000)) / 1000
    while True:
        result = leaks(adb, serial, since)
        count = result["application_leaks"] + (result["library_leaks"] if include_library else 0)
        if count > max_leaks:
            names = ", ".join(leak["class"] for leak in result["leaks"]
                              if include_library or leak["kind"] == "application") or "see LeakCanary in logcat"
            raise PerfBudgetError(f"{count} leak(s) > {max_leaks}: {names} "
                                  f"({result['retained_bytes']} bytes retained)")
        if result["analyses"] or time.monotonic() >= deadline:
            break
        time.sleep(1)
    if require_analysis and not result["analyses"]:
        raise PerfBudgetError("LeakCanary logged no heap analysis (is leakcanary-android in this debug build, "
                              "and did the flow destroy the screen it watches?)")
    result["counted"] = count
    return result
