"""Tests for the desk lead's decision log (decisions.py). Made-up numbers, no network, no window.

    python -m unittest          (in this folder)
"""

import json
import tempfile
import unittest
from pathlib import Path

import decisions

NOW = 1_795_000_000_000  # a fixed moment, so every test sees the same hours
HOUR = 3600 * 1000
MINUTE = 60 * 1000


def call(kind="BUY", price=1_000_000.0, at=NOW, marks=(), coin="BTC"):
    return {"at": at, "coin": coin, "kind": kind, "head": f"{kind.title()} {coin} at the next check", "price": price, "marks": list(marks), "seen": at}


def marked(price=1_000_000.0, moves=(), at=NOW, kind="BUY"):
    """A call with its marks already written: moves = ((hours, percent), ...)."""
    marks = [{"hours": hours, "at": at + hours * HOUR, "price": price * (1 + share / 100)} for hours, share in moves]
    return call(kind, price, at, marks)


def team(head="Buy BTC at the next check"):
    return [{"key": "strategy", "head": "BTC · BUY: all checks pass"}, {"key": "lead", "head": head}]


REPORT = {"mode": "real", "market": [{"coin": "btc", "bid": 1_209_000_000, "ask": 1_211_000_000}]}


class Kinds(unittest.TestCase):
    def test_the_four_calls_the_desk_lead_can_make(self):
        self.assertEqual(decisions.kind_of("Buy BTC at the next check"), "BUY")
        self.assertEqual(decisions.kind_of("Hold BTC: let it run"), "HOLD")
        self.assertEqual(decisions.kind_of("Sell BTC at the next check"), "SELL")
        self.assertEqual(decisions.kind_of("Wait: no buy now"), "WAIT")

    def test_what_is_about_this_pc_and_not_about_the_price_is_no_call(self):
        for head in ("Stopped: start the sender", "Paused: no new buys", "Blocked: safety stop is on", "At the limit: 1 of 1 open", "Signal says buy, risk says no", "Wait: no fresh signal", ""):
            self.assertEqual(decisions.kind_of(head), "", head)

    def test_the_price_comes_from_the_report_what_to_pay_first(self):
        self.assertEqual(decisions.price_of(REPORT, "BTC"), 1_211_000_000)
        self.assertEqual(decisions.price_of({"market": [{"coin": "eth", "bid": 51_000_000, "ask": 0}]}, "ETH"), 51_000_000)
        self.assertEqual(decisions.price_of(REPORT, "SOL"), 0)
        self.assertEqual(decisions.prices_of(REPORT), {"BTC": 1_211_000_000})


class Recording(unittest.TestCase):
    def test_a_call_is_written_with_its_price_and_coin(self):
        log = decisions.empty()
        self.assertTrue(decisions.record(log, "BTC", "Buy BTC at the next check", 1_200_000_000, NOW, "real"))
        found = log["calls"][-1]
        self.assertEqual((found["kind"], found["coin"], found["price"], found["at"]), ("BUY", "BTC", 1_200_000_000, NOW))
        self.assertEqual(found["marks"], [])

    def test_the_same_call_is_not_written_twice(self):
        log = decisions.empty()
        decisions.record(log, "BTC", "Buy BTC at the next check", 1_200_000_000, NOW)
        self.assertFalse(decisions.record(log, "BTC", "Buy BTC at the next check", 1_205_000_000, NOW + HOUR))
        self.assertEqual(len(log["calls"]), 1)

    def test_a_call_that_changes_is_written_after_the_gap(self):
        log = decisions.empty()
        decisions.record(log, "BTC", "Buy BTC at the next check", 1_200_000_000, NOW)
        self.assertFalse(decisions.record(log, "BTC", "Sell BTC at the next check", 1_210_000_000, NOW + MINUTE))
        self.assertTrue(decisions.record(log, "BTC", "Sell BTC at the next check", 1_210_000_000, NOW + decisions.GAP_MS + 1))
        self.assertEqual([found["kind"] for found in log["calls"]], ["BUY", "SELL"])

    def test_no_price_no_call_and_the_log_keeps_its_newest_hundreds_only(self):
        log = decisions.empty()
        self.assertFalse(decisions.record(log, "BTC", "Buy BTC at the next check", 0, NOW))
        for index in range(decisions.KEEP + 5):
            decisions.record(log, "BTC", "Buy BTC at the next check" if index % 2 else "Sell BTC at the next check", 1_000_000, NOW + index * HOUR)
        self.assertEqual(len(log["calls"]), decisions.KEEP)
        self.assertEqual(log["calls"][-1]["at"], NOW + (decisions.KEEP + 4) * HOUR)


