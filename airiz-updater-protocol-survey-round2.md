# AIRIZ Motor Console — Cross-Platform Auto-Update Protocol Surface (Round 2)

> Exhaustive protocol-surface map of every cross-platform auto-update engine that has
> shipped to production. Built to feed the unified release-architecture decision.
> Generated: 2026-11-05 | Classification: TYPE D (Comprehensive)
> Method: verified against primary docs + GitHub API (stars, archive state, last push)
> and live registry download counts (npm / crates.io / pub.dev) captured 2026-11-05.
> This is a RETRY that EXTENDS the existing surveys in this repo
> (`airiz-auto-update-protocol-survey-agent2.md`, `airiz-release-architecture/release-protocols-survey.md`,
> `airiz-motor-console-update-survey.txt`); field names below are quoted from those
> verified sources plus live API pulls, not regenerated prose.

**Per-section fields:** (a) manifest, (b) signature, (c) channel, (d) cache/staging,
(e) install/apply hook, (f) rollback, (g) one production deployment, plus spec version,
last release, GitHub stars, downloads, minimal schema, and the one command that adds a version.

**Confidence legend:**
- `[V]` = verified this session (GitHub API / registry API / primary doc read in-repo).
- `[K]` = established from primary docs referenced in prior verified surveys (field names carried over verbatim).
- `[L]` = knowledge-based / lower confidence; flagged where a live check was not possible
  (Exa web-search + Context7 were rate/quota-limited this session).

---

## Cross-Reference Matrix (all 23)

| # | System | Manifest | Signature | Channel | Rollback class | Status (2026) |
|---|--------|----------|-----------|---------|----------------|---------------|
| 1 | Squirrel.Windows | `RELEASES` (text) | None (TLS + SHA-1); Authenticode on exes | per-package (staging `%` comment) | publish-new-version | Active (last push 2024-07) `[V]` |
| 2 | Squirrel.Mac | appcast (DSA) | DSA-SHA1 | n/a | publish-new-version | **Abandoned** `[K]` |
| 3 | Sparkle 2.x | `appcast.xml` (RSS) | Ed25519 `sparkle:edSignature` | `sparkle:channel` | phased rollout + publish-new | Active `[K]` |
| 4 | WinSparkle | `appcast.xml` (RSS) | Ed25519 / DSA | per-feed | publish-new-version | Active `[K]` |
| 5 | electron-updater | `latest.yml` | Ed25519 manifest sig (v27+) | `latest`/`beta` files | stagingPercentage + republish | Active (5.76M dl/wk) `[V]` |
| 6 | Tauri updater | signed JSON | minisign Ed25519 | per-endpoint | server-side (allowDowngrades) | Active (14.1M dl total) `[V]` |
| 7 | Capawesome Live Update | bundle JSON / manifest | RSA (PEM `publicKey`) | per-channel | readyTimeout auto-rollback | Active (141K dl/wk) `[V]` |
| 8 | Capacitor Live Update (official) | basic JS patch | none | n/a | none | **Removed/deprecated** `[K]` |
| 9 | CodePush / App Center | deployment→release→pkg | SHA-256 (service trust) | deployment | repoint release | **Retired 2025-03-31** `[V]` |
| 10 | Expo Updates | Updates V1 manifest | RSA PKCS#1 v1.5 (SHA-256) / HTTP msg sig | branch+channel | `isRollback` result type | Active `[K]` |
| 11 | Sentry Releases | (not an updater) release tags | API token | n/a | n/a | Active (1.73M dl/wk) `[V]` |
| 12 | Flutter in-app update | store version (no manifest) | store signature | store | store rollback | Active (v5.0.0) `[V]` |
| 13 | .NET MAUI | MSIX / store | Authenticode / store | store | store / AppInstaller | Active (platform) `[L]` |
| 14 | Uno Platform | MSIX / store / WASM browser | Authenticode / store / browser | store | store / browser cache | Active (platform) `[L]` |
| 15 | react-native-code-push | pkg tarball | SHA-256 | deployment | repoint release | **Archived 2025** `[V]` |
| 16 | PWA Service Worker | byte-compare (no manifest) | SRI (optional) | n/a | SW version swap + cache | Active (spec) `[K]` |
| 17 | MSIX AppInstaller | `.appinstaller` XML | Authenticode (MSIX) | n/a | OS-managed repoint | Active (OS) `[K]` |
| 18 | Chrome component updater | Omaha (component) | SHA-1 + server trust | channel/tag | server-driven | Live (repo archived) `[V]` |
| 19 | Omaha ServerProtocolV2 | bidirectional XML | SHA-1 `updatecheck/app/hash` | `updatecheck/tag` | server-driven | Frozen spec / live in prod `[V]` |
| 20 | Apple App Store | App Store Connect binary | Apple signing | phased release % | rollback to prior build | Active (store) `[L]` |
| 21 | Google Play Console | Play binary (AAB) | Play signing | staged rollout % | rollback rollout | Active (store) `[L]` |
| 22 | Cloudflare Workers + R2 | immutable worker version | (app-defined) signed URL | deployment pointer | re-point version (code only) | Active (platform) `[K]` |
| 23 | Spore (OSS) | BitTorrent | torrent hash | n/a | n/a | **Unverified** `[L]` |

---

## 1. Squirrel.Windows  `[V]`

