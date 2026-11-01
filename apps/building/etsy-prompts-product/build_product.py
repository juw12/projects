#!/usr/bin/env python
"""
build_product.py — Consolidate the 150 prompt sections into a single product source file.

Outputs:
- product-files/master-source.md  (the full product as one markdown file — source of truth for PDF/Notion)
- product-files/master-source.txt (plain text version for non-markdown viewers)
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
PROMPTS_DIR = ROOT / "prompts"
OUT_DIR = ROOT / "product-files"
OUT_DIR.mkdir(parents=True, exist_ok=True)

SECTION_FILES = [
    ("00-intro-workflow.md", "Front Matter — The System & 6-Phase Workflow"),
    ("01-titles.md", "Section 01 — Listing Titles That Rank (15 prompts)"),
    ("02-descriptions.md", "Section 02 — Descriptions That Convert (20 prompts)"),
    ("03-tags-seo.md", "Section 03 — Tags & Etsy SEO (15 prompts)"),
    ("04-customer-service.md", "Section 04 — Customer Service Replies (20 prompts)"),
    ("05-social-media.md", "Section 05 — Social Media Captions (20 prompts)"),
    ("06-emails.md", "Section 06 — Customer Emails (15 prompts)"),
    ("07-mockups-photography.md", "Section 07 — Mockups, Photography & Listing Images (15 prompts)"),
    ("08-research-validation.md", "Section 08 — Product Research & Validation (15 prompts)"),
    ("09-troubleshooting-strategy.md", "Section 09 — Troubleshooting, Diagnosis & Strategy (15 prompts)"),
]

# Page-break hint for PDF (some renderers honor this)
PAGE_BREAK = "\n\n<div style='page-break-after: always;'></div>\n\n"


def main():
    parts = []
    parts.append("# 150 ChatGPT Prompts for Etsy Sellers\n")
    parts.append("### A system that uses prompts to write listings that rank, descriptions that convert, and a shop that grows.\n")
    parts.append("---\n")

    for filename, title in SECTION_FILES:
        path = PROMPTS_DIR / filename
        if not path.exists():
            print(f"[WARN] Missing: {path}")
            continue
        text = path.read_text(encoding="utf-8")
        # Inject a strong heading (overrides file's first H1 if any)
        parts.append(PAGE_BREAK)
        parts.append(f"# {title}\n")
        # Skip the file's own H1 line so we don't duplicate
        lines = text.splitlines()
        skipped_first_h1 = False
        for line in lines:
            if not skipped_first_h1 and line.startswith("# "):
                skipped_first_h1 = True
                continue
            parts.append(line)
        parts.append("\n")

    master = "\n".join(parts)
    out_md = OUT_DIR / "master-source.md"
    out_md.write_text(master, encoding="utf-8")
    print(f"[OK] Wrote {out_md} ({len(master):,} chars)")

    # Plain text version (strip markdown syntax minimally for max compatibility)
    plain = master
    plain = re.sub(r"^#{1,6}\s+", "", plain, flags=re.MULTILINE)
    plain = re.sub(r"\*\*(.+?)\*\*", r"\1", plain)
    plain = re.sub(r"\*(.+?)\*", r"\1", plain)
    plain = re.sub(r"`([^`]+)`", r"\1", plain)
    plain = re.sub(r"^>\s?", "", plain, flags=re.MULTILINE)
    out_txt = OUT_DIR / "master-source.txt"
    out_txt.write_text(plain, encoding="utf-8")
    print(f"[OK] Wrote {out_txt} ({len(plain):,} chars)")


if __name__ == "__main__":
    main()
