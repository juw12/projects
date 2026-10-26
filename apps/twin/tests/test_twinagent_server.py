#!/usr/bin/env python3
"""TwinAgent evidence endpoint: each source fails independently, nothing touches the network."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

APP = Path(__file__).resolve().parent.parent


class TwinAgentEvidence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        os.environ["TWIN_DATA"] = cls.directory.name
        spec = importlib.util.spec_from_file_location("twinagent_server", APP / "server.py")
        cls.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.server)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def fake_chart(self, symbol, span="1D"):
        self.assertEqual(span, "1Y")
        return {"points": [[1, 100.0], [2, 101.0]], "currency": "USD", "name": f"{symbol} Inc", "timezone": "America/New_York"}

    def fake_tool(self, uid, mode, args, timeout=180):
        script = Path(str(args[0])).name
        if script == "news.py":
            self.assertIn("--no-sec", args)
            return {"ok": True, "data": {"items": [{"title": "AAPL beats", "time": "2026-10-20T00:00:00Z"}]}, "stderr": ""}
        if script == "facts.py":
            self.assertIn("--user-agent", args)
            return {"ok": True, "data": [{"result": {"entity": "Apple", "rows": [{"end": "2026-06-27", "filed": "2026-07-31"}]}}], "stderr": ""}
        raise AssertionError(script)

    def gather(self, profile, symbol="AAPL", tool=None, monthly=None):
        s = self.server
        with patch.object(s, "chart", side_effect=self.fake_chart), \
                patch.object(s, "monthly_returns", side_effect=monthly or (lambda sym: {"2026-08": 0.01})), \
                patch.object(s, "run_tool", side_effect=tool or self.fake_tool), \
                patch.object(s, "http_json", side_effect=AssertionError("network forbidden")):
            return s.twinagent_evidence("uid", profile, symbol)

    def test_complete_bundle(self):
        bundle = self.gather({"name": "Tess", "email": "tess@example.com"})
        self.assertEqual(bundle["symbol"], "AAPL")
        self.assertEqual(bundle["mode"], "live")
        self.assertEqual(bundle["name"], "AAPL Inc")
        for key in ("daily", "benchmark", "monthly", "benchmarkMonthly", "news", "fundamentals", "holdings"):
            self.assertIsNotNone(bundle[key], key)
        self.assertEqual(bundle["fundamentals"]["rows"][0]["filed"], "2026-07-31")
        self.assertEqual(bundle["errors"], {})
        self.assertIsInstance(bundle["asOf"], float)

    def test_missing_email_only_disables_fundamentals(self):
        bundle = self.gather({"name": "Tess", "email": ""})
        self.assertIsNone(bundle["fundamentals"])
        self.assertIn("email", bundle["errors"]["fundamentals"])
        self.assertIsNotNone(bundle["daily"])
        self.assertIsNotNone(bundle["news"])

    def test_failing_news_is_reported_not_fatal(self):
        def broken_news(uid, mode, args, timeout=180):
            if Path(str(args[0])).name == "news.py":
                return {"ok": False, "data": None, "stderr": "feed down"}
            return self.fake_tool(uid, mode, args, timeout)
        bundle = self.gather({"name": "Tess", "email": "tess@example.com"}, tool=broken_news)
        self.assertIsNone(bundle["news"])
        self.assertIn("feed down", bundle["errors"]["news"])
        self.assertIsNotNone(bundle["fundamentals"])

    def test_non_us_listing_skips_sec(self):
        bundle = self.gather({"name": "Tess", "email": "tess@example.com"}, symbol="7203.T")
        self.assertIn("US-listed", bundle["errors"]["fundamentals"])

    def test_spy_has_no_self_benchmark(self):
        bundle = self.gather({"name": "Tess", "email": "tess@example.com"}, symbol="SPY")
        self.assertIsNone(bundle["benchmark"])

    def test_invalid_symbol_rejected(self):
        with self.assertRaises(self.server.AppError):
            self.gather({"email": "tess@example.com"}, symbol="../etc")


if __name__ == "__main__":
    unittest.main(verbosity=2)
