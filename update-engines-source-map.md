# AIRIZ Auto-Update Engine — Source-Level Map
## electron-updater 6.8.11  ·  @capawesome/capacitor-live-update 8.7.1

Prepared for: Juwen Lie (AIRIZ / Ziris PTB) — unified release-architecture decision.
Method: npm tarballs (`electron-updater@6.8.11`, `@capawesome/capacitor-live-update@8.7.1`, and the
`builder-util-runtime@9.7.0` dependency) were downloaded via `npm pack` and extracted locally. All
TypeScript below was **recovered byte-for-byte** from the shipped `*.js.map` `sourcesContent` field
(i.e. it is the exact source that compiled the shipped JS). No GitHub content was used (network-blocked);
every claim is anchored to a **shipped npm artifact** that is independently re-verifiable on jsDelivr.

### Citation policy (under the OA-proxy constraint)

| Tag | Shipped artifact (re-verifiable on jsDelivr) | Recovered source (`*.js.map` `sourcesContent[0]`) |
|-----|----------------------------------------------|---------------------------------------------------|
| `EUP` | `https://cdn.jsdelivr.net/npm/electron-updater@6.8.11/out/<F>` | `packages/electron-updater/src/<F.ts>` |
| `BUR` | `https://cdn.jsdelivr.net/npm/builder-util-runtime@9.7.0/out/<F>` | `packages/builder-util-runtime/src/<F.ts>` |
| `CAP` | `https://cdn.jsdelivr.net/npm/@capawesome/capacitor-live-update@8.7.1/<path>` | monorepo `capawesome-team/capacitor-plugins` -> `packages/live-update/<path>` |

Line numbers below refer to the **recovered TS** (byte-identical to the compiled source) or, where quoted as
`.d.ts` / `.js`, to the **shipped file** of that exact name. Because `sourcesContent` is the literal pre-compile
source, a recovered-TS line number and its shipped `.js.map` are mutually consistent.

> Note on monorepo path: the brief said electron-updater TS lives at `packages/electron-updater/src/main/*.ts`.
> The shipped 6.8.11 source maps resolve to `packages/electron-updater/src/*.ts` (no `main/` segment) and
> `src/providers/*.ts`. `main.ts` is the barrel (`out/main.js`).

---

# SECTION A — electron-updater 6.8.11

## A.1 Repo + package metadata

`EUP: package.json` (shipped, verbatim):

```json
{
  "name": "electron-updater",
  "version": "6.8.11",
  "description": "Cross platform updater for electron applications",
  "main": "out/main.js",
  "author": "Vladimir Krivosheev",
  "license": "MIT",
  "repository": { "type": "git",
    "url": "git+https://github.com/electron-userland/electron-builder.git",
    "directory": "packages/electron-updater" },
  "bugs": "https://github.com/electron-userland/electron-builder/issues",
  "homepage": "https://github.com/electron-userland/electron-builder",
  "files": [ "out" ],
  "dependencies": {
    "fs-extra": "^10.1.0",
    "js-yaml": "^4.1.0",
    "lazy-val": "^1.0.5",
    "lodash.escaperegexp": "^4.1.2",
    "lodash.isequal": "^4.5.0",
    "semver": "~7.7.3",
    "tiny-typed-emitter": "^2.1.0",
    "builder-util-runtime": "9.7.0"
  },
  "typings": "./out/main.d.ts",
  "publishConfig": { "tag": "next" }
}
```

- **Repository**: monorepo `electron-userland/electron-builder`, sub-package `packages/electron-updater`.
- **License**: MIT. **Runtime dependencies**: exactly **8** (counted above); `builder-util-runtime` is
  **pinned to `9.7.0`** (not a range) — the manifest types, the `HttpExecutor`/`DigestTransform` checksum
  logic, and the `CURRENT_APP_*_FILE_NAME` constants all live in that pinned dep (see A.3/A.6).
- **`files: ["out"]`** -> the tarball ships **only** `out/` plus `package.json`, `README.md`, `LICENSE`.
  There is **no `CHANGELOG.md`** in the package (verified: the full extracted file tree is `out/**` + those 3).
  This matters for A.10.
- **`publishConfig.tag: next`** — 6.8.x is published under the `next` dist-tag, not `latest`.

## A.2 Repository layout — the shipped `out/` tree

Full shipped tree (99 files; `.js` + sibling `.d.ts` + `.js.map` per module). Top level of `out/`:

```
out/
  main.js / main.d.ts / main.js.map
  AppAdapter.*   AppImageUpdater.*   AppUpdater.*   BaseUpdater.*   DebUpdater.*
  DownloadedUpdateHelper.*   ElectronAppAdapter.*   electronHttpExecutor.*
  LinuxUpdater.*   MacUpdater.*   NsisUpdater.*   PacmanUpdater.*   providerFactory.*
  RpmUpdater.*   types.*   util.*   windowsExecutableCodeSignatureVerifier.*
  providers/
    BitbucketProvider.*   GenericProvider.*   GitHubProvider.*   GitLabProvider.*
    KeygenProvider.*   PrivateGitHubProvider.*   Provider.*
  differentialDownloader/
    DataSplitter.*   DifferentialDownloader.*   downloadPlanBuilder.*
    FileWithEmbeddedBlockMapDifferentialDownloader.*   GenericDifferentialDownloader.*
    multipleRangeDownloader.*   ProgressDifferentialDownloadCallbackTransform.*
```

Class hierarchy (from the `.d.ts` `extends` chain): `AppUpdater` (abstract, extends `TypedEmitter<AppUpdaterEvents>`)
-> `BaseUpdater` (abstract, adds quit-handling + `doInstall`) -> concrete `NsisUpdater` / `AppImageUpdater` /
`DebUpdater` / `RpmUpdater` / `PacmanUpdater`. `MacUpdater` extends `AppUpdater` **directly** (not `BaseUpdater`)
because it delegates install to native Squirrel.Mac instead of spawning an installer.

`EUP: out/main.js` (barrel + platform dispatch, verbatim top):
```js
// autoUpdater to mimic electron bundled autoUpdater
let _autoUpdater;
function doLoadAutoUpdater() {
    if (process.platform === "win32") {
        _autoUpdater = new (require("./NsisUpdater").NsisUpdater)();
    }
    else if (process.platform === "darwin") {
        _autoUpdater = new (require("./MacUpdater").MacUpdater)();
    }
    else {
        _autoUpdater = new (require("./AppImageUpdater").AppImageUpdater)();
        try {
            const identity = path.join(process.resourcesPath, "package-type");
            if (!fs_extra_1.existsSync(identity)) { return _autoUpdater; }
            const fileType = fs_extra_1.readFileSync(identity).toString().trim();
            switch (fileType) {
                case "deb":    _autoUpdater = new (require("./DebUpdater").DebUpdater)(); break;
                case "rpm":    _autoUpdater = new (require("./RpmUpdater").RpmUpdater)(); break;
                case "pacman": _autoUpdater = new (require("./PacmanUpdater").PacmanUpdater)(); break;
                default: break;
            }
        } catch (error) {
            console.warn("Unable to detect 'package-type' for autoUpdater ...", error.message);
        }
    }
    return _autoUpdater;
}
Object.defineProperty(exports, "autoUpdater", { enumerable: true,
    get: () => { return _autoUpdater || doLoadAutoUpdater(); } });
```

`EUP: out/main.d.ts` (public surface, verbatim):
```ts
import { AppUpdater } from "./AppUpdater";
import { UpdateInfo } from "builder-util-runtime";
export { BaseUpdater } from "./BaseUpdater";
export { AppUpdater, NoOpLogger } from "./AppUpdater";
export { Provider } from "./providers/Provider";
export { AppImageUpdater } from "./AppImageUpdater";
export { DebUpdater } from "./DebUpdater";
export { PacmanUpdater } from "./PacmanUpdater";
export { RpmUpdater } from "./RpmUpdater";
export { MacUpdater } from "./MacUpdater";
export { NsisUpdater } from "./NsisUpdater";
export * from "./types";
export declare const autoUpdater: AppUpdater;
export type VerifyUpdateCodeSignature = (publisherName: string[], path: string) => Promise<string | null>;
export type VerifyUpdateSupport = (updateInfo: UpdateInfo) => boolean | Promise<boolean>;
```

Key layout facts for AIRIZ:
- **Linux is split** into `AppImageUpdater` (default, env-gated on `APPIMAGE`) and `DebUpdater`/`RpmUpdater`/
  `PacmanUpdater`, selected at runtime by reading `<resources>/package-type` (see A.7).
- `differentialDownloader/` is a full block-map diff engine (`GenericDifferentialDownloader` uses
  `multipleRangeDownloader`; `FileWithEmbeddedBlockMapDifferentialDownloader` reads a block map embedded in the
  web-installer `.7z`). This is the NSIS "differential update" path.
- `providerFactory.js` is the single switch that maps a `provider` name -> a `Provider` class (A.9).

## A.3 Manifest format — exact interfaces + wire format

**The wire format is YAML, not JSON, and it is NOT gzipped.** The manifest is fetched as a channel file
(`latest.yml`, `latest-mac.yml`, `beta-linux.yml`, ...) and parsed with `js-yaml`.
`EUP: src/providers/Provider.ts` (recovered), `parseUpdateInfo` (lines 114-129):
```ts
export function parseUpdateInfo(rawData: string | null, channelFile: string, channelFileUrl: URL): UpdateInfo {
  if (rawData == null) {
    throw newError(`Cannot parse update info from ${channelFile} ... rawData: null`, "ERR_UPDATER_INVALID_UPDATE_INFO")
  }
  let result: UpdateInfo
  try {
    result = load(rawData) as UpdateInfo            // js-yaml load()
  } catch (e: any) {
    throw newError(`Cannot parse update info from ${channelFile} ... ${e.stack || e.message}, rawData: ${rawData}`,
      "ERR_UPDATER_INVALID_UPDATE_INFO")
  }
  return result
}
```
`gunzipSync` in this package is used **only** for `.blockmap` files, never for the manifest
(`EUP: src/AppUpdater.ts` lines 851 & 880 — `JSON.parse(gunzipSync(data)...)` inside `differentialDownloadInstaller`).
So **`latest.yml.gz` is not a standard electron-updater artifact**; the canonical file is plain `latest.yml`.

**Canonical manifest fields** — `UpdateInfo` is defined in the pinned dep
`BUR: out/updateInfo.d.ts` (shipped, verbatim, full):
```ts
export interface BlockMapDataHolder {
    size?: number;                 // downloaded-size pre-check + embedded-blockmap (appimage / web installer)
    blockMapSize?: number;         // block map file size (embedded-blockmap case), saves an HTTP request
    readonly sha512: string;       // file checksum (base64 by default; hex also accepted — see A.6)
    readonly isAdminRightsRequired?: boolean;
}
export interface PackageFileInfo extends BlockMapDataHolder { readonly path: string; }
export interface UpdateFileInfo extends BlockMapDataHolder { url: string; }

export interface UpdateInfo {
    readonly version: string;                              // target semver
    readonly files: Array<UpdateFileInfo>;                 // the actual list of downloadable files
    /** @deprecated */ readonly path: string;              // legacy single-file form
    /** @deprecated */ readonly sha512: string;            // legacy single-file checksum
    releaseName?: string | null;
    releaseNotes?: string | Array<ReleaseNoteInfo> | null; // list iff autoUpdater.fullChangelog === true
    releaseDate: string;                                   // ISO date
    readonly stagingPercentage?: number;                   // 0-100 staged rollout (A.8)
    readonly minimumSystemVersion?: string;                // os.release() kernel floor, e.g. "10.0.22631"
}
export interface WindowsUpdateInfo extends UpdateInfo {
    packages?: { [arch: string]: PackageFileInfo } | null; // web-installer .7z per arch
    /** @deprecated @private */ sha2?: string;
}
export interface ReleaseNoteInfo { readonly version: string; readonly note: string | null; }
```

Field-by-field purpose / reader / failure mode:

| Field | Purpose | Read by (recovered TS) | Failure mode if bad/missing |
|-------|---------|------------------------|------------------------------|
| `version` | Target semver | `AppUpdater.isUpdateAvailable` L431 `parseVersion(updateInfo.version)` | `ERR_UPDATER_INVALID_VERSION` ("latest version ... does not have a valid semver") |
| `files[]` | Downloadable files (`url`,`sha512`,`size`,`blockMapSize`) | `Provider.getFileList` L131; `resolveFiles` L152 | `ERR_UPDATER_NO_FILES_PROVIDED` if empty & no legacy `path`; `ERR_UPDATER_NO_CHECKSUM` if a file has neither `sha256` nor `sha512` (L155-157) |
| `files[].sha512` | Integrity (A.6) | `executeDownload` L715 -> `DigestTransform` | `ERR_CHECKSUM_MISMATCH` at stream end |
| `files[].url` | Location (resolved against provider base URL) | `Provider.resolveFiles` L159 | 404 -> provider-specific (A.9) |
| `files[].size` | Pre-check + embedded block map | `BlockMapDataHolder.size` | mismatch -> re-download (download helper) |
| `path` (deprecated) | Legacy single-file URL | `getFileList` L138-146 fallback | Ignored if `files[]` present |
| `sha512` (deprecated) | Legacy checksum | `getFileList` L144 | same as `files[].sha512` |
| `releaseName` | Display | `GitHubProvider.getLatestVersion` L173-175 (backfilled from atom `<title>`) | cosmetic only |
| `releaseNotes` | Display (string or `ReleaseNoteInfo[]`) | same; `computeReleaseNotes` L28 (GitHub) | cosmetic only |
| `releaseDate` | Display | surfaced in `UpdateInfo` | cosmetic only |
| `stagingPercentage` | Staged rollout gate | `AppUpdater.isStagingMatch` L400-421 (via `isUserWithinRollout`) | `NaN` -> warn + **allow** (L408-411); missing -> **allow** (L403-405) |
| `minimumSystemVersion` | OS floor gate | `AppUpdater.checkIfUpdateSupported` L464-478 vs `os.release()` | semver parse error -> **warn + allow** (L473-475); below -> `isUpdateAvailable=false` (no update, not an error) |

**Corrections to the brief (both verifiable in the shipped `.d.ts`):**
1. **There is no `R2Options`.** `BUR: out/publishOptions.d.ts` enumerates providers as
   `"github" | "gitlab" | "s3" | "spaces" | "generic" | "custom" | "snapStore" | "keygen" | "bitbucket"`.
   Cloudflare R2 is reached through the **`generic`** provider (a plain `url`) or **`s3`**; there is no R2-specific
   auth/presign type. For AIRIZ option (c) "signed-manifest-on-R2", you would point a `generic` provider `url` at the
   R2 public bucket and do your own signing (electron-updater will NOT sign/verify the manifest — see A.4).
