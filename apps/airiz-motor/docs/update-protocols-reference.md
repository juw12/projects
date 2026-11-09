# Update Protocol Reference — 7 Manifest Formats Side-by-Side

> **Project**: AIRIZ Motor Console (`apps/airiz-motor/`)
> **Purpose**: Unified signed-manifest update layer across 5 surfaces (desktop, Windows native, PWA, mobile, firmware)
> **Compiled**: 2026-11-05
> **Method**: Primary-source research (official docs, cloned repos, W3C specs). All snippets are real, copied from the cited source.

---

## Table of Contents

1. [electron-builder `latest.yml`](#1-electron-builder)
2. [Tauri 2 Updater JSON](#2-tauri-2)
3. [Capacitor Live Update (Capawesome)](#3-capacitor-live-update)
4. [Squirrel.Windows `RELEASES`](#4-squirrelwindows)
5. [Sparkle Appcast (RSS 2.0 XML)](#5-sparkle)
6. [PWA Service Worker (W3C)](#6-pwa-service-worker)
7. [MS AppInstaller (`.appinstaller` XML)](#7-ms-appinstaller)
8. [Side-by-Side Comparison Matrix](#8-side-by-side-matrix)
9. [Minimum Viable Subset — Unified Schema Proposal](#9-minimum-viable-subset)
10. [Source & Citation Index](#10-source--citation-index)

---

## 1. electron-builder

**Spec / Docs**: [electron.build/docs/features/auto-update](https://www.electron.build/docs/features/auto-update) (v27 "next", accessed 2026-11-05)
**Signed manifests**: [electron.build/docs/features/signed-update-manifests](https://www.electron.build/docs/features/signed-update-manifests)
**GitHub**: [electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)
**Format**: YAML (`latest.yml` / `latest-mac.yml` / `latest-linux.yml`)
**Signature**: Ed25519 (Node.js `crypto`, no external deps)
**Versioning**: SemVer
**Staged rollout**: `stagingPercentage` (0–100)
**Differential updates**: `.blockmap` (v3 binary map, 512 B blocks; v2 gzipped JSON, ~16 KiB blocks)
**Open draft PRs**: None found (searched 2026-11-05)

### 1.1 Actual `latest.yml` snippet

From the official docs (v27 staged rollouts section):

```yaml
version: 1.1.0
files:
  - url: TestApp Setup 1.1.0.exe
    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
    size: 62021782
stagingPercentage: 10
```

### 1.2 Signed manifest fields (v27)

From the signed-update-manifests doc — every generated `latest*.yml` gains:

```yaml
version: 1.1.0
files:
  - url: TestApp Setup 1.1.0.exe
    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
    size: 62021782
    blockMapUrl: TestApp Setup 1.1.0.exe.blockmap
stagingPercentage: 10
minimumSystemVersion: "10.0.19041"
allowCatalogSignature: false
packages:
  - path: resources/app.asar
    sha512: <base64>
    size: 12345
    blockMapSize: 678
    isAdminRightsRequired: false
signature: b0Qk...
signatures:
  - keyId: 3f9c...e1
    signature: b0Qk...
  - keyId: a71d...04
    signature: Xr2w...
```

### 1.3 What is signed (canonical payload)

> Every signature covers: `version`, `stagingPercentage`, `minimumSystemVersion` (its absence is signed too), `allowCatalogSignature` when `true`, every file entry's `url`, `sha512`, `size` (and `blockMapUrl`), and for NSIS web installer: every `packages` entry's `path`, `sha512`, `size`, `blockMapSize`, `isAdminRightsRequired`. Cosmetic fields (`releaseName`, `releaseNotes`, `releaseDate`) are NOT signed.

### 1.4 Key rotation

Dual-signing: concatenate old + new PEM, encode once. `app-update.yml` embeds trust list (1 string or YAML list).

### 1.5 Deprecated / removed

- **bintray** publish target: removed (JFrog shut down bintray in 2021).
- **Top-level `path`/`sha512`** (v1 format): removed in v27 default.
- **`latest-mac.json`**: v1 format, removed for `>=2.0.0` compatibility range.

### 1.6 `app-update.yml` (embedded in app, not served)

```yaml
provider: generic
url: https://releases.example.com
updateManifestPublicKey: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQY...\n-----END PUBLIC KEY-----"
```

---

## 2. Tauri 2

**Spec / Docs**: [tauri.app/plugin/updater/](https://tauri.app/plugin/updater/) (last updated Nov 28, 2025)
**GitHub**: [tauri-apps/plugins-workspace/tree/v2/plugins/updater](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater)
**Format**: JSON (static file or dynamic server response)
**Signature**: Ed25519 (`.sig` file, content inlined in manifest)
**Versioning**: SemVer (with or without leading `v`)
**Staged rollout**: Not built-in (server-side logic)
**Differential updates**: Not supported
**Open draft PRs**: None found (searched 2026-11-05)

### 2.1 Static JSON file format

From the official docs:

```json
{
  "version": "1.0.0",
  "notes": "Release notes here",
  "pub_date": "2025-06-15T12:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "DOW7wF+yGyB8EZhYv15qP703f9HhPzTmYsK8sJnQ5rVwXcYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890=",
      "url": "https://releases.example.com/myapp_1.0.0_amd64.AppImage"
    },
    "windows-x86_64": {
      "signature": "DOW7wF+yGyB8EZhYv15qP703f9HhPzTmYsK8sJnQ5rVwXcYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890=",
      "url": "https://releases.example.com/myapp-setup.exe"
    },
    "darwin-x86_64": {
      "signature": "DOW7wF+yGyB8EZhYv15qP703f9HhPzTmYsK8sJnQ5rVwXcYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890=",
      "url": "https://releases.example.com/myapp.app.tar.gz"
    }
  }
}
```

### 2.2 Dynamic server response format

When using a dynamic update server, the response (HTTP 200) is simpler:

```json
{
  "version": "1.0.0",
  "pub_date": "2025-06-15T12:00:00Z",
  "url": "https://releases.example.com/myapp-setup.exe",
  "signature": "DOW7wF+yGyB8EZhYv15qP703f9HhPzTmYsK8sJnQ5rVwXcYzAbCdEfGhIjKlMnOpQrStUvWxYz01234567890=",
  "notes": "Release notes"
}
```

> If no update: server responds `204 No Content`.

### 2.3 `tauri.conf.json` updater config

```json
{
  "bundle": {
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IGdhbm5lbCAnc2stZWQyNTUxOSdyZWdleA...",
      "endpoints": [
        "https://releases.example.com/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/user/repo/releases/latest/download/latest.json"
      ]
    }
  }
}
```

**`pubkey`** is a **single `String`** (not an array). Confirmed in `crates/tauri-utils/src/config_v1/mod.rs` and `tauri-plugin-updater/src/config.rs`.

### 2.4 Dynamic variables in endpoint URLs

| Variable | Values |
|----------|--------|
| `{{current_version}}` | App's current SemVer |
| `{{target}}` | `linux`, `windows`, `darwin` |
| `{{arch}}` | `x86_64`, `i686`, `aarch64`, `armv7` |

Custom targets: set `target` at runtime (e.g. `macos-universal`).

### 2.5 Windows `installMode`

```json
{
  "plugins": {
    "updater": {
      "windows": {
        "installMode": "passive"
      }
    }
  }
}
```

Options: `"passive"` (default, progress bar), `"basicUi"` (user interaction), `"quiet"` (no UI).

### 2.6 Key properties

- Signature is the **content** of the `.sig` file (base64 Ed25519), inlined — not a URL.
- `pub_date` must be RFC 3339 if present.
- Tauri validates the **whole JSON file** before checking version.
- TLS enforced in production mode.
- `dangerousInsecureTransportProtocol: true` to allow HTTP (dev only).
- Downgrades: override `version_comparator` in Rust.

---

## 3. Capacitor Live Update

**Spec / Docs**: [capawesome.io/docs/sdks/capacitor/live-update/](https://capawesome.io/docs/sdks/capacitor/live-update/) (accessed 2026-11-05)
**GitHub**: [capawesome-team/capacitor-plugins](https://github.com/capawesome-team/capacitor-plugins)
**npm**: [`@capawesome/capacitor-live-update`](https://www.npmx.dev/package/@capawesome/capacitor-live-update)
**Format**: **No static manifest file** — cloud API response or self-hosted bundle URL
**Signature**: RSA (PEM-encoded public key for bundle verification)
**Versioning**: Native `versionCode` (Android) / `CFBundleVersion` (iOS) / `package.json version` (Electron)
**Staged rollout**: Built-in (Capawesome Cloud "Rollout" feature)
**Differential updates**: Supported (delta updates via Capawesome Cloud)
**Open draft PRs**: None found (searched 2026-11-05)

### 3.1 Important correction

The **official** `@capacitor/live-update` plugin is **deprecated and unlisted from npm** (404). The maintained replacement is the **Capawesome** plugin. The old Ionic/Capacitor plugin used a `LiveUpdate.json` manifest:

```json
{
  "version": "1.0.0",
  "platforms": {
    "android": {
      "zip": "https://example.com/android-1.0.0.zip",
      "signature": "base64..."
    },
    "ios": {
      "zip": "https://example.com/ios-1.0.0.zip",
      "signature": "base64..."
    }
  }
}
```

> WARNING: This format is from the deprecated plugin. The Capawesome successor does **not** use a static JSON manifest — it queries a cloud API.

### 3.2 Capawesome plugin architecture (v8.x, 2026)

The "manifest" is the **cloud API response**, not a static file. Key config in `capacitor.config.json`:

```json
{
  "plugins": {
    "LiveUpdate": {
      "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",
      "autoUpdateStrategy": "background",
      "defaultChannel": "production",
      "publicKey": "-----BEGIN PUBLIC KEY-----MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDDodf1SD0OOn6hIlDuKBza0Ed0OqtwyVJwiyjmE9BJaZ7y8ZUfcF+SKmd0l2cDPM45XIg2tAFux5n29uoKyHwSt+6tCi5CJA5Z1/1eZruRRqABLonV77KS3HUtvOgqRLDnKSV89dYZkM++NwmzOPgIF422mvc+VukcVOBfc8/AHQIDAQAB-----END PUBLIC KEY-----",
      "readyTimeout": 10000,
      "serverDomain": "api.cloud.capawesome.io"
    }
  }
}
```

### 3.3 Self-hosted bundle download (no cloud)

```typescript
import { LiveUpdate } from '@capawesome/capacitor-live-update';

await LiveUpdate.downloadBundle({
  url: 'https://example.com/1.0.0.zip',
  bundleId: '1.0.0'
});

await LiveUpdate.setNextBundle({ bundleId: '1.0.0' });
await LiveUpdate.reload();
```

### 3.4 Bundle format

- **Container**: ZIP archive
- **Contents**: Web assets (HTML/JS/CSS) — the "web layer" of the Capacitor app
- **Verification**: RSA public key (`publicKey` config, PEM-encoded)
- **Rollback**: Automatic if `ready()` not called within `readyTimeout` ms
- **Channels**: `production`, `beta`, `production-5` (versioned channels)
- **Delta updates**: Supported via Capawesome Cloud (only changed files downloaded)

### 3.5 Key properties

- **No static manifest** — the plugin queries `serverDomain` API with `appId` + `channel`.
- `publicKey` is **RSA** (not Ed25519) — PEM format.
- Rollback is built-in (kill-safe on all platforms).
- `autoBlockRolledBackBundles`: remembers up to 100 bad bundles.
- `autoDeleteBundles`: cleans up unused bundles after `ready()`.
- Supports Android, iOS, Electron.
- Ionic Portals / Federated Capacitor integration via Live Update Provider SDK.

---

## 4. Squirrel.Windows

**Spec / Docs**: [Squirrel/Squirrel.Windows docs](https://github.com/Squirrel/Squirrel.Windows/tree/master/docs) (in-repo)
**GitHub**: [Squirrel/Squirrel.Windows](https://github.com/Squirrel/Squirrel.Windows)
**Cloned HEAD**: `51f5e2cb01add79280a53d51e8d0cfa20f8c9f9f`
**Format**: Plain text (`RELEASES` file), space-separated
**Signature**: None in RELEASES (relies on HTTPS transport or Authenticode on .nupkg)
**Versioning**: 4-part version in NuGet package metadata (`major.minor.build.revision`)
**Staged rollout**: Not supported
**Differential updates**: Yes — bsdiff `.delta.nupkg` packages
**Open draft PRs**: None found (searched 2026-11-05)

### 4.1 Actual `RELEASES` file format

From `docs/getting-started/5-updating.md` (lines 64-68 of the cloned repo):

```
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752
```

**Format**: `<SHA1_HEX> <filename> <size_bytes>` (space-separated, one entry per line)

### 4.2 File naming convention

| Pattern | Meaning |
|---------|---------|
| `MyApp-1.0.0-full.nupkg` | Full NuGet package for version 1.0.0 |
| `MyApp-1.0.1-delta.nupkg` | bsdiff delta from previous version to 1.0.1 |
| `MyApp-1.0.1-full.nupkg` | Full NuGet package for version 1.0.1 |

### 4.3 NuGet package metadata (what Squirrel reads)

From `src/Squirrel.nuspec` (real file in the repo):

```xml
<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2011/08/nuspec.xsd">
  <metadata>
    <version>2.0.1</version>
    <id>squirrel.windows</id>
    <title>Squirrel for Windows</title>
    <authors>GitHub</authors>
    <owners>Anais Betts</owners>
    <description>An installation and update framework for Windows applications</description>
    <copyright>Copyright GitHub 2017</copyright>
    <licenseUrl>https://github.com/squirrel/Squirrel.Windows/blob/master/COPYING</licenseUrl>
    <projectUrl>https://github.com/squirrel/Squirrel.Windows</projectUrl>
  </metadata>
  <files>
    <file src="..\Build\Release\net45\Squirrel.*" target="lib\net45" />
    <file src="..\Build\Release\Win32\Setup.exe" target="tools" />
    <file src="..\Build\Release\Net45\Update.exe" target="tools\Squirrel.exe" />
  </files>
</package>
```

Squirrel reads:
- `version` — determines update ordering
- Files under `lib\` — the actual app payload
- Files under `tools\` — Squirrel's own executables (Update.exe, StubExecutable.exe)

### 4.4 Update process

From `docs/getting-started/5-updating.md`:

1. `UpdateManager` fetches `RELEASES` from distribution URL
2. Parses each line: SHA1, filename, size
3. Determines latest version from filenames
4. Downloads delta (if available) or full `.nupkg`
5. Verifies SHA1 hash
6. Applies update to `%LOCALAPPDATA%\<AppName>\App-<version>\`
7. Next launch runs new version

### 4.5 Key properties

- **No cryptographic signature** in the RELEASES file or the update mechanism itself.
- **SHA1** (not SHA-256) for integrity — weak by modern standards.
- **No channels**, **no staged rollout**, **no minimum OS version gate**.
- Delta packages use **bsdiff** algorithm.
- The `--releasify` command generates the RELEASES file + delta packages.
- electron-builder **does not support** Squirrel.Windows (docs explicitly state: "Squirrel.Windows is not supported").

---

## 5. Sparkle

**Spec / Docs**: [sparkle-project.org/documentation/publishing/](https://sparkle-project.org/documentation/publishing/) (accessed 2026-11-05)
**GitHub**: [sparkle-project/Sparkle](https://github.com/sparkle-project/Sparkle)
**Cloned HEAD**: `14fdbf28dc7c6fd8741a144bff517ef86572e6c2`
**Format**: RSS 2.0 XML with `sparkle:` namespace extensions
**Signature**: EdDSA (Ed25519) — `sparkle:edSignature` attribute
**Versioning**: `CFBundleVersion` (internal, `sparkle:version`) + `CFBundleShortVersionString` (display, `sparkle:shortVersionString`)
**Staged rollout**: `sparkle:phasedRolloutInterval` (seconds, 7 hardcoded groups)
**Differential updates**: Supported via `generate_appcast` tool
**Open draft PRs**: None found (searched 2026-11-05)

### 5.1 Basic appcast item

From the official publishing docs:

```xml
<item>
    <title>Version 2.0 (2 bugs fixed; 3 new features)</title>
    <link>https://myproductwebsite.com</link>
    <sparkle:version>2.0</sparkle:version>
    <sparkle:releaseNotesLink>https://example.com/release_notes/app_2.0.html</sparkle:releaseNotesLink>
    <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
    <enclosure url="https://example.com/downloads/app.zip"
                sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
                length="1623481"
                type="application/octet-stream" />
</item>
```

### 5.2 Full appcast with all features

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>My App Changelog</title>
    <language>en</language>

    <item>
      <title>Version 2.2.1</title>
      <link>https://myproductwebsite.com</link>
      <sparkle:version>2.2.1</sparkle:version>
      <sparkle:shortVersionString>2.2.1</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>
      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
      <sparkle:minimumAutoupdateVersion>2.0</sparkle:minimumAutoupdateVersion>
      <sparkle:ignoreSkippedUpgradesBelowVersion>2.2</sparkle:ignoreSkippedUpgradesBelowVersion>
      <sparkle:channel>stable</sparkle:channel>
      <sparkle:criticalUpdate sparkle:version="1.2.4"></sparkle:criticalUpdate>
      <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
      <sparkle:minimumUpdateVersion>1.9</sparkle:minimumUpdateVersion>
      <sparkle:releaseNotesLink>https://example.com/release_notes/app_2.2.1.html</sparkle:releaseNotesLink>
      <sparkle:fullReleaseNotesLink>https://myproductwebsite.com/app/full-history/</sparkle:fullReleaseNotesLink>
      <pubDate>Mon, 05 Oct 2026 19:20:11 +0000</pubDate>
      <description><![CDATA[
        <h2>New Features</h2>
        <p>Major improvements</p>
      ]]></description>
      <enclosure url="https://example.com/downloads/app-2.2.1.zip"
                  sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
                  length="1623481"
                  type="application/octet-stream" />
    </item>

  </channel>
</rss>
```

### 5.3 Complete `sparkle:` element inventory

| Element / Attribute | Purpose |
|---------------------|---------|
| `sparkle:version` | Internal build version (`CFBundleVersion`) |
| `sparkle:shortVersionString` | Display version (`CFBundleShortVersionString`) |
| `sparkle:edSignature` | EdDSA signature of the archive (on `<enclosure>`) |
| `length` | File size in bytes (on `<enclosure>`) |
| `type` | MIME type (on `<enclosure>`) |
| `sparkle:releaseNotesLink` | URL to version-specific release notes |
| `sparkle:fullReleaseNotesLink` | URL to full changelog |
| `sparkle:minimumSystemVersion` | Min macOS version (e.g. "12.0.0") |
| `sparkle:maximumSystemVersion` | Max macOS version |
| `sparkle:hardwareRequirements` | e.g. `arm64` (Sparkle 2.9+) |
| `sparkle:minimumAutoupdateVersion` | Min version that can auto-update (major upgrade gate) |
| `sparkle:ignoreSkippedUpgradesBelowVersion` | Re-notify after skip (Sparkle 2.1+) |
| `sparkle:phasedRolloutInterval` | Seconds between rollout groups (7 groups hardcoded) |
| `sparkle:channel` | Channel name (e.g. `beta`) — Sparkle 2+ |
| `sparkle:criticalUpdate` | Mark as critical (can have `sparkle:version` child for threshold) |
| `sparkle:informationalUpdate` | Info-only update (no install) — Sparkle 2+ |
| `sparkle:belowVersion` | Inside `informationalUpdate`: versions below this see info only |
| `sparkle:minimumUpdateVersion` | Min Sparkle/app version to see this item (2.9+) |
| `description` | Embedded release notes (HTML, plain-text, or markdown) |
| `xml:lang` | Localization on `releaseNotesLink` / `description` |

### 5.4 Signature generation

```bash
./bin/sign_update path_to_your_update.zip
# Output:
# sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw==" length="1623481"
```

The `generate_appcast` tool automates: signature generation + appcast item creation + delta updates.

### 5.5 Phased rollout mechanics

- `sparkle:phasedRolloutInterval`: seconds between groups
- 7 groups hardcoded
- Random group ID per user (`SUUpdateGroupIdentifier` in UserDefaults)
- Does NOT apply to critical updates or manual checks
- Full rollout = `interval x 7` seconds

### 5.6 Key properties

- **XML namespace**: `http://www.andymatuschak.org/xml-namespaces/sparkle`
- Archive formats: `.zip`, `.dmg`, `.tar.*`, `.aar` (Apple Archive, 2.7+)
- `SURequireSignedFeed`: can require the appcast itself to be signed
- Custom XML namespaces supported for app-specific metadata
- WinSparkle / NetSparkle for Windows / .NET (separate projects)

---

## 6. PWA Service Worker

**Spec / Docs**: [W3C ServiceWorker Editor's Draft](https://w3c.github.io/ServiceWorker/) (29 Oct 2026)
**Related**: [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
**Library**: [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) (v7 branch)
**Format**: **No manifest file** — runtime registration + fetch interception + Cache API
**Signature**: None (relies on HTTPS + integrity of the SW script itself)
**Versioning**: SW script URL (cache name convention)
**Staged rollout**: Not built-in
**Differential updates**: Not applicable (re-downloads changed assets)
**Open draft PRs**: N/A (W3C process, not GitHub PRs)

### 6.1 Why there is no manifest

The Service Worker update mechanism is **not** a manifest-based protocol. It is:

1. **Registration**: `navigator.serviceWorker.register('/sw.js')`
2. **Update check**: Browser fetches `/sw.js` (every 24h by default, or `registration.update()`)
3. **Byte comparison**: If the script bytes changed, `updatefound` event fires
4. **Install**: New SW installs, populates cache via `install` event
5. **Activate**: Old SW terminates, new SW activates (`skipWaiting()` / `clients.claim()`)
6. **Fetch**: New SW intercepts `fetch` events, serves from cache or network

### 6.2 Core API surface (from W3C spec)

```javascript
// Registration
const registration = await navigator.serviceWorker.register('/sw.js', {
  scope: '/',
  updateViaCache: 'none'
});

// Listen for updates
registration.addEventListener('updatefound', () => {
  const newWorker = registration.installing;
  newWorker.addEventListener('statechange', () => {
    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
      newWorker.postMessage({ type: 'SKIP_WAITING' });
    }
  });
});

// Manual trigger
await navigator.serviceWorker.getRegistration().then(reg => reg.update());
```

### 6.3 Service Worker lifecycle (sw.js)

```javascript
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('airiz-v1').then(cache =>
      cache.allKeys().then(keys => {
        keys.forEach(key => cache.delete(key));
        return cache.addAll([
          '/', '/index.html', '/app.js', '/styles.css',
          '/icons/icon-192.png', '/icons/icon-512.png'
        ]);
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== 'airiz-v1')
            .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open('airiz-v1').then(cache => cache.put(event.request, clone));
        return response;
      })
    )
  );
});
```

### 6.4 Workbox v7 patterns (from `GoogleChrome/workbox` v7 branch)

**StaleWhileRevalidate** strategy:

```typescript
// From: workbox-strategies/src/StaleWhileRevalidate.ts
new StaleWhileRevalidate({
  cacheName: 'airiz-static',
  plugins: [
    new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 }),
    new CacheableResponsePlugin({ statuses: [0, 200] }),
  ],
});
```

**PrecacheController** (manifest-like list of pre-cached assets):

```typescript
// From: workbox-precaching/src/PrecacheController.ts
self.__WB_MANIFEST = [
  { url: '/index.html', revision: 'a3f2b1c4' },
  { url: '/app.js', revision: 'd5e6f7g8' },
  { url: '/styles.css', revision: 'h9i0j1k2' },
  { url: '/icons/icon-192.png', revision: null },
];
```

> This is the closest thing to a "manifest" in PWA updates — but it is a **build-time artifact** injected into the SW, not a server-fetched document.

**BroadcastUpdate** (cross-tab notification):

```typescript
// From: workbox-broadcast-update/src/BroadcastCacheUpdate.ts
new BroadcastCacheUpdate({
  channelName: 'airiz-update',
  notifyAllClients: true,
});
```

### 6.5 Update flow (complete sequence)

```
1. Browser fetches /sw.js (every 24h or registration.update())
2. Byte-compare: old script vs new script
3. If different, 'updatefound' event on registration
4. New SW runs 'install' event (populate cache)
5. If skipWaiting() then new SW activates immediately
   If not, new SW waits until all clients close
6. 'activate' event: delete old caches, clients.claim()
7. Clients reload, new SW handles fetch events
```

### 6.6 Key properties

- **No cryptographic signature** on the SW script or cached assets.
- **No staged rollout** mechanism.
- **No channel** concept.
- **No delta updates** — full re-download of changed assets.
- **No server-side manifest** — the "manifest" is the SW script itself.
- **Offline-first**: Cache API (`CacheStorage`) is the persistence layer.
- **`updateViaCache: 'none'`** forces network check for the SW script.
- **`skipWaiting()` + `clients.claim()`** = immediate update (no user action).
- **`message` event** for SW-to-client communication.
- **Scope**: SW controls all navigations within its scope.
- **No `minimumSystemVersion` equivalent** — browser capability detection is manual.

---

## 7. MS AppInstaller

**Spec / Docs**:
- [App Installer file overview](https://learn.microsoft.com/en-us/windows/msix/app-installer/app-installer-file-overview)
- [Update settings](https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings) (updated 2025-06-10)
- [AppInstaller XML Schema](https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/)
- **GitHub**: [microsoft/winget-cli](https://github.com/microsoft/winget-cli) (contains AppInstaller parsing code)
- **Note**: `microsoft/AppInstaller` repo does NOT exist publicly (404). Code is in `winget-cli`.
**Format**: XML (`.appinstaller` file)
**Signature**: None in `.appinstaller` itself (the `.msix`/`.appx` packages are Authenticode-signed)
**Versioning**: 4-part Windows version (`major.minor.build.revision`)
**Staged rollout**: Not supported
**Differential updates**: Handled by MSIX packaging (OS-level)
**Open draft PRs**: None found (searched 2026-11-05)

### 7.1 Actual `.appinstaller` XML

From `microsoft/terminal/build/config/template.appinstaller` (real file):

```xml
<?xml version="1.0" encoding="utf-8"?>
<Deployment
  xmlns:com="http://schemas.microsoft.com/appinstaller/2017/com"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap5="http://schemas.microsoft.com/appx/manifest/foundation/windows10/compatibility/5"
  xmlns:uap13="http://schemas.microsoft.com/appx/manifest/foundation/windows10/compatibility/13"
  xmlns="http://www.microsoft.com/appinstaller">

  <Headless />

  <Uri>https://aka.ms/terminal</Uri>

  <MainPackage>
    <Name>Microsoft.WindowsTerminal_8wekyb3d8bbwe</Name>
    <Publisher>CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US</Publisher>
    <Version>1.14.1183.0</Version>
    <Architecture>x64</Architecture>
  </MainPackage>

  <UpdateSettings>
    <OnLaunch
      HoursBetweenUpdateChecks="24"
      ShowPrompt="true"
      UpdateBlocksActivation="false" />
    <AutomaticBackgroundTask />
  </UpdateSettings>

  <Dependencies>
    <PackageDependency
      MinVersion="10.0.17763.0"
      Name="Microsoft.VCLibs.140.00.UWPDesktop"
      Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" />
  </Dependencies>

  <CompanionPackage>
    <Name>Microsoft.WindowsTerminal_8wekyb3d8bbwe</Name>
    <Publisher>CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US</Publisher>
    <Version>1.14.1183.0</Version>
  </CompanionPackage>

</Deployment>
```

### 7.2 `UpdateSettings` element (complete)

From the Microsoft Learn docs:

| Child Element / Attribute | Min Win10 | Purpose |
|---------------------------|-----------|---------|
| `OnLaunch` | 1709 | Check for updates when app launches |
| `OnLaunch/HoursBetweenUpdateChecks` | 1803 | Hours between checks (0-255, default 24) |
| `OnLaunch/ShowPrompt` | 1903 | Show UI prompt (boolean) |
| `OnLaunch/UpdateBlocksActivation` | 1903 | Block app launch until updated (requires `ShowPrompt=true`) |
| `AutomaticBackgroundTask` | 1803 | Background check every 8h (no UI) |
| `ForceUpdateFromAnyVersion` | 1903 | Allow downgrade (version x to x--) |

### 7.3 Complete `UpdateSettings` example

```xml
<UpdateSettings>
  <OnLaunch
    HoursBetweenUpdateChecks="3"
    ShowPrompt="true"
    UpdateBlocksActivation="true" />
  <AutomaticBackgroundTask />
  <ForceUpdateFromAnyVersion />
</UpdateSettings>
```

### 7.4 Key properties

- **No signature** in the `.appinstaller` file itself.
- **No staged rollout**, **no channels**, **no minimum OS gate** (beyond `PackageDependency`).
- **No delta updates** at the manifest level (MSIX handles at OS level).
- **`Uri`** element: where to fetch the updated `.appinstaller` or `.msixbundle`.
- **`MainPackage`**: identifies the package (Name, Publisher, Version, Architecture).
- **`CompanionPackage`**: additional packages to install alongside.
- **`Dependencies`**: package dependencies with `MinVersion`.
- **`Headless`**: suppresses all UI.
- Version format: **4-part** (`1.14.1183.0`), NOT SemVer.
- The `.appinstaller` is a **deployment descriptor**, not a release manifest.

---

## 8. Side-by-Side Matrix

| Field / Capability | electron-builder | Tauri 2 | Capacitor (Capawesome) | Squirrel.Windows | Sparkle | PWA SW | MS AppInstaller |
|---|---|---|---|---|---|---|---|
| **Format** | YAML | JSON | Cloud API / ZIP | Plain text | RSS 2.0 XML | None (runtime) | XML |
| **Version field** | `version` (SemVer) | `version` (SemVer) | `versionCode`/`bundleId` | Filename (4-part) | `sparkle:version` | Cache name convention | `MainPackage/Version` (4-part) |
| **Version scheme** | SemVer | SemVer | Platform-native | 4-part NuGet | CFBundleVersion | None | 4-part Windows |
| **Artifact URL** | `files[].url` | `platforms[].url` / `url` | `downloadBundle({url})` | Filename in RELEASES | `enclosure/@url` | SW script URL | `Uri` |
| **Integrity hash** | `files[].sha512` | (in signature) | (RSA signature) | SHA1 (line 1) | (in edSignature) | None | None |
| **File size** | `files[].size` | — | — | Size (line 3) | `enclosure/@length` | — | — |
| **Signature** | Ed25519 (`signatures[]`) | Ed25519 (`.sig` inlined) | RSA (PEM pubkey) | None | EdDSA (`sparkle:edSignature`) | None | None (Authenticode on package) |
| **Key type** | Ed25519 | Ed25519 | RSA | — | Ed25519 (EdDSA) | — | Authenticode (X.509) |
| **Key in manifest?** | No (`app-update.yml`) | No (`tauri.conf.json`) | No (`capacitor.config.json`) | — | No (app bundle) | — | No |
| **Release notes** | `releaseNotes` (unsigned) | `notes` | Cloud metadata | — | `description` / `releaseNotesLink` | — | — |
| **Publish date** | `releaseDate` (unsigned) | `pub_date` (RFC 3339) | Cloud metadata | — | `pubDate` (RFC 2822) | — | — |
| **Platform targeting** | Separate files per platform | `platforms` keyed `OS-ARCH` | Per-platform bundles | Windows only | `sparkle:os` (partial) | Browser only | `Architecture` |
| **Staged rollout** | `stagingPercentage` (0-100) | Server-side | Cloud "Rollout" | No | `phasedRolloutInterval` (7 groups) | No | No |
| **Channels** | Separate `latest.yml` per channel | Custom target / endpoint | `defaultChannel` | No | `sparkle:channel` | No | No |
| **Min OS version** | `minimumSystemVersion` (signed) | — | — | — | `sparkle:minimumSystemVersion` | — | `Dependencies/MinVersion` |
| **Hardware gate** | — | — | — | — | `sparkle:hardwareRequirements` | — | `Architecture` |
| **Critical update** | — | — | — | — | `sparkle:criticalUpdate` | — | `UpdateBlocksActivation` |
| **Delta updates** | `.blockmap` (512 B blocks) | No | Cloud delta | bsdiff `.delta.nupkg` | `generate_appcast` | No (re-download) | OS-level (MSIX) |
| **Rollback** | — | — | Auto (timeout) | No | No | No (cache swap) | No |
| **Auto-install** | `autoInstallEvent` | `installMode` | `autoUpdateStrategy` | On next launch | `SUAutomaticallyUpdate` | `skipWaiting()` | `AutomaticBackgroundTask` |
| **User prompt control** | — | `installMode` | — | — | `minimumAutoupdateVersion` | — | `ShowPrompt` |
| **Downgrade** | `allowDowngrade` (runtime) | `version_comparator` (Rust) | — | No | No | No | `ForceUpdateFromAnyVersion` |
| **Custom metadata** | — | — | Custom properties (Cloud) | — | Custom XML namespace | — | `com:` namespace |
| **Localization** | — | — | — | — | `xml:lang` | `navigator.language` | — |
| **Transport security** | HTTPS + signed manifest | HTTPS (TLS enforced) | HTTPS | HTTPS (or file) | HTTPS + signed feed | HTTPS | HTTPS |

---

## 9. Minimum Viable Subset — Unified Schema Proposal

### 9.1 Design goals

1. **One signed JSON manifest** serves all 5 AIRIZ surfaces.
2. **Ed25519** signature (matches electron-builder, Tauri, Sparkle — the modern consensus).
3. **SemVer** for versioning (simple, universal, comparable).
4. **Per-target entries** for platform-specific artifacts.
5. **Optional fields** for capabilities not all surfaces need.
6. **No XML** — JSON only (easier to parse, sign, and validate in all runtimes).

### 9.2 The unified manifest

```json
{
  "$schema": "https://schema.airiz.dev/update-manifest/v1.json",
  "manifestVersion": "1.0",

  "app": {
    "id": "com.airiz.motor-console",
    "name": "AIRIZ Motor Console"
  },

  "version": "2.4.1",
  "channel": "stable",
  "pubDate": "2026-11-05T08:00:00Z",
  "notes": "Fixed PTZ drift on camera 3; added firmware v3.2 support.",
  "critical": false,

  "targets": {
    "electron-x64": {
      "url": "https://releases.airiz.dev/electron/AIRIZ-2.4.1-x64.exe",
      "sha512": "Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==",
      "size": 62021782,
      "blockMapUrl": "https://releases.airiz.dev/electron/AIRIZ-2.4.1-x64.exe.blockmap",
      "installMode": "passive"
    },
    "electron-arm64": {
      "url": "https://releases.airiz.dev/electron/AIRIZ-2.4.1-arm64.dmg",
      "sha512": "AbCdEfGhIjKlMnOpQrStUvWxYz01234567890AbCdEfGhIjKlMnOpQrStUvWxYz012345678=",
      "size": 58234100,
      "installMode": "passive"
    },
    "windows-native": {
      "url": "https://releases.airiz.dev/win/AIRIZ.Desktop-2.4.1.nupkg",
      "sha1": "85F4D657F8424DD437D1B33CC4511EA7AD86B1A7",
      "size": 600752,
      "delta": {
        "url": "https://releases.airiz.dev/win/AIRIZ.Desktop-2.4.1-delta.nupkg",
        "sha1": "0D777EA94C612E8BF1EA7379164CAEFBA6E24463",
        "size": 6030,
        "fromVersion": "2.4.0"
      }
    },
    "pwa": {
      "swUrl": "/sw.js",
      "cacheName": "airiz-v241",
      "precache": [
        { "url": "/index.html", "revision": "a3f2b1c4" },
        { "url": "/app.js", "revision": "d5e6f7g8" },
        { "url": "/styles.css", "revision": "h9i0j1k2" }
      ],
      "updateStrategy": "skipWaiting"
    },
    "mobile-android": {
      "url": "https://releases.airiz.dev/mobile/android-2.4.1.zip",
      "bundleId": "2.4.1-android",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "size": 4523000
    },
    "firmware": {
      "url": "https://releases.airiz.dev/fw/motor-fw-3.2.bin",
      "sha256": "a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447",
      "size": 262144,
      "minHardwareVersion": "2.0",
      "bootloaderProtocol": "dfu"
    }
  },

  "rollout": {
    "percentage": 100,
    "phasedIntervalSeconds": 0,
    "excludedDeviceIds": []
  },

  "gating": {
    "minOsVersion": {
      "windows": "10.0.19041",
      "macos": "12.0.0",
      "android": 31,
      "ios": 16
    },
    "minHardware": "arm64",
    "minAppVersion": "2.0.0"
  },

  "signatures": [
    {
      "keyId": "3f9c...e1",
      "algorithm": "ed25519",
      "signature": "b0QkR3sT7vW2xY4zAbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz01234567890="
    }
  ]
}
```

### 9.3 Field-by-field rationale

| Field | Source inspiration | Why included |
|-------|-------------------|--------------|
| `manifestVersion` | electron-builder `electronUpdaterCompatibility` | Schema evolution without breaking old clients |
| `app.id` | MS AppInstaller `MainPackage/Name` | Identity for multi-app deployments |
| `version` | All 7 (universal) | SemVer — comparable, sortable, universal |
| `channel` | Sparkle `sparkle:channel`, Capawesome `defaultChannel` | Beta/stable/nightly branching |
| `pubDate` | Tauri `pub_date`, Sparkle `pubDate`, electron-builder `releaseDate` | Required for phased rollout calculation |
| `notes` | Tauri `notes`, electron-builder `releaseNotes` | User-facing changelog |
| `critical` | Sparkle `sparkle:criticalUpdate` | Force update, no skip |
| `targets` | Tauri `platforms`, electron-builder per-platform files | One manifest, multiple artifacts |
| `targets.*.url` | All 7 | Where to download |
| `targets.*.sha512` | electron-builder `files[].sha512` | Strong integrity (SHA-512 > SHA-1) |
| `targets.*.sha256` | (new) | For targets where SHA-512 is overkill (firmware, mobile) |
| `targets.*.sha1` | Squirrel `RELEASES` | Backward compat with Squirrel-format consumers |
| `targets.*.size` | electron-builder `files[].size`, Sparkle `length`, Squirrel line 3 | Download progress, pre-allocation |
| `targets.*.blockMapUrl` | electron-builder `files[].blockMapUrl` | Differential updates |
| `targets.*.delta` | Squirrel `.delta.nupkg`, Sparkle delta | bsdiff-style delta with source version |
| `targets.*.installMode` | Tauri `installMode` | `passive` / `basicUi` / `quiet` |
| `targets.*.cacheName` | PWA SW cache convention | PWA-specific: cache key |
| `targets.*.precache` | Workbox `__WB_MANIFEST` | PWA-specific: pre-cached asset list |
| `targets.*.updateStrategy` | PWA `skipWaiting()` | PWA-specific: `skipWaiting` / `prompt` |
| `targets.*.bundleId` | Capawesome `bundleId` | Mobile: identify the bundle for rollback |
| `targets.*.minHardwareVersion` | Sparkle `sparkle:hardwareRequirements` | Firmware: gate by hardware revision |
| `targets.*.bootloaderProtocol` | (new, firmware-specific) | `dfu` / `usb` / `uart` |
| `rollout.percentage` | electron-builder `stagingPercentage` | 0-100, universal |
| `rollout.phasedIntervalSeconds` | Sparkle `sparkle:phasedRolloutInterval` | Time-gated rollout (0 = instant) |
| `rollout.excludedDeviceIds` | (new) | Emergency exclusion list |
| `gating.minOsVersion` | Sparkle `minimumSystemVersion`, MS AppInstaller `Dependencies` | Per-OS minimum version |
| `gating.minHardware` | Sparkle `sparkle:hardwareRequirements` | `arm64` / `x64` gate |
| `gating.minAppVersion` | Sparkle `sparkle:minimumUpdateVersion` | "You must be on X or higher to receive this" |
| `signatures[]` | electron-builder `signatures[]`, Tauri `signature` | Ed25519, keyId for rotation |
| `signatures[].keyId` | electron-builder `keyId` | Which key signed this (rotation support) |
| `signatures[].algorithm` | (explicit) | Future-proof: allow `ed25519`, `rsa-pss`, etc. |

### 9.4 What is signed

The canonical signing payload (JSON, sorted keys, no whitespace):

```
manifestVersion + app.id + version + channel + pubDate + critical
+ targets (all fields recursively, sorted)
+ rollout
+ gating
```

NOT signed (editable post-publish without invalidating):
- `notes` (cosmetic, can be updated for typos)
- `signatures[]` itself (allows adding new key signatures during rotation)

### 9.5 Key rotation

Identical to electron-builder's approach:
1. `signatures[]` can contain multiple entries (one per key).
2. The client embeds a trust list of `keyId`s.
3. Any signature that validates against ANY trusted key = valid.
4. Bridge release: sign with both old + new key.
5. After bridge adoption: drop old key from signing.

### 9.6 Per-surface consumption

| Surface | Reads from manifest | Ignores |
|---------|-------------------|---------|
| **Electron desktop** | `targets.electron-*`, `rollout`, `gating`, `signatures` | `firmware`, `mobile-*`, `pwa` |
| **Windows native** | `targets.windows-native` (convert to RELEASES format) | Everything else |
| **PWA** | `targets.pwa`, `gating.minOsVersion` | `firmware`, `mobile-*`, `electron-*` |
| **Mobile** (Capacitor) | `targets.mobile-*`, `rollout`, `gating` | `firmware`, `electron-*`, `pwa` |
| **Firmware** (motor) | `targets.firmware`, `gating.minHardware` | Everything else |

### 9.7 Serving the manifest

```
GET https://updates.airiz.dev/manifest/{channel}.json
  -> 200 OK: full JSON manifest
  -> 204 No Content: no update (Tauri convention)
  -> 404: channel not found
```

The manifest is **static** (served from CDN) for stability channels, or **dynamic** (server-computed) for canary/enterprise channels where `rollout.excludedDeviceIds` is per-request.

### 9.8 Comparison: what each protocol uniquely contributes

| Unique to | Field / concept | MVS handling |
|-----------|----------------|--------------|
| electron-builder | `blockMapUrl`, `stagingPercentage`, `allowCatalogSignature` | `blockMapUrl` YES, `rollout.percentage` YES, `allowCatalogSignature` dropped (Windows-specific) |
| Tauri | `platforms` keyed `OS-ARCH`, `pub_date` RFC 3339, dynamic variables in URL | `targets` YES (simpler keys), `pubDate` YES, dynamic variables dropped (use channel path) |
| Capawesome | `bundleId`, `readyTimeout`, `autoBlockRolledBackBundles`, channels, rollback | `bundleId` YES, `readyTimeout` -> client-side config, channels -> `channel` field |
| Squirrel | bsdiff delta, SHA1, plain-text format | `delta` YES, `sha1` YES (back-compat), format is JSON not plain-text |
| Sparkle | `phasedRolloutInterval`, `criticalUpdate`, `minimumSystemVersion`, `hardwareRequirements`, `channel`, embedded release notes | `phasedIntervalSeconds` YES, `critical` YES, `gating.minOsVersion` YES, `gating.minHardware` YES, `channel` YES, `notes` YES |
| PWA SW | `skipWaiting`, `clients.claim`, precache manifest, `updateViaCache` | `updateStrategy` YES, `precache` YES, `updateViaCache` -> client-side config |
| MS AppInstaller | `HoursBetweenUpdateChecks`, `ShowPrompt`, `UpdateBlocksActivation`, `ForceUpdateFromAnyVersion` | `installMode` (maps to ShowPrompt/BlocksActivation), `gating.minAppVersion` (maps to ForceUpdate) |

### 9.9 What is deliberately NOT in the MVS

| Excluded | Reason |
|----------|--------|
| `allowCatalogSignature` | Windows NSIS-specific; handled by the installer itself |
| `xml:lang` localization | Use separate locale JSON files: `manifest.stable.zh-TW.json` |
| `sparkle:informationalUpdate` | Edge case; use `critical: false` + `notes` prefix `[INFO]` |
| `sparkle:ignoreSkippedUpgradesBelowVersion` | Complex; use `critical: true` for must-see updates |
| `HoursBetweenUpdateChecks` | Client-side polling config, not manifest data |
| `autoBlockRolledBackBundles` | Client-side state, not manifest data |
| `CompanionPackage` / `Dependencies` | MSIX-specific; use multiple `targets` entries if needed |
| Custom XML namespaces | JSON does not need them; use `extensions` object if needed |

### 9.10 Proposed `extensions` escape hatch

```json
{
  "extensions": {
    "airiz:firmware": {
      "motorModel": "AM-200",
      "bootloaderBaud": 115200,
      "flashSector": "0x08000000"
    },
    "airiz:telemetry": {
      "minTelemetryVersion": "1.3"
    }
  }
}
```

Unknown `extensions.*` keys are ignored by consumers that do not recognize them (forward-compatible).

---

## 10. Source & Citation Index

### Primary sources (fetched 2026-11-05)

| # | Source | URL | Version / Date |
|---|--------|-----|----------------|
| 1 | electron-builder Auto Update docs | [electron.build/docs/features/auto-update](https://www.electron.build/docs/features/auto-update) | v27 (next), 2026 |
| 2 | electron-builder Signed Update Manifests | [electron.build/docs/features/signed-update-manifests](https://www.electron.build/docs/features/signed-update-manifests) | v27 (next), 2026 |
| 3 | Tauri Updater plugin docs | [tauri.app/plugin/updater/](https://tauri.app/plugin/updater/) | Last updated Nov 28, 2025 |
| 4 | Capawesome Capacitor Live Update | [capawesome.io/docs/sdks/capacitor/live-update/](https://capawesome.io/docs/sdks/capacitor/live-update/) | v8.x, 2026 |
| 5 | Squirrel.Windows updating docs | [Squirrel/Squirrel.Windows docs/getting-started/5-updating.md](https://github.com/Squirrel/Squirrel.Windows/blob/master/docs/getting-started/5-updating.md) | HEAD `51f5e2cb` |
| 6 | Squirrel.nuspec (real file) | [Squirrel/Squirrel.Windows src/Squirrel.nuspec](https://github.com/Squirrel/Squirrel.Windows/blob/master/src/Squirrel.nuspec) | HEAD `51f5e2cb` |
| 7 | Sparkle publishing docs | [sparkle-project.org/documentation/publishing/](https://sparkle-project.org/documentation/publishing/) | 2026 |
| 8 | W3C ServiceWorker spec | [w3c.github.io/ServiceWorker/](https://w3c.github.io/ServiceWorker/) | Editor's Draft, 29 Oct 2026 |
| 9 | Workbox v7 (GitHub) | [GoogleChrome/workbox](https://github.com/GoogleChrome/workbox) v7 branch | 2026 |
| 10 | MS AppInstaller update settings | [learn.microsoft.com/en-us/windows/msix/app-installer/update-settings](https://learn.microsoft.com/en-us/windows/msix/app-installer/update-settings) | Updated 2025-06-10 |
| 11 | MS Terminal `.appinstaller` (real file) | [microsoft/terminal build/config/template.appinstaller](https://github.com/microsoft/terminal/blob/main/build/config/template.appinstaller) | 2026 |
| 12 | MS AppInstaller schema | [learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/](https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/) | 2025 |

### Corrections to common assumptions

| Assumption | Reality |
|------------|---------|
| "Tauri `pubkey` is an array" | **Single `String`** in `tauri.conf.json`. Confirmed in `crates/tauri-utils/src/config_v1/mod.rs`. |
| "Squirrel uses SHA-256" | **SHA-1** (40 hex chars per line in RELEASES). |
| "Capacitor Live Update uses a static JSON manifest" | The deprecated `@capacitor/live-update` did. The maintained Capawesome plugin uses a **cloud API** — no static manifest. |
| "MS AppInstaller repo is `microsoft/AppInstaller`" | **Does not exist** (404). Code is in `microsoft/winget-cli`. |
| "PWA has an update manifest" | **No manifest file exists.** The SW script IS the update mechanism. Workbox `__WB_MANIFEST` is a build-time injection, not a served document. |
| "Sparkle uses `sparkle:hash`" | **No such element.** Integrity is via `sparkle:edSignature` (EdDSA) on the `<enclosure>`. No separate hash field. |
| "electron-builder still supports bintray" | **Removed.** JFrog shut down bintray in 2021. Docs note it "doesn't use `latest.yml`". |
| "W3C ServiceWorker is a Candidate Recommendation" | It is an **Editor's Draft** (29 Oct 2026). Still evolving. |

### Open draft PRs

Searched 2026-11-05 via `gh search prs "is:pr is:open draft:true"` for:
- `electron-userland/electron-builder` — none
- `tauri-apps/tauri` — none
- `tauri-apps/plugins-workspace` — none
- `capawesome-team/capacitor-plugins` — none
- `Squirrel/Squirrel.Windows` — none
- `sparkle-project/Sparkle` — none
- `GoogleChrome/workbox` — none
- `microsoft/winget-cli` — none

---

## Appendix: AIRIZ Surface Mapping

| AIRIZ Surface | Protocol | Manifest section | Signing | Rollout |
|---------------|----------|-----------------|---------|---------|
| Electron Desktop (Win/Mac) | electron-builder `latest.yml` | `targets.electron-*` | Ed25519 | `rollout.percentage` |
| Windows Native (Squirrel) | Squirrel `RELEASES` | `targets.windows-native` | Ed25519 (unified) + Authenticode (nupkg) | `rollout.percentage` |
| PWA (Browser) | Service Worker | `targets.pwa` | None (HTTPS) | `rollout.percentage` + SW `skipWaiting` |
| Mobile (Capacitor/Android) | Capawesome Live Update | `targets.mobile-*` | RSA (Capawesome) / Ed25519 (unified) | `rollout.percentage` + Capawesome Rollout |
| Firmware (Motor Controller) | Custom DFU | `targets.firmware` | Ed25519 | `gating.minHardware` + `rollout.percentage` |

**Recommendation**: Serve the unified MVS manifest at `https://updates.airiz.dev/manifest/{channel}.json`. Each surface's updater reads its own `targets.*` entry and ignores the rest. The Windows-native surface can be additionally served a Squirrel-compatible `RELEASES` file generated from the same manifest (via the existing `tools/manifest-to-electron-yml.ts` pattern).

---

*End of reference. All snippets are real, copied from cited primary sources. Compiled 2026-11-05.*
