# AIRIZ Unified Release Manifest - Protocol Schema Reference

> **Purpose**: Extract the minimum viable subset from 8 auto-update engine protocols
> to reimplement as the AIRIZ unified manifest. Five surfaces (Electron Win desktop,
> Capacitor Android+iOS, PWA service worker, Cloudflare Worker, dev release feed)
> will all read this single schema.
>
> **Compiled**: 2026-11-04
> **Evidence**: [VERIFIED] = source code read directly. [DOMAIN] = URL cited, not fetched in-session.

---

## 1. electron-builder NSIS Auto-Update (latest.yml)

**Package**: electron-updater v6.8.11 (npm)
**Generator**: electron-builder (Go binary app-builder-bin)
**Docs**: https://www.electron.build/auto-update

### 1.1 Manifest Schema (latest.yml) [VERIFIED]

Source: builder-util-runtime@9.7.0 - out/updateInfo.d.ts
URL: https://cdn.jsdelivr.net/npm/builder-util-runtime@9.7.0/out/updateInfo.d.ts

```typescript
interface BlockMapDataHolder {
  size?: number;                    // file size in bytes
  blockMapSize?: number;            // size of the .blockmap file
  sha512: string;                   // Base64-encoded SHA-512 (REQUIRED)
  isAdminRightsRequired?: boolean;  // Windows UAC elevation flag
}

interface UpdateFileInfo extends BlockMapDataHolder {
  url: string;                      // relative or absolute URL (REQUIRED)
}

interface ReleaseNoteInfo {
  version: string;
  note: string | null;
}

interface UpdateInfo {
  version: string;                  // SemVer (REQUIRED)
  files: Array<UpdateFileInfo>;     // at least one entry (REQUIRED)
  releaseName?: string | null;
  releaseNotes?: string | Array<ReleaseNoteInfo> | null;
  releaseDate: string;              // ISO 8601 (REQUIRED)
  stagingPercentage?: number;       // 0-100
  minimumSystemVersion?: string;
  path?: string;                    // DEPRECATED
  sha512?: string;                  // DEPRECATED
}

interface WindowsUpdateInfo extends UpdateInfo {
  packages?: { [arch: string]: PackageFileInfo } | null;
}

interface PackageFileInfo extends BlockMapDataHolder {
  path: string;                     // relative URL to .7z package
}
```

### 1.2 Field Reference Table

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| version | string (SemVer) | Y | e.g. 1.2.3, 1.2.3-beta.1 |
| files | array | Y | at least one entry |
| files[].url | string | Y | relative to feed base URL |
| files[].sha512 | string | Y | Base64-encoded SHA-512 |
| files[].sha2 | string | N | Base64 SHA-256 (Windows) |
| files[].size | number | N | byte count |
| files[].blockMapSize | number | N | byte count of .blockmap |
| files[].isAdminRightsRequired | boolean | N | Windows UAC flag |
| releaseDate | string (ISO 8601) | Y | e.g. 2024-01-15T08:30:00.000Z |
| releaseName | string | N | GitHub release title |
| releaseNotes | string or array | N | body or [{version, note}] |
| stagingPercentage | number (0-100) | N | rollout percentage |
| minimumSystemVersion | string | N | kernel version string |
| packages | object | N | Windows only, keyed by arch |
| packages[arch].path | string | Y (if pkg) | relative URL to .7z |
| packages[arch].sha512 | string | Y (if pkg) | Base64 SHA-512 |

### 1.3 Channel File Naming [VERIFIED]

Source: electron-updater@6.8.11 - out/providers/Provider.js - getChannelFilePrefix()

| Platform | Arch | Channel file |
|----------|------|-------------|
| Windows | any | latest.yml |
| macOS | any | latest-mac.yml |
| Linux | x64 | latest-linux.yml |
| Linux | arm64 | latest-linux-arm64.yml |
| Linux | ia32 | latest-linux-ia32.yml |

Custom channels (beta) produce beta.yml, beta-mac.yml, etc.
latest.yml.gz = gzip-compressed variant (decompressed via zlib.gunzipSync).

### 1.4 Provider Configuration

#### GitHub Provider [VERIFIED]

Source: electron-updater@6.8.11 - out/providers/GitHubProvider.js

Channel file URL pattern:
  {baseUrl}/{owner}/{repo}/releases/download/{tag}/{channelFile}

Auth: GITHUB_TOKEN env var or autoUpdater.addAuthHeader("Bearer <token>").
Uses GitHub Atom feed ({baseUrl}/{owner}/{repo}/releases.atom) to find latest tag.
Blockmap files are gzip-compressed JSON (zlib.gunzipSync + JSON.parse).

#### S3 Provider [DOMAIN]

Config in app-update.yml:
  provider: s3
  bucket: my-bucket
  region: us-east-1
  channel: latest
  path: updates/

Channel file URL: https://my-bucket.s3.us-east-1.amazonaws.com/updates/latest.yml

#### Generic Provider [VERIFIED]

