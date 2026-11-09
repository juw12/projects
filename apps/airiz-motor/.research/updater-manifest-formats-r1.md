# Updater Manifest Formats — Research Round 1

> **Purpose.** AIRIZ Motor Console is a one-person-team cross-platform app with 5 surfaces
> (Electron/Windows desktop, Capacitor Android, Capacitor iOS, PWA, Cloudflare Worker).
> The working hypothesis under test: **a single custom signed-manifest-on-R2 layer** that all
> 5 surfaces consume, instead of 5 different native updaters. This document is the evidence
> base for that decision. For each of 7 real-world manifest formats it records: (a) the actual
> serialized content, (b) a field-by-field table (key / description / required / optional / since-version),
> (c) one real-world sample pulled from an actual app's release, and (d) spec-draft PRs in flight.
>
> **Generated:** 2026-11-04 · **Method:** `gh api` against live GitHub releases + source
> (electron-userland/electron-builder@master, tauri-apps/plugins-workspace@v2,
> tauri-apps/tauri@dev, Squirrel/Squirrel.Windows@develop, GoogleChrome/workbox@v7,
> capawesome-team/capacitor-plugins@main, MicrosoftDocs/winrt-related@main), plus official docs.
> **Citations** use branch-qualified GitHub blob URLs (stable enough for research); every real
> sample carries its exact release download URL so it can be re-fetched as a test fixture.

---

## 0. TL;DR — The answer to "what is the minimum viable unified manifest?"

**Short answer: you do NOT need 7 manifests, but you also cannot collapse to 1.**
The field intersection across the 7 formats is small, but the **security model** and the
**update-granularity model** differ in ways that force a layered design:

- **Every** format agrees on the irreducible core: **`version`**, **`url`** (artifact), **integrity
  hash**, **published timestamp**, and **a signature/verification mechanism**. That is the
  minimum a unified manifest must carry.
- **But** "the artifact" is not one thing. electron-builder/Squirrel/Sparkle/AppInstaller update the
  **native binary**; Tauri updates the **whole app bundle**; Capawesome/PWA-Workbox update only the
  **web layer**. A single manifest can name all of these (a `platforms.<target>` map, exactly what
  Tauri already does) but the *verification* differs per target.
- **Signature schemes are not interchangeable.** You have 5 different crypto choices in the wild:
  Ed25519-over-canonical-JSON (electron-builder), minisign-Ed25519-over-artifact-bytes (Tauri),
  RSA-over-bundle (Capawesome), Ed25519 (Sparkle), and SHA-1-weak (Squirrel, effectively unsigned).
  A unified manifest must either (a) embed **per-target** signatures in each native scheme, or
  (b) standardize on ONE scheme (Ed25519) and have each surface verify it. Option (b) is what
  electron-builder just shipped and is the strongest precedent to copy.
- **Targeting (rollout/channel/OS-gate) is where the designs split.** Sparkle, electron-builder
  (`stagingPercentage`) and Squirrel (staging%) put rollout **in the manifest**; Capawesome and
  AppInstaller put it **server-side**. For a one-person team, server-side (R2 + Worker) rollout is
  far easier to operate than re-signing a manifest per percentage.

