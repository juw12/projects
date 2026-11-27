"""TradeBot's study of its own rules. It reads prices and the sender's notes. It never orders.

The sender starts it by itself: every four hours (one new 4-hour candle), and right after a buy
or a sale. Each run does the same four things with the newest prices:

  1. replay   the rules that trade the real money, on every 4-hour candle since March 2020
              (signals on Binance BTC/USDT, buys and sales at Indodax BTC/IDR, costs taken off)
  2. unseen   81 nearby versions of the rules are replayed too. For each half year the version
              that did best in the three years BEFORE it is picked, and then judged only on that
              half year, which it has never seen. This is how a new rule has to prove itself:
              a rule that only fits the past fails here.
  3. real     every finished real trade is compared with Indodax's price in that same minute,
              so the cost of a buy and a sale is measured, not assumed. From five real trades
              on, the replay uses the measured cost.
  4. verdict  keep    the rules that trade now are also the best of the last three years
              watch   another version did better lately; it is followed on paper from that day
              review  that version stayed ahead for 90 days and 8 trades, and picking by the past
                      also won on the unseen half years: worth a change, made by hand

Each study also ends in a score, 0 to 10: how far the rules are proven (unseen prices, steady
years, dips, and real trades with their real result). One point a day is kept, so the score
draws a curve. The scale is frozen; only measured things move it.

Three ideas are replayed beside the rules, on paper only: sell at 1:3 (a fixed stop, and a sale
at three times that risk), top-down (buy only while the daily chart is up too), and both. They
do not move the verdict or the score.

It never changes the rules or the size of a buy, and it cannot place an order: it has no code
for it. What it found goes into learn.json next to the sender's state, and the sender passes
the short form on to TradeBot (/learn in Telegram, the daily report, the phone page, the desk).

A share of winning trades near 100% is not the goal and cannot be reached honestly: rules that
almost never lose do it by keeping losing trades open, and one of those ends the account. The
goal is more rupiah after costs on prices the rules have not seen. A past result is no promise.

    python learn.py             one study now (about a minute the first time, seconds after)
    python learn.py --offline   use the candles already saved, read nothing from the network

Standard library only.
"""

from __future__ import annotations

import argparse
import bisect
import json
import sys
import time
import urllib.request
from pathlib import Path

import bridge

HERE = bridge.HERE  # this folder, or the folder of TradeBot.exe
FOUR_HOURS = 4 * 3600 * 1000
DAY = 24 * 3600 * 1000
CANDLES_FROM = 1577836800000  # 1 January 2020 UTC
TEST_FROM = 1583020800000  # 1 March 2020 UTC: the long average needs 200 candles first
CHUNK = 1000  # candles asked for in one call

# fast, slow, regime, RSI from, RSI to, stop in ATRs. LIVE is PARAMS in src/strategy.js.
LIVE = (30, 80, 200, 50, 70, 4.0)
RSI_PERIOD, ATR_PERIOD, COOLDOWN = 14, 14, 6
FAMILY = [
    (fast, slow, regime, rsi_from, rsi_from + 20, stop)
    for fast, slow in ((10, 30), (20, 50), (30, 80))
    for regime in (150, 200, 300)
    for rsi_from in (45, 50, 55)
    for stop in (2.0, 3.0, 4.0)
]

COST = 0.0035  # per buy and per sale: fee and tax, rounded up (an assumption until measured)
SLIP = 0.001  # a worse price than the candle's open, per buy and per sale (an assumption)
MEASURED_FROM = 5  # real trades needed before the measured cost replaces the assumed one
TRAIN_DAYS, TEST_DAYS = 3 * 365, 183
KEEP_RANK = 5  # the watched version stays while it is among the best five of the last three years
REVIEW_DAYS, REVIEW_TRADES = 90, 8

