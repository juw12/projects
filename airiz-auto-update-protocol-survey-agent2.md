# Exhaustive Auto-Update Protocol Reference — Agent 2 of 8

> Forensic protocol-level comparison of 10 auto-update mechanisms for AIRIZ Motor Console.
> Generated: 2026-11-05 | Classification: TYPE D (Comprehensive)

---

## 1. Squirrel.Windows

**PROTOCOL SURFACE**

### 1.1 Lineage

Two independent implementations:
- **Squirrel/Squirrel.Windows** (GitHub: Squirrel/Squirrel.Windows) — C#/.NET, the original by Aaron Bockover (2014). Used by Electron apps via electron-winstaller. This is the dominant lineage.
- **Clowd/Squirrel.Windows** — Historical fork with no independent protocol changes; absorbed back. The NuGet/Squirrel lineage is the same project.

### 1.2 RELEASES File Format

Exact line structure (from source regex at line 103 of ReleaseEntry.cs):

^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$

| Field | Position | Format | Example |
|-------|----------|--------|---------|
| SHA1 hash | 1 | 40 hex chars (case-insensitive) | B0892F3C7AC91D72A6271FF36905FEF8FE993520 |
| Filename/URL | 2 | Basename or absolute HTTPS URL | electron-fiddle-0.36.3-full.nupkg |
| File size | 3 | Decimal bytes | 103298365 |
| Staging (optional) | trailing comment |  # N% (N = 1-3 digits) |  # 25% |

**Real example** (from Squirrel.Windows docs):

`
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
`

**Staging variant**:
`
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.1-full.nupkg 600752 # 50%
`

**Parsing rules** (from ParseReleaseFile):
- BOM is stripped if present
- Lines split on \n, empty lines skipped
- # starts a comment (staging percentage extracted before comment strip)
- Filename may be bare name OR absolute HTTP(S) URL
- ilenameIsDeltaFile() checks for -delta.nupkg suffix (case-insensitive)

**Write order**: sorted by version ascending, then IsDelta descending.

**Source**: https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs

### 1.3 *.nupkg Manifest (nuspec)

The .nupkg is a ZIP archive containing:
- lib/net45/ — application files (convention directory)
- *.nuspec — package metadata

Required nuspec fields:

`xml
<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>MyApp</id>
    <version>1.0.0</version>
    <authors>...</authors>
    <description>...</description>
    <releaseNotes>...</releaseNotes>
    <iconUrl>...</iconUrl>
  </metadata>
</package>
`

eleaseNotes is REQUIRED — GetReleaseNotes() throws if empty.
Filename convention: {PackageName}-{Version}-full.nupkg or {PackageName}-{Version}-delta.nupkg

### 1.4 HTTP Endpoint

The updater polls {updateUrl}/RELEASES.

**Request**: GET {updateUrl}/RELEASES
**Response**: 200 with 	ext/plain body.

Each nupkg downloaded individually from {baseUrl}/{filename}.
Supports url.Query for CDN auth (e.g., pre-signed URLs).

**Directory structure for hosting**:
`
my-app-updates/
├─ win32/
│  ├─ x64/
│  │  ├─ my-app-1.0.0-win32-x64.nupkg
│  │  ├─ my-app-1.1.0-win32-x64.nupkg
│  │  ├─ my-app-1.1.0-win32-x64-delta.nupkg
│  │  └─ RELEASES
`

### 1.5 Update.exe Behavior

Commands:

| Command | Behavior |
|---------|----------|
| install={dir} | Full install from local directory |
| update={url} | Check + download + apply from remote URL |
| checkForUpdate={url} | Check only, write JSON to stdout |
| download={url} | Download only, write JSON to stdout |
| eleasify={pkg} | Create delta from existing full, update RELEASES |
| processStart={exe} | Launch exe in latest versioned directory |
| uninstall | Remove app |
| updateSelf | Copy Update.exe to default location |

**Bootstrap flow**:
1. Setup.exe (C++ bootstrapper) unpacks embedded zip (PE resource DATA id 131) to target dir
2. Verifies Update.exe exists in target
3. Launches Update.exe --install .
4. Update.exe calls FullInstall():
   - Creates %LocalAppData%/{AppName}/
   - Copies itself to {rootAppDirectory}/Update.exe
   - Calls mgr.FullInstall(silentInstall)
   - Creates uninstaller registry entry

**Install structure**:
`
%LocalAppData%\{AppName}\
├── app-{version}\           # Current version files
├── packages\                # Downloaded .nupkg files
├── Update.exe               # Self-copied update manager
├── Squirrel-REPAIR.log
└── Squirrel-UPDATE.log
`

### 1.6 Registry Writes

**AppUserModelID** (set on .lnk shortcut, NOT registry):
`
com.squirrel.{PackageName}.{ExeName}
`
Set via PKEY_AppUserModel_ID property store on the shortcut.

**Uninstaller registry entry** (created on first install):
- HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\{AppName}
- Contains: DisplayName, DisplayVersion, UninstallString

**No RunOnce key is written.** Squirrel uses Update.exe --processStart {exe} as the entry point.

### 1.7 Delta Packages

A *-delta.nupkg is a standard nupkg ZIP containing:
- For each modified EXE/DLL: a Microsoft Delta patch {filename}.diff + {filename}.shasum
- For each new file: stored verbatim
- For each deleted file: listed in manifest

**Microsoft Delta Compression** (from MsDeltaCompression.cs):
`csharp
NativeMethods.CreateDelta(
    FileTypeSet.Executables,
    CreateFlags.IgnoreFileSizeLimit,
    CreateFlags.None,
    oldFilePath, newFilePath,
    null, null, globalOptions, IntPtr.Zero,
    HashAlgId.Crc32, deltaFilePath);
`

Uses msdelta library (Microsoft proprietary binary delta, NOT bsdiff).

**When deltas apply**:
- Filename ends with -delta.nupkg
- Current installed version matches the delta base version
- Delta present in RELEASES

**When fallback to full occurs**:
- No delta in RELEASES
- Delta application throws (corrupt patch, version mismatch)
- ignoreDeltaUpdates flag set after first failure
- Delta can only target the immediately previous version (no multi-hop)

### 1.8 Signing

**Authenticode ONLY.** No internal Squirrel-specific signature.
- .nupkg files are NOT signed
- Setup.exe and Update.exe are Authenticode-signed
- RELEASES file is NOT signed (integrity relies on HTTPS)
- SHA-1 in RELEASES is for file integrity, not authentication

**Security model**: TLS + SHA-1 integrity. No manifest signature.

### 1.9 Failure Modes

| Failure | Behavior |
|---------|----------|
| RELEASES 404 | CheckForUpdate returns null |
| SHA-1 mismatch after download | Re-attempt, then exception |
| Delta apply fails | Fallback to full package |
| nupkg corrupt | Exception, update fails |
| App files locked | Retry, then error |
| Antivirus blocks dir recreation | "Couldn't recreate app directory" |
| Invalid RELEASES line | ParseReleaseFile throws |

---

## 2. Squirrel.Mac

**PROTOCOL SURFACE**

### 2.1 Lineage

Squirrel.Mac was the C# implementation for macOS (same team as Squirrel.Windows). It was **deprecated and abandoned** in favor of Sparkle 2.x (Objective-C/Swift). The protocol it used was the Sparkle appcast format with DSA signatures only.

**Status**: No longer maintained. Any modern macOS auto-update must use Sparkle 2.x directly.

### 2.2 Appcast XML Schema (Squirrel.Mac / Sparkle 1.x)

RSS 2.0 with Sparkle namespace:

`xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>App Updates</title>
    <link>https://example.com</link>
    <description>Updates</description>
    <item>
      <title>Version 2.0</title>
      <description><![CDATA[Release notes HTML]]></description>
      <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
      <enclosure url="https://example.com/downloads/app.zip"
        sparkle:version="2.0"
        sparkle:shortVersionString="2.0"
        sparkle:dsaSignature="MCwCFAdLjBvvjJN0fnfMnn7BCl650VqNAhR+XuFABVK2y8zJn/oKtC1sv58ySQ=="
        length="1879795"
        type="application/octet-stream" />
    </item>
  </channel>
</rss>
`

