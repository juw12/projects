"""Install the Kitty debug APK on an Android emulator and test the real app.

The app loads the live site in its WebView; we attach over Chrome DevTools (debug builds only) and check:

1. native shell: Capacitor bridge, the App/Haptics/Share plugins, the web app detects the app
2. security: secure context + WebCrypto (AES-GCM) work inside the WebView, so encrypted sharing works
3. the budgeting UI: demo budget renders, quick add opens, a haptic tap succeeds
4. Android Back button: closes the quick-add sheet instead of leaving the app
5. live sharing: the app connects to the public relay with an end-to-end encrypted room
6. invite links: the https deep-link filter for /projects/kitty/ is registered
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
PACKAGE = "io.github.juw12.kitty"
OUT = ROOT / "dist"
OUT.mkdir(exist_ok=True)
SITE = json.loads((ROOT / "capacitor.config.json").read_text())["server"]["url"]

report = {"site": SITE, "checks": []}


def check(name, ok, detail=""):
    report["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)
    return ok


def adb(*args, binary=False, check_exit=True):
    result = subprocess.run(["adb", *args], capture_output=True, check=check_exit)
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

    def evaluate(self, expression, gesture=False):
        self.next_id += 1
        self.ws.send(json.dumps({
            "id": self.next_id,
            "method": "Runtime.evaluate",
            "params": {"expression": expression, "awaitPromise": True, "returnByValue": True, "userGesture": gesture},
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


def kitty_page():
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
    raise AssertionError("The live Kitty site did not load in the app")


def screenshot(name):
    (OUT / name).write_bytes(adb("exec-out", "screencap", "-p", binary=True))


def app_in_foreground():
    focus = adb("shell", "dumpsys", "window", check_exit=False)
    return PACKAGE in "\n".join(line for line in focus.splitlines() if "mCurrentFocus" in line or "mFocusedApp" in line)


def wait_for_network(timeout=180):
    """A freshly booted emulator reports 'booted' before its network can reach the internet."""
    host = SITE.split("/")[2]
    deadline = time.time() + timeout
    while time.time() < deadline:
        if "VALIDATED" in adb("shell", "dumpsys", "connectivity", check_exit=False):
            print("network ready (Android validated internet access)", flush=True)
            return
        output = adb("shell", "ping", "-c", "1", "-W", "3", host, check_exit=False)
        if " 0% packet loss" in output or "1 received" in output:
            print(f"network ready ({host} reachable)", flush=True)
            return
        time.sleep(3)
    print(f"warning: {host} still unreachable after {timeout}s; launching anyway", flush=True)


def main(apk):
    report["apk"] = Path(apk).name
    adb("install", "-r", "-g", apk)
    wait_for_network()
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
    try:
        page = kitty_page()
        page.wait_for("window.__kittyReady === true", timeout=90)

        # --- 1. native shell ---------------------------------------------------------------------
        native = False
        for attempt in range(10):  # GitHub Pages may still be deploying the build that knows about the app
            native = page.evaluate("!!(window.__kittyNative && window.__kittyNative.native)")
            if native:
                break
            time.sleep(15)
            page.evaluate("location.reload()")
            time.sleep(3)
            page = kitty_page()
            page.wait_for("window.__kittyReady === true", timeout=90)
        check("web app detects the Android app", native, page.evaluate("JSON.stringify(window.__kittyNative || null)"))
        check("platform is android", page.evaluate("window.Capacitor.getPlatform()") == "android")
        plugins = page.evaluate("['App','Haptics','Share'].filter(function (p) { return window.Capacitor.isPluginAvailable(p); }).join(',')")
        check("App, Haptics and Share plugins available", plugins == "App,Haptics,Share", plugins)
        check("html marked native-app", page.evaluate("document.documentElement.classList.contains('native-app')"))

        # --- 2. secure context + WebCrypto ----------------------------------------------------------
        check("secure context", page.evaluate("window.isSecureContext === true"))
        crypto_ok = page.evaluate("""(async function () {
          var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
          var iv = crypto.getRandomValues(new Uint8Array(12));
          var data = new TextEncoder().encode('kitty budget');
          var sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
          var opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, sealed);
          return new TextDecoder().decode(opened) === 'kitty budget';
        })()""")
        check("AES-GCM encrypt/decrypt round trip in the WebView", crypto_ok)

        # --- 3. budgeting UI ------------------------------------------------------------------------
        page.evaluate("localStorage.clear(); location.href = location.href.split('#')[0].split('?')[0] + '?demo=1'")
        time.sleep(3)
        page = kitty_page()
        page.wait_for("window.__kittyReady === true && !!KittyApp.state.book", timeout=90)
        tx_count = page.evaluate("Object.keys(KittyApp.state.book.txns || {}).length")
        check("demo budget loads", tx_count and tx_count > 20, f"{tx_count} transactions")
        check("overview renders", page.wait_for("!!document.querySelector('.hero, .kpis, .card')", timeout=30))
        time.sleep(2)
        screenshot("kitty-android-overview.png")
        haptic = page.evaluate("window.Capacitor.nativePromise('Haptics', 'impact', { style: 'LIGHT' }).then(function () { return true; }, function (e) { return String(e); })")
        check("haptic tap works", haptic is True, str(haptic))

        # --- 4. Android Back button closes the sheet, not the app ------------------------------------
        page.evaluate("document.querySelectorAll('.toast').forEach(function (t) { t.remove(); }); document.querySelector('[data-act=quick-add]').click()")
        opened = page.wait_for("!!document.querySelector('.modal-wrap')", timeout=10)
        time.sleep(1)
        screenshot("kitty-android-quick-add.png")
        adb("shell", "input", "keyevent", "KEYCODE_BACK")
        time.sleep(2)
        closed = page.evaluate("!document.querySelector('.modal-wrap')")
        check("Back closes the quick-add sheet", opened and closed)
        check("app still open after Back", app_in_foreground())

        # --- 5. live encrypted sharing through the public relay --------------------------------------
        page.evaluate("history.replaceState(null, '', location.pathname + '?view=share'); KittyApp.state.view = 'share'; KittyApp.render()")
        page.wait_for("!!document.querySelector('[data-act=start-share]')", timeout=15)
        page.evaluate("document.querySelector('[data-act=start-share]').click()")
        status = page.wait_for("KittyApp.state.status === 'live' ? 'live' : ''", timeout=60)
        link = page.evaluate("(document.querySelector('#shareLink') || {}).value || ''")
        check("shared budget connects live", status == "live")
        check("invite link is a public https link", link.startswith(SITE) and "#join=" in link, link[:70] + "…")
        time.sleep(1)
        screenshot("kitty-android-share.png")

        # --- 6. invite deep link registered ----------------------------------------------------------
        package_dump = adb("shell", "dumpsys", "package", PACKAGE, check_exit=False)
        check("invite links open the app (intent filter)", "juw12.github.io" in package_dump and "/projects/kitty/" in package_dump)
    except Exception as error:
        check("test run completed", False, str(error)[:400])
    finally:
        try:
            screenshot("kitty-android-final.png")
            (OUT / "android-logcat.txt").write_text(adb("logcat", "-d", "-t", "2000", check_exit=False))
        except Exception:
            pass
        adb("shell", "am", "force-stop", PACKAGE, check_exit=False)
        (OUT / "android-e2e.json").write_text(json.dumps(report, indent=2))

    failed = [c["name"] for c in report["checks"] if not c["ok"]]
    print(f"\n{len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed", flush=True)
    if failed:
        print("Failed: " + ", ".join(failed), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1])
