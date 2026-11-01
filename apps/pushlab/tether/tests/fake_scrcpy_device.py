"""Fake on-device scrcpy server, started by fake_adb.py for `adb forward tcp:PORT localabstract:scrcpy_*`.

Speaks the scrcpy v5 protocol on 127.0.0.1:PORT: refuses connections until the
fake `app_process` has "started" (like a real adb forward with nothing listening
yet), then sends the dummy byte, device name, codec id, a session packet and a
real H.264 stream (tests/fixtures/demo-360x780.h264pkt, looped at 30 fps).
Bytes received on the control socket are appended to TETHER_FAKE_LOG as
"scrcpy-control <hex>".
"""

import os
import socket
import struct
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / "fixtures" / "demo-360x780.h264pkt"
FLAG_CONFIG = 1 << 62
FLAG_KEY = 1 << 61


def state_dir() -> Path:
    log = os.environ.get("TETHER_FAKE_LOG")
    return Path(log).parent if log else Path(os.environ.get("TEMP", "."))


def log(line: str) -> None:
    path = os.environ.get("TETHER_FAKE_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def load_fixture():
    data = FIXTURE.read_bytes()
    assert data[:6] == b"TH264\0"
    width, height = struct.unpack(">HH", data[6:10])
    packets, offset = [], 10
    while offset < len(data):
        kind, pts, size = struct.unpack(">BQI", data[offset:offset + 13])
        offset += 13
        packets.append((kind, pts, data[offset:offset + size]))
        offset += size
    return width, height, packets


def clipboard_file() -> Path:
    return state_dir() / "fake-clipboard.txt"


def read_clipboard() -> str:
    path = clipboard_file()
    return path.read_text(encoding="utf-8") if path.exists() else "fake clipboard"


def serve_control(conn: socket.socket) -> None:
    """Logs control bytes; answers GET_CLIPBOARD (8) and SET_CLIPBOARD (9) like scrcpy does."""
    buffer = b""
    try:
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            log("scrcpy-control " + chunk.hex())
            buffer += chunk
            while buffer:
                kind = buffer[0]
                if kind == 8 and len(buffer) >= 2:
                    buffer = buffer[2:]
                    data = read_clipboard().encode("utf-8")
                    conn.sendall(struct.pack(">BI", 0, len(data)) + data)
                elif kind == 9 and len(buffer) >= 14:
                    sequence, _paste, size = struct.unpack(">QBI", buffer[1:14])
                    if len(buffer) < 14 + size:
                        break
                    text = buffer[14:14 + size].decode("utf-8")
                    clipboard_file().write_text(text, encoding="utf-8")
                    log("scrcpy-clipboard-set " + text)
                    buffer = buffer[14 + size:]
                    conn.sendall(struct.pack(">BQ", 1, sequence))
                elif kind in (8, 9):
                    break  # wait for the rest of the message
                else:
                    buffer = b""  # other messages are only logged
    except OSError:
        pass


def stream(video: socket.socket, width: int, height: int, packets) -> None:
    name = b"Fake Pixel 7".ljust(64, b"\0")
    video.sendall(name)
    if os.environ.get("FAKE_SCRCPY_MODE") == "nocapture":
        video.sendall(struct.pack(">I", 1))
        return
    video.sendall(struct.pack(">I", 0x68323634))
    video.sendall(struct.pack(">III", 0x80000000, width, height))
    loop_pts = 0
    while True:
        for kind, pts, payload in packets:
            if kind == 1:
                header = struct.pack(">QI", FLAG_CONFIG, len(payload))
            else:
                flags = FLAG_KEY if kind == 2 else 0
                header = struct.pack(">QI", (loop_pts + pts) | flags, len(payload))
                time.sleep(1 / 30)
            video.sendall(header + payload)
        loop_pts += packets[-1][1] + 33333


def main(port: int) -> int:
    width, height, packets = load_fixture()
    started = state_dir() / "fake-scrcpy-started"
    server = socket.socket()
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("127.0.0.1", port))
    server.listen(4)
    while True:
        video, _ = server.accept()
        if not started.exists():
            video.close()  # nothing listening on the device yet
            continue
        try:
            video.sendall(b"\0")
            server.settimeout(5)
            control, _ = server.accept()
            server.settimeout(None)
            threading.Thread(target=serve_control, args=(control,), daemon=True).start()
            stream(video, width, height, packets)
        except OSError:
            pass
        finally:
            server.settimeout(None)
            video.close()


if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1])))
