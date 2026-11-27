"""Tests for the Indodax sender. They use a pretend exchange: nothing here reaches Indodax.

    python -m unittest          (in this folder)
"""

import contextlib
import http.client
import io
import json
import os
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from unittest import mock

import bridge

BTC, ETH, DOGE = "BTCUSDT", "ETHUSDT", "DOGEUSDT"
SIGNAL = 1_763_000_000_000
START = 1_763_272_800.0  # 2025-11-16 06:00 UTC
OWNER_NAME = "Private Person"
OWNER_EMAIL = "private.person@example.com"
OWNER_ADDRESS = "bc1qprivateaddress"
# The names the sender gives its own orders for the BTC signal used in these tests.
BUY_NAME = f"tb-btc-{SIGNAL}-b"
SELL_NAME = f"tb-btc-{SIGNAL}-s0"
SELL_AGAIN = f"tb-btc-{SIGNAL}-s1"
LOST = "Indodax could not be reached (TimeoutError)"


def pair(coin, minimum=10_000, fee=0.2, blocked=False):
    return {
        "coin": coin,
        "id": coin + "idr",
        "ticker_id": coin + "_idr",
        "min_idr": float(minimum),
        "min_coin": 0.0,
        "fee_percent": fee,
        "increment": "0.00000001",
        "blocked": blocked,
    }


class Clock:
    def __init__(self, now=START):
        self.now = now

    def __call__(self):
        return self.now


class FakeExchange:
    """Indodax as the sender sees it: pairs, prices, free balances and market orders."""

    def __init__(self):
        self.pair_list = {"btc": pair("btc"), "eth": pair("eth"), "doge": pair("doge")}
        self.tickers = {
            "btcidr": {"bid": 1_000_000_000.0, "ask": 1_001_000_000.0},
            "ethidr": {"bid": 50_000_000.0, "ask": 50_050_000.0},
            "dogeidr": {"bid": 3_000.0, "ask": 3_010.0},
        }
        self.free = {"idr": 1_000_000.0}
        self.orders = []
        self.balance_calls = 0
        self.pairs_error = None
        self.balance_errors = []  # one entry per coming call; None means the call works
        self.known = {}  # order name -> what Indodax would say became of that order
        self.lookups = []
        self.on_trade = self.fill

    def pairs(self):
        if self.pairs_error:
            raise self.pairs_error
        return self.pair_list

    def ticker(self, pair_id):
        if pair_id not in self.tickers:
            raise bridge.ExchangeError("Indodax gave no price")
        return dict(self.tickers[pair_id])

    def balances(self):
        self.balance_calls += 1
        error = self.balance_errors.pop(0) if self.balance_errors else None
        if error:
            raise error
        return dict(self.free)

    def trade(self, ticker_id, side, idr=None, coin="", quantity="", client_order_id=""):
        order = {"pair": ticker_id, "side": side, "idr": idr, "coin": coin, "quantity": quantity, "name": client_order_id}
        self.orders.append(order)
        return self.on_trade(order)

    def order(self, name):
        """Without an entry in `known` Indodax has no clear word, as before this lookup existed."""
        self.lookups.append(name)
        if name not in self.known:
            raise bridge.ExchangeError("Order not found")
        return dict(self.known[name])

    def fill(self, order):
        coin = order["pair"].split("_")[0]
        ticker = self.tickers[coin + "idr"]
        if order["side"] == "buy":
            got = order["idr"] * 0.998 / ticker["ask"]
            self.free["idr"] -= order["idr"]
            self.free[coin] = self.free.get(coin, 0.0) + got
            return {f"receive_{coin}": f"{got:.8f}", "spend_rp": order["idr"], "fee": 0, "remain_rp": 0}
        got = float(order["quantity"]) * ticker["bid"] * 0.998
        self.free[coin] = self.free.get(coin, 0.0) - float(order["quantity"])
        self.free["idr"] += got
        return {"receive_rp": round(got), "fee": 0}

    def fill_then_lose_answer(self, order):
        self.fill(order)
        raise bridge.ExchangeError("Indodax could not be reached (TimeoutError)", unsure=True)

    def lose(self, order):
        raise bridge.ExchangeError("Indodax could not be reached (TimeoutError)", unsure=True)

    def refuse(self, order):
        raise bridge.ExchangeError("Insufficient balance.", code="insufficient_balance")

    def never_leave(self, order):
        """The proxy refused before any connection to Indodax existed: the order was not sent."""
        raise bridge.ExchangeError("Indodax could not be reached (URLError, the proxy answered 407)", unsent=True)


class FakeApi:
    def __init__(self, *symbols):
        self.answer = {"fresh": True, "wanted": [{"symbol": symbol, "openedAt": SIGNAL, "stop": 0} for symbol in symbols]}
        self.error = None
        self.reports = []

    def hold(self, *symbols, signal=SIGNAL):
        self.answer = {"fresh": True, "wanted": [{"symbol": symbol, "openedAt": signal, "stop": 0} for symbol in symbols]}

    def pause(self, paused=True):
        self.answer = {**self.answer, "paused": paused}

    def signals(self):
        if self.error:
            raise bridge.ApiError(self.error)
        return self.answer

    def report(self, payload):
        self.reports.append(payload)
        return {"ok": True}


