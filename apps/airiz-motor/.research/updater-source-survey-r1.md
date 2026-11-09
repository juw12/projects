# Updater Source Survey (R1) — electron-updater × Capawesome Capacitor Live Update

Prepared for the AIRIZ motor-console updater decision: keep electron-updater + bolt Capawesome Live Update (**a**), migrate to Tauri's unified updater (**b**), or build a custom signed-manifest layer on R2 / GitHub Releases (**c**).

**Sources.** The downloaded source set in `apps/airiz-motor/.research/`: electron-updater `packages/electron-updater/src/` flattened to `eu-*.ts`, and the Capawesome `capacitor-live-update` native code flattened to `cw-*.swift` (iOS) + `cw-*.java` (Android). All line numbers below reference these `.research/` copies, not the upstream repos.

**Method.** Only the ~16 highest-signal files were read in full; the remaining option/result/DTO files were mapped from their names and roles. No source was re-fetched or re-downloaded.

**Files read in full**
- electron-updater: `eu-types.ts`, `eu-AppUpdater.ts`, `eu-BaseUpdater.ts`, `eu-NsisUpdater.ts`, `eu-MacUpdater.ts`, `eu-GenericProvider.ts`, `eu-DownloadedUpdateHelper.ts`, `eu-Provider.ts`
- Capawesome: `cw-LiveUpdate.swift`, `cw-LiveUpdate.java`, `cw-Manifest.swift`, `cw-Manifest.java`, `cw-ManifestItem.swift`, `cw-GetLatestBundleResponse.swift`, `cw-GetLatestBundleResponse.java`, `cw-LiveUpdateConfig.swift`, `cw-LiveUpdateConfig.java`, `cw-LiveUpdateHttpClient.swift`

## Headline (read this first)

- electron-updater signs the **manifest** (`latest*.yml`) with **Ed25519** and pins every installer by **SHA512**; the Windows NSIS `.exe` is additionally **Authenticode**-checked. Trust anchor = a manifest signature that transitively pins the installer bytes. (`eu-AppUpdater.ts:847-898`, `eu-DownloadedUpdateHelper.ts:286-291`, `eu-NsisUpdater.ts:286-313`)
- Capawesome signs the **content** (the zip, or each file of a manifest-type bundle) with **RSA-2048 (PKCS1v15-SHA256)**; **SHA256** is the fallback only when no public key is configured. Trust anchor = a signature over the exact bytes that will run. (`cw-LiveUpdate.swift:1103-1191`, `cw-LiveUpdate.java:1633-1677`)
- Capawesome ships a **built-in runtime rollback**: a ready-timeout reverts the app to the in-package default bundle and blocklists the bad bundle. electron-updater has **no runtime rollback** — once the installer runs, the only "rollback" is installing an older build. (`cw-LiveUpdate.swift:872-886`, `cw-LiveUpdate.java:1411-1426`)
- **Attribution correction.** The Ed25519 check is *not* in `eu-BaseUpdater.ts`. It lives in the parent `eu-AppUpdater.ts` (`verifyManifestSignature`, `:847-898`); `BaseUpdater` owns the install lifecycle and the re-verification hooks. See §1.3.

---

## 1. electron-updater source dive

### 1.1 File map (`packages/electron-updater/src/`, as `eu-*.ts`)

| File | Role |
|---|---|
| `eu-index.ts` / `eu-indexInternal.ts` | Public/internal entry points; bind the platform updater to Electron `autoUpdater`. |
| `eu-AppUpdater.ts` | Base class: check-for-updates flow, **manifest (Ed25519) signature verification**, download orchestration, client-side staging/rollout, provider construction. |
| `eu-BaseUpdater.ts` | Install lifecycle: install-on-quit / install-on-next-launch, pending-install re-validation, spawn + elevate the installer. |
| `eu-NsisUpdater.ts` | Windows: selects the `.exe`, Authenticode verify, spawns the NSIS installer (silent / elevate). |
| `eu-MacUpdater.ts` | macOS: proxies the downloaded zip to Squirrel.Mac's native `autoUpdater`. |
| `eu-AppImageUpdater.ts` / `eu-LinuxUpdater.ts` / `eu-DebUpdater.ts` | Linux: AppImage, deb (rpm/pacman) package installs via the system package manager. |
| `eu-Provider.ts` | Abstract `Provider<T>`: channel-file fetch, YAML parse (alias-budget DoS guard), file resolution. |
| `eu-GenericProvider.ts` | The "generic server" provider — resolves `latest[-channel].yml` from a base URL. |
| `eu-providerFactory.ts` | Maps a publish config (github/gitlab/private/generic/…) to a concrete provider. |
| `eu-DownloadedUpdateHelper.ts` | The **cache**: `pending/` dir, `update-info.json`, SHA512 re-hash on reuse, pending-install marker. |
| `eu-AppAdapter.ts` / `eu-ElectronAppAdapter.ts` | Abstraction over Electron `app`/`autoUpdater` (quit, whenReady, baseCachePath). |
| `eu-electronHttpExecutor.ts` | HTTP via Electron `net` (auth/login events, multi-range requests). |
| `eu-types.ts` | Shared runtime types (re-exports `UpdateInfo`/`UpdateFileInfo` from `builder-util-runtime`) + verify callbacks. |
| `eu-util.ts` | `newUrlFromBase`, channel-file naming, `throwIfCancelled`, non-throwing loggers. |
| `eu-differentialDownloader` (`DifferentialDownloader`, `GenericDifferentialDownloader`, `FileWithEmbeddedBlockMapDifferentialDownloader`, `blockMapV3Fetcher`, `DataSplitter`, `downloadPlanBuilder`, `multipleRangeDownloader`) | Blockmap-based **differential** download (fetch only changed 64 KB blocks). |

### 1.2 Manifest format

The wire format is the **channel file** `latest.yml` / `latest-mac.yml` / `latest-linux.yml` + platform (`eu-Provider.ts:67-84`). `UpdateInfo` / `getChannelFilename`/`getChannelFilePrefix`). `UpdateInfo` and `UpdateFileInfo` are defined in `builder-util-runtime` and merely re-exported at `eu-types.ts:1,6`; they are **not** in the downloaded set, so the shape below is reconstructed from the read sites:

- `UpdateInfo.version` — read at `eu-AppUpdater.ts:713,926`.
- `UpdateInfo.files[]` — each element carries `url`, `sha512`, `size`, `blockMapSize`, optional `blockMapUrl`; read at `eu-AppUpdater.ts:879` and `eu-Provider.ts:354-360`.
- `UpdateInfo.stagingPercentage` — client-side rollout percentage; read at `eu-AppUpdater.ts:683`.
- `UpdateInfo.minimumSystemVersion` — OS floor; read at `eu-AppUpdater.ts:747`.
- Signature fields — a legacy single `signature` plus a `signatures[]` array (one entry per signing key, tagged with a key id); collected at `eu-AppUpdater.ts:868` via `collectManifestSignatures(info)`.

The resolver that turns the parsed manifest into installable URLs — and enforces "every file must carry a checksum" — is `resolveFiles` (`eu-Provider.ts:351-373`):

