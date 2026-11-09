# Auto-Update Library Deep-Dive: electron-updater vs @capawesome/capacitor-live-update

## Library Metadata

| Property | electron-updater | @capawesome/capacitor-live-update |
|---|---|---|
| **Version analyzed** | 6.8.11 (latest) / 6.8.12 (v26) / 7.0.0-alpha.13 (next) | 8.7.1 (latest) / 7.5.2 (v7-lts) / 6.9.2 (v6-lts) |
| **Repo** | electron-userland/electron-builder (packages/electron-updater/) | capawesome-team/capacitor-plugins (packages/live-update/) |
| **Package size** | 99 files, 565 KB (compiled JS + .d.ts + .js.map) | 113 files, 480.5 KB (full native source: Swift, Java, TypeScript) |
| **Languages** | TypeScript (compiled to JS) | Swift (iOS), Java (Android), TypeScript (JS API) |
| **Dependencies** | fs-extra, js-yaml, lazy-val, lodash.escaperegexp, lodash.isequal, semver, tiny-typed-emitter, builder-util-runtime | Alamofire (iOS), OkHttp3 + Brotli (Android), ZIPFoundation (iOS), zip4j (Android) |
| **License** | MIT | MIT |
| **Author** | Vladimir Krivosheev | Robin Genz (Capawesome) |
| **Platforms** | Windows (NSIS), macOS (Squirrel), Linux (AppImage, .deb, .rpm, .pacman) | Android, iOS, Electron (Capacitor Electron) |
| **Source analyzed from** | npm tarball electron-updater-6.8.11.tgz (out/ compiled JS) | npm tarball capacitor-live-update-8.7.1.tgz (ios/Plugin/, android/src/main/java/, dist/esm/) |

Note on source access: Both GitHub repos returned 404 via API (proxy restriction), so analysis was performed on the npm-published packages. For electron-updater, the npm package contains only compiled JS (out/), not the TypeScript source. For capacitor-live-update, the npm package contains full native source (Swift, Java) plus compiled TypeScript. Line numbers cited below refer to the files as published in these npm packages.

**30,000-foot summary:** These two libraries solve fundamentally different problems. electron-updater is a **full application updater**: it downloads and executes a native installer binary (.exe, .zip, .dmg, .AppImage, .deb, .rpm, .pacman) that replaces the entire application on disk, requiring a process restart. It is a pull-based system where the app fetches a YAML manifest from a URL, downloads the new installer, verifies it, and launches it. @capawesome/capacitor-live-update is a **web-asset live-update system**: it downloads a ZIP or manifest of web assets (HTML/CSS/JS) into a local bundle directory, switches the WebView's base path to point at the new bundle, and reloads the web layer without restarting the native process. It supports rollback to a previous bundle if the new one fails a readiness check. The two are complementary, not competing: electron-updater replaces the native shell, capacitor-live-update replaces the web content inside the shell. For AIRIZ Motor Console, the key architectural question is whether the PWA layer can be updated independently of the Electron shell, which capacitor-live-update supports natively while electron-updater cannot.

---

## 1. Manifest Format

### 1.1 electron-updater: latest.yml / latest-mac.yml / latest-linux.yml

The manifest is a **YAML file** fetched from a URL. The file name is derived from the channel name: getChannelFilename(channel) returns "channel + .yml" (out/util.js line 31). The channel is resolved as follows (out/providers/Provider.js lines 30-46):

- **Windows:** latest (no platform suffix), so the file is latest.yml
- **macOS:** latest-mac, so the file is latest-mac.yml
- **Linux:** latest-linux or latest-linux-arm64 (arch-specific), so the file is latest-linux.yml or latest-linux-arm64.yml

The channel can be overridden by the channel property on AppUpdater (line 25-45 of out/AppUpdater.js), which sets allowDowngrade = true automatically. Common channel names: latest, beta, alpha. For prerelease versions, the GitHub provider extracts the prerelease tag component (e.g., beta from 1.2.3-beta.1) as the channel (out/providers/GitHubProvider.js lines 52-90).

The YAML is parsed by js-yaml.load() in parseUpdateInfo() (out/providers/Provider.js line 97). The resulting object is an UpdateInfo (re-exported from builder-util-runtime). The fields are:

| Field | Type | Required | Description | Source |
|---|---|---|---|---|
| version | string | **Required** | Semver version string. Parsed by semver.parse() in isUpdateAvailable() (line 340). Invalid semver throws ERR_UPDATER_INVALID_VERSION. | out/AppUpdater.js:340 |
| files | Array<UpdateFileInfo> | **Required** (or path) | Array of file descriptors. If empty, falls back to deprecated path field (line 110). | out/providers/Provider.js:104-123 |
| files[].url | string | **Required** | Relative or absolute URL to the installer file. Resolved against baseUrl via newUrlFromBase(). | out/providers/Provider.js:124-134 |
| files[].sha2 | string | **Required** (sha2 OR sha512) | SHA-256 checksum. At least one of sha2/sha512 must be present; if neither, throws ERR_UPDATER_NO_CHECKSUM (line 128). | out/providers/Provider.js:127-129 |
| files[].sha512 | string | Optional | SHA-512 checksum (base64). Used for verification in executeDownload() (line 565). | out/AppUpdater.js:565 |
| files[].size | number | Optional | File size in bytes. Used by MacUpdater to set Content-Length header (line 125 of MacUpdater.js). | out/MacUpdater.js:125 |
| files[].isAdminRightsRequired | boolean | Optional | If true, Windows installer uses elevate.exe to run with admin privileges. | out/NsisUpdater.js:126-129 |
| path | string | Deprecated | Single-file fallback if files is empty/absent. | out/providers/Provider.js:110-118 |
| sha2 | string | Deprecated | SHA-256 for the single-file fallback. | out/providers/Provider.js:115 |
| sha512 | string | Deprecated | SHA-512 for the single-file fallback. | out/providers/Provider.js:116 |
| packages | object | Optional (Web installer) | Per-arch web installer package info. Keyed by process.arch with ia32 fallback. Contains path, sha512, size, blockMapSize. | out/providers/Provider.js:135-143 |
| releaseDate | string | Optional | ISO date string of the release. | Not directly used in updater logic |
| releaseName | string | Optional | Display name. If null, GitHub provider fills it from the Atom feed title (line 148 of GitHubProvider.js). | out/providers/GitHubProvider.js:147-149 |
| releaseNotes | string or Array | Optional | Release notes. If null, GitHub provider computes them from the Atom feed (lines 150-152). | out/providers/GitHubProvider.js:150-152 |
| stagingPercentage | string | Optional | Staging/rollout percentage (0-100). Parsed as int, compared against a deterministic per-user hash (lines 314-331). | out/AppUpdater.js:314-331 |
| minimumSystemVersion | string | Optional | Minimum OS version (semver). If current OS is below, update is skipped. | out/AppUpdater.js:364-379 |
| tag | string | Optional | Git tag. Set by GitHub/GitLab providers, not part of the YAML itself. | out/providers/GitHubProvider.js:154 |
| assets | Map<string,string> | Optional | GitLab-specific: map of asset name to URL. | out/providers/GitLabProvider.js:131 |

Example latest.yml (Windows):
`yaml
version: 2.0.0
files:
  - url: MyApp-Setup-2.0.0.exe
    sha512: "abc123...="
    size: 12345678
  - url: MyApp-Setup-2.0.0.exe.blockmap
    sha512: "def456...="
    size: 1234
path: MyApp-Setup-2.0.0.exe
sha512: "abc123...="
releaseDate: "2026-11-01T00:00:00.000Z"
stagingPercentage: "50"
`

Example latest-mac.yml (macOS):
`yaml
version: 2.0.0
files:
  - url: MyApp-2.0.0.zip
    sha512: "abc123...="
    size: 98765432
  - url: MyApp-2.0.0-arm64.zip
    sha512: "def456...="
    size: 87654321
`

### 1.2 capacitor-live-update: Two Distinct Manifest Types

capacitor-live-update has **two different manifest concepts** that serve different purposes:

#### A. The "Latest Bundle" API Response (Capawesome Cloud)

This is the JSON response from GET https://serverDomain/v1/apps/appId/bundles/latest (iOS: LiveUpdate.swift lines 632-666, Android: LiveUpdate.java lines 1101-1159). The response is parsed by GetLatestBundleResponse (iOS: GetLatestBundleResponse.swift lines 1-9, Android: GetLatestBundleResponse.java lines 1-83):

| Field | Type | Required | Description |
|---|---|---|---|
| artifactType | string ("zip" or "manifest") | **Required** | Determines download strategy. "zip" = single ZIP file, "manifest" = per-file download with delta support. |
| bundleId | string | **Required** | Unique identifier for the bundle. On Capawesome Cloud, this is the build artifact ID. The value public is reserved. |
| url | string | **Required** | Download URL. For "zip": direct URL to ZIP file. For "manifest": base URL; individual files fetched via url?href=path. |
| checksum | string | Optional | SHA-256 hex checksum. Only for self-hosted bundles. On Capawesome Cloud, returned as X-Checksum response header. |
| signature | string | Optional | Base64-encoded RSA signature over SHA-256. Only for self-hosted bundles. On Capawesome Cloud, returned as X-Signature response header. |
| channelName | string | Optional | The resolved channel name (may differ from the requested channel due to forced channel assignments). |
| customProperties | object<string,string> | Optional | Arbitrary key-value metadata associated with the bundle. |

The query parameters sent to the endpoint are: appVersionCode, appVersionName, bundleId (current), channelName, customId, deviceId, osVersion, platform ("0"=Android, "1"=iOS), pluginVersion.

#### B. The Bundle Manifest File (for "manifest" artifact type)

When artifactType is "manifest", the plugin downloads a file named capawesome-live-update-manifest.json (constant at LiveUpdate.swift line 26, LiveUpdate.java line 117). This is a **JSON array** of ManifestItem objects (iOS: ManifestItem.swift lines 1-5, Android: ManifestItem.java):

