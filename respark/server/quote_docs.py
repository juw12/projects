"""
Titian quote documents (stdlib only)
====================================
Everything the operator sends or downloads around a supplier comparison:

- build_rfq()        RFQ e-mail in English / Chinese / Indonesian with a fixed reply
                     template, so the quotes come back easy to read.
- draft_followup()   one e-mail per supplier asking for the missing information
                     (MOQ, tooling, lead time, Incoterm ...), in the supplier's language.
- comparison_xlsx()  the comparison as an Excel workbook (Comparison / Quotes / Issues /
                     Follow-ups sheets).
- llm_extract()      optional AI reading of a messy quote through any OpenAI-compatible
                     API. Rule-based values fill whatever the model leaves empty.

Environment variables (optional):
    RESPARK_OPENAI_API_KEY    enables AI reading (only when the operator ticks it per quote)
    RESPARK_OPENAI_BASE_URL   another OpenAI-compatible provider (default api.openai.com/v1)
    RESPARK_QUOTE_MODEL       model name (default gpt-4o-mini)
"""

import io
import json
import os
import re
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone
from xml.sax.saxutils import escape

LANGUAGES = ("en", "zh", "id")
LANGUAGE_NAMES = {"en": "English", "zh": "中文", "id": "Bahasa Indonesia"}

# --------------------------------------------------------------- RFQ e-mail

RFQ_REPLY_FIELDS = [
    {"en": "Currency", "zh": "币种", "id": "Mata uang"},
    {"en": "Tooling cost (mold)", "zh": "模具费", "id": "Biaya cetakan (mold)"},
    {"en": "Cavities / mold steel / mold life", "zh": "穴数 / 模具钢材 / 模具寿命",
     "id": "Jumlah cavity / material cetakan / umur cetakan"},
    {"en": "Tooling ownership", "zh": "模具归属", "id": "Kepemilikan cetakan"},
    {"en": "Tooling lead time to T1 samples", "zh": "开模周期（至T1样品）",
     "id": "Waktu pembuatan cetakan sampai sampel T1"},
    {"en": "Production lead time after PO", "zh": "量产交期（下单后）", "id": "Waktu produksi setelah PO"},
    {"en": "MOQ", "zh": "最小起订量 MOQ", "id": "MOQ (minimal order)"},
    {"en": "Incoterm and place", "zh": "贸易条款及地点", "id": "Incoterm dan lokasi"},
    {"en": "Payment terms", "zh": "付款方式", "id": "Syarat pembayaran"},
    {"en": "Quote validity", "zh": "报价有效期", "id": "Masa berlaku penawaran"},
]
RFQ_UNIT_PRICE_LABEL = {"en": "Unit price @ {qty} pcs", "zh": "单价 @ {qty} pcs", "id": "Harga satuan @ {qty} pcs"}

RFQ_TEMPLATE = {
    "en": {
        "subject": "RFQ - {project}",
        "body": (
            "Dear Sales team,\n\n"
            "We are requesting a quotation for the following part:\n\n"
            "Project: {project}\nPart: {part}\nVolume scenarios: {volumes} pcs\n"
            "Delivery destination: {destination}\n{specs}\n"
            "Drawings and 3D files are attached.\n\n"
            "To speed up our evaluation, please fill in this template in your reply:\n\n{reply}\n\n"
            "Please reply by {due}. Thank you.\n\nBest regards,\n{sender}\n{sender_contact}"
        ),
    },
    "zh": {
        "subject": "询价 - {project}",
        "body": (
            "您好，\n\n我们需要以下零件的报价：\n\n"
            "项目：{project}\n零件：{part}\n数量（多档）：{volumes} pcs\n交货地：{destination}\n{specs}\n"
            "图纸及3D文件见附件。\n\n为便于评估，请在回复中按以下格式填写：\n\n{reply}\n\n"
            "请于 {due} 前回复，谢谢！\n\n此致\n{sender}\n{sender_contact}"
        ),
    },
    "id": {
        "subject": "Permintaan Penawaran (RFQ) - {project}",
        "body": (
            "Yth. Tim Sales,\n\nKami meminta penawaran harga untuk part berikut:\n\n"
            "Proyek: {project}\nPart: {part}\nSkenario volume: {volumes} pcs\n"
            "Tujuan pengiriman: {destination}\n{specs}\n"
            "Gambar teknik dan file 3D terlampir.\n\n"
            "Untuk mempercepat evaluasi, mohon isi format berikut pada balasan Anda:\n\n{reply}\n\n"
            "Mohon dibalas sebelum {due}. Terima kasih.\n\nSalam,\n{sender}\n{sender_contact}"
        ),
    },
}


