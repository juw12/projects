"""
pet_shop.py - coins, the shop catalog, props your pet can wear and moves (tricks).

Coins are *derived* from what you did (pomodoros, levels, achievements, days you
used Pips, friendships, interactions with friends) plus a welcome gift, minus
what you spent - so nothing is lost if a file gets out of sync and earning
can't be double counted. Purchases and the equipped props live in
data/shop.json.

Drawing helpers here are pure tkinter-canvas code shared by the desktop pet,
the visiting friend's pet and the avatars in the Pips hub.
All user-facing text comes from i18n.py.
"""

from __future__ import annotations

import json
import logging
import math
from datetime import date
from pathlib import Path

logger = logging.getLogger("pet_shop")

WELCOME_GIFT = 100
COINS_PER_POMODORO = 5
COINS_PER_LEVEL = 40
COINS_PER_ACHIEVEMENT = 25
COINS_PER_DAY = 10
COINS_PER_AFFINITY_LEVEL = 15
COINS_PER_INTERACTION = 2
INTERACTION_DAILY_CAP = 20
COIN = "\u25c9"   # ◉

SLOTS = ("head", "face", "neck", "back")

# id -> (slot, price)
PROPS = {
    "flower": ("head", 40),
    "party_hat": ("head", 60),
    "cap": ("head", 80),
    "beanie": ("head", 90),
    "headphones": ("head", 140),
    "wizard": ("head", 220),
    "halo": ("head", 260),
    "crown": ("head", 300),
    "shades": ("face", 110),
    "heart_glasses": ("face", 130),
    "monocle": ("face", 160),
    "bowtie": ("neck", 50),
    "bell": ("neck", 60),
    "scarf": ("neck", 80),
    "medal": ("neck", 200),
    "cape": ("back", 240),
    "wings": ("back", 380),
}

# id -> (price, seconds)
MOVES = {
    "spin": (60, 2.0),
    "dance": (90, 4.0),
    "moonwalk": (140, 4.0),
    "backflip": (180, 1.8),
    "kungfu": (260, 3.4),
    "spider": (420, 5.5),
}
TALL_MOVES = {"spider": 230}      # extra canvas height (px) the move needs above the pet


# =============================================================================
# Wallet & inventory
# =============================================================================

def earned_coins(stats: dict, achievements: int, login_days: int, affinity_levels: int, bonus: int) -> dict:
    """Breakdown of every coin you have earned so far."""
    parts = {
        "gift": WELCOME_GIFT,
        "pomodoros": COINS_PER_POMODORO * int(stats.get("total_poms", 0)),
        "levels": COINS_PER_LEVEL * max(0, int(stats.get("level", 1)) - 1),
        "achievements": COINS_PER_ACHIEVEMENT * int(achievements),
        "days": COINS_PER_DAY * int(login_days),
        "friends": COINS_PER_AFFINITY_LEVEL * int(affinity_levels),
        "social": int(bonus),
    }
    parts["total"] = sum(parts.values())
    return parts