Squirrel.Mac used DSA only. EdDSA was added in Sparkle 1.21/2.0.

### 2.3 Migration to Sparkle 2.x

1. Ship update with BOTH sparkle:dsaSignature AND sparkle:edSignature
2. Once all users on EdDSA-capable Sparkle, drop DSA

---

## 3. Sparkle 2.x (macOS, Modern)

**PROTOCOL SURFACE**

### 3.1 Appcast XML Schema (Complete)

`xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:myapp="https://myproductpage.com/">
  <channel>
    <title>My App Updates</title>
    <language>en</language>
    <item>
      <title>Version 2.0 (2 bugs fixed; 3 new features)</title>
      <link>https://myproductwebsite.com</link>
      <sparkle:version>1248</sparkle:version>
      <sparkle:shortVersionString>1.5.1</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>10.13</sparkle:minimumSystemVersion>
      <sparkle:releaseNotesLink
        url="https://example.com/release_notes/app_2.0.html"
        sparkle:edSignature="4KjvG1GjKwXrxfqXbU1j2CYClEDdkMDp2Ii2ICV+Jgx00MDpHFLpLJ+/2tHy9Mp9bTUk5KlpCG1OWBu4nLKOCw=="
        sparkle:length="1467" />
      <sparkle:criticalUpdate>true</sparkle:criticalUpdate>
      <sparkle:informationalUpdate>false</sparkle:informationalUpdate>
      <description><![CDATA[Full HTML changelog]]></description>
      <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
      <enclosure
        url="https://example.com/downloads/app.zip"
        sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
        length="1623481"
        type="application/octet-stream"
        sparkle:installationType="default" />
      <sparkle:deltas>
        <enclosure url="https://example.com/1.4-1.5.delta"
          sparkle:deltaFrom="1.4"
          length="1485"
          type="application/octet-stream"
          sparkle:edSignature="..."
          sparkle:deltaFromSparkleExecutableSize="1844096"
          sparkle:deltaFromSparkleLocales="en,ca,fr,hr,hu" />
      </sparkle:deltas>
    </item>
  </channel>
</rss>
`

**Complete element/attribute reference**:

| Element/Attribute | Scope | Required | Description |
|---|---|---|---|
| sparkle:version | item or enclosure | Yes* | Machine version (CFBundleVersion) |
| sparkle:shortVersionString | item or enclosure | No | Human-readable version |
| sparkle:minimumSystemVersion | item | No | Min macOS version |
| sparkle:releaseNotesLink/@url | item | If element present | External notes URL |
| sparkle:releaseNotesLink/@sparkle:edSignature | item | If SURequireSignedFeed | Notes signature |
| sparkle:criticalUpdate | item | No | Force update (no skip) |
| sparkle:informationalUpdate | item | No | Show in UI, don't install |
| sparkle:minimumAutoupdateVersion | item | No | Min auto-update version |
| sparkle:channel | item | No | Channel name (beta) |
| sparkle:phasedRolloutInterval | item | No | Seconds between rollout phases |
| enclosure/@url | enclosure | Yes | Download URL |
| enclosure/@length | enclosure | Yes | File size bytes |
| enclosure/@type | enclosure | Yes | MIME type |
| enclosure/@sparkle:edSignature | enclosure | Yes (EdDSA) | Base64 Ed25519 sig |
| enclosure/@sparkle:dsaSignature | enclosure | Legacy | Base64 DSA-SHA1 sig |
| enclosure/@sparkle:installationType | enclosure | Conditional | default/package/replacing/restarted |
| sparkle:deltas/enclosure/@sparkle:deltaFrom | deltas | Yes | Version delta upgrades FROM |
| sparkle:deltas/enclosure/@sparkle:deltaFromSparkleExecutableSize | deltas | No (2.3+) | Sparkle fw size pre-check |
| sparkle:deltas/enclosure/@sparkle:deltaFromSparkleLocales | deltas | No (2.3+) | Locale list pre-check |

**Sources**: https://sparkle-project.org/documentation/publishing/ , https://github.com/sparkle-project/Sparkle/pull/1878

### 3.2 Info.plist Configuration

| Key | Type | Description |
|-----|------|-------------|
| SUFeedURL | string | Appcast URL |
| SUPublicEDKey | string | Base64 Ed25519 public key (32 bytes) |
| SUPublicDSAKeyFile | string | DSA public key path (legacy) |
| SUEnableAutomaticChecks | bool | Background auto-checks (default true) |
| SUAutomaticallyUpdate | bool | Auto-install without prompting (default false) |
| SUAllowChannelSwitching | bool | User channel switching (default false) |
| SUScheduledCheckInterval | number | Seconds between checks (default 86400) |
| SURequireSignedFeed | bool | Require signed appcast (default false) |
| SUPhasedUpdateInterval | number | Phased rollout seconds (0=disabled) |

### 3.3 EdDSA Signature Flow

**Key generation**: ./bin/generate_keys
- Private key: base64 64 bytes, stored in login Keychain
- Public key: base64 32 bytes → SUPublicEDKey in Info.plist

**Signing**: ./bin/sign_update path_to_update.zip
- Output: sparkle:edSignature="..." length="..."
- Algorithm: **Ed25519 (RFC 8032)** over the entire update archive bytes

**Verification**:
1. Fetch appcast
2. Extract sparkle:edSignature from enclosure
3. Download file from url
4. Verify Ed25519 with SUPublicEDKey
5. Invalid → item rejected entirely

**Key trust chain**: If Developer ID signed AND same cert → key change trusted. Otherwise → ship both DSA+EdDSA in transition.

### 3.4 Phased Rollout

<sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>

- 0 or absent = no phased rollout
- N seconds = phases separated by N seconds
- Phase assignment: deterministic hash of machine identifier
- Approximate phases: 5%, 15%, 35%, 100%
- SUAutomaticallyUpdate controls auto-install per phase

### 3.5 Delta Update Format

**Format versions**:

| Version | Since | Format | Compression |
|---------|-------|--------|-------------|
| 4 | Sparkle 2.7 | Custom SPUSparkleDeltaArchive | LZMA, LZFSE, LZ4, ZLIB, BZIP2 |
| 3 | Sparkle 2.1 | Custom SPUSparkleDeltaArchive | LZMA, LZFSE, LZ4, ZLIB, BZIP2 |
| 2 | Sparkle 1.10 | XAR (legacy Apple) | BZIP2 |
| 1 | Sparkle 1.5 | XAR + bsdiff | BZIP2 |

**Delta operations**: Delete, Extract, Clone, ModifyPermissions, Patch
- Patch uses **bsdiff** (binary subtraction diff with byte-addition)
- File content blobs compressed
- Checksums of source AND target states included

**bsdiff algorithm**:
- Copy: reuse data from old file
- Add: take block from old, add byte-by-byte difference from patch
- Insert: new data
- Difference blocks compressed with bzip2, decompressed on the fly

**Selection logic**:
1. Match user's version to sparkle:deltaFrom
2. Verify deltaFromSparkleExecutableSize (if present)
3. Verify deltaFromSparkleLocales (if present)
4. Download + apply delta
5. Patch fails → fallback to full
6. No matching delta → full

**Generation**:
`ash
./bin/generate_appcast appcast.xml MyApp-2.0.zip --ed-key-file ed_key.pem
# OR manual:
./BinaryDelta create --version=4 path/to/old/MyApp.app path/to/new/MyApp.app patch.delta
`

**Sources**: https://sparkle-project.org/documentation/delta-updates/ , https://github.com/sparkle-project/Sparkle/pull/2051

### 3.6 Privacy Manifest (Apple 2024+)

Required PrivacyInfo.xcprivacy in app bundle:
- NSPrivacyAccessedAPICategoryFileModification with reason C91.1 (Sparkle replaces app bundle)
- NSPrivacyTracking: false

