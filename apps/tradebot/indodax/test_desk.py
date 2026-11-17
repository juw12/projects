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


if __name__ == "__main__":
    unittest.main()
