"""Install the Sync debug APK on an Android emulator and test the app for real.

The app loads the live site in its WebView; we attach over Chrome DevTools (debug builds only). A desktop
Chrome on the CI machine joins the app's room as a friend. Checks:

1. native shell: Capacitor bridge + plugins, the web app detects the app, haptics work, a room opens
2. background playback: music keeps playing with the app in the background and with the screen off,
   the friend stays connected, and the foreground playback service + media session are active
3. lock-screen / headset controls: media keys pause and resume the whole room
4. voice chat inside the app: microphone works, both sides connect, the app hears the friend
"""
import json
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent.parent.parent
sys.path.insert(0, str(REPO / "apps/sync/tools"))
import browser_smoke as smoke  # noqa: E402  (desktop Chrome helpers shared with the web smoke test)

PACKAGE = "io.github.juw12.sync"
OUT = ROOT / "dist"
OUT.mkdir(exist_ok=True)
SITE = json.loads((ROOT / "capacitor.config.json").read_text())["server"]["url"]
SONG_SECONDS = 150
MAKE_SONG = smoke.MAKE_WAV.replace("seconds = 45", f"seconds = {SONG_SECONDS}")
PLAYER_STATE = """(function(){
  var r = __sync.room(), e = __sync.engine, s = r && r.state;
  return { playing: !!(s && s.playing), members: s ? s.members.length : 0, kind: e.kind,
           paused: e.player ? e.player.paused() : null, time: e.player ? e.player.time() : null };
})()"""

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


def screenshot(name):
    (OUT / name).write_bytes(adb("exec-out", "screencap", "-p", binary=True))


def foreground_service_running():
    services = adb("shell", "dumpsys", "activity", "services", PACKAGE, check_exit=False)
    return "SyncPlaybackService" in services and "isForeground=true" in services


def media_session_state():
    sessions = adb("shell", "dumpsys", "media_session", check_exit=False)
    block = sessions[sessions.find(PACKAGE):] if PACKAGE in sessions else ""
    match = re.search(r"state=PlaybackState \{state=(\w+)", block)
    return match.group(1) if match else None


def advance_while(page, label, action, seconds):
    """Run `action` (go home / screen off), wait, and check the song kept moving."""
    before = page.evaluate(PLAYER_STATE)
    action()
    time.sleep(seconds)
    after = page.evaluate(PLAYER_STATE)
    moved = (after["time"] or 0) - (before["time"] or 0)
    ok = after["playing"] and after["paused"] is False and moved >= seconds - 6
    check(f"music keeps playing {label}", ok, f"song moved {moved:.1f}s in {seconds}s, friend still in room: {after['members'] == 2}")
    check(f"friend stays connected {label}", after["members"] == 2, f"members {after['members']}")
    return ok