### 3.7 Failure Modes

| Failure | Behavior |
|---------|----------|
| Appcast fetch fails | Retry with backoff, no update |
| EdDSA mismatch | Item silently rejected |
| sparkle:version missing | Item rejected |
| Min OS not met | Skipped, user directed to link |
| Delta checksum fails | Fallback to full |
| Delta format too new | Fallback to full |
| installationType mismatch | Update rejected |
| SURequireSignedFeed + unsigned | Feed rejected |
| APFS clone fails | Error, user must free space |

### 3.8 Host Requirements

- Storage: Appcast XML + archives + optional .delta files
- Key custody: Ed25519 private key in Keychain or CI secret
- TLS: Required (no HTTP)
- Content-Type: pplication/xml for appcast, pplication/octet-stream for archives
- Cache: Uses Last-Modified/ETag for conditional appcast requests

---

## 4. electron-updater

**PROTOCOL SURFACE**

### 4.1 Provider Abstraction

| Provider | Config value | Feed URL pattern |
|----------|-------------|------------------|
| Generic | generic | {url}/latest[.yml\|{channel}.yml] |
| GitHub | github | https://api.github.com/repos/{owner}/{repo}/releases/latest |
| S3 | s3 | https://{bucket}.s3.{region}.amazonaws.com/{path}/{channel}-{arch}.yml |
| Spaces | spaces | https://{bucket}.{region}.digitaloceanspaces.com/{path}/... |
| R2 | 2 | https://{account}.r2.cloudflarestorage.com/{bucket}/{path}/... |
| Keygen | keygen | https://app.keygen.sh/v2/accounts/{acct}/artifacts/{id}/versions/latest |
| Bitbucket | itbucket | https://bitbucket.org/{owner}/{repo}/downloads/latest/... |
| GitLab | gitlab | https://gitlab.com/api/v4/projects/{id}/releases |
| Bintray | intray | **DEPRECATED** (shut down May 1, 2021) |

**Feed file naming**: latest.yml, eta.yml, latest-mac.yml, latest-linux.yml

**Source**: https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/publishOptions.ts

### 4.2 latest.yml Schema (Complete)

**Modern format (electron-builder >=27, electron-updater >=2.16)**:

`yaml
version: 1.2.3
files:
  - url: My-App-1.2.3-x64.exe
    sha512: dGVzdA==
    size: 123456789
    blockMapSize: 4567
releaseDate: '2026-11-05T10:30:00.000Z'
`

**Full field reference**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ersion | string | Yes | SemVer |
| iles[] | array | Yes (modern) | Update files list |
| iles[].url | string | Yes | URL (relative or absolute) |
| iles[].sha512 | string | Yes | Base64 SHA-512 (88 chars, ends ==) |
| iles[].size | number | Yes | Bytes |
| iles[].blockMapSize | number | No | Blockmap file size |
| iles[].blockMapUrl | string | No (v27+) | Override blockmap URL |
| iles[].sha2 | string | No | Legacy SHA-256 (Windows) |
| eleaseDate | string | Yes | ISO 8601 |
| eleaseName | string | No | Display name |
| eleaseNotes | string\|array | No | Changelog |
| stagingPercentage | number | No | 0-100 staged rollout |
| minimumSystemVersion | string | No | OS version gate |
| packages | object | No (Win) | Per-arch NSIS web packages |
| packages.{arch}.path | string | If present | Web installer URL |
| packages.{arch}.sha512 | string | If present | SHA-512 |
| packages.{arch}.size | number | If present | Size |
| packages.{arch}.blockMapSize | number | If present | Blockmap size |
| packages.{arch}.isAdminRightsRequired | bool | If present | UAC elevation |
| signatures[] | array | No (v27+) | Ed25519 manifest sigs |
| signatures[].keyId | string | If sigs present | SHA-256 of SPKI DER (hex) |
| signatures[].signature | string | If sigs present | Base64 Ed25519 |

**sha512 encoding**: Base64 since electron-builder 19.x. Legacy: 128-char hex (rejected in v28).

**Legacy format** (electron-updater 1.x - 2.15):
`yaml
version: 1.2.3
path: My-App-1.2.3-x64.exe
sha512: dGVzdA==
sha2: abc123...
releaseDate: '2026-11-05T10:30:00.000Z'
`

### 4.3 Signed Update Manifests (v27+)

**Algorithm**: Ed25519 via Node crypto.

**Canonical serialization** (prefix EBUM1):
- ersion, stagingPercentage, minimumSystemVersion
- Each iles[]: url, sha512, size (sorted)
- Each packages[arch]: path, sha512, size, lockMapSize, isAdminRightsRequired

**NOT signed**: releaseDate, releaseNotes, releaseName, signature fields themselves.

**Key management**:
- Private key(s) at publish time
- Public key(s) in pp-update.yml (ships with app)
- Multiple keys for rotation
- keyId = lowercase hex SHA-256 of SPKI DER

**Verification**: Before any download. Fail-closed.

**Source**: https://github.com/electron-userland/electron-builder/pull/9877

### 4.4 GitHub Provider

`	ypescript
interface GithubOptions {
  provider: "github"
  repo?: string       // owner/repo
  owner?: string
  tagNamePrefix?: string  // default: "v"
  host?: string       // default: "github.com"
  protocol?: "https"  // only https
  token?: string      // private repos (NEVER in config)
  private?: boolean   // use GH_TOKEN env
  channel?: string    // default: "latest"
  releaseType?: "draft"|"prerelease"|"release"
}
`

**API**: Releases API (/api/v3/repos/{owner}/{repo}/releases/latest)
**Token scope**: epo (private) or public_repo (public)
**Blockmap**: GitHub returns 501 for multi-range → single-range fallback

### 4.5 S3 Provider

`	ypescript
interface S3Options {
  provider: "s3"
  bucket: string
  region?: string
  acl?: "private"|"public-read"  // default: "public-read"
  storageClass?: "STANDARD"|"REDUCED_REDUNDANCY"|"STANDARD_IA"
  encryption?: "AES256"|"aws:kms"
  endpoint?: string
  accelerate?: boolean
  forcePathStyle?: boolean
  channel?: string  // default: "latest"
  path?: string     // default: "/"
}
`

**URL construction**:
- Standard: https://{bucket}.s3.amazonaws.com/{path}
- Accelerated: https://{bucket}.s3-accelerate.amazonaws.com/{path}
- Custom: {endpoint}/{bucket}/{path}
- Dotted bucket: https://s3-{region}.amazonaws.com/{bucket}/{path}

**Credentials**: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars, or ~/.aws/credentials, or ~/.aws/config
**OIDC**: NOT supported (no web identity token federation)
**SDK**: aws-sdk v2 (builder 24-26), v3 (builder 27+)

### 4.6 Bintray — DEPRECATED

Shut down May 1, 2021. Use generic provider with any static host.

### 4.7 Blockmap Format

**File**: Text, one block per line: <size_bytes> <md5_hex>
**Block size**: 1024 bytes (all but last)
**Hash**: MD5 (not SHA-256; full-file SHA-512 still verified)

**Differential download**:
1. Fetch new .blockmap from {url}.blockmap
2. Load old .blockmap from cache
3. computeOperations(): COPY (from old file) or DOWNLOAD (range request)
4. Execute sequentially
5. Verify full-file SHA-512

**Fallback to full**: Version mismatch, no old blockmap, range 400/501, SHA-512 fail

### 4.8 requestHeaders / CDN Auth

`javascript
autoUpdater.requestHeaders = { 'Authorization': 'Bearer token123' }
`

**Origin-scoping (v27+)**:
- Credential headers ONLY to feed's origin
- Different-origin downloads (pre-signed URLs) do NOT get these headers
- Feed query string only appended to same-origin requests

**Custom provider**: Must declare Provider.feedBaseUrl or get ERR_UPDATER_FEED_BASE_URL_NOT_DECLARED.

### 4.9 Failure Modes

