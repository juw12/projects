# AIRIZ Motor Console — Unified Release Manifest: Protocol Specifications

> Target: Minimum viable intersection of 7 manifest-producing systems.
> Status: Exhaustive reference for unified-manifest schema design.
> Date: 2026-11-05

---

## 1. electron-builder NSIS Auto-Update (`latest.yml`)

**Spec version:** electron-builder v27+ (modern `files[]` format, default since v27)
**Primary source:** https://www.electron.build/docs/features/auto-update
**Type definition source:** https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateInfo.ts

### 1.1 Schema (YAML — `latest.yml` / `latest-mac.yml` / `latest-linux.yml`)

```yaml
# --- Required ---
version: string            # SemVer, e.g. "3.6.10"
releaseDate: string        # ISO 8601 datetime, e.g. "2026-10-30T08:14:00.000Z"
files:                     # Array of download descriptors (REQUIRES >= 1 entry)
  - url: string            # Relative to feed URL, or absolute
    sha512: string         # Base64-encoded SHA-512 of the file (NOT hex)
    size: integer          # File size in bytes

# --- Optional ---
releaseName: string | null
releaseNotes: string | ReleaseNoteInfo[] | null
stagingPercentage: number  # 0-100, staged rollout percentage
minimumSystemVersion: string  # e.g. "macOS 23.1.0", "Windows 10.0.22631"

# --- Per-file optional (inside files[]) ---
  # blockMapSize: integer
  # blockMapUrl: string
  # isAdminRightsRequired: boolean

# --- Windows NSIS web installer only ---
packages:
  x64:
    size: integer
    sha512: string
    blockMapSize: integer
    path: string
  ia32:
    size: integer
    sha512: string
    blockMapSize: integer
    path: string

# --- Signing (v27+) ---
signature: string          # Base64 Ed25519 signature (first key, legacy single-field)
signatures:                # Array - one entry per signing key
  - keyId: string          # Hex SHA-256 of the key SPKI DER (lowercase)
    signature: string      # Base64 Ed25519 signature

# --- Legacy (electron-updater 1.x-2.15, deprecated) ---
# path: string
# sha512: string
# sha2: string
```

**Field reference (from `UpdateInfo` TypeScript interface):**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `version` | `string` | YES | SemVer |
| `files` | `UpdateFileInfo[]` | YES | >=1 entry |
| `files[].url` | `string` | YES | Resolved against feed URL |
| `files[].sha512` | `string` | YES | Base64-encoded SHA-512 |
| `files[].size` | `number` | YES | Bytes |
| `files[].blockMapSize` | `number` | NO | For differential updates |
| `files[].blockMapUrl` | `string` | NO | Custom blockmap location |
| `releaseDate` | `string` | YES | ISO 8601 |
| `releaseName` | `string\|null` | NO | |
| `releaseNotes` | `string\|ReleaseNoteInfo[]\|null` | NO | |
| `stagingPercentage` | `number` | NO | 0-100 |
| `minimumSystemVersion` | `string` | NO | |
| `signature` | `string` | NO (v27) | Base64 Ed25519, first key |
| `signatures` | `UpdateManifestSignature[]` | NO (v27) | Multi-key support |
| `packages` | `Record<arch, PackageFileInfo>` | NO | Windows web installer only |
| `path` | `string` | NO (deprecated) | Legacy <=2.15 |
| `sha512` (top) | `string` | NO (deprecated) | Legacy <=2.15 |

### 1.2 Real-World Example

**Source:** https://github.com/electron-userland/electron-builder/issues/8794

```yaml
# latest.yml (NSIS, v27+ format)
version: 1.0.4
files:
  - url: electron-quick-start-typescript-Setup-1.0.4.exe
    sha512: Khz7sieUavOJpdrfJhlU2GuxLserSmPSb3ead/09+KTdVWMfrEwP6lHKu4qGZaOHoStdjNjGKJmhcJLs1ZfglQ==
    size: 134434016
    isAdminRightsRequired: true
releaseDate: '2025-01-23T02:34:10.488Z'
```

**Windows NSIS web installer variant (with per-arch `packages`):**

```yaml
version: 1.0.4
files:
  - url: electron-quick-start-typescript-Web-Setup-1.0.4.exe
    sha512: GodiKxm6tPnq54Oo7GUd2YkbKl4LXUrcOwBKqHYcsC1eJIf1EhqUGeJR2kaBSWuSA8eV4UK3gDPwstglD1TuOg==
    path: electron-quick-start-typescript-Web-Setup-1.0.4.exe
packages:
  ia32:
    size: 65338747
    sha512: SgJ7McZ5NGJuIf/tH8o+wche87r9H1E/m0FdfMcPwKXT3ihhnd1H2peLf3lv/64Df3RdfHC3dJQGJEvAZE0K8A==
    blockMapSize: 61804
    path: electron-quick-start-typescript-1.0.4-ia32.nsis.7z
  x64:
    size: 68708419
    sha512: EcuIKf6qcxGMRUQ6QyGukJ4MKpSFbgLWVouPH8oFLWqfpADIqiRT2656sxHuJMS8ALCLkvlMcCAqCHwMPOPUwA==
    blockMapSize: 66613
    path: electron-quick-start-typescript-1.0.4-x64.nsis.7z
isAdminRightsRequired: true
releaseDate: '2025-01-23T02:34:10.488Z'
```

**macOS variant (`latest-mac.yml`):**

```yaml
version: 0.1.5
files:
  - url: AuroraRSSReader-Mac-0.1.5.dmg
    sha512: 8a3f2c1e...
    size: 89234567
  - url: AuroraRSSReader-Mac-0.1.5.zip
    sha512: 7b2d1a9c...
    size: 45123456
releaseDate: '2026-01-27T10:30:00.000Z'
```

### 1.3 Signing Scheme

**As of v27 (2025):** Two independent signing layers:

