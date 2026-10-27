"""Earning features end-to-end in desktop Chrome (two listeners), with test values for the owner settings.

Checks: everything stays hidden with an empty config; the tip jar link (with UTM tags), the supporter badge that
friends see live, the one-time gentle prompt after 20 min of listening together, Apple Music links that carry the
affiliate token, Spotify links, and that the tip jar is never shown inside the native store apps.
"""
import json
import random
import shutil
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import browser_smoke as smoke  # noqa: E402

TEST_SUPPORT = "https://ko-fi.com/sync-test"
TEST_TOKEN = "TESTAT123"
WITH_CONFIG = """(function(){
  var value;
  Object.defineProperty(window, 'SYNC_CONFIG', { configurable: true,
    get: function(){ return value; },
    set: function(v){ v.supportUrl = '%s'; v.appleAffiliateToken = '%s'; value = v; } });
  window.__opened = [];
  window.open = function(url){ window.__opened.push(url); return null; };
})();""" % (TEST_SUPPORT, TEST_TOKEN)
FAKE_NATIVE = """window.Capacitor = { isNativePlatform: function(){return true;}, getPlatform: function(){return 'ios';},
  isPluginAvailable: function(){return true;}, nativePromise: function(){return Promise.resolve({});},
  addListener: function(){ return { remove: function(){} }; } };"""

results = []


def record(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def open_tab(browser, debug_port, url, scripts=(), new_window=False):
    tab = smoke.Tab.__new__(smoke.Tab)
    tab.target = browser.call("Target.createTarget", url="about:blank", newWindow=new_window)["targetId"]
    tab.dev = smoke.DevTools(f"ws://127.0.0.1:{debug_port}/devtools/page/{tab.target}")
    tab.dev.call("Page.enable")
    tab.dev.call("Runtime.enable")
    for source in scripts:
        tab.dev.call("Page.addScriptToEvaluateOnNewDocument", source=source)
    tab.dev.call("Page.navigate", url=url)
    tab.wait_for("!!window.__sync", timeout=15)
    tab.front()
    return tab


def main():
    server, port = smoke.serve_web()
    profile = tempfile.mkdtemp(prefix="sync-earning-")
    chrome, debug_port, ws = smoke.launch_chrome(smoke.DEFAULT_CHROME, profile)
    base = f"http://127.0.0.1:{port}/index.html"
    code = "E" + "".join(random.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(5))
    try:
        browser = smoke.DevTools(ws)

        # 1. Empty config: nothing shows.
        plain = open_tab(browser, debug_port, base)
        earning = plain.js("__sync.earning()")
        record("empty config: earning switched off", not earning["supportEnabled"] and not earning["appleToken"], json.dumps(earning))
        record("empty config: no support link on the home screen", plain.js("!document.querySelector('#support-link')"))
        browser.call("Target.closeTarget", targetId=plain.target)

        # 2. Owner config: tip jar + supporter badge seen by a friend.
        host = open_tab(browser, debug_port, base, [WITH_CONFIG])
        record("support link on the home screen", host.js("!!document.querySelector('#support-link')"))
        host.js(f"__sync.enter('{code}', true, 'Hana')")
        host.wait_for("__sync.room() && __sync.room().isHost && !!__sync.room().state", timeout=25)
        guest = open_tab(browser, debug_port, f"{base}?room={code}", [WITH_CONFIG], new_window=True)
        guest.js(f"__sync.enter('{code}', false, 'Gus')")
        guest.wait_for("__sync.room().state && __sync.room().state.members.length === 2", timeout=30)

        host.js("document.querySelector('#settings-btn').click()")
        record("settings shows the Support Sync box", host.js("!document.querySelector('#support-box').hidden && !!document.querySelector('#support-btn')"))
        host.js("document.querySelector('#support-btn').click()")
        opened = host.js("window.__opened")
        record("Support opens the tip jar with tracking tags",
               bool(opened) and opened[-1].startswith(TEST_SUPPORT + "?utm_source=sync&utm_medium=settings"), str(opened))
        badge = guest.wait_for(
            "(function(){var li=[].slice.call(document.querySelectorAll('#members li')).filter(function(l){return l.textContent.indexOf('Hana')>=0;})[0];return li && !!li.querySelector('.tag-supporter');})()",
            timeout=8)
        record("friend sees the host's ♥ supporter badge right away", bool(badge))
        record("badge toggle appears after supporting", host.js("!!document.querySelector('#badge-toggle')"))
        host.js("var t=document.querySelector('#badge-toggle'); t.checked=false; t.dispatchEvent(new Event('change'))")
        hidden = guest.wait_for(
            "(function(){var li=[].slice.call(document.querySelectorAll('#members li')).filter(function(l){return l.textContent.indexOf('Hana')>=0;})[0];return li && !li.querySelector('.tag-supporter');})()",
            timeout=8)
        record("turning the badge off hides it for friends", bool(hidden))
        host.js("document.querySelector('#settings').close()")

        # 3. Apple Music affiliate + Spotify links.
        host.js("__sync.room().intent({type:'enqueue', track:{id:'a1', title:'Blinding Lights', artist:'The Weeknd', duration:200, "
                "artwork:'', sources:{apple:'1488408568', spotify:'0VjIjW4GlUZAMYd2vXMi3b', youtube:'4NRXx6U8ABQ'}}})")
        host.js("__sync.room().intent({type:'select', index:0})")
        links = guest.wait_for("(function(){var b=document.querySelector('#np-open');return b && !b.hidden ? [].map.call(b.querySelectorAll('a'), function(a){return a.href;}) : null;})()", timeout=8)
        apple = [l for l in (links or []) if "music.apple.com" in l]
        spotify = [l for l in (links or []) if "open.spotify.com" in l]
        record("Apple Music link carries the affiliate token",
               bool(apple) and "song/1488408568" in apple[0] and f"at={TEST_TOKEN}" in apple[0] and "ct=sync" in apple[0], apple[0] if apple else str(links))
        record("Spotify link points at the track", bool(spotify) and spotify[0].endswith("/track/0VjIjW4GlUZAMYd2vXMi3b"), spotify[0] if spotify else "")

        # 4. One gentle prompt after 20 min listening together (guest has not supported).
        host.js("__sync.room().intent({type:'play'})")
        guest.js("__sync._listenFor(20 * 60)")
        prompt = guest.wait_for("[].some.call(document.querySelectorAll('#toasts .toast button'), function(b){return b.textContent==='Support';})", timeout=6)
        record("one gentle Support prompt after 20 min together", bool(prompt))
        asked = guest.js("JSON.parse(localStorage.getItem('sync.prefs')).supportAskedAt > 0")
        guest.js("__sync._listenFor(40 * 60)")
        time.sleep(1.5)
        count = guest.js("[].filter.call(document.querySelectorAll('#toasts .toast button'), function(b){return b.textContent==='Support';}).length")
        record("never asks twice in a month", asked and count == 1, f"prompts shown: {count}")

        # 5. Store apps: no tip jar, links still there.
        app = open_tab(browser, debug_port, base, [WITH_CONFIG, FAKE_NATIVE])
        earning = app.js("__sync.earning()")
        record("native store app hides the tip jar", not earning["supportEnabled"] and app.js("!document.querySelector('#support-link')"), json.dumps(earning))
    finally:
        chrome.terminate()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
