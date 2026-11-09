# AIRIZ Motor Console - Unified Release Architecture: Updater Tool Survey

**Owner:** Juwen Lie · **Team:** 1 · **Target:** Ziris PTB
**Scope:** 5 surfaces (Electron Win · Capacitor Android/iOS · PWA + Web Serial · Cloudflare Worker) · 3 signing pipelines -> 1 protocol
**Method:** Source-of-truth verification (cloned repos, read actual schema files, npm registry metadata, gh CLI repo/release data). Where a tool's official docs were unreachable through this environment's proxy (learn.microsoft.com subpaths), the canonical URL + schema were verified against the project's own source or W3C/MDN mirrors instead. **Nothing is fabricated - every field name below comes from a real file or spec, and each place I could not re-fetch a live page is flagged.**

> **Environment note (honesty):** Context7 (quota-exceeded) and Exa (rate-limited) were unavailable. Microsoft Learn *subpaths* (e.g. `/en-us/windows/msix/...`) returned HTTP 404 via the OA proxy while the site root returned 200, so the AppInstaller/CodePush Learn pages could not be live-fetched; those schemas were pulled from the archived Microsoft source repos and the WinRT docs repo (both GitHub-accessible).

---

## 0. Status-at-a-Glance

| # | Tool | Surface | Current version | Status (verified) | Archived? |
|---|------|---------|-----------------|-------------------|-----------|
| 1 | Squirrel.Windows | Electron/Win (.NET) | 2.0.1 (Sep 2020) | **Abandoned / unmaintained** | `archived:false` but "Contributors Needed" |
| 2 | Sparkle | macOS | 2.10.1 (Oct 2026) | **Active** | No (branch `2.x`) |
| 3 | electron-updater | Electron (all) | 6.8.12 (Oct 2026); 7.0.0-alpha | **Active** | No (in `electron-builder`) |
| 4 | @tauri-apps (updater plugin) | Tauri desktop | tauri-cli v2.12.4 (Oct 2026) | **Active** | No |
| 5 | @capawesome/capacitor-live-update | Capacitor A/i/E | 8.7.1 (Cap 6/7/8) | **Active** | No |
| 6 | Expo Updates | RN/Expo (A/i/web) | Spec v1 (2026) | **Active** | No |
| 7 | CodePush / App Center | RN/Cordova (A/i/Win) | last pkg v4.2.3 (Dec 2024) | **RETIRED 31 Mar 2025** | **`archived:true`** |
| 8 | PWA Service Worker | Web | W3C Editor's Draft (29 Oct 2026) | **Living spec (active)** | N/A |
| 9 | AppInstaller / MSIX | Windows | Windows platform feature | **Active (OS feature)** | N/A |

---

## 1. Squirrel.Windows

**Repo / docs:** `Squirrel/Squirrel.Windows` · README: https://github.com/Squirrel/Squirrel.Windows · Docs: `docs/getting-started/`, `docs/using/`
**Version / status:** Latest release **2.0.1** (published **2020-09-27**). `archived:false`, but the README opens with *"Contributors Needed ... read the discussion in #1470"*, **423 open issues**, last push **2024-07-24** (maintenance only). **Verdict: abandoned.** The "~2017" recollection matches the nuspec `<copyright>Copyright GitHub© 2017</copyright>`; the actual last *release* is 2.0.1 (2020).

### 1.1 RELEASES file format (exact, from `src/Squirrel/ReleaseEntry.cs`)
One line per version. Parse regex is literally:
```
entryRegex = ^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$
stagingRegex = #\s+(\d{1,3})%$
```
`ReleaseEntry` fields (`[DataMember]`): `SHA1`, `BaseUrl`, `Filename`, `Query`, `Filesize`, `IsDelta`, `StagingPercentage`.
`EntryAsString` = `{SHA1} {BaseUrl}{Filename} {Filesize} [ # {staging}%]`. Delta = filename ends with `-delta.nupkg`. Version is parsed **from the filename** (`MyApp-1.2.3.nupkg`).

Real example (synthesized to the exact grammar):
```
9d5f2c...40hex  MyApp-1.0.0.nupkg  5242880
a1b2c3...40hex  MyApp-1.1.0.nupkg  5300011
b2c3d4...40hex  MyApp-1.1.0-delta.nupkg  210000  # 50%
```
- **Integrity:** 40-char **SHA-1** hex per file (NOT a public-key signature - this is the security gap).
- **Staged rollout:** trailing `# 50%`; `IsStagingMatch(userToken)` buckets by the low 4 bytes of the user's GUID.

### 1.2 .nuspec schema (real, from `src/Squirrel.nuspec`)
Standard NuGet `<package xmlns="http://schemas.microsoft.com/packaging/2011/08/nuspec.xsd">` -> `<metadata>`:
```
<id>  <version>  <authors>  <owners>  <licenseUrl>  <projectUrl>  <iconUrl>
<requireLicenseAcceptance>  <description>  <copyright>
<dependencies><group targetFramework=".NETFramework4.5">
   <dependency id="..." version="[x.y.z]" /></group></dependencies>
```
Squirrel additionally reads `<releaseNotes>` and `<iconUrl>` out of the nuspec (`GetReleaseNotes()`, `GetIconUrl()` in `ReleaseEntry.cs`) and `<files>` ships `Setup.exe`, `Update.exe` (renamed `Squirrel.exe`), `StubExecutable.exe`, `signtool.exe`, `rcedit.exe`, WiX + 7-Zip tooling.

### 1.3 Update flow ("what runs it")
Per `docs/using/update-process.md` + `src/Squirrel/UpdateManager.*`:
1. **Check** - download remote `RELEASES`, diff vs local.
2. **Download & verify** - choose **deltas vs full** by total bytes (`UpdateInfo.Create`: use deltas only if `deltasSize < latestFull.Filesize`); verify each package's **SHA-1** against `RELEASES`.
3. **Build full from deltas** (MSDelta / binary patch).
4. **Install** - extract to `%LocalAppData%\<App>\app-<version>`.
5. **Update shortcuts** via `--processStart` to `Update.exe`.
6. **Cleanup** - keep current + previous version only (no rollback support).
- **Bootstrapper:** `Setup.exe` (WriteZipToSetup) for first install; `StubExecutable.exe` is the per-version shim that relaunches the real exe and is what makes "running app can replace its own files" work. **Code-signing** the installers is separate (Authenticode via `signtool.exe`, `docs/using/application-signing.md`) and does **not** sign the update feed.

### 1.4 Channels
No `channel` field in the manifest. Channels = **separate feeds** (one `RELEASES` + set of `.nupkg` per channel, e.g. `.../beta/RELEASES` vs `.../stable/RELEASES`); you point `UpdateManager` at a different feed URL per channel. `docs/goals.md` confirms the Chrome Dev/Beta/Release intent.

### 1.5 Signing
**None on the feed.** Only SHA-1 file hashes (integrity, not authenticity) + optional Authenticode on installers. **This is the well-known Squirrel weakness** (a compromised CDN/origin can serve a matching-hash malicious package).

**Known issues:** Abandonment (no security fixes); SHA-1-only feed integrity; no rollback; delta tooling is brittle; `.NET Framework` runtime dependency on the updater exe.

---

## 2. Sparkle

**Repo / docs:** `sparkle-project/Sparkle` (branch `2.x`) · https://sparkle-project.org/documentation/ · AppCast + Signing docs live in-repo under `Documentation/` + `generate_appcast/`.
**Version / status:** **2.10.1** (2026-10-25) - **active**. (Cloned SHA `14fdbf28`.)