| Failure | Behavior |
|---------|----------|
| Feed 404 | ERR_UPDATER_FEED_NOT_FOUND |
| SHA-512 mismatch | Rejected, re-download |
| Blockmap version mismatch | Full download fallback |
| Range 400/501 | Single-range, then full |
| Signed manifest fails | ERR_UPDATER_INVALID_SIGNATURE |
| files[] empty + no path | ERR_UPDATER_NO_FILES_PROVIDED |
| No checksum | ERR_UPDATER_NO_CHECKSUM |
| Redirect to non-HTTP(S) | Rejected (v27+) |

---

## 5. @tauri-apps/updater (Tauri 2.x)

**PROTOCOL SURFACE**

### 5.1 tauri.conf.json Updater Block

`json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/user/repo/releases/latest/download/latest.json"
      ],
      "windows": { "installMode": "passive" },
      "dangerousInsecureTransportProtocol": false,
      "allowDowngrades": false,
      "dialog": true
    }
  }
}
`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| createUpdaterArtifacts | bool\|"v1Compatible" | Yes | Generate updater artifacts |
| pubkey | string | Yes | Full .key.pub content (NOT path) |
| endpoints | string[] | Yes | Ordered URL list, TLS enforced |
| dangerousInsecureTransportProtocol | bool | No | Allow HTTP |
| windows.installMode | "passive"\|"basic"\|"exec" | No | NSIS mode |
| llowDowngrades | bool | No (v2.12+) | Allow downgrades |
| dialog | bool | No | Built-in dialog |

**URL templates**: {{current_version}}, {{target}} (linux/windows/darwin), {{arch}} (x86_64/i686/aarch64/armv7)
**Resolution**: Tried in order, first 2XX wins.

**Source**: https://v2.tauri.app/plugin/updater/

### 5.2 Update Manifest JSON

**Static file format**:
`json
{
  "version": "1.4.2",
  "notes": "Bug fixes",
  "pub_date": "2026-05-18T15:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "base64_sig", "url": "https://.../app.tar.gz" },
    "darwin-x86_64": { "signature": "base64_sig", "url": "https://.../app.tar.gz" },
    "linux-x86_64": { "signature": "base64_sig", "url": "https://.../app.AppImage" },
    "windows-x86_64": { "signature": "base64_sig", "url": "https://.../app-setup.exe" }
  }
}
`

**Dynamic server** (200 OK):
`json
{
  "version": "1.4.2",
  "pub_date": "2026-05-18T15:00:00Z",
  "url": "https://.../app-setup.exe",
  "signature": "base64_sig",
  "notes": "Bug fixes"
}
`

**No update**: 204 No Content

**Required**: ersion + platforms.{key}.url + platforms.{key}.signature (static) or url + signature (dynamic)
**Platform keys**: {OS}-{ARCH} — OS: linux/darwin/windows, ARCH: x86_64/i686/aarch64/armv7
**Validation**: Entire file validated before version check. All entries must be structurally valid.

### 5.3 Ed25519 (minisign) Signature Flow

**Key generation**: 	auri signer generate -w ~/.tauri/myapp.key
**Signing**: Automatic during 	auri build or manual: 	auri signer sign -k key file
**Format**: minisign (Ed25519-based, Arch Linux format)
- Signature: 64-byte Ed25519, base64
- Public key: 32-byte Ed25519, base64 (with minisign header)
- Covers entire file bytes
- v0.3 (Tauri 2.13.3+): rejects non-canonical Ed25519 S values

**Verification**: pubkey from tauri.conf.json → verify .sig against downloaded bundle → install or reject

### 5.4 Mobile Updater Status

**NOT supported.** Desktop only (Windows, macOS, Linux). No android/ios in target values.
Mobile updates go through Play Store / App Store.

### 5.5 Multi-Target Bundle Formats

| Platform | Format | Install |
|----------|--------|---------|
| macOS | .app.tar.gz | Replace app bundle |
| Windows NSIS | .nsis.zip or .exe | Run NSIS installer |
| Windows MSI | .msi | MSI install |
| Linux AppImage | .AppImage | Replace file |
| Linux deb | .deb | dpkg |
| Linux rpm | .rpm | rpm |

First-class: macOS .app.tar.gz, Windows .nsis.zip, Linux .AppImage.

### 5.6 Delta Updates (Experimental)

Superset manifest with optional delta block:
`json
{
  "version": "1.0.1",
  "platforms": { "linux-x86_64": { "url": "...", "signature": "..." } },
  "delta": {
    "schema": 1,
    "hash_algo": "blake3",
    "platforms": {
      "linux-x86_64": {
        "target_version": "1.0.1",
        "target_installer_blake3": "...",
        "target_installer_size": 6815744,
        "signature": "...",
        "patches": {
          "1.0.0": {
            "backend_id": "zstd",
            "patch_url": "https://.../1.0.0-to-1.0.1.zst",
            "patch_blake3": "...",
            "patch_size": 393782,
            "base_installer_blake3": "...",
            "base_installer_size": 4070756
          }
        }
      }
    }
  }
}
`
- Delta-aware clients read delta; others ignore
- Signature over target installer (same as full path)
- Schema 1: any-previous-to-latest (no multi-hop)
- Backend: zstd

**Source**: https://docs.rs/tauri-updater-delta-core/latest/

### 5.7 Failure Modes

| Failure | Behavior |
|---------|----------|
| All endpoints non-2XX | No update (silent) |
| 204 No Content | No update |
| Invalid JSON | Error, no update |
| Version <= current | No update (unless allowDowngrades) |
| Minisign fails | Rejected |
| HTTP in production | Blocked |
| Missing platform key | No update for target |

---

## 6. Capacitor Live Update

**PROTOCOL SURFACE**

### 6.1 Capawesome Plugin (Current: v8.x)

**Package**: @capawesome/capacitor-live-update

| Plugin Version | Capacitor | Status |
|---|---|---|
| 8.x.x | >=8 | Active |
| 7.x.x | 7 | Maintenance |
| 6.x.x | 6 | Maintenance |
| 5.x.x | 5 | Deprecated |

**Source**: https://github.com/capawesome-team/capacitor-plugins/blob/v6.x.x/packages/live-update/CHANGELOG.md

### 6.2 Plugin Configuration

`	ypescript
CapacitorLiveUpdatePlugin.register({
  appId: '6e351b4f-69a7-415e-a057-4567df7ffe94',
  enabled: true,
  defaultChannel: 'production',
  autoUpdateStrategy: 'background',
  autoDeleteBundles: false,
  autoBlockRolledBackBundles: true,
  readyTimeout: 10000,
  resetOnUpdate: true,
  httpTimeout: 60000,
  serverDomain: 'api.cloud.capawesome.io',
  publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBg...\n-----END PUBLIC KEY-----'
});
`

| Config | Type | Default | Description |
|--------|------|---------|-------------|
| ppId | string | — | Capawesome Cloud app ID |
| enabled | bool | true | Master switch |
| defaultChannel | string | — | Initial channel |
| utoUpdateStrategy | 'none'\|'background' | 'none' | Auto-download+apply |
| utoDeleteBundles | bool | false | Clean old bundles |
| utoBlockRolledBackBundles | bool | false | Block crashed bundles (max 100) |
| eadyTimeout | number | 10000 | ms before rollback |
| esetOnUpdate | bool | true | Reset to default on update |
| httpTimeout | number | 60000 | HTTP timeout ms |
| serverDomain | string | 'api.cloud.capawesome.io' | Cloud API domain |
| publicKey | string | — | PEM RSA public key |

### 6.3 Bundle Format and Artifact Types

| Type | Format | Description |
|------|--------|-------------|
| zip | ZIP archive | Full bundle (all files). Default. Only on Electron. |
| manifest | JSON manifest + files | Delta update. Only changed files. |

**Delta (manifest) flow**:
1. 
px @capawesome/cli apps:liveupdates:generatemanifest --path www
2. 
px @capawesome/cli apps:liveupdates:upload --artifact-type manifest
3. At update: compare manifests, download only changed files