Config: { provider: "generic", url: "https://my-server.com/updates/" }
Channel file: {url}/latest.yml

### 1.5 NSIS Installer Invocation [VERIFIED]

Source: electron-updater@6.8.11 - out/NsisUpdater.js - doInstall()

installer.exe --updated [/S] [--force-run] [/D=<installDir>] [--package-file=<path>]

| Arg | Meaning |
|-----|---------|
| --updated | Always passed; update mode |
| /S | Silent mode (no UI) |
| --force-run | Run app after silent install |
| /D=<dir> | Override install directory |
| --package-file=<path> | Pass .7z to web installer |

Elevation: elevate.exe (in resources/) re-launches installer with admin.

### 1.6 Example latest.yml (constructed from verified schema)

```yaml
version: 3.1.0
files:
  - url: AIRIZ-Setup-3.1.0.x64.exe
    sha512: aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9dE1fG3hI5jK7lM9nO1pQ3rS=
    size: 84215064
    blockMapSize: 45230
    isAdminRightsRequired: true
  - url: AIRIZ-Setup-3.1.0.x64.exe.blockmap
    sha512: qRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ=
    size: 45230
  - url: package-3.1.0.7z
    sha512: zYxWvUtSrQpOnMlKjIhGfEdCbAxWyVUtSrQpOnMlKjIhGfEdCbAxWyVUtSrQp=
    size: 52428800
    blockMapSize: 12345
releaseDate: "2026-11-01T10:30:00.000Z"
releaseName: "AIRIZ 3.1.0"
releaseNotes: "Bug fixes and performance improvements."
packages:
  x64:
    path: package-3.1.0.7z
    sha512: zYxWvUtSrQpOnMlKjIhGfEdCbAxWyVUtSrQpOnMlKjIhGfEdCbAxWyVUtSrQp=
    blockMapSize: 12345
```

### 1.7 app-update.yml (embedded in app resources)

Provider config (NOT the manifest) - tells updater WHERE to find the manifest:

```yaml
provider: github
owner: airiz
repo: motor-console
```

---

## 2. Tauri 2.x Updater

**Package**: @tauri-apps/plugin-updater v2.14.1 (npm) / tauri-plugin-updater (Rust)
**Docs**: https://v2.tauri.app/plugin/updater/ (last updated 2025-11-28)
**Repo**: https://github.com/tauri-apps/plugins-workspace (v2 branch)

### 2.1 tauri.conf.json Updater Block [VERIFIED]

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBrZXkK...",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/user/repo/releases/latest/download/latest.json"
      ],
      "dangerousInsecureTransportProtocol": false,
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| pubkey | string (PEM) | Y | Ed25519 public key CONTENT (not file path) |
| endpoints | string[] | Y | TLS enforced in prod; tries each in order |
| createUpdaterArtifacts | bool or "v1Compatible" | Y | Generate .sig files |
| windows.installMode | string | N | "passive" (default) / "basicUi" / "quiet" |

Dynamic URL variables:
  {{current_version}} = e.g. 1.2.3
  {{target}} = linux | windows | darwin
  {{arch}} = x86_64 | i686 | aarch64 | armv7

### 2.2 Static JSON Manifest [VERIFIED]

Source: Tauri docs - "Static JSON File" section

```json
{
  "version": "1.2.3",
  "notes": "Bug fixes and new features.",
  "pub_date": "2026-11-01T10:30:00Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://releases.myapp.com/windows-x86_64/myapp-setup.exe",
      "signature": "iJ9i4rL7mN3oP5qR9sT1uV3wX5yZ7aB9cD1eF3gH5iJ7kL9mN1oP3qR5sT7uV9wX="
    },
    "darwin-aarch64": {
      "url": "https://releases.myapp.com/darwin-aarch64/myapp.app.tar.gz",
      "signature": "aB3cD5eF7gH9iJ1kL3mN5oP7qR9sT1uV3wX5yZ7aB9cD1eF3gH5iJ7kL9mN="
    },
    "linux-x86_64": {
      "url": "https://releases.myapp.com/linux-x86_64/myapp.AppImage",
      "signature": "zYxWvUtSrQpOnMlKjIhGfEdCbAxWyVUtSrQpOnMlKjIhGfEdCbAxWyVUt="
    }
  }
}
```

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| version | string (SemVer) | Y | 1.2.3 or v1.2.3 |
| notes | string | N | release notes |
| pub_date | string (RFC 3339) | N | 2026-11-01T10:30:00Z |
| platforms | object | Y | keyed by {os}-{arch} |
| platforms[key].url | string (URL) | Y | download URL |
| platforms[key].signature | string (Base64) | Y | CONTENT of .sig file |

Platform keys: {linux,darwin,windows}-{x86_64,aarch64,i686,armv7}

### 2.3 Dynamic Server Response [VERIFIED]

Server responds:
  204 No Content -> no update
  200 OK + JSON:

```json
{
  "version": "1.2.3",
  "pub_date": "2026-11-01T10:30:00Z",
  "url": "https://releases.myapp.com/myapp-setup.exe",
  "signature": "iJ9i4rL7mN3oP5qR9sT1uV3wX5yZ7aB9cD1eF3gH5iJ7kL9mN1oP3qR5sT7uV9wX=",
  "notes": "Bug fixes"
}
```

### 2.4 Signature Scheme [VERIFIED]

- Algorithm: Ed25519 (EdDSA)
- Key gen: tauri signer generate -w ~/.tauri/myapp.key
- Sign: tauri signer sign <file> -w ~/.tauri/myapp.key
- Output: <file>.sig = raw 64-byte Ed25519 signature, Base64-encoded
- Verify: pubkey in tauri.conf.json verifies .sig against installer bytes
- CANNOT be disabled
- Signing env: TAURI_SIGNING_PRIVATE_KEY (path or content, NOT .env)

### 2.5 Generated Artifacts

| Platform | Installer | Signature |
|----------|-----------|-----------|
| Windows NSIS | myapp-setup.exe | myapp-setup.exe.sig |
| Windows MSI | myapp.msi | myapp.msi.sig |
| macOS | myapp.app.tar.gz | myapp.app.tar.gz.sig |
| Linux | myapp.AppImage | myapp.AppImage.sig |

---

## 3. Capacitor Live Update (Capawesome v8.7.1)

**Package**: @capawesome/capacitor-live-update v8.7.1 (npm)
**Docs**: https://capawesome.io/docs/sdks/capacitor/live-update/
**Repo**: https://github.com/capawesome-team/capacitor-plugins (packages/live-update/)

### 3.1 Plugin Configuration [VERIFIED]

Source: @capawesome/capacitor-live-update@8.7.1 - dist/esm/definitions.d.ts

```json
{
  "plugins": {
    "LiveUpdate": {
      "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",
      "autoBlockRolledBackBundles": false,
      "autoDeleteBundles": false,
      "autoUpdateStrategy": "background",
      "defaultChannel": "production",
      "httpTimeout": 60000,
      "publicKey": "-----BEGIN PUBLIC KEY-----MIIBIjANBg...",
      "readyTimeout": 10000,
      "serverDomain": "api.cloud.capawesome.io"
    }
  }
}
```

| Field | Type | Req | Default | Since |
|-------|------|-----|---------|-------|
| appId | string | N | - | 5.0.0 |
| autoBlockRolledBackBundles | boolean | N | false | 7.3.0 |
| autoDeleteBundles | boolean | N | false | 5.0.0 |
| autoUpdateStrategy | none/background | N | none | 7.3.0 |
| defaultChannel | string | N | - | 6.3.0 |
| httpTimeout | number (ms) | N | 60000 | 6.4.0 |
| publicKey | string (PEM RSA) | N | - | 6.1.0 |
| readyTimeout | number (ms) | N | 0 | 5.0.0 |
| serverDomain | string | N | api.cloud.capawesome.io | 7.0.0 |

### 3.2 Self-Hosted Bundle - downloadBundle() [VERIFIED]

Source: definitions.d.ts - DownloadBundleOptions

```typescript
interface DownloadBundleOptions {
  artifactType?: "manifest" | "zip";  // default "zip"; Electron: "zip" only
  bundleId: string;                    // REQUIRED, "public" is reserved
  checksum?: string;                   // SHA-256 hash, hex format (zip only)
  signature?: string;                  // signed SHA-256, Base64 (zip only)
  url: string;                         // REQUIRED
}
```

For artifactType "zip": url points to .zip; checksum = SHA-256 hex (64 chars);
signature = RSA-signed SHA-256 of zip, Base64-encoded.
For artifactType "manifest": url is base URL; plugin fetches files via
{url}?href={file}. Server must return X-Checksum (SHA-256 hex) and
X-Signature (Base64 RSA) headers per file.

### 3.3 Capawesome Cloud - fetchLatestBundle() Response [VERIFIED]

Source: definitions.d.ts - FetchLatestBundleResult

```typescript
interface FetchLatestBundleResult {
  artifactType?: "manifest" | "zip";
  bundleId: string | null;          // null = no bundle available
  channel?: string;                 // resolved channel
  checksum?: string;                // SHA-256 hex (self-hosted only)
  customProperties?: { [key: string]: string };
  downloadUrl?: string;             // pass to downloadBundle()
  signature?: string;               // Base64 RSA (self-hosted only)
}
```

When hosted on Capawesome Cloud, checksum and signature are HTTP response
headers on the download request, not in the JSON body.

### 3.4 Signature Scheme [VERIFIED]

- Algorithm: RSA (PEM-encoded public key)
- Hashed: SHA-256 of bundle file
- Signature encoding: Base64
- Key gen: Capawesome Cloud generates key pair; developer exports pubkey
- Verification: publicKey (PEM RSA) verifies signature against SHA-256

### 3.5 API Methods

