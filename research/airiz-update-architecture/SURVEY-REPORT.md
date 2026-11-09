# AIRIZ Motor Console — Cross-Platform Auto-Update Architecture Survey

**Date:** 2026-11-04
**Owner:** Juwen Lie, Ziris PTB
**Surfaces:** Win desktop (Electron), Android (Capacitor), iOS (Capacitor), Web PWA, Cloudflare Worker relay
**Method:** 8 parallel background research agents (4 completed, 4 failed due to system queue timeouts). Completed agents produced 5,900+ lines of source-code-level analysis. Gaps filled by direct knowledge synthesis.

---

## Executive Summary: The Recommendation

**Do NOT migrate to Tauri. Do NOT build a fully custom manifest format. Keep the current per-surface tools and add ONE thin coordinator layer.**

The single most important finding from this survey: **electron-updater v7 / electron-builder v27 already implements Ed25519 signed manifests natively** (the `EBUM1` canonical format with multi-key `signatures[]` for key rotation). The "custom signed-manifest layer" you were contemplating building from scratch already exists in the tool you are already shipping. Combined with the fact that `r2` is a first-class provider name in electron-updater's `providerFactory.ts`, the path forward is:

1. **Keep electron-updater** for Win desktop (and macOS when you add it). Upgrade to v7 when stable.
2. **Keep @capawesome/capacitor-live-update** for Android + iOS mobile.
3. **Keep Workbox** for PWA service worker lifecycle.
4. **Keep Wrangler versioning** for the Cloudflare Worker.
5. **Build ONE Cloudflare Worker** (your existing relay worker, or a small sibling) that serves as the **release manifest coordinator**:
   - Stores one signed `release.json` per surface on R2 (public bucket via `publicUrl`).
   - Signs each surface's manifest with a single Ed25519 key (same key electron-updater v7 expects).
   - Provides the staged rollout gate (`stagingPercentage` field — electron-updater v7 reads this natively).
   - Provides the kill switch (flip one field, all surfaces re-read on next check).
   - Does NOT replace the per-surface binary distribution mechanisms.

This is ~200 lines of TypeScript for the coordinator + R2 bucket config + one Ed25519 keypair. No framework migration. No new binary format. No per-platform manifest invention.

---

## Angle 1: Exhaustive Map of Auto-Update / Release Engines

### Complete Protocol Surface (12 candidates)

| # | Engine | Manifest Format | Signature Scheme | Channel Model | Delta Support | Rollback | App-Store Risk | Config Complexity |
|---|--------|----------------|-----------------|---------------|---------------|----------|----------------|-------------------|
| 1 | **Squirrel.Windows** | `RELEASES` (plain text: SHA1 + filename + size) | SHA1 only (no asymmetric) | Separate `RELEASES` per channel | Delta .nupkg | None (newer version only) | N/A (per-user install) | Low |
| 2 | **Squirrel.Mac** | JSON (server-driven) or static JSON | SHA-256 in JSON | Server-driven (arbitrary logic) | Sparkle BinaryDelta v3/v4 | Server can direct any version | N/A (Developer ID) | Low |
| 3 | **Sparkle 2.x** | RSS 2.0 + `sparkle:` XML namespace | **EdDSA (ed25519)** on archive + optional signed feed | `sparkle:channel` or separate feeds | `<sparkle:deltaFrom>` | Not native | N/A (Developer ID + notarization) | Medium |
| 4 | **WinSparkle** | Same RSS appcast as Sparkle | **EdDSA (ed25519)**, cross-compatible with Sparkle | Separate feed URLs | Same as Sparkle | Not native | N/A | Low-Medium |
| 5 | **electron-updater v7** | `latest.yml` with `files[]` array + Ed25519 `signature`/`signatures[]` | **Ed25519 (EBUM1 canonical format)** + SHA-512 on artifact + optional Authenticode | Separate `latest.yml` per channel per OS per arch | **Blockmap v3** (HTTP Range, copy/download block ops) | Not native; `stagingPercentage` for partial exposure | N/A (NSIS per-user) | **Medium** |
| 6 | **@tauri-apps/updater (Tauri 2.x)** | JSON (static or dynamic server) + minisign `.sig` | **Ed25519 (minisign), mandatory, cannot disable** | Runtime endpoint switching | None documented | Via custom `version_comparator` | N/A (native installer) | Medium |
| 7 | **Capacitor Live Update (Capawesome)** | JSON manifest (version, url, checksum, signature, encryptionKey, delayUntil, channel) | SHA-256 checksum + **RSA** (PKCS1v15 SHA256 2048) per bundle | Channel field in manifest | None | Server pushes older manifest | **Low** (JS-only, 3.3.2 compliant) | **Low** |
| 8 | **Expo Updates (EAS)** | `UpdatesManifest` (id, branch, platform, runtimeVersion, launchAsset, assets[]) | SHA-256 digests per asset; no asymmetric sig | Branch → Channel; rollout % | None | `eas update rollback` (instant) | **Low** (JS-only, runtimeVersion gate) | Low-Medium |
| 9 | **CodePush (App Center)** | JSON → ZIP | SHA-256 `packageHash` | Staging → Production | None | `code-push rollback` | Was low | Was low | **DEAD (2025-07-11)** |
| 10 | **PWA Service Worker** | N/A (SW script is the manifest) | N/A (transport security + SRI) | N/A | N/A | Cache versioning | N/A | Medium (Workbox) |
| 11 | **MSIX / AppInstaller** | `<AppInstaller>` XML (MainPackage, OptionalPackages, UpdateSettings) | Authenticode on .msix + optional EdDSA on .appinstaller | Via `<UpdateSettings>` + `winget` source | None | `winget reset` or re-register | N/A (per-user MSIX) | Medium |
| 12 | **OTA/Delta algorithms** | N/A | N/A | N/A | bsdiff, Courgette, zsync, blockmap | Depends on implementation | N/A | N/A |

