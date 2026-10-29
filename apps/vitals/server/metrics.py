"""Cross-platform system metrics using only the Python standard library.

psutil is used when it happens to be installed (it is faster and more precise),
but nothing here requires it. Every reader is best-effort: a metric that the
platform cannot provide comes back as ``None`` instead of raising.
"""

import ctypes
import os
import platform
import re
import shutil
import socket
import subprocess
import time

try:  # optional accelerator, never required
    import psutil  # type: ignore
except Exception:  # pragma: no cover - depends on the machine
    psutil = None

SYSTEM = platform.system()  # "Darwin", "Windows", "Linux"
IS_MAC = SYSTEM == "Darwin"
IS_WIN = SYSTEM == "Windows"
IS_LINUX = SYSTEM == "Linux"

# Processes the agent will never offer to quit, whatever the user asks.
PROTECTED_PROCESSES = {
    "kernel_task", "launchd", "windowserver", "loginwindow", "finder", "dock",
    "systemuiserver", "controlcenter", "coreaudiod", "mds", "mds_stores",
    "explorer.exe", "svchost.exe", "csrss.exe", "wininit.exe", "winlogon.exe",
    "lsass.exe", "services.exe", "smss.exe", "dwm.exe", "system", "registry",
    "systemd", "init", "xorg", "gnome-shell", "kwin_x11", "kwin_wayland",
}


def run(cmd, timeout=6):
    """Run a command and return stdout ('' on any failure)."""
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=0x08000000 if IS_WIN else 0,  # CREATE_NO_WINDOW
        )
        return out.stdout or ""
    except (OSError, subprocess.SubprocessError, ValueError):
        return ""


def cpu_count():
    return os.cpu_count() or 1


# --------------------------------------------------------------------------- CPU

_last_cpu_times = None


def _windows_cpu_percent():
    global _last_cpu_times

    class FILETIME(ctypes.Structure):
        _fields_ = [("low", ctypes.c_uint32), ("high", ctypes.c_uint32)]

    idle, kernel, user = FILETIME(), FILETIME(), FILETIME()
    if not ctypes.windll.kernel32.GetSystemTimes(  # type: ignore[attr-defined]
        ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)
    ):
        return None

    def as_int(ft):
        return (ft.high << 32) | ft.low

    now = (as_int(idle), as_int(kernel), as_int(user))
    previous = _last_cpu_times
    _last_cpu_times = now
    if previous is None:
        time.sleep(0.25)
        return _windows_cpu_percent()
    d_idle = now[0] - previous[0]
    d_total = (now[1] - previous[1]) + (now[2] - previous[2])  # kernel includes idle
    if d_total <= 0:
        return None
    return round(max(0.0, min(100.0, 100.0 * (1 - d_idle / d_total))), 1)


def _linux_cpu_percent():
    global _last_cpu_times
    try:
        with open("/proc/stat", encoding="ascii") as handle:
            fields = [int(x) for x in handle.readline().split()[1:]]
    except OSError:
        return None
    idle = fields[3] + (fields[4] if len(fields) > 4 else 0)
    total = sum(fields)
    previous = _last_cpu_times
    _last_cpu_times = (idle, total)
    if previous is None:
        time.sleep(0.25)
        return _linux_cpu_percent()
    d_total = total - previous[1]
    if d_total <= 0:
        return None
    return round(100.0 * (1 - (idle - previous[0]) / d_total), 1)


def cpu_percent():
    if psutil:
        return psutil.cpu_percent(interval=0.2)
    if IS_WIN:
        return _windows_cpu_percent()
    if IS_LINUX:
        return _linux_cpu_percent()
    if IS_MAC:
        # `ps` %cpu is a short decaying average per process; summing and dividing
        # by the core count gives a stable machine-wide figure without the 1 s
        # wait that `top -l 2` needs.
        out = run(["ps", "-A", "-o", "%cpu="])
        total = 0.0
        for line in out.split():
            try:
                total += float(line.replace(",", "."))
            except ValueError:
                pass
        return round(min(100.0, total / cpu_count()), 1)
    return None


def load_average():
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except (OSError, AttributeError):
        return None


# ------------------------------------------------------------------------ Memory

