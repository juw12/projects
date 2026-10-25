"""Grab frames from a rendered MP4 into one contact strip and print stream info.

Usage: ../.venv/bin/python check_frames.py VIDEO OUT.png t1 t2 t3 ...
"""

import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def main():
    video, out = Path(sys.argv[1]), Path(sys.argv[2])
    times = [float(t) for t in sys.argv[3:]]
    info = subprocess.run([FFMPEG, "-i", str(video)], capture_output=True, text=True).stderr
    for line in info.splitlines():
        if "Duration" in line or "Stream" in line:
            print(line.strip())
    tiles = []
    for t in times:
        tmp = Path("/tmp/check_frame.png")
        subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-ss", str(t), "-i", str(video),
                        "-frames:v", "1", str(tmp)], check=True)
        tiles.append(Image.open(tmp).convert("RGB").resize((270, 480)))
    sheet = Image.new("RGB", (270 * len(tiles), 480))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, (270 * index, 0))
    sheet.save(out)
    print(f"saved {out}")


if __name__ == "__main__":
    main()