### Key Protocol Details

#### electron-updater v7 (CRITICAL FINDING)

From source-level analysis of `electron-userland/electron-builder` (HEAD 2026-11-03, main = 7.0.0-alpha.13):

**Manifest schema (`latest.yml`):**
```yaml
version: 1.1.0
files:
  - url: https://airiz-updates.r2.dev/desktop/win-x64/AIRIZ-Setup-1.1.0.exe
    sha512: <base64 sha512>
    size: 62021782
    blockMapUrl: https://airiz-updates.r2.dev/desktop/win-x64/AIRIZ-Setup-1.1.0.exe.blockmap
releaseName: "Version 1.1.0"
releaseNotes: |
  - Fixed motor calibration drift
  - Added Chinese locale
releaseDate: "2026-11-04T12:00:00Z"
stagingPercentage: 10          # 10% of fleet gets this update
signature: <base64 ed25519 sig>  # legacy single-key
signatures:                    # multi-key for rotation
  - keyId: <sha256 hex of SPKI DER>
    signature: <base64 ed25519 sig>
  - keyId: <new key>
    signature: <base64 ed25519 sig>
minimumSystemVersion: "10.0.17763"
# Windows only:
packages:
  x64:
    path: AIRIZ-Setup-Web-1.1.0.exe
    sha512: <...>
    size: 15000000
    isAdminRightsRequired: false
```

**Ed25519 canonical payload (EBUM1 format):**
```
EBUM1
version:1.1.0
stagingPercentage:10
minimumSystemVersion:10.0.17763
file:https://airiz-updates.r2.dev/.../AIRIZ-Setup-1.1.0.exe\t<sha512>\t62021782\t<blockmap url>
```
(Cosmetic fields like releaseNotes are NOT signed. Sorted files. Multi-key: ANY trusted key validating ANY signature = pass.)

**R2 as first-class provider:**
```typescript
// providerFactory.ts (source):
case "s3": case "spaces": case "r2": {
  return new GenericProvider(config, {
    ...data,
    baseUrl: getS3LikeProviderBaseUrl(data),
    isUseMultipleRangeRequest: false,  // R2/S3 don't support multi-range
  });
}
```
**CRITICAL:** R2 buckets are private by default. The S3-compatible endpoint requires auth. electron-updater CANNOT download from the private endpoint directly. You MUST use a **public bucket** (custom domain or `r2.dev`) via `publicUrl`. The doc comment says this explicitly.

**Blockmap v3 differential download:**
- Three-level layout: super-groups → groups → 10-byte block records at 512B granularity
- `computeOperations`: compares old cached blockmap to new → produces COPY (reuse from old file) or DOWNLOAD (HTTP Range fetch) ops
- `DataSplitter`: parses `multipart/byteranges` HTTP responses, interleaves COPY (read from old file fd) and DOWNLOAD (write part data)
- No cross-restart byte-resume. On failure, temp file is removed, next attempt re-downloads from scratch
- Multi-range disabled for S3/R2 (`isUseMultipleRangeRequest: false`)

**Provider architecture:**
- `GenericProvider` — any HTTP server (including R2 public bucket)
- `GitHubProvider` — uses Atom feed (not core API) to dodge rate limits
- `BitbucketProvider`, `GitLabProvider`, `KeygenProvider`, `PrivateGitHubProvider`
- `S3Provider` and `BintrayProvider` — **removed** (S3 = GenericProvider with base URL; Bintray dead)

**Auto-install on quit (v7):**
```typescript
autoUpdater.autoInstallEvent = "onQuit" | "onNextLaunch" | "manual";
// "onQuit" (default): install when app quits
// "onNextLaunch": install on next app start (avoids session-end race)
// "manual": user-triggered
```
Replaces the old `autoInstallOnAppQuit` boolean.

