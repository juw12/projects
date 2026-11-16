"""TradeBot's MetaTrader 5 bridge. DEMO ACCOUNTS ONLY.

MetaTrader 5 only talks to a program on the same Windows PC as its terminal, so TradeBot's server
cannot place an MT5 order. This bridge does, in the simplest way that is still safe:

  once a minute
    1. read the account the terminal is logged in to
    2. ask TradeBot which coins its practice account holds right now
    3. close this bridge's own positions in coins that are no longer held
    4. buy the broker's smallest lot of each coin that is held and not yet copied
    5. move the broker-side stop up to the practice account's stop
    6. tell TradeBot what the demo account looks like (/mt5 in Telegram shows it)

What keeps it safe:
  * It trades a DEMO account only. On a real or contest account it sends no order at all, and that
    is checked again right before every single order.
  * It is off until MT5_BRIDGE_KEY is set in the .env next to this file.
  * It never sees the account password: it attaches to a terminal that is already logged in.
  * It only touches positions it opened itself (its own magic number), and only buys.
  * When TradeBot's numbers are old or cannot be read, it holds: no orders.

    python bridge.py --show    what it would do right now (no orders, no report)
    python bridge.py --once    one cycle
    python bridge.py           keep going, one cycle a minute

Not tested against a real terminal yet: the tests use a pretend MetaTrader 5.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

CLIENT = "juw12-trade-mt5/0.8"  # how the bridge names itself to TradeBot's server
MAGIC = 20261116  # marks the positions this bridge opened; it touches no others
DEFAULT_URL = "https://trade-bot.juw12.workers.dev"
CYCLE_SECONDS = 60
COMMENT = "tradebot"
DEVIATION_POINTS = 50  # how far the price may move while a market order is on its way
HERE = Path(__file__).resolve().parent


class SettingsError(Exception):
    """The .env holds something the bridge cannot use."""


class ApiError(Exception):
    """TradeBot's server could not be asked or did not accept the answer."""


class Refused(Exception):
    """An order was not sent, or the broker did not fill it."""


# ---------------------------------------------------------------- settings


@dataclass
class Settings:
    key: str = ""
    url: str = DEFAULT_URL
    symbols: dict = field(default_factory=dict)  # TradeBot's name -> the broker's name
    suffix: str = ""
    max_open: int = 3
    proxy: str = ""

    def broker_symbol(self, symbol: str) -> str:
        """BTCUSDT -> the broker's name for it. MT5_SYMBOLS wins; else BTCUSD plus the suffix."""
        if symbol in self.symbols:
            return self.symbols[symbol]
        base = symbol[:-4] + "USD" if symbol.endswith("USDT") else symbol
        return base + self.suffix


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


def settings_from(values: dict) -> Settings:
    url = (values.get("MT5_BRIDGE_URL") or DEFAULT_URL).strip().rstrip("/")
    if not url.lower().startswith("https://"):
        raise SettingsError("MT5_BRIDGE_URL must start with https:// so the key is never sent in the clear.")

    symbols = {}
    for pair in (values.get("MT5_SYMBOLS") or "").split(","):
        if not pair.strip():
            continue
        if "=" not in pair:
            raise SettingsError(f"MT5_SYMBOLS: '{pair.strip()}' should look like BTCUSDT=BTCUSD.")
        ours, theirs = (part.strip() for part in pair.split("=", 1))
        if not ours or not theirs:
            raise SettingsError(f"MT5_SYMBOLS: '{pair.strip()}' should look like BTCUSDT=BTCUSD.")
        symbols[ours.upper()] = theirs

    try:
        max_open = int(values.get("MT5_MAX_OPEN") or 3)
    except ValueError:
        raise SettingsError("MT5_MAX_OPEN must be a whole number from 1 to 10.") from None

    return Settings(
        key=(values.get("MT5_BRIDGE_KEY") or "").strip(),
        url=url,
        symbols=symbols,
        suffix=(values.get("MT5_SYMBOL_SUFFIX") or "").strip(),
        max_open=min(10, max(1, max_open)),
        proxy=(values.get("HTTPS_PROXY") or values.get("https_proxy") or "").strip(),
    )


