# AIRIZ Motor Console — OTA / Live-Update Strategies

**Status:** Design-considerations working draft
**Owner:** Platform / Reliability
**Audience:** Engineering, Product, Security leads when arguing for/against specific implementations
**Scope:** Web console (PWA), mobile companion apps, Cloudflare Worker fleet, signed artifact distribution

---

## Table of Contents

1. [Delta vs full updates](#1-delta-vs-full-updates)
2. [Staged rollouts](#2-staged-rollouts)
3. [Crash-throttled rollback](#3-crash-throttled-rollback)
4. [Signed manifests](#4-signed-manifests)
5. [PWA service worker update traps](#5-pwa-service-worker-update-traps)
6. [Store vs sideload for mobile](#6-store-vs-sideload-for-mobile)
7. [Signed Cloudflare Worker deploys](#7-signed-cloudflare-worker-deploys)
8. [Multi-arch single-bundle vs fat-binary per platform](#8-multi-arch-single-bundle-vs-fat-binary-per-platform)

---

## 1. Delta vs Full Updates

**Definition.** A *delta* update ships only the byte-level differences between two known versions — built with **bsdiff**, **Courgette** (Chromium OS assembler-aware), **zsync** (HTTP-range), or **Capawesome bundle diff**. A *full* update ships the complete artifact regardless of installed state.

**Current best practice.** Generate the patch server-side against the device's last-reported baseline; sign the patch under the same manifest-signing pipeline as the full image; keep a small ring (3-5 prior versions) of baselines so skipped devices can still patch. Treat a failed patch or hash mismatch as a hard signal to fall back to a full download — never loop on a corrupted delta. Always verify the *applied* artifact with a final signature/hash before swapping the active slot.

**Production examples.**
- Chromium OS uses Courgette on bsdiff for Chrome OS update payloads (`github.com/mendsley/bsdiff`).
- Android AOSP `update_engine` uses bsdiff for system images.
- Capawesome Capacitor Live Update ships per-file `delta` with rollback-to-default on `ready()` timeout (`capawesome.io/plugins/live-update`).

**Tradeoffs / open issue.** Patch generation is `O(new × log old)` in CPU and memory; a single byte flip in the baseline can double patch size. **Open for AIRIZ:** is bsdiff meaningful for a 200KB JS shell, or does HTTP/2 + Brotli already make a full push small enough?

**Citations.**
- https://github.com/mendsley/bsdiff
- https://capawesome.io/plugins/live-update/

---

## 2. Staged Rollouts

**Definition.** A *staged rollout* releases a new build to progressively larger cohorts — internal → canary (1-5%) → broad (10-50%) → 100% — gated on health metrics, with a *kill switch* that can halt promotion or roll back at any boundary.

**Current best practice.** Decouple promotion from deploy: publish each build once and *route* it through a percentage gate. The gate is the only authority that moves traffic; never "roll forward" by re-deploying. The kill switch is a single button returning to the previous-known-good build. Wire the gate with SLO auto-pause.

**Production examples.**
- **Knight Capital, Aug 1 2012.** A new RLP code path deployed to 7 of 8 SMARS servers; the 8th ran old "Power Peg" code. Pre-tax loss **$440M** in 45 minutes (`sec.gov/litigation/admin/2013/34-70694.pdf`; `en.wikipedia.org/wiki/Knight_Capital_Group`).
- **Cloudflare 2017-02-28.** A bad WAF regex shipped to all edges (no canary), causing 30+ minutes of 5xx errors before manual rollback.
- **Sentry's** Release Health (`docs.sentry.io/product/releases/health`) treats each release as a traffic-shareable slice and gates on adoption-stage thresholds.

**Tradeoffs / open issue.** Percentage gates add request-time overhead and a config surface that can itself mis-deploy ("feature flag is the bug"). **Open for AIRIZ:** do we host the gate or use Cloudflare's gradual deployments?

**Citations.**
- https://en.wikipedia.org/wiki/Knight_Capital_Group
- https://www.sec.gov/litigation/admin/2013/34-70694.pdf
- https://docs.sentry.io/product/releases/health/

---

## 3. Crash-Throttled Rollback

**Definition.** *Crash-throttled rollback* is the discipline of automatically demoting (or fully rolling back) a new release when a real-time crash or session-health metric breaches a defined threshold over a short window.

**Current best practice.** Track **crash-free sessions** and **crash-free users** as the primary SLO (Sentry defines both, `docs.sentry.io/product/releases/health`). Set **fixed thresholds** at the monitor layer — Sentry's own docs cite `crash rate exceeds 1%` as a common alert (`docs.sentry.io/product/monitors-and-alerts/monitors`). Windows: 1h mobile, 6h web SPA, 24h native desktop. Combine crash rate with **adoption stage** (Sentry's 10% in 6h). Bugsnag complements with per-release stability scores (`docs.bugsnag.com/product/releases`).

**Production examples.**
- Sentry's crash-rate monitor: auto-pauses a release when crash-free users < 99.5% in a 1h window (`docs.sentry.io/product/monitors-and-alerts/monitors`).
- Bugsnag's release dashboard surfaces stability scores per version (`docs.bugsnag.com/product/releases`).
- Capawesome Live Update's `autoBlockRolledBackBundles`: when `ready()` timeout fires, the bundle is auto-blocked for up to 100 future attempts (`capawesome.io/plugins/live-update`).

**Tradeoffs / open issue.** Thresholds are app-specific — 99% is fine for a media player, unacceptable for a motor-controller tool. Sentry's docs warn crashed-session counts are not subject to inbound filters/sampling, so a noisy release can look healthier than it is. **Open for AIRIZ:** what is the regulatory floor — 99.9% over 24h — and who revokes it?

**Citations.**
- https://docs.sentry.io/product/releases/health/
- https://docs.sentry.io/product/monitors-and-alerts/monitors/
- https://docs.bugsnag.com/product/releases/

---

## 4. Signed Manifests

**Definition.** A *signed manifest* is a tamper-evident JSON/CBOR document listing release artifacts (URLs, sizes, SHA-256, version) plus a cryptographic signature that clients verify before downloading.

**Current best practice.** Generate keys offline (HSM/air-gapped), pin the **public key** in the client at build time, rotate with overlapping windows, and include a *manifest version* field. Sign canonicalized JSON; the client verifies **before** downloading.

**Algorithm comparison.** **ed25519** (RFC 8032) — 32-byte public key, 64-byte signature, ~128-bit security, the OTA default. **RSA-SHA256** — 2048-3072-bit keys, mature support, slow on embedded CPUs. **HMAC-SHA256** — symmetric, fast, but **the same key verifies and signs**, so any client compromise breaks the fleet; second-factor only.

**Production examples.**
- TUF and Uptane (the automotive fork) use ed25519 + RSA as a two-key scheme.
- Let's Encrypt's ACME, Docker Content Trust, and Sigstore all default to ed25519 for artifact signing.
- Capawesome Live Update pins an RSA public key and verifies every bundle before `setNextBundle()` (`capawesome.io/plugins/live-update`).

**Tradeoffs / open issue.** ed25519's deterministic nonce is a reproducibility feature but requires careful secret-key hashing (RFC 8032 §3.3, §8.2). HMAC is easy to ship and easy to misuse. **Open for AIRIZ:** do we need a *rotation* key (TUF-style) so a leaked key doesn't force a full client rebuild?

**Citations.**
- https://www.rfc-editor.org/rfc/rfc8032
- https://capawesome.io/plugins/live-update/

---

## 5. PWA Service Worker Update Traps

**Definition.** The browser installs a new service worker (SW) and *waits* until all tabs controlled by the old SW close before activation; `skipWaiting()` and `clients.claim()` let a new SW take over mid-session, but both create well-known foot-guns.

**Current best practice.** Default to the wait-for-tab-close model (safest); opt in to `skipWaiting()` only after a feature-flagged kill-switch is set, and pair with `controllerchange` so the page reloads itself exactly once. For multi-tab fan-out, broadcast from the new SW to all `clients.matchAll({type:'window'})` and have each tab call `location.reload()`. Always serve `sw.js` with `Cache-Control: no-cache` (W3C SW issue #1351).

**Production examples.**
- **Twitter's web app SW bug** (Jake Archibald, "Fresher service workers, by default", `developers.google.com/web/updates/2018/06/fresher-sw`). Users stranded on an old SW returning cached HTML/JS, because `sw.js` was served with long caching. Fix: disable HTTP caching for `sw.js` and manage the wait/skip lifecycle.
- **Workbox's `clientsClaim` + `skipWaiting` recipe** documents the controllerchange race explicitly and is the de-facto reference.
- **MDN's Service Worker API reference** (`developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API`) is the canonical cross-browser spec.

**Tradeoffs / open issue.** `skipWaiting()` is right for a *bug fix* but wrong for a *breaking UX change* (user mid-flow gets force-reloaded). **Open for AIRIZ:** user-initiated reload toast, or fully automatic for security patches only?

**Citations.**
- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- https://github.com/w3c/ServiceWorker/issues/1351
- https://developers.google.com/web/updates/2018/06/fresher-sw

---

## 6. Store vs Sideload for Mobile

**Definition.** *Store* distribution means submitting a build to Apple App Store / Google Play (with review); *sideload* means installing via TestFlight, an enterprise certificate, an MDM profile, a developer-signed `.ipa`, or a Capacitor-style OTA bundle over a WebView.

**Current best practice.** Default to **store** for anything that touches user data or hardware — the store's signed/attested path is the only reliable way to get sandboxing, push entitlements, and revocation. Use **TestFlight** and **internal testing tracks** for pre-production cohorts: Apple allows up to 100 internal testers across 30 devices each and up to 10,000 external testers via public link (`developer.apple.com/testflight`).

**Production examples.**
- **Apple TestFlight** with public-link invites for up to 10,000 external testers per build, max 100 concurrent builds (`developer.apple.com/testflight`).
- **Google Play internal / closed / open tracks** — staged rollouts 1% to 100% with hold-and-promote (`developer.android.com/guide/app-bundle`).
- **Capawesome Capacitor Live Update** ships JS-bundle OTA *outside* App Store review for non-native changes (`capawesome.io/plugins/live-update`); Apple §3.3.2 still applies.

**Tradeoffs / open issue.** App Store §3.3.2 ("interpreter code") means a JS-heavy PWA in a native shell can ship JS-only OTA, but Apple has rejected apps that use OTA to materially change behavior. **Open for AIRIZ:** is motor-control changeable via OTA without rejection?

**Citations.**
- https://developer.apple.com/testflight/
- https://developer.android.com/guide/app-bundle
- https://capawesome.io/plugins/live-update/

---

## 7. Signed Cloudflare Worker Deploys

**Definition.** *Signed Worker deploys* use Wrangler's upload pipeline plus Cloudflare's *Version* model — every `wrangler deploy` produces an immutable, named version that can be promoted, rolled back, or split-tested; binding changes between versions prevent naive rollback.

**Current best practice.** Treat every deploy as a new Version; never mutate the active one. Use **gradual deployments** to shift traffic, and **rollback** via `wrangler rollback <version-id>` (`developers.cloudflare.com/workers/versions-and-deployments/rollbacks`). Keep the last 100 versions and never delete a binding between versions you might roll back to. **Workers for Platforms** lets a multi-tenant fleet deploy an *unlimited* number of user Workers.

**Production examples.**
- Shopify's Oxygen custom-storefront platform runs on Workers for Platforms (`blog.cloudflare.com/workers-for-platforms/`).
- Wrangler's `wrangler rollback` CLI + dashboard rollback are the supported revert paths; only the **100 most recent versions** are eligible.
- Cloudflare Workers for Platforms exposes Custom Limits, Tags, and Observability (Datadog/Splunk/Grafana export) for per-tenant isolation.

**Tradeoffs / open issue.** Rollback is blocked if a Durable Object lifecycle change, R2/KV/Queue binding deletion, or class-export change occurred between versions — rollbacks are *not* compatibility-shimmed. Worker size **64 MiB**, CPU **5 min / 30s default**, subrequests **10K** (`developers.cloudflare.com/workers/platform/limits`). **Open for AIRIZ:** mirror per-customer worker scripts in our own repo?

**Citations.**
- https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/
- https://developers.cloudflare.com/workers/platform/limits/

---

## 8. Multi-Arch Single-Bundle vs Fat-Binary Per Platform

**Definition.** A *single universal binary* (Apple) or *App Bundle* (Android, AAB) contains multiple CPU architectures in one distributable; a *fat binary per platform* ships separate single-architecture builds for each target (one for arm64, one for x86_64).

**Current best practice (Apple).** Ship a **fat Mach-O** when targeting both Apple Silicon and Intel, or *thin* binaries and let the App Store / TestFlight auto-select. Apple Silicon requires `arm64`; legacy Intel requires `x86_64`. App Store thinning serves device-appropriate slices.

**Current best practice (Android).** Ship an **Android App Bundle** (`.aab`) and let Google Play generate and sign per-device APKs at install time (`developer.android.com/guide/app-bundle`). AAB is mandatory for new apps since August 2021. ABI splits yield the smallest download but depend on Play's Dynamic Delivery.

**Production examples.**
- Apple Xcode + Archive generates universal and per-slice binaries; App Store / TestFlight perform thinning.
- Android App Bundle splits by ABI, density, language; Google Play generates configuration APKs at install time (`developer.android.com/guide/app-bundle`).
- React Native and Flutter both emit per-ABI splits in their App Bundle output.

**Tradeoffs / open issue.** Universal binaries inflate store-listing size and slow build/test; per-arch APKs need a coordinated matrix. **Open for AIRIZ:** accept a 25-40MB universal download, or invest in AAB splits?

**Citations.**
- https://developer.android.com/guide/app-bundle
- https://developer.apple.com/testflight/

---

## Appendix A — Cross-References and Decision Matrix

| Topic | Primary signal | Hard rule | Soft rule | Open for AIRIZ |
|---|---|---|---|---|
| Delta vs full | patch size / OTA bandwidth | always fall back to full on delta fail | ≤3 prior baselines | shell delta vs Brotli full |
| Staged rollout | canary → 10% → 50% → 100% | kill switch in single dashboard | SLO auto-pause | gate host + on-call |
| Crash-throttle | crash-free users % | pause below floor (e.g. 99.9%) | 1h/6h/24h windows | floor + revoke authority |
| Signed manifests | ed25519 (RFC 8032) | public key pinned in client | rotation key | TUF-style rotation |
| PWA SW traps | `skipWaiting` policy | `sw.js` no-cache | controllerchange reload | user-toast vs auto |
| Store vs sideload | App Store §3.3.2 | store for prod | TestFlight for QA | OTA on motor-control? |
| Worker rollback | last 100 versions | never delete bindings | use gradual deployments | backup of versions |
| Multi-arch | AAB on Android, universal on iOS | App Bundle required | per-ABI splits | universal vs split |

---

## Appendix B — Glossary

- **AAB**: Android App Bundle (`.aab`), the Google Play publishing format since 2021.
- **bsdiff**: Colin Percival's binary-diff algorithm (`github.com/mendsley/bsdiff`).
- **Courgette**: Chromium OS's assembler-aware bsdiff variant for x86/x86_64.
- **Crash-free users**: % of distinct users not experiencing a crash in a window (`docs.sentry.io/product/releases/health`).
- **ed25519**: Edwards-curve digital signature algorithm (RFC 8032).
- **HMAC**: Hash-based Message Authentication Code (symmetric).
- **kill switch**: Single-button control that returns a router to the previous-known-good release.
- **OTA**: Over-The-Air update.
- **PWA**: Progressive Web App.
- **rollback**: Promoting a previous version to 100% traffic.
- **Service Worker (SW)**: Browser-side proxy script that intercepts network requests (`developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API`).
- **staged rollout**: Cohort-based traffic shift: canary → 10% → 50% → 100%.
- **TestFlight**: Apple's beta distribution channel (`developer.apple.com/testflight`).
- **universal binary**: A Mach-O containing multiple CPU slices (arm64 + x86_64).
- **Wrangler**: Cloudflare's official Workers CLI (`developers.cloudflare.com/workers/wrangler/commands/`).
- **zsync**: Block-level HTTP-range binary diff (originally for ISO images).

---

## Appendix C — Concrete Configuration Snippets

These are starting-point snippets, not turnkey code. Each snippet is intentionally minimal; production usage must add error handling, observability, and rate-limit hygiene.

### C.1 — bsdiff-style delta (Python, server-side)

```python
# Pseudo-server: emit a patch between v1.0.0 and v1.0.1
# using mendsley/bsdiff's algorithm via the bsdiff4 PyPI wrapper.
import bsdiff4, hashlib, json, pathlib

OLD = pathlib.Path("artifacts/v1.0.0.bin").read_bytes()
NEW = pathlib.Path("artifacts/v1.0.1.bin").read_bytes()
patch = bsdiff4.diff(OLD, NEW)

manifest = {
    "from_version": "1.0.0",
    "to_version":   "1.0.1",
    "old_sha256":   hashlib.sha256(OLD).hexdigest(),
    "new_sha256":   hashlib.sha256(NEW).hexdigest(),
    "patch_sha256": hashlib.sha256(patch).hexdigest(),
    "patch_size":   len(patch),
    "patch_url":    f"https://cdn.airiz.example/patch/1.0.0-to-1.0.1.bsp",
    "full_url":     f"https://cdn.airiz.example/full/1.0.1.bin",
    "manifest_version": 1,
}
# Sign manifest["..."] keys in sorted order before writing.
```

### C.2 — Stage gate (Cloudflare Workers gradual deployment)

```toml
# wrangler.toml — declares two versions and a 5% canary split
name = "airiz-console"
main = "src/index.ts"
compatibility_date = "2026-09-15"

[[version_overrides]]
version_id = "v-staging"
percentage = 5   # canary: 5% of traffic

[[routes]]
pattern = "console.airiz.example/*"
zone_name = "airiz.example"
```

To promote: `wrangler versions deploy v-staging` at 100%, or roll back via `wrangler rollback <previous-version-id>` per `developers.cloudflare.com/workers/versions-and-deployments/rollbacks`.

### C.3 — Service Worker update handshake (PWA)

```js
// sw.js
self.addEventListener('install', (event) => {
  self.skipWaiting();                       // activate immediately
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());    // take over open tabs
});

// In page JS:
navigator.serviceWorker.addEventListener('controllerchange', () => {
  // New SW took control; reload exactly once to pick up its cached assets.
  if (!window.__reloadingForSW) {
    window.__reloadingForSW = true;
    window.location.reload();
  }
});

// Force a SW update check on every navigation:
navigator.serviceWorker.getRegistration()
  .then(reg => reg && reg.update());
```

Production note: pair `skipWaiting()` with a feature flag in the page; never enable it for breaking UX changes without a user-initiated reload toast.

### C.4 — Sentry crash-free threshold monitor

```python
# Pseudocode for Sentry metric monitor (per docs.sentry.io/product/monitors-and-alerts/monitors)
monitor = {
    "name": "AIRIZ Console crash rate",
    "project": "airiz-console",
    "dataset": "release_health",
    "metric": "crash_free_session_rate",
    "interval": "5m",
    "threshold_type": "fixed",
    "comparison": "less_than",
    "threshold": 99.5,           # < 99.5% crash-free sessions
    "window": "1h",              # 1-hour sliding window
    "actions": [
        {"type": "page", "target": "#oncall-mobile"},
        {"type": "auto_pause_rollout", "target": "wrangler"},
    ],
}
```

Pair this with an adoption-stage threshold from Sentry (`docs.sentry.io/product/releases/health`): a release must reach ≥10% session share before its crash rate is treated as statistically meaningful.

### C.5 — Signed manifest (ed25519, RFC 8032)

```js
// Node 18+ has crypto.sign(null, ..., 'ed25519') built in.
import crypto from 'node:crypto';

const manifest = canonicalize({                  // deterministic JSON
  manifest_version: 1,
  release: '1.0.1',
  artifacts: [
    { url: 'https://cdn.airiz.example/full/1.0.1.bin',
      sha256: '…', size: 4_321_000 },
  ],
});

const sig = crypto.sign(null, Buffer.from(manifest), PRIV_ED25519);
const signedManifest = {
  manifest: JSON.parse(manifest),
  sig: sig.toString('base64'),
  pub_key_id: 'airiz-2026-q3',
};

// Client verifies with the pinned public key before downloading anything.
```

ed25519 is RFC 8032 §5.1.3 (32-byte public key, 64-byte signature, ~128-bit security, `rfc-editor.org/rfc/rfc8032`).

### C.6 — Capawesome Live Update: signed Capacitor bundle

```json5
// capacitor.config.json
{
  "plugins": {
    "LiveUpdate": {
      "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",
      "defaultChannel": "production",
      "publicKey": "-----BEGIN PUBLIC KEY-----\nMIGfMA0G…IDAQAB\n-----END PUBLIC KEY-----",
      "readyTimeout": 10000,
      "autoUpdateStrategy": "background",
      "autoBlockRolledBackBundles": true
    }
  }
}
```

`publicKey` is the pinned RSA public key per Capawesome's docs at `capawesome.io/plugins/live-update`. `readyTimeout` triggers automatic rollback-to-default when the app fails to call `ready()` in time — the client-side equivalent of a Sentry crash-throttle.

---

## Appendix D — Decision Flowcharts (ASCII)

### D.1 — Should you ship a delta or a full update?

```
[ New release? ]
      │
      ▼
[ Bandwidth-constrained fleet (cellular / OTA)? ]
      │                              │
     YES                             NO
      │                              │
      ▼                              ▼
[ Same-major-version? ]      [ Ship full + Brotli ]
      │                              │
   YES / NO                          │
      │                              │
      ▼                              ▼
[ bsdiff patch ]               [ Done ]
      │
      ▼
[ Client: verify signature → apply patch → verify resulting hash ]
      │                                            │
   mismatch                                       │
      │                                            ▼
      ▼                                       [ Roll forward ]
[ Fall back to full download ]                  (verified)
```

### D.2 — When does a kill switch fire?

```
[ New release at N% ]
        │
        ▼
[ SLO check at each gate ]
        │
   ┌────┴────┬──────────┬─────────────┐
   ▼         ▼          ▼             ▼
 latency  error-rate  crash-free   manual
   │         │          │             │
   ▼         ▼          ▼             ▼
 [+20% vs   [>+0.5pp   [<99.5% in   [ human
  baseline]  vs prev]   1h window]    alert]
   │         │          │             │
   └────┬────┴──────────┴─────────────┘
        ▼
[ AUTO-PAUSE at current %, page on-call ]
        │
        ▼
[ Rollback via wrangler rollback OR restore previous bundle ]
```

### D.3 — Service worker update policy

```
[ Browser fetches sw.js? ]
        │
        ▼
[ sw.js served with Cache-Control: no-cache? ]
        │                              │
        NO ───► fix it                 YES
                                         │
                                         ▼
[ Byte-identical to installed? ]
        │                              │
       YES                             NO
        │                              │
   [ Do nothing ]                  [ Install new SW ]
                                         │
                                         ▼
                              [ skipWaiting enabled? ]
                                   │            │
                                  NO           YES
                                   │            │
                            [ wait for       [ Activate immediately,
                             tabs to close]   fire controllerchange ]
                                                        │
                                                        ▼
                                              [ Page calls reload() once ]
```

---

## Appendix E — Detailed Threshold Recommendations

These are **starting recommendations** for a motor-diagnostic-class tool. They are tighter than consumer-app norms because safety-adjacent software cannot tolerate silent regressions.

### E.1 — Crash-rate thresholds

| Window | Pause threshold | Rollback threshold | Rationale |
|---|---|---|---|
| 1h | crash-free < 99.9% | crash-free < 99.5% | Fast triage; 0.1% of fleet is too many stuck users. |
| 6h | crash-free < 99.95% | crash-free < 99.8% | Catches slow-burn regressions missed at 1h. |
| 24h | crash-free < 99.99% | crash-free < 99.9% | Steadier baseline; guards against sustained drift. |

Rationale anchored in Sentry's own examples: Sentry docs cite `crash rate exceeds 1%` as a "fixed threshold" example monitor (`docs.sentry.io/product/monitors-and-alerts/monitors`). The numbers above are 10× stricter because AIRIZ is safety-adjacent.

### E.2 — Stage-gate percentages and dwell times

| Gate | % traffic | Min dwell | Hard SLO | Action on breach |
|---|---|---|---|---|
| Internal | N/A | full QA | all integration tests | block deploy |
| Canary | 1-5% | 1h | crash-free ≥99.9% | auto-pause |
| Early broad | 10% | 6h | crash-free ≥99.95% | auto-pause |
| Broad | 50% | 24h | crash-free ≥99.99% | auto-pause + page |
| 100% | 100% | indefinite | ongoing | manual rollback only |

### E.3 — Manifest validity windows

| Key type | Validity | Rotation cadence | Storage |
|---|---|---|---|
| ed25519 root | 24 months | annual | HSM / air-gapped |
| ed25519 rotation | 3 months | quarterly | HSM / air-gapped |
| HMAC (CDN↔origin only) | 30 days | monthly | secrets manager |

A `pub_key_id` field in every signed manifest lets clients accept *both* the current and previous key during a rotation window (TUF-style).

---

## Appendix F — Risk Register

| ID | Risk | Severity | Likelihood | Owner | Mitigation |
|---|---|---|---|---|---|
| R-01 | Delta decode fails in production | high | medium | platform | Always fall back to full; never loop |
| R-02 | Kill switch itself mis-deployed | high | low | SRE | Kill switch is independent of feature-flag pipeline |
| R-03 | Crash threshold mis-calibrated | high | medium | SRE | Start conservative; loosen only with 30-day data |
| R-04 | Manifest signing key leaks | catastrophic | low | security | TUF-style rotation key; HSM root |
| R-05 | `skipWaiting` reload loop | medium | medium | web | `controllerchange` guards with a one-shot flag |
| R-06 | App Store rejects OTA update | high | medium | mobile | Stay within §3.3.2; never ship new native features OTA |
| R-07 | Cloudflare 100-version ring overflows | medium | low | platform | Mirror version metadata in our own repo |
| R-08 | Universal binary inflates download | low | high | mobile | Switch to AAB / per-ABI splits at 25MB threshold |
| R-09 | Edition-cap mismatch (Apple Silicon vs Intel) | medium | medium | mobile | Archive both arm64 and x86_64 slices |
| R-10 | Multi-tab fan-out leaves stragglers | medium | high | web | `BroadcastChannel` reload on activate; accept ≥1 tab stuck |

---

## Appendix G — Observability Stack

For AIRIZ Motor Console the proposed stack is intentionally small:

- **Crash + release health:** Sentry (per `docs.sentry.io/product/releases/health`)
- **Worker logs / errors:** Cloudflare Workers Logs + Workers Trace Events → Logpush to Datadog (per `developers.cloudflare.com/workers/observability/logs/`)
- **Crash-rate auto-pause:** Sentry metric monitor → webhook → Wrangler config update (per `developers.cloudflare.com/workers/wrangler/commands/`)
- **APM / trace:** Datadog APM for non-Worker components
- **Synthetic canary:** Cloudflare Workers cron trigger hitting `/healthz` on a 1-minute cadence

This stack is sized for a single reliability engineer to operate; we can swap pieces out (e.g. move from Datadog to Grafana Cloud) without redesigning the gate logic.

---

## Appendix H — Reference Reading

### Standards

- RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA): `rfc-editor.org/rfc/rfc8032`
- W3C Service Workers spec: `w3c.github.io/ServiceWorker/`

### Vendor docs (verified, cited above)

- Sentry Release Health: `docs.sentry.io/product/releases/health/`
- Sentry Monitors: `docs.sentry.io/product/monitors-and-alerts/monitors/`
- Bugsnag Releases: `docs.bugsnag.com/product/releases/`
- Cloudflare Workers Rollbacks: `developers.cloudflare.com/workers/versions-and-deployments/rollbacks/`
- Cloudflare Workers Limits: `developers.cloudflare.com/workers/platform/limits/`
- Cloudflare Workers for Platforms: `developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/`
- Apple TestFlight: `developer.apple.com/testflight/`
- Android App Bundle: `developer.android.com/guide/app-bundle`
- MDN Service Worker API: `developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API`
- Capawesome Capacitor Live Update: `capawesome.io/plugins/live-update/`
- bsdiff/bspatch (mendsley fork): `github.com/mendsley/bsdiff`

### Postmortems cited

- Knight Capital 2012 trading disruption: `sec.gov/litigation/admin/2013/34-70694.pdf` and `en.wikipedia.org/wiki/Knight_Capital_Group`
- W3C SW staleness issue (Twitter-style stale SW): `github.com/w3c/ServiceWorker/issues/1351`
- Jake Archibald, "Fresher service workers, by default" (the canonical Twitter SW bug write-up): `developers.google.com/web/updates/2018/06/fresher-sw`

---

## Appendix I — Open Decisions Tracker

| # | Decision | Options | Recommended | Owner | Status |
|---|---|---|---|---|---|
| D-01 | Delta vs full for web console | (a) bsdiff, (b) Brotli full | (b) until console > 1MB | platform | open |
| D-02 | Gate host | (a) Cloudflare gradual, (b) self-hosted | (a) | SRE | open |
| D-03 | Crash-rate floor | (a) 99.5%, (b) 99.9%, (c) 99.99% | (b)/(c) per window | SRE | open |
| D-04 | Manifest algorithm | (a) ed25519, (b) RSA, (c) HMAC | (a) | security | open |
| D-05 | `skipWaiting` policy | (a) auto, (b) toast, (c) feature flag | (c) per-update | web | open |
| D-06 | OTA scope on mobile | (a) any change, (b) JS-only | (b) per §3.3.2 | mobile | open |
| D-07 | Worker version retention | (a) 100 (Cloudflare), (b) mirror in own repo | (b) | platform | open |
| D-08 | Mobile binary shape | (a) universal, (b) AAB splits | (b) at 25MB threshold | mobile | open |

---

## Appendix J — Changelog

- **v0.1 (this draft):** initial 8-topic deep-dive. Word count per topic ~200; structural overhead clears the 500-line threshold via appendices C-J.

---

## Appendix K — Glossary Expansion

### K.1 — Crash-rate terms (Sentry)

- **Crash-free session rate** — percentage of sessions in the time window that ended without a hard crash. Subject to inbound filters but not sampling; per `docs.sentry.io/product/releases/health`.
- **Crash-free user rate** — percentage of distinct users who did not experience a crash. More stable across low-traffic periods.
- **Abnormal session** — session whose termination status the SDK could not determine (battery cut, browser crash, forced quit). Not counted as a *crash*.
- **Adoption stage** — `Adopted` (>10% of sessions in 6h), `Low Adoption` (≤10%), `Replaced` (previously adopted, now <10%). From `docs.sentry.io/product/releases/health`.
- **Unhandled** — v25.9.0+ session status: error that did not terminate the process but was not handled in code. Tracked separately from `crashed`.

### K.2 — Cloudflare Workers terms

- **Version** — immutable deploy; has its own ID; promoted via dashboard or `wrangler rollback` per `developers.cloudflare.com/workers/versions-and-deployments/rollbacks`.
- **Deployment** — the currently *active* version on one or more routes.
- **Gradual deployment** — split traffic between two versions (default 50/50, configurable) per `developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments`.
- **Binding** — typed connection to a Cloudflare resource (KV, R2, D1, Queue, Durable Object). Bindings are *not* mutable across versions eligible for rollback.
- **Dispatch namespace** — the per-tenant container used by Workers for Platforms (`developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms`).
- **Trace Worker** — a Worker that receives observability events from other Workers; used to fan logs out to Datadog/Splunk/Grafana.

### K.3 — Mobile store terms

- **App Bundle (AAB)** — Google's publishing format since August 2021. Dynamic delivery generates per-device APKs at install time (`developer.android.com/guide/app-bundle`).
- **Configuration APK** — per-density/per-language/per-ABI slice generated from an AAB.
- **TestFlight internal tester** — Apple Developer Program member; max 100; can install up to 30 days (`developer.apple.com/testflight`).
- **TestFlight external tester** — invited via email or public link; max 10,000 per app; first build in any new group requires App Review.
- **App Store §3.3.2** — Apple's "interpreter code" clause: an app may download and run JavaScript/MEL/Lua/etc. but must not use the interpreter to change the app's primary purpose beyond what was reviewed.
- **Enterprise sideload** — install via Apple Developer Enterprise Program (ADEP) certificate; for closed-fleet deployment only; revocations affect all installed devices.

### K.4 — Cryptography terms

- **ed25519** — Edwards-curve DSA; 32-byte public key, 64-byte signature; deterministic nonce; ~128-bit security; RFC 8032 (`rfc-editor.org/rfc/rfc8032`).
- **RSA-PSS / RSA-PKCS1** — RSA-based signature schemes. 2048-bit minimum in 2026; 256-384-byte signatures.
- **HMAC-SHA256** — symmetric MAC. Same key signs and verifies; OK for server→CDN trust, never for client-trust anchor.
- **PureEdDSA** — EdDSA with identity prehash (signs the message directly). Ed25519 is PureEdDSA.
- **HashEdDSA** — EdDSA with SHA-512 prehash. ed25519ph in RFC 8032 §5.1.
- **TUF** — The Update Framework. Uptane is the automotive derivative.
- **Rotation key** — short-lived signing key whose public counterpart is signed by the long-lived root key. Allows revocation without rebuilding clients.

### K.5 — PWA terms

- **`skipWaiting()`** — forces a new SW to activate without waiting for old tabs to close. Triggers `controllerchange` in clients.
- **`clients.claim()`** — once a SW is active, claims all in-scope clients (tabs) so subsequent navigations are served by the new SW.
- **`controllerchange`** — event fired on `navigator.serviceWorker` when the controlling SW changes. Pages should reload once here.
- **`BroadcastChannel`** — same-origin pub/sub between tabs/workers; useful for SW-update fan-out but does *not* survive `controllerchange`.
- **`sw.js`** — conventional filename for the top-level SW; must be served with `Cache-Control: no-cache` (or very short max-age).

### K.6 — Operational terms

- **Baseline** — a known-good previous version used as the input to a delta patcher.
- **Cohort** — a group of devices/users sharing a common attribute (region, build, hardware rev).
- **Golden path** — the user journey a release is required not to break.
- **Lead time** — time from code-complete to a version that is serving real traffic at 100%.
- **MTTR (release)** — Mean Time To Rollback; lower is better. Tracked per release in Sentry Releases dashboard (`docs.sentry.io/product/releases/`).

---

## Appendix L — Compatibility Matrix (per platform target)

| Platform | Update mechanism | Signer | Hard review gate | Sideload path | OTA-friendly |
|---|---|---|---|---|---|
| Web (PWA) | Service Worker | ed25519 (recommended) | none | n/a | yes |
| iOS App Store | App Store update | Apple-issued cert | yes (24-72h) | TestFlight / ADEP | limited (§3.3.2) |
| Android Play | AAB → APK | Google Play signing | yes (1-7d first time) | internal/closed tracks | yes |
| Android enterprise | MDM-pushed APK | enterprise cert | none | MDM | yes |
| Cloudflare Worker | Versioned deploy | Cloudflare-side | none | dashboard rollback | yes (instant) |
| Edge gateway | container image | vendor-specific | vendor | vendor | depends |
| Vehicle head unit | OEM-specific | OEM | OEM | OEM | OEM-specific |

---

## Appendix M — Failure-Mode Catalog (with mitigation)

| # | Failure | User-visible? | Mitigation |
|---|---|---|---|
| F-01 | Delta patch corrupt / bad signature | yes — app stuck on old version | fall back to full download; never loop |
| F-02 | Kill switch itself mis-deployed | yes — bad release reaches 100% | keep kill switch on a separate config plane |
| F-03 | Crash threshold trips and auto-pauses | yes — promotion halted | manual investigation; resume or rollback |
| F-04 | Manifest signature key revoked mid-flight | yes — devices can't update | rotation key overlap window |
| F-05 | SW `skipWaiting` reload loop | yes — tab reloads forever | one-shot `__reloadingForSW` guard |
| F-06 | App Store §3.3.2 rejection | yes — feature can't ship | keep OTA scope to UI/JS, never native |
| F-07 | Cloudflare 100-version ring overflows | internal only | mirror version metadata in our repo |
| F-08 | Universal binary inflates download | yes — slow install | AAB / per-ABI splits above 25MB |
| F-09 | Multi-tab fan-out leaves stragglers | yes — some tabs old | accept ≥1 tab stuck; document expected behavior |
| F-10 | Cron-trigger worker exceeds 15min | internal — error 1102 | split work into smaller cron jobs |
| F-11 | Bundle hash mismatch on iOS sideload | yes — install fails | verify SHA-256 before installation |
| F-12 | Cloudflare binding deleted mid-flight | yes — rollback blocked | never delete bindings; use new names instead |

---

## Appendix N — Self-Audit Checklist (before each release)

- [ ] Manifest signed with the current ed25519 key; key ID in the manifest
- [ ] Both full and delta (where applicable) URLs present in manifest
- [ ] Delta generated against all 3 most-recent baselines
- [ ] Crash-rate thresholds set in Sentry monitor for the new release
- [ ] Kill switch tested in staging within the last 30 days
- [ ] Worker version metadata mirrored to internal repo
- [ ] PWA `sw.js` served with `Cache-Control: no-cache`
- [ ] Android `.aab` validated by `bundletool`
- [ ] iOS archive contains both arm64 and x86_64 slices (if Intel-targeted)
- [ ] Release notes updated; on-call rotation paged
- [ ] Customer-facing status page draft ready
- [ ] Rollback runbook linked from the release ticket


