"""
social.py - levels, achievements and Friends for Pips.

* Levels / XP / streak / achievements are computed locally from the pomodoro
  history (data/productivity.db) and the pet state - they work offline.
* Friends (opt-in, off by default) syncs a tiny public profile to the Pips
  Friends server (Cloudflare Worker + D1) so friends and teams can see each
  other's level, streak and pomodoro counts. Shared: display name, pet animal +
  colour, level, XP, streak, today's / this week's pomodoros and focus minutes,
  achievements, pet mood. Never: app names, window titles, scores, files.

Account (id + secret + friend code) lives in data/social.json on this PC.
All user-facing text comes from i18n.py.
"""

from __future__ import annotations

import json
import logging
import math
import os
import queue
import sqlite3
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    from i18n import t
except ImportError:  # pragma: no cover
    def t(key, lang=None, **kwargs):
        return key.format(**kwargs) if kwargs else key

logger = logging.getLogger("social")

API_URL = "https://pips-friends.juwenmondial.workers.dev"
SYNC_EVERY_S = 10 * 60
BOARD_EVERY_S = 15 * 60
ACH_CHECK_EVERY_S = 5 * 60
FRIEND_NEWS_GAP_S = 30 * 60

# (id, symbol, condition) - names/descriptions are i18n keys "ach_<id>"
ACHIEVEMENTS = [
    ("first_pom", "\u2605", lambda s: s["total_poms"] >= 1),
    ("poms_10", "\u2726", lambda s: s["total_poms"] >= 10),
    ("poms_50", "\u2742", lambda s: s["total_poms"] >= 50),
    ("poms_100", "\u2654", lambda s: s["total_poms"] >= 100),
    ("poms_250", "\u265b", lambda s: s["total_poms"] >= 250),
    ("day_4", "\u2618", lambda s: s["best_day_poms"] >= 4),
    ("day_8", "\u2600", lambda s: s["best_day_poms"] >= 8),
    ("streak_3", "\u2668", lambda s: s["best_streak"] >= 3),
    ("streak_7", "\u2604", lambda s: s["best_streak"] >= 7),
    ("streak_14", "\u269d", lambda s: s["best_streak"] >= 14),
    ("early_bird", "\u263c", lambda s: s["early_bird"]),
    ("night_owl", "\u263e", lambda s: s["night_owl"]),
    ("weekend", "\u2740", lambda s: s["weekend"]),
    ("level_5", "\u2691", lambda s: s["level"] >= 5),
    ("level_10", "\u269c", lambda s: s["level"] >= 10),
    ("pet_lover", "\u2665", lambda s: s["pets_total"] >= 50),
    ("tickler", "\u266a", lambda s: s["tickles_total"] >= 100),
    ("chef", "\u2615", lambda s: s["snacks_total"] >= 20),
    ("friend_1", "\u263a", lambda s: s["friends"] >= 1),
    ("team_1", "\u2691", lambda s: s["groups"] >= 1),
]
ACH_IDS = [a[0] for a in ACHIEVEMENTS]
ACH_SYMBOL = {a[0]: a[1] for a in ACHIEVEMENTS}


# =============================================================================
# Levels & stats (offline)
# =============================================================================

def xp_for_level(level: int) -> int:
    """Total XP needed to reach `level` (level 1 = 0 XP, 2 = 100, 3 = 300, 4 = 600...)."""
    return 50 * level * (level - 1)


def level_for_xp(xp: int) -> int:
    return max(1, int((1 + math.sqrt(1 + max(0, xp) / 12.5)) / 2))


def week_key(day: date) -> str:
    year, week, _ = day.isocalendar()
    return f"{year}-W{week:02d}"