```ts
export function resolveFiles(updateInfo, baseUrl, pathTransformer = p => p): Array<ResolvedUpdateFileInfo> {
  const files = getFileList(updateInfo)
  const result: Array<ResolvedUpdateFileInfo> = files.map(fileInfo => {
    if (fileInfo.sha2 == null && fileInfo.sha512 == null) {
      throw newError(`Update info doesn't contain nor sha256 neither sha512 checksum: ...`, "ERR_UPDATER_NO_CHECKSUM")
    }
    return {
      url: newUrlFromBase(pathTransformer(fileInfo.url), baseUrl),
      info: fileInfo,
      ...(fileInfo.blockMapUrl == null ? {} : { blockMapUrl: resolveBlockMapUrl(fileInfo.blockMapUrl, baseUrl, pathTransformer) }),
    }
  })
  // Windows web-installer packages attached to result[0].packageInfo
  return result
}
```

The per-file view the rest of the updater consumes is `ResolvedUpdateFileInfo` (`eu-types.ts:122-130`):

```ts
export interface ResolvedUpdateFileInfo {
  readonly url: URL
  readonly info: UpdateFileInfo
  readonly blockMapUrl?: URL   // resolved blockmap, when the manifest names one
  packageInfo?: PackageFileInfo
}
```

**Trust-model key point.** The signed manifest pins `files[].url` **and** `files[].sha512` in one signature. The failure-path hint in `verifyManifestSignature` states it directly: "files[].blockMapUrl is covered by the signature, like files[].url" (`eu-AppUpdater.ts:878-882`). So a valid Ed25519 signature authenticates the whole file list and every installer checksum simultaneously — there is no separate channel-file trust step.

### 1.3 Signature verification path (Ed25519) — and where it actually lives

**Correction to the brief.** The brief asks "where in `eu-BaseUpdater.ts` does it verify the Ed25519 signature?" The honest answer is: **it does not.** `eu-BaseUpdater.ts` contains no Ed25519 code. The manifest signature is verified in the **parent** class `AppUpdater`, in `verifyManifestSignature()`, and is invoked once per update-check before any download starts.

The call chain is:

1. `AppUpdater.checkForUpdates()` → `doCheckForUpdates()` → `getUpdateInfoAndProvider()` (`eu-AppUpdater.ts:762-816`).
2. `getUpdateInfoAndProvider()` fetches the channel file, then runs `const manifestSignatureVerified = await this.verifyManifestSignature(info)` and returns it inside the result object (`eu-AppUpdater.ts:810-815`).
3. `verifyManifestSignature()` (`eu-AppUpdater.ts:847-898`) does the Ed25519 work.

The decision core of `verifyManifestSignature` (`eu-AppUpdater.ts:861-893`, abridged):

```ts
if (trustedKeys.length === 0) {
  this.limitedLogger("manifest-verification-disabled").warn(
    "update manifest signature verification is disabled. Configure updateManifestPublicKey ...")
  return false                                   // opt-in: no key => skipped
}
if (collectManifestSignatures(info).length === 0) {
  throw newError(`Update manifest ... is not signed ... Refusing to update.`, "ERR_UPDATER_MANIFEST_NOT_SIGNED")
}
const result = verifyManifestSignatures(info, trustedKeys)
if (!result.ok) {
  throw newError(`Update manifest signature verification failed ... Refusing to update.`, "ERR_UPDATER_MANIFEST_SIGNATURE_INVALID")
}
return true
```

The trust list is `updateManifestPublicKey` — "The Ed25519 public key(s) (PEM or base64 SPKI) trusted to have signed the update manifest … a manifest is accepted when any listed key validates one of its signatures" (`eu-AppUpdater.ts:356-366`). It supports an **array of keys for rotation** (dual-sign a release, trust `[old, new]`) — the doc comment at `:840-843` spells this out. The three failure modes are explicit and fail-closed: no key → skip + one-time warn; key set but manifest unsigned → `ERR_UPDATER_MANIFEST_NOT_SIGNED`; key set but no key validates → `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`. A throw here propagates **before** any download starts (`:843` "Never fails open once a key is configured").

What `eu-BaseUpdater.ts` *does* own (the part the brief may have intended): the **re-verification on install-on-next-launch**. A cached installer from a previous launch is re-checked against freshly fetched info before it is spawned:

- `installPendingUpdate()` matches the cached file to the live manifest by SHA512: `...provider.resolveFiles(latestInfo).find(it => it.info.sha512 === pendingInfo.sha512)` (`eu-BaseUpdater.ts:520`), clears the marker if it no longer matches (`:521-527`).
- It re-runs `verifyInstallerSignatureOnLaunch()` (`:547-552`) and the app-level `verifyUpdateFile()` hook (`:556-563`) on the cached file, clearing the pending cache on any failure.
- `verifyInstallerSignatureOnLaunch()` is a no-op stub in `BaseUpdater` (`:594-596`, returns `{response:"success"}`) and is **overridden per-platform** (NSIS re-checks Authenticode, §1.8).
- The marker is cleared **before** the installer is spawned "so a silently failing install cannot produce an endless spawn-and-quit loop on every launch" (`:570-577`).

### 1.4 Binary verification (SHA512)

The per-file SHA512 check is performed by the HTTP executor *during* the download (`builder-util-runtime`), not in these files — the updater passes `sha512` into the download call. The strongest local evidence is the **re-hash of a cached file** in `DownloadedUpdateHelper.getValidCachedUpdateFile()` (`eu-DownloadedUpdateHelper.ts:286-291`):

```ts
const sha512 = await hashFile(updateFile)
if (fileInfo.info.sha512 !== sha512) {
  this.logger.warn(`Sha512 checksum doesn't match ... Cached: ${sha512}, expected: ${fileInfo.info.sha512}`)
  await this.cleanCacheDirForPendingUpdate()
  return null
}
```

A second checksum gate is the manifest-level one: `resolveFiles` refuses to produce a file list with no checksum at all (`ERR_UPDATER_NO_CHECKSUM`, `eu-Provider.ts:354-356`). And the NSIS web-installer *package* gets its own SHA512 check (`eu-NsisUpdater.ts:209-211`, `:257`). So there are three binary-trust layers on Windows: manifest SHA512 (pins the `.exe`) + download-time SHA512 (pins the bytes) + Authenticode (pins the publisher, §1.8).

### 1.5 Cache layer & staging

The entire on-disk state is one class, `DownloadedUpdateHelper`, rooted at `<baseCachePath>/<updaterCacheDirName>` (`eu-BaseUpdater.ts:248`). Its layout:

- `cacheDir/pending/` — `cacheDirForPendingUpdate()` (`eu-DownloadedUpdateHelper.ts:63-65`).
- `cacheDir/pending/update-info.json` — `getUpdateInfoFile()` (`:312-314`); the persisted record.
- `cacheDir/pending/<installer.exe>` — the staged installer itself.

`update-info.json` is the `CachedUpdateInfo` struct (`eu-DownloadedUpdateHelper.ts:317-336`): `fileName`, `sha512`, `isAdminRightsRequired`, optional `installOnNextLaunch`, and (web installer only) `packageFileName` + `version`.

Lifecycle:
- **First download** → `setDownloadedFile()` writes the record (`:90-114`); the on-disk id is `sha512:<hex>` via `updateFileId()` (`:15-26`), so a *newer* update has a different id even if the file name is the same.
- **Same-session reuse** → `validateDownloadedPath()` short-circuits when the manifest + file info deep-compare equal and the file exists (`:67-88`) — no re-hash.
- **Cross-launch reuse** → `getValidCachedUpdateFile()` re-reads the record, checks `fileName` sanity, checks `sha512` record-match, then **re-hashes the bytes** (`:243-310`). Any mismatch → `cleanCacheDirForPendingUpdate()` (wipes `pending/`) and a redownload.
- **Install-on-next-launch** → `markInstallOnNextLaunchSync()` adds `installOnNextLaunch:true` to the JSON *synchronously* so the `quit` handler can set it (`:121-135`); `getPendingInstallInfo()` (`:140-147`) reads it back; `clearPendingInstallMarker()` (`:153-170`) removes the flag but keeps the cached file.

`autoInstallEvent` (the v27 replacement for the old boolean) is `"manual" | "onQuit" | "onNextLaunch"` (`eu-types.ts:32`), documented in detail at `eu-AppUpdater.ts:89-112`. `"onNextLaunch"` is the planned v28 default because it survives Windows session-end killing the detached installer (issue #7807, cited at `eu-types.ts:29` and `eu-AppUpdater.ts:100-102`).

### 1.6 Rollback & partial-download survival

electron-updater has **no runtime rollback** in the Capawesome sense — there is no "the new install is broken, revert" path, because the NSIS installer replaces the running binary out-of-band. What it *does* have is a robust **failed/partial-download** recovery:

- **Partial download → nothing is installed.** The file is downloaded to a temporary name and only renamed to its real name *after* verification succeeds, "so it can never be executed under its real name while unverified" (`eu-types.ts:151-154`). A failed signature check calls `removeTempDirIfAny()` and throws before the file is ever committed (`eu-NsisUpdater.ts:241-247`).
- **Stale/partial cache → detected and wiped on the next check.** `getValidCachedUpdateFile()` re-hashes and cleans `pending/` on any mismatch (§1.5, `eu-DownloadedUpdateHelper.ts:286-291`).
- **Failed install → not retried on quit, but not lost.** A failed install sets `skipInstallOnQuitUpdateId` so a later quit in the same session won't re-attempt *that* update, while an explicit `quitAndInstall()` still can (`eu-BaseUpdater.ts:394-413`, `:730-734`). The install state machine (`idle`/`installing`/`handedOff`, `:143`) guarantees a failed install returns to `idle` so a *different* update can proceed.
- **Session-end safety.** An OS session end sets `isSessionEnding`, and `autoInstallEvent:"onQuit"` then *skips* the install rather than letting the OS kill the installer mid-run ("The downloaded update stays cached and will be installed on the next quit", `eu-BaseUpdater.ts:665-671`).

The **only** "rollback-ish" behaviour is version-gated: on launch, a pending update that is no longer an installable change (equal version, or a downgrade without `allowDowngrade`) is cleared, not installed (`eu-BaseUpdater.ts:510-518`). That is a loop-guard, not a revert.

### 1.7 Provider abstraction (`GenericProvider` vs `Provider`)

`Provider<T extends UpdateInfo>` (`eu-Provider.ts:41`) is the abstract contract: it must implement `getLatestVersion()` (`:113`) and `resolveFiles()` (`:115`), and it supplies the HTTP plumbing — `httpRequest()` / `channelFileRequest()` (with a `maxResponseSize` cap on channel files, `:129-147`) and `createRequestOptions()` (which strips credential headers on cross-origin requests, `:149-171`).

`GenericProvider extends Provider<UpdateInfo>` (`eu-GenericProvider.ts:7`) is the concrete "any static host" implementation. Its `getLatestVersion()` (`eu-GenericProvider.ts:28-52`) is the whole client side of a BYO-server setup:

```ts
async getLatestVersion(): Promise<UpdateInfo> {
  const channelFile = getChannelFilename(this.channel)              // latest[-channel][-mac|-linux-arch].yml
  const channelUrl = newUrlFromBase(channelFile, this.baseUrl, this.updater.isAddNoCacheQuery)
  for (let attemptNumber = 0; ; attemptNumber++) {
    try {
      return parseUpdateInfo(await this.channelFileRequest(channelUrl), channelFile, channelUrl)
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 404) throw newError(`Cannot find channel ...`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")
      else if (e.code === "ECONNREFUSED" && attemptNumber < 3) { await sleep(1000*attemptNumber); continue }
      throw e
    }
  }
}
```

So "a custom signed-manifest layer on R2 / GitHub Releases" (option **c**) is *already* this class plus `parseUpdateInfo()` (`eu-Provider.ts:197-244`) — which is also where the **YAML-alias DoS budget** lives (a manifest whose aliases expand past `~rawData.length` is rejected with `ERR_UPDATER_INVALID_UPDATE_INFO`, `:239-242`). The channel-name logic (`latest` → `latest.yml`, custom channel → `<channel>.yml`, platform suffix `-mac`/`-linux-arch`) is in `getChannelFilePrefix()`/`getCustomChannelName()` (`eu-Provider.ts:67-84`).

### 1.8 Platform installers (NSIS, Mac)

**NSIS (`eu-NsisUpdater.ts`).** `doDownloadUpdate()` picks the `.exe` (`:198`), downloads it, then verifies **Authenticode** before anything else: `verifySignature()` (`:286-313`). It is fail-closed — without a configured `publisherName` the update is rejected with `missingPublisherNameMessage()` (`:312`), and a custom verifier is *never* called without a publisher name. `doInstall()` (`:327-388`) spawns the installer with `--updated`, adds `/S` for silent and `--force-run` when requested, and uses `elevate.exe` when `isAdminRightsRequired` (`:360-368`). Per-user NSIS installs support install-on-next-launch (`isAutoInstallOnNextLaunchSupported === true`, `:323-325`) and re-verify Authenticode on launch (`verifyInstallerSignatureOnLaunch`, `:317-319`).

**Mac (`eu-MacUpdater.ts`).** Note it extends `AppUpdater` **directly**, not `BaseUpdater` (`:19`) — macOS delegates install to Squirrel.Mac. It picks the `.zip` (`:93`), and on `done:` caches it as `update.zip` for differential downloads (`:126-134`). `updateDownloaded()` (`:140-261`) stands up a **local loopback HTTP server** (random path + Basic-auth password) and points Squirrel.Mac's native `autoUpdater` at it, streaming the verified zip in. Both `"onQuit"` and `"onNextLaunch"` collapse to Squirrel.Mac's native "stage now, apply on relaunch" (`:250-258`); `quitAndInstall({waitUntilNextLaunch:true})` simply quits because Squirrel already staged it (`:272-281`). Mac therefore gets atomic staging/rollback **for free** from Squirrel.Mac — a capability the Windows/NSIS path does *not* have natively.

---

## 2. Capawesome Capacitor Live Update source dive

Capawesome is a **Capacitor plugin** that live-updates the **web bundle** (the app's HTML/JS/CSS) without an app-store round-trip. There is one logic core per platform — `LiveUpdate` (Swift on iOS, Java on Android) — that downloads, verifies, and stages **bundles**, and flips the WebView's server path to the new bundle on the *next* load, with a ready-timeout rollback.

### 2.1 File map (`@capacitor/live-update`, as `cw-*.swift` / `cw-*.java`)

| File | Role |
|---|---|
| `cw-LiveUpdate.swift` / `cw-LiveUpdate.java` | The engine: sync, download+verify, manifest diffing, bundle staging, deferred "next bundle", **ready-timeout rollback**, blocklist. |
| `cw-LiveUpdatePlugin.swift` / `.java` | The Capacitor `Plugin` bridge: exposes the JS API, lifecycle hooks (`ready`, `reload`, `sync`, …), events. |
| `cw-LiveUpdateConfig.swift` / `.java` | Config: `appId`, `serverDomain`, `defaultChannel`, `publicKey`, `readyTimeout`, `autoUpdateStrategy`, flags. |
| `cw-LiveUpdateHttpClient.swift` / `.java` | HTTP: request + download; reads `x-checksum` / `x-signature` headers; sets `X-Capawesome-Device-Id`; no-cache. |
| `cw-LiveUpdatePreferences.swift` / `.java` | `UserDefaults`/`SharedPreferences` store: channel, deviceId, previousBundleId, blockedBundleIds, lastVersion. |
| `cw-Manifest.swift` / `.java` | Per-bundle **file inventory**: `[ManifestItem]` + `findDuplicateItems` / `findMissingItems` for differential (manifest-type) updates. |
| `cw-ManifestItem.swift` / `.java` | One file: `href`, `checksum`, `sizeInBytes`. |
| `cw-GetLatestBundleResponse.swift` / `.java` | The server's **decision** object: which `bundleId`/`url`/`checksum`/`signature` to install. |
| `cw-DownloadBundleOptions`, `cw-SetNextBundleOptions`, `cw-SyncOptions`, `cw-ReadyResult`, `cw-SyncResult` | JS-bridge option/result DTOs. |
| `cw-LiveUpdateIonicManager.swift` / `.kt` | Optional headless/Ionic-Portals host integration. |

### 2.2 Manifest format + the "decision" object

Capawesome splits what electron-updater calls the "manifest" into **two different things**:

**(a) The per-bundle file inventory** — `Manifest` is just a list of files, used for *differential* (manifest-type) updates. Swift (`cw-Manifest.swift:4-9`):

```swift
@objc public class Manifest: NSObject, Codable {
    let items: [ManifestItem]
    init(items: [ManifestItem]) { self.items = items }
    public static func findDuplicateItems(_ m1: Manifest, _ m2: Manifest) -> [ManifestItem] { ... }  // copy from current
    public static func findMissingItems(_ m1: Manifest, _ m2: Manifest) -> [ManifestItem] { ... }      // download
}
```

`ManifestItem` (`cw-ManifestItem.swift:1-5`):

```swift
public struct ManifestItem: Codable {
    var checksum: String
    var href: String
    var sizeInBytes: Int
}
```

The differential logic: download the new bundle's `capawesome-live-update-manifest.json`, compare to the current bundle's manifest, **copy** files whose `checksum` is unchanged (`findDuplicateItems`) and **download** only the missing/changed ones (`findMissingItems`) (`cw-LiveUpdate.swift:585-616`).

**(b) The decision object** — `GetLatestBundleResponse` is what electron-updater's `UpdateInfo` would be: the server's answer to "what should this device run?". Swift (`cw-GetLatestBundleResponse.swift:1-9`):

```swift
public struct GetLatestBundleResponse: Codable {
    var artifactType: ArtifactType     // .manifest or .zip
    var bundleId: String
    var channelName: String?
    var checksum: String?              // SHA256 fallback
    var customProperties: [String: String]?
    var signature: String?             // RSA signature over the artifact
    var url: String                    // where the bundle lives
}
```

The Java mirror parses `artifactType` (`"manifest"` → `MANIFEST`, anything else → `ZIP`, `cw-GetLatestBundleResponse.java:34-47`). The client fetches it from `https://<serverDomain>/v1/apps/<appId>/bundles/latest` with the device/app/channel context as query params (`cw-LiveUpdate.swift:632-666`; `platform=1` iOS / `0` Android). **Crucially, the rollout/channel decision is made server-side** — the client only *reports* its context and *receives* a single bundle. There is no client-side `stagingPercentage` equivalent (contrast `eu-AppUpdater.ts:682-703`).

