"""CSV-backed paper trading ledger. Pure stdlib."""
from __future__ import annotations

import csv
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

HEADER = ["opened_at", "closed_at", "symbol", "timeframe", "side", "entry", "stop", "target", "exit", "size", "pnl_usd", "pnl_pct", "result", "reason"]


@dataclass
class Trade:
    opened_at: str
    closed_at: str
    symbol: str
    timeframe: str
    side: str
    entry: float
    stop: float
    target: float
    exit: float
    size: float
    pnl_usd: float
    pnl_pct: float
    result: str   # 'TP' | 'SL' | 'OPEN' | 'MANUAL'
    reason: str


def _ts(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


class Ledger:
    def __init__(self, path: str, starting_balance: float, risk_per_trade: float):
        self.path = Path(path)
        self.balance = starting_balance
        self.starting_balance = starting_balance
        self.risk_per_trade = risk_per_trade
        self.open_trades: dict[str, Trade] = {}        # key = symbol
        self.closed_trades: list[Trade] = []
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        with self.path.open("r", newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                t = Trade(
                    opened_at=row["opened_at"],
                    closed_at=row["closed_at"],
                    symbol=row["symbol"],
                    timeframe=row["timeframe"],
                    side=row["side"],
                    entry=float(row["entry"]),
                    stop=float(row["stop"]),
                    target=float(row["target"]),
                    exit=float(row["exit"]),
                    size=float(row["size"]),
                    pnl_usd=float(row["pnl_usd"]),
                    pnl_pct=float(row["pnl_pct"]),
                    result=row["result"],
                    reason=row["reason"],
                )
                if t.result == "OPEN":
                    self.open_trades[t.symbol] = t
                else:
                    self.closed_trades.append(t)
                    self.balance += t.pnl_usd

    def _append(self, trade: Trade) -> None:
        new_file = not self.path.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=HEADER)
            if new_file:
                w.writeheader()
            w.writerow(asdict(trade))

    def has_open(self, symbol: str) -> bool:
        return symbol in self.open_trades

    def open_position(self, signal, atr_value: float) -> Trade | None:
        if signal.symbol in self.open_trades:
            return None
        stop_dist = abs(signal.entry - signal.stop)
        if stop_dist <= 0:
            return None
        risk_usd = self.balance * self.risk_per_trade
        size = risk_usd / stop_dist
        t = Trade(
            opened_at=_ts(signal.bar_time),
            closed_at="",
            symbol=signal.symbol,
            timeframe=signal.timeframe,
            side=signal.side,
            entry=signal.entry,
            stop=signal.stop,
            target=signal.target,
            exit=0.0,
            size=size,
            pnl_usd=0.0,
            pnl_pct=0.0,
            result="OPEN",
            reason=signal.reason,
        )
        self.open_trades[signal.symbol] = t
        self._append(t)
        return t

    def check_exit(self, symbol: str, high: float, low: float) -> Trade | None:
        """If an open trade's SL or TP was hit by the current bar, close it. Returns closed Trade or None."""
        t = self.open_trades.get(symbol)
        if not t:
            return None
        if t.side == "LONG":
            hit_sl = low <= t.stop
            hit_tp = high >= t.target
            if hit_sl and hit_tp:
                exit_price = t.stop   # conservative: assume worst first
                result = "SL"
            elif hit_sl:
                exit_price = t.stop
                result = "SL"
            elif hit_tp:
                exit_price = t.target
                result = "TP"
            else:
                return None
        else:  # SHORT
            hit_sl = high >= t.stop
            hit_tp = low <= t.target
            if hit_sl and hit_tp:
                exit_price = t.stop
                result = "SL"
            elif hit_sl:
                exit_price = t.stop
                result = "SL"
            elif hit_tp:
                exit_price = t.target
                result = "TP"
            else:
                return None

        pnl_usd = (exit_price - t.entry) * t.size * (1 if t.side == "LONG" else -1)
        pnl_pct = (pnl_usd / (t.entry * t.size)) * 100
        closed = Trade(
            opened_at=t.opened_at,
            closed_at=datetime.now(timezone.utc).isoformat(),
            symbol=t.symbol,
            timeframe=t.timeframe,
            side=t.side,
            entry=t.entry,
            stop=t.stop,
            target=t.target,
            exit=exit_price,
            size=t.size,
            pnl_usd=pnl_usd,
            pnl_pct=pnl_pct,
            result=result,
            reason=t.reason,
        )
        self.balance += pnl_usd
        del self.open_trades[symbol]
        self.closed_trades.append(closed)
        self._append(closed)
        return closed

    def stats(self) -> dict:
        wins = [t for t in self.closed_trades if t.pnl_usd > 0]
        losses = [t for t in self.closed_trades if t.pnl_usd <= 0]
        total = len(self.closed_trades)
        win_rate = (len(wins) / total * 100) if total else 0.0
        avg_win = (sum(t.pnl_usd for t in wins) / len(wins)) if wins else 0.0
        avg_loss = (sum(t.pnl_usd for t in losses) / len(losses)) if losses else 0.0
        total_pnl = sum(t.pnl_usd for t in self.closed_trades)
        return {
            "balance": self.balance,
            "total_pnl": total_pnl,
            "total_trades": total,
            "open_trades": len(self.open_trades),
            "win_rate": win_rate,
            "avg_win": avg_win,
            "avg_loss": avg_loss,
            "profit_factor": (sum(t.pnl_usd for t in wins) / abs(sum(t.pnl_usd for t in losses))) if losses else float("inf"),
        }
