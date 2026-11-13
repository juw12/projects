"""
KiniBuka - a local-discovery app for UMKM stalls, branches and bazaars.

Run:  python server.py  [--open]
Then open http://localhost:8000  (phones on the same Wi-Fi: http://<your-PC-IP>:8000)

Pure Python standard library: http.server + sqlite3. No pip installs needed.

Settings (environment variables, all optional):
  APP_NAME            brand name shown in the app (default "KiniBuka")
  PORT                web port (default 8000)
  WA_PROVIDER         "fonnte" or "meta" to send automatic WhatsApp messages
  FONNTE_TOKEN        token from fonnte.com            (WA_PROVIDER=fonnte)
  WA_TOKEN            Meta WhatsApp Cloud API token    (WA_PROVIDER=meta)
  WA_PHONE_NUMBER_ID  Meta phone-number ID             (WA_PROVIDER=meta)
  WA_TEMPLATE         approved Meta template name with one body variable {{1}} (optional)
  WA_TEMPLATE_LANG    template language code, default "id"
"""
import datetime
import json
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "kinibuka.db")
STATIC_DIR = os.path.join(HERE, "static")
PORT = int(os.environ.get("PORT", "8000"))
APP_NAME = os.environ.get("APP_NAME", "KiniBuka")
WA_PROVIDER = os.environ.get("WA_PROVIDER", "").strip().lower()

LANGUAGES = ["id", "en", "zh"]
DEFAULT_LANG = "id"
CATEGORIES = ["Food", "Drinks", "Snacks", "Fashion", "Crafts", "Services", "Other"]
POST_TYPES = ["promo", "info", "grand_opening"]

# ---------------------------------------------------------------- translations (server side)

ERRORS = {
    "login_required": {"en": "Please log in first", "id": "Silakan masuk dulu", "zh": "请先登录"},
    "field_required": {"en": "'{field}' is required", "id": "'{field}' wajib diisi", "zh": "「{field}」为必填项"},
    "field_number": {"en": "'{field}' must be a number", "id": "'{field}' harus berupa angka", "zh": "「{field}」必须是数字"},
    "field_range": {"en": "'{field}' is out of range", "id": "'{field}' di luar batas", "zh": "「{field}」超出范围"},
    "invalid_phone": {
        "en": "Please enter a valid phone / WhatsApp number",
        "id": "Masukkan nomor HP / WhatsApp yang valid",
        "zh": "请输入有效的手机 / WhatsApp 号码",
    },
    "stall_not_found": {"en": "Stall not found", "id": "Lapak tidak ditemukan", "zh": "找不到该摊位"},
    "not_your_stall": {"en": "This is not your stall", "id": "Ini bukan lapakmu", "zh": "这不是你的摊位"},
    "unknown_category": {"en": "Unknown category", "id": "Kategori tidak dikenal", "zh": "未知类别"},
    "branch_not_found": {"en": "Branch not found", "id": "Cabang tidak ditemukan", "zh": "找不到该分店"},
    "unknown_post_type": {"en": "Unknown post type", "id": "Jenis posting tidak dikenal", "zh": "未知的发布类型"},
    "branch_mismatch": {
        "en": "Branch does not belong to this stall",
        "id": "Cabang ini bukan milik lapak tersebut",
        "zh": "该分店不属于此摊位",
    },
    "item_not_found": {"en": "Item not found", "id": "Produk tidak ditemukan", "zh": "找不到该商品"},
    "end_before_start": {
        "en": "End date is before start date",
        "id": "Tanggal selesai sebelum tanggal mulai",
        "zh": "结束日期早于开始日期",
    },
    "bazaar_not_found": {"en": "Bazaar not found", "id": "Bazar tidak ditemukan", "zh": "找不到该市集"},
    "order_not_found": {"en": "Order not found", "id": "Pesanan tidak ditemukan", "zh": "找不到该订单"},
    "choose_branch": {"en": "Please choose a branch", "id": "Pilih cabang dulu", "zh": "请选择分店"},
    "branch_closed": {
        "en": "That branch is closed right now",
        "id": "Cabang itu sedang tutup",
        "zh": "该分店目前已打烊",
    },
    "item_unavailable": {
        "en": "An item in your order is no longer available",
        "id": "Ada produk di pesananmu yang sudah habis",
        "zh": "订单中的某件商品已售罄",
    },
    "order_empty": {"en": "Your order is empty", "id": "Pesananmu masih kosong", "zh": "你的订单是空的"},
    "not_your_order": {"en": "Not your order", "id": "Bukan pesananmu", "zh": "这不是你的订单"},
    "bad_transition": {
        "en": "Cannot change order from {old} to {new}",
        "id": "Status pesanan tidak bisa diubah dari {old} ke {new}",
        "zh": "订单状态无法从 {old} 改为 {new}",
    },
    "invalid_json": {"en": "Invalid request", "id": "Permintaan tidak valid", "zh": "无效请求"},
    "not_found": {"en": "Not found", "id": "Tidak ditemukan", "zh": "未找到"},
    "server_error": {"en": "Server error", "id": "Terjadi kesalahan server", "zh": "服务器错误"},
    "method_not_allowed": {"en": "Method not allowed", "id": "Metode tidak diizinkan", "zh": "不允许的请求方法"},
}

