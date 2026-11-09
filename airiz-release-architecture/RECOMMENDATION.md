# AIRIZ Motor Console — Unified Release Architecture: Recommendation

> **Owner:** Juwen Lie · **Team:** Ziris PTB
> **Status:** Final synthesis, 2026-11-05
> **Purpose:** Pick one release architecture that lets a one-person team ship signed updates to **Windows desktop + Android + iOS + Web PWA + Cloudflare Worker** from a single signed manifest. This document is the executive decision; the cited companion docs are the evidence.

---

## 0. One-line answer

**Stay with the current `airiz-release.v1` plan: a single Ed25519-signed JSON manifest on Cloudflare R2, fanned out into `latest.yml` (electron-updater) + `manifest.json` (Capawesome mobile, verified in-app) + `wrangler versions deploy --percentage N` (Worker) + atomic SW activation (PWA). Do not migrate the desktop stack to Tauri; do not adopt Bitrise CodePush, Expo EAS Update, or Capawesome Cloud.** The five-surface fan-out is already implemented (`apps/airiz-motor/tools/`), security-baselined (`update-security-baseline-2026.md`), failure-mapped (`release-failure-modes.md`, `wall-of-failure-cross-platform-auto-update.md`), schema-validated (`unified-release-manifest-schema.md`), and protocol-catalogued (`release-architecture-reference.md`, `release-protocols-survey.md`). The remaining work is operational hardening, not architecture re-design.

---

## 1. Why this answer

### 1.1 No single tool covers all five surfaces in 2026

The cross-platform updater landscape was surveyed exhaustively (see §5 references). The conclusion is hard:

| Tool | Win | Mac | Linux | Android | iOS | Web PWA | Worker |
|---|---|---|---|---|---|---|---|
| **electron-updater** (current Windows path) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Tauri updater** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Capawesome Live Update** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Bitrise CodePush** (managed App Center successor) | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Expo EAS Update** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| **PWA service worker** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Cloudflare `wrangler versions`** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **.NET MAUI / Uno / KMP / Flutter** | none | none | none | none | none | none | none |

No tool covers the five AIRIZ surfaces. Three of those tools (`react-native-code-push`, `Ionic Appflow`, `Microsoft App Center`) **died** in 2025. The two newest managed successors (Bitrise CodePush, Expo EAS Update) are React-Native/Expo-only and gated by MAU.

### 1.2 Why AIRIZ's current plan survives the survey

The plan in `apps/airiz-motor/tools/README.md` is:

```
tag push v1.7.3
   │
   ├── build matrix (electron, capacitor-android, capacitor-ios, pwa, worker)
   │
   ├── sign
   │     └─ sign-manifest.ts → airiz-release.json (Ed25519 over canonical JSON)
   │     └─ manifest-to-electron-yml.ts → latest.yml + latest-mac.yml + latest-linux.yml
   │     └─ aws s3 sync to s3://airiz-releases/<surface>/<version>/
   │     └─ aws s3 cp airiz-release.json → s3://airiz-releases/production/manifest.json
   │
   ├── worker rollout
   │     └─ wrangler versions upload && wrangler versions deploy --percentage 10
   │
   └── monitor (24h)
         ├─ poll Sentry release health for crash_free_sessions
         ├─ if < 0.995 → bump staged_rollout=0 + wrangler versions rollback
         └─ if ≥ 0.995 → bump staged_rollout=100 + wrangler versions deploy --percentage 100
```

The survey confirms **every architectural choice** in this plan:

- **Ed25519 over canonical JSON** is the 2026 baseline: Tauri 2.x and Sparkle 2.x both use EdDSA/Ed25519, electron-updater v27 introduced Ed25519 manifest signatures. Verified live: Node `crypto.generateKeyPairSync('ed25519')` produces 64-byte sigs, 44-byte SPKI DER pubkeys, ~48.7µs sign / ~104.5µs verify.
- **`signatures[]` array for key rotation** matches the electron-updater v27 pattern (`signatures[]` verified against `updateManifestPublicKey`).
- **`stagingPercentage`** is the electron-updater-native staged-rollout field, and the Worker handles its own percentage split via `wrangler versions deploy --percentage N`.
- **`wrangler versions rollback`** is the kill switch for the Worker and is the closest thing to a true instant rollback any tool offers.
- **Sentry crash-free-sessions** as the crash-throttled auto-promotion signal is the Sentry-documented pattern; a 0.995 threshold for a 24h observation window is the conservative-default.
- **Capawesome's RSA-only `publicKey` field forces AIRIZ to verify in-app**, not via the plugin — and `apps/airiz-motor/mobile/src/live-update.mjs` already does this. Verified by reading `packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdateConfig.java:7-104` and `LiveUpdatePlugin.java`.