def _parse(ts):
    try:
        return datetime.strptime(str(ts)[:19], "%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError):
        return None


def compute_stats(db_path, pet_state: dict | None = None, friends: int = 0, groups: int = 0,
                  today: date | None = None) -> dict:
    """Everything the level / achievement / Friends features need, from local data only."""
    today = today or date.today()
    pet_state = pet_state or {}
    per_day: dict[str, int] = {}
    minutes_day: dict[str, int] = {}
    early = night = weekend = False
    try:
        con = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True, timeout=2)
        try:
            rows = con.execute(
                "SELECT day, started_at, ended_at FROM sessions WHERE kind = 'work' AND completed = 1"
            ).fetchall()
        finally:
            con.close()
    except sqlite3.Error as exc:
        logger.debug("stats: no session data (%s)", exc)
        rows = []
    for day, started, ended in rows:
        day = str(day)
        per_day[day] = per_day.get(day, 0) + 1
        start_dt = _parse(started)
        end_dt = _parse(ended)
        minutes = 25
        if start_dt and end_dt:
            minutes = max(0, min(90, int((end_dt - start_dt).total_seconds() // 60)))
        minutes_day[day] = minutes_day.get(day, 0) + minutes
        stamp = end_dt or start_dt
        if stamp:
            if stamp.hour < 8:
                early = True
            if stamp.hour >= 22:
                night = True
            if stamp.weekday() >= 5:
                weekend = True

    total = sum(per_day.values())
    active_days = sorted(d for d, n in per_day.items() if n > 0)
    xp = 20 * total + 10 * len(active_days)
    level = level_for_xp(xp)

    # current streak: consecutive active days ending today (or yesterday if today is still empty)
    streak = 0
    cursor = today if per_day.get(today.isoformat()) else today - timedelta(days=1)
    while per_day.get(cursor.isoformat()):
        streak += 1
        cursor -= timedelta(days=1)
    best = run = 0
    previous = None
    for d in active_days:
        current = date.fromisoformat(d)
        run = run + 1 if previous and (current - previous).days == 1 else 1
        best = max(best, run)
        previous = current

    week = week_key(today)
    week_poms = week_minutes = 0
    for d, n in per_day.items():
        try:
            if week_key(date.fromisoformat(d)) == week:
                week_poms += n
                week_minutes += minutes_day.get(d, 0)
        except ValueError:
            continue
    stats = {
        "total_poms": total,
        "xp": xp,
        "level": level,
        "level_floor": xp_for_level(level),
        "level_next": xp_for_level(level + 1),
        "streak": streak,
        "best_streak": max(best, streak),
        "best_day_poms": max(per_day.values(), default=0),
        "day": today.isoformat(),
        "today_poms": per_day.get(today.isoformat(), 0),
        "today_minutes": minutes_day.get(today.isoformat(), 0),
        "week": week,
        "week_poms": week_poms,
        "week_minutes": week_minutes,
        "early_bird": early,
        "night_owl": night,
        "weekend": weekend,
        "pets_total": int(pet_state.get("pets_total", 0) or 0),
        "tickles_total": int(pet_state.get("tickles_total", 0) or 0),
        "snacks_total": int(pet_state.get("snacks_total", 0) or 0),
        "friends": friends,
        "groups": groups,
    }
    stats["achievements"] = [aid for aid, _sym, cond in ACHIEVEMENTS if cond(stats)]
    return stats


# =============================================================================
# Server client
# =============================================================================

class ApiError(Exception):
    def __init__(self, code: str, status: int = 0):
        super().__init__(code)
        self.code = code
        self.status = status


def api_call(method: str, path: str, body=None, account: dict | None = None, timeout=15) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API_URL + path, data=data, method=method)
    req.add_header("content-type", "application/json")
    req.add_header("user-agent", "Pips")
    if account:
        req.add_header("authorization", f"Bearer {account['id']}.{account['secret']}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        try:
            payload = json.loads(err.read().decode("utf-8"))
        except Exception:
            payload = {}
        raise ApiError(payload.get("error", "http_%d" % err.code), err.code) from None
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise ApiError("offline") from err


def default_display_name() -> str:
    raw = os.environ.get("USERNAME", "") or "Friend"
    first = raw.replace(".", "_").split("_")[0]
    return (first[:1].upper() + first[1:])[:24] or "Friend"


# =============================================================================
# Social controller (lives inside the DesktopPet)
# =============================================================================

class Social:
    def __init__(self, pet):
        self.pet = pet
        self.path = Path(pet.base_dir) / "data" / "social.json"
        self.db_path = Path(pet.base_dir) / "data" / "productivity.db"
        self.data = self._load()
        self.results: queue.Queue = queue.Queue()
        self.window = None
        self.board = None
        self.board_at = 0.0
        self.stats = None
        self.busy = False
        now = time.monotonic()
        self._next_ach = now + 20
        self._next_sync = now + 45
        self._next_board = now + 90
        self._last_news = 0.0

    # ---- persistence ----
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
            logger.warning("social: could not save %s: %s", self.path, exc)

    @property
    def enabled(self) -> bool:
        return bool(self.pet.s.get("friends", False)) and bool(self.data.get("id"))

    @property
    def account(self):
        if self.data.get("id") and self.data.get("secret"):
            return {"id": self.data["id"], "secret": self.data["secret"]}
        return None

    # ---- stats / achievements ----
    def refresh_stats(self) -> dict:
        board = self.board or {}
        self.stats = compute_stats(
            self.db_path, self.pet.st,
            friends=len(board.get("friends", [])) if self.enabled else 0,
            groups=len(self.data.get("groups", [])) if self.enabled else 0)
        return self.stats

    def check_achievements(self, announce=True) -> list:
        stats = self.refresh_stats()
        unlocked = self.data.setdefault("unlocked", {})
        first_run = not unlocked and not self.data.get("ach_seeded")
        new = [aid for aid in stats["achievements"] if aid not in unlocked]
        if new:
            stamp = date.today().isoformat()
            for aid in new:
                unlocked[aid] = stamp
            self.data["ach_seeded"] = True
            self.save()
            if announce and not first_run:
                aid = new[-1]
                more = len(new) - 1
                text = t("ach_unlocked", name=t("ach_" + aid).split(":")[0])
                if more:
                    text += t("ach_more", n=more)
                self.pet.set_action("love", 2.0)
                self.pet._spawn("sparkle", 5)
                self.pet._voice("happy")
                self.pet.say(text, duration=6, priority=2, on_click=self.open_window)
        elif not self.data.get("ach_seeded"):
            self.data["ach_seeded"] = True
            self.save()
        if self.window and self.window.alive():
            self.window.refresh()
        return new

    # ---- background work ----
    def _run(self, kind, fn, *args):
        def worker():
            try:
                result = fn(*args)
                self.results.put((kind, True, result))
            except ApiError as err:
                self.results.put((kind, False, err.code))
            except Exception as exc:  # pragma: no cover - defensive
                logger.exception("social worker failed")
                self.results.put((kind, False, str(exc)))
        threading.Thread(target=worker, daemon=True).start()

    def _profile_payload(self) -> dict:
        stats = self.stats or self.refresh_stats()
        unlocked = list(self.data.get("unlocked", {}).keys())
        return {
            "name": self.data.get("name") or default_display_name(),
            "species": self.pet.s.get("species", "cat"),
            "color": self.pet.s.get("color", "#ffc78f"),
            "level": stats["level"],
            "xp": stats["xp"],
            "streak": stats["streak"],
            "day": stats["day"],
            "today_poms": stats["today_poms"],
            "today_minutes": stats["today_minutes"],
            "week": stats["week"],
            "week_poms": stats["week_poms"],
            "week_minutes": stats["week_minutes"],
            "achievements": unlocked,
            "mood": self.pet.mood(),
        }

    def _sync_and_board(self, payload, account, day, week):
        api_call("POST", "/v1/profile", payload, account)
        return api_call("GET", f"/v1/board?day={day}&week={week}", None, account)

    def sync(self):
        if not self.enabled:
            return
        stats = self.refresh_stats()
        self._run("board", self._sync_and_board, self._profile_payload(), self.account,
                  stats["day"], stats["week"])

    def enable(self, name: str):
        name = (name or "").strip()[:24] or default_display_name()
        self.data["name"] = name
        self.save()
        self.pet.update_setting("friends", True)
        if self.data.get("id"):
            self.sync()
            return
        stats = self.refresh_stats()
        body = {"name": name, "species": self.pet.s.get("species", "cat"),
                "color": self.pet.s.get("color", "#ffc78f")}
        self.busy = True
        self._run("register", self._register_then_sync, body, stats)

    def _register_then_sync(self, body, stats):
        account = api_call("POST", "/v1/register", body)
        self.results.put(("account", True, account))
        acc = {"id": account["id"], "secret": account["secret"]}
        payload = dict(self._profile_payload())
        api_call("POST", "/v1/profile", payload, acc)
        return api_call("GET", f"/v1/board?day={stats['day']}&week={stats['week']}", None, acc)

    def disable_and_delete(self):
        account = self.account
        self.pet.update_setting("friends", False)
        self.board = None
        if account:
            self._run("deleted", api_call, "DELETE", "/v1/me", None, account)
        for key in ("id", "secret", "code", "groups"):
            self.data.pop(key, None)
        self.save()
        if self.window and self.window.alive():
            self.window.refresh()

    def add_friend(self, code: str):
        if self.enabled:
            self._run("friend_added", self._then_board, "POST", "/v1/friends/add",
                      {"code": code.strip().upper()})

    def remove_friend(self, code: str):
        if self.enabled:
            self._run("friend_removed", self._then_board, "POST", "/v1/friends/remove", {"code": code})

    def join_group(self, group: str):
        if self.enabled:
            self._run("group_joined", self._then_board, "POST", "/v1/groups/join", {"group": group})

    def leave_group(self, group: str):
        if self.enabled:
            self._run("group_left", self._then_board, "POST", "/v1/groups/leave", {"group": group})

    def _then_board(self, method, path, body):
        result = api_call(method, path, body, self.account)
        stats = self.stats or self.refresh_stats()
        board = api_call("GET", f"/v1/board?day={stats['day']}&week={stats['week']}", None, self.account)
        board["_result"] = result
        return board

    # ---- main-thread pump ----
    def poll(self):
        while True:
            try:
                kind, ok, payload = self.results.get_nowait()
            except queue.Empty:
                break
            self._handle(kind, ok, payload)

    def _handle(self, kind, ok, payload):
        if kind == "account":
            if ok:
                self.data.update({"id": payload["id"], "secret": payload["secret"], "code": payload["code"]})
                self.save()
            return
        if kind == "register":
            self.busy = False
        if not ok:
            if payload == "unauthorized" and kind != "deleted":
                logger.warning("social: account no longer valid - turning Friends off")
                for key in ("id", "secret", "code", "groups"):
                    self.data.pop(key, None)
                self.save()
                self.pet.update_setting("friends", False)
            if self.window and self.window.alive():
                self.window.show_error(payload)
            return
        if isinstance(payload, dict) and "friends" in payload:
            self._take_board(payload)
        if kind == "friend_added":
            friend = payload.get("_result", {}).get("friend", {})
            self.pet.set_action("cheer", 1.4)
            self.pet._voice("greet")
            self.pet.say(t("fr_added", name=friend.get("name", "?")), duration=4, priority=1)
            self.check_achievements()
        elif kind == "group_joined":
            self.check_achievements()
        if self.window and self.window.alive():
            self.window.refresh()

    def _take_board(self, board):
        if not self.enabled:
            return  # a late reply after Friends was turned off
        old = {f["code"]: f for f in (self.board or {}).get("friends", [])}
        self.board = board
        self.board_at = time.time()
        self.data["code"] = board.get("me", {}).get("code", self.data.get("code"))
        self.data["groups"] = [g["code"] for g in board.get("groups", [])]
        self.save()
        # friendly news: a friend finished more pomodoros since the last look
        if old and self.pet.s.get("chatty", True) and time.monotonic() - self._last_news > FRIEND_NEWS_GAP_S:
            for friend in board.get("friends", []):
                before = old.get(friend["code"])
                if before and friend["today_poms"] > before["today_poms"]:
                    self._last_news = time.monotonic()
                    self.pet.say(t("fr_news", name=friend["name"], n=friend["today_poms"]),
                                 duration=5, priority=0, on_click=self.open_window)
                    break

    def tick(self, now: float):
        self.poll()
        if now >= self._next_ach:
            self._next_ach = now + ACH_CHECK_EVERY_S
            try:
                self.check_achievements()
            except Exception:
                logger.exception("achievement check failed")
        if self.enabled and now >= self._next_sync:
            self._next_sync = now + SYNC_EVERY_S
            self._next_board = now + BOARD_EVERY_S
            self.sync()
        elif self.enabled and now >= self._next_board:
            self._next_board = now + BOARD_EVERY_S
            self.sync()

    def on_pomodoro(self):
        try:
            self.check_achievements()
        except Exception:
            logger.exception("achievement check failed")
        if self.enabled:
            self._next_sync = time.monotonic() + SYNC_EVERY_S
            self.sync()

    # ---- window ----
    def open_window(self):
        if self.window and self.window.alive():
            self.window.win.deiconify()
            self.window.win.lift()
            self.window.refresh()
        else:
            self.window = FriendsWindow(self)
        if self.enabled and time.time() - self.board_at > 30:
            self.sync()

    def close(self):
        if self.window and self.window.alive():
            self.window.close()


# =============================================================================
# Friends & achievements window
# =============================================================================

class FriendsWindow:
    BG = "#faf8f3"
    CARD = "#ffffff"
    INK = "#1a1a1a"
    MUTED = "#6b6b6b"
    BORDER = "#e2ddd4"
    ACCENT = "#8b1a1a"
    GOLD = "#c8961e"
    WIDTH = 440

    def __init__(self, social: Social):
        import pet as pet_mod  # late import: pet imports social

        self.pet_mod = pet_mod
        self.social = social
        self.pet = social.pet
        self.tab = "friends"
        self._alive = True
        self.error = ""
        self.win = tk.Toplevel(self.pet.root)
        self.win.title(t("fr_title"))
        self.win.configure(bg=self.BG)
        self.win.resizable(False, True)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        icon = self.pet.cb.get("icon_path") if hasattr(self.pet, "cb") else None
        if icon:
            try:
                self.win.iconbitmap(icon)
            except tk.TclError:
                pass
        self.outer = tk.Frame(self.win, bg=self.BG, padx=14, pady=12)
        self.outer.pack(fill="both", expand=True)
        self.head = tk.Frame(self.outer, bg=self.CARD, highlightthickness=1, highlightbackground=self.BORDER)
        self.head.pack(fill="x")
        tabs = tk.Frame(self.outer, bg=self.BG)
        tabs.pack(fill="x", pady=(10, 6))
        self.tab_buttons = {}
        for key in ("friends", "teams", "achievements"):
            btn = tk.Label(tabs, text=t("fr_tab_" + key), font=("Segoe UI", 9, "bold"), padx=12, pady=4,
                           cursor="hand2")
            btn.pack(side="left", padx=(0, 4))
            btn.bind("<Button-1>", lambda e, k=key: self.show_tab(k))
            self.tab_buttons[key] = btn
        self.body = tk.Frame(self.outer, bg=self.CARD, highlightthickness=1, highlightbackground=self.BORDER,
                             padx=12, pady=10)
        self.body.pack(fill="both", expand=True)
        self.status = tk.Label(self.outer, text="", font=("Segoe UI", 8), fg=self.MUTED, bg=self.BG,
                               anchor="w", wraplength=self.WIDTH - 20, justify="left")
        self.status.pack(fill="x", pady=(6, 0))
        self.win.geometry(f"{self.WIDTH}x760")
        self._place()
        self.refresh()
        self.win.after(1000, self._pump)

    # ---- helpers ----
    def alive(self) -> bool:
        return self._alive

    def close(self):
        self._alive = False
        try:
            self.win.destroy()
        except tk.TclError:
            pass

    def _place(self):
        try:
            self.win.update_idletasks()
            x = max(20, self.pet.root.winfo_screenwidth() // 2 - self.WIDTH // 2)
            self.win.geometry(f"+{x}+80")
        except tk.TclError:
            pass

    def _pump(self):
        if not self._alive:
            return
        self.social.poll()
        self.win.after(400, self._pump)

    def _button(self, parent, text, command, primary=False):
        btn = tk.Label(parent, text=text, font=("Segoe UI", 9, "bold" if primary else "normal"),
                       fg="#ffffff" if primary else self.INK, bg=self.ACCENT if primary else "#f1ece4",
                       padx=10, pady=3, cursor="hand2")
        btn.bind("<Button-1>", lambda e: command())
        return btn

    def _avatar(self, parent, species, color, size=34, bg=None):
        cv = tk.Canvas(parent, width=size, height=size, bg=bg or self.CARD, highlightthickness=0)
        try:
            look = self.pet_mod.default_look({"species": species if species in self.pet_mod.SPECIES else "cat",
                                              "color": color or "#ffc78f",
                                              "cheek_color": "#ff8fa3"})
            look["t"] = time.monotonic()
            look["mouth"] = "smile"
            self.pet_mod.draw_pet(cv, size / 2, size - 2, size * 0.62, look)
        except Exception:
            cv.create_oval(4, 4, size - 4, size - 4, fill=color or "#ffc78f", outline="")
        return cv

    def show_error(self, code):
        messages = {"offline": t("fr_err_offline"), "not_found": t("fr_err_not_found"),
                    "self": t("fr_err_self"), "bad_code": t("fr_err_bad_code"),
                    "too_many": t("fr_err_too_many"), "bad_group": t("fr_err_bad_group")}
        self.error = messages.get(code, t("fr_err_generic", code=code))
        self.refresh()

    def show_tab(self, key):
        self.tab = key
        self.error = ""
        self.refresh()

    # ---- rendering ----
    def refresh(self):
        if not self._alive:
            return
        stats = self.social.stats or self.social.refresh_stats()
        for child in self.head.winfo_children():
            child.destroy()
        for child in self.body.winfo_children():
            child.destroy()
        for key, btn in self.tab_buttons.items():
            active = key == self.tab
            btn.config(bg=self.ACCENT if active else "#f1ece4", fg="#ffffff" if active else self.INK)
        self._render_head(stats)
        if self.tab == "achievements":
            self._render_achievements()
        elif not self.social.enabled:
            self._render_off()
        elif self.tab == "teams":
            self._render_teams()
        else:
            self._render_friends()
        if self.error:
            self.status.config(text=self.error, fg=self.ACCENT)
        elif self.social.busy:
            self.status.config(text=t("fr_connecting"), fg=self.MUTED)
        elif self.social.enabled and self.social.board_at:
            stamp = datetime.fromtimestamp(self.social.board_at).strftime("%H:%M")
            self.status.config(text=t("fr_updated", time=stamp), fg=self.MUTED)
        else:
            self.status.config(text=t("fr_privacy_short"), fg=self.MUTED)

    def _render_head(self, stats):
        row = tk.Frame(self.head, bg=self.CARD, padx=10, pady=8)
        row.pack(fill="x")
        self._avatar(row, self.pet.s.get("species"), self.pet.s.get("color"), size=52).pack(side="left")
        info = tk.Frame(row, bg=self.CARD)
        info.pack(side="left", fill="x", expand=True, padx=(10, 0))
        name = self.social.data.get("name") or default_display_name()
        tk.Label(info, text=f"{name} & {self.pet.s.get('name', 'Pip')}", font=("Segoe UI", 11, "bold"),
                 fg=self.INK, bg=self.CARD, anchor="w").pack(fill="x")
        tk.Label(info, text=t("fr_level_line", level=stats["level"], xp=stats["xp"]),
                 font=("Segoe UI", 9), fg=self.ACCENT, bg=self.CARD, anchor="w").pack(fill="x")
        bar = tk.Canvas(info, width=220, height=8, bg=self.CARD, highlightthickness=0)
        bar.pack(anchor="w", pady=(2, 2))
        span = max(1, stats["level_next"] - stats["level_floor"])
        frac = max(0.0, min(1.0, (stats["xp"] - stats["level_floor"]) / span))
        bar.create_rectangle(0, 0, 220, 8, fill="#eeeae3", outline="")
        bar.create_rectangle(0, 0, max(3, 220 * frac), 8, fill=self.GOLD, outline="")
        tk.Label(info, text=t("fr_stats_line", today=stats["today_poms"], week=stats["week_poms"],
                              streak=stats["streak"]),
                 font=("Segoe UI", 8), fg=self.MUTED, bg=self.CARD, anchor="w").pack(fill="x")

    def _render_off(self):
        tk.Label(self.body, text=t("fr_off_title"), font=("Segoe UI", 11, "bold"), fg=self.INK,
                 bg=self.CARD, anchor="w").pack(fill="x")
        tk.Label(self.body, text=t("fr_off_body"), font=("Segoe UI", 9), fg=self.INK, bg=self.CARD,
                 justify="left", anchor="w", wraplength=self.WIDTH - 60).pack(fill="x", pady=(4, 6))
        tk.Label(self.body, text=t("fr_shared"), font=("Segoe UI", 9), fg=self.MUTED, bg=self.CARD,
                 justify="left", anchor="w", wraplength=self.WIDTH - 60).pack(fill="x", pady=(0, 10))
        row = tk.Frame(self.body, bg=self.CARD)
        row.pack(fill="x")
        tk.Label(row, text=t("fr_your_name"), font=("Segoe UI", 9), fg=self.INK, bg=self.CARD).pack(side="left")
        self.name_var = tk.StringVar(value=self.social.data.get("name") or default_display_name())
        tk.Entry(row, textvariable=self.name_var, width=18, font=("Segoe UI", 10)).pack(side="left", padx=6)
        self._button(self.body, t("fr_turn_on"), lambda: self._enable(), primary=True).pack(anchor="w",
                                                                                              pady=(10, 0))

    def _enable(self):
        self.error = ""
        self.social.enable(self.name_var.get())
        self.refresh()

    def _ranked_row(self, parent, rank, person, value_text, is_me=False, on_remove=None):
        bg = "#fbf3e6" if is_me else self.CARD
        row = tk.Frame(parent, bg=bg, pady=2)
        row.pack(fill="x")
        tk.Label(row, text=str(rank), width=2, font=("Segoe UI", 10, "bold"),
                 fg=self.GOLD if rank <= 3 else self.MUTED, bg=bg).pack(side="left")
        self._avatar(row, person.get("species"), person.get("color"), size=34, bg=bg).pack(side="left",
                                                                                           padx=(2, 6))
        info = tk.Frame(row, bg=bg)
        info.pack(side="left", fill="x", expand=True)
        name = person.get("name", "?") + ("  " + t("fr_you") if is_me else "")
        tk.Label(info, text=name, font=("Segoe UI", 10, "bold" if is_me else "normal"), fg=self.INK,
                 bg=bg, anchor="w").pack(fill="x")
        tk.Label(info, text=t("fr_row_line", level=person.get("level", 1), streak=person.get("streak", 0),
                              n=len(person.get("achievements", []))),
                 font=("Segoe UI", 8), fg=self.MUTED, bg=bg, anchor="w").pack(fill="x")
        tk.Label(row, text=value_text, font=("Segoe UI", 10, "bold"), fg=self.ACCENT, bg=bg).pack(side="left",
                                                                                                padx=6)
        if on_remove:
            x = tk.Label(row, text="\u00d7", font=("Segoe UI", 11), fg=self.MUTED, bg=bg, cursor="hand2")
            x.pack(side="left")
            x.bind("<Button-1>", lambda e: on_remove())

    def _render_friends(self):
        board = self.social.board or {}
        code = self.social.data.get("code", "------")
        top = tk.Frame(self.body, bg=self.CARD)
        top.pack(fill="x")
        tk.Label(top, text=t("fr_your_code"), font=("Segoe UI", 9), fg=self.MUTED, bg=self.CARD).pack(side="left")
        tk.Label(top, text=code, font=("Consolas", 14, "bold"), fg=self.ACCENT, bg=self.CARD).pack(side="left",
                                                                                                padx=6)
        self._button(top, t("fr_copy"), lambda: self._copy(code)).pack(side="left")
        add = tk.Frame(self.body, bg=self.CARD)
        add.pack(fill="x", pady=(8, 8))
        self.code_var = tk.StringVar()
        entry = tk.Entry(add, textvariable=self.code_var, width=10, font=("Consolas", 12))
        entry.pack(side="left")
        entry.bind("<Return>", lambda e: self._add())
        self._button(add, t("fr_add"), self._add, primary=True).pack(side="left", padx=6)
        tk.Label(add, text=t("fr_add_hint"), font=("Segoe UI", 8), fg=self.MUTED, bg=self.CARD,
                 wraplength=170, justify="left").pack(side="left")
        tk.Label(self.body, text=t("fr_today_board"), font=("Segoe UI", 9, "bold"), fg=self.INK, bg=self.CARD,
                 anchor="w").pack(fill="x", pady=(4, 2))
        people = [dict(board.get("me", {}), _me=True)] if board.get("me") else []
        people += board.get("friends", [])
        if len(people) <= 1:
            tk.Label(self.body, text=t("fr_no_friends"), font=("Segoe UI", 9), fg=self.MUTED, bg=self.CARD,
                     wraplength=self.WIDTH - 60, justify="left", anchor="w").pack(fill="x", pady=(0, 6))
        people.sort(key=lambda p: (-p.get("today_poms", 0), -p.get("week_poms", 0), p.get("name", "")))
        for rank, person in enumerate(people[:30], 1):
            value = t("fr_poms_value", today=person.get("today_poms", 0), week=person.get("week_poms", 0))
            remove = None
            if not person.get("_me"):
                remove = lambda c=person["code"], n=person.get("name", ""): self._remove(c, n)
            self._ranked_row(self.body, rank, person, value, is_me=person.get("_me", False), on_remove=remove)
        self._button(self.body, t("fr_turn_off"), self._disable).pack(anchor="e", pady=(10, 0))

    def _render_teams(self):
        board = self.social.board or {}
        row = tk.Frame(self.body, bg=self.CARD)
        row.pack(fill="x")
        tk.Label(row, text=t("fr_team_code"), font=("Segoe UI", 9), fg=self.INK, bg=self.CARD).pack(side="left")
        self.group_var = tk.StringVar()
        entry = tk.Entry(row, textvariable=self.group_var, width=10, font=("Consolas", 12))
        entry.pack(side="left", padx=6)
        entry.bind("<Return>", lambda e: self._join())
        self._button(row, t("fr_join"), self._join, primary=True).pack(side="left")
        tk.Label(self.body, text=t("fr_team_hint"), font=("Segoe UI", 8), fg=self.MUTED, bg=self.CARD,
                 wraplength=self.WIDTH - 60, justify="left", anchor="w").pack(fill="x", pady=(4, 6))
        groups = board.get("groups", [])
        if not groups:
            tk.Label(self.body, text=t("fr_no_teams"), font=("Segoe UI", 9), fg=self.MUTED, bg=self.CARD,
                     anchor="w").pack(fill="x")
        for group in groups:
            head = tk.Frame(self.body, bg=self.CARD)
            head.pack(fill="x", pady=(8, 2))
            members = sorted(group.get("members", []),
                             key=lambda p: (-p.get("week_poms", 0), -p.get("today_poms", 0), p.get("name", "")))
            tk.Label(head, text=t("fr_team_head", team=group["code"], n=len(members)),
                     font=("Segoe UI", 10, "bold"), fg=self.INK, bg=self.CARD).pack(side="left")
            leave = tk.Label(head, text=t("fr_leave"), font=("Segoe UI", 8, "underline"), fg=self.MUTED,
                             bg=self.CARD, cursor="hand2")
            leave.pack(side="right")
            leave.bind("<Button-1>", lambda e, g=group["code"]: self.social.leave_group(g))
            for rank, person in enumerate(members[:15], 1):
                value = t("fr_week_value", n=person.get("week_poms", 0))
                self._ranked_row(self.body, rank, person, value, is_me=person.get("me", False))

    def _render_achievements(self):
        unlocked = self.social.data.get("unlocked", {})
        tk.Label(self.body, text=t("fr_ach_count", n=len(unlocked), total=len(ACH_IDS)),
                 font=("Segoe UI", 9, "bold"), fg=self.INK, bg=self.CARD, anchor="w").pack(fill="x",
                                                                                           pady=(0, 6))
        grid = tk.Frame(self.body, bg=self.CARD)
        grid.pack(fill="both", expand=True)
        for i, aid in enumerate(ACH_IDS):
            got = aid in unlocked
            cell = tk.Frame(grid, bg="#fbf3e6" if got else "#f4f2ee", padx=6, pady=2)
            cell.grid(row=i // 2, column=i % 2, sticky="nsew", padx=2, pady=2)
            tk.Label(cell, text=ACH_SYMBOL[aid], font=("Segoe UI Symbol", 14),
                     fg=self.GOLD if got else "#c9c4bb", bg=cell["bg"]).pack(side="left")
            name, _, desc = t("ach_" + aid).partition(":")
            box = tk.Frame(cell, bg=cell["bg"])
            box.pack(side="left", fill="x", padx=(4, 0))
            tk.Label(box, text=name.strip(), font=("Segoe UI", 9, "bold"),
                     fg=self.INK if got else "#9a958c", bg=cell["bg"], anchor="w").pack(fill="x")
            tk.Label(box, text=desc.strip(), font=("Segoe UI", 8), fg=self.MUTED, bg=cell["bg"],
                     anchor="w", wraplength=150, justify="left").pack(fill="x")
        grid.grid_columnconfigure(0, weight=1, uniform="a")
        grid.grid_columnconfigure(1, weight=1, uniform="a")

    # ---- actions ----
    def _copy(self, code):
        try:
            self.win.clipboard_clear()
            self.win.clipboard_append(code)
            self.status.config(text=t("fr_copied"), fg=self.MUTED)
        except tk.TclError:
            pass

    def _add(self):
        code = "".join(ch for ch in self.code_var.get().upper() if ch.isalnum())
        if len(code) != 6:
            self.show_error("bad_code")
            return
        self.error = ""
        self.social.add_friend(code)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    def _remove(self, code, name):
        from tkinter import messagebox
        if messagebox.askyesno(t("fr_title"), t("fr_remove_q", name=name), parent=self.win):
            self.social.remove_friend(code)

    def _join(self):
        group = "".join(ch for ch in self.group_var.get().upper() if ch.isalnum() or ch in "-_")
        if len(group) < 2:
            self.show_error("bad_group")
            return
        self.error = ""
        self.social.join_group(group)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    def _disable(self):
        from tkinter import messagebox
        if messagebox.askyesno(t("fr_title"), t("fr_turn_off_q"), parent=self.win):
            self.social.disable_and_delete()