class Marks(unittest.TestCase):
    def test_the_marks_are_written_at_their_times_and_not_before(self):
        log = decisions.empty()
        decisions.record(log, "BTC", "Buy BTC at the next check", 1_000_000, NOW)
        self.assertFalse(decisions.settle(log, {"BTC": 1_010_000}, NOW + 59 * MINUTE))
        self.assertEqual(log["calls"][0]["marks"], [])
        self.assertTrue(decisions.settle(log, {"BTC": 1_010_000}, NOW + HOUR))
        self.assertTrue(decisions.settle(log, {"BTC": 1_040_000}, NOW + 4 * HOUR))
        self.assertTrue(decisions.settle(log, {"BTC": 1_059_000}, NOW + 24 * HOUR))
        self.assertEqual([mark["hours"] for mark in log["calls"][0]["marks"]], [1, 4, 24])
        self.assertEqual(log["calls"][0]["marks"][1]["price"], 1_040_000)

    def test_a_mark_whose_look_came_too_late_is_written_as_missed(self):
        log = decisions.empty()
        decisions.record(log, "BTC", "Buy BTC at the next check", 1_000_000, NOW)
        decisions.settle(log, {"BTC": 1_040_000}, NOW + 7 * HOUR)
        marks = log["calls"][0]["marks"]
        self.assertEqual([mark.get("missed") for mark in marks], [True, True])  # 1h and 4h both came and went unseen
        mark, words = decisions.judge(log["calls"][0])
        self.assertEqual(mark, "unseen")
        self.assertIn("window was closed", words)

    def test_a_coin_without_a_price_is_asked_again_at_the_next_look(self):
        log = decisions.empty()
        decisions.record(log, "BTC", "Buy BTC at the next check", 1_000_000, NOW)
        self.assertFalse(decisions.settle(log, {"ETH": 51_000_000}, NOW + HOUR))
        self.assertEqual(log["calls"][0]["marks"], [])
        self.assertTrue(decisions.settle(log, {"BTC": 1_010_000}, NOW + HOUR + MINUTE))
        self.assertEqual(log["calls"][0]["marks"][0]["price"], 1_010_000)

    def test_the_price_did_is_written_mark_by_mark(self):
        found = marked(moves=((1, 0.4), (4, 2.4), (24, 5.1)))
        self.assertEqual(decisions.did_text(found), "1h +0,4% · 4h +2,4% · 24h +5,1%")
        self.assertEqual(decisions.did_text(call()), "no mark yet")


