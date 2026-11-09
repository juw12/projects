# AIRIZ Motor Console — Unified Release Architecture Decision (2026-11-04)

> **What this is**: the consolidated decision document for AIRIZ Motor Console's
> unified release architecture. Sits alongside the prior research stack in this
> folder (`airiz-release-update-architecture-survey.md` from the same date,
> `cross-platform-unified-update-survey.md`, `auto-update-postmortem-library-2022-2026.md`).
>
> **Date**: 2026-11-04 (decision locked); **2026-11-05 pass-2 amendments applied** (see below).
> **Owner**: Juwen Lie · Team Ziris PTB
> **Purpose**: lock the choice between (a) keep current split, (b) migrate to
> Tauri, or (c) build a single signed-manifest layer that every surface pulls
> from. Then ship the schema, key custody, and CI.
>
> **Sources**: 8 parallel background sub-agents run on 2026-11-04 (explore /
> librarian / general), cross-referenced with the existing prior-research docs
> in this folder. Where today's fresh research disagreed with prior conclusions,
> the difference is called out inline.
>
> **Pass-2 amendments (2026-11-05)**: per `updater-pass2-verification-2026-11-05.md §5`,
> four additive edits applied to the locked decision; none change the architecture:
>
> | Edit | Section | Change |
> |---|---|---|
> | A | §3.3 Windows cert | Primary → Microsoft Trusted Signing ($9.99/mo, OAuth, no hardware token). EV demoted to procurement-only fallback (EV no longer bypasses SmartScreen since Aug 2024). |
> | B | §2.2 `capacitor-android-aab.signatureSchemes` | `["v2", "v3", "v4"]` → `["v2", "v3", "v3.2"]` + `signingKeyArchitecture: "quantum-ready-hybrid"`. v4 dropped (incompatible with quantum-ready hybrid signing). |
> | C | §2.6 Worker rollback | Added verbatim constraints: rollback refused on Durable Object class lifecycle change OR deleted R2/KV/Queue binding; bounded to last 100 versions; **operational rule**: never combine DO class change with feature change in the same Worker deploy. |
> | D | §2.5 Staged rollouts | Default cadence 10/50/100 → **logarithmic 1/10/50/100** (24h holds); slower cadence for auth/payments; cross-link `block: true` as the canonical kill switch. |

---

## TL;DR — recommendation

**Build a single signed-manifest layer that every AIRIZ surface pulls from.
Keep each surface's native apply path.**

This is **Option C** from the prior survey (`airiz-release-update-architecture-survey.md`).
Today's 8-agent survey re-validates that recommendation against (1) the actual
source of `electron-updater` v7.0.0-alpha.13 (electron-builder v27 alpha), (2)
the actual source of `@capawesome/capacitor-live-update` 8.x, (3) the actual
Tauri 2.x updater protocol, (4) Sparkle, Squirrel.Windows, MSIX AppInstaller,
PWA ServiceWorker, CodePush (dead), Expo Updates, and (5) ten real-world
postmortems including CrowdStrike 2024-07-19, CCleaner 2017, ASUS ShadowHammer,
SolarWinds SUNBURST, and Microsoft Windows 10 1809 deletion bug.

**Five reasons Option C wins for AIRIZ specifically:**

1. **Tauri is not a unified answer.** Tauri 2.x's updater covers Windows +
   macOS + Linux desktop only. Tauri compiles to iOS and Android but ships
   **no updater for mobile** — the plugin README's platform table marks
   Android/iOS with `x`, and v2.13.x explicitly returns `Error::UnsupportedOs`
   for mobile `Update::install`. A "migrate to Tauri" move for AIRIZ saves
   nothing on mobile and costs a 3-6 month desktop rewrite.
2. **Capawesome's signing is not Ed25519.** It is RSA-2048 PKCS1v15-SHA256
   over the whole ZIP. electron-updater v27 is Ed25519 over a canonicalized
   manifest. The two are not interchangeable — a single Ed25519 key cannot
   sign for both. If we want one signing ceremony, the consumer-side libs
   have to align, which they do not.
