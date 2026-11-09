# AIRIZ Cross-Platform Auto-Update Protocol Surface Survey

**Compiled:** 2026-11-04
**Scope:** 9 engines across Win, macOS, Android, iOS, Web PWA, Electron, Tauri, React Native, Capacitor, MSIX
**Purpose:** Identify minimum viable subset for a unified AIRIZ signed-manifest release layer.

---

## 1. Squirrel.Windows

| Field | Value |
|---|---|
| Spec version | Squirrel.Windows 1.x (NuGet) |
| Docs | https://github.com/Squirrel/Squirrel.Windows/tree/master/docs |
| Repo | https://github.com/Squirrel/Squirrel.Windows |
| Last release | **UNMAINTAINED** - README: "Contributors Needed" (issue #1470) |
| Platform | Windows only |

### Manifest / Feed Format

RELEASES file - plain text, one entry per line:

    SHA1 filename filesize[# nn%]

| Token | Type | Description |
|---|---|---|
| SHA1 | 40-char hex | Hash of the .nupkg file |
| filename | string | e.g. MyApp-1.0.0-full.nupkg |
| filesize | int (bytes) | File size |
| # nn% | optional | Staged rollout % (Squirrel >= 1.4.0) |

Filename convention: Id-version-{full|delta}.nupkg

### NuGet Metadata Fields (from .nuspec)

| Field | Usage |
|---|---|
| Id | App name (no spaces/dots). Filenames, install dir, shortcuts |
| Title | Windows Uninstaller display name |
| Version | From AssemblyVersion. Filenames + uninstaller |
| IconUrl | URL to .ico (fetched at install time) |
| Language | Codepage (default 1252) |

### Signature Scheme

- None at protocol level. Relies on HTTPS + Windows code signing.
- signtool.exe via Squirrel --releasify -n "<params>"
- Signs all EXEs + Setup.exe (SmartScreen/AV trust)

### Delta Updates

- Algorithm: bsdiff/bspatch
- Delta .nupkg: .diff files + .shasum verification
- Client picks smaller: sum(deltas) vs full
- Build full from deltas: bspatch, verify shasum, copy new files

### Update Process (UpdateManager)

1. Download remote RELEASES, diff against local
2. Download deltas or full (SHA1 verified)
3. If deltas: bspatch to reconstruct full package
4. Extract to %LocalAppData%\<Id>\app-<version>
5. Update shortcuts (via Update.exe --processStart)
6. Cleanup: keep current + previous only

### Squirrel.exe CLI (releasify)

| Flag | Purpose |
|---|---|
| -r, --releaseDir | Output directory |
| -n, --signWithParams | SigTool params |
| -b, --baseUrl | URL prefix for RELEASES entries |
| --no-delta | Skip delta generation |
| --framework-version | Required .NET version |

### Staged Rollout

# nn% appended to RELEASES line. 10% -> 50% -> remove comment for 100%.

### Rollback

None built-in. Manually edit RELEASES, release higher version.

### Update.exe Flags

- --processStart <exe> - app to launch after install
- --releasify <nupkg> - packaging mode
- -n <params> - sign with SigTool

---

## 2. Sparkle (macOS)

| Field | Value |
|---|---|
| Spec version | Sparkle 2.x (current), 1.x (legacy) |
| Docs | https://sparkle-project.org/documentation/ |
| Repo | https://github.com/sparkle-project/Sparkle |
| Last release | **ACTIVE** (c 2006-2026, SPM/Carthage/CocoaPods) |
| Platform | macOS only |

### Appcast XML Schema

RSS 2.0 + xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"

Complete item template:

    <item>
      <title>Version 2.0</title>
      <link>https://website.com</link>
      <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
      <sparkle:version>2.0</sparkle:version>
      <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
      <sparkle:releaseNotesLink>https://example.com/notes.html</sparkle:releaseNotesLink>
      <sparkle:fullReleaseNotesLink>https://example.com/history/</sparkle:fullReleaseNotesLink>
      <sparkle:minimumSystemVersion>12.0.0</sparkle:minimumSystemVersion>
      <sparkle:maximumSystemVersion>15.0</sparkle:maximumSystemVersion>
      <sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements>
      <sparkle:minimumUpdateVersion>1.9</sparkle:minimumUpdateVersion>
      <sparkle:minimumAutoupdateVersion>2.0</sparkle:minimumAutoupdateVersion>
      <sparkle:ignoreSkippedUpgradesBelowVersion>2.2</sparkle:ignoreSkippedUpgradesBelowVersion>
      <sparkle:criticalUpdate sparkle:version="1.2.4"/>
      <sparkle:phasedRolloutInterval>86400</sparkle:phasedRolloutInterval>
      <sparkle:channel>beta</sparkle:channel>
      <sparkle:informationalUpdate>
        <sparkle:belowVersion>1.0</sparkle:belowVersion>
      </sparkle:informationalUpdate>
      <description><![CDATA[<h2>Notes</h2>]]></description>
      <enclosure url="https://example.com/app.zip"
                 sparkle:edSignature="base64==...=="
                 length="1623481"
                 type="application/octet-stream" />
      <sparkle:delta length="50000" sparkle:fromVersion="1.9"
                     sparkle:edSignature="..." url="https://example.com/delta.delta" />
    </item>

### All sparkle: Tags

| Tag | Type | Since | Purpose |
|---|---|---|---|
| sparkle:version | element | 1+ | CFBundleVersion (machine) |
| sparkle:shortVersionString | element | 1+ | Display version |
| sparkle:releaseNotesLink | element | 1+ | Notes URL (xml:lang) |
| sparkle:fullReleaseNotesLink | element | 2+ | Full history URL |
| sparkle:edSignature | attr | 2+ | EdDSA ed25519 (base64 raw 64B) |
| sparkle:dsaSignature | attr | 1+ | Legacy DSA (base64) |
| sparkle:os | attr | 2+ | Platform filter |
| sparkle:delta | element | 2+ | Delta ref |
| sparkle:minimumSystemVersion | element | 2+ | Min macOS |
| sparkle:maximumSystemVersion | element | 2+ | Max macOS |
| sparkle:hardwareRequirements | element | 2.9+ | e.g. arm64 |
| sparkle:minimumUpdateVersion | element | 2.9+ | Min app version |
| sparkle:minimumAutoupdateVersion | element | 1+ | Min for silent auto-update |
| sparkle:ignoreSkippedUpgradesBelowVersion | element | 2.1+ | Override skip |
| sparkle:criticalUpdate | element | 1+/2+ | Cannot skip |
| sparkle:phasedRolloutInterval | element | 2+ | Seconds between groups (7 fixed) |
| sparkle:channel | element | 2+ | Channel name |
| sparkle:informationalUpdate | element | 2+ | Download-link-only |
| sparkle:tags | element | 1+ | Legacy container |

### Signature Scheme

- Algorithm: EdDSA (Ed25519)
- Encoding: Base64 of raw 64-byte detached signature
- Public key: SUPublicEDKey in Info.plist (base64 string)
- Key gen: ./bin/generate_keys (private in Keychain)
- Sign: ./bin/sign_update file.zip -> XML fragment
- Feed signing (2.9+): SURequireSignedFeed
- Key rotation: Change EdDSA OR code sig cert (not both)

### Sparkle 1 vs 2 Diffs

| Feature | v1 | v2 |
|---|---|---|
| Updater class | SUUpdater | SPUStandardUpdaterController |
| Sig | DSA | EdDSA + DSA fallback |
| Channels | Separate feeds | sparkle:channel |
| Deltas | No | sparkle:delta |
| Phased rollout | No | sparkle:phasedRolloutInterval |
| Info updates | Omit enclosure | sparkle:informationalUpdate |
| Feed signing | No | SURequireSignedFeed (2.9+) |
| Markdown notes | No | sparkle:format="markdown" (2.9+) |

### Rollback

None automatic. No server-side rollback directive.

---

## 3. electron-updater

| Field | Value |
|---|---|
| Spec version | v6.8.11 |
| Docs | https://www.electron.build/auto-update |
| Repo | https://github.com/electron-userland/electron-builder (packages/electron-updater) |
| npm | electron-updater@6.8.11 |
| Last release | Active (part of electron-builder) |
| Platform | Windows, macOS, Linux |

### Manifest Schema (UpdateInfo - parsed from YAML)

Channel file: channel+suffix.yml (latest.yml, latest-mac.yml, beta-linux.yml)

    interface UpdateInfo {
      version: string;              // SemVer
      files: Array<UpdateFileInfo>; // required
      path?: string;                // deprecated
      sha512?: string;              // deprecated
      releaseName?: string | null;
      releaseNotes?: string | ReleaseNoteInfo[] | null;
      releaseDate: string;
      stagingPercentage?: number;   // 0-100
      minimumSystemVersion?: string;
    }
    interface UpdateFileInfo {
      url: string;
      sha512: string;               // required
      size?: number;
      blockMapSize?: number;
      isAdminRightsRequired?: boolean;
    }
    interface WindowsUpdateInfo extends UpdateInfo {
      packages?: { [arch: string]: PackageFileInfo };
    }

### Provider Abstraction (BaseProvider)

    abstract class Provider<T extends UpdateInfo> {
      abstract getLatestVersion(): Promise<T>;
      abstract resolveFiles(updateInfo: T): Array<ResolvedUpdateFileInfo>;
      // Shared: getBlockMapFiles(), getChannelFilePrefix(), httpRequest()
    }

| Provider | Feed Source | Key Difference |
|---|---|---|
| GenericProvider | HTTP(s) server | Fetches <base>/<channel>.yml |
| GitHubProvider | GitHub Releases API | Adds tag field, release assets |
| PrivateGitHubProvider | GH Enterprise | Custom host |

Channel naming: latest (win), latest-mac (darwin), latest-linux[-arch] (linux)

### Signature Scheme

- Integrity: SHA-512 hex per file in manifest
- macOS: Developer ID code signature of .app
- Windows: Optional VerifyUpdateCodeSignature callback
- No manifest-level crypto signature - relies on HTTPS + SHA-512 + code signing

### Delta Updates

- .blockmap files (1MB block SHA-512 hashes) alongside installers
- HTTP Range requests for changed blocks only
- All platforms (NSIS, AppImage, DMG)

### Staged Rollout

stagingPercentage: 0-100 in YAML. Client-side: hash install ID vs threshold.

### Rollback

None built-in. Previous version stays until cleaned up.

### Install Trigger

- autoUpdater.checkForUpdatesAndNotify() / checkForUpdatesAndDownload()
- Win: NSIS installer, relaunch. macOS: Replace .app. Linux: Download AppImage.

---

## 4. Tauri Updater (@tauri-apps/plugin-updater)

| Field | Value |
|---|---|
| Spec version | Tauri 2.x (plugin v2.14.1) |
| Docs | https://tauri.app/plugin/updater/ |
| Repo | https://github.com/tauri-apps/plugins-workspace (plugins/updater) |
| npm | @tauri-apps/plugin-updater@2.14.1 |
| Last docs update | Nov 28, 2025 |
| Platform | Windows, macOS, Linux |

### Signed JSON Manifest

Static JSON (multi-platform):

    {
      "version": "1.2.3",
      "notes": "Release notes",
      "pub_date": "2026-01-15T00:00:00.000Z",
      "platforms": {
        "linux-x86_64":  { "signature": "base64sig==", "url": "https://...AppImage" },
        "windows-x86_64":{ "signature": "base64sig==", "url": "https://...setup.exe" },
        "darwin-aarch64":{ "signature": "base64sig==", "url": "https://...app.tar.gz" }
      }
    }

Required: version, platforms.[target].url, platforms.[target].signature
Platform keys: {linux|darwin|windows}-{x86_64|aarch64|i686|armv7}

Dynamic server response:

    { "version": "1.2.3", "url": "https://...", "signature": "base64sig==", "notes": "", "pub_date": "" }

No update: 204 No Content

### Signature Scheme

- Algorithm: Ed25519
- Encoding: Base64 of raw 64-byte signature (same as Sparkle)
- Pubkey: tauri.conf.json -> plugins.updater.pubkey (string, not file path)
- Private key: TAURI_SIGNING_PRIVATE_KEY env var at build time
- Cannot be disabled - mandatory
- Key gen: npm run tauri signer generate
- .sig files generated alongside each artifact

### Config (tauri.conf.json)

    {
      "plugins": {
        "updater": {
          "pubkey": "PEM_CONTENT",
          "endpoints": ["https://releases.app.com/{{target}}/{{arch}}/{{current_version}}"],
          "dangerousInsecureTransportProtocol": false,
          "windows": { "installMode": "passive" }
        }
      }
    }

URL vars: {{current_version}}, {{target}}, {{arch}}
Win install modes: passive (default), basicUi, quiet

### JS API

    const update = await check({ headers?, timeout?, proxy?, target? });
    // update: Update | null
    // update.version, update.currentVersion, update.date, update.body, update.rawJson
    await update.download((e: DownloadEvent) => {}, { headers?, timeout? });
    await update.install({ restartAfterInstall? });
    await update.downloadAndInstall(onEvent?, options?);
    await update.close();

### Rust Builder (advanced)

- .endpoints(), .pubkey(), .target(), .timeout(), .proxy(), .header()
- .version_comparator(|cur, upd| upd.version != cur) - allow downgrades
- .on_before_exit(|| {}) - Windows pre-exit hook

### Rollback

Via version_comparator override (allow != instead of >). Server returns lower version.

### Install Trigger

App-initiated only. No background auto-check.
- Win: Auto-exits before install
- macOS/Linux: Manual relaunch after install

---

## 5. Capawesome Capacitor Live Update

| Field | Value |
|---|---|
| Spec version | v8.7.1 (Capacitor 8) |
| Docs | https://capawesome.io/docs/sdks/capacitor/live-update/ |
| Repo | https://github.com/capawesome-team/capacitor-plugins (packages/live-update) |
| npm | @capawesome/capacitor-live-update@8.7.1 |
| Last release | Active (Capacitor 6/7/8) |
| Platform | Android, iOS, Electron |

### Bundle Model

Cloud-first. Manifest managed server-side by Capawesome Cloud. SDK downloads ZIP bundles by bundleId.

fetchLatestBundle() response:

    {
      bundleId: string | null;
      artifactType?: 'manifest' | 'zip';
      channel?: string;
      checksum?: string;         // SHA-256 hex (self-hosted)
      signature?: string;        // Signed SHA-256 base64 (self-hosted)
      downloadUrl?: string;
      customProperties?: { [key: string]: string };
    }

downloadBundle() options (self-hosted):

    {
      bundleId: string;          // "public" reserved
      url: string;               // ZIP or manifest base URL
      artifactType?: 'manifest' | 'zip';
      checksum?: string;         // SHA-256 hex
      signature?: string;        // Signed SHA-256 base64
    }

### Signature Scheme

- Algorithm: RSA (PEM public key)
- Config: publicKey (PEM string in capacitor.config.json)
- Bundle sig: Signed SHA-256, base64
- Delta updates: Supported (only changed files)

### Config

    { "plugins": { "LiveUpdate": {
      "appId": "uuid", "publicKey": "PEM...", "defaultChannel": "production",
      "autoUpdateStrategy": "background", "autoBlockRolledBackBundles": false,
      "autoDeleteBundles": false, "readyTimeout": 10000, "httpTimeout": 60000,
      "serverDomain": "api.cloud.capawesome.io"
    }}}

### API (key methods)

| Method | Purpose |
|---|---|
| sync() | Download+set latest from cloud |
| fetchLatestBundle() | Check without downloading |
| downloadBundle() | Self-hosted download |
| setNextBundle() | Set for next restart |
| getCurrentBundle()/getNextBundle() | Inspect |
| reset() | Back to default (embedded) |
| reload() | Apply (web view only) |
| ready() | Mark ready (prevents rollback) |
| setChannel()/getChannel() | Channel mgmt |
| getDeviceId()/setCustomId() | Device identity |
| getConfig()/setConfig() | Runtime config |

Events: downloadBundleProgress, nextBundleSet, reloaded

### Rollback (built-in, automatic)

- readyTimeout ms: if ready() not called, auto-reset to default bundle
- autoBlockRolledBackBundles: block bad bundles (up to 100, LRU)
- Kill-safe on Electron: crash before ready() -> rollback next start
- reset(): manual

### Staged Rollout

Server-side (Capawesome Cloud). Client is channel-aware. % in cloud console.

### Install Trigger

- autoUpdateStrategy: background -> auto at startup + resume (>15min)
- autoUpdateStrategy: none -> manual sync()
- Apply: reload() (web view only) or app restart

---

## 6. Expo Updates

| Field | Value |
|---|---|
| Spec version | Protocol v1, SDK 58 |
| Docs | https://docs.expo.dev/versions/latest/sdk/updates/ |
| Protocol | https://docs.expo.dev/technical-specs/expo-updates-1.md |
| Repo | https://github.com/expo/expo (packages/expo-updates) |
| npm | expo-updates@58.0.21 |
| Last release | SDK 58 (active) |
| Platform | Android, iOS, tvOS |

### HTTP Protocol (v1)

Request headers:

    expo-protocol-version: 1
    expo-platform: ios | android
    expo-runtime-version: <string>
    expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"
    accept: application/expo+json, application/json, multipart/mixed

Response headers:

    expo-protocol-version: 1
    expo-sfv-version: 0
    expo-manifest-filters: <SFV dict>
    expo-server-defined-headers: <SFV dict>
    cache-control: private, max-age=0
    expo-signature: sig="<b64>", keyid="...", alg="..."

### Manifest Body (exact schema from spec)

    type Manifest = {
      id: string;                // UUID
      createdAt: string;         // ISO 8601
      runtimeVersion: string;    // Native compat key
      launchAsset: Asset;        // Entry point
      assets: Asset[];
      metadata: { [key: string]: string };
      extra: { [key: string]: any };
    };
    type Asset = {
      hash?: string;             // Base64URL SHA-256 (RFC 4648 s5)
      key: string;
      contentType: string;       // MIME
      fileExtension?: string;    // ".js" (leading dot)
      url: string;
    };

### Directive Body (rollback)

    type Directive = { type: string; parameters?: any; extra?: any };
    // type: "rollBackToEmbedded" -> discard downloads, use embedded

Multipart response parts: manifest + extensions + directive (all optional).

### Signature Scheme

- Algorithm: RSA (configurable: rsa-v1_5-sha256, etc.)
- Certificate: X.509, embedded in app (updates.codeSigningCertificate)
- Manifest sig: expo-signature header
- Asset integrity: SHA-256 in manifest, verified on download
- Transitive: signing manifest signs all assets
- Cert chain: root in app or OS trust store

### Runtime Version (compat gate)

Policies: appVersion, nativeVersion, fingerprint (hash of native deps).
Updates only apply to matching runtimeVersion.

### Config

| Key | Default | Purpose |
|---|---|---|
| updates.enabled | true | Toggle |
| updates.url | required | Server URL |
| runtimeVersion | required | Compat key |
| updates.checkAutomatically | ON_LOAD | ON_LOAD/ON_ERROR_RECOVERY/WIFI_ONLY/NEVER |
| updates.fallbackToCacheTimeout | 0 | ms wait before cache |
| updates.codeSigningCertificate | none | X.509 |
| updates.maxUpdatesToKeep | 2 | Device cache size |
| updates.enableBsdiffPatchSupport | true | Delta patches |

### Rollback

- Server: rollBackToEmbedded directive
- Client: isEmergencyLaunch on fallback
- Anti-bricking: failed update -> auto-fallback to embedded
- maxUpdatesToKeep: previous updates as safety net

### Staged Rollout

Server-side (EAS Update). Client stateless. Server uses expo-manifest-filters + metadata.

### Install Trigger

- Default: on launch (ON_LOAD)
- Manual: checkForUpdateAsync() -> fetchUpdateAsync() -> reloadAsync()
- Delta: bsdiff support
- Asset verification: SHA-256 match required

---

## 7. CodePush / App Center CodePush

| Field | Value |
|---|---|
| Spec version | SDK 4.2.3 (CLI), RN plugin 9.0.1 |
| Docs | https://microsoft.github.io/code-push (archived) |
| Repo | https://github.com/Microsoft/code-push, microsoft/react-native-code-push |
| npm | code-push@4.2.3, react-native-code-push@9.0.1 |
| Status | **SUNSET** - App Center retired. MS Learn docs 404. |
| Platform | Android, iOS (React Native) |

### Archived Protocol

Update manifest (from CodePush server):

    {
      "appVersion": "1.0.0",
      "label": "1",
      "description": "Bug fixes",
      "packageUri": "https://codepush.blob.core.windows.net/...",
      "packageHash": "sha256hex...",
      "packageSize": 123456,
      "mandatory": false,
      "rollbackDeploy": false
    }

Client API:
- sync(options, listener) - check+download+install
- checkForUpdate(), downloadUpdate(), installUpdate()
- getUpdateMetadata(), restartApp()
- rollbackInvalidUpdate()

Options: deploymentKey, updateDialog, installMode (IMMEDIATE/ON_NEXT_RESTART/ON_NEXT_RESUME), mandatory, rollbackTimeout

Signature: None (HTTPS + App Center auth only)

### Migration Path

| CodePush | Replacement |
|---|---|
| sync() flow | Expo: checkForUpdateAsync + fetchUpdateAsync + reloadAsync |
| deploymentKey | Expo: runtimeVersion + updates.url |
| rollback | Expo: rollBackToEmbedded directive |
| mandatory | No direct equivalent |
| staged rollout | Expo: EAS server-side |
| RN bridge | Capawesome (Capacitor) or Expo Updates (Expo/RN) |

---

## 8. PWA Service Worker Update Lifecycle

| Field | Value |
|---|---|
| Spec | W3C Service Worker Level 1 (Living Standard) |
| MDN | https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers (2026-09-25) |
| Workbox | https://developer.chrome.com/docs/workbox/ (v7, Chrome team) |
| Repo | https://github.com/GoogleChrome/workbox |
| Platform | All modern browsers (HTTPS required) |

### Lifecycle States

    register -> installing -> installed -> activating -> activated
                                   \-> (waiting if old SW controls clients)

### Update Algorithm (W3C spec)

1. Browser fetches SW script on navigation within scope (or registration.update())
2. Byte-comparison: if script changed, new SW created
3. New SW: install event fires (old SW still controls clients)
4. If event.waitUntil() resolves: state -> installed
5. If old SW has controlled clients: new SW -> waiting
6. When old clients close (or skipWaiting()): old SW retired, new SW -> activate
7. activate event: prune old caches
8. New SW controls clients. clients.claim() adopts existing pages.

### skipWaiting() + clients.claim() Interaction

- skipWaiting(): Bypasses waiting for old clients to close
- clients.claim(): Immediately takes control of existing pages
- Combined pattern:

    // In new SW:
    self.addEventListener('activate', (e) => {
      e.waitUntil(self.clients.claim());
    });
    // Page sends message:
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    // SW listens:
    self.addEventListener('message', (e) => {
      if (e.data.type === 'SKIP_WAITING') self.skipWaiting();
    });

### Workbox Recipes

workbox-window (page-side):

    import { Workbox } from 'workbox-window';
    const wb = new Workbox('/sw.js');
    wb.addEventListener('waiting', (e) => {
      if (accepted) wb.messageSkipWaiting();
    });
    wb.addEventListener('controlling', () => window.location.reload());
    wb.register();

Workbox modules:
- workbox-broadcast-update: Broadcast update events via BroadcastChannel
- workbox-background-sync: Queue failed fetches, retry when online
- workbox-expiration: TTL-based cache eviction
- workbox-precaching: precacheAndRoute() + skipWaiting option

Update flow vs Install flow:
- Install: First registration. install -> activate (immediate, no waiting).
- Update: New script. install -> waiting (or activate if skipWaiting). Old caches coexist.

### Rollback

None built-in. Browser has no "rollback" concept. If new SW fails install, discarded, old SW remains.

### Staged Rollout

None built-in. Server-side only (CDN A/B, feature flags).

---

## 9. Microsoft AppInstaller (MSIX)

| Field | Value |
|---|---|
| Spec version | Schema 2017 (1709), 2017/2 (1803), 2018 (1809), 2021 (21H2) |
| Docs | https://learn.microsoft.com/en-us/windows/msix/app-installer/ |
| Schema ref | https://learn.microsoft.com/en-us/uwp/schemas/appinstallerschema/app-installer-file |
| Platform | Windows 10 1709+ / Windows 11 |
| Status | **Active** (built into OS, updated 2026-04) |

### AppInstaller XML Schema

File: *.appinstaller (XML)

    <AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2017"
                  xmlns:s2="http://schemas.microsoft.com/appx/appinstaller/2017/2"
                  xmlns:s3="http://schemas.microsoft.com/appx/appinstaller/2018"
                  xmlns:s4="http://schemas.microsoft.com/appx/appinstaller/2021">
      <MainPackage Name="MyApp" Publisher="CN=MyCompany"
                   Version="1.2.3.0" Uri="https://cdn.example.com/myapp-1.2.3.msix" />
      <s2:UpdateSettings>
        <s2:OnLaunch s2:HoursBetweenUpdateChecks="24"
                     s2:ShowPrompt="true" s2:UpdateBlocksActivation="false" />
        <s2:AutomaticBackgroundTask />
        <s3:ForceUpdateFromAnyVersion />
      </s2:UpdateSettings>
    </AppInstaller>

### UpdateSettings Element

| Element | Min Win Ver | Purpose |
|---|---|---|
| OnLaunch | 1709 | Check on app launch |
| OnLaunch:HoursBetweenUpdateChecks | 1803 | Hours between checks (0-255, default 24) |
| OnLaunch:ShowPrompt | 1903 | Show UI (bool) |
| OnLaunch:UpdateBlocksActivation | 1903 | Must update before launch (needs ShowPrompt=true) |
| AutomaticBackgroundTask | 1803 | Background check every 8h, NO UI |
| ForceUpdateFromAnyVersion | 1903 | Allow downgrade |

### Two Update Modes

1. OnLaunch: User-initiated. Can show UI. Configurable interval + prompt.
   - ShowPrompt=true + UpdateBlocksActivation=true: Must update or close
   - ShowPrompt=true + UpdateBlocksActivation=false: Can skip, update later
   - ShowPrompt=false: Silent background update on launch

2. AutomaticBackgroundTask: System-initiated. Every 8 hours. No UI.

Both can coexist (union of behaviors).

### Mandatory vs Optional

- Mandatory: ShowPrompt=true + UpdateBlocksActivation=true
- Optional: ShowPrompt=false or UpdateBlocksActivation=false

### Rollback

No built-in rollback. ForceUpdateFromAnyVersion allows downgrade (server serves lower version).

### ms-appinstaller: URI Protocol

DISABLED by default since December 2023. Link directly to .appinstaller file.

### Signing

- MSIX: Authenticode (EV/OV cert)
- AppInstaller verifies package sig against Publisher attribute
- .appinstaller file itself is unsigned (HTTPS/SMB protection)

---

## CROSS-ENGINE COMPARISON TABLE

| Aspect | Squirrel | Sparkle | e-updater | Tauri | Capawesome | Expo | CodePush | PWA SW | AppInstaller |
|---|---|---|---|---|---|---|---|---|---|
| Feed format | Plain text | XML (RSS) | YAML | JSON | Cloud API | JSON | JSON | Byte-compare | XML |
| Integrity | SHA1 | EdDSA+SHA256 | SHA-512 | Ed25519+SHA | RSA+SHA-256 | RSA+SHA-256 | SHA-256 | N/A | Authenticode |
| Manifest sig | None | EdDSA (opt) | None | Ed25519 (req) | RSA (opt) | RSA (opt) | None | N/A | None |
| Delta | bsdiff | Binary delta | Blockmap | None | Delta files | bsdiff | None | N/A | None |
| Rollout | # nn% | Phased (7 gr) | stagingPct | None | Cloud % | Server-side | Server % | None | None |
| Rollback | None | None | None | Comparator | Auto(readyTO) | Directive | rollbackInv | None | ForceAnyVer |
| Channels | Separate files | sparkle:channel | Channel name | Custom target | Channel | metadata | deploymentKey | None | None |
| Status | UNMAINTAINED | ACTIVE | ACTIVE | ACTIVE | ACTIVE | ACTIVE | SUNSET | STANDARD | ACTIVE |

---

## MINIMUM VIABLE SUBSET FOR AIRIZ UNIFIED LAYER

Based on cross-engine analysis, the minimum viable protocol for a unified AIRIZ release layer:

### 1. Manifest Schema (JSON - superset of Tauri + Expo + electron-updater)

    {
      "version": "1.2.3",
      "pub_date": "2026-01-15T00:00:00Z",
      "notes": "Release notes",
      "signature": "base64...",
      "platforms": {
        "windows-x86_64": { "url": "...", "signature": "...", "sha256": "..." },
        "darwin-aarch64": { "url": "...", "signature": "...", "sha256": "..." },
        "linux-x86_64":   { "url": "...", "signature": "...", "sha256": "..." },
        "android":        { "url": "...", "signature": "...", "sha256": "..." },
        "ios":            { "url": "...", "signature": "...", "sha256": "..." },
        "web-pwa":        { "url": "...", "sha256": "..." }
      },
      "runtimeVersion": "1.0.0",
      "metadata": {
        "channel": "production",
        "stagingPercentage": 100,
        "mandatory": false,
        "minVersion": "1.0.0"
      },
      "rollback": {
        "action": "none",
        "targetVersion": null,
        "readyTimeout": 0
      }
    }

Field provenance:
- version, pub_date, notes, platforms: Tauri static JSON
- runtimeVersion: Expo compat gate
- signature (manifest-level): Tauri + Sparkle Ed25519 pattern
- sha256 per platform: Expo asset hash pattern
- metadata.channel: Sparkle channel + Capawesome channel
- metadata.stagingPercentage: electron-updater + Squirrel
- metadata.mandatory: CodePush + AppInstaller UpdateBlocksActivation
- metadata.minVersion: Sparkle minimumUpdateVersion
- rollback.action: Expo rollBackToEmbedded + Capawesome auto-rollback
- rollback.readyTimeout: Capawesome readyTimeout

### 2. Signature Scheme (recommended)

**Ed25519** (Tauri + Sparkle pattern):
- Base64 of raw 64-byte detached signature
- Single public key embedded in app config
- Sign the entire manifest JSON (covers all platform URLs + hashes)
- Per-asset: SHA-256 in manifest (Expo pattern)
- Key rotation: embed both old+new pubkey in transition release

Alternative: **RSA-2048 + X.509** (Expo + Capawesome pattern):
- More infrastructure (cert chain) but familiar to enterprise
- Manifest signed, assets verified by hash in manifest

### 3. Server Protocol (HTTP)

    GET /v1/check?platform=windows-x86_64&version=1.2.3&channel=production
    Headers: X-AIRIZ-Protocol: 1, Authorization: Bearer <token>

    200: { manifest JSON }
    204: No update available
    426: Protocol version upgrade required

### 4. Update Flow (unified)

    check() -> manifest -> verify signature -> verify per-asset SHA-256
    -> download (with delta support) -> verify -> install -> ready()

    ready() timeout -> auto-rollback (Capawesome pattern)
    Server directive -> forced rollback (Expo pattern)

### 5. What to Skip

- Squirrel: UNMAINTAINED, SHA1-only, no manifest signing. Skip.
- AppInstaller: OS-level, requires MSIX packaging. Use as Win distribution wrapper, not protocol.
- PWA SW: Browser-managed, no external protocol. Use Workbox for PWA asset updates.
- CodePush: DEAD. Protocol archived, service gone.
- Sparkle: macOS-only, XML-based. Use Ed25519 signing pattern, not the protocol.

### 6. Platform Wrappers

| Platform | Wrapper | AIRIZ Manifest Maps To |
|---|---|---|
| Windows (Electron) | electron-updater GenericProvider | platforms.windows-x86_64 + latest.yml |
| Windows (Tauri) | tauri-plugin-updater | platforms.windows-x86_64 + static JSON |
| Windows (MSIX) | AppInstaller .appinstaller | platforms.windows-x86_64 as MainPackage.Uri |
| macOS (Sparkle) | Sparkle appcast | Generate appcast FROM AIRIZ manifest |
| macOS (Tauri) | tauri-plugin-updater | platforms.darwin-aarch64 |
| Android (Capacitor) | Capawesome LiveUpdate | platforms.android as bundle |
| Android (Expo/RN) | expo-updates | platforms.android + assets[] |
| iOS (Capacitor) | Capawesome LiveUpdate | platforms.ios as bundle |
| iOS (Expo/RN) | expo-updates | platforms.ios + assets[] |
| Web PWA | Workbox + custom SW | platforms.web-pwa (SW script + precache) |
| CF Worker | Custom fetch handler | Serves AIRIZ manifest + check endpoint |

---

## SOURCE CITATIONS

| Engine | Primary Source | URL |
|---|---|---|
| Squirrel | GitHub docs (jsDelivr) | cdn.jsdelivr.net/gh/Squirrel/Squirrel.Windows@master/docs/ |
| Squirrel | Staged rollouts | .../docs/using/staged-rollouts.md |
| Squirrel | NuGet metadata | .../docs/using/nuget-package-metadata.md |
| Squirrel | Delta packages | .../docs/using/delta-packages.md |
| Squirrel | Signing | .../docs/using/application-signing.md |
| Squirrel | Update manager | .../docs/using/update-manager.md |
| Squirrel | Update process | .../docs/using/update-process.md |
| Squirrel | FAQ | .../docs/faq.md |
| Sparkle | Publishing docs | sparkle-project.org/documentation/publishing/ |
| Sparkle | Basic setup | sparkle-project.org/documentation/ |
| electron-updater | Provider source | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/providers/Provider.js |
| electron-updater | Provider types | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/providers/Provider.d.ts |
| electron-updater | GitHubProvider | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/providers/GitHubProvider.d.ts |
| electron-updater | GenericProvider | cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/providers/GenericProvider.d.ts |
| electron-updater | UpdateInfo type | cdn.jsdelivr.net/npm/builder-util-runtime@9.7.0/out/updateInfo.d.ts |
| Tauri | Plugin docs | tauri.app/plugin/updater/ (Nov 28, 2025) |
| Tauri | JS types | cdn.jsdelivr.net/npm/@tauri-apps/plugin-updater@2.14.1/dist-js/index.d.ts |
| Tauri | package.json | cdn.jsdelivr.net/npm/@tauri-apps/plugin-updater@2.14.1/package.json |
| Capawesome | Full docs | capawesome.io/docs/sdks/capacitor/live-update/ |
| Capawesome | TS definitions | cdn.jsdelivr.net/npm/@capawesome/capacitor-live-update@8.7.1/dist/esm/definitions.d.ts |
| Capawesome | package.json | cdn.jsdelivr.net/npm/@capawesome/capacitor-live-update@8.7.1/package.json |
| Expo | Protocol spec | docs.expo.dev/technical-specs/expo-updates-1.md (2026-08-12) |
| Expo | SDK docs | docs.expo.dev/versions/latest/sdk/updates/ |
| Expo | TS types | cdn.jsdelivr.net/npm/expo-updates@58.0.21/build/Updates.types.d.ts |
| Expo | package.json | cdn.jsdelivr.net/npm/expo-updates@58.0.21/package.json |
| CodePush | npm CLI | cdn.jsdelivr.net/npm/code-push@4.2.3/package.json |
| CodePush | RN plugin | cdn.jsdelivr.net/npm/react-native-code-push@9.0.1/package.json |
| PWA | MDN guide | developer.mozilla.org (2026-09-25) |
| PWA | Workbox lifecycle | developer.chrome.com/docs/workbox/service-worker-lifecycle |
| PWA | Workbox updates | developer.chrome.com/docs/workbox/handling-service-worker-updates |
| AppInstaller | Update settings | learn.microsoft.com/.../app-installer/update-settings (2026-04-15) |
| AppInstaller | File overview | learn.microsoft.com/.../app-installer-file-overview (2026-04-17) |
| AppInstaller | XML schema | learn.microsoft.com/.../appinstallerschema/app-installer-file |
| AppInstaller | Root docs | learn.microsoft.com/.../app-installer-root (2026-04-15) |