WA_TEXT = {
    "new_order": {
        "id": "{app}: Pesanan baru #{id}\nLapak: {stall} ({branch})\n{items}\nTotal: {total}\nPembeli: {customer} ({phone}){note}\n\nBuka {app} untuk menerima pesanan.",
        "en": "{app}: New order #{id}\nStall: {stall} ({branch})\n{items}\nTotal: {total}\nCustomer: {customer} ({phone}){note}\n\nOpen {app} to accept it.",
        "zh": "{app}：新订单 #{id}\n摊位：{stall}（{branch}）\n{items}\n合计：{total}\n顾客：{customer}（{phone}）{note}\n\n请打开 {app} 接单。",
    },
    "note": {"id": "\nCatatan: {note}", "en": "\nNote: {note}", "zh": "\n备注：{note}"},
    "accepted": {
        "id": "{app}: Pesanan #{id} di {stall} sudah diterima dan sedang disiapkan.",
        "en": "{app}: Your order #{id} at {stall} was accepted and is being prepared.",
        "zh": "{app}：您在 {stall} 的订单 #{id} 已接单，正在准备。",
    },
    "ready": {
        "id": "{app}: Pesanan #{id} sudah SIAP diambil di {stall} ({branch}).",
        "en": "{app}: Your order #{id} is READY for pickup at {stall} ({branch}).",
        "zh": "{app}：您的订单 #{id} 已可在 {stall}（{branch}）取货。",
    },
    "done": {
        "id": "{app}: Terima kasih sudah belanja di {stall}!",
        "en": "{app}: Thank you for supporting {stall}!",
        "zh": "{app}：感谢您支持 {stall}！",
    },
    "rejected": {
        "id": "{app}: Maaf, pesanan #{id} di {stall} tidak bisa diproses saat ini.",
        "en": "{app}: Sorry, {stall} can't take order #{id} right now.",
        "zh": "{app}：抱歉，{stall} 目前无法处理订单 #{id}。",
    },
    "cancelled": {
        "id": "{app}: Pesanan #{id} dibatalkan oleh pembeli ({customer}).",
        "en": "{app}: Order #{id} was cancelled by the customer ({customer}).",
        "zh": "{app}：订单 #{id} 已被顾客（{customer}）取消。",
    },
}


def pick_lang(lang):
    return lang if lang in LANGUAGES else DEFAULT_LANG


def translate(table, key, lang, **params):
    entry = table[key]
    return entry.get(pick_lang(lang), entry["en"]).format(**params)


def rupiah(amount):
    return "Rp " + f"{int(amount):,}".replace(",", ".")


