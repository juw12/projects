"""
social_ui.py - the "Friends & achievements" window for Pips (see social.py).

Tabs: Friends (board, requests, affinity, pet interactions) | Chat | Groups
(your own invite-only groups) | Ranks (everyone using Pips) | Shop | Badges |
Profile (your public / private profile, status and theme). Clicking a person
opens their profile inside the hub. Colours come from theme.py (light / dark).
All user-facing text comes from i18n.py.
"""

from __future__ import annotations

import time
import tkinter as tk
from datetime import datetime
from tkinter import messagebox

import social

try:
    import theme
except ImportError:  # pragma: no cover
    theme = None

try:
    import pet_shop
except ImportError:  # pragma: no cover
    pet_shop = None
from social import ACH_IDS, ACH_SYMBOL, INTERACTIONS, INTERACTION_SYMBOL, affinity_level, default_display_name

try:
    from i18n import t
except ImportError:  # pragma: no cover
    def t(key, lang=None, **kwargs):
        return key.format(**kwargs) if kwargs else key


LABELS = ("", "buddy", "bro", "sis", "bestie", "partner", "soulmate", "family", "work")
LABEL_SYMBOL = {"buddy": "\u263a", "bro": "\u270a", "sis": "\u273f", "bestie": "\u2605", "partner": "\u2665",
                "soulmate": "\u2766", "family": "\u2302", "work": "\u2692"}
STATUSES = ("auto", "online", "busy", "away", "offline")
INFO_FIELDS = ("job", "location", "hobbies", "birthday", "fav")


