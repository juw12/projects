"""Generate PWA icons for PTB RDME Widget using PIL.

Simple mark: a stack of three rectangles representing layers/OT hours on
the accent color background. Plus a maskable variant for adaptive icons.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ICON_DIR = Path(__file__).resolve().parent.parent / "web" / "icons"
ICON_DIR.mkdir(parents=True, exist_ok=True)

BG = (59, 140, 132, 255)        # accent teal
FG = (255, 255, 255, 230)


def _draw(canvas, *, size, maskable=False):
    d = ImageDraw.Draw(canvas)
    pad = int(size * (0.20 if maskable else 0.16))
    box = (pad, pad, size - pad, size - pad)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    corner = int(w * 0.18)
    # Outer rounded square
    d.rounded_rectangle(box, radius=corner, fill=FG)

    # Three stacked layers
    line_w = max(3, int(w * 0.10))
    spacing = int(h * 0.13)
    base_y = int(y0 + h * 0.30)
    bar_h = int(h * 0.12)
    for i in range(3):
        y = base_y + i * (bar_h + spacing)
        d.rounded_rectangle(
            (x0 + int(w * 0.18), y, x1 - int(w * 0.18), y + bar_h),
            radius=int(bar_h / 2),
            fill=BG,
        )


def make_icon(size, *, maskable=False):
    img = Image.new("RGBA", (size, size), BG)
    _draw(img, size=size, maskable=maskable)
    return img


def main():
    targets = [
        ("apple-touch-icon.png", 180, False),
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable.png", 512, True),
    ]
    for name, size, maskable in targets:
        img = make_icon(size, maskable=maskable)
        img.save(ICON_DIR / name, format="PNG", optimize=True)
        print(f"  wrote {name} ({size}x{size}, maskable={maskable})")
    print("done")


if __name__ == "__main__":
    main()