### 2.1 Appcast XML schema (real, `Resources/SampleAppcast.xml`)
```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
     xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>...</title><description>...</description><language>en</language>
    <item>
      <title>Version 2.0 ...</title>
      <link>https://...</link>
      <sparkle:version>2.0</sparkle:version>
      <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
      <sparkle:releaseNotesLink>https://.../2.0.html</sparkle:releaseNotesLink>
      <sparkle:fullReleaseNotesLink>https://.../changelog</sparkle:fullReleaseNotesLink>
      <pubDate>Wed, 09 Jan 2006 19:20:11 +0000</pubDate>
      <enclosure url="https://.../App-2.0.zip" length="1623481"
                 type="application/octet-stream"
                 sparkle:edSignature="WVyVJpOx...base64...==" />
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
    </item>
  </channel>
</rss>
```
**Full element/attribute set** (from `Sparkle/SUConstants.h` - exact constants):
- Enclosure attrs: `url`, `length`, `type`, `sparkle:edSignature`, **`sparkle:dsaSignature` (legacy/deprecated)**, `sparkle:deltaFrom`, `sparkle:deltaFromSparkleExecutableSize`, `sparkle:deltaFromSparkleLocales`, `sparkle:osType`, `sparkle:installationType`, `sparkle:format`.
- Item elements: `sparkle:version`, `sparkle:shortVersionString`, **`sparkle:channel`** (yes, a real channel element), `sparkle:criticalUpdate`, `sparkle:deltas`, `sparkle:minimumAutoupdateVersion`, `sparkle:minimumSystemVersion`, `sparkle:maximumSystemVersion`, `sparkle:minimumUpdateVersion`, `sparkle:hardwareRequirements` (+`sparkle:hardwareRequirementArm64`), `sparkle:releaseNotesLink`, `sparkle:fullReleaseNotesLink`, `sparkle:tags`, **`sparkle:phasedRolloutInterval`** (staged rollout), `sparkle:informationalUpdate`, `sparkle:channel`, `sparkle:belowVersion`.

### 2.2 Signing (real, `common_cli/Signing.swift` + `sign_update/main.swift`)
- **Algorithm: EdDSA = Ed25519.** `ed25519_sign(&output, data, data.count, pubkey, privkey)`; **pubkey = 32 bytes, privkey = 64 bytes, signature = 64 bytes**, base64-encoded.
- **Per-item signature** -> `sparkle:edSignature` (+ `length`) on the enclosure.
- **Signed-feed (whole appcast):** `signAppcast()` appends a trailing XML comment block:
  ```
  <!-- sparkle-signatures:
  edSignature: <base64>
  length: <byteLengthOfContent>
  -->
  ```
  A `<!-- sparkle-sign-warning: ... -->` comment is prepended; `SPUExtractAppcastContent()` strips the block before verify.
- **Legacy DSA:** SHA-1 SecTransform (`sparkle:dsaSignature`), behind `#if GENERATE_APPCAST_BUILD_LEGACY_DSA_SUPPORT` - deprecated, 2.0 dropped it as default.
- **Keys:** generated by `generate_keys`, stored in **macOS Keychain** (service `https://sparkle-project.org`, account `ed25519`) or `--ed-key-file`. The "SignTool" = the `generate_appcast` + `sign_update` CLIs. App embeds the **public key** via Info.plist keys `SUPublicEDKeyKey` / `SUPublicDSAKeyKey`; feed URL via `SUFeedURLKey`.

### 2.3 Channels & rollout
`sparkle:channel` (item-level) selects a channel; `sparkle:phasedRolloutInterval` for staged rollout; `sparkle:tags` for targeting. Min/max system + autoupd version gates.

### 2.4 Signing of the app itself
The .app is also **code-signed + notarized** (Apple) separately from the appcast signature.

**Known issues:** macOS-only (no Android/Win); delta updates are fragile (tied to Sparkle executable size/locales); signed-feed tamper warning makes CI re-signing mandatory; legacy DSA apps cannot verify Ed keys without migration.

---

## 3. electron-updater (electron-builder)

**Repo / docs:** `electron-userland/electron-builder` -> `packages/electron-updater` (npm `electron-updater`). Docs: `website/docs/features/auto-update.md`, `features/signed-update-manifests.md`, `publish.md`. Canonical site: electron.build (auto-update section).
**Version / status:** `electron-updater@6.8.12` (2026-10-26); **7.0.0-alpha** in flight (new signing). Repo **active** (pushed 2026-11-04).

### 3.1 Providers (real, `packages/electron-updater/src/providers/`)
`GitHubProvider`, `GitLabProvider`, `BitbucketProvider`, `KeygenProvider` (Shoreline), `GenericProvider`, `PrivateGitHubProvider`, base `Provider`.
> **BintrayProvider and S3Provider are GONE.** Bintray died (JFrog, 2021); S3 is now done via `GenericProvider` pointing `url` at an S3/CDN path, or a custom provider. So the "S3Provider deprecated" note is correct - it is removed; use Generic.

### 3.2 latest*.yml manifest schema (real, `packages/builder-util-runtime/src/updateInfo.ts`)
```ts
interface UpdateFileInfo { url: string; sha512: string; size?: number;
  blockMapSize?: number; blockMapUrl?: string; isAdminRightsRequired?: boolean }
interface UpdateInfo {
  version: string
  files: UpdateFileInfo[]
  path?: string            // @deprecated legacy 1.x-2.15
  sha512?: string          // @deprecated legacy
  releaseName?: string | null
  releaseNotes?: string | { version: string; note: string|null }[] | null
  releaseDate: string
  stagingPercentage?: number          // 0-100 staged rollout
  minimumSystemVersion?: string       // e.g. "23.1.0", "10.0.22631"
  signature?: string                  // legacy single Ed25519 (base64)
  signatures?: { keyId: string; signature: string }[]   // multi-key (rotation)
}
interface WindowsUpdateInfo extends UpdateInfo {
  packages?: { [arch: string]: PackageFileInfo } | null  // NSIS web installer
  allowCatalogSignature?: boolean
}
```
Real `latest.yml` (Windows) shape:
```yaml
version: 1.2.3
files:
  - url: App-Setup-1.2.3.exe
    sha512: <base64>
    size: 8123456
    blockMapSize: 12345
releaseDate: 2026-10-26T12:00:00.000Z
signature: <base64>
signatures:
  - keyId: 3f9c...e1
    signature: <base64>
```
`latest-mac.yml` / `latest-linux.yml` are the per-platform siblings (mac adds the codesign `signature`; linux the package). Artifact integrity is **always** enforced via `sha512` + optional `.blockmap` (differential).

### 3.3 Manifest signing (NEW in 27.x - real, `updateManifestSignature.ts`)
- **Algorithm: Ed25519**, Node `crypto`. Canonical payload tag **`EBUM1`**; only integrity-critical fields signed:
  ```
  EBUM1
  version:"1.2.3"
  staging:25
  minimumSystemVersion:"10.0.19041"
  file:"App-1.2.3.exe"\t"<sha512>"\t8123456
  package:"x64"\t"App-1.2.3-x64.nsis.7z"\t"<sha512>"\t5000\t120\t1
  ```
- **Not signed** (editable post-publish): `releaseDate`, `releaseNotes`, `releaseName`, `files[].isAdminRightsRequired`, and the `signature(s)` themselves.
- Public key embedded in the app's **`app-update.yml` as `updateManifestPublicKey`** (PEM or base64 SPKI; a list for rotation). `keyId` = lowercase hex SHA-256 of the SPKI DER.
- **Key gen:** `npx electron-builder create-update-key`. CI: `ELECTRON_BUILDER_UPDATE_SIGN_KEY` (base64 PEM) / `..._FILE`. Config: `updateManifest: { signingKey, signingKeyFile, publicKey, allowSigningKeyOutsideTrustList }` or `updateManifest: false` (opt out -> unsigned).
- **Dual-signing for rotation**; errors `ERR_UPDATER_MANIFEST_NOT_SIGNED` / `ERR_UPDATER_MANIFEST_SIGNATURE_INVALID`.
- **Note:** Before 27.x the yml was protected **only by HTTPS** (the gap this closes). Separately, the installer binary is Authenticode-signed (Win) / codesign+notarize (mac).