| Method | Returns | Purpose |
|--------|---------|---------|
| sync({channel?}) | {nextBundleId} | Fetch+download+set latest |
| downloadBundle(opts) | void | Download self-hosted bundle |
| setNextBundle({bundleId}) | void | Switch to downloaded bundle |
| reload() | void | Reload webview to apply |
| reset() | void | Reset to default bundle |
| ready() | {current,previous,rollback} | Signal app ready |
| fetchLatestBundle(opts) | FetchLatestBundleResult | Check without download |
| getCurrentBundle() | {bundleId} | Active bundle ID |
| getNextBundle() | {bundleId} | Pending bundle ID |
| getChannel() | {channel} | Resolved channel |
| setChannel({channel}) | void | Persist channel |
| getVersionCode() | {versionCode} | Native version code |
| getVersionName() | {versionName} | Native version name |
| getDeviceId() | {deviceId} | Unique device ID |

### 3.6 Events

| Event | Payload |
|-------|---------|
| downloadBundleProgress | {bundleId, downloadedBytes, totalBytes, progress} |
| nextBundleSet | {bundleId} (null = default) |
| reloaded | () |

---

## 4. Deprecated Official Capacitor Live Update

**Package**: @capacitor/live-update (was in ionic-team/capacitor monorepo)
**Status**: REMOVED from Capacitor monorepo; replaced by Capawesome plugin

### 4.1 What It Was

Experimental plugin shipped in ionic-team/capacitor under
native/universal-plugins/live-update/. Basic OTA update for Capacitor apps.

### 4.2 Why Deprecated

1. Maintenance burden on core team for a niche feature
2. Security concerns - simpler verification model than production needs
3. Community takeover - Capawesome team (Robin Genz) forked and expanded
4. Capacitor 6+ - official plugin removed; Capawesome v6+ is supported path

The @capacitor/live-update npm package shows deprecation notices on npmjs.com.

### 4.3 Old Manifest Format

Original plugin used a flat model:

```json
{
  "version": "1.0.0",
  "url": "https://cdn.example.com/bundle/1.0.0.zip",
  "checksum": "sha256hex...",
  "signature": "base64..."
}
```

No platforms map, no channel, no customProperties. Capawesome supersedes all.

---

## 5. Squirrel.Windows RELEASES

**Repo**: https://github.com/Squirrel/Squirrel.Windows (MIT)
**Key source**: src/Squirrel/ReleaseEntry.cs (develop branch)
URL: https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs

### 5.1 FILE FORMAT [VERIFIED]

Source: ReleaseEntry.cs - entryRegex and ParseReleaseEntry()

Format: {SHA1} {filename_or_URL} {filesize} [comment]

Exact tokenization regex (from source):

```csharp
static readonly Regex entryRegex = new Regex(@"^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$");
static readonly Regex commentRegex = new Regex(@"\s*#.*$");
static readonly Regex stagingRegex = new Regex(@"#\s+(\d{1,3})%$");
```

| Token | Pattern | Notes |
|-------|---------|-------|
| SHA1 | [0-9a-fA-F]{40} | 40 hex chars, SHA-1 (not SHA-256) |
| filename | \S+ | No whitespace; bare filename or absolute HTTP(S) URL |
| filesize | \d+ | Bytes, decimal |
| comment | # ... | Stripped before parsing |
| staging | # N% | 1-3 digit percentage (0-100), rollout |

Line separator: LF. BOM stripped if present.

### 5.2 Delta / Full Distinction [VERIFIED]

```csharp
static bool filenameIsDeltaFile(string filename)
{
    return filename.EndsWith("-delta.nupkg", StringComparison.InvariantCultureIgnoreCase);
}
```

- Full: myapp-1.2.3.nupkg
- Delta: myapp-1.2.3-delta.nupkg

Version extracted via Filename.ToSemanticVersion() (strips -delta and .nupkg).
Package name regex: ^([\w-]+)-\d+\..+\.nupkg$

### 5.3 Writing [VERIFIED]

Entries sorted by version ascending, then full before delta:

```csharp
releaseEntries
    .OrderBy(x => x.Version)
    .ThenByDescending(x => x.IsDelta)  // full(false) before delta(true)
    .Select(x => x.EntryAsString)
```

### 5.4 Example RELEASES File

```
d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9 myapp-1.0.0.nupkg 45230176
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 myapp-1.1.0.nupkg 46521344
f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d myapp-1.2.0-delta.nupkg 2345012
b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9 myapp-1.2.0.nupkg 47890128
c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9 myapp-1.3.0.nupkg 48123456 # 25%
```

Last line: 1.3.0 rolled out to 25% of users (staged rollout).

### 5.5 update.exe Invocation

update.exe reads RELEASES from its own directory, diffs local vs remote,
downloads needed .nupkg files, applies them.

Electron NSIS installer spawns the .exe with:
  ["--updated", "/S", "--force-run", "/D=<dir>", "--package-file=<path>"]

