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
  * A real buy also waits until  python bridge.py --check  has passed with the API key that is set.
  * One order is a fixed rupiah amount with a hard ceiling, at most three copies are open, and
    buying stops for the day after a loss of one order's size or after ten buys.
  * /indodax pause in Telegram stops new buys; selling and the stop go on. /indodax resume ends it.
  * Anything unclear (an answer that got lost, a refusal, a coin that did not arrive) stops new real
    buys until you have looked and run  python bridge.py --clear
  * It never withdraws: make the API key with "view" and "trade" only.
  * It keeps only your balances from Indodax's answer. Your name, email, user id and deposit
    addresses are never stored, printed or sent anywhere.
  * With INDODAX_REPORT_CASH=yes (off unless you set it) the report to TradeBot also says how
    much free rupiah the account has, so the daily report, the phone page and the desktop app can
    show it. No other balance is ever sent.

    python bridge.py --show     what it would do right now (no orders, no report)
    python bridge.py --check    does the API key work? prints the free rupiah, orders nothing
    python bridge.py --once     one cycle
    python bridge.py            keep going, one cycle a minute
    python bridge.py --clear    clear the safety stop after you have looked
    python bridge.py --log desk_sender.log   keep going with no window: its lines go to that file

Only one sender runs on a PC: a second one says so and ends without doing anything.

While it runs it also starts learn.py (in this folder) every four hours and after each buy or
sale: a study of the rules on the newest prices. The study never orders and changes nothing
here; its short result goes into the report (/learn in Telegram).

It speaks Indodax's Trade API 2.0, which the API keys made today need. A key made for the older
Trade API needs INDODAX_API_VERSION=1 in the .env.

No real order has been sent to a real Indodax account yet: the tests use a pretend exchange.
Only reading the balance through Trade API 2.0 has been tried against the real one.
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
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field, replace
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from pathlib import Path

CLIENT = "juw12-trade-indodax/1.0"  # how the sender names itself (Indodax turns away names with "bot")
INDODAX = "https://indodax.com"  # fixed on purpose: the API key can never be sent anywhere else
INDODAX_V2 = "https://api.indodax.com"  # Trade API 2.0, fixed for the same reason
DEFAULT_URL = "https://trade-bot.juw12.workers.dev"
CYCLE_SECONDS = 60
ONE_SENDER_PORT = 47632  # held on 127.0.0.1 while a sender keeps running, so a second one cannot start
ALREADY_RUNNING = 3  # the exit code of a sender that found another one running
LOG_FILE_BYTES = 1_000_000
# Inside TradeBot.exe (the desk, this sender and the study in one file) the folder is the exe's own.
FROZEN = bool(getattr(sys, "frozen", False))
HERE = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent

REAL_CONFIRM = "I accept real money on Indodax"
ORDER_IDR_DEFAULT = 50_000
ORDER_IDR_MIN = 20_000
ORDER_IDR_CAP = 500_000  # one order is never larger than this, whatever the .env says
ORDER_IDR_STEP = 1_000  # a grown order is rounded down to this (INDODAX_ORDER_GROW)
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
LEARN_EVERY_SECONDS = 4 * 3600  # the study (learn.py) runs again when its last result is this old
LEARN_RETRY_SECONDS = 30 * 60  # and is not started more often than this
SMALLEST_STEP = "0.00000001"
ORDER_STATES = ("open", "filled", "cancelled")  # what Indodax can say became of an order
ORDER_STATES_V2 = {  # Trade API 2.0's words for the same three
    "NEW": "open",
    "PARTIALLY_FILLED": "open",
    "FILLED": "filled",
    "CANCELLED": "cancelled",
    "CANCELED": "cancelled",
    "REJECTED": "cancelled",
    "EXPIRED": "cancelled",
}
FILL_WAITS = (0.3, 0.7, 1.0, 2.0)  # seconds between looks for an accepted order's trades
API_RETRY_PAUSES = (1, 4)  # seconds before the second and the third try at TradeBot's server
API_RETRY_WINDOW = 12  # no further try is started later than this many seconds after the first began


class SettingsError(Exception):
    """The .env holds something the sender cannot use."""


class StateError(Exception):
    """The state file is there but cannot be read."""


class ApiError(Exception):
    """TradeBot's server could not be asked or did not accept the answer."""


class ExchangeError(Exception):
    """Indodax could not be asked, or said no. unsure=True: the request may still have arrived.
    unsent=True: it is certain that it did not, because it never left this PC."""

    def __init__(self, message: str, unsure: bool = False, code: str = "", taken=None, unsent: bool = False):
        super().__init__(message)
        self.unsure = unsure and not unsent
        self.code = code
        self.taken = taken  # True/False when it is known whether the order's name was used before
        self.unsent = unsent


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


def sale_proceeds(order) -> float:
    """The rupiah a sale brought in, as Indodax's record of the order gives it. 0 when it gives none."""
    if not order:
        return 0.0
    return number(order.get("receive_idr")) or number(order.get("receive_rp"))


def untouched(order, coin: str) -> bool:
    """True when a sale order still holds all of the coin it was for: none of it was sold."""
    asked = number(order.get(f"order_{coin}"))
    left = number(order.get(f"remain_{coin}"))
    return asked > 0 and left >= asked * 0.999


def sign(body: str, secret: str) -> str:
    """HMAC-SHA512 of the exact request body, as Indodax's private API asks for."""
    return hmac.new(secret.encode("utf-8"), body.encode("utf-8"), hashlib.sha512).hexdigest()


def sign_v2(payload: str, secret: str) -> str:
    """HMAC-SHA256 of the exact query string or body, as Indodax's Trade API 2.0 asks for."""
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def name_taken(error) -> bool:
    """True when Indodax refused an order because it already has one with the same name."""
    if error.taken is not None:
        return bool(error.taken)
    words = str(error).lower()
    return "exist" in words and "order" in words


