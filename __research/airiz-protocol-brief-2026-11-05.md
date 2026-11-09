# Cross-Platform Auto-Update Protocol Brief — November 2026

> **Scope**: AIRIZ Motor Console (5 surfaces: Electron Windows, Capacitor Android, Capacitor iOS, PWA web, Cloudflare Worker).
> **Purpose**: Survey every cross-platform auto-update tool that matters in 2026. Each section covers protocol name, manifest format, signing mechanism, channel model, install timing, rollback story, known limitations, maintenance status, and migration guidance.
> **Method**: Official docs fetched live + GitHub release data via `gh` CLI. All dates verified against GitHub API on 2026-11-05.
> **Caveat**: Context7 and Exa web search were rate-limited during this session. All documentation was fetched directly from official sources (electron.build, sparkle-project.org, v2.tauri.app, winsparkle.org, docs.expo.dev, developers.cloudflare.com, web.dev, Squirrel GitHub repo).

---

## Quick Reference Matrix

| # | Tool | Platform | Manifest | Signing | Delta | Channels | Rollback | Status (2026-11) |
|---|------|----------|----------|---------|-------|----------|----------|-------------------|
| 1 | electron-updater | Win/Mac/Linux | `latest*.yml` (YAML) | Ed25519 (v27), Authenticode (Win) | Blockmap (HTTP Range) | Staged % in manifest | Manual (increment version) | **Active** v6.8.12 / v7.0.0-alpha |
| 2 | Squirrel.Windows | Windows | `RELEASES` (text) | Authenticode (Setup.exe + app) | `.nupkg` deltas | `RELEASES` per-channel | **None built-in** | **Unmaintained** last rel 2.0.1 (2020) |
| 3 | Squirrel.Mac | macOS | `latest-mac.yml` | macOS code signing | No | No | **None** | **EOL** last rel 0.3.2 (2017) |
| 4 | Sparkle 2 | macOS | Appcast XML (RSS) | EdDSA (ed25519) + Apple codesign | BinaryDelta | `<sparkle:channel>` | Manual | **Active** v2.10.1 (2026-10-25) |
| 5 | WinSparkle | Windows | Appcast XML (RSS) | EdDSA (ed25519) | No | No | Manual | **Active** v0.9.4 (2026-07-21) |
| 6 | Windows App Installer / WinGet | Windows | `AppxManifest.xml` + `AppInstaller.xml` | Authenticode (MSIX) | No | No | WinGet `rollback` | **Platform-managed** |
| 7 | @tauri-apps/updater | Win/Mac/Linux | Static JSON / dynamic API | Ed25519 (mandatory) | No | Runtime endpoint switching | `version_comparator` | **Active** v2.12.5 (2026-10-21) |
| 8 | Capgo (Capacitor) | Android/iOS | Capgo cloud API | Ed25519 (encryption opt-in) | No (full JS bundle) | Capgo channels | Rollback to embedded | **Active** Capgo plugin v7+ |
| 9 | CodePush (App Center) | Android/iOS | App Center API | App Center auth | No | CodePush release types | `appcenter codepush rollback` | **SUNSET** App Center EOL 2025 |
| 10 | Expo Updates (EAS Update) | Android/iOS | Expo Update API | Code signing (opt-in) | Bundle diffs | EAS channels + branches | `eas update:roll-back-to-embedded` | **Active** SDK 58 (2026-11-03) |
| 11 | react-native-code-push | Android/iOS | App Center API (legacy) | App Center auth | No | CodePush release types | `rollback` | **DEAD** last rel v9.0.1 (2024-12) |
| 12 | PWA Service Worker | Web | HTTP byte comparison | TLS + CSP | No | No | Manual cache busting | **Platform-native** (W3C spec) |
| 13 | Cloudflare Workers | Edge (server) | Wrangler version registry | JWT API token | No | Gradual deployments (traffic split) | `wrangler rollback` (100 versions) | **Platform-native** |
| 14 | App Store / Play Store | iOS/Android | Store manifest (opaque) | Apple/Google signing | No | Staged rollout (7-day / %) | Store rollback (limited) | **Platform-managed** |

---
## 1. electron-updater (electron-builder ecosystem)

**Repo**: electron-userland/electron-builder (monorepo; electron-updater is a sub-package)
**Latest stable**: electron-updater@6.8.12 (2026-10-26)
**Latest alpha**: electron-updater@7.0.0-alpha.13 (2026-10-29) - part of electron-builder v27
**Docs**: https://www.electron.build/docs/features/auto-update
**Maintenance**: **Active**. v27 is in alpha with breaking changes (native ESM, Node >=22.12, Ed25519 signed manifests by default).

### Protocol and Manifest Format

The updater polls a manifest file (latest.yml, latest-mac.yml, or latest-linux.yml) hosted at the publish URL. The manifest is a YAML document:

`yaml
# latest.yml (Windows NSIS)
version: 1.2.0
files:
  - url: TestApp%20Setup%201.2.0.exe
    sha512: Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEvfMNXGUXBIw==
    size: 62021782
stagingPercentage: 10
`

For v27+ the iles[] array is the canonical format. Legacy top-level path / sha512 fields are emitted only when electronUpdaterCompatibility includes versions below 2.16.0.

The stagingPercentage field enables **staged rollouts**: setting it to 10 means only 10% of the user base receives the update.

### Provider Abstraction

electron-updater supports multiple publish providers out of the box:

- **generic** - any HTTP(S) server (manual upload of manifest + artifacts)
- **github** - GitHub Releases
- **s3** - Amazon S3 bucket
- **spaces** - DigitalOcean Spaces
- **r2** - Cloudflare R2
- **keygen** - Keygen auto-update API
- **bitbucket** - Bitbucket releases
- **gitlab** - GitLab releases

### AppImage on Linux

AppImage is a first-class target. The updater embeds a blockmap inside the AppImage binary itself (no separate .blockmap file). The AppImageUpdater class handles the APPIMAGE and APPIMAGE_UPDATE_DOWNLOAD_TMP environment variables.

### Signing

- **Windows**: Authenticode signing of the NSIS installer. NsisUpdater.verifyUpdateFileAuthenticodeSignature runs by default.
- **macOS**: Apple code signing (mandatory - unsigned apps cannot auto-update).
- **v27 Ed25519**: The latest*.yml manifest itself is cryptographically signed with Ed25519. Publishing fails unless a signing key resolves.
- **Linux**: GPG signature enforcement is opt-in via utoUpdater.allowUnverifiedLinuxPackages = false.

### Differential Updates (Blockmap)

For NSIS (Windows) and macOS zip targets, electron-builder publishes a .blockmap file alongside the artifact. The updater:

1. Downloads the new blockmap.
2. Compares against the cached previous blockmap.
3. Issues HTTP Range requests only for changed byte ranges.
4. Reassembles the full installer locally.

In v27, the blockmap format defaults to 3 (uncompressed binary, 512-byte blocks, three-level hierarchy).

### Install Timing

Controlled by utoUpdater.autoInstallEvent:

- onQuit (default in v27): Install when app quits. Session-end guard skips install if OS is shutting down.
- onNextLaunch (opt-in v27, planned default v28): Persist the downloaded update; install at next app launch.
- manual: No auto-install; developer calls quitAndInstall() explicitly.

Per-target: NSIS per-user auto-installs at next launch. NSIS per-machine skips (UAC). AppImage auto-installs. deb/rpm/pacman skip (elevate). macOS: Squirrel.Mac stages natively.

### Rollback

**No built-in rollback.** To roll back, publish a new version with a higher version number. The docs explicitly warn: "you must increment the version number higher than your broken release."

### Known Limitations

- Squirrel.Windows target is **not supported** in electron-builder v27. Migrate to NSIS.
- macOS zip target is required for latest-mac.yml generation.
- Web installers (
sis-web) are disabled by default in v27.
- Credentials in 
equestHeaders are only sent to the feed origin, not cross-origin.

### Migration Guide

- **From Squirrel.Windows to NSIS**: Use electron-builder --win nsis.
- **From v26 to v27**: Run electron-builder migrate-schema. Key changes: native ESM, Node >=22.12, Ed25519 signed manifests by default.

---

## 2. Squirrel.Windows

**Repo**: Squirrel/Squirrel.Windows
**Latest release**: 2.0.1 (2020-09-27)
**Stars**: 8.0k | **Forks**: 1.0k | **Open issues**: 367
**Maintenance**: **Unmaintained / seeking contributors**. README banner: "We are looking for help with maintaining this important project - please read the discussion in #1470." No releases since 2020.

### Protocol and Manifest Format

Squirrel.Windows uses a plain-text RELEASES file as its manifest. Each line is tab-separated:

`
1.0.3  <sha1>  MyApp-1.0.3-full.nupkg
1.0.3-delta-1.0.2  <sha1>  MyApp-1.0.3-delta-1.0.2.nupkg
1.0.2  <sha1>  MyApp-1.0.2-full.nupkg
`

The UpdateManager downloads this file and compares it against the locally cached copy. It calculates whether downloading the chain of delta packages is smaller than downloading the latest full package, then downloads the minimum set. Each line's SHA1 is used to verify the downloaded .nupkg package before installation.

### NuGet Package Metadata

Squirrel repurposes NuGet .nupkg packages as its update vehicle:

`xml
<?xml version="1.0"?>
<package xmlns="http://schemas.microsoft.com/packaging/2013/05/nuspec.xsd">
  <metadata>
    <id>MyApp</id>
    <title>My App</title>
    <version>1.0.3</version>
    <authors>YourName</authors>
    <iconUrl>https://example.com/icon.ico</iconUrl>
    <language>en-US</language>
  </metadata>
</package>
`

Key fields: **Id** (app name, no spaces/dots, used for install dir), **Title** (Uninstaller display), **Version** (must match Assembly.cs), **IconUrl** (fetched at install time), **Language** (codepage).

### Delta Packages

Squirrel.exe --releasify generates both a full package and delta packages for each previous version. The delta contains only files that changed. The UpdateManager builds the full package locally by applying the delta chain.

### Signing (Authenticode)

- Setup.exe (bootstrap installer) must be Authenticode-signed.
- The application's main .exe should be Authenticode-signed.
- .nupkg packages are **not** signed; integrity verified via SHA1 in RELEASES.
- **No** asymmetric signature on the RELEASES file itself (known security gap).

### Channel Model

Separate RELEASES files per channel: RELEASES (stable), RELEASES-beta, RELEASES-dev.

### Install Timing

Updates installed in background on app startup. New version extracted to %LocalAppData%\MyApp\app-<version>\. Shortcuts updated. Old versions cleaned up on next launch (keeps current + previous).

### Rollback

**No built-in rollback.** The immediately previous version is retained on disk until the next successful update.

### Known Limitations

- No asymmetric signature on RELEASES (HTTPS only for transport security).
- SHA1 is collision-weak by modern standards.
- No staged rollouts / percentage-based distribution.
- Effectively unmaintained (no releases since 2020, 367 open issues).
- electron-builder v27 **drops Squirrel.Windows support entirely**.
- Windows-only.

