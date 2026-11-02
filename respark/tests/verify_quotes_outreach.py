"""
Titian supplier quotes + outreach hardening - hermetic end-to-end verification.

Boots the server on a temp DB and a free port, then checks:
  * supplier quotes on an RFQ: .xlsx (stdlib reader), Indonesian and Chinese
    e-mail text, USD conversion, cost per piece by volume, MOQ / missing-info flags,
    operator-only access, delete, bad uploads;
  * supplier follow-ups in the supplier's language, Excel download, RFQ e-mails
    (EN / ZH / ID) and optional AI reading against a fake OpenAI-compatible server;
  * outreach: hardware-startup templates, daily limit + send delay, follow-ups
    stop when a lead leaves the active states, IMAP reply/bounce detection
    (fake mailbox), won buyer lead becomes a customer RFQ.

Usage:
    RESPARK_SECRET=test python tests/verify_quotes_outreach.py
"""

import base64
import http.server
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile

TMP = tempfile.mkdtemp(prefix="respark-quotes-test-")
os.environ.setdefault("RESPARK_SECRET", "test-secret-do-not-use-in-prod")
os.environ.setdefault("RESPARK_BASE_URL", "http://localhost")
os.environ.setdefault("RESPARK_ALLOW_SIGNUP", "1")
os.environ["RESPARK_SMTP_HOST"] = ""
os.environ.pop("RESPARK_OPERATOR_EMAILS", None)
os.environ.pop("RESPARK_FX", None)
os.environ.pop("RESPARK_OPENAI_API_KEY", None)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "..", "server")))

import server  # noqa: E402
import inbox  # noqa: E402
import quotes  # noqa: E402

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

BATAM_EMAIL = """Supplier: PT Batam Mitra Plastik
Terima kasih atas RFQ-nya. Berikut penawaran kami untuk ENV-1 housing set:
Harga satuan (per set):
- 1.000 pcs : Rp 24.500
- 5.000 pcs : Rp 18.900
- 10.000 pcs : Rp 17.600
Biaya cetakan (mold, 2 cavity, milik customer): Rp 145.000.000
Waktu pembuatan cetakan: 5 minggu sampai sampel T1
Waktu produksi: 14 hari setelah PO
Pembayaran: DP 50%, sisa Net 30
Harga EXW Batam, belum termasuk PPN."""

DONGGUAN_EMAIL = """Juwen 您好，感谢询价。我司报价如下（美金）：
1K pcs  USD 1.65/pc
5K pcs  USD 1.18/pc
10K pcs USD 1.02/pc
模具费：USD 8,500（2穴，P20钢）
MOQ：3000pcs
交期：20-25天
付款：T/T
东莞易成模具塑胶有限公司"""

SHENZHEN_ROWS = [
    ["供应商", "深圳宏达精密塑胶有限公司"],
    ["数量 (pcs)", "单价 (RMB/套)"],
    ["1000", "9.8"],
    ["5000", "7.6"],
    ["10000", "6.9"],
    ["模具费", "68000", "RMB"],
    ["开模周期 (T1)", "35天"],
    ["量产交期", "15天"],
    ["最小起订量", "1000"],
    ["贸易条款", "FOB 深圳"],
    ["付款方式", "30%定金，70%出货前付清"],
    ["报价有效期", "30天"],
]