| Layer | Algorithm | What it signs | When |
|-------|-----------|---------------|------|
| **Manifest signing** (NEW v27) | **Ed25519** | The `latest*.yml` file (canonical payload) | Publish time |
| **Artifact code signing** | **Authenticode** (RSA-2048/SHA-256) | The `.exe`/`.app`/`.dmg` | Build time |

**Manifest signing (Ed25519, v27+):**
- Key generation: `npx electron-builder create-update-key`
- Key format: Ed25519 (RFC 8032), PKCS#8 PEM
- `keyId` = lowercase hex SHA-256 of the public key SPKI DER
- Public key embedded in `app-update.yml` as `updateManifestPublicKey`
- electron-updater verifies manifest signature BEFORE any download
- Multi-signature supports key rotation (dual-signing)
- **Signing is REQUIRED in v27**: build fails without a key unless `updateManifest: false`

**Artifact code signing (pre-existing):**
- Windows: Authenticode via `signtool` (RSA or ECDSA, SHA-256)
- macOS: Developer ID + notarization
- `win.verifyUpdateCodeSignature` (default `true`) checks downloaded installer

**Transport endpoint:** Configured via `publish` section. The app's `app-update.yml` (generated at build) contains provider + URL.

**Sources:**
- https://www.electron.build/docs/features/auto-update
- https://www.electron.build/docs/features/security
- https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/signed-update-manifests.md

---

## 2. @tauri-apps/updater (Tauri 2.x)

**Spec version:** Tauri 2.x, updater plugin (as of 2.13.x, Oct 2026)
**Primary source:** https://v2.tauri.app/plugin/updater/
**Source code:** https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs

### 2.1 Schema (JSON — `latest.json` or `update.json`)

**Filename convention:** The updater fetches from URLs in `endpoints`. Conventional static filename is `latest.json` (GitHub Release asset). ONE JSON file contains ALL platforms.

```json
{
  "version": "string",          // REQUIRED. SemVer (with or without leading "v")
  "notes": "string",            // OPTIONAL. Release notes
  "pub_date": "string",         // OPTIONAL. RFC 3339 datetime
  "platforms": {                // REQUIRED. Map of platform key -> platform entry
    "linux-x86_64": {
      "url": "string",          // REQUIRED. URL to the update bundle
      "signature": "string"     // REQUIRED. Content of the .sig file
    },
    "linux-aarch64": { "url": "...", "signature": "..." },
    "windows-x86_64": { "url": "...", "signature": "..." },
    "windows-aarch64": { "url": "...", "signature": "..." },
    "darwin-x86_64": { "url": "...", "signature": "..." },
    "darwin-aarch64": { "url": "...", "signature": "..." }
  }
}
```

**Platform key format:** `{os}-{arch}` where:
- `os` in: `linux`, `windows`, `darwin`
- `arch` in: `x86_64`, `aarch64`, `i686`, `armv7`

**Dynamic server response (alternative, no `platforms` wrapper):**
```json
{
  "version": "string",     // REQUIRED
  "pub_date": "string",    // OPTIONAL
  "url": "string",         // REQUIRED
  "signature": "string",   // REQUIRED
  "notes": "string"        // OPTIONAL
}
```
Server returns `204 No Content` when no update available.

### 2.2 Real-World Example

**Source:** https://github.com/jamiepine/voicebox/blob/main/docs/content/docs/developer/autoupdater.mdx

```json
{
  "version": "0.2.0",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-01-25T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "base64_encoded_signature_here",
      "url": "https://github.com/jamiepine/voicebox/releases/download/v0.2.0/voicebox_0.2.0_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "base64_encoded_signature_here",
      "url": "https://github.com/jamiepine/voicebox/releases/download/v0.2.0/voicebox_0.2.0_x64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "base64_encoded_signature_here",
      "url": "https://github.com/jamiepine/voicebox/releases/download/v0.2.0/voicebox_0.2.0_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "base64_encoded_signature_here",
      "url": "https://github.com/jamiepine/voicebox/releases/download/v0.2.0/voicebox_0.2.0_x64_en-US.msi"
    }
  }
}
```

**Source 2:** https://github.com/luongndcoder/Scribble (workflow-generated)

### 2.3 Signing Scheme

**Algorithm:** Ed25519 (RFC 8032), via `minisign` format

**Key generation:**
```bash
tauri signer generate -w ~/.tauri/myapp.key
```
- `~/.tauri/myapp.key` — private key (NEVER commit)
- `~/.tauri/myapp.key.pub` — public key (goes in `tauri.conf.json`)

**Signing:**
```bash
tauri signer sign -k ~/.tauri/myapp.key path/to/MyApp.app.tar.gz
# Produces: MyApp.app.tar.gz.sig
```

**`.sig` file format (minisign):**
```
untrusted comment: signature from tauri-signer
<base64-encoded ed25519 signature>
```

**The `signature` field in `latest.json`** is the FULL content of the `.sig` file (including the `untrusted comment:` line). The Rust updater extracts and verifies using `minisign-verify`.

**Configuration (`tauri.conf.json`):**
```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "CONTENT FROM PUBLICKEY.PEM",
      "endpoints": [
        "https://github.com/owner/repo/releases/latest/download/latest.json"
      ]
    }
  }
}
```

**Endpoint URL resolution:**
- `endpoints` is an array, tried in order until 2XX
- Template variables: `{{current_version}}`, `{{target}}`, `{{arch}}`
- TLS enforced in production (non-HTTPS blocked)
- Entire manifest validated before version check

**Signature verification is MANDATORY** — cannot be disabled.

**Note (v2.13.3):** `minisign-verify` 0.3 rejects non-canonical Ed25519 `S` values.

**Sources:**
- https://v2.tauri.app/plugin/updater/
- https://v2.tauri.app/release/updater/
- https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs
- https://github.com/luongndcoder/Scribble/blob/main/.github/workflows/release-manifest.yml

