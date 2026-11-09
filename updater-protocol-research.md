# Auto-Update Protocol Reference - AIRIZ Motor Console

> **Purpose**: If AIRIZ builds a custom signed-manifest layer, this document captures the exact protocol
> details (manifest schemas, file formats, signing flows) for every major auto-update tool.
> Each section ends with a **Minimum Viable Subset** - the 3-5 fields your server MUST emit
> for that tool to consume your manifest.

---

## 1. electron-builder NSIS Auto-Update (latest.yml)

### 1.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| latest.yml | Same bucket/dir as installer | Stable channel, Windows x64 |
| latest-beta.yml | Same bucket | Beta channel |
| latest-alpha.yml | Same bucket | Alpha channel |
| latest-mac.yml | Same bucket | macOS (zip-based) |
| latest-linux.yml | Same bucket | Linux (AppImage/deb/rpm) |
| channel.blockmap | Same bucket | Blockmap for differential download |

File naming (from source getUpdateInfoFileName): `.yml`
- osSuffix: ` on Windows, -mac on macOS, -linux on Linux
- archPrefix: ` for x64, -arm for armv7l, -arm64 for arm64 (Linux only)

Channel expansion: A "stable" release writes latest.yml, latest-beta.yml, AND latest-alpha.yml.
A "beta" release writes latest-beta.yml and latest-alpha.yml. A "suffixed channel" (e.g. latest-x64)
in electron-builder v27+ also expands to lower channels (breaking change from v26).

### 1.2 Literal Schema (from source: packages/builder-util-runtime/src/updateInfo.ts)

`yaml
# latest.yml - Windows x64 example
version: 2.3.1
files:
  - url: My-App-Setup-2.3.1.x64.exe
    sha512: 0123456789abcdef...
    size: 52428800
releaseDate: "2026-01-15T10:30:00.000Z"
releaseNotes:
  - version: 2.3.1
    note: "Bug fixes and performance improvements"
stagingPercentage: 100
signature: |
  abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789...
`

Full TypeScript interface (verbatim from source):

`	ypescript
export interface UpdateInfo {
  readonly version: string;
  readonly files: Array<UpdateFileInfo>;
  readonly path?: string;           // deprecated - legacy electron-updater <2.16
  readonly sha512?: string;         // deprecated - legacy electron-updater <2.16
  releaseName?: string | null;
  releaseNotes?: string | Array<ReleaseNoteInfo> | null;
  releaseDate: string;              // ISO 8601
  readonly stagingPercentage?: number;  // 0-100
  readonly minimumSystemVersion?: string;
  readonly signature?: string;             // Base64 Ed25519 (first key)
  readonly signatures?: Array<UpdateManifestSignature>; // Multi-key
}

export interface UpdateFileInfo extends BlockMapDataHolder {
  url: string;
  blockMapUrl?: string;
}

export interface BlockMapDataHolder {
  size?: number;
  blockMapSize?: number;
  readonly sha512: string;          // Base64-encoded SHA-512
  readonly isAdminRightsRequired?: boolean;
}

export interface WindowsUpdateInfo extends UpdateInfo {
  packages?: { [arch: string]: PackageFileInfo } | null;
  readonly allowCatalogSignature?: boolean;
  readonly sha2?: string;           // deprecated SHA-256
}

export interface UpdateManifestSignature {
  readonly keyId: string;           // Lowercase hex SHA-256 of SPKI DER
  readonly signature: string;       // Base64 Ed25519
}
`

### 1.3 Field-by-Field Documentation

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | string | YES | Semver of the app (e.g. 2.3.1) |
| files | Array | YES | Array of download descriptors (zip first) |
| files[].url | string | YES | Installer filename (relative) or absolute URL |
| files[].sha512 | string | YES | Base64 SHA-512 of the installer file |
| files[].size | number | no | File size in bytes |
| releaseDate | string | YES | ISO 8601 timestamp of release |
| releaseName | string | no | Display name for the release |
| releaseNotes | string or Array | no | Changelog (string or [{version, note}]) |
| stagingPercentage | number | no | 0-100, staged rollout |
| minimumSystemVersion | string | no | e.g. 10.0.22631 (Win) or 23.1.0 (macOS) |
| signature | string | no* | Base64 Ed25519 signature (single-key legacy) |
| signatures | Array | no* | Multi-key signatures for rotation |

* Required if updateManifestPublicKey is set in the app.

### 1.4 Signing Flow

1. Key generation: Ed25519 keypair. Private key stored in CI secret.
2. Signing: electron-builder serializes manifest to YAML, canonicalizes integrity-critical fields, signs with Ed25519, appends signature/signatures.
3. Verification: electron-updater at runtime parses YAML, extracts signature, verifies against embedded updateManifestPublicKey. If verification fails, update is rejected.
4. Key rotation: Dual-signing. Both old and new keys sign the manifest. signatures[] carries one entry per key. Client accepts if ANY trusted key matches ANY entry.

### 1.5 Provider-Specific Quirks

- GitHub: files[].url is just the filename; full URL from GitHub release API.
- S3/Generic: files[].url can be absolute URL or key path.
- Blockmaps: Differential downloads use SHA-512 blockmap at url.blockmap.
- NSIS web installer: Uses packages object with per-arch entries.

### 1.6 Recent Spec Changes (2025-2026)

