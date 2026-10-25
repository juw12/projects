#!/usr/bin/env python3
"""Trade Twin: an iPhone-ready investing + day-trading companion.

Wraps two MIT-licensed skill packs by Jake Schincariol:
  * day-trader-skill  (scanner, entry, exit, 10,000-replay Time Machine, sizing, risk)
  * trader-skill      (copy an investor's 13F, news, budget, rebalance)
and adds accounts, a risk/personality profile, paper trading, a goal planner
(10,000 simulated futures), a news feed and a guide.

Standard library only. It never places a real order.

    python apps/trade-twin/server.py          # http://127.0.0.1:8765 on this computer
    python apps/trade-twin/server.py --lan    # also reachable from your phone on the same Wi-Fi

Set TRADE_TWIN_DATA to keep accounts somewhere else (the tests use a temp dir).
"""
import argparse
import hashlib
import hmac
import math
import json
import os
import random
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
DAY = APP_DIR / "vendor" / "day-trader-skill"
INV = APP_DIR / "vendor" / "trader-skill"
DAY_FIX = DAY / "tests" / "fixtures"
STATIC = APP_DIR / "web"
DATA = Path(os.environ.get("TRADE_TWIN_DATA") or APP_DIR / "data").resolve()
USERS_FILE = DATA / "users.json"
SESSIONS_FILE = DATA / "sessions.json"

SESSION_DAYS = 30
LOCK = threading.RLock()
# Routes that read-modify-write the profile run under LOCK so quick double taps can't lose updates.
PROFILE_WRITE_PATHS = {"/api/profile", "/api/quiz", "/api/paper", "/api/paper/order",
                       "/api/paper/copy", "/api/paper/reset"}

# Demo mode replays the day-trader-skill README trade: TSLA, 2026-10-19, 10:15 ET.
DEMO_NOW = "2026-10-19 10:15"
DEMO_NOW_ISO = "2026-10-19T14:15:00Z"
DEMO_DATE = "2026-10-19"

TOOL = {
    "scanner": DAY / "trader-scanner" / "scan.py",
    "news": DAY / "trader-news" / "news.py",
    "entry": DAY / "trader-entry" / "entry.py",
    "exit": DAY / "trader-exit" / "exit.py",
    "timemachine": DAY / "trader-timemachine" / "timemachine.py",
    "budget": DAY / "trader-budget" / "size.py",
    "risk": DAY / "trader-risk" / "check.py",
    "broker": DAY / "trader-broker" / "ticket.py",
    "alerts": DAY / "trader-alerts" / "alerts.py",
    "copycat": INV / "trader-copycat" / "edgar13f.py",
}


VERSION = "1.0.2"


class AppError(Exception):
    pass


# --------------------------------------------------------------- TLS + HTTP

def ca_bundle_path():
    """macOS' bundled Python often lacks CA roots (CERTIFICATE_VERIFY_FAILED).
    Export the system roots once and use them for every HTTPS call."""
    if os.environ.get("SSL_CERT_FILE"):
        return os.environ["SSL_CERT_FILE"]
    if sys.platform != "darwin":
        return None
    bundle = DATA / "cacert.pem"
    if not bundle.exists():
        DATA.mkdir(parents=True, exist_ok=True)
        pem = subprocess.run(
            [
                "security", "find-certificate", "-a", "-p",
                "/System/Library/Keychains/SystemRootCertificates.keychain",
                "/Library/Keychains/System.keychain",
            ],
            capture_output=True,
            text=True,
        ).stdout
        if "BEGIN CERTIFICATE" in pem:
            bundle.write_text(pem)
    return str(bundle) if bundle.exists() else None


CA_BUNDLE = ca_bundle_path()
TOOL_ENV = dict(os.environ)
if CA_BUNDLE:
    TOOL_ENV["SSL_CERT_FILE"] = CA_BUNDLE
SSL_CTX = ssl.create_default_context(cafile=CA_BUNDLE) if CA_BUNDLE else ssl.create_default_context()

_cache = {}


def http_json(url, ttl=60):
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    last_error = None
    for host in ("query2", "query1"):
        target = url.replace("query2.", host + ".")
        request = urllib.request.Request(target, headers={"User-Agent": "Mozilla/5.0 (TradeTwin)"})
        try:
            with urllib.request.urlopen(request, timeout=20, context=SSL_CTX) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            _cache[url] = (time.time(), data)
            return data
        except Exception as exc:  # network, HTTP or JSON error: try the other host
            last_error = exc
    raise AppError("market data unavailable (%s)" % last_error)


# ------------------------------------------------------------- market data

RANGES = {
    "1D": ("1d", "5m", 60),
    "1W": ("5d", "30m", 300),
    "1M": ("1mo", "1d", 900),
    "3M": ("3mo", "1d", 900),
    "1Y": ("1y", "1d", 3600),
    "5Y": ("5y", "1wk", 3600 * 6),
}


def clean_symbol(value):
    symbol = (value or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9.\-^=]{1,12}", symbol):
        raise AppError("enter a ticker symbol, e.g. AAPL")
    return symbol


