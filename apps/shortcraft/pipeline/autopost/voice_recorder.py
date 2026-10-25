"""One-click voice sample recorder for voice cloning.

    python voice_recorder.py            # opens a teleprompter page in the browser

Press Record, read the text out loud (~80 s), press Stop. The take is uploaded to
this local server (127.0.0.1 only), converted to a clean 44.1 kHz mono WAV and
quality-checked (length, loudness, clipping, background noise). The verdict is
shown on the page immediately, so a bad take can be redone on the spot.

Output (git-ignored, never leaves the machine unless you run voice_clone.py):
    secrets/voice/take_<timestamp>.<webm|mp4>   raw browser recording
    secrets/voice/sample.wav                    best/latest clean sample
    secrets/voice/sample_report.json            quality numbers

Step 2 on the same page (optional): paste an ElevenLabs API key -> the voice is cloned
and a test line is played back. The key is stored in secrets/elevenlabs_key (chmod 600).

Requires: pip install imageio-ffmpeg
"""

import array
import json
import math
import os
import subprocess
import sys
import threading
import time
import wave
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import imageio_ffmpeg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voice_clone  # noqa: E402

HERE = Path(__file__).resolve().parent
PAGE = HERE / "voice_recorder.html"
VOICE_DIR = HERE / "secrets" / "voice"
MAX_UPLOAD = 60 * 1024 * 1024
IDLE_SHUTDOWN_S = 2 * 60 * 60


def to_clean_wav(raw_path, wav_path):
    """Decode the browser take, remove rumble, trim edge silence, normalise to -18 LUFS."""
    filters = ",".join([
        "highpass=f=70",
        "silenceremove=start_periods=1:start_threshold=-50dB",
        "areverse",
        "silenceremove=start_periods=1:start_threshold=-50dB",
        "areverse",
        "loudnorm=I=-18:TP=-1.5:LRA=11",
    ])
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
            "-i", str(raw_path),
            "-af", filters,
            "-ac", "1", "-ar", "44100", "-sample_fmt", "s16",
            str(wav_path),
        ],
        check=True,
    )


def analyse_raw(raw_path):
    """Measure the take *before* normalisation so noise/clipping reflect the real mic."""
    probe_wav = raw_path.with_suffix(".probe.wav")
    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error",
            "-i", str(raw_path), "-ac", "1", "-ar", "16000", "-sample_fmt", "s16",
            str(probe_wav),
        ],
        check=True,
    )
    with wave.open(str(probe_wav)) as wav_file:
        rate = wav_file.getframerate()
        samples = array.array("h", wav_file.readframes(wav_file.getnframes()))
    probe_wav.unlink()

    frame_len = int(rate * 0.05)
    frame_db = []
    for start in range(0, len(samples) - frame_len, frame_len):
        chunk = samples[start:start + frame_len]
        rms = math.sqrt(sum(value * value for value in chunk) / frame_len) / 32768.0
        frame_db.append(20 * math.log10(max(rms, 1e-7)))
    frame_db.sort()

    def percentile(fraction):
        if not frame_db:
            return -120.0
        return frame_db[min(len(frame_db) - 1, int(fraction * len(frame_db)))]

    clipped = sum(1 for value in samples if abs(value) >= 32700)
    speech_db = percentile(0.90)
    noise_db = percentile(0.10)
    return {
        "seconds": round(len(samples) / rate, 1),
        "speech_dbfs": round(speech_db, 1),
        "noise_dbfs": round(noise_db, 1),
        "snr_db": round(speech_db - noise_db, 1),
        "clipped_pct": round(100.0 * clipped / max(1, len(samples)), 3),
    }


