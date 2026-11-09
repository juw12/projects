#!/usr/bin/env python3
"""Render queued projects with Google voice instead of edge-tts.

Use this on networks that block Microsoft speech (speech.platform.bing.com).
It swaps render_headless.make_voices for a gTTS version, speeds each clip up
(default tempo 1.3, as in the mending.id note) and then runs the normal
`autopost.py render` flow, so script gates, SFX, loudness and QC all still apply.

    python render_with_google_voice.py --channel mending            # render every item without video.mp4
    python render_with_google_voice.py --project path/project.json out.mp4
    python render_with_google_voice.py --channel mending --tempo 1.25

Requires: pip install gTTS (plus the normal pipeline requirements).
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import imageio_ffmpeg  # noqa: E402
import render_headless  # noqa: E402

GTTS_LANG = {"id": "id", "en": "en"}
GTTS_RETRIES = 6
CACHE_DIR = None  # set to <item>/voice when rendering a single project (see make_voice_cache.py)


def cached_clip(index, text):
    """Natural edge-tts clip saved by make_voice_cache.py, if present and made from this exact text."""
    if CACHE_DIR is None:
        return None
    manifest_path = CACHE_DIR / "manifest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    name = f"scene_{index + 1:02d}.mp3"
    clip = CACHE_DIR / name
    voice = manifest.get("_voice", "")
    rate = manifest.get("_rate", "")
    digest = hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()[:16]
    if clip.exists() and manifest.get(name) == digest:
        return clip
    return None


def save_with_retry(text, language, target):
    """gTTS sometimes gets 'Failed to connect' on busy/filtered networks; back off and retry per clip."""
    from gtts import gTTS
    from gtts.tts import gTTSError

    for attempt in range(1, GTTS_RETRIES + 1):
        try:
            gTTS(text, lang=language).save(str(target))
            return
        except (gTTSError, OSError) as error:
            if attempt == GTTS_RETRIES:
                raise
            wait = min(60, 5 * attempt)
            print(f"gTTS attempt {attempt} failed ({error}); retrying in {wait} s", file=sys.stderr, flush=True)
            time.sleep(wait)


def make_google_voices(project, out_dir, tempo):
    """Same contract as render_headless.make_voices: one mp3 per narrated scene, None for silent scenes."""
    language = GTTS_LANG.get(project.get("lang", "id"), "id")
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    files = []
    natural = 0
    for index, scene in enumerate(project["scenes"]):
        text = (scene.get("narration") or "").strip()
        if not text:
            files.append(None)
            continue
        target = out_dir / f"scene_{index + 1:02d}.mp3"
        cached = cached_clip(index, text)
        if cached:
            shutil.copyfile(cached, target)
            files.append(target.name)
            natural += 1
            continue
        raw_clip = out_dir / f"scene_{index + 1:02d}_raw.mp3"
        fast_clip = out_dir / f"scene_{index + 1:02d}_fast.mp3"
        save_with_retry(text, language, raw_clip)
        time.sleep(1)  # be gentle with the endpoint between clips
        subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", str(raw_clip), "-filter:a", f"atempo={tempo}", str(fast_clip)],
            check=True,
        )
        render_headless.trim_silence(fast_clip, target)
        raw_clip.unlink()
        fast_clip.unlink()
        files.append(target.name)
    spoken = sum(1 for name in files if name)
    print(f"voice: {natural}/{spoken} scenes natural (edge-tts cache), {spoken - natural} Google fallback", file=sys.stderr, flush=True)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channel", help="queue channel to render (all channels if omitted)")
    parser.add_argument("--project", nargs=2, metavar=("PROJECT_JSON", "OUT_MP4"), help="render one file")
    parser.add_argument("--tempo", type=float, default=1.3, help="speed-up applied to each voice clip")
    parser.add_argument("--config", default=str(HERE / "config.json"))
    args = parser.parse_args()

    render_headless.make_voices = lambda project, out_dir: make_google_voices(project, out_dir, args.tempo)

    if args.project:
        global CACHE_DIR
        CACHE_DIR = Path(args.project[0]).resolve().parent / "voice"
        print(render_headless.render(args.project[0], args.project[1]))
        return

    import autopost

    sys.argv = ["autopost.py", "--config", args.config, "render"]
    if args.channel:
        sys.argv += ["--channel", args.channel]
    autopost.main()


if __name__ == "__main__":
    main()
