"""Install the Glow debug APK on an Android emulator and drive the native built-in browser for real.

GlowLead runs in the app's main WebView; we attach over Chrome DevTools (debug builds only) and call GlowLead's
own hands transport, which drives the GlowBrowser plugin (a second, native WebView) on a public form page.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "io.github.juw12.glow"
OUT = ROOT / "dist"
OUT.mkdir(exist_ok=True)
FORM_URL = "https://httpbin.org/forms/post"


def adb(*args, binary=False, check=True):
    result = subprocess.run(["adb", *args], capture_output=True, check=check)
    return result.stdout if binary else result.stdout.decode("utf-8", "replace")


def devtools_socket(timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        sockets = re.findall(r"@(webview_devtools_remote_\d+)", adb("shell", "cat", "/proc/net/unix"))
        if sockets:
            return sockets[0]
        time.sleep(2)
    raise AssertionError("The app's WebView debugger socket never appeared")


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=120, suppress_origin=True)
        self.next_id = 0

    def evaluate(self, expression):
        self.next_id += 1
        self.ws.send(json.dumps({
            "id": self.next_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "awaitPromise": True, "returnByValue": True},
        }))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.next_id:
                result = message.get("result", {})
                if "exceptionDetails" in result:
                    raise AssertionError("Page error: " + json.dumps(result["exceptionDetails"])[:600])
                return result.get("result", {}).get("value")


def glow_page():
    socket_name = devtools_socket()
    adb("forward", "tcp:9222", "localabstract:" + socket_name)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10))
            for page in pages:
                if "/lead/" in page.get("url", "") and page.get("webSocketDebuggerUrl"):
                    return Page(page["webSocketDebuggerUrl"])
        except Exception:
            pass
        time.sleep(2)
    raise AssertionError("GlowLead did not load in the app")


def call(page, path, body=None):
    return page.evaluate("GlowLead.hands.call(%s, %s)" % (json.dumps(path), json.dumps(body)))


def main(apk):
    report = {"apk": Path(apk).name}
    adb("install", "-r", apk)
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
    page = glow_page()
    deadline = time.time() + 60
    while time.time() < deadline and not page.evaluate("!!(window.GlowLead && window.GlowLead.hands)"):
        time.sleep(1)
    status = call(page, "status")
    assert status.get("status") == 200 and status.get("mode") == "app", status
    report["status"] = status

    label = ""
    deadline = time.time() + 30
    while time.time() < deadline and "THIS PHONE" not in label:
        label = page.evaluate("document.getElementById('hands-status').textContent")
        time.sleep(1)
    assert "THIS PHONE" in label, label
    report["label"] = label

    opened = call(page, "act", {"action": {"action": "goto", "url": FORM_URL}})
    assert opened.get("status") == 200, opened
    seen = call(page, "observe")
    assert seen.get("status") == 200 and seen.get("elements"), seen
    by_name = {element["name"]: element["ref"] for element in seen["elements"]}
    name_ref = next(ref for name, ref in by_name.items() if "Customer name" in name)
    typed = call(page, "act", {"action": {"action": "type", "ref": name_ref, "text": "Glow Android"}})
    assert typed.get("status") == 200, typed
    value = page.evaluate(
        "GlowLead.hands.call('observe').then((o) => o.elements.find((e) => e.ref === %d).value)" % name_ref
    )
    assert value == "Glow Android", value

    submit_ref = next(ref for name, ref in by_name.items() if "Submit order" in name)
    blocked = call(page, "act", {"action": {"action": "click", "ref": submit_ref}})
    assert blocked.get("status") == 409 and blocked.get("needsApproval"), blocked
    approved = call(page, "act", {"action": {"action": "click", "ref": submit_ref}, "approved": True})
    assert approved.get("status") == 200, approved
    after = call(page, "observe")
    assert "Glow Android" in (after.get("text") or ""), (after.get("text") or "")[:400]

    private = call(page, "act", {"action": {"action": "goto", "url": "http://192.168.1.1/"}})
    assert private.get("status") == 400, private

    report.update(typed_value=value, approval_required=True, submitted=True, private_blocked=True,
                  url_after=after.get("url"))
    (OUT / "glow-android-emulator.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    report["result"] = "passed"
    (OUT / "android-e2e-results.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception:
        (OUT / "glow-android-failure.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True, check=False))
        (OUT / "android-logcat.txt").write_text(adb("logcat", "-d", "-t", "3000", check=False), encoding="utf-8")
        raise
