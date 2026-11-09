# Source-Code Deep Dive: electron-updater vs @capawesome/capacitor-live-update

> **Generated:** 2026-11-07 | **Method:** Direct source fetch from master/main branches
> **Scope:** READ-ONLY survey. All file paths, function names, and field names are cited to fetched source.

---

## A. electron-updater (electron-userland/electron-builder)

### A.1 Repo URL + Version + Commit + Issues

| Attribute | Value | Source |
|-----------|-------|--------|
| **Repo URL** | https://github.com/electron-userland/electron-builder | package.json "repository.url" |
| **Package path** | packages/electron-updater/ | monorepo layout |
| **npm name** | electron-updater | package.json "name" |
| **Version (master)** | 7.0.0-alpha.13 | packages/electron-updater/package.json -> "version" |
| **Stable published** | v6.x (electron-builder v26) -> v7.0.0 (electron-builder v27) | README: "v27 is a major release with breaking changes" |
| **Open issues (monorepo)** | 15 | GitHub issues count (2026-11-07) |
| **License** | MIT | package.json "license" |
| **Node requirement** | >=22.12.0 | package.json "engines.node" |
| **Type** | ESM ("type": "module") | package.json "type" |

**Core dependencies** (package.json):
- uilder-util-runtime (workspace) - HTTP executor, UpdateInfo types, signature utilities
- s-extra ^11.3.4 - file operations
- js-yaml ^4.3.2 - YAML parsing of latest.yml
- semver ~7.7.3 - version comparison
- 	iny-typed-emitter ^2.1.0 - event emitter base

