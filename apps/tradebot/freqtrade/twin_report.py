"""Send the twin's numbers to TradeBot's server, so the twin's Telegram bot can show them.

freqtrade runs on this PC. This script reads its numbers from the local FreqUI address (the same
ones FreqUI shows) and posts them to TradeBot's Worker once a minute. The Worker answers the twin's
bot in Telegram. Nothing comes back: the Worker cannot buy, sell or stop the twin.

It is off until TWIN_REPORT_KEY is in .env (see README, "Telegram through TradeBot's server").
On a network that blocks Telegram this sends the twin's numbers out another way; check that the
network's owner allows that before switching it on there.

    python twin_report.py --show     print what would be sent, and send nothing
    python twin_report.py --once     send one report and stop
    python twin_report.py            send a report every minute until stopped

Settings come from the environment, then from .env next to this file:
    TWIN_REPORT_KEY                    from POST /v1/twin/setup (shown once)
    TWIN_REPORT_URL                    default: TradeBot's /v1/twin/report
    FREQTRADE__API_SERVER__PASSWORD    the FreqUI password
    HTTPS_PROXY                        used for the report only, never for the local address

Standard library only. It never prints a key or a password.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_REPORT_URL = "https://trade-bot.juw12.workers.dev/v1/twin/report"
USER_AGENT = "juw12-trade-twin/0.6"
EVERY_SECONDS = 60
GIVE_UP_AFTER = 10  # unanswered minutes in a row: freqtrade has stopped, so this stops too
CLOSED_TRADES = 10


def read_env_file(path):
    """KEY=value lines, the way run-windows.ps1 reads them."""
    values = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        key, separator, value = line.partition("=")
        key = key.strip()
        if separator and key and not key.startswith("#"):
            values[key] = value.strip()
    return values


def setting(name, env_file, default=""):
    return os.environ.get(name) or env_file.get(name) or default


def local_address():
    """Where freqtrade's own web server listens, from config.json."""
    server = {}
    try:
        server = json.loads((HERE / "config.json").read_text(encoding="utf-8")).get("api_server", {})
    except (OSError, ValueError):
        pass
    host = server.get("listen_ip_address") or "127.0.0.1"
    if host == "0.0.0.0":
        host = "127.0.0.1"
    return f"http://{host}:{server.get('listen_port') or 8080}/api/v1/", server.get("username") or "tradebot"


def local_reader(password):
    """A function that reads one page of freqtrade's local web server. No proxy: it is this PC."""
    base, username = local_address()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    login = base64.b64encode(f"{username}:{password}".encode()).decode()

    def read(path):
        request = urllib.request.Request(base + path, headers={"Authorization": "Basic " + login})
        with opener.open(request, timeout=15) as response:
            return json.load(response)

    return read


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def snapshot_of(read):
    """The numbers the twin's bot shows. Nothing else leaves this PC: no keys, no orders, no logs."""
    config = read("show_config")
    balance = read("balance")
    profit = read("profit")
    open_trades = read("status")
    # order_by_id=false: newest closed trades first (the default is the oldest first).
    history = read(f"trades?limit={CLOSED_TRADES}&order_by_id=false")

    stake = str(config.get("stake_currency") or "USDT")
    free = 0.0
    for wallet in balance.get("currencies") or []:
        if wallet.get("currency") == stake:
            free = number(wallet.get("free"))
    closed = [trade for trade in history.get("trades") or [] if not trade.get("is_open")]
    closed.sort(key=lambda trade: number(trade.get("close_timestamp")), reverse=True)

    return {
        "state": str(config.get("state") or ""),
        "dryRun": config.get("dry_run") is not False,
        "strategy": str(config.get("strategy") or ""),
        "exchange": str(config.get("exchange") or ""),
        "timeframe": str(config.get("timeframe") or ""),
        "stake": stake,
        "maxOpen": number(config.get("max_open_trades")),
        "balance": {
            "total": number(balance.get("total_bot")),
            "free": free,
            "start": number(balance.get("starting_capital")),
        },
        "profit": {
            "closed": number(profit.get("profit_closed_coin")),
            "all": number(profit.get("profit_all_coin")),
            "allPct": number(profit.get("profit_all_percent")),
            "trades": number(profit.get("trade_count")),
            "closedTrades": number(profit.get("closed_trade_count")),
            "wins": number(profit.get("winning_trades")),
            "losses": number(profit.get("losing_trades")),
        },
        "open": [
            {
                "id": trade.get("trade_id"),
                "pair": trade.get("pair"),
                "amount": number(trade.get("amount")),
                "openRate": number(trade.get("open_rate")),
                "rate": number(trade.get("current_rate")),
                "stake": number(trade.get("stake_amount")),
                "profit": number(trade.get("profit_abs")),
                "profitPct": number(trade.get("profit_pct")),
                "openedAt": number(trade.get("open_timestamp")),
            }
            for trade in open_trades
        ],
        "closed": [
            {
                "id": trade.get("trade_id"),
                "pair": trade.get("pair"),
                "profit": number(trade.get("close_profit_abs")),
                "profitPct": number(trade.get("close_profit_pct")),
                "closedAt": number(trade.get("close_timestamp")),
                "reason": trade.get("exit_reason") or "",
            }
            for trade in closed[:CLOSED_TRADES]
        ],
    }