# The score: how far the rules are proven, 0 to 10. The scale is frozen under SCORE_VERSION:
# a change of the scale starts a new curve, so the curve never rises because the ruler changed.
SCORE_VERSION = 1
SCORE_MOST = {"unseen": 3.0, "steady": 2.0, "dips": 2.0, "real": 3.0}
UNSEEN_FULL = 0.30  # a year's gain on unseen prices of 30% of one buy earns all the points
STEADY_FROM, STEADY_FULL = 50, 90  # of 100 twelve-month spans that ended with a gain
DIPS_FULL = 2.0  # a year's gain of twice the deepest dip earns all the points
REAL_TRADES_FULL = 30  # finished real trades that count as full proof
REAL_GAIN_FULL = 0.005  # an average real trade of +0.5% of the money spent, after costs
CURVE_DAYS = 400  # one point a day is kept
CURVE_SENT = 60  # the newest points TradeBot is told

# Two ideas the owner asked for, and the two together. They are followed on paper next to the
# rules that trade. They are not in FAMILY: they move neither the verdict nor the score, and
# nothing is bought or sold by them. A change of the rules still needs every gate of the skill.
IDEAS_SINCE = 1794848400000  # 17 November 2026, 00:00 WIB: the day they were written down
IDEAS = [
    {"key": "target", "name": "sell at 1:3", "target": 3.0, "daily": False},
    {"key": "topdown", "name": "top-down (daily chart up too)", "target": None, "daily": True},
    {"key": "both", "name": "top-down and sell at 1:3", "target": 3.0, "daily": True},
]
DAILY_FAST, DAILY_SLOW = 20, 50  # the averages of the daily chart that must point up
WIB = 7 * 3600 * 1000


# ---------------------------------------------------------------- the indicators (as in src/strategy.js)


def ema(values: list, period: int) -> list:
    out = [None] * len(values)
    if len(values) < period:
        return out
    value = sum(values[:period]) / period
    out[period - 1] = value
    for index in range(period, len(values)):
        value += (values[index] - value) * 2 / (period + 1)
        out[index] = value
    return out


def rsi(closes: list, period: int) -> list:
    out = [None] * len(closes)
    if len(closes) <= period:
        return out
    changes = [closes[index] - closes[index - 1] for index in range(1, period + 1)]
    gain = sum(max(change, 0) for change in changes) / period
    loss = sum(max(-change, 0) for change in changes) / period
    out[period] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    for index in range(period + 1, len(closes)):
        change = closes[index] - closes[index - 1]
        gain = (gain * (period - 1) + max(change, 0)) / period
        loss = (loss * (period - 1) + max(-change, 0)) / period
        out[index] = 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)
    return out


def atr(rows: list, period: int) -> list:
    out = [None] * len(rows)
    if len(rows) <= period:
        return out

    def true_range(index: int) -> float:
        before = rows[index - 1]["c"]
        return max(rows[index]["h"] - rows[index]["l"], abs(rows[index]["h"] - before), abs(rows[index]["l"] - before))

    value = sum(true_range(index) for index in range(1, period + 1)) / period
    out[period] = value
    for index in range(period + 1, len(rows)):
        value = (value * (period - 1) + true_range(index)) / period
        out[index] = value
    return out


class Series:
    """The indicators of one run of candles, each worked out once."""

    def __init__(self, rows: list):
        self.rows = rows
        self.closes = [row["c"] for row in rows]
        self.strength = rsi(self.closes, RSI_PERIOD)
        self.ranges = atr(rows, ATR_PERIOD)
        self._averages = {}

    def average(self, period: int) -> list:
        if period not in self._averages:
            self._averages[period] = ema(self.closes, period)
        return self._averages[period]


def replay(series: Series, rules: tuple) -> list:
    """The trades these rules would have made: (time bought, time sold, how, sale price / that
    candle's open). A decision uses candles up to a close and is filled at the next open."""
    fast_period, slow_period, regime_period, rsi_from, rsi_to, stop_atr = rules
    rows, closes, strength, ranges = series.rows, series.closes, series.strength, series.ranges
    fast, slow, regime = series.average(fast_period), series.average(slow_period), series.average(regime_period)
    trades, position, order, order_stop, last_exit = [], None, None, 0.0, None
    for index in range(max(regime_period, slow_period, ATR_PERIOD + 1), len(rows)):
        row = rows[index]
        if order == "buy" and position is None:
            position = {"at": row["t"], "stop": order_stop}
        elif order == "sell" and position is not None:
            trades.append((position["at"], row["t"], "signal", 1.0))
            position, last_exit = None, index
        order = None
        if position is not None and row["l"] <= position["stop"]:
            trades.append((position["at"], row["t"], "trail", min(row["o"], position["stop"]) / row["o"]))
            position, last_exit = None, index
        trend_up = closes[index] > regime[index]
        momentum_up = fast[index] > slow[index]
        trail = closes[index] - stop_atr * ranges[index]
        if position is not None:
            position["stop"] = max(position["stop"], trail)
            if not momentum_up or not trend_up:
                order = "sell"
        elif last_exit is not None and index - last_exit < COOLDOWN:
            continue
        elif trend_up and momentum_up and rsi_from <= strength[index] <= rsi_to:
            order, order_stop = "buy", trail
    return trades