def make_xlsx(rows):
    """Tiny .xlsx with inline strings / numbers, written with zipfile only."""
    def cell(ref, value):
        try:
            float(value)
            return f'<c r="{ref}"><v>{value}</v></c>'
        except ValueError:
            text = value.replace("&", "&amp;").replace("<", "&lt;")
            return f'<c r="{ref}" t="inlineStr"><is><t>{text}</t></is></c>'
    sheet_rows = []
    for r, row in enumerate(rows, 1):
        cells = "".join(cell(f"{chr(65 + c)}{r}", v) for c, v in enumerate(row))
        sheet_rows.append(f'<row r="{r}">{cells}</row>')
    sheet = ('<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/'
             'spreadsheetml/2006/main"><sheetData>' + "".join(sheet_rows) + "</sheetData></worksheet>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Client:
    def __init__(self, base):
        self.base = base
        self.cookies = {}

    def request(self, method, path, body=None, expect_status=None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        if self.cookies:
            req.add_header("Cookie", "; ".join(f"{k}={v}" for k, v in self.cookies.items()))
        try:
            with OPENER.open(req, timeout=15) as r:
                status, headers, raw = r.status, r.headers, r.read()
        except urllib.error.HTTPError as e:
            status, headers, raw = e.code, e.headers, e.read()
        for h in headers.get_all("Set-Cookie") or []:
            k, _, v = h.split(";")[0].partition("=")
            if v:
                self.cookies[k] = v
        payload = json.loads(raw.decode("utf-8")) if raw and "json" in headers.get("Content-Type", "") else raw
        if expect_status is not None:
            assert status == expect_status, f"{method} {path} -> {status}: {str(payload)[:300]}"
        return status, payload


class FakeLLM(http.server.BaseHTTPRequestHandler):
    """OpenAI-compatible /chat/completions that returns a fixed extraction."""
    seen = []
    reply = {
        "supplier": "Ningbo Kaida Mould", "currency": "USD",
        "price_breaks": [{"qty": 2000, "unit_price": 1.4}, {"qty": 8000, "unit_price": 1.1}],
        "tooling_cost": None, "moq": 2000, "incoterm": "FOB Ningbo", "validity_days": 45,
        "lead_time_days": None, "tooling_lead_time_days": 28, "payment_terms": None,
        "notes": ["packaging extra"],
    }

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeLLM.seen.append({"auth": self.headers.get("Authorization"), "body": body})
        out = json.dumps({"choices": [{"message": {"content": json.dumps(FakeLLM.reply)}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


AI_QUOTE = """Hello, quotation for Kite Robotics arm cover.
Qty 2000 pcs: USD 1.40 / pc
Qty 8000 pcs: USD 1.10 / pc
Mould: USD 6,200 (1 cavity)
Production lead time: 3 weeks after PO
Payment: 30% deposit, 70% before shipment
Best regards, Ningbo Kaida Mould"""


class FakeIMAP:
    """Inbox with one reply from replied.test and one bounce for bounce@gone.test."""
    def __init__(self, host):
        self.host = host

    def login(self, user, password):
        assert user and password

    def select(self, *args, **kwargs):
        return "OK", [b"2"]

    def search(self, charset, query):
        if "replied.test" in query:
            return "OK", [b"1"]
        if "mailer-daemon" in query:
            return "OK", [b"2"]
        return "OK", [b""]

    def fetch(self, number, parts):
        raw = (b"From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nSubject: Delivery Status Notification\r\n\r\n"
               b"Address not found: bounce@gone.test")
        return "OK", [(b"2 (RFC822)", raw)]

    def logout(self):
        pass


def run():
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    server.DB_PATH = os.path.join(TMP, "data.db")
    server.LOG_FILE = os.path.join(TMP, "outbox.log")
    server.APP_LOG = os.path.join(TMP, "app.log")
    server.init_db()
    server.load_web()
    httpd = server.ThreadedServer(("127.0.0.1", port), server.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)

    failures = []

    def check(label, cond, detail=""):
        print(("  OK   " if cond else "  FAIL ") + label + ("" if cond else f"  {detail}"))
        if not cond:
            failures.append(label)

    try:
        op = Client(base)
        other = Client(base)
        anon = Client(base)
        op.request("POST", "/api/auth/signup", {"email": "me@titian.test", "password": "operator-pass-1"}, expect_status=200)
        other.request("POST", "/api/auth/signup", {"email": "owner@x.test", "password": "owner-pass-12"}, expect_status=200)

        # --- a buyer RFQ arrives on the hub
        anon.request("POST", "/api/ic/inquiries", {"type": "customer", "fields": {
            "name": "Maya", "email": "maya@buyer.test", "company": "ENV Labs",
            "volume": "5000 pcs", "message": "Need a PC/ABS sensor enclosure, 2 parts."}}, expect_status=200)
        s, data = op.request("GET", "/api/ic/inquiries", expect_status=200)
        qid = data["inquiries"][0]["id"]

        # --- supplier quotes
        xlsx = base64.b64encode(make_xlsx(SHENZHEN_ROWS)).decode()
        s, a = op.request("POST", f"/api/ic/inquiries/{qid}/quotes",
                          {"filename": "shenzhen.xlsx", "content_b64": xlsx}, expect_status=200)
        ex = a["extracted"]
        check("xlsx quote read without openpyxl", ex["currency"] == "CNY" and ex["tooling_cost"] == 68000
              and [b["unit_price"] for b in ex["price_breaks"]] == [9.8, 7.6, 6.9], ex)
        check("xlsx: lead times, MOQ, Incoterm", ex["tooling_lead_time_days"] == 35 and ex["lead_time_days"] == 15
              and ex["moq"] == 1000 and ex["incoterm"] == "FOB 深圳", ex)
        s, b = op.request("POST", f"/api/ic/inquiries/{qid}/quotes", {"text": BATAM_EMAIL}, expect_status=200)
        eb = b["extracted"]
        check("Indonesian quote: Rp thousands dots parsed", eb["price_breaks"][1]["unit_price"] == 18900
              and eb["tooling_cost"] == 145_000_000 and eb["currency"] == "IDR", eb)
        check("Indonesian quote: minggu -> days", eb["tooling_lead_time_days"] == 35 and eb["lead_time_days"] == 14, eb)
        s, c = op.request("POST", f"/api/ic/inquiries/{qid}/quotes",
                          {"text": DONGGUAN_EMAIL, "supplier": "Dongguan Yicheng"}, expect_status=200)
        ec = c["extracted"]
        check("Chinese quote: 1K pcs / USD / range upper bound", ec["price_breaks"][0]["qty"] == 1000
              and ec["moq"] == 3000 and ec["lead_time_days"] == 25 and ec["supplier"] == "Dongguan Yicheng", ec)

        split_line = quotes.extract(quotes.rows_from_text("FOB Shenzhen\nPayment: T/T\nMould: USD 6,200"), "x")
        check("Incoterm stops at the line end; bare 'Mould:' label read as tooling",
              split_line["incoterm"] == "FOB Shenzhen" and split_line["tooling_cost"] == 6200, split_line)

        s, cmp_data = op.request("GET", f"/api/ic/inquiries/{qid}/quotes", expect_status=200)
        check("target volume defaults from the RFQ form (5000 pcs)", cmp_data["target"] == 5000, cmp_data["target"])
        s, cmp_data = op.request("GET", f"/api/ic/inquiries/{qid}/quotes?target=5000&volumes=1000,5000,20000",
                                 expect_status=200)
        comp = cmp_data["comparison"]
        check("three quotes compared at 3 volumes", len(comp["rows"]) == 3 and comp["volumes"] == [1000, 5000, 20000])
        by_name = {r["supplier"]: r for r in comp["rows"]}
        shenzhen = by_name["深圳宏达精密塑胶有限公司"]["evaluation"]["scenarios"]["5000"]
        expected = (7.6 / 7.1 * 5000 * 1.07 + 68000 / 7.1) / 5000  # FOB 7% freight allowance
        check("cost/pc = (unit*V + tooling + freight)/V, in USD", abs(shenzhen["cost_per_pc"] - expected) < 0.001,
              (shenzhen["cost_per_pc"], expected))
        dongguan = by_name["Dongguan Yicheng"]["evaluation"]
        check("below-MOQ volume flagged and not ranked best", dongguan["scenarios"]["1000"]["below_moq"]
              and comp["best_by_volume"]["1000"] != "Dongguan Yicheng", comp["best_by_volume"])
        messages = " | ".join(i["message"] for i in dongguan["issues"])
        check("missing Incoterm / tooling LT / validity flagged",
              "Incoterm" in messages and "Tooling / T1" in messages and "validity" in messages, messages)
        check("best supplier per volume reported", set(comp["best_by_volume"]) == {"1000", "5000", "20000"})

        # --- supplier follow-ups (in the supplier's language)
        check("AI reading off without a key", cmp_data["ai_available"] is False)
        zh_followup = by_name["Dongguan Yicheng"]["followup"]
        check("follow-up drafted in Chinese for the Chinese quote",
              zh_followup and zh_followup["language"] == "zh" and "贸易条款" in zh_followup["body"]
              and "低于贵司 MOQ 3,000 pcs" in zh_followup["body"], zh_followup)
        id_followup = by_name["PT Batam Mitra Plastik"]["followup"]
        check("follow-up drafted in Bahasa for the Indonesian quote",
              id_followup and id_followup["language"] == "id" and "MOQ" in id_followup["body"]
              and id_followup["subject"].startswith("RE: Penawaran"), id_followup)
        check("complete quote gets no follow-up", by_name["深圳宏达精密塑胶有限公司"]["followup"] is None,
              by_name["深圳宏达精密塑胶有限公司"]["followup"])
        check("follow-up names the project and leaves no placeholders",
              "ENV Labs" in zh_followup["body"] and "{" not in zh_followup["body"] + id_followup["body"])

        # --- Excel download
        s, xbytes = op.request("GET", f"/api/ic/inquiries/{qid}/quotes.xlsx?target=5000&volumes=1000,5000,20000")
        names = zipfile.ZipFile(io.BytesIO(xbytes)).namelist() if s == 200 else []
        check("Excel download with 4 sheets", s == 200 and sum(n.startswith("xl/worksheets/") for n in names) == 4,
              (s, names))
        sheet_rows = quotes._xlsx_rows(xbytes) if s == 200 else []
        flat = " ".join(" ".join(str(c) for c in row) for row in sheet_rows)
        check("Excel comparison lists every supplier and the formula",
              all(name in flat for name in ("Dongguan Yicheng", "PT Batam Mitra Plastik", "深圳宏达精密塑胶有限公司"))
              and "freight/duty allowance" in flat, flat[:300])
        sheet1 = zipfile.ZipFile(io.BytesIO(xbytes)).read("xl/worksheets/sheet1.xml").decode() if s == 200 else ""
        check("Excel marks the cheapest supplier per volume", sheet1.count(' s="2"') == 3, sheet1.count(' s="2"'))
        s, _ = other.request("GET", f"/api/ic/inquiries/{qid}/quotes.xlsx")
        check("Excel download is operator-only", s == 403, s)

        # --- RFQ e-mails (EN / ZH / ID)
        s, rfq = op.request("POST", f"/api/ic/inquiries/{qid}/rfq", {
            "part": "Sensor enclosure, 2 parts", "destination": "Singapore", "due": "15 Nov",
            "specs": "PC/ABS, UL94 V-0\nTexture MT-11010", "target": 5000, "volumes": "1000,5000,20000"})
        rfqs = (rfq or {}).get("rfqs", {}) if s == 200 else {}
        check("RFQ drafted in English, Chinese and Bahasa", s == 200 and set(rfqs) == {"en", "zh", "id"}, (s, rfq))
        en, zh, idn = rfqs.get("en", {}), rfqs.get("zh", {}), rfqs.get("id", {})
        check("RFQ asks a price for every volume",
              all(f"@ {v} pcs" in en.get("body", "") for v in ("1,000", "5,000", "20,000"))
              and "单价 @ 20,000 pcs" in zh.get("body", "") and "Harga satuan @ 1,000 pcs" in idn.get("body", ""), en)
        check("RFQ carries part, specs and reply-by date",
              "Sensor enclosure" in en.get("body", "") and "- UL94 V-0" not in en.get("body", "")
              and "- PC/ABS, UL94 V-0" in en.get("body", "") and "15 Nov" in zh.get("body", "")
              and zh.get("subject", "").startswith("询价"), en.get("body", "")[:400])
        check("RFQ has no leftover placeholders", all("{" not in r["body"] for r in rfqs.values()))
        s, _ = other.request("POST", f"/api/ic/inquiries/{qid}/rfq", {"part": "x"})
        check("RFQ writer is operator-only", s == 403, s)

        s, _ = other.request("GET", f"/api/ic/inquiries/{qid}/quotes")
        check("quotes are operator-only", s == 403, s)
        s, _ = op.request("POST", f"/api/ic/inquiries/{qid}/quotes",
                          {"filename": "broken.xlsx", "content_b64": base64.b64encode(b"not a zip").decode()})
        check("broken upload rejected with 400", s == 400, s)
        s, _ = op.request("POST", f"/api/ic/inquiries/{qid}/quotes", {"text": "   "})
        check("empty quote rejected", s == 400, s)
        op.request("POST", f"/api/ic/quotes/{c['id']}/delete", expect_status=200)
        s, cmp_data = op.request("GET", f"/api/ic/inquiries/{qid}/quotes", expect_status=200)
        check("quote deleted", len(cmp_data["quotes"]) == 2)

        # --- optional AI reading (fake OpenAI-compatible server, no network)
        llm_port = free_port()
        llm_httpd = http.server.HTTPServer(("127.0.0.1", llm_port), FakeLLM)
        threading.Thread(target=llm_httpd.serve_forever, daemon=True).start()
        os.environ["RESPARK_OPENAI_API_KEY"] = "sk-test"
        os.environ["RESPARK_OPENAI_BASE_URL"] = f"http://127.0.0.1:{llm_port}/v1"
        try:
            s, cmp_data = op.request("GET", f"/api/ic/inquiries/{qid}/quotes", expect_status=200)
            check("AI reading offered when a key is set", cmp_data["ai_available"] is True)
            s, plain = op.request("POST", f"/api/ic/inquiries/{qid}/quotes", {"text": AI_QUOTE}, expect_status=200)
            check("AI is not used unless the operator ticks it",
                  not FakeLLM.seen and plain["extracted"]["method"] == "rules", plain["extracted"].get("method"))
            s, smart = op.request("POST", f"/api/ic/inquiries/{qid}/quotes", {"text": AI_QUOTE, "use_ai": True},
                                  expect_status=200)
            ai = smart["extracted"]
            check("AI reading called with the quote text and the key",
                  len(FakeLLM.seen) == 1 and FakeLLM.seen[0]["auth"] == "Bearer sk-test"
                  and "Kite Robotics" in FakeLLM.seen[0]["body"]["messages"][1]["content"], FakeLLM.seen[:1])
            check("AI values used (Incoterm, validity, MOQ, tooling LT)",
                  ai["incoterm"] == "FOB Ningbo" and ai["validity_days"] == 45 and ai["moq"] == 2000
                  and ai["tooling_lead_time_days"] == 28 and ai["method"].startswith("ai:"), ai)
            check("rule-based reader fills what AI left empty (tooling, lead time, payment)",
                  ai["tooling_cost"] == 6200 and ai["lead_time_days"] == 21 and ai["payment_terms"], ai)
            os.environ["RESPARK_OPENAI_BASE_URL"] = f"http://127.0.0.1:{free_port()}/v1"
            s, broken = op.request("POST", f"/api/ic/inquiries/{qid}/quotes", {"text": AI_QUOTE, "use_ai": True},
                                   expect_status=200)
            check("AI failure falls back to the built-in reader",
                  bool(broken.get("ai_error")) and broken["extracted"]["method"] == "rules"
                  and broken["extracted"]["tooling_cost"] == 6200, broken)
        finally:
            llm_httpd.shutdown()
            os.environ.pop("RESPARK_OPENAI_API_KEY", None)
            os.environ.pop("RESPARK_OPENAI_BASE_URL", None)

        # --- outreach: hardware startups (demand side)
        csv_text = ("business_name,contact_name,email,industry,city\n"
                    "ENV Labs,Maya,maya@replied.test,hardware_startup,Singapore\n"
                    "Gone Co,Ben,bounce@gone.test,hardware_startup,Austin\n"
                    "Quiet Co,Sam,sam@quiet.test,hardware_startup,Berlin\n")
        s, imp = op.request("POST", "/api/outreach/leads/import", {"csv": csv_text}, expect_status=200)
        check("hardware-startup leads imported with 3-step sequences", imp.get("imported") == 3 and imp.get("queued") == 9, imp)
        with server._db_lock, server.db() as conn:
            body = conn.execute("""SELECT oe.subject, oe.body FROM outreach_emails oe JOIN leads l ON l.id=oe.lead_id
                                   WHERE l.business_name='ENV Labs' AND oe.sequence_num=1""").fetchone()
        check("hardware template rendered", body["subject"] == "Production help for ENV Labs?"
              and "factory quotes" in body["body"] and "{{" not in body["body"], dict(body))

        settings = dict(server.get_outreach_settings(), daily_send_limit=2, delay_between_seconds=0)
        now = server.utcnow()
        with server._db_lock, server.db() as conn:
            due = server.due_outreach_rows(conn, settings, now)
        check("one email per scheduler tick", len(due) == 1, len(due))
        for _ in range(3):
            with server._db_lock, server.db() as conn:
                rows = server.due_outreach_rows(conn, settings, server.utcnow())
            for r in rows:
                server.send_outreach_email_now(r["id"])
        with server._db_lock, server.db() as conn:
            sent_today = conn.execute("SELECT COUNT(*) AS n FROM outreach_emails WHERE status='sent'").fetchone()["n"]
            due = server.due_outreach_rows(conn, settings, server.utcnow())
        check("daily_send_limit enforced (2 sent, nothing more due)", sent_today == 2 and due == [], (sent_today, len(due)))
        with server._db_lock, server.db() as conn:
            due = server.due_outreach_rows(conn, dict(settings, daily_send_limit=50, delay_between_seconds=3600),
                                           server.utcnow())
        check("delay_between_seconds enforced", due == [], len(due))

        s, leads = op.request("GET", "/api/outreach/leads", expect_status=200)
        ids = {l["business_name"]: l["id"] for l in leads["leads"]}
        s, patched = op.request("POST", f"/api/outreach/leads/{ids['Quiet Co']}/patch", {"status": "dead"}, expect_status=200)
        check("marking a lead dead cancels its follow-ups", patched.get("cancelled_followups") == 3, patched)

        # make sure both remaining leads have a sent first email, then scan the fake inbox
        with server._db_lock, server.db() as conn:
            for name in ("ENV Labs", "Gone Co"):
                conn.execute("""UPDATE outreach_emails SET status='sent', sent_at=? WHERE lead_id=? AND sequence_num=1""",
                             (server.utcnow(), ids[name]))
                conn.execute("UPDATE leads SET status='sent' WHERE id=?", (ids[name],))
        notices = []
        original = (server.SMTP_HOST, server.SMTP_USER, server.SMTP_PASS, server.send_email)
        server.SMTP_HOST, server.SMTP_USER, server.SMTP_PASS = "smtp.gmail.com", "me@titian.test", "app-pass"
        server.send_email = lambda to, subject, body, html=None: notices.append((to, subject)) or True
        try:
            check("IMAP host derived from SMTP host", inbox.settings(server)["host"] == "imap.gmail.com")
            result = inbox.check(server, imap_factory=FakeIMAP)
        finally:
            server.SMTP_HOST, server.SMTP_USER, server.SMTP_PASS, server.send_email = original
        check("reply detected", result["replied"] == ["ENV Labs"], result)
        check("bounce detected", result["bounced"] == ["Gone Co"], result)
        with server._db_lock, server.db() as conn:
            st = {r["business_name"]: r["status"] for r in conn.execute("SELECT business_name, status FROM leads")}
            left = conn.execute("""SELECT COUNT(*) AS n FROM outreach_emails WHERE status='scheduled'
                                   AND lead_id IN (?, ?)""", (ids["ENV Labs"], ids["Gone Co"])).fetchone()["n"]
            replied_at = conn.execute("SELECT replied_at FROM outreach_emails WHERE lead_id=? AND sequence_num=1",
                                      (ids["ENV Labs"],)).fetchone()["replied_at"]
        check("statuses updated to replied / bounced", st["ENV Labs"] == "replied" and st["Gone Co"] == "bounced", st)
        check("their follow-ups were cancelled", left == 0, left)
        check("replied_at recorded", bool(replied_at))
        check("operator notified about the reply", notices and "ENV Labs" in notices[0][1], notices)

        s, closed = op.request("POST", f"/api/outreach/leads/{ids['ENV Labs']}/close",
                               {"client_email": "maya@replied.test", "industry": "hardware_startup"}, expect_status=200)
        check("won hardware lead opens a customer RFQ", bool(closed.get("rfq")) and closed.get("campaign_id") is None
              and not closed.get("portal"), closed)
        s, data = op.request("GET", "/api/ic/inquiries", expect_status=200)
        rfq = [q for q in data["inquiries"] if q["id"] == closed["rfq"]["id"]]
        check("RFQ visible in the operator console", rfq and rfq[0]["type"] == "customer", rfq)
    finally:
        httpd.shutdown()

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print("  - " + f)
        sys.exit(1)
    print("All quote + outreach checks passed.")


if __name__ == "__main__":
    run()