def main(apk):
    report["apk"] = Path(apk).name
    adb("install", "-r", "-g", apk)
    adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
    chrome = None
    profile = tempfile.mkdtemp(prefix="sync-friend-")
    try:
        page = sync_page()
        page.wait_for("typeof window.__sync === 'object' && !!document.querySelector('.landing, .room')", timeout=90)

        # --- 1. native shell ---------------------------------------------------------------------
        for attempt in range(10):  # the web app learns about the shell from 1.4 on; Pages may still be deploying
            if page.evaluate("__sync.native === true"):
                break
            time.sleep(15)
            page.evaluate("location.reload()")
            time.sleep(5)
            page = sync_page()
            page.wait_for("typeof window.__sync === 'object'", timeout=60)
        report["web_version"] = page.evaluate("__sync.version")
        check("app loads the live site and detects the native shell", page.evaluate("__sync.native === true"), report["web_version"])
        plugins = page.evaluate("['App','Haptics','Share','SyncPlayback'].filter(function(n){return Capacitor.isPluginAvailable(n);})")
        check("native plugins are available", set(plugins) == {"App", "Haptics", "Share", "SyncPlayback"}, ", ".join(plugins))
        haptics = page.evaluate("Capacitor.nativePromise('Haptics','impact',{style:'LIGHT'}).then(function(){return 'ok'}, function(e){return String(e && e.message)})")
        check("haptics fire", haptics == "ok", haptics)

        code = "A" + "".join(random.choice("BCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(5))
        page.evaluate(f"__sync.enter('{code}', true, 'Droid')", gesture=True)
        page.wait_for("__sync.room() && __sync.room().isHost && !!__sync.room().state", timeout=60)
        check("room opens inside the app", True, code)
        title = page.evaluate(MAKE_SONG, gesture=True)
        check("app shares a song", title == "Smoke Beat", str(title))

        # A friend on a desktop browser joins the app's room.
        chrome_path = shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium")
        chrome, debug_port, browser_ws = smoke.launch_chrome(chrome_path, profile)
        browser = smoke.DevTools(browser_ws)
        friend = smoke.Tab(browser, debug_port, f"{SITE}?room={code}")
        friend.js(f"__sync.enter('{code}', false, 'Desk')")
        joined = page.wait_for("__sync.room().state.members.length === 2", timeout=60)
        check("a desktop friend joins the app's room", bool(joined))
        friend.wait_for("(function(){var s=__sync.room().state;var f=s&&s.queue[0]&&s.queue[0].sources.file;return f&&!!__sync.room().fileUrl(f.fileId);})()", timeout=60)

        page.evaluate("__sync.room().intent({type:'play'})", gesture=True)
        page.wait_for("(function(){var e=__sync.engine;return e.player && !e.player.paused() && e.player.time() > 1;})()", timeout=30)
        time.sleep(3)
        check("playback service runs in the foreground", foreground_service_running())
        check("lock-screen player shows the song as playing", media_session_state() in ("3", "PLAYING"), f"media session state {media_session_state()}")
        screenshot("sync-android-playing.png")

        # --- 2. background + screen off ------------------------------------------------------------
        advance_while(page, "with the app in the background", lambda: adb("shell", "input", "keyevent", "KEYCODE_HOME"), 45)
        adb("shell", "cmd", "statusbar", "expand-notifications", check_exit=False)
        time.sleep(2)
        screenshot("sync-android-notification.png")
        adb("shell", "cmd", "statusbar", "collapse", check_exit=False)
        advance_while(page, "with the screen off", lambda: adb("shell", "input", "keyevent", "KEYCODE_SLEEP"), 45)
        adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        adb("shell", "wm", "dismiss-keyguard", check_exit=False)
        time.sleep(2)

        # --- 3. lock-screen / headset controls drive the whole room --------------------------------
        adb("shell", "input", "keyevent", "KEYCODE_MEDIA_PAUSE")
        paused = friend.wait_for("__sync.room().state && __sync.room().state.playing === false", timeout=15)
        check("lock-screen pause pauses everyone", bool(paused))
        adb("shell", "input", "keyevent", "KEYCODE_MEDIA_PLAY")
        resumed = friend.wait_for("__sync.room().state && __sync.room().state.playing === true", timeout=15)
        check("lock-screen play resumes everyone", bool(resumed))

        # --- 4. voice chat inside the app ----------------------------------------------------------
        adb("shell", "am", "start", "-n", PACKAGE + "/.MainActivity")
        time.sleep(3)
        join_voice = "(function(){window.__v='pending';__sync.voice().join().then(function(){window.__v='ok'}, function(e){window.__v=String(e && (e.name + ': ' + e.message))});return 1;})()"
        page.evaluate(join_voice, gesture=True)
        friend.js(join_voice)
        app_voice = page.wait_for("window.__v !== 'pending' && window.__v", timeout=30)
        check("microphone opens inside the app", app_voice == "ok", str(app_voice))
        both = page.wait_for("__sync.voice().connectedPeers().length === 1", timeout=30) and \
            friend.wait_for("__sync.voice().connectedPeers().length === 1", timeout=20)
        check("voice connects both ways (app <-> desktop)", bool(both))
        hears = page.wait_for("__sync.voice().othersSpeaking()", timeout=15)
        check("the app hears the friend talking", bool(hears))
        check("voice keeps the playback service alive", foreground_service_running())
        screenshot("sync-android-voice.png")

        page.evaluate("__sync.room().leave()")
    except Exception as error:
        check("test run finished without errors", False, str(error)[:400])
        screenshot("sync-android-failure.png")
        (OUT / "android-logcat.txt").write_text(adb("logcat", "-d", "-t", "3000", check_exit=False))
    finally:
        if chrome:
            chrome.terminate()
        shutil.rmtree(profile, ignore_errors=True)
        adb("shell", "am", "force-stop", PACKAGE, check_exit=False)
        failed = [c for c in report["checks"] if not c["ok"]]
        report["result"] = "passed" if not failed else "failed"
        (OUT / "android-e2e-results.json").write_text(json.dumps(report, indent=2))
        print(f"\n{len(report['checks']) - len(failed)}/{len(report['checks'])} checks passed")
    return 0 if report["result"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
