# AIRIZ Motor Console — Unified Update Manifest Protocol
## Research Report: 8-Updater Protocol Spec Compilation & Minimum Viable Subset

**Date**: 2026-11-05
**Status**: Final
**Target**: AIRIZ Motor Console (Electron Win + Capacitor Android/iOS + PWA SW + Cloudflare Worker)
**Manifest hosting**: Cloudflare R2 + signed (Ed25519)

---

## Table of Contents

1. Protocol 1: electron-builder NSIS latest.yml
2. Protocol 2: Tauri 2.x Updater
3. Protocol 3: Capacitor Live Update (Capawesome)
4. Protocol 4: Squirrel.Windows RELEASES
5. Protocol 5: Sparkle Appcast XML
6. Protocol 6: PWA Service Worker Lifecycle (W3C)
7. Protocol 7: Microsoft AppInstaller
8. Protocol 8: Workbox Precache Manifest
9. Cross-Protocol Comparison Matrix
10. Discrepancies Found (User Claims vs. Reality)
11. AIRIZ Unified Manifest — Minimum Viable Subset
12. Sample Signed Manifest JSON
13. Signing & Verification Procedure
14. Source Citations

---

## Protocol 1: electron-builder

### Spec Version
- **electron-builder v27+** (2025-2026)
- Source: `electron-userland/electron-builder` -> `website/docs/features/auto-update.md`
- Signed manifests: `website/docs/features/signed-update-manifests.md`

### File Format: `latest.yml` (YAML)

```yaml
# Required
version: "2.1.0"

# Required (v27+; replaces legacy top-level path/sha512)
files:
  - url: "AIRIZ-Setup-2.1.0.exe"
    sha512: "a1b2c3d4...="
    size: 45234176
    blockMapUrl: "AIRIZ-Setup-2.1.0.exe.blockmap"

# Optional (v27+): deterministic staged rollout 0-100
stagingPercentage: 25

# Optional (v27+): Ed25519 signature over the manifest body (base64)
signature: "MEUCIQDx...="

# Optional (v27+): multi-key signatures
signatures:
  - keyId: "prod-2026-01"
    signature: "MEUCIQDx...="
  - keyId: "prod-2025-01"
    signature: "MEUCIQDy...="
```

### Field Reference

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `version` | string (semver) | YES | Must match installer internal version |
| `files` | array | YES (v27+) | One entry per architecture/artifact |
| `files[].url` | string (relative URL) | YES | Resolved against feed URL base |
| `files[].sha512` | string (base64) | YES | SHA-512 of the file, base64-encoded |
| `files[].size` | integer (bytes) | YES | Exact file size |
| `files[].blockMapUrl` | string (relative URL) | Optional | For differential/blockmap updates |
| `stagingPercentage` | integer 0-100 | Optional | Deterministic UUID-based cohort |
| `signature` | string (base64) | Optional (v27) | Ed25519 sig over canonicalized manifest |
| `signatures[]` | array | Optional | Multi-key: [{ keyId, signature }] |

### Key Notes

- **Legacy path/sha512 at top level**: removed by default in v27. Use `files[]` array.
- **Signing strongly recommended** in v27+; publishing without a key emits a warning.
- **Staging algorithm**: `UUID.parse(stagingUserId).readUInt32BE(12) / 0xFFFFFFFF` compared against percentage.
- **Blockmap files**: `.blockmap` contains per-64KiB-block SHA-256 hashes for incremental download.
- **Feed URL pattern**: `<server>/latest.yml` (default).

### Update Check Flow

```
1. GET {feedUrl}/latest.yml
2. Parse YAML -> { version, files[], stagingPercentage, signature }
3. If signature present -> verify Ed25519
4. Compare version (semver) against current
5. If newer AND in staging cohort:
   a. Select matching files[] entry (by arch/platform)
   b. GET files[0].url -> stream to temp
   c. Verify SHA-512
   d. (Optional) blockmap diff for partial download
   e. Run installer (NSIS)
```

---

## Protocol 2: Tauri 2.x Updater

### Spec Version
- **Tauri v2** (2024-2026), `tauri-apps/plugins-workspace` v2
- Source: `tauri-apps/plugins-workspace/v2/plugins/updater/src/updater.rs`
- Config: `tauri-apps/plugins-workspace/v2/plugins/updater/src/config.rs`
- Docs: `tauri.app/plugin/updater/`

### File Format: JSON (served at endpoint URL)

#### Single-Platform Manifest

```json
{
  "version": "2.1.0",
  "notes": "Bug fixes and performance improvements.",
  "pub_date": "2026-11-05T08:30:00+08:00",
  "url": "https://r2.airiz.com/updates/AIRIZ-Setup-2.1.0.exe",
  "signature": "base64minisignsignature..."
}
```

#### Multi-Platform Manifest

```json
{
  "version": "2.1.0",
  "notes": "Bug fixes and performance improvements.",
  "pub_date": "2026-11-05T08:30:00+08:00",
  "platforms": {
    "windows-x86_64-nsis": {
      "url": "https://r2.airiz.com/updates/AIRIZ-Setup-2.1.0.exe",
      "signature": "base64minisignsig..."
    },
    "windows-x86_64-msi": {
      "url": "https://r2.airiz.com/updates/AIRIZ-2.1.0.msi",
      "signature": "base64minisignsig..."
    },
    "darwin-aarch64-app": {
      "url": "https://r2.airiz.com/updates/AIRIZ_2.1.0_aarch64.app.tar.gz",
      "signature": "base64minisignsig..."
    },
    "linux-x86_64-appimage": {
      "url": "https://r2.airiz.com/updates/AIRIZ-2.1.0-x86_64.AppImage",
      "signature": "base64minisignsig..."
    }
  }
}
```

### Field Reference (Rust struct to JSON)

| JSON Field | Rust Type | Required | Notes |
|------------|-----------|----------|-------|
| `version` | `semver::Version` | YES | Strict semver |
| `notes` | `Option<String>` | NO | Release notes (Markdown) |
| `pub_date` | `Option<OffsetDateTime>` | NO | RFC 3339 timestamp |
| `url` | `String` | Conditional | Required if single-platform |
| `signature` | `String` | Conditional | Minisign Ed25519, base64 |
| `platforms` | `HashMap<String, PlatformRelease>` | Conditional | Required if multi-platform |
| `platforms.*.url` | `String` | YES | Per-platform download URL |
| `platforms.*.signature` | `String` | YES | Per-platform Minisign Ed25519 base64 |

### Platform Key Format

`{os}-{arch}-{bundle_type}` with fallback to `{os}-{arch}`

| Component | Values |
|-----------|--------|
| `os` | `darwin`, `linux`, `windows` |
| `arch` | `aarch64`, `x86_64`, `i686`, `armv7` |
| `bundle_type` | `appimage`, `deb`, `rpm`, `app`, `msi`, `nsis` |