### 2.3 Signed bundles (RSA-2048) + config schema

Verification lives in `LiveUpdate.verifyFile()`. The Swift decision core (`cw-LiveUpdate.swift:1103-1133`, abridged):

```swift
private func verifyFile(url: URL, checksum: String?, signature: String?) throws {
    if let publicKey = self.config.publicKey {
        guard let signature = signature else { throw CustomError.signatureMissing }
        let verified = try verifySignatureForFile(url: url, signature: signature, publicKey: publicKey)
        if !verified { throw CustomError.signatureVerificationFailed }
    }
    else if let expectedChecksum = checksum {
        let receivedChecksum = try getChecksumForFile(url: url)     // SHA256
        if receivedChecksum != expectedChecksum { throw CustomError.checksumMismatch }
    }
}
```

Two regimes, exactly one active: **if `publicKey` is set, the RSA signature is mandatory and the checksum is ignored** (fail-closed: a missing signature is `signatureMissing`, `:1106-1108`). **Only if there is no key** does it fall back to the SHA256 `checksum` (`:1121-1131`). The RSA algorithm (`cw-LiveUpdate.swift:1135-1191`):

```swift
let publicKeyAttributes: [CFString: Any] = [
    kSecAttrKeyType: kSecAttrKeyTypeRSA,
    kSecAttrKeyClass: kSecAttrKeyClassPublic,
    kSecAttrKeySizeInBits: 2048,
    kSecReturnPersistentRef: true
]
// SecKeyCreateWithData(...) then, over the file's SHA256 digest:
let signatureAlgorithm = SecKeyAlgorithm.rsaSignatureDigestPKCS1v15SHA256
let verificationResult = SecKeyVerifySignature(publicKey, signatureAlgorithm, digest, signatureData, &err)
```

