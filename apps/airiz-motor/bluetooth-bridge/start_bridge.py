"""Start the temporary AIRIZ Bluetooth command bridge over the USB console.

Usage:  python start_bridge.py [COM4] [lifetime_seconds]
Requires pyserial. Close the AIRIZ Console app's USB connection first (the port
must be free). Everything runs from /tmp on the device and disappears on reboot.
"""
from pathlib import Path
import sys
import time

import serial

HERE = Path(__file__).parent
PORT = sys.argv[1] if len(sys.argv) > 1 else "COM4"
LIFETIME = int(sys.argv[2]) if len(sys.argv) > 2 else 3600
ENV = "DBUS_SYSTEM_BUS_ADDRESS=unix:path=/tmp/airiz/bus"


def main():
    with serial.Serial(PORT, 115200, timeout=0.2, write_timeout=2) as console:
        def run(command, quiet=0.8, limit=30.0):
            console.reset_input_buffer()
            console.write((command + "\r\n").encode())
            chunks = []
            start = last = time.monotonic()
            while time.monotonic() - start < limit:
                waiting = console.in_waiting
                if waiting:
                    chunks.append(console.read(waiting))
                    last = time.monotonic()
                elif time.monotonic() - last > quiet:
                    break
                else:
                    time.sleep(0.05)
            return b"".join(chunks).decode("utf-8", errors="replace")

        def upload(remote, text):
            run(f"rm -f {remote}", 0.3)
            for line in text.splitlines():
                escaped = line.replace("'", "'\\''")
                run(f"printf '%s\\n' '{escaped}' >> {remote}", 0.1, 3)

        if "#INFO#" not in run("diag ver sw", 1.5):
            raise SystemExit("No AIRIZ diag reply on " + PORT)
        print("Device found; turning Bluetooth on")
        run("diag ble on", 3.0, 40)
        run("mkdir -p /tmp/airiz", 0.3)
        upload("/tmp/airiz/bus.conf", (HERE / "bus.conf").read_text(encoding="utf-8"))
        upload("/tmp/airiz/bridge.sh", (HERE / "bridge.sh").read_text(encoding="utf-8"))
        run("pidof dbus-daemon >/dev/null; [ -S /tmp/airiz/bus ] || dbus-daemon --config-file=/tmp/airiz/bus.conf --fork", 1.0)
        run("kill $(ps | grep '[b]ridge.sh' | awk '{print $1}') 2>/dev/null; killall tail bluetoothctl bluetoothd 2>/dev/null; sleep 2", 1.0)
        run(f"{ENV} bluetoothd -n -f /etc/bluetooth/main.conf > /tmp/airiz/bluetoothd.log 2>&1 &", 1.0)
        time.sleep(3)
        run("rm -f /tmp/airiz/stop; " + f"setsid sh /tmp/airiz/bridge.sh {LIFETIME} > /tmp/airiz/bridge.stdout 2>&1 &", 1.0)
        time.sleep(7)
        status = run("grep -c 'Application registered' /tmp/airiz/out; grep -c 'Advertising object registered' /tmp/airiz/out", 1.0)
        if status.count("1") < 2:
            raise SystemExit("Bridge did not register; see /tmp/airiz/out on the device")
        print(f"AIRIZ-BT is advertising for {LIFETIME} s. Connect with the AIRIZ phone app.")


if __name__ == "__main__":
    main()
