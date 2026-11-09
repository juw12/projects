#!/usr/bin/env python3
"""Render every queued item that has no video.mp4 yet, one process per item, with retries.

A crash in one render (e.g. headless Chrome dropping its DevTools connection) no longer
stops the batch: the item is retried, and after the last attempt the batch moves on.

    python render_batch.py --channel mending                 # Google voice (default here)
    python render_batch.py --channel mending --attempts 3
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent


def log(message):
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def update_post_seconds(item, seconds):
    post_path = item / "post.json"
    post = json.loads(post_path.read_text(encoding="utf-8")) if post_path.exists() else {}
    post["seconds"] = seconds
    post_path.write_text(json.dumps(post, ensure_ascii=False, indent=2), encoding="utf-8")


def render_item(item, attempts):
    project = item / "project.json"
    video = item / "video.mp4"
    for attempt in range(1, attempts + 1):
        log(f"{item.name}: attempt {attempt}/{attempts}")
        started = time.time()
        result = subprocess.run(
            [sys.executable, str(HERE / "render_with_google_voice.py"), "--project", str(project), str(video)],
            cwd=HERE, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if result.returncode == 0 and video.exists():
            seconds = None
            for line in result.stdout.splitlines():
                if "'seconds'" in line:
                    try:
                        seconds = float(line.split("'seconds':")[1].split(",")[0])
                    except (IndexError, ValueError):
                        pass
            if seconds:
                update_post_seconds(item, seconds)
            log(f"{item.name}: OK ({seconds} s video, {time.time() - started:.0f} s render)")
            return True
        tail = (result.stderr or result.stdout).strip().splitlines()[-3:]
        log(f"{item.name}: FAILED - {' | '.join(tail)}")
        if video.exists():
            video.unlink()
        time.sleep(5)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--channel", default="mending")
    parser.add_argument("--attempts", type=int, default=3)
    args = parser.parse_args()

    queue = HERE / "queue" / args.channel
    pending = [p.parent for p in sorted(queue.glob("*/project.json")) if not (p.parent / "video.mp4").exists()]
    log(f"{len(pending)} item(s) to render in {queue}")
    failed = [item.name for item in pending if not render_item(item, args.attempts)]
    log("batch done" + (f"; failed: {failed}" if failed else "; all rendered"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