class Case(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.state_path = Path(self.folder.name) / "bridge_state.json"
        self.clock = Clock()
        self.logs = []

    def settings(self, real=False, **changes):
        values = {"key": "bridge-key", "order_idr": 50_000, "max_open": 2, "stop_percent": 8.0}
        if real:
            values.update(mode="real", confirmed=True, api_key="API-KEY-VALUE", api_secret="API-SECRET-VALUE")
        values.update(changes)
        return bridge.Settings(**values)

    def make(self, *symbols, real=False, exchange=None, api=None, checked=True, **changes):
        self.exchange = exchange or FakeExchange()
        self.api = api or FakeApi(*symbols)
        self.bridge = bridge.Bridge(self.exchange, self.settings(real, **changes), self.api, self.state_path, log=self.logs.append, clock=self.clock)
        if real and checked:
            # As if  python bridge.py --check  had passed with this API key.
            self.bridge.state["checked"] = {"at": int(START), "key": bridge.key_mark(self.bridge.settings.api_key)}
        return self.bridge

    def stored(self):
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def text(self):
        return "\n".join(self.logs)


# ---------------------------------------------------------------- helpers and settings


class Helpers(unittest.TestCase):
    def test_signature_matches_the_example_in_indodax_docs(self):
        body = "method=getInfo&timestamp=1578304294000&recvWindow=1578303937000"
        secret = "f60617a68fcce028f0a90bc9eb765d17379eb548cc935c01a7ee3186eecf870e9b68f27a31bcfe8d"
        expected = "bab004e5a518740d7a33b38b44dbebecd3fb39f40b42391af39fcce06edabff5233b3e8064a07c528d1c751a6923d5116026c7786e01b22e2d35277a098cae99"
        self.assertEqual(bridge.sign(body, secret), expected)

    def test_coin_amounts_are_rounded_down_and_never_scientific(self):
        self.assertEqual(bridge.plain(bridge.floor_to(0.0000123456789, "0.00000001")), "0.00001234")
        self.assertEqual(bridge.plain(bridge.floor_to(0.0000123456789, 1e-08)), "0.00001234")
        self.assertEqual(bridge.plain(bridge.floor_to(12.999, "1")), "12")
        self.assertEqual(bridge.floor_to(-1, "0.01"), 0)
        self.assertEqual(bridge.floor_to("nonsense", "0.01"), 0)
        self.assertEqual(bridge.plain(bridge.floor_to(0.5, "nonsense")), "0.5")  # falls back to the smallest step
        self.assertEqual(bridge.plain(bridge.floor_to(0.123456789, 0)), "0.12345678")

    def test_order_names_fit_indodax_rules(self):
        name = bridge.order_name("a-very-long-coin-name!!", SIGNAL, "s12")
        self.assertLessEqual(len(name), 36)
        self.assertTrue(all(letter.isalnum() or letter in "_-" for letter in name))
        self.assertEqual(bridge.order_name("btc", SIGNAL, "b"), f"tb-btc-{SIGNAL}-b")

    def test_rupiah_is_written_the_indonesian_way(self):
        self.assertEqual(bridge.rp(1234567.4), "Rp1.234.567")
        self.assertEqual(bridge.signed_rp(-2500), "-Rp2.500")
        self.assertEqual(bridge.signed_rp(2500), "+Rp2.500")

    def test_client_name_is_one_indodax_accepts(self):
        self.assertNotIn("bot", bridge.CLIENT.lower())
        self.assertEqual(bridge.INDODAX, "https://indodax.com")


class SettingsTests(unittest.TestCase):
    REAL = {
        "INDODAX_MODE": "real",
        "INDODAX_REAL_CONFIRM": bridge.REAL_CONFIRM,
        "INDODAX_API_KEY": "k",
        "INDODAX_API_SECRET": "s",
    }

    def test_practice_is_the_default(self):
        settings = bridge.settings_from({})
        self.assertEqual(settings.mode, "practice")
        self.assertFalse(settings.real)
        self.assertEqual(settings.order_idr, 50_000)
        self.assertEqual(settings.max_open, 2)

    def test_real_needs_the_exact_sentence(self):
        for sentence in ("", "yes", bridge.REAL_CONFIRM.lower(), bridge.REAL_CONFIRM + "!"):
            with self.assertRaises(bridge.SettingsError):
                bridge.settings_from({**self.REAL, "INDODAX_REAL_CONFIRM": sentence})

    def test_real_needs_both_keys(self):
        for missing in ("INDODAX_API_KEY", "INDODAX_API_SECRET"):
            with self.assertRaises(bridge.SettingsError):
                bridge.settings_from({**self.REAL, missing: ""})

    def test_real_is_on_only_with_mode_sentence_and_keys_together(self):
        self.assertTrue(bridge.settings_from(self.REAL).real)
        self.assertFalse(bridge.settings_from({**self.REAL, "INDODAX_MODE": "practice"}).real)
        self.assertFalse(bridge.Settings(mode="real", confirmed=True).real)
        self.assertFalse(bridge.Settings(mode="real", api_key="k", api_secret="s").real)

    def test_unknown_mode_is_refused(self):
        with self.assertRaises(bridge.SettingsError):
            bridge.settings_from({"INDODAX_MODE": "live"})

    def test_money_settings_out_of_range_stop_the_sender(self):
        for value in ("19999", "500001", "50000.5", "abc", "-50000", "5e4"):
            with self.assertRaises(bridge.SettingsError, msg=value):
                bridge.settings_from({"INDODAX_ORDER_IDR": value})
        self.assertEqual(bridge.settings_from({"INDODAX_ORDER_IDR": "50.000"}).order_idr, 50_000)
        self.assertEqual(bridge.settings_from({"INDODAX_ORDER_IDR": "500000"}).order_idr, 500_000)
        for name, value in (("INDODAX_MAX_OPEN", "0"), ("INDODAX_MAX_OPEN", "4"), ("INDODAX_STOP_PERCENT", "0.5"), ("INDODAX_STOP_PERCENT", "25"), ("INDODAX_STOP_PERCENT", "x")):
            with self.assertRaises(bridge.SettingsError, msg=f"{name}={value}"):
                bridge.settings_from({name: value})

    def test_address_must_be_https(self):
        with self.assertRaises(bridge.SettingsError):
            bridge.settings_from({"INDODAX_BRIDGE_URL": "http://trade-bot.juw12.workers.dev"})

    def test_coin_list_is_read_and_checked(self):
        self.assertEqual(bridge.settings_from({"INDODAX_COINS": "BTC, eth ,"}).coins, ("btc", "eth"))
        with self.assertRaises(bridge.SettingsError):
            bridge.settings_from({"INDODAX_COINS": "btc_idr"})

    def test_secrets_never_show_when_settings_are_printed(self):
        settings = bridge.settings_from({**self.REAL, "INDODAX_API_KEY": "KEY-12345", "INDODAX_API_SECRET": "SECRET-12345", "INDODAX_BRIDGE_KEY": "BRIDGE-12345", "HTTPS_PROXY": "http://user:pass@proxy:3128"})
        shown = repr(settings) + str(settings)
        for secret in ("KEY-12345", "SECRET-12345", "BRIDGE-12345", "user:pass"):
            self.assertNotIn(secret, shown)

    def test_environment_goes_on_top_of_the_file(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / ".env"
            env.write_text("# comment\nINDODAX_ORDER_IDR=60000\nINDODAX_MAX_OPEN='3'\nOTHER=1\n", encoding="utf-8")
            settings = bridge.load_settings(env, {"INDODAX_ORDER_IDR": "70000", "HTTPS_PROXY": "http://localhost:3128", "PATH": "x"})
        self.assertEqual((settings.order_idr, settings.max_open, settings.proxy), (70_000, 3, "http://localhost:3128"))
        self.assertEqual(settings.spare_proxy, "")  # the file named no proxy: there is no spare

    def test_the_file_proxy_goes_first_and_the_pc_one_is_the_spare(self):
        with tempfile.TemporaryDirectory() as folder:
            env = Path(folder) / ".env"
            env.write_text("HTTPS_PROXY=http://office:80\n", encoding="utf-8")
            both = bridge.load_settings(env, {"HTTPS_PROXY": "http://localhost:3128"})
            lower = bridge.load_settings(env, {"https_proxy": " http://localhost:3128 "})
            same = bridge.load_settings(env, {"HTTPS_PROXY": "http://office:80"})
            alone = bridge.load_settings(env, {})
        # The .env proxy was chosen for this sender: it goes first, the PC's own is the spare.
        self.assertEqual((both.proxy, both.spare_proxy), ("http://office:80", "http://localhost:3128"))
        self.assertEqual((lower.proxy, lower.spare_proxy), ("http://office:80", "http://localhost:3128"))
        self.assertEqual((same.proxy, same.spare_proxy), ("http://office:80", ""))
        self.assertEqual((alone.proxy, alone.spare_proxy), ("http://office:80", ""))
        self.assertNotIn("office", repr(both))


class FakeSocket:
    def close(self):
        pass


def connect_only(*up):
    """A pretend network where only these (host, port) answer; it remembers what was tried."""
    tried = []

    def connect(address, timeout=None):
        tried.append(address)
        if address in up:
            return FakeSocket()
        raise ConnectionRefusedError()

    connect.tried = tried
    return connect


class ProxyChoice(unittest.TestCase):
    BOTH = {"proxy": "http://localhost:3128", "spare_proxy": "http://office:80"}

    def test_one_proxy_is_never_tested(self):
        connect = connect_only()
        settings = bridge.Settings(proxy="http://office:80")
        self.assertIs(bridge.reachable(settings, connect), settings)
        none = bridge.Settings()
        self.assertIs(bridge.reachable(none, connect), none)
        self.assertEqual(connect.tried, [])

    def test_the_first_proxy_stays_while_it_answers(self):
        connect = connect_only(("localhost", 3128), ("office", 80))
        settings = bridge.Settings(**self.BOTH)
        self.assertIs(bridge.reachable(settings, connect), settings)
        self.assertEqual(connect.tried, [("localhost", 3128)])

    def test_the_spare_takes_over_when_the_first_is_down(self):
        chosen = bridge.reachable(bridge.Settings(**self.BOTH), connect_only(("office", 80)))
        self.assertEqual((chosen.proxy, chosen.spare_proxy), ("http://office:80", "http://localhost:3128"))
        # and back again once the PC's own proxy is up and the office one is not
        back = bridge.reachable(chosen, connect_only(("localhost", 3128)))
        self.assertEqual((back.proxy, back.spare_proxy), ("http://localhost:3128", "http://office:80"))

    def test_nothing_changes_when_neither_answers(self):
        settings = bridge.Settings(**self.BOTH)
        self.assertIs(bridge.reachable(settings, connect_only()), settings)

    def test_a_proxy_without_a_port_or_scheme_is_understood(self):
        connect = connect_only(("office", 80), ("safe", 443), ("plain", 8080))
        self.assertTrue(bridge.proxy_answers("http://office", connect))
        self.assertTrue(bridge.proxy_answers("https://safe", connect))
        self.assertTrue(bridge.proxy_answers("plain:8080", connect))
        self.assertFalse(bridge.proxy_answers("http://user:pass@down:3128", connect))
        self.assertFalse(bridge.proxy_answers("http://", connect))
        self.assertFalse(bridge.proxy_answers("http://office:notaport", connect))


class Reroute(Case):
    def sender(self):
        settings = bridge.Settings(key="BRIDGE-12345", proxy="http://user:pass@localhost:3128", spare_proxy="http://office:80")
        lines = []
        made = bridge.Bridge(bridge.Indodax(settings), settings, bridge.Api(settings), Path(self.folder.name) / "state.json", log=lines.append)
        return made, lines

    def test_both_clients_move_to_the_proxy_that_answers(self):
        made, lines = self.sender()
        before = (made.api.opener, made.exchange.opener)
        self.assertTrue(bridge.reroute(made, connect_only(("office", 80))))
        self.assertEqual((made.settings.proxy, made.api.settings.proxy, made.exchange.settings.proxy), ("http://office:80",) * 3)
        self.assertIsNot(made.api.opener, before[0])
        self.assertIsNot(made.exchange.opener, before[1])
        self.assertEqual(made.api.settings.spare_proxy, "http://user:pass@localhost:3128")
        self.assertIsNotNone(made.api.spare)  # the proxy that was in use is now the one for a last try
        self.assertEqual(lines, ["The proxy in use did not answer. Now going through the other one (office)."])

    def test_nothing_moves_and_nothing_is_said_while_the_proxy_answers(self):
        made, lines = self.sender()
        before = (made.api.opener, made.exchange.opener)
        self.assertFalse(bridge.reroute(made, connect_only(("localhost", 3128), ("office", 80))))
        self.assertFalse(bridge.reroute(made, connect_only()))
        self.assertEqual((made.api.opener, made.exchange.opener), before)
        self.assertEqual(lines, [])

    def test_the_log_never_carries_a_proxy_password(self):
        made, lines = self.sender()
        bridge.reroute(made, connect_only(("office", 80)))
        bridge.reroute(made, connect_only(("localhost", 3128)))
        self.assertEqual(len(lines), 2)
        self.assertNotIn("user:pass", " ".join(lines))
        self.assertIn("(localhost)", lines[1])


# ---------------------------------------------------------------- the Indodax client


class FakeResponse:
    def __init__(self, text):
        self.text = text

    def read(self):
        return self.text.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, handler):
        self.handler = handler
        self.requests = []

    def open(self, request, timeout=None):
        self.requests.append(request)
        result = self.handler(request)
        if isinstance(result, Exception):
            raise result
        return FakeResponse(result if isinstance(result, str) else json.dumps(result))


GET_INFO = {
    "success": 1,
    "return": {
        "server_time": 1763272800,
        "balance": {"idr": 250000, "btc": "0.00010000"},
        "balance_hold": {"idr": 0, "btc": "0.00000000"},
        "address": {"btc": OWNER_ADDRESS},
        "network": {"btc": "mainnet"},
        "user_id": "987654",
        "name": OWNER_NAME,
        "email": OWNER_EMAIL,
        "verification_status": "verified",
    },
}


# ---------------------------------------------------------------- TradeBot's server: a call is tried again


REFUSED_407 = urllib.error.URLError(OSError("Tunnel connection failed: 407 Proxy Authentication Required"))


def answers_after(*problems, answer=None):
    """A pretend network that fails with each of these in turn and then answers."""
    waiting = list(problems)

    def handler(request):
        return waiting.pop(0) if waiting else ({"ok": True} if answer is None else answer)

    return handler


class ApiTries(unittest.TestCase):
    def api(self, main, spare=None, **changes):
        values = {"key": "BRIDGE-KEY-VALUE", "proxy": "http://office:80", "spare_proxy": "http://localhost:3128" if spare else ""}
        values.update(changes)
        self.lines, self.waits, self.clock = [], [], Clock(0.0)
        made = bridge.Api(bridge.Settings(**values), log=self.lines.append, sleep=self.waits.append, clock=self.clock)
        self.main = made.opener = FakeOpener(main)
        self.other = None
        if spare:
            self.assertIsNotNone(made.spare)
            self.other = made.spare = FakeOpener(spare)
        return made

    def test_a_call_that_answers_is_made_once(self):
        api = self.api(answers_after(answer={"fresh": True}), spare=answers_after())
        self.assertEqual(api.signals(), {"fresh": True})
        self.assertEqual((len(self.main.requests), len(self.other.requests), self.waits, self.lines), (1, 0, [], []))

    def test_the_second_try_goes_through_the_other_proxy_and_the_log_says_so(self):
        api = self.api(answers_after(REFUSED_407), spare=answers_after(answer={"fresh": True}))
        self.assertEqual(api.signals(), {"fresh": True})
        self.assertEqual((len(self.main.requests), len(self.other.requests), self.waits), (1, 1, [1]))
        self.assertEqual(self.lines, ["TradeBot answered on try 2 (the first try: URLError, the proxy answered 407)."])
        first, second = self.main.requests[0], self.other.requests[0]
        self.assertIsNot(first, second)  # a request that went through a proxy once is not sent again as it was
        self.assertEqual(first.full_url, second.full_url)

    def test_the_third_try_is_the_first_proxy_again(self):
        api = self.api(answers_after(REFUSED_407, answer={"fresh": True}), spare=answers_after(REFUSED_407))
        self.assertEqual(api.signals(), {"fresh": True})
        self.assertEqual((len(self.main.requests), len(self.other.requests), self.waits), (2, 1, [1, 4]))
        self.assertEqual(self.lines, ["TradeBot answered on try 3 (the first try: URLError, the proxy answered 407)."])

    def test_with_one_proxy_all_three_tries_use_it(self):
        api = self.api(answers_after(REFUSED_407, REFUSED_407))
        self.assertIsNone(api.spare)
        self.assertEqual(api.signals(), {"ok": True})
        self.assertEqual((len(self.main.requests), self.waits), (3, [1, 4]))

    def test_the_same_proxy_named_twice_is_no_other_proxy(self):
        made = bridge.Api(bridge.Settings(key="k", proxy="http://office:80", spare_proxy="http://office:80"))
        self.assertIsNone(made.spare)

    def test_after_three_failures_it_gives_up_and_says_how_often_it_tried(self):
        lost = http.client.RemoteDisconnected("Remote end closed connection without response")
        api = self.api(answers_after(lost, lost), spare=answers_after(lost))
        with self.assertRaises(bridge.ApiError) as caught:
            api.signals()
        self.assertEqual(str(caught.exception), "TradeBot could not be reached (RemoteDisconnected, 3 tries)")
        self.assertEqual((self.waits, self.lines), ([1, 4], []))

    def test_a_try_that_hung_is_not_followed_by_more(self):
        def hangs(request):
            self.clock.now += 20  # the whole timeout went by
            return urllib.error.URLError(TimeoutError("timed out"))

        api = self.api(hangs, spare=answers_after())
        with self.assertRaises(bridge.ApiError) as caught:
            api.signals()
        self.assertEqual(str(caught.exception), "TradeBot could not be reached (URLError, TimeoutError)")
        self.assertEqual((len(self.main.requests), len(self.other.requests), self.waits), (1, 0, []))

    def test_slow_failures_end_the_tries_before_the_third(self):
        def slow(request):
            self.clock.now += 5
            return REFUSED_407

        api = self.api(slow, spare=slow)
        with self.assertRaises(bridge.ApiError) as caught:
            api.signals()
        # 5 seconds, a wait of 1 (the pretend wait moves no clock), 5 more: a third try would start too late.
        self.assertEqual(str(caught.exception), "TradeBot could not be reached (URLError, the proxy answered 407, 2 tries)")
        self.assertEqual((len(self.main.requests), len(self.other.requests), self.waits), (1, 1, [1]))

    def test_a_refusal_by_tradebot_itself_is_not_tried_again(self):
        refused = urllib.error.HTTPError("https://example.invalid", 403, "Forbidden", None, None)
        api = self.api(answers_after(refused), spare=answers_after())
        with self.assertRaises(bridge.ApiError) as caught:
            api.signals()
        self.assertIn("HTTP 403", str(caught.exception))
        self.assertEqual((len(self.main.requests), len(self.other.requests), self.waits), (1, 0, []))

    def test_the_report_is_sent_again_whole_and_the_key_stays_out_of_every_line(self):
        api = self.api(answers_after(REFUSED_407, answer={"ok": True, "told": 0}), spare=answers_after(REFUSED_407))
        self.assertEqual(api.report({"mode": "real", "positions": []}), {"ok": True, "told": 0})
        sent = self.main.requests + self.other.requests
        self.assertEqual(len(sent), 3)
        for request in sent:
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(json.loads(request.data), {"mode": "real", "positions": []})
            self.assertEqual(request.get_header("X-indodax-key"), "BRIDGE-KEY-VALUE")
        self.assertNotIn("BRIDGE-KEY-VALUE", " ".join(self.lines))

    def test_the_key_is_in_no_message_when_every_try_fails(self):
        loud = urllib.error.URLError(OSError("could not send X-Indodax-Key: BRIDGE-KEY-VALUE to https://trade-bot.example"))
        api = self.api(answers_after(loud, loud, loud))
        with self.assertRaises(bridge.ApiError) as caught:
            api.signals()
        self.assertEqual(str(caught.exception), "TradeBot could not be reached (URLError, OSError, 3 tries)")

    def test_the_words_for_each_kind_of_problem(self):
        self.assertEqual(bridge.why_unreached(REFUSED_407), "URLError, the proxy answered 407")
        self.assertEqual(bridge.why_unreached(urllib.error.URLError(ConnectionResetError(10054, "reset"))), "URLError, ConnectionResetError")
        self.assertEqual(bridge.why_unreached(urllib.error.URLError("timed out")), "URLError")
        self.assertEqual(bridge.why_unreached(TimeoutError()), "TimeoutError")
        self.assertEqual(bridge.why_unreached(ValueError("not JSON")), "ValueError")


# ---------------------------------------------------------------- a request the proxy refused never left


class LocalProxy:
    """A pretend proxy on this PC for one connection. It answers the request to open a way to a
    site with `answer` (nothing at all when that is empty) and keeps every byte that came after."""

    def __init__(self, answer):
        self.answer = answer
        self.asked = b""
        self.after = b""
        self.server = socket.create_server(("127.0.0.1", 0))
        self.address = f"http://127.0.0.1:{self.server.getsockname()[1]}"
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        try:
            connection, _ = self.server.accept()
        except OSError:
            return
        with connection:
            connection.settimeout(5)
            data = b""
            try:
                while b"\r\n\r\n" not in data:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                self.asked, _, self.after = data.partition(b"\r\n\r\n")
                if self.answer:
                    connection.sendall(self.answer)
                    connection.shutdown(socket.SHUT_WR)
                while True:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    self.after += chunk
            except OSError:
                pass

    def close(self):
        self.server.close()
        self.thread.join(5)


class NeverSent(unittest.TestCase):
    """Python's own network code against a pretend proxy: which failures mean nothing was sent."""

    def through(self, answer, timeout=5):
        proxy = LocalProxy(answer)
        self.addCleanup(proxy.close)
        request = urllib.request.Request("https://indodax.invalid/api/v2/order", data=b"ORDER-BODY", method="POST")
        with self.assertRaises(OSError) as caught:
            bridge.proxy_opener(proxy.address).open(request, timeout=timeout)
        proxy.thread.join(5)
        self.assertTrue(proxy.asked.startswith(b"CONNECT indodax.invalid:443 "), proxy.asked)
        return proxy, caught.exception

    def test_a_proxy_that_refuses_to_open_the_way_got_none_of_the_request(self):
        proxy, error = self.through(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n")
        self.assertTrue(bridge.never_sent(error), repr(error))
        self.assertEqual(proxy.after, b"")  # not one byte followed the refused request to open the way
        self.assertEqual(bridge.why_unreached(error), "URLError, the proxy answered 407")
        _, error = self.through(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n")
        self.assertTrue(bridge.never_sent(error), repr(error))

    def test_a_way_that_was_opened_and_then_dropped_is_not_called_never_sent(self):
        proxy, error = self.through(b"HTTP/1.1 200 Connection established\r\n\r\n")
        self.assertFalse(bridge.never_sent(error), repr(error))
        self.assertNotEqual(proxy.after, b"")  # the secure connection had begun

    def test_a_proxy_that_says_nothing_is_not_called_never_sent(self):
        _, error = self.through(b"", timeout=0.3)
        self.assertFalse(bridge.never_sent(error), repr(error))

    def test_only_a_refused_way_counts(self):
        self.assertTrue(bridge.never_sent(REFUSED_407))
        others = (
            urllib.error.URLError("timed out"),
            urllib.error.URLError(TimeoutError()),
            urllib.error.URLError(ConnectionResetError(10054, "reset")),
            urllib.error.URLError("Tunnel connection failed: 407"),  # only Python's own error counts, not its words
            urllib.error.HTTPError("u", 407, "Tunnel connection failed: 407", {}, None),
            OSError("Tunnel connection failed: 407 Proxy Authentication Required"),  # not from opening a request
            http.client.RemoteDisconnected("closed"),
            TimeoutError(),
        )
        for other in others:
            self.assertFalse(bridge.never_sent(other), repr(other))


class ClientTests(unittest.TestCase):
    def client(self, handler, **changes):
        values = {"api_key": "API-KEY-VALUE", "api_secret": "API-SECRET-VALUE"}
        values.update(changes)
        self.clock = Clock()
        self.opener = FakeOpener(handler)
        return bridge.Indodax(bridge.Settings(**values), clock=self.clock, opener=self.opener)

    def route(self, tapi):
        def handler(request):
            if request.full_url.endswith("/api/server_time"):
                return {"server_time": int(START * 1000) - 2500}
            return tapi(request) if callable(tapi) else tapi

        return handler

    def test_private_call_is_signed_and_goes_only_to_indodax(self):
        client = self.client(self.route(GET_INFO))
        client.balances()
        request = self.opener.requests[-1]
        body = request.data.decode("utf-8")
        self.assertEqual(request.full_url, "https://indodax.com/tapi")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Key"), "API-KEY-VALUE")
        self.assertEqual(request.get_header("Sign"), bridge.sign(body, "API-SECRET-VALUE"))
        self.assertEqual(request.get_header("User-agent"), bridge.CLIENT)
        fields = dict(urllib.parse.parse_qsl(body))
        self.assertEqual(fields["method"], "getInfo")
        self.assertEqual(fields["recvWindow"], "5000")
        # Indodax's clock is used, not this PC's (which runs 2.5 s ahead here).
        self.assertEqual(int(fields["timestamp"]), int(START * 1000) - 2500)
        self.assertNotIn("API-SECRET-VALUE", body)
        self.assertTrue(all(item.full_url.startswith("https://indodax.com/") for item in self.opener.requests))

    def test_only_balances_are_kept_from_the_account_answer(self):
        balances = self.client(self.route(GET_INFO)).balances()
        self.assertEqual(balances, {"idr": 250000.0, "btc": 0.0001})
        kept = json.dumps(balances)
        for private in (OWNER_NAME, OWNER_EMAIL, OWNER_ADDRESS, "987654"):
            self.assertNotIn(private, kept)

    def test_a_refusal_is_clear_and_never_repeats_the_key(self):
        answer = {"success": 0, "error": "Invalid credentials for API-KEY-VALUE. " + "x" * 400, "error_code": "invalid_credentials"}
        with self.assertRaises(bridge.ExchangeError) as caught:
            self.client(self.route(answer)).balances()
        self.assertFalse(caught.exception.unsure)
        self.assertEqual(caught.exception.code, "invalid_credentials")
        self.assertNotIn("API-KEY-VALUE", str(caught.exception))
        self.assertLessEqual(len(str(caught.exception)), 160)

    def test_a_lost_answer_is_unsure_only_for_orders(self):
        lost = urllib.error.URLError("timed out")
        with self.assertRaises(bridge.ExchangeError) as reading:
            self.client(self.route(lost)).balances()
        self.assertFalse(reading.exception.unsure)
        for problem in (lost, TimeoutError(), urllib.error.HTTPError("u", 502, "bad", {}, None), "<html>not json</html>", {"odd": 1}):
            with self.assertRaises(bridge.ExchangeError, msg=repr(problem)) as ordering:
                self.client(self.route(problem)).trade("btc_idr", "buy", idr=50_000, client_order_id="tb-btc-1-b")
            self.assertTrue(ordering.exception.unsure, repr(problem))
        for problem in (urllib.error.HTTPError("u", 429, "slow down", {}, None), {"success": 0, "error": "Minimum order 10000"}):
            with self.assertRaises(bridge.ExchangeError, msg=repr(problem)) as ordering:
                self.client(self.route(problem)).trade("btc_idr", "buy", idr=50_000, client_order_id="tb-btc-1-b")
            self.assertFalse(ordering.exception.unsure, repr(problem))

    def test_a_request_the_proxy_refused_is_never_unsure_and_says_it_was_not_sent(self):
        for call in ("balances", "trade"):
            client = self.client(self.route(REFUSED_407))
            with self.assertRaises(bridge.ExchangeError, msg=call) as caught:
                client.balances() if call == "balances" else client.trade("btc_idr", "buy", idr=50_000, client_order_id="tb-btc-1-b")
            self.assertTrue(caught.exception.unsent, call)
            self.assertFalse(caught.exception.unsure, call)
            self.assertEqual(str(caught.exception), "Indodax could not be reached (URLError, the proxy answered 407)")
        with self.assertRaises(bridge.ExchangeError) as lost:
            self.client(self.route(urllib.error.URLError("timed out"))).trade("btc_idr", "buy", idr=50_000, client_order_id="tb-btc-1-b")
        self.assertFalse(lost.exception.unsent)
        self.assertTrue(lost.exception.unsure)

    def test_errors_carry_no_request_details(self):
        with self.assertRaises(bridge.ExchangeError) as caught:
            self.client(self.route(urllib.error.URLError("https://indodax.com/tapi Key=API-KEY-VALUE"))).balances()
        self.assertEqual(str(caught.exception), "Indodax could not be reached (URLError)")

    def test_orders_are_market_orders_with_their_own_name(self):
        seen = []

        def tapi(request):
            seen.append(dict(urllib.parse.parse_qsl(request.data.decode("utf-8"))))
            return {"success": 1, "return": {"receive_btc": "0.00004985", "spend_rp": 50000, "fee": 0, "remain_rp": 0, "order_id": 11, "client_order_id": "tb-btc-1-b"}}

        client = self.client(self.route(tapi))
        answer = client.trade("btc_idr", "buy", idr=50_000, client_order_id="tb-btc-1-b")
        self.assertEqual(answer, {"receive_btc": "0.00004985", "spend_rp": 50000, "fee": 0, "remain_rp": 0})
        client.trade("btc_idr", "sell", coin="btc", quantity="0.00004985", client_order_id="tb-btc-1-s0")
        buy, sell = seen
        self.assertEqual((buy["method"], buy["pair"], buy["type"], buy["order_type"], buy["idr"], buy["client_order_id"]), ("trade", "btc_idr", "buy", "market", "50000", "tb-btc-1-b"))
        self.assertNotIn("btc", buy)
        self.assertEqual((sell["type"], sell["order_type"], sell["btc"], sell["client_order_id"]), ("sell", "market", "0.00004985", "tb-btc-1-s0"))
        self.assertNotIn("idr", sell)

    def order_answer(self, **changes):
        order = {
            "order_id": "59636253",
            "client_order_id": "tb-btc-1-s0",
            "price": "1000000000",
            "type": "sell",
            "order_btc": "0.00004985",
            "remain_btc": "0.00000000",
            "receive_idr": "49750",
            "submit_time": "1763272800",
            "finish_time": "1763272801",
            "status": "filled",
            "name": OWNER_NAME,
            "email": OWNER_EMAIL,
        }
        order.update(changes)
        return {"success": 1, "return": {"order": order}}

    def test_an_order_is_looked_up_by_its_own_name_and_only_read(self):
        client = self.client(self.route(self.order_answer()))
        client.order("tb-btc-1-s0")
        request = self.opener.requests[-1]
        fields = dict(urllib.parse.parse_qsl(request.data.decode("utf-8")))
        self.assertEqual(request.full_url, "https://indodax.com/tapi")
        self.assertEqual((fields["method"], fields["client_order_id"]), ("getOrderByClientOrderId", "tb-btc-1-s0"))
        self.assertFalse(any(b"method=trade" in item.data for item in self.opener.requests if item.data))

    def test_only_the_state_side_and_amounts_are_kept_from_an_order_lookup(self):
        kept = self.client(self.route(self.order_answer())).order("tb-btc-1-s0")
        self.assertEqual(kept, {"status": "filled", "side": "sell", "order_btc": "0.00004985", "remain_btc": "0.00000000", "receive_idr": "49750"})
        for spelling in ("canceled", "Cancelled", "CANCELED"):
            answer = self.order_answer(status=spelling)
            self.assertEqual(self.client(self.route(answer)).order("tb-btc-1-s0")["status"], "cancelled", spelling)

    def test_a_lookup_that_fails_is_never_unsure(self):
        problems = (urllib.error.URLError("timed out"), TimeoutError(), "<html>not json</html>", {"success": 0, "error": "Order not found"})
        for problem in problems:
            with self.assertRaises(bridge.ExchangeError, msg=repr(problem)) as looking:
                self.client(self.route(problem)).order("tb-btc-1-s0")
            self.assertFalse(looking.exception.unsure, repr(problem))

    def test_a_lookup_answer_about_another_order_or_none_is_refused(self):
        answers = (
            self.order_answer(client_order_id="tb-btc-1-s1"),
            {"success": 1, "return": {}},
            {"success": 1, "return": {"order": []}},
            {"success": 1, "return": {"order": "filled"}},
        )
        for answer in answers:
            with self.assertRaises(bridge.ExchangeError, msg=repr(answer)):
                self.client(self.route(answer)).order("tb-btc-1-s0")

    def test_without_keys_nothing_is_sent(self):
        client = self.client(self.route(GET_INFO), api_key="", api_secret="")
        with self.assertRaises(bridge.ExchangeError):
            client.balances()
        self.assertEqual(self.opener.requests, [])

    def test_a_clock_that_cannot_be_read_stops_the_private_call(self):
        client = self.client(lambda request: {"server_time": 0} if request.full_url.endswith("server_time") else GET_INFO)
        with self.assertRaises(bridge.ExchangeError):
            client.balances()
        self.assertFalse(any(item.full_url.endswith("/tapi") for item in self.opener.requests))

    def test_pair_list_keeps_rupiah_markets_and_is_cached(self):
        raw = [
            {"id": "btcidr", "ticker_id": "btc_idr", "base_currency": "idr", "traded_currency": "btc", "quantity_increment": "0.00000001", "trade_min_base_currency": 10000, "trade_min_traded_currency": 1e-05, "trade_fee_percent_taker": 0.2, "is_maintenance": 0, "is_market_suspended": 0},
            {"id": "ethidr", "ticker_id": "eth_idr", "base_currency": "idr", "traded_currency": "eth", "trade_min_base_currency": 10000, "is_maintenance": 1},
            {"id": "solidr", "ticker_id": "sol_idr", "base_currency": "idr", "traded_currency": "sol", "is_market_suspended": 1},
            {"id": "btcusdt", "ticker_id": "btc_usdt", "base_currency": "usdt", "traded_currency": "btc"},
            {"id": "../evil", "ticker_id": "x_idr", "base_currency": "idr", "traded_currency": "x"},
            "nonsense",
        ]
        client = self.client(lambda request: raw)
        pairs = client.pairs()
        self.assertEqual(sorted(pairs), ["btc", "eth", "sol"])
        self.assertEqual(pairs["btc"], {"coin": "btc", "id": "btcidr", "ticker_id": "btc_idr", "min_idr": 10000.0, "min_coin": 1e-05, "fee_percent": 0.2, "increment": "0.00000001", "blocked": False})
        self.assertTrue(pairs["eth"]["blocked"])
        self.assertTrue(pairs["sol"]["blocked"])
        self.assertEqual(pairs["eth"]["fee_percent"], bridge.FEE_PERCENT_DEFAULT)
        client.pairs()
        self.assertEqual(len(self.opener.requests), 1)
        self.clock.now += bridge.PAIRS_CACHE_SECONDS + 1
        client.pairs()
        self.assertEqual(len(self.opener.requests), 2)

    def test_prices_are_read_and_nonsense_is_refused(self):
        good = {"ticker": {"buy": "1000000000", "sell": "1001000000", "last": "1000500000", "server_time": 1763272800}}
        self.assertEqual(self.client(lambda request: good).ticker("btcidr"), {"bid": 1e9, "ask": 1.001e9})
        self.assertEqual(self.opener.requests[0].full_url, "https://indodax.com/api/ticker/btcidr")
        for bad in ({"ticker": {"buy": "0", "sell": "5"}}, {"ticker": {"buy": "6", "sell": "5"}}, {"error": "x"}, []):
            with self.assertRaises(bridge.ExchangeError, msg=repr(bad)):
                self.client(lambda request, bad=bad: bad).ticker("btcidr")


# ---------------------------------------------------------------- practice


class Practice(Case):
    def test_buy_uses_real_price_and_fee_and_touches_no_private_call(self):
        self.make(BTC).cycle()
        position = self.bridge.state["positions"][BTC]
        expected = float(bridge.floor_to(50_000 * 0.998 / 1_001_000_000, "0.00000001"))
        self.assertAlmostEqual(position["quantity"], expected)
        self.assertAlmostEqual(position["quantity"], 0.00004985)
        self.assertEqual(position["spent"], 50_000.0)
        self.assertAlmostEqual(position["price"], 50_000 / expected)
        self.assertFalse(position["real"])
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.exchange.balance_calls, 0)
        self.assertIn("PRACTICE", self.text())
        self.assertEqual(self.stored()["bought"][BTC]["signal"], SIGNAL)

    def test_sells_when_tradebot_no_longer_holds_the_coin(self):
        self.make(BTC).cycle()
        quantity = self.bridge.state["positions"][BTC]["quantity"]
        self.exchange.tickers["btcidr"] = {"bid": 1_100_000_000.0, "ask": 1_101_000_000.0}
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        received = quantity * 1_100_000_000 * 0.998
        closed = self.bridge.state["closed"][-1]
        self.assertAlmostEqual(closed["received"], received)
        self.assertAlmostEqual(self.bridge.state["result"]["practice"], received - 50_000)
        self.assertEqual(self.bridge.state["result"]["real"], 0.0)
        self.assertEqual(self.bridge.state["bought"], {})
        self.assertEqual(self.exchange.orders, [])

    def test_old_signals_buy_nothing_and_sell_nothing(self):
        self.make(BTC).cycle()
        self.api.answer = {"fresh": False, "wanted": []}
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])
        self.api.answer = {"fresh": False, "wanted": [{"symbol": ETH, "openedAt": SIGNAL}]}
        self.bridge.cycle()
        self.assertEqual(list(self.bridge.state["positions"]), [BTC])
        self.assertIn("too old", self.text())

    def test_unreadable_signals_hold_but_the_own_stop_still_works(self):
        self.make(BTC).cycle()
        self.api.error = "TradeBot could not be reached (URLError)"
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])
        self.exchange.tickers["btcidr"] = {"bid": 900_000_000.0, "ask": 901_000_000.0}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("own stop", self.text())

    def test_own_stop_sells_and_the_same_signal_is_not_bought_again(self):
        self.make(BTC).cycle()
        paid = self.bridge.state["positions"][BTC]["price"]
        self.exchange.tickers["btcidr"] = {"bid": paid * 0.93, "ask": paid * 0.931}
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])  # 7% down: not yet
        self.exchange.tickers["btcidr"] = {"bid": paid * 0.92, "ask": paid * 0.921}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertLess(self.bridge.state["result"]["practice"], 0)
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("already copied for this signal", self.text())
        self.api.hold(BTC, signal=SIGNAL + 60_000)
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])

    def test_wide_spread_is_not_bought(self):
        self.make(DOGE)
        self.exchange.tickers["dogeidr"] = {"bid": 3_000.0, "ask": 3_020.0}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("apart", self.text())

    def test_order_must_be_twice_the_smallest_order(self):
        self.make(BTC)
        self.exchange.pair_list["btc"] = pair("btc", minimum=30_000)
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("twice", self.text())

    def test_most_copies_open_is_respected(self):
        self.make(BTC, ETH, DOGE).cycle()
        self.assertEqual(list(self.bridge.state["positions"]), [BTC, ETH])
        self.assertIn("2 copies are open already", self.text())

    def test_a_loss_of_one_order_size_stops_buying_for_the_day(self):
        self.make(BTC)
        self.bridge.roll_day()
        self.bridge.state["day"]["practice"] = -50_000.0
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("Today's loss", self.text())
        self.clock.now += 24 * 3600
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])

    def test_at_most_ten_buys_a_day(self):
        self.make(BTC)
        self.bridge.roll_day()
        self.bridge.state["day"]["buys"] = bridge.MAX_BUYS_PER_DAY
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("10 buys were made today", self.text())

    def test_coin_list_limits_what_is_copied(self):
        self.make(BTC, ETH, coins=("eth",)).cycle()
        self.assertEqual(list(self.bridge.state["positions"]), [ETH])

    def test_blocked_and_unlisted_coins_are_skipped(self):
        self.make(BTC, "XYZUSDT", "EURUSD")
        self.exchange.pair_list["btc"] = pair("btc", blocked=True)
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("maintenance or suspended", self.text())
        self.assertIn("XYZ is not traded against rupiah", self.text())

    def test_signals_without_a_start_time_are_skipped(self):
        self.make()
        self.api.answer = {"fresh": True, "wanted": [{"symbol": BTC}, {"symbol": ETH, "openedAt": 0}, "odd", {"openedAt": SIGNAL}]}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})

    def test_no_pair_list_means_no_orders_but_still_a_report(self):
        self.make(BTC).cycle()
        self.exchange.pairs_error = bridge.ExchangeError("Indodax answered HTTP 403")
        self.api.hold()
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])
        self.assertEqual(len(self.api.reports), 2)
        self.assertIn("pair list could not be read", self.api.reports[-1]["notes"][0])

    def test_show_sends_nothing_and_writes_nothing(self):
        self.make(BTC, real=True).cycle(show=True)
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.exchange.balance_calls, 0)
        self.assertEqual(self.api.reports, [])
        self.assertFalse(self.state_path.exists())
        self.assertIn("Would do", self.text())
        self.assertIn('"do": "buy"', self.text())

    def test_report_holds_copies_only(self):
        self.make(BTC).cycle()
        report = self.api.reports[-1]
        self.assertEqual(
            sorted(report),
            ["checked", "closed", "keys", "market", "maxOpen", "mode", "notes", "orderIdr", "paused", "positions", "result", "stopPercent", "today", "tripped", "trippedWhy"],
        )
        self.assertEqual((report["mode"], report["keys"], report["tripped"], report["orderIdr"]), ("practice", False, False, 50_000))
        self.assertEqual((report["checked"], report["paused"]), (False, False))
        position = report["positions"][0]
        self.assertEqual(sorted(position), ["now", "openedAt", "pair", "price", "quantity", "real", "spent", "symbol", "value"])
        self.assertEqual((position["symbol"], position["pair"], position["real"], position["now"]), (BTC, "btc_idr", False, 1e9))
        self.assertAlmostEqual(position["value"], position["quantity"] * 1e9)

    def test_free_rupiah_is_reported_only_when_asked_for_and_only_in_real_mode(self):
        self.make(real=True).cycle()
        self.assertNotIn("cash", self.api.reports[-1])
        self.assertEqual(self.exchange.balance_calls, 0)
        self.make(real=True, report_cash=True).cycle()
        self.assertEqual(self.api.reports[-1]["cash"], self.exchange.free["idr"])
        self.make(report_cash=True).cycle()  # practice never touches the private API
        self.assertNotIn("cash", self.api.reports[-1])
        self.assertEqual(self.exchange.balance_calls, 0)

    def test_the_report_names_the_price_of_each_coin_it_may_trade(self):
        self.make(coins=("btc",)).cycle()
        self.assertEqual(self.api.reports[-1]["market"], [{"coin": "btc", "bid": 1e9, "ask": 1.001e9}])

    def test_the_last_report_is_kept_in_a_file_for_the_desktop_app(self):
        self.make(BTC).cycle()
        kept = json.loads((self.state_path.parent / "bridge_report.json").read_text(encoding="utf-8"))
        self.assertEqual(kept["report"], self.api.reports[-1])
        self.assertEqual(kept["at"], self.bridge.now_ms())

    def test_a_closed_copy_remembers_when_it_was_bought(self):
        self.make(BTC).cycle()
        bought_at = self.bridge.state["positions"][BTC]["at"]
        self.clock.now += 3600
        self.api.hold()
        self.bridge.cycle()
        entry = self.bridge.state["closed"][-1]
        self.assertEqual(entry["boughtAt"], bought_at)
        self.assertGreater(entry["at"], bought_at)
        self.assertGreater(entry["quantity"], 0)

    def test_daily_numbers_start_again_at_midnight_utc(self):
        self.make()
        self.bridge.roll_day()
        self.bridge.state["day"].update(practice=-1.0, buys=3)
        self.bridge.roll_day()
        self.assertEqual(self.bridge.state["day"]["buys"], 3)
        self.clock.now += 18 * 3600  # past midnight UTC
        self.bridge.roll_day()
        self.assertEqual(self.bridge.state["day"], {"date": "2025-11-17", "practice": 0.0, "real": 0.0, "buys": 0})

    def test_state_survives_a_restart_and_a_damaged_file_stops_the_sender(self):
        self.make(BTC).cycle()
        again = bridge.Bridge(FakeExchange(), self.settings(), FakeApi(BTC), self.state_path, log=self.logs.append, clock=self.clock)
        self.assertIn(BTC, again.state["positions"])
        again.cycle()
        self.assertEqual(again.state["day"]["buys"], 1)
        self.state_path.write_text("{ not json", encoding="utf-8")
        with self.assertRaises(bridge.StateError):
            bridge.load_state(self.state_path)
        self.state_path.write_text("[]", encoding="utf-8")
        with self.assertRaises(bridge.StateError):
            bridge.load_state(self.state_path)


