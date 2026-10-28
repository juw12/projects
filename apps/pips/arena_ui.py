"""
arena_ui.py - the Pips Arena battle window (live duels, quick battles and spectating).

The server resolves every round (see cloud/src/index.js, v7). This window only
polls /v1/duel, sends your action (attack / guard / special) and animates the
round events: shots and lunges, damage numbers, blocks, dodges, heals and the
final result. All user-facing text comes from i18n.py.
"""

from __future__ import annotations

import math
import time
import tkinter as tk
from tkinter import messagebox

import pet_shop

try:
    from i18n import t
except ImportError:  # pragma: no cover
    def t(key, lang=None, **kwargs):
        return key.format(**kwargs) if kwargs else key

W, H = 640, 330
FLOOR = 292
SIZE = 104
LEFT_X, RIGHT_X = 175, 465
EVENT_S = 0.95          # seconds per animated round event
POLL_MS = 1000

SPECIAL_SYMBOL = {"power": "\u2726", "heal": "\u271a", "bomb": "\u25cf", "dodge": "\u27b6", "shield": "\u25ce"}


class DuelWindow:
    def __init__(self, soc, duel_id: str, spectate: bool = False):
        import pet as pet_mod  # late import: pet imports social

        self.soc = soc
        self.pet_mod = pet_mod
        self.duel_id = duel_id
        self.spectate = spectate
        self._alive = True
        self.state = None
        self.offset = 0.0              # server clock - local clock
        self.shown = 0                 # log events already animated
        self.queue: list = []
        self.anim = None               # {"ev": ..., "t0": ...}
        self.disp_hp = {"a": None, "b": None}
        self.floaters: list = []       # (x, y, text, colour, t0, big)
        self.acted_round = 0
        self._poll_busy = False
        self.win = tk.Toplevel(soc.pet.root)
        self.win.title(t("arena_title"))
        self.win.configure(bg="#1d1b2e")
        self.win.resizable(False, False)
        self.win.protocol("WM_DELETE_WINDOW", self.close)
        icon = soc.pet.cb.get("icon_path") if hasattr(soc.pet, "cb") else None
        if icon:
            try:
                self.win.iconbitmap(icon)
            except tk.TclError:
                pass
        self.cv = tk.Canvas(self.win, width=W, height=H, bg="#1d1b2e", highlightthickness=0)
        self.cv.pack()
        bar = tk.Frame(self.win, bg="#1d1b2e", padx=10, pady=6)
        bar.pack(fill="x")
        self.info = tk.Label(bar, text="", font=("Segoe UI", 10, "bold"), fg="#ffd43b", bg="#1d1b2e", anchor="w")
        self.info.pack(side="left")
        self.btns = {}
        for key in ("special", "guard", "attack"):
            btn = tk.Label(bar, text="", font=("Segoe UI Symbol", 10, "bold"), padx=12, pady=5, cursor="hand2")
            btn.pack(side="right", padx=(6, 0))
            btn.bind("<Button-1>", lambda e, k=key: self._act(k))
            self.btns[key] = btn
        bottom = tk.Frame(self.win, bg="#1d1b2e", padx=10)
        bottom.pack(fill="x", pady=(0, 8))
        self.log_lbl = tk.Label(bottom, text="", font=("Segoe UI", 8), fg="#c9c4e8", bg="#1d1b2e", anchor="w",
                                justify="left")
        self.log_lbl.pack(side="left", fill="x", expand=True)
        self.extra = tk.Frame(bottom, bg="#1d1b2e")
        self.extra.pack(side="right")
        self._place()
        cached = soc.duels.get(duel_id)
        if cached:
            self._take(cached, initial=True)
        soc.load_duel(duel_id)
        self.win.after(33, self._frame)
        self.win.after(POLL_MS, self._poll)

    # ---- window plumbing ----
    def alive(self) -> bool:
        return self._alive

    def close(self):
        self._alive = False
        self.soc.duel_windows.pop(self.duel_id, None)
        try:
            self.win.destroy()
        except tk.TclError:
            pass

    def _place(self):
        try:
            self.win.update_idletasks()
            x = max(20, self.soc.pet.root.winfo_screenwidth() // 2 - W // 2)
            self.win.geometry(f"+{x}+120")
            self.win.lift()
            self.win.attributes("-topmost", True)
            self.win.after(600, lambda: self.win.attributes("-topmost", False))
        except tk.TclError:
            pass

    # ---- data ----
    def update_state(self):
        duel = self.soc.duels.get(self.duel_id)
        self._poll_busy = False
        if duel:
            self._take(duel)

    def _take(self, duel, initial=False):
        first = self.state is None
        self.state = duel
        self.offset = duel.get("now", time.time()) - time.time()
        log = duel.get("log", [])
        if first:
            catch_up = duel.get("mode") != "quick" and len(log) > 2
            if catch_up:
                self.shown = len(log)
                self.disp_hp = {"a": duel["a"].get("hp_now"), "b": duel["b"].get("hp_now")}
            else:
                self.disp_hp = {"a": duel["a"].get("hp"), "b": duel["b"].get("hp")}
        if len(log) > self.shown:
            self.queue.extend(log[self.shown:])
            self.shown = len(log)
        self._refresh_controls()

    def _poll(self):
        if not self._alive:
            return
        state = self.state or {}
        if state.get("status") in ("active", "pending") or not state:
            if not self._poll_busy:
                self._poll_busy = True
                self.soc.load_duel(self.duel_id)
                self.win.after(4000, self._unstick)
        self.win.after(POLL_MS, self._poll)

    def _unstick(self):
        self._poll_busy = False

    @property
    def mine(self):
        return None if self.spectate else (self.state or {}).get("mine")

    # ---- actions ----
    def _act(self, action):
        st = self.state or {}
        side = self.mine
        if not side or st.get("status") != "active" or self.acted_round == st.get("round"):
            return
        me = st.get(side, {})
        if me.get("acted"):
            return
        if action == "special" and me.get("charge", 0) < st.get("special_cost", 3):
            return
        self.acted_round = st.get("round")
        self.soc.duel_act(self.duel_id, st.get("round"), action)
        self.soc.pet.set_action("hop", 0.4)
        self._refresh_controls()

    def _forfeit(self):
        if messagebox.askyesno(t("arena_title"), t("duel_forfeit_q"), parent=self.win):
            self.soc.forfeit_duel(self.duel_id)
            self.win.after(800, lambda: self.soc.load_duel(self.duel_id))

    def _rematch(self):
        st = self.state or {}
        side = self.mine or "a"
        other = st.get("b" if side == "a" else "a", {})
        code = other.get("code")
        if not code:
            return
        if st.get("mode") == "quick":
            self.soc.quick_duel(code)
        else:
            self.soc.challenge(code)
        self.close()

    def _button_style(self, btn, text, enabled, colour):
        btn.config(text=text, bg=colour if enabled else "#3a3752", fg="#ffffff" if enabled else "#77729a",
                   cursor="hand2" if enabled else "arrow")

    def _refresh_controls(self):
        st = self.state or {}
        side = self.mine
        status = st.get("status")
        live_turn = side and status == "active"
        me = st.get(side, {}) if side else {}
        waiting = live_turn and (me.get("acted") or self.acted_round == st.get("round"))
        special = me.get("special") or "power"
        can_special = live_turn and not waiting and me.get("charge", 0) >= st.get("special_cost", 3)
        self._button_style(self.btns["attack"], "\u2694 " + t("duel_attack"), live_turn and not waiting, "#e03131")
        self._button_style(self.btns["guard"], "\u26e8 " + t("duel_guard"), live_turn and not waiting, "#1c7ed6")
        self._button_style(self.btns["special"], SPECIAL_SYMBOL.get(special, "\u2726") + " " + t("duel_sp_" + special),
                           can_special, "#9c36b5")
        for btn in self.btns.values():
            if not side or status == "done":
                btn.pack_forget()
        for child in self.extra.winfo_children():
            child.destroy()
        if status == "done" and not self.queue and not self.anim:
            if side:
                self._small_button(self.extra, "\u21bb " + t("duel_rematch"), self._rematch, "#2f9e44")
            self._small_button(self.extra, t("duel_close"), self.close, "#495057")
        elif live_turn:
            self._small_button(self.extra, t("duel_forfeit"), self._forfeit, "#495057")

    def _small_button(self, parent, text, command, colour):
        btn = tk.Label(parent, text=text, font=("Segoe UI", 8, "bold"), fg="#ffffff", bg=colour, padx=8, pady=3,
                       cursor="hand2")
        btn.pack(side="left", padx=(4, 0))
        btn.bind("<Button-1>", lambda e: command())

    # ---- animation ----
    def _frame(self):
        if not self._alive:
            return
        now = time.monotonic()
        if self.anim and now - self.anim["t0"] >= EVENT_S:
            self._finish_event(self.anim["ev"])
            self.anim = None
            if not self.queue:
                self._refresh_controls()
        if not self.anim and self.queue:
            ev = self.queue.pop(0)
            self.anim = {"ev": ev, "t0": now}
            self._start_event(ev)
        try:
            self._draw(now)
            self._update_info()
        except tk.TclError:
            return
        self.win.after(33, self._frame)

    def _pos(self, side):
        return LEFT_X if side == "a" else RIGHT_X

    def _float(self, side, text, colour, big=False, dy=0):
        now = time.monotonic()
        x = self._pos(side)
        base_x = self._pos(side)
        stacked = sum(1 for f in self.floaters if abs(f[0] - base_x) < 120 and now - f[4] < 1.0)
        toward_centre = 1 if side == "a" else -1
        x = base_x + toward_centre * 70 * stacked
        self.floaters.append((x, FLOOR - SIZE * 1.2 + dy + stacked * 16, text, colour, now, big))

    def _start_event(self, ev):
        s = ev.get("s")
        act = ev.get("act")
        if act in ("afk", "forfeit"):
            self._float(s, t("duel_afk") if act == "afk" else t("duel_gave_up"), "#adb5bd", True)
        elif act == "guard":
            self._float(s, "\u26e8 " + t("duel_guard"), "#74c0fc")
        elif ev.get("special"):
            self._float(s, SPECIAL_SYMBOL.get(ev["special"], "\u2726") + " " + t("duel_sp_" + ev["special"]), "#e599f7",
                        False, -18)

    def _finish_event(self, ev):
        s = ev.get("s")
        o = "b" if s == "a" else "a"
        if ev.get("heal"):
            self._float(s, f"+{ev['heal']}", "#69db7c", True)
            self.disp_hp[s] = min((self.state or {}).get(s, {}).get("hp", 9999), (self.disp_hp[s] or 0) + ev["heal"])
        if ev.get("act") in ("attack", "special"):
            if ev.get("shield"):
                self._float(o, "\u25ce " + t("duel_shielded"), "#d0bfff")
            elif ev.get("dodge"):
                self._float(o, t("duel_miss"), "#ced4da")
            elif ev.get("dmg") is not None:
                if ev.get("crit"):
                    self._float(o, t("duel_crit") + f" -{ev['dmg']}", "#ffd43b", True)
                elif ev.get("blocked"):
                    self._float(o, t("duel_block") + f" -{ev['dmg']}", "#74c0fc")
                else:
                    self._float(o, f"-{ev['dmg']}", "#ff6b6b", True)
        if "hp_a" in ev:
            self.disp_hp["a"] = ev["hp_a"]
            self.disp_hp["b"] = ev["hp_b"]
        self.soc.pet.set_action("hop", 0.3) if ev.get("crit") else None

    def _update_info(self):
        st = self.state or {}
        status = st.get("status")
        side = self.mine
        if not st:
            text = t("fr_connecting")
        elif status == "pending":
            text = t("duel_waiting_accept")
        elif status in ("expired", "declined"):
            text = t("duel_expired")
        elif status == "done" and (self.queue or self.anim):
            current = (self.anim or {}).get("ev", {}).get("r", 1)
            text = t("duel_round", n=current, max=st.get("max_rounds", 12)) + "  \u00b7  \u25b6"
        elif status == "done":
            text = t("duel_round", n=st.get("round", 0), max=st.get("max_rounds", 12)) + "  \u00b7  " + t("duel_over")
        else:
            remaining = max(0, int(st.get("deadline", 0) - (time.time() + self.offset)))
            text = t("duel_round", n=st.get("round", 1), max=st.get("max_rounds", 12)) + f"  \u00b7  \u23f1 {remaining}s"
            if side:
                me = st.get(side, {})
                waiting = me.get("acted") or self.acted_round == st.get("round")
                text += "  \u00b7  " + (t("duel_wait_opp") if waiting else t("duel_choose"))
            else:
                text += "  \u00b7  \U0001F441 " + t("duel_spectating")
        self.info.config(text=text)
        lines = []
        for ev in (st.get("log") or [])[max(0, self.shown - len(self.queue) - 3):self.shown - len(self.queue)]:
            lines.append(self._log_line(ev))
        self.log_lbl.config(text="\n".join(lines[-3:]))

    def _log_line(self, ev):
        st = self.state or {}
        who = st.get(ev.get("s"), {}).get("name", "?")
        act = ev.get("act")
        if act == "guard":
            return t("log_duel_guard", who=who, r=ev.get("r"))
        if act in ("afk", "forfeit"):
            return t("log_duel_" + act, who=who, r=ev.get("r"))
        if ev.get("dodge"):
            return t("log_duel_miss", who=who, r=ev.get("r"))
        text = t("log_duel_hit", who=who, r=ev.get("r"), dmg=ev.get("dmg", 0))
        if ev.get("special"):
            text = t("duel_sp_" + ev["special"]) + ": " + text
        if ev.get("heal"):
            text += f" (+{ev['heal']})"
        if ev.get("crit"):
            text += " \u2605"
        return text

    # ---- drawing ----
    def _draw(self, now):
        cv = self.cv
        cv.delete("all")
        st = self.state or {}
        # sky + crowd + floor
        bands = ("#2b2849", "#322e57", "#3a3565", "#433d73")
        for i, col in enumerate(bands):
            cv.create_rectangle(0, i * 40, W, (i + 1) * 40, fill=col, outline="")
        for i in range(34):
            x = 10 + i * 19
            bob = math.sin(now * 3 + i) * 2
            col = ("#ff8787", "#ffd43b", "#69db7c", "#74c0fc", "#e599f7", "#ffa94d")[i % 6]
            cv.create_oval(x - 6, 150 + bob - 6, x + 6, 150 + bob + 6, fill=col, outline="")
            cv.create_rectangle(x - 7, 156 + bob, x + 7, 172, fill=col, outline="")
        cv.create_rectangle(0, 170, W, H, fill="#c9a66b", outline="")
        cv.create_oval(60, FLOOR - 28, W - 60, FLOOR + 40, fill="#d9b77e", outline="#a8844a", width=3)
        cv.create_text(W / 2, 92, text="\u2694  PIPS ARENA  \u2694", fill="#ffe066", font=("Segoe UI", 13, "bold"))
        if not st.get("a"):
            cv.create_text(W / 2, H / 2, text=t("fr_connecting"), fill="#ffffff", font=("Segoe UI", 12))
            return
        anim = self.anim
        p = (now - anim["t0"]) / EVENT_S if anim else 0.0
        ev = anim["ev"] if anim else {}
        offsets = {"a": 0.0, "b": 0.0}
        aims = {"a": 0.0, "b": 0.0}
        hits = {"a": 0.0, "b": 0.0}
        attacker = ev.get("s")
        defender = "b" if attacker == "a" else "a"
        kind = st.get(attacker, {}).get("weapon_kind", "paw") if attacker else "paw"
        striking = anim and ev.get("act") in ("attack", "special") and not ev.get("heal") or (ev.get("heal") and ev.get("dmg"))
        if anim and striking:
            direction = 1 if attacker == "a" else -1
            if kind in ("melee", "paw"):
                lunge = math.sin(min(1.0, p / 0.7) * math.pi)
                offsets[attacker] = direction * lunge * (RIGHT_X - LEFT_X) * 0.42
            else:
                aims[attacker] = min(1.0, p * 4) if p < 0.75 else max(0.0, 1 - (p - 0.75) * 4)
                offsets[attacker] = -direction * 6 * math.sin(min(1.0, max(0.0, (p - 0.3) / 0.2)) * math.pi)
            if p > 0.55 and ev.get("dmg") and not ev.get("dodge"):
                hits[defender] = math.sin(min(1.0, (p - 0.55) / 0.45) * math.pi)
                offsets[defender] += (1 if defender == "b" else -1) * 8 * hits[defender]
            if ev.get("dodge") and p > 0.4:
                offsets[defender] += (1 if defender == "b" else -1) * 26 * math.sin(min(1.0, (p - 0.4) / 0.6) * math.pi)
        for side, facing in (("a", 1), ("b", -1)):
            fighter = st.get(side, {})
            x = self._pos(side) + offsets[side]
            extra = {}
            if st.get("status") == "done" and not self.queue and not anim:
                if st.get("winner") == side:
                    extra = {"eyes": "happy", "mouth": "big_open", "hop": abs(math.sin(now * 5)) * 6}
                elif st.get("winner") not in (side, "draw"):
                    extra = {"eyes": "closed", "mouth": "wavy", "droop": 0.5}
            if anim and ev.get("act") == "guard" and ev.get("s") == side:
                cv.create_oval(x - 52, FLOOR - 110, x + 52, FLOOR + 6, outline="#74c0fc", width=3)
            pet_shop.draw_fighter(cv, self.pet_mod, x, FLOOR, SIZE, fighter, facing=facing, t=now, aim=aims[side],
                                  hit=hits[side], look_extra=extra)
            if anim and ev.get("shield") and side == defender and p > 0.45:
                cv.create_oval(x - 56, FLOOR - 116, x + 56, FLOOR + 8, outline="#b197fc", width=4, dash=(6, 3))
        # projectile
        if anim and striking and kind not in ("melee", "paw") and 0.25 < p < 0.62:
            q = (p - 0.25) / 0.37
            x0 = self._pos(attacker) + (1 if attacker == "a" else -1) * 55
            x1 = self._pos(defender) - (1 if attacker == "a" else -1) * 30
            x = x0 + (x1 - x0) * q
            y = FLOOR - 60 - (math.sin(q * math.pi) * 40 if kind == "launcher" or ev.get("special") == "bomb" else 0)
            weapon = st.get(attacker, {}).get("gear", {}).get("weapon", "")
            if ev.get("special") == "bomb":
                cv.create_oval(x - 9, y - 9, x + 9, y + 9, fill="#74c0fc", outline="#1864ab", width=2)
            elif weapon in ("laser_blaster", "plasma_cannon"):
                col = "#ff6b6b" if weapon == "laser_blaster" else "#b197fc"
                cv.create_line(x - 22, y, x + 22, y, fill=col, width=5, capstyle="round")
                cv.create_line(x - 18, y, x + 18, y, fill="#ffffff", width=2)
            elif weapon == "rocket_launcher":
                cv.create_polygon(x - 14, y - 5, x + 10, y - 5, x + 18, y, x + 10, y + 5, x - 14, y + 5, fill="#5c940d",
                                  outline="#2b5000")
                cv.create_oval(x - 22, y - 4, x - 14, y + 4, fill="#ff922b", outline="")
            elif weapon == "bubble_blaster":
                for k in range(3):
                    cv.create_oval(x - 6 - k * 12, y - 6 + k * 3, x + 6 - k * 12, y + 6 + k * 3, outline="#f783ac", width=2)
            elif weapon == "slingshot":
                cv.create_oval(x - 4, y - 4, x + 4, y + 4, fill="#868e96", outline="#343a40")
            else:
                cv.create_oval(x - 6, y - 4, x + 6, y + 4, fill="#4dabf7", outline="#1864ab")
                cv.create_oval(x - 16, y - 2, x - 9, y + 3, fill="#a5d8ff", outline="")
        if anim and ev.get("special") == "bomb" and 0.6 < p < 0.95:
            r = 20 + (p - 0.6) * 160
            x = self._pos(defender)
            cv.create_oval(x - r, FLOOR - 60 - r, x + r, FLOOR - 60 + r, outline="#4dabf7", width=4)
        if anim and ev.get("heal"):
            x = self._pos(attacker)
            for k in range(5):
                yy = FLOOR - 30 - ((now * 60 + k * 25) % 100)
                cv.create_text(x - 40 + k * 20, yy, text="\u271a", fill="#69db7c", font=("Segoe UI Symbol", 12, "bold"))
        self._draw_bars(st)
        self._draw_floaters(now)
        if st.get("status") == "done" and not self.queue and not anim:
            self._draw_result(st)

    def _draw_bars(self, st):
        cv = self.cv
        for side, x0, anchor in (("a", 14, "w"), ("b", W - 14, "e")):
            f = st.get(side, {})
            max_hp = max(1, f.get("hp", 1))
            hp = self.disp_hp.get(side)
            hp = max_hp if hp is None else hp
            frac = max(0.0, min(1.0, hp / max_hp))
            bw = 250
            left = x0 if side == "a" else x0 - bw
            cv.create_rectangle(left, 14, left + bw, 70, fill="#14122a", outline="#4b4680", width=2)
            role = {"owner": " \u265b", "mod": " \U0001F6E1"}.get(f.get("role", ""), " \u2605" if f.get("premium") else "")
            cv.create_text(left + 8, 26, text=f"{f.get('name', '?')}{role}", anchor="w", fill="#ffffff",
                           font=("Segoe UI Symbol", 10, "bold"))
            cv.create_text(left + bw - 8, 26, text=t("arena_lv_power", level=f.get("level", 1), power=f.get("power", 0)),
                           anchor="e", fill="#ffd43b", font=("Segoe UI", 8, "bold"))
            colour = "#51cf66" if frac > 0.5 else "#fcc419" if frac > 0.25 else "#ff6b6b"
            cv.create_rectangle(left + 8, 36, left + bw - 8, 50, fill="#3b3760", outline="")
            fill_left = left + 8 if side == "a" else left + bw - 8 - (bw - 16) * frac
            cv.create_rectangle(fill_left, 36, fill_left + (bw - 16) * frac, 50, fill=colour, outline="")
            cv.create_text(left + bw / 2, 43, text=f"{int(hp)} / {max_hp}", fill="#ffffff", font=("Segoe UI", 8, "bold"))
            cost = st.get("special_cost", 3)
            charge = f.get("charge", 0)
            pips = "".join("\u25cf" if i < min(charge, cost) else "\u25cb" for i in range(cost))
            stats = f"\u2694{f.get('atk', 0)}  \u26e8{f.get('def', 0)}  \u2605{f.get('crit', 0)}%  " + pips
            cv.create_text(left + 8, 61, text=stats, anchor="w", fill="#c9c4e8", font=("Segoe UI Symbol", 8))

    def _draw_floaters(self, now):
        keep = []
        for (x, y, text, colour, t0, big) in self.floaters:
            age = now - t0
            if age > 1.4:
                continue
            keep.append((x, y, text, colour, t0, big))
            self.cv.create_text(x + 1, y - age * 26 + 1, text=text, fill="#000000",
                                font=("Segoe UI Symbol", 15 if big else 11, "bold"))
            self.cv.create_text(x, y - age * 26, text=text, fill=colour, font=("Segoe UI Symbol", 15 if big else 11, "bold"))
        self.floaters = keep

    def _draw_result(self, st):
        cv = self.cv
        side = self.mine
        winner = st.get("winner")
        result = st.get("result") or {}
        if side:
            key = "duel_draw" if winner == "draw" else "duel_win" if winner == side else "duel_lose"
            title = t(key)
            coins = (result.get("coins") or {}).get(side, 0)
            rating = (result.get("rating") or {}).get(side, 0)
            sub = t("duel_reward", coins=coins, rating=("+" if rating >= 0 else "") + str(rating))
        else:
            name = st.get(winner, {}).get("name", "?") if winner in ("a", "b") else ""
            title = t("duel_winner", name=name) if name else t("duel_draw")
            sub = ""
        colour = "#ffd43b" if (not side or winner == side) else "#ced4da" if winner == "draw" else "#ff8787"
        cv.create_rectangle(W / 2 - 170, 82, W / 2 + 170, 150 if sub else 128, fill="#14122a", outline=colour, width=3)
        cv.create_text(W / 2, 104, text=title, fill=colour, font=("Segoe UI", 18, "bold"))
        if sub:
            cv.create_text(W / 2, 132, text=sub, fill="#ffffff", font=("Segoe UI", 10, "bold"))
