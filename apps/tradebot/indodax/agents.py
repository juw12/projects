"""TradeBot's desk as six agents: who looks at what before a rupiah moves.

Six roles of ONE rule-based bot. None of them is an AI and none of them guesses: each reads
numbers that are measured (prices, the sender's report, the study) and says in plain words
what it found and what it hands on.

  research analyst   the study of the rules (learn.py): score, verdict, ideas followed on paper
  market analyst     the chart, top-down: day, 4 hours, 1 hour, 15 minutes (EMA, SMA, RSI)
  strategist         the buy checks of the rules, and the plan: entry, stop, the 1:3 mark
  risk manager       may a buy happen at all: key, safety stop, pause, free rupiah, open copies
  execution trader   the sender: is it running, what it holds, what it bought and sold
  desk lead          the one call that follows from the five, and what happens next

Everything here only reads and explains. It has no code that orders, and it changes no rule:
orders are made by bridge.py alone, from the rules in TradeBot's strategy. The window (desk.py)
draws what these functions return.

The chart is Indodax's own rupiah price. The buy checks of the rules are made by TradeBot on
the world price (BTC/USDT, 4-hour candles). The two move together, not to the rupiah.

Standard library only.
"""

from __future__ import annotations

import json
import math
import time
import urllib.request
from pathlib import Path

import bridge
import learn

# The charts, widest first: this is the order a top-down look takes.
TIMEFRAMES = [
    {"key": "1D", "tf": "1D", "seconds": 86400, "name": "Day", "role": "big picture"},
    {"key": "4H", "tf": "240", "seconds": 14400, "name": "4 hours", "role": "setup"},
    {"key": "1H", "tf": "60", "seconds": 3600, "name": "1 hour", "role": "timing"},
    {"key": "15m", "tf": "15", "seconds": 900, "name": "15 minutes", "role": "timing"},
]
FRAME = {frame["key"]: frame for frame in TIMEFRAMES}
CANDLES = 320  # read per chart: the 200-candle averages need 200 before their first value
FAST, SLOW, LONG = 20, 50, 200  # the averages of the rules that trade (learn.LIVE)
RSI_FROM, RSI_TO = 50, 70
STOP_ATR = 3.0  # the rules' stop: this many ATR under the price
REWARD = 3.0  # the 1:3 mark: this many times the risk above the entry
RANGE_CANDLES = 20
WIB = 7 * 3600
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()

ROLES = [
    ("research", "Research analyst", "RA", "Studies the rules on six years of prices and follows new ideas on paper."),
    ("market", "Market analyst", "MA", "Reads the chart top-down: day, 4 hours, 1 hour, 15 minutes."),
    ("strategy", "Strategist", "ST", "Runs the buy checks of the rules and draws the plan: entry, stop, 1:3 mark."),
    ("risk", "Risk manager", "RM", "Says whether a buy may happen at all, and how much one buy can lose."),
    ("execution", "Execution trader", "ET", "The sender: places the orders at Indodax and keeps the record."),
    ("lead", "Desk lead", "DL", "Makes the one call that follows from the other five."),
]
HANDS = {
    "research": "Hands the strategist the rules to use. They are changed by hand only, after a review.",
    "market": "Hands the strategist the picture of the market.",
    "strategy": "Hands the risk manager a plan: buy, hold, sell or wait.",
    "risk": "Hands the execution trader a yes or a no.",
    "execution": "Hands the desk lead what was really done at Indodax.",
    "lead": "Tells you: here, in Telegram and on the phone page.",
}
NOT_AI = "Six roles of one rule-based bot. No AI and no guessing: every line is a measured number."


# ---------------------------------------------------------------- words and numbers


def coin_of(symbol) -> str:
    return str(symbol or "").upper().replace("USDT", "").replace("_IDR", "").replace("IDR", "")


def comma(value, digits: int = 1) -> str:
    """1.5 -> '1,5' (the way TradeBot writes numbers)."""
    return f"{bridge.number(value):.{digits}f}".replace(".", ",")


def pct(value, digits: int = 1) -> str:
    return comma(value, digits) + "%"


def signed(value, digits: int = 1) -> str:
    value = bridge.number(value)
    return ("+" if value >= 0 else "−") + comma(abs(value), digits)


def signed_pct(value, digits: int = 1) -> str:
    return signed(value, digits) + "%"


def clock(ms, day: bool = True) -> str:
    """A moment as '17 Nov 12:54' (WIB), or '12:54' without the day."""
    ms = bridge.number(ms)
    if ms <= 0:
        return ""
    moment = time.gmtime(ms / 1000 + WIB)
    hour = f"{moment.tm_hour:02d}:{moment.tm_min:02d}"
    return f"{moment.tm_mday} {MONTHS[moment.tm_mon - 1]} {hour}" if day else hour


def ago(seconds) -> str:
    seconds = max(0, int(bridge.number(seconds)))
    if seconds < 90:
        return "moments ago"
    if seconds < 5400:
        return f"{round(seconds / 60)} minutes ago"
    if seconds < 172800:
        return f"{round(seconds / 3600)} hours ago"
    return f"{round(seconds / 86400)} days ago"


def price_text(value, top=None) -> str:
    """A price short enough for a chart: '1.214,7 jt' (jt = million rupiah) or '3.150'."""
    value = bridge.number(value)
    top = abs(bridge.number(top)) if top else abs(value)

    def swap(text):
        return text.replace(",", "x").replace(".", ",").replace("x", ".")

    if top >= 1e9:
        return swap(f"{value / 1e6:,.1f}") + " jt"
    if top >= 1e7:
        return swap(f"{value / 1e6:,.2f}") + " jt"
    if top >= 1000:
        return swap(f"{value:,.0f}")
    return swap(f"{value:,.2f}")


# ---------------------------------------------------------------- candles


def sma(values: list, period: int) -> list:
    """The plain average of the last `period` values (None until there are that many)."""
    out = [None] * len(values)
    if period <= 0 or len(values) < period:
        return out
    total = sum(values[:period])
    out[period - 1] = total / period
    for index in range(period, len(values)):
        total += values[index] - values[index - period]
        out[index] = total / period
    return out


