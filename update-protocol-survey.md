# Cross-Platform Signed Update Layer: Protocol Spec Survey

**Deliverable for AIRIZ Motor Console** — Juwen Lie
**Purpose**: Answer "If I go with the R2 layer, what is the smallest spec I need to implement?"
**Date**: 2026-11-05
**Scope**: 8 update protocols, field-by-field, with direct spec citations

---

## Table of Contents

1. electron-builder NSIS (electron-updater) latest.yml
2. Tauri 2.x Updater
3. Capacitor Live Update
4. Squirrel.Windows RELEASES
5. Sparkle Appcast XML
6. PWA Service Worker
7. Microsoft AppInstaller (.appinstaller)
8. Cloudflare Worker Deploy (wrangler)
9. Unified Minimum-Viable Manifest on R2

---

## 1. electron-builder NSIS (electron-updater) latest.yml

### Spec Source

The schema is defined in TypeScript source, not a formal spec document. The authoritative definitions live in:

- **Runtime types**: packages/builder-util-runtime/src/updateInfo.ts
  - GitHub: https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateInfo.ts
- **Build-time manifest generation**: packages/app-builder-lib/src/publish/updateInfoBuilder.ts
  - GitHub: https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/publish/updateInfoBuilder.ts
- **Provider options**: packages/builder-util-runtime/src/publishOptions.ts
  - GitHub: https://github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/publishOptions.ts

**Spec version**: No formal spec version. The format is stable across electron-builder v24-v28.
**Key PRs**: The iles[] array replaced top-level path/sha512 in electron-updater 2.16.0 (electron-builder v27). The Ed25519 manifest signing (signature + signatures[]) is a v27+ feature.

### Full Field List — UpdateInfo (the latest.yml schema)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| ersion | string (semver) | **Yes** | App version, e.g. 1.2.3 |
| iles | UpdateFileInfo[] | **Yes** | Array of update files (usually 1) |
| iles[].url | string | **Yes** | Relative to feed base URL or absolute |
| iles[].sha512 | string (base64) | **Yes** | SHA-512 hash of the file |
| iles[].size | number | Optional | File size in bytes (saves a HEAD request) |
| iles[].blockMapSize | number | Optional | Block map file size (for embedded block maps) |
| iles[].blockMapUrl | string | Optional | Custom block map URL (v27+) |
| iles[].isAdminRightsRequired | boolean | Optional | NSIS: whether admin elevation needed |
| eleaseName | string | Optional | e.g. "v1.2.3" |
| eleaseNotes | string or ReleaseNoteInfo[] | Optional | Rich text or structured notes |
| eleaseDate | string (ISO 8601) | **Yes** (auto-generated) | e.g. 2026-11-05T12:00:00.000Z |
| stagingPercentage | number (0-100) | Optional | Staged rollout percentage |
| minimumSystemVersion | string | Optional | e.g. 23.1.0 (macOS), 10.0.22631 (Win) |
| signature | string (base64) | Optional (v27+) | Ed25519 signature (first key) |
| signatures | UpdateManifestSignature[] | Optional (v27+) | Multi-key signatures for rotation |
| path | string | **Deprecated** | Legacy (pre-2.16), mirrors files[0].url |
| sha512 | string | **Deprecated** | Legacy (pre-2.16), mirrors files[0].sha512 |

**Windows-only extension** (WindowsUpdateInfo):

| Field | Type | Notes |
|-------|------|-------|
| packages | { [arch]: PackageFileInfo } | Per-arch web installer packages |
| packages[arch].path | string | Package URL |
| packages[arch].sha512 | string | Package hash |
| llowCatalogSignature | boolean | Accept Windows catalog signature (v27+) |

**UpdateManifestSignature**:

| Field | Type | Notes |
|-------|------|-------|
| keyId | string (hex SHA-256) | SHA-256 of SPKI DER of public key |
| signature | string (base64) | Ed25519 signature |

### The latest.yml.gz Variant

**There is NO latest.yml.gz variant in electron-builder.** The .gz in the electron-updater ecosystem refers to the **block map file format**:
- **Block map v2**: gzipped JSON (.blockmap file is actually gzip-compressed)
- **Block map v3** (electron-builder v27+): binary range-fetchable format

The block map is a separate file (<filename>.blockmap) used for differential downloads. The manifest itself (latest.yml) is always plain YAML.

**Evidence**: packages/electron-updater/src/AppUpdater.ts line 1564:
"A block map file as published (data) and decoded (map): v2 is gzipped JSON, v3 the binary range-fetchable map."