| Field | Type | Required | Description |
|---|---|---|---|
| href | string | **Required** | Relative file path within the bundle (e.g., index.html, assets/app.js). |
| checksum | string | **Required** | SHA-256 hex checksum of the file. Used for delta detection (comparing old vs new manifests). |
| sizeInBytes | number | **Required** | File size in bytes. Used for progress calculation. |

Example bundle manifest:
`json
[
  { "href": "index.html", "checksum": "a1b2c3...", "sizeInBytes": 4096 },
  { "href": "assets/app.js", "checksum": "d4e5f6...", "sizeInBytes": 102400 },
  { "href": "assets/style.css", "checksum": "g7h8i9...", "sizeInBytes": 20480 }
]
`

The manifest is parsed by loadManifest() (iOS: LiveUpdate.swift lines 809-814, Android: LiveUpdate.java lines 1334-1343). Delta detection uses Manifest.findDuplicateItems() and Manifest.findMissingItems() which compare checksums between old and new manifests (iOS: Manifest.swift lines 11-19, Android: Manifest.java).

**Key difference:** electron-updater has one manifest format (YAML) for all platforms. capacitor-live-update has two: an API response (Cloud) and a per-bundle manifest file (for delta downloads).

---

## 2. Provider Abstraction

### 2.1 electron-updater Provider Hierarchy

All providers extend the base Provider class (out/providers/Provider.js, 146 lines). The base class provides:
- getBlockMapFiles() -- computes old/new blockmap URLs for differential downloads (lines 22-26)
- isUseMultipleRangeRequest -- whether to use multipart HTTP Range requests (line 27-29)
- getChannelFilePrefix() -- platform suffix: "" for Windows, "-mac" for macOS, "-linux" or "-linux-<arch>" for Linux (lines 30-39)
- getDefaultChannelName() -- returns "latest" + platform prefix (lines 41-43)
- getCustomChannelName(channel) -- returns "<channel>" + platform prefix (lines 44-46)
- httpRequest(url, headers, cancellationToken) -- makes an HTTP request via the executor (lines 56-58)
- createRequestOptions(url, headers) -- builds request options, merging this.requestHeaders (lines 59-71)
- fileExtraDownloadHeaders -- optional extra headers for file downloads (line 47-49, returns null by default)

The provider factory is createClient() in out/providerFactory.js (lines 15-67). It switches on data.provider:

| Provider String | Class | Multi-Range | Notes |
|---|---|---|---|
| "github" | GitHubProvider or PrivateGitHubProvider | **No** | isUseMultipleRangeRequest: false because "GitHub uses S3" (line 16 of GitHubProvider.js). If token present (from GH_TOKEN/GITHUB_TOKEN env or options.token), uses PrivateGitHubProvider. |
| "bitbucket" | BitbucketProvider | **No** | API v2 at https://api.bitbucket.org/2.0/repositories/owner/slug/downloads. |
| "gitlab" | GitLabProvider | **No** | API v4 at https://host/api/v4. Supports PRIVATE-TOKEN or Bearer auth. |
| "keygen" | KeygenProvider | **No** | API at https://api.keygen.sh/v1/accounts/account/artifacts?product=product. Default channel: "stable". |
| "s3" / "spaces" | GenericProvider (S3-like) | **No** | URL computed by getS3LikeProviderBaseUrl(). |
| "generic" | GenericProvider | **Auto** | Multi-range disabled if URL contains s3.amazonaws.com (isUrlProbablySupportMultiRangeRequests, line 12-14 of providerFactory.js). |
| "custom" | User-supplied constructor | User-defined | options.updateProvider must be a class constructor. |

#### 2.1.1 GenericProvider (out/providers/GenericProvider.js, 51 lines)

- **URL convention:** baseUrl from configuration.url. The channel file is fetched from baseUrl + <channel>.yml.
- **Headers:** No special headers. requestHeaders from AppUpdater are merged in.
- **Retry:** On ECONNREFUSED, retries up to 3 times with linear backoff (1000 * attemptNumber ms) (lines 29-41).
- **Cache busting:** If no auth headers, appends ?noCache=timestamp query param (via isAddNoCacheQuery, out/AppUpdater.js lines 528-541).
- **resolveFiles:** Resolves file URLs relative to baseUrl (line 47).

#### 2.1.2 GitHubProvider / BaseGitHubProvider (out/providers/GitHubProvider.js, 237 lines)

**BaseGitHubProvider** (lines 11-28):
- Constructor takes options (with owner, repo, optional host), defaultHost, runtimeOptions.
- baseUrl = githubUrl(options, defaultHost) -- e.g., https://github.com/owner/repo/releases/
- baseApiUrl = githubUrl(options, apiHost) -- e.g., https://api.github.com/owner/repo/releases/
- isUseMultipleRangeRequest: false (line 16) because "GitHub uses S3".
- computeGithubBasePath(result) -- for non-github.com hosts (GHE), prepends /api/v3 (lines 23-27).

**GitHubProvider** (lines 30-186):
- **URL convention:** https://github.com/owner/repo/releases/
- **Check flow:**
  1. Fetch Atom feed: GET baseUrl.atom with Accept: application/xml (line 43)
  2. Parse XML to find latest release entry (line 48)
  3. If allowPrerelease: iterate all entries, match by prerelease channel (lines 51-90)
  4. Else: call getLatestTagName() which hits GET basePath/latest (line 162) or API endpoint for GHE (line 163)
  5. Fetch channel file: GET baseUrl/tag/download/tag/channelFile (line 118)
  6. Fallback: if custom channel fails and allowPrerelease, try latest.yml (lines 138-141)
- **resolveFiles:** Resolves file paths relative to baseUrl/tag/download/tag/ (lines 179-182). Spaces in filenames are replaced with - for backward compatibility.
- **Release notes:** Computed from Atom feed entries between current and latest version (lines 193-236). fullChangelog option controls whether all intermediate release notes are included.

**PrivateGitHubProvider** (out/providers/PrivateGitHubProvider.js, 95 lines):
- Extends BaseGitHubProvider (not GitHubProvider).
- Uses GitHub REST API: GET /repos/owner/repo/releases (line 78) or /releases/latest (line 59).
- Auth: Authorization: token <token> header (line 53).
- **fileExtraDownloadHeaders:** Returns { accept: "application/octet-stream", authorization: "token <token>" } (lines 46-48). This is critical -- private repo asset downloads require the auth token.
- **resolveFiles:** Maps file names to release asset URLs from the API response (lines 80-92).

#### 2.1.3 BitbucketProvider (out/providers/BitbucketProvider.js, 42 lines)

- **URL convention:** https://api.bitbucket.org/2.0/repositories/owner/slug/downloads/channel.yml
- **Headers:** None special.
- **No retry logic** (unlike GenericProvider).
- **Channel:** updater.channel || configuration.channel || "latest" (line 19).

#### 2.1.4 GitLabProvider (out/providers/GitLabProvider.js, 281 lines)

- **URL convention:** API at https://host/api/v4/projects/projectId/releases/permalink/latest
- **Headers:** PRIVATE-TOKEN: <token> or Authorization: Bearer <token> (lines 188-202).
- **Redirect handling:** redirect: "manual" (line 44) because GitLab uses redirects for asset downloads.
- **Channel file resolution:** Searches latestRelease.assets.links for a matching asset name (line 84).
- **Blockmap resolution:** For project_upload targets, searches assets for .blockmap files by name (lines 237-256).
- **Filename normalization:** Spaces and underscores are replaced with dashes to handle GitLab's URL encoding (lines 25-27, 261-263).

#### 2.1.5 KeygenProvider (out/providers/KeygenProvider.js, 46 lines)

- **URL convention:** https://host/v1/accounts/account/artifacts?product=product/channel.yml
- **Headers:** Accept: application/vnd.api+json, Keygen-Version: 1.1 (lines 28-30).
- **Default channel:** "stable" (line 20).

### 2.2 capacitor-live-update: No Provider Abstraction

capacitor-live-update does **not** have a provider abstraction in the electron-updater sense. Instead, it has two distinct "modes":

1. **Capawesome Cloud mode** (sync(), fetchLatestBundle()): Communicates with https://serverDomain/v1/apps/appId/bundles/latest. The server domain is configurable (default: api.cloud.capawesome.io). Auth is implicit (the appId identifies the app). No API key or token in the request.

2. **Self-hosted mode** (downloadBundle()): The caller provides the full URL, checksum, and signature. The plugin downloads from that URL directly. No manifest fetching -- the caller must know the bundle URL.

The HTTP client is LiveUpdateHttpClient (iOS: LiveUpdateHttpClient.swift, 64 lines; Android: LiveUpdateHttpClient.java, 117 lines). Key characteristics:

- **iOS:** Uses Alamofire. cachePolicy = .reloadIgnoringLocalCacheData (line 31). Timeout from config.httpTimeout (default 60000ms). Adds X-Capawesome-Device-Id header.
- **Android:** Uses OkHttp3 with Brotli decompression interceptor. Dispatcher.setMaxRequestsPerHost(30) for parallel downloads (line 59). Same timeout and device header.
- **Checksum/Signature from headers:** Both platforms read X-Checksum and X-Signature response headers as a fallback when no explicit checksum/signature is provided (iOS: lines 10-18, Android: lines 36-51).

---

## 3. Signed Channels / Signature Verification

### 3.1 electron-updater: Multi-Layer Verification

electron-updater uses a **three-layer verification** approach:

#### Layer 1: Checksum (SHA-256 or SHA-512)

- The manifest (latest.yml) contains sha2 and/or sha512 for each file.
- During download, executeDownload() passes sha2 and sha512 to the download options (out/AppUpdater.js lines 561-566). The builder-util-runtime HttpExecutor.download() method verifies the checksum as the file is streamed to disk.
- If sha512 is present, it is used; otherwise sha2 is used. At least one must be present (out/providers/Provider.js lines 127-129).
- Checksum mismatch throws ERR_CHECKSUM_MISMATCH (line 650 of AppUpdater.js).

#### Layer 2: Code Signature (Windows Only)