class Judging(unittest.TestCase):
    def test_a_buy_is_right_when_the_price_rose_past_the_cost(self):
        mark, words = decisions.judge(marked(moves=((4, 2.4),)))
        self.assertEqual(mark, "right")
        self.assertIn("rose 2,4%", words)

    def test_a_buy_is_wrong_when_the_price_fell_past_the_cost(self):
        mark, words = decisions.judge(marked(moves=((4, -1.2),)))
        self.assertEqual(mark, "wrong")
        self.assertIn("fell 1,2%", words)

    def test_a_buy_is_flat_when_it_moved_less_than_a_round_trip_costs(self):
        mark, words = decisions.judge(marked(moves=((4, 0.3),)))
        self.assertEqual(mark, "flat")
        self.assertIn("0,6%", words)

    def test_a_sell_is_right_when_the_price_fell_and_wrong_when_it_rose(self):
        self.assertEqual(decisions.judge(marked(moves=((4, -2.0),), kind="SELL"))[0], "right")
        self.assertEqual(decisions.judge(marked(moves=((4, 2.0),), kind="SELL"))[0], "wrong")

    def test_waiting_is_right_when_the_buy_would_not_have_earned(self):
        self.assertEqual(decisions.judge(marked(moves=((4, -1.4),), kind="WAIT"))[0], "right")
        self.assertEqual(decisions.judge(marked(moves=((4, 0.2),), kind="WAIT"))[0], "right")
        mark, words = decisions.judge(marked(moves=((4, 2.4),), kind="WAIT"))
        self.assertEqual(mark, "wrong")
        self.assertIn("the buy was skipped", words)

    def test_a_call_is_marked_at_the_four_hour_mark_and_not_earlier(self):
        self.assertEqual(decisions.judge(marked(moves=((1, 3.0),)))[0], "open")
        self.assertEqual(decisions.judge(marked(moves=((1, 3.0), (4, 1.0))))[0], "right")
        self.assertEqual(decisions.judge(marked(moves=((1, 1.0), (4, 2.0), (24, -9.0))))[0], "right")

    def test_the_four_hour_mark_missing_uses_the_next_one_that_was_seen(self):
        found = call("BUY", 1_000_000, NOW, [{"hours": 4, "missed": True}, {"hours": 24, "at": NOW + 24 * HOUR, "price": 1_030_000}])
        mark, words = decisions.judge(found)
        self.assertEqual(mark, "right")
        self.assertIn("24 hours later", words)


class Showing(unittest.TestCase):
    def test_the_calls_are_shown_newest_first(self):
        log = {"calls": [marked(at=NOW - 3 * HOUR), marked(at=NOW - 2 * HOUR), marked(at=NOW - HOUR)]}
        shown = decisions.rows(log, 2)
        self.assertEqual(len(shown), 2)
        self.assertEqual(shown[0]["at"], NOW - HOUR)
        self.assertEqual(set(shown[0]), {"at", "coin", "kind", "head", "price", "did", "mark", "words"})

    def test_the_tally_counts_every_mark(self):
        log = {"calls": [
            marked(moves=((4, 2.4),)),
            marked(moves=((4, -2.4),)),
            marked(moves=((4, 0.1),)),
            call(),
        ]}
        counts, words = decisions.tally(log)
        self.assertEqual((counts["right"], counts["wrong"], counts["flat"], counts["open"]), (1, 1, 1, 1))
        self.assertEqual(words, "4 calls: 1 right, 1 wrong, 1 flat, 1 open.")
        self.assertEqual(decisions.tally(decisions.empty())[1], "No call has been written down yet.")

    def test_the_guide_says_plainly_that_it_only_shows(self):
        self.assertIn("Shown only", decisions.GUIDE)
        self.assertIn("no rule reads it", decisions.GUIDE)


