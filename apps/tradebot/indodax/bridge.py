"""TradeBot's Indodax sender. PRACTICE BY DEFAULT: no order reaches Indodax until you switch it on.

Indodax turns away requests that come from TradeBot's server, so orders have to leave from a PC.
This sender runs on that PC and copies TradeBot's practice account in rupiah:

  once a minute
    1. ask TradeBot which coins its practice account holds right now
    2. read Indodax's pair list and prices (public data, no key needed)
    3. sell this sender's own copies that TradeBot no longer holds, or that fell to its own stop
    4. buy one small copy of each coin that is held and not copied yet
    5. tell TradeBot what the copies look like (/indodax in Telegram shows it)

What keeps it safe:
  * Practice is the default. Fills are worked out from Indodax's real prices and fee, with pretend
    money, and the private API is not touched at all.
  * Real money needs three things together: INDODAX_MODE=real, the exact confirm sentence in
    INDODAX_REAL_CONFIRM, and an API key. Every real order passes one gate that checks them again.
  * One order is a fixed rupiah amount with a hard ceiling, at most three copies are open, and
    buying stops for the day after a loss of one order's size or after ten buys.
  * Anything unclear (an answer that got lost, a refusal, a coin that did not arrive) stops new real
    buys until you have looked and run  python bridge.py --clear
  * It never withdraws: make the API key with "view" and "trade" only.
  * It keeps only your balances from Indodax's answer. Your name, email, user id and deposit
    addresses are never stored, printed or sent anywhere.

    python bridge.py --show     what it would do right now (no orders, no report)
    python bridge.py --check    does the API key work? prints the free rupiah, orders nothing
    python bridge.py --once     one cycle
    python bridge.py            keep going, one cycle a minute
    python bridge.py --clear    clear the safety stop after you have looked

Not tested against a real Indodax account yet: the tests use a pretend exchange.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import http.client
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from pathlib import Path

CLIENT = "juw12-trade-indodax/0.9"  # how the sender names itself (Indodax turns away names with "bot")
INDODAX = "https://indodax.com"  # fixed on purpose: the API key can never be sent anywhere else
DEFAULT_URL = "https://trade-bot.juw12.workers.dev"
CYCLE_SECONDS = 60
HERE = Path(__file__).resolve().parent

REAL_CONFIRM = "I accept real money on Indodax"
ORDER_IDR_DEFAULT = 50_000
ORDER_IDR_MIN = 20_000
ORDER_IDR_CAP = 500_000  # one order is never larger than this, whatever the .env says
MAX_OPEN_DEFAULT = 2
MAX_OPEN_CAP = 3
STOP_PERCENT_DEFAULT = 8.0
MAX_SPREAD_PERCENT = 0.5  # wider than this between buyers and sellers: not bought
MAX_BUYS_PER_DAY = 10
FEE_PERCENT_DEFAULT = 0.3  # used in practice only when the pair list names no fee (an assumption)
RECV_WINDOW_MS = 5000
CLOCK_SYNC_SECONDS = 600
PAIRS_CACHE_SECONDS = 3600
CLOSED_KEPT = 20
SMALLEST_STEP = "0.00000001"


class SettingsError(Exception):
    """The .env holds something the sender cannot use."""


class StateError(Exception):
    """The state file is there but cannot be read."""


class ApiError(Exception):
    """TradeBot's server could not be asked or did not accept the answer."""


class ExchangeError(Exception):
    """Indodax could not be asked, or said no. unsure=True: the request may still have arrived."""

    def __init__(self, message: str, unsure: bool = False, code: str = ""):
        super().__init__(message)
        self.unsure = unsure
        self.code = code


class Refused(Exception):
    """An order was not sent, or could not be confirmed."""


# ---------------------------------------------------------------- small helpers


def number(value, default: float = 0.0) -> float:
    """A finite number, or the default."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def truthy(value) -> bool:
    return str(value).strip().lower() not in ("", "0", "false", "none", "no")


def clip(text, length: int) -> str:
    return " ".join(str(text or "").split())[:length]


def rp(value) -> str:
    """50000 -> Rp50.000"""
    return "Rp" + f"{round(number(value)):,}".replace(",", ".")


def signed_rp(value) -> str:
    amount = round(number(value))
    return ("+" if amount >= 0 else "-") + rp(abs(amount))


def floor_to(quantity, increment) -> Decimal:
    """Round a coin amount down to the pair's smallest step."""
    try:
        step = Decimal(str(increment))
    except InvalidOperation:
        step = Decimal(0)
    if not step.is_finite() or step <= 0:
        step = Decimal(SMALLEST_STEP)  # an unreadable step never turns a real amount into nothing
    try:
        amount = Decimal(str(quantity))
    except InvalidOperation:
        return Decimal(0)
    if not amount.is_finite() or amount <= 0:
        return Decimal(0)
    return (amount / step).to_integral_value(rounding=ROUND_DOWN) * step


def plain(quantity: Decimal) -> str:
    """A coin amount as Indodax wants it: plain digits, never 1e-05."""
    text = format(quantity, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def order_name(coin: str, signal, tail: str) -> str:
    """The order's own name at Indodax. Indodax refuses a second order with the same name."""
    safe = "".join(letter for letter in str(coin) if letter.isalnum())[:10]
    return f"tb-{safe}-{int(signal)}-{tail}"[:36]


def sign(body: str, secret: str) -> str:
    """HMAC-SHA512 of the exact request body, as Indodax's private API asks for."""
    return hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha512).hexdigest()


# ---------------------------------------------------------------- settings


