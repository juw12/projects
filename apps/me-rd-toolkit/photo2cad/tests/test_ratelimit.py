#!/usr/bin/env python3
"""Hermetic tests for the demo rate limiter (no network, stdlib only).

Run with any Python 3.10+:  python tests/test_ratelimit.py
Exits 0 on success, 1 on failure.
"""
import pathlib
import sys

APP = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP / "server"))

import ratelimit  # noqa: E402


def main():
    # --- per-IP daily cap --------------------------------------------------
    rl = ratelimit.RateLimiter(per_ip_per_day=2)
    assert rl.begin("1.1.1.1").allowed
    assert rl.begin("1.1.1.1").allowed
    denied = rl.begin("1.1.1.1")
    assert not denied.allowed and denied.reason == "per_ip", denied
    assert denied.retry_after > 0, "per-IP denial should hint a retry"
    assert rl.begin("2.2.2.2").allowed, "another IP must be unaffected"

    # --- global daily cap --------------------------------------------------
    rg = ratelimit.RateLimiter(global_per_day=2)
    assert rg.begin("a").allowed and rg.begin("b").allowed
    denied = rg.begin("c")
    assert not denied.allowed and denied.reason == "global", denied

    # --- concurrency ceiling ----------------------------------------------
    rc = ratelimit.RateLimiter(max_concurrent=1)
    assert rc.begin("a").allowed
    denied = rc.begin("b")
    assert not denied.allowed and denied.reason == "busy", denied
    rc.end()                                    # release the in-flight slot
    assert rc.begin("b").allowed, "concurrency slot should free up after end()"

    # --- end() balances the active counter even if over-released ----------
    rc.end(); rc.end()                          # extra ends must not go negative
    assert rc.snapshot()["active"] == 0, rc.snapshot()

    # --- generation counter only counts successful builds -----------------
    rgen = ratelimit.RateLimiter()
    rgen.begin("x"); rgen.end(generated=True)
    rgen.begin("y"); rgen.end(generated=False)
    assert rgen.generated_total == 1, rgen.generated_total

    # --- daily reset (patch the day source) -------------------------------
    rday = ratelimit.RateLimiter(per_ip_per_day=1)
    assert rday.begin("z").allowed
    assert not rday.begin("z").allowed
    original = ratelimit._today_utc
    ratelimit._today_utc = lambda: "2999-01-01"   # simulate a new UTC day
    try:
        assert rday.begin("z").allowed, "caps must reset on a new day"
    finally:
        ratelimit._today_utc = original

    # --- snapshot shape ----------------------------------------------------
    snap = ratelimit.RateLimiter(per_ip_per_day=3, global_per_day=10, max_concurrent=2).snapshot()
    for key in ("day", "active", "global_today", "generated_total",
                "per_ip_per_day", "global_per_day", "max_concurrent"):
        assert key in snap, "snapshot missing %s" % key

    print("PASS test_ratelimit (7 checks)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 - test harness
        print("FAIL test_ratelimit:", exc)
        sys.exit(1)