def load_settings(env_path, environ=None) -> Settings:
    """The .env next to the script, with the process environment on top."""
    values = read_env_file(env_path)
    for name, value in (os.environ if environ is None else environ).items():
        if name.startswith("MT5_") or name.upper() == "HTTPS_PROXY":
            values[name] = value
    return settings_from(values)


# ---------------------------------------------------------------- TradeBot's server


class Api:
    """The two calls the bridge makes: read the signals, post the report."""

    def __init__(self, settings: Settings, timeout: int = 20):
        self.settings = settings
        self.timeout = timeout
        handlers = [urllib.request.ProxyHandler({"https": settings.proxy})] if settings.proxy else []
        self.opener = urllib.request.build_opener(*handlers)

    def _call(self, path: str, payload=None) -> dict:
        headers = {"X-Mt5-Key": self.settings.key, "User-Agent": CLIENT, "Accept": "application/json"}
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.settings.url + path, data=data, headers=headers, method="POST" if data else "GET")
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            hint = " (is MT5_BRIDGE_KEY the key from the setup?)" if error.code == 403 else ""
            raise ApiError(f"TradeBot answered HTTP {error.code}{hint}") from None
        except (urllib.error.URLError, OSError, ValueError) as error:
            # Only the kind of problem is kept: the request and its key never reach a log.
            raise ApiError(f"TradeBot could not be reached ({type(error).__name__})") from None

    def signals(self) -> dict:
        return self._call("/v1/mt5/signals")

    def report(self, payload: dict) -> dict:
        return self._call("/v1/mt5/report", payload)


# ---------------------------------------------------------------- the bridge


def load_state(path) -> dict:
    try:
        state = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        state = {}
    bought = state.get("bought") if isinstance(state, dict) else None
    return {"bought": bought if isinstance(bought, dict) else {}}


def save_state(path, state: dict) -> None:
    target = Path(path)
    draft = target.with_suffix(target.suffix + ".tmp")
    draft.write_text(json.dumps(state, indent=2), encoding="utf-8")
    draft.replace(target)