class Shop:
    def __init__(self, base_dir):
        self.path = Path(base_dir) / "data" / "shop.json"
        self.data = self._load()
        self.data.setdefault("owned", [])
        self.data.setdefault("equipped", {})
        self.data.setdefault("spent", 0)
        self.data.setdefault("login_days", [])
        self.data.setdefault("bonus", 0)
        self.data.setdefault("bonus_day", "")
        self.data.setdefault("bonus_today", 0)
        self.mark_today()

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def save(self):
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
            tmp.replace(self.path)
        except OSError as exc:
            logger.warning("shop: could not save %s: %s", self.path, exc)

    def mark_today(self):
        today = date.today().isoformat()
        days = self.data["login_days"]
        if today not in days:
            days.append(today)
            self.data["login_days"] = days[-3650:]
            self.save()

    def add_interaction_bonus(self):
        today = date.today().isoformat()
        if self.data.get("bonus_day") != today:
            self.data["bonus_day"] = today
            self.data["bonus_today"] = 0
        if self.data["bonus_today"] < INTERACTION_DAILY_CAP:
            self.data["bonus_today"] += COINS_PER_INTERACTION
            self.data["bonus"] += COINS_PER_INTERACTION
            self.save()

    def wallet(self, stats: dict, achievements: int, affinity_levels: int) -> dict:
        parts = earned_coins(stats, achievements, len(self.data["login_days"]), affinity_levels,
                             self.data.get("bonus", 0))
        parts["spent"] = int(self.data.get("spent", 0))
        parts["balance"] = parts["total"] - parts["spent"]
        return parts

    def owns(self, item: str) -> bool:
        return item in self.data["owned"]

    def price(self, item: str) -> int:
        if item in PROPS:
            return PROPS[item][1]
        if item in MOVES:
            return MOVES[item][0]
        raise KeyError(item)

    def buy(self, item: str, balance: int) -> bool:
        if self.owns(item):
            return True
        price = self.price(item)
        if price > balance:
            return False
        self.data["owned"].append(item)
        self.data["spent"] = int(self.data.get("spent", 0)) + price
        if item in PROPS:
            self.equip(item)
        self.save()
        return True

    def equip(self, item: str):
        if item in PROPS and self.owns(item):
            self.data["equipped"][PROPS[item][0]] = item
            self.save()

    def unequip(self, slot: str):
        self.data["equipped"].pop(slot, None)
        self.save()

    def equipped(self) -> dict:
        return {slot: item for slot, item in self.data["equipped"].items() if item in PROPS and self.owns(item)}

    def moves(self) -> list:
        return [m for m in MOVES if self.owns(m)]


def clean_look(look) -> dict:
    """Validate a look dict coming from the server (friends' props)."""
    if not isinstance(look, dict):
        return {}
    out = {}
    for slot in SLOTS:
        item = look.get(slot)
        if isinstance(item, str) and item in PROPS and PROPS[item][0] == slot:
            out[slot] = item
    moves = look.get("moves")
    if isinstance(moves, list):
        out["moves"] = [m for m in moves if m in MOVES][:10]
    return out


# =============================================================================
# Drawing props
# =============================================================================

def _poly(cv, pts, fill, outline="", width=1, smooth=False):
    cv.create_polygon(*pts, fill=fill, outline=outline, width=width, smooth=smooth, joinstyle="round")


def _oval(cv, x, y, rx, ry, fill, outline="", width=1):
    cv.create_oval(x - rx, y - ry, x + rx, y + ry, fill=fill, outline=outline, width=width)


def draw_back_props(cv, geo: dict, props: dict, t: float = 0.0):
    """Props drawn *behind* the pet (cape, wings). Call before draw_pet."""
    if not geo or not props:
        return
    item = props.get("back")
    u = geo["u"]
    cx, cy, rx, ry = geo["cx"], geo["cy"], geo["rx"], geo["ry"]
    if item == "cape":
        sway = math.sin(t * 2.4) * 3 * u
        side = -geo["facing"]
        pts = [cx - rx * 0.55, cy - ry * 0.35, cx + rx * 0.55, cy - ry * 0.35,
               cx + rx * 0.95 + side * 4 * u + sway, cy + ry * 1.05,
               cx + side * 6 * u + sway, cy + ry * 0.92,
               cx - rx * 0.95 + side * 4 * u + sway, cy + ry * 1.05]
        _poly(cv, pts, "#c0262d", "#7a1418", max(1, 1.2 * u), smooth=True)
    elif item == "wings":
        flap = math.sin(t * 5) * 4 * u
        for s in (-1, 1):
            base_x = cx + s * rx * 0.55
            pts = [base_x, cy - ry * 0.2,
                   cx + s * (rx + 15 * u), cy - ry * 0.95 - flap,
                   cx + s * (rx + 19 * u), cy - ry * 0.25 - flap * 0.5,
                   cx + s * (rx + 13 * u), cy + ry * 0.2,
                   base_x, cy + ry * 0.25]
            _poly(cv, pts, "#ffffff", "#c9d6e8", max(1, 1.2 * u), smooth=True)
            for k in (0.45, 0.7):
                cv.create_line(base_x, cy, cx + s * (rx + 15 * u * k + 4 * u), cy - ry * 0.6 * k - flap * k,
                               fill="#dfe7f2", width=max(1, u))