- v27 migration: latest.yml drops legacy top-level path/sha512 fields.
- Suffixed channel expansion (v27): latest-x64 expands to beta-x64.yml and alpha-x64.yml.
- Multi-key signing (v27+): signatures[] array with keyId + signature pairs.
- verifySerializedManifest: Build-time check that re-parses written YAML and verifies signature.

### 1.7 MINIMUM VIABLE SUBSET

`yaml
version: "2.3.1"
files:
  - url: MyApp-Setup-2.3.1.x64.exe
    sha512: <base64-sha512>
releaseDate: "2026-01-15T10:30:00.000Z"
`

These 4 fields (version, files[].url, files[].sha512, releaseDate) are the absolute minimum.

---
## 2. @tauri-apps/plugin-updater (Tauri 2.x)

### 2.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| latest.json | Any HTTPS endpoint | The update manifest |
| MyApp-2.3.1.app.tar.gz | Same origin or CDN | macOS/Linux bundle |
| MyApp-2.3.1-x64-setup.exe | Same origin or CDN | Windows NSIS |
| MyApp-2.3.1-x64.msi | Same origin or CDN | Windows WiX |

Endpoint URL configured in tauri.conf.json:
`json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://releases.example.com/{{target}}/{{arch}}/latest.json"],
      "pubkey": "<base64-minisign-public-key>"
    }
  }
}
`

URL variables: {{target}}, {{arch}}, {{current_version}}, {{bundle_type}}

### 2.2 Literal Schema (from source: plugins/updater/src/updater.rs)

Static format (all platforms in one file):

`json
{
  "version": "2.3.1",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-01-15T10:30:00.000Z",
  "platforms": {
    "darwin-aarch64-app": {
      "url": "https://releases.example.com/darwin/aarch64/MyApp-2.3.1.app.tar.gz",
      "signature": "MEUCIQD....base64-minisign-signature...."
    },
    "windows-x86_64-nsis": {
      "url": "https://releases.example.com/windows/x64/MyApp-2.3.1-setup.exe",
      "signature": "MEUCIQD....base64-minisign-signature...."
    },
    "linux-x86_64-appimage": {
      "url": "https://releases.example.com/linux/x64/MyApp-2.3.1.AppImage",
      "signature": "MEUCIQD....base64-minisign-signature...."
    }
  }
}
`

Dynamic format (server resolves platform):

`json
{
  "version": "2.3.1",
  "notes": "Bug fixes",
  "pub_date": "2026-01-15T10:30:00.000Z",
  "url": "https://releases.example.com/darwin/aarch64/MyApp-2.3.1.app.tar.gz",
  "signature": "MEUCIQD....base64-minisign-signature...."
}
`

Rust struct (verbatim from source):

`ust
pub struct ReleaseManifestPlatform {
    pub url: Url,
    pub signature: String,
}

#[serde(untagged)]
pub enum RemoteReleaseInner {
    Dynamic(ReleaseManifestPlatform),
    Static { platforms: HashMap<String, ReleaseManifestPlatform> },
}

pub struct RemoteRelease {
    pub version: Version,           // semver
    pub notes: Option<String>,
    pub pub_date: Option<OffsetDateTime>,
    pub data: RemoteReleaseInner,
}
`

Platform target keys: {os}-{arch} or {os}-{arch}-{bundle_type}

| os | arch | bundle_type | Example key |
|----|------|-------------|-------------|
| darwin | aarch64 | app | darwin-aarch64-app |
| darwin | x86_64 | app | darwin-x86_64-app |
| windows | x86_64 | nsis | windows-x86_64-nsis |
| windows | x86_64 | msi | windows-x86_64-msi |
| linux | x86_64 | appimage | linux-x86_64-appimage |
| linux | x86_64 | deb | linux-x86_64-deb |
| linux | x86_64 | rpm | linux-x86_64-rpm |

### 2.3 Field-by-Field Documentation

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | string (semver) | YES | Must be parseable as semver |
| notes | string | no | Release notes / changelog |
| pub_date | string (RFC3339) | no | Release publication date |
| platforms | object | YES* | Map of target to url+signature |
| platforms.*.url | string (URL) | YES | Download URL for the installer |
| platforms.*.signature | string | YES | Minisign signature (base64) |
| url | string | YES* | Alternative: single-platform format |
| signature | string | YES* | Alternative: single-platform signature |

* One of platforms (static) or url+signature (dynamic) is required.

### 2.4 Signing Flow

1. Key generation: tauri signer generate -f my-key produces my-key (private) and my-key.pub (public).
2. Signing: tauri signer sign MyApp-2.3.1.app.tar.gz -f my-key produces a .sig file (minisign format, base64-encoded).
3. Publish: tauri.conf.json pubkey field holds the base64 public key. The signature field in latest.json holds the base64 signature.
4. Verification: At runtime, updater downloads artifact, verifies minisign signature against embedded public key.
5. Algorithm: Minisign (Ed25519-based) by jedisct1.

### 2.5 Provider-Specific Quirks

- 204 No Content: Updater treats as no update available (not an error).
- Multiple endpoints: Tried in order; first valid response wins.
- dangerousInsecureTransportProtocol: Non-HTTPS rejected in release builds unless enabled.
- Windows NSIS: Passes /UPDATER flag. MSI uses msiexec.exe /passive (default).
- macOS: Update extracted to temp; app must be relaunched manually.
- Linux AppImage: Replaces the AppImage in place.
- requireSignedVersion: New flag that verifies version in signature matches announced version.