### Provider Configuration

**Generic provider** (provider: "generic"):
`json
{
  "provider": "generic",
  "url": "https://bucket.s3.amazonaws.com",
  "channel": "latest",
  "useMultipleRangeRequest": true
}
`
- The updater fetches {url}/{channel}.yml
- The url is the ONLY required field beyond provider

**S3 provider** (provider: "s3"):
`json
{
  "provider": "s3",
  "bucket": "my-bucket",
  "region": "ap-southeast-1",
  "path": "/releases",
  "acl": "public-read",
  "channel": "latest"
}
`
- Produces URL: https://{bucket}.s3.amazonaws.com/{path}/latest.yml
- No channelHeader — that concept does not exist. Channels are file-based.

**GitHub provider** (provider: "github"):
`json
{
  "provider": "github",
  "owner": "myorg",
  "repo": "myapp",
  "private": true,
  "token": "...",
  "channel": "latest",
  "releaseType": "draft"
}
`
- Private repo: Set GH_TOKEN env var at build time
- The GitHub provider uses the Atom feed to find the latest tag, then fetches {tag}/latest.yml

**R2 provider** (provider: "r2"):
`json
{
  "provider": "r2",
  "bucket": "my-releases",
  "accountId": "abc123...",
  "publicUrl": "https://pub-xxx.r2.dev"
}
`

### Minimum Viable Manifest (tiniest valid latest.yml)

`yaml
version: 1.0.0
files:
  - url: myapp-setup-1.0.0.exe
    sha512: aXbYcZ...
releaseDate: "2026-11-05T00:00:00.000Z"
`

5 lines. version + one file with url + sha512 + releaseDate.

### R2 Mapping

The latest.yml file is uploaded to R2 at a fixed key. The generic provider with url pointing to the R2 public domain works as-is.

---

## 2. Tauri 2.x Updater

### Spec Source

- **Official docs**: https://v2.tauri.app/plugin/updater/ (last updated Nov 28, 2025)
- **Source code**: https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater
- **npm**: @tauri-apps/plugin-updater
- **crates.io**: tauri-plugin-updater

**Spec version**: Tauri 2.x (plugin v2). The updater protocol was **rewritten for Tauri 2**. Tauri 1.x used a different static JSON format.

**Signing algorithm**: **Ed25519** (via the ing crate). Keys generated with 	auri signer generate.

### Full Field List — Static JSON Manifest

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| ersion | string (SemVer) | **Yes** | With or without leading  |
| 
otes | string | Optional | Release notes |
| pub_date | string (RFC 3339) | Optional | e.g. 2026-11-05T12:00:00Z |
| platforms | object | **Yes** | Keyed by {os}-{arch} |
| platforms.{key}.url | string (URL) | **Yes** | Download URL for update bundle |
| platforms.{key}.signature | string | **Yes** | Content of .sig file (NOT a path/URL) |

**Platform keys**: linux-x86_64, linux-aarch64, linux-armv7, darwin-x86_64, darwin-aarch64, windows-x86_64, windows-aarch64, windows-i686

### Dynamic Update Server Response

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| ersion | string (SemVer) | **Yes** | |
| pub_date | string (RFC 3339) | Optional | |
| url | string (URL) | **Yes** | Direct bundle URL |
| signature | string | **Yes** | Content of .sig file |
| 
otes | string | Optional | |

**No update**: Respond with HTTP 204 No Content.

### Multi-Platform Encoding

**One manifest, platform-keyed sections.** The static JSON contains ALL platforms. The client selects its own platform key.

`json
{
  "version": "2.0.0",
  "notes": "Major release",
  "pub_date": "2026-11-05T12:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "dW50cnVzdGVk...",
      "url": "https://releases.example.com/myapp_2.0.0_aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "MEUCIQ...",
      "url": "https://releases.example.com/myapp-setup-2.0.0.exe"
    }
  }
}
`

### Where the Public Key Lives

In 	auri.conf.json (embedded in binary at compile time):
`json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "endpoints": [
        "https://releases.example.com/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
`

Template variables: {{current_version}}, {{target}}, {{arch}}

### What tauri sign Outputs

	auri signer sign <file> produces a .sig file with a **base64-encoded Ed25519 signature**. This string is embedded verbatim in the manifest's signature field.

### Minimum Viable Manifest (static JSON)

`json
{
  "version": "1.0.0",
  "platforms": {
    "windows-x86_64": {
      "url": "https://releases.example.com/myapp-setup-1.0.0.exe",
      "signature": "MEUCIQ..."
    }
  }
}
`

