"""Subset the bundled OFL fonts to the characters Haru actually needs.

Full fonts (~27 MB) live in tools/.font_cache (git-ignored, re-downloaded if missing);
subsets are written over ios/Resources/Fonts/*.ttf with the same file and PostScript
names, so project.yml (UIAppFonts) and Theme.swift don't change.

Coverage
  Japanese fonts (Zen Maru Gothic, Klee One): ASCII + Latin-1, punctuation, arrows/symbols,
      kana, CJK punctuation, full-width forms, JIS X 0208 level-1 kanji (2,965 common kanji).
  Korean fonts (Gowun Dodum, Nanum Pen Script): ASCII + Latin-1, punctuation, compatibility
      jamo, KS X 1001 Hangul (2,350 syllables).
Anything outside a subset falls back to the system font glyph (CoreText cascade), so text
never disappears — it just loses the hand-drawn look for that character.

    pip install fonttools
    python tools/subset_fonts.py
"""

from __future__ import annotations

import shutil
import sys
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONTS = ROOT / "ios" / "Resources" / "Fonts"
CACHE = Path(__file__).resolve().parent / ".font_cache"
BASE_URL = "https://raw.githubusercontent.com/google/fonts/main/ofl/"

SOURCES = {
    "ZenMaruGothic-Regular.ttf": ("zenmarugothic/ZenMaruGothic-Regular.ttf", "ja"),
    "ZenMaruGothic-Bold.ttf": ("zenmarugothic/ZenMaruGothic-Bold.ttf", "ja"),
    "KleeOne-Regular.ttf": ("kleeone/KleeOne-Regular.ttf", "ja"),
    "GowunDodum-Regular.ttf": ("gowundodum/GowunDodum-Regular.ttf", "ko"),
    "NanumPenScript-Regular.ttf": ("nanumpenscript/NanumPenScript-Regular.ttf", "ko"),
}


def ranges(*spans: tuple[int, int]) -> set[int]:
    return {code for start, end in spans for code in range(start, end + 1)}


COMMON = ranges(
    (0x0020, 0x007E),   # ASCII
    (0x00A0, 0x00FF),   # Latin-1
    (0x2010, 0x206F),   # general punctuation (— … “ ” ‘ ’ ・)
    (0x2190, 0x21FF),   # arrows (→ ←)
    (0x2600, 0x26FF),   # misc symbols (★ ☆ ☀)
    (0x25A0, 0x25FF),   # geometric shapes (● ○ ■)
    (0x3000, 0x303F),   # CJK punctuation (、。「」『』〜)
    (0xFF01, 0xFF60),   # full-width ASCII
    (0xFFE0, 0xFFEE),   # full-width signs (￥ ￦)
)


def jis_level1_kanji() -> set[int]:
    """JIS X 0208 rows 16–47 = level-1 kanji, read through the EUC-JP codec."""
    codes = set()
    for row in range(16, 48):
        for cell in range(1, 95):
            try:
                character = bytes([0xA0 + row, 0xA0 + cell]).decode("euc_jp")
            except UnicodeDecodeError:
                continue
            codes.add(ord(character))
    return codes


def ks_x1001_hangul() -> set[int]:
    """KS X 1001 Hangul block (0xB0A1–0xC8FE) = the 2,350 everyday syllables."""
    codes = set()
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            try:
                character = bytes([lead, trail]).decode("euc_kr")
            except UnicodeDecodeError:
                continue
            codes.add(ord(character))
    return codes


JAPANESE = COMMON | ranges((0x3040, 0x30FF), (0x31F0, 0x31FF)) | jis_level1_kanji()
KOREAN = COMMON | ranges((0x3130, 0x318F)) | ks_x1001_hangul()


def original(name: str, repo_path: str) -> Path:
    CACHE.mkdir(exist_ok=True)
    cached = CACHE / name
    if not cached.exists():
        bundled = FONTS / name
        # First run: the bundled file is still the full font — keep it as the source.
        if bundled.exists() and bundled.stat().st_size > 2_000_000:
            shutil.copy2(bundled, cached)
        else:
            urllib.request.urlretrieve(BASE_URL + repo_path, cached)
    return cached


def postscript_name(path: Path) -> str:
    return str(TTFont(path)["name"].getDebugName(6))


def main() -> None:
    total_before = total_after = 0
    for name, (repo_path, script) in SOURCES.items():
        source = original(name, repo_path)
        target = FONTS / name
        options = subset.Options()
        options.layout_features = ["*"]       # keep kerning, ligatures, vertical forms
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.notdef_outline = True
        options.glyph_names = False
        options.hinting = False               # iOS ignores TrueType hinting
        font = subset.load_font(str(source), options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=JAPANESE if script == "ja" else KOREAN)
        subsetter.subset(font)
        subset.save_font(font, str(target), options)

        before, after = source.stat().st_size, target.stat().st_size
        total_before += before
        total_after += after
        kept = len(TTFont(target).getBestCmap())
        assert postscript_name(target) == postscript_name(source), "PostScript name changed"
        print(f"{name:30s} {before / 1e6:5.2f} MB -> {after / 1e6:5.2f} MB  ({kept} chars, {postscript_name(target)})")
    print(f"{'total':30s} {total_before / 1e6:5.2f} MB -> {total_after / 1e6:5.2f} MB")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
