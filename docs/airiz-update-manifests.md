# AIRIZ Motor Console - Cross-Platform Auto-Update Manifest Reference

## LAYER 1: Protocol Schemas

---

### 1. electron-updater `latest.yml`

**Spec version**: electron-builder v25.x / electron-updater v6.x
**Reference**:
- Source: [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) @ 1e432785
- Type: [UpdateInfo](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/packages/builder-util-runtime/src/updateInfo.ts)
- Generator: [updateInfoBuilder.ts](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/packages/app-builder-lib/src/publish/updateInfoBuilder.ts)
- Test snapshot: [nsisUpdaterTest.js.snap](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/test/snapshots/updater/nsisUpdaterTest.js.snap)

**Per-platform filenames**: latest.yml (Windows), latest-mac.yml (macOS), latest-linux.yml (Linux). Channel variants: beta.yml, alpha.yml.

#### Fields

| Field | Type | Required | Source |
|-------|------|----------|--------|
| version | string (semver) | **Required** | UpdateInfo.version (L47) |
| files | Array of file entries | **Required** | UpdateFileInfo (L39-41) |
| files[].url | string (relative or absolute URL) | **Required** | BlockMapDataHolder |
| files[].sha512 | string (base64) | **Required** | BlockMapDataHolder.sha512 (L30) |
| files[].size | number (bytes) | Optional | BlockMapDataHolder.size (L18) |
| files[].blockMapSize | number (bytes) | Optional | BlockMapDataHolder.blockMapSize (L25) |
| path | string | **Deprecated** (v1.x compat) | UpdateInfo.path (L52) |
| sha512 | string | **Deprecated** (v1.x compat) | UpdateInfo.sha512 (L55) |
| releaseName | string or null | Optional | UpdateInfo.releaseName (L60) |
| releaseNotes | string or Array of note entries | Optional | UpdateInfo.releaseNotes (L65) |
| releaseDate | string (ISO 8601) | Optional (auto-set) | UpdateInfo.releaseDate (L70) |
| stagingPercentage | number (0-100) | Optional | UpdateInfo.stagingPercentage (L75) |
| packages | map of arch to PackageFileInfo | Windows-only, Optional | WindowsUpdateInfo.packages (L79) |

#### Example (Windows)

`yaml
version: 1.5.2-beta.3
files:
  - url: TestApp Setup 1.5.2-beta.3.exe
    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
    size: 42368000
    blockMapSize: 1024
path: TestApp Setup 1.5.2-beta.3.exe
sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
releaseName: v1.5.2-beta.3
releaseNotes: |
  - Fixed crash on startup
  - Added new feature
releaseDate: "2026-11-05T12:00:00.000Z"
stagingPercentage: 90
packages:
  ia32:
    url: TestApp-Setup-1.5.2-beta.3.ia32.exe
    sha512: "abc123..."
    size: 38000000
  arm64:
    url: TestApp-Setup-1.5.2-beta.3.arm64.exe
    sha512: "def456..."
    size: 40000000
`

#### Signature model