def candle_url(coin: str, key: str, now_ms, count: int = CANDLES) -> str:
    frame = FRAME[key]
    end = int(bridge.number(now_ms) // 1000) + 60
    return f"https://indodax.com/tradingview/history_v2?from={end - (count + 2) * frame['seconds']}&to={end}&tf={frame['tf']}&symbol={coin_of(coin)}IDR"


def parse_candles(rows) -> list:
    """Indodax's answer as [{t (ms), o, h, l, c, v}], oldest first. Broken rows are left out."""
    found = {}
    for row in rows if isinstance(rows, list) else []:
        try:
            candle = {"t": int(row["Time"]) * 1000, "o": float(row["Open"]), "h": float(row["High"]), "l": float(row["Low"]), "c": float(row["Close"]), "v": float(row.get("Volume") or 0)}
        except (KeyError, TypeError, ValueError):
            continue
        if min(candle["o"], candle["h"], candle["l"], candle["c"]) > 0 and all(math.isfinite(candle[name]) for name in "ohlc"):
            found[candle["t"]] = candle
    return [found[moment] for moment in sorted(found)]


def reader(proxy: str = "", timeout: int = 15):
    """One try, no waiting: the window asks again a minute later anyway."""
    handlers = [urllib.request.ProxyHandler({"https": proxy})] if proxy else []
    opener = urllib.request.build_opener(*handlers)

    def read(url: str):
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with opener.open(request, timeout=timeout) as answer:
            return json.loads(answer.read().decode("utf-8"))

    return read


def fetch_candles(read, coin: str, now_ms, keys=None) -> dict:
    """{timeframe: candles} for one coin. A chart that could not be read is simply missing."""
    found = {}
    for frame in TIMEFRAMES:
        if keys and frame["key"] not in keys:
            continue
        try:
            rows = parse_candles(read(candle_url(coin, frame["key"], now_ms)))
        except Exception:  # noqa: BLE001 (an office proxy drops a call now and then; the next minute asks again)
            continue
        if rows:
            found[frame["key"]] = rows[-CANDLES:]
    return found


def demo_candles(key: str, now_ms, last: float = 1_214_700_000, count: int = CANDLES) -> list:
    """Made-up candles for --demo: the same every time, ending at `last`. No network."""
    frame = FRAME[key]
    step = frame["seconds"] * 1000
    swing = {"1D": 0.016, "4H": 0.007, "1H": 0.0035, "15m": 0.0018}[key]
    lean = {"1D": 0.5, "4H": 0.3, "1H": -0.5, "15m": -1.1}[key]  # the short charts end in a small dip
    state = sum(ord(letter) for letter in key) * 7919 + 17

    def roll() -> float:
        nonlocal state
        state = (state * 1103515245 + 12345) % 2147483648
        return state / 2147483648 - 0.5

    closes, value = [], 1.0
    for index in range(count):
        back = count - 1 - index
        wave = math.sin(back / 23.0 + lean) * 0.35 + math.sin(back / 7.0 + lean) * 0.2
        value *= 1 + swing * (0.07 + wave * 0.5 + roll() * 1.5)
        closes.append(value)
    scale = last / closes[-1]
    end = int(bridge.number(now_ms) // step) * step
    rows, before = [], closes[0] * scale * (1 - swing / 2)
    for index, close in enumerate(closes):
        close *= scale
        high = max(before, close) * (1 + swing * (0.25 + abs(roll())))
        low = min(before, close) * (1 - swing * (0.25 + abs(roll())))
        rows.append({"t": end - (count - 1 - index) * step, "o": before, "h": high, "l": low, "c": close, "v": 0.0})
        before = close
    return rows


# ---------------------------------------------------------------- the technical reading


def indicators(rows: list) -> dict:
    """Every line the chart draws, one value per candle (None where there are too few candles)."""
    closes = [row["c"] for row in rows]
    return {
        "ema20": learn.ema(closes, FAST),
        "ema50": learn.ema(closes, SLOW),
        "ema200": learn.ema(closes, LONG),
        "sma200": sma(closes, LONG),
        "rsi": learn.rsi(closes, learn.RSI_PERIOD),
        "atr": learn.atr(rows, learn.ATR_PERIOD),
    }


def rsi_words(value) -> str:
    if value is None:
        return "not enough candles"
    if value >= RSI_TO:
        return "overheated: above 70"
    if value >= RSI_FROM:
        return "rising, not overheated"
    if value > 30:
        return "weak: under 50"
    return "sold hard: under 30"


def reading(rows: list, key: str = "") -> dict:
    """What one chart says now, with the candle that is still running counted in.

    {key, bias: up / down / mixed / none, price, ema20, ema50, ema200, sma200, rsi, atr,
     trend, momentum, low, high, text}
    """
    empty = {"key": key, "bias": "none", "price": 0.0, "text": "no candles yet"}
    if not rows or len(rows) < SLOW + 1:
        return empty
    lines = indicators(rows)
    price = rows[-1]["c"]
    fast, slow, long_average, plain = lines["ema20"][-1], lines["ema50"][-1], lines["ema200"][-1], lines["sma200"][-1]
    strength, spread = lines["rsi"][-1], lines["atr"][-1]
    momentum = fast > slow
    trend = None if long_average is None else price > long_average
    above = trend if trend is not None else price > slow
    bias = "up" if momentum and above else "down" if not momentum and not above else "mixed"
    recent = rows[-RANGE_CANDLES:]
    parts = [
        ("price above" if above else "price under") + (" the 200 average" if trend is not None else " the 50 average"),
        "20 above 50" if momentum else "20 under 50",
        f"RSI {round(strength)}" if strength is not None else "",
    ]
    return {
        "key": key, "bias": bias, "price": price, "ema20": fast, "ema50": slow, "ema200": long_average, "sma200": plain,
        "rsi": strength, "atr": spread, "trend": trend, "momentum": momentum,
        "low": min(row["l"] for row in recent), "high": max(row["h"] for row in recent),
        "text": ", ".join(part for part in parts if part),
    }


BIAS_WORDS = {"up": "up", "down": "down", "mixed": "mixed", "none": "no candles"}
BIAS_MARKS = {"up": "↑", "down": "↓", "mixed": "→", "none": "·"}


def caption(found: dict) -> str:
    """One line under the chart: what the chart shown says."""
    if not found or found.get("bias") == "none":
        return "No candles for this chart yet. It is read again within a minute."
    price = found["price"]
    parts = [f"{found['key']}: {BIAS_WORDS[found['bias']]}"]
    if found.get("ema200"):
        away = (price / found["ema200"] - 1) * 100
        parts.append(f"price {pct(abs(away))} {'above' if away >= 0 else 'under'} EMA 200")
    parts.append(f"EMA 20 {'above' if found['momentum'] else 'under'} EMA 50")
    if found.get("rsi") is not None:
        parts.append(f"RSI {round(found['rsi'])} ({rsi_words(found['rsi'])})")
    if found.get("atr") and price > 0:
        parts.append(f"one candle moves about {pct(found['atr'] / price * 100, 2)}")
    return " · ".join(parts)


def analysis(found: dict) -> list:
    """The technical reading of one chart, in plain sentences."""
    if not found or found.get("bias") == "none":
        return ["No candles for this chart yet. It is read again within a minute."]
    price, top = found["price"], found["price"]
    lines = []
    if found.get("ema200"):
        away = (price / found["ema200"] - 1) * 100
        lines.append(f"Trend: price {price_text(price, top)} is {pct(abs(away))} {'above' if away >= 0 else 'under'} its 200-candle average (EMA 200), so the long direction is {'up' if away >= 0 else 'down'}.")
    else:
        lines.append("Trend: fewer than 200 candles, so the 200-candle average is not drawn yet.")
    lines.append(f"Momentum: EMA 20 is {'above' if found['momentum'] else 'under'} EMA 50, so it has been {'rising' if found['momentum'] else 'falling'} lately.")
    if found.get("rsi") is not None:
        lines.append(f"RSI {round(found['rsi'])}: {rsi_words(found['rsi'])}. The rules buy only between {RSI_FROM} and {RSI_TO}.")
    if found.get("sma200"):
        lines.append(f"SMA 200 at {price_text(found['sma200'], top)}: price is {'above' if price > found['sma200'] else 'under'} it.")
    swing = f" One candle moves about {pct(found['atr'] / price * 100, 2)} (ATR)." if found.get("atr") and price > 0 else ""
    lines.append(f"Last {RANGE_CANDLES} candles: low {price_text(found['low'], top)}, high {price_text(found['high'], top)}.{swing}")
    return lines


def top_down(readings: dict) -> dict:
    """The four charts as one sentence, widest first. {call: up / wait / down / none, text, marks}"""
    found = {frame["key"]: (readings or {}).get(frame["key"]) or {"bias": "none"} for frame in TIMEFRAMES}
    marks = " · ".join(f"{key} {BIAS_MARKS[found[key]['bias']]}" for key in found)
    big, setup = found["1D"]["bias"], found["4H"]["bias"]
    short = [found["1H"]["bias"], found["15m"]["bias"]]
    if big == "none" or setup == "none":
        return {"call": "none", "text": "The charts could not be read yet.", "marks": marks}
    if big == "up" and setup == "up":
        if "down" in short and "up" not in short:
            return {"call": "wait", "text": "Day and 4 hours point up, but the short charts are falling: a dip inside a rise. Top-down waits for them to turn.", "marks": marks}
        if "up" in short:
            return {"call": "up", "text": "Day, 4 hours and the short charts point up: all in line.", "marks": marks}
        return {"call": "up", "text": "Day and 4 hours point up; the short charts are undecided.", "marks": marks}
    if big == "down" and setup == "down":
        return {"call": "down", "text": "Day and 4 hours point down: top-down stays out.", "marks": marks}
    if big == "down":
        return {"call": "down", "text": "The 4-hour chart is not falling, but the day is: a bounce inside a fall. Top-down stays out.", "marks": marks}
    if big == "up":
        return {"call": "wait", "text": "The day is up but the 4-hour chart is not yet: top-down waits for it to turn up.", "marks": marks}
    return {"call": "wait", "text": "The day is undecided: top-down waits for a clear direction.", "marks": marks}


# ---------------------------------------------------------------- the plan: entry, stop, the 1:3 mark


def plan(entry, spread, stop_percent, order_idr, stop_atr: float = STOP_ATR, reward: float = REWARD):
    """Where a buy at `entry` would be stopped and where three times that risk lies.

    The stop is the nearer of the rules' stop (stop_atr ATR under the entry) and the sender's own
    hard stop (stop_percent under what was paid). None when it cannot be worked out.
    {entry, stop, by: 'atr' or 'hard', target, riskPercent, rewardPercent, riskIdr, rewardIdr, reward}
    """
    entry, spread, stop_percent = bridge.number(entry), bridge.number(spread), bridge.number(stop_percent)
    if entry <= 0:
        return None
    hard = entry * (1 - stop_percent / 100) if 0 < stop_percent < 100 else 0.0
    soft = entry - stop_atr * spread if spread > 0 else 0.0
    stop = max(hard, soft)
    if stop <= 0 or stop >= entry:
        return None
    share = (entry - stop) / entry
    order = bridge.number(order_idr)
    return {
        "entry": entry, "stop": stop, "by": "atr" if soft >= hard else "hard", "target": entry + reward * (entry - stop),
        "riskPercent": share * 100, "rewardPercent": share * 100 * reward, "riskIdr": order * share, "rewardIdr": order * share * reward, "reward": reward,
    }


def held_plan(position: dict, rows_4h: list, stop_percent, now_ms=None):
    """The plan of a coin that is held: the entry is what was paid, the risk is the one it was bought with.

    Adds 'trail': about where the rules' moving stop is now (worked out on Indodax's candles; the
    bot's own uses the world price), and 'reached': how many times the risk the price is up (R).
    """
    entry, opened = bridge.number(position.get("price")), bridge.number(position.get("openedAt"))
    step = FRAME["4H"]["seconds"] * 1000
    rows = rows_4h or []
    ranges = learn.atr(rows, learn.ATR_PERIOD) if rows else []
    before = [index for index, row in enumerate(rows) if row["t"] + step <= opened and ranges[index] is not None]
    made = plan(entry, ranges[before[-1]] if before else 0.0, stop_percent, position.get("spent"))
    if made is None:
        return None
    trail = made["stop"]
    limit = bridge.number(now_ms) if now_ms else float("inf")
    for index in range(before[-1] + 1 if before else len(rows), len(rows)):
        if rows[index]["t"] + step <= limit and ranges[index] is not None:  # finished candles only
            trail = max(trail, rows[index]["c"] - STOP_ATR * ranges[index])
    now = bridge.number(position.get("now")) or (rows[-1]["c"] if rows else entry)
    made["trail"] = trail
    made["reached"] = (now - entry) / (entry - made["stop"])
    return made


# ---------------------------------------------------------------- the mood, the debate, three views on risk
#
# Three ways of working borrowed from the two most starred open-source trading-agent projects
# (TauricResearch/TradingAgents and HKUDS/Vibe-Trading): a sentiment reading, a bull against bear
# debate that ends in a five-step rating, and a risk team of three views. Theirs are written by
# language models. These are worked out from measured numbers, so the same numbers always give
# the same answer. No code of theirs is used.

MOOD_URL = "https://api.alternative.me/fng/?limit=1&format=json"
MOOD_NAMES = [(25, "extreme fear"), (45, "fear"), (56, "neutral"), (76, "greed"), (101, "extreme greed")]
MOOD_OLD = 3 * 86400 * 1000  # the index comes once a day; one older than this is not shown
DEMO_MOOD = {"value": 34, "name": "fear"}


def parse_mood(answer, now_ms=None):
    """alternative.me's Fear and Greed answer as {value: 0..100, name, at (ms)}. None when it is broken or old."""
    try:
        item = answer["data"][0]
        value, at = int(item["value"]), int(item["timestamp"]) * 1000
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    if not 0 <= value <= 100 or (now_ms is not None and bridge.number(now_ms) - at > MOOD_OLD):
        return None
    named = str(item.get("value_classification") or "").strip().lower() if isinstance(item, dict) else ""
    return {"value": value, "name": named or next(name for limit, name in MOOD_NAMES if value < limit), "at": at}


def fetch_mood(read, now_ms=None):
    """The mood of the crypto market now, or None. A public page: no key, and nothing is sent."""
    try:
        return parse_mood(read(MOOD_URL), now_ms)
    except Exception:  # noqa: BLE001 (the mood is only shown: without it the desk works the same)
        return None


def mood_text(mood) -> str:
    if not isinstance(mood, dict) or "value" not in mood:
        return ""
    return (
        f"Mood of the crypto market: {int(mood['value'])} of 100, {mood.get('name') or 'not named'} (Fear and Greed index). "
        "Shown only: on six years of prices, buying by mood did not beat the rules."
    )


WEIGHTS = {"1D": 4, "4H": 3, "1H": 2, "15m": 1}  # top-down: a wider chart counts for more
RATINGS = [("buy", "Buy"), ("lean_buy", "Lean buy"), ("wait", "Wait"), ("lean_out", "Lean away"), ("out", "Stay out")]
RATING_NAMES = dict(RATINGS)
HELD_NAMES = {"buy": "Hold", "lean_buy": "Hold, watch closely", "wait": "Hold, watch closely", "lean_out": "Hold, watch closely", "out": "Sell"}


def debate(readings: dict, signal=None, held: bool = False) -> dict:
    """The case for a buy against the case for staying out, point by point, from the four charts.

    Each chart gives up to three points: price against its 200 average, EMA 20 against EMA 50, and
    RSI inside or outside the rules' 50 to 70. A wider chart counts for more (WEIGHTS).
    {pro: [text], con: [text], share: 0..100 of the weight that is for a buy (None: no chart read),
     rating: one of RATINGS, name, step: 1..5, text}
    The rating never orders: the bot buys and sells by the rules' checks alone.
    """
    pro, con, weight_for, weight_all = [], [], 0, 0
    for frame in TIMEFRAMES:
        found = (readings or {}).get(frame["key"])
        if not found or found.get("bias") == "none":
            continue
        points = []
        if found.get("trend") is not None:
            points.append((found["trend"], f"price {'above' if found['trend'] else 'under'} its 200-candle average"))
        points.append((bool(found.get("momentum")), f"EMA 20 {'above' if found.get('momentum') else 'under'} EMA 50"))
        if found.get("rsi") is not None:
            points.append((RSI_FROM <= found["rsi"] < RSI_TO, f"RSI {round(found['rsi'])}, {rsi_words(found['rsi']).split(':')[0]}"))
        for good, words in points:
            (pro if good else con).append(f"{frame['name']}: {words}")
            weight_all += WEIGHTS[frame["key"]]
            weight_for += WEIGHTS[frame["key"]] if good else 0
    action = str((signal or {}).get("action") or "").upper() if signal and not signal.get("error") else ""
    passes = action in ("BUY", "HOLD")
    if not weight_all:
        return {"pro": [], "con": [], "share": None, "rating": "wait", "name": HELD_NAMES["wait"] if held else RATING_NAMES["wait"], "step": 3, "text": "The charts could not be read yet, so there is nothing to weigh."}
    share = round(100 * weight_for / weight_all)
    if held and action == "SELL":
        rating, text = "out", "A check of the rules failed: the coin is sold at the next check."
    elif passes and share >= 60:
        rating, text = "buy", "The rules' checks pass and most of the charts agree."
    elif passes:
        rating, text = "lean_buy", "The rules' checks pass, but the charts are split. The size of a buy stays small and fixed."
    elif share >= 60:
        rating, text = "lean_buy", "Most of the charts are for a buy, but the rules' checks are not all met: no buy yet."
    elif share > 40:
        rating, text = "wait", "The charts are split and the rules' checks are not met: no buy."
    elif share > 20:
        rating, text = "lean_out", "More speaks against a buy than for it: no buy."
    else:
        rating, text = "out", "Nearly everything speaks against a buy: the money stays in rupiah."
    if held and rating != "out" and not passes:
        text = "The coin is held while the rules' checks for holding still pass; the moving stop guards it."
    return {
        "pro": pro, "con": con, "share": share, "rating": rating,
        "name": (HELD_NAMES if held else RATING_NAMES)[rating], "step": [key for key, _name in RATINGS].index(rating) + 1, "text": text,
    }


def debate_line(found: dict) -> str:
    """The debate in one line, for the desk lead."""
    if not found or found.get("share") is None:
        return "Bull against bear: the charts are not read yet."
    return (
        f"Bull against bear: {len(found['pro'])} {'point' if len(found['pro']) == 1 else 'points'} for a buy, {len(found['con'])} against; "
        f"{found['share']} of 100 by weight are for. Rating: {found['name']} (step {found['step']} of 5). {found['text']}"
    )


RISK_VIEWS = [("Careful", 1.0), ("Balanced", 2.0), ("Bold", 5.0)]  # the most of the account one trade may lose, in percent


def risk_views(report: dict) -> list:
    """Three views on the size of one buy, each with its own limit for the loss of one trade.

    The loss counted is the worst the sender allows: the hard stop under what was paid.
    [{name, limit (percent of the account), share (percent this buy can lose), ok, most (the biggest buy this view allows)}]
    Empty when the account or the size is not known. The views only speak: the size is yours to set.
    """
    report = report or {}
    order, stop, cash = bridge.number(report.get("orderIdr")), bridge.number(report.get("stopPercent")), report.get("cash")
    if not isinstance(cash, (int, float)) or isinstance(cash, bool) or order <= 0 or not 0 < stop < 100:
        return []
    account = cash + sum(bridge.number(item.get("value")) for item in held_now(report))
    if account <= 0:
        return []
    share = order * stop / account
    return [{"name": name, "limit": limit, "share": share, "ok": share <= limit, "most": account * limit / stop} for name, limit in RISK_VIEWS]


# ---------------------------------------------------------------- the six agents


def read_summary(path):
    """The summary of the last study, from learn.json in the sender's folder. None when there is none."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    summary = data.get("summary") if isinstance(data, dict) else None
    return summary if isinstance(summary, dict) else None


def focus_coin(report: dict, view, traded=()) -> str:
    """The coin the desk talks about: the one held, else the first one this PC trades."""
    for item in (report or {}).get("positions") or []:
        return coin_of(item.get("symbol"))
    names = [coin_of(item.get("coin")) for item in (view or {}).get("signals") or []]
    for name in names:
        if not traded or name in traded:
            return name
    return sorted(traded)[0] if traded else "BTC"


def held_now(report: dict) -> list:
    real = (report or {}).get("mode") == "real"
    return [item for item in (report or {}).get("positions") or [] if not real or item.get("real") is not False]


def agent(key: str, state: str, head: str, lines: list) -> dict:
    name, short, role = next((name, short, role) for found, name, short, role in ROLES if found == key)
    return {"key": key, "name": name, "short": short, "role": role, "state": state, "head": head, "lines": lines, "hands": HANDS[key]}


def hold_text(summary: dict, hold: dict) -> str:
    """The rules against the plainest yardstick: one buy of the same size in March 2020, never sold."""
    rules_year, hold_year = bridge.number(summary.get("perYear")), bridge.number(hold.get("perYear"))
    rules_dip, hold_dip = bridge.number(summary.get("dip")), bridge.number(hold.get("dip"))
    start = f"Yardstick, one buy of {bridge.rp(summary.get('order'))} in March 2020 and never sold: about {bridge.signed_rp(hold_year)} a year, deepest dip {bridge.signed_rp(hold_dip)}."
    if hold_year > rules_year and hold_dip < rules_dip:
        times = f", about {round(hold_dip / rules_dip)} times as deep" if rules_dip < 0 else ""
        return f"{start} Just holding earned more than the rules but dipped deeper{times}. The rules give up gain to keep the dips small."
    return f"{start} Just holding earned {'more' if hold_year > rules_year else 'less'} than the rules and dipped {'deeper' if hold_dip < rules_dip else 'less deep'}."


def research_agent(summary, now_ms) -> dict:
    if not isinstance(summary, dict) or not bridge.number(summary.get("at")):
        return agent("research", "off", "No study yet", [("info", "The sender studies its own rules every four hours and after each buy or sale. The first study takes a few minutes.")])
    score = summary.get("score") if isinstance(summary.get("score"), dict) else {}
    unseen = summary.get("unseen") if isinstance(summary.get("unseen"), dict) else {}
    verdict = str(summary.get("verdict") or "keep")
    age = (bridge.number(now_ms) - bridge.number(summary.get("at"))) / 1000
    old = age > 12 * 3600
    lines = [
        ("info", f"Replayed {int(bridge.number(summary.get('trades')))} trades on prices since 2020: {int(bridge.number(summary.get('wins')))} of 100 won, about {bridge.signed_rp(summary.get('perYear'))} a year at {bridge.rp(summary.get('order'))} per buy, deepest dip {bridge.signed_rp(summary.get('dip'))}."),
        ("info", f"On half years the rules had never seen: {bridge.signed_rp(unseen.get('live'))} over {int(bridge.number(unseen.get('windows')))} of them."),
        ("ok" if verdict != "review" else "info", {"keep": "Verdict: keep the rules.", "watch": "Verdict: keep the rules; a second setting is followed on paper.", "review": "Verdict: a second setting has earned a review. Nothing changes by itself."}.get(verdict, "Verdict: keep the rules.")),
    ]
    hold = summary.get("hold") if isinstance(summary.get("hold"), dict) else None
    if hold:
        lines.append(("info", hold_text(summary, hold)))
    ideas = [idea for idea in summary.get("ideas") or [] if isinstance(idea, dict)]
    if ideas:
        lines.append(("info", "Ideas followed on paper only (pretend trades, no money):"))
    for idea in ideas:
        since = idea.get("since") if isinstance(idea.get("since"), dict) else {}
        deeper = bridge.number(idea.get("dip")) < bridge.number(summary.get("dip"))
        lines.append((
            "info",
            f"{str(idea.get('name') or '').capitalize()}: {int(bridge.number(idea.get('trades')))} trades, {int(bridge.number(idea.get('wins')))} of 100 won, about {bridge.signed_rp(idea.get('perYear'))} a year, "
            f"deepest dip {bridge.signed_rp(idea.get('dip'))} ({'deeper than' if deeper else 'not deeper than'} the rules'). "
            f"Since {clock(since.get('from')).rsplit(' ', 1)[0]}: {int(bridge.number(since.get('trades')))} pretend {'trade' if int(bridge.number(since.get('trades'))) == 1 else 'trades'}, {bridge.signed_rp(since.get('lead'))} against the rules.",
        ))
    if ideas:
        lines.append(("info", "An idea changes the real rules only by hand, after 90 days and 8 pretend trades ahead, and never with a deeper dip."))
    lines.append(("no" if old else "info", f"Last study {ago(age)}." + (" That is old: the PC was off or the prices could not be read." if old else "")))
    lines.append(("info", "A past result is not a promise."))
    total = comma(score.get("total")) if score else "?"
    return agent("research", "warn" if old else "yes", f"Score {total} of 10 · {'review due' if verdict == 'review' else 'keep the rules'}", lines)


def market_agent(readings: dict, report: dict, signal, coin: str, mood=None) -> dict:
    look = top_down(readings)
    lines = []
    for frame in TIMEFRAMES:
        found = (readings or {}).get(frame["key"])
        if not found or found.get("bias") == "none":
            lines.append(("info", f"{frame['name']} ({frame['role']}): not read yet."))
            continue
        lines.append(("ok" if found["bias"] == "up" else "no" if found["bias"] == "down" else "info", f"{frame['name']} ({frame['role']}): {BIAS_WORDS[found['bias']]}. {found['text'][:1].upper() + found['text'][1:]}."))
    lines.append(("info", "Top-down: " + look["text"]))
    for item in (report or {}).get("market") or []:
        if coin_of(item.get("coin")) == coin:
            bid, ask = bridge.number(item.get("bid")), bridge.number(item.get("ask"))
            if ask > 0:
                lines.append(("info", f"At Indodax now: {bridge.rp(ask)} to buy 1 {coin}, {bridge.rp(bid)} when selling. Gap {pct((ask - bid) / ask * 100, 2)}."))
    change = (signal or {}).get("change24h")
    if isinstance(change, (int, float)):
        lines.append(("info", f"World price in 24 hours: {signed_pct(change)}."))
    if mood_text(mood):
        lines.append(("info", mood_text(mood)))
    state = {"up": "yes", "down": "no", "wait": "wait", "none": "off"}[look["call"]]
    head = f"{coin} · {look['marks']}" if look["call"] != "none" else "Charts not read yet"
    return agent("market", state, head, lines)


ACTION_HEADS = {"BUY": "BUY: all checks pass", "HOLD": "HOLD: checks still pass", "SELL": "SELL: a check failed", "WAIT": "WAIT: checks not met"}


def strategy_agent(signal, readings: dict, report: dict, coin: str, now_ms, rows_4h=None) -> tuple:
    """(the agent, the plan it drew or None)."""
    report = report or {}
    held = [item for item in held_now(report) if coin_of(item.get("symbol")) == coin]
    four = (readings or {}).get("4H") or {}
    if held:
        rows_plan = held_plan(held[0], rows_4h, report.get("stopPercent"), now_ms)
    else:
        ask = next((bridge.number(item.get("ask")) for item in report.get("market") or [] if coin_of(item.get("coin")) == coin), 0.0)
        rows_plan = plan(ask or four.get("price"), four.get("atr"), report.get("stopPercent"), report.get("orderIdr"))
    lines = []
    if not signal or signal.get("error"):
        action = "?"
        lines.append(("info", "No fresh signal from TradeBot's server. The sender still works from its own copy; the checks show again at the next look."))
    else:
        action = str(signal.get("action") or "WAIT").upper()
        for check in signal.get("checks") or []:
            lines.append(("ok" if check.get("ok") else "no", f"{check.get('name')}: {check.get('text')}"))
        if signal.get("why"):
            lines.append(("info", "→ " + str(signal["why"])))
    look = top_down(readings)
    if look["call"] != "none":
        lines.append(("info", f"Top-down ({look['marks']}): {'in line with a buy' if look['call'] == 'up' else 'not in line with a buy'}. The rules do not ask for it; it is followed on paper."))
    if rows_plan:
        if held:
            lines.append(("info", f"Plan of the coin held: paid {bridge.rp(rows_plan['entry'])} a coin, first stop {bridge.rp(rows_plan['stop'])} (risk {pct(rows_plan['riskPercent'])}), 1:3 mark {bridge.rp(rows_plan['target'])}."))
            lines.append(("info", f"Now at {signed(rows_plan['reached'], 2)} R (1 R = the risk it was bought with). The moving stop is about {bridge.rp(rows_plan['trail'])}."))
        else:
            lines.append(("info", f"If bought now: entry {bridge.rp(rows_plan['entry'])}, stop {bridge.rp(rows_plan['stop'])} ({'3 ATR' if rows_plan['by'] == 'atr' else 'the hard stop'}, risk {pct(rows_plan['riskPercent'])} = about {bridge.rp(rows_plan['riskIdr'])}), 1:3 mark {bridge.rp(rows_plan['target'])} (about {bridge.signed_rp(rows_plan['rewardIdr'])})."))
        lines.append(("info", "The bot does not sell at the 1:3 mark by itself: it moves the stop up behind the price and lets a winner run. Selling at 1:3 is followed on paper."))
    lines.append(("info", "The checks use the world price (4-hour candles); the chart is Indodax's rupiah price."))
    state = {"BUY": "yes", "HOLD": "yes", "SELL": "no", "WAIT": "wait"}.get(action, "off")
    return agent("strategy", state, f"{coin} · {ACTION_HEADS.get(action, 'no fresh signal')}", lines), rows_plan


def risk_agent(report: dict, view, drawn) -> dict:
    report = report or {}
    if not report:
        return agent("risk", "off", "No report yet", [("info", "The sender has not reported yet. It does within a minute of starting.")])
    real = report.get("mode") == "real"
    order, most, stop = bridge.number(report.get("orderIdr")), int(bridge.number(report.get("maxOpen"))), bridge.number(report.get("stopPercent"))
    held = held_now(report)
    cash = report.get("cash")
    tripped, paused = bool(report.get("tripped")), bool((view or {}).get("paused") or report.get("paused"))
    checked = bool(report.get("checked")) or not real
    full = most > 0 and len(held) >= most
    short = isinstance(cash, (int, float)) and order > 0 and cash < order
    lines = [
        ("ok" if checked else "no", ("Real money: the API key passed its check on this PC." if checked else "Real mode is on, but the API key has not passed its check: nothing is bought.") if real else "Practice mode: no real rupiah can move."),
        ("no" if tripped else "ok", "Safety stop is ON: " + str(report.get("trippedWhy") or "look at Indodax first.") if tripped else "Safety stop is off."),
        ("no" if paused else "ok", "Buying is paused by you. Coins held are still sold when the rules say so." if paused else "Buying is allowed."),
        ("info" if full else "ok", f"{len(held)} of {most} open: " + ("no second buy until it is sold." if full else "room for a buy.")),
    ]
    if isinstance(cash, (int, float)) and order > 0:
        lines.append(("no" if short and not held else "ok" if not short else "info", f"Free rupiah {bridge.rp(cash)}: " + (f"less than one buy of {bridge.rp(order)}." if short else f"enough for {int(cash // order)} more {'buy' if int(cash // order) == 1 else 'buys'} of {bridge.rp(order)}.")))
    worst = order * stop / 100
    lines.append(("info", f"One buy of {bridge.rp(order)} can lose about {bridge.rp(worst)} at the hard stop ({stop:g}% under what was paid), plus fees."))
    if drawn and drawn.get("riskIdr") and drawn["riskIdr"] < worst * 0.98:
        lines.append(("info", f"The plan's own stop is nearer: about {bridge.rp(drawn['riskIdr'])} at risk, to reach for about {bridge.rp(drawn['rewardIdr'])} at the 1:3 mark."))
    lines.append(("info", f"Money in play at most: {bridge.rp(order * max(most, 1))}. The size of a buy never grows by itself."))
    views = risk_views(report)
    if views:
        lines.append(("info", f"Three views on the size: one buy can lose {pct(views[0]['share'])} of the account at the hard stop."))
        for found in views:
            lines.append((
                "ok" if found["ok"] else "info",
                f"{found['name']} view (lose at most {found['limit']:g}% of the account in one trade): " + ("fine." if found["ok"] else f"too big; it would buy at most {bridge.rp(found['most'])}."),
            ))
        lines.append(("info", "The views only speak. The size is set by you in the settings and is not changed here."))
    if tripped:
        return agent("risk", "no", "Blocked: safety stop is on", lines)
    if not checked:
        return agent("risk", "no", "Blocked: key not checked", lines)
    if paused:
        return agent("risk", "warn", "Paused: no new buys", lines)
    if full:
        return agent("risk", "wait", f"At the limit: {len(held)} of {most} open", lines)
    if short:
        return agent("risk", "warn", "Not enough rupiah for a buy", lines)
    return agent("risk", "yes", f"Clear: one buy of {bridge.rp(order)} allowed", lines)


def last_order(report: dict):
    """(moment, words) of the newest buy or sale in the report, or None."""
    found = []
    for item in (report or {}).get("positions") or []:
        found.append((bridge.number(item.get("openedAt")), f"bought {coin_of(item.get('symbol'))} for {bridge.rp(item.get('spent'))}"))
    for item in (report or {}).get("closed") or []:
        if item.get("how") == "sold":
            found.append((bridge.number(item.get("at")), f"sold {coin_of(item.get('symbol'))} for {bridge.rp(item.get('received'))} ({bridge.signed_rp(bridge.number(item.get('received')) - bridge.number(item.get('spent')))})"))
    return max(found) if found else None


def execution_agent(report: dict, sender_state: str, cycle_age, misses: int = 0) -> dict:
    report = report or {}
    held = held_now(report)
    running = sender_state in ("here", "outside")
    stale = running and cycle_age is not None and cycle_age > 150
    lines = [(
        "ok" if running else "no",
        {"here": "The sender is running inside this window.", "outside": "A sender is running in another window.", "waiting": "The sender starts by itself within three minutes.", "stopped": "The sender is stopped: nothing is bought or sold, and a falling price is not acted on."}.get(sender_state, "The sender's state is not known."),
    )]
    if cycle_age is not None:
        lines.append(("no" if stale else "ok" if running else "info", f"Last finished cycle {ago(cycle_age)}." + (" It may be waiting for the network." if stale else "")))
    for item in held:
        spent, worth = bridge.number(item.get("spent")), bridge.number(item.get("value"))
        lines.append(("info", f"Holding {coin_of(item.get('symbol'))} since {clock(item.get('openedAt'))}: paid {bridge.rp(spent)}, worth {bridge.rp(worth)} now ({bridge.signed_rp(worth - spent)})."))
    if not held:
        lines.append(("info", "Holding no coin: all the money is in rupiah."))
    newest = last_order(report)
    lines.append(("info", f"Last order: {newest[1]}, {clock(newest[0])} WIB." if newest else "No order has been placed yet."))
    if misses:
        lines.append(("info", f"{misses} network {'miss' if misses == 1 else 'misses'} since this window opened. A missed cycle is tried again a minute later."))
    lines.append(("info", "Orders are placed by the sender only, at Indodax, at the market price. This window cannot order."))
    if sender_state == "stopped":
        return agent("execution", "no", "Sender is stopped: no orders", lines)
    if sender_state == "waiting":
        return agent("execution", "warn", "Sender starts in a moment", lines)
    if stale:
        return agent("execution", "warn", "Quiet: waiting for the network", lines)
    if held:
        spent, worth = sum(bridge.number(item.get("spent")) for item in held), sum(bridge.number(item.get("value")) for item in held)
        return agent("execution", "yes", f"Holding {', '.join(coin_of(item.get('symbol')) for item in held)} · {bridge.signed_rp(worth - spent)}", lines)
    return agent("execution", "wait", "Standing by: no order to place", lines)


def lead_agent(team: list, report: dict, view, coin: str, weighed=None) -> dict:
    by = {member["key"]: member for member in team}
    report = report or {}
    held = [item for item in held_now(report) if coin_of(item.get("symbol")) == coin]
    action = by["strategy"]["head"].split("· ", 1)[-1].split(":")[0]
    if by["execution"]["state"] == "no":
        state, head = "no", "Stopped: start the sender"
    elif by["risk"]["state"] == "no":
        state, head = "no", by["risk"]["head"]
    elif held and action == "SELL":
        state, head = "no", f"Sell {coin} at the next check"
    elif held:
        state, head = "yes", f"Hold {coin}: let it run"
    elif action == "BUY" and by["risk"]["state"] == "yes":
        state, head = "yes", f"Buy {coin} at the next check"
    elif action == "BUY":
        state, head = "warn", "Signal says buy, risk says no"
    elif action in ("WAIT", "SELL", "HOLD"):
        state, head = "wait", "Wait: no buy now"
    else:
        state, head = "off", "Wait: no fresh signal"
    lines = [({"yes": "ok", "no": "no"}.get(member["state"], "info"), f"{member['name']}: {member['head']}") for member in team]
    if weighed:
        lines.append(("info", debate_line(weighed)))
        lines.append(("info", "The rating sums up the charts. The bot buys and sells by the rules' checks alone."))
    following = next((line[6:] for line in str((view or {}).get("text") or "").split("\n") if line.startswith("Next: ")), "")
    if following:
        lines.append(("info", "Next: " + following))
    kind = "real" if report.get("mode") == "real" else "practice"
    if report:
        today = report.get("today") or {}
        lines.append(("info", f"Result so far {bridge.signed_rp((report.get('result') or {}).get(kind))} after fees · today {bridge.signed_rp(today.get(kind))}, {int(bridge.number(today.get('buys')))} {'buy' if int(bridge.number(today.get('buys'))) == 1 else 'buys'}."))
    lines.append(("info", NOT_AI))
    return agent("lead", state, head, lines)


def desk(view, report, readings, summary, sender_state: str, now_ms, traded=(), cycle_age=None, misses: int = 0, coin: str = "", rows_4h=None, mood=None) -> dict:
    """The six agents for what is known now: {coin, team: [agent, ...], plan, debate}.

    agent = {key, name, short, role, state: yes / wait / no / warn / off, head, lines: [(ok / no / info, text)], hands}
    """
    report = report or {}
    coin = coin or focus_coin(report, view, traded)
    signal = next((item for item in (view or {}).get("signals") or [] if coin_of(item.get("coin")) == coin), None)
    strategist, drawn = strategy_agent(signal, readings, report, coin, now_ms, rows_4h)
    team = [
        research_agent(summary, now_ms),
        market_agent(readings, report, signal, coin, mood),
        strategist,
        risk_agent(report, view, drawn),
        execution_agent(report, sender_state, cycle_age, misses),
    ]
    weighed = debate(readings, signal, any(coin_of(item.get("symbol")) == coin for item in held_now(report)))
    team.append(lead_agent(team, report, view, coin, weighed))
    return {"coin": coin, "team": team, "plan": drawn, "debate": weighed}


# ---------------------------------------------------------------- the live feed


def feed_events(before: dict, team: list, now_ms) -> list:
    """What changed since the last look: one line per agent whose call is new.

    before = {key: agent} as last shown (empty the first time: then all six speak).
    """
    found = []
    for member in team:
        old = (before or {}).get(member["key"])
        if old is None or (old.get("state"), old.get("head")) != (member["state"], member["head"]):
            found.append({"at": now_ms, "key": member["key"], "name": member["name"], "state": member["state"], "text": member["head"]})
    return found


def log_event(line: str):
    """A line of the sender's log as (agent, words) for the feed, or None when it is not news."""
    text = str(line or "")
    words = text.split("  ", 1)[1].strip() if "  " in text else text.strip()
    low = words.lower()
    if not words:
        return None
    if "safety stop" in low and "cleared" not in low:
        return ("risk", words)
    if "studying the rules" in low:
        return ("research", "Started a study of the rules on the newest prices.")
    if "the study could not start" in low:
        return ("research", "The study could not start. It is tried again later.")
    if ": bought " in low or ": sold " in low or "was sold already" in low or "went through" in low or "no longer in the indodax account" in low or "was lost, but indodax confirms" in low:
        return ("execution", words)
    if "the sender ended" in low or "sender started" in low or "sender stopped" in low:
        return ("execution", words.replace("[desk] ", "").capitalize())
    if "did not happen" in low:
        return ("execution", words)
    return None


# ---------------------------------------------------------------- trades, position and result


def execution_rows(report: dict, real_only: bool) -> list:
    """Every buy and sale in the report, newest first:
    [{at, when, side: BUY / SELL / CLOSED, coin, amount, price (short: jt = million rupiah), result, tag: up / down / ''}]"""
    rows = []

    def add(at, side, item, amount, price, result="", tag=""):
        name = coin_of(item.get("symbol")) + ("" if item.get("real") is not False else " (practice)")
        rows.append({"at": bridge.number(at), "when": clock(at), "side": side, "coin": name, "amount": amount, "price": price, "result": result, "tag": tag})

    for item in (report or {}).get("positions") or []:
        if real_only and item.get("real") is False:
            continue
        add(item.get("openedAt"), "BUY", item, bridge.rp(item.get("spent")), price_text(item.get("price")) if bridge.number(item.get("price")) > 0 else "", "open")
    for item in (report or {}).get("closed") or []:
        if real_only and item.get("real") is False:
            continue
        spent, received, quantity = bridge.number(item.get("spent")), bridge.number(item.get("received")), bridge.number(item.get("quantity"))
        add(item.get("boughtAt"), "BUY", item, bridge.rp(spent), price_text(spent / quantity) if quantity > 0 else "")
        if item.get("how") == "sold":
            about = "about " if item.get("estimated") else ""
            add(item.get("at"), "SELL", item, about + bridge.rp(received), price_text(received / quantity) if quantity > 0 else "", bridge.signed_rp(received - spent), "up" if received >= spent else "down")
        else:
            add(item.get("at"), "CLOSED", item, "", "", "no result")
    rows.sort(key=lambda row: (row["at"], row["side"] != "BUY"), reverse=True)
    return rows


def result_line(report: dict, real_only: bool) -> str:
    """One sentence: finished trades, how many won, the result, and what is open now."""
    report = report or {}
    sold = [item for item in report.get("closed") or [] if item.get("how") == "sold" and not (real_only and item.get("real") is False)]
    won = sum(1 for item in sold if bridge.number(item.get("received")) > bridge.number(item.get("spent")))
    total = sum(bridge.number(item.get("received")) - bridge.number(item.get("spent")) for item in sold)
    held = held_now(report)
    floating = sum(bridge.number(item.get("value")) - bridge.number(item.get("spent")) for item in held)
    parts = [f"{len(sold)} finished {'trade' if len(sold) == 1 else 'trades'}" + (f", {won} won" if sold else ""), f"result {bridge.signed_rp(total)} after fees"]
    if sold:
        wins = [bridge.number(item.get("received")) - bridge.number(item.get("spent")) for item in sold if bridge.number(item.get("received")) > bridge.number(item.get("spent"))]
        losses = [bridge.number(item.get("spent")) - bridge.number(item.get("received")) for item in sold if bridge.number(item.get("received")) < bridge.number(item.get("spent"))]
        if wins and losses:
            parts.append(f"an average win is {comma(sum(wins) / len(wins) / (sum(losses) / len(losses)))} times an average loss")
    parts.append(f"open now {bridge.signed_rp(floating)}" if held else "nothing open")
    return " · ".join(parts)


def position_lines(report: dict, drawn=None) -> list:
    """The coin held now, in two or three short lines. Empty when no coin is held."""
    lines = []
    for item in held_now(report or {}):
        spent, worth = bridge.number(item.get("spent")), bridge.number(item.get("value"))
        change = (worth / spent - 1) * 100 if spent > 0 else 0.0
        lines.append(f"{coin_of(item.get('symbol'))}: paid {bridge.rp(spent)} on {clock(item.get('openedAt'))}, worth {bridge.rp(worth)} now: {bridge.signed_rp(worth - spent)} ({signed_pct(change)})")
        if drawn and drawn.get("trail"):
            lines.append(f"Stop about {bridge.rp(drawn['trail'])} a coin · 1:3 mark {bridge.rp(drawn['target'])} · now {signed(drawn['reached'], 2)} R")
    return lines


def markers(report: dict, coin: str, real_only: bool) -> list:
    """Where the chart marks a buy or a sale of this coin: [(moment ms, 'buy' or 'sell', price)]."""
    found = []
    for item in (report or {}).get("positions") or []:
        if coin_of(item.get("symbol")) == coin and not (real_only and item.get("real") is False) and bridge.number(item.get("price")) > 0:
            found.append((bridge.number(item.get("openedAt")), "buy", bridge.number(item.get("price"))))
    for item in (report or {}).get("closed") or []:
        quantity = bridge.number(item.get("quantity"))
        if coin_of(item.get("symbol")) != coin or (real_only and item.get("real") is False) or quantity <= 0:
            continue
        found.append((bridge.number(item.get("boughtAt")), "buy", bridge.number(item.get("spent")) / quantity))
        if item.get("how") == "sold":
            found.append((bridge.number(item.get("at")), "sell", bridge.number(item.get("received")) / quantity))
    return sorted(found)


# ---------------------------------------------------------------- the chart's arithmetic (no window needed)

MIN_VISIBLE = 24
START_VISIBLE = 120


def clamp_window(count: int, visible, offset) -> tuple:
    """(candles shown, candles hidden at the right) kept inside what there is."""
    if count <= 0:
        return 0, 0
    visible = int(max(min(MIN_VISIBLE, count), min(count, round(visible))))
    offset = int(max(0, min(count - visible, round(offset))))
    return visible, offset


def zoomed(count: int, visible: int, offset: int, steps: int, share: float = 1.0) -> tuple:
    """Zoom in (steps > 0) or out around the candle under the mouse (share: 0 left edge, 1 right edge)."""
    wanted = visible * (0.8 ** steps)
    wanted = max(min(MIN_VISIBLE, count), min(count, wanted))
    share = max(0.0, min(1.0, share))
    return clamp_window(count, wanted, offset + (1 - share) * (visible - wanted))


def panned(count: int, visible: int, offset: int, candles: int) -> tuple:
    """Slide the chart: candles > 0 shows older ones."""
    return clamp_window(count, visible, offset + candles)


def shown_span(count: int, visible: int, offset: int) -> tuple:
    """(first, end) indexes of the candles on screen."""
    end = count - offset
    return max(0, end - visible), end


def price_bounds(rows: list, lines=(), levels=()) -> tuple:
    """(low, high) of what is on screen, with a little air. A level joins in only when it is near."""
    if not rows:
        return 0.0, 1.0
    low, high = min(row["l"] for row in rows), max(row["h"] for row in rows)
    for line in lines:
        values = [value for value in line if value is not None]
        if values:
            low, high = min(low, min(values)), max(high, max(values))
    span = max(high - low, high * 1e-6)
    for level in levels:
        if level and low - span * 0.6 <= level <= high + span * 0.6:
            low, high = min(low, level), max(high, level)
    air = max(high - low, high * 1e-6) * 0.06
    return low - air, high + air


def label_spots(heights: list, gap: float = 12, lift: float = 8) -> list:
    """Where the words of each level line go so no two sit on each other: just above the line, else just below it."""
    spots, last = [None] * len(heights), None
    for index in sorted(range(len(heights)), key=lambda place: heights[place]):
        above, below = heights[index] - lift, heights[index] + lift
        spot = above if last is None or above >= last + gap else below if below >= last + gap else last + gap
        spots[index], last = spot, spot
    return spots


def ticks(low: float, high: float, most: int = 5) -> list:
    """Round prices to write along the scale."""
    span = high - low
    if span <= 0 or most < 1:
        return []
    rough = span / most
    power = 10 ** math.floor(math.log10(rough))
    step = next(power * factor for factor in (1, 2, 2.5, 5, 10) if power * factor >= rough)
    first = math.ceil(low / step) * step
    found, value = [], first
    while value <= high + step * 1e-9:
        found.append(round(value, 10))
        value += step
    return found


def candle_at(rows: list, moment) -> int:
    """The index of the candle a moment falls in, or -1 when it is before the first one."""
    index = -1
    for position, row in enumerate(rows):
        if row["t"] <= moment:
            index = position
        else:
            break
    return index


def time_label(ms, key: str) -> str:
    """The time under a candle: the day for the day chart, else day and hour."""
    text = clock(ms)
    return text.rsplit(" ", 1)[0] if key == "1D" else text


def demo_summary(learned: dict) -> dict:
    """The demo's study with the three ideas and the yardstick added (made-up numbers, as the rest of the demo)."""
    since = bridge.number(learned.get("at")) - 6 * 86400000
    ideas = [
        {"key": "target", "name": "sell at 1:3", "trades": 91, "wins": 37, "perYear": 7400, "dip": -15700, "unseen": 19800, "since": {"from": since, "days": 6, "trades": 0, "lead": 0}},
        {"key": "topdown", "name": "top-down (daily chart up too)", "trades": 148, "wins": 36, "perYear": 4400, "dip": -7900, "unseen": 6500, "since": {"from": since, "days": 6, "trades": 1, "lead": -120}},
        {"key": "both", "name": "top-down and sell at 1:3", "trades": 64, "wins": 38, "perYear": 7100, "dip": -8500, "unseen": 11300, "since": {"from": since, "days": 6, "trades": 0, "lead": 0}},
    ]
    return {**learned, "ideas": ideas, "hold": {"perYear": 25600, "dip": -165600, "total": 171700}}
