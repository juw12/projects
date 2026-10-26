# Twin versus TradingAgents: code review and local upgrade

## Bottom line

**TradingAgents is ahead as a multi-agent AI research framework. Twin is already a broader end-user investing/practice application.** They are not interchangeable, and neither architecture proves superior returns.

This upgrade makes Twin measurably stronger in two specific areas: testing a simple strategy against a transparent benchmark, and enforcing broker checks at the moment of submission. It does **not** claim that Twin now outperforms TradingAgents, reproduces its AI research capabilities, or is ready for unattended real-money trading.

## Reviewed revisions

- Twin / projects base: `8cc4610c6355ef3ea6baccfe0128003d304fec4e`.
- TradingAgents reference: `e8f5503e9b86d5c2710b0c76b1f686703968c9df`.
- Local branch: `improve/twin-evidence-risk`.
- Scope: source inspection of Twin's application, broker, frontend and tests; TradingAgents' README, portfolio-manager implementation, typed agent schemas and decision-evaluation module. TradingAgents itself was **not run** and no paid LLM calls were made.

## Fair comparison

| Area | TradingAgents, as documented/inspected | Twin before this change | Delivered change |
| --- | --- | --- | --- |
| Research | Specialist LLM analysts; bullish/bearish debate; trader and portfolio manager; typed decisions and multi-provider support. | Deterministic skill tools, market/news information, planning and replay. Not the same multi-agent research architecture. | No pretend AI agents added. Strategy Lab is explicitly deterministic. |
| End-user product | Primarily a Python research framework and CLI, with saved reports. | Installable PWA, mobile/desktop wrappers, guest mode, academy, global search, FX-aware practice portfolio, replay and optional Alpaca connection. | New lab integrated into each stock page, available without credentials and precached for the demo. |
| Evaluation | Dated ticker-grid evaluation and regional benchmark outcomes. The inspected module explicitly says it is not a cash/position-ledger portfolio simulator. Current documentation also describes point-in-time controls. | Goal bootstrap, historical replay and order simulation, but no equivalent stock-page chronological holdout comparator. | Single holdout for a simple moving-average rule, explicit next-close fill model, entry/exit costs, identical buy-and-hold evaluation window, equity curves and replayable evidence. |
| Risk | Portfolio-aware LLM analysis and a portfolio manager's structured decision. A persuasive report is not itself a broker-side enforcement mechanism. | Preview/confirmation, order cap, live order count, no-short checks and bracket-risk warnings. | Submit-time revalidation, serialized live-entry reservations, reconnect-safe counting, hard refusal of over-limit planned bracket risk and invalid bracket geometry. |
| Cost/dependencies | LLM provider setup and framework dependencies; usage depends on models and tools selected. | Standard-library Python backend and browser JavaScript; public demo needs no API keys. | No application dependency or LLM cost added. Node/Chrome are development test tools only. |
| Proven performance | No head-to-head evaluation performed here. | No head-to-head evaluation performed here. | Still unproven. More features or tests do not establish profitable trading. |

Primary reference sources:

