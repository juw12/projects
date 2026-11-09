# AIRIZ Motor Console — Unified Update Manifest Schema

**Date**: 2026-11-05
**Scope**: Electron (Windows) + Capacitor (Android/iOS) + PWA (Workbox) + Cloudflare Worker
**Goal**: Single signed manifest schema consumed by all 4 surfaces, replacing 4 divergent formats.

---

## Section A: Per-Updater Field Inventory

### A.1 electron-updater (`latest.yml`)

Source: `electron-userland/electron-builder` @ `cdd9f7ec`
File: `packages/builder-util-runtime/src/updateInfo.ts`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `version` | `string` | YES | Semver string |
| `files[]` | `UpdateFileInfo[]` | YES | Array of downloadable files |
| `files[].url` | `string` | YES | Download URL |
| `files[].sha512` | `string` | YES | Base64 SHA-512 checksum |
| `files[].size` | `number?` | no | File size in bytes |
| `files[].blockMapSize` | `number?` | no | Blockmap file size |
| `files[].blockMapUrl` | `string?` | no | Custom blockmap URL |
| `files[].isAdminRightsRequired` | `boolean?` | no | UAC elevation hint |
| `releaseName` | `string?` | no | Human-readable release name |
| `releaseNotes` | `string \| ReleaseNoteInfo[]` | no | Release notes |
| `releaseDate` | `string` | YES | ISO 8601 date |
| `stagingPercentage` | `number?` | no | 0-100 staged rollout |
| `minimumSystemVersion` | `string?` | no | OS version gate |
| `signature` | `string?` | no | Legacy single Ed25519 sig |
| `signatures[].keyId` | `string` | n/a | SHA-256 hex of SPKI DER |
| `signatures[].signature` | `string` | n/a | Base64 Ed25519 signature |
| `packages[arch].path` | `string` | n/a | NSIS 7z payload path |
| `packages[arch].sha512` | `string` | n/a | 7z checksum |
| `packages[arch].size` | `number?` | no | 7z size |
| `allowCatalogSignature` | `boolean?` | no | Windows catalog sig |

**Signature**: Ed25519, canonical wire format `EBUM1`. Signs: version, stagingPercentage, minimumSystemVersion, files[].url+sha512+size+blockMapUrl, packages[].arch+path+sha512+size. Does NOT sign: releaseDate, releaseNotes, releaseName.
**Key rotation**: Multiple `signatures[]` entries, each tagged with `keyId`. Client trusts list of public keys; any key validating any entry = pass.

### A.2 Tauri Updater (`tauri-plugin-updater`)

Source: `tauri-apps/tauri-plugin-updater` @ `3cba6fbf`
File: `src/updater.rs`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `version` | `semver.Version` | YES | Strict semver |
| `notes` | `String?` | no | Release notes |
| `pub_date` | `OffsetDateTime?` | no | ISO 8601 release date |
| `data` | `RemoteReleaseInner` | YES | Dynamic or Static shape |
| `data.url` (dynamic) | `Url` | YES | Download URL |
| `data.signature` (dynamic) | `String` | YES | minisign Base64 |
| `data.platforms` (static) | `HashMap<String, ...>` | YES | Keyed by `{os}-{arch}` |
| `data.platforms[k].url` | `Url` | YES | Per-platform URL |
| `data.platforms[k].signature` | `String` | YES | Per-platform minisign sig |

**Platform key format**: `{os}-{arch}` e.g. `darwin-aarch64`, `windows-x86_64`.
**Installer suffix**: `darwin-aarch64-app`, `windows-x86_64-msi`, `linux-x86_64-appimage`.
**Signature**: Minisign (Ed25519-based). Signs the installer binary. No separate checksum.

### A.3 @capawesome/capacitor-live-update

Source: `capawesome-team/capacitor-plugins` (live-update package)

**DownloadBundleOptions**:
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bundleId` | `string` | YES | Unique identifier (opaque) |
| `url` | `string` | YES | ZIP URL or base URL |
| `artifactType` | `'zip' \| 'manifest'` | no | Default `'zip'` |
| `checksum` | `string?` | no | SHA-256 hex (deprecated) |
| `signature` | `string?` | no | RSA signed SHA-256, Base64 |

**FetchLatestBundleResult**:
| Field | Type | Notes |
|-------|------|-------|
| `bundleId` | `string \| null` | `null` = no update |
| `downloadUrl` | `string?` | URL to download |
| `checksum` | `string?` | SHA-256 (self-hosted) |
| `signature` | `string?` | RSA sig (self-hosted) |
| `channel` | `string?` | Resolved channel |
| `artifactType` | `string?` | `zip` or `manifest` |
| `customProperties` | `object?` | Arbitrary metadata |

**Signature**: RSA (PSS or PKCS#1 v1.5). No version field (uses opaque `bundleId`).

### A.4 Workbox Precache Manifest

Source: `GoogleChrome/workbox` v7, `packages/workbox-precaching/src/_types.ts`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | `string` | YES | URL to precache |
| `revision` | `string \| null?` | no | Cache-busting revision |
| `integrity` | `string?` | no | SRI integrity string |

**Shape**: Flat array. No version, no signature, no date. Relies on HTTPS + SRI.

### A.5 Microsoft AppInstaller (`.appinstaller` XML)

Source: Microsoft Learn, namespace `http://schemas.microsoft.com/appx/appinstaller/2021`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `Version` | `string` (quad) | YES | AppInstaller format version |
| `Uri` | `string?` | no | Self-referencing URI |
| `MainPackage.Name` | `string` | YES | Package identity (3-50 chars) |
| `MainPackage.Publisher` | `string` | YES | X.500 distinguished name |
| `MainPackage.Version` | `string` (quad) | YES | App version |
| `MainPackage.ProcessorArchitecture` | `enum` | YES | x86/x64/arm/arm64/neutral |
| `MainPackage.Uri` | `string` | YES | URI to .msix |
| `UpdateSettings.OnLaunch` | `element` | no | Check on launch |
| `UpdateSettings.OnLaunch.HoursBetweenUpdateChecks` | `int` | no | 0-255, default 24 |
| `UpdateSettings.OnLaunch.ShowPrompt` | `bool` | no | Show UI |
| `UpdateSettings.OnLaunch.UpdateBlocksActivation` | `bool` | no | Block launch |
| `UpdateSettings.AutomaticBackgroundTask` | `element` | no | 8h background check |
| `UpdateSettings.ForceUpdateFromAnyVersion` | `bool` | no | Allow downgrade |

**Signature**: Not in XML. Relies on Authenticode X.509 package signature. No content hash in manifest.

### A.6 Sparkle Appcast (RSS + Sparkle namespace)