def draw_front_props(cv, geo: dict, props: dict, t: float = 0.0):
    """Props drawn *on top of* the pet (hats, glasses, neckwear). Call after draw_pet."""
    if not geo or not props:
        return
    u = geo["u"]
    cx, cy, rx, ry = geo["cx"], geo["cy"], geo["rx"], geo["ry"]
    fx = geo.get("feature_dx", 0.0)
    facing = geo["facing"]
    top = cy - ry
    lw = max(1, 1.2 * u)
    eye_y = geo.get("eye_y", cy - 1.5 * u)
    sep = geo.get("eye_sep", 11 * u)
    hx = cx + fx * 0.6

    neck = props.get("neck")
    neck_y = cy + ry * 0.48
    if neck == "bowtie":
        _poly(cv, [hx, neck_y, hx - 7 * u, neck_y - 4.5 * u, hx - 7 * u, neck_y + 4.5 * u], "#d6336c", "#8f1d45", lw)
        _poly(cv, [hx, neck_y, hx + 7 * u, neck_y - 4.5 * u, hx + 7 * u, neck_y + 4.5 * u], "#d6336c", "#8f1d45", lw)
        _oval(cv, hx, neck_y, 2 * u, 2 * u, "#f06595", "#8f1d45", lw)
    elif neck == "bell":
        cv.create_line(hx - rx * 0.62, neck_y - 2 * u, hx + rx * 0.62, neck_y - 2 * u, fill="#d6336c",
                       width=max(2, 2.6 * u), capstyle="round")
        _oval(cv, hx, neck_y + 2.5 * u, 3.6 * u, 3.6 * u, "#f5c518", "#a37f00", lw)
        cv.create_line(hx, neck_y + 3 * u, hx, neck_y + 5.5 * u, fill="#a37f00", width=lw)
    elif neck == "scarf":
        cv.create_line(hx - rx * 0.7, neck_y - 2 * u, hx + rx * 0.7, neck_y - 2 * u, fill="#2f9e44",
                       width=max(3, 5 * u), capstyle="round")
        side = -facing
        _poly(cv, [hx + side * rx * 0.25, neck_y - 1 * u, hx + side * rx * 0.48, neck_y - 1 * u,
                   hx + side * rx * 0.55, neck_y + 12 * u, hx + side * rx * 0.3, neck_y + 11 * u],
              "#37b24d", "#1f6f30", lw)
        for k in (-0.4, 0.0, 0.4):
            cv.create_line(hx + rx * k, neck_y - 4 * u, hx + rx * k, neck_y, fill="#b2f2bb", width=max(1, u))
    elif neck == "medal":
        _poly(cv, [hx - 6 * u, neck_y - 5 * u, hx - 1 * u, neck_y + 5 * u, hx + 1 * u, neck_y + 5 * u,
                   hx + 6 * u, neck_y - 5 * u, hx + 3 * u, neck_y - 5 * u, hx, neck_y + 1 * u,
                   hx - 3 * u, neck_y - 5 * u], "#1c7ed6", "#0b4f8c", lw)
        _oval(cv, hx, neck_y + 8 * u, 4.4 * u, 4.4 * u, "#fab005", "#a36a00", lw)
        cv.create_text(hx, neck_y + 8 * u, text="1", font=("Segoe UI", max(5, int(4.5 * u)), "bold"),
                       fill="#7a4f00")

    face = props.get("face")
    if face == "shades":
        for s in (-1, 1):
            ex = cx + fx + s * sep
            cv.create_rectangle(ex - 5.5 * u, eye_y - 3.2 * u, ex + 5.5 * u, eye_y + 3.2 * u,
                                fill="#1a1a1a", outline="#000000", width=lw)
            cv.create_line(ex - 3.5 * u, eye_y - 1.8 * u, ex - 1 * u, eye_y - 1.8 * u, fill="#6b6b6b",
                           width=max(1, u))
        cv.create_line(cx + fx - sep + 5.5 * u, eye_y - 1 * u, cx + fx + sep - 5.5 * u, eye_y - 1 * u,
                       fill="#000000", width=lw)
    elif face == "heart_glasses":
        for s in (-1, 1):
            ex = cx + fx + s * sep
            r = 4.2 * u
            pts = [ex, eye_y + r * 1.1, ex - r * 1.3, eye_y - r * 0.1, ex - r * 0.7, eye_y - r * 1.0,
                   ex, eye_y - r * 0.45, ex + r * 0.7, eye_y - r * 1.0, ex + r * 1.3, eye_y - r * 0.1]
            _poly(cv, pts, "#ff6b9a", "#c2255c", lw, smooth=True)
        cv.create_line(cx + fx - sep + 4 * u, eye_y - 1.5 * u, cx + fx + sep - 4 * u, eye_y - 1.5 * u,
                       fill="#c2255c", width=lw)
    elif face == "monocle":
        ex = cx + fx + facing * sep
        _oval(cv, ex, eye_y, 4.8 * u, 4.8 * u, "", "#c99a2e", max(1.5, 1.6 * u))
        cv.create_line(ex + facing * 3 * u, eye_y + 4 * u, ex + facing * 6 * u, eye_y + 14 * u,
                       fill="#c99a2e", width=max(1, 0.9 * u))

    head = props.get("head")
    if head == "party_hat":
        apex_x = hx + 2 * u
        _poly(cv, [hx - 8 * u, top + 3 * u, hx + 8 * u, top + 3 * u, apex_x, top - 15 * u],
              "#845ef7", "#5f3dc4", lw)
        for k in (0.3, 0.6):
            y = top + 3 * u - 18 * u * k
            half = 8 * u * (1 - k)
            cv.create_line(hx - half + (apex_x - hx) * k, y, hx + half + (apex_x - hx) * k, y, fill="#ffd43b",
                           width=max(1, 1.6 * u))
        _oval(cv, apex_x, top - 15 * u, 2.6 * u, 2.6 * u, "#ff6b6b", "#c92a2a", lw)
    elif head == "flower":
        fxp = hx + facing * rx * 0.5
        fyp = top + 3 * u
        for k in range(5):
            a = k * 2 * math.pi / 5 + t * 0.5
            _oval(cv, fxp + math.cos(a) * 3.2 * u, fyp + math.sin(a) * 3.2 * u, 2.6 * u, 2.6 * u,
                  "#ff8fab", "#d6336c", max(1, 0.8 * u))
        _oval(cv, fxp, fyp, 2.2 * u, 2.2 * u, "#ffd43b", "#e8a200", max(1, 0.8 * u))
    elif head == "cap":
        pts = []
        for k in range(13):
            a = math.pi * k / 12
            pts += [hx - math.cos(a) * rx * 0.72, top + 4 * u - math.sin(a) * 9 * u]
        _poly(cv, pts, "#1c7ed6", "#0b4f8c", lw, smooth=True)
        visor_x = hx + facing * rx * 0.72
        _poly(cv, [hx + facing * rx * 0.3, top + 4 * u, visor_x + facing * 9 * u, top + 5.5 * u,
                   visor_x + facing * 8 * u, top + 3 * u, hx + facing * rx * 0.4, top + 2 * u],
              "#1864ab", "#0b4f8c", lw)
        _oval(cv, hx, top - 5 * u, 1.6 * u, 1.6 * u, "#ffffff", "")
    elif head == "beanie":
        pts = []
        for k in range(13):
            a = math.pi * k / 12
            pts += [hx - math.cos(a) * rx * 0.78, top + 5 * u - math.sin(a) * 11 * u]
        _poly(cv, pts, "#f76707", "#b34700", lw, smooth=True)
        cv.create_rectangle(hx - rx * 0.8, top + 2.5 * u, hx + rx * 0.8, top + 6.5 * u, fill="#ffa94d",
                            outline="#b34700", width=lw)
        _oval(cv, hx, top - 7 * u, 3.4 * u, 3.4 * u, "#fff4e6", "#b34700", lw)
    elif head == "headphones":
        cv.create_arc(hx - rx * 0.95, top - 6 * u, hx + rx * 0.95, cy + ry * 0.2, start=15, extent=150,
                      style="arc", outline="#343a40", width=max(2, 2.6 * u))
        for s in (-1, 1):
            ex = hx + s * rx * 0.93
            _oval(cv, ex, cy - ry * 0.35, 3.6 * u, 5.4 * u, "#e64980", "#343a40", lw)
    elif head == "wizard":
        _oval(cv, hx, top + 3 * u, rx * 0.9, 3.4 * u, "#3b5bdb", "#1c2f8a", lw)
        _poly(cv, [hx - rx * 0.5, top + 2.5 * u, hx + rx * 0.5, top + 2.5 * u, hx + 7 * u, top - 22 * u],
              "#4263eb", "#1c2f8a", lw)
        for sx, sy in ((-0.15, -6), (0.15, -13), (0.0, 0)):
            cv.create_text(hx + rx * sx, top + sy * u, text="\u2605", fill="#ffd43b",
                           font=("Segoe UI Symbol", max(5, int(4.5 * u))))
    elif head == "halo":
        bob = math.sin(t * 2.5) * 1.5 * u
        _oval(cv, hx, top - 7 * u + bob, rx * 0.55, 2.6 * u, "", "#fcc419", max(2, 2.4 * u))
    elif head == "crown":
        y0 = top + 3 * u
        w = rx * 0.62
        pts = [hx - w, y0, hx - w, y0 - 9 * u, hx - w * 0.5, y0 - 4 * u, hx, y0 - 11 * u,
               hx + w * 0.5, y0 - 4 * u, hx + w, y0 - 9 * u, hx + w, y0]
        _poly(cv, pts, "#fcc419", "#b8860b", lw)
        for gx, col in ((-0.5, "#e03131"), (0.0, "#1c7ed6"), (0.5, "#2f9e44")):
            _oval(cv, hx + w * gx, y0 - 2.5 * u, 1.5 * u, 1.5 * u, col, "")