- **Windows (NSIS):** After the .exe is downloaded, NsisUpdater.verifySignature() is called (out/NsisUpdater.js line 52). This:
  1. Reads publisherName from app-update.yml (line 87). If not present, verification is **skipped** (returns null).
  2. Calls verifyUpdateCodeSignature(publisherNames, tempUpdateFile) which defaults to windowsExecutableCodeSignatureVerifier.verifySignature() (out/NsisUpdater.js line 16).
  3. The verifier (out/windowsExecutableCodeSignatureVerifier.js, 142 lines) runs a PowerShell command: Get-AuthenticodeSignature -LiteralPath '<file>' | ConvertTo-Json -Compress (line 47).
  4. Parses the JSON output, checks Status === 0 (valid signature), then compares the SignerCertificate.Subject Distinguished Name against the configured publisherName (lines 56-89).
  5. If the signature is invalid or the publisher does not match, returns an error string. The caller throws ERR_UPDATER_INVALID_SIGNATURE (line 56 of NsisUpdater.js).
  6. The verifyUpdateCodeSignature function is **overridable** (lines 22-29) -- the app can supply a custom verification function.
  7. On old Windows (6.x pre-6.3), PowerShell may not support ConvertTo-Json, so verification is skipped with a warning (lines 120-130).
  8. **Command injection protection:** The file path is escaped by replacing single-quote with double single-quote (line 45).

- **macOS:** No explicit code signature verification in the updater code itself. The .zip is downloaded and piped to Squirrel.Mac via a local HTTP proxy server (see Section 5). Squirrel.Mac itself may verify the code signature, but electron-updater does not.

- **Linux:** No signature verification. .deb, .rpm, .AppImage, .pacman files are downloaded and installed directly.

#### Layer 3: Cached File Re-verification

- On subsequent launches, DownloadedUpdateHelper.validateDownloadedPath() checks if a previously downloaded file still exists and matches the expected SHA-512 (out/DownloadedUpdateHelper.js lines 33-52, 88-132).
- If the cached update-info.json has a matching sha512, the file is re-hashed and compared (lines 114-129). Mismatch triggers cache cleanup.

#### RSA Public Key: NOT used in electron-updater

electron-updater does **not** use an embedded RSA public key for manifest or file signature verification. The security model is:
- HTTPS transport encryption
- SHA-256/SHA-512 checksums in the manifest (integrity)
- Windows Authenticode code signature (authenticity, optional)
- The manifest itself is fetched over HTTPS from a trusted URL

### 3.2 capacitor-live-update: RSA Signature + SHA-256 Checksum

capacitor-live-update uses a **two-option verification** approach:

#### Option A: RSA Signature (preferred)

- If config.publicKey is set (PEM-encoded RSA 2048-bit public key), **signature verification is used instead of checksum**.
- The signature is a base64-encoded RSA-PKCS1v15-SHA256 signature over the file bytes.
- **iOS verification** (LiveUpdate.swift lines 1135-1191):
  1. Strip PEM headers/footers and newlines from the public key (lines 1137-1139).
  2. Decode base64 to get DER-encoded key data (line 1140).
  3. Create a SecKey with kSecAttrKeyTypeRSA, 2048 bits (lines 1144-1151).
  4. Read the file in 2048-byte chunks, computing a SHA-256 digest via CommonCrypto (CC_SHA256_Update) (lines 1163-1175).
  5. Call SecKeyVerifySignature() with rsaSignatureDigestPKCS1v15SHA256 algorithm (lines 1185-1186).
- **Android verification** (LiveUpdate.java lines 1656-1677):
  1. Decode the public key from PEM to X509EncodedKeySpec (lines 744-755).
  2. Create a java.security.Signature instance with "SHA256withRSA" (line 1664).
  3. Read the file in 2048-byte chunks via Okio, calling sig.update() (lines 1666-1670).
  4. Call sig.verify(signatureBytes) (line 1672).

#### Option B: SHA-256 Checksum (fallback)

- If publicKey is NOT set but checksum is provided, SHA-256 checksum verification is used.
- The checksum is compared as a hex string (iOS: LiveUpdate.swift lines 708-719, Android: LiveUpdate.java lines 1176-1199).
- Mismatch throws checksumMismatch / ERROR_CHECKSUM_MISMATCH.

#### Verification Flow (both platforms)

verifyFile() is called after download completes (iOS: LiveUpdate.swift line 531, Android: LiveUpdate.java line 835):
1. If publicKey is set:
   - If signature is missing: throw signatureMissing
   - Verify RSA signature; if failed: throw signatureVerificationFailed
2. Else if checksum is provided:
   - Compute SHA-256 of the file
   - Compare with expected checksum; if mismatch: throw checksumMismatch

The "update strategy" in capacitor-live-update does **not** include additional cryptographic verification beyond what is described above. The autoUpdateStrategy config option ("none" or "background") controls **when** updates are checked, not how they are verified.

**Key architectural difference:** electron-updater verifies the **installer binary** (the .exe, .zip, etc.). capacitor-live-update verifies the **web bundle** (the ZIP file or individual manifest files). The threat models are different: electron-updater protects against a compromised installer that could install malicious native code; capacitor-live-update protects against a compromised web bundle that could execute malicious JavaScript in the WebView.

---

## 4. Cache / Staging Layer

### 4.1 electron-updater: Platform-Specific Cache Paths

The cache directory is determined by AppAdapter.getAppCacheDir() (out/AppAdapter.js lines 6-19):

| Platform | Cache Base Path |
|---|---|
| **Windows** | %LOCALAPPDATA% (or ~\AppData\Local) |
| **macOS** | ~/Library/Caches |
| **Linux** | XDG_CACHE_HOME (or ~/.cache) |

The full cache directory is <baseCachePath>/<updaterCacheDirName> where updaterCacheDirName comes from app-update.yml (line 545 of AppUpdater.js). If not specified, falls back to app.name.

The DownloadedUpdateHelper (out/DownloadedUpdateHelper.js, 170 lines) manages the cache:

- **cacheDir:** The main cache directory (e.g., ~/.cache/app-name/)
- **cacheDirForPendingUpdate:** cacheDir/pending (line 31) -- where the in-progress download is written
- **file:** The final downloaded installer path (e.g., cacheDir/pending/AppName-Setup-2.0.0.exe)
- **packageFile:** For web installers, the package file path (e.g., cacheDir/pending/package-2.0.0.7z)
- **update-info.json:** Written to cacheDir/pending/update-info.json after successful download (line 64). Contains { fileName, sha512, isAdminRightsRequired }.
- **current.blockmap:** Cached blockmap file at cacheDir/current.blockmap (line 592 of AppUpdater.js). Used for differential downloads.

**Download flow:**
1. Create temp file: temp-<updateFileName> in cacheDirForPendingUpdate (line 629 of AppUpdater.js, via createTempUpdateFile() at DownloadedUpdateHelper.js lines 151-169).
2. Download to temp file.
3. On success: rename temp-<file> to <file> with retry on EBUSY (60 retries, 500ms interval, lines 632-642).
4. Write update-info.json to cacheDirForPendingUpdate.
5. Copy pending blockmap to cacheDir/current.blockmap.

**Cache validation on next launch:**
- validateDownloadedPath() (lines 33-52) checks:
  1. If same running instance: compare versionInfo and fileInfo equality, check file existence.
  2. If previous instance: read update-info.json, compare sha512, re-hash the file, compare.
  3. If mismatch or file missing: clean the pending directory and re-download.

**Resume behavior on crash mid-download:**
- There is **no HTTP Range-based resume** for full downloads. If the app crashes mid-download, the temp file is left in cacheDirForPendingUpdate. On next launch, validateDownloadedPath() will find no valid update-info.json (or a mismatched checksum), clean the pending directory, and **start the download from scratch**.
- The createTempUpdateFile() function (lines 151-169) attempts to unlink any existing temp file before returning the path, so a stale temp file is removed.
- **Exception:** Differential downloads DO use HTTP Range requests, but they are always started fresh (the blockmap comparison determines what to download, not what was already downloaded).

### 4.2 capacitor-live-update: Bundle Directory + Downloads Directory

**iOS** (LiveUpdate.swift):
- **Downloads directory:** cachesDirectory/capawesome_capacitor_live_update_downloads (line 10-12). This is the system caches directory, which iOS may purge under storage pressure.
- **Bundles directory:** libraryDirectory/NoCloud/ionic_built_snapshots (line 20). The NoCloud prefix prevents iCloud backup. The ionic_built_snapshots name is historical (from Ionic Appflow).
- **Bundle path:** bundlesDirectory/bundleId (line 421-424).
- **Interrupted downloads cleanup:** On init, interruptedDownloadsDeleted static let deletes the entire downloads directory (lines 13-17). This runs once per process and blocks concurrent initializers.
- **Temporary download directory:** downloadsDirectory/UUID (line 488). Deleted via defer after download completes or fails (lines 588, 621).

**Android** (LiveUpdate.java):
- **Downloads directory:** cacheDir/capawesome_capacitor_live_update_downloads (line 115, 669-671). Uses context.getCacheDir().
- **Bundles directory:** filesDir/_capacitor_live_update_bundles (line 114, 661-663). Uses context.getFilesDir() (not cache, so not auto-deleted).
- **Bundle path:** bundlesDirectory/bundleId (line 665-667).
- **Interrupted downloads cleanup:** On init, tryDeleteDownloadsDirectory() is called once per process (lines 162-166, guarded by AtomicBoolean).
- **Temporary download directory:** downloadsDirectory/UUID (line 758). Deleted via deleteTemporaryDirectoryOnCompletion() wrapper (lines 787-801).

**Unzip behavior:**
- **iOS:** Uses ZIPFoundation library. unzipDownloadedBundle() unzips to zipFile.parent/bundle/ (lines 1096-1101).
- **Android:** Uses zip4j library. unzipDownloadedBundle() unzips to zipFile.parentFile/bundle/ (lines 1615-1626). **Important:** It clears Unix permissions from ZIP file headers (fileHeader.setExternalFileAttributes(null)) to prevent EACCES errors on newer Android versions (lines 1621-1623).
- After unzip, addBundle() searches for index.html recursively (iOS: lines 888-913, Android: lines 1428-1451). The directory containing index.html is moved to bundlesDirectory/bundleId.