Source: `sparkle-project.org/documentation/publishing/`, Sparkle 2.x

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | `string` | YES | Item title |
| `sparkle:version` | `string` | YES | Build number |
| `sparkle:shortVersionString` | `string?` | no | Marketing version |
| `pubDate` | `string` (RFC 2822) | YES | Release date |
| `description` | `string` (CDATA) | no | Release notes (HTML) |
| `enclosure.url` | `string` | YES | Download URL |
| `enclosure.length` | `int` | YES | File size |
| `enclosure.type` | `string` | YES | MIME type |
| `enclosure.sparkle:edSignature` | `string` | YES | Ed25519 sig (Base64) |
| `sparkle:minimumSystemVersion` | `string?` | no | Min macOS version |
| `sparkle:channel` | `string?` | no | Targeted update channel |
| `sparkle:phasenedrolloutDuration` | `int?` | no | Rollout duration (sec) |
| `sparkle:deltas enclosure.*` | `...` | no | Delta update entries |

**Signature**: Ed25519 (EdDSA). Signs the entire archive. No separate checksum.

### A.7 Squirrel.Windows RELEASES

Source: `Squirrel/Squirrel.Windows`, `src/Squirrel/ReleaseEntry.cs`

Format: Plain text, one entry per line: `SHA1 Filename Filesize [# Staging%]`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `SHA1` | `string` (40 hex) | YES | SHA-1 of .nupkg |
| `Filename` | `string` | YES | .nupkg filename or URL |
| `Filesize` | `int64` | YES | Bytes |
| `StagingPercentage` | `float?` | no | From `# NN%` comment |

Version encoded in filename. No date, no notes, no platform, no manifest-level signature.

### A.8 Expo Updates

Source: `expo/expo`, `docs/pages/technical-specs/expo-updates-1.mdx`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | `string` (UUID) | YES | Unique manifest ID |
| `createdAt` | `string` (ISO 8601) | YES | Creation timestamp |
| `runtimeVersion` | `string` | YES | Native compat key |
| `launchAsset` | `Asset` | YES | Entry point bundle |
| `assets[]` | `Asset[]` | YES | Other assets |
| `metadata` | `{[k:string]: string}` | YES | Filterable metadata |
| `extra` | `{[k:string]: any}` | no | Extension data |

**Asset**: `{hash?, key, contentType, fileExtension?, url}`
**Signature**: Code signing via server (RSA cert). Not in manifest. Channel via headers.

---

## Section B: Intersection Analysis

### B.1 Field Presence Matrix

| Field | Electron | Tauri | Capacitor | Workbox | MSIX | Sparkle | Squirrel | Expo | Count |
|-------|:--------:|:-----:|:---------:|:-------:|:----:|:-------:|:--------:|:----:|:-----:|
| **url** | A | A | A | A | A | A | A | A | **8/8** |
| **version** | A | A | - | - | A | A | - | - | **4/8** |
| **checksum** | A | - | A | A | - | - | A | A | **5/8** |
| **size** | A | - | - | - | - | A | A | - | **3/8** |
| **date** | A | A | - | - | - | A | - | A | **4/8** |
| **signature** | A | A | A | - | - | A | - | - | **4/8** |
| **notes** | A | A | - | - | - | A | - | - | **3/8** |
| **platform** | A | A | - | - | A | - | - | - | **3/8** |
| **staging** | A | - | - | - | - | - | A | - | **2/8** |
| **minVersion** | A | - | - | - | - | A | - | - | **2/8** |
| **channel** | - | - | A | - | - | A | - | A | **3/8** |

Legend: A = explicit field, - = absent or encoded differently

### B.2 Tiers by Protocol Count

**Tier 1 — Universal (8/8)**:
- `url` — Every updater needs a download location.

**Tier 2 — Strong consensus (5/8)**:
- `checksum` — Integrity verification. Present in 5 of 8 (Electron SHA-512, Capacitor SHA-256, Workbox SRI, Squirrel SHA-1, Expo SHA-256). The other 3 (Tauri, Sparkle, MSIX) fold integrity into the cryptographic signature.

**Tier 3 — Core (4/8)**:
- `version` — Semantic version. Electron, Tauri, MSIX, Sparkle.
- `date` — Publication timestamp. Electron, Tauri, Sparkle, Expo.
- `signature` — Cryptographic authenticity. Electron, Tauri, Capacitor, Sparkle.

**Tier 4 — Useful (3/8)**:
- `size` — File size. Electron, Sparkle, Squirrel.
- `notes` — Release notes. Electron, Tauri, Sparkle.
- `platform` — Target architecture/OS. Electron, Tauri, MSIX.
- `channel` — Distribution channel. Capacitor, Sparkle, Expo.

**Tier 5 — Niche (2/8)**:
- `staging` — Staged rollout percentage. Electron, Squirrel.
- `minVersion` — Minimum system version gate. Electron, Sparkle.

### B.3 Minimum Viable Subset (MVS)

**Definition**: Fields present in ≥5 protocols OR fields that are functionally irreplaceable.

| Rank | Field | Protocols | Rationale |
|------|-------|-----------|-----------|
| 1 | `url` | 8/8 | Without this, nothing can be downloaded. |
| 2 | `checksum` | 5/8 (+3 folded into sig) | All 8 have integrity; 5 use explicit checksum. |
| 3 | `version` | 4/8 | Required for update comparison. 4 others encode it differently. |
| 4 | `date` | 4/8 | Required for "is this newer?" when version comparison is ambiguous. |
| 5 | `signature` | 4/8 | Required for supply-chain trust. The other 4 achieve this via transport or package signing. |

**MVS = {url, checksum, version, date, signature}** — 5 fields.

These 5 fields are sufficient for:
- **Electron**: Maps directly (files[].url, files[].sha512, version, releaseDate, signature)
- **Tauri**: Maps directly (url, signature covers integrity, version, pub_date)
- **Capacitor**: Maps with adaptation (url, checksum, bundleId→version, signature)
- **PWA/Workbox**: Maps partially (url, integrity→checksum, revision→version)
- **Worker**: Maps directly (url, checksum, version, date, signature)

### B.4 What the MVS Does NOT Cover

- **Platform-specific binaries**: Electron needs per-arch packages; Tauri needs per-OS+arch entries; MSIX needs ProcessorArchitecture. → Solved by a `platforms` sub-object.
- **Delta/binary diff**: Electron blockmap, Sparkle deltas, Squirrel delta nupkg, Capacitor manifest artifactType. → Solved by an optional `deltas` array.
- **Staged rollout**: Electron stagingPercentage, Squirrel #N%. → Solved by optional `rollout` field.
- **Release notes**: Electron, Tauri, Sparkle. → Solved by optional `notes` field.
- **Channel targeting**: Capacitor, Sparkle, Expo. → Solved by optional `channel` field.
- **Minimum system version**: Electron, Sparkle. → Solved by optional `minSystemVersion` per platform.

