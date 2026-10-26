"""Render a Shortcraft project JSON to MP4 without opening a window.

1. Neural voice per scene (edge-tts) unless the project already has voice clips.
2. Headless Chrome loads the studio, injects the project + voices and runs the same
   in-browser export the user would click (Chrome DevTools Protocol).
3. ffmpeg re-times to constant 30 fps and normalises loudness to -14 LUFS.

Requires: Google Chrome, `pip install websocket-client edge-tts imageio-ffmpeg`.
"""

import base64
import json
import os
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



LOUDNORM_TARGET = "I=-14:TP=-1.5:LRA=11"


def two_pass_loudnorm(ffmpeg, audio_inputs, audio_filter):
    """Measure loudness first, then return the filter with measured values (linear gain).

    Single-pass loudnorm tends to undershoot short clips by 1-2 LU. Falls back to the
    single-pass filter if the measurement cannot be parsed.
    """
    single = f"loudnorm={LOUDNORM_TARGET}"
    measure_filter = audio_filter.replace(single, single + ":print_format=json")
    if "[aout]" in measure_filter:
        measure_args = ["-filter_complex", measure_filter, "-map", "[aout]"]
    else:
        measure_args = ["-af", measure_filter]
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-nostats", *audio_inputs, *measure_args, "-vn", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    try:
        blob = result.stderr[result.stderr.rindex("{"):result.stderr.rindex("}") + 1]
        measured = json.loads(blob)
        tuned = (f"{single}:measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
                 f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
                 f":offset={measured['target_offset']}:linear=true")
    except (ValueError, KeyError):
        return audio_filter
    return audio_filter.replace(single, tuned)

def chrome_path():
    for path in CHROME_CANDIDATES:
        if Path(path).exists():
            return path
    found = shutil.which("google-chrome") or shutil.which("chromium")
    if not found:
        raise SystemExit("Google Chrome not found")
    return found


def trim_silence(source, target):
    """Trim the TTS engine's leading/trailing silence: tighter, more natural pacing."""
    subprocess.run([
        imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", str(source), "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse",
        str(target),
    ], check=True)


def make_voices(project, out_dir):
    """Neural voice per scene. A project can override the voice with
    "voiceConfig": {"name": "id-ID-GadisNeural", "rate": "+0%", "pitch": "+0Hz"}.
    Own voice, paid (see voice_clone.py): {"provider": "elevenlabs", "speed": 1.08}.
    Own voice, free (see voice_convert.py): {"provider": "openvoice", "name": "id-ID-ArdiNeural"};
    the edge-tts clip is re-coloured to the owner's timbre on CPU (OPENVOICE_PYTHON selects the env)."""
    tool = shutil.which("edge-tts") or str(Path(sys.executable).with_name("edge-tts"))
    voice, rate = VOICES.get(project.get("lang", "en"), VOICES["en"])
    pitch = "+0Hz"
    override = project.get("voiceConfig") or {}
    provider = override.get("provider", "edge")
    if provider == "openvoice":
        voice = "id-ID-ArdiNeural"
    voice = override.get("name", voice)
    rate = override.get("rate", rate)
    pitch = override.get("pitch", pitch)
    here = Path(__file__).resolve().parent
    if provider == "elevenlabs":
        sys.path.insert(0, str(here))
        import voice_clone
    clone_settings = {key: value for key, value in override.items() if key not in ("provider", "name", "rate", "pitch")}

    files = []
    pending = []  # (raw clip, final mp3) pairs still to convert/trim
    for i, scene in enumerate(project["scenes"]):
        text = (scene.get("narration") or "").strip()
        target = out_dir / f"scene_{i + 1:02d}.mp3"
        if not text:
            files.append(None)
            continue
        raw_clip = out_dir / f"scene_{i + 1:02d}_raw.mp3"
        if provider == "elevenlabs":
            voice_clone.synthesize(text, raw_clip, clone_settings)
        else:
            subprocess.run([tool, "--voice", voice, f"--rate={rate}", f"--pitch={pitch}", "--text", text,
                            "--write-media", str(raw_clip)], check=True, capture_output=True)
        pending.append((raw_clip, target))
        files.append(target.name)

    if provider == "openvoice" and pending:
        converted = [(raw, raw.with_name(raw.stem + "_me.wav")) for raw, _ in pending]
        python = os.environ.get("OPENVOICE_PYTHON", sys.executable)
        args = [python, str(here / "voice_convert.py"), "batch"]
        for raw, wav in converted:
            args += [str(raw), str(wav)]
        env = {**os.environ, "OPENVOICE_BASE": voice, "OPENVOICE_TAU": str(override.get("tau", 0.3))}
        subprocess.run(args, check=True, env=env, capture_output=True)
        for (raw, wav), (_, target) in zip(converted, pending):
            trim_silence(wav, target)
            raw.unlink()
            wav.unlink()
    else:
        for raw, target in pending:
            trim_silence(raw, target)
            raw.unlink()
    return files



READ_CPS = 15.0      # characters per second a viewer reads (lemo-opuscar DIRECTOR.md rule)
READ_PAD = 1.0       # seconds to orient before reading (narration reads along, so 1.0 not 1.5)
READ_CAP = 6.0       # never hold a Shorts scene longer than this just for reading


def primary_text(scene):
    """The on-screen text a viewer has to read in a scene (captions excluded: they follow the voice)."""
    parts = [scene.get(key) or "" for key in ("headline", "quote", "result", "badge")]
    parts += [m.get("text", "") for m in scene.get("messages", [])]
    parts += [o if isinstance(o, str) else "" for o in scene.get("options", [])]
    parts += scene.get("lines", [])
    parts += [b.get("label", "") for b in scene.get("bars", [])]
    return " ".join(p for p in parts if p)