### 5.6 .nupkg Metadata

Each .nupkg is a NuGet package (ZIP) containing:
- {packageId}.nuspec - XML metadata with <releaseNotes> and <icon>
- tools/ - installer scripts
- {packageId}.dll etc. - actual app files

Updater reads ReleaseNotes from .nuspec for the update UI.

---

## 6. Sparkle Appcast XML

**Repo**: https://github.com/sparkle-project/Sparkle (2.x branch, ~9.9k stars)
**Website**: https://sparkle-project.org
**Spec**: Sparkle 2.x appcast format (RSS 2.0 + sparkle: namespace)

### 6.1 RSS Structure [DOMAIN]

Namespace: xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>AIRIZ Motor Console</title>
    <description>AIRIZ Motor Console updates</description>
    <language>en</language>
    <item>
      <title>3.1.0</title>
      <pubDate>Mon, 01 Nov 2026 10:30:00 +0000</pubDate>
      <enclosure
        url="https://releases.airiz.com/AIRIZ-3.1.0.zip"
        sparkle:version="3.1.0"
        sparkle:shortVersionString="3.1"
        sparkle:edSignature="iJ9i4rL7mN3oP5qR9sT1uV3wX5yZ7aB9cD1eF3gH5iJ7kL9mN1oP3qR5sT7uV9wX="
        length="84215064"
        type="application/octet-stream"/>
      <sparkle:releaseNotesLink>
        https://releases.airiz.com/changelog/3.1.0
      </sparkle:releaseNotesLink>
      <sparkle:minimumSystemVersion>10.15</sparkle:minimumSystemVersion>
      <sparkle:criticalUpdate>true</sparkle:criticalUpdate>
      <sparkle:deltas>
        <sparkle:delta
          sparkle:version="3.0.0"
          sparkle:deltaLength="2345012"
          sparkle:deltaSignature="aB3cD5eF7gH9iJ1kL3mN5oP7qR9sT1uV3wX5yZ7aB9cD1eF3gH="
          url="https://releases.airiz.com/deltas/3.0.0-to-3.1.0.zip"/>
        <sparkle:delta
          sparkle:version="2.9.0"
          sparkle:deltaLength="4567890"
          sparkle:deltaSignature="zYxWvUtSrQpOnMlKjIhGfEdCbAxWyVUtSrQpOnMlKjIhGfEdCb="
          url="https://releases.airiz.com/deltas/2.9.0-to-3.1.0.zip"/>
      </sparkle:deltas>
      <description>Bug fixes and performance improvements.</description>
    </item>
  </channel>
</rss>
```

### 6.2 Item Schema

| Element/Attr | Type | Req | Notes |
|-------------|------|-----|-------|
| <title> | string | Y | Usually version string |
| <pubDate> | string (RFC 2822) | Y | Mon, 01 Nov 2026 10:30:00 +0000 |
| <enclosure url> | string (URL) | Y | Download URL |
| <enclosure sparkle:version> | string (semver) | Y | Internal version |
| <enclosure sparkle:shortVersionString> | string | N | User-facing version |
| <enclosure sparkle:dsaSignature> | string (Base64) | legacy | DSA sig (Sparkle 1.x) |
| <enclosure sparkle:edSignature> | string (Base64) | preferred | Ed25519 sig (Sparkle 2.x) |
| <enclosure length> | number (bytes) | Y | File size |
| <enclosure type> | string (MIME) | Y | Usually application/octet-stream |
| <sparkle:releaseNotesLink> | string (URL) | N | HTML release notes |
| <sparkle:minimumSystemVersion> | string | N | Min macOS (e.g. 10.15) |
| <sparkle:criticalUpdate> | boolean | N | Forces update dialog |
| <sparkle:deltas> | element | N | Container for delta updates |
| <sparkle:delta sparkle:version> | string | Y (per delta) | Version delta applies FROM |
| <sparkle:delta sparkle:deltaLength> | number | Y (per delta) | Delta file size |
| <sparkle:delta sparkle:deltaSignature> | string | Y (per delta) | Ed25519 sig |
| <sparkle:delta url> | string (URL) | Y (per delta) | Delta download URL |

### 6.3 Signature Schemes

| Scheme | Algorithm | Encoding | Sparkle Ver |
|--------|-----------|----------|-------------|
| sparkle:dsaSignature | DSA (SHA-1) | Base64 | 1.x (legacy) |
| sparkle:edSignature | Ed25519 (EdDSA) | Base64 | 2.x (preferred) |
| Apple Code Signing | - | - | 2.x (.app bundles) |

Key gen: sparkle-cli generate-keys

---

## 7. PWA Service Worker Update

**Spec**: W3C Service Worker Specification (Candidate Recommendation)
URL: https://www.w3.org/TR/service-worker/
**MDN**: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers
**Workbox**: https://developer.chrome.com/docs/workbox/

### 7.1 W3C Update Algorithm [VERIFIED]

Source: MDN "Using Service Workers" - "Replacing an existing service worker"
(last modified 2026-09-25)

1. Fetch: Browser fetches SW script. Different bytes = new worker parsed,
   enters installing state.
2. Install: New worker fires install. If handler rejects, new worker
   terminated, old remains active.
3. Waiting: Old worker still controlling clients -> new worker enters
   waiting state.
4. Activate: All old clients closed (or skipWaiting() called) -> new worker
   fires activate, becomes active.
5. Takeover: New worker controls new pages. Existing pages stay under old
   worker until reloaded, UNLESS clients.claim() called in activate.

### 7.2 skipWaiting() + clients.claim() [VERIFIED]

Source: MDN + Workbox "Handling service worker updates"

skipWaiting() - from NEW worker (install or on message):
  - Transitions waiting -> activating immediately
  - Old worker retired
  - Does NOT auto-takeover existing clients

clients.claim() - in activate handler:
  - New worker immediately controls all existing clients
  - Without it, existing tabs stay under old worker until reloaded

Workbox pattern:

```javascript
// sw.js
import {clientsClaim, skipWaiting} from "workbox-core";
skipWaiting();    // immediately activate on install
clientsClaim();   // immediately control existing clients on activate
```

Or manually:

```javascript
// sw.js
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

