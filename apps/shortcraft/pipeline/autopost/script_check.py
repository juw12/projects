#!/usr/bin/env python3
"""script_check.py - the /yt-script gate, run on a Shortcraft project before it is rendered.

Built on youtube-agent-skill's yt-script (MIT, vendored unchanged in vendor/yt_script/):
its hookscore.py scores the hook on five properties (specificity, address, stakes, curiosity,
brevity), with the verdict weighted 60% mean and 40% weakest. The upstream word lists are English,
so an Indonesian hook scores "WEAK / Unclassified" no matter how good it is. This module adds
Indonesian (and Jakarta slang) words to those lists and Indonesian patterns to all 21 hook formulas,
then runs the yt-script rules as gates, adapted for Shorts:

    hook        hook score >= 55 (WORKABLE); low means "look again", never a promise
    title       the first spoken sentence confirms the title (shares a content word)
    no_intro    no greeting, channel intro or subscribe pitch in the first two scenes
    on_screen   every beat has something on screen, not just narration
    payoff      a question in the hook gets an explicit answer beat before the close
    one_ask     the video asks for one thing (comment OR subscribe OR share ...), not three
    sourced     every scene that speaks a statistic carries a `source`
    runtime     estimate at 150 words per minute (the upstream rule); warn above 60 s
    placeholders  no TODO / {{...}} left from a template (blocks the render)
    layout      text limits per layout so nothing overlaps or gets clipped (blocks the render)
    package     yt-package title lint >= 70 (length, number, caps, cover text not repeating the title)

    python3 script_check.py project.json [--title "..."] [--json]
    python3 script_check.py --hook "satu baris hook"
    python3 script_check.py --hooks hooks.txt          # rank options, one per line
    python3 script_check.py --titles titles.txt --cover "BILANG ATAU DIEM?"   # yt-package title lint

Project keys: "scriptCheck": "gate" (default: fail on no_intro/on_screen/one_ask/sourced),
"strict" (also fail on hook and title), "warn" (never fail) or false (skip).
"hookOptions": ["...", ...] - alternative hooks; all are scored and the top two reported.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR = HERE / "vendor" / "yt_script"
WPM = 150
HOOK_PASS = 55
OBJECTIVE_GATES = ("no_intro", "on_screen", "one_ask", "sourced", "placeholders", "layout")
HEURISTIC_GATES = ("hook", "title")

# ----------------------------------------------------------------------------- Indonesian lexicon
YOU_ID = r"kamu|kau|engkau|anda|kalian|lo|lu|loe|elo|elu|dirimu"
STAKE_ID = (r"rugi|nyesel|menyesal|penyesalan|sia-sia|buang|kehilangan|hilang|gagal|bangkrut|boncos|"
            r"bahaya|risiko|resiko|mahal|telat|terlambat|sebelum|jangan|berhenti|ditolak|sakit|bayar|"
            r"habis|tekor|celaka|nggak pernah|gak pernah|ga pernah|tidak pernah")
CURIOSITY_ID = (r"kenapa|mengapa|gimana|bagaimana|apa|apakah|mana|mending|tapi|padahal|ternyata|justru|"
                r"sampai|kecuali|alasan|beneran|siapa|kok|bener nggak|atau")
CLOSED_ID = r"karena|soalnya|makanya|sehingga"
NUMBER_WORDS_ID = (r"(?:se|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan)\s?"
                   r"(?:puluh|ratus|ribu|juta|belas)|persen|separuh|setengah")
TIME_ID = r"\d+\s?(?:detik|menit|jam|hari|minggu|bulan|tahun)"
FILLER_ID = {"halo", "hai", "gaes", "teman", "temen", "selamat", "datang", "sih", "deh", "banget",
             "aja", "dong", "nih", "pokoknya"}
VAGUE_ID = {"luar", "biasa", "gila", "keren", "parah", "mantap", "terbaik", "rahasia", "dahsyat", "ajaib",
            "wow", "epic", "viral", "gokil"}

# Indonesian patterns per upstream formula id (appended to each formula's "match" list).
FORMULA_PATTERNS_ID = {
    "the-statistic": [r"\b\d+(\.\d+)?\s?%", r"\b\d+ dari \d+\b", r"\bpersen\b"],
    "someone-elses-result": [r"\b(channel|orang|creator|akun) ini\b", r"\bdari .* jadi\b",
                             r"\bdalam (\d+|satu|dua|tiga) (minggu|bulan|tahun)\b"],
    "the-mistake": [r"\bkamu (masih |pasti |mungkin )?(salah|keliru)\b", r"\bkesalahan\b",
                    r"\b(berhenti|stop) \w+"],
    "contrarian-flip": [r"\b(semua orang|kata orang|katanya)\b", r"\b(mitos|nggak bener|gak bener|keliru)\b"],
    "the-reveal": [r"\b(aku|gue|saya) (tunjukin|kasih lihat|bongkar)\b", r"\blihat ini\b"],
    "the-superlative": [r"\bpaling\b", r"\bter(baik|buruk|cepat|murah|mahal)\b"],
    "the-clock": [r"\bdalam \d+ (detik|menit|hari)\b", r"\b(\d+|satu|dua|tiga|lima|sepuluh) (detik|menit)\b"],
    "i-tried-it": [r"\b(aku|gue|saya) (coba|nyoba|mencoba)\b", r"\bselama \d+ (hari|minggu|bulan)\b"],
    "the-question": [r"^\W*(kenapa|gimana|bagaimana|apa|apakah|mending|berapa|siapa)\b", r"\?\s*$"],
    "the-before-after": [r"\bdulu\b.*\bsekarang\b", r"\bsebelum\b.*\b(sesudah|setelah)\b"],
    "the-teardown": [r"\b(bongkar|bedah|kupas)\b"],
    "the-stack": [r"\b\w+ (plus|\+|ditambah) \w+\b"],
    "the-warning": [r"\b(jangan|hati-hati|awas|bahaya)\b", r"\bsebelum kamu\b"],
    "the-list": [r"\b(\d+|tiga|lima|tujuh|sepuluh) (cara|hal|alasan|tanda|kebiasaan|tips)\b"],
    "the-receipt": [r"\b(ini|nih) (bukti|hasil|struk|nota)\w*\b"],
    "the-insider": [r"\b(orang dalam|jarang yang tahu|nggak dikasih tahu|ga dikasih tau)\b"],
    "the-impossible": [r"\b(kedengarannya|kayaknya) (mustahil|nggak mungkin|aneh)\b", r"\bnggak masuk akal\b"],
    "the-comparison": [r"\bmending\b", r"\b\w+ (atau|vs\.?|versus) \w+\b", r"\blebih (baik|untung|hemat|murah)\b"],
    "the-origin": [r"\b(asalnya|awalnya|ternyata dari)\b"],
    "the-deadline": [r"\b(mulai|per) (tanggal|bulan|tahun)\b", r"\b(tahun|bulan|minggu) depan\b"],
    "the-direct-address": [r"^\W*(kamu|buat kamu|kalau kamu|kalian|lo|lu)\b"],
}

INTRO = re.compile(
    r"\b(halo|hai|hi|hello)\s+(guys|gaes|semua|teman|temen|sobat)\b|\bselamat datang\b|\bwelcome\b|"
    r"\bdi channel\b|\bjangan lupa\b|\bsubscribe\b|\bsebelum (kita )?mulai\b|\bperkenalkan\b|"
    r"\bnama (aku|saya|gue)\b|\bbefore we (get )?start", re.I)
ASKS = {
    "comment": r"\b(komen|komentar|comment|kolom komentar)\b",
    "subscribe": r"\b(subscribe|subs|langganan|follow|ikuti)\b",
    "like": r"\b(like|kasih love|tap love)\b",
    "share": r"\b(share|bagikan|kirim ke|tag (teman|temen))\b",
    "save": r"\b(save|simpan video ini|simpan dulu)\b",
    "link": r"\b(cek link|klik link|link di|di deskripsi|di bio)\b",
    "watch": r"\b(tonton|nonton) (video|part|episode)\b",
}
PLACEHOLDER = re.compile(r"\bTODO\b|\{\{[^}]*\}\}")
FUTURE_TIME = r"(?!\s*(?:detik|menit|jam|hari|minggu|bulan|tahun)\s+(?:lagi|ke depan|kemudian))"
STATISTIC = re.compile(r"\d+\s?%|\b\d{2,}\b" + FUTURE_TIME + r"|(?:" + NUMBER_WORDS_ID + r")" + FUTURE_TIME, re.I)
STOPWORDS = {"mending", "yang", "atau", "kata", "riset", "aja", "dan", "ini", "itu", "kamu", "aku", "kita",
             "dari", "untuk", "buat", "dengan", "nggak", "gak", "tidak", "lebih", "sama", "bisa", "ternyata",
             "the", "and", "your", "with", "this", "that", "what", "which"}
VISUAL_KEYS = ("headline", "quote", "lines", "bars", "messages", "options", "rows", "value", "stamp", "result")


def widen(pattern, extra_words):
    """Upstream regex OR the Indonesian alternatives (findall counts stay one per hit)."""
    return re.compile(r"(?:" + pattern.pattern + r")|\b(?:" + extra_words + r")\b", re.I)


def load_hookscore():
    """Load the vendored upstream scorer and widen its word lists to Indonesian."""
    spec = importlib.util.spec_from_file_location("yt_hookscore", VENDOR / "hookscore.py")
    hookscore = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hookscore)
    hookscore.YOU = widen(hookscore.YOU, YOU_ID)
    hookscore.STAKE = widen(hookscore.STAKE, STAKE_ID)
    hookscore.CURIOSITY = widen(hookscore.CURIOSITY, CURIOSITY_ID)
    hookscore.CONCRETE = re.compile(
        hookscore.CONCRETE.pattern + r"|\b(" + NUMBER_WORDS_ID + r"|" + TIME_ID + r"|rp\s?\d[\d.]*)\b", re.I)
    hookscore.FILLER = set(hookscore.FILLER) | FILLER_ID
    hookscore.VAGUE = set(hookscore.VAGUE) | VAGUE_ID
    for formula in hookscore.FORMULAS:
        formula["match"] = list(formula["match"]) + FORMULA_PATTERNS_ID.get(formula["id"], [])
    upstream_curiosity = hookscore.curiosity

    def curiosity(text):
        # upstream subtracts 18 for an English self-answering hook; do the same for Indonesian
        penalty = 18 if re.search(r"\b(" + CLOSED_ID + r")\b", text, re.I) else 0
        return max(0, upstream_curiosity(text) - penalty)

    hookscore.curiosity = curiosity
    hookscore.PROPS = [(name, curiosity if name == "CURIOSITY" else fn) for name, fn in hookscore.PROPS]
    return hookscore


HOOKSCORE = load_hookscore()


def score_hook(text):
    parts, verdict, formula, matched = HOOKSCORE.score(text)
    weakest = min(parts, key=parts.get)
    return {
        "hook": text.strip(), "properties": parts, "verdict": verdict, "band": HOOKSCORE.band(verdict),
        "formula": formula, "matched": matched, "weakest": weakest, "fix": HOOKSCORE.FIX[weakest],
    }


# ----------------------------------------------------------------------------- title + cover (yt-package)
TITLE_STOP_ID = {"yang", "atau", "dan", "di", "ke", "dari", "ini", "itu", "aku", "kamu", "kita", "aja", "sih",
                 "kok", "gimana", "kenapa", "apa", "mending", "buat", "untuk", "jadi", "kata"}
TITLE_VAGUE_ID = {"gila", "parah", "keren", "terbaik", "rahasia", "dahsyat", "viral", "wajib", "banget"}


def load_title_linter():
    spec = importlib.util.spec_from_file_location("yt_title", HERE / "vendor" / "yt_package" / "title.py")
    title_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(title_module)
    title_module.STOP = set(title_module.STOP) | TITLE_STOP_ID
    title_module.VAGUE = set(title_module.VAGUE) | TITLE_VAGUE_ID
    return title_module


TITLE_LINTER = load_title_linter()


def score_title(title, cover_text=None):
    """yt-package's title.py: truncation, caps, vague words, a number, front-loading, cover duplication."""
    result = TITLE_LINTER.check(title, cover_text)
    result["issues"] = [{"issue": key, "detail": detail} for key, detail in result["issues"]]
    return result


