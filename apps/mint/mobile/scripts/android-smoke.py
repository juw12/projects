#!/usr/bin/env python3
"""Install the Mint APK on a running Android emulator, open it and check Mint loads inside the app.

    python3 apps/mint/mobile/scripts/android-smoke.py apps/mint/mobile/dist/Mint-debug.apk

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

PACKAGE = "io.github.juw12.mint"
SITE = "https://juw12.github.io/projects/mint/"
PAGE_STATE = """(() => {
  const C = window.Capacitor;
  const has = (name) => !!(C && C.isPluginAvailable && C.isPluginAvailable(name));
  return {
    title: document.title,
    url: location.href,
    userAgent: navigator.userAgent,
    native: !!(C && C.isNativePlatform && C.isNativePlatform()),
    plugins: { Filesystem: has('Filesystem'), Share: has('Share'), App: has('App'), Haptics: has('Haptics') },
    locale: !!window.MintLocale,
    gate: !!document.querySelector('.mint-locale'),
    budget: !!window.MintBudget,
    sample: (document.body ? document.body.innerText : '').trim().slice(0, 200),
  };
})()"""


def adb(*args, check=True):
    result = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=180)
    if check and result.returncode != 0:
        raise SystemExit("adb %s failed: %s" % (" ".join(args), result.stderr.strip()))
    return result.stdout


def page_state():
    pages = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json", timeout=5))
    page = next(entry for entry in pages if entry.get("type") == "page")
    connection = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15, suppress_origin=True)
    try:
        connection.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {"expression": PAGE_STATE, "returnByValue": True},
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
    warnings = []

    def check(condition, label, soft=False):
        print(("  ok   " if condition else ("  warn " if soft else "  FAIL ")) + label, flush=True)
        if not condition:
            (warnings if soft else failures).append(label)

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
        for _ in range(60):
            try:
                state = page_state() or {}
                if state.get("locale") and "/budget/" in state.get("url", ""):
                    break
            except Exception as problem:  # the WebView may still be starting
                error = problem
            time.sleep(2)

    with open(os.path.join(out, "android-emulator.png"), "wb") as handle:
        handle.write(subprocess.run(["adb", "exec-out", "screencap", "-p"], capture_output=True, timeout=60).stdout)
    with open(os.path.join(out, "android-page.json"), "w", encoding="utf-8") as handle:
        json.dump({"state": state, "error": str(error) if error else None}, handle, indent=2)

    plugins = state.get("plugins") or {}
    check(state.get("url", "").startswith(SITE), "it opens Mint (%s)" % (state.get("url") or error))
    check("Mint" in state.get("title", ""), "the page is Mint (%r)" % state.get("title"))
    check(state.get("native") is True, "the page runs inside the native app")
    check("MintApp/" in state.get("userAgent", ""), "the app identifies itself (MintApp user agent)")
    for name in ("Filesystem", "Share", "App", "Haptics"):
        check(plugins.get(name) is True, "native %s plugin is available" % name)
    check("/budget/" in state.get("url", ""), "it lands on Budget")
    # The site may still be deploying when this runs right after a push; the shell itself is what's tested here.
    check(state.get("locale") is True, "the language & region screen script is live", soft=True)
    crashes = [line for line in adb("logcat", "-d", "-b", "crash", check=False).splitlines() if PACKAGE in line]
    check(not crashes, "no crash in logcat")

    if warnings:
        print("\n%d warning(s)" % len(warnings))
    if failures:
        print("%d check(s) failed" % len(failures))
        sys.exit(1)
    print("\nMint for Android opens and shows Mint")


if __name__ == "__main__":
    main()