**File tree** (packages/electron-updater/src/):
`
AppUpdater.ts              (1938 lines) - main update logic, staging, manifest signature
BaseUpdater.ts             - install lifecycle, quit hooks, spawn helpers
NsisUpdater.ts             - Windows NSIS-specific
MacUpdater.ts              - macOS Squirrel.Mac-specific
AppImageUpdater.ts         - Linux AppImage
DebUpdater.ts / RpmUpdater.ts / PacmanUpdater.ts - Linux package targets
DownloadedUpdateHelper.ts  - cache dir, pending install marker, sha512 validation
ElectronAppAdapter.ts      - Electron app abstraction
providerFactory.ts         - provider selection switch
providers/
  Provider.ts              - base class, parseUpdateInfo, resolveFiles, getChannelFilename
  GenericProvider.ts       - S3/Spaces/R2/Generic
  GitHubProvider.ts        - GitHub Releases (Atom feed + tag)
  PrivateGitHubProvider.ts - GitHub with token (Enterprise)
  GitLabProvider.ts        - GitLab Releases
  BitbucketProvider.ts     - Bitbucket Pipelines
  KeygenProvider.ts        - Keygen (deprecated service)
differentialDownloader/
  DifferentialDownloader.ts - base class, blockMapSizeLimit
  GenericDifferentialDownloader.ts - blockmap-based partial download
  FileWithEmbeddedBlockMapDifferentialDownloader.ts - embedded blockmap
  downloadPlanBuilder.ts   - computes which blocks to download
  multipleRangeDownloader.ts - HTTP Range multi-part download
  blockMapV3Fetcher.ts     - v3 blockmap format
types.ts                   - UpdateInfo re-exports, events, VerifyUpdateFile
util.ts                    - getChannelFilename, newBaseUrl, newUrlFromBase
windowsExecutableCodeSignatureVerifier.ts - Authenticode check
electronHttpExecutor.ts    - Electron net module HTTP

### A.2 Manifest Types + Field Schema

**Channel file naming** (packages/electron-updater/src/util.ts line 32):
`	ypescript
export function getChannelFilename(channel: string): string {
  return ${channel}.yml
}
`

**Platform suffix** (packages/electron-updater/src/providers/Provider.ts, method getChannelFilePrefix()):
`	ypescript
private getChannelFilePrefix(): string {
  if (this.runtimeOptions.platform === "linux") {
    const arch = process.env["TEST_UPDATER_ARCH"] || process.arch
    const archSuffix = arch === "x64" ? "" : -
    return "-linux" + archSuffix
  } else {
    return this.runtimeOptions.platform === "darwin" ? "-mac" : ""
  }
}
`

**Default channel** (Provider.ts, method getDefaultChannelName()):
`	ypescript
protected getDefaultChannelName(): string {
  return this.getCustomChannelName("latest")
}
// Windows:  "latest"        -> "latest.yml"
// macOS:    "latest-mac"    -> "latest-mac.yml"
// Linux x64:"latest-linux"  -> "latest-linux.yml"
// Linux arm64: "latest-linux-arm64" -> "latest-linux-arm64.yml"
`

**Parsable types:** YAML (parsed by js-yaml in Provider.parseUpdateInfo()). Also supports gzipped YAML
(the gunzipSync import in AppUpdater.ts confirms latest.yml.gz support).

**Complete field schema** (reconstructed from parseUpdateInfo consumer in AppUpdater.ts, NsisUpdater.ts,
MacUpdater.ts, and esolveFiles in Provider.ts):

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| ersion | string (SemVer) | **Yes** | - | Compared via semver.gt() in isUpdateAvailable() |
| iles | Array<UpdateFileInfo> | **Yes** (or legacy path) | - | Parsed by getFileList() in Provider.ts |
| iles[].url | string | **Yes** | - | May be relative to feed base URL |
| iles[].sha512 | string (base64) | **Yes** (unless sha2 present) | - | Verified after download |
| iles[].size | number (bytes) | No | - | Used for progress |
| iles[].arch | string | No | - | For multi-arch feeds |
| iles[].blockMapUrl | string | No | - | v27+: URL to blockmap (covered by signature) |
| iles[].isAdminRightsRequired | boolean | No | alse | NSIS per-machine |
| path | string | **Yes** (legacy) | - | Single-file mode; fallback when iles absent |
| sha512 | string (base64) | **Yes** (legacy, win) | - | SHA-512 of path |
| size | number | No | - | |
| eleaseDate | string (ISO 8601) | Emitted by builder | now() | Display only |
| stagingPercentage | number (0-100) | No | 100 (implicit) | Staged rollout gate |
| minimumSystemVersion | string | No | - | OS version floor (checked by checkIfUpdateSupported) |
| signature | string (base64) | No (v27+) | - | Legacy single Ed25519 sig |
| signatures | Array<{value, keyId}> | No (v27+) | - | v27+ key-rotation array |
| packages | object (win, NSIS web) | No | - | Per-arch web installer package |

**Blockmap** (NOT a field in latest.yml):
- Sibling file: <installer-filename>.blockmap
- Resolved in Provider.getBlockMapFiles():
`	ypescript
getBlockMapFiles(baseUrl: URL, oldVersion: string, newVersion: string, oldBlockMapFileBaseUrl: string | null = null): URL[] {
  const newBlockMapUrl = newUrlFromBase(${baseUrl.pathname}.blockmap, baseUrl)
  const oldBlockMapUrl = newUrlFromBase(
    ${baseUrl.pathname.replace(new RegExp(escapeRegExp(newVersion), "g"), oldVersion)}.blockmap,
    oldBlockMapFileBaseUrl ? new URL(oldBlockMapFileBaseUrl) : baseUrl
  )
  return [oldBlockMapUrl, newBlockMapUrl]
}
`

### A.3 Provider Implementations

**Factory** (packages/electron-updater/src/providerFactory.ts):

| Provider name in config | Class | Manifest URL resolution | Download URL resolution |
|------------------------|-------|------------------------|------------------------|
| generic | GenericProvider | aseUrl + getChannelFilename(channel) e.g. https://host/latest.yml | aseUrl + files[].url |
| s3 / spaces / 2 | GenericProvider (wrapped) | Same as generic, but base URL from getS3LikeProviderBaseUrl(data) (e.g. https://<bucket>.s3.<region>.amazonaws.com) | Same, isUseMultipleRangeRequest: false |
| github | GitHubProvider | https://github.com/{owner}/{repo}/releases/download/{tag}/{channelFile} | Same path with iles[].url |
| github (with token) | PrivateGitHubProvider | Same as github | Same |
| gitlab | GitLabProvider | {host}/api/v4/projects/{id}/packages/generic/{channelFile} | {host}/api/v4/projects/{id}/packages/generic/{version}/{file} |
| itbucket | BitbucketProvider | Bitbucket Pipelines API | Bitbucket Pipelines artifact URL |
| keygen | KeygenProvider | https://api.keygen.app/v1/accounts/{account}/artifacts... | Keygen artifact URL |
| custom | user-provided constructor | User-defined | User-defined |

**GenericProvider.getLatestVersion()** (exact code, providers/GenericProvider.ts):
`	ypescript
async getLatestVersion(): Promise<UpdateInfo> {
  const channelFile = getChannelFilename(this.channel)
  const channelUrl = newUrlFromBase(channelFile, this.baseUrl, this.updater.isAddNoCacheQuery)
  for (let attemptNumber = 0; ; attemptNumber++) {
    try {
      return parseUpdateInfo(await this.channelFileRequest(channelUrl), channelFile, channelUrl)
    } catch (e: any) {
      if (e instanceof HttpError && e.statusCode === 404) {
        throw newError(Cannot find channel "" update info: ,
          "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")
      } else if (e.code === "ECONNREFUSED") {
        if (attemptNumber < 3) { await new Promise(resolve => setTimeout(resolve, 1000 * attemptNumber)); continue }
      }
      throw e
    }
  }
}
`

**GitHubProvider.getLatestVersion()** (key excerpt, providers/GitHubProvider.ts):
`	ypescript
async getLatestVersion(): Promise<GithubUpdateInfo> {
  // 1. Fetch Atom feed to enumerate releases
  const feedXml = (await this.httpRequest(newUrlFromBase(${this.basePath}.atom, this.baseUrl), ...))!
  // 2. Find latest tag via /releases/latest API (public) or Atom feed (allowPrerelease)
  // 3. Fetch channel file from release assets:
  const { rawData, channelFile, channelFileUrl } = await this.fetchChannelFile(tag, cancellationToken)
  const result = parseUpdateInfo(rawData, channelFile, channelFileUrl)
  // 4. Download path: /releases/download/{tag}/{fileName}
}
// resolveFiles uses: getBaseDownloadPath(tag, p) => ///releases/download//
`

**No native "snapStore" provider** exists in the source. The snap target in electron-builder is
handled at build time (crafting .snap + snapcraft.yaml), not by a distinct updater provider at runtime.

### A.4 Authenticity: v27+ Ed25519 Manifest Signatures

**Verification code path** (AppUpdater.ts, method erifyManifestSignature()):

`	ypescript
private async verifyManifestSignature(info: UpdateInfo): Promise<boolean> {
  let trustedKeys = normalizePublicKeyList(this.updateManifestPublicKey)
  if (trustedKeys.length === 0) {
    trustedKeys = normalizePublicKeyList((await this.configOnDisk.value)?.updateManifestPublicKey)
  }
  if (trustedKeys.length === 0) {
    // opt-in phase: no key = verification skipped, warn once
    return false
  }
  if (collectManifestSignatures(info).length === 0) {
    throw newError(...not signed..., "ERR_UPDATER_MANIFEST_NOT_SIGNED")
  }
  const result = verifyManifestSignatures(info, trustedKeys)
  if (!result.ok) {
    throw newError(...verification failed..., "ERR_UPDATER_MANIFEST_SIGNATURE_INVALID")
  }
  return true
}
`

- **Public key source:** utoUpdater.updateManifestPublicKey (runtime) OR updateManifestPublicKey in pp-update.yml
- **Key format:** PEM or base64 SPKI DER (Ed25519)
- **Signature fields in manifest:** signature (legacy single) + signatures[] (array of {value, keyId})
- **Verification library:** uilder-util-runtime exports collectManifestSignatures() and erifyManifestSignatures()
- **Fail-closed:** Once any key is configured, an unsigned manifest is REJECTED
- **Key rotation:** Array allows multiple signatures; any one verifying is sufficient
- **Pre-v27 fallback:** No manifest signature check existed. Trust = HTTPS + Authenticode code signature of the installer.

**Windows installer Authenticode** (NsisUpdater.ts + windowsExecutableCodeSignatureVerifier.ts):
- Uses PowerShell Get-AuthenticodeSignature to verify the .exe
- Publisher names from pp-update.yml publisherName field
- Rejects if no publisherName configured (fail-closed since v27)
- Optional bypass: erifyUpdateCodeSignature: false in app-update.yml
### A.5 Integrity: SHA-512 + Blockmap Differential

**SHA-512 file hash** (DownloadedUpdateHelper.ts, getValidCachedUpdateFile):
`	ypescript
const sha512 = await hashFile(updateFile)
if (fileInfo.info.sha512 !== sha512) {
  this.logger.warn('Sha512 checksum mismatch')
  await this.cleanCacheDirForPendingUpdate()
  return null
}
`
- Hash: hashFile() from builder-util-runtime (SHA-512, base64 output)
- Checked on: fresh download, cached reuse, pending-install-on-next-launch

**Blockmap differential download** (differentialDownloader/):
- Files: DifferentialDownloader.ts, GenericDifferentialDownloader.ts, FileWithEmbeddedBlockMapDifferentialDownloader.ts
- Algorithm: compare old/new blockmaps -> identify changed blocks -> HTTP Range download changed bytes
- Multiple Range Requests disabled for S3/Spaces/R2/GitHub (isUseMultipleRangeRequest: false)
- Fallback: differential failure -> full download
- Blockmap v3: blockMapV3Fetcher.ts

**NsisUpdater differential flow:**
`	ypescript
if (isWebInstaller || disableDifferentialDownload ||
  (await this.differentialDownloadInstaller(...))) {
  await this.httpExecutor.download(fileInfo.url, destinationFile, downloadOptions)
}
`
Boolean return means "failed, do full download".

### A.6 Cache/Staging + Resume + Quarantine

**Cache directory:**
- Path: app.baseCachePath + updaterCacheDirName (from app-update.yml)
- Windows: typically %LOCALAPPDATA%/{app-name}/update/
- Sub-dir: pending/ for installer + update-info.json

**update-info.json schema:**
`	ypescript
{ fileName, sha512, isAdminRightsRequired, packageFileName?, version? }
`

**Partial download:**
- Temp file -> real name ONLY after verification passes
- Interrupted: temp file orphaned, next check re-downloads
- No HTTP resume for full downloads
- Blockmap IS the resume mechanism

**Quarantine equivalent:**
- File stays in pending/ dir until installed
- Windows: NSIS extracts to versioned install dir from cache
- macOS: Squirrel.Mac ShipIt extracts to temp, atomic rename

### A.7 App-Quit Timing

**autoInstallEvent** (types.ts):
`	ypescript
export type AutoInstallEvent = "manual" | "onQuit" | "onNextLaunch"
`

| Mode | Behavior |
|------|----------|
| onQuit (default) | Spawn installer on quit. Detached process. |
| onNextLaunch | Persist marker. Next launch: re-validate, re-verify, install. |
| manual | Never auto-install. Explicit quitAndInstall() only. |

**Windows NSIS** (NsisUpdater.ts doInstall):
`	ypescript
const args = ["--updated"]
if (options.isSilent) args.push("/S")
if (options.isForceRunAfter) args.push("--force-run")
// Per-user: spawnLog(installerPath, args)
// Per-machine: spawnLog("elevate.exe", [installerPath, ...args])
`
- spawnLog: detached:true + p.unref() -> survives app exit

**macOS Squirrel.Mac** (MacUpdater.ts):
- Electron autoUpdater (Squirrel.Mac native)
- Proxy server (localhost HTTP + Basic Auth) feeds zip to ShipIt
- ShipIt applies update on next launch after quit
- quitAndInstall: this.nativeUpdater.quitAndInstall()

**quitAndInstall options:** { isSilent?, isForceRunAfter?, waitUntilNextLaunch? }

### A.8 Rollback: NO Native Rollback

**No built-in rollback.** No rollback function, no revert command, no previous-version retention.

| Scenario | Outcome |
|----------|---------|
| sha512 mismatch | Detected, pending dir cleared. App continues old version. |
| Partial download + crash | Temp orphaned. Next check re-downloads. No corruption. |
| Kill app mid-NSIS-install | NSIS detached. May leave partial install (issue #6869). onNextLaunch mitigates. |
| OS session ends mid-install | isSessionEnding: install skipped. Update stays cached. |
| macOS ShipIt crash | Staged extraction (temp + atomic rename). Old .app intact. |
| Bad version deployed | Server-side: replace latest.yml + ship higher version. Or allowDowngrade. |

**onNextLaunch mitigation** (v27+): prevents #7807 (Windows kills detached installer during session end). Re-validates sha512 + code signature before install on next launch.

### A.9 Channels: How the Channel File is Picked

**Precedence** (GenericProvider.ts):
1. autoUpdater.channel (runtime)
2. channel in app-update.yml / setFeedURL() options
3. Default: "latest" -> latest.yml / latest-mac.yml / latest-linux.yml

**GitHub provider** (GitHubProvider.ts):
- allowPrerelease: scans Atom feed for highest eligible semver
- isEligibleForChannel: alpha sees stable+alpha+beta; beta sees stable+beta; stable sees stable
- Fallback: if channel file 404s and allowPrerelease, tries latest.yml

**latest-*-full.yml:** NOT an electron-updater concept. That is Squirrel.Windows artifact naming.

### A.10 Staged Rollout: stagingPercentage

**Field:** stagingPercentage in latest.yml (int 0-100)

**Client decision** (AppUpdater.ts isStagingMatch):
`	ypescript
const stagingPercentage = updateInfo.stagingPercentage / 100
const stagingUserId = await this.stagingUserIdPromise.value
const val = UUID.parse(stagingUserId).readUInt32BE(12)
const percentage = val / 0xffffffff
return percentage < stagingPercentage
`

- UUID generated once, persisted, sent as x-user-staging-id header
- Bytes 12-15 of UUID -> uint32BE / 0xFFFFFFFF = deterministic 0..1 per user
- STICKY: same user always same cohort
- Server ramps: change stagingPercentage in latest.yml (10 -> 50 -> 100)
- Overridable: autoUpdater.isUserWithinRollout = customFn

---

## B. @capawesome/capacitor-live-update

### B.1 Repo URL + Version + Commit

| Attribute | Value | Source |
|-----------|-------|--------|
| **Repo URL** | https://github.com/capawesome-team/capacitor-plugins | package.json + README |
| **Package path** | packages/live-update/ | monorepo layout |
| **npm name** | @capawesome/capacitor-live-update | package.json |
| **Version (master)** | 8.7.1 | LiveUpdatePlugin.java VERSION constant |
| **Previous alias** | @capgo/capacitor-updater (deprecated, pre-v5) | README migration guides |
| **Platforms** | Android, iOS, Electron | README + code |
| **Capacitor support** | 6/7/8 | README compatibility table |
| **License** | MIT | package.json |
| **Older alias repo** | github.com/Cap-go/capacitor-updater (archived) | README migration |

**Key version constant** (LiveUpdatePlugin.java line 50):
`java
public static final String VERSION = "8.7.1";
`

**Compatibility table** (README):
| Plugin | Capacitor | Status |
|--------|-----------|--------|
| 8.x.x | >=8.x.x | Active support |
| 7.x.x | 7.x.x | Maintenance |
| 6.x.x | 6.x.x | Maintenance |
| 5.x.x | 5.x.x | Deprecated |

### B.2 Manifest Format: Cloud + Self-Hosted

**Two delivery paths exist:**

**Path 1: Capawesome Cloud (default)**
- App calls fetchLatestBundle() or sync()
- HTTP GET to: https://{serverDomain}/v1/apps/{appId}/bundles/latest
  - serverDomain default: api.cloud.capawesome.io (configurable via serverDomain)
- Query params: appVersionCode, appVersionName, bundleId, channelName, customId, deviceId, osVersion, platform, pluginVersion
- Response: JSON with artifactType, bundleId, channel, checksum, signature, downloadUrl, customProperties

**Path 2: Self-hosted (downloadBundle)**
- No manifest fetch from cloud. Developer calls downloadBundle({url, bundleId, checksum?, signature?})
- url points to a ZIP file or a manifest base URL
- For artifactType="zip": downloads the ZIP directly, verifies checksum + signature
- For artifactType="manifest": downloads a manifest JSON listing individual files, then fetches each file
  - Manifest filename: capawesome-live-update-manifest.json
  - Each file URL: {baseUrl}?href={file-path}
  - Server should return X-Checksum (SHA-256 hex) and X-Signature (base64 RSA sig) headers per file

**There is NO public static bundle.json schema.** The "manifest" is an internal cloud record or
a self-hosted file list. The client-facing API is the downloadBundle/fetchLatestBundle methods.

### B.3 Bundle Format: ZIP + Server Interceptor

**Bundle format:**
- **zip** (default): A ZIP archive of web assets (the dist/ folder). Must contain an index.html.
- **manifest**: Individual files served from a base URL (delta-style, only changed files downloaded)

**Bundle swap mechanism** (how app switches from built-in to downloaded):
1. On Android: Capacitor uses a WebViewLocalServer. The plugin changes the server path
   via setCurrentCapacitorServerPath(path) to point to the bundle directory.
2. The WebView then loads from the new path (bundle files) instead of the built-in assets.
3. On reload() or next app launch, the new bundle is active.
4. On iOS: Similar mechanism via WKWebView URL modification.

**Key code** (LiveUpdate.java reload method):
`java
public void reload() {
  String path = getNextCapacitorServerPath();
  setCurrentCapacitorServerPath(path);
  startRollbackTimer();
}
`

**Bundle directory structure on Android:**
- Downloads: context.getCacheDir() + /capawesome_capacitor_live_update_downloads/
- Bundles: context.getFilesDir() + /_capacitor_live_update_bundles/{bundleId}/
- Each bundle dir contains the web assets with index.html at root

### B.4 Authenticity: RSA/PEM Bundle Signing

**Key verification code** (LiveUpdate.java createPublicKeyFromString + verifyFile):
`java
private PublicKey createPublicKeyFromString(String value) throws Exception {
  value = value.replace("-----BEGIN PUBLIC KEY-----", "")
               .replace("-----END PUBLIC KEY-----", "").replace("\n", "");
  byte[] byteKey = Base64.decode(value, Base64.DEFAULT);
  X509EncodedKeySpec X509publicKey = new X509EncodedKeySpec(byteKey);
  KeyFactory keyFactory = KeyFactory.getInstance("RSA");
  return keyFactory.generatePublic(X509publicKey);
}
`

**Verification flow** (downloadAndVerifyFile method):
1. Download file to disk
2. Compute SHA-256 checksum of the file
3. If checksum provided (or from X-Checksum response header): compare -> reject on mismatch
4. If signature provided (or from X-Signature response header):
   - Verify RSA signature over the SHA-256 hash using the configured public key
   - KeyFactory.getInstance("RSA") -> PKCS1v15 with SHA-256
5. Both checks must pass for the file to be accepted

**Configuration:** publicKey field in Capacitor config (PEM-encoded RSA public key)
- **RSA, not Ed25519.** v8.x hard-requires RSA in publicKey.
- No manifest-level signing (the cloud response is trusted via HTTPS + TLS)
- No channel-level signing (channel assignment is a cloud-side operation)

**Self-hosted verification** (from DownloadBundleOptions docs):
- checksum: SHA-256 hex of the ZIP
- signature: Base64 RSA signature of the SHA-256 hash
- For manifest type: server returns X-Checksum / X-Signature headers per file

### B.5 Channels: Production/Staging/Custom

**Channel resolution precedence** (from getChannel() docs + LiveUpdate.java):
1. sync({channel}) parameter (per-call, not persisted) - highest
2. setChannel() (persisted in SharedPreferences / UserDefaults)
3. Native config:
   - iOS: CapawesomeLiveUpdateDefaultChannel in Info.plist
   - Android: capawesome_live_update_default_channel in strings.xml / build.gradle resValue
   - Electron: defaultChannel in capacitor.electron.config.ts
4. Capacitor config defaultChannel

**Versioned channels:** Can tie channel to version code, e.g. production-5 (only devices
with versionCode >= 5 get production-5 channel bundles).

**Server-side % rollout:** Managed entirely in Capawesome Cloud dashboard.
- The client does NOT see or compute a percentage
- The cloud API returns the bundle the device is eligible for (server decides based on
  device ID, channel, rollout percentage, forced assignments)
- No client-side stagingPercentage equivalent

### B.6 Cache: Device Storage, Atomic Swap, Rollback

**Bundle storage locations** (Android, from LiveUpdate.java):
`java
private final String bundlesDirectory = "_capacitor_live_update_bundles";
private final String downloadsDirectory = "capawesome_capacitor_live_update_downloads";
// bundles: context.getFilesDir() + "/" + bundlesDirectory
// downloads: context.getCacheDir() + "/" + downloadsDirectory
`

**Atomic swap:**
- New bundle extracted to a TEMP directory first (UUID-named subdirectory in downloads)
- Verification (checksum + signature) happens BEFORE the bundle is moved to the bundles dir
- Bundle directory rename is the atomic step: indexHtmlFile.getParentFile().renameTo(bundleDirectory)
- If rename fails (concurrent download), the bundle is not registered
- The WebView server path change (setCurrentCapacitorServerPath) is the activation step

**Rollback mechanism (readyTimeout):**
- On app start / after reload(), a rollback timer starts (readyTimeout ms, default 0 = disabled)
- If ready() is NOT called within the timeout, the plugin:
  1. Sets rollbackPerformed = true
  2. Resets to the default (built-in) bundle
  3. On next ready() call, blocks the rolled-back bundle (if autoBlockRolledBackBundles)
- Rollback timer pauses when app goes to background (handleOnStop) and resumes on foreground
- Kill-safe: if app is killed before ready(), rollback happens on next app start
- **No automatic crash-based rollback** - only timeout-based

**Kill switch:**
- reset() -> sets next bundle to null (default bundle)
- autoBlockRolledBackBundles: up to 100 bundles blocked (oldest unblocked first)
- Blocked bundles are skipped in future sync() operations

**Bundle cleanup:**
- autoDeleteBundles: deletes unused bundles after ready()
- tryDeleteUnusedBundle: deletes bundle if not current and not next

### B.7 Native Shell vs JS Bundle

**This plugin updates ONLY the web view contents (JS bundle), NOT the native shell.**

**Proof from package.json fields** (inferred from code + docs):
- The plugin reads versionCode / versionName from the native app (for compatibility checks)
  but NEVER writes to or replaces the APK/IPA
- No native code compilation, no APK/IPA generation
- The native binary is only updated via app store (Play Store / App Store)

**Evidence from LiveUpdate.java:**
`java
// Reads but never modifies:
public String getVersionCodeAsString() throws PackageManager.NameNotFoundException {
  return String.valueOf(getVersionCodeAsInt());
}
`
- getVersionCode(): from android/app/build.gradle versionCode (Android)
- getVersionCode(): from Info.plist CFBundleVersion (iOS)
- getVersionName(): from CFBundleShortVersionString (iOS)

**Evidence from README:**
- "Ship a fix in one command with Capawesome Cloud Live Updates, no store review"
- "Update your app remotely in real-time without requiring users to download a new version from the app store"
- Use cases: "Instant bug fixes", "Fast feature delivery" (web-based)
- Native changes require a new binary: "Native changes require new binary" (implied by
  the versionCode/versionName compatibility gate)

**What IS updated:**
- Web assets (HTML, JS, CSS, images) served to the WebView
- The Capacitor WebViewLocalServer path is changed to point to the downloaded bundle
- On Electron: the entire web contents (only zip artifact type supported)

### B.8 App-Quit Hooks: Background Update Check

**Android lifecycle hooks** (LiveUpdatePlugin.java):
`java
@Override
protected void handleOnResume() {
  super.handleOnResume();
  implementation.handleOnResume();
  // Register WebView listener for auto-update on page load
  getBridge().addWebViewListener(new WebViewListener() {
    public void onPageLoaded(WebView webView) {
      implementation.handleOnPageLoaded();
    }
  });
}

