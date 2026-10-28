"""
social_ui.py - the "Friends & achievements" window for Pips (see social.py).

Tabs: Friends (board, affinity, pet interactions) | Chat | Groups (your own
invite-only groups) | Teams (open team boards) | Achievements.
All user-facing text comes from i18n.py.
"""

from __future__ import annotations

import time
import tkinter as tk
from datetime import datetime
from tkinter import messagebox

import social
from social import ACH_IDS, ACH_SYMBOL, INTERACTIONS, INTERACTION_SYMBOL, affinity_level, default_display_name

try:
    from i18n import t
except ImportError:  # pragma: no cover
    def t(key, lang=None, **kwargs):
        return key.format(**kwargs) if kwargs else key


class FriendsWindow:
    BG = "#faf8f3"
    CARD = "#ffffff"
    INK = "#1a1a1a"
    MUTED = "#6b6b6b"
    BORDER = "#e2ddd4"
    ACCENT = "#8b1a1a"
    GOLD = "#c8961e"
    PINK = "#e0557a"
    MINE = "#fbeee6"
    THEIRS = "#f1f4f8"
    WIDTH = 500
    TABS = ("friends", "chat", "groups", "teams", "achievements")

    def __init__(self, soc: "social.Social"):
        import pet as pet_mod  # late import: pet imports social

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
            btn = tk.Label(tabs, text=t("fr_tab_" + key), font=("Segoe UI", 9, "bold"), padx=9, pady=4,
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
        self.win.geometry(f"{self.WIDTH}x780")
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
                       fg="#ffffff" if primary else self.INK, bg=self.ACCENT if primary else "#f1ece4",
                       padx=7 if small else 10, pady=1 if small else 3, cursor="hand2")
        btn.bind("<Button-1>", lambda e: command())
        return btn

    def _avatar(self, parent, species, color, size=34, bg=None):
        cv = tk.Canvas(parent, width=size, height=size, bg=bg or self.CARD, highlightthickness=0)
        try:
            sp = species if species in self.pet_mod.SPECIES else "cat"
            look = self.pet_mod.default_look({"species": sp, "color": color or "#ffc78f",
                                              "cheek_color": "#ff8fa3"})
            look["t"] = time.monotonic()
            look["mouth"] = "smile"
            self.pet_mod.draw_pet(cv, size / 2, size - 2, size * 0.62, look)
        except Exception:
            cv.create_oval(4, 4, size - 4, size - 4, fill=color or "#ffc78f", outline="")
        return cv

    def _label(self, parent, text, size=9, bold=False, fg=None, bg=None, wrap=None, **kw):
        return tk.Label(parent, text=text, font=("Segoe UI", size, "bold" if bold else "normal"),
                        fg=fg or self.INK, bg=bg or self.CARD, anchor="w", justify="left",
                        wraplength=wrap or 0, **kw)

    def show_error(self, code):
        messages = {"offline": t("fr_err_offline"), "not_found": t("fr_err_not_found"),
                    "self": t("fr_err_self"), "bad_code": t("fr_err_bad_code"),
                    "too_many": t("fr_err_too_many"), "bad_group": t("fr_err_bad_group"),
                    "too_fast": t("fr_err_too_fast"), "not_friends": t("fr_err_not_friends"),
                    "already_member": t("cir_err_member"), "bad_name": t("cir_err_name")}
        self.error = messages.get(code, t("fr_err_generic", code=code))
        self.refresh()

    def show_tab(self, key, room=None):
        self.tab = key
        self.error = ""
        if key == "chat":
            self.room = room
        self.social.chat_open_room = self.room if key == "chat" else None
        if self.social.chat_open_room:
            self.social.mark_read(self.room)
            self.social._next_inbox = 0
        self.canvas.yview_moveto(0)
        self.refresh()

    # ---- rendering ----
    def refresh(self):
        if not self._alive:
            return
        stats = self.social.stats or self.social.refresh_stats()
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
            btn.config(text=label, bg=self.ACCENT if active else "#f1ece4", fg="#ffffff" if active else self.INK)
        self._render_head(stats)
        if self.tab == "achievements":
            self._render_achievements()
        elif not self.social.enabled:
            self._render_off()
        elif self.tab == "chat":
            self._render_chat()
        elif self.tab == "groups":
            self._render_groups()
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
        self._label(info, f"{name} & {self.pet.s.get('name', 'Pip')}", size=11, bold=True).pack(fill="x")
        self._label(info, t("fr_level_line", level=stats["level"], xp=stats["xp"]), fg=self.ACCENT).pack(fill="x")
        bar = tk.Canvas(info, width=240, height=8, bg=self.CARD, highlightthickness=0)
        bar.pack(anchor="w", pady=(2, 2))
        span = max(1, stats["level_next"] - stats["level_floor"])
        frac = max(0.0, min(1.0, (stats["xp"] - stats["level_floor"]) / span))
        bar.create_rectangle(0, 0, 240, 8, fill="#eeeae3", outline="")
        bar.create_rectangle(0, 0, max(3, 240 * frac), 8, fill=self.GOLD, outline="")
        self._label(info, t("fr_stats_line", today=stats["today_poms"], week=stats["week_poms"],
                            streak=stats["streak"]), size=8, fg=self.MUTED).pack(fill="x")
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
        tk.Entry(row, textvariable=self.name_var, width=18, font=("Segoe UI", 10)).pack(side="left", padx=6)
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
        bg = "#fbf3e6" if is_me else self.CARD
        row = tk.Frame(parent, bg=bg, pady=3)
        row.pack(fill="x")
        if rank is not None:
            tk.Label(row, text=str(rank), width=2, font=("Segoe UI", 10, "bold"),
                     fg=self.GOLD if rank <= 3 else self.MUTED, bg=bg).pack(side="left", anchor="n", pady=6)
        self._avatar(row, person.get("species"), person.get("color"), size=34, bg=bg).pack(side="left", anchor="n",
                                                                                         padx=(2, 6))
        info = tk.Frame(row, bg=bg)
        info.pack(side="left", fill="x", expand=True)
        top = tk.Frame(info, bg=bg)
        top.pack(fill="x")
        name = person.get("name", "?") + ("  " + t("fr_you") if is_me else "")
        self._label(top, name, size=10, bold=is_me, bg=bg).pack(side="left")
        if value_text:
            self._label(top, value_text, size=9, bold=True, fg=self.ACCENT, bg=bg).pack(side="right")
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
        entry = tk.Entry(add, textvariable=self.code_var, width=10, font=("Consolas", 12))
        entry.pack(side="left")
        entry.bind("<Return>", lambda e: self._add())
        self._button(add, t("fr_add"), self._add, primary=True).pack(side="left", padx=6)
        self._label(add, t("fr_add_hint"), size=8, fg=self.MUTED, wrap=200).pack(side="left")
        self._label(self.body, t("fr_today_board"), bold=True).pack(fill="x", pady=(4, 2))
        people = [dict(board.get("me", {}), _me=True)] if board.get("me") else []
        people += board.get("friends", [])
        if len(people) <= 1:
            self._label(self.body, t("fr_no_friends"), fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x", pady=(0, 6))
        people.sort(key=lambda p: (-p.get("today_poms", 0), -p.get("week_poms", 0), p.get("name", "")))
        for rank, person in enumerate(people[:40], 1):
            value = t("fr_poms_value", today=person.get("today_poms", 0), week=person.get("week_poms", 0))
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
                tk.Label(row, text=str(unread), font=("Segoe UI", 8, "bold"), fg="#ffffff", bg=self.ACCENT,
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
        entry = tk.Entry(entry_row, textvariable=self.msg_var, font=("Segoe UI", 10))
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
            card = tk.Frame(self.body, bg="#fbf3e6", padx=8, pady=6)
            card.pack(fill="x", pady=(0, 6))
            self._label(card, t("cir_invite_line", name=inv.get("by", "?"), group=inv.get("name", "?")),
                        bg="#fbf3e6", wrap=self.WIDTH - 90).pack(fill="x")
            row = tk.Frame(card, bg="#fbf3e6")
            row.pack(fill="x", pady=(4, 0))
            self._button(row, t("cir_accept"), lambda c=inv["circle"]: self._respond(c, True), primary=True,
                         small=True).pack(side="left")
            self._button(row, t("cir_decline"), lambda c=inv["circle"]: self._respond(c, False),
                         small=True).pack(side="left", padx=6)
        create = tk.Frame(self.body, bg=self.CARD)
        create.pack(fill="x", pady=(0, 4))
        self._label(create, t("cir_new")).pack(side="left")
        self.circle_var = tk.StringVar()
        entry = tk.Entry(create, textvariable=self.circle_var, width=18, font=("Segoe UI", 10))
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
                menu.config(font=("Segoe UI", 8), bg="#f1ece4", relief="flat", highlightthickness=0)
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

    # ---- open teams ----
    def _render_teams(self):
        board = self.social.board or {}
        row = tk.Frame(self.body, bg=self.CARD)
        row.pack(fill="x")
        self._label(row, t("fr_team_code")).pack(side="left")
        self.group_var = tk.StringVar()
        entry = tk.Entry(row, textvariable=self.group_var, width=10, font=("Consolas", 12))
        entry.pack(side="left", padx=6)
        entry.bind("<Return>", lambda e: self._join())
        self._button(row, t("fr_join"), self._join, primary=True).pack(side="left")
        self._label(self.body, t("fr_team_hint"), size=8, fg=self.MUTED, wrap=self.WIDTH - 70).pack(fill="x", pady=(4, 6))
        groups = board.get("groups", [])
        if not groups:
            self._label(self.body, t("fr_no_teams"), fg=self.MUTED).pack(fill="x")
        for group in groups:
            head = tk.Frame(self.body, bg=self.CARD)
            head.pack(fill="x", pady=(8, 2))
            members = sorted(group.get("members", []),
                             key=lambda p: (-p.get("week_poms", 0), -p.get("today_poms", 0), p.get("name", "")))
            self._label(head, t("fr_team_head", team=group["code"], n=len(members)), size=10, bold=True).pack(side="left")
            leave = tk.Label(head, text=t("fr_leave"), font=("Segoe UI", 8, "underline"), fg=self.MUTED,
                             bg=self.CARD, cursor="hand2")
            leave.pack(side="right")
            leave.bind("<Button-1>", lambda e, g=group["code"]: self.social.leave_group(g))
            for rank, person in enumerate(members[:20], 1):
                self._person_row(self.body, rank, person, t("fr_week_value", n=person.get("week_poms", 0)),
                                 is_me=person.get("me", False))

    # ---- achievements ----
    def _render_achievements(self):
        unlocked = self.social.data.get("unlocked", {})
        self._label(self.body, t("fr_ach_count", n=len(unlocked), total=len(ACH_IDS)), bold=True).pack(fill="x",
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
            tk.Label(box, text=name.strip(), font=("Segoe UI", 9, "bold"), fg=self.INK if got else "#9a958c",
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

    def _join(self):
        group = "".join(ch for ch in self.group_var.get().upper() if ch.isalnum() or ch in "-_")
        if len(group) < 2:
            self.show_error("bad_group")
            return
        self.error = ""
        self.social.join_group(group)
        self.status.config(text=t("fr_connecting"), fg=self.MUTED)

    def _disable(self):
        if messagebox.askyesno(t("fr_title"), t("fr_turn_off_q"), parent=self.win):
            self.social.disable_and_delete()