# ---------------------------------------------------------------- real money (pretend exchange)


class Real(Case):
    def test_buy_sends_one_named_market_order_and_records_the_copy(self):
        self.make(BTC, real=True)
        seen = {}

        def fill(order):
            seen["memory"] = self.stored()["bought"].get(BTC)  # written before the order goes
            return self.exchange.fill(order)

        self.exchange.on_trade = fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        order = self.exchange.orders[0]
        self.assertEqual((order["pair"], order["side"], order["idr"], order["name"]), ("btc_idr", "buy", 50_000, f"tb-btc-{SIGNAL}-b"))
        self.assertEqual(seen["memory"]["signal"], SIGNAL)
        position = self.bridge.state["positions"][BTC]
        self.assertTrue(position["real"])
        self.assertAlmostEqual(position["quantity"], 0.00004985)  # the smaller of the balance and the answer
        self.assertLessEqual(position["quantity"], self.exchange.free["btc"])
        self.assertEqual(position["spent"], 50_000.0)
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertIn("REAL MONEY: bought", self.text())
        self.assertEqual(self.api.reports[-1]["mode"], "real")
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)

    def test_not_enough_rupiah_sends_nothing_and_is_tried_again(self):
        self.make(BTC, real=True)
        self.exchange.free["idr"] = 49_999.0
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(self.bridge.state["bought"], {})
        self.assertIn("not enough free rupiah", self.text())
        self.exchange.free["idr"] = 60_000.0
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)

    def test_unreadable_balance_before_a_buy_sends_nothing(self):
        self.make(BTC, real=True)
        self.exchange.balance_errors = [bridge.ExchangeError("Indodax answered HTTP 503")]
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(self.bridge.state["positions"], {})

    def test_a_refused_buy_trips_the_safety_stop(self):
        self.make(BTC, ETH, real=True)
        self.exchange.on_trade = self.exchange.refuse
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)  # ETH was not tried after the stop
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertEqual(list(self.bridge.state["bought"]), [BTC])  # ETH's signal is not used up
        self.assertEqual(self.exchange.balance_calls, 1)  # only BTC's check before its order
        self.assertIn("refused the buy of BTC", self.bridge.state["tripped"])
        self.assertTrue(self.api.reports[-1]["tripped"])
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        self.assertIn("safety stop is on", self.text())
        self.assertEqual(self.bridge.clear_trip()[:7], "Indodax")
        self.bridge.cycle()
        self.assertEqual([order["pair"] for order in self.exchange.orders], ["btc_idr", "eth_idr"])  # BTC's signal stays used

    def test_a_buy_that_never_left_this_pc_stops_nothing_and_is_sent_once_next_minute(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.never_leave
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(self.bridge.state["bought"], {})  # the signal is not used up
        self.assertEqual(self.bridge.state["day"]["buys"], 0)
        self.assertEqual(self.stored()["bought"], {})
        self.assertEqual(self.exchange.lookups, [])  # nothing was sent, so there is nothing to look up
        self.assertEqual(self.exchange.balance_calls, 1)  # and no balance to compare
        note = "\n".join(self.api.reports[-1]["notes"])
        self.assertIn("BTC: the buy did not happen. The buy of BTC never left this PC", note)
        self.assertIn("the proxy answered 407", note)
        self.assertIn("Trying again next minute", note)
        self.assertFalse(self.api.reports[-1]["tripped"])
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [BUY_NAME, BUY_NAME])  # the same name both times
        self.assertTrue(self.bridge.state["positions"][BTC]["real"])
        self.assertEqual(self.bridge.state["day"]["buys"], 1)
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 2)  # bought once, and never again for this signal

    def test_a_buy_that_never_left_keeps_what_was_remembered_before(self):
        self.make(BTC, real=True)
        earlier = {"signal": SIGNAL - 1, "at": 5}
        self.bridge.state["bought"][BTC] = dict(earlier)
        self.exchange.on_trade = self.exchange.never_leave
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["bought"], {BTC: earlier})
        self.assertEqual(self.bridge.state["tripped"], "")

    def test_a_buy_that_never_left_does_not_use_up_the_days_buys(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.never_leave
        for _ in range(bridge.MAX_BUYS_PER_DAY + 2):
            self.bridge.cycle()
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])
        self.assertEqual(self.bridge.state["day"]["buys"], 1)

    def test_lost_answer_with_the_coin_arrived_records_the_copy_and_trips(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.bridge.cycle()
        position = self.bridge.state["positions"][BTC]
        self.assertTrue(position["real"])
        self.assertAlmostEqual(position["quantity"], self.exchange.free["btc"])
        self.assertIn("answer to the buy of BTC was lost, but the coin arrived", self.bridge.state["tripped"])

    def test_lost_answer_and_unreadable_balance_trips_without_a_copy(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.exchange.balance_errors = [None, bridge.ExchangeError("Indodax answered HTTP 503")]
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("check Indodax by hand", self.bridge.state["tripped"])
        self.bridge.clear_trip()
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)  # never bought twice for one signal

    def test_lost_answer_and_nothing_arrived_trips_without_a_copy(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.lose
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("no BTC has arrived", self.bridge.state["tripped"])

    def test_accepted_buy_without_coin_trips_without_a_copy(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = lambda order: {"receive_btc": "0.00000000", "spend_rp": 0, "remain_rp": 50000}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("accepted the buy of BTC but no BTC arrived", self.bridge.state["tripped"])

    # ---- a lost buy answer: Indodax is asked what became of the order

    def test_lost_buy_answer_that_indodax_confirms_records_the_copy_without_the_stop(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.exchange.known[BUY_NAME] = {"status": "filled", "side": "buy", "receive_btc": "0.00004980"}
        self.bridge.cycle()
        position = self.bridge.state["positions"][BTC]
        self.assertTrue(position["real"])
        self.assertAlmostEqual(position["quantity"], 0.0000498, delta=1e-12)  # the smaller of the balance and the record
        self.assertLessEqual(position["quantity"], self.exchange.free["btc"])
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(self.exchange.lookups, [BUY_NAME])
        self.assertIn("Indodax confirms the order was filled", self.text())
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)

    def test_lost_buy_answer_for_an_order_indodax_cancelled_buys_nothing_and_does_not_stop(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.lose
        self.exchange.known[BUY_NAME] = {"status": "cancelled", "side": "buy", "order_rp": "50000", "remain_rp": "50000"}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertIn("nothing was bought", self.text())
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)  # the signal stays used: never a second buy for it

    def test_lost_buy_answer_for_an_order_still_open_stops_without_a_copy(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.lose
        self.exchange.known[BUY_NAME] = {"status": "open", "side": "buy", "order_rp": "50000", "remain_rp": "50000"}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("still open at Indodax", self.bridge.state["tripped"])

    def test_a_filled_record_without_the_coin_in_the_balance_records_no_copy(self):
        self.make(BTC, real=True)
        self.exchange.on_trade = self.exchange.lose
        self.exchange.known[BUY_NAME] = {"status": "filled", "side": "buy", "receive_btc": "0.00004985"}
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})  # the record alone never makes a copy
        self.assertIn("shows the order as filled, but no BTC shows in your balance", self.bridge.state["tripped"])

    def test_lost_buy_answer_with_part_arrived_and_the_rest_open_records_the_part_and_stops(self):
        self.make(BTC, real=True)

        def part_then_lose(order):
            self.exchange.free["idr"] -= 20_000
            self.exchange.free["btc"] = self.exchange.free.get("btc", 0.0) + 0.00002
            raise bridge.ExchangeError(LOST, unsure=True)

        self.exchange.on_trade = part_then_lose
        self.exchange.known[BUY_NAME] = {"status": "open", "side": "buy", "order_rp": "50000", "remain_rp": "30000"}
        self.bridge.cycle()
        position = self.bridge.state["positions"][BTC]
        self.assertAlmostEqual(position["quantity"], 0.00002, delta=1e-12)
        self.assertAlmostEqual(position["spent"], 20_000.0)
        self.assertIn("the rest is still open at Indodax", self.bridge.state["tripped"])

    def test_an_unclear_record_changes_nothing_about_a_lost_buy(self):
        unclear = (
            {"status": "pending", "side": "buy", "receive_btc": "0.00004985"},  # a state the sender does not know
            {"status": "filled", "side": "sell", "receive_btc": "0.00004985"},  # not the buy that was sent
            {"status": "cancelled", "side": "buy"},  # cancelled, but no amounts to show nothing was bought
        )
        for index, record in enumerate(unclear):
            for arrived in (False, True):
                with self.subTest(record=record, arrived=arrived):
                    self.state_path = Path(self.folder.name) / f"unclear_{index}_{int(arrived)}.json"
                    self.logs.clear()
                    self.make(BTC, real=True)
                    self.exchange.on_trade = self.exchange.fill_then_lose_answer if arrived else self.exchange.lose
                    self.exchange.known[BUY_NAME] = record
                    self.bridge.cycle()
                    self.assertEqual(self.exchange.lookups, [BUY_NAME])
                    if arrived:
                        self.assertAlmostEqual(self.bridge.state["positions"][BTC]["quantity"], self.exchange.free["btc"], delta=1e-12)
                        self.assertIn("was lost, but the coin arrived, so the copy is recorded", self.bridge.state["tripped"])
                    else:
                        self.assertEqual(self.bridge.state["positions"], {})
                        self.assertIn("no BTC has arrived so far", self.bridge.state["tripped"])

    def test_an_answered_buy_is_never_looked_up(self):
        self.make(BTC, real=True)
        self.bridge.cycle()
        self.assertEqual(self.exchange.lookups, [])

    def test_every_real_order_passes_the_gate(self):
        btc = pair("btc")
        name = f"tb-btc-{SIGNAL}-b"
        practice = self.make()
        with self.assertRaises(bridge.Refused):
            practice.send_order("buy", BTC, pair=btc, idr=50_000, client_order_id=name)
        no_sentence = self.make(real=True, confirmed=False)
        with self.assertRaises(bridge.Refused):
            no_sentence.send_order("buy", BTC, pair=btc, idr=50_000, client_order_id=name)
        no_keys = self.make(real=True, api_secret="")
        with self.assertRaises(bridge.Refused):
            no_keys.send_order("buy", BTC, pair=btc, idr=50_000, client_order_id=name)

        real = self.make(real=True)
        for amount in (50_001, 49_999, 5_000_000, None):
            with self.assertRaises(bridge.Refused, msg=amount):
                real.send_order("buy", BTC, pair=btc, idr=amount, client_order_id=name)
        with self.assertRaises(bridge.Refused):
            real.send_order("buy", BTC, pair=btc, idr=50_000, client_order_id="")
        with self.assertRaises(bridge.Refused):
            real.send_order("buy", BTC, pair=None, idr=50_000, client_order_id=name)
        with self.assertRaises(bridge.Refused):
            real.send_order("short", BTC, pair=btc, idr=50_000, client_order_id=name)

        real.state["tripped"] = "look first"
        with self.assertRaises(bridge.Refused):
            real.send_order("buy", BTC, pair=btc, idr=50_000, client_order_id=name)
        real.state["tripped"] = ""

        real.open_copy(BTC, btc, 0.0001, 50_000, SIGNAL, real=True)
        with self.assertRaises(bridge.Refused):
            real.send_order("buy", BTC, pair=btc, idr=50_000, client_order_id=name)
        real.open_copy(ETH, pair("eth"), 0.001, 50_000, SIGNAL, real=False)
        with self.assertRaises(bridge.Refused):
            real.send_order("buy", DOGE, pair=pair("doge"), idr=50_000, client_order_id=name)  # two are open already
        with self.assertRaises(bridge.Refused):
            real.send_order("sell", ETH, quantity="0.001", client_order_id="tb-eth-1-s0")  # a practice copy
        with self.assertRaises(bridge.Refused):
            real.send_order("sell", DOGE, quantity="1", client_order_id="tb-doge-1-s0")  # no copy at all
        for quantity in ("0.00010001", "0", "-1"):
            with self.assertRaises(bridge.Refused, msg=quantity):
                real.send_order("sell", BTC, quantity=quantity, client_order_id="tb-btc-1-s0")
        self.assertEqual(self.exchange.orders, [])

        self.exchange.free["btc"] = 0.0001
        real.send_order("sell", BTC, quantity="0.0001", client_order_id="tb-btc-1-s0")
        self.assertEqual(len(self.exchange.orders), 1)

    def test_a_real_buy_waits_for_the_key_check(self):
        self.make(BTC, real=True, checked=False).cycle()
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertIn("--check", self.text())
        self.assertFalse(self.api.reports[-1]["checked"])
        with self.assertRaises(bridge.Refused):
            self.bridge.send_order("buy", BTC, pair=pair("btc"), idr=50_000, client_order_id=f"tb-btc-{SIGNAL}-b")
        self.assertEqual(self.exchange.orders, [])

    def test_a_check_counts_only_for_the_key_it_was_made_with(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = bridge.check(self.settings(real=True), FakeExchange(), self.state_path)
        self.assertEqual(code, 0)
        self.assertIn("marked as checked", output.getvalue())
        self.assertNotIn("API-KEY-VALUE", self.state_path.read_text(encoding="utf-8"))

        same_key = self.make(BTC, real=True, checked=False)
        self.assertTrue(same_key.checked)
        same_key.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        self.assertTrue(self.api.reports[-1]["checked"])

        other_key = self.make(ETH, real=True, checked=False, api_key="ANOTHER-KEY")
        self.assertFalse(other_key.checked)
        other_key.cycle()
        self.assertEqual(self.exchange.orders, [])

    def test_a_failed_check_marks_nothing(self):
        exchange = FakeExchange()
        exchange.balance_errors = [bridge.ExchangeError("Invalid credentials.")]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bridge.check(self.settings(real=True), exchange, self.state_path), 1)
        self.assertFalse(self.state_path.exists())
        self.assertFalse(self.make(real=True, checked=False).checked)

    def test_pause_from_telegram_stops_real_buys_but_not_sells(self):
        self.bought(BTC)
        self.api.hold(ETH)
        self.api.pause()
        self.bridge.cycle()
        sides = [order["side"] for order in self.exchange.orders]
        self.assertEqual(sides, ["sell"])
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("paused from Telegram", self.text())
        self.assertTrue(self.api.reports[-1]["paused"])
        with self.assertRaises(bridge.Refused):
            self.bridge.send_order("buy", ETH, pair=pair("eth"), idr=50_000, client_order_id=f"tb-eth-{SIGNAL}-b")

        self.api.pause(False)
        self.bridge.cycle()
        self.assertEqual([order["side"] for order in self.exchange.orders], ["sell", "buy"])
        self.assertFalse(self.api.reports[-1]["paused"])

    def bought(self, *symbols, **changes):
        self.make(*(symbols or (BTC,)), real=True, **changes).cycle()
        self.assertEqual(self.bridge.state["tripped"], "")
        self.exchange.orders.clear()
        return self.bridge

    def test_sell_is_never_more_than_the_copy_and_uses_the_rupiah_that_arrived(self):
        self.bought()
        self.exchange.free["btc"] += 1.0  # his own bitcoin in the same account
        copy = self.bridge.state["positions"][BTC]["quantity"]
        idr_before = self.exchange.free["idr"]
        self.api.hold()
        self.bridge.cycle()
        order = self.exchange.orders[0]
        self.assertEqual((order["side"], order["coin"], order["name"]), ("sell", "btc", f"tb-btc-{SIGNAL}-s0"))
        self.assertEqual(order["quantity"], "0.00004985")
        self.assertAlmostEqual(float(order["quantity"]), copy)
        self.assertAlmostEqual(self.exchange.free["btc"], 1.0, places=7)
        closed = self.bridge.state["closed"][-1]
        self.assertAlmostEqual(closed["received"], self.exchange.free["idr"] - idr_before)
        self.assertTrue(closed["real"])
        self.assertAlmostEqual(self.bridge.state["result"]["real"], closed["received"] - 50_000)
        self.assertEqual(self.bridge.state["result"]["practice"], 0.0)
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("REAL MONEY: sold BTC", self.text())

    def test_sell_is_never_more_than_what_is_there(self):
        self.bought()
        self.exchange.free["btc"] = 0.00003
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders[0]["quantity"], "0.00003")

    def test_coin_gone_closes_the_copy_without_an_order(self):
        self.bought()
        self.exchange.free["btc"] = 0.0
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertEqual(self.bridge.state["closed"][-1]["how"], "gone")
        self.assertEqual(self.bridge.state["result"]["real"], 0.0)

    def test_dust_stays_in_the_account_without_an_order(self):
        self.bought()
        self.exchange.free["btc"] = 0.000001  # worth Rp1.000, below the Rp10.000 minimum
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders, [])
        self.assertEqual(self.bridge.state["closed"][-1]["how"], "left")

    def test_lost_sell_answer_is_settled_by_the_balance_and_never_sold_twice(self):
        self.bought()
        self.exchange.free["btc"] += 1.0
        idr_before = self.exchange.free["idr"]
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.api.hold()
        self.bridge.cycle()
        self.assertIn("unsure", self.bridge.state["positions"][BTC])
        self.assertIn("could not be confirmed", self.bridge.state["tripped"])
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)  # his own bitcoin was not touched
        self.assertAlmostEqual(self.exchange.free["btc"], 1.0, places=7)
        closed = self.bridge.state["closed"][-1]
        self.assertAlmostEqual(closed["received"], self.exchange.free["idr"] - idr_before)
        self.assertNotIn("estimated", closed)
        self.assertEqual(self.bridge.state["positions"], {})

    def test_lost_sell_that_never_arrived_is_tried_again_under_the_same_name(self):
        self.bought()
        self.exchange.on_trade = self.exchange.lose
        self.api.hold()
        self.bridge.cycle()
        self.assertIn("unsure", self.bridge.state["positions"][BTC])
        self.exchange.balance_errors = [bridge.ExchangeError("Indodax answered HTTP 503")]
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)  # balance unreadable: nothing is sent
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [f"tb-btc-{SIGNAL}-s0"] * 2)
        self.assertEqual(self.bridge.state["positions"], {})

    def test_a_sale_that_never_left_this_pc_stops_nothing_and_goes_out_next_minute_under_the_same_name(self):
        self.bought()
        self.exchange.on_trade = self.exchange.never_leave
        self.api.hold()
        self.bridge.cycle()
        position = self.bridge.state["positions"][BTC]
        self.assertNotIn("unsure", position)
        self.assertFalse(position.get("sells"))
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(self.exchange.lookups, [])
        self.assertIn("The sale of BTC never left this PC", "\n".join(self.api.reports[-1]["notes"]))
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [SELL_NAME, SELL_NAME])
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(len(self.bridge.state["closed"]), 1)

    def test_accepted_sell_without_rupiah_is_not_counted_as_sold(self):
        self.bought()
        self.exchange.on_trade = lambda order: {"receive_rp": 0}
        self.api.hold()
        self.bridge.cycle()
        self.assertIn("unsure", self.bridge.state["positions"][BTC])
        self.assertEqual(self.bridge.state["closed"], [])

    def test_refused_sell_trips_and_is_tried_again_under_a_new_name(self):
        self.bought()
        self.exchange.on_trade = self.exchange.refuse
        self.api.hold()
        self.bridge.cycle()
        self.assertIn(BTC, self.bridge.state["positions"])
        self.assertIn("refused the sale of BTC", self.bridge.state["tripped"])
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()  # selling goes on under the safety stop
        self.assertEqual([order["name"][-2:] for order in self.exchange.orders], ["s0", "s1"])
        self.assertEqual(self.bridge.state["positions"], {})

    def test_a_name_indodax_already_has_means_the_sale_arrived(self):
        self.bought()

        def duplicate(order):
            raise bridge.ExchangeError(f"client order id {order['name']} already exists")

        self.exchange.on_trade = duplicate
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertTrue(self.bridge.state["closed"][-1]["estimated"])
        self.assertTrue(self.bridge.state["tripped"])

    # ---- an unsure sale: Indodax's record of the order decides when it is clear

    def duplicate(self, order):
        raise bridge.ExchangeError(f"client order id {order['name']} already exists")

    def sold_record(self, received="49500"):
        return {"status": "filled", "side": "sell", "order_btc": "0.00004985", "remain_btc": "0.00000000", "receive_idr": received}

    def cancelled_record(self, left="0.00004985"):
        return {"status": "cancelled", "side": "sell", "order_btc": "0.00004985", "remain_btc": left, "receive_idr": "0"}

    def test_lost_sell_answer_that_indodax_confirms_closes_the_copy_at_once_with_the_exact_amount(self):
        self.bought()
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.exchange.known[SELL_NAME] = self.sold_record()
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        closed = self.bridge.state["closed"][-1]
        self.assertEqual(closed["received"], 49_500.0)
        self.assertNotIn("estimated", closed)
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertEqual(self.exchange.lookups, [SELL_NAME])
        self.assertEqual(len(self.exchange.orders), 1)
        self.assertIn("Indodax's record of the order confirms it", self.text())

    def test_an_unsure_sale_is_settled_by_indodax_record_before_the_balance(self):
        self.bought()
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"][BTC]["unsure"]["name"], SELL_NAME)
        self.assertIn("could not be confirmed", self.bridge.state["tripped"])
        self.exchange.known[SELL_NAME] = self.sold_record()
        self.exchange.free["idr"] += 123_456.0  # his own deposit: the balance alone would overstate the sale
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        closed = self.bridge.state["closed"][-1]
        self.assertEqual(closed["received"], 49_500.0)
        self.assertNotIn("estimated", closed)
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertIn("as Indodax's record of the order shows", self.text())

    def test_a_sale_indodax_cancelled_untouched_is_sent_again_under_a_new_name(self):
        self.bought()
        self.exchange.on_trade = self.exchange.lose
        self.api.hold()
        self.bridge.cycle()
        self.assertIn("unsure", self.bridge.state["positions"][BTC])
        self.exchange.known[SELL_NAME] = self.cancelled_record()
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [SELL_NAME, SELL_AGAIN])
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertNotIn("estimated", self.bridge.state["closed"][-1])

    def test_a_sale_still_open_at_indodax_sends_nothing_new_until_it_is_settled(self):
        self.bought()
        self.exchange.on_trade = self.exchange.lose
        self.exchange.known[SELL_NAME] = {"status": "open", "side": "sell", "order_btc": "0.00004985", "remain_btc": "0.00004985"}
        self.api.hold()
        self.bridge.cycle()
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        self.assertEqual(self.bridge.state["positions"][BTC]["unsure"]["name"], SELL_NAME)
        self.assertIn("still open at Indodax", self.text())
        self.exchange.known[SELL_NAME] = self.cancelled_record()
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [SELL_NAME, SELL_AGAIN])
        self.assertEqual(self.bridge.state["positions"], {})

    def test_a_partly_sold_then_cancelled_sale_is_never_sent_under_a_new_name(self):
        self.bought()
        self.exchange.free["btc"] += 1.0  # his own bitcoin in the same account

        def part_then_lose(order):
            part = float(order["quantity"]) * 0.2
            self.exchange.free["btc"] -= part
            self.exchange.free["idr"] += part * 1_000_000_000.0 * 0.998
            raise bridge.ExchangeError(LOST, unsure=True)

        self.exchange.on_trade = part_then_lose
        self.api.hold()
        self.bridge.cycle()
        self.exchange.known[SELL_NAME] = self.cancelled_record(left="0.00003988")
        self.exchange.on_trade = self.duplicate
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [SELL_NAME, SELL_NAME])
        self.assertEqual(self.bridge.state["positions"], {})
        self.assertTrue(self.bridge.state["closed"][-1]["estimated"])
        self.assertTrue(self.bridge.state["tripped"])
        self.assertIn("Its result is an estimate", self.text())
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 2)  # his own bitcoin is never sold to finish the job

    def test_a_name_indodax_already_has_and_shows_as_sold_gives_the_exact_result(self):
        self.bought()
        self.exchange.on_trade = self.duplicate
        self.exchange.known[SELL_NAME] = self.sold_record()
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"], {})
        closed = self.bridge.state["closed"][-1]
        self.assertEqual(closed["received"], 49_500.0)
        self.assertNotIn("estimated", closed)
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertIn("was sold already, for Rp49.500", self.text())

    def test_a_name_indodax_already_has_for_a_cancelled_sale_is_retried_under_a_new_name(self):
        self.bought()
        self.exchange.on_trade = self.duplicate
        self.exchange.known[SELL_NAME] = self.cancelled_record()
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"][BTC]["sells"], 1)
        self.assertNotIn("unsure", self.bridge.state["positions"][BTC])
        self.assertEqual(self.bridge.state["tripped"], "")
        self.assertIn("under a new name", self.text())
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual([order["name"] for order in self.exchange.orders], [SELL_NAME, SELL_AGAIN])
        self.assertEqual(self.bridge.state["positions"], {})

    def test_a_name_indodax_already_has_for_a_sale_still_open_waits(self):
        self.bought()
        self.exchange.on_trade = self.duplicate
        self.exchange.known[SELL_NAME] = {"status": "open", "side": "sell", "order_btc": "0.00004985", "remain_btc": "0.00004985"}
        self.api.hold()
        self.bridge.cycle()
        self.assertEqual(self.bridge.state["positions"][BTC]["unsure"]["name"], SELL_NAME)
        self.assertEqual(self.bridge.state["closed"], [])
        self.assertIn("could not be confirmed", self.bridge.state["tripped"])
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        self.assertIn(BTC, self.bridge.state["positions"])

    def test_an_unsure_mark_from_before_names_were_kept_is_still_looked_up(self):
        self.bought()
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.api.hold()
        self.bridge.cycle()
        del self.bridge.state["positions"][BTC]["unsure"]["name"]  # as the earlier version wrote it
        self.exchange.lookups.clear()
        self.exchange.known[SELL_NAME] = self.sold_record()
        self.bridge.cycle()
        self.assertEqual(self.exchange.lookups, [SELL_NAME])
        self.assertEqual(self.bridge.state["closed"][-1]["received"], 49_500.0)

    def test_a_sold_record_without_an_amount_falls_back_to_the_balance(self):
        self.bought()
        idr_before = self.exchange.free["idr"]
        self.exchange.on_trade = self.exchange.fill_then_lose_answer
        self.exchange.known[SELL_NAME] = {"status": "filled", "side": "sell"}
        self.api.hold()
        self.bridge.cycle()
        self.assertIn("unsure", self.bridge.state["positions"][BTC])
        self.exchange.on_trade = self.exchange.fill
        self.bridge.cycle()
        self.assertEqual(len(self.exchange.orders), 1)
        closed = self.bridge.state["closed"][-1]
        self.assertAlmostEqual(closed["received"], self.exchange.free["idr"] - idr_before)
        self.assertNotIn("estimated", closed)

    def test_a_record_of_the_wrong_side_or_state_changes_nothing_about_an_unsure_sale(self):
        for index, record in enumerate(({"status": "filled", "side": "buy", "receive_idr": "49500"}, {"status": "pending", "side": "sell", "receive_idr": "49500"})):
            with self.subTest(record=record):
                self.state_path = Path(self.folder.name) / f"unclear_sale_{index}.json"
                self.bought()
                idr_before = self.exchange.free["idr"]
                self.exchange.on_trade = self.exchange.fill_then_lose_answer
                self.exchange.known[SELL_NAME] = record
                self.api.hold()
                self.bridge.cycle()
                self.assertIn("unsure", self.bridge.state["positions"][BTC])
                self.bridge.cycle()
                closed = self.bridge.state["closed"][-1]
                self.assertAlmostEqual(closed["received"], self.exchange.free["idr"] - idr_before)  # the balance, as before
                self.assertEqual(len(self.exchange.orders), 1)

    def test_own_stop_sells_a_real_copy(self):
        self.bought()
        self.exchange.tickers["btcidr"] = {"bid": 900_000_000.0, "ask": 901_000_000.0}
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders[0]["side"], "sell")
        self.assertLess(self.bridge.state["result"]["real"], 0)

    def test_a_real_copy_is_sold_for_real_after_a_switch_back_to_practice(self):
        self.bought()
        exchange = self.exchange
        api = FakeApi()
        practice = bridge.Settings(key="k", api_key="API-KEY-VALUE", api_secret="API-SECRET-VALUE")
        bridge.Bridge(exchange, practice, api, self.state_path, log=self.logs.append, clock=self.clock).cycle()
        self.assertEqual(exchange.orders[0]["side"], "sell")
        self.assertEqual(api.reports[-1]["mode"], "practice")

    def test_a_real_copy_without_keys_is_left_alone_and_said_so(self):
        self.bought()
        exchange = self.exchange
        again = bridge.Bridge(exchange, bridge.Settings(key="k"), FakeApi(ETH), self.state_path, log=self.logs.append, clock=self.clock)
        again.cycle()
        self.assertEqual(exchange.orders, [])
        self.assertTrue(again.state["positions"][BTC]["real"])
        self.assertFalse(again.state["positions"][ETH]["real"])  # new copies are practice now
        self.assertIn("API key is gone", self.text())

    def test_a_real_daily_loss_stops_real_buys(self):
        self.bought()
        self.bridge.state["day"]["real"] = -50_000.0
        self.api.hold(BTC, ETH)
        self.bridge.cycle()
        self.assertEqual(self.exchange.orders, [])

    def test_private_details_never_reach_logs_state_or_reports(self):
        clock = self.clock
        book = {"idr": 250000.0, "btc": 0.0}

        def handler(request):
            url = request.full_url
            if url.endswith("/api/server_time"):
                return {"server_time": int(clock.now * 1000)}
            if url.endswith("/api/pairs"):
                return [{"id": "btcidr", "ticker_id": "btc_idr", "base_currency": "idr", "traded_currency": "btc", "trade_min_base_currency": 10000, "trade_fee_percent_taker": 0.2}]
            if "/api/ticker/" in url:
                return {"ticker": {"buy": "1000000000", "sell": "1001000000"}}
            fields = dict(urllib.parse.parse_qsl(request.data.decode("utf-8")))
            if fields["method"] == "trade" and fields["type"] == "buy":
                book["idr"] -= 50000
                book["btc"] += 0.00004985
                return {"success": 1, "return": {"receive_btc": "0.00004985", "spend_rp": 50000, "remain_rp": 0, "order_id": 1, "name": OWNER_NAME}}
            if fields["method"] == "trade":
                book["btc"] -= float(fields["btc"])
                book["idr"] += 49000
                return {"success": 1, "return": {"receive_rp": 49000, "email": OWNER_EMAIL}}
            answer = json.loads(json.dumps(GET_INFO))
            answer["return"]["balance"] = {"idr": book["idr"], "btc": f"{book['btc']:.8f}"}
            return answer

        settings = self.settings(real=True)
        opener = FakeOpener(handler)
        api = FakeApi(BTC)
        exchange = bridge.Indodax(settings, clock=clock, opener=opener)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bridge.check(settings, exchange, self.state_path), 0)
        sender = bridge.Bridge(exchange, settings, api, self.state_path, log=self.logs.append, clock=clock)
        sender.cycle()
        self.assertTrue(sender.state["positions"][BTC]["real"])
        api.hold()
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(sender.state["tripped"], "")
        everything = self.text() + self.state_path.read_text(encoding="utf-8") + json.dumps(api.reports)
        for private in (OWNER_NAME, OWNER_EMAIL, OWNER_ADDRESS, "987654", "verified", "API-KEY-VALUE", "API-SECRET-VALUE", "250000", "200000"):
            self.assertNotIn(private, everything, private)
        self.assertEqual(sum(1 for item in opener.requests if item.full_url.endswith("/tapi") and b"method=trade" in item.data), 2)

    def test_private_details_in_an_order_lookup_never_reach_logs_state_or_reports(self):
        clock = self.clock
        book = {"idr": 250000.0, "btc": 0.0}
        asked = []

        def handler(request):
            url = request.full_url
            if url.endswith("/api/server_time"):
                return {"server_time": int(clock.now * 1000)}
            if url.endswith("/api/pairs"):
                return [{"id": "btcidr", "ticker_id": "btc_idr", "base_currency": "idr", "traded_currency": "btc", "trade_min_base_currency": 10000, "trade_fee_percent_taker": 0.2}]
            if "/api/ticker/" in url:
                return {"ticker": {"buy": "1000000000", "sell": "1001000000"}}
            fields = dict(urllib.parse.parse_qsl(request.data.decode("utf-8")))
            if fields["method"] == "trade":
                # Both orders go through at Indodax, and both answers are lost on the way back.
                if fields["type"] == "buy":
                    book["idr"] -= 50000
                    book["btc"] += 0.00004985
                else:
                    book["btc"] -= float(fields["btc"])
                    book["idr"] += 49000
                return urllib.error.URLError("timed out")
            if fields["method"] == "getOrderByClientOrderId":
                name = fields["client_order_id"]
                asked.append(name)
                order = {"order_id": "59636253", "client_order_id": name, "status": "filled", "submit_time": "1763272800", "name": OWNER_NAME, "email": OWNER_EMAIL}
                if name.endswith("-b"):
                    order.update(type="buy", order_rp="50000", remain_rp="0", receive_btc="0.00004985")
                else:
                    order.update(type="sell", order_btc="0.00004985", remain_btc="0.00000000", receive_idr="49000")
                return {"success": 1, "return": {"order": order}}
            answer = json.loads(json.dumps(GET_INFO))
            answer["return"]["balance"] = {"idr": book["idr"], "btc": f"{book['btc']:.8f}"}
            return answer

        settings = self.settings(real=True)
        opener = FakeOpener(handler)
        api = FakeApi(BTC)
        exchange = bridge.Indodax(settings, clock=clock, opener=opener)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bridge.check(settings, exchange, self.state_path), 0)
        sender = bridge.Bridge(exchange, settings, api, self.state_path, log=self.logs.append, clock=clock)
        sender.cycle()
        self.assertAlmostEqual(sender.state["positions"][BTC]["quantity"], 0.00004985, delta=1e-12)
        api.hold()
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(sender.state["closed"][-1]["received"], 49_000.0)
        self.assertEqual(sender.state["tripped"], "")  # Indodax's own record settled both, so nothing was guessed
        self.assertEqual(asked, [BUY_NAME, SELL_NAME])
        everything = self.text() + self.state_path.read_text(encoding="utf-8") + json.dumps(api.reports)
        for private in (OWNER_NAME, OWNER_EMAIL, OWNER_ADDRESS, "987654", "59636253", "verified", "API-KEY-VALUE", "API-SECRET-VALUE", "250000", "200000"):
            self.assertNotIn(private, everything, private)
        self.assertEqual(sum(1 for item in opener.requests if item.full_url.endswith("/tapi") and b"method=trade" in item.data), 2)


