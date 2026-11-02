"""
Titian supplier-quote comparison (stdlib only)
==============================================
The operator attaches supplier quotes to a customer RFQ (inquiry): pasted e-mail
text or an uploaded .xlsx / .csv / .txt / .eml file, in English, Chinese or
Indonesian. Each quote is parsed into price breaks, tooling, MOQ, lead times,
Incoterm and payment terms, converted to USD and costed at the buyer's volumes:

    cost/pc = (unit price x volume + tooling + freight/duty allowance) / volume

Missing information is flagged so the operator can chase the supplier before
introducing them. Used by bridge.py (API) and bridge.js (console UI).

Environment variables (optional):
    RESPARK_FX   units per 1 USD, e.g. "CNY=7.1,IDR=16300,SGD=1.3,EUR=0.92"
"""

import csv
import email
import io
import os
import re
import zipfile
from collections import Counter
from email import policy
from xml.etree import ElementTree

DEFAULT_FX = {"USD": 1.0, "CNY": 7.1, "IDR": 16300.0, "SGD": 1.3, "EUR": 0.92, "MYR": 4.4, "THB": 34.0, "VND": 25000.0}
# Freight + duty allowance as a share of goods value, by Incoterm (estimate, editable later).
LOGISTICS_PCT = {"EXW": 0.10, "FCA": 0.08, "FAS": 0.08, "FOB": 0.07, "CFR": 0.03, "CIF": 0.03,
                 "CPT": 0.03, "CIP": 0.03, "DAP": 0.01, "DPU": 0.01, "DDP": 0.0, "unknown": 0.10}
MAX_UPLOAD_BYTES = 2_000_000


def fx_rates():
    rates = dict(DEFAULT_FX)
    for part in (os.environ.get("RESPARK_FX") or "").split(","):
        code, _, value = part.partition("=")
        try:
            rates[code.strip().upper()] = float(value)
        except ValueError:
            continue
    return rates


# --------------------------------------------------------------- loading

def rows_from_text(text):
    rows = []
    for line in (text or "").splitlines():
        cells = [c.strip() for c in re.split(r"\t|\|", line)]
        rows.append([c for c in cells if c] or [""])
    return rows