3. **No framework shipped a unified updater in 2026.** 12 frameworks surveyed
   (Tauri, Flutter, .NET MAUI, Uno, KMP, RN, Capawesome, Voltbuilder,
   Appcircle, Codemagic, Bitrise, Fastlane). All either solved only desktop,
   solved only mobile, or were a CI/CD platform that delegated update delivery
   to a third party. The closest precedent is **Electron + Capawesome +
   Workbox + Workers Versions — three different tools, three different
   manifests**. We would build that anyway; we might as well build it
   deliberately with one manifest format.
4. **Cloudflare Workers Versions API gives us the central publisher for
   free.** `wrangler versions upload` + `wrangler rollback --version-id`
   already gives immutable version history and instant rollback for the Worker
   tier. The Worker becomes the natural signed-manifest publisher, with
   rotation keys held as Workers Secrets and the public key embedded in every
   Electron / Capacitor / PWA binary at build time.
5. **One-person team math.** Three independent signing pipelines = three CVE
   investigations, three cert-rotation ceremonies, three audit trails. One
   pipeline = one. The savings on incident response alone pay for the
   implementation cost in the first year.

**What we explicitly do NOT do:**

- We do not migrate desktop to Tauri (Option B). The Electron main-process
  + native-menu polish the AIRIZ Windows app depends on (USB-serial
  Web Serial fallback, sticky Notifications during remote-share, MIN/MAX
  state on the platform tray) is a real product moat — see 1.11.22's "Safe
  auto-update" notes.
- We do not rewrite the existing updaters. electron-updater, Capacitor
  Live Update, PWA ServiceWorker, CF Workers Versions API are already
  shipped and battle-tested. We layer a single manifest *over* them.
- We do not introduce a feature-flag vendor (LaunchDarkly, Unleash,
  Statsig). One-person team does not need a vendor; a `rollout.json` in the
  same signed channel is sufficient and removes the SLA dependency.

---

## 1. What changed in today's survey vs the prior research

The prior research (in `airiz-release-update-architecture-survey.md` and
`cross-platform-unified-update-survey.md`) recommended Option C on 2026-11-04
earlier. Today's 8-agent survey was a fresh pass. The differences are small
and reinforce the same conclusion:

| # | Prior research said | Today's fresh agent found | Net |
|---|---------------------|----------------------------|-----|
| 1 | electron-updater v27 ships Ed25519 manifest signing (beta) | **Verified at source**: `packages/electron-updater/src/AppUpdater.ts:847-898` (`verifyManifestSignature`), `packages/builder-util-runtime/src/updateManifestSignature.ts` — Ed25519 with `EBUM1` canonical payload, `signatures[]` array for key rotation | Reinforces — the upgrade path is real but alpha |
| 2 | Capawesome verifies ZIP with RSA-2048 PKCS1v15-SHA256 | **Verified at source**: `ios/Plugin/LiveUpdate.swift:1103-1191` uses `SecKeyVerifySignature` with `rsaSignatureDigestPKCS1v15SHA256`; `android/.../LiveUpdate.java:744-755,1661-1677` uses `Signature.getInstance("SHA256withRSA")` | Reinforces — confirms unified Ed25519 across both is impossible without re-implementing |
| 3 | Tauri 2.x uses Ed25519 (minisign) | Verified at docs: `tauri.conf.json` `plugins.updater.pubkey` field; private key supplied at build time as `TAURI_SIGNING_PRIVATE_KEY`; runtime key rotation via `Builder::new().pubkey(...)` | Reinforces — Tauri model is the right reference for the manifest we build |
| 4 | Cloudflare Workers Versions API supports rollback | Verified at docs: `wrangler versions upload`, `wrangler versions list`, `wrangler versions deploy`, `wrangler rollback --version-id`, Gradual Deployments, Tail Workers for canary | Reinforces — central publisher is feasible today |
| 5 | AIRIZ's current `update-controller.cjs` uses URL-pattern + SHA-512 only (no signature) | Confirmed at source: no `updateManifestPublicKey`, no signature verification | **Drift noted** — current shipping flow is *still* unsigned; this is now a known gap to close in the manifest migration |
| 6 | `apps/airiz-motor/web/updates/windows/latest.yml` is unsigned | Confirmed: present `version` + `files[].{url,sha512,size}` + legacy `path`/`sha512` + `releaseDate`, no `signature`/`signatures` | **Drift noted** — the publish path needs to start emitting signed manifests |
| 7 | CrowdStrike 2024-07-19 was 8.5M Windows machines | Today's research surfaced the same incident with same blast radius but noted additional context: no automatic rollback existed; CrowdStrike committed to (1) staged rollouts + canary validation, (2) per-region deployment, (3) automatic rollback, (4) "content validation gate" before distribution | Reinforces with operational specifics |

