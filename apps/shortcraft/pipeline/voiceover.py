#!/usr/bin/env python3
"""Generate natural neural voiceover clips for a Shortcraft project.

Reads a project JSON saved from the studio ("Save JSON") and writes one audio
file per scene (scene_01.mp3, scene_02.mp3, ...). Upload each clip to its scene
in the studio ("Upload audio") — scene timing then follows the real voice.

Voices come from Microsoft Edge's online neural TTS via the edge-tts package
(internet required). Check the service terms before commercial use, or record
your own voice — it still performs best.

Usage:
    pip install edge-tts
    python voiceover.py my-project.json            # default voice per language
    python voiceover.py my-project.json --voice id-ID-GadisNeural --rate +5%
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_VOICES = {
    "en": "en-US-AndrewNeural",
    "id": "id-ID-ArdiNeural",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("project", help="Project JSON saved from the Shortcraft studio")
    parser.add_argument("--voice", help="edge-tts voice name (default depends on project language)")
    parser.add_argument("--rate", default="+4%", help="Speaking rate, e.g. +5%% or -10%%")
    parser.add_argument("--out", help="Output folder (default: <project>_voice/)")
    args = parser.parse_args()

    project_path = Path(args.project)
    project = json.loads(project_path.read_text(encoding="utf-8"))
    lang = project.get("lang", "en")
    voice = args.voice or DEFAULT_VOICES.get(lang, DEFAULT_VOICES["en"])
    out_dir = Path(args.out) if args.out else project_path.with_name(project_path.stem + "_voice")
    out_dir.mkdir(parents=True, exist_ok=True)

    tool = shutil.which("edge-tts")
    if not tool:
        sys.exit("edge-tts not found. Install it with: pip install edge-tts")

    for index, scene in enumerate(project.get("scenes", []), start=1):
        text = (scene.get("narration") or "").strip()
        if not text:
            print(f"scene {index:02d}: no narration, skipped")
            continue
        target = out_dir / f"scene_{index:02d}.mp3"
        subprocess.run([tool, "--voice", voice, f"--rate={args.rate}", "--text", text,
                        "--write-media", str(target)], check=True)
        print(f"scene {index:02d}: {target}")
    print(f"Done. Upload each clip to its scene in the studio. Voice: {voice}")


if __name__ == "__main__":
    main()