# ---------------------------------------------------------------- database

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    token TEXT UNIQUE NOT NULL,
    lang TEXT NOT NULL DEFAULT 'id',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stalls(
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🏪',
    description TEXT NOT NULL DEFAULT '',
    whatsapp TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS branches(
    id INTEGER PRIMARY KEY,
    stall_id INTEGER NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    hours TEXT NOT NULL DEFAULT '',
    is_open INTEGER NOT NULL DEFAULT 0,
    status_note TEXT NOT NULL DEFAULT '',
    status_updated_at INTEGER NOT NULL,
    opening_date TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS menu_items(
    id INTEGER PRIMARY KEY,
    stall_id INTEGER NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price INTEGER NOT NULL,
    available INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS activities(
    id INTEGER PRIMARY KEY,
    stall_id INTEGER REFERENCES stalls(id) ON DELETE CASCADE,
    branch_id INTEGER,
    bazaar_id INTEGER,
    type TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS follows(
    user_id INTEGER NOT NULL,
    stall_id INTEGER NOT NULL,
    PRIMARY KEY(user_id, stall_id)
);
CREATE TABLE IF NOT EXISTS bazaars(
    id INTEGER PRIMARY KEY,
    organizer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bazaar_stalls(
    bazaar_id INTEGER NOT NULL,
    stall_id INTEGER NOT NULL,
    PRIMARY KEY(bazaar_id, stall_id)
);
CREATE TABLE IF NOT EXISTS orders(
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    stall_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    items_json TEXT NOT NULL,
    total INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
"""

db_lock = threading.Lock()
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.execute("PRAGMA foreign_keys = ON")
db.executescript(SCHEMA)
# Upgrade databases created by the first version (no language column yet).
if "lang" not in [r["name"] for r in db.execute("PRAGMA table_info(users)")]:
    db.execute("ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'id'")
    db.commit()


def now():
    return int(time.time())


def rows(sql, args=()):
    return [dict(r) for r in db.execute(sql, args).fetchall()]


def one(sql, args=()):
    r = db.execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, args=()):
    cur = db.execute(sql, args)
    db.commit()
    return cur.lastrowid


def log_activity(type_, message="", stall_id=None, branch_id=None, bazaar_id=None, at=None):
    run(
        "INSERT INTO activities(stall_id, branch_id, bazaar_id, type, message, created_at) "
        "VALUES(?,?,?,?,?,?)",
        (stall_id, branch_id, bazaar_id, type_, message, at or now()),
    )


# ---------------------------------------------------------------- WhatsApp (optional automatic messages)

def wa_number(phone):
    digits = re.sub(r"[^0-9]", "", str(phone))
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    return digits


def send_whatsapp(phone, text):
    """Send in the background so a slow gateway never blocks the app."""
    if not WA_PROVIDER or not phone:
        return
    threading.Thread(target=_send_whatsapp, args=(phone, text), daemon=True).start()


def _send_whatsapp(phone, text):
    try:
        if WA_PROVIDER == "fonnte":
            data = urllib.parse.urlencode({"target": wa_number(phone), "message": text}).encode()
            request = urllib.request.Request(
                "https://api.fonnte.com/send",
                data=data,
                headers={"Authorization": os.environ["FONNTE_TOKEN"]},
            )
        elif WA_PROVIDER == "meta":
            template = os.environ.get("WA_TEMPLATE", "").strip()
            body = {"messaging_product": "whatsapp", "to": wa_number(phone)}
            if template:
                # Template variables may not contain new lines.
                flat_text = re.sub(r"\s*\n+\s*", " · ", text)[:1000]
                body.update({
                    "type": "template",
                    "template": {
                        "name": template,
                        "language": {"code": os.environ.get("WA_TEMPLATE_LANG", "id")},
                        "components": [{"type": "body", "parameters": [{"type": "text", "text": flat_text}]}],
                    },
                })
            else:
                body.update({"type": "text", "text": {"body": text}})
            request = urllib.request.Request(
                f"https://graph.facebook.com/v20.0/{os.environ['WA_PHONE_NUMBER_ID']}/messages",
                data=json.dumps(body).encode(),
                headers={
                    "Authorization": "Bearer " + os.environ["WA_TOKEN"],
                    "Content-Type": "application/json",
                },
            )
        else:
            sys.stderr.write(f"WhatsApp: unknown WA_PROVIDER '{WA_PROVIDER}'\n")
            return
        with urllib.request.urlopen(request, timeout=15) as response:
            sys.stderr.write(f"WhatsApp sent to {wa_number(phone)}: HTTP {response.status}\n")
    except Exception as err:  # never crash the app because of WhatsApp
        sys.stderr.write(f"WhatsApp send failed ({WA_PROVIDER}): {err!r}\n")


def notify_new_order(order_id):
    o = one(
        "SELECT o.*, s.name AS stall_name, s.whatsapp, b.label AS branch_label, "
        "u.name AS customer_name, u.phone AS customer_phone, owner.lang AS owner_lang "
        "FROM orders o JOIN stalls s ON s.id=o.stall_id JOIN branches b ON b.id=o.branch_id "
        "JOIN users u ON u.id=o.customer_id JOIN users owner ON owner.id=s.owner_id WHERE o.id=?",
        (order_id,),
    )
    lang = o["owner_lang"]
    items = "\n".join(f"{i['qty']}× {i['name']}" for i in json.loads(o["items_json"]))
    note = translate(WA_TEXT, "note", lang, note=o["note"]) if o["note"] else ""
    text = translate(
        WA_TEXT, "new_order", lang,
        app=APP_NAME, id=o["id"], stall=o["stall_name"], branch=o["branch_label"], items=items,
        total=rupiah(o["total"]), customer=o["customer_name"], phone=o["customer_phone"], note=note,
    )
    send_whatsapp(o["whatsapp"], text)


def notify_status_change(order_id):
    o = one(
        "SELECT o.*, s.name AS stall_name, s.whatsapp, b.label AS branch_label, "
        "u.name AS customer_name, u.phone AS customer_phone, u.lang AS customer_lang, owner.lang AS owner_lang "
        "FROM orders o JOIN stalls s ON s.id=o.stall_id JOIN branches b ON b.id=o.branch_id "
        "JOIN users u ON u.id=o.customer_id JOIN users owner ON owner.id=s.owner_id WHERE o.id=?",
        (order_id,),
    )
    params = dict(app=APP_NAME, id=o["id"], stall=o["stall_name"], branch=o["branch_label"], customer=o["customer_name"])
    if o["status"] == "cancelled":
        send_whatsapp(o["whatsapp"], translate(WA_TEXT, "cancelled", o["owner_lang"], **params))
    elif o["status"] in ("accepted", "ready", "done", "rejected"):
        send_whatsapp(o["customer_phone"], translate(WA_TEXT, o["status"], o["customer_lang"], **params))


# ---------------------------------------------------------------- request helpers

class ApiError(Exception):
    def __init__(self, status, key, **params):
        super().__init__(key)
        self.status = status
        self.key = key
        self.params = params


class Ctx:
    def __init__(self, user, body, query, params, lang):
        self.user = user
        self.body = body
        self.query = query
        self.params = params
        self.lang = lang

    def require_user(self):
        if not self.user:
            raise ApiError(401, "login_required")
        return self.user

    def text(self, key, max_len=200, required=False, default=""):
        value = self.body.get(key, default)
        value = "" if value is None else str(value).strip()
        if required and not value:
            raise ApiError(400, "field_required", field=key)
        return value[:max_len]

    def number(self, key, required=True, minimum=None, maximum=None):
        try:
            value = float(self.body.get(key))
        except (TypeError, ValueError):
            if required:
                raise ApiError(400, "field_number", field=key)
            return None
        if minimum is not None and value < minimum or maximum is not None and value > maximum:
            raise ApiError(400, "field_range", field=key)
        return value


ROUTES = []


def route(method, pattern):
    def decorator(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn))
        return fn
    return decorator


def owned_stall(ctx, stall_id):
    user = ctx.require_user()
    stall = one("SELECT * FROM stalls WHERE id=?", (stall_id,))
    if not stall:
        raise ApiError(404, "stall_not_found")
    if stall["owner_id"] != user["id"]:
        raise ApiError(403, "not_your_stall")
    return stall


def branch_dict(b):
    b = dict(b)
    b["is_open"] = bool(b["is_open"])
    return b


def public_user(u):
    return {"id": u["id"], "name": u["name"], "phone": u["phone"], "lang": u["lang"]}


# ---------------------------------------------------------------- config + auth

@route("GET", "/api/config")
def config(ctx):
    return {
        "app_name": APP_NAME,
        "languages": LANGUAGES,
        "wa_auto": bool(WA_PROVIDER),
        "categories": CATEGORIES,
    }


@route("POST", "/api/login")
def login(ctx):
    name = ctx.text("name", 60, required=True)
    phone = re.sub(r"[^0-9+]", "", ctx.text("phone", 30, required=True))
    if len(phone) < 8:
        raise ApiError(400, "invalid_phone")
    user = one("SELECT * FROM users WHERE phone=?", (phone,))
    if not user:
        token = secrets.token_hex(16)
        run(
            "INSERT INTO users(name, phone, token, lang, created_at) VALUES(?,?,?,?,?)",
            (name, phone, token, ctx.lang, now()),
        )
        user = one("SELECT * FROM users WHERE phone=?", (phone,))
    elif user["lang"] != ctx.lang:
        run("UPDATE users SET lang=? WHERE id=?", (ctx.lang, user["id"]))
        user["lang"] = ctx.lang
    return {"token": user["token"], "user": public_user(user)}


@route("GET", "/api/me")
def me(ctx):
    if not ctx.user:
        return {"user": None, "following": []}
    following = [r["stall_id"] for r in rows("SELECT stall_id FROM follows WHERE user_id=?", (ctx.user["id"],))]
    return {"user": public_user(ctx.user), "following": following}


# ---------------------------------------------------------------- stalls

@route("GET", "/api/stalls")
def list_stalls(ctx):
    stalls = rows("SELECT * FROM stalls ORDER BY created_at DESC")
    branches = rows("SELECT * FROM branches ORDER BY created_at")
    followers = {
        r["stall_id"]: r["n"]
        for r in rows("SELECT stall_id, COUNT(*) AS n FROM follows GROUP BY stall_id")
    }
    # Available items only: Explore and the 3D market show what can be ordered right now.
    menus = {}
    for item in rows("SELECT id, stall_id, name, price FROM menu_items WHERE available=1 ORDER BY id"):
        menus.setdefault(item["stall_id"], []).append({"id": item["id"], "name": item["name"], "price": item["price"]})
    by_stall = {}
    for b in branches:
        by_stall.setdefault(b["stall_id"], []).append(branch_dict(b))
    for s in stalls:
        s["branches"] = by_stall.get(s["id"], [])
        s["followers"] = followers.get(s["id"], 0)
        s["menu"] = menus.get(s["id"], [])
        s["menu_count"] = len(s["menu"])
        s["any_open"] = any(b["is_open"] for b in s["branches"])
    return {"stalls": stalls, "categories": CATEGORIES}


@route("POST", "/api/stalls")
def create_stall(ctx):
    user = ctx.require_user()
    category = ctx.text("category", 30, required=True)
    if category not in CATEGORIES:
        raise ApiError(400, "unknown_category")
    stall_id = run(
        "INSERT INTO stalls(owner_id, name, category, emoji, description, whatsapp, created_at) "
        "VALUES(?,?,?,?,?,?,?)",
        (
            user["id"],
            ctx.text("name", 60, required=True),
            category,
            ctx.text("emoji", 8) or "🏪",
            ctx.text("description", 500),
            re.sub(r"[^0-9+]", "", ctx.text("whatsapp", 30)) or user["phone"],
            now(),
        ),
    )
    log_activity("new_stall", ctx.text("description", 140), stall_id=stall_id)
    return {"id": stall_id}


@route("GET", r"/api/stalls/(\d+)")
def stall_detail(ctx):
    stall_id = int(ctx.params[0])
    stall = one("SELECT * FROM stalls WHERE id=?", (stall_id,))
    if not stall:
        raise ApiError(404, "stall_not_found")
    stall["branches"] = [branch_dict(b) for b in rows("SELECT * FROM branches WHERE stall_id=? ORDER BY created_at", (stall_id,))]
    stall["menu"] = rows("SELECT * FROM menu_items WHERE stall_id=? ORDER BY id", (stall_id,))
    for m in stall["menu"]:
        m["available"] = bool(m["available"])
    stall["posts"] = rows(
        "SELECT a.*, b.label AS branch_label, b.opening_date, z.name AS bazaar_name, "
        "z.start_date AS bazaar_start, z.end_date AS bazaar_end FROM activities a "
        "LEFT JOIN branches b ON b.id=a.branch_id LEFT JOIN bazaars z ON z.id=a.bazaar_id "
        "WHERE a.stall_id=? ORDER BY a.created_at DESC LIMIT 15",
        (stall_id,),
    )
    stall["bazaars"] = rows(
        "SELECT z.* FROM bazaars z JOIN bazaar_stalls bs ON bs.bazaar_id=z.id "
        "WHERE bs.stall_id=? ORDER BY z.start_date",
        (stall_id,),
    )
    stall["followers"] = one("SELECT COUNT(*) AS n FROM follows WHERE stall_id=?", (stall_id,))["n"]
    stall["is_following"] = bool(
        ctx.user and one("SELECT 1 FROM follows WHERE user_id=? AND stall_id=?", (ctx.user["id"], stall_id))
    )
    stall["is_owner"] = bool(ctx.user and ctx.user["id"] == stall["owner_id"])
    return stall


@route("POST", r"/api/stalls/(\d+)/follow")
def toggle_follow(ctx):
    user = ctx.require_user()
    stall_id = int(ctx.params[0])
    if not one("SELECT 1 FROM stalls WHERE id=?", (stall_id,)):
        raise ApiError(404, "stall_not_found")
    if one("SELECT 1 FROM follows WHERE user_id=? AND stall_id=?", (user["id"], stall_id)):
        run("DELETE FROM follows WHERE user_id=? AND stall_id=?", (user["id"], stall_id))
        return {"following": False}
    run("INSERT INTO follows(user_id, stall_id) VALUES(?,?)", (user["id"], stall_id))
    return {"following": True}


@route("POST", r"/api/stalls/(\d+)/branches")
def add_branch(ctx):
    stall = owned_stall(ctx, int(ctx.params[0]))
    lat = ctx.number("lat", minimum=-90, maximum=90)
    lng = ctx.number("lng", minimum=-180, maximum=180)
    opening_date = ctx.text("opening_date", 10)
    today = datetime.date.today().isoformat()
    is_open = 1 if ctx.body.get("is_open") and (not opening_date or opening_date <= today) else 0
    address = ctx.text("address", 200)
    branch_id = run(
        "INSERT INTO branches(stall_id, label, address, lat, lng, hours, is_open, status_note, "
        "status_updated_at, opening_date, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (stall["id"], ctx.text("label", 60, required=True), address, lat, lng, ctx.text("hours", 60),
         is_open, "", now(), opening_date, now()),
    )
    # The app shows the opening date itself (in the reader's language); the message is just the address.
    activity_type = "grand_opening" if opening_date and opening_date > today else "new_branch"
    log_activity(activity_type, address, stall_id=stall["id"], branch_id=branch_id)
    return {"id": branch_id}


@route("POST", r"/api/branches/(\d+)/status")
def set_branch_status(ctx):
    branch = one("SELECT * FROM branches WHERE id=?", (int(ctx.params[0]),))
    if not branch:
        raise ApiError(404, "branch_not_found")
    owned_stall(ctx, branch["stall_id"])
    is_open = 1 if ctx.body.get("is_open") else 0
    note = ctx.text("note", 140)
    run(
        "UPDATE branches SET is_open=?, status_note=?, status_updated_at=? WHERE id=?",
        (is_open, note, now(), branch["id"]),
    )
    log_activity("open" if is_open else "close", note, stall_id=branch["stall_id"], branch_id=branch["id"])
    return {"ok": True}


@route("DELETE", r"/api/branches/(\d+)")
def delete_branch(ctx):
    branch = one("SELECT * FROM branches WHERE id=?", (int(ctx.params[0]),))
    if not branch:
        raise ApiError(404, "branch_not_found")
    owned_stall(ctx, branch["stall_id"])
    run("DELETE FROM branches WHERE id=?", (branch["id"],))
    return {"ok": True}


@route("POST", r"/api/stalls/(\d+)/posts")
def add_post(ctx):
    stall = owned_stall(ctx, int(ctx.params[0]))
    type_ = ctx.text("type", 20) or "info"
    if type_ not in POST_TYPES:
        raise ApiError(400, "unknown_post_type")
    branch_id = ctx.body.get("branch_id") or None
    if branch_id and not one("SELECT 1 FROM branches WHERE id=? AND stall_id=?", (branch_id, stall["id"])):
        raise ApiError(400, "branch_mismatch")
    log_activity(type_, ctx.text("message", 300, required=True), stall_id=stall["id"], branch_id=branch_id)
    return {"ok": True}


# ---------------------------------------------------------------- menu

@route("POST", r"/api/stalls/(\d+)/menu")
def add_menu_item(ctx):
    stall = owned_stall(ctx, int(ctx.params[0]))
    price = int(ctx.number("price", minimum=0, maximum=100_000_000))
    item_id = run(
        "INSERT INTO menu_items(stall_id, name, price, available) VALUES(?,?,?,1)",
        (stall["id"], ctx.text("name", 80, required=True), price),
    )
    return {"id": item_id}


@route("POST", r"/api/menu/(\d+)")
def update_menu_item(ctx):
    item = one("SELECT * FROM menu_items WHERE id=?", (int(ctx.params[0]),))
    if not item:
        raise ApiError(404, "item_not_found")
    owned_stall(ctx, item["stall_id"])
    run("UPDATE menu_items SET available=? WHERE id=?", (1 if ctx.body.get("available") else 0, item["id"]))
    return {"ok": True}


@route("DELETE", r"/api/menu/(\d+)")
def delete_menu_item(ctx):
    item = one("SELECT * FROM menu_items WHERE id=?", (int(ctx.params[0]),))
    if not item:
        raise ApiError(404, "item_not_found")
    owned_stall(ctx, item["stall_id"])
    run("DELETE FROM menu_items WHERE id=?", (item["id"],))
    return {"ok": True}


# ---------------------------------------------------------------- feed

@route("GET", "/api/feed")
def feed(ctx):
    items = rows(
        "SELECT a.*, s.name AS stall_name, s.emoji AS stall_emoji, s.category AS stall_category, "
        "b.label AS branch_label, b.opening_date, z.name AS bazaar_name, "
        "z.start_date AS bazaar_start, z.end_date AS bazaar_end FROM activities a "
        "LEFT JOIN stalls s ON s.id=a.stall_id LEFT JOIN branches b ON b.id=a.branch_id "
        "LEFT JOIN bazaars z ON z.id=a.bazaar_id ORDER BY a.created_at DESC, a.id DESC LIMIT 80"
    )
    return {"items": items}


# ---------------------------------------------------------------- bazaars

@route("GET", "/api/bazaars")
def list_bazaars(ctx):
    bazaars = rows("SELECT * FROM bazaars ORDER BY start_date")
    members = rows(
        "SELECT bs.bazaar_id, s.id, s.name, s.emoji FROM bazaar_stalls bs JOIN stalls s ON s.id=bs.stall_id"
    )
    for z in bazaars:
        z["stalls"] = [
            {"id": m["id"], "name": m["name"], "emoji": m["emoji"]}
            for m in members if m["bazaar_id"] == z["id"]
        ]
    return {"bazaars": bazaars}


@route("POST", "/api/bazaars")
def create_bazaar(ctx):
    user = ctx.require_user()
    start = ctx.text("start_date", 10, required=True)
    end = ctx.text("end_date", 10) or start
    if end < start:
        raise ApiError(400, "end_before_start")
    description = ctx.text("description", 500)
    bazaar_id = run(
        "INSERT INTO bazaars(organizer_id, name, address, lat, lng, start_date, end_date, description, created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (user["id"], ctx.text("name", 80, required=True), ctx.text("address", 200),
         ctx.number("lat", minimum=-90, maximum=90), ctx.number("lng", minimum=-180, maximum=180),
         start, end, description, now()),
    )
    log_activity("bazaar_new", description, bazaar_id=bazaar_id)
    return {"id": bazaar_id}


@route("POST", r"/api/bazaars/(\d+)/join")
def join_bazaar(ctx):
    bazaar = one("SELECT * FROM bazaars WHERE id=?", (int(ctx.params[0]),))
    if not bazaar:
        raise ApiError(404, "bazaar_not_found")
    stall = owned_stall(ctx, int(ctx.number("stall_id")))
    if one("SELECT 1 FROM bazaar_stalls WHERE bazaar_id=? AND stall_id=?", (bazaar["id"], stall["id"])):
        run("DELETE FROM bazaar_stalls WHERE bazaar_id=? AND stall_id=?", (bazaar["id"], stall["id"]))
        return {"joined": False}
    run("INSERT INTO bazaar_stalls(bazaar_id, stall_id) VALUES(?,?)", (bazaar["id"], stall["id"]))
    log_activity("bazaar_join", "", stall_id=stall["id"], bazaar_id=bazaar["id"])
    return {"joined": True}


# ---------------------------------------------------------------- orders

ORDER_FLOW_OWNER = {"pending": {"accepted", "rejected"}, "accepted": {"ready"}, "ready": {"done"}}
ORDER_FLOW_CUSTOMER = {"pending": {"cancelled"}}


def order_rows(where, args):
    result = rows(
        "SELECT o.*, s.name AS stall_name, s.emoji AS stall_emoji, s.whatsapp AS stall_whatsapp, "
        "b.label AS branch_label, b.lat, b.lng, u.name AS customer_name, u.phone AS customer_phone "
        "FROM orders o JOIN stalls s ON s.id=o.stall_id JOIN branches b ON b.id=o.branch_id "
        "JOIN users u ON u.id=o.customer_id WHERE " + where + " ORDER BY o.created_at DESC LIMIT 60",
        args,
    )
    for o in result:
        o["items"] = json.loads(o.pop("items_json"))
    return result


@route("POST", "/api/orders")
def place_order(ctx):
    user = ctx.require_user()
    branch = one("SELECT * FROM branches WHERE id=?", (ctx.body.get("branch_id"),))
    if not branch:
        raise ApiError(400, "choose_branch")
    if not branch["is_open"]:
        raise ApiError(400, "branch_closed")
    lines = []
    for entry in ctx.body.get("items") or []:
        qty = int(entry.get("qty", 0))
        if qty <= 0:
            continue
        item = one("SELECT * FROM menu_items WHERE id=? AND stall_id=?", (entry.get("menu_id"), branch["stall_id"]))
        if not item or not item["available"]:
            raise ApiError(400, "item_unavailable")
        lines.append({"menu_id": item["id"], "name": item["name"], "price": item["price"], "qty": min(qty, 99)})
    if not lines:
        raise ApiError(400, "order_empty")
    total = sum(line["price"] * line["qty"] for line in lines)
    order_id = run(
        "INSERT INTO orders(customer_id, stall_id, branch_id, items_json, total, note, status, created_at, updated_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (user["id"], branch["stall_id"], branch["id"], json.dumps(lines), total,
         ctx.text("note", 200), "pending", now(), now()),
    )
    notify_new_order(order_id)
    return {"order": order_rows("o.id=?", (order_id,))[0], "wa_auto": bool(WA_PROVIDER)}


@route("GET", "/api/orders/mine")
def my_orders(ctx):
    user = ctx.require_user()
    return {"orders": order_rows("o.customer_id=?", (user["id"],))}


@route("GET", "/api/orders/incoming")
def incoming_orders(ctx):
    user = ctx.require_user()
    return {"orders": order_rows("s.owner_id=?", (user["id"],))}


@route("POST", r"/api/orders/(\d+)/status")
def update_order(ctx):
    user = ctx.require_user()
    order = one(
        "SELECT o.*, s.owner_id FROM orders o JOIN stalls s ON s.id=o.stall_id WHERE o.id=?",
        (int(ctx.params[0]),),
    )
    if not order:
        raise ApiError(404, "order_not_found")
    new_status = ctx.text("status", 20, required=True)
    if order["owner_id"] == user["id"]:
        allowed = ORDER_FLOW_OWNER.get(order["status"], set())
    elif order["customer_id"] == user["id"]:
        allowed = ORDER_FLOW_CUSTOMER.get(order["status"], set())
    else:
        raise ApiError(403, "not_your_order")
    if new_status not in allowed:
        raise ApiError(400, "bad_transition", old=order["status"], new=new_status)
    run("UPDATE orders SET status=?, updated_at=? WHERE id=?", (new_status, now(), order["id"]))
    notify_status_change(order["id"])
    return {"ok": True}


# ---------------------------------------------------------------- demo data

def seed():
    if one("SELECT 1 FROM stalls LIMIT 1"):
        return
    t = now()
    today = datetime.date.today()

    def user(name, phone, token):
        return run(
            "INSERT INTO users(name, phone, token, lang, created_at) VALUES(?,?,?,?,?)",
            (name, phone, token, DEFAULT_LANG, t),
        )

    def stall(owner, name, cat, emoji, desc, wa, age_h):
        sid = run(
            "INSERT INTO stalls(owner_id, name, category, emoji, description, whatsapp, created_at) VALUES(?,?,?,?,?,?,?)",
            (owner, name, cat, emoji, desc, wa, t - age_h * 3600),
        )
        log_activity("new_stall", desc, stall_id=sid, at=t - age_h * 3600)
        return sid

    def branch(sid, label, address, lat, lng, hours, is_open, note, age_min, opening_date=""):
        return run(
            "INSERT INTO branches(stall_id, label, address, lat, lng, hours, is_open, status_note, "
            "status_updated_at, opening_date, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (sid, label, address, lat, lng, hours, is_open, note, t - age_min * 60, opening_date,
             t - age_min * 60 - 86400),
        )

    def menu(sid, items):
        for name, price in items:
            run("INSERT INTO menu_items(stall_id, name, price, available) VALUES(?,?,?,1)", (sid, name, price))

    seller = user("Bu Sari (demo)", "081111111111", "demo-seller")
    others = user("Pak Udin", "081222222222", secrets.token_hex(16))
    user("Andi (demo)", "081333333333", "demo-buyer")

    s1 = stall(others, "Martabak Bang Udin", "Food", "🥞", "Martabak manis & telor, keju melimpah sejak 2015.", "081222222222", 240)
    b1 = branch(s1, "Kemang", "Jl. Kemang Raya No. 12", -6.2607, 106.8136, "16:00-23:00", 1, "Adonan fresh, siap!", 25)
    b1b = branch(s1, "Tebet", "Jl. Tebet Raya No. 8", -6.2297, 106.8521, "17:00-23:00", 0, "Buka jam 5 sore", 300)
    menu(s1, [("Martabak Manis Coklat Keju", 45000), ("Martabak Telor Spesial", 50000), ("Martabak Mini Pandan", 20000)])

    s2 = stall(others, "Kopi Senja Gerobak", "Drinks", "☕", "Kopi gerobak — es kopi susu gula aren.", "081222222222", 200)
    b2 = branch(s2, "Sudirman (dekat MRT)", "Jl. Jend. Sudirman, Senayan", -6.2275, 106.8030, "07:00-14:00", 1, "", 50)
    menu(s2, [("Es Kopi Susu Gula Aren", 18000), ("Americano", 15000), ("Matcha Latte", 22000)])

    s3 = stall(seller, "Batik Bu Sari", "Fashion", "👗", "Batik tulis & cap asli Pekalongan.", "081111111111", 180)
    b3 = branch(s3, "Blok M Square", "Blok M Square Lt. 2", -6.2443, 106.8001, "10:00-21:00", 1, "", 120)
    menu(s3, [("Kemeja Batik Cap", 150000), ("Selendang Batik Tulis", 95000)])

    s4 = stall(others, "Es Teh Jumbo Kuningan", "Drinks", "🥤", "Es teh 1 liter, cuma 5 ribu!", "081222222222", 30)
    b4 = branch(s4, "Kuningan", "Jl. Prof. Dr. Satrio", -6.2241, 106.8269, "09:00-21:00", 1, "Grand opening — beli 1 gratis 1!", 15)
    menu(s4, [("Es Teh Jumbo", 5000), ("Es Teh Lemon Jumbo", 8000), ("Es Teh Leci", 10000)])

    s5 = stall(others, "Sate Padang Ajo", "Food", "🍢", "Sate Padang kuah kental, resep Pariaman.", "081222222222", 400)
    b5 = branch(s5, "Menteng", "Jl. Cikini Raya", -6.1907, 106.8389, "17:00-24:00", 0, "Habis untuk hari ini, terima kasih!", 90)
    menu(s5, [("Sate Padang (10 tusuk)", 30000), ("Ketupat", 5000)])

    s6 = stall(others, "Keripik Pedas Mak Ijah", "Snacks", "🌶️", "Keripik singkong level 1-10.", "081222222222", 100)
    b6 = branch(s6, "Rawamangun", "Pasar Rawamangun", -6.1937, 106.8890, "08:00-17:00", 1, "", 200)
    menu(s6, [("Keripik Level 5 (250g)", 20000), ("Keripik Level 10 (250g)", 22000), ("Makaroni Pedas", 15000)])

    bazaar_sql = (
        "INSERT INTO bazaars(organizer_id, name, address, lat, lng, start_date, end_date, description, created_at) "
        "VALUES(?,?,?,?,?,?,?,?,?)"
    )
    z1_desc = "60+ lapak lokal, live music, gratis masuk."
    z1 = run(bazaar_sql, (
        seller, "Bazar UMKM GBK Weekend", "Parkir Timur GBK, Senayan", -6.2183, 106.8016,
        (today + datetime.timedelta(days=3)).isoformat(), (today + datetime.timedelta(days=5)).isoformat(),
        z1_desc, t - 7200,
    ))
    z2_desc = "Pasar malam — kuliner & kerajinan."
    z2 = run(bazaar_sql, (
        seller, "Pasar Malam Kota Tua", "Taman Fatahillah, Kota Tua", -6.1352, 106.8133,
        today.isoformat(), (today + datetime.timedelta(days=1)).isoformat(), z2_desc, t - 20000,
    ))
    log_activity("bazaar_new", z2_desc, bazaar_id=z2, at=t - 20000)
    log_activity("bazaar_new", z1_desc, bazaar_id=z1, at=t - 7200)
    for z, s in [(z1, s1), (z1, s3), (z1, s6), (z2, s5), (z2, s2)]:
        run("INSERT INTO bazaar_stalls(bazaar_id, stall_id) VALUES(?,?)", (z, s))
    log_activity("bazaar_join", "", stall_id=s3, bazaar_id=z1, at=t - 5000)

    log_activity("new_branch", "Jl. Tebet Raya No. 8", stall_id=s1, branch_id=b1b, at=t - 86400)
    log_activity("open", "", stall_id=s6, branch_id=b6, at=t - 200 * 60)
    log_activity("close", "Habis untuk hari ini, terima kasih!", stall_id=s5, branch_id=b5, at=t - 90 * 60)
    log_activity("open", "", stall_id=s3, branch_id=b3, at=t - 120 * 60)
    log_activity("promo", "Diskon 20% semua kemeja batik minggu ini.", stall_id=s3, branch_id=b3, at=t - 100 * 60)
    log_activity("open", "", stall_id=s2, branch_id=b2, at=t - 50 * 60)
    log_activity("open", "Adonan fresh, siap!", stall_id=s1, branch_id=b1, at=t - 25 * 60)
    log_activity("grand_opening", "Grand opening hari ini — beli 1 gratis 1 sampai jam 5 sore!", stall_id=s4, branch_id=b4, at=t - 15 * 60)
    log_activity("open", "Grand opening — beli 1 gratis 1!", stall_id=s4, branch_id=b4, at=t - 14 * 60)


# ---------------------------------------------------------------- http

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "KiniBuka/1.1"

    def log_message(self, fmt, *args):
        first = str(args[0]) if args else ""
        is_api_write = "/api/" in first and not first.startswith("GET ")
        if is_api_write or not first.startswith(("GET ", "POST ", "DELETE ")):
            sys.stderr.write("%s  %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_DELETE(self):
        self.dispatch("DELETE")

    def send_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, err, lang):
        self.send_json(err.status, {"error": translate(ERRORS, err.key, lang, **err.params), "code": err.key})

    def dispatch(self, method):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api(method, parsed)
        elif method == "GET":
            self.serve_static(parsed.path)
        else:
            self.send_error_json(ApiError(405, "method_not_allowed"), DEFAULT_LANG)

    def handle_api(self, method, parsed):
        lang = pick_lang(self.headers.get("X-Lang", ""))
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}") if length else {}
            if not isinstance(body, dict):
                raise ValueError
        except ValueError:
            return self.send_error_json(ApiError(400, "invalid_json"), lang)

        auth = self.headers.get("Authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else ""
        for route_method, pattern, fn in ROUTES:
            match = pattern.match(parsed.path)
            if route_method == method and match:
                try:
                    with db_lock:
                        user = one("SELECT * FROM users WHERE token=?", (token,)) if token else None
                        if user and self.headers.get("X-Lang") and user["lang"] != lang:
                            # Remember each user's language for automatic WhatsApp messages.
                            run("UPDATE users SET lang=? WHERE id=?", (lang, user["id"]))
                            user["lang"] = lang
                        ctx = Ctx(user, body, parse_qs(parsed.query), match.groups(), lang)
                        result = fn(ctx)
                    return self.send_json(200, result)
                except ApiError as err:
                    return self.send_error_json(err, lang)
                except Exception as err:  # keep the server alive on unexpected errors
                    sys.stderr.write(f"ERROR {method} {parsed.path}: {err!r}\n")
                    return self.send_error_json(ApiError(500, "server_error"), lang)
        self.send_error_json(ApiError(404, "not_found"), lang)

    def serve_static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.realpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        static_root = os.path.realpath(STATIC_DIR)
        # commonpath (not startswith) so a sibling like "static_old/" can never be served
        if os.path.commonpath([full, static_root]) != static_root or not os.path.isfile(full):
            full = os.path.join(STATIC_DIR, "index.html")
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", CONTENT_TYPES.get(os.path.splitext(full)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128  # many phones polling at once should not get "connection refused"
    # On Windows, address reuse lets two programs silently share one port; never allow that.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def start_server(preferred_port, attempts=50):
    """Use the preferred port, or the next free one if another program already has it."""
    for port in range(preferred_port, preferred_port + attempts):
        try:
            return AppServer(("0.0.0.0", port), Handler), port
        except OSError:
            if port == preferred_port:
                print(f"Port {port} is busy (another program uses it) - looking for a free port...")
    raise SystemExit(f"No free port found between {preferred_port} and {preferred_port + attempts - 1}")


def main():
    with db_lock:
        seed()
    server, port = start_server(PORT)
    print(f"{APP_NAME} is running")
    print(f"  On this PC:         http://localhost:{port}")
    print(f"  Phones (same WiFi): http://{lan_ip()}:{port}")
    print(f"  Automatic WhatsApp: {WA_PROVIDER or 'off (buyers/sellers use one-tap WhatsApp buttons)'}")
    print("  Press Ctrl+C to stop.")
    if "--open" in sys.argv:
        webbrowser.open(f"http://localhost:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
