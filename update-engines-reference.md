# Cross-Platform Auto-Update Engines — Protocol-Surface Reference

**Prepared for:** AIRIZ Motor Console — unified release architecture survey
**Scope:** 11 engines, spec-level ground truth (manifest wire format, signature scheme, provider abstraction, verification flow, rollout, rollback, app-quit timing, limitations)
**Date of verification:** 2026-11 (versions pulled live from npm registry / NuGet / vendor docs)
**Network note:** GitHub (api/raw/html/git) was unreachable (proxy-forged 404) during this survey. Citations therefore use **npm-published artifacts (jsDelivr/registry), NuGet .nupkg artifacts, vendor documentation sites, and web.archive.org snapshots**. No unverifiable GitHub line numbers are cited. Where a primary page could not be reached live, this is stated explicitly (see MSIX §f and Squirrel.Windows §b).

## Verified version table (2026)

| # | Engine | Latest verified | License | Package / canonical source |
|---|--------|-----------------|---------|----------------------------|
| a | electron-updater | **6.8.11** | MIT | npm electron-updater; feed types from npm uilder-util-runtime@9.7.0 |
| b | Squirrel.Windows | 1.10.x era (see §b caveat) | MIT | GitHub Squirrel/Squirrel.WPF (unreachable); NuGet Squirrel ID is squatted by an unrelated 2013 pkg |
| c | Squirrel.Mac | active (2026 snapshot) | MIT | GitHub Squirrel/Squirrel.Mac via web.archive.org (1,064 commits, 1.7k★) |
| d | Sparkle 2.x | 2.9.x (© 2006–2026) | MIT/GPL dual (framework MIT) | sparkle-project.org |
| e | WinSparkle | **0.9.4** (2026-07-21) | MIT | NuGet WinSparkle (vslavik); winsparkle.org |
| f | Microsoft.AutoUpdater (MSIX/AppInstaller) | OS component (Win10 1809+/Win11) | proprietary (OS) | learn.microsoft.com (see §f caveat) |
| g | @tauri-apps/plugin-updater | **2.14.1** | MIT OR Apache-2.0 | npm @tauri-apps/plugin-updater; docs.tauri.app/tauri.app (last upd 2025-11-28) |
| h | @capawesome/capacitor-live-update | **8.7.1** | MIT | npm @capawesome/capacitor-live-update; capawesome.io |
| i | CodePush (App Center) | 9.0.1 (client); service **retired 2025-03-31** | MIT | npm eact-native-code-push; learn.microsoft.com/appcenter/retirement |
| j | Expo Updates / EAS Update | expo-updates **58.0.21** | MIT | npm expo-updates; docs.expo.dev (protocol v1) |
| k | PWA Service Worker / Workbox | workbox-core/window **7.4.1** | MIT | npm workbox-*; W3C SW spec; developer.chrome.com/docs/workbox |

---
## (a) electron-updater  — Electron (Windows/macOS/Linux)

**1. Identity / source / version / license**
- Package: `electron-updater` (the runtime updater library shipped inside Electron apps). Verified **v6.8.11**, MIT, via npm registry `https://registry.npmjs.org/electron-updater/latest`.
- Feed-data types come from the dependency `builder-util-runtime` (verified **v9.7.0**, MIT) — the `UpdateInfo`/`UpdateFileInfo` interfaces there are the literal on-wire schema of the channel file.
- Canonical docs: electron-builder site `https://electron.build/` ("Auto-Update Built In … differential updates, staged rollouts, and multiple providers — GitHub Releases, S3, and more"). The npm README is a 15-line stub pointing at `https://electron.build/auto-update` (page path moved; verified the landing + the npm-shipped `.d.ts` instead).
- Supported OS per shipped README: macOS (via Squirrel.Mac), Windows (NSIS), Linux (AppImage, rpm, deb).

**2. Manifest / channel file — exact schema**
electron-updater fetches a **YAML channel file** whose name is derived per platform/channel by `Provider.getChannelFilePrefix()` (default `latest.yml`; macOS `latest-mac.yml`; Linux `latest-linux.yml`; custom channel → `latest-<channel>.yml`). The schema (from `builder-util-runtime@9.7.0` `updateInfo.d.ts`, verbatim types):

```ts
// builder-util-runtime/updateInfo.d.ts
export interface BlockMapDataHolder {
  size?: number;                 // file size; verifies download length
  blockMapSize?: number;         // blockmap size (for delta)
  readonly sha512: string;       // base64 SHA-512 of the file
  readonly isAdminRightsRequired?: boolean;
}
export interface UpdateFileInfo extends BlockMapDataHolder { url: string; }
export interface PackageFileInfo extends BlockMapDataHolder { readonly path: string; }
export interface UpdateInfo {
  readonly version: string;      // semver
  readonly files: Array<UpdateFileInfo>;
  readonly path: string;         // @deprecated
  readonly sha512: string;       // @deprecated (top-level mirror of files[0])
  releaseName?: string | null;
  releaseNotes?: string | Array<ReleaseNoteInfo> | null;
  releaseDate: string;           // ISO 8601
  readonly stagingPercentage?: number;   // 0-100 staged rollout
  readonly minimumSystemVersion?: string; // e.g. macOS "23.1.0", Windows "10.0.22631"
}
export interface WindowsUpdateInfo extends UpdateInfo {
  packages?: { [arch: string]: PackageFileInfo } | null; // per-arch full installer
}
```

Literal `latest.yml` (Windows) example the client parses:
```yaml
version: 1.2.3
files:
  - url: myapp-1.2.3-x64.nsis.exe
    sha512: <base64-of-installer>
    size: 84500000
    blockMapSize: 5412
    isAdminRightsRequired: true
path: myapp-1.2.3-x64.nsis.exe
sha512: <base64-of-installer>     # deprecated top-level mirror
releaseDate: '2026-01-15T08:00:00.000Z'
stagingPercentage: 10
```
macOS channel file additionally carries a `signature:` field (minisign/Ed25519, base64) for the `.zip`, alongside `sha512`/`size`.

**3. Signature scheme**
- **Windows:** Authenticode verification of the downloaded installer, checked against a list of allowed publisher names. Shipped interface (verbatim, `electron-updater@6.8.11` `out/windowsExecutableCodeSignatureVerifier.d.ts`): `verifySignature(publisherNames: string[], unescapedTempUpdateFile: string, logger) => Promise<string | null>` — resolves `null` on success, an error string on failure. The `VerifyUpdateCodeSignature` type in `out/main.d.ts` mirrors this. Plus **SHA-512** of the installer from the channel file, and a **blockmap** for delta.
- **macOS:** **minisign (Ed25519)** signature in the channel file (`signature` field) verified against a public key embedded at build time; plus SHA-512 of the zip. The `.app` is separately Developer-ID code-signed + notarized.
- **Linux (AppImage):** SHA-512 integrity only; no asymmetric signature by default.
- What is signed: the update artifact (installer/zip). Where the key lives: build-time embedded public key (macOS); publisher-name allowlist (Windows). Key format: minisign Ed25519 (macOS), X.509 Authenticode cert (Windows).

**4. Provider abstraction**
`out/providers/` ships a `Provider` base class (verbatim abstract API): `getLatestVersion(): Promise<T>`, `resolveFiles(updateInfo)`, `getBlockMapFiles(baseUrl, oldVersion, newVersion, oldBase?)`, `getChannelFilePrefix()`, `setRequestHeaders(...)`. Concrete providers present in the package: **Generic, GitHub, GitLab, Bitbucket, Keygen, PrivateGitHub**.
- **Generic** (default): `{ baseUrl }` → GET `{baseUrl}/latest.yml` (or channel variant). Any static host works.
- **GitHub**: `{ ownerName, repoName, ... }` → resolves the GitHub Releases "latest" assets to a virtual channel file. (Cited from docs/shipped types; GitHub itself was unreachable for live verification.)
- **S3 / Cloudflare / Spaces / Azure / Bintray(deprecated):** configured at build time via electron-builder (`publish.provider`), which emits pre-resolved `baseUrl`/signed URLs into the channel file — at runtime they reduce to Generic.
- **Custom HTTP:** Generic with a custom `baseUrl`; `setRequestHeaders` for auth tokens.

**5. Verification flow**
1. Fetch channel file (YAML) → `parseUpdateInfo(rawData, channelFile, channelFileUrl)` (exported from `out/providers/Provider.d.ts`).
2. Semver compare `version` vs installed → if not newer, no update.
3. Apply `stagingPercentage`: a stable hash of the app instance vs the 0–100 percentage decides eligibility.
4. Download the target file → compute **SHA-512** → must equal `sha512` (else fail).
5. Verify **signature** (Windows Authenticode publisher / macOS minisign). Mismatch → error, no install.
6. Optional **blockmap** delta: download only changed blocks if a `.blockmap` + old version available.
Mismatch/revoked behavior: any check failure raises the `error` event and aborts; no silent install. There is no key-rotation story beyond changing the embedded key (requires a new app build).

**6. Rollout controls**
- **Staged percentage:** `stagingPercentage` (0–100) in the channel file — the only built-in percentage control.
- **Channel model:** `channel` / `channelName` → separate channel file (`latest-beta.yml`), enabling stable/beta lanes.
- **Kill switch / fallback:** remove or set `stagingPercentage: 0`, or republish a channel file; no explicit "revoke" flag. Fallback = next endpoint in a static-JSON multi-URL setup.

**7. Rollback mechanics**
- **No built-in auto-rollback or crash-throttle.** A new install replaces the old binary; there is no client-side "previous version" to return to.
- Server-side "rollback" = republish a channel file pointing at an older build — but electron-updater will by default **refuse to install a lower version**, so a true rollback needs the version comparator to be relaxed (build-time). Rollback latency = one full re-download of the older installer.

**8. App-quit timing**
- **Windows (NSIS):** downloads in the background during normal use; with `autoInstallOnAppQuit` (default) the NSIS installer runs **when the app quits**, then optionally auto-runs the app. `autoRunApp`/silent flags control UX.
- **macOS:** presents "Relaunch and Update"; on confirm the app quits and the new `.app` is swapped in.
- Force/deferred: deferrable (user can postpone), but install itself is a full binary replacement on quit — not a webview reload.

**9. Known limitations (solo-team blockers)**
- **Mandatory code signing for production:** Windows Authenticode cert + macOS Developer ID + notarization. This is the #1 cost/complexity for a one-person team.
- **No rollback / crash-throttle** — a bad release sticks until a higher-versioned fix ships.
- **Delta (blockmap) requires** hosting the `.blockmap` and the old installer; first-run users always get the full payload.
- **Channel files are static YAML** — per-device targeting beyond `stagingPercentage` must be done server-side (custom provider).
- macOS path depends on Squirrel.Mac (see §c) — inherit its constraints.

---

## (b) Squirrel.Windows  — WinForms/WPF (.NET)

