"""Second corpus for GlowSpark: the simplest public-domain children's books.

Pool   = the books of the first corpus + every English text in the Project Gutenberg catalogue by a list of
         authors who wrote for young children (AUTHORS: an editorial list, the only hand-made input).
Score  = the share of a book's words that are among the EASY_WORDS most frequent words of the whole pool.
Choice = simplest book first until TARGET_BYTES; books with long sentences are skipped and no author may
         fill more than MAX_AUTHOR_BYTES.
Split  = books of the first corpus keep their split (training continues from a checkpoint that saw the first
         training set, so its held-out books must stay held out); every HOLDOUT_EVERY-th new book is held out.

  python corpus2.py --dry   only list what the catalogue offers per author
"""
import csv
import io
import json
import re
import sys
import time
from collections import Counter
from pathlib import Path

import corpus

HERE = Path(__file__).parent
OUT = HERE / "data2"
OLD = HERE / "data"
RAW = corpus.RAW
AUTHORS = [
    "burgess, thornton w", "bailey, arthur scott", "garis, howard r", "potter, beatrix", "hope, laura lee",
    "cory, david", "gruelle, johnny", "pierson, clara dillingham", "walker, abbie phillips",
    "hopkins, william john", "lindsay, maud", "bryant, sara cone", "perkins, lucy fitch",
    "bailey, carolyn sherwin", "bonner, mary graham", "smith, laura rountree", "blaisdell, mary frances",
    "barnum, richard", "fox, frances margaret", "lawrence, josephine", "poulsson, emilie",
    "montgomery, frances trego", "scudder, horace elisha", "baldwin, james, 1841", "mcguffey, william holmes",
    "pyle, katharine", "jacobs, joseph", "milne, a. a.", "lofting, hugh", "baum, l. frank",
    "bianco, margery williams", "craik, georgiana m", "grover, eulalie osgood", "judson, clara ingram",
    "dopp, katharine elizabeth", "serl, emma", "bigham, madge a", "elson, william h",
    "treadwell, harriette taylor",
]
HOPE_TITLES = ("bobbsey", "bunny brown", "six little bunkers", "story of a")
EASY_WORDS = 1500
MAX_SENTENCE_WORDS = 24
MAX_AUTHOR_BYTES = 9_000_000
TARGET_BYTES = 45_000_000
HOLDOUT_EVERY = 12
DOWNLOAD_BUDGET_SECONDS = 20 * 60
WORD = re.compile(r"[a-z]+(?:'[a-z]+)?")


def first_author(authors):
    name = authors.split(";")[0]
    name = re.sub(r"\s*\(.*?\)", "", name)
    name = re.sub(r",?\s*\d{3,4}\??-.*$", "", name)
    return name.strip().lower()


def title_key(title):
    return re.sub(r"[^a-z0-9]", "", title.lower())[:60]


def catalogue_candidates():
    body = (RAW / "pg_catalog.csv").read_bytes().decode("utf-8")
    found = {needle: [] for needle in AUTHORS}
    for row in csv.DictReader(io.StringIO(body)):
        if row["Type"] != "Text" or row["Language"] != "en":
            continue
        authors = row["Authors"].lower()
        title = " ".join(row["Title"].split())
        for needle in AUTHORS:
            if needle not in authors:
                continue
            if needle == "hope, laura lee" and not any(word in title.lower() for word in HOPE_TITLES):
                break
            found[needle].append({
                "id": int(row["Text#"]),
                "title": title,
                "authors": row["Authors"],
                "url": f"https://www.gutenberg.org/cache/epub/{row['Text#']}/pg{row['Text#']}.txt",
            })
            break
    return found