**Recommended shape (details in §8):** one `application.yml` on R2, signed once with Ed25519
(canonical payload like electron-builder's `EBUM1`), containing a top-level version/date/signature
plus a `targets` map. Each `targets.<surface>` carries `url`, `hash`, `size`, an
**Ed25519 `signature`** over that artifact, and platform-gating (`minOs`, `arch`, `channel`).
The Worker does the rollout/channel gating before returning the manifest. This is essentially
**electron-builder's manifest generalized to N targets + Tauri's per-target map + Capawesome's
server-side rollout**, which is exactly the union your 5 surfaces need.

### Corrections to the prompt's assumptions (evidence-based)
| # | Prompt assumption | What the evidence shows | Source |
|---|---|---|---|
| 1 | Squirrel RELEASES line = `<version> <full-or-delta-flag> <SHA-1> <source-URL>` | Real format is `<SHA1(40hex)> <filename-or-URL> <filesize> [# <staging>%]`. Version is **derived from the filename** (`{name}-{ver}.nupkg`); delta is flagged by the **`-delta.nupkg` suffix**, not a column. | `Squirrel/ReleaseEntry.cs` `entryRegex` |
| 2 | Capawesome config has `serverKey` | Current SDK (`@capacitor-live-update`) uses **`appId`** + **`serverDomain`**; there is no `serverKey`. | `definitions.ts` PluginsConfig |
| 3 | Capawesome manifest carries `rolloutPercent`, `abi`, `abiRequirements` | Those are **server-side** in Capawesome Cloud; the device manifest is minimal (`bundleId`,`downloadUrl`,`checksum`,`signature`,`customProperties`,`artifactType`,`channel`). | `definitions.ts` FetchLatestBundleResult |
| 4 | AppInstaller auto-update uses `HoursAfterUpdate` | The attribute is **`HoursBetweenUpdateChecks`** (0–255, default 24), on `<OnLaunch>`. | `element-s4-onlaunch.md` |
| 5 | electron-updater is a standalone repo | Correct that it was merged; it now lives at `electron-userland/electron-builder` (note the **`electron-userland`** org, not `electron`) under `packages/electron-updater/`. | repo layout |
| 6 | Sparkle ed25519 attribute is `sparkle:ed25519Signature` | The attribute is **`sparkle:edSignature`** (legacy is `sparkle:dsaSignature`). | Sparkle publishing docs + signed sample |
| 7 | Tauri signs a "manifest" | Tauri signs the **artifact bytes** with minisign (not a manifest); the `.sig` is over the bundle, and (new) the **version is bound in the minisign trusted comment**. | `updater_signature.rs` + `updater.rs` |

---

## 1. electron-builder / electron-updater `latest.yml` (NSIS & all targets)

**What it is.** A YAML "channel file" (per-platform variants: `latest.yml`, `latest-mac.yml`,
`latest-linux.yml`, or a custom `<channel>.yml`) that `electron-updater` fetches from a
provider (GitHub/GitLab/Generic/S3) to learn the new version and the files to download.

### 1a. Authoritative schema (from source, `master`)

Types live in `builder-util-runtime/src/updateInfo.ts`; parsing in
`electron-updater/src/providers/Provider.ts`; GitHub resolution in `providers/GitHubProvider.ts`.
Source: https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateInfo.ts

```typescript
interface UpdateInfo {                 // == the top-level `latest.yml` document
  version: string                      // REQUIRED
  files: UpdateFileInfo[]              // REQUIRED
  path?: string                        // LEGACY top-level descriptor (electron-updater 1.x–2.15), deprecated
  sha512?: string                      // LEGACY top-level checksum, deprecated
  releaseName?: string | null
  releaseNotes?: string | ReleaseNoteInfo[] | null
  releaseDate: string                  // REQUIRED
  stagingPercentage?: number           // 0–100, staged rollout
  minimumSystemVersion?: string        // e.g. macOS "23.1.0", Windows "10.0.22631"
  signature?: string                   // Base64 Ed25519 (legacy single-key form)
  signatures?: UpdateManifestSignature[] // multi-key (keyId + signature) for rotation
}
interface UpdateFileInfo {             // each entry under `files:`
  url: string                          // REQUIRED
  sha512: string                       // REQUIRED (Base64)
  size?: number
  blockMapSize?: number                // size of the .blockmap (delta) file
  blockMapUrl?: string                 // explicit blockmap URL (else `${url}.blockmap`)
  isAdminRightsRequired?: boolean
}
interface WindowsUpdateInfo extends UpdateInfo {
  packages?: { [arch: string]: PackageFileInfo } | null  // NSIS web-installer per-arch payload
  allowCatalogSignature?: boolean
  sha2?: string                        // @deprecated @private
}
interface UpdateManifestSignature {
  keyId: string      // lowercase-hex SHA-256 of the SPKI-DER of the signing pubkey
  signature: string  // Base64 Ed25519
}
```

### 1b. Field table

| Key | Type | Required | Since | Description |
|-----|------|----------|-------|-------------|
| `version` | string | **Yes** | 1.x | SemVer of the release. |
| `files[]` | array | **Yes** (modern) | 2.16 | List of downloadable artifacts. |
| `files[].url` | string | **Yes** | 2.16 | Relative (resolved against feed) or absolute artifact URL. |
| `files[].sha512` | string | **Yes** | 2.16 | Base64 SHA-512 of the artifact. |
| `files[].size` | number | No | 2.16 | Byte size (saves a HEAD request). |
| `files[].blockMapSize` | number | No | — | Size of the `.blockmap` (delta) companion. |
| `files[].blockMapUrl` | string | No | new | Explicit blockmap URL (pre-signed CDN case). |
| `files[].isAdminRightsRequired` | bool | No | — | Launch hint only; **not signed** by design. |
| `releaseDate` | string | **Yes** | 1.x | ISO-8601 (RFC3339). |
| `releaseName` | string | No | — | Human name (from GitHub release title). |
| `releaseNotes` | string / array | No | — | String, or `[{version,note}]` when `fullChangelog`. |
| `stagingPercentage` | number | No | v27-ish | 0–100 staged rollout. |
| `minimumSystemVersion` | string | No | v27-ish | OS kernel-version gate. |
| `signature` | string | No | v27 | Legacy single Ed25519 sig over canonical payload. |
| `signatures[]` | array | No | v27 | Multi-key sigs; enables **key rotation**. |
| `packages[arch]` | obj | No (Win) | — | NSIS *web* installer per-arch 7z payload. |
| `path` / top `sha512` | string | No (legacy) | 1.x | Deprecated mirror of `files[0]`; refused for signed manifests. |

### 1c. What the GitHub provider adds (`GitHubProvider.ts`)
- Adds a **`tag`** field (`GithubUpdateInfo extends UpdateInfo { tag }`).
- Resolves the channel file from `/{owner}/{repo}/releases/download/{tag}/{channelFile}`
  where `channelFile` = `latest.yml` (win), `latest-mac.yml` (darwin), `latest-linux[-arch].yml` (linux).
- Reads the tag from `/releases/latest` (or the Atom feed for prerelease channels);
  computes `releaseNotes` from the Atom feed; enforces a tag path-traversal guard.
- Channel/promotion logic: `latest` (stable), `alpha`/`beta` promotable, custom channels.
- Source: https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts

### 1d. The signature (this is the big one for your design)
Manifest signing is a **recent, in-flight** feature. Canonical payload version tag = **`EBUM1`**
("electron-builder update manifest"). Ed25519, Base64.
Source: https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateManifestSignature.ts

`canonicalizeForSigning()` produces an **injective, sorted, newline-separated** payload that signs
**only integrity/rollout-critical fields** (cosmetic fields are deliberately excluded so notes can
be edited post-signing):

```
EBUM1
version:"1.2.3"
staging:25
minimumSystemVersion:"10.0.19041"
allowCatalogSignature:true                                   # only if exactly true
file:"App-1.2.3.exe"	"<sha512>"	8123456
file:"App-1.2.4.exe"	"<sha512>"	8123456	"<blockMapUrl>"  # 4th field only if blockMapUrl set
package:"x64"	"App-1.2.3-x64.nsis.7z"	"<sha512>"	5000	120	1
```

- `encodeField`: strings JSON-quoted, numbers bare, null/undefined → empty (injective).
- `file:` records and `package:` records are **sorted** so ordering can't change the payload.
- **Not signed:** `releaseDate`, `releaseNotes`, `releaseName`, `signature`/`signatures`,
  legacy `path`/`sha512`, and `files[].isAdminRightsRequired`.
- Verification: `verifyManifestSignatures()` accepts if **any** trusted key validates **any**
  signature (this is how key rotation works — a manifest can be dual-signed with `[old,new]`).
- `keyId` = lowercase-hex SHA-256 of the SPKI-DER of the pubkey.
- A signed manifest **must** have a non-empty `files` (the verifier refuses to fall back to the
  unsigned legacy top-level `path`/`sha512`).

### 1e. REAL samples (Joplin v3.7.22 — Windows NSIS; Mattermost v6.3.2 — mac + linux)

**Joplin `latest.yml`** (NSIS; note: no `blockMapSize` in NSIS files, but a `.exe.blockmap`
asset is published alongside):
```yaml
version: 3.7.22
files:
  - url: Joplin-Setup-3.7.22.exe
    sha512: sKyuTCPCWsRD9WxOw2lOB/q0AhIarj3kkDoIo1K3kKEAv9NCP4b/LFFDtvhU5EYFNAHKO/MeYIAXvIVEzgdEqQ==
    size: 368820432
path: Joplin-Setup-3.7.22.exe
sha512: sKyuTCPCWsRD9WxOw2lOB/q0AhIarj3kkDoIo1K3kKEAv9NCP4b/LFFDtvhU5EYFNAHKO/MeYIAXvIVEzgdEqQ==
releaseDate: '2026-10-28T17:38:40.038Z'
```
URL: https://github.com/laurent22/joplin/releases/latest/download/latest.yml

**Mattermost `latest-linux.yml`** (shows `blockMapSize` = the delta field):
```yaml
version: 6.3.2
files:
  - url: mattermost-desktop-6.3.2-x86_64.AppImage
    sha512: erSbqpzYW+uOnoO/yLRAynficIRqgEclWDibY5ZYImxlj4IKljfJlhtRqtICNxabOTWH9zv2nDNtG4h/ig+2jQ==
    size: 136666790
    blockMapSize: 143034
path: mattermost-desktop-6.3.2-x86_64.AppImage
sha512: erSbqpzYW+uOnoO/yLRAynficIRqgEclWDibY5ZYImxlj4IKljfJlhtRqtICNxabOTWH9zv2nDNtG4h/ig+2jQ==
releaseDate: '2026-11-02T07:53:34.847Z'
```
URL: https://github.com/mattermost/desktop/releases/latest/download/latest-linux.yml
(Mattermost `latest-mac.yml` and its `.zip.blockmap` assets are siblings in the same release.)

### 1f. Spec-draft PRs in flight (electron-userland/electron-builder, open)
| PR | Title | Why it matters to you |
|----|-------|-----------------------|
| #10426 | `feat!: EBUM2 update manifest signatures cover every field` | **EBUM2** would sign *all* fields (vs EBUM1's subset). Directly changes the canonical payload you'd copy. |
| #10423 | `feat: add CLI to re-sign an existing update manifest` | Re-signing without rebuild — useful for a custom R2 layer. |
| #10496 | `fix(updater): harden the block map download path (empty maps, size limits, blockMapSha512)` | Introduces **`blockMapSha512`** — integrity for the delta file itself. |
| #10518 | `fix(updater): pick the installer for the app's arch by name, not manifest order` | Arch-selection semantics. |
| #10566 | `feat(updater)!: reject plain http update requests and https-to-http redirects` | Transport hardening (TLS-only). |


---

## 2. @tauri-apps/updater — Tauri 2.x signed JSON manifest

**What it is.** Tauri's updater fetches a JSON document (static file on a CDN/GitHub, or a
dynamic server response) and verifies a **minisign Ed25519** signature over the downloaded
**artifact bytes** (NOT over the manifest). Docs: https://tauri.app/plugin/updater/

### 2a. Two accepted JSON shapes (from source, `plugins-workspace@v2`)

`RemoteRelease` is `#[serde(untagged)]` — the same endpoint can return either shape:
Source: https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs

**Static (multi-platform) shape** — one doc, client picks its target:
```json
{
  "version": "1.0.0",
  "notes": "Release notes",
  "pub_date": "2026-11-04T00:00:00Z",
  "platforms": {
    "linux-x86_64":    { "signature": "<base64 minisign>", "url": "https://.../App.AppImage" },
    "windows-x86_64":  { "signature": "<base64 minisign>", "url": "https://.../App-setup.exe" },
    "darwin-aarch64":  { "signature": "<base64 minisign>", "url": "https://.../App.app.tar.gz" }
  }
}
```

**Dynamic (single-platform) shape** — server already resolved the platform:
```json
{
  "version": "1.0.0",
  "notes": "Release notes",
  "pub_date": "2026-11-04T00:00:00Z",
  "url": "https://.../App-setup.exe",
  "signature": "<base64 minisign>"
}
```

Required: static → `version`, `platforms.<target>.url`, `platforms.<target>.signature`;
dynamic → `version`, `url`, `signature`. `notes`/`pub_date` optional. The client looks up the
target key as `{os}-{arch}` first, then `{os}-{arch}-{bundle_type}` (bundle_type ∈
`appimage|deb|rpm|app|msi|nsis`). A `204 No Content` means "no update."

### 2b. Field table

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `version` | string | **Yes** | SemVer, leading `v` optional. |
| `notes` | string | No | Release notes → JS `update.body`. |
| `pub_date` | string | No | RFC 3339. |
| `platforms` | map | Yes (static) | Keyed by `{os}-{arch}` or `{os}-{arch}-{bundle_type}`. |
| `platforms.<t>.url` | string | **Yes** | Bundle download URL. |
| `platforms.<t>.signature` | string | **Yes** | Base64 minisign signature of the bundle. |
| `url` | string | Yes (dynamic) | Single-platform bundle URL. |
| `signature` | string | Yes (dynamic) | Base64 minisign signature. |

Endpoint URL template vars: `{{current_version}}`, `{{target}}`, `{{arch}}`, `{{bundle_type}}`.
`endpoints` is an ordered array (failover); TLS enforced in production unless
`dangerousInsecureTransportProtocol`.

