"""Teardown Ep 1 — "What's inside an outdoor security camera" (exploded-view explainer).

Pseudo-3D exploded stack (rotating), callout cards and per-part mini animations.
Bilingual: --lang id (Bahasa Indonesia, voice Damayanti) or --lang en (voice Daniel).

Usage:
    ../.venv/bin/python make_video.py --lang id --preview
    ../.venv/bin/python make_video.py --lang id
"""

import argparse
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "common"))
from shortlib import (  # noqa: E402
    FONT_BLACK, FONT_BOLD, FONT_REG, HEIGHT, SAMPLE_RATE, WIDTH,
    blip, build_timeline, caption_chunks, click, contact_sheet, current_chunk, ease, encode, font, lerp,
    lerp_rgb, make_pad_music, place, scene_at, whoosh, write_mix,
)

EPISODE_DIR = Path(__file__).resolve().parent

AMBER = (255, 178, 36)
WHITE = (255, 255, 255)
GREY = (150, 156, 170)
BG_TOP = (16, 18, 23)
BG_BOTTOM = (28, 31, 38)
BG_MID = (22, 24, 30)
OUTLINE = (8, 9, 12)

COS_P, SIN_P = 0.92, 0.39          # view elevation (looking down on the stack)
LIGHT = (-0.55, 0.83)              # light direction in rotated (x, z)

# --------------------------------------------------------------------------
# Text (per language)
# --------------------------------------------------------------------------
TEXT = {
    "en": {
        "tag": "TEARDOWN",
        "title": "OUTDOOR SECURITY CAMERA",
        "parts": {
            "window": "Front window", "gasket": "Gasket", "led": "IR LED ring", "foam": "IR foam ring",
            "lens": "Lens", "filter": "IR-cut filter", "sensor": "Image sensor", "board": "Main board",
            "housing": "Aluminum housing", "cable": "PoE cable",
        },
        "scenes": [
            ("hook", "This is an outdoor security camera. Let's open it up, layer by layer.",
             "This is an outdoor security camera. Let's open it up, layer by layer."),
            ("ir", "Under the front glass sits a ring of infrared LEDs. Their 850 nanometer light is almost "
                   "invisible to you. But to the camera, the night turns bright.",
             "Under the front glass sits a ring of infrared LEDs. Their 850 nm light is almost invisible "
             "to you. But to the camera, the night turns bright."),
            ("foam", "Around the lens sits a small foam ring. Without it, infrared light bounces inside the "
                     "glass, and the night image turns foggy white.",
             "Around the lens sits a small foam ring. Without it, infrared light bounces inside the glass, "
             "and the night image turns foggy white."),
            ("filter", "Behind the lens, a tiny filter slides. By day, it blocks infrared, so colors look "
                       "right. At night, it moves away. Click! That's the sound some cameras make at dusk.",
             "Behind the lens, a tiny filter slides. By day it blocks infrared, so colors look right. "
             "At night it moves away. CLICK! That's the sound some cameras make at dusk."),
            ("soc", "The sensor makes about 166 megabytes of raw video every second. The main chip squeezes "
                    "it with H.265, roughly 300 times smaller.",
             "The sensor makes about 166 MB of raw video every second. The main chip squeezes it with "
             "H.265, roughly 300× smaller."),
            ("housing", "All that work makes heat. So the aluminum housing doubles as a heat sink. A rubber "
                        "gasket and a tiny vent keep the rain out.",
             "All that work makes heat. So the aluminum housing doubles as a heat sink. A rubber gasket "
             "and a tiny vent keep the rain out."),
            ("poe", "And one network cable carries both data and power, up to 100 meters. That's Power over "
                    "Ethernet.",
             "And one network cable carries both data and power, up to 100 meters. That's Power over "
             "Ethernet."),
            ("payoff", "Ten parts. One job: seeing through darkness and rain. What should we take apart next?",
             "Ten parts. One job: seeing through darkness and rain. What should we take apart next?"),
        ],
        "click_word": "CLICK!",
        "cards": {
            "ir": ("INFRARED LEDs", "850 nm", "almost invisible to eyes"),
            "foam": ("IR FOAM RING", "NO GLARE", "blocks light leaking into lens"),
            "filter": ("IR-CUT FILTER", "DAY / NIGHT", "moves on a tiny magnet"),
            "soc": ("SENSOR + MAIN CHIP", "≈330×", "166 MB/s  →  0.5 MB/s"),
            "housing": ("ALUMINUM HOUSING", "= HEAT SINK", "+ gasket + vent"),
            "poe": ("PoE CABLE", "≤ 100 m", "data + power, 1 cable"),
        },
        "inset": {
            "night_off": "IR OFF", "night_on": "IR ON", "without": "WITHOUT FOAM", "with": "WITH FOAM",
            "day": "DAY: COLOR", "night": "NIGHT: B/W", "footnote": "4 MP · 30 fps · H.265 @ 4 Mbps",
            "heat": "HEAT", "poe_note": "802.3af: up to ≈13 W",
        },
        "payoff": ("10 PARTS", "1 JOB"),
        "cta": "What should we open next?",
    },
    "id": {
        "tag": "BEDAH PRODUK",
        "title": "KAMERA CCTV OUTDOOR",
        "parts": {
            "window": "Kaca depan", "gasket": "Gasket karet", "led": "Cincin LED IR", "foam": "Busa isolasi IR",
            "lens": "Lensa", "filter": "Filter IR-cut", "sensor": "Sensor gambar", "board": "Board utama",
            "housing": "Rumah aluminium", "cable": "Kabel PoE",
        },
        "scenes": [
            ("hook", "Ini kamera CCTV outdoor. Yuk, kita bedah, lapis demi lapis.",
             "Ini kamera CCTV outdoor. Yuk, kita bedah lapis demi lapis."),
            ("ir", "Di balik kaca depan, ada cincin lampu L E D inframerah. Cahayanya delapan ratus lima puluh "
                   "nanometer, hampir tak terlihat mata. Tapi bagi kamera, malam jadi terang.",
             "Di balik kaca depan ada cincin LED inframerah. Cahayanya 850 nm, hampir tak terlihat mata. "
             "Tapi bagi kamera, malam jadi terang."),
            ("foam", "Di sekeliling lensa, ada cincin busa kecil. Tanpa busa ini, cahaya inframerah memantul "
                     "di dalam kaca, dan gambar malam jadi putih berkabut.",
             "Di sekeliling lensa ada cincin busa kecil. Tanpa busa ini, cahaya inframerah memantul di "
             "dalam kaca, dan gambar malam jadi putih berkabut."),
            ("filter", "Di belakang lensa, ada filter kecil yang bisa bergeser. Siang hari, filter ini menahan "
                       "inframerah, supaya warnanya akurat. Malam hari, filternya bergeser. Klik! Itu suara "
                       "yang kadang terdengar dari CCTV saat senja.",
             "Di belakang lensa ada filter kecil yang bisa bergeser. Siang hari, filter ini menahan "
             "inframerah supaya warnanya akurat. Malam hari, filternya bergeser. KLIK! Itu suara yang "
             "kadang terdengar dari CCTV saat senja."),
            ("soc", "Sensornya menghasilkan sekitar seratus enam puluh enam megabait video mentah setiap "
                    "detik. Chip utama memadatkannya dengan H dua enam lima, kira-kira tiga ratus kali "
                    "lebih kecil.",
             "Sensornya menghasilkan sekitar 166 MB video mentah setiap detik. Chip utama memadatkannya "
             "dengan H.265, kira-kira 300× lebih kecil."),
            ("housing", "Semua proses itu menghasilkan panas. Jadi, rumah aluminiumnya sekaligus jadi "
                        "pendingin. Karet gasket dan ventilasi kecil menjaga air hujan tetap di luar.",
             "Semua proses itu menghasilkan panas. Jadi rumah aluminiumnya sekaligus jadi pendingin. Karet "
             "gasket dan ventilasi kecil menjaga air hujan tetap di luar."),
            ("poe", "Dan satu kabel LAN membawa data dan listrik sekaligus, sampai seratus meter. Namanya, "
                    "Power over Ethernet.",
             "Dan satu kabel LAN membawa data dan listrik sekaligus, sampai 100 meter. Namanya Power over "
             "Ethernet."),
            ("payoff", "Sepuluh komponen. Satu tugas: melihat dalam gelap dan hujan. Produk apa yang harus "
                       "kita bedah berikutnya?",
             "Sepuluh komponen. Satu tugas: melihat dalam gelap dan hujan. Produk apa yang harus kita "
             "bedah berikutnya?"),
        ],
        "click_word": "KLIK!",
        "cards": {
            "ir": ("LED INFRAMERAH", "850 nm", "hampir tak terlihat mata"),
            "foam": ("BUSA ISOLASI IR", "ANTI-SILAU", "cegah cahaya bocor ke lensa"),
            "filter": ("FILTER IR-CUT", "SIANG / MALAM", "digeser magnet kecil"),
            "soc": ("SENSOR + CHIP UTAMA", "≈330×", "166 MB/s  →  0,5 MB/s"),
            "housing": ("RUMAH ALUMINIUM", "= PENDINGIN", "+ gasket + ventilasi"),
            "poe": ("KABEL PoE", "≤ 100 m", "data + listrik, 1 kabel"),
        },
        "inset": {
            "night_off": "IR MATI", "night_on": "IR NYALA", "without": "TANPA BUSA", "with": "DENGAN BUSA",
            "day": "SIANG: WARNA", "night": "MALAM: H/P", "footnote": "4 MP · 30 fps · H.265 @ 4 Mbps",
            "heat": "PANAS", "poe_note": "802.3af: hingga ≈13 W",
        },
        "payoff": ("10 KOMPONEN", "1 TUGAS"),
        "cta": "Bedah apa berikutnya?",
    },
}