def first_sentence(text):
    match = re.match(r"(.+?[?.!])(\s|$)", text.strip())
    return match.group(1) if match else text.strip()


def content_words(text):
    words = re.findall(r"[a-zà-ÿ0-9]+", text.lower())
    return {re.sub(r"nya$", "", w) for w in words if len(w) >= 4 and w not in STOPWORDS}


def scene_text(scene):
    parts = []
    for key in VISUAL_KEYS + ("sub", "badge", "cta"):
        value = scene.get(key)
        if isinstance(value, list):
            parts.extend(json.dumps(item, ensure_ascii=False) if isinstance(item, dict) else str(item) for item in value)
        elif value:
            parts.append(str(value))
    return " ".join(parts)


def gate(name, ok, detail):
    return {"gate": name, "ok": bool(ok), "detail": detail}


def check_project(project, title=None):
    scenes = project.get("scenes", [])
    narrations = [scene.get("narration", "") or "" for scene in scenes]
    full_script = " ".join(narrations)
    hook_text = narrations[0] if narrations else ""
    title = title or project.get("title", "")
    gates = []

    hook = score_hook(hook_text) if hook_text else None
    gates.append(gate("hook", hook and hook["verdict"] >= HOOK_PASS,
                      f"{hook['verdict']} {hook['band']} ({hook['formula']}); weakest {hook['weakest']}: {hook['fix']}"
                      if hook else "scene 1 has no narration"))

    shared = content_words(first_sentence(hook_text)) & content_words(title)
    gates.append(gate("title", shared, f"shares {sorted(shared)}" if shared
                      else f"first sentence does not echo the title {title!r}"))

    intro_hits = [m.group(0) for text in narrations[:2] for m in INTRO.finditer(text)]
    gates.append(gate("no_intro", not intro_hits, f"found {intro_hits}" if intro_hits else "straight into it"))

    blank = [i + 1 for i, scene in enumerate(scenes) if not any(scene.get(key) for key in VISUAL_KEYS)]
    gates.append(gate("on_screen", not blank, f"scenes with nothing on screen: {blank}" if blank else "every beat has a visual"))

    payoff_ok = True
    detail = "hook is not a question"
    if hook_text.strip().endswith("?") or "?" in first_sentence(hook_text):
        answer_beats = [i + 1 for i, scene in enumerate(scenes[1:-1], start=1)
                        if scene.get("stamp") or scene.get("result") or scene.get("layout") in ("stamp", "math", "bars")]
        payoff_ok = bool(answer_beats)
        detail = f"answered in scene(s) {answer_beats}" if answer_beats else "hook asks a question nothing answers"
    gates.append(gate("payoff", payoff_ok, detail))

    spoken_and_shown = full_script + " " + " ".join(scene_text(scene) for scene in scenes)
    asks = sorted(name for name, pattern in ASKS.items() if re.search(pattern, spoken_and_shown, re.I))
    gates.append(gate("one_ask", len(asks) <= 1, f"asks: {asks or 'none'}"))

    unsourced = [i + 1 for i, (scene, text) in enumerate(zip(scenes, narrations))
                 if STATISTIC.search(text) and not (scene.get("source") or project.get("sources"))]
    gates.append(gate("sourced", not unsourced, f"statistic without a source in scene(s) {unsourced}"
                      if unsourced else "every spoken statistic has a source"))

    # layout limits measured on the pop template (1080x1920): beyond these, text collides or is clipped
    layout_problems = []
    for i, scene in enumerate(scenes, start=1):
        layout = scene.get("layout")
        if layout == "hook" and scene.get("value") and len(scene.get("headline", "")) > 24:
            layout_problems.append(f"scene {i}: hook counter + headline over 24 chars overlaps the captions")
        if layout == "stamp" and len(scene.get("stamp", "")) > 10:
            layout_problems.append(f"scene {i}: stamp '{scene['stamp']}' over 10 chars gets clipped")
        if layout == "price" and len(scene.get("headline", "")) > 22:
            layout_problems.append(f"scene {i}: price headline over 22 chars wraps into the price")
        if layout == "price" and len(scene.get("stamp", "")) > 12:
            layout_problems.append(f"scene {i}: price sticker '{scene['stamp']}' over 12 chars")
    gates.append(gate("layout", not layout_problems, "; ".join(layout_problems) or "fits the template"))

    leftovers = [i + 1 for i, scene in enumerate(scenes)
                 if PLACEHOLDER.search(json.dumps(scene, ensure_ascii=False))]
    gates.append(gate("placeholders", not leftovers, f"TODO/{{{{...}}}} left in scene(s) {leftovers}"
                      if leftovers else "no template placeholders left"))

    if title:
        package = score_title(title, project.get("coverText"))
        gates.append(gate("package", package["score"] >= 70, f"title {package['score']}/100: "
                          + ("; ".join(i["issue"] + " - " + i["detail"] for i in package["issues"]) or "clean")))

    word_count = len(re.findall(r"\w+", full_script))
    seconds = round(word_count / WPM * 60, 1)
    gates.append(gate("runtime", seconds <= 60, f"{word_count} words = about {seconds} s at {WPM} wpm"))

    options = [score_hook(text) for text in project.get("hookOptions", []) if text.strip()]
    ranked = sorted(([hook] if hook else []) + options, key=lambda item: -item["verdict"])

    mode = project.get("scriptCheck", "gate")
    blocking = {"gate": OBJECTIVE_GATES, "strict": OBJECTIVE_GATES + HEURISTIC_GATES}.get(mode, ())
    failed = [g["gate"] for g in gates if not g["ok"]]
    return {
        "mode": mode,
        "ok": not any(name in blocking for name in failed),
        "failed": failed,
        "blocking": [name for name in failed if name in blocking],
        "gates": gates,
        "hook": hook,
        "top_hooks": ranked[:2],
        "hook_options": len(options),
    }