So: **RSA-2048, PKCS#1 v1.5, SHA-256**, key as base64 X.509 SubjectPublicKeyInfo. Android is the same scheme via the JCA: `createPublicKeyFromString()` builds an `RSA` `PublicKey` from the PEM (`cw-LiveUpdate.java:744-755`), `verifyFile()` branches identically (`cw-LiveUpdate.java:1633-1654`), and `verifySignatureForFile()` uses `Signature.getInstance("SHA256withRSA")` (`cw-LiveUpdate.java:1661-1677`). The signature itself arrives either in the response `signature` field or in the **`x-signature`** header (`cw-LiveUpdateHttpClient.swift:15-18`); the checksum in **`x-checksum`** (`:10-13`).

**Config schema** — identical on both platforms (`cw-LiveUpdateConfig.swift:1-11`, `cw-LiveUpdateConfig.java:7-28`):

```swift
public struct LiveUpdateConfig {
    var appId: String?
    var autoBlockRolledBackBundles = false   // blocklist a bundle that caused a rollback
    var autoDeleteBundles = false            // GC bundles not current/next on ready()
    var autoUpdateStrategy = "none"          // "none" | "manual" | "background"
    var defaultChannel: String?
    var httpTimeout = 60000
    var publicKey: String?                   // RSA public key (PEM) — enables content signing
    var readyTimeout = 0                     // ms before forced rollback (0 = disabled)
    var serverDomain = "api.cloud.capawesome.io"
}
```

### 2.4 Cache layer (where downloaded bundles live)

Two directories, plus a per-bundle layout:

- **Downloads (scratch):** iOS `Caches/capawesome_capacitor_live_update_downloads` (`cw-LiveUpdate.swift:10-12`); Android `context.getCacheDir()/capawesome_capacitor_live_update_downloads` (`cw-LiveUpdate.java:115,669-671`). Each download gets a **UUID subdir** (`createTemporaryDownloadDirectory`, `cw-LiveUpdate.swift:487-491`; `cw-LiveUpdate.java:757-761`).
- **Bundles (committed):** iOS `Library/NoCloud/ionic_built_snapshots/<bundleId>` (`cw-LiveUpdate.swift:20,421-424`); Android `context.getFilesDir()/_capacitor_live_update_bundles/<bundleId>` (`cw-LiveUpdate.java:114,665-667`).
- **Interrupted-download cleanup:** on process start the *entire* downloads dir is deleted — iOS `interruptedDownloadsDeleted` static (`cw-LiveUpdate.swift:15-17`), Android `downloadsDirectoryDeleted` `compareAndSet` once per process (`cw-LiveUpdate.java:90,164-166`). So a partial download is never a live candidate; it is wiped and the bundle simply is not present.
- **No-HTTP-cache:** every request sets `.reloadIgnoringLocalCacheData` (iOS `cw-LiveUpdateHttpClient.swift:31,52`); `download()` uses `.validate()` so a non-2xx body is "never saved as a bundle file" (`cw-LiveUpdateHttpClient.swift:38-39`).

### 2.5 Deferred install, atomic rename, and rollback

The install model is **deferred**: a downloaded bundle is not used immediately. It is staged and recorded as the *next* bundle; the WebView only switches to it on the next load. Three bundle IDs are tracked:

- **current** = whatever the WebView's server path points at now (`getCurrentBundleId`, `cw-LiveUpdate.swift:722-731`; `cw-LiveUpdate.java:1213-1220`). `nil`/`"public"` = the in-package default bundle.
- **next** = the bundle that will be served on the next load, persisted in `KeyValueStore` (iOS `cw-LiveUpdate.swift:757-763,985-993`) / `WebView.CAP_SERVER_PATH` SharedPreferences (Android `cw-LiveUpdate.java:1263-1272,1550-1553`).
- **previous** = the bundle that was current before the last switch, kept for rollback (`getPreviousBundleId`, `cw-LiveUpdate.swift:766-768`).

The `sync()` decision flow (iOS `cw-LiveUpdate.swift:329-375`; Android `cw-LiveUpdate.java:522-615`):

```swift
guard let response = try await fetchLatestBundle(options) else { return SyncResult(nextBundleId: nil) } // no update
if isBlockedBundleId(latestBundleId) { return SyncResult(nextBundleId: nil) }                            // in blocklist
if hasBundleById(latestBundleId) { if latest != current { setNextBundleById(latest) } ; return ... }       // already staged
if artifactType == .manifest { try await downloadBundleOfTypeManifest(...) }
else                          { try await downloadBundleOfTypeZip(...) }                                 // verify inside
setNextBundleById(latestBundleId)                                                                      // defer to next load
```

**Atomic commit** = `addBundle()` (iOS `cw-LiveUpdate.swift:377-394`; Android `cw-LiveUpdate.java:631-648`). It requires a valid `index.html` to exist anywhere in the unzipped tree (`searchIndexHtmlFile`, `cw-LiveUpdate.swift:888-913`), then `moveItem`/`renameTo`s the fully-built dir into the bundles directory. The move is the only "commit" — before it, the bundle is in scratch. A concurrent download of the same bundle is tolerated (the loser finds the dir already present, `cw-LiveUpdate.java:644-647`).

**Ready-timeout rollback** is the safety mechanism. A timer starts at launch/reload (`startRollbackTimer`, iOS `cw-LiveUpdate.swift:1034-1046`; Android `cw-LiveUpdate.java:1584-1594`) armed to `readyTimeout`. The app **must** call `ready()` before it fires. If it doesn't, `rollback()` runs (iOS `cw-LiveUpdate.swift:872-886`; Android `cw-LiveUpdate.java:1411-1426`):

```swift
private func rollback() {
    rollbackPerformed = true
    let currentBundleId = getCurrentBundleId()
    setPreviousBundleId(bundleId: currentBundleId)
    if let _ = currentBundleId {
        setNextBundleById(nil)      // point next load at the default (in-package) bundle
        setCurrentBundleById(nil)   // and the current one too
    }
}
```

Note the rollback target is the **in-package default bundle**, not "the last known-good live bundle" — the app reverts to the web assets shipped in the original install. Two refinements:
- The timer **pauses in the background** and resumes in the foreground, because a suspended app cannot call `ready()` (iOS `cw-LiveUpdate.swift:234-249,845-863`; Android `cw-LiveUpdate.java:435-443,1380-1395`).
- With `autoBlockRolledBackBundles`, `ready()` adds the rolled-back (bad) bundle to a **blocklist** (capped at 100) so the server's next "latest" pointing at it is refused (`cw-LiveUpdate.swift:266-268,948-974`; `cw-LiveUpdate.java:460-462,1510-1538`).
- `ready()` also triggers GC of unused bundles (`autoDeleteBundles`, `tryDeleteUnusedBundle` keeps only current+next, `cw-LiveUpdate.swift:1080-1094`).

This is the single most important behavioural difference from electron-updater: Capawesome can *observe* a broken web bundle (app never becomes ready) and *automatically revert* it, whereas a broken NSIS install has already replaced the binary and nothing at runtime detects it.

---

## 3. Side-by-side comparison matrix