FOCUS = {
    "hook": [], "ir": ["led", "window"], "foam": ["foam"], "filter": ["filter", "lens"],
    "soc": ["sensor", "board"], "housing": ["housing", "gasket"], "poe": ["cable"], "payoff": [],
}
CARD_ANCHOR = {"ir": "led", "foam": "foam", "filter": "filter", "soc": "board", "housing": "housing",
               "poe": "cable"}
PART_NUMBER = {"window": 1, "gasket": 2, "led": 3, "foam": 4, "lens": 5, "filter": 6, "sensor": 7,
               "board": 8, "housing": 9, "cable": 10}

# Layer stack: (key, assembled y_bottom, exploded y_bottom, radius for label anchor)
LAYERS = [
    ("board", 26, 250, 165),
    ("sensor", 56, 345, 90),
    ("filter", 70, 410, 70),
    ("lens", 76, 455, 48),
    ("foam", 150, 595, 64),
    ("led", 178, 690, 142),
    ("gasket", 188, 760, 152),
    ("window", 190, 830, 152),
]
LAYER_Y = {key: (a, e) for key, a, e, _ in LAYERS}
LAYER_R = {key: r for key, _, _, r in LAYERS}
HOUSING_R, HOUSING_IN, HOUSING_H, FLOOR = 150, 137, 190, 14


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------
class Cam:
    def __init__(self, cx, y0, scale, theta):
        self.cx = cx
        self.y0 = y0
        self.s = scale
        self.cos = math.cos(theta)
        self.sin = math.sin(theta)

    def rot(self, x, z):
        return x * self.cos + z * self.sin, -x * self.sin + z * self.cos

    def p(self, x, y, z):
        xr, zr = self.rot(x, z)
        return (self.cx + self.s * xr, self.y0 - self.s * COS_P * y + self.s * SIN_P * zr)


