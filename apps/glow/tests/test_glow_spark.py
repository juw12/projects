"""GlowSpark (1.30.0): static checks, stdlib only.

GlowSpark is the tiny language model Glow built and trained from scratch. These checks cover the page
(CSP, no inline script, local refs, translations), its place in the Glow family (menu, home, service
worker, sitemap, version), the shipped model files (checksum, size budget), and the honesty rule: the
static page carries no figures, every number is rendered from bench.json, and bench.json must show the
model beating both its own baseline and the strongest compressor on books it never read.
Run from the repo root:  python apps/glow/tests/test_glow_spark.py
"""
import hashlib
import json
import re
import sys
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
WEB = APP / "web"
SPARK = WEB / "spark"
REPO = APP.parent.parent
SIZE_BUDGET_BYTES = 8_000_000
MODEL_FILES = ("engine.js", "worker.js", "spark.json", "spark.bin")


def text_of(path):
    return path.read_text(encoding="utf-8")


def shipped_size(path):
    """Bytes as served: text files are committed with LF endings, whatever the checkout uses."""
    data = path.read_bytes()
    if path.suffix != ".bin":
        data = data.replace(b"\r\n", b"\n")
    return len(data)


def container(html, element_id):
    """Inner HTML of the element with this id (the page nests no same-tag element inside these)."""
    match = re.search(rf'<(\w+)[^>]*\bid="{element_id}"[^>]*>(.*?)</\1>', html, re.S)
    assert match, element_id
    return match.group(2)


