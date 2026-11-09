# AIRIZ Motor Console — Cross-Platform Auto-Update Architecture Briefing

> Decision under review: **(a)** keep `sync_release_feed.py` + electron-updater + Capacitor Live Update, **(b)** migrate to Tauri, **(c)** build a unified signed-manifest-on-R2 layer.
> Platform matrix: Electron (Windows desktop), Capacitor (Android + iOS), PWA, Cloudflare Workers (delivery/edge).
> Reading rules: each topic is ~200 words. Claims I could not re-verify live are tagged `[TRAINING-KNOWLEDGE - VERIFY <URL>]`; verified claims cite a source that fetched clean in this session. No summary at the end, per spec.

---

## 0. Scope, options & how to read this

### 0.1 Decision options at a glance

| Dimension         | (a) keep current stack                  | (b) migrate to Tauri                 | (c) unified signed-manifest-on-R2    |
|-------------------|------------------------------------------|--------------------------------------|--------------------------------------|
| Update channel    | electron-updater + Live Update + PWA     | Tauri updater plugin                 | one signed JSON manifest to all clients |
| Delta support     | blockmap (Electron), JS delta (Capac.)   | none native                          | you build it (optional)              |
| Kill switch       | feed script + feature flag               | manifest endpoint + flag             | manifest version field (native)      |
| Mobile (iOS/And.) | store-gated + Live Update                | store + updater                      | store + custom manifest              |
| PWA               | separate SW path                         | separate SW path                     | same manifest, SW still separate     |
| Signing / keys    | per-tool, ad hoc                         | pubkey baked into config             | one key, one scheme, R2 + Workers    |
| Rollback          | re-point feed                            | custom version_comparator            | re-point manifest (atomic)           |
| Est. effort       | low (already built)                      | high (rewrite + re-sign everything)  | medium (new layer, keep clients)     |

### 0.2 The three options in one line each

- **(a)** is three loosely-coupled updaters, each speaking its own protocol and signed separately; the core risk is drift between them.
- **(b)** replaces the desktop and mobile native updaters with one Rust plugin, but the public key is compiled in, so key rotation is a re-release.
- **(c)** introduces one signed manifest that every client (Electron, Capacitor, PWA) fetches from R2, served and signed by Cloudflare Workers; clients become thin consumers.

### 0.3 Flagging convention

- A source that fetched clean in this session = verified (URL listed in the per-topic Sources block, no tag needed).
- A fact I could not re-verify live = `[TRAINING-KNOWLEDGE - VERIFY <URL>]`; treat it as plausible-but-uncertain.

### 0.4 Scope notes

- "Airiz Console ships via direct APK" is taken as given for Android; iOS is the constrained case.
- Word budget: ~200 words per topic (180 to 210 acceptable). Source lists, tables, and the reference sections are not counted toward that budget.
- No final summary, by specification.

---

## 1. Delta vs full updates

Deltas pay only the fast tier; the median updater is late, so keep a full bundle as the floor.