**Bundle deletion:**
- deleteUnusedBundles() (iOS: lines 504-508, Android: lines 803-810) is called from ready() when autoDeleteBundles is enabled.
- A bundle is "unused" if it is neither the current bundle nor the next bundle (iOS: tryDeleteUnusedBundle() lines 1080-1094, Android: tryDeleteUnusedBundle() lines 620-629).

**No partial-download resume:**
- Unlike electron-updater, capacitor-live-update does **not** implement HTTP Range-based resume. If the download is interrupted, the entire file must be re-downloaded. The temp directory is deleted on next app start.

---

## 5. Binary Verification Flow

### 5.1 electron-updater: Exact Sequence

The update flow is platform-specific. The entry point is checkForUpdates() -> doCheckForUpdates() -> downloadUpdate() -> doDownloadUpdate() (platform-specific) -> executeDownload() -> install() -> doInstall() (platform-specific).

#### Windows (NsisUpdater)

1. **checkForUpdates()** (AppUpdater.js line 253) -> doCheckForUpdates() (line 400):
   - Emits "checking-for-update" event
   - Calls getUpdateInfoAndProvider() (line 380) which loads app-update.yml, creates the provider, fetches the channel file
   - Calls isUpdateAvailable() (line 339) which compares versions
   - Emits "update-available" or "update-not-available"

2. **downloadUpdate()** (line 435) -> doDownloadUpdate() in NsisUpdater (line 31):
   - Finds the .exe file from the resolved files
   - Calls executeDownload() with fileExtension: "exe"

3. **executeDownload()** (AppUpdater.js line 559):
   - Creates DownloadedUpdateHelper with cache directory
   - Checks validateDownloadedPath() -- if a valid cached file exists, skips download
   - Creates temp file temp-<fileName> in pending directory
   - **Differential download attempt** (lines 47-51 of NsisUpdater.js): If not a web installer and not disabled, calls differentialDownloadInstaller() (line 660 of AppUpdater.js). This downloads the new blockmap, gets the old blockmap from cache or server, creates a GenericDifferentialDownloader, and calls download(oldBlockMap, newBlockMap). If differential fails, falls back to full download.
   - **Full download** (line 50): httpExecutor.download(fileInfo.url, destinationFile, downloadOptions) -- streams the file to disk with checksum verification
   - **Code signature verification** (line 52): verifySignature(destinationFile) -- runs PowerShell Get-AuthenticodeSignature
   - If signature fails: throws ERR_UPDATER_INVALID_SIGNATURE, removes temp files
   - **Web installer package download** (lines 58-77): If isWebInstaller, also downloads the .7z package file with its own differential download

4. **done() callback** (lines 593-609):
   - Calls downloadedUpdateHelper.setDownloadedFile() -- writes update-info.json
   - Emits "update-downloaded" event with { ...updateInfo, downloadedFile: updateFile }
   - Copies pending blockmap to cache

5. **quitAndInstall()** (BaseUpdater.js line 13):
   - Calls install() (line 42)
   - install() calls doInstall() (line 58)

6. **doInstall()** (NsisUpdater.js line 101):
   - Builds args: --updated, /S (if silent), --force-run (if force-run-after), /D=installDir, --package-file=path (if web installer)
   - If isAdminRightsRequired: spawns elevate.exe <installer> <args> (line 124)
   - Else: spawns <installer> <args> directly (line 131)
   - If spawn fails with EACCES: falls back to elevate.exe
   - If spawn fails with ENOENT: falls back to electron.shell.openPath()
   - The installer process is **detached** (detached: true in spawnLog(), BaseUpdater.js line 133) and **unref'd** (line 138)
   - After install() returns true, quitAndInstall() emits "before-quit-for-update" and calls app.quit() (lines 18-22)

#### macOS (MacUpdater)

1-3. Same as Windows up to executeDownload().

4. **doDownloadUpdate()** (MacUpdater.js line 52):
   - Detects architecture: arm64 vs x64 (lines 56-78). Uses sysctl.proc_translated for Rosetta detection, uname -a for ARM detection.
   - Filters files for arch: filterFilesForArch() (lines 30-36) -- on arm64 Macs, prefers arm64 files; on x64, excludes arm64.
   - Finds the .zip file (lines 81-84). Throws ERR_UPDATER_ZIP_FILE_NOT_FOUND if not found.
   - **Differential download attempt** (lines 100-103): If update.zip exists in cache and differential not disabled, attempts differential download.
   - **Full download** (line 105): httpExecutor.download(zipFileInfo.url, destinationFile, downloadOptions).

5. **done() callback** (lines 108-119):
   - Copies the downloaded zip to cacheDir/update.zip for future differential downloads (lines 109-117).
   - Calls updateDownloaded() (line 122).

6. **updateDownloaded()** (line 122):
   - Creates a **local HTTP proxy server** on 127.0.0.1:random-port (line 130).
   - Generates a random 64-byte password for Basic auth (line 144).
   - The proxy serves:
     - GET / -> returns JSON { "url": "http://127.0.0.1:port/random-hex.zip" } after auth check (lines 151-174)
     - GET /random-hex.zip -> pipes the downloaded .zip file (lines 176-206)
   - Calls nativeUpdater.setFeedURL() pointing to the proxy (line 211-217).
   - Emits "update-downloaded" event (line 219).
   - If autoInstallOnAppQuit: calls nativeUpdater.checkForUpdates() which triggers Squirrel.Mac to fetch from the proxy and install (lines 220-223).
   - The proxy server is closed on app quit (closeServerIfExists(), lines 42-51).

7. **quitAndInstall()** (line 240):
   - If squirrelDownloadedUpdate is true (Squirrel already fetched): calls handleUpdateDownloaded() which calls nativeUpdater.quitAndInstall() or app.quit() (lines 231-238).
   - If not yet downloaded: registers a one-time listener on "update-downloaded" event to call handleUpdateDownloaded(), and calls nativeUpdater.checkForUpdates() to trigger the download (lines 246-254).

#### Linux (AppImage / Rpm / Deb / Pacman)

**AppImage** (AppImageUpdater.js):
1. Download .AppImage file (with optional differential download using FileWithEmbeddedBlockMapDifferentialDownloader).
2. chmod 0o755 the downloaded file (line 45).
3. doInstall() (line 72): Unlinks the current AppImage (line 81). Moves the new AppImage to the same location (line 98). Spawns the new AppImage with APPIMAGE_SILENT_INSTALL=true (line 104) or APPIMAGE_EXIT_AFTER_INSTALL=true (line 111).

**RPM** (RpmUpdater.js): Download .rpm. doInstall() (line 27): Detects package manager (zypper > dnf > yum > rpm), runs install command with sudo if needed.

**DEB** (DebUpdater.js): Download .deb. doInstall() (line 27): Detects package manager (dpkg > apt), runs install command with sudo if needed. dpkg -i with fallback to apt-get install -f -y for dependency issues.

**Pacman** (PacmanUpdater.js): Download .pacman. doInstall() (line 27): Runs pacman -U --noconfirm <file>. On failure, retries after pacman -Sy.

### 5.2 capacitor-live-update: Exact Sequence

The entry point is sync() or downloadBundle().

#### sync() Flow (Capawesome Cloud)

1. **sync()** (iOS: LiveUpdate.swift line 329, Android: LiveUpdate.java line 522):
   - Checks syncInProgress flag to prevent concurrent syncs.
   - Calls fetchLatestBundle() which sends a GET request to the Cloud API.
   - If no response: returns SyncResult(nextBundleId: null).
   - If bundle is blocked (in blockedBundleIds): skips download.
   - If bundle already exists locally: sets it as next bundle if different from current.
   - If bundle is new: proceeds to download.

2. **Download** (depends on artifactType):

   **ZIP type** (downloadBundleOfTypeZip(), iOS: line 618, Android: line 1056):
   - Create temp directory <downloadsDir>/UUID/.
   - Download ZIP to <tempDir>/bundle.zip via downloadAndVerifyFile().
   - downloadAndVerifyFile() (iOS: line 510, Android: line 812): Uses Alamofire (iOS) / OkHttp (Android) to download the file. Progress callbacks are emitted as DownloadBundleProgressEvent. After download, extracts X-Checksum and X-Signature from response headers if not explicitly provided. Calls verifyFile() -- RSA signature or SHA-256 checksum.
   - **Unzip:** unzipDownloadedBundle() unzips to <tempDir>/bundle/.
   - **Add bundle:** addBundle() searches for index.html, moves the containing directory to <bundlesDir>/bundleId/.

   **Manifest type** (downloadBundleOfTypeManifest(), iOS: line 585, Android: line 970):
   - Create temp directory.
   - Download capawesome-live-update-manifest.json from url?href=capawesome-live-update-manifest.json.
   - Load the latest manifest. Load the current manifest (from current bundle or app assets).
   - Compare manifests: findDuplicateItems() (same checksum = copy) and findMissingItems() (new/changed = download).
   - Copy duplicate files from current bundle to temp directory.
   - Download missing files in parallel (iOS: withThrowingTaskGroup, Android: OkHttp async calls with CountDownLatch).
   - Each file is downloaded via url?href=href and verified.
   - Add the bundle (same as ZIP type).

3. **Set next bundle:** setNextBundleById(bundleId) (iOS: line 931, Android: line 1483):
   - Stores the bundle path in KeyValueStore (iOS) / SharedPreferences (Android).
   - Emits NextBundleSetEvent to listeners.
   - The bundle is NOT applied yet -- it will be used on next reload() or app restart.

4. **reload()** (iOS: line 278, Android: line 472):
   - Reads the next bundle path.
   - Sets it as the current Capacitor server path (changes the WebView base path).
   - Emits ReloadedEvent.
   - **Starts the rollback timer** (startRollbackTimer(), iOS: line 1034, Android: line 1584).

