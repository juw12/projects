"""Editorial Ep 1 — "5 gates every gadget passes" (Design → EVT → DVT → PVT → MP).

Clean white editorial layout: progress bar, 5-step tracker, serif headline,
illustration card with credit line, bold marker-highlight captions.
Bilingual: --lang id / --lang en.

Usage:
    ../.venv/bin/python make_video.py --lang en --preview
    ../.venv/bin/python make_video.py --lang en
"""

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "common"))
from shortlib import (  # noqa: E402
    FONT_BLACK, FONT_BOLD, FONT_REG, FONT_SERIF, FONT_SERIF_BOLD, FONT_SERIF_ITALIC, HEIGHT,
    SAMPLE_RATE, WIDTH, blip, build_timeline, contact_sheet, current_chunk, ease, encode, font, lerp,
    lerp_rgb, make_pad_music, place, scene_at, smooth_noise, whoosh, write_mix,
)

EPISODE_DIR = Path(__file__).resolve().parent

PAPER = (246, 243, 236)
INK = (24, 24, 28)
MUTED = (120, 118, 112)
LINE = (210, 205, 195)
ACCENT = (228, 74, 42)
MARKER = (255, 221, 87)
BLUE = (52, 104, 200)
GREEN = (36, 150, 92)
PCB = (34, 128, 76)
CARD = (255, 255, 255)

CARD_BOX = (70, 600, 1010, 1270)
STEP_X = [150, 345, 540, 735, 930]
TRACKER_Y = 470