def draw_props_preview(cv, pet_mod, size, species, color, props, cx=None, floor=None, t=0.0):
    """Small helper for the shop / avatars: pet + props on a canvas."""
    look = pet_mod.default_look({"species": species if species in pet_mod.SPECIES else "cat",
                                 "color": color or "#ffc78f", "cheek_color": "#ff8fa3"})
    look["t"] = t
    look["mouth"] = "smile"
    cx = cx if cx is not None else int(cv["width"]) / 2
    floor = floor if floor is not None else int(cv["height"]) - 2
    geo = pet_mod.body_geometry(cx, floor, size, look)
    draw_back_props(cv, geo, props, t)
    geo = pet_mod.draw_pet(cv, cx, floor, size, look) or geo
    draw_front_props(cv, geo, props, t)


# =============================================================================
# Moves (tricks)
# =============================================================================

def trick_pose(L: dict, trick: str, p: float, t: float) -> dict:
    """Adjust the look for a trick; p = progress 0..1, t = time (s)."""
    bump = math.sin(p * math.pi)
    if trick == "spin":
        L.update(eyes="happy", mouth="big_open", blush=True, brows=None,
                 facing=1 if int(t * 9) % 2 == 0 else -1, hop=bump * 6 + abs(math.sin(t * 9)) * 2,
                 squash=math.sin(t * 18) * 0.05)
    elif trick == "dance":
        beat = math.sin(t * 8)
        L.update(eyes="happy" if int(t * 2) % 2 else "open", mouth="big_open", blush=True, brows=None,
                 lean=beat * 4.5, hop=abs(beat) * 6, squash=-abs(beat) * 0.06,
                 wag=beat * 4, facing=1 if math.sin(t * 2) > 0 else -1,
                 foot_l=max(0.0, beat) * 4, foot_r=max(0.0, -beat) * 4)
    elif trick == "moonwalk":
        step = math.sin(t * 10)
        L.update(eyes="half", mouth="smile", brows=None, lean=-2.5 * L.get("facing", 1),
                 foot_l=step * 3.5, foot_r=-step * 3.5, hop=abs(step) * 1.2)
    elif trick == "backflip":
        L.update(eyes="closed" if 0.2 < p < 0.8 else "happy", mouth="o" if p < 0.8 else "big_open",
                 brows=None, hop=bump * 30, squash=(0.25 * (1 - p * 6)) if p < 0.15 else (-0.12 * bump),
                 facing=1 if (p < 0.35 or p > 0.65) else -1)
    elif trick == "kungfu":
        hit = math.sin(t * 16)
        kick = 0.55 < p < 0.8
        L.update(eyes="open", brows="angry", mouth="o" if hit > 0 else "big_open", blush=False,
                 lean=hit * 5, squash=(-0.1 if kick else 0.06 * abs(hit)),
                 hop=(math.sin((p - 0.55) / 0.25 * math.pi) * 14 if kick else 0),
                 facing=1 if int(t * 3) % 2 == 0 else -1)
        if p > 0.85:
            L.update(eyes="happy", brows=None, mouth="smile", lean=0, hop=0)
    elif trick == "spider":
        L.update(eyes="big" if p < 0.15 else "happy", mouth="big_open", blush=True, brows=None,
                 dangle=True, squash=-0.05)
    return L