- **No embedded signature in latest.yml**. The sha512 field is a **checksum**, not a signature.
- Code signing is done at the **binary level** (Authenticode for .exe, notarization for macOS .zip).
- The manifest itself is protected by **transport security** (HTTPS) + **publisher trust** (whoever controls the CDN).
- electron-updater validates sha512 after download (ERR_CHECKSUM_MISMATCH on failure - see [test L372](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/test/snapshots/updater/nsisUpdaterTest.js.snap#L372)).

#### Staged rollout mechanism

From [AppUpdater.ts L488-511](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/packages/electron-updater/src/AppUpdater.ts#L488-L511):
- Client generates a **UUIDv5** .updaterId stored in userData/.updaterId.
- Staging: hash of UUID determines if client is in the rollout bucket.
- **Gap**: The X-USER-STAGING-ID header was flagged as a [privacy violation](https://github.com/electron-userland/electron-builder/issues/7728).

---

### 2. electron-updater `app-update.yml`

**Spec version**: electron-builder v20.34.0+
**Reference**:
- Parser: [AppUpdater.ts L467-472](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/packages/electron-updater/src/AppUpdater.ts#L467-L472)
- Types: [publishOptions.ts](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/packages/builder-util-runtime/src/publishOptions.ts)

**Location**: resources/app-update.yml (packaged), dev-app-update.yml (dev).
**Purpose**: Embeds the **provider configuration** into the app binary so electron-updater knows where to fetch latest.yml at runtime.

#### Fields

| Field | Type | Required | Source |
|-------|------|----------|--------|
| provider | github / s3 / spaces / generic / custom / snapStore | **Required** | PublishConfiguration.provider (L12) |
| url | string (base URL) | **Required** for generic | GenericServerOptions.url (L124) |
| channel | string | Optional (default: latest) | GenericServerOptions.channel (L130) |
| useMultipleRangeRequest | boolean | Optional | GenericServerOptions.useMultipleRangeRequest (L135) |
| repo | string | Optional (GitHub) | GithubOptions.repo (L62) |
| owner | string | Optional (GitHub) | GithubOptions.owner (L68) |
| vPrefixedTagName | boolean | Optional (default: true) | GithubOptions.vPrefixedTagName (L73) |
| host | string | Optional (default: github.com) | GithubOptions.host (L79) |
| requestHeaders | object | Optional | PublishConfiguration.requestHeaders (L39) |
| updaterCacheDirName | string | Optional (win-only) | PublishConfiguration.updaterCacheDirName (L24) |

#### Example (generic provider)

`yaml
provider: generic
url: https://releases.airiz-motor.com/console
channel: latest
useMultipleRangeRequest: true
updaterCacheDirName: airiz-console-updater
`

#### Example (GitHub provider)

`yaml
provider: github
owner: airiz-motor
repo: motor-console
vPrefixedTagName: true
`

---

### 3. Tauri Updater JSON Manifest (Tauri 2.x)

**Spec version**: tauri-plugin-updater v2.x
**Reference**:
- Source: [tauri-apps/tauri-plugin-updater](https://github.com/tauri-apps/tauri-plugin-updater) @ 3cba6fbf
- Core types: [updater.rs](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbfd359c843ac799416ffcbb704099987f6/src/updater.rs)
- Config: [config.rs](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbfd359c843ac799416ffcbb704099987f6/src/config.rs)

**Two manifest shapes** (deserialized via serde untagged on RemoteReleaseInner, [L92-103](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbfd359c843ac799416ffcbb704099987f6/src/updater.rs#L92-L103)):

#### Shape A: Dynamic (server resolves platform)

`json
{
  "version": "2.1.0",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-11-05T08:00:00Z",
  "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ-Motor-Console_2.1.0_x64-setup.exe",
  "signature": "base64-encoded-minisign-signature"
}
`

#### Shape B: Static (client picks platform via target key)

`json
{
  "version": "2.1.0",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-11-05T08:00:00Z",
  "platforms": {
    "windows-x86_64-nsis": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ-Motor-Console_2.1.0_x64-setup.exe",
      "signature": "base64-minisign-sig"
    },
    "windows-x86_64-msi": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ-Motor-Console_2.1.0_x64.msi",
      "signature": "base64-minisign-sig-msi"
    },
    "darwin-aarch64-app": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ-Motor-Console_2.1.0_aarch64.app.tar.gz",
      "signature": "base64-minisign-sig-mac"
    },
    "linux-x86_64-appimage": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ-Motor-Console_2.1.0_x86_64.AppImage.tar.gz",
      "signature": "base64-minisign-sig-linux"
    }
  }
}
`

#### Fields

| Field | Type | Required | Source |
|-------|------|----------|--------|
| version | string (semver) | **Required** | RemoteRelease.version (L111) |
| notes | string or null | Optional | RemoteRelease.notes (L113) |
| pub_date | string (ISO 8601) or null | Optional | RemoteRelease.pub_date (L115) |
| url or platforms | (Shape A / Shape B) | **Required** (one of) | RemoteReleaseInner (L92-103) |
| *.url | Url (absolute) | **Required** | ReleaseManifestPlatform.url (L84) |
| *.signature | string (base64 minisign) | **Required** | ReleaseManifestPlatform.signature (L86) |

**Target key format**: os-arch-bundle_type where os = darwin/windows/linux, arch = aarch64/x86_64, bundle_type = appimage/deb/rpm/app/msi/nsis. Lookup tries os-arch-bundle_type then falls back to os-arch ([L753-773](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbfd359c843ac799416ffcbb704099987f6/src/updater.rs#L753-L773)).

#### Signature model

- **Minisign** (speedsecurity/minisign): detached signature over the **binary artifact** (not the manifest).
- Public key embedded in the app via pubkey in tauri.conf.json.
- Verification: minisign_verify::verify(bytes, signature, pubkey) + optional signed-version binding (requireSignedVersion, [config.rs L117-135](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbfd359c843ac799416ffcbb704099987f6/src/config.rs#L117-L135)).
- **Gap**: The manifest itself is **not signed** - only the artifact. A MITM can pair a valid old signature with a new version number. The requireSignedVersion flag mitigates this but is **off by default**.

#### Endpoint URL templating

The endpoint supports {{target}}, {{arch}}, {{current_version}}, {{bundle_type}} substitution ([L562-574](https://github.com/tauri-apps/tauri-plugin-updater/blob/3cba6fbfd359c843ac799416ffcbb704099987f6/src/updater.rs#L562-L574)). A 204 No Content response means "no update".
---

### 4. HotCodePush Capacitor Live Update Manifest

**Spec version**: @hotcodepush/protocol v1.x (schema v1)
**Reference**:
- Source: [hotcodepush-team/protocol](https://github.com/hotcodepush-team/protocol) @ c1fc7592
- Bundle manifest: [bundle-manifest.ts](https://github.com/hotcodepush-team/protocol/blob/c1fc759213f8561f59d00e32bec6da8897b77e90/src/wire/bundle-manifest.ts)
- Channel index: [channel-index.ts](https://github.com/hotcodepush-team/protocol/blob/c1fc759213f8561f59d00e32bec6da8897b77e90/src/wire/channel-index.ts)
- Channels index: [channels-index.ts](https://github.com/hotcodepush-team/protocol/blob/c1fc759213f8561f59d00e32bec6da8897b77e90/src/wire/channels-index.ts)

**Architecture**: Two-layer document:
1. **Channel Index** (per app + channel + platform) - the "directory"
2. **Bundle Manifest Envelope** (per release) - the "entry"

#### Channel Index Schema (v1)

From [ChannelIndexSchema](https://github.com/hotcodepush-team/protocol/blob/c1fc759213f8561f59d00e32bec6da8897b77e90/src/wire/channel-index.ts#L87-L97):

`json
{
  "schema": 1,
  "appId": "airiz-motor-console",
  "channelId": "production",
  "platform": "android",
  "sequence": 42,
  "cappedAt": null,
  "pausedAt": null,
  "revokedReleaseIds": [],
  "releases": [
    {
      "id": "rel-2026-11-05-a",
      "bundleId": "bundle-abc123",
      "bundleVersion": "2.1.0",
      "number": 42,
      "createdAt": "2026-11-05T08:00:00Z",
      "manifestUrl": "https://updates.airiz-motor.com/manifests/production/android/bundle-abc123.json",
      "manifestSha256": "a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
      "sizeBytes": 2457600,
      "rolloutPercent": 100,
      "isMandatory": false,
      "notes": "Fix dashboard crash",
      "conditions": [
        { "type": "binary", "range": ">=2.0.0" },
        { "type": "os", "range": ">=13" }
      ]
    }
  ]
}
`

| Field | Type | Required | Source |
|-------|------|----------|--------|
| schema | 1 (literal) | **Required** | CHANNEL_INDEX_SCHEMA (L15) |
| appId | string | **Required** | NonEmptyStringSchema |
| channelId | string | **Required** | NonEmptyStringSchema |
| platform | android / ios / etc | **Required** | PlatformSchema |
| sequence | int >= 0 | **Required** | z.int().nonnegative() (L96) |
| releases | IndexRelease[] | **Required** | z.array(IndexReleaseSchema) (L93) |
| releases[].id | string (identifier) | **Required** | IdentifierSchema |
| releases[].bundleId | string | **Required** | IdentifierSchema |
| releases[].bundleVersion | string | **Required** | z.string() |
| releases[].number | int > 0 | **Required** | z.int().positive() |
| releases[].createdAt | string (ISO 8601) | **Required** | IsoTimestampSchema |
| releases[].manifestUrl | string (HTTPS URL) | **Required** | HttpUrlSchema |
| releases[].manifestSha256 | string (hex SHA-256) | **Required** | Sha256HexSchema |
| releases[].sizeBytes | int > 0 | **Required** | SizeBytesSchema |
| releases[].rolloutPercent | int 0-100 | **Required** | z.int().min(0).max(100) (L81) |
| releases[].isMandatory | boolean | **Required** | z.boolean() (L76) |
| releases[].notes | string or null | Optional | z.string().nullable() |
| releases[].conditions | Condition[] | Optional | z.array(ConditionSchema) |
| cappedAt | string or null | Optional | IsoTimestampSchema.nullable() |
| pausedAt | string or null | Optional | IsoTimestampSchema.nullable() |
| revokedReleaseIds | string[] | Optional | z.array(IdentifierSchema) |

#### Bundle Manifest Envelope

From [ManifestEnvelopeSchema](https://github.com/hotcodepush-team/protocol/blob/c1fc759213f8561f59d00e32bec6da8897b77e90/src/wire/bundle-manifest.ts#L66-L74):

`json
{
  "bundleId": "bundle-abc123",
  "createdAt": "2026-11-05T08:00:00Z",
  "pack": {
    "url": "https://updates.airiz-motor.com/packs/bundle-abc123.tar.gz",
    "sizeBytes": 2457600
  },
  "deltas": [
    {
      "baseBundleId": "bundle-prev999",
      "url": "https://updates.airiz-motor.com/deltas/bundle-abc123-from-bundle-prev999.zip",
      "sizeBytes": 184320
    }
  ],
  "encryption": null,
  "manifest": "{canonical-json-of-bundle-manifest}",
  "signature": "base64-detached-sig-over-canonical-json"
}
`

#### Bundle Manifest (signed inner document)

From [BundleManifestSchema](https://github.com/hotcodepush-team/protocol/blob/c1fc759213f8561f59d00e32bec6da8897b77e90/src/wire/bundle-manifest.ts#L28-L36):

`json
{
  "appId": "airiz-motor-console",
  "bundleVersion": "2.1.0",
  "files": [
    { "path": "www/index.html", "sha256": "a3f2...", "sizeBytes": 4096 },
    { "path": "www/assets/bundle.js", "sha256": "b4e3...", "sizeBytes": 2400000 }
  ],
  "fingerprint": "native-fingerprint-hash",
  "keyId": "sha256:abcdef0123456789...",
  "platforms": ["android", "ios"]
}
`

#### Signature model

- **Two-layer signing**:
  1. Inner: manifest field is a **canonical JSON** string, signed with key identified by keyId (sha256: + hex SHA-256 of SPKI bytes). Signature in envelope.signature field.
  2. Outer: manifestSha256 in channel index binds envelope to index entry.
- **Delta support**: deltas[] array with baseBundleId for patch-based updates.
- **Rollout**: rolloutPercent (0-100) at the release level, evaluated client-side.
- **Conditions**: binary (version range), os (OS version range), fingerprint (native code hash), device (hashed device IDs), attribute (custom key-value).

---

### 5. Squirrel.Windows RELEASES + .nuspec

**Spec version**: Squirrel.Windows v2.x
**Reference**:
- Source: [Squirrel/squirrel.windows](https://github.com/Squirrel/squirrel.windows) @ 51f5e2cb
- Parser/Writer: [ReleaseEntry.cs](https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs)

#### RELEASES file format

**Plain text**, one line per release entry, sorted by version ascending, deltas after fulls.

**Line grammar** (from regex at [L95-97](https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs#L95-L97)):

`
SHA1-40hex Filename-or-URL Filesize-bytes [# Staging0-100 percent]
`

| Field | Type | Required | Source |
|-------|------|----------|--------|
| SHA1 | string (40 hex chars) | **Required** | ReleaseEntry.SHA1 (L34), regex [0-9a-fA-F]40 (L95) |
| Filename | string (no path sep) or absolute HTTP URL | **Required** | ReleaseEntry.Filename (L36) |
| Filesize | long (bytes, > 0) | **Required** | ReleaseEntry.Filesize (L38) |
| StagingPercentage | float (0.0-1.0, displayed as integer %) | Optional | ReleaseEntry.StagingPercentage (L40) |
| IsDelta | derived: filename.endsWith("-delta.nupkg") | Auto | filenameIsDeltaFile() (L286-288) |

#### Example RELEASES file

`
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 AIRIZ.Motor.Console-1.0.0.nupkg 42368000
b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1 AIRIZ.Motor.Console-1.0.0-1.1.0-delta.nupkg 1048576
c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2 AIRIZ.Motor.Console-1.1.0.nupkg 43000000 # 50%
d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3 AIRIZ.Motor.Console-1.2.0.nupkg 43500000
`

#### .nuspec format (NuGet package metadata)

Each .nupkg is a **NuGet package** (ZIP). The .nuspec inside carries release metadata:

`xml
<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>AIRIZ.Motor.Console</id>
    <version>1.2.0</version>
    <authors>AIRIZ</authors>
    <description>Motor Console desktop application</description>
    <releaseNotes>
      - Fixed telemetry crash
      - Added battery optimization
    </releaseNotes>
  </metadata>
</package>
`

Squirrel reads releaseNotes and icon from the .nuspec at install time ([ReleaseEntry.cs L77-93](https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs#L77-L93)).

#### Staged rollout

From [L157-169](https://github.com/Squirrel/squirrel.windows/blob/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f/src/Squirrel/ReleaseEntry.cs#L157-L169):
- Client-side: takes last 4 bytes of user's Windows Security Identifier (SID) as a uint32.
- Computes percentage = val / UInt32.MaxValue.
- If percentage < StagingPercentage, the release is visible to that user.
- **No server-side involvement** - the RELEASES file is static, staging is purely client-side hash bucketing.
---

### 6. Sparkle Appcast XML

**Spec version**: Sparkle 2.x (autoupdate framework for macOS)
**Reference**:
- Source: [sparkle-project/Sparkle](https://github.com/sparkle-project/Sparkle)
- Constants: [SUConstants.m](https://github.com/sparkle-project/Sparkle/blob/main/Sparkle/SUConstants.m) (all sparkle: attributes/elements)
- Real example: [ieasybooks/aljam3-desktop](https://github.com/ieasybooks/aljam3-desktop/blob/main/packaging/macos-updater.m)

**Format**: RSS 2.0 XML with Sparkle namespace extensions.

#### Namespace

```xml
xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
```

#### All Sparkle attributes/elements (from SUConstants.m)

**Enclosure attributes**:
- sparkle:version - CFBundleVersion (build number, e.g. 42)
- sparkle:shortVersionString - CFBundleShortVersionString (marketing version, e.g. 2.1.0)
- sparkle:edSignature - Ed25519 signature (base64)
- sparkle:deltaFrom - version this delta applies from
- sparkle:deltaFromSparkleExecutableSize - size of base executable for delta
- sparkle:deltaFromSparkleLocales - locales for delta
- sparkle:installationType - atomic (default) or in-place
- sparkle:format - dmg (default) or zip
- sparkle:os - target OS type (e.g. macos)

**Item elements**:
- sparkle:criticalUpdate - forces update dialog
- sparkle:deltas - container for delta enclosures
- sparkle:minimumAutoupdateVersion - min Sparkle framework version
- sparkle:minimumSystemVersion - min macOS version
- sparkle:maximumSystemVersion - max macOS version
- sparkle:minimumUpdateVersion - min app version that can apply this update
- sparkle:hardwareRequirements - hardware requirements (e.g. arm64)
- sparkle:releaseNotesLink - URL to release notes
- sparkle:fullReleaseNotesLink - URL to full changelog
- sparkle:tags - comma-separated tags (e.g. pre-release)
- sparkle:phasedRolloutInterval - seconds between rollout phases
- sparkle:informationalUpdate - update is informational only
- sparkle:channel - channel identifier
- sparkle:belowVersion - version below which this applies

**Standard RSS elements used**: title, pubDate, description, enclosure (url, length, type)

#### Example appcast.xml

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>AIRIZ Motor Console</title>
    <link>https://airiz-motor.com/console</link>
    <description>Appcast for AIRIZ Motor Console updates</description>
    <item>
      <title>Version 2.1.0</title>
      <pubDate>Thu, 05 Nov 2026 08:00:00 +0000</pubDate>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <sparkle:minimumUpdateVersion>2.0.0</sparkle:minimumUpdateVersion>
      <sparkle:releaseNotesLink>https://airiz-motor.com/console/changelog/2.1.0</sparkle:releaseNotesLink>
      <sparkle:tags>stable</sparkle:tags>
      <enclosure url="https://releases.airiz-motor.com/console/2.1.0/AIRIZ-Motor-Console-2.1.0.dmg"
                 sparkle:version="42"
                 sparkle:shortVersionString="2.1.0"
                 sparkle:edSignature="base64ed25519sig=="
                 length="45678901"
                 type="application/x-apple-diskimage"/>
      <sparkle:deltas>
        <enclosure url="https://releases.airiz-motor.com/console/deltas/2.0.0-2.1.0.zip"
                   sparkle:version="42"
                   sparkle:deltaFrom="41"
                   sparkle:edSignature="base64ed25519deltasig=="
                   length="1234567"
                   type="application/zip"/>
      </sparkle:deltas>
    </item>
  </channel>
</rss>
```

#### Signature model

- **Ed25519** (sparkle:edSignature) - primary, modern signature algorithm.
- **DSA** (sparkle:signature) - legacy, deprecated but still supported.
- Signature covers the **entire update archive** (dmg/zip), not the appcast.
- The appcast can optionally be **signed** (via SURequireSignedFeedKey) to prevent appcast tampering.
- Phased rollout: sparkle:phasedRolloutInterval defines the interval between automatic rollout phases (Sparkle 2.x feature).

---

### 7. Expo Updates (EAS Update)

**Spec version**: Expo SDK 53+ / expo-updates v27+
**Reference**:
- Docs: [Expo Update - Runtime versions](https://docs.expo.dev/eas-update/runtime-versions.md)
- Docs: [Expo Update - Introduction](https://docs.expo.dev/eas-update/introduction.md)

**Architecture**: EAS Update is a **cloud service**. The manifest is not a static file but a **dynamic API response** from the EAS Update server. The client queries with its runtimeVersion, platform, channel, and the server returns the appropriate update.

#### Key concepts

- **runtimeVersion**: A property that guarantees compatibility between a build native code and an update. Policies: appVersion (derived from app version), fingerprint (hash of native code), or custom string.
- **channel**: Named groups of releases (e.g. production, beta, internal). A channel points to the latest release in a branch.
- **branch**: A sequence of updates. A channel always points to the tip of a branch.
- **rollout**: Percentage of users receiving an update (0-100%). Controlled via EAS dashboard or CLI.

#### Client request parameters (implicit)

The expo-updates library sends these to the EAS Update API:
- expoPlatform (ios, android)
- expoRuntimeVersion (from app config)
- channel (from app config or runtime)
- expoOsVersion
- device info (for rollout hashing)

#### Server response (simplified)

The EAS Update API returns a JSON response containing:
- manifest: URL to the JS bundle manifest
- runtimeVersion: the runtime version this update targets
- message: release notes
- isEmbedded: whether this is the embedded update

#### Configuration (app.json / app.config.ts)

```json
{
  "expo": {
    "runtimeVersion": { "policy": "appVersion" },
    "updates": {
      "url": "https://u.expo.dev/[account]/[project]",
      "fallbackToCacheTimeout": 0
    },
    "ios": {
      "runtimeVersion": "2.1.0"
    }
  }
}
```

#### Signature model

- **No client-side signature verification of the manifest**.
- Security is via **TLS** to the EAS Update server.
- The JS bundle integrity is verified by the **React Native runtime** (Hermes/JSI).
- **Gap**: No cryptographic binding between the update and the native binary beyond runtimeVersion matching.

---

### 8. Microsoft AppInstaller (MSIX)

**Spec version**: Windows 10 1809+ / App Installer framework
**Reference**:
- Docs: [Microsoft Learn - MSIX Packaging](https://learn.microsoft.com/en-us/windows/msix/package/)
- Schema: AppInstaller XML (XSD-validated)

**Format**: XML file (.appinstaller) describing how to deploy an MSIX/MSIXBundle.

#### Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| AppInstaller Version | string | **Required** | Schema version (e.g. 1.8.0) |
| AppInstaller Uri | string | **Required** | Full URL to .msix or .msixbundle |
| AppInstaller Hash | string (SHA-256 hex) | **Required** | Hash of the MSIX file |
| AppInstaller Language | string | Optional | Default language (e.g. en-us) |
| AppInstaller UpdateHash | string | Optional | Hash of the update |
| AppInstaller UpdateUri | string | Optional | URI for update specifically |
| AppInstaller MinimumVersion | string | Optional | Min App Installer version |
| AppInstaller MinimumOSVersion | string | Optional | Min Windows version |
| AppInstaller Display | string | Optional | Display name |
| AppInstaller PublisherDisplayName | string | Optional | Publisher name |
| AppInstaller ReleaseNotes | string | Optional | Release notes |
| AppInstaller Logo | string | Optional | Logo URL |
| AppInstaller DeploymentType | string | Optional | full (default) or partial |
| AppInstaller Install | string | Optional | required (default) or optional |
| AppInstaller Update | string | Optional | auto (default) or user |
| AppInstaller UpdateMode | string | Optional | minor or major |

#### Example .appinstaller

```xml
<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE AppInstaller xmlns:msix="http://schemas.microsoft.com/appx/manifest/foundation/1.0">
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2017"
             Version="1.8.0"
             Uri="https://releases.airiz-motor.com/console/2.1.0/AIRIZ.Motor.Console_2.1.0_x64.msixbundle"
             Hash="abc123def456..."
             Language="en-us"
             Display="AIRIZ Motor Console"
             PublisherDisplayName="AIRIZ"
             ReleaseNotes="Battery optimization and telemetry fixes"
             Update="auto"
             UpdateMode="minor"
             DeploymentType="full"
             Install="required">
  <Header Source="https://releases.airiz-motor.com/console/appinstaller.xml" />
</AppInstaller>
```

#### Signature model

- The MSIX package itself is **Authenticode signed** (code signing certificate).
- The .appinstaller file references the package by **SHA-256 hash**.
- Windows verifies the hash match before installing.
- **No separate manifest signature** - trust is in the HTTPS channel + Authenticode.

---

### 9. PWA Web App Manifest + Service Worker Update

**Spec version**: W3C Web Application Manifest (WD 2026-10-26)
**Reference**:
- Spec: [W3C Web Application Manifest](https://www.w3.org/TR/appmanifest/) (latest WD: 2026-10-26)
- Editor draft: [w3c.github.io/manifest](https://w3c.github.io/manifest/)
- GitHub: [w3c/manifest](https://github.com/w3c/manifest)

**Format**: JSON (served as application/manifest+json or any JSON MIME type).

#### All members (from W3C spec, all optional at root)

| Member | Type | Required | Purpose |
|--------|------|----------|---------|
| name | string | Recommended | App display name |
| short_name | string | Optional | Short label for icon |
| id | string (URL) | Optional | Unique app identity |
| scope | string (URL path) | Optional | Navigation scope |
| start_url | string (URL) | Optional | Launch URL |
| display | string enum | Optional | browser/standalone/fullscreen/minimal-ui |
| orientation | string enum | Optional | any/natural/landscape/portrait/etc |
| theme_color | string (color) | Optional | Default theme color |
| background_color | string (color) | Optional | Background before load |
| icons | ImageResource[] | Optional | App icons |
| shortcuts | ShortcutItem[] | Optional | Quick actions |
| lang | string (BCP47) | Optional | Default language |
| dir | string enum | Optional | ltr/rtl/auto |

#### Example manifest.webmanifest

```json
{
  "lang": "en",
  "name": "AIRIZ Motor Console",
  "short_name": "MotorConsole",
  "id": "/console/",
  "scope": "/",
  "start_url": "/console/",
  "display": "standalone",
  "orientation": "any",
  "theme_color": "#1a1a2e",
  "background_color": "#ffffff",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    { "name": "Open Dashboard", "url": "/console/dashboard" }
  ]
}
```

#### Service Worker update flow

The PWA update is NOT driven by the manifest. The manifest is **static app metadata**. Updates happen via:

1. **Service Worker registration**: navigator.serviceWorker.register('/sw.js')
2. **SW update check**: Browser automatically checks for SW updates at 24h intervals OR on navigation. Fetches /sw.js and compares bytes.
3. **New SW lifecycle**: fetching - installed - waiting - activated.
4. **App-side control**: SW can use skipWaiting() + clients.claim() to force activation, or wait for user confirmation.

**There is NO standard update manifest for PWAs.** The update mechanism is:
- New deploy changes the SW file bytes
- Browser detects change, installs new SW in background
- New SW takes control on next navigation (or immediately with skipWaiting)
- App JS is updated via cache versioning (Cache Storage API)

#### Signature model

- **None at the manifest level**.
- Security is **entirely via TLS** (HTTPS required for SW registration).
- Code integrity relies on **content hashing** in Cache Storage (SW-controlled).
- **Gap**: No cryptographic update signature. A compromised CDN could serve malicious JS to all PWA users.

---

### 10. Generic HTTP Provider (electron-updater custom JSON over HTTPS)

**Spec version**: electron-updater v6.x (generic provider)
**Reference**:
- Source: [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder) @ 1e432785
- Provider: [GenericProvider.ts](https://github.com/electron-userland/electron-builder/blob/1e432785e3e2e42fc073a2f816ad7d3eeebe2898/packages/electron-updater/src/providers/GenericProvider.ts)

**The generic provider is NOT a separate format** - it serves the exact same latest.yml / latest-mac.yml / latest-linux.yml from a configurable base URL. The only difference from the GitHub provider is:
- No GitHub API integration (no release notes fetching, no pre-release handling)
- URL is a static base URL + filename
- Channel is encoded in the filename (beta.yml, alpha.yml, latest.yml)

#### URL pattern

```
{base_url}/{channel}{-platform}{-arch}.yml
{base_url}/{filename_from_manifest}
```

Example:
```
https://releases.airiz-motor.com/console/latest.yml
https://releases.airiz-motor.com/console/beta-mac.yml
https://releases.airiz-motor.com/console/TestApp Setup 2.1.0.exe
```

#### Configuration (in app-update.yml)

```yaml
provider: generic
url: https://releases.airiz-motor.com/console
channel: latest
```

#### Staging

The generic provider sends the X-USER-STAGING-ID header (the client UUID) so the **server** can decide whether to return the staged or non-staged manifest. This is the mechanism flagged in [issue #7728](https://github.com/electron-userland/electron-builder/issues/7728).
---

## LAYER 2: Minimum Viable Unified Manifest Subset

### Design Goals

ONE manifest format that satisfies ALL five surfaces with zero per-platform variants:
1. electron-updater (via generic provider - serves latest.yml from this manifest)
2. Tauri updater (minimal adaptation - serves JSON from this manifest)
3. Capacitor Live Update / HotCodePush (minimal adaptation - channel index derived)
4. PWA Service Worker (SW fetches this manifest to check for new assets)
5. Cloudflare Worker (this IS the deploy descriptor - Worker reads it to route assets)

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Channel model | Single manifest + channel field | Avoids N files per channel |
| Multi-arch model | platforms map (target-keyed) | Tauri os-arch-bundle_type + Electron packages + HCP platform array |
| Delta vs full | Optional delta block | Squirrel -delta.nupkg + Sparkle sparkle:deltas + HCP deltas[] |
| Signature | Per-binary + manifest-level Ed25519 | Closes the unsigned-manifest gap in electron/Tauri/PWA |
| Staged rollout | rolloutPercent + client-side hash | No privacy leak (unlike electron X-USER-STAGING-ID) |
| Promotion | New version = new release | Not a flag flip |

### Proposed Unified JSON Schema (airiz-update-manifest-v1)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://airiz-motor.com/schemas/update-manifest-v1.json",
  "title": "AIRIZ Motor Console Update Manifest v1",
  "type": "object",
  "required": ["schema","appId","version","releaseDate","signature","platforms"],
  "properties": {
    "schema": { "const": 1 },
    "appId": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "pattern": "^\d+\.\d+\.\d+" },
    "channel": { "type": "string", "enum": ["stable","beta","alpha","internal"], "default": "stable" },
    "releaseDate": { "type": "string", "format": "date-time" },
    "releaseNotes": { "type": ["string","null"] },
    "signature": { "type": "string", "description": "Ed25519 over canonical JSON (excl. this field). Base64." },
    "keyId": { "type": "string", "description": "sha256:<hex> of Ed25519 public key SPKI" },
    "rolloutPercent": { "type": "integer", "minimum": 0, "maximum": 100, "default": 100 },
    "minClientVersion": { "type": ["string","null"] },
    "platforms": {
      "type": "object",
      "description": "Keyed by {os}-{arch}-{bundle_type}. Fallback: {os}-{arch}",
      "additionalProperties": {
        "type": "object",
        "required": ["url","sha256","sizeBytes","signature"],
        "properties": {
          "url": { "type": "string", "format": "uri" },
          "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "sha512": { "type": "string", "description": "For electron compat (base64)" },
          "sizeBytes": { "type": "integer", "minimum": 1 },
          "signature": { "type": "string" },
          "bundleType": { "type": "string", "enum": ["exe","msi","app","appimage","deb","rpm","dmg","zip","msix","js","sw"] },
          "delta": {
            "type": ["object","null"],
            "properties": {
              "baseVersion": { "type": "string" },
              "url": { "type": "string", "format": "uri" },
              "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
              "sizeBytes": { "type": "integer", "minimum": 1 },
              "signature": { "type": "string" }
            }
          }
        }
      }
    },
    "sw": {
      "type": ["object","null"],
      "properties": {
        "url": { "type": "string", "format": "uri" },
        "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "skipWaiting": { "type": "boolean", "default": false },
        "assets": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["path","sha256","sizeBytes"],
            "properties": {
              "path": { "type": "string" },
              "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
              "sizeBytes": { "type": "integer" },
              "cacheName": { "type": "string" }
            }
          }
        }
      }
    },
    "worker": {
      "type": ["object","null"],
      "properties": {
        "version": { "type": "string" },
        "module": { "type": "string" },
        "bindings": { "type": "object" }
      }
    },
    "electronCompat": {
      "type": ["object","null"],
      "properties": {
        "releaseName": { "type": ["string","null"] },
        "stagingPercentage": { "type": "integer", "minimum": 0, "maximum": 100 }
      }
    }
  }
}
```

### Example: Complete Release Manifest

```json
{
  "schema": 1,
  "appId": "airiz-motor-console",
  "version": "2.1.0",
  "channel": "stable",
  "releaseDate": "2026-11-05T08:00:00Z",
  "releaseNotes": "Battery optimization, telemetry crash fix, new dashboard widgets",
  "signature": "base64ed25519sig==",
  "keyId": "sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
  "rolloutPercent": 100,
  "minClientVersion": "2.0.0",
  "platforms": {
    "windows-x86_64-exe": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ_2.1.0_x64-setup.exe",
      "sha256": "a3f2b8c9d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0",
      "sha512": "Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==",
      "sizeBytes": 42368000,
      "signature": "base64minisignsig==",
      "bundleType": "exe",
      "delta": {
        "baseVersion": "2.0.0",
        "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ_2.0.0_to_2.1.0.nupkg",
        "sha256": "b4e3c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8",
        "sizeBytes": 1048576,
        "signature": "base64deltasig=="
      }
    },
    "darwin-aarch64-app": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ-2.1.0.dmg",
      "sha256": "c5d4e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9",
      "sizeBytes": 45678901,
      "signature": "base64ed25519macsig==",
      "bundleType": "dmg",
      "delta": null
    },
    "linux-x86_64-appimage": {
      "url": "https://releases.airiz-motor.com/console/2.1.0/AIRIZ_2.1.0_x86_64.AppImage",
      "sha256": "d6e5f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0",
      "sizeBytes: 48000000,
      "signature": "base64linuxsig==",
      "bundleType": "appimage",
      "delta": null
    }
  },
  "sw": {
    "url": "https://airiz-motor.com/console/sw.js?v=2.1.0",
    "sha256": "e7f6a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
    "skipWaiting": false,
    "assets": [
      { "path": "/console/index.html", "sha256": "a1a2...", "sizeBytes": 4096, "cacheName": "app-v2.1.0" },
      { "path": "/console/assets/main.js", "sha256": "b2b3...", "sizeBytes": 512000, "cacheName": "app-v2.1.0" }
    ]
  },
  "worker": {
    "version": "2.1.0",
    "module": "console-worker.js",
    "bindings": { "ASSETS": "console-assets", "KV": "console-config" }
  },
  "electronCompat": {
    "releaseName": "v2.1.0",
    "stagingPercentage": 100
  }
}
```

### Per-Platform Adapter Mapping

| Unified field | electron | Tauri | HotCodePush | PWA SW | CF Worker |
|---------------|----------|-------|-------------|--------|-----------|
| version | latest.yml.version | version | bundleVersion | N/A | worker.version |
| url | files[0].url | url / platforms[key].url | pack.url | sw.url | N/A |
| sha256 | N/A | N/A | files[].sha256 | sw.sha256 | N/A |
| sha512 | files[0].sha512 | N/A | N/A | N/A | N/A |
| signature | N/A (codesign) | .signature | envelope.signature | N/A | N/A |
| delta | blockmap | N/A | deltas[] | N/A | N/A |
| channel | filename | N/A | channelId | N/A | N/A |
| rollout | stagingPercentage | N/A | rolloutPercent | N/A | N/A |
| manifest sig | N/A | N/A | env.sig + sha256 | N/A | N/A |

### Server-Side Adapter (CF Worker as Update Server)

```
GET /update/latest.yml          - electron: transform to YAML, filter by channel
GET /update/manifest.json       - Tauri: transform to Tauri JSON (static platforms shape)
GET /update/channel-index.json  - HotCodePush: transform to ChannelIndex v1
GET /sw.js                      - PWA: serve new SW if version differs
GET /worker-manifest.json       - CF Worker: this IS the manifest
```

### Signature Envelope Design

```
  [Unified Manifest - canonical JSON]
  ALL fields EXCEPT 'signature'
  Keys sorted lexicographically
  No whitespace, no trailing commas
         |
         v  Ed25519 Sign(canonical_bytes, private_key)
         |
  [signature field - base64]
```

Per-artifact signatures (in platforms.*.signature):
- electron: skip (binary is Authenticode signed)
- Tauri: minisign over the .exe/.msi/.AppImage bytes
- Sparkle: Ed25519 over the .dmg bytes
- HotCodePush: Ed25519 over the .tar.gz pack
- PWA: SHA-256 only (TLS + SW integrity)

### Staged Rollout (Client-Side, Privacy-Preserving)

```
function shouldApply(rolloutPercent, appId, version, deviceId):
  if rolloutPercent >= 100: return true
  if rolloutPercent <= 0: return false
  hash = SHA-256(appId + version + deviceId)
  bucket = parseInt(hash[0:8], 16) / 0xFFFFFFFF
  return bucket < (rolloutPercent / 100.0)
```

Avoids the X-USER-STAGING-ID privacy issue (electron-builder#7728).

### Channel Promotion

- NOT a flag flip. A new version IS a promotion.
- channel=beta has version 2.2.0-beta.1. When ready: NEW manifest channel=stable version=2.2.0.
- Server serves different manifests based on ?channel=beta query param.

### Open Gaps

1. electron-updater manifest signing: No open RFC. Issue #7728 closed as stale, no fix.
2. Tauri manifest signing: requireSignedVersion exists but manifest unsigned. No open RFC.
3. PWA update manifest: No W3C proposal. SW update is byte-comparison only.
4. HotCodePush is closest to unified: two-layer, canonical JSON sig, conditions, rollout, deltas, revocation.

---

## EVIDENCE: Real-World Protocol Gaps

### GitHub Issues

1. [electron-builder#7728](https://github.com/electron-userland/electron-builder/issues/7728) - X-USER-STAGING-ID privacy violation. Closed stale, no fix. Impact: client-side hash.
2. [electron-builder#3499](https://github.com/electron-userland/electron-builder/issues/3499) - Staged rollouts poorly documented. Impact: explicit docs in our schema.
3. [electron-builder#6231](https://github.com/electron-userland/electron-builder/issues/6231) - stagingPercentage: 0 edge case. Impact: minimum 0 = blocked.
4. Tauri unsigned manifest: requireSignedVersion (default false) is the only mitigation. No RFC for manifest sig.
5. Sparkle phased rollout: time-based (sparkle:phasedRolloutInterval), not percentage-based. No cross-platform equivalent.

### Major Electron App Comparison

| App | Protocol | Manifest | Signing | Staging |
|-----|----------|----------|---------|---------|
| Slack desktop | electron-updater generic | latest.yml | Binary codesign | stagingPercentage |
| Cursor | electron-updater GitHub | latest.yml via GH Releases | Binary codesign | GH pre-release |
| Notion desktop | electron-updater generic | latest.yml | Binary codesign | N/A |

All use latest.yml with NO manifest-level signature. Rely on HTTPS + codesign + publisher trust.
Our schema adds manifest-level Ed25519 to close this gap.

---

## FIELD CROSS-REFERENCE MATRIX

| Field | electron | Tauri | HotCodePush | Squirrel | Sparkle | Expo | MSIX | PWA |
|-------|----------|-------|-------------|----------|---------|------|------|-----|
| version | version | version | bundleVersion | (filename) | sparkle:version | runtimeVer | (Uri) | (URL) |
| channel | filename | N/A | channelId | N/A | sparkle:channel | channel | N/A | N/A |
| url | files[].url | url | pack.url | Filename | enc.url | manifest | Uri | sw.url |
| sha256 | N/A | N/A | files[].sha256 | N/A | N/A | N/A | Hash | assets[].sha256 |
| sha512 | files[].sha512 | N/A | N/A | N/A | N/A | N/A | N/A | N/A |
| size | files[].size | N/A | sizeBytes | Filesize | enc.length | N/A | N/A | sizeBytes |
| sig | N/A | .signature | env.sig | N/A | edSignature | N/A | N/A | N/A |
| delta | blockmap | N/A | deltas[] | -delta.nupkg | sparkle:deltas | N/A | N/A | N/A |
| date | releaseDate | pub_date | createdAt | N/A | pubDate | N/A | N/A | N/A |
| notes | releaseNotes | notes | rel[].notes | (.nuspec) | description | message | RelNotes | N/A |
| rollout | stagingPct | N/A | rolloutPct | # NN% | phasedInt | rollout | N/A | N/A |

---

## IMPLEMENTATION CHECKLIST

- [ ] CF Worker serving unified manifest in 5 formats
- [ ] electron-updater adapter (YAML transform)
- [ ] Tauri adapter (JSON, static platforms shape)
- [ ] HotCodePush adapter (channel index + envelope)
- [ ] PWA SW adapter (SW script + asset list)
- [ ] Ed25519 manifest signing in CI
- [ ] Per-artifact minisign for Tauri targets
- [ ] Client-side rollout hash
- [ ] Revocation list support
- [ ] Test: electron gets valid latest.yml
- [ ] Test: Tauri gets valid JSON
- [ ] Test: HotCodePush gets valid channel index
- [ ] Test: PWA SW detects update
- [ ] Test: CF Worker deploys from worker block

---

## REFERENCES

1. [electron-builder @ 1e432785](https://github.com/electron-userland/electron-builder/tree/1e432785e3e2e42fc073a2f816ad7d3eeebe2898)
2. [tauri-plugin-updater @ 3cba6fbf](https://github.com/tauri-apps/tauri-plugin-updater/tree/3cba6fbfd359c843ac799416ffcbb704099987f6)
3. [hotcodepush protocol @ c1fc7592](https://github.com/hotcodepush-team/protocol/tree/c1fc759213f8561f59d00e32bec6da8897b77e90)
4. [Squirrel.Windows @ 51f5e2cb](https://github.com/Squirrel/squirrel.windows/tree/51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f)
5. [Sparkle](https://github.com/sparkle-project/Sparkle)
6. [Expo Update](https://docs.expo.dev/eas-update/introduction.md)
7. [W3C Web App Manifest WD 2026-10-26](https://www.w3.org/TR/appmanifest/)
8. [MSIX docs](https://learn.microsoft.com/en-us/windows/msix/package/)
9. [electron-updater docs](https://www.electron.build/auto-update)
10. [Tauri updater docs](https://tauri.app/plugin/updater/)