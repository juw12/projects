#!/usr/bin/env python3
"""keyin Linux keyboard hook (placeholder).

Full implementation will use XRecordExtension (X11) or python-evdev
(/dev/input/event*) depending on the session type. For v1 we ship a
stub that prints an info line so the Node side knows the platform is
recognized but the helper is not yet wired up.
"""
import sys, json, time

info = {"type": "info", "message": "linux hook not yet implemented"}
print(json.dumps(info), flush=True)

# Keep the process alive until stdin closes (QUIT signal from parent).
for line in sys.stdin:
    if line.strip() == "QUIT":
        break