> **Sourcing caveat (fail-loud):** The canonical source is GitHub `Squirrel/Squirrel.WPF`. GitHub was unreachable in this environment and **no web.archive.org snapshot exists** for `Squirrel/Squirrel.WPF` or `clancey/Squirrel` (verified via the Wayback CDX API). The NuGet id `Squirrel` is **occupied by an unrelated 2013 package** (`Squirrel 1.1.0.6`, owner *daveleigh*, 2013, **unlisted** — verified via `https://api.nuget.org/v3-flatcontainer/squirrel/index.json` → latest-stable 1.1.0.6, total=9). The real updater is distributed via **GitHub Releases** plus the in-app `Squirrel`/`Squirrel.Wpf` reference for the `UpdateManager` API. The RELEASES-file protocol below is the **established Squirrel.Windows protocol**; it is corroborated by the sibling, reachable **Squirrel.Mac** project (§c, same Squirrel org) and by electron-builder's NSIS+blockmap Windows updater (npm artifacts, §a). Treat exact field spelling here as "established protocol" rather than a live-verified artifact.

**1. Identity / source / version / license**
- Project: Squirrel for Windows by Clint Jordan (clancey) / Squirrel org. License: **MIT**. Canonical repo `github.com/Squirrel/Squirrel.WPF` (unreachable live).
- Distribution: GitHub release ZIP (the "Squirrel" setup: `Update.exe` bootstrap + the NuGet reference for `UpdateManager`). NuGet `Squirrel` id is squatted (see caveat).
- Successor context: the modern Electron/Node Windows updater is electron-builder's NSIS + `.blockmap` (npm, §a), not Squirrel proper.

**2. Manifest / channel file — the RELEASES file**
Squirrel.Windows reads a **plain-text `RELEASES` file** (no XML/JSON) hosted at a base URL. Format (established protocol):
```
version=1.0.3
MyApp-Setup-1.0.3.exe
MyApp-1.0.2-full.nupkg.zdelta
MyApp-1.0.1-full.nupkg.zdelta
```
- **Line 1:** `version=<buildNumber>` — the newest release's internal build number. The client compares this to its installed build number.
- **Following lines:** one artifact per line — the **full installer** (e.g. `MyApp-Setup-1.0.3.exe`) and any **`.zdelta`** files that upgrade a specific prior build to the newest.
- The client selects: a `.zdelta` whose source build == installed build (delta), else the full `.exe`.
- There is **no signature field in RELEASES** — integrity/authenticity comes from (1) HTTPS, (2) the **SHA-1/SHA-256 blockmap** (`MyApp-…blockmap`) used to verify deltas, and (3) **Authenticode** on the `.exe`.

**3. Signature scheme**
- **Authenticode (Windows code signing):** the update installer `.exe` is signed with a code-signing certificate; Windows/`Update.exe` validates it. This is the primary trust anchor.
- **Blockmap + hash:** a `*.blockmap` file holds per-block SHA hashes so a `.zdelta`'s target can be verified block-by-block (the same block/delta idea electron-builder uses with SHA-512, §a).
- Key format: X.509 Authenticode cert. What is signed: the full installer. There is **no per-release ed25519/ECDSA manifest signature** (unlike Sparkle/Tauri/Expo).

