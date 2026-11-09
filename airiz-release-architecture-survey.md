# AIRIZ Motor Console — Unified Release Architecture: Survey Synthesis

**Date**: 2026-11-05
**Owner**: Juwen Lie, Team Ziris PTB
**Monorepo**: `juw12/projects` at `C:\Users\juwen_lie\Documents\Default Project`
**Surfaces**: Electron Win | Capacitor Android | Capacitor iOS | PWA + Web Serial | Cloudflare Worker + Durable Objects

---

## 1. Executive Summary — The Answer

**Migrate to Capawesome Live Update as the primary update mechanism for all three native surfaces (Electron Win + Android + iOS). Keep electron-updater as a fallback for full binary updates. PWA and Worker use their native mechanisms. Do NOT migrate to Tauri.**

The single most important finding from this survey: **Capawesome Live Update v8.x now supports Electron** (via `@capawesome/capacitor-electron`). This makes it the **only tool in the 2026 ecosystem** that covers Electron desktop + Android + iOS under one plugin API, one signing key, and one backend. No other framework — not Tauri, not Flutter, not MAUI, not Uno — unifies these three surfaces.

**Why NOT Tauri**: The Tauri 2.x updater plugin is **desktop-only**. The official cargo install command is `cargo add tauri-plugin-updater --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'` — it explicitly excludes Android and iOS. The setup code uses `#[cfg(desktop)]` to guard plugin initialization. Tauri mobile apps must go through App Store / Google Play for updates. Migrating to Tauri would solve the Windows desktop update problem but leave Android and iOS with no OTA mechanism — the same fragmented state you're in now, minus the working electron-updater.

**Why NOT full custom R2-signed-manifest**: A one-person team cannot afford to build, sign, verify, rollback, and debug a custom update protocol across 5 surfaces while also building the product. The engineering cost exceeds the benefit for 2+ years. Use the tools that exist.

**The recommended architecture is a two-tier system**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AIRIZ MOTOR CONSOLE UPDATE ARCHITECTURE           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TIER 1 — Bundle Updates (frequent, no app restart)                 │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  @capawesome/capacitor-live-update v8.x                     │    │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐               │    │
│  │  │ Electron  │  │  Android  │  │   iOS     │               │    │
│  │  │  (Win)    │  │  (Capac.) │  │ (Capac.)  │               │    │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘               │    │
│  │        └───────────────┼──────────────┘                      │    │
│  │                        ▼                                     │    │
│  │              Capawesome Cloud API                             │    │
│  │              https://api.cloud.capawesome.io                  │    │
│  │              (or self-hosted: R2 bucket + Worker)             │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  TIER 2 — Binary Updates (rare, full reinstall)                    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  electron-updater v6.8+ (Electron Win only)                 │    │
│  │  latest.yml + Ed25519 manifest signature (v27+)             │    │
│  │  GitHub Releases or S3/GCS provider                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  TIER 3 — Web + Worker (standard mechanisms)                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  PWA: Service Worker lifecycle + Workbox precache           │    │
│  │       skipWaiting: false, manual reload prompt              │    │
│  │  Worker: wrangler deploy + version rollback                 │    │
│  │       Durable Objects for stateful canary                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Full Update Engine Survey (All 15+ Engines)

### 2.1 Desktop Update Engines