**Net conclusion**: prior research was directionally correct. Today's fresh
pass added *source-level confirmation* of the key claims and surfaced the
specific drift (AIRIZ's `latest.yml` is unsigned, no manifest signature today)
that the migration must close.

---

## 2. The unified manifest schema

This is the single artifact that every AIRIZ surface reads. Drafted for
2026-11-04. Subject to revision during implementation.

### 2.1 Top-level shape

```jsonc
{
  "$schema": "https://airiz.example.com/schemas/manifest.v1.json",
  "manifestVersion": 1,
  "id": "airiz-motor-1.11.26",
  "releaseDate": "2026-11-04T12:00:00Z",
  "channel": "stable",                                  // "stable" | "beta"
  "publisher": {
    "name": "AIRIZ Test Inc.",
    "ed25519PublicKey": "ed25519:MCowBQYDK2VwAyEA...",
    "keyId": "sha256-of-spki-base64",
    "rotatedFrom": null                                 // or previous keyId for rotation window
  },
  "platforms": {
    "electron-windows-x64": { ... },
    "electron-macos-x64": { ... },
    "electron-macos-arm64": { ... },
    "capacitor-android-aab": { ... },
    "capacitor-android-apk-splits": { ... },
    "capacitor-ios": { ... },
    "pwa": { ... },
    "worker-relay": { ... }
  },
  "rollout": {
    "mode": "manifest-canary",                          // or "feature-flag", "worker-routing"
    "stagingPct": 100,                                  // 0..100
    "hashOf": "deviceId|installId"                      // which device property gates
  },
  "minimumAppVersion": "1.11.0",                        // refuse update from older than this
  "releaseNotes": "https://github.com/juw12/projects/releases/tag/airiz-v1.11.26",
  "criticalUpdate": false,
  "signatures": {
    "manifest": "base64-ed25519-of-canonical-JSON",
    "files": {
      "electron-windows-x64": "base64-ed25519-of-binary",
      "capacitor-android-aab": "base64-ed25519-of-bundle",
      "pwa": "base64-ed25519-of-shell-archive",
      "worker-relay": "base64-ed25519-of-worker-script"
    }
  }
}
```

### 2.2 Platform entries

Each entry under `platforms` follows a common envelope, with platform-specific
binary descriptors:

```jsonc
"electron-windows-x64": {
  "kind": "nsis-installer",
  "version": "1.11.26",
  "url": "https://relay.airiz.example.com/releases/1.11.26/airiz-motor-1.11.26-setup.exe",
  "size": 83886080,
  "sha512": "base64-of-sha512-of-binary",
  "blockMapUrl": ".../airiz-motor-1.11.26-setup.exe.blockmap",
  "blockMapSha512": "...",
  "minimumSystemVersion": "10.0.17763",
  "publisherName": "CN=AIRIZ Test Inc., O=AIRIZ, L=HCMC, C=VN"
}
```

```jsonc
"capacitor-android-aab": {
  "kind": "android-aab",
  "version": "1.11.26",
  "versionCode": 1126,
  "url": ".../airiz-motor-1.11.26.aab",
  "size": 33554432,
  "sha256": "hex-sha256-of-aab",
  "minSdkVersion": 24,
  "targetSdkVersion": 35,
  "signatureSchemes": ["v2", "v3", "v3.2"],
    "signingKeyArchitecture": "quantum-ready-hybrid"   // RSA-4096 (v3) + ML-DSA-65 (v3.2); Play App Signing default for fresh apps as of 2026 (verified at support.google.com/googleplay/android-developer/answer/9842756)
    // NOTE: v4 (incremental .idsig) is INCOMPATIBLE with quantum-ready hybrid signing; Play explicitly forbids the combination. AIRIZ's current workflow does not use v4, so this is a non-issue, but document as a constraint.
}
```

```jsonc
"capacitor-ios": {
  "kind": "ios-ipa",
  "version": "1.11.26",
  "buildNumber": "1126",
  "url": ".../airiz-motor-1.11.26.ipa",
  "size": 26214400,
  "sha256": "hex-sha256-of-ipa",
  "distributionMethod": "testflight",                   // "testflight" | "app-store" | "enterprise"
  "entitlements": [ "com.apple.developer.web-browser" ],
  "teamIdentifier": "ABCDE12345",
  "minimumIosVersion": "16.0"
}
```

```jsonc
"pwa": {
  "kind": "pwa-shell",
  "version": "1.11.26",
  "url": ".../airiz-pwa-1.11.26.tar.gz",
  "size": 2097152,
  "sha256": "hex-sha256-of-tarball",
  "serviceWorker": {
    "scriptUrl": "https://airiz.example.com/sw.js?v=1.11.26",
    "scope": "/",
    "cacheName": "airiz-shell-1.11.26"
  },
  "shellFiles": [
    { "path": "/index.html",     "sha256": "..." },
    { "path": "/main.7c8e2f.js", "sha256": "..." }
  ]
}
```

```jsonc
"worker-relay": {
  "kind": "cloudflare-worker",
  "version": "1.11.26",
  "url": ".../airiz-relay-1.11.26.wasm",
  "size": 1048576,
  "sha256": "hex-sha256-of-wasm",
  "wranglerVersion": "3.99.0",
  "compatibilityDate": "2026-11-04",
  "compatibilityFlags": ["nodejs_compat"]
}
```

### 2.3 Canonical signing payload

A single, deterministic JSON encoder is used so that **every surface computes
the same byte-for-byte canonical form before signing**. Pseudocode:

```
canonical(payload) = strip signatures{} → JSON.stringify with sorted keys,
                     no whitespace, RFC 8785 (JCS) UTF-8 bytes
signature = Ed25519.sign(sha256, canonical(payload))
```

The `signatures.files{}` per-platform signatures are computed over the
**binary artifact itself** (not the descriptor), so a corrupt binary fails
verification regardless of what the manifest says.

### 2.4 Verification on each surface

| Surface | Verifies | With what |
|---|---|---|
| Electron Windows | canonical(payload) sig + per-file sig + Authenticode | `updateManifestPublicKey` from `app-update.yml` + `windowsExecutableCodeSignatureVerifier` |
| Capacitor Android | canonical(payload) sig + per-bundle sig + APK v2/v3/v4 | embedded `publicKey` (Ed25519, NOT the APK signing key) + `apksigner verify --print-certs` |
| Capacitor iOS | canonical(payload) sig + per-IPA sig + Apple code-signing | embedded `publicKey` + App Store / TestFlight code-signing chain |
| PWA | canonical(payload) sig + per-shell-file SRI hashes | embedded `publicKey` (WebCrypto `crypto.subtle.verify('Ed25519', ...)`) |
| Worker relay | n/a (Cloudflare controls deploy authenticity) | OIDC deploy tokens + account audit log |

Every surface *also* keeps its native apply path:

- electron-updater's `quitAndInstall()` on Windows / macOS
- Capawesome's `setNextBundle()` + `reload()` on Android
- iOS uses Apple's TestFlight / App Store review
- PWA uses the existing `skipWaiting()` + `BroadcastChannel` + `caches.delete()`
- Worker uses `wrangler versions deploy --percentage N` + Tail Worker routing

### 2.5 Channel model and rollout

Two channels: `stable` (production) and `beta` (internal + opt-in co-admins).

- `stable` lives at `https://relay.airiz.example.com/manifest.json` with full
  Ed25519 signature
- `beta` lives at `https://relay.airiz.example.com/beta/manifest.json` with
  full Ed25519 signature
- Each surface has a `channel` config that chooses which to poll
- Default is `stable`; `beta` is opt-in via the in-app *Updates* panel

Rollout gates are tied to the **same manifest** (`rollout.stagingPct`). The
manifest is the single source of truth. Electron and Capacitor clients
evaluate `stagingPct` against a hash of `deviceId|installId` for offline-capable
canary. The Worker tier uses Workers Versions gradual deployment + Tail Worker
routing (server-side, separate decision).

**Default cadence for AIRIZ is logarithmic** (per pass-2, 2026-11-05):
`1% → 10% → 50% → 100%` with 24h holds between stages. Lower cadence
(`10% → 50% → 100%` over a single day) for infra-routing / log-format
changes. Slower cadence (`0.5% → 2% → 10% → 25% → 50% → 100%` with 48–72h
holds) for higher-stakes paths (auth, payments, motor-control safety). AIRIZ's
surface (USB-serial device, motor control, remote-share code) means a 50%
rollout can hit a bad bug before the full fleet does, so default to logarithmic
even on "trivial" releases.

The `block: true` field in the manifest is the canonical **kill switch** —
disable beats zero-rollout because the flag-update path treats them
differently (Mixpanel / LaunchDarkly / Statsig converge on this). When a
cohort crashes above the threshold (see §6 Q4), the monitor job bumps
`stagingPct` to 0 AND sets `block: true`; clients stop offering the broken
version immediately on next poll.

### 2.6 Rollback story

- **Worker**: `wrangler rollback --version-id` (instant, sub-second edge propagation).
  **Constraints** (verbatim from `developers.cloudflare.com/workers/versions-and-deployments/rollbacks/`): rollback is **refused** if (a) a **Durable Object class lifecycle change** (via `exports` or the legacy `migrations` array) has occurred between the rollback target and the active version, or (b) a **binding to an R2 bucket, KV namespace, or queue** referenced by the rollback target has been **deleted**. Rollback depth is bounded to the **last 100 published versions**.
  **Operational rule** (added by pass-2): **never combine a DO class change with a feature change in the same Worker deploy.** Ship DO migrations alone so feature bugs remain rollback-revertible. Never delete an R2 bucket / KV namespace / queue that any Worker version still references — the retention policy on these bindings becomes a release concern, not just an ops concern.
- **Electron**: ship a new manifest pointing at the previous artifact (5-15 min end-to-end).
- **Capacitor Android**: ship a new manifest pointing at the previous AAB / bundle.
- **Capacitor iOS**: rollback requires App Store re-submission (24-48h); the dual-track
  design uses TestFlight internally where rollback is faster (within hours).
- **PWA**: ship a new shell that points the SW `caches.delete()` to evict the
  broken shell (within minutes for users who refresh; up to 24h for users on
  the broken shell who don't open the app).

---

## 3. Signing key custody and rotation

### 3.1 Key lifecycle

- **Algorithm**: Ed25519 (RFC 8032, PureEdDSA).
- **Generation**: `openssl genpkey -algorithm ed25519 -out airiz-signing-2026.pem`,
  followed by `openssl pkey -in airiz-signing-2026.pem -pubout -out airiz-signing-2026.pub`.
- **Storage**:
  - Private key: Cloudflare Workers Secret (`AIRIZ_MANIFEST_SIGNING_KEY_v1`),
    encrypted at rest, scoped per environment (separate secrets for
    `production` and `staging`). Key never touches disk in CI.
  - Public key: embedded into every Electron binary (`app-update.yml`),
    every Capacitor config (`capacitor.config.json`), every PWA `sw.js` (at
    build time), and the Worker manifest publisher itself.
- **Rotation cadence**: every 90 days.
- **Rotation mechanics**:
  1. Generate `airiz-signing-2027.pem` ahead of expiry.
  2. Add to Workers Secrets as `AIRIZ_MANIFEST_SIGNING_KEY_v2`.
  3. Publish manifests *with both signatures* during the rotation window:
     `signatures.manifest_v1` + `signatures.manifest_v2`.
  4. Each surface's trust list has both public keys; either signature validates.
  5. After 90 days, drop the v1 key from trust lists.
  6. Revoke v1 from Workers Secrets (Cloudflare audit log captures the event).

### 3.2 What we explicitly do NOT use

- **YubiKey PIV / hardware tokens** — nice-to-have, not blocking for one-person
  team. Revist when a second engineer joins.
- **AWS KMS / Azure Key Vault** — overkill for AIRIZ scale. Cloudflare Workers
  Secrets is sufficient. Workers Secrets is encrypted at rest, scoped per env,
  and access-controlled via Cloudflare RBAC + account audit log.
- **Sigstore / OIDC-to-Ed25519** — production-grade but introduces a Fulcio
  dependency that adds latency and SLA overhead. Worth considering at fleet
  >10K active devices. For now, dual-signing rotation is the simpler answer.
- **Per-platform signing keys** (Windows EV cert, Android P12, Apple Developer
  ID, Apple notarization). These stay separate because the *platforms require
  it*. The unified manifest does not replace platform signing; it *wraps*
  it.

### 3.3 Per-platform signing (unchanged)

| Platform | Signing identity | Custody | Rotation |
|---|---|---|---|
| **Windows code-signing cert (primary)** | **Microsoft Trusted Signing** (Artifact Signing, $9.99/mo per Microsoft pricing, Nov 2024 rebrand of "Azure Trusted Signing") — preferred for one-person team | OAuth to GitHub Actions; **no hardware token**; managed identity validation by Microsoft | Annual or on-demand; SmartScreen reputation builds over time (same as OV) |
| **Windows code-signing cert (fallback)** | DigiCert OV ($150–300/yr) — only if procurement requires a traditional cert chain | Hardware token (YubiKey PIV) | Annual; 30-day overlap with the new cert |
| **Windows EV cert (procurement-only)** | DigiCert / Sectigo EV ($400+/yr) — only if a specific customer requires EV for driver-mode signing or enterprise procurement; **EV no longer bypasses SmartScreen since Aug 2024** (Microsoft removed EV OIDs from the Microsoft Trusted Root Program; see `learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation` and `code-signing-options`) | Hardware token | Annual |
| Android upload key | P12 (`AIRIZ_ANDROID_KEYSTORE_BASE64`) | GitHub Actions secret + Play App Signing | Play App Signing rotation since 2023; upload key rotation is now possible |
| Apple Developer ID + provisioning profile | Apple Developer Program + Apple-issued `.p12` + `.mobileprovision` | Xcode local + Apple Developer portal | Annual cert renewal; provisioning profiles expire and need renewal |
| Apple notarization | Same Apple Developer ID | `xcrun notarytool` in CI, ticket stapled | Cert-bound |
| Worker deploy | Cloudflare account | OIDC + hardware-key-required RBAC | Continuous (Cloudflare controls) |

These three signing pipelines collapse to **one signing ceremony** in CI:
the manifest is signed once, then the platform-specific signing applies
to each binary. The signing ceremony does the manifest signing AND kicks off
the platform signing — single GitHub Action job.

---

## 4. The five-surface update matrix

| Surface | Channel | Manifest source | Apply path | Rollback path |
|---|---|---|---|---|
| Electron Windows | `stable` or `beta` (config) | Worker-signed JSON at `https://relay.airiz.example.com/manifest.json` | `electron-updater` with `updateManifestPublicKey` baked in | New signed manifest pointing at previous artifact |
| Capacitor Android | `stable` or `beta` (config) | Same Worker-signed JSON | Capawesome Live Update with embedded Ed25519 `publicKey` (NOT the existing RSA key — swap Capawesome's signing mode) | New signed manifest |
| Capacitor iOS | `testflight` (default) | Same Worker-signed JSON | TestFlight internal distribution; App Store for production | TestFlight: revoke + new build; App Store: 24-48h |
| PWA | `stable` or `beta` (config) | Same Worker-signed JSON | `BroadcastChannel('airiz-update')` + SW `skipWaiting` on user click | Ship new shell + `caches.delete()` |
| Worker relay | n/a (Cloudflare controls) | Workers Versions API + audit log | `wrangler versions deploy --percentage N` | `wrangler rollback --version-id` |

---

## 5. Build matrix in CI

```
.github/workflows/airiz-release.yml    (the unified release workflow)

matrix:
  jobs:
    - prepare-manifest    (signs the manifest once, holds the canonical payload)
    - electron-windows    (builds NSIS, signs Authenticode, attaches Authenticode signature + sha512 to manifest entry)
    - electron-macos      (signs Developer ID, notarizes, attaches signature)
    - capacitor-android   (builds AAB + APK splits, signs v2/v3/v3.2 quantum-ready-hybrid, attaches to manifest entry)
    - capacitor-ios       (builds IPA + zipped Xcode project, signs Developer ID, notarizes, attaches)
    - pwa                 (builds Pages bundle, generates shell tarball, signs each shell file, attaches)
    - worker-relay        (wrangler versions upload, signs bundle via Worker Secrets)
    - publish-manifest    (writes the signed canonical manifest to Cloudflare R2 + assigns `airiz-manifest` KV key)
    - post-publish        (smoke-tests against all five surfaces, gates via Sentry release health for first 30 minutes)
```

Total CI cost: ~25 minutes wall-clock for a full five-surface release. The
single signing ceremony runs once and is shared across all jobs via GitHub
Actions artifact passing.

---

## 6. Open questions / future work

| # | Question | Resolution path |
|---|---|---|
| Q1 | Capacitor iOS App Store review latency — can we tolerate 24-48h? | Dual-track: TestFlight (hours) for internal + co-admins; App Store (24-48h) for fleet distribution. Defer App Store until ≥1000 active installs. |
| Q2 | Manifest size — does signing a 30-platform manifest bloat every fetch? | Yes, marginally. Keep `platforms` lean (only emit entries for currently-built surfaces). Use Cloudflare KV with a short TTL (60s) so cold fetches are cached at the edge. |
| Q3 | Do we need delta updates at all? | **No** — see Section 7. 80MB Electron and 25MB Android are below the threshold where delta complexity pays off. Revisit if AIRIZ payload exceeds 200MB. |
| Q4 | When to introduce Sentry crash-throttled rollback? | Start with manual rollback (one-person team, acceptable latency). Wire Sentry release health + crash-free-sessions alerts at 2× baseline **before** the first manifest-signed release ships. |
| Q5 | When to introduce feature flags? | **Not yet.** `rollout.json` in the same signed channel is sufficient. Revisit if/when AIRIZ has >5 active release trains. |
| Q6 | When to migrate to Tauri? | **Not in scope for this decision.** Tauri saves nothing on mobile; Windows desktop's Electron main-process + native-menu + Web Serial integration is a real moat. Keep Electron. |
| Q7 | CodePush / App Center died — does that affect AIRIZ? | No. AIRIZ never used CodePush; the deprecated official Capacitor Live Update plugin is not in tree. Capawesome is the active plugin and continues to ship. |
| Q8 | PWA SW cache-eviction correctness | The current PWA does not strictly enforce `caches.keys().filter().delete()` on activation. Audit + fix in the manifest migration's PWA-surface work. |

---

## 7. Delta-vs-full — why no delta channel

AIRIZ payload sizes today: 80MB Electron desktop, 25MB Capacitor mobile, 2MB
PWA shell, 1MB Worker. Real-world bsdiff patches on these:

- 80MB Electron → 25-40MB bsdiff patch (60-70% compression, saves 40-55MB)
- 25MB Capacitor → ~8MB patch
- 2MB PWA → absurd (no delta)
- 1MB Worker → absurd (no delta)

The patch saves ~40-55MB per Electron user, but **the cost is**:

- Two artifacts per release (delta + full)
- Forward-only rollback breaks (delta is one-way)
- Patch generator service in CI
- Client-side verifier on the patch (must validate before apply)
- Multi-version rollback registry (user might be N versions behind)
- Atomic binary swap with no rollback on failed apply

For one-person team, **the patch service is unjustified**. Full updates only.
Revisit when (1) payload exceeds 200MB, (2) update cadence is daily, or (3)
bandwidth-bound users (China, India) exceed 30% of install base.

---

## 8. Citations and source documents

### Today's 8-agent survey (2026-11-04)

- Agent 1 (explore — electron-updater + Capawesome source): local
  `electron-userland/electron-builder/packages/electron-updater/src/` + local
  `ca-pkg/package/`. Output captured in this session.
- Agent 2 (librarian — 10 protocol surfaces): Context7 + direct webfetch.
  Output captured in this session.
- Agent 3 (general — 10 hardest problems + citations): Web research. Output
  captured in this session.
- Agent 4 (librarian — 2026 security best practices): Context7 + Tauri docs
  verified. Output captured in this session.
- Agent 5 (explore — postmortems since 2022): GitHub issues + vendor
  announcements. Output captured in this session.
- Agent 6 (general — 200-word deep dive on 8 topics): direct research.
  Output captured in this session.
- Agent 7 (librarian — protocol specs / minimum viable subset): source
  code + canonical docs. **Four corrections to the brief surfaced**:
  electron-builder v27 signs `latest.yml`; Tauri JSON doesn't carry
  top-level `pubkey`/`signatures[]`; Capawesome is RSA not Ed25519; Squirrel
  format differs from the brief's example.
- Agent 8 (explore — unified update models): survey of 12 frameworks.
  Verdict: no unified cross-platform framework ships.

### Prior research in this folder

- `airiz-release-update-architecture-survey.md` (81KB) — internal AIRIZ
  decision record. Recommends Option C. **Source of today's Option C
  recommendation.**
- `cross-platform-unified-update-survey.md` (51KB) — 15-framework survey.
  Tauri verdict: SOLVED for desktop, PUNTED for mobile. Single most important
  finding: "the update problem is a distribution-infrastructure problem, not
  a framework problem."
- `cross-platform-update-landscape-survey.md` (66KB) — broader ecosystem.
- `auto-update-postmortem-library-2022-2026.md` (84KB) — postmortem library.
- `update-channel-deep-research.md` (75KB) — deep-dive on a subset.
- `airiz-update-channel-risk-register.md` (54KB) — risk register.

### External primary sources

| Source | URL |
|---|---|
| electron-updater source | https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater |
| electron-builder signed manifests | https://www.electron.build/docs/features/signed-update-manifests |
| Tauri 2.x Updater | https://tauri.app/plugin/updater/ |
| Capawesome Live Update | https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/live-update |
| Sparkle appcast docs | https://sparkle-project.org/documentation/ |
| Squirrel.Windows RELEASES format | https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs |
| Cloudflare Workers Versions | https://developers.cloudflare.com/workers/configuration/versions/ |
| Cloudflare Workers rollback | https://developers.cloudflare.com/workers/configuration/versions/rollback/ |
| Microsoft AppInstaller schema | https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root |
| W3C ServiceWorker spec | https://www.w3.org/TR/service-workers/ |
| RFC 8032 (EdDSA) | https://datatracker.ietf.org/doc/html/rfc8032 |
| Apple App Store Review Guidelines | https://developer.apple.com/app-store/review/guidelines/ |
| Android APK Signing v3/v4 | https://developer.android.com/build/building-cmdline#sign_cmdline |
| CrowdStrike Post-Incident Review | https://www.crowdstrike.com/blog/crowdstrike-incident-review-july-19-2024/ |
| ASUS ShadowHammer (Kaspersky) | https://securelist.com/operation-shadowhammer/89992/ |
| SolarWinds SUNBURST (FireEye) | https://www.fireeye.com/blog/threat-research/2020/12/dissecting-solorisky-operation.html |
| CCleaner 2017 (Talos) | https://blog.talosintelligence.com/2017/09/ccleaner-step-up-cleanup.html |

---

## 9. Decision

**LOCKED**: AIRIZ Motor Console unified release architecture is **Option C**
(signed-manifest-on-Worker). Implementation begins immediately. Migration
plan is staged per surface, with each surface's native updater kept in place.
The manifest is signed once per release; per-platform signing applies to each
binary. Worker Secrets holds the signing key; Cloudflare audit log captures
every publish.

**Implementation lead**: Juwen Lie.
**Target ship**: staged rollout starting with Electron Windows → Capacitor
Android → PWA → Worker → Capacitor iOS.
**First signed manifest target**: 1.11.27.