@Override
protected void handleOnStart() { super.handleOnStart(); implementation.handleOnStart(); }
@Override
protected void handleOnStop() { super.handleOnStop(); implementation.handleOnStop(); }
`

**Auto-update strategy** (from LiveUpdate.java):
`java
private final long autoUpdateIntervalMs = 15 * 60 * 1000; // 15 minutes

public void handleOnPageLoaded() {
  if ("background".equals(config.getAutoUpdateStrategy()) && !initialPageLoaded) {
    initialPageLoaded = true;
    performAutoUpdate();
  }
}

public void handleOnResume() {
  if ("background".equals(config.getAutoUpdateStrategy()) && initialPageLoaded) {
    performAutoUpdate();
  }
}
`

**autoUpdateStrategy options:**
- none (default): No automatic update checks. Developer calls sync() manually.
- background: Auto-check on page load + on resume (if last check > 15 min ago)

**iOS equivalent:**
- Uses BGAppRefreshTask / BackgroundTasks for background fetch
- App foreground: check on viewWillAppear / scenePhase changes
- No exact Android JobScheduler equivalent documented in the plugin source (iOS uses
  Capacitor lifecycle hooks)

**Key point:** The update check happens WITHOUT foregrounding the app (background strategy).
The download can complete in background. The bundle is set as "next" and applied on next
reload or app restart.

### B.9 Security Model

**Integrity:**
- SHA-256 checksum of bundle ZIP (or per-file for manifest type)
- Computed locally, compared to provided checksum (or X-Checksum header)

**Authenticity:**
- RSA/PEM public key verification (PKCS1v15 + SHA-256)
- Signature over the SHA-256 hash of the bundle
- No Ed25519 support (RSA only, X509EncodedKeySpec)
- Public key embedded in app config (Capacitor config publicKey field)

**Replay attack prevention:**
- No timestamp, no nonce, no sequence number in the protocol
- The cloud API response includes the bundleId (UUID) - a previously seen bundleId is
  not re-downloaded (hasBundleById check)
- TLS (HTTPS) to Capawesome Cloud prevents MITM in transit
- Self-hosted: developer responsible for HTTPS + signature

**SRI (Subresource Integrity):**
- Not applicable (native plugin, not browser)
- The WebView loads from local files (bundle dir), not from URLs with SRI hashes

**Limitations:**
- RSA (not Ed25519) - larger keys, slower verification
- No manifest signing (the cloud API response itself is not signed)
- No channel signing (channel assignment is cloud-trusted)
- If Capawesome Cloud is compromised, signed bundles could be redirected
- Self-hosted path: no built-in TLS pinning (relies on OS trust store)

---

## C. Side-by-Side Comparison Table

| Dimension | electron-updater (v7/v27) | @capawesome/capacitor-live-update (v8.7.1) |
|-----------|---------------------------|--------------------------------------------|
| **Manifest medium** | latest.yml (YAML, static file on HTTP/S3/GitHub) | Cloud API JSON response OR self-hosted ZIP/manifest URL |
| **Integrity primitive** | SHA-512 (base64) of installer file | SHA-256 (hex) of bundle ZIP (or per-file) |
| **Authenticity primitive** | Ed25519 manifest signature (v27+) + Authenticode (Windows .exe) | RSA/PEM bundle signature (PKCS1v15 + SHA-256) |
| **Channel model** | File-name based: latest.yml, eta.yml, {channel}.yml (+ platform suffix) | Cloud-assigned: channel name sent to API, cloud returns eligible bundle |
| **Rollout primitive** | stagingPercentage field in manifest; client-side UUID-hash cohort | Cloud-side % (server decides which bundle to return); no client field |
| **Cache location** | pp.baseCachePath + updaterCacheDirName (e.g. %LOCALAPPDATA%/{app}/update/) | Android: context.getFilesDir()/_capacitor_live_update_bundles/; downloads in context.getCacheDir() |
| **Atomicity guarantee** | NSIS: delete-then-write (non-atomic, issue #6869); macOS: staged extraction + rename | Bundle dir rename (atomic on same filesystem); WebView path swap |
| **Rollback story** | NONE built-in. Server-side only (replace manifest + ship higher version) | readyTimeout timer -> auto-reset to built-in bundle; autoBlockRolledBackBundles (up to 100) |
| **App-quit hook** | utoInstallEvent: "onQuit"|"onNextLaunch"|"manual"; spawns NSIS installer detached | utoUpdateStrategy: "none"|"background"; 15-min interval check on resume/page-load |
| **Native shell update?** | YES - downloads and installs full .exe/.zip/.AppImage (replaces entire app) | NO - web assets only. Native binary updated via app store only |
| **Offline-first?** | YES - once downloaded, installer is cached locally; no server needed at install time | YES - once downloaded, bundle is on device; no server needed at load time |
| **Signed manifest scheme** | Ed25519 over latest.yml content (v27+); signatures[] array + updateManifestPublicKey | None (cloud API response unsigned); bundle signature is RSA over SHA-256 hash |
| **Signing key custody** | Developer key in CI; public key in pp-update.yml or utoUpdater.updateManifestPublicKey | Developer RSA keypair; public key in Capacitor config publicKey field |
| **Delta/differential** | Blockmap-based (HTTP Range, only changed blocks) | Manifest type: per-file diff (only changed files downloaded); zip type: full |
| **Resume support** | No HTTP resume; blockmap re-computes needed blocks | No resume (full re-download on failure) |
| **Max payload** | Full installer (tens to hundreds of MB) | Web assets (typically <50MB) |
| **OS platforms** | Windows (NSIS), macOS (Squirrel.Mac), Linux (AppImage, deb, rpm, pacman) | Android, iOS, Electron |
| **Update scope** | Entire application binary | WebView contents (JS/HTML/CSS/assets) |
| **Store interaction** | Bypasses store (sideload-style auto-update) | Complements store (OTA for web layer; store for native) |
| **Key rotation** | signatures[] array: dual-sign during rotation window | No built-in rotation (change publicKey = requires app update) |
| **Open issues** | 15 (monorepo, 2026-11-07) | Not tracked separately (monorepo issues) |
| **Maintenance status** | Active (v27 alpha, regular commits) | Active (8.7.1, regular releases) |

---

## D. Key Architectural Differences (Summary)

1. **Scope of update:**
   - electron-updater: replaces the ENTIRE application binary (native code + web assets)
   - capacitor-live-update: replaces only the WEB LAYER (JS/HTML/CSS in WebView)
   - This is the fundamental difference: one is a "new app install", the other is a "hot patch"

2. **Trust model:**
   - electron-updater v27: Ed25519 manifest sig (authenticity of update metadata) +
     Authenticode (authenticity of Windows binary) + SHA-512 (integrity)
   - capacitor-live-update: RSA bundle sig (authenticity + integrity of ZIP) + HTTPS (in transit)
   - electron-updater has a stronger manifest-level signature; capacitor relies on the cloud API

3. **Rollback philosophy:**
   - electron-updater: "no rollback, just ship a fix faster" (forward-fix model)
   - capacitor-live-update: "auto-rollback to built-in bundle if app not ready in N seconds"
     (safe-by-default model with timeout)

4. **Staged rollout location:**
   - electron-updater: client-side (UUID hash determines cohort; server just sets percentage)
   - capacitor-live-update: server-side (cloud API decides which bundle to serve; client is passive)

5. **Channel mechanism:**
   - electron-updater: different FILES per channel (latest.yml vs beta.yml)
   - capacitor-live-update: different CHANNEL NAMES (cloud routes to correct bundle)

6. **Install timing:**
   - electron-updater: app must quit for update to take effect (NSIS installer replaces running app)
   - capacitor-live-update: can hot-reload WebView without app restart (reload() method)

---

## E. AIRIZ-Specific Implications

| Concern | electron-updater (Windows) | capacitor-live-update (Android/iOS) |
|---------|---------------------------|-------------------------------------|
| Signed manifest | AIRIZ signs canonical manifest Ed25519 -> projects to latest.yml signatures[] via manifest-to-electron-yml.ts | AIRIZ signs canonical manifest Ed25519 -> mobile client verifies manually (bypasses Capawesome RSA) |
| Staged rollout | stagingPercentage in latest.yml (client-side UUID cohort) | Cloud-side (or self-hosted: release-relay withinRollout() with SHA-256(deviceId+channel)) |
| Rollback | None. Forward-fix only. | readyTimeout + autoBlockRolledBackBundles. |
| Key custody | KMS/Sigstore Ed25519 -> app-update.yml updateManifestPublicKey | Same Ed25519 key, but Capawesome forces RSA in its own verification. AIRIZ bypasses. |
| Atomic install | NSIS non-atomic (known issue #6869). Mitigation: onNextLaunch. | Bundle dir rename (atomic). WebView path swap. |
| Offline | Installer cached in pending/ dir. Works offline after download. | Bundle cached in files dir. Works offline after download. |

---

## F. Source File Index

### electron-updater key files:
| File | Path | Purpose |
|------|------|---------|
| AppUpdater.ts | packages/electron-updater/src/AppUpdater.ts | Main update logic (1938 lines) |
| BaseUpdater.ts | packages/electron-updater/src/BaseUpdater.ts | Install lifecycle, quit hooks |
| NsisUpdater.ts | packages/electron-updater/src/NsisUpdater.ts | Windows-specific |
| MacUpdater.ts | packages/electron-updater/src/MacUpdater.ts | macOS-specific |
| providerFactory.ts | packages/electron-updater/src/providerFactory.ts | Provider selection |
| GenericProvider.ts | packages/electron-updater/src/providers/GenericProvider.ts | S3/Spaces/R2/Generic |
| GitHubProvider.ts | packages/electron-updater/src/providers/GitHubProvider.ts | GitHub Releases |
| Provider.ts | packages/electron-updater/src/providers/Provider.ts | Base, parseUpdateInfo, resolveFiles |
| DownloadedUpdateHelper.ts | packages/electron-updater/src/DownloadedUpdateHelper.ts | Cache, pending install |
| types.ts | packages/electron-updater/src/types.ts | Events, options, VerifyUpdateFile |
| util.ts | packages/electron-updater/src/util.ts | getChannelFilename, URL helpers |
| DifferentialDownloader.ts | packages/electron-updater/src/differentialDownloader/DifferentialDownloader.ts | Blockmap base |
| GenericDifferentialDownloader.ts | packages/electron-updater/src/differentialDownloader/GenericDifferentialDownloader.ts | Blockmap impl |
| windowsExecutableCodeSignatureVerifier.ts | packages/electron-updater/src/windowsExecutableCodeSignatureVerifier.ts | Authenticode |
| package.json | packages/electron-updater/package.json | Version 7.0.0-alpha.13 |

### capacitor-live-update key files:
| File | Path | Purpose |
|------|------|---------|
| LiveUpdatePlugin.java | packages/live-update/android/.../LiveUpdatePlugin.java | Plugin entry, API methods |
| LiveUpdate.java | packages/live-update/android/.../LiveUpdate.java | Core impl (1687 lines) |
| LiveUpdateConfig.java | packages/live-update/android/.../LiveUpdateConfig.java | Config POJO |
| LiveUpdateHttpClient.java | packages/live-update/android/.../LiveUpdateHttpClient.java | OkHttp wrapper |
| LiveUpdatePreferences.java | packages/live-update/android/.../LiveUpdatePreferences.java | SharedPreferences |
| README.md | packages/live-update/README.md | Full API docs + config |
| package.json | packages/live-update/package.json | Version, deps |

---

*End of source-code deep dive. Generated 2026-11-07.*