### Client Configuration (tauri.conf.json -> plugins.updater)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `endpoints` | `string[]` | `[]` | Checked in order; first valid response wins |
| `pubkey` | `string` | - | Minisign public key (embedded at compile time) |
| `dangerousInsecureTransportProtocol` | `bool` | `false` | Allow http (dev only) |
| `dangerousAcceptInvalidCerts` | `bool` | `false` | Skip TLS cert verification |
| `dangerousAcceptInvalidHostnames` | `bool` | `false` | Skip hostname verification |
| `requireSignedVersion` | `bool` | `false` | Reject manifest without signature |
| `allowDowngrades` | `bool` | `false` | Accept lower versions |
| `windows.installerArgs` | `string[]` | `[]` | Extra NSIS installer arguments |
| `windows.installMode` | `"basicUi"|"quiet"|"passive"` | `"passive"` | NSIS install style |

### Endpoint URL Placeholders

| Placeholder | Substituted With |
|-------------|-----------------|
| `{{target}}` | `{os}-{arch}` (e.g., `windows-x86_64`) |
| `{{current_version}}` | Current app semver |
| `{{arch}}` | CPU arch (e.g., `x86_64`) |
| `{{bundle_type}}` | Bundle format (e.g., `nsis`) |

### Key Notes

- **Signature**: Minisign Ed25519. Signed payload is the **entire installer file bytes**.
- **`data` field is an untagged enum**: parser tries single {url, signature} first, then {platforms: {...}}.
- **No staging/rollout percentage** built-in. Must be server-side.
- **Update check interval**: controlled by app developer (no built-in timer).

---

## Protocol 3: Capacitor Live Update (Capawesome)

### Spec Version
- **@capawesome/capacitor-live-update** (2024-2026)
- Source: `capawesome-team/capacitor-plugins` -> `packages/live-update/src/definitions.ts`
- Docs: `capgo.app/docs/`

### Architecture

Capacitor Live Update has a **two-artifact** model:
1. **Manifest** (JSON) — describes available bundles
2. **Bundle** (ZIP) — the actual JS/CSS/HTML payload

Both are stored on a backend (Capgo cloud or self-hosted) and downloaded by the native app.

### Self-Hosted Manifest: `DownloadBundleOptions`

```json
{
  "artifactType": "manifest",
  "bundleId": "bundle-2.1.0-abc123",
  "checksum": "a1b2c3d4e5f67890123456789012345678901234567890123456789012345678",
  "signature": "base64signedSHA256...",
  "url": "https://r2.airiz.com/capacitor/bundle-2.1.0-abc123.json"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `artifactType` | `'manifest' \| 'zip'` | YES | Which artifact type this entry describes |
| `bundleId` | `string` | YES | Unique identifier for the bundle |
| `checksum` | `string` (SHA-256 hex) | YES | 64-char hex SHA-256 of the file |
| `signature` | `string` (base64) | YES | RSA signature over the SHA-256 digest |
| `url` | `string` (absolute URL) | YES | Download URL |

### Plugin Configuration (LiveUpdate.init())

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `appId` | `string` | - | Application identifier on the server |
| `autoBlockRolledBackBundles` | `bool` | `false` | Auto-block bundles that caused rollback |
| `autoDeleteBundles` | `bool` | `false` | Delete old bundles after new one activates |
| `autoUpdateStrategy` | `'none' \| 'background'` | `'none'` | 'background' downloads silently |
| `defaultChannel` | `string` | `'Production'` | Initial channel |
| `httpTimeout` | `number` (ms) | `60000` | HTTP request timeout |
| `publicKey` | `string` (PEM) | - | RSA public key for signature verification |
| `readyTimeout` | `number` (ms) | `0` | Timeout for bundle ready signal |
| `serverDomain` | `string` | `https://api.liveupdate.capgo.app` | Backend API URL |

### Legacy Ionic Live Update Format (deprecated)

The older `capacitorjs.com` Live Update used a simpler format:

```json
[
  {
    "href": "https://example.com/bundle-1.0.0.zip",
    "sizeInBytes": 245760
  },
  {
    "href": "https://example.com/bundle-1.0.1.zip",
    "sizeInBytes": 246272
  }
]
```

> **Note**: This format has **no signature field**. It relies on HTTPS only.
> The Capawesome plugin is the current maintained solution.

### Key Notes

- **Signature scheme**: RSA (PEM public key), signature over the SHA-256 digest of the file.
- **No staging percentage**: rollout managed by Capgo backend (channel-based: Production, Staging, Alpha).
- **Bundle format**: ZIP containing the web app's `www/` directory contents.
- **Update check**: plugin polls `serverDomain` API for new bundles matching appId + channel.
- **Offline support**: bundles cached locally; app can run from last known-good bundle.

---

## Protocol 4: Squirrel.Windows RELEASES

### Spec Version
- **Squirrel.Windows** (github.com/Squirrel/Squirrel.Windows)
- Source: `src/Squirrel/ReleaseEntry.cs`, `docs/using/staged-rollouts.md`, `docs/using/delta-packages.md`

### File Format: `RELEASES` (plain text, one entry per line)

```
a3f2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0  AIRIZ-2.1.0.nupkg  45234176
b4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5  AIRIZ-2.0.0.nupkg  44891008
```

### Staged Rollout Format

```
a3f2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0  AIRIZ-2.1.0.nupkg  45234176#25%
```

The `#nn%` is appended **immediately after the size number with no space**. Legacy quirk from original implementation.

### Delta Package Format

Deltas identified by **filename suffix** `-delta.nupkg`:

```
c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6  AIRIZ-2.1.0-2.0.0-delta.nupkg  1048576
```

Inside a delta `.nupkg`, each bsdiff file has a sidecar `.shasum` file:
```
delta/main/Assets/index.html.diff
delta/main/Assets/index.html.diff.shasum
```

### Line Regex (from ReleaseEntry.cs)

```csharp
private static readonly Regex sReleaseEntryRegex =
    new(@"^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$", RegexOptions.Compiled);
```

### Field Reference

| Position | Field | Format | Notes |
|----------|-------|--------|-------|
| 1 | `SHA1` | 40 hex chars | SHA-1 hash of the .nupkg file |
| 2 | `Filename` | string (no spaces) | Package name, e.g., `AIRIZ-2.1.0.nupkg` |
| 3 | `Filesize` | decimal integer | Size in bytes |
| 3 (suffix) | `StagingPercentage` | `#nn%` | Optional, immediate suffix on filesize |

### ReleaseEntry Parsed Fields (C#)

```csharp
public string SHA1 { get; }
public string BaseUrl { get; }       // resolved from app + filename
public string Filename { get; }      // raw filename from line
public string Query { get; }         // URL query string (if any)
public long Filesize { get; }        // parsed decimal
public bool IsDelta { get; }         // true if filename contains "-delta."
public int StagingPercentage { get; } // 0 if not staged
```

### Key Notes

- **Hash algorithm**: SHA-1 (not SHA-256/512). Security weakness acknowledged in project.
- **No signature**: Squirrel relies on HTTPS + SHA-1 integrity only.
- **Staging**: RandomNumberGenerator-based hash of machine ID compared against percentage.
- **Delta detection**: `IsDelta = filename.Contains("-delta.")`. Delta applied via bsdiff.
- **File order**: Lines processed top-to-bottom; first entry is latest release.
- **Encoding**: UTF-8 (no BOM), CRLF or LF line endings.