---

## 3. Capacitor Live Update (@capawesome/capacitor-live-update v6)

**Spec version:** @capawesome/capacitor-live-update 6.x.x (Capacitor 6) / 7.x.x (Capacitor 7)
**Primary source:** https://capawesome.io/docs/sdactitors/capacitor/live-update/
**Cloud docs:** https://capawesome.io/docs/cloud/live-updates/setup/

### 3.1 Schema

The plugin does NOT use a single static manifest file. Two operational modes:

#### Mode A: Capawesome Cloud (hosted)

Server returns bundle metadata via API. No user-managed manifest file.

**`fetchLatestBundle()` response:**
```typescript
interface FetchLatestBundleResult {
  bundleId: string | null;
  downloadUrl: string;
  artifactType: 'zip' | 'manifest';
  checksum?: string;       // SHA-256 (hex v7+ / base64 v6) - self-hosted only
  signature?: string;      // Signed SHA-256 base64 - self-hosted only
  customProperties?: { [key: string]: string };
  channel?: string;        // v8.3+
}
```

#### Mode B: Self-Hosted (`downloadBundle`)

```typescript
interface DownloadBundleOptions {
  bundleId: string;              // REQUIRED
  url: string;                   // REQUIRED. ZIP URL or base URL for manifest-type
  artifactType?: 'zip' | 'manifest';  // Default: 'zip'
  checksum?: string;             // SHA-256 - zip only
  signature?: string;            // Signed SHA-256 base64 - zip only
}
```

**Delta update manifest** (for `artifactType: 'manifest'`):
Generated by: `npx @capawesome/cli apps:liveupdates:generatemanifest --path www`
JSON file mapping relative file paths to content hashes.

### 3.2 Bundle Format

| Property | Value |
|----------|-------|
| Default format | `.zip` of the entire web assets directory |
| Alternative | Individual files (manifest type) for delta updates |
| Manifest location | Generated separately by CLI |
| Contents | Complete `dist/` or `www/` directory (HTML, JS, CSS, assets) |

### 3.3 Channel Model

**Resolution order (highest priority first):**
1. `channel` param of `sync()` — ephemeral
2. `setChannel()` — persisted
3. Capacitor config `defaultChannel`
4. Native config (Info.plist / strings.xml)

**Common channels:** `default`, `production`, `staging`, `production-{versionCode}`

**Version-pinned pattern (recommended):**
```groovy
// Android
resValue "string", "capawesome_live_update_default_channel",
           "production-" + defaultConfig.versionCode
```

### 3.4 Real-World Example

**Configuration:**
```json
{
  "plugins": {
    "LiveUpdate": {
      "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",
      "autoUpdateStrategy": "background",
      "defaultChannel": "production",
      "publicKey": "-----BEGIN PUBLIC KEY-----MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDDodf1SD0OOn6hIlDuKBza0Ed0OqtwyVJwiyjmE9BJaZ7y8ZUfcF+SKmd0l2cDPM45XIg2tAFux5n29uoKyHwSt+6tCi5CJA5Z1/1eZruRRqABLonV77KS3HUtvOgqRLDnKSV89dYZkM++NwmzOPgIF422mvc+VukcVOBfc8/AHQIDAQAB-----END PUBLIC KEY-----"
    }
  }
}
```

**Self-hosted download:**
```typescript
await LiveUpdate.downloadBundle({
  bundleId: "bundle-2026-01-15",
  url: "https://cdn.example.com/bundles/app-1.2.0.zip",
  artifactType: "zip",
  checksum: "a3f5b8c9d1e2f4a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
  signature: "base64signedhash..."
});
```

### 3.5 Signing Scheme

**Algorithm:** RSA (SHA-256 with RSA signature)
- `publicKey` = PEM-encoded RSA public key
- `signature` = signed SHA-256 hash in base64
- Capawesome Cloud: signature in HTTP response header
- Self-hosted: developer provides in `DownloadBundleOptions`

**Key differences:** Uses RSA (NOT Ed25519). Signs the bundle checksum, not raw bytes.

**Sources:**
- https://capawesome.io/docs/sdactitors/capacitor/live-update/
- https://capawesome.io/docs/cloud/live-updates/setup/
- https://capawesome.io/docs/cloud/live-updates/channel-subscription/
- https://app.unpkg.com/@capawesome/capacitor-live-update@6.9.0/files/README.md

---

## 4. Squirrel.Windows `RELEASES` File + `.nuspec`

**Spec version:** Squirrel.Windows 1.4.0+ (staged rollouts), current master
**Primary source:** https://github.com/Squirrel/Squirrel.Windows
**Format spec:** https://reverseengineering.wiki/index.php/Format:Squirrel.Windows_package
**Source code (parser):** https://github.com/Squirrel/Squirrel.Windows/blob/master/src/Squirrel/ReleaseEntry.cs

### 4.1 Schema (PLAIN TEXT — `RELEASES` file)

NOT structured data. Plain text, one line per package.

**Line format (regex from source):**
```
^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$
```

| Token | Format | Description |
|-------|--------|-------------|
| SHA1 | 40 hex chars (upper or lower) | SHA-1 hash of the .nupkg |
| Filename | No spaces; bare filename OR absolute HTTP(S) URL | The .nupkg file |
| Filesize | Decimal integer | Size in bytes |
| # nn% | Optional, immediately after filesize | Staged rollout % (1.4.0+) |

**With staged rollout:**
```
<SHA1> <filename-or-url> <filesize># <percentage>%
```

**Package naming:** `{appname}-{semver}-full.nupkg` / `{appname}-{semver}-delta.nupkg`
**Ordering:** Version ascending; delta after full at same version.

### 4.2 Real-World Example

**Source:** https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/getting-started/5-updating.md

```
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
```

