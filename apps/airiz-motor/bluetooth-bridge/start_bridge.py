"""Install (or update) and start the AIRIZ Bluetooth remote over the USB console.

Usage:  python start_bridge.py [COM4] [lifetime_seconds, 0 = until reboot] [--new-pin]
Requires pyserial. Close the AIRIZ Console app's USB connection first (the port
must be free). Files are stored in /data/airiz on the device, so after a reboot
only "sh /data/airiz/start.sh" is needed (the console's "Phone remote" button
does this). The 6-digit PIN is printed at the end.
"""
import base64
import hashlib
import re
import sys
import time
from pathlib import Path

import serial

HERE = Path(__file__).parent
FILES = ["bridge.sh", "start.sh", "stop.sh", "bus.conf"]
args = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
PORT = args[0] if args else "COM4"
LIFETIME = int(args[1]) if len(args) > 1 else 0
NEW_PIN = "--new-pin" in sys.argv


def main():
    with serial.Serial(PORT, 115200, timeout=0.2, write_timeout=2) as console:
        def run(command, quiet=0.8, limit=30.0, until=None):
            console.reset_input_buffer()
            console.write((command + "\r\n").encode())
            chunks = []
            start = last = time.monotonic()
            while time.monotonic() - start < limit:
                waiting = console.in_waiting
                if waiting:
                    chunks.append(console.read(waiting))
                    last = time.monotonic()
                    if until and re.search(until, b"".join(chunks).decode("utf-8", "replace")):
                        break
                elif not until and time.monotonic() - last > quiet:
                    break
                else:
                    time.sleep(0.05)
            return b"".join(chunks).decode("utf-8", errors="replace")

        if "#INFO#" not in run("diag ver sw", 1.5):
            raise SystemExit("No AIRIZ diag reply on " + PORT)
        run("mkdir -p /data/airiz /tmp/airiz", 0.3)
        for name in FILES:
            data = (HERE / name).read_bytes().replace(b"\r\n", b"\n")
            digest = hashlib.md5(data).hexdigest()
            if digest in run(f"md5sum /data/airiz/{name} 2>/dev/null", 0.5):
                continue
            print("Installing", name)
            encoded = base64.b64encode(data).decode()
            run("rm -f /tmp/airiz/upload.b64", 0.2)
            for offset in range(0, len(encoded), 512):
                run(f"echo {encoded[offset:offset + 512]} >> /tmp/airiz/upload.b64", 0.05, 3)
            run(f"base64 -d /tmp/airiz/upload.b64 > /data/airiz/{name}.new && mv /data/airiz/{name}.new /data/airiz/{name}; sync", 0.5)
            if digest not in run(f"md5sum /data/airiz/{name}", 0.5):
                raise SystemExit("Upload check failed for " + name)
        print("Starting the Bluetooth remote (about 10 s)")
        reply = run(f"sh /data/airiz/start.sh {LIFETIME}{' newpin' if NEW_PIN else ''}", limit=60, until=r"#AIRIZBT#(ready#PIN=\d{6}|failed[^\r\n]*)#END#")
        match = re.search(r"#AIRIZBT#ready#PIN=(\d{6})#END#", reply)
        if not match:
            raise SystemExit("Bridge did not start; see /tmp/airiz/out on the device")
        until = "until the device reboots" if LIFETIME == 0 else f"for {LIFETIME} s"
        print(f"AIRIZ-BT is advertising {until}. PIN: {match.group(1)}")


if __name__ == "__main__":
    main()
