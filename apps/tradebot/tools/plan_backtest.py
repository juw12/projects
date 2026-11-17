"""Where the plan's numbers come from (src/indodax.js, PLAN).

Replays the trading rules of src/strategy.js on past 4-hour candles and copies each trade the way
the Indodax sender does: one buy of a fixed size at a time, sold when the strategy sells or when
the price falls 8% under the price paid.

  signals  Binance BTC/USDT candles (the same prices the strategy reads)
  prices   Indodax BTC/IDR candles (what a buy and a sale really cost in rupiah)
  costs    0.35% per buy and per sale (fee and tax, rounded up) plus 0.1% for a worse price

No peeking: a decision uses candles up to a close and is filled at the next candle's open.
The result is what happened in the past. It is not a promise.

  python tools/plan_backtest.py                 BTC, Rp20.000 per buy, from 1 March 2020
  python tools/plan_backtest.py --order 40000
  HTTPS_PROXY is used when it is set.
"""

import argparse
import concurrent.futures
import datetime
import json
import statistics
import time
import urllib.request

FOUR_HOURS = 4 * 3600 * 1000
FAST, SLOW, REGIME, RSI_PERIOD, RSI_MIN, RSI_MAX, ATR_PERIOD, STOP_ATR, COOLDOWN = 20, 50, 200, 14, 50, 70, 14, 3, 6


def read(url: str):
    last = None
    for attempt in range(4):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=30) as answer:
                return json.loads(answer.read().decode("utf-8"))
        except Exception as error:  # the office proxy drops a call now and then
            last = error
            time.sleep(3 + 4 * attempt)
    raise last


def chunk(source: str, start: int) -> list:
    if source == "binance":
        url = f"https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=1000&startTime={start}"
        return [{"t": row[0], "o": float(row[1]), "h": float(row[2]), "l": float(row[3]), "c": float(row[4])} for row in read(url)]
    url = f"https://indodax.com/tradingview/history_v2?from={start // 1000}&to={start // 1000 + 1000 * 14400}&tf=240&symbol=BTCIDR"
    return [
        {"t": int(row["Time"]) * 1000, "o": float(row["Open"]), "h": float(row["High"]), "l": float(row["Low"]), "c": float(row["Close"])}
        for row in read(url)
    ]


def candles(source: str, start_ms: int, end_ms: int) -> list:
    """Every closed 4-hour candle from start to end, read 1000 at a time, eight calls at once."""
    rows = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for part in pool.map(lambda start: chunk(source, start), range(start_ms, end_ms, 1000 * FOUR_HOURS)):
            rows.update({row["t"]: row for row in part})
    return [rows[at] for at in sorted(rows) if at + FOUR_HOURS <= end_ms]  # the candle still forming is left out


def ema(values: list, period: int) -> list:
    out = [None] * len(values)
    value = sum(values[:period]) / period
    out[period - 1] = value
    for index in range(period, len(values)):
        value += (values[index] - value) * 2 / (period + 1)
        out[index] = value
    return out


def rsi(closes: list, period: int) -> list:
    out = [None] * len(closes)
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

    def true_range(index: int) -> float:
        before = rows[index - 1]["c"]
        return max(rows[index]["h"] - rows[index]["l"], abs(rows[index]["h"] - before), abs(rows[index]["l"] - before))

    value = sum(true_range(index) for index in range(1, period + 1)) / period
    out[period] = value
    for index in range(period + 1, len(rows)):
        value = (value * (period - 1) + true_range(index)) / period
        out[index] = value
    return out