**With staged rollout (10%):**
```
e3f67244e4166a65310c816221a12685c83f8e6f myapp-1.0.0-full.nupkg 600725
0d777ea94c612e8bf1ea7379164caefba6e24463 myapp-1.0.1-delta.nupkg 6030# 10%
85f4d657f8424dd437d1b33cc4511ea7ad86b1a7 myapp-1.0.1-full.nupkg 600752# 10%
```

**5-line multi-version example:**
```
1AF532540A5F4790719ACDA9E9F732CC52DEDA33 MyApp-1.0.0-full.nupkg 3281920
252A5A2B9A1D1B61C2737F1D01215BF2D3C6E753 MyApp-1.1.0-delta.nupkg 321789
7E1EBBD392775B4490A90BD7626DF1F4123A59FF MyApp-1.1.0-full.nupkg 3295820
AA33CC55EE77FF99001122334455667788990011 MyApp-1.2.0-delta.nupkg 298451
BB44DD66FF880099AABBCCDDEE00112233445566 MyApp-1.2.0-full.nupkg 3312099
```

### 4.3 `.nuspec` Required Metadata

```xml
<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>MyApp</id>
    <version>1.0.0</version>
    <authors>Contoso</authors>
    <description>My Application</description>
    <releaseNotes>What's new</releaseNotes>
  </metadata>
</package>
```

Squirrel extracts `releaseNotes` for the update dialog. Missing = exception.

### 4.4 Signing Scheme

| Layer | Algorithm | What |
|-------|-----------|------|
| RELEASES SHA-1 | SHA-1 (40 hex) | .nupkg integrity during download |
| Authenticode | RSA 2048, SHA-256 | .exe files (Update.exe, Setup.exe, app binaries) |
| Delta .shasum | SHA-1 | Each patched file in delta package |

**Delta .nupkg layout:**
```
MyApp-1.1.0-delta.nupkg (ZIP)
+-- MyApp.nuspec
+-- lib/net45/
|   +-- file1.exe.diff        (MSDelta or BSDiff patch)
|   +-- file1.exe.shasum      ("SHA1  size" of expected result)
|   +-- file2.dll.diff        (Empty if unchanged)
|   +-- file2.dll.shasum
|   +-- file3.js              (New file, stored verbatim)
```

- MSDelta: for .exe, .dll, .node
- BSDiff: fallback for others
- Empty .diff = unchanged
- .shasum format: `{SHA1} {size}`

**Transport:** Plain HTTP(S) URL in `UpdateManager("https://releases.example.com/updates")`

**Sources:**
- https://github.com/Squirrel/Squirrel.Windows/blob/master/src/Squirrel/ReleaseEntry.cs
- https://github.com/Squirrel/Squirrel.Windows/blob/develop/docs/getting-started/5-updating.md
- https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/using/staged-rollouts.md
- https://reverseengineering.wiki/index.php/Format:Squirrel.Windows_package

---

## 5. Sparkle Appcast XML

**Spec version:** Sparkle 2.x (EdDSA/Ed25519), RSS 2.0 with Sparkle namespace
**Primary source:** https://sparkle-project.org/documentation/publishing/
**Namespace:** `http://www.andymatuschak.org/xml-namespaces/sparkle`
**EdDSA migration:** https://sparkle-project.org/documentation/eddsa-migration/

### 5.1 Schema (XML — `appcast.xml`)

```xml
<?xml version="1.0" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel>
    <title>AppName Updates</title>
    <link>https://example.com</link>
    <description>App updates</description>
    <language>en</language>

    <item>
      <!-- Required -->
      <title>Version 2.0</title>
      <pubDate>Mon, 05 Oct 2026 19:20:11 +0000</pubDate>
      <enclosure
        url="https://example.com/downloads/MyApp-2.0.zip"
        length="1623481"
        type="application/octet-stream"
        sparkle:edSignature="BASE64..."/>
      <sparkle:version>2</sparkle:version>

      <!-- Optional -->
      <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink>https://example.com/release_notes/2.0.html</sparkle:releaseNotesLink>
      <sparkle:phasedRolloutInterval>3600</sparkle:phasedRolloutInterval>
      <sparkle:informationalUpdate/>
      <link>https://example.com</link>
      <description><![CDATA[<p>Release notes HTML</p>]]></description>
    </item>
  </channel>
</rss>
```

**Element reference:**

| Element/Attr | Required | Type | Notes |
|-------------|----------|------|-------|
| `rss@version` | YES | "2.0" | RSS version |
| `rss@xmlns:sparkle` | YES | namespace | Sparkle namespace URI |
| `channel/title` | YES | text | App name |
| `item/title` | YES | text | Display title |
| `item/pubDate` | YES | RFC 822 | |
| `item/enclosure@url` | YES | URL | Update archive |
| `item/enclosure@length` | YES | integer | Bytes |
| `item/enclosure@type` | YES | MIME | Usually application/octet-stream |
| `item/enclosure@sparkle:edSignature` | YES* | base64 | Ed25519 sig (*unless SURequireSignedFeed off) |
| `item/sparkle:version` | YES | string | Build number (CFBundleVersion) |
| `item/sparkle:shortVersionString` | NO | string | Human-readable version |
| `item/sparkle:minimumSystemVersion` | NO | string | Min macOS, e.g. "14.0" |
| `item/sparkle:releaseNotesLink` | NO | URL/text | |
| `item/sparkle:phasedRolloutInterval` | NO | integer | Seconds between rollout phases |
| `item/sparkle:informationalUpdate` | NO | empty | No download |
| `item/description` | NO | CDATA | HTML notes |

**Version comparison:** `sparkle:version` (integer build) vs installed `CFBundleVersion`. Higher = newer.

### 5.2 Real-World Example

