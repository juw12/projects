"""Tests for the Agents tab's thinking (agents.py). Made-up numbers and no network: nothing is read or ordered.

    python -m unittest          (in this folder)
"""

import copy
import json
import tempfile
import unittest
from pathlib import Path

import agents
import desk
import learn

NOW = 1_795_000_000_000  # a fixed moment, so every test sees the same candles
HOUR = 3600 * 1000


def charts(now=NOW):
    return {frame["key"]: agents.demo_candles(frame["key"], now) for frame in agents.TIMEFRAMES}


def readings(now=NOW):
    return {key: agents.reading(rows, key) for key, rows in charts(now).items()}


def rows_going(up=True, count=260, start=100.0):
    """Candles that only rise (or only fall), four hours apart."""
    rows, price = [], start
    for index in range(count):
        closed = price * (1.004 if up else 0.996)
        rows.append({"t": NOW - (count - index) * 4 * HOUR, "o": price, "h": max(price, closed) * 1.001, "l": min(price, closed) * 0.999, "c": closed, "v": 0.0})
        price = closed
    return rows


def team_of(view, sender_state="here", report=None, summary=None, cycle_age=20, found=None):
    report = view["report"] if report is None else report
    made = agents.desk(view, report, readings() if found is None else found, report.get("learn") if summary is None else summary, sender_state, NOW, {"BTC", "ETH"}, cycle_age, 0, "", charts()["4H"])
    return made, {member["key"]: member for member in made["team"]}


