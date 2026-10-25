# Trade Twin 1.0.2 — second audit

## Verified fixes

| Problem | Change | Regression evidence |
| --- | --- | --- |
| New deposits concealed investment drawdowns | Track time-weighted unit value independently of the account cash balance | Same returns and seed, very different contributions: identical drawdowns in Python and browser |
| Missing months and circular blocks invented historical sequences | Use longest consecutive shared history; sample full non-wrapping blocks | Synthetic gaps and a forced final block |
| Same ticker entered twice distorted browser allocations | Deduplicate tickers; validate positive finite total weight and cap symbols | Duplicate-ticker browser run, zero/NaN weight rejection |
| Replay continued after the planned flat-by time | Pass flat-by into the upstream simulator; regenerate four dated demo plans | All recordings match 15:55; CLI argument regression |
| Failed/new runs could leave a prior ticket on disk | Invalidate downstream files before each step, bind to per-user run ID and limits fingerprint, expire live runs after five minutes | Old tokens, other accounts, missing prerequisites, changed limits, failed entries |
| Switching screens or tapping repeatedly mixed trade requests | Freeze controls and capture mode/parameters for the run | Real browser checks controls, tab blocking and full pipeline completion |
| Web demo used weak hashing and a plaintext fallback | Random-salt PBKDF2-SHA256 (200,000 iterations); secure-context requirement; migrate legacy credentials only after verified login | New-credential, plaintext-absence and migration checks |
| Account-switching retained portfolio/news/results | Clear caches and ignore late responses after account changes; reset on cross-tab identity change | UI logout assertions |
| Lost live connection silently became demo mode | Distinguish static host from outage; remember live-server mode and show retry screen | Forced-offline live-server browser test |
| Service worker deleted unrelated apps' caches | Scope cleanup to Trade Twin's names; precache complete demo, not only splash page | Real worker activation retains sentinel other-app cache and all demo assets |
| Profile fields, percentages and JSON shapes inadequately validated | Type/bounds validation, reject non-finite JSON literals and booleans as money | HTTP and browser regression checks |

Also corrected 13F freshness language: the 45-day rule is a **filing deadline**, not a maximum
age guarantee. Investor sheets display quarter-end date, filing date and age. Reference:
[SEC Form 13F FAQ](https://www.sec.gov/rules-regulations/staff-guidance/division-investment-management-frequently-asked-questions/frequently-asked-questions-about-form-13f).

## Running the checks

From the repository root:

```sh
python apps/trade-twin/tests/verify_api.py
python apps/trade-twin/tests/test_iteration.py
python apps/trade-twin/tests/verify_browser.py
python scripts/build_site.py
python scripts/check_site.py
python scripts/run_all_tests.py
```

Browser checks use a real isolated Chrome/Chromium profile and an ephemeral local static server.
No normal browser data is touched. They explicitly skip if Chrome is absent. Synthetic return
fixtures test the real calculation engines; no live market call is required for these regressions.

## Release verification (2026-10-25)

- 46 API checks + 10 calculation/pipeline tests + 36 real-browser checks passed.
- On the latest public catalog (after personal projects moved private), the repository-wide run
  reports 17 passed, zero skipped, zero failed; static link validation covers 35 HTML pages.
- Phone-width screenshots were inspected with an isolated Chromium instance. No real orders or
  personal account data were used in these checks.

## Remaining limitations

- Historical bootstrap frequencies are not guaranteed or calibrated market probabilities; outcomes
  outside sampled history remain possible. Taxes, inflation, fees, spreads and slippage are not modelled.
- Personality/risk categories are educational heuristics, not psychometrically validated suitability advice.
- Public Pages uses a dated snapshot and browser-local profiles, not live trading or cross-device accounts.
- Browser storage is readable by anyone with access to that browser. Password hashing does not make
  localStorage a secure vault. Legacy demo passwords upgrade only after the next successful login.
- Local Python server is a personal-development/LAN app, not a hardened public brokerage service;
  LAN HTTP is unencrypted. Native iOS hardware and Safari/WebKit are not covered by Chromium tests.
- No real orders are sent. Backend remains required for live data; free feeds may fail or be delayed.