**Source:** https://github.com/ospfranco/sol (active Sparkle app)

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0">
  <channel>
    <title>Sol</title>
    <item>
      <title>2.1.331</title>
      <description><![CDATA[**Full Changelog**: https://github.com/ospfranco/sol/compare/2.1.330...2.1.331]]></description>
      <pubDate>Sat, 02 May 2026 18:17:26 -0400</pubDate>
      <sparkle:version>540</sparkle:version>
      <sparkle:shortVersionString>2.1.331</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <enclosure url="https://github.com/ospfranco/sol/releases/download/2.1.331/2.1.331.zip"
                 length="15191250"
                 type="application/octet-stream"
                 sparkle:edSignature="7sg7no8bKk+lnbrhioKmWWP5fCQkXPqgibM/hiAabUjDpAWtPG+jVTUk0aRHPyZDxjpwo4QyAWH2SPpBSwicCA=="/>
    </item>
    <item>
      <title>2.1.330</title>
      <pubDate>Thu, 24 Apr 2026 09:15:00 -0400</pubDate>
      <sparkle:version>538</sparkle:version>
      <sparkle:shortVersionString>2.1.330</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <enclosure url="https://github.com/ospfranco/sol/releases/download/2.1.330/2.1.330.zip"
                 length="15193744"
                 type="application/octet-stream"
                 sparkle:edSignature="UB3GkJQQFZNsVvQ9KFsM8ku/mIWv3cE6ZuggWXo1/nkn1pyDcgprdLFHYkIvUkm+idYCXRXnU0qsUk4i8qgUDw=="/>
    </item>
  </channel>
</rss>
```

### 5.3 Signing Scheme

**Algorithm:** EdDSA (Ed25519, RFC 8032)

**Key storage:**
- Public: `Info.plist` → `SUPublicEDKey` (base64, 32-byte)
- Private: macOS Keychain (account: `ed25519`), via `./bin/generate_keys`

**Signing:**
```bash
./bin/generate_keys
./bin/sign_update path/to/MyApp-2.0.zip
# Output: sparkle:edSignature="BASE64..." length="1623481"
```

**Signature format:** Raw base64 of 64-byte Ed25519 signature. No envelope. Signs entire archive byte-for-byte.

**Feed signing (v2.7+, `SURequireSignedFeed`):** Appcast XML itself can be signed. Release notes signable too.

**Legacy DSA (deprecated):** Pre-2.0 used DSA. Now deprecated but still verified for migration.

**Sources:**
- https://sparkle-project.org/documentation/publishing/
- https://sparkle-project.org/documentation/eddsa-migration/
- https://github.com/sparkle-project/Sparkle/pull/2822
- https://github.com/ospfranco/sol/compare/2.1.331...main
- https://github.com/getlantern/lantern/blob/main/scripts/generate_appcast.py
- https://github.com/alex-ivanov/go-sparkle

---

## 6. PWA Service Worker Update Lifecycle (W3C + Workbox)

**Spec version:** W3C Service Workers (TR, 2026-10-29)
**Primary source:** https://www.w3.org/TR/service-workers/
**Workbox:** https://developer.chrome.com/docs/workbox/ (v7)
**MDN:** https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

### 6.1 W3C Service Worker Lifecycle (No Manifest File)

**Critical:** The PWA SW model does NOT use a manifest file. Updates are triggered by the BROWSER fetching the SW script and comparing it byte-for-byte. No `version`, no `url`, no `signature` field.

**Lifecycle states (W3C spec):**
```
parsed -> installing -> installed -> activating -> activated
                  \-> redundant
```

| State | Description |
|-------|-------------|
| `parsed` | Initial state after download/parse. Never updated to. |
| `installing` | Running `install` handler. `waitUntil(promise)` can extend. |
| `installed` | Waiting worker. Waits for old tabs to close or `skipWaiting()`. |
| `activating` | Running `activate` handler. Old caches cleaned. |
| `activated` | Ready for fetch/message/push/sync events. |
| `redundant` | Install failed or replaced. |

**Update check trigger:**
- Navigation to in-scope page
- `registration.update()` explicitly
- Push/sync event (if stale: >86400s since last check)
- Browser fetches SW script, compares bytes. One-byte diff = new install.

### 6.2 `updateViaCache` Mode

```typescript
enum ServiceWorkerUpdateViaCache {
  "imports",  // Default. SW + importScripts may use HTTP cache
  "all",      // All fetches during update may use cache
  "none"      // No cache during update; always network
};

// Usage:
navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
```

| Mode | SW script | importScripts | Other fetches |
|------|-----------|---------------|---------------|
| `imports` (default) | Cache OK | Cache OK | Network only |
| `all` | Cache OK | Cache OK | Cache OK |
| `none` | Network | Network | Network |

Browser honours HTTP caching headers for SW script up to 24h (86400s "stale" threshold).

### 6.3 `skipWaiting()` and `clients.claim()`

```typescript
// In the SW script:
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', () => { self.clients.claim(); });
```

**`skipWaiting()`:** Sets skip-waiting flag. Waiting worker immediately becomes activating.

**`clients.claim()`:** Must be active worker. For each client in scope: if current controller is not this SW, replace it and fire `controllerchange`.

### 6.4 Workbox Configuration

**`workbox-config.js` (generateSW mode):**
```javascript
module.exports = {
  globDirectory: "dist/",
  globPatterns: ["**/*.{html,js,css,woff2,svg,webmanifest}"],
  globIgnores: ["**/node_modules/**/*", "**/*.map"],
  dontCacheBustURLsMatching: /\.[0-9a-f]{8,}\./,
  swDest: "dist/sw.js",

  skipWaiting: false,       // true = immediate activation
  clientsClaim: false,      // true = immediately claim all pages
  cleanupOutdatedCaches: true,
  navigationPreload: true,
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/],

  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === "navigate",
      handler: "NetworkFirst",
      options: {
        cacheName: "pages",
        networkTimeoutSeconds: 4,
        expiration: { maxEntries: 50 },
        precacheFallback: { fallbackURL: "/offline.html" },
      },
    },
    {
      urlPattern: ({ request }) => request.destination === "image",
      handler: "StaleWhileRevalidate",
      options: {
        cacheName: "images",
        expiration: { maxEntries: 200, maxAgeSeconds: 30*24*60*60 },
      },
    },
  ],
};
```

**What `generateSW` emits:**
- `skipWaiting: true` → `self.skipWaiting()` unconditional
- `skipWaiting: false` → message listener for `{type: "SKIP_WAITING"}`
- `clientsClaim: true` → `self.clients.claim()`
- Then precache, cleanup, routes, etc.

### 6.5 `BroadcastUpdatePlugin`

```javascript
import { registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';
import { BroadcastUpdatePlugin } from 'workbox-broadcast-update';

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new StaleWhileRevalidate({
    plugins: [new BroadcastUpdatePlugin()],
  })
);
```

**Client listener (before DOMContentLoaded):**
```javascript
navigator.serviceWorker.addEventListener('message', async (event) => {
  if (event.data?.meta === 'workbox-broadcast-update') {
    const { cacheName, updatedURL } = event.data.payload;
    // Handle update...
  }
});
```

Detection: Compares `Content-Length`, `ETag`, `Last-Modified` headers. Opaque responses never trigger.

### 6.6 SRI Integration

```html
<link rel="stylesheet" href="/assets/styles.abc123.css"
      integrity="sha384-kQvTUlKbD1E2F3G4H5I6J7K8L9M0N1O2P3Q4R5S6T7U8V9W0X1Y2Z3A4B5C6D7E8"
      crossorigin="anonymous">