| Engine | Platform | Status (2026) | Signing | Manifest | Channels | Rollback |
|--------|----------|---------------|---------|----------|----------|----------|
| **electron-updater v6.8** | Win/Mac/Linux | Active (in electron-builder monorepo) | Ed25519 (v27+), Authenticode (Win), CodeSign (Mac) | `latest.yml` (SHA-512, v27: `signatures[]` + `keyId`) | `latest.yml`, `beta.yml`, `latest-mac.yml` etc. | None (manual) |
| **electron-builder** | Win/Mac/Linux | Active | Same as electron-updater | Same | Same | None |
| **Squirrel.Windows** | Windows | **Unmaintained** (README: "Contributors Needed", last release 2.0.1 2020-09) | Authenticode (via nuspec) | `RELEASES` file (SHA-1, filename, size) | Separate feed per channel | None |
| **Squirrel.Mac** | macOS | **Unmaintained** | CodeSign | None | None | None |
| **Sparkle 2.10** | macOS | **Active** (2.x branch, release 2026-10-25) | Ed25519 (`ed25519_sign`, 32B key, 64B sig, base64) | Appcast XML (`sparkle:version`, `sparkle:edSignature`, `sparkle:channel`, `sparkle:phasedRolloutInterval`) | `sparkle:channel` (beta/stable) | `resetUpdateState` |
| **@tauri-apps/updater** | Win/Mac/Linux **only** | Active (Tauri 2.x) | minisign Ed25519 (`pubkey` in `tauri.conf.json`, base64) | JSON: `{version, notes, pub_date, platforms: {<target>: {url, signature}}}` or dynamic | `{{target}}`, `{{current_version}}`, `{{arch}}`, `{{bundle_type}}` | `allowDowngrades: true` config |
| **Microsoft AppInstaller** | Windows (MSIX) | Active (Windows 10/11) | Authenticode (MSIX signing) | `AppInstaller.xml` | None | MSIX versioning |
| **.NET MAUI** | Win/Mac/iOS/Android/Tizen | Active (8.0-11.0) | Per-platform | No unified manifest | None | None |
| **Uno Platform 5.2** | Win/Mac/iOS/Android/WASM/Linux | Active | Per-platform | None | None | None |

### 2.2 Mobile Update Engines

| Engine | Platform | Status (2026) | Signing | Channels | Rollback |
|--------|----------|---------------|---------|----------|----------|
| **@capawesome/capacitor-live-update v8.7** | **Android + iOS + Electron** | **Active** (Capacitor 6/7/8, MIT, 1000+ projects, 20M+ devices) | RSA-2048 (PEM) + SHA-256 | `defaultChannel`, `setChannel()`, `fetchChannels()` | `reset()`, `autoBlockRolledBackBundles`, `readyTimeout` |
| **@capacitor/live-update** (official) | Android + iOS | **Deprecated** | Same | Same | Same |
| **CodePush / App Center** | iOS + Android + Windows UWP | **DEAD** (archived May 20, 2025) | N/A | N/A | N/A |
| **Expo Updates / EAS Update** | Android + iOS + tvOS (RN only) | Active (SDK v58, RN 0.88) | Code signing cert | EAS rollout | EAS rollback |
| **Bitrise CodePush** | Android + iOS (RN + Expo) | Active (2026, App Center successor) | Code signing | Staged rollouts | One-click rollback |
| **Appcircle CodePush** | iOS + Android (RN only) | Active | Code signing | Staged rollouts | Rollback |
| **Codemagic Patch** | Android + iOS (RN only) | Active (self-hosted) | Code signing | Rollout/monitoring | Promotion/rollback |
| **Flutter `in_app_update` v5.0** | **Android only** | Active (July 2026) | N/A | N/A | N/A |
| **Kotlin Multiplatform / Compose** | Multi-platform | Active | No first-party updater | None | None |

### 2.3 Web + Worker Update Engines

| Engine | Platform | Status | Mechanism |
|--------|----------|--------|-----------|
| **PWA Service Worker** | All browsers | W3C spec (active) | `installing → installed → activating → active → redundant` |
| **Workbox** | All browsers | Active (v7+) | Precache manifest, runtime caching, `cleanupOutdatedCaches()` |
| **SRI (W3C)** | All browsers | **SRI 2 Working Draft** (2026-03-20) | `integrity` attribute, new `Integrity-Policy` header |
| **Signed Exchange (SXG)** | Chrome | Active (Google) | Signed HTTP responses for offline PWA |
| **Cloudflare Workers** | Edge | Active | `wrangler deploy` (versioned), R2 signed URLs, Workers Secrets |
| **Cloudflare Durable Objects** | Edge | Active | Stateful canary routing, per-install_id shard ownership |