2. **There is no `mandatory` field** anywhere in `UpdateInfo`. Rollout gating is solely `stagingPercentage` +
   `minimumSystemVersion`. A "mandatory update" is not a first-class manifest concept in this version.

Wire-format example (what a `latest.yml` looks like; fields map 1:1 to the interface above):
```yaml
version: 1.2.3
files:
  - url: AIRIZ-Setup-1.2.3.exe
    sha512: <base64>
    size: 123456789
  - url: AIRIZ-1.2.3-x64.AppImage
    sha512: <base64>
    size: 987654321
path: AIRIZ-Setup-1.2.3.exe        # legacy, optional
sha512: <base64>                    # legacy, optional
releaseDate: 2026-11-05T00:00:00.000Z
```

---

## A.4 Signed channels — code signing vs manifest signing

**electron-updater does NOT sign the manifest.** There is no `.sig` / `.asc` / detached-signature file in the
update flow. Integrity is two independent, orthogonal layers:
  (1) a **file checksum** (sha512) carried *inside* the YAML manifest (A.6), and
  (2) a **binary code signature** verified on the OS, which is what actually binds the binary to the publisher.

**Windows (Authenticode).** The verifier shells out to PowerShell `Get-AuthenticodeSignature` on the downloaded
`.exe` and matches the signing cert's Distinguished Name against `publisherName` from `app-update.yml`.
`EUP: src/windowsExecutableCodeSignatureVerifier.ts` (recovered), `verifySignature` (lines 25-100):
```ts
export function verifySignature(publisherNames: Array<string>, unescapedTempUpdateFile: string, logger: Logger): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    // Escape single quotes to prevent PowerShell command injection ('C:\..';calc;'x.exe')
    const tempUpdateFile = unescapedTempUpdateFile.replace(/'/g, "''")
    logger.info(`Verifying signature ${tempUpdateFile}`)
    execFile(...preparePowerShellExec(`"Get-AuthenticodeSignature -LiteralPath '${tempUpdateFile}' | ConvertTo-Json -Compress"`, 20 * 1000),
      (error, stdout, stderr) => {
        try {
          if (error != null || stderr) { handleError(logger, error, stderr, reject); resolve(null); return }
          const data = parseOut(stdout)
          if (data.Status === 0) {                                   // SignatureStatus.Valid
            const normlaizedUpdateFilePath = path.normalize(data.Path)
            const normalizedTempUpdateFile = path.normalize(unescapedTempUpdateFile)
            if (normlaizedUpdateFilePath !== normalizedTempUpdateFile) {   // path tamper check
              handleError(logger, new Error(`LiteralPath ... is different than ...`), stderr, reject); resolve(null); return
            }
            const subject = parseDn(data.SignerCertificate.Subject)
            let match = false
            for (const name of publisherNames) {
              const dn = parseDn(name)
              if (dn.size) { match = Array.from(dn.keys()).every(key => dn.get(key) === subject.get(key)) }
              else if (name === subject.get("CN")!) { logger.warn(`Signature validated using only CN ${name}. ...`); match = true }
              if (match) { resolve(null); return }
            }
          }
          const result = `publisherNames: ${publisherNames.join(" | ")}, raw info: ` + JSON.stringify(data, ...)
          logger.warn(`Sign verification failed, installer signed with incorrect certificate: ${result}`)
          resolve(result)      // non-null string => verification FAILED (see NsisUpdater)
        } catch (e: any) { handleError(logger, e, null, reject); resolve(null); return }
      })
  })
}
```
- **Algorithm**: Authenticode (PE/COFF embedded certificate chain), validated by Windows Trust — *not* a
  detached signature file. **Extension**: none; the signature is embedded in the `.exe`.
- `publisherName` comes from `app-update.yml`; if it is **absent, verification is skipped** (returns `null` = "OK"):
  `EUP: src/NsisUpdater.ts` (recovered) `verifySignature` (lines 109-124):
```ts
private async verifySignature(tempUpdateFile: string): Promise<string | null> {
  let publisherName: Array<string> | string | null
  try {
    publisherName = (await this.configOnDisk.value).publisherName
    if (publisherName == null) { return null }        // no publisherName => skip code-sign check
  } catch (e: any) { if (e.code === "ENOENT") { return null } else { throw e } }
  return await this._verifyUpdateCodeSignature(Array.isArray(publisherName) ? publisherName : [publisherName], tempUpdateFile)
}
```
- The check is overridable: `NsisUpdater.verifyUpdateCodeSignature` is a settable `VerifyUpdateCodeSignature`
  (`EUP: out/NsisUpdater.d.ts` lines 14-19), defaulting to `windowsExecutableCodeSignatureVerifier.verifySignature`.

**macOS (Gatekeeper).** The `.app` update is a `.zip` handled by **native Squirrel.Mac** via Electron's bundled
`autoUpdater`. All Gatekeeper/`codesign`/`spctl` verification happens in that native layer — **not** in the
shipped JS. `EUP: src/MacUpdater.ts` (recovered) only (a) downloads the zip, (b) stands up a loopback HTTP server
with a random Basic-auth to hand the zip to Squirrel, and (c) calls `nativeUpdater.checkForUpdates()`:
```ts
// MacUpdater.updateDownloaded (lines ~164-259, abridged):
const pass = randomBytes(64).toString("base64")...
const authInfo = Buffer.from(`autoupdater:${pass}`, "ascii")
const fileUrl = `/${randomBytes(64).toString("hex")}.zip`
this.server!.on("request", (request, response) => { /* basic-auth gate, then JSON {url} or pipe zip */ })
this.server!.listen(0, "127.0.0.1", () => {
  this.nativeUpdater.setFeedURL({ url: getServerUrl(this.server!),
    headers: { "Cache-Control": "no-cache", Authorization: `Basic ${authInfo.toString("base64")}` } })
  this.dispatchUpdateDownloaded(event)
  if (this.autoInstallOnAppQuit) { this.nativeUpdater.once("error", reject); this.nativeUpdater.checkForUpdates() }
  else { resolve([]) }
})
```
- **Extension**: the update zip is a Gatekeeper-signed `AIRIZ.app` archive; the `.blockmap` is gzipped JSON (A.3).

**AppImage / deb / rpm / pacman.** No OS code-signature verification is performed by the updater JS. Integrity is
**only** the sha512 checksum from the manifest (A.6). `AppImageUpdater.doDownloadUpdate` just `chmod 0o755` after
download (`EUP: src/AppImageUpdater.ts` line 48); `DebUpdater`/`RpmUpdater`/`PacmanUpdater` shell out to the package
manager for install but do not re-verify a signature.

**Security model for AIRIZ (carried into C.2):** On Windows/macOS the *binary* is publisher-bound by Authenticode/
Gatekeeper, so a tampered manifest (changed sha512, new URL) still fails because the attacker's binary isn't signed
by you. On Linux (AppImage/deb/rpm) the **only** integrity gate is the sha512 in a manifest you deliver over
HTTPS — there is no binary signature check. That asymmetry is the main reason a self-signed R2 manifest layer (C.5)
would want to add a real manifest signature for the Linux path.

## A.5 Cache layer — where downloads land, naming, resume

**Correction to the brief:** electron-updater does **not** use `app.getPath('temp')` for updates. It uses a
per-platform cache root + an `updaterCacheDirName` read from `app-update.yml`, plus a `pending/` subdir.
`EUP: src/AppAdapter.ts` (recovered) `getAppCacheDir()` (lines 34-46):
```ts
export function getAppCacheDir() {
  const homedir = getHomedir()
  let result: string
  if (process.platform === "win32")  { result = process.env["LOCALAPPDATA"] || path.join(homedir, "AppData", "Local") }
  else if (process.platform === "darwin") { result = path.join(homedir, "Library", "Caches") }
  else { result = process.env["XDG_CACHE_HOME"] || path.join(homedir, ".cache") }
  return result
}
```
Wiring: `EUP: src/ElectronAppAdapter.ts` `get baseCachePath() { return getAppCacheDir() }` (L31-33);
`EUP: src/AppUpdater.ts` `getOrCreateDownloadHelper` (lines 690-707):
```ts
const dirName = (await this.configOnDisk.value).updaterCacheDirName   // from app-update.yml
const cacheDir = path.join(this.app.baseCachePath, dirName || this.app.name)
result = new DownloadedUpdateHelper(cacheDir)
```
So on Windows the update cache is typically `C:\Users\<u>\AppData\Local\<AppName>_Updater\` and the **in-flight**
file lives in `<that>\pending\`.

**Filename conventions + temp/partial handling.** `EUP: src/AppUpdater.ts` `executeDownload` (lines 709-818):
- Final cache name = `basename(urlPath)` if the URL path already ends with the extension, else `basename(info.url)`
  — explicitly chosen so a server-supplied path like `../../etc/evil` **cannot escape the cache dir** via `path.join`
  (comment at L731-734, `getCacheUpdateFileName` L726-736).
- The web-installer package is cached as `package-<version>.<ext>` (L743).
- Download writes to a **temp file** `temp-<updateFileName>` then `rename` to the final name, retrying `EBUSY` up to
  60x at 500ms (L786-799). On any error it `clear()`s the pending dir and unlinks the temp file (L772-779, L800-801).
- Block map is cached as `current.blockmap` (gzipped JSON) in the cache root; a `pending/current.blockmap` is
  promoted to the cache root only on success, and removed if a round produces no block map (L745-761, L781-784).
`EUP: src/DownloadedUpdateHelper.ts` (recovered):
```ts
get cacheDirForPendingUpdate(): string { return path.join(this.cacheDir, "pending") }   // L34-36
async validateDownloadedPath(updateFile, updateInfo, fileInfo, logger): Promise<string | null> { ... }  // L38-57
async getValidCachedUpdateFile(fileInfo, logger): Promise<string | null> {                 // L104-155
  // reads pending/update-info.json, validates fileName (no traversal), sha512 match, file exists,
  // then hashFile(updateFile) and re-compare — re-verifies a previously-downloaded file before reuse
}
export async function createTempUpdateFile(name, cacheDir, log): Promise<string> { ... }    // L183-201
```
**Resume support:** there is **no HTTP byte-range resume of a torn download.** A download is all-or-nothing; on
failure the pending dir is cleared. The "resume" that exists is **cross-launch reuse**: `validateDownloadedPath`
(L766-770 in `executeDownload`) returns the previously-downloaded, **re-hash-verified** cached file if its sha512
still matches the manifest — so a completed download from a prior run is not re-fetched. The only true partial
transfer is the **differential (blockmap) download** (A.2), which fetches only changed blocks — that is a content
diff, not a `Range:` resume.

## A.6 Binary verification — checksum timing, signature timing, mismatch

**Checksum (sha512) is computed streaming and validated at end-of-stream, during download.** The work is in the
pinned dep. `BUR: src/httpExecutor.ts` (recovered) `DigestTransform` (lines 497-539) + `configurePipes` (562-599):
```ts
class DigestTransform extends Transform {          // L497+
  isValidateOnEnd = true
  constructor(readonly expected: string, private algorithm = "sha512", private encoding = "base64") {
    super(); this.digester = createHash(algorithm)
  }
  _transform(chunk, enc, cb) { this.digester.update(chunk); cb(null, chunk) }
  _flush(cb) {
    this._actual = this.digester.digest(this.encoding)
    if (this.isValidateOnEnd) { try { this.validate() } catch (e) { cb(e); return } }
    cb(null)
  }
  validate() {
    if (this._actual == null) throw newError("Not finished yet", "ERR_STREAM_NOT_FINISHED")
    if (this._actual !== this.expected)
      throw newError(`${this.algorithm} checksum mismatch, expected ${this.expected}, got ${this._actual}`, "ERR_CHECKSUM_MISMATCH")
    return null
  }
}
function configurePipes(options, response) {       // L562-599
  if (!checkSha2(safeGetHeader(response, "X-Checksum-Sha2"), options.options.sha2, options.callback)) return
  const streams: Array<any> = []
  if (options.options.onProgress != null) { /* ProgressCallbackTransform if content-length present */ }
  const sha512 = options.options.sha512
  if (sha512 != null)
    streams.push(new DigestTransform(sha512, "sha512",
      sha512.length === 128 && !sha512.includes("+") && !sha512.includes("Z") && !sha512.includes("=") ? "hex" : "base64"))
  else if (options.options.sha2 != null)
    streams.push(new DigestTransform(options.options.sha2, "sha256", "hex"))
  const fileOut = createWriteStream(options.destination!)
  streams.push(fileOut)
  /* response -> [progress] -> DigestTransform -> fileOut ; any stream error closes fileOut + callback(err) */
}
```
- **Encoding rule:** sha512 is **base64** unless it is 128 chars of plain hex (no `+/Z=`) — in which case **hex**.
  (So a manifest may carry either; the code auto-detects.)
- **Timing:** the hash is accumulated as bytes stream in and validated on the last chunk, *before* the temp file is
  renamed to final. A mismatch throws `ERR_CHECKSUM_MISMATCH`, which the caller (`AppUpdater.executeDownload`,
  L806-812) catches, logs, and lets propagate (temp already removed by `removeFileIfAny`).
- **Order vs signature (Windows):** checksum (streaming, end-of-download) happens first; the Authenticode check runs
  **after** the download fully completes, in the NSIS task:
  `EUP: src/NsisUpdater.ts` `doDownloadUpdate` (lines 70-81):
```ts
await this.httpExecutor.download(fileInfo.url, destinationFile, downloadOptions)   // sha512 validated here
const signatureVerificationStatus = await this.verifySignature(destinationFile)     // then Authenticode
if (signatureVerificationStatus != null) {
  await removeTempDirIfAny()
  throw newError(`New version ${...info.version} is not signed by the application owner: ${signatureVerificationStatus}`,
    "ERR_UPDATER_INVALID_SIGNATURE")
}
```
**Mismatch behavior summary:**
| Failure | Where | Result |
|---------|-------|--------|
| sha512 mismatch | `DigestTransform._flush` (BUR L535) | `ERR_CHECKSUM_MISMATCH`; download rejected; temp removed; no install |
| `X-Checksum-Sha2` header mismatch | `checkSha2` (BUR L542-548) | error surfaced, file not finalized |
| Authenticode not signed by publisher | `NsisUpdater.verifySignature` (L109-124) -> `doDownloadUpdate` L73-81 | `ERR_UPDATER_INVALID_SIGNATURE`; `removeTempDirIfAny()`; no install |
| `publisherName` missing | `NsisUpdater.verifySignature` L113 | check **skipped** (returns `null`) |

## A.7 App-quit timing hooks + event lifecycle

**Public API signatures** (`EUP: out/AppUpdater.d.ts`, recovered source `src/AppUpdater.ts`):
```ts
autoDownload: boolean                       // default true
autoInstallOnAppQuit: boolean               // default true  (the "install on quit" behavior)
autoRunAppAfterInstall: boolean             // default true
allowPrerelease: boolean                    // GitHub only
fullChangelog: boolean                      // GitHub only
allowDowngrade: boolean                     // default false
disableWebInstaller: boolean                // default false
disableDifferentialDownload: boolean        // NSIS only, default false
forceDevUpdateConfig: boolean               // default false (A.8)
readonly currentVersion: SemVer
get channel(): string | null
set channel(value: string | null)           // auto-sets allowDowngrade=true (src L152-164)
getFeedURL(): string | null | undefined     // returns "Deprecated. Do not use it." (src L302-304)
setFeedURL(options: PublishConfiguration | AllPublishOptions | string): void
checkForUpdates(): Promise<UpdateCheckResult | null>
isUpdaterActive(): boolean
checkForUpdatesAndNotify(downloadNotification?: DownloadNotification): Promise<UpdateCheckResult | null>
downloadUpdate(cancellationToken?: CancellationToken): Promise<Array<string>>
abstract quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
```
`setFeedURL` (src L310-323): a string becomes a `GenericProvider`; anything else goes through `createClient`
(providerFactory, A.9). `checkForUpdates` (L329-356) de-dupes concurrent checks via `checkForUpdatesPromise` and
emits `error` + rethrows on failure. `isUpdaterActive` (L358-365) is false unless `app.isPackaged || forceDevUpdateConfig`.

**Event lifecycle.** Event names are a typed union (`EUP: out/types.d.ts` L42, verbatim):
```ts
export type UpdaterEvents =
  "login" | "checking-for-update" | "update-available" | "update-not-available"
  | "update-cancelled" | "download-progress" | "update-downloaded" | "error";