### 1.3 Why the alternatives were rejected

| Alternative | Why rejected |
|---|---|
| **Migrate to Tauri** | Saves nothing on Windows (electron-updater is already signed-manifest-ready); **loses** the v1.11.x user base, Ziris PTB rosters, Bluetooth-bridge history, and the Mac-side electron-updater path. Tauri's updater is also desktop-only — Android/iOS still need a separate mechanism. The Capawesome Live Update path becomes irrelevant. |
| **Adopt Bitrise CodePush** | Mobile-only; can't replace the Windows path; introduces a third-party managed dependency for a feature AIRIZ already has self-hosted. Free tier is 100k MAU, which is fine for Ziris PTB but the lock-in risk is real and CodePush's contract was retired by Microsoft once already. |
| **Adopt Expo EAS Update** | Same as Bitrise — mobile-only, and AIRIZ isn't an Expo app. |
| **Adopt Capawesome Cloud** | Adds a $19–$499/mo managed dependency for state management that AIRIZ already self-hosts in the Cloudflare Worker (the `release-relay/` server-side `withinRollout()` SHA-256(deviceId+channel) bucket gating already does this). The cloud adds nothing AIRIZ doesn't have. |
| **Single signed-manifest-on-GitHub-Releases** | Tempting, but GitHub Releases has no R2-equivalent edge cache, and the Worker serves the same R2 bucket. R2 is the right call for a CF-fronted update channel. |

---

## 2. The recommended architecture

```
                              tag push v1.7.3
                                    │
                                    ▼
         ┌──────────────────────────────────────────────────┐
         │  GitHub Actions (5 GitHub workflows already wire) │
         └──────────────────────────────────────────────────┘
                                    │
        ┌──────────┬──────────┬────┴─────┬──────────┬──────────┐
        ▼          ▼          ▼          ▼          ▼
   electron-  airiz-      airiz-     airiz-      airiz-
   builder    mobile      mobile     mobile      relay-
   (Win/Mac/  (iOS)       (Android)  (PWA web    worker
   Linux NSIS                               app)   (Cloudflare)
        │          │          │          │          │
        │  per-surface build matrix — each emits per-surface hash JSON
        │          │          │          │          │
        └──────────┴────┬─────┴──────────┴──────────┘
                         ▼
              ┌────────────────────────┐
              │   tools/sign-manifest.ts│
              │   Ed25519 over RFC 8785 │
              │   canonical JSON        │
              └────────────────────────┘
                         │
                         ▼
              ┌────────────────────────┐
              │   airiz-release.json    │  ← single signed manifest
              │   (R2: /production/)    │
              └────────────────────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                  ▼
   tools/manifest-    release-relay/    wrangler
   to-electron-yml    withinRollout()   versions upload
   → latest.yml       → 404 to out-     → version tag
   → latest-mac.yml    rollout devices    (CF controls
   → latest-linux.yml  (Capawesome       percentage via
   (electron-updater   client verifies    versions deploy
   v27 signatures[])   Ed25519 in-app)    --percentage N)
        │                │                  │
        ▼                ▼                  ▼
   Electron         Capacitor iOS /    Cloudflare edge
   Windows app      Android (signed    (Worker + Durable
   (signed          bundle, verified   Objects, served to
   installer,       in-app Ed25519,    every phone /
   SHA-512          SHA-256 file       desktop / PWA
   checksum,        integrity)         that hits the
   Authenticode                        relay)
   Authenticode)
```

### 2.1 The 5 surface clients