# ---------------------------------------------------------------- the Indodax client, Trade API 2.0

V2 = "https://api.indodax.com"
PAIR_ROW = {"id": "btcidr", "ticker_id": "btc_idr", "base_currency": "idr", "traded_currency": "btc", "trade_min_base_currency": 10000, "trade_fee_percent_taker": 0.2}


def refusal(status, code, message):
    """An error answer the way Trade API 2.0 gives it: an HTTP error with {"code", "msg"} inside."""
    body = io.BytesIO(json.dumps({"code": code, "msg": message}).encode("utf-8"))
    return urllib.error.HTTPError(V2, status, "error", {}, body)


class FakeV2:
    """Indodax seen through Trade API 2.0: an account, market orders, and the trades they made."""

    def __init__(self, clock, idr=250_000.0):
        self.clock = clock
        self.book = {"idr": float(idr), "btc": 0.0}
        self.orders = {}  # order name -> the order as Indodax keeps it
        self.trades = []
        self.posts = []
        self.refuse = None  # the next order is refused with this answer
        self.lose_answers = False  # orders go through, but their answers never arrive
        self.trades_hidden = False  # the trade list is not readable (yet)
        self.rights = {"canTrade": True, "canWithdraw": False, "canWithdrawFiat": False}
        self.bid, self.ask = 1_000_000_000.0, 1_001_000_000.0

    def __call__(self, request):
        url = urllib.parse.urlsplit(request.full_url)
        if url.path == "/api/server_time":
            return {"server_time": int(self.clock.now * 1000)}
        if url.path == "/api/pairs":
            return [PAIR_ROW]
        if url.path.startswith("/api/ticker/"):
            return {"ticker": {"buy": str(int(self.bid)), "sell": str(int(self.ask))}}
        if request.get_method() == "POST":
            fields = dict(urllib.parse.parse_qsl(request.data.decode("utf-8")))
        else:
            fields = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/api/v2/account":
            balances = [{"asset": coin.upper(), "free": f"{amount:.8f}", "locked": "0"} for coin, amount in self.book.items()]
            return {"uid": "987654", "email": OWNER_EMAIL, **self.rights, "balances": balances}
        if url.path == "/api/v2/order" and request.get_method() == "POST":
            return self.place(fields)
        if url.path == "/api/v2/order":
            order = self.orders.get(fields.get("origClientOrderId"))
            return dict(order) if order else refusal(404, -2013, "Order does not exist.")
        if url.path == "/api/v2/myTrades":
            if self.trades_hidden:
                return refusal(500, -1001, "Internal error.")
            return {"data": [dict(row) for row in self.trades if row["clientOrderId"] == fields.get("clientOrderId")]}
        return refusal(404, -1000, "Unknown path.")

    def place(self, fields):
        self.posts.append(fields)
        if self.refuse is not None:
            answer, self.refuse = self.refuse, None
            return answer
        name = fields["newClientOrderId"]
        if name in self.orders:
            return refusal(400, -2010, "Order rejected.")
        buying = fields["side"] == "BUY"
        if buying:
            spent = float(fields["quoteOrderQty"])
            fee = round(spent * 0.003)
            quantity = round((spent - fee) / self.ask, 8)
            self.book["idr"] -= spent
            self.book["btc"] += quantity
            value = spent - fee
        else:
            quantity = float(fields["quantity"])
            value = round(quantity * self.bid)
            fee = round(value * 0.003)
            self.book["btc"] -= quantity
            self.book["idr"] += value - fee
        number = 6423 + len(self.orders)
        order = {"symbol": fields["symbol"], "orderId": number, "clientOrderId": name, "side": fields["side"], "type": "MARKET", "origQty": f"{quantity:.8f}", "executedQty": f"{quantity:.8f}", "status": "FILLED", "time": int(self.clock.now * 1000), "fullOrderId": f"btcidr-market-{number}"}
        self.orders[name] = order
        self.trades.append({"tradeId": str(72057594037936570 + number), "orderId": order["fullOrderId"], "clientOrderId": name, "symbol": "btcidr", "price": str(int(self.ask if buying else self.bid)), "qty": f"{quantity:.8f}", "quoteQty": str(int(value)), "commission": str(int(fee)), "commissionAsset": "idr", "isBuyer": buying, "isMaker": False, "time": int(self.clock.now * 1000)})
        if self.lose_answers:
            return urllib.error.URLError("timed out")
        return {key: order[key] for key in ("symbol", "orderId", "clientOrderId", "side", "type", "origQty", "executedQty", "fullOrderId")}


