"""Screenshot tidy-up prototype (Clutter-style layer for Haru).

On iOS the text comes from Vision OCR (ja-JP, ko-KR, en-US); here we test the
pieces that run *after* OCR, so the Swift port can match them exactly:

  classify(text)          -> drawer + score, using ios/Resources/clip_lexicon.json
  find_expiry(text)       -> first future-looking date (tickets/coupons -> "let go after")
  near_duplicates(paths)  -> groups of visually near-identical screenshots (dHash)

Usage:
  python tidy.py --eval                 # run the labelled sample set
  python tidy.py --dupes DIR            # group near-duplicate PNG/JPGs in DIR
  python tidy.py "text to classify"
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LEXICON_PATH = ROOT / "ios" / "Resources" / "clip_lexicon.json"
MAX_PATTERN_HITS = 3   # cap so a long price list doesn't drown other signals


def load_lexicon(path: Path = LEXICON_PATH) -> dict:
    lexicon = json.loads(path.read_text(encoding="utf-8"))
    for drawer in lexicon["drawers"].values():
        drawer["compiled"] = [
            (re.compile(pattern, re.IGNORECASE | re.MULTILINE), weight)
            for pattern, weight in drawer["patterns"].items()
        ]
    return lexicon


LEXICON = load_lexicon()


def drawer_scores(text: str, lexicon: dict = LEXICON) -> dict[str, float]:
    lowered = text.lower()
    scores: dict[str, float] = {}
    for name, drawer in lexicon["drawers"].items():
        score = 0.0
        for keyword, weight in drawer["keywords"].items():
            if keyword.lower() in lowered:
                score += weight
        for pattern, weight in drawer["compiled"]:
            hits = len(pattern.findall(text))
            score += min(hits, MAX_PATTERN_HITS) * weight
        scores[name] = score

    rule = lexicon["words_rule"]
    compact = re.sub(r"\s+", "", text)
    line_count = len([line for line in text.splitlines() if line.strip()])
    if compact and len(compact) <= rule["max_chars"] and line_count <= rule["max_lines"]:
        digit_ratio = sum(ch.isdigit() for ch in compact) / len(compact)
        if digit_ratio <= rule["max_digit_ratio"]:
            scores["words"] = scores.get("words", 0) + rule["bonus"]
    return scores


def classify(text: str, lexicon: dict = LEXICON) -> tuple[str, float]:
    scores = drawer_scores(text, lexicon)
    best = max(scores, key=scores.get)
    if scores[best] < lexicon["min_score"]:
        return "other", scores[best]
    return best, scores[best]


DATE_PATTERNS = [
    # 2026/11/14, 2026-11-14, 2026.11.14
    (re.compile(r"(20\d{2})[./-](\d{1,2})[./-](\d{1,2})"), ("y", "m", "d")),
    # 2026年11月14日 / 2026년 11월 14일
    (re.compile(r"(20\d{2})\s?[年년]\s?(\d{1,2})\s?[月월]\s?(\d{1,2})\s?[日일]?"), ("y", "m", "d")),
    # 11月14日 / 11월 14일 (year inferred)
    (re.compile(r"(\d{1,2})\s?[月월]\s?(\d{1,2})\s?[日일]"), ("m", "d")),
    # Nov 14 / 14 Nov
    (re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\b", re.IGNORECASE), ("mon", "d")),
]
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def find_expiry(text: str, today: dt.date | None = None) -> dt.date | None:
    """Earliest date on or after `today` mentioned in the text (year inferred if missing)."""
    today = today or dt.date.today()
    found: list[dt.date] = []
    for pattern, fields in DATE_PATTERNS:
        for match in pattern.finditer(text):
            parts = dict(zip(fields, match.groups()))
            try:
                month = MONTHS.index(parts["mon"][:3].lower()) + 1 if "mon" in parts else int(parts["m"])
                day = int(parts["d"])
                year = int(parts["y"]) if "y" in parts else today.year
                candidate = dt.date(year, month, day)
                if "y" not in parts and candidate < today:
                    candidate = dt.date(year + 1, month, day)
            except ValueError:
                continue
            if candidate >= today:
                found.append(candidate)
    return min(found) if found else None


def dhash(path: Path, size: int = 8) -> int:
    from PIL import Image

    with Image.open(path) as picture:
        grey = picture.convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
        pixels = list(grey.getdata())
    bits = 0
    for row in range(size):
        for column in range(size):
            left = pixels[row * (size + 1) + column]
            right = pixels[row * (size + 1) + column + 1]
            bits = (bits << 1) | (left > right)
    return bits


def near_duplicates(paths: list[Path], max_distance: int = 6) -> list[list[Path]]:
    """Group screenshots whose 64-bit dHash differs by <= max_distance bits."""
    hashes = [(path, dhash(path)) for path in paths]
    parent = list(range(len(hashes)))

    def root(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for i in range(len(hashes)):
        for j in range(i + 1, len(hashes)):
            if bin(hashes[i][1] ^ hashes[j][1]).count("1") <= max_distance:
                parent[root(j)] = root(i)
    groups: dict[int, list[Path]] = defaultdict(list)
    for index, (path, _) in enumerate(hashes):
        groups[root(index)].append(path)
    return [group for group in groups.values() if len(group) > 1]


def evaluate(samples_path: Path) -> None:
    samples = json.loads(samples_path.read_text(encoding="utf-8"))
    confusion: Counter[tuple[str, str]] = Counter()
    misses = []
    for sample in samples:
        predicted, score = classify(sample["text"])
        confusion[(sample["label"], predicted)] += 1
        if predicted != sample["label"]:
            misses.append((sample["label"], predicted, round(score, 1), sample["text"][:60].replace("\n", " / ")))
    total = sum(confusion.values())
    correct = sum(count for (label, predicted), count in confusion.items() if label == predicted)
    print(f"accuracy {correct}/{total} = {correct / total:.0%}")
    labels = sorted({label for label, _ in confusion} | {predicted for _, predicted in confusion})
    for label in labels:
        row_total = sum(count for (truth, _), count in confusion.items() if truth == label)
        hits = confusion[(label, label)]
        if row_total:
            print(f"  {label:9s} recall {hits}/{row_total}")
    for miss in misses:
        print("  MISS", miss)


PARITY_TODAY = dt.date(2026, 11, 2)


def export_expected() -> None:
    """Golden file: ios/HaruTests/ClipClassifierTests.swift must reproduce these exactly."""
    here = Path(__file__).parent
    records = []
    for sample_file in ("samples.json", "holdout.json"):
        for sample in json.loads((here / sample_file).read_text(encoding="utf-8")):
            drawer, score = classify(sample["text"])
            expiry = find_expiry(sample["text"], PARITY_TODAY)
            records.append({
                "text": sample["text"],
                "drawer": drawer,
                "score": round(score, 3),
                "expiry": expiry.isoformat() if expiry else None,
            })
    out = here / "expected.json"
    out.write_text(json.dumps({"today": PARITY_TODAY.isoformat(), "cases": records}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {len(records)} cases to {out}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("text", nargs="?")
    parser.add_argument("--eval", action="store_true")
    parser.add_argument("--dupes", type=Path)
    parser.add_argument("--export-expected", action="store_true", help="write expected.json for the Swift parity test")
    args = parser.parse_args()

    if args.eval:
        for sample_file in ("samples.json", "holdout.json"):
            print(f"== {sample_file}")
            evaluate(Path(__file__).with_name(sample_file))
    elif args.export_expected:
        export_expected()
    elif args.dupes:
        images = sorted(p for p in args.dupes.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"})
        for group in near_duplicates(images):
            print("near-duplicates:", ", ".join(p.name for p in group))
    elif args.text:
        drawer, score = classify(args.text)
        print(drawer, round(score, 1), find_expiry(args.text))
    else:
        parser.print_help()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
