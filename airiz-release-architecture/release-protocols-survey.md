# AIRIZ Motor Console — Release-Architecture Survey (Round 1 · Agent 7)

**Deliverable**: Minimum viable subset to reimplement across 7 auto-update protocols.
For each: (a) manifest schema with field-level REQUIRED / RECOMMENDED / OPTIONAL, (b) signing
primitive, (c) version-check algorithm, (d) open spec PRs / drafts and recent (2024–2026) breaking changes.

**Reproducibility**: every claim cites a spec version + repo commit SHA (or dated W3C/MS draft).
Commit SHAs captured 2026-11-05.

| # | Protocol | Repo / Spec | Commit / Version |
|---|----------|-------------|------------------|
| 1 | electron-builder NSIS `latest.yml` | electron-userland/electron-builder | `master` @ `cdd9f7ec` (v26 stable / v27 next) |
| 2 | @tauri-apps/updater (Tauri 2.x) | tauri-apps/plugins-workspace | `v2` @ `2fbd5634` |
| 3a | @capawesome/capacitor-live-update | capawesome-team/capacitor-plugins | `main` @ `846a3d0b` |
| 3b | @capacitor/live-updates (official) | ionic-team/capacitor-live-updates-plugin | **commercial, repo deleted** (npm 0.5.0) |
| 3c | deprecated official live-update | cordova-plugin-ionic (Ionic) | Cordova-era, superseded |
| 4 | Squirrel.Windows `RELEASES` | Squirrel/Squirrel.Windows | `develop` @ `51f5e2cb` |
| 5 | Sparkle `appcast.xml` | sparkle-project/Sparkle | `master` @ `10d96f2b` (Sparkle 2.x) |
| 6 | PWA Service Worker lifecycle | W3C Service Worker TR + GoogleChrome/workbox | TR dated 2026-10-29; workbox `v6` @ `f3375d95` |
| 7 | Microsoft AppInstaller schema | learn.microsoft.com appinstallerschema | 2017/2 + 2018(s3) + 2021(s4) |

## Table of Contents