### 2c. The signature — what is actually signed (the critical detail)

Tauri uses the **minisign** scheme (crate `minisign-verify` / `minisign`), NOT raw Ed25519 and NOT
a manifest signature. Two source files prove the exact contract:

**Build-time signer** (`tauri-apps/tauri@dev`, `crates/tauri-cli/src/helpers/updater_signature.rs`):
https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/helpers/updater_signature.rs
```rust
let mut trusted_comment = format!("timestamp:{}\tfile:{file_name}", unix_timestamp());
if let Some(version) = version {
    trusted_comment.push_str("\tversion:");
    trusted_comment.push_str(version);
}
let signature_box = sign(
    None,
    secret_key,
    data_reader,                              // = the artifact bytes
    Some(trusted_comment.as_str()),           // "timestamp:..\tfile:..\tversion:.."
    Some("signature from tauri secret key"),  // untrusted comment
)?;
let encoded_signature = base64::STANDARD.encode(signature_box.to_string());
// written to <artifact>.sig
```
**Runtime verifier** (`plugins-workspace@v2`, `updater.rs`):
```rust
let pub_key_decoded = base64_to_string(pub_key)?;        // pubkey is base64 minisign
let public_key  = PublicKey::decode(&pub_key_decoded)?;
let signature   = Signature::decode(&signature_b64)?;
public_key.verify(data, &signature, true)?;              // data = artifact bytes; `true` = verify trusted comment
verify_signed_version(signature.trusted_comment(), announced_version, require_signed_version)
```

So the **signature input = the artifact bytes + the minisign trusted comment**
(`timestamp:<unix>\tfile:<name>[\tversion:<semver>]`), and the untrusted comment is the literal
`signature from tauri secret key`. The `.sig` file is the **Base64 of the whole minisign
SignatureBox** (untrusted comment + prehash signature + trusted comment).

- **pubkey** = Base64-encoded minisign public-key box; set in `tauri.conf.json`
  (`plugins.updater.pubkey`) at **build time**, but overridable at **runtime** via
  `.pubkey("...")` on the `UpdaterBuilder` — this is the documented key-rotation path.
- **`require_signed_version`** (new): because the endpoint JSON is **not** signed, the CLI now
  embeds `version:` in the minisign trusted comment; the verifier compares it to the announced
  version to stop a tampered response from pairing a new version number with an old signed bundle.
  Signatures from CLI releases predating `--app-version` carry no version and are rejected when
  this is enabled.
- `createUpdaterArtifacts: true` (v2) / `"v1Compatible"` (migration) makes the bundler emit the
  `.sig` alongside each bundle.