def memory():
    """Return total/used/available bytes, percent and a pressure label."""
    info = {"total": None, "used": None, "available": None, "percent": None,
            "swap_used": None, "swap_total": None, "pressure": None}
    if psutil:
        vm = psutil.virtual_memory()
        sw = psutil.swap_memory()
        info.update(total=vm.total, used=vm.total - vm.available,
                    available=vm.available, percent=vm.percent,
                    swap_used=sw.used, swap_total=sw.total)
    elif IS_MAC:
        total = int(run(["sysctl", "-n", "hw.memsize"]).strip() or 0)
        vm = run(["vm_stat"])
        page = 4096
        match = re.search(r"page size of (\d+) bytes", vm)
        if match:
            page = int(match.group(1))

        def pages(label):
            m = re.search(r"%s:\s+(\d+)" % re.escape(label), vm)
            return int(m.group(1)) * page if m else 0

        # Activity Monitor's "Memory Used" = app memory + wired + compressed.
        app_memory = pages("Anonymous pages") - pages("Pages purgeable")
        if app_memory <= 0:
            app_memory = pages("Pages active")
        used = app_memory + pages("Pages wired down") + pages("Pages occupied by compressor")
        used = min(used, total) if total else used
        info.update(total=total or None, used=used,
                    available=(total - used) if total else None,
                    percent=round(100.0 * used / total, 1) if total else None)
        swap = run(["sysctl", "-n", "vm.swapusage"])
        m_total = re.search(r"total = ([\d.]+)M", swap)
        m_used = re.search(r"used = ([\d.]+)M", swap)
        if m_total and m_used:
            info["swap_total"] = int(float(m_total.group(1)) * 1048576)
            info["swap_used"] = int(float(m_used.group(1)) * 1048576)
    elif IS_WIN:
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

        stat = MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):  # type: ignore[attr-defined]
            info.update(total=stat.ullTotalPhys, available=stat.ullAvailPhys,
                        used=stat.ullTotalPhys - stat.ullAvailPhys,
                        percent=float(stat.dwMemoryLoad),
                        swap_total=max(0, stat.ullTotalPageFile - stat.ullTotalPhys),
                        swap_used=max(0, (stat.ullTotalPageFile - stat.ullAvailPageFile)
                                      - (stat.ullTotalPhys - stat.ullAvailPhys)))
    elif IS_LINUX:
        values = {}
        try:
            with open("/proc/meminfo", encoding="ascii") as handle:
                for line in handle:
                    key, _, rest = line.partition(":")
                    values[key] = int(rest.split()[0]) * 1024
        except OSError:
            values = {}
        total = values.get("MemTotal")
        available = values.get("MemAvailable")
        if total and available is not None:
            info.update(total=total, available=available, used=total - available,
                        percent=round(100.0 * (total - available) / total, 1),
                        swap_total=values.get("SwapTotal"),
                        swap_used=(values.get("SwapTotal", 0) - values.get("SwapFree", 0)))
    info["pressure"] = memory_pressure_label(info)
    return info


def memory_pressure_label(info):
    """'normal' / 'elevated' / 'high' from RAM use and how hard swap is working."""
    percent = info.get("percent")
    if percent is None:
        return None
    swap_ratio = 0.0
    if info.get("swap_used") and info.get("total"):
        swap_ratio = info["swap_used"] / info["total"]
    if percent > 92 or swap_ratio > 0.5:
        return "high"
    if percent > 80 or swap_ratio > 0.2:
        return "elevated"
    return "normal"


# -------------------------------------------------------------------------- Disk

def disk(path):
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None
    return {
        "path": str(path),
        "total": usage.total,
        "used": usage.used,
        "free": usage.free,
        "percent": round(100.0 * usage.used / usage.total, 1) if usage.total else None,
    }


# ----------------------------------------------------------------------- Battery

def _num(pattern, text):
    match = re.search(pattern, text)
    return int(match.group(1)) if match else None


