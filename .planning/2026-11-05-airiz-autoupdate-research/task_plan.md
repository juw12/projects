# AIRIZ Auto-Update Security Research Plan

## Goal
Produce best-practice documentation for cross-platform auto-update security in 2026
across 10 topics, with official URLs, real benchmarks, real outages, real code
snippets (file:line cited). 500+ lines minimum.

## Scope
- ed25519 manifest signatures (RFC 8032)
- Windows EV cert + SmartScreen reputation
- Android APK Signature Scheme v3 / v4
- iOS signing chain + provisioning lifecycle
- PWA SRI + service worker update lifecycle
- Cloudflare Worker signed deploys
- Staged rollouts (10/50/100)
- Crash-throttled rollback
- Delta updates (bsdiff, Courgette, zsync)
- PWA update lifecycle internals

## Decision Context (downstream)
- Tauri unified updater vs hybrid vs custom signed-manifest-on-R2
- One engineer shipping to Win+Android+iOS+PWA+Worker

## Phases
1. **P1 - Parallel research** — Fire 10+ web/Context7 searches in parallel
2. **P2 - Code mining** — Pull real code from tauri-apps/tauri, workbox, sparkle,
   Cloudflare wrangler, omaha, Sentry. Cite file:line.
3. **P3 - Outage mining** — Find 1Password 2023, recent Sparkle/Sentry/SmartScreen
   incidents. Cite blog/RFC.
4. **P4 - Benchmark mining** — Real numbers (SmartScreen time-to-trust, OTA size,
   delta reduction %, verification ms).
5. **P5 - Write up** — 10 sections, each with the 5 required fields.

## Constraints
- Every URL official or RFC, not blog
- Every code snippet cited file:line from a real repo
- Every outage has a citation
- 500+ lines, no abbreviations

## Errors / Notes
(none yet)