- [TradingAgents README](https://github.com/TauricResearch/TradingAgents/blob/e8f5503e9b86d5c2710b0c76b1f686703968c9df/README.md)
- [TradingAgents decision-grid backtest scope](https://github.com/TauricResearch/TradingAgents/blob/e8f5503e9b86d5c2710b0c76b1f686703968c9df/tradingagents/backtest.py)
- [TradingAgents portfolio manager](https://github.com/TauricResearch/TradingAgents/blob/e8f5503e9b86d5c2710b0c76b1f686703968c9df/tradingagents/agents/managers/portfolio_manager.py)
- [TradingAgents structured schemas](https://github.com/TauricResearch/TradingAgents/blob/e8f5503e9b86d5c2710b0c76b1f686703968c9df/tradingagents/agents/schemas.py)
- [Original Twin](https://github.com/juwpegatron/projects/tree/8cc4610c6355ef3ea6baccfe0128003d304fec4e/apps/twin)

No TradingAgents source code was copied into Twin.

## Concrete defects addressed

1. **Preview/submit time-of-check gap.** Previously, submit consumed the preview and checked mode/expiry, but did not rerun the account, funds, holdings or limit checks. A batch of previews could all pass before the daily count changed. Submit now reruns validation under the broker lock, and the HTTP route holds the profile lock while reading current limits and submitting.
2. **Daily-count reset and uncertain submissions.** Reconnect used to reset the counter; failed/unknown POST outcomes were not counted. A credential-free counter now persists separately from the broker configuration, reserves capacity before sending, and survives disconnect/reconnect. An uncertain outcome consumes capacity and reports the client order ID for reconciliation. There is no automatic order retry.
3. **Warnings presented where enforcement was needed.** An attached live bracket whose planned loss exceeded the user's cap used to warn and continue. It now fails validation. Stops and targets on the wrong side of the entry are also refused.
4. **Invalid data.** Nonfinite quotes, buying power and holdings cannot be used as valid numbers to bypass the checks. A dollar sale cannot be sized from an invalid quote. Prices that round to zero are rejected.
5. **Reconnect preview identity.** Successful reconnect invalidates prior previews even when the mode is unchanged.
6. **Exit access.** The daily gate now limits new live buy attempts, not long-position exits. Corrupt entry counters fail closed for buys but do not prevent exits or deletion of stored credentials.
7. **Test reliability.** Broker integration tests now stub market prices instead of unintentionally reaching Yahoo. Browser checks can find Windows Chrome/Edge and clean up the isolated test browser's process tree with bounded handle-release retries.

## Strategy Lab methodology

- Requires at least 120 finite, positive, chronologically unique daily observations. Rejects intraday/weekly input and gaps over 14 days; smaller missing-session gaps are disclosed, not repaired.
- Uses fixed candidate windows of 10, 20 and 50 observations. All candidates receive the same training period after a 50-observation warmup.
- The first 60% of observations determines the highest net-return candidate; ties select the shorter period. That choice is frozen for the remaining 40%.
- The signal uses only closes available before the fill observation. A signal is executed at the following available close, with adverse slippage and fees. Final liquidation is forced, with exit costs, for both strategy and benchmark.
- The benchmark buys at the first holdout close, not before the test begins. Both ledgers start from identical normalized cash and are independent of the user's portfolio.
- Reports include net return, drawdown, completed round trips, exposure, equity curves, raw inputs, settings and fill ledger. The entire calculation can be reproduced from the copied JSON.
- Current exchange-local-date bars are conservatively removed in server mode. Demo data is labelled with its historical dates. No result is called a forecast or a buy recommendation.

**Limitations:** one split, one simple rule family, typically one year of data, price returns rather than total returns, no FX return conversion, dividends, taxes, interest, liquidity, partial fills or independent corporate-action audit. Repeated exploration contaminates the holdout. This is not a point-in-time fundamental/news archive, full walk-forward study or production execution backtest.

## Verification

Final local run: **all six suites exited successfully**: 54 Python regression tests,
21 Strategy Lab engine tests, 18 existing order/replay tests, application API checks,
mock-broker API checks, and 98 isolated real-browser checks. One POSIX permission
assertion was explicitly skipped on Windows.

A targeted before/after reproduction also ran the reviewed original broker code:
with a daily cap of one and two pre-created previews, the original accepted both mock
submissions; the upgraded broker accepted one and blocked the other.

Automated checks cover:

- Training/holdout separation; changing future prices cannot alter earlier trades/equity or the period selected on training.
- Next-close timing, known-cost benchmark arithmetic, drawdown, zero-position behavior, input rejection and report replay.
- Every bundled US one-year demo history producing finite outputs.
- Concurrent submission, changed caps and profile limits, buying power and holdings changes, reconnect/restart persistence, uncertain outcomes, invalid numbers, user isolation and exit access.
- Actual HTTP preview/submit behavior against a mock Alpaca service, without real keys/orders.
- Real isolated Chrome rendering at phone width, lab recalculation/error handling, reproducible-report fallback, unchanged practice funds and service-worker cache inclusion.
- Existing Python application, order/replay and browser regressions.

The delivery includes the final test output separately. The POSIX permission assertion is explicitly skipped on Windows: **Windows credential ACL security remains unverified**. Broker integration tests use a mock, not Alpaca paper or funded infrastructure. No claim of broker certification, standards compliance or production readiness is made.

## Remaining priorities before live deployment

1. Put credentials in an OS-protected vault and verify Windows access control; current storage remains unencrypted. Do not expose the development HTTP server publicly.
2. Add durable submission reconciliation and a broker/account-aware audit journal, including pending-order reservations and process-safe coordination. The current counter is per Twin user/UTC day and serialized only inside a single server process.
3. Enforce aggregate portfolio exposure and cashflow-aware daily loss limits. The presence of these values in a profile does not mean the broker bridge currently enforces them. Delayed-quote market-order estimates and stop losses are not guaranteed price/loss bounds.
4. Add longer, multiple-window out-of-sample evaluation with archived data, suitable total-return/FX benchmarks and sensitivity checks. Define the evaluation before examining the holdout results.
5. If adding LLM research, keep it read-only and evidence-linked: timestamped source snapshots, typed outputs, contradictory evidence, abstention on stale/insufficient data, token budgets, and evaluation against simple baselines. Never give narrative agents authority to bypass the deterministic submit gate.

## Delivery status

This is a local working-copy upgrade. Nothing was pushed to GitHub, the public Pages app was not changed, and no trading account was connected. Preserve the existing vendor licensing/attribution when merging. Review the patch, run the included tests, and trial only with paper trading before any consideration of live use.
