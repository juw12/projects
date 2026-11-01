"""Stdlib-only .xlsx writer for PTB RD ME OT-application export.

Layout matches the PTB RD ME & Packing Daily Overtime Work Application form:
header rows (title, date, dept), per-colleague data rows with weekday / start /
end / total / reason / project code, plus Saturday-OT sub-rows when present,
footer with submitter + supervisor.

Run:
    from server.excel_writer import build_ot_workbook_bytes
    data = build_ot_workbook_bytes(rows)
    Path("ot.xlsx").write_bytes(data)
"""
from __future__ import annotations

import html
import io
import re
import zipfile
from datetime import datetime, timezone
from typing import Iterable

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types"

XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

DEFAULT_FONT = "Calibri"
DEFAULT_FONT_SIZE = 11

CUSTOM_NUMFMT_ID = 164
HOURS_FORMAT = "0.00"

STYLE_DATA = "s_data"
STYLE_TITLE = "s_title"
STYLE_SUBTITLE = "s_subtitle"
STYLE_HEADER = "s_header"
STYLE_FOOTER = "s_footer"
STYLE_HOURS = "s_hours"


def _esc(s) -> str:
    if s is None:
        return ""
    return html.escape(str(s), quote=True)


def _to_argb(hex_color: str) -> str:
    h = hex_color.lstrip("#").upper()
    if len(h) == 6:
        h = "FF" + h
    return h


def _col_index_to_letter(idx_0based: int) -> str:
    n = idx_0based
    s = ""
    while True:
        s = chr(ord("A") + n % 26) + s
        n = n // 26 - 1
        if n < 0:
            break
    return s


def _font_xml(name=DEFAULT_FONT, size=DEFAULT_FONT_SIZE, bold=False, color="FF000000") -> str:
    return (
        f'<font><sz val="{size}"/><color rgb="{_to_argb(color)}"/>'
        f'<name val="{_esc(name)}"/><family val="2"/>{"<b/>" if bold else ""}</font>'
    )


def _is_number(v) -> bool:
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, str):
        try:
            float(v)
            return True
        except ValueError:
            return False
    return False


def _fmt_number(v) -> str:
    if isinstance(v, str):
        try:
            v = float(v)
        except ValueError:
            return _esc(v)
    if isinstance(v, float):
        s = f"{v:.2f}"
        if "." in s:
            s = s.rstrip("0").rstrip(".")
        return s
    return str(v)


def _substitute(template: str, **kw) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(kw.get(m.group(1), m.group(0))), template)


class _SharedStrings:
    def __init__(self):
        self._seen: dict[str, int] = {}
        self._list: list[str] = []

    def add(self, s: str) -> int:
        if s in self._seen:
            return self._seen[s]
        idx = len(self._list)
        self._seen[s] = idx
        self._list.append(s)
        return idx

    def count(self) -> int:
        return len(self._list)

    def unique_count(self) -> int:
        return len(self._seen)

    def to_xml(self) -> str:
        items = "".join(
            f"<si><t xml:space=\"preserve\">{_esc(s)}</t></si>" for s in self._list
        )
        return f'<sst xmlns="{NS_MAIN}" count="{self.count()}" uniqueCount="{self.unique_count()}">{items}</sst>'


class _SheetBuilder:
    HEADERS = [
        "Employee ID", "Name", "Department / 部門",
        "Date / 日期", "Day / 星期",
        "Start / 起", "End / 迄", "Total Hours / 時數",
        "Reason / 加班事由", "Project Code / 專案代碼",
        "Includes Sat OT", "Sat Start", "Sat End", "Sat Hours",
        "Sat Reason", "Sat Project", "Notes / 備註",
    ]

    def __init__(self, ss: _SharedStrings):
        self.ss = ss
        self.rows: list[str] = []

    def add(self, cells: list) -> None:
        cell_xml = []
        for c in cells:
            if c is None or c == "":
                cell_xml.append("")
                continue
            if _is_number(c):
                cell_xml.append(
                    f'<c r="{""}" s="{STYLE_HOURS}"><v>{_fmt_number(c)}</v></c>'
                )
            else:
                idx = self.ss.add(str(c))
                cell_xml.append(f'<c r="{""}" t="s"><v>{idx}</v></c>')
        self.rows.append(f"<row>{''.join(cell_xml)}</row>")

    def count(self) -> int:
        return len(self.rows)

    def to_xml(self) -> str:
        return (
            f'<worksheet xmlns="{NS_MAIN}" xmlns:r="{NS_REL}">'
            f'<sheetData>{"".join(self.rows)}</sheetData></worksheet>'
        )