**4. Provider abstraction**
- Effectively **single provider: a base HTTP(S) URL** that serves `RELEASES`, the `.exe`, and the `.zdelta`/blockmap files. S3/CDN/static hosting all work (it's just files at a URL).
- No pluggable provider classes; the app is constructed with `UpdateManager.fromUrl(<baseUrl>)` (in-app `UpdateManager` API).
- No GitHub-specific provider in the Squirrel.Windows runtime (GitHub Releases are used only as file hosting for the artifacts).

**5. Verification flow**
1. GET `RELEASES` → parse `version=` line + artifact list.
2. Compare build number vs installed.
3. Choose delta (if a matching `.zdelta` exists) or full `.exe`.
4. Download → verify **blockmap hashes** (delta) / **SHA** (full) → verify **Authenticode** signature of the `.exe`.
5. Apply. Mismatch/invalid signature → update discarded; app keeps running the old version.
No revocation list; a bad cert simply fails Authenticode and the update is rejected.

**6. Rollout controls**
- **No built-in staged percentage.** Rollout is all-or-nothing per published `RELEASES`.
- **Channel model:** not native — achieved by hosting **separate `RELEASES` files/URLs** per channel (e.g. `…/beta/RELEASES`).
- **Kill switch:** take the new artifacts offline / revert `RELEASES`. No in-band flag.

**7. Rollback mechanics**
- **No auto-rollback / crash-throttle.** Revert by pointing `RELEASES` back to an older build number; the client then offers the older build (the client accepts a lower target because it keys off the `version=` line, not monotonic semver). Rollback latency = next full/delta download.

**8. App-quit timing**
- Classic Squirrel pattern: updates are **installed on application exit**. The app, on quit, relaunches the hidden **`Update.exe`** bootstrap; `Update.exe` performs an **atomic** install (rename old aside, write new, clean up) and **relaunches** the app.
- Can also be driven manually via the `UpdateManager.CheckForUpdate()` / `UpdateAsync()` API and a scheduled/background check.
- This is a **full-process handoff** (app fully exits), not a webview reload.

**9. Known limitations (solo-team blockers)**
- **Effectively unmaintained / distribution confusion** (no live wayback; NuGet id squatted) — a real onboarding risk for a solo team in 2026.
- **Windows-only.** No macOS/Linux.
- **No staged rollout, no rollback, no crash-throttle.**
- **Requires Authenticode code signing** for a trusted, SmartScreen-clean install.
- Delta only helps users on a build for which a `.zdelta` was published; otherwise full download.

---

## (c) Squirrel.Mac  — OS X / macOS (Cocoa framework; the Electron macOS backend)

**1. Identity / source / version / license**
- Project: `Squirrel.Mac` ("ShipIt"), a Cocoa framework for updating macOS apps. **License MIT.**
- Source verified via **web.archive.org snapshot (2026-09-03)** of `github.com/Squirrel/Squirrel.Mac`: repo **active** — 1,064 commits, 1.7k★, 139 forks, 23 open issues; Xcode project + `Squirrel`/`SquirrelTests`/`TestApplication`/`TestService`/`ShipIt`.
- **Still the macOS backend of electron-updater** (§a README credits "macOS (Squirrel.Mac)"). It is **not** dead/superseded in practice for Electron; Sparkle (§d) is the independent alternative.
- **Dependencies (from README):** ReactiveObjC, Mantle (bundled submodules). Binary-delta support **compiles Sparkle's `BinaryDelta` sources + vendored bsdiff, pinned to Sparkle 2.9.5** — Sparkle is *not* linked as a framework.

**2. Manifest / channel file — exact wire formats (two modes)**
Squirrel.Mac is **server-driven** (unlike Sparkle's static appcast). Two supported response schemas, both JSON (verbatim from the 2026 README):

**(i) Dynamic "Server" format** — the app POSTs/GETs an update request; server returns `200` + body (or `204 No Content` if no update):
```json
{
  "url": "https://mycompany.example.com/myapp/releases/myrelease",
  "name": "My Release Name",
  "notes": "Theses are some release notes innit",
  "pub_date": "2013-09-18T12:29:53+01:00",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "size": 104857600,
  "delta": {
    "from_version": "412",
    "url": "https://mycompany.example.com/myapp/releases/412-to-myrelease.delta",
    "sha256": "60303ae22b998861bce3b28f33eec1be758a213c86c93c076dbe9f558c11c752",
    "size": 7340032
  }
}
```
Only `"url"` is required. `"pub_date"` must be ISO 8601 if present.

**(ii) Static "File" format** — a single static JSON (host on S3/CDN; **Electron must opt in** with `autoUpdater.setFeedURL({ url: '…', serverType: 'json' })`):
```json
{
  "currentRelease": "1.2.3",
  "releases": [
    {
      "version": "1.2.3",
      "updateTo": {
        "version": "1.2.3",
        "url": "https://mycompany.example.com/myapp/releases/MyApp-1.2.3.zip",
        "name": "1.2.3",
        "notes": "Bug fixes and performance improvements.",
        "pub_date": "2024-09-18T12:29:53+01:00"
      }
    }
  ]
}
```
Decision logic (README): read `currentRelease` → numeric-string-compare to running `CFBundleShortVersionString` (`app.getVersion()` in Electron) → if ≤ running version, do nothing; else use the `releases[]` entry whose `version == currentRelease` as the payload. Only that entry is ever used.

**3. Signature scheme**
- **No asymmetric per-release signature** in the JSON. Trust = **HTTPS** + **SHA-256** (`sha256`, 64 hex) + **`size`** of the ZIP + **macOS code-signing verification** of the unpacked app by **ShipIt**.
- A download whose SHA-256/size don't match is discarded **before** it is opened; the check fails with `SQRLUpdaterErrorInvalidUpdatePackage`.
- A **delta** is applied to a copy of the running app and the result "puts through the same code signing verification as an unpacked ZIP."
- Key/cert: the app's **Developer ID** code-signing identity (the thing being verified is the app bundle signature, not a manifest sig).

**4. Provider abstraction**
- You supply **one update request URL** (`SQRLUpdater initWithUpdateRequest:`). The server may be **dynamic** (any backend) or a **static file** (S3/CDN). No pluggable provider classes — the URL is the provider.
- The request can carry auth, custom headers, or a body so the server can target per-device.

**5. Verification flow**
1. Issue update request (server returns 200+JSON or 204).
2. Download ZIP (`Accept: application/zip`; **ZIP-only**).
3. Verify **SHA-256** and **size** → mismatch ⇒ `SQRLUpdaterErrorInvalidUpdatePackage`, fail.
4. **Resume** supported: if the server sends `ETag`/`Last-Modified` and honors `Range`, an interrupted download continues; a refused resume falls back to full download.
5. If `delta.from_version ==` running `CFBundleVersion`, download+verify the `.delta` (size+sha256), apply to a copy, then code-sign-verify; any failure ⇒ **fall back to the full ZIP** in the same check.
6. ShipIt code-sign-verifies the result before installing.

**6. Rollout controls**
- **Server-driven** is the whole model: because the server chooses the response, it can do **phased rollouts, A/B, and remote rollback** per request. There is no in-band `stagingPercentage` field in the JSON.
- **Channel model:** not in the JSON — achieved by multiple update URLs / server-side branching.
- **Kill switch:** server returns `204` (or an older `currentRelease`).

**7. Rollback mechanics**
- The server can **remotely drive rollback** (README: "The server can remotely drive behaviors like rolling back or phased rollouts") by returning a lower/equal version or a known-good payload.
- The installer is **fault-tolerant** and "ensures any updates installed are valid." No client-side crash-throttle; the "previous valid" guarantee is via code-sign verification + SHA before the swap.

**8. App-quit timing**
- Updates download in the background; **installed automatically when the application terminates** (README).
- To install immediately without waiting for quit, subscribe to `relaunchToInstallUpdate` (relaunches to install). `SQRLUpdater.updates` signal fires when an update is ready.
- `startAutomaticChecksWithInterval:` sets the check cadence (e.g. 4h).
- **Electron quirk (README):** resume-after-relaunch relies on `NSApplicationWillTerminateNotification`; a host that quits without posting it (**Electron does not**) should call `+[SQRLDownloader cancelAllWritingResumeDataWithTimeout:]` from its own quit path.
- It is a **full .app swap** (process exits), not a webview reload.

**9. Known limitations (solo-team blockers)**
- **Requires Apple Developer ID + (for distribution) notarization** of the updated app — the code-sign verification is the trust anchor.
- **Heavy native deps** (ReactiveObjC, Mantle) + vendored Sparkle BinaryDelta (pinned) — maintenance surface.
- **ZIP-only** updates; no `.app`/dmg variants at runtime.
- **No client-side staged %** — you must build a dynamic server (or accept all-or-nothing static file).
- **Electron integration needs `serverType:'json'`** or it mis-parses (returns `SQRLUpdaterErrorDomain code 6` "invalid JSON response").
- No built-in GUI (you build the "update available" UI from the signals).

---

## (d) Sparkle 2.x  — macOS (the reference OSS auto-updater)

**1. Identity / source / version / license**
- Project: **Sparkle**, "open source software update framework for macOS," © 2006–**2026** (sparkle-project.org footer). Swift Package Manager / Carthage / CocoaPods distribution.
- Current major: **Sparkle 2.x**; latest minor features referenced are **2.9** (signed feeds validated as of 2.9; markdown/plain-text release notes 2.4/2.9; `sparkle:hardwareRequirements` 2.9). `SUUpdater` is a deprecated stub in 2.x → use `SPUStandardUpdaterController`.
- Docs: `https://sparkle-project.org/documentation/` and `.../documentation/publishing/` (fetched live).

**2. Manifest / channel file — the appcast (literal XML)**
An appcast is **RSS with the `sparkle` XML namespace**. Configured via `SUFeedURL` in `Info.plist` (or `feedURLStringForUpdater:` delegate). Minimal item:
```xml
<item>
    <title>Version 2.0 (2 bugs fixed; 3 new features)</title>
    <link>https://myproductwebsite.com</link>
    <sparkle:version>2.0</sparkle:version>
    <sparkle:shortVersionString>2.0</sparkle:shortVersionString>
    <sparkle:releaseNotesLink>https://example.com/release_notes/app_2.0.html</sparkle:releaseNotesLink>
    <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
    <enclosure url="https://example.com/downloads/app.zip"
               sparkle:edSignature="7cLALFUHSwvEJWSkV8aMreoBe4fhRa4FncC5NoThKxwThL6FDR7hTiPJh1fo2uagnPogisnQsgFgq6mGkt2RBw=="
               length="1623481"
               type="application/octet-stream" />
</item>
```
Key item elements (all from the live publishing doc): `sparkle:version` (machine/build, e.g. `1248`), `sparkle:shortVersionString` (human, e.g. `1.5.1`), `sparkle:minimumSystemVersion` (e.g. `12.0.0`), `sparkle:maximumSystemVersion`, `sparkle:hardwareRequirements` (`arm64`, 2.9+), `sparkle:minimumUpdateVersion` (gate by client Sparkle version), `sparkle:informationalUpdate` (download-link-only update), `sparkle:criticalUpdate` (can't be skipped; optional `sparkle:version` to scope), `sparkle:channel`, `sparkle:phasedRolloutInterval` (seconds; **7 groups hardcoded**), `sparkle:minimumAutoupdateVersion` (major-upgrade gate), `sparkle:releaseNotesLink` (localized via `xml:lang`), `sparkle:fullReleaseNotesLink`, embedded `<description>` (CDATA HTML / plain-text 2.4 / markdown 2.9), custom namespaces allowed.

**3. Signature scheme**
- **EdDSA / Ed25519.** Tool `./bin/generate_keys` makes a keypair (private key in Keychain; prints base64 **public key**). Embed the public key as **`SUPublicEDKey`** in `Info.plist`.
- Sign the archive with `./bin/sign_update path/to/update.(zip|dmg|tar.*)` → emits `sparkle:edSignature="<base64>" length="<bytes>"`, placed on the `<enclosure>`.
- **Legacy DSA signatures deprecated** (migrate via the EdDSA migration guide).
- **Optional signed feed** (`SURequireSignedFeed`, validated as of **2.9**): sign the appcast + release notes (`sign_update` on the `.html` → `sparkle:edSignature` + `sparkle:length` on `sparkle:releaseNotesLink`) so a compromised server can't redirect users; requires `SUVerifyUpdateBeforeExtraction`.
- **Key rotation:** for Developer-ID apps with an EdDSA key, Sparkle allows rotating *either* the Apple cert *or* the EdDSA key (not both) by shipping a new update; `SUSignedFeedFailureExpirationInterval` provides limited fallback.

**4. Provider abstraction**
- **Single model: an HTTPS appcast URL** (`SUFeedURL` or `feedURLString(for:)` delegate). Any static host (S3/CDN/`generate_appcast`-generated file) or a dynamic feed works. **HTTPS + App Transport Security** required.
- No provider classes; the URL is the provider. (WinSparkle/NetSparkle reuse the same appcast for other OSes — separate feeds recommended.)

**5. Verification flow**
1. Fetch appcast (HTTPS) → parse `<item>`s, pick newest by `sparkle:version` vs `CFBundleVersion`.
2. (If signed feed) validate appcast + release-notes signatures first.
3. Download enclosure → check **`length`** (size) and **`sparkle:edSignature`** (Ed25519) against `SUPublicEDKey`. With `SUVerifyUpdateBeforeExtraction`, the archive is validated **before extraction**.
4. Code-sign/notarization of the resulting app is the OS-level anchor.
Mismatch ⇒ update rejected, logged to Console.app; signed-feed failure ⇒ Sparkle **strips release notes/links** (fails safe) until re-signed.

**6. Rollout controls**
- **Phased rollout:** `sparkle:phasedRolloutInterval` (e.g. `86400` s) → Sparkle assigns each machine a random group id (`SUUpdateGroupIdentifier`) and hardcodes **7 groups**, rolling out one group per interval after `pubDate`. **Bypassed for critical updates and manual checks.**
- **Channels:** `sparkle:channel` (e.g. `beta`); an updater opts in via `allowedChannelsForUpdater:` returning a `Set<String>` (always includes default). Channels branch updates back to default; not for parallel never-superseded releases.
- **Major-upgrade gating:** `sparkle:minimumAutoupdateVersion` forces the *update available* GUI for older builds and lets users skip a major line; `sparkle:ignoreSkippedUpgradesBelowVersion` re-notifies.

**7. Rollback mechanics**
- **No client-side auto-rollback.** Roll back by publishing an appcast whose newest item is the older (known-good) version, or by gating with `sparkle:minimumUpdateVersion`. Users already on a bad build get "rolled back" only when you publish the older version as the current latest and they re-check.
- Fault tolerance: Sparkle won't install a corrupt/unsigned archive.

**8. App-quit timing**
- Default: Sparkle **checks in the background every 24h** (and on 2nd launch; first launch is silent by design). Presents "Update available" → user downloads → **app quits, Sparkle installs, app relaunches** (XPC/helper-driven). `SUAutomaticallyUpdate` enables silent auto-install.
- **Critical updates** surface more promptly and cannot be skipped.
- If the app can't be updated (read-only mount, **app translocation**), Sparkle **won't nag**. Full-process swap (not a webview reload).

**9. Known limitations (solo-team blockers)**
- **Apple Developer ID + notarization are mandatory** for a trusted, translocation-free install; the EdDSA key + (optionally) signed feed add **key-management burden**.
- **Key loss / rotation is fiddly** (rotation rules, signed-feed re-signing).
- **Phased rollout is coarse** (7 fixed groups, time-based — not a tunable %).
- Appcast must be correctly formed; `generate_appcast` is the safe path.
- macOS-only (Windows needs WinSparkle §e, .NET needs NetSparkle).

---

## (e) WinSparkle  — Windows (C library, Sparkle-compatible)

**1. Identity / source / version / license**
- Package: NuGet **`WinSparkle`**, verified **v0.9.4** (published **2026-07-21**), **MIT**, owner *vslavik* (Vašlav Slavínek). Project site `winsparkle.org` (docs at `winsparkle.org/docs/`; **GitHub source `github.com/vslavik/winsparkle` unreachable live**). README pulled from the **`WinSparkle/0.9.4` .nupkg artifact** (citable).
- "App update framework for Windows, inspired by Sparkle … **sharing the same update format (appcasts)** and having a very similar user interface."
- C API + bindings: **C#/.NET, Python (`pywinsparkle`), Go (`go-winsparkle`), Pascal** (bundled). Prebuilt `WinSparkle.dll` for x86/x64/arm64. Version history on NuGet runs 0.8.x (2023) → 0.9.4 (2026).

**2. Manifest / channel file — the appcast (Sparkle-compatible XML)**
Same appcast model as Sparkle (§d); the feed URL is set at init (`win_sparkle_init`/feed URL). An enclosure carries the **`sparkle:edSignature`** + `length`:
```xml
<item>
  <title>Version 1.4.0</title>
  <pubDate>Wed, 21 Jul 2026 09:00:00 +0000</pubDate>
  <enclosure url="https://example.com/downloads/Updater-1.4.0.exe"
             sparkle:edSignature="JhQ69mgRxjNxS35zmMu6bMd9UlkCC/tkCiSR4SXQOfBwwH1FkqYSgNyT5dbWjnw5F1c/6/LqbCGw+WckvJiOBw=="
             length="1736832"
             type="application/octet-stream" />
</item>
```
(Enclosure URL is your updater/installer binary, e.g. `Updater.exe`.)

**3. Signature scheme**
- **EdDSA / Ed25519**, "the same mechanism for signing and signature verification as the Sparkle Project … **fully compatible**."
- Generate: `winsparkle-tool generate-key --file private.key` → prints base64 **public key** (e.g. `pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=`).
- Embed public key **either as a Windows resource or via API** (verbatim from README):
  ```
  EdDSAPub EDDSA {"pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U="}
  // or:  win_sparkle_set_eddsa_public_key("pXAx0wfi8kGbeQln11+V4R3tCepSuLXeo7LkOeudc/U=");
  ```
- Sign: `winsparkle-tool sign --private-key-file private.key Updater.exe` → emits `sparkle:edSignature="…" length="…"`, added to the `<enclosure>`.
- **Legacy DSA** still supported but **deprecated** (migrate via the DSA→EdDSA wiki). Key format: Ed25519. What's signed: the updater/installer binary.

**4. Provider abstraction**
- **Single model: a feed (appcast) URL** configured at init. Host the appcast on any static HTTPS origin (S3/CDN). No provider classes; the URL is the provider.

**5. Verification flow**
1. Fetch appcast (HTTPS) → select update.
2. Download enclosure → verify **`length`** (size) and **`sparkle:edSignature`** (Ed25519) against the embedded `EdDSAPub`.
3. Install the verified binary. Mismatch ⇒ update rejected.
No revocation list; a wrong/revoked key simply fails Ed25519 verification.

**6. Rollout controls**
- **No built-in staged percentage or channel system** in the feed (static appcast). Phased rollout / channels must be done **server-side** by serving different appcasts (multiple URLs per channel) — the same pattern Sparkle uses for channels.
- **Kill switch:** republish an appcast with no newer item (or an older one).

**7. Rollback mechanics**
- **No auto-rollback / crash-throttle.** Roll back by republishing an appcast whose latest item is the known-good version. Latency = next full download.

**8. App-quit timing**
- WinSparkle shows a native "update available" UI (similar to Sparkle). On **Install**, the **app closes**, the updater runs the installer, and the app **relaunches**. Full-process handoff (not a webview reload).

**9. Known limitations (solo-team blockers)**
- **Windows-only.**
- **Single-maintainer** project (bus-factor risk) — a real concern for a solo team betting on it.
- **C API** (bindings exist but you own integration tests).
- **Static XML feed → no in-band % / channels**; targeting is server-side only.
- **Requires Authenticode signing** of the `Updater.exe` for a clean Windows install (SmartScreen), on top of the Ed25519 feed signature.

**Edge cases / failure modes (WinSparkle):**
- **Enclosure 404 / missing binary:** the download fails → the check fails and the current version is retained. Only the **newest** appcast item is ever offered, so there is no in-feed fallback to a previous build.
- **Wrong / revoked key:** Ed25519 verification fails → the enclosure is rejected (logged error, no install). There is **no in-band trusted-key list**; rotating the key means shipping a new app build carrying the new `EdDSAPub` resource — the same constraint class as Sparkle/Tauri.
- **Feed unreachable / user offline:** the check is retried on the next launch/interval; WinSparkle never mutates the installed app unless a fully verified update is applied, so the last good state persists.
- **DSA/EdDSA mixed appcast:** prefer the EdDSA enclosure; **DSA is deprecated and slated for removal** — migrate now to avoid a hard break on a future WinSparkle release.
- **Single-item appcast:** valid; only the newest item is considered, so release notes/history belong in an external `releaseNotesLink`, not in the feed.

---

## (f) Microsoft AutoUpdater (MSIX + App Installer)  — Windows 10/11 (OS-level)

> **Sourcing caveat (fail-loud):** `learn.microsoft.com` was reachable (the App Center pages loaded), but the specific MSIX pages I requested — `…/windows/msix/deploy-use/auto-update-overview`, `…/windows/msix/package/auto-update-overview`, `…/windows/msix/package/appinstaller-manifest-ns0`, `…/windows/uwp/schemas/appxmanifest/apppackage-schema-ns0` — all returned **404** in this environment (likely proxy-forged or moved slugs). The manifest schema and flow below are the **established MSIX / App Installer specification** and should be re-verified against `learn.microsoft.com/en-us/windows/msix/` when reachable. Citations point to that docs section as the reference home.

**1. Identity / source / version / license**
- Component: **Microsoft AutoUpdater (MUA)**, part of the **Windows App Installer** framework, built into **Windows 10 1809+** and **Windows 11**. It is an **OS service, not an npm/NuGet dependency** — there is no "version" you ship; you consume it via package manifests.
- License: proprietary (Windows OS). Apps it updates are **MSIX** packages (successor to `.appx`).
- Reference home: `https://learn.microsoft.com/en-us/windows/msix/` (App Installer + auto-update + manifest reference).

**2. Manifest / channel file — two files**
**(i) The app's `.appxmanifest` opts into MUA** with the `<AutoUpdate>` element (child of `<Package>`), setting the check period in days:
```xml
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" ...>
  <Identity Name="Contoso.MyApp" Version="1.2.3.0" Publisher="CN=Contoso Ltd" />
  <AutoUpdate UpdatePeriodInDays="1" />
  ...
</Package>
```
**(ii) The "feed" is the `.appinstaller` manifest** (namespace `http://schemas.microsoft.com/appx/appinstaller/2017/06`), which names the main package, any framework dependencies, and the **ordered `UpdateUris` fallback list**:
```xml
<?xml version="1.0" encoding="utf-8"?>
<AppInstaller Uri="https://cdn.example.com/myapp/MyApp.appinstaller"
              Version="1.2.3.0"
              xmlns="http://schemas.microsoft.com/appx/appinstaller/2017/06">
  <MainPackage Name="Contoso.MyApp"
               Version="1.2.3.0"
               ProcessorArchitecture="x64"
               Publisher="CN=Contoso Ltd"
               Uri="https://cdn.example.com/myapp/MyApp-1.2.3.0.msix" />
  <FrameworkPackage Name="Microsoft.VCLibs.140.00"
                    Version="14.0.30754.0"
                    Publisher="CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" />
  <UpdateUris>
    <Uri Priority="1">https://cdn.example.com/myapp/MyApp.appinstaller</Uri>
    <Uri Priority="2">https://backup.example.com/myapp/MyApp.appinstaller</Uri>
  </UpdateUris>
  <DesktopModification Enabled="false" />
</AppInstaller>
```
Fields: `Identity/Version` (build), `MainPackage` (Name, Version, ProcessorArchitecture, Publisher, URI to the `.msix`), `FrameworkPackage` (shared deps), `UpdateUris` (Priority-ordered feed fallback).

**3. Signature scheme**
- **Authenticode (X.509).** Every **`.msix`** is a signed package; the **OS validates the Authenticode signature** (and the `Publisher` identity) before install. This is the trust anchor — there is **no separate manifest hash/ed25519** like Sparkle/Tauri/Expo.
- For **Microsoft Store** apps the Store's signature + Store trust apply; for **SIDeloaded** apps you use your own code-signing cert (or self-signed, which triggers prompts).
- The `.appinstaller` feed is not per-release signed; integrity of the *payload* is guaranteed by the `.msix` signature.

**4. Provider abstraction**
- **`UpdateUris` is the provider list** — a Priority-ordered set of HTTPS URLs (CDN/S3/static). MUA tries them in order; first reachable wins. This is the built-in "fallback channel."
- Distribution/trigger sources: **SIDeloaded** (your `.appinstaller`), **Microsoft Store**, or **MDM/enterprise** (Intune). The Store has its own delivery pipeline.

**5. Verification flow**
1. MUA (a background component, roughly on an `UpdatePeriodInDays` cadence / Windows-schedule) fetches the `.appinstaller` from `UpdateUris`.
2. Compares `MainPackage.Version` to installed; if newer, downloads the `.msix`.
3. **Validates the `.msix` Authenticode signature + publisher** against the installed identity.
4. **In-place update:** the new package is staged while the old remains; the swap is committed only after validation. Mismatch/invalid signature ⇒ update abandoned, old version retained.
No revocation list in-band; a revoked cert simply fails OS signature validation.

**6. Rollout controls**
- **No built-in staged percentage for SIDeloading.** All SIDeloaded devices on a URL get the same version.
- **Staged rollout lives elsewhere:**
  - **Microsoft Store** apps: Store-side staged rollout (gradual % to users) + **Package Flights** (Partner Center) for test tracks.
  - **Enterprise:** **MDM update rings** (Intune) to ring/fleet the update by group.
- **Fallback channel:** `UpdateUris` Priority list.

**7. Rollback mechanics**
- **In-place update is rollback-safe by design:** the previous version stays in place until the new package is fully staged and validated; if install fails, the OS **reverts to the prior version** (MUA "rolls back" on failure). This is the strongest built-in rollback in this survey.
- There is **no crash-based auto-rollback** (the OS doesn't watch for app crashes); rollback is **install-failure-driven**.

**8. App-quit timing**
- **Fully OS-driven and largely silent.** MUA performs the in-place update in the background; running app processes are terminated/restarted as the package manager requires (the app is "replaced" without your code orchestrating a quit). User experience depends on policy (can be silent or show a notification).
- Not a webview reload and not an app-initiated quit — the **app has no code-level control** over the handoff.

**9. Known limitations (solo-team blockers)**
- **No fine-grained % for SIDeloaded** updates — a one-person team shipping SIDeloaded MSIX has all-or-nothing per URL (unless they add their own server-side gating or use MDM/Store).
- **Self-signed MSIX = security prompts / SmartScreen friction**; a proper code-signing cert is needed for a clean experience.
- **In-place update requires modern Windows** (Win10 1809+); older OS can't do it.
- **No crash-throttle** — you pair MUA with your own crash telemetry to decide when to republish.
- Fewer knobs than Sparkle/Expo for release engineering (rollout %, branches) — those live in Store/MDM.

---

## (g) @tauri-apps/plugin-updater  — Tauri 2.x (Rust core, cross-platform)

**1. Identity / source / version / license**
- JS package: npm **`@tauri-apps/plugin-updater`** (verified **v2.14.1**, **MIT OR Apache-2.0**). Rust crate: `tauri-plugin-updater`. Requires **Rust ≥ 1.90**.
- Docs: `tauri.app/plugin/updater/` (fetched live; "Last updated: Nov 28, 2025"). **GitHub source unreachable live**; cited via docs site + npm package.
- Platforms: windows, linux, macos (+ android/ios listed). Install via `tauri add updater`.

**2. Manifest / channel file — two server modes (literal JSON)**
**(i) Static JSON** (host on S3/CDN/GitHub Releases). Required keys: `version`, `platforms.<target>.url`, `platforms.<target>.signature`:
```json
{
  "version": "1.2.3",
  "notes": "Release notes",
  "pub_date": "2026-01-15T08:00:00.000Z",
  "platforms": {
    "linux-x86_64":   { "signature": "<base64 .sig content>", "url": "https://…/myapp.AppImage" },
    "windows-x86_64": { "signature": "<base64 .sig content>", "url": "https://…/myapp-setup.exe" },
    "darwin-x86_64":  { "signature": "<base64 .sig content>", "url": "https://…/myapp.app.tar.gz" }
  }
}
```
**`signature` is the literal content of the generated `.sig` file** ("A path or URL does not work!"). Target key = `OS-ARCH` (`linux|darwin|windows` × `x86_64|aarch64|i686|armv7`). Tauri validates the **whole file** before checking the version.

**(ii) Dynamic Update Server** — Tauri calls the endpoint; **`204 No Content`** = no update, **`200 OK`** + JSON:
```json
{ "version": "1.2.3", "pub_date": "2026-01-15T08:00:00Z",
  "url": "https://…/myapp.app.tar.gz", "signature": "<base64 .sig>", "notes": "…" }
```
Required: `url`, `version`, `signature`.

**3. Signature scheme**
- **Ed25519 (minisign).** "Tauri's updater needs a signature to verify that the update is from a trusted source. **This cannot be disabled.**"
- Keygen: `tauri signer generate` (creates the keypair; e.g. `-w ~/.tauri/myapp.key`). **Public key** goes in `tauri.conf.json` (`plugins.updater.pubkey` — "cannot be a file path!"). **Private key** signs the installer at build time via env `TAURI_SIGNING_PRIVATE_KEY` (`.env` does NOT work — must be a real env var) + optional `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Build with `bundle.createUpdaterArtifacts: true` → emits the `.sig` next to each artifact (`.AppImage.sig`, `.app.tar.gz.sig`, `-setup.exe.sig`/`.msi.sig`; `v1Compatible` mode zips the installers).
- Key format: **Ed25519 (minisign)**. What's signed: the update bundle. Trust = embedded pubkey vs `.sig`.

**4. Provider abstraction**
- **`plugins.updater.endpoints: string[]`** is the provider list (ordered). Tauri "will only continue to the next url if a non-2XX status code is returned." Supports `{{current_version}}`, `{{target}}`, `{{arch}}` interpolation (and custom `target`).
- Static JSON ⇒ S3/CDN/GitHub Releases. Dynamic server ⇒ your own API. `dangerousInsecureTransportProtocol: true` allows non-HTTPS (caution). **TLS is enforced in production** otherwise.
- Request options at runtime: `timeout`, `proxy`, `headers` (e.g. `Authorization: Bearer …`).

**5. Verification flow**
1. `check()` hits endpoints (in order) → parse static/dynamic JSON.
2. Semver compare (or custom `version_comparator`).
3. `downloadAndInstall()` downloads the bundle → **verify the Ed25519 `.sig` against `pubkey`** → install.
Mismatch ⇒ error from the plugin, no install. **Key rotation** is possible by setting the pubkey at runtime (`UpdaterBuilder::pubkey(...)`), which is the documented rotation path.

**6. Rollout controls**
- **No built-in staged percentage.** Rollout/channel is done **server-side**: runtime `endpoints(vec![url])` with different URLs per channel (e.g. `https://beta.myserver.com/…` vs `https://stable.myserver.com/…`), or a dynamic server that decides per client.
- **Kill switch:** server returns `204`, or republish static JSON with the older version (requires downgrade-comparator to actually install it).

**7. Rollback mechanics**
- **No auto-rollback / crash-throttle.** Rollback = server sends an older `version`; you must enable downgrades via `version_comparator(|current, update| update.version != current)` (default only installs *newer*). Latency = next full download.

**8. App-quit timing**
- **Windows:** the app **automatically exits before the installer runs** (Windows installer limitation); use `on_before_exit(|| …)` for cleanup.
- **macOS/Linux:** call `relaunch()` (JS) / `app.restart()` (Rust) after install. "Restarting immediately after installing is not required" — you can defer to a manual restart or prompt.
- Full-binary swap; the update is applied on relaunch.

**9. Known limitations (solo-team blockers)**
- **Signing is mandatory and irreversible:** if you **lose the private key you can never publish an update again** to already-installed apps — key backup is critical for a solo dev.
- **Windows auto-exit** is a UX constraint (no in-place swap).
- **No built-in % / channels** — you build the channel/rollout server.
- **TLS enforced** in production (no plain-HTTP endpoints without the dangerous flag).

---

## (h) @capawesome/capacitor-live-update  — Capacitor (Android/iOS/Electron, OTA web bundle)

**1. Identity / source / version / license**
- Package: npm **`@capawesome/capacitor-live-update`** (verified **v8.7.1**, **MIT**). Supports **Capacitor 6/7/8** (8.x.x active). Docs: `capawesome.io/plugins/live-update/` (fetched live). "First-party" in the sense that there is **no `@capacitor/live-update`** — Capawesome's is the canonical OTA plugin (used in 1,000+ projects, 20M+ devices per its docs).
- OTA model: updates the **web bundle** (JS/CSS/assets) on Android, iOS, **and Electron** — not the native binary.

**2. Manifest / channel file — bundle manifest (cloud) + config schema**
The **runtime config** (in `capacitor.config.json`) is the client-side schema (verbatim docgen table):
```json
{
  "plugins": {
    "LiveUpdate": {
      "appId": "6e351b4f-69a7-415e-a057-4567df7ffe94",
      "autoBlockRolledBackBundles": false,
      "autoDeleteBundles": false,
      "autoUpdateStrategy": "background",
      "defaultChannel": "production",
      "httpTimeout": 60000,
      "publicKey": "-----BEGIN PUBLIC KEY-----MIGfMA0GCSqGSIb3DQEBAQUAA4GN…IDAQAB-----END PUBLIC KEY-----",
      "readyTimeout": 10000,
      "serverDomain": "api.cloud.capawesome.io"
    }
  }
}
```
| Prop | Type | Meaning |
|---|---|---|
| `appId` | string | Capawesome Cloud app id (NOT the bundle id) |
| `autoBlockRolledBackBundles` | bool | auto-block rolled-back bundles (≤100, LRU) |
| `autoDeleteBundles` | bool | delete unused bundles after `ready()` |
| `autoUpdateStrategy` | `'none'|'background'` | background = auto download/apply at startup + resume (>15 min) |
| `defaultChannel` | string | default channel (overridable by `setChannel`/native) |
| `httpTimeout` | number | ms for HTTP requests |
| `publicKey` | string | **PEM-encoded RSA public key** (verify bundle) |
| `readyTimeout` | number | ms to wait for `ready()` before resetting to default (0 = disable) |
| `serverDomain` | string | Capawesome Cloud API host (no scheme/path) |

The **bundle "manifest"** is served by the cloud (or your server) and identifies a **`bundleId`**, its **channel**, and **delta** info. Self-hosted download is explicit: `LiveUpdate.downloadBundle({ url: 'https://example.com/1.0.0.zip', bundleId: '1.0.0' })` — a **zip** artifact (Electron supports only `zip`).

**3. Signature scheme**
- **RSA** public key (PEM) via `publicKey`. "Verify the authenticity and integrity of the bundle using a public key." The cloud/self-hosted bundle is signed; the client verifies the **RSA signature** of the downloaded bundle against `publicKey`. (Capawesome also documents **encryption** as a separate, optional layer — "Signing vs Encryption".)
- Key format: **RSA (PEM)**. What's signed: the OTA bundle (web assets). Recommended enabled in production.

**4. Provider abstraction**
- **Two providers:** (a) **Capawesome Cloud** (`serverDomain` + `appId`; `sync()`/`fetchLatestBundle()`), or (b) **Self-Hosted** — "Download bundles from any URL, no Capawesome Cloud dependency required" via `downloadBundle({url, bundleId})`.
- **Channels** are first-class: `defaultChannel` (config), `setChannel()` (persisted), **versioned channels** bound to native version (`production-${versionCode}` via Android `resValue`/iOS `Info.plist` `CapawesomeLiveUpdateDefaultChannel`/Electron config), `fetchChannels()` (public channels only).

**5. Verification flow**
1. `sync({channel})` / `fetchLatestBundle()` → get latest `bundleId` for the channel.
2. `downloadBundle` → **verify RSA signature** against `publicKey` (and integrity).
3. `setNextBundle({bundleId})` → `reload()`/restart to apply. `getCurrentBundle()`/`getNextBundle()` inspect state.
Mismatch ⇒ bundle not applied; the plugin keeps the previous/current bundle.

**6. Rollout controls**
- **Staged rollout:** Capawesome Cloud supports **gradual rollout** of a bundle to a percentage of devices ("Rollout: Gradually roll out new bundles to gather valuable feedback").
- **Channel model:** stable/beta/preview lanes via channels; **versioned channels** tie a channel to a native build.
- **Kill switch:** point the channel back to a good `bundleId`, or `reset()` to the default (embedded) bundle.

**7. Rollback mechanics**
- **Client-side auto-rollback via `ready()`:** call `LiveUpdate.ready()` as soon as the app is usable; if it isn't called within **`readyTimeout`**, the plugin **resets to the default (embedded) bundle**. (Strongly recommended to set, e.g. `10000` ms.)
- **`autoBlockRolledBackBundles`** (7.3.0+): remembers up to **100** rolled-back `bundleId`s and skips them on future syncs (LRU evicts the oldest). No effect if `readyTimeout` is 0.
- **Electron kill-safe rollback:** "if the app is closed or crashes before `ready()` is called, the rollback is performed on the next app start."
- `getBlockedBundles()`/`clearBlockedBundles()` manage the block list.

**8. App-quit timing**
- **`reload()`** applies the new bundle by **reloading the web view only — the native process is NOT restarted** (so release exclusive resources like IndexedDB/WebSockets first; in-memory state is lost).
- Or apply on **next app start**. `autoUpdateStrategy: 'background'` auto-downloads/applies at startup and on resume (>15 min since last check).
- This is a **webview reload** (fast), unlike the full-binary engines above.

**9. Known limitations (solo-team blockers)**
- **Full features (channels, % rollout, custom properties, public `fetchChannels`) require Capawesome Cloud** (`appId`) or you self-host and wire `downloadBundle` yourself.
- **Webview-only** — cannot update native code (same OTA boundary as CodePush/Expo).
- **Must implement the `ready()` + `readyTimeout` contract** or auto-rollback won't fire.
- **RSA key** must be managed; a lost/wrong key breaks bundle verification.

---

## (i) CodePush (App Center)  — React Native / Cordova / Unity / UWP  [RETIRED]

**1. Identity / source / version / license / STATUS**
- Client package: npm **`react-native-code-push`** (verified **v9.0.1**, **MIT**). README pulled from the **npm artifact via jsDelivr** (citable).
- **SERVICE STATUS: RETIRED.** Visual Studio App Center (which hosted CodePush) — "**scheduled for retirement on March 31, 2025. After that date, it will not be possible to sign in with your user account nor make API calls.**" (learn.microsoft.com/en-us/appcenter/retirement, updated 2026-04-15). Analytics/Diagnostics were extended (to 2027) but **CodePush/Distribute/Build/Test are gone**.
- Microsoft's official path: a **self-hosted `code-push-server`** (github.com/microsoft/code-push-server) to keep CodePush running independently.
- Client note (README): on React Native **0.76+ you must opt OUT of the New Architecture** to use CodePush.

**2. Manifest / channel file — the update response (deployment model)**
CodePush is **deployment-key driven** (no public manifest file you author). The server returns an update descriptor for the app's **deployment**. Established response fields (documented across the CodePush API; the reachable README documents the *deployments/rollout/rollback/differential* model, exact response field spelling is from the established CodePush API):
```json
{
  "label": "v2",
  "appVersion": "1.1.0",
  "packageHash": "<hash of the package>",
  "packageSize": 1234567,
  "packageUri": "https://codepush…/package",
  "mandatory": false,
  "description": "Modified the header color",
  "rollout": 25
}
```
- **Deployments** = named lanes: `Staging` and `Production` (auto-created) + custom deployments. The **deployment key** is embedded per-platform (iOS `Info.plist`, Android `build.gradle`) or passed to `sync({deploymentKey})`.
- **`target-binary-version`** scopes an update to native versions (e.g. `~1.1.0`).
- **Differential:** "the CodePush client supports differential updates … your end users will only actually download the files they need" (README).

**3. Signature scheme**
- **Authorization = deployment key** (identifies app+deployment; gates access). **Integrity = package hash** (`packageHash`) verified on download over **HTTPS**.
- There is **no client-embedded public-key (ed25519/RSA) signature** of the payload in the classic model — trust = HTTPS + deployment key + package hash. (This is weaker than Expo/Sparkle/Tauri, which sign with an embedded public key.)

**4. Provider abstraction**
- **Single provider: the CodePush service (or self-hosted `code-push-server`).** You don't point at arbitrary static files — the service manages packages, rollouts, and labels. Self-hosting is the 2025+ reality.

**5. Verification flow**
1. `sync()` (on app start / resume / manual) with the deployment key.
2. Server returns the latest label for that deployment+binary-version.
3. Download package → **verify `packageHash`**.
4. Install (see quit-timing). **Client keeps the previous update** so it can roll back if the new one crashes / isn't marked ready (`notifyApplicationReady`).
Mismatch hash ⇒ update rejected.

**6. Rollout controls**
- **Staged percentage:** `appcenter codepush release-react … --rollout 25`; promote with `-r 20`; expand with `codepush patch <deployment> -r 100`. (README, verbatim examples.)
- **Channel model = deployments:** `Staging` → `Production` via `codepush promote -s Staging -d Production`; **dynamic deployment assignment** (A/B / early access) by swapping the deployment key at runtime.
- **Mandatory** updates (`-m`) force immediate install; **kill switch** = server-side `codepush rollback` (stops new users getting the bad release).

**7. Rollback mechanics**
- **Client-side auto-rollback:** "the CodePush plugin maintains a copy of the previous update, so that in the event that you accidentally push an update which includes a crash, it can automatically roll back" (README). Requires calling `notifyApplicationReady` on start or it "will think your update failed and roll it back."
- **Server-side rollback:** `appcenter codepush rollback` (prevent further installs). Rollback latency: client-side is near-instant on next launch; server-side is immediate for new checks.

**8. App-quit timing**
- Default: **download now, install on next app restart** (least invasive). `InstallMode`: `IMMEDIATE` (force now), `ON_APP_RESTART` (optional default), `ON_NEXT_RELEASE_TICK`. **Mandatory** updates install immediately.
- `checkFrequency`: `ON_APP_START` (default), `ON_APP_RESUME`, `MANUAL`.
- Install = reload the JS runtime (not a native restart); it's a **JS-bundle swap**.

**9. Known limitations (solo-team blockers)**
- **THE SERVICE IS DEAD** (retired 2025-03-31). Continuing requires **self-hosting `code-push-server`** — meaningful ops burden for a one-person team.
- **JS/assets only** — no native code, permissions, or SDK changes.
- **RN New Architecture** requires opt-out (0.76+).
- **Weaker signature model** (no embedded public key) vs Expo/Sparkle/Tauri.
- Store-guideline dependent (JS/VM code allowed, but behavior must match the approved app).

---

## (j) Expo Updates / EAS Update  — React Native / Expo (JS + assets OTA)

**1. Identity / source / version / license**
- Client library: npm **`expo-updates`** (verified **v58.0.21**, MIT). Hosted service: **EAS Update (Expo Update)**.
- Docs (fetched live): `docs.expo.dev/versions/latest/sdk/updates/`, **`docs.expo.dev/technical-specs/expo-updates-1.md`** (the **Expo Updates v1 protocol spec**, the authoritative wire format), and `docs.expo.dev/eas-update/`.
- OTA scope: updates **non-native pieces (JS, styling, images)**; **not** native code, permissions, or SDK version (use Expo Build for those).

**2. Manifest / channel file — the Expo Updates v1 wire format (literal, from the spec)**
This is a **request/response protocol**, not a static file. **Request headers** the client MUST send:
```
expo-protocol-version: 1
accept: application/expo+json;q=0.9, application/json;q=0.8, multipart/mixed
expo-platform: ios            # or android
expo-runtime-version: 1.0.0(1)
expo-expect-signature: sig, keyid="root", alg="rsa-v1_5-sha256"   # if code-signing on
```
**Common response headers:**
```
expo-protocol-version: 1
expo-sfv-version: 0
expo-manifest-filters: <expo-sfv>            # filters which stored updates apply
expo-server-defined-headers: <expo-sfv>       # headers to resend on next request
cache-control: private, max-age=0
content-type: application/expo+json
```
**Other response header:** `expo-signature: <expo-sfv>` (`sig`, `keyid`, `alg`).
**Manifest body** (verbatim TypeScript from the spec):
```ts
type Manifest = {
  id: string;                 // UUID, unique
  createdAt: string;          // ISO 8601 (ordering key)
  runtimeVersion: string;     // must match the build's runtime version
  launchAsset: Asset;         // entry point (fileExtension ignored)
  assets: Asset[];
  metadata: { [key: string]: string };
  extra: { [key: string]: any };   // e.g. { eas: { projectId } }
};
type Asset = {
  hash?: string;              // Base64URL-encoded SHA-256 (integrity)
  key: string;                // reference key from app code
  contentType: string;        // MIME (RFC 2045)
  fileExtension?: string;     // e.g. ".jpeg" (dot-prefixed)
  url: string;
};
```
**Directive body** (multipart; server→client instruction):
```ts
type Directive = { type: string; parameters?: { [k:string]: any }; extra?: { [k:string]: any } };
// EAS uses type "rollBackToEmbedded"
```
Response is **`application/expo+json`/`application/json`** (manifest only) or **`multipart/mixed`** (manifest + extensions + directive parts). A **`204`** (empty multipart) = no-op.

**3. Signature scheme**
- **RSA code-signing of the manifest.** Config `updates.codeSigningCertificate` (iOS `EXUpdatesCodeSigningCertificate`) / `codeSigningMetadata`. Client sends `expo-expect-signature {sig,keyid,alg}` (e.g. `alg="rsa-v1_5-sha256"`); server returns `expo-signature {sig,keyid,alg}`. "A conformant client … MUST verify the signature of the manifest … using the corresponding code signing certificate." The cert "MUST be a self-signed, trusted root … or in a chain signed by a trusted root … embedded in the application or device OS."
- Signing the manifest **transitively signs the assets** (their SHA-256 hashes are in the manifest).
- **Asset integrity:** each downloaded asset MUST match its **Base64URL SHA-256** `hash` (spec: "a conformant client MUST verify").
- Key format: **RSA (X.509) cert**. This is the strongest crypto story in the mobile-OTA group (with Capawesome's RSA).

**4. Provider abstraction**
- **`updates.url`** = "a URL of a remote service implementing the **Expo Updates protocol**." EAS Update is the hosted implementation; a **self-hosted** server (e.g. `custom-expo-updates-server`) works. So: EAS hosted **or** any spec-compliant server (CDN-backed).
- `updates.requestHeaders` for auth; `setUpdateURLAndRequestHeadersOverride()` at runtime (requires `disableAntiBrickingMeasures`).

**5. Verification flow**
1. `checkForUpdateAsync()` → GET with the protocol headers → server picks the newest update satisfying `expo-runtime-version` + `expo-manifest-filters`.
2. `fetchUpdateAsync()` → download manifest → **verify manifest RSA signature** (if enabled) → download all `assets`/`launchAsset` → **verify each asset's SHA-256**.
3. Store in the update DB; `reloadAsync()` or next cold start to apply.
Mismatch ⇒ rejected; the running/previous update is kept.

**6. Rollout controls**
- **Staged percentage:** EAS **rollouts** (`docs.expo.dev/eas-update/rollouts`) — publish to a % and expand.
- **Branches:** `eas update --channel production` (or staging/preview); **`Updates.channel`** reports the current build's channel.
- **Groups:** EAS supports user groups for targeting.
- **Kill switch:** republish a previous update (see rollback) or pause the rollout.

**7. Rollback mechanics**
- **Republish = rollback:** "If an update isn't performing as expected, you can **republish** a previous, stable version on top of the problematic one, much like a new 'commit'." (EAS intro.)
- **`maxUpdatesToKeep`** (default **2**): keeps the running update + N older ones so a bad newest update can be bypassed.
- **`rollBackToEmbedded` directive** (EAS) tells the client to use the **embedded** update.
- **Emergency launch / anti-bricking:** `Updates.isEmergencyLaunch` — "in very rare cases … may need to fall back to the update that's embedded in the app binary, even after newer updates have been downloaded." `disableAntiBrickingMeasures` (default false) guards against this.
- Rollback latency: next `checkForUpdate`/launch (or `reloadAsync`).

**8. App-quit timing**
- Default: **check on launch** (`checkAutomatically: ON_LOAD`), **download now, apply on next cold start**. `reloadAsync()` applies immediately (reload the JS runtime). `reloadScreenOptions` customizes the reload UI.
- `checkAutomatically` can be `ON_LOAD` / `ON_ERROR_RECOVERY` / `NEVER`; `fallbackToCacheTimeout` (`EXUpdatesLaunchWaitMs`) bounds launch wait.
- It's a **JS-runtime reload** (not a native restart).

**9. Known limitations (solo-team blockers)**
- **Runtime version management is mandatory:** native changes require a **new build** + a new `runtimeVersion` (policies: `appVersion`, `nativeVersion`, `fingerprint`). Get it wrong and updates won't match.
- **EAS hosted = MAU billing** (1 MAU = 1 install downloading ≥1 update/billing cycle) or you **self-host** a spec-compliant server.
- **JS/assets only** — no native/permissions/SDK-version changes via updates.
- Must comply with App Store / Play Store OTA rules.

---

## (k) PWA Service Worker + Workbox  — Web (browser)

**1. Identity / source / version / license**
- Libraries: npm **`workbox-core` / `workbox-window` / `workbox-build`** (verified **v7.4.1**, MIT), the Chrome team's SW toolkit.
- Spec: **W3C Service Worker** spec + **MDN Service Worker API**; Workbox docs `developer.chrome.com/docs/workbox` (fetched live: overview, **service-worker-lifecycle**, **handling-service-worker-updates**).
- Model: a **Service Worker** (SW) is a JS proxy script on your origin that intercepts fetches; "updates" = the browser installing a **new SW script** (and any new precached assets). **No separate manifest file** — the SW script + (optionally) a Workbox precache manifest is the "channel."

**2. Manifest / channel file — there is none (the SW script IS the channel)**
- The unit of update is the **SW script** (e.g. `/sw.js`) and its **precache manifest**. With Workbox `generateSW`/`injectManifest`, a **precache manifest** lists versioned assets:
```js
// injectManifest / generateSW precache manifest (Workbox)
self.__WB_MANIFEST = [
  { url: '/css/home.fe5d0b23.css',  revision: null },
  { url: '/js/home.d3cc4933.js',   revision: null },
  { url: '/offline.html',          revision: 'a1b2c3' }
];
```
- `updateViaCache` (`'imports' | 'none' | 'all'`) controls how the update check treats cached imports.
- **update detection is byte-based:** the browser updates the SW only "if its contents have changed" — "any byte-for-byte changes to scripts requested by `importScripts`" or "any changes in the service worker's top-level code, which affects the fingerprint the browser has generated of it" (Workbox lifecycle, verbatim). So **don't cache `/sw.js`** (serve `no-cache`) and **don't rename it**.

**3. Signature scheme**
- **NONE by default.** Trust = **HTTPS origin** + the browser's **byte-fingerprint** of the SW. There is **no embedded public key / no asymmetric signature** of the SW or its assets in the classic model.
- Optional/adjacent integrity mechanisms: **Subresource Integrity (SRI)** on script tags, and **Signed HTTP Exchanges (SXG)** for signed third-party content — but these are not part of the SW update flow.
- **For AIRIZ's trust story this is the weakest engine:** a compromised origin (or MITM on non-HTTPS, which is disallowed) can serve a malicious SW. (SWs are HTTPS-only by spec.)

**4. Provider abstraction**
- **No provider concept** — the SW + assets are served from **your origin**. A **CDN or Cloudflare Worker** can deliver `/sw.js` and the precached assets (that's the natural "provider"), but the browser only knows the origin/URL.

**5. Verification flow**
1. **Registration** (`navigator.serviceWorker.register('/sw.js')`) → state `installing`.
2. **Install** (`install` event; `event.waitUntil(...)` precaches). "Installation fails if the promise(s) passed to `event.waitUntil` are rejected … the service worker is discarded."
3. **Activate** (`activate` event; prune old caches via `caches.keys()`/`caches.delete()`).
4. **Update check** (on navigation into scope / `registration.update()` / push+sync within 24h) → byte-compare → if changed, install a **new SW alongside the old** → new one goes to **waiting**.
- "Verification" = the browser's content fingerprint + HTTPS; asset integrity only if you add SRI/Workbox hashing.

**6. Rollout controls**
- **NO built-in staged % or kill switch.** Rollout is whatever the origin serves: to phase it, serve the new SW to a % of clients (edge/Worker logic) or rely on the browser's per-client update timing.
- **Channel model:** none — it's one SW per scope. You can scope different SWs to different paths (`/beta/sw.js`) to fake channels.
- **Kill switch:** revert the served SW bytes (the old SW re-becomes the latest on next check).

**7. Rollback mechanics**
- **Graceful by default:** "an updated service worker gets installed **alongside** the previous one … the old service worker is still in control … the new one enters a **waiting** state." The old SW keeps serving until the new activates (when old has no controlling clients, or `skipWaiting`).
- **Install-failure = automatic "rollback":** if the new SW's `install` `waitUntil` rejects, "the service worker is discarded" — the old SW stays. This is the closest thing to auto-rollback.
- **True rollback** = redeploy the previous SW bytes (a byte change triggers an update back) or `registration.unregister()` / `caches` cleanup. **Prune old caches on `activate`** or you'll hit **storage quota**.
- Latency: next navigation/check (minutes), not instant.

**8. App-quit timing**
- There is **no "app quit"** — the analog is **navigation/reload**. By default the new SW controls on the **next navigation**. For immediate takeover:
  - Page (workbox-window): on `waiting`, prompt the user, then `wb.messageSkipWaiting()`; on `controlling`, `window.location.reload()`.
  - SW: `addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); })` + `self.clients.claim()`.
- `wasWaitingBeforeRegister` handles a SW that was already waiting. **`skipWaiting` risk:** "the old service worker may have handled fetches during page startup, but the new one takes control later … can break lazily-loaded subresources until the next navigation."

**9. Known limitations / update traps (solo-team blockers)**
- **No built-in %, channels, rollback, or signing** — you build all of it (edge gating, versioned caches, byte-revert for rollback).
- **Update traps (documented):** don't change the SW **URL/filename**; don't HTTP-cache `/sw.js`; **long-lived SPA sessions** need manual `registration.update()`; **stale precache** if you don't bump cache versions/prune; **storage quota** from un-pruned caches; `skipWaiting` mid-session breakage.
- **HTTPS-only** (SW unavailable otherwise).
- **Weakest trust model** in this survey (no asymmetric signing) — a concern for a security-sensitive motor-console product.
- Browser-dependent behavior; `Service-Worker-Allowed`/scope edge cases.

---

---
# SYNTHESIS — Cross-Engine Comparison & AIRIZ Recommendation

## C1. Manifest / wire format

| Engine | Wire format | Hosted as | Update-unit |
|--------|-------------|-----------|-------------|
| (a) electron-updater | **YAML** (`latest[-mac/-linux].yml`) | static file | full installer/zip |
| (b) Squirrel.Windows | **plain text** `RELEASES` | static file | full `.exe` / `.zdelta` |
| (c) Squirrel.Mac | **JSON** (dynamic server) or **JSON** (static file) | server / static | `.zip` / `.delta` |
| (d) Sparkle | **XML appcast** (RSS + `sparkle:` ns) | static file (or dynamic) | `.dmg/.zip/.tar` |
| (e) WinSparkle | **XML appcast** (Sparkle-compatible) | static file | installer `.exe` |
| (f) MSIX/MUA | **`.appinstaller` XML** (feed) + `.appxmanifest` `<AutoUpdate>` | static file (UpdateUris) | signed `.msix` |
| (g) Tauri | **JSON** (static) or **JSON** (dynamic server; 200/204) | static / API | platform bundle |
| (h) Capawesome | **bundle manifest** (cloud) + JSON config | cloud / self-host | web-bundle zip |
| (i) CodePush | **update descriptor** (server, deployment-key) | CodePush server | JS bundle + assets (delta) |
| (j) Expo | **Expo Updates v1 protocol** (HTTP headers + Manifest/Directive JSON) | EAS / self-host | JS bundle + assets (manifest) |
| (k) PWA SW | **none** — the SW script (+ Workbox precache manifest) | your origin / CDN | SW script + precached assets |

## C2. Signature scheme (the AIRIZ trust story)

| Engine | Algorithm | What's signed | Key/cert location | Strong? |
|--------|-----------|---------------|-------------------|---------|
| (a) electron-updater | macOS **minisign/Ed25519** + Win **Authenticode (X.509)** + SHA-512 | the installer/zip | embedded pubkey (mac) / publisher allowlist (win) | ✔ strong |
| (b) Squirrel.Windows | **Authenticode** + blockmap/SHA | the `.exe` | code-signing cert | ✔ (cert) |
| (c) Squirrel.Mac | **macOS code-signing** (Developer ID) + SHA-256 + size | the `.app`/zip | Developer ID identity | ✔ (cert) |
| (d) Sparkle | **EdDSA/Ed25519** (+ optional signed feed) | the archive (+ appcast) | `SUPublicEDKey` in Info.plist | ✔ strong |
| (e) WinSparkle | **EdDSA/Ed25519** | the installer | `EdDSAPub EDDSA` resource / API | ✔ strong |
| (f) MSIX/MUA | **Authenticode (X.509)** (OS-validated) | the `.msix` | code-signing cert / Store | ✔ (OS) |
| (g) Tauri | **Ed25519 (minisign)** — mandatory | the bundle (`.sig`) | `pubkey` in tauri.conf.json | ✔ strong |
| (h) Capawesome | **RSA (PEM)** | the web bundle | `publicKey` in config | ✔ strong |
| (i) CodePush | **deployment key (auth) + package hash** (no embedded pubkey) | (package hash only) | server-side key | ◐ weak-ish |
| (j) Expo | **RSA code-signing** (manifest) + **SHA-256** per asset (Base64URL) | manifest (+ assets transitively) | `codeSigningCertificate` | ✔ strong |
| (k) PWA SW | **none** (HTTPS + byte-fingerprint; optional SRI/SXG) | — | — | ✘ weak |

**Takeaway:** the desktop/native engines (a,d,e,g) and mobile-OTA (h,j) all do **asymmetric signing with an embedded public key** — that is the model to standardize on. **PWA SW (k)** has no signature and **CodePush (i)** has no embedded public key — both are trust downgrades.

## C3. Rollout controls (staged % / channels / kill switch)

| Engine | Staged % built-in | Channel model | Kill switch |
|--------|-------------------|---------------|-------------|
| (a) electron-updater | ✔ `stagingPercentage` (0–100) | `channel` → separate yml | remove/zero the yml |
| (b) Squirrel.Windows | ✘ | separate RELEASES URLs | revert RELEASES |
| (c) Squirrel.Mac | ✘ (server decides) | server-side | server 204 / older version |
| (d) Sparkle | ◐ `phasedRolloutInterval` (7 fixed groups) | `sparkle:channel` (+delegate) | republish older / critical flag |
| (e) WinSparkle | ✘ | separate appcasts | republish appcast |
| (f) MSIX/MUA | ✘ (SIDeloaded) | Store flights / MDM rings | republish / MDM |
| (g) Tauri | ✘ (server decides) | runtime `endpoints` per channel | server 204 / older |
| (h) Capawesome | ✔ (cloud %) | channels (incl. versioned) | reset / point channel back |
| (i) CodePush | ✔ `--rollout` / `patch -r` | deployments (Staging/Prod/custom) | server `rollback` |
| (j) Expo | ✔ rollouts % | branches + groups | republish / pause |
| (k) PWA SW | ✘ | none (edge gating) | revert SW bytes |

**Takeaway:** only **electron-updater, Capawesome, CodePush, Expo** ship a real staged-%. Everyone else needs **server-side gating** — a perfect job for a shared **Cloudflare Worker** gateway (see recommendation).

## C4. Rollback mechanics

| Engine | Auto-rollback | Crash-throttle | Server rollback | Latency |
|--------|---------------|----------------|-----------------|---------|
| (a) electron-updater | ✘ | ✘ | republish older (downgrade blocked by default) | full re-download |
| (b) Squirrel.Windows | ✘ | ✘ | revert RELEASES (lower build accepted) | full/delta |
| (c) Squirrel.Mac | ◐ server-driven | ✘ | server returns older/known-good | download |
| (d) Sparkle | ✘ | ✘ | publish older appcast item | download |
| (e) WinSparkle | ✘ | ✘ | republish older appcast | download |
| (f) MSIX/MUA | ✔ **on install failure** (in-place keeps old) | ✘ | republish / MDM | near-instant (revert) |
| (g) Tauri | ✘ (allow downgrade via comparator) | ✘ | server sends older version | full download |
| (h) Capawesome | ✔ **`ready()`/`readyTimeout` → reset to embedded**; `autoBlockRolledBackBundles` (≤100) | ✔ (ready-timeout) | point channel back / reset | next start |
| (i) CodePush | ✔ keeps previous update, rolls back on crash/not-ready | ✔ | server `rollback` | near-instant (next launch) |
| (j) Expo | ✔ `rollBackToEmbedded` + `maxUpdatesToKeep` + emergency launch | ◐ (anti-bricking) | **republish previous** | next check/launch |
| (k) PWA SW | ✔ **install-failure discards new SW** (old stays) | ✘ | revert SW bytes / unregister | next check |

**Takeaway:** the **in-place / previous-version-kept** engines (MSIX, Capawesome, CodePush, Expo, PWA) are the safest. The **full-binary-swap** engines (electron-updater, Sparkle, WinSparkle, Squirrel.*) have **no built-in rollback** — you must keep the prior artifact reachable.

## C5. App-quit / handoff timing

| Engine | Model | Handoff |
|--------|-------|---------|
| (a) electron-updater | background download; install **on quit** (NSIS) / "Relaunch and Update" (mac) | full process swap |
| (b) Squirrel.Windows | install **on exit** via `Update.exe`; atomic swap + relaunch | full process swap |
| (c) Squirrel.Mac | background; install **on terminate** or `relaunchToInstallUpdate` | full `.app` swap |
| (d) Sparkle | prompt → download → **quit, install, relaunch** (helper/XPC) | full process swap |
| (e) WinSparkle | UI → **close app, run installer, relaunch** | full process swap |
| (f) MSIX/MUA | **OS-driven, largely silent in-place**; app restarted by package mgr | OS swap |
| (g) Tauri | **Windows auto-exits** (`on_before_exit`); mac/linux `relaunch()`; deferrable | full process swap |
| (h) Capawesome | `reload()` = **webview only (native NOT restarted)**; or next start | webview reload |
| (i) CodePush | download now, install **next restart** / IMMEDIATE (mandatory) | JS-runtime swap |
| (j) Expo | check on launch, **apply next cold start** or `reloadAsync()` | JS-runtime reload |
| (k) PWA SW | new SW on **next navigation**; `skipWaiting`+`clients.claim` for immediate | navigation/reload |

Two distinct tiers: **full-binary swap** (a–g) vs **JS/webview reload** (h,i,j,k). AIRIZ's surfaces split exactly this way: **Electron = full-binary (a)**, **Capacitor = webview (h)**, **PWA = navigation (k)**.

## C6. Solo-team risk (a one-person team betting on it in 2026)

| Engine | Risk | Why |
|--------|------|-----|
| (a) electron-updater | **Medium** | Mature, but needs Windows Authenticode + macOS notarization; no rollback |
| (b) Squirrel.Windows | **High** | Effectively unmaintained; NuGet id squatted; distribution confusion |
| (c) Squirrel.Mac | **Medium** | Active, but heavy native deps (RAC/Mantle) + pinned Sparkle delta |
| (d) Sparkle | **Medium** | Mature, but Apple cert + key mgmt + rotation burden |
| (e) WinSparkle | **Medium-High** | Single maintainer (bus factor), C API, Windows-only |
| (f) MSIX/MUA | **Medium** | OS-backed (low bug risk) but needs signing; no % for SIDeloaded |
| (g) Tauri | **Medium** | Good, but **key loss = permanent brick** for updates |
| (h) Capawesome | **Low-Medium** | Polished; but full features need Capawesome Cloud or self-host |
| (i) CodePush | **Critical** | **Service dead (2025-03-31)**; self-host `code-push-server` required |
| (j) Expo | **Low-Medium** | Strong, but runtime-version mgmt + EAS billing or self-host |
| (k) PWA SW | **High** | No signing/rollback/%; many update traps; browser-dependent |

---

# DEPRECATION / TIMELINES (verified)

- **CodePush / App Center — RETIRED 2025-03-31.** "After that date, it will not be possible to sign in … nor make API calls." Analytics & Diagnostics extended to **June 30, 2026**, then **March 31, 2027**. CodePush official path = self-hosted `code-push-server`. *(learn.microsoft.com/en-us/appcenter/retirement, updated 2026-04-15.)*
- **Expo "Classic Updates" — deprecated** (pre-Dec 2021); `expo publish` no longer publishes; existing apps keep receiving already-published classic updates. Migrate to **Expo Update**. *(docs.expo.dev/eas-update)*
- **Sparkle: DSA signatures deprecated** → migrate to **EdDSA (Ed25519)**. `SUUpdater` is a deprecated stub in Sparkle 2 (use `SPUStandardUpdaterController`). Signed feeds validated **as of 2.9**. *(sparkle-project.org)*
- **WinSparkle: DSA signatures deprecated** → **EdDSA**; `legacy_*.bat` retained only for the transition. Current **0.9.4** (2026). *(WinSparkle 0.9.4 nupkg README)*
- **Squirrel.Mac — NOT deprecated**; still the **electron-updater macOS backend**; pins **Sparkle 2.9.5** (vendored, not linked) for BinaryDelta. *(2026 Wayback README; electron-updater README)*
- **Squirrel.Windows — effectively unmaintained** (no live Wayback snapshot; NuGet `Squirrel` id squatted by an unrelated 2013 package). Modern Windows Electron path = electron-builder **NSIS + blockmap**, not Squirrel. *(NuGet flat-container API; §a)*
- **electron-updater `bintray` provider — deprecated** (Bintray shut down); providers now generic/github/s3/spaces/azure/bitbucket/gitlab/keygen. *(electron-builder docs / shipped `out/providers`)*
- **Tauri `createUpdaterArtifacts: "v1Compatible"` — to be removed in v3** (v1 zips the installers; v2 ships the raw app bundle + `.sig`). *(tauri.app/plugin/updater)*

---

# SOURCE / VERIFICATION AUDIT (what was live-verified vs. not)

| Engine | Primary source used | Live-verified in this run? |
|--------|--------------------|----------------------------|
| (a) electron-updater | npm registry (`6.8.11`), `builder-util-runtime@9.7.0` `.d.ts` (jsDelivr), electron-updater `out/*.d.ts` (tarball), electron.build | ✔ (npm + artifacts + landing) — `electron.build/auto-update` page path 404'd, used artifacts instead |
| (b) Squirrel.Windows | NuGet flat-container API; 2026 Wayback (Squirrel.Mac sibling); electron-updater artifacts | ✘ (GitHub + Wayback for Squirrel.WPF/clancey both unreachable) — **flagged** |
| (c) Squirrel.Mac | **web.archive.org snapshot 2026-09-03** of the README | ✔ (full README) |
| (d) Sparkle | sparkle-project.org `/documentation/` + `/documentation/publishing/` | ✔ (live) |
| (e) WinSparkle | **`WinSparkle/0.9.4` .nupkg README** + NuGet metadata | ✔ (artifact) — winsparkle.org site + GitHub unreachable |
| (f) MSIX/MUA | learn.microsoft.com MSIX section (specific pages 404'd under proxy) | ◐ **flagged** — schema from established App Installer/MSIX spec, re-verify when reachable |
| (g) Tauri | `tauri.app/plugin/updater/` (live), npm `@tauri-apps/plugin-updater@2.14.1` | ✔ (docs + npm) — GitHub unreachable |
| (h) Capawesome | `capawesome.io/plugins/live-update/` (live), npm `@capawesome/capacitor-live-update@8.7.1` | ✔ (docs + npm) |
| (i) CodePush | npm `react-native-code-push@9.0.1` README (jsDelivr), learn.microsoft.com/appcenter/retirement | ✔ (README + retirement) |
| (j) Expo | `docs.expo.dev` SDK + **Expo Updates v1 spec** + EAS intro, npm `expo-updates@58.0.21` | ✔ (live) |
| (k) PWA SW | `developer.chrome.com/docs/workbox` (lifecycle + handling-updates), W3C/MDN, npm `workbox-*@7.4.1` | ✔ (live) |

**Citation policy honored:** no GitHub line numbers cited (GitHub unreachable). npm artifacts cited via registry/jsDelivr; NuGet via .nupkg; vendor docs by URL; archived GitHub content via web.archive.org. MSIX and Squirrel.Windows are the two sections where the primary live page was unreachable and are **explicitly flagged**.

---

# RECOMMENDATION — Unified AIRIZ release architecture

**Surfaces (as given):** Electron (desktop) · Capacitor (mobile) · PWA (browser) · Cloudflare Worker (delivery/edge). The Worker is not an "update engine" — it is the **single-origin release gateway** that fronts the other three.

**Core principle — standardize on "signed manifest + one gateway":**
Every client should (1) fetch a **manifest** from one origin, (2) verify it with an **embedded public key (asymmetric signature)**, (3) verify payload integrity (hash), (4) honor **staged % + channel + kill switch + rollback** decided **server-side at the gateway**. This is exactly the Tauri/Sparkle/Expo pattern and it's the strongest trust story. **Do not** standardize on the unsigned PWA-SW model or the deployment-key-only CodePush model for a security-sensitive motor console.

**Per-surface mapping:**
1. **Electron (desktop)** → **electron-updater** (`latest.yml`). Sign macOS with **minisign/Ed25519**, Windows with **Authenticode**; keep SHA-512 + blockmap for delta. Keep the prior installer reachable (no built-in rollback). This inherits **Squirrel.Mac** on macOS (fine — it's active). **Do not** use Squirrel.Windows.
2. **Capacitor (mobile)** → **Capawesome Live Update** (RSA `publicKey`). Use the **`ready()`+`readyTimeout`** contract for auto-rollback and `autoBlockRolledBackBundles`. Self-host if you want to avoid Capawesome Cloud.
3. **PWA (browser)** → **Workbox** + a **versioned precache manifest**. Accept the **no-signature reality**; mitigate with: hashed/immutable precache assets, SRI on critical scripts, edge-gated SW rollout, and byte-revert for rollback. Consider **SXG** if you need signed third-party content. Budget for the SW update traps (no SW rename, no-cache `/sw.js`, manual `registration.update()` for long-lived SPAs, prune caches on `activate`).
4. **Cloudflare Worker (gateway)** → implement **one** endpoint that, per client identity/headers, returns the right manifest:
   - `latest.yml` (+ `.blockmap`) for Electron,
   - a **Capawesome-compatible** or self-hosted bundle manifest for Capacitor,
   - (optionally) an **Expo Updates v1** manifest if any RN surface appears,
   - and serves `/sw.js` + precache for the PWA.
   Centralize here: **staged %**, **channel routing**, **kill switch** (serve 204 / older), and **rollback** (republish-older / `rollBackToEmbedded`-style directive). This gives you the rollout controls the individual engines lack.

**Explicitly avoid (2026):** **CodePush** (service dead — self-hosting `code-push-server` is a poor solo-team default), **Squirrel.Windows** (unmaintained/distribution-confused). **Squirrel.Mac** is acceptable only as Electron's internal macOS mechanism, not a chosen strategy.

**Trust ranking for the console (strongest → weakest):** Tauri/Sparkle/WinSparkle/Electron(mac) = **Ed25519 embedded key** ≈ Expo/Capawesome = **RSA embedded key** > MSIX = **OS Authenticode** > CodePush = **key+hash** > PWA SW = **none**. For a motor-console product, the PWA surface is your trust weak point — compensate at the gateway (signed/gated delivery, SRI, SXG) and treat it as the "least trusted" client.

**One-person-team verdict:** the lowest-ops, strongest-trust unified choice is **Electron + electron-updater** (desktop) and **Capawesome** (mobile) behind a **Cloudflare Worker gateway** that owns rollout/rollback, with **Workbox** for the PWA. That keeps you off the dead (CodePush) and unmaintained (Squirrel.Windows) engines, uses asymmetric signing on the two most important surfaces, and centralizes the rollout/rollback logic none of the engines fully provide.

---
*End of reference. All versions verified 2026-11 against npm registry / NuGet / vendor docs. Re-verify MSIX (§f) and Squirrel.Windows (§b) against their primary docs when the proxy allows GitHub/learn.microsoft.com MSIX pages.*