5. **ready()** (iOS: line 251, Android: line 445):
   - **Stops the rollback timer.** This is the "I am safe" signal.
   - If autoDeleteBundles: deletes unused bundles.
   - Gets current and previous bundle IDs.
   - If autoBlockRolledBackBundles and rollback occurred: blocks the previous bundle.
   - Returns ReadyResult(currentBundleId, previousBundleId, rollback).
   - Sets the new previous bundle ID.
   - Resets rollbackPerformed flag.

---

## 6. App-Quit Timing Hooks

### 6.1 electron-updater

#### beforeQuitForUpdate Event

- Emitted in BaseUpdater.quitAndInstall() (line 20 of BaseUpdater.js): require("electron").autoUpdater.emit("before-quit-for-update").
- This is emitted on the **Electron autoUpdater** emitter, not on the custom AppUpdater instance.
- The host app can listen: autoUpdater.on('before-quit-for-update', () => { ... }).
- After emitting, this.app.quit() is called immediately (line 21).
- **Purpose:** Allows the app to perform cleanup (save state, close connections) before the process terminates and the installer runs.

#### isUpdaterActive()

- Defined in AppUpdater.js lines 277-284.
- Returns false if !app.isPackaged && !forceDevUpdateConfig.
- When false, checkForUpdates() returns Promise.resolve(null) immediately (line 254-256).
- **Purpose:** Prevents update checks in development mode (unpacked Electron apps) unless forceDevUpdateConfig is explicitly set.

#### autoInstallOnAppQuit Pattern

- Default: true (line 114 of AppUpdater.js).
- When a download completes, BaseUpdater.executeDownload() calls addQuitHandler() (line 33 of BaseUpdater.js).
- addQuitHandler() (lines 69-89) registers a one-time app.on("quit", handler):
  - If quitAndInstallCalled is already true: does nothing (installer already triggered).
  - If autoInstallOnAppQuit is false: does nothing.
  - If exitCode !== 0: does nothing (app is crashing, not clean quit).
  - Otherwise: calls this.install(true, false) -- silent install on quit.
- **This means:** If the user downloads an update but does not click "Restart Now", the update is silently installed the next time the app quits cleanly.

#### autoRunAppAfterInstall

- Default: true (line 119 of AppUpdater.js).
- Controls whether the app is relaunched after the installer completes.
- On Windows: passed as --force-run arg to the NSIS installer (line 112 of NsisUpdater.js).
- On macOS: handleUpdateDownloaded() calls nativeUpdater.quitAndInstall() if autoRunAppAfterInstall is true, else app.quit() (lines 231-238 of MacUpdater.js).

#### Decision: When is it safe to relaunch?

electron-updater does **not** have a "safe to relaunch" heuristic. The decision is:
1. **Explicit:** User calls quitAndInstall() -> app quits immediately after installer launches.
2. **Implicit (autoInstallOnAppQuit):** App quits naturally -> installer runs silently.
3. The installer itself (NSIS, Squirrel.Mac, etc.) handles the relaunch. electron-updater just spawns the installer and quits.

### 6.2 capacitor-live-update

capacitor-live-update does **not** have app-quit hooks in the electron-updater sense. It operates on a **WebView reload** model, not a process restart model.

#### Rollback Timer (the key timing mechanism)

- **startRollbackTimer()** (iOS: line 1034, Android: line 1584):
  - Called when reload() is invoked or when the app initializes.
  - If readyTimeout <= 0: no timer is started (rollback disabled).
  - If app is in background/stopped: stores remainingRollbackTimeout but does not schedule (the timer only counts foreground time).
  - If app is in foreground: schedules scheduleRollback(readyTimeout).

- **scheduleRollback(afterMilliseconds)** (iOS: line 1017, Android: line 1573):
  - Sets a DispatchWorkItem (iOS) / Handler.postDelayed (Android) to fire after the timeout.
  - When it fires: calls rollback().

- **rollback()** (iOS: line 872, Android: line 1411):
  - Sets rollbackPerformed = true.
  - Saves current bundle as previousBundleId.
  - If a non-default bundle is current: sets next bundle to null (default) and current bundle to null (default). This effectively rolls back to the built-in bundle.

- **ready()** (iOS: line 251, Android: line 445):
  - **Stops the rollback timer.** This is the "I am safe" signal.
  - If called before the timer fires: rollback is cancelled.
  - If not called before the timer fires: rollback happens.

- **Background/foreground handling:**
  - handleAppDidEnterBackground() / handleOnStop(): Pauses the rollback timer (saves remaining time).
  - handleAppWillEnterForeground() / handleOnStart(): Resumes the rollback timer with the saved remaining time.
  - **Rationale:** A suspended app cannot call ready(), so the timer would fire incorrectly. By pausing in background, the full timeout is available once the app returns to foreground.

#### "Good Enough to Keep" Decision

- The app must explicitly call ready() after it has loaded and is functional.
- If ready() is called: the current bundle is "confirmed good", the rollback timer stops, and the previous bundle ID is updated.
- If ready() is NOT called within readyTimeout: the plugin rolls back to the default bundle.
- With autoBlockRolledBackBundles: the rolled-back bundle is added to a blocked list (max 100 entries), so it will not be re-downloaded in future syncs.

**Key difference from electron-updater:** electron-updater has no concept of "the new version crashed, roll back". Once the installer runs, the old version is replaced on disk. capacitor-live-update has a built-in rollback mechanism because the old bundle is still on disk -- it just switches the WebView path back.

---

## 7. Rollback Mechanics

### 7.1 electron-updater: NO Automatic Rollback

electron-updater has **no rollback mechanism**. Once the installer runs:
- **Windows (NSIS):** The installer replaces files on disk. If the new version crashes, the user must manually reinstall or use Windows System Restore. There is no "undo" path.
- **macOS (Squirrel.Mac):** Squirrel.Mac replaces the .app bundle. If the new version crashes, the old version is gone. Squirrel.Mac does have its own rollback (it keeps a copy of the previous version in Versions/), but electron-updater does not expose or control this.
- **Linux (AppImage):** The old AppImage is unlinked before the new one is moved into place. No rollback.
- **Linux (deb/rpm/pacman):** The package manager handles rollback (e.g., apt-get install package=old-version), but electron-updater does not automate this.

The only "safety net" is the **code signature verification** on Windows (prevents installing a tampered binary) and the **checksum verification** (prevents installing a corrupted file). But neither helps if the new version is simply buggy.

### 7.2 capacitor-live-update: Built-in Automatic Rollback

capacitor-live-update has a **comprehensive automatic rollback** mechanism:

1. **Timer-based rollback:** If readyTimeout is set (e.g., 10000ms) and the app does not call ready() within that time after a reload(), the plugin automatically switches back to the default bundle.
   - iOS: LiveUpdate.swift lines 872-886 (rollback()), 1017-1031 (scheduleRollback()), 1034-1046 (startRollbackTimer()).
   - Android: LiveUpdate.java lines 1411-1426 (rollback()), 1573-1581 (scheduleRollback()), 1584-1594 (startRollbackTimer()).

2. **Background-aware:** The timer pauses when the app goes to background/stopped and resumes when it returns. This prevents false rollbacks when the app is suspended.

3. **Bundle blocking:** With autoBlockRolledBackBundles = true (iOS: lines 948-974, Android: lines 1510-1538):
   - When a rollback occurs, the problematic bundle ID is added to a blocked list.
   - The blocked list is persisted (SharedPreferences / UserDefaults).
   - Max 100 entries; oldest is evicted when full.
   - Blocked bundles are skipped in sync() (iOS: lines 351-354, Android: lines 552-558).
   - Can be cleared manually via clearBlockedBundles().

4. **Kill-safe (Electron):** On Electron, the README states "The rollback is kill-safe: if the app is closed or crashes before ready() is called, the rollback is performed on the next app start." This is because the nextBundleId is persisted in storage, and on next init, if ready() was never called for the current bundle, the rollback timer starts again.

5. **Manual rollback:** The app can always call reset() to switch back to the default bundle, or setNextBundle({ bundleId: null }) to do the same.

6. **What happens if the new version crashes on first launch:**
   - The app process crashes.
   - On next launch, the plugin initializes and sees the nextBundleId points to the crashed bundle.
   - The rollback timer starts with readyTimeout.
   - If the app fails to call ready() within the timeout: automatic rollback to default bundle.
   - If autoBlockRolledBackBundles is enabled: the crashed bundle is blocked.
   - The user sees the default (built-in) bundle, which is the last known good state.

---

## 8. "Good Enough to Keep" Decision

### 8.1 electron-updater

electron-updater has **no "good enough to keep" decision**. The model is:
1. Download installer -> verify checksum -> verify signature (Windows) -> done.
2. Launch installer -> installer replaces files -> app quits -> new version starts.
3. There is no post-launch verification. The new version is assumed to be good.
4. The staging copy (the downloaded installer in the cache) is **not deleted** after a successful install. It remains in the cache directory until the next update overwrites it.
5. The update-info.json in the pending directory is overwritten on the next download.

The only "cleanup" is:
- DownloadedUpdateHelper.clear() (line 67-72) is called when a new download starts (removeFileIfAny(), line 617-624).
- The temp file is renamed to the final name after download (line 632).
- On the next update cycle, the old pending files are replaced.

### 8.2 capacitor-live-update

capacitor-live-update has an explicit **"good enough to keep" decision** via the ready() method:

1. **ready() is the confirmation signal.** The app calls it when it has successfully loaded and is functional.
2. **What ready() does** (iOS: lines 251-276, Android: lines 445-470):
   - Stops the rollback timer (the "danger window" is over).
   - Deletes unused bundles if autoDeleteBundles is enabled.
   - Records the current bundle ID.
   - Sets the previous bundle ID to the current one (for future rollback reference).
   - Resets the rollbackPerformed flag.
   - Returns ReadyResult with currentBundleId, previousBundleId, and rollback (whether a rollback occurred this launch).