---

## Section C: Per-Surface Extension Fields

### C.1 Electron Extension

```json
{
  "electron": {
    "files": [
      {
        "url": "string",
        "checksum": { "algorithm": "sha512", "value": "base64..." },
        "size": 84215360,
        "blockMapUrl": "string?",
        "blockMapSize": 12480,
        "isAdminRightsRequired": true
      }
    ],
    "packages": {
      "x64": {
        "path": "AIRIZ-2.4.1-x64.nsis.7z",
        "checksum": { "algorithm": "sha512", "value": "base64..." },
        "size": 52428800,
        "blockMapSize": 8192,
        "isAdminRightsRequired": true
      }
    },
    "minSystemVersion": "10.0.19041",
    "allowCatalogSignature": false
  }
}
```

**Rationale**: Electron’s NSIS web-installer on Windows downloads a separate 7z payload per arch. The `packages` map mirrors `WindowsUpdateInfo.packages`. Blockmap fields support differential downloads.

### C.2 Capacitor Extension

```json
{
  "capacitor": {
    "bundleId": "2.4.1",
    "artifactType": "zip",
    "channel": "production",
    "files": [
      {
        "url": "https://cdn.airiz.example.com/capacitor/2.4.1/bundle.zip",
        "checksum": { "algorithm": "sha256", "value": "base64..." },
        "size": 15728640
      }
    ]
  }
}
```

**Rationale**: Capacitor Live Update identifies bundles by opaque `bundleId` (not semver). `artifactType` determines whether the client downloads a single ZIP or per-file manifest. `channel` maps to Capawesome Cloud channels.

### C.3 PWA / Workbox Extension

```json
{
  "pwa": {
    "entries": [
      {
        "url": "/sw.js",
        "revision": "a3f1c9e2b7d8",
        "integrity": "sha384-dGVXHTs6M0S3..."
      },
      {
        "url": "/index.html",
        "revision": "b4e2d0f3c8e9",
        "integrity": "sha384-eHwYuIv7N1T4..."
      }
    ]
  }
}
```

**Rationale**: Workbox precache is a flat array of `{url, revision, integrity}`. A single PWA update may touch many files. `revision` is the cache-busting token (typically content hash prefix). `integrity` is an SRI string for subresource integrity.

### C.4 Cloudflare Worker Extension

```json
{
  "worker": {
    "workerName": "airiz-motor-console-edge",
    "workerVersion": "2.4.1",
    "files": [
      {
        "url": "https://cdn.airiz.example.com/worker/2.4.1/worker.js",
        "checksum": { "algorithm": "sha256", "value": "base64..." },
        "size": 204800
      }
    ]
  }
}
```

**Rationale**: Workers are pinned by name+version in the binding. `moduleUrl` is optional for ES module workers that reference an external bundle. The Worker "update" is a redeploy, not a client download — the manifest here is consumed by CI/CD, not the client.

### C.5 Cross-Surface Optional Fields

| Field | Type | Notes |
|-------|------|-------|
| `notes` | `string?` | Release notes (Markdown or HTML). Electron, Tauri, Sparkle. |
| `rollout` | `number?` | 0-100 staged rollout percentage. Electron, Squirrel. |
| `minSystemVersion` | `string?` | Per-platform OS version gate. |
| `deltas` | `Delta[]?` | Binary diff entries for efficient updates. |

**`Delta` structure**:
```json
{
  "fromVersion": "2.4.0",
  "platform": "electron",
  "url": "https://cdn.airiz.example.com/electron/delta/2.4.0-2.4.1-x64.blockmap",
  "checksum": { "algorithm": "sha512", "value": "base64..." },
  "size": 524288
}
```

---

## Section D: Draft Unified Manifest Schema (JSON)

### D.1 Full Example

```json
{
  "schemaVersion": "1.0.0",
  "id": "airiz-motor-console",
  "name": "AIRIZ Motor Console",
  "version": "2.4.1",
  "date": "2026-11-05T08:30:00Z",
  "notes": "Fixed gear ratio calibration drift on high-temperature cycles.",
  "channel": "production",
  "rollout": 100,

  "signatures": [
    {
      "keyId": "a3f1c9e2b7d8405612345678abcdef0123456789abcdef0123456789abcdef01",
      "algorithm": "ed25519",
      "value": "dGVzdHNpZ25hdHVyZWVkaTI1MTlwYXlsb2Fk"
    }
  ],

  "platforms": {
    "electron": {
      "files": [
        {
          "url": "https://cdn.airiz.example.com/electron/2.4.1/AIRIZ-Setup-2.4.1-x64.exe",
          "checksum": { "algorithm": "sha512", "value": "M1FyQmV5Q0dUdE9RZk9UdE5mQWZDQmZHVkR0c1pLbFV3aGZ5Tnd3V01tQ3lYVW9BcGpJbG1xWnlvSmlLQQ==" },
          "size": 84215360,
          "blockMapUrl": "https://cdn.airiz.example.com/electron/2.4.1/AIRIZ-Setup-2.4.1-x64.exe.blockmap",
          "blockMapSize": 12480,
          "isAdminRightsRequired": true
        }
      ],
      "packages": {
        "x64": {
          "path": "AIRIZ-2.4.1-x64.nsis.7z",
          "checksum": { "algorithm": "sha512", "value": "Q2xZVW9BcGpJbG1xWnlvSmlLQWZDQmZHVkR0c1pLbFV3aGZ5Tnd3V01tQ3lYVW9BcGpJ" },
          "size": 52428800,
          "blockMapSize": 8192,
          "isAdminRightsRequired": true
        }
      },
      "minSystemVersion": "10.0.19041",
      "allowCatalogSignature": false
    },

    "capacitor": {
      "bundleId": "2.4.1",
      "artifactType": "zip",
      "channel": "production",
      "files": [
        {
          "url": "https://cdn.airiz.example.com/capacitor/2.4.1/bundle.zip",
          "checksum": { "algorithm": "sha256", "value": "M1FyQmV5Q0dUdE9RZk9UdE5mQWZDQmZHVkR0c1pLbFV3aGZ5Tnd3" },
          "size": 15728640
        }
      ]
    },

    "pwa": {
      "entries": [
        {
          "url": "/sw.js",
          "revision": "a3f1c9e2b7d8",
          "integrity": "sha384-dGVXHTs6M0S3Hq9p2dXx7zKw5vN4mP8rYq1Lb3C6E9F0G1H2I3J4K5L6M7N8O9P0"
        },
        {
          "url": "/index.html",
          "revision": "b4e2d0f3c8e9",
          "integrity": "sha384-eHwYuIv7N1T4Ir0q3eYy8aLx6wO5nQ9sZr2Mc4D7F0H1I2J3K4L5M6N7O8P9Q1R2"
        },
        {
          "url": "/assets/main.js",
          "revision": "c5f3e1a4d9f0",
          "integrity": "sha384-fIxZvJw8O2U5Js1r4fZz9bMy7xP6oR0tAs3Nd5E8G1I2J3K4L5M6N7O8P9Q1R2"
        }
      ]
    },

    "worker": {
      "workerName": "airiz-motor-console-edge",
      "workerVersion": "2.4.1",
      "files": [
        {
          "url": "https://cdn.airiz.example.com/worker/2.4.1/worker.js",
          "checksum": { "algorithm": "sha256", "value": "N2JxYXpPb1V6Kt2s5gAa0cNz8yQ7pS1uBv4Oe6F9H0I1J2K3L4M5N6O7P8Q9R0S1" },
          "size": 204800
        }
      ]
    }
  },

  "deltas": [
    {
      "fromVersion": "2.4.0",
      "platform": "electron",
      "url": "https://cdn.airiz.example.com/electron/delta/2.4.0-2.4.1-x64.blockmap",
      "checksum": { "algorithm": "sha512", "value": "R3JuYXw9P3V6Kt2s5gAa0cNz8yQ7pS1uBv4Oe6F9H0I1J2K3L4M5" },
      "size": 524288
    }
  ],

  "metadata": {
    "buildId": "ci-20261105-083012",
    "gitCommit": "f4a8b2c",
    "runtimeVersion": "native-3.1"
  }
}
```