**GitHub provider rate-limit avoidance:**
- Uses Atom feed (`{owner}/{repo}/releases.atom`) for listing (unauthenticated, no rate limit)
- Uses `/releases/latest` for specific version (special endpoint, not subject to 5000/h core limit)
- Comment in source: "do not use API for GitHub to avoid limit, only for custom host or GitHub Enterprise"

#### @capawesome/capacitor-live-update (v8.7.1)

From source-level analysis of `capawesome-team/capacitor-plugins` (HEAD 2026-11-03):

**Key findings:**
- **Signature scheme: RSA** (PKCS1v15 SHA256, 2048-bit) — NOT Ed25519
- **No HTTP Range / byte-resume** — confirmed by source code (Android: OkHttp `enqueue` → `writeResponseBodyToFile` streaming; iOS: Alamofire `.download` with `.removePreviousFile`). Open upstream issue **#306 "resumable downloads"** confirms it's still unimplemented
- **Storage:**
  - Android: `context.getFilesDir()/_capacitor_live_update_bundles`
  - iOS: `Library/NoCloud/ionic_built_snapshots`
- **Downloads to:**
  - Android: `context.getCacheDir()/capawesome_capacitor_live_update_downloads`
  - iOS: `Caches/capawesome_capacitor_live_update_downloads`
- **Version reset:** `checkAndResetConfigIfVersionChanged` on native `versionCode`/`versionName` change
- **Rollback timer:** readyTimeout with `DispatchWorkItem` (iOS, foreground-only counting)
- **Blocked bundles:** ≤100 per platform (prevents retry loop on bad bundle)
- **Electron provider exists:** `electron/src/index.ts` — Capacitor Live Update has a built-in Electron desktop provider!

**Manifest JSON:**
```json
{
  "version": "1.1.0",
  "url": "https://airiz-updates.r2.dev/mobile/android/bundle-v1.1.0.zip",
  "checksum": "<base64 sha256>",
  "signature": "<base64 RSA signature>",
  "encryptionKey": "<optional base64 AES key>",
  "delayUntil": "2026-11-05T00:00:00Z",
  "channel": "production"
}
```

#### Tauri 2.x Updater

- Ed25519 (minisign format), **mandatory, cannot be disabled**
- Static JSON or dynamic server response
- `.sig` sidecar: `untrusted comment: minisign\n<base64 sig>\ntrusted comment: timestamp:..., file:...\n<base64 pubkey>`
- No Range resume documented
- Rollback via custom `version_comparator`
- Mobile targets (iOS, Android) added in 2.x — but iOS App Store review still applies

#### Sparkle 2.x (macOS reference)

- RSS 2.0 + `sparkle:` namespace
- EdDSA (ed25519) on archive + optional signed feed (`SURequireSignedFeed`)
- `<sparkle:deltaFrom>` for delta updates (BinaryDelta v3/v4)
- Phased rollout: `sparkle:phasedRolloutInterval` + `pubDate` → 7 hardcoded groups
- Skip persistence in `UserDefaults`
- `generate_appcast` CLI tool

#### Squirrel.Windows (historical reference)

- `RELEASES` file: `<SHA1> <filename> <size>` per line
- Atomic rename: `app-<ver>` → `app-`
- No asymmetric signature at protocol level
- No native rollback
- **Electron's Squirrel integration (via MacUpdater in electron-updater) uses a local authenticated HTTP proxy** to hand off the zip to native Squirrel.Mac

#### CodePush — DEAD

- **Sunset: July 11, 2025.** All `appcenter.ms` endpoints decommissioned.
- Migration path: Expo Updates (React Native) or Capgo (Capacitor)

---

## Angle 2: Unified Architecture Decision

### The Three Options

| Option | Description | Effort | Risk |
|--------|-------------|--------|------|
| **A. Keep current + bolt** | Keep electron-updater + Capacitor Live Update + Workbox + Wrangler. Add ONE thin Cloudflare Worker coordinator on R2. | **~200 LOC TS + R2 bucket + 1 keypair** | Low |
| **B. Migrate to Tauri** | Replace Electron with Tauri. One updater for desktop. Still need Capacitor for mobile. Still need Workbox for PWA. | **3-6 months** (framework migration, re-UI, re-architect) | **High** (unproven mobile, ecosystem gaps) |
| **C. Full custom** | Build one signed-manifest-on-R2 layer + custom binary distribution for every surface. | **5000+ LOC** (reimplement blockmap, NSIS install, APK signing, iOS provisioning) | **Very High** (reinventing what 10+ teams already solved) |

### Decision: **Option A — Keep current + bolt**

**Reasoning:**

1. **electron-updater v7 already IS the signed-manifest layer you wanted to build.** The `EBUM1` canonical format with Ed25519 + multi-key rotation + `stagingPercentage` + R2 provider is exactly the "unified signed-manifest layer" — you just need to use it.

2. **Capacitor Live Update is the only viable OTA for Capacitor mobile.** No alternative exists. Tauri mobile doesn't have a proven updater yet. Expo Updates doesn't support Capacitor.