class Bridge:
    def __init__(self, mt5, settings: Settings, api, state_path, log=print, clock=time.time):
        self.mt5 = mt5
        self.settings = settings
        self.api = api
        self.state_path = state_path
        self.log = log
        self.clock = clock
        self.state = load_state(state_path)

    # ---- guards

    def why_not_trading(self) -> str:
        """The reason no order may be sent right now, or "" when one may."""
        account = self.mt5.account_info()
        if account is None:
            return "MetaTrader 5 is not logged in to an account."
        if account.trade_mode != self.mt5.ACCOUNT_TRADE_MODE_DEMO:
            return "This is not a demo account. The bridge only trades demo accounts."
        terminal = self.mt5.terminal_info()
        if terminal is None or not terminal.trade_allowed:
            return "Algo Trading is switched off in the terminal."
        if not account.trade_allowed:
            return "Trading is disabled for this account."
        if not account.trade_expert:
            return "The broker does not allow automated trading on this account."
        return ""

    def send(self, request: dict):
        """The only place an order leaves from. Everything is checked again right before it goes."""
        reason = self.why_not_trading()
        if reason:
            raise Refused(reason)
        if request.get("magic") != MAGIC:
            raise Refused("An order without the bridge's own mark was stopped.")
        result = self.mt5.order_send(request)
        if result is None:
            raise Refused(f"MetaTrader 5 gave no answer ({self.mt5.last_error()}).")
        if result.retcode != self.mt5.TRADE_RETCODE_DONE:
            raise Refused(f"The broker answered {result.retcode} {getattr(result, 'comment', '')}".strip() + ".")
        return result

    # ---- reading

    def own_positions(self) -> list:
        """Positions this bridge opened: its magic number, and buys only."""
        positions = self.mt5.positions_get() or ()
        return [item for item in positions if item.magic == MAGIC and item.type == self.mt5.POSITION_TYPE_BUY]

    def held(self) -> dict:
        """The broker's symbol -> this bridge's positions in it."""
        by_symbol = {}
        for position in self.own_positions():
            by_symbol.setdefault(position.symbol, []).append(position)
        return by_symbol

    def filling(self, info):
        """The fill rule this symbol accepts."""
        mode = int(getattr(info, "filling_mode", 0) or 0)
        if mode & 1:
            return self.mt5.ORDER_FILLING_FOK
        if mode & 2:
            return self.mt5.ORDER_FILLING_IOC
        return self.mt5.ORDER_FILLING_RETURN

    def wanted(self, signals: dict) -> dict:
        """The broker's symbol -> { symbol, openedAt, stop } for each coin the practice account holds."""
        wanted = {}
        for item in signals.get("wanted") or []:
            symbol = str(item.get("symbol") or "")
            if symbol:
                wanted[self.settings.broker_symbol(symbol)] = {
                    "symbol": symbol,
                    "openedAt": item.get("openedAt") or 0,
                    "stop": float(item.get("stop") or 0),
                }
        return wanted

    # ---- deciding (nothing here sends an order)

    def stop_actions(self, wanted: dict):
        """Stops to set or raise. A stop is never lowered, and never put on top of the price."""
        actions, notes = [], []
        for broker, positions in self.held().items():
            item = wanted.get(broker)
            if not item or item["stop"] <= 0:
                continue
            info = self.mt5.symbol_info(broker)
            tick = self.mt5.symbol_info_tick(broker)
            if info is None or tick is None:
                continue
            target = round(item["stop"], int(info.digits))
            room = float(info.trade_stops_level) * float(info.point)
            for position in positions:
                if target <= float(position.sl) + float(info.point) / 2:
                    continue
                if target >= float(tick.bid) - room:
                    notes.append(f"{broker}: the practice stop is at or too near the price, so the broker's stop was left as it is.")
                    continue
                actions.append({"do": "stop", "broker": broker, "ticket": position.ticket, "stop": target, "tp": float(position.tp)})
        return actions, notes

    def plan(self, signals: dict):
        """What to close, buy and re-stop for these signals. Returns (actions, notes)."""
        wanted = self.wanted(signals)
        held = self.held()
        actions, notes = [], []

        for broker, positions in held.items():
            if broker not in wanted:
                for position in positions:
                    actions.append({"do": "close", "broker": broker, "ticket": position.ticket, "volume": float(position.volume)})

        open_count = sum(1 for broker in held if broker in wanted)
        for broker, item in wanted.items():
            if broker in held:
                continue
            memory = self.state["bought"].get(item["symbol"])
            if memory and memory.get("signal") == item["openedAt"]:
                notes.append(f"{broker} was closed on the MT5 side (its stop, or by hand). It is not bought again for the same signal.")
                continue
            if open_count >= self.settings.max_open:
                notes.append(f"{broker} is not copied: {self.settings.max_open} copies are open already (MT5_MAX_OPEN).")
                continue
            info = self.mt5.symbol_info(broker)
            if info is None:
                notes.append(f"{broker} is not offered by this broker (see MT5_SYMBOLS).")
                continue
            if info.trade_mode != self.mt5.SYMBOL_TRADE_MODE_FULL:
                notes.append(f"{broker} cannot be traded freely at this broker right now.")
                continue
            actions.append({"do": "buy", "symbol": item["symbol"], "broker": broker, "volume": float(info.volume_min), "signal": item["openedAt"]})
            open_count += 1

        stops, stop_notes = self.stop_actions(wanted)
        return actions + stops, notes + stop_notes

    # ---- acting

    def _market(self, broker: str, volume: float, side: str, ticket=None) -> dict:
        info = self.mt5.symbol_info(broker)
        if info is None:
            raise Refused(f"{broker} is not offered by this broker.")
        if not getattr(info, "visible", True):
            self.mt5.symbol_select(broker, True)
        tick = self.mt5.symbol_info_tick(broker)
        if tick is None:
            raise Refused(f"{broker} has no price right now.")
        request = {
            "action": self.mt5.TRADE_ACTION_DEAL,
            "symbol": broker,
            "volume": float(volume),
            "type": self.mt5.ORDER_TYPE_BUY if side == "buy" else self.mt5.ORDER_TYPE_SELL,
            "price": float(tick.ask if side == "buy" else tick.bid),
            "deviation": DEVIATION_POINTS,
            "magic": MAGIC,
            "comment": COMMENT,
            "type_time": self.mt5.ORDER_TIME_GTC,
            "type_filling": self.filling(info),
        }
        if ticket is not None:
            request["position"] = ticket
        return request

    def do(self, action: dict) -> str:
        """Carry out one planned action. Returns a line for the log; raises Refused when it did not happen."""
        broker = action["broker"]
        if action["do"] == "close":
            if not any(position.ticket == action["ticket"] for position in self.own_positions()):
                raise Refused(f"{broker}: that position is not this bridge's any more.")
            self.send(self._market(broker, action["volume"], "sell", ticket=action["ticket"]))
            return f"closed {broker} ({action['volume']} lot)"
        if action["do"] == "buy":
            self.send(self._market(broker, action["volume"], "buy"))
            self.state["bought"][action["symbol"]] = {"signal": action["signal"], "at": int(self.clock() * 1000)}
            save_state(self.state_path, self.state)
            return f"bought {broker} ({action['volume']} lot, the broker's smallest)"
        if action["do"] == "stop":
            self.send(
                {
                    "action": self.mt5.TRADE_ACTION_SLTP,
                    "symbol": broker,
                    "position": action["ticket"],
                    "sl": action["stop"],
                    "tp": action["tp"],
                    "magic": MAGIC,
                }
            )
            return f"stop for {broker} set to {action['stop']}"
        raise Refused(f"unknown action {action['do']}")

    def _run(self, actions: list, notes: list) -> None:
        for action in actions:
            try:
                self.log(self.do(action))
            except Refused as refusal:
                notes.append(f"{action['broker']}: {action['do']} did not happen. {refusal}")

    def forget(self, wanted: dict) -> None:
        """Drop the memory of buys whose signal is over, so a new signal can be copied again."""
        still = {item["symbol"] for item in wanted.values()}
        gone = [symbol for symbol in self.state["bought"] if symbol not in still]
        for symbol in gone:
            del self.state["bought"][symbol]
        if gone:
            save_state(self.state_path, self.state)

    # ---- reporting

    def report_of(self, notes: list) -> dict:
        account = self.mt5.account_info()
        if account is None:
            return {"loggedIn": False, "demo": False, "notes": notes[:5]}
        if account.trade_mode != self.mt5.ACCOUNT_TRADE_MODE_DEMO:
            # Not this bridge's business: no balance and no positions of a real account are sent.
            return {"loggedIn": True, "demo": False, "server": str(account.server), "notes": notes[:5]}
        names = {self.settings.broker_symbol(symbol): symbol for symbol in self.state["bought"]}
        positions = []
        for position in self.own_positions():
            symbol = names.get(position.symbol, position.symbol)
            memory = self.state["bought"].get(symbol) or {}
            positions.append(
                {
                    "symbol": symbol,
                    "brokerSymbol": position.symbol,
                    "volume": float(position.volume),
                    "openPrice": float(position.price_open),
                    "price": float(position.price_current),
                    "stop": float(position.sl),
                    "profit": float(position.profit),
                    "openedAt": int(memory.get("at") or 0),
                }
            )
        terminal = self.mt5.terminal_info()
        return {
            "loggedIn": True,
            "demo": True,
            "tradeAllowed": bool(terminal is not None and terminal.trade_allowed and account.trade_allowed and account.trade_expert),
            "server": str(account.server),
            "currency": str(account.currency),
            "leverage": int(account.leverage),
            "balance": float(account.balance),
            "equity": float(account.equity),
            "positions": positions,
            "notes": notes[:5],
        }

    # ---- one cycle

    def cycle(self, show: bool = False) -> dict:
        """Read, decide, act, report. With show=True it only prints what it would do."""
        notes = []
        reason = self.why_not_trading()
        signals = None
        try:
            signals = self.api.signals()
        except ApiError as error:
            notes.append(f"{error}. Holding: no orders.")

        if reason:
            notes.append(f"{reason} No orders are sent.")
        elif signals is not None and not signals.get("fresh"):
            notes.append("TradeBot's last round is too old to act on. Holding: no orders.")
        elif signals is not None:
            actions, plan_notes = self.plan(signals)
            notes.extend(plan_notes)
            if show:
                self.log("Would do: " + (json.dumps(actions) if actions else "nothing"))
            else:
                wanted = self.wanted(signals)
                self._run([action for action in actions if action["do"] != "stop"], notes)
                # Stops are read again after the buys, so a fresh copy gets its stop in the same cycle.
                stops, _ = self.stop_actions(wanted)
                self._run(stops, notes)
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


