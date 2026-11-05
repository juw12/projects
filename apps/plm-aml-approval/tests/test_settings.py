"""tests/test_settings.py -- stdlib-only tests for plm_aml_final_approval.py's pure logic.

No browser and no PLM: only the settings/comment builder, quantity labels, config loading
and the proxy guard are exercised. Exits 0 on success.

Run:  python apps/plm-aml-approval/tests/test_settings.py
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

APP_DIR = Path(__file__).resolve().parent.parent
# Playwright drives the real browser; the logic under test never touches it.
if "playwright" not in sys.modules:
    playwright = types.ModuleType("playwright")
    playwright.sync_api = types.ModuleType("playwright.sync_api")
    playwright.sync_api.sync_playwright = None
    sys.modules["playwright"] = playwright
    sys.modules["playwright.sync_api"] = playwright.sync_api
spec = importlib.util.spec_from_file_location("plm_aml", APP_DIR / "plm_aml_final_approval.py")
plm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plm)


class QuantityLabelTests(unittest.TestCase):
    def test_round_thousands_use_k(self):
        self.assertEqual(plm.quantity_label(50000), "50K")
        self.assertEqual(plm.quantity_label("3000"), "3K")
        self.assertEqual(plm.quantity_label(1000), "1K")

    def test_other_quantities_stay_numeric(self):
        self.assertEqual(plm.quantity_label(999), "999")
        self.assertEqual(plm.quantity_label(1500), "1500")
        self.assertEqual(plm.quantity_label(0), "0")


class BuildSettingsTests(unittest.TestCase):
    def test_every_mode_and_approval_combination_builds(self):
        for mode in plm.MODES:
            for approval in plm.APPROVAL_TYPES:
                with self.subTest(mode=mode, approval=approval):
                    settings = plm.build_settings(mode, approval, limit_qty=20000)
                    self.assertEqual(settings["approval"], approval)
                    self.assertTrue(settings["label"].endswith(" Submission"))
                    lines = settings["comment_lines"]
                    self.assertEqual(lines[1], "2. RD send sample to IQC")
                    self.assertEqual(lines[2:], plm.MODES[mode]["extra_comment_lines"])

    def test_final_vs_conditional_first_comment_line(self):
        mode = next(iter(plm.MODES))
        if "final" in plm.APPROVAL_TYPES:
            self.assertEqual(plm.build_settings(mode, "final")["comment_lines"][0], "1. Final Approval")
        if "conditional" in plm.APPROVAL_TYPES:
            settings = plm.build_settings(mode, "conditional", limit_qty="50000")
            self.assertEqual(settings["comment_lines"][0], "1. Conditional Approval 50K")
            self.assertEqual(settings["limit_qty"], "50000")

    def test_build_settings_does_not_mutate_the_tables(self):
        before = json.dumps([plm.MODES, plm.APPROVAL_TYPES], sort_keys=True, default=str)
        for mode in plm.MODES:
            for approval in plm.APPROVAL_TYPES:
                plm.build_settings(mode, approval, limit_qty=7000)
        after = json.dumps([plm.MODES, plm.APPROVAL_TYPES], sort_keys=True, default=str)
        self.assertEqual(before, after)


class ConfigTests(unittest.TestCase):
    def test_example_config_lists_every_site_key(self):
        example = json.loads((APP_DIR / "plm_config.example.json").read_text(encoding="utf-8"))
        self.assertEqual(set(example), set(plm.SITE_KEYS))

    def test_missing_config_gives_blank_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(plm, "CONFIG_PATH", Path(tmp) / "plm_config.json"):
                self.assertEqual(plm.load_site_config(), {key: "" for key in plm.SITE_KEYS})

    def test_existing_config_is_loaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "plm_config.json"
            path.write_text(json.dumps({"default_reviewer": "abc"}), encoding="utf-8")
            with mock.patch.object(plm, "CONFIG_PATH", path):
                self.assertEqual(plm.load_site_config()["default_reviewer"], "abc")

    def test_real_config_is_git_ignored(self):
        ignore = APP_DIR / ".gitignore"
        repo_ignore = APP_DIR.parent.parent / ".gitignore"
        text = "".join(p.read_text(encoding="utf-8") for p in (ignore, repo_ignore) if p.exists())
        self.assertIn("plm_config.json", text)


class HelperTests(unittest.TestCase):
    def test_clean_path_strips_quotes_and_space(self):
        self.assertEqual(plm.clean_path('  "C:\\docs\\a b.pdf"  '), "C:\\docs\\a b.pdf")
        self.assertEqual(plm.clean_path("'x.pdf'"), "x.pdf")

    def test_disable_local_proxy_only_touches_proxy_variables(self):
        env = {"HTTP_PROXY": "http://p:3128", "https_proxy": "http://p:3128", "KEEP": "1"}
        with mock.patch.dict(os.environ, env, clear=False):
            plm.disable_local_proxy()
            self.assertNotIn("HTTP_PROXY", os.environ)
            self.assertNotIn("https_proxy", os.environ)
            self.assertEqual(os.environ["KEEP"], "1")
            self.assertIn("127.0.0.1", os.environ["NO_PROXY"])

    def test_ask_yes_no_defaults(self):
        with mock.patch("builtins.input", return_value=""):
            self.assertFalse(plm.ask_yes_no("Go?"))
            self.assertTrue(plm.ask_yes_no("Go?", default_no=False))
        with mock.patch("builtins.input", return_value=" YES "):
            self.assertTrue(plm.ask_yes_no("Go?"))


if __name__ == "__main__":
    unittest.main(verbosity=1)