@dataclass
class Settings:
    key: str = field(default="", repr=False)  # TradeBot's bridge key
    url: str = DEFAULT_URL
    api_key: str = field(default="", repr=False)
    api_secret: str = field(default="", repr=False)
    mode: str = "practice"
    confirmed: bool = False
    order_idr: int = ORDER_IDR_DEFAULT
    max_open: int = MAX_OPEN_DEFAULT
    stop_percent: float = STOP_PERCENT_DEFAULT
    coins: tuple = ()
    proxy: str = field(default="", repr=False)

    @property
    def has_keys(self) -> bool:
        return bool(self.api_key and self.api_secret)

    @property
    def real(self) -> bool:
        """Real money needs the mode, the confirm sentence and the keys, all three."""
        return self.mode == "real" and self.confirmed and self.has_keys


def read_env_file(path) -> dict:
    """KEY=value lines; blank lines and # comments are skipped. A missing file is empty."""
    values = {}
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def _whole(values: dict, name: str, default: int, low: int, high: int, what: str) -> int:
    text = (values.get(name) or "").strip()
    if not text:
        return default
    # 50000 or 50.000 (thousands in groups of three). 50000.5 is refused, never read as 500005.
    if not re.fullmatch(r"\d+|\d{1,3}([.,_]\d{3})+", text):
        raise SettingsError(f"{name} must be {what}.")
    amount = int(re.sub(r"[.,_]", "", text))
    if not low <= amount <= high:
        # Never silently changed: a typo in a money setting should stop the sender, not be guessed at.
        raise SettingsError(f"{name} must be {what}.")
    return amount


def settings_from(values: dict) -> Settings:
    url = (values.get("INDODAX_BRIDGE_URL") or DEFAULT_URL).strip().rstrip("/")
    if not url.lower().startswith("https://"):
        raise SettingsError("INDODAX_BRIDGE_URL must start with https:// so the key is never sent in the clear.")

    mode = (values.get("INDODAX_MODE") or "practice").strip().lower()
    if mode not in ("practice", "real"):
        raise SettingsError("INDODAX_MODE must be practice or real.")

    order_idr = _whole(
        values,
        "INDODAX_ORDER_IDR",
        ORDER_IDR_DEFAULT,
        ORDER_IDR_MIN,
        ORDER_IDR_CAP,
        f"a whole rupiah amount from {ORDER_IDR_MIN} to {ORDER_IDR_CAP}",
    )
    max_open = _whole(values, "INDODAX_MAX_OPEN", MAX_OPEN_DEFAULT, 1, MAX_OPEN_CAP, f"a whole number from 1 to {MAX_OPEN_CAP}")

    stop_text = (values.get("INDODAX_STOP_PERCENT") or "").strip()
    try:
        stop_percent = float(stop_text) if stop_text else STOP_PERCENT_DEFAULT
    except ValueError:
        raise SettingsError("INDODAX_STOP_PERCENT must be a number from 1 to 20.") from None
    if not 1 <= stop_percent <= 20:
        raise SettingsError("INDODAX_STOP_PERCENT must be a number from 1 to 20.")

    coins = []
    for name in (values.get("INDODAX_COINS") or "").split(","):
        name = name.strip().lower()
        if not name:
            continue
        if not name.isalnum():
            raise SettingsError(f"INDODAX_COINS: '{name}' should be a coin like btc or eth.")
        coins.append(name)

    settings = Settings(
        key=(values.get("INDODAX_BRIDGE_KEY") or "").strip(),
        url=url,
        api_key=(values.get("INDODAX_API_KEY") or "").strip(),
        api_secret=(values.get("INDODAX_API_SECRET") or "").strip(),
        mode=mode,
        confirmed=(values.get("INDODAX_REAL_CONFIRM") or "").strip() == REAL_CONFIRM,
        order_idr=order_idr,
        max_open=max_open,
        stop_percent=stop_percent,
        coins=tuple(coins),
        proxy=(values.get("HTTPS_PROXY") or values.get("https_proxy") or "").strip(),
    )
    if mode == "real":
        if not settings.confirmed:
            raise SettingsError(f'INDODAX_MODE=real also needs INDODAX_REAL_CONFIRM set to exactly: {REAL_CONFIRM}')
        if not settings.has_keys:
            raise SettingsError("INDODAX_MODE=real also needs INDODAX_API_KEY and INDODAX_API_SECRET.")
    return settings


def load_settings(env_path, environ=None) -> Settings:
    """The .env next to the script, with the process environment on top."""
    values = read_env_file(env_path)
    for name, value in (os.environ if environ is None else environ).items():
        if name.startswith("INDODAX_") or name.upper() == "HTTPS_PROXY":
            values[name] = value
    return settings_from(values)


# ---------------------------------------------------------------- TradeBot's server