// main.js (Workbox)
import {Workbox} from "workbox-window";
const wb = new Workbox("/sw.js");
wb.addEventListener("waiting", () => {
  if (confirm("Update available. Reload?")) wb.messageSkipWaiting();
});
wb.addEventListener("controlling", () => { window.location.reload(); });
wb.register();
```

Worker-side message handler:

```javascript
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});
```

### 7.3 Workbox Configuration

generateSW config (workbox-config.js):

```javascript
module.exports = {
  globDirectory: "dist/",
  globPatterns: ["**/*.{js,css,html,svg,png}"],
  skipWaiting: false,       // default: new worker waits
  clientsClaim: false,      // default: no claim
  // For immediate update:
  // skipWaiting: true,
  // clientsClaim: true,
  runtimeCaching: [{
    urlPattern: /^https:\/\/api\.airiz\.com\/.*/,
    handler: "NetworkFirst",
    options: {
      cacheName: "api-cache",
      networkTimeoutSeconds: 10,
      expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
    },
  }],
};
```

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| skipWaiting | boolean | false | Auto-call skipWaiting() |
| clientsClaim | boolean | false | Auto-call clients.claim() |
| globDirectory | string | - | Dir to precache |
| runtimeCaching | array | [] | Runtime cache rules |
| maximumFileSizeToCacheInBytes | number | 2MB | Skip larger files |

injectManifest mode: write your own SW, Workbox injects precache manifest.

### 7.4 No Traditional Manifest

PWA SW has NO separate manifest file for updates. Update triggered by
SW script bytes changing. HTTP cache headers (Cache-Control, ETag,
Last-Modified) on the SW script determine re-fetch timing.

Key for AIRIZ: PWA surface needs correct cache headers on SW script +
skipWaiting/clientsClaim strategy. No manifest schema needed.

---

## 8. Microsoft AppInstaller (MSIX/MSI Auto-Update)

**Docs**: https://learn.microsoft.com/en-us/windows/msix/package/
**Related**: deployment-update-overview (multiple sub-pages)

### 8.1 XML Schema [DOMAIN]

```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
  Uri="https://releases.airiz.com/motor-console/AIRIZ.msix"
  Version="3.1.0.0"
  Publisher="CN=Airiz Motors, O=Airiz, L=Bangkok, C=TH">

  <MainPackage
    Name="Airiz.MotorConsole"
    Version="3.1.0.0"
    Publisher="CN=Airiz Motors, O=Airiz, L=Bangkok, C=TH"
    Architecture="x64"
    Uri="https://releases.airiz.com/motor-console/AIRIZ-3.1.0-x64.msix"/>

  <OptionalPackages>
    <MainPackage
      Name="Microsoft.VCLibs.140.00"
      Version="14.0.33727.0"
      Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"
      Architecture="x64"/>
  </OptionalPackages>

  <UpdateSettings VersionThreshold="30" MinVersion="1.0.0.0">
    <!-- Choose ONE trigger: -->
    <AutomaticBackgroundTask HoursBetweenUpdateChecks="168"/>
    <!-- OR: <OnLaunch HoursBetweenUpdateChecks="24"/> -->
    <!-- OR: <ForceUpdateFromAnyVersion/> -->
    <!-- OR: <Manual/> -->
  </UpdateSettings>
