# AIRIZ Motor Console — Cross-Platform Auto-Update Protocol Catalog

> **Owner:** Juwen Lie, Team Ziris PTB
> **Scope:** Full protocol surface reference for every major auto-update engine relevant to the AIRIZ Motor Console (Windows desktop + Android + iOS + Web PWA + Cloudflare Worker).
> **Status:** Research complete 2026-11-05. All data verified against current repo state and official docs.

---

## Table of Contents

1. Squirrel.Windows
2. Squirrel.Mac
3. Sparkle
4. WinSparkle
5. MSIX AppInstaller (Microsoft.AutoUpdater)
6. Tauri Updater (@tauri-apps/plugin-updater)
7. Capacitor Live Update (Official - Deprecated)
8. Capgo Live Update (@capgo/capacitor-updater)
9. CodePush (App Center - Deprecated)
10. Expo Updates (expo-updates)
11. Sentry Releases
12. Flutter Update Patterns
13. .NET MAUI Deployment
14. Uno Platform
15. react-native-code-push (Deprecated)
16. PWA Service Worker Lifecycle
17. Chrome Component Updater (OMA-DM)

---

## 1. Squirrel.Windows

**Repo:** https://github.com/Squirrel/Squirrel.Windows
**Current Major Version:** 2.x (latest: 2.4.1, 2019)
**Status:** Semi-maintained (issue #1470 calls for new maintainers)
**License:** MIT

### Manifest Format — RELEASES File

Plain-text, one entry per line, newest-first:

\\\
<SHA1_HASH> <filename> <file_size_bytes>[# <percentage>%]
\\\

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| SHA1 | 40-char hex | Yes | Hash of the .nupkg file |
| filename | string | Yes | e.g. myapp-1.0.1-delta.nupkg or myapp-1.0.1-full.nupkg |
| file_size | integer bytes | Yes | Exact file size |
| # nn% | comment | No | Staged rollout % (Squirrel >= 1.4.0). Must attach directly to size (no space before #) |

Example:
\\\
e3f67244e4166a65310c816221a12685c83f8e6f myapp-1.0.0-full.nupkg 600725
0d777ea94c612e8bf1ea7379164caefba6e24463 myapp-1.0.1-delta.nupkg 6030# 10%
85f4d657f8424dd437d1b33cc4511ea7ad86b1a7 myapp-1.0.1-full.nupkg 600752# 10%
\\\

**Delta vs Full:**
- -delta.nupkg: bsdiff .diff files + .shasum files. Applied on top of previous full.
- -full.nupkg: Complete payload. Used when no delta chain or delta > full.

**Delta .shasum format** (per DLL/EXE inside delta nupkg):
\\\
<expected_SHA1> <expected_filesize>
\\\

### NuGet Package Schema (nuspec)

| Field | Purpose |
|-------|---------|
| <version> | SemVer, becomes app version directory name |
| <id> | Application identifier |
| <releaseNotes> | Shown to user on update |
| Files under lib/ | Application binaries |

### Update.exe CLI Flags (Squirrel --releasify)

\\\
-r, --releaseDir=VALUE     Path to release directory
-p, --packagesDir=VALUE    NuGet Packages directory
    --bootstrapperExe=     Setup.exe template
-g, --loadingGif=VALUE     Animated GIF for install screen
-n, --signWithParams=VALUE SignTool.exe parameters
    --setupIcon=VALUE      ICO for Setup.exe
-b, --baseUrl=VALUE        Base URL prefix for RELEASES
    --no-msi               Skip MSI generation
    --msi-win64            Mark MSI as 64-bit
    --no-delta             Skip delta packages
    --framework-version=   Required .NET framework (e.g. net461)
\\\

### Signing Flow

1. Acquire Windows code-signing cert (WER-compatible recommended)
2. Squirrel --releasify MyApp.1.0.0.nupkg -n "/a /f Cert.pfx /p Pass /fd sha256 /tr http://timestamp.digicert.com /td sha256"
3. Signs ALL app executables + Setup.exe
4. No cryptographic signing of RELEASES file (trust via HTTPS + code signing)

### Channel / Staged Rollout

- **Channels:** Separate RELEASES files per channel (/stable/RELEASES, /beta/RELEASES)
- **Staged rollouts (>= 1.4.0):** Append # nn% to size field. Client uses local random number.
- **Ramp up:** Edit RELEASES to increase % -> upload -> clients pick up next check
- **Full release:** Remove # nn% comment

### Cache / Atomic Swap

- **Install:** %LocalAppData%\<AppName>\app-<version>\ (versioned dirs)
- **Atomic:** New version extracted to new dir -> shortcuts updated -> old cleaned next startup
- **Cleanup:** Keeps current + previous version only
- **Staging:** .nupkg cached locally before extraction

### App-Quit / Reload Timing

- Background update by Update.exe helper process
- App notified via --processStart
- Restart with new version on next launch
- No UAC elevation (per-user install)

### Rollback Mechanics

- **No built-in rollback** (explicitly stated in docs)
- Workaround: Remove bad entry from RELEASES, release version HIGHER than broken one

### Known Limitations

| Issue | Ref |
|-------|-----|
| No rollback | docs: update-process.md |
| SHA1 only (not SHA-256) | RELEASES format |
| No manifest signing (HTTPS + code sig only) | Architecture |
| Maintenance mode | Issue #1470 |
| Staged rollout syntax bug (no space before #) | docs |
| bsdiff deltas (less efficient) | docs |
| 367 open issues | Repo |

**Status: Active but semi-maintained. Last release 2019. Not recommended for new projects.**

---

## 2. Squirrel.Mac

**Repo:** https://github.com/Squirrel/Squirrel.Mac
**Current Major Version:** 1.x (main branch, 1067 commits)
**Status:** Maintenance mode. Originally built for Electron.
**License:** BSD 3-Clause

### Architecture

- Objective-C/Cocoa framework (builds with GN + Ninja via Chromium //build)
- **ShipIt:** Helper app in Squirrel.framework Resources performs install on quit
- **Deps:** ReactiveObjC, Mantle, Sparkle BinaryDelta sources (pinned 2.9.5)

### Manifest Format — Dynamic Server JSON

NOT a static manifest. Server responds dynamically to client request.

**Response 200 (update available):**
\\\json
{
  "url": "https://example.com/myapp/releases/myrelease",
  "name": "My Release Name",
  "notes": "Release notes",
  "pub_date": "2013-09-18T12:29:53+01:00",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "size": 104857600,
  "delta": {
    "from_version": "412",
    "url": "https://example.com/412-to-myrelease.delta",
    "sha256": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752",
    "size": 7340032
  }
}
\\\

| Field | Required | Notes |
|-------|----------|-------|
| url | Yes | Direct URL to .zip update |
| name | No | Display name |
| notes | No | Release notes |
| pub_date | No | ISO 8601 |
| sha256 | No | 64-hex integrity of ZIP |
| size | No | Expected bytes |
| delta | No | BinaryDelta (Sparkle format 3 or 4) |
| delta.from_version | if delta | CFBundleVersion patch applies to |

**Response 204:** No update available.

**Static File Format** (for S3/CDN, Electron opt-in via serverType: 'json'):
\\\json
{
  "currentRelease": "1.2.3",
  "releases": [{
    "version": "1.2.3",
    "updateTo": { "version": "1.2.3", "url": "...zip", "sha256": "...", "size": 123 }
  }]
}
\\\

### ZIP Structure

- Complete .app bundle at ZIP root
- Accept: application/zip during download
- ShipIt extracts and replaces running app bundle

### Signing / Verification

- macOS code signature verification of installed bundle
- SHA-256 integrity of downloaded ZIP (if field present)
- Delta: applied patch passes same code signing as unpacked ZIP
- **No EdDSA/DSA** — relies on HTTPS + code signing

### Channel / Staged Rollout

- **Server-driven entirely** — server returns 200 or 204 based on request params
- No built-in channel/percentage mechanism
- Phased rollouts via server logic (headers, params, user identification)

### Cache / Atomic Swap

- Download: temp dir, streamed with resume (ETag/Range)
- Install: ShipIt extracts ZIP, atomically replaces .app bundle
- Fault tolerant: failed install leaves previous bundle intact
- Delta: applied to copy; must pass code signing or falls back to ZIP

### App-Quit / Reload Timing

- **Updates installed on app termination** (ShipIt runs after main app exits)
- relaunchToInstallUpdate signal for immediate install+relaunch
- startAutomaticChecksWithInterval: for periodic checks

### Rollback Mechanics

- **Server-driven:** Stop serving bad version, serve previous one
- No client-side rollback

### Known Limitations

| Issue | Ref |
|-------|-----|
| No built-in channel mechanism | Architecture |
| No crypto manifest signing | Security model |
| ZIP only | README |
| Requires server support | README |
| NFD filename issues with delta (non-ASCII) | README |
| 25 open issues | Repo |

**Status: Maintenance mode. Functional but no new features. Sparkle 2.x recommended for native macOS.**

---

## 3. Sparkle

**Repo:** https://github.com/sparkle-project/Sparkle
**Current Major Version:** 2.10.1 (2.x branch, 4389 commits)
**Website:** https://sparkle-project.org
**Status:** Active — regular releases, active development
**License:** Custom permissive
**Runtime:** macOS 12.0+ (2.10.x), macOS 10.13+ (2.9.6)

### Manifest Format — Appcast XML

RSS 2.0 with Sparkle namespace (http://www.andymatuschak.org/xml-namespaces/sparkle):

\\\xml
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <title>Version 1.2.3</title>
      <pubDate>Mon, 02 Jun 2025 12:00:00 +0000</pubDate>
      <sparkle:releaseNotesLink>https://example.com/notes.html</sparkle:releaseNotesLink>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <sparkle:version>42</sparkle:version>
      <sparkle:shortVersionString>1.2.3</sparkle:shortVersionString>
      <sparkle:minimumAutoupdateVersion>1.0.0</sparkle:minimumAutoupdateVersion>
      <sparkle:channel>beta</sparkle:channel>
      <sparkle:criticalUpdate>true</sparkle:criticalUpdate>
      <sparkle:informationalUpdate>false</sparkle:informationalUpdate>
      <sparkle:releaseType>software</sparkle:releaseType>
      <sparkle:hardwareRequirements>
        <sparkle:hardwareRequirement>arm64</sparkle:hardwareRequirement>
      </sparkle:hardwareRequirements>
      <enclosure url="https://example.com/MyApp-1.2.3.zip"
                 sparkle:version="42"
                 sparkle:shortVersionString="1.2.3"
                 sparkle:os="macos"
                 sparkle:osVersion="12.0"
                 sparkle:edSignature="BASE64_SIG"
                 sparkle:delta="https://example.com/delta"
                 sparkle:installationType="default"
                 length="104857600"
                 type="application/octet-stream"/>
    </item>
  </channel>
</rss>
\\\

**Key Elements:**

| Element/Attr | Location | Purpose |
|---|---|---|
| sparkle:version | item/enclosure | CFBundleVersion (primary comparison) |
| sparkle:shortVersionString | item/enclosure | Marketing version |
| sparkle:minimumSystemVersion | item | Min macOS version |
| sparkle:minimumAutoupdateVersion | item | Min version for auto-update (skip majors) |
| sparkle:minimumUpdateVersion | item | (2.9.0+) Min version before upgrading |
| sparkle:channel | item | Channel marker (beta, stable) |
| sparkle:criticalUpdate | item | Forces immediate attention |
| sparkle:informationalUpdate | item | Notification only |
| sparkle:releaseNotesLink | item | URL to notes (HTML/Markdown) |
| sparkle:fullReleaseNotesLink | item | Full changelog URL |
| sparkle:hardwareRequirements | item | (2.9.0+) e.g. arm64 |
| sparkle:edSignature | enclosure | EdDSA Ed25519 signature (base64) |
| sparkle:delta | enclosure | URL to binary delta |
| sparkle:installationType | enclosure | default/package/bare |
| sparkle:os / sparkle:osVersion | enclosure | Target OS + min version |

**Feed signing (2.9.0+):** Entire appcast XML can be EdDSA-signed.

### Signing / Verification Flow

1. generate_keys creates Ed25519 keypair
2. Public key in Info.plist as SUPublicEDKey
3. sign_update / generate_appcast signs ZIP -> base64 sig in sparkle:edSignature
4. Client verifies sig against embedded pubkey BEFORE extraction
5. Apple code signature check on update bundle
6. Feed signing (2.9.0+): optional appcast XML signature
7. DSA deprecated; EdDSA-only for new updates (2.3.0+)

### Channel / Staged Rollout

**Channels:**
- sparkle:channel in appcast item
- Client configured with allowedChannels
- Items without channel visible to all
- Default channel must be in allowed set

**Phased Rollouts (1.22.0+):**
- Automatic progressive enablement to % of users
- Local random seed determines cohort (sticky per user+version)
- Server: sparkle:phasedRollout percentage or generate_appcast auto

**Critical Updates:**
- sparkle:criticalUpdate=true bypasses auto-update cycle, immediate alert

### Cache / Atomic Swap

- **Download:** ~/Library/Caches/<AppName>/Sparkle/
- **Atomic install (APFS):** clonefile for fast atomic bundle replacement
- **Installer (2.x):** launchd agent/daemon + XPC communication
  - Privilege separation: Downloader (XPC) -> Updater (framework) -> Installer (launchd)
- **Delta:** BinaryDelta format 3 (2.1.0+) or format 4 (2.7.0+)
  - Format 4: custom container, lzma/lz4/zlib/lzfse, rename tracking
  - Applied to copy; must pass code signing

### App-Quit / Reload Timing

- User-initiated: Install and Relaunch -> quit -> installer -> relaunch
- Automatic: background download, install on next quit (or immediate if auth available)
- Focus-aware (2.2.0+): alerts at opportune times (launch, re-activation, idle)
- Gentle reminders API (2.2.0+)
- Authorization before installer launch and app termination (cancelable)

### Rollback Mechanics

- No built-in client-side rollback
- Server-side: remove/replace bad appcast item
- Skip mechanism: user can skip version (stored locally)
- Major version skip via sparkle:minimumAutoupdateVersion

### Known Limitations

| Issue | Ref |
|-------|-----|
| macOS 12.0+ for 2.10.x | CHANGELOG 2.10.0 |
| macOS only | Architecture |
| Appcast XML (legacy format) | Design |
| CocoaPods removed in 2.10.0 | CHANGELOG |
| Delta requires byte-identical source | BinaryDelta docs |
| DSA deprecated | CHANGELOG 2.3.0 |
| 10 open issues | Repo |

**Status: Fully active. Regular releases. Used by major macOS apps. SPM + Carthage.**

---

## 4. WinSparkle

**Repo:** https://github.com/vslavik/winsparkle
**Current Major Version:** 0.8.x (master, 659 commits)
**Website:** https://winsparkle.org
**Status:** Active
**License:** MIT
**Runtime:** Windows x86/x64/ARM64

### Architecture

- C/C++ library (win-sparkle.dll) with C API
- Companion tool: winsparkle-tool (key gen + signing)
- Same appcast format as Sparkle
- Bindings: C#/.NET, Python (pywinsparkle), Go, Pascal

### Manifest Format — Appcast XML

**Identical to Sparkle** (see section 3). Uses sparkle: namespace, same elements/attributes.
- sparkle:edSignature for EdDSA
- Legacy DSA still supported but deprecated

### Signing / Verification Flow

1. winsparkle-tool generate-key --file private.key
   Output: Private key saved + Public key: pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=
2. Public key in Windows resource: EdDSAPub EDDSA {"..."} or win_sparkle_set_eddsa_public_key()
3. winsparkle-tool sign --private-key-file private.key Updater.exe
   Output: sparkle:edSignature="BASE64"
4. Client verifies against embedded pubkey
5. DSA deprecated; migration guide available

### C API (key functions)

\\\c
void win_sparkle_set_update_sequence(void);
void win_sparkle_set_eddsa_public_key(const char *key);
void win_sparkle_check_for_updates(int is_automatic);
int win_sparkle_get_update_state(void);
void win_sparkle_set_callbacks(update_available_cb, download_progress_cb, update_error_cb, void *user_data);
\\\

### Channel / Staged Rollout

- Same as Sparkle: sparkle:channel + client-side filtering
- No built-in phased rollout
- Server controls visibility via different appcasts

### Cache / Atomic Swap

- Download: ZIP to temp location
- Install: Extract and replace app files
- No APFS-style atomic clone (Windows FS)
- Self-update capable (can update the DLL itself)

### App-Quit / Reload Timing

- User-initiated: UI prompt -> confirm -> restart
- Automatic: win_sparkle_check_for_updates(1)
- States: CHECKING, DOWNLOADING, AVAILABLE, INSTALLING

### Rollback Mechanics

- Server-side: remove bad appcast entry
- No client-side rollback

### Known Limitations

| Issue | Ref |
|-------|-----|
| No phased rollout | Feature gap vs Sparkle 2.x |
| No delta updates (full ZIP only) | Architecture |
| 17 open issues | Repo |
| DSA deprecated | README |

**Status: Active. C API stable. NuGet package available.**

---

## 5. MSIX AppInstaller (Microsoft.AutoUpdater)

**Repo:** N/A (Windows platform feature)
**Related:** https://github.com/microsoft/winget-cli (implementation)
**Current Version:** Windows 10 17763+ (RS5) through Windows 11
**Status:** Active — built into Windows, continuously updated
**Namespace:** Windows.PackageManagement (WinRT), Microsoft.Management.Deployment

### Manifest Format — AppInstallerFile (XML)

\\\xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
    Version="1.0"
    Name="MyApplication"
    Publisher="CN=MyCompany, O=MyOrg, L=City, S=State, C=US"
    IdentityName="MyCompany.MyApplication"
    PublisherDisplayName="MyCompany"
    Architecture="x64"
    Uri="https://example.com/updates/MyApp.msixbundle"
    Version="1.2.3.0"
    InstallLocation="C:\\Program Files\\MyApp">
  <Dependencies>
    <Dependency Name="Microsoft.VCLibs.140.00" MinVersion="14.0.30723.0"/>
  </Dependencies>
  <Installation>
    <UpdateSettings
        FrequencyInDays="1"
        IntervalInHours="4"
        MaxDeferralInDays="30"
        MaxDeferralPasses="2"/>
    <UpdateMode Auto>
      <UpdateTrigger UserInitiated/>
      <UpdateTrigger OnApplicationRun/>
    </UpdateMode>
    <RepairSettings>
      <RepairTrigger OnUserRequest/>
      <RepairTrigger OnIntegrityCheckFailure/>
      <RepairThreshold MinimumConsecutiveFailures="3"/>
    </RepairSettings>
    <NetworkRequirement MinimumCPS="100000" MaximumCPS="0"/>
    <Logging ConsentLevel="Notify"/>
  </Installation>
</AppInstaller>
\\\

**Key Elements:**

| Element/Attr | Purpose |
|---|---|
| Name | App display name |
| Publisher | X.509 DN of signing cert |
| IdentityName | Package family name |
| Architecture | x86/x64/arm64/neutral |
| Uri | URL to .msix or .msixbundle |
| Version | 4-part: major.minor.build.revision |
| InstallLocation | Target directory |
| Dependencies | Required MSIX frameworks |
| UpdateSettings.FrequencyInDays | Check frequency (default 1) |
| UpdateSettings.IntervalInHours | Min hours between checks (default 4) |
| UpdateSettings.MaxDeferralInDays | Max user deferral days |
| UpdateSettings.MaxDeferralPasses | Max deferral prompts |
| UpdateMode | Auto or Manual |
| UpdateTrigger | UserInitiated / OnApplicationRun / WindowContentInstalledOnDemand |
| RepairSettings | Auto-repair config |
| RepairTrigger | OnUserRequest / OnIntegrityCheckFailure |
| RepairThreshold | Min consecutive failures to trigger |
| NetworkRequirement | Min/Max network speed |

**MSBuild Properties:**
\\\xml
<GenerateAppInstallerFile>True</GenerateAppInstallerFile>
<AppInstallerUri>https://example.com/updates/</AppInstallerUri>
<AppInstallerUpdateFrequency>1</AppInstallerUpdateFrequency>
<AppInstallerCheckForUpdateFrequency>OnApplicationRun</AppInstallerCheckForUpdateFrequency>
\\\

### Signing / Verification

1. MSIX package: Authenticode code signing (EV or OV cert)
2. AppInstallerFile: NOT signed (trust via HTTPS)
3. Windows verifies: code sig validity, publisher match, version newer, deps satisfied
4. API: Windows.PackageManagement.PackageManager (WinRT)

### Channel / Staged Rollout

- No built-in channel system
- Server-driven: different AppInstallerFile URLs per group
- Deferral: MaxDeferralInDays + MaxDeferralPasses for time-based control
- Manual mode: explicit user action required
- Enterprise: Group Policy / OMA-DM for staged rollout

### Cache / Atomic Swap

- **MSIX transaction model:** staged -> atomic registration -> rollback on failure
- **Update:** New version installed alongside old -> atomic switch -> old unregistered
- **Repair:** OnIntegrityCheckFailure triggers auto re-registration
- **Compression:** Per-file LZMA in MSIX

### App-Quit / Reload Timing

- Auto mode: Windows handles restart/relaunch
- Manual: Settings -> Apps
- OnApplicationRun: check each launch
- Deferral: user can defer up to MaxDeferralInDays x MaxDeferralPasses
- In-place: Windows may wait for app to close or force-close

### Rollback Mechanics

- **Built-in:** MSIX install is transactional — failed installs auto-rollback
- **Repair:** OnIntegrityCheckFailure auto-repairs
- **Manual:** Uninstall + reinstall previous
- **Previous versions retained** until cleaned up

### Known Limitations

| Issue | Ref |
|-------|-----|
| Windows only | Platform |
| Requires MSIX/MSIXBundle | Format |
| No delta updates | Architecture |
| AppInstallerFile not signed | Security |
| 4-part versioning (not SemVer) | Versioning |
| No channel/percentage rollout | Feature gap |

**Status: Fully active. Platform-blessed Windows update mechanism.**

---

## 6. Tauri Updater (@tauri-apps/plugin-updater)

**Repo:** https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater
**Docs:** https://tauri.app/plugin/updater/
**Current Major Version:** Tauri 2.x (plugin v2, Rust >= 1.90)
**Status:** Active — core Tauri 2.x plugin
**License:** MIT / Apache-2.0
**Platforms:** Windows, Linux, macOS (full); Android, iOS (limited)

### Manifest Format — JSON

**Static JSON file** (S3, GitHub Releases, CDN):
\\\json
{
  "version": "1.2.3",
  "notes": "Release notes",
  "pub_date": "2025-06-01T12:00:00Z",
  "platforms": {
    "linux-x86_64": { "signature": "B64SIG", "url": "https://.../myapp.AppImage" },
    "windows-x86_64": { "signature": "B64SIG", "url": "https://.../myapp-setup.exe" },
    "darwin-x86_64": { "signature": "B64SIG", "url": "https://.../myapp.app.tar.gz" },
    "darwin-aarch64": { "signature": "B64SIG", "url": "https://.../myapp.app.tar.gz" }
  }
}
\\\

**Dynamic server response** (200 = update, 204 = none):
\\\json
{ "version": "1.2.3", "pub_date": "...", "url": "https://...", "signature": "B64SIG", "notes": "..." }
\\\

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| version | SemVer | Yes | With/without leading v |
| notes | string | No | Release notes |
| pub_date | RFC 3339 | No | Date |
| url | URL | Yes (dynamic) | Bundle URL |
| signature | base64 | Yes | .sig file content |
| platforms | object | Yes (static) | Keyed OS-ARCH |

**Platform keys:** linux-x86_64, linux-aarch64, linux-armv7, linux-i686, windows-x86_64, windows-i686, darwin-x86_64, darwin-aarch64

**URL variables:** {{current_version}}, {{target}} (linux/windows/darwin), {{arch}} (x86_64/i686/aarch64/armv7)

### tauri.conf.json Schema

\\\json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBrZXkK...",
      "endpoints": ["https://releases.myapp.com/{{target}}/{{arch}}/{{current_version}}"],
      "dangerousInsecureTransportProtocol": false,
      "windows": { "installMode": "passive" }
    }
  }
}
\\\

| Key | Type | Notes |
|-----|------|-------|
| createUpdaterArtifacts | true/"v1Compatible" | Create updater artifacts (v1Compatible removed in v3) |
| pubkey | string | Base64 Ed25519 public key (content, NOT file path) |
| endpoints | string[] | Update check URLs (TLS enforced in production) |
| windows.installMode | passive/basicUi/quiet | Windows installer behavior |

### Signing / Verification Flow

1. cargo tauri signer generate -- -w ~/.tauri/myapp.key
2. Public key -> tauri.conf.json -> plugins.updater.pubkey
3. Private key -> env var TAURI_SIGNING_PRIVATE_KEY at build time
4. tauri build generates: bundle + .sig file per platform
   - Linux: myapp.AppImage + myapp.AppImage.sig
   - macOS: myapp.app.tar.gz + myapp.app.tar.gz.sig
   - Windows: myapp-setup.exe + myapp-setup.exe.sig
5. Client verifies .sig (Ed25519) against embedded pubkey BEFORE install. Cannot be disabled.
6. Key rotation: runtime pubkey() builder method

### Channel / Staged Rollout

- No built-in channel system
- Server-driven: different endpoint URLs per channel
- Custom version_comparator for downgrades
- Custom target for universal binaries / build flavors

### Cache / Atomic Swap

- Download: streamed with progress events (Started, Progress, Finished)
- Install:
  - Windows: launches MSI/NSIS installer (app exits first)
  - macOS: extracts .tar.gz, replaces .app
  - Linux: replaces AppImage
- **No delta updates** — full bundle each time

### App-Quit / Reload Timing

- **Windows: app auto-exits before install** (installer limitation)
  - on_before_exit hook for cleanup
  - passive (default): small progress window
  - basicUi: user interaction required
  - quiet: no UI (needs admin or user-wide)
- **macOS/Linux:** app chooses when to restart via relaunch()
- Not required to restart immediately

### Rollback Mechanics

- No built-in rollback
- Server-side: serve lower version (custom version_comparator)
- Windows MSI/NSIS: versioned install directories
- Practical: forward-fix (ship new update with fix)

### Known Limitations

| Issue | Ref |
|-------|-----|
| No delta updates | Architecture |
| Windows requires app exit | Platform |
| No channel/percentage system | Feature gap |
| Android/iOS limited | Platform table |
| v1Compatible removed in v3 | Migration |
| Rust >= 1.90 required | Build |

**Status: Fully active. Core Tauri 2.x plugin.**

---

## 7. Capacitor Live Update (Official — Deprecated)

**Repo:** https://github.com/ionic-team/capacitor (community plugin: @capacitor-community/live-update)
**Status:** DEPRECATED — removed from Capacitor ecosystem
**Deprecation:** ~2023-2024. Replaced by Capgo (Capawesome commercial solution).

### Historical Manifest

\\\json
{
  "version": "1.2.3",
  "assets": [{ "url": "https://.../index.html", "path": "/index.html", "hash": "sha256..." }],
  "mandatory": false
}
\\\

### Deprecation Details

- **Why:** Security (no signing), lack of maintenance, App Store policy issues
- **Migration:** Capgo (@capgo/capacitor-updater) recommended
- **Key issue:** No cryptographic signing, vulnerable to MITM

**Status: Fully deprecated. Do not use for new projects.**

---

## 8. Capgo Live Update (@capgo/capacitor-updater)

**Repo:** https://github.com/Cap-go/CapgoNative
**Docs:** https://capgo.app/docs/live-updates/
**Current Major Version:** 8.x (2026), 5.x/6.x/7.x supported
**Status:** Active — commercial product (Capgo by Capawesome)
**Platforms:** iOS, Android, Electron
**License:** Commercial (free tier available)

### How It Works

1. Capgo SDK in app checks for updates
2. Channels target updates to user groups
3. JS bundle only (native changes require new binary)
4. Upload: npx @capgo/cli@latest bundle upload --channel=production
5. App restart to load new bundle (background download)

### Bundle Format

- ZIP archive of web assets (dist/)
- Backend manages: versioning (SemVer), channel assignment, delta computation, optional E2E encryption
- Versioning: 1.2.3 (prod), 1.2.3-beta.1 (beta), 1.2.3-dev.1 (dev), 1.2.3-rc.1 (RC)

### Signing / Verification

- SHA-256 checksum on download
- Optional E2E encryption (public key in app)
- Channel security: backend validates permissions each check
- Channels do NOT provide bundle confidentiality

### Channel / Staged Rollout

**Precedence (high to low):**
1. Forced device mapping (Dashboard)
2. Cloud override (per-device, Dashboard/API)
3. Plugin setChannel() local (instant, device-local)
4. Capacitor config defaultChannel (test builds)
5. Cloud Default Channel (~99% users)

**Progressive Rollouts:**
- Stable fallback + Rollout target on same channel
- Percentage: 1% -> 5% -> 25% -> 50% -> 100%
- Sticky cohort: hash(deviceID + rolloutID), default 30-day cache
- Controls: Enable, Pause, Resume, Disable, Complete (promote), Rollback
- Auto-pause: Wilson confidence lower bound on failure rate
  - Config: threshold (bps), window (min), confidence, min attempts/failures, cooldown
  - Actions: pause, rollback, notify

**Channel Options:**
- Platform filters (iOS/Android/Electron)
- Disable auto-downgrade under native version
- Allow/disallow: dev, prod, emulator, physical, self-assign
- Download format: all, zip, delta, zip_from_builtin, delta_from_builtin
- Disable auto-update: major, minor, patch, metadata, none

### Cache / Atomic Swap

- Background download of ZIP or delta
- Stored in app local storage
- Apply on next app restart (notifyAppReady() triggered)
- Delta: Fast Updates — only changed files
- Fallback: delta fail -> full ZIP

### App-Quit / Reload Timing

- notifyAppReady() after app init
- Apply on next launch
- Background download while running
- Immediate reload possible via CapacitorBridge

### Rollback Mechanics

- Console: select previous bundle -> Assign to Channel
- Progressive: --rollout-rollback (clears target, resets to stable)
- Auto-rollback via auto-pause policy
- Bundle protection: stable/rollout-target bundles protected from deletion

### Known Limitations

| Issue | Ref |
|-------|-----|
| JS bundle only | Architecture |
| Commercial (not OSS) | Business model |
| Requires Capgo cloud (or self-hosted enterprise) | Dependency |
| App restart required | UX |
| No bundle confidentiality via channels | Security |
| Override retention: 90 days | Docs |

**Status: Fully active. Commercial product with regular releases.**

---

## 9. CodePush (App Center — Deprecated)

**Repo:** https://github.com/microsoft/react-native-code-push (archived)
**Status:** DEPRECATED & DISCONTINUED
**Shutdown Date:** 2025-03-31 (all App Center services)
**Migration:** Expo Updates (recommended) or self-hosted

### Historical Deployment Model

- Deployments: Production, Staging, custom
- Update: ZIP of JS bundle + changed assets
- mandatory flag: true = force install (app unusable until updated)

### Historical Manifest

\\\json
{
  "label": "12",
  "appVersion": "1.0.0",
  "mandatory": true,
  "packageUri": "https://codepush.appcenter.ms/...",
  "packageHash": "sha256...",
  "packageSize": 123456
}
\\\

### Historical Rollback

- code-push rollback <deployment> <app>
- Dashboard one-click rollback

### Deprecation Timeline

| Date | Event |
|------|-------|
| 2023-03-31 | Diagnostics/crash deprecated |
| 2024-03-31 | Test Plans deprecated |
| 2025-03-31 | ALL App Center services shut down |

**Status: Fully discontinued. Service offline. SDK archived.**

---

## 10. Expo Updates (expo-updates)

**Repo:** https://github.com/expo/expo
**Docs:** https://docs.expo.dev/eas-update/
**Current Major Version:** Expo SDK 53+ (2025-2026)
**Status:** Active — primary OTA for React Native/Expo
**Service:** Expo Update cloud (formerly EAS Update)
**License:** MIT (SDK) / Commercial (cloud)

### Architecture

- expo-updates library in app binary
- Expo Update cloud serves updates
- Runtime versions ensure native/JS compatibility
- Branches manage update streams
- Channels map to branches

### Manifest Format

\\\json
{
  "digest": "sha256:abc123...",
  "branch": "production",
  "releaseId": "uuid",
  "manifest": {
    "platform": "ios",
    "bundleUrl": "https://updates.expo.dev/...",
    "assets": [{ "path": "index.html", "bundleUrl": "https://...", "fileSize": 1234, "hash": "sha256:..." }],
    "launchAsset": { "url": "https://...", "fileSize": 5678, "hash": "sha256:..." },
    "runtimeVersion": { "policy": "sdkVersion" }
  },
  "runtimeVersion": "53.0.0",
  "message": "Fix login bug"
}
\\\

| Field | Purpose |
|-------|---------|
| digest | SHA-256 of entire update |
| branch | Update branch name |
| releaseId | Unique release identifier |
| manifest.platform | ios/android/web |
| manifest.bundleUrl | JS bundle URL |
| manifest.assets[] | Individual files with hash+size |
| manifest.launchAsset | Entry point |
| manifest.runtimeVersion | Runtime version policy |
| runtimeVersion | Specific version string |
| expiration | Optional expiry |

### Runtime Versions

- Policies: sdkVersion (default), nativeVersion, embedded
- Native code change -> new runtime version -> old updates incompatible

### Channel / Staged Rollout

**Channels:** Defined in eas.json. eas update --channel production

**Per-update rollouts:**
\\\sh
eas update --rollout-percentage=10
eas update:edit  # increase %
\\\

**Branch-based rollouts:**
\\\sh
eas channel:rollout  # interactive
\\\

Rules: One rollout per branch+platform+runtimeVersion. One branch rollout per channel.

### Signing / Verification

- SHA-256 digest of update payload
- Per-asset hashes
- HTTPS in transit
- Optional update code signing
- Runtime version check prevents incompatible JS

### Cache / Atomic Swap

- Download: bundle + assets to local storage
- Staged: new update alongside current
- Apply: next app launch (or second launch after download)
- Rollback to embedded: revert to JS in native binary
- Bundle diffing: optional, serve only changed chunks

### App-Quit / Reload Timing

- Default: next app launch (force close + reopen x2)
- Custom: checkForUpdateAsync() -> fetchUpdateAsync() -> reloadAsync()
- useUpdates() React hook for state

### Rollback Mechanics

- Republish: eas update:republish (previous stable)
- Rollback to embedded: eas update:roll-back-to-embedded
- Rollback: eas update:rollback (previous update)
- Rollout revert: eas update:revert-update-rollout
- Embedded fallback: binary always contains working JS

### Known Limitations

| Issue | Ref |
|-------|-----|
| JS/assets only (no native) | Architecture |
| Requires Expo Update cloud (or self-hosted) | Dependency |
| Runtime version change needs new binary | Native/JS boundary |
| Store policies still apply | Compliance |
| Second launch for default apply | UX |

**Status: Fully active. Standard OTA for React Native/Expo.**

---

## 11. Sentry Releases

**Repo:** https://github.com/getsentry/sentry
**Docs:** https://docs.sentry.io/product/releases/
**Status:** Active - but NOT an update mechanism
**Purpose:** Release tracking, source map upload, deployment association

### What Sentry Releases Do
- Track releases: associate events/errors with app versions
- Source maps: upload + resolve JS for stack trace deobfuscation
- Deployment tracking: mark when release deployed to environment
- Artifact association: source maps, proguards, dSYMs

### Artifact Upload
```sh
sentry-cli releases files <version> upload-sourcemaps <path> --dist <dist>
sentry-cli releases deposit <version>
sentry-cli releases finalize <version>
```

### Relevance to AIRIZ
- Use Sentry for post-update crash monitoring
- Use source maps to debug OTA update issues
- Do NOT use as update delivery mechanism

**Status: Active as monitoring. Not applicable as update engine.**

---

## 12. Flutter Update Patterns

**Repo:** N/A (no first-party updater)
**Status:** No first-party auto-update mechanism
**Package:** package_info_plus (version info only, not updates)

### Official Position

Flutter has NO built-in auto-update. Official guidance:
- **Android:** Play Store handles updates (immediate/phased rollout by Google)
- **iOS:** App Store handles updates
- **Desktop:** No official mechanism. Community solutions: MSIX (Win), Sparkle (macOS), AppImage (Linux)

### Community Patterns

| Pattern | How | Limitation |
|---------|-----|------------|
| in_app_update (pub) | Play Store immediate/flexible updates | Android only |
| MSIX (Windows) | AppInstaller XML | Windows only |
| Sparkle (macOS) | Appcast | macOS only |
| Custom + Firebase Remote Config | Flag-based feature toggle | Not binary update |

### package_info_plus
- Provides: appName, packageName, version, buildNumber, buildSignature
- Does NOT provide: update checking, downloading, installing

**Status: No first-party solution. Use platform-specific updaters for desktop.**

---

## 13. .NET MAUI Deployment

**Repo:** https://github.com/dotnet/maui
**Status:** Active - .NET 8/9/10
**Deployment Model:** Platform-specific (no unified updater)

### Windows (MSIX / AppInstaller)
- **MSIX packaging:** .NET MAUI apps package as MSIX/MSIXBundle
- **AppInstallerFile:** Generated via MSBuild (GenerateAppInstallerFile=true)
- **Update mechanism:** Windows AppInstaller (see section 5)
- **Alternative:** Unpackaged (loose files) + Squirrel.Windows or WinSparkle

### macOS
- **Packaging:** .app bundle (standard macOS)
- **Update:** Sparkle framework (see section 3)

### Android
- **Packaging:** APK/AAB through Play Store
- **Update:** Play Store phased rollout (Google-controlled)

### iOS
- **Packaging:** IPA through App Store
- **Update:** App Store (Apple-controlled)

### Key Limitation
No unified cross-platform update mechanism. Must use platform-specific:
- Windows -> MSIX/AppInstaller or WinSparkle
- macOS -> Sparkle
- Android -> Play Store
- iOS -> App Store

**Status: Active. Platform-specific deployment, no unified updater.**

---

## 14. Uno Platform

**Repo:** https://github.com/unoplatform/uno
**Status:** Active - cross-platform XAML (WinUI/UWP)
**Targets:** Windows, macOS, Linux, Android, iOS, Web (WASM), Native AOT

### Distribution Model

| Target | Update Mechanism |
|--------|-----------------|
| Windows (WinUI 3) | MSIX + AppInstaller (same as .NET MAUI) |
| macOS | Sparkle or custom |
| Linux | AppImage / custom script |
| Android | Play Store |
| iOS | App Store |
| Web (WASM) | Static hosting + service worker (PWA) |
| Native AOT | Platform-specific (same as native) |

### Web (WASM) Specific
- Built as static files (HTML + WASM + JS)
- Update = redeploy static files to CDN/host
- Service worker for offline + update notification (see section 16)
- No binary update - full page reload with new assets

### Key Observation
Uno Platform does NOT provide its own update mechanism. Relies entirely on platform-specific distribution.

**Status: Active. No built-in updater. Platform-specific distribution.**

---

## 15. react-native-code-push (Deprecated)

**Repo:** https://github.com/microsoft/react-native-code-push (ARCHIVED)
**Status:** DEPRECATED - service shut down 2025-03-31
**Replacement:** Expo Updates or self-hosted

### Historical API

```js
import CodePush from 'react-native-code-push';

CodePush.sync({
  checkFrequency: CodePush.CheckFrequency.ON_APP_START,
  installMode: CodePush.InstallMode.IMMEDIATE
}, (status) => { /* handle */ });
```

### CheckFrequency Options
- ON_APP_START (default), ON_APP_RESUME, MANUAL

### InstallMode Options
- IMMEDIATE: restart now
- APPLICATION_IN_BG: restart when backgrounded
- ON_NEXT_RESTART: restart on next natural restart

### Migration Paths
1. **Expo Updates** (recommended): eas update replaces CodePush
2. **Capgo** (for Capacitor): different ecosystem
3. **Self-hosted:** Serve JS bundle ZIP from CDN + custom client logic

**Status: Fully deprecated. Service offline since 2025-03-31.**

---
## 16. PWA Service Worker Lifecycle

**Spec:** W3C Service Workers (https://w3c.github.io/service-worker-spec/)
**Implementation:** All modern browsers (Chrome, Firefox, Safari, Edge)
**Related:** Workbox (https://developers.google.com/workbox), Web App Manifest
**Status:** Active — W3C standard, continuously evolving

### Service Worker Lifecycle States

1. **Installing** — SW script fetched and executed for first time
2. **Waiting** — Installed but not yet controlling any clients
3. **Active** — Controlling one or more clients
4. **Redundant** — Failed install/activate or errored; will be removed

### Update Flow (W3C Spec)

1. Browser fetches SW script on navigation (every 24h by default, or on fetch failure)
2. If bytes differ from registered SW -> new install begins
3. install event fires -> cache new assets (optional)
4. activate event fires -> clean up old caches
5. New SW now "waiting" or "active"
6. Clients still controlled by OLD SW until:
   a. Old SW becomes redundant, OR
   b. New SW calls skipWaiting(), OR
   c. Client is closed and reopened

### Key APIs

| API | Purpose |
|-----|---------|
| navigator.serviceWorker.register(script) | Register SW |
| registration.update() | Force check for update |
| registration.updateViaCache('none'\|'all'\|'default') | Control update fetch caching |
| self.skipWaiting() | New SW immediately takes control |
| self.clients.claim() | New SW immediately controls all open clients |
| self.clients.matchAll() | Get all controlled clients |
| client.postMessage(data) | Send message to specific client |
| registration.postMessage(data) | Send message to SW from client |
| addEventListener('message', handler) | Receive messages (both directions) |
| caches.open(name) / caches.delete(name) | Cache Storage API |
| Cache.addAll(urls) / Cache.add(url) | Pre-cache assets |

### skipWaiting + clients.claim Pattern (Immediate Update)

```js
// service-worker.js
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
  const cached = await caches.keys();
  const current = 'v2';
  await Promise.all(cached.filter(c => c !== current).map(c => caches.delete(c)));
});
```

**Warning:** skipWaiting + clients.claim can cause mid-session updates. Use with care.

### PostMessage Update Notification Pattern

```js
// In SW (on new version activate):
self.addEventListener('activate', async () => {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => {
    client.postMessage({ type: 'UPDATE_AVAILABLE', version: '2.0.0' });
  });
});

// In page:
navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data.type === 'UPDATE_AVAILABLE') {
    showUpdateBanner('New version available. Reload?');
  }
});
```

### Out-of-Band (OOB) Cache Strategy

- **Pre-caching:** Cache all critical assets during install
- **Runtime caching:** Cache on first fetch (stale-while-revalidate)
- **Versioned cache names:** v1, v2, v3 — old caches deleted on activate
- **Navigation fallback:** Serve cached index.html for offline
- **OOB update check:** Periodic fetch of version manifest between SW update checks

```js
// OOB version check in page (not SW):
async function checkForUpdate() {
  const res = await fetch('/version.json', { cache: 'no-store' });
  const { version } = await res.json();
  if (version !== CURRENT_VERSION) {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  }
}
setInterval(checkForUpdate, 60 * 1000);
```

### Workbox Recipes

| Recipe | Use Case |
|--------|----------|
| precaching | Cache build-time known assets (WASM, JS, CSS) |
| StaleWhileRevalidate | API responses, dynamic content |
| CacheFirst | Images, fonts, static assets |
| NetworkFirst | HTML navigations (freshness important) |
| NetworkOnly | Authenticated content |
| Expiration | TTL-based cache cleanup |
| RangeRequests | Video/audio streaming |

### Cache / Atomic Swap

- **Cache Storage API:** Partitioned per-origin, persistent across sessions
- **Atomic swap:** New SW activates -> old caches deleted -> new caches in place
- **Fallback:** If new SW fails install, old SW remains (no disruption)
- **Versioning:** Cache names include version/build hash for clean invalidation

### App-Quit / Reload Timing

- **SW update check:** Every 24h by default (browser-controlled) or on fetch failure
- **Manual trigger:** registration.update() or navigation with cache: 'no-store'
- **Client update:** On next navigation (or immediately with skipWaiting + clients.claim)
- **Tab close:** Old SW becomes redundant when last controlled client closes
- **Browser close:** All SWs terminated; new SW takes over on next launch

### Rollback Mechanics

- **Automatic:** If new SW fails install/activate, old SW remains
- **Manual:** Deploy previous SW version -> browser detects change -> new install
- **Cache rollback:** Include old cache names in new SW activate cleanup
- **CDN rollback:** Serve previous build artifacts (SW re-fetches on next update)

### Known Limitations

| Issue | Ref |
|-------|-----|
| 24h minimum update check (browser-enforced) | W3C spec |
| No push-based update notification | Architecture |
| skipWaiting can cause mid-session inconsistency | Best practice |
| Safari: SW update timing less predictable | Browser bug |
| No built-in version comparison or staged rollout | Developer responsibility |
| Cache Storage quota (~60MB typical) | Browser limit |
| iOS: SW terminated aggressively on background | Platform |

**Status: Active W3C standard. Foundation for all PWA update strategies.**

---

## 17. Chrome Component Updater (OMA-DM)

**Repo:** https://chromium.googlesource.com/chromium/src/ (components/component_updater/)
**Spec:** OMA-DM (Open Mobile Alliance Device Management)
**Status:** Active - enterprise Chrome management channel
**Scope:** Chrome browser components (PDF viewer, Code

### How It Works

1. OMA-DM server sends update manifest (XML) to managed Chrome instances
2. Manifest specifies: component ID, version, download URL, signature
3. Chrome Component Updater service downloads the package
4. Package verified (SHA-256 + code signature)
5. Differential update: only changed files downloaded (bsdiff-based)
6. Component atomically swapped in Chrome Components directory

### Manifest Format (OMA-DM XML)

```xml
<UpdatePolicy>
  <Target><DeviceId>chrome-instance-id</DeviceId></Target>
  <Update>
    <Version>1.2.3</Version>
    <Url>https://dl.google.com/components/pdf/1.2.3.zip</Url>
    <Signature>base64-signature</Signature>
    <Size>10485760</Size>
  </Update>
</UpdatePolicy>
```

### Signing / Verification
- SHA-256 hash verification of downloaded package
- Code signature verification (Authenticode on Windows)
- OMA-DM channel uses TLS + device attestation

### Channel / Staged Rollout
- Enterprise MDM-controlled: admin decides which devices get which version
- OMA-DM supports device groups for targeted rollout
- No consumer-facing channel system

### Cache / Atomic Swap
- Component stored in Chrome Components directory (versioned)
- Differential updates: bsdiff patches, only changed files downloaded
- Atomic swap: new component extracted to temp, verified, renamed over old
- Rollback: previous version retained until confirmed working

### App-Quit / Reload Timing
- Chrome applies component updates in background
- Component loaded on next Chrome launch (or immediately if not in use)
- No user interaction required

### Rollback Mechanics
- Automatic: if component fails to load, Chrome falls back to previous version
- Admin: MDM can push previous version explicitly

### Known Limitations

| Issue | Ref |
|-------|-----|
| Enterprise-only (requires MDM enrollment) | OMA-DM spec |
| Chrome-only (not applicable to other apps) | Scope |
| No consumer self-serve update path | Architecture |
| OMA-DM is a complex protocol to implement | Spec |

**Status: Active. Enterprise Chrome management only. Not applicable to AIRIZ directly** (unless managing Chrome as a dependency).

---

## Quick Comparison Matrix

| Tool | Platform | Manifest | Signing | Delta | Rollback | Status |
|------|----------|----------|---------|-------|----------|--------|
| Squirrel.Windows | Win | RELEASES (txt) | Code sig only | bsdiff | None | Semi-maint |
| Squirrel.Mac | macOS | JSON (dynamic) | Code sig + SHA256 | BinaryDelta | Server-driven | Maint |
| Sparkle | macOS | Appcast XML | EdDSA + code sig | BinaryDelta v3/4 | Server-side | Active |
| WinSparkle | Win | Appcast XML | EdDSA | None | Server-side | Active |
| MSIX AppInstaller | Win | AppInstaller XML | Authenticode | None | Transactional | Active (OS) |
| Tauri Updater | Win/Mac/Linux | JSON | Ed25519 | None | Server-side | Active |
| Capgo | iOS/And/Electron | Cloud-managed | SHA256 + E2E opt | Yes (diff) | Cloud rollback | Active (comm) |
| Expo Updates | iOS/And/Web | JSON (cloud) | SHA256 + sig opt | Bundle diff | Republish/rollback | Active |
| CodePush | iOS/And | JSON (cloud) | SHA256 | None | CLI rollback | DEAD |
| PWA SW | Web | SW script bytes | TLS + integrity | None (full) | Old SW retained | Active (W3C) |
| Chrome OMA-DM | Win (Chrome) | OMA-DM XML | SHA256 + code sig | bsdiff | Auto fallback | Active (ent) |

---

## AIRIZ Motor Console - Recommended Architecture Mapping

| Target | Recommended Engine | Rationale |
|--------|-------------------|-----------|
| Windows Desktop | MSIX AppInstaller or WinSparkle | MSIX: platform-native, transactional, repair built-in. WinSparkle: lighter, Sparkle-compatible appcast |
| Android | Play Store phased rollout + Capgo (OTA JS) | Play Store for native binary; Capgo for JS bundle hotfixes |
| iOS | App Store + Capgo (OTA JS) | App Store for native binary; Capgo for JS bundle hotfixes |
| Web PWA | Service Worker + Workbox | W3C standard, CDN deploy, skipWaiting for instant update |
| Cloudflare Worker | CF Dashboard / wrangler deploy | Workers deploy via wrangler or CF API, no client-side update needed |

### Unified Protocol Recommendation

For a SINGLE unified update manifest endpoint (served from Cloudflare Worker):

1. **Windows:** Serve AppInstallerFile XML at /updates/windows/appinstaller.xml (MSIX) OR appcast.xml (WinSparkle)
2. **macOS (if added):** Serve appcast.xml (Sparkle-compatible)
3. **Android/iOS JS:** Capgo cloud (separate channel per platform)
4. **Web PWA:** Service worker script at /sw.js + version.json for OOB check
5. **Worker:** Deploy via wrangler/cf-api (no client update manifest needed)

The Cloudflare Worker serves as the single update manifest endpoint, routing based on path or User-Agent to the appropriate format.

---

*End of reference catalog. Generated 2026-11-05.*