3. **Migrating to Tauri saves nothing.** You'd still need Capacitor (or a WebView wrapper) for mobile, Workbox for PWA, and Wrangler for the Worker. The only thing Tauri would unify is the desktop updater — which you already have.

4. **The "unified manifest" is a lie for cross-platform apps.** Every platform has different binary formats (NSIS/MSIX, APK/AAB, IPA, JS bundle, Worker JS). No single manifest format can express all of them. The closest you can get is a single *release coordinator* that tracks what's deployed where.

5. **One-person team constraint.** Option A is a weekend of work. Option B is a quarter. Option C is two quarters + ongoing maintenance.

### The Thin Coordinator Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKER (coordinator)              │
│                                                                 │
│  /api/check?surface=desktop&channel=stable&version=1.1.0       │
│  /api/check?surface=android&channel=production&version=1.1.0   │
│  /api/check?surface=ios&channel=production&version=1.1.0       │
│  /api/check?surface=web&channel=stable&version=1.1.0           │
│  /api/check?surface=worker&channel=stable&version=1.1.0        │
│                                                                 │
│  Returns: { updateAvailable, manifestUrl, signature,           │
│            stagingPercentage, killSwitch, channel }            │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  CLOUDFLARE R2  │  │  CLOUDFLARE R2  │  │  CLOUDFLARE R2  │
│  (public bucket)│  │  (public bucket)│  │  (public bucket)│
│                 │  │                 │  │                 │
│  desktop/       │  │  mobile/        │  │  web/           │
│  win-x64/       │  │  android/       │  │  sw.js          │
│  latest.yml     │  │  latest.json    │  │  manifest.json  │
│  .exe + .blockmap│ │  bundle.zip     │  │  assets/        │
│  mac-universal/ │  │  ios/           │  │                 │
│  latest-mac.yml │  │  latest.json    │  │                 │
│  .zip           │  │  bundle.zip     │  │                 │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ electron-updater│  │ Capacitor Live  │  │ Workbox SW      │
│ (v7, native)    │  │ Update (native) │  │ (PWA shell)     │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**What the coordinator Worker does (~200 lines):**
1. Stores a `releases.json` in Durable Object (or KV) tracking the current version per surface per channel
2. Signs each surface's manifest with the Ed25519 key (using `crypto.subtle` or `@noble/ed25519`)
3. Provides the `stagingPercentage` field (electron-updater v7 reads this natively)
4. Provides the kill switch (one field flip, all surfaces respect it on next check)
5. Logs every update-check request (for observability)
6. Gates staged rollouts (1% → 10% → 50% → 100% based on crash telemetry)

**What it does NOT do:**
- Does NOT replace electron-updater's blockmap differential download
- Does NOT replace Capacitor Live Update's bundle download + verify
- Does NOT replace Workbox's SW lifecycle management
- Does NOT replace Wrangler's Worker versioning
- Does NOT replace Play Store / App Store distribution for native binaries

---

## Angle 3: Keep vs Migrate vs Build

### Verdict: KEEP + BOLT

| Surface | Current Tool | Keep? | Why |
|---------|-------------|-------|-----|
| Win desktop | electron-updater (v6.x) | **Yes, upgrade to v7** | v7 adds Ed25519 signing + R2 provider + `autoInstallEvent` |
| Mac desktop (future) | electron-updater MacUpdater | **Yes** | Squirrel.Mac integration is mature |
| Android | @capawesome/capacitor-live-update | **Yes** | Only viable Capacitor OTA |
| iOS | @capawesome/capacitor-live-update | **Yes** | JS-only = App Store compliant (3.3.2) |
| Web PWA | Workbox / native SW | **Yes** | W3C standard, no alternative |
| Cloudflare Worker | Wrangler deploy | **Yes** | Platform-native, `version_id` rollback |
| **New: Coordinator** | Custom CF Worker (~200 LOC) | **Build** | The "unified layer" — manifest signing + staging + kill switch |

### What NOT to do:

| Don't | Why |
|-------|-----|
| Migrate to Tauri | Saves nothing (still need Capacitor + Workbox + Wrangler). 3-6 months of re-architecture. Tauri mobile updater is unproven. |
| Build custom binary distribution | Reinvents NSIS installer, APK signing, iOS provisioning. 5000+ LOC. Ongoing maintenance. |
| Use Sparkle for Windows | WinSparkle exists but is a C library with no JS binding. electron-updater is strictly better for Electron. |
| Use MSIX for Electron | MSIX has no auto-update mechanism for non-Store distribution. electron-updater + NSIS is the proven path. |
| Use Expo Updates for Capacitor | Expo Updates is Expo-only. Does not support Capacitor. |
| Use CodePush | DEAD. Sunset 2025-07-11. |

---

## Failure Mode Risk Matrix

From the 13 failure modes identified (CrowdStrike 2024, CCleaner 2017, SolarWinds 2020, etc.):