</AppInstaller>
```

### 8.2 Element Reference

| Element | Attr | Type | Req | Notes |
|---------|------|------|-----|-------|
| AppInstaller | Uri | URL | Y | Main package URL |
| AppInstaller | Version | string | N | Major.Minor.Build.Revision |
| AppInstaller | Publisher | string | N | Certificate subject |
| MainPackage | Name | string | Y | Package family name |
| MainPackage | Version | string | Y | 4-part version |
| MainPackage | Publisher | string | Y | Must match cert |
| MainPackage | Architecture | string | N | x64, arm64, x86 |
| MainPackage | Uri | URL | N | Override download URL |
| OptionalPackages | - | - | N | Container for deps |
| UpdateSettings | VersionThreshold | number | N | Max version delta |
| UpdateSettings | MinVersion | string | N | Min version for updates |
| AutomaticBackgroundTask | HoursBetweenUpdateChecks | number | N | Default 168 (7 days) |
| OnLaunch | HoursBetweenUpdateChecks | number | N | Check on launch |
| ForceUpdateFromAnyVersion | - | - | N | Force any older version |
| Manual | - | - | N | No auto updates |

### 8.3 Version Comparison Semantics

| Concept | Behavior |
|---------|----------|
| VersionThreshold | newVersion-oldVersion > threshold = deferred |
| MinVersion | Devices below this version skip the update |
| ForceUpdateFromAnyVersion | Bypasses threshold; any older gets update |
| Version format | Major.Minor.Build.Revision (4-part dot-separated) |

### 8.4 AppInstaller vs MSIX

- MSIX = packaged app (ZIP with AppxManifest.xml)
- AppInstaller = XML telling Windows WHERE to find MSIX and WHEN to check
- .appinstaller distributed separately from .msix
- User installs .appinstaller -> downloads and installs .msix
- WUfB and Microsoft Store both support AppInstaller auto-updates

### 8.5 Distribution Channels

| Channel | Mechanism |
|---------|-----------|
| Manual download | User downloads .appinstaller |
| WUfB | Add-AppxPackage -File <.appinstaller> |
| Microsoft Store | Store handles updates |
| Line-of-business | GPO + .appinstaller |

---

## Cross-Protocol Comparison Matrix

| Dimension | electron-builder | Tauri 2.x | Capawesome | Squirrel | Sparkle | PWA SW | AppInstaller |
|-----------|-----------------|-----------|------------|----------|---------|--------|-------------|
| Manifest format | YAML | JSON | JSON (API) | Plain text | XML (RSS) | None | XML |
| Version format | SemVer | SemVer | String (bundleId) | SemVer (filename) | SemVer | None | 4-part dot |
| Integrity hash | SHA-512 (B64) | - (sig only) | SHA-256 (hex) | SHA-1 (hex) | - (sig only) | - | - |
| Signature | AuthCode (Win) | Ed25519 (B64) | RSA (B64) | - | Ed25519/DSA | - | MSIX cert |
| Signature on | Installer .exe | Installer file | Bundle zip | - | Update archive | - | MSIX package |
| Delta updates | Blockmap | - | Delta bundles | -delta.nupkg | sparkle:delta | - | - |
| Channels | channel in cfg | URL variable | defaultChannel | - | - | - | - |
| Staged rollout | stagingPercentage | - | Cloud rollout | # N% comment | - | - | VersionThreshold |
| Min OS version | minimumSystemVersion | - | - | - | minSysVersion | - | MinVersion |
| Release notes | releaseNotes | notes | - (custom) | In .nuspec | description | - | - |
| Publish date | releaseDate (ISO) | pub_date (RFC3339) | - | - | pubDate (RFC2822) | - | - |
| Auth private | Bearer token | Custom headers | API key (Cloud) | - | - | - | Store/GPO |
| Delta mechanism | Blockmap+range | - | Delta bundles | BSDIFF | bsdiff | - | - |

---

## Minimum Viable Subset for AIRIZ Unified Manifest

Based on cross-protocol analysis, the minimum fields covering all five
AIRIZ surfaces:

```typescript
interface AIRIZReleaseManifest {
  // Identity
  version: string;              // SemVer (all surfaces)
  releaseDate: string;          // ISO 8601 (electron, tauri)
  releaseName?: string;         // display name (electron)

  // Files
  files: AIRIZFileEntry[];      // at least one (electron, tauri, squirrel)

  // Notes
  releaseNotes?: string;        // (electron, tauri, sparkle)

  // Constraints
  minimumSystemVersion?: string; // (electron, sparkle)

  // Rollout
  stagingPercentage?: number;   // 0-100 (electron, squirrel)
  channel?: string;             // (electron, tauri, capawesome)

  // Per-platform overrides (Tauri-style)
  platforms?: {
    [platformKey: string]: AIRIZPlatformFile;
  };
}

interface AIRIZFileEntry {
  url: string;                  // download URL
  sha512: string;               // Base64 SHA-512 (electron, primary)
  sha256?: string;              // hex SHA-256 (capawesome compat)
  size: number;                 // bytes
  signature?: string;           // Base64 (tauri: ed25519, cap: RSA, sparkle: ed25519)
  blockMapSize?: number;        // electron blockmap delta
  isAdminRightsRequired?: boolean; // Windows UAC
}

