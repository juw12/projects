"""Install the 光耀同行 debug APK on an Android emulator and check the shell against the live site.

Attaches to the app's WebView over Chrome DevTools (debug builds only) and checks: the live site loads inside
the app, the page knows it runs in the native shell, a guest can start and open the official library, the
Puter sign-in window opens inside the app (as a second WebView), and an ordinary new-window link does not.
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
PACKAGE = "io.github.juw12.guangyao"
SITE = "juw12.github.io/projects/guangyao"
OUT = ROOT / "dist"
OUT.mkdir(exist_ok=True)


def adb(*args, binary=False, check=True):
    result = subprocess.run(["adb", *args], capture_output=True, check=check)
    return result.stdout if binary else result.stdout.decode("utf-8", "replace")


def devtools_pages(timeout=180):
    deadline = time.time() + timeout
    while time.time() < deadline:
        sockets = re.findall(r"@(webview_devtools_remote_\d+)", adb("shell", "cat", "/proc/net/unix"))
        if sockets:
            adb("forward", "tcp:9222", "localabstract:" + sockets[0])
            try:
                return json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=10))
            except Exception:
                pass
        time.sleep(2)
    raise AssertionError("The app's WebView debugger never appeared")


class Page:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=120, suppress_origin=True)
        self.next_id = 0

    def evaluate(self, expression):
        self.next_id += 1
        self.ws.send(json.dumps({
            "id": self.next_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "awaitPromise": True, "returnByValue": True, "userGesture": True},
        }))
        while True:
            message = json.loads(self.ws.recv())
            if message.get("id") == self.next_id:
                result = message.get("result", {})
                if "exceptionDetails" in result:
                    raise AssertionError("Page error: " + json.dumps(result["exceptionDetails"])[:600])
                return result.get("result", {}).get("value")


def wait_for(check, timeout, message):
    deadline = time.time() + timeout
    value = None
    while time.time() < deadline:
        value = check()
        if value:
            return value
        time.sleep(1)
    raise AssertionError(message + ": " + repr(value))


def app_page():
    def find():
        for page in devtools_pages():
            if SITE in page.get("url", "") and page.get("webSocketDebuggerUrl"):
                return page
        return None
    # A freshly booted emulator can take minutes before its network works. Until then the app shows its
    # offline screen, which must reconnect to the live site by itself (no tap needed).
    return Page(wait_for(find, 480, "The live site never loaded in the app")["webSocketDebuggerUrl"])


def main(apk):
    report = {"apk": Path(apk).name}
    adb("install", "-r", apk)
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
    page = app_page()
    wait_for(lambda: page.evaluate("!!document.querySelector('.welcome')"), 60, "Welcome screen missing")
    report["user_agent_marker"] = page.evaluate("navigator.userAgent.includes('GuangYaoApp/')")
    report["native_flag"] = page.evaluate("!!(window.GY_NATIVE && window.GY_NATIVE.isApp)")
    report["capacitor_plugins"] = page.evaluate("Object.keys((window.Capacitor && window.Capacitor.Plugins) || {}).filter(k => ['Share', 'Filesystem'].includes(k)).sort()")
    report["install_button_hidden"] = page.evaluate("document.querySelector('[data-pwa-action=install]').hidden")
    assert report["user_agent_marker"] and report["native_flag"], report
    assert report["capacitor_plugins"] == ["Filesystem", "Share"], report
    assert report["install_button_hidden"], report

    page.evaluate("document.querySelector('.welcome [data-action=guest-start]').click()")
    wait_for(lambda: not page.evaluate("!!document.querySelector('.welcome')"), 20, "Guest start failed")
    page.evaluate("location.hash = '#library'")
    report["library_lesson"] = wait_for(
        lambda: page.evaluate("document.body.innerText.includes('新手導覽')"), 40, "Official lesson missing")
    (OUT / "guangyao-android-library.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))

    # The Puter sign-in window must open inside the app as a second WebView that keeps window.opener.
    page.evaluate("window.__signin = window.open('https://puter.com/', 'Puter', 'width=600,height=700'); true")

    def signin_page():
        return [p for p in devtools_pages() if "puter.com" in p.get("url", "")]
    signin_targets = wait_for(signin_page, 60, "Puter window did not open in the app")
    report["signin_window"] = True
    report["signin_has_opener"] = page.evaluate("!!window.__signin && !window.__signin.closed")

    # The sign-in page must actually render inside the dialog (not stay blank).
    signin = Page(signin_targets[0]["webSocketDebuggerUrl"])
    report["signin_page_text_length"] = wait_for(
        lambda: signin.evaluate("document.readyState === 'complete' && document.body ? document.body.innerText.trim().length : 0"),
        60,
        "Puter sign-in page stayed blank",
    )
    report["signin_page_title"] = signin.evaluate("document.title")
    signin.ws.close()
    time.sleep(2)
    (OUT / "guangyao-android-signin-window.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))

    # One Back press closes the sign-in dialog and returns to the app (a second press would leave the app).
    adb("shell", "input", "keyevent", "KEYCODE_BACK")
    report["signin_closed_by_back"] = bool(wait_for(lambda: not signin_page(), 20, "Back did not close the sign-in dialog"))
    report["app_still_open"] = page.evaluate("document.visibilityState") == "visible"
    assert report["app_still_open"], report

    # Any other new-window link leaves the app (no second WebView stays open for it).
    page.evaluate("window.open('https://example.com/handout.pdf', '_blank'); true")
    time.sleep(5)
    report["external_link_left_app"] = not any("example.com" in p.get("url", "") for p in devtools_pages())
    assert report["external_link_left_app"], report
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
    time.sleep(3)
    (OUT / "guangyao-android-home.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True))
    report["result"] = "passed"
    (OUT / "android-smoke-results.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except Exception:
        (OUT / "guangyao-android-failure.png").write_bytes(adb("exec-out", "screencap", "-p", binary=True, check=False))
        (OUT / "android-logcat.txt").write_text(adb("logcat", "-d", "-t", "3000", check=False), encoding="utf-8")
        raise
