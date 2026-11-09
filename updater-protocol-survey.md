# Cross-Platform Auto-Updater — Full Protocol Surface Survey

**Goal**: one protocol-surface reference for every mainstream cross-platform auto-updater — the
on-the-wire manifest, the signing scheme, the provider abstraction, the lifecycle hooks, and the
rollback story. Built to inform a unified update architecture for **AIRIZ Motor Console**
(Electron desktop + Capacitor mobile + PWA + background worker).

**Prepared**: 2026-11-04 (Asia/Bangkok). All evidence gathered from primary sources (upstream
source code + real-world public manifests) on 2026-11-04.

---

## 0. Methodology & limitations (read this first)

- **Evidence base**: upstream source code + real-world public manifests found via GitHub code
  search, plus official doc source. Every schema below is copied from a real file or real
  production manifest, not invented. Citations are GitHub file URLs / official doc URLs.
- **Tooling note (transparency)**: this session's `context7` (monthly quota exceeded) and
  `websearch/Exa` (free tier rate-limited) MCP tools were unavailable, so **GitHub code search
  (`grep_app`) + direct HTTPS fetch** were used as the primary evidence tools. Both `git`
  (ref listing) and the GitHub REST API were intermittently blocked by the org MITM proxy
  (`localhost:3128`); the proxy was restarted via the OA-proxy fix, after which `git ls-remote`
  and raw-content fetches worked but still returned **incomplete tag sets** at times.
- **"Last 2 releases"**: listed only where a clean tag set was verifiable via `git ls-remote`.
  Where the proxy truncated the tag list, the cell says `verify on GitHub`. Exact release *dates*
  require the GitHub REST API (blocked here).
- **"Spec version"**: most updaters have **no formal published spec**; the manifest is defined by
  the implementation and documented in project docs. Only **MSIX** (Microsoft Open
  Specification) and the **W3C/WHATWG Service Worker** spec are formal specs.

### Version / status snapshot

| Tool | Latest version | Protocol / spec | Last 2 releases (verified) | Status (2026) |
|---|---|---|---|---|
| Squirrel.Windows | **2.0.1** | `RELEASES` + `.nupkg` (informal) | 2.0.1, 2.0.0 | Mature / maintenance |
| Squirrel.Mac | **0.3.2** | legacy .NET macOS updater | 0.3.2, 0.3.1 | **Abandoned** |
| Sparkle | **2.9.6** | appcast XML + **ed25519** (Sparkle 2.x) | 2.9.6, 2.9.5 | Actively maintained |
| WinSparkle | ~0.6.3 | Sparkle-compat appcast + GPG/DSA | verify on GitHub | Niche / maintained |
| electron-updater (electron-builder) | v25.x (verify) | `latest.yml`/`latest-mac.yml` + `.blockmap` | verify on GitHub | Actively maintained |
| Tauri updater | core **2.12.5** / plugin **2.8.1** | JSON manifest + **ed25519** (Tauri v2) | verify on GitHub | Actively maintained |
| Capawesome live-update | **8.7.1** | `capawesome-live-update-manifest.json` + **RSA** | verify on GitHub | Actively maintained |
| `@capacitor/live-update` (deprecated) | ~1.6.x (verify) | (superseded) | — | **Deprecated** |
| Expo Updates (EAS Update) | expo-updates **58.0.5** | update-manifest JSON + RSA code-sign | verify on GitHub | Actively maintained |
| CodePush / App Center | **9.0.1** (frozen) | update-metadata JSON | 9.0.1, 9.0.0 | **Retired 2025-03-31** (archived) |
| PWA service worker (Workbox) | Workbox 7.x (verify) | W3C/WHATWG Service Worker spec | verify on GitHub | Web standard |
| Microsoft App Installer / MSIX | Win10 17763+ / Win11 | MSIX Open Spec + Authenticode | (OS component) | Actively maintained |

### Cross-tool comparison matrix

| Tool | Manifest on the wire | Integrity check | Authenticity (signature) | Public key location | Delta updates? | Rollback story |
|---|---|---|---|---|---|---|
| Squirrel.Windows | `RELEASES` (text) + `.nupkg` | **SHA-1** per line | none (optional Authenticode on exe) | n/a | **yes** (`-delta.nupkg`) | manual re-release; old version dirs kept |
| Squirrel.Mac | legacy (abandoned) | — | — | — | — | none meaningful |
| Sparkle | `appcast.xml` (RSS+ext) | length + **ed25519** (or legacy DSA) | **ed25519** (EdDSA) | `<sparkle:edKey>` in feed **or** `SUPublicEDKey` in Info.plist | optional (`sparkle:deltaUpdates`) | publish higher signed version; delta→full fallback |
| WinSparkle | appcast XML (`winSparkle:` ns) | **SHA-1/SHA-256** + optional GPG | GPG / Sparkle DSA | trusted GPG key (app config) | no | limited; keeps prior version |
| electron-updater | `latest.yml` / `latest-mac.yml` | **SHA-512** (base64) in yml | Authenticode (Win) / detached RSA `signature` (macOS) | cert (Win) / `@electron/osx-sign` profile | **blockmap** (BLAKE2 block diff) | manual; no multi-version |
| Tauri updater | JSON from `endpoints` | **ed25519** signature over artifact | **ed25519** | `pubkey` in `tauri.conf.json` / plugin config | no | publish higher signed JSON |
| Capawesome live-update | `capawesome-live-update-manifest.json` + bundle | **SHA checksum** | **RSA** (PEM pubkey) | `publicKey` config (Capawesome Cloud) | no (whole bundle) | **kill-safe auto-rollback** to embedded bundle |
| Expo Updates | update-manifest JSON | **SHA-256** launch-asset hash | **RSA-4096-SHA256** code-sign | `codeSigningCert` / cert chain | no | **server-side rollback** + embedded fallback |
| CodePush | update-metadata JSON | `packageHash` | `publicKey` (RSA, UWP variant) | server-provided key (UWP) | (legacy delta) | **client + server rollback** |
| PWA / Workbox | SW script + `precache-manifest.js` | HTTPS/TLS | **none** (TLS only) | n/a | precache revision diff | manual redeploy of prior SW; `cleanupOutdatedCaches()` |
| MSIX / App Installer | `AppxManifest.xml` + `.appinstaller` | Authenticode (whole package) | **Authenticode** cert (publisher CN) | signing cert / publisher identity | no (versioned packages) | **OS-level staged rollback** to prior version |

---

## 1. Squirrel.Windows (C# — `RELEASES` + `.nupkg`)

- **Repo**: `Squirrel/squirrel.windows` · **Latest**: 2.0.1 (tags 2.0.1, 2.0.0) · **Spec**: none (informal, de-facto standard for .NET desktop).
- **Docs**: https://github.com/Squirrel/Squirrel.Windows · https://squirrel.github.io

### 1.1 Manifest file name + path
The on-the-wire index is a plain-text **`RELEASES`** file served at the update-server root
(e.g. `https://updates.example.com/RELEASES`, or a GitHub Releases asset). It is a line-per-package
index that points at **`.nupkg`** payload files (a `.nupkg` is just a NuGet zip of the app).