---

## Protocol 5: Sparkle Appcast XML

### Spec Version
- **Sparkle 2.x** (sparkle-project.org)
- Source: `sparkle-project.org/documentation/publishing/`
- Signed sample: `sparkle-project.org/files/sparkletestcast-signed.xml`

### File Format: RSS 2.0 XML with `sparkle:` namespace

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>AIRIZ Motor Console</title>
    <link>https://airiz.com/</link>
    <description>Most recent application version</description>

    <item>
      <title>Version 2.1.0</title>
      <pubDate>Fri, 05 Nov 2026 08:30:00 +0800</pubDate>
      <sparkle:version>42</sparkle:version>
      <sparkle:shortVersionString>2.1.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>10.15</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink>
        https://airiz.com/releases/2.1.0.html
      </sparkle:releaseNotesLink>
      <enclosure url="https://r2.airiz.com/updates/AIRIZ-2.1.0.dmg"
                 sparkle:version="42"
                 sparkle:shortVersionString="2.1.0"
                 length="89128960"
                 type="application/octet-stream"
                 sparkle:edSignature="MEUCIQDx...base64..."/>
    </item>

    <item>
      <title>Version 2.0.0</title>
      <pubDate>Mon, 01 Sep 2026 10:00:00 +0800</pubDate>
      <sparkle:version>38</sparkle:version>
      <sparkle:shortVersionString>2.0.0</sparkle:shortVersionString>
      <enclosure url="https://r2.airiz.com/updates/AIRIZ-2.0.0.dmg"
                 sparkle:version="38"
                 sparkle:shortVersionString="2.0.0"
                 length="88481280"
                 type="application/octet-stream"
                 sparkle:edSignature="MEUCIQDy...base64..."/>
    </item>
  </channel>
</rss>
```

### Signed Feed (trailing XML comment)

```xml
</rss>
<!-- sparkle-signatures:
edSignature: MEUCIQDx...fullbase64signature...
length: 2048
-->
```

The `length` is the byte count from byte 0 to end of `</rss>` (exclusive of the comment). Signature covers those exact bytes.

### item Element Fields

| Element | Type | Required | Notes |
|---------|------|----------|-------|
| `title` | string | YES | Display title |
| `pubDate` | RFC 822 date | YES | Release date |
| `sparkle:version` | integer (CFBundleVersion) | YES | Monotonically increasing build number |
| `sparkle:shortVersionString` | string | Optional | Marketing version (e.g., "2.1.0") |
| `sparkle:releaseNotesLink` | URL | Optional | Link to release notes page |
| `sparkle:fullReleaseNotesLink` | URL | Optional | Full changelog URL |
| `sparkle:minimumSystemVersion` | string | Optional | Min macOS version |
| `sparkle:maximumSystemVersion` | string | Optional | Max macOS version |
| `sparkle:hardwareRequirements` | string | Optional | Hardware requirement (e.g., "arm64") |
| `sparkle:minimumAutoupdateVersion` | string | Optional | Min Sparkle framework version |
| `sparkle:phasedRolloutInterval` | integer (seconds) | Optional | Phased rollout duration |
| `sparkle:channel` | string | Optional | Release channel |
| `sparkle:criticalUpdate` | boolean | Optional | Force update (no skip) |
| `sparkle:informationalUpdate` | boolean | Optional | Info-only, no download |
| `sparkle:minimumUpdateVersion` | string | Optional | Block updates from below this version |
| `os` (attribute on item) | string | Optional | OS restriction (e.g., "macosx") |

### enclosure Attributes

| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| `url` | URL | YES | Download URL for the update archive |
| `length` | integer (bytes) | YES | File size |
| `type` | MIME string | YES | e.g., `application/octet-stream` |
| `sparkle:version` | integer | YES | Must match item sparkle:version |
| `sparkle:shortVersionString` | string | Optional | Must match item's |
| `sparkle:edSignature` | string (base64) | YES (signed) | Ed25519 signature over DMG/ZIP bytes |

### Key Notes

- **Versioning**: `sparkle:version` is an **integer** (CFBundleVersion), NOT semver. Numeric comparison.
- **Signature**: Ed25519 via `sparkle:edSignature`. Key embedded in app at compile time.
- **Phased rollout**: `sparkle:phasedRolloutInterval` = total duration in seconds. Deterministic hash of install ID for cohort.
- **Signed feed**: trailing comment provides feed integrity (prevents MITM injection of new items).
- **Archive format**: DMG (preferred) or ZIP. Sparkle extracts and installs the .app bundle.

---

## Protocol 6: PWA Service Worker (W3C)

### Spec Version
- **W3C Service Workers - Candidate Recommendation Draft, 29 October 2026**
- Source: `https://www.w3.org/TR/2026/CRD-service-workers-20261029/`
- Editor's Draft: `https://w3c.github.io/ServiceWorker/`
- Editors: Monica Chintala (Microsoft), Yoshisato Yanagisawa (Google)

### Worker Lifecycle States (Section 2.1)

Spec text: "A service worker has an associated state, which is one of `parsed`, `installing`, `installed`, `activating`, `activated`, and `redundant`. It is initially `parsed`."

### State Machine

```
  parsed --> installing --> installed --> activating --> activated
     |            |             |             |              |
     |            |             |             |              |
     v            v             v             v              v
  redundant    redundant    redundant    redundant      redundant
```

### State Transition Table

| From | Event | To | Notes |
|------|-------|-----|-------|
| `parsed` | Script fetched, parsed OK | `installing` | install event dispatched |
| `installing` | install handlers complete | `installed` | Worker waits for activation |
| `installed` | activate dispatched (clients closed or skipWaiting) | `activating` | activate event dispatched |
| `activating` | activate handlers complete | `activated` | Worker is active controller |
| any | Script fetch fails / parse error / throw | `redundant` | Worker terminated |
| `activated` | Replaced by new activated worker | `redundant` | Old worker cleaned up |

### Registration Roles (Section 2.3)

| Role | State | API Property |
|------|-------|--------------|
| Installing worker | `installing` | `registration.installing` |
| Waiting worker | `installed` | `registration.waiting` |
| Active worker | `activating` or `activated` | `registration.active` |

### Update Mechanism

The SW spec does **not define a manifest file**. Update mechanism:

1. **Browser-initiated**: On page load (or every 24h if stale), browser re-requests SW script URL.
2. **Comparison**: If response bytes differ (or ETag/Last-Modified changed), new worker created in `parsed` state.
3. **Stale threshold**: Registration is "stale" if `last_update_check_time` > **86400 seconds** (24h) ago.
4. **`updateViaCache` mode** (`"imports"` | `"all"` | `"none"`, default `"imports"`):
   - `"imports"`: SW script bypasses cache; imported scripts use cache
   - `"all"`: All requests during update check use cache
   - `"none"`: No cache during update check

### Developer-Triggered Update

```javascript
const reg = await navigator.serviceWorker.getRegistration();
await reg.update(); // Forces immediate re-fetch of SW script
```

### Precache (via install event)