def chart(symbol, span="1D"):
    symbol = clean_symbol(symbol)
    rng, interval, ttl = RANGES.get(span, RANGES["1D"])
    url = "https://query2.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=%s&includePrePost=false" % (
        urllib.parse.quote(symbol), rng, interval)
    doc = http_json(url, ttl=ttl)
    result = (doc.get("chart") or {}).get("result")
    if not result:
        raise AppError("no data for %s" % symbol)
    result = result[0]
    meta = result.get("meta", {})
    stamps = result.get("timestamp") or []
    closes = ((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    points = [[t, round(c, 4)] for t, c in zip(stamps, closes) if c is not None]
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") if span == "1D" else (points[0][1] if points else None)
    if span == "1D" and meta.get("previousClose"):
        prev = meta.get("previousClose")
    return {
        "symbol": symbol,
        "name": meta.get("longName") or meta.get("shortName") or symbol,
        "price": price,
        "prev": prev,
        "change": (price - prev) if price is not None and prev else None,
        "change_pct": ((price / prev - 1) * 100) if price is not None and prev else None,
        "currency": meta.get("currency", "USD"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "time": meta.get("regularMarketTime"),
        "span": span,
        "points": points,
    }


def quote(symbol):
    data = chart(symbol, "1D")
    data = dict(data)
    data["spark"] = [p[1] for p in data.pop("points")][::3]
    return data


def quotes(symbols):
    out, errors = {}, {}
    for symbol in symbols:
        try:
            out[symbol] = quote(symbol)
        except AppError as exc:
            errors[symbol] = str(exc)
    return {"quotes": out, "errors": errors}


def monthly_returns(symbol):
    """Total-return monthly series (adjusted close, so dividends count).

    Uses an explicit period1/period2 window: with range=max Yahoo silently
    switches long histories (e.g. AAPL since 1984) to quarterly bars. Returns are
    only taken between consecutive calendar months, so a gap can never be
    mistaken for a one-month move."""
    symbol = clean_symbol(symbol)
    url = "https://query2.finance.yahoo.com/v8/finance/chart/%s?period1=0&period2=%d&interval=1mo" % (
        urllib.parse.quote(symbol), int(time.time() // 86400 * 86400))
    doc = http_json(url, ttl=3600 * 12)
    result = (doc.get("chart") or {}).get("result")
    if not result:
        raise AppError("no history for %s" % symbol)
    result = result[0]
    stamps = result.get("timestamp") or []
    adj = ((result.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose")
    if not adj:
        adj = result["indicators"]["quote"][0]["close"]
    by_month = {}
    for ts, value in zip(stamps, adj):
        if value is not None and value > 0:
            by_month[datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m")] = value
    current = datetime.now(timezone.utc).strftime("%Y-%m")
    by_month.pop(current, None)  # the unfinished month is not a full month of returns

    def index(month):
        year, mon = month.split("-")
        return int(year) * 12 + int(mon)

    series = {}
    months = sorted(by_month)
    for prev, month in zip(months, months[1:]):
        if index(month) - index(prev) == 1:
            series[month] = by_month[month] / by_month[prev] - 1
    return series


def pct(values, q):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))]


def goal_sim(weights, years, initial, monthly, goal, paths=10000, seed=19, block=12):
    """10,000 possible futures for a portfolio, built from its own history.

    Block bootstrap: each simulated year is a random run of 12 consecutive real
    months (so bad stretches stay together), rebalanced monthly to the weights."""
    if not weights:
        raise AppError("pick at least one ticker")
    if len(weights) > 8:
        raise AppError("use at most 8 tickers per simulation")
    weights = {clean_symbol(k): number(v, "weight", low=0) for k, v in weights.items()}
    total = sum(weights.values())
    if not math.isfinite(total) or total <= 0:
        raise AppError("at least one weight must be positive")
    weights = {k: v / total for k, v in weights.items() if v > 0}
    series = {sym: monthly_returns(sym) for sym in weights}
    all_months = sorted(set.intersection(*[set(s) for s in series.values()]))
    # Keep one unbroken calendar run: missing months must never be stitched together.
    runs = []
    for month in all_months:
        if not runs or month_serial(month) != month_serial(runs[-1][-1]) + 1:
            runs.append([])
        runs[-1].append(month)
    months = max(runs, key=lambda run: (len(run), run[-1]), default=[])
    if len(months) < 60:
        raise AppError("need at least 5 years of shared history; %d months available" % len(months))
    history = [sum(w * series[s][m] for s, w in weights.items()) for m in months]
    if any(not math.isfinite(r) or r < -1 for r in history):
        raise AppError("invalid historical returns; simulation refused")
    block = int(number(block, "block size", low=1, high=len(history)))

    n_months = int(years * 12)
    rng = random.Random(seed)
    yearly = [[] for _ in range(int(years) + 1)]
    finals = []
    worst_drawdowns = []
    for _ in range(paths):
        value = float(initial)
        unit_value = 1.0
        peak = 1.0
        worst = 0.0
        yearly[0].append(value)
        m = 0
        while m < n_months:
            start = rng.randrange(len(history) - block + 1)
            for k in range(block):
                if m >= n_months:
                    break
                period_return = history[start + k]
                value = (value + monthly) * (1 + period_return)
                # Measure investment drawdown on unit value, not on deposit-inflated cash.
                unit_value *= 1 + period_return
                peak = max(peak, unit_value)
                worst = min(worst, unit_value / peak - 1)
                m += 1
                if m % 12 == 0:
                    yearly[m // 12].append(value)
        finals.append(value)
        worst_drawdowns.append(worst)

    contributed = initial + monthly * n_months
    bands = [[round(pct(v, q), 2) for q in (0.05, 0.25, 0.5, 0.75, 0.95)] for v in yearly]

    # what the history itself looks like
    growth = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in history:
        growth *= 1 + r
        peak = max(peak, growth)
        max_dd = min(max_dd, growth / peak - 1)
    n_years_hist = len(history) / 12
    cagr = growth ** (1 / n_years_hist) - 1
    mean = sum(history) / len(history)
    var = sum((r - mean) ** 2 for r in history) / (len(history) - 1)
    worst_12 = min(compound(history[i:i + 12]) for i in range(len(history) - 11))

    return {
        "weights": {k: round(v * 100, 2) for k, v in weights.items()},
        "years": years,
        "initial": initial,
        "monthly": monthly,
        "goal": goal,
        "paths": paths,
        "seed": seed,
        "contributed": round(contributed, 2),
        "bands": bands,
        "median": round(pct(finals, 0.5), 2),
        "p5": round(pct(finals, 0.05), 2),
        "p95": round(pct(finals, 0.95), 2),
        "p_goal": round(sum(1 for v in finals if v >= goal) / paths, 4) if goal else None,
        "p_loss": round(sum(1 for v in finals if v < contributed) / paths, 4),
        "median_worst_drop": round(pct(worst_drawdowns, 0.5) * 100, 1),
        "bad_case_worst_drop": round(pct(worst_drawdowns, 0.05) * 100, 1),
        "history": {
            "from": months[0],
            "to": months[-1],
            "months": len(months),
            "cagr_pct": round(cagr * 100, 2),
            "vol_pct": round((var ** 0.5) * (12 ** 0.5) * 100, 2),
            "max_drawdown_pct": round(max_dd * 100, 1),
            "worst_12m_pct": round(worst_12 * 100, 1),
        },
        "note": "Built from %s's own monthly total returns %s to %s (block bootstrap, 12-month blocks, "
                "rebalanced monthly). Not a prediction: the future can be worse than any stretch in this history."
                % ("/".join(weights), months[0], months[-1]),
        "warnings": history_warnings(len(months)) + (
            ["Missing shared months: using the longest consecutive history only."]
            if len(months) != len(all_months) else []),
        "drawdown_basis": "time-weighted unit value; deposits excluded",
        "assumptions": [
            "Nominal dollars; inflation, taxes, transaction fees and trading slippage are excluded.",
            "Contributions at the start of each month; fixed weights rebalanced monthly.",
            "Historical sample estimates, not calibrated forecasts or guaranteed outcomes."
        ],
    }


def month_serial(month):
    year, mon = month.split("-")
    return int(year) * 12 + int(mon)


def history_warnings(n_months):
    years = n_months / 12
    if years < 20:
        return ["Only %.0f years of shared history, which may not include a full crash and recovery. "
                "Results are likely too optimistic. For a longer record try SPY (since 1993) "
                "or a mix like SPY + AGG." % years]
    return []


def compound(seq):
    """Total return of a run of monthly returns."""
    growth = 1.0
    for r in seq:
        growth *= 1 + r
    return growth - 1


# ------------------------------------------------------------ users + sessions

def reject_json_constant(value):
    raise ValueError("non-finite JSON value")


def load_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + "." + secrets.token_hex(8) + ".tmp")
    try:
        tmp.write_text(json.dumps(data, indent=2, allow_nan=False))
        tmp.chmod(0o600)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def number(value, name, low=None, high=None, default=None):
    """Parse a user-supplied number: finite, within [low, high], else a friendly AppError."""
    if value in (None, ""):
        if default is not None:
            return default
        raise AppError("%s is required" % name)
    if isinstance(value, bool):
        raise AppError("%s must be a number, not a boolean" % name)
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise AppError("%s must be a number" % name)
    if not math.isfinite(result):
        raise AppError("%s must be a real number" % name)
    if low is not None and result < low:
        raise AppError("%s must be at least %s" % (name, low))
    if high is not None and result > high:
        raise AppError("%s must be at most %s" % (name, high))
    return result


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000).hex()


def user_dir(uid):
    return DATA / "users" / uid


def profile_path(uid):
    return user_dir(uid) / "profile.json"


def default_profile(name, email):
    return {
        "name": name,
        "email": email,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "onboarded": False,
        "quiz": None,
        "watchlist": ["SPY", "AAPL", "MSFT", "NVDA", "TSLA"],
        "budget": 5000,
        "limits": None,
        "paper": {
            "start_cash": 10000.0,
            "cash": 10000.0,
            "positions": {},
            "history": [],
            "snapshots": [],
        },
        "goal": {"tickers": "SPY", "years": 20, "initial": 1000, "monthly": 200, "target": 100000},
        "guide_done": [],
    }


def signup(username, password, name, email):
    username = (username or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9_.]{3,24}", username):
        raise AppError("username: 3-24 letters, numbers, dot or underscore")
    if len(password or "") < 8:
        raise AppError("password must be at least 8 characters")
    if not name or not name.strip():
        raise AppError("enter your name")
    email = (email or "").strip()
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise AppError("that email does not look right")
    with LOCK:
        users = load_json(USERS_FILE, {"users": {}})
        if username in users["users"]:
            raise AppError("that username is taken")
        salt = secrets.token_hex(16)
        uid = secrets.token_hex(8)
        users["users"][username] = {"id": uid, "salt": salt, "hash": hash_password(password, salt)}
        save_json(USERS_FILE, users)
        save_json(profile_path(uid), default_profile(name.strip(), email))
    return uid


_failed_logins = {}


def login(username, password, ip):
    now = time.time()
    attempts = [t for t in _failed_logins.get(ip, []) if now - t < 300]
    if len(attempts) >= 10:
        raise AppError("too many attempts; wait 5 minutes")
    users = load_json(USERS_FILE, {"users": {}})["users"]
    record = users.get((username or "").strip().lower())
    if not record or not hmac.compare_digest(record["hash"], hash_password(password or "", record["salt"])):
        attempts.append(now)
        _failed_logins[ip] = attempts
        raise AppError("wrong username or password")
    return record["id"]


def new_session(uid):
    token = secrets.token_urlsafe(32)
    with LOCK:
        sessions = load_json(SESSIONS_FILE, {})
        sessions[token] = {"uid": uid, "expires": time.time() + SESSION_DAYS * 86400}
        sessions = {k: v for k, v in sessions.items() if v["expires"] > time.time()}
        save_json(SESSIONS_FILE, sessions)
    return token


def session_user(token):
    if not token:
        return None
    entry = load_json(SESSIONS_FILE, {}).get(token)
    if not entry or entry["expires"] < time.time():
        return None
    return entry["uid"]


def end_session(token):
    with LOCK:
        sessions = load_json(SESSIONS_FILE, {})
        sessions.pop(token, None)
        save_json(SESSIONS_FILE, sessions)


def get_profile(uid):
    profile = load_json(profile_path(uid), None)
    if profile is None:
        raise AppError("profile missing")
    return profile


def put_profile(uid, profile):
    with LOCK:
        save_json(profile_path(uid), profile)


# ------------------------------------------------------- personality profile

ARCHETYPES = {
    "builder": {
        "title": "Steady Builder",
        "emoji": "🌱",
        "summary": "You value sleep over thrills. Long horizon, low tolerance for big swings: "
                   "regular investing into broad index funds fits you best.",
        "focus": "invest",
        "suggest": "Start in Invest → Goal planner with a broad index fund (e.g. SPY) and a monthly amount.",
    },
    "grower": {
        "title": "Balanced Grower",
        "emoji": "🌳",
        "summary": "Growth-minded but measured. You can ride out normal dips; a core of index funds "
                   "plus a few companies you understand suits you.",
        "focus": "invest",
        "suggest": "Build a core with the Goal planner, then explore Copy an investor with paper money.",
    },
    "opportunist": {
        "title": "Opportunity Hunter",
        "emoji": "🦊",
        "summary": "Curious, research-driven, comfortable with volatility. You like picking stocks and "
                   "following smart money, holding for weeks to years.",
        "focus": "invest",
        "suggest": "Try Copy an investor, follow your watchlist news, and paper-trade your ideas first.",
    },
    "trader": {
        "title": "Active Trader",
        "emoji": "⚡",
        "summary": "Fast, hands-on and loss-tolerant, with time to watch the market. Day trading is a "
                   "skill game where most beginners lose — your edge is strict rules and small risk.",
        "focus": "trade",
        "suggest": "Learn the Trade flow in Demo, then paper-trade live setups. Let the Time Machine veto bad odds.",
    },
}

# risk level 1..5 -> rule-of-thumb limits (app conventions, not advice)
RISK_TABLE = {
    1: {"risk_pct": 0.25, "trades": 1, "min_rr": 2.0, "target": "2R", "cash_buffer": 20, "max_pos": 25},
    2: {"risk_pct": 0.5, "trades": 2, "min_rr": 2.0, "target": "2R", "cash_buffer": 15, "max_pos": 35},
    3: {"risk_pct": 0.75, "trades": 3, "min_rr": 1.5, "target": "1.5R", "cash_buffer": 10, "max_pos": 50},
    4: {"risk_pct": 1.0, "trades": 3, "min_rr": 1.5, "target": "1.5R", "cash_buffer": 10, "max_pos": 60},
    5: {"risk_pct": 1.0, "trades": 4, "min_rr": 1.0, "target": "1R", "cash_buffer": 10, "max_pos": 75},
}


def score_quiz(answers):
    """answers: {question_id: option_index}. Scores are defined in the client's QUIZ list
    and echoed here so the server is the single source of the result."""
    risk = answers.get("risk_points", [])
    style = answers.get("style_points", [])
    flags = answers.get("flags", [])
    if not risk or not style:
        raise AppError("answer every question")
    if not isinstance(risk, list) or not isinstance(style, list) or len(risk) > 20 or len(style) > 20:
        raise AppError("invalid assessment answers")
    risk = [number(value, "risk answer", low=1, high=5) for value in risk]
    style = [number(value, "style answer", low=1, high=5) for value in style]
    risk_avg = sum(risk) / len(risk)          # 1..5
    style_avg = sum(style) / len(style)       # 1 (long-term investor) .. 5 (active trader)
    level = max(1, min(5, int(math.floor(risk_avg + 0.5))))
    if style_avg >= 3.8 and level >= 3:
        key = "trader"
    elif style_avg >= 2.8 and level >= 3:
        key = "opportunist"
    elif level >= 3 or style_avg >= 2.5:
        key = "grower"
    else:
        key = "builder"
    cautions = []
    if "no_emergency_fund" in flags:
        cautions.append("Build an emergency fund (3–6 months of expenses) before taking real market risk.")
        level = min(level, 2)
    if "need_money_soon" in flags:
        cautions.append("Money you need within ~3 years usually belongs in cash or short-term bonds, not stocks.")
        level = min(level, 2)
    if "panic_seller" in flags:
        cautions.append("You said you'd sell after a big drop. Automate investing and avoid checking prices daily.")
    if key == "trader" and "beginner" in flags:
        cautions.append("You're new: stay on paper money until you have 50+ planned trades logged.")
    if key == "trader" and level < 3:
        key = "opportunist"
    return {
        "archetype": key,
        "risk_level": level,
        "style_score": round(style_avg, 2),
        "risk_score": round(risk_avg, 2),
        "cautions": cautions,
        "taken": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **ARCHETYPES[key],
    }


def limits_for(level, budget):
    row = RISK_TABLE[level]
    per_trade = round(budget * row["risk_pct"] / 100, 2)
    return {
        "budget": budget,
        "risk_pct": row["risk_pct"],
        "max_loss_per_trade_usd": per_trade,
        "max_daily_loss_usd": round(per_trade * 3, 2),
        "max_trades_per_day": row["trades"],
        "min_reward_risk": row["min_rr"],
        "default_target": row["target"],
        "cash_buffer_pct": row["cash_buffer"],
        "max_position_pct": row["max_pos"],
        "max_order_usd": round(budget * row["max_pos"] / 100, 2),
        "flat_by": "15:55",
        "no_entries_before": "09:45",
        "no_entries_after": "15:30",
    }


def sync_trader_config(uid, profile):
    """Write the user's limits into each day-trader workspace's config.json."""
    limits = profile.get("limits") or limits_for(2, profile.get("budget", 5000))
    agent = "%s %s" % (profile.get("name", "").replace(" ", ""), profile.get("email", "")) if profile.get("email") else ""
    for mode in ("demo", "live"):
        root = trader_root(uid, mode)
        path = root / "trader" / "config.json"
        config = load_json(path, None) or load_json(DAY / "trader-budget" / "config.example.json", {})
        for key in ("budget", "max_loss_per_trade_usd", "max_daily_loss_usd", "max_trades_per_day",
                    "min_reward_risk", "cash_buffer_pct", "max_position_pct", "max_order_usd",
                    "flat_by", "no_entries_before", "no_entries_after"):
            if key in limits:
                config[key] = limits[key]
        config["sec_user_agent"] = agent
        config.update({"paper": True, "allow_options": False, "allow_margin": False, "allow_short": False})
        save_json(path, config)


def trader_root(uid, mode):
    root = user_dir(uid) / ("demo" if mode == "demo" else "live")
    (root / "trader" / "state").mkdir(parents=True, exist_ok=True)
    config = root / "trader" / "config.json"
    if not config.exists():
        shutil.copy(DAY / "trader-budget" / "config.example.json", config)
    return root


# ------------------------------------------------------------ paper trading

def paper_value(paper, prices):
    holdings = sum(pos["qty"] * prices.get(sym, pos["cost"] / max(pos["qty"], 1e-9)) for sym, pos in paper["positions"].items())
    return round(paper["cash"] + holdings, 2)


def paper_state(profile):
    paper = profile["paper"]
    symbols = list(paper["positions"])
    data = quotes(symbols) if symbols else {"quotes": {}, "errors": {}}
    prices = {s: q["price"] for s, q in data["quotes"].items()}
    rows = []
    for sym, pos in paper["positions"].items():
        q = data["quotes"].get(sym, {})
        price = q.get("price") or pos["cost"] / pos["qty"]
        rows.append({
            "symbol": sym,
            "name": q.get("name", sym),
            "qty": round(pos["qty"], 6),
            "avg_cost": round(pos["cost"] / pos["qty"], 4),
            "price": price,
            "value": round(pos["qty"] * price, 2),
            "gain": round(pos["qty"] * price - pos["cost"], 2),
            "gain_pct": round((pos["qty"] * price / pos["cost"] - 1) * 100, 2) if pos["cost"] else 0,
            "day_pct": q.get("change_pct"),
            "spark": q.get("spark", []),
        })
    rows.sort(key=lambda r: -r["value"])
    value = paper_value(paper, prices)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    snaps = paper.setdefault("snapshots", [])
    if snaps and snaps[-1][0] == today:
        snaps[-1][1] = value
    else:
        snaps.append([today, value])
    return {
        "cash": round(paper["cash"], 2),
        "start_cash": paper["start_cash"],
        "value": value,
        "gain": round(value - paper["start_cash"], 2),
        "gain_pct": round((value / paper["start_cash"] - 1) * 100, 2),
        "positions": rows,
        "history": paper["history"][-50:][::-1],
        "snapshots": snaps[-365:],
        "errors": data["errors"],
    }


def paper_order(profile, symbol, side, dollars=None, qty=None, note=""):
    symbol = clean_symbol(symbol)
    if side not in ("buy", "sell"):
        raise AppError("side must be buy or sell")
    paper = profile["paper"]
    # Validate the amount before any price lookup.
    amount = number(dollars, "amount", low=0) if dollars not in (None, "") else None
    shares = number(qty, "quantity", low=0, default=0.0) if amount is None else None
    if not (amount or shares):
        raise AppError("enter an amount")
    q = quote(symbol)
    price = q["price"]
    if not price:
        raise AppError("no price for %s" % symbol)
    qty = amount / price if amount is not None else shares
    pos = paper["positions"].get(symbol)
    if side == "buy":
        cost = qty * price
        if cost > paper["cash"] + 0.005:
            raise AppError("not enough paper cash ($%.2f available)" % paper["cash"])
        paper["cash"] -= cost
        if pos:
            pos["qty"] += qty
            pos["cost"] += cost
        else:
            paper["positions"][symbol] = {"qty": qty, "cost": cost}
    elif side == "sell":
        if not pos or pos["qty"] + 1e-9 < qty:
            raise AppError("you hold %.4f %s" % (pos["qty"] if pos else 0, symbol))
        avg = pos["cost"] / pos["qty"]
        paper["cash"] += qty * price
        pos["qty"] -= qty
        pos["cost"] -= avg * qty
        if pos["qty"] < 1e-6:
            del paper["positions"][symbol]
    else:
        raise AppError("side must be buy or sell")
    paper["history"].append({
        "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "side": side,
        "symbol": symbol,
        "qty": round(qty, 6),
        "price": price,
        "amount": round(qty * price, 2),
        "note": note,
    })
    return {"symbol": symbol, "side": side, "qty": round(qty, 6), "price": price, "amount": round(qty * price, 2)}


# ------------------------------------------------------------ skill tools

def run_tool(uid, mode, args, timeout=180):
    root = trader_root(uid, mode)
    command = [sys.executable] + [str(a) for a in args]
    try:
        proc = subprocess.run(command, cwd=root, env=TOOL_ENV, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise AppError("that took too long; try again with fewer symbols")
    data = None
    if proc.stdout.strip():
        try:
            data = json.loads(proc.stdout)
        except ValueError:
            data = None
    return {
        "ok": proc.returncode == 0,
        "code": proc.returncode,
        "data": data,
        "stdout": proc.stdout if data is None else "",
        "stderr": proc.stderr.strip(),
    }


def opt(args, flag, value):
    if value not in (None, ""):
        args += [flag, str(value)]


PIPELINE_STEPS = ("entry", "exit", "timemachine", "budget", "risk", "broker")
PIPELINE_FILES = ("entry.json", "plan.json", "timemachine.json", "orders.json", "state/risk.json")
TRADE_LOCKS = {}


def day_trade_step(uid, step, mode, params, run_id=None):
    """Bind every hand-off to one completed run and the current limits.

    Clear stale outputs before attempting a new step; reject interleaved tabs,
    old tokens, expired live runs, and a ticket without a successful risk check.
    """
    with LOCK:
        run_lock = TRADE_LOCKS.setdefault((uid, mode), threading.RLock())
    with run_lock:
        if step in ("clock", "scanner"):
            return execute_trade_step(uid, step, mode, params)
        if step not in PIPELINE_STEPS:
            raise AppError("unknown trade step")
        root = trader_root(uid, mode) / "trader"
        state_path = root / "state/pipeline.json"
        fingerprint = hashlib.sha256((root / "config.json").read_bytes()).hexdigest()
        if step == "entry":
            run = {"id": secrets.token_hex(16), "completed": [], "config": fingerprint, "started": time.time()}
        else:
            run = load_json(state_path, {})
            if not run_id or run_id != run.get("id"):
                raise AppError("This trade run is stale. Start a new check from Entry.")
            if run.get("config") != fingerprint:
                raise AppError("Your limits changed. Start a new trade check.")
            if mode == "live" and time.time() - run.get("started", 0) > 300:
                raise AppError("This live check expired after five minutes. Run it again.")
            previous = PIPELINE_STEPS[PIPELINE_STEPS.index(step) - 1]
            if previous not in run.get("completed", []):
                raise AppError("Complete %s successfully before %s." % (previous, step))
        index = PIPELINE_STEPS.index(step)
        run["completed"] = list(PIPELINE_STEPS[:index]) if index else []
        for relative in PIPELINE_FILES[index:]:
            (root / relative).unlink(missing_ok=True)
        save_json(state_path, run)
        result = execute_trade_step(uid, step, mode, params)
        data = result.get("data") or {}
        complete = result.get("ok", False)
        if step == "entry":
            complete = complete and data.get("status") == "triggered"
        if step == "budget":
            complete = complete and not data.get("sizing", {}).get("refusal")
        if complete:
            run["completed"].append(step)
        save_json(state_path, run)
        result["run_id"] = run["id"]
        return result


def execute_trade_step(uid, step, mode, p):
    demo = mode == "demo"
    clock = ["--now", DEMO_NOW] if demo else []
    if step == "scanner":
        args = [TOOL["scanner"], "orb", "--json", "--show", "100"]
        if demo:
            args += ["--offline", DAY_FIX / "trader-scanner" / "wall5m-2026-10-19.json.gz"]
        else:
            symbols = (p.get("symbols") or "").replace(" ", "").upper()
            if not symbols:
                raise AppError("enter symbols to scan, e.g. AAPL,TSLA,NVDA")
            args += ["--symbols", symbols]
        return run_tool(uid, mode, args + clock, timeout=600)
    if step == "entry":
        symbol = clean_symbol(p.get("symbol"))
        args = [TOOL["entry"], "check", symbol, "--write", "--json"]
        opt(args, "--or-minutes", p.get("or_minutes"))
        if demo:
            if symbol != "TSLA":
                raise AppError("demo data only has TSLA; switch to Live for other tickers")
            args += ["--offline", DAY_FIX / "trader-entry" / "TSLA-2026-10-19-5m.json"]
        return run_tool(uid, mode, args + clock)
    if step == "exit":
        args = [TOOL["exit"], "plan", "--write", "--json"]
        opt(args, "--stop", p.get("stop_rule") or "or-mid")
        opt(args, "--target", p.get("target_rule") or "2R")
        return run_tool(uid, mode, args + clock)
    if step == "timemachine":
        args = [TOOL["timemachine"], "run", "--write", "--json"]
        opt(args, "--replays", int(p.get("replays") or 10000))
        opt(args, "--seed", p.get("seed") or 19)
        flat_by = load_json(trader_root(uid, mode) / "trader/plan.json", {}).get("flat_by", "15:55")
        opt(args, "--until", flat_by)
        replays = int(number(p.get("replays"), "replays", low=100, high=20000, default=10000))
        args[args.index("--replays") + 1] = str(replays)
        if p.get("manual"):
            args += ["--symbol", clean_symbol(p.get("symbol"))]
            for key in ("entry", "stop", "target"):
                if p.get(key) in (None, ""):
                    raise AppError("manual mode needs entry, stop and target")
                args += ["--" + key, str(float(p[key]))]
            opt(args, "--date", p.get("date"))
            opt(args, "--entry-time", p.get("entry_time"))
        if demo:
            args += ["--offline", DAY_FIX / "trader-timemachine" / "TSLA-60d5m.json.gz"]
        return run_tool(uid, mode, args + clock, timeout=300)
    if step == "budget":
        return run_tool(uid, mode, [TOOL["budget"], "--write", "--json"] + clock)
    if step == "risk":
        args = [TOOL["risk"], "--json"] + (["--today", DEMO_DATE] if demo else [])
        return run_tool(uid, mode, args + clock)
    if step == "broker":
        args = [TOOL["broker"], "show", "--json"] + (["--today", DEMO_DATE] if demo else [])
        return run_tool(uid, mode, args + clock)
    if step == "clock":
        return run_tool(uid, mode, [TOOL["alerts"], "clock", "--json"] + clock)
    raise AppError("unknown step %s" % step)


def sec_agent(profile):
    if not profile.get("email"):
        raise AppError("SEC asks every app to identify itself: add your email in Me → Profile first")
    return "%s %s" % (re.sub(r"\s+", "", profile.get("name") or "TradeTwinUser"), profile["email"])


def copycat(uid, profile, action, p):
    if action == "filers":
        filers = load_json(INV / "trader-copycat" / "filers.json", {"filers": []})["filers"]
        return {"filers": [{"cik": f["cik"], "name": f["name"], "person": f.get("person", "")} for f in filers]}
    cik = re.sub(r"\D", "", str(p.get("cik") or ""))
    if not cik:
        raise AppError("pick an investor")
    base = ["--user-agent", sec_agent(profile), "--json"]
    if action == "copy":
        top = int(p.get("top") or 10)
        return run_tool(uid, "live", [TOOL["copycat"], "copy", cik, "--top", str(top), "--combine",
                                      "--out", "trader/targets.json", *base], timeout=240)
    if action == "diff":
        return run_tool(uid, "live", [TOOL["copycat"], "diff", cik, "--combine", *base], timeout=240)
    raise AppError("unknown copycat action")


def news_feed(uid, profile, p):
    tickers = [clean_symbol(t) for t in (p.get("tickers") or [])] or list(dict.fromkeys(
        profile.get("watchlist", []) + list(profile["paper"]["positions"])))[:15]
    if not tickers:
        raise AppError("add tickers to your watchlist first")
    args = [TOOL["news"], "--tickers", *tickers, "--hours", str(p.get("hours") or 48),
            "--all", "--dry-run", "--json"]
    if p.get("sec") and profile.get("email"):
        args += ["--user-agent", sec_agent(profile)]
    else:
        args += ["--no-sec"]
    result = run_tool(uid, "live", args, timeout=240)
    result["tickers"] = tickers
    return result


# ------------------------------------------------------------------ HTTP

def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "TradeTwin/2.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[tt] %s %s\n" % (self.address_string(), fmt % args))

    # -- helpers
    def cookie_token(self):
        for part in (self.headers.get("Cookie") or "").split(";"):
            key, _, value = part.strip().partition("=")
            if key == "tt_session":
                return value
        return None

    def send_json(self, payload, status=200, cookie=None):
        body = json.dumps(payload, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def session_cookie(self, token, max_age):
        return "tt_session=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d" % (token, max_age)

    def send_static(self, rel):
        root = STATIC.resolve()
        path = (root / rel).resolve()
        if root not in path.parents or not path.is_file() or path.name.startswith("."):
            self.send_json({"error": "not found"}, 404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(path.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    # -- routes
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "app": "trade-twin", "version": VERSION})
        elif path in ("/", ""):
            self.send_static("index.html")
        else:
            self.send_static(urllib.parse.unquote(path.lstrip("/")))

    def do_POST(self):
        origin = self.headers.get("Origin")
        if origin and urllib.parse.urlparse(origin).netloc != self.headers.get("Host"):
            self.send_json({"error": "forbidden origin"}, 403)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > 1_000_000:
            self.send_json({"error": "too large"}, 413)
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}", parse_constant=reject_json_constant)
            if not isinstance(body, dict):
                raise ValueError("expected an object")
        except ValueError:
            self.send_json({"error": "bad JSON"}, 400)
            return
        path = urllib.parse.urlparse(self.path).path
        try:
            self.route(path, body)
        except (TypeError, KeyError, ValueError) as exc:
            self.send_json({"ok": False, "error": "Invalid request fields."}, 400)
        except AppError as exc:
            self.send_json({"ok": False, "error": str(exc)})
        except Exception as exc:  # keep the app alive; show the problem
            self.log_message("Request failed: %s", type(exc).__name__)
            self.send_json({"ok": False, "error": "Internal error; the operation could not complete."}, 500)

    def route(self, path, body):
        if path == "/api/signup":
            uid = signup(body.get("username"), body.get("password"), body.get("name"), body.get("email"))
            token = new_session(uid)
            profile = get_profile(uid)
            sync_trader_config(uid, profile)
            self.send_json({"ok": True, "profile": profile}, cookie=self.session_cookie(token, SESSION_DAYS * 86400))
            return
        if path == "/api/login":
            uid = login(body.get("username"), body.get("password"), self.client_address[0])
            token = new_session(uid)
            self.send_json({"ok": True, "profile": get_profile(uid)}, cookie=self.session_cookie(token, SESSION_DAYS * 86400))
            return

        token = self.cookie_token()
        uid = session_user(token)
        if not uid:
            self.send_json({"ok": False, "error": "login required", "auth": False}, 401)
            return

        if path == "/api/logout":
            end_session(token)
            self.send_json({"ok": True}, cookie=self.session_cookie("", 0))
            return

        if path in PROFILE_WRITE_PATHS:
            with LOCK:
                self.route_user(path, body, uid)
        else:
            self.route_user(path, body, uid)

    def route_user(self, path, body, uid):
        profile = get_profile(uid)

        if path == "/api/me":
            self.send_json({"ok": True, "profile": profile})
        elif path == "/api/profile":
            if "name" in body:
                name = body["name"]
                if not isinstance(name, str) or not name.strip() or len(name) > 80:
                    raise AppError("name must contain 1–80 characters")
                profile["name"] = name.strip()
            if "email" in body:
                email = body["email"]
                if not isinstance(email, str) or len(email) > 254 or (email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email)):
                    raise AppError("enter a valid email, or leave it blank")
                profile["email"] = email.strip()
            for key in ("watchlist", "guide_done"):
                if key in body and (not isinstance(body[key], list) or len(body[key]) > 100 or
                                    any(not isinstance(item, str) or len(item) > 80 for item in body[key])):
                    raise AppError("invalid " + key)
            if "guide_done" in body:
                profile["guide_done"] = list(dict.fromkeys(body["guide_done"]))
            if "onboarded" in body:
                profile["onboarded"] = bool(body["onboarded"])
            if "watchlist" in body:
                profile["watchlist"] = list(dict.fromkeys(clean_symbol(s) for s in body["watchlist"]))[:40]
            if "budget" in body:
                budget = number(body["budget"], "budget", low=1, high=1e9)
                profile["budget"] = budget
                level = (profile.get("quiz") or {}).get("risk_level", 2)
                profile["limits"] = limits_for(level, budget)
            if "limits" in body and isinstance(body["limits"], dict):
                limits = profile.get("limits") or limits_for(2, profile.get("budget", 5000))
                bounds = {
                    "budget": (1, 1e9), "risk_pct": (0, 100),
                    "max_loss_per_trade_usd": (0, 1e9), "max_daily_loss_usd": (0, 1e9),
                    "max_trades_per_day": (1, 100), "min_reward_risk": (0.1, 20),
                    "cash_buffer_pct": (0, 99), "max_position_pct": (1, 100),
                    "max_order_usd": (0, 1e9),
                }
                for key, value in body["limits"].items():
                    if key not in limits or value in (None, ""):
                        continue
                    if key == "default_target":
                        if value not in ("1R", "1.5R", "2R", "3R"):
                            raise AppError("invalid default target")
                        limits[key] = value
                    elif key in ("flat_by", "no_entries_before", "no_entries_after"):
                        if not isinstance(value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
                            raise AppError("time must be HH:MM")
                        limits[key] = value
                    elif key in bounds:
                        low, high = bounds[key]
                        parsed = number(value, key, low=low, high=high)
                        if key == "max_trades_per_day" and not parsed.is_integer():
                            raise AppError("trades per day must be a whole number")
                        limits[key] = int(parsed) if key == "max_trades_per_day" else parsed
                profile["limits"] = limits
            put_profile(uid, profile)
            sync_trader_config(uid, profile)
            self.send_json({"ok": True, "profile": profile})
        elif path == "/api/quiz":
            result = score_quiz(body.get("answers") or {})
            profile["quiz"] = result
            profile["limits"] = limits_for(result["risk_level"], profile.get("budget", 5000))
            if body.get("paper_cash"):
                cash = number(body["paper_cash"], "practice money", low=100, high=1e9)
                if not profile["paper"]["positions"] and not profile["paper"]["history"]:
                    profile["paper"]["cash"] = cash
                    profile["paper"]["start_cash"] = cash
            put_profile(uid, profile)
            sync_trader_config(uid, profile)
            self.send_json({"ok": True, "profile": profile})
        elif path == "/api/quotes":
            symbols = [clean_symbol(s) for s in (body.get("symbols") or profile["watchlist"])][:40]
            self.send_json({"ok": True, **quotes(symbols)})
        elif path == "/api/chart":
            self.send_json({"ok": True, "data": chart(body.get("symbol"), body.get("span") or "1D")})
        elif path == "/api/paper":
            state = paper_state(profile)
            put_profile(uid, profile)
            self.send_json({"ok": True, "paper": state})
        elif path == "/api/paper/order":
            fill = paper_order(profile, body.get("symbol"), body.get("side"), body.get("dollars"), body.get("qty"), body.get("note", ""))
            state = paper_state(profile)
            put_profile(uid, profile)
            self.send_json({"ok": True, "fill": fill, "paper": state})
        elif path == "/api/paper/copy":
            weights = body.get("weights") or []
            amount = number(body.get("amount"), "amount", default=0.0)
            if amount <= 0 or amount > profile["paper"]["cash"] + 0.005:
                raise AppError("amount must be between $0 and your paper cash ($%.2f)" % profile["paper"]["cash"])
            fills, errors = [], []
            weights = [w for w in weights if isinstance(w, dict) and w.get("ticker")]
            for w in weights:
                w["weight"] = number(w.get("weight"), "weight", low=0)
            total = sum(w["weight"] for w in weights) or 1
            for w in weights:
                dollars = amount * w["weight"] / total
                try:
                    fills.append(paper_order(profile, w["ticker"], "buy", dollars=dollars, note=body.get("note", "copy")))
                except AppError as exc:
                    errors.append("%s: %s" % (w.get("ticker"), exc))
            state = paper_state(profile)
            put_profile(uid, profile)
            self.send_json({"ok": True, "fills": fills, "errors": errors, "paper": state})
        elif path == "/api/paper/reset":
            cash = number(body.get("cash"), "practice money", low=100, high=1e9,
                          default=float(profile["paper"]["start_cash"]))
            profile["paper"] = default_profile("", "")["paper"]
            profile["paper"]["cash"] = cash
            profile["paper"]["start_cash"] = cash
            put_profile(uid, profile)
            self.send_json({"ok": True, "paper": paper_state(profile)})
        elif path == "/api/goal":
            tickers = list(dict.fromkeys(clean_symbol(t) for t in re.split(r"[,\s]+", body.get("tickers") or "") if t))
            raw_weights = body.get("weights") or {}
            weights = {t: number(raw_weights.get(t, 1), "weight", low=0) for t in tickers}
            years = int(round(number(body.get("years"), "years", low=1, high=40, default=20.0)))
            result = goal_sim(
                weights,
                years,
                number(body.get("initial"), "starting amount", low=0, high=1e10, default=0.0),
                number(body.get("monthly"), "monthly amount", low=0, high=1e8, default=0.0),
                number(body.get("target"), "goal", low=0, high=1e12, default=0.0),
                paths=10000,
            )
            with LOCK:
                fresh = get_profile(uid)  # the simulation is slow; don't overwrite trades made meanwhile
                fresh["goal"] = {"tickers": ",".join(tickers), "years": years, "initial": body.get("initial"),
                                 "monthly": body.get("monthly"), "target": body.get("target")}
                put_profile(uid, fresh)
            self.send_json({"ok": True, "result": result})
        elif path == "/api/news":
            self.send_json(news_feed(uid, profile, body))
        elif path == "/api/copycat":
            self.send_json(copycat(uid, profile, body.get("action"), body))
        elif path == "/api/trade":
            mode = "demo" if body.get("mode") == "demo" else "live"
            result = day_trade_step(uid, body.get("step"), mode, body.get("params") or {}, body.get("run_id"))
            result["step"] = body.get("step")
            self.send_json(result)
        elif path == "/api/trade/reset":
            mode = "demo" if body.get("mode") == "demo" else "live"
            trader = trader_root(uid, mode) / "trader"
            for child in trader.iterdir():
                if child.name != "config.json":
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
            trader_root(uid, mode)
            self.send_json({"ok": True})
        else:
            self.send_json({"error": "not found"}, 404)


def main():
    ap = argparse.ArgumentParser(description="Trade Twin server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--lan", action="store_true", help="listen on your Wi-Fi so your iPhone can connect")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    for repo in (DAY, INV):
        if not repo.exists():
            sys.exit("missing %s (see README)" % repo)
    DATA.mkdir(parents=True, exist_ok=True)
    host = "0.0.0.0" if a.lan else "127.0.0.1"
    server = ThreadingHTTPServer((host, a.port), Handler)
    local = "http://127.0.0.1:%d" % a.port
    print("Trade Twin is running.")
    print("  On this Mac:   %s" % local)
    if a.lan:
        print("  On your iPhone (same Wi-Fi): http://%s:%d" % (lan_ip(), a.port))
        print("  In Safari: Share → Add to Home Screen")
    print("Ctrl+C to stop.")
    if not a.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(local)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