| Concern | electron-updater | Capawesome Live Update |
|---|---|---|
| **What it updates** | The **native app binary** (NSIS `.exe` / dmg / AppImage / deb) | The **web bundle** (HTML/JS/CSS) inside the installed app |
| **Trust anchor** | Ed25519 signature over the **manifest** (`latest*.yml`) that pins SHA512 of each installer (`eu-AppUpdater.ts:847-898`) | RSA-2048 signature over the **artifact bytes** (zip or per-file) (`cw-LiveUpdate.swift:1135-1191`) |
| **Good enough to keep** | Manifest sig valid + per-file SHA512 matches on download **and** re-hash on reuse (`eu-DownloadedUpdateHelper.ts:286-291`); NSIS adds Authenticode | RSA sig over bytes valid (or SHA256 if no key) + full unzip + `index.html` present, before the dir is committed (`cw-LiveUpdate.swift:377-394`) |
| **Rollout / channel** | Client-side `stagingPercentage` in the signed manifest + `channel`/`allowDowngrade` (`eu-AppUpdater.ts:682-703,737-744`) | **Server-side**: client reports device/app/channel, server returns one bundle (`cw-LiveUpdate.swift:632-645`); no client rollout logic |
| **Failure surfacing** | Typed `ERR_UPDATER_*` codes on an `error` event (`eu-AppUpdater.ts:869,891`; `eu-Provider.ts:355`) | `CustomError.*` exceptions via the Capacitor callback (`cw-LiveUpdate.swift:1107,1117,1127,1130`) |
| **Partial-download survival** | Temp file under temp name → verified → renamed; stale cache re-hashed and wiped next check (`eu-types.ts:151-154`, `eu-DownloadedUpdateHelper.ts:286-291`) | UUID scratch dir; whole downloads dir wiped at process start; bundle not committed until `moveItem` succeeds (`cw-LiveUpdate.swift:15-17,487-491,377-394`) |
| **Concurrent launches** | In-memory `DownloadedUpdateHelper` + `pending/update-info.json`; detached installer spawn | `hasBundleById` + rename race tolerated (loser sees dir exists); downloads dir cleared once per process (`cw-LiveUpdate.java:644-647,90,164-166`) |
| **No network at launch** | `checkForUpdates` → ECONNREFUSED retried ×3 then `error`; stays on current; pending re-validated on launch (`eu-GenericProvider.ts:37-48`) | `fetchLatestBundle` returns nil on error status, throws on offline; stays on current/default; **rollback timer still runs** (`cw-LiveUpdate.swift:653-659,872-886`) |
| **Forced downgrade** | Explicit: `allowDowngrade` flag; setting `channel` auto-enables it (`eu-AppUpdater.ts:208,316-328`) | No client concept — the server decides what "latest" is; blocklist can prevent a specific bad bundle (`cw-LiveUpdate.swift:948-974`) |
| **Runtime rollback** | **None** — once installed, only re-install an older build (§1.6) | **Built-in** ready-timeout → revert to in-package default + optional blocklist (`cw-LiveUpdate.swift:872-886`) |
| **Atomicity of the switch** | Installer replaces files out-of-band (no in-app atomicity); Mac/Squirrel is an exception (`eu-MacUpdater.ts:250-258`) | Atomic dir `move` + deferred server-path flip + rollback (`cw-LiveUpdate.swift:387-394,985-993`) |
| **Key type** | Ed25519 (PEM/base64 SPKI), rotation via key array | RSA-2048 (PEM X.509 SPKI), single key |
| **Differential download** | Blockmap (64 KB block) diffs built in (`eu-differentialDownloader/*`) | Manifest-type diff (per-file by checksum), or full zip (§2.2) |

### 3.1 The two trust models in one line

- **electron-updater = sign the *list*, pin the bytes.** You trust that the manifest is authentic (Ed25519); the manifest's `sha512` fields then authenticate the installer. If the manifest is forged, you catch it; if the installer bytes are swapped, the SHA512 mismatch catches it. Strong, *provided* the feed is authenticated end-to-end (TLS + a pinned public key).
- **Capawesome = sign the *bytes*.** You trust the RSA signature computed over the exact bundle you will run. There is no intermediate "list" to forge — the signature is on the payload. Equally strong, and it sidesteps a poisoned-manifest attack by construction, at the cost of signing each artifact (and re-signing on every content change).

Both are cryptographically sound; they differ in *what the signature covers* and in the **operational** safety layer (rollback), which is where the real decision weight for AIRIZ sits.

---

## 4. AIRIZ-specific conclusions

Context (from `apps/airiz-motor/README.md`): AIRIZ is a **Windows x64 Electron** motor-test console shipped as an **NSIS** installer (GitHub releases, e.g. `airiz-desktop-v1.11.25`), **currently unsigned**. It already has an opt-in **"safe auto-update" (1.11.22)** that only installs after the console has been idle for 5 minutes (no command/click/key/macro/recording/camera/voice), with a 30 s *Cancel* countdown — implemented in AIRIZ's own `desktop/update-controller.cjs` (`autoBusyReason`), idle time from `AirizConsole.getStatus().idleMs`. The dangerous artifact is the **web console** (the JS that drives the motor); the phone runs that same console in a browser/WebView.

### 4.1 What AIRIZ gets out of the box

**From electron-updater (desktop):**
- NSIS install + silent/elevate spawn, per-user or per-machine (`eu-NsisUpdater.ts:327-388`) — matches AIRIZ's existing NSIS packaging exactly.
- A maintained cache with SHA512 re-validation and failed/partial recovery that does *not* need AIRIZ to write (`eu-DownloadedUpdateHelper.ts`).
- The v27 **install-on-next-launch** + session-end skip that makes an update safe across Windows log-off/shutdown (`eu-BaseUpdater.ts:665-671,474-582`) — directly relevant to a tool left running overnight.
- **Signed manifests (Ed25519) + SHA512** ready to enable with one public key — the missing trust layer for today's *unsigned* builds.
- A `GenericProvider` that already points at any static host (R2/GitHub Releases) (`eu-GenericProvider.ts:28-52`).

**From Capawesome (phone/web):**
- Content-signed (RSA-2048) web-bundle updates with **no app-store / no full-reinstall** for the phone console.
- **Ready-timeout rollback to the in-package default** + blocklist — exactly the "a buggy web console must not mis-drive the motor" guard AIRIZ needs on the phone side (`cw-LiveUpdate.swift:872-886`).
- Deferred staging (next-load flip) so a phone never half-updates mid-session.

### 4.2 What AIRIZ would still have to build / customize