```

Format: `sha384-<base64>` (also `sha256-`, `sha512-`). Enforced by browser at load time, independent of SW. Content-hashed filenames make SRI often redundant.

### 6.7 PWA "Manifest" for Update Purposes

**There is NO standard PWA manifest field for auto-update.** The `webmanifest.json` has `start_url`, `display`, `icons` — nothing about version/signature.

**The update "manifest" IS the SW script itself** — fixed URL, byte content = version indicator. No separate file.

**Sources:**
- https://www.w3.org/TR/service-workers/
- https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker/state
- https://developer.chrome.com/docs/workbox/modules/workbox-broadcast-update
- https://progressivewebapps.com/tooling/workbox/
- https://openpwa.net/reference/service-worker/lifecycle/

---

## 7. Microsoft AppInstaller (`*.appinstaller`)

**Spec version:** AppInstaller schema 2017/2, 2018, 2021
**Primary source:** https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file
**Schema ref:** https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root
**Namespace:** `http://schemas.microsoft.com/appx/appinstaller/2017/2` (base) / `...2021` (extended)

### 7.1 Schema (XML — `*.appinstaller`)

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
    Version="1.0.0.0"
    Uri="https://updates.example.com/app.appinstaller">

  <MainBundle
      Name="Contoso.MainApp"
      Publisher="CN=Contoso, O=Contoso, L=Seattle, S=WA, C=US"
      Version="2.23.12.43"
      Uri="https://updates.example.com/MainApp.msixbundle" />

  <!-- OR MainPackage for .msix/.appx (requires ProcessorArchitecture) -->

  <OptionalPackages>
    <Bundle Name="..." Publisher="..." Version="..." Uri="..." />
    <Package Name="..." Publisher="..." Version="..." ProcessorArchitecture="x64" Uri="..." />
  </OptionalPackages>

  <Dependencies>
    <Bundle Name="..." Publisher="..." Version="..." Uri="..." />
  </Dependencies>

  <RelatedPackages>
    <Bundle Name="..." Publisher="..." Version="..." Uri="..." />
  </RelatedPackages>

  <UpdateSettings>
    <OnLaunch
        HoursBetweenUpdateChecks="12"
        ShowPrompt="true"
        UpdateBlocksActivation="true" />
    <AutomaticBackgroundTask />
    <ForceUpdateFromAnyVersion>true</ForceUpdateFromAnyVersion>
  </UpdateSettings>

  <UpdateUris>
    <UpdateUri>https://updates.example.com/app.appinstaller</UpdateUri>
    <UpdateUri>https://backup.example.com/app.appinstaller</UpdateUri>
  </UpdateUris>

  <RepairUris>
    <RepairUri>https://updates.example.com/repair.appinstaller</RepairUri>
  </RepairUris>
</AppInstaller>
```

**Element reference:**

| Element | Required | Key Attributes | Notes |
|---------|----------|---------------|-------|
| `AppInstaller` | YES | `Version` (4-part), `Uri` | Root |
| `MainBundle` | YES* | `Name`, `Publisher`, `Version`, `Uri` | For .msixbundle |
| `MainPackage` | YES* | `Name`, `Publisher`, `Version`, `ProcessorArchitecture`, `Uri` | For .msix |
| `OptionalPackages` | NO | Contains Bundle/Package | |
| `Dependencies` | NO | Contains Bundle/Package | Installed if needed |
| `RelatedPackages` | NO | Contains Bundle/Package | NOT installed |
| `UpdateSettings` | NO | Contains OnLaunch etc. | |
| `OnLaunch` | NO | `HoursBetweenUpdateChecks` (0-255, def 24), `ShowPrompt`, `UpdateBlocksActivation` | |
| `AutomaticBackgroundTask` | NO | (none) | 8h interval, no UI |
| `ForceUpdateFromAnyVersion` | NO | text true/false | Allow downgrades |
| `UpdateUris` | NO | Contains UpdateUri (max 10) | Fallback, 2021 schema |
| `RepairUris` | NO | Contains RepairUri | |

**Version:** 4-part Windows format `Major.Minor.Build.Revision` (e.g. `2.23.12.43`).

**Namespace requirements:**
- 2017/2: base (Win10 1709+)
- 2018: AutomaticBackgroundTask, ForceUpdateFromAnyVersion
- 2021: UpdateUris, RepairUris (Win10 2004+)

### 7.2 Real-World Example

**Source:** https://github.com/microsoft/devops-for-windows-apps/blob/master/MyWPFApp.Package/Package.appinstaller

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller Uri="{AppInstallerUri}"
              Version="{Version}"
              xmlns="http://schemas.microsoft.com/appx/appinstaller/2018">
  <MainBundle Name="{Name}"
              Version="{Version}"
              Publisher="{Publisher}"
              Uri="{MainPackageUri}"/>
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="0" ShowPrompt="true" UpdateBlocksActivation="true" />
  </UpdateSettings>
</AppInstaller>
```