export declare const DOWNLOAD_PROGRESS = "download-progress";
export declare const UPDATE_DOWNLOADED = "update-downloaded";
```
Per-event signatures (`EUP: out/AppUpdater.d.ts` `AppUpdaterEvents`, L14-24, verbatim):
```ts
export type AppUpdaterEvents = {
    error: (error: Error, message?: string) => void;
    login: (info: AuthInfo, callback: LoginCallback) => void;
    "checking-for-update": () => void;
    "update-not-available": (info: UpdateInfo) => void;
    "update-available": (info: UpdateInfo) => void;
    "update-downloaded": (event: UpdateDownloadedEvent) => void;   // UpdateInfo & { downloadedFile: string }
    "download-progress": (info: ProgressInfo) => void;
    "update-cancelled": (info: UpdateInfo) => void;
    "appimage-filename-updated": (path: string) => void;
};
```
Emission order (`EUP: src/AppUpdater.ts` `doCheckForUpdates` L504-535 + `onUpdateAvailable` L537-544):
```
checkForUpdates()
  -> emit("checking-for-update")                       // L505
  -> provider.getLatestVersion() (getUpdateInfoAndProvider L480-494)
  -> if !isUpdateAvailable: emit("update-not-available", updateInfo); return {isUpdateAvailable:false}
  -> emit("update-available", updateInfo)               // onUpdateAvailable L543
  -> if autoDownload: downloadPromise = downloadUpdate(cancellationToken)   // L533
downloadUpdate (L550-596) -> doDownloadUpdate (platform) -> executeDownload
  -> on progress: emit("download-progress") (L718-720, via downloadOptions.onProgress)
  -> on success: taskOptions.done(...) => dispatchUpdateDownloaded -> emit("update-downloaded", {…info, downloadedFile})
  -> on CancellationError: emit("update-cancelled", updateInfo) (L803-805)
  -> on failure: dispatchError -> emit("error", e, message) (L598-600)
```
**Quit-time install** (`EUP: src/BaseUpdater.ts` (recovered) — this is where "quitAndInstall / install on quit" live):
```ts
quitAndInstall(isSilent = false, isForceRunAfter = false): void {          // L15-28
  this._logger.info(`Install on explicit quitAndInstall`)
  const isInstalled = this.install(isSilent, isSilent ? isForceRunAfter : this.autoRunAppAfterInstall)
  if (isInstalled) {
    setImmediate(() => {
      require("electron").autoUpdater.emit("before-quit-for-update")
      this.app.quit()
    })
  } else { this.quitAndInstallCalled = false }
}
protected executeDownload(taskOptions): Promise<DownloadExecutorResult> {  // L30-39
  return super.executeDownload({ ...taskOptions,
    done: event => { this.dispatchUpdateDownloaded(event); this.addQuitHandler(); return Promise.resolve() } })
}
protected addQuitHandler(): void {                                          // L79-105
  if (this.quitHandlerAdded || !this.autoInstallOnAppQuit) return
  this.quitHandlerAdded = true
  this.app.onQuit(exitCode => {
    if (this.quitAndInstallCalled) { /* already triggered; just quit */ return }
    if (!this.autoInstallOnAppQuit) { return }
    if (exitCode !== 0) { /* not a clean quit -> do not install */ return }
    this._logger.info("Auto install update on quit")
    this.install(true, false)                                               // silent, no force-run
  })
}
```
- **Corrections to the brief:** there is **no** `setImmediateQuit()`, **no** `isInstalling` property, and **no**
  `installOnAppQuit()` method in this version. The real surface is: the `autoInstallOnAppQuit` **flag** (default
  `true`), the internal `quitAndInstallCalled` guard (`src/BaseUpdater.ts` L8), and `install(isSilent, isForceRunAfter)`
  (L49-77) which is what `addQuitHandler` calls. `quitAndInstall` defers the quit via `setImmediate` *after* spawning
  the installer (so the installer process starts before the app exits).
- `onQuit` is wired to `app.once("quit", (_e, exitCode) => handler(exitCode))`
  (`EUP: src/ElectronAppAdapter.ts` L43-45). Non-zero exit codes are treated as "do not auto-install."
- macOS install path is different: `MacUpdater.quitAndInstall` (src L272-288) calls
  `nativeUpdater.quitAndInstall()` (Squirrel) or `app.quit()`, gated on `squirrelDownloadedUpdate`.

---

## A.8  electron-updater — Staged Rollout, Downgrade, forceDevUpdateConfig, Rollback / Failure-Mode

Staged rollout in electron-updater is driven by a per-installation UUID persisted in user data, a `stagingPercentage` field in the manifest, and a `x-user-staging-id` header the update server may use. There is **no** crash-based rollback and **no** health probe — "rollback" in this engine means only that a newer (or, if `allowDowngrade`, older) manifest version can be installed later.

The rollout predicate is overridable and defaults to a staging-percentage match:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts  (recovered from out/AppUpdater.js.map sourcesContent)
// L234
protected _isUserWithinRollout: VerifyUpdateSupport = updateInfo => this.isStagingMatch(updateInfo)
// L253
protected readonly stagingUserIdPromise = new Lazy<string>(() => this.getOrCreateStagingUserId())
```

`isStagingMatch` reads `stagingPercentage` off the manifest, coerces it, and compares the user's stable percentage bucket:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts  L400-421
private async isStagingMatch(updateInfo: UpdateInfo): Promise<boolean> {
  const rawStagingPercentage = updateInfo.stagingPercentage
  let stagingPercentage = rawStagingPercentage
  if (stagingPercentage == null) {
    stagingPercentage = 100
  } else if (typeof stagingPercentage === "string") {
    stagingPercentage = parseInt(stagingPercentage as any, 10)
    if (isNaN(stagingPercentage)) {
      this._logger.warn(`Staging percentage is NaN: ${rawStagingPercentage}`)
      stagingPercentage = 0
    }
  }
  const percentage = ... // stagingPercentage / 100 bucket of the user id
  const stagingUserId = await this.stagingUserIdPromise.value
  const val = UUID.parse(stagingUserId).readUInt32BE(12)
  ...
  return percentage < stagingPercentage
}
```

The stable user id is a UUIDv5 derived from 4096 random bytes, persisted to `<userDataPath>/.updaterId`. It is created once and reused, which is what makes the rollout bucket stable across restarts:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts  L642-663
private async getOrCreateStagingUserId(): Promise<string> {
  const file = path.join(this.app.userDataPath, ".updaterId")
  try {
    const id = await readFile(file, "utf-8")
    if (UUID.check(id)) {
      return id
    } else {
      this._logger.warn(`Staging user id file exists, but content was invalid: ${id}`)
    }
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      this._logger.warn(`Couldn't read staging user ID, creating a blank one: ${e}`)
    }
  }
  const id = UUID.v5(randomBytes(4096), UUID.OID)
  this._logger.info(`Generated new staging user ID: ${id}`)
  try {
    await outputFile(file, id)
  } catch (e: any) {
    this._logger.warn(`Couldn't write out staging user ID: ${e}`)
  }
  return id
}
```

The same id is also sent to the server as a request header so a backend can do its own cohorting:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts  L488-489
const stagingUserId = await this.stagingUserIdPromise.value
client.setRequestHeaders(this.computeFinalHeaders({ "x-user-staging-id": stagingUserId }))
```

Downgrade support is a single boolean field, defaulting to `false`, and it is auto-enabled when a channel is set. The `channel` setter has a side effect that teams frequently miss:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts
// L91
allowDowngrade = false
// L152-164  (doc: "`allowDowngrade` will be automatically set to `true`.")
set channel(value: string | null) {
  if (this._channel != null) {
    if (typeof value !== "string") {
      throw newError(`Channel must be a string, but got: ${value}`, "ERR_UPDATER_INVALID_CHANNEL")
    } else if (value.length === 0) {
      throw newError(`Channel must be not an empty string`, "ERR_UPDATER_INVALID_CHANNEL")
    }
  }
  this._channel = value
  this.allowDowngrade = true          // <-- side effect
}
```

`isUpdateAvailable` is the single gate that combines version equality, support checks, rollout, and the downgrade rule:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts  L430-462
private async isUpdateAvailable(updateInfo: UpdateInfo): Promise<boolean> {
  const latestVersion = parseVersion(updateInfo.version)
  if (latestVersion == null) {
    throw newError(`...does not have a valid semver version: "${updateInfo.version}"`, "ERR_UPDATER_INVALID_VERSION")
  }
  const currentVersion = this.currentVersion
  if (isVersionsEqual(latestVersion, currentVersion)) {
    return false
  }
  if (!(await Promise.resolve(this.isUpdateSupported(updateInfo)))) {
    return false
  }
  const isUserWithinRollout = await Promise.resolve(this.isUserWithinRollout(updateInfo))
  if (!isUserWithinRollout) {
    return false
  }
  const isLatestVersionNewer = isVersionGreaterThan(latestVersion, currentVersion)
  const isLatestVersionOlder = isVersionLessThan(latestVersion, currentVersion)
  if (isLatestVersionNewer) {
    return true
  }
  return this.allowDowngrade && isLatestVersionOlder     // L461
}
```

The `isUpdateSupported` path also enforces `minimumSystemVersion` from the manifest:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts  L464-...
private checkIfUpdateSupported(updateInfo: UpdateInfo) {
  const minimumSystemVersion = updateInfo?.minimumSystemVersion
  const currentOSVersion = release()
  ...
}
```

Updater activation (including the dev-time override) is gated on packaging **or** the explicit dev flag:

```typescript
// ts/AppUpdater/src_AppUpdater_ts.ts
// L117
forceDevUpdateConfig = false
// L358-365
public isUpdaterActive(): boolean {
  const isEnabled = this.app.isPackaged || this.forceDevUpdateConfig
  ...
}
```

**Failure-mode / rollback truth (no crash rollback, no health probe):**
- There is no crash-loop detection and no automatic reversion of a previously installed app version. Once NSIS/AppImage/Mac applies a version, the only way back is a subsequent manifest that is newer (or older, only if `allowDowngrade`).
- "Rollout" is purely a *delivery gate* (who is offered the update), not a runtime safety net.
- A bad `stagingPercentage` string logs a warning and degrades to `0` (nobody in rollout) rather than throwing.
- An invalid or missing `.updaterId` is regenerated; this can move a user into a different rollout bucket on file corruption (the id is random each time it is recreated).
- The `x-user-staging-id` header is informational to the server; the *client-side* bucket comparison in `isStagingMatch` is what actually gates delivery in the default configuration.

## A.9  electron-updater — Provider Matrix (Generic / GitHub / PrivateGitHub / GitLab / Bitbucket / Keygen / S3 / custom)

Provider selection is a single switch in `createClient`. The shipped artifact is `out/providerFactory.js`; the recovered source is `ts/providerFactory/src_providerFactory_ts.ts`.

```typescript
// ts/providerFactory/src_providerFactory_ts.ts  (full createClient)
export function isUrlProbablySupportMultiRangeRequests(url: string): boolean {
  return !url.includes("s3.amazonaws.com")
}