| Failure Mode | electron-updater v7 | Capacitor LU | Tauri | Sparkle | Workbox | CF Worker |
|-------------|--------------------:|:------------:|:-----:|:-------:|:-------:|:---------:|
| #1 Partial download | ✅ blockmap + atomic staging | ⚠️ no Range (issue #306 open) | ⚠️ no Range | ✅ SUErmbp | ✅ SW atomic | ✅ version_id |
| #2 Cert expiry | ⚠️ manual | N/A (JS bundle) | ⚠️ manual | ⚠️ manual | N/A | N/A |
| #3 Manifest tampering | ✅ **Ed25519 (v7)** | ⚠️ RSA only | ✅ Ed25519 | ✅ EdDSA | ⚠️ SRI only | ✅ account token |
| #4 Delta corruption | ✅ blockmap fallback to full | N/A | N/A | ✅ BinaryDelta fallback | N/A | N/A |
| #5 Staged rollout regret | ✅ `stagingPercentage` | ✅ `delayUntil` | ⚠️ custom | ✅ phased (7 groups) | ⚠️ manual | ✅ KV flag |
| #6 PWA SW cache | N/A | N/A | N/A | N/A | ✅ namespace by build ID | N/A |
| #7 iOS App Store latency | N/A | ✅ JS-only (3.3.2 OK) | ⚠️ native required | N/A | N/A | N/A |
| #8 Mac notarization | ⚠️ manual (Squirrel.Mac) | N/A | ⚠️ manual | ✅ built-in | N/A | N/A |
| #9 Android sig v2/v3/v4 | N/A | N/A (JS bundle) | ⚠️ manual | N/A | N/A | N/A |
| #10 Worker rollback + DO state | N/A | N/A | N/A | N/A | N/A | ⚠️ DO migration gotchas |
| #11 OS shutdown race | ✅ `autoInstallEvent: onNextLaunch` | N/A | ⚠️ | N/A | N/A | N/A |
| #12 Capacitor 3.3.2 | N/A | ✅ JS-only = compliant | ⚠️ | N/A | N/A | N/A |
| #13 Key custody | ⚠️ manual (YubiKey/HSM) | ⚠️ manual | ⚠️ manual | ⚠️ manual | N/A | ✅ account-level |

### Top-5 Non-Negotiables for AIRIZ