- **Repo**: `Squirrel/Squirrel.Windows` — **7,990 stars**, MIT, default branch `develop`, last push **2024-07-24**, not archived.
- **Spec version**: Squirrel 2.x (C#/.NET updater, C++ `Setup.exe` bootstrapper).
- **Production user (g)**: **Figma** desktop (ships `Update.exe` + `RELEASES`); also historically Slack/Discord via electron-builder's win32 path.

**(a) Manifest — `RELEASES` file** (plain text, one entry per line). Exact parse regex from `ReleaseEntry.cs`:
`^([0-9a-fA-F]{40})\s+(\S+)\s+(\d+)[\r]*$`
Fields: **`SHA1`** (40 hex) · **filename-or-URL** (basename or absolute HTTPS) · **size** (bytes) · optional trailing comment **`# N%`** = staging percentage.

```
E3F67244E4166A65310C816221A12685C83F8E6F MyApp-1.0.0-full.nupkg 600725
0D777EA94C612E8BF1EA7379164CAEFBA6E24463 MyApp-1.0.1-delta.nupkg 6030
85F4D657F8424DD437D1B33CC4511EA7AD86B1A7 MyApp-1.0.1-full.nupkg 600752 # 50%
```
Delta = filename ends in `-delta.nupkg`. The `.nupkg` is a ZIP with `lib/net45/*` app files + a `.nuspec` (fields `id`, `version`, `authors`, `description`, **`releaseNotes` (required)**, `iconUrl`).
- **(b) Signature**: none built in. `.nupkg`/`RELEASES` unsigned; integrity = SHA-1 + TLS; authenticity = Authenticode on `Setup.exe`/`Update.exe` only.
- **(c) Channel**: per-package; "channel" is just a different `RELEASES` host path (e.g. `.../beta/RELEASES`). Staging is the `# N%` comment.
- **(d) Cache/staging**: `%LocalAppData%\<AppName>\packages\` holds downloaded `.nupkg`; current build in `app-<version>\`; `Update.exe` self-copies to root.
- **(e) Install hook**: `Update.exe --update <url>` → `SquirrelManager.Update()` extracts nupkg, wires shortcuts, relaunches. Bootstrap: `Setup.exe` unpacks PE resource (DATA id 131) → `Update.exe --install .`.
- **(f) Rollback**: none. Squirrel keeps prior `app-*` dirs but does not auto-restore; recovery = publish a newer (or re-published) version.
- **Add a version**: `Squirrel --releasify MyApp-1.1.0-full.nupkg` (writes/appends the `RELEASES` line + optional delta), then upload.

## 2. Squirrel.Mac  `[K]`

- **Repo**: `Squirrel/Squirrel.Mac` — **abandoned / deprecated**. No meaningful 2025-2026 commits; superseded by Sparkle 2.x.
- **What it was**: the C# macOS counterpart to Squirrel.Windows. Spoke the **Sparkle appcast** wire format but only with **DSA-SHA1** signatures (`sparkle:dsaSignature`); it used an out-of-process **ShipIt** helper to swap the `.app` bundle.
- **(a) Manifest**: Sparkle 1.x-style `appcast.xml` (RSS 2.0, `xmlns:sparkle`), `enclosure url/length/type` + `sparkle:version`, `sparkle:shortVersionString`, `sparkle:dsaSignature`.
- **(b) Signature**: DSA-SHA1 only (EdDSA was a Sparkle 1.21/2.0 feature, not backported).
- **(c) Channel**: none (single feed).
- **(d) Cache/staging**: downloaded zip staged in app container; ShipIt performs the swap.
- **(e) Install hook**: ShipIt renames old bundle → copies new → relaunches (atomic-ish bundle replace).
- **(f) Rollback**: none (publish-new-version).
- **(g) Production**: none active — do not adopt; use Sparkle 2.x directly.
- **Verdict**: dead. Any macOS auto-update in 2026 is Sparkle 2.x.

## 3. Sparkle 2.x  `[K]`

- **Repo**: `sparkle-project/Sparkle` — active. **Production users (g)**: **Slack (macOS)**, **1Password**, **TunnelBear**, **Fork**, **WhatsApp (macOS)**.
- **Spec version**: Sparkle 2.x (Xcode framework; delta format v3/v4 since 2.1/2.7).

**(a) Manifest — `appcast.xml`** (RSS 2.0 + `sparkle:` namespace). Key elements/attrs:
`<sparkle:version>`, `<sparkle:shortVersionString>`, `<sparkle:minimumSystemVersion>`,
`<sparkle:criticalUpdate>`, `<sparkle:channel>`, `<sparkle:phasedRolloutInterval>`,
`enclosure url/length/type`, `sparkle:edSignature`, legacy `sparkle:dsaSignature`,
`sparkle:installationType`, `<sparkle:deltas><enclosure sparkle:deltaFrom=...>`.

```xml
<item>
  <sparkle:version>1248</sparkle:version>
  <sparkle:shortVersionString>1.5.1</sparkle:shortVersionString>
  <sparkle:channel>beta</sparkle:channel>
  <pubDate>Mon, 05 Oct 2015 19:20:11 +0000</pubDate>
  <enclosure url="https://example.com/app.zip"
    sparkle:edSignature="7cLALF...==" length="1623481"
    type="application/octet-stream" sparkle:installationType="default"/>
</item>
```
- **(b) Signature**: **Ed25519 (RFC 8032)** detached, base64 in `sparkle:edSignature`. Keygen `./bin/generate_keys` → public 32-byte key in `Info.plist` `SUPublicEDKey`; sign `./bin/sign_update`. DSA is legacy. `SURequireSignedFeed` can also sign the appcast itself.
- **(c) Channel**: `sparkle:channel` per `<item>`; client pins a channel (`SUAllowChannelSwitching` to let users change).
- **(d) Cache/staging**: downloaded archive staged; APFS clone for bundle replace.
- **(e) Install hook**: `sparkle:installationType` = `default` (bundle replace) / `package` (.pkg) / `replacing` / `restarted`.
- **(f) Rollback**: `<sparkle:phasedRolloutInterval>` gives time-phased rollout (~5/15/35/100%); true recovery still = publish a new version. Delta failures fall back to full.
- **Add a version**: `./bin/generate_appcast appcast.xml MyApp-2.0.zip --ed-key-file ed_key.pem` (appends + signs the item).

## 4. WinSparkle  `[K]`

- **Repo**: `vslavik/winsparkle` — active (CI green, NuGet `WinSparkle` + prebuilt `WinSparkle.dll` x86/x64/arm64). C API + C#/.NET, Python (`pywinsparkle`), Go, Pascal bindings.
- **What it is**: the Windows port of Sparkle; **shares the Sparkle `appcast.xml` format unmodified** ("heavily inspired by Sparkle … to the point of sharing the same update format (appcasts)").
- **Production user (g)**: used by Windows desktop apps that want one Sparkle-compatible appcast across Mac+Windows (vendor-specific; lower-confidence on a single flagship name).
- **(a) Manifest**: identical to Sparkle §3 — `enclosure url/length/type`, `sparkle:version`, `sparkle:shortVersionString`, `sparkle:minimumSystemVersion` (e.g. `10.0.22631`), `<sparkle:deltas>`.
- **(b) Signature**: **EdDSA/Ed25519** primary (base64 32-byte public key in a Windows resource `EdDSAPub EDDSA {"..."}` or `win_sparkle_set_eddsa_public_key(...)`); DSA legacy/deprecated. Tool: `winsparkle-tool generate-key`, `winsparkle-tool sign` → emits `sparkle:edSignature="..." length="..."`.
- **(c) Channel**: per-feed (one appcast URL per channel).
- **(d) Cache/staging**: downloads to temp; runs the installer.
- **(e) Install hook**: shell-executes the enclosure (MSI / Inno / NSIS installer) — install path is a **full installer** (deltas are schema-present, not a headline feature).
- **(f) Rollback**: not manifest-driven; recovery = publish a newer version.
- **Add a version**: `winsparkle-tool sign --private-key-file private.key Updater.exe` then append the signed `<item>` to the appcast.

## 5. electron-updater  `[V]`

- **Repo**: `electron-userland/electron-builder` (`electron-updater` runtime). **npm `electron-updater`: 5,759,674 downloads/week** (2026-10-28→11-03, verified).
- **Production users (g)**: **Discord**, **Notion**, **Postman**, **Slack** (Electron apps built with electron-builder).

**(a) Manifest — `latest.yml`** (modern, electron-builder ≥27 / electron-updater ≥2.16). Fields:
`version`, `files[]` (`url`, **`sha512`** (Base64), `size`, `blockMapSize`, optional `blockMapUrl`, legacy `sha2`), `releaseDate`, `releaseName`, `releaseNotes`, **`stagingPercentage`**, `minimumSystemVersion`, `packages.{arch}` (`path`,`sha512`,`size`,`blockMapSize`,`isAdminRightsRequired`), `signatures[]` (`keyId` = hex SHA-256 of SPKI DER, `signature` = Base64 Ed25519).

```yaml
version: 1.2.3
files:
  - url: My-App-1.2.3-x64.exe
    sha512: dGVzdA==
    size: 123456789
    blockMapSize: 4567
releaseDate: '2026-11-05T10:30:00.000Z'
stagingPercentage: 25
```
Legacy (≤2.15): top-level `path` + `sha512` + `sha2`. Providers: `generic` (`{url}/latest[.yml|{channel}.yml]`), `github`, `s3`, `spaces`, `r2`, `keygen`, `gitlab`, `bitbucket` (Bintray dead 2021-05-01).
- **(b) Signature**: **Ed25519 signed update manifest** (v27+). Canonical serialization prefixed `EBUM1` covers `version`, `stagingPercentage`, `minimumSystemVersion`, each `files[]` (`url`,`sha512`,`size`) and `packages[]`; public key(s) ship in `app-update.yml`. Fail-closed before download. File integrity still `sha512`.
- **(c) Channel**: file-based — `latest.yml` / `beta.yml` / `latest-mac.yml`; `channel` option per provider.
- **(d) Cache/staging**: **blockmap** differential — `<size_bytes> <md5_hex>` per 1024-byte block; `computeOperations()` COPY vs range-DOWNLOAD; full-file `sha512` verified after.
- **(e) Install hook**: NSIS (Windows) / zip (mac, `ShipIt`-style) / AppImage/deb (Linux); `autoUpdater.downloadAndInstall()`.
- **(f) Rollback**: `stagingPercentage` for rollout; rollback = republish a lower/known-good `latest.yml` (no per-device token).
- **Add a version**: `electron-builder --win --publish always` (writes `latest.yml` + `.blockmap`, uploads to provider).

## 6. @tauri-apps/updater (Tauri 2.x)  `[V]`

- **Crate**: `tauri-plugin-updater` — **14,165,074 total downloads** (crates.io, verified 2026-11-05); latest published `3.0.0-alpha.3` (Tauri v3 alpha), stable line is 2.x. Docs `v2.tauri.app/plugin/updater/`.
- **Production user (g)**: **Spacedrive** (Tauri 2 file-manager; uses the updater plugin); also Lapce and the Tauri ecosystem default.

**(a) Manifest — signed JSON** on one or more `endpoints`. URL templates `{{current_version}}`, `{{target}}` (linux/windows/darwin), `{{arch}}` (x86_64/i686/aarch64/armv7); tried in order, first 2XX wins. **Static** (multi-platform) or **dynamic** (per-OS). No update = `204 No Content`.

```json
{ "version": "1.4.2", "notes": "Bug fixes", "pub_date": "2026-05-18T15:00:00Z",
  "platforms": {
    "darwin-aarch64": { "url": "https://.../app.tar.gz", "signature": "base64..." },
    "windows-x86_64": { "url": "https://.../app-setup.exe", "signature": "base64..." } } }
```
Dynamic: `{ "version", "pub_date", "url", "signature", "notes" }`. Config in `tauri.conf.json` → `bundle.createUpdaterArtifacts`, `plugins.updater.{ pubkey, endpoints[], windows.installMode: passive|basic|exec, allowDowngrades, dialog, dangerousInsecureTransportProtocol }`.
- **(b) Signature**: **minisign / Ed25519** (Arch-style) over the whole bundle; `pubkey` = full `.key.pub` content embedded in config. `tauri signer sign -k key file`. v2.13.3+ rejects non-canonical Ed25519 `S`.
- **(c) Channel**: per-endpoint (dev/staging/prod = different `endpoints` arrays / URL templates).
- **(d) Cache/staging**: downloads bundle to temp, verifies, then hands to native installer.
- **(e) Install hook**: per-OS native — macOS `.app.tar.gz` (bundle replace), Windows `.nsis.zip`/`.exe`, Linux `.AppImage`/`.deb`/`.rpm`. **Desktop only** (no android/ios updater).
- **(f) Rollback**: `allowDowngrades` (v2.12+) permits installing a lower version; otherwise server serves a known-good manifest. Experimental zstd delta via a `delta` manifest block (schema 1, any-previous→latest).
- **Add a version**: `tauri build` (auto-signs + emits the JSON) or POST the signed JSON to your endpoint.

## 7. Capacitor Live Update — Capawesome  `[V]`

- **Package**: `@capawesome/capacitor-live-update` — **141,060 downloads/week** (npm, verified). Cloud: `api.cloud.capawesome.io`.
- **Production user (g)**: Capawesome enterprise customers (field-service/logistics Capacitor apps); specific customer names are not public — treat as vendor-hosted.

**(a) Manifest — bundle JSON** (from `FetchLatestBundleResult`):
`{ artifactType: 'manifest'|'zip', bundleId, channel, checksum, customProperties{}, downloadUrl, signature }`.
Two artifact types: **`zip`** (full bundle; only on Electron) and **`manifest`** (file-level delta: JSON map `path → { hash: sha256base64, size }` + changed files). Self-hosted file downloads must return `X-Checksum` + `X-Signature` headers; manifest files fetched as `{url}?href={path}`.
- **(b) Signature**: optional — PEM **RSA** `publicKey` in plugin config; signature over SHA-256 of file bytes.
- **(c) Channel**: per-channel, resolution priority: `sync({channel})` (transient) → `setChannel()` (persisted) → native config (Info.plist / strings.xml) → `defaultChannel`. `fetchChannels()` (v6.9+); server-side channel→bundle mapping; `--android-min/max`, `--ios-min/max` version gating.
- **(d) Cache/staging**: unzip to `assets/`, set as next bundle; `autoDeleteBundles` cleans old; `maxUpdatesToKeep`-style retention.
- **(e) Install hook**: apply next bundle on relaunch (`autoUpdateStrategy: background`).
- **(f) Rollback**: **`readyTimeout`** — if the new bundle crashes before becoming ready, auto-rollback to previous; `autoBlockRolledBackBundles` blocks repeatedly-crashing bundles (max 100). Cloud-side percentage rollout.
- **Add a version**: `npx @capawesome/cli apps:liveupdates:upload --artifact-type manifest --path www` (or Capawesome Cloud UI).

## 8. Capacitor Live Update — Official (deprecated)  `[K]`

- **What it was**: `@capacitor/live-updates` (Ionic official) — a **basic JS-level patch** only: download a JS bundle, swap the entry script. No delta, no native bundle management, no channels, no signing.
- **Status / when it died**: removed from Capacitor core; **deprecated** in favor of the Capawesome plugin (§7). No 2025-2026 releases; migration path = adopt `@capawesome/capacitor-live-update`.
- **(a) Manifest**: a single JS bundle URL (no structured manifest). **(b) Signature**: none. **(c) Channel**: none. **(d) Cache**: in-app assets dir. **(e) Install**: re-point JS entry. **(f) Rollback**: none. **(g) Production**: none (superseded).
- **Verdict**: do not adopt.

## 9. CodePush / Microsoft App Center  `[V]`

- **Status**: **App Center (distribution + CodePush) retired 2025-03-31**; all four core repos archived (`react-native-code-push`, `cordova-plugin-code-push`, `code-push-server`, `code-push` — `isArchived: true`, verified via GitHub). `react-native-code-push` npm last 9.0.1; will NOT support RN New Architecture (0.82+).
- **Production user (g)**: none (dead). Legacy: huge swath of 2017-2024 RN/Cordova/Capacitor apps.

**(a) Historical manifest**: model `deployment (Production|Staging|Custom) → release (label, e.g. "Production2") → package (tarball of JS + assets)`; per-release fields **`mandatory: true|false`** (block app start), **`isRollback: true|false`**, rollout `%`. Check API: `GET .../v3/apps/{appId}/releases/deployments/{deploymentKey}?clientVersion=&clientLabel=`; response includes **`packageHash` (SHA-256)**, **`packageSize`**, **`label`**, **`description`**, **`installMode`** (IMMEDIATE / ON_NEXT_RESTART / ON_NEXT_RESUME).
- **(b) Signature**: SHA-256 integrity; **authenticity = App Center service** (HTTPS + per-app `app-key`) — no client-embedded public key (materially weaker than signed-manifest baseline).
- **(c) Channel**: deployment (device bound to one via native config + `deploymentKey`).
- **(d) Cache/staging**: ZIP extracted to native storage.
- **(e) Install hook**: `codePush.sync()` → download ZIP → verify `packageHash` → install → `codePush.notifyAppReady()`.
- **(f) Rollback**: `code-push rollback <deployment> <release-label>` (operator re-points deployment at a prior release); crash → auto-rollback on next launch.
- **Migration (documented, Expo)**: remove `react-native-code-push`, add `expo` `updates.url` + `runtimeVersion` to app.json, rebuild native binary, resubmit to stores, publish with `eas update --channel production`. Options: EAS Update (hosted) / self-hosted Updates V1 server / archived `code-push-server` / stop OTA.

## 10. Expo Updates (EAS Update)  `[K]`

- **Repo**: `expo/expo` (`packages/expo-updates`). Spec: **Expo Updates 1.x** technical spec (`docs.expo.dev/technical-specs/expo-updates-1/`). SDK 53+ (2026).
- **Production user (g)**: the default for all **EAS / Expo Go** apps; the designated CodePush successor.

**(a) Manifest — `ExpoUpdatesManifest`** (Updates V1). Fields: **`id`** (sha256 base64 content hash of the bundle — the update identity), **`createdAt`** (ISO 8601), **`runtimeVersion`** (compatibility gate), **`launchAsset`** (JS entry `Asset`), **`assets[]`** (each `Asset = { url, key, contentType, fileExtension, hash }`), `metadata.branchName`, `extra`.
Request: `GET {updates.url}?runtimeVersion={rv}&platform={p}` + headers from `requestHeaders` (e.g. **`expo-channel-name`**).
- **(b) Signature**: **RSA PKCS#1 v1.5 / SHA-256** (`codeSigningMetadata.alg: rsa-v1_5-sha256`); X.509 **code-signing certificate** (`codeSigningCertificate`) shipped in the app; signature travels as an HTTP message signature (`sig=` parameter), verified in production (`allowUnsignedManifests` is dev-only).
- **(c) Channel**: **branch + channel** model — server maps `channel → branch`; client sends channel header. `runtimeVersion` policy (`sdkVersion` / `nativeVersion` / explicit) is the hard compatibility gate (mismatch ⇒ `NoCompatibleUpdatesFound`).
- **(d) Cache/staging**: content-addressed assets by `hash`/`key` (already-cached assets not re-downloaded); `maxUpdatesToKeep` (default 2); `fallbackToCacheTimeout`; `useEmbeddedUpdate` as bricking fallback.
- **(e) Install hook**: `Updates.fetchUpdateAsync()` + `Updates.reloadAsync()`; `checkAutomatically: ON_LOAD|ON_ERROR|MANUAL`; bsdiff patch support optional (`enableBsdiffPatchSupport`).
- **(f) Rollback**: **first-class** — `UpdateCheckResultRollBack` result type + `isRollBackToEmbedded`; anti-bricking auto-rolls-back a crashing update. Rollout % is server-side (`eas update --rollout-percentage=N`; `eas update:edit` to advance; `eas update:revert-update-rollout`).
- **Add a version**: `eas update --branch production --message "..." [--rollout-percentage 10] [--private-key-path ...]`.

## 11. Sentry Releases  `[V]`

- **What it is**: **NOT an updater.** Sentry is an error/observability platform. `@sentry/electron` = **1,727,059 downloads/week** (npm, verified). For an Electron app it provides: JS + native crash capture, **source-map upload** (`sentry-cli sourcemaps upload`) to de-minify stack traces, **release-health** metrics (crash-free users/sessions, adoption %, slow sessions), and per-`release` dashboards.
- **Production user (g)**: near-universal; e.g. Figma, Linear, and most Electron/JS products use Sentry for release health (not for distributing code).
- **(a) Manifest**: none (no code distribution). A "release" is a version **tag** you declare: `Sentry.init({ release: "1.4.2" })` + `sentry-cli releases finalize 1.4.2`.
- **(b) Signature**: DSN/auth token for the ingest API (not a code signature). No code integrity scheme.
- **(c) Channel**: none (releases are flat version tags; you can group by release string).
- **(d) Cache/staging**: n/a (ingestion + symbol store only).
- **(e) Install hook**: none.
- **(f) Rollback**: none — but it is the **measurement** layer you gate a rollout on: pair Sentry's crash-free threshold (via Monitors/alerts) with a staged rollout so a bad release auto-stops expanding. That is its real role in the AIRIZ architecture: the **observability/kill-switch signal**, not the transport.
- **Add a version**: `sentry-cli releases new 1.4.2 && sentry-cli releases finalize 1.4.2` (+ `sentry-cli sourcemaps upload -r 1.4.2`).

## 12. Flutter (package_info_plus + in-app updater, community)  `[V]`

- **First-party? NO.** Flutter ships **no** auto-update engine. Updates go through the OS stores. The community pattern is two packages:
  - **`package_info_plus`** (Baseflow) — reads the native bundle's version/name/BuildNumber (no network; pure introspection).
  - **`in_app_update`** (jonasbark / FFUF) — **v5.0.0, published 2026-07-04** (pub.dev, verified); "Enables In App Updates on Android using the **official Android APIs**" (Play **App Update API**: `de.ffuf.in_app_update` / `InAppUpdatePlugin`). iOS side uses StoreKit in-app updates in the unified variants.
- **Production user (g)**: any Flutter app on the Play Store that uses immediate/flexible App Updates (common in consumer Flutter apps); the store itself is the deployment.

**(a) Manifest**: **none of its own** — the "manifest" is the **Play Store / App Store listing version** the device is eligible for. `in_app_update` just asks the Play App Update API / StoreKit for the latest compatible release.
- **(b) Signature**: the **store's** signature (Play/App Store code signing); the app verifies the store, not a self-hosted key.
- **(c) Channel**: the store's tracks (Play: internal / closed / open / **production**; App Store: TestFlight / App Store). No custom channel.
- **(d) Cache/staging**: managed by Play Delivery / the OS (flexible updates download in background; immediate updates take over the UI).
- **(e) Install hook**: `InAppUpdate.checkForUpdate()` → `startUpdateFlow()` (immediate) or `completeUpdate()` (flexible); on iOS `SKAppStoreUpdateViewController`.
- **(f) Rollback**: store-side — Play lets you **roll back** a production release to a previously released version; App Store lets you roll back a build.
- **Add a version**: build a new AAB/IPA, bump version, **upload to Play Console / App Store Connect** (the "updater" just surfaces it).
- **Note**: this is why Flutter desktop (no store) has no first-party updater — teams bolt on Squirrel/Sparkle/electron-style or self-host for Linux/Windows/macOS.

## 13. .NET MAUI deployment  `[L]`

- **Model**: MAUI apps are packaged per-platform; there is **no Microsoft first-party in-app updater** for MAUI beyond the platform installers.
  - **Windows**: **MSIX / MSIXBundle** via **AppInstaller** (see §17) — the OS AppInstaller service is the auto-update path.
  - **Android**: AAB → Google Play (staged rollout, §21). **iOS**: IPA → App Store (phased release, §20).
  - **macOS**: Sparkle (§3) is the de-facto choice for MAUI-on-Mac desktop.
- **Multi-arch single bundle? On Windows, yes**: an **MSIXBundle** contains per-`ProcessorArchitecture` `.msix` payloads (x64 / arm64) in one file; AppInstaller picks the right one. (This is the "multi-arch single bundle" the question asks about — answered by MSIXBundle, not by MAUI itself.)
- **(a) Manifest**: `.appinstaller` XML (Windows, §17) or the store binary metadata. **(b) Signature**: Authenticode (MSIX) / store signing. **(c) Channel**: store tracks / AppInstaller `UpdateSettings`. **(d) Cache**: OS package store / Play Delivery. **(e) Install**: OS AppInstaller / store. **(f) Rollback**: AppInstaller repoint / store rollback. **(g) Production**: any shipped MAUI Windows app (e.g. Microsoft's own MAUI samples / first-party MAUI apps distributed as MSIX).
- **Add a version**: rebuild the `.msixbundle`, re-sign, update the `.appinstaller` `MainBundle/@Version` + `@Uri` (Windows); or upload a new build to the store (mobile).

## 14. Uno Platform  `[L]`

- **Model**: Uno is a Skia-based multi-target framework. **Production update = the platform's**: Windows (WinUI 3) → **MSIX/AppInstaller** (§17); Android → Play; iOS/macOS → App Store / Sparkle. **WASM target has no in-app updater** — it relies on the **browser's** cache/service-worker semantics (§16); a new deploy is just new static files the browser revalidates.
- **"Hot reload" is a DEV-time feature** (Uno Hot Reload in the IDE / `dotnet watch`), NOT a production update mechanism — do not confuse the two in the architecture doc.
- **(a) Manifest**: platform (MSIX `.appinstaller` / store). **(b) Signature**: Authenticode / store / (WASM) none beyond HTTPS+SRI. **(c) Channel**: store tracks. **(d) Cache**: OS/browser. **(e) Install**: OS AppInstaller / store / browser. **(f) Rollback**: platform. **(g) Production**: e.g. apps targeting Windows via WinUI3 distributed as MSIX; WASM Uno apps on any static host.
- **Add a version**: same as §13/§16 depending on target.

## 15. React Native `react-native-code-push`  `[V]`

- **Status**: **archived** (GitHub `microsoft/react-native-code-push` `isArchived: true`, verified). It is the RN client of CodePush (§9) — **dead with App Center (2025-03-31)**.
- **What it was**: `codePush.sync()` client; deployment→release→package model; `mandatory` / `isRollback` / `installMode` (IMMEDIATE / ON_NEXT_RESTART / ON_NEXT_RESUME); SHA-256 `packageHash`; server-trusted (no embedded key).
- **Migration**: to **Expo Updates** (§10) — see §9 migration steps. `code-push-server` is archived/unmaintained (self-host only as a stopgap).
- **Verdict**: do not adopt; it is the cautionary "vendor OTA service died" case in the AIRIZ risk register.

## 16. PWA Service Worker  `[K]`

- **Spec**: W3C **Service Workers** (`w3.org/TR/service-workers/`, 2026 nightly). **Production user (g)**: effectively every installable web app (GitHub, Twitch, X, bank/retail PWAs) — the browser IS the updater.
- **(a) Manifest**: **no version manifest** — update detection is **byte-for-byte comparison** of the main script (+ `importScripts()`). Triggers: every navigation into scope; push/sync if last check > 24h; explicit `registration.update()`. `updateViaCache`: `imports` (default; revalidate main, cache imports) / `all` / `none`; **24-hour rule** forces no-cache on all scripts.
- **(b) Signature**: none in the spec; **SRI** (`integrity="sha256-..."`) optionally on `<script>`/`<link>` — validated at fetch time; on mismatch the resource is **blocked** (not cached/executed). SW `fetch` handler does not see SRI (rendering-layer check).
- **(c) Channel**: none.
- **(d) Cache/staging**: Cache Storage; new worker installs to a **waiting** state; Workbox `precache` is content-addressed (never overwritten in place).
- **(e) Install hook**: new worker `install` → `skipWaiting()` (activate now) → `clients.claim()` (take over all tabs) → `controllerchange` in each tab. Cross-tab fan-out via `workbox-broadcast-update` (`BroadcastUpdatePlugin`, `meta: 'workbox-broadcast-update'`, compares `Content-Length`/`ETag`/`Last-Modified`).
- **(f) Rollback**: **SW version swap** — the old worker stays available until replaced; a bad precache manifest makes the new worker `redundant` (atomic install failure = old stays). The real hazard: `skipWaiting()`+`claim()` while v2 deletes v1 caches → mixed-version tabs, lazy chunks 404. Safe pattern = user-initiated activation + `controllerchange` reload.
- **Add a version**: redeploy new static files (e.g. Cloudflare Pages / Netlify atomic flip); the browser picks up the new SW on next navigation.

## 17. Microsoft AppInstaller (MSIX)  `[K]`

- **Spec**: `.appinstaller` XML, schemas **2017/2** → **2018** (+`ShowPrompt`) → **2021** (+`UpdateBlocksActivation`, `ForceUpdateFromAnyVersion`, `UpdateURIs`, `RepairURIs`). **CRITICAL**: VS generates 2017/2 by default; `ShowPrompt`/`UpdateBlocksActivation` are silently ignored unless you bump to 2021. Requires Win10 2004+/Win11; **packaged apps only** (unpacked Win32 not eligible).
- **Production user (g)**: **Spotify** (MSIX), **WhatsApp for Windows** (MSIX), and Microsoft Store / sideloaded MSIX apps generally.
- **(a) Manifest — `.appinstaller`** (2021 schema). Elements: `AppInstaller/@Version`, `@Uri`; **`MainBundle`** (`@Name` package family, `@Publisher` cert subject, `@Version` 4-part, `@Uri`); `OptionalPackages/Bundle|Package` (`@ProcessorArchitecture` for multi-arch); `UpdateSettings/OnLaunch` (`HoursBetweenUpdateChecks` 0-255, `ShowPrompt`, `UpdateBlocksActivation`), `AutomaticBackgroundTask` (8h silent); `UpdateURIs/UpdateURI` (≤10 fallbacks); `RepairURIs`.
```xml
<AppInstaller xmlns="http://schemas.microsoft.com/appx/appinstaller/2021"
  Version="1.0.0.0" Uri="https://c.com/installers/app.appinstaller">
  <MainBundle Name="Contoso.MainApp" Publisher="CN=Contoso,..." Version="2.23.12.43"
    Uri="https://c.com/installers/mainapp.msixbundle"/>
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="12" ShowPrompt="true" UpdateBlocksActivation="false"/>
    <AutomaticBackgroundTask/>
  </UpdateSettings>
</AppInstaller>
```
- **(b) Signature**: **Authenticode** on the `.msix`/`.msixbundle` (the package is signed; the XML is integrity-checked via the URI).
- **(c) Channel**: none intrinsic (OS-managed); enterprise **CSP** (`./Device/Vendor/MSFT/EnterpriseModernAppManagement/AppManagement/nonStore/{family}/AppUpdateSettings/`) overrides per-package.
- **(d) Cache/staging**: OS package store; atomic package replacement.
- **(e) Install hook**: OS **AppInstaller deployment service** fetches `.appinstaller`, compares `MainBundle/@Version`, downloads `.msixbundle`, registers atomically, relaunches. `ShowPrompt=false` → silent; `UpdateBlocksActivation=true` → must update or close.
- **(f) Rollback**: re-point the `.appinstaller` (or `UpdateURIs`) at a prior `MainBundle/@Version`; `ForceUpdateFromAnyVersion` allows downgrades. Failure `0x80070490` = old unregistered + new not registered (bricked until repair).
- **Add a version**: rebuild + re-sign the `.msixbundle`, bump `MainBundle/@Version`, update/re-upload the `.appinstaller` `@Uri`.

## 18. Chrome component updater (Omaha / Google Update)  `[V]`

- **Repo**: `google/omaha` — **"Google Update for Windows"**, **2,617 stars**, Apache-2.0, **archived: true**, last push **2024-08-01** (verified via GitHub API). The *protocol* remains live in production (Chrome/Google apps) even though the reference repo is frozen.
- **What it is**: `component_updater` is Chrome's subsystem that updates **optional components** (Widevine/CDM, PDFium, MEI, NaCl, etc.) over the same Omaha wire as the browser itself — i.e. any Chromium-derived app (Edge, Brave, VS Code's Electron is NOT Omaha, but Chromium/CEF apps can be) can reuse this.
- **(a) Manifest**: an **Omaha codebase** — not a static file, a server-returned `<updatecheck><app codebase=... hash=... size=... Version=.../></updatecheck>` (see §19). A "component" is just another `<app appid={GUID}>` in the same request.
- **(b) Signature**: **SHA-1** (base64) `updatecheck/app/hash` in the V2 wire; trust anchor = the **Omaha/Google Update server over TLS** (pinned to `tools.google.com` / `omahaproxy.google.com`). No client-embedded Ed25519 key in V2.
- **(c) Channel**: `updatecheck/tag` (per-component channel/brand, e.g. `GO43`).
- **(d) Cache/staging**: downloaded codebase staged; CUP variant uses **ETag** caching (`304 Not Modified` on no-op).
- **(e) Install hook**: the updater service swaps the component in place (browser restart or lazy-load for CDMs).
- **(f) Rollback**: **server-driven** — the server can serve a lower `Version`+`codebase`; no client token.
- **Add a version**: not a self-serve file drop — a new **codebase** is registered on the Omaha server and rolled out by `appid`/`tag`. (For your own app you would run a server that speaks the same XML.)

## 19. Chromium Omaha ServerProtocolV2  `[V]`

- **Spec**: **Omaha ServerProtocolV2** (`google/omaha` `doc/ServerProtocolV2.md`, frozen; repo archived). **Production user (g)**: **Google Chrome** + all Google-updated apps; the de-facto model for any Chromium-derived auto-update.
- **Model**: **bidirectional XML over HTTPS** (client POSTs a request; server returns a codebase).

**(a) Request (client→server)** skeleton — `request` attrs `protocol="2.0"`, `os="win|mac|linux"`, `requestid`, `sessionid`, `version`, `installsource`, `seekinstall`, `seekstats`, `seekstatsinterval/maxretries/retryschedule/maxbackoff`; per-`<app>`: **`appid`** (GUID, one per product/channel), **`version`**, **`brand`**, `seekupdate`, `seekinstall`, `seekstats`, `lastupdateattempt`; **`<updatecheck tag="...">`**; **`<ping><data><os><item name= value=/>`**.

```xml
<request protocol="2.0" os="win" requestid="6e6d6f6e" sessionid="6f6e6d65" version="2.0">
  <app appid="{8A69D345-D564-463c-AFF1-A69D9E530F96}" version="2.0.1.2" brand="GO43"
       seekupdate="1" seekinstall="1" lastupdateattempt="0">
    <updatecheck tag="tag1"/>
    <ping><data><os><item name="platform" value="win"/>
                    <item name="version" value="6.0"/></os></data></ping>
  </app>
</request>
```
**(b) Response (server→client)** — `response` echoes `protocol/os/requestid/sessionid`; `<app appid version>` → **`<updatecheck><app codebase=URI hash=base64SHA1 size=int needsadmin=0|1 Version=string/></updatecheck>`**. No update = empty `<updatecheck/>`.
- **(b) Signature/integrity**: **SHA-1** (base64) in `updatecheck/app/hash`. Authenticity = TLS-pinned server.
- **(c) Channel**: `updatecheck/tag` (server uses it for rollout bucketing).
- **(d) Cache/staging**: CUP ETag caching; multi-app bundling (one request, many `<app>`).
- **(e) Install hook**: updater service applies the `codebase` installer.
- **(f) Rollback**: server-driven (serve a lower `Version`+`codebase`); no client-side token; **no V2 min-version field** (compatibility enforced server-side). **Flatcar/nebraska** (active Omaha fork) adds **ARD-001** multi-step / floor updates (`multi_manifest_ok`, `is_target`, floor-version) — an extension, not core V2.
- **Add a version**: register a new codebase + point the `appid`/`tag` at it on your Omaha-compatible server.

## 20. Apple Software Update / iOS App Store  `[L]`

- **What it is**: the **only** public path for iOS/iPadOS (and the standard for Mac App Store apps). "Manifest" = the App Store Connect binary + its metadata; the device talks to Apple's update service, not to you.
- **Production user (g)**: **WhatsApp**, **Instagram**, every iOS app.
- **(a) Manifest**: App Store Connect build (IPA) + version metadata (`CFBundleShortVersionString`/`CFBundleVersion`). The staged-rollout "schema" is a **percentage + schedule** you configure in App Store Connect (not a file you host).
- **(b) Signature**: **Apple code signing** (your cert, notarized) + Apple's distribution; the App Store re-attests.
- **(c) Channel**: **Phased release** — you enable "Phased Release" and App Store Connect auto-expands over ~7 days: **1% → 2% → 5% → 10% → 20% → 50% → 100%** (you can **Stop** the phase at any time to promote the current % to 100%, or **roll back** to a prior approved build). TestFlight is the beta channel (10k external testers, 90-day build expiry).
- **(d) Cache/staging**: Apple's CDN + device; user sees "update available".
- **(e) Install hook**: the App Store / in-app `SKAppStoreUpdateViewController` (optional prompt) — the app cannot force-install; it can only *prompt*.
- **(f) Rollback**: App Store Connect **roll back** to a previously released version (binary-level, no new review for an already-approved build); you cannot "un-ship" without it.
- **Add a version**: upload a new build to App Store Connect, submit for review (24-72h gate), then enable Phased Release.
- **AIRIZ note**: this is the 24-72h review gate (motor-console-survey Problem 7) — the public can be stuck ~3 days on an incompatible build; the "emergency channel" (enterprise/ad-hoc/sideload) carries revocation risk.

## 21. Google Play Console staged rollout  `[L]`

- **Production user (g)**: **WhatsApp**, **Instagram**, every Android app.
- **(a) Manifest**: Play binary (**AAB**) + store metadata. Rollout is a **percentage** you set per release track in Play Console (not a hosted file).
- **(b) Signature**: **Play App Signing** (Google-managed signing key) + your upload key; Play re-signs/attests.
- **(c) Channel / staged rollout**: tracks **internal → closed (beta) → open (beta) → production**. On production you choose a **staged-rollout percentage** — the standard Play UI buckets are **1% / 2% / 5% / 10% / 20% / 30% / 50% / 60% / 70% / 80% / 90% / 100%**; you **increase** over time and watch **Play Vital** (crash/ANR) stats per rollout. (Exact UI buckets can shift; the model — incremental % + analytics gate — is stable.)
- **(d) Cache/staging**: **Play Delivery** (app thinning, base + per-device config/feature splits, background download for flexible updates).
- **(e) Install hook**: Play Store / in-app **App Update API** (immediate takes over UI; flexible downloads in background) — the app can only *prompt*, not force.
- **(f) Rollback**: Play **Rollback** returns production to the previously rolled-out version (binary-level, fast, no new review); you can also pause a staged rollout.
- **Add a version**: upload AAB to Play Console, promote to a track, set the staged %; `bundletool` + Play Developer API for CI.

## 22. Cloudflare Workers + R2  `[K]`

- **What it is**: the **infrastructure pattern** for hosting an update manifest/decision service + the artifact store. Not an "updater" per se, but where §5/§6/§10-style manifests often live.
- **Production user (g)**: Cloudflare's own products + the long tail of teams serving `latest.yml` / Tauri JSON / Expo-style endpoints from a Worker with R2 as the artifact bucket.
- **(a) Manifest**: whatever your client expects — the Worker returns it (often a pointer/redirect to an R2 object or a pre-signed URL). R2 stores the immutable artifact bytes.
- **(b) Signature**: app-defined — you can **sign the manifest** (Ed25519) in the Worker and/or issue **pre-signed R2 URLs**; the Worker is the trust boundary you must protect.
- **(c) Channel**: whatever logic the Worker implements (header/URL → channel → version).
- **(d) Cache/staging**: R2 object storage (content-addressed objects) + Worker KV/DO for state.
- **(e) Install hook**: none (client-side); the Worker only serves/authorizes.
- **(f) Rollback — the two independent axes** (motor-console-survey Problem 10, verified): every `wrangler deploy` / `wrangler versions upload` is an **immutable version**; a "deployment" is a region→version **pointer**; "rollback" re-points to a prior version — but **versions are retained for a window (~last 25)** and once pruned the code is **gone** (redeploy from source). Worse: **KV poisoning** — a buggy version can write a corrupt "latest" pointer/cache value, and rolling back the **code does NOT roll back the data**; Durable Objects from the old version keep running old code. **Code and data are separate rollback axes.**
- **Add a version**: `wrangler versions upload` then `wrangler versions deploy <version-id>` (or `wrangler deploy`); `wrangler versions list` to see the retention window.

## 23. Spore (OSS, BitTorrent)  `[L] — UNVERIFIED`

- **Honest status**: I could **not verify** a specific named, actively-maintained OSS project called **"Spore" (Disroot/OSS)** that ships BitTorrent-based app updates to production. Targeted GitHub searches for `spore` + update/distribution/torrent surfaced only unrelated hits (game names, color tokens, ML "MindSpore"). **Per the fail-loud rule, I am flagging this as unverified rather than inventing a deployment.**
- **The pattern it represents** (BitTorrent-based update distribution) is real and used for **large binaries** to cut origin bandwidth: peers seed the installer/update artifact and clients pull pieces from the swarm, with the **torrent info-hash** acting as the content identity/integrity anchor (the `.torrent`/magnet is the "manifest"; the SHA-1 piece hashes are the integrity scheme; the tracker/seed set is the "channel").
- **(a) Manifest**: the `.torrent` / magnet URI (info-dict: `name`, `piece length`, **`pieces`** = concatenated SHA-1 piece hashes, `announce-list` trackers, `url-list` seeders/HTTP-seeds for hybrid).
- **(b) Signature**: the **info-hash** (SHA-1 over the info-dict) binds content; piece hashes verify each chunk. Authenticity of the torrent itself is out-of-band (you must trust the source of the `.torrent`).
- **(c) Channel**: tracker/seed selection; hybrid `url-list` can mix HTTP-seed (direct) + P2P.
- **(d) Cache/staging**: local torrent client partial-file cache; assembled to the target path.
- **(e) Install hook**: a wrapper that runs the installer once the torrent completes at 100%.
- **(f) Rollback**: re-issue a new torrent (new info-hash) pointing at a known-good artifact; old swarm stays available.
- **(g) Production**: **unconfirmed** for "Spore"; the pattern is used in practice for big game/OS distribution (e.g. some Linux distros and game platforms seed via BitTorrent) but I will not attribute a specific production updater to "Spore" without a verifiable source.
- **Action**: if "Spore" is a specific internal/third-party project, supply its repo URL and I will verify its exact manifest + signature scheme. **Do not base the AIRIZ architecture on an unverified engine.**

---

## Source & verification index

| # | Primary source | Verified 2026-11-05 |
|---|----------------|---------------------|
| 1 | github.com/Squirrel/Squirrel.Windows (`ReleaseEntry.cs`) | GitHub API: 7,990★, last push 2024-07-24 `[V]` |
| 3 | sparkle-project.org/documentation/publishing; Sparkle `2.x` | field names from prior verified survey `[K]` |
| 5 | npm registry `electron-updater` | 5,759,674 dl/wk `[V]` |
| 6 | crates.io `tauri-plugin-updater` | 14,165,074 dl total, max 3.0.0-alpha.3 `[V]` |
| 7 | npm `@capawesome/capacitor-live-update` | 141,060 dl/wk `[V]` |
| 9 | GitHub (4 CodePush repos) | `isArchived: true` ×4 `[V]` |
| 11 | npm `@sentry/electron` | 1,727,059 dl/wk `[V]` |
| 12 | pub.dev `in_app_update` | v5.0.0, published 2026-07-04 `[V]` |
| 18/19 | github.com/google/omaha (`doc/ServerProtocolV2.md`) | GitHub API: 2,617★, **archived**, last push 2024-08-01 `[V]` |
| 20/21 | Apple/Google store docs | knowledge-based `[L]` (Exa + Context7 rate/quota-limited this session) |
| 22 | developers.cloudflare.com/workers (wrangler `versions`, KV, DO) | from prior verified survey `[K]` |

**Tooling note (honest):** Context7 (resolve-library-id/query-docs) returned "monthly quota exceeded" and Exa web-search returned a rate-limit error during this session, so the store-percentage facts (§20/§21) and the §23 Spore identity rest on prior verified surveys + established documentation and are marked `[L]`. All OSS star/last-push/archive facts and all npm/crates/pub download counts above were pulled live this session via the GitHub / npm / crates.io / pub.dev APIs and are `[V]`.

---

## Appendix A — Minimal manifest schema (all 23, copy-pasteable)

```text
01 Squirrel.Windows  RELEASES (text):        <SHA1_40hex> <file|url> <bytes>[ # N%]
02 Squirrel.Mac      appcast.xml:            <enclosure url length type sparkle:version sparkle:dsaSignature/>
03 Sparkle 2.x       appcast.xml:            <enclosure url length type sparkle:edSignature/> + <sparkle:version>
04 WinSparkle        appcast.xml:            (same as 03) + sparkle:edSignature (Ed25519)
05 electron-updater  latest.yml:             { version, files:[{url, sha512, size, blockMapSize}], releaseDate, stagingPercentage }
06 Tauri 2           latest.json:            { version, pub_date, platforms:{"os-arch":{url, signature}} }
07 Capawesome        bundle json:            { artifactType, bundleId, channel, checksum, downloadUrl, signature }
08 Capacitor(official) bundle url:           <single JS bundle URL>  (no structured manifest)
09 CodePush          release pkg:            { label, packageHash(SHA256), packageSize, mandatory, isRollback, installMode }
10 Expo Updates      ExpoUpdatesManifest:    { id, createdAt, runtimeVersion, launchAsset, assets[], metadata.branchName }
11 Sentry            (none)                  release = version tag; sentry-cli releases new/finalize
12 Flutter           (none)                  store listing version (Play App Update API / StoreKit)
13 .NET MAUI         .appinstaller:          <MainBundle Name Publisher Version Uri/>  (or store binary)
14 Uno Platform      (per-target)            .appinstaller / store / WASM = browser revalidation
15 react-native-code-push pkg:               (archived) same as 09
16 PWA Service Worker (none)                 byte-compare of SW main script; SRI optional
17 MSIX AppInstaller .appinstaller:          <MainBundle Name Publisher Version Uri/> + <UpdateSettings/>
18 Chrome component  omaha codebase:         <updatecheck><app codebase hash size Version/></updatecheck>
19 Omaha V2          request/response XML:   appid+version+updatecheck/tag  ->  codebase+hash(SHA1)+size+Version
20 Apple App Store   (store)                 IPA + version; phased release % = App Store Connect schedule
21 Google Play       (store)                 AAB + version; staged rollout % = Play Console track
22 Cloudflare        (worker+R2)             worker returns manifest/redirect; R2 object = artifact
23 Spore (unverified) .torrent:              { name, "piece length", pieces(SHA1 list), announce-list, url-list }
```

## Appendix B — "Add a new version" one-liner (all 23)

```text
01 Squirrel.Windows       Squirrel --releasify MyApp-1.1.0-full.nupkg
02 Squirrel.Mac           (abandoned) n/a
03 Sparkle 2.x            ./bin/generate_appcast appcast.xml MyApp-2.0.zip --ed-key-file ed_key.pem
04 WinSparkle             winsparkle-tool sign --private-key-file private.key Updater.exe   (then append <item>)
05 electron-updater       electron-builder --win --publish always
06 Tauri 2                tauri build        (auto-signs + emits latest.json)
07 Capawesome             npx @capawesome/cli apps:liveupdates:upload --artifact-type manifest --path www
08 Capacitor(official)    (deprecated) n/a
09 CodePush               (retired) code-push release Production   ->  migrate to: eas update --branch production
10 Expo Updates           eas update --branch production --message "..." [--rollout-percentage 10]
11 Sentry                 sentry-cli releases new 1.4.2 && sentry-cli releases finalize 1.4.2
12 Flutter                build AAB/IPA, bump version, upload to Play Console / App Store Connect
13 .NET MAUI              rebuild+sign .msixbundle, bump .appinstaller MainBundle/@Version, re-upload
14 Uno Platform           per-target: .appinstaller / store upload / redeploy WASM static files
15 react-native-code-push (archived) n/a  ->  migrate to Expo Updates
16 PWA Service Worker     redeploy new static files (atomic flip); browser revalidates SW on next nav
17 MSIX AppInstaller      rebuild+sign .msixbundle, bump .appinstaller MainBundle/@Version, re-upload
18 Chrome component       register new codebase on Omaha server for the appid/tag
19 Omaha V2               register new codebase + point appid/tag at it (Omaha-compatible server)
20 Apple App Store        upload build to App Store Connect, submit for review, enable Phased Release
21 Google Play            upload AAB, promote to production track, set staged rollout %
22 Cloudflare             wrangler versions upload && wrangler versions deploy <version-id>
23 Spore (unverified)     re-issue .torrent for the known-good artifact (new info-hash)
```

## Appendix C — Release / version matrix (last known, 2026)

| # | System | Spec / latest | Last activity (verified) | Stars | Downloads (verified) |
|---|--------|---------------|--------------------------|-------|----------------------|
| 1 | Squirrel.Windows | Squirrel 2.x | push 2024-07-24 `[V]` | 7,990 `[V]` | NuGet (n/a here) |
| 3 | Sparkle 2.x | 2.7+ (delta v4) | active `[K]` | n/a (Xcode) | n/a |
| 4 | WinSparkle | Sparkle-wire | active `[K]` | n/a | NuGet `WinSparkle` |
| 5 | electron-updater | ≥2.16 / builder 27+ | active | n/a | 5.76M/wk `[V]` |
| 6 | Tauri updater | 2.x (3.0.0-alpha.3) | 2026-10-28 `[V]` | n/a | 14.1M total `[V]` |
| 7 | Capawesome | 8.x (Cap ≥8) | active | n/a | 141K/wk `[V]` |
| 9 | CodePush | 9.0.1 (frozen) | retired 2025-03-31 `[V]` | n/a | n/a (dead) |
| 10 | Expo Updates | Updates V1, SDK 53+ | active | n/a | via `eas`/`expo` |
| 11 | Sentry | current | active | n/a | 1.73M/wk (`@sentry/electron`) `[V]` |
| 12 | in_app_update | 5.0.0 | 2026-07-04 `[V]` | n/a | pub.dev |
| 18/19 | Omaha | ServerProtocolV2 (frozen) | push 2024-08-01, **archived** `[V]` | 2,617 `[V]` | n/a |
| 22 | Cloudflare Workers | current | active | n/a | n/a (platform) |

**Bottom line for the AIRIZ unified release architecture (no new recommendations, just the surface):**
the field surface that a unified manifest must be able to *project into* is the union of:
`version` (+`shortVersionString`/CFBundleVersion), a **content hash** (SHA-1/SHA-256/SHA-512),
a **detached signature** (Ed25519 dominant; RSA-PKCS1v15-SHA256 for Expo; Authenticode/Store for
native; SHA-1 for legacy Omaha/Squirrel), a **channel** (file / header / tag / endpoint / store-track),
a **staged-rollout percentage** (Squirrel `# N%`, `stagingPercentage`, Sparkle `phasedRolloutInterval`,
store %), a **min-version / runtimeVersion gate** (Sparkle `minimumSystemVersion`, Tauri platform keys,
Expo `runtimeVersion`, AppInstaller `Version`), an **install hook** (bundle-replace vs installer-exe vs
OS-AppInstaller vs store-prompt vs SW-swap), and a **rollback signal** (publish-new for file-based
systems; server-repoint for Omaha/AppInstaller/stores; `isRollback`/`readyTimeout` auto-rollback for
Expo/Capawesome). Spore is excluded pending verification.