export function createClient(data, updater, runtimeOptions): Provider<any> {
  if (typeof data === "string") {
    throw newError("Please pass PublishConfiguration object", "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION")
  }
  const provider = data.provider
  switch (provider) {
    case "github": {
      const githubOptions = data as GithubOptions
      const token = (githubOptions.private ? process.env["GH_TOKEN"] || process.env["GITHUB_TOKEN"] : null) || githubOptions.token
      if (token == null) {
        return new GitHubProvider(githubOptions, updater, runtimeOptions)
      } else {
        return new PrivateGitHubProvider(githubOptions, updater, token, runtimeOptions)
      }
    }
    case "bitbucket":  return new BitbucketProvider(data as BitbucketOptions, updater, runtimeOptions)
    case "gitlab":     return new GitLabProvider(data as GitlabOptions, updater, runtimeOptions)
    case "keygen":     return new KeygenProvider(data as KeygenOptions, updater, runtimeOptions)
    case "s3":
    case "spaces":
      return new GenericProvider(
        { provider: "generic", url: getS3LikeProviderBaseUrl(data), channel: (data as BaseS3Options).channel || null },
        updater,
        { ...runtimeOptions, isUseMultipleRangeRequest: false }   // minio issue 5285
      )
    case "generic": {
      const options = data as GenericServerOptions
      return new GenericProvider(options, updater, {
        ...runtimeOptions,
        isUseMultipleRangeRequest: options.useMultipleRangeRequest !== false && isUrlProbablySupportMultiRangeRequests(options.url),
      })
    }
    case "custom": {
      const options = data as CustomPublishOptions
      const constructor = options.updateProvider
      if (!constructor) {
        throw newError("Custom provider not specified", "ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION")
      }
      return new constructor(options, updater, runtimeOptions)
    }
    default:
      throw newError(`Unsupported provider: ${provider}`, "ERR_UPDATER_UNSUPPORTED_PROVIDER")
  }
}
```

**R2 / Cloudflare note (brief correction):** there is **no** `R2Options` type in electron-updater. R2 is reached by treating it as S3-compatible and using the `s3` (or `spaces`) provider — which the factory folds into `GenericProvider` with `isUseMultipleRangeRequest: false` and a base URL built by `getS3LikeProviderBaseUrl`. So R2 support is inherited, not first-class.

`GenericProvider` resolves the channel file and maps transport errors to specific error codes:

```typescript
// ts/prov_GenericProvider/src_GenericProvider_ts.ts  L24, L30-32
const channelFile = getChannelFilename(this.channel)
...
if (e instanceof HttpError && e.statusCode === 404) {
  throw newError(`Cannot find channel "${channelFile}" update info: ${e.stack || e.message}`, "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND")
} else if (e.code === "ECONNREFUSED") {
  // retry path (connection refused is retried)
  ...
}
```

`GitHubProvider` uses the Atom feed and the `releases/latest` endpoint, and explicitly disables multi-range requests:

```typescript
// ts/prov_GitHubProvider/src_GitHubProvider_ts.ts  (selected lines)
// L27
isUseMultipleRangeRequest: false,
// L60-62  (releases atom feed)
newUrlFromBase(`${this.basePath}.atom`, this.baseUrl),
...
accept: "application/xml, application/atom+xml, text/xml, */*",
// L150
if (e instanceof HttpError && e.statusCode === 404) { ... }
// L237-245  (resolve latest version from release link href)
let latestVersion: string | undefined = undefined
latestVersion = releaseVersionRegExp.exec(latestRelease.element("link").attribute("href"))![1]
latestVersion = semver.valid(latestVersion) ? latestVersion : undefined
if (latestVersion == null) { ... }
```

`PrivateGitHubProvider` (used when a token / `GH_TOKEN`/`GITHUB_TOKEN` is present) adds an auth header and handles redirects manually; `GitLabProvider` includes a `normalizeFilename` workaround for GitLab's URL rewriting and sends a `PRIVATE-TOKEN`; `BitbucketProvider` targets the Bitbucket code API; `KeygenProvider` targets Keygen's update API. All of them subclass the shared `Provider` base (see `ts/prov_Provider`), which centralizes request execution, header merging, and the channel-file URL build.

**Provider matrix (summary, all from recovered source):**

| Provider | Trigger in switch | Auth | Multi-range | Notable error / behavior |
| --- | --- | --- | --- | --- |
| Generic | `generic` | none (or `requestHeaders`) | yes, unless s3.amazonaws.com | 404 → `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`; `ECONNREFUSED` retried |
| GitHub | `github` (no token) | none | **no** | Atom feed + `releases/latest`; 404 → channel-not-found |
| PrivateGitHub | `github` (token / `GH_TOKEN`) | `token <tok>` | **no** | manual redirect handling |
| GitLab | `gitlab` | `PRIVATE-TOKEN` | no | `normalizeFilename` URL-rewrite workaround |
| Bitbucket | `bitbucket` | app password / token | no | Bitbucket code API |
| Keygen | `keygen` | API key | no | Keygen update API |
| S3 / Spaces (→ R2) | `s3` / `spaces` | AWS-style | **no** | folded into Generic; `getS3LikeProviderBaseUrl` |
| custom | `custom` | via `updateProvider` ctor | per-impl | missing ctor → `ERR_UPDATER_INVALID_PROVIDER_CONFIGURATION` |
| (other) | default | — | — | `ERR_UPDATER_UNSUPPORTED_PROVIDER` |

## A.10  electron-updater — Failure-Mode Register & Changelog Availability (no CHANGELOG in tarball)

**Changelog availability (brief correction / constraint):** the published `electron-updater@6.8.11` npm tarball does **not** ship a `CHANGELOG.md`. Both monorepo paths were probed and returned 404 (the OA proxy returns 404 for all of GitHub, and the file is not in the published artifact). Therefore this register is built from **verifiable shipped-code foot-guns** in the extracted artifact + recovered `sourcesContent`, not from upstream release notes.

**Verifiable foot-guns (each is anchored to shipped source):**

1. **Channel implies downgrade.** Setting `channel` silently sets `allowDowngrade = true` (`src_AppUpdater_ts.ts` L163). A team that sets a channel and assumes forward-only updates is wrong; the updater *will* offer an older manifest version if it is on that channel.
2. **S3/R2 multi-range disabled by default.** The `s3`/`spaces` provider hard-sets `isUseMultipleRangeRequest: false` (minio#5285). Resume / parallel-range download behavior on R2 differs from a plain `generic` CDN URL, which *does* use multi-range unless the URL contains `s3.amazonaws.com` (`isUrlProbablySupportMultiRangeRequests`).
3. **`ECONNREFUSED` is retried, other network errors are not** special-cased the same way in `GenericProvider` (L32). Transient proxy `ECONNREFUSED` (common behind the OA proxy) is the one transport error that gets the retry path.
4. **Channel file 404 is a hard, typed failure** (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`), not a "no update" — a mis-named channel or missing `latest.yml` surfaces as an error, not a no-op.
5. **Rollout bucket can shift on id corruption.** If `<userDataPath>/.updaterId` is deleted or corrupted, a *new* random UUIDv5 is generated (`getOrCreateStagingUserId`), moving the user into a different `stagingPercentage` bucket. The id is not derived from a stable hardware/account signal.
6. **`stagingPercentage` NaN degrades to 0** (nobody in rollout) with a warning, not an exception (`isStagingMatch`). A bad manifest percentage silently ships to no one.
7. **No crash rollback / no health probe.** The only "rollback" is a later manifest that is newer (or older if `allowDowngrade`). A broken applied version is not auto-reverted by the engine.
8. **Manifest is plain YAML, not gzipped** (correction). The channel file (`latest.yml` / `<channel>.yml`) is fetched and parsed as YAML directly; `gunzip` in the dependency graph applies to the `.blockmap`/binary artifacts, not the manifest. `sha512` is the integrity field; OS code-signing (Authenticode on Windows) is separate from manifest integrity.
9. **Cache is `getAppCacheDir()`, not `app.getPath('temp')`** (correction) — LOCALAPPDATA on Windows, `~/Library/Caches` on macOS, `~/.cache` on Linux. Stale-download and "disk full" issues land here, not in the temp dir.
10. **The engine does not sign the manifest.** Integrity = `sha512` over the downloaded binary + platform code signature verification (`windowsExecutableCodeSignatureVerifier`); there is no RSA/Ed25519 signature *over the manifest* in electron-updater proper.

More foot-guns, each anchored to shipped source (continues the register above):

11. **The `.blockmap` *is* gunzipped on download** — the blockmap artifact is compressed and decompressed client-side before the block diff is applied. This is the only place `gunzip` touches the update path; it is easy to mis-remember as "the manifest is gzipped" (it is not — A.3). The manifest (`latest.yml`) is always plain text.
12. **`ECONNREFUSED` is the one transport error with a special retry path** in `GenericProvider` (L32); a generic proxy timeout / `ETIMEDOUT` is *not* given the same treatment, so behind the OA proxy a *refused* connection retries while a *hanging* one may surface as a hard failure.
13. **Staged rollout is client-decided in the default config.** `isStagingMatch` does the bucket math locally from `.updaterId`; the server is only *told* the id via the `x-user-staging-id` header. If you rely on server-side cohorting but leave the default `_isUserWithinRollout`, the client-side percentage still gates delivery and the two can disagree.
14. **`forceDevUpdateConfig` is the only way to run the updater in an unpackaged app**, and it is `false` by default (`isUpdaterActive` L358-365). Forgetting it means "check for updates" silently no-ops in dev.
15. **NSIS `perMachine` vs `oneClick` changes the install UX and the update path** (see `NsisUpdater`); a `perMachine` install can require elevation on update, which the silent `downloadUpdate`→`quitAndInstall` flow does not surface until install time.
16. **`checkForUpdatesAndNotify` and `autoInstall` are distinct stages.** `checkForUpdates` only resolves `UpdateInfo`; the download happens on `downloadUpdate` (or via the notify flow). A common bug is checking but never wiring the download/install, so users see "update available" that never installs.
17. **`currentVersion` is read from the running app**, so a mis-declared `version` in `package.json` makes every comparison wrong (equal → "no update"; or, with `allowDowngrade`, a bogus "downgrade"). The engine has no independent version source to cross-check against.
18. **`minimumSystemVersion` is a hard support gate** in `checkIfUpdateSupported`; a manifest that sets it above the user's OS makes `isUpdateAvailable` return `false` silently (no error, no log at info level) — useful for gating, but easy to mis-set and have updates silently stop reaching a whole OS cohort.
19. **The update can be cancelled mid-download** (`cancel()`), but a cancelled/partial NSIS download leaves the cached installer to be re-fetched next time; there is no "resume from byte N" for the installer itself (resume/blockmap applies to the generic file download path, not the OS installer orchestration).

**Re-verify note:** every item above is re-checkable against the extracted `out/*.js` + recovered `ts/*.ts` (jsDelivr `electron-updater@6.8.11`). The upstream CHANGELOG is not in the tarball (404 at both monorepo paths), so this register is intentionally built from shipped code rather than release notes.

## B.1  @capawesome/capacitor-live-update 8.7.1 — Package Metadata (shipped `package.json`)

Literal fields from the published artifact `@capawesome/capacitor-live-update@8.7.1` → `package/package.json` (jsDelivr-verifiable: `https://cdn.jsdelivr.net/npm/@capawesome/capacitor-live-update@8.7.1/package.json`).

```json
{
  "name": "@capawesome/capacitor-live-update",
  "version": "8.7.1",
  "description": "Capacitor plugin to update your app remotely in real-time on Android, iOS and Electron.",
  "main": "dist/plugin.cjs.js",
  "module": "dist/esm/index.js",
  "types": "dist/esm/index.d.ts",
  "unpkg": "dist/plugin.js",
  "files": [
    "android/src/main/",
    "android/build.gradle",
    "android/consumer-rules.pro",
    "dist/",
    "electron/dist/",
    "ios/Plugin/",
    "CapawesomeCapacitorLiveUpdate.podspec",
    "Package.swift"
  ],
  "author": "Robin Genz <mail@robingenz.dev>",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/capawesome-team/capacitor-plugins.git" },
  "dependencies": { "@capawesome/electron-live-update": "^0.1.0" },
  "peerDependencies": {
    "@capacitor/core": ">=8.0.0",
    "@capawesome/capacitor-electron": ">=0.2.0"
  },
  "peerDependenciesMeta": { "@capawesome/capacitor-electron": { "optional": true } },
  "capacitor": {
    "ios": { "src": "ios" },
    "android": { "src": "android" },
    "electron": { "src": "electron" }
  }
}
```

**Interpretation for AIRIZ:**
- Entry points: CJS `dist/plugin.cjs.js`, ESM `dist/esm/index.js`, types `dist/esm/index.d.ts`. The web/PUA stub is `dist/esm/web.js` (all methods throw `UnimplementedError` — see B.9/B.10).
- The **native sources ship in the tarball**: `android/src/main/` (Java) and `ios/Plugin/` (Swift), plus `electron/dist/` (JS for the Capacitor-Electron platform). This is why the native verification/swap logic can be cited from the artifact directly.
- Platform wiring is declared in the `capacitor` block: `ios`/`android`/`electron` each point at their `src`. The Electron platform is an *optional* peer (`@capawesome/capacitor-electron >=0.2.0`, `optional: true`) and a hard dependency on `@capawesome/electron-live-update ^0.1.0`.
- `8.x` maps to Capacitor `>=8.0.0` (peer). `devDependencies` pin `@capacitor/core 8.0.0`, `@capacitor/cli 8.4.2`, `typescript 5.9.3`, `electron 44.5.1`.
- Compatibility table (from shipped `README.md`): `8.x.x → >=8.x.x (Active)`, `7.x.x → Maintenance`, `6.x.x → Maintenance`, `5.x.x → Deprecated`.

## B.2  @capawesome/capacitor-live-update 8.7.1 — Repository / Shipped-File Layout

The monorepo is `capawesome-team/capacitor-plugins`; this plugin lives at `packages/live-update/`. The `files` array in `package.json` (B.1) defines exactly what is published, and it maps onto the monorepo as follows:

| Shipped path (in tarball) | Monorepo path (`packages/live-update/`) | Role |
| --- | --- | --- |
| `android/src/main/` | `android/src/main/` | Java plugin (LiveUpdate, Manifest, ManifestItem, LiveUpdateHttpClient, …) |
| `android/build.gradle` | `android/build.gradle` | Gradle build (declares okhttp, zip4j, coroutines, ionic liveupdateprovider deps) |
| `android/consumer-rules.pro` | `android/consumer-rules.pro` | ProGuard/R8 consumer rules |
| `dist/` | `dist/` (built) | `index.js/.cjs.js`, `esm/index.js`, `esm/web.js`, `esm/definitions.js/.d.ts`, `plugin.json` |
| `electron/dist/` | `electron/dist/` (built) | Capacitor-Electron platform build |
| `ios/Plugin/` | `ios/Plugin/` | Swift `Plugin` + `LiveUpdate.swift` |
| `CapawesomeCapacitorLiveUpdate.podspec` | same | CocoaPods spec (incl. `IonicProvider` subspec) |
| `Package.swift` | same | SPM manifest (incl. `IonicProvider` trait) |
| `README.md`, `LICENSE` | same | Docs / MIT |

**Brief corrections / expected-vs-actual:**
- The brief's expected `ios/Sources/CapacitorLiveUpdate/*.swift` is **not** the shipped layout — the iOS Swift sources ship under `ios/Plugin/` (e.g. `ios/Plugin/LiveUpdate.swift`). The `Package.swift` targets reference the plugin product, but the *files* path is `ios/Plugin/`.
- Android sources are **Java, not Kotlin** in the shipped artifact (`android/src/main/java/com/capawesome/capacitor/liveupdate/*.java`). Kotlin appears only via transitive dependencies (coroutines), not the plugin's own sources.
- There is a first-party **Electron** target (`electron/dist/`, optional peer `@capawesome/capacitor-electron`), which is new/relevant for AIRIZ's desktop surface but is a separate build from the Capacitor web stub.
- `dist/plugin.json` (Capacitor plugin manifest) is present under `dist/` and registers the native plugin name `LiveUpdate` and platform implementations.

Additional layout detail (shipped `package.json` `files` array + `dist/` tree):