def daily_up(rows: list) -> list:
    """For each 4-hour candle: was the daily chart up at its close? Up means the last finished
    day closed above its slow average and the fast average is above the slow one. A day that
    is still running is never used."""
    days = []
    for row in rows:
        start = row["t"] - row["t"] % DAY
        if days and days[-1]["t"] == start:
            days[-1]["c"] = row["c"]
        else:
            days.append({"t": start, "c": row["c"]})
    closes = [day["c"] for day in days]
    starts = [day["t"] for day in days]
    fast, slow = ema(closes, DAILY_FAST), ema(closes, DAILY_SLOW)
    flags = []
    for row in rows:
        index = bisect.bisect_right(starts, row["t"] + FOUR_HOURS - DAY) - 1
        flags.append(index >= 0 and slow[index] is not None and closes[index] > slow[index] and fast[index] > slow[index])
    return flags


def replay_idea(series: Series, rules: tuple, target=None, allowed=None) -> list:
    """The trades of an idea: the same buy checks as replay().

    allowed  one flag per candle; a buy is made only where it is True (the top-down filter)
    target   a number like 3.0: the stop stays where it was at the buy and never moves, and the
             coin is sold at that stop or at the price that many times the risk above the buy,
             whichever comes first. Nothing else sells it. When one candle touches both, the stop
             is taken: the worse of the two.
    With neither, it trades exactly like replay()."""
    fast_period, slow_period, regime_period, rsi_from, rsi_to, stop_atr = rules
    rows, closes, strength, ranges = series.rows, series.closes, series.strength, series.ranges
    fast, slow, regime = series.average(fast_period), series.average(slow_period), series.average(regime_period)
    trades, position, order, order_stop, last_exit = [], None, None, 0.0, None
    for index in range(max(regime_period, slow_period, ATR_PERIOD + 1), len(rows)):
        row = rows[index]
        if order == "buy" and position is None:
            risk = row["o"] - order_stop
            position = {"at": row["t"], "stop": order_stop, "target": row["o"] + target * risk if target and risk > 0 else None}
        elif order == "sell" and position is not None:
            trades.append((position["at"], row["t"], "signal", 1.0))
            position, last_exit = None, index
        order = None
        if position is not None and row["l"] <= position["stop"]:
            trades.append((position["at"], row["t"], "trail", min(row["o"], position["stop"]) / row["o"]))
            position, last_exit = None, index
        elif position is not None and position["target"] is not None and row["h"] >= position["target"]:
            trades.append((position["at"], row["t"], "target", max(row["o"], position["target"]) / row["o"]))
            position, last_exit = None, index
        trend_up = closes[index] > regime[index]
        momentum_up = fast[index] > slow[index]
        trail = closes[index] - stop_atr * ranges[index]
        if position is not None:
            if not target:
                position["stop"] = max(position["stop"], trail)
                if not momentum_up or not trend_up:
                    order = "sell"
        elif last_exit is not None and index - last_exit < COOLDOWN:
            continue
        elif trend_up and momentum_up and rsi_from <= strength[index] <= rsi_to and (allowed is None or allowed[index]):
            order, order_stop = "buy", trail
    return trades


