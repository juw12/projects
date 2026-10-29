#!/usr/bin/env python3
"""Offline checks for Twin Indonesia's headline parsing, ticker tagging, merging and the
hourly headline refresh of web/id/snapshot.js (no network)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import indonesia_news as news  # noqa: E402
import indonesia_snapshot as snapshot_builder  # noqa: E402

IDX_FEED = {"id": "test-idx", "source": "Test", "url": "https://example.com/rss", "market": "IDX", "filter": None}
GOLD_FEED = {"id": "test-gold", "source": "Test", "url": "https://example.com/gold", "market": "GOLD",
             "filter": r"\b(gold|emas|bullion|precious)\b"}

SAMPLE_RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Test</title>
<item>
  <title>BBCA dan BBRI menguat, IHSG naik</title>
  <link>https://example.com/a</link>
  <description>&lt;p&gt;Saham &lt;b&gt;BBCA&lt;/b&gt; naik 2%&lt;/p&gt;</description>
  <pubDate>Tue, 27 Oct 2026 09:15:00 +0700</pubDate>
</item>
<item><title>Script link is dropped</title><link>javascript:alert(1)</link></item>
<item>
  <title>Harga emas naik lagi</title>
  <link>https://example.com/b</link>
  <pubDate>2026-10-27 10:00:00</pubDate>
</item>
</channel></rss>"""

