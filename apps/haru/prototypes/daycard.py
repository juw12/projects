"""Haru day-card prototype: combines all three prototypes into one card.

    scene (weather/time/season library) + doodled photo sticker
    + walk map snippet + date, note, mood

Usage:
    python daycard.py
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "doodle"))
sys.path.insert(0, str(HERE / "scenes"))

import doodle  # noqa: E402
import scenes  # noqa: E402

CARD_W, CARD_H = 1080, 1920  # 9:16 story size, also the share-card format
PAPER = (250, 246, 236)
INK = (58, 50, 64)
MUTED = (140, 130, 140)


def load_font(size, bold=False):
    candidates = ["seguisb.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"]
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def polaroid(image, width, angle):
    image = ImageOps.fit(image, (width, width))
    frame = Image.new("RGB", (width + 40, width + 110), (255, 255, 255))
    frame.paste(image, (20, 20))
    shadow = Image.new("RGBA", frame.size, (0, 0, 0, 60))
    framed = Image.new("RGBA", (frame.width + 16, frame.height + 16), (0, 0, 0, 0))
    framed.paste(shadow, (12, 12))
    framed.paste(frame, (0, 0))
    return framed.rotate(angle, expand=True, resample=Image.BICUBIC)


def make_day_card(photo_path, weather, time_of_day, season, date_text, note, mood, walk_km, pioneered_km, map_path):
    card = Image.new("RGB", (CARD_W, CARD_H), PAPER)
    draw = ImageDraw.Draw(card)

    scene = scenes.render_scene(weather, time_of_day, season).resize((CARD_W, CARD_W), Image.LANCZOS)
    card.paste(scene, (0, 0))

    sticker = polaroid(doodle.doodle(Image.open(photo_path), "crayon"), 380, -6)
    card.paste(sticker, (CARD_W - sticker.width - 50, CARD_W - 330), sticker)

    draw.text((70, CARD_W + 50), date_text, font=load_font(64, bold=True), fill=INK)
    weather_label = f"{weather.replace('_', ' ')} · {time_of_day.replace('_', ' ')} · {season}"
    draw.text((70, CARD_W + 135), weather_label, font=load_font(34), fill=MUTED)
    draw.text((70, CARD_W + 220), f"\u201c{note}\u201d", font=load_font(44), fill=INK)
    draw.text((70, CARD_W + 300), f"mood  {'●' * mood}{'○' * (5 - mood)}", font=load_font(36), fill=INK)

    walk_map = Image.open(map_path).convert("RGB")
    walk_map = ImageOps.fit(walk_map, (420, 420), centering=(0.5, 0.45))
    card.paste(walk_map, (70, CARD_W + 380))
    draw.rectangle([70, CARD_W + 380, 490, CARD_W + 800], outline=INK, width=3)
    stats_font = load_font(40, bold=True)
    draw.text((540, CARD_W + 420), f"{walk_km:.1f} km walked", font=stats_font, fill=INK)
    draw.text((540, CARD_W + 480), f"{pioneered_km:.1f} km new roads", font=stats_font, fill=(232, 120, 84))
    draw.text((540, CARD_W + 560), "1 year ago today:", font=load_font(32), fill=MUTED)
    draw.text((540, CARD_W + 605), "\u201cfirst coffee at the\n new place on 3rd\u201d", font=load_font(32), fill=INK)
    draw.text((CARD_W - 230, CARD_H - 70), "haru", font=load_font(36, bold=True), fill=MUTED)
    return card


def main():
    output = HERE / "daycard_output"
    output.mkdir(exist_ok=True)
    examples = [
        dict(photo_path=HERE / "doodle/input/cat.jpg", weather="clear", time_of_day="morning", season="spring",
             date_text="Sat, April 12", note="the neighbor's cat finally let me pet it", mood=5,
             walk_km=4.2, pioneered_km=0.8),
        dict(photo_path=HERE / "doodle/input/coffee.jpg", weather="rain", time_of_day="dusk", season="autumn",
             date_text="Tue, October 21", note="rainy walk, warm coffee", mood=3,
             walk_km=2.1, pioneered_km=0.3),
    ]
    map_path = HERE / "walkmap/output/map_day30.png"
    for index, example in enumerate(examples, start=1):
        card = make_day_card(map_path=map_path, **example)
        card.save(output / f"daycard_{index}.png", optimize=True)
        print("saved", output / f"daycard_{index}.png")


if __name__ == "__main__":
    main()