```javascript
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('airiz-v2.1.0').then((cache) =>
      cache.addAll(['/', '/index.html', '/assets/app.js', '/assets/app.css'])
    )
  );
});
```

### Key Notes

- **No signature in spec**: W3C SW spec relies entirely on HTTPS/TLS. No Ed25519/RSA mechanism.
- **AIRIZ gap**: Must implement own verification layer (fetch manifest, verify signature, then instruct SW update).
- **No differential updates**: Full script re-download on every change.
- **No staging built-in**: Must be at CDN/manifest level.

---

## Protocol 7: Microsoft AppInstaller

### Spec Version
- **Microsoft App Installer** (Windows 10 1709+, Windows 11)
- Source: `MicrosoftDocs/msix-docs` -> `msix-src/app-installer/`
- Docs: `learn.microsoft.com/windows/msix/package/app-installer-file-overview`

### File Format: `.appinstaller` (XML)

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
  xmlns="http://schemas.microsoft.com/appx/appinstaller/2017/2"
  Version="2.1.0.0"
  Uri="https://r2.airiz.com/updates/appinstaller-2.1.0.0.appx">

  <MainPackage
    Name="AIRIZ.MotorConsole"
    Publisher="CN=Airiz Technologies, O=Airiz, L=Bangkok, C=TH"
    Version="2.1.0.0"
    ProcessorArchitecture="x64"
    Uri="https://r2.airiz.com/updates/AIRIZ-2.1.0.0-x64.appx" />

  <OptionalPackages>
    <Package
      Name="AIRIZ.MotorConsole.Languages.zh-TW"
      Publisher="CN=Airiz Technologies, O=Airiz, L=Bangkok, C=TH"
      Version="2.1.0.0"
      ProcessorArchitecture="x64"
      Uri="https://r2.airiz.com/updates/AIRIZ-zh-TW-2.1.0.0-x64.appx" />
  </OptionalPackages>

  <Dependencies>
    <Package
      Name="Microsoft.VCLibs.140.0"
      Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"
      Version="14.0.30705.0"
      ProcessorArchitecture="x64"
      Uri="https://aka.ms/vclibs/14.0/x64/appinstaller" />
  </Dependencies>

  <UpdateURIs>
    <UpdateURI>
      https://r2.airiz.com/updates/appinstaller-latest.appinstaller
    </UpdateURI>
  </UpdateURIs>

  <RepairURIs>
    <RepairURI>
      https://r2.airiz.com/updates/appinstaller-repair.appinstaller
    </RepairURI>
  </RepairURIs>

  <UpdateSettings>
    <OnLaunch />
    <HoursBetweenUpdateChecks>12</HoursBetweenUpdateChecks>
    <AutomaticBackgroundTask />
    <ForceUpdateFromAnyVersion />
  </UpdateSettings>
