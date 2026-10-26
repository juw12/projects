"""Hermetic submission-time regressions. No HTTP or brokerage credentials used."""
import copy
import json
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from broker import Broker, BrokerError


class SubmissionGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.account = {
            "status": "ACTIVE", "cash": "5000", "equity": "5000",
            "buying_power": "5000", "trading_blocked": False, "account_blocked": False,
        }
        self.positions = [{"symbol": "AAPL", "qty": "10", "side": "long"}]
        self.posts = []
        self.quote = {"price": 100}
        self.fail_post = False
        self.broker = Broker(self.root, None, self.load, self.save, lambda symbol: self.quote)
        self.broker._request = self.request
        self.connect()
        self.order = {"symbol": "AAPL", "side": "buy", "type": "market", "dollars": 100}
        self.limits = {"max_trades_per_day": 1, "max_loss_per_trade_usd": 20}

    def load(self, path, default):
        return json.loads(path.read_text()) if path.exists() else default

    def save(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value), encoding="utf-8")

    def request(self, cfg, method, path, body=None, base=None):
        if path == "/v2/account":
            return copy.deepcopy(self.account)
        if path == "/v2/positions":
            return copy.deepcopy(self.positions)
        if method == "POST" and path == "/v2/orders":
            self.posts.append(copy.deepcopy(body))
            if self.fail_post:
                raise BrokerError("Transport timeout")
            return {**body, "id": "test-order-id", "status": "accepted"}
        raise AssertionError((method, path))

    def connect(self, mode="live"):
        return self.broker.connect(
            "alice", "TESTKEY123456", "TESTSECRET1234567890", mode,
            phrase="REAL MONEY", password_ok=True,
        )

    def preview(self, order=None, limits=None):
        return self.broker.preview("alice", order or self.order, self.limits if limits is None else limits)["preview_id"]

    def place(self, preview, limits=None):
        return self.broker.place("alice", preview, True, self.limits if limits is None else limits)

    def test_multiple_previews_cannot_bypass_entry_cap(self):
        first, second = self.preview(), self.preview()
        self.place(first)
        with self.assertRaisesRegex(BrokerError, "Daily live order limit"):
            self.place(second)
        self.assertEqual(len(self.posts), 1)

    def test_concurrent_submits_reserve_one_slot(self):
        previews = [self.preview() for _ in range(8)]

        def submit(token):
            try:
                self.place(token)
                return True
            except BrokerError:
                return False

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(submit, previews))
        self.assertEqual(sum(results), 1)
        self.assertEqual(len(self.posts), 1)

    def test_cap_rechecked_after_settings_change(self):
        token = self.preview()
        self.broker.settings("alice", 50)
        with self.assertRaisesRegex(BrokerError, "max per order"):
            self.place(token)
        self.assertFalse(self.posts)

    def test_account_block_rechecked(self):
        token = self.preview()
        self.account["trading_blocked"] = True
        with self.assertRaisesRegex(BrokerError, "blocked"):
            self.place(token)
        self.assertFalse(self.posts)

    def test_buying_power_rechecked(self):
        token = self.preview()
        self.account["buying_power"] = "20"
        with self.assertRaisesRegex(BrokerError, "buying power"):
            self.place(token)
        self.assertFalse(self.posts)

    def test_changed_profile_daily_cap_applies_at_submit(self):
        limits = {**self.limits, "max_trades_per_day": 3}
        first, second = self.preview(limits=limits), self.preview(limits=limits)
        self.place(first, limits)
        with self.assertRaisesRegex(BrokerError, "Daily live order limit"):
            self.place(second, self.limits)

    def test_quote_rechecked_for_share_order(self):
        token = self.preview({"symbol": "AAPL", "side": "buy", "type": "market", "qty": 5})
        self.quote = {"price": 300}
        with self.assertRaisesRegex(BrokerError, "max per order"):
            self.place(token)

    def test_changed_stop_risk_limit_applies_at_submit(self):
        order = {"symbol": "AAPL", "side": "buy", "type": "limit", "qty": 1, "limit": 100, "stop_loss": 90}
        token = self.preview(order)
        with self.assertRaisesRegex(BrokerError, "per-trade limit"):
            self.place(token, {**self.limits, "max_loss_per_trade_usd": 5})
        self.assertFalse(self.posts)

    def test_excess_stop_risk_is_blocked_not_only_warned(self):
        order = {"symbol": "AAPL", "side": "buy", "type": "limit", "qty": 3, "limit": 100, "stop_loss": 90}
        with self.assertRaisesRegex(BrokerError, "per-trade limit"):
            self.preview(order)

    def test_invalid_bracket_direction_is_blocked(self):
        order = {"symbol": "AAPL", "side": "buy", "type": "limit", "qty": 1, "limit": 100}
        for values in ({"stop_loss": 100}, {"stop_loss": 110}, {"take_profit": 90}):
            with self.subTest(values=values), self.assertRaises(BrokerError):
                self.preview({**order, **values})

    def test_no_stop_is_disclosed_not_claimed_risk_capped(self):
        result = self.broker.preview("alice", self.order, self.limits)
        self.assertTrue(any("cannot be checked" in warning for warning in result["warnings"]))

    def test_gap_risk_disclosed(self):
        result = self.broker.preview("alice", {
            "symbol": "AAPL", "side": "buy", "type": "limit", "qty": 1, "limit": 100, "stop_loss": 90,
        }, self.limits)
        self.assertTrue(any("not a maximum loss" in warning for warning in result["warnings"]))

    def test_exit_still_possible_at_entry_cap(self):
        self.place(self.preview())
        sell = {"symbol": "AAPL", "side": "sell", "type": "market", "qty": 1}
        self.place(self.preview(sell))
        self.assertEqual([order["side"] for order in self.posts], ["buy", "sell"])

    def test_position_rechecked_before_sell(self):
        token = self.preview({"symbol": "AAPL", "side": "sell", "type": "market", "qty": 5})
        self.positions[0]["qty"] = "2"
        with self.assertRaisesRegex(BrokerError, "won't sell more"):
            self.place(token)

    def test_nonfinite_quote_blocks_market_quantity_buy(self):
        for value in (float("nan"), float("inf"), 0, -1, True):
            self.quote = {"price": value}
            with self.subTest(value=value), self.assertRaisesRegex(BrokerError, "estimate"):
                self.preview({"symbol": "AAPL", "side": "buy", "type": "market", "qty": 1})

    def test_nonfinite_buying_power_fails_closed(self):
        for value in ("NaN", "Infinity", "invalid", None):
            self.account["buying_power"] = value
            with self.subTest(value=value), self.assertRaisesRegex(BrokerError, "valid buying power"):
                self.preview()

    def test_notional_sale_needs_valid_quote(self):
        self.quote = {"price": float("nan")}
        with self.assertRaisesRegex(BrokerError, "valid quote"):
            self.preview({"symbol": "AAPL", "side": "sell", "type": "market", "dollars": 100})

    def test_invalid_position_quantity_cannot_bypass_short_guard(self):
        self.positions[0]["qty"] = "NaN"
        with self.assertRaisesRegex(BrokerError, "don't hold"):
            self.preview({"symbol": "AAPL", "side": "sell", "type": "market", "qty": 1})

    def test_same_mode_reconnect_invalidates_preview(self):
        token = self.preview()
        self.connect()
        with self.assertRaisesRegex(BrokerError, "expired or was already used"):
            self.place(token)

    def test_reconnect_does_not_reset_daily_capacity(self):
        self.place(self.preview())
        self.broker.disconnect("alice")
        self.connect()
        with self.assertRaisesRegex(BrokerError, "Daily live order limit"):
            self.preview()
        guard = self.broker._guard_path("alice").read_text()
        self.assertNotIn("TESTKEY", guard)
        self.assertNotIn("TESTSECRET", guard)

    def test_counter_survives_process_object_restart(self):
        self.place(self.preview())
        self.broker = Broker(self.root, None, self.load, self.save, lambda symbol: self.quote)
        self.broker._request = self.request
        with self.assertRaisesRegex(BrokerError, "Daily live order limit"):
            self.preview()

    def test_unknown_submission_reserves_capacity_and_identifies_order(self):
        token = self.preview()
        self.fail_post = True
        with self.assertRaisesRegex(BrokerError, "Check Alpaca orders.*Client order id: twin-"):
            self.place(token)
        with self.assertRaisesRegex(BrokerError, "Daily live order limit"):
            self.preview()
        with self.assertRaisesRegex(BrokerError, "expired or was already used"):
            self.place(token)
        self.assertEqual(len(self.posts), 1)

    def test_corrupt_counter_does_not_reset_to_zero(self):
        path = self.broker._guard_path("alice")
        path.write_text("not-json")
        with self.assertRaisesRegex(BrokerError, "Unreadable live order counter"):
            self.preview()

    def test_preview_is_user_bound(self):
        token = self.preview()
        self.broker.connect("bob", "OTHERKEY123456", "OTHERSECRET1234567890", "paper")
        with self.assertRaisesRegex(BrokerError, "expired or was already used"):
            self.broker.place("bob", token, True)
        self.place(token)

    def test_disconnect_deletes_keys_even_if_counter_is_corrupt(self):
        self.broker._guard_path("alice").write_text("broken")
        self.broker.disconnect("alice")
        self.assertFalse(self.broker._path("alice").exists())
        self.assertEqual(self.broker._guard_path("alice").read_text(), "broken")

    def test_corrupt_entry_counter_does_not_block_long_exit(self):
        self.broker._guard_path("alice").write_text("broken")
        self.place(self.preview({"symbol": "AAPL", "side": "sell", "type": "market", "qty": 1}))
        self.assertEqual(self.posts[0]["side"], "sell")

    def test_inactive_paper_account_rejected(self):
        self.connect("paper")
        self.account["status"] = "REJECTED"
        with self.assertRaisesRegex(BrokerError, "not ACTIVE"):
            self.preview()

    def test_subprecision_price_rejected(self):
        with self.assertRaisesRegex(BrokerError, "price precision"):
            self.preview({"symbol": "AAPL", "side": "buy", "type": "limit", "qty": 1, "limit": 0.000001})

    def test_zero_risk_limit_is_not_treated_as_unlimited(self):
        order = {"symbol": "AAPL", "side": "buy", "type": "limit", "qty": 1, "limit": 100, "stop_loss": 90}
        with self.assertRaisesRegex(BrokerError, "per-trade limit"):
            self.preview(order, {**self.limits, "max_loss_per_trade_usd": 0})

    def test_nonfinite_risk_limit_is_refused(self):
        order = {"symbol": "AAPL", "side": "buy", "type": "limit", "qty": 1, "limit": 100, "stop_loss": 90}
        with self.assertRaisesRegex(BrokerError, "real number"):
            self.preview(order, {**self.limits, "max_loss_per_trade_usd": float("nan")})

    def test_subcent_order_cap_cannot_round_to_unlimited(self):
        with self.assertRaisesRegex(BrokerError, "at least one cent"):
            self.broker.settings("alice", 0.001)


if __name__ == "__main__":
    unittest.main(verbosity=2)