class FriendsWindow:
    WIDTH = 520
    TABS = ("friends", "chat", "groups", "ranks", "shop", "achievements", "profile")

    def _apply_palette(self):
        p = theme.palette() if theme is not None else {}
        get = lambda k, d: p.get(k, d)  # noqa: E731
        self.BG = get("bg", "#faf8f3")
        self.CARD = get("card", "#ffffff")
        self.INK = get("ink", "#1a1a1a")
        self.MUTED = get("muted", "#6b6b6b")
        self.BORDER = get("border", "#e2ddd4")
        self.ACCENT = get("accent", "#8b1a1a")
        self.ACCENT_INK = get("accent_ink", "#ffffff")
        self.GOLD = get("gold", "#c8961e")
        self.PINK = get("pink", "#e0557a")
        self.MINE = get("mine", "#fbeee6")
        self.THEIRS = get("theirs", "#f1f4f8")
        self.WARM = get("warm", "#fbf3e6")
        self.SOFT = get("soft", "#f1ece4")
        self.TILE = get("tile", "#f6f4f0")
        self.TILE_OFF = get("tile_off", "#f4f2ee")
        self.OFF_INK = get("off_ink", "#9a958c")
        self.OFF_SYM = get("off_sym", "#c9c4bb")
        self.BAR = get("bar", "#eeeae3")
        self.ENTRY = get("entry", "#ffffff")
        self.ENTRY_INK = get("entry_ink", "#1a1a1a")
        self.PRESENCE = {k: get(k, d) for k, d in (("online", "#2fa84f"), ("busy", "#d93838"),
                                                   ("away", "#e0a020"), ("offline", "#a8a39a"))}

    def __init__(self, soc: "social.Social"):
        import pet as pet_mod  # late import: pet imports social

        self._apply_palette()
        self._imgs = []          # PhotoImage refs (avatars) for the current render
        self.viewing = None      # friend code whose profile is shown
        self.rank_sort = "xp"
        self.pet_mod = pet_mod
        self.social = soc
        self.pet = soc.pet
        self.tab = "friends"
        self.room = None
        self._alive = True
        self.error = ""
        self._chat_sig = None
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
        for key in self.TABS:
            btn = tk.Label(tabs, text=t("fr_tab_" + key), font=("Segoe UI", 9, "bold"), padx=6, pady=4,
                           cursor="hand2")
            btn.pack(side="left", padx=(0, 3))
            btn.bind("<Button-1>", lambda e, k=key: self.show_tab(k))
            self.tab_buttons[key] = btn
        # scrollable body
        box = tk.Frame(self.outer, bg=self.CARD, highlightthickness=1, highlightbackground=self.BORDER)
        box.pack(fill="both", expand=True)
        self.canvas = tk.Canvas(box, bg=self.CARD, highlightthickness=0, bd=0)
        self.scroll = tk.Scrollbar(box, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.scroll.set)
        self.scroll.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.body = tk.Frame(self.canvas, bg=self.CARD, padx=12, pady=10)
        self._body_id = self.canvas.create_window((0, 0), window=self.body, anchor="nw")
        self.body.bind("<Configure>", lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(self._body_id, width=e.width))
        self.win.bind_all("<MouseWheel>", self._on_wheel, add="+")
        # chat composer (only visible in a conversation)
        self.composer = tk.Frame(self.outer, bg=self.BG)
        self.status = tk.Label(self.outer, text="", font=("Segoe UI", 8), fg=self.MUTED, bg=self.BG,
                               anchor="w", wraplength=self.WIDTH - 20, justify="left")
        self.status.pack(fill="x", pady=(6, 0))
        self.win.geometry(f"{self.WIDTH}x800")
        self._place()
        self.refresh()
        self.win.after(400, self._pump)

    # ---- helpers ----
    def alive(self) -> bool:
        return self._alive

    def close(self):
        self._alive = False
        self.social.chat_open_room = None
        try:
            self.win.unbind_all("<MouseWheel>")
        except tk.TclError:
            pass
        try:
            self.win.destroy()
        except tk.TclError:
            pass

    def _on_wheel(self, event):
        try:
            if str(event.widget).startswith(str(self.win)) and not isinstance(event.widget, tk.Text):
                self.canvas.yview_scroll(int(-event.delta / 120), "units")
        except tk.TclError:
            pass

    def _place(self):
        try:
            self.win.update_idletasks()
            x = max(20, self.pet.root.winfo_screenwidth() // 2 - self.WIDTH // 2)
            self.win.geometry(f"+{x}+60")
        except tk.TclError:
            pass

    def _pump(self):
        if not self._alive:
            return
        self.social.poll()
        if self.tab == "chat" and self.room:
            sig = (len(self.social.rooms.get(self.room, [])),
                   (self.social.rooms.get(self.room) or [{}])[-1].get("id"))
            if sig != self._chat_sig:
                self.refresh()
        self.win.after(400, self._pump)

    def _button(self, parent, text, command, primary=False, small=False):
        btn = tk.Label(parent, text=text, font=("Segoe UI", 8 if small else 9, "bold" if primary else "normal"),
                       fg=self.ACCENT_INK if primary else self.INK, bg=self.ACCENT if primary else self.SOFT,
                       padx=7 if small else 10, pady=1 if small else 3, cursor="hand2")
        btn.bind("<Button-1>", lambda e: command())
        return btn

    def _photo(self, path, size):
        """PhotoImage of a cached avatar PNG scaled to `size` (kept alive until the next render)."""
        try:
            from PIL import Image, ImageTk
            img = Image.open(path).convert("RGBA").resize((size, size), Image.LANCZOS)
            photo = ImageTk.PhotoImage(img, master=self.win)
        except Exception:
            try:
                photo = tk.PhotoImage(file=str(path), master=self.win)
                factor = max(1, round(photo.width() / size))
                if factor > 1:
                    photo = photo.subsample(factor, factor)
            except tk.TclError:
                return None
        self._imgs.append(photo)
        return photo

    def _avatar(self, parent, species, color, size=34, bg=None, look=None, person=None):
        """Profile photo if the person has one, else their pet (with props). Adds an online dot."""
        cv = tk.Canvas(parent, width=size, height=size, bg=bg or self.CARD, highlightthickness=0)
        person = person or {}
        path = self.social.avatar_path(person.get("code", ""), person.get("avatar_v", 0)) if person else None
        photo = self._photo(path, size) if path else None
        if photo is not None:
            cv.create_image(size / 2, size / 2, image=photo)
        else:
            self._draw_pet_avatar(cv, species, color, size, look)
        state = person.get("presence")
        if state:
            r = max(4, size // 7)
            cv.create_oval(size - 2 * r - 1, size - 2 * r - 1, size - 1, size - 1,
                           fill=self.PRESENCE.get(state, self.PRESENCE["offline"]), outline=bg or self.CARD, width=2)
        return cv

    def _draw_pet_avatar(self, cv, species, color, size, look):
        try:
            props = pet_shop.clean_look(look) if (pet_shop is not None and look) else {}
            scale = 0.5 if props else 0.62
            if pet_shop is not None:
                pet_shop.draw_props_preview(cv, self.pet_mod, size * scale, species, color, props,
                                            cx=size / 2, floor=size - 2, t=time.monotonic())
            else:
                sp = species if species in self.pet_mod.SPECIES else "cat"
                pl = self.pet_mod.default_look({"species": sp, "color": color or "#ffc78f", "cheek_color": "#ff8fa3"})
                pl["t"] = time.monotonic()
                pl["mouth"] = "smile"
                self.pet_mod.draw_pet(cv, size / 2, size - 2, size * scale, pl)
        except Exception:
            cv.create_oval(4, 4, size - 4, size - 4, fill=color or "#ffc78f", outline="")

    def _entry(self, parent, var, width=18, font=("Segoe UI", 10)):
        return tk.Entry(parent, textvariable=var, width=width, font=font, bg=self.ENTRY, fg=self.ENTRY_INK,
                        insertbackground=self.ENTRY_INK, relief="solid", bd=1,
                        highlightthickness=0)

    def _label(self, parent, text, size=9, bold=False, fg=None, bg=None, wrap=None, **kw):
        return tk.Label(parent, text=text, font=("Segoe UI", size, "bold" if bold else "normal"),
                        fg=fg or self.INK, bg=bg or self.CARD, anchor="w", justify="left",
                        wraplength=wrap or 0, **kw)

    def show_error(self, code):
        messages = {"offline": t("fr_err_offline"), "not_found": t("fr_err_not_found"),
                    "self": t("fr_err_self"), "bad_code": t("fr_err_bad_code"),
                    "too_many": t("fr_err_too_many"), "bad_group": t("fr_err_bad_group"),
                    "too_fast": t("fr_err_too_fast"), "not_friends": t("fr_err_not_friends"),
                    "already_member": t("cir_err_member"), "bad_name": t("cir_err_name"),
                    "poor": t("shop_poor"), "bad_image": t("prof_err_image"),
                    "no_pillow": t("prof_err_pillow")}
        self.error = messages.get(code, t("fr_err_generic", code=code))
        self.refresh(force=True)

    def show_tab(self, key, room=None):
        self.tab = key
        self.viewing = None
        self.error = ""
        if key == "ranks":
            board = self.social.leaderboards.get(self.rank_sort)
            if not board or time.time() - board.get("_at", 0) > 60:
                self.social.load_leaderboard(self.rank_sort)
        if key == "chat":
            self.room = room
        self.social.chat_open_room = self.room if key == "chat" else None
        if self.social.chat_open_room:
            self.social.mark_read(self.room)
            self.social._next_inbox = 0
        self.canvas.yview_moveto(0)
        self.refresh(force=True)

    # ---- rendering ----
    def refresh(self, force=False):
        if not self._alive:
            return
        # Don't wipe the profile editor while the user is typing (background syncs call refresh).
        if self.tab == "profile" and not self.viewing and getattr(self, "_profile_built", False) and not force:
            return
        self._profile_built = False
        stats = self.social.stats or self.social.refresh_stats()
        self._imgs = []
        for frame in (self.head, self.body, self.composer):
            for child in frame.winfo_children():
                child.destroy()
        self.composer.pack_forget()
        unread = self.social.total_unread()
        invites = len(self.social.invites)
        for key, btn in self.tab_buttons.items():
            active = key == self.tab
            label = t("fr_tab_" + key)
            if key == "chat" and unread:
                label += f" ({unread})"
            if key == "groups" and invites:
                label += f" ({invites})"
            if key == "friends" and self.social.requests():
                label += f" ({len(self.social.requests())})"
            btn.config(text=label, bg=self.ACCENT if active else self.SOFT, fg=self.ACCENT_INK if active else self.INK)
        self._render_head(stats)
        if self.viewing and self.social.enabled:
            self._render_profile_view(self.viewing)
        elif self.tab == "achievements":
            self._render_achievements()
        elif self.tab == "shop":
            self._render_shop()
        elif self.tab == "profile":
            self._render_profile_tab()
        elif not self.social.enabled:
            self._render_off()
        elif self.tab == "chat":
            self._render_chat()
        elif self.tab == "groups":
            self._render_groups()
        elif self.tab == "ranks":
            self._render_ranks()
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
        me = dict((self.social.board or {}).get("me") or {})
        me.update({"code": self.social.data.get("code", ""), "avatar_v": self.social.data.get("avatar_v", 0)})
        if not self.social.enabled:
            me.pop("presence", None)
        head_avatar = self._avatar(row, self.pet.s.get("species"), self.pet.s.get("color"), size=56,
                                   look=self.social.my_look(), person=me)
        head_avatar.pack(side="left")
        head_avatar.config(cursor="hand2")
        head_avatar.bind("<Button-1>", lambda e: self.show_tab("profile"))
        info = tk.Frame(row, bg=self.CARD)
        info.pack(side="left", fill="x", expand=True, padx=(10, 0))
        name = self.social.data.get("name") or default_display_name()
        name_line = tk.Frame(info, bg=self.CARD)
        name_line.pack(fill="x")
        self._label(name_line, f"{name} & {self.pet.s.get('name', 'Pip')}", size=11, bold=True).pack(side="left")
        if self.social.is_owner:
            self._owner_chip(name_line, self.CARD).pack(side="left", padx=(6, 0))
        self._label(info, t("fr_level_line", level=stats["level"], xp=stats["xp"]), fg=self.ACCENT).pack(fill="x")
        bar = tk.Canvas(info, width=240, height=8, bg=self.CARD, highlightthickness=0)
        bar.pack(anchor="w", pady=(2, 2))
        span = max(1, stats["level_next"] - stats["level_floor"])
        frac = max(0.0, min(1.0, (stats["xp"] - stats["level_floor"]) / span))
        bar.create_rectangle(0, 0, 240, 8, fill=self.BAR, outline="")
        bar.create_rectangle(0, 0, max(3, 240 * frac), 8, fill=self.GOLD, outline="")
        self._label(info, t("fr_stats_line", today=stats["today_poms"], week=stats["week_poms"],
                            streak=stats["streak"]), size=8, fg=self.MUTED).pack(fill="x")
        if pet_shop is not None and getattr(self.pet, "shop", None):
            wallet = self.social.wallet()
            coin_text = t("shop_unlimited") if wallet.get("unlimited") else t("shop_balance", n=wallet["balance"])
            coins = self._label(info, f"{pet_shop.COIN} " + coin_text, size=9, bold=True, fg=self.GOLD, cursor="hand2")
            coins.pack(fill="x")
            coins.bind("<Button-1>", lambda e: self.show_tab("shop"))
        if self.social.enabled and self.social.data.get("code"):
            code = self.social.data["code"]
            box = tk.Frame(row, bg=self.CARD)
            box.pack(side="right", anchor="n")
            self._label(box, t("fr_your_code"), size=8, fg=self.MUTED).pack(anchor="e")
            self._label(box, code, size=13, bold=True, fg=self.ACCENT).pack(anchor="e")
            self._button(box, t("fr_copy"), lambda: self._copy(code), small=True).pack(anchor="e")

    def _render_off(self):
        self._label(self.body, t("fr_off_title"), size=11, bold=True).pack(fill="x")
        self._label(self.body, t("fr_off_body"), wrap=self.WIDTH - 70).pack(fill="x", pady=(4, 6))
        self._label(self.body, t("fr_shared"), fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x", pady=(0, 10))
        row = tk.Frame(self.body, bg=self.CARD)
        row.pack(fill="x")
        self._label(row, t("fr_your_name")).pack(side="left")
        self.name_var = tk.StringVar(value=self.social.data.get("name") or default_display_name())
        self._entry(row, self.name_var, width=18, font=("Segoe UI", 10)).pack(side="left", padx=6)
        self._button(self.body, t("fr_turn_on"), self._enable, primary=True).pack(anchor="w", pady=(10, 0))

    def _enable(self):
        self.error = ""
        self.social.enable(self.name_var.get())
        self.refresh()

    def _affinity_text(self, points):
        index, key, floor, nxt = affinity_level(points)
        hearts = "\u2665" * (index + 1) + "\u2661" * (len(social.AFFINITY_LEVELS) - index - 1)
        return f"{hearts}  {t(key)} \u00b7 {points}" + (f"/{nxt}" if nxt else "")

    def _person_row(self, parent, rank, person, value_text, is_me=False, on_remove=None, extra=None):
        bg = self.WARM if is_me else self.CARD
        row = tk.Frame(parent, bg=bg, pady=3)
        row.pack(fill="x")
        if rank is not None:
            tk.Label(row, text=str(rank), width=2, font=("Segoe UI", 10, "bold"),
                     fg=self.GOLD if rank <= 3 else self.MUTED, bg=bg).pack(side="left", anchor="n", pady=6)
        av = self._avatar(row, person.get("species"), person.get("color"), size=38, bg=bg,
                          look=person.get("look"), person=person)
        av.pack(side="left", anchor="n", padx=(2, 6))
        info = tk.Frame(row, bg=bg)
        info.pack(side="left", fill="x", expand=True)
        top = tk.Frame(info, bg=bg)
        top.pack(fill="x")
        name = person.get("name", "?") + ("  " + t("fr_you") if is_me else "")
        name_lbl = self._label(top, name, size=10, bold=True, bg=bg, cursor="hand2")
        name_lbl.pack(side="left")
        code = person.get("code")
        if code:
            for widget in (av, name_lbl):
                widget.config(cursor="hand2")
                widget.bind("<Button-1>", lambda e, c=code: self.open_profile(c))
        if person.get("role") == "owner":
            self._owner_chip(top, bg).pack(side="left", padx=(6, 0))
        if person.get("label"):
            self._chip(top, self._label_text(person["label"]), bg).pack(side="left", padx=(6, 0))
        if person.get("status_text"):
            self._label(info, "\u201c" + person["status_text"] + "\u201d", size=8, fg=self.MUTED, bg=bg).pack(fill="x")
        if value_text:
            color = self.PRESENCE.get(person.get("presence") or "", self.ACCENT) if person.get("presence") else self.ACCENT
            self._label(top, value_text, size=9, bold=True, fg=color, bg=bg).pack(side="right")
        self._label(info, t("fr_row_line", level=person.get("level", 1), streak=person.get("streak", 0),
                            n=len(person.get("achievements", []))), size=8, fg=self.MUTED, bg=bg).pack(fill="x")
        if extra:
            extra(info, bg)
        if on_remove:
            x = tk.Label(row, text="\u00d7", font=("Segoe UI", 11), fg=self.MUTED, bg=bg, cursor="hand2")
            x.pack(side="left", anchor="n")
            x.bind("<Button-1>", lambda e: on_remove())
        return row

    def _render_friends(self):
        board = self.social.board or {}
        add = tk.Frame(self.body, bg=self.CARD)
        add.pack(fill="x", pady=(0, 8))
        self.code_var = tk.StringVar()
        entry = self._entry(add, self.code_var, width=10, font=("Consolas", 12))
        entry.pack(side="left")
        entry.bind("<Return>", lambda e: self._add())
        self._button(add, t("fr_add"), self._add, primary=True).pack(side="left", padx=6)
        self._label(add, t("fr_add_hint"), size=8, fg=self.MUTED, wrap=200).pack(side="left")
        requests = self.social.requests()
        if requests:
            self._label(self.body, t("req_title", n=len(requests)), bold=True, fg=self.ACCENT).pack(fill="x", pady=(0, 2))
            for req in requests:
                card = tk.Frame(self.body, bg=self.WARM, padx=6, pady=4)
                card.pack(fill="x", pady=(0, 4))
                av = self._avatar(card, req.get("species"), req.get("color"), size=34, bg=self.WARM,
                                  look=req.get("look"), person=req)
                av.pack(side="left", padx=(0, 6))
                av.config(cursor="hand2")
                av.bind("<Button-1>", lambda e, c=req["code"]: self.open_profile(c))
                box = tk.Frame(card, bg=self.WARM)
                box.pack(side="left", fill="x", expand=True)
                self._label(box, t("req_line", name=req.get("name", "?")), bold=True, bg=self.WARM).pack(fill="x")
                self._label(box, t("rank_level", level=req.get("level", 1)), size=8, fg=self.MUTED,
                            bg=self.WARM).pack(fill="x")
                self._button(card, t("req_decline"), lambda c=req["code"]: self._answer(c, False),
                             small=True).pack(side="right", padx=(4, 0))
                self._button(card, t("req_accept"), lambda c=req["code"]: self._answer(c, True), primary=True,
                             small=True).pack(side="right")
        sent = self.social.sent_requests()
        if sent:
            self._label(self.body, t("req_sent_count", n=len(sent)), size=8, fg=self.MUTED).pack(fill="x", pady=(0, 4))
        self._label(self.body, t("fr_today_board"), bold=True).pack(fill="x", pady=(4, 2))
        people = [dict(board.get("me", {}), _me=True, code=self.social.data.get("code"),
                       avatar_v=self.social.data.get("avatar_v", 0))] if board.get("me") else []
        people += board.get("friends", [])
        if len(people) <= 1:
            self._label(self.body, t("fr_no_friends"), fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x", pady=(0, 6))
        order = {"online": 0, "busy": 1, "away": 2, "offline": 3}
        people.sort(key=lambda p: (not p.get("_me"), order.get(p.get("presence") or "offline", 3),
                                   -p.get("affinity", 0), p.get("name", "").lower()))
        for rank, person in enumerate(people[:60], 1):
            value = t("st_" + (person.get("presence") or "offline"))
            rank = None
            if person.get("_me"):
                self._person_row(self.body, rank, person, value, is_me=True)
                continue
            code = person["code"]
            self._person_row(self.body, rank, person, value,
                             on_remove=lambda c=code, n=person.get("name", ""): self._remove(c, n),
                             extra=lambda parent, bg, p=person: self._friend_extras(parent, bg, p))
        self._button(self.body, t("fr_turn_off"), self._disable).pack(anchor="e", pady=(12, 0))

    def _friend_extras(self, parent, bg, person):
        code = person["code"]
        self._label(parent, self._affinity_text(person.get("affinity", 0)), size=8, fg=self.PINK, bg=bg).pack(fill="x")
        acts = tk.Frame(parent, bg=bg)
        acts.pack(fill="x", pady=(2, 0))
        room = "dm:" + code
        unread = self.social.unread(room)
        chat_label = "\u2709 " + t("ix_btn_chat") + (f" ({unread})" if unread else "")
        buttons = [self._button(acts, chat_label, lambda r=room: self.show_tab("chat", room=r), small=True,
                                primary=bool(unread))]
        for kind in INTERACTIONS:
            buttons.append(self._button(acts, INTERACTION_SYMBOL[kind] + " " + t("ix_btn_" + kind),
                                        lambda k=kind, r=room: self._interact(r, k), small=True))
        label_btn = self._button(acts, "\u2661 " + t("lbl_set"), lambda: None, small=True)
        label_btn.bind("<Button-1>", lambda e, c=code, cur=person.get("label", ""): self._label_menu(e, c, cur))
        buttons.append(label_btn)
        for i, btn in enumerate(buttons):
            btn.grid(row=i // 3, column=i % 3, sticky="ew", padx=(0, 3), pady=(0, 2))

    def _interact(self, room, kind):
        self.error = ""
        self.social.send(room, kind)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    # ---- chat ----
    def _conversations(self):
        rooms = {}
        for f in self.social.friends():
            rooms["dm:" + f["code"]] = {"title": f["name"], "species": f.get("species"), "color": f.get("color"),
                                         "group": False}
        for c in self.social.circles():
            rooms["c:" + c["id"]] = {"title": c["name"], "species": None, "color": None, "group": True,
                                      "count": len(c.get("members", []))}
        items = []
        for room, info in rooms.items():
            msgs = self.social.rooms.get(room, [])
            last = msgs[-1] if msgs else None
            items.append((last["id"] if last else 0, room, info, last))
        items.sort(key=lambda x: (-x[0], x[2]["title"].lower()))
        return items

    def _render_chat(self):
        if self.room:
            self._render_conversation(self.room)
            return
        self._chat_sig = None
        items = self._conversations()
        if not items:
            self._label(self.body, t("chat_empty"), fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x")
            return
        for _last_id, room, info, last in items:
            unread = self.social.unread(room)
            row = tk.Frame(self.body, bg=self.CARD, pady=4, cursor="hand2")
            row.pack(fill="x")
            if info["group"]:
                icon = tk.Label(row, text="\u2691", font=("Segoe UI Symbol", 16), fg=self.ACCENT, bg=self.CARD,
                                width=2)
            else:
                icon = self._avatar(row, info["species"], info["color"], size=34)
            icon.pack(side="left", padx=(0, 8))
            box = tk.Frame(row, bg=self.CARD)
            box.pack(side="left", fill="x", expand=True)
            title = info["title"] + (f"  \u00b7 {info['count']}" if info["group"] else "")
            self._label(box, title, size=10, bold=bool(unread)).pack(fill="x")
            preview = self._preview(last) if last else t("chat_say_hi")
            self._label(box, preview, size=8, fg=self.MUTED).pack(fill="x")
            if unread:
                tk.Label(row, text=str(unread), font=("Segoe UI", 8, "bold"), fg=self.ACCENT_INK, bg=self.ACCENT,
                         padx=6).pack(side="right")
            for widget in (row, box, icon) + tuple(box.winfo_children()):
                widget.bind("<Button-1>", lambda e, r=room: self.show_tab("chat", room=r))

    def _preview(self, m):
        who = t("fr_you") if m.get("mine") else (m.get("from") or {}).get("name", "?")
        if m.get("kind") == "text":
            body = m.get("body", "")
            return f"{who}: " + (body if len(body) <= 50 else body[:47] + "\u2026")
        return f"{who}: {INTERACTION_SYMBOL.get(m.get('kind'), '')} " + t("ix_name_" + m.get("kind", "wave"))

    def _render_conversation(self, room):
        is_group = room.startswith("c:")
        msgs = self.social.rooms.get(room, [])
        self._chat_sig = (len(msgs), msgs[-1]["id"] if msgs else None)
        top = tk.Frame(self.body, bg=self.CARD)
        top.pack(fill="x", pady=(0, 6))
        back = self._button(top, "\u2039 " + t("chat_back"), lambda: self.show_tab("chat", room=None), small=True)
        back.pack(side="left")
        self._label(top, "  " + self.social.room_title(room), size=11, bold=True).pack(side="left")
        if not is_group:
            friend = self.social.friend(room[3:])
            if friend:
                self._label(self.body, self._affinity_text(friend.get("affinity", 0)), size=8,
                            fg=self.PINK).pack(fill="x", pady=(0, 4))
        log = tk.Frame(self.body, bg=self.CARD)
        log.pack(fill="both", expand=True)
        if not msgs:
            self._label(log, t("chat_say_hi"), fg=self.MUTED).pack(fill="x", pady=10)
        last_day = None
        for m in msgs[-80:]:
            stamp = datetime.fromtimestamp(m.get("at", 0))
            day = stamp.strftime("%Y-%m-%d")
            if day != last_day:
                last_day = day
                tk.Label(log, text=stamp.strftime("%d %b"), font=("Segoe UI", 7), fg=self.MUTED,
                         bg=self.CARD).pack(pady=(4, 2))
            mine = m.get("mine")
            line = tk.Frame(log, bg=self.CARD)
            line.pack(fill="x", pady=1)
            bubble_bg = self.MINE if mine else self.THEIRS
            bubble = tk.Frame(line, bg=bubble_bg, padx=8, pady=3)
            bubble.pack(side="right" if mine else "left", padx=(60, 0) if mine else (0, 60))
            if is_group and not mine:
                self._label(bubble, (m.get("from") or {}).get("name", "?"), size=7, bold=True,
                            fg=self.ACCENT, bg=bubble_bg).pack(fill="x")
            if m.get("kind") == "text":
                text = m.get("body", "")
            else:
                who = t("fr_you") if mine else (m.get("from") or {}).get("name", "?")
                text = f"{INTERACTION_SYMBOL.get(m.get('kind'), '')}  {who} \u00b7 " + t("ix_name_" + m.get("kind", "wave"))
            tk.Label(bubble, text=text, font=("Segoe UI", 9, "italic" if m.get("kind") != "text" else "normal"),
                     fg=self.INK, bg=bubble_bg, wraplength=self.WIDTH - 170, justify="left",
                     anchor="w").pack(fill="x")
            tk.Label(bubble, text=stamp.strftime("%H:%M"), font=("Segoe UI", 7), fg=self.MUTED,
                     bg=bubble_bg).pack(anchor="e")
        # composer under the scroll area
        self.composer.pack(fill="x", pady=(6, 0), before=self.status)
        quick = tk.Frame(self.composer, bg=self.BG)
        quick.pack(fill="x", pady=(0, 4))
        kinds = ("cheer", "wave") if is_group else INTERACTIONS
        for kind in kinds:
            self._button(quick, INTERACTION_SYMBOL[kind] + " " + t("ix_btn_" + kind),
                         lambda k=kind: self._interact(room, k), small=True).pack(side="left", padx=(0, 3))
        entry_row = tk.Frame(self.composer, bg=self.BG)
        entry_row.pack(fill="x")
        self.msg_var = tk.StringVar()
        entry = self._entry(entry_row, self.msg_var, width=10)
        entry.pack(side="left", fill="x", expand=True, ipady=3)
        entry.bind("<Return>", lambda e: self._send_text(room))
        entry.focus_set()
        self._button(entry_row, t("chat_send"), lambda: self._send_text(room), primary=True).pack(side="left",
                                                                                                  padx=(6, 0))
        self.win.after(60, lambda: self.canvas.yview_moveto(1.0))

    def _send_text(self, room):
        text = self.msg_var.get().strip()
        if not text:
            return
        self.msg_var.set("")
        self.error = ""
        self.social.send(room, "text", text)

    # ---- groups (your own, invite-only) ----
    def _render_groups(self):
        for inv in self.social.invites:
            card = tk.Frame(self.body, bg=self.WARM, padx=8, pady=6)
            card.pack(fill="x", pady=(0, 6))
            self._label(card, t("cir_invite_line", name=inv.get("by", "?"), group=inv.get("name", "?")),
                        bg=self.WARM, wrap=self.WIDTH - 90).pack(fill="x")
            row = tk.Frame(card, bg=self.WARM)
            row.pack(fill="x", pady=(4, 0))
            self._button(row, t("cir_accept"), lambda c=inv["circle"]: self._respond(c, True), primary=True,
                         small=True).pack(side="left")
            self._button(row, t("cir_decline"), lambda c=inv["circle"]: self._respond(c, False),
                         small=True).pack(side="left", padx=6)
        create = tk.Frame(self.body, bg=self.CARD)
        create.pack(fill="x", pady=(0, 4))
        self._label(create, t("cir_new")).pack(side="left")
        self.circle_var = tk.StringVar()
        entry = self._entry(create, self.circle_var, width=18, font=("Segoe UI", 10))
        entry.pack(side="left", padx=6)
        entry.bind("<Return>", lambda e: self._create_circle())
        self._button(create, t("cir_create"), self._create_circle, primary=True).pack(side="left")
        self._label(self.body, t("cir_hint"), size=8, fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x", pady=(2, 8))
        circles = self.social.circles()
        if not circles:
            self._label(self.body, t("cir_none"), fg=self.MUTED).pack(fill="x")
        friends = self.social.friends()
        for c in circles:
            card = tk.Frame(self.body, bg=self.CARD, highlightthickness=1, highlightbackground=self.BORDER,
                            padx=8, pady=6)
            card.pack(fill="x", pady=(0, 8))
            head = tk.Frame(card, bg=self.CARD)
            head.pack(fill="x")
            role = t("cir_role_owner") if c.get("role") == "owner" else t("cir_role_member")
            self._label(head, f"\u2691 {c['name']}", size=11, bold=True).pack(side="left")
            self._label(head, f"  {role} \u00b7 {len(c.get('members', []))}", size=8, fg=self.MUTED).pack(side="left")
            leave = tk.Label(head, text=t("fr_leave"), font=("Segoe UI", 8, "underline"), fg=self.MUTED,
                             bg=self.CARD, cursor="hand2")
            leave.pack(side="right")
            leave.bind("<Button-1>", lambda e, cid=c["id"], n=c["name"]: self._leave_circle(cid, n))
            room = "c:" + c["id"]
            unread = self.social.unread(room)
            self._button(head, "\u2709 " + t("ix_btn_chat") + (f" ({unread})" if unread else ""),
                         lambda r=room: self.show_tab("chat", room=r), small=True,
                         primary=bool(unread)).pack(side="right", padx=6)
            members = sorted(c.get("members", []), key=lambda p: (-p.get("week_poms", 0), p.get("name", "")))
            owner = c.get("role") == "owner"
            for rank, person in enumerate(members, 1):
                remove = None
                if owner and not person.get("me"):
                    remove = lambda cid=c["id"], code=person["code"], n=person.get("name", ""): self._kick(cid, code, n)
                badge = " \u2605" if person.get("role") == "owner" else ""
                p = dict(person, name=person.get("name", "?") + badge)
                self._person_row(card, rank, p, t("fr_week_value", n=person.get("week_poms", 0)),
                                 is_me=person.get("me", False), on_remove=remove)
            member_codes = {m["code"] for m in members}
            candidates = [f for f in friends if f["code"] not in member_codes]
            if candidates:
                inv = tk.Frame(card, bg=self.CARD)
                inv.pack(fill="x", pady=(6, 0))
                self._label(inv, t("cir_invite_friend"), size=8).pack(side="left")
                names = {f"{f['name']} ({f['code']})": f["code"] for f in candidates}
                var = tk.StringVar(value=next(iter(names)))
                menu = tk.OptionMenu(inv, var, *names.keys())
                menu.config(font=("Segoe UI", 8), bg=self.SOFT, relief="flat", highlightthickness=0)
                menu.pack(side="left", padx=4)
                self._button(inv, t("cir_invite"), lambda cid=c["id"], v=var, m=names: self._invite(cid, m[v.get()]),
                             primary=True, small=True).pack(side="left")

    def _create_circle(self):
        name = self.circle_var.get().strip()
        if len(name) < 2:
            self.show_error("bad_name")
            return
        self.error = ""
        self.social.create_circle(name)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    def _invite(self, circle_id, code):
        self.error = ""
        self.social.invite_to_circle(circle_id, code)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    def _respond(self, circle_id, accept):
        self.social.respond_invite(circle_id, accept)
        self.refresh()

    def _leave_circle(self, circle_id, name):
        if messagebox.askyesno(t("fr_title"), t("cir_leave_q", group=name), parent=self.win):
            self.social.leave_circle(circle_id)

    def _kick(self, circle_id, code, name):
        if messagebox.askyesno(t("fr_title"), t("cir_kick_q", name=name), parent=self.win):
            self.social.kick_from_circle(circle_id, code)

    # ---- small helpers (v2.6) ----
    def _owner_chip(self, parent, bg):
        return tk.Label(parent, text="\u265b " + t("owner_badge"), font=("Segoe UI Symbol", 8, "bold"),
                        fg=self.ACCENT_INK, bg=self.GOLD, padx=5)

    def _mail_owner(self):
        import webbrowser
        webbrowser.open(f"mailto:{social.OWNER_EMAIL}?subject=Pips")

    def _chip(self, parent, text, bg):
        return tk.Label(parent, text=text, font=("Segoe UI", 8, "bold"), fg=self.PINK, bg=bg)

    def _label_text(self, label):
        return f"{LABEL_SYMBOL.get(label, '')} {t('lbl_' + label)}".strip()

    def _presence_text(self, person):
        state = person.get("presence") or "offline"
        return "\u25cf " + t("st_" + state)

    def _label_menu(self, event, code, current):
        menu = tk.Menu(self.win, tearoff=0)
        for label in LABELS:
            text = self._label_text(label) if label else t("lbl_none")
            menu.add_command(label=("\u2713 " if label == current else "    ") + text,
                             command=lambda l=label: self._set_label(code, l))
        try:
            menu.tk_popup(event.x_root, event.y_root)
        finally:
            menu.grab_release()

    def _set_label(self, code, label):
        self.error = ""
        for f in (self.social.board or {}).get("friends", []):
            if f.get("code") == code:
                f["label"] = label
        prof = self.social.profiles.get(code)
        if prof:
            prof["user"]["label"] = label
        self.social.set_label(code, label)
        self.refresh()

    def _answer(self, code, accept):
        self.social.respond_request(code, accept)
        self.refresh()

    def open_profile(self, code):
        if not code:
            return
        if not self.social.enabled:
            self.show_tab("profile")
            return
        self.viewing = code
        self.error = ""
        cached = self.social.profiles.get(code)
        if not cached or time.time() - cached.get("at", 0) > 20:
            self.social.view_user(code)
        self.canvas.yview_moveto(0)
        self.refresh(force=True)

    def _close_profile(self):
        self.viewing = None
        self.refresh()

    def _relation_button(self, parent, person, bg=None, small=True):
        """Add / Requested / Accept / Friend button depending on the relationship."""
        rel = person.get("rel", "none")
        code = person.get("code")
        if rel == "me":
            return self._label(parent, t("fr_you"), size=8, fg=self.MUTED, bg=bg or self.CARD)
        if rel == "friend":
            return self._label(parent, "\u2665 " + t("rank_friend"), size=8, bold=True, fg=self.PINK,
                               bg=bg or self.CARD)
        if rel == "sent":
            return self._button(parent, t("req_pending"), lambda: self._cancel(code), small=small)
        if rel == "incoming":
            return self._button(parent, t("req_accept"), lambda: self._answer(code, True), primary=True, small=small)
        text = t("rank_request") if person.get("visibility") == "private" else t("rank_add")
        return self._button(parent, "+ " + text, lambda: self._add_code(code), primary=True, small=small)

    def _add_code(self, code):
        self.error = ""
        self.social.add_friend(code)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    def _cancel(self, code):
        self.social.cancel_request(code)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    # ---- ranks (everyone using Pips) ----
    RANK_SORTS = ("xp", "badges", "streak")

    def _render_ranks(self):
        bar = tk.Frame(self.body, bg=self.CARD)
        bar.pack(fill="x", pady=(0, 6))
        self._label(bar, t("rank_title"), size=11, bold=True).pack(side="left")
        for key in reversed(self.RANK_SORTS):
            active = key == self.rank_sort
            btn = self._button(bar, t("rank_sort_" + key), lambda k=key: self._sort_ranks(k), primary=active,
                               small=True)
            btn.pack(side="right", padx=(3, 0))
        data = self.social.leaderboards.get(self.rank_sort)
        if not data:
            self._label(self.body, t("fr_connecting"), fg=self.MUTED).pack(fill="x", pady=8)
            return
        line = t("rank_total", n=data.get("total", 0))
        if data.get("my_rank"):
            line += "  \u00b7  " + t("rank_mine", n=data["my_rank"])
        self._label(self.body, line, size=8, fg=self.MUTED).pack(fill="x", pady=(0, 4))
        my_code = self.social.data.get("code")
        for rank, person in enumerate(data.get("people", []), 1):
            is_me = person.get("code") == my_code
            bg = self.WARM if is_me else self.CARD
            row = tk.Frame(self.body, bg=bg, pady=3)
            row.pack(fill="x")
            medal = {1: self.GOLD, 2: "#9aa3ad", 3: "#b87333"}.get(rank)
            tk.Label(row, text=("\u265b" if rank == 1 else str(rank)), width=3, font=("Segoe UI Symbol", 11, "bold"),
                     fg=medal or self.MUTED, bg=bg).pack(side="left")
            av = self._avatar(row, person.get("species"), person.get("color"), size=36, bg=bg,
                              look=person.get("look"), person=person)
            av.pack(side="left", padx=(2, 6))
            box = tk.Frame(row, bg=bg)
            box.pack(side="left", fill="x", expand=True)
            top = tk.Frame(box, bg=bg)
            top.pack(fill="x")
            name = self._label(top, person.get("name", "?"), size=10, bold=True, bg=bg, cursor="hand2")
            name.pack(side="left")
            if person.get("role") == "owner":
                self._owner_chip(top, bg).pack(side="left", padx=(6, 0))
            if person.get("visibility") == "private":
                self._label(top, " \U0001F512", size=8, fg=self.MUTED, bg=bg).pack(side="left")
            value = {"xp": t("rank_val_xp", n=person.get("xp", 0)), "badges": t("rank_val_badges", n=person.get("badges", 0)),
                     "streak": t("rank_val_streak", n=person.get("streak", 0))}[self.rank_sort]
            self._label(box, t("rank_level", level=person.get("level", 1)) + "  \u00b7  " + value + "  \u00b7  "
                        + t("st_" + (person.get("presence") or "offline")), size=8, fg=self.MUTED, bg=bg).pack(fill="x")
            self._relation_button(row, person, bg=bg).pack(side="right", padx=(4, 2))
            for widget in (row, av, name, box):
                widget.bind("<Button-1>", lambda e, c=person.get("code"): self.open_profile(c))

    def _sort_ranks(self, key):
        self.rank_sort = key
        board = self.social.leaderboards.get(key)
        if not board or time.time() - board.get("_at", 0) > 60:
            self.social.load_leaderboard(key)
        self.refresh()

    # ---- someone's profile ----
    def _render_profile_view(self, code):
        top = tk.Frame(self.body, bg=self.CARD)
        top.pack(fill="x", pady=(0, 6))
        self._button(top, "\u2039 " + t("chat_back"), self._close_profile, small=True).pack(side="left")
        entry = self.social.profiles.get(code)
        if not entry:
            self._label(self.body, t("fr_connecting"), fg=self.MUTED).pack(fill="x", pady=10)
            return
        user = entry["user"]
        full = entry.get("full")
        hero = tk.Frame(self.body, bg=self.WARM, padx=12, pady=10)
        hero.pack(fill="x")
        self._avatar(hero, user.get("species"), user.get("color"), size=88, bg=self.WARM, look=user.get("look"),
                     person=user).pack(side="left")
        box = tk.Frame(hero, bg=self.WARM)
        box.pack(side="left", fill="x", expand=True, padx=(12, 0))
        name_row = tk.Frame(box, bg=self.WARM)
        name_row.pack(fill="x")
        self._label(name_row, user.get("name", "?"), size=14, bold=True, bg=self.WARM).pack(side="left")
        if user.get("role") == "owner":
            self._owner_chip(name_row, self.WARM).pack(side="left", padx=(8, 0))
        if user.get("visibility") == "private":
            self._label(name_row, "  \U0001F512 " + t("vis_private"), size=8, fg=self.MUTED, bg=self.WARM).pack(side="left")
        state = user.get("presence") or "offline"
        self._label(box, self._presence_text(user) + (f"  \u00b7  {user['status_text']}" if user.get("status_text") else ""),
                    size=9, fg=self.PRESENCE.get(state, self.MUTED), bg=self.WARM).pack(fill="x")
        stats = t("rank_level", level=user.get("level", 1)) + "  \u00b7  " + t("rank_val_badges", n=user.get("badges", 0))
        if full:
            stats += "  \u00b7  " + t("rank_val_xp", n=user.get("xp", 0)) + "  \u00b7  " + t("rank_val_streak", n=user.get("streak", 0))
        self._label(box, stats, size=8, fg=self.MUTED, bg=self.WARM).pack(fill="x", pady=(2, 0))
        if user.get("rel") == "friend":
            aff = self._affinity_text(user.get("affinity", 0))
            self._label(box, aff, size=8, fg=self.PINK, bg=self.WARM).pack(fill="x")
            labels = []
            if user.get("label"):
                labels.append(t("lbl_you_call", label=self._label_text(user["label"])))
            if user.get("their_label"):
                labels.append(t("lbl_they_call", label=self._label_text(user["their_label"])))
            if labels:
                self._label(box, "   ".join(labels), size=8, bold=True, fg=self.PINK, bg=self.WARM).pack(fill="x")
        if user.get("role") == "owner":
            own = tk.Frame(self.body, bg=self.CARD)
            own.pack(fill="x", pady=(8, 0))
            self._label(own, "\u265b " + t("owner_creator"), size=9, bold=True, fg=self.GOLD).pack(side="left")
            self._button(own, "\u2709 " + t("credits_email"), self._mail_owner, small=True).pack(side="right")
        acts = tk.Frame(self.body, bg=self.CARD)
        acts.pack(fill="x", pady=(8, 4))
        rel = user.get("rel")
        if rel == "friend":
            room = "dm:" + code
            self._button(acts, "\u2709 " + t("ix_btn_chat"), lambda: self.show_tab("chat", room=room), primary=True,
                         small=True).pack(side="left")
            for kind in ("wave", "visit"):
                self._button(acts, INTERACTION_SYMBOL[kind] + " " + t("ix_btn_" + kind),
                             lambda k=kind: self._interact(room, k), small=True).pack(side="left", padx=(4, 0))
            lb = self._button(acts, "\u2661 " + t("lbl_set"), lambda: None, small=True)
            lb.bind("<Button-1>", lambda e: self._label_menu(e, code, user.get("label", "")))
            lb.pack(side="left", padx=(4, 0))
        elif rel == "me":
            self._button(acts, "\u270e " + t("prof_edit"), lambda: self.show_tab("profile"), small=True).pack(side="left")
        else:
            self._relation_button(acts, user, small=False).pack(side="left")
        if not full:
            card = tk.Frame(self.body, bg=self.TILE, padx=10, pady=10)
            card.pack(fill="x", pady=(6, 0))
            self._label(card, "\U0001F512 " + t("prof_private_title"), bold=True, bg=self.TILE).pack(fill="x")
            self._label(card, t("prof_private_body"), size=8, fg=self.MUTED, bg=self.TILE,
                        wrap=self.WIDTH - 90).pack(fill="x", pady=(2, 0))
            return
        if user.get("bio"):
            self._section_title(t("prof_about"))
            self._label(self.body, user["bio"], wrap=self.WIDTH - 70).pack(fill="x")
        info = user.get("info") or {}
        if info:
            self._section_title(t("prof_info"))
            for key in INFO_FIELDS:
                if info.get(key):
                    row = tk.Frame(self.body, bg=self.CARD)
                    row.pack(fill="x")
                    self._label(row, t("info_" + key), size=8, fg=self.MUTED, width=14).pack(side="left")
                    self._label(row, info[key], size=9).pack(side="left")
        achievements = [a for a in user.get("achievements", []) if a in ACH_SYMBOL]
        if achievements:
            self._section_title(t("prof_badges", n=len(achievements)))
            line = tk.Frame(self.body, bg=self.CARD)
            line.pack(fill="x")
            for i, aid in enumerate(achievements[:40]):
                sym = tk.Label(line, text=ACH_SYMBOL[aid], font=("Segoe UI Symbol", 13), fg=self.GOLD, bg=self.CARD)
                sym.grid(row=i // 14, column=i % 14, padx=1)
        friends = user.get("friends") or []
        self._section_title(t("prof_friends", n=user.get("friends_count", len(friends))))
        if friends:
            grid = tk.Frame(self.body, bg=self.CARD)
            grid.pack(fill="x")
            for i, f in enumerate(friends):
                cell = tk.Frame(grid, bg=self.CARD, cursor="hand2")
                cell.grid(row=i // 6, column=i % 6, padx=3, pady=3, sticky="n")
                av = self._avatar(cell, f.get("species"), f.get("color"), size=40, look=f.get("look"), person=f)
                av.pack()
                nm = tk.Label(cell, text=f.get("name", "?")[:10], font=("Segoe UI", 7), fg=self.INK, bg=self.CARD)
                nm.pack()
                for widget in (cell, av, nm):
                    widget.bind("<Button-1>", lambda e, c=f.get("code"): self.open_profile(c))
        meta = []
        if user.get("member_since"):
            meta.append(t("prof_since", date=datetime.fromtimestamp(user["member_since"]).strftime("%d %b %Y")))
        if state == "offline" and user.get("last_seen"):
            meta.append(t("prof_last_seen", time=datetime.fromtimestamp(user["last_seen"]).strftime("%d %b %H:%M")))
        if meta:
            self._label(self.body, "  \u00b7  ".join(meta), size=8, fg=self.MUTED).pack(fill="x", pady=(10, 0))

    def _section_title(self, text):
        tk.Label(self.body, text=text.upper(), font=("Segoe UI", 8, "bold"), fg=self.ACCENT, bg=self.CARD,
                 anchor="w").pack(fill="x", pady=(10, 2))

    # ---- my profile + app theme ----
    def _render_profile_tab(self):
        self._profile_built = True
        prof = self.social.profile()
        # photo
        self._section_title(t("prof_photo"))
        row = tk.Frame(self.body, bg=self.CARD)
        row.pack(fill="x")
        me = {"code": self.social.data.get("code", ""), "avatar_v": self.social.data.get("avatar_v", 0)}
        self._avatar(row, self.pet.s.get("species"), self.pet.s.get("color"), size=72, look=self.social.my_look(),
                     person=me).pack(side="left")
        btns = tk.Frame(row, bg=self.CARD)
        btns.pack(side="left", padx=10)
        self._button(btns, t("prof_pick_photo"), self._pick_photo, primary=True, small=True).pack(anchor="w")
        self._button(btns, t("prof_use_pet"), self._clear_photo, small=True).pack(anchor="w", pady=(4, 0))
        self._label(btns, t("prof_photo_hint"), size=8, fg=self.MUTED, wrap=300).pack(anchor="w", pady=(4, 0))
        # who can see
        self._section_title(t("prof_visibility"))
        self.vis_var = tk.StringVar(value=prof["visibility"])
        for key in ("public", "private"):
            rb = tk.Radiobutton(self.body, text=t("vis_" + key) + " \u2013 " + t("vis_" + key + "_desc"),
                                variable=self.vis_var, value=key, font=("Segoe UI", 9), bg=self.CARD, fg=self.INK,
                                selectcolor=self.ENTRY, activebackground=self.CARD, activeforeground=self.INK,
                                anchor="w", justify="left", wraplength=self.WIDTH - 80)
            rb.pack(fill="x")
        # status
        self._section_title(t("prof_status"))
        srow = tk.Frame(self.body, bg=self.CARD)
        srow.pack(fill="x")
        self.status_var = tk.StringVar(value=prof["status"])
        for key in STATUSES:
            color = self.PRESENCE.get(key if key != "auto" else "online", self.MUTED)
            rb = tk.Radiobutton(srow, text=("\u25cf " if key != "auto" else "\u21bb ") + t("st_" + key),
                                variable=self.status_var, value=key, font=("Segoe UI", 9), bg=self.CARD,
                                fg=color if key != "auto" else self.INK, selectcolor=self.ENTRY,
                                activebackground=self.CARD)
            rb.pack(side="left")
        self._label(self.body, t("st_auto_hint"), size=8, fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x")
        trow = tk.Frame(self.body, bg=self.CARD)
        trow.pack(fill="x", pady=(4, 0))
        self._label(trow, t("prof_status_text"), size=9).pack(side="left")
        self.status_text_var = tk.StringVar(value=prof["status_text"])
        self._entry(trow, self.status_text_var, width=36).pack(side="left", padx=6)
        # about
        self._section_title(t("prof_about"))
        nrow = tk.Frame(self.body, bg=self.CARD)
        nrow.pack(fill="x")
        self._label(nrow, t("fr_your_name"), width=14).pack(side="left")
        self.pname_var = tk.StringVar(value=self.social.data.get("name") or default_display_name())
        self._entry(nrow, self.pname_var, width=24).pack(side="left")
        self.bio_text = tk.Text(self.body, height=3, font=("Segoe UI", 10), wrap="word", bg=self.ENTRY,
                                fg=self.ENTRY_INK, insertbackground=self.ENTRY_INK, relief="solid", bd=1)
        self.bio_text.insert("1.0", prof["bio"])
        self.bio_text.pack(fill="x", pady=(6, 0))
        self._label(self.body, t("prof_bio_hint"), size=8, fg=self.MUTED).pack(fill="x")
        self.info_vars = {}
        for key in INFO_FIELDS:
            row = tk.Frame(self.body, bg=self.CARD)
            row.pack(fill="x", pady=1)
            self._label(row, t("info_" + key), width=14).pack(side="left")
            var = tk.StringVar(value=prof["info"].get(key, ""))
            self.info_vars[key] = var
            self._entry(row, var, width=34).pack(side="left")
        actions = tk.Frame(self.body, bg=self.CARD)
        actions.pack(fill="x", pady=(10, 0))
        self._button(actions, t("prof_save"), self._save_profile, primary=True).pack(side="left")
        if self.social.enabled and self.social.data.get("code"):
            self._button(actions, "\U0001F441 " + t("prof_preview"),
                         lambda: self.open_profile(self.social.data["code"])).pack(side="left", padx=6)
        else:
            self._label(self.body, t("prof_offline_note"), size=8, fg=self.MUTED,
                        wrap=self.WIDTH - 70).pack(fill="x", pady=(4, 0))
        # theme
        self._section_title(t("theme_title"))
        th = tk.Frame(self.body, bg=self.CARD)
        th.pack(fill="x")
        current = theme.current_name() if theme is not None else "light"
        for key in ("light", "dark"):
            self._button(th, ("\u2600 " if key == "light" else "\u263e ") + t("theme_" + key),
                         lambda k=key: self._set_theme(k), primary=current == key).pack(side="left", padx=(0, 6))
        self._render_credits()

    def _render_credits(self):
        self._section_title(t("credits_title"))
        card = tk.Frame(self.body, bg=self.WARM, padx=10, pady=8)
        card.pack(fill="x")
        version = self.pet.cb.get("version", lambda: "")() if hasattr(self.pet, "cb") else ""
        self._label(card, t("credits_made", v=version, owner=social.OWNER_NAME), bold=True, bg=self.WARM,
                    wrap=self.WIDTH - 90).pack(fill="x")
        self._label(card, t("credits_body", email=social.OWNER_EMAIL), size=8, fg=self.MUTED, bg=self.WARM,
                    wrap=self.WIDTH - 90).pack(fill="x", pady=(2, 6))
        row = tk.Frame(card, bg=self.WARM)
        row.pack(fill="x")
        self._button(row, "\u2709 " + t("credits_email"), self._mail_owner, primary=True, small=True).pack(side="left")
        self._button(row, "\u2398 " + t("credits_copy"), self._copy_owner_email, small=True).pack(side="left", padx=4)
        self._button(row, "\u2302 " + t("credits_site"), self._open_site, small=True).pack(side="left")

    def _copy_owner_email(self):
        try:
            self.win.clipboard_clear()
            self.win.clipboard_append(social.OWNER_EMAIL)
            self.status.config(text=t("fr_copied"), fg=self.MUTED)
        except tk.TclError:
            pass

    def _open_site(self):
        import webbrowser
        webbrowser.open("https://juw12.github.io/projects/pips/")

    def _pick_photo(self):
        from tkinter import filedialog
        path = filedialog.askopenfilename(parent=self.win, title=t("prof_pick_photo"),
                                          filetypes=[(t("prof_images"), "*.png *.jpg *.jpeg *.gif *.bmp *.webp"),
                                                     ("*", "*.*")])
        if not path:
            return
        err = self.social.set_avatar_from_file(path)
        if err:
            self.show_error(err)
            return
        self.pet.set_action("hop", 0.55)
        self.refresh(force=True)

    def _clear_photo(self):
        self.social.clear_avatar()
        self.refresh(force=True)

    def _save_profile(self):
        info = {k: v.get().strip() for k, v in self.info_vars.items() if v.get().strip()}
        changes = {
            "visibility": self.vis_var.get(),
            "status": self.status_var.get(),
            "status_text": self.status_text_var.get().strip()[:60],
            "bio": self.bio_text.get("1.0", "end").strip()[:300],
            "info": info,
        }
        self.social.save_profile(changes, name=self.pname_var.get())
        self.error = ""
        self.pet.set_action("cheer", 1.0)
        self.status.config(text=t("prof_saved"), fg=self.MUTED)

    def _set_theme(self, key):
        setter = self.pet.cb.get("set_theme") if hasattr(self.pet, "cb") else None
        if setter:
            setter(key)       # app recolours everything and re-opens this window (pet.on_theme_changed)
            return
        if theme is not None:
            theme.set_theme(key)
        tab = self.tab
        soc = self.social
        self.close()
        soc.window = None
        soc.open_window(tab)

    # ---- shop ----
    def _render_shop(self):
        shop = getattr(self.pet, "shop", None)
        if pet_shop is None or not shop:
            self._label(self.body, t("shop_unavailable"), fg=self.MUTED).pack(fill="x")
            return
        wallet = self.social.wallet()
        card = tk.Frame(self.body, bg=self.WARM, padx=10, pady=8)
        card.pack(fill="x", pady=(0, 8))
        balance_text = t("shop_unlimited") if wallet.get("unlimited") else t("shop_balance", n=wallet["balance"])
        self._label(card, f"{pet_shop.COIN} " + balance_text, size=14, bold=True,
                    fg=self.GOLD, bg=self.WARM).pack(fill="x")
        self._label(card, t("shop_earned", pom=wallet["pomodoros"], lvl=wallet["levels"], ach=wallet["achievements"],
                            days=wallet["days"], fr=wallet["friends"], soc=wallet["social"], gift=wallet["gift"]),
                    size=8, fg=self.MUTED, bg=self.WARM, wrap=self.WIDTH - 110).pack(fill="x")
        self._label(card, t("shop_how"), size=8, fg=self.INK, bg=self.WARM, wrap=self.WIDTH - 110).pack(fill="x",
                                                                                                   pady=(2, 0))
        balance = wallet["balance"]
        equipped = shop.equipped()
        species = self.pet.s.get("species")
        color = self.pet.s.get("color")

        self._label(self.body, t("shop_props"), size=11, bold=True).pack(fill="x", pady=(6, 2))
        grid = tk.Frame(self.body, bg=self.CARD)
        grid.pack(fill="x")
        for i, (item, (slot, price)) in enumerate(pet_shop.PROPS.items()):
            owned = shop.owns(item)
            wearing = equipped.get(slot) == item
            cell = tk.Frame(grid, bg=self.WARM if wearing else self.TILE, padx=4, pady=4)
            cell.grid(row=i // 3, column=i % 3, sticky="nsew", padx=2, pady=2)
            preview = dict(equipped)
            preview[slot] = item
            cv = tk.Canvas(cell, width=70, height=62, bg=cell["bg"], highlightthickness=0)
            cv.pack()
            try:
                pet_shop.draw_props_preview(cv, self.pet_mod, 30, species, color, {slot: item}, cx=35, floor=58,
                                            t=time.monotonic())
            except Exception:
                pass
            self._label(cell, t("pr_" + item), size=8, bold=True, bg=cell["bg"]).pack(anchor="center")
            if wearing:
                btn = self._button(cell, t("shop_takeoff"), lambda s=slot: self._unequip(s), small=True)
            elif owned:
                btn = self._button(cell, t("shop_wear"), lambda it=item: self._equip(it), small=True, primary=True)
            else:
                btn = self._button(cell, f"{pet_shop.COIN} {price}", lambda it=item: self._buy(it), small=True,
                                   primary=price <= balance)
                if price > balance:
                    btn.config(fg=self.OFF_INK)
            btn.pack(anchor="center", pady=(2, 0))
        for c in range(3):
            grid.grid_columnconfigure(c, weight=1, uniform="p")

        self._label(self.body, t("shop_moves"), size=11, bold=True).pack(fill="x", pady=(10, 2))
        for move, (price, _secs) in pet_shop.MOVES.items():
            owned = shop.owns(move)
            row = tk.Frame(self.body, bg=self.TILE, padx=8, pady=5)
            row.pack(fill="x", pady=2)
            name, _, desc = t("mv_" + move).partition(":")
            box = tk.Frame(row, bg=row["bg"])
            box.pack(side="left", fill="x", expand=True)
            self._label(box, name.strip(), size=10, bold=True, bg=row["bg"]).pack(fill="x")
            self._label(box, desc.strip(), size=8, fg=self.MUTED, bg=row["bg"], wrap=self.WIDTH - 200).pack(fill="x")
            if owned:
                btn = self._button(row, "\u25b6 " + t("shop_do"), lambda m=move: self._do_move(m), small=True,
                                   primary=True)
            else:
                btn = self._button(row, f"{pet_shop.COIN} {price}", lambda m=move: self._buy(m), small=True,
                                   primary=price <= balance)
                if price > balance:
                    btn.config(fg=self.OFF_INK)
            btn.pack(side="right")

    def _buy(self, item):
        shop = self.pet.shop
        balance = self.social.wallet()["balance"]
        if shop.price(item) > balance:
            self.show_error("poor")
            return
        if not shop.buy(item, balance):
            self.show_error("poor")
            return
        name = t("pr_" + item) if item in pet_shop.PROPS else t("mv_" + item).split(":")[0]
        self.error = ""
        self.pet.set_action("cheer", 1.4)
        self.pet._spawn("sparkle", 5)
        self.pet._voice("happy")
        self.pet.say(t("shop_bought", item=name), duration=4, priority=1)
        if item in pet_shop.MOVES:
            self.pet.root.after(1500, lambda: self.pet.do_trick(item))
        self.social.check_achievements(announce=False)
        if self.social.enabled:
            self.social.sync()
        self.refresh()

    def _equip(self, item):
        self.pet.shop.equip(item)
        self.pet.set_action("hop", 0.55)
        if self.social.enabled:
            self.social.sync()
        self.refresh()

    def _unequip(self, slot):
        self.pet.shop.unequip(slot)
        if self.social.enabled:
            self.social.sync()
        self.refresh()

    def _do_move(self, move):
        self.pet.do_trick(move)

    # ---- achievements ----
    def _render_achievements(self):
        unlocked = self.social.data.get("unlocked", {})
        self._label(self.body, t("fr_ach_count", n=len(unlocked), total=len(ACH_IDS)), bold=True).pack(fill="x",
                                                                                                    pady=(0, 6))
        grid = tk.Frame(self.body, bg=self.CARD)
        grid.pack(fill="both", expand=True)
        for i, aid in enumerate(ACH_IDS):
            got = aid in unlocked
            cell = tk.Frame(grid, bg=self.WARM if got else self.TILE_OFF, padx=6, pady=2)
            cell.grid(row=i // 2, column=i % 2, sticky="nsew", padx=2, pady=2)
            tk.Label(cell, text=ACH_SYMBOL[aid], font=("Segoe UI Symbol", 14),
                     fg=self.GOLD if got else self.OFF_SYM, bg=cell["bg"]).pack(side="left")
            name, _, desc = t("ach_" + aid).partition(":")
            box = tk.Frame(cell, bg=cell["bg"])
            box.pack(side="left", fill="x", padx=(4, 0))
            tk.Label(box, text=name.strip(), font=("Segoe UI", 9, "bold"), fg=self.INK if got else self.OFF_INK,
                     bg=cell["bg"], anchor="w").pack(fill="x")
            tk.Label(box, text=desc.strip(), font=("Segoe UI", 8), fg=self.MUTED, bg=cell["bg"], anchor="w",
                     wraplength=180, justify="left").pack(fill="x")
        grid.grid_columnconfigure(0, weight=1, uniform="a")
        grid.grid_columnconfigure(1, weight=1, uniform="a")

    # ---- friend actions ----
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
        if messagebox.askyesno(t("fr_title"), t("fr_remove_q", name=name), parent=self.win):
            self.social.remove_friend(code)

    def _disable(self):
        if messagebox.askyesno(t("fr_title"), t("fr_turn_off_q"), parent=self.win):
            self.social.disable_and_delete()