def copy_trades(trades: list, prices: list, order_idr: float, stop_percent: float, cost: float, slip: float, start_ms: int):
    """The sender's copy of each trade in rupiah: one buy of a fixed size at a time, sold when
    the rules sell or when the price falls stop_percent under the price paid.
    Returns (times, result after each candle, [(time sold, result of that trade)])."""
    by_start = {bought: (sold, how, ratio) for bought, sold, how, ratio in trades if bought >= start_ms}
    times, values, results, copy, banked = [], [], [], None, 0.0
    for row in prices:
        if row["t"] < start_ms:
            continue
        if copy is None and row["t"] in by_start:
            quantity = order_idr * (1 - cost) / (row["o"] * (1 + slip))
            copy = {"quantity": quantity, "paid": order_idr / quantity, "ends": by_start[row["t"]]}
        if copy is not None:
            sold, how, ratio = copy["ends"]
            hard = copy["paid"] * (1 - stop_percent / 100)
            price = None
            if sold == row["t"]:
                price = row["o"] if how == "signal" else row["o"] * ratio
                if how == "trail" and price < hard:
                    price = min(row["o"], hard)
            elif row["l"] <= hard:
                price = min(row["o"], hard)
            if price is not None:
                result = copy["quantity"] * price * (1 - slip) * (1 - cost) - order_idr
                banked += result
                results.append((row["t"], result))
                copy = None
        floating = copy["quantity"] * row["c"] * (1 - cost) - order_idr if copy else 0.0
        times.append(row["t"])
        values.append(banked + floating)
    return times, values, results


# ---------------------------------------------------------------- the study


def rules_text(rules: tuple) -> str:
    fast, slow, regime, rsi_from, rsi_to, stop = rules
    return f"averages {fast}/{slow}/{regime}, RSI {rsi_from} to {rsi_to}, stop {stop:g} ATR"


def measured_cost(measured: dict):
    """Average cost of one buy plus one sale in percent, from the real trades compared so far."""
    costs = [entry["buy"] + entry["sell"] for entry in measured.values() if isinstance(entry, dict) and "buy" in entry and "sell" in entry]
    return (sum(costs) / len(costs), len(costs)) if costs else (None, 0)


def real_trades(closed: list) -> dict:
    """The finished real trades in the sender's notes: how many, what was spent and what came back."""
    sold = [entry for entry in closed or [] if isinstance(entry, dict) and entry.get("real") and entry.get("how") == "sold"]
    spent = sum(bridge.number(entry.get("spent")) for entry in sold)
    return {"trades": len(sold), "spent": spent, "result": sum(bridge.number(entry.get("received")) for entry in sold) - spent}


def skill(unseen_gain: float, unseen_years: float, order_idr: float, year_up, per_year: float, dip: float, real=None) -> dict:
    """The score, 0 to 10, from what was measured. Nothing in it can be raised by wording.

    unseen  0 to 3  a year's gain on prices the rules had not seen, as a share of one buy
    steady  0 to 2  how many twelve-month spans ended with a gain: 50 of 100 is 0, 90 is all
    dips    0 to 2  a year's gain against the deepest dip: twice the dip is all
    real    0 to 3  half for the number of finished real trades (30 is all), half for what
                    they made after costs (+0.5% a trade is all; few trades count for little)
    """
    real = real if isinstance(real, dict) else {}

    def part(name: str, share: float) -> float:
        return round(SCORE_MOST[name] * min(1.0, max(0.0, share)), 2)

    trades = int(bridge.number(real.get("trades")))
    spent = bridge.number(real.get("spent"))
    proof = min(1.0, trades / REAL_TRADES_FULL)
    gain = (bridge.number(real.get("result")) / spent / REAL_GAIN_FULL) if spent > 0 else 0.0
    parts = {
        "unseen": part("unseen", unseen_gain / unseen_years / order_idr / UNSEEN_FULL if unseen_years > 0 and order_idr > 0 else 0.0),
        "steady": part("steady", ((year_up or 0) - STEADY_FROM) / (STEADY_FULL - STEADY_FROM)),
        "dips": part("dips", per_year / abs(dip) / DIPS_FULL if dip < 0 else (1.0 if per_year > 0 else 0.0)),
        "real": part("real", 0.5 * proof + 0.5 * proof * min(1.0, max(0.0, gain))),
    }
    return {"version": SCORE_VERSION, "total": round(sum(parts.values()), 1), "parts": parts, "realTrades": trades}