(Placeholder format — values substituted at build time by Visual Studio.)

### 7.3 Signing Scheme

The `.appinstaller` file itself is **NOT cryptographically signed**.

| Layer | Algorithm | What |
|-------|-----------|------|
| MSIX Authenticode | RSA/ECDSA, SHA-256 | The .msix/.msixbundle package |
| HTTPS transport | TLS | The .appinstaller file |
| Windows package mgr | OS-level trust | Validates package sig before install |

- `Publisher` must EXACTLY match the MSIX signing cert DN
- `Version` must match package Identity/Version
- `Name` must match package Identity/Name
- Mismatch = installation fails
- **NO `<Hash>` field exists** in the official schema (user assumption corrected)

**Sources:**
- https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file
- https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root
- https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/element-update-settings
- https://github.com/microsoft/devops-for-windows-apps/blob/master/MyWPFApp.Package/Package.appinstaller
- https://techcommunity.microsoft.com/blog/modernworkappconsult/introducing-the-new-app-installer-template-in-visual-studio-2019/739019

---

## 8. Minimum Viable Subset Analysis

### 8.1 Field Intersection Matrix

| Field | electron-builder | Tauri | Capacitor | Squirrel | Sparkle | PWA SW | AppInstaller |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **version** | YES | YES | partial (bundleId) | YES (filename) | YES | NO (byte-compare) | YES |
| **url** (artifact) | YES | YES | YES | YES (filename) | YES (enclosure) | NO (fixed SW URL) | YES |
| **size** (bytes) | YES | NO | NO (headers) | YES | YES (length) | NO | NO |
| **hash** (integrity) | YES sha512 | NO (sig covers) | partial (checksum) | YES sha1 | NO (sig covers) | NO | NO (Authenticode) |
| **signature** | YES (v27) | YES | YES | NO (Authenticode) | YES | NO | NO (Authenticode) |
| **release date** | YES | YES | NO | NO | YES | NO | NO |
| **release notes** | YES | YES | NO | YES (nuspec) | YES | NO | NO |
| **platform** | partial | YES (key) | NO | NO | partial (sparkle:os) | NO | YES (ProcessorArch) |
| **staged rollout** | YES | NO | YES (Cloud) | YES (# nn%) | YES (phasedRollout) | NO | NO |
| **channel** | NO | NO | YES | NO | NO | NO | NO |
| **min system ver** | YES | NO | NO | NO | YES | NO | NO |
| **blockmap/delta** | YES | NO | YES (manifest) | YES (delta) | NO | NO | NO |

### 8.2 Universal Intersection (ALL 7)

The strict intersection required by **all 7** is minimal:

| Field | Rationale |
|-------|-----------|
| **version** | All except PWA need explicit version. PWA uses byte-comparison, but unified manifest should carry it. |
| **url** (artifact) | All except PWA point to a downloadable artifact. PWA's "artifact" is the SW script at a fixed URL. |

**Only 2 fields are truly universal.**

### 8.3 Practical Intersection (6 of 7, excluding PWA)

Excluding PWA (fundamentally different update model):

| Field | Present in | Format |
|-------|-----------|--------|
| **version** | All 6 | SemVer / 4-part / in-filename |
| **url** | All 6 | Absolute or relative URL |
| **integrity** | All 6 | sha512, sha1, edSignature, Authenticode, RSA sig |
| **release date** | 4/6 | ISO 8601 / RFC 822 |

### 8.4 Nice-to-Have Fields (Unique to 1-2 Systems)

| Field | Systems | AIRIZ Recommendation |
|-------|---------|---------------------|
| `stagingPercentage` | electron, Squirrel, Capacitor, Sparkle | INCLUDE |
| `channel` | Capacitor only | INCLUDE |
| `minimumSystemVersion` | electron, Sparkle | INCLUDE |
| `size` | electron, Squirrel, Sparkle | INCLUDE |
| `notes` / `releaseNotes` | electron, Tauri, Sparkle, Squirrel | INCLUDE |
| `blockMap` / delta | electron, Squirrel, Capacitor | OPTIONAL |
| `signatures[]` (multi-key) | electron v27 | INCLUDE |
| `UpdateSettings` (poll interval) | AppInstaller | MAPPABLE |

### 8.5 Minimum Signing Scheme

| Algorithm | Systems | Notes |
|-----------|---------|-------|
| **Ed25519** | Tauri, Sparkle, electron v27+ | 3/7 native. RFC 8032. 64B sig, 32B key. |
| **RSA (Authenticode)** | Squirrel, AppInstaller, Capacitor, electron (artifact) | 4/7 at artifact level |
| **SHA-512** | electron | Manifest integrity |
| **SHA-1** | Squirrel | Manifest integrity (weak) |
| **No manifest sig** | PWA SW, AppInstaller | TLS + OS code sig |

**Recommendation: Ed25519 for the unified manifest signature.**

1. Tauri, Sparkle, electron v27 use it natively
2. 32-byte public key (single config field)
3. 64-byte signature (compact)
4. RFC 8032 — no vendor lock-in
5. Squirrel/AppInstaller use Authenticode at artifact level; Ed25519 manifest sig is a SUPERSET
6. Capacitor uses RSA, but Ed25519 is verifiable by any modern crypto lib

**ALSO carry SHA-512** for simple integrity check without signature verification (belt-and-suspenders).

### 8.6 Recommended `airiz-manifest-v1.json` Schema

```json
{
  "$schema": "https://airiz.example.com/schemas/airiz-manifest-v1.json",
  "specVersion": "1.0",

  "version": "2.4.1",
  "channel": "production",
  "pubDate": "2026-11-05T12:00:00Z",

  "platforms": {
    "electron-windows-x64": {
      "url": "https://releases.airiz.com/v2.4.1/AIRIZ-Console-2.4.1-setup.exe",
      "size": 134434016,
      "sha512": "Khz7sieUavOJpdrfJhlU2GuxLserSmPSb3ead/09+KTdVWMfrEwP6lHKu4qGZaOHoStdjNjGKJmhcJLs1ZfglQ==",
      "signature": "base64_ed25519_signature_of_artifact",
      "blockMapUrl": "https://releases.airiz.com/v2.4.1/AIRIZ-Console-2.4.1-setup.exe.blockmap"
    },
    "electron-darwin-arm64": {
      "url": "https://releases.airiz.com/v2.4.1/AIRIZ-Console-2.4.1.dmg",
      "size": 89234567,
      "sha512": "base64...",
      "signature": "base64_ed25519..."
    },
    "tauri-darwin-aarch64": {
      "url": "https://releases.airiz.com/v2.4.1/airiz-console_2.4.1_aarch64.app.tar.gz",
      "size": 52428800,
      "sha512": "base64...",
      "signature": "Untrusted comment: ...base64..."
    },
    "squirrel-windows-x64": {
      "url": "https://releases.airiz.com/v2.4.1/AIRIZ-2.4.1-full.nupkg",
      "size": 3281920,
      "sha1": "E3F67244E4166A65310C816221A12685C83F8E6F",
      "signature": "base64_ed25519..."
    },
    "pwa": {
      "serviceWorkerUrl": "/sw.js",
      "updateViaCache": "none"
    }
  },

  "manifestSignature": {
    "keyId": "a3f5b8c9d1e2f4a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
    "signature": "base64_ed25519_over_manifest"
  },

  "stagingPercentage": 100,

  "minimumSystemVersion": {
    "darwin": "14.0",
    "windows": "10.0.19041"
  },

  "notes": "## v2.4.1\n- Fix: Bluetooth disconnect on idle\n- Fix: Firmware flash timeout",
  "releaseNotesUrl": "https://airiz.com/releases/2.4.1"
}
```

### 8.7 Should AIRIZ Ship Its Own Unified Manifest?

**YES — ship `airiz-manifest-v1.json`.**

1. **No single existing format covers all 7 surfaces.** YAML, JSON, plain text, XML RSS, XML, no-manifest. A unified JSON with `platforms` map (Tauri pattern) is the cleanest superset.

2. **Ed25519 manifest signature closes a gap** in Squirrel (SHA-1 only) and AppInstaller (no manifest sig). Single strong integrity check for all.

3. **Channel + stagingPercentage** needed by 4+ systems. Centralized rollout control.

4. **Cloudflare Worker serves all formats from one source:**
   - Direct: `airiz-manifest-v1.json` for custom AIRIZ clients
   - Transform to `latest.yml` for electron-updater
   - Transform to `latest.json` for Tauri
   - Transform to `appcast.xml` for Sparkle
   - Transform to `RELEASES` for Squirrel
   - Transform to `.appinstaller` for MSIX
   - Serve SW script directly for PWA

5. **Minimum v1 field set:**

| Field | Type | Required | Source |
|-------|------|----------|--------|
| `version` | string (SemVer) | YES | All |
| `channel` | string | NO (def: "production") | Capacitor |
| `pubDate` | string (ISO 8601) | YES | electron, Tauri, Sparkle |
| `platforms` | object | YES | Tauri pattern |
| `platforms.*.url` | string | YES | All |
| `platforms.*.size` | integer | NO | electron, Squirrel, Sparkle |
| `platforms.*.sha512` | string (base64) | NO | electron |
| `platforms.*.sha1` | string (hex) | NO | Squirrel |
| `platforms.*.signature` | string (base64) | YES | Tauri, Sparkle, electron, Capacitor |
| `manifestSignature.keyId` | string (hex) | YES | electron v27 |
| `manifestSignature.signature` | string (base64) | YES | electron v27 |
| `stagingPercentage` | integer (0-100) | NO (def: 100) | electron, Squirrel, Sparkle |
| `minimumSystemVersion` | object | NO | electron, Sparkle |
| `notes` | string (Markdown) | NO | Tauri, electron |
| `releaseNotesUrl` | string | NO | Sparkle |

**NOT in v1:** blockMap/delta (surface-specific), UpdateSettings (AppInstaller-specific), OptionalPackages/Dependencies (MSIX graph), SRI hashes (browser-enforced).

---

## Appendix: Source Index

| System | Spec Version | Primary URL |
|--------|-------------|-------------|
| electron-builder | v27+ (2025) | https://www.electron.build/docs/features/auto-update |
| electron-builder signing | v27 (2025) | https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/signed-update-manifests.md |
| Tauri Updater | 2.13.x (Oct 2026) | https://v2.tauri.app/plugin/updater/ |
| Capacitor Live Update | 6.x/7.x (2025-2026) | https://capawesome.io/docs/sdactitors/capacitor/live-update/ |
| Squirrel.Windows | 1.4.0+ (2017), master | https://github.com/Squirrel/Squirrel.Windows |
| Sparkle | 2.x (2024+) | https://sparkle-project.org/documentation/publishing/ |
| W3C Service Workers | TR (2026-10-29) | https://www.w3.org/TR/service-workers/ |
| Workbox | v7 (2026) | https://developer.chrome.com/docs/workbox/ |
| MS AppInstaller | schema 2021 | https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file |

---
*End of specification. 7 systems documented. Minimum viable subset identified.*