3. **Staging copy deletion:**
   - The temporary download directory (<downloadsDir>/UUID/) is deleted immediately after the bundle is moved to the bundles directory (via defer in Swift, or deleteTemporaryDirectoryOnCompletion in Java).
   - Old bundles are deleted by deleteUnusedBundles() when ready() is called and autoDeleteBundles is true. A bundle is "unused" if it is neither the current nor the next bundle.
   - The default bundle (built into the app) is never deleted.

4. **If ready() is never called:**
   - The rollback timer fires -> rollback to default bundle.
   - The problematic bundle remains on disk (it is not deleted during rollback) but is no longer the "current" or "next" bundle.
   - On the next ready() call (for the default bundle), deleteUnusedBundles() will clean it up if autoDeleteBundles is true.

---

## 9. User-Visible Failure Modes

### 9.1 electron-updater

#### Error Types and Codes

Errors are thrown as instances of newError(message, code) from builder-util-runtime. The error codes found in the source:

| Error Code | Where Thrown | User Impact |
|---|---|---|
| ERR_UPDATER_INVALID_VERSION | AppUpdater.js:37,41,215,342 | App version or update version is not valid semver. |
| ERR_UPDATER_INVALID_CHANNEL | AppUpdater.js:37,40 | Channel is not a string or is empty. |
| ERR_UPDATER_NO_FILES_PROVIDED | Provider.js:77,121 | Manifest has no files array and no path field. |
| ERR_UPDATER_NO_CHECKSUM | Provider.js:128 | File entry has neither sha2 nor sha512. |
| ERR_UPDATER_INVALID_UPDATE_INFO | Provider.js:93,100 | Channel file is null or not valid YAML. |
| ERR_UPDATER_CHANNEL_FILE_NOT_FOUND | GenericProvider.js:27, GitHubProvider.js:125, GitLabProvider.js:86,100, PrivateGitHubProvider.js:29,38 | The latest.yml (or channel-specific file) does not exist on the server. |
| ERR_UPDATER_LATEST_VERSION_NOT_FOUND | GitHubProvider.js:173, BitbucketProvider.js:30, GitLabProvider.js:61,71, KeygenProvider.js:34, PrivateGitHubProvider.js:74 | Cannot determine the latest version (no releases, API error). |
| ERR_UPDATER_NO_PUBLISHED_VERSIONS | GitHubProvider.js:111 | No releases on GitHub. |
| ERR_UPDATER_INVALID_RELEASE_FEED | GitHubProvider.js:108 | Atom feed is not valid XML. |
| ERR_UPDATER_ZIP_FILE_NOT_FOUND | MacUpdater.js:83 | No .zip file in the macOS manifest. |
| ERR_UPDATER_WEB_INSTALLER_DISABLED | NsisUpdater.js:42 | Web installer file present but disableWebInstaller is true. |
| ERR_UPDATER_INVALID_SIGNATURE | NsisUpdater.js:56 | Windows code signature verification failed. |
| ERR_UPDATER_OLD_FILE_NOT_FOUND | AppImageUpdater.js:40,78,82 | APPIMAGE env var not set or invalid. |
| ERR_UPDATER_BLOCKMAP_FILE_NOT_FOUND | GitLabProvider.js:247,250 | Blockmap file not found in GitLab assets. |
| ERR_UPDATER_ASSET_NOT_FOUND | GitLabProvider.js:268, PrivateGitHubProvider.js:85 | File listed in manifest not found in release assets. |
| ERR_UPDATER_RELEASE_NOT_FOUND | GitLabProvider.js:182,186 | Specific version release not found on GitLab. |
| ERR_UPDATER_UNSUPPORTED_PROVIDER | providerFactory.js:65 | Unknown provider type in config. |
| ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION | providerFactory.js:18,60 | Invalid provider configuration. |
| ERR_CHECKSUM_MISMATCH | AppUpdater.js:650 (from builder-util-runtime) | Downloaded file checksum does not match manifest. |

#### Event Shapes

- **UpdateCheckResult** (types.d.ts lines 26-33):
`	ypescript
interface UpdateCheckResult {
    readonly isUpdateAvailable: boolean;
    readonly updateInfo: UpdateInfo;
    readonly downloadPromise?: Promise<Array<string>> | null;
    readonly cancellationToken?: CancellationToken;
    readonly versionInfo: UpdateInfo; // @deprecated
}
`

- **UpdateDownloadedEvent** (types.d.ts lines 34-36):
`	ypescript
interface UpdateDownloadedEvent extends UpdateInfo {
    downloadedFile: string; // absolute path to the downloaded installer
}
`

- **ProgressInfo** (from builder-util-runtime, used in download-progress event): total, delta, transferred, transferSpeed, bytesPerSecond, start, percentage.

- **Events emitted** (line 42 of types.d.ts):
  - "checking-for-update" -- check started
  - "update-available" -- new version found, UpdateInfo passed
  - "update-not-available" -- no update, UpdateInfo passed
  - "update-cancelled" -- download cancelled, UpdateInfo passed
  - "download-progress" -- ProgressInfo passed
  - "update-downloaded" -- UpdateDownloadedEvent passed
  - "error" -- Error + string message passed
  - "login" -- proxy auth request, (authInfo, callback) passed
  - "before-quit-for-update" -- emitted on autoUpdater before quit
  - "appimage-filename-updated" -- AppImage filename changed after install

- **What the user sees:** electron-updater does NOT show any UI. The host app is responsible for all user-facing notifications. The library only emits events and errors. Typical host app pattern:
  - Listen for "update-available" -> show "Update available" dialog
  - Listen for "download-progress" -> show progress bar
  - Listen for "update-downloaded" -> show "Restart to update" button
  - Listen for "error" -> show error toast or log

### 9.2 capacitor-live-update

#### Error Types

capacitor-live-update uses a CustomError enum (iOS: CustomError.swift, 75 lines) and string constants (Android: LiveUpdatePlugin.java constants). The errors are passed to call.reject(message) (iOS: line 431) or callback.error(new Exception(message)) (Android).

| Error | iOS Case | Android Constant | Description |
|---|---|---|---|
| App ID missing | appIdMissing | ERROR_APP_ID_MISSING | appId not configured. |
| Bundle already exists | bundleAlreadyExists | ERROR_BUNDLE_EXISTS | downloadBundle() called for an existing bundle. |
| Bundle directory not found | bundleDirectoryNotFound | -- | Internal: cannot resolve bundle path. |
| Bundle ID missing | bundleIdMissing | ERROR_BUNDLE_ID_MISSING | bundleId not provided. |
| Bundle index.html missing | bundleIndexHtmlMissing | ERROR_BUNDLE_INDEX_HTML_MISSING | Downloaded bundle has no index.html. |
| Bundle not found | bundleNotFound | ERROR_BUNDLE_NOT_FOUND | setNextBundle() or deleteBundle() for a non-existent bundle. |
| Channel discovery not enabled | channelDiscoveryNotEnabled | -- | fetchChannels() returned 401. |
| Channel missing | channelMissing | -- | Channel not provided where required. |
| Checksum calculation failed | checksumCalculationFailed | ERROR_CHECKSUM_CALCULATION_FAILED | Could not compute SHA-256 of the file. |
| Checksum mismatch | checksumMismatch | ERROR_CHECKSUM_MISMATCH | File checksum does not match expected. |
| Configuration value invalid | configurationValueInvalid(key) | -- | A config option has the wrong type. |
| Custom ID missing | customIdMissing | -- | customId not provided. |
| Download failed | downloadFailed | ERROR_DOWNLOAD_FAILED | HTTP download failed (non-timeout). |
| Download URL missing | downloadUrlMissing | -- | No valid download URL for the bundle. |
| HTTP timeout | httpTimeout | -- | Request timed out. |
| Plugin not initialized | pluginNotInitialized | -- | Plugin methods called before load(). |
| Signature missing | signatureMissing | ERROR_SIGNATURE_MISSING | publicKey set but no signature provided. |
| Signature verification failed | signatureVerificationFailed | ERROR_SIGNATURE_VERIFICATION_FAILED | RSA signature verification failed. |
| Sync in progress | syncInProgress | ERROR_SYNC_IN_PROGRESS | sync() called while another sync is running. |
| Unknown | unknown | -- | Catch-all. |
| URL missing | urlMissing | ERROR_URL_MISSING | url not provided for downloadBundle(). |
| Public key invalid | -- | ERROR_PUBLIC_KEY_INVALID | Android only: PEM key could not be parsed. |
| Bundle move failed | -- | ERROR_BUNDLE_MOVE_FAILED | Android only: could not move unzipped directory. |

Note: On Android, SocketTimeoutException is re-thrown as-is (line 1292-1293 of LiveUpdate.java), while other IO errors are wrapped as ERROR_DOWNLOAD_FAILED. On iOS, URLError with .timedOut code is mapped to httpTimeout (line 427-429 of LiveUpdatePlugin.swift).

#### Event Shapes

- **DownloadBundleProgressEvent** (definitions.d.ts lines 947-973):
`	ypescript
interface DownloadBundleProgressEvent {
    bundleId: string;
    downloadedBytes: number;
    progress: number; // 0.0 to 1.0
    totalBytes: number;
}
`

- **NextBundleSetEvent** (definitions.d.ts lines 985-995):
`	ypescript
interface NextBundleSetEvent {
    bundleId: string | null; // null = default bundle
}
`

- **ReadyResult** (definitions.d.ts lines 819-842):
`	ypescript
interface ReadyResult {
    previousBundleId: string | null;
    currentBundleId: string | null;
    rollback: boolean;
}
`

- **SyncResult** (definitions.d.ts lines 926-935):
`	ypescript
interface SyncResult {
    nextBundleId: string | null; // null = up to date
}
`

- **What the user sees:** capacitor-live-update also does NOT show any UI. The host app (web layer) is responsible for user-facing notifications. The plugin emits events via Capacitor's notifyListeners() mechanism. The web app can listen:
  - LiveUpdate.addListener('downloadBundleProgress', callback)
  - LiveUpdate.addListener('nextBundleSet', callback)
  - LiveUpdate.addListener('reloaded', callback)

---