- **Sign at release time.** electron-updater verifies, but someone must *sign* `latest.yml` with the Ed25519 key (electron-builder's signed-manifest step) and *embed* the public key in `app-update.yml`/`updateManifestPublicKey` (`eu-AppUpdater.ts:356-366`). Same for Capawesome: generate the RSA-2048 pair and set `publicKey` + sign each bundle (`cw-LiveUpdateConfig.swift:8`).
- **Keep the motor-idle gate as the install precondition.** Both libraries have *no* concept of "is the machine safe to modify right now." AIRIZ's `update-controller.cjs` idle check must remain the gate that calls `quitAndInstall()` / `sync()`. Nothing in either library should be trusted to enforce it.
- **Decide the no-rollback gap on desktop.** electron-updater will happily install a broken NSIS build and has no way to detect it. If AIRIZ wants desktop rollback parity, it must add it (e.g., version-pin + "install older build" button, or a post-install smoke test). Capawesome gives this for free on the web layer; the desktop binary does not.
- **Host + serve channel files.** `latest.yml` (desktop) and the `/v1/apps/<appId>/bundles/latest` API (phone) must be produced and served from R2/GitHub Releases. Capawesome's default points at its cloud (`api.cloud.capawesome.io`, `cw-LiveUpdateConfig.swift:10`); self-hosting means matching that API or using their server.

### 4.3 One concrete architectural decision

**Adopt the signed-manifest trust model for desktop (electron-updater) and content-signing for the web/phone layer (Capawesome), and make the motor-idle gate the single install precondition shared by both.**

- Desktop: switch on `updateManifestPublicKey` (Ed25519) so the installer's SHA512 is pinned by a signature you control, host `latest.yml` on R2 via `GenericProvider`, keep `autoInstallEvent:"onNextLaunch"` for session-end safety, and keep `update-controller.cjs` as the only thing allowed to trigger `quitAndInstall()`.
- Phone/web: enable Capawesome with an RSA-2048 `publicKey`, `readyTimeout` sized to AIRIZ's console boot, and `autoBlockRolledBackBundles = true`, so a bad web bundle reverts to the shipped default before it can touch the motor.
- Net effect: **one control plane** (R2/GitHub Releases) for "what to run," two platform-native install mechanisms, two trust anchors (Ed25519 manifest for the desktop binary, RSA-2048 content for the web layer), and one safety gate (motor idle) in front of every install.

### 4.4 How this maps to the (a) / (b) / (c) options

- **(a) keep electron-updater + bolt Capawesome — RECOMMENDED.** It is the only option that matches both of AIRIZ's actual install surfaces (Electron/NSIS desktop + browser/WebView phone) *and* adds the rollback safety the web layer needs. Cost: sign at release time + host channel files + keep the existing idle gate. All additive; no runtime rewrite.
- **(b) migrate to Tauri — NOT recommended.** AIRIZ leans on Electron/Windows-native integrations the README describes (Power Automate/Teams hosts, `.NET` keyboard hook, native Windows dialogs, WebUSB). Tauri uses the system WebView, not Electron's Chromium; migrating means re-porting those integrations and losing the existing desktop updater for a Tauri updater (`signed JSON + .app.tar.gz`) that buys nothing the current stack lacks. High cost, no trust-model gain (Tauri's Ed25519 manifest ≈ electron-updater's).
- **(c) custom signed-manifest on R2/GitHub Releases — largely redundant.** `GenericProvider` + electron-builder's signed-manifest feature *is* a custom signed-manifest layer on R2/GitHub Releases, already maintained and already integrated. Building it from scratch duplicates the cache, differential, and re-validation logic this survey shows electron-updater already handles correctly (`eu-DownloadedUpdateHelper.ts`, `eu-differentialDownloader/*`). The only genuinely custom work is the thin release-signing glue — which is part of (a), not a separate updater.

**Bottom line:** (a) wins because the two libraries are complementary, not competing — electron-updater protects the *desktop binary*, Capawesome protects the *web console* with rollback — and the shared motor-idle gate keeps both safe. The decision that actually de-risks AIRIZ is enabling **signed artifacts** (it is signed today) rather than choosing between updaters.

---

*Survey R1 — synthesized from the local `.research/` source copies only. Line numbers reference those copies. electron-updater sources correspond to the v27 (electron-builder 27) line (signed-manifest + `autoInstallEvent` are v27 features); Capawesome sources correspond to the current `@capacitor/live-update` engine.*

---

## Appendix A. End-to-end trust trace (how a byte becomes installable)

### A.1 electron-updater (Windows/NSIS path)

1. Feed URL from `app-update.yml` / `setFeedURL` -> provider chosen. (`eu-AppUpdater.ts:587-601`)
2. `getUpdateInfoAndProvider` fetches + parses the channel file. (`eu-AppUpdater.ts:762-816`)
3. **Ed25519** manifest signature verified BEFORE any download. (`eu-AppUpdater.ts:810,847-898`)
4. `isUpdateAvailable` gates on version + client `stagingPercentage` + `minimumSystemVersion`. (`eu-AppUpdater.ts:922,712-744`)
5. `downloadUpdate` -> `NsisUpdater.doDownloadUpdate` selects the `.exe`. (`eu-AppUpdater.ts:964`; `eu-NsisUpdater.ts:196-198`)
6. Download runs with **SHA512** check in the HTTP executor. (`eu-NsisUpdater.ts:237`)
7. **Authenticode** publisher check on the `.exe`. (`eu-NsisUpdater.ts:240-248,286-313`)
8. Staged to `pending/`, `update-info.json` written (pins `sha512`). (`eu-DownloadedUpdateHelper.ts:90-114`)
9. Install: `beginInstall` -> `doInstall` -> spawn NSIS (silent/elevate). (`eu-BaseUpdater.ts:348-375`; `eu-NsisUpdater.ts:327-388`)
   - ...or deferred: `installPendingUpdate` re-hashes SHA512 + re-verifies sig on launch. (`eu-BaseUpdater.ts:474-582`)

**Three independent trust layers on the desktop binary: Ed25519 (manifest) -> SHA512 (bytes) -> Authenticode (publisher).**

### A.2 Capawesome Live Update (iOS/Android path)

1. Config provides `publicKey`, `serverDomain`, channel. (`cw-LiveUpdateConfig.swift:1-11`)
2. `sync` -> `fetchLatestBundle` GET `https://<serverDomain>/v1/apps/<appId>/bundles/latest`. (`cw-LiveUpdate.swift:340,632-666`)
3. Server returns the decision object (`GetLatestBundleResponse`: bundleId/url/checksum/signature). (`cw-GetLatestBundleResponse.swift:1-9`)
4. Blocked? skip. Already staged? flip next. Else download. (`cw-LiveUpdate.swift:351-371`)
5. `downloadBundleOfTypeZip` -> `downloadAndVerifyFile` (Alamofire / OkHttp). (`cw-LiveUpdate.swift:618-630,510-532`)
6. `verifyFile`: **RSA-2048** sig if `publicKey` set, else SHA256. (`cw-LiveUpdate.swift:1103-1133,1135-1191`)
7. Unzip, require `index.html`, `move` into `bundles/<bundleId>`. (`cw-LiveUpdate.swift:377-394`)
8. `setNextBundleById` persists the next-load server path. (`cw-LiveUpdate.swift:931-937,985-993`)
9. Next load: `reload` serves the new bundle; `startRollbackTimer` armed to `readyTimeout`. (`cw-LiveUpdate.swift:278-282,1034-1046`)
10. `ready()` in time -> stop timer, GC, block rolled-back; else `rollback()` to the in-package default. (`cw-LiveUpdate.swift:251-276,872-886`)

**One trust layer on the web bundle (RSA over bytes), wrapped in an atomic stage + ready-timeout rollback.**

## Appendix B. Failure surfacing catalogue

electron-updater raises typed `ERR_UPDATER_*` errors on the `error` event:

| Code | Meaning | Source |
|---|---|---|
| `ERR_UPDATER_INVALID_VERSION` | manifest / app version not valid semver | `eu-AppUpdater.ts:564,717` |
| `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` | `latest*.yml` 404 | `eu-GenericProvider.ts:36`; `eu-Provider.ts:38` |
| `ERR_UPDATER_INVALID_UPDATE_INFO` | unparseable manifest / YAML alias budget | `eu-Provider.ts:200,235,258` |
| `ERR_UPDATER_MANIFEST_NOT_SIGNED` | key set, manifest unsigned | `eu-AppUpdater.ts:869` |
| `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID` | key set, no key validates | `eu-AppUpdater.ts:891` |
| `ERR_UPDATER_NO_CHECKSUM` | file has no sha256/sha512 | `eu-Provider.ts:355`; `eu-NsisUpdater.ts:210` |
| `ERR_UPDATER_INVALID_SIGNATURE` | Authenticode / publisher mismatch | `eu-AppUpdater.ts:550`; `eu-NsisUpdater.ts:246,312` |
| `ERR_UPDATER_INVALID_UPDATE_FILE` | custom `verifyUpdateFile` rejected | `eu-AppUpdater.ts:566`; `eu-types.ts:472` |
| `ERR_UPDATER_NO_FILES_PROVIDED` | manifest has no files | `eu-Provider.ts:176,341` |
| `ERR_HTTP_RESPONSE_TOO_LARGE` | channel file over `maxUpdateInfoSize` | `eu-Provider.ts:141` |
| `ERR_UPDATER_WEB_INSTALLER_DISABLED` | NSIS web-installer blocked | `eu-AppUpdater.ts:531`; `eu-NsisUpdater.ts:206,347` |
| `ERR_UPDATER_INVALID_CHANNEL` | empty/non-string channel | `eu-AppUpdater.ts:320-322` |
| `ERR_UPDATER_FEED_BASE_URL_NOT_DECLARED` | custom provider + credentials | `eu-Provider.ts:95` |

Capawesome throws `CustomError.*` (Android: `LiveUpdatePlugin.ERROR_*`) to the callback:

| Error | Meaning | Source |
|---|---|---|
| `signatureMissing` | `publicKey` set but no signature | `cw-LiveUpdate.swift:1107` |
| `signatureVerificationFailed` | RSA verify failed / threw | `cw-LiveUpdate.swift:1114,1117`; `cw-LiveUpdate.java:1643,1675` |
| `checksumCalculationFailed` | could not hash the file | `cw-LiveUpdate.swift:1127`; `cw-LiveUpdate.java:1188` |
| `checksumMismatch` | SHA256 mismatch (no-key mode) | `cw-LiveUpdate.swift:1130`; `cw-LiveUpdate.java:1651` |
| `downloadFailed` | HTTP error / timeout | `cw-LiveUpdate.swift:524`; `cw-LiveUpdate.java:1295` |
| `bundleNotFound` | bundle id not on disk | `cw-LiveUpdate.swift:72,318` |
| `bundleAlreadyExists` | re-download of present bundle | `cw-LiveUpdate.swift:94` |
| `bundleIndexHtmlMissing` | no `index.html` in bundle | `cw-LiveUpdate.swift:380`; `cw-LiveUpdate.java:635` |
| `bundleMoveFailed` | concurrent move race lost | `cw-LiveUpdate.java:646` |
| `appIdMissing` | no app id configured | `cw-LiveUpdate.swift:867`; `cw-LiveUpdate.java:1406` |
| `syncInProgress` | sync re-entered | `cw-LiveUpdate.swift:331`; `cw-LiveUpdate.java:524` |
| `channelDiscoveryNotEnabled` | 401 on `/channels` | `cw-LiveUpdate.swift:125`; `cw-LiveUpdate.java:249` |
| `publicKeyInvalid` | bad PEM public key | `cw-LiveUpdate.java:753` |

## Appendix C. Key / algorithm reference

| | electron-updater | Capawesome |
|---|---|---|
| Signature algorithm | Ed25519 | RSA-2048, PKCS#1 v1.5, SHA-256 |
| Key encoding | PEM or base64 SPKI | PEM (base64 X.509 SubjectPublicKeyInfo) |
| Number of keys | array (key rotation) | single |
| What is signed | the manifest (`latest*.yml`) | the artifact bytes (zip / each file) |
| File checksum | SHA512 (always, per file) | SHA256 (only when no public key) |
| Extra (Windows) | Authenticode on the `.exe` | n/a |
| Verify library | `builder-util-runtime` `verifyManifestSignatures` | `SecKey*` (Security.framework) / JCA `Signature` |
| Opt-in behaviour | no key = verify skipped + one-time warn | `publicKey` null = SHA256-only mode |

## Appendix D. Not read in full (and why that is acceptable)

- electron-updater: `eu-AppImageUpdater.ts`, `eu-LinuxUpdater.ts`, `eu-DebUpdater.ts` (Linux installers - AIRIZ is Windows-only); `eu-providerFactory.ts` (provider selection); `eu-differentialDownloader/*` (blockmap-diff internals); `eu-electronHttpExecutor.ts`, `eu-util.ts`, `eu-AppAdapter.ts`, `eu-ElectronAppAdapter.ts` (plumbing); `eu-index.ts` / `eu-indexInternal.ts` (entry wiring).
- Capawesome: the JS-bridge option/result DTOs (`cw-SyncOptions`, `cw-DownloadBundleOptions`, `cw-SetNextBundleOptions`, `cw-ReadyResult`, `cw-SyncResult`), `cw-LiveUpdatePlugin.*` (plugin glue), `cw-LiveUpdatePreferences.*` (prefs store), `cw-LiveUpdateIonicManager.*` (headless host). The Java files mirror the Swift logic 1:1; Swift was used as the canonical source and Java line numbers were confirmed at the cited sites.

*End of survey R1.*
## Appendix E. Threat model: attack vectors vs. the layers that catch them

The single most important cross-cutting finding for the AIRIZ decision: **in both libraries the public key IS the security model.** With no key configured, both are effectively protected only by TLS, because the checksum they then trust is read from the *same* (untrusted) response.

| # | Attack | electron-updater catches it via | Capawesome catches it via |
|---|---|---|---|
| 1 | MITM / forged feed | Ed25519 manifest sig (only if `updateManifestPublicKey` set) + TLS | TLS (artifact sig protects the payload, not the "which bundle" choice) |
| 2 | Poisoned metadata (change rollout/channel after sign) | manifest is signed; `stagingPercentage`/`url` "covered by the signature" - re-sign required (`eu-AppUpdater.ts:878-888`) | not applicable client-side: the decision is server-side, protected only by TLS; the payload sig is the backstop |
| 3 | Swapped artifact (valid metadata, different bytes at the URL) | per-file SHA512 mismatch -> reject (`eu-DownloadedUpdateHelper.ts:286-291`) | RSA sig over bytes mismatch -> reject (`cw-LiveUpdate.swift:1135-1191`) |
| 4 | No key configured (AIRIZ today) | **fail-open**: `manifest-verification-disabled` warn, proceeds on SHA512 from the untrusted manifest (`eu-AppUpdater.ts:861-866`) | **degrades** to SHA256 from the untrusted response (`cw-LiveUpdate.swift:1121-1131`) |
| 5 | TOCTOU (file changes between verify and install) | verify under temp name, rename only after success; re-hash on next-launch reuse (`eu-types.ts:151-154`, `eu-DownloadedUpdateHelper.ts:286-291`) | verify in scratch dir, then `move`; downloads dir wiped at process start (`cw-LiveUpdate.swift:377-394,15-17`) |
| 6 | Downgrade to a vulnerable older build | `allowDowngrade` defaults false; older version refused unless opted in (`eu-AppUpdater.ts:737-744,208`) | no client version compare - server decides; blocklist can pin a specific bad bundle out (`cw-LiveUpdate.swift:948-974`) |
| 7 | Replay / tamper of an already-downloaded bundle | **re-hashed** on every reuse from cache (`eu-DownloadedUpdateHelper.ts:286-291`) | **trusted by presence** - `hasBundleById` flips to it with no re-verify (`cw-LiveUpdate.swift:356-365`) |
| 8 | Broken build ships and stays (no rollback) | none - installer already replaced the binary | ready-timeout auto-reverts to in-package default + blocklist (`cw-LiveUpdate.swift:872-886`) |

### E.1 The two asymmetries that matter for AIRIZ

- **Row 7 (re-verification on reuse).** electron-updater re-hashes a cached installer before it runs, so a bundle touched on disk between download and install is caught. Capawesome verifies the signature at download time but, on a subsequent sync that finds the bundle already on disk, flips to it by `bundleId` presence **without re-verifying** (`cw-LiveUpdate.swift:356-365`). A local writer with access to `bundles/` (e.g. a compromised side-process on the same device) could substitute a bundle. For a phone that is a lower threat, but it is a real gap to note if AIRIZ ever self-hosts Capawesome and shares the device.
- **Row 8 (runtime rollback).** This is the decisive operational difference: Capawesome can detect "the new web console never became ready" and revert it automatically; electron-updater cannot detect a broken desktop install at all. For AIRIZ - where the updated artifact that touches the motor is the **web console** - the Capawesome rollback is the safety feature that actually protects the hardware.

### E.2 Consequence for the (a)/(b)/(c) decision

- Signing is non-negotiable either way: an **unsigned** deployment is row 4 (fail-open / TLS-only) on *both* stacks. AIRIZ's current "unsigned binaries" (README) means enabling a key is the highest-leverage single change, independent of which updater option is picked.
- (b) Tauri offers no threat-model improvement over (a): Tauri's updater is also a signed-JSON-manifest (Ed25519) + SHA-256 model, i.e. the same class as electron-updater, and it still has no runtime rollback for the web layer.
- (a) is the only option that pairs a signed *binary* (desktop) with a signed, *auto-rolling-back* web layer (phone) - the two surfaces AIRIZ actually exposes to a motor.

## Appendix F. NSIS doInstall flow (full spawn + elevation logic)

The `doInstall()` method (`eu-NsisUpdater.ts:327-388`) is the entire Windows install path. It is called by `BaseUpdater.beginInstall()` (`eu-BaseUpdater.ts:348-375`) after all verification gates have passed. The code, abridged to the decision logic:

```ts
// eu-NsisUpdater.ts:327-388
protected doInstall(options: InstallOptions): boolean {
  const installerPath = this.installerPath
  const args = ["--updated"]                    // NSIS: this is an update, not first install
  if (options.isSilent) { args.push("/S") }     // silent / no UI
  if (options.isForceRunAfter) { args.push("--force-run") }

  const packagePath = this.downloadedUpdateHelper?.packageFile
  if (packagePath != null) {
    if (this.disableWebInstaller) {
      this.dispatchError(newError("...", "ERR_UPDATER_WEB_INSTALLER_DISABLED"))
      return false
    }
    args.push(`--package-file=${packagePath}`)
  }
  // must be last: NSIS takes everything after /D= as the directory
  if (this.installDirectory) { args.push(`/D=${this.installDirectory}`) }

  const callUsingElevation = (): void => {
    this.spawnLog(path.join(process.resourcesPath, "elevate.exe"), [installerPath].concat(args))
      .catch(e => this.dispatchError(e))
  }

  if (options.isAdminRightsRequired) {
    callUsingElevation()                         // elevated spawn (per-machine install)
    return true
  }

  this.spawnLog(installerPath, args).catch((e: Error) => {
    const errorCode = (e as NodeJS.ErrnoException).code
    if (errorCode === "UNKNOWN" || errorCode === "EACCES") {
      callUsingElevation()                       // fallback: elevate on permission error
    } else if (errorCode === "ENOENT") {
      require("electron").shell.openPath(installerPath)  // file not found: let Explorer handle
    } else {
      this.dispatchError(e)
    }
  })
  return true
}
```

**Key design points for AIRIZ:**

- **`--updated` flag** (`eu-NsisUpdater.ts:334`): tells the NSIS script it is an *update* (preserves user data, runs `UninstallPrevious` section). AIRIZ's NSIS template must honour this.
- **`elevate.exe`** (`eu-NsisUpdater.ts:361`): a bundled helper in `process.resourcesPath` that re-launches the installer with admin rights via the Windows UAC prompt. Per-user NSIS installs (`isAutoInstallOnNextLaunchSupported === true`, `:323-325`) never call this; per-machine installs do.
- **Detached spawn**: `spawnLog()` (in `eu-BaseUpdater.ts:736-746`) spawns with `detached: true` + `unref()`, so the installer outlives the Electron process. The app can quit immediately after `doInstall()` returns.
- **The `--updated` + `/S` combination** is what makes the install silent: no UI, no "keep my files?" prompt. For AIRIZ's safe auto-update (1.11.22), this is the path the idle-gate triggers.
- **Authenticode re-check on launch**: `verifyInstallerSignatureOnLaunch()` (`eu-NsisUpdater.ts:317-319`) delegates to the same `verifySignature()` used at download time, so a cached installer that was swapped on disk between download and next-launch install is caught.

## Appendix G. MacUpdater local HTTP proxy (feeding Squirrel.Mac)

`MacUpdater` extends `AppUpdater` directly (not `BaseUpdater`, `eu-MacUpdater.ts:19`) because macOS delegates the actual install to **Squirrel.Mac** (the native `electron.autoUpdater` object, `:20`). The verified zip must be *served* to Squirrel.Mac over HTTP, because Squirrel.Mac only knows how to fetch a zip from a URL.

`updateDownloaded()` (`eu-MacUpdater.ts:140-261`) is the mechanism:

```ts
// eu-MacUpdater.ts:140-261 (abridged)
private async updateDownloaded(zipFileInfo, event): Promise<void> {
  this.closeServerIfExists()
  this.server = createServer()
  const getServerUrl = (s: Server): string => { ... }  // "http://127.0.0.1:<port>"

  return await new Promise<void>((resolve, reject) => {
    const pass = randomBytes(64).toString("base64").replace(/\//g,"_").replace(/\+/g,"-")
    const authInfo = Buffer.from(`autoupdater:${pass}`, "ascii")
    const fileUrl = `/${randomBytes(64).toString("hex")}.zip`   // random path

    this.server!.on("request", (request, response) => {
      if (requestUrl === "/") {
        // Squirrel.Mac first GETs "/" expecting { "url": "..." }
        // Verify Basic auth, then respond with the file URL
        response.end(Buffer.from(`{ "url": "${getServerUrl(this.server!)}${fileUrl}" }`))
        return
      }
      if (!requestUrl.startsWith(fileUrl)) { response.writeHead(404); return }
      // Stream the verified zip to Squirrel.Mac
      const readStream = createReadStream(downloadedFile)
      readStream.pipe(response)
    })

    this.server!.listen(0, "127.0.0.1", () => {
      this.nativeUpdater.setFeedURL({
        url: getServerUrl(this.server!),
        headers: {
          "Cache-Control": "no-cache",
          Authorization: `Basic ${authInfo.toString("base64")}`,
        },
      })
      this.dispatchUpdateDownloaded(event)
      if (this.autoInstallEvent !== "manual") {
        this.nativeUpdater.checkForUpdates()  // triggers Squirrel.Mac to fetch + stage
      } else {
        resolve()  // "manual": just resolve; user calls quitAndInstall() later
      }
    })
  })
}
```

**Key design points:**

- **Loopback-only**: the server binds to `127.0.0.1` (`eu-MacUpdater.ts:237`), so it is invisible to the network.
- **Random auth + path**: a 64-byte random password and a 64-byte random file path make it infeasible for another local process to discover the feed or the zip (`:163-167`).
- **Both "onQuit" and "onNextLaunch" collapse** to Squirrel.Mac's native "stage now, apply on relaunch" (`:250-258`). The only difference is whether `checkForUpdates()` is called immediately (auto) or deferred (manual).
- **`quitAndInstall({waitUntilNextLaunch:true})`** simply quits, because Squirrel.Mac has already staged the zip; the next launch picks it up (`eu-MacUpdater.ts:272-281`).
- **AIRIZ relevance**: AIRIZ is Windows-only, so this path is not directly used. However, it demonstrates that electron-updater's Mac path gives *atomic staging + rollback for free* (Squirrel.Mac can revert to the previous `.app` if the new one fails to launch) — a capability the NSIS path does not have, reinforcing the need for a Capawesome-style rollback on the desktop web layer.

## Appendix H. Capawesome readiness model: ready(), startRollbackTimer(), rollback()

§2.5 described the rollback concept. This appendix shows the three functions that implement it, in full.

### H.1 `ready()` — the success signal (`cw-LiveUpdate.swift:251-276`)

The app **must** call `ready()` (via the Capacitor plugin bridge) before the rollback timer fires. It is the contract: "I booted, the WebView loaded, the console is functional."

```swift
// cw-LiveUpdate.swift:251-276
@objc public func ready(completion: @escaping (Result?, Error?) -> Void) {
    if config.readyTimeout <= 0 {
        // "Ready timeout is set to 0. Automatic rollback is disabled."
    }
    stopRollbackTimer()                                    // :257 — cancel the timer
    if config.autoDeleteBundles { deleteUnusedBundles() }  // :259-261 — GC
    let currentBundleId = getCurrentBundleId()
    let previousBundleId = getPreviousBundleId()
    if config.autoBlockRolledBackBundles && rollbackPerformed, let previousBundleId {
        addBlockedBundleId(previousBundleId)               // :267 — blocklist the bad bundle
    }
    let result = ReadyResult(currentBundleId: currentBundleId,
                             previousBundleId: previousBundleId,
                             rollback: rollbackPerformed)
    completion(result, nil)                                // :271 — return to JS
    setPreviousBundleId(bundleId: currentBundleId)         // :273 — update "previous"
    rollbackPerformed = false                              // :275 — reset flag
}
```

**Semantics:**
- If the timer already fired (rollback happened), `ready()` still succeeds but reports `rollback: true` and (with `autoBlockRolledBackBundles`) adds the *previous* bundle to the blocklist so the server's next "latest" pointing at it is refused.
- The `ReadyResult` is returned to JS so the app can log/act on whether a rollback occurred.
- GC (`autoDeleteBundles`) deletes all bundles except current + next, preventing unbounded disk growth.

### H.2 `startRollbackTimer()` — arming the safety net (`cw-LiveUpdate.swift:1034-1046`)

```swift
// cw-LiveUpdate.swift:1034-1046
private func startRollbackTimer() {
    guard config.readyTimeout > 0 else { return }   // 0 = disabled
    rollbackTimerLock.lock()
    defer { rollbackTimerLock.unlock() }
    clearRollbackTimer()
    if isAppInBackground {
        remainingRollbackTimeout = config.readyTimeout  // pause: don't count background time
    } else {
        scheduleRollback(afterMilliseconds: config.readyTimeout)
    }
}
```

Called by `reload()` (`:281`) every time the WebView's server path flips to a new bundle. The timer is a `DispatchWorkItem` (`:1026-1031`) that calls `rollback()` when it fires.

**Background pause** (`:1041-1042`): if the app is in the background when the timer starts (or re-enters background before it fires), the remaining time is saved and the timer is not scheduled. On foreground return, `resumeRollbackTimer()` (`:234-249`) reschedules with the remaining time. This prevents a suspended app from being rolled back for "not calling `ready()`" while it cannot possibly call it.

### H.3 `rollback()` — the revert (`cw-LiveUpdate.swift:872-886`)

```swift
// cw-LiveUpdate.swift:872-886
private func rollback() {
    rollbackPerformed = true
    let currentBundleId = getCurrentBundleId()
    setPreviousBundleId(bundleId: currentBundleId)
    if let _ = currentBundleId {
        // "App is not ready. Rolling back to default bundle."
        setNextBundleById(nil)       // next load → in-package default
        setCurrentBundleById(nil)    // current → in-package default
    } else {
        // "App is not ready. Default bundle is already in use."
    }
}
```

The rollback target is **`nil`** = the in-package default bundle (the web assets shipped inside the original app install). It is *not* "the last known-good live bundle." This is a conservative, safe choice: if the default bundle is also broken, the app is broken regardless, and the user sees the shipped baseline.

### H.4 The complete blocklist mechanism

- `addBlockedBundleId()` (`cw-LiveUpdate.swift:948-974`): appends to a `blockedBundleIds` array in `UserDefaults`, capped at 100 entries.
- `isBlockedBundleId()` (`cw-LiveUpdate.swift:976-983`): checked at the top of `sync()` (`:351`) — if the server's "latest" is in the blocklist, the update is silently skipped.
- The blocklist persists across app launches (UserDefaults) and is never automatically cleared. The only way to unblock is to clear app data or call `resetConfig()`.

**For AIRIZ:** setting `autoBlockRolledBackBundles = true` + `readyTimeout` sized to the console's boot time means a broken web console update is automatically reverted *and permanently refused* on subsequent syncs, without any human intervention. This is the single most valuable safety feature for protecting the motor from a bad web update.

## Appendix I. isStagingMatch — client-side rollout in electron-updater

electron-updater supports **client-side rollout** via the `stagingPercentage` field in the signed manifest. The decision is deterministic per-device (based on a UUID), so the same device always gets the same answer for a given percentage.

```ts
// eu-AppUpdater.ts:682-703
private async isStagingMatch(updateInfo: UpdateInfo): Promise<boolean> {
  const rawStagingPercentage = updateInfo.stagingPercentage
  let stagingPercentage = rawStagingPercentage
  if (stagingPercentage == null) {
    return true                               // no staging field = 100% rollout
  }
  stagingPercentage = Number(stagingPercentage)
  if (!Number.isFinite(stagingPercentage)) {
    this.log.warn(`Staging percentage is NaN: ${rawStagingPercentage}`)
    return true                               // fail-open on bad data
  }
  stagingPercentage = stagingPercentage / 100 // 0-100 → 0-1

  const stagingUserId = await this.stagingUserIdPromise.value
  const val = UUID.parse(stagingUserId).readUInt32BE(12)  // bytes 12-15 of the UUID
  const percentage = val / 0xffffffff
  this.log.info(`Staging percentage: ${stagingPercentage}, percentage: ${percentage}, user id: ${stagingUserId}`)
  return percentage < stagingPercentage
}
```

**How it works:**
1. The manifest (signed with Ed25519) carries `stagingPercentage: 25` (for example).
2. The client generates a stable `stagingUserId` (a UUID persisted on first run) and reads bytes 12-15 as a `UInt32`.
3. `val / 0xffffffff` gives a uniform float in `[0, 1)`.
4. If that float is below `stagingPercentage / 100`, the device is "in the rollout."
5. Because the manifest is signed, an attacker cannot change `stagingPercentage` without re-signing — the rollout percentage is as tamper-proof as the rest of the manifest.

**Contrast with Capawesome:** Capawesome has no client-side rollout. The server decides per-device which bundle to serve (the "decision object" pattern, §2.2). This means Capawesome rollout requires server-side logic (or their cloud), whereas electron-updater rollout is purely client-side and requires only a different `stagingPercentage` value in the signed manifest.

**For AIRIZ:** if AIRIZ wants a gradual desktop rollout (e.g., 10% of PCs get the new build first), they set `stagingPercentage: 10` in `latest.yml`, sign it, and upload. No server logic needed. This is a capability Capawesome does not offer on the client side.

*End of survey R1 (final).*