class ClientV2Tests(unittest.TestCase):
    def client(self, server=None, **changes):
        values = {"api_key": "API-KEY-VALUE", "api_secret": "API-SECRET-VALUE"}
        values.update(changes)
        self.clock = Clock()
        self.server = server or FakeV2(self.clock)
        self.opener = FakeOpener(self.server)
        self.waits = []
        return bridge.IndodaxV2(bridge.Settings(**values), clock=self.clock, opener=self.opener, sleep=self.waits.append)

    def private(self):
        return [item for item in self.opener.requests if item.full_url.startswith(V2 + "/")]

    def test_signature_matches_the_example_in_indodax_docs(self):
        payload = "symbol=btcidr&limit=100&timestamp=1578304294000&recvWindow=5000"
        secret = "f60617a68fcce028f0a90bc9eb765d17379eb548cc935c01a7ee3186eecf870e9b68f27a31bcfe8d"
        self.assertEqual(bridge.sign_v2(payload, secret), "58b503019a8f2754af7097b4d981913a8dca9e5cb2b408061cbd48736a940558")

    def test_the_newer_api_is_the_default_and_the_older_one_can_be_asked_for(self):
        self.assertIsInstance(bridge.exchange_for(bridge.settings_from({})), bridge.IndodaxV2)
        older = bridge.exchange_for(bridge.settings_from({"INDODAX_API_VERSION": "1"}))
        self.assertNotIsInstance(older, bridge.IndodaxV2)
        self.assertEqual(bridge.settings_from({"INDODAX_API_VERSION": "2"}).api_version, 2)
        for value in ("3", "v2", "0", "2.0"):
            with self.assertRaises(bridge.SettingsError, msg=value):
                bridge.settings_from({"INDODAX_API_VERSION": value})

    def test_a_read_is_signed_in_the_address_and_goes_only_to_indodax(self):
        client = self.client()
        self.server.clock = Clock(START - 2.5)  # Indodax's clock runs 2.5 s behind this PC's
        client.balances()
        request = self.private()[-1]
        address, query = request.full_url.split("?", 1)
        self.assertEqual(address, V2 + "/api/v2/account")
        self.assertEqual(request.get_method(), "GET")
        self.assertIsNone(request.data)
        self.assertEqual(request.get_header("X-apikey"), "API-KEY-VALUE")
        self.assertEqual(request.get_header("Sign"), bridge.sign_v2(query, "API-SECRET-VALUE"))
        self.assertEqual(request.get_header("User-agent"), bridge.CLIENT)
        fields = dict(urllib.parse.parse_qsl(query))
        self.assertEqual(fields["recvWindow"], "5000")
        self.assertEqual(int(fields["timestamp"]), int(START * 1000) - 2500)  # Indodax's clock, not this PC's
        self.assertNotIn("API-SECRET-VALUE", request.full_url)
        self.assertTrue(all(item.full_url.startswith(("https://indodax.com/", V2 + "/")) for item in self.opener.requests))

    def test_only_free_balances_are_kept_and_what_the_key_may_do(self):
        client = self.client()
        balances = client.balances()
        self.assertEqual(balances, {"idr": 250000.0, "btc": 0.0})
        self.assertEqual(client.rights, {"trade": True, "withdraw": False})
        kept = json.dumps(balances) + json.dumps(client.rights)
        for private in ("987654", OWNER_EMAIL):
            self.assertNotIn(private, kept)
        self.server.rights = {"canTrade": False, "canWithdraw": False, "canWithdrawFiat": True}
        client.balances()
        self.assertEqual(client.rights, {"trade": False, "withdraw": True})

    def test_a_buy_is_a_market_order_for_rupiah_and_reports_the_coins_its_trades_gave(self):
        client = self.client()
        answer = client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        request = next(item for item in self.private() if item.get_method() == "POST")
        body = request.data.decode("utf-8")
        self.assertEqual(request.full_url, V2 + "/api/v2/order")
        self.assertEqual(request.get_header("Sign"), bridge.sign_v2(body, "API-SECRET-VALUE"))
        fields = dict(urllib.parse.parse_qsl(body))
        self.assertEqual({key: fields[key] for key in ("symbol", "side", "type", "quoteOrderQty", "newClientOrderId")}, {"symbol": "BTCIDR", "side": "BUY", "type": "MARKET", "quoteOrderQty": "50000", "newClientOrderId": BUY_NAME})
        self.assertNotIn("quantity", fields)
        self.assertNotIn("price", fields)
        self.assertEqual(list(answer), ["receive_btc"])
        self.assertAlmostEqual(answer["receive_btc"], self.server.book["btc"], delta=1e-12)
        self.assertEqual(len(self.server.posts), 1)

    def test_a_sale_reports_the_rupiah_after_the_fee(self):
        client = self.client()
        client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        before = self.server.book["idr"]
        held = bridge.plain(bridge.floor_to(self.server.book["btc"], "0.00000001"))
        answer = client.trade("btc_idr", "sell", coin="btc", quantity=held, client_order_id=SELL_NAME)
        fields = self.server.posts[-1]
        self.assertEqual((fields["side"], fields["quantity"], fields["newClientOrderId"]), ("SELL", held, SELL_NAME))
        self.assertNotIn("quoteOrderQty", fields)
        self.assertEqual(answer, {"receive_rp": self.server.book["idr"] - before})

    def test_trades_that_are_not_readable_yet_give_an_empty_answer_and_no_second_order(self):
        client = self.client()
        self.server.trades_hidden = True
        self.assertEqual(client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME), {})
        self.assertEqual(len(self.server.posts), 1)
        self.assertEqual(self.waits, list(bridge.FILL_WAITS))  # it waited a moment between the tries

    def test_trades_of_other_orders_are_never_counted(self):
        client = self.client()
        client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        stranger = dict(self.server.trades[0], clientOrderId="someone-elses", qty="5")
        self.server.trades = [stranger]
        self.server.trades[0]["clientOrderId"] = BUY_NAME + "x"
        self.assertEqual(client.fills("BTCIDR", BUY_NAME), [])

    def test_a_name_used_before_is_told_apart_from_a_plain_refusal(self):
        client = self.client()
        client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        with self.assertRaises(bridge.ExchangeError) as again:
            client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        self.assertTrue(bridge.name_taken(again.exception))
        self.assertFalse(again.exception.unsure)
        self.server.refuse = refusal(400, -2010, "Order rejected. Insufficient balance.")
        with self.assertRaises(bridge.ExchangeError) as poor:
            client.trade("btc_idr", "buy", idr=50_000, client_order_id=SELL_NAME)
        self.assertFalse(bridge.name_taken(poor.exception))
        self.assertFalse(poor.exception.unsure)
        self.assertEqual(poor.exception.code, "-2010")
        self.assertIn("Insufficient balance", str(poor.exception))

    def test_a_refusal_that_cannot_be_looked_up_is_unsure(self):
        client = self.client()
        real_call = self.server.__call__

        def handler(request):
            if "/api/v2/order?" in request.full_url:
                return urllib.error.URLError("timed out")
            return real_call(request)

        self.opener.handler = handler
        self.server.refuse = refusal(400, -2010, "Order rejected.")
        with self.assertRaises(bridge.ExchangeError) as caught:
            client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        self.assertTrue(caught.exception.unsure)
        self.assertFalse(bridge.name_taken(caught.exception))

    def test_an_order_the_proxy_refused_never_reached_indodax_and_is_not_unsure(self):
        client = self.client()
        self.opener.handler = lambda request: REFUSED_407 if request.get_method() == "POST" else self.server(request)
        with self.assertRaises(bridge.ExchangeError) as caught:
            client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        self.assertTrue(caught.exception.unsent)
        self.assertFalse(caught.exception.unsure)
        self.assertEqual(self.server.posts, [])
        self.assertEqual(len([item for item in self.private() if item.get_method() == "POST"]), 1)  # sent once, not again
        self.assertEqual(self.server.book["btc"], 0.0)
        with self.assertRaises(bridge.ExchangeError) as reading:
            self.opener.handler = lambda request: REFUSED_407 if "/api/v2/" in request.full_url else self.server(request)
            client.balances()
        self.assertTrue(reading.exception.unsent)

    def test_a_refused_lookup_after_a_rejected_order_does_not_make_the_order_unsent(self):
        client = self.client()
        real_call = self.server.__call__
        self.opener.handler = lambda request: REFUSED_407 if "/api/v2/order?" in request.full_url else real_call(request)
        self.server.refuse = refusal(400, -2010, "Order rejected.")
        with self.assertRaises(bridge.ExchangeError) as caught:
            client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        self.assertTrue(caught.exception.unsure)  # the order itself did reach Indodax
        self.assertFalse(caught.exception.unsent)

    def test_a_lost_or_broken_answer_is_unsure_only_for_orders(self):
        for problem in (urllib.error.URLError("timed out"), TimeoutError(), refusal(500, -1001, "Internal error."), urllib.error.HTTPError(V2, 502, "bad", {}, None), "<html>not json</html>"):
            client = self.client()
            self.server.refuse = problem
            with self.assertRaises(bridge.ExchangeError, msg=repr(problem)) as ordering:
                client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
            self.assertTrue(ordering.exception.unsure, repr(problem))
            self.assertEqual(len(self.server.posts), 1, repr(problem))
        for problem in (refusal(429, -1003, "Too many requests."), refusal(400, -1130, "Invalid parameter value."), refusal(403, -2015, "Access denied.")):
            client = self.client()
            self.server.refuse = problem
            with self.assertRaises(bridge.ExchangeError, msg=repr(problem)) as ordering:
                client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
            self.assertFalse(ordering.exception.unsure, repr(problem))
        client = self.client()
        self.opener.handler = lambda request: urllib.error.URLError("timed out") if "/api/v2/" in request.full_url else self.server(request)
        with self.assertRaises(bridge.ExchangeError) as reading:
            client.balances()
        self.assertFalse(reading.exception.unsure)

    def test_a_refusal_is_clear_and_never_repeats_the_key(self):
        client = self.client()
        self.opener.handler = lambda request: refusal(401, -1002, "Invalid credentials for API-KEY-VALUE. " + "x" * 400) if "/api/v2/" in request.full_url else self.server(request)
        with self.assertRaises(bridge.ExchangeError) as caught:
            client.balances()
        self.assertEqual(caught.exception.code, "-1002")
        self.assertNotIn("API-KEY-VALUE", str(caught.exception))
        self.assertLessEqual(len(str(caught.exception)), 180)

    def test_a_timestamp_refusal_makes_it_read_indodax_clock_again(self):
        client = self.client()
        client.balances()
        clock_reads = sum(1 for item in self.opener.requests if item.full_url.endswith("/api/server_time"))
        self.opener.handler = lambda request: refusal(400, -1021, "Timestamp for this request is outside of the recvWindow.") if "/api/v2/" in request.full_url else self.server(request)
        with self.assertRaises(bridge.ExchangeError):
            client.balances()
        self.opener.handler = self.server
        client.balances()
        self.assertEqual(sum(1 for item in self.opener.requests if item.full_url.endswith("/api/server_time")), clock_reads + 1)

    def test_an_order_is_found_again_by_its_name(self):
        client = self.client()
        client.trade("btc_idr", "buy", idr=50_000, client_order_id=BUY_NAME)
        bought = client.order(BUY_NAME)
        self.assertEqual((bought["status"], bought["side"]), ("filled", "buy"))
        self.assertAlmostEqual(bought["receive_btc"], self.server.book["btc"], delta=1e-12)
        before = self.server.book["idr"]
        client.trade("btc_idr", "sell", coin="btc", quantity=f"{self.server.book['btc']:.8f}", client_order_id=SELL_NAME)
        sold = client.order(SELL_NAME)
        self.assertEqual((sold["status"], sold["side"]), ("filled", "sell"))
        self.assertEqual(sold["receive_idr"], self.server.book["idr"] - before)
        for kept in (bought, sold):
            self.assertNotIn("6423", json.dumps(kept))
            self.assertFalse(any(key.startswith(("order_", "remain_")) for key in kept))

    def test_an_order_that_traded_nothing_says_so_only_when_its_trades_agree(self):
        client = self.client()
        self.server.orders[SELL_NAME] = {"symbol": "BTCIDR", "orderId": 7, "clientOrderId": SELL_NAME, "side": "SELL", "type": "MARKET", "origQty": "0.00004985", "executedQty": "0", "status": "CANCELLED"}
        untouched = client.order(SELL_NAME)
        self.assertEqual(untouched, {"status": "cancelled", "side": "sell", "order_btc": 0.00004985, "remain_btc": 0.00004985})
        self.server.trades_hidden = True  # the trades cannot be read: nothing is claimed either way
        self.assertEqual(client.order(SELL_NAME), {"status": "cancelled", "side": "sell"})

    def test_order_states_are_put_in_the_senders_words(self):
        client = self.client()
        for said, meant in (("NEW", "open"), ("PARTIALLY_FILLED", "open"), ("FILLED", "filled"), ("CANCELLED", "cancelled"), ("CANCELED", "cancelled"), ("REJECTED", "cancelled"), ("EXPIRED", "cancelled"), ("SOMETHING_NEW", "")):
            self.server.orders[BUY_NAME] = {"clientOrderId": BUY_NAME, "side": "BUY", "origQty": "0", "executedQty": "0", "status": said}
            self.assertEqual(client.order(BUY_NAME)["status"], meant, said)

    def test_an_order_lookup_refuses_names_it_did_not_make_and_answers_about_other_orders(self):
        client = self.client()
        for name in ("someone-elses", "tb-xyz-1-b", ""):
            with self.assertRaises(bridge.ExchangeError, msg=name):
                client.order(name)
        self.assertEqual(self.private(), [])
        self.server.orders[BUY_NAME] = {"clientOrderId": SELL_NAME, "side": "BUY", "status": "FILLED"}
        with self.assertRaises(bridge.ExchangeError):
            client.order(BUY_NAME)
        with self.assertRaises(bridge.ExchangeError) as missing:
            client.order(SELL_AGAIN)
        self.assertEqual(missing.exception.code, "-2013")


