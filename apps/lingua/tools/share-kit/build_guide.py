"""Build the Lingua installation & usage guide deck.

    python build_guide.py                      # uses the version in engine/version.py
    python build_guide.py --version 2.3.1 --out ../../docs/Lingua_Installation_and_Usage_Guide.pptx
"""
import argparse
import re
from pathlib import Path

import lingua_deck

HERE = Path(__file__).resolve().parent
VERSION_FILE = HERE.parents[1] / "engine" / "version.py"
DEFAULT_OUT = HERE.parents[1] / "docs" / "Lingua_Installation_and_Usage_Guide.pptx"


def current_version():
    match = re.search(r'__version__\s*=\s*"([^"]+)"', VERSION_FILE.read_text(encoding="utf-8"))
    return match.group(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default=None)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    version = args.version or current_version()
    path = lingua_deck.build_guide_deck(version, args.out)
    print(f"wrote {path} (Lingua {version})")


if __name__ == "__main__":
    main()
