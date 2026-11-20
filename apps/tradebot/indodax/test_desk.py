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


    def test_the_phone_link_is_kept_in_the_folder_and_only_a_real_one_is_read(self):
        folder = self.folder()
        path = folder / desk.PHONE_NAME
        assert desk.read_phone(path) == ""
        link = "https://trade-bot.example/v1/indodax/phone?k=" + "ab12" * 12
        desk.save_phone(path, link)
        assert desk.read_phone(path) == link
        assert desk.phone_key(link) == "ab12" * 12
        assert [item.name for item in folder.iterdir()] == [desk.PHONE_NAME], "no half-written file is left"
        for wrong in ("{not json", json.dumps([link]), json.dumps({"link": "http://plain.example/v1/indodax/phone?k=abc"}), json.dumps({"link": "https://x.example/other?k=abc"}), json.dumps({"link": 7})):
            path.write_text(wrong, encoding="utf-8")
            assert desk.read_phone(path) == ""
        assert desk.phone_key("https://x.example/v1/indodax/phone") == ""

    def test_the_phone_calls_ask_about_a_link_or_for_a_new_one(self):
        folder = self.folder()
        env = folder / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=\n", encoding="utf-8")
        with self.assertRaises(desk.bridge.ApiError):
            desk.Server(env).phone_new()
        calls = []

        class Api:
            def _call(self, path, payload=None):
                calls.append((path, payload))
                return {"ok": True, "live": True} if "check" in payload else {"ok": True, "link": "https://trade-bot.example/v1/indodax/phone?k=" + "cd" * 24}

        server = desk.Server(env)
        server._api = Api
        assert server.phone_live("https://trade-bot.example/v1/indodax/phone?k=" + "ab" * 24) is True
        assert server.phone_new().endswith("cd" * 24)
        assert calls == [("/v1/indodax/phone-link", {"check": "ab" * 24}), ("/v1/indodax/phone-link", {"fresh": True})]
        assert server.phone_live("") is False and len(calls) == 2, "no link, nothing to ask"

        class Odd:
            def _call(self, path, payload=None):
                return {"ok": True, "link": "javascript:alert(1)"}

        server._api = Odd
        with self.assertRaises(desk.bridge.ApiError):
            server.phone_new()

    def test_the_qr_code_is_drawn_as_whole_pixels_with_a_light_edge(self):
        rows = [[True, False, True], [False, True, False], [True, True, True]]
        scale, edge, boxes = desk.qr_boxes(rows, 120)
        assert scale == 10, "3 modules and 4 light ones on each side: 11 across, 10 pixels each in 120"
        assert edge == (120 - 3 * 10) // 2
        assert len(boxes) == 6 and boxes[0] == (edge, edge, edge + 10, edge + 10)
        assert boxes[-1] == (edge + 20, edge + 20, edge + 30, edge + 30)
        link = "https://trade-bot.example/v1/indodax/phone?k=" + "ab12" * 12
        scale, edge, boxes = desk.qr_boxes(desk.qr.encode(link), desk.PHONE_QR_PIXELS)
        assert scale >= 5, "big enough for a phone camera at arm's length"
        assert edge >= 4 * scale, "the light edge a reader needs"

    def test_the_phone_window_says_what_to_do_in_each_state(self):
        said = desk.phone_words("", None, "", False)
        assert "no code yet" in said["note"].lower() and said["make"] == "Make the code" and not said["show"]
        said = desk.phone_words("link", None, "", True)
        assert "Asking" in said["note"] and not said["show"]
        said = desk.phone_words("link", True, "", False)
        assert said["show"] and said["make"] == "Make a new code"
        assert "Add to Home Screen" in said["steps"] and "nothing can be bought or sold" in said["steps"]
        said = desk.phone_words("link", False, "", False)
        assert not said["show"] and "no longer works" in said["note"]
        said = desk.phone_words("link", None, "TradeBot answered HTTP 502", False)
        assert said["show"], "a code that could not be checked is still shown"
        assert "could not be checked" in said["note"] and "HTTP 502" in said["note"]
        # A phone whose network blocks the address is told why, and the other way in.
        assert "HSTS" in said["steps"] and "blocks TradeBot's address" in said["steps"] and "through GitHub" in said["steps"]
        assert "any network" not in said["steps"], "that was not true: a network can block the address"

    COPY = '<!doctype html>\n<html lang="en"><head></head><body><main>\n<p class="copy">Copy made 19 Nov 08:10 WIB</p>\nREAL MONEY · Rp50.000\n</main></body></html>'

    def test_the_phone_page_is_written_to_a_file_whole_or_not_at_all(self):
        folder = self.folder()
        env = folder / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=\n", encoding="utf-8")
        target = folder / "phone_page.html"
        said = []
        # No key: nothing is written, and it says so in one line.
        assert desk.phone_file(target, desk.Server(env), say=said.append) == 1
        assert not target.exists() and len(said) == 1 and "was not renewed" in said[0] and "INDODAX_BRIDGE_KEY is empty" in said[0]

        calls = []
        answers = [{"ok": True, "page": self.COPY}]

        class Api:
            def _call(self, path, payload=None):
                calls.append((path, payload))
                answer = answers[0]
                if isinstance(answer, Exception):
                    raise answer
                return answer

        server = desk.Server(env)
        server._api = Api
        assert desk.phone_file(target, server, say=said.append) == 0
        assert calls == [("/v1/indodax/phone-copy", None)], "one read, and nothing is sent"
        assert target.read_text(encoding="utf-8") == self.COPY
        assert target.read_bytes().count(b"\r") == 0, "the same bytes on every PC, so an unchanged page is not sent again"
        assert sorted(item.name for item in folder.iterdir()) == [".env", "phone_page.html"], "no half-written file is left"
        assert "was written to" in said[-1] and str(target) in said[-1]
        assert "Rp50.000" not in "".join(said) and "REAL MONEY" not in "".join(said), "what the page says never reaches a log"

        # TradeBot cannot be reached, or answers with something that is not the copy: the file from before stays.
        for wrong in (
            desk.bridge.ApiError("TradeBot could not be reached (URLError, 3 tries)"),
            {"ok": True},
            {"ok": True, "page": ""},
            {"ok": True, "page": "<html>half"},
            {"ok": True, "page": self.COPY.replace('class="copy"', 'class="live"')},
            {"ok": True, "page": self.COPY[:-7]},
            {"ok": True, "page": ["<!doctype html>"]},
        ):
            answers[0] = wrong
            assert desk.phone_file(target, server, say=said.append) == 1, wrong
            assert "The file from before is kept" in said[-1]
            assert target.read_text(encoding="utf-8") == self.COPY

        # The disk says no: also one line, and the page from before stays.
        answers[0] = {"ok": True, "page": self.COPY.replace("08:10", "08:15")}

        def full(path, page):
            raise OSError("No space left on device")

        assert desk.phone_file(target, server, say=said.append, save=full) == 1
        assert "No space left" in said[-1] and target.read_text(encoding="utf-8") == self.COPY
        assert desk.phone_file(target, server, say=said.append) == 0
        assert "08:15" in target.read_text(encoding="utf-8")

    def test_phone_file_is_asked_for_by_argument_and_opens_no_window(self):
        folder = self.folder()
        (folder / ".env").write_text("INDODAX_BRIDGE_KEY=\n", encoding="utf-8")
        target = folder / "out" / "phone_page.html"
        seen = []

        def fake(path, server, **_):
            seen.append((path, server.env_path))
            return 0

        with mock.patch.object(desk, "phone_file", fake), mock.patch.object(desk, "open_window", side_effect=AssertionError("no window")), mock.patch.object(desk, "output_for_the_window"):
            assert desk.main(["--folder", str(folder), "--phone-file", str(target)]) == 0
        assert seen == [(target.resolve(), folder.resolve() / ".env")]

    def test_the_buttons_are_added_only_when_asked_and_the_page_stays_whole(self):
        folder = self.folder()
        env = folder / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=k\n", encoding="utf-8")
        target = folder / "phone_page.html"
        cards = self.COPY.replace("REAL MONEY", "<section><h2>Holding now</h2></section>\nREAL MONEY")

        class Api:
            def _call(self, path, payload=None):
                return {"ok": True, "page": cards}

        server = desk.Server(env)
        server._api = Api
        assert desk.phone_file(target, server, say=lambda line: None) == 0
        assert target.read_text(encoding="utf-8") == cards, "without --phone-buttons the page is TradeBot's own, to the byte"

        assert desk.phone_file(target, server, say=lambda line: None, buttons=True) == 0
        page = target.read_text(encoding="utf-8")
        assert desk.page_is_copy(page) and page.replace(desk.PHONE_BUTTONS, "") == cards, "the page around the buttons is not touched"
        assert page.index('id="pc"') < page.index("Holding now"), "the buttons sit above the first card"
        assert target.read_bytes().count(b"\r") == 0

        # A page without a card still gets them, inside the page.
        bare = desk.with_buttons(self.COPY)
        assert desk.page_is_copy(bare) and bare.index('id="pc"') < bare.index("</main>")

        # The buttons send two names and no others, to the page around this one and to nowhere else.
        block = desk.PHONE_BUTTONS
        import re

        assert sorted(re.findall(r'data-ask="([^"]*)"', block)) == sorted(desk.PHONE_ACTIONS) == ["pause", "resume"]
        assert 'cairnDash: "action"' in block and "window.parent.postMessage" in block
        for word in ("fetch(", "XMLHttpRequest", "<form", "http://", "https://", "localStorage", "document.cookie"):
            assert word not in block, word
        assert "never buy or sell" in block and "own rupiah" in block, "it says what the buttons do, and asks before buying is allowed"

    def test_a_button_from_the_phone_only_pauses_or_allows_buying(self):
        folder = self.folder()
        calls = []
        answers = [None]

        class Server:
            def pause(self, paused):
                calls.append(paused)
                if isinstance(answers[0], Exception):
                    raise answers[0]
                return {"ok": True, "paused": paused} if answers[0] is None else answers[0]

        def log():
            return (folder / desk.PHONE_ACTIONS_LOG).read_text(encoding="utf-8").splitlines()

        code, line = desk.phone_action(["pause"], Server(), folder)
        assert (code, calls) == (0, [True]) and line.startswith("Buying is paused")
        code, line = desk.phone_action(["resume"], Server(), folder)
        assert (code, calls) == (0, [True, False]) and line.startswith("Buying is allowed again")
        assert len(log()) == 2 and "'pause'" in log()[0] and "'resume'" in log()[1]

        # Every other name changes nothing: not a trade, not an option of the program, not a near miss.
        refused = (
            [], [""], ["buy"], ["sell"], ["sell btc_idr"], ["order"], ["Pause"], ["pause "], [" resume"], ["pause;resume"],
            ["pause", "resume"], ["--background"], ["on"], ["--sender"], ["--phone-file"], ["true"], ["0"], [None], ["x" * 600],
        )
        for names in refused:
            code, line = desk.phone_action(names, Server(), folder)
            assert code == 1 and "nothing was changed" in line, names
        assert calls == [True, False], "TradeBot was not asked for any of them"
        assert len(log()) == 2 + len(refused) and all(entry.endswith("refused") for entry in log()[2:])
        assert max(len(entry) for entry in log()) < 120, "a long name is cut short in the log"

        # TradeBot cannot be reached, or does not confirm: said in one line, and never called done.
        answers[0] = desk.bridge.ApiError("TradeBot could not be reached (URLError, 3 tries)")
        code, line = desk.phone_action(["pause"], Server(), folder)
        assert code == 1 and "was not changed" in line and "could not be reached" in line and "\n" not in line
        for wrong in ({"ok": True}, {"ok": True, "paused": False}, {"ok": True, "paused": "true"}, [], "paused"):
            answers[0] = wrong
            code, line = desk.phone_action(["pause"], Server(), folder)
            assert code == 1 and "did not confirm" in line, wrong

        # No key in .env: nothing is sent, and the phone is told why.
        env = folder / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=\n", encoding="utf-8")
        code, line = desk.phone_action(["pause"], desk.Server(env), folder)
        assert code == 1 and "INDODAX_BRIDGE_KEY is empty" in line

        # A log that cannot be written does not stop the answer.
        code, line = desk.phone_action(["buy"], Server(), folder / "missing" / "folder")
        assert code == 1 and "nothing was changed" in line

    def test_a_button_from_the_phone_is_never_read_as_an_option_and_opens_no_window(self):
        seen = []
        said = []

        def fake(names, server, folder):
            seen.append((names, server.env_path, folder))
            return (0, "Buying is paused.") if names == ["pause"] else (1, "nothing was changed")

        with mock.patch.object(desk, "phone_action", fake), mock.patch.object(desk, "open_window", side_effect=AssertionError("no window")), \
                mock.patch.object(desk, "set_background", side_effect=AssertionError("not an option")), mock.patch.object(desk, "output_for_the_window"), \
                mock.patch("builtins.print", lambda *words, **_: said.append(" ".join(map(str, words)))):
            assert desk.main(["--phone-action", "pause"]) == 0
            assert desk.main(["--phone-action", "--background", "on"]) == 1
            assert desk.main(["--phone-action", "--sender"]) == 1
            assert desk.main(["--phone-action"]) == 1
        assert [names for names, _, _ in seen] == [["pause"], ["--background", "on"], ["--sender"], []]
        assert all(env == desk.HERE / ".env" and folder == desk.HERE for _, env, folder in seen)
        assert said == ["Buying is paused.", "nothing was changed", "nothing was changed", "nothing was changed"], "one line each, for the phone"

        # --phone-buttons is passed on with --phone-file and is off without it.
        asked = []
        with mock.patch.object(desk, "phone_file", lambda path, server, **more: asked.append(more) or 0), mock.patch.object(desk, "output_for_the_window"):
            assert desk.main(["--phone-file", "page.html", "--phone-buttons"]) == 0
            assert desk.main(["--phone-file", "page.html"]) == 0
        assert asked == [{"buttons": True}, {"buttons": False}]


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
        assert rows == [{"coin": "BTC", "action": "?", "label": "no fresh price", "checks": [], "why": rows[0]["why"], "change": "", "soon": []}]
        assert desk.signal_rows(None) == []

    def test_signal_rows_carry_the_heads_up_with_its_colour(self):
        rows = desk.signal_rows(desk.demo_view(NOW))
        held, close, watched = rows
        assert [state for state, _ in held["soon"]] == ["wait", "wait"], "a sale that is far away is grey"
        assert held["soon"][0][1].startswith("Heads-up: no sale in sight.") and held["soon"][1][1].startswith("The sender's own stop")
        assert close["soon"][0] == ("warn", close["soon"][0][1]) and close["soon"][0][1].startswith("Heads-up: a buy is close.")
        assert close["soon"][1][0] == "wait", "only the first line carries the colour"
        assert watched["soon"] == [], "a signal without a heads-up shows none"

    def test_a_likely_buy_is_green_and_a_likely_sale_is_red(self):
        def row(kind):
            soon = {"kind": kind, "level": "likely", "at": NOW, "lines": ["🟢 Heads-up: it looks likely."]}
            return desk.signal_rows({"signals": [{"coin": "btc", "action": "WAIT", "checks": [], "soon": soon}]})[0]

        assert row("buy")["soon"] == [("yes", "Heads-up: it looks likely.")]
        assert row("sell")["soon"] == [("no", "Heads-up: it looks likely.")]
        assert set(state for state in ("yes", "no", "warn", "wait")) <= set(desk.STATE_COLOURS), "every colour has a dot"

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

    def test_the_newest_value_never_sits_on_the_numbers_of_the_scale(self):
        # Day one: the dot is on the left edge, where "0", "5" and "10" are written.
        first_x = desk.chart_points([(NOW, 2.3)], 330, 132)[0][0]
        assert desk.value_anchor(first_x, 330) == (40.0, "w")
        assert desk.value_anchor(49, 330) == (59, "w")
        assert desk.value_anchor(50, 330) == (50, "s")
        assert desk.value_anchor(180, 330) == (180, "s")
        assert desk.value_anchor(300, 330) == (300, "se")

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

    # ---------------------------------------------------------------- the sender with no window

    def windows(self, answers=None):
        """A pretend schtasks: it writes down what was asked and answers from {verb: (code, stdout, stderr)}."""
        asked = []

        def run(command, **options):
            assert command[0] == "schtasks" and command[2:4] == ["/tn", desk.TASK_NAME], command
            if "/xml" in command and command[1] == "/create":
                asked.append((command[1], Path(command[command.index("/xml") + 1]).read_text(encoding="utf-16")))
            else:
                asked.append((command[1], command[4:]))
            code, out, err = (answers or {}).get(command[1], (0, "SUCCESS", ""))
            return mock.Mock(returncode=code, stdout=out, stderr=err)

        return asked, run

    def test_the_window_shows_what_a_sender_with_no_window_wrote(self):
        path = self.folder() / "desk_sender.log"
        assert desk.log_news(path, 0) == ([], 0), "no file yet: nothing, and nothing lost"
        path.write_bytes(b"old line\n")
        _lines, seen = desk.log_news(path, -1)
        assert seen == 9, "a window that opens starts after what is already there"
        with path.open("ab") as handle:
            handle.write("12:00  bought BTC · Rp20.000\n12:01  half a li".encode())
        lines, seen = desk.log_news(path, seen)
        assert lines == ["12:00  bought BTC · Rp20.000"], "a line still being written waits for its end"
        with path.open("ab") as handle:
            handle.write(b"ne\n")
        lines, seen = desk.log_news(path, seen)
        assert lines == ["12:01  half a line"] and desk.log_news(path, seen) == ([], seen)
        path.write_bytes(b"a new file\n")  # the old one was set aside as .old.log
        assert desk.log_news(path, seen) == (["a new file"], 11)

    def test_the_task_starts_at_sign_in_looks_again_and_never_runs_twice(self):
        import xml.etree.ElementTree as tree

        text = desk.task_xml("C:\\Me & You\\TradeBot.exe", '--sender --log "C:\\Me & You\\desk_sender.log"', "C:\\Me & You", "PC\\me")
        space = "{http://schemas.microsoft.com/windows/2004/02/mit/task}"
        root = tree.fromstring(text.split("?>", 1)[1])
        found = {item.tag.replace(space, ""): (item.text or "").strip() for item in root.iter()}
        assert found["Command"] == "C:\\Me & You\\TradeBot.exe" and found["WorkingDirectory"] == "C:\\Me & You"
        assert found["Arguments"] == '--sender --log "C:\\Me & You\\desk_sender.log"'
        assert found["MultipleInstancesPolicy"] == "IgnoreNew", "a look while it runs must not start a second sender"
        assert found["ExecutionTimeLimit"] == "PT0S", "Windows must never end it for running long"
        assert found["DisallowStartIfOnBatteries"] == "false" and found["StopIfGoingOnBatteries"] == "false"
        assert found["Interval"] == f"PT{desk.TASK_MINUTES}M" and found["StopAtDurationEnd"] == "false"
        assert root.find(f"{space}Triggers/{space}LogonTrigger/{space}UserId").text == "PC\\me"
        assert "Enabled" not in found, "a new task is switched on"

    def test_the_sender_with_no_window_writes_its_own_log(self):
        folder = Path("C:/run")
        with mock.patch.object(desk, "FROZEN", True), mock.patch.object(desk.sys, "executable", "C:/run/TradeBot.exe"):
            assert desk.background_command(folder) == ("C:/run/TradeBot.exe", f'--sender --log "{folder / "desk_sender.log"}"')
        with mock.patch.object(desk, "FROZEN", False):
            command, arguments = desk.background_command(folder, python="C:/py/python.exe")
        assert Path(command) == Path("C:/py/pythonw.exe"), "python.exe would open a console window"
        assert arguments == f'-u "{folder / "bridge.py"}" --log "{folder / "desk_sender.log"}"'
        row = {"ProcessId": 21, "CommandLine": '"E:\\run\\TradeBot.exe" --sender --log "E:\\run\\desk_sender.log"'}
        assert desk.sender_candidates([row]) == [21], "it counts as a running sender"

    def test_windows_says_whether_it_keeps_the_sender(self):
        on = "<Task><Settings><ExecutionTimeLimit>PT0S</ExecutionTimeLimit></Settings><Triggers><TimeTrigger><Enabled>false</Enabled></TimeTrigger></Triggers></Task>"
        stopped = "<Task>\n<Settings>\n <Enabled>false</Enabled>\n</Settings>\n<Triggers></Triggers></Task>"
        assert desk.background_state(self.windows({"/query": (1, "", "ERROR: The system cannot find the file specified.")})[1]) == "off"
        assert desk.background_state(self.windows({"/query": (0, on, "")})[1]) == "on", "only the task's own switch counts"
        assert desk.background_state(self.windows({"/query": (0, stopped, "")})[1]) == "stopped"

        def broken(command, **options):
            raise OSError("no schtasks")

        assert desk.background_state(broken) == "off"

    def test_switching_it_on_makes_the_task_and_starts_it(self):
        folder = self.folder()
        asked, run = self.windows()
        assert desk.background_on(folder, run, user="PC\\me") == ""
        assert [verb for verb, _ in asked] == ["/create", "/run"]
        assert str(folder / "desk_sender.log") in asked[0][1] and "PC\\me" in asked[0][1]
        refused, run = self.windows({"/create": (1, "", "ERROR: Access is denied.")})
        assert desk.background_on(folder, run, user="PC\\me") == "ERROR: Access is denied."
        assert [verb for verb, _ in refused] == ["/create"], "nothing is started when Windows did not take the task"

    def test_stop_keeps_it_stopped_and_start_runs_it_again(self):
        asked, run = self.windows()
        assert desk.background_stop(run) == ""
        assert asked == [("/change", ["/disable"]), ("/end", [])], "switched off first, so Windows cannot start it again in between"
        asked, run = self.windows()
        assert desk.background_start(run) == ""
        assert asked == [("/change", ["/enable"]), ("/run", [])]
        asked, run = self.windows()
        assert desk.background_off(run) == ""
        assert asked == [("/end", []), ("/delete", ["/f"])]
        asked, run = self.windows({"/change": (1, "", "ERROR: Access is denied.")})
        assert desk.background_stop(run) == "ERROR: Access is denied." and len(asked) == 1

    def test_the_switch_from_a_script_writes_what_it_did(self):
        folder = self.folder()
        log = folder / "desk_sender.log"
        done = []
        on = lambda where: done.append(("on", where)) or ""  # noqa: E731
        off = lambda: done.append("off") or ""  # noqa: E731
        assert desk.set_background("on", folder, on=on, off=off, window=lambda: None) == 1
        assert done == [] and "the TradeBot window is open" in log.read_text(encoding="utf-8")
        holder = mock.Mock()
        assert desk.set_background("on", folder, on=on, off=off, window=lambda: holder) == 0
        holder.close.assert_called_once_with()
        assert done == [("on", folder)] and "runs in the background" in log.read_text(encoding="utf-8")
        assert desk.set_background("off", folder, on=on, off=off) == 0 and done[-1] == "off"
        assert desk.set_background("off", folder, on=on, off=lambda: "ERROR: no") == 1
        with mock.patch.object(desk, "set_background", return_value=0) as switch, mock.patch.object(desk, "open_window") as window:
            assert desk.main(["--background", "on", "--folder", str(folder)]) == 0
        switch.assert_called_once_with("on", folder.resolve())
        assert not window.called

    def test_a_sender_in_the_background_is_not_a_warning_and_a_starting_one_is_one(self):
        view, local = self.fine()
        assert desk.alerts(view, local, "background", "", NOW) == []
        old = {"at": NOW - 900_000, "report": view["report"]}
        found = desk.alerts(view, old, "starting", "", NOW)
        assert [level for level, _ in found] == ["warn"] and "Windows is starting the sender" in found[0][1]
        assert any("last finished cycle" in text for _level, text in desk.alerts(view, old, "background", "", NOW))


if __name__ == "__main__":
    unittest.main()