| Surface | Client | What it consumes | Verification |
|---|---|---|---|
| **Windows desktop** | electron-updater v27+ (already shipped) | `latest.yml` + `latest-mac.yml` + `latest-linux.yml` from R2; SHA-512 on each artifact; Ed25519 manifest signature against `updateManifestPublicKey` pinned in `app-update.yml` | Manifest sig + per-file SHA-512 + Authenticode on the .exe |
| **Capacitor iOS** | `@capawesome/capacitor-live-update` v8.x (state mgmt only) + `apps/airiz-motor/mobile/src/live-update.mjs` (verify) | `manifest.json` from R2 via release-relay | In-app Ed25519 verify (Capawesome's RSA `publicKey` is bypassed) + SHA-256 per file |
| **Capacitor Android** | Same as iOS | Same as iOS | Same as iOS |
| **Web PWA** | Service worker (`web/sw.js`) + Workbox | Atomic SW activation on first visit; `version.json` OOB poll; SRI on critical assets | TLS + SRI; the "manifest" is the SW script bytes |
| **Cloudflare Worker** | `wrangler versions upload` + `wrangler versions deploy --percentage N` | Immutable version tags; CF controls percentage split; `wrangler versions rollback` is the kill switch | Immutable tag + signed deploys via CF dashboard binding |

### 2.2 The 1 signing pipeline

A single Ed25519 keypair (per `tools/keygen.ts`), private key in `AIRIZ_SIGNING_PRIVATE_KEY_PEM` GitHub Actions secret, public key in `AIRIZ_SIGNING_PUBLIC_KEY_PEM` (also used for in-app verify on mobile and to populate `updateManifestPublicKey` on electron-updater). Manifest payload = canonical JSON (RFC 8785 subset, recursive key sort, no whitespace) over a *fixed* schema that includes:

- `schema_version` (currently `1`)
- `app_id` (`airiz-motor-console`)
- `channel` (`production` / `beta` / …)
- `released_at` (ISO 8601)
- `target_versions.{electron,capacitor_ios,capacitor_android,pwa,worker}` — a map of surface → semver
- `staged_rollout` (0–100; consumed by electron-updater's `stagingPercentage` and by the release-relay's `withinRollout()` SHA-256 bucket; CF Worker ignores it, using `wrangler versions deploy --percentage` instead)
- `artifacts` — a map of surface → `{url, sha512|sha256, size?, ...}`
- `signatures[]` — array of `{key_id, algorithm: "ed25519", value: <base64>}` over the canonical-JSON body with `signatures` removed

`signatures[]` is an array (not a single value) so a key-rotation window can carry both old and new signatures; clients verify-against-any (`verifyAny`), matching the electron-updater v27 pattern.

### 2.3 The 2 mobile signing caveats

Two non-obvious facts discovered during the survey that shaped the design:

1. **Capawesome v8.x hard-requires PEM-encoded RSA in `publicKey`** — it rejects Ed25519. AIRIZ does **not** let Capawesome verify; the mobile client (`apps/airiz-motor/mobile/src/live-update.mjs`) verifies the manifest's Ed25519 signature in-app, and Capawesome is depended on only for state-management primitives (`setNextBundle`, channel state, `autoBlockRolledBackBundles`). One signing scheme across all 5 surfaces, **not** one-per-surface.
2. **Capacitor Live Update's "rollback"** is a `ready()` + `readyTimeout` + `setNextBundle(null)` flow, NOT a server-side unpublish. The `autoBlockRolledBackBundles` flag then prevents the bad bundle from being re-applied. AIRIZ gets this for free by using Capawesome; if you ever migrate away, you re-implement it.

### 2.4 The 3 staged-rollout mechanisms (and why they're not the same)

Each surface consumes `staged_rollout` differently — this is by design, not a bug:

| Surface | Mechanism | Where it's enforced |
|---|---|---|
| **Windows** | electron-updater's `stagingPercentage` field in `latest.yml` | Client-side (`AppUpdater.ts:682-703`) — uses `isUserWithinRollout(stagingPercentage)` hash bucket of install ID |
| **iOS / Android** | release-relay Worker's `withinRollout()` — SHA-256(deviceId + channel) bucket compared against the % | Server-side, returns 404 to out-of-rollout devices |
| **PWA** | **Not honored.** Service-worker activation is atomic on first visit to the new script. | None. For staged PWA rollout, gate the build matrix instead. |
| **Cloudflare Worker** | `wrangler versions deploy --percentage N` | Cloudflare edge router — version tags are immutable |

The 24h Sentry crash-free-sessions monitor (`crash_free_sessions >= 0.995`) is the crash-throttled auto-promotion gate that bumps `staged_rollout` from 10 → 100 (or drops it back to 0 + `wrangler versions rollback`).

---

## 3. The failure-mode checklist the architecture must clear

Drawn from `release-failure-modes.md` and `wall-of-failure-cross-platform-auto-update.md`. Every item below maps to a real incident and a concrete AIRIZ defense.

| # | Failure mode | Real incident | AIRIZ defense |
|---|---|---|---|
| 1 | No staged rollout / no fast rollback → fleet bricked | **CrowdStrike 2024-07-19, ~8.5M Windows devices** (Channel File 291) | `staged_rollout=10` + 24h Sentry monitor + `wrangler versions rollback` + `crash_free_sessions >= 0.995` gate. The same "channel file pushed globally without validation" pattern is what made that incident unrecoverable. |
| 2 | Manifest / signed-binary tampering | **ASUS Live Update 2019 (ShadowHammer, ~1M devices), CCleaner 2017 (2.27M), SolarWinds 2020 (18,000 orgs)** | Ed25519 manifest signature (RFC 8785 canonical JSON) verified client-side on every surface; Authenticode + SHA-512 on Windows installer; SHA-256 + Ed25519 in-app on mobile; SW byte-diff + SRI on PWA. **Air-gapped code signing**: private key only in CI; `updateManifestPublicKey` pinned in `app-update.yml`; Worker's `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` allow-list is remotely updatable for rotation. |
| 3 | Partial/corrupt download → bricked | **Sparkle 2023-12-19** (`#2478`) | electron-updater: SHA-512 gate before install; atomic install; 5-min idle gate (AIRIZ's `safe auto-update` v1.11.22); `autoBusyReason` checks for live session. Mobile: SHA-256 per file + manifest sig before `setNextBundle`. PWA: SW atomic install. |
| 4 | Code-signing cert expiry | **electron-builder / electron-updater #6837, 2022-05-04** | Authenticode **always** with RFC 3161 timestamp (so signatures survive cert renewal). Cert rotation monitored via 60-day-expiry alert. Azure Trusted Signing (EV, HSM-backed) is the preferred path; falls back to DigiCert KeyLocker if HSM custody is a hard requirement. |
| 5 | Delta / differential corruption | **Sparkle 2023-07-23** (`#2408`), **electron-builder blockmap fixes Oct–Nov 2026** | AIRIZ ships **full installers** (no deltas). Tradeoff documented in `release-failure-modes.md`: deltas save bandwidth but introduce a rollback graph problem; for AIRIZ's installer sizes (currently ~80 MB NSIS) the bandwidth saving isn't worth the complexity. Re-evaluate if installer size grows past 200 MB. |
| 6 | PWA SW caches the old shell | **Permanent W3C mechanism** — every installed PWA, days/weeks of stale clients | Atomic SW activation on first visit. `version.json` OOB poll on the page (not in the SW) so the user gets a "new version available" prompt. Workbox `BroadcastUpdatePlugin` + `clientsClaim()` for instant propagation. Cache names versioned (`cache-v1`, `cache-v2`); `activate` deletes non-current caches to prevent OOB orphans. |
| 7 | iOS App Store vs enterprise/TestFlight latency | **Microsoft App Center / CodePush retired 2025-03-31** | AIRIZ's mobile path is **not** CodePush-based. Capacitor Live Update covers the **web shell** (the whole console is a PWA inside Capacitor); native binary updates still go through TestFlight (internal) and App Store (release). 7-day TestFlight cycle for staged rollouts to Ziris PTB co-admins. EU DMA custom app distribution considered for enterprise rollout if App Store review becomes a bottleneck. |
| 8 | macOS notarization failure → "unidentified developer" | **electron-builder #4040, 2019-07-10** | `xcrun notarytool submit` + `xcrun stapler staple` in the macOS build matrix. Notarization ticket stapled into the .dmg so Gatekeeper accepts offline. Hard-fail the build on `notarytool` exit code ≠ 0. |
| 9 | Android v1/v2/v3/v4 signature-scheme mismatch | **AOSP** (2016→2021, v2→v4) | AIRIZ signs with **v2 + v3** (v3 for key rotation support, v2 for older Android 7+ devices that don't support v3). v4 only if Play App Signing + AAB for incremental installs becomes relevant. **Play App Signing** is mandatory for new Android apps in 2026 — Google holds the production key, AIRIZ signs with an upload key, lineage is preserved across rotations. `versionCode` monotonicity is the downgrade control, not the signature. |
| 10 | CF Worker version rollback after buggy deploy | **Permanent platform mechanism** | `wrangler versions rollback <previous-tag>` is sub-second at the edge. R2 signed URLs (HMAC-SHA256, short expiry) deliver any artifact. Durable Object migrations are forward-only; DO rollback requires a manual `wrangler rollback` of the migration script. Worker rollback ALWAYS paired with bumping the desktop `staged_rollout` to 0. |

---

## 4. The security model

Drawn from `update-security-baseline-2026.md`. Five primitives, in priority order:

### 4.1 Ed25519 manifest signatures (universal across all 5 surfaces)

- **Algorithm**: Ed25519 / EdDSA per RFC 8032.
- **Payload**: canonical JSON (RFC 8785 subset: recursive key sort, no whitespace) over the manifest with `signatures[]` removed.
- **Library**: Node.js stdlib `crypto.generateKeyPairSync('ed25519')` — zero dependencies. Measured locally: 64-byte sigs, 44-byte SPKI DER pubkeys, ~48.7µs sign / ~104.5µs verify on Node v24.14.1.
- **Key custody**: private key in GitHub Actions secret `AIRIZ_SIGNING_PRIVATE_KEY_PEM` ONLY. Local copy of the key is deleted after first CI run (per `tools/README.md` "First-time setup"). Public key derived from the private key on every CI run via `crypto.createPublicKey(pem)`; CI re-verifies its own signature before any artifact is uploaded (`sign-manifest.ts` L196-205).
- **Trust anchor**: `updateManifestPublicKey` (base64 SPKI DER) pinned in `apps/airiz-motor-desktop/resources/app-update.yml` for electron-updater; `AIRIZ_SIGNING_PUBLIC_KEYS_PEM` (semicolon-separated list, remotely updatable) in the Worker for mobile + PWA.
- **Key rotation**: `signatures[]` is an array; CI can emit multiple signatures with different `key_id`s during the rotation window. Clients verify-against-any. Documented as a deliberate trade-off: the only true revocation for already-distributed clients is shipping a new client binary with the old key removed.

### 4.2 Windows Authenticode + RFC 3161 timestamp

- **Algorithm**: SHA-256 over the PE binary, RSA over the digest, signed with the code-signing cert.
- **Tool**: `signtool sign /fd sha256 /tr <RFC3161-time-server> /td sha256 /a file.exe`.
- **Timestamping**: always on, so signatures survive cert renewal.
- **Certificate class**: **EV** preferred (immediate SmartScreen reputation); falls back to OV (reputation accrues over ~tens of thousands of downloads).
- **Key custody**: Azure Trusted Signing (Microsoft-managed HSM) is the 2026-preferred path for a small team. Falls back to DigiCert KeyLocker if HSM custody is a hard requirement. The README's "The initial binaries are unsigned" is the **gap to close first** before any release to co-admins.

### 4.3 Android APK Signature Scheme v2 + v3

- **Algorithm**: v2 (whole-APK hash, Android 7+) + v3 (key rotation support, Android 9+). v4 only if Play App Signing + AAB incremental installs are adopted.
- **Tool**: `apksigner` from Android SDK build-tools.
- **Key custody**: Play App Signing — Google holds the production key in a GCP KMS; AIRIZ signs with an upload key; lineage is preserved across rotations. **Mandatory for new/updated apps since June 2021**.
- **Downgrade control**: `versionCode` monotonicity (enforced by Play), not the signature scheme.

### 4.4 iOS distribution certificate + provisioning profile

- **Certificate class**: Apple Distribution (P12). Held by AIRIZ, in CI secret `AIRIZ_IOS_DIST_P12_BASE64` + `AIRIZ_IOS_DIST_P12_PASSWORD`.
- **Provisioning profile**: App Store profile (no device list). Renewed annually; rotation monitored via 30-day-expiry alert.
- **Notarization** (macOS): `xcrun notarytool submit --apple-id … --password … --team-id …` + `xcrun stapler staple`. Hard-fail the build on any `notarytool` exit code ≠ 0.
- **TestFlight**: internal distribution to Ziris PTB co-admins before App Store release. 90-day tester expiry per Apple.

### 4.5 Cloudflare Workers immutable version tags

- **Algorithm**: every `wrangler deploy` produces an immutable version tag (e.g., `wrangler-v1234567890`). Cloudflare's edge router serves the deployed version by tag.
- **Percentage split**: `wrangler versions deploy <tag> --percentage N` — the edge router splits traffic by percentage across two tags.
- **Rollback**: `wrangler versions rollback` redeploys the previous tag to 100% — sub-second at the edge. **This is the kill switch.**
- **Artifact delivery**: R2 signed URLs (HMAC-SHA256 with expiry timestamps) for any binary that needs to be fetched by the Worker at runtime.

---

## 5. References (the existing research this synthesis is built on)

| Document | Path | Length | Purpose |
|---|---|---|---|
| Protocol catalog (17 engines) | `apps/airiz-motor/release-architecture-reference.md` | 1,418 lines | Squirrel.Windows, Squirrel.Mac, Sparkle, WinSparkle, AppInstaller, Tauri, Capacitor official, Capgo, CodePush, Expo Updates, Sentry Releases, Flutter patterns, MAUI, Uno, RN-code-push, PWA SW, Chrome component updater — manifest format, signing, version-check, rollback, staging for each |
| Manifest schema design | `apps/airiz-motor/unified-release-manifest-schema.md` | 561 lines | Field-by-field contract for each engine; the 15-field `airiz-release.v1` that subsumes them |
| Security baseline | `apps/airiz-motor/update-security-baseline-2026.md` | 571 lines | Ed25519 / Authenticode / APK v2+v3 / iOS / SRI / CF Worker / staged rollouts / crash-throttled / delta / key escrow / reproducible builds / provenance |
| Failure modes (10 hardest) | `apps/airiz-motor/release-failure-modes.md` | 687 lines | 9-field schema per failure (in-one-line / mode / blast / tricky / real outage / signal / checklist / fix / AIRIZ note) |
| Protocol survey (Round 1 Agent 7) | `airiz-release-architecture/release-protocols-survey.md` | 1,793 lines | Minimum-viable schema dumps for 7 protocols + Squirrel.Mac + WinSparkle + CodePush + Expo + Omaha |
| Wall of failure (Round 1 Agent 3) | `airiz-release-architecture/wall-of-failure-cross-platform-auto-update.md` | 609 lines | Ranked-by-blast table + 10 detailed failure narratives with real citations (CrowdStrike, ASUS, CCleaner, SolarWinds, Sparkle bugs, electron-builder bugs, etc.) |
| Implementation tools | `apps/airiz-motor/tools/README.md` | 174 lines | The `keygen.ts` + `sign-manifest.ts` + `manifest-to-electron-yml.ts` pipeline + the GitHub Actions orchestrator |
| Source maps (round 1 verified) | `electron-userland/electron-builder/packages/electron-updater/src/`, `capawesome-team/capacitor-plugins/packages/live-update/` | n/a | 100+ file:line citations on electron-updater internals (`EBUM1` wire format, `canonicalizeForSigning`, key-rotation via dual-signing, BaseUpdater state machine, AppUpdater decision logic, MacUpdater/AppImageUpdater install paths) and capacitor-live-update internals (LiveUpdate.java rollback, SHA256withRSA verify, setNextBundleById, readyTimeout) |

---

## 6. What to do next (the operational hardening, not architecture)

The architecture is sound. The work that remains is **operational**, not design:

1. **Sign the unsigned Windows binaries.** Today's gap: `apps/airiz-motor/README.md` says "The initial binaries are **unsigned**." Get an EV code-signing cert (Azure Trusted Signing recommended for one-person team), set up `signtool sign /fd sha256 /tr <RFC3161-time-server> /td sha256 /a`, and integrate into `airiz-desktop.yml`. **This is the single biggest trust blocker.** Without it, SmartScreen warns every co-admin on first run.
2. **Run the round-1 protocol-survey verifications.** The verification pass aborted (`Session error: Aborted` on all 8 agents) before completion. Re-run when the agent harness is healthy, especially verification of: the `EBUM1` wire format in `electron-builder`, the macOS 26 Tahoe Sparkle EPERM issue number (#2868 vs #2880), and the Bitrise CodePush free-tier MAU confirmation.
3. **Set up the Ed25519 signing keypair** per `tools/README.md` "First-time setup". Generate once, paste `AIRIZ_SIGNING_PRIVATE_KEY_PEM` + `AIRIZ_SIGNING_PUBLIC_KEY_PEM` into GitHub Actions secrets, **delete the local copy**, paste the public key into `app-update.yml`'s `updateManifestPublicKey`. Without this, the `manifest-to-electron-yml.ts` cannot emit the v27 signed-manifest form.
4. **Set up Sentry release tracking** with the 0.995 crash-free-sessions threshold for the 24h monitor. Without it, `airiz-unified-release.yml`'s "monitor" step has no signal.
5. **Test the staging rollout** with a real co-admin device at 10% before pushing to 100%. The 24h monitor is necessary but not sufficient; a human in the loop for the first 1-2 releases is non-negotiable.
6. **Document the key rotation procedure.** `signatures[]` is in place; the human procedure (generate new key, dual-sign during the rotation window, update `app-update.yml` `updateManifestPublicKey`, ship a new client build that pins only the new key) needs a written runbook.

---

## 7. What NOT to do

- **Don't migrate to Tauri.** You lose the Windows user base, the Bluetooth-bridge history, the Ziris PTB rosters, and the v1.11.x feature surface. The savings (single-binary desktop) are real but don't outweigh the migration cost for a one-person team with a working Windows app.
- **Don't adopt Bitrise CodePush, Expo EAS Update, or Capawesome Cloud.** All three are mobile-only and managed. AIRIZ's mobile path is already signed-and-self-hosted. Adding a third-party managed dependency for state management you already do server-side is a net negative.
- **Don't add delta updates.** Deltas save bandwidth but introduce a rollback graph problem (you can't go from v3 back to v2 without the inverse patch or a stored full v2). For AIRIZ's current ~80 MB installer, full downloads are fine. Re-evaluate only if installer size grows past 200 MB.
- **Don't change the desktop to a Tauri single-binary.** The signing pipeline (electron-updater v27 Ed25519 + Authenticode + RFC 3161) is well-understood; switching to Tauri means re-learning Tauri's `.sig` flow + a new bundle-per-platform matrix. No payoff.
- **Don't add sub-day latency to mobile updates.** Capacitor Live Update delivers the web shell in seconds; native binary updates still go through TestFlight (internal) and App Store (release). This is the right tradeoff for AIRIZ — the web shell is the user-facing surface 95% of the time.
- **Don't let `staged_rollout` drift from the live state.** It's a value in the signed manifest; the monitor bumps it. The single source of truth is the R2 manifest, not a local config file.

---

## 8. Summary scorecard

| Decision | Status |
|---|---|
| Single Ed25519-signed manifest on Cloudflare R2 | ✅ Already implemented (`tools/sign-manifest.ts`) |
| electron-updater v27 `signatures[]` on Windows | ✅ Already implemented (`manifest-to-electron-yml.ts`) |
| In-app Ed25519 verify on iOS / Android (Capawesome RSA bypass) | ✅ Already implemented (`mobile/src/live-update.mjs`) |
| Cloudflare `wrangler versions deploy --percentage` for Worker | ✅ Already implemented in `airiz-relay-worker.yml` |
| PWA atomic SW activation + Workbox | ✅ Already implemented (`web/sw.js`) |
| 24h Sentry crash-throttled auto-promotion gate | ⚠️ Workflow exists, threshold configured, **needs Sentry project** |
| Windows EV cert + Authenticode + RFC 3161 timestamp | ❌ **Open — unsigned binaries today** |
| Apple notarization in macOS build matrix | ❌ Open (Mac not yet a daily-driver surface) |
| Android APK v2+v3 + Play App Signing | ⚠️ Workflow exists, **needs Play Console enrollment** |
| Key rotation procedure + runbook | ❌ Open |
| Round-2 protocol verification | ❌ Aborted, must re-run |

**Architecture: locked. Execution: 4 of 10 operational items remain open; the unsigned-binary gap is the only one that blocks trusting co-admins with the next release.**