### 2.4 Build/Distribution Services

| Service | Type | Update Feature | Status |
|---------|------|----------------|--------|
| **Capawesome Cloud** | Hosted OTA | Capawesome Live Update backend | Active (self-hosted option via R2) |
| **Voltbuilder** | Hosted build | None (build + sign only) | Active ($15/mo) |
| **Appcircle** | Mobile CI/CD | CodePush module (RN only) | Active |
| **Codemagic** | Mobile CI/CD | CodePush + Patch (RN only) | Active |
| **Bitrise** | Mobile DevOps | CodePush (RN + Expo, App Center successor) | Active (100k MAU free) |
| **EAS Build / EAS Update** | Mobile CI/CD + OTA | Expo Updates protocol | Active (SDK v58) |
| **Cordova / PhoneGap** | Framework | None | Maintenance mode |
| **Ionic** | Framework + Appflow | Appflow Live Updates (declining) | Acquired by OutSystems |

---

## 3. Decision Matrix

### 3.1 Option A: Keep electron-updater + Bolt Capawesome on Mobile

- **Surfaces covered by 1 tool**: 1 of 5 (Windows only)
- **Signing systems**: 2 (Ed25519 + RSA)
- **Manifest formats**: 2
- **Backend**: 2
- **Engineering cost**: Low
- **Risk**: Low
- **One-person team feasibility**: **High**
- **Verdict**: Viable but fragmented

### 3.2 Option B: Migrate to Tauri

- **Surfaces covered by 1 tool**: **1 of 5** (desktop ONLY)
- **Mobile OTA**: **NONE** — `#[cfg(desktop)]`, cargo target excludes Android/iOS
- **Engineering cost**: **EXTREME** (6-12 month rewrite)
- **Risk**: **Very high**
- **One-person team feasibility**: **LOW**
- **Verdict**: **REJECTED**

### 3.3 Option C: Build Custom R2-Signed-Manifest

- **Surfaces covered by 1 tool**: 5 of 5
- **Engineering cost**: **VERY HIGH** (3-6 months infrastructure)
- **Risk**: **HIGH** (one-person team owns entire update pipeline)
- **One-person team feasibility**: **LOW**
- **Verdict**: Theoretically elegant, practically infeasible

### 3.4 Option D (RECOMMENDED): Capawesome for 3 Native + Native for Web/Worker

- **Surfaces covered by 1 tool**: **3 of 5** (Electron Win + Android + iOS)
- **Remaining**: PWA (SW lifecycle) + Worker (wrangler)
- **Signing**: RSA-2048 (Capawesome) + Ed25519 (electron-updater fallback)
- **Engineering cost**: **MODERATE**
- **Risk**: **LOW** (battle-tested: 1000+ projects, 20M+ devices)
- **One-person team feasibility**: **HIGH**
- **Verdict**: **RECOMMENDED**

---

## 4. Recommended Architecture in Detail

### 4.1 Two-Tier Update Strategy

**Tier 1 — Bundle Updates (Capawesome Live Update)**: Frequent (daily/weekly). Updates JS/HTML/CSS bundle inside WebView. No app restart needed.

**Tier 2 — Binary Updates (electron-updater, Windows only)**: Rare (monthly/quarterly). Updates full Electron binary.

**Tier 3 — Web + Worker**: Standard mechanisms (SW lifecycle, wrangler deploy).

### 4.2 Signing Key Architecture

| Surface | Algorithm | Key Storage | Rotation |
|---------|-----------|-------------|----------|
| Capawesome (3 native) | RSA-2048 | Capawesome Cloud / Workers Secrets | 30-day overlap |
| electron-updater (Win binary) | Ed25519 (v27+) + Authenticode | GitHub Actions secret | `signatures[]` + `keyId` |
| PWA assets | SHA-256 (SRI) | Build-time | Per-deploy |
| Worker | N/A | Cloudflare API token | Token rotation |

