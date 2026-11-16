"""Tests for the MetaTrader 5 bridge, with a pretend terminal and a pretend TradeBot server.

    python -m unittest          (in this folder; no MetaTrader 5 and no network needed)

The pretend terminal uses the numbers the real MetaTrader5 package documents for its constants.
It is still a stand-in: these tests show the bridge's own rules, not how a real broker answers.
"""

import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import bridge
from bridge import MAGIC, ApiError, Bridge, Refused, Settings, SettingsError


class FakeMt5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_CONTEST = 1
    ACCOUNT_TRADE_MODE_REAL = 2
    POSITION_TYPE_BUY = 0
    POSITION_TYPE_SELL = 1
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_SLTP = 6
    ORDER_TIME_GTC = 0
    ORDER_FILLING_FOK = 0
    ORDER_FILLING_IOC = 1
    ORDER_FILLING_RETURN = 2
    TRADE_RETCODE_DONE = 10009
    TRADE_RETCODE_REJECT = 10006
    SYMBOL_TRADE_MODE_DISABLED = 0
    SYMBOL_TRADE_MODE_FULL = 4

    def __init__(self):
        self.account = SimpleNamespace(
            trade_mode=self.ACCOUNT_TRADE_MODE_DEMO,
            trade_allowed=True,
            trade_expert=True,
            server="Pretend-Demo",
            currency="USD",
            leverage=100,
            balance=10000.0,
            equity=10000.0,
            login=123456,
            name="Someone",
        )
        self.terminal = SimpleNamespace(trade_allowed=True)
        self.symbols = {}
        self.ticks = {}
        self.positions = []
        self.sent = []
        self.retcode = self.TRADE_RETCODE_DONE
        self.next_ticket = 1000

    def add_symbol(self, name, bid, filling_mode=2, volume_min=0.01, digits=2, stops_level=100, trade_mode=None):
        self.symbols[name] = SimpleNamespace(
            name=name,
            visible=True,
            filling_mode=filling_mode,
            volume_min=volume_min,
            digits=digits,
            point=10**-digits,
            trade_stops_level=stops_level,
            trade_mode=self.SYMBOL_TRADE_MODE_FULL if trade_mode is None else trade_mode,
        )
        self.ticks[name] = SimpleNamespace(bid=bid, ask=bid + 10 * 10**-digits)

    def add_position(self, symbol, magic=MAGIC, kind=None, sl=0.0, volume=0.01):
        self.next_ticket += 1
        position = SimpleNamespace(
            ticket=self.next_ticket,
            symbol=symbol,
            magic=magic,
            type=self.POSITION_TYPE_BUY if kind is None else kind,
            volume=volume,
            price_open=self.ticks[symbol].ask,
            price_current=self.ticks[symbol].bid,
            sl=sl,
            tp=0.0,
            profit=0.0,
        )
        self.positions.append(position)
        return position

    # ---- what the bridge calls

    def account_info(self):
        return self.account

    def terminal_info(self):
        return self.terminal

    def positions_get(self):
        return tuple(self.positions)

    def symbol_info(self, name):
        return self.symbols.get(name)

    def symbol_info_tick(self, name):
        return self.ticks.get(name)

    def symbol_select(self, name, enable):
        return True

    def last_error(self):
        return (1, "Success")

    def order_send(self, request):
        self.sent.append(dict(request))
        if self.retcode != self.TRADE_RETCODE_DONE:
            return SimpleNamespace(retcode=self.retcode, comment="Rejected")
        if request["action"] == self.TRADE_ACTION_DEAL and "position" in request:
            self.positions = [item for item in self.positions if item.ticket != request["position"]]
        elif request["action"] == self.TRADE_ACTION_DEAL:
            self.add_position(request["symbol"], magic=request["magic"], volume=request["volume"])
        elif request["action"] == self.TRADE_ACTION_SLTP:
            for item in self.positions:
                if item.ticket == request["position"]:
                    item.sl = request["sl"]
        return SimpleNamespace(retcode=self.TRADE_RETCODE_DONE, comment="Done")

    # ---- reading the orders back in the tests

    def deals(self):
        return [item for item in self.sent if item["action"] == self.TRADE_ACTION_DEAL]

    def stops(self):
        return [item for item in self.sent if item["action"] == self.TRADE_ACTION_SLTP]


