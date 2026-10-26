"""Exercise Sync's native-app integration in desktop Chrome with a fake Capacitor bridge.

The fake records every native call (SyncPlayback.update/stop, Haptics, Share, App...) and lets the test fire
native events (lock-screen buttons, Android Back) exactly the way the real bridge delivers them.
"""
import json
import random
import shutil
import sys
import tempfile
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import browser_smoke as smoke  # noqa: E402

FAKE_BRIDGE = r"""
(function () {
  var calls = [];
  var listeners = {};
  window.__native = { calls: calls, listeners: listeners,
    fire: function (plugin, eventName, data) {
      (listeners[plugin + ':' + eventName] || []).forEach(function (fn) { fn(data); });
      return (listeners[plugin + ':' + eventName] || []).length;
    } };
  window.Capacitor = {
    isNativePlatform: function () { return true; },
    getPlatform: function () { return 'android'; },
    isPluginAvailable: function () { return true; },
    nativePromise: function (plugin, method, options) {
      calls.push({ plugin: plugin, method: method, options: JSON.parse(JSON.stringify(options || {})) });
      return Promise.resolve({});
    },
    addListener: function (plugin, eventName, fn) {
      (listeners[plugin + ':' + eventName] = listeners[plugin + ':' + eventName] || []).push(fn);
      return { remove: function () {} };
    },
  };
})();
"""

results = []