class RealModeV2(Case):
    """The whole sender against Trade API 2.0: a buy, a sale, and lost answers."""

    def start(self, **server_changes):
        self.server = FakeV2(self.clock)
        for name, value in server_changes.items():
            setattr(self.server, name, value)
        self.opener = FakeOpener(self.server)
        self.api = FakeApi(BTC)
        settings = self.settings(real=True)
        self.exchange = bridge.exchange_for(settings, clock=self.clock, opener=self.opener, sleep=lambda seconds: None)
        self.assertIsInstance(self.exchange, bridge.IndodaxV2)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bridge.check(settings, self.exchange, self.state_path), 0)
        return bridge.Bridge(self.exchange, settings, self.api, self.state_path, log=self.logs.append, clock=self.clock)

    def everything(self):
        return self.text() + self.state_path.read_text(encoding="utf-8") + json.dumps(self.api.reports)

    def test_a_buy_and_a_sale_go_through_and_nothing_private_is_kept(self):
        sender = self.start()
        sender.cycle()
        held = sender.state["positions"][BTC]
        self.assertTrue(held["real"])
        self.assertAlmostEqual(held["quantity"], self.server.book["btc"], delta=1e-12)
        self.api.hold()
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(sender.state["tripped"], "")
        self.assertEqual(sender.state["closed"][-1]["received"], self.server.book["idr"] - 200_000.0)
        self.assertEqual([item["side"] for item in self.server.posts], ["BUY", "SELL"])
        self.assertEqual([item["newClientOrderId"] for item in self.server.posts], [BUY_NAME, SELL_NAME])
        for private in ("987654", OWNER_EMAIL, "6423", "API-KEY-VALUE", "API-SECRET-VALUE", "250000", "200000"):
            self.assertNotIn(private, self.everything(), private)

    def test_lost_answers_are_settled_from_indodax_own_record_without_a_second_order(self):
        sender = self.start(lose_answers=True)
        sender.cycle()
        self.assertAlmostEqual(sender.state["positions"][BTC]["quantity"], self.server.book["btc"], delta=1e-12)
        self.api.hold()
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(sender.state["tripped"], "")
        self.assertEqual(len(self.server.posts), 2)

    def test_orders_the_proxy_refused_are_sent_once_each_as_soon_as_it_lets_them_through(self):
        sender = self.start()
        refused = []

        def proxy(request):
            if request.get_method() == "POST" and len(refused) < self.refusals:
                refused.append(request)
                return REFUSED_407
            return self.server(request)

        self.opener.handler = proxy
        self.refusals = 2
        sender.cycle()
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(self.server.posts, [])
        self.assertEqual(self.server.book["btc"], 0.0)
        sender.cycle()
        self.assertAlmostEqual(sender.state["positions"][BTC]["quantity"], self.server.book["btc"], delta=1e-12)
        self.api.hold()
        self.refusals = 3
        sender.cycle()
        self.assertIn(BTC, sender.state["positions"])
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(sender.state["tripped"], "")
        self.assertEqual(len(refused), 3)
        self.assertEqual([item["newClientOrderId"] for item in self.server.posts], [BUY_NAME, SELL_NAME])  # one buy, one sale
        self.assertNotIn("SAFETY STOP", self.text())

    def test_unreadable_trades_still_open_the_copy_from_the_balance(self):
        sender = self.start(trades_hidden=True)
        sender.cycle()
        self.assertAlmostEqual(sender.state["positions"][BTC]["quantity"], self.server.book["btc"], delta=1e-12)
        self.assertEqual(len(self.server.posts), 1)

    def test_too_little_rupiah_is_a_plain_refusal_and_nothing_is_held(self):
        sender = self.start()
        self.server.refuse = refusal(400, -2010, "Order rejected. Insufficient balance.")
        sender.cycle()
        self.assertEqual(sender.state["positions"], {})
        self.assertEqual(len(self.server.posts), 1)
        self.assertEqual(self.server.book, {"idr": 250_000.0, "btc": 0.0})

    def test_check_explains_a_key_for_the_other_api_and_a_key_that_may_not_trade(self):
        settings = self.settings(real=True)
        opener = FakeOpener(lambda request: refusal(403, -2015, "Access denied.") if "/api/v2/" in request.full_url else {"server_time": int(START * 1000)})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = bridge.check(settings, bridge.exchange_for(settings, clock=self.clock, opener=opener), self.state_path)
        self.assertEqual(code, 1)
        self.assertIn("INDODAX_API_VERSION=1", output.getvalue())
        self.assertFalse(self.state_path.exists() and self.stored().get("checked"))

        server = FakeV2(self.clock)
        server.rights = {"canTrade": False, "canWithdraw": False, "canWithdrawFiat": False}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = bridge.check(settings, bridge.exchange_for(settings, clock=self.clock, opener=FakeOpener(server)), self.state_path)
        self.assertEqual(code, 1)
        self.assertIn("may not trade", output.getvalue())
        self.assertFalse(self.state_path.exists() and self.stored().get("checked"))

        server.rights = {"canTrade": True, "canWithdraw": True, "canWithdrawFiat": False}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = bridge.check(settings, bridge.exchange_for(settings, clock=self.clock, opener=FakeOpener(server)), self.state_path)
        self.assertEqual(code, 0)
        self.assertIn("Rp250.000", output.getvalue())
        self.assertIn("may also withdraw", output.getvalue())
        self.assertNotIn("987654", output.getvalue())

    def test_check_for_the_older_api_says_when_the_key_is_a_newer_one(self):
        settings = self.settings(real=True, api_version=1)
        answer = {"success": 0, "error": "Access denied for this API key version", "error_code": "invalid_credentials"}
        opener = FakeOpener(lambda request: {"server_time": int(START * 1000)} if request.full_url.endswith("/api/server_time") else answer)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = bridge.check(settings, bridge.exchange_for(settings, clock=self.clock, opener=opener), self.state_path)
        self.assertEqual(code, 1)
        self.assertIn("take INDODAX_API_VERSION=1 out", output.getvalue())