- The built JS is published under `dist/`: `plugin.cjs.js` (CJS entry, `main`), `esm/index.js` (ESM, `module`), `esm/index.d.ts` (types), `esm/web.js` + `esm/web.d.ts` (the web stub, see B.9/B.10), `esm/definitions.js` + `esm/definitions.d.ts` (all the option/result/event interfaces), plus `*.js.map` source maps for each (the source of the recovered TS in this report) and `dist/docs.json` (docgen output).
- `electron/dist/` is a **separate rollup build** for the Capacitor-Electron platform (`@capawesome/capacitor-electron`); it is optional (peer `optional: true`) and is what makes the "Electron" column of this report real rather than the stubbed web path.
- The native Android `build.gradle` (shipped) is where the transitive deps are declared — okhttp (`okhttp` + `okhttp-brotli`), `zip4j`, `kotlinx-coroutines-android`, and the `io.ionic:liveupdateprovider` SDK (the latter enabling the Ionic Portals / Federated Capacitor provider role). `consumer-rules.pro` carries the R8/ProGuard keep rules so the plugin survives minification.
- On iOS, both `CapawesomeCapacitorLiveUpdate.podspec` (CocoaPods, with the `IonicProvider` **subspec**) and `Package.swift` (SPM, with the `IonicProvider` **trait**) are shipped, so the same optional Ionic-provider integration is available through either package manager. The trait/subspec are off by default.
- The Capacitor plugin manifest `dist/plugin.json` (referenced by the `files` glob `dist/`) is what the Capacitor CLI reads to register the native plugin name `LiveUpdate` and its platform implementations at `npx cap sync` time (see B.9).
- The `files` array is the **whitelist** for what is published: anything not listed (tests, `example/`, `scripts/`, `rollup.config.mjs`, the raw `android/src` test sources) is excluded from the npm artifact. So the *monorepo* has more than the *tarball* — the tarball is exactly the `files` list.
- Practical consequence for AIRIZ: because the *native sources ship in the tarball*, the signing (B.4), cache (B.5), verification-timing (B.6), swap (B.7), and rollback (B.8) logic cited in this report are all verifiable directly from the npm artifact — no repo access required.

## B.3  @capawesome/capacitor-live-update — Manifest / Bundle Schema

There are **two** distinct manifest shapes, and the brief's "manifest" must be split:

**(a) Self-hosted bundle manifest** — `capawesome-live-update-manifest.json`, a JSON **array** of per-file entries. Each entry is a `ManifestItem`:

```json
[
  { "href": "index.html", "checksum": "<sha256-hex>", "sizeInBytes": 1234 },
  { "href": "assets/app.js", "checksum": "<sha256-hex>", "sizeInBytes": 56789 }
]
```

- Shipped schema source: `android/src/main/java/.../liveupdate/Manifest.java` (parses the array) and `ManifestItem.java` (fields `href`, `checksum`, `sizeInBytes`). The same shape is consumed on iOS.
- Delta updates are computed by diffing the local bundle against this manifest **by checksum** (`findDuplicateItems` / `findMissingItems` in `LiveUpdate.java`): files whose checksum matches are skipped, missing/changed files are downloaded. That is how "delta" works — per-file, checksum-keyed.
- When downloading individual manifest files, the server should return `X-Checksum` (SHA-256 hex) to verify integrity and/or `X-Signature` (signed SHA-256, base64) to verify the signature (see the `url` field doc in B.3 below and `LiveUpdateHttpClient`).

**(b) Capawesome Cloud "latest bundle" descriptor** — the result of `fetchLatestBundle(...)`, interface `FetchLatestBundleResult` (shipped `dist/esm/definitions.d.ts`, recovered `ts_cap_definitions/src_definitions_ts.ts`):

```typescript
// dist/esm/definitions.d.ts  (shipped) / ts_cap_definitions/src_definitions_ts.ts
export interface FetchLatestBundleResult {
  artifactType: "manifest" | "zip"          // 'zip' only on Electron
  bundleId: string | null                    // Cloud build-artifact id; null = no bundle
  channel: string                            // resolved channel (post forced-assignment)  [8.3.0]
  checksum: string                           // self-hosted only; Cloud returns via header
  customProperties: { [key: string]: string }  // [7.0.0]
  downloadUrl: string
  signature: string                          // self-hosted only; Cloud returns via header
}
```

**`DownloadBundleOptions`** (self-hosted `downloadBundle(...)`) shows the `manifest` vs `zip` artifact split and the header contract:

```typescript
// dist/esm/definitions.d.ts (shipped) / ts_cap_definitions/src_definitions_ts.ts
export interface DownloadBundleOptions {
  artifactType?: "manifest" | "zip"    // default 'zip'; 'zip' only on Electron
  bundleId: string                     // 'public' is a reserved value
  checksum?: string                    // SHA-256 hex; 'zip' artifact only  [7.1.0]
  signature?: string                   // signed SHA-256, base64; 'zip' artifact only [7.1.0]
  url: string
  // For 'manifest' artifactType: url is a BASE url; file with href "index.html"
  // is fetched from "<url>?href=index.html". Server SHOULD return X-Checksum
  // (sha256 hex) and/or X-Signature (signed sha256, base64) per file.
}
```

**Key architectural facts for AIRIZ:**
- A bundle = the web asset set; there is a **built-in bundle** (ships in the native binary) plus **downloaded live-update bundles** keyed by `bundleId`. The active bundle is selected by a *pointer* (server base path), not by copying files over the built-in one (see B.7).
- `artifactType: "manifest"` (per-file, delta-capable, header-verified) vs `"zip"` (whole bundle, checksum + signature). Electron supports **only** `zip`.
- Capawesome Cloud returns checksum/signature as **response headers** during download; self-hosted returns them in the manifest / `DownloadBundleOptions`.

---

## B.4  @capawesome/capacitor-live-update — Signing & Integrity (RSA signature XOR SHA-256 checksum)

The integrity model is **either/or**, not both. `verifyFile` branches on whether a `publicKey` is configured: if present, the RSA **signature** is verified and the checksum is ignored; if absent, the **SHA-256 checksum** is verified. There is no code path that verifies both for the same file.

Android (`android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdate.java`):

```java
// LiveUpdate.java  L1633-1654
private void verifyFile(@NonNull File file, @Nullable String checksum, @Nullable String signature) throws Exception {
    String publicKey = config.getPublicKey();
    if (publicKey != null) {
        // Verify the signature
        if (signature == null) {
            throw new Exception(LiveUpdatePlugin.ERROR_SIGNATURE_MISSING);
        }
        boolean verified = verifySignatureForFile(file, signature, publicKey);
        if (!verified) {
            throw new Exception(LiveUpdatePlugin.ERROR_SIGNATURE_VERIFICATION_FAILED);
        }
    }
    // Verify the checksum
    else if (checksum != null) {
        boolean verified = verifyChecksumForFile(file, checksum);
        if (!verified) {
            throw new Exception(LiveUpdatePlugin.ERROR_CHECKSUM_MISMATCH);
        }
    }
}

// LiveUpdate.java  L1628-1631
private boolean verifyChecksumForFile(@NonNull File file, @NonNull String checksum) throws Exception {
    String receivedChecksum = getChecksumForFileAsString(file);
    return checksum.equals(receivedChecksum);
}

// LiveUpdate.java  L1661-1677  (RSA, streaming 2048-byte reads)
private boolean verifySignatureForFile(@NonNull File file, @NonNull String signature, @NonNull PublicKey key) throws Exception {
    try {
        byte[] signatureBytes = Base64.decode(signature, Base64.DEFAULT);
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initVerify(key);
        BufferedSource source = Okio.buffer(Okio.source(file));
        Buffer buffer = new Buffer();
        for (long bytesRead; (bytesRead = source.read(buffer, 2048)) != -1; ) {
            sig.update(buffer.readByteArray());
        }
        source.close();
        return sig.verify(signatureBytes);
    } catch (Exception exception) {
        Logger.error(LiveUpdatePlugin.TAG, exception.getMessage(), exception);
        throw new Exception(LiveUpdatePlugin.ERROR_SIGNATURE_VERIFICATION_FAILED);
    }
}
```

iOS (`ios/Plugin/LiveUpdate.swift`):

```swift
// LiveUpdate.swift  L1103-1133  (same XOR branch)
private func verifyFile(url: URL, checksum: String?, signature: String?) throws {
    if let publicKey = self.config.publicKey {
        guard let signature = signature else { throw CustomError.signatureMissing }
        let verified: Bool
        do { verified = try self.verifySignatureForFile(url: url, signature: signature, publicKey: publicKey) }
        catch { throw CustomError.signatureVerificationFailed }
        if !verified { throw CustomError.signatureVerificationFailed }
    }
    else if let expectedChecksum = checksum {
        let receivedChecksum: String
        do { receivedChecksum = try self.getChecksumForFile(url: url) }
        catch { throw CustomError.checksumCalculationFailed }
        if receivedChecksum != expectedChecksum { throw CustomError.checksumMismatch }
    }
}

// LiveUpdate.swift  L1135-1191  (RSA 2048, PKCS1v15 SHA-256, via Security.framework)
private func verifySignatureForFile(url: URL, signature: String, publicKey: String) throws -> Bool {
    let publicKeyAsBase64 = publicKey
        .replacingOccurrences(of: "-----BEGIN PUBLIC KEY-----", with: "")
        .replacingOccurrences(of: "-----END PUBLIC KEY-----", with: "")
        .replacingOccurrences(of: "\n", with: "")
    guard let publicKeyData = Data(base64Encoded: publicKeyAsBase64) else { return false }
    let publicKeyAttributes: [CFString: Any] = [
        kSecAttrKeyType: kSecAttrKeyTypeRSA,
        kSecAttrKeyClass: kSecAttrKeyClassPublic,
        kSecAttrKeySizeInBits: 2048,
        kSecReturnPersistentRef: true
    ]
    guard let publicKey = SecKeyCreateWithData(publicKeyData as CFData, publicKeyAttributes as CFDictionary, &err) else { return false }
    guard let signatureData = Data(base64Encoded: signature) else { return false }
    // SHA-256 digest of the file (streaming 2048-byte chunks)
    var digestContext = CC_SHA256_CTX(); CC_SHA256_Init(&digestContext)
    let handle = try FileHandle(forReadingFrom: url)
    while autoreleasepool(invoking: { ... CC_SHA256_Update(&digestContext, chunk) ... }) { }
    // final digest + verify
    let signatureAlgorithm = SecKeyAlgorithm.rsaSignatureDigestPKCS1v15SHA256
    let verificationResult = SecKeyVerifySignature(publicKey, signatureAlgorithm, digest as CFData, signatureData as CFData, &err)
    return verificationResult
}
```

**Facts for AIRIZ:**
- The public key is a **PEM-encoded RSA public key** (config `publicKey`, since 6.1.0). iOS hard-constructs it as **RSA 2048** (`kSecAttrKeySizeInBits: 2048`) — a non-2048-bit key will fail `SecKeyCreateWithData`. Android uses the standard `SHA256withRSA` JCA provider (key size inferred from the key).
- Signature is **base64 of a signed SHA-256 digest**; the digest is computed **over the file bytes**, streamed in 2048-byte chunks (not the whole file loaded into memory).
- Because it is XOR, a deployment that sets `publicKey` **cannot also** rely on the per-file `X-Checksum` header — only the signature is enforced.
- Both `zip` and `manifest` artifact types run `verifyFile`; for `manifest` the per-file downloads are each verified against the `X-Checksum`/`X-Signature` headers (see B.3).

## B.5  @capawesome/capacitor-live-update — Cache / On-Disk Layout (Android, iOS, Electron)

**Android** — bundles in app *files* dir (persistent), in-flight downloads in app *cache* dir (may be wiped):

```java
// LiveUpdate.java
// L114-115
private final String bundlesDirectory = "_capacitor_live_update_bundles"; // DO NOT CHANGE!
private final String downloadsDirectory = "capawesome_capacitor_live_update_downloads";
// L661-671
private File buildBundlesDirectory()  { return new File(context.getFilesDir(), bundlesDirectory); }
private File buildBundleDirectoryFor(@NonNull String bundleId) {
    return new File(context.getFilesDir(), bundlesDirectory + "/" + bundleId);
}
private File buildDownloadsDirectory() { return new File(context.getCacheDir(), downloadsDirectory); }
```
So: `<filesDir>/_capacitor_live_update_bundles/<bundleId>/...` and `<cacheDir>/capawesome_capacitor_live_update_downloads/...`.

**iOS** — bundles in Library `NoCloud` (no iCloud backup), downloads in Caches (wiped on low disk / process kill):

```swift
// LiveUpdate.swift
// L10-12  (downloads)
private static let downloadsDirectoryUrl = FileManager.default
    .urls(for: .cachesDirectory, in: .userDomainMask).first!
    .appendingPathComponent("capawesome_capacitor_live_update_downloads")
// L15-17  (delete interrupted downloads once per process)
private static let interruptedDownloadsDeleted: Void = {
    try? FileManager.default.removeItem(at: downloadsDirectoryUrl)
}()
// L20-26
private let bundlesDirectory = "NoCloud/ionic_built_snapshots" // DO NOT CHANGE!
private let defaultWebAssetDir = "public" // DO NOT CHANGE!
private let defaultServerPathKey = "serverBasePath" // DO NOT CHANGE!
private let libraryDirectoryUrl = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first!
private let manifestFileName = "capawesome-live-update-manifest.json" // DO NOT CHANGE!
```
So: `<Library>/NoCloud/ionic_built_snapshots/<bundleId>/...` and `<Caches>/capawesome_capacitor_live_update_downloads/...`. The `NoCloud` placement keeps bundles out of iCloud backup; `public` is the built-in (default) bundle directory inside the app bundle.

**Electron** (from shipped `README.md`): bundles + state stored in a `capawesome-live-update` directory inside the app's `userData`; only the `zip` artifact type is supported; rollback is kill-safe (performed on next start if `ready()` was not called).

**Failure-mode facts for AIRIZ:**
- **Partial downloads are wiped on next launch** (both platforms): the downloads dir is deleted once per process (iOS static `interruptedDownloadsDeleted`; Android `downloadsDirectoryDeleted` AtomicBoolean L90/L164). An interrupted download is not resumed — it must restart. There is no disk-based resume of a half-finished bundle.
- Bundles themselves live in a **persistent** location (files dir / Library NoCloud), so a set-but-not-yet-active bundle survives restarts.
- The `NoCloud` + `public` + `serverBasePath` constants are explicitly marked **DO NOT CHANGE** with dub.sh links — they are the stable pointer targets the swap logic (B.7) depends on. Renaming them silently breaks the swap.

## B.6  @capawesome/capacitor-live-update — Verification Timing (when integrity is checked)

Verification happens **after download, before the bundle is registered** (i.e. before `addBundle` moves it into the bundles dir and before it can be set as next/current). It is synchronous with the download callback chain.

