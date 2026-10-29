"""
minigames.py - quick arcade games to play with your pet (v2.24).

    Treat Catch  - move your pet left / right and catch falling treats, dodge the rocks
    Bonk the Bugs - whack the bugs that pop out of the holes (leave the flowers alone!)
    Memory Match - flip cards and find the 8 pairs with as few misses as possible
    Pet Says     - repeat the growing colour + sound pattern (Simon)
    Hop Hop      - your pet runs; jump over the obstacles

Every game has a small, timing-independent logic class (step(dt) + input methods) so it can be
tested headless, and one GameWindow (tkinter) that draws it. Finishing a game makes the pet happier,
records your best score, and a good score gives a few coins (limited per day).
"""

from __future__ import annotations

import math
import random
import threading
import time
import tkinter as tk
from datetime import date

try:
    from i18n import t
except ImportError:  # pragma: no cover
    def t(key, lang=None, **kwargs):
        return key.format(**kwargs) if kwargs else key

try:
    import pet_shop
except ImportError:  # pragma: no cover
    pet_shop = None

GAMES = ("catch", "bonk", "memory", "simon", "hop")
ICONS = {"catch": "\U0001F36A", "bonk": "\U0001F41E", "memory": "\U0001F0CF", "simon": "\U0001F3B5",
         "hop": "\U0001F3C3"}
GOOD_SCORE = {"catch": 30, "bonk": 22, "memory": 90, "simon": 7, "hop": 60}   # "well played" thresholds
GAME_COINS = 3                     # coins for a good score...
COIN_GAMES_PER_DAY = 5             # ...the first few times per day
CW, CH = 440, 340                  # canvas size

# =============================================================================
# Game logic (no tkinter)
# =============================================================================


class CatchGame:
    """Treats fall from the sky; move the pet to catch them. Rocks cost a life (3 lives, 45 s)."""
    DURATION = 45.0
    PET_Y = CH - 44
    REACH = 40
    ITEMS = {"cookie": 1, "fish": 2, "star": 5, "rock": 0}

    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.x = CW / 2
        self.items: list = []
        self.score = 0
        self.lives = 3
        self.time_left = self.DURATION
        self.elapsed = 0.0
        self._spawn_in = 0.4
        self.events: list = []        # (kind, x, y) for the window's pop effects
        self.done = False

    def move_to(self, x):
        self.x = max(30.0, min(CW - 30.0, float(x)))

    def nudge(self, dx):
        self.move_to(self.x + dx)

    def _spawn(self):
        roll = self.rng.random()
        kind = "star" if roll < 0.06 else "rock" if roll < 0.28 else "fish" if roll < 0.5 else "cookie"
        speed = 120 + self.elapsed * 3.2 + self.rng.uniform(-20, 30)
        self.items.append({"kind": kind, "x": self.rng.uniform(24, CW - 24), "y": -12.0, "vy": speed})

    def step(self, dt):
        if self.done:
            return
        self.elapsed += dt
        self.time_left = max(0.0, self.time_left - dt)
        self._spawn_in -= dt
        if self._spawn_in <= 0:
            self._spawn()
            self._spawn_in = max(0.32, 0.85 - self.elapsed * 0.012) * self.rng.uniform(0.7, 1.2)
        keep = []
        for item in self.items:
            item["y"] += item["vy"] * dt
            if self.PET_Y - 30 <= item["y"] <= self.PET_Y + 6 and abs(item["x"] - self.x) < self.REACH:
                if item["kind"] == "rock":
                    self.lives -= 1
                    self.events.append(("ouch", item["x"], item["y"]))
                else:
                    self.score += self.ITEMS[item["kind"]]
                    self.events.append((item["kind"], item["x"], item["y"]))
                continue
            if item["y"] < CH + 20:
                keep.append(item)
        self.items = keep
        if self.time_left <= 0 or self.lives <= 0:
            self.done = True


