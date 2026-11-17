"""TradeBot's decision log: every call the desk lead made, and what the price did after it.

The desk (agents.py) has six roles and one voice at the end: the desk lead. This file writes that
voice down, with the price at Indodax at the moment of the call, and marks it later against the
price one hour, four hours and a day after. A call is right or wrong by then, and the list under
the desk lead says which.

Display only. Nothing here orders and no rule reads it: the bot buys and sells by the three checks
alone, exactly as it did before this file existed. It changes no setting and holds no key.

The calls that are written down are the four the desk lead can make: a buy, holding on, a sell or
standing aside. A stopped sender or a blocked buy is not a call about the market, so it is not
written down.

Standard library only.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

CHECK_HOURS = (1, 4, 24)  # the price is written down this long after a call
VERDICT_HOURS = 4  # a call is marked at the first mark at or after this one: the rules' own candle
COST_PERCENT = 0.6  # a round trip at Indodax costs about this much (0,3 percent there and back)
KEEP = 200  # calls kept: the oldest fall off the end
GAP_MS = 5 * 60 * 1000  # a call that changes sooner than this is the same call, not a new one
WEEK_DAYS = 7  # the window of the "lately" line: a week is what a weekly report asks about
GRACE_SHARE = 0.5  # a mark is only written when the look came within half the mark of it
LATE = " (from the candle)"  # a mark read out of the chart afterwards, because the window was closed at it
JSON_NAME = "decisions.json"
KINDS = ("BUY", "HOLD", "SELL", "WAIT")
MARK_GLYPHS = {"right": "✓", "wrong": "✗", "flat": "·", "open": "…", "unseen": "–"}
GUIDE = (
    "How this is marked: the price at Indodax when the call was made against the price 1, 4 and 24 hours later "
    "(what one coin cost then, the ask you would pay; a mark read out of the candle is that candle's last trade, a hair under it). "
    "A buy or a hold is right when the price rose by more than the 0,6% a round trip costs, "
    "a sell when it fell that far, a wait when it did not rise that far. A call is marked at the 4-hour mark: that is the candle the rules work on. "
    "A mark is only written when the window was open at it; a mark the window was closed for is read afterwards out of the candle of that hour, and the line says so. "
    "Shown only: this log places no order, and no rule reads it."
)


def number(value) -> float:
    """A number from a file or a report, or 0 when it is not one (a string, None, True)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value)


def comma(value, digits: int = 1) -> str:
    """1.5 -> '1,5' (the way TradeBot writes numbers)."""
    return f"{number(value):.{digits}f}".replace(".", ",")


def pct(value, digits: int = 1) -> str:
    """2.4 -> '+2,4%', -1.05 -> '-1,1%'."""
    value = number(value)
    return ("+" if value >= 0 else "-") + comma(abs(value), digits) + "%"


def empty() -> dict:
    """A log with no calls in it."""
    return {"version": 1, "updated": 0, "calls": []}


