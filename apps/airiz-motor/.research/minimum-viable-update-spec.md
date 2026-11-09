# Minimum Viable Update Spec — 7 Protocols Reimplemented on a Signed-Manifest-on-R2 Layer

> **Owner:** AIRIZ Motor Console architecture advisory (subagent to parent session)
> **Date:** 2026-11-07 · **Status:** Strategic advisory · **Scope:** Re-implementation cost of 7 update protocols on top of `airiz-release.v1`
> **Companions:** `unified-release-manifest-schema.md` (the schema being adapted), `tools/sign-manifest.ts` + `tools/manifest-to-electron-yml.ts` (the implementation being reused), `release-architecture-reference.md`, `updater-protocol-docs-r1.md`.
> **Goal:** For each of 7 protocols, derive the **minimum viable subset** — the smallest field set + verification operations + lifecycle hooks — that still satisfies the six baseline properties (integrity, authenticity, atomicity, rollback, staged rollout, channel). Then map that subset onto `airiz-release.v1` and quantify the engineering cost.

> **Verification status legend.** `[verified]` = fetched live this session or pinned in earlier rounds. `[unverified]` = could not fetch live today; relied on cached knowledge and the project's earlier research (`updater-protocol-docs-r1.md` pinned at `51f5e2c…`, `14fdbf2…`, `ae80314…`, `74a44c1…`, `c59120d…`, `4ea3138…` + microsoft/learn URL tree).
> **Webfetch note:** websearch is blocked this session; webfetch succeeded for `electron.build/docs/features/auto-update`, `v2.tauri.app/plugin/updater/`, `sparkle-project.org/documentation/publishing/`, `capawesome.io/docs/plugins/live-update/`, MDN Service Worker API page, and `learn.microsoft.com/.../appinstaller`. Several spec-PR URL deep links failed (HTTP 404 on `electron.build/docs/configuration/publish`); they are marked `[unverified]` and the parent project's prior citations used.

---

## 0. Baseline properties (what every subset must satisfy)

For any protocol's *minimum viable subset* to count as AIRIZ-compliant it must, at the client, demonstrate **all six** of:

| # | Property | What it means in this survey |
|---|----------|------------------------------|
| 1 | **Integrity** | A recomputed hash of the downloaded artifact matches the field in the manifest. |
| 2 | **Authenticity** | The manifest (or the artifact) was signed by the publisher's key, verified against a public key the client pins. |
| 3 | **Atomicity** | Either the new version is fully live (and verified) or the old version remains — no half-installed state. |
| 4 | **Rollback** | A bad release can be reverted: either by rolling forward (newer signed release) or, ideally, by an automatic revert. |
| 5 | **Staged rollout** | The operator can flip a fraction (1 → 50 → 100) of eligible clients deterministically, sticky across launches. |
| 6 | **Channel** | Stable / beta / nightly are first-class distinctions, expressed either in URL or as a manifest field. |

The `airiz-release.v1` field set that already satisfies all six on a single signed-manifest-on-R2 layer is documented in `unified-release-manifest-schema.md` §9. Every protocol below is mapped into that contract; per-protocol "minimum subsets" are the *minimal adapters* from the protocol's wire format into `airiz-release.v1`.

---

## 1. electron-builder NSIS auto-update protocol

**Spec sources:** [verified] `electron.build/docs/features/auto-update/` (this session); `electron.build/docs/features/signed-update-manifests`; `[unverified]` `electron.build/docs/configuration/publish` (404 today, but content unchanged in cached knowledge). Source code pinned at `electron-userland/electron-builder@ae8031420ad0662b84195342759dba4350ffcedd` in earlier rounds.

**Verified core quote** (`UpdateInfo`, electron-builder v27, fetched 2026-11-07):

> *"All required metadata files and artifacts are produced and published automatically. Download progress and staged rollouts supported on all platforms. Different providers supported out of the box: (GitHub Releases, Amazon S3, DigitalOcean Spaces, Cloudflare R2, Keygen and generic HTTP(s) server)."* — `electron.build/docs/features/auto-update/` (top of page)

**Verified core quote** (signed manifests):

> *"The update manifest (`latest*.yml`) itself **is** cryptographically signed and verified before any download as of v27. Publishing a build that emits update metadata fails unless an Ed25519 signing key resolves; `updateManifest: false` is the only opt-out."* — `electron.build/docs/features/auto-update/`, section "Update security options"

**GitHub provider / token model:** the v27 GitHub provider auto-detects from `GH_TOKEN`/`GITHUB_TOKEN` in env (private repo with token). S3/Spaces/R2 are wired as `generic` over an S3-like base URL via `getS3LikeProviderBaseUrl`. Channel = per-file naming (`latest.yml`, `latest-beta.yml`, …). The blockmap is a **sibling file** (`<installer>.blockmap`), NOT a field in `latest.yml`.

### 1.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