### Migration Guide

- **To electron-builder NSIS**: Use electron-builder --win nsis. latest.yml replaces RELEASES.
- **To WinSparkle**: For non-Electron Windows apps, use WinSparkle with Sparkle-compatible appcast format.

---

## 3. Squirrel.Mac

**Repo**: Squirrel/Squirrel.Mac
**Latest release**: 0.3.2 (2017-08-18)
**Stars**: 1,694
**Maintenance**: **Effectively EOL**. No functional releases in 9+ years.

### Protocol and Manifest Format

Used the same latest-mac.yml format that electron-updater still generates for macOS:

`yaml
version: 1.0.3
files:
  - url: MyApp-1.0.3.zip
    sha512: <base64-sha512>
    size: 48234567
`

### Signing

- macOS code signing (Developer ID) required.
- No separate manifest signature (unlike Sparkle's EdDSA).
- No delta updates.

### Current Role

Squirrel.Mac is still **embedded in electron-updater** as the macOS update mechanism. The MacUpdater class uses Squirrel.Mac internally. As a **standalone library** it is dead. For native macOS apps, use **Sparkle 2**.

### Known Limitations

- No releases since 2017. No EdDSA. No delta updates. No channels. No phased rollouts.

### Migration Guide

- **For Electron apps**: No migration needed - electron-updater handles Squirrel.Mac internally.
- **For native macOS apps**: Migrate to **Sparkle 2** (v2.10.1, October 2026).

---

## 4. Sparkle 2 (macOS)

**Repo**: sparkle-project/Sparkle
**Latest release**: 2.10.1 "Golden Gate Bump" (2026-10-25)
**Stars**: 9.9k | **Forks**: 1.2k
**Docs**: https://sparkle-project.org/documentation/
**Maintenance**: **Very active**. 4,389 commits on 2.x branch. Regular releases throughout 2026.

### Protocol and Manifest Format

Sparkle uses **appcast XML** - an RSS 2.0 feed with a custom sparkle: XML namespace:

`xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>My App Updates</title>
    <item>
      <title>Version 2.0</title>
      <link>https://myproductwebsite.com</link>
      <sparkle:version>2.0</sparkle:version>
      <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
      <sparkle:releaseNotesLink>https://example.com/notes/2.0.html</sparkle:releaseNotesLink>
      <pubDate>Mon, 05 Oct 2026 19:20:11 +0000</pubDate>
      <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
      <enclosure url="https://example.com/downloads/MyApp-2.0.zip"
                 sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
                 length="1623481"
                 type="application/octet-stream" />
    </item>
  </channel>
</rss>
`

Key elements: sparkle:version (build number), sparkle:edSignature (EdDSA sig), sparkle:phasedRolloutInterval (seconds between rollout groups), sparkle:channel, sparkle:criticalUpdate, sparkle:minimumAutoupdateVersion, sparkle:minimumSystemVersion, sparkle:hardwareRequirements (arm64, 2.9+).

### Signing (EdDSA / ed25519)

1. Generate keys: ./bin/generate_keys - saves private key in Keychain, prints public key.
2. Add public key to Info.plist as SUPublicEDKey.
3. Sign each update archive: ./bin/sign_update MyApp-2.0.zip.
4. generate_appcast tool automates all steps and generates delta files.

As of Sparkle 2.9, **signed feeds** (SURequireSignedFeed) are supported: the appcast XML itself can be signed.

### Delta Updates (BinaryDelta)

Sparkle includes the **BinaryDelta** library (bsdiff reimplementation). generate_appcast automatically generates .delta files. The client verifies the source app's checksum matches the delta's expected input before applying.

### Channel Model

`xml
<sparkle:channel>beta</sparkle:channel>
`

App declares allowed channels via SPUUpdaterDelegate. Channels are additive.

### Phased Rollouts

sparkle:phasedRolloutInterval enables automatic phased rollouts. With 86400 (1 day), update rolls out to 1/7 of users per day, completing in 7 days.

### Install Timing

- Default: checks every 24 hours. First launch: no prompt (waits for second launch).
- Update download: automatic if SUAutomaticallyUpdate is set.
- Install: .app bundle swapped atomically in /Applications. Relaunch: automatic.

### Rollback

**No built-in rollback.** Publish a new appcast item with a higher sparkle:version pointing to the previous archive.

### Known Limitations

- macOS only. Appcast XML is verbose. Phased rollouts hardcoded to 7 groups. Delta requires exact previous version. Signed feeds require 2.9+.

### Migration Guide

- **From Sparkle 1**: SUUpdater is deprecated; use SPUStandardUpdaterController. DSA deprecated in favor of EdDSA.
- **From Squirrel.Mac**: Replace framework with Sparkle 2. Set SUFeedURL in Info.plist.

---

## 5. WinSparkle

**Repo**: slavik/winsparkle
**Latest release**: v0.9.4 (2026-07-21)
**Stars**: 1.5k | **Forks**: 288
**Docs**: https://winsparkle.org
**Maintenance**: **Active**. Regular releases: v0.9.0 (Mar 2025), v0.9.1 (May 2025), v0.9.2 (Oct 2025), v0.9.3 (May 2026), v0.9.4 (Jul 2026).

### Protocol and Manifest Format

WinSparkle uses the **same appcast XML format as Sparkle** - a Windows port of the Sparkle protocol:

`xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>My App Updates</title>
    <item>
      <title>Version 1.5.1</title>
      <link>https://myapp.example.com</link>
      <sparkle:version>1.5.1</sparkle:version>
      <pubDate>Mon, 05 Oct 2026 19:20:11 +0000</pubDate>
      <enclosure url="https://myapp.example.com/downloads/MyApp-1.5.1.exe"
                 sparkle:edSignature="JhQ69mgRxjNxS35zmMu6bMd9UlkCC/tkCiSR4SXQOfBwwH1FkqYSgNyT5dbWjnw5F1c/6/LqbCGw+WckvJiOBw=="
                 length="1736832"
                 type="application/octet-stream" />
    </item>
  </channel>
</rss>
`

### AppConfig / Initialization

WinSparkle is initialized via a C API:

`c
winsparkle_config_t config;
memset(&config, 0, sizeof(config));
config.eddsa_pubkey_b64 = "pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=";
config.appcast_url = "https://myapp.example.com/appcast.xml";
config.app_id = "com.example.myapp";
win_sparkle_init(&config);
`

Also supports Windows resource file (EdDSAPub resource type) and win_sparkle_set_eddsa_public_key().

### Signing (EdDSA / ed25519)

- Generate keys: winsparkle-tool generate-key --file private.key
- Sign updates: winsparkle-tool sign -f private.key Update.exe
- Legacy DSA signatures supported but **deprecated**.
- Fully compatible with Sparkle's signing mechanism.

### Delta Updates

**Not supported.** Full update package downloaded each time. No BinaryDelta equivalent.

### Channel Model

**Not supported.** Use separate appcast feeds for multiple channels.

### Install Timing

- Checks on configurable interval (default: on app start + periodic timer).
- Downloads in background. Prompts user (or auto-installs if configured).
- Runs the downloaded installer. App must be closed for update to take effect.

### Rollback

**No built-in rollback.** Publish a new appcast item with a higher version pointing to the previous installer.

### Known Limitations

- Windows-only. No delta updates. No channels. No phased rollouts. No signed feed support. Single-maintainer project.

### Migration Guide

- **From Squirrel.Windows**: Use Sparkle appcast format instead of RELEASES. Use winsparkle-tool for signing.
- **For Electron apps**: Use electron-updater (NSIS target) instead.

---

## 6. Windows App Installer / WinGet / MSIX

**Microsoft docs**: https://learn.microsoft.com/en-us/windows/msix/
**WinGet**: https://github.com/microsoft/winget-cli
**Maintenance**: **Platform-managed by Microsoft**. Part of Windows OS.

### Protocol and Manifest Format

MSIX uses AppxManifest.xml:

`xml
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10">
  <Identity Name="Com.Example.MyApp" Publisher="CN=Example Publisher"
    Version="1.2.0.0" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>My App</DisplayName>
    <PublisherDisplayName>Example</PublisherDisplayName>
  </Properties>
  <Applications>
    <Application Id="App" Executable="MyApp.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="My App"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
</Package>
`

Windows App Installer uses AppInstaller.xml for enterprise staged rollouts:

`xml
<AppInstaller Version="1.0"
  Uri="https://updates.example.com/MyApp"
  MinAppVersion="1.0.0.0"
  MinOSVersion="10.0.17763.0"
  Priority="1">
  <UpdatePolicy MinInterval="P1D" />
  <AppUri AppVersion="1.2.0.0"
    HashAlgorithm="SHA256"
    HashValue="abc123..."
    Size="52428800"
    ContentType="application/vnd.ms-appx.package" />
</AppInstaller>
`

### Signing

- MSIX packages signed with **Authenticode certificate**. Certificate must match Publisher attribute.
- Windows App Installer verifies SHA-256 HashValue of each AppUri.
- WinGet packages signed with Authenticode or verified via repository trust.

### Channel Model

- MSIX: No built-in channels. Use separate MSIX packages per channel.
- Windows App Installer: Different Uri feeds per channel.
- WinGet: Uses "sources" (winget source add).

### Install Timing

- MSIX: Add-AppxPackage (PowerShell) or Windows App Installer. Silent by default.
- Windows App Installer: Polls feed at MinInterval. Installs in background.
- WinGet: Manual (winget upgrade) or scheduled task.

### Rollback

- MSIX: Remove-AppxPackage + reinstall previous. No automatic rollback.
- Windows App Installer: Revert to previous AppUri by editing manifest.
- WinGet: winget rollback <package>.

### Known Limitations

- MSIX requires per-user or per-machine elevation.
- Windows App Installer is enterprise-focused.
- WinGet is a package manager, not an auto-update framework.
- No delta updates. MSIX packages are large.
- **Not suitable** as primary auto-update for AIRIZ Electron Windows surface. Use electron-updater (NSIS).

---

## 7. @tauri-apps/updater (Tauri 2.x)

**Repo**: 	auri-apps/tauri (updater plugin in 	auri-apps/plugins-workspace)
**Latest release**: tauri v2.12.5 (2026-10-21)
**Docs**: https://v2.tauri.app/plugin/updater/
**Maintenance**: **Very active**. Regular releases throughout 2026.

### Protocol and Manifest Format

**Static JSON file** (for S3, GitHub Releases, CDNs):

`json
{
  "version": "1.2.0",
  "notes": "Bug fixes and performance improvements",
  "pub_date": "2026-10-21T12:00:00Z",
  "platforms": {
    "linux-x86_64": {
      "signature": "MEUCIQC...",
      "url": "https://releases.myapp.com/myapp_1.2.0_AppImage"
    },
    "windows-x86_64": {
      "signature": "MEUCIQD...",
      "url": "https://releases.myapp.com/myapp-setup.exe"
    },
    "darwin-x86_64": {
      "signature": "MEUCIQC...",
      "url": "https://releases.myapp.com/myapp.app.tar.gz"
    }
  }
}
`

**Dynamic update server**: Server responds with 204 No Content (no update) or 200 OK with JSON:

`json
{
  "version": "1.2.0",
  "pub_date": "2026-10-21T12:00:00Z",
  "url": "https://releases.myapp.com/myapp-setup.exe",
  "signature": "MEUCIQD...",
  "notes": "Bug fixes"
}
`

### Tauri Configuration

`json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IHB1YmxpYyBrZXk6ID...",
      "endpoints": [
        "https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}",
        "https://github.com/user/repo/releases/latest/download/latest.json"
      ]
    }
  }
}
`

Dynamic URL variables: {{current_version}}, {{target}} (linux/windows/darwin), {{arch}} (x86_64/i686/aarch64/armv7).

### Signing (Ed25519 - Mandatory)

Tauri's updater **requires** Ed25519 signatures. Cannot be disabled.

1. Generate keys: 
pm run tauri signer generate -- -w ~/.tauri/myapp.key
2. Set public key in 	auri.conf.json
3. Set TAURI_SIGNING_PRIVATE_KEY env var during build
4. Build generates .sig files alongside installer artifacts

### Install Timing

- check(): Fetches manifest, compares versions.
- downloadAndInstall(): Downloads, verifies signature, runs installer.
- Windows: App **automatically exited** before installer runs. Use on_before_exit hook.
- installMode: passive (default), asicUi, quiet.

### Channel Model

**No built-in channel system.** Channels via runtime endpoint switching:

`
ust
let channel = if beta { "beta" } else { "stable" };
let url = format!("https://{channel}.myserver.com/{{target}}-{{arch}}/{{current_version}}");
`

### Rollback

**No built-in rollback.** Use ersion_comparator to allow downgrades:

`
ust
.version_comparator(|current, update| update.version != current)
`

### Known Limitations

- No delta updates. No signed manifest (only artifact signed). Windows auto-exit is a hard limitation. No phased rollouts. Requires Rust >= 1.90.

---

## 8. Capacitor Live Update (Capgo + @capawesome)

### Status Clarification

- **No official @capacitor/live-update** exists from the Ionic/Capacitor team.
- **Capgo** (@capgo/capacitor-updater) is the **primary** Capacitor live-update solution. Open-source plugin (LGPL-3.0) + cloud backend (AGPL-3.0).
- **@capawesome/capacitor-live-update** is a community plugin with basic OTA updates.
- Capgo also supports **Electron** desktop apps.

### Capgo Protocol and Manifest Format

Capgo uses a **cloud API** - no static manifest file:

1. 
px @capgo/cli@latest init [APIKEY] registers the app.
2. CI/CD uploads JS/HTML/CSS bundle to Capgo cloud.
3. App's Capacitor plugin polls Capgo API for updates.
4. Server returns manifest with bundle URL and version.

`json
{
  "version": "1.2.0",
  "bundleUrl": "https://capgo-cloud.com/bundles/app-id/1.2.0.bundle",
  "size": 245760,
  "hash": "sha256:abc123...",
  "mandatory": false,
  "channel": "production"
}
`

### Signing

- **Capgo encryption** (opt-in): Ed25519-encrypted bundles. Public key in app binary.
- Without encryption, bundles served as public web assets over HTTPS.

### Channel Model

Capgo supports channels: production, eta, dev, custom. Each channel can have different rollout percentages.

### Install Timing

- **Background update** (default): New bundle downloaded in background. Applied on next cold start.
- **Force update** (opt-in): App shows prompt and restarts immediately. Capgo warns against force updates for App Store apps.

### Rollback

- Capgo dashboard: one-click rollback to previous bundle.
- CLI: 
px @capgo/cli@latest rollback.
- App falls back to **embedded bundle** if remote bundle fails to load.

### Store Compliance

- **Google Play**: OTA JS bundle updates explicitly allowed (VM exception).
- **Apple App Store**: Paragraph 3.3.2 allows downloading interpreted code (JavaScript).

### Maintenance

- Capgo plugin v7+ fully supported for Capacitor v7+ (latest: 7.6.10, 2026-10-28).
- Capgo plugin v3-v4 no longer supported.

### Known Limitations

- Only updates HTML/CSS/JS. Native code changes require new store submission.
- Requires Capgo cloud (or self-hosted AGPL-3.0 backend).
- No delta updates. Plugin is LGPL-3.0.

---

## 9. CodePush (Microsoft App Center) - SUNSET

**Repo**: microsoft/react-native-code-push (client) + App Center cloud (server, shut down)
**Latest client release**: v9.0.1 (2024-12-19)
**App Center sunset**: Microsoft shut down App Center in 2025.

### Original Protocol

CodePush was a binary diff + JS bundle OTA update system for React Native and Cordova:

1. Developer runs ppcenter codepush release-react --app <app> --target Releases.
2. App Center stores the JS bundle and generates a binary diff.
3. The app's CodePush module polls the App Center API.
4. Server returns diff URL and metadata.
5. App downloads diff, applies it, restarts JS runtime.

`json
{
  "label": "1.2.0",
  "appVersion": "1.0.0",
  "packageUrl": "https://appcenter.codepush.ms/v3/codepush/download/package/...",
  "packageHash": "abc123...",
  "packageSize": 245760,
  "mandatory": false,
  "promotionSource": "Staging"
}
`

### Release Types (Channels)

Three built-in release types: Development, Staging, Releases. Updates promotable between them.

### Signing

- App Center used its own API token authentication for upload.
- No client-side cryptographic signature on the bundle.
- Integrity via SHA-256 hash in manifest. Transport via HTTPS.

### Rollback

- ppcenter codepush rollback --app <app> --target Releases.
- Client had CodePush.RollbackPolicy settings.

### Current State (2026)

- **App Center is shut down.** The cloud service no longer exists.
- 
eact-native-code-push npm package is **orphaned** - will fail at runtime with network errors.
- Open issues include "Is this library dying?" (April 2025).
- **Do not use CodePush for any project in 2026.**

### Migration Paths

| From CodePush | To | Notes |
|---------------|-----|-------|
| React Native | **Expo Updates** | Best drop-in replacement. Same OTA JS bundle model. |
| Cordova/Capacitor | **Capgo** | Supports JS/HTML/CSS OTA. |

---

## 10. Expo Updates (EAS Update / expo-updates)

**Repo**: expo/expo (monorepo; packages/expo-updates)
**Latest SDK**: 58.0.32 (2026-11-03)
**Docs**: https://docs.expo.dev/deploy/send-over-the-air-updates
**Maintenance**: **Very active**. Expo is the official React Native framework.

### Protocol and Manifest Format

Expo Update uses a **cloud API** (Expo Update service):

1. eas update:configure sets up the project.
2. eas update --channel production publishes an update.
3. App's expo-updates module polls the Expo Update API.
4. Server returns manifest with new bundle and metadata.

`json
{
  "launchAsset": { "hash": "sha256:...", "url": "https://updates.expo.dev/bundles/..." },
  "releaseId": "abc-123",
  "branch": "production",
  "channel": "production",
  "version": "1.2.0",
  "runtimeVersion": { "policy": "sdkVersion" }
}
`

### Runtime Versions


untimeVersion ensures bundle compatibility with the native app. Policies: sdkVersion (default), 
ativeVersion, ree.

### Channels and Branches

- **Channels**: Named groups (production, staging, dev). Defined in eas.json.
- **Branches**: Git-like branches. Each channel points to a branch.

### Rollouts

**Per-update**: eas update --rollout-percentage=10, then eas update:edit to increase.
**Branch-based**: eas channel:rollout - interactive guide to select channel, branch, percentage.

### Rollbacks

`
eas update:rollback              # previous update on branch
eas update:roll-back-to-embedded # bundle in the native build
`

### Bundle Diffs

Expo Update supports **bundle diffing** - only changed parts of the JS bundle are downloaded.

### Signing

- **Code signing** (opt-in): Updates signed with a code signing key. Public key in native app.
- Without code signing: HTTPS + hash verification.

### Install Timing

- Downloaded in background. Applied on **next cold start**.
- Updates.checkForUpdate() triggers the check.

### Known Limitations

- Only updates JS/HTML/CSS/JSB. Native code requires new store build.
- Requires Expo project. Cloud dependency. No native code delta updates.

### Migration Guide

- **From CodePush**: 
px expo install expo-updates, run eas update:configure, replace CodePush.sync() with Updates.checkForUpdate().

---

## 11. React Native code-push (microsoft/react-native-code-push)

**Latest release**: v9.0.1 (2024-12-19)
**Maintenance**: **DEAD / ORPHANED**. No releases since Dec 2024. App Center backend shut down in 2025.

### Current State

- **Do not use.** The backend is gone. Package will fail at runtime.
- No community fork has taken over the backend.

### Alternatives

| Alternative | Best For |
|-------------|----------|
| **Expo Updates** | React Native apps. Most complete replacement. |
| **Capgo** | Capacitor apps (also works with React Native via Capacitor). |
| **Custom OTA** | Self-hosted bundle diff server. |

---

## 12. PWA Service Worker Update Lifecycle

**Spec**: W3C Service Worker Specification (https://www.w3.org/TR/service-worker/)
**MDN**: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
**web.dev**: https://web.dev/learn/pwa/service-workers/
**Maintenance**: **Platform-native**. Governed by W3C/WHATWG.

### Protocol and Manifest Format

There is **no manifest file**. The update protocol:

1. Browser fetches the SW script on each navigation (or at browser-defined interval).
2. If response is **byte-different** from cached copy, browser installs new version.
3. New SW enters waiting state. Old SW continues controlling existing clients.
4. New SW activates only after all old SW clients are closed.

`javascript
// serviceworker.js
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("v2").then((cache) => cache.addAll(["/", "/app.js", "/styles.css"]))
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== "v2").map((k) => caches.delete(k)))
    )
  );
});
self.addEventListener("fetch", (event) => {
  event.respondWith(caches.match(event.request).then((c) => c || fetch(event.request)));
});
`

### Signing

- **TLS** (HTTPS mandatory). **CSP** can restrict SW scripts.
- No cryptographic signature on SW script. Browser verifies origin matches registration.

### Channel Model

**Not applicable.** All-or-nothing per origin. Use cache versioning and cache busting for versioned deployments.

### Install Timing

- SW updates silently in background on next navigation or browser-defined poll interval (~24h).
- New SW does not take control until old SW clients all closed.
- skipWaiting(): Forces new SW to activate immediately.
- clients.claim(): New SW immediately takes control of all existing clients.

### skipWaiting + clients.claim Races

`javascript
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
`

**Race conditions**: If skipWaiting() is called but old SW is still handling a fetch, old SW completes it first. clients.claim() orphans in-flight requests from old SW.

**Workbox BroadcastUpdatePlugin** mitigates by broadcasting a message to all clients when a new SW is waiting, allowing the app to prompt user to reload:

`javascript
import { BroadcastUpdatePlugin } from 'workbox-background-sync';
const plugin = new BroadcastUpdatePlugin({ messageData: { type: 'SW_UPDATED' }, typeOfMessage: 'message' });
`

### Rollback

**No built-in rollback.** Deploy previous SW version. Browser detects byte difference, installs old version. User must close all tabs. Cache cleanup is critical.

### Known Limitations

- No delta updates. No percentage-based rollouts. No staged deployment.
- Safari has historically had the most SW bugs.
- SW updates invisible to user without explicit UI prompt.
- Old SW fetch handler continues until all its clients close.

### For AIRIZ PWA Surface

- Use **cache versioning** with manifest hash.
- Use **Workbox BroadcastUpdatePlugin** for update notification.
- Use skipWaiting() + clients.claim() for immediate updates.
- Rollback = deploy previous SW + cache cleanup.

---

## 13. Cloudflare Workers

**Docs**: https://developers.cloudflare.com/workers/
**Wrangler**: https://github.com/cloudflare/wrangler
**Maintenance**: **Platform-native**. Core Cloudflare product with continuous updates.

### Protocol and Manifest Format

Cloudflare Workers uses a **version-based deployment model** - no client-side manifest:

1. wrangler versions upload - upload new version (not deployed yet).
2. wrangler versions deploy - create deployment (traffic routing).
3. Deployment can be single version (100%) or **gradual deployment** (split traffic).

`ash
npx wrangler versions upload       # upload, not deploy
npx wrangler versions deploy       # interactive: select versions + percentages
npx wrangler rollback <id>         # roll back
`

### Gradual Deployments (Staged Rollout)

`
Deployment:
  Version A (uuid-123): 90% traffic
  Version B (uuid-456): 10% traffic
`

- Each request independently routed based on percentages.
- **Version affinity**: Optionally pin user to consistent version via cookie.
- **Version overrides**: Test specific version via special header.
- **Durable Objects**: One version per DO instance; special version assignment rules.

### Signing / Authentication

- **Wrangler CLI**: Cloudflare API token (JWT). No cryptographic signature on code.
- **Workers Builds** (CI/CD): GitHub App or GitLab integration.
- **No client-side signature verification** - update is server-side.

### Channel Model

- **Previews**: Isolated copies for branch/PR testing. Own URL per preview.
- **Wrangler environments**: wrangler deploy --env staging.
- **Version URLs**: <version-id>.<worker>.workers.dev for testing.

### Rollback

`ash
npx wrangler rollback <version-id>
`

- Roll back to **100 most recently published versions**.
- From split deployment: replaces both versions with selected version at 100%.
- **Fails** if Durable Object class lifecycle changes or deleted bindings exist between versions.

### Install Timing

**Instant.** Deployment takes effect across Cloudflare global network (< 1 second propagation). No client-side install step.

### Known Limitations

- Server-side only. Version skew in gradual deployments. DOs complicate gradual deploys. 100-version rollback limit. No delta updates. Bindings must be compatible for rollback.

### For AIRIZ Worker Surface

- Use wrangler versions upload + deploy for all releases.
- Use gradual deployments (10% -> 50% -> 100%) for risky changes.
- Use wrangler rollback for instant rollback.
- No client-side manifest needed.

---

## 14. Apple App Store / Google Play Store Update Model

### Apple App Store

**Docs**: https://developer.apple.com/app-store-connect/
**API**: App Store Connect API (REST)

#### Update Flow

1. Upload .ipa via Xcode or Transporter.
2. App Review: **24-48 hours** fast lane, up to several days.
3. Auto-release or manual release.
4. **Phased release**: 7-day phased rollout (Apple-controlled, not developer-configurable per day).
5. Users see update in App Store. SKStoreProductViewController for in-app prompt.

#### Staged Rollout

- "Phase in your updates over 7 days" in App Store Connect.
- Apple's algorithm controls percentage per day.
- **Cannot be interrupted** once started.
- **No client-side API to control rollout.**

#### In-App Update API (iOS)

- SKStoreProductViewController: Shows App Store product page in-app. No silent update.
- **No silent in-app update API** on iOS.

#### Rollback

- **No client-side rollback.** Apple does not support rolling back a released version.
- Can **remove** a version (stops being offered to new users).
- Release a **new version** that fixes the broken one (requires App Review).
- **TestFlight**: Distribute fix to subset before full release.

### Google Play Store

**Docs**: https://developer.android.com/distribute
**API**: Google Play Developer API (REST)

#### Update Flow

1. Upload .aab or .apk via Play Console or Fastlane.
2. Automated review (Play Protect) + optional manual review.
3. **Staged rollout**: Developer selects 1%, 5%, 10%, 20%, 50%, 100%.
4. Users receive update via Google Play services.

#### Staged Rollout

- Developer-controlled: 1% -> 5% -> 10% -> 20% -> 50% -> 100%.
- Can **pause** at any time.
- Can **stop** and roll back to previous version (30-day window).

#### In-App Update API (Android)

- **AppUpdateManager** (Play Core library):
  - FLEXIBLE: User updates at convenience. Background download + notification.
  - IMMEDIATE: Mandatory. Full-screen activity. User cannot use app until complete.

`kotlin
val appUpdateManager = AppUpdateManagerFactory.create(context)
appUpdateManager.appUpdateInfo.addOnSuccessListener { info ->
    if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) {
        if (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
            appUpdateManager.startUpdateFlowForResult(
                info, AppUpdateType.IMMEDIATE, activity, REQUEST_CODE)
        } else {
            appUpdateManager.startUpdateFlow(info, AppUpdateType.FLEXIBLE)
        }
    }
}
`

#### Rollback

- Play Console: "Roll back to previous version" (30-day window).
- No client-side rollback API.

### Comparison: Apple vs Google

| Feature | Apple App Store | Google Play Store |
|---------|----------------|-------------------|
| Review latency | 24h - 5 days | Minutes - 48h |
| Staged rollout | 7-day (Apple-controlled) | Developer-controlled % |
| Pause rollout | No | Yes |
| Rollback | No (remove version) | Yes (30-day window) |
| In-app update API | SKStoreProductViewController (no silent) | AppUpdateManager (flexible + immediate) |
| OTA JS/JS bundle | Allowed (3.3.2) | Allowed (VM exception) |
| Silent background update | No | Yes (FLEXIBLE) |

### For AIRIZ

- **Capacitor iOS**: Capgo/Expo for OTA JS. Native changes require App Store (24h-5d latency).
- **Capacitor Android**: Capgo/Expo for OTA JS. Native: Play Console staged rollout + AppUpdateManager.
- **Unified strategy**: OTA (JS/HTML/CSS) via Capgo/Expo. Native via store mechanisms. Track both independently.

---

## Synthesis: Unified Release Architecture Candidates for AIRIZ

### Surface-to-Tool Mapping

| AIRIZ Surface | Primary Tool | Fallback / Complementary |
|---------------|-------------|--------------------------|
| Electron Windows | **electron-updater** (NSIS target) | WinSparkle (if appcast needed) |
| Capacitor Android | **Capgo** (OTA JS) + Play Store (native) | Expo Updates |
| Capacitor iOS | **Capgo** (OTA JS) + App Store (native) | Expo Updates |
| PWA Web | **Service Worker** (native browser) | Workbox for caching |
| Cloudflare Worker | **Wrangler** (versions + gradual deploy) | Workers Builds (CI/CD) |

### Key Design Decisions

1. **Manifest format**: Unified JSON manifest that maps to each tools native format. Generate electron-updater latest.yml, Tauri static JSON, and Capgo API response from one source-of-truth JSON.

2. **Signing**: **Ed25519** is the common denominator (Tauri, Sparkle, WinSparkle, electron-updater v27). Single Ed25519 keypair for all surfaces. Authenticode separate for Windows installers.

3. **Channel model**: Implement channels at the **unified manifest layer**, not in each tool. Unified manifest server routes to correct tool-specific manifest based on requesting surface.

4. **Rollback**: Unified layer tracks **last known good version** per surface. Rollback = republish last known good manifest. Cloudflare: wrangler rollback. Stores: store rollback APIs.

5. **Install timing**: Standardize on **"next launch"** semantics. Electron: onNextLaunch. Capacitor: background download + cold start. PWA: skipWaiting + clients.claim. Cloudflare: instant.

6. **Staged rollouts**: Only electron-updater, Sparkle, Expo Update, and Cloudflare natively support percentage-based rollouts. For others, implement percentage routing at the **manifest server** level.

7. **Delta updates**: Only electron-updater (blockmap), Sparkle (BinaryDelta), Expo Update (bundle diffs) support deltas. Treat as **optimization**, not requirement. Full downloads are the safe default.

8. **CodePush is dead.** Any existing CodePush integration must be migrated to Capgo or Expo Updates.

---

## Source Index

| Source | URL | Fetched |
|--------|-----|---------|
| electron-builder auto-update docs | https://www.electron.build/docs/features/auto-update | 2026-11-05 |
| Squirrel.Windows repo | https://github.com/Squirrel/Squirrel.Windows | 2026-11-05 |
| Squirrel.Mac releases | gh release list | 2026-11-05 |
| Sparkle documentation | https://sparkle-project.org/documentation/ | 2026-11-05 |
| Sparkle publishing guide | https://sparkle-project.org/documentation/publishing/ | 2026-11-05 |
| WinSparkle repo | https://github.com/vslavik/winsparkle | 2026-11-05 |
| Tauri updater docs | https://v2.tauri.app/plugin/updater/ | 2026-11-05 |
| Capgo docs | https://capgo.app/docs | 2026-11-05 |
| Expo Update docs | https://docs.expo.dev/deploy/send-over-the-air-updates.md | 2026-11-05 |
| Expo Update rollouts | https://docs.expo.dev/eas-update/rollouts.md | 2026-11-05 |
| Cloudflare Workers rollbacks | https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/ | 2026-11-05 |
| Cloudflare gradual deploys | https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/ | 2026-11-05 |
| PWA Service Workers | https://web.dev/learn/pwa/service-workers/ | 2026-11-05 |
| App Store Connect | https://developer.apple.com/app-store-connect/ | 2026-11-05 |
| react-native-code-push | gh release list | 2026-11-05 |
| electron-builder releases | gh release list | 2026-11-05 |
| Sparkle releases | gh release list | 2026-11-05 |
| Tauri releases | gh release list | 2026-11-05 |
| WinSparkle releases | gh release list | 2026-11-05 |
| Squirrel.Windows releases | gh release list | 2026-11-05 |
| Capacitor releases | gh release list | 2026-11-05 |
| Expo releases | gh release list | 2026-11-05 |