def print_panel(item):
    print(f"\n  {item['hook']}")
    print(f"  {'-' * min(72, max(20, len(item['hook'])))}")
    for name, value in item["properties"].items():
        print(f"    {name:<12} {value:3d}  {'#' * (value // 5)}")
    print(f"    {'VERDICT':<12} {item['verdict']:3d}  {item['band']}")
    print(f"    formula      {item['formula']}")
    print(f"    weakest      {item['weakest']} - {item['fix']}")


def print_report(report):
    for item in report["top_hooks"]:
        print_panel(item)
    print()
    for g in report["gates"]:
        mark = "PASS" if g["ok"] else ("FAIL" if g["gate"] in report["blocking"] else "WARN")
        print(f"  {mark:<4}  {g['gate']:<10} {g['detail']}")
    if report["hook_options"] < 4:
        print("\n  tip: put 4+ alternatives in \"hookOptions\" - yt-script writes five and keeps the top two.")
    print("\n  ship it, or change it?")


def find_title(project_path, project):
    folder = Path(project_path).parent
    for candidate in [folder / "post.json", *folder.glob(Path(project_path).stem.rsplit("_", 1)[0] + "*post.json")]:
        if candidate.exists():
            title = json.loads(candidate.read_text(encoding="utf-8")).get("title")
            if title:
                return title
    return project.get("title", "")


