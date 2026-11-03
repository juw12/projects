"""Haru day-scene library prototype.

Renders the shared isometric "tiny town" scene library:
8 weather states x 6 times of day x 4 seasons = 192 base scenes.
On device, the app would composite the user's doodle stickers on top,
so every day card looks unique without per-user image generation.

Usage:
    python scenes.py --out output            # full library + contact sheet
    python scenes.py --out output --sample   # a small preview set only
"""

import argparse
import itertools
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

WEATHERS = ["clear", "partly_cloudy", "cloudy", "rain", "storm", "snow", "fog", "heat"]
TIMES = ["dawn", "morning", "noon", "dusk", "night", "late_night"]
SEASONS = ["spring", "summer", "autumn", "winter"]

SIZE = 512
TILE_W, TILE_H = 74, 37
GRID = 6
ORIGIN = (SIZE // 2, 215)

SKY = {
    "dawn": ((255, 196, 170), (190, 200, 235)),
    "morning": ((170, 215, 245), (225, 240, 250)),
    "noon": ((120, 185, 240), (205, 230, 250)),
    "dusk": ((120, 100, 170), (255, 170, 120)),
    "night": ((25, 30, 70), (60, 60, 110)),
    "late_night": ((10, 12, 35), (30, 30, 65)),
}
LIGHT = {  # multiply tint applied to the town
    "dawn": (255, 225, 210),
    "morning": (255, 250, 240),
    "noon": (255, 255, 255),
    "dusk": (240, 190, 170),
    "night": (110, 120, 170),
    "late_night": (70, 80, 130),
}
FOLIAGE = {
    "spring": [(250, 190, 210), (245, 170, 200)],
    "summer": [(110, 175, 95), (90, 155, 85)],
    "autumn": [(235, 140, 60), (210, 90, 50)],
    "winter": [(235, 240, 245), (215, 225, 235)],
}
GROUND = {
    "spring": (170, 205, 130),
    "summer": (140, 190, 105),
    "autumn": (195, 175, 110),
    "winter": (235, 238, 242),
}
BUILDINGS = [  # grid x, grid y, floors, wall color, roof color
    (1, 1, 3, (245, 225, 200), (200, 90, 80)),
    (3, 1, 2, (230, 235, 245), (80, 110, 160)),
    (1, 3, 4, (240, 215, 215), (120, 90, 120)),
    (4, 3, 2, (250, 240, 210), (90, 140, 110)),
    (3, 4, 1, (235, 225, 240), (190, 120, 70)),
]
TREES = [(0, 4), (2, 0), (5, 1), (4, 5), (0, 0), (5, 5), (2, 5)]
INK = (58, 50, 64)


def iso(gx, gy, z=0.0):
    x = ORIGIN[0] + (gx - gy) * TILE_W / 2
    y = ORIGIN[1] + (gx + gy) * TILE_H / 2 - z
    return x, y


def shade(color, factor):
    return tuple(max(0, min(255, int(c * factor))) for c in color)


def vertical_gradient(top, bottom, height=SIZE, width=SIZE):
    t = np.linspace(0, 1, height)[:, None, None]
    colors = np.array(top) * (1 - t) + np.array(bottom) * t
    return Image.fromarray(np.repeat(colors, width, axis=1).astype(np.uint8))


def draw_box(draw, gx, gy, w, d, h, color, outline=INK):
    """Isometric box occupying [gx, gx+w] x [gy, gy+d], height h pixels."""
    top = [iso(gx, gy, h), iso(gx + w, gy, h), iso(gx + w, gy + d, h), iso(gx, gy + d, h)]
    left = [iso(gx, gy + d, 0), iso(gx + w, gy + d, 0), iso(gx + w, gy + d, h), iso(gx, gy + d, h)]
    right = [iso(gx + w, gy, 0), iso(gx + w, gy + d, 0), iso(gx + w, gy + d, h), iso(gx + w, gy, h)]
    draw.polygon(left, fill=shade(color, 0.82), outline=outline)
    draw.polygon(right, fill=shade(color, 0.68), outline=outline)
    draw.polygon(top, fill=color, outline=outline)


def draw_building(draw, gx, gy, floors, wall, roof, snowy, windows):
    floor_h = 29
    height = floors * floor_h
    draw_box(draw, gx + 0.1, gy + 0.1, 0.8, 0.8, height, wall)
    roof_color = (245, 248, 252) if snowy else roof
    draw_box(draw, gx + 0.05, gy + 0.05, 0.9, 0.9, height + 6, roof_color)
    for floor in range(floors):
        for side in range(2):
            t = 0.3 + 0.4 * side
            # Window on the front-left face.
            cx, cy = iso(gx + 0.1 + 0.8 * t, gy + 0.9, floor * floor_h + 12)
            windows.append((cx, cy))
            # Window on the front-right face.
            cx, cy = iso(gx + 0.9, gy + 0.1 + 0.8 * t, floor * floor_h + 12)
            windows.append((cx, cy))


def draw_tree(draw, gx, gy, season, rng):
    trunk_bottom = iso(gx + 0.5, gy + 0.5, 0)
    trunk_top = iso(gx + 0.5, gy + 0.5, 22)
    draw.line([trunk_bottom, trunk_top], fill=(120, 85, 60), width=5)
    colors = FOLIAGE[season]
    cx, cy = iso(gx + 0.5, gy + 0.5, 34)
    if season == "winter" and rng.random() < 0.5:
        for angle in (-0.8, 0.0, 0.8):  # bare branches
            draw.line([trunk_top, (cx + 14 * np.sin(angle), cy - 6 * np.cos(angle))], fill=(120, 85, 60), width=2)
        return
    for offset_x, offset_y, radius in [(-7, 3, 12), (7, 3, 12), (0, -6, 14)]:
        color = colors[int(rng.integers(len(colors)))]
        draw.ellipse(
            [cx + offset_x - radius, cy + offset_y - radius, cx + offset_x + radius, cy + offset_y + radius],
            fill=color,
            outline=INK,
        )


def draw_cloud(draw, x, y, scale, color):
    for dx, dy, r in [(-22, 4, 16), (0, -6, 22), (24, 2, 17), (8, 8, 18)]:
        r *= scale
        draw.ellipse([x + dx * scale - r, y + dy * scale - r, x + dx * scale + r, y + dy * scale + r], fill=color)


def render_scene(weather, time_of_day, season, seed=1):
    rng = np.random.default_rng(seed)
    night = time_of_day in ("night", "late_night")
    sky_top, sky_bottom = SKY[time_of_day]
    if weather in ("cloudy", "rain", "storm", "fog", "snow"):
        gray = 0.55 if weather == "storm" else 0.35
        sky_top = tuple(int(c * (1 - gray) + 150 * gray) for c in sky_top)
        sky_bottom = tuple(int(c * (1 - gray) + 170 * gray) for c in sky_bottom)
    if weather == "heat" and not night:
        sky_bottom = (255, 215, 150)
    canvas = vertical_gradient(sky_top, sky_bottom).convert("RGBA")
    sky = ImageDraw.Draw(canvas)

    # Sun or moon and stars.
    if night:
        if weather in ("clear", "partly_cloudy", "heat"):
            for _ in range(60):
                x, y = rng.integers(0, SIZE), rng.integers(0, 220)
                sky.point((int(x), int(y)), fill=(255, 255, 230))
        sky.ellipse([380, 50, 420, 90], fill=(250, 245, 220))
        sky.ellipse([392, 44, 432, 84], fill=sky_top)
    elif weather in ("clear", "partly_cloudy", "heat"):
        sun_y = {"dawn": 170, "morning": 90, "noon": 55, "dusk": 165}[time_of_day]
        sun_color = (255, 170, 90) if time_of_day in ("dawn", "dusk") else (255, 225, 120)
        sky.ellipse([400 - 28, sun_y - 28, 400 + 28, sun_y + 28], fill=sun_color)

    cloud_color = (235, 238, 245) if not night else (90, 95, 130)
    if weather == "storm":
        cloud_color = (110, 110, 125) if not night else (55, 55, 75)
    elif weather in ("rain", "snow", "cloudy"):
        cloud_color = (190, 195, 205) if not night else (70, 75, 100)
    cloud_count = {"partly_cloudy": 2, "cloudy": 5, "rain": 5, "storm": 6, "snow": 4, "fog": 3}.get(weather, 0)
    for _ in range(cloud_count):
        draw_cloud(sky, int(rng.integers(40, 470)), int(rng.integers(40, 150)), float(rng.uniform(0.8, 1.4)), cloud_color)

    # Town layer, drawn back to front.
    town = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(town)
    snowy = season == "winter" or weather == "snow"
    ground = (238, 240, 245) if snowy else GROUND[season]
    draw_box(draw, 0, 0, GRID, GRID, 18, ground)
    for gx in range(GRID):  # little path
        draw.polygon([iso(gx, 2.4, 18), iso(gx + 1, 2.4, 18), iso(gx + 1, 2.8, 18), iso(gx, 2.8, 18)], fill=(225, 210, 185))
    windows = []
    objects = [("b", b) for b in BUILDINGS] + [("t", t) for t in TREES]
    objects.sort(key=lambda item: item[1][0] + item[1][1])
    for kind, data in objects:
        if kind == "b":
            gx, gy, floors, wall, roof = data
            draw_building(draw, gx, gy, floors, wall, roof, snowy, windows)
        else:
            draw_tree(draw, data[0], data[1], "winter" if weather == "snow" else season, rng)

    # Lighting: multiply tint, then emissive windows.
    tint = Image.new("RGBA", (SIZE, SIZE), LIGHT[time_of_day] + (255,))
    lit = ImageChops.multiply(town, tint)
    lit.putalpha(town.getchannel("A"))
    canvas.alpha_composite(lit)
    effects = ImageDraw.Draw(canvas)
    lights_on = time_of_day in ("dusk", "night", "late_night") or weather == "storm"
    for x, y in windows:
        on = lights_on and rng.random() < (0.85 if time_of_day != "late_night" else 0.35)
        color = (255, 215, 120) if on else (150, 180, 210)
        effects.rectangle([x - 3, y - 4, x + 3, y + 4], fill=color, outline=INK)
    if lights_on:
        glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        for x, y in windows:
            glow_draw.ellipse([x - 10, y - 10, x + 10, y + 10], fill=(255, 200, 100, 50))
        canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(6)))

    # Weather particles and overlays.
    overlay = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    if weather in ("rain", "storm"):
        for _ in range(260 if weather == "storm" else 160):
            x, y = int(rng.integers(0, SIZE)), int(rng.integers(0, SIZE))
            od.line([(x, y), (x - 4, y + 14)], fill=(200, 215, 240, 170), width=1)
    if weather == "storm":
        x = int(rng.integers(120, 380))
        points = [(x, 60)]
        for _ in range(5):
            x += int(rng.integers(-18, 18))
            points.append((x, points[-1][1] + 28))
        od.line(points, fill=(255, 250, 200, 255), width=3)
    if weather == "snow":
        for _ in range(220):
            x, y = int(rng.integers(0, SIZE)), int(rng.integers(0, SIZE))
            r = int(rng.integers(1, 4))
            od.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 220))
    if weather == "fog":
        for y in range(120, SIZE, 40):
            od.rectangle([0, y, SIZE, y + 22], fill=(235, 235, 240, 70))
        overlay = overlay.filter(ImageFilter.GaussianBlur(10))
        od = ImageDraw.Draw(overlay)
        od.rectangle([0, 0, SIZE, SIZE], fill=(225, 228, 235, 70))
    if weather == "heat" and not night:
        od.rectangle([0, 0, SIZE, SIZE], fill=(255, 170, 80, 35))
    canvas.alpha_composite(overlay)
    return canvas.convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="output")
    parser.add_argument("--sample", action="store_true")
    arguments = parser.parse_args()
    output = Path(arguments.out)
    (output / "library").mkdir(parents=True, exist_ok=True)

    combos = list(itertools.product(WEATHERS, TIMES, SEASONS))
    if arguments.sample:
        combos = combos[::17]
    thumbs = []
    for weather, time_of_day, season in combos:
        scene = render_scene(weather, time_of_day, season)
        scene.save(output / "library" / f"{weather}__{time_of_day}__{season}.png", optimize=True)
        thumbs.append(scene.resize((128, 128), Image.LANCZOS))

    columns = len(TIMES) * len(SEASONS) if not arguments.sample else 6
    rows = (len(thumbs) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * 128, rows * 128), "white")
    for index, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((index % columns) * 128, (index // columns) * 128))
    sheet.save(output / "contact_sheet.png", optimize=True)
    print(f"rendered {len(combos)} scenes -> {output / 'library'}")


if __name__ == "__main__":
    main()