class Saving(unittest.TestCase):
    def test_a_log_survives_a_trip_through_the_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / decisions.JSON_NAME
            log = decisions.empty()
            decisions.record(log, "BTC", "Buy BTC at the next check", 1_200_000_000, NOW)
            decisions.settle(log, {"BTC": 1_210_000_000}, NOW + HOUR)
            self.assertTrue(decisions.save(path, log))
            again = decisions.load(path)
            self.assertEqual(again["calls"][0]["price"], 1_200_000_000)
            self.assertEqual(again["calls"][0]["marks"][0]["hours"], 1)
            self.assertFalse(Path(str(path) + ".tmp").exists())

    def test_a_missing_broken_or_foreign_file_gives_an_empty_log(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / decisions.JSON_NAME
            self.assertEqual(decisions.load(path)["calls"], [])
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(decisions.load(path)["calls"], [])
            path.write_text(json.dumps({"hello": "there"}), encoding="utf-8")
            self.assertEqual(decisions.load(path)["calls"], [])
            path.write_text(json.dumps({"calls": [{"at": 0}, "nonsense"]}), encoding="utf-8")
            self.assertEqual(decisions.load(path)["calls"], [])


def candles(start, step_ms, closes):
    """Rows the way the chart comes in: one per slice, each with its open time and its close."""
    return [{"t": start + index * step_ms, "o": close, "h": close, "l": close, "c": close} for index, close in enumerate(closes)]


def missed_call(kind="WAIT", price=1_000.0, hours=(1, 4), coin="BTC"):
    return call(kind, price, marks=[{"hours": hour, "missed": True} for hour in hours], coin=coin)


class ReadingTheChart(unittest.TestCase):
    """A window that was closed at a mark reads it out of the candles the chart already holds."""

    def test_a_mark_the_window_was_closed_for_is_read_out_of_its_candle(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call()]}
        rows = candles(NOW + 3 * HOUR, 15 * MINUTE, [1_000.0] * 4 + [980.0] * 4)
        self.assertTrue(decisions.fill(log, "BTC", {"15m": rows}, NOW + 6 * HOUR))
        marks = {mark["hours"]: mark for mark in log["calls"][0]["marks"]}
        self.assertEqual(marks[4]["price"], 980.0)
        self.assertTrue(marks[4]["late"])
        self.assertNotIn("missed", marks[4])
        self.assertEqual(decisions.judge(log["calls"][0])[0], "right", "a wait whose price fell is right")

    def test_a_candle_longer_than_the_mark_is_not_used_for_it(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call(hours=(1,))]}
        rows = candles(NOW - 4 * HOUR, 4 * HOUR, [1_000.0, 990.0, 985.0])
        self.assertFalse(decisions.fill(log, "BTC", {"4H": rows}, NOW + 6 * HOUR))
        self.assertTrue(log["calls"][0]["marks"][0]["missed"])

    def test_no_candle_reaching_the_mark_leaves_it_not_seen(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call()]}
        rows = candles(NOW + 10 * HOUR, 15 * MINUTE, [1_000.0] * 8)  # the chart starts after the marks
        self.assertFalse(decisions.fill(log, "BTC", {"15m": rows}, NOW + 12 * HOUR))
        self.assertEqual(decisions.judge(log["calls"][0])[0], "unseen")

    def test_a_mark_that_was_really_seen_is_never_overwritten(self):
        log = {"version": 1, "updated": 0, "calls": [call("WAIT", 1_000.0, marks=[{"hours": 4, "at": NOW + 4 * HOUR, "price": 900.0}])]}
        rows = candles(NOW + 3 * HOUR, 15 * MINUTE, [1_000.0] * 8)
        self.assertFalse(decisions.fill(log, "BTC", {"15m": rows}, NOW + 6 * HOUR))
        self.assertEqual(log["calls"][0]["marks"][0]["price"], 900.0)

    def test_the_candles_of_another_coin_are_not_used(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call(coin="ETH")]}
        rows = candles(NOW + 3 * HOUR, 15 * MINUTE, [1_000.0] * 8)
        self.assertFalse(decisions.fill(log, "BTC", {"15m": rows}, NOW + 6 * HOUR))

    def test_a_candle_that_has_not_closed_yet_is_not_used(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call(hours=(4,))]}
        rows = candles(NOW + 4 * HOUR, 15 * MINUTE, [1_000.0] * 4)  # the first closes 15 minutes after the mark
        self.assertFalse(decisions.fill(log, "BTC", {"15m": rows}, NOW + 4 * HOUR + 5 * MINUTE))
        self.assertTrue(decisions.fill(log, "BTC", {"15m": rows}, NOW + 4 * HOUR + 20 * MINUTE))

    def test_the_shown_line_says_the_mark_came_from_the_candle(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call(kind="BUY")]}
        rows = candles(NOW + 3 * HOUR, 15 * MINUTE, [1_000.0] * 4 + [1_030.0] * 4)
        decisions.fill(log, "BTC", {"15m": rows}, NOW + 6 * HOUR)
        row = decisions.rows(log)[0]
        self.assertEqual(row["mark"], "right")
        self.assertTrue(row["words"].endswith(decisions.LATE), row["words"])

    def test_one_look_fills_a_missed_mark_and_saves_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / decisions.JSON_NAME
            log = {"version": 1, "updated": 0, "calls": [missed_call(kind="BUY", hours=(4,))]}
            rows = candles(NOW + 3 * HOUR, 15 * MINUTE, [1_000.0] * 4 + [1_040.0] * 4)
            quiet = {"mode": "real", "market": []}  # no price in the report: only the chart can say
            log = decisions.update(log, quiet, team("Wait: no buy now"), "BTC", NOW + 6 * HOUR, path, {"15m": rows, "4H": candles(NOW - 4 * HOUR, 4 * HOUR, [1_000.0, 1_010.0])})
            self.assertEqual(decisions.load(path)["calls"][0]["marks"][0]["price"], 1_040.0)
            self.assertEqual(decisions.judge(log["calls"][0])[0], "right")

    def test_a_chart_that_makes_no_sense_does_not_stop_the_window(self):
        log = {"version": 1, "updated": 0, "calls": [missed_call()]}
        for bad in ({"15m": None}, {"15m": ["nonsense", 3]}, {"15m": [{"t": "x", "c": "y"}]}, {}, None):
            self.assertFalse(decisions.fill(log, "BTC", bad, NOW + 6 * HOUR))