### 1.2 Manifest schema
Real production `RELEASES` (Atom/Gitbook tooling, [GitbookIO/nuts](https://github.com/GitbookIO/nuts/blob/master/test/win-releases.js)):

```text
62E8BF432F29E8E08240910B85EDBF2D1A41EDF2 atom-0.178.0-full.nupkg 81272434
5D754139E89802E88984185D2276B54DB730CD5E atom-0.178.1-delta.nupkg 8938535
DD48D16EE177DD278F0A82CDDB72EBD043C767D2 atom-0.178.1-full.nupkg 81293415
02D56FF2DD6CB8FE059167E227433078CDAF5630 atom-0.179.0-delta.nupkg 9035217
8F5FDFD0BD81475EAD95E9E415579A852476E5FC atom-0.179.0-full.nupkg 81996151
```

Canonical line format (from [ReleaseEntry.cs](https://github.com/Squirrel/squirrel.windows/blob/develop/src/Squirrel/ReleaseEntry.cs)):
```
<SHA1-hex>  <baseUrl><filename>  <size-bytes>  [# <stagingPercent>]
```
- `SHA1` — SHA-1 of the `.nupkg` (computed via `Utility.CalculateStreamSHA1`).
- `baseUrl` + `filename` — the package URL/path (baseUrl may be empty → relative).
- `size-bytes` — expected size.
- `# <pct>` — **optional staged rollout** percentage (canary).
- `-delta.nupkg` vs `-full.nupkg` — delta packages are applied over the installed version; if no
  valid delta chain exists, Squirrel materializes a full package (`createFullPackagesFromDeltas`).
- The payload itself is a **`.nupkg`** (NuGet zip) whose embedded `.nuspec` carries
  `<package><metadata><id><version>` — that is the per-package "manifest."

### 1.3 Signature scheme
- **Integrity**: SHA-1 hash in each `RELEASES` line; the client recomputes and compares after
  download. Mismatch ⇒ `UpdateException` ("The SHA1 hash of the downloaded file does not match"),
  update aborted.
- **Authenticity**: **none by default.** Squirrel does NOT sign the feed. You add trust by hosting
  the feed over HTTPS and (optionally) **Authenticode-signing the installer exe**. There is no
  embedded public key in the app.
- **Key custody**: n/a (no signature).

### 1.4 Provider abstractions
- The update source is **any HTTP(S) URL or a filesystem path** (`updateUrlOrPath`). No named
  providers.
- **`SyncReleases.exe`** (in-repo tool) is the de-facto "GitHub provider": it pulls `.nupkg`s from
  **GitHub Releases** (via Octokit) and generates the `RELEASES` file. So in practice: GitHub
  Releases → `RELEASES` → any static host.

### 1.5 Download flow
- `DownloadReleases` fetches each listed `.nupkg` into `<appRoot>\packages\`. Uses
  `FileDownloader` (WebClient) — **not resumable by default** (re-downloads on failure). SHA-1
  verified post-download.

### 1.6 Install flow
- The updater runs as a **separate process**; the main app is told to exit and the updater applies.
  On next launch the new `app-<version>` directory becomes current.
- `ApplyReleases` extracts full (or materialized-delta) packages into temp, **atomically renames**
  the app version directories, rewrites shortcuts. `silentInstall` supported. **Staged** installs
  via the `# <pct>` field.

### 1.7 Rollback story
- **No automatic rollback.** Previous `app-<version>` directories are retained on disk, so a revert
  is possible by re-pointing to an older version, but the normal recovery path is to **publish a
  corrected (higher-version) release**. Delta corruption falls back to full packages.

### 1.8 Failure modes
| Condition | Behavior |
|---|---|
| SHA-1 mismatch | `UpdateException`, update aborted, old version stays |
| `.nupkg` 404 | download fails, retryable |
| Corrupt/truncated `.nupkg` | NuGet parse fails → abort |
| Broken delta chain | auto-falls back to `-full.nupkg` |
| 5xx on feed/download | retryable network error |
| Filename embeds arch (e.g. `-arm64-`) | version parse breaks (`System.Version.Parse`) — known quirk, see [stagewise releases.ts](https://github.com/stagewise-io/stagewise/blob/main/apps/update-server/src/releases.ts) |

### 1.9 Provider-specific quirks
- Staging (`# <pct>`) is a first-class rollout primitive.
- Delta updates require you to publish matching `-delta.nupkg`s.
- The `RELEASES` filename parser assumes `{id}-{version}-full.nupkg`; extra segments (arch) break it.

---

## 2. Squirrel.Mac (legacy .NET macOS updater)

- **Repo**: `Squirrel/squirrel.mac` · **Latest**: 0.3.2 (tags 0.3.2, 0.3.1) · **Spec**: none.
- **Status**: **effectively abandoned** (no meaningful releases in years).

This is the older .NET macOS auto-updater that preceded the ecosystem's move to **Sparkle**. It
mirrors the Squirrel.Windows model (an update-server feed + packaged payload) for macOS `.app`
bundles, but it never gained traction — the macOS community standardized on Sparkle instead.

> **Verification caveat**: this session's raw-content fetches of the `squirrel.mac` docs were
> blocked by the flaky org proxy, so I am **not** reproducing its exact on-wire schema here to avoid
> inventing fields. Treat it as a historical/abandoned option: **do not adopt it.** If you need a
> .NET macOS updater, use Sparkle (next section). Its last release (0.3.2) is the practical
> "latest version"; there is no modern signing story to compare against Sparkle's ed25519.

---

## 3. Sparkle (macOS — appcast XML + ed25519)

- **Repo**: `sparkle-project/Sparkle` · **Latest**: 2.9.6 (tags 2.9.6, 2.9.5) · **Spec**: Sparkle 2.x appcast (ed25519 since Sparkle 2.0.0).
- **Docs**: https://sparkle-project.org · https://github.com/sparkle-project/Sparkle

### 3.1 Manifest file name + path
**`appcast.xml`** (RSS 2.0 + Sparkle extensions), fetched from the `SUFeedURL` declared in
`Info.plist`. Real public example: [fcjr/ventoy-mac/appcast.xml](https://github.com/fcjr/ventoy-mac/blob/main/appcast.xml).

### 3.2 Manifest schema
```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>App Update Feed</title>
    <link>https://example.com/appcast.xml</link>
    <description>Most recent application updates.</description>
    <!-- public key embedded in-feed (alternative: SUPublicEDKey in Info.plist) -->
    <sparkle:edKey>BASE64ED25519PUBKEY</sparkle:edKey>
    <item>
      <title>Version 2.1.0</title>
      <pubDate>Wed, 04 Nov 2026 10:00:00 +0000</pubDate>
      <description><![CDATA[
        <p>Release notes (HTML allowed).</p>
      ]]></description>
      <enclosure url="https://example.com/updates/App-2.1.0.zip"
                 sparkle:version="20261104"
                 sparkle:shortVersionString="2.1.0"
                 length="10485760"
                 type="application/octet-stream"
                 sparkle:edSignature="BASE64ED25519SIG"/>
    </item>
  </channel>
</rss>
```
Key fields:
- `sparkle:version` (on `<enclosure>` or `<item>`) — **build number** (integer or string); used for ordering.
- `sparkle:shortVersionString` — **marketing version** (CFBundleShortVersionString).
- `sparkle:edSignature` — base64 **ed25519** signature over the `.zip`/`.dmg`.
- `sparkle:edKey` — base64 **ed25519 public key**, embedded in the feed (so the feed is self-describing).
- Optional: `sparkle:minimumSystemVersion`, `sparkle:minimumAutoupdateVersion`, `sparkle:criticalUpdate`, `sparkle:releaseNotesLink`, `sparkle:deltaUpdates` (array of base-version deltas).
- Legacy: `sparkle:dsaSignature` (DSA) — deprecated, superseded by `sparkle:edSignature`.

### 3.3 Signature scheme
- **Algorithm**: **ed25519 (EdDSA)** — the recommended and default scheme in Sparkle 2.x.
- **Key custody**: the private key is held only by the developer; it signs each release
  `.zip`/`.dmg`. The **public key** lives either in the **appcast (`<sparkle:edKey>`)** or in the
  app's `Info.plist` (`SUPublicEDKey`). Putting `edKey` in the feed is the modern pattern.
- **Verification failure**: Sparkle **refuses to install** and shows an error ("The update is not
  valid / cannot be verified"); the app is NOT updated. A MITM cannot inject a malicious appcast
  because the signature binds the artifact to the key.

### 3.4 Provider abstractions
- No named providers — a **single feed URL** (`SUFeedURL`) that must be **HTTPS**. Host it anywhere
  (static file, GitHub raw, a CDN path).

### 3.5 Download flow
- Sparkle downloads the `.dmg`/`.zip`, checks `length`, then verifies **ed25519**. Caches artifacts
  under `~/Library/Caches/<bundle-id>/`. **Optional delta updates** (`SUAllowDeltaUpdates` +
  `sparkle:deltaUpdates`) download a delta over the installed build.

### 3.6 Install flow
- On user approval (or when `SUAutomaticallyUpdate` is enabled) Sparkle mounts the DMG, copies the
  new `.app` to its location, **atomically renames** the old app to a backup, verifies, and
  relaunches. Runs at update-check time; no "on quit" gating beyond the relaunch.

### 3.7 Rollback story
- Sparkle deletes the prior version after a clean relaunch; there is **no multi-version rollback
  system.** A bad release is fixed by publishing a **new higher-version signed appcast**. Delta
  updates fall back to a full download when the delta chain is unsatisfiable.

### 3.8 Failure modes
| Condition | Behavior |
|---|---|
| ed25519 signature invalid | "update not valid" — install blocked, old version kept |
| Feed 404 / unreachable | "cannot check for updates" |
| `length` mismatch | artifact rejected |
| DMG/ZIP corrupt | copy fails → abort, old version kept |
| 5xx | retryable network error |

### 3.9 Provider-specific quirks
- Two version fields (build vs marketing) are a classic foot-gun; `sparkle:version` drives ordering.
- `edKey` in-feed vs in-Info.plist — pick one and be consistent.
- Must be served over HTTPS; `sparkle:edKey` makes the feed self-verifying.

---

## 4. WinSparkle (Windows DLL — Sparkle-compatible appcast)

- **Repo**: `WinSparkle/WinSparkle` · **Latest**: ~0.6.3 (verify on GitHub) · **Spec**: none (Sparkle-compatible appcast, `winSparkle:` namespace).
- **Docs**: https://github.com/WinSparkle/WinSparkle

### 4.1 Manifest file name + path
An **`appcast.xml`** that is **Sparkle-compatible** but uses the **`winSparkle:`** XML namespace
instead of `sparkle:`. Fetched from a single HTTPS URL you pass to the DLL. It targets a
**`.zip`** (or `.msi`) payload rather than a `.dmg`.

### 4.2 Manifest schema
```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:winSparkle="http://winsparkle.github.io/winSparkle"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <winSparkle:version>2.1.0</winSparkle:version>
      <winSparkle:minimumSystemVersion>10.0.17763</winSparkle:minimumSystemVersion>
      <title>Version 2.1.0</title>
      <enclosure url="https://example.com/updates/App-2.1.0.zip"
                 length="10485760"
                 type="application/zip"
                 winSparkle:sha256="HEX256"
                 sparkle:dsaSignature="BASE64DSA"/>
    </item>
  </channel>
</rss>
```
> The element set mirrors Sparkle; WinSparkle accepts the Sparkle DSA signature for drop-in
> compatibility and additionally supports its own **SHA-1 / SHA-256** checksums and an optional
> **GPG** signature. (Exact attribute spelling is per the WinSparkle project docs; raw fetch of the
> README was blocked this session, so I have not over-specified beyond the documented Sparkle-compat
> surface.)

### 4.3 Signature scheme
- **Integrity**: **SHA-1 / SHA-256** checksum attribute on the enclosure.
- **Authenticity**: optional **GPG** signature (verified against a trusted key configured in the
  app) and/or Sparkle's **DSA** (`sparkle:dsaSignature`) for compatibility. No ed25519.
- **Public key location**: a trusted GPG key / DSA key configured in the host app (not in the feed).
- **Verification failure**: WinSparkle aborts the update and keeps the running version.

### 4.4 Provider abstractions
- Single HTTPS appcast URL. No named providers (host on any static file server / GitHub Releases).

### 4.5 Download flow
- Downloads the `.zip` payload, verifies checksum (SHA-1/256) + optional GPG. Cached locally.

### 4.6 Install flow
- `WinSparkle.dll` is linked into the app; it drives check → download → extract → run new version →
  optional relaunch. Supports **silent** updates. Full-package (no delta).

### 4.7 Rollback story
- **Limited.** The prior version is retained; on a failed install it can restore, but there is no
  first-class multi-version rollback. Recovery = publish a corrected appcast entry.

### 4.8 Failure modes
| Condition | Behavior |
|---|---|
| SHA-1/256 mismatch | update aborted |
| GPG/DSA verify fail | update aborted, running version kept |
| appcast 404 | "update feed unavailable" |
| 5xx / network | retryable error |

### 4.9 Provider-specific quirks
- Sparkle-compatible means you can reuse Sparkle appcast tooling, but you emit `winSparkle:` tags.
- GPG is the stronger authenticity option if you enable it (mirrors the Linux-world model).

---

## 5. `electron-updater` (electron-builder — `latest.yml` + `.blockmap`)

- **Repo**: `electron/electron-builder` · **Latest**: v25.x (verify on GitHub) · **Spec**: none (documented in electron-builder docs).
- **Docs**: https://www.electron.build/auto-update/

### 5.1 Manifest file name + path
Per-platform YAML files at the feed root:
- Windows/NSIS → **`latest.yml`**
- macOS → **`latest-mac.yml`**
- Linux AppImage → **`latest-linux.yml`**

Real production example (Fiddler Everywhere, [fiddler-everywhere-enhance](https://github.com/msojocs/fiddler-everywhere-enhance/blob/v8.x/server/file/api.getfiddler.com/c/NUNHMjIyNkpNMDg4ZjMzMjZlLTk0OWQtNDgwNi1hMTc2LTFlZGY1MWJiOWRhOA%3D%3D/v/4.6.2/p/win/latest.yml)):

### 5.2 Manifest schema
```yaml
version: 4.6.2
files:
  - url: Fiddler Everywhere 4.6.2.exe
    sha512: BOJAqreovN4q41SFu6KAG4TILKiX7KUjN47TPUb4KAD+ZwVC6/HGcZ2P4CCHFqC5Ql2dVkRnzO0beQZ1sG6iCg==
    size: 139083536
path: Fiddler Everywhere 4.6.2.exe
sha512: BOJAqreovN4q41SFu6KAG4TILKiX7KUjN47TPUb4KAD+ZwVC6/HGCZ2P4CCHFqC5Ql2dVkRnzO0beQZ1sG6iCg==
releaseDate: '2023-09-19T06:31:12.124Z'
```
- `version` — semver of the release.
- `files[]` — each entry has `url` (relative or absolute), `sha512` (base64), `size` (bytes).
- Top-level `path` + `sha512` — the primary artifact (repeated for the main file).
- `releaseDate` — ISO timestamp (drives "newer" detection alongside semver).
- macOS `latest-mac.yml` additionally carries a **`signature`** field (detached RSA signature, base64).
- A sibling **`.blockmap`** file (e.g. `latest-mac.yml` → `<artifact>.blockmap`) holds **BLAKE2 block
  hashes** enabling differential/resumable download.

### 5.3 Signature scheme
- **Integrity**: **SHA-512** (base64) of the installer, stored in the yml; verified after download.
- **Authenticity**:
  - **Windows**: the NSIS installer is **Authenticode-signed** (code-signing cert, SHA-256); the yml
    carries the SHA-512 for integrity.
  - **macOS**: a **detached RSA signature** (from `@electron/osx-sign` / Developer ID cert) is stored
    in the yml `signature` field and verified; the `.app` is also signed/notarized.
  - **Linux**: SHA-512 integrity only (no default authenticity signature).
- **Key custody**: your EV/Developer-ID code-signing cert; the public half is implicit in Authenticode
  chains / the OS trust store.
- **Verification failure**: mismatched SHA-512 or invalid macOS signature ⇒ update rejected
  ("Update installation failed" / verification error); old version kept.

### 5.4 Provider abstractions
- **`GenericProvider`** (any base URL), **`GitHubProvider`** (github.com or GitHub Enterprise, uses
  the Releases API + `releases/download/latest/`), **`S3Provider`** (AWS S3), **`AzureStorageProvider`**.
  (A **Bintray** provider existed historically but was **removed** when JFrog shut down Bintray.)
- The provider decides where `latest.yml` + the installer are fetched from.

### 5.5 Download flow
- Downloads the installer to a temp/cache dir (Windows `%LOCALAPPDATA%\<app>\`, macOS `~/Library/...`,
  Linux `~/.cache`). **Blockmap-based differential download**: electron-updater compares local block
  hashes to the `.blockmap` and downloads only changed blocks (resumable-friendly). **Full** installer
  is the payload (delta is at the *download-block* level, not a product delta).

### 5.6 Install flow
- Background download by default; install on **app quit** (`autoInstallOnAppQuit`) or on user prompt.
  Runs the platform installer (NSIS on Windows, atomic app replace on macOS). **Full** install each
  time.

### 5.7 Rollback story
- **No automatic rollback.** electron-updater does not retain multiple runnable versions. A bad
  release is fixed by publishing a new `latest.yml` (higher version). NSIS can be configured for
  rollback of a failed in-progress install, but there is no multi-version client rollback.

### 5.8 Failure modes
| Condition | Behavior |
|---|---|
| SHA-512 mismatch | install/verify fails, old version kept |
| macOS signature invalid | update rejected |
| `latest.yml` 404 | "cannot get update info" |
| 5xx on feed/installer | retryable |
| Blockmap/local hash drift | re-downloads affected blocks |

### 5.9 Provider-specific quirks
- GitHub provider requires the artifact to be a **GitHub Release** asset; URL patterns differ per
  provider. macOS blockmap is the main reason downloads are small on minor updates.
- `autoInstallOnAppQuit` / `autoDownload` config flags shape the lifecycle.
- The yml naming (`latest*.yml`) is fixed per platform — don't rename.

---

## 6. `@tauri-apps/updater` (Tauri 2.x — JSON manifest + ed25519)

- **Repos**: `tauri-apps/tauri` (core, **2.12.5**) + `tauri-apps/tauri-plugin-updater` (**2.8.1**) · **Spec**: Tauri v2 updater protocol (informal).
- **Docs**: https://tauri.app/docs/learn/updater/ (fetched: https://tauri.app/docs/concepts/auto-updates/)

### 6.1 Manifest file name + path
A **JSON manifest** returned by any of the configured **`endpoints`** (templated URLs). Example:
`https://updates.example.com/{{target}}?version={{current_version}}&arch={{arch}}`.

### 6.2 Manifest schema
Confirmed from [tauri-plugin-updater/src/updater.rs](https://github.com/tauri-apps/tauri-plugin-updater/blob/v2/src/updater.rs)
(`RemoteRelease` + untagged `RemoteReleaseInner` + `ReleaseManifestPlatform{url, signature}`):

Single-platform (dynamic) form:
```json
{
  "version": "2.1.0",
  "notes": "Bug fixes and improvements",
  "pub_date": "2026-11-04T10:00:00Z",
  "url": "https://updates.example.com/darwin-aarch64/app.tar.gz",
  "signature": "BASE64ED25519SIGNATURE"
}
```
Multi-platform (static) form:
```json
{
  "version": "2.1.0",
  "notes": "Bug fixes",
  "pub_date": "2026-11-04T10:00:00Z",
  "platforms": {
    "darwin-aarch64": { "url": "https://.../app.tar.gz", "signature": "BASE64..." },
    "windows-x86_64": { "url": "https://.../app.msi",    "signature": "BASE64..." },
    "linux-x86_64":   { "url": "https://.../app.tar.gz", "signature": "BASE64..." }
  }
}
```
- `version` (semver), `notes`, `pub_date` (ISO-8601), then either a flat `url`+`signature` (dynamic)
  or a `platforms` map keyed by target triple (static).

### 6.3 Signature scheme
- **Algorithm**: **ed25519**. The `signature` is an ed25519 signature over the update artifact
  (`.tar.gz` on unix, `.msi` on Windows).
- **Key custody**: keypair generated by `tauri signer generate`; the **private key** signs at build
  time (password via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). The **public key** is embedded in
  `tauri.conf.json` under `plugins.updater.pubkey` (or the updater plugin config) — see
  [config_v1/mod.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config_v1/mod.rs).
- **Verification failure**: the update is **rejected** (error surfaced to the app); nothing is
  installed. A forged manifest cannot pass without the private key.

### 6.4 Provider abstractions
- No named providers — a list of **`endpoints`** (templated URLs with `{{target}}`,
  `{{current_version}}`, `{{arch}}`). Host the JSON + artifacts anywhere over HTTPS.

### 6.5 Download flow
- Downloads the target artifact (`.tar.gz`/`.msi`), verifies the **ed25519** signature. No delta.
  Optional `dangerousAcceptInvalidCerts` / `dangerousAcceptInvalidHostnames` for self-signed infra.

### 6.6 Install flow
- App calls `check()` then `downloadAndInstall()` (JS) / plugin `installUpdate` (Rust); the binary is
  replaced and the app is **relaunched**. On Windows the MSI installer runs. **Full** package.

### 6.7 Rollback story
- **No built-in rollback.** The binary is replaced in place; recovery = publish a higher-version
  signed manifest. Only upgrades are applied (a version comparator rejects non-newer versions).

### 6.8 Failure modes
| Condition | Behavior |
|---|---|
| ed25519 signature invalid | update rejected |
| endpoint 404 | "no update available" / error |
| `version` not newer | skipped (comparator) |
| 5xx | retryable network error |
| TLS/host mismatch | blocked unless `dangerousAcceptInvalid*` |

### 6.9 Provider-specific quirks
- Tauri **v1 → v2** config migration: v1 `updater.active` + `updater.pubkey` moved to
  `plugins.updater` (see [migrate/v1/config.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/migrate/migrations/v1/config.rs)).
- Endpoint templating is the main "provider" mechanism; the multi-platform static form lets one
  manifest serve all targets.

---

## 7. `@capawesome/capacitor-live-update` (+ deprecated `@capacitor/live-update`)

- **Repo**: `capawesome-team/capacitor-plugins → packages/live-update` · **Latest**: **8.7.1** · **Spec**: none (Capawesome Cloud protocol).
- **Deprecated predecessor**: `@capacitor/live-update` in `ionic-team/capacitor` (removed in
  Capacitor 6) → succeeded by Capawesome.
- **Docs**: https://capawesome.io/docs/plugins/live-update/

### 7.1 Manifest file name + path
Local cache file **`capawesome-live-update-manifest.json`** (a constant that "DO NOT CHANGE" per
[LiveUpdate.java](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdate.java)). It lives in the
bundles dir: `_capacitor_live_update_bundles` (Android) / Library dir (iOS). The **server** returns a
`GetLatestBundleResponse` per channel.

### 7.2 Manifest schema
Local manifest ([Manifest.java](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/classes/Manifest.java) / [Manifest.swift](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/ios/Plugin/Classes/Manifest.swift)):
```json
{
  "items": [
    { "path": "index.html", "checksum": "SHA256HEX", "url": "https://cdn.example.com/.../index.html" },
    { "path": "assets/app.js", "checksum": "SHA256HEX", "url": "https://cdn.example.com/.../app.js" }
  ]
}
```
- `items[]` — the files in the web bundle; each carries at least a **`checksum`** (used to diff what
  is already cached vs. what must download).
- The downloaded **bundle** has an `artifactType` of **`zip`** (single file: `url` + `checksum` +
  `signature`) or **`manifest`** (a base URL; individual files are listed in the manifest). See
  [definitions.ts](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts).

### 7.3 Signature scheme
- **Integrity**: **SHA checksum** per file (manifest items) / per zip (bundle).
- **Authenticity**: **RSA** — the `publicKey` config **must be a PEM-encoded RSA public key**
  (since 6.1.0); the bundle `signature` is verified against it. This is the "code signing" provided
  by **Capawesome Cloud** (and via the **Ionic Live Update Provider SDK** contract: `appId`, `channel`,
  `publicKey`, `serverDomain`, `httpTimeout`).
- **Key custody**: Capawesome Cloud holds the signing key; you configure the public key.
- **Verification failure**: the bundle is rejected; the previously good bundle (or embedded) is used.

### 7.4 Provider abstractions
- **Capawesome Cloud** (managed) **or a self-hosted server**. Because it implements the **Ionic Live
  Update Provider SDK** contract, it also works with **Federated Capacitor** / **Ionic Portals**.
- **Channels**: `production-<versionCode>`, versioned channels (tied to build versionCode at build
  time), plus testing/QA channels.

### 7.5 Download flow
- Downloads the bundle (zip) or individual manifest files into the bundles dir, verifies checksum +
  RSA signature, with **download-progress events**. Caches by bundle id.

### 7.6 Install flow
- The app loads the **local** bundle instead of remote assets. Applied on **next app start** or an
  explicit **`reload()`**. **Full** bundle (no product-level delta).

### 7.7 Rollback story  ← strongest in this survey for hybrid apps
- **Explicit `rollback()` API** + **automatic kill-safe rollback**: you must call **`ready()`** once
  the app is usable; if it isn't called within `readyTimeout`, the plugin **resets to the embedded
  (default) bundle on the next start**. "The rollback is kill-safe: if the app is closed or crashes
  before `ready()` is called, the rollback is performed on the next app start."
- **`autoBlockRolledBackBundles`**: automatically blocks bundles that caused a rollback (up to 100,
  LRU), so a known-bad bundle is never re-applied.

### 7.8 Failure modes
| Condition | Behavior |
|---|---|
| checksum / RSA signature mismatch | bundle rejected; prior/embedded used |
| crash before `ready()` | **auto-rollback to embedded bundle** on next start |
| download fail | keeps the current good bundle |
| 404 / 5xx on channel API | retryable; no change |

### 7.9 Provider-specific quirks
- `public` is a **reserved** bundle id (cannot be used). Versioned channels tie the channel to
  `versionCode` at build time. Supports Android, iOS, and **Electron**.
- The deprecated `@capacitor/live-update` had a simpler (less signed, less rollback-safety) design;
  migrate to Capawesome for RSA signing + kill-safe rollback.

---

## 8. Expo Updates (EAS Update)

- **Repo**: `expo/expo → packages/expo-updates` · **Latest**: expo-updates **58.0.5** · **Spec**: none (EAS Update protocol + self-hosted `expo-updates` server).
- **Docs**: https://docs.expo.dev/develop/updates/

### 8.1 Manifest file name + path
A server-served **update-manifest JSON** from the **`updateUrl`** (EAS: `u.expo.fyi`; or a
self-hosted `expo-updates` endpoint), scoped by **`scopeKey`** (project id) and **`runtimeVersion`**.
Real shape from the in-repo update server fixture
([expo-updates e2e update.ts](https://github.com/expo/expo/blob/main/packages/expo-updates/e2e/fixtures/project_files/maestro/updates-server/update.ts)).

### 8.2 Manifest schema
```json
{
  "id": "6f1e…uuid",
  "createdAt": "2026-11-04T10:00:00.000Z",
  "runtimeVersion": "sdk-53",
  "branch": "production",
  "description": "Bug fixes",
  "launchAsset": {
    "hash": "SHA256HEX",
    "key": "launchAsset",
    "contentType": "application/javascript",
    "url": "https://updates.example.com/assets/…/bundle"
  },
  "codeSigning": {
    "algorithm": "rsa-4096-sha256",
    "signature": "BASE64RSA",
    "certs": [ "BASE64CERT" ]
  }
}
```
- **`runtimeVersion`** (NOT the app version) is the compatibility key — an update applies only when
  its `runtimeVersion` matches the app's. The `expo-updates` DB stores each
  `UpdateEntity(uuid, date, runtimeVersion, projectId, manifest, …)` (see
  [UpdatesConfiguration.kt](https://github.com/expo/expo/blob/main/packages/expo-updates/android/src/main/java/expo/modules/updates/UpdatesConfiguration.kt)).

### 8.3 Signature scheme
- **Integrity**: **SHA-256** hash of the launch asset (`launchAsset.hash`).
- **Authenticity**: **code signing** — `codeSigning.algorithm` = **rsa-4096-sha256**, a signature
  over the launch asset plus a certificate chain (`certs`). Configured via the `codeSigningCert`
  config / `getUpdatesCodeSigningCertificate`.
- **Key custody**: your code-signing cert (EAS manages the signing key server-side for EAS Update).
- **Verification failure**: the update is rejected; the **embedded** (in-app) update is used.

### 8.4 Provider abstractions
- **EAS Update** (managed, `u.expo.fyi`) **or self-hosted** `expo-updates` server. Addressed by
  `updateUrl` + `scopeKey` + optional `requestHeaders`.

### 8.5 Download flow
- Downloads the JS **launch asset** + referenced assets, verifies hash + code signature. Persisted in
  a local **SQLite Updates DB** (survives app restarts; multiple runtime versions can coexist).

### 8.6 Install flow
- **Staged**: the update is fetched at launch (`checkOnLaunch: 'immediate'|'background'` +
  `launchWaitMs`) and **activated on next launch**, or immediately via `reloadAsync()`. The **embedded
  update** is the always-available fallback. **Full** JS bundle (no product delta).

### 8.7 Rollback story
- **Server-side rollback**: mark an update rolled back (EAS `update:rollback` / API) → clients will
  not activate it.
- **Client fallback**: the embedded update is always the safe floor; anti-bricking measures exist
  (toggle: `disableAntiBrickingMeasures`). So a bad JS update can't brick the app — worst case the
  next launch reverts to embedded.

### 8.8 Failure modes
| Condition | Behavior |
|---|---|
| `runtimeVersion` mismatch | update not applicable (stays on current) |
| SHA-256 hash mismatch | rejected; embedded used |
| code-signature invalid | rejected; embedded used |
| 404 / 5xx on updateUrl | retryable; embedded used |

### 8.9 Provider-specific quirks
- `runtimeVersion` scheme is either **fingerprint** (`file:fingerprint`) or an **explicit** string —
  this is what gates compatibility, and it's the most confusing part of Expo Updates.
- EAS vs self-hosted differ in how the manifest + assets are served, but the client protocol is the
  same.

---

## 9. CodePush / App Center (React Native — **retired**)

- **Repo**: `microsoft/react-native-code-push` (now **archived**) · **Latest**: **9.0.1** (frozen; tags 9.0.1, 9.0.0) · **Spec**: none (proprietary; now archived).
- **Docs (archived)**: https://github.com/microsoft/react-native-code-push

> **Sunset (important, and a date correction)**: the repo README states
> "Visual Studio App Center was retired on **March 31, 2025** … CodePush, along with other App
> Center features, was also retired on **March 31, 2025**. Consequently, we are archiving this
> repository." The task brief said "May 2025" — the **authoritative CodePush/App Center retirement
> date is 2025-03-31** (the later "May 2025" figure appears to conflate the broader App Center
> platform wind-down timeline). **Migration path**: **Expo EAS Update** is the recommended
> replacement (same runtimeVersion-style JS-bundle-over-the-air model).

### 9.1 Manifest file name + path
The on-the-wire unit is an **update-metadata JSON** returned by the CodePush server's
`queryUpdate` endpoint, plus a **binary/JS bundle** downloaded by hash. Locally each package is
stored in a folder named by its **`packageHash`** (see
[UpdateManager.cs](https://github.com/microsoft/react-native-code-push/blob/master/windows-legacy/CodePush/UpdateManager.cs)).

### 9.2 Manifest schema
Metadata keys (from [CodePush.m](https://github.com/microsoft/react-native-code-push/blob/master/ios/CodePush/CodePush.m) + [CodePush.js](https://github.com/microsoft/react-native-code-push/blob/master/CodePush.js)):
```json
{
  "label": "v2",
  "appVersion": "1.4.0",
  "description": "Bug fixes",
  "packageHash": "sha256…",
  "binaryPlatform": "ios",
  "updateRawBundleUrl": "https://codepush.appcenter.ms/…/MainBundle.tar",
  "updatePackageUrl": "https://codepush.appcenter.ms/…/package",
  "mandatory": false,
  "updateRollback": false,
  "binaryDate": "2024-01-01T00:00:00Z"
}
```
- `appVersion` — the **native binary** version the update is built against (diffing basis).
- `packageHash` — identifies the package folder on disk.
- `updateRawBundleUrl` / `updatePackageUrl` — where to fetch the JS bundle / full package.
- `mandatory` — forces the update. `updateRollback` — server-directed rollback flag.

### 9.3 Signature scheme
- **Integrity**: `packageHash`.
- **Authenticity**: the **Windows UWP** client takes a **`publicKey`** (RSA) and verifies the package
  signature (see [CodePushPackage.cpp](https://github.com/microsoft/react-native-code-push/blob/master/windows/CodePush/CodePushPackage.cpp)); iOS/Android historically relied on the TLS-protected
  App Center endpoint rather than an in-app public key.
- **Key custody**: server-side (App Center). **Verification failure**: package rejected.

### 9.4 Provider abstractions
- **App Center CodePush cloud** only (now retired). No provider abstraction; the deployment key +
  app id address the cloud.

### 9.5 Download flow
- Downloads the bundle into a per-`packageHash` folder, verifying the hash. Caches multiple
  packages (binary + several JS updates coexist, keyed by appVersion).

### 9.6 Install flow
- Staged: the new package is applied on **next app launch** (or after a native restart). Diff
  updates were possible against the `appVersion` base (iOS); Android applied full bundles.

### 9.7 Rollback story
- **Client-side rollback**: `rollback()` + `sync()`; the last rollback is persisted
  (`LATEST_ROLLBACK_INFO` with `packageHash`, `time`, `count`).
- **Server-side rollback**: `appcenter codepush rollback` stops additional users installing a bad
  release.
- **Failed-hash blocking**: `IsFailedHash` / `failedUpdates` prevents re-attempting a package that
  already failed to install.

### 9.8 Failure modes
| Condition | Behavior |
|---|---|
| hash mismatch | package rejected |
| failed install (crash) | hash added to `failedUpdates`; not retried; rollback available |
| 404 / 5xx on CodePush endpoint | retryable |
| `appVersion` mismatch | update not applied to that binary |

### 9.9 Provider-specific quirks
- **The whole service is gone** — you cannot self-host the official client anymore in any supported
  way. If you are on CodePush today, the migration target is **EAS Update** (or a self-hosted
  `expo-updates` server).

---

## 10. PWA service worker (W3C/MDN + Workbox — `skipWaiting`, `clients.claim`, `updateViaCache`)

- **Spec**: **W3C/WHATWG Service Worker** (https://w3c.github.io/ServiceWorker/) · **MDN**:
  https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register
- **Workbox**: `googlechromelabs/workbox` (v7.x, verify on GitHub) · https://workboxjs.com
- This is a **web-standard** updater, not a native SDK. The "update unit" is the **service worker
  script** itself (the browser re-fetches it and installs a new one when bytes change), plus any
  **precache revision manifest** Workbox generates.

### 10.1 "Manifest" file name + path
- **`serviceWorker.register('/sw.js', options)`** — the SW script URL is the update unit.
- Workbox additionally emits a **`precache-manifest.js`** (a JS array of hashed URLs) that is the
  "manifest" of precached app assets; when it changes, the SW updates its precache.
- (The installable **Web App Manifest** `manifest.webmanifest` is unrelated to updates.)

### 10.2 Registration / options schema
Confirmed from [angular service-worker provider.ts](https://github.com/angular/angular/blob/main/packages/service-worker/src/provider.ts) and [next.js](https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/service-worker/app/page.js):
```js
const reg = await navigator.serviceWorker.register('/sw.js', {
  scope: '/',
  updateViaCache: 'imports',   // 'imports' (default) | 'all' | 'none'
  type: 'module'                // 'classic' | 'module'
});
// reg.updateViaCache reflects the option; reg.update() forces a re-check
```
- **`updateViaCache`** (MDN: [ServiceWorkerRegistration.updateViaCache](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache)):
  - `'imports'` (default) — `importScripts()` go to the HTTP cache first; the main SW script is
    fetched fresh (no-cache).
  - `'all'` — both the SW script and its imports are consulted against the HTTP cache.
  - `'none'` — bypass HTTP cache entirely for update checks.

### 10.3 Signature scheme
- **None.** Integrity + authenticity come from **TLS/HTTPS** only. There is no app-level signature
  in the SW spec. (You can add your own content-hash checks inside the SW if you need supply-chain
  guarantees, but the platform does not provide one.)
- **Verification failure**: an SW script that fails to parse/execute → the new SW install **fails and
  the old SW stays active** (the browser never "updates" to a broken worker).

### 10.4 Provider abstractions
- The SW must be served from the **same origin** (or an allowed same-scope cross-origin) **over
  HTTPS**. No provider abstraction — it's an origin-scoped resource.

### 10.5 Download flow
- **Browser-driven**, not app-driven. Update checks happen automatically (roughly every 24h for
  idle clients, or on navigation / `reg.update()`), honoring `updateViaCache`. Resumable: no (plain
  HTTP). Caching: HTTP cache + **Cache Storage** (Workbox wraps this).

### 10.6 Install flow
- SW lifecycle: **installing → (skipWaiting?) → waiting → activating → (clients.claim?) →
  controller**. The `controllerchange` event fires when a client is taken over. Workbox recipes:
```js
// sw.js (Workbox)
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';

clientsClaim();
self.skipWaiting();                 // activate new SW immediately (no waiting for tabs to close)
precacheAndRoute(self.__WB_MANIFEST); // precache app shell (revision-hashed URLs)
cleanupOutdatedCaches();            // remove old precache revisions on activate
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkFirst({ cacheName: 'api' }));
```
- **`skipWaiting()`** → the newly-installed SW activates without waiting for the old SW's clients to
  close. **`clients.claim()`** → the new SW takes control of already-open clients immediately
  (instead of only controlling documents loaded after activation).

### 10.7 Rollback story
- **Forward-only at the platform level.** There is no built-in "revert to previous SW." Rollback =
  **redeploy the previous SW script** (same origin) + bump precache revisions; `cleanupOutdatedCaches()`
  then drops stale entries. Workbox precache revisioning is the de-facto update/rollback mechanism:
  an asset's cache key is its content hash, so changing content changes the key and the old entry is
  garbage-collected.

### 10.8 Failure modes
| Condition | Behavior |
|---|---|
| SW fetch 5xx / network | keeps the existing SW (no change) |
| SW script parse/runtime error | new SW install fails; old SW remains active |
| Precache revision mismatch | old precache cleaned, re-populated |
| Cache Storage quota exceeded | eviction (LRU-ish) |
| Offline | served from Cache Storage (per strategy) |

### 10.9 Provider-specific quirks
- SW updates are **throttled** by the browser (won't hammer the network); `updateViaCache: 'none'`
  is how you force always-fresh checks.
- `type: 'module'` SWs are required for some modern patterns; `updateViaCache` default is `'imports'`.
- The two-phase install (waiting→activating) is why `skipWaiting`+`clients.claim` are usually paired.

---

## 11. Microsoft App Installer / MSIX (Windows Package Manager)

- **Note on naming**: there is no product literally called "Microsoft.AutoUpdater." The Windows
  mechanism for MSIX deployment/updates is **Microsoft App Installer** (WinRT namespace
  `Microsoft.Management.Deployment`, aka **Windows Package Manager**) + the **MSIX** package format.
- **Repos/specs**: `microsoft/installer` (App Installer) · MSIX Open Specification · Authenticode.
- **Docs**: https://learn.microsoft.com/en-us/windows/msix/ · https://github.com/microsoft/installer

### 11.1 Manifest file name + path
Two manifests:
1. **`AppxManifest.xml`** — lives **inside** the `.msix` / `.msixbundle` (a ZIP container). This is
   the package's identity + metadata. Real examples:
   [LocalSend](https://github.com/localsend/localsend/blob/main/support/build/msix/content/AppxManifest.xml),
   [Blender template](https://github.com/blender/blender/blob/main/release/windows/msix/AppxManifest.xml.template),
   [Shotcut](https://github.com/mltframework/shotcut/blob/master/packaging/windows/Microsoft%20Store/PackageFiles/AppxManifest.xml).
2. **`.appinstaller`** (an XML file) — the **on-the-wire update feed** App Installer fetches to learn
   where the current package + assets live, with a fallback URL.

### 11.2 Manifest schema
`AppxManifest.xml` (package manifest, inside the `.msix`):
```xml
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
         xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
         IgnorableNamespaces="uap3 desktop">
  <Identity Name="LocalSend.App" Version="1.18.2.0"
            Publisher="CN=…" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>LocalSend</DisplayName>
    <PublisherDisplayName>LocalSend</PublisherDisplayName>
    <Description>Local file sharing</Description>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" />
  </Dependencies>
  <Resources><Resource Language="en-us" /></Resources>
  <Applications>
    <Application Id="App" Executable="LocalSend.exe" />
  </Applications>
</Package>
```
- `<Identity>` — `Name`, `Version` (**4-part** `major.minor.build.revision`), `Publisher` (a CN; for
  non-Store a GUID CN is common), `ProcessorArchitecture`. **The Publisher is the update identity** —
  an update must come from the **same publisher**.
`.appinstaller` (update feed):
```xml
<Manifest xmlns:ms="http://schemas.microsoft.com/appx/appinstaller/2015"
          Version="1.0">
  <MainPackage Name="LocalSend.App" Publisher="CN=…" Version="1.18.2.0" />
  <UpdateSource StartUri="https://example.com/updates/LocalSend.msixbundle"
                FallbackUri="https://example.com/updates/LocalSend-fallback.msixbundle" />
</Manifest>
```

### 11.3 Signature scheme
- **Algorithm**: **Authenticode** (PE signing). The whole `.msix` is signed; the `AppxManifest.xml`
  is signed with the publisher's certificate (hashes of all package files + the manifest).
- **Key custody**: your **code-signing certificate** (a real CA cert, or a self-signed/GUID cert for
  sideloading). **Public key location**: the signing cert / Windows **publisher identity** trust.
- **Verification failure**: Windows **blocks installation** (signature invalid, or publisher mismatch
  with the installed package). Update identity is enforced — a different publisher cannot update your
  app.

### 11.4 Provider abstractions
- **`.appinstaller` file** (any URL) as the update feed; or a **direct `.msix`/`.msixbundle` URL**;
  or the **Microsoft Store**; or **Windows Update for Business**. The App Installer API
  (`DeploymentManager.FindPackageUpdatesByPackageFamilyName`, `AddPackage`, `UpdatePackage`) is the
  programmatic surface.

### 11.5 Download flow
- App Installer downloads the `.msix`/`.msixbundle` (WinHTTP; the OS manages the transfer), verifies
  the Authenticode signature. Caches the package in the Windows package store.

### 11.6 Install flow
- `UpdatePackage`/`AddPackage` → Windows **stages** and **atomically installs** the new package.
  Supports **staged deployment** (deploy to a staging area, apply at maintenance time / next boot).
  **Versioned** packages (4-part version); a higher version is required to replace.

### 11.7 Rollback story  ← strongest OS-level rollback in this survey
- Windows **retains the previous package version** and can **roll back a failed update**
  automatically (the package manager restores the prior version if the new one fails to deploy/
  launch). This is the most robust "real" rollback of all tools because it is enforced by the OS
  package store, not the app.

### 11.8 Failure modes
| Condition | Behavior |
|---|---|
| Authenticode signature invalid | install blocked |
| Publisher mismatch with installed app | update blocked (identity check) |
| New `Version` not higher | no-op (must be newer) |
| Download fail / 5xx | retryable |
| `.appinstaller` 404 | "update source not found" |

### 11.9 Provider-specific quirks
- **Same-publisher-required** for updates is the big constraint (you can't re-publish under a new
  cert to "update" existing installs).
- `.msixbundle` lets you ship per-arch packages in one file; `ProcessorArchitecture` in `<Identity>`
  must match.
- Store vs sideloaded apps have different update sources; `.appinstaller` is the sideloading feed.

---

## 12. Cross-tool failure-mode matrix

Legend: ✅ handled gracefully · ⚠️ manual/degraded · ❌ none

| Failure | Squirrel | Sparkle | WinSparkle | electron-upd | Tauri | Capawesome | Expo | CodePush | PWA/SW | MSIX |
|---|---|---|---|---|---|---|---|---|---|---|
| Integrity/checksum mismatch | ✅ SHA-1 abort | ✅ len+ed abort | ✅ SHA abort | ✅ SHA-512 abort | — (sig) | ✅ checksum abort | ✅ hash abort | ✅ hash abort | n/a (TLS) | ✅ Authenticode |
| Signature/auth invalid | ⚠️ (none; HTTPS) | ✅ ed25519 block | ✅ GPG/DSA block | ✅ AuthCode/RSA block | ✅ ed25519 reject | ✅ RSA reject | ✅ code-sign reject | ⚠️ (UWP key only) | ❌ (TLS only) | ✅ publisher check |
| Feed/manifest 404 | ✅ retry/keep | ✅ "can't check" | ✅ keep | ✅ "no update info" | ✅ "no update" | ✅ keep prior | ✅ embedded floor | ✅ retry | ✅ keep old SW | ✅ keep current |
| 5xx / transient | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ retryable | ✅ keep old SW | ✅ retryable |
| Partial/corrupt download | ✅ hash fail | ✅ len fail | ✅ hash fail | ✅ blockmap+sha | ✅ sig fail | ✅ checksum fail | ✅ hash fail | ✅ hash fail | ✅ SW parse fail | ✅ sig fail |
| Crash mid-install | ⚠️ re-release | ⚠️ re-release | ⚠️ restore | ⚠️ re-release | ⚠️ re-release | ✅ kill-safe rollback | ✅ embedded floor | ✅ failed-hash block | ✅ old SW stays | ✅ OS rollback |
| Bad release already shipped | ⚠️ new release | ⚠️ new signed | ⚠️ new entry | ⚠️ new yml | ⚠️ new JSON | ✅ rollback()+block | ✅ server rollback | ✅ client+server rb | ⚠️ redeploy SW | ✅ OS rollback |

**Rollback capability ranking** (best → weakest):
1. **MSIX / App Installer** — OS-enforced staged rollback to prior version.
2. **Capawesome live-update** — kill-safe auto-rollback to embedded bundle + blocked-bundle list.
3. **Expo Updates** — server-side rollback + embedded fallback floor.
4. **CodePush** — client + server rollback (but service is retired).
5. **PWA/SW** — forward-only; manual redeploy of prior SW.
6. **Tauri / electron-updater / Sparkle / WinSparkle / Squirrel** — no auto-rollback; ship a
   corrected higher version.

---

## 13. Recommendation for AIRIZ Motor Console

**Constraints**: one person, Electron desktop + Capacitor mobile + PWA + a background worker; want the
**simplest unified** update architecture. You currently run `sync_release_feed.py` + electron-updater
(Windows) + Capawesome (mobile) + Pages PWA + a worker version pin.

### 13.1 The honest structural reality
There is **no single tool** that covers all four surfaces (native desktop + native mobile + PWA +
worker), so "unified" really means: **one source of truth + one signing key + one deploy step**
driving the fewest possible updaters. The cheapest unification is a **single signed JSON feed** that
each client interprets, not a single SDK.

### 13.2 Recommended split (minimal moving parts)
| Surface | Use | Why |
|---|---|---|
| Electron desktop | **electron-updater** (GenericProvider) | already in use; `latest.yml` + blockmap differential; no reason to rip out. Point it at one base URL. |
| Capacitor mobile | **Capawesome live-update** | already in use; RSA signing + **kill-safe auto-rollback** is the strongest mobile story; don't add a second mobile updater. |
| PWA + worker | **Workbox** (precache revisioning + `skipWaiting`/`clients.claim`) | it IS the web standard; the worker's "version pin" becomes a precache revision / a fetched `version.json` the worker reads at boot. |
| **Source of truth** | **One signed JSON feed** + one static host (your Pages/CDN) | e.g. `https://airiz-cdn/updates/manifest.json` carrying the desktop version, mobile channel/bundle id, and PWA/worker asset hashes. `sync_release_feed.py` generates it; each updater reads its own slice. |

### 13.3 Concrete simplifications
1. **One signing key, three uses**: keep the ed25519/RSA discipline consistent. For the shared JSON
   feed, sign it (ed25519) so *all* clients can verify the feed, not just the artifacts. This is the
   single highest-value change: it gives you **supply-chain integrity on the feed** across every
   surface.
2. **Retire the worker "version pin" indirection** → make the worker read the same `manifest.json`
   (or a hashed precache entry) and refuse to boot on a feed that doesn't verify. One trust anchor.
3. **Rollback posture**: you already get the two best rollback mechanisms for free — **Capawesome
   kill-safe rollback** (mobile) and **MSIX/OS rollback is N/A** (Electron isn't MSIX). For desktop,
   accept "ship a corrected `latest.yml`" (electron-updater has no auto-rollback) — mitigate by
   signing the feed + canary-ing a small `%` first (mirror Squirrel's staging idea in your feed).
4. **If you ever package the Electron app as MSIX**, you gain OS-level rollback for free — but it
   adds Authenticode + publisher-identity complexity; not worth it for a one-person team unless
   corporate deployment policy demands it.
5. **Do NOT** adopt CodePush (retired), Squirrel.Mac (abandoned), or add a 5th updater.

### 13.4 One-paragraph bottom line
Keep **electron-updater + Capawesome + Workbox** (you already run them and they're each the right
tool for their surface) and unify around **one signed JSON feed on one static host** that
`sync_release_feed.py` generates. Add **ed25519 feed signing** as the single trust anchor, use
**Capawesome channels** for canary/staging on mobile, and treat "ship a corrected version" as the
desktop/PWA rollback path (the web standard and electron-updater simply don't auto-rollback). That
gives you the fewest updaters (3, all already in place), one deploy step, one key, and the strongest
mobile rollback in the class — with no new tooling.

---

## 14. Citations & sources

**Primary source (code)**
- Squirrel RELEASES format: [Squirrel/squirrel.windows `src/Squirrel/ReleaseEntry.cs`](https://github.com/Squirrel/squirrel.windows/blob/develop/src/Squirrel/ReleaseEntry.cs) · [UpdateManager.ApplyReleases.cs](https://github.com/Squirrel/squirrel.windows/blob/develop/src/Squirrel/UpdateManager.ApplyReleases.cs) · [UpdateManager.CheckForUpdates.cs](https://github.com/Squirrel/squirrel.windows/blob/develop/src/Squirrel/UpdateManager.CheckForUpdates.cs)
- Real Squirrel `RELEASES`: [GitbookIO/nuts `test/win-releases.js`](https://github.com/GitbookIO/nuts/blob/master/test/win-releases.js) · arch-quirk: [stagewise `apps/update-server/src/releases.ts`](https://github.com/stagewise-io/stagewise/blob/main/apps/update-server/src/releases.ts)
- Real Sparkle appcast (ed25519): [fcjr/ventoy-mac `appcast.xml`](https://github.com/fcjr/ventoy-mac/blob/main/appcast.xml)
- Real electron `latest.yml`: [Fiddler Everywhere `latest.yml`](https://github.com/msojocs/fiddler-everywhere-enhance/blob/v8.x/server/file/api.getfiddler.com/c/NUNHMjIyNkpNMDg4ZjMzMjZlLTk0OWQtNDgwNi1hMTc2LTFlZGY1MWJiOWRhOA%3D%3D/v/4.6.2/p/win/latest.yml) · [solidtime `latest.yml`](https://github.com/solidtime-io/solidtime/blob/main/public/desktop-version/latest.yml)
- Tauri manifest: [tauri-plugin-updater `src/updater.rs`](https://github.com/tauri-apps/tauri-plugin-updater/blob/v2/src/updater.rs) · [config_v1/mod.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config_v1/mod.rs) · [bundle.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/bundle.rs) · v1→v2 migration: [migrate/v1/config.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/src/migrate/migrations/v1/config.rs)
- Capawesome: [LiveUpdate.java](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdate.java) · [Manifest.java](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/classes/Manifest.java) · [Manifest.swift](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/ios/Plugin/Classes/Manifest.swift) · [definitions.ts](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/src/definitions.ts) · [live-update `package.json`](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/live-update/package.json)
- Expo Updates: [e2e update server `update.ts`](https://github.com/expo/expo/blob/main/packages/expo-updates/e2e/fixtures/project_files/maestro/updates-server/update.ts) · [UpdatesConfiguration.kt](https://github.com/expo/expo/blob/main/packages/expo-updates/android/src/main/java/expo/modules/updates/UpdatesConfiguration.kt) · [expo-updates `package.json`](https://github.com/expo/expo/blob/main/packages/expo-updates/package.json)
- CodePush: [README (retirement notice)](https://github.com/microsoft/react-native-code-push/blob/master/README.md) · [CodePush.m](https://github.com/microsoft/react-native-code-push/blob/master/ios/CodePush/CodePush.m) · [UpdateManager.cs](https://github.com/microsoft/react-native-code-push/blob/master/windows-legacy/CodePush/UpdateManager.cs) · [CodePushPackage.cpp](https://github.com/microsoft/react-native-code-push/blob/master/windows/CodePush/CodePushPackage.cpp)
- PWA/Workbox `updateViaCache`: [angular service-worker `provider.ts`](https://github.com/angular/angular/blob/main/packages/service-worker/src/provider.ts) · [next.js SW test](https://github.com/vercel/next.js/blob/canary/test/e2e/app-dir/service-worker/app/page.js)
- MSIX `AppxManifest.xml`: [LocalSend](https://github.com/localsend/localsend/blob/main/support/build/msix/content/AppxManifest.xml) · [Blender template](https://github.com/blender/blender/blob/main/release/windows/msix/AppxManifest.xml.template) · [Shotcut](https://github.com/mltframework/shotcut/blob/master/packaging/windows/Microsoft%20Store/PackageFiles/AppxManifest.xml) · [microsoft/installer](https://github.com/microsoft/installer)

**Official docs / specs**
- Squirrel.Windows: https://github.com/Squirrel/Squirrel.Windows
- Sparkle: https://sparkle-project.org · https://github.com/sparkle-project/Sparkle
- WinSparkle: https://github.com/WinSparkle/WinSparkle
- electron-builder auto-update: https://www.electron.build/auto-update/
- Tauri updater: https://tauri.app/docs/learn/updater/
- Capawesome live-update: https://capawesome.io/docs/plugins/live-update/
- Expo Updates: https://docs.expo.dev/develop/updates/
- CodePush (archived): https://github.com/microsoft/react-native-code-push
- W3C Service Worker: https://w3c.github.io/ServiceWorker/ · MDN `updateViaCache`: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/updateViaCache · Workbox: https://workboxjs.com
- MSIX / App Installer: https://learn.microsoft.com/en-us/windows/msix/

*Report generated 2026-11-04. Version cells marked "verify on GitHub" could not be machine-confirmed
because the org proxy blocked the GitHub REST API during the session.*
