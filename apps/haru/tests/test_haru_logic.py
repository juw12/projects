"""Haru: screenshot sorter parity, shared lexicon and offline (PWA) shell integrity.

The sorter exists three times (prototypes/tidy/tidy.py, ios ClipClassifier.swift,
web/app/js/classifier.js) and all three must agree with prototypes/tidy/expected.json.
The Swift side is covered by HaruTests; this file covers Python, the web port (via Node,
skipped when Node is missing) and the files the service worker and manifest promise.
"""

import datetime as dt
import importlib.util
import json
import re
import shutil
import struct
import subprocess
import unittest
from pathlib import Path

HARU = Path(__file__).resolve().parents[1]
WEB_APP = HARU / "web" / "app"
GOLDEN = json.loads((HARU / "prototypes" / "tidy" / "expected.json").read_text(encoding="utf-8"))


def load_tidy():
    spec = importlib.util.spec_from_file_location("haru_tidy", HARU / "prototypes" / "tidy" / "tidy.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def png_size(path):
    header = path.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise AssertionError(f"{path.name} is not a PNG")
    return struct.unpack(">II", header[16:24])


class TidyGoldenTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tidy = load_tidy()
        cls.today = dt.date.fromisoformat(GOLDEN["today"])

    def test_golden_file_is_not_trivial(self):
        drawers = {case["drawer"] for case in GOLDEN["cases"]}
        self.assertGreaterEqual(len(GOLDEN["cases"]), 10)
        self.assertGreaterEqual(len(drawers), 4)
        self.assertTrue(any(case["expiry"] for case in GOLDEN["cases"]))

    def test_python_classifier_matches_golden(self):
        for case in GOLDEN["cases"]:
            with self.subTest(text=case["text"][:30]):
                drawer, score = self.tidy.classify(case["text"])
                self.assertEqual(drawer, case["drawer"])
                self.assertAlmostEqual(score, case["score"])

    def test_python_expiry_matches_golden(self):
        for case in GOLDEN["cases"]:
            with self.subTest(text=case["text"][:30]):
                expiry = self.tidy.find_expiry(case["text"], self.today)
                self.assertEqual(expiry.isoformat() if expiry else None, case["expiry"])

    def test_expiry_rolls_month_day_dates_into_next_year(self):
        self.assertEqual(self.tidy.find_expiry("valid until 1月5日", dt.date(2026, 11, 2)), dt.date(2027, 1, 5))
        self.assertIsNone(self.tidy.find_expiry("printed 2025.03.01", dt.date(2026, 11, 2)))


class SharedLexiconTests(unittest.TestCase):
    def test_web_lexicon_is_a_copy_of_the_ios_lexicon(self):
        ios = json.loads((HARU / "ios" / "Resources" / "clip_lexicon.json").read_text(encoding="utf-8"))
        web = json.loads((WEB_APP / "clip_lexicon.json").read_text(encoding="utf-8"))
        self.assertEqual(web, ios, "run tools/sync_web.py: web and iOS sorters would disagree")

    def test_every_pattern_compiles(self):
        lexicon = json.loads((WEB_APP / "clip_lexicon.json").read_text(encoding="utf-8"))
        for name, drawer in lexicon["drawers"].items():
            for pattern in drawer["patterns"]:
                with self.subTest(drawer=name, pattern=pattern):
                    re.compile(pattern)


@unittest.skipUnless(shutil.which("node"), "node not installed")
class WebClassifierParityTests(unittest.TestCase):
    def test_web_classifier_matches_golden(self):
        result = subprocess.run(
            ["node", str(Path(__file__).with_name("classifier_parity.mjs"))],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["cases"], len(GOLDEN["cases"]))


class OfflineShellTests(unittest.TestCase):
    def test_every_precached_file_exists(self):
        service_worker = (WEB_APP / "sw.js").read_text(encoding="utf-8")
        shell = re.search(r"const SHELL = \[(.*?)\];", service_worker, re.S).group(1)
        entries = re.findall(r'"([^"]+)"', shell)
        self.assertIn("index.html", entries)
        for entry in entries:
            if entry == "./":
                continue
            with self.subTest(entry=entry):
                self.assertTrue((WEB_APP / entry).is_file(), f"sw.js precaches missing {entry}")

    def test_manifest_icons_exist_with_declared_sizes(self):
        manifest = json.loads((WEB_APP / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertTrue(any(icon.get("purpose") == "maskable" for icon in manifest["icons"]))
        for icon in manifest["icons"]:
            with self.subTest(icon=icon["src"]):
                width, height = png_size(WEB_APP / icon["src"])
                self.assertEqual(f"{width}x{height}", icon["sizes"])

    def test_start_url_points_at_a_shipped_page(self):
        manifest = json.loads((WEB_APP / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertTrue((WEB_APP / manifest["start_url"].split("#")[0].lstrip("./")).is_file())


if __name__ == "__main__":
    unittest.main()