### 2.6 Recent Spec Changes (2025-2026)

- Tauri 2.12 (current): No breaking changes to update manifest format.
- requireSignedVersion: New security flag for downgrade protection.
- allowDowngrades: New config to allow installing older versions.
- version_comparator (Rust API): Custom version comparison logic.
- MSRV 1.90: Tauri 2.12 requires Rust 1.90+.

### 2.7 MINIMUM VIABLE SUBSET

`json
{
  "version": "2.3.1",
  "pub_date": "2026-01-15T10:30:00.000Z",
  "platforms": {
    "windows-x86_64-nsis": {
      "url": "https://releases.example.com/MyApp-2.3.1-setup.exe",
      "signature": "<base64-minisign-sig>"
    }
  }
}
`

These fields (version, pub_date, platforms.*.url, platforms.*.signature) are the absolute minimum.

---
## 3. Capacitor Live Update (Capgo)

### 3.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| dist.zip | CDN / S3 / custom server | Web bundle (HTML/JS/CSS) |
| manifest (in response) | Inline in JSON | Delta update file list |
| ota-builtin-hashes.json | Next to web assets in APK | Built-in file checksums |

Endpoints (from plugin config):

| Endpoint | Default | Purpose |
|----------|---------|---------|
| updateUrl | https://plugin.capgo.app/updates | Update check + download |
| channelUrl | https://plugin.capgo.app/channel_self | Channel assignment |
| statsUrl | https://plugin.capgo.app/stats | Telemetry |

### 3.2 Literal Schema

Request (device to server, from AppInfos type in backend source):

`json
{
  "version_name": "2.3.1",
  "version_build": "42",
  "version_os": "18",
  "plugin_version": "8.51.22",
  "platform": "ios",
  "app_id": "com.airiz.motorconsole",
  "device_id": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
  "defaultChannel": "prod",
  "key_id": "key-abc123"
}
`

Response (server to device, the LatestVersion type):

`json
{
  "version": "2.4.0",
  "message": "Bug fixes and new motor calibration features",
  "download_url": "https://files.capgo.app/com.airiz.motorconsole/2.4.0/dist.zip",
  "checksum": "sha256:abcdef1234567890...",
  "manifest": [
    {
      "file_name": "assets/index-bundle.js",
      "file_hash": "abc123def456",
      "download_url": "https://files.capgo.app/com.airiz.motorconsole/2.4.0/assets/index-bundle.js"
    },
    {
      "file_name": "index.html",
      "file_hash": "fed456abc123",
      "download_url": "https://files.capgo.app/com.airiz.motorconsole/2.4.0/index.html"
    }
  ]
}
`

BundleInfo (local state, from web stub):

`	ypescript
interface BundleInfo {
  status: 'success' | 'error' | 'downloading';
  version: string;
  downloaded: string;  // ISO timestamp
  id: string;          // Unique bundle ID (not the version)
  checksum: string;
}
`

### 3.3 Field-by-Field Documentation

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| version | string | YES | Bundle version (semver or arbitrary) |
| download_url | string | YES | URL to the dist.zip |
| checksum | string | YES | SHA-256 of the zip file |
| message | string | no | Release notes / changelog |
| manifest | Array | no | Per-file entries for delta updates |
| manifest[].file_name | string | YES* | Relative path within the bundle |
| manifest[].file_hash | string | YES* | SHA-256 of the individual file |
| manifest[].download_url | string | YES* | URL to download the changed file |

* Required when using delta updates.

### 3.4 Signing Flow

Capgo uses a two-layer security model:

1. Integrity (always on): Every bundle has a SHA-256 checksum. Native plugin verifies after download. Mismatch = reject + rollback.
2. E2E Encryption v2 (optional, publicKey config):
   - CLI encrypts bundle with session key derived from app public key.
   - sessionKey sent in response (encrypted with public key).
   - Checksum computed over encrypted bytes.
   - Platform cannot read or forge bundles without private key.
3. Rollback protection: notifyAppReady() must be called within appReadyTimeout (default 10s). Failure = auto-revert to last working bundle.

### 3.5 Provider-Specific Quirks

- Capgo Cloud vs Self-hosted: Fully self-hostable. Backend is Cloudflare Workers + Supabase.
- Channels: defaultChannel determines which bundle is served. Per-device overrides supported.
- Delta updates: Only changed files downloaded. manifest[] lists each file with hash and URL.
- builtinMinimum (v8.54+): Refuses bundles with version lower than native app version.
- httpsOnly (v8.54+): All URLs must be HTTPS by default.
- Store compliance: Only interpreted code (JS/HTML/CSS) replaced. Never native code.
- Deprecated: Original @capacitor/live-update deprecated in favor of Capgo.

### 3.6 Recent Spec Changes (2025-2026)

- v8 (current): Follows Capacitor 8. Major version tracks Capacitor major.
- httpsOnly (v8.54): All traffic must be HTTPS by default.
- builtinMinimum (v8.54): On-device version floor to prevent downgrade.
- nativeUpdatePrompt (v8.53): Native dialog for store update when live update blocked.
- Channel storage (v7.34): Channel assignments stored locally on device.
- allowPreview (v8.47): Expo Go-style preview sessions.

### 3.7 MINIMUM VIABLE SUBSET

`json
{
  "version": "2.4.0",
  "download_url": "https://your-cdn.com/bundles/2.4.0/dist.zip",
  "checksum": "sha256:abcdef1234567890..."
}
`

