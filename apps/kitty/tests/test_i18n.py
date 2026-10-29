"""Kitty language packs: the source table is valid and the generated files are current."""
import importlib.util
import re
import unittest
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1]
WEB = APP_DIR / "web"
spec = importlib.util.spec_from_file_location("build_i18n", APP_DIR / "i18n" / "build_i18n.py")
build_i18n = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build_i18n)


class LanguagePackTests(unittest.TestCase):
    def test_source_table_has_no_problems(self):
        rows, problems = build_i18n.load()
        self.assertEqual(problems, [])
        self.assertGreater(len(rows), 500)

    def test_generated_packs_are_up_to_date(self):
        rows, _ = build_i18n.load()
        for code, expected in build_i18n.render(rows).items():
            path = WEB / "js" / "lang" / (code + ".js")
            self.assertTrue(path.is_file(), path)
            self.assertEqual(
                path.read_text(encoding="utf-8"),
                expected,
                "%s is stale; run apps/kitty/i18n/build_i18n.py" % path.name,
            )

    def test_every_language_is_registered_in_the_runtime(self):
        runtime = (WEB / "js" / "i18n.js").read_text(encoding="utf-8")
        for code in ["en"] + build_i18n.LANGS:
            self.assertRegex(runtime, r"code:\s*'%s'" % code)

    def test_index_loads_language_packs_after_runtime(self):
        text = (WEB / "index.html").read_text(encoding="utf-8")
        order = re.findall(r"js/((?:lang/)?[\w-]+)\.js", text)
        runtime = order.index("i18n")
        self.assertLess(order.index("core"), runtime)
        for code in build_i18n.LANGS:
            self.assertLess(runtime, order.index("lang/" + code))
            self.assertLess(order.index("lang/" + code), order.index("app"))

    def test_service_worker_caches_language_files(self):
        sw = (WEB / "sw.js").read_text(encoding="utf-8")
        self.assertIn("js/i18n.js", sw)
        for code in build_i18n.LANGS:
            self.assertIn("js/lang/%s.js" % code, sw)


if __name__ == "__main__":
    unittest.main()