def key_mark(api_key) -> str:
    """A short fingerprint of the API key: enough to notice a changed key, useless for anything else."""
    return hashlib.sha256(("indodax-check:" + str(api_key or "")).encode("utf-8")).hexdigest()[:12]


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
    spare_proxy: str = field(default="", repr=False)  # the PC's own HTTPS_PROXY, when the .env names another
    api_version: int = 2  # 2 = Trade API 2.0 (the keys Indodax makes now), 1 = the older Trade API
    report_cash: bool = False  # also tell TradeBot the free rupiah (INDODAX_REPORT_CASH=yes)
    order_grow: bool = False  # an order grows by what the sender has won so far (INDODAX_ORDER_GROW=yes)

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

    version_text = (values.get("INDODAX_API_VERSION") or "").strip()
    if version_text not in ("", "1", "2"):
        raise SettingsError("INDODAX_API_VERSION must be 2 (Trade API 2.0, the default) or 1 (the older Trade API).")

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
        api_version=int(version_text or 2),
        report_cash=truthy(values.get("INDODAX_REPORT_CASH") or ""),
        order_grow=truthy(values.get("INDODAX_ORDER_GROW") or ""),
    )
    if mode == "real":
        if not settings.confirmed:
            raise SettingsError(f'INDODAX_MODE=real also needs INDODAX_REAL_CONFIRM set to exactly: {REAL_CONFIRM}')
        if not settings.has_keys:
            raise SettingsError("INDODAX_MODE=real also needs INDODAX_API_KEY and INDODAX_API_SECRET.")
    return settings


def load_settings(env_path, environ=None) -> Settings:
    """The .env next to the script, with the process environment's INDODAX_ values on top.

    The proxy is the other way round: the one the .env names is used first, because it was chosen
    for this sender, and the PC's own HTTPS_PROXY (set for every program) is kept as the spare.
    Without one in the .env, the PC's own is used."""
    values = read_env_file(env_path)
    file_proxy = (values.get("HTTPS_PROXY") or values.get("https_proxy") or "").strip()
    pc_proxy = ""
    for name, value in (os.environ if environ is None else environ).items():
        if name.startswith("INDODAX_"):
            values[name] = value
        elif name.upper() == "HTTPS_PROXY":
            pc_proxy = (value or "").strip() or pc_proxy
    if not file_proxy:
        values["HTTPS_PROXY"] = pc_proxy
    settings = settings_from(values)
    if file_proxy and pc_proxy and pc_proxy != file_proxy:
        settings.spare_proxy = pc_proxy
    return settings


PROXY_TEST_SECONDS = 1.0  # per address tried; a local proxy that is down costs about two of these


def proxy_answers(proxy: str, connect=socket.create_connection) -> bool:
    """Does something listen where this proxy should be? Only a connection is opened; nothing is sent."""
    try:
        parts = urllib.parse.urlsplit(proxy if "://" in proxy else "http://" + proxy)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        if not parts.hostname:
            return False
        connect((parts.hostname, port), PROXY_TEST_SECONDS).close()
        return True
    except (OSError, ValueError):
        return False


def reachable(settings: Settings, connect=socket.create_connection) -> Settings:
    """The same settings with the proxy that answers in front.

    A PC can name one proxy in its own HTTPS_PROXY and the .env another. The .env one goes first,
    but when it is down and the PC's one answers, the two change places. With one proxy, or when
    neither answers, nothing changes and nothing is tested."""
    if not settings.spare_proxy or not settings.proxy:
        return settings
    if proxy_answers(settings.proxy, connect) or not proxy_answers(settings.spare_proxy, connect):
        return settings
    return replace(settings, proxy=settings.spare_proxy, spare_proxy=settings.proxy)


def proxy_opener(proxy: str):
    handlers = [urllib.request.ProxyHandler({"https": proxy})] if proxy else []
    return urllib.request.build_opener(*handlers)


def why_unreached(error) -> str:
    """The kind of network problem, in fixed words: the request and its key can never be in them."""
    kind = type(error).__name__
    reason = getattr(error, "reason", None)
    refused = re.search(r"Tunnel connection failed: (\d{3})\b", str(reason)) if reason is not None else None
    if refused:
        return f"{kind}, the proxy answered {refused.group(1)}"
    if isinstance(reason, Exception):
        return f"{kind}, {type(reason).__name__}"
    return kind


def never_sent(error) -> bool:
    """True only when the proxy refused to open the way to the site (a 407, for one).

    Python asks the proxy for that way first and sends the request only once it is open. So after
    this refusal not one byte of the request, an order included, has left this PC. A timeout, a
    dropped connection or anything else is never called this: there the request may have arrived."""
    reason = getattr(error, "reason", None)
    return isinstance(error, urllib.error.URLError) and isinstance(reason, OSError) and str(reason).startswith("Tunnel connection failed: ")


# ---------------------------------------------------------------- TradeBot's server


