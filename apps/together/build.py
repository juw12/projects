"""Build Together's single-file app from its modular source.

The published app must stay ONE self-contained file (works offline, no network for code, survives "Save page"),
so the source in src/ is split by concern and this script inlines it:

    src/index.html   page shell with /*@build:css*/ and //@build:js markers
    src/styles.css   all styles
    src/js/NN-*.js   classic scripts concatenated in filename order (shared top-level scope, no bundler needed)

Usage:
    python apps/together/build.py           write web/index.html
    python apps/together/build.py --check   fail if web/index.html is not up to date with src/
"""
import sys
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "src"
OUT = HERE / "web" / "index.html"
CSS_MARK = "\n/*@build:css*/\n"
JS_MARK = "\n//@build:js\n"
TOP_LEVEL_FUNCTION = re.compile(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)


def read(path):
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def check_unique_functions(scripts):
    """All scripts share one scope, so a second `function name(` silently replaces the first. Refuse that."""
    seen = {}
    for path in scripts:
        for name in TOP_LEVEL_FUNCTION.findall(read(path)):
            if name in seen:
                raise SystemExit(f"function {name}() is declared in both {seen[name]} and {path.name}; rename one")
            seen[name] = path.name


def build():
    template = read(SRC / "index.html")
    if template.count(CSS_MARK) != 1 or template.count(JS_MARK) != 1:
        raise SystemExit("src/index.html must contain each build marker exactly once")
    scripts = sorted((SRC / "js").glob("*.js"))
    if not scripts:
        raise SystemExit("no scripts in src/js")
    check_unique_functions(scripts)
    js = "".join(read(path) for path in scripts)
    return template.replace(CSS_MARK, read(SRC / "styles.css")).replace(JS_MARK, js)


def main():
    html = build()
    if "--check" in sys.argv:
        current = read(OUT) if OUT.exists() else ""
        if current != html:
            raise SystemExit("web/index.html is out of date - run: python apps/together/build.py")
        print(f"web/index.html is up to date ({len(html):,} chars from {len(list((SRC / 'js').glob('*.js')))} scripts)")
        return
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(HERE.parent.parent)} ({len(html):,} chars)")


if __name__ == "__main__":
    main()
