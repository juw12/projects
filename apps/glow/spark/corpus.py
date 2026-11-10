"""Download a public-domain corpus from Project Gutenberg (via the Gutendex catalogue) and clean it.

Whole books are held out for validation so the metric measures unseen books, not unseen chunks.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent / "data"
RAW = OUT / "raw"
WANTED = ["fairy tales", "children's stories", "fables", "bedtime", "animals -- juvenile fiction"]
TARGET_BYTES = 45_000_000
HOLDOUT_EVERY = 12
USER_AGENT = "GlowSpark-corpus/1.0 (https://github.com/juw12/projects)"

TYPOGRAPHY = str.maketrans({
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2014": "--", "\u2013": "-", "\u2026": "...", "\u00a0": " ", "_": "",
})


def fetch(url, tries=3):
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=25) as response:
                return response.read()
        except Exception as error:
            print("retry", attempt, url, repr(error)[:80], flush=True)
            time.sleep(2 + attempt * 3)
    return None


def catalogue():
    """Project Gutenberg's own catalogue CSV: English texts whose subjects or shelf mark them as tales for children."""
    import csv
    import io
    import random

    cached = RAW / "pg_catalog.csv"
    if not cached.exists():
        cached.write_bytes(fetch("https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv"))
    body = cached.read_bytes()
    rows = csv.DictReader(io.StringIO(body.decode("utf-8")))
    first, second = [], []
    for row in rows:
        if row["Type"] != "Text" or row["Language"] != "en":
            continue
        subjects = (row["Subjects"] + " " + row["Bookshelves"]).lower()
        book = {
            "id": int(row["Text#"]),
            "title": " ".join(row["Title"].split()),
            "authors": row["Authors"],
            "url": f"https://www.gutenberg.org/cache/epub/{row['Text#']}/pg{row['Text#']}.txt",
        }
        if any(word in subjects for word in WANTED):
            first.append(book)
        elif "PZ" in row["LoCC"].split("; ") or "juvenile fiction" in subjects:
            second.append(book)
    shuffler = random.Random(2026)
    shuffler.shuffle(first)
    shuffler.shuffle(second)
    print("catalogue", len(first), len(second), flush=True)
    return first + second


def clean(raw_bytes):
    text = raw_bytes.decode("utf-8", errors="replace")
    header = text[:3000].lower()
    if "copyrighted" in header or "for the use of anyone anywhere" not in header:
        return None
    start = re.search(r"\*\*\* ?START OF (THE|THIS) PROJECT GUTENBERG EBOOK.*?\*\*\*", text, re.S)
    end = re.search(r"\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG EBOOK", text)
    if not start or not end:
        return None
    text = text[start.end():end.start()].replace("\r\n", "\n").translate(TYPOGRAPHY)
    text = re.sub(r"\[Illustration[^\]]*\]", "", text)
    paragraphs = []
    for block in re.split(r"\n\s*\n", text):
        paragraph = " ".join(line.strip() for line in block.split("\n") if line.strip())
        paragraph = re.sub(r"\s+", " ", paragraph)
        letters = sum(character.isalpha() for character in paragraph)
        is_prose = len(paragraph) >= 60 and letters / len(paragraph) > 0.7
        mostly_ascii = sum(ord(character) < 128 for character in paragraph) / max(1, len(paragraph)) > 0.98
        shouting = paragraph.upper() == paragraph
        if is_prose and mostly_ascii and not shouting:
            paragraphs.append(paragraph)
    if len(paragraphs) < 40:
        return None
    return "\n".join(paragraphs)


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    books = catalogue()
    kept, total = [], 0
    for book in books:
        if total >= TARGET_BYTES:
            break
        raw_path = RAW / f"{book['id']}.txt"
        if not raw_path.exists():
            body = fetch(book["url"])
            if body is None:
                continue
            raw_path.write_bytes(body)
            time.sleep(0.25)
        text = clean(raw_path.read_bytes())
        if text is None:
            continue
        book["bytes"] = len(text.encode("utf-8"))
        book["split"] = "val" if len(kept) % HOLDOUT_EVERY == HOLDOUT_EVERY - 1 else "train"
        (OUT / f"clean_{book['id']}.txt").write_text(text, encoding="utf-8", newline="\n")
        kept.append(book)
        total += book["bytes"]
        if len(kept) % 20 == 0:
            print("books", len(kept), "MB", round(total / 1e6, 1), flush=True)
    (OUT / "books.json").write_text(json.dumps(kept, indent=1), encoding="utf-8", newline="\n")
    for split in ("train", "val"):
        with open(OUT / f"{split}.txt", "w", encoding="utf-8", newline="\n") as handle:
            for book in kept:
                if book["split"] == split:
                    handle.write((OUT / f"clean_{book['id']}.txt").read_text(encoding="utf-8"))
                    handle.write("\n<|endoftext|>\n")
    print("DONE books", len(kept), "MB", round(total / 1e6, 1), flush=True)


if __name__ == "__main__":
    sys.exit(main())