def battery():
    """Charge, power source and — where the OS exposes it — wear and cycles."""
    info = {"present": False, "percent": None, "plugged": None, "charging": None,
            "minutes_left": None, "cycles": None, "design_capacity": None,
            "full_capacity": None, "health_percent": None, "condition": None,
            "source": None}
    if IS_MAC:
        batt = run(["pmset", "-g", "batt"])
        match = re.search(r"(\d+)%;\s*([^;]+);\s*([^\s]+)", batt)
        if match:
            info["present"] = True
            info["percent"] = int(match.group(1))
            state = match.group(2).strip().lower()
            info["charging"] = state == "charging"
            info["plugged"] = "AC Power" in batt
            remaining = re.search(r"(\d+):(\d+) remaining", batt)
            if remaining and not info["plugged"]:
                info["minutes_left"] = int(remaining.group(1)) * 60 + int(remaining.group(2))
        ioreg = run(["ioreg", "-rn", "AppleSmartBattery"])
        design = _num(r'"DesignCapacity" = (\d+)', ioreg)
        full = _num(r'"AppleRawMaxCapacity" = (\d+)', ioreg) or _num(r'"NominalChargeCapacity" = (\d+)', ioreg)
        cycles = _num(r'"CycleCount" = (\d+)', ioreg)
        if design and full:
            info.update(design_capacity=design, full_capacity=full,
                        health_percent=round(100.0 * full / design, 1))
        info["cycles"] = cycles
        info["source"] = "pmset + ioreg (mAh)"
    elif IS_WIN:
        class SYSTEM_POWER_STATUS(ctypes.Structure):
            _fields_ = [("ACLineStatus", ctypes.c_ubyte), ("BatteryFlag", ctypes.c_ubyte),
                        ("BatteryLifePercent", ctypes.c_ubyte), ("SystemStatusFlag", ctypes.c_ubyte),
                        ("BatteryLifeTime", ctypes.c_ulong), ("BatteryFullLifeTime", ctypes.c_ulong)]

        status = SYSTEM_POWER_STATUS()
        if ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):  # type: ignore[attr-defined]
            if status.BatteryFlag != 128 and status.BatteryLifePercent != 255:
                info["present"] = True
                info["percent"] = int(status.BatteryLifePercent)
                info["plugged"] = status.ACLineStatus == 1
                info["charging"] = bool(status.BatteryFlag & 8)
                if status.BatteryLifeTime not in (0xFFFFFFFF, 4294967295):
                    info["minutes_left"] = int(status.BatteryLifeTime // 60)
        if info["present"]:
            ps = run(["powershell", "-NoProfile", "-Command",
                      "$d=(Get-CimInstance -Namespace root\\wmi -ClassName BatteryStaticData).DesignedCapacity;"
                      "$f=(Get-CimInstance -Namespace root\\wmi -ClassName BatteryFullChargedCapacity).FullChargedCapacity;"
                      "$c=(Get-CimInstance -Namespace root\\wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue).CycleCount;"
                      "Write-Output \"$d|$f|$c\""], timeout=10)
            parts = (ps.strip().splitlines() or [""])[-1].split("|")
            try:
                design, full = int(parts[0]), int(parts[1])
                if design and full:
                    info.update(design_capacity=design, full_capacity=full,
                                health_percent=round(100.0 * full / design, 1))
                if len(parts) > 2 and parts[2].strip():
                    info["cycles"] = int(parts[2])
            except (ValueError, IndexError):
                pass
        info["source"] = "GetSystemPowerStatus + WMI (mWh)"
    elif IS_LINUX:
        base = "/sys/class/power_supply"
        names = sorted(n for n in (os.listdir(base) if os.path.isdir(base) else []) if n.startswith("BAT"))
        if names:
            bat = os.path.join(base, names[0])

            def read(name):
                try:
                    with open(os.path.join(bat, name), encoding="ascii") as handle:
                        return handle.read().strip()
                except OSError:
                    return None

            info["present"] = True
            cap = read("capacity")
            info["percent"] = int(cap) if cap and cap.isdigit() else None
            status = (read("status") or "").lower()
            info["charging"] = status == "charging"
            info["plugged"] = status in ("charging", "full", "not charging")
            full = read("energy_full") or read("charge_full")
            design = read("energy_full_design") or read("charge_full_design")
            cycles = read("cycle_count")
            if full and design and full.isdigit() and design.isdigit() and int(design):
                info.update(design_capacity=int(design), full_capacity=int(full),
                            health_percent=round(100.0 * int(full) / int(design), 1))
            if cycles and cycles.isdigit() and int(cycles) > 0:
                info["cycles"] = int(cycles)
            info["source"] = "/sys/class/power_supply"
    if psutil and not info["present"]:
        try:
            b = psutil.sensors_battery()
        except Exception:
            b = None
        if b:
            info.update(present=True, percent=round(b.percent), plugged=b.power_plugged)
    health = info.get("health_percent")
    if health is not None:
        info["condition"] = ("good" if health >= 85 else "fair" if health >= 80
                             else "service soon" if health >= 70 else "replace")
    return info


# ------------------------------------------------------------------- Idle time

def idle_seconds():
    """Seconds since the last keyboard/mouse input (None if unknown)."""
    if IS_MAC:
        out = run(["ioreg", "-c", "IOHIDSystem"])
        match = re.search(r'"HIDIdleTime" = (\d+)', out)
        return int(match.group(1)) / 1e9 if match else None
    if IS_WIN:
        class LASTINPUTINFO(ctypes.Structure):
            _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):  # type: ignore[attr-defined]
            return (ctypes.windll.kernel32.GetTickCount() - info.dwTime) / 1000.0  # type: ignore[attr-defined]
    return None


