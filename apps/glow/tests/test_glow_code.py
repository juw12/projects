"""GlowCode: static checks with the standard library only.

GlowCode is a page that runs Kilat, a small language whose units and types are checked before a program
runs, inside a WebAssembly sandbox on the reader's device. These checks cover the page (CSP, no inline
script, local refs, script order), its place in the Glow family (menu entry, path rules, the four menu
translations, sitemap), and the vendored engine (the two files have to be the exact released bytes).
The page is not on the home page and not in the service worker cache; this test does not claim either.
No test here calls a model provider or starts a browser.
Run from the repo root:  python -X utf8 apps/glow/tests/test_glow_code.py
"""
import hashlib
import re
import sys
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
APP = TESTS.parent
WEB = APP / "web"
CODE = WEB / "code"
SHARED = WEB / "shared"
PAGE = CODE / "index.html"
PAGE_URL = "https://juw12.github.io/projects/glow/code/"
ENGINE_SHA256 = {
    "kilat.js": "c86186c57b86d0d4117eb322a4918b29a8e7123c99c1ebf67be02887654b07b5",
    "kilat.wasm": "441baf76ca2d793297d50eb8036e6dcd951cd7c48c580bec4b8dbcaebd233e97",
}
PAGE_SCRIPTS = [
    "../shared/glow-locale.js",
    "../shared/glow-apps.js",
    "../shared/glow-harness-kit.js",
    "./code.js",
]
LOCALES = ("en", "id", "zh-CN", "zh-TW")
REQUIRED_IDS = (
    "brain-seg",
    "task-box",
    "code-box",
    "run-btn",
    "check-btn",
    "stop-btn",
    "result",
    "model-log",
    "result-output",
    "result-error",
)


def text_of(path):
    return path.read_text(encoding="utf-8")


def csp_of(html):
    match = re.search(
        r'<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"',
        html,
    )
    return match.group(1) if match else ""


def directive(csp, name):
    for part in csp.split(";"):
        words = part.split()
        if words and words[0] == name:
            return words[1:]
    return []


class GlowCodePage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = text_of(PAGE)
        cls.csp = csp_of(cls.html)

    def test_csp_allows_wasm_and_nothing_wider(self):
        self.assertTrue(self.csp, "the page carries a Content-Security-Policy meta tag")
        script_sources = directive(self.csp, "script-src")
        self.assertEqual(sorted(script_sources), sorted(["'self'", "'wasm-unsafe-eval'"]))
        self.assertEqual(directive(self.csp, "default-src"), ["'self'"])
        self.assertEqual(directive(self.csp, "worker-src"), ["'self'"])
        self.assertIn("'self'", directive(self.csp, "connect-src"), "the engine is fetched from the page origin")

    def test_no_inline_script_or_handler(self):
        for tag in re.findall(r"<script\b[^>]*>", self.html):
            self.assertIn("src=", tag, f"inline script: {tag}")
        self.assertEqual(re.findall(r"<script\b[^>]*>\s*[^<\s]", self.html), [])
        self.assertEqual(re.findall(r"\son[a-z]+\s*=", self.html), [], "no inline event handlers")

    def test_scripts_in_order(self):
        sources = re.findall(r'<script\b[^>]*\bsrc="([^"]+)"', self.html)
        self.assertEqual(sources, PAGE_SCRIPTS)
        self.assertRegex(self.html, r'<script\s+type="module"\s+src="\./code\.js"')

    def test_local_refs_exist(self):
        refs = re.findall(r'\b(?:href|src)="([^"]+)"', self.html)
        self.assertTrue(refs)
        for ref in refs:
            if re.match(r"^(?:[a-z]+:|//|#)", ref):
                continue
            target = (CODE / ref.split("#")[0].split("?")[0]).resolve()
            if target.is_dir():
                target = target / "index.html"
            self.assertTrue(target.is_file(), f"{ref} -> {target}")

    def test_page_has_the_controls(self):
        for element_id in REQUIRED_IDS:
            self.assertIn(f'id="{element_id}"', self.html, element_id)
        self.assertIn('data-brain="rules"', self.html)
        self.assertIn('data-brain="free"', self.html)

    def test_page_states_its_limits(self):
        lowered = re.sub(r"\s+", " ", self.html.lower())
        self.assertIn("what it can and cannot do", lowered)
        self.assertIn("not a replacement for python", lowered)
        self.assertIn("has not been measured", lowered)


class GlowCodeScript(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = text_of(CODE / "code.js")

    def test_text_goes_in_as_text(self):
        for risky in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write"):
            self.assertNotIn(risky, self.source, risky)
        self.assertNotRegex(self.source, r"\beval\s*\(")
        self.assertNotRegex(self.source, r"new\s+Function\s*\(")

    def test_every_run_has_limits(self):
        self.assertRegex(self.source, r"fuel\s*:")
        self.assertRegex(self.source, r"memoryMb\s*:")

    def test_engine_is_loaded_from_this_folder(self):
        self.assertRegex(self.source, r'from\s+"\./kilat\.js"')
        self.assertNotRegex(self.source, r'from\s+"https?:')


class VendoredEngine(unittest.TestCase):
    def test_engine_files_are_the_released_bytes(self):
        for name, expected in ENGINE_SHA256.items():
            digest = hashlib.sha256((CODE / name).read_bytes()).hexdigest()
            self.assertEqual(digest, expected, name)

    def test_wasm_header(self):
        self.assertEqual((CODE / "kilat.wasm").read_bytes()[:4], b"\x00asm")


class GlowFamily(unittest.TestCase):
    def test_menu_entry_and_path_rules(self):
        apps = text_of(SHARED / "glow-apps.js")
        self.assertEqual(len(re.findall(r'\{\s*id:\s*"code"[^}]*page:\s*"code/"\s*\}', apps)), 1)
        self.assertIn('if (/\\/code\\//.test(path)) return "code";', apps)
        self.assertIn('if (/^code\\//.test(rest)) return "code";', apps)

    def test_menu_line_is_translated_four_times(self):
        locale = text_of(SHARED / "glow-locale.js")
        lines = re.findall(r'^\s*"apps\.code":\s*"([^"]+)",\s*$', locale, flags=re.M)
        self.assertEqual(len(lines), len(LOCALES))
        self.assertEqual(len(set(lines)), len(LOCALES), "each language has its own wording")
        for line in lines:
            self.assertIn("Kilat", line)

    def test_sitemap_lists_the_page(self):
        sitemap = text_of(WEB / "sitemap.xml")
        self.assertEqual(sitemap.count(f"<loc>{PAGE_URL}</loc>"), 1)


if __name__ == "__main__":
    result = unittest.main(exit=False, verbosity=2).result
    sys.exit(0 if result.wasSuccessful() else 1)