def apply_reading_time(project):
    """Raise scene.minDur so every scene stays up long enough to read; returns the changes made."""
    changes = []
    for index, scene in enumerate(project["scenes"]):
        chars = len("".join(primary_text(scene).split()))
        need = min(READ_CAP, chars / READ_CPS + READ_PAD)
        current = scene.get("minDur") or 3.2
        if need > current:
            scene["minDur"] = round(need, 2)
            changes.append({"scene": index + 1, "chars": chars, "minDur": [current, scene["minDur"]]})
    return changes


def run_script_check(project, project_path):
    """yt-script gates before any voice is generated (see script_check.py); skipped with "scriptCheck": false."""
    if project.get("scriptCheck", "gate") is False:
        return {"ok": True, "skipped": True}
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import script_check

    report = script_check.check_project(project, script_check.find_title(project_path, project))
    return {key: report[key] for key in ("mode", "ok", "failed", "blocking", "gates", "top_hooks")}


def run_asr_check(project, site, voice_files):
    """Speech-to-text every narrated clip and compare with the script (see asr_check.py)."""
    lines = [
        {"text": scene["narration"], "audio": str(site / name), **({"asr": scene["asr"]} if scene.get("asr") else {})}
        for scene, name in zip(project["scenes"], voice_files) if name
    ]
    lines_path = site / "_asr_lines.json"
    lines_path.write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")
    python = os.environ.get("ASR_PYTHON") or os.environ.get("OPENVOICE_PYTHON") or sys.executable
    here = Path(__file__).resolve().parent
    proc = subprocess.run([python, str(here / "asr_check.py"), str(lines_path)], capture_output=True, text=True)
    try:
        report = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        report = {"ok": False, "error": (proc.stderr or proc.stdout)[-400:]}
    report["status"] = {0: "pass", 1: "fail"}.get(proc.returncode, "not-run")
    return report


def sfx_scene_info(project, timeline_scenes):
    info = []
    for scene, item in zip(project["scenes"], timeline_scenes):
        info.append({
            "start": item["start"], "dur": item["dur"], "voDur": item["voDur"],
            "layout": scene.get("layout"), "value": scene.get("value"), "stamp": scene.get("stamp"),
            "result": scene.get("result"), "messages": len(scene.get("messages", [])),
            "bars": len(scene.get("bars", [])), "lines": len(scene.get("lines", [])),
            "options": len(scene.get("options", [])), "rows": len(scene.get("rows", [])),
        })
    return info


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
        qc = {"script": run_script_check(project, project_path)}
        if not qc["script"]["ok"]:
            raise RuntimeError("script check (/yt-script gates) failed: " + ", ".join(qc["script"]["blocking"])
                               + " - run script_check.py on the project for details")
        qc["reading"] = apply_reading_time(project)
        voice_files = make_voices(project, site)
        if project.get("asrCheck", True):
            qc["asr"] = run_asr_check(project, site, voice_files)
            strict = project.get("asrCheck", True) != "warn"
            if qc["asr"]["status"] == "fail" and strict:
                bad = [line for line in qc["asr"].get("lines", []) if not line["ok"]]
                raise RuntimeError("narration check failed: " + json.dumps(bad, ensure_ascii=False)[:800])
            if qc["asr"]["status"] == "not-run" and os.environ.get("ASR_REQUIRED") == "1":
                raise RuntimeError("narration check could not run: " + str(qc["asr"].get("error"))[:400])
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
              return {total: S.state.timeline.total, scenes: S.state.timeline.scenes.map(s => ({start: s.start, dur: s.dur, voDur: s.voDur}))};
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
        audio_inputs = ["-i", str(raw)]
        audio_filter = "loudnorm=I=-14:TP=-1.5:LRA=11"
        if project.get("sfx", True) and project.get("template") == "pop":
            sys.path.insert(0, str(Path(__file__).resolve().parent))
            import sfx

            cues = sfx.cues_for_timeline(sfx_scene_info(project, info["scenes"]))
            sfx_path = Path(tmp) / "sfx.wav"
            sfx.write_wav(sfx.render_track(cues, info["total"]), sfx_path)
            audio_inputs += ["-i", str(sfx_path)]
            gain = float(project.get("sfxGain", 0.5))
            audio_filter = (f"[1:a]volume={gain},aresample=48000[fx];[0:a]aresample=48000[base];"
                            f"[base][fx]amix=inputs=2:duration=first:normalize=0,{audio_filter}[aout]")
            qc["sfx_cues"] = len(cues)
        video_args = ["-vf", "fps=30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p"]
        audio_filter = two_pass_loudnorm(ffmpeg, audio_inputs, audio_filter)
        if len(audio_inputs) > 2:
            audio_args = ["-filter_complex", audio_filter, "-map", "0:v", "-map", "[aout]"]
        else:
            audio_args = ["-af", audio_filter]
        subprocess.run([
            ffmpeg, "-y", "-loglevel", "error", *audio_inputs, *video_args, *audio_args,
            "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out_path),
        ], check=True)
        probe = subprocess.run([ffmpeg, "-i", str(out_path), "-vf", "blackdetect=d=0.3:pix_th=0.05",
                                "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
        qc["black_segments"] = probe.count("black_start")
        loudness = [line for line in probe.splitlines() if line.strip().startswith("I:")]
        qc["loudness"] = loudness[-1].strip() if loudness else None
        Path(out_path).with_suffix(".qc.json").write_text(json.dumps(qc, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"seconds": round(info["total"], 1), "path": str(out_path)}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: render_headless.py project.json out.mp4")
    print(render(sys.argv[1], sys.argv[2]))