class Api:
    """The two calls the sender makes to TradeBot: read the signals, post the report."""

    def __init__(self, settings: Settings, timeout: int = 20):
        self.settings = settings
        self.timeout = timeout
        handlers = [urllib.request.ProxyHandler({"https": settings.proxy})] if settings.proxy else []
        self.opener = urllib.request.build_opener(*handlers)

    def _call(self, path: str, payload=None) -> dict:
        headers = {"X-Indodax-Key": self.settings.key, "User-Agent": CLIENT, "Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.settings.url + path, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            hint = " (is INDODAX_BRIDGE_KEY the key from the setup?)" if error.code == 403 else ""
            raise ApiError(f"TradeBot answered HTTP {error.code}{hint}") from None
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as error:
            # Only the kind of problem is kept: the request and its key never reach a log.
            raise ApiError(f"TradeBot could not be reached ({type(error).__name__})") from None

    def signals(self) -> dict:
        return self._call("/v1/indodax/signals")

    def report(self, payload: dict) -> dict:
        return self._call("/v1/indodax/report", payload)


# ---------------------------------------------------------------- Indodax


class Indodax:
    """Indodax's public data, and the two private calls the sender needs: balances and one order."""

    def __init__(self, settings: Settings, timeout: int = 20, clock=time.time, opener=None):
        self.settings = settings
        self.timeout = timeout
        self.clock = clock
        if opener is None:
            handlers = [urllib.request.ProxyHandler({"https": settings.proxy})] if settings.proxy else []
            opener = urllib.request.build_opener(*handlers)
        self.opener = opener
        self.offset_ms = 0
        self.synced_at = None
        self._pairs = None
        self._pairs_at = 0.0

    def _send(self, request, writes: bool):
        """One request. `writes` says whether a lost answer could mean an order went through anyway."""
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raise ExchangeError(f"Indodax answered HTTP {error.code}", unsure=writes and error.code >= 500) from None
        except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
            # Only the kind of problem is kept: the request, its key and its signature never reach a log.
            raise ExchangeError(f"Indodax could not be reached ({type(error).__name__})", unsure=writes) from None
        try:
            return json.loads(text)
        except ValueError:
            raise ExchangeError("Indodax's answer could not be read", unsure=writes) from None

    def public(self, path: str):
        request = urllib.request.Request(INDODAX + path, headers={"User-Agent": CLIENT, "Accept": "application/json"}, method="GET")
        return self._send(request, writes=False)

    def sync_clock(self) -> None:
        """Indodax refuses a timestamp that runs ahead of its own clock, so its clock is the one used."""
        now = self.clock()
        if self.synced_at is not None and now - self.synced_at < CLOCK_SYNC_SECONDS:
            return
        answer = self.public("/api/server_time")
        server = number(answer.get("server_time") if isinstance(answer, dict) else None)
        if server <= 0:
            raise ExchangeError("Indodax's clock could not be read")
        self.offset_ms = int(server - self.clock() * 1000)
        self.synced_at = now

    def _clean(self, text) -> str:
        """Indodax's own words for a refusal, shortened, and never with the key in them."""
        message = clip(text, 160) or "no reason given"
        for secret in (self.settings.api_key, self.settings.api_secret):
            if secret:
                message = message.replace(secret, "***")
        return message

    def private(self, method: str, params=(), writes: bool = False) -> dict:
        if not self.settings.has_keys:
            raise ExchangeError("INDODAX_API_KEY and INDODAX_API_SECRET are not set")
        self.sync_clock()
        timestamp = int(self.clock() * 1000) + self.offset_ms
        fields = [("method", method), ("timestamp", timestamp), ("recvWindow", RECV_WINDOW_MS), *params]
        body = urllib.parse.urlencode(fields)
        headers = {
            "Key": self.settings.api_key,
            "Sign": sign(body, self.settings.api_secret),
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": CLIENT,
            "Accept": "application/json",
        }
        request = urllib.request.Request(INDODAX + "/tapi", data=body.encode("utf-8"), headers=headers, method="POST")
        answer = self._send(request, writes=writes)
        if not isinstance(answer, dict) or "success" not in answer:
            raise ExchangeError("Indodax's answer could not be read", unsure=writes)
        if str(answer.get("success")) != "1":
            raise ExchangeError(self._clean(answer.get("error")), code=clip(answer.get("error_code"), 40))
        result = answer.get("return")
        return result if isinstance(result, dict) else {}

    def pairs(self) -> dict:
        """coin -> what the sender needs to know about its rupiah market. Kept for an hour."""
        now = self.clock()
        if self._pairs is not None and now - self._pairs_at < PAIRS_CACHE_SECONDS:
            return self._pairs
        raw = self.public("/api/pairs")
        if not isinstance(raw, list):
            raise ExchangeError("Indodax's pair list could not be read")
        pairs = {}
        for item in raw:
            if not isinstance(item, dict) or str(item.get("base_currency") or "").lower() != "idr":
                continue
            coin = str(item.get("traded_currency") or "").lower()
            pair_id = str(item.get("id") or "")
            ticker_id = str(item.get("ticker_id") or "")
            if not coin.isalnum() or not pair_id.isalnum() or not ticker_id.replace("_", "").isalnum():
                continue
            pairs[coin] = {
                "coin": coin,
                "id": pair_id,
                "ticker_id": ticker_id,
                "min_idr": number(item.get("trade_min_base_currency")),
                "min_coin": number(item.get("trade_min_traded_currency")),
                "fee_percent": number(item.get("trade_fee_percent_taker"), FEE_PERCENT_DEFAULT),
                "increment": str(item.get("quantity_increment") or SMALLEST_STEP),
                "blocked": truthy(item.get("is_maintenance") or 0) or truthy(item.get("is_market_suspended") or 0),
            }
        if not pairs:
            raise ExchangeError("Indodax's pair list came back empty")
        self._pairs = pairs
        self._pairs_at = now
        return pairs

    def ticker(self, pair_id: str) -> dict:
        """The best prices right now: bid is what buyers pay, ask is what sellers want."""
        answer = self.public("/api/ticker/" + pair_id)
        ticker = answer.get("ticker") if isinstance(answer, dict) else None
        if not isinstance(ticker, dict):
            raise ExchangeError("Indodax gave no price")
        bid = number(ticker.get("buy"))
        ask = number(ticker.get("sell"))
        if bid <= 0 or ask < bid:
            raise ExchangeError("Indodax gave no usable price")
        return {"bid": bid, "ask": ask}

    def balances(self) -> dict:
        """Free balances only: {"idr": ..., "btc": ...}.

        Indodax's answer also carries the account's name, email, user id and deposit addresses.
        They are dropped right here, so nothing after this line can store, print or send them.
        """
        answer = self.private("getInfo")
        raw = answer.get("balance")
        if not isinstance(raw, dict):
            raise ExchangeError("Indodax's answer held no balances")
        return {str(name).lower(): number(amount) for name, amount in raw.items()}

    def trade(self, ticker_id: str, side: str, idr=None, coin: str = "", quantity: str = "", client_order_id: str = "") -> dict:
        """One market order: a buy for a rupiah amount, or a sale of a coin amount."""
        params = [("pair", ticker_id), ("type", side), ("order_type", "market")]
        if side == "buy":
            params.append(("idr", int(idr)))
        elif side == "sell":
            params.append((coin, quantity))
        else:
            raise ExchangeError("Only buy and sell exist")
        params.append(("client_order_id", client_order_id))
        answer = self.private("trade", params, writes=True)
        # Only amounts are kept from the answer.
        return {name: value for name, value in answer.items() if name.startswith(("receive_", "spend_", "remain_")) or name == "fee"}


# ---------------------------------------------------------------- the sender


def fresh_state() -> dict:
    return {
        "bought": {},
        "positions": {},
        "tripped": "",
        "day": {"date": "", "practice": 0.0, "real": 0.0, "buys": 0},
        "result": {"practice": 0.0, "real": 0.0},
        "closed": [],
    }


def load_state(path) -> dict:
    """The sender's memory. A missing file is a fresh start; a damaged one stops the sender."""
    state = fresh_state()
    target = Path(path)
    if not target.exists():
        return state
    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = None
    if not isinstance(raw, dict):
        # Guessing here could forget a real copy or buy the same signal twice.
        raise StateError(f"{target.name} is damaged. Look at your Indodax account, then rename or remove the file to start fresh.")
    for name in ("bought", "positions"):
        if isinstance(raw.get(name), dict):
            state[name] = raw[name]
    state["tripped"] = clip(raw.get("tripped"), 300)
    if isinstance(raw.get("closed"), list):
        state["closed"] = raw["closed"][-CLOSED_KEPT:]
    day = raw.get("day") if isinstance(raw.get("day"), dict) else {}
    state["day"] = {
        "date": str(day.get("date") or ""),
        "practice": number(day.get("practice")),
        "real": number(day.get("real")),
        "buys": int(number(day.get("buys"))),
    }
    result = raw.get("result") if isinstance(raw.get("result"), dict) else {}
    state["result"] = {"practice": number(result.get("practice")), "real": number(result.get("real"))}
    return state


def save_state(path, state: dict) -> None:
    target = Path(path)
    draft = target.with_suffix(target.suffix + ".tmp")
    draft.write_text(json.dumps(state, indent=2), encoding="utf-8")
    draft.replace(target)


class Bridge:
    def __init__(self, exchange, settings: Settings, api, state_path, log=print, clock=time.time):
        self.exchange = exchange
        self.settings = settings
        self.api = api
        self.state_path = state_path
        self.log = log
        self.clock = clock
        self.state = load_state(state_path)
        self.prices = {}  # coin -> this cycle's prices, or None when Indodax gave none

    # ---- small things

    def now_ms(self) -> int:
        return int(self.clock() * 1000)

    def save(self) -> None:
        save_state(self.state_path, self.state)

    def roll_day(self, write: bool = True) -> None:
        """The daily limits start again at midnight UTC (07:00 in Jakarta)."""
        today = time.strftime("%Y-%m-%d", time.gmtime(self.clock()))
        if self.state["day"].get("date") != today:
            self.state["day"] = {"date": today, "practice": 0.0, "real": 0.0, "buys": 0}
            if write:
                self.save()

    def trip(self, reason: str) -> None:
        """The safety stop: no new real buys until a person has looked and run --clear."""
        if not self.state["tripped"]:
            self.state["tripped"] = clip(reason, 300)
        self.save()
        self.log(f"SAFETY STOP: {reason} No new real buys until you have looked and run:  python bridge.py --clear")

    def clear_trip(self) -> str:
        reason = self.state["tripped"]
        self.state["tripped"] = ""
        self.save()
        return reason

    def remember(self, symbol: str, signal) -> None:
        """Written before a buy goes out, so a crash or a lost answer can never buy the same signal twice."""
        self.state["bought"][symbol] = {"signal": signal, "at": self.now_ms()}
        self.state["day"]["buys"] = int(self.state["day"].get("buys") or 0) + 1
        self.save()

    def price(self, coin: str, pairs: dict):
        if coin not in self.prices:
            pair = pairs.get(coin)
            try:
                self.prices[coin] = self.exchange.ticker(pair["id"]) if pair else None
            except ExchangeError:
                self.prices[coin] = None
        return self.prices[coin]

    def free_balances(self):
        try:
            return self.exchange.balances()
        except ExchangeError:
            return None

    # ---- reading TradeBot

    def wanted(self, signals: dict) -> dict:
        """TradeBot's symbol -> { coin, signal } for each coin its practice account holds."""
        wanted = {}
        for item in signals.get("wanted") or []:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or "").upper()
            signal = int(number(item.get("openedAt")))
            coin = symbol[:-4].lower() if symbol.endswith("USDT") else ""
            # No start time means no order name that is safe against a second buy, so it is skipped.
            if coin and coin.isalnum() and signal > 0:
                wanted[symbol] = {"coin": coin, "signal": signal}
        return wanted

    # ---- deciding (nothing here sends an order or touches the private API)

    def plan(self, wanted: dict, fresh: bool, pairs: dict):
        """What to sell and buy. Returns (actions, notes)."""
        actions, notes = [], []
        positions = self.state["positions"]
        stop = self.settings.stop_percent

        for symbol, position in positions.items():
            coin = position["coin"]
            if fresh and symbol not in wanted:
                actions.append({"do": "sell", "symbol": symbol, "coin": coin, "reason": "TradeBot no longer holds it"})
                continue
            ticker = self.price(coin, pairs)
            if ticker is None:
                notes.append(f"{coin.upper()}: Indodax gave no price, so its stop could not be checked this minute.")
                continue
            if ticker["bid"] <= position["price"] * (1 - stop / 100):
                reason = f"its price fell {stop:g}% below what was paid (the sender's own stop)"
                actions.append({"do": "sell", "symbol": symbol, "coin": coin, "reason": reason})

        real = self.settings.real
        mode = "real" if real else "practice"
        amount = self.settings.order_idr
        block = ""
        if real and self.state["tripped"]:
            block = "The safety stop is on, so nothing new is bought. Look at Indodax, then run:  python bridge.py --clear"
        elif self.state["day"][mode] <= -amount:
            block = f"Today's loss has reached one order's size ({rp(amount)}), so nothing more is bought today."

        # A copy that is being sold still counts as open here: its place is free from the next minute.
        open_count = len(positions)
        buys = int(self.state["day"].get("buys") or 0)
        for symbol, item in wanted.items():
            coin = item["coin"]
            name = coin.upper()
            if symbol in positions:
                continue
            if self.settings.coins and coin not in self.settings.coins:
                continue
            memory = self.state["bought"].get(symbol)
            if memory and memory.get("signal") == item["signal"]:
                notes.append(f"{name} was already copied for this signal. It is not bought again until TradeBot gives a new one.")
                continue
            if block:
                if block not in notes:
                    notes.append(block)
                continue
            if buys >= MAX_BUYS_PER_DAY:
                notes.append(f"{name} is not copied: {MAX_BUYS_PER_DAY} buys were made today already.")
                continue
            if open_count >= self.settings.max_open:
                notes.append(f"{name} is not copied: {self.settings.max_open} copies are open already (INDODAX_MAX_OPEN).")
                continue
            pair = pairs.get(coin)
            if pair is None:
                notes.append(f"{name} is not traded against rupiah at Indodax.")
                continue
            if pair["blocked"]:
                notes.append(f"{name} is in maintenance or suspended at Indodax right now.")
                continue
            if amount < 2 * pair["min_idr"]:
                notes.append(f"{name} is not copied: the order size must be at least twice Indodax's smallest order ({rp(pair['min_idr'])}).")
                continue
            ticker = self.price(coin, pairs)
            if ticker is None:
                notes.append(f"{name}: Indodax gave no price right now.")
                continue
            spread = (ticker["ask"] - ticker["bid"]) / ticker["ask"] * 100
            if spread > MAX_SPREAD_PERCENT:
                notes.append(f"{name} is not copied: buyers and sellers are {spread:.2f}% apart (limit {MAX_SPREAD_PERCENT:g}%).")
                continue
            actions.append({"do": "buy", "symbol": symbol, "coin": coin, "signal": item["signal"], "real": real})
            open_count += 1
            buys += 1
        return actions, notes

    # ---- real orders

    def send_order(self, side: str, symbol: str, pair=None, idr=None, quantity=None, client_order_id: str = "") -> dict:
        """The only place a real order leaves from. Everything is checked again right before it goes."""
        positions = self.state["positions"]
        if not self.settings.has_keys:
            raise Refused("No Indodax API key is set, so no order was sent.")
        if not client_order_id:
            raise Refused("An order without its own name was stopped.")
        if side == "buy":
            if not self.settings.real:
                raise Refused("Real money is off, so no order was sent.")
            if self.state["tripped"]:
                raise Refused("The safety stop is on, so no order was sent.")
            if idr != self.settings.order_idr or not ORDER_IDR_MIN <= idr <= ORDER_IDR_CAP:
                raise Refused("An order of an unexpected size was stopped.")
            if symbol in positions:
                raise Refused("That coin is copied already.")
            if len(positions) >= self.settings.max_open:
                raise Refused("The most copies allowed are open already.")
            if not pair:
                raise Refused("That coin has no rupiah market.")
            return self.exchange.trade(pair["ticker_id"], "buy", idr=idr, client_order_id=client_order_id)
        if side == "sell":
            # Selling a copy that was bought for real stays possible in practice mode and under the
            # safety stop: closing only ever lowers what is at risk.
            position = positions.get(symbol)
            if not position or not position.get("real"):
                raise Refused("Only a copy this sender bought for real can be sold for real.")
            amount = Decimal(str(quantity or 0))
            if amount <= 0 or float(amount) > number(position.get("quantity")) * (1 + 1e-9):
                raise Refused("A sale larger than the copy was stopped.")
            return self.exchange.trade(position["pair"], "sell", coin=position["coin"], quantity=plain(amount), client_order_id=client_order_id)
        raise Refused("Only buy and sell exist.")

    # ---- acting

    def open_copy(self, symbol: str, pair: dict, quantity, spent, signal, real: bool) -> dict:
        position = {
            "pair": pair["ticker_id"],
            "coin": pair["coin"],
            "quantity": float(quantity),
            "spent": float(spent),
            "price": float(spent) / float(quantity),  # rupiah paid per coin, fee included
            "openedAt": signal,
            "at": self.now_ms(),
            "real": bool(real),
            "sells": 0,
        }
        self.state["positions"][symbol] = position
        self.save()
        return position

    def close_copy(self, symbol: str, received, how: str = "sold", estimated: bool = False) -> dict:
        position = self.state["positions"].pop(symbol)
        mode = "real" if position.get("real") else "practice"
        entry = {
            "symbol": symbol,
            "real": bool(position.get("real")),
            "spent": float(position["spent"]),
            "received": float(received),
            "at": self.now_ms(),
            "how": how,
        }
        if estimated:
            entry["estimated"] = True
        if how == "sold":
            profit = float(received) - float(position["spent"])
            self.state["result"][mode] += profit
            self.state["day"][mode] += profit
        self.state["closed"] = (self.state["closed"] + [entry])[-CLOSED_KEPT:]
        self.save()
        return entry

    def buy(self, action: dict, pairs: dict) -> str:
        symbol, coin = action["symbol"], action["coin"]
        name = coin.upper()
        pair = pairs.get(coin)
        ticker = self.price(coin, pairs)
        if not pair or not ticker:
            raise Refused(f"Indodax gave no price for {name}.")
        if action.get("real"):
            return self.buy_real(action, pair)
        amount = self.settings.order_idr
        quantity = floor_to(amount * (1 - pair["fee_percent"] / 100) / ticker["ask"], pair["increment"])
        if quantity <= 0:
            raise Refused(f"{rp(amount)} buys less than the smallest amount of {name}.")
        self.remember(symbol, action["signal"])
        self.open_copy(symbol, pair, quantity, amount, action["signal"], real=False)
        return f"PRACTICE: bought {plain(quantity)} {name} for {rp(amount)} of pretend money, at Indodax's real price."

    def buy_real(self, action: dict, pair: dict) -> str:
        symbol, coin = action["symbol"], action["coin"]
        name = coin.upper()
        amount = self.settings.order_idr
        if self.state["tripped"]:
            # Stopped here, before the signal is marked as used: it can be copied after --clear.
            raise Refused("The safety stop is on, so no order was sent.")
        try:
            before = self.exchange.balances()
        except ExchangeError as error:
            raise Refused(f"The balance could not be read ({error}), so no order was sent.") from None
        if before.get("idr", 0.0) < amount:
            raise Refused(f"There is not enough free rupiah at Indodax for a {rp(amount)} order.")

        self.remember(symbol, action["signal"])
        answer = None
        try:
            answer = self.send_order("buy", symbol, pair=pair, idr=amount, client_order_id=order_name(coin, action["signal"], "b"))
        except ExchangeError as error:
            if not error.unsure:
                self.trip(f"Indodax refused the buy of {name} ({error}).")
                raise Refused(f"Indodax refused the buy ({error}).") from None

        after = self.free_balances()
        gain = after.get(coin, 0.0) - before.get(coin, 0.0) if after else 0.0
        told = number(answer.get(f"receive_{coin}")) if answer else 0.0
        # The smaller of what the balance shows and what Indodax says: the copy is never overstated.
        amounts = [value for value in (gain, told) if value > 0]
        quantity = min(amounts) if amounts else 0.0

        if answer is None:
            if after is None:
                self.trip(f"The answer to the buy of {name} was lost and the balance could not be read. The order may have gone through: check Indodax by hand.")
                raise Refused("The buy could not be confirmed, and no copy was recorded.")
            if quantity <= 0:
                self.trip(f"The answer to the buy of {name} was lost and no {name} has arrived so far. Check your open orders at Indodax.")
                raise Refused("The buy could not be confirmed, and no copy was recorded.")
            self.trip(f"The answer to the buy of {name} was lost, but the coin arrived, so the copy is recorded.")
        elif quantity <= 0:
            self.trip(f"Indodax accepted the buy of {name} but no {name} arrived. Check your open orders at Indodax.")
            raise Refused("The buy was accepted but nothing arrived, and no copy was recorded.")

        drop = before.get("idr", 0.0) - after.get("idr", 0.0) if after else 0.0
        spent = drop if 0 < drop <= amount * 1.01 else amount
        self.open_copy(symbol, pair, quantity, spent, action["signal"], real=True)
        line = f"REAL MONEY: bought {plain(floor_to(quantity, SMALLEST_STEP))} {name} for {rp(spent)} at Indodax."
        if answer and number(answer.get("remain_rp")) > 0:
            line += f" Indodax reports {rp(answer.get('remain_rp'))} of the order as not filled: have a look at your open orders."
        return line

    def sell(self, symbol: str, reason: str, pairs: dict) -> str:
        position = self.state["positions"].get(symbol)
        if not position:
            raise Refused("That copy is closed already.")
        coin = position["coin"]
        name = coin.upper()
        pair = pairs.get(coin)
        ticker = self.price(coin, pairs)
        if position.get("real"):
            return self.sell_real(symbol, reason, pair, ticker)
        if not pair or not ticker:
            raise Refused(f"Indodax gave no price for {name}. Trying again next minute.")
        received = position["quantity"] * ticker["bid"] * (1 - pair["fee_percent"] / 100)
        entry = self.close_copy(symbol, received)
        result = signed_rp(entry["received"] - entry["spent"])
        return f"PRACTICE: sold {name} for {rp(received)} of pretend money ({result}) because {reason}."

    def settle(self, symbol: str, pair, ticker) -> str:
        """An earlier sale had no clear answer. The balance decides: "" means the coin is still there."""
        position = self.state["positions"][symbol]
        mark = position["unsure"]
        coin = position["coin"]
        name = coin.upper()
        try:
            now = self.exchange.balances()
        except ExchangeError as error:
            raise Refused(f"The earlier sale of {name} is still unconfirmed and the balance could not be read ({error}). Nothing was sent.") from None
        gone = number(mark.get("coin")) - now.get(coin, 0.0)
        if gone < number(mark.get("quantity")) * 0.5:
            del position["unsure"]
            self.save()
            return ""
        gain = now.get("idr", 0.0) - number(mark.get("idr"))
        estimated = gain <= 0
        if estimated:
            fee = pair["fee_percent"] if pair else FEE_PERCENT_DEFAULT
            gain = number(mark.get("quantity")) * (ticker["bid"] if ticker else position["price"]) * (1 - fee / 100)
        entry = self.close_copy(symbol, gain, estimated=estimated)
        about = "about " if estimated else ""
        return f"REAL MONEY: the earlier sale of {name} went through for {about}{rp(gain)} ({signed_rp(entry['received'] - entry['spent'])})."

    def sell_real(self, symbol: str, reason: str, pair, ticker) -> str:
        position = self.state["positions"][symbol]
        coin = position["coin"]
        name = coin.upper()
        if not self.settings.has_keys:
            raise Refused(f"{name} was bought with real money but the API key is gone. Put the key back, or sell it by hand at Indodax.")
        if position.get("unsure"):
            settled = self.settle(symbol, pair, ticker)
            if settled:
                return settled
        if not pair or not ticker:
            raise Refused(f"Indodax gave no price for {name}. Trying again next minute.")
        try:
            before = self.exchange.balances()
        except ExchangeError as error:
            raise Refused(f"The balance could not be read ({error}), so the sale of {name} was not sent. Trying again next minute.") from None

        # Never more than the copy, and never more than what is really there.
        free = before.get(coin, 0.0)
        quantity = floor_to(min(position["quantity"], free), pair["increment"])
        if quantity <= 0:
            self.close_copy(symbol, 0, how="gone")
            return f"REAL MONEY: {name} is no longer in the Indodax account (sold or moved by hand?). The copy is closed without a result."
        if float(quantity) * ticker["bid"] < pair["min_idr"] or float(quantity) < pair["min_coin"]:
            self.close_copy(symbol, 0, how="left")
            return f"REAL MONEY: what is left of {name} is below Indodax's smallest order, so it stays in your account. The copy is closed without a result."

        attempt = int(position.get("sells") or 0)
        answer = None
        try:
            answer = self.send_order("sell", symbol, quantity=quantity, client_order_id=order_name(coin, position["openedAt"], f"s{attempt}"))
        except ExchangeError as error:
            if not error.unsure:
                if "exist" in str(error).lower() and "order" in str(error).lower():
                    # Indodax already has an order with this name: an earlier try did arrive.
                    estimate = float(quantity) * ticker["bid"] * (1 - pair["fee_percent"] / 100)
                    self.close_copy(symbol, estimate, estimated=True)
                    self.trip(f"The sale of {name} had already reached Indodax. Its result is an estimate: check it at Indodax.")
                    return f"REAL MONEY: {name} was sold already, for about {rp(estimate)}."
                position["sells"] = attempt + 1  # a refused order's name is not used again
                self.save()
                self.trip(f"Indodax refused the sale of {name} ({error}).")
                raise Refused(f"Indodax refused the sale ({error}). Trying again next minute.") from None

        after = self.free_balances()
        gain = after.get("idr", 0.0) - before.get("idr", 0.0) if after else 0.0
        told = number(answer.get("receive_rp")) if answer else 0.0
        received = gain if gain > 0 else told
        if answer is not None and received > 0:
            entry = self.close_copy(symbol, received)
            line = f"REAL MONEY: sold {name} for {rp(received)} ({signed_rp(entry['received'] - entry['spent'])}) because {reason}."
            if after and free - after.get(coin, 0.0) < float(quantity) * 0.99:
                line += f" Only part of it was sold: some {name} is left in your account."
            return line

        # No clear answer, or no rupiah seen yet. The same order name is kept, so Indodax itself
        # refuses a second sale, and the balance settles it next minute.
        position["unsure"] = {"coin": free, "idr": before.get("idr", 0.0), "quantity": float(quantity), "at": self.now_ms()}
        self.save()
        self.trip(f"The sale of {name} could not be confirmed. It is checked against your balance next minute.")
        raise Refused(f"The sale of {name} could not be confirmed yet. Nothing is sold twice.")

    def do(self, action: dict, pairs: dict) -> str:
        """Carry out one planned action. Returns a line for the log; raises Refused when it did not happen."""
        if action["do"] == "sell":
            return self.sell(action["symbol"], action["reason"], pairs)
        if action["do"] == "buy":
            return self.buy(action, pairs)
        raise Refused("That is not something the sender does.")

    def _run(self, actions: list, pairs: dict, notes: list) -> None:
        for action in actions:
            try:
                self.log(self.do(action, pairs))
            except (Refused, ExchangeError) as refusal:
                notes.append(f"{action['coin'].upper()}: the {action['do']} did not happen. {refusal}")

    def forget(self, wanted: dict) -> None:
        """Drop the memory of buys whose signal is over, so a new signal can be copied again."""
        gone = [symbol for symbol in self.state["bought"] if symbol not in wanted]
        for symbol in gone:
            del self.state["bought"][symbol]
        if gone:
            self.save()

    # ---- reporting

    def report_of(self, notes: list) -> dict:
        """What TradeBot is told. Amounts of the copies only: no name, email, address or balance."""
        positions = []
        for symbol, position in self.state["positions"].items():
            ticker = self.prices.get(position["coin"])
            bid = ticker["bid"] if ticker else 0.0
            positions.append(
                {
                    "symbol": symbol,
                    "pair": position["pair"],
                    "real": bool(position.get("real")),
                    "quantity": position["quantity"],
                    "spent": position["spent"],
                    "price": position["price"],
                    "now": bid,
                    "value": position["quantity"] * bid,
                    "openedAt": position["at"],
                }
            )
        day = self.state["day"]
        return {
            "mode": "real" if self.settings.real else "practice",
            "keys": self.settings.has_keys,
            "tripped": bool(self.state["tripped"]),
            "trippedWhy": self.state["tripped"],
            "orderIdr": self.settings.order_idr,
            "maxOpen": self.settings.max_open,
            "stopPercent": self.settings.stop_percent,
            "positions": positions,
            "closed": self.state["closed"][-5:],
            "result": dict(self.state["result"]),
            "today": {"practice": day["practice"], "real": day["real"], "buys": day["buys"]},
            "notes": [clip(note, 300) for note in notes[:5]],
        }

    # ---- one cycle

    def cycle(self, show: bool = False) -> dict:
        """Read, decide, act, report. With show=True it only prints what it would do."""
        notes = []
        self.prices = {}
        self.roll_day(write=not show)

        signals = None
        try:
            signals = self.api.signals()
        except ApiError as error:
            notes.append(f"{error}. Nothing is bought; open copies are watched by the sender's own stop.")
        fresh = bool(isinstance(signals, dict) and signals.get("fresh"))
        if signals is not None and not fresh:
            notes.append("TradeBot's last round is too old to act on. Nothing is bought; open copies are watched by the sender's own stop.")
        wanted = self.wanted(signals) if fresh else {}

        try:
            pairs = self.exchange.pairs()
        except ExchangeError as error:
            pairs = None
            notes.append(f"Indodax's pair list could not be read ({error}). No orders this minute.")

        if pairs is not None:
            actions, plan_notes = self.plan(wanted, fresh, pairs)
            notes.extend(plan_notes)
            if show:
                self.log("Would do: " + (json.dumps(actions) if actions else "nothing"))
            else:
                self._run(actions, pairs, notes)
                if fresh:
                    self.forget(wanted)

        for note in notes:
            self.log(note)
        report = self.report_of(notes)
        if show:
            self.log("Would report: " + json.dumps(report))
            return report
        try:
            self.api.report(report)
        except ApiError as error:
            self.log(f"The report was not delivered: {error}")
        return report