def _clean_lines(specs):
    if isinstance(specs, str):
        specs = specs.splitlines()
    return [str(s).strip().lstrip("-• ").strip() for s in (specs or []) if str(s).strip()]


def build_rfq(project, language="en"):
    """project: {project, part, target, volumes, destination, specs, due, sender, sender_contact}.
    Returns {"language", "subject", "body"}."""
    language = language if language in RFQ_TEMPLATE else "en"
    volumes = sorted({int(v) for v in project.get("volumes") or [] if int(v) > 0}
                     | {int(project.get("target") or 1000)})
    reply_lines = [RFQ_UNIT_PRICE_LABEL[language].format(qty=f"{v:,}") + ": " for v in volumes]
    reply_lines += [field[language] + ": " for field in RFQ_REPLY_FIELDS]
    specs = _clean_lines(project.get("specs"))
    fields = {
        "project": project.get("project") or "New part",
        "part": project.get("part") or "-",
        "volumes": " / ".join(f"{v:,}" for v in volumes),
        "destination": project.get("destination") or "-",
        "specs": "".join(f"- {spec}\n" for spec in specs),
        "reply": "\n".join(reply_lines),
        "due": project.get("due") or "[date]",
        "sender": project.get("sender") or "",
        "sender_contact": project.get("sender_contact") or "",
    }
    template = RFQ_TEMPLATE[language]
    return {
        "language": language,
        "subject": template["subject"].format(**fields),
        "body": template["body"].format(**fields).rstrip() + "\n",
    }


# --------------------------------------------------------------- supplier follow-ups

FOLLOWUP_ASK = {
    "currency": {
        "en": "Please confirm the currency for all prices.",
        "zh": "请确认所有报价的币种。",
        "id": "Mohon konfirmasi mata uang untuk semua harga.",
    },
    "price_breaks": {
        "en": "Please provide the unit price at {volumes} pcs.",
        "zh": "请提供 {volumes} pcs 各数量的单价。",
        "id": "Mohon berikan harga satuan untuk {volumes} pcs.",
    },
    "tooling_cost": {
        "en": "Please quote the tooling (mold) cost, with number of cavities, mold steel and mold life.",
        "zh": "请提供模具费用，以及穴数、模具钢材和模具寿命。",
        "id": "Mohon berikan biaya cetakan (mold), termasuk jumlah cavity, material cetakan dan umur cetakan.",
    },
    "moq": {
        "en": "What is your MOQ?",
        "zh": "请问贵司的最小起订量（MOQ）是多少？",
        "id": "Berapa MOQ (minimum order) Anda?",
    },
    "moq_above_volume": {
        "en": "Our first order may be {volume} pcs, below your MOQ of {moq} pcs. Can you accept it, and at what unit price?",
        "zh": "我们首批订单可能为 {volume} pcs，低于贵司 MOQ {moq} pcs。请问是否可以接受？单价是多少？",
        "id": "Pesanan pertama kami mungkin {volume} pcs, di bawah MOQ Anda {moq} pcs. Apakah bisa diterima, dan berapa harga satuannya?",
    },
    "lead_time": {
        "en": "Please confirm the mass-production lead time after PO.",
        "zh": "请确认下单后的量产交期。",
        "id": "Mohon konfirmasi waktu produksi massal setelah PO.",
    },
    "tooling_lead_time": {
        "en": "Please confirm the tooling lead time to T1 samples.",
        "zh": "请确认开模至 T1 样品的周期。",
        "id": "Mohon konfirmasi waktu pembuatan cetakan sampai sampel T1.",
    },
    "incoterm": {
        "en": "Please confirm the Incoterm and named place (e.g. FOB Shenzhen, EXW Batam).",
        "zh": "请确认贸易条款及交货地点（例如 FOB 深圳）。",
        "id": "Mohon konfirmasi Incoterm dan lokasi serah terima (misalnya EXW Batam / FOB Batam).",
    },
    "payment_terms": {
        "en": "Please confirm your payment terms.",
        "zh": "请确认付款方式。",
        "id": "Mohon konfirmasi syarat pembayaran.",
    },
    "validity": {
        "en": "How long is this quotation valid?",
        "zh": "请问本报价的有效期是多久？",
        "id": "Berapa lama penawaran ini berlaku?",
    },
}