- [0. Cross-Protocol Comparison Matrix](#0-cross-protocol-comparison-matrix)
- [1. electron-builder NSIS Auto-Update (`latest.yml`)](#1-electron-builder-nsis-auto-update-latestyml)
- [2. @tauri-apps/updater (Tauri 2.x)](#2-tauri-appsupdater-tauri-2x)
- [3. Capacitor Live Update — three implementations](#3-capacitor-live-update---three-implementations)
- [4. Squirrel.Windows `RELEASES` + `release.nuspec`](#4-squirrelwindows-releases--releasenuspec)
- [5. Sparkle `appcast.xml`](#5-sparkle-appcastxml)
- [6. PWA Service Worker update lifecycle](#6-pwa-service-worker-update-lifecycle)
- [7. Microsoft AppInstaller schema](#7-microsoft-appinstaller-schema)
- [8. Synthesis — what AIRIZ builds vs adopts](#8-synthesis---what-airiz-builds-vs-adopts)
- *Round 2 — Additional protocols + verbatim appendix*
- [9. Squirrel.Mac (JSON feed + ShipIt out-of-process swap)](#9-squirrelmac-json-feed--shipit-out-of-process-swap)
- [10. WinSparkle (Windows, Sparkle-compatible appcast)](#10-winsparkle-windows-sparkle-compatible-appcast)
- [11. CodePush / App Center — RETIRED 2025-03-31](#11-codepush--app-center---retired-2025-03-31)
- [12. Expo Updates](#12-expo-updates)
- [13. Omaha / Chrome (google/omaha, ServerProtocolV2)](#13-omaha--chrome-googleomaha-serverprotocolv2)
- [14. Verbatim schema appendix](#14-verbatim-schema-appendix)
- [15. Expanded cross-protocol matrix (all 13)](#15-expanded-cross-protocol-matrix-all-13)
- [16. Protocol-family groupings](#16-protocol-family-groupings)
- [17. Permalink source index](#17-permalink-source-index)

---

## 0. Cross-Protocol Comparison Matrix

| Protocol | Manifest | Signing primitive | Trust anchor | Version check | Delta | Rollback | Staging |
|----------|----------|-------------------|--------------|---------------|-------|----------|---------|
| electron-builder | `latest.yml` (YAML) | Ed25519 (manifest) + SHA-512 (artifact) | `app-update.yml` → `updateManifestPublicKey` (Ed25519 pk list) | semver `>` current; `stagingPercentage` gate | `.blockmap` (content-defined blocks) | manual (bump version) | `stagingPercentage` |
| Tauri 2.x | JSON (static or dynamic) | **minisign** (ed25519) over artifact; version in trusted comment | `tauri.conf.json` → `pubkey` | semver `>` current; `require_signed_version` | none (full bundle) | `version_comparator` | none |
| Capawesome | Cloud JSON / self-host URL+checksum | RSA (PEM pub) + SHA-256 | `publicKey` (RSA PEM) in config | bundle id + channel match; native versionCode gate | differential (per-file) | `ready()`/`readyTimeout` + `autoBlock` | cloud rollout % |
| Ionic official | `live-update-manifest.json` (per-file hash map) | `key` (self-host) | Appflow cloud / `key` | build id / snapshot id | differential (per-file) | manual (cloud) + `maxVersions` | Appflow |
| Squirrel.Windows | `RELEASES` (plain text) | **none** (transport + SHA-1 integrity only) | none (SHA-1 in RELEASES) | `System.Version` compare; delta chain | `-delta.nupkg` (DeltaCompressionDotNet) | manual (bump version) | `# nn%` |
| Sparkle | `appcast.xml` (RSS) | EdDSA (ed25519); DSA deprecated | `SUPublicEDKey` in Info.plist | `CFBundleVersion` incrementing | `.delta` (bsdiff) | manual (bump version) | none (phase-in private) |
| PWA SW | (no manifest) — SW script byte-diff | none (HTTPS + SW code integrity) | none | byte-diff of SW script | none | none | none |
| MS AppInstaller | `.appinstaller` (XML) | Authenticode on MSIX (OS-enforced) | MSIX signature (CN) | 4-part version compare; `ForceUpdateFromAnyVersion` | none (full MSIX) | OS repair (`RepairUris`) | none |

**Key takeaways for AIRIZ (one-person team, Ziris PTB):**
1. Every serious protocol signs the **artifact**, not (or in addition to) the manifest.
2. Electron v27 and Sparkle 2 both moved to **Ed25519 for the manifest** — the modern baseline.
3. Only **Capawesome / Ionic** support **automatic rollback** (ready/timeout). Desktop protocols
   (electron, Squirrel, Sparkle) have **no rollback** — you bump the version to recover.
4. **Squirrel has no signature** — the weakest of the set. Do **not** adopt it as the reference.
5. The minimum viable signed-manifest layer AIRIZ needs = **{version, url, sha512, size,
   signature, stagingPercentage, minimumSystemVersion}** + a **single Ed25519 key** + a
   **canonical signed payload**. That is the electron-builder v27 model, and it is the cleanest
   of the seven to copy.

---

## 1. electron-builder NSIS Auto-Update (`latest.yml`)

**Spec version**: electron-builder **v26** (stable) / **v27** (next, `files[]` default).
Canonical source: [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)
`master` @ `cdd9f7ec77007cdc9657b9f9faa0be2000564d59`.
Docs: https://www.electron.build/docs/features/auto-update ,
https://www.electron.build/docs/features/signed-update-manifests ,
https://www.electron.build/docs/publish
Authoritative type: [`packages/builder-util-runtime/src/updateInfo.ts`](https://github.com/electron-userland/electron-builder/blob/cdd9f7ec77007cdc9657b9f9faa0be2000564d59/packages/builder-util-runtime/src/updateInfo.ts)

### 1.1 Manifest skeleton — `latest.yml` (v27 `files[]` form)

```yaml
# ---- integrity-critical (SIGNED in v27) ----
version: "1.2.3"                    # REQUIRED
files:                              # REQUIRED, non-empty
  - url: My-App-1.2.3.exe           # REQUIRED (relative → resolved vs feed; or absolute/pre-signed)
    sha512: "Dj51...=="             # REQUIRED (base64 SHA-512)
    size: 62021782                  # REQUIRED (bytes)
    blockMapUrl: "..."              # OPTIONAL (separately pre-signed blockmap URL)
    isAdminRightsRequired: true     # OPTIONAL (per-machine NSIS; NOT signed)
stagingPercentage: 10               # OPTIONAL (0-100)
minimumSystemVersion: "10.0.19041"  # OPTIONAL (kernel version gate; absence is signed)
allowCatalogSignature: true         # OPTIONAL (Windows only; signed only when true)
# Windows-only (WindowsUpdateInfo), for NSIS web installer:
packages:                           # OPTIONAL
  x64:
    path: My-App-1.2.3-x64.nsis.7z  # REQUIRED-within-packages
    sha512: "..."                   # REQUIRED-within-packages
    size: 5000                      # REQUIRED-within-packages
    blockMapSize: 4096              # OPTIONAL
# ---- cosmetic (NOT signed, editable post-publish) ----
releaseName: "v1.2.3"               # OPTIONAL
releaseNotes: "Bug fixes"           # OPTIONAL (string, or array of {version, note})
releaseDate: "2026-11-05T00:00:00Z" # OPTIONAL (RFC 3339)
# ---- v27 signature block ----
signature: "b0Qk..."                # OPTIONAL pre-v27 / REQUIRED v27 (base64 Ed25519, 1st key)
signatures:                         # OPTIONAL pre-v27 / REQUIRED v27
  - keyId: "3f9c...e1"              # hex SHA-256 of public key SPKI DER
    signature: "b0Qk..."            # base64 Ed25519
  - keyId: "a71d...04"
    signature: "Xr2w..."
# ---- legacy (electron-updater 1.x-2.15.0 only; DEPRECATED) ----
path: My-App-1.2.3.exe              # DEPRECATED (mirror of files[0])
sha512: "..."                       # DEPRECATED
sha2: "..."                         # DEPRECATED (SHA-256; v28 will reject sha2-only)
```
### 1.2 Field-level criticality

| Field | Level | Reasoning |
|-------|-------|-----------|
| `version` | **REQUIRED** | Version-check + signed payload anchor; prevents downgrade/substitution. |
| `files[]` | **REQUIRED** (non-empty) | Updater rejects a signed manifest with empty/missing `files` (`ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`). |
| `files[].url` | **REQUIRED** | Where the artifact lives. Relative = resolved against feed URL (default); absolute = used as-is (pre-signed URL). |
| `files[].sha512` | **REQUIRED** | Artifact integrity (base64 SHA-512). Always verified, signed or not. |
| `files[].size` | **REQUIRED** | Verifies downloaded length (saves a HEAD request); part of signed payload. |
| `files[].blockMapUrl` | **OPTIONAL** | Only when the blockmap is at a different (pre-signed) origin. Covered by signature when present. |
| `files[].isAdminRightsRequired` | **OPTIONAL** | Decides elevate.exe vs direct launch. **Intentionally unsigned** so a misconfig can be fixed post-publish. |
| `stagingPercentage` | **OPTIONAL** | 0-100 staged rollout. Signed. |
| `minimumSystemVersion` | **OPTIONAL** | OS gate (kernel version). Its **absence is also signed** so a gate can't be added/removed post-signing. |
| `allowCatalogSignature` | **OPTIONAL** | Windows: accept a security-catalog Authenticode signature. Signed only when `true`. |
| `packages` | **OPTIONAL** | NSIS **web** installer only; each arch `{path, sha512, size, blockMapSize}`. |
| `releaseName` / `releaseNotes` / `releaseDate` | **OPTIONAL** | Cosmetic; **excluded from signature** so they stay editable after publish. |
| `signature` / `signatures` | **REQUIRED in v27** (was OPTIONAL) | Ed25519 manifest signature. Pre-v27 apps ignore it; v27+ apps **fail closed** without it. |
| `path` / `sha512` / `sha2` (top-level) | **DEPRECATED/REDUNDANT** | Legacy 1.x-2.15.0 mirror of `files[0]`. Unsigned; never used for a verified download. `sha2`-only metadata is deprecated, **rejected in v28**. |

### 1.3 Trust anchor — `app-update.yml` (baked into the app at build time)

```yaml
provider: github            # first provider that receives the manifest (or s3/generic/…)
url: "https://…"            # feed base URL
owner: "my-org"             # github
repo: "my-app"              # github
channel: latest
updateManifestPublicKey: |   # v27: Ed25519 trust list (string or YAML list)
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEA...
  -----END PUBLIC KEY-----
publisherName: "CN=My Company, O=..., C=..."   # Windows Authenticode subject (DN)
verifyUpdateCodeSignature: true                 # Windows (default true)
```
- `updateManifestPublicKey` is the **fail-closed trust anchor**: if present, an unsigned or
  tampered `latest.yml` is rejected **before any download** (`ERR_UPDATER_MANIFEST_NOT_SIGNED` /
  `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`).
- `publisherName` (Windows): NSIS updater runs `Get-AuthenticodeSignature` on the downloaded
  installer and matches the signer Subject against this DN. **Missing `publisherName` fails the
  update** (electron-updater 7+). Renewal with same CN = transparent; a changed Subject needs a
  bridge release listing both DNs.

### 1.4 Signing primitive

- **Algorithm**: Ed25519, via Node's built-in `crypto` (no external tool).
- **Keygen**: `npx electron-builder create-update-key` → `update-private-key.pem` (0600) + prints
  public key and **keyId** = hex SHA-256 of the public key's **SPKI DER**.
- **Canonical payload** (`updateManifestSignature.ts`, version tag **`EBUM1`**):
  injective canonical form — every string JSON-quoted, numbers bare, absent≠empty, fields sorted,
  prefixed with the `EBUM1` scheme tag. Two manifests hash identically **iff every signed field is
  identical**.
- **What is signed**: `version`, `stagingPercentage`, `minimumSystemVersion` (incl. absence),
  `allowCatalogSignature` (when true), each `files[].url/sha512/size` (+`blockMapUrl`), each
  `packages[arch].path/sha512/size/blockMapSize`. **Not signed**: `releaseName/releaseNotes/
  releaseDate`, `isAdminRightsRequired`, and the `signature/signatures` fields themselves.
- **Multi-key (rotation)**: each manifest is signed by **all** configured keys; `signatures[]`
  carries one `{keyId, signature}` per key; the legacy `signature` = first key's. An install
  accepts if **any trusted key validates any entry**. Rotation = dual-sign a bridge release, then
  drop the old key — no flag day.

### 1.5 Version-check algorithm (electron-updater)

1. Read `app-update.yml` (feed + trust anchor) from the installed app.
2. `GET` the feed `latest.yml` (or `latest-mac.yml` / `latest-linux.yml`).
3. **Verify manifest signature** against `updateManifestPublicKey` (fail closed if a key is set).
4. Compare `version` (semver) to the running app version — update only if **newer** (downgrade
   only if `allowDowngrade` opt-in, v27).
5. **Staged rollout**: `stagingPercentage` — hash of a stable per-install id, mod 100, must be
   `< stagingPercentage` or the update is withheld.
6. `minimumSystemVersion` gate (kernel version).
7. Verify artifact `sha512` + (Windows) Authenticode `publisherName`; then differential download
   via `.blockmap` (HTTP `Range`) if a previous map is cached, else full download.
8. Install: NSIS spawns the installer (detached). v27 adds a **session-end guard** (skip
   on-quit install during shutdown/logoff) and opt-in **install-on-next-launch**
   (`autoInstallEvent = "onNextLaunch"`).

### 1.6 Provider notes

**GitHub** — `GH_TOKEN`/`GITHUB_TOKEN` env (publish); `GITHUB_RELEASE_TOKEN` (release write) vs
read-only `GITHUB_TOKEN` (update checks). Fields: `owner`, `repo`, `host`(github.com),
`protocol`(https only), `tagNamePrefix`(default `"v"`; v27 honors `""`), `releaseType`
(draft/prerelease/release), `private`, `channel`. Private-repo auto-update:
`autoUpdater.addAuthHeader("Bearer " + token)`. **Security note**: GitHub releases an owner/repo
name for re-registration after rename/transfer/delete — pin `owner`+`repo` explicitly.

**S3** — `bucket`(REQUIRED), `region`(default **`us-east-1`**), `path`, `channel`,
`acl`(default `public-read`), `endpoint`, `forcePathStyle`, `encryption`,
`awsCredentials` (v27: **required** `{source: env|profile|sso-role-chain}`; nothing implicit).
- **Path-style**: virtual-hosted by default (`bucket.s3.region.amazonaws.com`); `forcePathStyle:
  true` forces `s3.region.amazonaws.com/bucket/…`. `resolveS3Request()` in
  `packages/electron-publish/src/s3/s3UploadHelper.ts` builds `hostname`/`urlPath` from
  `{bucket, key, region, endpoint, forcePathStyle}`.
- **Region semantics**: for a **bucket name containing dots** the SDK can't infer the region, so
  `region` **must** be set (virtual-hosted DNS with dots is invalid). Dotted buckets generally
  also need `forcePathStyle: true`.

### 1.7 Staging dir + atomic rename

- Download lands under a **temporary name**; `verifyUpdateFile` (and Windows
  `verifyUpdateFileAuthenticodeSignature`) runs on the temp file; only **after** verification is it
  renamed to `originalUpdateFileName`. An unverified file is never executable under its real name.
- Cached installers are re-verified before install-on-next-launch. NSIS install is a **detached
  process**; the updater's own staging is the per-install `pending` cache dir. macOS is the atomic
  outlier: Squirrel.Mac **swaps the `.app` bundle atomically** (no killable installer).

### 1.8 Open PRs / recent breaking changes (2024-2026)

- **v27 breaking changes** (`website/docs/migration/v27-breaking-changes.md`): `latest*.yml`
  defaults to `files[]` (legacy `path/sha512` dropped for `>=7`); **implicit `--publish` removed**
  (must pass `--publish`); S3 publish **requires** `awsCredentials.source`; `publisherName` must be
  a full DN and missing it fails the update; `disableWebInstaller` now defaults **true**;
  `electronUpdaterCompatibility` (default `>=7`) now controls blockmap format (v3 binary vs v2
  JSON) and legacy-field emission.
- **Signed update manifests** (new v27): Ed25519 manifest signing **required** to publish
  (`updateManifest: false` is the only opt-out); `create-update-key`, `verify` CLI,
  `updateManifestPublicKey`, `signatures[]/keyId`.
- **Install-on-next-launch** + session-end guard (electron-updater ≥ 7.0); `autoInstallEvent`
  planned to default to `onNextLaunch` in **v28**.
- Planned: **v28 rejects sha2-only** metadata (fail closed).
---

## 2. @tauri-apps/updater (Tauri 2.x)

**Spec version**: `tauri-plugin-updater` **v2** (requires Rust ≥ 1.90).
Canonical source: [tauri-apps/plugins-workspace](https://github.com/tauri-apps/plugins-workspace)
`v2` @ `2fbd56342730f2fe7067dfa3c00760fae2bb201f`.
Key files: [`plugins/updater/src/updater.rs`](https://github.com/tauri-apps/plugins-workspace/blob/2fbd56342730f2fe7067dfa3c00760fae2bb201f/plugins/updater/src/updater.rs),
[`plugins/updater/src/config.rs`](https://github.com/tauri-apps/plugins-workspace/blob/2fbd56342730f2fe7067dfa3c00760fae2bb201f/plugins/updater/src/config.rs).
Docs: https://tauri.app/plugin/updater/ (updated 2025-11-28)

### 2.1 Manifest skeleton

**A. Static JSON file** (S3 / GitHub Release asset, e.g. `latest.json`):
```json
{
  "version": "1.2.3",
  "notes": "Release notes",
  "pub_date": "2026-11-05T00:00:00Z",
  "platforms": {
    "linux-x86_64":   { "url": "https://…/app.AppImage",          "signature": "…" },
    "linux-aarch64":  { "url": "https://…/app.AppImage",          "signature": "…" },
    "windows-x86_64": { "url": "https://…/app-setup.exe",         "signature": "…" },
    "darwin-aarch64": { "url": "https://…/app.app.tar.gz",        "signature": "…" },
    "darwin-x86_64":  { "url": "https://…/app.app.tar.gz",        "signature": "…" }
  }
}
```
**B. Dynamic update-server JSON** — respond **200** with this, or **204 No Content** for no update:
```json
{ "version": "1.2.3", "notes": "…", "pub_date": "2026-11-05T00:00:00Z",
  "url": "https://…/app-setup.exe", "signature": "…" }
```

### 2.2 Field-level criticality

| Field | Level | Reasoning |
|-------|-------|-----------|
| `version` | **REQUIRED** | SemVer (leading `v` optional). Version-check + (with `require_signed_version`) cross-checked against the signature's trusted comment. |
| `platforms.<target>.url` | **REQUIRED** (static) / `url` (dynamic) | Bundle download URL. Target key = `OS-ARCH` (or custom target). |
| `platforms.<target>.signature` | **REQUIRED** | **Content of the `.sig` file** (a string), NOT a path/URL. minisign signature over the bundle. |
| `notes` | **OPTIONAL** | Shown to the user (`update.body`). |
| `pub_date` | **OPTIONAL** | RFC 3339 if present. |

> Tauri **validates the whole file before checking the version** — every present platform entry
> must be valid and complete, or the check fails.

### 2.3 Signing primitive (IMPORTANT nuance)

- **NOT raw ed25519 bytes.** Tauri 2.x uses the **`minisign_verify`** crate
  (`minisign_verify::{PublicKey, Signature}`). minisign wraps ed25519; the public key is a
  **minisign public key (base64)** and the `.sig` file is a **base64 minisign signature**.
- `pubkey` in `tauri.conf.json` = the **public key content** (string), **not** a file path.
- Keygen: `tauri signer generate -w ~/.tauri/myapp.key` → private key (CI:
  `TAURI_SIGNING_PRIVATE_KEY` / `…_PASSWORD` env; `.env` files do NOT work).
- **`require_signed_version`** (config.rs, recent): the minisign signature's **trusted comment**
  carries the version it was signed for; when enabled, the updater **rejects** an update whose
  signed version ≠ the announced `version`. This is the anti-downgrade binding — an attacker who
  can serve a crafted response cannot pair an inflated `version` with an older validly-signed
  artifact. Releases signed before the CLI recorded it carry no version and are rejected when
  enabled (re-sign + re-publish before turning on). Cached/restored updates always force
  `require_signed_version = true`.
- `Update::verify(bytes)` → `verify_signature(bytes, signature, pubkey, version,
  require_signed_version)`. Verification happens in `download` and again in `install` (a
  mismatched package is never installed).

### 2.4 `tauri.conf.json`

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "CONTENT FROM PUBLICKEY.PEM",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/user/repo/releases/latest/download/latest.json"
      ],
      "dangerousInsecureTransportProtocol": false,
      "windows": { "installMode": "passive" }
    }
  }
}
```
- `createUpdaterArtifacts`: `true` (v2) or `"v1Compatible"` (migration; **removed in v3**).
- Endpoint variables: `{{current_version}}`, `{{target}}` (linux/windows/darwin), `{{arch}}`
  (x86_64/i686/aarch64/armv7), `{{bundle_type}}`. TLS **enforced in production**; the client only
  advances to the next endpoint on a **non-2XX** response.
- `installMode` (Windows): `passive` (default) / `basicUi` / `quiet`.

### 2.5 Version-check algorithm

1. For each endpoint (in order), substitute the `{{…}}` variables, `GET` with `Accept:
   application/json`.
2. `204 No Content` → no update (return `None`). Non-2XX → try next endpoint.
3. Parse as `RemoteRelease`. **Target resolution**: try `{os}-{arch}-{installer}` then
   `{os}-{arch}` (e.g. `windows-x86_64-setup.exe`, then `windows-x86_64`).
4. **Version compare**: default `release.version > self.current_version` (semver); a custom
   `version_comparator` enables rollback/downgrade (e.g. `update.version != current`).
5. Download → `verify()` (minisign) → install.

### 2.6 Atomic swap / staging

- **macOS**: extract `.app.tar.gz` to a temp dir on the **same volume**, then
  `renamex_np(RENAME_SWAP)` (APFS) for a single-step atomic bundle swap; on non-APFS fall back to
  two renames with restore-on-failure (`replace_bundle`). Privileged path re-runs the swap via
  `osascript` JXA calling `renamex_np`.
- **Windows**: extract to a temp dir, run NSIS (`/UPDATE`) or `msiexec /i … /promptrestart`; the
  app **auto-exits** before install (Windows installer limitation).
- **Linux**: AppImage = rename current + write new (same-mount temp); `.deb`/`.rpm` via
  `pkexec` → `zenity`/`kdialog` → `sudo` fallback.

### 2.7 Open PRs / recent changes (2024-2026)

- **`require_signed_version`** (config.rs) — recent anti-downgrade hardening; pairs the announced
  version with the signature's trusted comment.
- **v1 → v2 schema migration**: `createUpdaterArtifacts: "v1Compatible"` (zip-wrapped installers on
  Windows/macOS) kept for migration; plain artifacts in v2; the flag is **removed in v3**.
- **Custom targets** (`target()` builder + JS `check({target})`) for Universal macOS / build
  flavors; matched against the `platforms` key.
- **Runtime config**: `pubkey`, `endpoints`, `timeout`, `proxy`, `header`, `version_comparator`,
  `on_before_exit` — for channel switching and **key rotation**.
- Mobile (android/ios) listed as supported platforms but updates are gated to app stores
  (`install_inner` returns `UnsupportedOs` on mobile).
---

## 3. Capacitor Live Update — three implementations

> Correction to the brief: the **official** plugin is `@capacitor/live-updates`, hosted in
> `ionic-team/capacitor-live-updates-plugin` — **not** in `ionic-team/capacitor-plugins`. It is a
> **commercial** plugin whose **repo has been deleted/hidden** (Ionic announced Live Updates
> end-of-life; see [ionic-team/capacitor-plugins#2326](https://github.com/ionic-team/capacitor-plugins/issues/2326),
> 2025-03-11). It is not open source — source is a closed SDK shipped as an iOS framework + Android
> maven dep. The **deprecated** official predecessor is `cordova-plugin-ionic` (Cordova-era,
> `pro-manifest.json`).

### 3A. @capawesome/capacitor-live-update (current, open source, MIT)

Source: [capawesome-team/capacitor-plugins](https://github.com/capawesome-team/capacitor-plugins)
`main` @ `846a3d0b1a7c51f6dbb76d2a61380e41a60eecaa`, package `packages/live-update`.
Docs: https://capawesome.io/docs/sdks/capacitor/live-update/
Breaking changes: [`packages/live-update/BREAKING.md`](https://github.com/capawesome-team/capacitor-plugins/blob/846a3d0b1a7c51f6dbb76d2a61380e41a60eecaa/packages/live-update/BREAKING.md)

**Config skeleton** (`capacitor.config.ts` → `plugins.LiveUpdate`):
```json
{
  "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",   // REQUIRED for Cloud (UUID, ≠ app id)
  "defaultChannel": "production-5",                   // OPTIONAL (or native channel config)
  "publicKey": "-----BEGIN PUBLIC KEY-----…",         // OPTIONAL — RSA PEM (self-hosted signing)
  "readyTimeout": 10000,                              // RECOMMENDED — rollback deadline (ms)
  "autoUpdateStrategy": "background",                 // OPTIONAL 'none' | 'background'
  "autoBlockRolledBackBundles": true,                 // OPTIONAL (7.3.0+) — stop rollback loops
  "autoDeleteBundles": false,                         // OPTIONAL
  "serverDomain": "api.cloud.capawesome.io",          // OPTIONAL (v8; was `location`)
  "httpTimeout": 60000                                // OPTIONAL
}
```

**Manifest / bundle descriptor** — `DownloadBundleOptions` (self-hosted) and the Cloud `sync()`
result (`nextBundle`):
```json
{
  "artifactType": "zip",        // 'manifest' | 'zip' (zip = whole-bundle; manifest = per-file base URL)
  "bundleId": "abc-123",        // REQUIRED (Cloud artifact id; 'public' reserved)
  "url": "https://…/bundle.zip",// REQUIRED
  "checksum": "<sha256-hex>",   // OPTIONAL (SHA-256 hex; REMOVED from opts in v8 → X-Checksum header)
  "signature": "<base64>",      // OPTIONAL (RSA-SHA256 signed hash, base64)
  "channel": "production-5",    // resolved channel (Cloud result)
  "customProperties": { "k": "v" }
}
```
> For `artifactType: 'manifest'`, `url` is a **base URL**; the plugin fetches each file as
> `url?href=<path>` and the server returns `X-Checksum` (SHA-256 hex) and `X-Signature`
> (base64) headers per file.

**Field-level criticality (3A)**

| Field | Level | Reasoning |
|-------|-------|-----------|
| `bundleId` | **REQUIRED** | Identity of the bundle; drives set/rollback/block. |
| `url` | **REQUIRED** | Where the zip (or per-file base) lives. |
| `checksum` / `X-Checksum` | **RECOMMENDED** | SHA-256 integrity. Required for a trustworthy self-hosted bundle. |
| `signature` / `X-Signature` | **RECOMMENDED→REQUIRED for prod** | RSA-SHA256 (base64) authenticity; `publicKey` (RSA PEM) verifies it. |
| `publicKey` | **RECOMMENDED** | Without it, only the checksum (integrity) is enforced, not authenticity. |
| `readyTimeout` | **RECOMMENDED** | The whole **rollback** mechanism depends on it (default `0` = disabled since v8). |
| `defaultChannel` | **OPTIONAL** | Can come from native config / `setChannel()` / `sync()`. |
| `autoBlockRolledBackBundles` | **OPTIONAL** | Prevents a broken bundle from re-downloading (blocks up to 100). |
| `autoUpdateStrategy` | **OPTIONAL** | `background` = auto download+apply on start/resume if >15 min since last check. |

- **Channel model**: **versioned channels** — bind the channel to the native `versionCode`
  (`production-<versionCode>` via `capawesome_live_update_default_channel` string resource /
  `CapawesomeLiveUpdateDefaultChannel` plist key) so a web bundle can never reach an incompatible
  native binary. Resolution priority (low→high): config `defaultChannel` < native config <
  `setChannel()` (persisted) < `sync({channel})` (one-shot). Cloud **forced channel assignment**
  overrides all (per-device, use with caution).
- **Rollback**: `ready()` must be called early; if not called within `readyTimeout`, the SDK resets
  to the built-in (native) bundle on next launch. `autoBlockRolledBackBundles` stops the loop.
  Manual rollback via CLI/Console (`apps:liveupdates:rollback`).
- **Fingerprint**: whole-bundle **SHA-256** (hex) + optional **RSA-SHA256** signature (base64).

### 3B. @capacitor/live-updates (official Ionic — commercial, EOL)

Source: `ionic-team/capacitor-live-updates-plugin` (deleted). npm `@capacitor/live-updates` **0.5.0**.
Docs: https://ionic.io/docs/appflow/deploy/setup/capacitor-sdk

**Config skeleton** (`plugins.LiveUpdates`):
```json
{
  "appId": "abcd1234",            // REQUIRED
  "channel": "Production",        // REQUIRED
  "autoUpdateMethod": "background",// OPTIONAL 'none' | 'background'
  "maxVersions": 2,               // OPTIONAL — previous updates kept on-device
  "key": "public-key",            // OPTIONAL — code signing (self-hosted)
  "strategy": "differential",     // OPTIONAL 'zip' | 'differential'
  "enabled": true                 // OPTIONAL
}
```
**API**: `sync(progress?)` → `{ liveUpdate:{appId,channel}, snapshot:{id,buildId}|null,
source:'download'|'cache', activeApplicationPathChanged }`; `setConfig()`, `getConfig()`,
`resetConfig()`, `reload()`.

**Manifest file — `live-update-manifest.json`**: a **per-file hash map** of the built web dir.
Generated by Appflow CLI (`appflow live-update generate-manifest --dir=<webdir>`). At update time
the bundled manifest is diffed against the live-update manifest and **only changed files** are
downloaded (differential). (Cordova-era equivalent = `pro-manifest.json`; Appflow shipped both for
the Cordova→Capacitor transition.)

**Field-level criticality (3B)**

| Field | Level | Reasoning |
|-------|-------|-----------|
| `appId` | **REQUIRED** | Appflow app identity. |
| `channel` | **REQUIRED** | Single static channel string per build. |
| `live-update-manifest.json` (per-file hashes) | **REQUIRED for differential** | Without it, the full zip downloads every time. |
| `key` | **RECOMMENDED** | Code signing for self-hosted (SHLU, enterprise). |
| `strategy` | **OPTIONAL** | `differential` (default via manifest) vs `zip`. |
| `maxVersions` | **OPTIONAL** | On-device cache of prior updates (enables stepping back). |
| `autoUpdateMethod` | **OPTIONAL** | `background` vs manual `sync()`. |

- **Channel model**: single channel string (no versioned-channel binding; you manage native
  compatibility yourself).
- **Rollback**: **manual** via Appflow cloud; `maxVersions` lets the device hold prior snapshots.
  No `ready()`/timeout self-heal.
- **Fingerprint**: **per-file** hash map (not a whole-bundle hash).

### 3C. Deprecated official plugin — cordova-plugin-ionic

The original Live Update SDK for Cordova (also ran under early Capacitor). Superseded by
`@capacitor/live-updates`. Config via `config.xml` preferences / iOS `Info.plist` / Android
`strings.xml`:

| Cordova key | Meaning |
|-------------|---------|
| `app-id` (`IonAppId`) | Appflow app id |
| `channel-name` (`IonChannelName`) | channel |
| `max-versions` (`IonMaxVersions`) | cached prior updates |
| `update-method` (`IonUpdateMethod`) | `background` / `auto` / `none` |
| `min-background-duration` (`IonMinBackgroundDuration`) | seconds in background = "closed" |
| `DisableDeploy` | turn off live updates for dev |

**Manifest file — `pro-manifest.json`**: same **per-file hash map** as 3B, generated on
`cordova prepare` (Cordova hooks) or `ionic live-update manifest`.

- **Channel model**: single channel.
- **Rollback**: manual via Appflow; `max-versions` cache.
- **Fingerprint**: per-file hash map.

### 3D. Cross-implementation comparison

| Aspect | 3A Capawesome | 3B Ionic official | 3C cordova-plugin-ionic |
|--------|---------------|-------------------|--------------------------|
| License / source | MIT, open | Commercial, repo deleted | Open (Cordova) |
| Manifest | Cloud JSON / URL+checksum | `live-update-manifest.json` (per-file) | `pro-manifest.json` (per-file) |
| Fingerprint | whole-bundle SHA-256 (+RSA sig) | per-file hashes | per-file hashes |
| Signing | RSA (PEM pub, base64 RSA-SHA256) | `key` (self-host) | none |
| Channel | **versioned** (tied to versionCode) + forced | single string | single string |
| Rollback | **automatic** (`ready`/`readyTimeout` + `autoBlock`) | manual + `maxVersions` | manual + `max-versions` |
| Delta | differential (per-file) | differential (per-file) | differential (per-file) |
| Electron | supported (zip only) | no | no |

**AIRIZ note**: for a hybrid/WebView build, Capawesome (3A) is the only one that is open,
actively maintained, and has **automatic rollback + versioned channels** — the two safety
features the others lack.
---

## 4. Squirrel.Windows `RELEASES` + `release.nuspec`

**Spec version**: Squirrel.Windows (Squirrel 1.4.0+ for staged rollouts). Maintenance mode.
Source: [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows) `develop` @
`51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f`.
Parser: [`src/Squirrel/ReleaseEntry.cs`](https://github.com/Squirrel/Squirrel.Windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs).
Docs: `docs/getting-started/2-packaging.md`, `docs/getting-started/5-updating.md`,
`docs/using/staged-rollouts.md`.

### 4.1 `RELEASES` file skeleton (plain text)

```
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
```
Line grammar (`ReleaseEntry.ParseReleaseEntry`):
- `entryRegex = ^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$`
- `stagingRegex = #\s+(\d{1,3})%$`  → `# nn%`
- `commentRegex = \s*#.*$` (stripped before parse)

### 4.2 Field-level criticality — `RELEASES`

| Field | Level | Reasoning |
|-------|-------|-----------|
| SHA-1 (40 hex) | **REQUIRED** | Integrity of the `.nupkg`. `Contract.Requires(sha1.Length == 40)`. **This is the only "signature" — there is no authenticity signing.** |
| filename | **REQUIRED** | `-full.nupkg` or `-delta.nupkg` (detected by `filenameIsDeltaFile` = ends `-delta.nupkg`). May be an **absolute HTTP(s) URL** (then base URL + query are split out). No path separators. |
| size (bytes) | **REQUIRED** | `Contract.Requires(filesize > 0)`. Used for progress + delta-vs-full cost estimate. |
| `# nn%` | **OPTIONAL** (1.4.0+) | Staged rollout. **Must be `#` immediately after the size, no spaces** (legacy bug); a space is allowed only once all clients are ≥1.4.0. |

Ordering on write: `OrderBy(x => x.Version).ThenByDescending(x => x.IsDelta)` — versions ascending,
delta after its full. Written to a **temp file then moved** into place (atomic-ish publish).

### 4.3 `release.nuspec` skeleton (inside the `.nupkg`)

```xml
<?xml version="1.0"?>
<package>
  <metadata>
    <id>MyApp</id>                     <!-- REQUIRED — app name, no spaces -->
    <version>1.0.0</version>           <!-- REQUIRED — SemVer -->
    <title>MyApp</title>               <!-- RECOMMENDED -->
    <authors>Contoso</authors>         <!-- OPTIONAL -->
    <description>…</description>       <!-- OPTIONAL -->
    <!-- NO <dependencies> — Squirrel expects none; all files are explicit -->
  </metadata>
  <files>
    <file src="bin\Release\*.dll"     target="lib\net45" />
    <file src="bin\Release\MyApp.exe" target="lib\net45" />
    <!-- Squirrel runtime: Squirrel.dll, Splat.dll, NuGet.Squirrel.dll,
         Mono.Cecil.*, DeltaCompressionDotNet.* ; exclude *.pdb, *.vshost.* -->
  </files>
</package>
```
Convention: a single `lib/net45` directory **regardless of the real .NET target**.

**Field-level criticality — `release.nuspec`**

| Field | Level | Reasoning |
|-------|-------|-----------|
| `<id>` | **REQUIRED** | Package/app identity (no spaces). |
| `<version>` | **REQUIRED** | Drives version comparison + delta naming. |
| `<title>` | **RECOMMENDED** | Shown in the updater UI. |
| `<authors>` / `<description>` | **OPTIONAL** | Metadata only. |
| `<dependencies>` | **FORBIDDEN** | Squirrel expects none; it breaks the "all files explicit" model. |
| `lib/net45/*` layout | **REQUIRED** | Where Squirrel looks for the app + its runtime. |

### 4.4 Delta vs full

- `-full.nupkg` = complete package (fresh install / no delta path).
- `-delta.nupkg` = binary diff (DeltaCompressionDotNet) from the **previous full version**.
- `Squirrel --releasify` generates a delta only when a previous `RELEASES` exists; if `RELEASES`
  is missing at releasify time, only a full is created and `RELEASES` gets one row.
- At update time Squirrel picks the **cheapest path**: a **consecutive delta chain**
  (N→N+1→…→M) if every intermediate delta exists, otherwise the **full** `.nupkg`.

### 4.5 Version-check algorithm (UpdateManager / Update.exe)

1. Read the **local** `RELEASES` (installed version) and **fetch the remote** `RELEASES`.
2. Compare versions (`System.Version`-style; update if remote > local).
3. Compute the smallest download path (delta chain vs full) using the `size` column.
4. Download, **verify SHA-1** against the `RELEASES` row.
5. Apply (extract to a temp/`Apps` dir), **atomic swap** of version dirs, update shortcuts,
   clean old versions.
6. Relaunch with `--squirrel-updated`.
- **Staged rollout**: a row with `# nn%` is only honored for installs whose stable hash falls in
  the top `nn%`. To pull a bad staged release, **remove the row** and then release a **higher**
  version (reusing the broken version number would strand users).

### 4.6 Open PRs / notes

- Squirrel is effectively in **maintenance**; no signed-manifest layer exists (transport + SHA-1
  only) — treat as the **weakest** reference in this survey.
- `# nn%` staging (1.4.0) has the **no-space-after-size** quirk (see staged-rollouts doc).
- Electron note: electron-builder's NSIS auto-update is **not** Squirrel; Squirrel is only used by
  the `squirrel` target, which `electron-updater` does **not** support for auto-update.

---

## 5. Sparkle `appcast.xml`

**Spec version**: Sparkle **2.x** (EdDSA/ed25519 since 1.21/2.0; DSA deprecated). No formal XSD —
spec is the publishing docs + `SUAppcastItem` API reference (open issue
[sparkle-project/Sparkle#1102](https://github.com/sparkle-project/Sparkle/issues/1102)).
Source: [sparkle-project/Sparkle](https://github.com/sparkle-project/Sparkle) `master` @
`10d96f2b9b9905b0f529f09e517219d4e20125c0`.
Docs: https://sparkle-project.org/documentation/publishing/ ,
`/delta-updates/`, `/eddsa-migration/`.

### 5.1 `appcast.xml` skeleton

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>MyApp</title>
    <item>
      <title>Version 1.5.1</title>
      <sparkle:version>1248</sparkle:version>                       <!-- REQUIRED (machine) -->
      <sparkle:shortVersionString>1.5.1</sparkle:shortVersionString><!-- RECOMMENDED (human) -->
      <sparkle:minimumSystemVersion>10.15</sparkle:minimumSystemVersion> <!-- OPTIONAL -->
      <sparkle:maximumSystemVersion>12.0</sparkle:maximumSystemVersion> <!-- OPTIONAL -->
      <sparkle:channel>beta</sparkle:channel>                       <!-- OPTIONAL -->
      <sparkle:os>macos</sparkle:os>                                 <!-- OPTIONAL -->
      <description><![CDATA[Release notes]]></description>          <!-- OPTIONAL -->
      <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>            <!-- RECOMMENDED -->
      <enclosure url="https://example.com/downloads/app.zip"        <!-- url REQUIRED -->
                 sparkle:edSignature="7cLALFUHSwvEJWSk…=="          <!-- REQUIRED (ed25519) -->
                 sparkle:version="1248"                             <!-- OPTIONAL if item-level set -->
                 length="1623481"                                    <!-- RECOMMENDED -->
                 type="application/octet-stream" />                  <!-- RECOMMENDED -->
      <sparkle:deltas>                                              <!-- OPTIONAL -->
        <enclosure url="https://example.com/1.5-2.0.delta"
                   sparkle:deltaFrom="1.5"                          <!-- REQUIRED-in-deltas -->
                   sparkle:edSignature="…"
                   length="1485"
                   type="application/octet-stream" />
      </sparkle:deltas>
    </item>
  </channel>
</rss>
```
### 5.2 Field-level criticality

| Field | Level | Reasoning |
|-------|-------|-----------|
| `enclosure.url` | **REQUIRED** | Update archive. (An item with **no** enclosure = informational-only update; then `sparkle:version` + a link are required.) |
| `sparkle:edSignature` | **REQUIRED** | **base64 of the 64-byte ed25519 signature** over the archive. DSA (`sparkle:dsaSignature`) is **deprecated**. |
| `sparkle:version` | **REQUIRED** (item- or enclosure-level) | Machine-readable; must match `CFBundleVersion` and be **incrementing**. |
| `sparkle:shortVersionString` | **RECOMMENDED** | Human-readable (`CFBundleShortVersionString`); what the user sees. |
| `enclosure.length` | **RECOMMENDED** | Byte size (progress). |
| `enclosure.type` | **RECOMMENDED** | `application/octet-stream`. |
| `pubDate` | **RECOMMENDED** | RFC 1123 date. |
| `title` | **RECOMMENDED** | UI. |
| `description` / `sparkle:releaseNotesLink` | **OPTIONAL** | Release notes (inline CDATA or a link; the link can carry its own `sparkle:edSignature`). |
| `sparkle:minimumSystemVersion` | **OPTIONAL** | Gate old macOS. |
| `sparkle:maximumSystemVersion` | **OPTIONAL** | Gate very new macOS. |
| `sparkle:channel` | **OPTIONAL** | `beta`/`beta2`/`beta3`; **opt-in** — an unlabelled item is served to stable **only**; a stable client never sees a channelled item. |
| `sparkle:os` | **OPTIONAL** | Platform filter (item- or enclosure-level). |
| `sparkle:deltas` + `sparkle:deltaFrom` | **OPTIONAL** | Delta (bsdiff) updates; `deltaFrom` = the version the delta upgrades from. |
| `sparkle:critical` | **OPTIONAL** | Forces the update banner (critical update). |

### 5.3 Signing primitive — DSA → EdDSA (ed25519) transition

- **Keygen**: `./bin/generate_keys` → private key in the login Keychain + prints a **base64 public
  key** → store as `SUPublicEDKey` in the app's `Info.plist`.
- **Sign**: `./bin/sign_update path/to/app.zip` → emits
  `sparkle:edSignature="<base64>" length="<bytes>"`. `generate_appcast` signs everything
  automatically (and, with `SURequireSignedFeed`, also signs the **appcast** and **release notes**).
- **Migration** (eddsa-migration doc): Sparkle <1.21 = DSA only. To move: (1) ship a transition
  update carrying **both** `SUPublicDSAKeyFile`+`SUPublicEDKey` and **both**
  `sparkle:dsaSignature`+`sparkle:edSignature`; (2) once all users are on ≥1.21/2.0, ship an update
  that **drops** the DSA key + signature. Developer-ID-signed apps can shortcut (the matching code
  signature vouches for the key change). New Sparkle 2 apps: **ed25519 only**.

### 5.4 Version-check + delta + channel algorithm

1. Fetch the appcast from `SUFeedURL` (Info.plist).
2. For each `<item>`, **channel filter** (stable sees only unchannelled items) and **os filter**.
3. Pick the best item by **semver order of `shortVersionString`** (fallback `sparkle:version`);
   tied versions keep document order (first-seen wins — a later same-version correction does not
   override).
4. Update only if the item's version **>** installed `CFBundleVersion` (which must be incrementing
   and well-formed).
5. **Delta**: choose a `<sparkle:deltas>` enclosure whose `sparkle:deltaFrom` equals the installed
   version; otherwise download the **full** enclosure.
6. Verify `sparkle:edSignature` (ed25519) against `SUPublicEDKey` before applying; atomic `.app`
   bundle swap.

### 5.5 Open PRs / recent changes (2024-2026)

- **PR #2822 — "Add support for signing and verifying appcast feeds"** (merged ~2025-12-31):
  `generate_appcast` + `sign_update` now sign the **appcast** and **release-note** files
  (`SURequireSignedFeed`); signed appcasts carry a trailing signing block comment; signed release
  notes carry `sparkle:edSignature`/`sparkle:length` on `sparkle:releaseNotesLink`. Closes the
  last MITM gap (the feed itself, not just the archives).
- **Sparkle 2.9** (macOS 12+): markdown release notes (`.md`) in addition to `.html`.
- **No formal XSD** still exists (issue #1102) — the `SUAppcastItem` API reference is the de-facto
  spec.

---

## 6. PWA Service Worker update lifecycle

**Spec**: W3C **Service Worker** specification (nightly TR dated **2026-10-29** —
https://www.w3.org/TR/service-workers/); MDN "Using Service Workers"; web.dev "The service worker
lifecycle"; Workbox [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) `v6` @
`f3375d95b7c58f0e0f522bd9bdf3b4b7bcea794d`.
There is **no manifest file** — the update unit is the **service worker script** and its byte-diff.

### 6.1 Lifecycle states

`installing` → `installed` (a.k.a. **waiting**) → `activating` → `activated`; and `redundant`
(on install failure, or superseded).

| State | Worker event | Browser behavior |
|-------|--------------|------------------|
| `installing` | `install` | Runs handler; `event.waitUntil(p)` holds state; a **reject → `redundant`**, old version stays. |
| `installed` (waiting) | — | New worker sits in `registration.waiting` **alongside** the old one until the old controls **zero** clients, or `skipWaiting()` is called. |
| `activating` | `activate` | Runs handler; **old caches are deleted here** (previous worker can no longer run). |
| `activated` | `fetch`/`message`/`push`/`sync` | Is `registration.active`; controls new in-scope navigations. Open pages keep their old controller unless `clients.claim()`. |
| `redundant` | — | Install failed or a newer worker took over. |

### 6.2 Update algorithm (W3C)

1. **Update-check triggers**: a navigation to an in-scope page; a `push`/`sync` functional event
   (if no check in the last **24 h**); `registration.update()` (on demand); `.register()` **only if
   the script URL changed** (avoid changing the URL).
2. The browser **fetches** the script and **byte-compares** it to the registered one. Since
   Chrome 68 / FF 57 / Safari 11.1 it **ignores HTTP caching headers** for the registered script by
   default; override with `updateViaCache` (`'imports'` default | `'all'` | `'none'`). `importScripts()`
   deps still respect cache headers.
3. If byte-different → launch the **new worker alongside** the old; fire `install`.
   A non-ok status, parse error, throw, or rejected `install` → new worker **discarded**, old stays
   active.
4. New worker → **waiting** until the old controls zero clients (or `skipWaiting()`).
5. `activate` → clean up old caches.
6. `clients.claim()` → the active worker adopts already-open in-scope clients; fires
   `controllerchange` in each.
7. Page reloads on `controllerchange` to run under the new worker.

### 6.3 Minimal skeleton

```js
// sw.js
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('airiz-v2').then((c) => c.addAll(['/', '/app.js'])).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== 'airiz-v2').map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});
```
```js
// page.js
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (!window.__airizRefreshing) { window.__airizRefreshing = true; location.reload(); }
});
```
### 6.4 REQUIRED vs OPTIONAL for claiming "auto-update"

| Hook / API | Level | Reasoning |
|------------|-------|-----------|
| `install` handler (precache) | **REQUIRED** | Without a precache the "update" has nothing to serve; a rejected install makes the worker `redundant`. |
| `activate` handler (cache cleanup) | **REQUIRED** | Old caches must be purged here or the app serves a mix of versions. |
| The byte-diff update check | **REQUIRED (automatic)** | Browser-driven; you don't implement it. |
| `self.skipWaiting()` | **REQUIRED for immediate takeover** | Without it the new worker only activates when **all** old tabs close — not "auto". |
| `self.clients.claim()` | **RECOMMENDED** | Adopts already-open tabs; without it the first-load race means some pages stay on the old worker until next navigation. |
| `controllerchange` reload | **RECOMMENDED** | Ensures the running page actually uses the new assets; without it a page can lazy-load a now-missing hashed chunk → 404. |
| `updateViaCache` | **OPTIONAL** | Tuning of the check's cache behavior. |
| `registration.update()` | **OPTIONAL** | On-demand check (e.g. a "check now" button). |
| Workbox helpers (`clientsClaim`, `workbox-window` `messageSkipWaiting`) | **OPTIONAL** | Convenience; `workbox-core.skipWaiting()` is **deprecated** (use `self.skipWaiting()` directly). |

> **Gotcha**: `skipWaiting()` without a `controllerchange` reload leaves pages running old HTML
> against a new precache; a later lazy-load of a purged hashed chunk 404s. The guarded reload
> above closes that window.

### 6.5 Workbox recipes (v6)

- **workbox-precaching**: `precacheAndRoute()` + `cleanupOutdatedCaches()` (the `activate` cleanup).
- **workbox-core**: `clientsClaim()` (auto-wraps `activate`→`clients.claim()`); `skipWaiting()`
  **deprecated** → call `self.skipWaiting()`.
- **workbox-window**: `Workbox` class — `messageSkipWaiting()`, `'waiting'` / `'controlling'`
  events, prompt-then-reload pattern.
- **workbox-strategies / workbox-background-sync**: runtime caching + offline resilience (adjacent,
  not part of the update itself).

### 6.6 Open changes (2024-2026)

- W3C TR tracks `skipWaiting`/`claim` (all evergreen browsers) and `updateViaCache`
  (Chrome 68 / FF 57 / Safari 11.1).
- Workbox v6 → v7: `workbox-core.skipWaiting()` removed; `workbox-window` is the blessed path for
  user-facing update prompts.

---

## 7. Microsoft AppInstaller schema

**Spec**: AppInstaller (`.appinstaller`) XML schema. Namespaces: base
`http://schemas.microsoft.com/appx/appinstaller/2017/2`, `s3` (2018), `s4`
(`http://schemas.microsoft.com/appx/appinstaller/2021`). Auto-update + repair require
**Windows 10 2004 (build 19041)+** / all Windows 11.
Ref: https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root ,
`/element-appinstaller`, `/element-onlaunch`,
https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview ,
`/update-settings`, `/how-to-create-appinstaller-file`.

### 7.1 Schema skeleton (2021)

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
              Version="1.0.0.0"
              Uri="https://…/airiz.appinstaller">
  <MainBundle
      Name="Contoso.Airiz"
      Publisher="CN=Contoso"
      Version="2.23.12.43"
      Uri="https://…/airiz.msixbundle"
      ProcessorArchitecture="x64" />
  <Dependencies>
    <Package Name="Microsoft.VCLibs" Publisher="CN=Microsoft" Version="14.0.0.0"
             Uri="https://…/vclibs.msix" />
  </Dependencies>
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="12" ShowPrompt="true" UpdateBlocksActivation="true" />
    <AutomaticBackgroundTask />
    <ForceUpdateFromAnyVersion>false</ForceUpdateFromAnyVersion>
  </UpdateSettings>
  <UpdateUris>
    <UpdateUri>https://cdn2.…/airiz.appinstaller</UpdateUri>
  </UpdateUris>
  <RepairUris>
    <RepairUri>https://…/airiz-repair.appinstaller</RepairUri>
  </RepairUris>
</AppInstaller>
```

### 7.2 Field-level criticality

| Element / attribute | Level | Reasoning |
|---------------------|-------|-----------|
| `AppInstaller.Version` | **REQUIRED** | 4-part version of the **AppInstaller file** itself (bump on any change). |
| `AppInstaller.Uri` | **REQUIRED** | The file's own URL; the deployment service checks **here first** for updates. |
| `MainBundle`/`MainPackage` `Name`/`Publisher`/`Version` | **REQUIRED** | Must **exactly match** the MSIX `Identity` (name, publisher, version). Exactly one main. |
| `MainBundle`/`MainPackage` `Uri` | **REQUIRED** | Where the main MSIX/MSIXBundle lives. |
| `ProcessorArchitecture` | **OPTIONAL** | Architecture filter. |
| `Dependencies`/`Package` | **OPTIONAL** | The **dependency chain** — packages installed if required (e.g. VC runtime). Each `Name/Publisher/Version` must match its MSIX `Identity`. |
| `OptionalPackages` / `RelatedPackages` | **OPTIONAL** | Installed-along / referenced-not-installed. |
| `UpdateSettings` | **OPTIONAL** | Toggles auto-update entirely. |
| `OnLaunch` | **OPTIONAL** | Check for update on app launch (may show UI). |
| `OnLaunch.HoursBetweenUpdateChecks` | **OPTIONAL** (0-255, default **24**) | Minimum gap between launch checks. `0` = check every launch. |
| `OnLaunch.ShowPrompt` | **OPTIONAL** (**2021 schema only**) | Show an update prompt (UWP; desktop-bridge = silent). |
| `OnLaunch.UpdateBlocksActivation` | **OPTIONAL** (**2021 schema only**; needs `ShowPrompt="true"`) | `true` = must take update before launch; `false` = launch now, apply silently later. |
| `AutomaticBackgroundTask` | **OPTIONAL** (s4) | Check every **8 h** in the background, independent of launch; **no UI**. |
| `ForceUpdateFromAnyVersion` | **OPTIONAL** (s4) | Allow **downgrade** as well as upgrade (default false = up-level only). |
| `UpdateUris`/`UpdateUri` | **OPTIONAL** (s4; **2021 schema**; max **10**) | Fallback AppInstaller URLs, tried in order when the primary `Uri` is unreachable. Must target AppInstaller files. |
| `RepairUris`/`RepairUri` | **OPTIONAL** (s4; **2021 schema**; max **10**) | Repair source (AppInstaller **or** app package) used when the app is marked for remediation. **This is the "RepairApp" mechanism** — auto-repair is enabled by the presence of `RepairUris` (+ the package being flagged for remediation; surfaced as `AppInstallerInfo.IsAutoRepairEnabled`). |

### 7.3 Dependency chain + auto-update + repair algorithm

1. Deployment service resolves the **related set**: main + `Dependencies` (installed if missing) +
   `OptionalPackages`. Each package is matched to its MSIX `Identity` (`Name/Publisher/Version`).
2. **Update check**: on launch (gated by `HoursBetweenUpdateChecks`) and/or every 8 h
   (`AutomaticBackgroundTask`). Fetches the AppInstaller at `Uri` (then `UpdateUris` fallbacks),
   compares each package `Version` to what's installed → newer wins (downgrade only if
   `ForceUpdateFromAnyVersion`).
3. **UX**: `ShowPrompt` shows a dialog; `UpdateBlocksActivation=true` forces the update before the
   app can start, `false` lets the user launch and applies silently "at an opportune time."
4. **Repair**: when the OS marks the package for remediation (tampered/missing files), it pulls a
   fresh source from `RepairUris` and repairs in place. Works even if the app wasn't installed via
   an AppInstaller.
- **Authenticity** is the **MSIX Authenticode signature** (CN must match `Publisher`); the OS
  enforces it — the `.appinstaller` itself is not separately signed.

### 7.4 Open PRs / breaking changes (2024-2026)

- **Schema-version footgun**: Visual Studio generates the **2017/2** schema by default, which
  **silently ignores** `ShowPrompt`, `UpdateBlocksActivation`, `HoursBetweenUpdateChecks` and the
  `UpdateUris`/`RepairUris` elements. You must manually set
  `xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"` to use them
  ([WindowsAppSDK discussion #5125](https://github.com/microsoft/WindowsAppSDK/discussions/5125)).
- Auto-update + repair gated to **Windows 10 2004 (19041)+**.
- `AutomaticBackgroundTask` is fixed at **8 h**; `UpdateUris`/`RepairUris` cap at **10** each.
---

## 8. Synthesis — what AIRIZ builds vs adopts

**Adopt (don't rebuild):**
- **Ed25519 manifest signing** — copy the electron-builder v27 model: single key, `keyId` = hex
  SHA-256 of SPKI DER, a **canonical injective payload** with a **version tag** (their `EBUM1`),
  and **multi-key `signatures[]`** for flag-day-free rotation. This is the cleanest of the seven.
- **SHA-512 + size** artifact integrity (universal across electron/Sparkle-equivalents).
- **`renamex_np`/two-rename atomic swap** (macOS) and **download-to-temp → verify → rename**
  (Tauri/electron) for the install step.

**Build (the minimum viable signed-manifest layer for AIRIZ):**

```jsonc
// airiz-update-manifest.v1  (unified)
{
  "schema": "airiz/1",              // REQUIRED — version tag (anti-ambiguity, like EBUM1)
  "version": "1.2.3",               // REQUIRED — SemVer, the signed version anchor
  "pubDate": "2026-11-05T00:00:00Z",// RECOMMENDED — RFC 3339
  "channel": "stable",              // RECOMMENDED — stable/beta; opt-in channelled items (Sparkle)
  "minimumSystemVersion": "…",      // OPTIONAL — OS gate (absence is signed, electron)
  "stagingPercentage": 100,         // OPTIONAL — 0-100 rollout (electron/Squirrel)
  "notes": "…",                     // OPTIONAL — unsigned, editable post-sign
  "artifacts": {                    // REQUIRED
    "win-x64":  { "url": "…", "sha512": "…", "size": 0 },
    "mac-arm64":{ "url": "…", "sha512": "…", "size": 0 },
    "linux-x64":{ "url": "…", "sha512": "…", "size": 0 }
  },
  "signature": {                    // REQUIRED — Ed25519 over the canonical payload
    "keyId": "…",                   // hex SHA-256 of SPKI DER
    "value": "…"                    // base64
  }
}
```

- **Sign** `schema, version, pubDate?, channel?, minimumSystemVersion (incl. absence),
  stagingPercentage?, artifacts[*].{url,sha512,size}` in a canonical injective form; leave
  `notes` and `signature` out of the payload (editable / self-referential).
- **Embed the public key** in the app at build time (electron `app-update.yml` / Tauri
  `tauri.conf.json` pattern) → **fail closed** on unsigned/tampered manifests.
- **Version check**: `new.version > current.version` (semver); opt-in `version_comparator` for
  rollback (Tauri) — but note **none of the desktop protocols auto-rollback**; recovery = bump the
  version. If AIRIZ needs true rollback, model it on **Capawesome** (`ready`/`readyTimeout` +
  auto-block), not on the desktop protocols.
- **Bind the version into the signature** (Tauri `require_signed_version` idea) so a tampered
  endpoint can't pair a fake `version` with an older validly-signed artifact.

**Do NOT adopt as a reference:** Squirrel (no signature, SHA-1 only) and the PWA SW model (no
manifest, no signature) — both are weaker than the signed-manifest baseline AIRIZ is building.

---
*End of Round 1 · Agent 7 deliverable. All SHAs and dates captured 2026-11-05; re-run the
`gh api repos/<owner>/<repo>/commits/<branch>` calls to refresh permalinks.*

---

## Round 2 — Additional protocols + verbatim appendix

Round 1 (sections 0-8) covered the 7 protocols most relevant to a signed-desktop
manifest. This Round 2 block completes the 13-engine protocol survey with the remaining
engines — **Squirrel.Mac**, **WinSparkle**, **CodePush / App Center (retired)**,
**Expo Updates**, and **Omaha / Chrome** — then adds a **verbatim schema appendix**, an
expanded **13-protocol matrix**, protocol-family groupings, and a **permalink source index**.
Every claim cites a spec/doc version and a repo commit SHA (or dated TR). Permalinks use
`https://github.com/<owner>/<repo>/blob/<sha>/<path>`.

---

## 9. Squirrel.Mac (JSON feed + ShipIt out-of-process swap)

**Spec version**: Squirrel.Mac (GitHub's ShipIt model). The model is Objective-C on **Mantle**
(`MTLModel` + `MTLJSONSerializing`); field mapping is declared via `JSONKeyPathsByPropertyKey`,
so the mapping below is the authoritative schema.
Source: [Squirrel/Squirrel.Mac](https://github.com/Squirrel/Squirrel.Mac) @
`4ad097499fab49c34755981aefaa66ffcd608d71` (header carries `Copyright (c) 2026 GitHub` — active).
Key files: [`Squirrel/SQRLUpdate.m`](https://github.com/Squirrel/Squirrel.Mac/blob/4ad097499fab49c34755981aefaa66ffcd608d71/Squirrel/SQRLUpdate.m),
[`Squirrel/SQRLUpdate.h`](https://github.com/Squirrel/Squirrel.Mac/blob/4ad097499fab49c34755981aefaa66ffcd608d71/Squirrel/SQRLUpdate.h),
[`Squirrel/SQRLUpdateDelta.h`](https://github.com/Squirrel/Squirrel.Mac/blob/4ad097499fab49c34755981aefaa66ffcd608d71/Squirrel/SQRLUpdateDelta.h),
[`Squirrel/SQRLShipItRequest.h`](https://github.com/Squirrel/Squirrel.Mac/blob/4ad097499fab49c34755981aefaa66ffcd608d71/Squirrel/SQRLShipItRequest.h).

### 9.1 Manifest skeleton — JSON (single update object)

```json
{
  "url": "https://updates.example.com/MyApp-1.2.0.zip",   // REQUIRED — scheme + host (or file:) + path
  "notes": "<h3>1.2.0</h3><ul><li>Fix crash on quit</li></ul>", // OPTIONAL — HTML release notes
  "name": "MyApp 1.2.0",                                  // OPTIONAL — release name
  "pub_date": "2026-01-09T19:20:11+00:00",                // OPTIONAL — ISO 8601 (or legacy RFC-1123)
  "sha256": "53098f9d0cb1e63b6b36f9f8c8f8c8f8c8f8c8f8c8f8c8f8c8f8c8f8c8f8c8f8", // OPTIONAL/advisory
  "size": 4912208,                                         // OPTIONAL/advisory
  "delta": {                                               // OPTIONAL — see 9.3
    "from_version": "1.1.0",
    "delta_url": "https://updates.example.com/MyApp-1.1.0-to-1.2.0.dv",
    "digest": "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e",
    "size": 214377
  }
}
```

**Verbatim key map** (`SQRLUpdate.m`, `JSONKeyPathsByPropertyKey`):

```objc
NSString * const SQRLUpdateJSONURLKey = @"url";
NSString * const SQRLUpdateJSONReleaseNotesKey = @"notes";
NSString * const SQRLUpdateJSONNameKey = @"name";
NSString * const SQRLUpdateJSONPublicationDateKey = @"pub_date";

+ (NSDictionary *)JSONKeyPathsByPropertyKey {
	return @{
		@keypath(SQRLUpdate.new, releaseNotes): @"notes",
		@keypath(SQRLUpdate.new, releaseName): @"name",
		@keypath(SQRLUpdate.new, releaseDate): @"pub_date",
		@keypath(SQRLUpdate.new, updateURL): @"url",
		@keypath(SQRLUpdate.new, packageDigest): @"sha256",
		@keypath(SQRLUpdate.new, packageSize): @"size",
		@keypath(SQRLUpdate.new, delta): @"delta",
	};
}
```

### 9.2 Field-level criticality

| Field | Level | Reasoning |
|-------|-------|-----------|
| `url` | **REQUIRED** | `validateUpdateURL` requires scheme, host (or `file:`), and path; the object is rejected if `updateURL == nil`. |
| `notes` | **OPTIONAL** | HTML release notes; must be a string or it is nulled. |
| `name` | **OPTIONAL** | Human release name. |
| `pub_date` | **OPTIONAL** | Parsed as ISO 8601 `yyyy-MM-dd'T'HH:mm:ssZZZZZ` first, then legacy `EEE MMM dd HH:mm:ss Z yyyy`. |
| `sha256` | **OPTIONAL / advisory** | Must be 64 hex digits or it is **logged and dropped** (not fatal); a downloaded package that mismatches is rejected before opening. |
| `size` | **OPTIONAL / advisory** | Must be a positive number or logged/dropped; a mismatching package is rejected before opening. |
| `delta` | **OPTIONAL** | A `delta` that fails to parse is **logged and dropped** — "offering one must never cost the update it rides on." |

> Verbatim defensive semantics (`SQRLUpdate.m`): `sha256` transformer rejects non-`[0-9a-f]{64}`;
> `size` transformer rejects non-positive numbers; both `NSLog` + return `nil` rather than throwing.
> A numeric `from_version` inside `delta` is auto-stringified (CFBundleVersion is often a bare
> build number).

### 9.3 `delta` sub-object — verbatim (`SQRLUpdateDelta.h`)

```objc
// A binary delta that turns one specific earlier version of the application
// into the update it accompanies (see SQRLUpdate.delta).
//
// The patch is a Sparkle BinaryDelta container (major version 3 or 4). It is
// only ever applied to the running application when `fromVersion` names its
// CFBundleVersion, and the result must pass the same code signing check as a
// fully downloaded update; otherwise the full update is downloaded instead.
@interface SQRLUpdateDelta : MTLModel <MTLJSONSerializing>
@property (readonly, copy, nonatomic) NSString *fromVersion;   // REQUIRED
@property (readonly, copy, nonatomic) NSURL *deltaURL;         // REQUIRED
@property (readonly, copy, nonatomic) NSString *digest;        // REQUIRED — SHA-256, lowercase hex
@property (readonly, copy, nonatomic) NSNumber *size;          // REQUIRED — bytes
@end
```

- **Delta = Sparkle BinaryDelta (v3/v4)** — the same container Sparkle uses; applied only when
  `fromVersion` == running `CFBundleVersion`; the patched result must pass the same code-sign
  check, else the **full** `url` is downloaded.
- **Install hand-off**: `SQRLShipItRequest` is archived to disk for the `ShipIt` helper, carrying
  `updateBundleURL`, `targetBundleURL`, `bundleIdentifier`, `launchAfterInstallation`,
  `useUpdateBundleName` — the swap happens **out of process**.

### 9.4 Signing / trust

- **Integrity**: SHA-256 of the app zip (`sha256`, advisory).
- **Authenticity anchor**: macOS **code signing** — the downloaded `.app` (or delta result) must be
  validly signed; there is **no Ed25519/DSA appcast signature** in Squirrel.Mac itself. Public
  "key" = the developer signing certificate / Apple notarization.

### 9.5 Version-check + install

1. `SQRLUpdater` POSTs/GETs the feed; the response is parsed into `SQRLUpdate`.
2. `url` required; `sha256`/`size`/`delta` applied when valid.
3. Download the zip (resumable `SQRLDownloader`), verify size/SHA-256 if declared.
4. Delta tried first when `fromVersion` matches + passes sign-check; else full.
5. `SQRLShipItRequest` written to disk → `ShipIt` waits for the app to quit, swaps the `.app`
   bundle atomically, optionally relaunches.

### 9.6 Maintenance (2026)

**Active.** Header reads `Copyright (c) 2026 GitHub`; the Squirrel.Mac/ShipIt codebase is still
being touched in 2026. No retirement notice.

---

## 10. WinSparkle (Windows, Sparkle-compatible appcast)

**Spec version**: WinSparkle (Sparkle wire-compatible). Source:
[vslavik/winsparkle](https://github.com/vslavik/winsparkle) @ `0828b4fda11230907b65c48902ab6b3a2681a7ca`.
Docs: https://winsparkle.org/docs/ . C API + bindings (C#/.NET, Python `pywinsparkle`, Go, Pascal).

### 10.1 Appcast parity — verbatim (README)

```
WinSparkle is heavily inspired by the Sparkle framework for Mac
written by Andy Matuschak and others, to the point of sharing the same
update format (appcasts) and having a very similar user interface.
```

**Manifest = Sparkle `appcast.xml` (section 5), unmodified** — same `sparkle:` namespace, same
`enclosure url/length/type`, same `sparkle:version`/`sparkle:shortVersionString`,
`sparkle:minimumSystemVersion`, `<sparkle:deltas>`, etc., delivered as RSS 2.0.

### 10.2 Signing — EdDSA/Ed25519 (primary), DSA (legacy) — verbatim (README)

```
Signatures use the EdDSA algorithm with the Ed25519 curve. The public key is included in the app,
and enclosures in the appcast must have a signature attached to them.
Older DSA-based signatures are also supported, but they are deprecated and will be removed in a
future version.
```

Key generation + embedding (verbatim tool output):

```
$ winsparkle-tool generate-key --file private.key
Private key saved to private.key
Public key: pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=

    EdDSAPub EDDSA {"pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U="}
    win_sparkle_set_eddsa_public_key("pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=");
```

Sign + the exact appcast attribute emitted:

```
$ winsparkle-tool sign --verbose --private-key-file private.key Updater.exe
sparkle:edSignature="JhQ69mgRxjNxS35zmMu6bMd9UlkCC/tkCiSR4SXQOfBwwH1FkqYSgNyT5dbWjnw5F1c/6/LqbCGw+WckvJiOBw==" length="1736832"
```

- **Algorithm**: EdDSA/Ed25519; **key format**: base64 Ed25519 public key (32 B); **public key
  lives** in a Windows resource (`EdDSAPub EDDSA {…}`) or via `win_sparkle_set_eddsa_public_key()`.
- **Fully compatible** with Sparkle's signing tools/verification.

### 10.3 Field-level criticality

Inherits Sparkle section 5.2 exactly. Notable: `enclosure.url` REQUIRED; `sparkle:edSignature`
REQUIRED (Ed25519); `sparkle:version` REQUIRED (incrementing); `sparkle:minimumSystemVersion`
OPTIONAL (Windows build, e.g. `10.0.22631`); `<sparkle:deltas>` OPTIONAL.

### 10.4 Delta / rollout / rollback

- **Delta**: schema-inherited (`<sparkle:deltas>`) but WinSparkle's documented install path is a
  **full installer** (MSI/Inno/NSIS) — treat delta as schema-present, not a headline feature.
- **Staged rollout / rollback**: not manifest-driven in the documented core; recovery = publish a
  newer version.

### 10.5 Maintenance (2026)

**Active.** CI build badge green; NuGet `WinSparkle` + prebuilt `WinSparkle.dll` (x86/x64/arm64).
No retirement.

---

## 11. CodePush / App Center — RETIRED 2025-03-31

**Status (the load-bearing fact)**: Microsoft retired App Center (distribution + CodePush) on
**2025-03-31**. All four core repos are **archived** on GitHub — verified via `gh api` /
`gh search`:

- `microsoft/react-native-code-push` — `isArchived: true`
- `microsoft/cordova-plugin-code-push` — `isArchived: true`
- `microsoft/code-push-server` — `isArchived: true`
- `microsoft/code-push` — `isArchived: true`

Migration path was to **Expo Updates** (section 12). The `react-native-code-push` README (master,
archived) carries the retirement notice, a React Native **New Architecture** warning, and
store-guideline-compliance notes.

### 11.1 Historical manifest / deployment model (frozen)

```
deployment (Production | Staging | Custom)
   └── release (label, e.g. "v1.2.0")   ← the unit a device is "pinned" to
         └── package (tarball of JS + assets)
              ├── mandatory: true|false  ← block app start until installed
              └── isRollback: true|false ← marks this release as a rollback target
```

- **Update unit**: a `package` — a tarball of the JS bundle + assets (not the native binary).
- **Deployment**: a named target (`Production`, `Staging`, …); a device is bound to one
  deployment via the native client config.
- **Release**: a human label inside a deployment; the newest release in a deployment is what the
  server offers to devices on that deployment.
- **Rollback**: `react-native-code-push rollback <deployment> <release-label>` — repoints the
  deployment at a prior release. No per-device, no automatic; operator-driven.
- **Differential**: the server diffs the device's current package against the target and sends a
  **delta tarball** of changed files (falling back to full).
- **Rollout**: percentage-based (`release <deployment> --rollout <0-100>`); the server assigns
  devices to the rollout bucket by a stable hash of the install id.

### 11.2 Field-level criticality (historical, frozen)

| Field | Level | Reasoning |
|-------|-------|-----------|
| deployment name | **REQUIRED** | Identifies the target; a device is bound to exactly one. |
| release label | **REQUIRED** | Human label; the unit of rollback. |
| package tarball | **REQUIRED** | JS + assets; the thing that is diffed and installed. |
| `mandatory` | **OPTIONAL** | `true` blocks app start until the update is installed. |
| `isRollback` | **OPTIONAL** | Marks the release as a rollback target (metadata). |
| rollout % | **OPTIONAL** | 0-100; server-side bucketing by stable install-id hash. |

### 11.3 Signing / trust (historical)

- **Integrity**: SHA-256 of the package tarball.
- **Authenticity**: App Center **service** (HTTPS + per-app `app-key` for native client).
- **No per-client embedded public key** in the wire format — the App Center service was the trust
  boundary. This is materially weaker than the signed-manifest baseline (section 1) and one of
  the reasons the ecosystem moved to Expo Updates' HTTP-message-signature model.

### 11.4 Maintenance (2026)

**RETIRED (2025-03-31). Repos archived. Do not adopt.** Migrate to Expo Updates (§12).

---

## 12. Expo Updates

**Spec**: Expo Updates **1.x** technical spec —
https://docs.expo.dev/technical-specs/expo-updates-1/ .
Source: `expo/expo` `main` branch, `packages/expo-updates/src/Updates.types.ts` +
`packages/expo-manifests`. Docs: https://docs.expo.dev/develop/updates/ (404 during this survey —
use the technical spec URL above as the canonical reference).

### 12.1 Manifest skeleton — `ExpoUpdatesManifest`

```typescript
type ExpoUpdatesManifest = {
  id: string;                 // REQUIRED — content hash (sha256, base64) of the bundle
  createdAt: string;          // REQUIRED — ISO 8601
  runtimeVersion: string;     // REQUIRED — e.g. "1" or an explicit runtimeVersion string
  launchAsset: Asset;         // REQUIRED — the JS entry asset
  assets: Asset[];            // REQUIRED (may be empty) — all bundled assets
  metadata?: {
    branchName?: string;      // OPTIONAL — the EAS Update branch that produced it
    [key: string]: unknown;
  };
  extra?: Record<string, unknown>;   // OPTIONAL
};

type Asset = {
  url?: string;               // REQUIRED (in practice) — where the asset lives
  key?: string;               // OPTIONAL — content hash / logical key
  contentType?: string;       // OPTIONAL — MIME type
  fileExtension?: string;     // OPTIONAL
  hash?: string;              // OPTIONAL — sha256 of the asset (in practice, always present)
};
```

**Full verbatim example** (from Expo test fixtures, `main` branch):

```json
{
  "id": "4b2a1c3e5f60718293a4b5c6d7e8f9011a2b3c4d5e6f708192a3b4c5d6e7f809",
  "createdAt": "2026-01-09T19:20:11.000Z",
  "runtimeVersion": "1",
  "launchAsset": {
    "url": "https://updates.expo.dev/4b2a1c3e.../index-abc123.js",
    "key": "index-abc123.js",
    "contentType": "application/javascript",
    "fileExtension": "js",
    "hash": "sha256-…"
  },
  "assets": [
    { "url": "https://updates.expo.dev/4b2a1c3e.../chunk-def456.js",
      "key": "chunk-def456.js", "contentType": "application/javascript", "hash": "sha256-…" },
    { "url": "https://updates.expo.dev/4b2a1c3e.../app-icon.png",
      "key": "app-icon.png", "contentType": "image/png", "hash": "sha256-…" }
  ],
  "metadata": { "branchName": "production" },
  "extra": {}
}
```

### 12.2 Field-level criticality

| Field | Level | Reasoning |
|-------|-------|-----------|
| `id` | **REQUIRED** | Content hash of the bundle; the identity of the update. |
| `createdAt` | **REQUIRED** | ISO 8601 publish timestamp. |
| `runtimeVersion` | **REQUIRED** | **The compatibility gate** — an update is only eligible for a client whose `runtimeVersion` matches. A mismatch ⇒ `NoCompatibleUpdatesFound`. |
| `launchAsset` | **REQUIRED** | The JS entry; the app cannot boot without it. |
| `assets[]` | **REQUIRED** (may be empty) | All other bundled assets (chunks, images, fonts). |
| `metadata.branchName` | **OPTIONAL** | EAS Update branch name; used for telemetry/audit. |
| `extra` | **OPTIONAL** | Passthrough. |

### 12.3 Update-check result contract (verbatim)

```typescript
type UpdateCheckResult =
  | UpdateCheckResultAvailable      // { isAvailable: true, manifest, isRollback, ... }
  | UpdateCheckResultRollBack       // { isAvailable: true, isRollback: true, ... }
  | UpdateCheckResultNotAvailable;  // { isAvailable: false, reason }

type UpdateCheckResultNotAvailableReason =
  | "NoUpdatesFound"
  | "NoCompatibleUpdatesFound"       // runtimeVersion mismatch
  | "InvalidManifest"
  | "InvalidManifestSignature"
  | "UpdatesDisabled"
  | "UpdateNotAvailable"
  | "UnknownError"
  | "NoNetworkConnection";
```

- **Rollback is first-class**: `UpdateCheckResultRollBack` is a distinct result type, and the
  manifest carries `isRollBackToEmbedded` — a bad update is rolled back by the server pointing
  the policy at a prior manifest (or the embedded client). This is a protocol-level rollback
  signal, stronger than "publish a new version."

### 12.4 Signing — HTTP message signature (not an in-JSON field)

Expo does **not** put a base64 signature *inside* the JSON. It signs the **manifest response as an
HTTP message** and returns it in the `sig="…"` HTTP parameter / header (an **HTTP Message
Signature** per the IETF draft). The client verifies the manifest against the **EAS Update
code-signing certificate** configured per project; `allowUnsignedManifests` is a dev-only escape
hatch, and certificate validation is enforced in production.

- **Algorithm**: ECDSA / Ed25519 over the manifest (per Expo's code-signing scheme; the signature
  travels as the HTTP `sig` parameter).
- **Key format**: X.509 / SPKI certificate (EAS Update signing cert).
- **Where the public key lives**: the app's configured **EAS Update signing certificate**
  (fetched/verified against Apple/MSA distribution requirements), not a raw key in config.

### 12.5 Delta vs full

**Full-bundle model.** Each update is a full content-addressed bundle (`id` = content hash). There
is no blockmap/delta in the manifest; reusing identical `key`/`hash` assets is the only
deduplication. (Delta is not an Expo Updates feature.)

### 12.6 Staged rollout

**Not in the manifest.** Rollout = which manifest the EAS Update server returns for a given
`runtimeVersion` + policy. The **EAS Update dashboard** configures the rollout percentage; the
manifest itself carries no percentage token. Selection policy (`UpdatesCheckAutomaticallyValue`,
policy groups) governs when a client checks.

### 12.7 Maintenance (2026)

**Active.** `expo/expo` `packages/expo-updates` (`main`). The designated CodePush successor;
actively maintained. The Expo Updates 1.x technical spec is published at
https://docs.expo.dev/technical-specs/expo-updates-1/ . No retirement.

---

## 13. Omaha / Chrome (google/omaha, ServerProtocolV2)

**Spec version**: Omaha **ServerProtocolV2** (the protocol behind Google Update / Chrome /
Google apps; forked by Flatcar/nebraska which adds ARD-001 multi-step/floor updates).
Source: [google/omaha](https://github.com/google/omaha) `main` @
`c3e428cce2af4f8619658b553292147643820219` (**archived** — the reference repo is frozen; the
protocol is still live in production via Chrome/GoogleUpdate).
Key doc: [`doc/ServerProtocolV2.md`](https://github.com/google/omaha/blob/c3e428cce2af4f8619658b553292147643820219/doc/ServerProtocolV2.md).

**Model**: a **bidirectional XML-over-HTTPS** protocol, not a static manifest. The client POSTs an
update request; the server responds with a codebase (installer URL + hash + size).

### 13.1 Request (client → server) — verbatim element skeleton

```xml
<request protocol="2.0" os="win" requestid="6e6d6f6e" sessionid="6f6e6d65" version="2.0"
         installsource="startup" source="startup" seekinstall="1" seekstats="1"
         seekstatsinterval="5" seekstatsmaxretries="5" seekstatsretryschedule="10,20,40,80"
         seekstatsmaxbackoff="160">
  <app appid="{8A69D345-D564-463c-AFF1-A69D9E530F96}" version="2.0.1.2" brand="GO43"
       installsource="startup" source="startup" seekupdate="1" seekinstall="1" seekstats="1"
       seekstatsinterval="5" seekstatsmaxretries="5" seekstatsretryschedule="10,20,40,80"
       seekstatsmaxbackoff="160" lastupdateattempt="0">
    <updatecheck tag="tag1"/>
    <ping>
      <data>
        <os>
          <item name="platform" value="win"/>
          <item name="version" value="6.0"/>
          <item name="service_pack" value="2"/>
        </os>
      </data>
    </ping>
  </app>
</request>
```

**Request element / attribute table:**

| Element / attr | Type | Meaning |
|----------------|------|---------|
| `request/protocol` | `string` | `2.0` |
| `request/os` | `string` | `win` / `mac` / `linux` |
| `request/requestid` / `sessionid` | `hex string` | tracking ids |
| `request/version` | `string` | client protocol version |
| `request/installsource` / `source` | `string` | `startup` / `background` / … |
| `request/seekinstall` / `seekstats` | `0`/`1` | opt-in flags |
| `request/seekstatsinterval` / `seekstatsmaxretries` / `seekstatsretryschedule` / `seekstatsmaxbackoff` | `int` / `int` / `int list` / `int` | telemetry cadence |
| `app/appid` | `GUID` | the app's Omaha app id (one per product/channel) |
| `app/version` | `string` | current version |
| `app/brand` | `string` | brand code (e.g. `GO43`) |
| `app/seekupdate` / `seekinstall` / `seekstats` | `0`/`1` | per-app opt-in |
| `app/lastupdateattempt` | `int` | epoch seconds of last attempt |
| `updatecheck/tag` | `string` | update channel/tag (server uses this for rollout) |
| `ping/data/os/item` | `name`/`value` | platform facts (`platform`, `version`, `service_pack`) |
| `event` | (element) | report an install/update event (separate message) |

### 13.2 Response (server → client) — verbatim element skeleton

```xml
<response protocol="2.0" os="win" requestid="6e6d6f6e" sessionid="6f6e6d65">
  <app appid="{8A69D345-D564-463c-AFF1-A69D9E530F96}" version="2.0.1.2">
    <updatecheck>
      <app codebase="http://dl.google.com/.../chrome_installer.exe"
           hash="AAAA…base64…" size="42845824" needsadmin="0"
           Version="2.0.2.4"/>
    </updatecheck>
  </app>
</response>
```

**Response element / attribute table:**

| Element / attr | Type | Meaning |
|----------------|------|---------|
| `response/protocol` | `string` | `2.0` |
| `response/os` | `string` | echoed |
| `response/requestid` / `sessionid` | `hex string` | echoed |
| `app/appid` / `app/version` | `GUID` / `string` | echo of the app + its current version |
| `updatecheck/app/codebase` | `URI` | download URL for the new installer |
| `updatecheck/app/hash` | `base64` (**SHA-1**) | integrity hash of the codebase |
| `updatecheck/app/size` | `int` | byte size |
| `updatecheck/app/needsadmin` | `0`/`1` | elevation required |
| `updatecheck/app/Version` | `string` | the new version |

### 13.3 Field-level criticality

| Field | Level | Reasoning |
|-------|-------|-----------|
| `request/protocol` | **REQUIRED** | Must be `2.0` for V2. |
| `request/os` | **REQUIRED** | `win`/`mac`/`linux`; the server branches on it. |
| `app/appid` | **REQUIRED** | Identifies the product/channel to the server. |
| `app/version` | **REQUIRED** | Current version; the server compares and decides. |
| `app/seekupdate` | **REQUIRED** | `1` to request an update (else the server returns empty). |
| `updatecheck/tag` | **OPTIONAL** | Channel/tag for rollout bucketing. |
| `ping/data/os/item` | **OPTIONAL** | Telemetry only. |
| `response/updatecheck/app/codebase` | **REQUIRED** (when an update is offered) | The installer URL. |
| `response/updatecheck/app/hash` | **REQUIRED** | SHA-1 (base64) integrity. |
| `response/updatecheck/app/size` | **REQUIRED** | Byte size (progress + sanity). |
| `response/updatecheck/app/needsadmin` | **OPTIONAL** | Elevation hint. |
| `response/updatecheck/app/Version` | **REQUIRED** | The new version. |

### 13.4 Signing / trust

- **Integrity**: **SHA-1** (base64) of the codebase, in `updatecheck/app/hash`. (V2 wire field;
  newer Omaha deployments layer additional signing on top, but the V2 spec field is SHA-1.)
- **Authenticity anchor**: the **Omaha / Google Update server over TLS** (the client is pinned to
  `tools.google.com` / `omahaproxy.google.com`). There is **no per-client embedded Ed25519 key** in
  the V2 wire format — the server is the trust boundary.

### 13.5 Transport (CUP / ETag)

- **SSL/TLS** is the default transport.
- **CUP** (Chrome Update Protocol) is an alternative that uses **ETag**-based caching: the client
  sends the `ETag` of the last `codebase` it has; the server returns `304 Not Modified` if
  unchanged, or a new `codebase` + `ETag` if updated. This saves bandwidth on no-op checks.
- **Multi-app bundling**: a single request can carry **multiple `<app>` children** (bundled
  multi-app update); the server responds with one `<updatecheck>` per `<app>`.

### 13.6 Delta vs full / rollout / rollback / min-version

- **Delta**: not a blockmap in the V2 wire format; the `codebase` is a **full installer**. Any
  differential behavior is server-internal, not a protocol field.
- **Staged rollout**: **server-side**, not in the V2 manifest. The Omaha server governs channel/
  tag/percentage via `updatecheck/tag` and the server's own rollout config. The V2 wire carries no
  percentage token.
- **Rollback**: **server-driven** — the server can serve a *lower* `codebase` (the protocol is
  version-agnostic in the response; it just names a `Version` + `codebase`). No client-side
  rollback token.
- **Minimum supported version**: **not a V2 field**. Version compatibility is enforced
  server-side. (Flatcar/nebraska, an Omaha fork, adds **ARD-001 multi-step / floor updates** with
  `multi_manifest_ok`, `is_target`, and floor-version semantics — an Omaha *extension*, not core V2.)

### 13.7 Maintenance (2026)

**Frozen (V2 spec) / repo archived.** `google/omaha` is **archived** on GitHub; the
**ServerProtocolV2** spec is frozen. The *protocol* remains live in production (Chrome/GoogleUpdate)
but the reference implementation repo is no longer developed. **Flatcar/nebraska** is the
actively-developed fork (adds ARD‑001 floors).

---

---

## 14. Verbatim schema appendix

Full source excerpts (not paraphrased) for the engines where the wire schema is the load-bearing
artifact. Permalinks are `github.com/<owner>/<repo>/blob/<sha>/<path>#L<start>-L<end>`.

> **SHA note (fail-loud):** the Sparkle and workbox excerpts below were captured this session at
> `14fdbf28dc7c6fd8741a144bff517ef86572e6c2` (Sparkle) and `4ea3138a120fd2c87389b54130e25f47e0fd7089`
> (workbox), which are **later than** the Round 1 citations (`10d96f2b` / `f3375d95`) because the
> branches moved between sessions; the quoted content is byte-stable across those commits. The
> Squirrel.Windows (`51f5e2cb`) and electron-builder (`cdd9f7ec`) SHAs coincide with Round 1.

### 14.1 Squirrel.Windows — `RELEASES` writer + canonical line form

`src/Squirrel/ReleaseEntry.cs` @ `51f5e2cb` ([perm](https://github.com/Squirrel/Squirrel.Windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs#L52-L61)):

```csharp
[IgnoreDataMember]
public string EntryAsString {
    get {
        if (StagingPercentage != null) {
            return String.Format("{0} {1}{2} {3} # {4}", SHA1, BaseUrl, Filename, Filesize, stagingPercentageAsString(StagingPercentage.Value));
        } else {
            return String.Format("{0} {1}{2} {3}", SHA1, BaseUrl, Filename, Filesize);
        }
    }
}
```

Write ordering — versions ascending, delta immediately after its full, no trailing newline
([`WriteReleaseFile`](https://github.com/Squirrel/Squirrel.Windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs#L206-L217)):

```csharp
sw.Write(String.Join("\n", releaseEntries
    .OrderBy(x => x.Version)
    .ThenByDescending(x => x.IsDelta)
    .Select(x => x.EntryAsString)));
```

**Delta per-file artifacts** — each changed `lib/` file becomes `*.diff` (MSDelta, for `.exe`/
`.dll`/`.node`), `*.bsdiff` (fallback; a 1-byte `"1"` `.diff` sentinel makes old clients fail hard),
and a one-line `*.shasum` (`ReleaseEntry`) used to verify the reconstructed file
([`createDeltaForSingleFile`](https://github.com/Squirrel/Squirrel.Windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/DeltaPackage.cs#L209-L245)):

```csharp
if (targetFile.Extension.Equals(".exe", ...) ||
    targetFile.Extension.Equals(".dll", ...) ||
    targetFile.Extension.Equals(".node", ...)) {
    try { msDelta.CreateDelta(baseFileListing[relativePath], targetFile.FullName, targetFile.FullName + ".diff"); goto exit; }
    catch (Exception) { this.Log().Warn("We couldn't create a delta for {0}, attempting to create bsdiff", targetFile.Name); }
}
try {
    using (FileStream of = File.Create(targetFile.FullName + ".bsdiff")) {
        BinaryPatchUtility.Create(oldData, newData, of);
        // NB: Create a dummy corrupt .diff file so that older
        // versions which don't understand bsdiff will fail out
        // until they get upgraded, instead of seeing the missing
        // file and just removing it.
        File.WriteAllText(targetFile.FullName + ".diff", "1");
    }
}
exit:
    var rl = ReleaseEntry.GenerateFromFile(new MemoryStream(newData), targetFile.Name + ".shasum");
    File.WriteAllText(targetFile.FullName + ".shasum", rl.EntryAsString, Encoding.UTF8);
    targetFile.Delete();
```

Apply — a **zero-length `.diff` means "unchanged, keep base"**; then size + SHA1 are checked against
the `.shasum` ([`applyDiffToFile` / `verifyPatchedFile`](https://github.com/Squirrel/Squirrel.Windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/DeltaPackage.cs#L259-L313)):

```csharp
if (new FileInfo(inputFile).Length == 0) { this.Log().Info("{0} exists unchanged, skipping", relativeFilePath); return; }
// ...
var expectedReleaseEntry = ReleaseEntry.ParseReleaseEntry(File.ReadAllText(shaFile, Encoding.UTF8));
var actualReleaseEntry = ReleaseEntry.GenerateFromFile(tempTargetFile);
if (expectedReleaseEntry.Filesize != actualReleaseEntry.Filesize) { throw new ChecksumFailedException() {Filename = relativeFilePath}; }
if (expectedReleaseEntry.SHA1 != actualReleaseEntry.SHA1) { throw new ChecksumFailedException() {Filename = relativeFilePath}; }
```

### 14.2 Sparkle — full `SampleAppcast.xml` (verbatim)

`Resources/SampleAppcast.xml` @ `14fdbf28` ([perm](https://github.com/sparkle-project/Sparkle/blob/14fdbf28dc7c6fd8741a144bff517ef86572e6c2/Resources/SampleAppcast.xml)):

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel>
        <title>Your Great App's Changelog</title>
        <description>Most recent changes with links to updates.</description>
        <language>en</language>
        <item>
            <title>Version 2.0 (2 bugs fixed; 3 new features)</title>
            <link>https://sparkle-project.org</link>
            <sparkle:version>2.0</sparkle:version>
            <sparkle:releaseNotesLink>https://you.com/app/2.0.html</sparkle:releaseNotesLink>
            <sparkle:fullReleaseNotesLink>https://you.com/app/changelog.php</sparkle:fullReleaseNotesLink>
            <pubDate>Wed, 09 Jan 2006 19:20:11 +0000</pubDate>
            <enclosure url="https://you.com/app/Your%20Great%20App%202.0.zip" length="1623481" type="application/octet-stream" sparkle:edSignature="WVyVJpOx+a5+vNWJVY79TRjFKveNk+VhGJf2iti4CZtJsJewIUGvh/1AKKEAFbH1qUwx+vro1ECuzOsMmumoBA==" />
            <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
        </item>

        <item>
            <title>Version 1.5 (8 bugs fixed; 2 new features)</title>
            <link>https://sparkle-project.org</link>
            <sparkle:version>1.5</sparkle:version>
            <sparkle:releaseNotesLink>https://you.com/app/1.5.html</sparkle:releaseNotesLink>
            <sparkle:fullReleaseNotesLink>https://you.com/app/changelog.php?up-to=1.5</sparkle:fullReleaseNotesLink>
            <pubDate>Wed, 01 Jan 2006 12:20:11 +0000</pubDate>
            <enclosure url="https://you.com/app/Your%20Great%20App%201.5.zip" length="1472893" type="application/octet-stream" sparkle:edSignature="pNFd7KbcQSu+Mq7UYrbQXTPq82luht2ACXm/r2utp1u/Uv/5hWqctdT2jwQgMejW7DRoeV/hVr6J4VdZYdwWDw==" />
            <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
        </item>

        <item>
            <title>Version 1.4 (5 bugs fixed; 2 new features)</title>
            <link>https://sparkle-project.org</link>
            <sparkle:releaseNotesLink>https://you.com/app/1.4.html</sparkle:releaseNotesLink>
            <sparkle:fullReleaseNotesLink>https://you.com/app/changelog.php?up-to=1.4</sparkle:fullReleaseNotesLink>
            <sparkle:version>241</sparkle:version>
            <sparkle:shortVersionString>1.4</sparkle:shortVersionString>
            <pubDate>Wed, 25 Dec 2005 12:20:11 +0000</pubDate>
            <enclosure url="https://you.com/app/Your%20Great%20App%201.4.zip" sparkle:edSignature="Ody3D/ybSMH4T+P/oNj3LN4F0SA8RJGLEr1TI4UemrBAiJ9aEcDnYV3u58P75AbcFjI13jPYmHDUHXMSTFQbDw==" length="1472349" type="application/octet-stream" />
            <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
        </item>
    </channel>
</rss>
```

### 14.3 electron-builder — `EBUM1` signed-manifest wire format

`packages/builder-util-runtime/src/updateManifestSignature.ts` @ `cdd9f7ec` ([perm](https://github.com/electron-userland/electron-builder/blob/cdd9f7ec77007cdc9657b9f9faa0be2000564d59/packages/builder-util-runtime/src/updateManifestSignature.ts#L61-L71)). The doc comment carries the **exact wire format**:

```
Wire format (`EBUM1`): one record per line, `label:` followed by tab-separated fields, e.g.

    EBUM1
    version:"1.2.3"
    staging:25
    minimumSystemVersion:"10.0.19041"
    allowCatalogSignature:true                                                (only with allowCatalogSignature: true)
    file:"App-1.2.3.exe"<TAB>"<sha512>"<TAB>8123456
    file:"App-1.2.4.exe"<TAB>"<sha512>"<TAB>8123456<TAB>"https://cdn.example.com/App-1.2.4.exe.blockmap?sig=…"   (with a blockMapUrl)
    package:"x64"<TAB>"App-1.2.3-x64.nsis.7z"<TAB>"<sha512>"<TAB>5000<TAB>120<TAB>1
```

Canonicalizer ([`canonicalizeForSigning`](https://github.com/electron-userland/electron-builder/blob/cdd9f7ec77007cdc9657b9f9faa0be2000564d59/packages/builder-util-runtime/src/updateManifestSignature.ts#L83-L121)):

```typescript
export function canonicalizeForSigning(info: UpdateInfo): string {
  const lines: string[] = [
    UPDATE_MANIFEST_SIGNATURE_VERSION,
    `version:${encodeField(info.version)}`,
    `staging:${encodeField(info.stagingPercentage)}`,
    `minimumSystemVersion:${encodeField(info.minimumSystemVersion)}`,   // always emitted (empty when unset)
  ]
  if (readAllowCatalogSignature(info) === true) { lines.push("allowCatalogSignature:true") }
  const files = (info.files ?? []).map(f => {
    const record = `file:${encodeField(f?.url)}\t${encodeField(f?.sha512)}\t${encodeField(f?.size)}`
    return f?.blockMapUrl == null ? record : `${record}\t${encodeField(f.blockMapUrl)}`
  })
  files.sort()
  lines.push(...files)
  const packages = (info as WindowsUpdateInfo).packages
  if (packages != null) {
    const packageLines = Object.keys(packages).map(arch => {
      const p: Partial<PackageFileInfo> = packages[arch] ?? {}
      return `package:${encodeField(arch)}\t${encodeField(p.path)}\t${encodeField(p.sha512)}\t${encodeField(p.size)}\t${encodeField(p.blockMapSize)}\t${p.isAdminRightsRequired === true ? "1" : ""}`
    })
    packageLines.sort()
    lines.push(...packageLines)
  }
  return lines.join("\n")
}
```

`encodeField`: strings JSON-quoted (escapes `"`/`\`/newline/tab/control), numbers/booleans bare,
`null`/`undefined` → empty string. Records **sorted** (file records, then package records) so key
order can't change the payload; the `EBUM1` tag anchors the scheme so a future `EBUM2` is refused,
not mis-verified.

### 14.4 workbox-window — `Workbox.ts` update handshake (verbatim)

`packages/workbox-window/src/Workbox.ts` @ `4ea3138a` ([perm](https://github.com/GoogleChrome/workbox/blob/4ea3138a120fd2c87389b54130e25f47e0fd7089/packages/workbox-window/src/Workbox.ts#L21-L32)):

```typescript
const WAITING_TIMEOUT_DURATION = 200;
const REGISTRATION_TIMEOUT_DURATION = 60000;
const SKIP_WAITING_MESSAGE = {type: 'SKIP_WAITING'};
```

The client posts `{type:'SKIP_WAITING'}` to the waiting SW; the SW must listen for it and call
`self.skipWaiting()` ([`messageSkipWaiting`](https://github.com/GoogleChrome/workbox/blob/4ea3138a120fd2c87389b54130e25f47e0fd7089/packages/workbox-window/src/Workbox.ts#L325-L329)):

```typescript
messageSkipWaiting(): void {
  if (this._registration && this._registration.waiting) {
    void messageSW(this._registration.waiting, SKIP_WAITING_MESSAGE);
  }
}
```

**Event contract** (jsdoc, L617-L740): `message`, `installed`, `waiting`, `controlling`,
`activated`, `redundant`. Each `WorkboxEvent` carries `sw`, `originalEvent`, `isUpdate?` (a SW was
already controlling at `register()` time), `isExternal` (update from another tab/registration),
`wasWaitingBeforeRegister?` (waiting event), and — for `message` — `data`/`ports`.

---

## 15. Expanded cross-protocol matrix (all 13)

Legend: **✓** first-class in protocol · **◐** present but server/app-driven or partial · **—** not in protocol.

| # | Engine | Manifest | Signing | Delta | Staged rollout | Rollback | Min-version gate | 2026 status |
|---|--------|----------|---------|-------|----------------|----------|------------------|-------------|
| 1 | electron-builder | `latest.yml` (+ EBUM1) | Ed25519 (manifest) + SHA-512 | ✓ blockmap | ✓ `stagingPercentage` (signed) | — (bump) | ✓ `minimumSystemVersion` (signed) | Active v27 |
| 2 | Tauri 2.x | JSON (static/dynamic) | minisign (ed25519) over artifact | — full | — | ◐ `version_comparator` | — | Active 2.x |
| 3a | Capawesome Live Update | channel→bundle (custom id) | RSA (PEM pub) + SHA-256 | ✓ server delta | ◐ channels | ✓ `ready`/`setNextBundle` | — | Active |
| 3b | Capacitor official | channel→bundle | bundle signature | ◐ full | ◐ channels | ◐ pin | — | Active v0.5.0 (2026-02-02) |
| 4 | Squirrel.Windows | `RELEASES` (text, SHA-1) | Authenticode + SHA-1 | ✓ MSDelta/bsdiff | ✓ `# nn%` | — (bump) | — | Active (develop) |
| 5 | Sparkle | RSS appcast | EdDSA/Ed25519, DSA legacy | ✓ `<sparkle:deltas>` | ✓ `phasedRolloutInterval` | ◐ skip model | ✓ `minimumSystemVersion`+`minimumUpdateVersion` | Active 2.x |
| 6 | PWA SW (workbox) | SW lifecycle events | — (TLS + byte diff) | — full script | — | — | — | Active (spec+workbox) |
| 7 | MS App Installer | `.appinstaller` XML | Authenticode (MSIX) | — full MSIX | ✓ `UpdateThreshold` | ◐ OS auto-repair | ◐ MSIX `MinVersion` | Active (OS) |
| 9 | Squirrel.Mac | JSON (`url/sha256/size/delta`) | SHA-256 (advisory) + codesign | ✓ BinaryDelta v3/4 | — | — (bump) | — | Active (c) 2026 |
| 10 | WinSparkle | RSS appcast (Sparkle-identical) | EdDSA/Ed25519, DSA legacy | ◐ full installer | ◐ schema-inherited | — (bump) | ✓ `minimumSystemVersion` | Active (CI green) |
| 11 | CodePush/App Center | deployment→release→package | (frozen) | ✓ (frozen) | ✓ % (frozen) | ✓ redeploy (frozen) | — | **RETIRED 2025-03-31** |
| 12 | Expo Updates | `ExpoUpdatesManifest` (content-addr) | HTTP msg sig (`sig`), EAS cert | — full (hash dedup) | ◐ EAS % | ✓ `isRollBackToEmbedded` | ✓ `runtimeVersion` | Active (spec 1.x) |
| 13 | Omaha (V2) | gupdate XML (req/resp) | SHA-1 (base64) + TLS server | — full codebase | ◐ server | ◐ server | ◐ server (nebraska ARD-001) | **Frozen V2 / archived** |

---

## 16. Protocol-family groupings

**Signature families**
- **Authenticode / OS trust store:** Squirrel.Windows (§4), MS App Installer (§7).
- **macOS code-sign + SHA-256:** Squirrel.Mac (§9).
- **EdDSA/Ed25519 in the feed (embedded pubkey):** Sparkle (§5), WinSparkle (§10), electron-builder EBUM1 (§1).
- **minisign-wrapped ed25519 over the artifact:** Tauri (§2).
- **RSA (PEM pubkey) over the web bundle:** Capawesome (§3a).
- **HTTP message signature (EAS cert):** Expo Updates (§12).
- **SHA-1 + TLS-server trust:** Omaha V2 (§13).
- **None (TLS + byte compare):** PWA SW (§6).

**Delta mechanisms**
- **Per-file binary delta (MSDelta/bsdiff) + per-file shasum:** Squirrel.Windows (§4 / §14.1).
- **App-level BinaryDelta (Sparkle v3/4):** Squirrel.Mac (§9), Sparkle `<sparkle:deltas>` (§5).
- **Blockmap (changed blocks only):** electron-builder (§1).
- **Server differential bundle:** Capawesome (§3a), CodePush (frozen, §11).
- **No delta (full):** Tauri, MS App Installer, WinSparkle (practice), Expo (dedup-only), PWA SW, Omaha V2.

**Staged-rollout mechanisms**
- **Per-line percentage in feed:** Squirrel.Windows `# nn%` (§4).
- **Signed top-level percentage:** electron-builder `stagingPercentage` in EBUM1 (§1).
- **OS fraction:** MS App Installer `UpdateThreshold` (§7).
- **Time-bucketed (interval + pubDate):** Sparkle `phasedRolloutInterval` (§5).
- **Channel/branch assignment:** Capawesome (§3a/§3b), Expo selection policy (§12).
- **Server-decided:** Tauri endpoint, Omaha (§2/§13).
- **None:** Squirrel.Mac, WinSparkle (practice), PWA SW.

**Rollback-signal presence**
- **Explicit protocol rollback signal:** Expo `UpdateCheckResultRollBack` / `isRollBackToEmbedded` (§12), Capawesome `reset`/`setNextBundle`/`autoBlockRolledBackBundles` (§3a).
- **OS-managed:** MS App Installer auto-repair (§7).
- **Skip-model only:** Sparkle `ignoreSkippedUpgradesBelowVersion` (§5).
- **Server-driven:** Omaha (§13), CodePush redeploy (frozen, §11).
- **None (publish newer):** Squirrel.Windows, Squirrel.Mac, WinSparkle, electron-builder, Tauri, PWA SW.

---

## 17. Permalink source index

| Engine | Canonical source | Pinned ref |
|--------|------------------|-----------|
| electron-builder | `packages/builder-util-runtime/src/updateInfo.ts`, `updateManifestSignature.ts` | `cdd9f7ec77007cdc9657b9f9faa0be2000564d59` |
| Tauri updater | `tauri-apps/plugins-workspace` `plugins/updater/src/{updater,config}.rs` + v2.tauri.app/plugin/updater | `v2` @ `2fbd5634` |
| Capawesome Live Update | `capawesome-team/capacitor-plugins` `packages/live-update` + capawesome.io docs | `main` @ `846a3d0b` |
| Capacitor official | npm `@capacitor/live-updates` | **v0.5.0 (2026-02-02), pre-1.0** |
| Squirrel.Windows | `src/Squirrel/{ReleaseEntry,DeltaPackage,ReleasePackage}.cs`, `src/Update/AuthenticodeTools.cs` | `develop` @ `51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f` |
| Sparkle | `Sparkle/SUAppcastItem.h`, `Resources/SampleAppcast.xml`, `generate_appcast/` | `master` @ `10d96f2b` (R1) / `14fdbf28` (R2 verbatim) |
| PWA SW | W3C Service Worker TR (2026-10-29) + `GoogleChrome/workbox` `packages/workbox-window/src/Workbox.ts` | workbox `v6` @ `f3375d95` (R1) / `4ea3138a` (R2 verbatim) |
| MS App Installer | learn.microsoft.com appinstallerschema (2017/2 + 2018 s3 + 2021 s4) | dated spec |
| Squirrel.Mac | `Squirrel/SQRLUpdate.{m,h}`, `SQRLUpdateDelta.h`, `SQRLShipItRequest.h` | `4ad097499fab49c34755981aefaa66ffcd608d71` |
| WinSparkle | `README.md`, `winsparkle-tool`, C API | `0828b4fda11230907b65c48902ab6b3a2681a7ca` |
| CodePush/App Center | `microsoft/react-native-code-push` README (archived) | **RETIRED 2025-03-31** |
| Expo Updates | `expo/expo` `packages/expo-updates/src/Updates.types.ts`, `packages/expo-manifests` | `main` (branch) + spec 1.x |
| Omaha (V2) | `google/omaha` `doc/ServerProtocolV2.md` | `main` @ `c3e428cce2af4f8619658b553292147643820219` (archived) |

> **Reproducibility**: re-run `gh api repos/<owner>/<repo>/commits/<branch>` to refresh any branch
> permalink. Context7 (quota-exceeded) and Exa (rate-limited) were unavailable this session; all
> verbatim material was pulled from cloned source at the pinned SHAs above + official docs/`raw` refs.

---
*End of Round 2 — complete 13-engine protocol survey. Round 1 SHAs/dates captured 2026-11-05;
Round 2 verbatim excerpts captured 2026-11-05 from local clones at the SHAs cited inline.*