# ---------------------------------------------------------------- running it


def stamp(text: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {text}", flush=True)


def check(settings: Settings, exchange=None) -> int:
    """Does the API key work? Reads the balance and orders nothing."""
    if not settings.has_keys:
        print("INDODAX_API_KEY and INDODAX_API_SECRET are not set, so there is nothing to check. Practice mode does not need them.")
        return 1
    try:
        balances = (exchange or Indodax(settings)).balances()
    except ExchangeError as error:
        print(f"The API key does not work yet: {error}")
        return 1
    print(f"The API key works. Free rupiah at Indodax: {rp(balances.get('idr', 0.0))}. Nothing was ordered.")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="TradeBot's Indodax sender (practice by default).")
    parser.add_argument("--show", action="store_true", help="print what it would do: no orders, no report")
    parser.add_argument("--once", action="store_true", help="one cycle, then stop")
    parser.add_argument("--check", action="store_true", help="test the API key: prints the free rupiah, orders nothing")
    parser.add_argument("--clear", action="store_true", help="clear the safety stop after you have looked at Indodax")
    parser.add_argument("--env", default=str(HERE / ".env"), help="the settings file (default: .env next to this script)")
    parser.add_argument("--state", default=str(HERE / "bridge_state.json"), help=argparse.SUPPRESS)
    args = parser.parse_args(argv)

    try:
        settings = load_settings(args.env)
    except SettingsError as error:
        print(f"Settings: {error}")
        return 2

    if args.check:
        return check(settings)

    try:
        bridge = Bridge(Indodax(settings), settings, Api(settings), args.state, log=stamp)
    except StateError as error:
        print(f"State: {error}")
        return 2

    if args.clear:
        reason = bridge.clear_trip()
        print(f"The safety stop is cleared. It was: {reason}" if reason else "The safety stop was not on.")
        return 0
    if not settings.key:
        print("The Indodax sender is off: INDODAX_BRIDGE_KEY is empty. Nothing was started. The README says how to switch it on.")
        return 0

    if settings.real:
        mode = f"REAL MONEY: orders of {rp(settings.order_idr)} are sent to Indodax, at most {settings.max_open} open."
    else:
        mode = "PRACTICE: pretend money at Indodax's real prices. No order is sent to Indodax."
    try:
        if args.show or args.once:
            stamp(mode)
            bridge.cycle(show=args.show)
            return 0
        stamp(f"Indodax sender running, one cycle every {CYCLE_SECONDS} seconds. {mode} Ctrl+C stops it; open copies stay as they are.")
        while True:
            try:
                bridge.cycle()
            except Exception as error:  # noqa: BLE001 (one bad cycle must not end the loop)
                stamp(f"This cycle failed ({type(error).__name__}). Trying again next minute.")
            time.sleep(CYCLE_SECONDS)
    except KeyboardInterrupt:
        stamp("Stopped. Copies stay as they are; coins bought with real money stay in your Indodax account.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