3 fields: version + one platform entry with url + signature.

### R2 Mapping

Static JSON uploaded to R2. Worker serves it as dynamic endpoint filtering by target/arch/version path params.

---

## 3. Capacitor Live Update

### Spec Source

| Package | Status | Repo |
|---------|--------|------|
| @capacitor/live-update (Ionic) | **Maintenance/deprecated** | Was in ionic-team/capacitor monorepo |
| @capacitor-community/live-update (Capawesome) | **Archived** | capawesome-team/capacitor-live-update (404) |
| CapGo Live Update | **Active** (formerly Capawesome) | Cap-go/capgo |
| @hotcodepush/capacitor-live-updates | **Active** (new) | hotcodepush-team/capacitor-live-updates |

### CapGo Live Update (Active)

**Bundle format**: Compressed archive of web assets (dist/ folder). Optionally brotli-compressed. Delta via binary diff.

**Manifest fields** (server-side, per bundle):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| ppId | string | **Yes** | e.g. com.example.app |
| channel | string | **Yes** | production, beta |
| undle (version) | string | **Yes** | Must be > 0.0.0 and unique |
| message | string | Optional | Release notes |
| link | string (URL) | Optional | External link |
| minUpdateVersion | string | Optional | Min app version for this update |
| signature | string | **Yes** (v2) | v2 Ed25519 signature |
| checksum | string | **Yes** | Bundle checksum |
| ivSessionKey | string | Optional | For encrypted bundles |

**Server**: CapGo Cloud (SaaS) or self-hosted with S3-compatible storage.
**Signing**: Ed25519 (v2, keyV2/keyDataV2).
**Delta updates**: Binary diff files.

### HotCodePush (Newest)

Uses **bspatch** (BSD bsdiff) for deltas + bzip2 on Android. Uses release **number** (integer) instead of version string.

### Minimum Viable Manifest (CapGo model)

`json
{
  "appId": "com.airiz.motor-console",
  "channel": "production",
  "bundle": "1.0.0",
  "checksum": "sha256:abc123...",
  "signature": "base64-ed25519-sig..."
}
`

### R2 Mapping

Bundle (tar.gz) to R2. Manifest as static file or KV. CapGo supports S3-compatible storage so R2 works directly.

---

## 4. Squirrel.Windows RELEASES

### Spec Source

- **Source**: https://github.com/Squirrel/Squirrel.Windows
- **Key file**: src/Squirrel/ReleaseEntry.cs
  - Raw: https://raw.githubusercontent.com/Squirrel/Squirrel.Windows/develop/src/Squirrel/ReleaseEntry.cs
- **Test fixture**: 	est/Squirrel.Tests/fixtures/RELEASES-OnePointOne

**Spec version**: Stable since Squirrel.Windows 1.x (2015-present). Repo in maintenance mode.

### RELEASES File Line Format

**Regex** (ReleaseEntry.cs line 95):
`
^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$
`

**Line format**: <SHA1-40-hex> <filename> <size-bytes>

**Example** (from test fixture):
`
94689fede03fed7ab59c24337673a27837f0c3ec  MyCoolApp-1.0.nupkg  1004502
3a2eadd15dd984e4559f2b4d790ec8badaeb6a39  MyCoolApp-1.1.nupkg  1040561
14db31d2647c6d2284882a2e101924a9c409ee67  MyCoolApp-1.1-delta.nupkg  80396
`

**Optional staging**:  # NN% suffix (e.g.  # 50%)

| Component | Format | Notes |
|-----------|--------|-------|
| SHA1 | 40-char lowercase hex | Contract.Requires(sha1.Length == 40) |
| Filename | No path separators | Or absolute HTTP(S) URL |
| Size | Positive integer bytes | Contract.Requires(filesize > 0) |
| Staging |  # NN% | Optional comment suffix |

**Delta detection**: Filename ends with -delta.nupkg (case-insensitive).
**Delta encoding**: NuGet package (ZIP) containing binary diff. Client applies on top of base version.

### Update.exe Behavior

1. Downloads RELEASES from feed URL (?id=PackageName&localVersion=ver&arch=amd64)
2. Parses entries, sorts by version descending
3. Finds latest > local version
4. Checks for delta matching local version
5. If delta: download + apply on top of current
6. If no delta: download full .nupkg, extract, new version dir
7. Atomically swaps app-* directory symlink
8. Re-launches app

**Installed dir structure**:
`
App-1.0.0/
App-1.1.0/
app-* -> App-1.1.0/  (symlink)
RELEASES  (local copy)
`

