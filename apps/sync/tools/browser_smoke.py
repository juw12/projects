#!/usr/bin/env python3
"""Live two-browser smoke test for Sync (real WebRTC through the PeerJS cloud).

Launches an isolated headless Chrome (temporary profile), serves web/ on a free
localhost port, opens a host tab and a guest tab and checks, end to end:

  * the guest finds the room by code and receives the host's state
  * a shared audio file transfers peer-to-peer and plays in sync
  * the guest's clock is deliberately skewed by +3.7 s to prove offset correction
  * play / seek / pause / guest control / chat / reactions
  * voice chat connects both ways (fake microphone)
  * YouTube playback stays in sync (needs youtube.com)
  * host migration: closing the host tab hands the room to the guest

Needs Google Chrome and internet. Not part of CI (tests/test_sync.py is).
Usage: python3 apps/sync/tools/browser_smoke.py [--chrome PATH] [--screenshot OUT.png]
"""

import argparse
import functools
import http.server
import json
import os
import random
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from devtools import DevTools  # noqa: E402

WEB = Path(__file__).resolve().parent.parent / "web"
DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
GUEST_CLOCK_SKEW_MS = 3700

# macOS blocks microphone capture for headless Chrome, so tabs get a synthetic
# "microphone" (a WebAudio tone). Everything after capture — WebRTC calls,
# remote playback, speaking detection and music ducking — runs for real.
FAKE_MIC = """(function(){
  if (!navigator.mediaDevices) { return; }
  navigator.mediaDevices.getUserMedia = function () {
    var ctx = new (window.AudioContext || window.webkitAudioContext)();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    gain.gain.value = 0.4;
    osc.frequency.value = 220;
    var dest = ctx.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    return Promise.resolve(dest.stream);
  };
})();"""

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f" — {detail}" if detail else ""), flush=True)


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def serve_web():
    port = free_port()
    handler = functools.partial(QuietHandler, directory=str(WEB))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, port


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def launch_chrome(chrome, profile):
    port = free_port()
    process = subprocess.Popen([
        chrome,
        "--headless=new",
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile}",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--mute-audio",
        # Keep both "listeners" running at full speed even when the Mac's screen is locked or the
        # test windows are covered; otherwise Chrome throttles their timers and the sync loop stalls.
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--window-size=1440,1000",
        "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(100):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as response:
                return process, port, json.loads(response.read())["webSocketDebuggerUrl"]
        except OSError:
            time.sleep(0.1)
    process.kill()
    raise RuntimeError("Chrome did not start")


class Tab:
    def __init__(self, browser, debug_port, url, skew_ms=0, width=1440, height=1000, new_window=False):
        # new_window: a separate window keeps both listeners "on screen", like two people on two devices.
        # (Two tabs in one window means one is a hidden background tab, where YouTube may not start.)
        self.target = browser.call("Target.createTarget", url="about:blank", newWindow=new_window)["targetId"]
        self.dev = DevTools(f"ws://127.0.0.1:{debug_port}/devtools/page/{self.target}")
        self.dev.call("Page.enable")
        self.dev.call("Runtime.enable")
        self.dev.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)
        self.dev.call("Page.addScriptToEvaluateOnNewDocument", source=FAKE_MIC)
        if skew_ms:
            self.dev.call("Page.addScriptToEvaluateOnNewDocument", source=(
                # Adjustable so the YouTube check can switch it off: a real phone's wrong clock is wrong for
                # the YouTube frame too, but this override only reaches our page, which skews YouTube's own
                # position estimate (it extrapolates with Date.now) by up to ~0.7 s.
                "(function(){var real=Date.now;window.__skewMs=%d;Date.now=function(){return real()+window.__skewMs;};})();" % skew_ms
            ))
        self.dev.call("Page.navigate", url=url)
        self.wait_for("!!window.__sync", timeout=15)
        self.front()

    def front(self):
        # Like a person clicking into the tab. Chrome defers media loading in
        # tabs that have never been in the foreground.
        self.dev.call("Page.bringToFront")

    def js(self, expression):
        return self.dev.evaluate(expression)

    def wait_for(self, expression, timeout=20, interval=0.25):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                last = self.js(expression)
                if last:
                    return last
            except RuntimeError as error:
                last = str(error)
            time.sleep(interval)
        return None


SAMPLE = """(function(){
  var r = __sync.room(), e = __sync.engine, s = r && r.state;
  if (!s || !e.player || e.loading) return null;
  var expected = SyncCore.expectedPosition(s, r.hostNow());
  return { time: e.player.time(), expected: expected, playing: s.playing, paused: e.player.paused(),
           kind: e.kind, offset: r.offset, rtt: r.rtt || 0, index: s.index, v: s.v, err: e.error };
})()"""