class Api:
    """The two calls the sender makes to TradeBot: read the signals, post the report.

    A call that does not get through is tried twice more after short waits. The second try goes
    through the PC's other proxy when it has two: measured on an office network, the proxy in use
    refused now and then for a few seconds (407) while the other one answered. Both calls are safe
    to repeat: one only reads, and TradeBot compares each report with the one it has, so a report
    that arrives twice is told once."""

    def __init__(self, settings: Settings, timeout: int = 20, log=None, sleep=time.sleep, clock=time.monotonic):
        self.settings = settings
        self.timeout = timeout
        self.log = log or (lambda line: None)
        self.sleep = sleep
        self.clock = clock
        self.use_proxy(settings.proxy)

    def use_proxy(self, proxy: str) -> None:
        self.opener = proxy_opener(proxy)
        other = self.settings.spare_proxy
        self.spare = proxy_opener(other) if other and other != proxy else None

    def _call(self, path: str, payload=None) -> dict:
        headers = {"X-Indodax-Key": self.settings.key, "User-Agent": CLIENT, "Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        started = self.clock()
        first = ""
        for turn in range(len(API_RETRY_PAUSES) + 1):
            last = turn == len(API_RETRY_PAUSES)
            opener = self.spare if turn == 1 and self.spare else self.opener
            # A new request for each try: one that went through a proxy once is not sent as it was again.
            request = urllib.request.Request(self.settings.url + path, data=data, headers=dict(headers), method="POST" if data else "GET")
            try:
                with opener.open(request, timeout=self.timeout) as response:
                    answer = json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                hint = " (is INDODAX_BRIDGE_KEY the key from the setup?)" if error.code == 403 else ""
                raise ApiError(f"TradeBot answered HTTP {error.code}{hint}") from None
            except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as error:
                # Only the kind of problem is kept: the request and its key never reach a log.
                why = why_unreached(error)
                first = first or why
                # A try that hung is not followed by more: the sender's own stop must not wait for them.
                if last or self.clock() - started + API_RETRY_PAUSES[turn] > API_RETRY_WINDOW:
                    tries = f", {turn + 1} tries" if turn else ""
                    raise ApiError(f"TradeBot could not be reached ({why}{tries})") from None
                self.sleep(API_RETRY_PAUSES[turn])
                continue
            if turn:
                self.log(f"TradeBot answered on try {turn + 1} (the first try: {first}).")
            return answer

    def signals(self) -> dict:
        return self._call("/v1/indodax/signals")

    def report(self, payload: dict) -> dict:
        return self._call("/v1/indodax/report", payload)


# ---------------------------------------------------------------- Indodax


class Indodax:
    """Indodax's public data, and the three private calls the sender needs: balances, one order,
    and a look at what became of one of its own orders."""

    def __init__(self, settings: Settings, timeout: int = 20, clock=time.time, opener=None):
        self.settings = settings
        self.timeout = timeout
        self.clock = clock
        self.opener = proxy_opener(settings.proxy) if opener is None else opener
        self.offset_ms = 0
        self.synced_at = None
        self._pairs = None
        self._pairs_at = 0.0

    def use_proxy(self, proxy: str) -> None:
        self.opener = proxy_opener(proxy)

    def _send(self, request, writes: bool):
        """One request. `writes` says whether a lost answer could mean an order went through anyway.
        A request the proxy refused before it left this PC is told apart (unsent): it is never unsure."""
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                text = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raise ExchangeError(f"Indodax answered HTTP {error.code}", unsure=writes and error.code >= 500) from None
        except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
            # Only the kind of problem is kept: the request, its key and its signature never reach a log.
            raise ExchangeError(f"Indodax could not be reached ({why_unreached(error)})", unsure=writes, unsent=never_sent(error)) from None
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

    def order(self, client_order_id: str) -> dict:
        """What became of one order, found by the name the sender gave it. It only reads."""
        answer = self.private("getOrderByClientOrderId", [("client_order_id", client_order_id)])
        raw = answer.get("order")
        if not isinstance(raw, dict):
            raise ExchangeError("Indodax's answer held no order")
        if str(raw.get("client_order_id") or client_order_id) != client_order_id:
            raise ExchangeError("Indodax answered about a different order")
        status = str(raw.get("status") or "").lower()
        kept = {"status": "cancelled" if status == "canceled" else status, "side": str(raw.get("type") or "").lower()}
        # Only amounts are kept from the answer.
        for name, value in raw.items():
            if str(name).startswith(("receive_", "order_", "remain_")) and name != "order_id":
                kept[str(name)] = value
        return kept


class IndodaxV2(Indodax):
    """The same three private calls through Indodax's Trade API 2.0, which the keys made today need.

    Public data (pairs, prices, the clock) is read exactly as before. In 2.0 an accepted order is
    not yet a filled one, so what an order really did is read from the order's own trades.
    """

    def __init__(self, settings: Settings, timeout: int = 20, clock=time.time, opener=None, sleep=time.sleep):
        super().__init__(settings, timeout=timeout, clock=clock, opener=opener)
        self.sleep = sleep
        self.rights = {}  # what the key may do, as the last balance read said

    def _refusal(self, error, writes: bool) -> ExchangeError:
        """2.0 says why in the body of an error answer: {"code": -2010, "msg": "..."}."""
        answer = None
        try:
            answer = json.loads(error.read().decode("utf-8", "replace"))
        except (ValueError, OSError, AttributeError, http.client.HTTPException):
            pass
        code = clip(answer.get("code"), 12) if isinstance(answer, dict) else ""
        said = clip(answer.get("msg"), 160) if isinstance(answer, dict) else ""
        if code == "-1021":
            self.synced_at = None  # the timestamp was off: Indodax's clock is read again first
        if said:
            message = f"{self._clean(said)} (code {code})" if code else self._clean(said)
        else:
            message = f"Indodax answered HTTP {error.code}"
        return ExchangeError(message, unsure=writes and error.code >= 500, code=code, taken=False)

    def signed(self, verb: str, path: str, params=(), writes: bool = False):
        """One signed request. The signature covers the exact query string or body that is sent."""
        if not self.settings.has_keys:
            raise ExchangeError("INDODAX_API_KEY and INDODAX_API_SECRET are not set")
        self.sync_clock()
        timestamp = int(self.clock() * 1000) + self.offset_ms
        payload = urllib.parse.urlencode([*params, ("timestamp", timestamp), ("recvWindow", RECV_WINDOW_MS)])
        headers = {
            "X-APIKEY": self.settings.api_key,
            "Sign": sign_v2(payload, self.settings.api_secret),
            "User-Agent": CLIENT,
            "Accept": "application/json",
        }
        if verb == "GET":
            request = urllib.request.Request(f"{INDODAX_V2}{path}?{payload}", headers=headers, method="GET")
        else:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            request = urllib.request.Request(INDODAX_V2 + path, data=payload.encode("utf-8"), headers=headers, method="POST")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            raise self._refusal(error, writes) from None
        except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
            # Only the kind of problem is kept: the request, its key and its signature never reach a log.
            raise ExchangeError(f"Indodax could not be reached ({why_unreached(error)})", unsure=writes, unsent=never_sent(error)) from None
        try:
            answer = json.loads(body.decode("utf-8"))
        except ValueError:
            raise ExchangeError("Indodax's answer could not be read", unsure=writes) from None
        if isinstance(answer, dict) and "msg" in answer and number(answer.get("code")) < 0:
            code = clip(answer.get("code"), 12)
            raise ExchangeError(f"{self._clean(answer.get('msg'))} (code {code})", code=code, taken=False)
        return answer

    def balances(self) -> dict:
        """Free balances only: {"idr": ..., "btc": ...}.

        The answer also carries the account's user id. It is dropped right here, so nothing after
        this line can store, print or send it.
        """
        answer = self.signed("GET", "/api/v2/account")
        raw = answer.get("balances") if isinstance(answer, dict) else None
        if not isinstance(raw, list):
            raise ExchangeError("Indodax's answer held no balances")
        self.rights = {
            "trade": answer.get("canTrade"),
            "withdraw": truthy(answer.get("canWithdraw") or "") or truthy(answer.get("canWithdrawFiat") or ""),
        }
        balances = {}
        for item in raw:
            if isinstance(item, dict) and item.get("asset"):
                balances[str(item["asset"]).lower()] = number(item.get("free"))
        return balances

    def fills(self, symbol: str, client_order_id: str, waits=()):
        """The trades one of the sender's own orders made: a list (empty when it made none), or
        None when they could not be read. It only reads, and it never raises."""
        rows = None
        for pause in (0, *waits):
            if pause:
                self.sleep(pause)
            try:
                answer = self.signed("GET", "/api/v2/myTrades", [("symbol", symbol.lower()), ("clientOrderId", client_order_id)])
            except ExchangeError:
                continue
            data = answer.get("data") if isinstance(answer, dict) else None
            if not isinstance(data, list):
                continue
            # Only trades that carry this order's own name count, whatever else the answer holds.
            rows = [row for row in data if isinstance(row, dict) and str(row.get("clientOrderId") or "") == client_order_id]
            if rows:
                break
        return rows

    @staticmethod
    def _sums(rows, coin: str):
        """(coin, rupiah, rupiah fee) added up over an order's trades. The fee includes the tax."""
        quantity = sum(number(row.get("qty")) for row in rows)
        value = sum(number(row.get("quoteQty")) for row in rows)
        fee_idr = sum(number(row.get("commission")) for row in rows if str(row.get("commissionAsset") or "").lower() == "idr")
        fee_coin = sum(number(row.get("commission")) for row in rows if str(row.get("commissionAsset") or "").lower() == coin)
        return max(quantity - fee_coin, 0.0), value, fee_idr

    def _read_order(self, symbol: str, client_order_id: str) -> dict:
        raw = self.signed("GET", "/api/v2/order", [("symbol", symbol), ("origClientOrderId", client_order_id)])
        if not isinstance(raw, dict) or "status" not in raw:
            raise ExchangeError("Indodax's answer held no order")
        if str(raw.get("clientOrderId") or "") != client_order_id:
            raise ExchangeError("Indodax answered about a different order")
        return raw

    def _rejected(self, error: ExchangeError, symbol: str, client_order_id: str) -> ExchangeError:
        """Code -2010 covers too little balance, a broken rule, and an order name that was used
        before. Whether Indodax already has an order with this name tells them apart."""
        try:
            self._read_order(symbol, client_order_id)
        except ExchangeError as lookup:
            if lookup.code == "-2013":
                return error  # no order has this name: a plain refusal, and nothing was ordered
            # Not known either way: treated like a lost answer, so nothing is sent a second time.
            return ExchangeError(str(error), unsure=True, code=error.code)
        return ExchangeError(f"an order with this name already exists at Indodax: {error}", code=error.code, taken=True)

    def trade(self, ticker_id: str, side: str, idr=None, coin: str = "", quantity: str = "", client_order_id: str = "") -> dict:
        """One market order: a buy for a rupiah amount, or a sale of a coin amount.

        The answer holds what the order's trades show (receive_<coin> or receive_rp). When the
        trades cannot be read yet it is empty, and the caller goes by the balance alone.
        """
        symbol = ticker_id.replace("_", "").upper()
        coin = (coin or ticker_id.split("_")[0]).lower()
        params = [("symbol", symbol), ("side", side.upper()), ("type", "MARKET")]
        if side == "buy":
            params.append(("quoteOrderQty", int(idr)))
        elif side == "sell":
            params.append(("quantity", quantity))
        else:
            raise ExchangeError("Only buy and sell exist")
        params.append(("newClientOrderId", client_order_id))
        try:
            self.signed("POST", "/api/v2/order", params, writes=True)
        except ExchangeError as error:
            if error.unsure or error.code != "-2010":
                raise
            raise self._rejected(error, symbol, client_order_id) from None
        rows = self.fills(symbol, client_order_id, waits=FILL_WAITS)
        if not rows:
            return {}
        got, value, fee = self._sums(rows, coin)
        if side == "buy":
            return {f"receive_{coin}": got}
        return {"receive_rp": max(value - fee, 0.0)}

    def order(self, client_order_id: str) -> dict:
        """What became of one order, found by the name the sender gave it. It only reads."""
        parts = client_order_id.split("-")
        coin = parts[1] if len(parts) == 4 and parts[0] == "tb" else ""
        pair = self.pairs().get(coin) if coin else None
        if not pair:
            raise ExchangeError("That order name is not one the sender made")
        symbol = pair["ticker_id"].replace("_", "").upper()
        raw = self._read_order(symbol, client_order_id)
        side = str(raw.get("side") or "").lower()
        kept = {"status": ORDER_STATES_V2.get(str(raw.get("status") or "").upper(), ""), "side": side}
        asked = number(raw.get("origQty"))
        done = number(raw.get("executedQty"))
        rows = self.fills(symbol, client_order_id)
        got, value, fee = self._sums(rows or [], coin)
        # "Nothing of it was traded" is only said when the order and its (readable) trades agree.
        nothing_done = rows == [] and done == 0 and asked > 0
        if side == "sell":
            if rows:
                kept["receive_idr"] = max(value - fee, 0.0)
            if nothing_done:
                kept[f"order_{coin}"] = asked
                kept[f"remain_{coin}"] = asked
        elif side == "buy":
            if rows:
                kept[f"receive_{coin}"] = got
            if nothing_done:
                kept["order_idr"] = asked
                kept["remain_idr"] = asked
        return kept


def exchange_for(settings: Settings, **options):
    """The Indodax client that fits the key: Trade API 2.0 unless the .env asks for the older one."""
    return IndodaxV2(settings, **options) if settings.api_version == 2 else Indodax(settings, **options)


def version_hint(settings: Settings, error: ExchangeError) -> str:
    """One more sentence when a refusal looks like a key made for the other Trade API."""
    if settings.api_version == 2 and error.code == "-2015":
        return " If this key was made for the older Trade API, put INDODAX_API_VERSION=1 in the .env."
    if settings.api_version == 1 and "version" in str(error).lower():
        return " This key is for Trade API 2.0: take INDODAX_API_VERSION=1 out of the .env."
    return ""


# ---------------------------------------------------------------- the sender


def fresh_state() -> dict:
    return {
        "bought": {},
        "positions": {},
        "tripped": "",
        "day": {"date": "", "practice": 0.0, "real": 0.0, "buys": 0},
        "result": {"practice": 0.0, "real": 0.0},
        "closed": [],
        "checked": {"at": 0, "key": ""},
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
    checked = raw.get("checked") if isinstance(raw.get("checked"), dict) else {}
    state["checked"] = {"at": int(number(checked.get("at"))), "key": clip(checked.get("key"), 12)}
    return state


def save_state(path, state: dict) -> None:
    target = Path(path)
    draft = target.with_suffix(target.suffix + ".tmp")
    draft.write_text(json.dumps(state, indent=2), encoding="utf-8")
    draft.replace(target)


class Bridge:
    def __init__(self, exchange, settings: Settings, api, state_path, log=print, clock=time.time, study=None):
        self.exchange = exchange
        self.settings = settings
        self.api = api
        self.state_path = state_path
        self.log = log
        self.clock = clock
        self.state = load_state(state_path)
        self.prices = {}  # coin -> this cycle's prices, or None when Indodax gave none
        self.paused = False  # set from Telegram (/indodax pause); read again every cycle
        self.cash = None  # free rupiah at Indodax (real mode only); None when it was not read
        self.study = study  # starts learn.py and returns its process; None: no study is started
        self.studying = None
        self.study_tried = 0.0

    # ---- small things

    @property
    def checked(self) -> bool:
        """Has --check passed on this PC with the API key that is set now?"""
        return bool(self.settings.has_keys and self.state["checked"].get("key") == key_mark(self.settings.api_key))

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

    def take_back(self, symbol: str, earlier) -> None:
        """Undo remember(), only for a buy that is certain never to have left this PC."""
        if earlier is None:
            self.state["bought"].pop(symbol, None)
        else:
            self.state["bought"][symbol] = earlier
        self.state["day"]["buys"] = max(int(self.state["day"].get("buys") or 0) - 1, 0)
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

    def lookup(self, order_ref: str, side: str):
        """What Indodax says became of one of the sender's own orders, or None when that is not clear.

        None changes nothing: the caller goes on exactly as it would have without asking.
        """
        try:
            order = self.exchange.order(order_ref)
        except ExchangeError:
            return None
        if not isinstance(order, dict) or order.get("status") not in ORDER_STATES:
            return None
        if (order.get("side") or "") not in ("", side):
            return None
        return order

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

    def order_size(self, mode: str) -> int:
        """The rupiah of the next order in this mode ("practice" or "real").

        Normally the set size (INDODAX_ORDER_IDR). With INDODAX_ORDER_GROW=yes it is the set size plus what
        this mode has won so far, rounded down to a whole ORDER_IDR_STEP: a bigger order is paid for by
        earlier wins only. After losses it comes back down, never under the set size, and it is never over
        ORDER_IDR_CAP. Practice and real money each count their own result."""
        base = self.settings.order_idr
        if not self.settings.order_grow:
            return base
        try:
            won = float((self.state.get("result") or {}).get(mode) or 0.0)
        except (TypeError, ValueError):
            won = 0.0
        if not math.isfinite(won) or won <= 0:
            return base
        grown = int((base + won) // ORDER_IDR_STEP) * ORDER_IDR_STEP
        return max(base, min(grown, ORDER_IDR_CAP))

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
        amount = self.order_size(mode)
        block = ""
        if self.paused:
            block = "Buying is paused from Telegram (/indodax resume switches it back on). Open copies are still watched and sold."
        elif real and not self.checked:
            block = "Real buying waits for the key check. Stop the sender, run  python bridge.py --check  once, then start it again."
        elif real and self.state["tripped"]:
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
            if self.paused:
                raise Refused("Buying is paused from Telegram, so no order was sent.")
            if not self.checked:
                raise Refused("The API key has not passed --check, so no order was sent.")
            if self.state["tripped"]:
                raise Refused("The safety stop is on, so no order was sent.")
            if idr != self.order_size("real") or not ORDER_IDR_MIN <= idr <= ORDER_IDR_CAP:
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
            "boughtAt": int(number(position.get("at"))),
            "quantity": number(position.get("quantity")),
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
        amount = self.order_size("practice")
        quantity = floor_to(amount * (1 - pair["fee_percent"] / 100) / ticker["ask"], pair["increment"])
        if quantity <= 0:
            raise Refused(f"{rp(amount)} buys less than the smallest amount of {name}.")
        self.remember(symbol, action["signal"])
        self.open_copy(symbol, pair, quantity, amount, action["signal"], real=False)
        return f"PRACTICE: bought {plain(quantity)} {name} for {rp(amount)} of pretend money, at Indodax's real price."

    def buy_real(self, action: dict, pair: dict) -> str:
        symbol, coin = action["symbol"], action["coin"]
        name = coin.upper()
        amount = self.order_size("real")
        if self.state["tripped"]:
            # Stopped here, before the signal is marked as used: it can be copied after --clear.
            raise Refused("The safety stop is on, so no order was sent.")
        try:
            before = self.exchange.balances()
        except ExchangeError as error:
            raise Refused(f"The balance could not be read ({error}), so no order was sent.") from None
        if before.get("idr", 0.0) < amount:
            raise Refused(f"There is not enough free rupiah at Indodax for a {rp(amount)} order.")

        earlier = self.state["bought"].get(symbol)
        self.remember(symbol, action["signal"])
        order_ref = order_name(coin, action["signal"], "b")
        answer = None
        try:
            answer = self.send_order("buy", symbol, pair=pair, idr=amount, client_order_id=order_ref)
        except ExchangeError as error:
            if error.unsent:
                # Nothing was ordered and nothing needs a look: the signal is free again, and the next
                # try carries the same order name, which Indodax takes only once.
                self.take_back(symbol, earlier)
                raise Refused(f"The buy of {name} never left this PC ({error}), so nothing was ordered. Trying again next minute.") from None
            if not error.unsure:
                self.trip(f"Indodax refused the buy of {name} ({error}).")
                raise Refused(f"Indodax refused the buy ({error}).") from None

        after = self.free_balances()
        # A lost answer: Indodax is asked what became of the order. No clear word leaves all as it was.
        known = self.lookup(order_ref, "buy") if answer is None else None
        status = known["status"] if known else ""
        gain = after.get(coin, 0.0) - before.get(coin, 0.0) if after else 0.0
        if answer:
            told = number(answer.get(f"receive_{coin}"))
        elif status == "filled":
            told = number(known.get(f"receive_{coin}"))
        else:
            told = 0.0
        # The smaller of what the balance shows and what Indodax says: the copy is never overstated.
        amounts = [value for value in (gain, told) if value > 0]
        quantity = min(amounts) if amounts else 0.0
        if answer is None and gain <= 0:
            quantity = 0.0  # after a lost answer the coin must show in the balance before a copy is recorded

        if answer is None:
            if after is None:
                self.trip(f"The answer to the buy of {name} was lost and the balance could not be read. The order may have gone through: check Indodax by hand.")
                raise Refused("The buy could not be confirmed, and no copy was recorded.")
            if quantity <= 0:
                if status == "cancelled" and (untouched(known, "rp") or untouched(known, "idr")):
                    # Indodax's own record: the whole order was cancelled. The signal stays used.
                    raise Refused(f"The answer to the buy of {name} was lost. Indodax cancelled the order and no {name} arrived, so nothing was bought.")
                if status == "filled":
                    self.trip(f"The answer to the buy of {name} was lost. Indodax shows the order as filled, but no {name} shows in your balance. Check Indodax by hand.")
                elif status == "open":
                    self.trip(f"The answer to the buy of {name} was lost and the order is still open at Indodax. Check your open orders there.")
                else:
                    self.trip(f"The answer to the buy of {name} was lost and no {name} has arrived so far. Check your open orders at Indodax.")
                raise Refused("The buy could not be confirmed, and no copy was recorded.")
            if status == "filled":
                self.log(f"The answer to the buy of {name} was lost, but Indodax confirms the order was filled.")
            elif status == "open":
                self.trip(f"The answer to the buy of {name} was lost. Part of it arrived, so the copy is recorded, and the rest is still open at Indodax. Check your open orders there.")
            else:
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
        """An earlier sale had no clear answer. Indodax's record of that order decides when it is
        clear; otherwise the balance does. "" means the coin is still there and can be sold now."""
        position = self.state["positions"][symbol]
        mark = position["unsure"]
        coin = position["coin"]
        name = coin.upper()
        try:
            now = self.exchange.balances()
        except ExchangeError as error:
            raise Refused(f"The earlier sale of {name} is still unconfirmed and the balance could not be read ({error}). Nothing was sent.") from None
        attempt = int(position.get("sells") or 0)
        order_ref = str(mark.get("name") or order_name(coin, position["openedAt"], f"s{attempt}"))
        known = self.lookup(order_ref, "sell")
        status = known["status"] if known else ""
        gone = number(mark.get("coin")) - now.get(coin, 0.0)
        sold = gone >= number(mark.get("quantity")) * 0.5

        if status == "open":
            raise Refused(f"The earlier sale of {name} is still open at Indodax, so nothing was sent. If it stays open, cancel it at Indodax by hand.")
        if status == "cancelled" and untouched(known, coin) and not sold:
            # None of it was sold and that order is closed for good: the next try needs a new name.
            del position["unsure"]
            position["sells"] = attempt + 1
            self.save()
            return ""
        exact = sale_proceeds(known) if status == "filled" else 0.0
        if exact > 0:
            entry = self.close_copy(symbol, exact)
            return f"REAL MONEY: the earlier sale of {name} went through for {rp(exact)} ({signed_rp(entry['received'] - entry['spent'])}), as Indodax's record of the order shows."
        if not sold and status != "filled":
            # The same order name is kept, so Indodax itself refuses a second sale.
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
        order_ref = order_name(coin, position["openedAt"], f"s{attempt}")
        answer = None
        known = None
        try:
            answer = self.send_order("sell", symbol, quantity=quantity, client_order_id=order_ref)
        except ExchangeError as error:
            if error.unsent:
                raise Refused(f"The sale of {name} never left this PC ({error}), so nothing was sold. Trying again next minute.") from None
            if not error.unsure:
                if name_taken(error):
                    # Indodax already has an order with this name: an earlier try did arrive.
                    # Its own record says what became of it; without a clear word it counts as sold.
                    known = self.lookup(order_ref, "sell")
                    status = known["status"] if known else ""
                    exact = sale_proceeds(known) if status == "filled" else 0.0
                    if exact > 0:
                        entry = self.close_copy(symbol, exact)
                        return f"REAL MONEY: {name} was sold already, for {rp(exact)} ({signed_rp(entry['received'] - entry['spent'])}), as Indodax's record of the order shows."
                    if status == "cancelled" and untouched(known, coin):
                        # Only an order that sold nothing at all is ever sent again under a new name.
                        position["sells"] = attempt + 1
                        self.save()
                        raise Refused(f"Indodax cancelled the earlier sale of {name} before any of it was sold. Trying again next minute under a new name.") from None
                    if status != "open":
                        estimate = float(quantity) * ticker["bid"] * (1 - pair["fee_percent"] / 100)
                        self.close_copy(symbol, estimate, estimated=True)
                        self.trip(f"The sale of {name} had already reached Indodax. Its result is an estimate: check it at Indodax.")
                        return f"REAL MONEY: {name} was sold already, for about {rp(estimate)}."
                    # Still open at Indodax: it is marked below and looked at again next minute.
                else:
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

        if answer is None:
            # A lost answer: Indodax is asked what became of the order before anything is guessed.
            known = known or self.lookup(order_ref, "sell")
            exact = sale_proceeds(known) if known and known["status"] == "filled" else 0.0
            if exact > 0:
                entry = self.close_copy(symbol, exact)
                return f"REAL MONEY: sold {name} for {rp(exact)} ({signed_rp(entry['received'] - entry['spent'])}) because {reason}. The answer was lost, but Indodax's record of the order confirms it."

        # No clear answer, or no rupiah seen yet. The same order name is kept, so Indodax itself
        # refuses a second sale, and Indodax's record or the balance settles it next minute.
        position["unsure"] = {"coin": free, "idr": before.get("idr", 0.0), "quantity": float(quantity), "at": self.now_ms(), "name": order_ref}
        self.save()
        self.trip(f"The sale of {name} could not be confirmed. It is checked against Indodax's record and your balance next minute.")
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

    def watch_market(self, pairs) -> None:
        """Read this cycle's price of every coin the sender may trade, and the free rupiah when
        INDODAX_REPORT_CASH asks for it (real mode only)."""
        self.cash = None
        if pairs is not None:
            coins = list(self.settings.coins) + [position["coin"] for position in self.state["positions"].values()]
            for coin in dict.fromkeys(coins):
                self.price(coin, pairs)
        if self.settings.real and self.settings.report_cash:
            balances = self.free_balances()
            if balances is not None:
                self.cash = number(balances.get("idr"))

    def market_of(self) -> list:
        rows = []
        for coin, ticker in self.prices.items():
            if ticker:
                rows.append({"coin": coin, "bid": ticker["bid"], "ask": ticker["ask"]})
        return rows[:5]

    def write_view(self, report: dict) -> None:
        """Keep the last report in a file next to the state, for the desktop app. Never fails a cycle."""
        try:
            target = Path(self.state_path).with_name("bridge_report.json")
            draft = target.with_suffix(".json.tmp")
            draft.write_text(json.dumps({"at": self.now_ms(), "report": report}, indent=2), encoding="utf-8")
            draft.replace(target)
        except OSError:
            pass

    def learned(self):
        """The short result of the last study (learn.json next to the state), or None."""
        try:
            data = json.loads(Path(self.state_path).with_name("learn.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        summary = data.get("summary") if isinstance(data, dict) else None
        return summary if isinstance(summary, dict) and number(summary.get("at")) > 0 else None

    def study_if_due(self) -> None:
        """Start the study when the last one is four hours old, or a buy or a sale came after it.
        It runs beside the sender as its own process and can never fail a cycle."""
        if self.study is None:
            return
        if self.studying is not None and self.studying.poll() is None:
            return
        self.studying = None
        now = self.clock()
        if now - self.study_tried < LEARN_RETRY_SECONDS:
            return
        studied = number((self.learned() or {}).get("at")) / 1000
        moves = [number(position.get("at")) for position in self.state["positions"].values()]
        moves += [number(entry.get("at")) for entry in self.state["closed"]]
        if studied and now - studied < LEARN_EVERY_SECONDS and max(moves, default=0) / 1000 <= studied:
            return
        self.study_tried = now
        try:
            self.studying = self.study()
            self.log("Studying the rules on the newest prices (learn.py). The study never orders.")
        except (OSError, ValueError) as error:
            self.log(f"The study could not start ({type(error).__name__}).")

    def report_of(self, notes: list) -> dict:
        """What TradeBot is told. Amounts of the copies, and the free rupiah in real mode: no name,
        email, address or any other balance."""
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
        learned = self.learned()
        return {
            "mode": "real" if self.settings.real else "practice",
            "keys": self.settings.has_keys,
            "checked": self.checked,
            "paused": self.paused,
            "tripped": bool(self.state["tripped"]),
            "trippedWhy": self.state["tripped"],
            "orderIdr": self.settings.order_idr,
            "maxOpen": self.settings.max_open,
            "stopPercent": self.settings.stop_percent,
            "positions": positions,
            **({"cash": self.cash} if self.cash is not None else {}),
            "market": self.market_of(),
            "closed": self.state["closed"][-10:],
            "result": dict(self.state["result"]),
            "today": {"practice": day["practice"], "real": day["real"], "buys": day["buys"]},
            "notes": [clip(note, 300) for note in notes[:5]],
            **({"learn": learned} if learned else {}),
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
        if isinstance(signals, dict):
            self.paused = bool(signals.get("paused"))
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

        if not show:
            self.watch_market(pairs)
            self.study_if_due()
        for note in notes:
            self.log(note)
        report = self.report_of(notes)
        if show:
            self.log("Would report: " + json.dumps(report))
            return report
        self.write_view(report)
        try:
            self.api.report(report)
        except ApiError as error:
            self.log(f"The report was not delivered: {error}")
        return report


# ---------------------------------------------------------------- running it


def study_command(env_path, state_path) -> list:
    """How the study is started: learn.py with this Python, or the one-file app asked to study."""
    start = [sys.executable, "--study"] if FROZEN else [sys.executable, str(HERE / "learn.py")]
    return [*start, "--env", str(env_path), "--state", str(state_path)]


def start_study(env_path, state_path):
    """learn.py as a quiet process of its own: no window, low priority, nothing printed here."""
    quiet = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
    return subprocess.Popen(
        study_command(env_path, state_path),
        cwd=str(HERE),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=quiet,
    )


def stamp(text: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {text}", flush=True)


def hold_one_sender(port=ONE_SENDER_PORT):
    """A socket that only one running sender can hold on this PC. None when another sender has it.

    The system takes it back by itself when the sender ends, however it ends.
    """
    holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        holder.bind(("127.0.0.1", port))
        holder.listen(1)
    except OSError:
        holder.close()
        return None
    return holder


def wait_for_end(pid) -> bool:
    """Wait until the process pid has ended (Windows). False when it cannot be watched: then nothing is known."""
    if os.name != "nt":
        return False
    import ctypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    kernel.WaitForSingleObject.restype = ctypes.c_uint32
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.OpenProcess(0x00100000, 0, int(pid))  # SYNCHRONIZE: the right to wait for it, nothing more
    if not handle:
        return False
    ended = kernel.WaitForSingleObject(handle, 0xFFFFFFFF) == 0  # no time limit
    kernel.CloseHandle(handle)
    return ended


def follow_the_starter(pid, wait=wait_for_end, leave=os._exit):
    """End this sender when its starter ends. The thread that waits is returned.

    The one-file app runs as two processes: a small starter, and this one. "End" in Windows' task
    list (and so Stop the sender for a sender with no window) ends only the starter; without this
    the sender would go on with nobody holding it.
    """
    import threading

    def watch():
        if wait(pid):
            leave(1)

    thread = threading.Thread(target=watch, daemon=True)
    thread.start()
    return thread


def append_line(path, line) -> None:
    """Add one line to a log file. A file over a megabyte is first set aside as .old.log."""
    try:
        target = Path(path)
        if target.exists() and target.stat().st_size > LOG_FILE_BYTES:
            target.replace(target.with_suffix(".old.log"))
        with target.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
    except OSError:
        pass


class KeptLines:
    """What the sender prints, kept in a file line by line: for a sender that runs with no window."""

    def __init__(self, path, also=None):
        self.path = path
        self.also = also  # where the lines went before (None inside the one-file app, which has no console)
        self.rest = ""

    def write(self, text) -> int:
        if self.also is not None:
            try:
                self.also.write(text)
            except (OSError, ValueError):
                pass
        self.rest += text
        while "\n" in self.rest:
            line, self.rest = self.rest.split("\n", 1)
            append_line(self.path, line)
        return len(text)

    def flush(self) -> None:
        if self.also is not None:
            try:
                self.also.flush()
            except (OSError, ValueError):
                pass


def check(settings: Settings, exchange=None, state_path=None) -> int:
    """Does the API key work? Reads the balance and orders nothing. A pass is remembered for this key."""
    if not settings.has_keys:
        print("INDODAX_API_KEY and INDODAX_API_SECRET are not set, so there is nothing to check. Practice mode does not need them.")
        return 1
    state = None
    if state_path is not None:
        try:
            state = load_state(state_path)
        except StateError as error:
            print(f"State: {error}")
            return 2
    client = exchange or exchange_for(settings)
    try:
        balances = client.balances()
    except ExchangeError as error:
        print(f"The API key does not work yet: {error}{version_hint(settings, error)}")
        return 1
    rights = getattr(client, "rights", None) or {}
    if rights.get("trade") is False:
        print("The API key can read the account but may not trade, so real orders would be refused. Make a key with trade switched on.")
        return 1
    remembered = ""
    if state is not None:
        state["checked"] = {"at": int(time.time()), "key": key_mark(settings.api_key)}
        save_state(state_path, state)
        remembered = " This key is now marked as checked on this PC."
    print(f"The API key works. Free rupiah at Indodax: {rp(balances.get('idr', 0.0))}. Nothing was ordered.{remembered}")
    if rights.get("withdraw"):
        print("Note: this key may also withdraw. The sender never does, but a key with view and trade only is safer.")
    return 0


def reroute(bridge, connect=socket.create_connection) -> bool:
    """Between two cycles: when the proxy in use is down and the other one answers, change to it.

    It happens before the cycle's first request, so nothing that was sent is ever sent again."""
    chosen = reachable(bridge.settings, connect)
    if chosen.proxy == bridge.settings.proxy:
        return False
    bridge.settings = chosen
    for part in (bridge.api, bridge.exchange):
        part.settings = chosen
        part.use_proxy(chosen.proxy)
    host = urllib.parse.urlsplit(chosen.proxy if "://" in chosen.proxy else "http://" + chosen.proxy).hostname
    bridge.log(f"The proxy in use did not answer. Now going through the other one ({host}).")
    return True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="TradeBot's Indodax sender (practice by default).")
    parser.add_argument("--show", action="store_true", help="print what it would do: no orders, no report")
    parser.add_argument("--once", action="store_true", help="one cycle, then stop")
    parser.add_argument("--check", action="store_true", help="test the API key: prints the free rupiah, orders nothing")
    parser.add_argument("--clear", action="store_true", help="clear the safety stop after you have looked at Indodax")
    parser.add_argument("--env", default=str(HERE / ".env"), help="the settings file (default: .env next to this script)")
    parser.add_argument("--state", default=str(HERE / "bridge_state.json"), help=argparse.SUPPRESS)
    parser.add_argument("--log", default="", help="also keep every line in this file (for a sender that runs with no window)")
    args = parser.parse_args(argv)
    if args.log:
        sys.stdout = sys.stderr = KeptLines(args.log, sys.stdout)

    try:
        settings = reachable(load_settings(args.env))
    except SettingsError as error:
        print(f"Settings: {error}")
        return 2

    if args.check:
        return check(settings, state_path=args.state)

    try:
        bridge = Bridge(exchange_for(settings), settings, Api(settings, log=stamp), args.state, log=stamp)
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
        if not bridge.checked:
            mode += " NOT YET: this API key has not passed --check on this PC, so nothing is bought until it has."
    else:
        mode = "PRACTICE: pretend money at Indodax's real prices. No order is sent to Indodax."
    try:
        if args.show or args.once:
            stamp(mode)
            bridge.cycle(show=args.show)
            return 0
        holder = hold_one_sender()  # kept until this sender ends
        if holder is None:
            stamp("Not started: another sender is already running on this PC, and two must never run together.")
            return ALREADY_RUNNING
        if FROZEN:
            follow_the_starter(os.getppid())
        stamp(f"Indodax sender running, one cycle every {CYCLE_SECONDS} seconds. {mode} Ctrl+C stops it; open copies stay as they are.")
        if FROZEN or (HERE / "learn.py").exists():  # only the sender that keeps running studies
            bridge.study = lambda: start_study(args.env, args.state)
        while True:
            try:
                reroute(bridge)
                bridge.cycle()
            except Exception as error:  # noqa: BLE001 (one bad cycle must not end the loop)
                stamp(f"This cycle failed ({type(error).__name__}). Trying again next minute.")
            time.sleep(CYCLE_SECONDS)
    except KeyboardInterrupt:
        stamp("Stopped. Copies stay as they are; coins bought with real money stay in your Indodax account.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