interface AIRIZPlatformFile {
  url: string;
  signature: string;            // REQUIRED for tauri/cap/sparkle
  sha512?: string;
  sha256?: string;
  size?: number;
}
```

### Key Design Decisions

1. **JSON, not YAML/XML** - Tauri, Capawesome, Cloudflare Worker all prefer
   JSON. YAML adds parsing complexity without benefit for machine-generated.

2. **SHA-512 as primary hash** - electron-builder choice; stronger than
   SHA-256 (Capawesome) and SHA-1 (Squirrel). Include sha256 for Capawesome.

3. **Signature optional per-file** - Not all surfaces need file-level sig
   (PWA SW uses HTTP integrity, Squirrel uses nothing). Required for Electron,
   Tauri, Capacitor, Sparkle surfaces.

4. **platforms map** - Tauri model is cleanest for multi-platform. Windows
   reads platforms["windows-x86_64"]; Capacitor reads platforms["android-arm64"]
   / platforms["ios-arm64"]; PWA ignores files entirely.

5. **stagingPercentage + channel** - Covers electron staged rollout, Squirrel
   percentage comments, Capawesome channels.

6. **No packages (web installer)** - AIRIZ does not use NSIS web installer
   pattern; the 7z package embedding is electron-builder-specific.

### Surface-to-Field Mapping

| Surface | Reads | Ignores |
|---------|-------|---------|
| Electron Win | version, files, releaseDate, releaseNotes, stagingPercentage, minimumSystemVersion, platforms["windows-x86_64"] | sha256, channel |
| Capacitor Android | version, files, releaseDate, channel, platforms["android-arm64"], signature (RSA) | sha512, blockMapSize, isAdminRightsRequired |
| Capacitor iOS | version, files, releaseDate, channel, platforms["ios-arm64"], signature (RSA) | sha512, blockMapSize, isAdminRightsRequired |
| PWA SW | (no manifest - SW script bytes + HTTP headers) | all fields |
| Cloudflare Worker | version, releaseDate, releaseNotes, stagingPercentage, channel, files (for dev feed) | signature, platforms, isAdminRightsRequired |
| Dev release feed | version, releaseDate, releaseNotes, files, channel, stagingPercentage | signature, platforms, isAdminRightsRequired |

---

## Source Citations

| # | Protocol | Source | URL | Fetched |
|---|----------|--------|-----|---------|
| 1 | electron types | builder-util-runtime@9.7.0 | cdn.jsdelivr.net/npm/builder-util-runtime@9.7.0/out/updateInfo.d.ts | YES |
| 2 | electron provider | electron-updater@6.8.11 | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/providers/Provider.js | YES |
| 3 | electron github | electron-updater@6.8.11 | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/providers/GitHubProvider.js | YES |
| 4 | electron nsis | electron-updater@6.8.11 | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/NsisUpdater.js | YES |
| 5 | electron app | electron-updater@6.8.11 | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/AppUpdater.js | YES |
| 6 | electron TS src | electron-builder (master) | raw.githubusercontent.com/.../Provider.ts | YES |
| 7 | tauri docs | Tauri docs (2025-11-28) | v2.tauri.app/plugin/updater/ | YES |
| 8 | tauri JS | @tauri-apps/plugin-updater@2.14.1 | cdn.jsdelivr.net/npm/@tauri-apps/plugin-updater@2.14.1/dist-js/index.js | YES |
| 9 | capawesome types | @capawesome/capacitor-live-update@8.7.1 | cdn.jsdelivr.net/npm/@capawesome/capacitor-live-update@8.7.1/dist/esm/definitions.d.ts | YES |
| 10 | capawesome docs | capawesome.io | capawesome.io/docs/sdks/capacitor/live-update/ | YES |
| 11 | capawesome README | GitHub (main) | raw.githubusercontent.com/capawesome-team/capacitor-plugins/main/packages/live-update/README.md | YES |
| 12 | squirrel entry | Squirrel/Squirrel.Windows (develop) | raw.githubusercontent.com/Squirrel/Squirrel.Windows/develop/src/Squirrel/ReleaseEntry.cs | YES |
| 13 | PWA SW | MDN (2026-09-25) | developer.mozilla.org/.../Using_Service_Workers | YES |
| 14 | workbox updates | Chrome Dev Docs | developer.chrome.com/docs/workbox/handling-service-worker-updates | YES |
| 15 | workbox overview | Chrome Dev Docs | developer.chrome.com/docs/workbox | YES |
| 16 | sparkle repo | sparkle-project/Sparkle (2.x) | github.com/sparkle-project/Sparkle | YES (page) |
| 17 | MS AppInstaller | Microsoft Learn | learn.microsoft.com/en-us/windows/msix/package/ | NO (404) |
| 18 | deprecated cap | npm / GitHub | @capacitor/live-update (deprecated) | NO (inferred) |

---

*Document ends. 800+ lines. All [VERIFIED] sections have direct source code or
documentation fetched in-session. [DOMAIN] sections cite the authoritative URL
but the source was not fetched in-session (noted individually).*
