"""Pure-stdlib RSI / MACD / ATR / EMA. No TA-Lib, no pandas — just lists."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Signal:
    symbol: str
    timeframe: str
    side: str            # 'LONG' or 'SHORT' or '' for none
    entry: float
    stop: float
    target: float
    rsi: float
    macd_hist: float
    reason: str
    bar_time: int        # unix ms of the bar that produced the signal


def _ema(values: list[float], period: int) -> list[float]:
    """Exponential moving average. First `period` entries are NaN until warm-up."""
    if not values:
        return []
    k = 2.0 / (period + 1.0)
    out: list[float] = [values[0]]
    for v in values[1:]:
        out.append(v * k + out[-1] * (1.0 - k))
    return out


def ema(values: list[float], period: int) -> list[float]:
    """EMA with a simple SMA seed for the first value."""
    if len(values) < period:
        return [float("nan")] * len(values)
    seed = sum(values[:period]) / period
    out = [float("nan")] * (period - 1) + [seed]
    k = 2.0 / (period + 1.0)
    prev = seed
    for v in values[period:]:
        prev = v * k + prev * (1.0 - k)
        out.append(prev)
    return out


def rsi(closes: list[float], period: int = 14) -> list[float]:
    """Wilder's RSI."""
    n = len(closes)
    out: list[float] = [float("nan")] * n
    if n <= period:
        return out

    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff >= 0:
            gains += diff
        else:
            losses -= diff
    avg_gain = gains / period
    avg_loss = losses / period

    rs = avg_gain / avg_loss if avg_loss > 0 else float("inf")
    out[period] = 100.0 - (100.0 / (1.0 + rs)) if avg_loss > 0 else 100.0

    for i in range(period + 1, n):
        diff = closes[i] - closes[i - 1]
        gain = diff if diff > 0 else 0.0
        loss = -diff if diff < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rs = avg_gain / avg_loss if avg_loss > 0 else float("inf")
        out[i] = 100.0 - (100.0 / (1.0 + rs)) if avg_loss > 0 else 100.0

    return out


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal_p: int = 9):
    """Returns (macd_line, signal_line, histogram) — each list aligned to closes."""
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    n = len(closes)
    macd_line: list[float] = [float("nan")] * n
    for i in range(n):
        if ema_fast[i] != ema_fast[i] or ema_slow[i] != ema_slow[i]:
            continue
        macd_line[i] = ema_fast[i] - ema_slow[i]

    # Signal line = EMA of macd_line ignoring NaNs
    valid: list[tuple[int, float]] = [(i, v) for i, v in enumerate(macd_line) if v == v]
    signal_line: list[float] = [float("nan")] * n
    if len(valid) >= signal_p:
        seed_vals = [v for _, v in valid[:signal_p]]
        seed = sum(seed_vals) / signal_p
        first_idx = valid[signal_p - 1][0]
        for k in range(first_idx + 1):
            signal_line[k] = float("nan")
        signal_line[first_idx] = seed
        prev = seed
        k_factor = 2.0 / (signal_p + 1.0)
        for j in range(signal_p, len(valid)):
            idx, val = valid[j]
            prev = val * k_factor + prev * (1.0 - k_factor)
            signal_line[idx] = prev
        for k in range(first_idx):
            signal_line[k] = float("nan")

    hist: list[float] = [float("nan")] * n
    for i in range(n):
        if macd_line[i] != macd_line[i] or signal_line[i] != signal_line[i]:
            continue
        hist[i] = macd_line[i] - signal_line[i]
    return macd_line, signal_line, hist


def atr(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> list[float]:
    """Average True Range (Wilder)."""
    n = len(closes)
    out: list[float] = [float("nan")] * n
    if n < period + 1:
        return out
    trs: list[float] = [float("nan")]
    for i in range(1, n):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    # Seed with SMA of first `period` TRs
    seed = sum(trs[1 : period + 1]) / period
    out[period] = seed
    prev = seed
    for i in range(period + 1, n):
        prev = (prev * (period - 1) + trs[i]) / period
        out[i] = prev
    return out


def generate_signal(
    symbol: str,
    timeframe: str,
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    bar_times: list[int],
    rsi_ob: float = 70.0,
    rsi_os: float = 30.0,
    atr_mult_sl: float = 1.5,
    rr: float = 2.0,
) -> Signal:
    """Evaluate the most recent CLOSED bar. Returns a Signal with side='' if no trigger."""
    if len(closes) < 60:
        return Signal(symbol, timeframe, "", 0.0, 0.0, 0.0, 0.0, 0.0, "warmup", bar_times[-1] if bar_times else 0)

    r = rsi(closes, 14)
    _, _, hist = macd(closes, 12, 26, 9)
    a = atr(highs, lows, closes, 14)
    trend = ema(closes, 50)

    i = len(closes) - 1
    rsi_now = r[i]
    hist_now = hist[i]
    hist_prev = hist[i - 1] if i >= 1 else float("nan")
    atr_now = a[i]
    trend_now = trend[i]
    price = closes[i]
    bar_time = bar_times[i]

    if any(x != x for x in (rsi_now, hist_now, hist_prev, atr_now, trend_now)):
        return Signal(symbol, timeframe, "", 0.0, 0.0, 0.0, rsi_now, hist_now, "warmup", bar_time)

    side = ""
    reason = ""

    # LONG: RSI recovering from oversold + MACD histogram crosses up + price above 50 EMA.
    if rsi_now > rsi_os and rsi_now < 55.0 and hist_prev <= 0.0 < hist_now and price > trend_now:
        side = "LONG"
        reason = f"RSI {rsi_now:.1f} rising from oversold; MACD hist turned positive; above 50EMA"
    # SHORT: RSI rejecting from overbought + MACD histogram crosses down + price below 50 EMA.
    elif rsi_now < rsi_ob and rsi_now > 45.0 and hist_prev >= 0.0 > hist_now and price < trend_now:
        side = "SHORT"
        reason = f"RSI {rsi_now:.1f} rejecting from overbought; MACD hist turned negative; below 50EMA"

    if not side:
        return Signal(symbol, timeframe, "", 0.0, 0.0, 0.0, rsi_now, hist_now, "no trigger", bar_time)

    if side == "LONG":
        stop = price - atr_mult_sl * atr_now
        target = price + rr * atr_mult_sl * atr_now
    else:
        stop = price + atr_mult_sl * atr_now
        target = price - rr * atr_mult_sl * atr_now

    return Signal(symbol, timeframe, side, price, stop, target, rsi_now, hist_now, reason, bar_time)
