#!/usr/bin/env python3
"""Draw the Sweep app icon and write every PNG the web app, desktop and phone shells use.

    pip install pillow
    python apps/sweep/mobile/scripts/make-icons.py

The same geometry is in apps/sweep/web/icons/app-icon.svg (burgundy tile, progress ring, check mark).
Outputs (all overwritten):
  web/icons/icon-192.png, icon-512.png            rounded tile with transparent corners (PWA, desktop builds)
  web/icons/icon-maskable-512.png                 full-bleed tile for Android "maskable" launchers
  web/icons/apple-touch-icon.png                  180 px full-bleed (iOS adds its own rounding)
  mobile/resources/android/mipmap-*/ic_launcher*.png, drawable/splash_logo.png
  mobile/resources/ios/AppIcon-512@2x.png (1024, no alpha), splash-2732x2732.png
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
MOBILE = HERE.parent
WEB = MOBILE.parent / "web"

TOP = (180, 42, 42)       # #b42a2a
BOTTOM = (109, 16, 16)    # #6d1010
BRAND = (139, 26, 26)     # #8b1a1a
WHITE = (255, 255, 255)
SUPERSAMPLE = 4


def gradient_tile(size):
    """Diagonal burgundy gradient, full bleed."""
    tile = Image.new("RGB", (size, size))
    pixels = tile.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM))
    return tile


def round_line(draw, points, width, fill):
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width / 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def glyph(size, scale=1.0):
    """Transparent layer with the ring + check, in 512-unit design space scaled to `size`."""
    big = size * SUPERSAMPLE
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    unit = big / 512 * scale
    center = big / 2

    def at(x, y):
        return (center + (x - 256) * unit, center + (y - 256) * unit)

    ring_width = round(30 * unit)
    ring_radius = 150 * unit + ring_width / 2  # PIL draws the stroke inside the box
    box = (center - ring_radius, center - ring_radius, center + ring_radius, center + ring_radius)
    # Faint full track, then the bright 240-degree sweep starting at 12 o'clock (PIL angles start at 3 o'clock).
    track = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(track).arc(box, 0, 360, fill=WHITE + (64,), width=ring_width)
    layer.alpha_composite(track)
    draw.arc(box, -90, 150, fill=WHITE + (255,), width=ring_width)
    for angle in (-90, 150):
        x = center + ring_radius * math.cos(math.radians(angle)) - ring_width / 2 * math.cos(math.radians(angle))
        y = center + ring_radius * math.sin(math.radians(angle)) - ring_width / 2 * math.sin(math.radians(angle))
        r = ring_width / 2
        draw.ellipse((x - r, y - r, x + r, y + r), fill=WHITE + (255,))
    round_line(draw, [at(170, 262), at(232, 324), at(350, 196)], round(42 * unit), WHITE + (255,))
    return layer.resize((size, size), Image.LANCZOS)


def mask(size, shape):
    big = size * SUPERSAMPLE
    layer = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(layer)
    if shape == "circle":
        draw.ellipse((0, 0, big - 1, big - 1), fill=255)
    else:
        draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=big * 112 / 512, fill=255)
    return layer.resize((size, size), Image.LANCZOS)


def icon(size, shape="square"):
    tile = gradient_tile(size).convert("RGBA")
    tile.alpha_composite(glyph(size))
    if shape != "square":
        tile.putalpha(mask(size, shape))
    return tile


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print("wrote", path.relative_to(MOBILE.parent))


def main():
    icons = WEB / "icons"
    save(icon(192, "rounded"), icons / "icon-192.png")
    save(icon(512, "rounded"), icons / "icon-512.png")
    save(icon(512), icons / "icon-maskable-512.png")
    save(icon(180).convert("RGB"), icons / "apple-touch-icon.png")

    android = MOBILE / "resources" / "android"
    densities = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, size in densities.items():
        folder = android / ("mipmap-" + density)
        save(icon(size, "rounded"), folder / "ic_launcher.png")
        save(icon(size, "circle"), folder / "ic_launcher_round.png")
        # Adaptive foreground: 108dp canvas, artwork inside the 66dp safe circle.
        foreground_size = size * 108 // 48
        save(glyph(foreground_size, scale=0.62), folder / "ic_launcher_foreground.png")
    save(icon(288, "rounded"), android / "drawable" / "splash_logo.png")

    ios = MOBILE / "resources" / "ios"
    save(icon(1024).convert("RGB"), ios / "AppIcon-512@2x.png")
    splash = Image.new("RGB", (2732, 2732), BRAND)
    logo = icon(512, "rounded")
    splash.paste(logo, ((2732 - 512) // 2, (2732 - 512) // 2), logo)
    save(splash, ios / "splash-2732x2732.png")


if __name__ == "__main__":
    main()