class Numbers(unittest.TestCase):
    def test_the_plain_average(self):
        self.assertEqual(agents.sma([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])
        self.assertEqual(agents.sma([1, 2], 3), [None, None])
        self.assertEqual(agents.sma([], 3), [])
        self.assertEqual(agents.sma([5, 5], 0), [None, None])

    def test_prices_are_written_short(self):
        self.assertEqual(agents.price_text(1_214_700_000), "1.214,7 jt")
        self.assertEqual(agents.price_text(51_300_000), "51,30 jt")
        self.assertEqual(agents.price_text(3150), "3.150")
        self.assertEqual(agents.price_text(12.5), "12,50")
        self.assertEqual(agents.price_text(1_100_000_000, 1_300_000_000), "1.100,0 jt")

    def test_numbers_use_a_comma(self):
        self.assertEqual(agents.comma(1.5), "1,5")
        self.assertEqual(agents.signed(0.564, 2), "+0,56")
        self.assertEqual(agents.signed_pct(-1.23), "−1,2%" if "−" in agents.signed_pct(-1.23) else "-1,2%")
        self.assertEqual(agents.coin_of("BTCUSDT"), "BTC")
        self.assertEqual(agents.coin_of("eth"), "ETH")


class Candles(unittest.TestCase):
    def test_indodax_rows_become_candles_oldest_first_without_broken_ones(self):
        rows = [
            {"Time": 200, "Open": 2, "High": 3, "Low": 1, "Close": 2.5, "Volume": "7"},
            {"Time": 100, "Open": "1", "High": "2", "Low": "0.5", "Close": "1.5"},
            {"Time": 300, "Open": 0, "High": 3, "Low": 1, "Close": 2},
            {"Time": 400, "Open": "x", "High": 3, "Low": 1, "Close": 2},
            {"Open": 1, "High": 3, "Low": 1, "Close": 2},
            {"Time": 200, "Open": 2, "High": 4, "Low": 1, "Close": 3, "Volume": 1},
            "broken",
        ]
        found = agents.parse_candles(rows)
        self.assertEqual([row["t"] for row in found], [100_000, 200_000])
        self.assertEqual(found[1]["c"], 3.0)  # the later copy of a candle wins
        self.assertEqual(found[0]["v"], 0.0)
        self.assertEqual(agents.parse_candles({"error": "no"}), [])
        self.assertEqual(agents.parse_candles(None), [])

    def test_the_address_asks_indodax_for_the_right_chart(self):
        url = agents.candle_url("btc", "4H", NOW)
        self.assertTrue(url.startswith("https://indodax.com/tradingview/history_v2?"))
        self.assertIn("tf=240", url)
        self.assertIn("symbol=BTCIDR", url)
        self.assertIn("tf=1D", agents.candle_url("ETH", "1D", NOW))
        self.assertIn("tf=15&", agents.candle_url("ETH", "15m", NOW))

    def test_a_chart_that_cannot_be_read_is_simply_missing(self):
        good = [{"Time": 100 + index, "Open": 1, "High": 2, "Low": 0.5, "Close": 1.5} for index in range(5)]

        def read(url):
            if "tf=60" in url:
                raise OSError("proxy")
            if "tf=15" in url:
                return {"error": "busy"}
            return good

        found = agents.fetch_candles(read, "BTC", NOW)
        self.assertEqual(sorted(found), ["1D", "4H"])
        self.assertEqual(len(found["4H"]), 5)
        self.assertEqual(sorted(agents.fetch_candles(read, "BTC", NOW, {"4H"})), ["4H"])

    def test_the_reader_tries_once_and_never_orders(self):
        source = Path(agents.__file__).read_text(encoding="utf-8")
        for word in ("send_order", "exchange_for", ".trade(", "api_secret", "api_key", "buy_real", "sell_real", "sleep("):
            self.assertNotIn(word, source)

    def test_the_demo_candles_are_the_same_every_time(self):
        for frame in agents.TIMEFRAMES:
            first, again = agents.demo_candles(frame["key"], NOW), agents.demo_candles(frame["key"], NOW)
            self.assertEqual(first, again)
            self.assertEqual(len(first), agents.CANDLES)
            self.assertAlmostEqual(first[-1]["c"], 1_214_700_000)
            self.assertTrue(all(row["l"] <= min(row["o"], row["c"]) and row["h"] >= max(row["o"], row["c"]) for row in first))
            steps = {later["t"] - earlier["t"] for earlier, later in zip(first, first[1:])}
            self.assertEqual(steps, {frame["seconds"] * 1000})
            self.assertLessEqual(first[-1]["t"], NOW)


class Reading(unittest.TestCase):
    def test_the_lines_match_the_rules_own_arithmetic(self):
        rows = charts()["4H"]
        lines = agents.indicators(rows)
        closes = [row["c"] for row in rows]
        self.assertEqual(lines["ema20"], learn.ema(closes, 20))
        self.assertEqual(lines["ema200"], learn.ema(closes, 200))
        self.assertEqual(lines["rsi"], learn.rsi(closes, learn.RSI_PERIOD))
        self.assertAlmostEqual(lines["sma200"][-1] / (sum(closes[-200:]) / 200), 1.0, places=12)
        self.assertEqual({len(values) for values in lines.values()}, {len(rows)})

    def test_a_rising_chart_reads_up_and_a_falling_one_down(self):
        up, down = agents.reading(rows_going(True), "4H"), agents.reading(rows_going(False), "4H")
        self.assertEqual((up["bias"], up["trend"], up["momentum"]), ("up", True, True))
        self.assertEqual((down["bias"], down["trend"], down["momentum"]), ("down", False, False))
        self.assertGreater(up["rsi"], 70)
        self.assertIn("overheated", agents.caption(up))
        self.assertIn("4H: down", agents.caption(down))
        self.assertEqual(up["low"], min(row["l"] for row in rows_going(True)[-20:]))

    def test_too_few_candles_read_as_nothing(self):
        short = agents.reading(rows_going(True, 30), "1H")
        self.assertEqual(short["bias"], "none")
        self.assertIn("No candles", agents.caption(short))
        self.assertEqual(agents.reading([], "1D")["bias"], "none")
        self.assertTrue(agents.analysis(short))
        self.assertTrue(agents.analysis(None))

    def test_between_fifty_and_two_hundred_candles_the_fifty_average_stands_in(self):
        found = agents.reading(rows_going(True, 120), "1D")
        self.assertIsNone(found["trend"])
        self.assertEqual(found["bias"], "up")
        self.assertIn("the 50 average", found["text"])

    def test_the_analysis_says_every_indicator_in_plain_words(self):
        said = " ".join(agents.analysis(agents.reading(rows_going(True), "4H")))
        for word in ("EMA 200", "EMA 20", "RSI", "SMA 200", "ATR"):
            self.assertIn(word, said)

    def test_the_strength_gauge_in_words(self):
        self.assertIn("overheated", agents.rsi_words(75))
        self.assertIn("rising", agents.rsi_words(61))
        self.assertIn("weak", agents.rsi_words(44))
        self.assertIn("sold hard", agents.rsi_words(20))
        self.assertIn("not enough", agents.rsi_words(None))


class TopDown(unittest.TestCase):
    def look(self, day, four, hour, quarter):
        return agents.top_down({"1D": {"bias": day}, "4H": {"bias": four}, "1H": {"bias": hour}, "15m": {"bias": quarter}})

    def test_the_wide_charts_decide_and_the_short_ones_time_it(self):
        self.assertEqual(self.look("up", "up", "up", "up")["call"], "up")
        self.assertEqual(self.look("up", "up", "mixed", "mixed")["call"], "up")
        self.assertEqual(self.look("up", "up", "down", "down")["call"], "wait")
        self.assertEqual(self.look("up", "up", "down", "up")["call"], "up")
        self.assertEqual(self.look("up", "mixed", "up", "up")["call"], "wait")
        self.assertEqual(self.look("up", "down", "up", "up")["call"], "wait")
        self.assertEqual(self.look("mixed", "up", "up", "up")["call"], "wait")
        self.assertEqual(self.look("down", "down", "up", "up")["call"], "down")
        self.assertEqual(self.look("down", "up", "up", "up")["call"], "down")

    def test_a_chart_that_is_missing_makes_no_call(self):
        self.assertEqual(agents.top_down({})["call"], "none")
        self.assertEqual(agents.top_down(None)["call"], "none")
        self.assertEqual(self.look("up", "none", "up", "up")["call"], "none")
        found = agents.top_down({"1D": {"bias": "up"}, "4H": {"bias": "up"}})
        self.assertEqual(found["call"], "up")
        self.assertEqual(found["marks"], "1D ↑ · 4H ↑ · 1H · · 15m ·")


class Plan(unittest.TestCase):
    def test_the_stop_is_three_candle_ranges_under_and_the_mark_three_risks_over(self):
        made = agents.plan(1000.0, 10.0, 8, 20_000)
        self.assertEqual((made["stop"], made["by"], made["target"]), (970.0, "atr", 1090.0))
        self.assertAlmostEqual(made["riskPercent"], 3.0)
        self.assertAlmostEqual(made["rewardPercent"], 9.0)
        self.assertAlmostEqual(made["riskIdr"], 600.0)
        self.assertAlmostEqual(made["rewardIdr"], 1800.0)
        self.assertAlmostEqual((made["target"] - made["entry"]) / (made["entry"] - made["stop"]), 3.0)

    def test_the_senders_hard_stop_wins_when_it_is_nearer(self):
        made = agents.plan(1000.0, 50.0, 8, 20_000)
        self.assertEqual((made["stop"], made["by"], made["target"]), (920.0, "hard", 1240.0))
        self.assertAlmostEqual(made["riskIdr"], 1600.0)
        only_hard = agents.plan(1000.0, 0, 8, 20_000)
        self.assertEqual(only_hard["by"], "hard")
        self.assertEqual(agents.plan(1000.0, 10.0, 0, 20_000)["by"], "atr")

    def test_what_cannot_be_worked_out_is_no_plan(self):
        self.assertIsNone(agents.plan(0, 10.0, 8, 20_000))
        self.assertIsNone(agents.plan(None, None, None, None))
        self.assertIsNone(agents.plan(1000.0, 0, 0, 20_000))
        self.assertIsNone(agents.plan(1000.0, 400.0, 0, 20_000))  # a stop under zero

    def test_a_coin_held_keeps_the_risk_it_was_bought_with(self):
        rows = rows_going(True)
        opened = rows[-10]["t"]
        position = {"symbol": "BTCUSDT", "price": rows[-10]["o"], "spent": 20_000, "now": rows[-1]["c"], "openedAt": opened}
        made = agents.held_plan(position, rows, 8, NOW)
        spread = learn.atr(rows, learn.ATR_PERIOD)[-11]  # the last candle finished before the buy
        self.assertAlmostEqual(made["stop"], position["price"] - 3 * spread)
        self.assertAlmostEqual(made["target"], position["price"] + 9 * spread)
        self.assertGreater(made["trail"], made["stop"])  # the price rose, so the stop moved up behind it
        self.assertAlmostEqual(made["reached"], (rows[-1]["c"] - position["price"]) / (3 * spread))

    def test_the_moving_stop_never_goes_down_and_ignores_the_running_candle(self):
        rows = rows_going(True)[:-30] + rows_going(False, 30, rows_going(True)[-31]["c"])
        for index, row in enumerate(rows):
            row["t"] = NOW - (len(rows) - index) * 4 * HOUR
        position = {"price": rows[-40]["o"], "spent": 20_000, "openedAt": rows[-40]["t"]}
        made = agents.held_plan(position, rows, 8, NOW)
        ranges = learn.atr(rows, learn.ATR_PERIOD)
        best = max(rows[index]["c"] - 3 * ranges[index] for index in range(len(rows) - 40, len(rows)))
        self.assertAlmostEqual(made["trail"], max(made["stop"], best))
        running = [dict(row) for row in rows] + [{"t": NOW - HOUR, "o": 1e9, "h": 1e9, "l": 1e9, "c": 1e9, "v": 0.0}]
        self.assertAlmostEqual(agents.held_plan(position, running, 8, NOW)["trail"], made["trail"])

    def test_without_candles_a_coin_held_still_has_the_hard_stop(self):
        made = agents.held_plan({"price": 1000.0, "spent": 20_000, "now": 1040.0, "openedAt": NOW}, [], 8, NOW)
        self.assertEqual((made["stop"], made["by"], made["trail"]), (920.0, "hard", 920.0))
        self.assertAlmostEqual(made["reached"], 0.5)
        self.assertIsNone(agents.held_plan({"price": 0}, [], 8, NOW))


class Desk(unittest.TestCase):
    def setUp(self):
        self.view = desk.demo_view(NOW)
        self.report = self.view["report"]

    def flat(self):
        """The demo with no coin held and room for a buy."""
        view = copy.deepcopy(self.view)
        view["report"]["positions"] = []
        return view

    def test_six_agents_in_the_order_of_the_work(self):
        made, by = team_of(self.view)
        self.assertEqual([member["key"] for member in made["team"]], ["research", "market", "strategy", "risk", "execution", "lead"])
        self.assertEqual([member["name"] for member in made["team"]], ["Research analyst", "Market analyst", "Strategist", "Risk manager", "Execution trader", "Desk lead"])
        self.assertEqual(made["coin"], "BTC")
        for member in made["team"]:
            self.assertIn(member["state"], {"yes", "wait", "no", "warn", "off"})
            self.assertTrue(member["head"] and member["lines"] and member["hands"] and member["role"])
            self.assertTrue(all(kind in {"ok", "no", "info"} and words for kind, words in member["lines"]))

    def test_holding_a_coin(self):
        made, by = team_of(self.view)
        self.assertEqual(by["strategy"]["head"], "BTC · HOLD: checks still pass")
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("wait", "At the limit: 1 of 1 open"))
        self.assertEqual((by["execution"]["state"], by["execution"]["head"]), ("yes", "Holding BTC · +Rp306"))
        self.assertEqual((by["lead"]["state"], by["lead"]["head"]), ("yes", "Hold BTC: let it run"))
        self.assertEqual(made["plan"]["entry"], 1_193_900_000)
        self.assertGreaterEqual(made["plan"]["trail"], made["plan"]["stop"])
        self.assertTrue(any("does not sell at the 1:3 mark by itself" in words for _, words in by["strategy"]["lines"]))

    def test_a_held_coin_whose_check_failed_is_sold_at_the_next_check(self):
        view = copy.deepcopy(self.view)
        view["signals"][0].update(action="SELL", why="momentum turned down")
        _, by = team_of(view)
        self.assertEqual((by["strategy"]["state"], by["lead"]["state"], by["lead"]["head"]), ("no", "no", "Sell BTC at the next check"))

    def test_a_buy_signal_with_room_is_a_buy(self):
        view = self.flat()
        view["signals"][0].update(action="BUY", why="all three checks pass")
        made, by = team_of(view)
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("yes", "Clear: one buy of Rp20.000 allowed"))
        self.assertEqual((by["execution"]["state"], by["lead"]["state"], by["lead"]["head"]), ("wait", "yes", "Buy BTC at the next check"))
        self.assertEqual(made["plan"]["entry"], 1_214_900_000)  # the price to buy at Indodax
        self.assertNotIn("trail", made["plan"])
        self.assertAlmostEqual((made["plan"]["target"] - made["plan"]["entry"]) / (made["plan"]["entry"] - made["plan"]["stop"]), 3.0)

    def test_no_signal_to_buy_is_a_wait(self):
        view = self.flat()
        view["signals"][0].update(action="WAIT", why="waiting for RSI")
        _, by = team_of(view)
        self.assertEqual((by["strategy"]["state"], by["lead"]["state"], by["lead"]["head"]), ("wait", "wait", "Wait: no buy now"))

    def test_a_pause_stops_a_buy_but_not_the_desk(self):
        view = self.flat()
        view["paused"] = True
        view["signals"][0].update(action="BUY")
        _, by = team_of(view)
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("warn", "Paused: no new buys"))
        self.assertEqual((by["lead"]["state"], by["lead"]["head"]), ("warn", "Signal says buy, risk says no"))

    def test_too_little_rupiah_stops_a_buy(self):
        view = self.flat()
        view["report"]["cash"] = 9_000
        view["signals"][0].update(action="BUY")
        _, by = team_of(view)
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("warn", "Not enough rupiah for a buy"))
        self.assertEqual(by["lead"]["state"], "warn")

    def test_the_safety_stop_blocks_everything(self):
        view = self.flat()
        view["report"].update(tripped=True, trippedWhy="an order was not confirmed")
        view["signals"][0].update(action="BUY")
        _, by = team_of(view)
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("no", "Blocked: safety stop is on"))
        self.assertEqual((by["lead"]["state"], by["lead"]["head"]), ("no", "Blocked: safety stop is on"))
        self.assertTrue(any("an order was not confirmed" in words for _, words in by["risk"]["lines"]))

    def test_a_key_that_did_not_pass_its_check_blocks_real_money(self):
        view = self.flat()
        view["report"]["checked"] = False
        _, by = team_of(view)
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("no", "Blocked: key not checked"))

    def test_a_stopped_sender_is_the_first_thing_the_lead_says(self):
        _, by = team_of(self.view, "stopped")
        self.assertEqual((by["execution"]["state"], by["execution"]["head"]), ("no", "Sender is stopped: no orders"))
        self.assertEqual((by["lead"]["state"], by["lead"]["head"]), ("no", "Stopped: start the sender"))
        _, by = team_of(self.view, "waiting")
        self.assertEqual(by["execution"]["state"], "warn")
        _, by = team_of(self.view, "here", cycle_age=400)
        self.assertEqual((by["execution"]["state"], by["execution"]["head"]), ("warn", "Quiet: waiting for the network"))

    def test_the_research_analyst_shows_the_ideas_on_paper_and_an_old_study(self):
        summary = agents.demo_summary(self.report["learn"])
        self.assertEqual([idea["key"] for idea in summary["ideas"]], ["target", "topdown", "both"])
        _, by = team_of(self.view, summary=summary)
        said = " ".join(words for _, words in by["research"]["lines"])
        self.assertEqual(by["research"]["state"], "yes")
        self.assertIn("Score 2,8 of 10", by["research"]["head"])
        self.assertIn("Sell at 1:3", said)
        self.assertIn("Top-down", said)
        self.assertIn("only by hand", said)
        self.assertIn("not a promise", said)
        old = dict(summary, at=NOW - 20 * HOUR)
        _, by = team_of(self.view, summary=old)
        self.assertEqual(by["research"]["state"], "warn")
        _, by = team_of(self.view, summary={})
        self.assertEqual((by["research"]["state"], by["research"]["head"]), ("off", "No study yet"))

    def test_a_review_verdict_changes_nothing_by_itself(self):
        summary = dict(agents.demo_summary(self.report["learn"]), verdict="review")
        _, by = team_of(self.view, summary=summary)
        self.assertIn("review due", by["research"]["head"])
        self.assertTrue(any("Nothing changes by itself" in words for _, words in by["research"]["lines"]))

    def test_with_nothing_known_yet_the_desk_still_stands(self):
        made = agents.desk(None, None, {}, None, "waiting", NOW)
        by = {member["key"]: member for member in made["team"]}
        self.assertEqual(made["coin"], "BTC")
        self.assertIsNone(made["plan"])
        self.assertEqual((by["research"]["state"], by["market"]["state"], by["strategy"]["state"], by["risk"]["state"]), ("off", "off", "off", "off"))
        self.assertEqual(by["lead"]["head"], "Wait: no fresh signal")

    def test_practice_trades_do_not_count_as_held_in_real_mode(self):
        view = self.flat()
        view["report"]["positions"] = [{"symbol": "ETHUSDT", "real": False, "spent": 20_000, "value": 21_000, "price": 51_000_000, "openedAt": NOW - HOUR}]
        self.assertEqual(agents.held_now(view["report"]), [])
        view["report"]["mode"] = "practice"
        self.assertEqual(len(agents.held_now(view["report"])), 1)

    def test_the_coin_talked_about_is_the_one_held_else_the_first_traded(self):
        self.assertEqual(agents.focus_coin(self.report, self.view, {"BTC", "ETH"}), "BTC")
        self.assertEqual(agents.focus_coin({}, self.view, {"ETH"}), "ETH")
        self.assertEqual(agents.focus_coin({}, None, {"SOL", "ETH"}), "ETH")
        self.assertEqual(agents.focus_coin({}, None), "BTC")

    def test_no_agent_promises_a_result(self):
        for view in (self.view, self.flat()):
            made, _ = team_of(view, summary=agents.demo_summary(view["report"]["learn"]))
            said = json.dumps(made, ensure_ascii=False).lower()
            for word in ("guarantee", "will win", "sure win", "100%", "risk-free", "risk free", "cannot lose"):
                self.assertNotIn(word, said)
        self.assertIn("No AI", agents.NOT_AI)


