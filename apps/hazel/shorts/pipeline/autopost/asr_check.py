"""Speech-to-text check: does every narrated line say what the script says?

    python asr_check.py lines.json            # lines.json = [{"text": "...", "audio": "scene_01.mp3"}, ...]

Transcribes each clip with faster-whisper and compares it word by word with the script text after
normalising both sides (lower case, punctuation, Indonesian numbers -> words, "%" -> "persen").
Prints a JSON report; exit 0 = all lines pass, 1 = some line differs, 2 = the check could not run.

Idea from lemomo-ai/lemo-opuscar (MIT, core/tts/asr_check.py); this is an independent implementation
with Indonesian number handling. Model: env ASR_MODEL (default "small"), threshold env ASR_THRESHOLD (0.82, letter-level).
"""

import difflib
import json
import os
import re
import sys

_UNITS = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]


def terbilang(n):
    """Integer -> Indonesian words (0 .. 999 999 999 999)."""
    if n < 12:
        return _UNITS[n]
    if n < 20:
        return terbilang(n - 10) + " belas"
    if n < 100:
        rest = n % 10
        return terbilang(n // 10) + " puluh" + (" " + terbilang(rest) if rest else "")
    if n < 200:
        rest = n - 100
        return "seratus" + (" " + terbilang(rest) if rest else "")
    if n < 1000:
        rest = n % 100
        return terbilang(n // 100) + " ratus" + (" " + terbilang(rest) if rest else "")
    if n < 2000:
        rest = n - 1000
        return "seribu" + (" " + terbilang(rest) if rest else "")
    for size, word in ((10 ** 9, "miliar"), (10 ** 6, "juta"), (10 ** 3, "ribu")):
        if n >= size:
            rest = n % size
            return terbilang(n // size) + " " + word + (" " + terbilang(rest) if rest else "")
    return str(n)


def _number_to_words(match):
    token = match.group(0)
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", token):  # 45.678.910 -> thousands separators
        token = token.replace(".", "")
    if "," in token:
        whole, frac = token.split(",", 1)
        whole = whole.replace(".", "")
        return terbilang(int(whole)) + " koma " + " ".join(_UNITS[int(d)] for d in frac if d.isdigit())
    if "." in token:  # whisper sometimes writes decimals with a dot
        whole, frac = token.split(".", 1)
        return terbilang(int(whole)) + " koma " + " ".join(_UNITS[int(d)] for d in frac if d.isdigit())
    return terbilang(int(token))


def normalise(text):
    text = text.lower()
    text = text.replace("%", " persen ").replace("rp", " rupiah ")
    text = re.sub(r"\d[\d.,]*\d|\d", _number_to_words, text)
    text = text.replace("-", " ")
    text = re.sub(r"[^a-z\s]", " ", text)
    return text.split()


def similarity(expected, heard):
    """Letter-level match of the normalised texts.

    Word-level matching punishes slang that ASR spells differently ("baper" -> "buffer") as much as
    a wrong word; letter level keeps those near-misses high (~0.9) while wrong or missing content
    drops well below (~0.7). Measured on Indonesian narration, see README.
    """
    a = " ".join(normalise(expected))
    b = " ".join(normalise(heard))
    return difflib.SequenceMatcher(a=a, b=b, autojunk=False).ratio()


def main(argv):
    if len(argv) != 1:
        print(__doc__)
        return 2
    lines = json.loads(open(argv[0], encoding="utf-8").read())
    threshold = float(os.environ.get("ASR_THRESHOLD", "0.82"))
    try:
        from faster_whisper import WhisperModel

        model = WhisperModel(os.environ.get("ASR_MODEL", "small"), device="cpu", compute_type="int8")
    except Exception as error:  # model download / import failure: the check did not run
        print(json.dumps({"ok": False, "error": f"could not load ASR model: {error}"}))
        return 2

    report = []
    for line in lines:
        segments, _ = model.transcribe(line["audio"], language="id", beam_size=5, vad_filter=False,
                                       word_timestamps=True)
        segments = list(segments)
        heard = " ".join(segment.text.strip() for segment in segments)
        # word timings (seconds from clip start) drive caption sync, see caption_timing.py
        words = [[word.word.strip(), round(word.start, 3), round(word.end, 3)]
                 for segment in segments for word in (segment.words or []) if word.word.strip()]
        expected = line.get("asr") or line["text"]  # optional override for names / slang
        score = similarity(expected, heard)
        report.append({"text": line["text"], "heard": heard, "score": round(score, 3), "ok": score >= threshold,
                       "words": words})

    ok = all(item["ok"] for item in report)
    print(json.dumps({"ok": ok, "threshold": threshold, "lines": report}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