# ---------------------------------------------------------------- the command line


class CommandLine(Case):
    def run_main(self, env_text, *arguments):
        env = Path(self.folder.name) / ".env"
        env.write_text(env_text, encoding="utf-8")
        output = io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(output):
            code = bridge.main(["--env", str(env), "--state", str(self.state_path), *arguments])
        return code, output.getvalue()

    def test_it_is_off_without_a_bridge_key(self):
        code, output = self.run_main("")
        self.assertEqual(code, 0)
        self.assertIn("off", output)

    def test_bad_settings_stop_it(self):
        code, output = self.run_main("INDODAX_BRIDGE_KEY=k\nINDODAX_MODE=real\n")
        self.assertEqual(code, 2)
        self.assertIn(bridge.REAL_CONFIRM, output)

    def test_a_damaged_state_file_stops_it(self):
        self.state_path.write_text("{", encoding="utf-8")
        code, output = self.run_main("INDODAX_BRIDGE_KEY=k\n", "--once")
        self.assertEqual(code, 2)
        self.assertIn("damaged", output)

    def test_clear_removes_the_safety_stop(self):
        state = bridge.fresh_state()
        state["tripped"] = "Indodax refused the buy of BTC."
        bridge.save_state(self.state_path, state)
        code, output = self.run_main("", "--clear")
        self.assertEqual(code, 0)
        self.assertIn("cleared", output)
        self.assertEqual(self.stored()["tripped"], "")

    def test_check_without_keys_orders_nothing(self):
        code, output = self.run_main("INDODAX_BRIDGE_KEY=k\n", "--check")
        self.assertEqual(code, 1)
        self.assertIn("not set", output)

    def test_real_mode_without_the_key_check_says_so_and_buys_nothing(self):
        env_text = "\n".join(
            [
                "INDODAX_BRIDGE_KEY=k",
                "INDODAX_MODE=real",
                f"INDODAX_REAL_CONFIRM={bridge.REAL_CONFIRM}",
                "INDODAX_API_KEY=API-KEY-VALUE",
                "INDODAX_API_SECRET=API-SECRET-VALUE",
            ]
        )
        with mock.patch.object(bridge.Bridge, "cycle", return_value={}) as cycle:
            code, output = self.run_main(env_text, "--once")
        self.assertEqual(code, 0)
        self.assertEqual(cycle.call_count, 1)
        self.assertIn("NOT YET", output)
        self.assertNotIn("API-KEY-VALUE", output)

    def test_check_prints_only_that_the_key_works_and_the_free_rupiah(self):
        exchange = FakeExchange()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = bridge.check(self.settings(real=True), exchange)
        self.assertEqual(code, 0)
        self.assertIn("Rp1.000.000", output.getvalue())
        self.assertEqual(exchange.orders, [])
        exchange.balance_errors = [bridge.ExchangeError("Invalid credentials.")]
        with contextlib.redirect_stdout(output):
            self.assertEqual(bridge.check(self.settings(real=True), exchange), 1)