**Manifest file** (generated):
`json
{
  "index.html": { "hash": "sha256base64...", "size": 1234 },
  "assets/main.js": { "hash": "sha256base64...", "size": 56789 }
}
`

**Self-hosted download**:
- zip: URL → ZIP file. Verify with checksum (SHA-256) or signature
- manifest: URL is base. Files from {url}?href={path}. Server returns X-Checksum + X-Signature headers

### 6.4 Channel Model

Resolution priority (highest first):
1. sync({ channel }) (transient)
2. setChannel() (persisted)
3. Native config (Info.plist / strings.xml)
4. Capacitor config defaultChannel

Features:
- Server-side channel→bundle mapping
- etchChannels() (v6.9+)
- Versioned bundles: --android-min/max, --ios-min/max flags
- Rollout: percentage-based on Cloud

### 6.5 FetchLatestBundleResult

`	ypescript
interface FetchLatestBundleResult {
  artifactType: 'manifest' | 'zip';
  bundleId: string | null;
  channel: string;
  checksum: string;
  customProperties: { [key: string]: string };
  downloadUrl: string;
  signature: string;
}
`

### 6.6 Security: RSA Verification

- publicKey: PEM-encoded RSA public key
- Algorithm: RSA-PSS or RSA-PKCS#1 v1.5 (platform-dependent)
- Signature over SHA-256 of file bytes
- zip: verify bundle signature field
- manifest: verify per-file X-Signature headers

### 6.7 Official Capacitor Plugin — DEPRECATED

@capacitor/live-updates (Ionic official) removed from core.
- Basic JS-level patch only
- No delta, no native bundle management, no channels, no signing
- Capawesome supersedes entirely

### 6.8 App Store Constraint

**Guideline 3.3.1(a)**: No downloading/executing code that changes core functionality.
- Bundles are **web assets only** (HTML, CSS, JS, images)
- Native binary provides runtime (WebView)
- Cannot change native code, plugins, app structure
- Incompatible bundle → crash → eadyTimeout → rollback

### 6.9 Self-Hosted vs Capawesome Cloud

**Cloud**:
- API: GET /api/apps/{appId}/bundles/latest?channel={ch}
- File downloads return X-Checksum + X-Signature headers

**Self-hosted**:
- Implement same JSON response shape
- File downloads must include X-Checksum / X-Signature
- Manifest type: {url}?href={path} pattern required

### 6.10 Failure Modes

| Failure | Behavior |
|---------|----------|
| No bundle for channel | bundleId: null |
| Download fails | Error, no state change |
| Checksum mismatch | Bundle rejected |
| Signature fails | Bundle rejected |
| Crash after set | readyTimeout → rollback |
| Incompatible native API | Crash → rollback |
| Repeated crash | Bundle blocked (up to 100) |
| Cloud unreachable | Use cached bundle |

---

## 7. Expo Updates (EAS Update)

**PROTOCOL SURFACE**

### 7.1 app.json updates Block

`json
{
  "expo": {
    "runtimeVersion": { "policy": "sdkVersion" },
    "updates": {
      "enabled": true,
      "url": "https://u.expo.dev/{project.id}",
      "requestHeaders": { "expo-channel-name": "production" },
      "fallbackToCacheTimeout": 0,
      "checkAutomatically": "ON_LOAD",
      "useEmbeddedUpdate": true,
      "codeSigningCertificate": "./certs/certificate.pem",
      "codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" },
      "assetPatternsToBeBundled": ["assets/**"],
      "disableAntiBrickingMeasures": false,
      "enableBsdiffPatchSupport": true,
      "maxUpdatesToKeep": 2
    }
  }
}
`

| Property | Default | Description |
|----------|---------|-------------|
| enabled | true | Master switch |
| url | (required) | Update manifest endpoint |
| equestHeaders | (none) | Headers sent with manifest request |
| allbackToCacheTimeout | 0 | ms to wait for new update before fallback |
| checkAutomatically | ON_LOAD | ON_LOAD / ON_ERROR / MANUAL |
| useEmbeddedUpdate | true | Use embedded update as fallback |
| codeSigningCertificate | (none) | PEM X.509 cert path |
| codeSigningMetadata.alg | rsa-v1_5-sha256 | Only valid value |
| codeSigningMetadata.keyid | main | Key identifier |
| ssetPatternsToBeBundled | (none) | Glob patterns for bundled assets |
| disableAntiBrickingMeasures | false | Disable rollback protection |
| enableBsdiffPatchSupport | true | Allow bsdiff patches |
| maxUpdatesToKeep | 2 | Max cached updates |

**iOS plist keys**: EXUpdatesURL, EXUpdatesRuntimeVersion, EXUpdatesLaunchWaitMs, EXUpdatesCheckOnLaunch, etc.
**Android meta-data**: expo.modules.updates.EXPO_UPDATE_URL, expo.modules.updates.EXPO_UPDATES_LAUNCH_WAIT_MS, etc.

**Source**: https://docs.expo.dev/versions/latest/sdk/updates

### 7.2 EAS Update Manifest Protocol

The updates.url endpoint implements the **Updates V1 Protocol**.

**Request**: GET {updates.url}?runtimeVersion={runtimeVersion}&platform={platform}
- Headers from equestHeaders (e.g., expo-channel-name)
- untimeVersion determines which update group is compatible

**Response** (simplified):
`json
{
  "launchAsset": {
    "hash": "sha256base64...",
    "platform": "android",
    "url": "https://updates.expo.dev/{project.id}/{platform}/{hash}"
  },
  "releaseId": "uuid",
  "manifest": {
    "assets": [
      { "path": "index.html", "hash": "...", "fileSize": 1234, "url": "..." }
    ],
    "runtimeVersion": "1.0.0",
    "branch": "production"
  },
  "signature": "base64_rsa_signature"
}
`

**Asset selection**:
- Each asset has a hash (fingerprint)
- Assets already cached by hash are NOT re-downloaded
- ingerprint is a content hash (SHA-256) computed at publish time
- FingerprintSources: controls which file properties contribute to the hash

### 7.3 Rollouts

**Per-update rollouts**:
`ash
eas update --rollout-percentage=10
`
- Percentage of users receiving this specific update
- Progress with: eas update:edit
- End: set to 100, or eas update:revert-update-rollout

**Branch-based rollouts**:
`ash
eas channel:rollout
`
- Maps a channel to a new branch for X% of users
- Remaining users stay on current branch
- Adjust by re-running and choosing Edit

**Rollout control server-side**:
- Client sends untimeVersion + channel
- Server returns update only if user is in rollout cohort
- Cohort assignment is deterministic (hashed device ID)

### 7.4 Code Signing

**Algorithm**: RSA PKCS#1 v1.5 with SHA-256 (sa-v1_5-sha256)

**Key generation**:
`ash
npx expo-updates codesigning:generate \
  --key-output-directory ../keys \
  --certificate-output-directory certs \
  --certificate-validity-duration-years 10 \
  --certificate-common-name "Org Name"
`
Produces: private-key.pem, public-key.pem, certificate.pem

**Certificate**: X.509 PEM, contains public key + validity period. Shipped with app (in source control).

**Signing flow**:
1. eas update --private-key-path ../keys/private-key.pem
2. EAS CLI signs locally (private key never leaves machine)
3. Signature sent to Expo Update, stored with update
4. Client: download → verify signature against embedded certificate → apply or reject

**Key rotation**:
- Generate new key + cert
- Update codeSigningCertificate in app.json
- New runtime version required (cert is part of binary)
- Old updates remain valid until cert expires

**Source**: https://docs.expo.dev/eas-update/code-signing/

### 7.5 CodePush Migration

**Official migration guide**: https://docs.expo.dev/eas-update/codepush

**Key conceptual differences**:

| CodePush | Expo Update |
|----------|-------------|
| Deployments (Staging/Production) | Branches + Channels |
| Client controls target deployment at runtime | Server maps channel→branch |
| Single update stream per deployment | Multiple branches per channel |
| codePush.sync() | Updates.fetchUpdateAsync() + Updates.reloadAsync() |
| deploymentKey in native config | expo-channel-name header |
| codePush.notifyAppReady() | Built-in (anti-bricking) |