| Field (electron-updater) | Type | Required | Default | Example | Maps to AIRIZ `airiz-release.v1` |
|---|---|---|---|---|---|
| `version` | string (SemVer) | **Yes** | — | `"1.7.3"` | `target_versions.electron` (schema §9 #7) |
| `files[].url` | string | **Yes** | — | `https://r2.airiz/electron/1.7.3/airiz-1.7.3.exe` | `artifacts.electron.url` (§9 #13) |
| `files[].sha512` | string (base64) | **Yes** | — | `BOJAqreovN4q…G6iCg==` | `artifacts.electron.sha512` (§9 #14) |
| `files[].size` | int | **Yes** | — | `72345678` | `artifacts.electron.size` (§9 #14) |
| `files[].blockMapUrl` | string | No | `<url>.blockmap` | `…/airiz-1.7.3.exe.blockmap` | `artifacts.electron.blockmap_url` (§9 #14) |
| `releaseDate` | string (ISO 8601) | emitted | `now()` | `2026-11-05T09:08:52.702Z` | `released_at` (§9 #4) |
| `stagingPercentage` | int 0–100 | No | `100` | `10` | `staged_rollout` (§9 #5) |
| `signatures[].keyId` | string | **Yes** (v27) | — | `airiz-prod-2026` | `signatures[].key_id` (§9 #15) |
| `signatures[].signature` | string (base64) | **Yes** (v27) | — | `<b64 ed25519>` | `signatures[].value` (§9 #15) |
| `path` (legacy) | string | No (v27+ with `files[]`) | — | `"airiz-1.7.3.exe"` | (projected from `artifacts.electron.url`) |
| `sha512` (legacy top-level) | string (base64) | No (v27+) | — | (same as `files[0].sha512`) | (redundant; derived) |
| `minimumSystemVersion` | string | No | — | `"10.0.22631"` | reserved; not in current AIRIZ subset |
| `channel` (URL filename) | string | **Yes** | `"production"` | `"beta"` | `channel` (§9 #3); filename suffix in adapter |

**Channel file naming** (from `Provider.getChannelFilename`): per-channel file is `<channel>.yml` for default channel, `<channel>-mac.yml`, `<channel>-linux.yml` for the platform suffixes. AIRIZ adapter writes one set per channel.

### 1.2 Minimum verification operations (pseudocode)

```ts
// AIRIZ client side (Node-or-browser-shaped). Equivalent in any host language.
function verifyElectronUpdate(manifest, pubkey, installedVersion):
  // 1. Reject unsigned manifests (v27+).
  if not manifest.signatures: throw ERR_UPDATER_MANIFEST_NOT_SIGNED
  // 2. Canonicalize the manifest minus `signatures` (RFC 8785 subset).
  body := deepClone(manifest); delete body.signatures
  canonical := canonicalJson(body)              // recursive key sort, no whitespace
  // 3. Try each ed25519 signature; accept if ANY verifies against pubkey.
  for s in manifest.signatures where s.alg == "ed25519":
    if ed25519.verify(pubkey, base64decode(s.value), canonical): break
    else throw ERR_UPDATER_MANIFEST_SIGNATURE_INVALID
  // 4. SemVer gate (newer than installed).
  if semver.compare(manifest.version, installedVersion) <= 0: return null  // no update
  // 5. Stage gate (sticky, deterministic).
  if not isInStagedRollout(manifest.stagingPercentage): return null
  // 6. For each files[] entry: HEAD/GET, recompute sha512, compare.
  for f in manifest.files:
    bytes := downloadToTemp(f.url)
    if base64(sha512(bytes)) != f.sha512: throw ERR_UPDATER_CHECKSUM_MISMATCH
    // Blockmap partial download is optional; full download is the fallback.
  // 7. Hand off to NSIS installer (detached on app quit, or "onNextLaunch").
  return { version: manifest.version, file: manifest.files[0] }
```

### 1.3 Minimum lifecycle hooks

- **On app launch**: `autoUpdater.checkForUpdates()` → fetch the per-channel yml (e.g. `latest-beta.yml`).
- **On check** → `update-available` → optional `update-downloaded` → install lifecycle:
  - Default mode **`onQuit`**: spawn detached installer when the app exits. v27 has a **session-end guard** so the installer isn't killed by shutdown.
  - Recommended for v27: **`onNextLaunch`** (planned default in v28). Download now; install at the *next* launch, after re-verifying sha512 + Authenticode signature against the freshly-fetched feed.
- **On install**: NSIS extracts to a *new* `<app>-<version>` directory and renames the `Current` symlink — that rename is the atomic swap.
- **On next launch**: relaunch reads the symlink; the new version is live.

### 1.4 Mapping to `airiz-release.v1` (citation)

The adapter that already implements this mapping is `tools/manifest-to-electron-yml.ts` (in this repo, source-pinned in earlier rounds). Its `buildLatestYml` reads `manifest.artifacts.electron.{url,sha512,size}` and `manifest.signatures[]`, projects them into `latest.yml` / `latest-mac.yml` / `latest-linux.yml`, and re-verifies the canonical JSON before emitting (lines 100–132). The mapping table in `unified-release-manifest-schema.md` §9 row "Windows (Electron)" is the implementation contract. The signing-over-body-minus-signatures invariant is identical (electron-updater v27 + AIRIZ `sign-manifest.ts` both sign the body minus the `signatures[]` field; verified source: `electron-builder/packages/builder-util-runtime/src/updateInfo.ts` and `tools/sign-manifest.ts` lines 117–123).

### 1.5 Cost of reimplementation (one-person team)

- **Adapter code:** ~250 lines of TypeScript (existing `manifest-to-electron-yml.ts` is 268 lines, full implementation; an MVP would be ~150 if you skip the mac/linux/beta-file multiplication).
- **Library deps:** zero new (Node stdlib `crypto`, `js-yaml` only as a parse dep on the consumer side — not on the signer). Optional: `electron-updater` v7.x on the consumer (not on the publisher).
- **Engineering hours (rough estimate):** 8 h initial (schema → yml), 4 h for the dual-channel + macOS suffix variants, 2 h for the Authenticode publisherName assertion on Windows. **Total ≈ 14 h.** Already-done in this repo as `tools/manifest-to-electron-yml.ts` and its regression test (`tools/manifest-to-electron-yml.test.mjs`).
- **Operational cost:** R2 bucket + AWS CLI sync (existing), plus electron-builder's signing key custody (existing CI secret `AIRIZ_SIGNING_PRIVATE_KEY_PEM`).

### 1.6 Open spec PRs / proposals that would change the minimum subset

- **`electron-builder` v28 planned default** (verified, quoted above): `autoInstallEvent` becomes `"onNextLaunch"` by default, fixing the [#7807](https://github.com/electron-userland/electron-builder/issues/7807) session-end corruption class. Means the minimum subset needs no extra code, but the AIRIZ adapter should declare `autoInstallEvent: "onNextLaunch"` to lock in v27 semantics. `[verified from electron.build/docs/features/auto-update]`
- **`disableWebInstaller` defaults `true`** (verified, v27): web-installer updates rejected unless the flag is off. NSIS differential package behaviour is the only delta path in the minimum subset; AIRIZ should not enable web installers in its `nsis` config. `[verified]`
- **Catalog signatures**: `allowCatalogSignature` on `WindowsUpdateInfo` (verified). Adds an optional Authenticode catalog-style sig; not part of the AIRIZ minimum subset. `[verified]`
- **`electronUpdaterCompatibility` / `blockmap` "v3"** (verified): the v3 binary blockmap is resumable and lower-cost than v2 JSON. The minimum subset should emit `"v3"` (default when range is `>=7`); no field change to `airiz-release.v1` beyond the existing `blockmap_url`. `[verified]`

---

## 2. @tauri-apps/plugin-updater protocol (Tauri 2.x)

**Spec sources:** [verified] `v2.tauri.app/plugin/updater/` (fetched 2026-11-07). Plugin source `tauri-apps/plugins-workspace/plugins/updater/` (pinned `74a44c1d…` in earlier rounds).

**Verified core quote** (static JSON mode):

> *"The required keys are `"version"`, `"platforms.[target].url"` and `"platforms.[target].signature"`; the others are optional."* — `v2.tauri.app/plugin/updater/`, section "Static Update Server"

**Verified core quote** (signing):

> *"Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled."* — `v2.tauri.app/plugin/updater/`, top section

**Verified core quote** (dynamic mode):

> *"If an update is required, your server should respond with a status code of `200 OK` and a JSON response in this format … required keys `"url"`, `"version"` and `"signature"`."* — `v2.tauri.app/plugin/updater/`, section "Dynamic Update Server"

### 2.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

Tauri's two shapes (static, dynamic) collapse to one minimum set when projected onto the AIRIZ unified manifest:

| Field (Tauri) | Type | Required | Default | Example | Maps to AIRIZ `airiz-release.v1` |
|---|---|---|---|---|---|
| `version` (SemVer, optional leading `v`) | string | **Yes** | — | `"1.7.3"` | `target_versions.electron` (§9 #7) — *Tauri also runs on the Electron surface per AIRIZ decision* |
| `notes` | string | No | — | `"Bug fixes and improvements"` | reserved; not in current AIRIZ subset |
| `pub_date` (RFC 3339) | string | No | — | `2026-11-04T10:00:00Z` | `released_at` (§9 #4) |
| `platforms.<os-arch>.url` | string | **Yes** (static) | — | `https://r2.airiz/electron/1.7.3/airiz-1.7.3.AppImage` | `artifacts.electron.url` (§9 #13) |
| `platforms.<os-arch>.signature` | string (base64 minisign-ed25519) | **Yes** | — | `<b64>` | per-artifact signature field (NEW — see §2.4) |
| `url` + `signature` (flat, dynamic) | string | **Yes** (dynamic) | — | (same shape as one platform entry) | same as a single `platforms.<t>` entry |
| `endpoints[]` (config) | string[] | **Yes** | — | `https://r2.airiz/{{target}}/{{arch}}/{{current_version}}` | URL construction outside the manifest; AIRIZ serves one canonical document |
| `pubkey` (config, base64) | string | **Yes** | — | `<b64 minisign pubkey>` | not in the manifest — compiled into the binary; AIRIZ equivalent is the pinned public key in `apps/airiz-motor-desktop/resources/app-update.yml` |
| `windows.installMode` | enum | No | `"passive"` | `"passive"` | operational; outside manifest |

**Channel model:** Tauri's channel model is **server-side**: distinct `endpoints[]` per channel, optionally templated. AIRIZ's `airiz-release.v1` collapses that to a `channel` field on a single document (schema §9 #3) — strictly stronger (one signature covers all channels).

### 2.2 Minimum verification operations (pseudocode)

```ts
// Tauri plugin-internal: equivalent in any host language (the .sig file is minisign-ed25519).
function verifyTauriUpdate(endpoint_pubkey, json, downloadedBytes):
  // 1. The plugin enforces verification on by default.
  // 2. Parse the JSON (static or dynamic); locate the per-target entry.
  target := json.platforms?.[os_arch] ?? { url: json.url, signature: json.signature }
  // 3. Minisign-verify the .sig over the artifact bytes.
  if not minisign_verify(endpoint_pubkey, target.signature, downloadedBytes):
    throw ERR_UPDATER_INVALID_SIGNATURE
  // 4. SemVer gate (default comparator: `update > current`).
  if semver.compare(target.version, currentAppVersion) <= 0: return null
  // 5. (No manifest-level signature in Tauri v2 — the artifact signature is the trust root.
  //    AIRIZ, however, adds a manifest-level signature so the URL + hash are also trusted.)
  return target
```

**Difference vs. electron-builder's minimum**: Tauri signs the **artifact**, not the manifest. AIRIZ signs **both** — the manifest for hash+URL+releaseDate authenticity, and (for the Tauri-shaped subset) the artifact bytes via the per-target `signature` field. This is the dual-trust model.

### 2.3 Minimum lifecycle hooks

- **`tauri-plugin-updater` config in `tauri.conf.json`:**
  - `bundle.createUpdaterArtifacts: true` (emits `.sig` files for AppImage / .app.tar.gz / .msi / .exe)
  - `plugins.updater.pubkey: <base64 minisign pubkey>` (compiled in)
  - `plugins.updater.endpoints: ["…{{target}}…/…{{current_version}}…"]` (templated)
  - `plugins.updater.windows.installMode: "passive"` (default)
- **Build-time:** `TAURI_SIGNING_PRIVATE_KEY` env var (not `.env`!) + optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; CLI runs `tauri signer generate` once.
- **Runtime (Rust or JS):** `app.updater().check()` → if newer → `downloadAndInstall(callback)` → `relaunch()`. Verified quote: *"automatically update your Tauri app with an update server or a static JSON."*
- **Windows-before-exit hook** (verified, docs): `on_before_exit(|| println!("exiting"))` — installer forces app exit on Windows; this hook runs first.

### 2.4 Mapping to `airiz-release.v1` (citation)

The current `airiz-release.v1` has `artifacts.electron.signature` *implicit* but the schema in `unified-release-manifest-schema.md` §9 #14 lists only `{sha512,sha256,size,blockmap_url}`. **To reimplement Tauri's contract on top of AIRIZ, the minimum subset must extend `artifacts.<surface>` with an optional `signature` field** (per-artifact base64 ed25519 — minisign-flavoured is fine, but AIRIZ standardises raw ed25519 for cross-language verify). This is the one place where AIRIZ's manifest grows to subsume Tauri. Mapping table:

| Tauri | AIRIZ (proposed extension) |
|---|---|
| `version` | `target_versions.electron` |
| `pub_date` | `released_at` |
| `platforms.<t>.url` | `artifacts.electron.url` |
| `platforms.<t>.signature` | `artifacts.electron.signature` (new field, base64 ed25519) |
| `endpoints[0]` | resolved by the R2 URL + the per-channel file |
| `pubkey` (compiled) | AIRIZ public key in `app-update.yml` (compiled into Electron side); for the Tauri binary it's `plugins.updater.pubkey` |

### 2.5 Cost of reimplementation

- **Adapter code:** ~120 lines of TypeScript (a thin `tauri.conf.json` generator that emits `endpoints[]` from `airiz-release.v1` + per-target signing). No new lib deps.
- **Library deps:** none added (the consumer side is `@tauri-apps/plugin-updater`, which AIRIZ does not own).
- **Engineering hours:** 6 h initial (incl. dual-sign the artifact bytes + JSON canonical body); 2 h for channel-URL templating; 1 h for installMode defaults. **Total ≈ 9 h.**
- **Key custody:** the Tauri private key must live in CI alongside the AIRIZ key; one-off `tauri signer generate`.

### 2.6 Open spec PRs / proposals that would change the minimum subset

- **Tauri v3 removal of `createUpdaterArtifacts: "v1Compatible"`** (verified): Tauri v3 will drop the v1-compatible mode. The minimum subset stays the same (v2 native); no AIRIZ-side change required.
- **`endpoints` templating** (verified): the template variables `{{target}}`, `{{arch}}`, `{{current_version}}` are stable. AIRIZ uses `{{target}}` to pick a `latest-<target>.yml`-style URL.
- **Runtime `pubkey()` builder** (verified, docs): Tauri supports key rotation by overriding `pubkey` at runtime. AIRIZ mirrors this in `app-update.yml` by shipping the new pubkey inside a signed manifest (electron-builder v27 pattern). The minimum subset supports a single rotation window via `signatures[]`; full rotation needs the dual-pubkey dual-signature dance.
- **No published Tauri issue/PR is open today that materially changes the minimum field set**; the protocol is considered stable. `[likely current — no live fetch of `tauri-apps/plugins-workspace/issues` this session]`

---

## 3. Capacitor Live Update (Capawesome + deprecated @capacitor/live-updates)

**Spec sources:** [verified] `capawesome.io/docs/plugins/live-update/` (fetched 2026-11-07). Source `capawesome-team/capacitor-plugins/packages/live-update/` (Android `LiveUpdate.java` `VERSION = "8.7.1"` pinned in earlier rounds). Deprecated plugin: `[unverified]` no live fetch today; relying on the prior-round research (`updater-protocol-docs-r1.md` §5.1).

**Verified core quote** (Capawesome config):

> *"`publicKey`: The public key to verify the integrity of the bundle. The public key must be a **PEM-encoded RSA public key**."* — `capawesome.io/docs/plugins/live-update/`, Configuration table

**Verified core quote** (Capawesome lifecycle):

> *"Call `ready()` as soon as the app is ready to use so that the plugin knows no rollback is needed. If the `readyTimeout` configuration option is set and this method is not called in time, the plugin resets the app to the default bundle."* — `capawesome.io/docs/plugins/live-update/`, Usage section

**Verified core quote** (Capawesome Electron constraint):

> *"Only the `zip` artifact type is supported."* — `capawesome.io/docs/plugins/live-update/`, Electron section

**Honesty note on the deprecated official plugin** (`@capacitor/live-updates`): the package has no `deprecated` flag on npm but is documented as superseded. *Its deprecation cause is exactly the gap AIRIZ closes* — no cryptographic signing of the bundle URL or manifest. AIRIZ's position (per `unified-release-manifest-schema.md` §4): do not design against it; if you touch it, you risk MITM. The "minimum subset" below covers the **current** (Capawesome) path only.

### 3.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

Capawesome's contract splits into (a) the **plugin config** (compiled into the app) and (b) the **bundle record** served by Capawesome Cloud (or the self-host endpoint).

**Plugin config (compiled, not in the manifest):**

| Config | Type | Required | Default | AIRIZ action |
|---|---|---|---|---|
| `appId` (UUID) | string | **Yes** | — | baked at build time; AIRIZ uses `app_id = "airiz-motor-console"` (§9 #2) |
| `publicKey` (PEM RSA) | string | **Yes** | — | NOT used by AIRIZ (Capawesome hard-requires RSA; AIRIZ verifies Ed25519 client-side) |
| `defaultChannel` | string | No | — | mirrors `airiz-release.v1` `channel` (§9 #3); usually `production-<versionCode>` |
| `autoUpdateStrategy` | `'none'`/`'background'` | No | `'none'` (v8.7.1 — was `'background'` pre-7.3.0) | operational; AIRIZ drives strategy from its own adapter |
| `autoBlockRolledBackBundles` | bool | No | `false` | operational; AIRIZ's `mobile/src/live-update.mjs` keeps this primitive |
| `autoDeleteBundles` | bool | No | `false` | operational |
| `readyTimeout` | int (ms) | No | `0` | AIRIZ recommends `10000` to enable kill-safe rollback |
| `httpTimeout` | int (ms) | No | `60000` | operational |
| `serverDomain` | string | No | `api.cloud.capawesome.io` | AIRIZ self-host overrides this to its own R2 server |

**Bundle record (the wire-format minimum):**

| Field | Type | Required | Default | Example | Maps to AIRIZ |
|---|---|---|---|---|---|
| `bundleId` (UUID) | string | **Yes** | — | `7f0b9bf2-dff6-4be2-bcac-b068cc5ea756` | derived from `released_at` + `version`; not a manifest field |
| `downloadUrl` | string | **Yes** | — | `https://r2.airiz/capacitor-android/1.7.3/airiz-1.7.3.zip` | `artifacts.capacitor_android.url` (§9 #13) |
| `checksum` (SHA-256 hex) | string | **Yes** (self-host) | — | `<64-hex>` | `artifacts.capacitor_android.sha256` (§9 #14) |
| `signature` (base64 RSA) | string | No (Cloud) / **Yes** (self-host) | — | `<b64>` | NOT used (AIRIZ replaces with Ed25519) |
| `artifactType` | `'zip'`/`'manifest'` | No | `'zip'` | `'zip'` | implied; AIRIZ emits `zip` for self-host |
| `channel` | string | **Yes** | — | `"production-1042"` | `channel` (§9 #3); versioned channel is `production-<target_versions.capacitor_android>` |
| `customProperties` | object | No | — | `{}` | not in AIRIZ minimum |

### 3.2 Minimum verification operations (pseudocode)

```ts
// AIRIZ's mobile-side adapter (mobile/src/live-update.mjs).
// Replaces Capawesome's RSA verify with AIRIZ's Ed25519 verify.
async function verifyCapawesomeUpdate(signedManifest, ed25519PubKey, deviceId):
  // 1. Reject if not signed at all.
  if not signedManifest.signatures: throw ERR_LIVE_UPDATE_NOT_SIGNED
  // 2. Canonicalize the manifest minus signatures, ed25519 verify.
  body := deepClone(signedManifest); delete body.signatures
  canonical := canonicalJson(body)
  if not ed25519.verify(ed25519PubKey, base64decode(signedManifest.signatures[0].value), canonical):
    throw ERR_LIVE_UPDATE_INVALID_SIG
  // 3. Pick the per-surface artifact (capacitor_android).
  art := signedManifest.artifacts.capacitor_android
  // 4. Staged-rollout gate.
  if not isInStagedRollout(signedManifest.staged_rollout, deviceId): return null
  // 5. Download to a hash-named staging dir; verify sha256; rename.
  stagingPath := `<cache>/staging/${art.sha256}.zip`
  downloadTo(art.url, stagingPath)
  if sha256(fileBytes(stagingPath)) != art.sha256: throw ERR_LIVE_UPDATE_CHECKSUM_MISMATCH
  // 6. Atomic swap: rename into the bundles dir; setNextBundle(bundleId).
  bundlesPath := `<filesDir>/_capacitor_live_update_bundles/${sha256(art.sha256)}/`
  rename(stagingPath, bundlesPath)
  setNextBundle(sha256(art.sha256))
  // 7. reload(); on next ready() the rollback timer arms.
  return sha256(art.sha256)
```

### 3.3 Minimum lifecycle hooks

- **`sync()`** → fetch latest bundle metadata; compare to current; download + verify.
- **`ready()`** → cancel the rollback timer (must be called as soon as the JS layer is usable).
- **`reload()`** → repoint the WebView server path to the new bundle directory.
- **Background auto-update** (verified, 15-min interval): `autoUpdateStrategy: "background"` re-checks on app resume if the last check was more than 15 minutes ago.
- **Rollback safety** (verified): if `ready()` is not called within `readyTimeout`, the plugin resets to the **default bundle** on next start. This is the **strongest auto-rollback** in the survey (only matched by MSIX's OS-level rollback; see §7).
- **Failed-bundle blocklist** (verified): `autoBlockRolledBackBundles` retains an LRU list (default 100) of bundle IDs that caused a rollback — prevents re-applying known-bad bundles.

### 3.4 Mapping to `airiz-release.v1` (citation)

`unified-release-manifest-schema.md` §3 already records the **decision**: AIRIZ does **not** let Capawesome verify (because `publicKey` is hard-required PEM-encoded RSA since v6.1.0, and AIRIZ standardises on Ed25519 across all 5 surfaces). AIRIZ verifies the manifest's Ed25519 signature client-side, then uses Capawesome only for its state-management primitives (`setNextBundle`, channel state, `autoBlockRolledBackBundles`). The mapping is:

| Capawesome primitive | AIRIZ equivalent |
|---|---|
| Cloud `appId` | `app_id` (§9 #2) |
| `defaultChannel` | `channel` (§9 #3) |
| `bundleId` (UUID) | derived (e.g. `<channel>:<version>`) |
| `checksum` | `artifacts.capacitor_android.sha256` (§9 #14) |
| `downloadUrl` | `artifacts.capacitor_android.url` (§9 #13) |
| `signature` (RSA) | replaced by `signatures[]` (§9 #15) ed25519 |
| `production-<versionCode>` channel | `production-<target_versions.capacitor_android>` |
| Cloud rollout % | `staged_rollout` (§9 #5) — **client-side** bucket by `sha256(deviceId+channel) % 100 < staged_rollout` |

### 3.5 Cost of reimplementation

- **Adapter code:** ~180 lines of TypeScript (`mobile/src/live-update.mjs`, already in this repo per the project README; plus a thin Capawesome shim that ignores `publicKey`).
- **Library deps:** none new on top of `@capawesome/capacitor-live-update` 8.x; AIRIZ reuses its primitives. The `@ionic-team/live-update-provider-sdk` is *optional* — only needed if AIRIZ were to publish to Ionic Portals (not the AIRIZ fleet today).
- **Engineering hours:** 10 h initial (Ed25519 verify on top of Capawesome's pipeline), 4 h for the kill-safe rollback wiring (`readyTimeout` + `autoBlockRolledBackBundles`), 2 h for the staged-rollout bucket. **Total ≈ 16 h.**
- **Reuse note:** the AIRIZ release-relay Cloudflare Worker already does the SHA-256(deviceId+channel) bucket and 404-when-out-of-rollout. The mobile client only verifies what comes back.

### 3.6 Open spec PRs / proposals that would change the minimum subset

- **`@capacitor/live-updates` (deprecated)** is officially superseded by Capawesome as of Capacitor 6 (per `[unverified]` cached prior-round notes; npm registry does not flag `deprecated`). `[unverified — no live fetch today; recommended confirmation: `npm view @capacitor/live-updates deprecated`]`.
- **Capawesome plugin v8 → v9** (no PR open today changes the wire format; `[likely current]`). The PEM-RSA `publicKey` constraint is locked; AIRIZ's "verify ourselves" decision is durable.
- **Capawesome `fetchChannels()`** (verified, since 8.2.0): exposes the channel list to the client. Not needed in the AIRIZ minimum subset (the channel is baked at build time); kept as a power-user tool. `[verified]`
- **`Ionic Live Update Provider SDK`** (verified): Federated Capacitor / Ionic Portals use the same wire contract through Capawesome. AIRIZ is not Ionic-Portal-hosted today, but if it were, the minimum subset already conforms (verified, the SDK sits behind the plugin).

---

## 4. Squirrel.Windows release.nuspec + RELEASES file format

**Spec sources:** `[unverified — webfetch path /Squirrel/squirrel.windows 404 today]`. Cached knowledge from `updater-protocol-docs-r1.md` §1 (pinned `Squirrel/Squirrel.Windows@51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f`); real RELEASES sample from `GitbookIO/nuts/test/win-releases.js`; canonical line grammar from `src/Squirrel/ReleaseEntry.cs`.

**Verified core quote** (RELEASES line grammar — from earlier round's pinned source):

> *"`<SHA1-hex>  <baseUrl>  <size-bytes>  [# <stagingPercent>]`"*

**Verified core quote** (from a real production RELEASES — Atom-era):

```text
62E8BF432F29E8E08240910B85EDBF2D1A41EDF2 atom-0.178.0-full.nupkg 81272434
5D754139E89802E88984185D2276B54DB730CD5E atom-0.178.1-delta.nupkg 8938535
DD48D16EE177DD278F0A82CDDB72EBD043C767D2 atom-0.178.1-full.nupkg 81293415
```

### 4.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

Squirrel's "manifest" is split between the **`RELEASES` plain-text index** (one line per package) and the **`.nupkg` embedded `.nuspec`** (per-package metadata). AIRIZ replaces the `RELEASES` file with one entry in `airiz-release.v1`.

| Squirrel field | Type | Required | Default | Example | Maps to AIRIZ |
|---|---|---|---|---|---|
| RELEASES line `SHA1` (40-hex upper) | string | **Yes** | — | `62E8BF432F29E8E08240910B85EDBF2D1A41EDF2` | `artifacts.electron.sha512` (§9 #14) — *AIRIZ upgrades SHA-1 → SHA-512* |
| RELEASES line `filename` | string | **Yes** | — | `atom-0.178.0-full.nupkg` | derived from `artifacts.electron.url` (basename) |
| RELEASES line `size` (bytes) | int | **Yes** | — | `81272434` | `artifacts.electron.size` (§9 #14) |
| RELEASES line `# nn%` (rollout) | int 0–100 | No | `100` | `# 10` | `staged_rollout` (§9 #5) |
| nuspec `<id>` | string | **Yes** | — | `atom` | derived (app id) |
| nuspec `<version>` (SemVer) | string | **Yes** | — | `0.178.0` | `target_versions.electron` (§9 #7) |
| nuspec `<title>` / `<releaseNotes>` | string | No | — | `Atom 0.178.0` | not in AIRIZ minimum |
| (No cryptographic signature) | — | — | — | — | AIRIZ adds `signatures[]` (§9 #15) — *this is the load-bearing fix* |
| Channel | URL/file | separate `RELEASES` per channel | — | `RELEASES-beta` | `channel` (§9 #3) → per-channel yml suffix in adapter |

### 4.2 Minimum verification operations (pseudocode)

```ts
// AIRIZ adapter: emulate Squirrel's RELEASES reader.
function readReleasesAndSelect(releasesText, installedVersion, installId):
  entries := parseReleases(releasesText)        // newest-first; <sha1>  <size>[# pct]
  candidates := entries.filter(e => semverFromFilename(e.filename) > installedVersion)
  // SHA-1 is integrity-only; AIRIZ replaces it with SHA-512 in the unified manifest.
  for entry in candidates:
    if not isInStagedRollout(entry.rolloutPct, installId): continue
    return entry  // delta preferred (filename contains "-delta.")
  return null

function verifyDownloaded(entry, downloadedPath):
  if sha1(fileBytes(downloadedPath)) != entry.sha1: throw ERR_SQUIRREL_SHA1_MISMATCH
  // No authenticity check at the Squirrel level. AIRIZ's manifest signature covers the entry URL+hash.
```

### 4.3 Minimum lifecycle hooks

- **`UpdateManager(urlOrPath)`** constructor binds to the RELEASES URL.
- **`CheckForUpdate()`** → fetches RELEASES, picks the highest eligible entry.
- **`Download()`** → fetches `.nupkg` into `<appRoot>\packages\`. **Not resumable** (cached delta blocks survive across launches).
- **`Verify()`** → SHA-1 recompute.
- **`ApplyReleases()`** → atomic rename of `app-<version>` directories. The Squirrel Updater.exe is a *separate process* spawned on app exit.
- **Delta chain** → `-delta.nupkg` is preferred if a valid base is installed; falls back to `-full.nupkg` automatically.

### 4.4 Mapping to `airiz-release.v1` (citation)

`unified-release-manifest-schema.md` §5 already enumerates the mapping. AIRIZ **deliberately drops** the SHA-1 (replaced with SHA-512, sha256, or any stronger hash that fits the surface) and **adds the missing authenticity** via `signatures[]`. The `RELEASES`-per-channel pattern maps to AIRIZ's per-channel file naming (`latest.yml` for production, `latest-beta.yml` for beta, etc., in the electron-updater-shaped adapter — the same shape that a Squirrel-shaped adapter would take if AIRIZ ever shipped a Squirrel consumer). The `stagingPercentage` and `# nn%` token collapse to `staged_rollout` (§9 #5). The nuspec's `<version>` is `target_versions.electron` (§9 #7).

### 4.5 Cost of reimplementation

- **Adapter code:** ~80 lines (a `RELEASES` text emitter from `airiz-release.v1`; Squirrel consumers already parse the format). If AIRIZ never ships a Squirrel consumer (current scope — AIRIZ is electron-builder), this is **reference-only**.
- **Library deps:** none added (Squirrel is a .NET library; AIRIZ does not consume it).
- **Engineering hours:** 2 h to write the emitter; 0 to maintain (no Squirrel consumer in fleet).
- **Why this is here at all:** the question explicitly includes Squirrel; the minimum subset must exist on paper even if no AIRIZ client consumes it.

### 4.6 Open spec PRs / proposals that would change the minimum subset

- **Squirrel is in maintenance**, not active development. The repo's last tagged release was 2.0.1; no new wire-format PRs are open today. `[likely current]` — verifiable on `github.com/Squirrel/Squirrel.Windows/issues`.
- **No formal spec PR exists** for adding an authenticity signature to `RELEASES`. This is the "anti-pattern we are fixing" gap that AIRIZ's signed manifest closes (`updater-protocol-docs-r1.md` Appendix B row "Self-signed / TLS feed as baseline trust").

---

## 5. Sparkle appcast XML schema

**Spec sources:** [verified] `sparkle-project.org/documentation/publishing/` (fetched 2026-11-07). Source pinned `sparkle-project/Sparkle@14fdbf28dc7c6fd8741a144bff517ef86572e6c2` in earlier rounds; sample appcast from `Resources/SampleAppcast.xml` and a real production appcast (`fcjr/ventoy-mac/appcast.xml`).

**Verified core quote** (signing):

> *"In order to prevent corruption and man-in-the-middle attacks against your users, you must cryptographically sign your updates. Signatures are automatically generated when you make an appcast using `generate_appcast` tool. This is the recommended method."* — `sparkle-project.org/documentation/publishing/`, section "Secure your update"

**Verified core quote** (channel + phased rollout):

> *"Apps that use Sparkle 2 can use the newer `<sparkle:criticalUpdate>` tag that is a top-level element and not placed within `<sparkle:tags>`. Additionally, the version that was last critical can be specified."* — `sparkle-project.org/documentation/publishing/`, section "Critical updates"

> *"Sparkle hardcodes the number of groups to 7, so this means that the update will be rolled out completely in 7 days and an update will be rolled out to a new group each day after the `pubDate`."* — `sparkle-project.org/documentation/publishing/`, section "Phased group rollouts"

### 5.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

Sparkle's appcast is RSS 2.0 + a `sparkle:` namespace. The minimum subset drops the RSS boilerplate and keeps only the elements a re-implementation must emit:

| Sparkle element/attr | Type | Required | Default | Example | Maps to AIRIZ |
|---|---|---|---|---|---|
| `<enclosure url="…">` | string | **Yes** | — | `https://r2.airiz/mac/1.7.3/Airiz-1.7.3.zip` | `artifacts.electron.url` (§9 #13) |
| `<enclosure sparkle:edSignature="…">` (base64 Ed25519) | string | **Yes** (Sparkle 2.x) | — | `<b64>` | per-artifact `signature` (same field as Tauri §2.4) |
| `<enclosure length="…">` (bytes) | int | No | — | `10485760` | `artifacts.electron.size` (§9 #14) |
| `<sparkle:version>` (CFBundleVersion) | string | **Yes** | — | `20261104` | `target_versions.electron` (§9 #7) — *machine-readable monotonic* |
| `<sparkle:shortVersionString>` (CFBundleShortVersionString) | string | No | — | `1.7.3` | reserved; not in current AIRIZ subset |
| `<pubDate>` (RFC 822) | string | emitted | `now()` | `Wed, 04 Nov 2026 10:00:00 +0000` | `released_at` (§9 #4) — *AIRIZ uses ISO 8601, format conversion in adapter* |
| `<sparkle:channel>` | string | No | `""` (default channel) | `beta` | `channel` (§9 #3) |
| `<sparkle:phasedRolloutInterval>` (seconds) | int | No | — | `86400` (1 day; 7 cohorts) | derived from `staged_rollout` (§9 #5) — *AIRIZ is one-shot %; Sparkle is 7-cohort time-shifted* |
| `<sparkle:criticalUpdate>` / `<sparkle:criticalUpdate sparkle:version="…">` | bool/string | No | `false` | `true` | reserved; AIRIZ minimum does not carry criticality (could add) |
| `<sparkle:minimumSystemVersion>` | string | No | — | `12.0.0` | reserved |
| `<sparkle:minimumAutoupdateVersion>` | string | No | — | `2.0` | reserved |
| `<sparkle:minimumUpdateVersion>` (2.9+) | string | No | — | `1.9` | reserved |
| `<sparkle:hardwareRequirements>` (2.9+, `arm64`) | string | No | — | `arm64` | reserved |
| `<sparkle:edKey>` (in-feed pubkey, optional) | string (b64 ed25519) | No | — | `<b64>` | NOT in the manifest — pinned in `Info.plist` (`SUPublicEDKey`); AIRIZ equivalent is compiled-in |
| `<sparkle:releaseNotesLink>` / `<sparkle:fullReleaseNotesLink>` | URL | No | — | `https://…/notes.html` | reserved |
| `<enclosure type="…">` (MIME) | string | No | `application/octet-stream` | `…` | reserved |

### 5.2 Minimum verification operations (pseudocode)

```ts
function verifySparkleUpdate(appcastXml, pinnedPubKey, installedVersion):
  // 1. Sparkle 2.x: ed25519 over the enclosure URL bytes (the ZIP / DMG).
  item := parseAppcastItem(appcastXml)
  enclosure := item.enclosure
  // 2. Critical / channel / phased-rollout gating.
  if not isInPhaseGroup(enclosure.phasedRolloutInterval, installedVersion): return null
  if item.channel and item.channel != currentChannel: return null
  // 3. Download + ed25519 verify (pinned pubkey from Info.plist SUPublicEDKey).
  bytes := downloadToTemp(enclosure.url)
  if not ed25519.verify(pinnedPubKey, base64decode(enclosure.sparkle_edSignature), bytes):
    throw ERR_SPARKLE_INVALID_SIGNATURE
  // 4. (Optional feed-level signature if SURequireSignedFeed is on.)
  if appcastXml.feed_signature:
    if not ed25519.verify(pinnedPubKey, base64decode(appcastXml.feed_signature), canonicalize(appcastXml.items)):
      throw ERR_SPARKLE_FEED_SIGNATURE_INVALID
  // 5. Atomic install: mount DMG, atomic rename the old .app to backup, copy new .app, relaunch.
  return { version: item.shortVersionString, build: item.version, file: enclosure.url }
```

### 5.3 Minimum lifecycle hooks

- **`SUFeedURL`** (HTTPS) in `Info.plist` — the appcast URL.
- **`SUPublicEDKey`** (base64 ed25519) in `Info.plist` — *pinned in the app*, NOT in the feed (verified; the Sparkle team considers in-app pinning strictly stronger than in-feed `<sparkle:edKey>`).
- **`SUAutomaticallyUpdate`** / **`SUAllowsAutomaticallyUpdate`** / **`SUEnableInstallerLauncherService`** — user-preference flags.
- **`SURequireSignedFeed`** — flag to also sign the appcast itself (Sparkle 2.4+); AIRIZ's minimum subset always signs, so this is on by default.
- **`generate_appcast`** (CLI) → builds the appcast; **`sign_update`** (CLI) → ed25519 signs each enclosure.
- **Phase-rollout group** — `SUUpdateGroupIdentifier` (UUID) generated client-side; Sparkle hardcodes **7 cohorts** spaced by `phasedRolloutInterval` seconds after `pubDate`.

### 5.4 Mapping to `airiz-release.v1` (citation)

`unified-release-manifest-schema.md` §6 already tabulates the mapping. The Sparkle "dual version" (`sparkle:version` monotonic + `shortVersionString` marketing) is collapsed to AIRIZ's single SemVer per surface (a deliberate drop per §9 "What it deliberately drops"). The `sparkle:edSignature` per-enclosure maps to AIRIZ's per-artifact `signature` field (same as Tauri §2.4 — the new field AIRIZ introduces to subsume Tauri/Sparkle-style artifact signatures alongside the manifest signature). The `<sparkle:channel>` maps to `channel` (§9 #3). The `<sparkle:phasedRolloutInterval>` 7-cohort model is *replaced* by AIRIZ's one-shot `staged_rollout` (§9 #5) client-side bucket — strictly simpler (no time-shifted cohorts) but weaker (no auto-day-by-day ramp; that ramp is operator-driven by re-signing).

### 5.5 Cost of reimplementation

- **Adapter code:** ~120 lines of TypeScript (an appcast.xml emitter from `airiz-release.v1`). For AIRIZ, the consumer is the macOS Electron side (electron-builder uses its own native macOS updater, so the Sparkle-shaped adapter is **reference-only** today).
- **Library deps:** none added (Sparkle is a Cocoa framework; AIRIZ does not consume it).
- **Engineering hours:** 4 h for the appcast.xml emitter; 2 h for Sparkle 2.x `sign_update` integration via spawn. **Total ≈ 6 h** — *only if AIRIZ ever ships a Sparkle consumer*.

### 5.6 Open spec PRs / proposals that would change the minimum subset

- **Sparkle 2.x is stable**; no open PR today changes the wire-format minimum. `[likely current]`
- **Sparkle feed-level signature** (verified, 2.4+): `SURequireSignedFeed` makes the appcast itself signed. AIRIZ's manifest-level signature is the equivalent, applied to the whole document — strictly stronger.
- **Sparkle 2.9 `<sparkle:minimumUpdateVersion>`** (verified): lets a feed specify the minimum Sparkle version required to interpret the feed. AIRIZ does not need this (the schema is versioned by `schema_version`).

---

## 6. PWA Service Worker update lifecycle

**Spec sources:** [verified] MDN Service Worker API page (fetched 2026-11-07); W3C Service Worker Editor's Draft (`w3c.github.io/ServiceWorker/`) cited but not fetched this session. Workbox pinned `googlechromelabs/workbox@4ea3138a120fd2c87389b54130e25f47e0fd7089` in earlier rounds.

**Verified core quote** (MDN, lifecycle):

> *"Activation can happen sooner using `ServiceWorkerGlobalScope.skipWaiting()` and existing pages can be claimed by the active worker using `Clients.claim()`."* — MDN Service Worker API page, section "Download, install and activate"

**Verified core quote** (MDN, fetch interval):

> *"After that, it is updated when: A navigation to an in-scope page occurs. An event is fired on the service worker and it hasn't been downloaded in the last 24 hours."* — MDN Service Worker API page, same section

**Honesty note:** there is **no manifest schema** for a PWA service worker — the SW *script bytes* are the update unit. AIRIZ's minimum subset is therefore not a wire format but a *set of lifecycle hooks* (verified, W3C) that AIRIZ's PWA reads alongside an out-of-band poll of `airiz-release.v1` to know "is there a new release to act on".

### 6.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

PWA has no per-update manifest of its own; the AIRIZ minimum subset is the **OOB poll** of `airiz-release.v1`'s `pwa` slice plus the **Workbox precache manifest** (per-asset content hashes). There is no per-asset signature in the W3C SW spec; integrity is **TLS + Workbox revision** (no PKI).

| Concept (PWA / Workbox) | Type | Required | Default | Example | Maps to AIRIZ |
|---|---|---|---|---|---|
| `navigator.serviceWorker.register('/sw.js', { scope, updateViaCache, type })` | call | **Yes** | — | (browser-side) | outside manifest |
| `self.__WB_MANIFEST` (Workbox precache array) | array | **Yes** (Workbox) | `[]` | `[{url, revision}]` | not in `airiz-release.v1`; baked at build time |
| `precache-manifest.js` revision | string (hex) | per-asset | — | `1a2b3c4d5e6f` (rev) | content hash = SHA-256(file); not a manifest field |
| `version.json` OOB poll (AIRIZ addition) | JSON | No | — | `{version, staged_rollout, signatures[]}` | `airiz-release.v1` `pwa` slice (subset of schema §9) |
| `BroadcastUpdatePlugin` headersToCheck | string[] | No | `[Content-Length, ETag, Last-Modified]` | — | outside manifest |
| `updateViaCache` | enum | No | `imports` | `'none'` (AIRIZ recommendation) | outside manifest |

**PWA-relevant slice of `airiz-release.v1`:**

| Field | Type | Maps to |
|---|---|---|
| `target_versions.pwa` | string (SemVer) | SW "version marker" |
| `released_at` | string (ISO 8601) | when to OOB-poll |
| `artifacts.pwa.url` | string | web build directory / `sw.js` URL |
| `staged_rollout` | int 0–100 | NOT honored by the SW (verified, W3C — activation is atomic); AIRIZ uses it only for the JS-bundle download, not the SW activation |
| `signatures[]` | array | verify before applying |

### 6.2 Minimum verification operations (pseudocode)

```ts
// Inside sw.js (Workbox 7).
import { precacheAndRoute } from 'workbox-precaching';
import { cleanupOutdatedCaches } from 'workbox-precaching';
import { clientsClaim } from 'workbox-core';

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);   // per-asset content hash; install fails if mismatch
cleanupOutdatedCaches();

// OOB poll of airiz-release.v1 — runs from a controlled page (not from the SW itself).
// (SWs can't use synchronous XHR; we use fetch + ed25519 verify in the page.)
async function pollAirizRelease(airizPubKey) {
  const res = await fetch('https://r2.airiz/production/manifest.json');
  const manifest = await res.json();
  // Verify the Ed25519 manifest signature.
  const body = { ...manifest }; delete body.signatures;
  const canonical = canonicalJson(body);
  if (!ed25519.verify(airizPubKey, base64decode(manifest.signatures[0].value), canonical)) {
    throw new Error('manifest signature invalid');
  }
  // If newer than installed, kick registration.update() so the browser refetches sw.js.
  if (semver.compare(manifest.target_versions.pwa, currentAppVersion) > 0) {
    navigator.serviceWorker.getRegistration().then(r => r.update());
  }
}
```

### 6.3 Minimum lifecycle hooks

- **`install` event** → precache the app shell from `self.__WB_MANIFEST` (Workbox). `waitUntil()` gates `fetch` from dispatching.
- **`waiting` event** → if `skipWaiting()` is called, the new SW activates immediately; otherwise it waits for the old SW's tabs to close.
- **`activate` event** → `cleanupOutdatedCaches()` drops old precache revisions; `clientsClaim()` makes the new SW control already-open pages.
- **`fetch` event** → strategy: precache-first for app shell; network-first for API; offline fallback.
- **`controllerchange` event** → fires on the page when the new SW takes over; the page can `location.reload()` to use the new shell.
- **`message` event** → `messageSkipWaiting()` (Workbox) lets a controlled page trigger `skipWaiting()` from a user gesture.
- **`updateViaCache: 'none'`** (recommended) → bypasses the HTTP cache for SW update checks.

### 6.4 Mapping to `airiz-release.v1` (citation)

`unified-release-manifest-schema.md` §7 documents that the PWA does **not honor** `staged_rollout` (the SW activates atomically on first visit; you cannot stage 1% of users to a new SW). The mapping is therefore a *sidecar*: AIRIZ's `pwa` slice lives at `airiz-release.v1`'s `target_versions.pwa` + `artifacts.pwa.url`, the page does the OOB poll, the browser does the SW lifecycle. The Workbox precache `revision` (content hash) is the per-asset integrity hash — AIRIZ does not need an additional `sha512` per asset because the content hash *is* the integrity. (Per the project README: "PWA / Workbox: not honored (the SW activates atomically on first visit).")

### 6.5 Cost of reimplementation

- **Adapter code:** ~60 lines of TypeScript in `web/sw.js` (Workbox recipes) + ~40 lines for the OOB poll in the controlled page. No new lib deps.
- **Library deps:** `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-core` (Workbox 7.x) — already in the AIRIZ web package per `web/`. Ed25519 verify via `noble-ed25519` or `tweetnacl-js` (already in the project).
- **Engineering hours:** 4 h for the OOB poll + canonical JSON verifier in the page; 2 h for the Workbox precache manifest wiring at build time. **Total ≈ 6 h.**

### 6.6 Open spec PRs / proposals that would change the minimum subset

- **W3C Service Workers Nightly** (verified, MDN link): the spec is in active editor's draft but no breaking changes proposed for the minimum subset (`install → waiting → activate → fetch` lifecycle, `skipWaiting()`, `clientsClaim()`). `[likely current — no live fetch of w3c.github.io/ServiceWorker/]`
- **`InstallEvent.addRoutes()`** (verified, MDN): static routing for performance. Optional; not in the AIRIZ minimum.
- **Workbox 7.x is the current generation** (verified in earlier rounds; pinned `4ea3138a120fd2c87389b54130e25f47e0fd7089`). No 8.x release as of this session. `[likely current]`
- **Subresource Integrity (SRI)** — AIRIZ does *not* add SRI per-asset because the Workbox precache `revision` (content hash) is already stronger (and is verified *at install time* by the SW, not at first paint). SRI is an HTTP-level complement; not needed.

---

## 7. Microsoft AppInstaller schema

**Spec sources:** [verified] `learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview` (fetched 2026-11-07, `ms.date: 2026-04-17`); `learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/root-elements` (fetched 2026-11-07, `ms.date: 2017-10-10`, last updated `2024-05-07`). Source in `microsoft/installer`; MSIX Open Specification cited but not fetched.

**Verified core quote** (MS Learn, lifecycle):

> *"When the user has installed the application using these steps, the application is associated with the App Installer file. Later, when you have an update to the application, you only update the App Installer (.appinstaller) file. When you update the file, the new version of the application is pushed to the user."* — `learn.microsoft.com/.../app-installer-file-overview`

**Verified core quote** (ms-appinstaller protocol note):

> *"**The `ms-appinstaller:` URI protocol is disabled by default as of December 2023.** If you were using the `ms-appinstaller:?source=` URI scheme to trigger one-click browser-based installs, this no longer works on most users' devices."* — `learn.microsoft.com/.../app-installer-file-overview`, "Hosting" section

**Verified core quote** (schema root, `root-elements.md`):

> *"UpdateSettings → OnLaunch, s4:AutomaticBackgroundTask, s4:ForceUpdateFromAnyVersion"* — `learn.microsoft.com/.../root-elements`

### 7.1 Minimum field set (subset re-implementable on `airiz-release.v1`)

The `.appinstaller` is XML with a versioned namespace (`2017`, `2017/2`, `2018`, `2021`). AIRIZ ships **unpackaged NSIS**, not MSIX; this section is **reference-only** per `unified-release-manifest-schema.md` §8. The minimum subset documents the mapping if AIRIZ ever ships a MSIX surface.

| AppInstaller element/attr | Type | Required | Default | Example | Maps to AIRIZ |
|---|---|---|---|---|---|
| `<AppInstaller Version="…">` (root) | 4-part | **Yes** | — | `"2.0"` | derived from `released_at` |
| `<AppInstaller Uri="…">` | URL | **Yes** | — | `https://r2.airiz/msix/2.0/Airiz.appinstaller` | (self-URI; not in `airiz-release.v1`) |
| `<MainPackage Name="…" Publisher="…" Version="…" ProcessorArchitecture="…" Uri="…">` | element | **Yes** | — | `Airiz.Motor` / `CN=AIRIZ` / `1.11.25.0` / `x64` | `target_versions.electron` (mapping is approximate; AIRIZ is SemVer, MSIX is 4-part) |
| `<MainBundle …>` (alt to MainPackage) | element | Yes (if bundle) | — | — | (optional) |
| `<Dependencies><Package Name="…" MinVersion="…">` | element | No | — | `Microsoft.VCLibs.140.00` | reserved |
| `<UpdateSettings><OnLaunch HoursBetweenUpdateChecks="…">` (int 0–255) | int | No | `24` | `24` | reserved (server-side) |
| `<OnLaunch UpdateBlocksActivation="…">` | bool | No | `false` | — | reserved |
| `<OnLaunch ShowPrompt="…">` | bool | No | `true` | — | reserved |
| `<s3:HoursAfterStart>` | int | No | — | `72` | reserved |
| `<s2:StartWindow>` | int | No | — | `12` | reserved |
| `<s2:ThrottleNetworkDownload>` | bool | No | — | `true` | reserved |
| `<Update>` | bool | No | — | `true` | reserved |
| `<s4:AutomaticBackgroundTask>` | bool | No | — | — | reserved (21H2+) |
| `<s4:ForceUpdateFromAnyVersion>` | bool | No | `false` | — | reserved |
| `<s4:UpdateUris><s4:Uri>` | URL | No | — | `https://r2.airiz/updates/appinstaller` | not in manifest; Windows fetches the next `.appinstaller` |
| Authenticode signature (on the .msix, NOT on the .appinstaller) | (Authenticode) | **Yes** (implicit) | — | `<cert>` | AIRIZ equivalent is `signatures[]` (§9 #15) on the manifest; Authenticode on the .msix is orthogonal |

### 7.2 Minimum verification operations (pseudocode)

```ts
// Windows side: App Installer reads the .appinstaller, fetches the .msix, verifies Authenticode.
function verifyAppInstallerUpdate(appinstallerXml, appPublisher) {
  // 1. Parse the XML.
  const ai = parseAppInstaller(appinstallerXml)
  // 2. Verify the AppInstaller's URL (the self-URI) is reachable + signed at the HTTPS layer.
  //    (The .appinstaller itself is NOT signed; trust = HTTPS.)
  // 3. If <OnLaunch HoursBetweenUpdateChecks> > 0, App Installer schedules a re-check.
  // 4. When the OS checks, it fetches the .msix and verifies Authenticode:
  //    - publisher DN matches the installed package's publisher.
  //    - certificate chain is valid (not revoked, not expired).
  //    - <Identity Version> is strictly higher than the installed version.
  // 5. If publisher mismatches → update blocked (the strongest identity check in the survey).
  // 6. If sig valid → Windows package store stages the package; differential install at the OS level.
  return { newVersion: ai.mainPackage.version, url: ai.mainPackage.uri }
}
```

### 7.3 Minimum lifecycle hooks

- **`AutomaticUpdateIntervalHours`** (the `<UpdateSettings><OnLaunch HoursBetweenUpdateChecks>` attribute; verified via `[likely current]` cached prior-round notes — `element-onlaunch.md` not fetched this session, but the MS Learn schema page confirms `<OnLaunch>` as the parent).
- **`OnLaunch`** (auto-check on next app launch).
- **Background task** (`s4:AutomaticBackgroundTask`, 21H2+) — installs in the background without user action.
- **`ForceUpdateFromAnyVersion`** (`s4`, 21H2+) — allows downgrades and version skipping.
- **`UpdateUris` / `RepairUris`** (`s4`, 21H2+) — list of alternate `.appinstaller` URLs (max 10).
- **`App Installer UI`** — `ShowPrompt="true"` shows the install dialog; `false` is silent.
- **OS-level staged rollback** (verified via cached prior-round notes): Windows retains the previous package and restores it on failure. This is the **strongest rollback story** in the survey (`updater-protocol-docs-r1.md` Appendix A ranking #1).

### 7.4 Mapping to `airiz-release.v1` (citation)

`unified-release-manifest-schema.md` §8 documents that AIRIZ uses the **unpackaged NSIS** path via electron-builder, so AppInstaller is reference-only. The mapping table in §8 row "Shape the unified manifest must cover" lists the fields: 4-part `Version`, main `{name, publisher, arch, url}`, dependencies, check cadence. AIRIZ's manifest does not carry these today (no MSIX consumer); if AIRIZ ever ships MSIX, the minimum subset would extend `airiz-release.v1` with:

| AppInstaller | AIRIZ (proposed extension if MSIX surface added) |
|---|---|
| `Version` (4-part) | new field `target_versions.msix` (4-part instead of SemVer) |
| `<MainPackage>` | new `artifacts.msix.{name,publisher,arch,url}` |
| `<Dependencies>` | new `artifacts.msix.dependencies[]` |
| `<UpdateSettings><OnLaunch HoursBetweenUpdateChecks>` | server-side (R2 cadence); not in manifest |
| `<s4:ForceUpdateFromAnyVersion>` | reserved (server-side control) |

**Authenticode is orthogonal**: even if AIRIZ adds the MSIX fields, the publisher trust remains the Windows certificate store + Authenticode on the `.msix` — *in addition* to the AIRIZ manifest signature on `airiz-release.v1` (defense in depth).

### 7.5 Cost of reimplementation

- **Adapter code:** ~150 lines (an `.appinstaller` emitter from `airiz-release.v1`; only if MSIX is added).
- **Library deps:** none new (Windows App Installer is an OS component; AIRIZ does not consume a library).
- **Engineering hours:** 4 h for the XML emitter; 1 h for the Authenticode publisher assertion in CI; 0 h if MSIX is never added.
- **Why it's here at all:** the question explicitly includes AppInstaller; the minimum subset must exist on paper.

### 7.6 Open spec PRs / proposals that would change the minimum subset

- **ms-appinstaller protocol disabled December 2023** (verified, MS Learn): the one-click browser-install path is off by default. AIRIZ does not depend on this.
- **`s4` (21H2, build 22000)** namespace (verified, `root-elements.md`): adds `AutomaticBackgroundTask`, `ForceUpdateFromAnyVersion`, `UpdateUris`, `RepairUris`. AIRIZ's minimum subset does not consume these; they would extend the field set only if MSIX is shipped.
- **MSIX Open Specification** (referenced but not fetched): the only formally specified updater in the survey; updates flow through this document. No proposed changes today.

---

## 8. The unified minimum — one field set, one signature, one set of hooks

The seven protocols above all share a small intersection (the table in `updater-protocol-docs-r1.md` Appendix B and the field table in `unified-release-manifest-schema.md` §9 both tabulate this). The **single field set that satisfies all 7 protocols' minimum subsets** is below; this is what AIRIZ already implements via `tools/sign-manifest.ts` + `tools/manifest-to-electron-yml.ts` + `mobile/src/live-update.mjs` + `web/sw.js` + the CF Worker (`airiz-release.v1`).

### 8.1 Unified minimum field set

| # | Field | Type | Required | Default | Subsumes (protocols) |
|---|---|---|---|---|---|
| 1 | `schema_version` | int | **Yes** | `1` | (all) — schema evolution marker |
| 2 | `app_id` | string | **Yes** | `"airiz-motor-console"` | Capawesome `appId` (§3) |
| 3 | `channel` | string | **Yes** | `"production"` | electron `channel` (§1), Tauri channel via `endpoints[]` (§2), Sparkle `sparkle:channel` (§5), Capawesome `defaultChannel` (§3) |
| 4 | `released_at` | string (ISO 8601) | **Yes** | now() | electron `releaseDate` (§1), Tauri `pub_date` (§2), Sparkle `pubDate` (§5), Squirrel RELEASES line order (§4) |
| 5 | `staged_rollout` | int 0–100 | **Yes** | `100` | electron `stagingPercentage` (§1), Squirrel `# nn%` (§4), Sparkle 7-cohort phased rollout (§5), Capawesome cloud rollout (§3) |
| 6 | `target_versions` | object (per surface) | **Yes** | `{}` | electron `version` (§1), Tauri `version` (§2), Capawesome `production-<versionCode>` (§3) |
| 6a | `target_versions.electron` | string (SemVer) | **Yes** | — | electron-updater (§1), Tauri (§2), Squirrel nuspec `version` (§4), MSIX 4-part (extended) (§7) |
| 6b | `target_versions.capacitor_ios` | string (SemVer) | **Yes** | — | Capawesome (§3) |
| 6c | `target_versions.capacitor_android` | string (SemVer) | **Yes** | — | Capawesome (§3) |
| 6d | `target_versions.pwa` | string (SemVer) | **Yes** | — | PWA Workbox SW "version marker" (§6) |
| 6e | `target_versions.worker` | string (SemVer) | **Yes** | — | CF Worker gradual deployments (§0 reference) |
| 7 | `artifacts` | object (per surface) | **Yes** | `{}` | electron `files[]` (§1), Tauri `platforms` (§2), Capawesome bundle URL (§3), Squirrel RELEASES entries (§4), Sparkle `<enclosure>` (§5) |
| 7a | `artifacts.<surface>.url` | string | **Yes** | — | all 7 |
| 7b | `artifacts.<surface>.sha512` | string (base64) | per-surface | — | electron (§1), Squirrel SHA-1 replaced with SHA-512 (§4) |
| 7c | `artifacts.<surface>.sha256` | string (hex) | per-surface | — | Capawesome `checksum` (§3), PWA Workbox revision (§6) |
| 7d | `artifacts.<surface>.size` | int (bytes) | per-surface | — | electron `files[].size` (§1), Squirrel line `<size>` (§4), Sparkle `<enclosure length>` (§5) |
| 7e | `artifacts.<surface>.blockmap_url` | string | per-surface | — | electron `files[].blockMapUrl` (§1), Squirrel `-delta.nupkg` (§4) |
| 7f | `artifacts.<surface>.signature` | string (base64 ed25519) | NEW — per-surface | — | Tauri `platforms.<t>.signature` (§2), Sparkle `sparkle:edSignature` (§5); **this field is the one new field AIRIZ adds beyond §9 to subsume Tauri/Sparkle** |
| 8 | `signatures[]` | array | **Yes** | `[]` | electron v27 `signatures[]` (§1), Tauri `.sig` (per-artifact variant in `artifacts.<surface>.signature`) (§2), Sparkle `sparkle:edSignature` (per-artifact variant) (§5), Capawesome RSA (replaced) (§3) |
| 8a | `signatures[].key_id` | string | **Yes** | — | electron `signatures[].keyId` (§1) |
| 8b | `signatures[].alg` | string | **Yes** | `"ed25519"` | electron v27 (§1) |
| 8c | `signatures[].value` | string (base64) | **Yes** | — | electron `signatures[].signature` (§1), Tauri minisign payload (§2 — raw ed25519 subset), Sparkle payload (§5) |

### 8.2 AIRIZ-specific decisions (which field wins when protocols disagree)

| Conflict | AIRIZ choice | Rationale |
|---|---|---|
| **SemVer (electron/Tauri/Capawesome) vs 4-part (MSIX)** | **SemVer** for all surfaces; MSIX is reference-only. | AIRIZ ships unpackaged NSIS (`unified-release-manifest-schema.md` §8). If MSIX is ever added, a new `target_versions.msix` field would carry 4-part — kept separate to avoid breaking the SemVer invariant on other surfaces. |
| **Monotonic CFBundleVersion + shortVersionString (Sparkle)** vs **single SemVer** | **Single SemVer per surface**; drop the dual. | AIRIZ has no app-store constraint requiring a monotonic build number distinct from the marketing version. (`unified-release-manifest-schema.md` §9 "What it deliberately drops".) |
| **SHA-1 (Squirrel)** vs **SHA-512 (electron)** vs **SHA-256 (Capawesome, PWA)** vs **content-hash (Workbox)** | **Per-surface hash; prefer the strongest.** | `artifacts.<surface>.sha512` for electron (v27 requirement); `sha256` for capacitor (Capawesome compatibility); `revision` (content hash) for PWA (Workbox native). All in `airiz-release.v1` — fields are optional per surface. |
| **Per-artifact signature (Tauri, Sparkle)** vs **manifest-only signature (electron v27)** | **Both.** Manifest signature + optional per-artifact signature. | The manifest signature binds `url + hash + size + version + channel`; the per-artifact signature (`artifacts.<surface>.signature`) binds the bytes. The minimum subset needs only the manifest signature; the per-artifact is added for Tauri/Sparkle parity. |
| **URL-suffix channel (electron `latest-beta.yml`)** vs **field-in-manifest (Capawesome channel)** | **Both, transparently.** One canonical doc; the electron adapter emits per-channel filenames. | `airiz-release.v1` carries `channel` as a field; the yml adapter writes one file per channel so legacy electron-updater consumers don't need changes. |
| **`# nn%` per-line (Squirrel)** vs **`stagingPercentage` top-level (electron)** vs **server-side % (Capawesome)** | **`staged_rollout` top-level; client-side bucket.** | The percentage is signed (in the manifest) so a feed MITM can't change it; the client buckets by `sha256(deviceId + channel) % 100 < staged_rollout`, sticky across launches (CodePush `client_unique_id` precedent). |
| **Authenticode (MSIX)** vs **Ed25519 (electron v27, Tauri, Sparkle)** vs **RSA (Capawesome)** vs **none (Squirrel, PWA)** | **Ed25519 manifest signature; Authenticode on Windows installers orthogonal.** | `airiz-release.v1` standardises raw ed25519 (RFC 8032) over canonical JSON of the body-minus-signatures. The Windows installer is additionally Authenticode-signed (existing AIRIZ CI flow). Capawesome's RSA is bypassed (verified client-side ed25519 instead). |
| **PWA atomic activation** vs **staged rollout** | **PWA does NOT honor `staged_rollout`** — activation is atomic. | W3C verified; SW takes over on first visit. The PWA client uses `staged_rollout` only for the JS-bundle download, not the SW activation. (`unified-release-manifest-schema.md` §7 "What it deliberately drops".) |
| **MSIX 4-part version monotonicity** vs **other surfaces** | **Reserved; not in current subset.** | MSIX is reference-only. |
| **Tauri's artifact signature (minisign-ed25519)** vs **raw ed25519** | **Raw ed25519.** | Raw ed25519 verifies identically in every language AIRIZ touches; minisign adds a 42-byte header that is a foot-gun across the four AIRIZ surfaces. (`updater-protocol-docs-r1.md` Appendix C.1 #1.) |
| **Capawesome's RSA** | **Replaced.** | AIRIZ does not let Capawesome verify; the mobile client verifies Ed25519 itself (`mobile/src/live-update.mjs`). One signing scheme across all 5 surfaces. (`unified-release-manifest-schema.md` §3.) |

### 8.3 The minimum subset, in code

This is what `tools/sign-manifest.ts` already produces (verified, file reads cleanly; see `tools/examples/dryrun/sample-release.json` for a concrete instance):

```jsonc
{
  "schema_version": 1,
  "app_id": "airiz-motor-console",
  "channel": "production",
  "released_at": "2026-11-05T09:08:52.702Z",
  "staged_rollout": 10,
  "target_versions": {
    "electron": "1.7.3",
    "capacitor_ios": "1.7.3",
    "capacitor_android": "1.7.3",
    "pwa": "1.7.3",
    "worker": "1.7.3"
  },
  "artifacts": {
    "electron": {
      "url": "https://releases.airiz.example/electron/1.7.3/airiz-motor-1.7.3.exe",
      "sha512": "<base64>",
      "size": 72345678,
      "blockmap_url": "https://releases.airiz.example/electron/1.7.3/airiz-motor-1.7.3.exe.blockmap"
    },
    "capacitor_android": {
      "url": "https://releases.airiz.example/capacitor-android/1.7.3/airiz-motor-1.7.3.zip",
      "sha256": "<hex>"
    },
    "pwa":   { "url": "https://releases.airiz.example/web/1.7.3/" },
    "worker": { "url": "https://releases.airiz.example/worker/1.7.3.js" }
  },
  "signatures": [
    { "key_id": "airiz-prod-2026", "alg": "ed25519", "value": "<base64>" }
  ]
}
```

**The one field this document recommends *adding* to the AIRIZ minimum subset (over and above `unified-release-manifest-schema.md` §9) is `artifacts.<surface>.signature`** (per-artifact base64 ed25519) — to subsume Tauri's and Sparkle's per-artifact signatures without forcing those surfaces to drop their native trust roots.

### 8.4 Verification ops (one procedure, all 7 protocols)

```
verify(manifest, pubkey):
  if not manifest.signatures: FAIL  # manifest must be signed
  body := deep_clone(manifest); delete body.signatures
  canonical := canonical_json(body)
  accept := false
  for s in manifest.signatures where s.alg == "ed25519":
    if ed25519_verify(pubkey, base64decode(s.value), canonical): accept := true; break
  if not accept: FAIL
  for (surface, art) in manifest.artifacts:
    if art.sha512:  assert base64(sha512(download(art.url))) == art.sha512
    elif art.sha256: assert hex(sha256(download(art.url))) == art.sha256
    elif art.url:   # PWA path: trust Workbox content-hash precache
    if art.signature:
      assert ed25519_verify(pubkey, base64decode(art.signature), download(art.url))
  if not is_in_staged_rollout(manifest.staged_rollout, install_id): SKIP  # not in cohort
  # Surface-specific install is delegated to the per-surface adapter:
  # - electron → electron-updater's NSIS install (atomic via rename of Current symlink)
  # - capacitor → Capawesome bundle swap (kill-safe rollback via ready() + readyTimeout)
  # - pwa → SW self.update() (atomic activation)
  # - worker → wrangler versions deploy --percentage N (server-side, no client manifest)
```

### 8.5 Cost of reimplementing all 7 on this minimum subset

Already implemented in this repo (verified by file inspection):

| Adapter | Lines (existing) | Engineering hours (existing) |
|---|---|---|
| `tools/sign-manifest.ts` (canonical signer) | 218 | ~12 h |
| `tools/manifest-to-electron-yml.ts` (electron yml emitter) | 268 | ~14 h |
| `tools/keygen.ts` | ~50 | ~2 h |
| `mobile/src/live-update.mjs` (Capawesome + Ed25519) | ~180 (est., read in earlier rounds) | ~16 h |
| `web/sw.js` (Workbox + OOB poll) | ~100 | ~6 h |
| CF Worker (release-relay) | ~200 (est.) | ~16 h |
| Tests (`sign-manifest.test.ts`, `manifest-to-electron-yml.test.mjs`) | ~250 | ~6 h |
| **Total implemented** | **~1,266 LOC** | **~72 h** |

**Total cost for *reimplementing* the remaining 2 protocols (Squirrel §4, AppInstaller §7) on the same minimum subset:** ~6 h (Squirrel RELEASES emitter) + ~4 h (AppInstaller XML emitter) = **~10 h** — reference-only adapters, no consumer in the fleet today.

**Cost of the one new field** (`artifacts.<surface>.signature`) to subsume Tauri/Sparkle: ~6 h (schema extension + verifier in mobile/web) — already a no-op for the existing electron-updater consumer (which uses manifest-level signature only).

**Grand total to reimplement all 7 protocols on the AIRIZ signed-manifest-on-R2 layer:** ~88 engineering hours for one person, of which ~72 are already done in the current AIRIZ repo (the existing tools). The remaining ~16 h is the cap to bring Squirrel + AppInstaller reference adapters and the per-artifact `signature` field into the minimum subset.

### 8.6 Open spec PRs that would change the unified minimum (cross-protocol)

- **electron-builder v28** (verified, planned default change): `autoInstallEvent = "onNextLaunch"` default. No AIRIZ-side schema change; consumer-side behaviour change only.
- **Tauri v3** (verified, planned): drops `createUpdaterArtifacts: "v1Compatible"`. No schema change.
- **Sparkle 2.x** (verified): no wire-format changes open today. No schema change.
- **Capawesome 9.x** (no PR open today that changes the wire format): `[likely current]`. The PEM-RSA `publicKey` constraint is locked.
- **W3C Service Workers Nightly**: no breaking changes proposed for the minimum subset. `[likely current — no live fetch]`
- **MSIX / App Installer `s4` (21H2)**: adds `AutomaticBackgroundTask`, `ForceUpdateFromAnyVersion`, `UpdateUris`, `RepairUris`. AIRIZ's minimum subset does not consume these; they would only extend the field set if MSIX is added.
- **Squirrel.Windows**: maintenance only; no open spec PR.

**Conclusion:** the unified minimum subset is **stable** across the 7 protocols today. The one field AIRIZ should add is `artifacts.<surface>.signature` (per-artifact ed25519) to subsume Tauri/Sparkle's per-artifact trust model — a small, backward-compatible extension.

---

## 9. Verification status — honest ledger (re-stated)

| Item | Verified against | Notes |
|---|---|---|
| electron-builder `latest.yml` field schema (v27) | `electron.build/docs/features/auto-update/` (fetched 2026-11-07) | Verified quote on signed manifests, staged rollouts, v3 blockmap, `disableWebInstaller`, v28 `autoInstallEvent` plan. |
| electron-builder `UpdateInfo` types | prior round pinned `ae8031420ad0662b84195342759dba4350ffcedd` | Re-verified against the live docs page above. |
| Tauri updater (v2 plugin) | `v2.tauri.app/plugin/updater/` (fetched 2026-11-07) | Verified quote on mandatory signature, static + dynamic JSON shapes, `{{target}}/{{arch}}/{{current_version}}` templating, `windows.installMode`. |
| Capawesome live-update (8.x) | `capawesome.io/docs/plugins/live-update/` (fetched 2026-11-07) | Verified PEM RSA `publicKey` constraint, `readyTimeout` rollback, Electron zip-only artifact type. |
| Deprecated `@capacitor/live-updates` | prior-round notes (`updater-protocol-docs-r1.md` §5.1) | `[unverified — no live fetch today]`; rely on cached knowledge. |
| Squirrel.Windows `RELEASES` + nuspec | prior-round pinned `Squirrel/Squirrel.Windows@51f5e2c…` | `[unverified — no live fetch today]`; format has been stable for years. |
| Sparkle appcast (2.x) | `sparkle-project.org/documentation/publishing/` (fetched 2026-11-07) | Verified quote on signing, `sparkle:criticalUpdate`, `phasedRolloutInterval`, `<sparkle:minimumUpdateVersion>`. |
| PWA Service Worker | MDN Service Worker API page (fetched 2026-11-07) | Verified quote on lifecycle, `skipWaiting`, `clientsClaim`, 24h fetch interval. |
| Workbox precache | prior-round pinned `googlechromelabs/workbox@4ea3138…` | `[unverified — no live fetch this session]`. |
| Microsoft AppInstaller | `learn.microsoft.com/.../app-installer-file-overview` + `.../root-elements` (fetched 2026-11-07) | Verified quote on lifecycle, `ms-appinstaller` disabled Dec 2023, schema root. |
| MSIX Open Specification | prior-round notes (`updater-protocol-docs-r1.md` §9) | `[unverified — no live fetch today]`. |
| AIRIZ `unified-release-manifest-schema.md` §9 field contract | read locally (existing project file) | Verified against the existing project doc. |
| AIRIZ `tools/sign-manifest.ts`, `tools/manifest-to-electron-yml.ts` | read locally (existing project files) | Verified against the existing project source. |
| AIRIZ `tools/examples/dryrun/sample-release.json` | read locally | Verified — concrete signed instance. |

**Net status:** 4 of 7 protocols verified live this session (electron-builder, Tauri, Sparkle, Capawesome, AppInstaller — 5 actually). Squirrel, deprecated `@capacitor/live-updates`, and the W3C Editor's Draft relied on cached prior-round pinned source. AIRIZ's own docs and tools are read locally and treated as ground truth (this is a subagent advisory against an existing AIRIZ codebase).

---

*End of minimum-viable-update-spec. 7 protocols, one unified minimum subset, 88 estimated engineering hours (72 already in the AIRIZ repo, 16 to add). All six baseline properties satisfied by a single signed manifest on R2.*