# ---------------------------------------------------------------- the study (learn.py)


class FakeStudy:
    """Stands in for learn.py's process: counts the starts, and says whether it still runs."""

    def __init__(self):
        self.starts = 0
        self.running = True

    def __call__(self):
        self.starts += 1
        self.running = True
        return self

    def poll(self):
        return None if self.running else 0


class Study(Case):
    def learned(self, at_seconds, **more):
        summary = {"at": int(at_seconds * 1000), "verdict": "keep", **more}
        (Path(self.folder.name) / "learn.json").write_text(json.dumps({"summary": summary}), encoding="utf-8")

    def with_study(self, *symbols):
        sender = self.make(*symbols)
        sender.study = FakeStudy()
        return sender

    def test_no_study_is_started_unless_one_is_given(self):
        sender = self.make()
        sender.cycle()
        self.assertIsNone(sender.studying)
        self.assertNotIn("learn", self.api.reports[-1])

    def test_the_first_cycle_starts_it_and_a_running_one_is_left_alone(self):
        sender = self.with_study()
        sender.cycle()
        self.assertEqual(sender.study.starts, 1)
        self.assertIn("never orders", self.text())
        self.clock.now += 2 * bridge.LEARN_RETRY_SECONDS
        sender.cycle()
        self.assertEqual(sender.study.starts, 1)

    def test_a_fresh_result_is_reported_and_not_studied_again(self):
        self.learned(START - 60, trades=213)
        sender = self.with_study()
        sender.cycle()
        self.assertEqual(sender.study.starts, 0)
        self.assertEqual(self.api.reports[-1]["learn"]["trades"], 213)

    def test_it_runs_again_when_the_result_is_four_hours_old(self):
        self.learned(START - bridge.LEARN_EVERY_SECONDS - 1)
        sender = self.with_study()
        sender.cycle()
        self.assertEqual(sender.study.starts, 1)

    def test_it_runs_again_after_a_buy(self):
        self.learned(START - 60)
        sender = self.with_study(BTC)
        sender.cycle()  # buys the practice copy, so the minute-old study is older than the buy
        self.assertEqual(len(sender.state["positions"]), 1)
        self.assertEqual(sender.study.starts, 1)

    def test_a_failed_run_is_tried_again_only_after_the_wait(self):
        sender = self.with_study()
        sender.cycle()
        sender.study.running = False  # it ended without writing a result
        self.clock.now += 60
        sender.cycle()
        self.assertEqual(sender.study.starts, 1)
        self.clock.now += bridge.LEARN_RETRY_SECONDS
        sender.cycle()
        self.assertEqual(sender.study.starts, 2)

    def test_a_study_that_cannot_start_does_not_fail_the_cycle(self):
        sender = self.make()

        def broken():
            raise OSError("no python")

        sender.study = broken
        sender.cycle()
        self.assertIn("could not start", self.text())
        self.assertEqual(len(self.api.reports), 1)

    def test_a_damaged_result_is_ignored(self):
        (Path(self.folder.name) / "learn.json").write_text("{", encoding="utf-8")
        sender = self.make()
        sender.cycle()
        self.assertNotIn("learn", self.api.reports[-1])

    def test_showing_starts_nothing(self):
        sender = self.with_study()
        sender.cycle(show=True)
        self.assertEqual(sender.study.starts, 0)

    def test_one_cycle_from_the_command_line_starts_no_study(self):
        env = Path(self.folder.name) / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=k\n", encoding="utf-8")
        with mock.patch.object(bridge, "start_study") as start, mock.patch.object(bridge.Bridge, "cycle", return_value={}):
            with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
                bridge.main(["--env", str(env), "--state", str(self.state_path), "--once"])
        start.assert_not_called()


# ---------------------------------------------------------------- one sender on a PC, also with no window


class OneSenderAndItsLog(Case):
    def keep_running(self, *arguments, holder="free"):
        """main() as the sender that keeps running: one cycle, then the stop a Ctrl+C gives."""
        env = Path(self.folder.name) / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=k\n", encoding="utf-8")
        held = mock.Mock() if holder == "free" else None
        output = io.StringIO()
        with mock.patch.object(bridge, "hold_one_sender", return_value=held) as hold, mock.patch.object(bridge.Bridge, "cycle", return_value={}) as cycle:
            with mock.patch.object(bridge, "reroute"), mock.patch.object(bridge, "start_study"), mock.patch.object(bridge.time, "sleep", side_effect=KeyboardInterrupt):
                with mock.patch.dict(os.environ, {}, clear=True), contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
                    code = bridge.main(["--env", str(env), "--state", str(self.state_path), *arguments])
        return code, output.getvalue(), hold, cycle

    def test_only_one_sender_can_hold_the_pc(self):
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        first = bridge.hold_one_sender(port)
        self.assertIsNotNone(first)
        self.assertIsNone(bridge.hold_one_sender(port), "a second sender must not get it")
        first.close()
        again = bridge.hold_one_sender(port)
        self.assertIsNotNone(again, "it is free again when the first sender has ended")
        again.close()

    def test_the_sender_that_keeps_running_takes_the_pc_first(self):
        code, output, hold, cycle = self.keep_running()
        self.assertEqual(code, 0)
        hold.assert_called_once_with()
        self.assertEqual(cycle.call_count, 1)
        self.assertIn("Indodax sender running", output)

    def test_a_second_sender_says_so_and_ends_without_a_cycle(self):
        code, output, _hold, cycle = self.keep_running(holder="taken")
        self.assertEqual(code, bridge.ALREADY_RUNNING)
        cycle.assert_not_called()
        self.assertIn("another sender is already running", output)
        self.assertNotIn("Indodax sender running", output)

    def test_one_look_or_one_cycle_does_not_ask_for_the_pc(self):
        for flag in ("--show", "--once"):
            code, _output, hold, cycle = self.keep_running(flag, holder="taken")
            self.assertEqual(code, 0, flag)
            hold.assert_not_called()
            self.assertEqual(cycle.call_count, 1, flag)

    def test_with_no_window_its_lines_are_kept_in_a_file(self):
        log = Path(self.folder.name) / "desk_sender.log"
        code, output, _hold, _cycle = self.keep_running("--log", str(log))
        self.assertEqual(code, 0)
        kept = log.read_text(encoding="utf-8")
        self.assertIn("Indodax sender running", kept)
        self.assertIn("Stopped.", kept)
        self.assertEqual(kept, output, "the file holds the same lines as the console")

    def test_a_second_sender_with_no_window_leaves_its_reason_in_the_file(self):
        log = Path(self.folder.name) / "desk_sender.log"
        code, _output, _hold, _cycle = self.keep_running("--log", str(log), holder="taken")
        self.assertEqual(code, bridge.ALREADY_RUNNING)
        self.assertIn("another sender is already running", log.read_text(encoding="utf-8"))

    def test_kept_lines_are_whole_lines_and_work_without_a_console(self):
        log = Path(self.folder.name) / "lines.log"
        kept = bridge.KeptLines(log)  # inside the one-file app there is no console at all
        kept.write("a")
        kept.write("b\nc")
        kept.flush()
        self.assertEqual(log.read_text(encoding="utf-8"), "ab\n")
        kept.write("\n")
        self.assertEqual(log.read_text(encoding="utf-8"), "ab\nc\n")

    def test_a_log_file_over_a_megabyte_is_set_aside(self):
        log = Path(self.folder.name) / "lines.log"
        log.write_text("x" * (bridge.LOG_FILE_BYTES + 1), encoding="utf-8")
        bridge.append_line(log, "new")
        self.assertEqual(log.read_text(encoding="utf-8"), "new\n")
        self.assertTrue(log.with_suffix(".old.log").exists())

    def test_the_sender_in_the_app_ends_when_its_starter_is_ended(self):
        # The one-file app is two processes; Windows' task list ends only the first (the starter).
        left = []
        bridge.follow_the_starter(4321, wait=lambda pid: pid == 4321, leave=left.append).join(5)
        self.assertEqual(left, [1], "the starter ended, so the sender must end too")

    def test_a_starter_that_cannot_be_watched_does_not_end_the_sender(self):
        left = []
        bridge.follow_the_starter(4321, wait=lambda pid: False, leave=left.append).join(5)
        self.assertEqual(left, [])

    @unittest.skipUnless(os.name == "nt", "the wait uses Windows")
    def test_the_end_of_a_real_process_is_seen_and_a_missing_one_is_not_watched(self):
        import subprocess
        import sys

        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        seen = []
        watcher = threading.Thread(target=lambda: seen.append(bridge.wait_for_end(child.pid)), daemon=True)
        watcher.start()
        watcher.join(0.5)
        self.assertEqual(seen, [], "it still runs, so the wait goes on")
        child.kill()
        watcher.join(10)
        self.assertEqual(seen, [True])
        child.wait()
        self.assertFalse(bridge.wait_for_end(0), "no such process: nothing is known, so nothing ends")

    def test_only_the_app_follows_its_starter(self):
        with mock.patch.object(bridge, "follow_the_starter") as follow:
            with mock.patch.object(bridge, "FROZEN", False):
                self.keep_running()
            self.assertFalse(follow.called, "under Python the sender is one process")
            with mock.patch.object(bridge, "FROZEN", True):
                self.keep_running()
            follow.assert_called_once_with(os.getppid())



# ---------------------------------------------------------------- an order that grows with what was won

class OrderGrows(Case):
    """INDODAX_ORDER_GROW=yes: the next order is the set size plus what that mode has won so far."""

    def test_it_is_off_unless_asked_for(self):
        made = self.make(BTC, order_idr=20_000)
        made.state["result"]["practice"] = 9_000.0
        self.assertEqual(made.order_size("practice"), 20_000)

    def test_winnings_make_the_next_practice_order_bigger_in_whole_thousands(self):
        made = self.make(BTC, order_idr=20_000, order_grow=True)
        made.state["result"]["practice"] = 3_400.0
        self.assertEqual(made.order_size("practice"), 23_000)
        made.cycle()
        self.assertEqual(made.state["positions"][BTC]["spent"], 23_000)

    def test_after_losses_it_is_the_set_size_again_and_never_less(self):
        made = self.make(BTC, order_idr=20_000, order_grow=True)
        for result in (0.0, -1.0, -5_000.0, -10_000_000.0, 999.0, float("nan"), None, "many"):
            made.state["result"]["practice"] = result
            self.assertEqual(made.order_size("practice"), 20_000, result)

    def test_it_never_passes_the_cap_on_one_order(self):
        made = self.make(BTC, order_idr=20_000, order_grow=True)
        made.state["result"]["practice"] = 10_000_000.0
        self.assertEqual(made.order_size("practice"), bridge.ORDER_IDR_CAP)

    def test_pretend_winnings_never_make_a_real_order_bigger(self):
        made = self.make(BTC, real=True, order_idr=20_000, order_grow=True)
        made.state["result"]["practice"] = 80_000.0
        self.assertEqual(made.order_size("real"), 20_000)

    def test_a_real_buy_asks_indodax_for_the_grown_size(self):
        made = self.make(BTC, real=True, order_idr=20_000, order_grow=True)
        made.state["result"]["real"] = 7_900.0
        sent, send = [], made.send_order

        def watched(side, symbol, **details):
            sent.append((side, details.get("idr")))
            return send(side, symbol, **details)

        made.send_order = watched
        made.cycle()
        self.assertEqual(sent, [("buy", 27_000)])

    def test_a_real_order_of_any_other_size_is_still_stopped(self):
        made = self.make(BTC, real=True, order_idr=20_000, order_grow=True)
        made.state["result"]["real"] = 7_900.0
        for size in (20_000, 28_000, 500_000):
            with self.assertRaises(bridge.Refused) as stopped:
                made.send_order("buy", BTC, idr=size, client_order_id="tb-btc-x-b")
            self.assertIn("unexpected size", str(stopped.exception))
        self.assertEqual(self.exchange.orders, [])

    def test_the_setting_is_read_from_the_env_file(self):
        env = Path(self.folder.name) / ".env"
        env.write_text("INDODAX_BRIDGE_KEY=k\nINDODAX_ORDER_IDR=20000\nINDODAX_ORDER_GROW=yes\n", encoding="utf-8")
        self.assertTrue(bridge.load_settings(str(env)).order_grow)
        env.write_text("INDODAX_BRIDGE_KEY=k\nINDODAX_ORDER_IDR=20000\n", encoding="utf-8")
        self.assertFalse(bridge.load_settings(str(env)).order_grow)

if __name__ == "__main__":
    unittest.main()