def verdict(stats):
    problems = []
    if stats["seconds"] < 55:
        problems.append("Terlalu pendek: baca sampai habis (target 60-120 detik).")
    if stats["speech_dbfs"] < -38:
        problems.append("Suara terlalu pelan: dekatkan mic / bicara lebih keras.")
    if stats["clipped_pct"] > 0.05:
        problems.append("Ada distorsi (clipping): jauhkan sedikit dari mic.")
    if stats["snr_db"] < 25:
        problems.append("Background terlalu ramai (AC/kipas/TV?): coba ruangan lebih sepi.")
    return {"ok": not problems, "problems": problems}


class Handler(BaseHTTPRequestHandler):
    last_activity = time.time()

    def log_message(self, *args):
        return

    def _send(self, code, body, content_type):
        payload = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        Handler.last_activity = time.time()
        if self.path in ("/", "/index.html"):
            self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/state":
            state = {
                "has_sample": (VOICE_DIR / "sample.wav").exists(),
                "has_key": bool(os.environ.get("ELEVENLABS_API_KEY")) or voice_clone.KEY_FILE.exists(),
                "has_voice": voice_clone.VOICE_FILE.exists(),
            }
            self._send(200, json.dumps(state), "application/json")
        elif self.path.startswith("/clone_test.mp3") and (VOICE_DIR / "clone_test.mp3").exists():
            self._send(200, (VOICE_DIR / "clone_test.mp3").read_bytes(), "audio/mpeg")
        else:
            self._send(404, "not found", "text/plain")

    def do_POST(self):
        Handler.last_activity = time.time()
        if self.path == "/clone":
            self.handle_clone()
            return
        if self.path != "/upload":
            self._send(404, "not found", "text/plain")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD:
            self._send(413, json.dumps({"error": "upload size"}), "application/json")
            return
        data = self.rfile.read(length)
        mime = self.headers.get("Content-Type", "")
        extension = "mp4" if "mp4" in mime else "webm"
        VOICE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        raw_path = VOICE_DIR / f"take_{stamp}.{extension}"
        raw_path.write_bytes(data)
        try:
            stats = analyse_raw(raw_path)
            result = verdict(stats)
            take_wav = VOICE_DIR / f"take_{stamp}.wav"
            to_clean_wav(raw_path, take_wav)
            report = {"take": raw_path.name, "stats": stats, **result}
            if result["ok"] or not (VOICE_DIR / "sample.wav").exists():
                (VOICE_DIR / "sample.wav").write_bytes(take_wav.read_bytes())
                (VOICE_DIR / "sample_report.json").write_text(json.dumps(report, indent=2))
            print(json.dumps(report), flush=True)
            self._send(200, json.dumps(report), "application/json")
        except Exception as error:  # report to the page instead of crashing
            self._send(500, json.dumps({"error": str(error)}), "application/json")


    def handle_clone(self):
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}") if 0 < length < 10000 else {}
        key = (payload.get("key") or "").strip()
        try:
            if key:
                voice_clone.SECRETS.mkdir(mode=0o700, exist_ok=True)
                voice_clone.KEY_FILE.write_text(key)
                os.chmod(voice_clone.KEY_FILE, 0o600)
            record = voice_clone.create()
            voice_clone.synthesize(
                "Halo! Ini suara aku, versi clone. Harga empat puluh lima juta, dicicil tiga tahun, "
                "jadinya empat puluh satu ribu per hari. Gimana, mirip nggak?",
                VOICE_DIR / "clone_test.mp3",
            )
            self._send(200, json.dumps({"ok": True, "voice_id": record["voice_id"]}), "application/json")
        except (Exception, SystemExit) as error:
            if key and " 401" in str(error):  # never keep a key ElevenLabs rejected
                voice_clone.KEY_FILE.unlink(missing_ok=True)
            self._send(400, json.dumps({"error": str(error)}), "application/json")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)

    def idle_watchdog():
        while True:
            time.sleep(60)
            if time.time() - Handler.last_activity > IDLE_SHUTDOWN_S:
                server.shutdown()
                return

    threading.Thread(target=idle_watchdog, daemon=True).start()
    url = f"http://127.0.0.1:{port}/"
    print(f"Recorder ready: {url}", flush=True)
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
