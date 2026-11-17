"""Tests for the parts of desk.py that need no window. Run: python -m unittest (in this folder)."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