**Migration steps**:
1. 
pm uninstall react-native-code-push
2. Add expo key to app.json with updates.url + untimeVersion
3. Rebuild native binary
4. Resubmit to app stores
5. Publish with eas update --channel production --message "..."

### 7.6 Failure Modes

| Failure | Behavior |
|---------|----------|
| Manifest fetch fails | Use embedded update (if enabled) |
| Signature verification fails | Update rejected, use embedded |
| Asset download fails | Retry, then use cached/embedded |
| allbackToCacheTimeout expires | Use last cached update |
| Runtime version mismatch | No update available |
| Anti-bricking: crash after update | Auto-rollback to previous |
| maxUpdatesToKeep exceeded | Oldest update deleted |

---

## 8. CodePush / App Center

**PROTOCOL SURFACE**

### 8.1 Status: DEPRECATED AND SHUT DOWN

| Item | Date | Status |
|------|------|--------|
| App Center (all features) | March 31, 2025 | **Retired** |
| CodePush hosted service | March 31, 2025 | **Shut down** |
| eact-native-code-push npm | Archived May 20, 2025 | Read-only |
| code-push-server GitHub | Archived May 20, 2025 | Read-only, MIT |
| App Center Analytics/Diagnostics | Extended to March 2027 | Still running |

**CodePush will NOT support React Native New Architecture** (0.82+). Last release: 9.0.1.