## 10. Partial-Download Survival

### 10.1 electron-updater

#### HTTP Range Support

- **Full downloads:** Do NOT use HTTP Range. The file is downloaded from start to finish. If the connection drops, the entire file must be re-downloaded.
- **Differential downloads:** DO use HTTP Range. The DifferentialDownloader (out/differentialDownloader/DifferentialDownloader.js) makes multiple range requests:
  - **Single-range mode** (default for most providers): Each DOWNLOAD operation makes a separate Range: bytes=start-end request (line 182-183).
  - **Multi-range mode** (isUseMultipleRangeRequest: true): Batches up to 1000 range operations into a single Range: bytes=s1-e1, s2-e2, ... request using multipart/byteranges response parsing (out/differentialDownloader/multipleRangeDownloader.js). Used only by GenericProvider on non-S3 URLs.
- **Range request verification:** checkIsRangesSupported() (lines 119-133 of multipleRangeDownloader.js) checks for 206 Partial Content status or Accept-Ranges header. If the server does not support ranges, the differential download fails and falls back to full download.

#### Retry Policy

- **GenericProvider channel file fetch:** Retries up to 3 times on ECONNREFUSED with linear backoff (1s, 2s, 3s) (lines 29-41 of GenericProvider.js).
- **File rename after download:** Retries up to 60 times on EBUSY with 500ms interval (lines 632-642 of AppUpdater.js).
- **No retry for the actual file download.** If the download fails (network error, timeout, checksum mismatch), the error is propagated to the caller. The CancellationToken allows the caller to cancel an in-progress download.
- **No exponential backoff.** The only retry is the linear backoff in GenericProvider for connection refused.

#### What Happens If the User Kills the App Mid-Update

1. **During manifest fetch:** No data is written. On next launch, the check starts fresh.
2. **During full download:** The temp file (temp-<fileName>) is left in the pending directory. On next launch:
   - validateDownloadedPath() finds no valid update-info.json -> returns null.
   - createTempUpdateFile() unlinks the stale temp file.
   - Download starts from scratch.
3. **During differential download:** Same as full download. The temp file is incomplete, and the next attempt starts fresh.
4. **After download, before install:** The installer file is in the pending directory with a valid update-info.json. On next launch:
   - validateDownloadedPath() finds the valid cached file.
   - getValidCachedUpdateFile() verifies the SHA-512.
   - If valid: skips the download and proceeds to done() -> update-downloaded event.
   - The user can then call quitAndInstall() or the auto-install-on-quit handler will install on next clean quit.
