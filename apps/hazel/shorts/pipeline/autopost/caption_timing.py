"""Caption sync: give every caption word the time it is actually spoken.

The studio used to spread caption chunks over a clip by character count, so any pause or change in
speaking rate put the words out of step with the voice. asr_check.py already transcribes every clip
with faster-whisper; with word timestamps on, this module aligns the *script* words (what the caption
shows) to the *heard* words and writes

    scene["wordTimes"] = [[start, end], ...]   # seconds from clip start, one pair per caption word

which engine.js uses for chunk starts and the highlighted word. Alignment is token level after the same
normalisation as the ASR check (numbers -> Indonesian words, "%" -> "persen"), with fuzzy token matching
so ASR spellings of slang ("nyetok" -> "nyetuk") still anchor. Unmatched words are interpolated
between their matched neighbours.

    python caption_timing.py project.json asr_report.json   # offline: print the word times per scene
"""

import difflib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from asr_check import normalise  # noqa: E402

MATCH_MIN = 0.6      # letter similarity for two tokens to count as the same word
MIN_COVERAGE = 0.5   # share of caption words that must anchor, else keep the old estimate
GAP = -0.45          # alignment gap penalty (match score is similarity - MATCH_MIN)


def _token_similarity(a, b):
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(a=a, b=b, autojunk=False).ratio()


def _align(expected, heard):
    """Needleman-Wunsch over token lists; returns [(i, j)] pairs of matched tokens."""
    n, m = len(expected), len(heard)
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    move = [[0] * (m + 1) for _ in range(n + 1)]   # 1 diag, 2 up (skip expected), 3 left (skip heard)
    for i in range(1, n + 1):
        score[i][0] = i * GAP
        move[i][0] = 2
    for j in range(1, m + 1):
        score[0][j] = j * GAP
        move[0][j] = 3
    sims = {}
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sim = _token_similarity(expected[i - 1], heard[j - 1])
            sims[(i, j)] = sim
            best, step = score[i - 1][j - 1] + (sim - MATCH_MIN), 1
            if score[i - 1][j] + GAP > best:
                best, step = score[i - 1][j] + GAP, 2
            if score[i][j - 1] + GAP > best:
                best, step = score[i][j - 1] + GAP, 3
            score[i][j] = best
            move[i][j] = step
    pairs = []
    i, j = n, m
    while i > 0 and j > 0:
        step = move[i][j]
        if step == 1:
            if sims[(i, j)] >= MATCH_MIN:
                pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif step == 2:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def word_times(caption, asr_words, clip_duration=None):
    """caption: text shown on screen; asr_words: [[word, start, end], ...] from asr_check.py.

    Returns ([[start, end] per whitespace word of caption], coverage) or (None, coverage)."""
    words = caption.split()
    if not words or not asr_words:
        return None, 0.0
    expected, owner = [], []
    for index, word in enumerate(words):
        for token in normalise(word):
            expected.append(token)
            owner.append(index)
    heard, heard_time = [], []
    for word, start, end in asr_words:
        tokens = normalise(word) or [word.lower()]
        span = (end - start) / len(tokens)
        for k, token in enumerate(tokens):
            heard.append(token)
            heard_time.append((start + k * span, start + (k + 1) * span))
    times = [None] * len(words)
    for i, j in _align(expected, heard):
        start, end = heard_time[j]
        current = times[owner[i]]
        times[owner[i]] = (start, end) if current is None else (min(current[0], start), max(current[1], end))
    anchored = sum(1 for t in times if t)
    coverage = anchored / len(words)
    if coverage < MIN_COVERAGE:
        return None, round(coverage, 3)

    # interpolate unanchored words between neighbours (by character length)
    first_heard = asr_words[0][1]
    last_heard = clip_duration or asr_words[-1][2]
    index = 0
    while index < len(words):
        if times[index]:
            index += 1
            continue
        run_end = index
        while run_end < len(words) and not times[run_end]:
            run_end += 1
        left = times[index - 1][1] if index > 0 else first_heard
        right = times[run_end][0] if run_end < len(words) else last_heard
        right = max(right, left)
        lengths = [len(w) + 2 for w in words[index:run_end]]
        total = float(sum(lengths))
        cursor = left
        for k, length in zip(range(index, run_end), lengths):
            step = (right - left) * length / total
            times[k] = (cursor, cursor + step)
            cursor += step
        index = run_end

    # monotonic, no overlaps
    result = []
    previous_end = 0.0
    for start, end in times:
        start = max(start, previous_end)
        end = max(end, start + 0.05)
        result.append([round(start, 3), round(end, 3)])
        previous_end = start
    return result, round(coverage, 3)


def apply_word_times(project, voice_files, asr_report):
    """Write scene["wordTimes"] from an asr_check report; returns a small QC summary per scene."""
    lines = iter(asr_report.get("lines") or [])
    summary = []
    for index, (scene, name) in enumerate(zip(project["scenes"], voice_files)):
        if not name:
            continue
        line = next(lines, None)
        if not line or not line.get("words"):
            summary.append({"scene": index + 1, "synced": False, "reason": "no word timestamps"})
            continue
        caption = scene.get("caption") or scene.get("narration") or ""
        times, coverage = word_times(caption, line["words"])
        if times:
            scene["wordTimes"] = times
        summary.append({"scene": index + 1, "synced": bool(times), "coverage": coverage,
                        "words": caption.split(), "wordTimes": times})
    return summary


if __name__ == "__main__":
    project = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    report = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    files = [("x" if scene.get("narration") else None) for scene in project["scenes"]]
    print(json.dumps(apply_word_times(project, files, report), indent=1))
    for scene in project["scenes"]:
        if scene.get("wordTimes"):
            words = (scene.get("caption") or scene["narration"]).split()
            print(" ".join(f"{w}@{t[0]:.2f}" for w, t in zip(words, scene["wordTimes"])))