### 2d. REAL sample
Tauri's own docs ship a static-JSON template (the exact contract above). A production example is
what `tauri-action` publishes to GitHub Releases (`latest.json`) in the static shape:
```
https://github.com/<user>/<repo>/releases/latest/download/latest.json
```
(No single canonical "famous" Tauri app publishes a public `latest.json` for citation; the
`tauri-action` output is the reference artifact. The docs template is the authoritative shape:
https://tauri.app/plugin/updater/ → "Static JSON File".)

### 2e. Spec-draft / in-flight
- The **`require_signed_version`** / trusted-comment version binding is the newest change and the
  most relevant to a unified manifest (it's Tauri's answer to "the manifest is unsigned").
- Tauri 2 requires **Rust 1.90+** per current docs.


---

## 3. Capacitor Live Update — Capawesome Cloud (`@capawesome/capacitor-live-update`)

**What it is.** An **OTA web-layer-only** updater. The native binary is untouched; a "bundle"
(zip of HTML/CSS/JS/assets) is downloaded, staged, and swapped into the WebView. Capawesome
Cloud is a SaaS (the SDK is MIT, lives in the `capawesome-team/capacitor-plugins` monorepo).
Docs: https://capawesome.io/docs/cloud/live-updates/ · SDK types:
https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts

> **Architectural note for your design.** Capawesome is the polar opposite of the desktop formats:
> **all targeting is server-side.** The device manifest is *minimal* because the Cloud has already
> applied channel + rollout + version-gating and returns only the one bundle this device gets.
> This is the model to copy if you put rollout logic in your Cloudflare Worker.

### 3a. The device-side manifest (`fetchLatestBundle()` → `FetchLatestBundleResult`)
```jsonc
{
  "bundleId": "6e351b4f-69a7-415e-a057-4567df7ffe94",   // = the app-build artifact id; null if none
  "artifactType": "zip",                                  // "zip" | "manifest"  (Electron: zip only)
  "channel": "production",                                // resolved channel (may differ from requested)
  "downloadUrl": "https://cdn.cloud.capawesome.io/...",   // pass to downloadBundle()
  "checksum": "9f2c…",                                    // SHA-256 hex — self-hosted only
  "signature": "MEUCIQ…",                                 // RSA-signed SHA-256, base64 — self-hosted only
  "customProperties": { "version": "1.4.0", "note": "…" } // free-form strings
}
```
For **Cloud-hosted** bundles, `checksum`/`signature` are returned as **response headers** at
download time instead of in this JSON. For **self-hosted** bundles they are in the JSON (or, for
`artifactType: "manifest"`, the server returns per-file `X-Checksum` (SHA-256 hex) and
`X-Signature` (signed SHA-256 base64) headers while the SDK fetches each file as
`<base>?href=<file>`).

### 3b. Field table (device manifest)

| Key | Type | Required | Since | Description |
|-----|------|----------|-------|-------------|
| `bundleId` | string\|null | **Yes** | 6.6.0 | Unique bundle id (build artifact id). `null` = no update. `public` is reserved. |
| `downloadUrl` | string | No (for download) | 6.7.0 | URL to fetch; pass to `downloadBundle()`. |
| `artifactType` | `"zip"`\|`"manifest"` | No | 6.7.0 | `zip` = one archive; `manifest` = base URL, files via `?href=`. |
| `channel` | string | No | 8.3.0 | Resolved channel after forced-assignment. |
| `checksum` | string | No | 7.1.0 | SHA-256 hex (self-hosted). |
| `signature` | string | No | 7.1.0 | RSA-signed SHA-256, base64 (self-hosted). |
| `customProperties` | object | No | 7.0.0 | Free-form `{string:string}` (version, notes, …). |

`downloadBundle()` options add: `url` (**Yes**), `bundleId` (**Yes**), `artifactType`,
`checksum`, `signature`.

### 3c. Config (what goes in `capacitor.config.ts` → `plugins.LiveUpdate`)

| Key | Since | Default | Description |
|-----|-------|---------|-------------|
| `appId` | 5.0.0 | — | Capawesome Cloud app id (UUID). **NOT** the bundle identifier. (The prompt's "serverKey" is actually this + `serverDomain`.) |
| `serverDomain` | 7.0.0 | `api.cloud.capawesome.io` | Cloud API domain, no scheme/path. |
| `publicKey` | 6.1.0 | — | **PEM RSA public key** (no newlines) to verify bundle signatures. |
| `defaultChannel` | 6.3.0 | — | Default channel (e.g. `production`). Overridable by `setChannel()`/native config. |
| `readyTimeout` | 5.0.0 | `0` | ms to wait for `ready()` before rolling back to the default bundle. |
| `autoUpdateStrategy` | 7.3.0 | `"none"` | `"none"` \| `"background"` (auto download/apply on start + resume if last check >15 min). |
| `autoBlockRolledBackBundles` | 7.3.0 | `false` | Auto-block bundles that caused a rollback (max 100). |
| `autoDeleteBundles` | 5.0.0 | `false` | Delete unused bundles after `ready()`. |
| `httpTimeout` | 6.4.0 | `60000` | HTTP request timeout ms. |

**Signature scheme = RSA** (2048/3072/4096), generated by `npx @capawesome/cli
apps:liveupdates:generatesigningkey`, bundle signed on upload with `--private-key`. (Contrast:
electron-builder/Tauri/Sparkle all use Ed25519.)

### 3d. Server-side targeting (NOT in the device manifest)
- **Versioned bundles:** `--android-min/max/eq`, `--ios-min/max/eq`, `--electron-min/max/eq`
  (versionCode / CFBundleVersion / Electron version ranges). The Cloud only serves the bundle to
  devices inside the range. (This is Capawesome's answer to the prompt's `abi`/`abiRequirements`
  — it exists, but server-side.)
- **Rollout:** `rolloutPercentage` on a *deployment* (CLI `src/types/app-deployment.ts` /
  `app-bundle.ts` carry `rolloutPercentage?: number`); gradual 10→25→50→100%.
- **Channels:** per-device subscription; pausing, surfing, forcing, protection (signed-only).
- **Rollback:** automatic (device fails to launch → reverts to last good bundle) + manual.

### 3e. Re-check triggers (the prompt's `appVersionChange`/`appReady`)
- `readyTimeout` + `ready()`: the app must call `ready()` once usable or the SDK reverts to the
  default bundle (rollback). `ReadyResult` = `{ previousBundleId, currentBundleId, rollback }`.
- `autoUpdateStrategy: "background"`: re-check on **app startup** and **resume** (if >15 min since
  last check). Native app **version change** resets runtime config (bundles must stay
  binary-compatible — a native update is the `appVersionChange` boundary).
- Events: `downloadBundleProgress`, `nextBundleSet`, `reloaded`.

### 3f. Real-world note
Capawesome Cloud is a closed SaaS, so there is no public sample manifest to cite; the
`FetchLatestBundleResult` above (from `definitions.ts`) **is** the wire schema. The MIT SDK source
is the authoritative reference.


---

## 4. Squirrel.Windows — `RELEASES` feed + `.nupkg`/`.nuspec`

**What it is.** The classic Windows "wizard-free" installer/updater (used by older Electron/VS Code
lineage, System Informer, etc.). Updates are **NuGet packages** (`.nupkg`) listed in a plain-text
`RELEASES` file. **Integrity is SHA-1 only and there is NO signature** — the feed is effectively
"trust TLS." This is the weakest security model of the seven.
Source (authoritative parser): https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs
Docs: https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/

### 4a. The `RELEASES` file — real line format (CORRECTED from the prompt)
The parser regex is the ground truth:
```csharp
static readonly Regex entryRegex   = new Regex(@"^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$");
static readonly Regex stagingRegex = new Regex(@"#\s+(\d{1,3})%$");
static readonly Regex commentRegex = new Regex(@"\s*#.*$");
```
So **each line** is:
```
<SHA1:40-hex> <filename-or-absolute-URL> <filesize-bytes> [# <staging 0-100>%]
```
- **There is NO version column and NO full/delta flag column.** The version is **derived from the
  filename** (`{Id}-{version}[-full|-delta].nupkg` → `SemanticVersion`), and **delta is detected by
  the filename ending in `-delta.nupkg`** (`filenameIsDeltaFile`).
- The second field may be a bare filename **or** an absolute `http(s)` URL (split into
  `BaseUrl` + `Filename` + optional `?query`).
- Optional trailing `# NN%` sets `StagingPercentage`; `IsStagingMatch(userGuid)` compares
  `last 4 bytes of the user's GUID as uint / UInt32.MaxValue < percentage` — i.e., staged rollout.
- Entries are **written sorted by version ascending, then delta descending** (full before delta).
- A `.nupkg`'s release notes + icon are read from its `.nuspec` (`GetReleaseNotes`, `GetIconUrl`).

**Realistic `RELEASES` content** (shape matches `ReleaseEntry` exactly):
```
3a7bd3e2360a3d29eea436fcfb7e44c735d11724  MyApp-1.0.0-full.nupkg  5120000
9c1f0e5a2b3d4c5e6f708192a3b4c5d6e7f80912  MyApp-1.0.1-full.nupkg  5135000
1b2c3d4e5f60718293a4b5c6d7e8f90123456789  MyApp-1.0.1-1.0.0-full.nupkg  320000
aa90f1e2d3c4b5a69788796a5b4c3d2e1f001122  MyApp-1.1.0-full.nupkg  5200000 # 25%
```
(line 3 is a delta from 1.0.0→1.0.1, named `…-1.0.0-full.nupkg`; line 5 is staged at 25%.)

### 4b. `RELEASES` field table (per line)

| Column | Pattern | Required | Description |
|--------|---------|----------|-------------|
| 1 SHA1 | `[0-9a-fA-F]{40}` | **Yes** | SHA-1 of the `.nupkg`. |
| 2 Filename/URL | `\S+` | **Yes** | Bare filename or absolute URL. Encodes version + full/delta via naming. |
| 3 Filesize | `\d+` | **Yes** | Byte size. |
| 4 Staging | `# NN%` | No | 0–100 rollout percentage. |

**naming convention** (`naming.md` / `nuget-package-metadata.md`):
- Full package: `{Id}-{version}-full.nupkg`
- Delta package: `{Id}-{version}-{prevVersion}-delta.nupkg`
- `Id` must have **no spaces or dots**; it drives `%LocalAppData%\<Id>` install dir.

### 4c. The `.nuspec` (inside each `.nupkg`)
A `.nupkg` is a zip; its `.nuspec` carries metadata Squirrel reads:
| Element | Required | Used by Squirrel for |
|---------|----------|----------------------|
| `<id>` | **Yes** | App name, package filename prefix, install dir. No spaces/dots. |
| `<version>` | **Yes** | Version (from `Properties\AssemblyInfo`); Uninstaller display. |
| `<title>` | No | Name in Windows "Apps & features". |
| `<description>` | No | Description. |
| `<releaseNotes>` | **Yes (to update)** | `GetReleaseNotes()` throws if empty. |
| `<iconUrl>` | No | `.ico` for shortcuts + Uninstaller (fetched at install time). |
| `<authors>` | No | Author. |
| `<language>` | No | Codepage (default 1252). |
| `<dependencies>` | No | Dependency packages. |

A minimal `.nuspec`:
```xml
<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>MyApp</id>
    <version>1.1.0</version>
    <title>MyApp</title>
    <authors>Me</authors>
    <description>MyApp</description>
    <releaseNotes>Bug fixes</releaseNotes>
    <iconUrl>https://example.com/icon.ico</iconUrl>
  </metadata>
</package>
```
**`[Content_Types].xml`** (standard .NET/OPC inside the nupkg):
```xml
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="nuspec" ContentType="application/octet"/>
  <Default Extension="dll"  ContentType="application/octet"/>
  <!-- one Default/Override per file in the nupkg -->
</Types>
```
**Delta storage:** a `-delta.nupkg` contains only the changed files (produced by the
`CreateDeltaPackages` / delta tooling, `docs/using/delta-packages.md`); Squirrel applies the
smallest delta chain from the installed version, falling back to a full package.

### 4d. Real-world note
Squirrel feeds are usually hosted on a vendor CDN (not GitHub), so there is no single "GitHub
release" sample; the `RELEASES` shape above is exactly what `ReleaseEntry.ParseReleaseFile`
accepts and what `BuildReleasesFile`/`WriteReleaseFile` emit. Real consumers: System Informer
(see its `.appinstaller` in §7 for the modern successor), legacy VS Code, and many Electron apps.

### 4e. In-flight
Squirrel.Windows is **unmaintained** (README: "Contributors Needed", issue #1470). Microsoft's
successor path is **App Installer / MSIX** (§7) — relevant if you're choosing a Windows strategy
in 2026.


---

## 5. Sparkle appcast (macOS, RSS + `sparkle:` namespace)

**What it is.** An **RSS 2.0** feed with a `sparkle:` XML namespace; each `<item>` is one update.
Sparkle 2 signs the update archive (and optionally the whole feed) with **EdDSA (ed25519)**.
Docs: https://sparkle-project.org/documentation/publishing/ · namespace:
`http://www.andymatuschak.org/xml-namespaces/sparkle`

### 5a. Full `<rss><channel>` schema (from the official publishing docs)

```
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>…</title> <link>…</link> <description>…</description> <language>en</language>
    <item> …one per update, newest first… </item>
  </channel>
</rss>
```

### 5b. `<item>` field table

| Element / attribute | Req | Since | Description |
|---------------------|-----|-------|-------------|
| `<title>` | **Yes** | — | Human title ("Version 2.0 (…)"). |
| `<link>` | **Yes** | — | Fallback URL shown when the user can't update (OS too old). |
| `<sparkle:version>` | **Yes** | — | Machine version = `CFBundleVersion` (build number). |
| `<sparkle:shortVersionString>` | No | — | Human version = `CFBundleShortVersionString` (hides the build number). |
| `<pubDate>` | **Yes** | — | RFC-822 `E, dd MMM yyyy HH:mm:ss Z`. Required for phased rollout. |
| `<enclosure url length type>` | **Yes** (to install) | — | `url` = archive (dmg/zip/tar.xz/aar/pkg); `length` = bytes; `type` = MIME. |
| `enclosure sparkle:edSignature` | **Yes** (to install, Sparkle 2) | 2.0 | Base64 **ed25519** signature of the archive. |
| `enclosure sparkle:dsaSignature` | legacy | 1.x | Legacy **DSA** signature (being retired). |
| `<description>` | No | — | Embedded release notes (CDATA HTML; `sparkle:format="plain-text"` 2.4+, `"markdown"` 2.9+/macOS12+). |
| `<sparkle:releaseNotesLink>` | No | — | External notes URL; can carry `xml:lang` for localization and (signed feeds) `sparkle:edSignature`+`sparkle:length`. |
| `<sparkle:fullReleaseNotesLink>` | No | 2.0 | Full version-history link. |
| `<sparkle:minimumSystemVersion>` | No | — | e.g. `12.0.0` (three-part). |
| `<sparkle:maximumSystemVersion>` | No | — | Upper OS bound. |
| `<sparkle:hardwareRequirements>` | No | 2.9 | e.g. `arm64` (require Apple silicon). |
| `<sparkle:minimumAutoupdateVersion>` | No | — | Marks a **major** upgrade (lowest version that may auto-update to this). |
| `<sparkle:ignoreSkippedUpgradesBelowVersion>` | No | 2.1 | Re-notify users who skipped below this version. |
| `<sparkle:informationalUpdate>` | No | 2.0 | With `<sparkle:version>` or `<sparkle:belowVersion>` children = link-only, no install. |
| `<sparkle:criticalUpdate>` | No | 2.0 | Top-level (or `<sparkle:tags>` in v1); optional `sparkle:version` = only older than this see it as critical. |
| `<sparkle:phasedRolloutInterval>` | No | — | Seconds between rollout groups; **7 groups hardcoded**. |
| `<sparkle:channel>` | No | 2.0 (2021-06-27) | e.g. `beta`; only updaters that `allowedChannelsForUpdater:` include it see the item. |
| `<sparkle:minimumUpdateVersion>` | No | 2.9 | Min `CFBundleVersion` required to see this update. |
| `enclosure sparkle:os` | No | — | `macos`/other, to mix OSes in one feed (not recommended). |

**Custom namespaces** are allowed (`xmlns:myapp=…` → `<myapp:messageOfTheDay>`), read in
`SPUUpdaterDelegate`.

### 5c. Signature scheme + the DSA → EdDSA migration story
- **Keygen:** `./bin/generate_keys` → private key in the macOS Keychain, prints a Base64 **public
  key** to embed as `SUPublicEDKey` in `Info.plist`.
- **Sign:** `./bin/sign_update path/to/app.zip` → emits
  `sparkle:edSignature="…" length="…"` to paste onto the `<enclosure>`.
- **`generate_appcast`** builds the appcast + **binary delta** (`.delta`) files + (if
  `SURequireSignedFeed`) signs the appcast and release-note files.
- **Migration DSA → EdDSA:** Sparkle 1 used **DSA** (`sparkle:dsaSignature`, public key
  `SUPublicKey`). DSA is weak/legacy; Sparkle 2 introduced **EdDSA/ed25519**
  (`sparkle:edSignature`, key `SUPublicEDKey`). Apps migrate by publishing EdDSA signatures; older
  Sparkle can still read DSA during the transition, then DSA is dropped (see
  `/documentation/eddsa-migration`). **Key rotation** is supported (via a new update that changes
  the Apple code-signing cert **or** the EdDSA key, not both; with `SUVerifyUpdateBeforeExtraction`
  only via a Developer-ID-signed dmg).
- **Signed feeds** (`SURequireSignedFeed`, Sparkle 2.9+): the whole appcast + release notes are
  signed; a `<!-- sparkle-signatures: edSignature: … length: … -->` trailer is appended to the feed.

### 5d. REAL sample (the actual signed Sparkle test cast shipped with the distribution)
`https://sparkle-project.org/files/sparkletestcast-signed.xml`:
```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<!-- sparkle-sign-warning: … Any modifications requires re-signing … -->
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
  <channel>
    <title>Sparkle Test App Changelog</title>
    <link>http://sparkle-project.org/files/sparkletestcast.xml</link>
    <description>Most recent changes with links to updates.</description>
    <language>en</language>
    <item>
      <title>Version 3.0</title>
      <link>https://sparkle-project.org</link>
      <sparkle:version>3.0</sparkle:version>
      <description><![CDATA[ <ul><li>…</li></ul> ]]></description>
      <pubDate>Sun, 27 Jul 2014 15:20:11 +0000</pubDate>
      <enclosure url="https://sparkle-project.org/files/Sparkle%20Test%20App3.zip"
                 length="107798" type="application/octet-stream"
                 sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="/>
    </item>
    <item>
      <title>Version 2.0</title>
      <link>https://sparkle-project.org</link>
      <sparkle:version>2.0</sparkle:version>
      <sparkle:releaseNotesLink sparkle:edSignature="4KjvG1GjKwXrxfqXbU1j2CYClEDdkMDp2Ii2ICV+Jgx00MDpHFLpLJ+/2tHy9Mp9bTUk5KlpCG1OWBu4nLKOCw=="
                                sparkle:length="1467">https://sparkle-project.org/release_notes/app_2.0.html</sparkle:releaseNotesLink>
      <pubDate>Sat, 26 Jul 2014 15:20:11 +0000</pubDate>
      <enclosure url="https://sparkle-project.org/files/Sparkle%20Test%20App.zip"
                 length="107758" type="application/octet-stream"
                 sparkle:edSignature="5wv7MoSNI5UbwrH+fRFIauntNrHlFErA70M5O2JKzUb+hQTcMwTwvwvzHdkYzxtfQMxx9w0MiD299OSovqVfCw=="/>
    </item>
  </channel>
</rss>
<!-- sparkle-signatures:
edSignature: kEUC8Fl3kZpf/PDMkhg10Y+s5qRuchzim5qNZmCR9yWuW+fA1jynrI+t45KihXhtYUHgCsIFqTIrzSc3NKecCQ==
length: 2558
-->
```
This single file demonstrates: embedded notes (CDATA), an external **signed** release-notes link,
per-enclosure `sparkle:edSignature`, and the **signed-feed** trailer.
(An unsigned variant is at `…/files/sparkletestcast.xml`.)

### 5e. In-flight
Sparkle 2.x is actively maintained on the `2.x` branch; the notable recent feature is **signed
feeds (2.9+)** and `sparkle:hardwareRequirements`/markdown-notes (2.9). No open "schema rewrite"
PR of note — the schema is stable; feature PRs add elements, not breaking changes.


---

## 6. PWA — Workbox `workbox-precaching` manifest

**What it is.** Not a "version manifest" like the others — it's the **list of URLs to precache**
into the Cache Storage API during the service worker's `install` event, used to make the PWA
offline-capable and to version static assets. Docs:
https://developer.chrome.com/docs/workbox/modules/workbox-precaching · Source:
`GoogleChrome/workbox@v7` (`packages/workbox-precaching`, `packages/workbox-build`).

### 6a. The manifest — a `PrecacheEntry[]` array
```typescript
interface PrecacheEntry {
  url: string            // REQUIRED
  revision: string|null  // REQUIRED to be explicit (v5+); null = "version is in the URL"
  integrity?: string     // OPTIONAL Subresource Integrity hash
}
// usage in the service worker:
precacheAndRoute([
  { url: '/index.html',        revision: '383676' },      // unversioned URL -> hash
  { url: '/styles/app.0c9a31.css', revision: null },       // hash already in filename
  { url: '/scripts/app.0d5770.js', revision: null },
]);
```
- **`revision`**: for URLs that already contain a content hash (typical for JS/CSS emitted by a
  bundler), set `revision: null`. For URLs that can't be hashed in the name (e.g. `index.html`),
  set `revision` to a **content hash Workbox generated at build time**.
- **Cache key**: the stored cache key is the URL + `?__WB_REVISION__=<revision>` for unversioned
  entries (see `getCacheKeyForURL`). Versioned (`revision:null`) entries use the URL as-is.
- **v5 deprecation**: passing bare string URLs is deprecated; you must pass `{url, revision}` and
  use `revision: null` to opt out of revisioning. (v6 drops string support entirely.)
- **`integrity`**: optional SRI hash; used as the `Request.integrity` when precaching from the
  network; a mismatch fails the precache.

### 6b. `self.__WB_MANIFEST` injection
In **`injectManifest`** mode (workbox-build / workbox-webpack-plugin), you write the SW and leave a
sentinel:
```js
/// workbox: "injectionPoint"
self.__WB_MANIFEST = [
  /* {url, revision, integrity}, … */
];
precacheAndRoute(self.__WB_MANIFEST);
```
At build time the tool **replaces** `self.__WB_MANIFEST` with the generated entry array (or injects
it at the `/// workbox: "injectionPoint"` marker). In **`generateSW`** mode the tool generates the
whole SW (including the manifest) for you.

### 6c. How the revision hash is computed (from source)
The build computes a **revision** per precacheable asset. The core hash helper
(`workbox-build@v7`, `src/lib/get-string-hash.ts`):
https://github.com/GoogleChrome/workbox/blob/v7/packages/workbox-build/src/lib/get-string-hash.ts
```ts
import crypto from 'crypto';
export function getStringHash(input: crypto.BinaryLike): string {
  const md5 = crypto.createHash('md5');
  md5.update(input);
  return md5.digest('hex');
}
```
→ **the `revision` for an unversioned URL is the MD5 (hex) of the file content.** For webpack,
`workbox-webpack-plugin` uses `get-asset-hash.ts` (content hash of the asset source). URLs whose
filename already matches a content-hash pattern are left `revision: null` (no re-hashing).

### 6d. Subresource Integrity (SRI) — how hashes are generated
Workbox does **not** generate SRI for you. You add it via a **`manifestTransform`** in the build
config, typically with the `ssri` package:
```js
const ssri = require('ssri');
const integrityManifestTransform = (originalManifest, compilation) => {
  const manifest = originalManifest.map(entry => {
    if (shouldAddIntegrity(entry.url)) {
      const asset = compilation.getAsset(entry.url);        // webpack; for workbox-build read from disk
      entry.integrity = ssri.fromData(asset.source.source()).toString(); // e.g. "sha384-…base64…"
    }
    return entry;
  });
  return { warnings: [], manifest };
};
```
So SRI hashes are standard **`ssri`** digests (SHA-384/SHA-512 base64) computed over asset bytes —
independent of Workbox's MD5 `revision`.

### 6e. webpack plugin vs Vite plugin
| | `workbox-webpack-plugin` | `vite-plugin-pwa` |
|---|---|---|
| Modes | `GenerateSW` (generate whole SW) / `InjectManifest` (your SW + inject) | `generateSW` / `injectManifest` (wraps the same Workbox build) |
| Manifest source | webpack `compilation` assets (`get-asset-hash`) | Vite build output / rollup manifest |
| `self.__WB_MANIFEST` | Supported in InjectManifest | Supported in injectManifest mode |
| Extra | `manifestTransform` gets `compilation` | `injectRegister` options, dev options, workbox config passthrough |
Both ultimately call the same `workbox-build` `createManifest`/`injectManifest` pipeline, so the
`{url, revision, integrity}` shape and MD5 revision are identical.

### 6f. What goes in the manifest: Workbox-precaching vs raw service worker
- **Workbox precaching:** you provide `precacheAndRoute([...])` (or the generated one); Workbox
  wires `install`/`activate`, dedupes, adds the `__WB_REVISION__` cache keys, handles
  `ignoreURLParametersMatching` (default strips `utm_*`/`fbclid`), `directoryIndex` (`index.html`),
  `cleanUrls` (`.html` fallback), and `urlManipulation`.
- **Raw SW (no Workbox):** there is **no manifest file at all** — you call `caches.open()` +
  `cache.addAll([...urls])` in `install` yourself, manage cache names/versions and cleanup in
  `activate`, and do your own versioning. "The manifest" is just the inline URL array in your code.
  (This is the relevant comparison for your **PWA + Cloudflare Worker** surface: the Worker can
  emit the Workbox manifest or a hand-rolled URL list.)

### 6g. Real-world note
Workbox manifests are **build artifacts** (committed nowhere; generated per build), so there's no
"citable release sample." The canonical reference is the `precacheAndRoute` doc example above and
the `GoogleChrome/workbox` `packages/workbox-precaching` source (`PrecacheController.ts`, which
implements `__WB_MANIFEST` consumption, cache-key derivation, and SRI via
`getIntegrityForCacheKey`).


---

## 7. Microsoft App Installer — `.appinstaller` (MSIX/MSIXBundle auto-update)

**What it is.** An XML file that points the **Windows App Deployment service** at an
`AppxPackage` (`.msix`/`.appx`) or `AppxBundle` (`.msixbundle`/`.appxbundle`), and configures
**automatic updates** (on-launch + background). Delivered/invoked via the **`ms-appinstaller://`**
URI protocol (e.g. `ms-appinstaller://install?source=<url>&update_id=<id>`). Four schema versions
exist; **v4 = namespace `http://schemas.microsoft.com/appx/appinstaller/2021`** (Win10 1809+
features, Win11 21H2 build 22000 for the newest).
Authoritative per-element docs: `MicrosoftDocs/winrt-related@main`,
`winrt-related-src/schemas/appinstallerschema/element-s4-*.md`.

### 7a. Full schema (v4)

```
<AppInstaller  Uri            (Yes)   Web URI to (possibly redirecting) this .appinstaller, 1–2084 chars
              Version        (Yes)   quad "M.m.b.r", M != 0
              IgnorableNamespaces?   space-separated namespaces to skip (untrusted)
>
  ( UpdateUris?            # list of <UpdateUri> — other .appinstaller URLs to check for updates
  & RepairUris?            # list of <RepairUri> — URLs used for in-place repair
  & ( MainPackage? | MainBundle? )   # exactly ONE
  & OptionalPackages?      # <OptionalPackage> installed alongside main
  & RelatedPackages?       # <RelatedPackage> NOT installed as part of this deployment
  & Dependencies?          # <Dependency> installed if required
  & UpdateSettings? )      # OnLaunch? AutomaticBackgroundTask? ForceUpdateFromAnyVersion?
</AppInstaller>
```
Only `encoding="UTF-8"`, no escape chars, no non-ASCII. `<MainPackage>` is for `.appx`/`.msix`;
`<MainBundle>` is for `.appxbundle`/`.msixbundle`.

### 7b. Field tables

**`<AppInstaller>` (root)**
| Attribute | Req | Description |
|-----------|-----|-------------|
| `Uri` | **Yes** | Web URI to the (redirecting) .appinstaller; max 3 redirects; 1–2084 chars. |
| `Version` | **Yes** | Quad version, major ≠ 0. |
| `IgnorableNamespaces` | No | Namespaces to ignore (unvalidated/untrusted). |

**`<MainPackage>`** (vs `<MainBundle>` which also has `ResourceId`)
| Attribute | Req | Description |
|-----------|-----|-------------|
| `Name` | **Yes** | Package family name (3–50, alnum/`.`/`-`), case-insensitive. Must match AppxManifest identity. |
| `Publisher` | **Yes** | Distinguished name (1–8192), e.g. `CN=…, O=…, L=…, S=…, C=…`. Must match identity. |
| `Version` | **Yes** | Quad, major ≠ 0. Must match identity. |
| `Uri` | **Yes** | URL to the `.msix`/`.appx`. |
| `ProcessorArchitecture` | No* | `x86`/`x64`/`arm`/`arm64`/`neutral`. *Required if package has executable code. Must match. |
| `ResourceId` | No | ASCII 1–30, publisher-specified (not `CON`/`COM1`/…). |

**`<UpdateSettings>`** → children (each optional, zero-or-one):
| Element | Description |
|---------|-------------|
| `<OnLaunch>` | Check for update when the app launches. |
| `<AutomaticBackgroundTask/>` | Presence = system checks for updates in the background. |
| `<ForceUpdateFromAnyVersion>true</…>` | Allow updating from **any** version (incl. downgrades). |

**`<OnLaunch>`** (the auto-update block; CORRECTED attribute names)
| Attribute | Req | Default | Description |
|-----------|-----|---------|-------------|
| `HoursBetweenUpdateChecks` | No | `24` | 0–255. 0 = check every launch; else check only if not checked within N hours. (Prompt called it "HoursAfterUpdate" — the real name is this.) |
| `ShowPrompt` | No | — | (Win10 1903+) Show a prompt about the update. For packaged desktop apps this stays silent. |
| `UpdateBlocksActivation` | No | — | (Win10 1903+, only with `ShowPrompt=true`) Block app launch until update applied. |

**`<UpdateUris>` / `<RepairUris>`** → repeatable `<UpdateUri>`/`<RepairUri>` (text = a URL to
another `.appinstaller`). **`<OptionalPackages>`** → `<OptionalPackage Name Publisher Version
Uri ProcessorArchitecture?/>`. **`<Dependencies>`** → `<Dependency Name Publisher Version Uri?
ProcessorArchitecture?/>`. **`<RelatedPackages>`** → `<RelatedPackage …/>`.

### 7c. REAL samples

**Nheko** (open-source Telegram client, stable) — `resources/Nheko.appinstaller`:
https://github.com/Nheko-Reborn/nheko/blob/main/resources/Nheko.appinstaller
```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller Uri="https://nheko-reborn.pages.nheko.im/nheko/Nheko.appinstaller"
              Version="0.0.0.1" xmlns="http://schemas.microsoft.com/appx/appinstaller/2018">
  <MainPackage Name="im.nheko.Nheko" Version="0.12.1.0"
               Publisher="CN=Nicolas Werner, O=Nicolas Werner, L=Munich, S=Bavaria, C=DE"
               Uri="https://nheko.im/api/v4/projects/2/packages/generic/windows/0.12.1.0/nheko.msix"
               ProcessorArchitecture="x64" />
  <UpdateSettings>
    <!-- check once a week -->
    <OnLaunch HoursBetweenUpdateChecks="168" ShowPrompt="true" />
    <ForceUpdateFromAnyVersion>true</ForceUpdateFromAnyVersion>
  </UpdateSettings>
</AppInstaller>
```
(A `NhekoNightly.appinstaller` sibling points `MainPackage.Uri` at the `windows-nightly` package.)

**System Informer / Process Hacker** (open source; shows `UpdateUris`+`RepairUris`+
`AutomaticBackgroundTask`+`UpdateBlocksActivation`) — `tools/msix/PackageTemplate.appinstaller`:
https://github.com/DavidXanatos/TaskExplorer/blob/master/ProcessHacker/tools/msix/PackageTemplate.appinstaller
```xml
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
              Version="3.0.0.0" Uri="https://systeminformer.sourceforge.io/systeminformer.appinstaller">
  <MainPackage Name="SystemInformer"
               Publisher="CN=Winsider Seminars & Solutions Inc., O=Winsider Seminars & Solutions Inc., L=Montréal, S=Quebec, C=CA"
               Version="3.0.0.0" ProcessorArchitecture="x64"
               Uri="https://systeminformer.sourceforge.io/systeminformer-build-package.msix" />
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="24" UpdateBlocksActivation="true" ShowPrompt="true" />
    <ForceUpdateFromAnyVersion>true</ForceUpdateFromAnyVersion>
    <AutomaticBackgroundTask />
  </UpdateSettings>
  <UpdateUris>
    <UpdateUri>https://systeminformer.sourceforge.io/systeminformer.appinstaller</UpdateUri>
    <UpdateUri>https://systeminformer.com/systeminformer.appinstaller</UpdateUri>
    <UpdateUri>https://system-informer.com/systeminformer.appinstaller</UpdateUri>
  </UpdateUris>
  <RepairUris>
    <RepairUri>https://systeminformer.sourceforge.io/systeminformer.appinstaller</RepairUri>
    <RepairUri>https://systeminformer.com/systeminformer.appinstaller</RepairUri>
    <RepairUri>https://system-informer.com/systeminformer.appinstaller</RepairUri>
  </RepairUris>
</AppInstaller>
```

### 7d. `ms-appinstaller://` protocol
Invoke the deployment service from a webpage/shortcut:
`ms-appinstaller://install?source=<url-encoded .appinstaller url>&update_id=<id>&caller_id=<id>`
(`source` required; `update_id`/`caller_id` optional). This is how a non-installed user "click to
install," and how a site can trigger an in-place update for an already-installed package.

### 7e. In-flight
The schema is **stable** (v4 = 2021 namespace is current). No breaking draft PRs; feature work
lives in the Windows deployment service, not the schema. If you standardize Windows on MSIX +
App Installer, this v4 schema is the target.


---

## 8. Cross-format synthesis

### 8a. Field convergence matrix (✔ = present & meaningful, — = absent)

| Concept | 1 e-builder | 2 Tauri | 3 Capawesome | 4 Squirrel | 5 Sparkle | 6 Workbox | 7 AppInstaller |
|---|---|---|---|---|---|---|---|
| `version` | ✔ | ✔ | (customProp) | filename | `sparkle:version` | (implicit) | ✔ (×2: file+pkg) |
| artifact `url` | ✔ per-file | ✔ per-target | ✔ | ✔ per-line | ✔ enclosure | ✔ per-entry | ✔ MainPackage |
| integrity hash | ✔ sha512 | (in sig) | ✔ sha256 | ✔ sha1 | (in sig) | ✔ md5 rev / SRI | — (MSIX sig) |
| `size` | ✔ | — | — | ✔ | ✔ length | — | — |
| published date | ✔ releaseDate | ✔ pub_date | — | — | ✔ pubDate | — | — |
| signature | ✔ ed25519 | ✔ minisign-ed | ✔ RSA | **none** | ✔ ed25519 | (SRI) | (MSIX sig) |
| release notes | ✔ | ✔ notes | customProp | nuspec | ✔ | — | nuspec |
| **channel** | ✔ file name | target key | ✔ (server) | (feed URL) | ✔ `sparkle:channel` | — | (UpdateUri) |
| **rollout %** | ✔ stagingPercentage | — | ✔ (server) | ✔ `# NN%` | ✔ phasedRollout | — | — |
| **OS gate** | ✔ minimumSystemVersion | — | ✔ (server) | — | ✔ min/maxSystem+hw | — | ProcessorArch |
| **arch gate** | ✔ (filename/packages) | ✔ target | ✔ (server) | — | ✔ hardwareReq | — | ✔ ProcessorArch |
| delta/blockmap | ✔ .blockmap | — | — | ✔ -delta.nupkg | ✔ .delta | — | — |
| min OS to see | ✔ | — | — | — | ✔ minUpdateVersion | — | — |
| multi-target map | files[] | ✔ platforms{} | — | multi-line | multi-item | entries[] | OptionalPackages |

**Intersection (the irreducible core every format has):** `version` + artifact `url` + an
integrity mechanism + a signature/verification + a timestamp (6 of 7; Workbox omits all because
it's not a version manifest). **Platform-specific:** channel, rollout, OS/arch gating, delta —
these are the differentiators and live in different places (manifest vs server) depending on format.

### 8b. Signature-scheme comparison (the thing that blocks naive unification)

| Format | Algorithm | What is signed | Key location | Rotation |
|---|---|---|---|---|
| electron-builder | **Ed25519** | canonical `EBUM1` JSON-subset (manifest fields) | `updateManifestPublicKey` (app-update.yml) | ✔ multi-key `signatures[].keyId` |
| Tauri | **minisign Ed25519** | **artifact bytes** + trusted comment (`…\tversion:…`) | `plugins.updater.pubkey` (tauri.conf.json) / runtime `.pubkey()` | runtime override |
| Capawesome | **RSA** (2048–4096) | bundle (signed SHA-256) | `plugins.LiveUpdate.publicKey` (PEM) | CLI re-issue |
| Squirrel | **none** (SHA-1 only) | — | — | — |
| Sparkle | **EdDSA/ed25519** | archive bytes (+ feed, if signed feed) | `SUPublicEDKey` (Info.plist) | ✔ via new update |
| Workbox | (SRI: SHA-384/512) | asset bytes (opt-in) | inline `integrity` | n/a |
| AppInstaller | (MSIX Authenticode) | the `.msix` | cert in MSIX | cert re-issue |

**Takeaway:** 4 of 7 already use **Ed25519** (or SRI). The two outliers are Capawesome (RSA) and
Squirrel (none). If you standardize your unified manifest on **Ed25519 over a canonical payload**
(electron-builder's `EBUM1` model), every surface can verify it with a small shared verifier, and
you keep **one keypair + one signing step** for all 5 surfaces.

### 8c. WHERE rollout/channel lives (the operational fork)
- **In-manifest** (re-sign per change): electron-builder `stagingPercentage`, Squirrel `# NN%`,
  Sparkle `phasedRolloutInterval`/`channel`.
- **Server-side** (change a number, no re-sign): Capawesome Cloud, App Installer (via which
  `.appinstaller`/MSIX you point `UpdateUri` at).
- For a **one-person team**, server-side wins: your Cloudflare Worker decides channel/rollout
  before returning the manifest, so you never re-sign to change a percentage. Keep the manifest
  itself **immutable + signed**; do all gating in the Worker.

### 8d. THE ANSWER — minimum viable unified manifest

Two layers. **(A) An immutable, signed `release.json` on R2** (one per release), and **(B) a
Cloudflare Worker** that reads the device's target/channel and returns either the release or a
`204`.

**(A) `release.json`** — generalize electron-builder's `EBUM1`-signed manifest to N targets, using
Tauri's `platforms{}` map + Capawesome's minimal per-target payload:
```jsonc
{
  "specVersion": "1.0",                 // bump if you change the canonical payload (like EBUM1->EBUM2)
  "version": "1.4.0",                   // SemVer
  "releaseDate": "2026-11-04T00:00:00Z",
  "notes": "…",
  "signature": "ME…base64 Ed25519…",    // over canonicalize(payload) — single-key (legacy slot)
  "signatures": [                        // multi-key for rotation (copy electron-builder)
    { "keyId": "sha256:abc…", "signature": "ME…" }
  ],
  "targets": {                           // Tauri-style map; one entry per surface you ship
    "electron-win-x64":  { "url": "…/airiz-1.4.0-win-x64.exe",  "sha512": "…", "size": 0,
                           "signature": "ME…over artifact bytes…", "minOs": "10.0.19041" },
    "tauri-win-x64":     { "url": "…/airiz-1.4.0-setup.exe",     "signature": "ME…minisign…" },
    "capacitor-android": { "url": "…/airiz-web-1.4.0.zip",       "sha256": "…",
                           "signature": "ME…RSA…",               "minVersionCode": 42, "abi": ["arm64-v8a"] },
    "capacitor-ios":     { "url": "…/airiz-web-1.4.0.zip",       "sha256": "…",
                           "signature": "ME…RSA…",               "minBundleVersion": 42 },
    "pwa":               { "url": "…/sw.js",                      "revision": "md5…", "integrity": "sha384-…" },
    "worker":            { "url": "…/worker.js",                  "sha512": "…" }
  }
}
```
- **Sign** the canonical subset (version, releaseDate, notes, and each target's url/hash/size/
  signature/minOs) exactly like `EBUM1` — sorted, JSON-quoted, `\n`-joined, version-prefixed
  (`AIRIZM1`). Cosmetics (notes) can stay unsigned if you prefer.
- **Per-target `signature`** lets each native surface verify its own artifact in **its own scheme**
  (Tauri expects minisign-over-bytes; Capawesome expects RSA; electron-updater expects the
  manifest sig) while the **outer `signature`/`signatures`** authenticates the manifest itself.
  This is the key move: **one manifest, N artifact signatures, one manifest signature.**
- If you'd rather force ONE scheme everywhere, drop the per-target `signature` and have every
  surface verify the artifact with the same Ed25519 key (you'd then need a Tauri custom target +
  a Capawesome-compatible verifier). The per-target approach is safer for a v1.

**(B) Worker gating** (server-side, so the manifest never changes for rollout):
- Input: `?channel=stable|beta&target=electron-win-x64&currentVersion=…&osArch=…&versionCode=…`.
- Decide: channel → which release; rollout % (stable-hash of device id, like Squirrel's GUID trick
  or Sparkle's 7-group) → 200 or 204; OS/arch/versionCode gate → 200 or 204.
- Return the matching `release.json` (or the single target slice). **No re-signing to roll out.**

**Minimum fields you literally cannot drop:** `version`, per-target `url`, per-target integrity
hash, per-target signature, `releaseDate`, and the outer manifest `signature`. Everything else
(channel, rollout, OS/arch gate) is movable to the Worker.

### 8e. What this buys / costs
- **Buys:** one signing keypair + one sign step; one R2 object per release; rollout/channel in the
  Worker (no re-sign); a single verifier to audit.
- **Costs / risks:** you must implement per-surface artifact verification (minisign for Tauri, RSA
  for Capawesome, Ed25519 for your own), and you're now responsible for the security that the
  native updaters gave you for free. **electron-builder's `EBUM1` canonicalization + multi-key
  rotation is the single best prior art to copy** (and watch PR #10426 for the `EBUM2` shape).
- **Biggest caveat:** Squirrel (SHA-1, unsigned) and raw PWA have no signature model — if Windows
  or PWA is a trust boundary, prefer **App Installer/MSIX** (Authenticode) and **SRI** (Workbox)
  respectively over Squirrel and a bare SW.

---

## 9. Test fixtures (re-fetchable real samples)

| # | Format | File | Exact URL |
|---|--------|------|-----------|
| F1 | e-builder NSIS `latest.yml` | Joplin 3.7.22 | https://github.com/laurent22/joplin/releases/latest/download/latest.yml |
| F2 | e-builder mac `latest.yml` | Mattermost 6.3.2 | https://github.com/mattermost/desktop/releases/latest/download/latest-mac.yml |
| F3 | e-builder linux `latest.yml` (+`blockMapSize`) | Mattermost 6.3.2 | https://github.com/mattermost/desktop/releases/latest/download/latest-linux.yml |
| F4 | e-builder delta `.blockmap` | Mattermost 6.3.2 | https://github.com/mattermost/desktop/releases/latest/download/mattermost-desktop-6.3.2-mac.zip.blockmap |
| F5 | Sparkle **signed** appcast | Sparkle test cast | https://sparkle-project.org/files/sparkletestcast-signed.xml |
| F6 | Sparkle unsigned appcast | Sparkle test cast | https://sparkle-project.org/files/sparkletestcast.xml |
| F7 | AppInstaller (stable) | Nheko | https://raw.githubusercontent.com/Nheko-Reborn/nheko/main/resources/Nheko.appinstaller |
| F8 | AppInstaller (nightly) | Nheko | https://raw.githubusercontent.com/Nheko-Reborn/nheko/main/resources/NhekoNightly.appinstaller |
| F9 | AppInstaller (rich: UpdateUris/RepairUris/bg-task) | System Informer | https://raw.githubusercontent.com/DavidXanatos/TaskExplorer/master/ProcessHacker/tools/msix/PackageTemplate.appinstaller |
| F10 | Tauri static-JSON contract | docs template | https://tauri.app/plugin/updater/ (see "Static JSON File") |
| F11 | Capawesome device manifest | SDK types | https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts |
| F12 | Squirrel `RELEASES` parser (ground truth) | source | https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs |

Suggested fixture assertions:
- F1–F3: parse as YAML; assert `version`,`files[].url`,`files[].sha512`,`releaseDate` present;
  F3 additionally has `files[].blockMapSize`.
- F5: parse as XML; assert `sparkle:edSignature` on each `enclosure`, `sparkle:version` per item,
  and the trailing `sparkle-signatures` block; verify the feed signature with the Sparkle test key.
- F7/F9: parse as XML in the `appinstaller/2018` & `/2021` namespaces; assert `MainPackage`
  `Name/Publisher/Version/Uri` present; F9 asserts `UpdateUris`/`RepairUris`/`AutomaticBackgroundTask`.
- Tauri/Capawesome: assert the JSON shapes from §2a/§3a; for a generated Tauri bundle, verify the
  `.sig` against the bundle bytes with the test pubkey (and check the `version:` trusted comment).

---

## 10. Source index (permalinks)

**electron-builder** (`electron-userland/electron-builder@master`)
- `UpdateInfo`/`UpdateFileInfo`/`WindowsUpdateInfo` types:
  https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateInfo.ts
- Manifest signing (`EBUM1`, `canonicalizeForSigning`, multi-key verify, `keyId`):
  https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateManifestSignature.ts
- Build-time signer: `…/packages/builder-util/src/updateManifestSigner.ts`
- Parser (`parseUpdateInfo`, `resolveFiles`, YAML-alias DoS guard):
  https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/Provider.ts
- GitHub provider (`tag`, channel file, Atom notes):
  https://github.com/electron-userland/electron-builder/blob/master/packages/electron-updater/src/providers/GitHubProvider.ts
- Key-rotation doc: `…/website/docs/features/key-rotation.md`

**Tauri**
- Updater client (shapes, `verify_signature`, target lookup):
  https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs
- Signer (`sign_file`, trusted comment, base64 `.sig`):
  https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/helpers/updater_signature.rs
- Docs: https://tauri.app/plugin/updater/

**Capawesome**
- SDK types (config + `FetchLatestBundleResult` + `DownloadBundleOptions`):
  https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts
- CLI DTOs (`rolloutPercentage`, `checksum`, `signature`, version-code gates):
  https://github.com/capawesome-team/cli/blob/main/src/types/app-bundle.ts
- Docs: https://capawesome.io/docs/cloud/live-updates/ (how-it-works, code-signing, bundles)

**Squirrel.Windows** (`Squirrel/Squirrel.Windows@develop`)
- `ReleaseEntry` (RELEASES regex, staging, delta, nupkg notes):
  https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs
- nuspec metadata: `…/docs/using/nuget-package-metadata.md` · naming: `…/docs/using/naming.md` ·
  delta: `…/docs/using/delta-packages.md`

**Sparkle**
- Publishing (full appcast schema, edSignature, DSA→EdDSA, signed feeds, channels, phased):
  https://sparkle-project.org/documentation/publishing/
- Signed sample: https://sparkle-project.org/files/sparkletestcast-signed.xml

**Workbox** (`GoogleChrome/workbox@v7`)
- Precaching module doc: https://developer.chrome.com/docs/workbox/modules/workbox-precaching
- Revision hash (MD5): https://github.com/GoogleChrome/workbox/blob/v7/packages/workbox-build/src/lib/get-string-hash.ts
- `__WB_MANIFEST` / cache-key / SRI: `…/packages/workbox-precaching/src/PrecacheController.ts`

**App Installer** (`MicrosoftDocs/winrt-related@main`)
- Root: `…/winrt-related-src/schemas/appinstallerschema/element-s4-appinstaller.md`
- MainPackage: `…/element-s4-mainpackage.md` · UpdateSettings: `…/element-s4-updatesettings.md`
- OnLaunch: `…/element-s4-onlaunch.md` (full element set listed in §7b)

*End of round 1. Diff the §8a matrix to finalize the unified manifest; the §8d schema is the
starting point, not a decision.*
