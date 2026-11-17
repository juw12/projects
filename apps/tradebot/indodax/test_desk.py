"""Tests for the parts of desk.py that need no window. Run: python -m unittest (in this folder)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import desk  # noqa: E402

NOW = 1_800_000_000_000


class FakeProcess:
    def __init__(self):
        self.pid = 4242
        self.stdout = iter(["line one\n", "line two\n"])
        self.code = None
        self.terminated = False

    def poll(self):
        return self.code

    def wait(self, timeout=None):
        return self.code if self.code is not None else 0

    def terminate(self):
        self.terminated = True
        self.code = 1


class DeskTest(unittest.TestCase):
    def folder(self):
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        return Path(holder.name)

    def test_age_is_said_in_plain_words(self):
        assert desk.age_text(None) == "never"
        assert desk.age_text(20) == "just now"
        assert desk.age_text(600) == "10 minutes ago"
        assert desk.age_text(7200) == "2 hours ago"
        assert desk.age_text(3 * 86400) == "3 days ago"


    def test_the_report_file_is_read_and_a_broken_one_is_nothing(self):
        tmp_path = self.folder()
        path = tmp_path / "bridge_report.json"
        assert desk.read_local(path) is None
        path.write_text("{not json", encoding="utf-8")
        assert desk.read_local(path) is None
        path.write_text(json.dumps({"at": NOW, "report": []}), encoding="utf-8")
        assert desk.read_local(path) is None
        path.write_text(json.dumps({"at": NOW, "report": {"mode": "real"}}), encoding="utf-8")
        assert desk.read_local(path)["report"]["mode"] == "real"


    def test_a_fresh_report_file_means_a_sender_is_running(self):
        assert desk.local_is_fresh({"at": NOW - 60_000, "report": {}}, NOW)
        assert not desk.local_is_fresh({"at": NOW - 200_000, "report": {}}, NOW)
        assert not desk.local_is_fresh({"at": NOW + 5_000, "report": {}}, NOW)
        assert not desk.local_is_fresh(None, NOW)


    def test_only_a_running_sender_counts_as_one(self):
        rows = [
            {"ProcessId": 1, "CommandLine": "python.exe bridge.py"},
            {"ProcessId": 2, "CommandLine": "python.exe bridge.py --show"},
            {"ProcessId": 3, "CommandLine": "python.exe -u bridge.py"},
            {"ProcessId": 4, "CommandLine": "python.exe E:/x/mt5/bridge.py"},
            {"ProcessId": 5, "CommandLine": "pythonw.exe desk.py"},
            {"ProcessId": 6, "CommandLine": None},
            {"ProcessId": 7, "CommandLine": "python.exe bridge.py --check"},
        ]
        assert desk.sender_candidates(rows) == [1, 3]
        assert desk.sender_candidates(rows, own_pid=3) == [1]
        assert desk.sender_candidates(None) == []


    def test_tiles_show_real_money_only_in_real_mode(self):
        view = {
            "now": NOW,
            "at": NOW - 30_000,
            "paused": False,
            "report": {
                "mode": "real",
                "cash": 50000,
                "positions": [
                    {"symbol": "BTCUSDT", "real": True, "value": 20500},
                    {"symbol": "ETHUSDT", "real": False, "value": 99999},
                ],
                "result": {"practice": 123456, "real": 900},
                "today": {"practice": 5, "real": -100, "buys": 1},
            },
        }
        shown = desk.tiles(view, None, NOW)
        assert shown["mode"] == "REAL MONEY" and shown["real"] is True
        assert shown["cash"] == "Rp50.000"
        assert shown["holding"] == "BTC · worth Rp20.500"
        assert "900" in shown["result"] and "123" not in shown["result"]
        assert shown["today"].endswith("1 buys") and "100" in shown["today"]
        assert shown["heard"] == "just now"
        assert shown["paused"] is False


    def test_tiles_fall_back_to_the_senders_file_and_say_when_nothing_is_known(self):
        local = {"at": NOW - 600_000, "report": {"mode": "practice", "positions": [], "result": {}, "today": {}, "paused": True}}
        shown = desk.tiles(None, local, NOW)
        assert shown["mode"] == "practice (pretend money)"
        assert shown["cash"] == "not reported"
        assert shown["holding"] == "no coin"
        assert shown["heard"] == "10 minutes ago"
        assert shown["paused"] is True
        assert desk.tiles(None, None, NOW)["mode"] == "no report yet"
        assert "Start the sender" in desk.local_text(None, NOW)
        text = desk.local_text({"at": NOW, "report": {"positions": [], "market": [{"coin": "btc", "bid": 1650000000, "ask": 1651000000}], "notes": ["hello"]}}, NOW)
        assert "BTC: buyers pay Rp1.650.000.000" in text and "hello" in text


    def test_the_sender_child_is_hidden_started_once_and_stopped(self):
        tmp_path = self.folder()
        lines, calls = [], []

        def popen(command, **options):
            calls.append((command, options))
            return FakeProcess()

        sender = desk.Sender(tmp_path, lines.append, python="python.exe", popen=popen)
        assert not sender.running()
        sender.start()
        sender.start()
        assert len(calls) == 1, "a second start does not make a second sender"
        command, options = calls[0]
        assert command == ["python.exe", "-u", "bridge.py"]
        assert options["cwd"] == str(tmp_path)
        assert sender.running() and sender.wanted
        sender.stop()
        assert sender.process.terminated and not sender.running() and not sender.wanted


    def test_the_server_calls_use_the_senders_key_and_never_start_without_one(self):
        tmp_path = self.folder()
        env = tmp_path / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=\n", encoding="utf-8")
        try:
            desk.Server(env).view()
        except desk.bridge.ApiError as error:
            assert "INDODAX_BRIDGE_KEY" in str(error)
        else:
            raise AssertionError("an empty key must not be sent")


    def test_the_log_file_is_kept_and_rolled_over(self):
        tmp_path = self.folder()
        path = tmp_path / "desk_sender.log"
        desk.append_log(path, "one")
        desk.append_log(path, "two")
        assert path.read_text(encoding="utf-8") == "one\ntwo\n"
        path.write_text("x" * (desk.LOG_FILE_BYTES + 1), encoding="utf-8")
        desk.append_log(path, "three")
        assert path.read_text(encoding="utf-8") == "three\n"
        assert path.with_suffix(".old.log").exists()


    # ---- what the window shows (desk v2) ----

    def fine(self):
        view = desk.demo_view(NOW)
        local = {"at": NOW - 30_000, "report": view["report"]}
        return view, local

    def test_no_warning_is_shown_when_all_is_fine(self):
        view, local = self.fine()
        assert desk.alerts(view, local, "here", "", NOW) == []

    def test_a_stopped_sender_is_the_first_and_worst_warning(self):
        view, local = self.fine()
        found = desk.alerts(view, local, "stopped", "", NOW)
        assert found[0][0] == "bad" and "stopped" in found[0][1]

    def test_the_safety_stop_and_an_unchecked_key_are_bad_news(self):
        view, local = self.fine()
        view["report"]["tripped"] = True
        view["report"]["trippedWhy"] = "The balance did not match."
        view["report"]["checked"] = False
        found = desk.alerts(view, local, "here", "", NOW)
        assert [level for level, _ in found] == ["bad", "bad"]
        assert "Safety stop" in found[0][1] and "The balance did not match." in found[0][1]
        assert "API key" in found[1][1]

    def test_an_unchecked_key_does_not_matter_in_practice_mode(self):
        view, local = self.fine()
        view["report"]["mode"] = "practice"
        view["report"]["checked"] = False
        assert desk.alerts(view, local, "here", "", NOW) == []

    def test_paused_stale_and_old_file_are_warnings(self):
        view, local = self.fine()
        view["paused"] = True
        view["stale"] = True
        local["at"] = NOW - 20 * 60_000
        found = desk.alerts(view, local, "here", "", NOW)
        assert [level for level, _ in found] == ["warn", "warn", "warn"]
        joined = " ".join(text for _, text in found)
        assert "20 minutes ago" in joined and "five minutes" in joined and "paused" in joined

    def test_too_little_rupiah_for_one_buy_is_said_only_with_no_coin(self):
        view, local = self.fine()
        view["report"]["cash"] = 9_856
        assert desk.alerts(view, local, "here", "", NOW) == [], "a coin is held: nothing more to buy anyway"
        view["report"]["positions"] = []
        found = desk.alerts(view, local, "here", "", NOW)
        assert len(found) == 1 and "Rp9.856" in found[0][1] and "Rp20.000" in found[0][1]

    def test_a_server_that_does_not_answer_is_said_with_its_reason(self):
        _, local = self.fine()
        found = desk.alerts(None, local, "here", "407 from the proxy", NOW)
        assert found == [("warn", found[0][1])] and "407 from the proxy" in found[0][1]

    def test_signal_rows_carry_the_checks_in_order(self):
        rows = desk.signal_rows(desk.demo_view(NOW))
        assert [row["coin"] for row in rows] == ["BTC", "ETH", "SOL"]
        assert rows[0]["action"] == "HOLD" and rows[0]["label"] == "HOLD: keep it"
        assert rows[1]["checks"] == [(True, "Trend", "price above the 200-candle average"), (False, "Momentum", "20-candle average below the 50-candle average"), (False, "RSI", "44 (weak: under 50)")]
        assert rows[0]["change"] == "+1,8% in 24 hours" and rows[1]["change"] == "−0,6% in 24 hours"

    def test_a_coin_without_a_fresh_price_is_a_question_mark(self):
        rows = desk.signal_rows({"signals": [{"coin": "btc", "error": "timeout"}]})
        assert rows == [{"coin": "BTC", "action": "?", "label": "no fresh price", "checks": [], "why": rows[0]["why"], "change": ""}]
        assert desk.signal_rows(None) == []

    def test_a_watched_only_coin_gets_one_quiet_line(self):
        rows = desk.signal_rows(desk.demo_view(NOW))
        assert desk.watched_only(rows[2]) == "watched only, not traded for you · ✓ Trend  ✗ Momentum  ✗ RSI"
        assert desk.watched_only({"checks": []}) == "watched only, not traded for you"

    def test_holding_rows_show_the_stop_price(self):
        rows = desk.holding_rows(desk.demo_view(NOW)["report"])
        assert rows == [("BTC", desk.clock_wib(NOW - 5 * 3600_000), "Rp20.000", "Rp20.306", "+1,5%", "Rp1.098.388.000")]
        assert desk.holding_rows({}) == []
        practice = desk.holding_rows({"positions": [{"symbol": "ETHUSDT", "real": False, "spent": 100, "value": 90}]})
        assert practice[0][0] == "ETH (practice)" and practice[0][4] == "−10,0%" and practice[0][5] == ""

    def test_history_is_newest_first_and_can_leave_practice_out(self):
        report = desk.demo_view(NOW)["report"]
        report["closed"].append({"symbol": "ETHUSDT", "real": False, "spent": 100, "received": 120, "boughtAt": NOW - 9000, "at": NOW - 100, "how": "sold", "estimated": True})
        report["closed"].append({"symbol": "SOLUSDT", "real": True, "spent": 100, "received": 0, "boughtAt": NOW - 9000, "at": NOW - 50, "how": "gone"})
        everything = desk.history_rows(report, False)
        assert [row[0] for row in everything] == ["SOL", "ETH (practice)", "BTC", "BTC"]
        assert everything[0][3:] == ("no longer in the account", "", "no result")
        assert everything[1][4] == "about Rp120" and everything[1][5].startswith("about +")
        real = desk.history_rows(report, True)
        assert [row[0] for row in real] == ["SOL", "BTC", "BTC"]
        assert real[1][5] == "+Rp730" and real[2][5] == "-Rp690", "the newest finished trade is on top"

    def test_market_rows_show_the_gap(self):
        assert desk.market_rows(desk.demo_view(NOW)["report"]) == [("BTC", "Rp1.214.900.000", "Rp1.214.500.000", "0,03%")], "the price to buy comes first, and it is the higher one"
        assert desk.market_rows({"market": [{"coin": "eth"}]}) == [("ETH", "Rp0", "Rp0", "")]

    def test_the_clock_is_wib(self):
        assert desk.clock_wib(0) == "" and desk.clock_wib(None) == ""
        assert desk.clock_wib(1_794_894_840_000) == "17 Nov 12:54"

    def test_the_next_line_is_taken_from_the_report_text(self):
        assert desk.next_line(desk.demo_view(NOW)).startswith("I judge each coin")
        assert desk.next_line({"text": "nothing here"}) == "" and desk.next_line(None) == ""

    def test_network_misses_are_counted_from_the_log(self):
        lines = ["12:00 report sent", "12:01 cycle failed: 407", "12:02 TradeBot could not be reached", "12:03 the ticker could not be read"]
        assert desk.failed_cycles(lines) == 3 and desk.failed_cycles([]) == 0

    def test_the_demo_is_real_looking_but_holds_nothing_private(self):
        view = desk.demo_view(NOW)
        text = json.dumps(view).lower()
        for word in ("key", "secret", "token", "@", "uid"):
            assert word not in text.replace('"keys"', ""), word
        shown = desk.tiles(view, None, NOW)
        assert shown["mode"] == "REAL MONEY" and shown["cash"] == "Rp30.450" and shown["result"] == "+Rp40"
        assert set(desk.DEMO_TRADED) < {row["coin"] for row in desk.signal_rows(view)}


    def test_plain_words_come_from_tradebot_and_bad_entries_are_dropped(self):
        words = desk.plain_words(desk.demo_view(NOW))
        assert [word for word, _ in words] == ["Candle", "Trend", "Momentum", "RSI", "Gap"]
        assert desk.plain_words({"words": [{"word": "RSI"}, "x", {"word": "A", "means": "b"}]}) == [("A", "b"), desk.GAP_WORDS]
        assert desk.plain_words(None) == []

    def test_the_demo_can_show_trouble(self):
        view = desk.demo_view(NOW, trouble=True)
        found = desk.alerts(view, None, "stopped", "", NOW)
        assert [level for level, _ in found] == ["bad", "warn"]
        assert view["stale"] and view["paused"]


    def test_a_window_reopened_quickly_waits_then_starts_its_sender(self):
        # A sender process elsewhere always blocks; a fresh file with no process only delays the start.
        assert desk.start_choice([1234], True) == "blocked" and desk.start_choice([1234], False) == "blocked"
        assert desk.start_choice([], True) == "wait"
        assert desk.start_choice([], False) == "start"

    def test_waiting_for_the_sender_is_said_once_and_not_as_stopped(self):
        local = {"at": NOW - 20_000, "report": {"mode": "real", "checked": True}}
        found = desk.alerts(None, local, "waiting", "", NOW)
        assert [level for level, _ in found] == ["warn"] and "starts by itself" in found[0][1]
        old = {"at": NOW - 900_000, "report": {"mode": "real", "checked": True}}
        assert len(desk.alerts(None, old, "waiting", "", NOW)) == 1

    # ---------------------------------------------------------------- the Study tab

    def study(self, **changes):
        learn = desk.demo_view(NOW)["report"]["learn"]
        learn.update(changes)
        return learn

    def test_the_study_tab_says_the_score_its_parts_and_what_holds_it_back(self):
        shown = desk.study_shown(self.study(), NOW)
        assert shown["total_text"] == "2,8" and shown["total"] == 2.8
        assert [(part["title"], part["text"]) for part in shown["parts"]] == [("Unseen prices", "1,2 of 3"), ("Steady years", "0,7 of 2"), ("Dips", "0,39 of 2"), ("Real money", "0,51 of 3")]
        assert shown["gap"].startswith("The biggest gap is real money: 2,49 of its 3 points are not earned yet.")
        assert "2 of 30 real trades finished" in shown["parts"][3]["means"]
        assert "64 of 100" in shown["parts"][1]["means"]
        assert "over 4 years of prices the rules had not seen" in shown["parts"][0]["means"]
        text = json.dumps(shown).lower()
        for word in ("will ", "guarantee", "win rate", "profit"):
            assert word not in text, word

    def test_the_parts_and_goals_are_the_ones_of_the_study(self):
        import learn

        assert {name: most for name, _, most in desk.SCORE_PARTS} == learn.SCORE_MOST
        assert desk.REAL_TRADES_GOAL == learn.REAL_TRADES_FULL
        assert (desk.WATCH_DAYS_GOAL, desk.WATCH_TRADES_GOAL) == (learn.REVIEW_DAYS, learn.REVIEW_TRADES)

    def test_a_score_outside_its_scale_is_held_inside(self):
        shown = desk.study_shown(self.study(score={"total": 44, "parts": {"unseen": 9, "steady": -3, "dips": "x"}, "realTrades": 99}), NOW)
        assert shown["total"] == 10
        assert [part["got"] for part in shown["parts"]] == [3, 0, 0, 0]
        assert shown["progress"][0]["count"] == "30 of 30"
        full = desk.study_shown(self.study(score={"total": 10, "parts": {"unseen": 3, "steady": 2, "dips": 2, "real": 3}, "realTrades": 30}), NOW)
        assert full["gap"] == "Every part has full marks."

    def test_the_curve_is_said_in_one_line(self):
        assert desk.study_shown(self.study(), NOW)["curve_text"].endswith("→ 2,8 now: +0,5 over 18 days with a study.")
        one = desk.study_shown(self.study(curve=[{"at": NOW, "score": 2.8}]), NOW)
        assert one["curve_text"].startswith("The curve starts today.") and one["trend"] == {"text": "first day on the curve", "way": 0}
        up = desk.study_shown(self.study(), NOW)["trend"]
        assert up["way"] == 1 and up["text"].startswith("▲ +0,5 since ")
        down = desk.study_shown(self.study(curve=[{"at": NOW - 86_400_000, "score": 3.5}, "x", {"at": 0, "score": 9}, {"at": NOW, "score": 2.8}]), NOW)
        assert "now: −0,7 over 2 days" in down["curve_text"] and len(down["curve"]) == 2
        assert down["trend"]["way"] == -1 and down["trend"]["text"].startswith("▼ −0,7 since ")
        same = desk.study_shown(self.study(curve=[{"at": NOW - 86_400_000, "score": 2.8}, {"at": NOW, "score": 2.8}]), NOW)
        assert "no change" in same["curve_text"] and same["trend"]["way"] == 0 and same["trend"]["text"].startswith("● no change since ")

    def test_progress_says_done_of_goal_and_the_watched_version_only_when_there_is_one(self):
        shown = desk.study_shown(self.study(), NOW)
        assert [(step["label"], step["count"]) for step in shown["progress"]] == [
            ("Real trades finished", "2 of 30"),
            ("Real cost measured", "2 of 5"),
            ("Trial setting: days watched", "18 of 90"),
            ("Trial setting: pretend trades", "2 of 8"),
        ]
        alone = desk.study_shown(self.study(challenger=None, verdict="keep"), NOW)
        assert len(alone["progress"]) == 2 and alone["verdict"].startswith("Keep the rules. They are also the best")
        assert all(step["text"] for step in shown["progress"])
        watch = shown["verdict"]
        assert "pretend trades, no money" in watch and not any(word in watch for word in ("RSI", "ATR", "30/80"))
        review = desk.study_shown(self.study(verdict="review"), NOW)
        assert review["verdict"].startswith("The trial setting has earned a review") and "Nothing changes by itself" in review["verdict"]

    def test_the_time_of_the_next_study_and_an_old_one_are_said(self):
        fresh = desk.study_shown(self.study(at=NOW - 3_600_000), NOW)
        assert not fresh["old"] and "Next one about" in fresh["when"] and "WIB" in fresh["when"]
        due = desk.study_shown(self.study(at=NOW - 5 * 3_600_000), NOW)
        assert not due["old"] and "next cycle" in due["when"]
        old = desk.study_shown(self.study(at=NOW - 13 * 3_600_000), NOW)
        assert old["old"] and "That is old" in old["when"]

    def test_no_study_or_a_sender_older_than_the_score_shows_nothing_made_up(self):
        assert desk.study_shown(None, NOW) is None
        assert desk.study_shown({"at": NOW, "verdict": "keep"}, NOW) is None
        assert desk.study_of({"report": {"learn": {"at": 0}}}, None) is None
        assert desk.study_of(None, {"report": {"learn": {"at": NOW}}}) == {"at": NOW}

    def test_the_chart_keeps_the_whole_scale_and_grows_from_the_left(self):
        day = desk.DAY_MS
        spots = desk.chart_points([(NOW, 0.0), (NOW + 7 * day, 5.0), (NOW + 14 * day, 10.0)], 330, 132, left=30, right=0, top=10, bottom=22)
        assert spots == [(30.0, 110.0), (180.0, 60.0), (330.0, 10.0)]
        # Three days of studies take three days of a chart that is two weeks wide: a small start is not stretched.
        short = desk.chart_points([(NOW, 2.0), (NOW + 3 * day, 2.2)], 330, 132, left=30, right=0, top=10, bottom=22)
        assert short[0] == (30.0, 90.0) and round(short[1][0]) == 94 and short[1][1] == 88.0
        assert desk.chart_points([(NOW, 2.0)], 330, 132)[0][0] == 30.0
        assert desk.chart_points([], 330, 132) == []

    def test_scores_are_said_the_indonesian_way(self):
        assert [desk.points_text(value) for value in (2.3, 1.28, 0, 10, 0.5)] == ["2,3", "1,28", "0", "10", "0,5"]

    # ---------------------------------------------------------------- one program (TradeBot.exe)

    def test_the_version_is_the_one_of_the_package(self):
        package = json.loads((Path(__file__).resolve().parent.parent / "package.json").read_text(encoding="utf-8"))
        assert desk.VERSION == package["version"]

    def test_a_newer_version_is_said_and_an_older_or_odd_one_is_not(self):
        with mock.patch.object(desk, "VERSION", "0.13.0"):
            assert desk.newer_version({"version": "0.13.1"}) == "0.13.1"
            assert desk.newer_version({"version": "0.14.0"}) == "0.14.0"
            assert desk.newer_version({"version": "0.13.0"}) == ""
            assert desk.newer_version({"version": "0.9.9"}) == ""
            assert desk.newer_version({"version": "next"}) == "" and desk.newer_version({}) == "" and desk.newer_version(None) == ""

    def test_the_one_file_app_starts_itself_as_the_sender_and_ends_the_whole_tree(self):
        tmp_path = self.folder()
        calls, ended = [], []

        def popen(command, **options):
            calls.append(command)
            return FakeProcess()

        with mock.patch.object(desk, "FROZEN", True), mock.patch.object(desk.sys, "executable", "C:/run/TradeBot.exe"):
            sender = desk.Sender(tmp_path, lambda line: None, popen=popen, end=ended.append)
            sender.start()
            assert calls == [["C:/run/TradeBot.exe", "--sender"]]
            sender.stop()
        assert ended == [4242] and not sender.process.terminated and not sender.wanted

    def test_the_tree_is_ended_with_taskkill(self):
        asked = []
        desk.end_tree(4242, run=lambda command, **options: asked.append(command))
        assert asked == [["taskkill", "/PID", "4242", "/T", "/F"]]

    def test_the_one_file_app_as_a_sender_counts_as_one(self):
        rows = [
            {"ProcessId": 11, "CommandLine": '"E:\\run\\TradeBot.exe" --sender'},
            {"ProcessId": 12, "CommandLine": '"E:\\run\\TradeBot.exe" --sender'},
            {"ProcessId": 13, "CommandLine": '"E:\\run\\TradeBot.exe"'},
            {"ProcessId": 14, "CommandLine": '"E:\\run\\TradeBot.exe" --study --env x'},
            {"ProcessId": 15, "CommandLine": "other.exe --sender"},
        ]
        assert desk.sender_candidates(rows) == [11, 12]

    def test_asked_to_be_the_sender_or_the_study_it_opens_no_window(self):
        with mock.patch.object(desk.bridge, "main", return_value=7) as sender, mock.patch.object(desk, "open_window") as window, mock.patch.object(desk, "output_for_the_window"):
            assert desk.main(["--sender", "--show"]) == 7
        sender.assert_called_once_with(["--show"])
        import learn

        with mock.patch.object(learn, "main", return_value=3) as study, mock.patch.object(desk, "open_window") as second:
            assert desk.main(["--study", "--env", "x"]) == 3
        study.assert_called_once_with(["--env", "x"])
        assert not window.called and not second.called


if __name__ == "__main__":
    unittest.main()