def load(path) -> dict:
    """The log saved at path. A missing, broken or foreign file gives an empty one: the window still opens."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty()
    calls = data.get("calls") if isinstance(data, dict) else None
    if not isinstance(calls, list):
        return empty()
    found = [
        call for call in calls
        if isinstance(call, dict) and number(call.get("at")) > 0 and str(call.get("coin")) and str(call.get("kind")) in KINDS and number(call.get("price")) > 0
    ]
    for call in found:
        call["marks"] = [mark for mark in call.get("marks") or [] if isinstance(mark, dict)]
    return {"version": 1, "updated": number(data.get("updated")), "calls": found[-KEEP:]}


def save(path, log) -> bool:
    """Write the log in one step, and never raise: a folder that cannot be written to must not stop the window."""
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + ".tmp")
        temp.write_text(json.dumps(log, ensure_ascii=False), encoding="utf-8")
        temp.replace(target)
        return True
    except OSError:
        return False


def kind_of(head) -> str:
    """The call inside the desk lead's line of words: BUY, HOLD, SELL, WAIT, or '' when it is no call.

    'Buy BTC at the next check' is a buy, 'Hold BTC: let it run' is a hold, 'Sell BTC at the next
    check' is a sell, 'Wait: no buy now' is standing aside. A stopped sender, a paused buy or a
    safety stop is about this PC and not about the price, so those lines are not written down.
    """
    words = str(head or "").strip()
    if words.startswith("Wait:") and "fresh signal" in words:
        return ""  # no signal from TradeBot's server is not a call about the price
    for kind, start in (("BUY", "Buy "), ("HOLD", "Hold "), ("SELL", "Sell "), ("WAIT", "Wait:")):
        if words.startswith(start):
            return kind
    return ""


def price_of(report, coin) -> float:
    """What one coin of this name costs at Indodax in the report (what to pay, else what it sells for), or 0."""
    wanted = str(coin or "").upper()
    for item in (report or {}).get("market") or []:
        if not isinstance(item, dict) or str(item.get("coin") or "").upper() != wanted:
            continue
        for key in ("ask", "bid"):
            value = number(item.get(key))
            if value > 0:
                return value
    return 0.0


def prices_of(report) -> dict:
    """Every coin in the report with a price: {'BTC': 1214900000.0, ...}."""
    found = {}
    for item in (report or {}).get("market") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("coin") or "").upper()
        value = number(item.get("ask")) or number(item.get("bid"))
        if name and value > 0:
            found[name] = value
    return found


def record(log, coin, head, price, now_ms, mode="") -> bool:
    """Write this call down unless the one at the top of the log is already it. True when it is new."""
    kind = kind_of(head)
    price = number(price)
    if not kind or price <= 0 or not str(coin or ""):
        return False
    calls = log.setdefault("calls", [])
    newest = calls[-1] if calls else None
    if newest is not None:
        newest["seen"] = number(now_ms)
        if newest.get("kind") == kind and str(newest.get("coin")) == str(coin):
            newest["head"] = str(head)  # the same call, said with newer words
            return False
        if number(now_ms) - number(newest.get("at")) < GAP_MS:
            return False  # a call that flips back and forth within minutes is noise, not a decision
    calls.append({
        "at": number(now_ms), "coin": str(coin), "kind": kind, "head": str(head),
        "price": price, "mode": str(mode or ""), "marks": [], "seen": number(now_ms),
    })
    del calls[:-KEEP]
    return True


def settle(log, prices, now_ms) -> bool:
    """Write down what the price is at every mark that has come. True when something was written.

    A mark whose look came too late (the window was closed) is written as missed, so the list says
    so instead of pretending the price was seen at that hour.
    """
    prices = {str(name).upper(): number(value) for name, value in (prices or {}).items()}
    changed = False
    for call in log.get("calls") or []:
        marks = call.setdefault("marks", [])
        have = {int(number(mark.get("hours"))) for mark in marks}
        for hours in CHECK_HOURS:
            if hours in have:
                continue
            due = number(call.get("at")) + hours * 3600 * 1000
            if number(now_ms) < due:
                continue
            price = prices.get(str(call.get("coin") or "").upper(), 0.0)
            if number(now_ms) - due > hours * 3600 * 1000 * GRACE_SHARE:
                marks.append({"hours": hours, "missed": True})
            elif price > 0:
                marks.append({"hours": hours, "at": number(now_ms), "price": price})
            else:
                continue  # this coin has no price right now: ask again at the next look
            changed = True
    return changed


def candle_step(rows) -> int:
    """How long one candle of these rows lasts, in ms: 0 when the rows are too short or out of order."""
    for one, two in zip(rows, rows[1:]):
        gap = number(two.get("t")) - number(one.get("t"))
        if gap > 0:
            return int(gap)
    return 0


def reading_at(rows, moment, step) -> float:
    """The close of the candle that covers this moment, or 0 when these rows do not reach it."""
    for row in rows:
        start = number(row.get("t"))
        if start <= moment < start + step:
            return number(row.get("c"))
        if start > moment:
            break
    return 0.0


def fill(log, coin, candles, now_ms) -> bool:
    """Read the marks the window was closed for out of the chart's own candles. True when one was read.

    A mark is only read from a candle no longer than the mark itself (a 1-hour mark from 15-minute or
    1-hour candles, never a day) and only once that candle has really closed. This is a reading and not
    a guess: it is the close Indodax printed for that slice, and the line says it came from the candle.
    """
    wanted = str(coin or "").upper()
    if not wanted or not isinstance(candles, dict):
        return False
    frames = []
    for rows in candles.values():
        clean = [row for row in rows or [] if isinstance(row, dict) and number(row.get("t")) > 0]
        step = candle_step(clean)
        if step > 0:
            frames.append((step, clean))
    if not frames:
        return False
    frames.sort(key=lambda pair: pair[0])  # finest candle first: the closest reading to the mark
    changed = False
    for call in log.get("calls") or []:
        if str(call.get("coin") or "").upper() != wanted:
            continue
        for mark in call.get("marks") or []:
            if number(mark.get("price")) > 0:
                continue  # the window was open at this one: a real look is never overwritten
            hours = int(number(mark.get("hours")))
            due = number(call.get("at")) + hours * 3600 * 1000
            if hours <= 0 or number(now_ms) < due:
                continue
            for step, rows in frames:
                if step > hours * 3600 * 1000 or number(now_ms) < due + step:
                    continue  # too coarse for this mark, or that candle has not closed yet
                price = reading_at(rows, due, step)
                if price <= 0:
                    continue
                mark.pop("missed", None)
                mark.update({"hours": hours, "at": due + step, "price": price, "late": True})
                changed = True
                break
    return changed


def verdict_mark(call):
    """The first mark at or after the verdict mark that was really seen, or None."""
    marks = [mark for mark in call.get("marks") or [] if int(number(mark.get("hours"))) >= VERDICT_HOURS and number(mark.get("price")) > 0]
    return min(marks, key=lambda mark: number(mark.get("hours"))) if marks else None


def change(call):
    """What the price did since the call at the mark it is judged by, in percent. None when that mark is not in."""
    mark = verdict_mark(call)
    was = number(call.get("price"))
    if mark is None or was <= 0:
        return None
    return (number(mark.get("price")) - was) / was * 100


def judge(call) -> tuple:
    """(mark, words): right / wrong / flat / open / unseen, and the sentence shown next to the call."""
    kind = str(call.get("kind") or "")
    move = change(call)
    if move is None:
        passed = [mark for mark in call.get("marks") or [] if int(number(mark.get("hours"))) >= VERDICT_HOURS]
        if passed:
            return "unseen", f"not marked: the window was closed at the {VERDICT_HOURS}-hour mark and no candle reached it"
        return "open", f"open: the {VERDICT_HOURS}-hour mark is not in yet"
    hours = int(number(verdict_mark(call).get("hours")))
    when = f"{hours} hours later"
    down, up = comma(abs(move)), comma(abs(move))
    if kind in ("BUY", "HOLD"):
        if move > COST_PERCENT:
            return "right", f"right: the price rose {up}% {when}"
        if move < -COST_PERCENT:
            return "wrong", f"wrong: the price fell {down}% {when}"
        return "flat", f"flat: the price moved {pct(move)} {when}, under the {comma(COST_PERCENT)}% a round trip costs"
    if kind == "SELL":
        if move < -COST_PERCENT:
            return "right", f"right: the price fell {down}% {when}"
        if move > COST_PERCENT:
            return "wrong", f"wrong: the price rose {up}% {when}"
        return "flat", f"flat: the price moved {pct(move)} {when}, under the {comma(COST_PERCENT)}% a round trip costs"
    if kind == "WAIT":
        if move > COST_PERCENT:
            return "wrong", f"wrong: the price rose {up}% {when} and the buy was skipped"
        if move < -COST_PERCENT:
            return "right", f"right: the price fell {down}% {when}, so not buying cost nothing"
        return "right", f"right: the price barely moved ({pct(move)}) {when}"
    return "open", "no call to mark"


def did_text(call) -> str:
    """What the price did after the call, mark by mark: '1h +0,4% · 4h +2,4% · 24h +5,1%'."""
    was = number(call.get("price"))
    parts = []
    for mark in sorted(call.get("marks") or [], key=lambda found: number(found.get("hours"))):
        name = f"{int(number(mark.get('hours')))}h"
        if number(mark.get("price")) <= 0:
            parts.append(f"{name} not seen")
        elif was > 0:
            parts.append(f"{name} {pct((number(mark.get('price')) - was) / was * 100)}")
    return " · ".join(parts) if parts else "no mark yet"


def rows(log, most: int = 6) -> list:
    """The calls, newest first, each ready for the list under the desk lead."""
    found = []
    for call in reversed((log or {}).get("calls") or []):
        mark, words = judge(call)
        seen_at = verdict_mark(call)
        if seen_at is not None and seen_at.get("late"):
            words += LATE
        found.append({
            "at": number(call.get("at")), "coin": str(call.get("coin")), "kind": str(call.get("kind")),
            "head": str(call.get("head")), "price": number(call.get("price")), "did": did_text(call),
            "mark": mark, "words": words,
        })
    return found[:most] if most else found


def tally(log) -> tuple:
    """({mark: count}, one line): how many calls of the log were right, wrong, flat, open and not seen."""
    counts = {"right": 0, "wrong": 0, "flat": 0, "open": 0, "unseen": 0}
    for call in (log or {}).get("calls") or []:
        mark, _words = judge(call)
        counts[mark] = counts.get(mark, 0) + 1
    total = sum(counts.values())
    if not total:
        return counts, "No call has been written down yet."
    said = ", ".join(f"{counts[name]} {name}" for name in ("right", "wrong", "flat", "open", "unseen") if counts.get(name))
    return counts, f"{total} {'call' if total == 1 else 'calls'}: {said}."


def week(log, now_ms, days: int = WEEK_DAYS) -> tuple:
    """({mark: count}, one line) for the calls of the last days only: how the desk lead did lately."""
    days = int(number(days)) or WEEK_DAYS
    since = number(now_ms) - days * 24 * 3600 * 1000
    recent = {"calls": [call for call in (log or {}).get("calls") or [] if number(call.get("at")) >= since]}
    counts, said = tally(recent)
    if not sum(counts.values()):
        return counts, f"No call in the last {days} days."
    return counts, f"Last {days} days: {said}"


def summary(log, now_ms) -> str:
    """The line under the heading: the whole book, and the last week's part of it once the book is older than that."""
    counts, whole = tally(log)
    week_counts, week_line = week(log, now_ms)
    if sum(week_counts.values()) == sum(counts.values()):
        return whole  # every call in the book is from the last week: one number says it
    return f"{whole} · {week_line}"