```java
// Android LiveUpdate.java  L835  (inside the download/verify flow, before addBundle)
verifyFile(file, finalChecksum, finalSignature);
```

```swift
// iOS LiveUpdate.swift  L531  (inside downloadBundleFile / per-file manifest path)
try verifyFile(url: file, checksum: checksum, signature: signature)
```

Sequence (zip path, both platforms):
1. Download bundle (zip or per-file manifest) into the **downloads** dir.
2. `verifyFile(...)` — signature (if `publicKey`) XOR checksum (else). A failure throws (`ERROR_SIGNATURE_VERIFICATION_FAILED` / `CustomError.signatureVerificationFailed`, or the checksum-mismatch equivalent) and the bundle is **not** registered.
3. Only after verification passes does the bundle get unzipped/moved into the **bundles** dir (`addBundle` / `addBundleOfTypeZip`).
4. `setNextBundleById` / `sync` then points the server base path at it.

**Facts for AIRIZ:**
- A tampered or corrupted bundle is rejected **before** it can ever become the served bundle — the swap (B.7) only ever points at a verified bundle.
- For the `manifest` artifact type, verification is **per file** (each downloaded file checked against its `X-Checksum`/`X-Signature` header) and again conceptually gates the assembled bundle; for `zip`, it is a single check over the whole archive.
- The `publicKey`/checksum decision is made once from config per `verifyFile` call; it is not mixed within a single file.
- There is no separate "post-apply" integrity re-check — integrity is enforced at ingest, not at serve time.

Additional timing facts (shipped native source):

- The `zip` path verifies the **whole archive in one** `verifyFile` call; the `manifest` path verifies **each downloaded file** as it lands (Android per-file via `downloadBundleFile`/`verifyFile`; iOS `downloadBundleFile` L534 → `verifyFile` L531). So a `manifest` bundle gets N integrity checks (one per file) whereas a `zip` bundle gets one.
- On any verification failure the error is thrown **up the download callback chain** and the in-progress bundle is left in the (wiped-on-next-launch) downloads dir (B.5) — it never reaches `addBundle`, so it can never be set as next/current.
- The checksum/signature source differs by hosting: **self-hosted** bundles carry it in the manifest entries / `DownloadBundleOptions` (`checksum`/`signature`) and per-file `X-Checksum`/`X-Signature` headers; **Capawesome Cloud** returns the same values as response headers during the download (see `FetchLatestBundleResult.checksum`/`signature`, B.3). The client code path (`verifyFile`) is identical either way.
- There is **no re-verification at serve time**. Once a bundle is registered under its id, `setCurrentCapacitorServerPath`/`setNextBundleById` (B.7) will serve it without re-hashing. Integrity is an ingest-time gate only — so a bundle dir that is later tampered with on disk (rooted device / local file access) would not be caught on next launch.

## B.7  @capawesome/capacitor-live-update — Swap Atomicity (pointer change + bridge reload, not file copy)

The "apply" step does **not** copy files over the built-in bundle. It changes which directory the WebView server serves from (a **pointer**), then reloads the bridge. Two distinct operations exist: set the **current** bundle (immediate) vs set the **next** bundle (persisted, applied on next start/reload).

Android:

```java
// LiveUpdate.java  L1456-1463  (current bundle = immediate)
private void setCurrentBundleById(@Nullable String bundleId) {
    if (bundleId == null) {
        setCurrentCapacitorServerPath(defaultWebAssetDir);      // back to built-in "public"
    } else {
        File bundleDirectory = buildBundleDirectoryFor(bundleId);
        setCurrentCapacitorServerPath(bundleDirectory.getPath());
    }
}

// LiveUpdate.java  L1465-1478
private void setCurrentCapacitorServerPath(@NonNull String path) {
    if (plugin == null) { return; }                              // headless mode
    if (path.equals(defaultWebAssetDir)) {
        this.plugin.getBridge().setServerAssetPath(path);        // built-in asset path
    } else {
        this.plugin.getBridge().setServerBasePath(path);         // on-disk bundle dir
    }
    this.plugin.getBridge().reload();                            // <-- applies it
    notifyReloadedListeners();
}

// LiveUpdate.java  L1483-1493  (next bundle = persisted for next start)
private void setNextBundleById(@Nullable String bundleId) {
    if (bundleId == null) {
        setNextCapacitorServerPath(defaultWebAssetDir);
    } else {
        File bundleDirectory = buildBundleDirectoryFor(bundleId);
        setNextCapacitorServerPath(bundleDirectory.getPath());
    }
    notifyNextBundleSetListeners(bundleId);
}
// L1551  (persistence: SharedPreferences-backed Capacitor constant)
this.webViewSettingsEditor.putString(WebView.CAP_SERVER_PATH, path);
```

iOS:

```swift
// LiveUpdate.swift
// L23  (persisted pointer key in UserDefaults)
private let defaultServerPathKey = "serverBasePath" // DO NOT CHANGE!
// L918-921  (current)
setCurrentCapacitorServerPath(path: path)
private func setCurrentCapacitorServerPath(path: String) { ... preferences set serverBasePath ... }
// L931  (next)
private func setNextBundleById(_ bundleId: String?) { ... }
// L389  (bundle install = a single atomic moveItem into the bundles dir)
try FileManager.default.moveItem(atPath: indexHtmlFile.deletingLastPathComponent().path, toPath: bundlePath)
```

**Atomicity facts for AIRIZ:**
- The swap is a **single pointer write** (Android: `WebView.CAP_SERVER_PATH` in the WebView settings / SharedPreferences; iOS: `UserDefaults["serverBasePath"]`) followed by `bridge.reload()`. It is atomic in the sense that the served root flips from the old dir to the new dir in one assignment — there is no partial-state where half the app is the old bundle and half the new.
- The **current** swap is immediate (reload now); the **next** swap is persisted and applied on the next app start or explicit `reload()`. `setNextBundle` + later `reload` is the normal "ship it" path.
- Bundle *installation* (B.5/B.6) is itself a single `moveItem` of the verified, unzipped directory into `_capacitor_live_update_bundles/<id>` (Android) / `NoCloud/ionic_built_snapshots/<id>` (iOS) — so a bundle is either fully present under its id or not at all.
- Reset to default = point the server base path back at `public` (`defaultWebAssetDir`) and reload; no files are deleted (see `autoDeleteBundles`).
- Because the pointer, not the bytes, is what changes, **rollback (B.8) is also just a pointer flip** back to `public` (or a previous verified bundle id) — cheap and non-destructive.

---

## B.8  @capawesome/capacitor-live-update — Rollback / Failure-Mode (ready / reset / rollback / autoBlockRolledBackBundles)

This is the section the brief explicitly says not to skip. The Capacitor engine **does** have a runtime safety net that electron-updater (A.8/A.10) does not: a time-based rollback timer that fires if the app fails to report `ready()` within `readyTimeout` after a bundle is applied. Critically, **auto-rollback is disabled by default** (`readyTimeout = 0`) since 7.0.0.

**The `ready()` contract (Android):**

```java
// LiveUpdate.java  L445-470
public void ready(@NonNull NonEmptyCallback callback) {
    Logger.debug(LiveUpdatePlugin.TAG, "App is ready.");
    if (config.getReadyTimeout() <= 0) {
        Logger.warn(LiveUpdatePlugin.TAG, "Ready timeout is set to 0. Automatic rollback is disabled.");
    }
    stopRollbackTimer();                                  // confirm success -> cancel timer
    if (config.getAutoDeleteBundles()) {
        deleteUnusedBundles();
    }
    String currentBundleId = getCurrentBundleId();
    String previousBundleId = getPreviousBundleId();
    if (config.getAutoBlockRolledBackBundles() && rollbackPerformed && previousBundleId != null) {
        addBlockedBundleId(previousBundleId);             // remember the bad bundle
    }
    ReadyResult result = new ReadyResult(currentBundleId, previousBundleId, rollbackPerformed);
    callback.success(result);
    setPreviousBundleId(currentBundleId);
    rollbackPerformed = false;
}

// LiveUpdate.java  L472-480
public void reload() {
    String path = getNextCapacitorServerPath();
    setCurrentCapacitorServerPath(path);
    startRollbackTimer();                                 // <-- arming the safety net
}
public void reset() {
    setNextBundleById(null);                              // back to built-in "public"
}
```

**The rollback action (pointer flip, non-destructive):**

```java
// LiveUpdate.java  L1411-1426
private void rollback() {
    rollbackPerformed = true;
    String currentBundleId = getCurrentBundleId();
    setPreviousBundleId(currentBundleId);
    if (currentBundleId == null) {
        Logger.debug(LiveUpdatePlugin.TAG, "App is not ready. Default bundle is already in use.");
    } else {
        Logger.debug(LiveUpdatePlugin.TAG, "App is not ready. Rolling back to default bundle.");
        setNextBundleById(null);                          // pointer -> default
        setCurrentBundleById(null);                       // pointer -> default + reload
    }
}
```

iOS is structurally identical (`rollback()` L872-886; `readyTimeout` guard L253-254; `autoBlockRolledBackBundles` L266; `addBlockedBundleId` L948-961 with the same 100-entry cap and oldest-evicted policy).

**Timer lifecycle (pause/resume across app foreground/background):**

```java
// LiveUpdate.java  L435-443
public synchronized void handleOnStart() {
    activityStopped = false;
    resumeRollbackTimer();
}
public synchronized void handleOnStop() {
    activityStopped = true;
    pauseRollbackTimer();
}
// L1574-1579  (scheduling)
rollbackDeadline = SystemClock.uptimeMillis() + delayMillis;
rollbackHandler.postDelayed(() -> { rollbackDeadline = null; rollback(); }, delayMillis);
```

**Failure-mode facts for AIRIZ:**
- **Default is no auto-rollback.** `readyTimeout` defaults to `0`; with `0`, `startRollbackTimer` is a no-op and the engine logs "Automatic rollback is disabled." (Android L447-448, iOS L253-254). You must explicitly set e.g. `10000` to get the safety net. This is the 7.0.0 breaking change.
- The rollback target is the **default (built-in) bundle** (`public`), not "the previous live bundle." `previousBundleId` is tracked (and, with `autoBlockRolledBackBundles`, added to a blocked list capped at 100, oldest evicted) but the rollback itself goes to the built-in bundle.
- Rollback is a **pointer flip** (B.7) — it does not delete or overwrite the faulty bundle's files; it stops serving them. The faulty bundle can be `deleteBundle`'d or auto-deleted.
- The timer **pauses in background** and **resumes in foreground** (so background time does not consume the ready window); on a process *kill* before `ready()`, the persisted "next bundle" + the next-launch timer re-arm the rollback (kill-safe on Electron per README; Android/iOS re-evaluate on start).
- `ReadyResult { previousBundleId, currentBundleId, rollback }` is the only signal that a rollback actually happened — there is no separate "crash" event. The app is responsible for calling `ready()` as early as possible after a successful launch.
- Contrast with electron-updater (A.8): there is **no** time-based revert, no `ready()` contract, no blocked-bundle memory. A bad electron-updater-applied version stays applied until a later (or, if `allowDowngrade`, older) manifest.

## B.9  @capawesome/capacitor-live-update — Plugin Lifecycle & Events (registerPlugin + 3 events)

**Registration** is the standard Capacitor `registerPlugin('LiveUpdate')`. The shipped JS entry (`dist/esm/index.js`) and recovered `ts_cap_index`:

```typescript
// dist/esm/index.js  (shipped) / ts_cap_index (recovered from index.js.map sourcesContent)
import { registerPlugin } from '@capacitor/core';
import type { LiveUpdatePlugin } from './definitions';

const LiveUpdate = registerPlugin<LiveUpdatePlugin>('LiveUpdate', {
  web: () => import('./web').then(m => new m.LiveUpdateWeb()),
});
export * from './definitions';
export { LiveUpdate };
```

The **native plugin is registered by the name `LiveUpdate`** on both platforms:

```java
// android .../liveupdate/LiveUpdatePlugin.java  L40-43, L66-68
@CapacitorPlugin(name = "LiveUpdate")
public class LiveUpdatePlugin extends Plugin {
    public static final String TAG = "LiveUpdate";
    ...
    public static final String EVENT_DOWNLOAD_BUNDLE_PROGRESS = "downloadBundleProgress";
    public static final String EVENT_NEXT_BUNDLE_SET = "nextBundleSet";
    public static final String EVENT_RELOADED = "reloaded";
```

There are **exactly three** events, all fired from native:

```java
// LiveUpdatePlugin.java  L685-695
public void notifyDownloadBundleProgressListeners(@NonNull DownloadBundleProgressEvent event) {
    notifyListeners(EVENT_DOWNLOAD_BUNDLE_PROGRESS, event.toJSObject(), false);
}
public void notifyNextBundleSetListeners(@NonNull NextBundleSetEvent event) {
    notifyListeners(EVENT_NEXT_BUNDLE_SET, event.toJSObject(), false);
}
public void notifyReloadedListeners() {
    notifyListeners(EVENT_RELOADED, event, true);
}
```

Event payload interfaces (shipped `dist/esm/definitions.d.ts` / `ts_cap_definitions`):

```typescript
// ts_cap_definitions/src_definitions_ts.ts
// L992  downloadBundleProgress
export interface DownloadBundleProgressEvent {
  bundleId: string;
  downloadedBytes: number;
  progress: number;        // 0..1
  totalBytes: number;
}
// L1032  nextBundleSet
export interface NextBundleSetEvent {
  bundleId: string | null; // null = default bundle
}
// L1049  reloaded  (no payload)
export type ReloadedListener = () => void;
```

Result interfaces (shipped `definitions.d.ts`): `SyncResult { nextBundleId }` (L967), `ReadyResult { previousBundleId, currentBundleId, rollback }` (L853), `FetchLatestBundleResult` (L588, see B.3), plus the getters (`GetCurrentBundleResult`, `GetNextBundleResult`, `GetChannelResult`, `GetBundlesResult`, `GetVersionCode/NameResult`, `GetDeviceIdResult`, `GetCustomIdResult`, `IsSyncingResult`, `GetConfigResult`, `GetBlockedBundlesResult`, `GetDownloadedBundlesResult`).