### D.2 Schema Field Reference

| Path | Type | Required | Tier | Description |
|------|------|----------|------|-------------|
| `schemaVersion` | `string` | YES | - | Schema format version for forward compat |
| `id` | `string` | YES | - | Stable app identifier |
| `name` | `string` | YES | - | Human-readable app name |
| `version` | `string` | YES | **MVS** | Semver release version |
| `date` | `string` (ISO 8601) | YES | **MVS** | Publication timestamp |
| `notes` | `string?` | no | 3/8 | Release notes (Markdown or HTML) |
| `channel` | `string?` | no | 3/8 | Distribution channel |
| `rollout` | `number?` | no | 2/8 | Staged rollout % (0-100, default 100) |
| `signatures[]` | `Signature[]` | YES | **MVS** | Cryptographic signatures |
| `signatures[].keyId` | `string` | YES | - | SHA-256 hex of SPKI DER (64 chars) |
| `signatures[].algorithm` | `string` | YES | - | `"ed25519"` (v1) |
| `signatures[].value` | `string` | YES | - | Base64 signature bytes |
| `platforms` | `object` | YES | - | Per-surface platform data |
| `platforms.*.files[]` | `File[]` | YES | **MVS** | Downloadable artifacts |
| `platforms.*.files[].url` | `string` | YES | **MVS** | Download URL |
| `platforms.*.files[].checksum` | `Checksum` | YES | **MVS** | Content integrity |
| `platforms.*.files[].checksum.algorithm` | `string` | YES | - | `"sha256"` or `"sha512"` |
| `platforms.*.files[].checksum.value` | `string` | YES | - | Base64 hash |
| `platforms.*.files[].size` | `number?` | no | 3/8 | File size in bytes |
| `deltas` | `Delta[]?` | no | - | Binary diff entries |
| `deltas[].fromVersion` | `string` | YES | - | Source version for delta |
| `deltas[].platform` | `string` | YES | - | Target platform key |
| `deltas[].url` | `string` | YES | - | Delta download URL |
| `deltas[].checksum` | `Checksum` | YES | - | Delta integrity |
| `deltas[].size` | `number?` | no | - | Delta size in bytes |
| `metadata` | `object` | no | - | Arbitrary extension data |

### D.3 Canonical Signing Payload (AUM1)

The signed payload is a deterministic string constructed from the manifest\u2019s integrity-critical fields. Modeled on electron-builder\u2019s `EBUM1` format:

```
AUM1
version:"2.4.1"
date:"2026-11-05T08:30:00Z"
channel:"production"
rollout:100
platform:"capacitor"
  file:"https://cdn.airiz.example.com/capacitor/2.4.1/bundle.zip"\t"M1FyQmV5..."\t15728640
platform:"electron"
  file:"https://cdn.airiz.example.com/electron/2.4.1/AIRIZ-Setup-2.4.1-x64.exe"\t"M1FyQmV5..."\t84215360\t"https://cdn.airiz.example.com/electron/2.4.1/AIRIZ-Setup-2.4.1-x64.exe.blockmap"
  package:"x64"\t"AIRIZ-2.4.1-x64.nsis.7z"\t"Q2xZVW9..."\t52428800\t8192
platform:"pwa"
  file:"/assets/main.js"\t"sha384-fIxZ..."
  file:"/index.html"\t"sha384-eHwY..."
  file:"/sw.js"\t"sha384-dGVX..."
platform:"worker"
  file:"https://cdn.airiz.example.com/worker/2.4.1/worker.js"\t"N2JxYXp..."\t204800
delta:"electron"\t"2.4.0"\t"https://cdn.airiz.example.com/electron/delta/2.4.0-2.4.1-x64.blockmap"\t"R3JuYXp..."\t524288
```

**Rules**:
- `AUM1` = "AIRIZ Update Manifest v1" (version tag, like `EBUM1` for electron-builder)
- Lines are sorted within each `platform:` block by URL
- Platform blocks are sorted alphabetically by platform key
- Values are JSON-encoded: strings are double-quoted with JSON escaping, numbers are bare, absent fields are empty string
- `notes`, `metadata`, `name`, `id`, `schemaVersion` are NOT signed (cosmetic/operational)
- `signatures` itself is NOT in the payload (self-referential)
- PWA entries use `integrity` value as the checksum column (SRI string)
- File records: `file:"URL"\t"CHECKSUM"\tSIZE[\t"BLOCKMAP_URL"]`
- Package records: `package:"ARCH"\t"PATH"\t"CHECKSUM"\tSIZE\tBLOCKMAP_SIZE`
- Delta records: `delta:"PLATFORM"\t"FROM_VERSION"\t"URL"\t"CHECKSUM"\tSIZE`