TEXT = {
    "en": {
        "kicker": "FROM IDEA TO SHELF",
        "steps": ["DESIGN", "EVT", "DVT", "PVT", "MP"],
        "credit": "Illustration · original artwork",
        "scenes": [
            dict(key="hook", step=-1,
                 say="Before any gadget reaches a store, it passes five gates. Most people never hear about them.",
                 caption="Before any gadget reaches a store, it passes 5 gates. Most people never hear about them.",
                 title="5 gates every gadget\npasses before it ships", sub=None, chip="consumer electronics · NPI"),
            dict(key="design", step=0,
                 say="Step one: design. Engineers model every part in CAD, and simulate it, before anything "
                     "is built.",
                 caption="Step 1: design. Engineers model every part in CAD and simulate it, before anything "
                         "is built.",
                 title="Design", sub="CAD models + simulation", chip="nothing physical yet"),
            dict(key="evt", step=1,
                 say="Step two: E.V.T., engineering validation. The first prototypes, often partly hand built. "
                     "One question: does it work at all?",
                 caption="Step 2: EVT, engineering validation. The first prototypes, often partly hand-built. "
                         "One question: does it work at all?",
                 title="EVT", sub="Engineering Validation Test", chip="first prototypes"),
            dict(key="dvt", step=2,
                 say="Step three: D.V.T., design validation. Now we try to break it. Drops, heat, cold, and "
                     "water. Outdoor cameras are often rated from minus 30 to plus 60 degrees Celsius.",
                 caption="Step 3: DVT, design validation. Now we try to break it. Drops, heat, cold and water. "
                         "Outdoor cameras are often rated −30 to +60 °C.",
                 title="DVT", sub="Design Validation Test", chip="drop · thermal · water"),
            dict(key="pvt", step=3,
                 say="Step four: P.V.T., production validation. The real factory line, at real speed. Can we "
                     "build thousands, all the same?",
                 caption="Step 4: PVT, production validation. The real factory line, at real speed. Can we "
                         "build 1000s, all the same?",
                 title="PVT", sub="Production Validation Test", chip="real line · real speed"),
            dict(key="mp", step=4,
                 say="Step five: mass production. Only now does it ship. The whole journey often takes a year "
                     "or more.",
                 caption="Step 5: mass production. Only now does it ship. The whole journey often takes a year "
                         "or more.",
                 title="Mass Production", sub="MP", chip="often 12+ months in total"),
            dict(key="cta", step=5,
                 say="I work at step three every day. Follow for what really happens inside a factory.",
                 caption="I work at step 3 every day. Follow for what really happens inside a factory.",
                 title="Which step\nsurprised you?", sub=None, chip="follow for part 2"),
        ],
        "labels": {
            "works": "WORKS?", "drop": "DROP", "heat": "HEAT / COLD", "water": "WATER",
            "unit": "UNIT", "months": "MONTHS", "pass": "PASS",
        },
    },
    "id": {
        "kicker": "DARI IDE KE RAK TOKO",
        "steps": ["DESAIN", "EVT", "DVT", "PVT", "MP"],
        "credit": "Ilustrasi · karya orisinal",
        "scenes": [
            dict(key="hook", step=-1,
                 say="Sebelum gadget sampai di toko, ia harus melewati lima gerbang. Kebanyakan orang tidak "
                     "pernah mendengarnya.",
                 caption="Sebelum gadget sampai di toko, ia harus melewati 5 gerbang. Kebanyakan orang tidak "
                         "pernah mendengarnya.",
                 title="5 gerbang sebelum\ngadget dijual", sub=None, chip="elektronik konsumen · NPI"),
            dict(key="design", step=0,
                 say="Tahap satu: desain. Insinyur memodelkan setiap komponen di CAD, dan mensimulasikannya, "
                     "sebelum apa pun dibuat.",
                 caption="Tahap 1: desain. Insinyur memodelkan setiap komponen di CAD dan mensimulasikannya, "
                         "sebelum apa pun dibuat.",
                 title="Desain", sub="Model CAD + simulasi", chip="belum ada barang fisik"),
            dict(key="evt", step=1,
                 say="Tahap dua: E V T, validasi engineering. Prototipe pertama, sering sebagian dirakit "
                     "tangan. Satu pertanyaan: apakah ini berfungsi?",
                 caption="Tahap 2: EVT, validasi engineering. Prototipe pertama, sering sebagian dirakit "
                         "tangan. Satu pertanyaan: apakah ini berfungsi?",
                 title="EVT", sub="Engineering Validation Test", chip="prototipe pertama"),
            dict(key="dvt", step=2,
                 say="Tahap tiga: D V T, validasi desain. Sekarang kami coba merusaknya. Dijatuhkan, "
                     "dipanaskan, didinginkan, dan disemprot air. Kamera outdoor sering dirancang untuk minus "
                     "tiga puluh sampai enam puluh derajat Celsius.",
                 caption="Tahap 3: DVT, validasi desain. Sekarang kami coba merusaknya. Dijatuhkan, "
                         "dipanaskan, didinginkan, dan disemprot air. Kamera outdoor sering dirancang untuk "
                         "−30 sampai +60 °C.",
                 title="DVT", sub="Design Validation Test", chip="jatuh · suhu · air"),
            dict(key="pvt", step=3,
                 say="Tahap empat: P V T, validasi produksi. Lini pabrik sungguhan, kecepatan sungguhan. "
                     "Bisakah kita membuat ribuan unit, semuanya sama?",
                 caption="Tahap 4: PVT, validasi produksi. Lini pabrik sungguhan, kecepatan sungguhan. Bisakah "
                         "kita membuat ribuan unit, semuanya sama?",
                 title="PVT", sub="Production Validation Test", chip="lini asli · kecepatan asli"),
            dict(key="mp", step=4,
                 say="Tahap lima: produksi massal. Baru sekarang produk dikirim. Seluruh perjalanan ini sering "
                     "memakan waktu setahun atau lebih.",
                 caption="Tahap 5: produksi massal. Baru sekarang produk dikirim. Seluruh perjalanan ini sering "
                         "memakan waktu setahun atau lebih.",
                 title="Produksi Massal", sub="Mass Production (MP)", chip="sering 12+ bulan total"),
            dict(key="cta", step=5,
                 say="Saya bekerja di tahap tiga setiap hari. Follow untuk melihat apa yang sebenarnya terjadi "
                     "di dalam pabrik.",
                 caption="Saya bekerja di tahap 3 setiap hari. Follow untuk melihat apa yang sebenarnya terjadi "
                         "di dalam pabrik.",
                 title="Tahap mana yang\nbikin kamu kaget?", sub=None, chip="follow untuk part 2"),
        ],
        "labels": {
            "works": "BERFUNGSI?", "drop": "UJI JATUH", "heat": "PANAS / DINGIN", "water": "AIR",
            "unit": "UNIT", "months": "BULAN", "pass": "LOLOS",
        },
    },
}


# --------------------------------------------------------------------------
# Small drawing helpers
# --------------------------------------------------------------------------
def check_mark(draw, center, size, color, width=6):
    x, y = center
    draw.line([(x - size * 0.5, y), (x - size * 0.15, y + size * 0.35), (x + size * 0.55, y - size * 0.4)],
              fill=color, width=width, joint="curve")


def camera_icon(draw, center, scale=1.0, body=(235, 236, 240), tint=None):
    """Simple bullet-camera side icon."""
    x, y = center
    w, h = 170 * scale, 90 * scale
    color = tint or body
    draw.rounded_rectangle([x - w / 2, y - h / 2, x + w / 2, y + h / 2], radius=28 * scale, fill=color,
                           outline=INK, width=max(2, int(5 * scale)))
    draw.rectangle([x + w / 2 - 4 * scale, y - h * 0.32, x + w / 2 + 22 * scale, y + h * 0.32], fill=INK)
    draw.ellipse([x + w / 2 + 6 * scale, y - 16 * scale, x + w / 2 + 30 * scale, y + 16 * scale],
                 fill=(70, 120, 190), outline=INK, width=max(2, int(3 * scale)))
    draw.rectangle([x - w * 0.15, y + h / 2, x - w * 0.05, y + h / 2 + 40 * scale], fill=INK)
    draw.ellipse([x - w * 0.36, y - 12 * scale, x - w * 0.28, y - 4 * scale], fill=(230, 60, 60))


