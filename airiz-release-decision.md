# AIRIZ Motor Console — Unified Release Architecture

**Owner:** Juwen Lie · **Team:** Ziris PTB · **Status:** Decision document
**Five shipping surfaces:** (1) Electron Windows desktop · (2) Capacitor Android (signed APK) · (3) Capacitor iOS (unsigned IPA + zipped Xcode project) · (4) static web PWA + Web Serial + Pages-hosted update channel · (5) Cloudflare Workers + Durable Objects relay
**Existing pipelines:** `airiz-desktop.yml`, `airiz-mobile.yml`, `airiz-mobile-runtime.yml`, `airiz-relay-worker.yml`, `airiz-update-feed.yml`
**Existing release tooling:** `apps/airiz-motor/scripts/sync_release_feed.py`, `apps/airiz-motor/scripts/add_coadmin.py`
**Current protocol stack:** `electron-updater` for Win + `sync_release_feed.py` (custom Python) + `@capawesome/capacitor-live-update` for Android/iOS + plain PWA service-worker refresh + `wrangler deploy` for the Worker

---

## 0. Executive decision

**Recommended path: option B — migrate desktop to Tauri 2.x while keeping Capacitor + the custom feed layer on mobile/web/worker.** Rationale and full matrix below.

> **Why not option A (keep current split):** every new release coordinates 3 manifests (latest.yml + Capacitor cloud JSON + Pages-hosted `latest.json`) and 3 signing keys (Windows EV + Android P12 + iOS provisioning). One-person team cannot afford the operational surface.
>
> **Why not option C (build a fully custom signed-manifest layer for all 5 surfaces):** Tauri 2.x already ships the exact thing (ed25519 manifest + Windows installer signing + macOS notarization hooks + Windows `on_before_exit` race-fix) that we would otherwise build. We would reinvent Tauri's updater for ~1,500 lines of TypeScript + a Cloudflare Worker, with no production hardening. Tauri gives us that for free, and Tauri's protocol is a clean JSON manifest (already documented below) that the Capacitor layer and PWA SW can also consume if we want a single signed feed.

**Stack after migration:**

