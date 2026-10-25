"""Render a Shortcraft project JSON to MP4 without opening a window.

1. Neural voice per scene (edge-tts) unless the project already has voice clips.
2. Headless Chrome loads the studio, injects the project + voices and runs the same
   in-browser export the user would click (Chrome DevTools Protocol).
3. ffmpeg re-times to constant 30 fps and normalises loudness to -14 LUFS.

Requires: Google Chrome, `pip install websocket-client edge-tts imageio-ffmpeg`.
"""

import base64
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import imageio_ffmpeg
import websocket

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]
VOICES = {"en": ("en-US-AndrewNeural", "+4%"), "id": ("id-ID-ArdiNeural", "+6%")}


def chrome_path():
    for path in CHROME_CANDIDATES:
        if Path(path).exists():
            return path
    found = shutil.which("google-chrome") or shutil.which("chromium")
    if not found:
        raise SystemExit("Google Chrome not found")
    return found


def make_voices(project, out_dir):
    """Neural voice per scene. A project can override the voice with
    "voiceConfig": {"name": "id-ID-GadisNeural", "rate": "+0%", "pitch": "+0Hz"}."""
    tool = shutil.which("edge-tts") or str(Path(sys.executable).with_name("edge-tts"))
    voice, rate = VOICES.get(project.get("lang", "en"), VOICES["en"])
    pitch = "+0Hz"
    override = project.get("voiceConfig") or {}
    voice = override.get("name", voice)
    rate = override.get("rate", rate)
    pitch = override.get("pitch", pitch)
    files = []
    for i, scene in enumerate(project["scenes"]):
        text = (scene.get("narration") or "").strip()
        target = out_dir / f"scene_{i + 1:02d}.mp3"
        if text:
            raw_clip = out_dir / f"scene_{i + 1:02d}_raw.mp3"
            subprocess.run([tool, "--voice", voice, f"--rate={rate}", f"--pitch={pitch}", "--text", text,
                            "--write-media", str(raw_clip)], check=True, capture_output=True)
            # trim the TTS engine's leading/trailing silence: tighter, more natural pacing
            subprocess.run([
                imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(raw_clip), "-af",
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
                "silenceremove=start_periods=1:start_threshold=-45dB,areverse",
                str(target),
            ], check=True)
            raw_clip.unlink()
            files.append(target.name)
        else:
            files.append(None)
    return files


def free_port():
    """Ask the OS for an unused local port, so renders never collide with other servers."""
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def render(project_path, out_path, port_http=None, port_cdp=None):
    port_http = port_http or free_port()
    port_cdp = port_cdp or free_port()
    project = json.loads(Path(project_path).read_text(encoding="utf-8"))
    project["voice"] = "own"
    tmp = tempfile.mkdtemp(prefix="shortcraft-render-")
    try:
        site = Path(tmp) / "site"
        shutil.copytree(WEB_DIR, site)
        voice_files = make_voices(project, site)
        (site / "_project.json").write_text(json.dumps(project), encoding="utf-8")
        server = subprocess.Popen([sys.executable, "-m", "http.server", str(port_http), "--bind", "127.0.0.1"], cwd=site,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        chrome = subprocess.Popen([
            chrome_path(), "--headless=new", "--disable-gpu", f"--remote-debugging-port={port_cdp}",
            "--remote-allow-origins=*", f"--user-data-dir={tmp}/profile",
            "--autoplay-policy=no-user-gesture-required", "--window-size=1400,1100", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            cdp_deadline = time.time() + 45
            while True:
                try:
                    targets = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port_cdp}/json").read())
                    break
                except OSError:
                    if time.time() > cdp_deadline:
                        raise
                    time.sleep(0.5)
            page = next(t for t in targets if t["type"] == "page")
            ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=600)
            counter = [0]

            def send(method, params=None):
                counter[0] += 1
                ws.send(json.dumps({"id": counter[0], "method": method, "params": params or {}}))
                while True:
                    reply = json.loads(ws.recv())
                    if reply.get("id") == counter[0]:
                        return reply

            def evaluate(expr, await_promise=False):
                res = send("Runtime.evaluate", {"expression": expr, "awaitPromise": await_promise,
                                                "returnByValue": True}).get("result", {})
                if "exceptionDetails" in res:
                    raise RuntimeError(json.dumps(res["exceptionDetails"])[:600])
                return res.get("result", {}).get("value")

            send("Page.navigate", {"url": f"http://127.0.0.1:{port_http}/app.html"})
            ready_deadline = time.time() + 60
            while not evaluate("!!(window.ShortcraftStudio && window.ShortcraftStudio.setProject)"):
                if time.time() > ready_deadline:
                    raise RuntimeError("studio page did not load within 60 s")
                time.sleep(0.5)
            info = evaluate("""
            (async () => {
              const S = window.ShortcraftStudio;
              const project = await (await fetch('_project.json')).json();
              S.setProject(project);
              const files = %s;
              const Ctor = window.AudioContext || window.webkitAudioContext;
              const ctx = new Ctor();
              for (let i = 0; i < files.length; i++) {
                if (!files[i]) continue;
                const buf = await (await fetch(files[i])).arrayBuffer();
                S.state.voiceBuffers[i] = await ctx.decodeAudioData(buf);
              }
              document.getElementById('f-voice').dispatchEvent(new Event('input'));
              return {total: S.state.timeline.total};
            })()
            """ % json.dumps(voice_files), await_promise=True)
            evaluate("window.ShortcraftStudio.exportVideo(); true")
            deadline = time.time() + info["total"] + 60
            while time.time() < deadline:
                time.sleep(1)
                if (evaluate("document.getElementById('export-status').textContent") or "").startswith("Done"):
                    break
            else:
                raise RuntimeError("export timed out")
            b64 = evaluate("""
            (async () => {
              const blob = window.ShortcraftStudio.state.lastExport.blob;
              const bytes = new Uint8Array(await blob.arrayBuffer());
              let s = '';
              for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
              return btoa(s);
            })()
            """, await_promise=True)
            raw = Path(tmp) / "raw_export"
            raw.write_bytes(base64.b64decode(b64))
        finally:
            chrome.terminate()
            server.terminate()
            try:
                chrome.wait(timeout=10)
            except subprocess.TimeoutExpired:
                chrome.kill()
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        subprocess.run([
            ffmpeg, "-y", "-loglevel", "error", "-i", str(raw),
            "-vf", "fps=30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(out_path),
        ], check=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"seconds": round(info["total"], 1), "path": str(out_path)}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: render_headless.py project.json out.mp4")
    print(render(sys.argv[1], sys.argv[2]))