def record(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def calls(tab, plugin, method=None):
    found = tab.js("JSON.stringify(window.__native.calls)")
    return [c for c in json.loads(found) if c["plugin"] == plugin and (method is None or c["method"] == method)]


def main():
    server, web_port = smoke.serve_web()
    profile = tempfile.mkdtemp(prefix="sync-native-")
    chrome, debug_port, browser_ws = smoke.launch_chrome(smoke.DEFAULT_CHROME, profile)
    code = "N" + "".join(random.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(5))
    base = f"http://127.0.0.1:{web_port}/index.html"
    try:
        browser = smoke.DevTools(browser_ws)
        app = smoke.Tab.__new__(smoke.Tab)
        app.target = browser.call("Target.createTarget", url="about:blank")["targetId"]
        app.dev = smoke.DevTools(f"ws://127.0.0.1:{debug_port}/devtools/page/{app.target}")
        app.dev.call("Page.enable")
        app.dev.call("Runtime.enable")
        app.dev.call("Emulation.setDeviceMetricsOverride", width=390, height=844, deviceScaleFactor=3, mobile=True)
        app.dev.call("Page.addScriptToEvaluateOnNewDocument", source=FAKE_BRIDGE)
        app.dev.call("Page.addScriptToEvaluateOnNewDocument", source=smoke.FAKE_MIC)
        app.dev.call("Page.navigate", url=base)
        app.wait_for("!!window.__sync", timeout=15)
        app.front()

        record("web app detects the native shell", app.js("__sync.native === true"))
        record("native listeners registered (Back, links, resume, lock screen)",
               app.js("['App:backButton','App:appUrlOpen','App:resume','SyncPlayback:action'].every(function(k){return (__native.listeners[k]||[]).length===1;})"))
        record("page marked as native app", app.js("document.documentElement.classList.contains('native-app') && document.documentElement.classList.contains('native-android')"))

        app.js(f"__sync.enter('{code}', true, 'Droid')")
        app.wait_for("__sync.room() && __sync.room().isHost && !!__sync.room().state", timeout=25)
        app.wait_for("JSON.stringify(__native.calls).indexOf('SyncPlayback') >= 0", timeout=5)
        first = calls(app, "SyncPlayback", "update")
        record("playback service starts when you enter a room",
               bool(first) and first[0]["options"]["room"] == "Room " + code and first[0]["options"]["playing"] is False,
               json.dumps(first[0]["options"]) if first else "no update call")

        title = app.js(smoke.MAKE_WAV)
        app.js("__sync.room().intent({type:'play'})")
        app.wait_for("(function(){var c=__native.calls.filter(function(c){return c.plugin==='SyncPlayback'&&c.method==='update'&&c.options.playing;});return c.length>0;})()", timeout=8)
        playing = [c for c in calls(app, "SyncPlayback", "update") if c["options"]["playing"]][-1]["options"]
        record("lock-screen player gets the song, artist and length",
               playing["title"] == title and playing["artist"] == "Test Artist" and 40000 < playing["durationMs"] < 50000,
               json.dumps(playing))
        updates_before = len(calls(app, "SyncPlayback", "update"))
        time.sleep(3)
        record("no flood of updates while nothing changes (<= 1 in 3 s)",
               len(calls(app, "SyncPlayback", "update")) - updates_before <= 1)

        # Lock-screen / notification buttons arrive as SyncPlayback 'action' events.
        app.js("__native.fire('SyncPlayback','action',{action:'pause'})")
        record("lock-screen Pause pauses the room", app.wait_for("__sync.room().state.playing === false", timeout=5))
        paused_update = app.wait_for("(function(){var c=__native.calls.filter(function(c){return c.plugin==='SyncPlayback'&&c.method==='update';});return c.length && c[c.length-1].options.playing===false;})()", timeout=5)
        record("notification switches to the Play button", bool(paused_update))
        app.js("__native.fire('SyncPlayback','action',{action:'play'})")
        record("lock-screen Play resumes the room", app.wait_for("__sync.room().state.playing === true", timeout=5))
        app.js("__native.fire('SyncPlayback','action',{action:'seek', position: 30})")
        record("lock-screen seek moves the room", app.wait_for("SyncCore.expectedPosition(__sync.room().state, __sync.room().hostNow()) > 29", timeout=5))

        # Haptics go through the native plugin (iPhone has no web vibration API).
        app.js("document.querySelector('#play').click()")  # pause (with a tap)
        app.js("document.querySelector('#play').click()")  # and play again
        impacts = calls(app, "Haptics", "impact")
        record("Play button taps use the native haptics plugin", len(impacts) >= 2, json.dumps(impacts[-1]["options"]) if impacts else "none")
        record("room still playing after pause + play", app.wait_for("__sync.room().state.playing === true", timeout=5))

        # Invite opens the native share sheet with the public link.
        app.js("document.querySelector('#invite').click()")
        share = calls(app, "Share", "share")
        record("invite opens the native share sheet with the public link",
               bool(share) and share[-1]["options"]["url"] == f"https://juw12.github.io/projects/sync/?room={code}",
               share[-1]["options"]["url"] if share else "no share call")

        # Android Back: closes a sheet, then returns to the player, then minimizes (room keeps playing).
        app.js("document.querySelector('#add-sheet').showModal()")
        record("(setup) add-music sheet is open", app.js("!!document.querySelector('#add-sheet[open]')"))
        app.js("__native.fire('App','backButton',{canGoBack:false})")
        record("Back closes an open sheet", app.js("!document.querySelector('dialog[open]')"))
        app.js("document.querySelector('.room').dataset.view = 'queue'")
        app.js("__native.fire('App','backButton',{canGoBack:false})")
        record("Back returns to the player", app.js("document.querySelector('.room').dataset.view === 'stage'"))
        app.js("__native.fire('App','backButton',{canGoBack:false})")
        record("Back on the player leaves the app but keeps the room",
               len(calls(app, "App", "minimizeApp")) == 1 and app.js("!!__sync.room() && __sync.room().state.playing === true"))

        # Leaving the room stops the playback service.
        app.js("document.querySelector('#leave').click()")
        record("leaving the room stops the playback service", len(calls(app, "SyncPlayback", "stop")) >= 1)
        app.js("__native.fire('App','backButton',{canGoBack:false})")
        record("Back on the home screen exits", len(calls(app, "App", "exitApp")) == 1)

        # Invite link opened from another app goes to the join screen.
        app.js("__native.fire('App','appUrlOpen',{url:'https://juw12.github.io/projects/sync/?room=ZZ9Y8X'})")
        record("invite link opens the join screen", app.wait_for("!!document.querySelector('#join-invite') && document.querySelector('#join-invite').textContent.indexOf('ZZ9Y8X') >= 0", timeout=5))
        errors = app.js("(window.__errors || []).length")
        record("no script errors", not errors, str(errors))
    finally:
        chrome.terminate()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
