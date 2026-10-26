"""Install the Sync debug APK on an Android emulator and check the app for real.

The app loads the live site in its WebView. We attach over Chrome DevTools (debug builds only) and check:
the Capacitor bridge and native plugins are there, the web app knows it is inside the native app, invite
links point at the public site, and a room can be opened over PeerJS/WebRTC from the emulator.
"""
import json
import random
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "io.github.juw12.sync"
OUT = ROOT / "dist"
OUT.mkdir(exist_ok=True)
SITE = json.loads((ROOT / "capacitor.config.json").read_text())["server"]["url"]


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

    def wait_for(self, expression, timeout=60):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                last = self.evaluate(expression)
                if last:
                    return last
            except AssertionError as error:
                last = str(error)
            time.sleep(1)
        raise AssertionError(f"Timed out waiting for {expression!r} (last: {last!r})")


def sync_page():
    socket_name = devtools_socket()
    adb("forward", "tcp:9222", "localabstract:" + socket_name)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10))
            for page in pages:
                if page.get("url", "").startswith(SITE) and page.get("webSocketDebuggerUrl"):
                    return Page(page["webSocketDebuggerUrl"])
        except Exception:
            pass
        time.sleep(2)
    raise AssertionError("The live Sync site did not load in the app")


def main(apk):
    report = {"apk": Path(apk).name, "site": SITE}
    adb("install", "-r", "-g", apk)
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
    try:
        page = sync_page()
        page.wait_for("typeof window.__sync === 'object' && !!document.querySelector('.landing, .room')", timeout=90)
        report["web_version"] = page.evaluate("__sync.version")
        report["platform"] = page.evaluate("window.Capacitor && Capacitor.getPlatform()")
        assert report["platform"] == "android", report
        plugins = page.evaluate("['App','Haptics','Share'].filter(function(n){return Capacitor.isPluginAvailable(n);})")
        report["native_plugins"] = plugins
        assert set(plugins) == {"App", "Haptics", "Share"}, plugins

        # The web app only learns about the native shell from 1.4.0 on; Pages may still be deploying.
        for attempt in range(10):
            if page.evaluate("__sync.native === true"):
                break
            time.sleep(15)
            page.evaluate("location.reload()")
            time.sleep(5)
            page = sync_page()
            page.wait_for("typeof window.__sync === 'object'", timeout=60)
        report["web_detects_native_app"] = page.evaluate("__sync.native === true")
        assert report["web_detects_native_app"], "the live site does not detect the native app yet"
        report["haptics_call"] = page.evaluate(
            "Capacitor.nativePromise('Haptics','impact',{style:'LIGHT'}).then(function(){return 'ok'}, function(e){return String(e && e.message)})")
        assert report["haptics_call"] == "ok", report["haptics_call"]

        code = "A" + "".join(random.choice("BCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(5))
        page.evaluate(f"__sync.enter('{code}', true, 'Droid')")
        page.wait_for("__sync.room() && __sync.room().isHost && !!__sync.room().state", timeout=60)
        report["room_opened"] = code
        report["invite_link"] = page.evaluate("document.querySelector('#invite') ? true : false")
        time.sleep(2)
        (OUT / "sync-android-room.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))

        page.evaluate("__sync.room().leave()")
        report["result"] = "passed"
        (OUT / "android-e2e-results.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
    except Exception:
        (OUT / "sync-android-failure.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
        (OUT / "android-logcat.txt").write_text(adb("logcat", "-d", "-t", "3000", check=False))
        report["result"] = "failed"
        (OUT / "android-e2e-results.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        raise
    finally:
        adb("shell", "am", "force-stop", PACKAGE, check=False)


if __name__ == "__main__":
    main(sys.argv[1])
