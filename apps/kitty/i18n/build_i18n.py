#!/usr/bin/env python3
"""Build Kitty language packs (web/js/lang/<code>.js) from strings.txt and validate them.

Each non-comment line of strings.txt is:  English || Indonesian || Chinese || Spanish
Checks: four columns, identical {placeholder} sets per row, no key defined twice with different text.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "strings.txt"
OUT_DIR = HERE.parent / "web" / "js" / "lang"
LANGS = ["id", "zh", "es"]
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def load(path=SOURCE):
    rows = {}
    problems = []
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        cols = [c.strip() for c in line.split(" || ")]
        if len(cols) != 1 + len(LANGS):
            problems.append("line %d: expected %d columns, got %d" % (lineno, 1 + len(LANGS), len(cols)))
            continue
        key, values = cols[0], cols[1:]
        wanted = sorted(set(PLACEHOLDER.findall(key)))
        for code, value in zip(LANGS, values):
            if not value:
                problems.append("line %d: empty %s translation" % (lineno, code))
            got = sorted(set(PLACEHOLDER.findall(value)))
            if got != wanted:
                problems.append("line %d: %s placeholders %s != %s" % (lineno, code, got, wanted))
        if key in rows and rows[key] != values:
            problems.append("line %d: %r defined twice with different translations" % (lineno, key))
        rows[key] = values
    return rows, problems


def render(rows):
    """Return {lang code: generated JavaScript source} for the given rows."""
    packs = {}
    for index, code in enumerate(LANGS):
        table = {key: values[index] for key, values in rows.items()}
        body = json.dumps(table, ensure_ascii=False, indent=0, sort_keys=True)
        packs[code] = (
            "/* Kitty translations (%s). Generated from apps/kitty/i18n/strings.txt by build_i18n.py; edit the source. */\n"
            "Kitty.i18n.add('%s', %s);\n" % (code, code, body)
        )
    return packs


def build():
    rows, problems = load()
    if problems:
        print("\n".join(problems))
        return 1
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for code, source in render(rows).items():
        (OUT_DIR / (code + ".js")).write_text(source, encoding="utf-8")
    print("%d strings x %d languages" % (len(rows), len(LANGS)))
    return 0


if __name__ == "__main__":
    sys.exit(build())