### D.4 JSON Schema (Draft-07)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AIRIZ Unified Update Manifest v1",
  "type": "object",
  "required": ["schemaVersion", "id", "name", "version", "date", "signatures", "platforms"],
  "properties": {
    "schemaVersion": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "id": { "type": "string", "minLength": 1 },
    "name": { "type": "string" },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?(\\+[a-zA-Z0-9.]+)?$" },
    "date": { "type": "string", "format": "date-time" },
    "notes": { "type": "string" },
    "channel": { "type": "string" },
    "rollout": { "type": "number", "minimum": 0, "maximum": 100, "default": 100 },
    "signatures": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["keyId", "algorithm", "value"],
        "properties": {
          "keyId": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "algorithm": { "type": "string", "enum": ["ed25519"] },
          "value": { "type": "string", "minLength": 44 }
        }
      }
    },
    "platforms": {
      "type": "object",
      "minProperties": 1,
      "additionalProperties": { "$ref": "#/definitions/platform" }
    },
    "deltas": { "type": "array", "items": { "$ref": "#/definitions/delta" } },
    "metadata": { "type": "object" }
  },
  "definitions": {
    "checksum": {
      "type": "object",
      "required": ["algorithm", "value"],
      "properties": {
        "algorithm": { "type": "string", "enum": ["sha256", "sha512"] },
        "value": { "type": "string", "minLength": 1 }
      }
    },
    "file": {
      "type": "object",
      "required": ["url", "checksum"],
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "checksum": { "$ref": "#/definitions/checksum" },
        "size": { "type": "integer", "minimum": 0 },
        "blockMapUrl": { "type": "string", "format": "uri" },
        "blockMapSize": { "type": "integer", "minimum": 0 },
        "revision": { "type": "string" },
        "integrity": { "type": "string" },
        "isAdminRightsRequired": { "type": "boolean" }
      }
    },
    "platform": {
      "type": "object",
      "properties": {
        "files": { "type": "array", "items": { "$ref": "#/definitions/file" } },
        "packages": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "required": ["path", "checksum"],
            "properties": {
              "path": { "type": "string" },
              "checksum": { "$ref": "#/definitions/checksum" },
              "size": { "type": "integer" },
              "blockMapSize": { "type": "integer" },
              "isAdminRightsRequired": { "type": "boolean" }
            }
          }
        },
        "bundleId": { "type": "string" },
        "artifactType": { "type": "string", "enum": ["zip", "manifest"] },
        "entries": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["url", "revision"],
            "properties": {
              "url": { "type": "string" },
              "revision": { "type": "string" },
              "integrity": { "type": "string" }
            }
          }
        },
        "workerName": { "type": "string" },
        "workerVersion": { "type": "string" },
        "minSystemVersion": { "type": "string" },
        "allowCatalogSignature": { "type": "boolean" },
        "channel": { "type": "string" }
      }
    },
    "delta": {
      "type": "object",
      "required": ["fromVersion", "platform", "url", "checksum"],
      "properties": {
        "fromVersion": { "type": "string" },
        "platform": { "type": "string" },
        "url": { "type": "string", "format": "uri" },
        "checksum": { "$ref": "#/definitions/checksum" },
        "size": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

---

## Section E: Signature Scheme

### E.1 Algorithm Choice: Ed25519

| Criterion | Ed25519 | RSA-4096 | ECDSA P-256 |
|-----------|---------|----------|-------------|
| Signature size | 64 bytes | 512 bytes | 64-72 bytes |
| Verification speed | ~1 microsecond | ~100 microseconds | ~5 microseconds |
| Signing speed | ~750 microseconds | ~20 ms | ~50 microseconds |
| Public key size | 32 bytes | 512 bytes | 65 bytes |
| Constant-time | YES | marginal | marginal |
| WebCrypto support | YES (PWA + Worker) | YES | YES |
| Node crypto (Electron) | YES | YES | YES |
| iOS SecCrypto (Capacitor) | YES | YES | YES |
| **Adopted by** | **Electron-builder, Tauri, Sparkle 2** | Capacitor, MSIX | Apple |

**Decision**: Ed25519. It is the de facto standard across 3 of the 8 surveyed updaters (Electron, Tauri, Sparkle). Natively supported in WebCrypto for PWA and Worker surfaces. 32-byte public key fits comfortably in a manifest.

**Note on Tauri\u2019s minisign**: Minisign is a file-signing *tool* built on Ed25519. The underlying signature algorithm is identical. A unified Ed25519 scheme is compatible with minisign-generated signatures if the payload format matches.

### E.2 What Gets Signed

**Signed (integrity-critical)**:
- `version` \u2014 prevents version downgrade/substitution
- `date` \u2014 prevents backdating a malicious release
- `channel` \u2014 prevents channel switching
- `rollout` \u2014 prevents tampering with staged-rollout gating
- `platforms.*.files[].url` \u2014 pins the download location
- `platforms.*.files[].checksum` \u2014 pins the content hash
- `platforms.*.files[].size` \u2014 pins the expected size
- `platforms.*.files[].blockMapUrl` \u2014 pins the delta source
- `platforms.*.packages[arch].*` \u2014 pins the NSIS payload
- `platforms.pwa.entries[].url` + `integrity` \u2014 pins the precache manifest
- `deltas[].*` \u2014 pins delta artifacts

**NOT signed (cosmetic/operational)**:
- `name`, `id` \u2014 cosmetic identifiers
- `notes` \u2014 can be edited post-signing (typo fix, localization)
- `metadata` \u2014 arbitrary extension data
- `schemaVersion` \u2014 schema evolution tag
- `signatures` \u2014 self-referential

### E.3 Key Rotation

Modeled on electron-builder\u2019s dual-signing approach (source: `updateManifestSignature.ts`).

**Mechanism**:
1. `signatures[].keyId` = SHA-256 hex of the SPKI DER encoding of the Ed25519 public key
2. Each client ships with a **trust list** of accepted `keyId` values (embedded in the app binary)
3. During rotation, the publisher signs the manifest with **both** old and new keys
4. The manifest carries a `signatures[]` array with one entry per key
5. A client accepts the manifest if **any** trusted key validates **any** signature entry

**Rotation protocol**:
```
Phase 1 (dual-sign, ~2 release cycles):
  Manifest signed with [key-A, key-B]
  Old clients trust: [key-A]         \u2190 verify key-A only, PASS
  New clients trust: [key-A, key-B]  \u2190 verify either, PASS

Phase 2 (cutover, next release):
  Manifest signed with [key-B] only
  Old clients: FAIL (key-A no longer signs) \u2192 must update
  New clients: PASS (key-B in trust list)

Phase 3 (cleanup, release after):
  Remove key-A from trust list in next app release
  Manifest still signed with [key-B] only
```

**Key ID computation**:
```typescript
import { createHash, createPublicKey } from 'crypto';

function computeKeyId(publicKeyPem: string): string {
  const key = createPublicKey({ key: publicKeyPem, format: 'pem' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Not Ed25519');
  const spkiDer = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spkiDer).digest('hex');
}
// Result: 64 lowercase hex chars
```

### E.4 Key Distribution Per Surface

| Surface | Trust anchor location | Rotation mechanism |
|---------|----------------------|--------------------|
| Electron | `app-update.yml` \u2192 `updateManifestPublicKey` (PEM/Base64 SPKI), compiled into asar | Ship new trust list in app update |
| Capacitor | `capacitor.config.json` \u2192 `plugins.LiveUpdate.publicKey`, compiled into native binary | Ship new trust list in app update |
| PWA | Hardcoded in Service Worker source, or fetched from pinned bootstrap URL with SRI | SW update replaces key |
| Worker | `wrangler.toml` \u2192 `vars.TRUSTED_KEY_IDS`, or hardcoded in module | Redeploy Worker with new keys |

**Bootstrap problem**: How does the client get the trusted public key the first time?
- **Electron/Capacitor**: Key is compiled into the app binary. No bootstrap problem.
- **PWA**: The initial `sw.js` is served over HTTPS with SRI. The SW contains the Ed25519 public key. Subsequent updates are verified against it.
- **Worker**: The Worker module is deployed by the owner. The key is a `var` in the Worker code.

### E.5 Signature Verification Pseudocode (WebCrypto)

```typescript
// Shared across all surfaces (WebCrypto-compatible)
async function verifyManifest(
  manifest: UnifiedManifest,
  trustedKeyIds: string[],
  publicKeys: Map<string, CryptoKey>
): Promise<{ valid: boolean; verifiedKeyId?: string; reason?: string }> {
  // 1. Structural validation (before crypto)
  const shapeError = validateShape(manifest);
  if (shapeError) return { valid: false, reason: shapeError };

  // 2. Build canonical payload (AUM1 format)
  const payload = canonicalizeAUM1(manifest);

  // 3. Collect all signatures
  const candidates = (manifest.signatures ?? []).filter(
    s => s?.value?.length > 0
  );
  if (candidates.length === 0) return { valid: false, reason: 'no signatures' };

  // 4. Try each trusted key against each signature
  for (const [keyId, key] of publicKeys) {
    if (!trustedKeyIds.includes(keyId)) continue;

    // Prefer signatures tagged with this keyId
    const tagged = candidates.filter(s => s.keyId === keyId);
    const untagged = candidates.filter(s => !s.keyId);

    for (const sig of [...tagged, ...untagged]) {
      try {
        const sigBytes = base64Decode(sig.value);
        const ok = await crypto.subtle.verify(
          { name: 'Ed25519' },
          key,
          sigBytes,
          new TextEncoder().encode(payload)
        );
        if (ok) return { valid: true, verifiedKeyId: keyId };
      } catch {
        // Invalid signature format - skip, try next
      }
    }
  }

  return { valid: false, reason: 'no trusted key matched' };
}

function canonicalizeAUM1(m: UnifiedManifest): string {
  const lines: string[] = ['AUM1'];
  lines.push(`version:${jsonEncode(m.version)}`);
  lines.push(`date:${jsonEncode(m.date)}`);
  if (m.channel) lines.push(`channel:${jsonEncode(m.channel)}`);
  if (m.rollout != null) lines.push(`rollout:${m.rollout}`);

  // Platform blocks, sorted by key
  for (const platformKey of Object.keys(m.platforms).sort()) {
    lines.push(`platform:"${platformKey}"`);
    const p = m.platforms[platformKey];

    // Files sorted by URL
    if (p.files) {
      for (const f of [...p.files].sort((a, b) => a.url.localeCompare(b.url))) {
        let record = `  file:${jsonEncode(f.url)}\t${jsonEncode(f.checksum.value)}`;
        if (f.size != null) record += `\t${f.size}`;
        if (f.blockMapUrl) record += `\t${jsonEncode(f.blockMapUrl)}`;
        lines.push(record);
      }
    }

    // Packages sorted by arch key
    if (p.packages) {
      for (const arch of Object.keys(p.packages).sort()) {
        const pkg = p.packages[arch];
        let record = `  package:${jsonEncode(arch)}\t${jsonEncode(pkg.path)}\t${jsonEncode(pkg.checksum.value)}`;
        if (pkg.size != null) record += `\t${pkg.size}`;
        if (pkg.blockMapSize != null) record += `\t${pkg.blockMapSize}`;
        lines.push(record);
      }
    }

    // PWA entries sorted by URL
    if (p.entries) {
      for (const e of [...p.entries].sort((a, b) => a.url.localeCompare(b.url))) {
        const integrity = e.integrity ?? '';
        lines.push(`  file:${jsonEncode(e.url)}\t${jsonEncode(integrity)}`);
      }
    }
  }

  // Deltas sorted by platform + fromVersion
  if (m.deltas) {
    for (const d of [...m.deltas].sort((a, b) =>
      (a.platform + a.fromVersion).localeCompare(b.platform + b.fromVersion)
    )) {
      let record = `delta:${jsonEncode(d.platform)}\t${jsonEncode(d.fromVersion)}\t${jsonEncode(d.url)}\t${jsonEncode(d.checksum.value)}`;
      if (d.size != null) record += `\t${d.size}`;
      lines.push(record);
    }
  }

  return lines.join('\n');
}

function jsonEncode(value: unknown): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value);
}
```

---

## Section F: Client-Side Update Flow Pseudocode

### F.1 Electron (Windows)

```typescript
// Electron main process
import { app, dialog, shell } from 'electron';
import { createHash } from 'crypto';
import { verifyManifest, canonicalizeAUM1 } from './unified-updater';

const TRUSTED_KEY_IDS = ['a3f1c9e2...']; // compiled into asar
const PUBLIC_KEYS = new Map([
  ['a3f1c9e2...', await loadEd25519Key(PEM_KEY_A)],
]);

async function checkForUpdates() {
  // 1. Fetch manifest
  const res = await fetch('https://cdn.airiz.example.com/manifest.json');
  if (!res.ok) return;
  const manifest = await res.json();

  // 2. Verify signature
  const result = await verifyManifest(manifest, TRUSTED_KEY_IDS, PUBLIC_KEYS);
  if (!result.valid) {
    console.error('Manifest verification failed:', result.reason);
    return;
  }

  // 3. Version comparison
  if (compareSemver(manifest.version, app.getVersion()) <= 0) return;

  // 4. Rollout check
  if (manifest.rollout != null && manifest.rollout < 100) {
    const bucket = stableHashPercent(getMachineGUID());
    if (bucket >= manifest.rollout) return;
  }

  // 5. Min system version
  const osVer = process.getSystemVersion(); // "10.0.22631"
  const minVer = manifest.platforms.electron?.minSystemVersion;
  if (minVer && compareOsVersion(osVer, minVer) < 0) {
    dialog.showErrorBox('Update unavailable', `Windows ${minVer}+ required.`);
    return;
  }

  // 6. Find file for current arch
  const arch = process.arch; // 'x64' | 'arm64'
  const file = manifest.platforms.electron?.files?.find(
    f => f.url.includes(`-${arch}.`)
  );
  if (!file) return;

  // 7. Download + verify
  const buf = Buffer.from(await (await fetch(file.url)).arrayBuffer());
  if (file.size && buf.length !== file.size) throw new Error('Size mismatch');
  const algo = file.checksum.algorithm;
  const hash = createHash(algo).update(buf).digest('base64');
  if (hash !== file.checksum.value) throw new Error('Checksum mismatch');

  // 8. Install
  const tmp = await saveTemp(buf, 'AIRIZ-Setup.exe');
  shell.executePath(tmp, ['--updated', '--silent']);
  app.quit();
}
```

### F.2 Capacitor (Android/iOS)

```typescript
// Capacitor JS layer
import { Capacitor } from '@capacitor/core';
import { LiveUpdate } from '@capawesome/capacitor-live-update';
import { verifyManifest } from './unified-updater';

const TRUSTED_KEY_IDS = ['a3f1c9e2...']; // in native config

async function checkForUpdates() {
  // 1. Fetch manifest
  const res = await fetch('https://cdn.airiz.example.com/manifest.json');
  const manifest = await res.json();

  // 2. Verify signature
  const result = await verifyManifest(manifest, TRUSTED_KEY_IDS, PUBLIC_KEYS);
  if (!result.valid) return;

  // 3. Get current bundle info
  const current = await LiveUpdate.getCurrentBundle();
  if (manifest.platforms.capacitor?.bundleId === current?.bundleId) return;

  // 4. Rollout check
  if (manifest.rollout != null && manifest.rollout < 100) {
    const bucket = stableHashPercent(await LiveUpdate.getDeviceId());
    if (bucket >= manifest.rollout) return;
  }

  // 5. Download bundle
  const cap = manifest.platforms.capacitor;
  const file = cap?.files?.[0];
  if (!file) return;

  await LiveUpdate.downloadBundle({
    bundleId: cap.bundleId,
    url: file.url,
    artifactType: cap.artifactType ?? 'zip',
    // checksum + signature passed via headers for self-hosted
  });

  // 6. Set as next bundle (applied on next app restart)
  await LiveUpdate.setNextBundle({ bundleId: cap.bundleId });

  // 7. Optional: prompt user to restart
  const choice = await Alert.prompt('Update ready. Restart now?');
  if (choice) {
    await LiveUpdate.reload();
  }
}
```

### F.3 PWA (Workbox Service Worker)

```typescript
// Service Worker (sw.ts)
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { verifyManifest } from './unified-updater';

const TRUSTED_KEY_IDS = ['a3f1c9e2...'];
const PUBLIC_KEYS = new Map([
  ['a3f1c9e2...', await importEd25519Key(SPKI_BASE64)],
]);

// At install time:
self.addEventListener('install', async (event) => {
  event.waitUntil(async () => {
    try {
      // 1. Fetch manifest
      const res = await fetch('/manifest.json');
      const manifest = await res.json();

      // 2. Verify signature
      const result = await verifyManifest(manifest, TRUSTED_KEY_IDS, PUBLIC_KEYS);
      if (!result.valid) {
        console.warn('Manifest unverified - using embedded precache');
        return;
      }

      // 3. Check version
      const cached = await self.registration.storage?.get('installedVersion');
      if (compareSemver(manifest.version, cached ?? '0.0.0') <= 0) return;

      // 4. Extract PWA entries
      const pwa = manifest.platforms.pwa;
      if (!pwa?.entries) return;

      // 5. Precache with Workbox
      precacheAndRoute(
        pwa.entries.map(e => ({
          url: e.url,
          revision: e.revision,
          integrity: e.integrity,
        })),
        { cleanupOutdatedCaches: true }
      );

      // 6. Store installed version
      const db = await idb.open('airiz-pwa', 1);
      await db.put('meta', manifest.version, 'installedVersion');

    } catch (err) {
      // Fall back to embedded precache (build-time)
      console.error('Update check failed, using embedded:', err);
    }
  });
});

// Periodic check (every 6h while SW is active):
setInterval(async () => {
  try {
    const res = await fetch('/manifest.json', { cache: 'no-store' });
    const manifest = await res.json();
    const result = await verifyManifest(manifest, TRUSTED_KEY_IDS, PUBLIC_KEYS);
    if (!result.valid) return;

    const cached = await self.registration.storage?.get('installedVersion');
    if (compareSemver(manifest.version, cached ?? '0.0.0') > 0) {
      // Trigger re-install with new precache
      self.registration.update();
    }
  } catch {}
}, 6 * 3600 * 1000);
```

### F.4 Cloudflare Worker (CI/CD side)

```typescript
// This runs in the CI/CD pipeline, NOT in the Worker itself.
// The Worker "update" is a redeploy, so the manifest is consumed by
// the deployment tooling, not by the Worker at runtime.

import { verifyManifest, canonicalizeAUM1 } from './unified-updater';
import { createHash } from 'crypto';

const TRUSTED_KEY_IDS = ['a3f1c9e2...'];

async function deployWorkerFromManifest(manifestUrl: string) {
  // 1. Fetch + verify manifest
  const res = await fetch(manifestUrl);
  const manifest = await res.json();
  const result = await verifyManifest(manifest, TRUSTED_KEY_IDS, PUBLIC_KEYS);
  if (!result.valid) {
    throw new Error(`Worker deploy aborted: ${result.reason}`);
  }

  // 2. Extract Worker-specific section
  const worker = manifest.platforms.worker;
  if (!worker) throw new Error('No worker section in manifest');

  // 3. Download Worker bundle
  const file = worker.files[0];
  const buf = Buffer.from(await (await fetch(file.url)).arrayBuffer());

  // 4. Verify checksum
  const hash = createHash(file.checksum.algorithm).update(buf).digest('base64');
  if (hash !== file.checksum.value) {
    throw new Error('Worker bundle checksum mismatch');
  }

  // 5. Deploy via wrangler
  const { execSync } = await import('child_process');
  execSync(`npx wrangler deploy --name ${worker.workerName} --entry worker-bundle.js`, {
    env: { ...process.env, WRANGLER_VERSION: worker.workerVersion }
  });

  console.log(`Deployed worker ${worker.workerName} v${worker.workerVersion}`);
}
```

---

## Section G: Open Questions for AIRIZ Owner

1. **Versioning strategy**: The unified schema uses semver (`2.4.1`). Does AIRIZ Motor Console already follow semver across all 4 surfaces? The Worker uses a different versioning (deployment ID), and Capacitor uses an opaque `bundleId`. Do we enforce semver as the single version, or allow per-surface version aliases in `metadata`?

2. **Worker update semantics**: The Worker is not a "client download" \u2014 it is a server-side redeploy. Should the Worker section in the manifest be consumed by CI/CD (as designed above), or does the Worker itself need to self-update at runtime (e.g., by fetching a new module bundle)? This fundamentally changes the trust model.

3. **PWA update granularity**: Workbox precache is per-file. A single manifest version (`2.4.1`) may produce 50 different file revisions. Should each PWA entry have its own micro-version, or is the top-level `version` sufficient with `revision` as the per-file cache-buster?

4. **Delta update scope**: The `deltas[]` array currently only supports Electron blockmap-style deltas. Do we need Sparkle-style binary deltas (per-OS) or Capacitor manifest-style per-file deltas? If yes, the `Delta` structure needs a `deltaType` field (`blockmap` | `binary` | `file-list`).

5. **Staged rollout mechanism**: Electron and Squirrel use percentage-based rollout (`stagingPercentage`, `# N%`). Sparkle uses time-based (`phasenedrolloutDuration`). The unified schema uses `rollout` (percentage). Should we also support time-based phased rollout for PWA/Worker where percentage gating is less natural?

6. **Channel model**: Capacitor has named channels (production, beta, alpha). Sparkle has `sparkle:channel`. Expo uses channel headers. The unified schema has a single `channel` string. Do we need a hierarchy (e.g., `production` > `production-eu` > `production-eu-de`) or is a flat string sufficient?

7. **Key rotation ownership**: Who owns the Ed25519 key pair? Is it a CI secret (GitHub Actions / Azure DevOps variable), a hardware security module (HSM/YubiKey), or a cloud KMS? The rotation protocol (Section E.3) assumes the publisher can sign with both old and new keys simultaneously. Does the CI pipeline support this?

8. **Offline / air-gapped deployment**: Motor consoles may operate in factory environments with restricted network access. Does the unified manifest need to support local file-based updates (e.g., USB drive with a signed `manifest.json` + artifacts)? If so, the `url` fields need to support `file://` or relative paths.

9. **Backward compatibility**: When the schema evolves from v1 to v2, how do older clients handle unknown fields? The `schemaVersion` field enables version checking, but the policy (ignore unknown fields vs. reject) needs to be defined. Electron-builder uses additive evolution (new optional fields). Should we adopt the same approach?

10. **Audit and compliance**: Motor consoles are industrial equipment. Do the update logs need to be tamper-evident (e.g., each update appends a signed hash to a local ledger)? This would add a `previousManifestHash` field to create a hash chain of all applied updates.

---

## Section H: Citations and Spec Versions

### H.1 Primary Sources

| # | Updater | Source | Commit/Version | Key File |
|---|---------|--------|----------------|----------|
| 1 | electron-updater | [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) | `cdd9f7ec` (master) | [`updateInfo.ts`](https://github.com/electron-userland/electron-builder/blob/cdd9f7ec/packages/builder-util-runtime/src/updateInfo.ts), [`updateManifestSignature.ts`](https://github.com/electron-userland/electron-builder/blob/cdd9f7ec/packages/builder-util-runtime/src/updateManifestSignature.ts) |
| 2 | Tauri updater | [tauri-apps/tauri-plugin-updater](https://github.com/tauri-apps/tauri-plugin-updater) | `3cba6fbf` (v2) | [`updater.rs`](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbf/src/updater.rs) |
| 3 | Capacitor Live Update | [capawesome-team/capacitor-plugins](https://github.com/capawesome-team/capacitor-plugins) | v8.4.0 | [`definitions.ts`](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts) |
| 4 | Workbox precache | [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) | v7 | [`_types.ts`](https://github.com/GoogleChrome/workbox/blob/v7/packages/workbox-precaching/src/_types.ts) |
| 5 | MSIX AppInstaller | [Microsoft Learn](https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file) | Schema 2021 | [AppInstaller XML Schema](https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root) |
| 6 | Sparkle appcast | [sparkle-project.org](https://sparkle-project.org/documentation/publishing/) | Sparkle 2.10 | [Publishing docs](https://sparkle-project.org/documentation/publishing/), [Delta updates](https://github.com/sparkle-project/sparkle-project.github.io/blob/master/documentation/delta-updates/index.md) |
| 7 | Squirrel.Windows | [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows) | master | [`ReleaseEntry.cs`](https://github.com/Squirrel/Squirrel.Windows/blob/master/src/Squirrel/ReleaseEntry.cs) |
| 8 | Expo Updates | [expo/expo](https://github.com/expo/expo) | main | [`expo-updates-1.mdx`](https://github.com/expo/expo/blob/main/docs/pages/technical-specs/expo-updates-1.mdx) |

### H.2 Specification References

| Spec | Version | Relevance |
|------|---------|-----------|
| Ed25519 (RFC 8032) | 2017 | Signature algorithm for unified manifest |
| SRI (W3C) | Level 3 | PWA integrity field format |
| Semver 2.0.0 | 2013 | Version field format |
| ISO 8601 | 2019 | Date field format |
| JSON Schema Draft-07 | 2017 | Schema validation format |
| MSIX AppInstaller Schema 2021 | 2021 | Windows native update reference |
| Sparkle 2.x Appcast Format | 2.10 | macOS update reference (Ed25519 signing) |
| Expo Updates Protocol v1 | 2024 | Mobile JS bundle update reference |
| electron-builder EBUM1 | 2025 | Canonical signing format reference |
| Workbox v7 Precache API | 2024 | PWA service worker precache reference |

### H.3 Cross-Reference: Signature Algorithm Adoption

| Updater | Algorithm | Key Type | Signs |
|---------|-----------|----------|-------|
| electron-updater | Ed25519 | Raw (SPKI) | Canonical manifest payload |
| Tauri | Ed25519 (minisign) | Minisign keypair | Installer binary file |
| Capacitor | RSA (PSS/PKCS#1) | X.509 cert | SHA-256 hash of bundle |
| Workbox | None (SRI) | - | - (HTTPS + SRI) |
| MSIX | Authenticode | X.509 cert | .msix package |
| Sparkle 2 | Ed25519 (EdDSA) | Raw | Archive file |
| Squirrel | NuGet signature | X.509 cert | .nupkg package |
| Expo | RSA code signing | X.509 cert | Server response |

**Trend**: Ed25519 is converging as the standard for manifest-level signing. The unified schema follows this trend.

---

*End of document. Total sections: A\u2013H.*