class BonkGame:
    """3x3 holes. Bonk bugs (+1), golden bees (+3); bonking a flower costs 2. 30 seconds."""
    DURATION = 30.0
    HOLES = 9

    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.holes: list = [None] * self.HOLES     # {"kind", "left", "hit"}
        self.score = 0
        self.hits = 0
        self.time_left = self.DURATION
        self.elapsed = 0.0
        self._spawn_in = 0.5
        self.done = False

    def step(self, dt):
        if self.done:
            return
        self.elapsed += dt
        self.time_left = max(0.0, self.time_left - dt)
        for i, hole in enumerate(self.holes):
            if hole:
                hole["left"] -= dt
                if hole["left"] <= 0:
                    self.holes[i] = None
        self._spawn_in -= dt
        if self._spawn_in <= 0:
            empty = [i for i, h in enumerate(self.holes) if h is None]
            if empty:
                roll = self.rng.random()
                kind = "gold" if roll < 0.1 else "flower" if roll < 0.3 else "bug"
                stay = max(0.55, 1.25 - self.elapsed * 0.022) * self.rng.uniform(0.85, 1.15)
                self.holes[self.rng.choice(empty)] = {"kind": kind, "left": stay, "hit": False}
            self._spawn_in = max(0.28, 0.8 - self.elapsed * 0.016)
        if self.time_left <= 0:
            self.done = True

    def bonk(self, index) -> str | None:
        """Returns what was bonked ('bug', 'gold', 'flower') or None for an empty hole."""
        if self.done or not 0 <= index < self.HOLES:
            return None
        hole = self.holes[index]
        if not hole or hole["hit"]:
            return None
        hole["hit"] = True
        hole["left"] = min(hole["left"], 0.35)
        if hole["kind"] == "flower":
            self.score = max(0, self.score - 2)
        else:
            self.score += 3 if hole["kind"] == "gold" else 1
            self.hits += 1
        return hole["kind"]