### .nuspec Package Metadata

Each .nupkg is a NuGet package (ZIP) with:
- *.nuspec: id, version, releaseNotes (Markdown), icon
- package/ folder with app files

### Minimum Viable RELEASES File

`
94689fede03fed7ab59c24337673a27837f0c3ec  MyApp-1.0.0.nupkg  1004502
`

One line: SHA1 + filename + size.

### R2 Mapping

RELEASES as plain text in R2. .nupkg files alongside. Feed URL = R2 public domain + /RELEASES.

---

## 5. Sparkle Appcast XML

### Spec Source

- **Official docs**: https://sparkle-project.org/documentation/publishing/
- **Sample appcast**: https://sparkle-project.org/files/sparkletestcast.xml
- **Source**: https://github.com/sparkle-project/Sparkle
- **Test fixture**: https://raw.githubusercontent.com/sparkle-project/Sparkle/2.x/Tests/Resources/testappcast.xml

**Spec version**: Sparkle 2.x. **Critical distinction**:
- **Sparkle 1.x**: sparkle:dsaSignature (DSA)
- **Sparkle 2.x**: sparkle:edSignature (Ed25519/EdDSA)

**Signing**: Ed25519. Keys via ./bin/generate_keys. Public key in Info.plist as SUPublicEDKey.

### Full Appcast XML Schema

**Root**:
`xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>App Name</title>
    <item>...</item>
  </channel>
</rss>
`

**item fields**:

| Element | Required | 1.x | 2.x | Notes |
|---------|----------|-----|-----|-------|
| <title> | **Yes** | Y | Y | "Version 2.0" |
| <link> | Optional | Y | Y | Product website |
| <sparkle:version> | **Yes** | Y | Y | CFBundleVersion |
| <sparkle:shortVersionString> | Optional | Y | Y | Human-readable |
| <pubDate> | Optional | Y | Y | RFC 2822, needed for phased rollout |
| <description> | Optional | Y | Y | Release notes (HTML or plain-text) |
| <enclosure url> | **Yes** | Y | Y | Archive URL |
| <enclosure length> | Optional | Y | Y | File size bytes |
| <enclosure type> | Optional | Y | Y | MIME type |
| <enclosure sparkle:edSignature> | **Yes** (2.x) | No | **Yes** | Ed25519 sig |
| <enclosure sparkle:dsaSignature> | **Yes** (1.x) | **Yes** | No | DSA (deprecated) |
| <sparkle:minimumSystemVersion> | Optional | Y | Y | e.g. 12.0.0 |
| <sparkle:maximumSystemVersion> | Optional | Y | Y | |
| <sparkle:criticalUpdate> | Optional | Y (in tags) | Y (top-level) | Force update |
| <sparkle:criticalUpdate sparkle:version> | Optional | No | **Yes** | Critical only below this |
| <sparkle:phasedRolloutInterval> | Optional | No | **Yes** | Seconds between groups |
| <sparkle:channel> | Optional | No | **Yes** | e.g. beta |
| <sparkle:minimumAutoupdateVersion> | Optional | No | **Yes** | Major upgrade gate |
| <sparkle:minimumUpdateVersion> | Optional | No | **Yes** (2.9+) | Min version to see update |
| <sparkle:hardwareRequirements> | Optional | No | **Yes** (2.9+) | e.g. arm64 |
| <sparkle:releaseNotesLink> | Optional | Y | Y | External notes |
| <sparkle:fullReleaseNotesLink> | Optional | No | **Yes** | Full changelog |
| <sparkle:informationalUpdate> | Optional | No | **Yes** | Non-installing |
| <sparkle:deltas> | Optional | Y | **Yes** | Delta enclosures |
| <sparkle:deltas enclosure sparkle:deltaFrom> | **Yes** (for delta) | Y | Y | Base version |

**Signed feed** (2.9+): The appcast itself can be signed with sparkle:edSignature on root.

### Minimum Viable Appcast Item

`xml
<item>
  <title>Version 1.0.0</title>
  <sparkle:version>1.0.0</sparkle:version>
  <enclosure url="https://releases.example.com/MyApp-1.0.0.zip"
             sparkle:edSignature="base64sig=="
             length="1623481"
             type="application/octet-stream" />
</item>
`

### R2 Mapping

Appcast XML as static file in R2. Worker can generate dynamically for per-user channel/rollout. Archives are R2 objects.

---

## 6. PWA Service Worker Update Lifecycle