### 4.3 Staged Rollout Policy

```
Ramp:  1% → 10% → 50% → 100%
Holds: 4h   2h    1h
Gate:  crash-free > 99.5% over 1h
Auto-pause: crash-free < 98%
Kill switch: Durable Object `force_version` (60s rollback)
Never auto-promote: manual promote after dashboard review
```

### 4.4 Capawesome Configuration

```typescript
plugins: {
  LiveUpdate: {
    appId: 'airiz-motor-<unique-id>',
    autoBlockRolledBackBundles: true,
    autoDeleteBundles: true,
    autoUpdateStrategy: 'background',
    defaultChannel: 'production',
    httpTimeout: 60000,
    readyTimeout: 5000,
  },
}
```

### 4.5 Self-Hosted Option (R2 + Worker)

```
R2 Bucket: airiz-motor-updates
├── bundles/
│   ├── production/
│   │   ├── 1.12.0/
│   │   │   ├── bundle.zip
│   │   │   ├── manifest.json
│   │   │   ├── checksum
│   │   │   └── signature
│   └── beta/
└── latest.yml  (electron-updater fallback)
```

### 4.6 Minimum Viable Unified Manifest Schema (Future Target)

```json
{
  "version": "1.12.0",
  "channel": "production",
  "releaseDate": "2026-11-05T00:00:00Z",
  "signing": { "algorithm": "ed25519", "keyId": "airiz-2026-01", "signature": "..." },
  "platforms": {
    "windows-x64": { "type": "electron", "url": "...", "sha512": "...", "size": 0, "signature": "..." },
    "android-arm64-v8a": { "type": "capacitor-bundle", "url": "...", "sha256": "...", "size": 0, "signature": "..." },
    "ios-arm64": { "type": "capacitor-bundle", "url": "...", "sha256": "...", "size": 0, "signature": "..." },
    "web": { "type": "pwa", "serviceWorkerUrl": "...", "precacheRevision": "..." },
    "worker": { "type": "cloudflare-worker", "version": "...", "rollbackVersion": "..." }
  },
  "telemetryGates": { "crashFreeRateMin": 0.995, "rolloutPercentage": 50, "autoPauseThreshold": 0.98 }
}
```

### 4.7 Release Workflow

```
1. Build (parallel): Electron + Android + iOS + PWA + Worker
2. Sign (parallel): Authenticode + apksigner + codesign + Capawesome
3. Publish (parallel): Capawesome + GitHub Releases + Pages + wrangler
4. Stage & Promote: 1% → 10% → 50% → 100% (Sentry gates)
5. Post-deploy: Smoke test (version, Web Serial, WebSocket)
```

---

## 5. Key 2026 Security Findings

1. **EV certs no longer bypass SmartScreen** (changed 2024). Use Azure Artifact Signing (FIPS 140-3 L3 HSMs, ~$9.99/mo).
2. **W3C SRI 2** (Working Draft, 2026-03-20): New `Integrity-Policy` header. All third-party scripts need `integrity` attributes.
3. **Android v3 key rotation**: Proof-of-rotation struct (ID 0xf05368c0). Sign v2+v3+v4. `minSdkVersion >= 24`.
4. **Post-quantum**: FIPS 204 (ML-DSA/Dilithium) published 2024. Ed25519 remains current standard. PQ migration on 3-year roadmap.

---

## 6. Risk Register