def trick_motion(trick: str, p: float, t: float, facing: int):
    """Window offset (dx px) and lift (px) for moves that travel."""
    if trick == "moonwalk":
        return -facing * math.sin(p * math.pi) * 110, 0.0
    if trick == "spider":
        env = math.sin(min(1.0, p * 1.15) * math.pi) if p < 0.87 else 0.0
        swing = math.sin(p * math.pi * 3.0) * 130 * env
        lift = (70 + 45 * abs(math.cos(p * math.pi * 3.0))) * env
        return swing, lift
    return 0.0, 0.0


def draw_trick_fx(cv, trick: str, p: float, t: float, geo: dict, canvas_w: float, dx: float = 0.0):
    """Extra effects (web line, fists, motion lines, notes...)."""
    if not geo:
        return
    u = geo["u"]
    cx, cy, rx, ry = geo["cx"], geo["cy"], geo["rx"], geo["ry"]
    font_px = max(7, int(5 * u))
    if trick == "spider":
        top_y = cy - ry
        anchor_x = canvas_w / 2 - dx * 0.55
        cv.create_line(anchor_x, 0, cx, top_y + 2 * u, fill="#ffffff", width=max(2, 1.6 * u))
        cv.create_line(anchor_x, 0, cx, top_y + 2 * u, fill="#c8d2dc", width=1, dash=(3, 3))
        if p < 0.2:
            cv.create_text(cx + 18 * u, top_y - 6 * u, text="thwip!", fill="#e03131",
                           font=("Segoe UI", font_px, "bold italic"))
    elif trick == "kungfu":
        hit = math.sin(t * 16)
        side = 1 if hit > 0 else -1
        reach = (8 + 9 * abs(hit)) * u
        fist_x = cx + side * (rx + reach * 0.4)
        fist_y = cy + ry * 0.05
        _oval(cv, fist_x, fist_y, 3.6 * u, 3.6 * u, "#ffe8cc", "#a35b00", max(1, u))
        for k in range(3):
            y = fist_y - 3 * u + k * 3 * u
            cv.create_line(fist_x - side * 5 * u, y, fist_x - side * (11 + 2 * k) * u, y, fill="#868e96",
                           width=max(1, 0.8 * u))
        if p > 0.82:
            cv.create_text(cx, cy - ry - 9 * u, text="Hi-ya!", fill="#e03131",
                           font=("Segoe UI", font_px + 1, "bold italic"))
    elif trick == "backflip":
        r = rx * 1.25
        start = (p * 360 * 1.0) % 360
        cv.create_arc(cx - r, cy - r, cx + r, cy + r, start=start, extent=110, style="arc",
                      outline="#adb5bd", width=max(1, 1.2 * u))
        if p > 0.8:
            cv.create_text(cx, cy - ry - 8 * u, text="ta-da!", fill="#7048e8",
                           font=("Segoe UI", font_px, "bold italic"))
    elif trick in ("dance", "moonwalk"):
        for k in range(2):
            a = t * 2.2 + k * math.pi
            cv.create_text(cx + math.cos(a) * (rx + 8 * u), cy - ry - 4 * u + math.sin(a * 1.3) * 4 * u,
                           text="\u266a" if k else "\u266b", fill="#7048e8",
                           font=("Segoe UI Symbol", font_px + 1, "bold"))
    elif trick == "spin":
        for k in range(3):
            a = t * 9 + k * 2.1
            cv.create_text(cx + math.cos(a) * (rx + 6 * u), cy + math.sin(a) * ry * 0.8, text="\u2726",
                           fill="#f5b700", font=("Segoe UI Symbol", font_px))
