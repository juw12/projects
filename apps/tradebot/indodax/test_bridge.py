"""Tests for the Indodax sender. They use a pretend exchange: nothing here reaches Indodax.

    python -m unittest          (in this folder)
"""

import contextlib
import io
import json
import os
import tempfile
import unittest
import urllib.error
import urllib.parse
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
            ["checked", "closed", "keys", "maxOpen", "mode", "notes", "orderIdr", "paused", "positions", "result", "stopPercent", "today", "tripped", "trippedWhy"],
        )
        self.assertEqual((report["mode"], report["keys"], report["tripped"], report["orderIdr"]), ("practice", False, False, 50_000))
        self.assertEqual((report["checked"], report["paused"]), (False, False))
        position = report["positions"][0]
        self.assertEqual(sorted(position), ["now", "openedAt", "pair", "price", "quantity", "real", "spent", "symbol", "value"])
        self.assertEqual((position["symbol"], position["pair"], position["real"], position["now"]), (BTC, "btc_idr", False, 1e9))
        self.assertAlmostEqual(position["value"], position["quantity"] * 1e9)

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


if __name__ == "__main__":
    unittest.main()
