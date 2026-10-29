#!/usr/bin/env python3
"""Install the Vitals APK on a running Android emulator, open it and check the dashboard renders.

    python3 apps/vitals/mobile/scripts/android-smoke.py apps/vitals/mobile/dist/Vitals-debug.apk

Reads the page through the WebView's DevTools socket (debug builds only), then saves a screenshot
(android-emulator.png) and the page state (android-page.json) next to the APK.
Needs adb on PATH and `pip install websocket-client`.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

import websocket

PACKAGE = "io.github.juw12.vitals"
PAGE_STATE = """(() => {
  const app = document.querySelector('#app');
  const text = app ? app.innerText.trim() : '';
  return {
    ready: !!app && app.children.length > 0 && text.length > 40,
    mobileLayout: document.body.classList.contains('m'),
    title: document.title,
    url: location.href,
    userAgent: navigator.userAgent,
    sample: text.slice(0, 300),
    phoneLive: /storage, memory, battery and temperature/.test(text) && /[KMGT]B free/.test(text),
  };
})()"""
# The VitalsPhone plugin (mobile/native/android) answers through the Capacitor bridge.
PHONE_SNAPSHOT = """(async () => {
  try {
    return await window.Capacitor.nativePromise('VitalsPhone', 'snapshot', {});
  } catch (problem) {
    return { error: String(problem && problem.message || problem) };
  }
})()"""


def adb(*args, check=True):
    result = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=180)
    if check and result.returncode != 0:
        raise SystemExit("adb %s failed: %s" % (" ".join(args), result.stderr.strip()))
    return result.stdout


def page_state(expression=PAGE_STATE):
    pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
    page = next(entry for entry in pages if entry.get("type") == "page")
    connection = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15, suppress_origin=True)
    try:
        connection.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "returnByValue": True, "awaitPromise": True},
        }))
        while True:
            reply = json.loads(connection.recv())
            if reply.get("id") == 1:
                return reply["result"]["result"]["value"]
    finally:
        connection.close()


def main():
    apk = os.path.abspath(sys.argv[1])
    out = os.path.dirname(apk)
    failures = []

    def check(condition, label):
        print(("  ok   " if condition else "  FAIL ") + label, flush=True)
        if not condition:
            failures.append(label)

    adb("wait-for-device")
    adb("install", "-r", apk)
    adb("logcat", "-c", check=False)
    adb("shell", "am", "start", "-W", "-n", PACKAGE + "/.MainActivity")

    pid = ""
    for _ in range(30):
        pid = adb("shell", "pidof", PACKAGE, check=False).strip()
        if pid:
            break
        time.sleep(1)
    check(bool(pid), "the app is running (pid %s)" % (pid or "-"))

    state = {}
    error = None
    if pid:
        adb("forward", "tcp:9222", "localabstract:webview_devtools_remote_" + pid.split()[0])
        for _ in range(45):
            try:
                state = page_state() or {}
                if state.get("ready"):
                    break
            except Exception as problem:  # the WebView may still be starting
                error = problem
            time.sleep(2)

    phone = {}
    if state.get("ready"):
        try:
            phone = page_state(PHONE_SNAPSHOT) or {}
        except Exception as problem:
            phone = {"error": str(problem)}
        # give the home screen a moment to show the phone's own readings
        for _ in range(10):
            state = page_state() or state
            if state.get("phoneLive"):
                break
            time.sleep(1)

    with open(os.path.join(out, "android-emulator.png"), "wb") as handle:
        handle.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60).stdout)
    with open(os.path.join(out, "android-page.json"), "w", encoding="utf-8") as handle:
        json.dump({"state": state, "phone": phone, "error": str(error) if error else None}, handle, indent=2)

    check(state.get("ready") is True, "the dashboard rendered: %r" % (state.get("sample", "")[:80] or error))
    check(state.get("mobileLayout") is True, "it uses the phone layout")
    check("VitalsApp/" in state.get("userAgent", ""), "the native app identifies itself (VitalsApp user agent)")
    check(state.get("url", "").startswith("https://localhost/"), "the bundled files are served offline (%s)" % state.get("url"))
    check(phone.get("platform") == "android" and phone.get("storageTotal", 0) > 0,
          "the phone plugin reads storage (%s)" % (phone.get("error") or "%.1f GB" % (phone.get("storageTotal", 0) / 1e9)))
    check(phone.get("memoryTotal", 0) > 0 and "batteryPercent" in phone,
          "the phone plugin reads memory and battery (%s%% battery)" % phone.get("batteryPercent"))
    check(state.get("phoneLive") is True, "the home screen shows this phone's own readings")
    crashes = [line for line in adb("logcat", "-d", "-b", "crash", check=False).splitlines() if PACKAGE in line]
    check(not crashes, "no crash in logcat")

    if failures:
        print("\n%d check(s) failed" % len(failures))
        sys.exit(1)
    print("\nVitals for Android opens, checks the phone itself and shows the dashboard")


if __name__ == "__main__":
    main()