def strategy_trades(rows: list) -> list:
    """The strategy's own trades: (time bought, time sold, how, sale price / that candle's open)."""
    closes = [row["c"] for row in rows]
    fast, slow, regime = ema(closes, FAST), ema(closes, SLOW), ema(closes, REGIME)
    strength, ranges = rsi(closes, RSI_PERIOD), atr(rows, ATR_PERIOD)
    trades, position, order, order_stop, last_exit = [], None, None, 0.0, None
    for index in range(REGIME, len(rows)):
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
        trail = closes[index] - STOP_ATR * ranges[index]
        if position is not None:
            position["stop"] = max(position["stop"], trail)
            if not momentum_up or not trend_up:
                order = "sell"
        elif last_exit is not None and index - last_exit < COOLDOWN:
            continue
        elif trend_up and momentum_up and RSI_MIN <= strength[index] <= RSI_MAX:
            order, order_stop = "buy", trail
    return trades


def copy_at_indodax(trades: list, prices: list, order_idr: float, stop_percent: float, cost: float, slip: float, start_ms: int):
    """The sender's copy of each trade in rupiah. Returns (result after each candle, each trade's result)."""
    by_start = {bought: (sold, how, ratio) for bought, sold, how, ratio in trades if bought >= start_ms}
    curve, results, copy, banked = [], [], None, 0.0
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
                results.append(result)
                copy = None
        floating = copy["quantity"] * row["c"] * (1 - cost) - order_idr if copy else 0.0
        curve.append((row["t"], banked + floating))
    return curve, results


def percentile(values: list, share: float) -> float:
    ordered = sorted(values)
    spot = (len(ordered) - 1) * share
    low = int(spot)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (spot - low)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--order", type=float, default=20000, help="rupiah per buy")
    parser.add_argument("--stop", type=float, default=8.0, help="the sender's stop, percent under the price paid")
    parser.add_argument("--cost", type=float, default=0.35, help="percent paid on each buy and each sale")
    parser.add_argument("--slip", type=float, default=0.1, help="percent lost to a worse price on each fill")
    parser.add_argument("--start", default="2020-03-01", help="first day traded (candles from 1 Jan 2020 warm the averages up)")
    args = parser.parse_args()

    warm = int(datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)
    start = int(datetime.datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp() * 1000)
    end = int(time.time() * 1000)
    trades = strategy_trades(candles("binance", warm, end))
    curve, results = copy_at_indodax(trades, candles("indodax", warm, end), args.order, args.stop, args.cost / 100, args.slip / 100, start)

    wins = [result for result in results if result > 0]
    losses = [result for result in results if result <= 0]
    years = (curve[-1][0] - curve[0][0]) / (365.25 * 86400e3)
    day = lambda at: datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).strftime("%d %b %Y")
    print(f"BTC, {day(curve[0][0])} to {day(curve[-1][0])}: {len(results)} trades, Rp{args.order:,.0f} per buy")
    print(f"won {len(wins) / len(results):.0%} · average win Rp{statistics.mean(wins):,.0f} · average loss Rp{statistics.mean(losses):,.0f} · worst Rp{min(results):,.0f}")
    print(f"result Rp{curve[-1][1]:,.0f} in {years:.1f} years (Rp{curve[-1][1] / years:,.0f} a year)")
    by_year = {}
    for at, value in curve:
        by_year[datetime.datetime.fromtimestamp(at / 1000, datetime.timezone.utc).year] = value
    before = 0.0
    for year, value in by_year.items():
        print(f"  {year}: Rp{value - before:,.0f}")
        before = value
    values = [value for _, value in curve]
    print("change over every window in the period: low (1 in 10 did worse), middle, high (1 in 10 did better)")
    for name, days in (("1 month", 30), ("3 months", 91), ("6 months", 182), ("12 months", 365)):
        step = days * 6
        changes = [values[index + step] - values[index] for index in range(len(values) - step)]
        up = sum(1 for change in changes if change > 0) / len(changes)
        print(f"  {name:>9}: Rp{percentile(changes, 0.1):>8,.0f}  Rp{percentile(changes, 0.5):>8,.0f}  Rp{percentile(changes, 0.9):>8,.0f}   ended up in {up:.0%} of them")


if __name__ == "__main__":
    main()