def main(argv=None) -> int:
    """One line for a weekly report, read from a run folder's log:
    python decisions.py --line [--days 7] [--folder DIR]
    """
    args = list(sys.argv[1:] if argv is None else argv)
    folder, days = Path.cwd(), WEEK_DAYS
    while args:
        name = args.pop(0)
        if name == "--line":
            continue
        elif name == "--folder" and args:
            folder = Path(args.pop(0))
        elif name == "--days" and args:
            found = args.pop(0)
            days = int(found) if found.isdigit() and int(found) > 0 else WEEK_DAYS
        elif name in ("-h", "--help"):
            print("python decisions.py --line [--days 7] [--folder DIR]")
            return 0
        else:
            print("python decisions.py --line [--days 7] [--folder DIR]")
            return 2
    print(week(load(Path(folder) / JSON_NAME), time.time() * 1000, days)[1])
    return 0


def update(log, report, team, coin, now_ms, path=None, candles=None) -> dict:
    """Record the desk lead's call, write down the marks that have come, save when anything changed.

    candles is the chart the window already holds ({frame: rows}): the marks the window was closed for
    are read out of it, so a sleeping PC does not lose the verdict.
    """
    log = log if isinstance(log, dict) and isinstance(log.get("calls"), list) else empty()
    prices = prices_of(report)
    changed = settle(log, prices, now_ms)
    try:
        if fill(log, coin, candles, now_ms):
            changed = True
    except (ArithmeticError, LookupError, TypeError, ValueError):
        pass  # a chart that cannot be read is not a reason to stop the window
    lead = next((member for member in team or [] if isinstance(member, dict) and member.get("key") == "lead"), None)
    if lead is not None:
        mode = (report or {}).get("mode") if isinstance(report, dict) else ""
        if record(log, coin, lead.get("head"), prices.get(str(coin or "").upper(), 0.0), now_ms, mode):
            changed = True
    if changed:
        log["updated"] = number(now_ms)
        if path:
            save(path, log)
    return log


