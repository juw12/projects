"""Headless screenshot helper for the cozy3d prototypes.

Starts a local HTTP server (ES modules don't load from file://), then asks
Microsoft Edge in headless mode to render a page and save a PNG.

    python shoot.py "render.html?combos=clear:noon:spring" out.png 512 512
"""

import contextlib
import functools
import http.server
import subprocess
import sys
import threading
from pathlib import Path

EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
HERE = Path(__file__).resolve().parent


@contextlib.contextmanager
def serve(directory, port=8765):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    handler.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.shutdown()


def shoot(page, output, width, height, budget_ms=15000, base_url=None):
    output = Path(output).resolve()
    command = [
        EDGE,
        "--headless=new",
        "--disable-gpu-sandbox",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        f"--window-size={width},{height}",
        f"--virtual-time-budget={budget_ms}",
        f"--screenshot={output}",
        f"{base_url}/{page}",
    ]
    subprocess.run(command, check=True, capture_output=True, timeout=120)
    return output


def main():
    page, output = sys.argv[1], sys.argv[2]
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
    height = int(sys.argv[4]) if len(sys.argv) > 4 else 1024
    with serve(HERE) as base_url:
        print(shoot(page, output, width, height, base_url=base_url))


if __name__ == "__main__":
    main()
