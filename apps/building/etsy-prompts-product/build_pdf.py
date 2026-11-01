#!/usr/bin/env python
"""
build_pdf.py — Convert the consolidated master markdown into a polished, print-ready PDF.

Uses markdown → HTML → xhtml2pdf pipeline with custom CSS that:
- Uses a serif body font (looks editorial, like a $24 product)
- Properly styles prompt code blocks (the prompts themselves)
- Handles headings hierarchy cleanly
- Forces page breaks at major sections (already injected in the master)
- Uses a warm off-white background, ink-black text
"""
from pathlib import Path
import markdown
from xhtml2pdf import pisa

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "product-files" / "master-source.md"
OUT = ROOT / "product-files" / "150-etsy-prompts.pdf"
CSS_PATH = ROOT / "product-files" / "pdf-styles.css"

CSS = """
@page {
    size: A4;
    margin: 18mm 16mm 22mm 16mm;
    @frame footer {
        -pdf-frame-content: footerContent;
        bottom: 8mm;
        margin-left: 16mm;
        margin-right: 16mm;
        height: 12mm;
    }
}

body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.55;
    color: #1F1A17;
}

h1 {
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 22pt;
    font-weight: 700;
    color: #1F1A17;
    margin-top: 14pt;
    margin-bottom: 10pt;
    padding-bottom: 6pt;
    border-bottom: 2pt solid #C76E4A;
}

h2 {
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 14pt;
    font-weight: 700;
    color: #C76E4A;
    margin-top: 18pt;
    margin-bottom: 6pt;
}

h3 {
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 11.5pt;
    font-weight: 700;
    color: #1F1A17;
    margin-top: 14pt;
    margin-bottom: 4pt;
}

h4 {
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 10.5pt;
    font-weight: 700;
    font-style: italic;
    color: #555;
    margin-top: 10pt;
    margin-bottom: 3pt;
}

p {
    margin: 4pt 0 6pt 0;
    text-align: left;
}

strong {
    color: #1F1A17;
}

em {
    color: #555;
}

hr {
    border: 0;
    border-top: 0.5pt solid #C76E4A;
    margin: 14pt 0;
}

ul, ol {
    margin: 4pt 0 8pt 0;
    padding-left: 18pt;
}

li {
    margin-bottom: 2pt;
}

/* Prompt code blocks — the heart of the product */
pre {
    background-color: #F8F4EE;
    border-left: 3pt solid #C76E4A;
    padding: 10pt 12pt;
    margin: 8pt 0 12pt 0;
    font-family: "Courier New", "Consolas", monospace;
    font-size: 9pt;
    line-height: 1.45;
    color: #1F1A17;
    white-space: pre-wrap;
    word-wrap: break-word;
    page-break-inside: avoid;
}

code {
    background-color: #F8F4EE;
    padding: 1pt 3pt;
    font-family: "Courier New", "Consolas", monospace;
    font-size: 9.5pt;
    color: #1F1A17;
}

pre code {
    background-color: transparent;
    padding: 0;
    font-size: 9pt;
}

blockquote {
    margin: 8pt 0 8pt 0;
    padding: 6pt 12pt;
    border-left: 2pt solid #8FA68E;
    color: #444;
    font-style: italic;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0 14pt 0;
}

th {
    background-color: #C76E4A;
    color: #FFFFFF;
    padding: 5pt 8pt;
    text-align: left;
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 9.5pt;
}

td {
    padding: 4pt 8pt;
    border-bottom: 0.5pt solid #DDD;
    font-size: 9.5pt;
}

#footerContent {
    text-align: center;
    font-family: "Helvetica", "Arial", sans-serif;
    font-size: 8pt;
    color: #888;
}
"""


def main():
    if not SRC.exists():
        raise SystemExit(f"Source missing: {SRC}. Run build_product.py first.")

    md_text = SRC.read_text(encoding="utf-8")
    html_body = markdown.markdown(
        md_text,
        extensions=["fenced_code", "tables", "toc", "sane_lists"],
    )

    html_doc = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>{CSS}</style>
</head>
<body>
{html_body}
<div id="footerContent">150 ChatGPT Prompts for Etsy Sellers  ·  Page <pdf:pagenumber></pdf:pagenumber></div>
</body></html>
"""

    CSS_PATH.write_text(CSS, encoding="utf-8")

    with open(OUT, "wb") as out_file:
        result = pisa.CreatePDF(
            src=html_doc,
            dest=out_file,
            encoding="utf-8",
        )

    if result.err:
        raise SystemExit(f"PDF generation failed: {result.err}")
    size_kb = OUT.stat().st_size / 1024
    print(f"[OK] Wrote {OUT} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