### Spec Source

- **W3C Spec**: Service Workers 1 (Editor's Draft, 2 Aug 2021)
  - https://w3c.github.io/ServiceWorker/v1/
  - GitHub: https://github.com/w3c/ServiceWorker
- **MDN**: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- **MDN update()**: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/update

**Spec status**: W3C Editor's Draft (NOT a Recommendation). Nightly: https://w3c.github.io/ServiceWorker/

### Lifecycle States

`
parsed -> installing -> installed -> activating -> activated -> redundant
`

### Registration


avigator.serviceWorker.register(scriptURL, options):

| Option | Type | Default | Notes |
|--------|------|---------|-------|
| scope | string (URL) | script dir | Max scope via Service-Worker-Allowed header |
| updateViaCache | "imports"\|"all"\|"none" | "imports" | |

**updateViaCache semantics**:
- "imports": Script cached, importScripts() always network
- "all": Everything uses HTTP cache
- "none": **Bypass HTTP cache entirely** for script fetch (critical for updates)

**Service-Worker-Allowed header**: Controls max scope. Service-Worker-Allowed: / allows controlling entire origin.

### Update Algorithm (registration.update())

1. Fetch script URL (respecting updateViaCache)
2. Compare bytes with current active worker
3. If different: create new ServiceWorker in installing state
4. If same: no new worker

### Installation Phase

install event. Call event.waitUntil(promise) to extend lifetime.
Promise rejects -> worker becomes edundant.

### Activation Phase

New worker in installed (waiting) state. Transitions to ctivated when:
- Previous active worker terminated (all clients close), OR
- New worker calls skipWaiting()

**skipWaiting()**: Forces immediate activation, replacing current worker.
**clients.claim()**: Immediately takes control of all clients in scope.

### Fetch Phase

Worker intercepts fetch events within scope after activation.

### The "Stuck Waiting" Problem

New SW installed but stays in installed state because old worker still controls open tabs.

**Solutions**:
1. skipWaiting() in install event
2. clients.claim() in activate event
3. egistration.update() on timer/visibility change
4. updateViaCache: 'none' for reliable re-fetch

### Minimum Viable SW Update

No manifest. The mechanism is:
1. Server serves new sw.js with different bytes
2. Browser detects on update() or periodic check
3. SW code calls skipWaiting() + clients.claim()

**Required HTTP headers on sw.js**:
- Cache-Control: no-cache (or no-store)
- Service-Worker-Allowed: / (if not at root)
- Content-Type: application/javascript

### R2 Mapping

PWA from R2 (static) + Worker (SW script with dynamic headers). Worker must serve sw.js with no-cache headers and bump content on deploy.

---

## 7. Microsoft AppInstaller (.appinstaller)

### Spec Source

- **MS Docs**: https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root
- **GitHub**: https://github.com/MicrosoftDocs/winrt-related-pr/blob/live/winrt-related-src/schemas/appinstallerschema/schema-root.md
- **Namespace**: xmlns="http://schemas.microsoft.com/appx/appinstaller/2017/2" (Win 10 1803+)
- **Namespace s4**: xmlns:s4="http://schemas.microsoft.com/appx/appinstaller/2021" (Win 21H2+)

**Spec version**: Versioned by namespace. 2017/2 = base, 2021 = adds background task, force update, repair URIs.
**Minimum OS**: Windows 10 1803 (build 17134)

### Full Element List

| Element | Description |
|---------|-------------|
| <AppInstaller> | Root (Version, PublisherIdentity, Uri attributes) |
| <MainBundle> | Main bundle (name, publisher, version must match manifest) |
| <MainPackage> | Main package (name, publisher, version, Uri, ProcessorArchitecture) |
| <OptionalPackages> | Container for optional Package elements |
| <Package> | A package (Name, Publisher, Version, Uri, ProcessorArchitecture) |
| <RelatedPackages> | Related (not installed) packages |
| <Dependencies> | Dependency packages |
| <UpdateSettings> | Update behavior config |
| <OnLaunch> | Check on app launch (HoursBetweenUpdateChecks attr) |
| s4:AutomaticBackgroundTask | Background check every 8 hours |
| s4:ForceUpdateFromAnyVersion | Allow downgrade |
| s4:MainPackageType | MSIX, APPX, or MSI |
| s4:RepairUris / s4:RepairUri | Repair URLs |
| s4:UpdateUris / s4:UpdateUri | Additional update URLs |

### Key Package Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | string | **Yes** | Must match package identity |
| Publisher | string | **Yes** | Must match package identity |
| Version | string | **Yes** | Must match package identity |
| Uri | string (URL) | **Yes** | Download URL |
| ProcessorArchitecture | string | Optional | x64, arm64, x86, neutral |
| InstallerParameters.InstallCommand | string | Optional | MSI CLI args |
| InstallerParameters.UpdateCommand | string | Optional | |

### UpdateSettings

| Child | Type | Notes |
|-------|------|-------|
| <OnLaunch> | element | With HoursBetweenUpdateChecks |
| s4:AutomaticBackgroundTask | element | Every 8 hours, no UI |
| <UpdateBlocksActivation> | boolean | Block activation during update |
| s4:ForceUpdateFromAnyVersion | boolean | Allow downgrade |

### Signature

The .appinstaller is **NOT** XML-signed. Security = Authenticode signature on the .msix package. App Installer validates package signature at install.

### Minimum Viable .appinstaller

`xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
  xmlns="http://schemas.microsoft.com/appx/appinstaller/2017/2"
  Version="1.0.0.0"
  PublisherIdentity="CN=MyCompany"
  Uri="https://releases.example.com/myapp.appinstaller">
  <MainPackage
    Name="MyCompany.MyApp"
    Publisher="CN=MyCompany"
    Version="1.0.0.0"
    Uri="https://releases.example.com/MyApp-1.0.0.0.msix" />
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="24" />
  </UpdateSettings>
</AppInstaller>
`

### R2 Mapping

.appinstaller XML + .msix both in R2. Worker serves .appinstaller with Content-Type: application/xml. Can generate dynamically from R2 metadata.

---

## 8. Cloudflare Worker Deploy (wrangler)

### Spec Source

- **Workers docs**: https://developers.cloudflare.com/workers/
- **Versions & deployments**: https://developers.cloudflare.com/workers/versions-and-deployments/
- **Rollbacks**: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- **Version URLs**: https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/
- **KV**: https://developers.cloudflare.com/kv/
- **Wrangler**: https://developers.cloudflare.com/workers/wrangler/

**Spec version**: Versioned by compatibility_date in wrangler.jsonc. Current stable: 2026-10.

### What wrangler Produces

wrangler deploy produces:
1. **Bundled script** (ES module, esbuild-bundled)
2. **Bindings** (KV, R2, D1, DO references)
3. **Static assets** (if configured)
4. **Compatibility date/flags**

Creates a **Version** (immutable snapshot) + **Deployment** (traffic pointer).

### Versioned URL

`
<version-prefix>-<worker-name>.<subdomain>.workers.dev
`

- Auto-generated when preview_urls: true
- Aliased: staging-my-worker.mysubdomain.workers.dev
- 1000 most recent aliases retained
- Public by default (Cloudflare Access can protect)

### wrangler rollback Semantics

- Creates a **new deployment** pointing to the old version (NOT a re-deploy)
- Bindings are NOT rolled back (if KV was deleted, rollback fails)
- Limited to **100 most recent versions**
- Atomic: replaces current deployment with selected version at 100%

### Workers KV

- No built-in value versioning
- Each put() is eventually consistent (~60s propagation)
- Manual versioning: key:v1, key:v2, etc.
- For update manifest: store at fixed key, atomic swap on deploy

### Tail Workers

Receive events from a tail Worker (requests, logs, errors). Do NOT serve traffic.
Use for: monitoring manifest fetches, logging which version clients got, alerting.

### Audit/Logging

- wrangler deployments list (last 100)
- wrangler versions list (last 100)
- Workers Logs (real-time)
- Analytics Engine (queryable)
- Logpush (continuous export)

### Minimum Viable Worker for Update Manifest

`js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/manifest.json') {
      const m = await env.KV.get('latest', { type: 'json' });
      return new Response(JSON.stringify(m), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }
      });
    }
    const obj = await env.BUCKET.get(url.pathname.slice(1));
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
      headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' }
    });
  }
}
`

---

## 9. Unified Minimum-Viable Manifest on R2

### Analysis: Required Fields Across All 8 Protocols

| Concern | electron | Tauri | Capacitor | Squirrel | Sparkle | PWA | AppInstaller | CF Worker |
|---------|----------|-------|-----------|----------|---------|-----|--------------|-----------|
| Version (semver) | Y | Y | Y | Y (filename) | Y | N/A | Y | N/A |
| Download URL | Y | Y | Y | Y (filename) | Y | N/A | Y (Uri) | N/A |
| Integrity hash | SHA-512 | (in sig) | checksum | SHA-1 | (in sig) | N/A | Authenticode | N/A |
| File size | opt | N/A | N/A | **Req** | opt | N/A | N/A | N/A |
| Ed25519 sig | v27+ | **Req** | v2 | None | 2.x **Req** | N/A | N/A | N/A |
| Release date | **Req** | opt | N/A | N/A | opt | N/A | N/A | N/A |
| Platform targeting | arch in files | platforms{} | channel | arch in URL | sparkle:os | N/A | ProcArch | N/A |
| Channel | file-based | endpoint | channel | N/A | sparkle:channel | N/A | N/A | N/A |
| Staged rollout | stagingPct | N/A | minVersion | # NN% | phasedInterval | N/A | N/A | N/A |

### The Smallest Common Set

1. **version** — all 6 artifact protocols
2. **url** — all
3. **sha512** (or stronger) — electron, Capacitor; Tauri/Sparkle use sig which implies integrity
4. **signature** (Ed25519) — Tauri, Sparkle 2.x, electron v27+, Capacitor v2
5. **releaseDate** — electron (required), Tauri/Sparkle (optional)

### Proposed Unified Manifest JSON

`json
{
  "\": "https://airiz.dev/schemas/manifest-v1.json",
  "version": "1.0.0",
  "channel": "stable",
  "releaseDate": "2026-11-05T12:00:00.000Z",
  "releaseNotes": "Initial release",
  "minimumSystemVersion": null,
  "stagingPercentage": 100,
  "signature": "base64-ed25519-of-canonical-manifest",
  "signatures": [
    { "keyId": "hex-sha256-of-spki-der", "signature": "base64-ed25519" }
  ],
  "artifacts": {
    "electron-windows-x64": {
      "url": "/releases/electron/myapp-setup-1.0.0.exe",
      "sha512": "base64...",
      "size": 104857600,
      "signature": "base64-ed25519-of-file"
    },
    "electron-macos-aarch64": {
      "url": "/releases/electron/myapp-1.0.0.zip",
      "sha512": "base64...",
      "size": 98304000,
      "signature": "base64-ed25519-of-file"
    },
    "tauri-windows-x64": {
      "url": "/releases/tauri/myapp-setup-1.0.0.exe",
      "signature": "base64-ed25519-tauri-sig"
    },
    "tauri-macos-aarch64": {
      "url": "/releases/tauri/myapp.app.tar.gz",
      "signature": "base64-ed25519-tauri-sig"
    },
    "capacitor-bundle": {
      "url": "/releases/capacitor/bundle-1.0.0.tar.gz",
      "checksum": "sha256:...",
      "signature": "base64-ed25519-capgo-sig",
      "format": "tar.gz"
    },
    "squirrel-windows": {
      "url": "/releases/squirrel/MyApp-1.0.0.nupkg",
      "sha1": "40-hex-chars",
      "size": 1004502
    },
    "sparkle-macos": {
      "url": "/releases/sparkle/MyApp-1.0.0.zip",
      "edSignature": "base64-ed25519-sparkle-sig",
      "length": 1623481
    },
    "msix-windows": {
      "url": "/releases/msix/MyApp-1.0.0.0.msix",
      "publisher": "CN=Airiz",
      "processorArchitecture": "x64"
    }
  },
  "pwa": {
    "serviceWorkerUrl": "/sw.js",
    "serviceWorkerHash": "sha256-of-sw.js",
    "updateStrategy": "skipWaiting"
  }
}
`

### Per-Protocol Adaptation (Worker Endpoints)

| Protocol | Endpoint | Transformation |
|----------|----------|----------------|
| electron-updater | GET /electron/latest.yml | Render YAML from artifacts.electron-* |
| Tauri updater | GET /tauri/{target}/{arch}/{ver} | Dynamic JSON (200 or 204) |
| Capacitor | GET /capacitor/manifest?channel=X | Channel-filtered JSON |
| Squirrel | GET /squirrel/RELEASES | Plain text lines |
| Sparkle | GET /sparkle/appcast.xml | RSS XML |
| PWA | GET /sw.js | SW with Cache-Control: no-cache |
| AppInstaller | GET /msix/myapp.appinstaller | XML |
| Worker itself | (IS the deploy target) | wrangler deploy |

### R2 Object Layout

`
releases/
  manifest.json
  electron/
    myapp-setup-1.0.0.exe
    myapp-setup-1.0.0.exe.blockmap
    myapp-1.0.0.zip
  tauri/
    myapp-setup-1.0.0.exe
    myapp-setup-1.0.0.exe.sig
    myapp.app.tar.gz
  capacitor/
    bundle-1.0.0.tar.gz
  squirrel/
    RELEASES
    MyApp-1.0.0.nupkg
  sparkle/
    appcast.xml
    MyApp-1.0.0.zip
  msix/
    myapp.appinstaller
    MyApp-1.0.0.0.msix
`

### KV Keys

`
manifest:latest      -> unified manifest JSON (atomic swap)
manifest:beta        -> beta channel variant
sw:hash              -> current SW content hash
deploy:history       -> [{version, timestamp, manifestHash}]
`

### Signing Strategy (Single Key, Multi-Protocol)

**One Ed25519 key pair** signs:
1. The **manifest** (canonical JSON -> Ed25519 -> signature field)
2. Each **artifact file** (file bytes -> Ed25519 -> per-artifact signature)

Per-protocol consumption:
- electron-updater: reads signature + files[].sha512
- Tauri: reads platforms[key].signature (file sig)
- Sparkle: reads sparkle:edSignature (file sig)
- Capacitor: reads signature (bundle sig)
- Squirrel: uses SHA-1 (no Ed25519 support — accept or wrap)
- PWA: no sig needed (HTTPS + content hash)
- AppInstaller: Authenticode (separate X.509, not Ed25519)

### The Tiniest Possible Implementation

1. **One Ed25519 key pair** (generate once, private key in CI secret)
2. **One JSON manifest** in KV (atomic swap on deploy)
3. **One Worker** that:
   - Serves /manifest.json from KV
   - Adapts to latest.yml, RELEASES, appcast.xml, .appinstaller, Tauri JSON
   - Proxies binary downloads from R2
   - Serves sw.js with Cache-Control: no-cache
4. **One R2 bucket** for all binaries
5. **One wrangler deploy** for the Worker itself

**Total new code**: ~200 lines Worker JS + deploy script that:
- Computes SHA-512 of each artifact
- Signs manifest + each artifact with Ed25519
- Uploads artifacts to R2
- Writes manifest to KV
- Runs wrangler deploy

**Answer to the question**: The smallest spec is **Ed25519-signed JSON manifest + per-file SHA-512 + per-file Ed25519 signature**, served by one Worker from R2/KV, with protocol-specific adapters in the Worker.

---

## Appendix: Citation Index

| Protocol | Primary Source URL | Date |
|----------|-------------------|------|
| electron-builder | github.com/electron-userland/electron-builder/blob/master/packages/builder-util-runtime/src/updateInfo.ts | 2026-11-05 |
| Tauri 2.x | v2.tauri.app/plugin/updater/ | 2026-11-05 |
| Capacitor (CapGo) | github.com/Cap-go/live-update-action | 2026-11-05 |
| Squirrel.Windows | github.com/Squirrel/Squirrel.Windows/blob/develop/src/Squirrel/ReleaseEntry.cs | 2026-11-05 |
| Sparkle 2.x | sparkle-project.org/documentation/publishing/ | 2026-11-05 |
| W3C Service Worker | w3c.github.io/ServiceWorker/v1/ | 2026-11-05 |
| MS AppInstaller | learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/schema-root | 2026-11-05 |
| Cloudflare Workers | developers.cloudflare.com/workers/versions-and-deployments/ | 2026-11-05 |
| Cloudflare KV | developers.cloudflare.com/kv/ | 2026-11-05 |
| Cloudflare Rollback | developers.cloudflare.com/workers/versions-and-deployments/rollbacks/ | 2026-11-05 |
| Cloudflare Version URLs | developers.cloudflare.com/workers/versions-and-deployments/version-urls/ | 2026-11-05 |
| HotCodePush | github.com/hotcodepush-team/capacitor-live-updates | 2026-11-05 |

## Appendix: Open Questions / Gaps

1. **latest.yml.gz**: Confirmed does NOT exist. The .gz refers to block map format, not the manifest.
2. **Squirrel SHA-1**: Cryptographically broken. Unified model can add Ed25519 to RELEASES content (Squirrel ignores extra fields).
3. **Capacitor official**: @capacitor/live-update removed from Ionic monorepo. Capawesome repo archived. Active = CapGo or HotCodePush.
4. **AppInstaller sig**: Does NOT sign the .appinstaller XML. Relies on Authenticode of .msix.
5. **PWA**: No manifest. Browser-driven content comparison. No server-side signature.
6. **Tauri 1.x vs 2.x**: 1.x = flat array, 2.x = keyed object. Target 2.x format.