def send(url, key, snapshot):
    """Post one report. The proxy, if any, comes from HTTPS_PROXY."""
    request = urllib.request.Request(
        url,
        data=json.dumps(snapshot).encode(),
        method="POST",
        headers={"Content-Type": "application/json", "X-Twin-Key": key, "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def explain(error):
    """A short reason, without addresses or secrets."""
    if isinstance(error, urllib.error.HTTPError):
        if error.code == 403:
            return "the server refused the report key (HTTP 403)"
        if error.code == 401:
            return "freqtrade refused the FreqUI password (HTTP 401)"
        return f"HTTP {error.code}"
    if isinstance(error, urllib.error.URLError):
        return f"no connection ({type(error.reason).__name__})"
    return type(error).__name__


def stamp():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def main():
    parser = argparse.ArgumentParser(description="Send the twin's numbers to TradeBot's server.")
    parser.add_argument("--once", action="store_true", help="send one report and stop")
    parser.add_argument("--show", action="store_true", help="print what would be sent, and send nothing")
    arguments = parser.parse_args()

    env_file = read_env_file(HERE / ".env")
    password = setting("FREQTRADE__API_SERVER__PASSWORD", env_file)
    key = setting("TWIN_REPORT_KEY", env_file)
    url = setting("TWIN_REPORT_URL", env_file, DEFAULT_REPORT_URL)
    if not password:
        print("No FREQTRADE__API_SERVER__PASSWORD in .env: the twin's numbers cannot be read.")
        return 2
    read = local_reader(password)

    if arguments.show:
        try:
            print(json.dumps(snapshot_of(read), indent=2))
        except Exception as error:  # noqa: BLE001 - any failure gets the same short answer
            print(f"The twin's numbers could not be read: {explain(error)}. Is freqtrade running?")
            return 1
        return 0

    if not key:
        print("No TWIN_REPORT_KEY in .env: reports are off. See README, \"Telegram through TradeBot's server\".")
        return 2

    last_line = None
    unanswered = 0
    while True:
        try:
            snapshot = snapshot_of(read)
        except Exception as error:  # noqa: BLE001
            line = f"twin not read: {explain(error)}"
            ok = False
            unanswered += 1
            if unanswered >= GIVE_UP_AFTER and not arguments.once:
                print(f"{stamp()} the twin has not answered for {GIVE_UP_AFTER} minutes: stopping", flush=True)
                return 1
        else:
            unanswered = 0
            try:
                answer = send(url, key, snapshot)
                ok = bool(answer.get("ok"))
                line = "report sent" if ok else "report refused"
            except Exception as error:  # noqa: BLE001
                line = f"report not sent: {explain(error)}"
                ok = False
        # One line per change, not one per minute, so the log stays short.
        if line != last_line:
            print(f"{stamp()} {line}", flush=True)
            last_line = line
        if arguments.once:
            return 0 if ok else 1
        time.sleep(EVERY_SECONDS)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
