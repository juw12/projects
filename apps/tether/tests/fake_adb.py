"""A fake `adb` for hermetic tests. Point TETHER_ADB at this file.

Simulates one ready device (emulator-5554, 1080x2400), one unauthorised
device, screen capture (PNG + raw), input, uiautomator dumps, packages,
install and logcat. Every input command is appended to TETHER_FAKE_LOG so
tests can assert what reached the "device". If the file TETHER_FAKE_STATE
contains "logged_in", the UI dump shows the post-login screen.
"""

import json
import os
import struct
import sys
import zlib

WIDTH, HEIGHT = 1080, 2400
READY = "emulator-5554"


def png(width, height, colour):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    row = b"\x00" + bytes(colour) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 1))
        + chunk(b"IEND", b"")
    )


def raw_rgba(width, height, colour):
    header = struct.pack("<IIII", width, height, 1, 0)
    return header + (bytes(colour) + b"\xff") * (width * height)


def state():
    path = os.environ.get("TETHER_FAKE_STATE")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip()
    return ""


def log(line):
    path = os.environ.get("TETHER_FAKE_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def fake_notifications():
    """Notifications 'on the phone' (a JSON list written by the integration test)."""
    path = os.environ.get("TETHER_FAKE_NOTIFS")
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    return []


def shade_open():
    path = os.environ.get("TETHER_FAKE_SHADE")
    return bool(path) and os.path.exists(path)


def set_shade(opened):
    path = os.environ.get("TETHER_FAKE_SHADE")
    if not path:
        return
    if opened:
        open(path, "w").close()
    elif os.path.exists(path):
        os.remove(path)


def notification_dump():
    """Same shape as `adb shell dumpsys notification --noredact` on Android 12-14."""
    lines = ["Current Notification Manager state:", "  Notification List:"]
    for index, item in enumerate(fake_notifications()):
        package = item.get("package", "com.android.chrome")
        key = f"0|{package}|{index + 1}|null|10150"
        lines += [
            f"    NotificationRecord(0x0a1b2c{index:02x}: pkg={package} user=UserHandle{{0}} id={index + 1} "
            f"tag=null importance=4 key={key}: Notification(channel=default pri=0 flags=0x10 vis=PRIVATE))",
            "      uid=10150 userId=0",
            f"      opPkg={package}",
            "      extras={",
            f"        android.title=String ({item.get('title', '')})",
            f"        android.text=String ({item.get('text', '')})",
            "        android.appInfo=ApplicationInfo (ApplicationInfo{abc " + package + "})",
            "      }",
        ]
    lines += ["", "  Snoozed notifications:", "    (none)"]
    return "\n".join(lines) + "\n"


def shade_ui():
    rows = []
    for index, item in enumerate(fake_notifications()):
        top = 300 + index * 220
        rows.append(
            f'<node index="{index}" text="" resource-id="com.android.systemui:id/expandableNotificationRow" '
            f'class="android.widget.FrameLayout" package="com.android.systemui" content-desc="" clickable="true" '
            f'enabled="true" focused="false" checked="false" bounds="[0,{top}][1080,{top + 200}]">'
            f'<node index="0" text="{item.get("title", "")}" resource-id="android:id/title" '
            f'class="android.widget.TextView" package="com.android.systemui" content-desc="" clickable="false" '
            f'enabled="true" focused="false" checked="false" bounds="[60,{top + 30}][1000,{top + 90}]" />'
            f'<node index="1" text="{item.get("text", "")}" resource-id="android:id/text" '
            f'class="android.widget.TextView" package="com.android.systemui" content-desc="" clickable="false" '
            f'enabled="true" focused="false" checked="false" bounds="[60,{top + 100}][1000,{top + 160}]" /></node>'
        )
    return ("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">"
            '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.systemui" '
            'content-desc="" clickable="false" enabled="true" focused="false" checked="false" bounds="[0,0][1080,2400]">'
            + "".join(rows) + "</node></hierarchy>")


def node(text, bounds, clickable=False, rid="", cls="android.widget.TextView", pkg="com.android.chrome"):
    return (f'<node index="0" text="{text}" resource-id="{rid}" class="{cls}" package="{pkg}" content-desc="" '
            f'clickable="{str(clickable).lower()}" enabled="true" focused="false" checked="false" bounds="{bounds}" />')


ENABLE_BOUNDS = (100, 1500, 980, 1640)
ALLOW_BOUNDS = (560, 2000, 1000, 2100)
DENY_BOUNDS = (80, 2000, 520, 2100)


def box(b):
    return f"[{b[0]},{b[1]}][{b[2]},{b[3]}]"


def browser_ui(state_name):
    nodes = [node("Push Lab", "[90,400][990,500]")]
    if state_name in ("try", "prompt"):
        nodes.append(node("Enable notifications", box(ENABLE_BOUNDS), True, cls="android.widget.Button"))
    if state_name == "prompt":
        nodes.append(node("localhost:8780 wants to send notifications", "[60,1880][1020,1980]"))
        nodes.append(node("Don't allow", box(DENY_BOUNDS), True, "com.android.chrome:id/negative_button",
                          "android.widget.Button"))
        nodes.append(node("Allow", box(ALLOW_BOUNDS), True, "com.android.chrome:id/positive_button",
                          "android.widget.Button"))
    if state_name == "subscribed":
        nodes.append(node("You're subscribed \u2713", "[90,1700][990,1780]"))
    return ("<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation=\"0\">"
            '<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.chrome" '
            'content-desc="" clickable="false" enabled="true" focused="false" checked="false" bounds="[0,0][1080,2400]">'
            + "".join(nodes) + "</node></hierarchy>")


def set_state(value):
    path = os.environ.get("TETHER_FAKE_STATE")
    if path:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(value)


def inside(x, y, b):
    return b[0] <= x <= b[2] and b[1] <= y <= b[3]


def on_tap(x, y):
    """Tiny browser model: Enable → permission prompt → Allow → subscribed."""
    current = state()
    if current == "try" and inside(x, y, ENABLE_BOUNDS):
        set_state("prompt")
    elif current == "prompt" and inside(x, y, ALLOW_BOUNDS):
        set_state("subscribed")
    elif current == "prompt" and inside(x, y, DENY_BOUNDS):
        set_state("try")


LOGIN_UI = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo.app" content-desc="" clickable="false" enabled="true" focused="false" checked="false" bounds="[0,0][1080,2400]">
<node index="0" text="Welcome to Demo" resource-id="com.demo.app:id/title" class="android.widget.TextView" package="com.demo.app" content-desc="" clickable="false" enabled="true" focused="false" checked="false" bounds="[90,300][990,420]" />
<node index="1" text="" resource-id="com.demo.app:id/email" class="android.widget.EditText" package="com.demo.app" content-desc="Email" clickable="true" enabled="true" focused="true" checked="false" bounds="[90,900][990,1040]" />
<node index="2" text="Sign in" resource-id="com.demo.app:id/login" class="android.widget.Button" package="com.demo.app" content-desc="" clickable="true" enabled="true" focused="false" checked="false" bounds="[100,1800][980,1960]" />
</node></hierarchy>"""

HOME_UI = """<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.demo.app" content-desc="" clickable="false" enabled="true" focused="false" checked="false" bounds="[0,0][1080,2400]">
<node index="0" text="Dashboard" resource-id="com.demo.app:id/header" class="android.widget.TextView" package="com.demo.app" content-desc="" clickable="false" enabled="true" focused="false" checked="false" bounds="[90,200][990,320]" />
</node></hierarchy>"""


def scrcpy_state_dir():
    path = os.environ.get("TETHER_FAKE_LOG")
    return os.path.dirname(path) if path else os.environ.get("TEMP", ".")


def fake_forward(args):
    """`forward tcp:P localabstract:NAME` starts a fake device server; `--remove tcp:P` stops it."""
    import signal
    import subprocess

    if args[:1] == ["--remove"]:
        port = args[1].split(":", 1)[1]
        pid_file = os.path.join(scrcpy_state_dir(), f"fake-scrcpy-{port}.pid")
        if os.path.exists(pid_file):
            with open(pid_file, encoding="utf-8") as handle:
                pid = int(handle.read().strip())
            try:
                os.kill(pid, signal.SIGTERM)
            except OSError:
                pass
            os.remove(pid_file)
        marker = os.path.join(scrcpy_state_dir(), "fake-scrcpy-started")
        if os.path.exists(marker):
            os.remove(marker)
        log("forward --remove " + args[1])
        return 0
    local, remote = args[0], args[1]
    if not (local.startswith("tcp:") and remote.startswith("localabstract:scrcpy_")):
        sys.stderr.write("fake adb: unsupported forward " + " ".join(args) + "\n")
        return 1
    port = local.split(":", 1)[1]
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    device = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                            "fake_scrcpy_device.py"), port],
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              creationflags=flags if os.name == "nt" else 0)
    with open(os.path.join(scrcpy_state_dir(), f"fake-scrcpy-{port}.pid"), "w", encoding="utf-8") as handle:
        handle.write(str(device.pid))
    log(f"forward {local} {remote}")
    sys.stdout.buffer.write(port.encode() + b"\n")
    return 0


def fake_scrcpy_server(cmd):
    """`shell CLASSPATH=… app_process / com.genymobile.scrcpy.Server VERSION opts…` — runs until killed."""
    import time

    version = cmd[cmd.index("com.genymobile.scrcpy.Server") + 1]
    options = cmd[cmd.index("com.genymobile.scrcpy.Server") + 2:]
    log("scrcpy-server " + version + " " + " ".join(options))
    if version != "5.0.1":
        sys.stdout.write(f"[server] ERROR: The server version ({version}) does not match the client\n")
        return 1
    time.sleep(0.4)  # the real server needs a moment before it listens
    open(os.path.join(scrcpy_state_dir(), "fake-scrcpy-started"), "w").close()
    sys.stdout.write("[server] INFO: Device: [Fake] Pixel 7 (Android 15)\n")
    sys.stdout.flush()
    while True:
        time.sleep(1)


# ------------------------------------------------ device state (mobile-mcp parity)
def state_file(name):
    return os.path.join(scrcpy_state_dir(), name)


def rotation():
    path = state_file("fake-rotation")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return handle.read().strip() or "0"
    return "0"


def screen_size():
    return (HEIGHT, WIDTH) if rotation() in ("1", "3") else (WIDTH, HEIGHT)


THREADTIME_LOG = (
    "11-01 08:00:00.000   500   512 I ActivityManager: Start proc 4242:com.demo.app/u0a150\n"
    "11-01 08:00:00.100  4242  4242 D DemoApp : onCreate\n"
    "11-01 08:00:00.200  4242  4242 I DemoApp : login screen shown\n"
    "11-01 08:00:00.300   500   530 W WindowManager: slow frame\n"
    "11-01 08:00:01.000  4242  4242 E AndroidRuntime: FATAL EXCEPTION: main\n"
)

CRASH_LOG = (
    "--------- beginning of crash\n"
    "11-01 08:00:01.000  4242  4242 E AndroidRuntime: FATAL EXCEPTION: main\n"
    "11-01 08:00:01.000  4242  4242 E AndroidRuntime: Process: com.demo.app, PID: 4242\n"
    "11-01 08:00:01.000  4242  4242 E AndroidRuntime: java.lang.IllegalStateException: login button tapped twice\n"
    "11-01 08:00:01.000  4242  4242 E AndroidRuntime: \tat com.demo.app.LoginActivity.onClick(LoginActivity.kt:42)\n"
    "11-01 09:15:30.500  5151  5151 F libc    : Fatal signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0\n"
    "11-01 09:15:30.600  5160  5160 F DEBUG   : *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n"
    "11-01 09:15:30.600  5160  5160 F DEBUG   : pid: 5151, tid: 5151, name: demo.native  >>> com.demo.native <<<\n"
    "11-01 09:15:30.600  5160  5160 F DEBUG   : signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0x0\n"
)

FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 4096


def fake_screenrecord(cmd):
    """`shell screenrecord --time-limit N --bit-rate B /sdcard/x.mp4` until `pkill -2 screenrecord`."""
    import time

    remote = cmd[-1]
    limit = int(cmd[cmd.index("--time-limit") + 1]) if "--time-limit" in cmd else 180
    stop = state_file("fake-screenrecord-stop")
    if os.path.exists(stop):
        os.remove(stop)
    log("screenrecord " + " ".join(cmd[1:]))
    started = time.time()
    while time.time() - started < limit and not os.path.exists(stop):
        time.sleep(0.1)
    if os.path.exists(stop):
        os.remove(stop)
    with open(state_file("fake-sdcard-" + os.path.basename(remote)), "wb") as handle:
        handle.write(FAKE_MP4)
    return 0


def main(argv):
    out = sys.stdout.buffer
    if argv[:1] == ["version"]:
        out.write(b"Android Debug Bridge version 1.0.41 (fake)\n")
        return 0
    if argv[:2] == ["devices", "-l"]:
        out.write(
            b"List of devices attached\n"
            b"emulator-5554          device product:sdk_gphone64 model:Pixel_7 device:emu64 transport_id:1\n"
            b"R58N12ABCDE            unauthorized usb:1-1 transport_id:2\n\n"
        )
        return 0

    if argv[:1] == ["pair"]:
        if len(argv) == 3 and argv[2] == "123456":
            out.write(f"Successfully paired to {argv[1]} [guid=adb-FAKE123]\n".encode())
            return 0
        sys.stderr.write("Failed: Wrong password or connection was dropped.\n")
        return 1
    if argv[:1] == ["connect"]:
        out.write(f"connected to {argv[1]}\n".encode())
        return 0

    serial = None
    if argv[:1] == ["-s"]:
        serial, argv = argv[1], argv[2:]
    if serial != READY:
        sys.stderr.write(f"error: device '{serial}' not found\n")
        return 1

    logged_in = state() == "logged_in"
    colour = (20, 160, 90) if logged_in else (30, 60, 200)

    if argv == ["exec-out", "screencap", "-p"]:
        out.write(png(WIDTH, HEIGHT, colour))
        return 0
    if argv == ["exec-out", "screencap"]:
        out.write(raw_rgba(WIDTH, HEIGHT, colour))
        return 0
    if argv[:1] == ["reverse"]:
        log("reverse " + " ".join(argv[1:]))
        return 0
    if argv[:1] == ["push"] and len(argv) == 3:
        if not os.path.isfile(argv[1]):
            sys.stderr.write(f"adb: error: cannot stat '{argv[1]}'\n")
            return 1
        log(f"push {os.path.basename(argv[1])} {argv[2]}")
        out.write(b"1 file pushed, 0 skipped.\n")
        return 0
    if argv[:1] == ["forward"]:
        return fake_forward(argv[1:])
    if argv == ["exec-out", "cat", "/sdcard/tether_ui.xml"] and state() in ("try", "prompt", "subscribed") \
            and not shade_open():
        out.write(browser_ui(state()).encode())
        return 0
    if argv == ["exec-out", "cat", "/sdcard/tether_ui.xml"]:
        if shade_open():
            out.write(shade_ui().encode())
            return 0
        out.write((HOME_UI if logged_in else LOGIN_UI).encode())
        return 0
    if argv[:1] == ["install"]:
        path = argv[-1]
        if not os.path.isfile(path):
            sys.stderr.write("adb: failed to stat apk\n")
            return 1
        log("install " + os.path.basename(path))
        out.write(b"Performing Streamed Install\nSuccess\n")
        return 0
    if argv[:1] == ["uninstall"]:
        if argv[1] in ("com.demo.app", "com.juw12.vitals"):
            log("uninstall " + argv[1])
            out.write(b"Success\n")
            return 0
        out.write(b"Failure [DELETE_FAILED_INTERNAL_ERROR]\n")
        return 1
    if argv[:3] == ["emu", "geo", "fix"]:
        log("geo fix " + " ".join(argv[3:]))
        out.write(b"OK\n")
        return 0
    if argv[:1] == ["pull"]:
        source = state_file("fake-sdcard-" + os.path.basename(argv[1]))
        if not os.path.exists(source):
            sys.stderr.write(f"adb: error: failed to stat remote object '{argv[1]}': No such file or directory\n")
            return 1
        with open(source, "rb") as src, open(argv[2], "wb") as dst:
            dst.write(src.read())
        log("pull " + argv[1])
        out.write(b"1 file pulled, 0 skipped.\n")
        return 0
    if argv[:1] == ["logcat"] and "crash" in argv:
        out.write(CRASH_LOG.encode())
        return 0
    if argv[:1] == ["logcat"] and "threadtime" in argv:
        out.write(THREADTIME_LOG.encode())
        return 0
    if argv[:1] == ["logcat"]:
        if any(a.startswith("--pid=") for a in argv):
            out.write(b"11-01 08:00:00.000 I/DemoApp( 4242): only demo lines\n")
        else:
            out.write(
                b"11-01 08:00:00.000 I/ActivityManager(  500): Start proc com.demo.app\n"
                b"11-01 08:00:01.000 E/AndroidRuntime( 4242): FATAL EXCEPTION: main\n"
            )
        return 0

    if argv[:1] != ["shell"]:
        sys.stderr.write("fake adb: unsupported " + " ".join(argv) + "\n")
        return 1
    cmd = argv[1:]
    if cmd[:1] and cmd[0].startswith("CLASSPATH=") and "app_process" in cmd:
        return fake_scrcpy_server(cmd)
    if "&&" in cmd:
        segment = []
        for token in cmd + ["&&"]:
            if token == "&&":
                if segment[:1] == ["input"]:
                    log(" ".join(segment))
                segment = []
            else:
                segment.append(token)
        return 0
    if cmd[:1] == ["screenrecord"]:
        return fake_screenrecord(cmd)
    if cmd[:3] == ["pkill", "-2", "screenrecord"]:
        open(state_file("fake-screenrecord-stop"), "w").close()
        log("screenrecord stop")
        return 0
    if cmd[:2] == ["rm", "-f"]:
        target = state_file("fake-sdcard-" + os.path.basename(cmd[2]))
        if os.path.exists(target):
            os.remove(target)
        log("rm " + cmd[2])
        return 0
    if cmd == ["getprop", "ro.build.version.release"]:
        out.write(b"15\n")
        return 0
    if cmd[:3] == ["settings", "put", "system"]:
        log("settings " + cmd[3] + "=" + cmd[4])
        if cmd[3] == "user_rotation":
            with open(state_file("fake-rotation"), "w", encoding="utf-8") as handle:
                handle.write(cmd[4])
        return 0
    if cmd[:3] == ["cmd", "locale", "set-app-locales"]:
        log("locale " + cmd[3] + " " + cmd[-1])
        return 0
    if cmd[:1] == ["input"]:
        log(" ".join(cmd))
        if cmd[1:2] == ["tap"]:
            on_tap(int(cmd[2]), int(cmd[3]))
        return 0
    if cmd[:2] == ["am", "start"] and "-d" in cmd:
        url = cmd[cmd.index("-d") + 1].strip("'")
        log("open " + url + (" in " + cmd[cmd.index("-p") + 1] if "-p" in cmd else ""))
        set_state("try")
        out.write(b"Starting: Intent { act=android.intent.action.VIEW }\n")
        return 0
    if cmd[:3] == ["dumpsys", "notification", "--noredact"]:
        out.write(notification_dump().encode())
        return 0
    if cmd[:3] == ["cmd", "statusbar", "expand-notifications"]:
        set_shade(True)
        log("shade open")
        return 0
    if cmd[:3] == ["cmd", "statusbar", "collapse"]:
        set_shade(False)
        log("shade closed")
        return 0
    if cmd[:3] == ["dumpsys", "window", "displays"]:
        cur_w, cur_h = screen_size()
        out.write(f"  init={WIDTH}x{HEIGHT} 420dpi base={WIDTH}x{HEIGHT} 420dpi cur={cur_w}x{cur_h} app={cur_w}x2337\n".encode())
        return 0
    if cmd[:2] == ["dumpsys", "window"]:
        out.write(b"  mCurrentFocus=Window{abc123 u0 com.demo.app/com.demo.app.MainActivity}\n")
        return 0
    if cmd[:2] == ["uiautomator", "dump"]:
        out.write(b"UI hierchary dumped to: /sdcard/tether_ui.xml\n")
        return 0
    if cmd[:3] == ["pm", "list", "packages"]:
        out.write(b"package:com.juw12.vitals\npackage:com.demo.app\n")
        return 0
    if cmd[:1] == ["monkey"]:
        log("launch " + cmd[2])
        out.write(b"Events injected: 1\n")
        return 0
    if cmd[:2] == ["am", "force-stop"]:
        log("stop " + cmd[2])
        return 0
    if cmd[:2] == ["pm", "clear"]:
        log("clear " + cmd[2])
        out.write(b"Success\n")
        return 0
    if cmd[:1] == ["pidof"]:
        if cmd[1:2] == ["com.not.running"]:
            return 1
        out.write(b"4242\n")
        return 0
    sys.stderr.write("fake adb: unsupported shell " + " ".join(cmd) + "\n")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