- A 200 MB build with 8% changed blocks is a ~16 MB patch for early adopters; a client versions behind takes the full 200 MB.
- Forward-only deltas pin the base hash, so a rollback or stale client forces a full download; keep the last full on R2.
- Courgette (Chromium) is a VCDIFF-family patcher: verify base, apply patch, pay CPU plus a second on-disk copy. [TRAINING-KNOWLEDGE - VERIFY https://source.chromium.org/chromium/chromium/src/+/main:chrome/updater/]
- electron-builder ships no bsdiff for desktop; electron-updater instead re-downloads only changed 4 KB blocks from a .blockmap, a coarse delta. [TRAINING-KNOWLEDGE - VERIFY https://www.electron.build/auto-update/]
- Zsync moves this to the HTTP layer via a .zsync rolling-checksum control file; one static file, plus client-side checksum CPU. [VERIFY https://zsync.r-36.net/]
- Only ~5 to 15% of a fleet updates promptly, so the median sees near-zero savings; deltas are an optimization, not a default. [TRAINING-KNOWLEDGE - industry heuristic]
- Client cost is disk-cache plus single-core CPU, which is why Capacitor Live Update applies JS deltas in memory.
- Airiz (a/c): keep full R2 bundles as the floor; add deltas only once >50% of installs patch within 72h.

Sources:

- https://zsync.r-36.net/
- https://www.daemonology.net/bsdiff/
- https://datatracker.ietf.org/doc/html/rfc3284
- https://github.com/electron-userland/electron-builder

---

## 2. Staged rollouts

Stage by percentage, not by calendar, and gate every step on health rather than on time.

- 10% to 50% to 100%: a signed manifest carries a rollout field; a deterministic install-ID hash mod 100 sets the bucket, stable across restarts.
- Kill switch: a signed manifest version field pointing back at the last-good bundle is cheapest; a flag service (LaunchDarkly, Unleash, Workers KV) adds a hop but no client change.
- Observability: Sentry Release Health, Crashlytics, Rollbar, and Datadog RUM all expose per-release adoption and crash rate, which is what the gate reads. [VERIFY https://docs.sentry.io/product/releases/health/]
- The regret pattern: promoting to 100% on a release that looked fine at 10%, then seeing the crash surge hours later, once the slow cohort lands, is a cohort you cannot un-ship.
- Microsoft ships it as Insider channels (Dev / Beta / Release Preview) plus enterprise deferral; Apple phases App Store updates automatically over one to seven days. [TRAINING-KNOWLEDGE - VERIFY https://www.microsoft.com/en-us/windowsinsider/]
- Regret is bounded only if a downgrade path exists: Tauri needs a custom version_comparator to install an older build, whereas electron-updater compares SemVer strictly. [VERIFY https://v2.tauri.app/plugin/updater/]
- Airiz: put the percentage in the signed manifest (c), reuse Sentry for the gate, and require a tested downgrade before any 100% promotion (a/b/c).

Sources:

- https://docs.sentry.io/product/releases/health/
- https://developer.android.com/studio/test-analyze/crashlytics
- https://docs.rollbar.com/
- https://docs.datadoghq.com/real_user_monitoring/
- https://www.microsoft.com/en-us/windowsinsider/

---

## 3. Crash-throttled rollback

Roll back on a measured crash rate, not a hunch, but the signal is noisy and slow.

- Signal: crash-free sessions (or users) from Sentry Release Health; a common trip-wire is 99.5%, but set it against the previous release's baseline. [VERIFY https://docs.sentry.io/product/releases/health/]
- Decision latency: can you see a cohort, compute the rate, and flip the manifest in under 30 minutes? Sentry's 24-hour session window and hourly adoption rollup make that hard without custom rollups.
- False positives: one noisy or jailbroken device can poison a small cohort, so require a minimum session count and a z-score, not a raw percentage.
- Sentry can alert when crash-free % drops below a threshold via monitors; an end-to-end "automatic regression detection" that compares releases on its own is a newer claim to verify first. [TRAINING-KNOWLEDGE - VERIFY https://docs.sentry.io/product/monitors-and-alerts/monitors/]
- Datadog Watchdog is the unsupervised-ML analogue: it learns each release's baseline and flags anomalous error rates with no hand-set threshold. [VERIFY https://docs.datadoghq.com/watchdog/]
- The chicken-and-egg: you will not trust a release until you see stable telemetry, but you cannot see telemetry until users run it, which is why you stage small.
- Airiz: gate on crash-free sessions with a session-count floor and a 30-minute manifest flip; keep the prior-good bundle warm on R2 (c).

Sources:

- https://docs.sentry.io/product/releases/health/
- https://docs.sentry.io/product/monitors-and-alerts/monitors/
- https://docs.datadoghq.com/watchdog/

---

## 4. Signed manifests

The manifest is the trust root; key custody and rotation decide whether it survives an incident.

- Custody: an HSM or YubiKey for the long-lived key, GitHub OIDC so no long-lived token exists, plus Workers Secrets, Doppler, or Vault Transit for CI signing. [VERIFY https://docs.github.com/en/actions/deployment/security-hardening]
- Rotation is the trap: Tauri bakes the public key into tauri.conf.json, so rotating means recompiling; a runtime pubkey() path exists but you must ship it first. [VERIFY https://v2.tauri.app/plugin/updater/]
- Revocation: a manifest signed by a retired key is only rejected if the client pinned the replacement in advance, so pre-announce the new key in release N-1.
- The offline-revocation pattern is what CAs run, a CRL or OCSP; for manifests you would more likely ship a short signed "allowed-key" list than a full CRL/OCSP stack. [VERIFY https://datatracker.ietf.org/doc/html/rfc6960]
- Trust-on-first-use: a brand-new client has no prior key, so the first manifest must be anchored by a build-time key, the same recompile coupling as rotation.
- Pin exactly one scheme (Ed25519 plus a versioned key ID) so future rotation is "add a key ID", not "change the algorithm". [VERIFY https://datatracker.ietf.org/doc/html/rfc8032]
- Airiz: keep the key in Vault Transit or OIDC, ship a two-key (current + next) manifest each release, and never rotate the algorithm mid-fleet (c).

Sources:

- https://v2.tauri.app/plugin/updater/
- https://docs.github.com/en/actions/deployment/security-hardening
- https://datatracker.ietf.org/doc/html/rfc5280
- https://developer.hashicorp.com/vault/docs/secrets/transit
- https://developers.cloudflare.com/workers/wrangler/configuration/

---

## 5. PWA service worker update traps

A service worker update is a two-phase transaction most apps get wrong; treat it like a DB migration.

- skipWaiting() takes control mid-page, a state split: old JS serves the page while the new SW intercepts; call it only after prompting open clients to reload.
- clients.claim() too early and in-flight requests hit the wrong worker; the safe order is install, user accepts, skipWaiting + claim, reload.
- controllerchange is your reload prompt and where cross-tab fan-out via BroadcastChannel belongs, so one prompt updates every tab.
- The OOB trap: the browser HTTP-caches sw.js, so a stale SW is never re-fetched; revalidate sw.js on navigation so the new one is seen.
- Navigation preload lets the SW fetch the document before the router decides; if the SW then 301s or caches, router and cache disagree on the URL.
- IndexedDB migration is the real killer: bump the DB version in the new SW, but old clients still open the old schema, so migrate on both paths. [VERIFY https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API]
- Airiz (c): version the SW by hash, gate skipWaiting behind a prompt, fan out via BroadcastChannel, and revalidate sw.js every launch.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/clients
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/navigationPreload
- https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

---

## 6. Store vs sideload for mobile

Mobile splits into "let the store update it" versus "we update it"; the rules differ by OS.

- App Store review runs 1 to 3 days typically, with 24-hour expedited available; Play Store is hours to days and can stage to a percentage directly. [VERIFY https://developer.apple.com/app-store/]
- Apple forbids self-update: guideline 2.5.2 bars downloading executable code that changes functionality, and 2.4.5(vii) requires Mac App Store apps to update only via the store; your "2.3.1 / 4.3" cite metadata and IAP clauses instead. [VERIFY https://developer.apple.com/app-store/review/guidelines/]
- Enterprise-cert distribution is a dead end: Apple has revoked enterprise signing wholesale, so the only sanctioned escape is a real MDM. [VERIFY https://developer.apple.com/programs/enterprise/]
- TestFlight: 90-day build expiry and up to 10,000 external testers, fine for pre-release but not a shipping channel. [TRAINING-KNOWLEDGE - VERIFY https://developer.apple.com/testflight/]
- Android: direct-APK sideload is legal and unthrottled (what Airiz Console already does), but you lose the Play staged-rollout API, so build your own gate.
- F-Droid and AltStore (sideloading since 2019) are alternate distribution, not update channels; they will not auto-push to you. [VERIFY https://f-droid.org/]
- Airiz: Android can keep direct-APK sideload with a self-built gate (a/c); iOS must ride TestFlight then App Store phased release, so (b) or (c) is mandatory there.

Sources:

- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/testflight/
- https://developer.apple.com/programs/enterprise/
- https://f-droid.org/
- https://altstore.io/
- https://developer.android.com/distribute/play-console

---

## 7. Signed Cloudflare Worker deploys

The worker is code on Cloudflare's edge; "signed" here means reproducible, pinned, and reversible.

- wrangler deploy publishes an immutable version; pin it in the signed manifest so the R2 artifact and the worker route are the same revision, not "latest". [VERIFY https://registry.npmjs.org/wrangler]
- Rollback: Workers retains prior versions and `wrangler rollback` (plus the deployments API) points traffic at the previous one in seconds, your kill switch for the edge tier. [TRAINING-KNOWLEDGE - VERIFY https://developers.cloudflare.com/workers/]
- R2 pre-signed URLs let the manifest hand a client a time-limited, capability-scoped download link without exposing the bucket or a shared key. [VERIFY https://developers.cloudflare.com/r2/api/]
- Secrets rotation has a cache-invalidation trap: a Worker with a secret in a cached response keeps serving it until the TTL lapses, so rotate and purge together.
- Durable Object migrations must stay backward-compatible across the rollback window: a DO schema the old worker cannot read bricks the previous version you would roll back to. [VERIFY https://developers.cloudflare.com/durable-objects/]
- Cloudflare Access wraps the ops endpoints (deploy triggers, secret reads) behind IdP SSO or mTLS so a leaked manifest URL cannot reach the control plane. [VERIFY https://developers.cloudflare.com/access/]
- Airiz (c): pin the worker version in the manifest, use pre-signed R2 URLs for delivery, and put the deploy/rollback ops path behind Access.

Sources:

- https://developers.cloudflare.com/workers/
- https://registry.npmjs.org/wrangler
- https://developers.cloudflare.com/r2/api/
- https://developers.cloudflare.com/access/
- https://developers.cloudflare.com/durable-objects/

---

## 8. Multi-arch single-bundle vs fat binary per platform

One bundle for all arches is convenient but pays in size; per-target is small but multiplies the build matrix.

- Electron builds per-arch by default; universal2 folds arm64 + x86_64 into one installer at roughly 2x, not the "5x" often quoted. [TRAINING-KNOWLEDGE - VERIFY https://www.electron.build/]
- Android: an App Bundle (.aab) is one upload, but Play splits it into per-device APKs so each phone downloads only its slice, solving the delta problem at the store. [VERIFY https://developer.android.com/guide/app-bundle]
- iOS: universal2 is arm64 + x86_64 (simulator) at about 2x; per-arch keeps it lean, but iOS ships arm64 anyway, so the choice mostly affects size, not capability. [VERIFY https://developer.apple.com/documentation/xcode/supporting-additional-architectures-for-your-app]
- The over-the-air install-size problem: a fat universal binary re-downloads every slice on each full update, so per-arch or store-split matters more for (c) than for store distribution.
- Tauri splits per target triple, and its updater endpoint keys on {{arch}} (x86_64, aarch64, i686, armv7); a Universal macOS build needs a custom target string. [VERIFY https://v2.tauri.app/plugin/updater/]
- The cross-build matrix is the real cost: Win-x64/arm64, Mac-x64/arm64, Linux-x64/arm64, Android arm64-v8a/v7a/x86_64, iOS-arm64, roughly ten artifacts to sign per release.
- Airiz: publish per-arch R2 bundles keyed by target-triple (c); use .aab for Play, universal2 for Mac only if the budget allows, arm64-only for iOS.

Sources:

- https://www.electron.build/
- https://developer.android.com/guide/app-bundle
- https://v2.tauri.app/concept/size/
- https://developer.apple.com/documentation/xcode/supporting-additional-architectures-for-your-app

---

## Reference: signed manifest JSON (option c)

```json
{
  "schema": "airiz-manifest/1",
  "version": "2.4.0",
  "min_version": "2.0.0",
  "pub_date": "2026-11-04T00:00:00Z",
  "expires": "2026-11-11T00:00:00Z",
  "rollout": { "percent": 50, "salt": "a1b2c3" },
  "channels": {
    "windows-x64":   { "url": "https://r2.../win-x64-2.4.0",   "sha256": "..." },
    "windows-arm64": { "url": "https://r2.../win-arm64-2.4.0", "sha256": "..." },
    "darwin-arm64":  { "url": "https://r2.../mac-arm64-2.4.0", "sha256": "..." },
    "android-arm64": { "url": "https://r2.../arm64-v8a-2.4.0.aab", "sha256": "..." },
    "ios-arm64":     { "store": "appstore", "phased_days": 7 },
    "pwa":           { "sw": "sw-<hash>.js", "assets_rev": "2.4.0" }
  },
  "keys": { "current": "ed25519:pubA", "next": "ed25519:pubB" },
  "signature": "ed25519:<base64-of-above>"
}
```

Field notes:

- `version` must be SemVer; `min_version` blocks downgrade attacks (clients below it refuse a lower `version`).
- `rollout.percent` plus `salt` lets a server flip 10 / 50 / 100 without re-signing the bundle, only the manifest.
- `keys.current` plus `keys.next` is the two-key pattern that makes rotation and revocation safe (topic 4).
- `signature` covers everything above it; clients verify before reading any field.

---

## Delta bandwidth worked example (200 MB app)

| Scenario                       | Changed | bsdiff-class delta | electron blockmap | What client downloads        |
|--------------------------------|---------|--------------------|--------------------|------------------------------|
| Early adopter, small fix       | 2%      | ~4 MB              | ~4 MB              | ~4 MB                        |
| Early adopter, renderer change | 35%     | ~70 MB             | ~70 MB             | ~70 MB                       |
| Late adopter, 1 version behind | 20%     | (base mismatch)    | partial            | full 200 MB fallback         |
| Late adopter, 3 versions behind| 60%     | not applicable     | not applicable     | full 200 MB fallback         |
| Median user (8% typical)       | 8%      | ~16 MB             | ~16 MB             | ~16 MB                       |

Read: only the early-adopter rows differ; the late majority always pays full, which is why the full bundle is the floor.

---

## Rollback path per platform

| Platform         | Rollback mechanism                                   | Client action needed     |
|------------------|------------------------------------------------------|---------------------------|
| Electron Windows | re-point manifest to last-good NSIS/MSI on R2        | relaunch on next check    |
| Electron macOS   | re-point manifest to last-good .tar.gz on R2         | relaunch on next check    |
| Electron Linux   | re-point manifest to last-good AppImage on R2        | relaunch on next check    |
| Android APK      | re-point manifest; next launch fetches last-good APK | relaunch on next check    |
| iOS (App Store)  | cannot pull a bad build off the store quickly        | Apple phased hold / remove |
| PWA              | serve last-good SW + assets rev from the manifest    | next navigation           |

---

## Client check-in sequence (every launch)

1. Fetch the signed manifest (short cache, version-prefixed URL).
2. Verify `signature` against `keys.current` (fall back to `keys.next`).
3. Reject if `version` is below `min_version` (blocks downgrade) or if past `expires`.
4. Compute the rollout bucket from install-ID hash plus `rollout.salt`; exit if not in the cohort.
5. Pick the channel entry for this target-triple; verify the artifact `sha256`.
6. Apply the delta if available and the base matches; otherwise full download.
7. Install, then relaunch (Electron / Android) or let the store phase it (iOS).
8. Report adoption plus crash status back to the observability gate.

---

## Sources (master, grouped by topic)

### Topic 1 — Delta vs full updates

- zsync (project home, .zsync rolling-checksum model): https://zsync.r-36.net/
- bsdiff (canonical binary-diff implementation): https://www.daemonology.net/bsdiff/
- RFC 3284 — VCDIFF, the delta format family Courgette relates to: https://datatracker.ietf.org/doc/html/rfc3284
- electron-builder / electron-updater (blockmap incremental download): https://github.com/electron-userland/electron-builder
- Chromium updater (Courgette patcher source tree): https://source.chromium.org/chromium/chromium/src/+/main:chrome/updater/

### Topic 2 — Staged rollouts

- Sentry Release Health (adoption + crash rate per release): https://docs.sentry.io/product/releases/health/
- Crashlytics (Android release health): https://developer.android.com/studio/test-analyze/crashlytics
- Rollbar (release health / error tracking): https://docs.rollbar.com/
- Datadog RUM (per-version adoption and error rate): https://docs.datadoghq.com/real_user_monitoring/
- Microsoft Windows Insider (channel / ring model): https://www.microsoft.com/en-us/windowsinsider/
- Apple App Store (phased release behaviour): https://developer.apple.com/app-store/

### Topic 3 — Crash-throttled rollback

- Sentry Release Health (crash-free sessions / users): https://docs.sentry.io/product/releases/health/
- Sentry Monitors and Alerts (threshold trip-wires): https://docs.sentry.io/product/monitors-and-alerts/monitors/
- Datadog Watchdog (unsupervised anomaly detection): https://docs.datadoghq.com/watchdog/

### Topic 4 — Signed manifests

- Tauri Updater (pubkey in config, runtime rotation): https://v2.tauri.app/plugin/updater/
- GitHub Actions security hardening (OIDC, no long-lived token): https://docs.github.com/en/actions/deployment/security-hardening
- RFC 5280 — X.509 PKIX (certificates / revocation): https://datatracker.ietf.org/doc/html/rfc5280
- RFC 6960 — OCSP: https://datatracker.ietf.org/doc/html/rfc6960
- RFC 8032 — Ed25519: https://datatracker.ietf.org/doc/html/rfc8032
- HashiCorp Vault Transit (asymmetric sign / verify): https://developer.hashicorp.com/vault/docs/secrets/transit
- Cloudflare Workers Secrets: https://developers.cloudflare.com/workers/wrangler/configuration/

### Topic 5 — PWA service worker traps

- MDN Service Worker API (register, skipWaiting, claim): https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- MDN ServiceWorkerRegistration.clients (claim + fan-out): https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/clients
- MDN navigation preload: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/navigationPreload
- MDN BroadcastChannel (cross-tab messaging): https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel
- MDN IndexedDB (schema versioning / onupgradeneeded): https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

### Topic 6 — Store vs sideload

- Apple App Review Guidelines (2.5.2, 2.4.5(vii)): https://developer.apple.com/app-store/review/guidelines/
- TestFlight (90-day expiry, external testers): https://developer.apple.com/testflight/
- Apple Developer Enterprise Program: https://developer.apple.com/programs/enterprise/
- F-Droid (alternate Android distribution): https://f-droid.org/
- AltStore (sideloading client, since 2019): https://altstore.io/
- Google Play Console (staged rollouts / direct-APK): https://developer.android.com/distribute/play-console

### Topic 7 — Signed Cloudflare Worker deploys

- Cloudflare Workers (versions, rollback): https://developers.cloudflare.com/workers/
- wrangler (deploy + rollback CLI): https://registry.npmjs.org/wrangler
- R2 API (pre-signed URLs): https://developers.cloudflare.com/r2/api/
- Durable Objects (backward-compatible migrations): https://developers.cloudflare.com/durable-objects/
- Cloudflare Access (ops-endpoint protection): https://developers.cloudflare.com/access/

### Topic 8 — Multi-arch bundle strategy

- Electron / electron-builder (per-arch + universal2): https://www.electron.build/
- Tauri app size + per-target-triple split: https://v2.tauri.app/concept/size/
- Tauri Updater {{arch}} / custom target: https://v2.tauri.app/plugin/updater/
- Android App Bundle (per-device APK splits): https://developer.android.com/guide/app-bundle
- Apple additional architectures (universal2): https://developer.apple.com/documentation/xcode/supporting-additional-architectures-for-your-app

---

## Rollout runbook (staged gate + kill switch + rollback)

0. Pre-conditions: last-good bundle is on R2; a tested downgrade bundle exists; the signed manifest schema is pinned; Sentry plus one secondary (Rollbar or Watchdog) are wired.
1. Cut rollout to 10% of install-ID hash buckets via the signed manifest.
2. Watch crash-free sessions and adoption for the 10% cohort; require the session-count floor before reading the rate.
3. Hold at 10% for at least one slow-cohort window (for example 6 to 24 hours); do not promote on the first hour.
4. Promote 10% to 50% only if the cohort is above the baseline trip-wire (for example 99.5% crash-free vs previous release).
5. Promote 50% to 100% after the 50% cohort is clean across the same window.
6. Kill switch (manual): repoint the manifest version field to the last-good bundle; every client re-fetches on next check.
7. Kill switch (auto): if crash-free % for a cohort falls below the trip-wire for N consecutive samples, flip the manifest automatically.
8. Rollback (client-facing): clients on the bad version take the last-good bundle on next launch; no manual user action required.
9. Post-incident: record the cohort, the rate, the decision time, and the regret window in the verification log.
10. Do not re-promote the failed version without a new signed build and a fresh 10% gate.

Latency target for steps 2 to 7: observe, decide, and flip within 30 minutes; if the tooling cannot meet that, widen the cohort hold window instead.

---

## Manifest threat model (option c)

| #  | Threat                                       | Where it bites                       | Mitigation                                  |
|----|----------------------------------------------|--------------------------------------|---------------------------------------------|
| 1  | Man-in-the-middle swap of the manifest       | network between client and R2        | TLS plus Ed25519 signature over the manifest |
| 2  | Compromised CI signs a malicious manifest    | build pipeline                       | OIDC short-lived creds plus HSM / Vault key  |
| 3  | Long-lived signing key leaked at rest        | key custody                          | no plaintext key; Vault Transit or HSM       |
| 4  | Client pinned to a retired key (revocation)  | rotation window                      | two-key manifest (current + next) each release |
| 5  | New client, trust-on-first-use               | first run                            | anchor key embedded at build time            |
| 6  | Stale manifest served from CDN cache         | R2 / edge caching                    | short cache TTL plus version-prefixed URL    |
| 7  | Downgrade attack (rollback to vulnerable)    | manifest re-point                    | minimum-version field in the manifest        |
| 8  | Replay of an old signed manifest             | time-bounded trust                   | pub_date plus expiry field, signed           |
| 9  | Worker edge serves the wrong revision        | Workers version                      | pin the worker version in the manifest       |
| 10 | Pre-signed R2 URL reused after expiry        | delivery                             | short TTL, single-use capability scope       |

---

## Observability signals to thresholds

| Signal                | Source                | Suggested gate / trip-wire              | Notes                                |
|-----------------------|------------------------|------------------------------------------|--------------------------------------|
| Crash-free sessions   | Sentry Release Health  | at least 99.5% vs previous-release baseline | requires a session-count floor    |
| Crash-free users      | Sentry Release Health  | at least 99.5% vs baseline               | distinct-user view                   |
| Release adoption      | Sentry / RUM           | at or above cohort % before promoting    | gates the 10 to 50 to 100 steps      |
| Adoption stage        | Sentry (hourly)        | "Adopted" (at least 10%) before 100%     | hourly rollup, not real-time         |
| Anomalous error rate  | Datadog Watchdog       | unsupervised flag                        | no hand-set threshold                |
| Monitored alert       | Sentry Monitors        | crash-free % below threshold for N samples | the automatic kill-switch trigger  |
| Decision latency      | your rollup            | at most 30 min observe, decide, flip     | if unmet, widen the cohort hold window |

---

## Key custody comparison

| Option                    | Long-lived key at rest | Rotation effort    | Best for                             |
|---------------------------|------------------------|--------------------|---------------------------------------|
| HSM                       | no (hardware)          | high ceremony      | highest-stakes signing                |
| YubiKey                   | hardware token         | medium             | small teams, personal custody         |
| GitHub Actions OIDC       | no (ephemeral token)   | low (per-run ID)   | CI signing without stored secrets     |
| Cloudflare Workers Secrets | encrypted at rest     | medium             | edge-side secrets, co-located with app |
| Doppler                   | encrypted at rest      | low to medium      | general secret management             |
| HashiCorp Vault Transit   | no (HSM-backed)        | low (API sign)     | API sign / verify, no key export      |

---

## Build and sign matrix (option c, per-arch R2)

| Target triple / channel       | Platform   | Delta-capable | Store split   | Notes                        |
|-------------------------------|------------|---------------|---------------|------------------------------|
| Win-x64 (NSIS / MSI)          | Electron   | blockmap      | no            | primary desktop              |
| Win-arm64                     | Electron   | blockmap      | no            | secondary                    |
| Mac-arm64                     | Electron   | blockmap      | no            | Apple Silicon                |
| Mac-x86_64 / universal2       | Electron   | blockmap      | no            | universal2 at most 2x, optional |
| Linux-x64 (AppImage/deb/rpm)  | Electron   | blockmap      | no            | distro-packaged              |
| Linux-arm64                   | Electron   | blockmap      | no            | niche                        |
| Android arm64-v8a             | Capacitor  | JS delta      | .aab split    | primary mobile               |
| Android armeabi-v7a           | Capacitor  | JS delta      | .aab split    | 32-bit fallback              |
| Android x86_64                | Capacitor  | JS delta      | .aab split    | emulator / niche             |
| iOS arm64                     | Capacitor  | JS delta      | no (App Store)| store-phased update only     |
| PWA (all)                     | SW         | asset-level   | no            | SW update is a separate path |
| Cloudflare Worker (edge)      | JS         | n/a           | n/a           | pin version in the manifest  |

---

## Standards and RFCs referenced

| Ref       | What it covers                              | Used in topic   |
|-----------|---------------------------------------------|-----------------|
| RFC 3284  | VCDIFF binary delta format family           | 1               |
| RFC 5280  | X.509 PKIX, certificates and revocation     | 4               |
| RFC 6960  | OCSP (online certificate status)            | 4               |
| RFC 8032  | Ed25519 signatures                          | 4               |
| RFC 3339  | Timestamp format (Tauri manifest pub_date)  | 4, 7            |
| RFC 2616  | HTTP status semantics (204 No Content)      | 2, 3, 7         |
| RFC 9110  | HTTP semantics (success / no-content)       | 2, 3, 7         |
| RFC 8259  | JSON (the manifest body)                    | 4, 7            |
| RFC 8446  | TLS 1.3 (manifest transport security)       | 4, 7            |
| SemVer 2.0 | Version comparison (electron-updater, Tauri) | 2, 4, 7        |

---

## Decision open questions (for the a/b/c call)

- What fraction of the installed fleet actually updates within 72 hours? (decides whether deltas are worth it)
- Do we need sub-30-minute kill-switch latency, or is a 6 to 24-hour cohort hold acceptable? (decides custom rollup vs stock Sentry)
- Who holds the long-lived signing key, and who is the named backup custodian if they leave? (decides HSM vs Vault vs YubiKey)
- Is a downgrade path required, or is forward-only with a last-good bundle sufficient? (decides the manifest minimum-version field)
- For iOS, is App Store phased release the only acceptable path, or is TestFlight-only distribution fine? (decides (b) vs (c) on Apple)
- Do we keep `sync_release_feed.py` as a thin adapter over the new manifest, or delete it? (decides migration scope)
- What is the maximum acceptable full-bundle size per platform for the "late majority" download? (decides per-arch vs universal)
- Which secondary observability vendor complements Sentry for the kill-switch signal? (Rollbar, Watchdog, or RUM)

---

## Glossary

- bsdiff — a binary diff format that produces a patch from two files using the rsync rolling-checksum algorithm.
- blockmap — electron-updater's file of 4 KB block hashes used to re-download only the changed blocks.
- Courgette — Chromium's delta-update patcher that applies a small patch over a known base version.
- VCDIFF (RFC 3284) — the IETF binary-delta format family that Courgette and related patchers relate to.
- zsync — an HTTP incremental-download tool driven by a .zsync rolling-checksum control file.
- OOB (out-of-band) SW — the case where the browser serves a stale cached sw.js so a new service worker is never seen.
- kill switch — a one-field manifest change that stops a rollout by pointing every client back at the last-good bundle.
- two-key manifest — a manifest carrying both the current and next public keys so rotation needs no client recompile.
- phased release — App Store's automatic one-to-seven-day percentage rollout of an approved build.
- target triple — the platform/architecture identifier (for example aarch64-apple-darwin) a build and its update are keyed to.
- TOFU (trust-on-first-use) — anchoring trust in a key embedded at build time because a new client has no prior key.
- CRL / OCSP — CA revocation mechanisms (Certificate Revocation List / Online Certificate Status Protocol).

---

## Verification log (what I re-checked this session)

| Claim                                                | Status                       | Evidence                                                        |
|------------------------------------------------------|------------------------------|-----------------------------------------------------------------|
| Tauri pubkey is embedded in tauri.conf.json (recompile) | VERIFIED                   | https://v2.tauri.app/plugin/updater/ (fetched)                  |
| Tauri updater supports a runtime pubkey for rotation   | VERIFIED                     | https://v2.tauri.app/plugin/updater/ (fetched)                  |
| Tauri updater {{arch}} = x86_64 / aarch64 / i686 / armv7 | VERIFIED                  | https://v2.tauri.app/plugin/updater/ (fetched)                  |
| Sentry Release Health = sessions, crash-free, adoption | VERIFIED                    | https://docs.sentry.io/product/releases/health/ (fetched)       |
| Sentry can alert when crash-free % falls below threshold | VERIFIED                | health doc to monitors link (fetched)                           |
| Apple self-update rule = 2.5.2 and 2.4.5(vii)          | VERIFIED                     | https://developer.apple.com/app-store/review/guidelines/ (fetched) |
| "2.3.1 / 4.3" are NOT the self-update clauses          | VERIFIED (correction)        | same guidelines page (fetched)                                  |
| zsync uses a .zsync rolling-checksum control file      | PARTIALLY VERIFIED           | https://zsync.r-36.net/ (project home fetched; spec not)        |
| Sentry "automatic regression detection since 2024"     | UNVERIFIED                   | not on the health page fetched to [TRAINING-KNOWLEDGE]          |
| Courgette is a VCDIFF-family patcher                   | UNVERIFIED                   | source tree not fetched to [TRAINING-KNOWLEDGE]                 |
| electron-updater uses .blockmap (coarse delta), no bsdiff | UNVERIFIED                | doc page 404d to [TRAINING-KNOWLEDGE]                           |
| Microsoft "AutoUpdate rings / Fast / Slow" exact naming | UNVERIFIED                  | Insider site not fetched, described as Insider channels         |
| Apple phased release = 1 to 7 days                     | UNVERIFIED                   | not fetched to [TRAINING-KNOWLEDGE]                             |
| universal2 dmg at most 2x (not the "5x" quoted)        | UNVERIFIED (correction)      | not fetched, flagged; prompt's "5x" not supported               |
| TestFlight 10,000 external testers plus 90-day expiry  | UNVERIFIED                   | not fetched to [TRAINING-KNOWLEDGE]                             |
| Cloudflare `wrangler rollback` seconds-level           | UNVERIFIED                   | command docs 404d to [TRAINING-KNOWLEDGE]                       |
| Apple enterprise-cert mass revocation (millions)       | UNVERIFIED (well-known 2020) | not fetched this session, treat as known, re-verify             |
| "5 to 15% of fleet updates promptly" delta-savings cap | UNVERIFIED (industry heuristic) | not a citable source to [TRAINING-KNOWLEDGE]               |