def main(argv):
    as_json = "--json" in argv
    argv = [a for a in argv if a != "--json"]
    if not argv:
        print(__doc__)
        return 1
    if argv[0] in ("--title", "--titles"):
        titles = [argv[1]] if argv[0] == "--title" else [
            line for line in Path(argv[1]).read_text(encoding="utf-8").splitlines() if line.strip()]
        cover = argv[argv.index("--cover") + 1] if "--cover" in argv else None
        ranked = sorted((score_title(t, cover) for t in titles), key=lambda r: -r["score"])
        if as_json:
            print(json.dumps(ranked, ensure_ascii=False, indent=1))
        else:
            for row in ranked:
                print(f"\n  {row['score']:3d}/100  {row['title']}  ({row['chars']} chars)")
                for issue in row["issues"]:
                    print(f"      x {issue['issue']:<12} {issue['detail']}")
        return 0
    if argv[0] in ("--hook", "--hooks"):
        lines = [argv[1]] if argv[0] == "--hook" else [
            line for line in Path(argv[1]).read_text(encoding="utf-8").splitlines() if line.strip()]
        ranked = sorted((score_hook(line) for line in lines), key=lambda item: -item["verdict"])
        if as_json:
            print(json.dumps(ranked, ensure_ascii=False, indent=1))
        else:
            for item in ranked:
                print_panel(item)
        return 0
    project_path = argv[0]
    project = json.loads(Path(project_path).read_text(encoding="utf-8"))
    title = argv[argv.index("--title") + 1] if "--title" in argv else find_title(project_path, project)
    report = check_project(project, title)
    if as_json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        print_report(report)
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