FOLLOWUP_TEMPLATE = {
    "en": {
        "subject": "RE: Quotation - {project}",
        "greeting": "Dear {supplier} team,",
        "intro": "Thank you for your quotation for {project}. To complete our supplier comparison, could you please clarify the following:",
        "closing": "Thank you, and I look forward to your reply.\n\nBest regards,\n{sender}",
    },
    "zh": {
        "subject": "回复：{project} 报价确认",
        "greeting": "{supplier} 您好，",
        "intro": "感谢贵司对 {project} 的报价。为完成供应商比较，烦请确认以下事项：",
        "closing": "谢谢，期待您的回复。\n\n此致\n{sender}",
    },
    "id": {
        "subject": "RE: Penawaran - {project}",
        "greeting": "Yth. Bapak/Ibu di {supplier},",
        "intro": "Terima kasih atas penawaran untuk {project}. Untuk melengkapi perbandingan supplier, mohon konfirmasi hal-hal berikut:",
        "closing": "Terima kasih, kami tunggu balasannya.\n\nSalam,\n{sender}",
    },
}


def draft_followup(row, project, sender=""):
    """row: one comparison row {supplier, quote, evaluation}. Returns
    {"language", "subject", "body", "questions"} or None when nothing is missing."""
    quote = row.get("quote") or {}
    language = quote.get("language") if quote.get("language") in FOLLOWUP_TEMPLATE else "en"
    questions = []
    seen = set()
    for issue in (row.get("evaluation") or {}).get("issues") or []:
        key = issue.get("key")
        if key not in FOLLOWUP_ASK or key in seen:
            continue
        seen.add(key)
        try:
            questions.append(FOLLOWUP_ASK[key][language].format(**(issue.get("params") or {})))
        except (KeyError, IndexError):
            continue
    if not questions:
        return None
    fields = {"project": project or "your quotation", "supplier": row.get("supplier") or "Supplier",
              "sender": sender or ""}
    template = FOLLOWUP_TEMPLATE[language]
    numbered = "\n".join(f"{index}. {question}" for index, question in enumerate(questions, 1))
    body = (f"{template['greeting'].format(**fields)}\n\n"
            f"{template['intro'].format(**fields)}\n\n"
            f"{numbered}\n\n"
            f"{template['closing'].format(**fields).rstrip()}\n")
    return {"language": language, "subject": template["subject"].format(**fields),
            "body": body, "questions": questions}


# --------------------------------------------------------------- Excel export

_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
STYLE_NORMAL, STYLE_BOLD, STYLE_BEST, STYLE_WARN = 0, 1, 2, 3


def _column(index):
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _cell_xml(ref, value, style):
    style_attr = f' s="{style}"' if style else ""
    if value is None or value == "":
        return f'<c r="{ref}"{style_attr}/>'
    if isinstance(value, bool):
        value = "yes" if value else "no"
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"{style_attr}><v>{value}</v></c>'
    text = escape(_ILLEGAL_XML.sub("", str(value)))[:32000]
    return f'<c r="{ref}"{style_attr} t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'


def _sheet_xml(rows, widths=None):
    """rows: list of lists of values or (value, style) tuples."""
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">']
    if widths:
        out.append("<cols>" + "".join(
            f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths)) + "</cols>")
    out.append("<sheetData>")
    for r, row in enumerate(rows, 1):
        cells = []
        for c, item in enumerate(row):
            value, style = item if isinstance(item, tuple) else (item, STYLE_NORMAL)
            cells.append(_cell_xml(f"{_column(c)}{r}", value, style))
        out.append(f'<row r="{r}">' + "".join(cells) + "</row>")
    out.append("</sheetData></worksheet>")
    return "".join(out)


STYLES_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="4"><fill><patternFill patternType="none"/></fill>'
    '<fill><patternFill patternType="gray125"/></fill>'
    '<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/></patternFill></fill>'
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFFEB9C"/></patternFill></fill></fills>'
    '<borders count="1"><border/></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="4">'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>'
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    '</styleSheet>'
)