# --------------------------------------------------------------------- Processes

def _parse_cputime(text):
    """Parse ps TIME ([[dd-]hh:]mm:ss[.xx]) into seconds."""
    text = text.strip()
    days = 0
    if "-" in text:
        day_part, text = text.split("-", 1)
        days = int(day_part or 0)
    parts = [float(p.replace(",", ".")) for p in text.split(":") if p]
    seconds = 0.0
    for part in parts:
        seconds = seconds * 60 + part
    return days * 86400 + seconds


def processes(limit=25):
    """Top processes by CPU with memory and cumulative CPU seconds."""
    rows = []
    me = os.getpid()
    if psutil:
        for proc in psutil.process_iter(["pid", "name", "username", "memory_info", "cpu_times"]):
            try:
                cpu = proc.cpu_percent(interval=None)
                times = proc.info["cpu_times"]
                rows.append({
                    "pid": proc.info["pid"], "name": proc.info["name"] or "?",
                    "user": proc.info["username"] or "",
                    "cpu": round(cpu / cpu_count(), 1),
                    "rss": proc.info["memory_info"].rss if proc.info["memory_info"] else 0,
                    "cpu_seconds": round((times.user + times.system) if times else 0.0, 1),
                })
            except Exception:
                continue
    elif IS_WIN:
        out = run(["tasklist", "/fo", "csv", "/nh", "/v"], timeout=10)
        for line in out.splitlines():
            cols = [c.strip('"') for c in line.split('","')]
            if len(cols) < 8:
                continue
            try:
                rss = int(re.sub(r"[^\d]", "", cols[4]) or 0) * 1024
                cpu_seconds = _parse_cputime(cols[7]) if ":" in cols[7] else 0.0
                rows.append({"pid": int(cols[1]), "name": cols[0], "user": cols[6],
                             "cpu": None, "rss": rss, "cpu_seconds": cpu_seconds})
            except (ValueError, IndexError):
                continue
    else:
        out = run(["ps", "-Ao", "pid=,user=,%cpu=,rss=,time=,comm="])
        for line in out.splitlines():
            parts = line.split(None, 5)
            if len(parts) < 6:
                continue
            try:
                rows.append({
                    "pid": int(parts[0]), "user": parts[1],
                    "cpu": round(float(parts[2].replace(",", ".")) / cpu_count(), 1),
                    "rss": int(parts[3]) * 1024,
                    "cpu_seconds": round(_parse_cputime(parts[4]), 1),
                    "name": os.path.basename(parts[5].strip()) or parts[5].strip(),
                })
            except ValueError:
                continue
    current_user = _current_user()
    for row in rows:
        row["protected"] = (row["name"].lower() in PROTECTED_PROCESSES or row["pid"] in (0, 1, me))
        user = (row.get("user") or "").split("\\")[-1].lower()
        row["owned"] = bool(current_user) and user == current_user.lower()
    rows.sort(key=lambda r: ((r["cpu"] or 0), r["rss"]), reverse=True)
    return rows[:limit] if limit else rows


def _current_user():
    """Name of the account running the agent (more reliable than os.getlogin())."""
    try:
        import pwd  # POSIX only

        return pwd.getpwuid(os.getuid()).pw_name
    except (ImportError, KeyError, AttributeError):
        pass
    return os.environ.get("USERNAME") or os.environ.get("USER") or ""