def _build_workbook() -> str:
    sheets = [
        ('name="OT Application" sheetId="1" r:id="rId1"',),
    ]
    return (
        f'<workbook xmlns="{NS_MAIN}" xmlns:r="{NS_REL}">'
        f'<sheets>{"".join(s[0] for s in sheets)}</sheets>'
        f'</workbook>'
    )


def _build_workbook_rels() -> str:
    return (
        f'<Relationships xmlns="{NS_PKG_REL}">'
        f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        f'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        f'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        f'</Relationships>'
    )


def _build_styles() -> str:
    return (
        f'<styleSheet xmlns="{NS_MAIN}">'
        f'<fonts count="4">'
        f'{_font_xml(bold=True, size=14)}'
        f'{_font_xml(bold=True, size=12)}'
        f'{_font_xml(bold=True)}'
        f'{_font_xml()}'
        f'</fonts>'
        f'<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        f'<borders count="1"><border/></borders>'
        f'<cellStyleXfs count="1"><xf/></cellStyleXfs>'
        f'<cellXfs count="5">'
        f'<xf fontId="0" applyFont="1"/>'  # title
        f'<xf fontId="1" applyFont="1"/>'  # subtitle
        f'<xf fontId="2" applyFont="1"/>'  # header
        f'<xf fontId="3" applyFont="1"/>'  # data
        f'<xf numFmtId="{CUSTOM_NUMFMT_ID}" fontId="3" applyFont="1" applyNumberFormat="1"/>'  # hours
        f'</cellXfs>'
        f'<numFmts count="1"><numFmt numFmtId="{CUSTOM_NUMFMT_ID}" formatCode="{HOURS_FORMAT}"/></numFmts>'
        f'</styleSheet>'
    )


def _build_content_types() -> str:
    return (
        f'<Types xmlns="{NS_CT}">'
        f'<Default Extension="xml" ContentType="application/xml"/>'
        f'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        f'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        f'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        f'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        f'</Types>'
    )


def _build_root_rels() -> str:
    return (
        f'<Relationships xmlns="{NS_PKG_REL}">'
        f'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        f'</Relationships>'
    )


def _build_sheet(rows: Iterable[dict]) -> bytes:
    """Convert OT proposal rows into a styled sheet1.xml."""
    ss = _SharedStrings()
    sb = _SheetBuilder(ss)

    rows = list(rows)

    # Title
    sb.add(["PTB RD ME & Packing Daily Overtime Work Application"])
    _ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    sb.add(["Generated: " + _ts])
    if rows:
        first = rows[0]
        last = rows[-1]
        sb.add([f"Period: {first.get('ot_date', '')} to {last.get('ot_date', '')}"])
    sb.add([])

    # Header
    sb.add(list(_SheetBuilder.HEADERS))

    for r in rows:
        sb.add([
            r.get("colleague_id", ""),
            r.get("name", ""),
            "PTB RD ME",
            r.get("ot_date", ""),
            r.get("day_of_week", ""),
            r.get("start_time", ""),
            r.get("end_time", ""),
            r.get("total_hours", ""),
            r.get("reason", ""),
            r.get("project_code", ""),
            "Y" if r.get("includes_saturday_ot") else "N",
            r.get("saturday_start_time", ""),
            r.get("saturday_end_time", ""),
            r.get("saturday_total_hours", ""),
            r.get("saturday_reason", ""),
            r.get("saturday_project_code", ""),
            r.get("notes", ""),
        ])

    return sb.to_xml().encode("utf-8")


def write_ot_application_bytes(rows: Iterable[dict]) -> bytes:
    """Return the full .xlsx file bytes for the OT export."""
    rows = list(rows)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _build_content_types())
        z.writestr("_rels/.rels", _build_root_rels())
        z.writestr("xl/workbook.xml", _build_workbook())
        z.writestr("xl/_rels/workbook.xml.rels", _build_workbook_rels())
        z.writestr("xl/styles.xml", _build_styles())
        z.writestr("xl/worksheets/sheet1.xml", _build_sheet(rows))
        ss = _SharedStrings()
        for r in rows:
            for v in r.values():
                if v is not None and not _is_number(v):
                    ss.add(str(v))
        z.writestr("xl/sharedStrings.xml", ss.to_xml())
    return buf.getvalue()