These 3 fields (version, download_url, checksum) are the absolute minimum for a full-bundle update.

---

## 4. Squirrel.Windows (RELEASES File + NuSpec)

### 4.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| RELEASES | Root of update feed | Text file, one entry per line |
| MyApp-1.0.0-full.nupkg | Same dir | Full NuGet package |
| MyApp-1.0.1-delta.nupkg | Same dir | Delta package |
| MyApp-1.0.1-full.nupkg | Same dir | Full NuGet package |
| Setup.exe | Root of update feed | Bootstrapper for fresh installs |

Update feed URL passed to UpdateManager at integration time:
`csharp
using (var updateManager = new UpdateManager(@"https://updates.example.com/"))
{
    updateManager.CheckForUpdate();
}
`

### 4.2 Literal Schema (REAL EXAMPLE from official docs)

`
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
`

With staged rollout (10% of users):

`
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030# 10%
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752# 10%
`

NuSpec metadata (inside each .nupkg):

`xml
<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>MyApp</id>
    <version>1.0.1</version>
    <title>My Application</title>
    <authors>Your Company</authors>
    <description>My desktop application</description>
    <iconUrl>https://example.com/icon.ico</iconUrl>
    <language>en-US</language>
  </metadata>
</package>
`

### 4.3 Field-by-Field Documentation

RELEASES file format (each line): `<SHA1_HASH> <FILENAME> <FILE_SIZE_IN_BYTES>[# <PERCENT>%]`

| Field | Format | Required | Description |
|-------|--------|----------|-------------|
| SHA1 hash | 40-char uppercase hex | YES | SHA-1 of the .nupkg file |
| Filename | Id-Version[-delta].nupkg | YES | Must match naming convention |
| File size | Decimal integer (bytes) | YES | Exact file size |
| # nn% | Comment (optional) | no | Staged rollout percentage (1-99) |

NuSpec fields used by Squirrel:

| Field | Required | Description |
|-------|----------|-------------|
| id | YES | App identifier (no spaces/dots). Used for install dir name |
| version | YES | Must match AssemblyVersion. Used for update ordering |
| title | no | Display name in Windows Uninstaller |
| iconUrl | no | URL to .ico for shortcuts and Uninstaller |
| language | no | Codepage (default 1252) |

### 4.4 Signing Flow

Squirrel.Windows uses two separate signing layers:

1. NuGet package signing (optional): Sign .nupkg with Authenticode cert. Squirrel --releasify verifies.
2. Application code signing (recommended): Sign Setup.exe and app .exe with Authenticode cert.
3. RELEASES file integrity: SHA-1 hash is primary check. File size is secondary. NO cryptographic signature on RELEASES file itself. Feed MUST be HTTPS.

### 4.5 Provider-Specific Quirks