def uptime_seconds():
    if psutil:
        return int(time.time() - psutil.boot_time())
    if IS_MAC:
        out = run(["sysctl", "-n", "kern.boottime"])
        match = re.search(r"sec = (\d+)", out)
        return int(time.time()) - int(match.group(1)) if match else None
    if IS_LINUX:
        try:
            with open("/proc/uptime", encoding="ascii") as handle:
                return int(float(handle.read().split()[0]))
        except OSError:
            return None
    if IS_WIN:
        return int(ctypes.windll.kernel32.GetTickCount64() / 1000)  # type: ignore[attr-defined]
    return None


def device_info():
    model = None
    if IS_MAC:
        model = run(["sysctl", "-n", "hw.model"]).strip() or None
    return {
        "hostname": socket.gethostname(),
        "os": SYSTEM,
        "os_version": platform.mac_ver()[0] if IS_MAC else platform.release(),
        "machine": platform.machine(),
        "model": model,
        "cpus": cpu_count(),
        "python": platform.python_version(),
        "psutil": bool(psutil),
    }


def snapshot(home):
    """Everything the dashboard needs in one call."""
    return {
        "time": time.time(),
        "device": device_info(),
        "cpu": {"percent": cpu_percent(), "load": load_average(), "cores": cpu_count()},
        "memory": memory(),
        "disk": disk(home),
        "battery": battery(),
        "uptime": uptime_seconds(),
        "idle_seconds": idle_seconds(),
    }


def quit_process(pid):
    """Politely ask a user-owned, non-protected process to quit (SIGTERM)."""
    rows = {r["pid"]: r for r in processes(limit=0)}
    row = rows.get(pid)
    if not row:
        return False, "That process is no longer running."
    if row["protected"]:
        return False, "%s is part of the system — Vitals will not touch it." % row["name"]
    if not row["owned"]:
        return False, "%s belongs to another user or the system." % row["name"]
    try:
        if IS_WIN:
            run(["taskkill", "/PID", str(pid)])
        else:
            os.kill(pid, 15)
    except OSError as error:
        return False, "Could not ask it to quit: %s" % error
    return True, "Asked %s (pid %d) to quit. Unsaved work prompts still appear." % (row["name"], pid)


SETTINGS_LINKS = {
    "Darwin": {
        "battery": "x-apple.systempreferences:com.apple.Battery-Settings.extension",
        "storage": "x-apple.systempreferences:com.apple.settings.Storage",
        "startup": "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
        "energy": "x-apple.systempreferences:com.apple.Battery-Settings.extension",
        "activity": "/System/Applications/Utilities/Activity Monitor.app",
    },
    "Windows": {
        "battery": "ms-settings:batterysaver",
        "storage": "ms-settings:storagesense",
        "startup": "ms-settings:startupapps",
        "energy": "ms-settings:powersleep",
        "activity": "taskmgr",
    },
}


def open_settings(target):
    link = SETTINGS_LINKS.get(SYSTEM, {}).get(target)
    if not link:
        return False, "No settings shortcut for %s on %s." % (target, SYSTEM)
    try:
        if IS_MAC:
            subprocess.Popen(["open", link])
        elif IS_WIN:
            os.startfile(link)  # type: ignore[attr-defined]
    except OSError as error:
        return False, str(error)
    return True, "Opened %s settings." % target


def notify(title, message):
    """Best-effort desktop notification. Silent no-op when unavailable.

    Set VITALS_NO_NOTIFY=1 to disable (tests, headless servers).
    """
    if os.environ.get("VITALS_NO_NOTIFY"):
        return False
    title = str(title).replace('"', "'")[:80]
    message = str(message).replace('"', "'")[:240]
    try:
        if IS_MAC:
            subprocess.Popen(["osascript", "-e", 'display notification "%s" with title "%s"' % (message, title)],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        if IS_LINUX and shutil.which("notify-send"):
            subprocess.Popen(["notify-send", title, message], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        if IS_WIN:
            script = (
                "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null;"
                "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
                "$t = $x.GetElementsByTagName('text'); $t.Item(0).AppendChild($x.CreateTextNode(\"%s\")) > $null;"
                "$t.Item(1).AppendChild($x.CreateTextNode(\"%s\")) > $null;"
                "$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';"
                "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))"
            ) % (title, message)
            subprocess.Popen(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000)
            return True
    except OSError:
        return False
    return False
