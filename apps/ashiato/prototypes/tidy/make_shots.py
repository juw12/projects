"""Render mock phone screenshots for the tidy-deck prototype, then run the tidy pipeline on them.

Writes prototypes/cozy3d/assets/shots/*.png and shots.json:
  [{file, text, drawer, score, expiry, duplicateOf}]
The text field stands in for Vision OCR output (on iOS it is read from the real image).
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import tidy

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "ios" / "Resources" / "Fonts"
OUT = ROOT / "prototypes" / "cozy3d" / "assets" / "shots"
WIDTH, HEIGHT = 360, 740


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    files = {
        "ja": "ZenMaruGothic-Regular.ttf",
        "ja_bold": "ZenMaruGothic-Bold.ttf",
        "ko": "GowunDodum-Regular.ttf",
        "hand": "KleeOne-Regular.ttf",
    }
    return ImageFont.truetype(str(FONTS / files[name]), size)


def canvas(background: str, status_time: str = "9:41", dark_status: bool = True) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    picture = Image.new("RGB", (WIDTH, HEIGHT), background)
    draw = ImageDraw.Draw(picture)
    ink = "#222222" if dark_status else "#ffffff"
    draw.text((26, 14), status_time, font=font("ja_bold", 15), fill=ink)
    draw.rounded_rectangle((300, 18, 330, 30), radius=4, outline=ink, width=2)
    draw.rectangle((303, 21, 322, 27), fill=ink)
    return picture, draw


def shot_shopping() -> tuple[Image.Image, str]:
    picture, draw = canvas("#ffffff")
    draw.rectangle((0, 50, WIDTH, 380), fill="#efe9e1")
    # sweater silhouette
    draw.polygon([(110, 130), (150, 110), (210, 110), (250, 130), (285, 220), (255, 232), (240, 190), (240, 330), (120, 330), (120, 190), (105, 232), (75, 220)], fill="#b9a58c")
    draw.arc((150, 100, 210, 140), 0, 180, fill="#9c8a72", width=4)
    lines = ["UNIQLO", "スフレヤーンクルーネックセーター", "¥3,990 税込", "サイズ M L XL"]
    draw.text((20, 400), lines[0], font=font("ja_bold", 14), fill="#888")
    draw.text((20, 424), lines[1], font=font("ja", 18), fill="#222")
    draw.text((20, 460), lines[2], font=font("ja_bold", 26), fill="#c0392b")
    draw.text((20, 506), lines[3], font=font("ja", 15), fill="#555")
    draw.rounded_rectangle((20, 640, 340, 690), radius=8, fill="#222")
    draw.text((115, 652), "カートに入れる", font=font("ja_bold", 18), fill="#fff")
    return picture, "\n".join(lines + ["カートに入れる"])


def shot_place() -> tuple[Image.Image, str]:
    picture, draw = canvas("#eef0e6")
    for x in range(-40, WIDTH, 70):
        draw.line((x, 40, x + 120, 470), fill="#ffffff", width=9)
    for y in range(60, 470, 80):
        draw.line((0, y, WIDTH, y + 30), fill="#ffffff", width=7)
    draw.ellipse((40, 300, 140, 380), fill="#cfe3c3")
    draw.ellipse((166, 196, 196, 226), fill="#e8875a")
    draw.polygon([(170, 220), (192, 220), (181, 245)], fill="#e8875a")
    draw.ellipse((176, 206, 186, 216), fill="#fff")
    draw.rounded_rectangle((0, 450, WIDTH, HEIGHT + 20), radius=24, fill="#ffffff")
    lines = ["어니언 성수", "카페 · 리뷰 3,412", "영업 중 · 22:00에 영업 종료", "서울 성동구 아차산로9길 8", "성수역 2번 출구 도보 5분"]
    draw.text((22, 478), lines[0], font=font("ko", 24), fill="#222")
    for index, line in enumerate(lines[1:]):
        draw.text((22, 520 + index * 28), line, font=font("ko", 15), fill="#2e7d32" if "영업" in line else "#555")
    draw.rounded_rectangle((22, 660, 170, 702), radius=21, fill="#03c75a")
    draw.text((62, 670), "길찾기", font=font("ko", 17), fill="#fff")
    return picture, "\n".join(lines + ["길찾기"])


def shot_recipe() -> tuple[Image.Image, str]:
    picture, draw = canvas("#fffaf3")
    draw.ellipse((70, 70, 290, 290), fill="#f3e3c8")
    draw.ellipse((95, 95, 265, 265), fill="#d9893f")
    for cx, cy in [(140, 150), (200, 140), (170, 200), (215, 205), (130, 215)]:
        draw.ellipse((cx - 18, cy - 14, cx + 18, cy + 14), fill="#b5652a")
    draw.line((60, 300, 300, 300), fill="#e5d8c4", width=2)
    lines = ["鶏むね肉の甘酢炒め", "材料(2人分)", "鶏むね肉 300g", "醤油 大さじ2", "砂糖 大さじ1", "酢 大さじ2", "作り方"]
    draw.text((22, 320), lines[0], font=font("ja_bold", 22), fill="#3a3240")
    for index, line in enumerate(lines[1:]):
        weight = "ja_bold" if line in ("材料(2人分)", "作り方") else "ja"
        draw.text((22, 368 + index * 34), line, font=font(weight, 17), fill="#4a4048")
    return picture, "\n".join(lines)


def shot_ticket() -> tuple[Image.Image, str]:
    picture, draw = canvas("#1f3b6f", dark_status=False)
    draw.rounded_rectangle((20, 70, 340, 690), radius=20, fill="#ffffff")
    lines = ["新幹線 のぞみ 215号", "東京 → 京都", "11月14日 10:03 → 12:17", "8号車 12番 A席", "予約番号 2F8K1Q"]
    draw.text((40, 96), lines[0], font=font("ja_bold", 20), fill="#1f3b6f")
    draw.text((40, 140), lines[1], font=font("ja_bold", 30), fill="#222")
    draw.text((40, 196), lines[2], font=font("ja", 17), fill="#333")
    draw.text((40, 228), lines[3], font=font("ja", 17), fill="#333")
    draw.text((40, 260), lines[4], font=font("ja_bold", 17), fill="#333")
    # QR-ish block
    generator = tidy_random(42)
    for row in range(21):
        for column in range(21):
            corner = (row < 7 and column < 7) or (row < 7 and column > 13) or (row > 13 and column < 7)
            if corner or next(generator) > 0.5:
                x, y = 75 + column * 10, 330 + row * 10
                draw.rectangle((x, y, x + 9, y + 9), fill="#111")
    return picture, "\n".join(lines)


def tidy_random(seed: int):
    state = seed
    while True:
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        yield state / 0x7FFFFFFF


def shot_chat(status_time: str) -> tuple[Image.Image, str]:
    picture, draw = canvas("#b2c7d9", status_time=status_time)
    draw.rectangle((0, 44, WIDTH, 92), fill="#a9bed0")
    draw.text((150, 58), "엄마", font=font("ko", 18), fill="#222")
    bubbles = [
        ("left", "밥 먹었어?", "오후 7:02"),
        ("right", "응 먹었어 ㅎㅎ", "읽음 오후 7:05"),
        ("left", "주말에 올 거지?", ""),
        ("left", "김치 담가놨어", ""),
    ]
    y = 120
    for side, message, meta in bubbles:
        width = int(draw.textlength(message, font=font("ko", 17))) + 28
        if side == "left":
            draw.ellipse((14, y, 50, y + 36), fill="#f6c8a8")
            box = (58, y, 58 + width, y + 40)
            draw.rounded_rectangle(box, radius=14, fill="#ffffff")
            draw.text((72, y + 9), message, font=font("ko", 17), fill="#222")
            if meta:
                draw.text((box[2] + 6, y + 22), meta, font=font("ko", 11), fill="#555")
        else:
            box = (WIDTH - 16 - width, y, WIDTH - 16, y + 40)
            draw.rounded_rectangle(box, radius=14, fill="#fee500")
            draw.text((box[0] + 14, y + 9), message, font=font("ko", 17), fill="#222")
            if meta:
                draw.text((box[0] - 76, y + 22), meta, font=font("ko", 11), fill="#555")
        y += 64
    draw.rectangle((0, 690, WIDTH, HEIGHT), fill="#ffffff")
    text = "엄마\n밥 먹었어?\n오후 7:02\n응 먹었어 ㅎㅎ\n읽음 오후 7:05\n주말에 올 거지?\n김치 담가놨어"
    return picture, text


def shot_quote() -> tuple[Image.Image, str]:
    picture, draw = canvas("#f3ead8")
    lines = ["「急がなくていい。", "ちゃんと歩いていれば、", "それでいい。」"]
    for index, line in enumerate(lines):
        draw.text((48, 290 + index * 52), line, font=font("hand", 26), fill="#3a3240")
    draw.text((210, 470), "— 散歩の本より", font=font("hand", 15), fill="#8a7f80")
    return picture, "\n".join(lines)


def shot_settings() -> tuple[Image.Image, str]:
    picture, draw = canvas("#f2f2f7")
    draw.text((20, 60), "設定", font=font("ja_bold", 30), fill="#111")
    items = ["Wi-Fi", "Bluetooth", "モバイル通信", "通知", "サウンドと触覚", "集中モード", "スクリーンタイム"]
    colors = ["#2f7cf6", "#2f7cf6", "#34c759", "#ff3b30", "#ff2d55", "#5856d6", "#5856d6"]
    draw.rounded_rectangle((16, 120, 344, 120 + 52 * len(items)), radius=12, fill="#ffffff")
    for index, (item, color) in enumerate(zip(items, colors)):
        y = 120 + index * 52
        draw.rounded_rectangle((30, y + 12, 58, y + 40), radius=7, fill=color)
        draw.text((72, y + 14), item, font=font("ja", 17), fill="#111")
        draw.text((320, y + 14), "›", font=font("ja", 20), fill="#bbb")
    return picture, "設定\n" + "\n".join(items)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    today = dt.date(2026, 11, 2)   # fixed so the prototype is reproducible
    shots = [
        ("shot_shopping.png", shot_shopping()),
        ("shot_place.png", shot_place()),
        ("shot_recipe.png", shot_recipe()),
        ("shot_ticket.png", shot_ticket()),
        ("shot_chat.png", shot_chat("19:06")),
        ("shot_chat_again.png", shot_chat("19:07")),
        ("shot_quote.png", shot_quote()),
        ("shot_settings.png", shot_settings()),
    ]
    for name, (picture, _) in shots:
        picture.save(OUT / name, optimize=True)

    paths = [OUT / name for name, _ in shots]
    duplicate_of: dict[str, str] = {}
    for group in tidy.near_duplicates(paths):
        keeper = group[0].name
        for extra in group[1:]:
            duplicate_of[extra.name] = keeper

    records = []
    for name, (_, ocr_text) in shots:
        drawer, score = tidy.classify(ocr_text)
        expiry = tidy.find_expiry(ocr_text, today)
        records.append({
            "file": name,
            "text": ocr_text,
            "drawer": drawer,
            "score": round(score, 1),
            "expiry": expiry.isoformat() if expiry else None,
            "duplicateOf": duplicate_of.get(name),
        })
        print(f"{name:22s} {drawer:9s} {score:5.1f}  expiry={expiry}  dup_of={duplicate_of.get(name)}")
    (OUT / "shots.json").write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