def thermometer(draw, x, top, bottom, frac, color):
    draw.rounded_rectangle([x - 22, top, x + 22, bottom], radius=22, fill=CARD, outline=INK, width=5)
    draw.ellipse([x - 40, bottom - 30, x + 40, bottom + 50], fill=color, outline=INK, width=5)
    level = lerp(bottom - 10, top + 20, frac)
    draw.rectangle([x - 11, level, x + 11, bottom], fill=color)


class Video:
    def __init__(self, lang):
        self.lang = lang
        self.tx = TEXT[lang]
        self.scenes = [dict(s) for s in self.tx["scenes"]]
        for scene in self.scenes:
            scene["min_dur"] = 5.0 if scene["key"] != "cta" else 5.5
        self.build_dir = EPISODE_DIR / "build" / lang
        self.output = EPISODE_DIR / f"editorial_ep01_npi_gates_{lang}.mp4"
        self.paper = self.make_paper()
        self.card_shadow = self.make_card_shadow()

    def make_paper(self):
        generator = np.random.default_rng(4)
        grain = generator.normal(0, 3.0, (HEIGHT, WIDTH, 1))
        pixels = np.array(PAPER, dtype=np.float32)[None, None, :] + grain
        return Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))

    def make_card_shadow(self):
        shadow = Image.new("L", (WIDTH, HEIGHT), 0)
        x0, y0, x1, y1 = CARD_BOX
        ImageDraw.Draw(shadow).rounded_rectangle([x0 + 6, y0 + 16, x1 + 6, y1 + 18], radius=26, fill=70)
        return shadow.filter(ImageFilter.GaussianBlur(18))

    # ------------------------------------------------------------------
    def frame(self, global_t):
        scene = scene_at(self.scenes, global_t)
        t = global_t - scene["start"]
        total = self.scenes[-1]["start"] + self.scenes[-1]["dur"]
        canvas = self.paper.copy()
        canvas.paste((205, 200, 190), (0, 0), self.card_shadow)
        draw = ImageDraw.Draw(canvas, "RGBA")

        # progress bar
        draw.rectangle([0, 0, WIDTH, 12], fill=LINE)
        draw.rectangle([0, 0, WIDTH * min(1.0, global_t / total), 12], fill=ACCENT)

        # kicker
        draw.rectangle([70, 140, 92, 162], fill=ACCENT)
        draw.text((108, 151), self.tx["kicker"], font=font(FONT_BOLD, 30), fill=MUTED, anchor="lm")
        if 0 <= scene["step"] <= 4:
            counter = f"{scene['step'] + 1}/5"
            draw.text((1010, 151), counter, font=font(FONT_SERIF_BOLD, 34), fill=INK, anchor="rm")

        self.draw_headline(draw, scene, t)
        self.draw_tracker(draw, scene, t, global_t)

        x0, y0, x1, y1 = CARD_BOX
        draw.rounded_rectangle(CARD_BOX, radius=26, fill=CARD, outline=(226, 222, 214), width=2)
        appear = ease(t / 0.45)
        getattr(self, f"illus_{scene['key']}")(draw, scene, t, global_t, appear)
        draw.text((x0 + 6, y1 + 34), self.tx["credit"], font=font(FONT_SERIF_ITALIC, 26), fill=MUTED,
                  anchor="lm")
        chip = scene["chip"]
        chip_font = font(FONT_BOLD, 26)
        w = draw.textlength(chip, font=chip_font)
        draw.rounded_rectangle([x1 - w - 36, y1 + 14, x1, y1 + 56], radius=21, fill=INK)
        draw.text((x1 - w / 2 - 18, y1 + 35), chip, font=chip_font, fill=PAPER, anchor="mm")

        self.draw_caption(draw, scene, global_t)
        return canvas

    def draw_headline(self, draw, scene, t):
        slide = ease(t / 0.5)
        offset = (1 - slide) * 30
        alpha = int(255 * slide)
        title = scene["title"]
        if scene["sub"] is None:
            draw.multiline_text((70, 205 + offset), title, font=font(FONT_SERIF_BOLD, 64), fill=INK + (alpha,),
                                spacing=8)
            return
        draw.text((70, 200 + offset), title, font=font(FONT_SERIF_BOLD, 88), fill=INK + (alpha,), anchor="la")
        draw.text((72, 310 + offset), scene["sub"], font=font(FONT_SERIF_ITALIC, 40), fill=MUTED + (alpha,),
                  anchor="la")

    def draw_tracker(self, draw, scene, t, global_t):
        step = scene["step"]
        grow = ease(t / 0.6)
        draw.line([(STEP_X[0], TRACKER_Y), (STEP_X[-1], TRACKER_Y)], fill=LINE, width=6)
        if step >= 0:
            reach = min(step, 4)
            prev = max(0, reach - 1)
            x_end = lerp(STEP_X[prev], STEP_X[reach], grow) if step <= 4 else STEP_X[-1]
            draw.line([(STEP_X[0], TRACKER_Y), (x_end, TRACKER_Y)], fill=INK, width=6)
        for index, x in enumerate(STEP_X):
            r = 30
            label = self.tx["steps"][index]
            if index < step or step == 5:
                draw.ellipse([x - r, TRACKER_Y - r, x + r, TRACKER_Y + r], fill=INK)
                check_mark(draw, (x, TRACKER_Y), 30, PAPER, width=6)
                color = INK
            elif index == step:
                pulse = 0.5 + 0.5 * math.sin(global_t * 5)
                halo = r + 8 + 6 * pulse
                draw.ellipse([x - halo, TRACKER_Y - halo, x + halo, TRACKER_Y + halo],
                             fill=ACCENT + (int(60 * grow),))
                draw.ellipse([x - r, TRACKER_Y - r, x + r, TRACKER_Y + r], fill=ACCENT)
                draw.text((x, TRACKER_Y), str(index + 1), font=font(FONT_BLACK, 30), fill=CARD, anchor="mm")
                color = ACCENT
            else:
                draw.ellipse([x - r, TRACKER_Y - r, x + r, TRACKER_Y + r], fill=PAPER, outline=LINE, width=5)
                draw.text((x, TRACKER_Y), str(index + 1), font=font(FONT_BLACK, 28), fill=MUTED, anchor="mm")
                color = MUTED
            draw.text((x, TRACKER_Y + 56), label, font=font(FONT_BLACK, 26), fill=color, anchor="mm")

    def draw_caption(self, draw, scene, global_t):
        chunk = current_chunk(scene, global_t)
        if not chunk:
            return
        caption_font = font(FONT_BLACK, 60)
        text = chunk
        w = draw.textlength(text, font=caption_font)
        while w > 960:
            caption_font = font(FONT_BLACK, caption_font.size - 4)
            w = draw.textlength(text, font=caption_font)
        y = 1440
        highlight = any(ch.isdigit() for ch in text) or any(word.isupper() and len(word) > 1
                                                             for word in text.replace(",", "").split())
        if highlight:
            draw.rectangle([540 - w / 2 - 16, y - 6, 540 + w / 2 + 16, y + 72], fill=MARKER)
        draw.text((540, y), text, font=caption_font, fill=INK, anchor="ma")

    # ------------------------------------------------------------------
    # Illustrations (card area)
    # ------------------------------------------------------------------
    def illus_hook(self, draw, scene, t, global_t, appear, all_done=False):
        x0, y0, x1, y1 = CARD_BOX
        ground = y1 - 170
        draw.line([(x0 + 40, ground), (x1 - 40, ground)], fill=LINE, width=6)
        gate_x = [x0 + 120 + k * 175 for k in range(5)]
        travel = 1.0 if all_done else ease((t - 0.6) / max(1.0, scene["dur"] - 1.6))
        icon_x = lerp(x0 + 30, x1 - 40, travel)
        for k, gx in enumerate(gate_x):
            passed = icon_x > gx + 20
            color = GREEN if passed else (190, 186, 178)
            draw.rectangle([gx - 50, ground - 230, gx - 36, ground], fill=color)
            draw.rectangle([gx + 36, ground - 230, gx + 50, ground], fill=color)
            draw.rectangle([gx - 60, ground - 250, gx + 60, ground - 222], fill=color)
            draw.text((gx, ground + 50), self.tx["steps"][k], font=font(FONT_BLACK, 28),
                      fill=INK if passed else MUTED, anchor="mm")
            if passed:
                check_mark(draw, (gx, ground - 290), 40, GREEN, width=8)
        # phone-like gadget icon
        bob = 6 * math.sin(global_t * 8)
        draw.rounded_rectangle([icon_x - 32, ground - 120 + bob, icon_x + 32, ground - 6 + bob], radius=14,
                               fill=INK)
        draw.rounded_rectangle([icon_x - 24, ground - 110 + bob, icon_x + 24, ground - 24 + bob], radius=8,
                               fill=BLUE)
        # store shelf at the end
        draw.text((x1 - 60, y0 + 70), "SHOP" if self.lang == "en" else "TOKO", font=font(FONT_BLACK, 34),
                  fill=ACCENT, anchor="rm")

    def illus_design(self, draw, scene, t, global_t, appear):
        x0, y0, x1, y1 = CARD_BOX
        for gx in range(x0 + 30, x1 - 20, 40):
            draw.line([(gx, y0 + 20), (gx, y1 - 20)], fill=(236, 240, 248), width=1)
        for gy in range(y0 + 20, y1 - 20, 40):
            draw.line([(x0 + 20, gy), (x1 - 20, gy)], fill=(236, 240, 248), width=1)
        angle = 0.6 + global_t * 0.5
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 10
        size = (200, 110, 120)
        verts = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    verts.append((sx * size[0], sy * size[1], sz * size[2]))

        def project(v):
            x, y, z = v
            xr = x * math.cos(angle) + z * math.sin(angle)
            zr = -x * math.sin(angle) + z * math.cos(angle)
            yr = y * 0.92 - zr * 0.35
            return (cx + xr, cy + yr)

        edges = [(a, b) for a in range(8) for b in range(a + 1, 8)
                 if sum(1 for i in range(3) if verts[a][i] != verts[b][i]) == 1]
        reveal = appear
        for a, b in edges:
            pa, pb = project(verts[a]), project(verts[b])
            pb = (lerp(pa[0], pb[0], reveal), lerp(pa[1], pb[1], reveal))
            draw.line([pa, pb], fill=BLUE, width=5)
        # lens cylinder on +x face
        lens = []
        for k in range(24):
            a = 2 * math.pi * k / 24
            lens.append(project((size[0], 55 * math.cos(a), 55 * math.sin(a))))
            lens.append(project((size[0] + 80, 55 * math.cos(a), 55 * math.sin(a))))
        front = [lens[i] for i in range(1, len(lens), 2)]
        back = [lens[i] for i in range(0, len(lens), 2)]
        draw.line(back + [back[0]], fill=BLUE, width=4)
        draw.line(front + [front[0]], fill=BLUE, width=4)
        for i in range(0, 24, 6):
            draw.line([back[i], front[i]], fill=BLUE, width=3)
        for v in verts:
            px, py = project(v)
            draw.ellipse([px - 7, py - 7, px + 7, py + 7], fill=ACCENT)
        # dimension line + simulation heat-map hint
        draw.line([(x0 + 80, y1 - 70), (x1 - 80, y1 - 70)], fill=INK, width=3)
        for xx in (x0 + 80, x1 - 80):
            draw.line([(xx, y1 - 86), (xx, y1 - 54)], fill=INK, width=3)
        draw.rectangle([(x0 + x1) / 2 - 80, y1 - 90, (x0 + x1) / 2 + 80, y1 - 50], fill=CARD)
        draw.text(((x0 + x1) / 2, y1 - 70), "120.0 mm", font=font(FONT_BOLD, 30), fill=INK, anchor="mm")
        bar_y = y0 + 50
        for k in range(10):
            color = lerp_rgb((60, 90, 220), (230, 60, 40), k / 9)
            draw.rectangle([x0 + 50 + k * 22, bar_y, x0 + 70 + k * 22, bar_y + 20], fill=color)
        draw.text((x0 + 50, bar_y + 40), "FEA", font=font(FONT_BOLD, 24), fill=MUTED, anchor="lm")

    def illus_evt(self, draw, scene, t, global_t, appear):
        x0, y0, x1, y1 = CARD_BOX
        board = (x0 + 140, y0 + 190, x1 - 140, y1 - 150)
        draw.rounded_rectangle(board, radius=18, fill=PCB, outline=INK, width=5)
        for hx in (board[0] + 24, board[2] - 24):
            for hy in (board[1] + 24, board[3] - 24):
                draw.ellipse([hx - 10, hy - 10, hx + 10, hy + 10], fill=(220, 200, 120), outline=INK, width=2)
        chips = [(board[0] + 90, board[1] + 70, 130, 130), (board[0] + 290, board[1] + 90, 90, 60),
                 (board[0] + 290, board[1] + 190, 90, 60), (board[0] + 450, board[1] + 80, 70, 160)]
        for cx, cy, w, h in chips:
            draw.rectangle([cx, cy, cx + w, cy + h], fill=(30, 32, 38), outline=INK, width=3)
            for k in range(int(w / 16)):
                draw.line([(cx + 8 + k * 16, cy - 8), (cx + 8 + k * 16, cy)], fill=(200, 200, 200), width=3)
        wires = [((board[0] + 60, board[3] - 30), (x0 + 40, y0 + 80), ACCENT),
                 ((board[2] - 70, board[1] + 40), (x1 - 40, y0 + 120), BLUE),
                 ((board[2] - 40, board[3] - 50), (x1 - 60, y1 - 40), (240, 180, 30))]
        for (sx, sy), (ex, ey), color in wires:
            pts = []
            for k in range(21):
                s = k / 20
                mx, my = (sx + ex) / 2, min(sy, ey) - 60
                px = (1 - s) ** 2 * sx + 2 * (1 - s) * s * mx + s ** 2 * ex
                py = (1 - s) ** 2 * sy + 2 * (1 - s) * s * my + s ** 2 * ey
                pts.append((px, py))
            draw.line(pts, fill=color, width=8, joint="curve")
        led_on = int(global_t * 3) % 2 == 0
        lx, ly = board[0] + 60, board[1] + 250
        if led_on:
            draw.ellipse([lx - 30, ly - 30, lx + 30, ly + 30], fill=(80, 255, 120, 90))
        draw.ellipse([lx - 12, ly - 12, lx + 12, ly + 12], fill=(80, 230, 110) if led_on else (30, 80, 40))
        answered = t > scene["dur"] * 0.72
        bubble = (x1 - 330, y0 + 30, x1 - 40, y0 + 120)
        draw.rounded_rectangle(bubble, radius=20, fill=GREEN if answered else INK)
        draw.text((bubble[0] + 30, (bubble[1] + bubble[3]) / 2), self.tx["labels"]["works"],
                  font=font(FONT_BLACK, 34), fill=CARD, anchor="lm")
        if answered:
            check_mark(draw, (bubble[2] - 40, (bubble[1] + bubble[3]) / 2), 36, CARD, width=7)

    def illus_dvt(self, draw, scene, t, global_t, appear):
        x0, y0, x1, y1 = CARD_BOX
        phase_len = max(1.5, (scene["dur"] - 0.3) / 3)
        phase = min(2, int(t / phase_len))
        local = (t - phase * phase_len) / phase_len
        labels = [self.tx["labels"]["drop"], self.tx["labels"]["heat"], self.tx["labels"]["water"]]
        for k, label in enumerate(labels):
            tab_x = x0 + 40 + k * 300
            active = k == phase
            draw.rounded_rectangle([tab_x, y0 + 30, tab_x + 280, y0 + 90], radius=30,
                                   fill=ACCENT if active else (238, 234, 226))
            draw.text((tab_x + 140, y0 + 60), label, font=font(FONT_BLACK, 26),
                      fill=CARD if active else MUTED, anchor="mm")
        cx = (x0 + x1) / 2
        floor = y1 - 90
        if phase == 0:
            draw.rectangle([x0 + 60, floor, x1 - 60, floor + 14], fill=INK)
            fall = min(1.0, local / 0.45)
            y = lerp(y0 + 170, floor - 90, fall ** 2)
            if local > 0.45:
                bounce = (local - 0.45) / 0.55
                y = floor - 90 - 60 * abs(math.sin(bounce * math.pi * 2)) * math.exp(-bounce * 3)
                for k in range(6):
                    a = math.pi + k * math.pi / 5
                    r1, r2 = 120, 120 + 50 * math.exp(-bounce * 4)
                    draw.line([(cx + r1 * math.cos(a), floor + r1 * 0.3 * math.sin(a)),
                               (cx + r2 * math.cos(a), floor + r2 * 0.3 * math.sin(a))], fill=ACCENT, width=6)
            camera_icon(draw, (cx - 20, y), scale=1.3)
        elif phase == 1:
            swing = 0.5 + 0.5 * math.sin(local * math.pi * 2.5 - math.pi / 2)
            temp = lerp(-30, 60, swing)
            color = lerp_rgb((60, 120, 230), (230, 70, 40), swing)
            thermometer(draw, x0 + 180, y0 + 150, y1 - 120, swing, color)
            draw.text((x0 + 250, y0 + 170), "+60 °C", font=font(FONT_BOLD, 30), fill=MUTED, anchor="lm")
            draw.text((x0 + 250, y1 - 150), "−30 °C", font=font(FONT_BOLD, 30), fill=MUTED, anchor="lm")
            tint = lerp_rgb((200, 220, 255), (255, 200, 180), swing)
            camera_icon(draw, (cx + 150, (y0 + y1) / 2 + 20), scale=1.4, tint=tint)
            draw.text((cx + 150, y1 - 110), f"{temp:+.0f} °C".replace("-", "−"), font=font(FONT_SERIF_BOLD, 64), fill=color,
                      anchor="mm")
        else:
            camera_icon(draw, (cx + 90, (y0 + y1) / 2 + 30), scale=1.4)
            nozzle = (x0 + 80, y0 + 170)
            draw.rounded_rectangle([nozzle[0] - 30, nozzle[1] - 20, nozzle[0] + 60, nozzle[1] + 20], radius=10,
                                   fill=INK)
            generator = np.random.default_rng(int(global_t * 30))
            for k in range(40):
                s = ((global_t * 1.4 + k / 40) % 1.0)
                spread = (k % 7 - 3) * 0.08
                px = nozzle[0] + 70 + s * 520
                py = nozzle[1] + s * (200 + spread * 900) + 10 * generator.standard_normal()
                draw.ellipse([px - 6, py - 9, px + 6, py + 9], fill=(70, 140, 230, 200))

    def illus_pvt(self, draw, scene, t, global_t, appear):
        x0, y0, x1, y1 = CARD_BOX
        belt_y = y1 - 220
        draw.rounded_rectangle([x0 + 30, belt_y, x1 - 30, belt_y + 50], radius=25, fill=(60, 62, 70))
        for k in range(12):
            rx = x0 + 60 + k * 78
            draw.ellipse([rx - 14, belt_y + 11, rx + 14, belt_y + 39], fill=(150, 152, 160))
            a = global_t * 6
            draw.line([(rx, belt_y + 25), (rx + 12 * math.cos(a), belt_y + 25 + 12 * math.sin(a))], fill=INK,
                      width=3)
        gate_x = (x0 + x1) / 2
        draw.rectangle([gate_x - 70, belt_y - 260, gate_x - 56, belt_y], fill=INK)
        draw.rectangle([gate_x + 56, belt_y - 260, gate_x + 70, belt_y], fill=INK)
        draw.rectangle([gate_x - 80, belt_y - 280, gate_x + 80, belt_y - 248], fill=INK)
        speed = 170
        spacing = 230
        offset = (global_t * speed) % spacing
        for k in range(-1, 6):
            ux = x0 - 60 + k * spacing + offset
            if ux < x0 + 40 or ux > x1 - 40:
                continue
            camera_icon(draw, (ux, belt_y - 70), scale=0.7)
            if ux > gate_x + 20:
                check_mark(draw, (ux, belt_y - 160), 34, GREEN, width=7)
        scan = 0.5 + 0.5 * math.sin(global_t * 8)
        draw.rectangle([gate_x - 54, belt_y - 246, gate_x + 54, belt_y - 240], fill=(60, 220, 120, int(120 + 120 * scan)))
        count = int(t * 37 + 1)
        draw.text((x0 + 50, y0 + 60), self.tx["labels"]["unit"], font=font(FONT_BOLD, 28), fill=MUTED, anchor="lm")
        draw.text((x0 + 50, y0 + 120), f"#{count:04d}", font=font(FONT_SERIF_BOLD, 76), fill=INK, anchor="lm")
        draw.rounded_rectangle([x1 - 240, y0 + 50, x1 - 50, y0 + 110], radius=30, fill=GREEN)
        draw.text((x1 - 145, y0 + 80), self.tx["labels"]["pass"], font=font(FONT_BLACK, 30), fill=CARD,
                  anchor="mm")

    def illus_mp(self, draw, scene, t, global_t, appear):
        x0, y0, x1, y1 = CARD_BOX
        ground = y1 - 90
        draw.line([(x0 + 30, ground), (x1 - 30, ground)], fill=INK, width=5)
        boxes = int(min(15, t * 4))
        for k in range(boxes):
            col, row = k % 5, k // 5
            bx = x0 + 70 + col * 92
            by = ground - 80 - row * 80
            draw.rectangle([bx, by, bx + 84, by + 76], fill=(214, 176, 120), outline=INK, width=4)
            draw.line([(bx + 42, by), (bx + 42, by + 30)], fill=INK, width=4)
        drive = ease((t - 1.2) / max(1.0, scene["dur"] - 1.5))
        tx = lerp(x1 - 380, x1 + 40, drive)
        if tx < x1 - 20:
            draw.rectangle([tx, ground - 170, tx + 220, ground - 30], fill=ACCENT, outline=INK, width=5)
            draw.rectangle([tx + 220, ground - 120, tx + 300, ground - 30], fill=INK)
            draw.rectangle([tx + 236, ground - 108, tx + 286, ground - 70], fill=(170, 210, 255))
            for wx in (tx + 50, tx + 250):
                draw.ellipse([wx - 28, ground - 58, wx + 28, ground - 2], fill=INK)
                draw.ellipse([wx - 10, ground - 40, wx + 10, ground - 20], fill=(200, 200, 200))
        cal = (x1 - 260, y0 + 40, x1 - 50, y0 + 250)
        draw.rounded_rectangle(cal, radius=16, fill=CARD, outline=INK, width=5)
        draw.rectangle([cal[0], cal[1], cal[2], cal[1] + 50], fill=ACCENT)
        draw.text(((cal[0] + cal[2]) / 2, cal[1] + 125), "12+", font=font(FONT_SERIF_BOLD, 76), fill=INK,
                  anchor="mm")
        draw.text(((cal[0] + cal[2]) / 2, cal[1] + 185), self.tx["labels"]["months"], font=font(FONT_BLACK, 24),
                  fill=MUTED, anchor="mm")

    def illus_cta(self, draw, scene, t, global_t, appear):
        x0, y0, x1, y1 = CARD_BOX
        names = [self.tx["steps"][0]] + [s["sub"] if s["key"] in ("evt", "dvt", "pvt") else s["title"]
                                         for s in self.scenes if s["key"] in ("evt", "dvt", "pvt", "mp")]
        short = self.tx["steps"]
        for k in range(5):
            row_y = y0 + 80 + k * 110
            shown = ease((t - k * 0.25) / 0.3)
            if shown <= 0:
                continue
            a = int(255 * shown)
            highlight = k == 2
            if highlight:
                draw.rounded_rectangle([x0 + 40, row_y - 46, x1 - 40, row_y + 46], radius=20, fill=MARKER + (a,))
            draw.ellipse([x0 + 70, row_y - 30, x0 + 130, row_y + 30], fill=INK + (a,))
            check_mark(draw, (x0 + 100, row_y), 28, PAPER + (a,), width=6)
            draw.text((x0 + 160, row_y), short[k], font=font(FONT_BLACK, 40), fill=INK + (a,), anchor="lm")
            if k in (1, 2, 3):
                draw.text((x0 + 300, row_y), names[k], font=font(FONT_SERIF_ITALIC, 32), fill=MUTED + (a,),
                          anchor="lm")
        if t > 1.5:
            note = "← I work here" if self.lang == "en" else "← saya di sini"
            draw.text((x1 - 60, y0 + 80 + 2 * 110), note, font=font(FONT_BOLD, 30), fill=ACCENT, anchor="rm")

    # ------------------------------------------------------------------
    def build_audio(self, total):
        chords = [(60, 64, 67), (55, 59, 62), (57, 60, 64), (53, 57, 60)]
        music = make_pad_music(total + 1, chords, chord_len=4.0, bpm=104, pluck_gain=0.028)
        sfx = np.zeros(int((total + 1) * SAMPLE_RATE), dtype=np.float32)
        for scene in self.scenes[1:]:
            place(sfx, whoosh(0.5, seed=scene["index"] + 3), scene["start"] - 0.2, 0.08)
            place(sfx, blip(1320, 0.1), scene["start"] + 0.3, 0.05)
        dvt = next(s for s in self.scenes if s["key"] == "dvt")
        phase_len = max(1.5, (dvt["dur"] - 0.3) / 3)
        n = int(0.35 * SAMPLE_RATE)
        tt = np.arange(n) / SAMPLE_RATE
        thud = np.sin(2 * np.pi * (60 + 60 * np.exp(-tt * 25)) * tt) * np.exp(-tt * 14)
        thud += smooth_noise(n, 20, 2) * np.exp(-tt * 30) * 2
        place(sfx, thud, dvt["start"] + phase_len * 0.45, 0.5)
        return write_mix(self.build_dir / "mix.wav", self.scenes, total, music, sfx, music_gain=0.32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["en", "id"], default="en")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()

    video = Video(args.lang)
    total = build_timeline(video.scenes, video.build_dir, args.lang)
    print(f"[{args.lang}] total {total:.1f} s", flush=True)
    for scene in video.scenes:
        print(f"  {scene['key']:<7} start {scene['start']:5.1f}  dur {scene['dur']:4.1f}", flush=True)

    if args.preview:
        contact_sheet(EPISODE_DIR / f"preview_{args.lang}.png", video.scenes, video.frame)
        for key, frac in (("design", 0.6), ("dvt", 0.2), ("dvt", 0.55), ("cta", 0.9)):
            scene = next(s for s in video.scenes if s["key"] == key)
            video.frame(scene["start"] + scene["dur"] * frac).save(
                EPISODE_DIR / f"preview_{args.lang}_{key}_{int(frac * 100)}.png")
        print("preview written", flush=True)
        return

    audio = video.build_audio(total)
    encode(video.output, audio, total, video.frame, cover_path=EPISODE_DIR / f"cover_{args.lang}.png",
           cover_time=video.scenes[3]["start"] + 2.0)


if __name__ == "__main__":
    main()