def main():
    found = catalogue_candidates()
    for needle, books in found.items():
        print("author", needle, len(books), flush=True)
    print("catalogue total", sum(len(books) for books in found.values()), flush=True)
    if "--dry" in sys.argv:
        return 0

    OUT.mkdir(exist_ok=True)
    pool, seen_ids, seen_titles = [], set(), set()
    for book in json.loads((OLD / "books.json").read_text(encoding="utf-8")):
        text = (OLD / f"clean_{book['id']}.txt").read_text(encoding="utf-8")
        pool.append({"id": book["id"], "title": book["title"], "authors": book["authors"], "url": book["url"],
                     "old_split": book["split"], "text": text})
        seen_ids.add(book["id"])
        seen_titles.add((title_key(book["title"]), first_author(book["authors"])))

    started = time.time()
    fetched = out_of_time = 0
    for needle in AUTHORS:
        for book in found[needle]:
            key = (title_key(book["title"]), first_author(book["authors"]))
            if book["id"] in seen_ids or key in seen_titles:
                continue
            raw_path = RAW / f"{book['id']}.txt"
            if not raw_path.exists():
                if time.time() - started > DOWNLOAD_BUDGET_SECONDS:
                    out_of_time += 1
                    continue
                body = corpus.fetch(book["url"])
                if body is None:
                    continue
                raw_path.write_bytes(body)
                fetched += 1
                time.sleep(0.2)
                if fetched % 25 == 0:
                    print("fetched", fetched, round(time.time() - started), "s", flush=True)
            text = corpus.clean(raw_path.read_bytes())
            if text is None:
                continue
            seen_ids.add(book["id"])
            seen_titles.add(key)
            pool.append({**book, "old_split": None, "text": text})
    print("pool", len(pool), "fetched", fetched, "not fetched (time budget)", out_of_time, flush=True)

    counts = Counter()
    for book in pool:
        counts.update(WORD.findall(book["text"].lower()))
    easy = {word for word, _ in counts.most_common(EASY_WORDS)}
    for book in pool:
        words = WORD.findall(book["text"].lower())
        book["bytes"] = len(book["text"].encode("utf-8"))
        book["easy_share"] = round(sum(word in easy for word in words) / max(1, len(words)), 4)
        book["sentence_words"] = round(len(words) / max(1, len(re.findall(r"[.!?]+", book["text"]))), 1)

    pool.sort(key=lambda book: (-book["easy_share"], book["id"]))
    kept, total, per_author = [], 0, Counter()
    for book in pool:
        if total >= TARGET_BYTES:
            break
        author = first_author(book["authors"])
        if book["sentence_words"] > MAX_SENTENCE_WORDS:
            continue
        if per_author[author] + book["bytes"] > MAX_AUTHOR_BYTES:
            continue
        kept.append(book)
        total += book["bytes"]
        per_author[author] += book["bytes"]

    new_books = 0
    for book in kept:
        if book["old_split"]:
            book["split"] = book["old_split"]
        else:
            book["split"] = "val" if new_books % HOLDOUT_EVERY == HOLDOUT_EVERY - 1 else "train"
            new_books += 1

    for split in ("train", "val"):
        with open(OUT / f"{split}.txt", "w", encoding="utf-8", newline="\n") as handle:
            for book in kept:
                if book["split"] == split:
                    handle.write(book["text"])
                    handle.write("\n<|endoftext|>\n")
    fields = ("id", "title", "authors", "url", "bytes", "split", "easy_share", "sentence_words")
    listing = [{field: book[field] for field in fields} for book in kept]
    (OUT / "books.json").write_text(json.dumps(listing, indent=1), encoding="utf-8", newline="\n")
    summary = {
        "rule": {"easy_words": EASY_WORDS, "max_sentence_words": MAX_SENTENCE_WORDS,
                 "max_author_bytes": MAX_AUTHOR_BYTES, "target_bytes": TARGET_BYTES, "holdout_every": HOLDOUT_EVERY},
        "pool_books": len(pool),
        "pool_bytes": sum(book["bytes"] for book in pool),
        "kept_books": len(kept),
        "kept_bytes": total,
        "kept_from_first_corpus": sum(1 for book in kept if book["old_split"]),
        "train_books": sum(1 for book in kept if book["split"] == "train"),
        "val_books": sum(1 for book in kept if book["split"] == "val"),
        "easy_share_kept_min": min(book["easy_share"] for book in kept),
        "easy_share_pool_median": sorted(book["easy_share"] for book in pool)[len(pool) // 2],
        "bytes_per_author": dict(per_author.most_common()),
    }
    (OUT / "selection.json").write_text(json.dumps(summary, indent=1), encoding="utf-8", newline="\n")
    print("DONE", json.dumps(summary), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
