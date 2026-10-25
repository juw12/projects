"""Normalize a finished MP4's audio to social-media loudness (-14 LUFS, -1.5 dBTP), video copied as-is.

Usage: ../.venv/bin/python loudnorm.py VIDEO.mp4 [VIDEO2.mp4 ...]
"""

import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def normalize(video):
    video = Path(video)
    temp = video.with_name(video.stem + "_norm_tmp.mp4")
    subprocess.run([
        FFMPEG, "-y", "-loglevel", "error", "-i", str(video),
        "-c:v", "copy",
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
        "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", str(temp),
    ], check=True)
    temp.replace(video)
    print(f"normalized {video}")


if __name__ == "__main__":
    for path in sys.argv[1:]:
        normalize(path)