</AppInstaller>
```

### Root Element

| Attribute | Type | Required | Notes |
|-----------|------|----------|-------|
| `xmlns` | namespace URI | YES | One of: .../2015, .../2017, .../2017/2, .../2021 |
| `Version` | string | YES | App version (e.g., 2.1.0.0) |
| `Uri` | URL | YES | Primary package/bundle download URL |

### Namespace Versions

| Namespace | Win10 Version | Features |
|-----------|---------------|----------|
| `.../appinstaller/2015` | 1607 | Basic: MainPackage, UpdateURIs |
| `.../appinstaller/2017` | 1709 | + OptionalPackages, Dependencies, RepairURIs, UpdateSettings |
| `.../appinstaller/2017/2` | 1709 | + MainBundle support |
| `.../appinstaller/2021` | Win11 21H2 | + Case-insensitive element names |

### Element Reference

| Element | Key Attributes | Notes |
|---------|---------------|-------|
| `<MainPackage>` | Name, Publisher, Version, ProcessorArchitecture, Uri | Single MSIX package |
| `<MainBundle>` | Name, Publisher, Version, Uri | MSIX bundle (replaces MainPackage) |
| `<OptionalPackages>` | (container) | Optional packages/bundles |
| `<Package>` (in Optional) | Name, Publisher, Version, ProcessorArchitecture, Uri | Optional component |
| `<Bundle>` (in Optional) | Name, Publisher, Version, Uri | Optional bundle |
| `<Dependencies>` | (container) | Required dependencies |
| `<Package>` (in Deps) | Name, Publisher, Version, (ProcessorArchitecture), Uri | Required dependency |
| `<UpdateURIs>` / `<UpdateUris>` | (container) | Update check URLs |
| `<UpdateURI>` / `<UpdateUri>` | text = URL | Additional .appinstaller to check |
| `<RepairURIs>` / `<RepairUris>` | (container) | Repair URLs |
| `<RepairURI>` / `<RepairUri>` | text = URL | Repair .appinstaller URL |

### UpdateSettings Child Elements

| Element | Type | Win10 Min | Notes |
|---------|------|-----------|-------|
| `<OnLaunch/>` | flag | 1709 | Check updates on app launch |
| `<HoursBetweenUpdateChecks>` | int 0-255 | 1803 | Periodic check interval (default 24) |
| `<UpdateBlocksActivation>` | flag | 1903 | Block launch until update completes |
| `<ShowPrompt>` | flag | 1903 | Show UI prompt |
| `<AutomaticBackgroundTask/>` | flag | 1803 | 8h background window, no UI |
| `<ForceUpdateFromAnyVersion>` | flag | 1903 | Force from any previous version |

### Key Notes

- **No cryptographic signature in the file**: App Installer relies on **MSIX package signing** (Authenticode/SHA-256). The .appinstaller itself is unsigned.
- **Package signing**: Each .appx/.appxbundle signed with EV or OV code-signing cert. Publisher attr must match cert subject.
- **Architecture values**: `x86`, `x64`, `arm`, `arm64`, `neutral`
- **Version format**: 4-part numeric (major.minor.build.revision)
- **Update flow**: App Installer fetches .appinstaller URL, compares versions, downloads, verifies Authenticode, installs via AddPackage API.

---

## Protocol 8: Workbox Precache Manifest

### Spec Version
- **Workbox** (Chrome DevTools team, 2018-2026)
- Source: `developer.chrome.com/docs/workbox/modules/workbox-precaching`
- npm: `workbox-precaching`

### File Format: Generated JS (or JSON)

The precache manifest is a **generated JavaScript file** calling `workbox.precaching.precacheAndRoute()`:

```javascript
// workbox-precache-manifest.js (generated at build time)
self.__WB_MANIFEST = [
  { "url": "/index.html", "revision": "a1b2c3d4e5f67890" },
  { "url": "/assets/app.js", "revision": "f9e8d7c6b5a43210" },
  { "url": "/assets/app.css", "revision": "1234567890abcdef" },
  { "url": "/assets/logo.png", "revision": null },
  { "url": "/fonts/inter.woff2", "revision": "fedcba0987654321",
    "integrity": "sha384-abc123..." }
];
```

### PrecacheEntry Interface

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `url` | `string` | YES | Relative or absolute URL of the asset |
| `revision` | `string \| null` | Optional | Content hash (build-time). null = use URL as-is |
| `integrity` | `string` | Optional | Subresource Integrity hash (e.g., sha384-...) |

### Revision Semantics

- **Non-null revision**: Effective cache key = `{url}?revision={revision}` (or URL as-is if filename already contains a hash).
- **null revision**: URL used as-is (for already-hashed filenames like `app.a1b2c3d4.js`).
- **Content hash detection**: If URL filename contains a hash pattern, Workbox uses it directly.

### Build-Time Generation

```javascript
// vite.config.js
import { InjectManifest } from 'workbox-vite';
export default {
  plugins: [
    InjectManifest({
      swDest: 'sw.js',
      globPatterns: ['**/*.{js,css,html,woff2,png}']
    })
  ]
};
```

### Key Notes

- **No signature**: Relies on HTTPS + optional SRI. No Ed25519/RSA.
- **Not a standalone file**: Embedded in the SW bundle as `self.__WB_MANIFEST` array.
- **Update detection**: When SW script changes (byte comparison), new SW re-precaches from its manifest. Old entries deleted during activate.
- **Cache naming**: `workbox-precache-v2-[revision]`.

---

## Cross-Protocol Comparison Matrix

| Feature | electron-builder | Tauri 2.x | Capacitor (Capawesome) | Squirrel | Sparkle | PWA SW | AppInstaller | Workbox |
|---------|-----------------|-----------|----------------------|----------|---------|--------|--------------|---------|
| Format | YAML | JSON | JSON | Plain text | XML (RSS) | None (browser) | XML | JS array |
| Version scheme | semver | semver | bundleId (opaque) | nupkg filename | int (CFBundleVersion) | None | 4-part numeric | None |
| Hash | SHA-512 (b64) | None (sig only) | SHA-256 (hex) | SHA-1 (hex) | None (sig only) | None | None (Authenticode) | Content hash |
| Signature | Ed25519 (opt) | Minisign Ed25519 | RSA (over SHA-256) | None | Ed25519 | None | Authenticode (X.509) | SRI (opt) |
| Staging/Rollout | stagingPercentage | None (server) | Channel-based | #nn% | phasedRolloutInterval | None | None | None |
| Delta/Partial | Blockmap | None | None | bsdiff -delta.nupkg | None | None | None | None |
| Multi-platform | files[] array | platforms map | bundleId per platform | Single (arch in nupkg) | os attribute | N/A | ProcessorArchitecture | N/A |
| Feed integrity | Sig on manifest | Sig on payload | Sig on payload | None | Sig on feed XML | HTTPS only | HTTPS + pkg sig | HTTPS + SRI |
| Min OS check | None | None | None | None | minimumSystemVersion | None | ProcessorArchitecture | None |
| Force update | None | None | None | None | criticalUpdate | None | ForceUpdateFromAnyVersion | None |

---

## Discrepancies (User Claims vs. Verified Reality)

### 1. Squirrel "OR" Delta Syntax - INCORRECT

**Claim**: Squirrel RELEASES supports an `OR <deltaSha1> <deltaSize>` suffix for alternate delta packages.

**Reality**: No such syntax exists in `ReleaseEntry.cs`. The regex is strictly:
```
^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$
```
Deltas are identified **solely** by the filename containing `-delta.` (e.g., `AIRIZ-2.1.0-2.0.0-delta.nupkg`). No OR clause, no alternate hash on the same line.

### 2. Capacitor {href, sizeInBytes} Array - LEGACY/WRONG PLUGIN

**Claim**: Capacitor Live Update manifest is an array of `{href, sizeInBytes}` objects.

**Reality**: That format belongs to the **deprecated Ionic Live Update** (old capacitorjs.com integration). The current maintained plugin `@capawesome/capacitor-live-update` uses `DownloadBundleOptions` with `{artifactType, bundleId, checksum, signature, url}` - fundamentally different schema with RSA signatures.

### 3. Service Worker "parsed" State - CORRECT (confirmed)

**Claim**: `parsed` is a SW lifecycle state.

**Reality**: **Confirmed.** W3C CRD (29 Oct 2026) Section 2.1 explicitly states:
> "A service worker has an associated state, which is one of `parsed`, `installing`, `installed`, `activating`, `activated`, and `redundant`. It is initially `parsed`."

The `parsed` state is the initial state after the script is fetched and parsed, before the `install` event fires.

### 4. electron-builder Top-level path/sha512 - REMOVED IN v27

**Claim**: `latest.yml` has top-level `path` and `sha512` fields.

**Reality**: These were the v24-v26 format. In v27+, they are **removed by default**. The new format uses a `files[]` array. Backward compatibility exists via a flag, but `files[]` is the recommended format.

---

## AIRIZ Unified Manifest - Minimum Viable Subset

### Design Principles

1. **Single JSON document** serves all platforms (Electron, Capacitor, PWA, Worker)
2. **Ed25519 signature** over the canonical manifest body (same key for all platforms)
3. **Per-platform entries** with URL, size, hash, and optional signature
4. **Staging/rollout** at the manifest level (not per-platform)
5. **Backward-compatible**: old clients can ignore unknown fields
6. **Minimal**: only fields that at least one platform consumer needs

### Unified Manifest Schema (JSON)

```json
{
  "version": "2.1.0",
  "channel": "stable",
  "releaseDate": "2026-11-05T08:30:00+08:00",
  "notes": "Release notes in Markdown.",
  "platforms": {
    "windows": {
      "url": "https://r2.airiz.com/updates/2.1.0/AIRIZ-Setup-2.1.0.exe",
      "size": 45234176,
      "sha512": "base64sha512hash...",
      "signature": "base64ed25519sighash...",
      "delta_url": "https://r2.airiz.com/updates/2.1.0/AIRIZ-2.1.0-2.0.0-delta.nupkg",
      "delta_from": "2.0.0",
      "arch": "x64"
    },
    "darwin": {
      "url": "https://r2.airiz.com/updates/2.1.0/AIRIZ-2.1.0.dmg",
      "size": 89128960,
      "sha512": "base64sha512hash...",
      "signature": "base64ed25519sighash...",
      "arch": "arm64",
      "min_os": "10.15"
    },
    "android": {
      "url": "https://r2.airiz.com/updates/2.1.0/airiz-android-2.1.0.zip",
      "size": 2457600,
      "sha512": "base64sha512hash...",
      "signature": "base64ed25519sighash..."
    },
    "ios": {
      "url": "https://r2.airiz.com/updates/2.1.0/airiz-ios-2.1.0.zip",
      "size": 2355200,
      "sha512": "base64sha512hash...",
      "signature": "base64ed25519sighash..."
    },
    "web": {
      "url": "https://r2.airiz.com/updates/2.1.0/sw.js",
      "size": 48128,
      "sha512": "base64sha512hash...",
      "signature": "base64ed25519sighash..."
    },
    "worker": {
      "url": "https://r2.airiz.com/updates/2.1.0/worker.bundle.js",
      "size": 12288,
      "sha512": "base64sha512hash...",
      "signature": "base64ed25519sighash..."
    }
  },
  "telemetry_gates": {
    "crash_free_rate_min": 0.995,
    "rollout_pct": 50
  },
  "signing": {
    "signature": "base64ed25519signatureovermanifestbody...",
    "key_id": "airiz-prod-2026-01"
  }
}
```

### Required Fields

| Field | Type | Purpose |
|-------|------|---------|
| `version` | string (semver) | Universal version comparison |
| `channel` | string | Release channel routing (stable/beta/alpha/internal) |
| `releaseDate` | string (RFC 3339) | Release timestamp for display + caching |
| `platforms` | object | Per-platform artifact entries |
| `platforms.*.url` | string (URI) | Download location |
| `platforms.*.size` | integer | Pre-download size validation |
| `platforms.*.sha512` | string (base64) | Integrity verification |
| `platforms.*.signature` | string (base64) | Ed25519 authenticity proof |
| `signing` | object | Manifest-level integrity |
| `signing.signature` | string (base64) | Ed25519 sig over canonical body |
| `signing.key_id` | string | Public key identifier |

### Optional Fields

| Field | Type | Purpose |
|-------|------|---------|
| `notes` | string | Release notes (Markdown) |
| `platforms.*.delta_url` | string (URI) | Delta/partial update |
| `platforms.*.delta_from` | string | Base version for delta |
| `platforms.*.arch` | string | CPU architecture |
| `platforms.*.min_os` | string | Minimum OS version |
| `telemetry_gates` | object | Rollout safety gates |
| `telemetry_gates.crash_free_rate_min` | number (0-1) | Auto-halt threshold |
| `telemetry_gates.rollout_pct` | integer (0-100) | Staged rollout percentage |

### Field Rationale (Why Each Field Exists)

| Field | Needed By | Reason |
|-------|-----------|--------|
| version | All platforms | Universal semver comparison |
| channel | Capacitor, AIRIZ | Channel-based routing (Capawesome model) |
| releaseDate | Tauri, Sparkle, UI | pub_date / pubDate equivalent |
| notes | Tauri, Sparkle, UI | Release notes display |
| platforms.windows | Electron, AppInstaller | Windows installer |
| platforms.darwin | Sparkle, Tauri (macOS) | macOS updater |
| platforms.android | Capacitor | Android Live Update bundle |
| platforms.ios | Capacitor | iOS Live Update bundle |
| platforms.web | PWA SW | SW script URL |
| platforms.worker | Cloudflare Worker | Worker bundle URL |
| telemetry_gates.rollout_pct | electron-builder, Sparkle, AIRIZ | Staged rollout |
| telemetry_gates.crash_free_rate_min | AIRIZ | Auto-halt on crash spike |
| signing.signature | All (AIRIZ) | Manifest integrity (MITM prevention) |
| signing.key_id | All (AIRIZ) | Key rotation support |

### Platform-Specific Adaptation Layer

| Client | Reads From Unified Manifest | Ignores |
|--------|----------------------------|---------|
| electron-updater (shim) | version, platforms.windows.{url,size,sha512,signature}, telemetry_gates.rollout_pct | channel, notes, other platforms |
| Tauri updater (shim) | version, notes, releaseDate, platforms.{os}-{arch}.{url,signature} | sha512 (Tauri verifies sig only) |
| Capacitor Live Update (shim) | platforms.android.{url,sha512,signature}, channel | version (uses bundleId) |
| PWA SW (custom fetch) | platforms.web.{url,sha512,signature}, version | Everything else |
| Cloudflare Worker (admin API) | platforms.worker.{url,sha512,signature}, version | Everything else |
| Sparkle (shim) | version (mapped to int), releaseDate, platforms.darwin.{url,size,signature} | channel, notes |

### Staging Algorithm

```
function isInRollout(userId: string, rolloutPct: int): bool {
    hash = SHA-256(userId)
    value = first 4 bytes of hash as big-endian uint32
    threshold = (rolloutPct / 100) * 0xFFFFFFFF
    return value <= threshold
}
```

Deterministic per-user (same user always gets same result for a given percentage), matching electron-builder's UUID-based approach.

### Telemetry Gate Logic

```
onEachUpdateCheck:
    if telemetry_gates.crash_free_rate_min is set:
        currentRate = queryCrashFreeRate(version, window="24h")
        if currentRate < crash_free_rate_min:
            return previousManifest  # auto-halt rollout

    if telemetry_gates.rollout_pct < 100:
        if not isInRollout(userId, rollout_pct):
            return null  # no update for this user