def day_of(moment_ms: int) -> str:
    """The calendar day in Batam and Jakarta (WIB)."""
    return time.strftime("%Y-%m-%d", time.gmtime((moment_ms + WIB) / 1000))


def grow(curve, now_ms: int, total: float) -> list:
    """The learning curve: one point a day, the newest study of the day. Oldest first."""
    points = [point for point in curve or [] if isinstance(point, dict) and isinstance(point.get("day"), str) and isinstance(point.get("score"), (int, float))]
    today = day_of(now_ms)
    points = [point for point in points if point["day"] < today]
    points.append({"day": today, "at": now_ms, "score": total})
    return points[-CURVE_DAYS:]


def study(signal_rows: list, price_rows: list, order_idr: float, stop_percent: float, now_ms: int, previous=None, measured=None, real=None) -> dict:
    """One study. previous = the file written by the run before (for the watched version and the curve)."""
    previous = previous if isinstance(previous, dict) else {}
    measured = measured if isinstance(measured, dict) else {}
    cost_percent, cost_trades = measured_cost(measured)
    use_measured = cost_percent is not None and cost_trades >= MEASURED_FROM
    cost, slip = (max(cost_percent, 0.0) / 200, 0.0) if use_measured else (COST, SLIP)

    series = Series(signal_rows)
    runs = {}
    for rules in FAMILY:
        runs[rules] = copy_trades(replay(series, rules), price_rows, order_idr, stop_percent, cost, slip, TEST_FROM)
    times, live_values, live_results = runs[LIVE]
    if len(times) < 2:
        raise ValueError("too few candles to study")
    first, last = times[0], times[-1]

    def at(values: list, moment: int) -> float:
        """The result so far at a moment: the value after the last candle that opened by then."""
        index = bisect.bisect_right(times, moment) - 1
        return values[index] if index >= 0 else 0.0

    def change(rules: tuple, start: int, end: int) -> float:
        values = runs[rules][1]
        return at(values, end) - at(values, start)

    # 1. the rules that trade now
    years = (last - first) / (365.25 * DAY)
    wins = [result for _, result in live_results if result > 0]
    peak = dip = 0.0
    for value in live_values:
        peak = max(peak, value)
        dip = min(dip, value - peak)

    def share_up(days: int):
        starts = range(first, last - days * DAY + 1, DAY)
        ups = [at(live_values, start + days * DAY) - at(live_values, start) > 0 for start in starts]
        return round(100 * sum(ups) / len(ups)) if ups else None

    # 2. half years the picked version has never seen
    windows = []
    train_end = first + TRAIN_DAYS * DAY
    while train_end + 30 * DAY <= last:
        test_end = min(train_end + TEST_DAYS * DAY, last)
        train_start = train_end - TRAIN_DAYS * DAY
        picked = max(FAMILY, key=lambda rules: change(rules, train_start, train_end))
        windows.append({"from": train_end, "to": test_end, "live": change(LIVE, train_end, test_end), "picked": change(picked, train_end, test_end), "rules": rules_text(picked)})
        train_end += TEST_DAYS * DAY
    live_unseen = sum(window["live"] for window in windows)
    picked_unseen = sum(window["picked"] for window in windows)

    # 4. the version to watch: the best of the last three years, kept while it stays near the top
    ranked = sorted(FAMILY, key=lambda rules: change(rules, last - TRAIN_DAYS * DAY, last), reverse=True)
    watched = previous.get("watched") if isinstance(previous.get("watched"), dict) else {}
    old = tuple(watched.get("rules") or ())
    if old in runs and old != LIVE and old in ranked[:KEEP_RANK] and ranked[0] != LIVE:
        challenger, since = old, int(watched.get("since") or now_ms)
    else:
        challenger, since = ranked[0], now_ms
    verdict, shown = "keep", None
    if challenger != LIVE:
        days = max(0, (now_ms - since) // DAY)
        trades_since = sum(1 for sold, _ in runs[challenger][2] if sold > since)
        lead = change(challenger, since, last) - change(LIVE, since, last)
        ready = days >= REVIEW_DAYS and trades_since >= REVIEW_TRADES and lead > 0 and picked_unseen > live_unseen
        verdict = "review" if ready else "watch"
        shown = {"rules": rules_text(challenger), "days": int(days), "trades": trades_since, "lead": round(lead)}

    summary = {
        "at": now_ms,
        "candles": len(times),
        "versions": len(FAMILY),
        "order": order_idr,
        "trades": len(live_results),
        "wins": round(100 * len(wins) / len(live_results)) if live_results else 0,
        "perYear": round(live_values[-1] / years) if years > 0 else 0,
        "dip": round(dip),
        "yearUp": share_up(365),
        "monthUp": share_up(30),
        "unseen": {"windows": len(windows), "up": sum(1 for window in windows if window["live"] > 0), "live": round(live_unseen), "picked": round(picked_unseen)},
        "cost": {"assumed": round((COST + SLIP) * 200, 2), "measured": round(cost_percent, 2) if cost_percent is not None else None, "trades": cost_trades, "used": "measured" if use_measured else "assumed"},
        "challenger": shown,
        "verdict": verdict,
    }
    # The owner's ideas, on paper: the same prices, costs and unseen half years as the rules that trade.
    allowed, ideas = None, []
    for idea in IDEAS:
        if idea["daily"] and allowed is None:
            allowed = daily_up(signal_rows)
        _, idea_values, idea_results = copy_trades(replay_idea(series, LIVE, idea["target"], allowed if idea["daily"] else None), price_rows, order_idr, stop_percent, cost, slip, TEST_FROM)
        idea_peak = idea_dip = 0.0
        for value in idea_values:
            idea_peak = max(idea_peak, value)
            idea_dip = min(idea_dip, value - idea_peak)
        idea_since = max(IDEAS_SINCE, first)
        ideas.append({
            "key": idea["key"],
            "name": idea["name"],
            "trades": len(idea_results),
            "wins": round(100 * sum(1 for _, result in idea_results if result > 0) / len(idea_results)) if idea_results else 0,
            "perYear": round(idea_values[-1] / years) if years > 0 else 0,
            "dip": round(idea_dip),
            "unseen": round(sum(at(idea_values, window["to"]) - at(idea_values, window["from"]) for window in windows)),
            "since": {
                "from": idea_since,
                "days": int(max(0, last - idea_since) // DAY),
                "trades": sum(1 for sold, _ in idea_results if sold > idea_since),
                "lead": round((at(idea_values, last) - at(idea_values, idea_since)) - change(LIVE, idea_since, last)),
            },
        })
    summary["ideas"] = ideas

    # The yardstick: one buy of the same size at the first candle, never sold, at the same costs.
    held_rows = [row for row in price_rows if row["t"] >= TEST_FROM]
    quantity = order_idr * (1 - cost) / (held_rows[0]["o"] * (1 + slip))
    hold_value = hold_peak = hold_dip = 0.0
    for row in held_rows:
        hold_value = quantity * row["c"] * (1 - cost) - order_idr
        hold_peak = max(hold_peak, hold_value)
        hold_dip = min(hold_dip, hold_value - hold_peak)
    summary["hold"] = {"perYear": round(hold_value / years) if years > 0 else 0, "dip": round(hold_dip), "total": round(hold_value)}

    # 5. the score, and its curve over the days
    unseen_years = sum(window["to"] - window["from"] for window in windows) / (365.25 * DAY)
    score = skill(live_unseen, unseen_years, order_idr, summary["yearUp"], summary["perYear"], summary["dip"], real)
    curve = grow(previous.get("curve") if previous.get("scoreVersion") == SCORE_VERSION else [], now_ms, score["total"])
    summary["score"] = score
    summary["curve"] = [{"at": point.get("at", 0), "score": point["score"]} for point in curve[-CURVE_SENT:]]
    return {
        "version": 1,
        "scoreVersion": SCORE_VERSION,
        "curve": curve,
        "summary": summary,
        "watched": {"rules": list(challenger), "since": since} if challenger != LIVE else None,
        "windows": [{**window, "live": round(window["live"]), "picked": round(window["picked"])} for window in windows],
        "measured": measured,
    }


def words(summary: dict) -> list:
    """The study in plain lines, for the console."""
    unseen, cost = summary["unseen"], summary["cost"]
    lines = [
        f"Replayed {summary['candles']} candles: {summary['trades']} trades, {summary['wins']} of 100 won, about {bridge.signed_rp(summary['perYear'])} a year at {bridge.rp(summary['order'])} per buy, deepest dip {bridge.signed_rp(summary['dip'])}.",
        f"A year ended with a gain in {summary['yearUp']} of 100 starts, a month in {summary['monthUp']} of 100.",
        f"Unseen half years: the rules gained in {unseen['up']} of {unseen['windows']} ({bridge.signed_rp(unseen['live'])} in all). Picking the best of the past each time gave {bridge.signed_rp(unseen['picked'])}.",
        f"Cost of a buy and a sale: {cost['measured']}% measured on {cost['trades']} real trades." if cost["measured"] is not None else f"Cost of a buy and a sale: {cost['assumed']}% assumed. No real trade to measure it on yet.",
    ]
    challenger = summary["challenger"]
    if challenger:
        lines.append(f"Watching another version ({challenger['rules']}) for {challenger['days']} days: {challenger['trades']} trades, {bridge.signed_rp(challenger['lead'])} against the rules that trade.")
    for idea in summary.get("ideas") or []:
        lines.append(
            f"On paper only, {idea['name']}: {idea['trades']} trades, {idea['wins']} of 100 won, about {bridge.signed_rp(idea['perYear'])} a year, deepest dip {bridge.signed_rp(idea['dip'])}, "
            f"unseen half years {bridge.signed_rp(idea['unseen'])}."
        )
    hold = summary.get("hold")
    if hold:
        lines.append(f"Yardstick, one buy of {bridge.rp(summary['order'])} at the start and never sold: about {bridge.signed_rp(hold['perYear'])} a year, deepest dip {bridge.signed_rp(hold['dip'])}.")
    score = summary.get("score")
    if score:
        parts = score["parts"]
        lines.append(
            f"Score: {score['total']:g} of 10 (unseen prices {parts['unseen']:g} of 3, steady years {parts['steady']:g} of 2, dips {parts['dips']:g} of 2, real money {parts['real']:g} of 3). "
            f"{len(summary.get('curve') or [])} {'day' if len(summary.get('curve') or []) == 1 else 'days'} on the curve."
        )
    lines.append({"keep": "Verdict: keep the rules.", "watch": "Verdict: keep the rules, and keep watching the other version on paper.", "review": "Verdict: the other version has earned a review. Nothing changes by itself."}[summary["verdict"]])
    return lines


# ---------------------------------------------------------------- prices


def reader(proxy: str = ""):
    handlers = [urllib.request.ProxyHandler({"https": proxy})] if proxy else []
    opener = urllib.request.build_opener(*handlers)

    def read(url: str):
        last = None
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with opener.open(request, timeout=30) as answer:
                    return json.loads(answer.read().decode("utf-8"))
            except Exception as error:  # noqa: BLE001 (an office proxy drops a call now and then)
                last = error
                time.sleep(2 + 3 * attempt)
        raise last

    return read


def binance_candles(read, start: int, end: int) -> list:
    rows = read(f"https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=4h&limit={CHUNK}&startTime={start}&endTime={end - 1}")
    return [{"t": int(row[0]), "o": float(row[1]), "h": float(row[2]), "l": float(row[3]), "c": float(row[4])} for row in rows]


def indodax_candles(read, start: int, end: int, minutes: int = 240, depth: int = 0) -> list:
    """Indodax answers with the newest candles of the span when it holds more than it will give
    in one call, so whatever is missing at the front is asked for again."""
    rows = read(f"https://indodax.com/tradingview/history_v2?from={start // 1000}&to={end // 1000}&tf={minutes}&symbol=BTCIDR")
    rows = sorted(
        ({"t": int(row["Time"]) * 1000, "o": float(row["Open"]), "h": float(row["High"]), "l": float(row["Low"]), "c": float(row["Close"])} for row in rows),
        key=lambda row: row["t"],
    )
    step = minutes * 60 * 1000
    if rows and depth < 4 and rows[0]["t"] - start > step and len(rows) >= 100:
        rows = indodax_candles(read, start, rows[0]["t"], minutes, depth + 1) + rows
    return rows


def refresh(saved: dict, read, now_ms: int) -> dict:
    """Bring the saved candles up to now. The newest saved candles are read again, because the
    last one was still forming when it was saved."""
    fresh = {}
    for source, fetch in (("binance", binance_candles), ("indodax", indodax_candles)):
        rows = {row["t"]: row for row in saved.get(source) or []}
        start = max(CANDLES_FROM, max(rows) - 5 * FOUR_HOURS) if rows else CANDLES_FROM
        while start < now_ms:
            end = min(start + CHUNK * FOUR_HOURS, now_ms)
            for row in fetch(read, start, end):
                rows[row["t"]] = row
            start = end
        fresh[source] = [rows[moment] for moment in sorted(rows)]
    return fresh


def closed_only(rows: list, now_ms: int) -> list:
    return [row for row in rows if row["t"] + FOUR_HOURS <= now_ms]


def measure(closed: list, measured: dict, read) -> dict:
    """Compare each finished real trade with Indodax's price in the minute it was bought and the
    minute it was sold. cost in percent: how much worse than that price, fee included."""
    out = dict(measured)
    for entry in closed:
        if not (isinstance(entry, dict) and entry.get("real") and entry.get("how") == "sold" and not entry.get("estimated")):
            continue
        key = str(int(bridge.number(entry.get("at"))))
        quantity, spent, received = bridge.number(entry.get("quantity")), bridge.number(entry.get("spent")), bridge.number(entry.get("received"))
        bought_at = int(bridge.number(entry.get("boughtAt")))
        if key in out or not str(entry.get("symbol", "")).upper().startswith("BTC") or quantity <= 0 or spent <= 0 or bought_at <= 0:
            continue
        try:
            marks = []
            for moment in (bought_at, int(key)):
                minute = moment - moment % 60000
                rows = [row for row in indodax_candles(read, minute - 5 * 60000, minute + 60000, minutes=1) if row["t"] <= minute]
                marks.append(rows[-1]["o"])
        except Exception:  # noqa: BLE001 (tried again on the next run)
            continue
        out[key] = {"buy": round((spent / quantity / marks[0] - 1) * 100, 3), "sell": round((1 - received / quantity / marks[1]) * 100, 3)}
    return out


# ---------------------------------------------------------------- running it


def load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write(path: Path, data: dict) -> None:
    draft = path.with_name(path.name + ".tmp")
    draft.write_text(json.dumps(data), encoding="utf-8")
    draft.replace(path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="TradeBot's study of its own rules. It never orders.")
    parser.add_argument("--offline", action="store_true", help="use the saved candles: read nothing from the network")
    parser.add_argument("--env", default=str(HERE / ".env"), help="the sender's settings file (default: .env next to this script)")
    parser.add_argument("--state", default=str(HERE / "bridge_state.json"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    try:
        settings = bridge.reachable(bridge.load_settings(args.env))
    except bridge.SettingsError as error:
        print(f"Settings: {error}")
        return 2
    folder = Path(args.state).resolve().parent
    candles_path, result_path = folder / "learn_candles.json", folder / "learn.json"
    now_ms = int(time.time() * 1000)
    read = reader(settings.proxy)
    previous = load(result_path)
    measured = previous.get("measured") if isinstance(previous.get("measured"), dict) else {}

    candles = load(candles_path)
    closed = load(Path(args.state)).get("closed") or []
    if not args.offline:
        try:
            candles = refresh(candles, read, now_ms)
            write(candles_path, candles)
            measured = measure(closed, measured, read)
        except Exception as error:  # noqa: BLE001 (the next run tries again)
            print(f"The prices could not be read ({type(error).__name__}). Nothing was studied.")
            return 1
    signal_rows, price_rows = closed_only(candles.get("binance") or [], now_ms), closed_only(candles.get("indodax") or [], now_ms)
    if len(signal_rows) < 1000 or len(price_rows) < 1000:
        print("Too few candles are saved to study. Run it once without --offline.")
        return 1

    result = study(signal_rows, price_rows, settings.order_idr, settings.stop_percent, now_ms, previous, measured, real_trades(closed))
    write(result_path, result)
    for line in words(result["summary"]):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