def circle(r, n=56, cx=0.0, cz=0.0):
    return [(cx + r * math.cos(2 * math.pi * k / n), cz + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def rect(w, d, cx=0.0, cz=0.0, angle=0.0):
    c, s = math.cos(angle), math.sin(angle)
    pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    return [(cx + x * c - z * s, cz + x * s + z * c) for x, z in pts]


def shade(color, k):
    return tuple(int(min(255, max(0, c * k))) for c in color[:3]) + tuple(color[3:])


def dim(color, amount):
    if amount <= 0:
        return color
    mixed = lerp_rgb(color[:3], BG_MID, amount)
    return mixed + tuple(color[3:])


def side_faces(cam, poly, y0, h, inward=False):
    """Yield (quad, brightness) for side faces facing the viewer."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sign = 1 if area > 0 else -1
    if inward:
        sign = -sign
    for i in range(n):
        x1, z1 = poly[i]
        x2, z2 = poly[(i + 1) % n]
        nx, nz = (z2 - z1) * sign, -(x2 - x1) * sign
        length = math.hypot(nx, nz) or 1
        nxr, nzr = cam.rot(nx / length, nz / length)
        if nzr <= 0:
            continue
        light = max(0.0, nxr * LIGHT[0] + nzr * LIGHT[1])
        quad = [cam.p(x1, y0 + h, z1), cam.p(x2, y0 + h, z2), cam.p(x2, y0, z2), cam.p(x1, y0, z1)]
        yield quad, 0.5 + 0.55 * light


def prism(draw, cam, poly, y0, h, top, side=None, outline=OUTLINE, dim_amount=0.0, top_outline=True):
    side = side or shade(top, 0.75)
    for quad, k in side_faces(cam, poly, y0, h):
        color = dim(shade(side, k), dim_amount)
        draw.polygon(quad, fill=color)
    top_pts = [cam.p(x, y0 + h, z) for x, z in poly]
    draw.polygon(top_pts, fill=dim(top, dim_amount),
                 outline=dim(outline, dim_amount) if top_outline else None)
    return top_pts


def ring(draw, cam, r_out, r_in, y0, h, top, side=None, inner=None, dim_amount=0.0, n=56):
    side = side or shade(top, 0.75)
    inner = inner or shade(top, 0.45)
    outer_poly = circle(r_out, n)
    inner_poly = circle(r_in, n)
    for quad, k in side_faces(cam, outer_poly, y0, h):
        draw.polygon(quad, fill=dim(shade(side, k), dim_amount))
    for quad, k in side_faces(cam, inner_poly, y0, h, inward=True):
        draw.polygon(quad, fill=dim(shade(inner, k), dim_amount))
    outer_top = [cam.p(x, y0 + h, z) for x, z in outer_poly]
    inner_top = [cam.p(x, y0 + h, z) for x, z in inner_poly]
    keyhole = outer_top + [outer_top[0]] + [inner_top[0]] + inner_top[::-1] + [inner_top[0]]
    draw.polygon(keyhole, fill=dim(top, dim_amount))
    draw.line(outer_top + [outer_top[0]], fill=dim(OUTLINE, dim_amount), width=2)
    draw.line(inner_top + [inner_top[0]], fill=dim(OUTLINE, dim_amount), width=2)


# --------------------------------------------------------------------------
# Parts
# --------------------------------------------------------------------------
def draw_cable(draw, cam, y_base, dim_amount, pulse_t=None):
    points = []
    for k in range(25):
        s = k / 24
        points.append(cam.p(-70 * s * s, y_base - 40 - 140 * s, 40 * s + 60 * s * s))
    width = max(8, int(30 * cam.s))
    draw.line(points, fill=dim((14, 15, 18), dim_amount), width=width + 6, joint="curve")
    draw.line(points, fill=dim((44, 46, 54), dim_amount), width=width, joint="curve")
    draw.line([(x - width * 0.18, y) for x, y in points], fill=dim((80, 84, 96), dim_amount),
              width=max(2, width // 6), joint="curve")
    gland = circle(26, 24)
    prism(draw, cam, gland, y_base - 40, 40, (40, 42, 48), dim_amount=dim_amount)
    nut = [(26 * 1.25 * math.cos(math.pi / 3 * k), 26 * 1.25 * math.sin(math.pi / 3 * k)) for k in range(6)]
    prism(draw, cam, nut, y_base - 22, 14, (70, 74, 84), dim_amount=dim_amount)
    if pulse_t is not None:
        for k in range(8):
            for kind, color in enumerate(((255, 150, 40), (60, 220, 255))):
                s = 1 - ((pulse_t * 0.55 + k / 8 + kind * 0.06) % 1.0)
                index = s * 24
                i0 = int(min(23, index))
                frac = index - i0
                x = lerp(points[i0][0], points[i0 + 1][0], frac)
                y = lerp(points[i0][1], points[i0 + 1][1], frac)
                r = 7 + 2 * kind
                draw.ellipse([x - r, y - r, x + r, y + r], fill=color + (230,))
    return points


def draw_housing_back(draw, cam, dim_amount, vent_glow=0.0):
    alu = (150, 156, 168)
    # interior: inner back wall + floor
    inner_poly = circle(HOUSING_IN)
    for quad, k in side_faces(cam, inner_poly, FLOOR, HOUSING_H - FLOOR, inward=True):
        draw.polygon(quad, fill=dim(shade((70, 74, 84), k), dim_amount))
    draw.polygon([cam.p(x, FLOOR, z) for x, z in inner_poly], fill=dim((44, 47, 55), dim_amount))
    # rim (full ring, drawn under parts)
    outer_top = [cam.p(x, HOUSING_H, z) for x, z in circle(HOUSING_R)]
    inner_top = [cam.p(x, HOUSING_H, z) for x, z in inner_poly]
    keyhole = outer_top + [outer_top[0], inner_top[0]] + inner_top[::-1] + [inner_top[0]]
    draw.polygon(keyhole, fill=dim(shade(alu, 1.15), dim_amount))


def draw_housing_front(draw, cam, dim_amount, vent_glow=0.0, heat=0.0, t=0.0):
    alu = (150, 156, 168)
    outer_poly = circle(HOUSING_R)
    for quad, k in side_faces(cam, outer_poly, 0, HOUSING_H):
        draw.polygon(quad, fill=dim(shade(alu, k), dim_amount))
    # grooves / fins
    for y in (30, 52, 74):
        arc = [cam.p(x, y, z) for x, z in circle(HOUSING_R + 1, 72) if cam.rot(x, z)[1] > 0]
        arc.sort(key=lambda p: p[0])
        if len(arc) > 1:
            draw.line(arc, fill=dim((96, 100, 112), dim_amount), width=3)
    # front half of rim
    n = 56
    front_outer, front_inner = [], []
    for x, z in circle(HOUSING_R, n):
        if cam.rot(x, z)[1] >= -1:
            front_outer.append(cam.p(x, HOUSING_H, z))
    for x, z in circle(HOUSING_IN, n):
        if cam.rot(x, z)[1] >= -1:
            front_inner.append(cam.p(x, HOUSING_H, z))
    front_outer.sort(key=lambda p: p[0])
    front_inner.sort(key=lambda p: p[0])
    if len(front_outer) > 2 and len(front_inner) > 2:
        draw.polygon(front_outer + front_inner[::-1], fill=dim(shade(alu, 1.15), dim_amount))
        draw.line(front_outer, fill=dim(OUTLINE, dim_amount), width=2)
    outline_pts = [cam.p(x, 0, z) for x, z in circle(HOUSING_R, 72) if cam.rot(x, z)[1] > 0]
    outline_pts.sort(key=lambda p: p[0])
    draw.line(outline_pts, fill=dim(OUTLINE, dim_amount), width=3)
    # vent (fixed on housing, visible when facing viewer)
    angle = 1.9
    vx, vz = HOUSING_R * math.cos(angle), HOUSING_R * math.sin(angle)
    if cam.rot(vx, vz)[1] > 30:
        cx, cy = cam.p(vx, 40, vz)
        r = 11 * cam.s
        if vent_glow > 0:
            g = r * (2.2 + 0.4 * math.sin(t * 6))
            draw.ellipse([cx - g, cy - g, cx + g, cy + g], fill=(80, 230, 255, int(90 * vent_glow)))
        draw.ellipse([cx - r, cy - r * 0.8, cx + r, cy + r * 0.8], fill=dim((235, 238, 242), dim_amount),
                     outline=dim(OUTLINE, dim_amount), width=2)
    if heat > 0:
        for k in range(5):
            phase = (t * 0.8 + k / 5) % 1.0
            x0, y0 = cam.p(-100 + 50 * k, HOUSING_H * 0.2, HOUSING_R)
            pts = [(x0 + 10 * math.sin(phase * 8 + j * 0.9), y0 - 40 - phase * 160 - j * 12) for j in range(6)]
            draw.line(pts, fill=(255, 120, 40, int(200 * heat * (1 - phase))), width=6, joint="curve")


def draw_board(draw, cam, y0, dim_amount):
    pcb = (34, 128, 72)
    prism(draw, cam, rect(200, 200, angle=math.pi / 4), y0, 10, pcb, dim_amount=dim_amount)
    top = y0 + 10
    chips = [
        (rect(56, 56), 12, (54, 58, 66)),          # SoC with heat spreader
        (rect(40, 22, 0, -62), 6, (24, 26, 30)),    # RAM
        (rect(22, 30, 64, 10), 6, (24, 26, 30)),    # flash
        (rect(34, 30, -62, 22), 16, (210, 200, 180)),  # Ethernet magnetics
    ]
    for k in range(5):
        chips.append((circle(6, 12, 40 + 14 * k, 62), 12, (60, 60, 70)))
    chips.sort(key=lambda c: cam.rot(*np.mean(c[0], axis=0))[1])
    for poly, h, color in chips:
        prism(draw, cam, poly, top, h, color, dim_amount=dim_amount)
    soc_top = [cam.p(x, top + 12, z) for x, z in rect(36, 36)]
    draw.polygon(soc_top, fill=dim((120, 126, 138), dim_amount))


def draw_sensor(draw, cam, y0, dim_amount):
    prism(draw, cam, rect(120, 120, angle=math.pi / 4), y0, 8, (34, 128, 72), dim_amount=dim_amount)
    prism(draw, cam, rect(56, 56, angle=math.pi / 4), y0 + 8, 6, (40, 36, 52), dim_amount=dim_amount)
    die = [cam.p(x, y0 + 14, z) for x, z in rect(34, 28, angle=math.pi / 4)]
    draw.polygon(die, fill=dim((150, 110, 190), dim_amount))
    hi = [cam.p(x, y0 + 14, z) for x, z in rect(16, 6, -4, -6, angle=math.pi / 4)]
    draw.polygon(hi, fill=dim((230, 210, 255), dim_amount))


def draw_filter(draw, cam, y0, dim_amount, slide):
    prism(draw, cam, rect(130, 76), y0, 6, (52, 54, 62), dim_amount=dim_amount)
    offset = lerp(-28, 28, slide)
    ir_cut_glass = rect(56, 60, offset, 0)
    clear_glass = rect(56, 60, offset - 56, 0)
    prism(draw, cam, clear_glass, y0 + 6, 3, (210, 225, 232), side=(150, 165, 175), dim_amount=dim_amount)
    prism(draw, cam, ir_cut_glass, y0 + 6, 3, (90, 170, 255), side=(50, 110, 190), dim_amount=dim_amount)


def draw_lens(draw, cam, y0, dim_amount, glow=0.0):
    prism(draw, cam, circle(46, 40), y0, 70, (36, 38, 44), dim_amount=dim_amount)
    prism(draw, cam, circle(42, 40), y0 + 70, 22, (78, 82, 92), dim_amount=dim_amount)
    prism(draw, cam, circle(36, 40), y0 + 92, 14, (30, 32, 38), dim_amount=dim_amount)
    glass = [cam.p(x, y0 + 106, z) for x, z in circle(28, 40)]
    draw.polygon(glass, fill=dim((40, 70, 110), dim_amount))
    hi = [cam.p(x, y0 + 106, z) for x, z in circle(10, 20, -9, -9)]
    draw.polygon(hi, fill=dim((170, 210, 255), dim_amount))


def draw_led_board(draw, cam, y0, dim_amount, ir_on=0.0):
    ring(draw, cam, 142, 62, y0, 8, (34, 128, 72), dim_amount=dim_amount)
    leds = []
    for k in range(12):
        a = 2 * math.pi * k / 12
        x, z = 104 * math.cos(a), 104 * math.sin(a)
        leds.append((cam.rot(x, z)[1], x, z))
    leds.sort()
    for _, x, z in leds:
        prism(draw, cam, circle(11, 14, x, z), y0 + 8, 9, (60, 20, 24), side=(40, 14, 16), dim_amount=dim_amount)
        cx, cy = cam.p(x, y0 + 17, z)
        r = 8 * cam.s
        top_color = lerp_rgb((110, 30, 36), (255, 70, 70), ir_on)
        draw.ellipse([cx - r, cy - r * COS_P * 0.5, cx + r, cy + r * COS_P * 0.5], fill=dim(top_color, dim_amount))
        if ir_on > 0:
            g = r * 3.2
            draw.ellipse([cx - g, cy - g * 0.6, cx + g, cy + g * 0.6], fill=(255, 60, 60, int(70 * ir_on)))


def draw_window(draw, cam, y0, dim_amount):
    bezel = (24, 26, 30)
    ring(draw, cam, 152, 120, y0, 10, bezel, side=(40, 42, 48), dim_amount=dim_amount)
    glass = [cam.p(x, y0 + 10, z) for x, z in circle(120)]
    draw.polygon(glass, fill=(140, 200, 235, int(55 * (1 - dim_amount * 0.6))))
    streak = [cam.p(x, y0 + 10, z) for x, z in [(-90, -40), (-30, -100), (-10, -95), (-75, -30)]]
    draw.polygon(streak, fill=(255, 255, 255, int(60 * (1 - dim_amount * 0.6))))


def draw_gasket(draw, cam, y0, dim_amount):
    ring(draw, cam, 150, 139, y0, 6, (255, 122, 40), side=(200, 80, 20), dim_amount=dim_amount)


def draw_foam(draw, cam, y0, dim_amount):
    ring(draw, cam, 64, 50, y0, 42, (34, 34, 38), side=(26, 26, 30), inner=(16, 16, 18), dim_amount=dim_amount, n=40)


# --------------------------------------------------------------------------
# Scene state
# --------------------------------------------------------------------------
class Video:
    def __init__(self, lang):
        self.lang = lang
        self.tx = TEXT[lang]
        self.scenes = [{"key": k, "say": s, "caption": c} for k, s, c in self.tx["scenes"]]
        min_durs = {"hook": 5.0, "payoff": 6.5}
        for scene in self.scenes:
            scene["min_dur"] = min_durs.get(scene["key"], 4.0)
        self.build_dir = EPISODE_DIR / "build" / lang
        self.output = EPISODE_DIR / f"teardown_ep01_cctv_{lang}.mp4"
        self.background = self.make_background()

    def make_background(self):
        y = np.linspace(0, 1, HEIGHT)[:, None, None]
        top = np.array(BG_TOP, dtype=np.float32)
        bottom = np.array(BG_BOTTOM, dtype=np.float32)
        pixels = np.broadcast_to(top + (bottom - top) * y, (HEIGHT, WIDTH, 3)).copy()
        xx, yy = np.meshgrid(np.arange(WIDTH), np.arange(HEIGHT))
        spot = np.exp(-(((xx - 380) / 520.0) ** 2 + ((yy - 900) / 700.0) ** 2))
        pixels += spot[..., None] * np.array((18, 18, 22), dtype=np.float32)
        image = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
        draw = ImageDraw.Draw(image, "RGBA")
        for x in range(0, WIDTH, 60):
            draw.line([(x, 0), (x, HEIGHT)], fill=(255, 255, 255, 6))
        for y_px in range(0, HEIGHT, 60):
            draw.line([(0, y_px), (WIDTH, y_px)], fill=(255, 255, 255, 6))
        return image

    def word_time(self, key, word):
        scene = next(s for s in self.scenes if s["key"] == key)
        caption = scene["caption"]
        index = caption.find(word)
        frac = index / max(1, len(caption))
        return scene["vo_start"] + scene["vo_dur"] * frac

    # ---- explode state ------------------------------------------------
    def explode_amount(self, global_t):
        hook = self.scenes[0]
        payoff = self.scenes[-1]
        e = ease((global_t - (hook["start"] + 1.6)) / 2.4)
        if global_t >= payoff["start"]:
            e = 1 - ease((global_t - payoff["start"] - 0.3) / 2.2)
        return e

    def camera(self, e, global_t):
        theta = 0.5 + 0.22 * global_t
        return Cam(lerp(540, 350, e), lerp(1080, 1316, e), lerp(2.0, 1.15, e), theta)

    # ---- frame ----------------------------------------------------------
    def frame(self, global_t):
        scene = scene_at(self.scenes, global_t)
        key = scene["key"]
        t = global_t - scene["start"]
        e = self.explode_amount(global_t)
        cam = self.camera(e, global_t)
        canvas = self.background.copy()
        draw = ImageDraw.Draw(canvas, "RGBA")

        focus = FOCUS[key]
        focus_in = ease(t / 0.4)

        def dim_for(part):
            if not focus:
                return 0.0
            return 0.0 if part in focus else 0.62 * focus_in

        ir_on = 0.0
        if key == "ir":
            ir_on = ease((t - 1.5) / 0.6)
        slide = 0.0
        if key == "filter":
            slide = ease((global_t - self.word_time("filter", self.tx["click_word"])) / 0.12)
        elif self.scenes.index(scene) > self.scenes.index(next(s for s in self.scenes if s["key"] == "filter")):
            slide = 1.0 if key != "payoff" else 1.0

        layer_y = {}
        for index, (part, y_assembled, y_exploded, _) in enumerate(LAYERS):
            stagger = (len(LAYERS) - 1 - index) * 0.045
            local = min(1.0, max(0.0, (e - stagger) / (1 - 0.32)))
            layer_y[part] = lerp(y_assembled, y_exploded, ease(local) if 0 < e < 1 else e)
        self.layer_y = layer_y

        draw_cable(draw, cam, 0, dim_for("cable"), pulse_t=global_t if key == "poe" else None)
        draw_housing_back(draw, cam, dim_for("housing"))
        painters = {
            "board": lambda y, d: draw_board(draw, cam, y, d),
            "sensor": lambda y, d: draw_sensor(draw, cam, y, d),
            "filter": lambda y, d: draw_filter(draw, cam, y, d, slide),
            "lens": lambda y, d: draw_lens(draw, cam, y, d),
            "foam": lambda y, d: draw_foam(draw, cam, y, d),
            "led": lambda y, d: draw_led_board(draw, cam, y, d, ir_on),
            "gasket": lambda y, d: draw_gasket(draw, cam, y, d),
            "window": lambda y, d: draw_window(draw, cam, y, d),
        }
        inside = [p for p, _, _, _ in LAYERS if layer_y[p] < HOUSING_H - 2]
        outside = [p for p, _, _, _ in LAYERS if layer_y[p] >= HOUSING_H - 2]
        for part in inside:
            painters[part](layer_y[part], dim_for(part))
        draw_housing_front(draw, cam, dim_for("housing"),
                           vent_glow=1.0 if key == "housing" else 0.0,
                           heat=ease((t - 0.8) / 0.8) if key == "housing" else 0.0, t=global_t)
        for part in outside:
            painters[part](layer_y[part], dim_for(part))

        if key == "soc":
            self.draw_heat_dot(draw, cam, layer_y["board"], t)
        self.draw_header(draw)
        if key in CARD_ANCHOR:
            self.draw_card(canvas, draw, cam, scene, t, global_t)
        if key == "hook" and e > 0.95:
            self.draw_part_labels(draw, cam, ease((t - 4.0) / 0.5))
        if key == "payoff":
            self.draw_payoff(draw, t)
        if key == "filter":
            click_t = self.word_time("filter", self.tx["click_word"])
            pop = global_t - click_t
            if 0 <= pop < 1.2:
                size = int(90 + 40 * ease(pop / 0.15))
                x, y = cam.p(0, layer_y["filter"] + 30, 0)
                draw.text((x, y - 120), self.tx["click_word"], font=font(FONT_BLACK, size), fill=AMBER,
                          anchor="mm", stroke_width=8, stroke_fill=(0, 0, 0))
        self.draw_caption(draw, scene, global_t)

        if scene["index"] > 0 and t < 0.12 and key in ("payoff",):
            canvas = Image.blend(Image.new("RGB", canvas.size, (0, 0, 0)), canvas, t / 0.12)
        return canvas

    def draw_heat_dot(self, draw, cam, y_board, t):
        x, y = cam.p(0, y_board + 22, 0)
        r = 30 + 8 * math.sin(t * 6)
        draw.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=(255, 120, 40, 90))

    def draw_header(self, draw):
        tag = self.tx["tag"]
        tag_font = font(FONT_BLACK, 34)
        w = draw.textlength(tag, font=tag_font)
        draw.rounded_rectangle([60, 132, 60 + w + 44, 186], radius=27, fill=AMBER)
        draw.text((82, 159), tag, font=tag_font, fill=(20, 20, 24), anchor="lm")
        size = 64
        while draw.textlength(self.tx["title"], font=font(FONT_BLACK, size)) > 940:
            size -= 2
        draw.text((60, 206), self.tx["title"], font=font(FONT_BLACK, size), fill=WHITE, anchor="la")
        draw.line([(60, 292), (300, 292)], fill=AMBER, width=5)

    def draw_part_labels(self, draw, cam, alpha):
        if alpha <= 0:
            return
        a = int(255 * alpha)
        entries = [(p, self.layer_y[p]) for p, _, _, _ in LAYERS] + [("housing", 95), ("cable", -110)]
        for part, y in entries:
            if part == "cable":
                anchor = cam.p(-40, y, 50)
            else:
                anchor = cam.p(0, y + 6, 0)
                anchor = (cam.cx + cam.s * LAYER_R.get(part, HOUSING_R) * 0.95, anchor[1])
            label_x = 700
            draw.line([anchor, (label_x - 14, anchor[1])], fill=(255, 255, 255, int(a * 0.5)), width=2)
            draw.ellipse([anchor[0] - 5, anchor[1] - 5, anchor[0] + 5, anchor[1] + 5], fill=AMBER + (a,))
            label = f"{PART_NUMBER[part]:02d}  {self.tx['parts'][part]}"
            draw.text((label_x, anchor[1]), label, font=font(FONT_BOLD, 32), fill=(255, 255, 255, a), anchor="lm")

    def draw_card(self, canvas, draw, cam, scene, t, global_t):
        key = scene["key"]
        part = CARD_ANCHOR[key]
        alpha = ease(t / 0.35)
        if part == "cable":
            anchor = cam.p(-30, -100, 40)
        elif part == "housing":
            anchor = cam.p(0, 100, 0)
            anchor = (cam.cx + cam.s * HOUSING_R, anchor[1])
        else:
            y = self.layer_y[part]
            mid = cam.p(0, y + 5, 0)
            anchor = (cam.cx + cam.s * LAYER_R[part], mid[1])
        left, width, height = 630, 400, 520
        top = min(max(anchor[1] - 200, 330), 1500 - height - 80)
        a = int(255 * alpha)
        draw.line([anchor, (left, top + 70)], fill=AMBER + (a,), width=4)
        draw.ellipse([anchor[0] - 9, anchor[1] - 9, anchor[0] + 9, anchor[1] + 9], fill=AMBER + (a,))
        draw.rounded_rectangle([left, top, left + width, top + height], radius=26,
                               fill=(10, 11, 14, int(225 * alpha)), outline=AMBER + (int(160 * alpha),), width=3)
        name, stat, sub = self.tx["cards"][key]
        number = PART_NUMBER[part if key != "soc" else "sensor"]
        number_text = f"{number:02d}/10" if key != "soc" else "07–08/10"
        draw.text((left + 28, top + 34), number_text, font=font(FONT_BOLD, 26), fill=AMBER + (a,), anchor="lm")
        draw.text((left + 28, top + 76), name, font=font(FONT_BLACK, 32), fill=(255, 255, 255, a), anchor="lm")
        stat_size = 66
        while draw.textlength(stat, font=font(FONT_BLACK, stat_size)) > width - 56:
            stat_size -= 2
        stat_font = font(FONT_BLACK, stat_size)
        draw.text((left + 28, top + 150), stat, font=stat_font, fill=AMBER + (a,), anchor="lm")
        draw.text((left + 28, top + 212), sub, font=font(FONT_BOLD, 27), fill=(210, 214, 224, a), anchor="lm")
        box = (left + 24, top + 250, left + width - 24, top + height - 26)
        if alpha > 0.5:
            getattr(self, f"inset_{key}")(draw, box, t, global_t)

    # ---- insets ---------------------------------------------------------
    def inset_frame(self, draw, box, fill=(4, 4, 6)):
        draw.rounded_rectangle(box, radius=16, fill=fill, outline=(70, 74, 86), width=2)

    def scene_figure(self, draw, box, brightness, tint=(1, 1, 1)):
        x0, y0, x1, y1 = box
        cx = (x0 + x1) / 2
        ground = y1 - 30
        level = int(lerp(10, 210, brightness))

        def col(v):
            return tuple(int(min(255, v * c)) for c in tint)

        draw.rectangle([x0 + 20, ground, x1 - 20, ground + 6], fill=col(level * 0.6))
        draw.ellipse([cx - 22, ground - 150, cx + 22, ground - 106], fill=col(level))
        draw.rounded_rectangle([cx - 36, ground - 100, cx + 36, ground], radius=20, fill=col(level * 0.85))
        draw.rectangle([x0 + 40, ground - 90, x0 + 90, ground], fill=col(level * 0.5))
        draw.polygon([(x1 - 110, ground), (x1 - 70, ground - 110), (x1 - 30, ground)], fill=col(level * 0.55))

    def inset_ir(self, draw, box, t, global_t):
        on = ease((t - 1.5) / 0.6)
        self.inset_frame(draw, box)
        self.scene_figure(draw, box, on)
        label = self.tx["inset"]["night_on"] if on > 0.5 else self.tx["inset"]["night_off"]
        draw.text((box[0] + 16, box[1] + 14), label, font=font(FONT_BLACK, 26),
                  fill=(255, 90, 90) if on > 0.5 else GREY)
        draw.ellipse([box[2] - 36, box[1] + 16, box[2] - 16, box[1] + 36],
                     fill=(255, 40, 40) if int(global_t * 2) % 2 == 0 else (90, 20, 20))

    def inset_foam(self, draw, box, t, global_t):
        with_foam = int(t / 2.4) % 2 == 1
        x0, y0, x1, y1 = box
        self.inset_frame(draw, box)
        glass_y = y0 + 52
        draw.rectangle([x0 + 16, glass_y, x1 - 16, glass_y + 12], fill=(120, 190, 230))
        led_x, lens_x = x0 + 70, x1 - 90
        base_y = y1 - 30
        draw.rectangle([led_x - 18, base_y - 20, led_x + 18, base_y], fill=(200, 50, 50))
        draw.rectangle([lens_x - 30, base_y - 70, lens_x + 30, base_y], fill=(50, 54, 62))
        draw.ellipse([lens_x - 22, base_y - 84, lens_x + 22, base_y - 64], fill=(60, 110, 170))
        if with_foam:
            draw.rectangle([lens_x - 48, glass_y + 12, lens_x - 34, base_y], fill=(30, 30, 34), outline=(120, 120, 130))
        phase = (global_t * 1.2) % 1.0
        reflect_x = (led_x + lens_x) / 2 - 10
        path = [(led_x, base_y - 20), (reflect_x, glass_y + 12), (lens_x, base_y - 74)]
        if with_foam:
            hit_x = lens_x - 48
            frac = (hit_x - reflect_x) / (lens_x - reflect_x)
            path[2] = (hit_x, lerp(glass_y + 12, base_y - 74, frac))
        draw.line(path, fill=(255, 80, 80, 200), width=5)
        point = path[0] if phase < 0.5 else path[1]
        target = path[1] if phase < 0.5 else path[2]
        local = (phase % 0.5) * 2
        px, py = lerp(point[0], target[0], local), lerp(point[1], target[1], local)
        draw.ellipse([px - 8, py - 8, px + 8, py + 8], fill=(255, 140, 140))
        if not with_foam:
            draw.rectangle([lens_x - 30, glass_y + 20, x1 - 20, glass_y + 70], fill=(255, 255, 255, 60))
        label = self.tx["inset"]["with"] if with_foam else self.tx["inset"]["without"]
        draw.text((x0 + 16, y0 + 14), label, font=font(FONT_BLACK, 24),
                  fill=(90, 230, 140) if with_foam else (255, 90, 90))

    def inset_filter(self, draw, box, t, global_t):
        click_t = self.word_time("filter", self.tx["click_word"])
        night = global_t >= click_t
        x0, y0, x1, y1 = box
        self.inset_frame(draw, box, fill=(8, 10, 22) if night else (150, 200, 240))
        if night:
            self.scene_figure(draw, box, 0.8)
            draw.ellipse([x1 - 70, y0 + 46, x1 - 30, y0 + 86], fill=(230, 230, 240))
            draw.ellipse([x1 - 58, y0 + 40, x1 - 22, y0 + 80], fill=(8, 10, 22))
        else:
            self.scene_figure(draw, box, 0.75, tint=(1.0, 0.55, 0.3))
            draw.ellipse([x1 - 76, y0 + 40, x1 - 26, y0 + 90], fill=(255, 210, 60))
        label = self.tx["inset"]["night"] if night else self.tx["inset"]["day"]
        draw.text((x0 + 16, y0 + 14), label, font=font(FONT_BLACK, 26),
                  fill=(220, 224, 236) if night else (20, 30, 60))

    def inset_soc(self, draw, box, t, global_t):
        x0, y0, x1, y1 = box
        self.inset_frame(draw, box)
        squeeze = ease((t - 2.5) / 2.0)
        raw_h = 150
        bar_w = 70
        draw.rectangle([x0 + 40, y1 - 40 - raw_h, x0 + 40 + bar_w, y1 - 40], fill=(255, 120, 40))
        comp_h = max(3, raw_h * lerp(1.0, 1 / 332, squeeze))
        draw.rectangle([x1 - 40 - bar_w, y1 - 40 - comp_h, x1 - 40, y1 - 40], fill=(60, 220, 255))
        draw.text((x0 + 40 + bar_w / 2, y1 - 20), "RAW", font=font(FONT_BOLD, 22), fill=GREY, anchor="mm")
        draw.text((x1 - 40 - bar_w / 2, y1 - 20), "H.265", font=font(FONT_BOLD, 22), fill=GREY, anchor="mm")
        mx = (x0 + x1) / 2
        draw.text((mx, y1 - 110), "→", font=font(FONT_BLACK, 60), fill=WHITE, anchor="mm")
        draw.text((mx, y0 + 22), self.tx["inset"]["footnote"], font=font(FONT_REG, 19), fill=GREY, anchor="mm")

    def inset_housing(self, draw, box, t, global_t):
        x0, y0, x1, y1 = box
        self.inset_frame(draw, box)
        chip = (x0 + 110, y1 - 70, x1 - 110, y1 - 40)
        draw.rectangle([x0 + 30, y1 - 40, x1 - 30, y1 - 28], fill=(34, 128, 72))
        draw.rectangle(chip, fill=(80, 84, 96))
        draw.rectangle([chip[0], chip[1] - 14, chip[2], chip[1]], fill=(160, 140, 200))
        wall_y = y0 + 70
        draw.rectangle([x0 + 20, wall_y, x1 - 20, wall_y + 30], fill=(160, 166, 178))
        for k in range(9):
            fx = x0 + 34 + k * ((x1 - x0 - 68) / 8)
            draw.rectangle([fx - 5, wall_y - 34, fx + 5, wall_y], fill=(160, 166, 178))
        for k in range(3):
            phase = (global_t * 0.9 + k / 3) % 1.0
            y = lerp(chip[1] - 20, wall_y + 34, phase)
            draw.line([((x0 + x1) / 2 - 40 + k * 40, y + 20), ((x0 + x1) / 2 - 40 + k * 40, y)],
                      fill=(255, 120, 40, int(255 * (1 - phase))), width=8)
        draw.text((x1 - 30, y1 - 100), self.tx["inset"]["heat"], font=font(FONT_BLACK, 24),
                  fill=(255, 140, 60), anchor="rm")

    def inset_poe(self, draw, box, t, global_t):
        x0, y0, x1, y1 = box
        self.inset_frame(draw, box)
        mid = (y0 + y1) / 2
        for k in range(4):
            y = mid - 36 + k * 24
            color = (255, 150, 40) if k % 2 == 0 else (60, 220, 255)
            draw.line([(x0 + 30, y), (x1 - 30, y)], fill=shade(color, 0.45), width=10)
            for j in range(4):
                px = x0 + 30 + ((global_t * 160 + j * 80 + k * 20) % (x1 - x0 - 60))
                draw.ellipse([px - 7, y - 7, px + 7, y + 7], fill=color)
        draw.text(((x0 + x1) / 2, y1 - 26), self.tx["inset"]["poe_note"], font=font(FONT_BOLD, 22),
                  fill=GREY, anchor="mm")

    # ---- payoff / caption ----------------------------------------------
    def draw_payoff(self, draw, t):
        alpha = ease((t - 2.4) / 0.6)
        if alpha <= 0:
            return
        a = int(255 * alpha)
        big, small = self.tx["payoff"]
        draw.text((540, 1250), big, font=font(FONT_BLACK, 92), fill=(255, 255, 255, a), anchor="mm",
                  stroke_width=6, stroke_fill=(0, 0, 0, a))
        draw.text((540, 1355), small, font=font(FONT_BLACK, 92), fill=AMBER + (a,), anchor="mm",
                  stroke_width=6, stroke_fill=(0, 0, 0, a))
        cta = self.tx["cta"]
        cta_font = font(FONT_BOLD, 40)
        w = draw.textlength(cta, font=cta_font)
        draw.rounded_rectangle([540 - w / 2 - 30, 400, 540 + w / 2 + 30, 470], radius=35, fill=AMBER + (a,))
        draw.text((540, 435), cta, font=cta_font, fill=(20, 20, 24, a), anchor="mm")

    def draw_caption(self, draw, scene, global_t):
        chunk = current_chunk(scene, global_t)
        if not chunk:
            return
        color = AMBER if any(ch.isdigit() for ch in chunk) or chunk.isupper() else WHITE
        text = chunk.upper()
        size = 62
        while draw.textlength(text, font=font(FONT_BLACK, size)) > 940:
            size -= 2
        draw.text((540, 1610), text, font=font(FONT_BLACK, size), fill=color, anchor="ma",
                  stroke_width=10, stroke_fill=(0, 0, 0))

    # ---- audio ------------------------------------------------------------
    def build_audio(self, total):
        chords = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]
        music = make_pad_music(total + 1, chords, chord_len=4.8, bpm=100, pluck_gain=0.025, pulse=False)
        sfx = np.zeros(int((total + 1) * SAMPLE_RATE), dtype=np.float32)
        hook, payoff = self.scenes[0], self.scenes[-1]
        place(sfx, whoosh(1.6, seed=5), hook["start"] + 1.5, 0.2)
        place(sfx, whoosh(1.4, seed=9)[::-1], payoff["start"] + 0.4, 0.18)
        place(sfx, click(2200), self.word_time("filter", self.tx["click_word"]), 0.6)
        place(sfx, click(1400), self.word_time("filter", self.tx["click_word"]) + 0.03, 0.4)
        for scene in self.scenes[1:-1]:
            place(sfx, blip(990), scene["start"] + 0.05, 0.05)
        return write_mix(self.build_dir / "mix.wav", self.scenes, total, music, sfx, music_gain=0.32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lang", choices=["en", "id"], default="id")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args()

    video = Video(args.lang)
    total = build_timeline(video.scenes, video.build_dir, args.lang)
    for scene in video.scenes:
        scene["chunks"] = caption_chunks(scene["caption"], max_chars=20)
    print(f"[{args.lang}] total {total:.1f} s", flush=True)
    for scene in video.scenes:
        print(f"  {scene['key']:<8} start {scene['start']:5.1f}  dur {scene['dur']:4.1f}", flush=True)

    if args.preview:
        contact_sheet(EPISODE_DIR / f"preview_{args.lang}.png", video.scenes, video.frame)
        for key, frac in (("hook", 0.95), ("ir", 0.7), ("filter", 0.9), ("soc", 0.8)):
            scene = next(s for s in video.scenes if s["key"] == key)
            video.frame(scene["start"] + scene["dur"] * frac).save(EPISODE_DIR / f"preview_{args.lang}_{key}.png")
        print("preview written", flush=True)
        return

    audio = video.build_audio(total)
    encode(video.output, audio, total, video.frame, cover_path=EPISODE_DIR / f"cover_{args.lang}.png",
           cover_time=total * 0.62)


if __name__ == "__main__":
    main()
