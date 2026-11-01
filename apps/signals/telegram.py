"""Telegram Bot API notifier. Direct HTTP — no library dependency."""
from __future__ import annotations

import requests

API = "https://api.telegram.org"


def send(token: str, chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    if not token or not chat_id:
        return False
    url = f"{API}/bot{token}/sendMessage"
    try:
        r = requests.post(
            url,
            json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode, "disable_web_page_preview": True},
            timeout=10,
        )
        if r.status_code != 200:
            print(f"[telegram] {r.status_code}: {r.text[:200]}")
            return False
        return True
    except requests.RequestException as e:
        print(f"[telegram] network error: {e}")
        return False


def format_signal(s, atr_value: float, balance: float, risk_pct: float) -> str:
    """Render a Signal + sizing as a Telegram message."""
    if not s.side:
        return ""
    rr = abs(s.target - s.entry) / max(abs(s.entry - s.stop), 1e-9)
    risk_usd = balance * risk_pct
    stop_dist = abs(s.entry - s.stop)
    size_units = risk_usd / stop_dist if stop_dist > 0 else 0.0
    arrow = "🟢 LONG" if s.side == "LONG" else "🔴 SHORT"
    return (
        f"{arrow} <b>{s.symbol}</b> ({s.timeframe})\n"
        f"Entry: <code>{s.entry:.4f}</code>\n"
        f"Stop:  <code>{s.stop:.4f}</code>  ({abs(s.entry - s.stop) / s.entry * 100:.2f}%)\n"
        f"Target:<code>{s.target:.4f}</code>  (R:R {rr:.1f})\n"
        f"Size:  <code>{size_units:.4f}</code> units (${risk_usd:.2f} risk)\n"
        f"ATR:   <code>{atr_value:.4f}</code>   RSI: <code>{s.rsi:.1f}</code>   Hist: <code>{s.macd_hist:.4f}</code>\n"
        f"\nReason: {s.reason}"
    )