class GlowSparkTests(unittest.TestCase):
    def setUp(self):
        self.html = text_of(SPARK / "index.html")
        self.js = text_of(SPARK / "spark.js")
        self.locale = text_of(WEB / "shared" / "glow-locale.js")

    def test_page_follows_glow_rules(self):
        self.assertIn("Content-Security-Policy", self.html)
        self.assertIn("connect-src 'self'", self.html, "the model and its files are same-origin only")
        self.assertIn("script-src 'self'", self.html)
        self.assertNotIn("unsafe-eval", self.html)
        self.assertFalse(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>\s*\S", self.html), "no inline scripts (CSP)")
        refs = re.findall(r'(?:src|href)="([^"]+)"', self.html)
        local = [r for r in refs if not re.match(r"^(https?:|mailto:|#|data:)", r)]
        missing = [r for r in local if not (SPARK / r.split("#")[0].split("?")[0]).exists()]
        self.assertEqual(missing, [])
        for script in ("../shared/glow-locale.js", "../shared/glow-apps.js", "./spark.js"):
            self.assertIn(f'src="{script}"', self.html)
        used_ids = set(re.findall(r'\$\("([\w-]+)"\)', self.js))
        html_ids = set(re.findall(r'id="([\w-]+)"', self.html))
        made_by_script = {"retry-btn"}
        self.assertEqual(sorted(used_ids - html_ids - made_by_script), [], "every element spark.js uses exists")

    def test_engine_is_self_contained(self):
        for name in ("engine.js", "worker.js", "spark.js"):
            source = text_of(SPARK / name)
            self.assertFalse(re.findall(r"https?://(?!juw12\.github\.io|www\.gutenberg\.org)[\w.-]+", source), f"{name} calls no outside service")
            self.assertNotIn("eval(", source)
            self.assertFalse(re.search(r"WebAssembly\.[A-Za-z]", source), f"{name} is plain JavaScript")
            self.assertNotIn("navigator.gpu", source)
        worker = text_of(SPARK / "worker.js")
        self.assertIn("engine.js", worker)
        self.assertIn("spark.json", worker)
        self.assertIn("parity.json", worker, "the self-test compares against the PyTorch reference")

    def test_translated_in_four_languages(self):
        keys = set(re.findall(r'data-i18n(?:-placeholder)?="([\w.]+)"', self.html))
        keys |= set(re.findall(r'"(spark\.[\w.]+)"', self.js))
        keys |= {"apps.spark", "home.tile.spark", "home.pill.spark"}
        self.assertGreater(len(keys), 60)
        for key in sorted(keys):
            if key.endswith("."):  # a prefix the page completes with an index, e.g. spark.starter.0
                key += "0"
            self.assertEqual(self.locale.count(f'"{key}": '), 4, f"{key} in en, id, zh-CN, zh-TW")

    def test_in_glow_apps_menu_and_home(self):
        apps = text_of(WEB / "shared" / "glow-apps.js")
        self.assertIn('{ id: "spark", name: "GlowSpark"', apps)
        self.assertIn('if (/\\/spark\\//.test(path)) return "spark";', apps)
        self.assertIn('if (/^spark\\//.test(rest)) return "spark";', apps)
        home = text_of(WEB / "index.html")
        self.assertIn('<a class="app-tile spark" id="open-spark" href="./spark/">', home)
        self.assertIn("<b>GlowSpark</b>", home)
        self.assertIn('id="start-spark"', home, "'Tiny AI' choice under the start box")
        home_js = text_of(WEB / "home.js")
        self.assertIn('target === "spark"', home_js)
        self.assertIn('["chat", "room", "lead", "news", "spark"]', home_js)
        self.assertIn(".app-tile.spark", text_of(WEB / "home.css"))
        self.assertIn('query.get("q")', self.js, "home hands the opening line over as ?q=")

    def test_offline_and_versions(self):
        sw = text_of(WEB / "sw.js")
        for asset in ("./spark/", "./spark/spark.css", "./spark/spark.js", "./spark/engine.js", "./spark/worker.js",
                      "./spark/spark.json", "./spark/bench.json", "./spark/books.json", "./spark/parity.json"):
            self.assertIn(f"'{asset}'", sw)
            self.assertTrue((WEB / asset[2:] / "index.html").exists() if asset.endswith("/") else (WEB / asset[2:]).exists(), asset)
        self.assertNotIn("spark.bin'", sw, "weights are cached on first use, not at install of the home worker")
        self.assertNotIn("glowhome-v17", sw, "cache name bumped with the new assets")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f'const GLOW_VERSION = "{published}";', text_of(WEB / "shared" / "glow-apps.js"))
        self.assertIn("https://juw12.github.io/projects/glow/spark/", text_of(WEB / "sitemap.xml"))
        self.assertIn("apps/glow/tests/test_glow_spark.py", text_of(REPO / ".github" / "workflows" / "glow.yml"))

    def test_shipped_model_matches_its_manifest(self):
        meta = json.loads(text_of(SPARK / "spark.json"))
        weights = (SPARK / meta["weights"]["file"]).read_bytes()
        self.assertEqual(len(weights), meta["weights"]["bytes"])
        self.assertEqual(hashlib.sha256(weights).hexdigest(), meta["weights"]["sha256"])
        counted = sum(t["rows"] * max(t["cols"], 1) for t in meta["tensors"])
        self.assertEqual(counted, meta["parameters"], "the tensor table accounts for every parameter")
        self.assertEqual(len(meta["tokenizer"]["merges"]), 2 * (meta["tokenizer"]["vocab_size"] - 256 - 1), "256 bytes + merges + end-of-text")
        parity = json.loads(text_of(SPARK / "parity.json"))
        self.assertEqual(parity["weights_sha256"], meta["weights"]["sha256"], "reference outputs are for these weights")
        self.assertEqual(len(parity["cases"]), 5)
        self.assertLessEqual(parity["tolerance"], 0.01)
        total = sum(shipped_size(SPARK / name) for name in MODEL_FILES)
        self.assertLessEqual(total, SIZE_BUDGET_BYTES, "model + tokenizer + engine stay under 8 MB")

    def test_benchmark_file_backs_every_figure(self):
        bench = json.loads(text_of(SPARK / "bench.json"))
        meta = json.loads(text_of(SPARK / "spark.json"))
        self.assertEqual(bench["parameters"], meta["parameters"])
        files = bench["download"]["files"]
        self.assertEqual(sorted(files), sorted(MODEL_FILES))
        for name in MODEL_FILES:
            self.assertEqual(files[name], shipped_size(SPARK / name), f"{name} size in bench.json is the real size")
        self.assertEqual(bench["download"]["total_bytes"], sum(files.values()))
        bits = bench["bits_per_byte"]
        ours = bits["spark_shipped_int8"]
        self.assertLess(ours, bits["spark_v0_baseline"], "beats its own first baseline")
        self.assertLess(ours, bits["xz_9e_primed_with_training_corpus"], "beats xz even when xz has seen the training books")
        for name in ("gzip_9", "bzip2_9", "xz_9e"):
            self.assertLess(ours, bits[name])
        self.assertLess(abs(ours - bits["spark_float32"]), 0.05, "int8 weights cost almost nothing")
        self.assertGreater(bench["held_out"]["books"], 0)
        self.assertGreater(bench["held_out"]["perplexity_per_token"], 1)
        self.assertGreater(bench["training"]["minutes"], 0)
        self.assertGreater(bench["baseline_training_minutes"], 0)
        browser = bench["browser"]
        for field in ("hardware", "cold_start_ms", "words_per_second", "tokens_per_second"):
            self.assertTrue(browser[field], field)
        self.assertRegex(bench["built"], r"^\d{4}-\d{2}-\d{2}$")

    def test_books_are_listed_and_some_are_held_out(self):
        books = json.loads(text_of(SPARK / "books.json"))
        bench = json.loads(text_of(SPARK / "bench.json"))
        held = [book for book in books if book["split"] == "val"]
        self.assertEqual(len(held), bench["held_out"]["books"])
        self.assertEqual(len(books) - len(held), bench["train"]["books"])
        self.assertEqual(len({book["id"] for book in books}), len(books), "no book twice, so none is in both sets")
        for book in books:
            self.assertTrue(str(book["id"]).isdigit() and book["title"])

    def test_static_page_claims_no_figures(self):
        for element_id in ("stats", "bars", "bars-lede", "bench-note", "spark-meta", "versus-download", "refs-date"):
            self.assertFalse(re.search(r"\d", container(self.html, element_id)), f"#{element_id} is filled from bench.json")
        table = re.search(r'<table class="versus">(.*?)</table>', self.html, re.S).group(1)
        self.assertFalse(re.search(r"\d", re.sub(r"<[^>]+>", " ", table)), "no numbers are claimed for other systems")
        self.assertIn("spark.limit1", self.html, "the page says what it cannot do")
        self.assertIn('"./bench.json"', self.js.replace("'", '"'))

    def test_docs_and_portfolio_card(self):
        readme = text_of(APP / "README.md")
        published = json.loads(text_of(WEB / "version.json"))["version"]
        self.assertIn(f"- **{published}** – ", readme)
        self.assertIn("https://juw12.github.io/projects/glow/spark/", readme)
        card = next(app for app in json.loads(text_of(REPO / "scripts" / "apps.json"))["apps"] if app["id"] == "glow")
        self.assertIn("GlowSpark", card["tags"])
        self.assertIn({"label": "GlowSpark", "path": "glow/spark/"}, card["card_links"])


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