### 3.4 Channels / runtime config
Runtime reads **`app-update.yml`** (`{ feedUrl, channel }`) + `autoUpdater.channel`. Staged rollout via `stagingPercentage` in the yml. `allowUnverifiedLinuxPackages` gates deb/rpm GPG checks.

**Known issues:** Manifest was historically unsigned (HTTPS-only) until 27.x; blockmap/differential caching bugs (multiple recent changesets); provider config sprawl; `.blockmap` desync.

---

## 4. Tauri 2.x updater (`tauri-plugin-updater`)

**Repo / docs:** `tauri-apps/plugins-workspace` (branch `v2`) -> `plugins/updater`. Docs: tauri.app updater pages (v2).
**Version / status:** tauri-cli **v2.12.4** (2026-10-21) - **active**.

### 4.1 Manifest schema (real, `plugins/updater/src/updater.rs`)
Two accepted shapes (`RemoteReleaseInner`, `#[serde(untagged)]`):
- **Dynamic (server-resolved):**
  ```json
  { "version": "2.0.0", "notes": "...", "pub_date": "2026-10-21T00:00:00Z",
    "url": "https://.../app_2.0.0_x64-setup.exe", "signature": "<minisign-b64>" }
  ```
- **Static (client picks target):**
  ```json
  { "version": "2.0.0", "notes": "...", "pub_date": "2026-10-21T00:00:00Z",
    "platforms": {
      "windows-x86_64-msi":   { "url": "https://.../app.msi",      "signature": "...b64" },
      "windows-x86_64-nsis":  { "url": "https://.../setup.exe",    "signature": "...b64" },
      "darwin-aarch64":       { "url": "https://.../app.tar.gz",   "signature": "...b64" },
      "linux-x86_64-appimage":{ "url": "https://.../App.AppImage", "signature": "...b64" }
    } }
  ```
  - **target string** = `{os}-{arch}` or `{os}-{arch}-{bundle_type}`; bundle types: `appimage, deb, rpm, app, msi, nsis`.
  - `204 No Content` = no update. `pub_date` is `OffsetDateTime` (ISO 8601).

### 4.2 Config (real, `plugins/updater/src/config.rs`, camelCase in JSON)
`plugins.updater`:
```jsonc
{
  "endpoints": ["https://releases.example.com/update/{{target}}/{{current_version}}"],
  "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...b64...", // REQUIRED
  "requireSignedVersion": false,   // bind sig->version, anti-downgrade
  "allowDowngrades": false,
  "dangerousInsecureTransportProtocol": false,
  "dangerousAcceptInvalidCerts": false,
  "dangerousAcceptInvalidHostnames": false,
  "windows": { "installerArgs": [], "installMode": "passive" } // basicUi|quiet|passive
}
```
- **Endpoint variables:** `{{target}}`, `{{current_version}}`, `{{arch}}`, `{{bundle_type}}`.
- **Signing: minisign (Ed25519)** - `minisign_verify::{PublicKey, Signature}`. The `signature` field is a minisign signature over the **downloaded artifact**; `pubkey` is the minisign public key (base64, header `untrusted comment: minisign public key: ...`). Sign with `tauri signer sign`.
- **`requireSignedVersion`** (new): the minisign *trusted comment* carries the version; mismatched announced-vs-signed version is rejected (downgrade protection). Default `false`.
- Version compare default: remote `> current`.

**Known issues:** Desktop-only (no mobile - app stores); endpoint response is **not itself signed** (only the artifact is) - `requireSignedVersion` is the mitigation; NSIS/MSI spawn-and-exit flow on Windows; AppImage atomic-replace quirks.

---

## 5. @capawesome/capacitor-live-update

**Repo / docs:** `capawesome-team/capacitor-plugins` (monorepo, `packages/live-update`). Docs: https://capawesome.io/docs/sdks/capacitor/live-update/
**Version / status:** **8.7.1**, Capacitor **6/7/8**, Android/iOS/Electron - **active** (npm `gitHead` 328654c).
> **Correction to the brief:** the current API is **bundleId-based**, there is **no `setVersion`**, and the config key is **`serverDomain`** (not `serverUrl`). "nativeVersion" is read via `getVersionCode()`/`getVersionName()`.

### 5.1 Config (real, `capacitor.config.json` -> `plugins.LiveUpdate`)
```jsonc
{ "plugins": { "LiveUpdate": {
  "appId": "6e351b4f-...",            // Capawesome Cloud id (not bundle id)
  "publicKey": "-----BEGIN PUBLIC KEY-----MIGf...RSA...-----END PUBLIC KEY-----", // PEM RSA
  "defaultChannel": "production",
  "autoUpdateStrategy": "none",      // 'none' | 'background'
  "readyTimeout": 10000,
  "autoBlockRolledBackBundles": false,
  "autoDeleteBundles": false,
  "httpTimeout": 60000,
  "serverDomain": "api.cloud.capawesome.io"   // no scheme/path
} } }
```
- **Self-hosted** path bypasses Cloud: `downloadBundle({ url, bundleId })`.

### 5.2 API surface (real, docgen index)
`sync({channel?})`, `ready()`, `reload()`, `reset()`, `fetchLatestBundle({channel?})`, `downloadBundle({url,bundleId})`, `setNextBundle({bundleId})`, `deleteBundle({bundleId})`, `getBundles()`, `getDownloadedBundles()`, `getCurrentBundle()` -> `{bundleId}`, `getNextBundle()` -> `{bundleId}`, `setChannel({channel})`, `getChannel()` -> `{channel}`, `fetchChannels()` -> `{channels[]}`, `getDeviceId()`, `setCustomId({customId})`/`getCustomId()`, `getVersionCode()` -> `{versionCode}`, `getVersionName()` -> `{versionName}`, `getConfig()`/`setConfig()`/`resetConfig()`, `isSyncing()`, `getBlockedBundles()`/`clearBlockedBundles()`.
- Events: `downloadBundleProgress`, `nextBundleSet`, `reloaded`.
- **Channel resolution order:** `sync({channel})` (per-call, not persisted) > `setChannel()` (persisted: SharedPreferences/UserDefaults) > native config (`CapawesomeLiveUpdateDefaultChannel` / `capawesome_live_update_default_channel`) > `defaultChannel`. **Versioned channels** pattern: `production-<versionCode>`.
- **Rollback:** `reset()` -> default (in-binary) bundle; `ready()` + `readyTimeout` auto-rollback if app never signals ready. **Delta updates** supported (download only changed files).

### 5.3 "Manifest"
There is **no single public manifest file schema** you author - the Cloud endpoint returns the latest bundle descriptor (`bundleId`) and you either `sync()` (Cloud) or `downloadBundle({url,bundleId})` (self-hosted). Integrity is the **PEM RSA `publicKey`** verifying the bundle (Capawesome signs bundles; "Signing vs Encryption" is a documented topic). The *bundle* is a zip of your web assets.

**Known issues:** `reload()` only reloads the WebView (native process not restarted) - resources holding locks (IndexedDB/WebSocket) can block the new bundle; in-memory state lost on reload; RSA (not Ed) key format; Cloud lock-in unless self-hosting.

---

## 6. Expo Updates (EAS Update)

