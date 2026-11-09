# AIRIZ Motor Console — Unified Release Protocol

> **What this is**: the operational document for AIRIZ's unified release
> architecture. Lives alongside the decision record in
> `unified-release-architecture-decision-2026-11-04.md` (the "what we chose"
> document) and the survey/verification docs in this folder (the "why we
> chose it" documents). This file is the "how to operate it" document — the
> manifest schema, the signing ceremony, the per-platform signing ceremonies,
> the release workflow, and the operational runbook.

> **Date**: 2026-11-05
> **Owner**: Juwen Lie · Team Ziris PTB
> **Implementation lead**: Juwen Lie
> **First signed release target**: 1.11.27

---

## 1. The unified manifest

Every AIRIZ surface reads from a single Ed25519-signed JSON manifest on Cloudflare R2.
The manifest is the source of truth. Per-surface update files (`latest.yml`, IPA, AAB, PWA shell tarball, Worker version) are referenced as URLs with content hashes inside the manifest.

### 1.1 Schema (`airiz-release.v1`)

```jsonc
{
  "schema_version": 1,
  "app_id": "airiz-motor-console",
  "channel": "production",                                  // "production" | "beta" | "staging"
  "released_at": "2026-11-05T04:53:04Z",
  "staged_rollout": 10,                                     // 0..100; bumped to 0 on rollback, 100 on promote
  "block": false,                                            // canonical kill switch — true stops the release immediately
  "target_versions": {
    "electron":         "1.11.27",
    "capacitor_ios":    "1.11.27",
    "capacitor_android": "1.11.27",
    "pwa":              "1.11.27",
    "worker":           "1.11.27"
  },
  "artifacts": {
    "electron":         { "url": "...", "sha512": "...", "size": N, "blockmap_url": "...", "blockmap_sha512": "..." },
    "capacitor_ios":    { "url": "...", "size": N, "bundle_id": "io.github.juwpegatron.airiz.mobile" },
    "capacitor_android":{ "url": "...", "sha256": "...", "size": N, "version_code": 1127, "signature_schemes": ["v2", "v3", "v3.2"] },
    "pwa":              { "url": "...", "sha256": "...", "service_worker_version": "1.11.27" },
    "worker":           { "url": "...", "wrangler_version_id": "abc123-...", "compatibility_date": "2026-11-05" }
  },
  "signatures": [
    { "key_id": "airiz-prod-2026-Q1", "alg": "ed25519", "value": "<base64>" }
  ],
  "notes_url": "https://github.com/juw12/projects/releases/tag/airiz-v1.11.27",
  "critical_update": false
}
```

The canonical signing payload is **RFC 8785 JSON Canonicalization Scheme (subset): recursive key sort, no whitespace, UTF-8 bytes, with the `signatures[]` field excluded** (`tools/sign-manifest.ts`). The signature scheme is **Ed25519 (RFC 8032, PureEdDSA)**.

### 1.2 Where it lives

```
Cloudflare R2 bucket `airiz-releases` (region: auto)
├── production/manifest.json                          ← the signed manifest
├── production/electron/latest.yml                    ← build-time sidecar (cached for 60s+stale-while-revalidate 600s at the Worker)
├── production/electron/latest.yml.gz                 ← gzipped variant for v3 differential
├── production/capacitor-android/<version>/...zip
├── production/capacitor-ios/<version>/...ipa
├── production/pwa/<version>/...
├── production/worker/<version>.js
├── beta/...                                           ← same layout
└── staging/...                                        ← same layout, served from a workers.dev subdomain
```

### 1.3 Who reads it

| Surface | URL pattern | Read by | Verified with |
|---|---|---|---|
| Electron Windows desktop | `https://releases.airiz.example/<channel>.yml` (default Windows fetch) | `electron-updater` v6.8.11 via `desktop/update-controller.cjs` | `updateManifestPublicKey` (base64 SPKI DER) in `desktop/app-update.yml` |
| Electron macOS / Linux | `https://releases.airiz.example/<channel>/electron/latest-{mac,linux}.yml` (per-platform suffix) | `electron-updater` per-platform updaters | Same `updateManifestPublicKey` |
| Capacitor Android | `https://releases.airiz.example/<channel>/capacitor/<bundle>.zip` (gated by `X-Capawesome-Device-Id` server-side SHA-256 bucketing) | `@capawesome/capacitor-live-update` (added 2026-11-05) | `plugins.LiveUpdate.publicKey` in `capacitor.config.json` — **RSA-2048** (Capawesome uses RSA, NOT Ed25519; this is a second signing key, see §3.2) |
| Capacitor iOS | `https://releases.airiz.example/<channel>/capacitor/<bundle>.zip` | `@capawesome/capacitor-live-update` | Same RSA public key |
| PWA (Web Serial + Pages) | `https://releases.airiz.example/<channel>/manifest.json` | Custom service worker (`web/sw.js`) | `WebCrypto.subtle.verify('Ed25519', ...)` against the embedded public key |
| Cloudflare Worker | `wrangler versions deploy --percentage N` | CF native | CF account RBAC + audit log |

---

## 2. Signing ceremony

### 2.1 The manifest key

| Item | Value |
|---|---|
| Algorithm | Ed25519 (RFC 8032, PureEdDSA) |
| Generation | `apps/airiz-motor/tools/keygen.ts` (one-time, dev/local) or CI-generated per release (production) |
| Private key custody | GitHub Actions secret `AIRIZ_SIGNING_PRIVATE_KEY_PEM` (multi-line PEM). Never on disk in CI. |
| Private key backup | `secrets/airiz-signing-private.pem` (gitignored via `*.pem` rule) for local dry-runs only |
| Public key distribution | `desktop/app-update.yml` `updateManifestPublicKey` field; `desktop/update-controller.cjs` runtime config; baked into PWA service worker at build time; baked into Capacitor Live Update client config |
| Public key fingerprint (SHA-256 of SPKI DER) | 34a72ed3162a7fdfd7a740f349ce9b17a6e1e58379f3592a5613992765be2461 (dev keypair generated 2026-11-05) |
| Rotation cadence | Every 90 days OR per incident if compromise is suspected |
| Rotation mechanics | (1) Generate `airiz-signing-<date>.pem` ahead of expiry. (2) Add as new signing key. (3) Publish manifests with both signatures in `signatures[]` during rotation window. (4) After 90 days, drop old key from trust list. (5) Revoke old key from CI secrets. |
| Multi-key trust list | `desktop/update-controller.cjs`'s `UPDATE_MANIFEST_PUBLIC_KEY` accepts a comma-separated list; the Worker reads `AIRIZ_SIGNING_PUBLIC_KEYS_PEM;;` (semicolon-separated) per `release-relay/src/index.ts` |
| Algorithm | Single algorithm — Ed25519 only. `parsePublicKey` in electron-updater rejects any non-Ed25519 key. |

### 2.2 The Capawesome (mobile) key

Capawesome uses **RSA-2048 PKCS1v15-SHA256** over the bundle ZIP. This is NOT interchangeable with Ed25519.

| Item | Value |
|---|---|
| Algorithm | RSA-2048 PKCS1v15-SHA256 |
| Generation | `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048` |
| Private key custody | GitHub Actions secret `AIRIZ_CAPACITOR_RSA_PRIVATE_KEY_PEM` |
| Public key distribution | `capacitor.config.json` → `plugins.LiveUpdate.publicKey` field; embedded in iOS Info.plist + Android strings.xml at build time |
| Rotation cadence | Annually |

### 2.3 The per-platform signing identities (unchanged from decision §3.3 as amended)

| Platform | Primary | Custody | Rotation |
|---|---|---|---|
| Windows code-signing cert | **Microsoft Trusted Signing** (Artifact Signing, $9.99/mo) — preferred for one-person team. OAuth to GitHub Actions; no hardware token. | GitHub Actions OIDC | Annual or on-demand |
| Windows fallback | DigiCert OV ($150–300/yr) — only if procurement requires a traditional cert | YubiKey PIV hardware token | Annual; 30-day overlap with new cert |
| Windows procurement-only | DigiCert / Sectigo EV ($400+/yr) — EV no longer bypasses SmartScreen since Aug 2024 | YubiKey PIV hardware token | Annual |
| Android upload key | P12 (`AIRIZ_ANDROID_KEYSTORE_BASE64`) | GitHub Actions secret + Play App Signing | Play App Signing handles user-visible key; upload key rotatable since 2023 |
| Android signing schemes | **v2 + v3 + v3.2** (quantum-ready hybrid by Play default; v4 incompatible with quantum-ready, dropped) | Play App Signing | Annual key upgrade offered by Play for Android 17+ |
| Apple Developer ID | Apple Developer Program + Apple-issued `.p12` + `.mobileprovision` | Xcode local + Apple Developer portal | Annual cert renewal; provisioning profiles expire and need renewal |
| Apple notarization | Same Apple Developer ID | `xcrun notarytool` in CI, ticket stapled | Cert-bound |
| Worker deploy | Cloudflare account | OIDC + hardware-key-required RBAC | Continuous (Cloudflare controls) |

### 2.4 Microsoft Trusted Signing tenant setup (out-of-band, but documented)

The Windows code-signing cert path of least friction for one-person team:

1. **Azure subscription**: requires a Microsoft account with an active Azure subscription. AIRIZ's team Ziris PTB does not have one set up yet. Create one at `portal.azure.com` if not present.
2. **Trusted Signing account**: separate from Azure subscription. Sign up at `learn.microsoft.com/en-us/azure/trusted-signing` (or the rebranded "Artifact Signing" portal). Identity validation by Microsoft (no hardware token required).
3. **GitHub Actions OIDC**: in the Trusted Signing portal, grant federated credentials to the `juw12/projects` repo's GitHub Actions workflow (`airiz-unified-release.yml`). The CI then signs the .exe at build time with no secret in env.
4. **First-time cost**: $9.99/month ($120/yr). Cheap compared to DigiCert OV ($150-300/yr) or EV ($400+/yr). EV gives **no SmartScreen benefit** since Aug 2024.
5. **electron-builder integration**: see https://www.electron.build/code-signing.html#microsoft-trusted-signing; `desktop/package.json` build config will need `win.trustedSigning` block once the tenant is ready.

### 2.5 Apple Developer account + TestFlight setup (out-of-band, but documented)

1. **Apple Developer Program enrollment**: $99/yr at `developer.apple.com/programs/enroll/`. Required for ANY iOS distribution (App Store, TestFlight, enterprise).
2. **Distribution certificate**: create in Xcode → Accounts → Manage Certificates → "+" → "Apple Distribution". Stored as `.p12` file with password.
3. **Provisioning profile**: create at `developer.apple.com` → Certificates, Identifiers & Profiles → Profiles. Type: "App Store" or "Ad Hoc" or "Development". Linked to the AIRIZ Mobile bundle ID `io.github.juwpegatron.airiz.mobile`.
4. **GitHub Actions secrets**:
   - `AIRIZ_IOS_DIST_CERT_P12_BASE64` — base64-encoded `.p12` cert
   - `AIRIZ_IOS_DIST_CERT_PASSWORD` — `.p12` password
   - `AIRIZ_IOS_PROVISIONING_PROFILE` — base64-encoded `.mobileprovision`
5. **`airiz-mobile.yml` workflow additions** (currently outputs UNSIGNED IPA + zipped Xcode project — see `apps/airiz-motor/mobile/README.md`):
   - Decode provisioning profile + cert from secrets
   - `xcrun notarytool submit <ipa> --keychain-profile <profile> --wait` for notarization
   - Use `xcrun altool --upload-app --type ios` OR App Store Connect API key for TestFlight upload
6. **App Store vs TestFlight dual-track**: TestFlight for internal + co-admins (faster release cycle, hours); App Store for the broader fleet (1-3 day review cycle). Defer App Store until ≥1000 active installs (per decision §6 Q1).

---

## 3. Release workflow

### 3.1 Trigger

```
git tag push v1.11.27
```

or

```
GitHub Actions → workflow_dispatch on airiz-unified-release.yml with `version` input
```

### 3.2 Pipeline (`airiz-unified-release.yml`)

```
tag push v1.11.27
   │
   ├── build matrix (electron, capacitor-android, capacitor-ios, pwa)
   │     └─ emits per-surface hash JSON + upload-artifact
   │
   ├── sign
   │     ├─ merge hashes → build/manifest-input.json
   │     ├─ sign with AIRIZ_SIGNING_PRIVATE_KEY_PEM → release/airiz-release.json
   │     ├─ emit release/electron/latest.yml (from the signed manifest)
   │     ├─ inject public key into apps/airiz-motor/desktop/app-update.yml
   │     ├─ re-verify signed manifest against AIRIZ_SIGNING_PUBLIC_KEY_PEM
   │     ├─ aws s3 sync per-surface artifacts to s3://airiz-releases/<surface>/<version>/
   │     ├─ aws s3 cp latest.yml to s3://airiz-releases/electron/<version>/
   │     ├─ aws s3 cp airiz-release.json to s3://airiz-releases/production/manifest.json
   │     ├─ aws s3 cp app-update.yml to s3://airiz-releases/electron/<version>/app-update.yml
   │     └─ aws s3 cp airiz-signing-public.pem to s3://airiz-releases/<channel>/signing-key.pub
   │
   ├── worker rollout
   │     └─ wrangler versions upload && wrangler versions deploy --percentage 10
   │
   └── monitor (24h)
         ├─ poll Sentry release health for `crash_free_sessions`
         ├─ if < 0.995 → bump staged_rollout=0 AND block=true; re-sign; re-upload; wrangler rollback
         └─ if ≥ 0.995 → bump staged_rollout=100 (per Edit D: should be 1→10→50→100 logarithmic over 24h holds)
```

### 3.3 Per-surface build matrix

| Surface | Build command (CI step) | Output |
|---|---|---|
| Electron Windows | `pnpm --filter airiz-console-desktop run dist:win` | `apps/airiz-motor/desktop/dist/*.exe` |
| Capacitor Android | `pnpm --filter airiz-motor run android:build` | `apps/airiz-motor/mobile/android/app/build/outputs/apk/release/app-release.apk` |
| Capacitor iOS | `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphoneos -derivedDataPath build-device CODE_SIGNING_ALLOWED=NO build` (currently UNSIGNED — see §2.5) | `apps/airiz-motor/mobile/dist/*.ipa` |
| PWA | `pnpm --filter airiz-motor-pwa run build` | `apps/airiz-motor/web/` (deployed to GitHub Pages via `pages.yml`) |
| Worker (release-relay) | Deployed directly via `wrangler versions upload` (no separate build step) | Cloudflare Workers version |

### 3.4 Versioning

- All 5 surfaces get the **same version string** (e.g. `1.11.27`) so the manifest is one-to-one across surfaces.
- Per-surface build numbers: Electron uses the version string; Android uses `versionCode = 1127`; iOS uses `buildNumber = "1127"`; PWA uses the version string in `sw.js` `CACHE_NAME`; Worker uses `wrangler`'s version ID (auto-generated, immutable).

### 3.5 GitHub secrets and variables

| Name | Type | Purpose |
|---|---|---|
| `AIRIZ_SIGNING_PRIVATE_KEY_PEM` | secret | Ed25519 PKCS8 PEM. Used to sign `airiz-release.json`. |
| `AIRIZ_SIGNING_PUBLIC_KEY_PEM` | secret | Ed25519 SPKI PEM. Used by CI to re-verify before emitting sidecars. CI writes the base64 SPKI DER into `desktop/app-update.yml`. |
| `AIRIZ_CAPACITOR_RSA_PRIVATE_KEY_PEM` | secret | RSA-2048 PKCS8 PEM. Used by CI to sign Capacitor bundles. |
| `AIRIZ_CAPACITOR_RSA_PUBLIC_KEY_PEM` | secret | RSA-2048 SPKI PEM. CI writes it into `capacitor.config.json` plugins.LiveUpdate.publicKey. |
| `AIRIZ_ANDROID_KEYSTORE_BASE64` | secret | P12 keystore, base64-encoded. Android upload key for Play App Signing. |
| `AIRIZ_ANDROID_SIGNING_PASSWORD` | secret | P12 keystore password. |
| `AIRIZ_IOS_DIST_CERT_P12_BASE64` | secret (future) | Apple Distribution cert. Not in tree today. |
| `AIRIZ_IOS_DIST_CERT_PASSWORD` | secret (future) | Apple `.p12` password. |
| `AIRIZ_IOS_PROVISIONING_PROFILE` | secret (future) | `.mobileprovision`. |
| `R2_ACCESS_KEY_ID` | secret | R2 API token id. |
| `R2_SECRET_ACCESS_KEY` | secret | R2 API token secret. |
| `CF_API_TOKEN` | secret | Cloudflare API token for `wrangler`. |
| `SENTRY_AUTH_TOKEN` | secret | Sentry API token for crash-throttled rollback. |
| `R2_ENDPOINT` | var | `https://<acct>.r2.cloudflarestorage.com` |
| `R2_BUCKET` | env | `airiz-releases` |
| `CF_ACCOUNT_ID` | var | Cloudflare account id |
| `SENTRY_ORG_SLUG` | var | Sentry org slug |

---

## 4. Operational runbook

### 4.1 Cutover: GitHub Pages feed → Worker feed

The legacy feed at `https://juw12.github.io/projects/airiz-motor/updates/windows/` (via `desktop/scripts/sync_release_feed.py` + `airiz-update-feed.yml`) is being replaced by the Worker feed at `https://releases.airiz.example/`. The cutover happens at version 1.11.27:

1. **Before 1.11.27 release**: `airiz-update-feed.yml` keeps running. `desktop/update-controller.cjs` `FEED` still points at GitHub Pages. Installed builds < 1.11.27 keep using the legacy feed (uninstall + reinstall would migrate them, but we don't force that).
2. **1.11.27 release**:
   - `desktop/update-controller.cjs` `FEED = 'https://releases.airiz.example'` (already done in commit)
   - `desktop/app-update.yml` `url: https://releases.airiz.example` + `channel: production` + `updateManifestPublicKey: ...` (already done)
   - `airiz-unified-release.yml` produces the signed `airiz-release.json` on R2 at `production/manifest.json`
   - `airiz-update-feed.yml` is **kept** for one release cycle as a safety net — produces `web/updates/windows/latest.yml` pointing at the same artifact (uninstall path)
3. **After 1.11.27 lands cleanly**: `airiz-update-feed.yml` workflow is disabled. The GitHub Pages legacy feed is frozen at 1.11.27. Installed builds > 1.11.27 use the Worker feed. Installed builds ≤ 1.11.27 stay on the legacy feed until they auto-update past 1.11.27.

### 4.2 Differential download — enable when blockmaps are emitted

`desktop/update-controller.cjs` has `updater.disableDifferentialDownload = true`. This is conservative — `electron-updater`'s differentialDownloader is built-in and safe, but it requires the build pipeline to emit `<artifact>.exe.blockmap` alongside the installer. The `airiz-desktop.yml` workflow does not currently emit blockmaps (electron-builder v27 emits them by default if `nsis.differentialPackage` is set; otherwise it skips).

**To enable**: flip `disableDifferentialDownload = false` in `update-controller.cjs:126`, set `nsis.differentialPackage: true` in `desktop/package.json` build config, rebuild and verify the `.blockmap` file appears in `dist/`. The blockmap adds ~2-5 seconds to the build pipeline and saves ~70% bandwidth on typical patches.

**Do not enable until verified** — a malformed blockmap causes `electron-updater` to silently fall back to the full binary (safe behavior), so the worst case is "no savings, no breakage."

### 4.3 PWA service worker rewrite — Workbox + Ed25519

The current `web/sw.js` is a hand-rolled 90-line cache-first strategy with no signature verification. Per the decision §2.4 PWA row: replace with Workbox + WebCrypto Ed25519 verify. The replacement (committed in this change) uses Workbox loaded from CDN (no new npm dep) with `BroadcastChannel`-gated `skipWaiting` to avoid the controller race documented in §3.6 of `airiz-release-update-architecture-survey.md`.

### 4.4 Tail Consumer (Sentry telemetry forwarder)

`release-relay/wrangler.toml` lines 60-61 have the Tail Consumer commented out:
```toml
# [[env.production.tail_consumers]]
# service = "airiz-relay-tail"
```
Uncomment when the `airiz-relay-tail` Worker (a separate artifact) is built. It consumes tail logs from `airiz-release-relay` and forwards to Sentry. This is required for the Sentry crash-throttled rollback to actually receive signals from the release-relay Worker itself.

### 4.5 Rollback (kill switch)

Per Edit D: the canonical kill switch is `manifest.block: true`, not `manifest.staged_rollout: 0`. When a regression is detected (Sentry `crash_free_sessions < 0.995` or manual judgment):

1. The `monitor` job in `airiz-unified-release.yml` bumps `staged_rollout = 0` AND `block = true`, re-signs, and re-uploads.
2. The Worker calls `verifyAny` on every read — if the signature fails or the verification key doesn't match, it returns 500. This is the last-line defense against a compromised key.
3. **Always follow rollback with `wrangler rollback --name airiz-release-relay`** for the Worker tier (pass-2 Edit C: rollback is refused if a DO class lifecycle change occurred since the rollback target, or if any R2/KV/Queue binding was deleted; bounded to last 100 versions).

### 4.6 Emergency: revoked key

If the manifest signing key is compromised:

1. Generate a new keypair (`tools/keygen.ts` locally; production key in CI).
2. Add the new public key to the multi-key trust list in `desktop/update-controller.cjs` (`UPDATE_MANIFEST_PUBLIC_KEY`) AND the Worker (`AIRIZ_SIGNING_PUBLIC_KEYS_PEM`).
3. Publish the next release with **both old and new signatures in `signatures[]`**.
4. After all clients have rotated (estimated 90 days for Electron; faster for Capacitor because of forced updates via Play Store; immediate for PWA via hard refresh), drop the old public key from trust lists.
5. Old private key: zero out and never reuse. Audit log entry.

### 4.7 Why no delta updates for now

Decision §7: AIRIZ payloads are 80MB Electron, 25MB Capacitor mobile, 2MB PWA, 1MB Worker. bsdiff saves 40-55MB per Electron user but the cost is real (two artifacts per release, forward-only rollback, multi-version patch registry, atomic binary swap with no rollback on failed apply). For one-person team, full updates only. Revisit when (1) payload exceeds 200MB, (2) update cadence is daily, (3) bandwidth-bound users (China, India) exceed 30% of install base.

---

## 5. References

- `unified-release-architecture-decision-2026-11-04.md` — the locked decision
- `updater-pass2-verification-2026-11-05.md` — the 4 amendments applied
- `airiz-release-update-architecture-survey.md` — the original r1 survey
- `.research/updater-source-survey-r1.md` — electron-updater + Capawesome source-level evidence
- `.research/updater-protocol-docs-r1.md` — 16 update engines protocol surface
- `.research/updater-hardest-problems-r1.md` — top 10 failure modes with citations
- `.research/updater-security-2026-r1.md` — security best practices
- `.research/updater-postmortems-r1.md` — public postmortems 2022-2026
- `.research/updater-topic-deep-dives-r1.md` — 8 architectural sub-essays
- `.research/updater-manifest-formats-r1.md` — manifest spec minimum-viable subset
- `.research/updater-unified-models-r1.md` — 12-framework survey
- `cross-platform-update-landscape-survey.md` — broader ecosystem
- `cross-platform-unified-update-survey.md` — 15-framework unified-update survey
- `auto-update-postmortem-library-2022-2026.md` — postmortem library
- `airiz-update-channel-risk-register.md` — risk register
- `update-channel-deep-research.md` — deep dive on a subset
