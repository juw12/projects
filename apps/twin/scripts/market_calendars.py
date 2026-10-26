#!/usr/bin/env python3
"""Build web/demo/calendars.json: real trading calendars for every exchange Twin knows.

Uses the open-source `exchange_calendars` package (pip install exchange_calendars) to list,
per exchange: regular session hours (local time), lunch breaks, weekend pattern, public
holidays and early closes / late opens, from 30 days ago to about a year ahead.

The web app and the local server read the JSON; neither needs the package at run time.
Re-run (or let the Pages workflow run it) to roll the window forward.

    python apps/twin/scripts/market_calendars.py           # write the file
    python apps/twin/scripts/market_calendars.py --check   # validate the existing file
"""
import argparse
import json
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "web" / "demo" / "calendars.json"

# Yahoo suffix -> ISO 10383 MIC used by exchange_calendars ("" = US listings).
SUFFIX_TO_MIC = {
    "": "XNYS", "TO": "XTSE", "V": "XTSE", "NE": "XTSE", "SA": "BVMF", "MX": "XMEX",
    "L": "XLON", "IR": "XDUB", "DE": "XETR", "F": "XFRA", "PA": "XPAR", "AS": "XAMS",
    "BR": "XBRU", "LS": "XLIS", "MI": "XMIL", "MC": "XMAD", "VI": "XWBO", "SW": "XSWX",
    "ST": "XSTO", "CO": "XCSE", "HE": "XHEL", "OL": "XOSL", "WA": "XWAR", "IS": "XIST",
    "T": "XTKS", "HK": "XHKG", "SS": "XSHG", "SZ": "XSHG", "TW": "XTAI", "TWO": "XTAI",
    "KS": "XKRX", "KQ": "XKRX", "NS": "XBOM", "BO": "XBOM", "JK": "XIDX", "SI": "XSES",
    "KL": "XKLS", "BK": "XBKK", "PS": "XPHS", "AX": "XASX", "NZ": "XNZE", "JO": "XJSE",
    "SR": "XSAU", "TA": "XTAE",
}
# Exchanges Twin lists but exchange_calendars does not cover (weekday rules only).
UNCOVERED = ["QA", "AE"]


def local_hhmm(ts, tz):
    return ts.tz_convert(tz).strftime("%H:%M")


def build_one(mic, start, end):
    import exchange_calendars as xc

    try:
        cal = xc.get_calendar(mic, start=start.isoformat(), end=end.isoformat())
    except ValueError as exc:
        # Some exchanges publish holidays only through a given year (e.g. XSHG); stop there.
        match = re.search(r"only recorded to the year (\d{4})", str(exc))
        if not match:
            raise
        end = date(int(match.group(1)), 12, 31)
        cal = xc.get_calendar(mic, start=start.isoformat(), end=end.isoformat())
    tz = str(cal.tz)
    schedule = cal.schedule
    opens = [local_hhmm(ts, tz) for ts in schedule["open"]]
    closes = [local_hhmm(ts, tz) for ts in schedule["close"]]
    regular_open = Counter(opens).most_common(1)[0][0]
    regular_close = Counter(closes).most_common(1)[0][0]
    lunch = None
    if "break_start" in schedule and schedule["break_start"].notna().any():
        starts = [local_hhmm(ts, tz) for ts in schedule["break_start"].dropna()]
        ends = [local_hhmm(ts, tz) for ts in schedule["break_end"].dropna()]
        lunch = [Counter(starts).most_common(1)[0][0], Counter(ends).most_common(1)[0][0]]

    weekmask = str(cal.weekmask)  # e.g. "1111100" = Mon-Fri
    sessions = {ts.date() for ts in schedule.index}
    holidays = []
    day = start
    while day <= end:
        if weekmask[day.weekday()] == "1" and day not in sessions:
            holidays.append(day.isoformat())
        day += timedelta(days=1)

    early, late = {}, {}
    for session, open_ts, close_ts in zip(schedule.index, opens, closes):
        key = session.date().isoformat()
        if close_ts != regular_close:
            early[key] = close_ts
        if open_ts != regular_open:
            late[key] = open_ts
    return {
        "mic": mic, "tz": tz, "weekmask": weekmask, "open": regular_open, "close": regular_close,
        "valid_to": end.isoformat(),
        "lunch": lunch, "holidays": holidays, "early_close": early, "late_open": late,
    }


def build():
    today = date.today()
    start = today - timedelta(days=30)
    end = today + timedelta(days=395)
    by_mic = {}
    exchanges = {}
    for suffix, mic in SUFFIX_TO_MIC.items():
        if mic not in by_mic:
            by_mic[mic] = build_one(mic, start, end)
        exchanges[suffix] = by_mic[mic]
    return {
        "source": "exchange_calendars (github.com/gerrymanoim/exchange_calendars)",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "valid_from": start.isoformat(),
        "valid_to": end.isoformat(),
        "earliest_exchange_end": min(cal["valid_to"] for cal in by_mic.values()),
        "uncovered": UNCOVERED,
        "exchanges": exchanges,
    }


def check(path=OUT):
    data = json.loads(path.read_text())
    problems = []
    exchanges = data.get("exchanges", {})
    for suffix in SUFFIX_TO_MIC:
        cal = exchanges.get(suffix)
        if not cal:
            problems.append("missing %r" % suffix)
            continue
        if len(cal.get("weekmask", "")) != 7:
            problems.append("%s: bad weekmask" % suffix)
        for key in ("open", "close"):
            if not isinstance(cal.get(key), str) or len(cal[key]) != 5:
                problems.append("%s: bad %s" % (suffix, key))
    us = exchanges.get("", {})
    christmas = [d for d in us.get("holidays", []) if d.endswith("-12-25")]
    if not christmas and data.get("valid_to", "") >= "%s-12-25" % data.get("valid_from", "0000")[:4]:
        problems.append("US calendar lacks Christmas")
    if data.get("valid_to", "") < date.today().isoformat():
        problems.append("calendar window has expired (valid_to %s)" % data.get("valid_to"))
    if problems:
        print("calendars.json problems:\n  " + "\n  ".join(problems))
        return 1
    mics = {cal["mic"] for cal in exchanges.values()}
    total = sum(len(cal["holidays"]) for cal in {c["mic"]: c for c in exchanges.values()}.values())
    print("calendars.json: %d suffixes, %d exchanges, %d holidays, valid %s..%s" % (
        len(exchanges), len(mics), total, data["valid_from"], data["valid_to"]))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="validate the existing file and exit")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    if args.check:
        return check(args.out)
    data = build()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True))
    return check(args.out)


if __name__ == "__main__":
    sys.exit(main())