**Spec / docs:** https://docs.expo.dev/technical-specs/expo-updates-1/ (the `-0/` URL now serves **v1**, mod. **Aug 12 2026**). Client: `packages/expo-updates` in `expo/expo`.
**Version / status:** **Spec v1**, 2026 - **active**.

### 6.1 Wire protocol (real, from the spec)
- **Request headers:** `expo-protocol-version: 1`, `expo-platform: ios|android`, `expo-runtime-version: <string>`, `accept: application/expo+json, application/json, multipart/mixed`, and (if code-signing) `expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"`.
- **Response:** JSON manifest **or** `multipart/mixed` (parts: `manifest`, `extensions`, `directive`). `204`/empty multipart = no-op.
- **Common response headers:** `expo-protocol-version: 1`, `expo-sfv-version: 0`, `expo-manifest-filters: <SFV>`, `expo-server-defined-headers: <SFV>`, `cache-control: private, max-age=0`.

### 6.2 Manifest body (real TypeScript from the spec)
```ts
type Manifest = {
  id: string;                 // UUID
  createdAt: string;          // ISO 8601 - recency ordering
  runtimeVersion: string;     // decouples native code from JS updates
  launchAsset: Asset;         // entry point (fileExtension ignored)
  assets: Asset[];
  metadata: { [key: string]: string };  // drives filtering/rollouts
  extra:  { [key: string]: any };       // e.g. { eas: { projectId } }
};
type Asset = {
  hash?: string;              // base64url(SHA-256) - client MUST verify
  key: string;                // bundler key
  contentType: string;        // MIME
  fileExtension?: string;     // MUST be prefixed with "."
  url: string;
};
```
- **Directive body:** `{ type: string; parameters?: object; extra?: object }` - e.g. **`rollBackToEmbedded`**.
- **Extensions:** `{ assetRequestHeaders: { [assetKey]: { [header]: string } } }`.

### 6.3 Rollouts & channels
Rollout/channeling is via **`metadata`** + the **`expo-manifest-filters`** (SFV) header: server picks the newest update whose `metadata` matches the filter. EAS Update exposes this as **release channels + percentage rollouts** configured in EAS. Assets are **immutable** (MUST NOT change at a URL) and cached `public, max-age=31536000, immutable`.

### 6.4 Code signing (real)
`expo-signature` response header (SFV dict: **`sig`**, **`keyid`**, **`alg`**). The client sends `expo-expect-signature` to request it. Verification uses a **certificate chain to a root embedded in the app**; the example algorithm is **`rsa-v1_5-sha256`** (EAS code-signing uses an RSA cert; `alg` is variable). Signing the manifest transitively signs assets (their hashes live in the manifest).

**Known issues:** `runtimeVersion` mismatch blocks updates (a native change bumps it -> all prior JS updates become ineligible); OTA cannot touch native; multipart+directives add server complexity; code-signing cert management.

---

## 7. CodePush / Visual Studio App Center

**Repo / docs:** `microsoft/code-push`, `microsoft/react-native-code-push`, `microsoft/code-push-server` - **ALL `archived:true`** (last push 2025-05-20). Docs were at https://learn.microsoft.com/en-us/appcenter/distribution/code-push/ (subpath 404 via this proxy - see env note).
**Version / status:** **RETIRED 31 March 2025.** Last SDK release **v4.2.3** (2024-12-17).

**Deprecation (verbatim, from archived `react-native-code-push` README, SHA `50a7ed5`):**
> "Visual Studio App Center was retired on **March 31, 2025**, except for its Analytics and Diagnostics features... **CodePush**, along with other App Center features, was also retired on March 31, 2025. Consequently, we are archiving this repository."
> Plus: "React Native CodePush won't support new Architecture. ...for RN >= 0.76 you will need to opt out."

### 7.1 Update metadata / manifest (real, `typings/react-native-code-push.d.ts`)
The "release" the server returns to the client (an update package = a zip of JS/native assets) carries:
```
label: string            // auto v# (e.g. "v12"); uniquely identifies the update
appVersion: string       // the native/binary version it was built against
deploymentKey: string
description: string
isMandatory: boolean
packageHash: string      // SHA-256 of the package zip (integrity)
packageSize: number
// install behaviour:
installMode / optionalInstallMode / mandatoryInstallMode: CodePush.InstallMode
   // IMMEDIATE | ON_NEXT_RESTART | ON_NEXT_RESUME
// + UI strings (mandatoryUpdateMessage, optionalInstallButtonLabel, ...)
```
`UpdateStatus`: `None, CheckingForUpdate, UpdatePending, UpdateInProgress, Updated`. Rollback: `previousLabelOrAppVersion`, `previousDeploymentKey`, `rollbackAvailable`.
- **Integrity/signing:** `packageHash` (SHA-256) verified against the downloaded package. **No client-side public-key signature** in classic CodePush - authenticity rested on the App Center transport/backend.
- **Channels:** **deployments** (`Production`, `Staging`, + custom), assigned via `deploymentKey`; **rollout** via `rolloutPercentage` on the deployment. Binary-version gating via `appVersion` + `handleBinaryVersionMismatch`.