def _workbook(sheets):
    """sheets: list of (name, sheet_xml). Returns .xlsx bytes."""
    names = [re.sub(r"[\[\]:*?/\\]", " ", name)[:31] for name, _ in sheets]
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" '
                  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                  for i in range(1, len(sheets) + 1))
        + "</Types>")
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>")
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + "".join(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(names, 1))
        + "</sheets></workbook>")
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                  f'Target="worksheets/sheet{i}.xml"/>' for i in range(1, len(sheets) + 1))
        + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        "</Relationships>")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("xl/workbook.xml", workbook)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", STYLES_XML)
        for i, (_, xml) in enumerate(sheets, 1):
            archive.writestr(f"xl/worksheets/sheet{i}.xml", xml)
    return buffer.getvalue()


def comparison_xlsx(comparison, title, followups=None):
    """comparison: output of quotes.compare(). followups: {quote_id: draft or None}."""
    followups = followups or {}
    volumes = comparison["volumes"]
    best = comparison.get("best_by_volume") or {}
    bold = lambda text: (text, STYLE_BOLD)

    header = ["Rank", "Supplier", "Currency", "Incoterm", "MOQ", "Tooling (USD)",
              "Lead time (days)", "Tooling / T1 (days)", "Total lead time (days)"]
    header += [f"Cost/pc USD @ {v:,}" for v in volumes]
    header += [f"Total USD @ {v:,}" for v in volumes]
    header += ["High issues", "All issues"]
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    summary = [
        [bold(title)],
        [f"Target volume: {comparison['target']:,} pcs. Generated {generated}."],
        [comparison["formula"] + ". Freight/duty allowance is an estimate by Incoterm. "
         "Check every number against the supplier's original quote."],
        ["FX (units per 1 USD): " + ", ".join(f"{k} {v:g}" for k, v in sorted(comparison["fx"].items()))],
        [],
        [bold(h) for h in header],
    ]
    for rank, row in enumerate(comparison["rows"], 1):
        q, ev = row["quote"], row["evaluation"]
        line = [rank, row["supplier"], q.get("currency"), q.get("incoterm"), q.get("moq"), ev.get("tooling_usd"),
                q.get("lead_time_days"), q.get("tooling_lead_time_days"), ev.get("total_lead_time_days")]
        for v in volumes:
            s = ev["scenarios"][str(v)]
            style = STYLE_BEST if best.get(str(v)) == row["supplier"] else (STYLE_WARN if s["below_moq"] else STYLE_NORMAL)
            line.append((s["cost_per_pc"], style))
        for v in volumes:
            line.append(ev["scenarios"][str(v)]["total"])
        issues = ev.get("issues") or []
        line += [sum(1 for i in issues if i["severity"] == "high"), len(issues)]
        summary.append(line)
    summary += [[], ["Green = cheapest per piece at that volume. Yellow = volume is below the supplier's MOQ."]]

    quotes_rows = [[bold(h) for h in ("Supplier", "Language", "Currency", "Price breaks", "Tooling",
                                      "Tooling currency", "MOQ", "Lead time (days)", "Tooling / T1 (days)",
                                      "Incoterm", "Payment terms", "Validity (days)", "Read by", "Notes")]]
    for row in comparison["rows"]:
        q = row["quote"]
        breaks = "; ".join(f"{b['qty']:,} pcs: {b['unit_price']:g}" for b in q.get("price_breaks") or [])
        quotes_rows.append([row["supplier"], LANGUAGE_NAMES.get(q.get("language"), q.get("language")),
                            q.get("currency"), breaks, q.get("tooling_cost"), q.get("tooling_currency"),
                            q.get("moq"), q.get("lead_time_days"), q.get("tooling_lead_time_days"),
                            q.get("incoterm"), q.get("payment_terms"), q.get("validity_days"),
                            q.get("method") or "rules", "; ".join(q.get("notes") or [])])

    issue_rows = [[bold("Supplier"), bold("Severity"), bold("Issue")]]
    for row in comparison["rows"]:
        for issue in row["evaluation"].get("issues") or []:
            style = STYLE_WARN if issue["severity"] == "high" else STYLE_NORMAL
            issue_rows.append([row["supplier"], (issue["severity"], style), issue["message"]])

    followup_rows = [[bold("Supplier"), bold("Language"), bold("Subject"), bold("E-mail")]]
    for row in comparison["rows"]:
        draft = followups.get(row["id"])
        if draft:
            followup_rows.append([row["supplier"], LANGUAGE_NAMES.get(draft["language"]), draft["subject"], draft["body"]])

    sheets = [
        ("Comparison", _sheet_xml(summary, [6, 26, 9, 16, 9, 13, 11, 11, 11] + [14] * (2 * len(volumes)) + [9, 9])),
        ("Quotes", _sheet_xml(quotes_rows, [26, 12, 9, 40, 10, 9, 9, 11, 11, 16, 24, 10, 14, 40])),
        ("Issues", _sheet_xml(issue_rows, [26, 10, 70])),
        ("Follow-ups", _sheet_xml(followup_rows, [26, 16, 36, 90])),
    ]
    return _workbook(sheets)