class FakeApi:
    def __init__(self, answer=None, error=None):
        self.answer = answer
        self.error = error
        self.reports = []

    def signals(self):
        if self.error:
            raise ApiError(self.error)
        return self.answer

    def report(self, payload):
        self.reports.append(payload)
        return {"ok": True}


def signals(*items, fresh=True):
    """signals(("BTCUSDT", 1, 95000)) -> what GET /v1/mt5/signals answers."""
    wanted = [{"symbol": symbol, "openedAt": opened, "stop": stop} for symbol, opened, stop in items]
    return {"at": 1, "lastRoundAt": 1, "fresh": fresh, "wanted": wanted}


class BridgeCase(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.state_path = Path(folder.name) / "bridge_state.json"
        self.mt5 = FakeMt5()
        self.mt5.add_symbol("BTCUSD", bid=100000.0)
        self.mt5.add_symbol("ETHUSD", bid=3000.0)
        self.mt5.add_symbol("SOLUSD", bid=150.0)
        self.api = FakeApi(signals())
        self.lines = []

    def bridge(self, **settings):
        return Bridge(self.mt5, Settings(key="k", **settings), self.api, self.state_path, log=self.lines.append, clock=lambda: 1700000000)

    def log(self):
        return "\n".join(self.lines)


class Buying(BridgeCase):
    def test_buys_the_smallest_lot_and_sets_the_stop_in_the_same_cycle(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        report = self.bridge().cycle()

        (deal,) = self.mt5.deals()
        self.assertEqual(deal["symbol"], "BTCUSD")
        self.assertEqual(deal["type"], FakeMt5.ORDER_TYPE_BUY)
        self.assertEqual(deal["volume"], 0.01)
        self.assertEqual(deal["price"], self.mt5.ticks["BTCUSD"].ask)
        self.assertEqual(deal["magic"], MAGIC)
        self.assertEqual(deal["type_filling"], FakeMt5.ORDER_FILLING_IOC)
        self.assertNotIn("position", deal)

        (stop,) = self.mt5.stops()
        self.assertEqual(stop["sl"], 95000)
        self.assertEqual(stop["position"], self.mt5.positions[0].ticket)

        self.assertEqual(self.api.reports, [report])
        self.assertTrue(report["demo"])
        self.assertTrue(report["tradeAllowed"])
        (position,) = report["positions"]
        self.assertEqual(position["symbol"], "BTCUSDT")
        self.assertEqual(position["brokerSymbol"], "BTCUSD")
        self.assertEqual(position["stop"], 95000)
        self.assertEqual(position["openedAt"], 1700000000000)

        saved = json.loads(self.state_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["bought"]["BTCUSDT"]["signal"], 111)

    def test_the_report_never_carries_the_login_or_the_name(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        text = json.dumps(self.bridge().cycle())
        self.assertNotIn("123456", text)
        self.assertNotIn("Someone", text)

    def test_the_fill_rule_follows_what_the_symbol_accepts(self):
        runner = self.bridge()
        self.assertEqual(runner.filling(SimpleNamespace(filling_mode=1)), FakeMt5.ORDER_FILLING_FOK)
        self.assertEqual(runner.filling(SimpleNamespace(filling_mode=3)), FakeMt5.ORDER_FILLING_FOK)
        self.assertEqual(runner.filling(SimpleNamespace(filling_mode=2)), FakeMt5.ORDER_FILLING_IOC)
        self.assertEqual(runner.filling(SimpleNamespace(filling_mode=0)), FakeMt5.ORDER_FILLING_RETURN)

    def test_a_second_cycle_does_not_buy_again(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        runner = self.bridge()
        runner.cycle()
        runner.cycle()
        self.assertEqual(len(self.mt5.deals()), 1)
        self.assertEqual(len(self.mt5.stops()), 1)

    def test_the_cap_limits_how_many_copies_are_open(self):
        self.api.answer = signals(("BTCUSDT", 1, 0), ("ETHUSDT", 2, 0), ("SOLUSDT", 3, 0))
        report = self.bridge(max_open=2).cycle()
        self.assertEqual([deal["symbol"] for deal in self.mt5.deals()], ["BTCUSD", "ETHUSD"])
        self.assertIn("SOLUSD is not copied", " ".join(report["notes"]))

    def test_a_symbol_the_broker_does_not_offer_is_skipped(self):
        self.api.answer = signals(("DOGEUSDT", 1, 0))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertIn("DOGEUSD is not offered", " ".join(report["notes"]))

    def test_a_symbol_that_is_not_freely_tradable_is_skipped(self):
        self.mt5.add_symbol("XRPUSD", bid=2.0, trade_mode=FakeMt5.SYMBOL_TRADE_MODE_DISABLED)
        self.api.answer = signals(("XRPUSDT", 1, 0))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertIn("XRPUSD cannot be traded", " ".join(report["notes"]))

    def test_the_symbol_map_and_the_suffix_pick_the_broker_name(self):
        self.mt5.add_symbol("Bitcoin", bid=100000.0)
        self.mt5.add_symbol("ETHUSD.m", bid=3000.0)
        self.api.answer = signals(("BTCUSDT", 1, 0), ("ETHUSDT", 2, 0))
        report = self.bridge(symbols={"BTCUSDT": "Bitcoin"}, suffix=".m").cycle()
        self.assertEqual([deal["symbol"] for deal in self.mt5.deals()], ["Bitcoin", "ETHUSD.m"])
        self.assertEqual(sorted(item["symbol"] for item in report["positions"]), ["BTCUSDT", "ETHUSDT"])

    def test_a_rejected_order_is_not_remembered_as_bought(self):
        self.mt5.retcode = FakeMt5.TRADE_RETCODE_REJECT
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        runner = self.bridge()
        report = runner.cycle()
        self.assertEqual(len(self.mt5.sent), 1)
        self.assertEqual(self.mt5.positions, [])
        self.assertEqual(runner.state["bought"], {})
        self.assertFalse(self.state_path.exists())
        self.assertIn("buy did not happen", " ".join(report["notes"]))

        # The broker accepts it a minute later: the same signal is tried again.
        self.mt5.retcode = FakeMt5.TRADE_RETCODE_DONE
        runner.cycle()
        self.assertEqual(len(self.mt5.positions), 1)


class NotBuyingTwice(BridgeCase):
    def test_a_copy_closed_on_the_mt5_side_is_not_bought_again_for_the_same_signal(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        runner = self.bridge()
        runner.cycle()
        self.mt5.positions.clear()  # the broker's stop took it out

        report = runner.cycle()
        self.assertEqual(len(self.mt5.deals()), 1)
        self.assertIn("not bought again", " ".join(report["notes"]))

    def test_the_memory_survives_a_restart(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        self.bridge().cycle()
        self.mt5.positions.clear()
        self.bridge().cycle()
        self.assertEqual(len(self.mt5.deals()), 1)

    def test_a_new_signal_for_the_same_coin_is_bought(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        runner = self.bridge()
        runner.cycle()
        self.mt5.positions.clear()

        self.api.answer = signals(("BTCUSDT", 222, 96000))
        runner.cycle()
        self.assertEqual(len(self.mt5.deals()), 2)
        self.assertEqual(runner.state["bought"]["BTCUSDT"]["signal"], 222)

    def test_the_memory_is_dropped_once_the_practice_account_sold(self):
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        runner = self.bridge()
        runner.cycle()
        self.api.answer = signals()
        runner.cycle()
        self.assertEqual(runner.state["bought"], {})
        self.assertEqual(json.loads(self.state_path.read_text(encoding="utf-8")), {"bought": {}})


class Closing(BridgeCase):
    def test_closes_only_its_own_positions(self):
        own = self.mt5.add_position("BTCUSD")
        by_hand = self.mt5.add_position("ETHUSD", magic=0)
        other_robot = self.mt5.add_position("SOLUSD", magic=777)
        own_mark_but_a_sell = self.mt5.add_position("ETHUSD", kind=FakeMt5.POSITION_TYPE_SELL)

        report = self.bridge().cycle()

        (deal,) = self.mt5.deals()
        self.assertEqual(deal["position"], own.ticket)
        self.assertEqual(deal["type"], FakeMt5.ORDER_TYPE_SELL)
        self.assertEqual(deal["price"], self.mt5.ticks["BTCUSD"].bid)
        self.assertEqual(deal["volume"], 0.01)
        self.assertEqual(self.mt5.positions, [by_hand, other_robot, own_mark_but_a_sell])
        self.assertEqual(report["positions"], [])

    def test_a_held_coin_that_is_still_wanted_stays(self):
        self.mt5.add_position("BTCUSD")
        self.api.answer = signals(("BTCUSDT", 111, 0))
        self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])

    def test_a_position_that_is_no_longer_the_bridges_is_not_closed(self):
        own = self.mt5.add_position("BTCUSD")
        runner = self.bridge()
        actions, _ = runner.plan(signals())
        own.magic = 0
        with self.assertRaises(Refused):
            runner.do(actions[0])
        self.assertEqual(self.mt5.sent, [])


class Stops(BridgeCase):
    def test_a_stop_is_raised(self):
        position = self.mt5.add_position("BTCUSD", sl=94000.0)
        self.api.answer = signals(("BTCUSDT", 111, 95000.129))
        self.bridge().cycle()
        (stop,) = self.mt5.stops()
        self.assertEqual(stop["sl"], 95000.13)
        self.assertEqual(stop["magic"], MAGIC)
        self.assertEqual(position.sl, 95000.13)

    def test_a_stop_is_never_lowered(self):
        self.mt5.add_position("BTCUSD", sl=96000.0)
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])

    def test_the_same_stop_is_not_sent_again(self):
        self.mt5.add_position("BTCUSD", sl=95000.0)
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])

    def test_a_stop_too_near_the_price_is_left_alone(self):
        self.mt5.add_position("BTCUSD")
        # The broker wants 100 points (1.00) of room under the bid of 100000.
        self.api.answer = signals(("BTCUSDT", 111, 99999.5))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertIn("too near the price", " ".join(report["notes"]))

    def test_another_robots_position_gets_no_stop(self):
        self.mt5.add_position("BTCUSD", magic=777)
        self.mt5.add_position("ETHUSD")
        self.api.answer = signals(("BTCUSDT", 1, 95000), ("ETHUSDT", 2, 2800))
        self.bridge(max_open=1).cycle()
        self.assertEqual([stop["symbol"] for stop in self.mt5.stops()], ["ETHUSD"])


class Guards(BridgeCase):
    def test_a_real_account_gets_no_orders_and_a_report_without_money(self):
        self.mt5.account.trade_mode = FakeMt5.ACCOUNT_TRADE_MODE_REAL
        self.mt5.add_position("ETHUSD")
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(sorted(report), ["demo", "loggedIn", "notes", "server"])
        self.assertFalse(report["demo"])
        self.assertIn("not a demo account", " ".join(report["notes"]))
        self.assertEqual(self.api.reports, [report])

    def test_a_contest_account_gets_no_orders(self):
        self.mt5.account.trade_mode = FakeMt5.ACCOUNT_TRADE_MODE_CONTEST
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertNotIn("balance", report)

    def test_no_account_means_no_orders(self):
        self.mt5.account = None
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(report["loggedIn"], False)

    def test_algo_trading_switched_off_means_no_orders(self):
        self.mt5.terminal.trade_allowed = False
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertFalse(report["tradeAllowed"])
        self.assertIn("Algo Trading is switched off", " ".join(report["notes"]))

    def test_an_account_that_forbids_robots_means_no_orders(self):
        for field in ("trade_allowed", "trade_expert"):
            with self.subTest(field=field):
                self.mt5.account.trade_allowed = True
                self.mt5.account.trade_expert = True
                setattr(self.mt5.account, field, False)
                self.api.answer = signals(("BTCUSDT", 111, 95000))
                report = self.bridge().cycle()
                self.assertEqual(self.mt5.sent, [])
                self.assertFalse(report["tradeAllowed"])

    def test_the_account_turning_real_after_the_plan_stops_every_order(self):
        self.mt5.add_position("ETHUSD")
        runner = self.bridge()
        actions, notes = runner.plan(signals(("BTCUSDT", 111, 95000)))
        self.assertEqual([action["do"] for action in actions], ["close", "buy"])

        self.mt5.account.trade_mode = FakeMt5.ACCOUNT_TRADE_MODE_REAL
        for action in actions:
            with self.assertRaises(Refused):
                runner.do(action)
        runner._run(actions, notes)
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(runner.state["bought"], {})
        self.assertEqual(len(notes), 2)

    def test_an_order_without_the_bridges_mark_is_stopped(self):
        runner = self.bridge()
        request = runner._market("BTCUSD", 0.01, "buy")
        request["magic"] = 0
        with self.assertRaises(Refused):
            runner.send(request)
        self.assertEqual(self.mt5.sent, [])

    def test_old_signals_mean_hold(self):
        self.mt5.add_position("ETHUSD")
        self.api.answer = signals(("BTCUSDT", 111, 95000), fresh=False)
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(len(report["positions"]), 1)
        self.assertIn("too old", " ".join(report["notes"]))

    def test_unreadable_signals_mean_hold_and_the_report_still_goes(self):
        self.mt5.add_position("ETHUSD")
        self.api.error = "TradeBot answered HTTP 500"
        report = self.bridge().cycle()
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(self.api.reports, [report])
        self.assertIn("Holding", " ".join(report["notes"]))


class Showing(BridgeCase):
    def test_show_sends_no_order_and_no_report(self):
        self.mt5.add_position("ETHUSD")
        self.api.answer = signals(("BTCUSDT", 111, 95000))
        runner = self.bridge()
        runner.cycle(show=True)
        self.assertEqual(self.mt5.sent, [])
        self.assertEqual(self.api.reports, [])
        self.assertEqual(runner.state["bought"], {})
        self.assertFalse(self.state_path.exists())
        self.assertIn("Would do: ", self.log())
        self.assertIn('"do": "buy"', self.log())
        self.assertIn('"do": "close"', self.log())
        self.assertIn("Would report: ", self.log())


class SettingsCase(unittest.TestCase):
    def test_defaults(self):
        settings = bridge.settings_from({})
        self.assertEqual(settings.key, "")
        self.assertEqual(settings.url, bridge.DEFAULT_URL)
        self.assertEqual(settings.max_open, 3)
        self.assertEqual(settings.broker_symbol("BTCUSDT"), "BTCUSD")

    def test_the_map_and_the_suffix(self):
        settings = bridge.settings_from({"MT5_SYMBOLS": " btcusdt = Bitcoin , ETHUSDT=ETHUSD.x ,", "MT5_SYMBOL_SUFFIX": ".m"})
        self.assertEqual(settings.broker_symbol("BTCUSDT"), "Bitcoin")
        self.assertEqual(settings.broker_symbol("ETHUSDT"), "ETHUSD.x")
        self.assertEqual(settings.broker_symbol("SOLUSDT"), "SOLUSD.m")

    def test_a_bad_map_is_named(self):
        for text in ("BTCUSDT", "BTCUSDT=", "=BTCUSD"):
            with self.subTest(text=text), self.assertRaises(SettingsError):
                bridge.settings_from({"MT5_SYMBOLS": text})

    def test_only_https(self):
        with self.assertRaises(SettingsError):
            bridge.settings_from({"MT5_BRIDGE_URL": "http://trade-bot.example"})
        self.assertEqual(bridge.settings_from({"MT5_BRIDGE_URL": "https://trade-bot.example/"}).url, "https://trade-bot.example")

    def test_the_cap_is_kept_between_one_and_ten(self):
        self.assertEqual(bridge.settings_from({"MT5_MAX_OPEN": "0"}).max_open, 1)
        self.assertEqual(bridge.settings_from({"MT5_MAX_OPEN": "99"}).max_open, 10)
        with self.assertRaises(SettingsError):
            bridge.settings_from({"MT5_MAX_OPEN": "many"})

    def test_the_env_file_and_the_environment_on_top(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            path.write_text('# a comment\n\nMT5_BRIDGE_KEY = "from-file"\nMT5_MAX_OPEN=2\nOTHER=1\n', encoding="utf-8")
            self.assertEqual(bridge.load_settings(path, environ={}).key, "from-file")
            layered = bridge.load_settings(path, environ={"MT5_BRIDGE_KEY": "from-environment", "HTTPS_PROXY": "http://localhost:3128", "PATH": "x"})
            self.assertEqual(layered.key, "from-environment")
            self.assertEqual(layered.max_open, 2)
            self.assertEqual(layered.proxy, "http://localhost:3128")
            self.assertEqual(bridge.load_settings(Path(folder) / "missing.env", environ={}).key, "")

    def test_a_broken_state_file_starts_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "bridge_state.json"
            path.write_text("not json", encoding="utf-8")
            self.assertEqual(bridge.load_state(path), {"bought": {}})
            path.write_text('{"bought": []}', encoding="utf-8")
            self.assertEqual(bridge.load_state(path), {"bought": {}})


class RaisingOpener:
    def __init__(self, error):
        self.error = error

    def open(self, request, timeout=None):
        raise self.error


class ApiCase(unittest.TestCase):
    KEY = "the-bridge-key-must-stay-out-of-messages"

    def api(self, error):
        api = bridge.Api(Settings(key=self.KEY))
        api.opener = RaisingOpener(error)
        return api

    def test_a_refused_key_gives_a_hint_without_the_key(self):
        refused = urllib.error.HTTPError(f"https://x/?k={self.KEY}", 403, "Forbidden", {}, io.BytesIO(b""))
        with self.assertRaises(ApiError) as caught:
            self.api(refused).signals()
        self.assertIn("403", str(caught.exception))
        self.assertIn("MT5_BRIDGE_KEY", str(caught.exception))
        self.assertNotIn(self.KEY, str(caught.exception))

    def test_a_network_problem_names_only_its_kind(self):
        with self.assertRaises(ApiError) as caught:
            self.api(urllib.error.URLError(f"no route with {self.KEY}")).report({"loggedIn": True})
        self.assertIn("URLError", str(caught.exception))
        self.assertNotIn(self.KEY, str(caught.exception))


class MainCase(unittest.TestCase):
    def run_main(self, env_text):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / ".env"
            if env_text is not None:
                path.write_text(env_text, encoding="utf-8")
            printed = io.StringIO()
            with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(printed):
                with mock.patch.object(bridge, "load_mt5", side_effect=AssertionError("MetaTrader 5 must not be loaded")):
                    code = bridge.main(["--env", str(path)])
            return code, printed.getvalue()

    def test_without_a_key_it_is_off_and_never_touches_metatrader(self):
        for env_text in (None, "", "MT5_BRIDGE_KEY=\n"):
            with self.subTest(env_text=env_text):
                code, printed = self.run_main(env_text)
                self.assertEqual(code, 0)
                self.assertIn("The MT5 bridge is off", printed)

    def test_bad_settings_stop_it_before_metatrader(self):
        code, printed = self.run_main("MT5_BRIDGE_KEY=k\nMT5_BRIDGE_URL=http://plain.example\n")
        self.assertEqual(code, 2)
        self.assertIn("https://", printed)
        self.assertNotIn("MT5_BRIDGE_KEY=k", printed)


if __name__ == "__main__":
    unittest.main()