GOLD_RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Gold steadies near record</title><link>https://example.com/g1</link></item>
<item><title>Oil slips on supply</title><link>https://example.com/o1</link></item>
</channel></rss>"""


class ParseTests(unittest.TestCase):
    def test_rss_items_are_cleaned_and_unsafe_links_dropped(self):
        items = news.parse_rss(SAMPLE_RSS, IDX_FEED)
        self.assertEqual([item["link"] for item in items], ["https://example.com/a", "https://example.com/b"])
        first = items[0]
        self.assertEqual(first["summary"], "Saham BBCA naik 2%")
        self.assertEqual(first["time"], "2026-10-27T02:15:00+00:00")
        self.assertEqual(first["market"], "IDX")
        self.assertTrue(first["id"].startswith("test-idx:"))

    def test_naive_times_are_treated_as_utc(self):
        items = news.parse_rss(SAMPLE_RSS, IDX_FEED)
        self.assertEqual(items[1]["time"], "2026-10-27T10:00:00+00:00")

    def test_feed_filter_keeps_only_matching_headlines(self):
        items = news.parse_rss(GOLD_RSS, GOLD_FEED)
        self.assertEqual([item["title"] for item in items], ["Gold steadies near record"])
        self.assertEqual(items[0]["tickers"], ["XAU"])

    def test_long_text_is_truncated_with_an_ellipsis(self):
        cleaned = news.clean_text("word " * 100, limit=20)
        self.assertEqual(len(cleaned), 20)
        self.assertTrue(cleaned.endswith("\u2026"))


class TaggingTests(unittest.TestCase):
    def test_idx_codes_and_gold_in_idx_news(self):
        tags = news.tag_tickers("BBCA dan BBRI menguat, harga emas naik", "IDX")
        self.assertEqual(tags, ["BBCA", "BBRI", "XAU"])

    def test_solana_name_any_case_but_ticker_only_in_capitals(self):
        self.assertIn("SOL", news.tag_tickers("solana ETF filing advances", "CRYPTO"))
        self.assertIn("SOL", news.tag_tickers("SOL jumps 8% overnight", "CRYPTO"))
        self.assertNotIn("SOL", news.tag_tickers("Peso sol exchange rate steady", "CRYPTO"))

    def test_short_us_tickers_need_cashtag_or_brackets(self):
        self.assertIn("V", news.tag_tickers("Visa (V) beats estimates", "US"))
        self.assertNotIn("V", news.tag_tickers("Category V storm warning", "US"))
        self.assertIn("NVDA", news.tag_tickers("Nvidia unveils new chip", "US"))

    def test_gold_is_not_tagged_in_crypto_news(self):
        self.assertNotIn("XAU", news.tag_tickers("Tether gold token volumes rise", "CRYPTO"))


class SourceTests(unittest.TestCase):
    def test_twin_news_becomes_us_items_with_known_tickers_only(self):
        payload = {"items": [
            {"title": "Apple results", "link": "https://example.com/aapl", "touches": ["AAPL", "XYZ"],
             "time": "2026-10-27T13:00:00Z", "source": "Yahoo Finance"},
            {"title": "Bad link", "link": "ftp://example.com/x", "ticker": "MSFT"},
        ]}
        items = news.from_twin_news(payload)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["market"], "US")
        self.assertEqual(items[0]["tickers"], ["AAPL"])
        self.assertEqual(items[0]["time"], "2026-10-27T13:00:00+00:00")

    def test_collect_reports_failures_and_sorts_newest_first(self):
        def fake_fetch(url):
            if url.endswith("/broken"):
                raise OSError("offline")
            return SAMPLE_RSS

        feeds = [IDX_FEED, dict(IDX_FEED, id="broken", url="https://example.com/broken")]
        items, status = news.collect(feeds, fetch=fake_fetch)
        self.assertEqual(status["test-idx"], {"ok": True, "items": 2})
        self.assertEqual(status["broken"], {"ok": False, "error": "OSError"})
        self.assertEqual([item["link"] for item in items], ["https://example.com/b", "https://example.com/a"])


def item(link, time, title="Headline"):
    return {"id": link, "source": "Test", "title": title, "summary": "", "link": link,
            "time": time, "market": "IDX", "tickers": []}


class MergeTests(unittest.TestCase):
    def test_fresh_copy_wins_and_links_are_unique(self):
        fresh = [item("https://example.com/a", "2026-10-28T10:00:00+00:00", "Updated title")]
        previous = [item("https://example.com/a", "2026-10-28T09:00:00+00:00", "Old title"),
                    item("https://example.com/b", "2026-10-27T09:00:00+00:00")]
        merged = news.merge_news(fresh, previous)
        self.assertEqual([entry["link"] for entry in merged], ["https://example.com/a", "https://example.com/b"])
        self.assertEqual(merged[0]["title"], "Updated title")

    def test_newest_first_capped_and_undated_last(self):
        entries = [item(f"https://example.com/{n}", f"2026-10-{10 + n:02d}T00:00:00+00:00") for n in range(5)]
        entries.append(item("https://example.com/undated", None))
        merged = news.merge_news(entries, limit=4)
        self.assertEqual(len(merged), 4)
        self.assertEqual(merged[0]["link"], "https://example.com/4")
        self.assertNotIn("https://example.com/undated", [entry["link"] for entry in merged])

    def test_gather_combines_twin_news_and_every_feed(self):
        twin = {"items": [{"title": "Apple results", "link": "https://example.com/aapl", "touches": ["AAPL"],
                           "time": "2026-10-27T13:00:00Z"}]}
        requested = []

        def fake_fetch(url):
            requested.append(url)
            if "antaranews" not in url:
                raise OSError("offline")
            return SAMPLE_RSS

        items, status = news.gather(twin, fetch=fake_fetch)
        self.assertEqual(sorted(requested), sorted(feed["url"] for feed in news.FEEDS))
        self.assertEqual(status["antara-bursa"], {"ok": True, "items": 2})
        self.assertFalse(status["coindesk"]["ok"])
        self.assertEqual({entry["link"] for entry in items},
                         {"https://example.com/a", "https://example.com/b", "https://example.com/aapl"})


class SnapshotRefreshTests(unittest.TestCase):
    """indonesia_snapshot.py --news-only: new headlines in, prices untouched."""

    def make_snapshot(self):
        return {
            "takenAt": "2026-10-26T00:00:00+00:00",
            "sources": {"stocks": "test", "news": {}},
            "instruments": [{"symbol": "BBCA", "market": "IDX", "price": 9000}],
            "news": [item("https://example.com/old", "2026-10-26T08:00:00+00:00")],
        }

    def test_fresh_headlines_merge_with_older_ones(self):
        snapshot = self.make_snapshot()
        fetched = snapshot_builder.refresh_news(snapshot, twin_json=lambda path: {"items": []},
                                                fetch=lambda url: SAMPLE_RSS)
        links = [entry["link"] for entry in snapshot["news"]]
        self.assertGreater(fetched, 0)
        self.assertEqual(links, ["https://example.com/b", "https://example.com/a", "https://example.com/old"])
        self.assertTrue(snapshot["sources"]["news"]["antara-bursa"]["ok"])
        self.assertIn("newsTakenAt", snapshot)
        self.assertEqual(snapshot["instruments"][0]["price"], 9000)

    def test_all_feeds_down_reports_zero_and_keeps_headlines(self):
        snapshot = self.make_snapshot()

        def offline(url):
            raise OSError("offline")

        fetched = snapshot_builder.refresh_news(snapshot, twin_json=lambda path: {"items": []}, fetch=offline)
        self.assertEqual(fetched, 0)
        self.assertEqual([entry["link"] for entry in snapshot["news"]], ["https://example.com/old"])

    def test_snapshot_file_round_trip_uses_lf_and_keeps_unicode(self):
        snapshot = self.make_snapshot()
        snapshot["news"][0]["title"] = "Harga emas naik — rupiah menguat"
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "snapshot.js"
            snapshot_builder.write_snapshot(snapshot, path)
            raw = path.read_bytes()
            self.assertNotIn(b"\r\n", raw)
            self.assertTrue(raw.decode("utf-8").startswith("/* Generated by"))
            self.assertEqual(snapshot_builder.read_snapshot(path), json.loads(json.dumps(snapshot)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