MAKE_WAV = """(async function(){
  var rate = 22050, seconds = 45, n = rate * seconds;
  var buffer = new ArrayBuffer(44 + n * 2), view = new DataView(buffer);
  function str(o, s){ for (var i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); }
  str(0,'RIFF'); view.setUint32(4, 36 + n*2, true); str(8,'WAVE'); str(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  str(36,'data'); view.setUint32(40, n*2, true);
  for (var i = 0; i < n; i++) {
    var t = i / rate, click = (t % 0.5) < 0.01 ? 0.6 : 0;
    view.setInt16(44 + i*2, Math.round((0.25*Math.sin(2*Math.PI*440*t) + click) * 32767 * 0.8), true);
  }
  var file = new File([buffer], 'Test Artist - Smoke Beat.wav', { type: 'audio/wav' });
  var track = await __sync.shareFile(file);
  return track.title;
})()"""


def drift_of(sample):
    return None if not sample else sample["time"] - sample["expected"]


PLAYER_TIME = "(function(){var e=__sync.engine;return e.player&&!e.loading&&!e.player.paused()?e.player.time():null;})()"


def cross_drift(host, guest, samples=6):
    """True sync: guest position minus host position at the same real moment.

    Both tabs run on this machine, so wall time is shared. Host is sampled
    before and after the guest and interpolated to the guest's sample time,
    which removes the evaluation latency between the two calls.
    """
    values = []
    for _ in range(samples):
        t1 = time.perf_counter()
        h1 = host.js(PLAYER_TIME)
        t2 = time.perf_counter()
        g = guest.js(PLAYER_TIME)
        t3 = time.perf_counter()
        h2 = host.js(PLAYER_TIME)
        t4 = time.perf_counter()
        if None in (h1, g, h2):
            time.sleep(0.3)
            continue
        host_mid_1 = (t1 + t2) / 2
        host_mid_2 = (t3 + t4) / 2
        guest_mid = (t2 + t3) / 2
        if host_mid_2 - host_mid_1 <= 0:
            continue
        host_at_guest = h1 + (h2 - h1) * (guest_mid - host_mid_1) / (host_mid_2 - host_mid_1)
        values.append(g - host_at_guest)
        time.sleep(0.3)
    if not values:
        return None
    values.sort()
    return values[len(values) // 2]


def measure(tab, label, samples=6):
    drifts = []
    for _ in range(samples):
        sample = tab.js(SAMPLE)
        if sample and not sample["paused"]:
            drifts.append(drift_of(sample))
        time.sleep(0.4)
    if not drifts:
        return None
    drifts.sort()
    return drifts[len(drifts) // 2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chrome", default=os.environ.get("CHROME", DEFAULT_CHROME))
    parser.add_argument("--skip-youtube", action="store_true")
    parser.add_argument("--screenshot", default="")
    args = parser.parse_args()
    if not Path(args.chrome).exists() and not shutil.which(args.chrome):
        print("SKIPPED: Chrome not found")
        return 0

    server, web_port = serve_web()
    profile = tempfile.mkdtemp(prefix="sync-smoke-")
    chrome, debug_port, browser_ws = launch_chrome(args.chrome, profile)
    code = "T" + "".join(random.choice("ABCDEFGHJKMNPQRSTUVWXYZ23456789") for _ in range(5))
    base = f"http://127.0.0.1:{web_port}/index.html"
    try:
        browser = DevTools(browser_ws)
        host = Tab(browser, debug_port, base)
        host.js(f"__sync.enter('{code}', true, 'Hana')")
        ready = host.wait_for("__sync.room() && __sync.room().isHost && !!__sync.room().state", timeout=25)
        record("host opens room via PeerJS signaling", bool(ready), f"code {code}")
        if not ready:
            return 1

        title = host.js(MAKE_WAV)
        record("host shares a local audio file", title == "Smoke Beat", str(title))

        guest = Tab(browser, debug_port, f"{base}?room={code}", skew_ms=GUEST_CLOCK_SKEW_MS, new_window=True)
        guest.js(f"__sync.enter('{code}', false, 'Gus')")
        joined = guest.wait_for("__sync.room() && __sync.room().state && __sync.room().state.members.length === 2", timeout=30)
        record("guest joins by room code (WebRTC data channel)", bool(joined))
        if not joined:
            return 1
        got_file = guest.wait_for(
            "(function(){var s=__sync.room().state;var f=s.queue[0]&&s.queue[0].sources.file;return f&&!!__sync.room().fileUrl(f.fileId);})()",
            timeout=30,
        )
        record("shared file transfers peer-to-peer to the guest", bool(got_file))

        time.sleep(2.5)  # let the ping burst settle the clock estimate
        offset = guest.js("__sync.room().offset")
        record("guest estimates host clock offset (skew -3700 ms)",
               offset is not None and abs(offset + GUEST_CLOCK_SKEW_MS) < 60, f"offset {offset:.1f} ms" if offset is not None else "none")

        host.js("__sync.room().intent({type:'play'})")
        time.sleep(5)
        host_drift = measure(host, "host")
        guest_drift = measure(guest, "guest")
        ok = host_drift is not None and guest_drift is not None and abs(host_drift) < 0.06 and abs(guest_drift) < 0.06
        record("each browser tracks the room clock (shared file)", ok,
               f"host {host_drift * 1000:+.0f} ms, guest {guest_drift * 1000:+.0f} ms" if host_drift is not None and guest_drift is not None else f"{host_drift} / {guest_drift}")
        between = cross_drift(host, guest)
        record("guest and host hear the same moment (shared file)", between is not None and abs(between) < 0.05,
               f"guest vs host {between * 1000:+.0f} ms" if between is not None else "no samples")

        host.js("__sync.room().intent({type:'seek', position: 20})")
        time.sleep(3)
        guest_sample = guest.js(SAMPLE)
        guest_drift = measure(guest, "guest")
        record("seek propagates and re-syncs", guest_sample and 21 < guest_sample["time"] < 26 and guest_drift is not None and abs(guest_drift) < 0.08,
               f"guest at {guest_sample['time']:.2f}s, drift {guest_drift * 1000:+.0f} ms" if guest_sample and guest_drift is not None else str(guest_sample))

        guest.js("__sync.room().intent({type:'pause'})")
        time.sleep(1.5)
        a = host.js(SAMPLE)
        b = guest.js(SAMPLE)
        time.sleep(1.0)
        a2 = host.js(SAMPLE)
        record("guest can pause for everyone", a and b and a["paused"] and b["paused"] and abs(a2["time"] - a["time"]) < 0.01,
               f"host paused at {a['time']:.2f}s, guest {b['time']:.2f}s" if a and b else "")
        guest.js("__sync.room().intent({type:'play'})")

        guest.js("__sync.room().chat('hello from the guest')")
        host.js("__sync.room().react('🔥')")
        chat_ok = host.wait_for("document.querySelector('#chat-log').textContent.indexOf('hello from the guest') >= 0", timeout=5)
        react_ok = guest.wait_for("document.querySelectorAll('#reactions .float').length > 0", timeout=5)
        record("chat reaches the host", bool(chat_ok))
        record("reactions reach the guest", bool(react_ok))

        join_voice = "(function(){window.__v='pending';__sync.voice().join().then(function(){window.__v='ok'}, function(e){window.__v=e.message});return 1;})()"
        host.js(join_voice)
        guest.js(join_voice)
        voice_ok = host.wait_for("__sync.voice().connectedPeers().length === 1", timeout=20) and \
            guest.wait_for("__sync.voice().connectedPeers().length === 1", timeout=10)
        record("voice chat connects both ways (WebRTC audio)", bool(voice_ok), f"host:{host.js('window.__v')} guest:{guest.js('window.__v')}")
        speaking = host.wait_for("__sync.voice().othersSpeaking()", timeout=8)
        ducked = host.wait_for("__sync.engine.appliedVolume !== null && __sync.engine.appliedVolume <= 0.35", timeout=8)
        record("host hears the guest talking and ducks the music", bool(speaking) and bool(ducked),
               f"music volume {host.js('__sync.engine.appliedVolume')}")
        guest.js("__sync.voice().setMuted(true)")
        restored = host.wait_for("__sync.engine.appliedVolume >= 0.95", timeout=8)
        record("music comes back up when the guest mutes", bool(restored), f"music volume {host.js('__sync.engine.appliedVolume')}")
        guest.js("__sync.voice().setMuted(false)")

        # Lock-screen / notification controls (Media Session API).
        session = guest.wait_for("(function(){var m=__sync.mediaSession();return m && m.title === 'Smoke Beat' && m.state === 'playing' ? m : null;})()", timeout=5)
        record("lock-screen controls show the song (Media Session)", bool(session), json.dumps(guest.js("__sync.mediaSession()")))

        # A phone that sleeps or swaps Wi-Fi for mobile data loses *its own* link while the
        # host is still there. It must rejoin as a guest, not fight the live host for the room.
        guest.js("__sync.room().hostConn.close()")
        back_in = guest.wait_for(
            "(function(){var r=__sync.room();return !!r.hostConn && !r.isHost && r.state && r.state.members.length === 2;})()",
            timeout=40, interval=0.5)
        still_host = host.js("__sync.room().isHost")
        time.sleep(3)
        drift = measure(guest, "guest after reconnect", samples=4)
        guest_status = guest.js("(document.querySelector('#conn') || {}).textContent")
        if drift is None:
            print("  guest sample after reconnect:", json.dumps(guest.js(SAMPLE)),
                  json.dumps(guest.js("({kind: __sync.engine.kind, loading: __sync.engine.loading, err: __sync.engine.error, player: !!__sync.engine.player})")))
        record("guest whose own link drops rejoins the live host", bool(back_in) and still_host is True and drift is not None and abs(drift) < 0.08,
               f"host still host: {still_host}, guest drift {drift * 1000:+.0f} ms" if drift is not None else
               f"rejoined={bool(back_in)} host={still_host} status={guest_status}")

        if not args.skip_youtube:
            # Clock-offset correction was proven above; from here give the guest a consistent (unskewed)
            # clock, shifting its learned offset to match and dropping the old ping samples.
            guest.js(f"(function(){{var r=__sync.room();window.__skewMs=0;r.offset+={GUEST_CLOCK_SKEW_MS};r.samples=[];return r.offset;}})()")
            host.js("__sync.room().intent({type:'enqueue', track:{id:'yt1', title:'Me at the zoo', artist:'jawed', duration:19, sources:{youtube:'jNQXAC9IVRw'}}})")
            time.sleep(0.5)
            host.front()
            host.js("__sync.room().intent({type:'select', index: 1})")
            loaded = host.wait_for("__sync.engine.kind === 'youtube' && !__sync.engine.loading && !__sync.engine.error", timeout=25)
            guest.front()
            loaded = loaded and guest.wait_for("__sync.engine.kind === 'youtube' && !__sync.engine.loading && !__sync.engine.error", timeout=25)
            if loaded:
                # Measure once both listeners show "In sync" (what people see). The test video is only 19 s
                # (longer ones are too heavy for headless Chrome on a small Mac), so wait for both at once and,
                # if the song already ended on a slow run, play it again (warm cache) and measure that.
                in_sync = "(document.querySelector('#sync-pill') || {}).textContent.indexOf('In sync') === 0"
                settled = False
                for attempt in range(2):
                    deadline = time.time() + 9
                    while time.time() < deadline and not settled:
                        settled = bool(host.js(in_sync)) and bool(guest.js(in_sync))
                        if not settled:
                            time.sleep(0.3)
                    if settled or attempt == 1:
                        break
                    host.js("__sync.room().intent({type:'select', index: 1})")
                host_drift = measure(host, "host", samples=4)
                guest_drift = measure(guest, "guest", samples=4)
                between = cross_drift(host, guest, samples=4)
                ok = between is not None and abs(between) < 0.4
                record("YouTube: guest and host hear the same moment", ok and bool(settled),
                       f"guest vs host {between * 1000:+.0f} ms (settled: {bool(settled)}, room-clock drift host {host_drift}, guest {guest_drift})" if between is not None else
                       f"no samples (host {host.js(SAMPLE)}, guest {guest.js(SAMPLE)})")
            else:
                record("YouTube playback in sync on both browsers", False,
                       f"host err={host.js('__sync.engine.error')} guest err={guest.js('__sync.engine.error')}")
            host.js("__sync.room().intent({type:'select', index: 0})")
            time.sleep(2)

        if args.screenshot:
            shot = host.dev.call("Page.captureScreenshot", format="png")
            import base64
            Path(args.screenshot).write_bytes(base64.b64decode(shot["data"]))
            print("screenshot:", args.screenshot)

        queue_len = guest.js("__sync.room().state.queue.length")
        browser.call("Target.closeTarget", targetId=host.target)
        took_over = guest.wait_for("__sync.room().isHost === true && !!__sync.room().state", timeout=40, interval=0.5)
        state = guest.js("(function(){var s=__sync.room().state;return {q:s.queue.length, playing:s.playing, members:s.members.length};})()")
        takeover_status = guest.js("(document.querySelector('#conn') || {}).textContent")
        record("host leaves: guest takes over the room", bool(took_over) and state and state["q"] == queue_len,
               json.dumps(state) + f" status={takeover_status!r}")
        if took_over:
            time.sleep(2.5)
            drift = measure(guest, "new host", samples=4)
            record("playback continues after takeover", drift is not None and abs(drift) < 0.1,
                   f"drift {drift * 1000:+.0f} ms" if drift is not None else "not playing")
            rejoin = Tab(browser, debug_port, f"{base}?room={code}")
            rejoin.js(f"__sync.enter('{code}', false, 'Rae')")
            back = rejoin.wait_for("__sync.room() && __sync.room().state && __sync.room().state.members.length === 2", timeout=30)
            record("a new guest can join the migrated room", bool(back))
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=10)
        except subprocess.TimeoutExpired:
            chrome.kill()
        server.shutdown()
        shutil.rmtree(profile, ignore_errors=True)

    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