**Lifecycle / ordering facts for AIRIZ:**
- The plugin name `LiveUpdate` is what Federated Capacitor / Ionic Portals resolve against (the README "Ionic Live Update Provider SDK Integration" — the provider is resolved by plugin name `LiveUpdate`).
- **`ready()` must be called before `sync()`/any bundle-changing call**, as early as possible after launch; otherwise the `readyTimeout` keeps running during the download and can roll back a bundle that actually works (documented in the shipped README FAQ "In which order should I call ready() and sync()?").
- `reload()` restarts the **web layer only**, not the native process (README). Exclusive-lock resources (IndexedDB, e.g. Firebase offline persistence; WebSockets, service workers) are not released and can hang the new bundle — the README documents `terminate(getFirestore())` before `reload()` as the common fix.
- The `web` implementation (`dist/esm/web.js` / `ts_cap_web`) is a **stub**: every method throws `UnimplementedError` (see B.10) — there is no browser/PWA live-update path in this plugin.
- Lifecycle hooks the native side drives: `handleOnStart`/`handleOnStop` (pause/resume rollback timer, Android L435-443) and the auto-update strategy `background` triggers `performAutoUpdate` on start/resume when the last check was >15 min old (`autoUpdateIntervalMs = 15 * 60 * 1000`, iOS L19).

## B.10  @capawesome/capacitor-live-update — Packaging Reality, Web Stub, & Breaking-Change Register

**Packaging / ecosystem facts:**
- There is **no official `@capacitor/live-update`** on npm. The official Capacitor core does not ship an OTA/live-update plugin. The maintained plugin is the third-party **`@capawesome/capacitor-live-update`** (Capawesome team, MIT), which is the de-facto standard. Any code or doc referencing `@capacitor/live-update` is pointing at a non-existent (or deprecated/unofficial) package.
- The web/PWA surface is **not implemented**: `dist/esm/web.js` (`ts_cap_web`, recovered) defines `LiveUpdateWeb` where each method (`sync`, `downloadBundle`, `setNextBundle`, `ready`, `reset`, `reload`, …) calls `throwUnimplementedError()`. So AIRIZ's **PWA surface cannot use this plugin at all** — it is Android/iOS/Electron only. (Electron is via the separate `@capawesome/capacitor-electron` + `@capawesome/electron-live-update` path.)
- Native sources ship in the tarball (B.1/B.2), which is why the signing/swap/rollback logic above is citable from the artifact.

**Breaking-change / version-history register** (from shipped `README.md` "Since" columns + config table, and the upstream `CHANGELOG.md` at `packages/live-update/CHANGELOG.md` in the `capawesome-team/capacitor-plugins` monorepo — fetched via jsDelivr, since GitHub is unreachable directly):

| Since | Change | Source (shipped artifact) |
| --- | --- | --- |
| 5.0.0 | Core plugin; `appId`, `readyTimeout` (default `0`), `autoDeleteBundles`; `downloadBundle`, `setChannel`, `getDeviceId`, `getVersionCode/Name`, `reset`, `reload`, `sync` | README config table + API `Since` |
| 6.1.0 | **Signing introduced** — `publicKey` (PEM RSA); checksum XOR signature model (B.4) | README config `publicKey` Since 6.1.0 |
| 6.3.0 | `defaultChannel` config | README config table |
| 6.4.0 | `httpTimeout` (default 60000) | README config table |
| 6.6.0 | `fetchLatestBundle(...)`; `DownloadBundleOptions.artifactType` (`manifest`/`zip`); self-hosted `downloadBundle` from arbitrary URL | API `Since` 6.6.0 |
| 6.7.0 | `setNextBundle`, `getCurrentBundle`, `getNextBundle`; `FetchLatestBundleResult` fields | API `Since` 6.7.0 |
| 7.0.0 | **Auto-rollback disabled by default** (`readyTimeout` default stays `0`); `serverDomain` config; `downloadBundleProgress` event; `previousBundleId`/`currentBundleId` in `ReadyResult`; iOS 16.0+ floor (8.0.0) | README config `serverDomain` Since 7.0.0; event Since 7.0.0; L447-448 guard |
| 7.1.0 | **Self-hosted signing** — `DownloadBundleOptions.checksum`/`signature`; per-file `X-Checksum`/`X-Signature` headers for `manifest` type | API `DownloadBundleOptions` Since 7.1.0 |
| 7.3.0 | `autoUpdateStrategy` (`none`/`background`); `autoBlockRolledBackBundles` (cap 100); `nextBundleSet` event | README config + API `Since` 7.3.0 |
| 7.4.0 | Runtime config `setConfig`/`getConfig`/`resetConfig`; `getBlockedBundles`/`getDownloadedBundles`/`isSyncing`/`clearBlockedBundles`; `reloaded` event | API `Since` 7.4.0 |
| 8.0.0 | Requires Capacitor `>=8.0.0`; iOS min 16.0 | package.json peerDeps; README compatibility table |
| 8.2.0 | `fetchChannels(...)` | API `Since` 8.2.0 |
| 8.3.0 | `FetchLatestBundleResult.channel` (resolved/forced channel) | API `Since` 8.3.0 |
| 8.7.1 | Current shipped version (this map) | package.json `version` |

**Implication for AIRIZ's "unified signed-manifest-on-R2" decision:**
- 7.1.0+ already supports **self-hosted bundles from any URL** with **checksum OR RSA signature** and a **per-file manifest with `X-Checksum`/`X-Signature` headers** — i.e. the plugin *already* speaks a signed-manifest protocol that an R2/Cloudflare-Worker relay could serve. No Capawesome Cloud dependency is required for the self-hosted path.
- The plugin's manifest (`capawesome-live-update-manifest.json`, B.3) is **per-file with per-file checksums** (delta-capable), which is a different manifest shape than electron-updater's single-binary `latest.yml` with one `sha512`. A unified layer would need to emit **both** shapes (or pick one engine per surface).
- The PWA surface is unsupported by this plugin — a unified layer must either drop live-update for PWA, add a separate web mechanism, or accept that only Electron/Android/iOS get OTA.

---

# SECTION C — SIDE-BY-SIDE: electron-updater 6.8.11 vs @capawesome/capacitor-live-update 8.7.1

All claims below are anchored to the shipped npm artifacts (jsDelivr-verifiable) and the recovered `sourcesContent`/native sources documented in Sections A and B.

## C.1  What is actually being updated (unit of update)

| Dimension | electron-updater 6.8.11 | @capawesome/capacitor-live-update 8.7.1 |
| --- | --- | --- |
| Unit of update | The **native app binary** (NSIS installer / AppImage / `.app` dmg). Whole-replace. | The **web asset bundle** (HTML/CSS/JS). The native shell is untouched. |
| What changes | Electron + Node + the packaged `app.asar` + native deps | Only the Capacitor web layer (binary-compatible changes) |
| Store round-trip | Bypasses store (direct download + install) | Bypasses store (direct download + pointer swap) |
| Native code changes? | Yes — can ship new native/Electron code | **No** — native changes require a store resubmission (README "Limitations") |
| Applies by | Running the installer / AppImage self-replace / Mac `.app` swap | Pointing the WebView server base path at a new on-disk bundle + `bridge.reload()` |
| Survives as | Replaces the installed app in place | A named bundle dir under `_capacitor_live_update_bundles/<id>` (Android) / `NoCloud/ionic_built_snapshots/<id>` (iOS) |
| "Default" state | The installed app version | The built-in bundle `public` inside the app binary |

**Implication:** these two engines update *different layers*. electron-updater is a **native OTA installer**; Capacitor Live Update is a **web-layer hot-patch**. They are not interchangeable — a "unified" architecture is really "one native updater + one web hot-patcher," which is exactly the (a) "keep electron-updater + bolt Capacitor" option.

**Read-out (evidence-anchored).** The single most important architectural fact is that these are **different layers**, which the source makes unambiguous:

- electron-updater's install path is literally an OS installer: `NsisUpdater` runs the downloaded `installer.exe` / AppImage self-replace / Mac `.app` swap (A.4-A.7). The *unit* that changes is the whole native binary, including the Electron runtime.
- Capacitor's apply path is a WebView server-base-path pointer flip + `bridge.reload()` (B.7); the native process is never restarted and the native shell is never touched. The *unit* that changes is the web asset set.
- The shipped README "Limitations" section states plainly that native changes (e.g. adding a plugin) require a store resubmission — the engine has no mechanism to ship native code, by design.
- Conversely, electron-updater *can* ship new Electron/native code precisely because it replaces the binary — which is also why it carries the heavier install/UX surface (elevation, quit-and-install, A.7).
- "Default state" differs in kind: electron-updater's default is "whatever version is installed on disk"; Capacitor's default is a **specific built-in bundle directory** (`public`, B.5) that always exists inside the app binary and is the guaranteed rollback target.
- Persistence of the update differs: electron-updater overwrites the installed app in place; Capacitor keeps a named bundle dir (`_capacitor_live_update_bundles/<id>` on Android, `NoCloud/ionic_built_snapshots/<id>` on iOS) and just points at it (B.5/B.7).
- Reversibility follows from that: undoing a Capacitor update is a pointer flip to `public` (B.8); undoing an electron-updater update means installing a different binary version (A.8/A.10) — fundamentally heavier.
- Bandwidth profile differs: a desktop "update" is a full Electron binary (tens of MB, delta via blockmap); a mobile "update" is web assets (KB-MB, delta via per-file checksum) (A.3/B.3).
- Failure blast-radius differs: a bad electron-updater version replaces the running app with no built-in revert (A.10); a bad Capacitor bundle is isolated behind a pointer and is the default target of the rollback timer (B.8).
- Store relationship: both bypass the store for their own layer, but only Capacitor is *constrained* to the store for native changes — a hard ceiling on what a "live update" can do there (README).
- For the PWA surface, neither applies as-is: electron-updater is desktop-only; Capacitor's `web.js` is a stub (B.10) — so the "unit of update" for PWA is undefined in both engines.
- Versioning model: desktop is semver-ordered (newer/older, `allowDowngrade`, A.8); mobile is bundle-id-keyed and not inherently version-ordered (reset-to-default is the primitive, B.8).
- This layering is the crux: the two engines are complementary (native OTA installer + web hot-patcher), so a "unified" system is structurally "one of each" = option (a) in the brief.
- Net: you cannot collapse these into one "unit of update" without either giving up desktop binary updates or giving up mobile native-untouched hot-patching.

## C.2  Update descriptor / manifest schema

| Dimension | electron-updater | Capacitor Live Update |
| --- | --- | --- |
| Manifest file | `latest.yml` (or `<channel>.yml`) — **plain YAML** (not gzipped) | (a) Capawesome Cloud descriptor `FetchLatestBundleResult` (JSON); (b) self-hosted `capawesome-live-update-manifest.json` |
| Shape | Single object: `version`, `files[]` (each `{url, sha512, size}`), `sha512`, `releaseNotes`, `path`, `stagingPercentage`, `minimumSystemVersion` | `manifest`: **array** of `{href, checksum, sizeInBytes}` (per-file); Cloud: `{artifactType, bundleId, channel, checksum, customProperties, downloadUrl, signature}` |
| Granularity | One `sha512` per file entry; delta via `.blockmap` (binary block map) | Per-file SHA-256 `checksum`; delta by checksum-diff (`findDuplicateItems`/`findMissingItems`) |
| Delta mechanism | Blockmap-based partial binary download | Per-file: skip files whose checksum matches, download the rest |
| Artifact types | `nsis` / `appimage` / `dmg` (platform) | `manifest` (per-file) / `zip` (whole bundle); **Electron = `zip` only** |
| Channel file 404 | Hard typed error `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND` | `fetchLatestBundle` returns `bundleId: null` (no bundle) |
| Version model | Strict semver (`ERR_UPDATER_INVALID_VERSION` if not) | `bundleId` (opaque, e.g. Cloud build-artifact id) + optional `versionCode`/`versionName` from native |

**Implication:** the manifest shapes are fundamentally different — electron-updater is a **version-keyed single-binary** descriptor; Capacitor is a **bundle-id-keyed per-file** descriptor. A unified signed-manifest layer must emit **two different document shapes** (or normalize one), and the integrity field differs (`sha512` vs `sha256`).

**Read-out (evidence-anchored).** The manifest shapes are not just different in field names — they are different in *granularity and keying*, which drives the whole "can we unify the manifest" question:

- electron-updater keys by **semver version** and describes **one binary per platform** with a single `sha512` + optional `.blockmap` (A.3). It is a *release* descriptor (one row per channel file).
- Capacitor keys by an opaque **`bundleId`** (a Cloud build-artifact id, or a caller-chosen id for self-hosted) and, for the `manifest` artifact type, describes **many files each with its own SHA-256 `checksum`** (B.3). It is a *file-set* descriptor.
- Delta mechanism differs: electron-updater uses a **binary block map** (byte-block reuse across versions of the same file); Capacitor uses **per-file checksum diff** (`findDuplicateItems`/`findMissingItems`, B.3/B.6) — reuse at *whole-file* granularity, not block.
- The integrity hash differs (`sha512` vs `sha256`), so a single unified hash field is not directly portable between the two without recomputation.
- A unified R2 layer therefore must **emit two document shapes** (a `latest.yml`-style release descriptor for the Electron surface, and a `capawesome-live-update-manifest.json` file-set for the Capacitor surfaces) — or commit to normalizing one and accepting the loss (block-delta on desktop, or per-file delta on mobile).
- The 404-vs-null asymmetry matters operationally: a missing desktop channel file is a **hard typed error** (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`), whereas a missing mobile bundle is a **soft no-op** (`bundleId: null`) — different alerting semantics for the same "no update published yet" condition.
- Channel representation differs: desktop channel = a separate YAML file per channel (`latest.yml` / `beta.yml`, A.3/A.9); mobile channel = a parameter (`sync({channel})`) resolved server-side, with a forced-assignment override (B.3, B.9).
- Rollout field differs: desktop carries `stagingPercentage` in the manifest (client-side bucket, A.8); mobile rollout lives in Cloud config (channels / forced assignment), not in the descriptor (B.9/B.10).
- OS/native gating differs: desktop manifest can set `minimumSystemVersion` (A.10); mobile gates by `versionCode`/`versionName` read from the app (B.9 `getVersionCode`), not from the manifest.
- Custom metadata differs: desktop has `releaseNotes`/`path` in the manifest; mobile has `customProperties` on `FetchLatestBundleResult` (B.3) — different extensibility points.
- Wire location differs: desktop manifest is a stable URL you must host (generic/s3/github, A.9); mobile self-hosted manifest is the base URL you pass to `downloadBundle` (B.3), and Cloud uses `fetchLatestBundle`.
- Schema strictness differs: desktop throws on invalid semver (`ERR_UPDATER_INVALID_VERSION`, A.8); mobile is lenient (`null` bundle = no update, B.3).
- Implication for a Worker relay: the Worker can trivially serve both, but it must maintain **two artifact graphs and two hash schemes**; there is no single canonical manifest both clients accept.
- Net: "unified signed-manifest" is achievable as a *serving* layer (one R2 bucket + one Worker) but **not** as a single *schema*; the two clients parse different documents.

## C.3  Signing / integrity model

| Dimension | electron-updater | Capacitor Live Update |
| --- | --- | --- |
| Integrity hash | `sha512` over each downloaded file | SHA-256 per file (`checksum`) |
| Cryptographic signature over manifest | **No** — manifest integrity = `sha512` + trust in HTTPS; the *binary* gets OS code-signing | **Yes (optional)** — PEM RSA public key signs the bundle/file (`publicKey`, since 6.1.0) |
| Signature algorithm | Windows Authenticode over the installer; macOS `codesign`/notarization | Android `SHA256withRSA` (JCA); iOS `SecKeyAlgorithm.rsaSignatureDigestPKCS1v15SHA256`, **RSA 2048** enforced |
| Signature vs checksum | n/a (no signature) | **XOR** — if `publicKey` set, signature is checked and checksum ignored; else checksum |
| Where verified | After download, before install (binary) | After download, before the bundle is registered (`verifyFile`, B.6) |
| Self-hosted verification | `sha512` must match manifest | `X-Checksum` (sha256 hex) and/or `X-Signature` (signed sha256, base64) response headers per file (since 7.1.0) |
| Key management | OS code-signing cert (developer) | PEM RSA keypair (you generate; `publicKey` in app config) |

**Implication:** Capacitor has a **stronger, app-level authenticity story** (RSA signature you control) for the web bundle, whereas electron-updater relies on **OS-level code signing** of the installer. For an R2/Worker relay, the Capacitor self-hosted signature path (7.1.0+) is the one that lets a third party (your Worker) serve bundles that the client cryptographically verifies — the closer fit for a "signed-manifest-on-R2" design.

**Read-out (evidence-anchored).** The signing difference is the most consequential for a "signed-manifest-on-R2" design:

- Integrity hash differs: electron-updater = `sha512` per downloaded file; Capacitor = SHA-256 per file (`checksum`) (B.4).
- App-level signature over the payload: electron-updater = **none** (manifest trust = HTTPS + `sha512`; the *binary* gets OS code-signing); Capacitor = **optional PEM RSA public key** signs the bundle/file (`publicKey`, since 6.1.0) (B.4).
- Signature algorithm differs: electron-updater = Windows Authenticode / macOS codesign+notarization (OS-level, over the installer); Capacitor = Android `SHA256withRSA` (JCA) / iOS `rsaSignatureDigestPKCS1v15SHA256` with **RSA-2048 enforced** (B.4).
- Signature vs checksum: electron-updater n/a (no signature); Capacitor **XOR** — `publicKey` set ⇒ signature checked and checksum ignored, else checksum (B.4).
- Verification point is the same in kind: both verify **after download, before the update can take effect** — electron-updater before install (A.6); Capacitor before the bundle is registered (`verifyFile`, B.6).
- Self-hosted verification: electron-updater `sha512` must match the manifest; Capacitor uses per-file `X-Checksum` (sha256 hex) and/or `X-Signature` (signed sha256, base64) **response headers** (since 7.1.0) (B.3/B.4).
- Key management differs: electron-updater = OS code-signing cert (developer identity); Capacitor = a PEM RSA keypair *you* generate, with the `publicKey` embedded in app config (B.4).
- Authenticity vs integrity: electron-updater gives integrity (`sha512`) + OS-authenticity (code-sign) but **no app-controlled signature over the manifest**; Capacitor gives app-controlled authenticity (RSA) — a stronger "only we can publish" property for the web layer.
- For an R2/Worker relay, Capacitor's 7.1.0+ self-hosted signature path is the one that lets a third party (your Worker) serve bundles the client cryptographically verifies — the closest fit to "signed-manifest-on-R2" in the entire map.
- Trust boundary: electron-updater trusts the *transport* (HTTPS) to protect the manifest, then `sha512` protects the file; an attacker who controls the manifest host can republish a differently-hashed file that still "matches". Capacitor's RSA signature stops that for a signed bundle (attacker would need the private key).
- Key-size portability: Capacitor iOS hard-requires **RSA-2048** (`SecKeyCreateWithData` `kSecAttrKeySizeInBits: 2048`) — a 4096-bit key fails on iOS; Android infers size from the key. electron-updater has no such app-level key constraint (OS code-sign handles it) (B.4).
- Verification coverage: Capacitor `manifest` type verifies per file (N checks); `zip` type verifies the whole archive (1 check) (B.6). electron-updater verifies each file entry's `sha512`.
- No serve-time re-check in either: both verify at **ingest only**; on-disk tampering after registration is not caught (B.6, A.6).
- Net: for a unified design, the *mobile* side has the stronger authenticity primitive (RSA you control); the *desktop* side relies on OS code-signing and would need an added manifest signature (e.g. sign `latest.yml` with a key the app trusts) to reach parity.

## C.4  Rollback / failure-mode (the section the brief flagged as critical)

| Dimension | electron-updater | Capacitor Live Update |
| --- | --- | --- |
| Time-based auto-rollback | **None** | **Yes, but off by default** (`readyTimeout=0` since 7.0.0) |
| `ready()` contract | None | App must call `ready()` early after launch, else rollback fires |
| Rollback target | A later manifest (newer, or older if `allowDowngrade`) | The **built-in default bundle** (`public`) — pointer flip |
| Bad-version memory | None | `autoBlockRolledBackBundles` (cap 100, oldest evicted) |
| Rollback action | Re-install another version | `setNextBundleById(null)` + `setCurrentBundleById(null)` (pointer → default) |
| Crash handling | No crash-loop detection | Timer pauses in background, resumes in foreground; kill-safe (re-arms on next start) |
| Downgrade | Only if `allowDowngrade` (auto-set when `channel` set) | N/A (bundles are not strictly version-ordered; reset to default) |
| Delivery gating (rollout) | `stagingPercentage` + `.updaterId` bucket + `x-user-staging-id` header | Channels + Cloud rollouts / forced channel assignment |
| Bad manifest behavior | `stagingPercentage` NaN → 0 (ships to nobody); invalid semver → throw | `bundleId: null` → no update applied |
| Partial download | Blockmap resume (binary) | **No resume** — downloads dir wiped on next launch; restart from scratch |

**Implication:** Capacitor has a **runtime safety net** (time-based rollback + blocked-bundle memory) that electron-updater fundamentally lacks. electron-updater's only "rollback" is shipping a different manifest version later. For AIRIZ, the desktop surface (electron-updater) is the one **without** a built-in revert safety net — that is the larger operational risk of the two.

**Read-out (evidence-anchored).** The rollback asymmetry is the headline risk for AIRIZ:

- Time-based auto-rollback: electron-updater = **none**; Capacitor = **yes, but off by default** (`readyTimeout = 0` since 7.0.0) (B.8).
- `ready()` contract: electron-updater = none; Capacitor = the app must call `ready()` early after launch or the rollback timer fires (B.8).
- Rollback target: electron-updater = a later manifest (newer, or older if `allowDowngrade`); Capacitor = the **built-in default bundle** (`public`), a pointer flip (B.8).
- Bad-version memory: electron-updater = none; Capacitor = `autoBlockRolledBackBundles` (cap 100, oldest evicted) (B.8).
- Rollback action: electron-updater = re-install another version; Capacitor = `setNextBundleById(null)` + `setCurrentBundleById(null)` (pointer → default) (B.8).
- Crash handling: electron-updater = no crash-loop detection; Capacitor = timer pauses in background, resumes in foreground, and is kill-safe (re-arms on next start) (B.8).
- Downgrade: electron-updater = only if `allowDowngrade` (auto-set when `channel` is set, A.8); Capacitor = n/a (bundles are not strictly version-ordered; reset-to-default is the primitive).
- Delivery gating (rollout): electron-updater = `stagingPercentage` + `.updaterId` bucket + `x-user-staging-id` header; Capacitor = channels + Cloud rollouts / forced channel assignment (A.8, B.9).
- Bad-manifest behavior: electron-updater = `stagingPercentage` NaN → 0 (ships to nobody); invalid semver → throw; Capacitor = `bundleId: null` → no update applied (A.8, B.3).
- Partial download: electron-updater = blockmap resume (binary); Capacitor = **no resume** — the downloads dir is wiped on next launch and the download restarts from scratch (A.5, B.5).
- Reversibility cost: electron-updater undo = heavier (a new install); Capacitor undo = cheap pointer flip + optional `deleteBundle` (B.7/B.8).
- Safety-net asymmetry is the crux: the mobile side has a built-in revert safety net (opt-in via `readyTimeout`); the desktop side has **none**, and approximating it requires a manual "revert channel" + `allowDowngrade` (A.8/A.10).
- Observability: Capacitor surfaces rollback via `ReadyResult.rollback` + the `reloaded`/`nextBundleSet` events (B.9); electron-updater surfaces the update lifecycle via its own events (A.7) but has no "a bad version was reverted" signal.
- Net: for uniform "safe release" semantics across AIRIZ surfaces, the desktop (electron-updater) is the gap — it is the only surface without a built-in revert, and closing it requires app-level logic the engine does not provide.

## C.5  Fit for AIRIZ Motor Console's unified release decision

AIRIZ ships five surfaces: **Electron Windows desktop, Capacitor Android, Capacitor iOS, PWA, Cloudflare Worker relay**. The source-level evidence maps each surface to a concrete engine capability:

| Surface | electron-updater | Capacitor Live Update | Verdict from source |
| --- | --- | --- | --- |
| Electron Windows desktop | ✅ First-class (NSIS) | ⚠️ Via separate `@capawesome/capacitor-electron` + `@capawesome/electron-live-update` (zip-only) | electron-updater is the natural fit; Capacitor-Electron is a newer, thinner path |
| Capacitor Android | ❌ (not an Electron app) | ✅ First-class (Java, full signing/rollback) | Capacitor Live Update only |
| Capacitor iOS | ❌ | ✅ First-class (Swift, RSA-2048, rollback) | Capacitor Live Update only |
| PWA | ❌ | ❌ **`web.js` is a stub — all methods throw `UnimplementedError`** | **Neither engine covers PWA** |
| Cloudflare Worker relay (R2) | ⚠️ Served as `s3`/`spaces`→Generic provider; R2 not first-class | ✅ Self-hosted `downloadBundle(url)` + `X-Checksum`/`X-Signature` headers (7.1.0+) serve straight from any URL | Capacitor's self-hosted signed-manifest path is the closest to a "signed-manifest-on-R2" primitive |

**Decision-relevant conclusions (all evidence-backed):**

1. **Option (a) "keep electron-updater + bolt Capacitor" is source-consistent.** The two engines update different layers and already coexist cleanly: electron-updater for the Electron desktop native binary, Capacitor Live Update for the Android/iOS web layer. There is no code-level conflict. This is the lowest-effort path and matches how the plugins are actually built.

2. **Option (c) "unified signed-manifest-on-R2" is partially already available — but only on the Capacitor side.** Since 7.1.0, Capacitor Live Update can pull a **self-hosted bundle from any URL** and verify it with **`X-Checksum` (sha256) or `X-Signature` (RSA-signed sha256) response headers**, with a **per-file `capawesome-live-update-manifest.json`**. A Cloudflare Worker in front of R2 can serve exactly that. electron-updater, by contrast, needs its own `latest.yml` + `sha512` + `.blockmap` shape and trusts OS code-signing — it has **no app-level signature** to unify. A true unified manifest would require emitting **two document shapes** and two hash schemes.

3. **The PWA gap is decisive for any "unified" claim.** Neither engine does PWA live-update (Capacitor's `web.js` is a stub; electron-updater is desktop-only). If PWA parity matters, option (c) must add a **third** web mechanism (e.g. service-worker-based manifest swap) that neither library provides.

4. **Risk asymmetry.** The Capacitor side carries a built-in rollback safety net (off by default — must set `readyTimeout`); the electron-updater side has **none**. If AIRIZ wants uniform "safe release" semantics, the desktop surface is where the safety net is missing and would have to be built (e.g. a manual "revert to previous manifest" channel + `allowDowngrade`).

5. **Rollout parity.** Both support staged delivery but differently: electron-updater via `stagingPercentage` + client-side `.updaterId` bucketing; Capacitor via channels + Cloud rollouts/forced assignment. A unified R2 layer can drive both by issuing the right header/field per surface, but the client-side cohorting logic differs and cannot be shared.

**Bottom line:** On the evidence, **(a) keep electron-updater + bolt Capacitor Live Update** is the only option that is fully supported by the shipped source for all four native/desktop surfaces, with the explicit, source-confirmed caveats that (i) PWA is uncovered by both, (ii) the desktop surface lacks a built-in rollback safety net, and (iii) a "unified signed-manifest-on-R2" (option c) is achievable **only** for the Capacitor surfaces via the 7.1.0+ self-hosted signed-manifest path and would still need a separate mechanism for PWA and a different descriptor shape for the Electron desktop.
**Per-surface action checklist (evidence-anchored):**

- **Electron Windows desktop** → keep electron-updater (NSIS first-class); set `channel`/`allowDowngrade` deliberately (A.8); add a manual "revert channel" to cover the missing built-in safety net (A.10).
- **Capacitor Android** → Capacitor Live Update (Java, full signing/rollback); set `readyTimeout` (e.g. `10000`) to *enable* the rollback net (B.8); set `publicKey` for authenticity (B.4).
- **Capacitor iOS** → Capacitor Live Update (Swift); use an **RSA-2048** key (iOS enforces 2048, B.4); set `readyTimeout`; watch the `NoCloud/ionic_built_snapshots` dir for disk pressure (B.5).
- **PWA** → uncovered by both; if parity is required, build a separate service-worker manifest-swap; do **not** claim "unified" until this exists (B.10).
- **Cloudflare Worker relay (R2)** → serve **both** artifact graphs: `latest.yml` + `sha512` (+blockmap) for desktop, and `capawesome-live-update-manifest.json` (+`X-Checksum`/`X-Signature` headers) for mobile (C.2/C.3).
- **Option (a) "keep electron-updater + bolt Capacitor"** → lowest effort, fully source-supported for the four native/desktop surfaces, no code-level conflict (C.1).
- **Option (c) "unified signed-manifest-on-R2"** → achievable only for the Capacitor surfaces via the 7.1.0+ self-hosted signed-manifest path; desktop needs a different descriptor + a manifest signature to reach parity (C.2/C.3).
- **Option (b) "migrate to Tauri"** → out of scope for this source map (different runtime); would replace the electron-updater desktop path with `tauri-updater` — not evaluated here.
- **Decision driver** → if PWA parity + uniform rollback matter most, (c) has the most headroom but the most build; if time-to-ship matters most, (a) is the pragmatic default with two known gaps (PWA, desktop rollback).
- **Bottom line restated** → (a) is the only option fully supported by shipped source for all four native/desktop surfaces; (c) is a real path for the mobile/relay half but not yet a single unified schema.