# --------------------------------------------------------------- optional AI reading

LLM_SYSTEM_PROMPT = """You extract data from a supplier quotation for a manufactured part.
The text may be English, Chinese or Indonesian. Indonesian amounts use '.' as the
thousands separator (Rp 24.500 = 24500). Return ONLY a JSON object with these keys,
using null for anything not stated. Never guess.
{
  "supplier": string,
  "currency": ISO code of unit prices, e.g. "USD", "CNY", "IDR",
  "price_breaks": [{"qty": integer, "unit_price": number}],
  "tooling_cost": number,
  "tooling_currency": ISO code,
  "moq": integer,
  "lead_time_days": number (mass-production lead time, calendar days; weeks x 7),
  "tooling_lead_time_days": number (tooling / T1 sample lead time, calendar days),
  "incoterm": string such as "FOB Shenzhen",
  "payment_terms": string,
  "validity_days": integer,
  "notes": [short strings for commercial conditions, e.g. VAT excluded, packaging extra]
}"""

_LLM_NUMBER_FIELDS = {"tooling_cost": float, "moq": int, "lead_time_days": float,
                      "tooling_lead_time_days": float, "validity_days": int}
_LLM_TEXT_FIELDS = ("currency", "tooling_currency", "incoterm", "payment_terms")


def llm_available():
    return bool(os.environ.get("RESPARK_OPENAI_API_KEY"))


def llm_model():
    return os.environ.get("RESPARK_QUOTE_MODEL", "gpt-4o-mini")


def _number(value, kind):
    try:
        number = kind(float(value))
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def normalize_llm(data):
    """Turn the model's JSON into the same shape quotes.extract() returns (missing = None)."""
    out = {"supplier": str(data.get("supplier") or "").strip()[:120] or None}
    for name in _LLM_TEXT_FIELDS:
        value = str(data.get(name) or "").strip()
        out[name] = value[:200] or None
    for name in ("currency", "tooling_currency"):
        if out[name]:
            out[name] = out[name].upper()[:3]
    for name, kind in _LLM_NUMBER_FIELDS.items():
        out[name] = _number(data.get(name), kind)
    breaks = {}
    for item in data.get("price_breaks") or []:
        if not isinstance(item, dict):
            continue
        qty = _number(item.get("qty"), int)
        price = _number(item.get("unit_price"), float)
        if qty and price:
            breaks[qty] = price
    out["price_breaks"] = [{"qty": k, "unit_price": breaks[k]} for k in sorted(breaks)]
    out["notes"] = [str(n)[:200] for n in (data.get("notes") or []) if str(n).strip()][:10]
    return out


def merge_extracted(llm, rules):
    """AI values first; rule-based values fill every gap."""
    merged = dict(rules)
    for name, value in llm.items():
        if name == "notes":
            continue
        if value not in (None, "", []):
            merged[name] = value
    merged["notes"] = list(dict.fromkeys((rules.get("notes") or []) + (llm.get("notes") or [])))
    merged["method"] = f"ai:{llm_model()}+rules"
    return merged


def llm_extract(text, timeout=45):
    """Returns (normalized dict, None) or (None, error message). Never raises."""
    key = os.environ.get("RESPARK_OPENAI_API_KEY")
    if not key:
        return None, "AI reading is not configured (RESPARK_OPENAI_API_KEY)"
    base = (os.environ.get("RESPARK_OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    payload = {
        "model": llm_model(),
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": LLM_SYSTEM_PROMPT},
                     {"role": "user", "content": (text or "")[:20000]}],
    }
    request = urllib.request.Request(
        base + "/chat/completions", data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            reply = json.load(response)
        content = reply["choices"][0]["message"]["content"]
        data = json.loads(content)
        if not isinstance(data, dict):
            return None, "AI reply was not a JSON object"
        return normalize_llm(data), None
    except (urllib.error.URLError, TimeoutError, OSError, KeyError, IndexError, ValueError, TypeError) as error:
        return None, f"AI reading failed: {error}"