def _decode(data):
    for encoding in ("utf-8-sig", "gb18030", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _cell(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return (value or "").strip()
    if number.is_integer():
        return str(int(number))
    return ("%.10f" % number).rstrip("0").rstrip(".")


def _xlsx_rows(data):
    """Minimal .xlsx reader: shared strings + every worksheet, values only."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(data)) as book:
        shared = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ElementTree.fromstring(book.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
        sheets = sorted(n for n in book.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
        rows = []
        for name in sheets:
            root = ElementTree.fromstring(book.read(name))
            for row in root.iter("{%s}row" % ns["m"]):
                cells = {}
                for c in row.findall("m:c", ns):
                    ref = re.match(r"([A-Z]+)", c.get("r", "A"))
                    col = 0
                    for ch in ref.group(1) if ref else "A":
                        col = col * 26 + (ord(ch) - 64)
                    kind = c.get("t")
                    v = c.find("m:v", ns)
                    if kind == "s" and v is not None:
                        value = shared[int(v.text)]
                    elif kind == "inlineStr":
                        value = "".join(t.text or "" for t in c.iter("{%s}t" % ns["m"]))
                    else:
                        value = _cell(v.text) if v is not None else ""
                    cells[col] = str(value).strip()
                if cells:
                    width = max(cells)
                    line = [cells.get(i, "") for i in range(1, width + 1)]
                    while line and not line[-1]:
                        line.pop()
                    rows.append(line)
        return rows


def rows_from_upload(filename, data):
    name = (filename or "").lower()
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("file too large (max 2 MB)")
    if name.endswith((".xlsx", ".xlsm")):
        return _xlsx_rows(data)
    if name.endswith(".csv"):
        return [[c.strip() for c in r] for r in csv.reader(_decode(data).splitlines())]
    if name.endswith(".eml"):
        msg = email.message_from_bytes(data, policy=policy.default)
        part = msg.get_body(preferencelist=("plain", "html"))
        body = re.sub(r"<[^>]+>", " ", part.get_content() if part else "")
        return rows_from_text(f"From: {msg.get('From', '')}\nSubject: {msg.get('Subject', '')}\n{body}")
    if name.endswith(".pdf"):
        try:
            from pypdf import PdfReader  # optional, only if installed
        except ImportError:
            raise ValueError("PDF needs the optional 'pypdf' package; paste the quote text instead")
        reader = PdfReader(io.BytesIO(data))
        return rows_from_text("\n".join(p.extract_text() or "" for p in reader.pages))
    return rows_from_text(_decode(data))


def rows_text(rows):
    return "\n".join(" | ".join(c for c in row if c) for row in rows)


# --------------------------------------------------------------- parsing helpers

CURRENCY_PATTERNS = [
    ("USD", re.compile(r"US\$|(?<![A-Za-z])USD(?![A-Za-z])|美元|美金")),
    ("SGD", re.compile(r"(?<![A-Za-z])S\$|(?<![A-Za-z])SGD(?![A-Za-z])|新币")),
    ("EUR", re.compile(r"(?<![A-Za-z])EUR(?![A-Za-z])|€|欧元")),
    ("CNY", re.compile(r"(?<![A-Za-z])(?:RMB|CNY)(?![A-Za-z])|人民币|元|¥|￥")),
    ("IDR", re.compile(r"(?<![A-Za-z])(?:IDR|Rp\.?)(?![A-Za-z])|[Rr]upiah")),
    ("USD", re.compile(r"(?<![A-Za-z])\$")),
]
NUMBER_RE = re.compile(r"(?<![\d.,])(\d[\d.,]*\d|\d)(\s?(?:[kK]|万)(?![A-Za-z]))?")
_DAY = r"个工作日|工作日|working\s+days?|business\s+days?|calendar\s+days?|hari\s+kerja|days?|天|日|hari"
_WEEK = r"个星期|星期|周|weeks?|wks?|minggu"
DURATION_RE = re.compile(
    rf"(\d+(?:\.\d+)?)\s*(?:(?:-|~|～|–|to|至|到|sampai|s/d)\s*(\d+(?:\.\d+)?))?\s*({_DAY}|{_WEEK})", re.I)


def dominant_currency(text):
    counts = Counter()
    for code, pattern in CURRENCY_PATTERNS:
        counts[code] += len(pattern.findall(text))
    code, n = counts.most_common(1)[0] if counts else (None, 0)
    return code if n else None


def first_currency(text):
    best = None
    for code, pattern in CURRENCY_PATTERNS:
        m = pattern.search(text or "")
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), code)
    return best[1] if best else None


def _touching(fragment, before):
    seps = " :：|\t@=("
    if before:
        s = fragment.rstrip(seps)
        for code, pattern in CURRENCY_PATTERNS:
            if any(m.end() == len(s) for m in pattern.finditer(s)):
                return code
    else:
        s = fragment.lstrip(seps)
        for code, pattern in CURRENCY_PATTERNS:
            if pattern.match(s):
                return code
    return None


def parse_number(token, dot_thousands=False):
    t = token.strip().replace(" ", "")
    mult = 1.0
    if t[-1:] in ("k", "K"):
        mult, t = 1000.0, t[:-1]
    elif t.endswith("万"):
        mult, t = 10000.0, t[:-1]
    if "," in t and "." in t:
        t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        t = t.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", t) else t.replace(",", ".")
    elif "." in t:
        grouped = re.fullmatch(r"\d{1,3}(\.\d{3})+", t) is not None
        if t.count(".") > 1 or (dot_thousands and grouped):
            t = t.replace(".", "")
    try:
        return float(t) * mult
    except ValueError:
        return None


def first_number(text, dot_thousands=False):
    m = NUMBER_RE.search(text or "")
    return parse_number(m.group(0), dot_thousands) if m else None


def pick_money(text, dot_thousands=False):
    """Largest amount written next to a currency, else the largest number."""
    found = []
    for m in NUMBER_RE.finditer(text):
        value = parse_number(m.group(0), dot_thousands)
        if value is None:
            continue
        cur = _touching(text[max(0, m.start() - 10):m.start()], True) or _touching(text[m.end():m.end() + 10], False)
        found.append((value, cur))
    if not found:
        return None
    tagged = [f for f in found if f[1]]
    return max(tagged or found, key=lambda f: f[0])


def duration_days(text):
    m = DURATION_RE.search(text or "")
    if not m:
        return None, None
    high = float(m.group(2) or m.group(1))
    unit = m.group(3).lower()
    note = None
    if re.fullmatch(_WEEK, unit, re.I):
        days = high * 7
    elif any(w in unit for w in ("工作日", "working", "business", "kerja")):
        days = high * 7 / 5
        note = f"'{m.group(0)}' converted from working days"
    else:
        days = high
    if m.group(2):
        note = (note + "; " if note else "") + f"range '{m.group(0)}', upper bound used"
    return days, note


def detect_language(text):
    if len(re.findall(r"[\u4e00-\u9fff]", text)) >= 15:
        return "zh"
    hints = ("terima kasih", "harga", "biaya", "hari", "minggu", "pembayaran", "dengan", "mohon", "cetakan", "penawaran")
    return "id" if sum(h in text.lower() for h in hints) >= 2 else "en"


# --------------------------------------------------------------- extraction

def _kw(*patterns):
    return re.compile("|".join(patterns), re.I)


KW_TOOLING_LT = _kw(r"tooling\s*lead\s*time", r"mou?ld\s*lead\s*time", r"tooling\s*time", r"模具交期", r"开模周期",
                    r"模具周期", r"开模时间", r"waktu\s*(?:pembuatan\s*)?(?:cetakan|mou?ld|tooling)")
KW_LEAD_TIME = _kw(r"lead[\s-]*time", r"production\s*time", r"delivery\s*time", r"交期", r"交货期", r"生产周期",
                   r"waktu\s*produksi", r"waktu\s*pengiriman")
KW_TOOLING = _kw(r"tooling", r"mou?ld\s*(?:cost|fee|charge)", r"(?<![A-Za-z])NRE(?![A-Za-z])", r"模具费", r"开模费",
                 r"biaya\s*(?:cetakan|mou?ld|tooling)")
KW_MOQ = _kw(r"(?<![A-Za-z])MOQ(?![A-Za-z])", r"minimum\s*order", r"最小起订量", r"起订量", r"最低订量", r"minimal\s*order")
KW_PAYMENT = _kw(r"payment", r"付款", r"结算", r"pembayaran")
KW_VALIDITY = _kw(r"validity", r"valid\s*(?:for|until)", r"有效期", r"berlaku")
KW_QTY = _kw(r"(?<![A-Za-z])qty(?![A-Za-z])", r"quantity", r"数量", r"订单量", r"jumlah", r"volume")
KW_PRICE = _kw(r"unit\s*price", r"price", r"单价", r"harga")
KW_TAX = _kw(r"excl\w*\.?\s*(?:VAT|GST|tax)", r"(?:VAT|GST|tax)\s*excl", r"不含税", r"未税", r"belum\s*termasuk\s*PPN")
SUPPLIER_LABEL = re.compile(
    r"^\s*(?:supplier|vendor|company|供应商|公司名称|pemasok|perusahaan)\s*(?:name|名称)?\s*[:：]?\s*(.*)$", re.I)
COMPANY_HINT = re.compile(r"有限公司|Co\.,?\s*Ltd|(?<![A-Za-z])PT\s+[A-Z]|Inc\.|LLC|Sdn\.?\s*Bhd", re.I)
INCOTERM_RE = re.compile(r"(?<![A-Za-z])(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)(?![A-Za-z])"
                         r"(?:\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?|[\u4e00-\u9fff]{2,4}))?")
INLINE_BREAK_RE = re.compile(
    r"(?P<qty>\d[\d.,]*\s?(?:[kK](?![A-Za-z]{2})|万)?)\s*(?:pcs|pc|units?|sets?|件|个|只|套|buah)"
    r"(?P<between>[^\d\n]{0,20}?)(?P<price>\d[\d.,]*\d|\d)")
LABEL_SUFFIX = re.compile(r"^(?:方式|条件|条款|terms?|method)\s*[:：]?\s*", re.I)


def _value_text(cells, pattern):
    for i, cell in enumerate(cells):
        m = pattern.search(cell)
        if m:
            tail = LABEL_SUFFIX.sub("", cell[m.end():].strip(" :：-–|\t"))
            return " ".join(([tail] if tail else []) + [c for c in cells[i + 1:] if c]).strip()
    return ""


def _supplier(rows, fallback):
    for cells in rows:
        m = SUPPLIER_LABEL.match(cells[0]) if cells and cells[0] else None
        if m:
            value = m.group(1).strip() or " ".join(cells[1:]).strip()
            if value:
                return re.split(r"\s+[—–-]\s+", value)[0].strip()
    hits = [" ".join(c).strip() for c in rows if COMPANY_HINT.search(" ".join(c)) and len(" ".join(c)) <= 80]
    return min(hits, key=len) if hits else (fallback or "Supplier")


def _price_breaks(rows, dot):
    # 1) header row "Qty | Unit price" followed by numbers
    for hi, header in enumerate(rows):
        qc = next((i for i, c in enumerate(header) if KW_QTY.search(c)), None)
        pc = next((i for i, c in enumerate(header) if i != qc and KW_PRICE.search(c)), None)
        if qc is None or pc is None:
            continue
        found = []
        for row in rows[hi + 1:hi + 30]:
            q = first_number(row[qc], dot) if len(row) > max(qc, pc) else None
            p = first_number(row[pc], dot) if len(row) > max(qc, pc) else None
            if q is None or p is None:
                if found:
                    break
                continue
            found.append((int(round(q)), p))
        if found:
            return found, first_currency(header[pc])
    # 2) "Qty | 1000 | 5000" row followed by "Price | 9.8 | 7.6"
    for i, row in enumerate(rows):
        if not row or not KW_QTY.search(row[0]):
            continue
        for prow in rows[i + 1:i + 4]:
            if prow and KW_PRICE.search(prow[0]):
                found = []
                for col in range(1, min(len(row), len(prow))):
                    q, p = first_number(row[col], dot), first_number(prow[col], dot)
                    if q and p:
                        found.append((int(round(q)), p))
                if found:
                    return found, first_currency(prow[0])
    # 3) inline "1,000 pcs: USD 2.35"
    found, cur = [], None
    for cells in rows:
        line = " ".join(cells)
        if KW_MOQ.search(line) or KW_TOOLING.search(line):
            continue
        for m in INLINE_BREAK_RE.finditer(line):
            q, p = parse_number(m.group("qty"), dot), parse_number(m.group("price"), dot)
            if q and p:
                found.append((int(round(q)), p))
                cur = cur or first_currency(m.group("between"))
    return found, cur


def extract(rows, fallback_supplier=""):
    """Rule-based quote extraction. Returns a plain dict (JSON-friendly)."""
    text = rows_text(rows)
    currency = dominant_currency(text)
    dot = currency == "IDR"
    q = {
        "supplier": _supplier(rows, fallback_supplier), "language": detect_language(text),
        "currency": currency, "price_breaks": [], "tooling_cost": None, "tooling_currency": None,
        "moq": None, "lead_time_days": None, "tooling_lead_time_days": None, "incoterm": None,
        "payment_terms": None, "validity_days": None, "notes": [],
    }
    breaks, header_currency = _price_breaks(rows, dot)
    unique = {qty: price for qty, price in breaks if qty > 0 and price > 0}
    q["price_breaks"] = [{"qty": k, "unit_price": unique[k]} for k in sorted(unique)]
    if header_currency:
        q["currency"] = header_currency

    for cells in rows:
        line = " | ".join(c for c in cells if c)
        if not line:
            continue
        tooling_lt = bool(KW_TOOLING_LT.search(line))
        if tooling_lt and q["tooling_lead_time_days"] is None:
            days, note = duration_days(line)
            if days is not None:
                q["tooling_lead_time_days"] = days
                if note:
                    q["notes"].append("tooling lead time: " + note)
        if not tooling_lt and KW_LEAD_TIME.search(line) and q["lead_time_days"] is None:
            days, note = duration_days(line)
            if days is not None:
                q["lead_time_days"] = days
                if note:
                    q["notes"].append("lead time: " + note)
        if not tooling_lt and KW_TOOLING.search(line) and q["tooling_cost"] is None:
            money = pick_money(_value_text(cells, KW_TOOLING), dot)
            if money and money[0] > 0:
                q["tooling_cost"], q["tooling_currency"] = money[0], money[1] or q["currency"]
        if KW_MOQ.search(line) and q["moq"] is None:
            value = first_number(_value_text(cells, KW_MOQ), dot)
            if value:
                q["moq"] = int(round(value))
        if KW_PAYMENT.search(line) and q["payment_terms"] is None:
            value = _value_text(cells, KW_PAYMENT)
            if value:
                q["payment_terms"] = value[:200]
        if KW_VALIDITY.search(line) and q["validity_days"] is None:
            days, _ = duration_days(line)
            if days is not None:
                q["validity_days"] = int(days)

    m = INCOTERM_RE.search(text)
    if m:
        q["incoterm"] = " ".join(p for p in m.groups() if p)
    if KW_TAX.search(text):
        q["notes"].append("prices exclude VAT / sales tax")
    return q


# --------------------------------------------------------------- comparison

def _usd(amount, currency, fx):
    if amount is None or not currency or currency not in fx:
        return None
    return amount / fx[currency]


def _issues(q, volumes, target, fx):
    out = []
    add = lambda sev, msg: out.append({"severity": sev, "message": msg})
    breaks = q.get("price_breaks") or []
    if not breaks:
        add("high", "No unit prices found")
    elif len(breaks) == 1:
        add("low", "Only one price break quoted")
    if not q.get("currency"):
        add("high", "Currency not stated")
    elif q["currency"] not in fx:
        add("high", f"No FX rate for {q['currency']} (set RESPARK_FX)")
    if q.get("tooling_cost") is None:
        add("high", "Tooling cost not stated (excluded from total)")
    if q.get("moq") is None:
        add("medium", "MOQ not stated")
    elif q["moq"] > target:
        add("high", f"MOQ {q['moq']:,} is above the target volume {target:,}")
    elif q["moq"] > min(volumes):
        add("medium", f"MOQ {q['moq']:,} is above the {min(volumes):,} pcs scenario")
    if breaks and breaks[0]["qty"] > target:
        add("medium", f"Lowest quoted qty {breaks[0]['qty']:,} is above target {target:,}")
    if q.get("lead_time_days") is None:
        add("medium", "Production lead time not stated")
    if q.get("tooling_lead_time_days") is None:
        add("medium", "Tooling / T1 lead time not stated")
    if not q.get("incoterm"):
        add("medium", "Incoterm not stated (unknown freight allowance used)")
    if not q.get("payment_terms"):
        add("low", "Payment terms not stated")
    if q.get("validity_days") is None:
        add("low", "Quote validity not stated")
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda i: order[i["severity"]])


def evaluate(q, target, volumes, fx=None):
    fx = fx or fx_rates()
    volumes = sorted({int(v) for v in volumes if int(v) > 0} | {int(target)})
    term = (q.get("incoterm") or "unknown").split()[0].upper()
    pct = LOGISTICS_PCT.get(term, LOGISTICS_PCT["unknown"])
    tooling_usd = _usd(q.get("tooling_cost"), q.get("tooling_currency") or q.get("currency"), fx)
    breaks = sorted(q.get("price_breaks") or [], key=lambda b: b["qty"])
    scenarios = {}
    for v in volumes:
        eligible = [b for b in breaks if b["qty"] <= v]
        chosen = max(eligible, key=lambda b: b["qty"]) if eligible else (breaks[0] if breaks else None)
        notes = []
        if breaks and not eligible:
            notes.append(f"below lowest quoted qty {breaks[0]['qty']:,}")
        below_moq = bool(q.get("moq") and v < q["moq"])
        if below_moq:
            notes.append(f"below MOQ {q['moq']:,}")
        unit_usd = _usd(chosen["unit_price"] if chosen else None, q.get("currency"), fx)
        if unit_usd is None:
            scenarios[str(v)] = {"volume": v, "unit_usd": None, "cost_per_pc": None, "total": None,
                                 "notes": notes, "below_moq": below_moq}
            continue
        goods = unit_usd * v
        total = goods + (tooling_usd or 0.0) + goods * pct
        scenarios[str(v)] = {"volume": v, "unit_usd": round(unit_usd, 4), "cost_per_pc": round(total / v, 4),
                             "total": round(total, 2), "notes": notes, "below_moq": below_moq}
    lead = q.get("lead_time_days")
    tool_lt = q.get("tooling_lead_time_days")
    return {
        "tooling_usd": round(tooling_usd, 2) if tooling_usd is not None else None,
        "logistics_pct": pct,
        "total_lead_time_days": (lead + tool_lt) if lead is not None and tool_lt is not None else None,
        "scenarios": scenarios,
        "issues": _issues(q, volumes, int(target), fx),
    }


def compare(quotes, target, volumes):
    """quotes: list of {"id", "supplier", "extracted"}; returns ranked comparison."""
    fx = fx_rates()
    target = int(target)
    volumes = sorted({int(v) for v in volumes if int(v) > 0} | {target})
    rows = []
    for item in quotes:
        q = item["extracted"]
        rows.append({"id": item["id"], "supplier": item.get("supplier") or q.get("supplier"),
                     "quote": q, "evaluation": evaluate(q, target, volumes, fx)})

    def key_at(volume):
        def key(row):
            s = row["evaluation"]["scenarios"][str(volume)]
            return (s["cost_per_pc"] is None, s["below_moq"], s["cost_per_pc"] or 0.0)
        return key

    rows.sort(key=key_at(target))
    best_by_volume = {}
    for v in volumes:
        ranked = sorted(rows, key=key_at(v))
        top = ranked[0] if ranked else None
        if top and top["evaluation"]["scenarios"][str(v)]["cost_per_pc"] is not None:
            best_by_volume[str(v)] = top["supplier"]
    return {"target": target, "volumes": volumes, "fx": fx, "rows": rows, "best_by_volume": best_by_volume,
            "formula": "cost/pc = (unit x volume + tooling + freight/duty allowance) / volume"}