def load_mt5():
    """The MetaTrader5 package, or None with the reason printed."""
    if sys.platform != "win32":
        print("The MetaTrader5 package only exists for Windows. Run the bridge on the Windows PC that has the MT5 terminal.")
        return None
    try:
        import MetaTrader5  # noqa: PLC0415 (needed only when the bridge really runs)
    except ImportError:
        print("The MetaTrader5 package is missing. Install it with:  python -m pip install MetaTrader5")
        return None
    return MetaTrader5


def stamp(text: str) -> None:
    print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {text}", flush=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="TradeBot's MetaTrader 5 bridge (demo accounts only).")
    parser.add_argument("--show", action="store_true", help="print what it would do: no orders, no report")
    parser.add_argument("--once", action="store_true", help="one cycle, then stop")
    parser.add_argument("--env", default=str(HERE / ".env"), help="the settings file (default: .env next to this script)")
    args = parser.parse_args(argv)

    try:
        settings = load_settings(args.env)
    except SettingsError as error:
        print(f"Settings: {error}")
        return 2
    if not settings.key:
        print("The MT5 bridge is off: MT5_BRIDGE_KEY is empty. Nothing was started. The README says how to switch it on.")
        return 0

    mt5 = load_mt5()
    if mt5 is None:
        return 1
    # No login, password or server is passed: it attaches to the terminal that is already logged in.
    if not mt5.initialize():
        print(f"Could not reach the MetaTrader 5 terminal ({mt5.last_error()}). Start it and log in to the demo account first.")
        return 1

    bridge = Bridge(mt5, settings, Api(settings), HERE / "bridge_state.json", log=stamp)
    try:
        if args.show or args.once:
            bridge.cycle(show=args.show)
            return 0
        stamp(f"MT5 bridge running, one cycle every {CYCLE_SECONDS} seconds. Ctrl+C stops it; open positions stay as they are.")
        while True:
            try:
                bridge.cycle()
            except Exception as error:  # noqa: BLE001 (one bad cycle must not end the loop)
                stamp(f"This cycle failed ({type(error).__name__}: {error}). Trying again next minute.")
            time.sleep(CYCLE_SECONDS)
    except KeyboardInterrupt:
        stamp("Stopped. Positions the bridge opened stay open in the demo account.")
        return 0
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    sys.exit(main())