```

---

## Sample Signed Manifest JSON

### Complete Production Release (all platforms)

```json
{
  "version": "2.1.0",
  "channel": "stable",
  "releaseDate": "2026-11-05T08:30:00+08:00",
  "notes": "## AIRIZ Motor Console 2.1.0\n\n- New motor calibration wizard\n- Fixed CAN bus timeout on idle\n- Performance: 30% faster data grid rendering\n- Bug fixes for sensor fusion edge cases",
  "platforms": {
    "windows": {
      "url": "https://r2.airiz.com/updates/2.1.0/AIRIZ-Setup-2.1.0.exe",
      "size": 45234176,
      "sha512": "7a8B9c0D1e2F3a4b5C6d7E8f9A0b1c2D3e4F5a6b7C8d9E0f1A2b3C4d5E6f7A8b9C0d1E2f3A4b5C6d7E8f9A0b1c2D3e4F5a6b7C8d9E0f1A2b3C4d5E6f7A8b=",
      "signature": "MEUCIQDxKzJmQwR3vLp8nT5yHfGcBd1eXsAoUvIjWkNqRt0mZcA8yLpD4vEwFgH2jKbN7rXo1sTq3uYv5wZa9bBcD0e=",
      "delta_url": "https://r2.airiz.com/updates/2.1.0/AIRIZ-2.1.0-2.0.0-delta.nupkg",
      "delta_from": "2.0.0",
      "arch": "x64"
    },
    "darwin": {
      "url": "https://r2.airiz.com/updates/2.1.0/AIRIZ-2.1.0.dmg",
      "size": 89128960,
      "sha512": "3b5C6d7E8f9A0b1c2D3e4F5a6B7c8D9e0F1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B1c2D3e4F5a6B7c8D9e0F1a2B3c4D5e6F7a8B9c0D1e2F3a4=",
      "signature": "MEUCIQDmNpQrStUvWxYz1aBcDeFgHiJkLmNoPqRsTuVwXyZa0bCdEfGhIjKlMnOpQrStUvWxYz1aBcDeFgH=",
      "arch": "arm64",
      "min_os": "10.15"
    },
    "android": {
      "url": "https://r2.airiz.com/updates/2.1.0/airiz-android-2.1.0.zip",
      "size": 2457600,
      "sha512": "1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B1c2D3e4F5a6B7c8D9e0F1a2B3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9a0B1c2D3e4F5a6B7c8D9e0F1a2=",
      "signature": "MEUCIQDfGhIjKlMnOpQrStUvWxYz1aBcDeFgHiJkLmNoPqRsTuVwXyZa0bCdEfGhIjKlMnOpQrStUvWxY="
    },
    "ios": {
      "url": "https://r2.airiz.com/updates/2.1.0/airiz-ios-2.1.0.zip",
      "size": 2355200,
      "sha512": "9f8E7d6C5b4A3f2E1d0C9b8A7f6E5d4C3b2A1f0E9d8C7b6A5f4E3d2C1b0A9f8E7d6C5b4A3f2E1d0C9b8A7f6E5d4C3b2A1f0E9d8C7b6A5f4E3d2C1b0=",
      "signature": "MEUCIQDzXcVbNaMlKjIhGfEdCbA9y8W7V6u5t4S3r2Q1p0O9n8M7l6K5j4I3h2G1f0E9d8C7b6A5f4E3d2C="
    },
    "web": {
      "url": "https://r2.airiz.com/updates/2.1.0/sw.js",
      "size": 48128,
      "sha512": "5d4C3b2A1f0E9d8C7b6A5f4E3d2C1b0A9f8E7d6C5b4A3f2E1d0C9b8A7f6E5d4C3b2A1f0E9d8C7b6A5f4E3d2C1b0A9f8E7d6C5b4A3f2E1d0C9b8A7f6=",
      "signature": "MEUCIQDwVbNaMlKjIhGfEdCbA9y8W7V6u5t4S3r2Q1p0O9n8M7l6K5j4I3h2G1f0E9d8C7b6A5f4E3d2C1b0A="
    },
    "worker": {
      "url": "https://r2.airiz.com/updates/2.1.0/worker.bundle.js",
      "size": 12288,
      "sha512": "2c1B0a9F8e7D6c5B4a3F2e1D0c9B8a7F6e5D4c3B2a1F0e9D8c7B6a5F4e3D2c1B0a9F8e7D6c5B4a3F2e1D0c9B8a7F6e5D4c3B2a1F0e9D8c7B6a5F4e3=",
      "signature": "MEUCIQDhGfEdCbA9y8W7V6u5t4S3r2Q1p0O9n8M7l6K5j4I3h2G1f0E9d8C7b6A5f4E3d2C1b0A9f8E7d6C5b="
    }
  },
  "telemetry_gates": {
    "crash_free_rate_min": 0.995,
    "rollout_pct": 50
  },
  "signing": {
    "signature": "MEUCIQDpQrStUvWxYz1aBcDeFgHiJkLmNoPqRsTuVwXyZa0bCdEfGhIjKlMnOpQrStUvWxYz1aBcDeFgHiJkLmNoPqRsTuVwXyZa0bCdEfgH2jKbN7rXo1sTq3uYv5wZa9bBcD0e=",
    "key_id": "airiz-prod-2026-01"
  }
}
```

### Minimal Manifest (Alpha Channel, Windows Only)

```json
{
  "version": "3.0.0-alpha.1",
  "channel": "alpha",
  "releaseDate": "2026-11-04T14:00:00+08:00",
  "notes": "Alpha: new motor control SDK integration (unstable)",
  "platforms": {
    "windows": {
      "url": "https://r2.airiz.com/updates/3.0.0-alpha.1/AIRIZ-Setup-3.0.0-alpha.1.exe",
      "size": 46800384,
      "sha512": "F0e9D8c7B6a5F4e3D2c1B0a9F8e7D6c5B4a3F2e1D0c9B8a7F6e5D4c3B2a1F0e9D8c7B6a5F4e3D2c1B0a9F8e7D6c5B4a3F2e1D0c9B8a7F6e5D4c3B2a1F0e9=",
      "signature": "MEUCIQDalpha1key2sig3for4test5purpose6only7not8real9sigA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6A7b8C9d0E1f2G3h4=",
      "arch": "x64"
    }
  },
  "telemetry_gates": {
    "crash_free_rate_min": 0.98,
    "rollout_pct": 10
  },
  "signing": {
    "signature": "MEUCIQDbeta2key3sig4for5test6purpose7only8not9real0sigB1c2D3e4F5g6H7i8J9k0L1m2N3o4P5q6R7s8T9u0V1w2X3y4Z5a6B7c8D9e0F1g2H3i4=",
    "key_id": "airiz-alpha-2026-01"
  }
}
```

### R2 Object Layout

```
r2:airiz-updates/
|-- manifest/
|   |-- stable.json              # Current stable (atomic swap)
|   |-- beta.json
|   |-- alpha.json
|   `-- history/
|       `-- 2.1.0.json           # Immutable archive
|-- 2.1.0/
|   |-- AIRIZ-Setup-2.1.0.exe
|   |-- AIRIZ-2.1.0-2.0.0-delta.nupkg
|   |-- AIRIZ-2.1.0.dmg
|   |-- airiz-android-2.1.0.zip
|   |-- airiz-ios-2.1.0.zip
|   |-- sw.js
|   `-- worker.bundle.js
`-- keys/
    `-- airiz-prod-2026-01.pub   # Public key (Ed25519, base64)
```