def demo(now_ms) -> dict:
    """Made-up calls for --demo: the list and its marks can be seen without waiting a day for them."""
    hour = 3600 * 1000
    log = empty()

    def call(hours_ago, kind, head, price, moves):
        call = {"at": number(now_ms) - hours_ago * hour, "coin": "BTC", "kind": kind, "head": head, "price": price, "mode": "real", "marks": [], "seen": number(now_ms)}
        for span, share in moves.items():
            call["marks"].append({"hours": span, "at": call["at"] + span * hour, "price": price * (1 + share / 100)})
        log["calls"].append(call)

    call(30, "WAIT", "Wait: no buy now", 1_180_000_000, {1: 0.2, 4: -1.4, 24: -2.1})
    call(26, "BUY", "Buy BTC at the next check", 1_186_000_000, {1: 0.6, 4: 2.4, 24: 3.1})
    call(20, "HOLD", "Hold BTC: let it run", 1_214_900_000, {1: -0.3, 4: 0.1, 24: 1.6})
    call(9, "SELL", "Sell BTC at the next check", 1_232_000_000, {1: 0.4, 4: -1.2})
    call(2, "BUY", "Buy BTC at the next check", 1_208_000_000, {1: 0.5})
    log["updated"] = number(now_ms)
    return log


if __name__ == "__main__":
    raise SystemExit(main())