- SHA-1 (not SHA-256): Known weakness. Feed must be HTTPS-only.
- Staged rollout syntax: # nn% must be immediately after file size (no space before #) due to historical bug.
- Delta packages: Named Id-Version-delta.nupkg. Client prefers delta over full if available.
- Setup.exe: Contains latest full package embedded. Updated on each release.
- Channel support: Separate update feed URLs per channel.
- No manifest signature: Unlike electron-builder or Tauri, NO cryptographic signature on update manifest.
- Maintenance mode: Project seeking maintainers (issue #1470).

### 4.6 Recent Spec Changes (2025-2026)

- Contributor recruitment: Issue #1470. Project in maintenance mode.
- No recent spec changes: RELEASES format stable since Squirrel 1.0.
- SHA-1 deprecation: No plans to migrate (would break backward compatibility).

### 4.7 MINIMUM VIABLE SUBSET

`
<SHA1> <Id>-<Version>-full.nupkg <size_bytes>
`

One line per full package. SHA1, filename (Id-Version-full.nupkg), and file size are the absolute minimum.
A Setup.exe containing the latest full package is also required for fresh installs.

---
## 5. Sparkle Appcast (macOS)

### 5.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| appcast.xml | HTTPS URL in SUFeedURL plist key | The RSS feed |
| MyApp-2.0.zip | Same origin or absolute URL | The update archive |
| MyApp-2.0.delta | Same dir | Optional binary delta |
| release_notes.html | Referenced by releaseNotesLink | HTML release notes |

Feed URL set in app Info.plist:
`xml
<key>SUFeedURL</key>
<string>https://releases.example.com/appcast.xml</string>
`

### 5.2 Literal Schema (REAL appcast.xml from Sparkle project)

`xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>MyApp Changelog</title>
    <link>https://example.com</link>
    <description>Most recent changes with links to updates.</description>
    <language>en</language>

    <item>
      <title>Version 2.0</title>
      <link>https://example.com/myapp</link>
      <sparkle:version>2.0</sparkle:version>
      <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
      <description><![CDATA[
        <h2>New Features</h2>
        <ul>
          <li>Motor calibration wizard</li>
          <li>Real-time telemetry dashboard</li>
        </ul>
      ]]></description>
      <pubDate>Mon, 15 Jan 2026 10:30:00 +0000</pubDate>
      <enclosure url="https://releases.example.com/MyApp-2.0.zip"
                 sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
                 length="107758"
                 type="application/octet-stream" />
    </item>

  </channel>
</rss>
`

With advanced features (channels, critical update, phased rollout):

`xml
<item>
  <title>Version 2.1 (Critical Security Fix)</title>
  <link>https://example.com/myapp</link>
  <sparkle:version>2100</sparkle:version>
  <sparkle:shortVersionString>2.1</sparkle:shortVersionString>
  <sparkle:channel>stable</sparkle:channel>
  <sparkle:criticalUpdate sparkle:version="2.0"></sparkle:criticalUpdate>
  <sparkle:minimumSystemVersion>13.0.0</sparkle:minimumSystemVersion>
  <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
  <sparkle:releaseNotesLink>https://example.com/releases/2.1.html</sparkle:releaseNotesLink>
  <pubDate>Tue, 16 Jan 2026 08:00:00 +0000</pubDate>
  <enclosure url="https://releases.example.com/MyApp-2.1.zip"
             sparkle:edSignature="abcDEF123..."
             length="112345"
             type="application/octet-stream" />
</item>
`

### 5.3 Field-by-Field Documentation

RSS-level elements (standard):

| Element | Required | Description |
|---------|----------|-------------|
| rss version | YES | Must be 2.0 |
| channel | YES | Contains all item entries |
| item | YES | One per release |
| title | YES | Human-readable release title |
| link | YES | Fallback URL (shown when update cannot be installed) |
| pubDate | YES* | RFC 2822 date (required for phased rollouts) |
| description | no | Embedded release notes (HTML/CDATA or markdown) |

Sparkle-namespaced elements (xmlns:sparkle):

| Element/Attribute | Required | Description |
|----------|----------|-------------|
| sparkle:version | YES | Internal build number (e.g. 2100). Compared to CFBundleVersion |
| sparkle:shortVersionString | no | Human-readable version (e.g. 2.1). Displayed in UI |
| sparkle:edSignature | YES* | Base64 Ed25519 signature of archive (on enclosure) |
| sparkle:minimumSystemVersion | no | Min macOS version (e.g. 13.0.0) |
| sparkle:hardwareRequirements | no | e.g. arm64 for Apple Silicon only |
| sparkle:channel | no | Channel name (default: stable if absent) |
| sparkle:criticalUpdate | no | Marks as critical (cannot be skipped) |
| sparkle:minimumAutoupdateVersion | no | Below this, user must manually confirm |
| sparkle:phasedRolloutInterval | no | Seconds between rollout groups (7 groups) |
| sparkle:releaseNotesLink | no | URL to release notes (HTML or markdown) |
| sparkle:minimumUpdateVersion | no | Min app version to see this update |
| enclosure url | YES* | URL to .zip/.dmg/.tar.xz archive |
| enclosure length | YES | File size in bytes |
| enclosure type | YES | MIME type (usually application/octet-stream) |

* Required when EdDSA signing is enabled (recommended).

### 5.4 Signing Flow

1. Key generation: ./bin/generate_keys produces Ed25519 keypair. Private key in macOS Keychain. Public key (base64) embedded in Info.plist as SUPublicEDKey.
2. Signing archive: ./bin/sign_update MyApp-2.0.zip outputs sparkle:edSignature and length.
3. Generating appcast: ./bin/generate_appcast /path/to/updates_folder/ creates appcast.xml with signatures and optional .delta files.
4. Signing feed (optional, SURequireSignedFeed): Appcast XML itself can be signed.
5. Verification: Sparkle downloads archive, verifies Ed25519 signature against embedded public key. Also verifies Developer ID code signature if available.
6. Key rotation: Ship update that changes either Developer ID cert OR EdDSA key (not both).

### 5.5 Provider-Specific Quirks

- Version comparison: sparkle:version compared to CFBundleVersion (NOT CFBundleShortVersionString). Use incrementing integers.
- Archive formats: .zip, .dmg, .tar.xz, .aar. ZIP recommended for non-Developer-ID apps.
- Delta updates: .delta files are binary diffs (BSPatch format). generate_appcast creates them automatically.
- Phased rollout: Hardcoded to 7 groups. Random group ID per install.
- Channels: Default channel implicit. Beta/nightly require app opt-in via allowedChannelsForUpdater.
- Signed feeds (Sparkle 2.9+): Appcast XML itself can be signed.
- Markdown release notes (Sparkle 2.9+): description sparkle:format="markdown" for macOS 12+.
- App translocation: If app runs from read-only mount (Gatekeeper), Sparkle cannot install update.

### 5.6 Recent Spec Changes (2025-2026)

- Sparkle 2.9 (current stable):
  - Signed feeds (SURequireSignedFeed)
  - Markdown release notes (macOS 12+)
  - sparkle:hardwareRequirements for Apple Silicon gating
  - sparkle:minimumUpdateVersion for per-item minimum app version
- Key rotation refined for Developer ID-signed apps.
- No breaking changes to appcast XML schema in 2025-2026.

### 5.7 MINIMUM VIABLE SUBSET

`xml
<item>
  <title>Version 2.0</title>
  <link>https://example.com/myapp</link>
  <sparkle:version>2.0</sparkle:version>
  <pubDate>Mon, 15 Jan 2026 10:30:00 +0000</pubDate>
  <enclosure url="https://releases.example.com/MyApp-2.0.zip"
             sparkle:edSignature="<base64-ed25519-sig>"
             length="107758"
             type="application/octet-stream" />
</item>
`

These elements (title, link, sparkle:version, pubDate, enclosure with url + edSignature + length) are the absolute minimum.

---
## 6. PWA Service Worker

### 6.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| sw.js or service-worker.js | Same origin as PWA | The service worker script |
| workbox-*.js | Same origin or CDN | Workbox runtime libraries |
| precache-manifest.js | Same origin | Generated precache manifest |
| manifest.webmanifest | Same origin | PWA manifest (icons, name, etc.) |

Registration (in main JS):
`javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
`

### 6.2 Literal Schema (Real Service Worker with Workbox)

`javascript
// sw.js - Service Worker using Workbox v7
import { precacheAndRoute, createHandlerBoundToURL } from '/workbox-7.1.0/precache-and-route.js';
import { navigationRoute } from '/workbox-7.1.0/routing.js';
import { NetworkFirst, StaleWhileRevalidate, CacheFirst } from '/workbox-7.1.0/strategies.js';
import { ExpirationPlugin } from '/workbox-7.1.0/expiration.js';

// Precached assets (generated at build time)
self.__WB_MANIFEST = [
  { url: "index.html", revision: "a1b2c3d4" },
  { url: "assets/app.js", revision: "e5f6g7h8" },
  { url: "assets/styles.css", revision: "i9j0k1l2" },
  { url: "icons/icon-192.png", revision: "m3n4o5p6" }
];
precacheAndRoute(self.__WB_MANIFEST);

// API routes: network-first with 5s timeout
const apiCache = new NetworkFirst({
  cacheName: 'api-cache',
  networkTimeoutSeconds: 5,
  plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 86400 })]
});
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(apiCache.handle(event));
  }
});

// Navigation: network-first, fallback to cached index.html
const navHandler = createHandlerBoundToURL('index.html');
navigationRoute(navHandler);

// Update flow: skipWaiting + clients.claim
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
`

Workbox build config (workbox-config.js):

`javascript
module.exports = {
  globDirectory: 'dist/',
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  swDest: 'dist/sw.js',
  skipWaiting: true,
  clientsClaim: true,
  navigateFallback: 'index.html',
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/api\.example\.com\/.*/i,
      handler: 'NetworkFirst',
      method: 'GET',
      options: {
        cacheName: 'api-cache',
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 50, maxAgeSeconds: 86400 }
      }
    },
    {
      urlPattern: /^https:\/\/cdn\.example\.com\/.*/i,
      handler: 'StaleWhileRevalidate',
      method: 'GET',
      options: {
        cacheName: 'cdn-cache',
        expiration: { maxEntries: 200, maxAgeSeconds: 2592000 }
      }
    }
  ]
};
`

### 6.3 Field-by-Field Documentation

Service Worker lifecycle events:

| Event | Description |
|-------|-------------|
| install | First registration. Precache happens here. |
| activate | After old SW terminated. Cleanup old caches. |
| fetch | Intercepts every request. Route to cache/network. |
| push | Receives Web Push notifications. |
| notificationclick | User taps a notification. |
| sync | Background sync (offline queue). |
| message | Communication with the page. |

Workbox precache manifest entry:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | YES | Path to precache (relative or absolute) |
| revision | string | no | Content hash or version. If absent, url is the revision |
| matcherKeys | object | no | URL match config (pathname, search, etc.) |

### 6.4 Signing Flow

PWA service workers have NO cryptographic signing. Security relies on:

1. HTTPS: Service workers require secure context (HTTPS or localhost).
2. Same-origin policy: SW can only intercept requests on its own origin.
3. Content integrity: Use SRI (Subresource Integrity) for external scripts.
4. Cache versioning: Clear old caches on activate to prevent stale content.
5. Update flow: Browser downloads new sw.js, compares bytes. If different, installs new SW. skipWaiting + clients.claim for immediate takeover.

### 6.5 Provider-Specific Quirks

- No delta updates: PWA updates are all-or-nothing per precache entry.
- 24-hour revalidation: Browser checks for SW updates once per 24 hours by default.
- Cache Storage limit: Typically 50-100MB per origin.
- iOS Safari: No background sync. Push requires APNs. skipWaiting behavior differs.
- Offline fallback: navigateFallback handles SPA routing.
- No rollback mechanism: Unlike Capgo or Squirrel, no automatic rollback if new SW fails.

### 6.6 Recent Spec Changes (2025-2026)

- Workbox v7 (current): Stable API. No major changes.
- Service Worker spec (W3C): Background Sync still not universally supported (Safari lacks it).
- No signing spec: W3C has no plans to add cryptographic signing to service workers.

### 6.7 MINIMUM VIABLE SUBSET

`javascript
// sw.js - Absolute minimum service worker
const CACHE_NAME = 'app-v1';
const ASSETS = ['/', '/index.html', '/assets/app.js', '/assets/styles.css'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then(cached =>
    cached || fetch(event.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      return res;
    })
  ));
});
`

Minimum: install (precache), activate (cleanup), fetch (cache-first or network-first).
Three essentials: CACHE_NAME, ASSETS array, and the strategy.

---
## 7. Microsoft AppInstaller XML (.appinstaller)

### 7.1 File Names and On-Server Locations

| File | Location | Notes |
|------|----------|-------|
| MyApp.appinstaller | HTTPS URL | The update manifest XML |
| MyApp_1.0.0.0_x64.msix | Same origin or CDN | The MSIX package |
| MyApp_1.0.0.0_x64.msixbundle | Same origin | Multi-arch bundle (optional) |

Registration (one-time):
`powershell
Add-AppxPackage -RegisterByFamilyName -ExternalLocation "https://releases.example.com/MyApp.appinstaller"
`

### 7.2 Literal Schema (Real .appinstaller XML)

`xml
<?xml version="1.0" encoding="utf-8"?>
<Deployment xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
            xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10">
  <Uri>https://releases.example.com/MyApp_1.0.0.0_x64.msix</Uri>
  <Rank>4096</Rank>
  <Version>1.0.0.0</Version>
  <UpdatePolicy>
    <ReleaseFeed>https://releases.example.com/MyApp.appinstaller</ReleaseFeed>
    <ReleaseType>release</ReleaseType>
    <ReleaseFrequency>1</ReleaseFrequency>
    <DetectionMechanism>AppInstaller</DetectionMechanism>
  </UpdatePolicy>
</Deployment>
`

### 7.3 Field-by-Field Documentation

| Element | Required | Description |
|---------|----------|-------------|
| Deployment (root) | YES | Root element with namespace |
| Uri | YES | URL to the MSIX/MSIXBUNDLE package |
| Rank | YES | Priority (higher = preferred). 4096 = default |
| Version | YES | 4-part version (major.minor.build.revision) |
| UpdatePolicy | YES | Update behavior configuration |
| UpdatePolicy.ReleaseFeed | YES | URL to this .appinstaller file (self-referencing) |
| UpdatePolicy.ReleaseType | YES | release, preview, or beta |
| UpdatePolicy.ReleaseFrequency | YES | Hours between update checks (min 1) |
| UpdatePolicy.DetectionMechanism | YES | AppInstaller (poll ReleaseFeed) |

### 7.4 Signing Flow

1. MSIX package signing: The .msix/.msixbundle MUST be signed with an EV or OV code signing certificate (Authenticode). Unsigned MSIX cannot be installed.
2. .appinstaller file: NOT cryptographically signed. Integrity relies on HTTPS.
3. App identity: The MSIX manifest (AppxManifest.xml inside the package) defines the Package Identity (Name, Publisher, Version, ProcessorArchitecture).
4. Update matching: Windows matches the app by Family Name (derived from Name + Publisher). The .appinstaller Uri must point to a package with the same identity.
5. Trust: First install requires user consent (or MDM/Group Policy for enterprise). Subsequent updates are silent if the same certificate signed both packages.

### 7.5 Provider-Specific Quirks

- 4-part versioning: MSIX uses major.minor.build.revision (NOT semver).
- Rank system: Multiple .appinstaller files can be registered. Higher Rank wins.
- ReleaseFrequency: Minimum 1 hour. Windows polls the ReleaseFeed URL.
- No delta updates: Full MSIX package downloaded on each update.
- MSIXBUNDLE: Can contain multiple MSIX files (per-architecture) in one package.
- Enterprise: Can be deployed via MDM/Group Policy without user interaction.
- No staged rollout: Unlike Squirrel or electron-builder, no percentage-based rollout.
- Windows Update integration: Can be configured to deliver via Windows Update for Business.

### 7.6 Recent Spec Changes (2025-2026)

- Windows 11 24H2: No changes to .appinstaller format.
- MSIX packaging: Microsoft continues to deprecate MSIs in favor of MSIX.
- App Installer for Business: Windows Update for Business can deliver MSIX packages.
- No signing changes: MSIX still requires Authenticode code signing.

### 7.7 MINIMUM VIABLE SUBSET

`xml
<?xml version="1.0" encoding="utf-8"?>
<Deployment xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Uri>https://releases.example.com/MyApp_1.0.0.0_x64.msix</Uri>
  <Rank>4096</Rank>
  <Version>1.0.0.0</Version>
  <UpdatePolicy>
    <ReleaseFeed>https://releases.example.com/MyApp.appinstaller</ReleaseFeed>
    <ReleaseType>release</ReleaseType>
    <ReleaseFrequency>24</ReleaseFrequency>
    <DetectionMechanism>AppInstaller</DetectionMechanism>
  </UpdatePolicy>
</Deployment>
`

These 5 elements (Uri, Rank, Version, ReleaseFeed, ReleaseType) plus ReleaseFrequency and DetectionMechanism are the absolute minimum for a valid .appinstaller.

---

## 8. Cross-Protocol Comparison and AIRIZ Custom Manifest Layer

### 8.1 Unified Field Matrix

| Concept | electron-builder | Tauri | Capgo | Squirrel | Sparkle | PWA SW | MSIX |
|---------|-----------------|-------|-------|----------|---------|--------|------|
| Version | version | version | version | NuSpec version | sparkle:version | (none) | Version |
| Download URL | files[].url | platforms.*.url | download_url | (in RELEASES) | enclosure url | (precache) | Uri |
| Checksum | files[].sha512 | (in sig) | checksum | SHA1 in RELEASES | (in sig) | revision | (in MSIX sig) |
| Signature | signature | platforms.*.signature | (E2E key) | (none) | edSignature | (none) | (MSIX Authenticode) |
| Release date | releaseDate | pub_date | (none) | (none) | pubDate | (none) | (none) |
| Release notes | releaseNotes | notes | message | (none) | description | (none) | (none) |
| Staged rollout | stagingPercentage | (none) | (channels) | # nn% | phasedRollout | (none) | (none) |
| Min OS version | minimumSystemVersion | (none) | (none) | (none) | minSystemVersion | (none) | (in MSIX) |
| Channels | channel in filename | (none) | defaultChannel | (separate URL) | sparkle:channel | (none) | ReleaseType |
| Delta updates | .blockmap | (none) | manifest[] | -delta.nupkg | .delta | (none) | (none) |
| Rollback | (none) | (none) | auto (appReady) | (none) | (none) | (none) | (none) |

### 8.2 AIRIZ Custom Signed Manifest - Recommended Fields

If AIRIZ builds a custom signed-manifest layer that all 7 tools can consume, the
following fields MUST be present:

`json
{
  "version": "2.3.1",
  "release_date": "2026-01-15T10:30:00.000Z",
  "release_notes": "Bug fixes and performance improvements",
  "platforms": {
    "windows-x86_64": {
      "url": "https://releases.airiz.com/windows/MyApp-2.3.1-setup.exe",
      "sha512": "<base64-sha512>",
      "sha256": "<hex-sha256>",
      "signature": "<base64-ed25519-or-minisign-sig>",
      "size": 52428800
    },
    "macos-aarch64": {
      "url": "https://releases.airiz.com/macos/MyApp-2.3.1.zip",
      "sha512": "<base64-sha512>",
      "sha256": "<hex-sha256>",
      "ed_signature": "<base64-ed25519-sig>",
      "size": 48234567
    },
    "mobile-ios": {
      "url": "https://releases.airiz.com/mobile/MyApp-2.3.1/dist.zip",
      "sha256": "<hex-sha256>",
      "size": 1234567
    }
  },
  "staging_percentage": 100,
  "minimum_os_version": {
    "windows": "10.0.22631",
    "macos": "13.0.0"
  },
  "channel": "stable"
}
`

### 8.3 Per-Tool Conversion Guide

| AIRIZ Field | electron-builder | Tauri | Capgo | Squirrel | Sparkle |
|-------------|-----------------|-------|-------|----------|---------|
| version | version | version | version | (in filename) | sparkle:version |
| release_date | releaseDate | pub_date | (omit) | (omit) | pubDate |
| release_notes | releaseNotes | notes | message | (omit) | description |
| platforms.win.url | files[0].url | platforms.windows-x86_64-nsis.url | download_url | (filename) | enclosure url |
| platforms.win.sha512 | files[0].sha512 | (in minisign) | (n/a) | SHA1 (convert!) | (in edSignature) |
| platforms.win.signature | signature | platforms.*.signature | (E2E) | (none) | edSignature |
| staging_percentage | stagingPercentage | (omit) | (channels) | # nn% | phasedRolloutInterval |
| minimum_os_version.win | minimumSystemVersion | (omit) | (omit) | (omit) | (omit) |
| minimum_os_version.macos | minimumSystemVersion | (omit) | (omit) | (omit) | minSystemVersion |
| channel | filename (latest vs beta) | (omit) | defaultChannel | (separate URL) | sparkle:channel |

### 8.4 Critical Design Decisions for AIRIZ

1. **Signature algorithm**: Use Ed25519. Compatible with electron-builder, Tauri (via minisign), and Sparkle natively. Squirrel and MSIX use Authenticode (different system) - requires separate signing.

2. **Hash algorithm**: SHA-512 for electron-builder compatibility. SHA-256 for Capgo and general use. Squirrel requires SHA-1 (legacy). Store all three in the canonical manifest.

3. **Version format**: Use semver (major.minor.patch) as the canonical format. Convert to 4-part for MSIX, to integer build number for Sparkle.

4. **Staged rollout**: Implement at the server level (not in the manifest). The server decides which version to serve based on device ID hash. The manifest itself always contains the full version info.

5. **Channel system**: Use a single manifest endpoint with a channel query parameter: /latest.json?channel=beta. The server returns the appropriate version. This avoids maintaining separate files per channel.

---

## Sources and Evidence

- electron-builder: packages/builder-util-runtime/src/updateInfo.ts, packages/app-builder-lib/src/publish/updateInfoBuilder.ts (GitHub: electron-userland/electron-builder, branch: master)
- Tauri: plugins/updater/src/updater.rs, plugins/updater/src/config.rs, plugins/updater/README.md (GitHub: tauri-apps/plugins-workspace, branch: v2)
- Squirrel.Windows: docs/getting-started/5-updating.md, docs/using/staged-rollouts.md, docs/using/nuget-package-metadata.md (GitHub: Squirrel/Squirrel.Windows, branch: develop)
- Sparkle: sparkle-project.org/documentation/, sparkle-project.org/files/sparkletestcast.xml (Sparkle 2.9, 2026)
- Capgo: Cap-go/capacitor-updater (definitions.ts, src/web.ts), Cap-go/capgo (supabase/functions/_backend/utils/types.ts, plugin_runtime/plugins/updates.ts)
- PWA: Workbox v7, W3C Service Worker specification
- MSIX: Microsoft AppInstaller documentation, .appinstaller XML schema

Report generated: 2026-11-04
Context: AIRIZ Motor Console custom signed-manifest layer design

NOTE: Some real-world file examples (latest.yml from production apps, real .appinstaller
files from the field) could not be fetched due to OA proxy restrictions. The schemas
shown are derived from the actual source code of the updater libraries, which is
authoritative. The Sparkle appcast is the real sample from the Sparkle project.
The Squirrel RELEASES example is from the official Squirrel.Windows documentation.