### Client Fetch Pattern

```
# All clients fetch the same URL, adapt to their platform:
GET https://r2.airiz.com/manifest/stable.json

# Or channel-specific:
GET https://r2.airiz.com/manifest/{channel}.json
```

---

## Signing & Verification Procedure

### Canonicalization (for manifest signature)

To ensure deterministic signing across languages:

1. Parse the JSON manifest
2. Remove the `signing` field entirely
3. Re-serialize with:
   - Keys sorted alphabetically (recursively)
   - No whitespace (compact JSON)
   - UTF-8 encoding
   - No trailing newline
4. Sign the resulting byte string with Ed25519 private key
5. Base64-encode the 64-byte signature
6. Insert into `signing.signature`

### Per-File Signature

Each file in `platforms.*.signature` is:
```
Ed25519Sign(privateKey, fileBytes) -> 64 bytes -> base64
```

### Client Verification Steps

```
1. Fetch manifest JSON (GET /manifest/stable.json)
2. Extract signing.signature, signing.key_id
3. Fetch public key for key_id (cached, or from /keys/{key_id}.pub)
4. Remove signing field, canonicalize remaining JSON
5. Ed25519Verify(publicKey, canonicalBytes, signature)
   -> If fail: REJECT, report tampering to telemetry
6. Check telemetry_gates:
   a. If rollout_pct < 100 AND not in cohort: no update
   b. If crash_free_rate_min exceeded: no update
7. Select platform entry for current OS/arch
8. Download file from url (with progress)
9. Verify SHA-512: compute SHA-512(downloadedBytes) == sha512 field
10. Verify Ed25519: Ed25519Verify(pubKey, fileBytes, signature)
11. If all pass: proceed with platform-specific install
12. On success: report to telemetry (version, platform, duration)
```

### Key Rotation

- `key_id` allows multiple keys to coexist
- Clients cache a set of known public keys (embedded at compile time)
- New releases can be signed with a new key; old manifests remain verifiable
- Key revocation: client maintains a revocation list (fetched from `/keys/revoked.json`)
- Transition period: publish manifests signed with BOTH old and new key (dual-sign)

### Ed25519 Key Generation

