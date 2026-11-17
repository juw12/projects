"""Tests for the study (learn.py). Made-up candles and a pretend network: nothing is read or ordered.

    python -m unittest          (in this folder)
"""

import contextlib
import importlib.util
import io
import json
import math
import random
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import learn

HOUR4 = learn.FOUR_HOURS
SMALL_FAMILY = [learn.LIVE, (10, 30, 150, 50, 70, 2.0), (30, 80, 200, 50, 70, 4.0)]


def candles(count, seed=7, start=learn.TEST_FROM - 400 * HOUR4):
    """Prices that trend up and down in turns, with noise. The same list every time."""
    rng = random.Random(seed)
    price, rows = 100.0, []
    for index in range(count):
        opened = price
        closed = max(1.0, opened * (1 + 0.004 * math.sin(index / 90) + rng.uniform(-0.012, 0.012)))
        high = max(opened, closed) * (1 + rng.uniform(0, 0.004))
        low = min(opened, closed) * (1 - rng.uniform(0, 0.004))
        rows.append({"t": start + index * HOUR4, "o": opened, "h": high, "l": low, "c": closed})
        price = closed
    return rows


def plan_tool():
    """tools/plan_backtest.py, where the plan's numbers come from."""
    path = Path(__file__).resolve().parent.parent / "tools" / "plan_backtest.py"
    spec = importlib.util.spec_from_file_location("plan_backtest", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def small_study(rows, now=None, previous=None, measured=None, family=None, review=(90, 8)):
    now = now or rows[-1]["t"] + HOUR4
    with mock.patch.multiple(learn, FAMILY=family or SMALL_FAMILY, TRAIN_DAYS=150, TEST_DAYS=60, REVIEW_DAYS=review[0], REVIEW_TRADES=review[1]):
        return learn.study(rows, rows, 20_000, 8.0, now, previous, measured)


class Replay(unittest.TestCase):
    def setUp(self):
        self.rows = candles(3000)

    def test_the_live_rules_trade_exactly_like_the_plan_test(self):
        trades = learn.replay(learn.Series(self.rows), learn.LIVE)
        self.assertGreater(len(trades), 5)
        self.assertEqual(trades, plan_tool().strategy_trades(self.rows))

    def test_the_copy_in_rupiah_matches_the_plan_test(self):
        trades = learn.replay(learn.Series(self.rows), learn.LIVE)
        times, values, results = learn.copy_trades(trades, self.rows, 20_000, 8.0, learn.COST, learn.SLIP, learn.TEST_FROM)
        curve, plan_results = plan_tool().copy_at_indodax(trades, self.rows, 20_000, 8.0, learn.COST, learn.SLIP, learn.TEST_FROM)
        self.assertEqual(list(zip(times, values)), curve)
        self.assertEqual([result for _, result in results], plan_results)

    def test_no_decision_uses_a_later_candle(self):
        full = learn.replay(learn.Series(self.rows), learn.LIVE)
        cut = self.rows[:2000]
        early = learn.replay(learn.Series(cut), learn.LIVE)
        self.assertEqual(early, [trade for trade in full if trade[1] <= cut[-1]["t"]])
        self.assertGreater(len(early), 2)

    def test_costs_make_every_trade_worse(self):
        trades = learn.replay(learn.Series(self.rows), learn.LIVE)
        free = learn.copy_trades(trades, self.rows, 20_000, 8.0, 0.0, 0.0, learn.TEST_FROM)[2]
        paid = learn.copy_trades(trades, self.rows, 20_000, 8.0, learn.COST, learn.SLIP, learn.TEST_FROM)[2]
        self.assertEqual(len(free), len(paid))
        self.assertTrue(all(with_cost < without for (_, with_cost), (_, without) in zip(paid, free)))

    def test_the_senders_stop_ends_a_falling_trade_near_eight_percent(self):
        start = learn.TEST_FROM
        prices = [{"t": start + index * HOUR4, "o": 100.0, "h": 100.0, "l": 100.0, "c": 100.0} for index in range(4)]
        prices[2].update(l=80.0, c=80.0)
        trades = [(start, start + 3 * HOUR4, "signal", 1.0)]
        _, _, results = learn.copy_trades(trades, prices, 20_000, 8.0, 0.0, 0.0, start)
        self.assertEqual(results[0][0], start + 2 * HOUR4)
        self.assertAlmostEqual(results[0][1], -1600.0, places=6)


class Study(unittest.TestCase):
    def setUp(self):
        self.rows = candles(3000)

    def test_the_summary_says_what_the_report_shows(self):
        summary = small_study(self.rows)["summary"]
        for name in ("at", "candles", "order", "trades", "wins", "perYear", "dip", "yearUp", "monthUp", "unseen", "cost", "challenger", "verdict"):
            self.assertIn(name, summary)
        self.assertGreater(summary["trades"], 5)
        self.assertTrue(0 <= summary["wins"] <= 100)
        self.assertLessEqual(summary["dip"], 0)
        self.assertGreaterEqual(summary["unseen"]["windows"], 3)
        self.assertEqual(summary["cost"], {"assumed": 0.9, "measured": None, "trades": 0, "used": "assumed"})
        self.assertIn(summary["verdict"], ("keep", "watch"))
        json.dumps(summary)

    def test_with_no_other_version_the_rules_are_kept(self):
        result = small_study(self.rows, family=[learn.LIVE])
        self.assertEqual(result["summary"]["verdict"], "keep")
        self.assertIsNone(result["summary"]["challenger"])
        self.assertIsNone(result["watched"])
        self.assertEqual(result["summary"]["unseen"]["live"], result["summary"]["unseen"]["picked"])

    def test_a_new_version_is_only_watched_however_good_it_looks(self):
        result = small_study(self.rows)
        if result["watched"] is None:
            self.skipTest("the live rules are the best of these three on these candles")
        self.assertEqual(result["summary"]["verdict"], "watch")
        self.assertEqual(result["summary"]["challenger"]["days"], 0)
        self.assertEqual(result["summary"]["challenger"]["trades"], 0)

    def test_the_watched_version_keeps_its_first_day(self):
        first = small_study(self.rows)
        if first["watched"] is None:
            self.skipTest("the live rules are the best of these three on these candles")
        since = self.rows[-1]["t"] - 100 * learn.DAY
        again = small_study(self.rows, previous={"watched": {"rules": first["watched"]["rules"], "since": since}})
        self.assertEqual(again["watched"]["since"], since)
        self.assertEqual(again["summary"]["challenger"]["days"], 100)

    def test_review_needs_time_trades_a_lead_and_a_win_on_unseen_half_years(self):
        first = small_study(self.rows)
        if first["watched"] is None:
            self.skipTest("the live rules are the best of these three on these candles")
        since = self.rows[-1]["t"] - 200 * learn.DAY
        previous = {"watched": {"rules": first["watched"]["rules"], "since": since}}
        summary = small_study(self.rows, previous=previous, review=(90, 1))["summary"]
        challenger, unseen = summary["challenger"], summary["unseen"]
        earned = challenger["trades"] >= 1 and challenger["lead"] > 0 and unseen["picked"] > unseen["live"]
        self.assertEqual(summary["verdict"], "review" if earned else "watch")
        too_soon = small_study(self.rows, previous=previous, review=(300, 1))["summary"]
        self.assertEqual(too_soon["verdict"], "watch")

    def test_five_real_trades_replace_the_assumed_cost(self):
        four = {str(index): {"buy": 1.0, "sell": 1.0} for index in range(4)}
        five = {**four, "4": {"buy": 1.0, "sell": 1.0}}
        assumed = small_study(self.rows, measured=four)["summary"]
        measured = small_study(self.rows, measured=five)["summary"]
        self.assertEqual(assumed["cost"]["used"], "assumed")
        self.assertEqual(assumed["cost"]["measured"], 2.0)
        self.assertEqual(measured["cost"], {"assumed": 0.9, "measured": 2.0, "trades": 5, "used": "measured"})
        self.assertLess(measured["perYear"], assumed["perYear"])

    def test_too_few_candles_is_an_error_not_a_result(self):
        with self.assertRaises(ValueError):
            small_study(candles(300, start=learn.TEST_FROM - 299 * HOUR4))

    def test_the_words_never_promise(self):
        summary = small_study(self.rows)["summary"]
        text = "\n".join(learn.words(summary))
        self.assertIn("Verdict", text)
        self.assertIn("assumed", text)
        self.assertNotIn("will", text)


class Prices(unittest.TestCase):
    def test_indodax_is_asked_again_for_what_it_left_out_at_the_front(self):
        asked = []

        def read(url):
            start, end = (int(part.split("=")[1]) for part in url.split("?")[1].split("&")[:2])
            asked.append((start, end))
            moments = list(range(start, end, 4 * 3600))
            return [{"Time": moment, "Open": 1, "High": 1, "Low": 1, "Close": 1} for moment in moments[-100:]]

        rows = learn.indodax_candles(read, 0, 250 * HOUR4)
        self.assertEqual([row["t"] for row in rows], [index * HOUR4 for index in range(250)])
        self.assertEqual(len(asked), 3)

    def test_refresh_reads_the_last_saved_candles_again_and_adds_the_new_ones(self):
        saved = {"binance": [{"t": learn.CANDLES_FROM + index * HOUR4, "o": 1, "h": 1, "l": 1, "c": 1} for index in range(10)], "indodax": []}
        now = learn.CANDLES_FROM + 12 * HOUR4
        asked = {}

        def fetch(name):
            def run(read, start, end):
                asked.setdefault(name, []).append(start)
                return [{"t": moment, "o": 2, "h": 2, "l": 2, "c": 2} for moment in range(start, end, HOUR4)]

            return run

        with mock.patch.object(learn, "binance_candles", fetch("binance")), mock.patch.object(learn, "indodax_candles", fetch("indodax")):
            fresh = learn.refresh(saved, None, now)
        self.assertEqual(asked["binance"], [learn.CANDLES_FROM + 4 * HOUR4])
        self.assertEqual(asked["indodax"], [learn.CANDLES_FROM])
        self.assertEqual(len(fresh["binance"]), 12)
        self.assertEqual([row["c"] for row in fresh["binance"][:5]], [1, 1, 1, 1, 2])

    def test_a_candle_still_forming_is_left_out(self):
        rows = [{"t": 0}, {"t": HOUR4}]
        self.assertEqual(learn.closed_only(rows, HOUR4 + 5), [{"t": 0}])


class Measure(unittest.TestCase):
    BOUGHT, SOLD = 1_763_000_030_000, 1_763_090_045_000

    def trade(self, **changes):
        entry = {"symbol": "BTCUSDT", "real": True, "how": "sold", "spent": 20_000.0, "received": 20_600.0, "quantity": 0.00002, "boughtAt": self.BOUGHT, "at": self.SOLD}
        entry.update(changes)
        return entry

    def read(self, url):
        start = int(url.split("from=")[1].split("&")[0])
        price = 995_000_000 if start < self.SOLD // 1000 - 600 else 1_040_000_000
        return [{"Time": start + 60 * index, "Open": price, "High": price, "Low": price, "Close": price} for index in range(6)]

    def test_the_cost_of_a_buy_and_a_sale_against_the_price_of_that_minute(self):
        measured = learn.measure([self.trade()], {}, self.read)
        entry = measured[str(self.SOLD)]
        self.assertAlmostEqual(entry["buy"], (1_000_000_000 / 995_000_000 - 1) * 100, places=2)
        self.assertAlmostEqual(entry["sell"], (1 - 1_030_000_000 / 1_040_000_000) * 100, places=2)
        self.assertEqual(learn.measured_cost(measured)[1], 1)

    def test_practice_estimates_and_other_endings_are_not_measured(self):
        skipped = [self.trade(real=False), self.trade(estimated=True), self.trade(how="gone"), self.trade(quantity=0)]
        self.assertEqual(learn.measure(skipped, {}, self.read), {})

    def test_a_trade_is_measured_once(self):
        def never(url):
            raise AssertionError("already measured")

        kept = {str(self.SOLD): {"buy": 0.4, "sell": 0.5}}
        self.assertEqual(learn.measure([self.trade()], kept, never), kept)

    def test_a_price_that_cannot_be_read_is_tried_next_time(self):
        def broken(url):
            raise OSError("proxy")

        self.assertEqual(learn.measure([self.trade()], {}, broken), {})


class CommandLine(unittest.TestCase):
    def run_main(self, folder, *arguments):
        env = Path(folder) / ".env"
        env.write_text("INDODAX_ORDER_IDR=20000\n", encoding="utf-8")
        output = io.StringIO()
        with mock.patch.dict("os.environ", {}, clear=True), contextlib.redirect_stdout(output):
            code = learn.main(["--env", str(env), "--state", str(Path(folder) / "bridge_state.json"), *arguments])
        return code, output.getvalue()

    def test_offline_it_studies_the_saved_candles_and_writes_the_result(self):
        rows = candles(3000)
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "learn_candles.json").write_text(json.dumps({"binance": rows, "indodax": rows}), encoding="utf-8")
            with mock.patch.multiple(learn, FAMILY=SMALL_FAMILY, TRAIN_DAYS=150, TEST_DAYS=60):
                with mock.patch.object(learn, "reader", return_value=lambda url: self.fail("offline must not read")):
                    code, output = self.run_main(folder, "--offline")
            self.assertEqual(code, 0)
            self.assertIn("Verdict", output)
            saved = json.loads((Path(folder) / "learn.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["summary"]["order"], 20_000)
            self.assertFalse((Path(folder) / "bridge_state.json").exists())

    def test_without_candles_it_says_so(self):
        with tempfile.TemporaryDirectory() as folder:
            code, output = self.run_main(folder, "--offline")
        self.assertEqual(code, 1)
        self.assertIn("Too few candles", output)

    def test_prices_that_cannot_be_read_leave_the_last_result_alone(self):
        def broken(url):
            raise OSError("proxy")

        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / "learn.json").write_text(json.dumps({"summary": {"at": 1}}), encoding="utf-8")
            with mock.patch.object(learn, "reader", return_value=broken), mock.patch.object(learn.time, "sleep"):
                code, output = self.run_main(folder)
            self.assertEqual(code, 1)
            self.assertIn("could not be read", output)
            self.assertEqual(json.loads((Path(folder) / "learn.json").read_text(encoding="utf-8")), {"summary": {"at": 1}})

    def test_the_study_has_no_way_to_order(self):
        source = Path(learn.__file__).read_text(encoding="utf-8")
        for word in ("send_order", "exchange_for", ".trade(", "api_secret", "api_key", "buy_real", "sell_real"):
            self.assertNotIn(word, source)


if __name__ == "__main__":
    unittest.main()