**Migration options** (from https://expo.dev/blog/what-to-do-without-codepush):
1. Stop using OTA updates
2. Self-host code-push-server (archived, unmaintained)
3. Use expo-updates with custom server (Updates V1 Protocol)
4. Use EAS Update (hosted)

### 8.2 Legacy Protocol (Reference)

**codePush.checkForUpdate()** response:
`	ypescript
interface CodePushUpdate {
  appVersion: string;        // Native app version
  description: string;       // Release notes
  label: string;             // Update label (e.g., "Production2")
  packageHash: string;       // SHA-256 of the update package
  packageSize: number;       // Bytes
  mandatory: {               // Mandatory update info
    appVersion?: string;     // Mandatory for these app versions
    installMode: InstallMode; // IMMEDIATE / ON_NEXT_RESTART
  };
  rollbackRetry: boolean;    // Whether rollback is being retried
  updated: boolean;          // Whether an update was applied
  deploymentKey: string;     // The deployment key used
  isAvailable: boolean;      // Whether update exists
}
`

**codePush.sync() flow**:
1. Check for update (HTTP GET to CodePush server)
2. If available: download ZIP package
3. Verify packageHash (SHA-256)
4. Install (extract to native storage)
5. Call codePush.notifyAppReady() after successful launch
6. If crash: auto-rollback on next launch

**Server endpoint** (legacy):
- GET https://codepush.appcenter.ms/v3/apps/{appId}/releases/deployments/{deploymentKey}?clientVersion={appVersion}&clientLabel={currentLabel}&...
- Response: JSON with update info or empty (no update)

**Install modes**:
| Mode | Behavior |
|------|----------|
| IMMEDIATE | Reload app immediately after install |
| ON_NEXT_RESTART | Apply on next natural restart |
| ON_NEXT_RESUME | Apply when app resumes from background |

### 8.3 React Native Bundling

`ash
react-native bundle \
  --platform android \
  --dev false \
  --entry-file index.js \
  --bundle-output main.android.bundle \
  --assets-dest ./android/app/src/main/res
`

The bundle is a Hermes bytecode or JSC JavaScript file. CodePush wraps it in a ZIP along with assets.

**Bundle format**: ZIP containing:
- main.android.bundle or main.iosbundle (JS bytecode)
- Asset files (images, fonts, etc.)
- CodePush_package.json (metadata: label, hash, size, appVersion)

### 8.4 Failure Modes (Legacy)

| Failure | Behavior |
|---------|----------|
| Server unreachable | Use last installed update |
| packageHash mismatch | Update rejected |
| Crash after update | Auto-rollback on next launch |
| Mandatory update + no network | App blocks (IMMEDIATE mode) |
| Deployment key mismatch | 401, no update |

---

## 9. PWA Service Worker (Workbox + Native)

**PROTOCOL SURFACE**

### 9.1 W3C Service Worker Update Protocol

**Source**: https://www.w3.org/TR/service-workers/ (2026-10-29 nightly)

**Update detection trigger** (spec algorithm):
- Every navigation into scope
- push or sync event if last check > 24h ago
- egistration.update() call
- Worker script byte-for-byte comparison (main script + importScripts())

**updateViaCache** (registration option):

| Value | Main script | Imported scripts | Use case |
|-------|------------|-----------------|----------|
| "imports" (default) | Always revalidate (no-cache) | HTTP cache allowed | Hash-named imports |
| "all" | HTTP cache allowed | HTTP cache allowed | Rate-limit checks |
| "none" | Always revalidate | Always revalidate | Stable-URL imports |

**24-hour rule**: If registration not checked for > 86400s, ALL scripts fetched with no-cache regardless of mode.

**Update algorithm steps**:
1. Fetch main script: Service-Worker: script header, mode 
one, redirect error
2. Choose cache mode per updateViaCache
3. Validate: status OK, MIME type JavaScript, scope within max
4. Record check time (if network response or 304)
5. Byte-compare main script with newest worker
6. If same: byte-compare each importScripts() URL
7. If nothing changed: resolve with registration
8. If changed: create new worker, run script, fire install event
9. New worker enters waiting state

**skipWaiting()** (spec section 4.1.4):
1. Set worker's skip-waiting flag
2. Invoke Try Activate with containing registration
3. Try Activate runs if: no clients using registration OR skip-waiting flag set AND active worker has no pending events

**clients.claim()** (spec section 4.3.4):
1. Must be active worker (else InvalidStateError)
2. For each client with matching storage key:
   - If client not secure context: skip
   - If client's registration != this registration: skip
   - If client's active SW != this worker:
     - Handle Service Worker Client Unload
     - Set client's active SW to this worker
     - Invoke Notify Controller Change (fires controllerchange in page)

**Cross-tab fan-out**:
- skipWaiting() + clients.claim() affects ALL tabs in scope simultaneously
- Each tab fires controllerchange event
- Mixed-version risk: tab loaded v1 HTML/JS, now controlled by v2 worker
- v2 worker may have deleted v1 caches → lazy-loaded chunks 404
- Safe pattern: user-initiated activation + controllerchange reload

### 9.2 Workbox Update Strategies

**Source**: https://developer.chrome.com/docs/workbox/modules/workbox-strategies

**CacheFirst**:
`javascript
import { CacheFirst } from 'workbox-strategies';
registerRoute(({request}) => request.destination === 'style', new CacheFirst());
`
- Check cache → hit: return cached. Miss: fetch network, cache, return.
- Caches: status 200 only (default).

**NetworkFirst**:
`javascript
import { NetworkFirst } from 'workbox-strategies';
registerRoute(({url}) => url.pathname.startsWith('/api/'), new NetworkFirst({
  networkTimeoutSeconds: 5
}));
`
- Fetch network → success: cache + return. Fail/timeout: return cached.
- Caches: status 0 (opaque) + 200 (default).
- Timeout: request continues in waitUntil(), cache updated on completion.

**StaleWhileRevalidate**:
`javascript
import { StaleWhileRevalidate } from 'workbox-strategies';
registerRoute(({url}) => url.pathname.startsWith('/images/'), new StaleWhileRevalidate());
`
- Parallel: cache read + network fetch
- Return cached immediately (or wait for network if no cache)
- Always revalidates (no freshness window built-in)
- Caches: status 0 + 200 (default)

**BroadcastUpdatePlugin** (from workbox-broadcast-update):
`javascript
import { BroadcastUpdatePlugin } from 'workbox-broadcast-update';
registerRoute(
  ({url}) => url.pathname.startsWith('/api/'),
  new StaleWhileRevalidate({
    plugins: [new BroadcastUpdatePlugin()]
  })
);
`

**How updates are detected**: Compares Content-Length, ETag, Last-Modified headers between cached and new Response. NOT byte comparison.

**Message to clients**:
`javascript
navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data.meta === 'workbox-broadcast-update') {
    const { cacheName, updatedURL } = event.data.payload;
    // Reload or update UI
  }
});
`

**Limitation**: Cannot be used with workbox-precaching (precached URLs are content-addressed, never overwritten).

### 9.3 skipWaiting Race and Client Lifecycle

**The problem**:
- skipWaiting() in install → new worker activates immediately
- clients.claim() in ctivate → new worker controls ALL tabs
- Old tabs still running v1 code, but network intercepted by v2 worker
- v2 worker may have deleted v1 cache entries in ctivate
- Lazy-loaded chunks from v1 → 404

**Safe pattern** (user-initiated):
`javascript
// Page:
let reloaded = false;
navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (reloaded) return;
  reloaded = true;
  location.reload();
});
const reg = await navigator.serviceWorker.ready;
if (reg.waiting) {
  reg.waiting.postMessage({ type: 'activate-now' });
}

// Worker:
self.addEventListener('message', (event) => {
  if (event.data?.type === 'activate-now') self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
`

**Error semantics**:
- skipWaiting(): resolves with undefined (never rejects)
- clients.claim(): rejects InvalidStateError if not active
- egistration.update(): rejects TypeError (bad MIME) or InvalidStateError (unregistered)

### 9.4 Subresource Integrity (SRI)

**When validated**: At fetch time, BEFORE the resource is used. Chrome validates SRI hashes on:
- <script src="..." integrity="sha256-...">
- <link href="..." rel="stylesheet" integrity="sha256-...">
- <link href="..." rel="preload" as="script" integrity="sha256-...">

**On hash mismatch**:
- Chrome: **Blocks the resource entirely**. Console error: "Failed to find a valid digest in the 'integrity' attribute"
- The resource is NOT cached, NOT executed, NOT rendered
- Network request still completes (wasted bandwidth)
- error event fires on the element
- Service worker etch handler sees the request normally (SRI is a browser-level check post-fetch)

**Interaction with Service Workers**:
- SW can serve cached response → SRI still validated against cached bytes
- If cache was poisoned (different bytes), SRI catches it
- SW etch event does NOT know about SRI (it's a rendering-layer check)
- If SW serves a response with wrong hash → resource blocked, page broken

**Practical implication for updates**: If you change a precached asset, the hash in SRI must match the new bytes. Content-hashed filenames (e.g., main.abc123.js) avoid this because the URL changes.

### 9.5 Web App Manifest

The manifest.json has NO ersion field in the W3C spec. Version management is the developer's responsibility (typically via the service worker update).

**No manifest signature mechanism exists** in the W3C spec. The manifest is just a JSON document fetched at install/launch.

### 9.6 Cloudflare Pages Atomic Deploy

**How it works**:
1. Build runs on Cloudflare's build system
2. All output files uploaded to a **new deployment** (content-addressed, fingerprinted)
3. Only changed files re-uploaded (content hash comparison)
4. Once 100% uploaded: live URL **atomically flipped** to new deployment
5. Previous deployment remains accessible at its hash URL (e.g., 373f31e2.app.pages.dev)
6. New deployment gets URL: {hash}.app.pages.dev + production domain

**Zero-downtime guarantee**: Visitors see fully-old OR fully-new. Never a half-deployed state.

**Preview deployments**:
- Branch development → bc123.app.pages.dev (unique hash)
- Alias: development.app.pages.dev → always points to latest on that branch
- Production: main branch → pp.pages.dev (no hash prefix)

**Service Worker interaction**:
- SW script at /sw.js is updated atomically with the deploy
- On next navigation, browser fetches /sw.js → byte comparison → new worker
- Precached assets may reference old filenames → Workbox handles via revision
- _worker.js, _headers, _redirects, _routes.json are Pages-reserved (404 as assets)
- **Critical**: Do NOT precache Pages-reserved paths (causes install failure)

**Netlify/Vercel**: Same atomic model. Build → new deploy → atomic flip. SW update detection is identical (byte comparison on next navigation).

### 9.7 Failure Modes

| Failure | Behavior |
|---------|----------|
| SW script 404 | No update possible (registration stuck) |
| SW script MIME type wrong | Install fails, worker redundant |
| Precache entry 404 | Install fails (atomic), worker redundant |
| skipWaiting + cache deleted | Mixed-version clients, lazy chunks 404 |
| SRI mismatch | Resource blocked, page broken |
| updateViaCache: "all" + stale HTTP cache | Update delayed up to 24h |
| Multiple tabs, one calls update() | Others see updatefound event |
| Worker install rejects (waitUntil) | Worker becomes redundant, no update |
| Cloudflare Pages reserved path in precache | Install fails entirely |

---

## 10. Microsoft AutoUpdater (WinAppSDK / MSIX)

**PROTOCOL SURFACE**

### 10.1 MSIX Packaging Constraint

**App MUST be packaged as MSIX/MSIXBundle.** Auto-update via AppInstaller only works for:
- Packaged Windows apps (UWP, Win32 packaged, WinAppSDK)
- Installed via .appinstaller or .msix from non-Store source
- Windows 10 2004 (build 19041)+ or Windows 11

**Unpackaged apps** (traditional Win32 .exe): NOT eligible. Must use Squirrel.Windows, NSIS, or MSI.

### 10.2 AppInstaller (*.appinstaller) XML Schema

**Source**: https://learn.microsoft.com/en-us/windows/msix/app-installer/how-to-create-appinstaller-file

**Schema versions**:
| Schema | xmlns value | Features |
|--------|---------------|----------|
| 2017/2 | http://schemas.microsoft.com/appx/appinstaller/2017/2 | Basic OnLaunch, HoursBetweenUpdateChecks |
| 2018 | http://schemas.microsoft.com/appx/appinstaller/2018 | + ShowPrompt |
| 2021 | http://schemas.microsoft.com/appx/appinstaller/2021 | + UpdateBlocksActivation, ForceUpdateFromAnyVersion, UpdateURIs, RepairURIs |

**CRITICAL**: Visual Studio generates 2017/2 by default. ShowPrompt and UpdateBlocksActivation are **silently ignored** on 2017/2. Must manually change to 2021.

**Complete schema**:

`xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
    Version="1.0.0.0"
    Uri="https://contoso.com/installers/app.appinstaller">

    <MainBundle
        Name="Contoso.MainApp"
        Publisher="CN=Contoso, O=Contoso Inc., L=Redmond, S=WA, C=US"
        Version="2.23.12.43"
        Uri="https://contoso.com/installers/mainapp.msixbundle"/>

    <OptionalPackages>
        <Bundle
            Name="Contoso.OptionalApp1"
            Publisher="CN=Contoso, O=Contoso Inc."
            Version="2.23.12.43"
            Uri="https://contoso.com/installers/OptionalApp1.msixbundle"/>
        <Package
            Name="Fabrikam.Framework"
            Publisher="CN=Fabrikam, O=Fabrikam Inc."
            Version="1.5.0.0"
            Uri="https://contoso.com/installers/Fabrikam.Framework.msix"
            ProcessorArchitecture="x64"/>
    </OptionalPackages>

    <UpdateSettings>
        <OnLaunch
            HoursBetweenUpdateChecks="12"
            ShowPrompt="true"
            UpdateBlocksActivation="false"/>
        <AutomaticBackgroundTask/>
        <ForceUpdateFromAnyVersion>false</ForceUpdateFromAnyVersion>
    </UpdateSettings>

    <UpdateURIs>
        <UpdateURI>https://backup.contoso.com/installers/app.appinstaller</UpdateURI>
    </UpdateURIs>

    <RepairURIs>
        <RepairURI>https://contoso.com/installers/app.appinstaller</RepairURI>
    </RepairURIs>
</AppInstaller>
`

**Element reference**:

| Element | Required | Description |
|---------|----------|-------------|
| AppInstaller/@Version | Yes | AppInstaller file version (4-part) |
| AppInstaller/@Uri | Yes | Canonical URI to this .appinstaller file |
| MainBundle / MainPackage | Yes | The primary app package |
| MainBundle/@Name | Yes | Package family name |
| MainBundle/@Publisher | Yes | Full certificate subject |
| MainBundle/@Version | Yes | 4-part version |
| MainBundle/@Uri | Yes | Download URL for .msixbundle/.msix |
| OptionalPackages/Bundle | No | Additional bundles |
| OptionalPackages/Package | No | Individual packages (with ProcessorArchitecture) |
| UpdateSettings/OnLaunch | No | Check on app launch |
| UpdateSettings/AutomaticBackgroundTask | No | Background check every 8h |
| UpdateSettings/ForceUpdateFromAnyVersion | No | Allow downgrades |
| UpdateURIs/UpdateURI | No (2021) | Fallback update URLs (max 10) |
| RepairURIs/RepairURI | No (2021) | Fallback repair URLs |

**OnLaunch attributes**:

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| HoursBetweenUpdateChecks | 0-255 | 24 | Min hours between checks (0 = every launch) |
| ShowPrompt | bool | false | Show UI on update (2018+) |
| UpdateBlocksActivation | bool | false | Block launch until updated (2021+, requires ShowPrompt=true) |

**AutomaticBackgroundTask**:
- Checks every 8 hours independently of app launch
- Cannot show UI (silent)
- Available since Windows 10 1803

### 10.3 Auto-Update Semantics

**Flow**:
1. App launches (or 8h background timer fires)
2. OS deployment service fetches .appinstaller from Uri
3. If Uri fails → try each UpdateURI in order
4. Parse XML, compare MainBundle/@Version with installed version
5. If newer (or same with ForceUpdateFromAnyVersion):
   - ShowPrompt=false: silent install in background
   - ShowPrompt=true, UpdateBlocksActivation=false: prompt, user can skip (app launches, update applies later)
   - ShowPrompt=true, UpdateBlocksActivation=true: prompt, user MUST update or close
6. Download new .msixbundle/.msix from MainBundle/@Uri
7. Atomic package replacement (OS-managed)
8. App relaunched with new version

**CSP override** (enterprise):
- Path: ./Device/Vendor/MSFT/EnterpriseModernAppManagement/AppManagement/nonStore/{family}/AppUpdateSettings/
- CSP settings override all other configurations
- Can force-disable auto-update per package

### 10.4 winget Interaction

**winget does NOT use .appinstaller files directly.**

- winget has its own manifest format (YAML in winget-pkgs repo)
- winget downloads and installs .exe/.msi/.msix independently
- If a winget-installed MSIX app has an .appinstaller, the AppInstaller service may still manage updates
- **Conflict potential**: winget updates (manual winget upgrade) vs AppInstaller auto-updates can race
- In practice: if app was installed via .appinstaller, AppInstaller manages updates. winget install of a .msix directly does NOT register with AppInstaller.

### 10.5 SmartScreen Reputation

**2024 change**: EV certificates NO LONGER grant instant SmartScreen bypass.

**Current model** (post-2024 Trusted Root Program update):
- Reputation built from: file hash + publisher certificate identity
- EV cert: same as OV cert (no instant bypass)
- Signed files: publisher reputation carries across releases (same cert)
- Unsigned files: must rebuild reputation per new hash
- New publisher: initial downloads show SmartScreen warning until reputation threshold met

**Bootstrap problem**:
- Fresh app (new publisher) → first users get "Windows protected your PC"
- Solutions: distribute via Microsoft Store (no SmartScreen), build publisher reputation over time, or accept the warning
- No technical workaround for non-Store, non-Microsoft-signed binaries

**Source**: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/distribution-feature-status

### 10.6 Windows App SDK (WinAppSDK) Specifics

**Microsoft.Windows.AppLifecycle** does NOT provide auto-update. The auto-update mechanism is:
- **OS-level**: AppInstaller service (described above)
- **WinAppSDK**: Provides packaging tools, MSIX packaging, but NOT the update mechanism itself
- WinAppSDK apps use the same .appinstaller auto-update as any other MSIX app

**WinAppSDK-specific considerations**:
- Self-contained vs framework-dependent deployment affects package size
- Dynamic Dependencies (WinAppSDK framework package) must be listed in OptionalPackages
- The framework package version must be compatible with the app's minimum version
- MddBootstrapInit API for framework-dependent apps (Windows 10 without App Installer)

### 10.7 Failure Modes

| Failure | Behavior |
|---------|----------|
| .appinstaller URL 404 | Try UpdateURIs, then fail silently |
| XML parse error | Update skipped |
| Schema 2017/2 + ShowPrompt | Attribute silently ignored |
| Version same (no ForceUpdateFromAnyVersion) | No update |
| Download .msixbundle fails | Update deferred to next check |
| Package registration fails (0x80070490) | Old version unregistered, new not registered → app broken |
| Publisher mismatch | Package rejected |
| SmartScreen blocks download | User must click "More info" → "Run anyway" |
| Windows 10 1709-1802 | AutomaticBackgroundTask not available |
| CSP disabled auto-update | No updates regardless of .appinstaller settings |

---

## CROSS-REFERENCE TABLE

| System | Manifest Format | Signing | Delta | Rollout | Host Req |
|--------|----------------|---------|-------|---------|----------|
| Squirrel.Windows | RELEASES (plain text) | None (TLS+SHA1) | msdelta .nupkg | Staging % in RELEASES | Static files |
| Squirrel.Mac | Appcast XML (RSS 2.0) | DSA (legacy) | N/A | N/A | Static files |
| Sparkle 2.x | Appcast XML (RSS 2.0) | Ed25519 (RFC 8032) | Custom binary delta (v4) | Phased (time-based) | Static files + Keychain |
| electron-updater | latest.yml (YAML) | Ed25519 manifest sig (v27+) | Blockmap (MD5 blocks) | stagingPercentage | Provider-specific |
| Tauri 2 | JSON (static/dynamic) | minisign Ed25519 | zstd (experimental) | Server-side | Static files or API |
| Capawesome | JSON (API) | RSA (SHA-256) | File-level manifest | Server-side % | Cloud or self-hosted API |
| Expo Updates | JSON (Updates V1) | RSA PKCS#1 v1.5 (SHA-256) | bsdiff (optional) | Server-side % | EAS or custom server |
| CodePush (dead) | JSON (API) | None (TLS+SHA256) | None (full ZIP) | Server-side % | App Center (dead) |
| PWA SW | Byte comparison (no manifest) | SRI (optional) | None (full re-download) | N/A | Static hosting |
| MSIX AppInstaller | XML (.appinstaller) | Authenticode (MSIX) | None (full package) | N/A (OS-managed) | Static files (HTTPS) |

---

## SOURCES AND VERSIONS

| System | Primary Source | Version/Date |
|--------|---------------|--------------|
| Squirrel.Windows | github.com/Squirrel/Squirrel.Windows (develop) | Last commit: 2024 |
| Sparkle 2.x | github.com/sparkle-project/Sparkle (2.x) | 2.7+ |
| electron-updater | github.com/electron-userland/electron-builder (master) | v27/v28 |
| Tauri 2 | v2.tauri.app/plugin/updater/ | 2.13.3 (Oct 2026) |
| Capawesome | github.com/capawesome-team/capacitor-plugins | v8.x |
| Expo Updates | docs.expo.dev/eas-update/ | SDK 53+ (2026) |
| CodePush | expo.dev/blog/what-to-do-without-codepush | Retired Mar 2025 |
| PWA SW | w3.org/TR/service-workers/ | 2026-10-29 |
| Workbox | developer.chrome.com/docs/workbox/ | v7.x |
| MSIX | learn.microsoft.com/windows/msix/ | Win11 24H2 |