```bash
# Generate keypair
openssl genpkey -algorithm ed25519 -out airiz-prod-2026-01.pem

# Extract public key (raw 32 bytes -> base64)
openssl pkey -in airiz-prod-2026-01.pem -pubout -outform DER | tail -c 32 | base64

# Sign a file (raw, no digest)
openssl pkeyutl -sign -inkey airiz-prod-2026-01.pem -rawin -in artifact.exe -out sig.bin
base64 sig.bin

# Verify
openssl pkeyutl -verify -pubin -inkey airiz-prod-2026-01.pub -rawin -in artifact.exe -sigfile sig.bin
```

### Public Key Distribution

Host at: `https://r2.airiz.com/keys/airiz-prod-2026-01.pub`

Content (single line, base64-encoded 32-byte Ed25519 public key):
```
base64encoded32byteed25519publickey=
```

Clients embed the **current** key at compile time (for bootstrapping) and can fetch new keys for rotation.

---

## Migration Path

### Phase 1: Dual-Write (Weeks 1-2)
- CI/CD publishes to **both** legacy format AND unified manifest
- Legacy clients continue working unchanged
- New unified client (PWA SW, Cloudflare Worker) reads unified manifest
- R2 lifecycle: `manifest/*.json` = mutable current, `manifest/history/` = immutable

### Phase 2: Electron Migration (Weeks 3-4)
- Option A: Replace electron-updater with custom updater reading unified manifest
- Option B: Maintain a `latest.yml` **generator** that transforms unified manifest -> electron-builder format (zero client changes)
- Recommended: Option B initially (lower risk), migrate to Option A in Phase 4

### Phase 3: Capacitor Migration (Weeks 5-6)
- Write `DownloadBundleOptions` adapter in native plugin
- OR: Maintain Capgo-compatible API endpoint that proxies unified manifest
- OR: Replace Capawesome plugin with custom Capacitor plugin reading unified manifest directly

### Phase 4: Cleanup (Week 7+)
- Remove legacy format generators
- All clients read unified manifest natively
- Archive legacy format code
- Document unified manifest as the single source of truth

---

## Source Citations

| # | Protocol | Source URL | Version/Date |
|---|----------|-----------|--------------|
| 1 | electron-builder | github.com/electron-userland/electron-builder/blob/main/website/docs/features/auto-update.md | v27+ (2025-2026) |
| 2 | electron-builder (signing) | github.com/electron-userland/electron-builder/blob/main/website/docs/features/signed-update-manifests.md | v27+ |
| 3 | Tauri updater (structs) | github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs | Tauri v2 (2024-2026) |
| 4 | Tauri updater (config) | github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/config.rs | Tauri v2 |
| 5 | Tauri updater (docs) | tauri.app/plugin/updater/ | v2 |
| 6 | Capacitor Live Update | github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts | @capawesome/capacitor-live-update (2024-2026) |
| 7 | Squirrel RELEASES parser | github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs | Squirrel.Windows (2014-2023) |
| 8 | Squirrel staged rollouts | github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/staged-rollouts.md | - |
| 9 | Squirrel delta packages | github.com/Squirrel/Squirrel.Windows/blob/develop/docs/using/delta-packages.md | - |
| 10 | Sparkle publishing docs | sparkle-project.org/documentation/publishing/ | Sparkle 2.x (2020-2026) |
| 11 | Sparkle signed sample | sparkle-project.org/files/sparkletestcast-signed.xml | - |
| 12 | W3C Service Workers CRD | https://www.w3.org/TR/2026/CRD-service-workers-20261029/ | CRD, 29 October 2026 |
| 13 | W3C SW Editor's Draft | https://w3c.github.io/ServiceWorker/ | ED, 29 October 2026 |
| 14 | App Installer overview | github.com/MicrosoftDocs/msix-docs/blob/main/msix-src/app-installer/app-installer-file-overview.md | Win10 1709+ / Win11 |
| 15 | App Installer update settings | github.com/MicrosoftDocs/msix-docs/blob/main/msix-src/app-installer/update-settings.md | - |
| 16 | App Installer examples | github.com/MicrosoftDocs/msix-docs/blob/main/msix-src/app-installer/how-to-create-appinstaller-file.md | - |
| 17 | Workbox precaching | developer.chrome.com/docs/workbox/modules/workbox-precaching | Workbox 7.x (2024-2026) |

---

## Appendix A: Legacy Protocol to AIRIZ Mapping

| Legacy Protocol | AIRIZ Equivalent | Shim Required? |
|----------------|-----------------|----------------|
| electron-builder latest.yml | manifest/stable.json -> platforms.windows | Yes: YAML->JSON adapter, or native client |
| Tauri updater JSON | manifest/stable.json -> platforms.{os}-{arch} | Minimal: field name mapping |
| Capacitor Live Update | manifest/stable.json -> platforms.android/ios | Yes: DownloadBundleOptions adapter |
| Squirrel RELEASES | manifest/stable.json -> platforms.windows (delta) | Yes: text->JSON parser |
| Sparkle appcast | manifest/stable.json -> platforms.darwin | Yes: JSON->XML generator |
| PWA SW | manifest/stable.json -> platforms.web | No: custom fetch reads JSON directly |
| AppInstaller | manifest/stable.json -> platforms.windows | Yes: JSON->XML generator |
| Workbox precache | manifest/stable.json -> platforms.web (SW script) | No: build-time reads manifest |

---

## Appendix B: Security Considerations

| Threat | Mitigation |
|--------|-----------|
| MITM manifest injection | Ed25519 signature on manifest body; clients reject unsigned/tampered manifests |
| File corruption in transit | SHA-512 hash verified after download |
| Fake update server | Ed25519 signature on each file; public key embedded at compile time |
| Rollout of crashing build | telemetry_gates.crash_free_rate_min auto-halts rollout |
| Key compromise | key_id rotation; dual-sign transition period; revocation list |
| Replay attack | releaseDate + version monotonicity check (semver > current) |
| CDN cache poisoning | R2 + Cloudflare with signed URL or cache-busting query param |
| Downgrade attack | Client rejects version < current (semver comparison) |

---

## Appendix C: CI/CD Pipeline (Pseudocode)

```
on push tag v*:
  1. Build all platform artifacts (exe, dmg, zip, sw.js, worker.bundle.js)
  2. Compute SHA-512 for each artifact
  3. Sign each artifact with Ed25519 private key (HSM/KMS)
  4. Generate delta packages (for Windows, if applicable)
  5. Assemble unified manifest JSON
  6. Canonicalize + sign manifest body with Ed25519
  7. Upload all artifacts to R2 (versioned path: /{version}/)
  8. Atomic swap: R2 copy /{version}/manifest.json -> /manifest/{channel}.json
  9. Archive: R2 copy -> /manifest/history/{version}.json
  10. (Optional) Generate legacy formats:
      - latest.yml from unified manifest (for electron-builder compat)
      - RELEASES text from unified manifest (for Squirrel compat)
      - appcast.xml from unified manifest (for Sparkle compat)
  11. Invalidate CDN cache for /manifest/*
  12. Notify (Slack/email) with manifest URL + rollout config
```

---

*End of document.*
*8 protocols documented with exact field names and real examples.*
*Unified schema proposed as Minimum Viable Subset.*
*Sample signed manifests provided (production + minimal alpha).*
*Signing procedure, migration path, and security model defined.*
