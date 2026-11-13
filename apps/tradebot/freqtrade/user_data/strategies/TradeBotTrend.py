"""TradeBot's trading rules, written for freqtrade.

The same rules the Cloudflare TradeBot trades (apps/tradebot/src/strategy.js), so the two bots can be
compared side by side and freqtrade's mature engine can double-check TradeBot's own backtest:

  buy    the close is above its 200-candle average (trend), the 20-candle average is above the
         50-candle average (momentum) and RSI(14) is between 50 and 70 (rising, not overheated);
  sell   when momentum turns down or the close falls under the 200-candle average;
  stop   3 ATR(14) under the close, following the price up and never down;
  size   so that hitting the stop costs about 1% of the account, at most 25% of it in one coin;
  wait   6 candles after a sale before buying the same coin again.

Indicators are plain pandas (no TA-Lib), with the same formulas as strategy.js: EMAs seeded with a
simple average, Wilder's RSI and ATR.
"""

from datetime import datetime

import numpy as np
from pandas import DataFrame, Series

from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, stoploss_from_absolute

FAST = 20
SLOW = 50
REGIME = 200
RSI_PERIOD = 14
RSI_MIN = 50
RSI_MAX = 70
ATR_PERIOD = 14
STOP_ATR = 3.0
COOLDOWN = 6
RISK_PCT = 1.0
MAX_POSITION_PCT = 25.0


def ema(values: Series, period: int) -> Series:
    """Exponential average started from a simple average, like strategy.js. NaN until ready."""
    out = np.full(len(values), np.nan)
    data = values.to_numpy(dtype=float)
    if len(data) >= period:
        value = data[:period].mean()
        out[period - 1] = value
        weight = 2 / (period + 1)
        for index in range(period, len(data)):
            value += (data[index] - value) * weight
            out[index] = value
    return Series(out, index=values.index)


def wilder(values: np.ndarray, period: int, first: int) -> np.ndarray:
    """Wilder's smoothing of `values`, seeded with the average of values[first : first + period]."""
    out = np.full(len(values), np.nan)
    if len(values) > first + period - 1:
        value = values[first : first + period].mean()
        out[first + period - 1] = value
        for index in range(first + period, len(values)):
            value = (value * (period - 1) + values[index]) / period
            out[index] = value
    return out


def rsi(close: Series, period: int) -> Series:
    change = np.diff(close.to_numpy(dtype=float), prepend=np.nan)
    gain = wilder(np.where(change > 0, change, 0.0), period, 1)
    loss = wilder(np.where(change < 0, -change, 0.0), period, 1)
    with np.errstate(divide="ignore", invalid="ignore"):
        value = np.where(loss == 0, 100.0, 100 - 100 / (1 + gain / loss))
    value[np.isnan(gain)] = np.nan
    return Series(value, index=close.index)


def atr(frame: DataFrame, period: int) -> Series:
    high = frame["high"].to_numpy(dtype=float)
    low = frame["low"].to_numpy(dtype=float)
    before = np.roll(frame["close"].to_numpy(dtype=float), 1)
    true_range = np.maximum(high - low, np.maximum(np.abs(high - before), np.abs(low - before)))
    true_range[0] = np.nan
    return Series(wilder(true_range, period, 1), index=frame.index)


class TradeBotTrend(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = "4h"
    can_short = False
    startup_candle_count = REGIME + 30
    process_only_new_candles = True

    # The real stop is custom_stoploss (3 ATR, trailing); this is only a last-resort floor.
    stoploss = -0.5
    use_custom_stoploss = True
    trailing_stop = False
    minimal_roi = {"0": 100}  # never sell on profit alone

    use_exit_signal = True
    exit_profit_only = False

    @property
    def protections(self):
        return [{"method": "CooldownPeriod", "stop_duration_candles": COOLDOWN}]

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["fast"] = ema(dataframe["close"], FAST)
        dataframe["slow"] = ema(dataframe["close"], SLOW)
        dataframe["regime"] = ema(dataframe["close"], REGIME)
        dataframe["rsi"] = rsi(dataframe["close"], RSI_PERIOD)
        dataframe["atr"] = atr(dataframe, ATR_PERIOD)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        trend = dataframe["close"] > dataframe["regime"]
        momentum = dataframe["fast"] > dataframe["slow"]
        strength = dataframe["rsi"].between(RSI_MIN, RSI_MAX)
        dataframe.loc[trend & momentum & strength & dataframe["atr"].notna(), ["enter_long", "enter_tag"]] = (1, "3 checks pass")
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        momentum_lost = dataframe["fast"] < dataframe["slow"]
        trend_lost = dataframe["close"] < dataframe["regime"]
        dataframe.loc[momentum_lost | trend_lost, ["exit_long", "exit_tag"]] = (1, "trend or momentum lost")
        return dataframe

    def _last(self, pair: str):
        frame, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        return None if frame is None or frame.empty else frame.iloc[-1]

    def custom_stoploss(self, pair: str, trade: Trade, current_time: datetime, current_rate: float,
                        current_profit: float, after_fill: bool, **kwargs) -> float | None:
        candle = self._last(pair)
        if candle is None or np.isnan(candle["atr"]):
            return None
        # freqtrade only ever moves a stop up, so this trails like TradeBot's stop.
        return stoploss_from_absolute(candle["close"] - STOP_ATR * candle["atr"], current_rate, is_short=False)

    def custom_stake_amount(self, pair: str, current_time: datetime, current_rate: float,
                            proposed_stake: float, min_stake: float | None, max_stake: float,
                            leverage: float, entry_tag: str | None, side: str, **kwargs) -> float:
        candle = self._last(pair)
        if candle is None or np.isnan(candle["atr"]) or current_rate <= 0:
            return 0
        account = self.wallets.get_total_stake_amount()
        distance = STOP_ATR * candle["atr"] / current_rate  # share of the trade lost at the stop
        stake = min(account * RISK_PCT / 100 / distance, account * MAX_POSITION_PCT / 100, max_stake)
        return 0 if min_stake and stake < min_stake else stake
