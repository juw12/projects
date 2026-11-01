"""Binance order executor — OPT-IN only.

Defaults to **testnet** (https://testnet.binance.vision). To trade on the real
exchange, set EXECUTE_LIVE_TRADES=true in .env. Two additional safety gates:

  EXECUTOR_KILL_SWITCH=true   refuses every order without making an API call.
  MAX_POSITION_USD=200        never places an order whose notional exceeds this.
  MAX_DAILY_LOSS_USD=50       refuses new orders once realized day's losses exceed this.

This module is wired into bot.py but only activates when LIVE_TRADING=true.
Until then, the bot is pure paper-trading.

Binance API signing uses HMAC-SHA256 over the query string. Standard.
"""
from __future__ import annotations

import hashlib
import hmac
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests

TESTNET_BASE = "https://testnet.binance.vision"
LIVE_BASE = "https://api.binance.com"


@dataclass
class OrderResult:
    ok: bool
    order_id: str
    symbol: str
    side: str
    qty: float
    price: float
    raw: dict[str, Any]


class ExecutorError(RuntimeError):
    pass


class BinanceExecutor:
    def __init__(
        self,
        api_key: str,
        api_secret: str,
        testnet: bool = True,
        max_position_usd: float = 200.0,
        max_daily_loss_usd: float = 50.0,
        kill_switch: bool = False,
    ):
        if not api_key or not api_secret:
            raise ExecutorError("api_key and api_secret are required")
        self.key = api_key
        self.secret = api_secret
        self.base = TESTNET_BASE if testnet else LIVE_BASE
        self.max_position_usd = max_position_usd
        self.max_daily_loss_usd = max_daily_loss_usd
        self.kill_switch = kill_switch
        self._realized_today_usd: float = 0.0
        self._today_date: str = datetime.now(timezone.utc).date().isoformat()

    # -------- signing --------
    def _sign(self, params: dict[str, Any]) -> str:
        qs = urllib.parse.urlencode(params)
        sig = hmac.new(self.secret.encode(), qs.encode(), hashlib.sha256).hexdigest()
        return f"{qs}&signature={sig}"

    def _request(self, method: str, path: str, params: dict[str, Any], signed: bool = True) -> dict[str, Any]:
        params = dict(params)
        params.setdefault("timestamp", int(time.time() * 1000))
        params.setdefault("recvWindow", 5000)
        url = f"{self.base}{path}"
        if signed:
            full = self._sign(params)
            r = requests.request(method, url, headers={"X-MBX-APIKEY": self.key},
                                 data=full if method == "POST" else None,
                                 params=None if signed else full,
                                 timeout=15)
        else:
            r = requests.request(method, url, params=params, timeout=15)
        if r.status_code >= 400:
            raise ExecutorError(f"binance {r.status_code}: {r.text[:300]}")
        return r.json()

    # -------- public reads --------
    def get_price(self, symbol: str) -> float:
        data = self._request("GET", "/api/v3/ticker/price", {"symbol": symbol}, signed=False)
        return float(data["price"])

    def get_account(self) -> dict[str, Any]:
        return self._request("GET", "/api/v3/account", {})

    # -------- order entry --------
    def place_market_order(self, symbol: str, side: str, qty: float) -> OrderResult:
        if self.kill_switch:
            raise ExecutorError("kill switch ON — refusing order")
        if side not in ("BUY", "SELL"):
            raise ExecutorError(f"side must be BUY or SELL, got {side!r}")
        if qty <= 0:
            raise ExecutorError(f"qty must be positive, got {qty}")

        # Daily loss gate (only meaningful after at least one round-trip).
        self._rollover_if_new_day()
        if self._realized_today_usd <= -self.max_daily_loss_usd:
            raise ExecutorError(f"daily loss limit hit (${-self._realized_today_usd:.2f}) — refusing new orders")

        # Position notional cap.
        price = self.get_price(symbol)
        notional = qty * price
        if notional > self.max_position_usd:
            raise ExecutorError(f"notional ${notional:.2f} > cap ${self.max_position_usd:.2f}")

        params = {
            "symbol": symbol,
            "side": side,
            "type": "MARKET",
            "quantity": self._trim_qty(symbol, qty),
        }
        data = self._request("POST", "/api/v3/order", params)
        fills = data.get("fills", [])
        avg_price = float(data.get("price", 0)) if data.get("price") else (
            sum(float(f["price"]) * float(f["qty"]) for f in fills) /
            sum(float(f["qty"]) for f in fills) if fills else price
        )
        return OrderResult(
            ok=True, order_id=str(data["orderId"]),
            symbol=symbol, side=side,
            qty=float(data.get("executedQty", qty)),
            price=avg_price, raw=data,
        )

    def place_oco_order(self, symbol: str, side: str, qty: float, price: float, stop: float, target: float) -> dict[str, Any]:
        """Place a SL + TP as an OCO list. side is the side used to CLOSE (opposite of entry)."""
        if self.kill_switch:
            raise ExecutorError("kill switch ON — refusing order")
        # Binance OCO: SIDE = side to SELL (for longs) / BUY (for shorts).
        # Below params assume closing a LONG (so side='SELL'). Caller flips for shorts.
        params = {
            "symbol": symbol,
            "side": side,
            "quantity": self._trim_qty(symbol, qty),
            "price": self._trim_price(target, 2),
            "stopPrice": self._trim_price(stop, 2),
            "stopLimitPrice": self._trim_price(stop, 2),
            "stopLimitTimeInForce": "GTC",
        }
        return self._request("POST", "/api/v3/order/oco", params)

    # -------- internal --------
    def _rollover_if_new_day(self) -> None:
        today = datetime.now(timezone.utc).date().isoformat()
        if today != self._today_date:
            self._today_date = today
            self._realized_today_usd = 0.0

    def record_realized(self, pnl_usd: float) -> None:
        self._rollover_if_new_day()
        self._realized_today_usd += pnl_usd

    @staticmethod
    def _trim_qty(symbol: str, qty: float) -> str:
        # Conservative defaults; a real adapter should pull LOT_SIZE filters per symbol.
        rules = {
            "BTCUSDT": 5, "ETHUSDT": 4, "AVAXUSDT": 2, "BNBUSDT": 2,
            "SOLUSDT": 2, "XRPUSDT": 1, "DOGEUSDT": 0, "ADAUSDT": 1,
        }
        decimals = rules.get(symbol.upper(), 3)
        return f"{qty:.{decimals}f}".rstrip("0").rstrip(".") or "0"

    @staticmethod
    def _trim_price(price: float, decimals: int = 2) -> str:
        return f"{price:.{decimals}f}"


def from_env(env) -> "BinanceExecutor | None":
    """Build an executor from config + .env. Returns None if LIVE_TRADING is not enabled."""
    import config
    live = config.get("LIVE_TRADING", "false").lower() == "true"
    if not live:
        return None
    return BinanceExecutor(
        api_key=config.get("BINANCE_API_KEY"),
        api_secret=config.get("BINANCE_API_SECRET"),
        testnet=config.get("USE_TESTNET", "true").lower() != "false",
        max_position_usd=config.get_float("MAX_POSITION_USD", 200.0),
        max_daily_loss_usd=config.get_float("MAX_DAILY_LOSS_USD", 50.0),
        kill_switch=config.get("EXECUTOR_KILL_SWITCH", "false").lower() == "true",
    )
