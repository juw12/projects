#!/usr/bin/env python3
"""Download natural Microsoft neural narration (edge-tts) for every queued episode, once.

Run this on any network that can reach speech.platform.bing.com (home Wi-Fi, phone hotspot).
Clips are saved next to each project as voice/scene_NN.mp3 plus voice/manifest.json; the
renderer (render_with_google_voice.py) uses these clips first and only falls back to Google
voice for a scene whose cached clip is missing or whose narration text changed.

    python make_voice_cache.py --channel mending
    python make_voice_cache.py --channel mending --voice id-ID-ArdiNeural --rate +6%
    python make_voice_cache.py --channel mending --force          # re-download everything
"""

import argparse
import asyncio
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import edge_tts  # noqa: E402
import render_headless  # noqa: E402

DEFAULT_VOICE = "id-ID-GadisNeural"
DEFAULT_RATE = "+8%"


def text_hash(text, voice, rate):
    return hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()[:16]


async def synthesize(text, voice, rate, target, proxy=None):
    communicate = edge_tts.Communicate(text, voice, rate=rate, proxy=proxy)
    await communicate.save(str(target))


def cache_item(item, voice_override, rate_override, force, proxy):
    project = json.loads((item / "project.json").read_text(encoding="utf-8"))
    config = project.get("voiceConfig") or {}
    voice = voice_override or config.get("name") or DEFAULT_VOICE
    rate = rate_override or DEFAULT_RATE
    voice_dir = item / "voice"
    voice_dir.mkdir(exist_ok=True)
    manifest_path = voice_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    made = 0
    for index, scene in enumerate(project["scenes"]):
        text = (scene.get("narration") or "").strip()
        if not text:
            continue
        name = f"scene_{index + 1:02d}.mp3"
        digest = text_hash(text, voice, rate)
        target = voice_dir / name
        if not force and target.exists() and manifest.get(name) == digest:
            continue
        raw = voice_dir / f"scene_{index + 1:02d}_raw.mp3"
        asyncio.run(synthesize(text, voice, rate, raw, proxy))
        render_headless.trim_silence(raw, target)
        raw.unlink()
        manifest[name] = digest
        made += 1
    manifest["_voice"] = voice
    manifest["_rate"] = rate
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return made, voice, rate


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channel", default="mending")
    parser.add_argument("--voice", help="override the project's voice, e.g. id-ID-ArdiNeural")
    parser.add_argument("--rate", help=f"speaking rate (default {DEFAULT_RATE})")
    parser.add_argument("--proxy")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    items = sorted(p.parent for p in (HERE / "queue" / args.channel).glob("*/project.json"))
    failed = []
    for item in items:
        try:
            made, voice, rate = cache_item(item, args.voice, args.rate, args.force, args.proxy)
            print(f"{item.name}: {made} new clip(s) ({voice}, {rate})", flush=True)
        except Exception as error:  # network blocks show up here; keep going so partial runs still help
            failed.append(item.name)
            print(f"{item.name}: FAILED - {type(error).__name__}: {str(error)[:160]}", flush=True)
    print("done" + (f"; failed: {failed}" if failed else "; all episodes have natural voice clips"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