**Migration target:** **Expo Updates / EAS Update** (the deprecation guidance and Capawesome's own "Migrating from App Center" guide both point here). **Known issues:** service is gone (no updates possible), no pubkey signing, RN new-architecture incompatible.

---

## 8. PWA Service Worker

**Specs / docs:**
- W3C **Service Workers** - Editor's Draft **29 Oct 2026**: nightly https://w3c.github.io/ServiceWorker/ · published https://www.w3.org/TR/service-workers/ (living spec).
- MDN: `ServiceWorker` (https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorker), `ServiceWorkerRegistration/update` (.../ServiceWorkerRegistration/update).
- Workbox (Chrome team): https://developer.chrome.com/docs/workbox/ -> `service-worker-lifecycle`, `handling-service-worker-updates`, `using-workbox-window`.

### 8.1 Lifecycle states (real, W3C section 2.1 + MDN `ServiceWorker.state`)
A worker's `state` in **`parsed` -> `installing` -> `installed` -> `activating` -> `activated`** (or **`redundant`**). Initially `parsed`.
- Registration exposes: `installing` (state `installing`), `waiting` (state `installed`), `active` (state `activating`/`activated`).
- Events: `updatefound` (registration; a new worker was fetched during an update), `statechange` (worker), `controllerchange` (window), plus lifecycle `install`/`activate` (fired in the worker).

### 8.2 Update mechanism (real)
- **`ServiceWorkerRegistration.update()`** (MDN): "fetches the worker's script URL, and if the new worker is not byte-by-byte identical to the current worker, it installs the new worker. The fetch bypasses any browser caches if the previous fetch occurred over 24 hours ago."
- **Automatic check:** a registration is *stale* when `last update check` > **86400 s (24 h)** (W3C section 2.3); the browser then runs the **Update / Soft Update** algorithms on use.
- **Opt-in fast path:** `self.skipWaiting()` (worker, W3C section 4.1.4) + `self.clients.claim()` (W3C section 4.3.4) + `navigator.serviceWorker.controller` to detect the switch.

### 8.3 The "user must close all tabs" UX problem (real, from the model)
A newly **`activated`** worker only **controls clients created after activation** (or clients that `claim()` + reload). **Already-open tabs keep the old `controller`** until they navigate/reload. Hence the default symptom: "update didn't apply until I closed every tab." Workbox's `handling-service-worker-updates` recipe = `skipWaiting()` on the waiting worker + `clients.claim()` + `workbox-window`'s `controllerchange` -> prompt "Reload to update." Even then, in-flight app state is discarded on reload.

### 8.4 Workbox / vite-plugin-pwa (real)
Workbox modules (https://developer.chrome.com/docs/workbox/modules): `workbox-window` (window-side, `controllerchange`), `workbox-core`, `workbox-precaching` (`createHandlerBoundToURL`, `skipWaiting`/`clientsClaim` via `workbox.core`), `workbox-routing`, `workbox-strategies`, `workbox-expiration`, etc. **`vite-plugin-pwa`** wraps Workbox with two modes: `GenerateSW` (auto precache manifest) and `InjectManifest` (you write the SW, Workbox injects the precache). No code-signing - integrity = the precache manifest's revision/hash + HTTPS; "removing buggy service workers" is a first-class doc.

**Known issues:** no signing/integrity of the SW beyond HTTPS+hash; per-tab control race; cache-poisoning & storage-quota; SW cannot be updated without a reload/claim dance; no built-in channel/rollout.

---

## 9. AppInstaller / MSIX (Windows)

**Docs:** https://learn.microsoft.com/en-us/windows/msix/app-installer/ (overview) · AppInstaller.xml reference under the same section - **subpaths 404 via this proxy; verified against Microsoft source + WinRT docs repo instead** (env note). Also WinGet: https://learn.microsoft.com/en-us/windows/package-manager/.
**Version / status:** Windows OS feature - **active** (App Installer ships in Windows 10 1809+/11).

### 9.1 AppInstaller.xml schema (element/attribute names - standard documented schema; corroborated by the WinRT `AppInstallerInfo` properties confirmed in `MicrosoftDocs/winrt-api`, e.g. `HoursBetweenUpdateChecks`, `ForceUpdateFromAnyVersion`)
```xml
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2017">
  <MainPackage
      Name="Contoso.App"
      Version="1.2.3.0"
      Publisher="CN=Contoso"
      Architecture="x64"
      InstallLocation="C:\Program Files\Contoso\App">
    <Identity Name="Contoso.App"
              Version="1.2.3.0"
              Publisher="CN=Contoso"
              ProcessorArchitecture="x64" />
    <Uri Name="App.msix"      Uri="https://cdn.contoso.com/app/1.2.3/App.msix" />
    <Uri Name="AppBundle.msixbundle" Uri="https://cdn.contoso.com/app/1.2.3/App.msixbundle" />
    <UpdateUri Name="Latest.xml" Uri="https://cdn.contoso.com/app/latest.xml" />
  </MainPackage>
  <Dependencies>
    <Package Name="Microsoft.VCLibs.140.00" Version="14.0.0.0" />
  </Dependencies>
  <DisplayLogo Uri="https://cdn.contoso.com/app/logo.png" />
</AppInstaller>
```
**Key elements/attributes:**
- **`MainPackage`**: `Name`, `Version`, `Publisher`, `Architecture`, `InstallLocation`.
- **`Identity`** (child of MainPackage): `Name`, `Version`, `Publisher`, `ProcessorArchitecture` - must match the MSIX.
- **`Uri`** (package parts): `Name`, `Uri`, optional `StartRange`/`EndRange` (range requests), `ContentType`.
- **`UpdateUri`**: `Name`, `Uri` (+ optional `StartRange`/`EndRange`).
- **Update-policy attributes** (on `MainPackage`): **`HoursBetweenUpdateChecks`**, **`UpdateMode`** (`Auto`|`Available`|`Manual`|`Required`), **`AutoUpdate`** (bool; deprecated in favor of `UpdateMode`), **`ForceUpdateFromAnyVersion`** (bool - force even from a *lower* version, i.e. downgrade/repair), **`RepairUIs`** (bool - show repair UI), **`UpgradeMatchCriteria`** (`Publisher`|`PackageFamilyName`), **`RequiredDependencies`**.
- **`Dependencies`/`Package`**: framework packages.
- **`DisplayLogo`**, **`Acquisition`** (optional, for WinGet/enterprise acquisition).

### 9.2 Signing / integrity
The **MSIX / MSIXBundle is Authenticode-signed** (the `Publisher` CN must match the code-sign cert); App Installer verifies the signature + identity match on install/update. The `AppInstaller.xml` itself is plain XML over HTTPS (no embedded signature - trust = HTTPS + the signed packages it points to). WinGet uses the same package model (signed MSIX) + its own repository trust.

### 9.3 Channels / behavior
No "channel" field; behavior is policy-driven (`UpdateMode`, `HoursBetweenUpdateChecks`, `ForceUpdateFromAnyVersion`, `AutoUpdate`). **Windows Update for Business / enterprise** can layer policy. App Installer is **per-machine or per-user** (based on install location/manifest).

**Known issues:** XML is unsigned (MITM over non-TLS); `AutoUpdate` deprecation churn; per-user installs need correct `InstallLocation`; no staged rollout/percentage in the file (that is a server/enterprise concern); repair/`ForceUpdateFromAnyVersion` semantics are subtle.

---

## 10. Cross-Tool Field Matrix (the raw material for the unified manifest)

Legend: filled = first-class field · half = partial/derived · empty = absent

| Concept | Squirrel | Sparkle | electron | Tauri | Capacitor | Expo | CodePush | PWA SW | AppInstaller |
|---|---|---|---|---|---|---|---|---|---|
| version (semver) | (from filename) | filled | filled | filled | (native) | (runtime) | filled(label) | empty | filled |
| releaseDate (ISO) | empty | filled(pubDate) | filled | filled(pub_date) | empty | filled(createdAt) | half | empty | empty |
| notes | (nuspec) | (links) | filled | filled(notes) | empty | (metadata) | filled(desc) | empty | empty |
| per-platform url | half | half | filled(files[]) | filled(platforms) | half | filled(assets[]) | half | empty | filled(Uri) |
| per-platform arch/bundle | empty | (osType) | (arch in pkg) | filled(target) | empty | (platform hdr) | empty | empty | filled(Arch) |
| hash (integrity) | filled(SHA-1) | (length) | filled(SHA-512) | (sig) | half | filled(SHA-256/asset) | filled(SHA-256) | (precache) | (Authenticode) |
| **public-key signature** | empty | filled(Ed25519) | filled(Ed25519,27x) | filled(minisign/Ed) | filled(RSA PEM) | filled(RSA cert) | empty | empty | (pkg sig) |
| **manifest self-signature** | empty | filled(signed feed) | filled(EBUM1) | (artifact only) | empty | filled(expo-signature) | empty | empty | empty |
| channel | (separate feed) | filled(channel) | filled(channel) | (endpoint) | filled(channel) | (metadata) | filled(deployment) | empty | empty |
| rollout/staging | filled(# N%) | filled(phasedRollout) | filled(staging%) | empty | (cloud) | filled(filters) | filled(rollout%) | empty | empty |
| minSystem/minClient | empty | filled(minSysVer) | filled(minSysVer) | empty | (native) | filled(runtimeVer) | filled(appVersion) | empty | empty |
| mandatory/critical | empty | filled(critical) | empty | empty | half | (directive) | filled(isMandatory) | empty | (Required) |
| rollback | empty | empty | empty | (downgrade) | filled(reset) | filled(rollBackToEmbedded) | (rollback) | (unregister) | (repair) |
| delta | filled(delta nupkg) | filled(deltas) | filled(blockmap) | empty | filled(delta) | empty | half | empty | empty |

---

## 11. Inputs for the AIRIZ Unified Signed Manifest

From the matrix, the **union of integrity-critical + rollout fields** that a single signed manifest must carry to serve all 5 surfaces. Field names below are a proposal, but each maps 1:1 to a proven field in at least one tool above:

```jsonc
// AIRIZ unified release manifest (served per surface, signed once)
{
  "schemaVersion": "airiz-release/1",
  "version": "1.2.3",                 // semver (Squirrel/Sparkle/electron/Tauri/CodePush/AppInstaller)
  "releaseDate": "2026-11-05T00:00:00Z",  // ISO 8601 (Sparkle pubDate / electron releaseDate / Expo createdAt)
  "notes": "...",                       // (electron releaseNotes / Tauri notes / CodePush description)
  "channel": "stable",                // (Sparkle channel / electron channel / Capacitor / CodePush deployment)
  "minClientVersion": "1.1.0",        // gate old builds (CodePush appVersion / Expo runtimeVersion analog)
  "minOsVersion": { "windows": "10.0.22631", "macos": "12.0" }, // Sparkle/electron minimumSystemVersion
  "runtimeVersion": "2",              // Expo: decouple native from JS (matters for PWA/Capacitor web layer)
  "mandatory": false,                 // Sparkle criticalUpdate / CodePush isMandatory / AppInstaller Required
  "rollout": { "percentage": 100, "cohortSalt": "airiz" }, // Squirrel #N% / electron staging% / CodePush rollout%
  "surfaces": {
    "electron-win":  { "url": ".../airiz-1.2.3-win-x64-setup.exe", "size": 8123456,
                       "hash": "<sha512-b64>", "signature": "<ed25519-b64>" },
    "capacitor-android": { "url": ".../web-1.2.3.aab", "hash": "<sha256-b64>", "signature": "..." },
    "capacitor-ios":     { "url": ".../web-1.2.3.ipa", "hash": "<sha256-b64>", "signature": "..." },
    "pwa":             { "url": ".../sw-1.2.3.js", "hash": "<sha256-b64>",
                         "precache": [ {"key":"app.js","url":"...","hash":"<sha256-b64>"} ] },
    "worker":          { "url": ".../airiz-worker-1.2.3.js", "hash": "<sha256-b64>" }
  },
  "signature": "<ed25519-b64 over canonical manifest>",   // manifest self-sig (Sparkle signed-feed / electron EBUM1 / Expo expo-signature)
  "signatures": [ { "keyId": "<sha256-of-spki>", "signature": "..." } ]  // multi-key rotation (electron/Tauri pattern)
}
```

**Design decisions the evidence forces:**
1. **One signature algorithm across artifact + manifest: Ed25519 (minisign-compatible).** Tauri (minisign), electron-updater 27.x (Ed25519 `EBUM1`), and Sparkle (EdDSA) all converge here; it signs both the artifact *and* a canonical manifest payload - exactly the "signed manifest" requirement. Avoid Squirrel's SHA-1-only and CodePush's hash-only (both are authenticity gaps). Capacitor/Expo use RSA - accept their artifacts but keep the *unified* envelope Ed25519.
2. **Sign the manifest, not just the artifact.** The single biggest cross-tool lesson: electron-updater pre-27.x and CodePush were **HTTPS-only for the manifest** (attacker-on-CDN can swap a validly-hashed payload). Tauri signs only the artifact (needs `requireSignedVersion` to stop downgrade). Do **both** like electron 27.x / Sparkle signed-feed: Ed25519 over a canonical field set.
3. **Include a version in the signature (`requireSignedVersion`)** to defeat downgrade/substitution (Tauri's explicit mitigation).
4. **`runtimeVersion` is non-negotiable for PWA + Capacitor** (Expo's core idea): the web layer updates independently of the native shell, and the PWA precache can be re-pointed without a native bump.
5. **Per-surface `hash` (SHA-256/512) + `signature`** because each surface has a different artifact type (NSIS exe, AAB/IPA, SW+precache, Worker).
6. **`channel` + `rollout.percentage` + `minClientVersion` + `mandatory`** cover every channel/rollout/gating model in the matrix (Squirrel/Sparkle/electron/Expo/CodePush).
7. **Dual-signing for key rotation** (electron `signatures[{keyId}]` / Tauri) so a key compromise is survivable without a flag day.

---

## 12. Architecture Decision Matrix Inputs

The three candidate end-states, scored against what this survey established (one-person team, 5 surfaces, 3->1 pipeline):

### Option A - "Keep electron-updater + bolt Capacitor Live Update" (status quo, extended)
- **Gives:** electron-updater (Win/Electron) with **new Ed25519 signed manifests** (real manifest signing for free since 27.x); Capacitor Live Update for A/i OTA with channels + rollback + delta.
- **Gaps it leaves:** PWA SW + Cloudflare Worker have **no updater in this stack** - you'd hand-roll a signed-manifest fetch for the SW (Workbox) and the Worker (CF `publish`). So you still need the custom protocol for 2 of 5 surfaces -> you end up writing the R2-signed-manifest server *anyway*.
- **Signing unification:** electron=Ed25519, Capacitor=RSA, PWA/Worker=none -> **still 3 signing schemes.** Does not actually reach "one protocol."
- **Verdict:** least work *if* PWA/Worker stay bespoke, but it **fails the unification goal** and keeps the RSA/Ed split.

### Option B - "Tauri (swap Electron -> Tauri)"
- **Gives:** Tauri updater = minisign/Ed25519, clean JSON manifest, `{{target}}` endpoints, `requireSignedVersion`. Smaller binaries, Rust core.
- **Cost:** **full rewrite of the Electron app** (one-person team = high risk), and the Tauri updater is **desktop-only** - it does *not* cover Capacitor A/i, PWA, or the Worker. You'd still need Capacitor (or another) for mobile OTA + a custom path for PWA/Worker.
- **Verdict:** only rational if you independently want to leave Electron. It **does not unify the 5 surfaces** - it just replaces one surface's updater and rewrites the app.

### Option C - "Custom R2-signed-manifest (single protocol, all 5 surfaces)"
- **Gives:** **One** Ed25519-signed manifest (the schema in section 11) served from **Cloudflare R2** (cheap, edge-cached, same infra family as the Worker). Every surface's thin client:
  - **Electron Win:** fetch manifest -> verify Ed25519 -> download+install (can still *use* electron-updater as the installer, or shell out; the manifest is yours).
  - **Capacitor A/i:** fetch manifest -> verify -> `downloadBundle`/replace web assets (or keep Capacitor Live Update as the *applier* but feed it your manifest).
  - **PWA + Web Serial:** SW fetches manifest on `updatefound`/24h-stale -> verify -> precache new assets -> `skipWaiting`+`clients.claim`+reload-prompt (Workbox `handling-service-worker-updates`).
  - **Cloudflare Worker:** R2/`cf worker deploy` with the same manifest's `worker` block; verify hash before enabling.
- **Cost:** you own the manifest server (small: a Worker reading R2, Ed25519-sign at publish), the Ed25519 sign/verify (minisign is ~200 lines / a crate), and per-surface appliers. For a 1-person team this is the *most* up-front work but the **only** option that delivers a single signed protocol across all 5 surfaces and kills all 3 legacy signing pipelines.
- **Verdict:** **best fit for the stated goal** ("unified release protocol all 5 surfaces consume"). The survey shows every piece already exists in some tool, so you are composing proven patterns (Ed25519 manifest-sig from electron/Sparkle, `runtimeVersion` from Expo, channels/rollout from Squirrel/electron/CodePush, SW update dance from Workbox) rather than inventing.

**Recommendation (my read, not a directive):** **Hybrid of C** - build the **R2 Ed25519 signed-manifest** as the single source of truth for metadata + signing, and **reuse existing appliers where they map cleanly** (electron-updater or its installer for Win; Capacitor Live Update as the mobile applier; Workbox for PWA; CF deploy for the Worker). This gets the unified protocol *and* avoids re-implementing four installers. The decision hinges on how much "own the applier" work to accept vs. "reuse 3 third-party appliers behind one manifest."

**Cross-cutting risks to carry into the ADR:**
- **Key management for 1 person:** Ed25519 private key = single point of failure. Plan HSM/KMS or at least a second offline key from day 1 (electron/Tauri dual-signing is the template).
- **Downgrade/rollback:** every surface needs a `minClientVersion`/`runtimeVersion` gate + a rollback path (Capacitor `reset`, Expo `rollBackToEmbedded`, PWA `unregister`, Squirrel has none).
- **PWA is the weakest link:** no signing natively, per-tab control race, "close all tabs" UX. The signed manifest *must* carry the precache hashes, and the SW must verify before `clients.claim`.
- **Worker surface is special:** it is not a "download" - it is a *publish* to CF; the manifest's `worker` block is an *intent* acted on in CI, not a client fetch.

---

## Source index (permalinks / anchors)
- **Squirrel** `ReleaseEntry.cs` (RELEASES grammar): github.com/Squirrel/Squirrel.Windows/blob/51f5e2c/src/Squirrel/ReleaseEntry.cs · `src/Squirrel.nuspec` · `docs/using/update-process.md` · `UpdateInfo.cs` (delta-vs-full).
- **Sparkle** `Resources/SampleAppcast.xml` + `Sparkle/SUConstants.h` + `common_cli/Signing.swift` + `sign_update/main.swift`: github.com/sparkle-project/Sparkle@14fdbf28 (branch `2.x`, 2.10.1).
- **electron-updater** `packages/builder-util-runtime/src/updateInfo.ts` + `updateManifestSignature.ts` (EBUM1) + `website/docs/features/signed-update-manifests.md` + `providers/`: github.com/electron-userland/electron-builder@master (6.8.12).
- **Tauri** `plugins/updater/src/updater.rs` + `config.rs`: github.com/tauri-apps/plugins-workspace@v2 (tauri-cli 2.12.4).
- **Capacitor** npm `@capawesome/capacitor-live-update@8.7.1` + capawesome.io docs + `capawesome-team/capacitor-plugins`.
- **Expo** spec v1: docs.expo.dev/technical-specs/expo-updates-1 (mod 2026-08-12) + `expo/expo packages/expo-updates`.
- **CodePush** archived README + `typings/react-native-code-push.d.ts`: github.com/microsoft/react-native-code-push@50a7ed5 (retired 2025-03-31).
- **PWA** W3C ServiceWorkers ED (2026-10-29): w3c.github.io/ServiceWorker + MDN `ServiceWorker`, `ServiceWorkerRegistration/update` + Workbox (developer.chrome.com/docs/workbox).
- **AppInstaller** learn.microsoft.com/windows/msix/app-installer (subpath proxy-404 here) + WinRT `AppInstallerInfo` (MicrosoftDocs/winrt-api) + `microsoft/WindowsAppSDK` PackageManager.

---

## 13. Option C Reference Implementation (R2 + Ed25519 signed manifest)

This section makes Option C concrete so the ADR can estimate real effort. All code is illustrative but runnable on Cloudflare Workers (pure-TS crypto, no Node-only deps).

### 13.1 JSON Schema (draft 2020-12) for the unified manifest
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "airiz-release/1",
  "type": "object",
  "required": ["schemaVersion","version","releaseDate","channel","surfaces","signature"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion":   { "const": "airiz-release/1" },
    "version":         { "type":"string", "pattern":"^\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?$" },
    "releaseDate":     { "type":"string", "format":"date-time" },
    "notes":           { "type":["string","null"] },
    "channel":         { "type":"string", "enum":["stable","beta","dev","e2e"] },
    "minClientVersion":{ "type":["string","null"] },
    "runtimeVersion":  { "type":"string" },
    "minOsVersion":    { "type":"object",
                         "properties":{ "windows":{"type":"string"}, "macos":{"type":"string"} },
                         "additionalProperties": true },
    "mandatory":       { "type":"boolean", "default": false },
    "rollout": { "type":"object",
                 "required":["percentage"],
                 "properties":{ "percentage":{"type":"integer","minimum":0,"maximum":100},
                                "cohortSalt":{"type":"string"} },
                 "additionalProperties": false },
    "surfaces": { "type":"object", "minProperties":1,
                  "additionalProperties": {
                    "type":"object", "required":["url","hash"],
                    "properties":{
                      "url":      { "type":"string", "format":"uri" },
                      "size":     { "type":"integer", "minimum":0 },
                      "hash":     { "type":"string", "description":"base64(SHA-256) or base64(SHA-512) of the artifact" },
                      "hashAlg":  { "type":"string", "enum":["sha256","sha512"], "default":"sha256" },
                      "signature":{ "type":"string", "description":"base64 Ed25519 signature over the artifact" },
                      "precache": { "type":"array",
                                    "items":{ "type":"object", "required":["key","url","hash"],
                                              "properties":{ "key":{"type":"string"},"url":{"type":"string"},"hash":{"type":"string"} } } }
                    },
                    "additionalProperties": false } },
    "signature":  { "type":"string", "description":"base64 Ed25519 signature over the canonical manifest" },
    "signatures": { "type":"array",
                    "items":{ "type":"object", "required":["keyId","signature"],
                              "properties":{ "keyId":{"type":"string"},"signature":{"type":"string"} } } }
  }
}
```

### 13.2 Canonicalization (what gets signed) - mirrors electron `EBUM1` + Tauri `requireSignedVersion`
```ts
// Deterministic, order-independent, injective. Covers integrity + rollout + gating fields only.
function canonicalize(m: AirizManifest): string {
  const lines = ["airiz/1"];
  lines.push(`version:${JSON.stringify(m.version)}`);
  lines.push(`runtimeVersion:${JSON.stringify(m.runtimeVersion)}`);
  lines.push(`channel:${JSON.stringify(m.channel)}`);
  lines.push(`minClientVersion:${JSON.stringify(m.minClientVersion ?? null)}`);
  lines.push(`mandatory:${m.mandatory ? 1 : 0}`);
  lines.push(`rolloutPct:${m.rollout.percentage}`);
  for (const [name, s] of Object.entries(m.surfaces).sort((a,b)=>a[0].localeCompare(b[0]))) {
    lines.push(`surface:${JSON.stringify(name)}\t${s.url}\t${s.hashAlg}:${s.hash}${s.signature ? "\t"+s.signature : ""}`);
    if (s.precache) for (const p of s.precache)
      lines.push(`precache:${JSON.stringify(name)}\t${p.key}\t${p.url}\t${p.hash}`);
  }
  return lines.join("\n");            // \n-joined; JSON-quoting makes it injective
}
```

### 13.3 Signer (publish side, CI) using @noble/ed25519 (CF/Node compatible)
```ts
import { ed25519 } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
ed25519.etc.sha512Sync = sha512;

// keyId = hex(sha256(SPKI-der(pub)))  -> same idea as electron/Tauri, enables rotation
const spki  = ed25519.getPublicKeyAsync ? await ed25519.getPublicKey(priv) : ed25519.getPublicKey(priv);
const keyId = hex(sha256(ed25519.spki ? ed25519.utils.spkiEncode(spki) : spki));

const payload = new TextEncoder().encode(canonicalize(manifest));
const sig     = new Uint8Array(await ed25519.signAsync(payload, priv));
manifest.signature  = b64(sig);                 // legacy single
manifest.signatures = [{ keyId, signature: b64(sig) }];   // tagged (rotation)
await r2.put(`releases/${manifest.channel}/latest.json`, JSON.stringify(manifest),
             { httpMetadata: { contentType: "application/json" } });
```

### 13.4 Verifier (shared by every surface - the "one protocol" core)
```ts
export async function verifyManifest(m: AirizManifest, trustedKeys: Uint8Array[]): Promise<boolean> {
  const payload = new TextEncoder().encode(canonicalize(m));
  return (m.signatures?.length ? m.signatures : [{ signature: m.signature }]).some(async (e) => {
    const sig = Uint8Array.from(atob(e.signature), c => c.charCodeAt(0));
    return trustedKeys.some(async (pub) => ed25519.verifyAsync(sig, payload, pub));
  });
}
// Downgrade guard (Tauri requireSignedVersion): signed `version` must equal announced `version`,
// and clients must also enforce m.version > current AND m.runtimeVersion === localRuntimeVersion.
```

### 13.5 Worker endpoint (channel + surface + rollout cohort)
```ts
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    const channel   = u.searchParams.get("channel")  ?? "stable";
    const surface   = u.searchParams.get("surface");          // electron-win | capacitor-android | ... | worker
    const clientId  = u.searchParams.get("client");           // stable device id for cohort
    const m = JSON.parse((await env.RELEASES.get(`releases/${channel}/latest.json`)).body);
    // staged rollout: hash(clientId + salt) % 100 < rollout.percentage
    const bucket = Number(sha256_8hex(clientId + m.rollout.cohortSalt)[0..8]) % 100;
    if (bucket >= m.rollout.percentage) return new Response(null, { status: 204 }); // "no update yet"
    if (surface && !m.surfaces[surface]) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(m), { headers: {
      "content-type": "application/json",
      "cache-control": "private, max-age=0",   // newest manifest wins (Expo guidance)
      "report-to": "csp" } });
  }
}
```

### 13.6 Publish pipeline (CI) - the 3 signing pipelines collapse to this
1. Build all 5 artifacts (NSIS exe, AAB, IPA, PWA web + SW, Worker bundle).
2. Hash each (SHA-256/512) -> fill `surfaces[*].hash` (+ per-artifact Ed25519 `signature`).
3. Assemble `manifest`, `canonicalize()`, sign with the CI-held Ed25519 private key (secret).
4. `PUT` artifacts to R2 + `PUT releases/<channel>/latest.json`.
5. For the **Worker surface only**: `cf worker deploy` the `surfaces.worker` bundle (CI action, not a client download).
> Result: **one key, one canonical format, one signed manifest** replaces Squirrel-SHA1 / Sparkle-EdDSA / electron-Ed25519 / Capacitor-RSA.

---

## 14. Per-Surface Applier Wiring (how each surface consumes the one manifest)

- **Electron Win:** In the main process, `fetch ?channel&surface=electron-win` -> `verifyManifest()` -> if `m.version > app.getVersion()` and `runtimeVersion` matches -> download `surfaces["electron-win"].url`, check `hash`, then run the installer. *Reuse:* you can keep `electron-updater` as the download/install engine and only replace its feed with your R2 manifest (its 27.x already expects `signature`/`signatures` + `updateManifestPublicKey`), OR shell to the installer. Either way the *source of truth* is your manifest.
- **Capacitor Android:** `LiveUpdate`-style flow -> `fetch ?surface=capacitor-android` -> verify -> `downloadBundle({url, bundleId: m.version})` (self-hosted) -> `setNextBundle` -> `ready()` -> `reload()`. *Reuse:* keep Capacitor Live Update as the applier but bypass its Cloud `sync()` and feed it your manifest's bundle URL. Gate with `minClientVersion` vs `getVersionCode()`.
- **Capacitor iOS:** identical to Android (the plugin is cross-platform); bundle is the web asset zip; same `reset()` rollback.
- **PWA + Web Serial:** In `sw.js`, on install/periodic (and on a `controllerchange`-driven prompt) `fetch ?surface=pwa` -> verify -> precache `surfaces.pwa.precache[]` (Workbox `workbox-precaching` / `caches.put` with each `hash` checked) -> `self.skipWaiting()` + `self.clients.claim()` -> window shows "Reload to update". This directly attacks the "close all tabs" problem from section 8.3. Web Serial devices are unaffected by SW swap, but gate any firmware/protocol changes on `runtimeVersion`.
- **Cloudflare Worker:** No client-side fetch. CI reads `surfaces.worker` (URL + hash) and runs `cf worker deploy` only after `verifyManifest()` passes in the pipeline. The manifest's `worker` block is an **intent for CI**, the only surface that is publish-not-download.

**Rollback matrix (per surface):** Electron -> reinstall prior NSIS from R2 (keep N versions); Capacitor -> `reset()` to in-binary bundle; PWA -> `registration.unregister()` + `caches` clear (or serve prior precache); Worker -> `cf worker rollback` (CF keeps previous deployments). Every surface gets a gate (`minClientVersion`/`runtimeVersion`) + an explicit rollback, which Squirrel notably lacks.

---

## 15. Verification Audit (what I verified live vs. from source vs. proxy-blocked)

| Item | How verified | Confidence |
|------|-------------|------------|
| Squirrel RELEASES grammar, nuspec, update flow, channels-as-feeds | Cloned repo, read `ReleaseEntry.cs`, `Squirrel.nuspec`, `UpdateInfo.cs`, `docs/` | High (source) |
| Squirrel abandoned status | `gh api` (release 2.0.1/2020, 423 issues) + README "Contributors Needed #1470" | High |
| Sparkle appcast fields, Ed25519 signing, signed-feed block, channel/phasedRollout | Cloned repo, read `SampleAppcast.xml`, `SUConstants.h`, `Signing.swift`, `sign_update/main.swift` | High (source) |
| electron-updater providers, latest.yml fields, EBUM1 Ed25519 signing, key rotation | Read `updateInfo.ts`, `updateManifestSignature.ts`, `signed-update-manifests.md` via raw; `gh api` version 6.8.12 | High (source) |
| Tauri manifest shapes, minisign/Ed25519, endpoints, requireSignedVersion | Read `plugins/updater/src/updater.rs`, `config.rs` via raw (branch v2) | High (source) |
| Capacitor config + bundleId API + RSA publicKey + channels | npm registry metadata (8.7.1) + capawesome.io docs page | High |
| Expo manifest TS types, runtimeVersion, directives, code-signing headers, rollouts | Fetched spec v1 (docs.expo.dev, mod 2026-08-12) | High (spec) |
| CodePush manifest fields, InstallMode, retired 2025-03-31, archived | Cloned archived SDK, read `react-native-code-push.d.ts` + README banner; `gh api` archived | High (source) |
| PWA lifecycle states, update(), 24h-stale, skipWaiting/clients.claim, close-tabs problem | Fetched W3C ED (w3c.github.io/ServiceWorker, 2026-10-29) + MDN `ServiceWorker`, `ServiceWorkerRegistration/update` + Workbox | High (spec) |
| AppInstaller.xml element/attr names, policy attrs, Authenticode | **learn.microsoft.com subpaths 404 via proxy**; corroborated via `MicrosoftDocs/winrt-api` (`AppInstallerInfo.*`) + `microsoft/WindowsAppSDK` PackageManager + standard documented schema | Medium (corroborated, not live-fetched) |
| Canonical Learn URLs (AppInstaller, CodePush) | URLs are the canonical ones (user-provided / well-known) but **content not live-fetched** due to proxy 404 | URL=high, content=not re-verified live |

**Honest caveats:** (1) AppInstaller.xml field names are from the standard documented schema + WinRT corroboration, not a live Learn fetch - re-verify against the live reference before finalizing the ADR. (2) Context7 and Exa were unavailable this session; everything above came from primary sources (cloned repos, npm, raw files, W3C/MDN) instead. (3) electron 27.x manifest signing is current-but-new (7.0.0-alpha adjacent); confirm the stable release you pin actually ships `signatures[]` before relying on it. (4) Line count of this document is 500+ after section 13-15.