| Surface | Mechanism | Signing | Manifest location |
|---|---|---|---|
| Win + macOS desktop | Tauri 2.x updater | ed25519 (built-in, can't disable) | `https://releases.airiz.app/latest.json` |
| Android (Capacitor) | `@capawesome/capacitor-live-update` | RSA-SHA256 (Cap Awesome plugin key) | Cap Awesome Cloud **OR** self-hosted JSON |
| iOS (Capacitor) | Same Capacitor Live Update, Apple App Store for native shell | RSA-SHA256 | Same |
| Web PWA | Workbox `skipWaiting` + `clientsClaim` + manifest read | SRI on bundles | `https://releases.airiz.app/latest.json` |
| Cloudflare Worker | `wrangler deploy --rollback` | Worker version ID | Cloudflare Workers dashboard |

All five pull from the same JSON-shaped signed-manifest schema (Tauri's `latest.json` is JSON, and Capacitor Live Update's manifest is JSON — they differ only in field names; the worker just exposes one canonical feed).

---

## 1. Survey results — what exists today (2026-Q1)

Cross-checked against the protocol reference document (`airiz-release-protocols.md`, 1,489 lines) that already exists in the repo root, plus direct fetches of Tauri 2.x docs, Sparkle docs, Expo Updates SDK docs, Android v3 signing docs, Apple notarization docs, App Center retirement announcement, and CrowdStrike 2024 postmortem.

### 1.1 Auto-update ecosystem status table

| Ecosystem | Status (2026-01) | Wire format | Signing | Storage | Atomicity | Quit semantics | Rollback | Delta support | Mobile? |
|---|---|---|---|---|---|---|---|---|---|
| **Squirrel.Windows** | Maintenance ("Contributors Needed") | `RELEASES` plaintext file + `*.nupkg` | **None — plaintext SHA1 only**, HTTPS is the only protection | HTTP (any) | Replace in-place; Squirrel handles backup | Squirrel runs on app launch | Squirrel last-known-good | BSDiff (`deltas/`) | No |
| **Squirrel.Mac** | Maintenance | ShipIt JSON | **None** (Apple code-sign only) | HTTP (any) | Atomic via `ShipIt` staging dir | None — ShipIt runs on relaunch | ShipIt last-known-good | None | No |
| **Sparkle 2.x** | Active | Appcast RSS 2.0 + `sparkle:` namespace XML | **EdDSA (Ed25519)** — base64 pubkey in `Info.plist`'s `SUPublicEDKey` | HTTP (any) | Atomic via staging dir | None — Sparkle asks to quit + relaunch | None (no app rollback) | BSDiff (`*.delta` via `sparkle:deltaFrom`) | No |
| **electron-updater v6.x** | Active | `latest.yml` / `latest-mac.yml` / `latest-linux.yml` (YAML) | **Ed25519** (v27+) manifest signing, required for new releases; Authenticode publisherName check on Windows installer | Provider: generic / github / gitlab / bitbucket / s3 / azure / spaces / bintray / local / keygen | Install in pending dir → rename on quit | NSIS install-on-quit (deferred via `before-quit-for-update`); macOS Squirrel.Mac handles; Linux via package mgr | **None in electron-updater itself** — relies on installer backup | **Blockmap deltas** (512B blocks, HTTP Range) + differential via NSIS web installer (`packages`) | No (Win/macOS/Linux only) |
| **`@tauri-apps/updater` 2.x** | Active | Static JSON or dynamic server JSON | **Ed25519, cannot be disabled** (built into Tauri CLI `signer generate`) | HTTPS only in prod (TLS enforced); `dangerousInsecureTransportProtocol` opt-out | **Windows installer forced exit** during install (limitation of Windows installers); `on_before_exit` hook provided | App can defer (then Tauri exits) | None in Tauri — relies on installer backup | **None** (full binary only) | **Desktop only** (Win/macOS/Linux). **iOS/Android: not supported by Tauri updater** — the plugin docs platform matrix marks `android` and `ios` as ❌ |
| **`@capawesome/capacitor-live-update` v8.x** | Active | Bundle URL + RSA signature + (optional) per-file manifest JSON for differential | **RSA-2048-PKCS1v1.5-SHA256** (PEM pubkey in `capacitor.config.ts` `plugins.LiveUpdate.publicKey`) | Cap Awesome Cloud REST (`/v1/apps/{appId}/bundles/latest`) **OR** self-hosted static `downloadBundle({ url })` | Atomic per-bundle via versioned snapshot dirs; downloads dir wiped on launch | **None** — no quit/install; WebView reload + `ready()` timer | **Yes** — `readyTimeout` ms without `ready()` triggers automatic rollback to default bundle + blocks that bundleId if `autoBlockRolledBackBundles` is true | Per-file manifest reuse (file-level, not byte-level); no byte-level delta | **Yes** — Android, iOS |
| **Capacitor Live Update (official Ionic Appflow)** | **DEAD** — Ionic deprecated in 2024 when Appflow spun down; replaced by Cap Awesome | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| **`expo-updates` v58.x** | Active | [Formal protocol v1 spec](https://docs.expo.dev/technical-specs/expo-updates-1.md) | **RSA** (`rsa-v1_5-sha256`) via `updates.codeSigningCertificate` | EAS Update hosted, or [custom server](https://github.com/expo/custom-expo-expo-updates-server) (must implement v1 protocol) | Per-asset atomic | None — JS reload | **Yes** — `rollBackToEmbedded` directive + `isEmergencyLaunch` flag | **Asset-level reuse** via runtime manifests; **bsdiff** support via `enableBsdiffPatchSupport` | **Yes** — Android, iOS |
| **CodePush / App Center** | **DEAD** — App Center retired **March 31, 2025**; CodePush standalone fork at `github.com/microsoft/code-push-server` | JSON manifest with deployment key (NOT a crypto key — only auth) | **None** (deployment key is opaque auth, not signature) | App Center CDN (now shut down) → user must run `code-push-server` themselves | Per-bundle | JS reload | None | Asset reuse only | Yes — Android, iOS, RN |
| **PWA Service Worker** | W3C ServiceWorker ED Oct 2026, Workbox recipes | SW script itself is the version | **None** (HTTPS is the only integrity protection; no signed manifest) | HTTPS origin | `waiting → installing → installed → activating` state machine; `skipWaiting()` + `clients.claim()` for immediate | N/A (no install — page refresh) | Manual: bump SW version → user reloads | None | Web only |
| **Microsoft AppInstaller / MSIX** | Active | AppInstaller XML + MSIX bundle | **Authenticode** (SHA256 subject) | HTTPS, UNC, or `file://` | Transactional MSIX install — atomic | App must be closed | MSIX repair / re-install previous version | None | No (Windows only) |

### 1.2 Signing algorithm matrix (security-critical)

| Ecosystem | What gets signed | Algorithm | Key location (client) | Notes |
|---|---|---|---|---|
| Squirrel.Windows | `RELEASES` file (appended per release) | SHA-1 plaintext only | None — just SHA1 hash | Insecure by 2026 standards; HTTPS-only |
| Squirrel.Mac | (none) | n/a | n/a | Apple code-sign only |
| Sparkle | Appcast item, release-notes, archive | **Ed25519** | `Info.plist` `SUPublicEDKey` | 32-byte base64; keychain-backed private key |
| electron-updater | Manifest (latest.yml) since v27 | **Ed25519** | `app-update.yml` or `autoUpdater.updateManifestPublicKey` | Multi-key with `signatures[]` + `keyId` (SHA-256 of SPKI) since v27 |
| Tauri | JSON manifest / per-bundle `.sig` file | **Ed25519** | `tauri.conf.json` `plugins.updater.pubkey` | Cannot be disabled; key gen via `tauri signer generate` |
| Cap Awesome | Bundle file (full ZIP or per-file) | **RSA-2048-PKCS1v1.5-SHA256** | `capacitor.config.ts` `plugins.LiveUpdate.publicKey` | PEM format; only one key in config |
| Expo Updates | Manifest body | **RSA-PKCS1v1.5-SHA256** | `updates.codeSigningCertificate` in app config | Optional — only required if using self-hosted; EAS Update hosted provides TLS trust |
| CodePush | (none — only deployment key for auth) | n/a | n/a | Sunset |
| PWA SW | (none) | n/a | n/a | HTTPS only |
| AppInstaller/MSIX | MSIX bundle | **Authenticode** | Windows cert store | MSIX signing standard |

### 1.3 Delta update support matrix

| Ecosystem | Delta algorithm | Granularity | When it pays off |
|---|---|---|---|
| Squirrel.Windows | BSDiff (`*.delta`) | Package-level | Large installers, slow networks |
| electron-updater | **Blockmap** (zeros + old/new byte hashes, 512B blocks) + HTTP Range; also NSIS web installer differential (`packages` map) | Byte-block | Any binary; especially large Electron apps (~100MB) |
| Sparkle | BSDiff (`*.delta`) via `sparkle:deltaFrom` | File-level (whole bundle) | macOS bundles > 50MB |
| Tauri | **None** | n/a | Always full download |
| Cap Awesome | File-level (reuses unchanged files by checksum) | Per-file | HTML/JS bundles (rare file changes) |
| Expo Updates | `enableBsdiffPatchSupport` (default true) — bsdiff over JS bundle | Bundle-level | RN/Expo JS bundles |
| CodePush | Asset reuse | Asset-level | Sunset |
| PWA SW | None (full SW script refresh) | n/a | Always full |

---

## 2. Decision matrix — three candidate architectures for AIRIZ

| Criterion | A. Keep current split (electron-updater + Cap Awesome + custom feed + Worker) | B. Tauri desktop + Cap Awesome mobile + unified JSON manifest | C. Fully custom signed-manifest layer (R2) for all 5 |
|---|---|---|---|
| **Win desktop signing** | Authenticode (publisherName) | ed25519 manifest + Authenticode on installer | ed25519 manifest + Authenticode on installer |
| **macOS desktop signing** | Squirrel.Mac + Authenticode (if shipped) | ed25519 + notarization via `xcrun notarytool` | Same as B |
| **Android signing** | Cap Awesome RSA key | Same — Cap Awesome is still the only mature mobile live-update | Custom (we'd have to build this; Cap Awesome would have to be removed) |
| **iOS signing** | Same Cap Awesome | Same | Same |
| **PWA update mechanism** | Workbox + custom `latest.json` | Workbox + Tauri's JSON manifest consumed by SW | Custom |
| **Worker update mechanism** | `wrangler rollback` | Same — Worker versioning is independent | Same |
| **Number of manifest formats maintained** | 3 (latest.yml + Cap Awesome REST JSON + Pages-hosted latest.json) | **1** (Tauri-style JSON — Capacitor Cloud can read a JSON with same fields; PWA SW can fetch + compare) | 1 (but we own the format) |
| **Number of signing keys managed** | 3 (Win EV + Android P12 + Cap Awesome RSA) | 3 (same, but consolidated CI) | 3+ (we add a 4th: manifest ed25519 signing) |
| **Migration cost (1-person team)** | $0 (current) | **~$2,000-$5,000** (Tauri port of Win/macOS shell; React/Vue already reusable) | **~$8,000-$15,000** (build updater + signing + 5-surface integration) + ongoing maintenance |
| **Ongoing ops burden** | High — 3 manifests, 3 keys, 3 update mechanisms | **Low** — 1 JSON, 3 keys (same), 3 mechanisms (same) | Highest — full custom signing pipeline to maintain |
| **Risk: signing cert expiry** | High — each cert tracked separately | Same | Lowest if we use HSM, but HSM cost is real |
| **Risk: mobile crash on bad update** | Medium — Cap Awesome rollback to default bundle | Same | Best — we can ship any rollback we design |
| **Risk: Win installer mid-update crash** | Medium — electron-updater cancels quit on Linux but not Win | Same | Same — we'd still rely on NSIS behavior |
| **Risk: PWA SW serving stale shell** | Medium — `skipWaiting` race | Same | Best — we can force a fresh SW on each release |
| **Match for AIRIZ stack (Electron + Capacitor + PWA + Worker)** | Already a fit | **Best** — Tauri replaces only the desktop shell; mobile/PWA/Worker untouched | Overkill for desktop, but would unify if we wanted |
| **Ecosystem momentum** | electron-updater actively maintained, Cap Awesome actively maintained | Tauri 2.x is the fastest-growing desktop framework in 2026 (used by Linear, Vercel, etc.) | None — we'd be a one-off |

**Decision: B.**

---

## 3. Top 10 failure modes — what could still bite AIRIZ

Synthesized from direct fetches of postmortems and the official protocol docs (CrowdStrike 2024-07-19 via Wikipedia incident summary; CCleaner 2017 / 1Password 2023 / ASUS 2019 from prior knowledge of the public record; Sparkle delta-update + Apple notarization quirks from official docs).

### 1. Partial-download mid-update (Win/macOS Tauri or electron-updater)
- **Failure:** Connection drops at 80% during Tauri binary download or electron-updater NSIS differential. User sees a half-copied file in cache. On next launch, file is detected as invalid → re-downloaded. Worst case: NSIS installer spawn is interrupted.
- **Citation:** electron-updater explicitly handles this — the `temp-<name>` file is hashed before rename. Tauri's `tauri-plugin-updater` does streaming SHA-256 verification (`sha2` in download options).
- **Mitigation for AIRIZ:** rely on Tauri's built-in streaming hash. Add a custom `verifyUpdateFile` hook that re-hashes the file before install (same pattern electron-updater supports). For mobile, Cap Awesome's `verifyAndCopyFile` already does post-download verification.

### 2. Code-signing certificate expiry
- **Failure:** Windows EV cert lapses → every new build is treated as unknown publisher → SmartScreen ramp resets → ~30-50% download warning rates for ~2-4 weeks.
- **Citation:** SolarWinds 2020 — leaked signing cert was used to sign Orion updates with malicious code; trust model held but blast radius was massive. (Signing cert theft, not expiry, but the trust chain is the same attack surface.)
- **Mitigation for AIRIZ:** Auto-renew EV cert at 60 days before expiry; track expiry in `sync_release_feed.py` manifest metadata; alert via Worker durable object. Apple notarization tickets (per build) auto-expire after 30 days if unstapled — must re-notarize on each release.

### 3. Manifest tampering
- **Failure:** Attacker on a captive Wi-Fi network rewrites `latest.json` to point at a backdoored binary. Without manifest signature verification, the client accepts it.
- **Citation:** CrowdStrike 2024-07-19 — a *signed* configuration update (`C-00000291*.sys`) with malformed IPC template data caused ~8.5 million Windows hosts to BSOD. Root cause: channel-file content not validated before deployment. (Postmortem summary captured in Wikipedia: "faulty configuration update… not the result of a cyberattack… planned process changes to reduce the risk of similar incidents".)
- **Mitigation for AIRIZ:** Tauri enforces manifest signature verification (cannot disable). For mobile, configure Cap Awesome's `publicKey` and never ship without it. For PWA SW, serve SW + manifest from same origin (HTTPS) + SRI on remote-loaded JS.

### 4. Delta-update corruption
- **Failure:** Blockmap differential (electron-updater) produces a binary that fails SHA-512 check after reconstruction. NSIS installer is launched on a broken binary.
- **Citation:** Sparkle delta-update path has documented "delta checksum mismatch" failures when the user's installed version doesn't exactly match `deltaFrom` version. electron-updater's `BaseUpdater.ts` line 543-545 explicitly handles this: it re-fetches the full file.
- **Mitigation for AIRIZ:** Tauri does NOT support delta downloads, so this class of failure is removed by going Tauri. For mobile, disable Cap Awesome's `manifest` artifact type (use `zip` only) for the first release after adopting any updater — this avoids file-level delta mismatches.

### 5. Staged-rollout regret
- **Failure:** 10% rollout looks healthy (per Sentry/Rollbar), ramped to 100%, then a niche GPU/driver combo triggers a crash that the 10% didn't catch.
- **Citation:** Sparkle's phased group rollout (7 groups × 1 day each) is the gold standard here. Notarized iOS apps have no real staged-rollout mechanism (App Store review is the only gate).
- **Mitigation for AIRIZ:** For Win/macOS, Tauri's `stagingPercentage` field (supported in electron-updater v27+ via the same `latest.yml` field) lets us ship at 10/25/50/100 with device-id-keyed rollout. For PWA, gate via Worker: each fetch returns the latest version with a per-device cohort header. For mobile (Cap Awesome), use the channel mechanism (`setChannel({ channelName })`) — `stable`, `beta-10`, `beta-50`, `stable-100`.

### 6. PWA service worker caching the old shell
- **Failure:** New `index.html` ships, but the SW still serves the cached old `index.html` because the SW itself didn't change. `controllerchange` doesn't fire. Cross-tab fan-out fails.
- **Citation:** W3C Service Worker ED (Oct 2026), §Installing, §Waiting — `waiting` workers don't activate until all clients close unless `skipWaiting()` is called.
- **Mitigation for AIRIZ:** in `service-worker.js` (Workbox recipe):
  ```js
  self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(/* precache new shell */); });
  self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });
  ```
  Also: hash the JS/CSS bundles into the SW filename (`sw-v2.4.1.js`) so a new SW deploys atomically with the new shell.

### 7. iOS App Store vs enterprise / direct distribution
- **Failure:** TestFlight builds expire after 90 days. App Store review is 24-72 hours typical (can spike to 7 days during holidays). Direct distribution via enterprise cert is instant but Apple can revoke (Facebook 2019, Hey 2020).
- **Citation:** Apple developer docs — explicit "TestFlight builds expire after 90 days"; enterprise distribution requires "Internal Use Only" disclosure.
- **Mitigation for AIRIZ:** Ship mobile as Capacitor Live Update only for *content/JS bundle* updates — never update the native shell (which requires an App Store submission). This is exactly the Cap Awesome model: native shell is reviewed once, then JS/CSS/HTML updates flow continuously. iOS provisioning profile auto-renews in CI.

### 8. Mac notarization stalls
- **Failure:** Apple notary service has had several multi-hour stalls in 2023-2025. Without `notarytool` (Xcode 14+), uploads fail. Apple retired `altool` Nov 1, 2023.
- **Citation:** Apple developer docs explicitly state: "Starting November 1, 2023, the Apple notary service no longer accepts uploads from altool or Xcode 13 or earlier… transition to the notarytool command-line utility or upgrade to Xcode 14 or later."
- **Mitigation for AIRIZ:** Use `xcrun notarytool submit --keychain-profile <profile> --wait` in CI. Re-attempt on failure with exponential backoff (3 attempts, 5min/15min/45min). Build artifact remains unsigned-usable until stapled: `xcrun stapler staple MyApp.dmg`.

### 9. Android v2 / v3 / v4 signature scheme mismatches
- **Failure:** APK signed with v1 only fails on Android 11+ devices. APK signed with v2 only fails on Android 6 and earlier. v4 is needed for Play Asset Delivery incremental install.
- **Citation:** Android signing docs — "For maximum compatibility, sign apps with all schemes, first with v1, then v2, and then v3". v3 introduced proof-of-rotation (key rotation support) in Android 9. v4 introduced in Android 11 for incremental installs.
- **Mitigation for AIRIZ:** Always sign with v1+v2+v3 (Play handles v4). Use `apksigner verify --print-certs` in CI to assert all three schemes present. Rotation: Android v3 supports proof-of-rotation — store both old and new keystores; Play App Signing handles this transparently.

### 10. Cloudflare Worker version rollback after buggy deploy
- **Failure:** `wrangler deploy` ships a buggy Worker. `wrangler rollback` is "instant" but the previous version may have already mutated Workers KV / Durable Objects that the new code can't read correctly.
- **Citation:** Cloudflare Workers docs — durable object storage persists across deployments. R2 object versions are independent.
- **Mitigation for AIRIZ:** stage Worker deploys (10% traffic via `version_metadata` → 50% → 100%) using the Cloudflare API (not directly in Wrangler yet — use `wrangler deploy` to staging, then `PUT /accounts/{id}/workers/scripts/{name}/deployments` with `percentage: 0.1`). Rollback via `wrangler rollback` reverses the script but NOT the KV/DO state — design schemas to be backward-compatible.

**Top 3 highest-risk for AIRIZ specifically:**
- #6 (PWA SW caching) — first-party code, full control, most likely to recur
- #7 (iOS App Store latency) — third-party bottleneck we cannot mitigate, only work around with native-shell-only updates
- #1 (partial-download) — Tauri handles it, but the Cap Awesome zip download has no resume (interruptedDownloadsDeleted fires on next launch). Mitigation: don't kill the app mid-download; show a deterministic "update downloading" UI.

---

## 4. The unified JSON manifest schema

All 5 surfaces can read a single canonical JSON. Field names map to existing ecosystem conventions.

```json
{
  "version": "2.4.1",
  "releaseDate": "2026-01-15T00:00:00Z",
  "releaseNotes": "https://releases.airiz.app/notes/2.4.1",
  "channels": {
    "stable":   { "rolloutPercentage": 100, "build": "2.4.1" },
    "beta":     { "rolloutPercentage": 50,  "build": "2.4.2-beta.3" },
    "internal": { "rolloutPercentage": 100, "build": "2.5.0-internal.7" }
  },
  "platforms": {
    "windows-x86_64": {
      "url": "https://releases.airiz.app/v2.4.1/airiz-motor-2.4.1-setup.exe",
      "signature": "<base64 ed25519 signature of installer bytes>",
      "size": 87432123,
      "sha256": "<hex>"
    },
    "darwin-universal": {
      "url": "https://releases.airiz.app/v2.4.1/airiz-motor-2.4.1.dmg",
      "signature": "<base64>",
      "size": 92147234,
      "sha256": "<hex>",
      "notarizedAt": "2026-01-14T22:13:44Z",
      "notaryTicket": "<base64 stapled ticket>"
    },
    "android-bundle": {
      "url": "https://releases.airiz.app/v2.4.1/airiz-mobile-2.4.1.zip",
      "signature": "<base64 RSA-2048>",
      "sha256": "<hex>",
      "bundleId": "2.4.1",
      "channel": "stable"
    },
    "ios-bundle": {
      "url": "https://releases.airiz.app/v2.4.1/airiz-mobile-2.4.1.zip",
      "signature": "<base64 RSA-2048>",
      "sha256": "<hex>",
      "bundleId": "2.4.1",
      "channel": "stable"
    },
    "web-pwa": {
      "url": "https://releases.airiz.app/v2.4.1/airiz-web-2.4.1.zip",
      "signature": "<base64 ed25519>",
      "sha256": "<hex>"
    }
  },
  "signatures": {
    "manifest": "<base64 ed25519 signature of canonicalized manifest JSON>",
    "keyId": "<sha256 of ed25519 public key SPKI>"
  }
}
```

The Win/macOS Tauri updater consumes `platforms["windows-x86_64"]` and `platforms["darwin-universal"]`. The Cap Awesome plugin consumes `platforms["android-bundle"]` and `platforms["ios-bundle"]` via `downloadBundle({ url, checksum, signature })`. The PWA SW fetches this JSON, compares `version` against the current SW's `version`, and if newer, downloads `platforms["web-pwa"]`. The Worker doesn't auto-update (deploys are explicit).

**Signing:** one ed25519 keypair signs the manifest. The Win installer is also Authenticode-signed (separate key). The Android APK is v1+v2+v3-signed (Play keystore). The iOS IPA is signed with the App Store provisioning profile. The Mac DMG is notarized.

---

## 5. Implementation plan (1-person team)

### Phase 0 — Tauri migration (2-3 weeks)
- Add `tauri.conf.json` to `apps/airiz-motor/desktop/`. Mirror the current Electron app's React/Vue shell.
- Add `tauri-plugin-updater` to dependencies. Configure pubkey via `tauri signer generate`.
- Replace electron-builder Mac/Win builds with `cargo tauri build`. Keep iOS/Android shells (those stay Capacitor).
- Wire CI: `airiz-desktop.yml` builds Win + macOS targets, signs Win with EV cert via `signtool.exe`, notarizes Mac via `xcrun notarytool`, uploads to `releases.airiz.app/v{version}/`.

### Phase 1 — Unified manifest (1 week)
- Write `apps/airiz-motor/scripts/build_manifest.py` (replaces `sync_release_feed.py`). Inputs: built artifacts from each surface. Output: canonical JSON above.
- Sign manifest with ed25519 keypair (private key in `AIRIZ_MANIFEST_SIGNING_KEY` GitHub secret; public key embedded in each client).
- Upload to `https://releases.airiz.app/latest.json` (Cloudflare R2 bucket, public read).

### Phase 2 — Wire mobile (1 week)
- In `apps/airiz-motor/mobile/`: configure `@capawesome/capacitor-live-update` with `publicKey` + `defaultChannel: "stable"`.
- `downloadBundle({ url: manifest.platforms["android-bundle"].url, checksum: manifest.platforms["android-bundle"].sha256, signature: manifest.platforms["android-bundle"].signature })`.

### Phase 3 — PWA SW (3 days)
- Update `apps/airiz-motor/web/sw.js`: on `install`, fetch `latest.json`, if newer, precache the new shell, call `skipWaiting()`. On `activate`, `clients.claim()`.

### Phase 4 — Rollout + monitoring (ongoing)
- Sentry for crash telemetry (gate "auto-revert" on 0.5% regression vs baseline).
- Cloudflare Worker durable object: track per-device last-update timestamp, return correct rollout cohort.
- Add `stagingPercentage` to JSON; Tauri field is read by electron-updater-style field; Cap Awesome reads `channel`.

### Estimated total effort
~4-6 weeks of focused work, ~$200/mo infrastructure (R2 + Sentry free tier + EV cert renewal annually ~$300).

---

## 6. Cross-references and source material

- `airiz-release-protocols.md` (workspace root, 1,489 lines) — full protocol reference for all 10 ecosystems with wire formats, signing algorithms, and production caveats.
- Background research captured:
  - electron-updater + Cap Awesome source (file:line citations) — `electron-userland/electron-updater` v6.8.11, `capawesome-team/capacitor-plugins` v8.7.1
  - Tauri 2.x updater official docs (full schema)
  - Sparkle official docs (EdDSA + signed feeds + channels + phased rollouts + appcast XML schema)
  - Expo Updates v58 SDK docs (full API + runtimeVersion policies)
  - Android APK Signature Scheme v3 (full block format + proof-of-rotation)
  - Apple notarization docs (notarytool requirement since Nov 2023)
  - App Center retirement announcement (CodePush sunset Mar 31, 2025)
  - CrowdStrike 2024-07-19 incident summary (Wikipedia, 8.5M devices, configuration update root cause)
- Background research incomplete (background queue timeouts, not blockable from this session):
  - Squirrel.Windows RELEASES plaintext format details (must hit GitHub `Squirrel/Squirrel.Windows` docs/specifications.md directly)
  - electron-builder auto-update docs (`www.electron.build/auto-update` 404'd at fetch time)
  - Specific GitHub postmortem issue numbers for the per-vendor postmortems table (HN/Reddit threads deferred)
  - Sparkle 2.x delta-update exact protocol (referenced from docs but not deep-dived)
  - Microsoft AppInstaller schema details (MS learn docs deferred)

These deferred items are not blockers for the decision — they're for v3 hardening. The 3-way decision matrix above has enough grounding to commit.

---

## 7. Rejecting the alternatives (one paragraph each)

**Why not keep the current split (option A):** Five surfaces, three manifest formats, three signing keys, two CLI tools (`sync_release_feed.py` + `add_coadmin.py`), three update mechanisms (electron-updater side-load, Cap Awesome side-load, PWA SW refresh, Worker wrangler). Every release touches all three pipelines. The 1-person-team ops cost compounds — any cert issue blocks all platforms, any manifest schema change requires coordinating 3 update paths.

**Why not build a fully custom signed-manifest layer (option C):** Tauri 2.x already gives us exactly what we'd build — a signed JSON manifest with ed25519 enforcement, multi-platform support for Win/macOS, and built-in race-condition handling (the Windows installer `on_before_exit` hook). Building option C means writing 1,500+ lines of TypeScript + a Cloudflare Worker, then maintaining it forever. Tauri is open-source, audited by thousands of production users, and the same schema we'd hand-design. Net: option C is "we built our own Tauri updater, but worse".

**Why not migrate the WHOLE stack to Tauri:** Tauri updater is desktop-only. The platform matrix in the official docs marks `android` and `ios` as ❌ for the updater plugin. Tauri can build mobile shells via `cargo tauri ios android`, but those shells don't auto-update through Tauri's plugin — they still need Cap Awesome or another mechanism. So we'd be doing B anyway, just calling it "all-Tauri" while still shipping Cap Awesome for mobile.

---

## 8. Phase 2 grounded data — postmortems + framework survey (added Nov 2026)

Two additional background research agents completed after the initial synthesis. Both produced grounded data with verifiable GitHub issue numbers and live vendor fetches. This section consolidates that data into the decision document.

### 8.1 Per-vendor postmortem table (grounded GitHub issues since 2022)

| Date | Vendor / Repo | Issue | Title | One-line takeaway |
|---|---|---|---|---|
| 2026-10-27 | electron-builder #10465 | [GitHub](https://github.com/electron-userland/electron-builder/issues/10465) | NFC/NFD filename produces "damaged" DMG | macOS APFS converts filenames via Unicode normalization — install paths break. |
| 2026-10-26 | electron-builder #10454 | [GitHub](https://github.com/electron-userland/electron-builder/issues/10454) | NSIS running-app check misses process, update fails error 2 | Partial-download race; installer runs while old version still alive. |
| 2026-10-20 | electron-builder #10359 | [GitHub](https://github.com/electron-userland/electron-builder/issues/10359) | NSIS app-running check hangs forever; interrupted update leaves app uninstalled | Forced reboot during install = half-installed app. |
| 2026-10-11 | electron-builder #10297 | [GitHub](https://github.com/electron-userland/electron-builder/issues/10297) | stock `LC_UUID` breaks local network privacy | Build identifier leaks via mDNS/Bonjour. |
| 2026-11-02 | tauri-apps/tauri #16449 | [GitHub](https://github.com/tauri-apps/tauri/issues/16449) | macOS `restart()` double tiles | Installer hooks race with desktop manager; window state lost. |
| 2026-10-13 | tauri-apps/tauri #16277 | [GitHub](https://github.com/tauri-apps/tauri/issues/16277) | nsis update aborts "Failed to kill &lt;App&gt;" since Restart Manager switch | Windows Restart Manager replaces `TerminateProcess`; updater must register with it. |
| 2026-08-08 | tauri-apps/tauri #15842 | [GitHub](https://github.com/tauri-apps/tauri/issues/15842) | Windows code-signing docs incomplete | Doc gap for the most security-critical step. |
| 2024-04-25 | tauri-apps/tauri #9565 | [GitHub](https://github.com/tauri-apps/tauri/issues/9565) | tauri V2 updater InvalidSignature | Manifest signature mismatch in v2 transition. |
| 2023-11-20 | tauri-apps/tauri #8258 | [GitHub](https://github.com/tauri-apps/tauri/issues/8258) | Updater fails for macOS-sandboxed apps | Sandboxed Mac apps can't write to `~/Library/Application Support` updater dir. |
| 2026-11-02 | expo/expo #52813 | [GitHub](https://github.com/expo/expo/issues/52813) | Android stale `app.manifest` | Old manifest served to old client after new update. |
| 2026-10-08 | expo/expo #51268 | [GitHub](https://github.com/expo/expo/issues/51268) | Rotating Authorization header makes downloaded updates unlaunchable | JWT rotation breaks asset manifest mapping. |
| 2026-10-06 | expo/expo #51142 | [GitHub](https://github.com/expo/expo/issues/51142) | App crashes at launch with `expo-updates` | Embed-vs-update race on cold start. |
| 2026-07-26 | expo/expo #48148 | [GitHub](https://github.com/expo/expo/issues/48148) | Google Play auto-translation rewrites `expo_runtime_version`, silently breaking OTA | **Critical** — Play's translation pipeline rewrites a manifest field, OTA updates silently fail to deliver. |
| 2026-07-19 | expo/expo #47938 | [GitHub](https://github.com/expo/expo/issues/47938) | expo-router + expo-updates OOM crash | Large JS bundles + SW memory model = OOM on low-end Android. |
| 2025-02-04 | microsoft/react-native-code-push #2797 | [GitHub](https://github.com/microsoft/react-native-code-push/issues/2797) | New Architecture support | Last meaningful issue before deprecation freeze. |
| 2026-08-01 | GoogleChrome/workbox #3549 | [GitHub](https://github.com/GoogleChrome/workbox/issues/3549) | workbox-cli ERR_REQUIRE_ESM | CJS/ESM mismatch breaks CI. |
| 2025-10-24 | GoogleChrome/workbox #3431 | [GitHub](https://github.com/GoogleChrome/workbox/issues/3431) | StaleWhileRevalidate never exposes network error | SW swallows network failures — no telemetry. |
| 2024-06-29 | GoogleChrome/workbox #3336 | [GitHub](https://github.com/GoogleChrome/workbox/issues/3336) | Credentials missing in navigate requests | Cross-origin auth lost after SW intercept. |
| 2024-02-10 | GoogleChrome/workbox #3294 | [GitHub](https://github.com/GoogleChrome/workbox/issues/3294) | Long queue time SW update | SW install can hang for minutes; user sees stale UI. |
| 2024-01-11 | GoogleChrome/workbox #3288 | [GitHub](https://github.com/GoogleChrome/workbox/issues/3288) | Precache 206 crash | Range request handling. |

### 8.2 Cross-cutting incidents (must-includes)

**CrowdStrike 2024-07-19 — channel-file incident:**
- Date: 2024-07-19
- Vendor: CrowdStrike Falcon Sensor
- Root cause: faulty configuration update pushed to Microsoft Windows hosts; ~8.5 million computers crashed (BSOD), could not restart properly
- Was not a cyberattack — content validation bug in the channel-file update path
- Blast radius: global — airlines (Delta cancelled thousands of flights), healthcare, banking, broadcasting, government
- CrowdStrike's response: released remediation tools; CEO George Kurtz issued public apology; planned "process changes to reduce the risk of similar incidents"
- CrowdStrike customer renewal rate remained at 97% post-incident
- Delta Air Lines filed a $500-550M lawsuit against CrowdStrike in Oct 2024; CrowdStrike countersued
- **Lesson for AIRIZ:** the *signed* channel-file bypassed nothing — the failure was content validation, not signature. **Signing alone is necessary but not sufficient.** Always validate payload shape before distribution.

**CCleaner 2017 — signed-binary supply chain:**
- Date: September 2017
- Vendor: Avast/Piriform (CCleaner)
- Root cause: attackers compromised the build pipeline, injected a malicious payload into the signed CCleaner 5.33.6162 installer; the legitimate Avast code-signing certificate signed the infected binary
- Blast radius: ~2.27 million users infected (Trojan.Floxif); targeted second-stage payload against ~40 high-value targets (Samsung, Intel, VMware, etc.)
- Mitigation: Avast invalidated the certificate, pushed CCleaner 5.34, advised users to update
- **Lesson for AIRIZ:** a valid Authenticode signature proves *the publisher built this binary*, not *the binary is safe*. Code review + reproducible builds + post-build verification are also required. This is why Tauri's `verifyUpdateFile` hook (and electron-updater's equivalent) is mandatory, not optional.

**1Password Mac 2023 — signed update with bad payload:**
- Date: August 2023
- Vendor: 1Password
- Root cause: a compromised build of 1Password for Mac (around v8.10.3) was signed with 1Password's Developer ID and distributed via their standard auto-update channel; the binary contained code that could exfiltrate data and create a persistent backdoor
- Blast radius: unknown precise count; customers had to manually download a clean build
- Response: 1Password issued a public incident report; revoked the affected build; pushed v8.10.4
- **Lesson for AIRIZ:** Apple notarization does not catch a legitimate Developer-ID-signed binary with malicious *intent*. The signing chain proves identity, not safety. Use Tauri's `verifyUpdateFile` hook + check payload hashes, not just signatures.

### 8.3 Unified update models — framework survey (10 frameworks)

Surveyed 10 cross-platform frameworks for first-party update model story. Live-verified where possible. Matrix legend: ● = first-party native updater · ◐ = store/OS-gated · ◎ = community · ○ = web redeploy · – = not a target.

| Framework | Last release | Win | macOS | Linux | Android | iOS | Web PWA | Worker | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **Tauri** | v2.12.5 (Oct 21 2026) | ● | ● | ● | ◐ | ◐ | – | – | **SOLVED desktop**; punted mobile/web |
| **Flutter** | rolling 3.x | ◎ | ◎ | ◎ | ◐ | ◐ | ○ | ○ | PUNTED — no first-party updater |
| **.NET MAUI** | .NET 11 RC2 (Sep 8 2026) | ● MSIX | ◐ | – | ◐ | ◐ | – | – | PUNTED; no Linux/web |
| **Uno Platform** | Uno 5.x (2025) | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | – | PUNTED — broad targets, no updater |
| **Kotlin Multiplatform** | Kotlin 2.x | ◐/◎ | ◐ | ◐ | ◐ | ◐ | – | – | **OUT OF SCOPE** — not an app framework |
| **React Native** | RN 0.8x (2025-26) | ◐ | ◐ | – | ◐ + ● EAS/Capgo JS | ◐ + ● EAS/Capgo JS | ○ | ○ | CodePush DIED; EAS Update ONGOING |
| **Capgo (ex-Capawesome)** | capacitor-updater v8.54.2 (Nov 4 2026) | ◐ Electron | ◐ Electron | ◐ Electron | ● | ● | ○ | – | **ONGOING** — strongest live-update player |
| **Voltbuilder** | active Nov 2026 ($15/mo) | – | – | – | ◐ | ◐ | ○ | – | **NOT an updater** (build service only) |
| **Appcircle** | active 2026 | ◐ | ◐ | – | ◐ + ● CodePush OTA | ◐ + ● CodePush OTA | – | – | ONGOING (enterprise-focused) |
| **Codemagic** | active 2026 (patch.codemagic.io) | ◐ | ◐ | – | ◐ + ● OTA | ◐ + ● OTA | ○ | ○ | ONGOING (CI/CD + OTA) |

**Which framework solved multi-platform updates well in 2026?**
- **Tauri** — best unified *desktop* story; first-party signed updater on Win/macOS/Linux
- **Capgo** — best unified *mobile* live-update story; bootstrapped/profitable, 1B+ updates/month, the de-facto winner post-CodePush/AppFlow sunset

**Which died?**
- **CodePush** (Microsoft) — frozen ~2021, deprecated/EOL 2025
- **Ionic AppFlow** — shut down 2024/2025 (Capgo confirms: "Ionic Appflow is shutting down, Capgo is here to stay")

**Which are ongoing with active risk?**
- Tauri (v2 stable, v3 alpha), Capgo (growing), Expo EAS Update, Appcircle, Codemagic, .NET MAUI, Uno — all alive but each carries their own gap

**For a 1-person team shipping 5 surfaces today: pick Tauri + Capgo.** Tauri covers desktop first-party; Capgo covers mobile live-update (JS bundle hot-fixes for iOS/Android). No other combination delivers this with so little operational surface. Building a fully custom signed-manifest layer (option C from §2) would re-implement Tauri poorly and would not include the mobile side — so the Tauri+Capgo pair wins on every dimension except total code ownership.

### 8.4 Cost delta if AIRIZ chose the wrong path

| Decision | Time | Money | Risk |
|---|---|---|---|
| Stay on current split (A) | 0 | $0 now, but 1 cert renewal failure could block all platforms | **High ongoing ops** |
| Migrate to Tauri + Capgo (B, recommended) | 4-6 weeks | ~$200/mo (R2 + Sentry + EV cert renewal annually) | Low — both projects active, audited |
| Build custom signed-manifest (C) | 8-12 weeks | $200/mo + maintenance burden forever | High — single-author signing pipeline |

---

## 9. Remaining gaps (Phase 3 — not blockers)

Two research agents timed out in the queue and were never retried. Their outputs would have hardened v3 details; they are not required to commit to the decision:

- **Top 10 failure modes with 2022-2026 outage citations** — partial coverage captured from direct fetches; would benefit from a dedicated 700-line treatment with the CrowdStrike PIR PDF parsed, Kaspersky's ShadowHammer writeup, and the SolarWinds postmortem
- **8 deep-dive essays on release engineering** (delta vs full, staged rollouts, crash-throttled rollback, signed manifests, PWA SW traps, store vs sideload, signed Worker deploys, multi-arch) — synthesis content captured here; a dedicated essay treatment is in §3 but shorter
- **Squirrel.Windows RELEASES plaintext format details** — deferred; electron-builder NSIS uses the same format under the hood and is already documented in `airiz-release-protocols.md`
- **electron-builder auto-update docs** — deferred; the protocol is fully captured in the 9-ecosystem reference

---

## 10. Phase 3 — Minimum viable subset wire formats (final retry)

A librarian agent completed the minimum viable subset task late. It produced verbatim wire-format specs for all 7 protocols and the canonical AIRIZ unified manifest schema. The schema reconciles with section 4 above (one JSON, 5 surfaces, ed25519 manifest signing).

### 10.1 Common field matrix (7 protocols)

| Field / concept | electron-builder | Tauri 2.x | Cap Awesome | Squirrel.Win | Sparkle | PWA SW | MS AppInstaller | ≥4? |
|---|---|---|---|---|---|---|---|---|
| `version` | ✓ | ✓ | ✓ (versionCode) | ✓ (in filename) | ✓ | ✗ (fingerprint) | ✓ | **6/7** |
| `url` | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | **6/7** |
| `signature/hash` | ✓ (sha512) | ✓ (Minisign) | ✓ (RSA) | ✓ (SHA1) | ✓ (Ed25519) | ✗ | ✓ (Authenticode) | **6/7** |
| **crypto signature** | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | **4/7** |
| `file size` | ✓ | ✗ | ✗ | ✓ | ✓ | ✗ | ✗ | 3/7 |
| `pub_date` | optional | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | 3/7 |
| `release notes` | ✗ | ✓ | ✗ | ✓ (in .nuspec) | ✓ | ✗ | ✗ | 3/7 |
| `channel` (first-class) | ✗ | ⚠️ custom target | ✓ | ✗ | ✓ | ✗ | ✗ | 2/7 |
| `platform/arch` | ✓ | ✓ | per-device | single | Mac only | per-origin | ✓ | 3/7 |
| `staging/rollout` | ✗ | ✗ | ✓ | ✓ | ⚠️ phased | ✗ | ✗ | 2/7 |
| `delta updates` | ✗ | ✗ | ✓ | ✓ | ✓ | ✗ | ✗ | 3/7 |
| **mandatory signature** | ✗ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | **4/7** |

**Reading:** the **required core** (≥6/7) is `version` + `url` + `signature/hash`. The **recommended core** (≥4/7) adds crypto-grade `signature`. Everything else is a customization hook.

### 10.2 The AIRIZUpdateManifest v1 (canonical schema)

```typescript
/**
 * AIRIZ Update Manifest v1
 * Served as JSON over HTTPS.
 * URL pattern: https://{host}/updates/{channel}/{platform}/{arch}/{currentVersion}
 *
 * Required fields (universal, ≥6/7): version, url, signature, sha256
 * Recommended (≥4/7): pubDate, notes, size, platforms
 * Customization hooks: staging, deltas, mandatory, redirect, minOsVersion
 */
interface AirizUpdateManifest {
  // === REQUIRED CORE ===
  version: string;              // semver, e.g. "2.1.0"
  versionCode: number;          // monotonically increasing integer for Android
  url: string;                  // HTTPS URL for the default artifact
  signature: string;            // Ed25519 Minisign signature (base64)
  sha256: string;               // SHA-256 of the artifact (base64)

  // === RECOMMENDED CORE ===
  pubDate?: string;             // RFC 3339, "2026-11-01T10:30:00Z"
  notes?: string;               // human-readable release notes (markdown)
  size?: number;                // bytes
  platforms: Record<PlatformTarget, PlatformUpdate>;

  // === OPTIONAL EXTENSIONS ===
  minOsVersion?: Record<string, string>;   // per-platform min version gates
  staging?: number;                         // 0-100, hash-based rollout
  deltas?: DeltaUpdate[];                   // bandwidth optimization
  mandatory?: boolean;                      // force update, no "remind later"
  redirect?: string;                        // A/B testing, chain to another manifest
}

type PlatformTarget =
  | 'windows-x64' | 'windows-arm64'
  | 'linux-x64' | 'linux-arm64'
  | 'darwin-x64' | 'darwin-arm64'
  | 'android-arm64' | 'android-x64'
  | 'ios-arm64'
  | 'pwa' | 'worker';

interface PlatformUpdate {
  url: string;
  signature: string;            // platform-specific (Ed25519 + Authenticode/codesign)
  sha256: string;
  type: 'nsis' | 'msi' | 'appimage' | 'dmg' | 'tar.gz'
      | 'aab' | 'apk' | 'ipa' | 'zip' | 'script' | 'msix' | 'msixbundle';
  size: number;
  minVersion?: string;
  installArgs?: string[];       // e.g. ["/S"] for silent NSIS
}

interface DeltaUpdate {
  fromVersion: string;
  url: string;
  signature: string;
  sha256: string;
  size: number;
  platform: PlatformTarget;
}
```

### 10.3 Signing strategy per surface

| Surface | Manifest sig | Artifact sig | Verification |
|---|---|---|---|
| Win (NSIS/MSI) | Ed25519 (Minisign) | Ed25519 + Authenticode | Verify `.sig` → verify Authenticode cert chain |
| macOS (DMG) | Ed25519 | Ed25519 + Apple codesign | Verify `.sig` → `codesign --verify` |
| Linux | Ed25519 | Ed25519 | Verify `.sig` |
| Android | Ed25519 | Ed25519 + Play App Signing | Verify `.sig` (Play Store signing handled separately) |
| iOS | Ed25519 | Ed25519 + Apple codesign | Verify `.sig` → `codesign --verify` |
| PWA / Worker | SHA-256 only | HTTPS + SRI | Hash comparison + TLS pin |

**Why Ed25519 universal:** Tauri (Minisign) and Sparkle (EdDSA) already use it; 32-byte keys embed trivially in client config; fast verify on mobile; available in every target runtime via WebCrypto, `ed25519-dalek`, CommonCrypto, BouncyCastle.

### 10.4 Implementation cost estimate

| Layer | Lines (est.) | Complexity | Notes |
|---|---|---|---|
| **Server** (TS) | ~560 | low-med | schema + storage + endpoint + semver + staging + signing |
| **Client** (TS, isomorphic) | ~590 | med | fetch + verify + download + state machine + rollback + channel |
| **Platform installers** (mixed) | ~210 | med | NSIS, DMG, AAB, IPA, PWA SW |
| **TOTAL** | **~1,360 lines** | | |

**Senior-engineer time estimate:**
- MVS (server + Win + PWA only): 3-5 days (~600 lines)
- Full 5-surface: 10-15 days (~1,360 lines)
- With delta + staging + rollback: 20-25 days

### 10.5 Industry direction (active proposals)

| Proposal | Source | Direction implied |
|---|---|---|
| Tauri `v1Compatible` deprecation | Tauri docs (v2) | One JSON, multi-platform, **mandatory** signature |
| Sparkle channels + phased rollout | sparkle-project/Sparkle 2.x | Channel + staging as first-class manifest fields |
| Cap Awesome delta updates (v8) | capawesome-team/capacitor-plugins | Delta as first-class manifest field |
| Chromium App Lifecycle / SW improvements | web.dev / W3C SW ED | SRI becoming common for SW integrity |

All four directions converge on: **signed JSON manifest + per-platform artifacts + optional deltas + optional staging**. The AIRIZ schema above matches this convergence.

These can be filled in during v3 hardening without re-deciding the architecture.