| # | Failure Mode | Mitigation |
|---|-------------|-----------|
| 1 | Partial-download corruption | SHA-256 + RSA verify before activation; blockmap differential + full fallback |
| 2 | Cert expiry | Azure Artifact Signing (managed HSMs); 90-day expiry alarms |
| 3 | Manifest tampering | RSA + Ed25519 client-side verification; Sigstore/SBOM (future) |
| 4 | Delta corruption cascade | `readyTimeout` auto-rollback; full re-download fallback |
| 5 | Staged-rollout regret | 1%→10%→50%→100% with holds; auto-pause at <98%; Durable Object kill switch |
| 6 | PWA SW caching old shell | `no-cache` on manifest; `skipWaiting: false`; manual reload prompt |
| 7 | iOS review latency | App Store for prod; TestFlight for beta; never Enterprise certs for consumer |
| 8 | Mac notarization | N/A (Windows-only for now); Sparkle 2.10 if Mac added later |
| 9 | Android signature mismatch | v2+v3+v4 in same Gradle task; `apksigner verify` CI gate |
| 10 | Channel-file rollback (CrowdStrike) | Signed + version-pinned; Durable Object `force_version`; 60s rollback |

---

## 7. Implementation Phases

| Phase | Timeline | Scope |
|-------|----------|-------|
| 1. Capawesome setup | Week 1-2 | Add plugin to 3 apps, publish first bundle, verify rollback |
| 2. Rollout + telemetry | Week 3-4 | Sentry, staged rollouts, Durable Object kill switch |
| 3. electron-updater v27 | Week 5-6 | Ed25519 signing, update `sync_release_feed.py` |
| 4. PWA SW lifecycle | Week 7-8 | Workbox, `no-cache`, reload prompt, BroadcastChannel |
| 5. CI/CD unification | Week 9-10 | Single `airiz-release.yml`, parallel build/sign/publish |
| 6. iOS App Store | When ready | Apple Dev account, notarization, TestFlight |

---

## 8. What Changes vs. Current State

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Windows desktop | electron-updater only | electron-updater v27+ + Capawesome bundle updates |
| Android | No OTA | Capawesome Live Update |
| iOS | No OTA | Capawesome Live Update |
| PWA | No update lifecycle | SW lifecycle + Workbox |
| Worker | No versioning | wrangler versions + Durable Object kill switch |
| Signing keys | 3 independent pipelines | 2 pipelines (Capawesome RSA + electron-updater Ed25519) |
| Staged rollout | None | Capawesome + Sentry gate + Durable Object |
| Rollback | None | Capawesome `reset()` + `readyTimeout` + kill switch |

---

## 9. Open Questions

1. **Capawesome Cloud vs. self-hosted**: Start with Cloud, migrate to R2 when time permits.
2. **electron-updater v27 upgrade**: Update `sync_release_feed.py` to sign with Ed25519.
3. **iOS timing**: When to go to App Store?
4. **macOS desktop**: Not in scope. Sparkle 2.10 if added later.
5. **Delta updates**: Skip for now. Full updates simpler for one-person team.

---

## 10. Sources & Verification Status

### Verified in this session (live fetches):
- electron-updater source (v27 Ed25519, `signatures[]`, `stagingPercentage`)
- Capawesome Live Update source (v8.7.1, RSA-2048, Electron support)
- Tauri updater source (minisign ed25519, `#[cfg(desktop)]`, desktop-only)
- Squirrel.Windows source (RELEASES regex, no "OR" delta syntax)
- Sparkle source (Ed25519, signed feed trailing XML comment)
- W3C SRI 2 Working Draft (2026-03-20)
- Microsoft code-signing-options (EV no longer bypasses SmartScreen, 2024)
- Android APK Signature Scheme v3 (key rotation)
- CodePush GitHub (archived May 20, 2025)
- Capawesome plugin docs (Electron support, 20M+ devices)

### From training knowledge (not re-verified):
- CrowdStrike 2024-07-19 (8.5M machines)
- SolarWinds Sunburst 2020 (18,000 customers)
- ASUS ShadowHammer 2019 (~1M users)
- CCleaner Floxif 2017 (2.27M infected)
- Facebook Research / Onavo 2019 (enterprise cert revocation)
- Apple WWDR Feb 2015 (cert expiry)

---

*End of survey synthesis. All 8 agents completed.*