5. **During install:** The installer is a separate process (NSIS, Squirrel.Mac, etc.). If the app process is killed, the installer continues running independently (it was spawned with detached: true and unref'd).

### 10.2 capacitor-live-update

#### HTTP Range Support

- **None.** The HTTP clients (Alamofire on iOS, OkHttp on Android) do not implement HTTP Range requests. Files are always downloaded from start to finish.
- **Manifest-type downloads:** Individual files are downloaded in parallel, but each file is downloaded completely. There is no resumption of a partially downloaded file.

#### Retry Policy

- **None.** There is no retry logic in the HTTP client or the download methods. If a download fails:
  - iOS: The Alamofire request fails, the error is caught in downloadAndVerifyFile(), and CustomError.downloadFailed is thrown.
  - Android: The OkHttp callback receives an IOException, which is handled in handleDownloadFailure() -- if it is a SocketTimeoutException, it is re-thrown; otherwise, ERROR_DOWNLOAD_FAILED is thrown.
- **No exponential backoff, no retry count.**

#### What Happens If the User Kills the App Mid-Update

1. **During ZIP download:** The partial file is in <downloadsDir>/<UUID>/bundle.zip. On next app start:
   - iOS: interruptedDownloadsDeleted static let deletes the entire downloads directory (lines 13-17).
   - Android: tryDeleteDownloadsDirectory() deletes the downloads directory (lines 162-166).
   - The next sync() or downloadBundle() starts a fresh download.

2. **During manifest-type file downloads:** Same as ZIP. The temp directory is deleted on next start.

3. **After download, before setNextBundle():** The bundle is in the bundles directory but not set as the next bundle. On next start, it is an "unused" bundle that will be cleaned up by deleteUnusedBundles() if autoDeleteBundles is true.

4. **After setNextBundle(), before reload():** The next bundle is persisted in SharedPreferences/UserDefaults. On next start, the app will use this bundle. If it is broken, the rollback timer will fire.

5. **After reload(), before ready():** The WebView is showing the new bundle. The rollback timer is running. If the app is killed:
   - On next start, the rollback timer restarts with the full readyTimeout.
   - If the app fails to call ready() within the timeout: rollback to default bundle.
   - This is the "kill-safe" behavior mentioned in the README.

---

## 11. Staged Rollout / Canary

### 11.1 electron-updater: Channel-Based + Staging Percentage

#### Channels

- electron-updater supports **arbitrary channel names** via the channel property on AppUpdater (line 25-45 of AppUpdater.js).
- The channel determines the manifest file name: latest.yml, beta.yml, alpha.yml, etc.
- **Prerelease channels:** The GitHub provider has special handling for prerelease versions (allowPrerelease flag, lines 121-125 of AppUpdater.js):
  - If the current version has a prerelease component (e.g., 1.2.3-beta.1), allowPrerelease is automatically set to true.
  - With allowPrerelease, the GitHub provider can pick prerelease releases from the Atom feed.
  - Channel matching: alpha and beta are recognized as standard prerelease channels. Custom prerelease tags are also supported but with restrictions (e.g., beta users do not see alpha releases) (lines 74-88 of GitHubProvider.js).
- **allowDowngrade:** Set to true automatically when channel is set (line 44). This allows users to switch from beta back to stable (lines 357-362 of AppUpdater.js).
- **Channel file resolution order (GenericProvider):** updater.channel || configuration.channel || "latest".

#### Staging Percentage (Canary)

- **stagingPercentage** field in the manifest (line 314-331 of AppUpdater.js):
  - If null: all users get the update (100%).
  - If a number (0-100): only a fraction of users get the update.
  - **Deterministic assignment:** A per-user UUID is generated and persisted at <userDataPath>/.updaterId (lines 501-526). The UUID's bytes 12-15 are read as a uint32 and divided by 0xFFFFFFFF to get a percentage in [0,1). If this percentage is less than stagingPercentage / 100, the user gets the update.
  - The UUID is sent as the x-user-staging-id header (line 387) so the server can also use it for server-side staging.
  - **Override:** The isUserWithinRollout property (lines 95-102) can be set to a custom function, allowing the app to implement its own rollout logic.

- **No server-side rollout logic:** The staging percentage is in the manifest, not controlled by the server. To change the rollout percentage, you must publish a new manifest with a different stagingPercentage value.

### 11.2 capacitor-live-update: Channel-Based + Server-Side Rollout

#### Channels

- capacitor-live-update supports **arbitrary channel names** via setChannel() or the channel parameter of sync().
- Channel resolution priority (highest first):
  1. sync({ channel: "..." }) -- per-call override, not persisted
  2. setChannel({ channel: "..." }) -- persisted in SharedPreferences/UserDefaults
  3. Native config: CapawesomeLiveUpdateDefaultChannel (iOS Info.plist) / capawesome_live_update_default_channel (Android strings.xml) / defaultChannel in electron/capacitor.electron.config.ts
  4. Capacitor config: defaultChannel in capacitor.config.json
- **Versioned channels:** The native config can tie the channel to the build version, e.g., production-5 for version 5. This ensures each native version gets updates for its own channel.
- **fetchChannels()** (iOS: lines 105-137, Android: lines 212-267): Fetches available channels from Capawesome Cloud. Only works for apps with public channels. Returns Channel[] with id and name.
- **Forced channel assignments:** Capawesome Cloud supports forcing a specific channel for a specific device, overriding all client-side settings. This is a server-side feature.

#### Staged Rollout (Canary)

- **Server-side rollout:** Capawesome Cloud (the backend service) controls rollout percentages. The client SDK does not implement local rollout logic. The server decides which bundle to serve based on the deviceId, appVersionCode, channelName, etc. query parameters.
- **No client-side staging percentage:** Unlike electron-updater, there is no stagingPercentage field in the manifest or API response. The rollout decision is entirely server-side.
- **customId:** The app can set a customId via setCustomId() which is sent to the server. This can be used for server-side targeting (e.g., specific user groups).
- **deviceId:** Automatically generated and sent with every request. Used for server-side device targeting.

**Key difference:** electron-updater does client-side rollout (the manifest contains the percentage, the client decides). capacitor-live-update does server-side rollout (the server decides which bundle to serve based on device/version/channel). Server-side rollout is more flexible (can change instantly without publishing a new manifest) but requires the Capawesome Cloud backend (or a compatible server).

---

## 12. Diff / Delta Updates

### 12.1 electron-updater: Block-Map Based Differential Download

electron-updater implements a **block-map-based differential download** system, NOT bsdiff. The protocol is:

#### Block Map Format

- A block map is a JSON file (gzip-compressed for standalone .blockmap files, raw-deflate for embedded block maps).
- Structure: { version: number, files: [{ name: string, offset: number, checksums: string[], sizes: number[] }] }
- Each file is divided into blocks. Each block has a SHA-256 checksum and a size.
- The block map is published alongside the installer file (e.g., MyApp-Setup-2.0.0.exe.blockmap).

#### How It Works

1. **differentialDownloadInstaller()** (AppUpdater.js lines 660-735):
   - Downloads the **new blockmap** from the server (e.g., MyApp-Setup-2.0.0.exe.blockmap).
   - Gets the **old blockmap** from cache (<cacheDir>/current.blockmap) or downloads it from the server (e.g., MyApp-Setup-1.9.0.exe.blockmap).
   - Creates a GenericDifferentialDownloader and calls download(oldBlockMap, newBlockMap).

2. **DifferentialDownloader.doDownload()** (DifferentialDownloader.js lines 33-60):
   - Verifies that both blockmaps have the same version (protocol version).
   - Calls computeOperations(oldBlockMap, newBlockMap) from downloadPlanBuilder.js.

3. **computeOperations()** (downloadPlanBuilder.js lines 10-72):
   - Builds a checksum-to-offset map for the old file.
   - For each block in the new file:
     - If the block's checksum exists in the old file (same size): emit a **COPY** operation (copy bytes from old file at the old offset).
     - If the block's checksum is new: emit a **DOWNLOAD** operation (fetch bytes from the server using HTTP Range).
   - Consecutive operations of the same type are merged (e.g., adjacent DOWNLOAD blocks become one large range request).
   - Returns an array of { kind: COPY|DOWNLOAD, start: number, end: number } operations.

4. **Execution** (DifferentialDownloader.doDownloadFile(), lines 95-226):
   - Opens the old file for reading and the new file for writing.
   - For each operation:
     - **COPY:** Reads bytes from the old file at [start, end) and writes them to the new file.
     - **DOWNLOAD:** Makes an HTTP Range request for bytes=start-(end-1) from the new file URL.
   - Uses a DigestTransform to compute SHA-512 of the assembled file and verify it matches the expected checksum.
   - Progress is reported via the onProgress callback.

5. **Multi-range optimization** (multipleRangeDownloader.js):
   - If isUseMultipleRangeRequest is true (GenericProvider on non-S3 URLs), up to 1000 DOWNLOAD operations are batched into a single HTTP request with Range: bytes=s1-e1, s2-e2, ....
   - The response is multipart/byteranges which is parsed by the DataSplitter class.
   - This reduces the number of HTTP round-trips from N to 1.

6. **Embedded block maps** (FileWithEmbeddedBlockMapDifferentialDownloader.js):
   - Used for AppImage and web installer packages.
   - The block map is embedded at the end of the file (last blockMapSize + 4 bytes).
   - The new block map is fetched via a Range request for the last N bytes of the remote file.
   - The old block map is read from the end of the local file.
   - This avoids a separate .blockmap file download.

#### When Differential Download Is Used

| Platform | Differential? | Notes |
|---|---|---|
| Windows (NSIS) | **Yes** | If not a web installer and disableDifferentialDownload is false. Falls back to full download on failure. |
| Windows (Web Installer) | **Yes** (for .7z package) | The .7z package file uses embedded block map differential. The .exe itself is always full download. |
| macOS | **Yes** | If update.zip exists in cache (not first install). Falls back to full download on failure. |
| Linux (AppImage) | **Yes** | Uses embedded block map (AppImage format has it built-in). Falls back to full download on failure. |
| Linux (deb/rpm/pacman) | **No** | Full download only. |

#### Fallback Behavior

- If the differential download fails for any reason (network error, server does not support ranges, blockmap mismatch, checksum error), the code **falls back to a full download** (lines 728-733 of AppUpdater.js). The error is logged but not propagated to the user.
- disableDifferentialDownload (line 153 of AppUpdater.js) can be set to true to always do full downloads.

### 12.2 capacitor-live-update: Manifest-Based File-Level Delta

capacitor-live-update implements a **file-level delta** system, NOT block-level. The protocol is:

#### How It Works

1. **downloadBundleOfTypeManifest()** (iOS: lines 585-616, Android: lines 970-1054):
   - Downloads the latest capawesome-live-update-manifest.json from the server.
   - Loads the current manifest (from the currently active bundle or app assets).
   - Compares the two manifests:
     - findDuplicateItems(latest, current): Files with the **same checksum** in both manifests. These are **copied** from the local current bundle (no download needed).
     - findMissingItems(latest, current): Files that are new or changed (different checksum). These are **downloaded** from the server.
   - Copies duplicate files from the current bundle directory to the temp directory.
   - Downloads missing files in parallel from baseUrl?href=file.
   - Each downloaded file is verified (checksum or signature).
   - The assembled directory is moved to the bundles directory.

2. **Delta granularity:** File-level. If a 1KB file changes, the entire file is re-downloaded. There is no block-level or byte-level delta within a file.

3. **No block maps, no bsdiff, no HTTP Range for delta.**

#### When Manifest-Type Is Used

- The artifactType in the API response determines the download strategy.
- On **Capawesome Cloud**, the server decides whether to serve a "zip" or "manifest" artifact type.
- On **Electron**, only "zip" is supported (per the definitions.d.ts documentation: "On Electron, only the zip artifact type is supported").
- For **self-hosted bundles**, the caller specifies artifactType in downloadBundle().

#### Comparison

| Feature | electron-updater | capacitor-live-update |
|---|---|---|
| **Delta granularity** | Block-level (SHA-256 per block) | File-level (SHA-256 per file) |
| **Protocol** | Block map + HTTP Range | Manifest JSON + full file download |
| **Bandwidth savings** | High (only changed blocks downloaded) | Moderate (unchanged files skipped, changed files fully downloaded) |
| **Server requirements** | Server must serve .blockmap files and support HTTP Range | Server must serve individual files via ?href= query param |
| **Client complexity** | High (range requests, multipart parsing, block map comparison) | Low (file comparison, parallel downloads) |
| **Fallback** | Full download on any error | N/A (manifest type is all-or-nothing per file) |
| **Embedded block map** | Yes (AppImage, web installer .7z) | No |

---

## Cross-Reference: File Inventory

### electron-updater Files Analyzed

| File | Lines | Role |
|---|---|---|
| out/AppUpdater.js | 761 | Core updater: check, download, staging, channel, rollout |
| out/BaseUpdater.js | 150 | Base for NSIS/Linux: quitAndInstall, install, quit handler |
| out/NsisUpdater.js | 178 | Windows NSIS: exe download, code signature, installer launch |
| out/MacUpdater.js | 259 | macOS Squirrel: zip download, HTTP proxy, arch detection |
| out/LinuxUpdater.js | 119 | Linux base: sudo detection, package manager detection |
| out/AppImageUpdater.js | 118 | Linux AppImage: differential, file replace |
| out/RpmUpdater.js | 65 | Linux RPM: zypper/dnf/yum/rpm install |
| out/DebUpdater.js | 84 | Linux DEB: dpkg/apt install |
| out/PacmanUpdater.js | 67 | Linux Pacman: pacman install |
| out/DownloadedUpdateHelper.js | 170 | Cache management: temp files, update-info.json, validation |
| out/ElectronAppAdapter.js | 42 | Electron API adapter: version, name, paths, quit |
| out/AppAdapter.js | 21 | Platform-specific cache directory resolution |
| out/electronHttpExecutor.js | 79 | HTTP via Electron net: session, redirect, download |
| out/providerFactory.js | 68 | Provider creation: github, gitlab, bitbucket, keygen, s3, generic, custom |
| out/providers/Provider.js | 146 | Base provider: channel, blockmap, file resolution, YAML parsing |
| out/providers/GenericProvider.js | 51 | Generic URL provider: retry, cache busting |
| out/providers/GitHubProvider.js | 237 | GitHub: Atom feed, prerelease, release notes |
| out/providers/PrivateGitHubProvider.js | 95 | GitHub private: REST API, token auth |
| out/providers/BitbucketProvider.js | 42 | Bitbucket: API v2 downloads |
| out/providers/GitLabProvider.js | 281 | GitLab: API v4, token auth, asset resolution |
| out/providers/KeygenProvider.js | 46 | Keygen: API v1, account/product |
| out/windowsExecutableCodeSignatureVerifier.js | 142 | Windows Authenticode: PowerShell Get-AuthenticodeSignature |
| out/differentialDownloader/DifferentialDownloader.js | 268 | Block-map differential: operations, range requests, digest |
| out/differentialDownloader/GenericDifferentialDownloader.js | 11 | Concrete differential downloader |
| out/differentialDownloader/FileWithEmbeddedBlockMapDifferentialDownloader.js | 37 | Embedded block map (AppImage, .7z) |
| out/differentialDownloader/downloadPlanBuilder.js | 113 | Block map comparison: COPY/DOWNLOAD plan |
| out/differentialDownloader/multipleRangeDownloader.js | 134 | Multi-range HTTP: batch range requests, multipart parsing |
| out/types.js / types.d.ts | 42/43 | Event types: UpdateCheckResult, UpdateDownloadedEvent, signals |
| out/util.js | 33 | URL helpers: newBaseUrl, newUrlFromBase, getChannelFilename |

### capacitor-live-update Files Analyzed

| File | Lines | Role |
|---|---|---|
| ios/Plugin/LiveUpdate.swift | 1212 | Core implementation: sync, download, verify, rollback, bundles |
| ios/Plugin/LiveUpdatePlugin.swift | 441 | Capacitor plugin bridge: method routing, events, config |
| ios/Plugin/LiveUpdateHttpClient.swift | 64 | HTTP via Alamofire: download, request, checksum/signature headers |
| ios/Plugin/LiveUpdateConfig.swift | 11 | Config struct: appId, publicKey, readyTimeout, etc. |
| ios/Plugin/Classes/Manifest.swift | 20 | Bundle manifest: items, findDuplicate/findMissing |
| ios/Plugin/Protocols/Api/ManifestItem.swift | 5 | Manifest item: href, checksum, sizeInBytes |
| ios/Plugin/Protocols/Api/GetLatestBundleResponse.swift | 9 | API response: artifactType, bundleId, url, checksum, signature |
| ios/Plugin/Enums/CustomError.swift | 75 | Error enum: 20 error cases with localized messages |
| ios/Plugin/Classes/Options/SyncOptions.swift | 18 | Sync options: channel |
| android/src/main/java/.../LiveUpdate.java | 1687 | Core implementation (Android): sync, download, verify, rollback |
| android/src/main/java/.../LiveUpdateHttpClient.java | 117 | HTTP via OkHttp: enqueue, write to file, brotli |
| android/src/main/java/.../LiveUpdateConfig.java | 105 | Config class (Android) |
| android/src/main/java/.../classes/api/GetLatestBundleResponse.java | 83 | API response (Android) |
| dist/esm/definitions.d.ts | 1001 | TypeScript API definitions: all methods, options, results, events |