class DeskSide(unittest.TestCase):
    def test_one_look_records_the_call_and_saves_it(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / decisions.JSON_NAME
            log = decisions.update(None, REPORT, team(), "BTC", NOW, path)
            self.assertEqual(len(log["calls"]), 1)
            self.assertEqual(log["calls"][0]["price"], 1_211_000_000)
            self.assertEqual(log["calls"][0]["mode"], "real")
            self.assertTrue(path.exists())
            decisions.update(log, REPORT, team(), "BTC", NOW + 4 * HOUR, path)
            saved = decisions.load(path)
            self.assertEqual(saved["calls"][0]["marks"][0]["hours"], 1)
            self.assertEqual(saved["calls"][0]["marks"][1]["hours"], 4)

    def test_a_stopped_sender_writes_nothing_down(self):
        log = decisions.update(None, REPORT, team("Stopped: start the sender"), "BTC", NOW)
        self.assertEqual(log["calls"], [])

    def test_the_log_is_not_handed_to_the_desk_and_has_no_order_code(self):
        report, members = json.loads(json.dumps(REPORT)), json.loads(json.dumps(team()))
        decisions.update(None, report, members, "BTC", NOW)
        self.assertEqual(report, REPORT)
        self.assertEqual(members, team())
        source = Path(decisions.__file__).read_text(encoding="utf-8")
        for forbidden in ("import bridge", "place_order", "api_key", "requests."):
            self.assertNotIn(forbidden, source)

    def test_the_demo_has_settled_calls_and_one_still_open(self):
        log = decisions.demo(NOW)
        marks = [decisions.judge(found)[0] for found in log["calls"]]
        self.assertIn("right", marks)
        self.assertIn("open", marks)
        self.assertIn("sell", " ".join(found["kind"].lower() for found in log["calls"]))

    def test_the_window_reads_the_saved_log_when_it_starts(self):
        # A restart must not erase the calls the previous run wrote (0.17.1 did: the log
        # started empty, so the first save wiped the history).
        desk_source = (Path(decisions.__file__).parent / "desk.py").read_text(encoding="utf-8")
        self.assertIn("decisions.load(folder / decisions.JSON_NAME)", desk_source)
        self.assertNotIn('"log": None', desk_source)


if __name__ == "__main__":
    unittest.main()