class MemoryGame:
    """16 face-down cards, 8 pairs. Score: 150 minus 6 per miss and a little for the time taken."""
    SYMBOLS = ("\U0001F436", "\U0001F431", "\U0001F430", "\U0001F43B", "\U0001F438", "\U0001F98A",
               "\U0001F43C", "\U0001F427")

    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.cards = list(self.SYMBOLS) * 2
        self.rng.shuffle(self.cards)
        self.matched = [False] * len(self.cards)
        self.open: list = []          # indexes face up but not matched (max 2)
        self.misses = 0
        self.flips = 0
        self.elapsed = 0.0
        self.done = False

    def step(self, dt):
        if not self.done:
            self.elapsed += dt

    def hide_open(self):
        if len(self.open) == 2:
            self.open = []

    def flip(self, index) -> str | None:
        """'first', 'match', 'miss' or None (ignored click)."""
        if self.done or not 0 <= index < len(self.cards) or self.matched[index] or index in self.open:
            return None
        if len(self.open) == 2:
            self.open = []
        self.open.append(index)
        self.flips += 1
        if len(self.open) == 1:
            return "first"
        a, b = self.open
        if self.cards[a] == self.cards[b]:
            self.matched[a] = self.matched[b] = True
            self.open = []
            if all(self.matched):
                self.done = True
            return "match"
        self.misses += 1
        return "miss"

    @property
    def score(self) -> int:
        pairs = sum(self.matched) // 2
        if not self.done:
            return pairs * 10
        return max(10, 150 - 6 * self.misses - int(self.elapsed) // 2)


class SimonGame:
    """Pet Says: watch the pattern, then repeat it. Each round adds one more step."""
    PADS = 4

    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.seq: list = []
        self.pos = 0
        self.done = False
        self.add_step()

    def add_step(self):
        self.seq.append(self.rng.randrange(self.PADS))
        self.pos = 0

    def press(self, pad) -> str | None:
        """'ok' (keep going), 'round' (pattern complete, a new step was added) or 'wrong' (game over)."""
        if self.done or not 0 <= pad < self.PADS:
            return None
        if pad != self.seq[self.pos]:
            self.done = True
            return "wrong"
        self.pos += 1
        if self.pos >= len(self.seq):
            self.add_step()
            return "round"
        return "ok"

    def step(self, dt):
        pass

    @property
    def score(self) -> int:
        return len(self.seq) - 1


class HopGame:
    """The pet runs to the right; jump (space / click) over rocks and cacti. Score = distance."""
    GROUND = CH - 40
    PET_X = 90
    GRAVITY = 1900.0
    JUMP_V = 720.0

    def __init__(self, rng=None):
        self.rng = rng or random.Random()
        self.y = 0.0                  # height above the ground
        self.vy = 0.0
        self.speed = 230.0
        self.distance = 0.0
        self.obstacles: list = []     # {"x", "w", "h", "kind"}
        self._gap = 260.0
        self.done = False

    @property
    def on_ground(self) -> bool:
        return self.y <= 0.0 and self.vy <= 0.0

    def jump(self) -> bool:
        if self.done or not self.on_ground:
            return False
        self.vy = self.JUMP_V
        return True

    def step(self, dt):
        if self.done:
            return
        self.speed = min(560.0, 230.0 + self.distance * 0.045)
        self.distance += self.speed * dt
        self.vy -= self.GRAVITY * dt
        self.y = max(0.0, self.y + self.vy * dt)
        if self.y == 0.0 and self.vy < 0:
            self.vy = 0.0
        for ob in self.obstacles:
            ob["x"] -= self.speed * dt
        self.obstacles = [ob for ob in self.obstacles if ob["x"] + ob["w"] > -10]
        self._gap -= self.speed * dt
        if self._gap <= 0:
            kind = self.rng.choice(("rock", "cactus", "cactus", "log"))
            w, h = {"rock": (30, 24), "cactus": (20, 44), "log": (46, 20)}[kind]
            self.obstacles.append({"x": CW + 20.0, "w": w, "h": h, "kind": kind})
            self._gap = self.rng.uniform(230, 420) + self.speed * 0.35
        for ob in self.obstacles:
            if ob["x"] < self.PET_X + 16 and ob["x"] + ob["w"] > self.PET_X - 16 and self.y < ob["h"] - 4:
                self.done = True
                break

    @property
    def score(self) -> int:
        return int(self.distance / 100)


LOGIC = {"catch": CatchGame, "bonk": BonkGame, "memory": MemoryGame, "simon": SimonGame, "hop": HopGame}


# =============================================================================
# Records & rewards (stored in the pet's state)
# =============================================================================

def records(state: dict) -> dict:
    rec = state.get("minigames")
    if not isinstance(rec, dict):
        rec = {}
    rec.setdefault("best", {})
    rec.setdefault("plays", {})
    state["minigames"] = rec
    return rec


def best_score(state: dict, game: str) -> int:
    try:
        return int(records(state)["best"].get(game, 0) or 0)
    except (TypeError, ValueError):
        return 0


def record_result(state: dict, game: str, score: int, today: str | None = None) -> dict:
    """Store the result. Returns {'best': bool, 'good': bool, 'coins': int, 'happy': int, 'bond': int}."""
    rec = records(state)
    score = max(0, int(score))
    old = best_score(state, game)
    is_best = score > old
    if is_best:
        rec["best"][game] = score
    rec["plays"][game] = int(rec["plays"].get(game, 0) or 0) + 1
    good = score >= GOOD_SCORE.get(game, 10**9)
    coins = 0
    if good:
        today = today or date.today().isoformat()
        day, count = (rec.get("coin_days") or [None, 0])[:2]
        if day != today:
            count = 0
        if count < COIN_GAMES_PER_DAY:
            rec["coin_days"] = [today, int(count) + 1]
            coins = GAME_COINS
    happy = 10 if good else 5
    if is_best and score > 0:
        happy += 3
    return {"best": is_best and score > 0, "good": good, "coins": coins, "happy": happy, "bond": 2 if good else 1}


def apply_reward(pet, game: str, score: int) -> dict:
    """Record the result on the pet and let it react (happiness, bond, coins, a happy hop)."""
    result = record_result(pet.st, game, score)
    pet.st["games_played"] = int(pet.st.get("games_played", 0) or 0) + 1
    try:
        pet._bump("happiness", result["happy"])
        pet._bump("bond", result["bond"])
        pet._bump("energy", -2)
    except Exception:
        pass
    coins = result["coins"]
    if coins and getattr(pet, "shop", None) is not None:
        try:
            pet.shop.add_gift_coins(coins)
        except Exception:
            result["coins"] = 0
    elif coins:
        result["coins"] = 0
    try:
        if result["good"] or result["best"]:
            pet.set_action("love", 2.0)
            pet._spawn("heart", 4)
        else:
            pet.set_action("hop", 0.6)
        pet.save_state()
        pet._grow("game", announce_ms=4500)
    except Exception:
        pass
    return result


# =============================================================================
# Window
# =============================================================================
_window = None


def open_game(pet, game: str = "catch"):
    """Open (or switch) the game window."""
    global _window
    if game not in GAMES:
        game = "catch"
    if _window is not None and _window.alive():
        _window.load(game)
        _window.lift()
        return _window
    _window = GameWindow(pet, game)
    return _window


def _beep(freq, ms):
    def run():
        try:
            import winsound
            winsound.Beep(int(freq), int(ms))
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()


class GameWindow:
    BG = "#fff8ec"
    INK = "#2b2b2b"
    MUTED = "#7a7468"
    ACCENT = "#e8590c"
    PAD_COLOURS = (("#fa5252", "#ffc9c9"), ("#40c057", "#d3f9d8"), ("#228be6", "#d0ebff"), ("#fab005", "#fff3bf"))
    PAD_TONES = (330, 392, 494, 587)

    def __init__(self, pet, game):
        import pet as pet_mod  # late import (pet imports this module)

        self.pet = pet
        self.pet_mod = pet_mod
        self._alive = True
        self.game_key = game
        self.game = None
        self.state = "intro"            # intro | play | over
        self.result = None
        self.effects: list = []         # (x, y, text, colour, t0)
        self.flash = {}                 # simon pad -> until
        self.show_queue: list = []      # simon pattern playback
        self.input_ok = True
        self.memory_hide_at = 0.0
        self.keys = set()
        self._last = time.monotonic()
        self.win = tk.Toplevel(pet.root)
        self.win.configure(bg=self.BG)
        self.win.resizable(False, False)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        icon = pet.cb.get("icon_path") if hasattr(pet, "cb") else None
        if icon:
            try:
                self.win.iconbitmap(icon)
            except tk.TclError:
                pass
        top = tk.Frame(self.win, bg=self.BG, padx=10, pady=6)
        top.pack(fill="x")
        self.picker = {}
        for key in GAMES:
            btn = tk.Label(top, text=ICONS[key], font=("Segoe UI Emoji", 13), padx=6, cursor="hand2", bg=self.BG)
            btn.pack(side="left")
            btn.bind("<Button-1>", lambda e, k=key: self.load(k))
            self.picker[key] = btn
        self.hud = tk.Label(top, text="", font=("Segoe UI", 10, "bold"), fg=self.INK, bg=self.BG, anchor="e")
        self.hud.pack(side="right")
        self.cv = tk.Canvas(self.win, width=CW, height=CH, bg="#ffffff", highlightthickness=0)
        self.cv.pack(padx=10)
        foot = tk.Frame(self.win, bg=self.BG, padx=10, pady=6)
        foot.pack(fill="x")
        self.tip = tk.Label(foot, text="", font=("Segoe UI", 8), fg=self.MUTED, bg=self.BG, anchor="w",
                            justify="left", wraplength=CW - 120)
        self.tip.pack(side="left")
        close = tk.Label(foot, text=t("mg_close"), font=("Segoe UI", 9), fg="#ffffff", bg="#868e96", padx=10, pady=2,
                         cursor="hand2")
        close.pack(side="right")
        close.bind("<Button-1>", lambda e: self.close())
        self.cv.bind("<Button-1>", self._click)
        self.cv.bind("<Motion>", self._motion)
        self.win.bind("<KeyPress>", self._key_down)
        self.win.bind("<KeyRelease>", self._key_up)
        self.load(game)
        self._place()
        self.pet.root.after(16, self._tick)

    # ---- plumbing ----
    def alive(self) -> bool:
        return self._alive

    def lift(self):
        try:
            self.win.deiconify()
            self.win.lift()
            self.win.focus_force()
        except tk.TclError:
            pass

    def close(self):
        global _window
        self._alive = False
        if _window is self:
            _window = None
        try:
            self.win.destroy()
        except tk.TclError:
            pass

    def _place(self):
        try:
            self.win.update_idletasks()
            x = max(20, self.pet.root.winfo_screenwidth() // 2 - (CW + 20) // 2)
            self.win.geometry(f"+{x}+110")
            self.lift()
        except tk.TclError:
            pass

    def load(self, game):
        self.game_key = game if game in GAMES else "catch"
        self.state = "intro"
        self.game = None
        self.result = None
        self.effects = []
        self.flash = {}
        self.show_queue = []
        self.win.title(f"{ICONS[self.game_key]} {t('mg_' + self.game_key)}")
        for key, btn in self.picker.items():
            btn.config(bg="#ffd8a8" if key == self.game_key else self.BG)
        self.tip.config(text=t("mg_" + self.game_key + "_how"))

    def start(self):
        self.game = LOGIC[self.game_key]()
        self.state = "play"
        self.result = None
        self.effects = []
        self._last = time.monotonic()
        if self.game_key == "simon":
            self._play_pattern(delay=0.6)
        try:
            self.cv.focus_set()
        except tk.TclError:
            pass

    def finish(self):
        if self.state != "play":
            return
        self.state = "over"
        score = self.game.score
        try:
            self.result = apply_reward(self.pet, self.game_key, score)
        except Exception:
            self.result = {"best": False, "good": False, "coins": 0}
        self.result["score"] = score

    # ---- input ----
    def _key_down(self, event):
        key = event.keysym.lower()
        self.keys.add(key)
        if key in ("return", "space") and self.state != "play":
            self.start()
            return
        if self.state != "play":
            return
        if self.game_key == "hop" and key in ("space", "up", "w"):
            if self.game.jump() and self._sounds():
                _beep(660, 40)
        elif self.game_key == "simon" and key in ("1", "2", "3", "4"):
            self._simon_press(int(key) - 1)

    def _key_up(self, event):
        self.keys.discard(event.keysym.lower())

    def _motion(self, event):
        if self.state == "play" and self.game_key == "catch":
            self.game.move_to(event.x)

    def _click(self, event):
        if self.state != "play":
            if self._button_hit(event.x, event.y):
                self.start()
            return
        g = self.game
        if self.game_key == "hop":
            g.jump()
        elif self.game_key == "bonk":
            index = self._bonk_index(event.x, event.y)
            if index is not None:
                what = g.bonk(index)
                if what:
                    cx, cy = self._hole_xy(index)
                    text = {"bug": "+1", "gold": "+3", "flower": "-2"}[what]
                    colour = "#e03131" if what == "flower" else "#2f9e44"
                    self.effects.append((cx, cy - 40, text, colour, time.monotonic()))
        elif self.game_key == "memory":
            index = self._card_index(event.x, event.y)
            if index is not None and not self.memory_hide_at:
                what = g.flip(index)
                if what == "miss":
                    self.memory_hide_at = time.monotonic() + 0.75
                elif what == "match":
                    x, y = self._card_xy(index)
                    self.effects.append((x, y - 30, "\u2728", "#f59f00", time.monotonic()))
        elif self.game_key == "simon":
            pad = self._pad_index(event.x, event.y)
            if pad is not None:
                self._simon_press(pad)

    def _sounds(self) -> bool:
        try:
            return bool(self.pet.s.get("sounds", True))
        except Exception:
            return False

    # ---- simon helpers ----
    def _play_pattern(self, delay=0.5):
        now = time.monotonic() + delay
        self.show_queue = []
        for i, pad in enumerate(self.game.seq):
            self.show_queue.append((now + i * 0.6, pad))
        self.input_ok = False

    def _simon_press(self, pad):
        if not self.input_ok or self.game is None:
            return
        self.flash[pad] = time.monotonic() + 0.25
        if self._sounds():
            _beep(self.PAD_TONES[pad], 160)
        what = self.game.press(pad)
        if what == "round":
            self.effects.append((CW / 2, CH / 2, "\u2714", "#2f9e44", time.monotonic()))
            self._play_pattern(delay=0.8)
        elif what == "wrong":
            if self._sounds():
                _beep(180, 350)

    # ---- geometry ----
    def _hole_xy(self, index):
        col, row = index % 3, index // 3
        return 90 + col * 130, 95 + row * 95

    def _bonk_index(self, x, y):
        for i in range(BonkGame.HOLES):
            cx, cy = self._hole_xy(i)
            if abs(x - cx) < 50 and -60 < y - cy < 30:
                return i
        return None

    def _card_xy(self, index):
        col, row = index % 4, index // 4
        return 70 + col * 100, 50 + row * 80

    def _card_index(self, x, y):
        for i in range(16):
            cx, cy = self._card_xy(i)
            if abs(x - cx) < 42 and abs(y - cy) < 35:
                return i
        return None

    def _pad_rect(self, pad):
        col, row = pad % 2, pad // 2
        x0 = CW / 2 - 150 + col * 155
        y0 = 30 + row * 140
        return x0, y0, x0 + 145, y0 + 130

    def _pad_index(self, x, y):
        for pad in range(4):
            x0, y0, x1, y1 = self._pad_rect(pad)
            if x0 <= x <= x1 and y0 <= y <= y1:
                return pad
        return None

    def _button_hit(self, x, y):
        return abs(x - CW / 2) < 80 and abs(y - (CH - 70)) < 22

    # ---- loop ----
    def _tick(self):
        if not self._alive:
            return
        now = time.monotonic()
        dt = min(0.05, now - self._last)
        self._last = now
        if self.state == "play" and self.game is not None:
            g = self.game
            if self.game_key == "catch":
                if {"left", "a"} & self.keys:
                    g.nudge(-360 * dt)
                if {"right", "d"} & self.keys:
                    g.nudge(360 * dt)
            if self.game_key == "memory" and self.memory_hide_at and now >= self.memory_hide_at:
                g.hide_open()
                self.memory_hide_at = 0.0
            if self.game_key == "simon":
                while self.show_queue and self.show_queue[0][0] <= now:
                    _at, pad = self.show_queue.pop(0)
                    self.flash[pad] = now + 0.38
                    if self._sounds():
                        _beep(self.PAD_TONES[pad], 300)
                if not self.show_queue and not self.input_ok and not any(v > now for v in self.flash.values()):
                    self.input_ok = True
            g.step(dt)
            if self.game_key == "catch":
                for kind, x, y in g.events:
                    text = {"cookie": "+1", "fish": "+2", "star": "+5", "ouch": "\U0001F4A5"}[kind]
                    self.effects.append((x, y - 20, text, "#e03131" if kind == "ouch" else "#2f9e44", now))
                g.events.clear()
            if g.done:
                self.finish()
        try:
            self._draw(now)
        except tk.TclError:
            return
        self.pet.root.after(16 if self.state == "play" else 50, self._tick)

    # ---- drawing ----
    def _hud(self):
        best = best_score(self.pet.st, self.game_key)
        g = self.game
        parts = [t("mg_best", n=best)]
        if g is not None and self.state == "play":
            parts.insert(0, t("mg_score", n=g.score))
            if hasattr(g, "time_left"):
                parts.append(f"\u23f1 {int(math.ceil(g.time_left))}s")
            if hasattr(g, "lives"):
                parts.append("\u2764" * max(0, g.lives))
            if self.game_key == "memory":
                parts.append(t("mg_misses", n=g.misses))
        self.hud.config(text="   ".join(parts))

    def _draw_pet(self, x, floor, size, facing=1, extra=None):
        pet = self.pet
        look = {}
        social = getattr(pet, "social", None)
        try:
            if social is not None and hasattr(social, "my_look"):
                look = social.my_look() or {}
        except Exception:
            look = {}
        fighter = {"species": pet.s.get("species"), "color": pet.s.get("color"), "look": look}
        try:
            if pet_shop is not None:
                pet_shop.draw_fighter(self.cv, self.pet_mod, x, floor, size, fighter, facing=facing,
                                      t=time.monotonic(), look_extra=extra or {})
                return
        except Exception:
            pass
        self.cv.create_oval(x - size / 2, floor - size, x + size / 2, floor, fill=pet.s.get("color", "#ffc78f"),
                            outline="#555555")

    def _draw(self, now):
        cv = self.cv
        cv.delete("all")
        self._hud()
        getattr(self, "_draw_" + self.game_key)(now)
        keep = []
        for (x, y, text, colour, t0) in self.effects:
            age = now - t0
            if age < 0.9:
                keep.append((x, y, text, colour, t0))
                cv.create_text(x, y - age * 40, text=text, fill=colour, font=("Segoe UI Emoji", 14, "bold"))
        self.effects = keep
        if self.state == "intro":
            self._overlay(f"{ICONS[self.game_key]} {t('mg_' + self.game_key)}", t("mg_" + self.game_key + "_how"),
                          "\u25b6 " + t("mg_start"))
        elif self.state == "over" and self.result is not None:
            r = self.result
            lines = [t("mg_final", n=r.get("score", 0))]
            if r.get("best"):
                lines.append("\U0001F3C6 " + t("mg_new_best"))
            if r.get("coins"):
                lines.append(t("mg_coins", n=r["coins"]))
            lines.append(t("mg_pet_happy", name=self.pet.s.get("name", "Pips")))
            self._overlay(t("mg_over"), "\n".join(lines), "\u21bb " + t("mg_again"))

    def _overlay(self, title, body, button):
        cv = self.cv
        cv.create_rectangle(30, 40, CW - 30, CH - 30, fill="#ffffff", outline="#ffa94d", width=3)
        cv.create_text(CW / 2, 74, text=title, fill=self.ACCENT, font=("Segoe UI Emoji", 16, "bold"))
        cv.create_text(CW / 2, 150, text=body, fill=self.INK, font=("Segoe UI Emoji", 10), width=CW - 100,
                       justify="center")
        cv.create_rectangle(CW / 2 - 80, CH - 92, CW / 2 + 80, CH - 48, fill=self.ACCENT, outline="")
        cv.create_text(CW / 2, CH - 70, text=button, fill="#ffffff", font=("Segoe UI Symbol", 11, "bold"))

    def _draw_catch(self, now):
        cv = self.cv
        cv.create_rectangle(0, 0, CW, CH, fill="#d0ebff", outline="")
        for i in range(4):
            x = (i * 130 + now * 12) % (CW + 80) - 40
            cv.create_oval(x, 30 + i * 18, x + 70, 56 + i * 18, fill="#ffffff", outline="")
        cv.create_rectangle(0, CH - 30, CW, CH, fill="#8ce99a", outline="")
        g = self.game
        x = g.x if g else CW / 2
        if g:
            for item in g.items:
                symbol = {"cookie": "\U0001F36A", "fish": "\U0001F41F", "star": "\u2B50", "rock": "\U0001FAA8"}[item["kind"]]
                if item["kind"] == "rock":
                    cv.create_oval(item["x"] - 13, item["y"] - 11, item["x"] + 13, item["y"] + 11, fill="#868e96",
                                   outline="#495057", width=2)
                else:
                    cv.create_text(item["x"], item["y"], text=symbol, font=("Segoe UI Emoji", 18))
        self._draw_pet(x, CH - 26, 56, extra={"mouth": "big_open"} if g and g.items else None)

    def _draw_bonk(self, now):
        cv = self.cv
        cv.create_rectangle(0, 0, CW, CH, fill="#b2f2bb", outline="")
        g = self.game
        for i in range(BonkGame.HOLES):
            cx, cy = self._hole_xy(i)
            cv.create_oval(cx - 46, cy - 14, cx + 46, cy + 18, fill="#5c3d2e", outline="#3b2418", width=2)
            hole = g.holes[i] if g else None
            if hole:
                rise = min(1.0, (now * 6) % 1 + 0.6) if not hole["hit"] else 0.6
                symbol = {"bug": "\U0001F41E", "gold": "\U0001F41D", "flower": "\U0001F33C"}[hole["kind"]]
                cv.create_text(cx, cy - 18 * rise, text=symbol, font=("Segoe UI Emoji", 26))
                if hole["hit"]:
                    cv.create_text(cx, cy - 46, text="\U0001F4A5", font=("Segoe UI Emoji", 16))
            cv.create_arc(cx - 46, cy - 14, cx + 46, cy + 18, start=180, extent=180, style="arc", outline="#3b2418",
                          width=3)

    def _draw_memory(self, now):
        cv = self.cv
        cv.create_rectangle(0, 0, CW, CH, fill="#f3d9fa", outline="")
        g = self.game
        for i in range(16):
            x, y = self._card_xy(i)
            face_up = g is not None and (g.matched[i] or i in g.open)
            fill = "#ffffff" if face_up else "#9c36b5"
            if g is not None and g.matched[i]:
                fill = "#d3f9d8"
            cv.create_rectangle(x - 40, y - 33, x + 40, y + 33, fill=fill, outline="#862e9c", width=2)
            if face_up:
                cv.create_text(x, y, text=g.cards[i], font=("Segoe UI Emoji", 24))
            else:
                cv.create_text(x, y, text="?", fill="#f3d9fa", font=("Segoe UI", 20, "bold"))

    def _draw_simon(self, now):
        cv = self.cv
        cv.create_rectangle(0, 0, CW, CH, fill="#212529", outline="")
        for pad in range(4):
            x0, y0, x1, y1 = self._pad_rect(pad)
            lit = self.flash.get(pad, 0) > now
            dark, light = self.PAD_COLOURS[pad]
            cv.create_rectangle(x0, y0, x1, y1, fill=light if lit else dark, outline="#ffffff" if lit else "#343a40",
                                width=4)
            cv.create_text(x0 + 14, y0 + 14, text=str(pad + 1), fill="#ffffff", font=("Segoe UI", 10, "bold"))
        g = self.game
        if g is not None and self.state == "play":
            text = t("mg_simon_watch") if not self.input_ok else t("mg_simon_go", n=g.pos, total=len(g.seq))
            cv.create_text(CW / 2, CH - 22, text=text, fill="#ffffff", font=("Segoe UI", 10, "bold"))

    def _draw_hop(self, now):
        cv = self.cv
        cv.create_rectangle(0, 0, CW, CH, fill="#fff3bf", outline="")
        cv.create_oval(CW - 90, 20, CW - 40, 70, fill="#ffd43b", outline="")
        g = self.game
        shift = (g.distance if g else now * 100) * 0.3
        for i in range(5):
            x = (i * 120 - shift) % (CW + 120) - 60
            cv.create_polygon(x, HopGame.GROUND, x + 60, HopGame.GROUND - 70, x + 120, HopGame.GROUND,
                              fill="#ffe8cc", outline="")
        cv.create_rectangle(0, HopGame.GROUND, CW, CH, fill="#e9b872", outline="")
        if g:
            for ob in g.obstacles:
                x0, x1 = ob["x"], ob["x"] + ob["w"]
                top = HopGame.GROUND - ob["h"]
                colour = {"rock": "#868e96", "cactus": "#2f9e44", "log": "#8d5524"}[ob["kind"]]
                if ob["kind"] == "rock":
                    cv.create_oval(x0, top, x1, HopGame.GROUND + 4, fill=colour, outline="#495057", width=2)
                else:
                    cv.create_rectangle(x0, top, x1, HopGame.GROUND, fill=colour, outline="#2b2b2b", width=1)
        y = g.y if g else 0
        extra = {"eyes": "closed", "mouth": "wavy"} if g and g.done else None
        self._draw_pet(HopGame.PET_X, HopGame.GROUND - y, 50, extra=extra)