def chart_reading(key, trend=True, momentum=True, strength=60.0):
    """One chart's reading with only what the debate looks at."""
    return {"key": key, "bias": "up" if trend and momentum else "down" if not trend and not momentum else "mixed", "trend": trend, "momentum": momentum, "rsi": strength, "text": "made up"}


def all_charts(trend=True, momentum=True, strength=60.0):
    return {frame["key"]: chart_reading(frame["key"], trend, momentum, strength) for frame in agents.TIMEFRAMES}


class Mood(unittest.TestCase):
    """The Fear and Greed index: shown by the market analyst, never used to buy."""

    def answer(self, value="12", name="Extreme Fear", at=NOW // 1000 - 3600):
        return {"name": "Fear and Greed Index", "data": [{"value": value, "value_classification": name, "timestamp": str(at)}]}

    def test_the_answer_becomes_a_number_and_a_name(self):
        self.assertEqual(agents.parse_mood(self.answer(), NOW), {"value": 12, "name": "extreme fear", "at": NOW // 1000 * 1000 - 3600 * 1000})
        self.assertEqual(agents.parse_mood(self.answer("60", ""), NOW)["name"], "greed")
        self.assertEqual([agents.parse_mood(self.answer(str(value), ""))["name"] for value in (0, 24, 25, 50, 75, 76, 100)], ["extreme fear", "extreme fear", "fear", "neutral", "greed", "extreme greed", "extreme greed"])

    def test_a_broken_or_old_answer_is_no_mood(self):
        for broken in (None, {}, {"data": []}, {"data": [{"value": "x", "timestamp": "1"}]}, {"data": [{"value": "140", "timestamp": "1"}]}, {"data": [{"value": "-1", "timestamp": "1"}]}, "broken"):
            self.assertIsNone(agents.parse_mood(broken, NOW))
        self.assertIsNone(agents.parse_mood(self.answer(at=NOW // 1000 - 4 * 86400), NOW))
        self.assertIsNotNone(agents.parse_mood(self.answer(at=NOW // 1000 - 4 * 86400)))  # no clock given: the age is not judged

    def test_a_page_that_cannot_be_read_is_no_mood_and_no_fault(self):
        def down(_url):
            raise OSError("no network")

        asked = []
        self.assertIsNone(agents.fetch_mood(down, NOW))
        self.assertEqual(agents.fetch_mood(lambda url: asked.append(url) or self.answer(), NOW)["value"], 12)
        self.assertEqual(asked, [agents.MOOD_URL])
        self.assertTrue(agents.MOOD_URL.startswith("https://api.alternative.me/"))

    def test_the_market_analyst_shows_it_and_says_it_is_not_used(self):
        view = desk.demo_view(NOW)
        made = agents.desk(view, view["report"], readings(), None, "here", NOW, {"BTC"}, 20, 0, "", charts()["4H"], {"value": 12, "name": "extreme fear"})
        said = " ".join(words for _, words in made["team"][1]["lines"])
        self.assertIn("Mood of the crypto market: 12 of 100, extreme fear", said)
        self.assertIn("Shown only", said)
        plain, _ = team_of(view)
        self.assertNotIn("Mood of the crypto market", json.dumps(plain))
        self.assertEqual(agents.mood_text(None), "")
        self.assertEqual(agents.mood_text({}), "")

    def test_the_mood_never_moves_a_call(self):
        view = desk.demo_view(NOW)
        calm, _ = team_of(view)
        for value in (0, 50, 100):
            made = agents.desk(view, view["report"], readings(), view["report"].get("learn"), "here", NOW, {"BTC", "ETH"}, 20, 0, "", charts()["4H"], {"value": value, "name": "x"})
            self.assertEqual([(member["state"], member["head"]) for member in made["team"]], [(member["state"], member["head"]) for member in calm["team"]])
            self.assertEqual(made["debate"], calm["debate"])
            self.assertEqual(made["plan"], calm["plan"])


class Debate(unittest.TestCase):
    """Bull against bear: points from the four charts, a wider chart counting for more, and a five-step rating."""

    def test_every_chart_gives_three_points_to_one_side_or_the_other(self):
        found = agents.debate(all_charts())
        self.assertEqual((len(found["pro"]), len(found["con"]), found["share"]), (12, 0, 100))
        found = agents.debate(all_charts(False, False, 40.0))
        self.assertEqual((len(found["pro"]), len(found["con"]), found["share"]), (0, 12, 0))
        self.assertTrue(all(point.split(":")[0] in {frame["name"] for frame in agents.TIMEFRAMES} for point in found["con"]))

    def test_a_wider_chart_counts_for_more(self):
        mixed = all_charts(False, False, 40.0)
        mixed["1D"] = chart_reading("1D")
        day_for = agents.debate(mixed)["share"]
        mixed = all_charts(False, False, 40.0)
        mixed["15m"] = chart_reading("15m")
        short_for = agents.debate(mixed)["share"]
        self.assertEqual((day_for, short_for), (40, 10))

    def test_the_strength_gauge_is_for_a_buy_only_inside_the_rules_band(self):
        for strength, good in ((49.9, False), (50.0, True), (69.9, True), (70.0, False), (20.0, False)):
            found = agents.debate({"4H": chart_reading("4H", True, True, strength)})
            self.assertEqual(len(found["pro"]), 3 if good else 2, strength)

    def test_a_young_chart_without_its_200_average_gives_two_points(self):
        young = chart_reading("4H")
        young["trend"] = None
        self.assertEqual(len(agents.debate({"4H": young})["pro"]), 2)

    def test_the_five_steps(self):
        buy, wait = {"action": "BUY"}, {"action": "WAIT"}
        split = all_charts(False, False, 40.0)
        split["1D"] = chart_reading("1D")  # 40 of 100
        half = all_charts(False, False, 40.0)
        half["1D"], half["1H"] = chart_reading("1D"), chart_reading("1H")  # 60 of 100
        self.assertEqual(agents.debate(all_charts(), buy)["rating"], "buy")
        self.assertEqual(agents.debate(split, buy)["rating"], "lean_buy")
        self.assertEqual(agents.debate(half, wait)["rating"], "lean_buy")
        self.assertEqual(agents.debate(all_charts(True, False, 40.0), wait)["rating"], "lean_out")
        self.assertEqual(agents.debate(all_charts(False, False, 40.0), wait)["rating"], "out")
        middle = all_charts(False, False, 40.0)
        middle["1D"], middle["15m"] = chart_reading("1D"), chart_reading("15m")  # 50 of 100
        found = agents.debate(middle, wait)
        self.assertEqual((found["share"], found["rating"], found["name"], found["step"]), (50, "wait", "Wait", 3))
        self.assertEqual([agents.debate(all_charts(), buy)["step"], agents.debate(all_charts(False, False, 40.0), wait)["step"]], [1, 5])

    def test_rising_charts_without_the_rules_checks_are_never_a_buy(self):
        for signal in ({"action": "WAIT"}, {"action": "SELL"}, None, {"error": "no answer", "action": "BUY"}):
            found = agents.debate(all_charts(), signal)
            self.assertEqual(found["rating"], "lean_buy", signal)
            self.assertIn("no buy yet", found["text"])

    def test_a_coin_held_is_rated_in_holding_words(self):
        self.assertEqual(agents.debate(all_charts(), {"action": "HOLD"}, held=True)["name"], "Hold")
        sold = agents.debate(all_charts(), {"action": "SELL"}, held=True)
        self.assertEqual((sold["rating"], sold["name"]), ("out", "Sell"))
        self.assertIn("sold at the next check", sold["text"])
        self.assertEqual(agents.debate(all_charts(False, False, 40.0), {"action": "HOLD"}, held=True)["name"], "Hold, watch closely")

    def test_with_no_chart_there_is_nothing_to_weigh(self):
        for nothing in ({}, None, {"4H": {"bias": "none"}}):
            found = agents.debate(nothing, {"action": "BUY"})
            self.assertEqual((found["share"], found["rating"], found["pro"], found["con"]), (None, "wait", [], []))
        self.assertIn("not read yet", agents.debate_line(agents.debate({})))
        self.assertIn("not read yet", agents.debate_line(None))

    def test_the_desk_lead_says_the_rating_and_that_the_rules_decide(self):
        view = desk.demo_view(NOW)
        made, by = team_of(view)
        said = " ".join(words for _, words in by["lead"]["lines"])
        self.assertIn("Bull against bear: ", said)
        self.assertIn(f"Rating: {made['debate']['name']} (step {made['debate']['step']} of 5)", said)
        self.assertIn("by the rules' checks alone", said)
        self.assertEqual(len(made["debate"]["pro"]) + len(made["debate"]["con"]), 12)

    def test_the_rating_never_changes_what_the_desk_lead_calls(self):
        view = desk.demo_view(NOW)
        view["report"]["positions"] = []
        view["signals"][0].update(action="WAIT", why="waiting for RSI")
        for found in (all_charts(), all_charts(False, False, 40.0)):
            _, by = team_of(view, found=found)
            self.assertEqual((by["lead"]["state"], by["lead"]["head"]), ("wait", "Wait: no buy now"))


class RiskViews(unittest.TestCase):
    """Three views on the size of one buy: careful, balanced, bold."""

    def report(self, cash=50_000, order=20_000, stop=8, positions=()):
        return {"mode": "real", "cash": cash, "orderIdr": order, "stopPercent": stop, "positions": list(positions)}

    def test_the_loss_of_one_buy_is_set_against_the_whole_account(self):
        views = agents.risk_views(self.report())
        self.assertEqual([(view["name"], view["limit"], view["ok"]) for view in views], [("Careful", 1.0, False), ("Balanced", 2.0, False), ("Bold", 5.0, True)])
        self.assertAlmostEqual(views[0]["share"], 3.2)  # Rp1.600 of Rp50.000
        self.assertEqual([round(view["most"]) for view in views], [6250, 12500, 31250])

    def test_a_coin_held_counts_as_part_of_the_account(self):
        views = agents.risk_views(self.report(cash=30_000, positions=[{"symbol": "BTCUSDT", "value": 20_000, "spent": 20_000}]))
        self.assertAlmostEqual(views[0]["share"], 3.2)
        practice = agents.risk_views(self.report(cash=30_000, positions=[{"symbol": "BTCUSDT", "value": 20_000, "real": False}]))
        self.assertAlmostEqual(practice[0]["share"], 20_000 * 8 / 30_000)

    def test_a_small_buy_passes_every_view(self):
        self.assertTrue(all(view["ok"] for view in agents.risk_views(self.report(cash=200_000, order=20_000))))

    def test_what_is_not_known_gives_no_view(self):
        for report in (None, {}, self.report(cash=None), self.report(cash=True), self.report(cash=0), self.report(order=0), self.report(stop=0), self.report(stop=100)):
            self.assertEqual(agents.risk_views(report), [])

    def test_the_risk_manager_shows_them_and_keeps_its_call(self):
        view = desk.demo_view(NOW)
        _, by = team_of(view)
        said = " ".join(words for _, words in by["risk"]["lines"])
        for name in ("Careful view", "Balanced view", "Bold view", "The views only speak"):
            self.assertIn(name, said)
        self.assertEqual((by["risk"]["state"], by["risk"]["head"]), ("wait", "At the limit: 1 of 1 open"))


class Yardstick(unittest.TestCase):
    """The rules against one buy that is never sold."""

    def test_holding_that_earned_more_and_dipped_deeper_is_said_both_ways(self):
        said = agents.hold_text({"order": 20_000, "perYear": 4602, "dip": -11976}, {"perYear": 25576, "dip": -165557})
        self.assertIn("one buy of Rp20.000 in March 2020 and never sold", said)
        self.assertIn("+Rp25.576 a year", said)
        self.assertIn("earned more than the rules but dipped deeper, about 14 times as deep", said)
        self.assertIn("give up gain to keep the dips small", said)

    def test_the_other_cases_are_said_plainly(self):
        self.assertIn("earned less than the rules and dipped deeper", agents.hold_text({"order": 20_000, "perYear": 4602, "dip": -11976}, {"perYear": 100, "dip": -50000}))
        self.assertIn("earned more than the rules and dipped less deep", agents.hold_text({"order": 20_000, "perYear": 4602, "dip": -11976}, {"perYear": 9000, "dip": -500}))

    def test_the_research_analyst_shows_it_when_the_study_has_it(self):
        view = desk.demo_view(NOW)
        _, by = team_of(view, summary=agents.demo_summary(view["report"]["learn"]))
        self.assertTrue(any(words.startswith("Yardstick, one buy of ") for _, words in by["research"]["lines"]))
        _, by = team_of(view)
        self.assertFalse(any(words.startswith("Yardstick") for _, words in by["research"]["lines"]))


class Feed(unittest.TestCase):
    def setUp(self):
        self.view = desk.demo_view(NOW)

    def test_the_first_look_lets_all_six_speak_and_then_only_what_changed(self):
        made, by = team_of(self.view)
        first = agents.feed_events({}, made["team"], NOW)
        self.assertEqual([item["key"] for item in first], ["research", "market", "strategy", "risk", "execution", "lead"])
        self.assertEqual(agents.feed_events(by, made["team"], NOW + 1000), [])
        stopped, _ = team_of(self.view, "stopped")
        news = agents.feed_events(by, stopped["team"], NOW + 2000)
        self.assertEqual([item["key"] for item in news], ["execution", "lead"])
        self.assertEqual(news[0], {"at": NOW + 2000, "key": "execution", "name": "Execution trader", "state": "no", "text": "Sender is stopped: no orders"})

    def test_a_heads_up_is_read_without_its_telegram_mark(self):
        signals = {item["coin"]: item for item in self.view["signals"]}
        held = agents.heads_up(signals["BTC"])
        self.assertEqual((held["kind"], held["level"], len(held["lines"])), ("sell", "far", 2))
        self.assertTrue(held["lines"][0].startswith("Heads-up: no sale in sight."))
        self.assertTrue(held["lines"][1].startswith("The sender's own stop"))
        self.assertIsNone(agents.heads_up(signals["SOL"]), "no heads-up was sent for this coin")
        self.assertIsNone(agents.heads_up(None))
        self.assertIsNone(agents.heads_up({"soon": {"kind": "buy", "level": "likely", "lines": []}}), "nothing to say")
        self.assertIsNone(agents.heads_up({"soon": {"kind": "buy", "level": "certain", "lines": ["x"]}}), "an unknown level is not shown as if it were known")
        self.assertIsNone(agents.heads_up({"soon": "soon"}))

    def test_the_strategist_and_the_desk_lead_say_the_heads_up(self):
        made, by = team_of(self.view)
        self.assertEqual(made["soon"]["level"], "far")
        said = [text for _mark, text in by["strategy"]["lines"]]
        self.assertTrue(any(text.startswith("Heads-up: no sale in sight.") for text in said))
        self.assertTrue(any(text.startswith("The sender's own stop") for text in said))
        lead = [text for _mark, text in by["lead"]["lines"]]
        self.assertEqual(sum(text.startswith("Heads-up:") for text in lead), 1, "the desk lead says it once, in one line")
        self.assertEqual(by["strategy"]["head"], "BTC · HOLD: checks still pass", "the head stays the call, so the desk lead still reads it")

    def test_only_a_near_or_likely_heads_up_is_news_and_only_once(self):
        far = {"kind": "buy", "level": "far", "at": NOW, "lines": ["Heads-up: no buy in sight."]}
        near = {"kind": "buy", "level": "near", "at": NOW, "lines": ["Heads-up: a buy is close."]}
        likely = {"kind": "buy", "level": "likely", "at": NOW, "lines": ["Heads-up: a buy looks likely."]}
        sale = {"kind": "sell", "level": "likely", "at": NOW, "lines": ["Heads-up: a sale looks likely."]}
        self.assertIsNone(agents.soon_event(None, "BTC", None))
        self.assertIsNone(agents.soon_event(None, "BTC", far), "far away is no news")
        self.assertEqual(agents.soon_event(agents.soon_key("BTC", far), "BTC", near), ("warn", "BTC · Heads-up: a buy is close."))
        self.assertIsNone(agents.soon_event(agents.soon_key("BTC", near), "BTC", near), "said once")
        self.assertEqual(agents.soon_event(agents.soon_key("BTC", near), "BTC", likely), ("yes", "BTC · Heads-up: a buy looks likely."))
        self.assertEqual(agents.soon_event(agents.soon_key("BTC", likely), "BTC", sale), ("no", "BTC · Heads-up: a sale looks likely."))
        later = dict(near, at=NOW + 4 * 3600_000)
        self.assertEqual(agents.soon_event(agents.soon_key("BTC", near), "BTC", later)[0], "warn", "the next candle is a new heads-up")
        self.assertIsNone(agents.soon_event(agents.soon_key("BTC", sale), "BTC", None), "a heads-up that went away is said by the checks, not here")

    def test_the_senders_log_reaches_the_right_agent(self):
        self.assertEqual(agents.log_event("21:13:07  BTC: bought for Rp20.000 at Indodax"), ("execution", "BTC: bought for Rp20.000 at Indodax"))
        self.assertEqual(agents.log_event("21:13:07  BTC: sold for Rp20.730")[0], "execution")
        self.assertEqual(agents.log_event("21:13:07  Safety stop is ON: look at Indodax first")[0], "risk")
        self.assertIsNone(agents.log_event("21:13:07  Safety stop cleared"))
        self.assertEqual(agents.log_event("21:13:07  Studying the rules on the newest prices")[0], "research")
        self.assertEqual(agents.log_event("21:13:07  [desk] sender started")[0], "execution")
        self.assertIsNone(agents.log_event("21:13:07  cycle done, nothing to do"))
        self.assertIsNone(agents.log_event(""))
        self.assertIsNone(agents.log_event(None))


class Trades(unittest.TestCase):
    def setUp(self):
        self.report = desk.demo_view(NOW)["report"]

    def test_every_buy_and_sale_newest_first(self):
        rows = agents.execution_rows(self.report, True)
        self.assertEqual([row["side"] for row in rows], ["BUY", "SELL", "BUY", "SELL", "BUY"])
        self.assertEqual([row["at"] for row in rows], sorted((row["at"] for row in rows), reverse=True))
        self.assertEqual((rows[0]["result"], rows[0]["price"], rows[0]["amount"]), ("open", "1.193,9 jt", "Rp20.000"))
        self.assertEqual((rows[1]["result"], rows[1]["tag"]), ("+Rp730", "up"))
        self.assertEqual((rows[3]["result"], rows[3]["tag"]), ("-Rp690", "down"))

    def test_practice_rows_are_left_out_of_real_money_and_named_otherwise(self):
        report = copy.deepcopy(self.report)
        report["closed"].append({"symbol": "ETHUSDT", "real": False, "spent": 20_000, "received": 25_000, "boughtAt": NOW - 9 * HOUR, "at": NOW - 8 * HOUR, "quantity": 0.0004, "how": "sold"})
        self.assertEqual(len(agents.execution_rows(report, True)), 5)
        every = agents.execution_rows(report, False)
        self.assertEqual(len(every), 7)
        self.assertIn("ETH (practice)", {row["coin"] for row in every})
        self.assertIn("2 finished trades, 1 won", agents.result_line(report, True))
        self.assertIn("3 finished trades, 2 won", agents.result_line(report, False))

    def test_a_trade_closed_without_a_sale_has_no_result(self):
        report = {"mode": "real", "positions": [], "closed": [{"symbol": "BTCUSDT", "real": True, "spent": 20_000, "received": 0, "boughtAt": NOW - 9 * HOUR, "at": NOW - 8 * HOUR, "quantity": 0.00001, "how": "gone"}]}
        rows = agents.execution_rows(report, True)
        self.assertEqual([(row["side"], row["result"]) for row in rows], [("CLOSED", "no result"), ("BUY", "")])
        self.assertEqual(agents.result_line(report, True), "0 finished trades · result +Rp0 after fees · nothing open")
        self.assertEqual(agents.markers(report, "BTC", True), [(NOW - 9 * HOUR, "buy", 20_000 / 0.00001)])

    def test_the_result_in_one_sentence(self):
        said = agents.result_line(self.report, True)
        self.assertEqual(said, "2 finished trades, 1 won · result +Rp40 after fees · an average win is 1,1 times an average loss · open now +Rp306")
        self.assertEqual(agents.result_line({}, True), "0 finished trades · result +Rp0 after fees · nothing open")

    def test_the_position_in_short_lines(self):
        made = agents.held_plan(self.report["positions"][0], charts()["4H"], 8, NOW)
        lines = agents.position_lines(self.report, made)
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("BTC: paid Rp20.000 on "))
        self.assertIn("+Rp306 (+1,5%)", lines[0])
        self.assertIn("1:3 mark", lines[1])
        self.assertEqual(len(agents.position_lines(self.report)), 1)
        self.assertEqual(agents.position_lines({"positions": []}), [])

    def test_the_chart_marks_buys_and_sales_of_its_coin_only(self):
        marks = agents.markers(self.report, "BTC", True)
        self.assertEqual([way for _, way, _ in marks], ["buy", "sell", "buy", "sell", "buy"])
        self.assertEqual(marks, sorted(marks))
        self.assertEqual(marks[-1], (NOW - 5 * HOUR, "buy", 1_193_900_000))
        self.assertAlmostEqual(marks[1][2], 19_310 / 0.0000171)
        self.assertEqual(agents.markers(self.report, "ETH", True), [])


class Chart(unittest.TestCase):
    def test_the_window_stays_inside_the_candles(self):
        self.assertEqual(agents.clamp_window(320, 120, 0), (120, 0))
        self.assertEqual(agents.clamp_window(320, 5, 0), (agents.MIN_VISIBLE, 0))
        self.assertEqual(agents.clamp_window(320, 900, 50), (320, 0))
        self.assertEqual(agents.clamp_window(320, 120, 900), (120, 200))
        self.assertEqual(agents.clamp_window(320, 120, -5), (120, 0))
        self.assertEqual(agents.clamp_window(10, 120, 0), (10, 0))
        self.assertEqual(agents.clamp_window(0, 120, 0), (0, 0))

    def test_zoom_keeps_the_candle_under_the_mouse(self):
        visible, offset = agents.zoomed(320, 120, 0, 1, 1.0)
        self.assertEqual((visible, offset), (96, 0))  # at the right edge the newest candle stays
        visible, offset = agents.zoomed(320, 120, 40, 1, 0.0)
        first, _ = agents.shown_span(320, visible, offset)
        self.assertEqual(first, agents.shown_span(320, 120, 40)[0])  # at the left edge the oldest shown stays
        self.assertEqual(agents.zoomed(320, 120, 0, -1, 1.0), (150, 0))
        self.assertEqual(agents.zoomed(320, 30, 0, 9, 0.5)[0], agents.MIN_VISIBLE)
        self.assertEqual(agents.zoomed(320, 300, 0, -9, 0.5), (320, 0))

    def test_sliding_stops_at_both_ends(self):
        self.assertEqual(agents.panned(320, 120, 0, 30), (120, 30))
        self.assertEqual(agents.panned(320, 120, 30, -100), (120, 0))
        self.assertEqual(agents.panned(320, 120, 0, 5000), (120, 200))
        self.assertEqual(agents.shown_span(320, 120, 200), (0, 120))
        self.assertEqual(agents.shown_span(320, 120, 0), (200, 320))

    def test_the_scale_has_room_and_takes_in_a_near_level_only(self):
        rows = [{"l": 90.0, "h": 110.0}, {"l": 95.0, "h": 120.0}]
        low, high = agents.price_bounds(rows)
        self.assertTrue(low < 90 and high > 120)
        self.assertAlmostEqual(high - 120, 90 - low)
        low, high = agents.price_bounds(rows, [[None, 80.0], [None, None]], [125.0, 500.0, 0, None])
        self.assertTrue(low < 80 and 125 < high < 500)
        self.assertEqual(agents.price_bounds([]), (0.0, 1.0))
        flat_low, flat_high = agents.price_bounds([{"l": 100.0, "h": 100.0}])
        self.assertLess(flat_low, flat_high)

    def test_round_prices_along_the_scale(self):
        self.assertEqual(agents.ticks(1.0, 9.0, 5), [2.0, 4.0, 6.0, 8.0])
        found = agents.ticks(1_100_000_000, 1_310_000_000, 5)
        self.assertEqual(found, [1_100_000_000, 1_150_000_000, 1_200_000_000, 1_250_000_000, 1_300_000_000])
        self.assertEqual(agents.ticks(5, 5), [])
        self.assertTrue(2 <= len(agents.ticks(0.0123, 0.0191)) <= 8)

    def test_level_words_never_sit_on_each_other(self):
        self.assertEqual(agents.label_spots([100, 200, 300]), [92, 192, 292])
        self.assertEqual(agents.label_spots([104, 100]), [112, 92])  # the lower line's words go under it
        spots = agents.label_spots([100, 101, 102, 103])
        self.assertTrue(all(later - earlier >= 12 for earlier, later in zip(sorted(spots), sorted(spots)[1:])))
        self.assertEqual(agents.label_spots([]), [])

    def test_a_moment_finds_its_candle(self):
        rows = [{"t": 1000}, {"t": 2000}, {"t": 3000}]
        self.assertEqual([agents.candle_at(rows, moment) for moment in (500, 1000, 2500, 9000)], [-1, 0, 1, 2])
        self.assertEqual(agents.candle_at([], 5), -1)

    def test_times_are_written_in_wib(self):
        moment = 1_794_848_400_000  # 17 November 2026, 00:00 WIB
        self.assertEqual(agents.clock(moment), "17 Nov 00:00")
        self.assertEqual(agents.clock(moment, False), "00:00")
        self.assertEqual(agents.time_label(moment, "1D"), "17 Nov")
        self.assertEqual(agents.time_label(moment, "4H"), "17 Nov 00:00")


class Study(unittest.TestCase):
    def test_the_study_is_read_from_the_senders_folder(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "learn.json"
            self.assertIsNone(agents.read_summary(path))
            path.write_text("not json", encoding="utf-8")
            self.assertIsNone(agents.read_summary(path))
            path.write_text(json.dumps({"summary": {"at": 5, "ideas": []}}), encoding="utf-8")
            self.assertEqual(agents.read_summary(path), {"at": 5, "ideas": []})
            path.write_text(json.dumps([1, 2]), encoding="utf-8")
            self.assertIsNone(agents.read_summary(path))


if __name__ == "__main__":
    unittest.main()