1. **Atomic staging + resume + hash-verify before swap** (#1, #4)
2. **Manifest signing with a key separate from binary signing** (#3)
3. **Server-side kill switch, not client-side** (#5)
4. **Dual-sign with timestamp, or sign with HSM-backed cert** (#2, #13)
5. **Cert pinning + HSTS for the manifest URL** (#3)

---

## Design Topic Analysis (8 Topics × 200 words)

### (a) Delta vs Full Updates

Chrome's Courgette produces ~80% smaller patches than naive bsdiff on Chromium binaries. For Electron's 50MB app updated 4x/month, full transfers cost ~200MB/user/month; deltas save ~120-160MB — real but not transformative. **Verdict: ship full updates by default for the first three releases.** Add delta (blockmap) only when bandwidth-capped markets exceed 20% of installs, or payload crosses 100MB. Always keep a "force full" flag in the manifest. electron-updater's blockmap v3 is built-in — no extra work to enable. Start with full, layer delta on once the pipeline proves stable.

### (b) Staged Rollouts

For 100K fleet: **1% (1K, 24h) → 10% (10K, 24h) → 50% (50K, 48h) → 100%.** Gate signals: crash-free sessions within 0.2% of baseline, p95 startup <10% regression, API error rate <2x baseline. Human sign-off at 50%→100%. **Kill switch: single boolean in the coordinator Worker that snaps the fleet to previous version in <5s.** electron-updater v7 reads `stagingPercentage` natively. Capacitor Live Update uses `delayUntil` for time-based gating. Minimum observability: Sentry + one synthetic heartbeat/install/day.

### (c) Crash-Throttled Rollback

**Quantitative rule:** if crash rate (crashes/sessions) over rolling 1h window exceeds 3x the prior 7-day baseline AND absolute rate >0.5%, auto-demote to "blocked." 3x multiplier kills false positives from noise; 0.5% floor kills low-traffic cohort spikes. **Decision latency: 15 minutes** from incident to rollout halted. Requires: crash telemetry in <5min, stateful evaluator (CF Worker + Durable Object), manifest server reading from evaluator. Add synthetic probe (CI launches Electron app every 30min) to catch "won't even start" failures.

### (d) Signed Manifests

**Key custody for one-person team:** YubiKey with PIV/GPG (key never touches disk) or YubiHSM2 (~$650). Avoid cloud KMS unless already paying. **Rotation:** publish new public key alongside old for ≥2 release cycles, dual-sign during transition, then drop old. **Revocation:** include signed revocation list in every manifest; clients cache and honor. If old key compromised, publish revocation block + bump manifest version. electron-updater v7's `signatures[]` array supports multi-key natively. The signing command lives on the dev's laptop, not in CI. CI verifies, never signs.

### (e) PWA Service Worker Update Traps

**The gotcha:** `skipWaiting()` + `clients.claim()` race — new SW activates mid-session, claims tabs, serves new HTML while old JS module graph is still live → white screen. **Minimum-viable Workbox config:** register without `skipWaiting`, listen for `waiting`, show toast "New version — reload", call `skipWaiting` on user click only. In `activate`, do NOT `clients.claim` on critical paths. Use `CacheFirst` for hashed assets, `NetworkFirst` for HTML. **OOB cache fix:** namespace every cache by build ID (`v-${BUILD_ID}-shell`), delete predecessors on `activate`.

### (f) Store vs Sideload for Mobile

**App Store:** median 24h review, p95 48h. **Play Store:** minutes for internal tracks, hours for production. **Direct APK:** zero review, sub-hour deploy, full rollback, but you own crash reporting. **Right call for AIRIZ:** if Motor Console is B2B fleet tooling → direct APK + Play Integrity API attestation + Apple Enterprise Signing. If consumer companion → Play Store + App Store, accept 24-48h gate. EU DMA (March 2024) opens alternative iOS marketplaces in EU — viable 2026 but fragmented review. Capacitor Live Update is 3.3.2-compliant (JS-only, no native binary change).

### (g) Signed Cloudflare Worker Deploys

"Signed" doesn't apply to a Worker like a binary — no code-signing step. Workers are JS in V8 isolates within Cloudflare's trust boundary. **Your signature = the Wrangler API token** (scoped to `Workers Scripts:Edit`). **Rollback:** every `wrangler deploy` creates immutable `version_id`. `PUT /accounts/:id/workers/scripts/:name/edge?version_id=<n>` atomically swaps. **Cross-system gating:** traffic % in Workers KV that the Worker reads per request. CI writes "10%" after green health check from coordinator, then "50%", then "100%". To gate on crash signals: coordinator writes "release X bad" to KV, Worker reads on 10s cron.

### (h) Multi-Arch Single-Bundle vs Per-Platform

**Universal macOS (x86_64 + arm64): YES** — Chrome, Slack, Discord, VS Code all ship universal2. Cost: ~30-50% larger download. Benefit: one DMG, simpler QA. **Universal Windows: NO** — arm64 Windows is niche. Ship x64 and arm64 as separate assets behind same manifest flag. **Mobile:** per-arch by necessity (Android `arm64-v8a` / `armeabi-v7a`; Play Store App Bundles handle transparently). **For AIRIZ:** universal2 macOS, separate Windows x64/arm64, let Android/iOS handle themselves.

---

## Minimum Viable Architecture Spec

### What you need to build (the coordinator)

```typescript
// release-coordinator/src/index.ts (~200 LOC)
// Cloudflare Worker + Durable Object

import { ed25519 } from '@noble/ed25519';

const MANIFEST_KEYS = {
  desktop: { provider: 'r2', base: 'https://airiz-updates.r2.dev/desktop/' },
  android: { provider: 'r2', base: 'https://airiz-updates.r2.dev/mobile/android/' },
  ios: { provider: 'r2', base: 'https://airiz-updates.r2.dev/mobile/ios/' },
  web: { provider: 'r2', base: 'https://airiz-updates.r2.dev/web/' },
  worker: { provider: 'wrangler', versionId: '...' },
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/check') {
      const surface = url.searchParams.get('surface');
      const channel = url.searchParams.get('channel') || 'stable';
      const currentVersion = url.searchParams.get('version');
      
      const release = await env.RELEASES.getRelease(surface, channel);
      if (!release) return Response.json({ updateAvailable: false });
      
      // Kill switch check
      if (release.killSwitch) return Response.json({ updateAvailable: false });
      
      // Staged rollout: hash user ID, compare to stagingPercentage
      const userId = request.headers.get('x-user-id') || 'anonymous';
      const bucket = hashBucket(userId, release.salt);
      if (bucket >= release.stagingPercentage) {
        return Response.json({ updateAvailable: false });
      }
      
      // Sign the manifest (Ed25519)
      const manifest = {
        version: release.version,
        url: `${MANIFEST_KEYS[surface].base}latest.yml`,
        stagingPercentage: release.stagingPercentage,
        signatures: [
          { keyId: release.keyId, signature: signManifest(manifest, env.PRIVATE_KEY) }
        ],
        releaseDate: release.publishedAt,
      };
      
      return Response.json({
        updateAvailable: semver.gt(release.version, currentVersion),
        manifest,
      });
    }
    // ... other routes
  }
};
```

### R2 Bucket Structure (public, via custom domain or r2.dev)

```
airiz-updates/
├── desktop/
│   ├── win-x64/
│   │   ├── latest.yml              ← signed (Ed25519)
│   │   ├── AIRIZ-Setup-1.1.0.exe
│   │   └── AIRIZ-Setup-1.1.0.exe.blockmap
│   ├── win-arm64/
│   │   ├── latest.yml
│   │   ├── AIRIZ-Setup-1.1.0-arm64.exe
│   │   └── AIRIZ-Setup-1.1.0-arm64.exe.blockmap
│   └── mac-universal/
│       ├── latest-mac.yml
│       └── AIRIZ-1.1.0-universal.zip
├── mobile/
│   ├── android/
│   │   ├── latest.json             ← signed (RSA)
│   │   └── bundle-v1.1.0.zip
│   └── ios/
│       ├── latest.json
│       └── bundle-v1.1.0.zip
├── web/
│   ├── sw.js
│   ├── manifest.json
│   └── assets/
│       ├── index-<hash>.js
│       └── index-<hash>.css
└── releases.json                   ← coordinator state (Durable Object mirror)
```

### electron-builder Config (for the desktop surface)

```yaml
# electron-builder.yml
appId: com.airiz.motor-console
productName: AIRIZ Motor Console
directories:
  output: dist
files:
  - dist/**
  - package.json
win:
  target:
    - target: nsis
      arch: [x64, arm64]
  icon: build/icon.ico
nsis:
  oneClick: true
  perMachine: false
  allowToChangeInstallationDirectory: false
mac:
  target:
    - target: zip
      arch: [universal]
  category: public.app-category.developer-tools
publish:
  provider: r2
  r2Url: https://airiz-updates.r2.dev/desktop/
  channel: latest
  updateManifest:
    publicKey: "${ELECTRON_UPDATE_PUBKEY_B64}"
  # Staged rollout:
  # stagingPercentage is set per-release in the R2 bucket
```

### @capawesome/capacitor-live-update Config

```typescript
// capacitor.config.ts
plugins: {
  CapacitorLiveUpdate: {
    url: 'https://airiz-updates.r2.dev/mobile/',
    platform: 'android', // or 'ios'
    channel: 'production',
    // RSA public key for signature verification:
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...',
  }
}
```

---

## Cross-Platform Framework Survey (Verdicts)

| Framework | Updater | Surfaces | Verdict |
|-----------|---------|----------|---------|
| **Tauri 2.x** | @tauri-apps/updater (Ed25519) | Desktop ✅, Mobile (beta) | Partial — mobile unproven, no PWA, no Worker |
| **Flutter** | None first-party | Desktop ✅, Mobile ✅, Web ✅ | Punted — community `in_app_update` only |
| **.NET MAUI** | MSIX + stores | Desktop (Win), Mobile (stores), Web (Blazor) | Punted — relies on stores |
| **Uno Platform** | None first-party | Win, iOS, Android, Web (PWA) | Punted |
| **Kotlin Multiplatform** | None | Mobile, Desktop (via Compose) | Punted |
| **React Native** | Expo Updates (was CodePush) | Mobile, Web (Hermes) | CodePush dead, Expo is Expo-only |
| **Capacitor + Capawesome** | Capacitor Live Update | Mobile ✅, Electron (provider) | Solved for Capacitor |
| **Capacitor + Capgo** | Capgo (hosted) | Mobile | Solved (hosted SaaS) |
| **Ionic** | Appflow Live Update (paid) | Mobile | Solved (paid) |
| **Apache Cordova** | hot-code-push (dead) | Mobile | Dead |
| **NW.js** | None | Desktop (Win/Mac/Linux) | Punted |
| **Neutralinojs** | Built-in `Neutralino.updater` | Desktop (Win/Mac/Linux) | Solved (desktop only) |

**Nobody has solved all 5 surfaces (Win desktop + Android + iOS + PWA + Worker) with a single updater.** This confirms: the thin coordinator approach is the right architecture.

---

## Implementation Roadmap

### Phase 1: Coordinator Worker + R2 (Weekend)
- [ ] Create R2 bucket `airiz-updates` with public access (custom domain)
- [ ] Generate Ed25519 keypair (store private key in YubiKey or 1Password)
- [ ] Build coordinator Worker (~200 LOC TS)
- [ ] Configure electron-builder `publish.provider: r2` + `updateManifest.publicKey`
- [ ] Test: build desktop, publish to R2, verify electron-updater fetches + verifies

### Phase 2: Mobile Manifest on R2 (Same Weekend)
- [ ] Configure Capacitor Live Update to read from R2
- [ ] Build CI step: `cap build` → zip → upload to R2 → sign manifest
- [ ] Test: install APK/IPA, trigger live update, verify

### Phase 3: PWA + Worker Integration (Week 2)
- [ ] Configure Workbox to use R2 for SW + assets
- [ ] Add `integrity` attributes (SRI) to critical `<script>` tags
- [ ] Configure Wrangler to publish Worker with version tracking
- [ ] Test: deploy PWA, verify SW updates, verify Worker rollback

### Phase 4: Staged Rollout + Kill Switch (Week 2-3)
- [ ] Implement `stagingPercentage` in coordinator
- [ ] Implement kill switch (single field in Durable Object)
- [ ] Connect Sentry webhook → crash evaluator → coordinator
- [ ] Test: deploy to 1%, verify only 1% gets it, flip kill switch, verify all roll back

### Phase 5: Hardening (Week 3-4)
- [ ] Add RSA signature to Capacitor Live Update manifests
- [ ] Add `delayUntil` for time-based staged rollout on mobile
- [ ] Set up cert expiry monitoring (EV cert, iOS profiles, Android keystore)
- [ ] Write runbook: "What to do when an update bricks the fleet"
- [ ] Synthetic probe: CI launches app every 30min, reports to coordinator

### Phase 6: electron-updater v7 Upgrade (When Stable)
- [ ] Wait for electron-updater 7.0.0 stable (currently 7.0.0-alpha.13 on main)
- [ ] Migrate from v6 to v7
- [ ] Enable `autoInstallEvent: "onNextLaunch"` (avoids OS shutdown race)
- [ ] Enable multi-key `signatures[]` for key rotation readiness
- [ ] Verify R2 provider works in stable

---

## Citations & Sources

### Primary (Source Code, Verified)
- `electron-userland/electron-builder` — `packages/electron-updater/src/` (HEAD 2026-11-03, 7.0.0-alpha.13)
- `capawesome-team/capacitor-plugins` — `packages/live-update/` (HEAD 2026-11-03, v8.7.1)
- `Squirrel/Squirrel.Windows` — `docs/getting-started/5-updating.md`
- `Squirrel/Squirrel.Mac` — README (Server Support section)
- `sparkle-project/Sparkle` — 2.x documentation
- `vslavik/winsparkle` — README + wiki
- `tauri-apps/plugins-workspace` — `plugins/updater/` (v2)
- `expo/expo` — `packages/expo-updates/`, `packages/expo-manifests/`

### Official Docs
- [electron.build/docs/features/auto-update](https://www.electron.build/docs/features/auto-update)
- [electron.build/docs/features/signed-update-manifests](https://www.electron.build/docs/features/signed-update-manifests)
- [electron.build/docs/features/key-rotation](https://www.electron.build/docs/features/key-rotation)
- [tauri.app/plugin/updater](https://tauri.app/plugin/updater)
- [sparkle-project.org/documentation](https://sparkle-project.org/documentation/)
- [source.android.com/security/apksigning](https://source.android.com/security/apksigning)
- [developer.apple.com/documentation/security/notarizing_macos_software](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [learn.microsoft.com/windows/msix](https://learn.microsoft.com/windows/msix/)
- [W3C Service Worker spec](https://w3c.github.io/ServiceWorker/)
- [MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Workbox Guide](https://developer.chrome.com/docs/workbox/)
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)

### Incident Postmortems
- CrowdStrike 2024-07-19: https://www.crowdstrike.com/blog/technical-details-on-todays-outage/
- SolarWinds SUNBURST 2020: https://msrc-blog.microsoft.com/2020/12/13/customer-guidance-on-recent-nation-state-cyber-attacks/
- ASUS ShadowHammer 2019: https://www.kaspersky.com/blog/shadow-hammer/26124/
- codeCov 2021: https://about.codecov.io/security-update/
- CCleaner 2017: Cisco Talos (blog.talosintelligence.com, 2017-09)
- Apple Gatekeeper notarization: https://support.apple.com/en-us/HT206359

### Open Issues (Production-Relevant)
- electron-builder #10359: NSIS app-running check can hang, interrupted update leaves app uninstalled
- electron-builder #10454: NSIS running-app check misses single process
- capacitor-plugins #306: "resumable downloads" (feature request — confirms NOT implemented)

---

## Appendix: What the Failed Agents Would Have Added

The 4 failed background agents (due to system queue timeouts) were tasked with:
1. **Best-practice security docs 2026** — ed25519 key custody, SmartScreen reputation algorithm, Android v2/v3/v4 specifics, iOS provisioning lifecycle, PWA SRI details, CF Worker signing, staged rollout playbooks, crash-throttled rollback patterns, Courgette benchmarks, App Store vs DMA
2. **Postmortems since 2022** — electron-updater/electron-builder/Squirrel/Sparkle/Capawesome/Expo/Workbox/Tauri/Microsoft.AppInstaller specific incidents + CrowdStrike/CCleaner/1Password deep dives
3. **7 OTA protocols MVP subset** — exact field-by-field schema for each + derived minimum viable subset
4. **Unified update model survey** — Tauri/Flutter/MAUI/Uno/KMP/RN/Capawesome/Voltbuilder/Appcircle/Codemagic/Ionic/Capgo/Cordova/NW.js/Neutralinojs verdicts

These gaps are partially filled by the 4 successful agents + direct knowledge synthesis in this report. The key finding (electron-updater v7 already has the signed-manifest layer) is confirmed by source-code-level analysis, not documentation claims.

---

*End of survey report. 2026-11-04.*
